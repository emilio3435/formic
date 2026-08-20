import { existsSync } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { PROVIDERS, type AgentStatus, type EndEvidence, type Provider, type TokenUsage } from "../shared/types";
import {
  DEFAULT_LIFECYCLE_THRESHOLDS,
  retirementEndEvidence,
  spokenMinutes,
  type LifecycleThresholds,
} from "./lifecycle";
import {
  extractLastHumanMessage,
  extractChatBodyByRole,
  extractClosingByRole,
  extractLastHumanFacingAt,
  extractLastFacingAtByRole,
  extractLastMessageByRole,
  readableHumanMessage,
  type HumanMessageCandidate,
} from "./human-message";
import { AGENT_IDLE_GAP_MS, capTranscriptTail, type CollectedAgent, type CollectionResult } from "./types";
import { collectCursorSessions } from "./cursor";
import { MODEL_CONFIG, type ModelConfig } from "./model-config";
import { resolveAgentName, type AuthoredNameSource } from "./naming";
import { createFactoryParser, parseFactoryJsonl } from "./factory";
import { createPrimeParser, parsePrimeJsonl } from "./prime";
import { collectGrokSessions } from "./grok";
import { collectGrokBotSessions } from "./grok-bot";
import { createHermesParser, parseHermesJsonl } from "./hermes";
import { collectMuseSessions } from "./muse";
import { collectCopilotSessions } from "./copilot";
import { collectAntigravitySessions, defaultAntigravityTrees } from "./antigravity";
import { collectGeminiSessions } from "./gemini";
import { readHookSessionStores, type HookSessionRecord } from "./cmux-hook-sessions";
import { readProcessLineage, type ProcessLineageExec } from "./process-lineage";
import { livenessOf, processAliveFrom } from "./process-liveness";
import { observeClaudeRow, ThreadClock, threadFromMessages } from "./thread-clock";

export const DEFAULT_SESSION_WINDOW_MS = 36 * 60 * 60 * 1_000;
export interface CollectSessionsOptions {
  hookProcessStarts?: () => ReadonlyMap<number, number> | undefined;
  processLineageExec?: ProcessLineageExec;
  extraCursorGuiRoots?: readonly string[];
  extraGrokBotRoots?: readonly string[];
  extraGrokCliRoots?: readonly string[];
  extraCopilotRoots?: readonly string[];
  extraGeminiCliRoots?: readonly string[];
  extraOpenCodeRoots?: readonly string[];
  extraPiRoots?: readonly string[];
  piLaunchObservations?: readonly import("./pi").PiLaunchObservation[];
  piCliSessionDir?: string;
  piLaunchCwd?: string;
  piReadDeadlineMs?: number;
  piReadTestHooks?: import("./pi").PiReadTestHooks;
}
export type SessionProviderResult = CollectionResult<CollectedAgent[]>;
export type SessionProviderResults = Record<Provider, SessionProviderResult>;
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
  /* The operator's freshness and quiet bands, carried from the settings store
     down to the one function that compares an age against them. Optional so
     every existing caller — and there are a lot of them in tests — keeps
     working against the shipped defaults. */
  thresholds?: LifecycleThresholds;
}

type JsonRecord = Record<string, any>;

export interface IncrementalParser {
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
  lastHumanFacingAt?: string;
}

const PROVIDER_NAMES: Record<Provider, string> = {
  codex: "Codex",
  omp: "OMP",
  claude: "Claude Code",
  cursor: "Cursor",
  factory: "Factory",
  prime: "Prime",
  grok: "Grok Build",
  hermes: "Hermes",
  muse: "Muse Code",
  antigravity: "Antigravity",
  copilot: "Copilot CLI",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  pi: "Pi",
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
  const timestamp = isoTimestamp(candidate.timestamp);
  if (timestamp && (!window.lastHumanFacingAt || timestamp > window.lastHumanFacingAt)) {
    window.lastHumanFacingAt = timestamp;
  }
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
  if (provider === "factory") return createFactoryParser();
  if (provider === "prime") return createPrimeParser();
  if (provider === "hermes") return createHermesParser();
  /* Reached only by a provider added to the union without an incremental parser
     — which does NOT fail the build, because collectProvider takes the one-shot
     parser as an argument and this lookup happens at run time. Factory did
     exactly that on its first real run: zero agents, fifteen identical errors,
     and a green test suite. */
  throw new Error(`incremental parser unavailable for ${provider}: ${parser.name}`);
}

/* Working time, accumulated turn by turn.

   Elapsed on the board is updatedAt − startedAt, which is a SPAN: the magnitude
   audit found one agent reading 87.1 days, arithmetically right and about 204x
   any generous activity bound, because every dormant hour between the first
   touch and the last sits inside it. This counts only the gaps short enough to
   be one working stretch, so a session that was picked up again after a week
   contributes the work, not the week.

   Bounded by construction: every increment is a real interval between two
   recorded turns, so the sum can never exceed the span it is drawn from. */
class ActiveTime {
  #lastMs?: number;
  #activeMs = 0;

