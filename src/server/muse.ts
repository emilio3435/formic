import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { EndEvidence, TokenUsage } from "../shared/types";
import { makeAgent, type ParseMetadata } from "./collectors";
import type { HumanMessageCandidate } from "./human-message";
import type { LifecycleThresholds } from "./lifecycle";
import type { CollectedAgent, CollectionResult } from "./types";

type JsonRecord = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_KINDS = new Set([
  "user_prompt_display",
  "inbox_item_queued",
  "started.prompt",
]);
const ASSISTANT_KINDS = new Set(["assistant_message_committed"]);
const TOOL_PREFIX = /^(?:assistant_tool_calls_committed|tool_result_batch_committed|tool_batch\.)/;

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

/* Muse records microseconds. A millisecond timestamp would be < 1e12 for
   years yet; treat that as already-ms so a live file that disagrees still parses. */
export function museTimestamp(value: unknown): string | undefined {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const millis = value > 10_000_000_000_000 ? value / 1_000 : value;
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

function payloadOf(row: JsonRecord): JsonRecord | undefined {
  return record(row.payload);
}

function eventOf(row: JsonRecord): JsonRecord | undefined {
  const payload = payloadOf(row);
  return record(payload?.event) ?? record(row.event);
}

function eventKind(row: JsonRecord): string | undefined {
  const event = eventOf(row);
  const payload = payloadOf(row);
  return text(event?.kind) ?? text(payload?.kind) ?? text(row.kind);
}

function eventText(row: JsonRecord): string | undefined {
  const event = eventOf(row);
  const payload = payloadOf(row);
  return text(event?.text)
    ?? text(event?.prompt)
    ?? text(event?.content)
    ?? text(payload?.text)
    ?? text(payload?.prompt);
}

function usageOf(row: JsonRecord): { input: number; output: number; cached: number } | undefined {
  const event = eventOf(row);
  const payload = payloadOf(row);
  const usage = record(event?.usage) ?? record(payload?.usage) ?? record(row.usage);
  if (!usage) return undefined;
  const input = finite(usage.input_tokens);
  const output = finite(usage.output_tokens);
  if (input === undefined && output === undefined) return undefined;
  return {
    input: input ?? 0,
    output: output ?? 0,
    cached: finite(usage.cached_tokens) ?? 0,
  };
}

function cwdOf(row: JsonRecord): string | undefined {
  const event = eventOf(row);
  const payload = payloadOf(row);
  const workspace = record(event?.workspace) ?? record(payload?.workspace);
  return text(event?.cwd)
    ?? text(payload?.cwd)
    ?? text(workspace?.path)
    ?? text(workspace?.cwd)
    ?? text(row.cwd);
}

function modelOf(row: JsonRecord): string | undefined {
  const event = eventOf(row);
  const payload = payloadOf(row);
  return text(event?.model) ?? text(payload?.model) ?? text(row.model);
}

function exitReasonOf(row: JsonRecord): string | undefined {
  const event = eventOf(row);
  const payload = payloadOf(row);
  const inner = record(payload?.record) ?? record(event?.record);
  return text(inner?.exit_reason) ?? text(event?.exit_reason) ?? text(payload?.exit_reason);
}

export function parseMuseSession(
  sourceSessionId: string,
  jsonl: string,
  meta: ParseMetadata = {},
  extras: { parentSourceSessionId?: string } = {},
): CollectedAgent | null {
  const messages: HumanMessageCandidate[] = [];
  let task: string | undefined;
  let tail: string | undefined;
  let startedAt: string | undefined;
  let updatedAt: string | undefined;
  let cwd: string | undefined;
  let model: string | undefined;
  let sessionExit = false;
  let turnComplete = false;
  let exitReason: string | undefined;
  let sessionTotal = 0;
  let sessionProcessed = 0;
  const callSizes: number[] = [];
  let sawUsage = false;

  for (const row of rowsFromJsonl(jsonl)) {
    const at = museTimestamp(row.recorded_at) ?? museTimestamp(eventOf(row)?.recorded_at);
    if (at) {
      startedAt = earlier(startedAt, at);
      updatedAt = later(updatedAt, at);
    }
    cwd ??= cwdOf(row);
    model ??= modelOf(row);
    const kind = eventKind(row);
    if (!kind) continue;

    if (USER_KINDS.has(kind)) {
      const content = eventText(row);
      if (content) {
        task ??= content;
        messages.push({ role: "user", content, timestamp: at });
      }
      turnComplete = false;
      continue;
    }
    if (ASSISTANT_KINDS.has(kind)) {
      const content = eventText(row);
      if (content) {
        tail = content;
        messages.push({ role: "assistant", content, timestamp: at });
      }
      continue;
    }
    if (kind === "model_completed") {
      const usage = usageOf(row);
      if (usage) {
        sawUsage = true;
        const consumed = usage.input + usage.output;
        sessionTotal += consumed;
        sessionProcessed += consumed + usage.cached;
        callSizes.push(consumed + usage.cached);
      }
      continue;
    }
    if (TOOL_PREFIX.test(kind)) continue;
    if (kind === "terminal") {
      turnComplete = !sessionExit;
      continue;
    }
    if (kind === "session.end" || kind === "session_end") {
      sessionExit = true;
      turnComplete = false;
      exitReason = exitReasonOf(row);
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

  const endEvidence: EndEvidence | undefined = sessionExit
    ? "session-exit"
    : turnComplete
      ? "turn-complete"
      : undefined;

  const agent = makeAgent({
    provider: "muse",
    sourceSessionId,
    cwd,
    model,
    task,
    startedAt,
    updatedAt: updatedAt ?? new Date(meta.nowMs ?? Date.now()).toISOString(),
    tokens,
    transcriptTail: tail,
    humanMessages: messages,
    parentSourceSessionId: extras.parentSourceSessionId,
    exited: sessionExit,
    endEvidence,
    meta,
    ...(sawUsage ? { callSizes } : {}),
  });
  if (sessionExit && exitReason && exitReason !== "clean") {
    agent.transcriptEndedCleanly = undefined;
  }
  return agent;
}

async function collectMuseFile(
  path: string,
  sourceSessionId: string,
  windowMs: number,
  thresholds: LifecycleThresholds | undefined,
  nowMs: number,
  parentSourceSessionId?: string,
): Promise<CollectedAgent | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  const agent = parseMuseSession(sourceSessionId, text, {
    sourcePath: path,
    nowMs,
    thresholds,
  }, { parentSourceSessionId });
  if (!agent) return undefined;
  if (nowMs - Date.parse(agent.updatedAt) > windowMs) return undefined;
  return agent;
}

async function walkDaySessions(
  dayRoot: string,
  windowMs: number,
  thresholds: LifecycleThresholds | undefined,
  nowMs: number,
  errors: string[],
): Promise<CollectedAgent[]> {
  let entries;
  try {
    entries = await readdir(dayRoot, { withFileTypes: true });
  } catch (error) {
    if (!missing(error)) errors.push(`muse ${dayRoot}: ${describe(error)}`);
    return [];
  }

  const agents: CollectedAgent[] = [];
  await Promise.all(entries.filter((entry) => entry.isDirectory() && UUID.test(entry.name)).map(async (session) => {
    const sessionRoot = join(dayRoot, session.name);
    const parentId = session.name.toLowerCase();
    const parentPath = join(sessionRoot, "session.jsonl");
    try {
      await stat(parentPath);
      const parent = await collectMuseFile(parentPath, parentId, windowMs, thresholds, nowMs);
      if (parent) agents.push(parent);
    } catch (error) {
      if (!missing(error)) errors.push(`muse ${parentPath}: ${describe(error)}`);
    }

    const childrenRoot = join(sessionRoot, "subagent");
    let children;
    try {
      children = await readdir(childrenRoot, { withFileTypes: true });
    } catch (error) {
      if (!missing(error)) errors.push(`muse ${childrenRoot}: ${describe(error)}`);
      return;
    }
    await Promise.all(children.filter((entry) => entry.isDirectory() && UUID.test(entry.name)).map(async (child) => {
      const childPath = join(childrenRoot, child.name, "session.jsonl");
      const childId = `${parentId}/${child.name.toLowerCase()}`;
      try {
        await stat(childPath);
      } catch (error) {
        if (!missing(error)) errors.push(`muse ${childPath}: ${describe(error)}`);
        return;
      }
      const collected = await collectMuseFile(
        childPath,
        childId,
        windowMs,
        thresholds,
        nowMs,
        parentId,
      );
      if (collected) agents.push(collected);
    }));
  }));
  return agents;
}

export async function collectMuseSessions(
  root: string,
  windowMs: number,
  thresholds?: LifecycleThresholds,
  nowMs = Date.now(),
): Promise<CollectionResult<CollectedAgent[]>> {
  try {
    await readdir(root);
  } catch (error) {
    if (missing(error)) return { value: [], errors: [], absent: true };
    return { value: [], errors: [`muse ${root}: ${describe(error)}`] };
  }

  const sessionsRoot = join(root, "sessions");
  let years;
  try {
    years = await readdir(sessionsRoot, { withFileTypes: true });
  } catch (error) {
    if (missing(error)) return { value: [], errors: [] };
    return { value: [], errors: [`muse ${sessionsRoot}: ${describe(error)}`] };
  }

  const errors: string[] = [];
  const agents: CollectedAgent[] = [];
  for (const year of years.filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))) {
    const yearRoot = join(sessionsRoot, year.name);
    let months;
    try {
      months = await readdir(yearRoot, { withFileTypes: true });
    } catch (error) {
      errors.push(`muse ${yearRoot}: ${describe(error)}`);
      continue;
    }
    for (const month of months.filter((entry) => entry.isDirectory() && /^\d{2}$/.test(entry.name))) {
      const monthRoot = join(yearRoot, month.name);
      let days;
      try {
        days = await readdir(monthRoot, { withFileTypes: true });
      } catch (error) {
        errors.push(`muse ${monthRoot}: ${describe(error)}`);
        continue;
      }
      for (const day of days.filter((entry) => entry.isDirectory() && /^\d{2}$/.test(entry.name))) {
        agents.push(...await walkDaySessions(join(monthRoot, day.name), windowMs, thresholds, nowMs, errors));
      }
    }
  }
  return { value: agents, errors };
}
