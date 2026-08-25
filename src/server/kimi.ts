import { open, opendir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import type { AgentIdentity, Provider, TokenUsage } from "../shared/types";
import { instanceIdFor, type CollectorKind } from "./collector-instances";
import { claudeContextWindow } from "./collectors";
import {
  classifyLifecycle,
  DEFAULT_LIFECYCLE_THRESHOLDS,
  type LifecycleThresholds,
} from "./lifecycle";
import {
  extractClosingByRole,
  extractLastHumanMessage,
  extractLastMessageByRole,
  readableHumanMessage,
} from "./human-message";
import { resolveAgentName } from "./naming";
import { capTranscriptTail, type CollectedAgent, type CollectionResult } from "./types";

export const KIMI_WIRE_PROTOCOL_VERSION = "1.5";
export const KIMI_SESSION_META_VERSION = 2;
export const KIMI_DEFAULT_DATA_DIR = ".kimi-code";

const KIMI_STATE_BYTES = 1024 * 1024;
const KIMI_INDEX_BYTES = 8 * 1024 * 1024;
const KIMI_WIRE_BYTES = 8 * 1024 * 1024;
const KIMI_JSONL_ROWS = 4_096;
const KIMI_WORKDIR_ENTRY_CAP = 64;
const KIMI_SESSION_ENTRY_CAP = 256;
const KIMI_CHILD_ENTRY_CAP = 256;
const SESSION_ID = /^session_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type JsonRecord = Record<string, any>;

export interface KimiLaunchObservation {
  launchCwd?: string;
}

export interface KimiReadTestHooks {
  rootError?: (root: string) => Error | undefined;
  fileError?: (path: string) => Error | undefined;
}

export interface KimiCollectOptions {
  extraKimiRoots?: readonly string[];
  kimiLaunchObservations?: readonly KimiLaunchObservation[];
  kimiReadDeadlineMs?: number;
  kimiReadTestHooks?: KimiReadTestHooks;
}

export interface KimiTranscriptEvent {
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  at: string | null;
}

export interface KimiWireEvidence {
  events: KimiTranscriptEvent[];
  firstTask?: string;
  model?: string;
  effort?: string;
  rawModel?: CollectedAgent["rawModel"];
  tokens: TokenUsage;
  callSizes?: readonly number[];
  usageSeen: boolean;
  usageIncomplete: boolean;
  turnComplete: boolean;
  latestTurnReason?: KimiTurnReason;
  newerPromptAfterEnd: boolean;
  warnings: string[];
}

type KimiTurnReason = "completed" | "cancelled" | "failed" | "blocked";

interface KimiReadOptions {
  signal?: AbortSignal;
  deadlineAtMs?: number;
  deadlineMs?: number;
  hooks?: KimiReadTestHooks;
}

interface KimiRoot {
  path: string;
  origin: "default" | "environment" | "extra";
  instance: boolean;
}

interface KimiState {
  id: string;
  title?: string;
  titleKind?: string;
  createdAt: string;
  updatedAt: string;
  updatedAtMs: number;
  cwd?: string;
  parentSessionId?: string;
  subagentIds: string[];
  subagentCount: number;
  imported: boolean;
  lastTurnReason?: string;
}

interface UsageTurn {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

interface TurnUsageEvidence {
  stepSeen: boolean;
  step?: UsageTurn;
  recordSeen: boolean;
  record?: UsageTurn;
}

class KimiDeadlineError extends Error {}

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sourceTimestamp(value: unknown): string | undefined {
  const millis = typeof value === "number"
    ? value * (value < 10_000_000_000 ? 1_000 : 1)
    : typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(millis) && Number.isFinite(new Date(millis).getTime())
    ? new Date(millis).toISOString()
    : undefined;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason;
}

function checkDeadline(options: KimiReadOptions): void {
  if (options.deadlineAtMs !== undefined && Date.now() >= options.deadlineAtMs) {
    throw new KimiDeadlineError(`exceeded ${options.deadlineMs}ms aggregate read deadline`);
  }
}

function errorDetail(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  const message = error instanceof Error ? error.message : String(error);
  return code ? `${code} ${message}` : message;
}

async function readCappedText(
  path: string,
  cap: number,
  options: KimiReadOptions,
): Promise<string> {
  throwIfAborted(options.signal);
  checkDeadline(options);
  const injected = options.hooks?.fileError?.(path);
  if (injected) throw injected;
  const handle = await open(path, "r");
  let result: string | undefined;
  try {
    const details = await handle.stat();
    if (!details.isFile()) throw new Error("is not a regular file");
    if (details.size > cap) throw new Error(`exceeds ${cap} byte cap (oversized)`);
    const buffer = Buffer.allocUnsafe(cap + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      throwIfAborted(options.signal);
      checkDeadline(options);
      const read = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (read.bytesRead === 0) break;
      bytesRead += read.bytesRead;
    }
    throwIfAborted(options.signal);
    checkDeadline(options);
    if (bytesRead > cap) throw new Error(`exceeds ${cap} byte cap (oversized)`);
    result = buffer.subarray(0, bytesRead).toString("utf8");
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    throw error;
  } finally {
    try {
      await handle.close();
    } finally {
      throwIfAborted(options.signal);
      checkDeadline(options);
    }
  }
  return result!;
}

function parseJsonl(text: string, source: string): JsonRecord[] {
  const lines = text.split("\n").filter((line) => line.trim());
  if (lines.length > KIMI_JSONL_ROWS) {
    throw new Error(`${source}: Kimi JSONL exceeds ${KIMI_JSONL_ROWS} record cap`);
  }
  return lines.map((line, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`${source}: Kimi JSON is malformed at line ${index + 1}`);
    }
    const row = record(parsed);
    if (!row) throw new Error(`${source}: Kimi JSON row ${index + 1} is malformed`);
    return row;
  });
}

