import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { TokenUsage } from "../shared/types";
import { instanceIdFor, type CollectorKind } from "./collector-instances";
import { claudeContextWindow, makeAgent, type ParseMetadata } from "./collectors";
import {
  ForeignSqliteReadError,
  foreignSqliteFailureMessage,
  readForeignSqlite,
} from "./foreign-sqlite";
import type { HumanMessageCandidate } from "./human-message";
import type { LifecycleThresholds } from "./lifecycle";
import type { CollectedAgent, CollectionResult } from "./types";

type JsonRecord = Record<string, unknown>;
type SurfaceLabel = "CLI" | "Desktop" | "IDE";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNKNOWN_TOKENS: TokenUsage = { scope: "unknown", provenance: "unknown" };
const PLACEHOLDER_MODEL = /placeholder/i;
const USER_TYPES = new Set(["USER_INPUT"]);
const ASSISTANT_TYPES = new Set(["PLANNER_RESPONSE"]);
const IGNORED_TYPES = new Set(["VIEW_FILE", "EPHEMERAL_MESSAGE", "CONVERSATION_HISTORY"]);

interface SurfaceRoot {
  root: string;
  label: SurfaceLabel;
  kind: CollectorKind;
}

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

function iso(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

export function unwrapUserRequest(content: string): string {
  const match = content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i);
  return (match?.[1] ?? content).trim();
}

export function extractFilePath(value: unknown): string | undefined {
  const blob = typeof value === "string"
    ? value
    : value instanceof Uint8Array
      ? Buffer.from(value).toString("utf8")
      : Buffer.isBuffer(value)
        ? value.toString("utf8")
        : "";
  const match = blob.match(/file:\/\/(\/[A-Za-z0-9._\-\/]+)/);
  if (!match) return undefined;
  const path = match[1].replace(/\/+$/, "");
  return path.length > 1 ? path : undefined;
}

function surfaceFor(root: string): SurfaceRoot {
  const base = basename(root);
  if (base === "antigravity-cli" || root.endsWith("/antigravity-cli")) {
    return { root, label: "CLI", kind: "antigravity-cli" };
  }
  if (base === "antigravity-ide" || root.endsWith("/antigravity-ide")) {
    return { root, label: "IDE", kind: "antigravity-ide" };
  }
  return { root, label: "Desktop", kind: "antigravity-desktop" };
}

export function defaultAntigravityTrees(home: string): SurfaceRoot[] {
  return [
    { root: join(home, ".gemini/antigravity-cli"), label: "CLI", kind: "antigravity-cli" },
    { root: join(home, ".gemini/antigravity"), label: "Desktop", kind: "antigravity-desktop" },
    { root: join(home, ".gemini/antigravity-ide"), label: "IDE", kind: "antigravity-ide" },
  ];
}