  observe(timestamp: string | undefined): void {
    if (!timestamp) return;
    const atMs = Date.parse(timestamp);
    if (!Number.isFinite(atMs)) return;
    if (this.#lastMs !== undefined) {
      const gap = atMs - this.#lastMs;
      // Out-of-order rows contribute nothing rather than a negative.
      if (gap > 0 && gap <= AGENT_IDLE_GAP_MS) this.#activeMs += gap;
    }
    if (this.#lastMs === undefined || atMs > this.#lastMs) this.#lastMs = atMs;
  }

  /* Undefined until at least one interval was observed: a single-turn session
     has no measurable working time, and 0 would read as "did nothing". */
  get value(): number | undefined {
    return this.#activeMs > 0 ? this.#activeMs : undefined;
  }
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

/* Transcript plumbing is not prose. A slash command lands in the transcript as
   its own run of user turns — the invocation envelope, then the command's own
   stdout, its caveats, and injected reminders — and every one of them used to
   survive into `task`, which the drawer prints under the heading as the standing
   objective. Three live agents printed `<command-name>/model</command-name>`
   there, and behind it sat `<local-command-stdout>Set model to ␛[1mFable 5…`:
   raw markup, ANSI escapes and all, in the slot that answers "which lane is
   this". The same defect class as a `<synthetic>` placeholder reaching a model
   slot.

   `taskDisplayName` already refuses to read a NAME out of these lines. This is
   the same list held one layer earlier, so the task itself never carries them.
   `<file …>` is not on it: that wrapper is a human pasting a file, and the lines
   above unwrap it and keep what is inside.

   The one exception is the invocation's arguments, because those are the part a
   human typed: `/qa fix the login page` stays a task and reads as the sentence
   it was written as. A bare `/model` is chrome, and returning undefined for it
   keeps the scan looking for the instruction that follows — better than freezing
   a session's objective on a keystroke that states nothing about the work. */
const PLUMBING_ENVELOPE =
  /^<(?:command-name|command-message|command-args|command-contents|local-command-stdout|local-command-stderr|local-command-caveat|system-reminder)\b/i;
function commandInvocation(text: string): string | undefined {
  const name = text.match(/^<command-name>\s*([\s\S]*?)\s*<\/command-name>/i)?.[1]?.trim();
  const args = text.match(/<command-args>\s*([\s\S]*?)\s*<\/command-args>/i)?.[1]?.trim();
  if (!name || !args) return undefined;
  return `${name} ${args}`;
}

/* The same rule for a task that arrives already collected. Collection is not
   the only door into the board: the archive replays records written before this
   existed, and a session last active in July is never re-collected, so its
   stored task is frozen exactly as it was read then. Two archived agents were
   still printing `<command-name>/model</command-name>` on the live board after
   the collector stopped producing it — the guard on one path only, which is how
   `<synthetic>` reached the row while the head above it was clean. */
export function readableTask(task: string | undefined): string | undefined {
  const text = task?.trim();
  if (!text) return undefined;
  if (!PLUMBING_ENVELOPE.test(text)) return task;
  return commandInvocation(text)?.slice(0, 500);
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
  // Whatever the envelope holds, the markup itself never reaches a reader.
  if (PLUMBING_ENVELOPE.test(text)) return readableTask(text);
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

/* Which launcher a provider's explicit name came from. Each provider has
   exactly one place an authored name can originate, so this is a lookup rather
   than a per-call-site argument. */
const AUTHORED_BY: Record<Exclude<Provider, "opencode">, AuthoredNameSource> = {
  codex: "codex-nickname",
  omp: "omp-title",
  claude: "claude-subagent",
  cursor: "cursor-composer",
  factory: "factory-title",
  prime: "prime-title",
  grok: "grok-title",
  hermes: "hermes-title",
  muse: "muse-title",
  antigravity: "antigravity-title",
  copilot: "copilot-title",
  gemini: "gemini-title",
  pi: "pi-title",
};

function authoredByFor(provider: Provider): AuthoredNameSource | undefined {
  return provider === "opencode" ? undefined : AUTHORED_BY[provider];
}

function statusFrom(
  updatedAt: string,
  exited: boolean,
  nowMs: number,
  thresholds: LifecycleThresholds = DEFAULT_LIFECYCLE_THRESHOLDS,
): {
  status: AgentStatus;
  reason: string;
} {
  if (exited) return { status: "archived", reason: "Source recorded a session exit." };
  const ageMs = Math.max(0, nowMs - Date.parse(updatedAt));
  /* The minutes are SPOKEN from the thresholds, not written into the sentence.
     They used to be literals — "within 3 minutes" / "in the last 45 minutes" —
     which was true only while the defaults were. Slice 3 of the lifecycle
     contract made both numbers operator-settable, and snapshot.ts publishes this
     string verbatim on every ordinary Working and Waiting row, so an operator who
     widened the quiet band to 90 minutes got a row that still said 45. Reuses
     lifecycle.ts's helper rather than a second copy, so the two paths cannot come
     to phrase the same threshold differently. */
  if (ageMs < thresholds.freshMs) {
    return { status: "running", reason: `Source activity within ${spokenMinutes(thresholds.freshMs)}.` };
  }
  if (ageMs < thresholds.quietMs) {
    return { status: "waiting", reason: `No source activity in the last ${spokenMinutes(thresholds.freshMs)}.` };
  }
  return { status: "stale", reason: `No source activity in the last ${spokenMinutes(thresholds.quietMs)}.` };
}

function withCurrentStatus(
  agent: CollectedAgent,
  nowMs: number,
  thresholds?: LifecycleThresholds,
): CollectedAgent {
  if (agent.status === "archived") return agent;
  const status = statusFrom(agent.updatedAt, false, nowMs, thresholds);
  return {
    ...agent,
    status: status.status,
    statusReason: status.reason,
  };
}

function fallbackUpdatedAt(meta: ParseMetadata): string {
  return new Date(meta.mtimeMs ?? meta.nowMs ?? Date.now()).toISOString();
}

export function makeAgent(input: {
  /** Per-call processed sizes; see CollectedAgent.callSizes. */
  callSizes?: readonly number[];
  processedSnapshots?: readonly { readonly at: string; readonly total: number }[];
  provider: Provider;
  sourceSessionId: string;
  sourceTitle?: CollectedAgent["sourceTitle"];
  rawModel?: CollectedAgent["rawModel"];
  displayName?: string;
  cwd?: string;
  /* The FIRST working directory this session recorded. Separate from `cwd`,
     which stays current because routing and cmux matching need where the
     session is NOW; only the name reads this one, because a name that moves is
     not an identity. Defaults to `cwd` for the providers whose session file
     records a single directory and therefore cannot drift. */
  originCwd?: string;
  /** Naming evidence when it differs from the publishable first cwd. */
  identityCwd?: string;
  /** Legacy display-name cwd when current cwd is not the naming source. */
  displayCwd?: string;
  /** Existing providers publish cwd as origin when no separate origin exists. */
  allowOriginCwdFallback?: boolean;
  launch?: CollectedAgent["launch"];
  model?: string;
  effort?: string;
  task?: string;
  /** The source defines its first task as the display fallback ahead of cwd. */
  taskBeforeOriginCwd?: boolean;
  startedAt?: string;
  updatedAt: string;
  tokens: TokenUsage;
  transcriptTail?: string;
  activeMs?: number;
  parentSourceSessionId?: string;
  runtimeSessionId?: string;
  threadDepth?: number;
  nickname?: string;
  humanMessages?: readonly HumanMessageCandidate[];
  lastHumanFacingAt?: string;
  thread?: { lastThreadAt?: string; workingSince?: string };
  statusReason?: string;
  exited?: boolean;
  /* What `exited` actually meant for this provider. Passing it beside the
     boolean rather than replacing the boolean keeps this slice inert: nothing
     reads the discriminant yet, and every existing verdict is untouched. */
  endEvidence?: EndEvidence;
  meta: ParseMetadata;
}): CollectedAgent {
  const status = statusFrom(
    input.updatedAt,
    input.exited ?? false,
    input.meta.nowMs ?? Date.now(),
    input.meta.thresholds,
  );
  const statusReason = input.statusReason ?? status.reason;
  const normalizedCwd = (input.displayCwd ?? input.cwd)?.replace(/\/+$/, "");
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
  /* Resolved here because this is where every provider's session becomes one
     shape, so there is a single call site rather than four. Codex's native
     nickname is authored evidence, just like the explicit title fields from
     the other providers; keep the legacy displayName below for old clients. */
  const authoredName = usefulExplicitName ||
    (input.provider === "codex" ? input.nickname : undefined);
  const taskName = taskDisplayName(input.task);
  const authoredBy = authoredName ? authoredByFor(input.provider) : undefined;
  const originCwd = input.originCwd ?? (input.allowOriginCwdFallback === false ? undefined : input.cwd);
  const thread = input.thread ?? threadFromMessages(input.humanMessages, input.exited);
  const identity = resolveAgentName({
    provider: input.provider,
    sourceSessionId: input.sourceSessionId,
    authored: authoredName && authoredBy
      ? { name: authoredName, by: authoredBy }
      : undefined,
    originCwd: input.taskBeforeOriginCwd ? undefined : input.identityCwd ?? originCwd,
    taskName,
  });
  return {
    identity,
    originCwd,
    launch: input.launch,
    id: `${input.provider}:${input.sourceSessionId}`,
    callSizes: input.callSizes,
    processedSnapshots: input.processedSnapshots,
    provider: input.provider,
    sourceSessionId: input.sourceSessionId,
    sourceTitle: input.sourceTitle,
    rawModel: input.rawModel,
    runtimeSessionId: input.runtimeSessionId,
    // Identity first (folder / Home), task second. The prompt belongs in the
    // message lane — not as the agent/terminal name operators hunt for in cmux.
    displayName:
      usefulExplicitName ||
      (input.taskBeforeOriginCwd ? taskName : cwdIdentity || taskName) ||
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
    lastHumanFacingAt: input.lastHumanFacingAt
      ?? extractLastHumanFacingAt(input.provider, input.humanMessages ?? []),
    lastUserFacingAt: extractLastFacingAtByRole(input.provider, input.humanMessages ?? [], "user"),
    lastThreadAt: thread.lastThreadAt,
    workingSince: thread.workingSince,
    lastUserMessage: extractLastMessageByRole(input.provider, input.humanMessages ?? [], "user"),
    lastAgentMessage: extractLastMessageByRole(input.provider, input.humanMessages ?? [], "assistant"),
    // End-anchored and role-attributed: what the agent actually stopped on.
    lastAgentClosing: extractClosingByRole(input.provider, input.humanMessages ?? [], "assistant"),
    lastUserChatBody: extractChatBodyByRole(input.provider, input.humanMessages ?? [], "user"),
    lastAgentChatBody: extractChatBodyByRole(input.provider, input.humanMessages ?? [], "assistant"),
    startedAt: input.startedAt,
    updatedAt: input.updatedAt,
    tokens: input.tokens,
    parentSourceSessionId: input.parentSourceSessionId,
    threadDepth: input.threadDepth,
    nickname: input.nickname,
    transcriptTail: capTranscriptTail(input.transcriptTail),
    activeMs: input.activeMs,
    artifacts: input.meta.sourcePath
      ? [{
          label: `${input.provider.toUpperCase()} transcript`,
          path: input.meta.sourcePath,
          kind: "transcript",
        }]
      : [],
    gates: [],
    transcriptEndedCleanly: input.exited === true || undefined,
    endEvidence: input.exited === true ? input.endEvidence : undefined,
  };
}

function createOmpParser(): IncrementalParser {
  let session: JsonRecord | undefined;
  let title: string | undefined;
  let model: string | undefined;
  let task: string | undefined;
  let tail: string | undefined;
  const messages: HumanMessageWindow = {};
  const clock = new ThreadClock();
  let updatedAt: string | undefined;
  const activeTime = new ActiveTime();
  let latestUsage: { input: number; output: number; cachedInput: number; total: number } | undefined;
  let sessionTotal = 0;
  let sessionCachedInput = 0;
  let sessionProcessed = 0;
  const callSizes: number[] = [];
  /* Set when a usage record could not be read. The guard below `continue`s past
     such a record, which silently turns corruption into a believable SMALLER
     number: a session that burned more than a clean one reported exactly the
     same total, with provenance still claiming "observed". Claude's parser has
     no such guard and propagates NaN to null — "not reported", which is loud
     and correct. The count here cannot be repaired, so the claim about it is
     withdrawn instead. */
  let usageUnreadable = false;
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
        activeTime.observe(timestamp);
        if (row.type === "custom" && row.data?.kind === "session_exit") {
          clock.observe(timestamp, "system", { endsTurn: true });
        }
        if (row.type !== "message") continue;

        const text = plainText(row.message?.content);
        if (row.message?.role === "user") task = nextTask(task, row.message?.content);
        if (
          row.message?.role === "user"
          || row.message?.role === "assistant"
          || row.message?.role === "tool"
          || row.message?.role === "system"
        ) {
          clock.observe(timestamp, row.message.role);
        }
        if (row.message?.role === "user" || row.message?.role === "assistant") {
          recordHumanMessage("omp", messages, {
            role: row.message.role,
            content: row.message?.content,
            timestamp,
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
        if (![input, output, cachedInput, total].every(Number.isFinite)) {
          usageUnreadable = true;
          continue;
        }
        latestUsage = { input, output, cachedInput, total };
        /* `total` is this call's SIZE and includes the re-read prefix; summing it
           over the session counts a cached token once per later call. Measured on
           real rows the four parts are disjoint (570+385+74711+487 = 76153), so
           new tokens are input + output + cacheWrite. */
        sessionTotal += input + output + cacheWrite;
        sessionCachedInput += cachedInput;
        // The same rows summed cache-INCLUSIVE: BurnBar's unit, not ours.
        const callSize = input + output + cacheWrite + cachedInput;
        callSizes.push(callSize);
        sessionProcessed += callSize;
      }
    },
    result(meta) {
      if (!session) return null;
      const agent = makeAgent({
        callSizes: latestUsage ? callSizes : undefined,
        provider: "omp",
        sourceSessionId: session.id,
        displayName: title,
        cwd: typeof session.cwd === "string" ? session.cwd : undefined,
        model,
        task,
        startedAt: isoTimestamp(session.timestamp),
        updatedAt: updatedAt ?? isoTimestamp(session.timestamp) ?? fallbackUpdatedAt(meta),
        tokens: latestUsage
          ? {
            ...latestUsage,
            sessionTotal,
            sessionCachedInput,
            sessionProcessed,
            contextWindow: claudeContextWindow(model),
            scope: "latest-turn",
            /* Not "observed": at least one record was skipped, so the totals are
               a floor rather than a measurement. Everything downstream that
               requires observed evidence — contextPct, burn coverage — now
               declines to use them, which is the point. */
            provenance: usageUnreadable ? "estimated" : "observed",
          }
          : { scope: "unknown", provenance: "unknown", contextWindow: claudeContextWindow(model) },
        transcriptTail: tail,
        activeMs: activeTime.value,
        humanMessages: humanMessages(messages),
        lastHumanFacingAt: messages.lastHumanFacingAt,
        thread: clock.snapshot(),
        exited,
        // OMP's session_exit is the real thing: a record that the session, not a
        // turn, is over.
        endEvidence: "session-exit",
        meta,
      });
      /* No unconditional archive. This line used to read
         `return { ...agent, status: "archived" }`, which filed EVERY OMP
         session as ended whether or not one had ever ended — the reason 724 of
         815 sessions on this machine read as archived while eleven live
         processes hid among them. OMP does record a real ending, `session_exit`,
         and `exited` above carries it; that is the only thing that finishes an
         OMP session now. */
      return agent;
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
  let launch: CollectedAgent["launch"];
  let updatedAt: string | undefined;
  const activeTime = new ActiveTime();
  let model: string | undefined;
  let effort: string | undefined;
  let task: string | undefined;
  let tail: string | undefined;
  const messages: HumanMessageWindow = {};
  const clock = new ThreadClock();
  let tokens: TokenUsage = { provenance: "unknown" };
  let previousSessionUsage: {
    readonly total: number;
    readonly cachedInput: number;
    readonly processed: number;
  } | undefined;
  const completedSessionUsage = { total: 0, cachedInput: 0, processed: 0 };
  let exited = false;
  let index = 0;

  return {
    append(rows) {
      for (const row of rows) {
        const rowIndex = index++;
        if (!sessionRow && row.type === "session_meta") {
          sessionRow = row;
          const session = row.payload ?? row;
          if (typeof session.originator === "string" && session.originator) {
            launch = { ...launch, entrypoint: session.originator };
          }
          if (typeof session.source === "string" && session.source) {
            launch = { ...launch, promptSource: session.source };
          }
        }
        const timestamp = isoTimestamp(row.timestamp);
        if (timestamp && (!updatedAt || timestamp > updatedAt)) updatedAt = timestamp;
        activeTime.observe(timestamp);
        const payload = row.payload ?? row;
        if (typeof payload.effort === "string" && payload.effort.trim()) effort = payload.effort.trim();
        if (row.type === "event_msg" && payload.type === "user_message") {
          exited = false;
          task = nextTask(task, payload.message);
          recordHumanMessage("codex", messages, { role: "user", content: payload.message, timestamp }, rowIndex);
          clock.observe(timestamp, "user");
        }
        if (row.type === "event_msg" && payload.type === "task_complete") {
          exited = true;
          clock.observe(timestamp, "system", { endsTurn: true });
        }
        if (payload.type === "function_call" || payload.type === "function_call_output") {
          clock.observe(timestamp, "tool");
        }
        if (payload.type === "token_count" && payload.info?.total_token_usage) {
          const sessionUsage = payload.info.total_token_usage;
          const lastUsage = payload.info.last_token_usage;
          const usage = lastUsage ?? sessionUsage;
          const input = Number(usage.input_tokens ?? 0);
          const sessionInput = Number(sessionUsage.input_tokens ?? 0);
          const sessionOutput = Number(sessionUsage.output_tokens ?? 0);
          const sessionCached = Number(sessionUsage.cached_input_tokens ?? 0);
          const output = Number(usage.output_tokens ?? 0);
          const currentSessionUsage = {
            total: Math.max(0, sessionInput - sessionCached) + sessionOutput,
            cachedInput: sessionCached,
            processed: sessionInput + sessionOutput,
          };
          /* Codex can resume the same session id in a fresh process whose
             cumulative counter starts over. A strict processed-total decrease
             closes the prior segment only when the lower cumulative row is
             also the epoch's first call (total usage equals last usage).
             Lower corrections and interleaved observations do not carry the
             prior value; ordinary cumulative updates are never re-added. */
          const startsNewUsageEpoch = lastUsage
            && sessionInput === Number(lastUsage.input_tokens ?? 0)
            && sessionCached === Number(lastUsage.cached_input_tokens ?? 0)
            && sessionOutput === Number(lastUsage.output_tokens ?? 0);
          if (
            previousSessionUsage
            && currentSessionUsage.processed < previousSessionUsage.processed
            && startsNewUsageEpoch
          ) {
            completedSessionUsage.total += previousSessionUsage.total;
            completedSessionUsage.cachedInput += previousSessionUsage.cachedInput;
            completedSessionUsage.processed += previousSessionUsage.processed;
          }
          previousSessionUsage = currentSessionUsage;
          /* Codex's own `total_token_usage.total_tokens` is input + output where
             `input_tokens` already CONTAINS `cached_input_tokens` — so its
             cumulative total re-charges the whole re-read prefix on every turn,
             the same defect the Claude parser had. Containment verified on a real
             rollout: cumulative input−cached (56564−37376 = 19188) equals the sum
             of the per-turn input−cached (15511 + 3677 = 19188).
             `cache_write_input_tokens` is 0 in every rollout on disk and its
             containment is therefore untestable, so it is not added — adding an
             already-contained field would double-count. */
          tokens = {
            input,
            output,
            cachedInput: Number(usage.cached_input_tokens ?? 0),
            total: Number(usage.total_tokens ?? input + output),
            sessionTotal: completedSessionUsage.total + currentSessionUsage.total,
            sessionCachedInput: completedSessionUsage.cachedInput + currentSessionUsage.cachedInput,
            /* Codex's session input already CONTAINS the cached prefix, so the
               processed total is simply input + output — no re-adding. */
            sessionProcessed: completedSessionUsage.processed + currentSessionUsage.processed,
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
              timestamp,
            }, rowIndex);
            clock.observe(timestamp, payload.role);
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
        launch,
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
        activeMs: activeTime.value,
        humanMessages: humanMessages(messages),
        lastHumanFacingAt: messages.lastHumanFacingAt,
        thread: clock.snapshot(),
        exited,
        // Codex `task_complete` closes a TURN. The session stays open, and the
        // next user message clears the flag again a few lines above.
        endEvidence: "turn-complete",
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
  /* Assigned once and never reassigned — that is the whole mechanism. A Claude
     transcript records cwd per entry, so `cwd` below tracks the provider's
     current tool directory; the name must not. Reproduced on the session that
     wrote this file: six cwd changes
     in four minutes from read-only `git` and `ls`, four renames, and one
     interval published under a different lane's name entirely. Because the
     transcript is append-only, the first recorded cwd is the same on a cold
     parse and on every incremental one. */
  let originCwd: string | undefined;
  let launch: CollectedAgent["launch"];
  let startedAt: string | undefined;
  let updatedAt: string | undefined;
  const activeTime = new ActiveTime();
  let model: string | undefined;
  let effort: string | undefined;
  let runtimeSessionId: string | undefined;
  let task: string | undefined;
  let tail: string | undefined;
  const messages: HumanMessageWindow = {};
  const clock = new ThreadClock();
  const usageByMessage = new Map<string, {
    index: number;
    input: number;
    output: number;
    cachedInput: number;
    cacheCreationInput: number;
  }>();
  const processedSnapshots: Array<{ at: string; total: number }> = [];
  let observedProcessed = 0;
  let processedTimelineComplete = true;
  let lastUsageTimestamp: string | undefined;
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
        if (typeof row.cwd === "string") {
          cwd = row.cwd;
          originCwd ??= row.cwd;
        }
        if (launch?.entrypoint == null && typeof row.entrypoint === "string" && row.entrypoint) {
          launch = { ...launch, entrypoint: row.entrypoint };
        }
        if (launch?.promptSource == null && typeof row.promptSource === "string" && row.promptSource) {
          launch = { ...launch, promptSource: row.promptSource };
        }
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
        activeTime.observe(timestamp);
        observeClaudeRow(clock, row, timestamp);
        const text = plainText(row.message?.content);
        if (row.type === "user") {
          if (row.isMeta !== true) exited = false;
          if (isTaskBoundary(row.message?.content)) task = undefined;
          else if (row.isMeta !== true) task = task ?? userTask(row.message?.content);
        }
        if (row.type === "assistant" && row.message?.stop_reason === "end_turn") exited = true;
        if (text) tail = text;
        if ((row.type === "user" || row.type === "assistant") && row.message?.role === row.type) {
          recordHumanMessage("claude", messages, {
            role: row.message.role,
            content: row.message?.content,
            isMeta: row.isMeta === true,
            timestamp,
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
          const previous = usageByMessage.get(key);
          const next = {
            index: rowIndex,
            input: Number(usage.input_tokens ?? 0),
            output: Number(usage.output_tokens ?? 0),
            cachedInput: Number(usage.cache_read_input_tokens ?? 0),
            cacheCreationInput: Number(usage.cache_creation_input_tokens ?? 0),
          };
          const processedSize = (value: typeof next): number =>
            value.input + value.output + value.cachedInput + value.cacheCreationInput;
          observedProcessed += processedSize(next) - (previous ? processedSize(previous) : 0);
          usageByMessage.set(key, next);
          if (!timestamp || (lastUsageTimestamp && timestamp < lastUsageTimestamp)) {
            processedTimelineComplete = false;
          } else {
            lastUsageTimestamp = timestamp;
            processedSnapshots.push({ at: timestamp, total: observedProcessed });
          }
        }
      }
    },
    result(meta) {
      if (!identity || typeof identity.sessionId !== "string") return null;
      const childPathId = meta.sourcePath && basename(dirname(meta.sourcePath)) === "subagents"
        ? /^agent-([0-9a-z]+)\.jsonl$/i.exec(basename(meta.sourcePath))?.[1]
        : undefined;
      const identityChildId = typeof identity.agentId === "string"
        && /^[0-9a-z]+$/i.test(identity.agentId)
        ? identity.agentId
        : undefined;
      const isSidechain = identity.isSidechain === true || childPathId !== undefined;
      if (isSidechain && !childPathId && !identityChildId) {
        throw new Error("Claude sidechain transcript has no safe child agent id");
      }
      if (childPathId && identityChildId && childPathId.toLowerCase() !== identityChildId.toLowerCase()) {
        throw new Error("Claude sidechain path and embedded child agent id disagree");
      }
      const childAgentId = isSidechain ? childPathId ?? identityChildId : undefined;
      const sourceSessionId = childAgentId
        ? `${identity.sessionId}/agent-${childAgentId}`
        : identity.sessionId;
      const fallback = fallbackUpdatedAt(meta);
      const uniqueUsage = [...usageByMessage.values()].sort((left, right) => left.index - right.index);
      const latestUsage = uniqueUsage.at(-1);
      /* Size of one call — cache reads included, because they occupy the window. */
      const usageTotal = (usage: NonNullable<typeof latestUsage>): number =>
        usage.input + usage.output + usage.cachedInput + usage.cacheCreationInput;
      /* Consumption over the session — cache reads EXCLUDED. Every call re-sends
         the whole cached prefix, so summing usageTotal charges the same token
         once per later call and grows with the square of the conversation. Each
         prompt token is counted once here, as `input` if it missed the cache or
         as `cacheCreationInput` if it was written to it; a re-write after the
         cache expires is real work and is counted again, correctly. */
      const usageNew = (usage: NonNullable<typeof latestUsage>): number =>
        usage.input + usage.output + usage.cacheCreationInput;
      const sessionTotal = uniqueUsage.reduce((total, usage) => total + usageNew(usage), 0);
      const sessionCachedInput = uniqueUsage.reduce((total, usage) => total + usage.cachedInput, 0);
      /* Computed from the rows rather than as sessionTotal + sessionCachedInput.
         The identity holds today, and deriving it would make this field follow
         whatever those two mean later — which is exactly how a bridge to an
         outside source stops measuring what the outside source measures. */
      /* The series, and the total derived from it. Previously the total was
         reduced straight off the rows; computing it from the published series
         instead means an external check that sums a PREFIX of these calls is
         summing exactly the same numbers this board added up, rather than a
         second derivation that happens to agree today. */
      const callSizes = uniqueUsage.map(usageTotal);
      const sessionProcessed = callSizes.reduce((total, size) => total + size, 0);
      return makeAgent({
        callSizes: latestUsage ? callSizes : undefined,
        processedSnapshots: childAgentId && latestUsage && processedTimelineComplete
          ? processedSnapshots
          : undefined,
        provider: "claude",
        sourceSessionId,
        parentSourceSessionId: childAgentId ? identity.sessionId : undefined,
        runtimeSessionId,
        cwd,
        originCwd,
        launch,
        model,
        effort,
        task,
        startedAt,
        /* The last TIMESTAMPED record, never max(timestamp, mtime). Claude
           Code appends untimestamped bookkeeping rows (ai-title, last-prompt,
           mode, file-history-snapshot) to DORMANT sessions when its session
           list is enumerated — measured 2026-08-06: restarting one session
           touched two other projects' transcripts within 2 seconds, and the
           mtime max promoted both to "working" for the fresh window. A live
           session writes timestamped rows continuously, so mtime can only
           win where it lies. Same convention as the codex/cursor parsers
           above; mtime remains the fallback for a transcript that carries no
           timestamps at all. */
        updatedAt: updatedAt ?? fallback,
        tokens: latestUsage
          ? {
              input: latestUsage.input,
              output: latestUsage.output,
              cachedInput: latestUsage.cachedInput,
              total: usageTotal(latestUsage),
              sessionTotal,
              sessionCachedInput,
              sessionProcessed,
              contextWindow: claudeContextWindow(model),
              scope: "latest-turn",
              provenance: "observed",
            }
          : { scope: "unknown", provenance: "unknown" },
        transcriptTail: tail,
        activeMs: activeTime.value,
        humanMessages: humanMessages(messages),
        lastHumanFacingAt: messages.lastHumanFacingAt,
        thread: clock.snapshot(),
        exited,
        // Claude `stop_reason:"end_turn"` is the model yielding the floor, not
        // the session closing. The very next user message reopens it.
        endEvidence: "turn-complete",
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

/* Returns the files it could see AND what stopped it seeing more. A bare catch
   here turned a permissions or I/O failure into an empty file list, which reads
   downstream as a provider that simply has no sessions — a healthy, empty
   fleet. An absent directory really is "this provider never ran here"; every
   other failure is evidence we lost and must degrade the source. */
async function recentJsonlFiles(
  root: string,
  maxDepth: number,
  windowMs: number,
): Promise<CollectionResult<string[]>> {
  const files: string[] = [];
  const errors: string[] = [];
  const nowMs = Date.now();
  const absent = (error: unknown): boolean =>
    (error as NodeJS.ErrnoException).code === "ENOENT";
  const describe = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);
  async function walk(directory: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (!absent(error)) errors.push(`${directory}: ${describe(error)}`);
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
        } catch (error) {
          // A source disappearing mid-scan is harmless; unreadable is not.
          if (!absent(error)) errors.push(`${path}: ${describe(error)}`);
        }
      }),
    );
  }
  /* Whether the ROOT is missing, not merely some directory inside it. A
     provider whose home has never existed was never installed; one whose root
     exists but whose subdirectory vanished mid-scan is a different story. */
  let rootAbsent = false;
  try {
    await readdir(root);
  } catch (error) {
    rootAbsent = absent(error);
  }
  await walk(root, maxDepth);
  return { value: files, errors, ...(rootAbsent ? { absent: true } : {}) };
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
    // Retained with the pids, or the next scan re-checks numbers it cannot tell apart.
    ...(previous.processStarts ? { processStarts: { ...previous.processStarts } } : {}),
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
  thresholds?: LifecycleThresholds,
): Promise<CollectionResult<CollectedAgent[]>> {
  const errors: string[] = [];
  const agents: CollectedAgent[] = [];
  const scan = await recentJsonlFiles(root, depth, windowMs);
  const files = scan.value;
  const absent = scan.absent === true;
  for (const error of scan.errors) errors.push(`${provider} ${error}`);
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
          if (cached.agent) agents.push(withCurrentStatus(cached.agent, Date.now(), thresholds));
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
          const parsed = reset.result({ sourcePath: path, mtimeMs: details.mtimeMs, thresholds });
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
          incremental.result({ sourcePath: path, mtimeMs: details.mtimeMs, thresholds }),
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
  return { value: agents, errors, ...(absent ? { absent: true } : {}) };
}

/* The hook store is the one source that records a start time alongside the pid,
   so this is the strongest liveness evidence the board has. The judgement
   itself lives in process-liveness.ts — see the header there for why it is not
   made here, or in the three other places that used to make it. */
function hookProcessAlive(
  record: HookSessionRecord,
  starts: ReadonlyMap<number, number> | undefined,
): boolean | undefined {
  if (!starts) return undefined;
  return processAliveFrom(livenessOf(
    { pid: record.pid, startSeconds: record.pidStartSeconds },
    { complete: true, startsByPid: starts },
  ));
}

function attachHookFacts(
  result: CollectionResult<CollectedAgent[]>,
  records: ReadonlyMap<string, HookSessionRecord>,
  starts: ReadonlyMap<number, number> | undefined,
  observedParents: ReadonlyMap<string, string> | undefined,
  knownAgentIds: ReadonlySet<string>,
): CollectionResult<CollectedAgent[]> {
  return {
    ...result,
    value: result.value.map((agent) => {
      const record = records.get(`${agent.provider}:${agent.sourceSessionId.toLowerCase()}`);
      if (!record) return agent;
      const observedAlive = hookProcessAlive(record, starts);
      const retainedAlive = agent.processIds?.includes(record.pid) ? agent.processAlive : undefined;
      const cwd = agent.cwd ?? record.cwd;
      const launchCwd = record.launchCommand?.workingDirectory;
      const processAlive = observedAlive ?? retainedAlive;
      const observedParentAgentId = observedParents?.get(agent.id);
      const hookLifecycleAtDate = new Date(record.updatedAt * 1_000);
      const hookLifecycleAt = Number.isFinite(hookLifecycleAtDate.getTime())
        ? hookLifecycleAtDate.toISOString()
        : undefined;
      const endEvidence = retirementEndEvidence({
        endEvidence: agent.endEvidence,
        hookLifecycle: record.agentLifecycle,
        processAlive,
        cwdExists: existsSync(cwd),
      });
      return {
        ...agent,
        cwd,
        ...(launchCwd ? { launchCwd } : {}),
        hookLifecycle: record.agentLifecycle,
        ...(hookLifecycleAt ? { hookLifecycleAt } : {}),
        /* Only claim the pid as this session's when a start time makes it
           checkable. An unverifiable number presented as `processIds` gets read
           downstream as "we know its process", and identity.ts will then revive
           it on nothing more than the number still being in use by something
           else. Any identity-verified pids already on the agent survive. */
        ...(record.pidStartSeconds !== undefined
          ? { processIds: [record.pid], processStarts: { [record.pid]: record.pidStartSeconds } }
          : {}),
        processAlive,
        ...(observedParentAgentId && knownAgentIds.has(observedParentAgentId)
          ? { lineage: { observedParentAgentId } }
          : {}),
        ...(endEvidence ? { endEvidence } : {}),
      };
    }),
  };
}

export async function collectSessionProvider(
  provider: Provider,
  home = homedir(),
  windowMs = DEFAULT_SESSION_WINDOW_MS,
  thresholds?: LifecycleThresholds,
  options: CollectSessionsOptions = {},
  signal?: AbortSignal,
): Promise<SessionProviderResult> {
  switch (provider) {
    case "omp":
      return collectProvider("omp", join(home, ".omp/agent/sessions"), 2, parseOmpJsonl, windowMs, thresholds);
    case "codex":
      return collectProvider("codex", join(home, ".codex/sessions"), 4, parseCodexJsonl, windowMs, thresholds);
    case "claude":
      return collectProvider("claude", join(home, ".claude/projects"), 3, parseClaudeJsonl, windowMs, thresholds);
    case "cursor":
      return collectCursorSessions(
        home, Date.now(), windowMs, thresholds,
        options.extraCursorGuiRoots ?? [],
      );
    case "factory":
      return collectProvider("factory", join(home, ".factory/sessions"), 2, parseFactoryJsonl, windowMs, thresholds);
    case "prime":
      return collectProvider("prime", join(home, ".prime/agent/sessions"), 1, parsePrimeJsonl, windowMs, thresholds);
    case "grok": {
      const override = home === homedir() ? process.env.GROK_HOME?.trim() : undefined;
      const root = override || join(home, ".grok");
      const cli = await collectGrokSessions(
        root,
        windowMs,
        thresholds,
        options.extraGrokCliRoots ?? [],
      );
      const bot = await collectGrokBotSessions(
        options.extraGrokBotRoots ?? [],
        Date.now(),
        windowMs,
        thresholds,
      );
      const seen = new Set(cli.value.map((agent) => agent.id));
      const botAgents = bot.value.filter((agent) => {
        if (seen.has(agent.id)) return false;
        seen.add(agent.id);
        return true;
      });
      return {
        value: [...cli.value, ...botAgents],
        errors: [...cli.errors, ...bot.errors],
        ...(cli.absent ? { absent: true } : {}),
      };
    }
    case "hermes": {
      const root = join(home, ".hermes");
      if (!existsSync(root)) return { value: [], errors: [], absent: true };
      const sessions = join(root, "sessions");
      if (!existsSync(sessions)) return { value: [], errors: [] };
      return collectProvider("hermes", sessions, 1, parseHermesJsonl, windowMs, thresholds);
    }
    case "muse": {
      const override = home === homedir() ? process.env.XDG_DATA_HOME?.trim() : undefined;
      const root = override ? join(override, "muse") : join(home, ".local/share/muse");
      return collectMuseSessions(root, windowMs, thresholds);
    }
    case "copilot": {
      const override = home === homedir() ? process.env.COPILOT_HOME?.trim() : undefined;
      const root = override || join(home, ".copilot");
      return collectCopilotSessions(root, windowMs, thresholds, options.extraCopilotRoots ?? []);
    }
    case "antigravity": {
      return collectAntigravitySessions(
        defaultAntigravityTrees(home).map((tree) => tree.root),
        Date.now(),
        windowMs,
        thresholds,
      );
    }
    case "gemini": {
      const override = home === homedir() ? process.env.GEMINI_CLI_HOME?.trim() : undefined;
      const geminiHome = override || home;
      return collectGeminiSessions(
        [join(geminiHome, ".gemini"), ...(options.extraGeminiCliRoots ?? [])],
        windowMs,
        thresholds,
        Date.now(),
        signal,
      );
    }
    case "opencode": {
      const { collectOpenCodeSessions } = await import("./opencode");
      const useOperatorEnvironment = home === homedir();
      const xdgDataHome = useOperatorEnvironment ? process.env.XDG_DATA_HOME?.trim() : undefined;
      const dataRoot = xdgDataHome
        ? join(xdgDataHome, "opencode")
        : join(home, ".local/share/opencode");
      const configured = useOperatorEnvironment ? process.env.OPENCODE_DB?.trim() : undefined;
      if (configured === ":memory:") return { value: [], errors: [] };
      const configuredDatabasePath = configured
        ? (isAbsolute(configured) ? configured : join(dataRoot, configured))
        : undefined;
      return collectOpenCodeSessions(dataRoot, {
        ...(configuredDatabasePath ? { configuredDatabasePath } : {}),
        extraDataDirs: configuredDatabasePath ? [] : options.extraOpenCodeRoots ?? [],
      });
    }
    case "pi": {
      const { collectPiSessions } = await import("./pi");
      return collectPiSessions(home, windowMs, thresholds, options, signal);
    }
  }
}

export function finalizeSessionProviders(
  results: SessionProviderResults,
  home = homedir(),
  options: CollectSessionsOptions = {},
): SessionProviderResults {
  const hookRecords = readHookSessionStores(join(home, ".cmuxterm"));
  const recordsBySession = new Map(
    hookRecords.map((record) => [`${record.provider}:${record.sessionId.toLowerCase()}`, record]),
  );
  const knownAgentIds = new Set(
    PROVIDERS.flatMap((provider) => results[provider].value.map((agent) => agent.id)),
  );
  const processLineage = hookRecords.length > 0
    && (options.processLineageExec !== undefined || !options.hookProcessStarts)
    ? readProcessLineage(hookRecords, options.processLineageExec)
    : undefined;
  const starts = hookRecords.length > 0
    ? options.hookProcessStarts?.() ?? processLineage?.processStarts
    : undefined;
  return Object.fromEntries(PROVIDERS.map((provider) => [
    provider,
    provider === "cursor"
      ? results[provider]
      : attachHookFacts(results[provider], recordsBySession, starts, processLineage?.observedParents, knownAgentIds),
  ])) as SessionProviderResults;
}

export async function collectSessions(
  home = homedir(),
  windowMs = DEFAULT_SESSION_WINDOW_MS,
  thresholds?: LifecycleThresholds,
  options: CollectSessionsOptions = {},
  signal?: AbortSignal,
): Promise<SessionProviderResults> {
  const results = Object.fromEntries(await Promise.all(PROVIDERS.map(async (provider) => [
    provider,
    await collectSessionProvider(provider, home, windowMs, thresholds, options, signal),
  ]))) as SessionProviderResults;
  return finalizeSessionProviders(results, home, options);
}
