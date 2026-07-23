import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Database } from "bun:sqlite";
import {
  extractLastHumanMessage,
  extractLastMessageByRole,
  type HumanMessageCandidate,
} from "./human-message";
import { MAX_TRANSCRIPT_TAIL_CHARS, type CollectedAgent, type CollectionResult } from "./types";

export const DEFAULT_CURSOR_SESSION_WINDOW_MS = 36 * 60 * 60 * 1_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CursorMeta {
  schemaVersion?: number;
  createdAtMs?: number;
  updatedAtMs?: number;
  cwd?: string;
  hasConversation?: boolean;
}

export interface CursorStoreEvidence {
  agentId?: string;
  name?: string;
  mode?: string;
  model?: string;
}

export interface CursorSessionInput {
  sessionId: string;
  metaJson: string;
  transcriptJsonl?: string;
  transcriptPath?: string;
  transcriptMtimeMs?: number;
  storeDbMtimeMs?: number;
  subagentCount?: number;
  store?: CursorStoreEvidence;
  archived?: boolean;
  allowCwdFallback?: boolean;
  nowMs?: number;
}

export interface CursorChildSessionInput {
  sessionId: string;
  parentSessionId: string;
  cwd: string;
  transcriptJsonl: string;
  transcriptPath: string;
  model?: string;
  updatedAtMs: number;
  nowMs?: number;
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
  return (wrappedQuery ?? text).replace(/<timestamp>[\s\S]*?<\/timestamp>/gi, "").trim();
}

export function parseCursorSession(input: CursorSessionInput): CollectedAgent | null {
  if (!UUID_PATTERN.test(input.sessionId)) return null;
  let meta: CursorMeta;
  try {
    meta = JSON.parse(input.metaJson);
  } catch {
    return null;
  }
  if (meta.hasConversation === false || typeof meta.cwd !== "string") return null;
  if (input.store?.agentId && input.store.agentId !== input.sessionId) return null;

  const rows = jsonlRecords(input.transcriptJsonl ?? "");
  let task: string | undefined;
  let transcriptTail: string | undefined;
  const humanMessages: HumanMessageCandidate[] = [];
  let turnStatus: string | undefined;
  for (const row of rows) {
    const text = messageText(row);
    if (row.role === "user" && text && !task) task = cursorUserTask(text).slice(0, 500);
    if ((row.role === "user" || row.role === "assistant") && row.message?.content !== undefined) {
      humanMessages.push({ role: row.role, content: row.message.content });
    }
    if (row.role === "assistant" && text) transcriptTail = text;
    if (row.type === "turn_ended" && typeof row.status === "string") turnStatus = row.status;
  }

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
  let status: CollectedAgent["status"];
  let statusReason: string;
  if (input.archived) {
    status = "archived";
    statusReason = "Cursor marked this GUI agent archived.";
  } else if (ageMs >= 45 * 60_000) {
    status = "stale";
    statusReason = "Cursor session metadata has not changed in 45 minutes.";
  } else if (turnStatus && turnStatus !== "success") {
    status = "attention";
    statusReason = `Cursor recorded the last turn as ${turnStatus}.`;
  } else if (ageMs < 3 * 60_000) {
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
    cwd: meta.cwd,
    model: input.store?.model,
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
    allowCwdFallback: input.allowCwdFallback,
  };
}

