import { readdir, readFile, stat } from "node:fs/promises";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Database } from "bun:sqlite";
import {
  stripTimestampMarkup,
  extractLastHumanMessage,
  extractLastMessageByRole,
  readableHumanMessage,
  type HumanMessageCandidate,
} from "./human-message";
import { MAX_TRANSCRIPT_TAIL_CHARS, type CollectedAgent, type CollectionResult } from "./types";
import { resolveAgentName } from "./naming";
import { DEFAULT_LIFECYCLE_THRESHOLDS, type LifecycleThresholds } from "./lifecycle";

export const DEFAULT_CURSOR_SESSION_WINDOW_MS = 36 * 60 * 60 * 1_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cursorStoreCache = new Map<string, { fingerprint: string; evidence: CursorStoreEvidence }>();
const cursorTextCache = new Map<string, { fingerprint: string; contents: string; mtimeMs: number }>();
const cursorTranscriptCache = new Map<string, { fingerprint: string; transcript: CursorTranscript }>();
const cursorTranscriptPaths = new Map<string, string>();
const cursorTrackingCache = new Map<string, { fingerprint: string; models: Map<string, string> }>();
let cursorStateCache: {
  path: string;
  fingerprint: string;
  database: Database;
  sessionCwds: Map<string, string>;
  hasComposerData: boolean;
  composers: Map<string, CursorStoreEvidence>;
} | undefined;

interface CursorMeta {
  schemaVersion?: number;
  createdAtMs?: number;
  updatedAtMs?: number;
  cwd?: string;
  hasConversation?: boolean;
}

interface CursorTranscript {
  task?: string;
  transcriptTail?: string;
  humanMessages: HumanMessageCandidate[];
  turnStatus?: string;
}

export interface CursorStoreEvidence {
  agentId?: string;
  name?: string;
  mode?: string;
  model?: string;
  effort?: string;
}

export interface CursorSessionInput {
  sessionId: string;
  metaJson: string;
  transcriptJsonl?: string;
  transcript?: CursorTranscript;
  transcriptPath?: string;
  transcriptMtimeMs?: number;
  storeDbMtimeMs?: number;
  subagentCount?: number;
  store?: CursorStoreEvidence;
  archived?: boolean;
  allowCwdFallback?: boolean;
  nowMs?: number;
  thresholds?: LifecycleThresholds;
}

export interface CursorChildSessionInput {
  sessionId: string;
  parentSessionId: string;
  cwd: string;
  transcriptJsonl: string;
  transcript?: CursorTranscript;
  transcriptPath: string;
  model?: string;
  updatedAtMs: number;
  nowMs?: number;
  thresholds?: LifecycleThresholds;
}

interface CursorConversationRow {
  id?: string;
  title?: string;
  updated_at?: number;
  is_archived?: number;
}

interface CursorLocalProject {
  id?: string;
  workspace?: {
    uri?: {
      fsPath?: string;
      path?: string;
    };
  };
}

type CursorRecord = Record<string, any>;

function jsonlRecords(jsonl: string): CursorRecord[] {
  return jsonl.split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const parsed = JSON.parse(line);
      return parsed && typeof parsed === "object" ? [parsed] : [];
    } catch {
      return [];
    }
  });
}

function messageText(record: CursorRecord): string | undefined {
  const content = record.message?.content;
  if (typeof content === "string") return content.trim() || undefined;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
  return text || undefined;
}

function genericCursorName(name?: string): boolean {
  return !name || /^new agent$/i.test(name.trim());
}

function cursorUserTask(text: string): string {
  const wrappedQuery = text.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i)?.[1];
  return stripTimestampMarkup(wrappedQuery ?? text).trim();
}

function cursorTranscript(jsonl: string): CursorTranscript {
  let task: string | undefined;
  let transcriptTail: string | undefined;
  let turnStatus: string | undefined;
  let user: { index: number; candidate: HumanMessageCandidate } | undefined;
  let assistant: { index: number; candidate: HumanMessageCandidate } | undefined;
  for (const [index, row] of jsonlRecords(jsonl).entries()) {
    const text = messageText(row);
    if (row.role === "user" && text && !task) task = cursorUserTask(text).slice(0, 500);
    if ((row.role === "user" || row.role === "assistant") && row.message?.content !== undefined) {
      const candidate: HumanMessageCandidate = { role: row.role, content: row.message.content };
      if (readableHumanMessage("cursor", candidate.content)) {
        if (candidate.role === "user") user = { index, candidate };
        else assistant = { index, candidate };
      }
    }
    if (row.role === "assistant" && text) transcriptTail = text;
    if (row.type === "turn_ended" && typeof row.status === "string") turnStatus = row.status;
  }
  return {
    task,
    transcriptTail,
    humanMessages: [user, assistant]
      .filter((message): message is NonNullable<typeof message> => Boolean(message))
      .sort((left, right) => left.index - right.index)
      .map(({ candidate }) => candidate),
    turnStatus,
  };
}

