import { createReadStream } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import type { TokenUsage } from "../shared/types";
import { instanceIdFor, readTextCappedSync } from "./collector-instances";
import { claudeContextWindow, makeAgent, type ParseMetadata } from "./collectors";
import type { HumanMessageCandidate } from "./human-message";
import type { LifecycleThresholds } from "./lifecycle";
import { MAX_TRANSCRIPT_TAIL_CHARS, type CollectedAgent, type CollectionResult } from "./types";

type JsonRecord = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT_ID = /^(?:[a-f0-9]{64}|[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const SESSION_FILE = /^session-.*\.(?:json|jsonl)$/;
const MAX_MESSAGE_CHARS = 6_000;
const MAX_PROJECT_ROOT_CHARS = 4_096;
const MAX_PUBLISHED_MESSAGES = 512;
/* Gemini CLI publishes no enforced read-size ceiling at the pinned source.
   These are Formic-local safety bounds, surfaced as partial/error evidence. */
export const MAX_GEMINI_RECORD_BYTES = 8 * 1024 * 1024;
export const MAX_GEMINI_REPLAY_MESSAGES = 4_096;
export const MAX_GEMINI_REPLAY_BYTES = 16 * 1024 * 1024;

export interface GeminiConversation {
  metadata: JsonRecord;
  messages: JsonRecord[];
  firstUserMessage?: JsonRecord;
  partial?: boolean;
  warnings?: string[];
}

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function bounded(value: string): string {
  if (value.length <= MAX_MESSAGE_CHARS) return value;
  const side = Math.floor((MAX_MESSAGE_CHARS - 7) / 2);
  return `${value.slice(0, side)}\n[…]\n${value.slice(-side)}`;
}

function contentText(value: unknown): string | undefined {
  if (typeof value === "string") return text(bounded(value));
  if (!Array.isArray(value)) return undefined;
  const side = Math.floor((MAX_MESSAGE_CHARS - 7) / 2);
  let exact = "";
  let prefix = "";
  let suffix = "";
  let overflow = false;
  let seen = false;
  for (const part of value) {
    const item = record(part);
    const candidate = typeof part === "string"
      ? part
      : typeof item?.text === "string"
        ? item.text
        : undefined;
    if (!candidate) continue;
    const segment = `${seen ? "\n" : ""}${candidate}`;
    seen = true;
    if (!overflow && exact.length + segment.length <= MAX_MESSAGE_CHARS) exact += segment;
    else overflow = true;
    if (prefix.length < side) prefix += segment.slice(0, side - prefix.length);
    suffix = `${suffix}${segment}`.slice(-side);
  }
  const joined = (overflow ? `${prefix}\n[…]\n${suffix}` : exact).trim();
  return joined || undefined;
}

function iso(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function later(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(right) > Date.parse(left) ? right : left;
}

function missing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function checkAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error("Gemini collection cancelled");
}

function boundedString(value: unknown): string | undefined {
  const valueText = text(value);
  return valueText ? bounded(valueText) : undefined;
}

function metadataFields(value: unknown, identityRequired: boolean): JsonRecord | undefined {
  const row = record(value);
  if (!row) return undefined;
  const sessionId = text(row.sessionId);
  const projectHash = text(row.projectHash);
  if (identityRequired && (!sessionId || !UUID.test(sessionId) || !projectHash || !PROJECT_ID.test(projectHash))) {
    return undefined;
  }
  const metadata: JsonRecord = {};
  if (sessionId && UUID.test(sessionId)) metadata.sessionId = sessionId.toLowerCase();
  if (projectHash && PROJECT_ID.test(projectHash)) metadata.projectHash = projectHash;
  const startTime = boundedString(row.startTime);
  const lastUpdated = boundedString(row.lastUpdated);
  const kind = boundedString(row.kind);
  const summary = boundedString(row.summary);
  if (startTime) metadata.startTime = startTime;
  if (lastUpdated) metadata.lastUpdated = lastUpdated;
  if (kind) metadata.kind = kind;
  if (summary) metadata.summary = summary;
  return metadata;
}

function partialMetadata(value: unknown): JsonRecord | undefined {
  return metadataFields(value, true);
}

function projectedContent(value: unknown): unknown {
  const content = contentText(value);
  if (!content) return undefined;
  return typeof value === "string" ? content : [{ text: content }];
}

function projectedThoughts(value: unknown): JsonRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const thoughts = value.flatMap((candidate) => {
    const thought = record(candidate);
    if (!thought) return [];
    const projected: JsonRecord = {};
    const subject = boundedString(thought.subject);
    const description = boundedString(thought.description);
    const timestamp = text(thought.timestamp);
    if (subject) projected.subject = subject;
    if (description) projected.description = description;
    if (timestamp) projected.timestamp = timestamp;
    return Object.keys(projected).length > 0 ? [projected] : [];
  });
  return thoughts.length > 0 ? thoughts : undefined;
}

function projectedTools(value: unknown): JsonRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tools = value.flatMap((candidate) => {
    const tool = record(candidate);
    if (!tool) return [];
    const projected: JsonRecord = {};
    for (const key of ["id", "name", "status", "timestamp"] as const) {
      const field = boundedString(tool[key]);
      if (field) projected[key] = field;
    }
    return Object.keys(projected).length > 0 ? [projected] : [];
  });
  return tools.length > 0 ? tools : undefined;
}