function transcriptRows(jsonl: string): JsonRecord[] {
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

function cwdFromBlob(value: unknown): string | undefined {
  return extractFilePath(value);
}

async function readTranscript(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
}

function parseTranscript(jsonl: string): {
  messages: HumanMessageCandidate[];
  task?: string;
  tail?: string;
  startedAt?: string;
  updatedAt?: string;
  cwd?: string;
} {
  const messages: HumanMessageCandidate[] = [];
  let task: string | undefined;
  let tail: string | undefined;
  let startedAt: string | undefined;
  let updatedAt: string | undefined;
  let cwd: string | undefined;
  for (const row of transcriptRows(jsonl)) {
    const at = iso(row.created_at);
    if (at) {
      startedAt = earlier(startedAt, at);
      updatedAt = later(updatedAt, at);
    }
    const type = text(row.type);
    const content = text(row.content);
    if (!type || IGNORED_TYPES.has(type)) continue;
    if (content) cwd ??= extractFilePath(content);
    if (USER_TYPES.has(type) && content) {
      const body = unwrapUserRequest(content);
      if (body) {
        task ??= body;
        messages.push({ role: "user", content: body, timestamp: at });
      }
      continue;
    }
    if (ASSISTANT_TYPES.has(type) && content) {
      tail = content;
      messages.push({ role: "assistant", content, timestamp: at });
    }
  }
  return { messages, task, tail, startedAt, updatedAt, cwd };
}

function readDbHints(path: string): { cwd?: string; model?: string } {
  return readForeignSqlite(path, (database) => {
    const tables = new Set(
      (database.query("select name from sqlite_master where type='table'").all() as Array<{ name?: string }>)
        .map((row) => text(row.name))
        .filter((name): name is string => Boolean(name)),
    );
    if (!tables.has("trajectory_meta") && !tables.has("trajectory_metadata_blob")) {
      throw new ForeignSqliteReadError("schema", "not an Antigravity conversation");
    }
    let cwd: string | undefined;
    let model: string | undefined;
    try {
      const blobs = database.query("select * from trajectory_metadata_blob").all() as JsonRecord[];
      for (const row of blobs) {
        for (const value of Object.values(row)) {
          cwd ??= cwdFromBlob(value);
        }
      }
    } catch {
      // Schema may omit the blob table on a fixture that only proves existence.
    }
    try {
      const meta = database.query("select * from trajectory_meta limit 1").get() as JsonRecord | null;
      const candidate = text(meta?.last_selected_agent_model) ?? text(meta?.model);
      if (candidate && !PLACEHOLDER_MODEL.test(candidate)) model = candidate;
    } catch {
      // trajectory_meta is optional for the existence fixture.
    }
    return { cwd, model };
  });
}

async function collectConversation(
  dbPath: string,
  surface: SurfaceRoot,
  windowMs: number,
  thresholds: LifecycleThresholds | undefined,
  nowMs: number,
  errors: string[],
): Promise<CollectedAgent | undefined> {
  const stem = basename(dbPath, ".db");
  if (!UUID.test(stem)) return undefined;
  const sourceSessionId = stem.toLowerCase();
  const transcriptPath = join(
    surface.root,
    "brain",
    sourceSessionId,
    ".system_generated",
    "logs",
    "transcript.jsonl",
  );

  let transcript: ReturnType<typeof parseTranscript> | undefined;
  try {
    const jsonl = await readTranscript(transcriptPath);
    if (jsonl !== undefined) transcript = parseTranscript(jsonl);
  } catch (error) {
    errors.push(`antigravity ${transcriptPath}: ${describe(error)}`);
  }

  let hints: { cwd?: string; model?: string } = {};
  try {
    hints = readDbHints(dbPath);
  } catch (error) {
    if (error instanceof ForeignSqliteReadError && error.kind === "absent") return undefined;
    errors.push(`antigravity ${dbPath}: ${foreignSqliteFailureMessage(error, "conversation unread")}`);
    if (!transcript) return undefined;
  }

  let updatedAt = transcript?.updatedAt;
  let startedAt = transcript?.startedAt;
  if (!updatedAt) {
    try {
      updatedAt = new Date((await stat(dbPath)).mtimeMs).toISOString();
    } catch {
      return undefined;
    }
  }
  if (nowMs - Date.parse(updatedAt) > windowMs) return undefined;

  const meta: ParseMetadata = {
    sourcePath: transcript ? transcriptPath : dbPath,
    nowMs,
    thresholds,
  };
  const contextWindow = claudeContextWindow(hints.model);
  const tokens: TokenUsage = contextWindow !== undefined
    ? { scope: "unknown", provenance: "unknown", contextWindow }
    : UNKNOWN_TOKENS;
  const agent = makeAgent({
    provider: "antigravity",
    sourceSessionId,
    displayName: undefined,
    cwd: transcript?.cwd ?? hints.cwd,
    model: hints.model,
    task: transcript?.task,
    startedAt,
    updatedAt,
    tokens,
    transcriptTail: transcript?.tail,
    humanMessages: transcript?.messages ?? [],
    meta,
  });
  agent.instanceId = instanceIdFor(surface.kind, surface.root);
  agent.instanceLabel = surface.label;
  if (surface.label === "IDE") agent.allowCwdFallback = false;
  return agent;
}

async function collectSurface(
  surface: SurfaceRoot,
  windowMs: number,
  thresholds: LifecycleThresholds | undefined,
  nowMs: number,
): Promise<CollectionResult<CollectedAgent[]>> {
  try {
    await readdir(surface.root);
  } catch (error) {
    if (missing(error)) return { value: [], errors: [], absent: true };
    return { value: [], errors: [`antigravity ${surface.root}: ${describe(error)}`] };
  }

  const conversations = join(surface.root, "conversations");
  let entries;
  try {
    entries = await readdir(conversations, { withFileTypes: true });
  } catch (error) {
    if (missing(error)) return { value: [], errors: [] };
    return { value: [], errors: [`antigravity ${conversations}: ${describe(error)}`] };
  }

  const errors: string[] = [];
  const agents: CollectedAgent[] = [];
  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".db") && !entry.name.includes("-wal") && !entry.name.includes("-shm"))
    .map(async (entry) => {
      const agent = await collectConversation(
        join(conversations, entry.name),
        surface,
        windowMs,
        thresholds,
        nowMs,
        errors,
      );
      if (agent) agents.push(agent);
    }));
  return { value: agents, errors };
}

export async function collectAntigravitySessions(
  roots: readonly string[],
  nowMs: number,
  windowMs: number,
  thresholds?: LifecycleThresholds,
): Promise<CollectionResult<CollectedAgent[]>> {
  if (roots.length === 0) return { value: [], errors: [], absent: true };

  const agents: CollectedAgent[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  let anyPresent = false;

  for (const root of roots) {
    const surface = surfaceFor(root);
    const collected = await collectSurface(surface, windowMs, thresholds, nowMs);
    if (!collected.absent) anyPresent = true;
    errors.push(...collected.errors);
    for (const agent of collected.value) {
      if (seen.has(agent.id)) continue;
      seen.add(agent.id);
      agents.push(agent);
    }
  }

  return {
    value: agents,
    errors,
    ...(anyPresent ? {} : { absent: true }),
  };
}