export function parseCursorSession(input: CursorSessionInput): CollectedAgent | null {
  if (!UUID_PATTERN.test(input.sessionId)) return null;
  /* JSON.parse("null") SUCCEEDS, so the catch never fired and the next line
     read .hasConversation off null — a TypeError that escaped the per-session
     map callback into collectSessions' bare Promise.all, taking OMP, Codex and
     Claude down with Cursor. One meta.json containing the four characters
     `null` blanked the entire fleet.

     Every other non-object shape was already refused, but only by accident:
     property lookup on a string, number, boolean or array yields undefined, so
     the cwd check caught them. Null is the one shape that throws instead. State
     the requirement rather than relying on that. */
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.metaJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const meta = parsed as CursorMeta;
  if (meta.hasConversation === false || typeof meta.cwd !== "string") return null;
  if (input.store?.agentId && input.store.agentId !== input.sessionId) return null;

  const transcript = input.transcript ?? cursorTranscript(input.transcriptJsonl ?? "");
  const { task, transcriptTail, humanMessages, turnStatus } = transcript;

  const createdAtMs = Number(meta.createdAtMs);
  const updatedAtMs = Number(meta.updatedAtMs);
  const nowMs = input.nowMs ?? Date.now();
  // Liveness rides the freshest available signal so a long streaming turn still
  // reads as "working": the turn-boundary metadata write does not advance mid-turn,
  // but the transcript JSONL and store.db mtimes do. This mirrors how Claude/Codex
  // take max(file mtime, transcript timestamp).
  const freshSignals = [updatedAtMs, input.transcriptMtimeMs, input.storeDbMtimeMs]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const validUpdatedAtMs = freshSignals.length ? Math.max(...freshSignals) : nowMs;
  const ageMs = Math.max(0, nowMs - validUpdatedAtMs);
  const { freshMs, quietMs } = input.thresholds ?? DEFAULT_LIFECYCLE_THRESHOLDS;
  let status: CollectedAgent["status"];
  let statusReason: string;
  if (input.archived) {
    status = "archived";
    statusReason = "Cursor marked this GUI agent archived.";
  } else if (ageMs >= quietMs) {
    status = "stale";
    statusReason = "Cursor session metadata has not changed in 45 minutes.";
  } else if (turnStatus && turnStatus !== "success") {
    /* A failed turn is an OUTCOME, not a lifecycle. This branch used to mint
       status "attention" — the only collector anywhere that did — which meant a
       Cursor error decided what the session WAS rather than how it was doing.
       The failure still reaches the operator, through `gates` below and the
       outcome/attention overlay it drives; what it no longer does is overwrite
       the answer to a different question. The clock decides the lifecycle. */
    status = ageMs < freshMs ? "running" : "waiting";
    statusReason = `Cursor recorded the last turn as ${turnStatus}.`;
  } else if (ageMs < freshMs) {
    // Freshness wins over a stale turn_ended:"success" record. That record is the
    // last completed turn in the cumulative transcript and persists forever, so a
    // newly streaming turn (no new turn_ended yet) must not force the session idle.
    status = "running";
    statusReason = "Cursor session activity is fresh within the last 3 minutes.";
  } else if (turnStatus === "success") {
    status = "waiting";
    statusReason = "Cursor recorded the last turn as successfully ended.";
  } else {
    status = "waiting";
    statusReason = "Cursor session metadata is recent, with no active turn evidence.";
  }

  const taskName = task
    ?.split("\n", 1)[0]
    ?.replace(/^(?:goal|mission|task|objective):\s*/i, "")
    .trim()
    .slice(0, 100);
  const cwdBase = meta.cwd ? basename(meta.cwd.replace(/\/+$/, "")) : "";
  const cwdIdentity = cwdBase ? `Cursor · ${cwdBase}` : "Cursor session";
  // Prefer folder identity over prompt-as-title so the agent lane matches a
  // hunt-able terminal/project name; the task stays in the message lane.
  const displayName = genericCursorName(input.store?.name)
    ? cwdIdentity || taskName || "Cursor session"
    : input.store!.name!.trim();
  return {
    id: `cursor:${input.sessionId}`,
    provider: "cursor",
    sourceSessionId: input.sessionId,
    displayName,
    /* Cursor builds its agents here rather than through `makeAgent`, so the
       resolver has to be called here too — an agent with no `identity` is simply
       skipped by the fleet-wide uniqueness pass, which would quietly leave every
       Cursor session out of the contract. A composer the operator titled is an
       AUTHORED name; `genericCursorName` is what recognises Cursor's own
       placeholder for one nobody titled. Cursor records a single directory per
       session, so there is no drift to freeze against and `cwd` is the origin. */
    identity: resolveAgentName({
      provider: "cursor",
      sourceSessionId: input.sessionId,
      authored: genericCursorName(input.store?.name)
        ? undefined
        : { name: input.store!.name!.trim(), by: "cursor-composer" },
      originCwd: meta.cwd,
      taskName,
    }),
    cwd: meta.cwd,
    originCwd: meta.cwd,
    model: input.store?.model,
    effort: input.store?.effort,
    task,
    status,
    statusReason,
    startedAt: Number.isFinite(createdAtMs) ? new Date(createdAtMs).toISOString() : undefined,
    updatedAt: new Date(validUpdatedAtMs).toISOString(),
    tokens: { scope: "unknown", provenance: "unknown" },
    cost: null,
    subagentCount: input.subagentCount,
    lastHumanMessage: extractLastHumanMessage("cursor", humanMessages, task, statusReason),
    lastUserMessage: extractLastMessageByRole("cursor", humanMessages, "user"),
    lastAgentMessage: extractLastMessageByRole("cursor", humanMessages, "assistant"),
    transcriptTail: transcriptTail?.slice(-MAX_TRANSCRIPT_TAIL_CHARS),
    artifacts: input.transcriptPath
      ? [{ label: "Cursor transcript", path: input.transcriptPath, kind: "transcript" }]
      : [],
    gates: turnStatus && turnStatus !== "success" ? [`Cursor turn: ${turnStatus}`] : [],
    // Cursor speaks both dialects. `is_archived` is the GUI's own record that
    // the conversation is closed; `turn_ended:"success"` is one turn landing.
    endEvidence: input.archived
      ? "session-exit"
      : turnStatus === "success"
        ? "turn-complete"
        : undefined,
    allowCwdFallback: input.allowCwdFallback,
  };
}