function projectedTokens(value: unknown): JsonRecord | undefined {
  const tokens = record(value);
  if (!tokens) return undefined;
  const projected: JsonRecord = {};
  for (const key of ["input", "output", "cached", "thoughts", "tool", "total"] as const) {
    if (typeof tokens[key] === "number" && Number.isFinite(tokens[key])) projected[key] = tokens[key];
  }
  return Object.keys(projected).length > 0 ? projected : undefined;
}

function messageRecord(value: unknown): JsonRecord | undefined {
  const row = record(value);
  const id = text(row?.id);
  if (!row || !id) return undefined;
  const message: JsonRecord = { id: bounded(id) };
  const timestamp = boundedString(row.timestamp);
  const type = boundedString(row.type);
  const model = boundedString(row.model);
  const content = projectedContent(row.content);
  const thoughts = projectedThoughts(row.thoughts);
  const toolCalls = projectedTools(row.toolCalls);
  const tokens = projectedTokens(row.tokens);
  if (timestamp) message.timestamp = timestamp;
  if (type) message.type = type;
  if (model) message.model = model;
  if (content !== undefined) message.content = content;
  if (thoughts) message.thoughts = thoughts;
  if (toolCalls) message.toolCalls = toolCalls;
  if (tokens) message.tokens = tokens;
  return message;
}

export class GeminiReplay {
  #metadata: JsonRecord | undefined;
  #messages: JsonRecord[] = [];
  #messageSizes: number[] = [];
  #retainedBytes = 0;
  #firstUserMessage: JsonRecord | undefined;
  #partial = false;
  #warnings: string[] = [];

