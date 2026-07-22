import { homedir } from "node:os";
import { basename, join } from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import type { AgentStatus, Provider, TokenUsage } from "../shared/types";
import { extractLastHumanMessage, type HumanMessageCandidate } from "./human-message";
import { MAX_TRANSCRIPT_TAIL_CHARS, type CollectedAgent, type CollectionResult } from "./types";
import { collectCursorSessions } from "./cursor";

export const DEFAULT_SESSION_WINDOW_MS = 36 * 60 * 60 * 1_000;
const fileCache = new Map<string, { mtimeMs: number; size: number; agent: CollectedAgent | null }>();

export interface ParseMetadata {
  sourcePath?: string;
  mtimeMs?: number;
  nowMs?: number;
}

type JsonRecord = Record<string, any>;

const PROVIDER_NAMES: Record<Provider, string> = {
  codex: "Codex",
  omp: "OMP",
  claude: "Claude",
  cursor: "Cursor",
};

const NON_TASK_PREFIXES = [
  /^#\s*(?:AGENTS|CLAUDE)\.md instructions\b/i,
  /^<(?:environment_context|recommended_plugins|subagent_notification|turn_aborted|permissions instructions|collaboration_mode|apps_instructions|plugins_instructions|skills_instructions)(?:\s|>)/i,
];

const CONTINUATION_ONLY = /^(?:keep going|continue|checking in|go on|resume|thanks|thank you)[.!\s]*$/i;
const TASK_BOUNDARY = /^#\s*(?:AGENTS|CLAUDE)\.md instructions\b/i;

function records(jsonl: string): JsonRecord[] {
  const parsed: JsonRecord[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object") parsed.push(value);
    } catch {
      // A partially-written final JSONL line is expected while agents are active.
    }
  }
  return parsed;
}

function isoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function plainText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (!Array.isArray(value)) return undefined;
  const text = value
    .map((part) =>
      typeof part === "string"
        ? part
        : part && typeof part === "object" && typeof part.text === "string"
          ? part.text
          : "",
    )
    .join("\n")
    .trim();
  return text || undefined;
}

function userTask(value: unknown): string | undefined {
  const raw = plainText(value);
  if (!raw) return undefined;
  const wrapped = raw.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i)?.[1]?.trim();
  let text = wrapped || raw;
  const sessionUpdate = text.match(
    /^#{1,6}\s+Session update[^\n]*\n+[\s\S]*?\*\*user\*\*:\s*([\s\S]+)$/i,
  )?.[1];
  if (sessionUpdate) text = sessionUpdate.trim();
  text = text
    .replace(/^<file name=(?:"[^"]+"|'[^']+')>\s*/i, "")
    .replace(/\s*<\/file>\s*$/i, "")
    .trim();
  if (NON_TASK_PREFIXES.some((pattern) => pattern.test(text)) || CONTINUATION_ONLY.test(text)) {
    return undefined;
  }
  return text.slice(0, 500);
}

function isTaskBoundary(value: unknown): boolean {
  const text = plainText(value);
  return Boolean(text && TASK_BOUNDARY.test(text));
}

function nextTask(current: string | undefined, value: unknown): string | undefined {
  if (isTaskBoundary(value)) return undefined;
  return current ?? userTask(value);
}