export function parseCursorChildSession(input: CursorChildSessionInput): CollectedAgent | null {
  if (!UUID_PATTERN.test(input.sessionId) || !UUID_PATTERN.test(input.parentSessionId)) return null;
  const transcript = input.transcript ?? cursorTranscript(input.transcriptJsonl);
  const { task, transcriptTail, humanMessages, turnStatus } = transcript;

  const nowMs = input.nowMs ?? Date.now();
  const ageMs = Math.max(0, nowMs - input.updatedAtMs);
  const { freshMs, quietMs } = input.thresholds ?? DEFAULT_LIFECYCLE_THRESHOLDS;
  // A non-success turn (aborted/error) stays terminal regardless of freshness, but a
  // fresh transcript (mtime advances mid-turn) wins over a stale turn_ended:"success"
  // so a newly streaming child is not forced idle the instant its first turn ends.
  /* Children now follow the same rules as their parents.

     They did not. A FAILED turn sent a child straight to "stale", and so did a
     SUCCESSFUL one — the two opposite outcomes, one verdict, and the verdict was
     the terminal band. A child that finished its first turn one second ago read
     as forty-five minutes silent. Nearly every Cursor child on this board was
     filed as ended within moments of starting work.

     A turn ending is a turn ending. It rides `endEvidence` below, where the
     classifier can weigh it against the clock and the process, exactly as it
     does for Claude and Codex. */
  const failed = Boolean(turnStatus) && turnStatus !== "success";
  const status: CollectedAgent["status"] =
    ageMs >= quietMs ? "stale"
    : ageMs < freshMs ? "running"
    : "waiting";
  const statusReason =
    failed
      ? `Cursor child recorded the last turn as ${turnStatus}.`
    : ageMs >= quietMs
      ? "Cursor child transcript has not changed in 45 minutes."
    : ageMs < freshMs
      ? "Cursor child transcript changed within the last 3 minutes."
    : turnStatus === "success"
      ? `Cursor child recorded the last turn as ${turnStatus}.`
      : "Cursor child transcript is recent, with no turn end recorded.";
  const taskName = task
    ?.split("\n", 1)[0]
    ?.replace(/^(?:goal|mission|task|objective):\s*/i, "")
    .trim()
    .slice(0, 100);
  const childCwdBase = input.cwd ? basename(input.cwd.replace(/\/+$/, "")) : "";
  const childIdentity = childCwdBase ? `Cursor · ${childCwdBase}` : "Cursor child agent";

  return {
    id: `cursor:${input.sessionId}`,
    provider: "cursor",
    sourceSessionId: input.sessionId,
    displayName: childIdentity || taskName || "Cursor child agent",
    /* Cursor CHILDREN are built here, not by `parseCursorSession` above, and
       were the one population the naming wire missed: 34 of them on the live
       board, every one publishing "Cursor · hd-master-dev-20260723", which is
       precisely the collision the contract exists to remove. They carry no
       authored name, so they resolve to their origin directory and are then
       separated by `disambiguate` — siblings of one parent share a folder by
       definition, so the session tag is the only thing that can tell them
       apart. */
    identity: resolveAgentName({
      provider: "cursor",
      sourceSessionId: input.sessionId,
      originCwd: input.cwd,
      taskName,
    }),
    cwd: input.cwd,
    originCwd: input.cwd,
    model: input.model,
    task,
    status,
    statusReason,
    updatedAt: new Date(input.updatedAtMs).toISOString(),
    tokens: { scope: "unknown", provenance: "unknown" },
    cost: null,
    parentSourceSessionId: input.parentSessionId,
    threadDepth: 1,
    lastHumanMessage: extractLastHumanMessage("cursor", humanMessages, task, statusReason),
    lastUserMessage: extractLastMessageByRole("cursor", humanMessages, "user"),
    lastAgentMessage: extractLastMessageByRole("cursor", humanMessages, "assistant"),
    transcriptTail: transcriptTail?.slice(-MAX_TRANSCRIPT_TAIL_CHARS),
    artifacts: [{ label: "Cursor child transcript", path: input.transcriptPath, kind: "transcript" }],
    gates: turnStatus && turnStatus !== "success" ? [`Cursor child turn: ${turnStatus}`] : [],
    // A child has no archive flag of its own; a successful turn is the only
    // ending it can report, and it is a turn ending.
    endEvidence: turnStatus === "success" ? "turn-complete" : undefined,
    allowCwdFallback: false,
  };
}