  #sizeOf(message: JsonRecord): number {
    return Buffer.byteLength(JSON.stringify(message));
  }

  markPartial(warning: string): void {
    this.#partial = true;
    if (!this.#warnings.includes(warning)) this.#warnings.push(warning);
  }

  #rememberFirstUser(message: JsonRecord): void {
    if (this.#firstUserMessage || text(message.type) !== "user") return;
    const content = contentText(message.content);
    if (content && !ignoredUserContent(content)) this.#firstUserMessage = message;
  }

  #recomputeFirstUser(): void {
    this.#firstUserMessage = undefined;
    for (const message of this.#messages) {
      this.#rememberFirstUser(message);
      if (this.#firstUserMessage) break;
    }
  }

  #trim(): void {
    const countLimited = this.#messages.length > MAX_GEMINI_REPLAY_MESSAGES;
    const bytesLimited = this.#retainedBytes > MAX_GEMINI_REPLAY_BYTES;
    if (!countLimited && !bytesLimited) return;
    const targetMessages = countLimited
      ? Math.floor(MAX_GEMINI_REPLAY_MESSAGES * 0.75)
      : MAX_GEMINI_REPLAY_MESSAGES;
    const targetBytes = bytesLimited
      ? Math.floor(MAX_GEMINI_REPLAY_BYTES * 0.75)
      : MAX_GEMINI_REPLAY_BYTES;
    let removeCount = 0;
    while (this.#messages.length - removeCount > targetMessages
      || this.#retainedBytes > targetBytes) {
      this.#retainedBytes -= this.#messageSizes[removeCount] ?? 0;
      removeCount += 1;
    }
    this.#messages.splice(0, removeCount);
    this.#messageSizes.splice(0, removeCount);
    if (countLimited) {
      this.markPartial(`Gemini replay retained only the newest ${MAX_GEMINI_REPLAY_MESSAGES} messages`);
    }
    if (bytesLimited) {
      this.markPartial(`Gemini replay retained only the newest messages within ${MAX_GEMINI_REPLAY_BYTES} byte cap`);
    }
  }

  #replaceMessages(values: readonly unknown[]): void {
    this.#firstUserMessage = undefined;
    this.#messages = [];
    this.#messageSizes = [];
    this.#retainedBytes = 0;
    for (const value of values) {
      const parsed = messageRecord(value);
      if (parsed) {
        const size = this.#sizeOf(parsed);
        this.#rememberFirstUser(parsed);
        this.#messages.push(parsed);
        this.#messageSizes.push(size);
        this.#retainedBytes += size;
        this.#trim();
      }
    }
  }

  append(value: unknown): void {
    const row = record(value);
    if (!row) return;
    const metadata = partialMetadata(row);
    if (metadata) {
      this.#metadata = { ...this.#metadata, ...metadata };
      return;
    }
    const set = record(row.$set);
    if (set) {
      const patch = metadataFields(set, false);
      this.#metadata = this.#metadata && patch ? { ...this.#metadata, ...patch } : this.#metadata;
      if (Array.isArray(set.messages)) {
        this.#replaceMessages(set.messages);
      }
      return;
    }
    const rewindTo = text(row.$rewindTo);
    if (rewindTo) {
      const cachedFirstWasRetained = this.#firstUserMessage !== undefined
        && this.#messages.includes(this.#firstUserMessage);
      const index = this.#messages.findIndex((message) => text(message.id) === rewindTo);
      if (index >= 0) {
        this.#messages = this.#messages.slice(0, index);
        this.#messageSizes = this.#messageSizes.slice(0, index);
        this.#retainedBytes = this.#messageSizes.reduce((sum, size) => sum + size, 0);
        if (cachedFirstWasRetained) this.#recomputeFirstUser();
      } else if (this.#partial) {
        this.#messages = [];
        this.#messageSizes = [];
        this.#retainedBytes = 0;
        if (cachedFirstWasRetained) this.#recomputeFirstUser();
        this.markPartial(`Gemini rewind target ${bounded(rewindTo)} was outside retained replay state`);
      }
      return;
    }
    const message = messageRecord(row);
    if (!message) return;
    this.#rememberFirstUser(message);
    const index = this.#messages.findIndex((candidate) => candidate.id === message.id);
    const replacesRetainedFirst = index >= 0 && this.#messages[index] === this.#firstUserMessage;
    const size = this.#sizeOf(message);
    if (index >= 0) {
      this.#retainedBytes = this.#retainedBytes - (this.#messageSizes[index] ?? 0) + size;
      this.#messages[index] = message;
      this.#messageSizes[index] = size;
      if (replacesRetainedFirst) this.#recomputeFirstUser();
    } else {
      this.#messages.push(message);
      this.#messageSizes.push(size);
      this.#retainedBytes += size;
    }
    this.#trim();
  }

  conversation(): GeminiConversation | null {
    const sessionId = text(this.#metadata?.sessionId);
    const projectHash = text(this.#metadata?.projectHash);
    if (!this.#metadata || !sessionId || !UUID.test(sessionId) || !projectHash || !PROJECT_ID.test(projectHash)) {
      return null;
    }
    return {
      metadata: { ...this.#metadata },
      messages: [...this.#messages],
      ...(this.#firstUserMessage ? { firstUserMessage: { ...this.#firstUserMessage } } : {}),
      ...(this.#partial ? { partial: true } : {}),
      ...(this.#warnings.length > 0 ? { warnings: [...this.#warnings] } : {}),
    };
  }
}

function replayJsonlText(jsonl: string): GeminiConversation | null {
  const replay = new GeminiReplay();
  let start = 0;
  while (start <= jsonl.length) {
    const newline = jsonl.indexOf("\n", start);
    const end = newline < 0 ? jsonl.length : newline;
    const line = jsonl.slice(start, end);
    if (Buffer.byteLength(line) > MAX_GEMINI_RECORD_BYTES) {
      replay.markPartial(`Gemini JSONL record exceeds ${MAX_GEMINI_RECORD_BYTES} byte cap and was skipped`);
    } else if (line.trim()) {
      try {
        const row = record(JSON.parse(line));
        if (row) replay.append(row);
      } catch {
        // Active files may end in a partial line; malformed records do not erase valid neighbors.
      }
    }
    if (newline < 0) break;
    start = newline + 1;
  }
  return replay.conversation();
}

function legacyConversation(value: unknown): GeminiConversation | null {
  const row = record(value);
  const metadata = partialMetadata(value);
  if (!row || !metadata || !Array.isArray(row.messages)) return null;
  const replay = new GeminiReplay();
  replay.append(metadata);
  replay.append({ $set: { messages: row.messages } });
  return replay.conversation();
}

export function replayGeminiText(contents: string): GeminiConversation | null {
  try {
    const legacy = legacyConversation(JSON.parse(contents));
    if (legacy) return legacy;
  } catch {
    // JSONL is not one JSON document; replay complete records below.
  }
  return replayJsonlText(contents);
}

function ignoredUserContent(content: string): boolean {
  return /^\s*\//.test(content);
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function tokensOf(message: JsonRecord): {
  input: number;
  output: number;
  cached: number;
  total: number;
} | undefined {
  const tokens = record(message.tokens);
  if (!tokens) return undefined;
  const input = finite(tokens.input);
  const output = finite(tokens.output);
  const cached = finite(tokens.cached);
  const total = finite(tokens.total);
  if (input === undefined || output === undefined || cached === undefined || total === undefined) return undefined;
  return { input, output, cached, total };
}

function eventTimestamp(message: JsonRecord): string | undefined {
  let latest = iso(message.timestamp);
  if (Array.isArray(message.thoughts)) {
    for (const thought of message.thoughts) latest = later(latest, iso(record(thought)?.timestamp));
  }
  if (Array.isArray(message.toolCalls)) {
    for (const tool of message.toolCalls) latest = later(latest, iso(record(tool)?.timestamp));
  }
  return latest;
}

function conversationAgent(
  conversation: GeminiConversation,
  meta: ParseMetadata,
  extras: { cwd?: string; parentSourceSessionId?: string } = {},
): CollectedAgent | null {
  const sourceSessionId = text(conversation.metadata.sessionId);
  if (!sourceSessionId || !UUID.test(sourceSessionId)) return null;
  const messages: HumanMessageCandidate[] = [];
  const firstUserContent = contentText(conversation.firstUserMessage?.content);
  let task = firstUserContent && !ignoredUserContent(firstUserContent)
    ? firstUserContent.slice(0, 500)
    : undefined;
  let model: string | undefined;
  let latestTokens: ReturnType<typeof tokensOf>;
  let updatedFromMessages: string | undefined;
  let lastThreadAt: string | undefined;
  const callSizes: number[] = [];
  let transcriptTail: string | undefined;
  let resumable = Boolean(task);

  const pushPublishedMessage = (message: HumanMessageCandidate): void => {
    if (messages.length >= MAX_PUBLISHED_MESSAGES) messages.shift();
    messages.push(message);
  };

  for (const message of conversation.messages) {
    const type = text(message.type);
    const content = contentText(message.content);
    const timestamp = iso(message.timestamp);
    updatedFromMessages = later(updatedFromMessages, timestamp);
    lastThreadAt = later(lastThreadAt, eventTimestamp(message));
    if (type && content) {
      transcriptTail = `${transcriptTail ? `${transcriptTail}\n` : ""}${type}: ${content}`
        .slice(-MAX_TRANSCRIPT_TAIL_CHARS);
    }

    if (type === "user" && content && !ignoredUserContent(content)) {
      resumable = true;
      task ??= content.slice(0, 500);
      pushPublishedMessage({ role: "user", content, timestamp });
      continue;
    }
    if (type !== "gemini") continue;
    const hasTools = Array.isArray(message.toolCalls) && message.toolCalls.length > 0;
    const hasThoughts = Array.isArray(message.thoughts) && message.thoughts.length > 0;
    if (content || hasTools || hasThoughts) resumable = true;
    if (content) pushPublishedMessage({ role: "assistant", content, timestamp });
    model = text(message.model) ?? model;
    const usage = tokensOf(message);
    if (usage) {
      latestTokens = usage;
      if (callSizes.length >= MAX_PUBLISHED_MESSAGES) callSizes.shift();
      callSizes.push(usage.total);
    }
  }
  if (!resumable) return null;

  const contextWindow = claudeContextWindow(model);
  const tokens: TokenUsage = latestTokens
    ? {
        input: latestTokens.input,
        output: latestTokens.output,
        cachedInput: latestTokens.cached,
        total: latestTokens.total,
        ...(contextWindow !== undefined ? { contextWindow } : {}),
        scope: "latest-turn",
        provenance: "observed",
      }
    : {
        ...(contextWindow !== undefined ? { contextWindow } : {}),
        scope: "unknown",
        provenance: "unknown",
      };
  const summary = text(conversation.metadata.summary);
  const startedAt = iso(conversation.metadata.startTime);
  const updatedAt = iso(conversation.metadata.lastUpdated)
    ?? updatedFromMessages
    ?? new Date(meta.mtimeMs ?? meta.nowMs ?? Date.now()).toISOString();
  const agent = makeAgent({
    provider: "gemini",
    sourceSessionId,
    displayName: summary,
    cwd: extras.cwd,
    originCwd: extras.cwd,
    model,
    task,
    taskBeforeOriginCwd: true,
    startedAt,
    updatedAt,
    tokens,
    transcriptTail,
    parentSourceSessionId: extras.parentSourceSessionId,
    humanMessages: messages,
    thread: { lastThreadAt },
    meta,
    ...(callSizes.length > 0 ? { callSizes } : {}),
  });
  if (summary) {
    agent.displayName = agent.identity?.name ?? summary;
  } else if (task) {
    agent.displayName = agent.identity?.name ?? task;
  } else {
    const fallback = `Gemini · ${sourceSessionId.slice(0, 8)}`;
    agent.displayName = fallback;
    agent.identity = { name: fallback, base: fallback, source: "provider-fallback" };
  }
  agent.allowCwdFallback = false;
  return agent;
}

export function parseGeminiJsonl(
  jsonl: string,
  meta: ParseMetadata = {},
  extras: { cwd?: string; parentSourceSessionId?: string } = {},
): CollectedAgent | null {
  const conversation = replayJsonlText(jsonl);
  return conversation ? conversationAgent(conversation, meta, extras) : null;
}

export function parseGeminiLegacyJson(
  json: string,
  meta: ParseMetadata = {},
  extras: { cwd?: string; parentSourceSessionId?: string } = {},
): CollectedAgent | null {
  let conversation: GeminiConversation | null = null;
  try {
    conversation = legacyConversation(JSON.parse(json));
  } catch {
    return null;
  }
  return conversation ? conversationAgent(conversation, meta, extras) : null;
}

async function readProjectRoot(projectRoot: string): Promise<string | undefined> {
  const raw = readTextCappedSync(
    join(projectRoot, ".project_root"),
    MAX_PROJECT_ROOT_CHARS * 4 + 1,
  );
  if (raw === undefined) return undefined;
  const value = raw.split(/\r?\n/, 1)[0]?.trim();
  return value && value.length <= MAX_PROJECT_ROOT_CHARS && isAbsolute(value) ? value : undefined;
}

async function readJsonlConversation(
  path: string,
  signal?: AbortSignal,
): Promise<GeminiConversation | null> {
  checkAbort(signal);
  const replay = new GeminiReplay();
  const input = createReadStream(path, { signal });
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let discardingOversizedLine = false;
  const appendLine = (): void => {
    if (pendingBytes === 0) return;
    const line = Buffer.concat(pending, pendingBytes).toString("utf8");
    pending = [];
    pendingBytes = 0;
    if (!line.trim()) return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    replay.append(value);
  };
  try {
    for await (const value of input) {
      checkAbort(signal);
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      let offset = 0;
      while (offset < chunk.length) {
        const newline = chunk.indexOf(0x0a, offset);
        if (discardingOversizedLine) {
          if (newline < 0) break;
          discardingOversizedLine = false;
          offset = newline + 1;
          continue;
        }
        const end = newline < 0 ? chunk.length : newline;
        const part = chunk.subarray(offset, end);
        if (pendingBytes + part.length > MAX_GEMINI_RECORD_BYTES) {
          pending = [];
          pendingBytes = 0;
          replay.markPartial(
            `Gemini JSONL record exceeds ${MAX_GEMINI_RECORD_BYTES} byte cap and was skipped`,
          );
          if (newline < 0) {
            discardingOversizedLine = true;
            break;
          }
          offset = newline + 1;
          continue;
        }
        if (part.length > 0) pending.push(part);
        pendingBytes += part.length;
        if (newline < 0) break;
        appendLine();
        offset = newline + 1;
      }
    }
    if (!discardingOversizedLine) appendLine();
  } finally {
    input.destroy();
  }
  return replay.conversation();
}

async function readLegacyConversation(
  path: string,
  signal?: AbortSignal,
): Promise<GeminiConversation | null> {
  checkAbort(signal);
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(MAX_GEMINI_RECORD_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      checkAbort(signal);
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > MAX_GEMINI_RECORD_BYTES) {
      throw new Error(`Gemini legacy transcript exceeds ${MAX_GEMINI_RECORD_BYTES} byte cap`);
    }
    checkAbort(signal);
    return legacyConversation(JSON.parse(buffer.subarray(0, offset).toString("utf8")));
  } catch (error) {
    checkAbort(signal);
    if (error instanceof Error && error.message.startsWith("Gemini ")) throw error;
    return null;
  } finally {
    await handle.close();
  }
}

export async function readGeminiConversationFile(
  path: string,
  signal?: AbortSignal,
): Promise<GeminiConversation | null> {
  checkAbort(signal);
  return path.endsWith(".jsonl")
    ? readJsonlConversation(path, signal)
    : readLegacyConversation(path, signal);
}

export async function parseGeminiConversationFile(
  path: string,
  meta: ParseMetadata = {},
  extras: { cwd?: string; parentSourceSessionId?: string } = {},
  signal?: AbortSignal,
): Promise<CollectedAgent | null> {
  const conversation = await readGeminiConversationFile(path, signal);
  return conversation
    ? conversationAgent(conversation, { ...meta, sourcePath: meta.sourcePath ?? path }, extras)
    : null;
}

interface Candidate {
  agent: CollectedAgent;
  lastUpdatedMs: number;
  mtimeMs: number;
}

function newer(left: Candidate | undefined, right: Candidate): Candidate {
  if (!left) return right;
  if (right.lastUpdatedMs !== left.lastUpdatedMs) {
    return right.lastUpdatedMs > left.lastUpdatedMs ? right : left;
  }
  return right.mtimeMs > left.mtimeMs ? right : left;
}

async function collectFile(
  path: string,
  cwd: string | undefined,
  parentSourceSessionId: string | undefined,
  windowMs: number,
  thresholds: LifecycleThresholds | undefined,
  nowMs: number,
  errors: string[],
  signal?: AbortSignal,
): Promise<Candidate | undefined> {
  checkAbort(signal);
  let details;
  try {
    details = await stat(path);
  } catch (error) {
    checkAbort(signal);
    if (!missing(error)) errors.push(`gemini ${path}: ${describe(error)}`);
    return undefined;
  }
  if (!details.isFile() || nowMs - details.mtimeMs > windowMs) return undefined;
  let conversation: GeminiConversation | null;
  try {
    conversation = await readGeminiConversationFile(path, signal);
  } catch (error) {
    checkAbort(signal);
    errors.push(`gemini ${path}: ${describe(error)}`);
    return undefined;
  }
  if (!conversation) return undefined;
  for (const warning of conversation.warnings ?? []) {
    errors.push(`gemini ${path}: ${warning}`);
  }
  const kind = text(conversation.metadata.kind);
  if (parentSourceSessionId) {
    if (kind !== "subagent") return undefined;
  } else if (kind === "subagent") {
    return undefined;
  }
  const agent = conversationAgent(conversation, {
    sourcePath: path,
    mtimeMs: details.mtimeMs,
    nowMs,
    thresholds,
  }, { cwd, parentSourceSessionId });
  if (!agent) return undefined;
  return {
    agent,
    lastUpdatedMs: Date.parse(agent.updatedAt),
    mtimeMs: details.mtimeMs,
  };
}

async function collectChats(
  root: string,
  projectName: string,
  windowMs: number,
  thresholds: LifecycleThresholds | undefined,
  nowMs: number,
  errors: string[],
  signal?: AbortSignal,
): Promise<{ present: boolean; candidates: Candidate[] }> {
  checkAbort(signal);
  const projectRoot = join(root, "tmp", projectName);
  const chats = join(projectRoot, "chats");
  let entries;
  try {
    entries = await readdir(chats, { withFileTypes: true });
  } catch (error) {
    checkAbort(signal);
    if (!missing(error)) errors.push(`gemini ${chats}: ${describe(error)}`);
    return { present: false, candidates: [] };
  }
  checkAbort(signal);
  const cwd = await readProjectRoot(projectRoot);
  checkAbort(signal);
  const candidates: Candidate[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    checkAbort(signal);
    if (entry.isFile() && SESSION_FILE.test(entry.name)) {
      const candidate = await collectFile(
        join(chats, entry.name), cwd, undefined, windowMs, thresholds, nowMs, errors, signal,
      );
      if (candidate) candidates.push(candidate);
      continue;
    }
    if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
    let children;
    try {
      children = await readdir(join(chats, entry.name), { withFileTypes: true });
    } catch (error) {
      checkAbort(signal);
      if (!missing(error)) errors.push(`gemini ${join(chats, entry.name)}: ${describe(error)}`);
      continue;
    }
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
      checkAbort(signal);
      if (!child.isFile() || !child.name.endsWith(".jsonl")) continue;
      const candidate = await collectFile(
        join(chats, entry.name, child.name),
        cwd,
        entry.name.toLowerCase(),
        windowMs,
        thresholds,
        nowMs,
        errors,
        signal,
      );
      if (candidate) candidates.push(candidate);
    }
  }
  return { present: true, candidates };
}

export async function collectGeminiSessions(
  roots: readonly string[],
  windowMs: number,
  thresholds?: LifecycleThresholds,
  nowMs = Date.now(),
  signal?: AbortSignal,
): Promise<CollectionResult<CollectedAgent[]>> {
  checkAbort(signal);
  const errors: string[] = [];
  const byId = new Map<string, Candidate>();
  let anyRoot = false;
  let anyChats = false;

  for (const [rootIndex, root] of roots.entries()) {
    checkAbort(signal);
    let projects;
    try {
      await readdir(root);
      anyRoot = true;
    } catch (error) {
      checkAbort(signal);
      if (missing(error)) {
        if (rootIndex > 0) errors.push(`gemini extra CLI root ${root}: not found`);
      } else {
        errors.push(`gemini ${root}: ${describe(error)}`);
      }
      continue;
    }
    try {
      projects = await readdir(join(root, "tmp"), { withFileTypes: true });
    } catch (error) {
      checkAbort(signal);
      if (!missing(error)) errors.push(`gemini ${join(root, "tmp")}: ${describe(error)}`);
      continue;
    }
    for (const project of projects
      .filter((entry) => entry.isDirectory() && PROJECT_ID.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      checkAbort(signal);
      const collected = await collectChats(root, project.name, windowMs, thresholds, nowMs, errors, signal);
      anyChats ||= collected.present;
      for (const candidate of collected.candidates) {
        if (rootIndex > 0) {
          candidate.agent.instanceId = instanceIdFor("gemini-cli", root);
          candidate.agent.instanceLabel = basename(root);
        }
        byId.set(candidate.agent.id, newer(byId.get(candidate.agent.id), candidate));
      }
    }
  }

  return {
    value: [...byId.values()].map(({ agent }) => agent),
    errors,
    ...((!anyRoot || !anyChats) && roots.length === 1 ? { absent: true } : {}),
  };
}
