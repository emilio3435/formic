import { homedir } from "node:os";
import { basename, join } from "node:path";
import { open, readdir, stat } from "node:fs/promises";
import type { AgentStatus, Provider, TokenUsage } from "../shared/types";
import {
  extractLastHumanMessage,
  extractLastMessageByRole,
  readableHumanMessage,
  type HumanMessageCandidate,
} from "./human-message";
import { MAX_TRANSCRIPT_TAIL_CHARS, type CollectedAgent, type CollectionResult } from "./types";
import { collectCursorSessions } from "./cursor";
import { MODEL_CONFIG, type ModelConfig } from "./model-config";

export const DEFAULT_SESSION_WINDOW_MS = 36 * 60 * 60 * 1_000;
const fileCache = new Map<string, {
  provider: Provider;
  dev: number;
  ino: number;
  mtimeMs: number;
  size: number;
  remainder: Buffer;
  parser: IncrementalParser;
  agent: CollectedAgent | null;
}>();

export interface ParseMetadata {
  sourcePath?: string;
  mtimeMs?: number;
  nowMs?: number;
}

type JsonRecord = Record<string, any>;

interface IncrementalParser {
  append(rows: readonly JsonRecord[]): void;
  result(meta: ParseMetadata): CollectedAgent | null;
}

interface IndexedHumanMessage {
  index: number;
  candidate: HumanMessageCandidate;
}

interface HumanMessageWindow {
  user?: IndexedHumanMessage;
  assistant?: IndexedHumanMessage;
}

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

function recordHumanMessage(
  provider: Provider,
  window: HumanMessageWindow,
  candidate: HumanMessageCandidate,
  index: number,
): void {
  if (candidate.isMeta || !readableHumanMessage(provider, candidate.content)) return;
  window[candidate.role] = { index, candidate };
}

function humanMessages(window: HumanMessageWindow): HumanMessageCandidate[] {
  return [window.user, window.assistant]
    .filter((message): message is IndexedHumanMessage => Boolean(message))
    .sort((left, right) => left.index - right.index)
    .map(({ candidate }) => candidate);
}

function parserFor(
  provider: Provider,
  parser: (jsonl: string, meta: ParseMetadata) => CollectedAgent | null,
): IncrementalParser {
  if (provider === "omp") return createOmpParser();
  if (provider === "codex") return createCodexParser();
  if (provider === "claude") return createClaudeParser();
  throw new Error(`incremental parser unavailable for ${provider}: ${parser.name}`);
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
  runtimeSessionId?: string;
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
  const normalizedCwd = input.cwd?.replace(/\/+$/, "");
  const atHome = Boolean(normalizedCwd && normalizedCwd === homedir().replace(/\/+$/, ""));
  const cwdName = normalizedCwd && !atHome ? basename(normalizedCwd) : undefined;
  const cwdIdentity = cwdName
    ? `${PROVIDER_NAMES[input.provider]} · ${cwdName}`
    : atHome
      ? `${PROVIDER_NAMES[input.provider]} · Home`
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
    runtimeSessionId: input.runtimeSessionId,
    // Identity first (folder / Home), task second. The prompt belongs in the
    // message lane — not as the agent/terminal name operators hunt for in cmux.
    displayName:
      usefulExplicitName ||
      cwdIdentity ||
      taskDisplayName(input.task) ||
      `${PROVIDER_NAMES[input.provider]} session`,
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
    lastUserMessage: extractLastMessageByRole(input.provider, input.humanMessages ?? [], "user"),
    lastAgentMessage: extractLastMessageByRole(input.provider, input.humanMessages ?? [], "assistant"),
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
    transcriptEndedCleanly: input.exited === true || undefined,
  };
}