function usageTurn(usage: JsonRecord | undefined): UsageTurn | undefined {
  const values = [
    usage?.inputOther,
    usage?.output,
    usage?.inputCacheRead,
    usage?.inputCacheCreation,
  ];
  if (!values.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)) {
    return undefined;
  }
  return {
    input: values[0] as number,
    output: values[1] as number,
    cacheRead: values[2] as number,
    cacheCreation: values[3] as number,
  };
}

function checkedFiniteSum(values: readonly number[]): number | undefined {
  let total = 0;
  for (const value of values) {
    const next = total + value;
    if (!Number.isFinite(next)) return undefined;
    total = next;
  }
  return total;
}

function publicTextParts(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((part: unknown) => {
    const item = record(part);
    return item?.type === "text" && nonEmpty(item.text) ? [nonEmpty(item.text)!] : [];
  });
}

function kimiTurnReason(value: unknown): KimiTurnReason | undefined {
  return value === "completed" || value === "cancelled" || value === "failed" || value === "blocked"
    ? value
    : undefined;
}

/** Pinned MoonshotAI Kimi Code 0.38.0 wire 1.5 reader shared by collection
 * and both on-demand debug seams. It exposes only public prose and tool
 * identity/status; arguments, result bodies, and encrypted thinking stay out. */