function taskDisplayName(task?: string): string | undefined {
  const lines = task
    ?.split("\n")
    .map((line) => line.trim())
    .filter((line) => Boolean(line)
      && !/^<\/?(?:file|command-name|command-message|command-args|command-contents|local-command-stdout|local-command-stderr|local-command-caveat|system-reminder)\b/i.test(line)
      && !/^\*\*user\*\*:?$/i.test(line));
  let firstLine = lines?.find((line) => /^(?:goal|mission|task|objective):\s*/i.test(line)) ?? lines?.[0];
  if (!firstLine) return undefined;
  const handoff = firstLine.indexOf("<--");
  if (handoff >= 0) firstLine = firstLine.slice(handoff + 3).trim();
  firstLine = firstLine
    .replace(/^#{1,6}\s+/, "")
    .replace(/^(?:goal|mission|task|objective):\s*/i, "")
    .replace(/^you are\s+(?:the\s+)?/i, "")
    .replace(/^[-*]\s+/, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
  if (!firstLine) return undefined;
  return firstLine.length > 100 ? `${firstLine.slice(0, 99).trimEnd()}…` : firstLine;
}

function statusFrom(updatedAt: string, exited: boolean, nowMs: number): {
  status: AgentStatus;
  reason: string;
} {
  if (exited) return { status: "archived", reason: "Source recorded a session exit." };
  const ageMs = Math.max(0, nowMs - Date.parse(updatedAt));
  if (ageMs < 3 * 60_000) return { status: "running", reason: "Source activity within 3 minutes." };
  if (ageMs < 45 * 60_000) return { status: "waiting", reason: "No source activity in the last 3 minutes." };
  return { status: "stale", reason: "No source activity in the last 45 minutes." };
}

function withCurrentStatus(agent: CollectedAgent, nowMs: number): CollectedAgent {
  if (agent.status === "archived") return agent;
  const status = statusFrom(agent.updatedAt, false, nowMs);
  return {
    ...agent,
    status: status.status,
    statusReason: status.reason,
    lastHumanMessage: agent.lastHumanMessage === agent.statusReason
      ? status.reason
      : agent.lastHumanMessage,
  };
}

function fallbackUpdatedAt(meta: ParseMetadata): string {
  return new Date(meta.mtimeMs ?? meta.nowMs ?? Date.now()).toISOString();
}

function makeAgent(input: {
  provider: Provider;
  sourceSessionId: string;
  displayName?: string;
  cwd?: string;
  model?: string;
  effort?: string;
  task?: string;
  startedAt?: string;
  updatedAt: string;
  tokens: TokenUsage;
  transcriptTail?: string;
  parentSourceSessionId?: string;
  threadDepth?: number;
  nickname?: string;
  humanMessages?: readonly HumanMessageCandidate[];
  statusReason?: string;
  exited?: boolean;
  meta: ParseMetadata;
}): CollectedAgent {
  const status = statusFrom(
    input.updatedAt,
    input.exited ?? false,
    input.meta.nowMs ?? Date.now(),
  );
  const statusReason = input.statusReason ?? status.reason;
  const cwdName = input.cwd && input.cwd.replace(/\/+$/, "") !== homedir().replace(/\/+$/, "")
    ? basename(input.cwd)
    : undefined;
  const explicitName = input.displayName?.trim();
  const usefulExplicitName = explicitName &&
    !/^Session update(?:\s*\[.*\])?$/i.test(explicitName) &&
    !/^<file name=/i.test(explicitName)
    ? explicitName
    : undefined;
  return {
    id: `${input.provider}:${input.sourceSessionId}`,
    provider: input.provider,
    sourceSessionId: input.sourceSessionId,
    displayName:
      usefulExplicitName ||
      taskDisplayName(input.task) ||
      (cwdName ? `${PROVIDER_NAMES[input.provider]} · ${cwdName}` : `${PROVIDER_NAMES[input.provider]} session`),
    cwd: input.cwd,
    model: input.model,
    effort: input.effort,
    task: input.task,
    status: status.status,
    statusReason,
    lastHumanMessage: extractLastHumanMessage(
      input.provider,
      input.humanMessages ?? [],
      input.task,
      statusReason,
    ),
    startedAt: input.startedAt,
    updatedAt: input.updatedAt,
    tokens: input.tokens,
    parentSourceSessionId: input.parentSourceSessionId,
    threadDepth: input.threadDepth,
    nickname: input.nickname,
    transcriptTail: input.transcriptTail?.slice(-MAX_TRANSCRIPT_TAIL_CHARS),
    artifacts: input.meta.sourcePath
      ? [{
          label: `${input.provider.toUpperCase()} transcript`,
          path: input.meta.sourcePath,
          kind: "transcript",
        }]
      : [],
    gates: [],
  };
}

export function parseOmpJsonl(jsonl: string, meta: ParseMetadata = {}): CollectedAgent | null {
  const rows = records(jsonl);
  const session = rows.find((row) => row.type === "session" && typeof row.id === "string");
  if (!session) return null;

  let title: string | undefined;
  let model: string | undefined;
  let task: string | undefined;
  let tail: string | undefined;
  const humanMessages: HumanMessageCandidate[] = [];
  let updatedAt = isoTimestamp(session.timestamp) ?? fallbackUpdatedAt(meta);
  let input = 0;
  let output = 0;
  let cachedInput = 0;
  let total = 0;
  let sawUsage = false;
  let exited = false;

  for (const row of rows) {
    title = row.type === "title" && typeof row.title === "string" ? row.title : title;
    model = row.type === "model_change" && typeof row.model === "string" ? row.model : model;
    exited ||= row.type === "custom" && row.data?.kind === "session_exit";
    const timestamp = isoTimestamp(row.timestamp ?? row.message?.timestamp);
    if (timestamp && timestamp > updatedAt) updatedAt = timestamp;
    if (row.type !== "message") continue;

    const text = plainText(row.message?.content);
    if (row.message?.role === "user") task = nextTask(task, row.message?.content);
    if (row.message?.role === "user" || row.message?.role === "assistant") {
      humanMessages.push({ role: row.message.role, content: row.message?.content });
    }
    if (text) tail = text;
    if (row.message?.role === "assistant") {
      model = typeof row.message?.model === "string" ? row.message.model : model;
      const usage = row.message?.usage;
      if (!usage) continue;
      sawUsage = true;
      input += Number(usage?.input ?? 0);
      output += Number(usage?.output ?? 0);
      cachedInput += Number(usage?.cacheRead ?? 0);
      total += Number(
        usage?.totalTokens ??
          Number(usage?.input ?? 0) +
            Number(usage?.output ?? 0) +
            Number(usage?.cacheRead ?? 0) +
            Number(usage?.cacheWrite ?? 0),
      );
    }
  }

  const agent = makeAgent({
    provider: "omp",
    sourceSessionId: session.id,
    displayName: title,
    cwd: typeof session.cwd === "string" ? session.cwd : undefined,
    model,
    task,
    startedAt: isoTimestamp(session.timestamp),
    updatedAt,
    tokens: {
      input,
      output,
      cachedInput,
      total,
      sessionTotal: total,
      scope: "session",
      provenance: sawUsage ? "observed" : "unknown",
    },
    transcriptTail: tail,
    humanMessages,
    statusReason: "Legacy OMP history is read-only; file timestamps are not treated as a live runtime signal.",
    exited,
    meta,
  });
  return {
    ...agent,
    status: "archived",
  };
}

export function parseCodexJsonl(jsonl: string, meta: ParseMetadata = {}): CollectedAgent | null {
  const rows = records(jsonl);
  const sessionRow = rows.find((row) => row.type === "session_meta");
  const session = sessionRow?.payload ?? sessionRow;
  const sessionId = session?.id ?? session?.session_id;
  if (typeof sessionId !== "string") return null;

  let updatedAt = isoTimestamp(sessionRow?.timestamp ?? session?.timestamp) ?? fallbackUpdatedAt(meta);
  let model = typeof session?.model === "string" ? session.model : undefined;
  let effort: string | undefined;
  let task: string | undefined;
  let tail: string | undefined;
  const humanMessages: HumanMessageCandidate[] = [];
  let tokens: TokenUsage = { provenance: "unknown" };
  const threadSpawn = session?.source?.subagent?.thread_spawn;
  const parentSourceSessionId = typeof threadSpawn?.parent_thread_id === "string"
    ? threadSpawn.parent_thread_id
    : undefined;
  const threadDepth = Number.isInteger(threadSpawn?.depth) && threadSpawn.depth >= 0
    ? threadSpawn.depth
    : undefined;
  const nickname = typeof threadSpawn?.agent_nickname === "string" && threadSpawn.agent_nickname.trim()
    ? threadSpawn.agent_nickname.trim()
    : undefined;

  for (const row of rows) {
    const timestamp = isoTimestamp(row.timestamp);
    if (timestamp && timestamp > updatedAt) updatedAt = timestamp;
    const payload = row.payload ?? row;
    if (typeof payload.effort === "string" && payload.effort.trim()) effort = payload.effort.trim();
    if (row.type === "event_msg" && payload.type === "user_message") {
      task = nextTask(task, payload.message);
      humanMessages.push({ role: "user", content: payload.message });
    }
    if (payload.type === "token_count" && payload.info?.total_token_usage) {
      const sessionUsage = payload.info.total_token_usage;
      const usage = payload.info.last_token_usage ?? sessionUsage;
      const input = Number(usage.input_tokens ?? 0);
      const sessionInput = Number(sessionUsage.input_tokens ?? 0);
      const sessionOutput = Number(sessionUsage.output_tokens ?? 0);
      // Codex reports reasoning_output_tokens as a subset of output_tokens.
      const output = Number(usage.output_tokens ?? 0);
      tokens = {
        input,
        output,
        cachedInput: Number(usage.cached_input_tokens ?? 0),
        total: Number(usage.total_tokens ?? input + output),
        sessionTotal: Number(sessionUsage.total_tokens ?? sessionInput + sessionOutput),
        contextWindow: Number(payload.info.model_context_window) || undefined,
        scope: payload.info.last_token_usage ? "latest-turn" : "session",
        provenance: "observed",
      };
    }
    if (row.type === "response_item" && payload.type === "message") {
      const text = plainText(payload.content);
      if (payload.role === "user") task = nextTask(task, payload.content);
      if (payload.role === "user" || payload.role === "assistant") {
        humanMessages.push({ role: payload.role, content: payload.content });
      }
      if (text) tail = text;
    }
    if (typeof payload.model === "string") model = payload.model;
  }

  return makeAgent({
    provider: "codex",
    sourceSessionId: sessionId,
    cwd: typeof session.cwd === "string" ? session.cwd : undefined,
    model: model ?? "gpt-5.6-sol",
    effort,
    task,
    startedAt: isoTimestamp(session.timestamp ?? sessionRow?.timestamp),
    updatedAt,
    tokens,
    parentSourceSessionId,
    threadDepth,
    nickname,
    transcriptTail: tail,
    humanMessages,
    meta,
  });
}

export function parseClaudeJsonl(jsonl: string, meta: ParseMetadata = {}): CollectedAgent | null {
  const rows = records(jsonl);
  const identity = rows.find(
    (row) => typeof row.sessionId === "string" && (typeof row.cwd === "string" || row.type === "last-prompt"),
  );
  if (!identity || typeof identity.sessionId !== "string") return null;

  let cwd = typeof identity.cwd === "string" ? identity.cwd : undefined;
  let startedAt: string | undefined;
  let updatedAt = fallbackUpdatedAt(meta);
  let model: string | undefined;
  let effort: string | undefined;
  let task: string | undefined;
  let tail: string | undefined;
  const humanMessages: HumanMessageCandidate[] = [];
  const usageByMessage = new Map<string, {
    index: number;
    input: number;
    output: number;
    cachedInput: number;
    cacheCreationInput: number;
  }>();
  let anonymousUsage = 0;

  for (const [index, row] of rows.entries()) {
    if (typeof row.cwd === "string") cwd = row.cwd;
    if (typeof row.effort === "string" && row.effort.trim()) effort = row.effort.trim();
    const timestamp = isoTimestamp(row.timestamp);
    if (timestamp) {
      startedAt ??= timestamp;
      if (timestamp > updatedAt) updatedAt = timestamp;
    }
    const text = plainText(row.message?.content);
    if (row.type === "user") {
      if (isTaskBoundary(row.message?.content)) task = undefined;
      else if (row.isMeta !== true) task = task ?? userTask(row.message?.content);
    }
    if (text) tail = text;
    if ((row.type === "user" || row.type === "assistant") &&
      (row.message?.role === "user" || row.message?.role === "assistant")) {
      humanMessages.push({
        role: row.message.role,
        content: row.message?.content,
        isMeta: row.isMeta === true,
      });
    }
    const usage = row.message?.usage;
    if (usage && row.type === "assistant") {
      model = typeof row.message.model === "string" ? row.message.model : model;
      const key = typeof row.requestId === "string"
        ? `request:${row.requestId}`
        : typeof row.message?.id === "string"
          ? `message:${row.message.id}`
          : `row:${anonymousUsage++}`;
      usageByMessage.set(key, {
        index,
        input: Number(usage.input_tokens ?? 0),
        output: Number(usage.output_tokens ?? 0),
        cachedInput: Number(usage.cache_read_input_tokens ?? 0),
        cacheCreationInput: Number(usage.cache_creation_input_tokens ?? 0),
      });
    }
  }

  const uniqueUsage = [...usageByMessage.values()].sort((left, right) => left.index - right.index);
  const latestUsage = uniqueUsage.at(-1);
  const usageTotal = (usage: NonNullable<typeof latestUsage>): number =>
    usage.input + usage.output + usage.cachedInput + usage.cacheCreationInput;
  const sessionTotal = uniqueUsage.reduce((total, usage) => total + usageTotal(usage), 0);

  return makeAgent({
    provider: "claude",
    sourceSessionId: identity.sessionId,
    cwd,
    model,
    effort,
    task,
    startedAt,
    updatedAt,
    tokens: {
      input: latestUsage?.input,
      output: latestUsage?.output,
      cachedInput: latestUsage?.cachedInput,
      // Anthropic exposes cache creation as a separate input component. The
      // shared schema has no cache-write field, so preserve raw input/cache-read
      // fields and include cache creation exactly once in the observed total.
      total: latestUsage ? usageTotal(latestUsage) : undefined,
      sessionTotal: latestUsage ? sessionTotal : undefined,
      scope: latestUsage ? "latest-turn" : "unknown",
      provenance: latestUsage ? "observed" : "unknown",
    },
    transcriptTail: tail,
    humanMessages,
    meta,
  });
}

async function recentJsonlFiles(root: string, maxDepth: number, windowMs: number): Promise<string[]> {
  const files: string[] = [];
  const nowMs = Date.now();
  async function walk(directory: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory() && depth > 0) return walk(path, depth - 1);
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) return;
        try {
          const details = await stat(path);
          if (nowMs - details.mtimeMs <= windowMs) files.push(path);
        } catch {
          // A source disappearing during a scan is harmless.
        }
      }),
    );
  }
  await walk(root, maxDepth);
  return files;
}

