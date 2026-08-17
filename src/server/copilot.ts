import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, join, normalize } from "node:path";
import type { EndEvidence, TokenUsage } from "../shared/types";
import { instanceIdFor } from "./collector-instances";
import { makeAgent, type ParseMetadata } from "./collectors";
import type { HumanMessageCandidate } from "./human-message";
import type { LifecycleThresholds } from "./lifecycle";
import type { CollectedAgent, CollectionResult } from "./types";

type JsonRecord = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function missing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function later(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(right) > Date.parse(left) ? right : left;
}

function earlier(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(right) < Date.parse(left) ? right : left;
}

export function copilotTimestamp(value: unknown): string | undefined {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const millis = value < 10_000_000_000 ? value * 1_000 : value;
  return new Date(millis).toISOString();
}

function rowsFromJsonl(jsonl: string): JsonRecord[] {
  return jsonl.split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const row = record(JSON.parse(line));
      return row ? [row] : [];
    } catch {
      return [];
    }
  });
}

function dataOf(row: JsonRecord): JsonRecord | undefined {
  return record(row.data);
}

function eventType(row: JsonRecord): string | undefined {
  return text(row.type);
}

function usageOf(value: unknown): { input: number; output: number; cached: number; cacheWrite: number } | undefined {
  const usage = record(value);
  if (!usage) return undefined;
  const input = finite(usage.inputTokens);
  const output = finite(usage.outputTokens);
  if (input === undefined && output === undefined) return undefined;
  return {
    input: input ?? 0,
    output: output ?? 0,
    cached: finite(usage.cacheReadTokens) ?? 0,
    cacheWrite: finite(usage.cacheWriteTokens) ?? 0,
  };
}

function modelMetricsUsage(metrics: unknown): { input: number; output: number; cached: number; cacheWrite: number } | undefined {
  const models = record(metrics);
  if (!models) return undefined;
  let input = 0;
  let output = 0;
  let cached = 0;
  let cacheWrite = 0;
  let saw = false;
  for (const value of Object.values(models)) {
    const usage = usageOf(record(value)?.usage);
    if (!usage) continue;
    saw = true;
    input += usage.input;
    output += usage.output;
    cached += usage.cached;
    cacheWrite += usage.cacheWrite;
  }
  return saw ? { input, output, cached, cacheWrite } : undefined;
}

export function parseCopilotSession(
  sourceSessionId: string,
  jsonl: string,
  meta: ParseMetadata = {},
): CollectedAgent | null {
  const messages: HumanMessageCandidate[] = [];
  let task: string | undefined;
  let tail: string | undefined;
  let startedAt: string | undefined;
  let updatedAt: string | undefined;
  let originCwd: string | undefined;
  let cwd: string | undefined;
  let model: string | undefined;
  let sessionExit = false;
  let uncleanExit = false;
  let sessionTotal = 0;
  let sessionProcessed = 0;
  let sawUsage = false;

  for (const row of rowsFromJsonl(jsonl)) {
    const data = dataOf(row);
    const at = copilotTimestamp(row.timestamp)
      ?? copilotTimestamp(data?.startTime)
      ?? copilotTimestamp(data?.sessionStartTime);
    if (at) {
      startedAt = earlier(startedAt, at);
      updatedAt = later(updatedAt, at);
    }
    const kind = eventType(row);
    if (!kind) continue;

    if (kind === "session.start") {
      const context = record(data?.context);
      const startCwd = text(context?.cwd);
      if (startCwd) {
        originCwd ??= startCwd;
        cwd = startCwd;
      }
      startedAt = earlier(startedAt, copilotTimestamp(data?.startTime) ?? at);
      continue;
    }
    if (kind === "session.context_changed") {
      const nextCwd = text(data?.cwd);
      if (nextCwd) {
        originCwd ??= nextCwd;
        cwd = nextCwd;
      }
      continue;
    }
    if (kind === "session.model_change") {
      model = text(data?.newModel) ?? model;
      continue;
    }
    if (kind === "user.message") {
      if (text(row.agentId)) continue;
      const content = text(data?.content);
      if (content) {
        task ??= content;
        messages.push({ role: "user", content, timestamp: at });
      }
      continue;
    }
    if (kind === "assistant.message") {
      if (text(row.agentId)) continue;
      const content = text(data?.content);
      if (content) {
        tail = content;
        messages.push({ role: "assistant", content, timestamp: at });
      }
      continue;
    }
    if (kind === "session.shutdown") {
      sessionExit = true;
      uncleanExit = text(data?.shutdownType) === "error";
      model = text(data?.currentModel) ?? model;
      const usage = modelMetricsUsage(data?.modelMetrics);
      if (usage) {
        sawUsage = true;
        sessionTotal = usage.input + usage.output + usage.cacheWrite;
        sessionProcessed = usage.input + usage.output + usage.cached + usage.cacheWrite;
      }
    }
  }

  if (!updatedAt && messages.length === 0 && !sessionExit) return null;

  const tokens: TokenUsage = sawUsage
    ? {
        sessionTotal,
        sessionProcessed,
        scope: "session",
        provenance: "observed",
      }
    : { scope: "unknown", provenance: "unknown" };

  const endEvidence: EndEvidence | undefined = sessionExit ? "session-exit" : undefined;

  const agent = makeAgent({
    provider: "copilot",
    sourceSessionId,
    cwd,
    originCwd,
    model,
    task,
    startedAt,
    updatedAt: updatedAt ?? new Date(meta.nowMs ?? Date.now()).toISOString(),
    tokens,
    transcriptTail: tail,
    humanMessages: messages,
    exited: sessionExit,
    endEvidence,
    meta,
  });
  if (sessionExit && uncleanExit) {
    agent.transcriptEndedCleanly = undefined;
  }
  return agent;
}