export async function readKimiWireFile(
  source: string,
  options: KimiReadOptions = {},
): Promise<KimiWireEvidence> {
  let text: string;
  try {
    text = await readCappedText(source, KIMI_WIRE_BYTES, options);
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    throw new Error(`${source}: Kimi wire could not be read: ${errorDetail(error)}`);
  }
  const rows = parseJsonl(text, source);
  const metadata = rows[0];
  if (!metadata) throw new Error(`${source}: Kimi metadata is missing`);
  if (metadata.type !== "metadata") {
    if (typeof metadata.type === "string" && metadata.type.includes("metadata")) {
      throw new Error(`${source}: Kimi metadata is foreign (${metadata.type})`);
    }
    throw new Error(`${source}: Kimi metadata is missing before transcript events`);
  }
  if (metadata.protocol_version !== KIMI_WIRE_PROTOCOL_VERSION) {
    throw new Error(
      `${source}: Kimi wire protocol ${String(metadata.protocol_version)} is unsupported; expected ${KIMI_WIRE_PROTOCOL_VERSION}`,
    );
  }

  const events: KimiTranscriptEvent[] = [];
  const tools = new Map<string, { event: KimiTranscriptEvent; title: string }>();
  const turnUsage = new Map<string, TurnUsageEvidence>();
  let firstTask: string | undefined;
  let model: string | undefined;
  let effort: string | undefined;
  let rawModel: CollectedAgent["rawModel"];
  let usageSeen = false;
  let currentTurnKey = "implicit";
  let promptOrdinal = -1;
  let lastEndedPromptOrdinal = -1;
  let explicitEndSeen = false;
  let latestTurnReason: KimiTurnReason | undefined;
  const startedCalls = new Set<string>();

  const usageFor = (key: string): TurnUsageEvidence => {
    const existing = turnUsage.get(key);
    if (existing) return existing;
    const created = { stepSeen: false, recordSeen: false };
    turnUsage.set(key, created);
    return created;
  };

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index]!;
    const at = sourceTimestamp(row.time) ?? null;
    if (row.type === "turn.prompt") {
      promptOrdinal += 1;
      currentTurnKey = `turn-${promptOrdinal}`;
      latestTurnReason = undefined;
      if (!firstTask && row.origin?.kind === "user") {
        firstTask = readableHumanMessage(provider(), publicTextParts(row.input).join("\n"));
      }
      continue;
    }
    if (row.type === "context.append_message") {
      const role = row.message?.role;
      if (role !== "user") continue;
      for (const text of publicTextParts(row.message?.content)) {
        events.push({ role: "user", text, at });
      }
      continue;
    }
    if (row.type === "context.append_loop_event") {
      const event = record(row.event);
      if (event?.type === "content.part") {
        const part = record(event.part);
        const assistant = part?.type === "text" ? nonEmpty(part.text) : undefined;
        const thought = part?.type === "think" ? nonEmpty(part.think) : undefined;
        if (assistant) events.push({ role: "assistant", text: assistant, at });
        if (thought) events.push({ role: "system", text: `Thought\n${thought}`, at });
        continue;
      }
      if (event?.type === "tool.call") {
        const callId = nonEmpty(event.toolCallId);
        if (!callId) continue;
        const title = nonEmpty(event.name) ?? "Tool call";
        const transcriptEvent = {
          role: "tool" as const,
          text: `${title}\nCall: ${callId}\nStatus: running`,
          at,
        };
        events.push(transcriptEvent);
        tools.set(callId, { event: transcriptEvent, title });
        continue;
      }
      if (event?.type === "tool.result") {
        const callId = nonEmpty(event.toolCallId);
        const tool = callId ? tools.get(callId) : undefined;
        if (!callId || !tool) continue;
        const isError = event.result?.isError;
        if (isError === true || isError === false) {
          const status = isError ? "failed" : "completed";
          tool.event.text = `${tool.title}\nCall: ${callId}\nStatus: ${status}`;
          tool.event.at = at;
        }
        continue;
      }
      if (event?.type === "step.end" && "usage" in event) {
        usageSeen = true;
        const evidence = usageFor(currentTurnKey);
        evidence.stepSeen = true;
        evidence.step = usageTurn(record(event.usage));
      }
      continue;
    }
    if (row.type === "llm.request") {
      startedCalls.add(currentTurnKey);
      usageFor(currentTurnKey);
      const providerRoute = nonEmpty(row.provider);
      const modelId = nonEmpty(row.model);
      if (providerRoute && modelId) {
        model = modelId;
        effort = nonEmpty(row.thinkingEffort);
        rawModel = { providerRoute, modelId };
      }
      continue;
    }
    if (row.type === "usage.record" && row.usageScope === "turn") {
      usageSeen = true;
      const evidence = usageFor(currentTurnKey);
      evidence.recordSeen = true;
      evidence.record = usageTurn(record(row.usage));
      continue;
    }
    if (row.type === "turn.ended") {
      const reason = kimiTurnReason(row.reason);
      if (reason) {
        if (startedCalls.has(currentTurnKey)) usageFor(currentTurnKey);
        explicitEndSeen = true;
        lastEndedPromptOrdinal = promptOrdinal;
        latestTurnReason = reason;
      }
    }
  }

  const selectedTurns = [...turnUsage.values()].map((evidence) =>
    evidence.recordSeen ? evidence.record : evidence.stepSeen ? evidence.step : undefined
  );
  let usageIncomplete = selectedTurns.some((turn) => turn === undefined);
  const completeTurns = selectedTurns.flatMap((turn) => turn ? [turn] : []);
  const latest = selectedTurns.at(-1);
  const contextWindow = claudeContextWindow(model);
  const latestTotal = latest
    ? checkedFiniteSum([latest.input, latest.output, latest.cacheRead, latest.cacheCreation])
    : undefined;
  const candidateCallSizes = completeTurns.map((turn) =>
    checkedFiniteSum([turn.input, turn.output, turn.cacheRead, turn.cacheCreation])
  );
  const completeCallSizes = candidateCallSizes.flatMap((size) => size === undefined ? [] : [size]);
  const sessionTotal = checkedFiniteSum(completeTurns.flatMap((turn) =>
    [turn.input, turn.output, turn.cacheCreation]
  ));
  const sessionCachedInput = checkedFiniteSum(completeTurns.map((turn) => turn.cacheRead));
  const sessionProcessed = checkedFiniteSum(completeCallSizes);
  const usageOverflow = (latest !== undefined && latestTotal === undefined)
    || candidateCallSizes.some((size) => size === undefined)
    || sessionTotal === undefined
    || sessionCachedInput === undefined
    || sessionProcessed === undefined;
  usageIncomplete = usageIncomplete || usageOverflow;
  let tokens: TokenUsage = latest
    ? {
        input: latest.input,
        output: latest.output,
        cachedInput: latest.cacheRead,
        ...(latestTotal !== undefined ? { total: latestTotal } : {}),
        ...(contextWindow !== undefined ? { contextWindow } : {}),
        scope: "latest-turn",
        provenance: "observed",
      }
    : { scope: usageSeen ? "session" : "unknown", provenance: usageSeen ? "estimated" : "unknown" };
  let callSizes: readonly number[] | undefined;
  if (usageSeen && !usageIncomplete && completeTurns.length > 0) {
    callSizes = completeCallSizes;
    tokens = {
      ...tokens,
      sessionTotal: sessionTotal!,
      sessionCachedInput: sessionCachedInput!,
      sessionProcessed: sessionProcessed!,
    };
  }
  return {
    events,
    firstTask,
    model,
    effort,
    rawModel,
    tokens,
    callSizes,
    usageSeen,
    usageIncomplete,
    turnComplete: latestTurnReason !== undefined,
    latestTurnReason,
    newerPromptAfterEnd: explicitEndSeen && promptOrdinal > lastEndedPromptOrdinal,
    warnings: usageOverflow
      ? ["Kimi usage aggregate overflowed finite numeric range; derived totals and call series were withheld"]
      : usageIncomplete
        ? ["Kimi usage is incomplete or missing components; session aggregates and call series were withheld"]
      : [],
  };
}