async function collectProvider(
  provider: Provider,
  root: string,
  depth: number,
  parser: (jsonl: string, meta: ParseMetadata) => CollectedAgent | null,
  windowMs: number,
): Promise<CollectionResult<CollectedAgent[]>> {
  const errors: string[] = [];
  const agents: CollectedAgent[] = [];
  const files = await recentJsonlFiles(root, depth, windowMs);
  await Promise.all(
    files.map(async (path) => {
      try {
        const details = await stat(path);
        const cached = fileCache.get(path);
        if (cached && cached.mtimeMs === details.mtimeMs && cached.size === details.size) {
          if (cached.agent) agents.push(withCurrentStatus(cached.agent, Date.now()));
          return;
        }
        const contents = await readFile(path, "utf8");
        const parsed = parser(contents, { sourcePath: path, mtimeMs: details.mtimeMs });
        fileCache.set(path, { mtimeMs: details.mtimeMs, size: details.size, agent: parsed });
        if (parsed) agents.push(parsed);
      } catch (error) {
        errors.push(`${provider} ${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  );
  return { value: agents, errors };
}

export async function collectSessions(
  home = homedir(),
  windowMs = DEFAULT_SESSION_WINDOW_MS,
): Promise<Record<Provider, CollectionResult<CollectedAgent[]>>> {
  const [omp, codex, claude, cursor] = await Promise.all([
    collectProvider("omp", join(home, ".omp/agent/sessions"), 2, parseOmpJsonl, windowMs),
    collectProvider("codex", join(home, ".codex/sessions"), 4, parseCodexJsonl, windowMs),
    collectProvider("claude", join(home, ".claude/projects"), 2, parseClaudeJsonl, windowMs),
    collectCursorSessions(home, Date.now(), windowMs),
  ]);
  return { omp, codex, claude, cursor };
}