function createOmpParser(): IncrementalParser {
  let session: JsonRecord | undefined;
  let title: string | undefined;
  let model: string | undefined;
  let task: string | undefined;
  let tail: string | undefined;
  const messages: HumanMessageWindow = {};
  let updatedAt: string | undefined;
  let latestUsage: { input: number; output: number; cachedInput: number; total: number } | undefined;
  let sessionTotal = 0;
  let exited = false;
  let index = 0;

  return {
    append(rows) {
      for (const row of rows) {
        const rowIndex = index++;
        if (!session && row.type === "session" && typeof row.id === "string") session = row;
        title = row.type === "title" && typeof row.title === "string" ? row.title : title;
        model = row.type === "model_change" && typeof row.model === "string" ? row.model : model;
        exited ||= row.type === "custom" && row.data?.kind === "session_exit";
        const timestamp = isoTimestamp(row.timestamp ?? row.message?.timestamp);
        if (timestamp && (!updatedAt || timestamp > updatedAt)) updatedAt = timestamp;
        if (row.type !== "message") continue;

        const text = plainText(row.message?.content);
        if (row.message?.role === "user") task = nextTask(task, row.message?.content);
        if (row.message?.role === "user" || row.message?.role === "assistant") {
          recordHumanMessage("omp", messages, {
            role: row.message.role,
            content: row.message?.content,
          }, rowIndex);
        }
        if (text) tail = text;
        if (row.message?.role !== "assistant") continue;
        model = typeof row.message?.model === "string" ? row.message.model : model;
        const usage = row.message?.usage;
        if (!usage) continue;
        const input = Number(usage.input ?? 0);
        const output = Number(usage.output ?? 0);
        const cachedInput = Number(usage.cacheRead ?? 0);
        const cacheWrite = Number(usage.cacheWrite ?? 0);
        const total = Number(usage.totalTokens ?? input + output + cachedInput + cacheWrite);
        if (![input, output, cachedInput, total].every(Number.isFinite)) continue;
        latestUsage = { input, output, cachedInput, total };
        sessionTotal += total;
      }
    },
    result(meta) {
      if (!session) return null;
      const agent = makeAgent({
        provider: "omp",
        sourceSessionId: session.id,
        displayName: title,
        cwd: typeof session.cwd === "string" ? session.cwd : undefined,
        model,
        task,
        startedAt: isoTimestamp(session.timestamp),
        updatedAt: updatedAt ?? isoTimestamp(session.timestamp) ?? fallbackUpdatedAt(meta),
        tokens: latestUsage
          ? { ...latestUsage, sessionTotal, scope: "latest-turn", provenance: "observed" }
          : { scope: "unknown", provenance: "unknown" },
        transcriptTail: tail,
        humanMessages: humanMessages(messages),
        statusReason: "Legacy OMP history is read-only; file timestamps are not treated as a live runtime signal.",
        exited,
        meta,
      });
      return { ...agent, status: "archived" };
    },
  };
}

export function parseOmpJsonl(jsonl: string, meta: ParseMetadata = {}): CollectedAgent | null {
  const parser = createOmpParser();
  parser.append(records(jsonl));
  return parser.result(meta);
}

function createCodexParser(): IncrementalParser {
  let sessionRow: JsonRecord | undefined;
  let updatedAt: string | undefined;
  let model: string | undefined;
  let effort: string | undefined;
  let task: string | undefined;
  let tail: string | undefined;
  const messages: HumanMessageWindow = {};
  let tokens: TokenUsage = { provenance: "unknown" };
  let exited = false;
  let index = 0;

  return {
    append(rows) {
      for (const row of rows) {
        const rowIndex = index++;
        if (!sessionRow && row.type === "session_meta") sessionRow = row;
        const timestamp = isoTimestamp(row.timestamp);
        if (timestamp && (!updatedAt || timestamp > updatedAt)) updatedAt = timestamp;
        const payload = row.payload ?? row;
        if (typeof payload.effort === "string" && payload.effort.trim()) effort = payload.effort.trim();
        if (row.type === "event_msg" && payload.type === "user_message") {
          exited = false;
          task = nextTask(task, payload.message);
          recordHumanMessage("codex", messages, { role: "user", content: payload.message }, rowIndex);
        }
        if (row.type === "event_msg" && payload.type === "task_complete") exited = true;
        if (payload.type === "token_count" && payload.info?.total_token_usage) {
          const sessionUsage = payload.info.total_token_usage;
          const usage = payload.info.last_token_usage ?? sessionUsage;
          const input = Number(usage.input_tokens ?? 0);
          const sessionInput = Number(sessionUsage.input_tokens ?? 0);
          const sessionOutput = Number(sessionUsage.output_tokens ?? 0);
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
          if (payload.role === "user") {
            exited = false;
            task = nextTask(task, payload.content);
          }
          if (payload.role === "user" || payload.role === "assistant") {
            recordHumanMessage("codex", messages, {
              role: payload.role,
              content: payload.content,
            }, rowIndex);
          }
          if (text) tail = text;
        }
        if (typeof payload.model === "string") model = payload.model;
      }
    },
    result(meta) {
      const session = sessionRow?.payload ?? sessionRow;
      const sessionId = session?.id ?? session?.session_id;
      if (typeof sessionId !== "string") return null;
      const threadSpawn = session?.source?.subagent?.thread_spawn;
      const parentSourceSessionId = typeof threadSpawn?.parent_thread_id === "string"
        ? threadSpawn.parent_thread_id
        : typeof session?.parent_thread_id === "string"
          ? session.parent_thread_id
          : undefined;
      const threadDepth = Number.isInteger(threadSpawn?.depth) && threadSpawn.depth >= 0
        ? threadSpawn.depth
        : undefined;
      const nickname = typeof threadSpawn?.agent_nickname === "string" && threadSpawn.agent_nickname.trim()
        ? threadSpawn.agent_nickname.trim()
        : undefined;
      return makeAgent({
        provider: "codex",
        sourceSessionId: sessionId,
        cwd: typeof session.cwd === "string" ? session.cwd : undefined,
        model: model ?? (typeof session.model === "string" ? session.model : undefined),
        effort,
        task,
        startedAt: isoTimestamp(session.timestamp ?? sessionRow?.timestamp),
        updatedAt: updatedAt ?? isoTimestamp(sessionRow?.timestamp ?? session?.timestamp) ?? fallbackUpdatedAt(meta),
        tokens,
        parentSourceSessionId,
        threadDepth,
        nickname,
        transcriptTail: tail,
        humanMessages: humanMessages(messages),
        exited,
        meta,
      });
    },
  };
}