function decodeHexJson(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string" || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "hex").toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function syncFileFingerprint(path: string): string | undefined {
  try {
    const details = statSync(path);
    return `${details.dev}:${details.ino}:${details.size}:${details.mtimeMs}`;
  } catch {
    return undefined;
  }
}

function cursorStoreFingerprint(path: string): string | undefined {
  const store = syncFileFingerprint(path);
  if (!store) return undefined;
  return `${store}|wal:${syncFileFingerprint(`${path}-wal`) ?? "absent"}`;
}

async function readCachedText(path: string): Promise<{ contents: string; fingerprint: string; mtimeMs: number }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await stat(path);
    const fingerprint = `${before.dev}:${before.ino}:${before.size}:${before.mtimeMs}`;
    const cached = cursorTextCache.get(path);
    if (cached?.fingerprint === fingerprint) {
      return { contents: cached.contents, fingerprint, mtimeMs: cached.mtimeMs };
    }
    const contents = await readFile(path, "utf8");
    const after = await stat(path);
    const afterFingerprint = `${after.dev}:${after.ino}:${after.size}:${after.mtimeMs}`;
    if (fingerprint !== afterFingerprint) {
      if (attempt === 0) continue;
      throw new Error(`file changed while reading: ${path}`);
    }
    cursorTextCache.set(path, { fingerprint: afterFingerprint, contents, mtimeMs: after.mtimeMs });
    return { contents, fingerprint: afterFingerprint, mtimeMs: after.mtimeMs };
  }
  throw new Error(`could not read stable file: ${path}`);
}

async function readCachedTranscript(path: string): Promise<{
  contents: string;
  transcript: CursorTranscript;
  mtimeMs: number;
}> {
  const file = await readCachedText(path);
  const cached = cursorTranscriptCache.get(path);
  if (cached?.fingerprint === file.fingerprint) {
    return { contents: file.contents, transcript: cached.transcript, mtimeMs: file.mtimeMs };
  }
  const transcript = cursorTranscript(file.contents);
  cursorTranscriptCache.set(path, { fingerprint: file.fingerprint, transcript });
  return { contents: file.contents, transcript, mtimeMs: file.mtimeMs };
}

// The authoritative per-turn model on a CLI assistant message lives on its content
// PARTS (type "reasoning"/"redacted-reasoning"/"text"), not on the message-level
// providerOptions.cursor (which carries only modelProviderMessageId/requestId).
function contentPartModelName(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const part of content) {
    const cursor = asRecord(asRecord(asRecord(part)?.providerOptions)?.cursor);
    const modelName = nonEmptyString(cursor?.modelName);
    if (modelName) return modelName;
  }
  return undefined;
}

function readCursorStoreEvidenceFrom(database: Database): CursorStoreEvidence {
  const metaRow = database.query("select value from meta where key = '0'").get() as
    | { value?: string }
    | null;
  const metadata = decodeHexJson(metaRow?.value);
  // PRIMARY: newer sessions persist the resolved model on meta key '0'.
  const lastUsedModel = nonEmptyString(metadata?.lastUsedModel);
  // FALLBACK: walk the content-addressed message blobs newest-first (rowid is
  // append order) and use only the real per-turn assistant model field.
  let blobModel: string | undefined;
  if (!lastUsedModel) {
    const rows = database
      .query("select data from blobs order by rowid desc limit 200")
      .iterate() as Iterable<{ data: Uint8Array }>;
    for (const row of rows) {
      let message: unknown;
      try {
        message = JSON.parse(Buffer.from(row.data).toString("utf8"));
      } catch {
        // Cursor's content-addressed store also contains non-JSON blobs.
        continue;
      }
      const record = asRecord(message);
      if (!record) continue;
      if (!blobModel && record.role === "assistant") blobModel = contentPartModelName(record.content);
      if (blobModel) break;
    }
  }
  return {
    agentId: typeof metadata?.agentId === "string" ? metadata.agentId : undefined,
    name: typeof metadata?.name === "string" ? metadata.name : undefined,
    mode: typeof metadata?.mode === "string" ? metadata.mode : undefined,
    model: lastUsedModel ?? blobModel,
  };
}