export function parseCursorChildSession(input: CursorChildSessionInput): CollectedAgent | null {
  if (!UUID_PATTERN.test(input.sessionId) || !UUID_PATTERN.test(input.parentSessionId)) return null;
  const rows = jsonlRecords(input.transcriptJsonl);
  let task: string | undefined;
  let transcriptTail: string | undefined;
  const humanMessages: HumanMessageCandidate[] = [];
  let turnStatus: string | undefined;
  for (const row of rows) {
    const text = messageText(row);
    if (row.role === "user" && text && !task) task = cursorUserTask(text).slice(0, 500);
    if ((row.role === "user" || row.role === "assistant") && row.message?.content !== undefined) {
      humanMessages.push({ role: row.role, content: row.message.content });
    }
    if (row.role === "assistant" && text) transcriptTail = text;
    if (row.type === "turn_ended" && typeof row.status === "string") turnStatus = row.status;
  }

  const nowMs = input.nowMs ?? Date.now();
  const ageMs = Math.max(0, nowMs - input.updatedAtMs);
  // A non-success turn (aborted/error) stays terminal regardless of freshness, but a
  // fresh transcript (mtime advances mid-turn) wins over a stale turn_ended:"success"
  // so a newly streaming child is not forced idle the instant its first turn ends.
  const failed = Boolean(turnStatus) && turnStatus !== "success";
  const status: CollectedAgent["status"] =
    failed ? "stale"
    : ageMs >= 45 * 60_000 ? "stale"
    : ageMs < 3 * 60_000 ? "running"
    : turnStatus === "success" ? "stale"
    : "waiting";
  const statusReason =
    failed
      ? `Cursor child recorded the last turn as ${turnStatus}.`
    : ageMs >= 45 * 60_000
      ? "Cursor child transcript has not changed in 45 minutes."
    : ageMs < 3 * 60_000
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
    cwd: input.cwd,
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

function cursorModelFromSystemMessage(content: unknown): string | undefined {
  if (typeof content !== "string") return undefined;
  const match = content.match(/powered by (Cursor\s+[A-Za-z][A-Za-z0-9 _-]*?\d(?:\.\d+)+)/i);
  return match?.[1]?.trim();
}

function readCursorStoreEvidenceFrom(database: Database): CursorStoreEvidence {
  const metaRow = database.query("select value from meta where key = '0'").get() as
    | { value?: string }
    | null;
  const metadata = decodeHexJson(metaRow?.value);
  let model: string | undefined;
  const rows = database
    .query("select data from blobs where substr(data, 1, 1) = x'7B'")
    .all() as { data: Uint8Array }[];
  for (const row of rows) {
    try {
      const message = JSON.parse(Buffer.from(row.data).toString("utf8"));
      if (message?.role === "system") {
        model = cursorModelFromSystemMessage(message.content);
        if (model) break;
      }
    } catch {
      // Cursor's content-addressed store also contains non-JSON blobs.
    }
  }
  return {
    agentId: typeof metadata?.agentId === "string" ? metadata.agentId : undefined,
    name: typeof metadata?.name === "string" ? metadata.name : undefined,
    mode: typeof metadata?.mode === "string" ? metadata.mode : undefined,
    model,
  };
}

export function readCursorStoreEvidence(path: string): CursorStoreEvidence {
  try {
    const database = new Database(path, { readonly: true });
    try {
      return readCursorStoreEvidenceFrom(database);
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
        return readCursorStoreEvidenceFrom(database);
      } finally {
        database.close();
      }
    } catch {
      throw error;
    }
  }
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

function latestCursorModel(database: Database | undefined, sessionId: string): string | undefined {
  if (!database) return undefined;
  const row = database.query(
    "select model from ai_code_hashes where conversationId = ? and model is not null order by timestamp desc, rowid desc limit 1",
  ).get(sessionId) as { model?: string } | null;
  return typeof row?.model === "string" ? row.model : undefined;
}

async function cursorChildAgents(
  parent: CollectedAgent,
  transcriptPath: string | undefined,
  tracking: Database | undefined,
  nowMs: number,
  windowMs: number,
): Promise<CollectedAgent[]> {
  if (!transcriptPath) return [];
  const directory = join(dirname(transcriptPath), "subagents");
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const agents: CollectedAgent[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const sessionId = entry.name.slice(0, -".jsonl".length);
    if (!UUID_PATTERN.test(sessionId)) continue;
    const path = join(directory, entry.name);
    const file = await stat(path);
    if (nowMs - file.mtimeMs > windowMs) continue;
    const parsed = parseCursorChildSession({
      sessionId,
      parentSessionId: parent.sourceSessionId,
      cwd: parent.cwd ?? homedir(),
      transcriptJsonl: await readFile(path, "utf8"),
      transcriptPath: path,
      model: latestCursorModel(tracking, sessionId),
      updatedAtMs: file.mtimeMs,
      nowMs,
    });
    if (parsed) agents.push(parsed);
  }
  return agents;
}

async function transcriptEvidence(
  transcriptPath: string | undefined,
): Promise<{ transcriptJsonl?: string; subagentCount?: number; transcriptMtimeMs?: number }> {
  if (!transcriptPath) return {};
  const transcriptJsonl = await readFile(transcriptPath, "utf8");
  let transcriptMtimeMs: number | undefined;
  try {
    transcriptMtimeMs = (await stat(transcriptPath)).mtimeMs;
  } catch {
    // A transcript we could read but not stat simply contributes no mtime signal.
  }
  try {
    const subagentCount = (await readdir(join(transcriptPath, "../subagents"), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .length;
    return { transcriptJsonl, subagentCount, transcriptMtimeMs };
  } catch {
    return { transcriptJsonl, subagentCount: 0, transcriptMtimeMs };
  }
}

async function findTranscript(
  projects: readonly string[],
  sessionId: string,
  cwd?: string,
): Promise<string | undefined> {
  const expectedProject = cwd?.replace(/^\/+/, "").replaceAll("/", "-");
  const orderedProjects = expectedProject
    ? [...projects].sort((left, right) =>
        Number(basename(right) === expectedProject) - Number(basename(left) === expectedProject))
    : projects;
  for (const project of orderedProjects) {
    const path = join(project, "agent-transcripts", sessionId, `${sessionId}.jsonl`);
    if (await readableFile(path)) return path;
  }
  return undefined;
}

async function collectCursorGuiSessions(
  home: string,
  projects: readonly string[],
  nowMs: number,
  windowMs: number,
): Promise<CollectionResult<CollectedAgent[]>> {
  const errors: string[] = [];
  const agents: CollectedAgent[] = [];
  const globalStorage = join(home, "Library", "Application Support", "Cursor", "User", "globalStorage");
  const conversationPath = join(globalStorage, "conversation-search.db");
  if (!(await readableFile(conversationPath))) return { value: agents, errors };

  const statePath = join(globalStorage, "state.vscdb");
  let sessionCwds = new Map<string, string>();
  if (await readableFile(statePath)) {
    try {
      const state = new Database(statePath, { readonly: true });
      try {
        sessionCwds = guiSessionCwds(state);
      } finally {
        state.close();
      }
    } catch (error) {
      errors.push(`cursor GUI project state: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  let tracking: Database | undefined;
  const trackingPath = join(home, ".cursor", "ai-tracking", "ai-code-tracking.db");
  if (await readableFile(trackingPath)) {
    try {
      tracking = new Database(trackingPath, { readonly: true });
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
      const cwd = sessionCwds.get(row.id);
      const updatedAtMs = Number(row.updated_at);
      if (!cwd || !Number.isFinite(updatedAtMs)) continue;
      try {
        const transcriptPath = await findTranscript(projects, row.id, cwd);
        const evidence = await transcriptEvidence(transcriptPath);
        const parsed = parseCursorSession({
          sessionId: row.id,
          metaJson: JSON.stringify({
            createdAtMs: updatedAtMs,
            updatedAtMs,
            cwd,
            hasConversation: true,
          }),
          transcriptJsonl: evidence.transcriptJsonl,
          transcriptPath,
          transcriptMtimeMs: evidence.transcriptMtimeMs,
          subagentCount: evidence.subagentCount,
          store: {
            agentId: row.id,
            name: typeof row.title === "string" ? row.title : undefined,
            model: latestCursorModel(tracking, row.id),
          },
          archived: row.is_archived === 1,
          allowCwdFallback: false,
          nowMs,
        });
        if (parsed) {
          agents.push(parsed);
          agents.push(...await cursorChildAgents(parsed, transcriptPath, tracking, nowMs, windowMs));
        }
      } catch (error) {
        errors.push(`cursor GUI ${row.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    errors.push(`cursor GUI conversations: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    conversations?.close();
    tracking?.close();
  }
  return { value: agents, errors };
}

export async function collectCursorSessions(
  home = homedir(),
  nowMs = Date.now(),
  windowMs = DEFAULT_CURSOR_SESSION_WINDOW_MS,
): Promise<CollectionResult<CollectedAgent[]>> {
  const errors: string[] = [];
  const agents: CollectedAgent[] = [];
  const [workspaceDirectories, projectDirectories] = await Promise.all([
    directories(join(home, ".cursor/chats")),
    directories(join(home, ".cursor/projects")),
  ]);
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
        metaJson = await readFile(metaPath, "utf8");
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
      let subagentCount: number | undefined;
      let transcriptMtimeMs: number | undefined;
      if (transcriptPath) {
        try {
          ({ transcriptJsonl, subagentCount, transcriptMtimeMs } = await transcriptEvidence(transcriptPath));
        } catch (error) {
          errors.push(`cursor ${sessionId} transcript: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const parsed = parseCursorSession({
        sessionId,
        metaJson,
        transcriptJsonl,
        transcriptPath,
        transcriptMtimeMs,
        storeDbMtimeMs,
        subagentCount,
        store,
        nowMs,
      });
      if (parsed) agents.push(parsed);
    }),
  );
  const gui = await collectCursorGuiSessions(home, projectDirectories, nowMs, windowMs);
  errors.push(...gui.errors);
  const knownIds = new Set(agents.map((agent) => agent.id));
  for (const agent of gui.value) {
    if (!knownIds.has(agent.id)) agents.push(agent);
  }
  return { value: agents, errors };
}