async function readState(path: string, options: KimiReadOptions): Promise<KimiState> {
  let text: string;
  try {
    text = await readCappedText(path, KIMI_STATE_BYTES, options);
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    throw new Error(`${path}: Kimi state could not be read: ${errorDetail(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${path}: Kimi state JSON is malformed`);
  }
  const state = record(parsed);
  if (!state) throw new Error(`${path}: Kimi state metadata is malformed`);
  if (state.version !== KIMI_SESSION_META_VERSION) {
    throw new Error(`${path}: Kimi state metadata version ${String(state.version)} is unsupported`);
  }
  const id = nonEmpty(state.id);
  if (!id || !SESSION_ID.test(id)) throw new Error(`${path}: Kimi state session id is malformed`);
  const createdAt = sourceTimestamp(state.createdAt);
  const updatedAt = sourceTimestamp(state.updatedAt);
  if (!createdAt || !updatedAt) throw new Error(`${path}: Kimi state timestamps are malformed`);
  const agents = record(state.agents);
  const subagentIds = agents
    ? Object.entries(agents).flatMap(([key, value]) =>
        key !== "main" && record(value)?.type === "subagent" ? [key] : [])
    : [];
  return {
    id,
    title: nonEmpty(state.title),
    titleKind: nonEmpty(state.titleKind),
    createdAt,
    updatedAt,
    updatedAtMs: Date.parse(updatedAt),
    cwd: nonEmpty(state.cwd) ?? nonEmpty(state.workDir),
    parentSessionId: nonEmpty(state.custom?.parent_session_id),
    subagentIds,
    subagentCount: subagentIds.length,
    imported: state.custom?.imported_from_kimi_cli === true,
    lastTurnReason: nonEmpty(state.lastTurnReason),
  };
}