export function readCursorStoreEvidence(path: string): CursorStoreEvidence {
  const fingerprint = cursorStoreFingerprint(path);
  const cached = cursorStoreCache.get(path);
  if (fingerprint && cached?.fingerprint === fingerprint) return { ...cached.evidence };
  let evidence: CursorStoreEvidence;
  try {
    const database = new Database(path, { readonly: true });
    try {
      evidence = readCursorStoreEvidenceFrom(database);
    } finally {
      database.close();
    }
  } catch (error) {
    // Cursor stores are WAL-mode databases. If the read-only handle cannot
    // create/access SQLite's shared-memory sidecar, inspect the main file as
    // immutable evidence without ever opening the provider store writable.
    try {
      const database = new Database(`${pathToFileURL(path).href}?immutable=1`, {
        readonly: true,
      });
      try {
        evidence = readCursorStoreEvidenceFrom(database);
      } finally {
        database.close();
      }
    } catch {
      throw error;
    }
  }
  const afterFingerprint = cursorStoreFingerprint(path);
  if (fingerprint && afterFingerprint === fingerprint) {
    cursorStoreCache.set(path, { fingerprint, evidence });
  } else {
    cursorStoreCache.delete(path);
  }
  return { ...evidence };
}

async function directories(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(path, entry.name));
  } catch {
    return [];
  }
}

async function readableFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function sqliteJson(database: Database, key: string): unknown {
  const row = database.query("select value from ItemTable where key = ?").get(key) as
    | { value?: string | Uint8Array }
    | null;
  if (row?.value === undefined) return undefined;
  const value = typeof row.value === "string"
    ? row.value
    : Buffer.from(row.value).toString("utf8");
  return JSON.parse(value);
}

function guiSessionCwds(database: Database): Map<string, string> {
  const memberships = sqliteJson(database, "glass.localAgentProjectMembership.v1");
  const projects = sqliteJson(database, "glass.localAgentProjects.v1");
  if (!memberships || typeof memberships !== "object" || !Array.isArray(projects)) return new Map();

  const projectCwds = new Map<string, string>();
  for (const project of projects as CursorLocalProject[]) {
    const cwd = project.workspace?.uri?.fsPath ?? project.workspace?.uri?.path;
    if (typeof project.id === "string" && typeof cwd === "string" && cwd.startsWith("/")) {
      projectCwds.set(project.id, cwd);
    }
  }

  const sessionCwds = new Map<string, string>();
  for (const [sessionId, projectId] of Object.entries(memberships as Record<string, unknown>)) {
    if (typeof projectId !== "string") continue;
    const cwd = projectCwds.get(projectId);
    if (cwd) sessionCwds.set(sessionId, cwd);
  }
  return sessionCwds;
}