async function collectCopilotFile(
  path: string,
  sourceSessionId: string,
  windowMs: number,
  thresholds: LifecycleThresholds | undefined,
  nowMs: number,
): Promise<CollectedAgent | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  const agent = parseCopilotSession(sourceSessionId, text, {
    sourcePath: path,
    nowMs,
    thresholds,
  });
  if (!agent) return undefined;
  if (nowMs - Date.parse(agent.updatedAt) > windowMs) return undefined;
  return agent;
}

async function collectCopilotRoot(
  root: string,
  windowMs: number,
  thresholds: LifecycleThresholds | undefined,
  nowMs: number,
): Promise<CollectionResult<CollectedAgent[]>> {
  try {
    await readdir(root);
  } catch (error) {
    if (missing(error)) return { value: [], errors: [], absent: true };
    return { value: [], errors: [`copilot ${root}: ${describe(error)}`] };
  }

  const sessionsRoot = join(root, "session-state");
  let sessions;
  try {
    sessions = await readdir(sessionsRoot, { withFileTypes: true });
  } catch (error) {
    if (missing(error)) return { value: [], errors: [] };
    return { value: [], errors: [`copilot ${sessionsRoot}: ${describe(error)}`] };
  }

  const errors: string[] = [];
  const agents: CollectedAgent[] = [];
  await Promise.all(sessions.filter((entry) => entry.isDirectory() && UUID.test(entry.name)).map(async (session) => {
    const sourceSessionId = session.name.toLowerCase();
    const path = join(sessionsRoot, session.name, "events.jsonl");
    try {
      await stat(path);
    } catch (error) {
      if (!missing(error)) errors.push(`copilot ${path}: ${describe(error)}`);
      return;
    }
    const collected = await collectCopilotFile(path, sourceSessionId, windowMs, thresholds, nowMs);
    if (collected) agents.push(collected);
  }));
  return { value: agents, errors };
}

async function resolvedPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    const trimmed = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
    return normalize(trimmed);
  }
}

export async function collectCopilotSessions(
  root: string,
  windowMs: number,
  thresholds?: LifecycleThresholds,
  extraRoots: readonly string[] = [],
  nowMs = Date.now(),
): Promise<CollectionResult<CollectedAgent[]>> {
  const primary = await collectCopilotRoot(root, windowMs, thresholds, nowMs);
  const agents = [...primary.value];
  const errors = [...primary.errors];
  const seen = new Set(agents.map((agent) => agent.id));
  const defaultPath = await resolvedPath(root);

  for (const extra of extraRoots) {
    const extraPath = await resolvedPath(extra);
    if (extraPath === defaultPath) continue;
    const collected = await collectCopilotRoot(extra, windowMs, thresholds, nowMs);
    if (collected.absent) {
      errors.push(`copilot extra CLI root ${extra}: not found`);
      continue;
    }
    errors.push(...collected.errors);
    for (const agent of collected.value) {
      agent.instanceId = instanceIdFor("copilot", extra);
      agent.instanceLabel = basename(extra);
      if (seen.has(agent.id)) continue;
      seen.add(agent.id);
      agents.push(agent);
    }
  }

  return {
    value: agents,
    errors,
    ...(primary.absent && extraRoots.length === 0 ? { absent: true } : {}),
  };
}