async function indexWorkdirs(root: string, options: KimiReadOptions): Promise<{
  workdirs: Map<string, string>;
  error?: string;
}> {
  const source = join(root, "session_index.jsonl");
  let text: string;
  try {
    text = await readCappedText(source, KIMI_INDEX_BYTES, options);
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { workdirs: new Map() };
    return { workdirs: new Map(), error: `${source}: Kimi index could not be read: ${errorDetail(error)}` };
  }
  try {
    const workdirs = new Map<string, string>();
    for (const row of parseJsonl(text, source)) {
      const id = nonEmpty(row.sessionId);
      const cwd = nonEmpty(row.workDir);
      if (!id) continue;
      if (row.deleted === true) workdirs.delete(id);
      else if (cwd) workdirs.set(id, cwd);
    }
    return { workdirs };
  } catch (error) {
    return { workdirs: new Map(), error: error instanceof Error ? error.message : String(error) };
  }
}

function configuredRoots(home: string, options: KimiCollectOptions): {
  roots: KimiRoot[];
  errors: string[];
} {
  const roots: KimiRoot[] = [];
  const errors: string[] = [];
  const actualOperator = resolve(home) === resolve(homedir());
  const configured = actualOperator ? process.env.KIMI_CODE_HOME?.trim() : undefined;
  if (!configured) {
    roots.push({ path: join(home, KIMI_DEFAULT_DATA_DIR), origin: "default", instance: false });
  } else if (isAbsolute(configured)) {
    roots.push({ path: resolve(configured), origin: "environment", instance: true });
  } else {
    const launchCwds = [...new Set((options.kimiLaunchObservations ?? [])
      .flatMap(({ launchCwd }) => {
        const observed = nonEmpty(launchCwd);
        return observed ? [resolve(observed)] : [];
      }))]
      .sort((left, right) => left.localeCompare(right));
    if (launchCwds.length === 0) {
      errors.push(`Kimi KIMI_CODE_HOME ${JSON.stringify(configured)} is relative and requires an observed Kimi launch cwd`);
    }
    for (const launchCwd of launchCwds) {
      roots.push({ path: resolve(launchCwd, configured), origin: "environment", instance: true });
    }
  }
  for (const extra of options.extraKimiRoots ?? []) {
    if (!isAbsolute(extra)) {
      errors.push(`Kimi extra root ${JSON.stringify(extra)} must be absolute`);
      continue;
    }
    roots.push({ path: resolve(extra), origin: "extra", instance: true });
  }
  return { roots, errors };
}

async function deduplicateRoots(roots: readonly KimiRoot[]): Promise<KimiRoot[]> {
  const seen = new Set<string>();
  const result: KimiRoot[] = [];
  for (const root of roots) {
    let identity = root.path;
    try { identity = await realpath(root.path); } catch { /* Missing roots retain their advertised path. */ }
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(root);
  }
  return result;
}

async function admittedDirectoryNames(
  path: string,
  cap: number,
  options: KimiReadOptions,
): Promise<{ names: string[]; truncated: boolean }> {
  throwIfAborted(options.signal);
  checkDeadline(options);
  const directory = await opendir(path);
  const names: string[] = [];
  let inspected = 0;
  let exhausted = false;
  let truncated = false;
  try {
    while (inspected < cap) {
      throwIfAborted(options.signal);
      checkDeadline(options);
      const entry = await directory.read();
      throwIfAborted(options.signal);
      checkDeadline(options);
      if (!entry) {
        exhausted = true;
        break;
      }
      inspected += 1;
      if (entry.isDirectory()) names.push(entry.name);
    }
    if (!exhausted && inspected === cap) {
      throwIfAborted(options.signal);
      checkDeadline(options);
      const witness = await directory.read();
      throwIfAborted(options.signal);
      checkDeadline(options);
      truncated = witness !== null;
    }
  } finally {
    try {
      await directory.close();
    } finally {
      throwIfAborted(options.signal);
      checkDeadline(options);
    }
  }
  return { names: names.sort((a, b) => a.localeCompare(b)), truncated };
}