async function cursorStateEvidence(
  home: string,
  errors: string[],
): Promise<typeof cursorStateCache> {
  const path = join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb");
  if (!(await readableFile(path))) {
    if (cursorStateCache?.path === path) {
      cursorStateCache.database.close();
      cursorStateCache = undefined;
    }
    return undefined;
  }
  const fingerprint = cursorStoreFingerprint(path);
  if (fingerprint && cursorStateCache?.path === path && cursorStateCache.fingerprint === fingerprint) {
    return cursorStateCache;
  }
  cursorStateCache?.database.close();
  cursorStateCache = undefined;
  let database: Database | undefined;
  try {
    database = new Database(path, { readonly: true });
    cursorStateCache = {
      path,
      fingerprint: fingerprint ?? "",
      database,
      sessionCwds: guiSessionCwds(database),
      hasComposerData: database
        .query("select name from sqlite_master where type = 'table' and name = 'cursorDiskKV'")
        .get() !== null,
      composers: new Map(),
    };
    return cursorStateCache;
  } catch (error) {
    database?.close();
    errors.push(`cursor GUI project state: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function cursorTrackingModels(path: string): Map<string, string> {
  const fingerprint = cursorStoreFingerprint(path);
  const cached = cursorTrackingCache.get(path);
  if (fingerprint && cached?.fingerprint === fingerprint) return cached.models;
  const models = new Map<string, string>();
  const database = new Database(path, { readonly: true });
  try {
    const rows = database.query(
      "select conversationId, model from ai_code_hashes where conversationId is not null and model is not null order by timestamp desc, rowid desc",
    ).iterate() as Iterable<{ conversationId?: string; model?: string }>;
    for (const row of rows) {
      if (typeof row.conversationId === "string" && typeof row.model === "string" &&
        !models.has(row.conversationId)) {
        models.set(row.conversationId, row.model);
      }
    }
  } finally {
    database.close();
  }
  const afterFingerprint = cursorStoreFingerprint(path);
  if (fingerprint && afterFingerprint === fingerprint) {
    cursorTrackingCache.set(path, { fingerprint, models });
  } else {
    cursorTrackingCache.delete(path);
  }
  return models;
}

// modelConfig.selectedModels[0].parameters is an [{id,value}] list carrying the
// effort/fast tier a GUI agent was configured with (e.g. {id:"effort",value:"xhigh"}).
function composerEffort(selectedModels: unknown): string | undefined {
  if (!Array.isArray(selectedModels)) return undefined;
  const parameters = asRecord(selectedModels[0])?.parameters;
  if (!Array.isArray(parameters)) return undefined;
  for (const parameter of parameters) {
    const record = asRecord(parameter);
    if (record?.id === "effort") return nonEmptyString(record.value);
  }
  return undefined;
}

// Shared model source keyed purely by session id: composerData:<sessionId>.modelConfig
// covers every family incl. Composer variants and exists for EVERY Cursor session id
// (roots and subagents alike). "default" means "no explicit model", so it is treated as
// unreported. The state.vscdb is a live WAL database; callers open it read-only and may
// lack the cursorDiskKV table on older installs, so the query is guarded.
/* Returning {} for a failed read made it identical to a session that simply
   has no composerData, and an absent model renders as the model policy
   "unreported" — whose summary tells the operator "Cursor did not expose an
   authoritative model for this session". That is a confident claim about
   Cursor's behaviour made from a local failure to read Cursor's database, and
   the two have opposite remedies. Absence still returns {}; a failure now
   throws, so the caller records it against the cursor source instead. */
function composerModelForSession(database: Database, sessionId: string): CursorStoreEvidence {
  let row: { value?: string | Uint8Array } | null;
  try {
    row = database.query("select value from cursorDiskKV where key = ?").get(`composerData:${sessionId}`) as
      | { value?: string | Uint8Array }
      | null;
  } catch (error) {
    throw new Error(
      `composerData lookup failed for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  // No row is a real answer: this session never wrote composerData.
  if (row?.value === undefined || row.value === null) return {};
  let parsed: unknown;
  try {
    const value = typeof row.value === "string" ? row.value : Buffer.from(row.value).toString("utf8");
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(
      `composerData for ${sessionId} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const modelConfig = asRecord(asRecord(parsed)?.modelConfig);
  const modelName = nonEmptyString(modelConfig?.modelName);
  return {
    model: modelName === "default" ? undefined : modelName,
    effort: composerEffort(modelConfig?.selectedModels),
  };
}

function cachedComposerModel(
  state: NonNullable<typeof cursorStateCache> | undefined,
  sessionId: string,
): CursorStoreEvidence {
  if (!state?.hasComposerData) return {};
  const cached = state.composers.get(sessionId);
  if (cached) return cached;
  const evidence = composerModelForSession(state.database, sessionId);
  state.composers.set(sessionId, evidence);
  return evidence;
}

async function cursorChildAgents(
  parent: CollectedAgent,
  transcriptPath: string | undefined,
  trackingModels: ReadonlyMap<string, string>,
  nowMs: number,
  windowMs: number,
  errors: string[] = [],
  thresholds?: LifecycleThresholds,
): Promise<CollectedAgent[]> {
  if (!transcriptPath) return [];
  const directory = join(dirname(transcriptPath), "subagents");
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    /* ENOENT is a parent with genuinely no subagents — the common case, and
       legitimately an empty list. Every other failure (EACCES, ENOTDIR, EMFILE
       under a fleet scan) is a live subagent we could not see, and returning []
       for it removed a running agent from the roster with nothing recorded.
       Every sibling failure path in this file pushes to errors. */
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      errors.push(`cursor subagents at ${directory}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return [];
  }
  const agents = await Promise.all(entries.map(async (entry): Promise<CollectedAgent | null> => {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) return null;
    const sessionId = entry.name.slice(0, -".jsonl".length);
    if (!UUID_PATTERN.test(sessionId)) return null;
    const path = join(directory, entry.name);
    const file = await stat(path);
    if (nowMs - file.mtimeMs > windowMs) return null;
    const evidence = await readCachedTranscript(path);
    return parseCursorChildSession({
      sessionId,
      parentSessionId: parent.sourceSessionId,
      cwd: parent.cwd ?? homedir(),
      transcriptJsonl: evidence.contents,
      transcript: evidence.transcript,
      transcriptPath: path,
      model: trackingModels.get(sessionId),
      updatedAtMs: file.mtimeMs,
      nowMs,
      thresholds,
    });
  }));
  return agents.filter((agent): agent is CollectedAgent => Boolean(agent));
}

async function transcriptEvidence(
  transcriptPath: string | undefined,
): Promise<{
  subagentsError?: string;
  transcriptJsonl?: string;
  transcript?: CursorTranscript;
  subagentCount?: number;
  transcriptMtimeMs?: number;
}> {
  if (!transcriptPath) return {};
  const file = await readCachedTranscript(transcriptPath);
  const transcriptJsonl = file.contents;
  const transcript = file.transcript;
  const transcriptMtimeMs = file.mtimeMs;
  const subagentsDirectory = join(transcriptPath, "../subagents");
  try {
    const subagentCount = (await readdir(subagentsDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .length;
    return { transcriptJsonl, transcript, subagentCount, transcriptMtimeMs };
  } catch (error) {
    /* A parent with no subagents directory really has none, so 0 is right. A
       directory that could not be READ must not borrow that same confident 0 —
       leave the count unknown and name the failure. */
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { transcriptJsonl, transcript, subagentCount: 0, transcriptMtimeMs };
    }
    return {
      transcriptJsonl,
      transcript,
      transcriptMtimeMs,
      subagentsError: `cursor subagents at ${subagentsDirectory}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function findTranscript(
  projects: readonly string[],
  sessionId: string,
  cwd?: string,
): Promise<string | undefined> {
  const cached = cursorTranscriptPaths.get(sessionId);
  if (cached && await readableFile(cached)) return cached;
  cursorTranscriptPaths.delete(sessionId);
  const expectedProject = cwd?.replace(/^\/+/, "").replaceAll("/", "-");
  const orderedProjects = expectedProject
    ? [...projects].sort((left, right) =>
        Number(basename(right) === expectedProject) - Number(basename(left) === expectedProject))
    : projects;
  for (const project of orderedProjects) {
    const path = join(project, "agent-transcripts", sessionId, `${sessionId}.jsonl`);
    if (await readableFile(path)) {
      cursorTranscriptPaths.set(sessionId, path);
      return path;
    }
  }
  return undefined;
}

async function collectCursorGuiSessions(
  home: string,
  projects: readonly string[],
  nowMs: number,
  windowMs: number,
  state: NonNullable<typeof cursorStateCache> | undefined,
  thresholds?: LifecycleThresholds,
): Promise<CollectionResult<CollectedAgent[]>> {
  const errors: string[] = [];
  const agents: CollectedAgent[] = [];
  const globalStorage = join(home, "Library", "Application Support", "Cursor", "User", "globalStorage");
  const conversationPath = join(globalStorage, "conversation-search.db");
  if (!(await readableFile(conversationPath))) return { value: agents, errors };

  let trackingModels = new Map<string, string>();
  const trackingPath = join(home, ".cursor", "ai-tracking", "ai-code-tracking.db");
  if (await readableFile(trackingPath)) {
    try {
      trackingModels = cursorTrackingModels(trackingPath);
    } catch (error) {
      errors.push(`cursor GUI model tracking: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  let conversations: Database | undefined;
  try {
    conversations = new Database(conversationPath, { readonly: true });
    const rows = conversations.query(
      "select id, title, updated_at, is_archived from conversations where source = 'local' and updated_at >= ? order by updated_at desc",
    ).all(nowMs - windowMs) as CursorConversationRow[];
    for (const row of rows) {
      if (typeof row.id !== "string" || !UUID_PATTERN.test(row.id)) continue;
      const cwd = state?.sessionCwds.get(row.id);
      const updatedAtMs = Number(row.updated_at);
      if (!cwd || !Number.isFinite(updatedAtMs)) continue;
      try {
        const transcriptPath = await findTranscript(projects, row.id, cwd);
        const evidence = await transcriptEvidence(transcriptPath);
        if (evidence.subagentsError) errors.push(evidence.subagentsError);
        /* PRIMARY: composerData model; FALLBACK: ai-code-tracking's last model.
           The lookup is enrichment, not existence: a damaged model record must
           degrade the source without deleting the session from the board, so it
           is isolated from the per-row catch below. */
        let composer: CursorStoreEvidence = {};
        try {
          composer = cachedComposerModel(state, row.id);
        } catch (error) {
          errors.push(`cursor GUI ${row.id} composerData: ${error instanceof Error ? error.message : String(error)}`);
        }
        const parsed = parseCursorSession({
          sessionId: row.id,
          metaJson: JSON.stringify({
            createdAtMs: updatedAtMs,
            updatedAtMs,
            cwd,
            hasConversation: true,
          }),
          transcriptJsonl: evidence.transcriptJsonl,
          transcript: evidence.transcript,
          transcriptPath,
          transcriptMtimeMs: evidence.transcriptMtimeMs,
          subagentCount: evidence.subagentCount,
          store: {
            agentId: row.id,
            name: typeof row.title === "string" ? row.title : undefined,
            model: composer.model ?? trackingModels.get(row.id),
            effort: composer.effort,
          },
          archived: row.is_archived === 1,
          allowCwdFallback: false,
          nowMs,
          thresholds,
        });
        if (parsed) {
          agents.push(parsed);
          agents.push(...await cursorChildAgents(parsed, transcriptPath, trackingModels, nowMs, windowMs, errors, thresholds));
        }
      } catch (error) {
        errors.push(`cursor GUI ${row.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    errors.push(`cursor GUI conversations: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    conversations?.close();
  }
  return { value: agents, errors };
}

// Universal last-resort model source. Any collected Cursor session still missing a
// model is filled from composerData keyed by its own session id. This is what covers
// subagents: they are enumerated from a parent's subagents/*.jsonl and otherwise only
// consult ai-code-tracking (which is silent for them), yet composerData holds their
// model. Running here — after every entry path (chats store.db, agent-transcripts,
// conversation-search, subagents) — leaves no path uncovered. Tokens are untouched.
async function fillMissingCursorModels(
  state: NonNullable<typeof cursorStateCache> | undefined,
  agents: CollectedAgent[],
  errors: string[],
): Promise<void> {
  const missing = agents.filter((agent) => !agent.model);
  if (missing.length === 0 || !state?.hasComposerData) return;
  // Per-session isolation: one unreadable record must not stop the remaining
  // sessions from being filled, and each failure is named on its own.
  for (const agent of missing) {
    try {
      const composer = cachedComposerModel(state, agent.sourceSessionId);
      if (!composer.model) continue;
      agent.model = composer.model;
      if (composer.effort && !agent.effort) agent.effort = composer.effort;
    } catch (error) {
      errors.push(`cursor composerData fallback: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export async function collectCursorSessions(
  home = homedir(),
  nowMs = Date.now(),
  windowMs = DEFAULT_CURSOR_SESSION_WINDOW_MS,
  thresholds?: LifecycleThresholds,
): Promise<CollectionResult<CollectedAgent[]>> {
  const errors: string[] = [];
  const agents: CollectedAgent[] = [];
  const [workspaceDirectories, projectDirectories] = await Promise.all([
    directories(join(home, ".cursor/chats")),
    directories(join(home, ".cursor/projects")),
  ]);
  /* No ~/.cursor at all means Cursor was never installed here, which is not a
     fault to report — it is the ordinary state of a machine whose owner uses
     something else. `directories()` already swallows ENOENT, so absence has to
     be asked about directly rather than inferred from an empty list, which a
     freshly-installed Cursor would also produce. */
  const cursorAbsent = !(await pathExists(join(home, ".cursor")));
  const sessionDirectories = (await Promise.all(workspaceDirectories.map(directories))).flat();

  await Promise.all(
    sessionDirectories.map(async (sessionDirectory) => {
      const sessionId = basename(sessionDirectory);
      if (!UUID_PATTERN.test(sessionId)) return;
      const metaPath = join(sessionDirectory, "meta.json");
      // Cursor keeps older content-addressed stores after their chat metadata is
      // gone. Those are not damaged current sessions, so skip them silently.
      if (!(await readableFile(metaPath))) return;
      let metaJson: string;
      let meta: CursorMeta;
      try {
        metaJson = (await readCachedText(metaPath)).contents;
        meta = JSON.parse(metaJson);
      } catch (error) {
        errors.push(`cursor ${sessionId} metadata: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      if (meta.hasConversation === false) return;
      const updatedAtMs = Number(meta.updatedAtMs);
      if (!Number.isFinite(updatedAtMs) || nowMs - updatedAtMs > windowMs) return;

      const storePath = join(sessionDirectory, "store.db");
      let store: CursorStoreEvidence | undefined;
      try {
        store = readCursorStoreEvidence(storePath);
      } catch (error) {
        errors.push(`cursor ${sessionId} store: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (store?.agentId && store.agentId !== sessionId) {
        errors.push(`cursor ${sessionId} store agentId mismatch: ${store.agentId}`);
        return;
      }
      // store.db is rewritten on every streamed event, so its mtime is a live signal.
      let storeDbMtimeMs: number | undefined;
      try {
        storeDbMtimeMs = (await stat(storePath)).mtimeMs;
      } catch {
        // Some retained sessions have no store.db; then it contributes no signal.
      }

      const transcriptPath = await findTranscript(projectDirectories, sessionId, meta.cwd);
      let transcriptJsonl: string | undefined;
      let transcript: CursorTranscript | undefined;
      let subagentCount: number | undefined;
      let transcriptMtimeMs: number | undefined;
      if (transcriptPath) {
        try {
          const evidence = await transcriptEvidence(transcriptPath);
          ({ transcriptJsonl, transcript, subagentCount, transcriptMtimeMs } = evidence);
          /* An unreadable subagents directory is a live agent we could not see.
             Pushed ONCE: this line existed twice, so a single unreadable
             directory reported two faults. Harmless while the health card only
             counted errors; fd20ea3 now prints the first and appends "(+N
             more)", so the duplicate reads as a second, different problem an
             operator would go looking for. */
          if (evidence.subagentsError) errors.push(evidence.subagentsError);
        } catch (error) {
          errors.push(`cursor ${sessionId} transcript: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const parsed = parseCursorSession({
        sessionId,
        metaJson,
        transcriptJsonl,
        transcript,
        transcriptPath,
        transcriptMtimeMs,
        storeDbMtimeMs,
        subagentCount,
        store,
        nowMs,
        thresholds,
      });
      if (parsed) agents.push(parsed);
    }),
  );
  const state = await cursorStateEvidence(home, errors);
  const gui = await collectCursorGuiSessions(home, projectDirectories, nowMs, windowMs, state, thresholds);
  errors.push(...gui.errors);
  const knownIds = new Set(agents.map((agent) => agent.id));
  for (const agent of gui.value) {
    if (!knownIds.has(agent.id)) agents.push(agent);
  }
  await fillMissingCursorModels(state, agents, errors);
  return { value: agents, errors, ...(cursorAbsent ? { absent: true } : {}) };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readdir(path);
    return true;
  } catch (error) {
    // Only ENOENT is absence. An unreadable directory IS here and is a fault.
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
}