export function parseCodexJsonl(jsonl: string, meta: ParseMetadata = {}): CollectedAgent | null {
  const parser = createCodexParser();
  parser.append(records(jsonl));
  return parser.result(meta);
}

// Anthropic transcripts do not record the context-window size the way Codex
// exposes `model_context_window`. Derive it from the model id for models whose
// window is known in this deployment; leave undefined otherwise so the UI falls
// back to an honest observed-token count instead of a fabricated percentage.
// Opus 4.8, Sonnet 5, and Fable 5 run the 1M-token context here.
export function claudeContextWindow(
  model: string | undefined,
  config: ModelConfig = MODEL_CONFIG,
): number | undefined {
  if (!model) return undefined;
  const id = model.toLowerCase();
  // Ground truth first: if the model id ever carries an explicit 1M-context
  // marker (e.g. "claude-opus-4-8[1m]"), honor it directly regardless of the
  // table. This is absent from transcripts today, but costs nothing and gives
  // free per-session accuracy if Anthropic ever stamps the beta into message.model.
  if (id.includes("[1m]")) return 1_000_000;
  for (const [needle, window] of Object.entries(config.claudeContextWindows)) {
    if (id.includes(needle)) return window;
  }
  return undefined;
}

function createClaudeParser(): IncrementalParser {
  let identity: JsonRecord | undefined;
  let cwd: string | undefined;
  let startedAt: string | undefined;
  let updatedAt: string | undefined;
  let model: string | undefined;
  let effort: string | undefined;
  let runtimeSessionId: string | undefined;
  let task: string | undefined;
  let tail: string | undefined;
  const messages: HumanMessageWindow = {};
  const usageByMessage = new Map<string, {
    index: number;
    input: number;
    output: number;
    cachedInput: number;
    cacheCreationInput: number;
  }>();
  let anonymousUsage = 0;
  let exited = false;
  let index = 0;

  return {
    append(rows) {
      for (const row of rows) {
        const rowIndex = index++;
        if (!identity && typeof row.sessionId === "string" &&
          (typeof row.cwd === "string" || row.type === "last-prompt")) {
          identity = row;
        }
        if (typeof row.cwd === "string") cwd = row.cwd;
        if (
          typeof row.session_id === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.session_id)
        ) {
          runtimeSessionId = row.session_id.toLowerCase();
        }
        if (typeof row.effort === "string" && row.effort.trim()) effort = row.effort.trim();
        const timestamp = isoTimestamp(row.timestamp);
        if (timestamp) {
          startedAt ??= timestamp;
          if (!updatedAt || timestamp > updatedAt) updatedAt = timestamp;
        }
        const text = plainText(row.message?.content);
        if (row.type === "user") {
          if (row.isMeta !== true) exited = false;
          if (isTaskBoundary(row.message?.content)) task = undefined;
          else if (row.isMeta !== true) task = task ?? userTask(row.message?.content);
        }
        if (row.type === "assistant" && row.message?.stop_reason === "end_turn") exited = true;
        if (text) tail = text;
        if ((row.type === "user" || row.type === "assistant") &&
          (row.message?.role === "user" || row.message?.role === "assistant")) {
          recordHumanMessage("claude", messages, {
            role: row.message.role,
            content: row.message?.content,
            isMeta: row.isMeta === true,
          }, rowIndex);
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
            index: rowIndex,
            input: Number(usage.input_tokens ?? 0),
            output: Number(usage.output_tokens ?? 0),
            cachedInput: Number(usage.cache_read_input_tokens ?? 0),
            cacheCreationInput: Number(usage.cache_creation_input_tokens ?? 0),
          });
        }
      }
    },
    result(meta) {
      if (!identity || typeof identity.sessionId !== "string") return null;
      const fallback = fallbackUpdatedAt(meta);
      const uniqueUsage = [...usageByMessage.values()].sort((left, right) => left.index - right.index);
      const latestUsage = uniqueUsage.at(-1);
      const usageTotal = (usage: NonNullable<typeof latestUsage>): number =>
        usage.input + usage.output + usage.cachedInput + usage.cacheCreationInput;
      const sessionTotal = uniqueUsage.reduce((total, usage) => total + usageTotal(usage), 0);
      return makeAgent({
        provider: "claude",
        sourceSessionId: identity.sessionId,
        runtimeSessionId,
        cwd,
        model,
        effort,
        task,
        startedAt,
        updatedAt: updatedAt && updatedAt > fallback ? updatedAt : fallback,
        tokens: latestUsage
          ? {
              input: latestUsage.input,
              output: latestUsage.output,
              cachedInput: latestUsage.cachedInput,
              total: usageTotal(latestUsage),
              sessionTotal,
              contextWindow: claudeContextWindow(model),
              scope: "latest-turn",
              provenance: "observed",
            }
          : { scope: "unknown", provenance: "unknown" },
        transcriptTail: tail,
        humanMessages: humanMessages(messages),
        exited,
        meta,
      });
    },
  };
}