async function sessionDirectories(
  root: string,
  options: KimiReadOptions,
): Promise<{ directories: string[]; truncated: boolean }> {
  const sessions = join(root, "sessions");
  let workdirs;
  try {
    workdirs = await admittedDirectoryNames(sessions, KIMI_WORKDIR_ENTRY_CAP, options);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { directories: [], truncated: false };
    throw error;
  }
  const found: string[] = [];
  let truncated = workdirs.truncated;
  for (let index = 0; index < workdirs.names.length; index += 1) {
    throwIfAborted(options.signal);
    checkDeadline(options);
    const workdirPath = join(sessions, workdirs.names[index]!);
    const remaining = KIMI_SESSION_ENTRY_CAP - found.length;
    if (remaining === 0) {
      truncated = true;
      break;
    }
    const entries = await admittedDirectoryNames(workdirPath, remaining, options);
    for (const entry of entries.names) {
      found.push(join(workdirPath, entry));
    }
    if (entries.truncated) {
      truncated = true;
      break;
    }
    if (found.length === KIMI_SESSION_ENTRY_CAP && index < workdirs.names.length - 1) {
      truncated = true;
      break;
    }
  }
  return { directories: found.sort((a, b) => a.localeCompare(b)), truncated };
}

async function childArtifacts(
  sessionDir: string,
  state: KimiState,
  includeChildren: boolean,
  options: KimiReadOptions,
): Promise<{
  artifacts: CollectedAgent["artifacts"];
  truncated: boolean;
  admissionLimit: number;
  errors: string[];
}> {
  const artifacts: CollectedAgent["artifacts"] = [{
    label: "Kimi Code session",
    path: join(sessionDir, "agents/main/wire.jsonl"),
    kind: "transcript",
  }];
  if (!includeChildren || state.subagentCount === 0) {
    return { artifacts, truncated: false, admissionLimit: 0, errors: [] };
  }
  const agentsDir = join(sessionDir, "agents");
  const admissionLimit = Math.min(KIMI_CHILD_ENTRY_CAP, state.subagentCount + 1);
  let admission: { names: string[]; truncated: boolean };
  try {
    admission = await admittedDirectoryNames(agentsDir, admissionLimit, options);
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    if (error instanceof KimiDeadlineError) throw error;
    checkDeadline(options);
    return {
      artifacts,
      truncated: false,
      admissionLimit,
      errors: [
        `${agentsDir}: Kimi declared child evidence is partial because the child directory could not be inspected: ${errorDetail(error)}`,
      ],
    };
  }
  const declaredChildren = new Set(state.subagentIds);
  for (const entry of admission.names) {
    if (!declaredChildren.has(entry)) continue;
    const path = join(agentsDir, entry, "wire.jsonl");
    try {
      throwIfAborted(options.signal);
      checkDeadline(options);
      if ((await stat(path)).isFile()) artifacts.push({ label: "Kimi Code subagent", path, kind: "transcript" });
      throwIfAborted(options.signal);
      checkDeadline(options);
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      if (error instanceof KimiDeadlineError) throw error;
      checkDeadline(options);
      // State declares the relationship; a missing child transcript adds no artifact.
    }
  }
  throwIfAborted(options.signal);
  checkDeadline(options);
  const admittedChildren = artifacts.length - 1;
  const errors = !admission.truncated && admittedChildren < state.subagentCount
    ? [
        `${agentsDir}: Kimi state declares ${state.subagentCount} subagent${state.subagentCount === 1 ? "" : "s"}, but only ${admittedChildren} child transcript${admittedChildren === 1 ? " was" : "s were"} admitted; declared child evidence is partial`,
      ]
    : [];
  return { artifacts, truncated: admission.truncated, admissionLimit, errors };
}

function kimiIdentity(state: KimiState, task: string | undefined, cwd: string | undefined): AgentIdentity {
  const authored = state.titleKind === "custom" && state.title
    ? { name: state.title, by: "kimi-title" as const }
    : undefined;
  if (!authored && !task && !cwd) {
    const name = "Kimi Code · session";
    return { name, base: name, source: "provider-fallback" };
  }
  return resolveAgentName({
    provider: provider(),
    sourceSessionId: state.id,
    ...(authored ? { authored } : {}),
    ...(task ? {} : { originCwd: cwd }),
    taskName: task,
  });
}

function statusFor(
  updatedAtMs: number,
  turnComplete: boolean,
  thresholds: LifecycleThresholds | undefined,
): Pick<CollectedAgent, "status" | "statusReason" | "lifecycle" | "provenance"> {
  const verdict = classifyLifecycle({
    ageMs: Math.max(0, Date.now() - updatedAtMs),
    ...(turnComplete ? { endEvidence: "turn-complete" as const } : {}),
  }, thresholds ?? DEFAULT_LIFECYCLE_THRESHOLDS);
  const status = verdict.lifecycle === "working"
    ? "running"
    : verdict.lifecycle === "waiting"
      ? "waiting"
      : verdict.lifecycle === "finished" ? "archived" : "stale";
  return { status, statusReason: verdict.reason, lifecycle: verdict.lifecycle, provenance: verdict.provenance };
}

