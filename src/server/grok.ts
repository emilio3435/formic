import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { TokenUsage } from "../shared/types";
import type { LifecycleThresholds } from "./lifecycle";
import { makeAgent, type ParseMetadata } from "./collectors";
import type { HumanMessageCandidate } from "./human-message";
import type { CollectedAgent, CollectionResult } from "./types";

type JsonRecord = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GrokSessionInput {
  sourceSessionId: string;
  cwd?: string;
  summaryJson?: string;
  signalsJson?: string;
  updatesJsonl?: string;
}

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function parsedRecord(json: string | undefined): JsonRecord | undefined {
  if (json === undefined) return undefined;
  try {
    return record(JSON.parse(json));
  } catch {
    return undefined;
  }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function timestamp(value: unknown): string | undefined {
  const millis = typeof value === "number"
    ? value * (value < 10_000_000_000 ? 1_000 : 1)
    : typeof value === "string"
      ? Date.parse(value)
      : Number.NaN;
  return Number.isFinite(millis) ? new Date(millis).toISOString() : undefined;
}

function later(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(right) > Date.parse(left) ? right : left;
}

function updateText(update: JsonRecord): string | undefined {
  const content = record(update.content);
  return text(content?.text) ?? text(update.content);
}

function updateRows(jsonl: string | undefined): JsonRecord[] {
  if (!jsonl) return [];
  return jsonl.split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const row = record(JSON.parse(line));
      return row ? [row] : [];
    } catch {
      // A live updates file may end in a partially-written JSON line.
      return [];
    }
  });
}

function tokenUsage(signals: JsonRecord | undefined): TokenUsage {
  const total = finite(signals?.contextTokensUsed);
  const contextWindow = finite(signals?.contextWindowTokens);
  if (total === undefined) {
    return {
      scope: "unknown",
      provenance: "unknown",
      ...(contextWindow !== undefined ? { contextWindow } : {}),
    };
  }
  return {
    total,
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    scope: "latest-turn",
    provenance: "observed",
  };
}

export function parseGrokSession(
  input: GrokSessionInput,
  meta: ParseMetadata = {},
): CollectedAgent {
  const summary = parsedRecord(input.summaryJson);
  const info = record(summary?.info);
  const signals = parsedRecord(input.signalsJson);
  const messages: HumanMessageCandidate[] = [];
  let task: string | undefined;
  let tail: string | undefined;
  let updatedAt: string | undefined;
  let startedFromUpdates: string | undefined;
  let exited = false;

  for (const row of updateRows(input.updatesJsonl)) {
    const params = record(row.params);
    const update = record(params?.update);
    if (!update) continue;
    const at = timestamp(row.timestamp) ?? timestamp(record(params?._meta)?.agentTimestampMs);
    startedFromUpdates ??= at;
    updatedAt = later(updatedAt, at);
    const kind = text(update.sessionUpdate);
    if (kind === "user_message_chunk") {
      if (record(update._meta)?.hideFromScrollback === true) continue;
      const content = updateText(update);
      if (content) {
        task ??= content;
        messages.push({ role: "user", content, timestamp: at });
      }
      exited = false;
    } else if (kind === "agent_message_chunk") {
      const content = updateText(update);
      if (content) {
        tail = content;
        messages.push({ role: "assistant", content, timestamp: at });
      }
      exited = false;
    } else if (kind === "turn_completed") {
      exited = true;
    }
  }

  const summaryUpdatedAt = timestamp(summary?.last_active_at ?? summary?.updated_at);
  const fallbackUpdatedAt = new Date(meta.mtimeMs ?? meta.nowMs ?? Date.now()).toISOString();
  const model = text(summary?.current_model_id) ?? text(signals?.primaryModelId);
  const parentSourceSessionId = text(summary?.parent_session_id)
    ?? text(info?.parent_session_id);

  return makeAgent({
    provider: "grok",
    sourceSessionId: input.sourceSessionId,
    displayName: text(summary?.generated_title)
      ?? text(summary?.session_summary)
      ?? text(summary?.agent_name),
    cwd: text(info?.cwd) ?? input.cwd,
    model,
    task,
    startedAt: timestamp(summary?.created_at) ?? startedFromUpdates,
    updatedAt: later(summaryUpdatedAt, updatedAt) ?? fallbackUpdatedAt,
    tokens: tokenUsage(signals),
    transcriptTail: tail,
    humanMessages: messages,
    parentSourceSessionId,
    exited,
    endEvidence: "turn-complete",
    meta,
  });
}

function missing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function optionalFile(path: string, errors: string[]): Promise<{ text?: string; mtimeMs?: number }> {
  try {
    const details = await stat(path);
    return { text: await readFile(path, "utf8"), mtimeMs: details.mtimeMs };
  } catch (error) {
    if (!missing(error)) errors.push(`${path}: ${describe(error)}`);
    return {};
  }
}

function decodedCwd(encoded: string): string | undefined {
  try {
    const value = decodeURIComponent(encoded);
    return value.startsWith("/") ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function collectGrokSessions(
  root: string,
  windowMs: number,
  thresholds?: LifecycleThresholds,
): Promise<CollectionResult<CollectedAgent[]>> {
  const errors: string[] = [];
  try {
    await readdir(root);
  } catch (error) {
    if (missing(error)) return { value: [], errors: [], absent: true };
    return { value: [], errors: [`grok ${root}: ${describe(error)}`] };
  }

  const sessionsRoot = join(root, "sessions");
  let projects;
  try {
    projects = await readdir(sessionsRoot, { withFileTypes: true });
  } catch (error) {
    if (missing(error)) return { value: [], errors: [] };
    return { value: [], errors: [`grok ${sessionsRoot}: ${describe(error)}`] };
  }

  const agents: CollectedAgent[] = [];
  await Promise.all(projects.filter((entry) => entry.isDirectory()).map(async (project) => {
    const projectRoot = join(sessionsRoot, project.name);
    let sessions;
    try {
      sessions = await readdir(projectRoot, { withFileTypes: true });
    } catch (error) {
      errors.push(`grok ${projectRoot}: ${describe(error)}`);
      return;
    }
    await Promise.all(sessions.filter((entry) => entry.isDirectory() && UUID.test(entry.name)).map(async (session) => {
      const sessionRoot = join(projectRoot, session.name);
      const [summary, signals, updates, directory] = await Promise.all([
        optionalFile(join(sessionRoot, "summary.json"), errors),
        optionalFile(join(sessionRoot, "signals.json"), errors),
        optionalFile(join(sessionRoot, "updates.jsonl"), errors),
        stat(sessionRoot),
      ]);
      const mtimeMs = Math.max(
        directory.mtimeMs,
        summary.mtimeMs ?? 0,
        signals.mtimeMs ?? 0,
        updates.mtimeMs ?? 0,
      );
      if (Date.now() - mtimeMs > windowMs) return;
      const sourcePath = updates.text !== undefined
        ? join(sessionRoot, "updates.jsonl")
        : summary.text !== undefined
          ? join(sessionRoot, "summary.json")
          : undefined;
      agents.push(parseGrokSession({
        sourceSessionId: session.name.toLowerCase(),
        cwd: decodedCwd(project.name),
        summaryJson: summary.text,
        signalsJson: signals.text,
        updatesJsonl: updates.text,
      }, { sourcePath, mtimeMs, thresholds }));
    }));
  }));

  return { value: agents, errors };
}