export function parseClaudeJsonl(jsonl: string, meta: ParseMetadata = {}): CollectedAgent | null {
  const parser = createClaudeParser();
  parser.append(records(jsonl));
  return parser.result(meta);
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

function completeJsonRecords(buffer: Buffer): { rows: JsonRecord[]; remainder: Buffer } {
  const newline = buffer.lastIndexOf(0x0a);
  if (newline < 0) return { rows: [], remainder: Buffer.from(buffer) };
  return {
    rows: records(buffer.subarray(0, newline + 1).toString("utf8")),
    remainder: Buffer.from(buffer.subarray(newline + 1)),
  };
}

async function readFileRange(path: string, offset: number, length: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    let bytesRead = 0;
    while (bytesRead < length) {
      const read = await handle.read(buffer, bytesRead, length - bytesRead, offset + bytesRead);
      if (read.bytesRead === 0) break;
      bytesRead += read.bytesRead;
    }
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function retainProcessEvidence(
  agent: CollectedAgent | null,
  previous: CollectedAgent | null | undefined,
): CollectedAgent | null {
  if (!agent || !previous?.processIds?.length) return agent;
  return {
    ...agent,
    processIds: [...previous.processIds],
    processAlive: previous.processAlive,
    transcriptOpen: previous.transcriptOpen,
  };
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
  const currentPaths = new Set(files);
  for (const [path, cached] of fileCache) {
    if (cached.provider === provider && !currentPaths.has(path)) fileCache.delete(path);
  }
  await Promise.all(
    files.map(async (path) => {
      try {
        let details = await stat(path);
        const cached = fileCache.get(path);
        if (cached &&
          cached.dev === details.dev &&
          cached.ino === details.ino &&
          cached.mtimeMs === details.mtimeMs &&
          cached.size === details.size) {
          if (cached.agent) agents.push(withCurrentStatus(cached.agent, Date.now()));
          return;
        }
        const canAppend = cached &&
          cached.provider === provider &&
          cached.dev === details.dev &&
          cached.ino === details.ino &&
          details.size > cached.size;
        const incremental = canAppend ? cached.parser : parserFor(provider, parser);
        const offset = canAppend ? cached.size : 0;
        const prefix = canAppend ? cached.remainder : Buffer.alloc(0);
        let chunk = await readFileRange(path, offset, details.size - offset);
        let after = await stat(path);
        if (after.dev !== details.dev || after.ino !== details.ino ||
          after.size !== details.size || after.mtimeMs !== details.mtimeMs) {
          details = after;
          chunk = await readFileRange(path, 0, details.size);
          after = await stat(path);
          if (after.dev !== details.dev || after.ino !== details.ino ||
            after.size !== details.size || after.mtimeMs !== details.mtimeMs) {
            throw new Error("transcript changed during collection");
          }
          const reset = parserFor(provider, parser);
          const complete = completeJsonRecords(chunk);
          reset.append(complete.rows);
          const parsed = reset.result({ sourcePath: path, mtimeMs: details.mtimeMs });
          fileCache.set(path, {
            provider,
            dev: details.dev,
            ino: details.ino,
            mtimeMs: details.mtimeMs,
            size: details.size,
            remainder: complete.remainder,
            parser: reset,
            agent: parsed,
          });
          if (parsed) agents.push(parsed);
          return;
        }
        const complete = completeJsonRecords(Buffer.concat([prefix, chunk]));
        incremental.append(complete.rows);
        const parsed = retainProcessEvidence(
          incremental.result({ sourcePath: path, mtimeMs: details.mtimeMs }),
          canAppend ? cached.agent : undefined,
        );
        fileCache.set(path, {
          provider,
          dev: details.dev,
          ino: details.ino,
          mtimeMs: details.mtimeMs,
          size: details.size,
          remainder: complete.remainder,
          parser: incremental,
          agent: parsed,
        });
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