function provider(): Provider {
  return "kimi" as Provider;
}

/** Source replay for pinned Kimi Code 0.38.0. Central production-root and web
 * model-route wiring remain Phase D. */
export async function collectKimiSessions(
  home: string,
  windowMs: number,
  thresholds: LifecycleThresholds | undefined,
  options: KimiCollectOptions = {},
  signal?: AbortSignal,
): Promise<CollectionResult<CollectedAgent[]>> {
  throwIfAborted(signal);
  const resolution = configuredRoots(home, options);
  const roots = await deduplicateRoots(resolution.roots);
  const errors = [...resolution.errors];
  const value: CollectedAgent[] = [];
  const deadlineAtMs = options.kimiReadDeadlineMs === undefined
    ? undefined
    : Date.now() + options.kimiReadDeadlineMs;
  const readOptions: KimiReadOptions = {
    signal,
    deadlineAtMs,
    deadlineMs: options.kimiReadDeadlineMs,
    hooks: options.kimiReadTestHooks,
  };
  let presentRoot = false;
  let deadlineExhausted = false;

  for (const root of roots) {
    if (deadlineExhausted) break;
    throwIfAborted(signal);
    const injected = options.kimiReadTestHooks?.rootError?.(root.path);
    if (injected) {
      errors.push(`${root.path}: Kimi root is inaccessible: ${errorDetail(injected)}`);
      continue;
    }
    let details;
    try {
      checkDeadline(readOptions);
      details = await stat(root.path);
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error instanceof KimiDeadlineError) {
        errors.push(`${root.path}: Kimi scan ${error.message}`);
        deadlineExhausted = true;
      } else if ((error as NodeJS.ErrnoException)?.code !== "ENOENT" || root.origin !== "default") {
        errors.push(`${root.path}: Kimi ${root.origin} root could not be inspected: ${errorDetail(error)}`);
      }
      continue;
    }
    if (!details.isDirectory()) {
      errors.push(`${root.path}: Kimi root is not a directory`);
      continue;
    }
    presentRoot = true;
    const index = await indexWorkdirs(root.path, readOptions);
    if (index.error) errors.push(index.error);
    let directories: string[];
    try {
      const admission = await sessionDirectories(root.path, readOptions);
      directories = admission.directories;
      if (admission.truncated) {
        errors.push(
          `${root.path}: Kimi directory admission truncated at ${KIMI_WORKDIR_ENTRY_CAP} workdir entries or ${KIMI_SESSION_ENTRY_CAP} session entries; remaining provider entries were not inspected`,
        );
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error instanceof KimiDeadlineError) {
        errors.push(`${root.path}: Kimi scan ${error.message}`);
        deadlineExhausted = true;
      } else {
        errors.push(`${root.path}: Kimi sessions could not be inspected: ${errorDetail(error)}`);
      }
      continue;
    }
    for (const sessionDir of directories) {
      if (deadlineExhausted) break;
      throwIfAborted(signal);
      const statePath = join(sessionDir, "state.json");
      const wirePath = join(sessionDir, "agents/main/wire.jsonl");
      let state: KimiState;
      let wire: KimiWireEvidence;
      try {
        state = await readState(statePath, readOptions);
        if (basename(sessionDir) !== state.id) {
          throw new Error(`${statePath}: Kimi state id does not match session directory ${basename(sessionDir)}`);
        }
        if (state.imported) continue;
        if (Number.isFinite(windowMs) && Date.now() - state.updatedAtMs > windowMs) continue;
        wire = await readKimiWireFile(wirePath, readOptions);
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        errors.push(error instanceof Error ? error.message : String(error));
        if (error instanceof KimiDeadlineError || /aggregate read deadline/.test(String(error))) {
          deadlineExhausted = true;
        }
        continue;
      }
      errors.push(...wire.warnings.map((warning) => `${wirePath}: ${warning}`));
      const cwd = state.cwd ?? index.workdirs.get(state.id);
      const task = wire.firstTask;
      const identity = kimiIdentity(state, task, cwd);
      const instanceId = root.instance
        ? instanceIdFor("kimi" as CollectorKind, root.path)
        : undefined;
      const id = instanceId ? `${instanceId}:${state.id}` : `kimi:${state.id}`;
      const stateTurnReason = kimiTurnReason(state.lastTurnReason);
      const outcomeConflict = wire.latestTurnReason !== undefined
        && stateTurnReason !== undefined
        && wire.latestTurnReason !== stateTurnReason;
      if (outcomeConflict) {
        errors.push(`${wirePath}: Kimi latest-turn outcome conflicts with state.lastTurnReason`);
      }
      const latestTurnReason = wire.latestTurnReason
        ?? (!wire.newerPromptAfterEnd ? stateTurnReason : undefined);
      const turnComplete = latestTurnReason !== undefined;
      const transcriptEndedCleanly = latestTurnReason === "completed" && !outcomeConflict;
      const latestUser = [...wire.events].reverse().find((event) => event.role === "user");
      const latestHuman = [...wire.events].reverse().find((event) =>
        event.role === "user" || event.role === "assistant");
      const humanMessages = wire.events.flatMap((event) =>
        event.role === "user" || event.role === "assistant"
          ? [{ role: event.role, content: event.text, timestamp: event.at ?? undefined }]
          : []);
      const lastThreadAt = wire.events.flatMap((event) => event.at ? [event.at] : []).sort().at(-1);
      const transcriptTail = wire.events.length > 0
        ? capTranscriptTail(wire.events.map((event) => event.text).join("\n"))
        : undefined;
      const contextWindow = wire.tokens.contextWindow;
      let artifacts: CollectedAgent["artifacts"] = [{
        label: "Kimi Code session",
        path: wirePath,
        kind: "transcript",
      }];
      try {
        const collectedArtifacts = await childArtifacts(sessionDir, state, root.instance, readOptions);
        artifacts = collectedArtifacts.artifacts;
        errors.push(...collectedArtifacts.errors);
        if (collectedArtifacts.truncated) {
          errors.push(
            `${join(sessionDir, "agents")}: Kimi child artifact admission truncated at ${collectedArtifacts.admissionLimit} total entries; remaining child entries were not inspected`,
          );
        }
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        if (error instanceof KimiDeadlineError) {
          errors.push(
            `${join(sessionDir, "agents")}: Kimi child artifact scan ${error.message}; remaining child entries were not inspected`,
          );
          deadlineExhausted = true;
        } else {
          throw error;
        }
      }
      value.push({
        id,
        provider: provider(),
        ...(instanceId ? { instanceId, instanceLabel: basename(root.path) } : {}),
        sourceSessionId: state.id,
        runtimeSessionId: state.id,
        displayName: identity.name,
        identity,
        cwd,
        originCwd: cwd,
        model: wire.model,
        effort: wire.effort,
        rawModel: wire.rawModel,
        task,
        ...statusFor(state.updatedAtMs, turnComplete, thresholds),
        startedAt: state.createdAt,
        updatedAt: state.updatedAt,
        tokens: wire.tokens,
        ...(contextWindow !== undefined && wire.tokens.total !== undefined
          ? { contextPct: wire.tokens.total / contextWindow * 100 }
          : {}),
        ...(wire.callSizes ? { callSizes: wire.callSizes } : {}),
        subagentCount: state.subagentCount,
        parentSourceSessionId: state.parentSessionId,
        threadDepth: state.parentSessionId ? 1 : 0,
        lastHumanMessage: extractLastHumanMessage(provider(), humanMessages, task),
        lastUserMessage: extractLastMessageByRole(provider(), humanMessages, "user"),
        lastAgentMessage: extractLastMessageByRole(provider(), humanMessages, "assistant"),
        lastUserFacingAt: latestUser?.at ?? undefined,
        lastHumanFacingAt: latestHuman?.at ?? undefined,
        lastThreadAt,
        lastAgentClosing: extractClosingByRole(provider(), humanMessages, "assistant"),
        transcriptTail,
        artifacts,
        gates: [],
        ...(turnComplete ? { endEvidence: "turn-complete" as const } : {}),
        ...(transcriptEndedCleanly ? { transcriptEndedCleanly: true } : {}),
        allowCwdFallback: false,
      });
    }
  }
  return {
    value,
    errors,
    ...(!presentRoot && errors.length === 0 ? { absent: true } : {}),
  };
}
