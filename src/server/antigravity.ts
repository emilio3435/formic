import type { Dirent } from "node:fs";
import { open, opendir, stat } from "node:fs/promises";
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
/* Current Antigravity CLI stores the selected model only inside gen_metadata
   protobuf blobs: top-level field 19 is the base model id and field 28 the
   model+effort variant. trajectory_meta.last_selected_agent_model, when a
   store still has it, remains the preferred source. */
const BLOB_MODEL_FIELD_BASE = 19;
const BLOB_MODEL_FIELD_VARIANT = 28;
const BLOB_MODEL_VALUE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;
const BLOB_SCAN_MAX_BYTES = 8_000_000;
const GEN_METADATA_SCAN_MAX_BYTES = BLOB_SCAN_MAX_BYTES;
const GEN_METADATA_CANDIDATE_LIMIT = 64;
const LEGACY_METADATA_CANDIDATE_LIMIT = GEN_METADATA_CANDIDATE_LIMIT;
const DIRECTORY_ENTRY_LIMIT = 64;
const TRANSCRIPT_SCAN_MAX_BYTES = BLOB_SCAN_MAX_BYTES;
const TRANSCRIPT_READ_CHUNK_BYTES = 64_000;
const CONVERSATION_CONCURRENCY = 4;
const USER_TYPES = new Set(["USER_INPUT"]);
const ASSISTANT_TYPES = new Set(["PLANNER_RESPONSE"]);
const IGNORED_TYPES = new Set(["VIEW_FILE", "EPHEMERAL_MESSAGE", "CONVERSATION_HISTORY"]);

interface SurfaceRoot {
  root: string;
  label: SurfaceLabel;
  kind: CollectorKind;
}

export interface AntigravityCollectOptions {
  signal?: AbortSignal;
  deadlineAtMs?: number;
  testHooks?: {
    now?: () => number;
    onBlobAdmitted?: (bytes: number) => void;
    onLegacyBlobAdmitted?: (bytes: number) => void;
    onDirectoryEntryRead?: (path: string, name: string) => void;
    onTranscriptBytesRead?: (bytes: number) => void;
    afterDirectoryClose?: (path: string) => void;
    afterTranscriptClose?: (path: string) => void;
    beforeConversation?: (path: string) => void | Promise<void>;
    afterConversation?: (path: string) => void;
  };
}

interface BoundedDirectoryEntries {
  entries: Dirent[];
  truncated: boolean;
  deadlineReached: boolean;
}

interface BoundedTranscript {
  jsonl?: string;
  incomplete?: string;
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

function throwIfAborted(options: AntigravityCollectOptions): void {
  if (options.signal?.aborted) throw options.signal.reason;
}

function deadlineExpired(options: AntigravityCollectOptions): boolean {
  return options.deadlineAtMs !== undefined
    && (options.testHooks?.now ?? Date.now)() >= options.deadlineAtMs;
}

async function boundedDirectoryEntries(
  path: string,
  options: AntigravityCollectOptions,
): Promise<BoundedDirectoryEntries> {
  throwIfAborted(options);
  await stat(path);
  throwIfAborted(options);
  const directory = await opendir(path);
  const entries: Dirent[] = [];
  const readEntries = async (): Promise<BoundedDirectoryEntries> => {
    let exhausted = false;
    if (deadlineExpired(options)) {
      return { entries: [], truncated: false, deadlineReached: true };
    }
    while (entries.length < DIRECTORY_ENTRY_LIMIT) {
      throwIfAborted(options);
      if (deadlineExpired(options)) {
        return { entries, truncated: false, deadlineReached: true };
      }
      const entry = await directory.read();
      throwIfAborted(options);
      if (!entry) {
        exhausted = true;
        break;
      }
      options.testHooks?.onDirectoryEntryRead?.(path, entry.name);
      throwIfAborted(options);
      if (deadlineExpired(options)) {
        return { entries, truncated: false, deadlineReached: true };
      }
      entries.push(entry);
    }
    if (!exhausted && entries.length === DIRECTORY_ENTRY_LIMIT) {
      throwIfAborted(options);
      if (deadlineExpired(options)) {
        return { entries, truncated: false, deadlineReached: true };
      }
      const witness = await directory.read();
      throwIfAborted(options);
      if (witness) {
        options.testHooks?.onDirectoryEntryRead?.(path, witness.name);
        throwIfAborted(options);
        if (deadlineExpired(options)) {
          return { entries, truncated: false, deadlineReached: true };
        }
        return { entries, truncated: true, deadlineReached: false };
      }
    }
    return { entries, truncated: false, deadlineReached: false };
  };
  let result: BoundedDirectoryEntries;
  try {
    result = await readEntries();
  } finally {
    try {
      await directory.close();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ERR_DIR_CLOSED") throw error;
    }
    options.testHooks?.afterDirectoryClose?.(path);
  }
  throwIfAborted(options);
  return deadlineExpired(options)
    ? { entries: result.entries, truncated: false, deadlineReached: true }
    : result;
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

function transcriptRows(jsonl: string): { rows: JsonRecord[]; malformed: boolean } {
  const rows: JsonRecord[] = [];
  let malformed = false;
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = record(JSON.parse(line));
      if (row) rows.push(row);
      else malformed = true;
    } catch {
      malformed = true;
    }
  }
  return { rows, malformed };
}

function cwdFromBlob(value: unknown): string | undefined {
  return extractFilePath(value);
}

async function readTranscript(
  path: string,
  options: AntigravityCollectOptions,
): Promise<BoundedTranscript> {
  throwIfAborted(options);
  if (deadlineExpired(options)) {
    return {
      incomplete: "transcript deadline reached before byte admission; remaining transcript evidence is incomplete",
    };
  }
  let file: Awaited<ReturnType<typeof open>>;
  try {
    file = await open(path, "r");
  } catch (error) {
    if (missing(error)) return {};
    throw error;
  }
  const buffer = Buffer.allocUnsafe(TRANSCRIPT_SCAN_MAX_BYTES + 1);
  let admittedBytes = 0;
  const readBounded = async (): Promise<BoundedTranscript> => {
    while (admittedBytes < buffer.length) {
      throwIfAborted(options);
      if (deadlineExpired(options)) {
        return {
          ...(admittedBytes > 0
            ? { jsonl: buffer.subarray(0, admittedBytes).toString("utf8") }
            : {}),
          incomplete: `transcript deadline reached after ${admittedBytes} bytes admitted; remaining transcript evidence is incomplete`,
        };
      }
      const length = Math.min(
        TRANSCRIPT_READ_CHUNK_BYTES,
        buffer.length - admittedBytes,
      );
      const read = await file.read(buffer, admittedBytes, length, admittedBytes);
      throwIfAborted(options);
      if (read.bytesRead === 0) break;
      admittedBytes += read.bytesRead;
      options.testHooks?.onTranscriptBytesRead?.(read.bytesRead);
      throwIfAborted(options);
      if (deadlineExpired(options)) {
        return {
          jsonl: buffer.subarray(0, Math.min(admittedBytes, TRANSCRIPT_SCAN_MAX_BYTES)).toString("utf8"),
          incomplete: `transcript deadline reached after ${admittedBytes} bytes admitted; remaining transcript evidence is incomplete`,
        };
      }
    }
    return {
      ...(admittedBytes > 0
        ? {
          jsonl: buffer.subarray(
            0,
            Math.min(admittedBytes, TRANSCRIPT_SCAN_MAX_BYTES),
          ).toString("utf8"),
        }
        : { jsonl: "" }),
      ...(admittedBytes > TRANSCRIPT_SCAN_MAX_BYTES
        ? {
          incomplete: `transcript byte budget of ${TRANSCRIPT_SCAN_MAX_BYTES} reached after ${admittedBytes} bytes read; remaining transcript evidence is incomplete`,
        }
        : {}),
    };
  };
  let result: BoundedTranscript;
  try {
    result = await readBounded();
  } finally {
    await file.close();
    options.testHooks?.afterTranscriptClose?.(path);
  }
  throwIfAborted(options);
  return deadlineExpired(options)
    ? {
        ...(result.jsonl !== undefined ? { jsonl: result.jsonl } : {}),
        incomplete: "transcript deadline reached during close; remaining transcript evidence is incomplete",
      }
    : result;
}

function parseTranscript(jsonl: string): {
  messages: HumanMessageCandidate[];
  task?: string;
  tail?: string;
  startedAt?: string;
  updatedAt?: string;
  cwd?: string;
  incomplete?: string;
} {
  const messages: HumanMessageCandidate[] = [];
  let task: string | undefined;
  let tail: string | undefined;
  let startedAt: string | undefined;
  let updatedAt: string | undefined;
  let cwd: string | undefined;
  const parsed = transcriptRows(jsonl);
  for (const row of parsed.rows) {
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
  return {
    messages,
    task,
    tail,
    startedAt,
    updatedAt,
    cwd,
    ...(parsed.malformed
      ? { incomplete: "transcript contains a malformed JSONL record; remaining transcript evidence is incomplete" }
      : {}),
  };
}

function blobModel(blob: Uint8Array): string | undefined {
  if (blob.byteLength > BLOB_SCAN_MAX_BYTES) return undefined;
  let base: string | undefined;
  let variant: string | undefined;
  // The live CLI wraps the generation message in a top-level field, so the
  // model fields sit one level down; depth 2 covers both shapes without
  // letting arbitrary bytes recurse unboundedly.
  const walk = (bytes: Uint8Array, depth: number): void => {
    let at = 0;
    const varint = (): number | undefined => {
      let value = 0;
      for (let shift = 0; shift < 35; shift += 7) {
        if (at >= bytes.length) return undefined;
        const byte = bytes[at]!;
        at += 1;
        value += (byte & 0x7f) * 2 ** shift;
        if ((byte & 0x80) === 0) return value;
      }
      return undefined;
    };
    while (at < bytes.length) {
      const tag = varint();
      if (tag === undefined) break;
      const field = Math.floor(tag / 8);
      const wire = tag % 8;
      if (wire === 0) {
        if (varint() === undefined) break;
      } else if (wire === 1) {
        at += 8;
      } else if (wire === 5) {
        at += 4;
      } else if (wire === 2) {
        const length = varint();
        if (length === undefined || at + length > bytes.length) break;
        const body = bytes.subarray(at, at + length);
        if (field === BLOB_MODEL_FIELD_BASE || field === BLOB_MODEL_FIELD_VARIANT) {
          const value = new TextDecoder().decode(body);
          if (BLOB_MODEL_VALUE.test(value)) {
            if (field === BLOB_MODEL_FIELD_BASE) base = value;
            else variant = value;
          }
        } else if (depth < 2) {
          walk(body, depth + 1);
        }
        at += length;
      } else {
        break;
      }
    }
  };
  walk(blob, 0);
  return base ?? variant;
}

function readDbHints(
  path: string,
  options: AntigravityCollectOptions,
): { cwd?: string; model?: string; incomplete?: string } {
  throwIfAborted(options);
  return readForeignSqlite(path, (database) => {
    const tableExists = (name: string): boolean => Boolean(database.query(`
      select 1 as present
      from sqlite_master
      where type = 'table' and name = ?
      limit 1
    `).get(name));
    const hasTrajectoryMeta = tableExists("trajectory_meta");
    const hasTrajectoryMetadataBlob = tableExists("trajectory_metadata_blob");
    const hasGenMetadata = tableExists("gen_metadata");
    if (!hasTrajectoryMeta && !hasTrajectoryMetadataBlob) {
      throw new ForeignSqliteReadError("schema", "not an Antigravity conversation");
    }
    let cwd: string | undefined;
    let model: string | undefined;
    let incomplete: string | undefined;
    if (hasTrajectoryMetadataBlob) {
      try {
        const rows = database.query(`
          select rowid as native_rowid, length(cast(data as blob)) as value_bytes
          from trajectory_metadata_blob
          order by rowid asc
          limit ${LEGACY_METADATA_CANDIDATE_LIMIT + 1}
        `).all() as JsonRecord[];
        let admittedBytes = 0;
        for (const row of rows.slice(0, LEGACY_METADATA_CANDIDATE_LIMIT)) {
          throwIfAborted(options);
          if (deadlineExpired(options)) {
            incomplete ??= `trajectory_metadata_blob deadline reached after ${admittedBytes} bytes admitted; remaining cwd evidence is incomplete`;
            break;
          }
          const rowid = row.native_rowid;
          const valueBytes = row.value_bytes;
          if (
            (typeof rowid !== "number" && typeof rowid !== "bigint") ||
            !Number.isSafeInteger(valueBytes) ||
            (valueBytes as number) < 0
          ) {
            continue;
          }
          if ((valueBytes as number) > BLOB_SCAN_MAX_BYTES) {
            incomplete ??= `trajectory_metadata_blob value byte budget of ${BLOB_SCAN_MAX_BYTES} exceeded; remaining cwd evidence is incomplete`;
            continue;
          }
          if ((valueBytes as number) > BLOB_SCAN_MAX_BYTES - admittedBytes) {
            incomplete ??= `trajectory_metadata_blob aggregate byte budget of ${BLOB_SCAN_MAX_BYTES} would be exceeded after ${admittedBytes} bytes admitted; remaining cwd evidence is incomplete`;
            break;
          }
          const valueRow = database.query(`
            select substr(cast(data as blob), 1, ${BLOB_SCAN_MAX_BYTES + 1}) as data
            from trajectory_metadata_blob
            where rowid = ?
            limit 1
          `).get(rowid) as JsonRecord | null;
          throwIfAborted(options);
          if (deadlineExpired(options)) {
            incomplete ??= `trajectory_metadata_blob deadline reached after ${admittedBytes} bytes admitted; remaining cwd evidence is incomplete`;
            break;
          }
          const data = valueRow?.data;
          if (!(data instanceof Uint8Array)) continue;
          if (data.byteLength > BLOB_SCAN_MAX_BYTES - admittedBytes) {
            incomplete ??= `trajectory_metadata_blob aggregate byte budget of ${BLOB_SCAN_MAX_BYTES} would be exceeded after ${admittedBytes} bytes admitted; remaining cwd evidence is incomplete`;
            break;
          }
          admittedBytes += data.byteLength;
          options.testHooks?.onLegacyBlobAdmitted?.(data.byteLength);
          cwd ??= cwdFromBlob(data);
          if (cwd) break;
        }
        if (!cwd && !incomplete && rows.length > LEGACY_METADATA_CANDIDATE_LIMIT) {
          incomplete = `trajectory_metadata_blob row budget of ${LEGACY_METADATA_CANDIDATE_LIMIT} reached after ${admittedBytes} bytes admitted; remaining cwd evidence is incomplete`;
        }
      } catch (error) {
        throwIfAborted(options);
        incomplete ??= `trajectory_metadata_blob could not be read: ${describe(error)}; remaining cwd evidence is incomplete`;
      }
    }
    if (hasTrajectoryMeta) {
      try {
        const meta = database.query("select * from trajectory_meta limit 1").get() as JsonRecord | null;
        const candidate = text(meta?.last_selected_agent_model) ?? text(meta?.model);
        if (candidate && !PLACEHOLDER_MODEL.test(candidate)) model = candidate;
      } catch (error) {
        throwIfAborted(options);
        incomplete ??= `trajectory_meta could not be read: ${describe(error)}; remaining model evidence is incomplete`;
      }
    }
    if (!model && hasGenMetadata) {
      try {
        const rows = database.query(`
          select idx, length(data) as blob_bytes
          from gen_metadata
          order by idx desc
          limit ${GEN_METADATA_CANDIDATE_LIMIT + 1}
        `).all() as JsonRecord[];
        let admittedBytes = 0;
        for (const row of rows.slice(0, GEN_METADATA_CANDIDATE_LIMIT)) {
          throwIfAborted(options);
          if (deadlineExpired(options)) {
            incomplete = `gen_metadata deadline reached after ${admittedBytes} blob bytes admitted; remaining model evidence is incomplete`;
            break;
          }
          const blobBytes = row.blob_bytes;
          const index = row.idx;
          if (!Number.isSafeInteger(blobBytes) || (blobBytes as number) < 0) continue;
          if (typeof index !== "number" && typeof index !== "bigint" && typeof index !== "string") continue;
          if ((blobBytes as number) > BLOB_SCAN_MAX_BYTES) continue;
          if ((blobBytes as number) > GEN_METADATA_SCAN_MAX_BYTES - admittedBytes) {
            incomplete = `gen_metadata aggregate blob budget of ${GEN_METADATA_SCAN_MAX_BYTES} bytes would be exceeded after ${admittedBytes} bytes admitted; remaining model evidence is incomplete`;
            break;
          }
          throwIfAborted(options);
          if (deadlineExpired(options)) {
            incomplete = `gen_metadata deadline reached after ${admittedBytes} blob bytes admitted; remaining model evidence is incomplete`;
            break;
          }
          const candidateRow = database.query(`
            select substr(data, 1, ${BLOB_SCAN_MAX_BYTES + 1}) as data
            from gen_metadata
            where idx = ?
          `).get(index) as JsonRecord | null;
          const data = candidateRow?.data;
          if (!(data instanceof Uint8Array)) continue;
          if (data.byteLength > GEN_METADATA_SCAN_MAX_BYTES - admittedBytes) {
            incomplete = `gen_metadata aggregate blob budget of ${GEN_METADATA_SCAN_MAX_BYTES} bytes would be exceeded after ${admittedBytes} bytes admitted; remaining model evidence is incomplete`;
            break;
          }
          admittedBytes += data.byteLength;
          options.testHooks?.onBlobAdmitted?.(data.byteLength);
          const candidate = blobModel(data);
          if (candidate && !PLACEHOLDER_MODEL.test(candidate)) {
            model = candidate;
            break;
          }
        }
        if (!model && !incomplete && rows.length > GEN_METADATA_CANDIDATE_LIMIT) {
          incomplete = `gen_metadata candidate budget of ${GEN_METADATA_CANDIDATE_LIMIT} reached after ${admittedBytes} blob bytes admitted; remaining model evidence is incomplete`;
        }
      } catch (error) {
        throwIfAborted(options);
        incomplete ??= `gen_metadata could not be read: ${describe(error)}; remaining model evidence is incomplete`;
      }
    }
    return { cwd, model, incomplete };
  });
}

async function collectConversation(
  dbPath: string,
  surface: SurfaceRoot,
  windowMs: number,
  thresholds: LifecycleThresholds | undefined,
  nowMs: number,
  errors: string[],
  options: AntigravityCollectOptions,
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
  let transcriptDeadlineReached = false;
  try {
    const source = await readTranscript(transcriptPath, options);
    if (source.jsonl !== undefined) {
      transcript = parseTranscript(source.jsonl);
      if (transcript.incomplete && !source.incomplete) {
        errors.push(`antigravity ${transcriptPath}: ${transcript.incomplete}`);
      }
    }
    if (source.incomplete) {
      errors.push(`antigravity ${transcriptPath}: ${source.incomplete}`);
      transcriptDeadlineReached = source.incomplete.startsWith("transcript deadline");
    }
  } catch (error) {
    throwIfAborted(options);
    errors.push(`antigravity ${transcriptPath}: ${describe(error)}`);
  }

  throwIfAborted(options);
  let hints: { cwd?: string; model?: string; incomplete?: string } = {};
  if (deadlineExpired(options)) {
    if (!transcriptDeadlineReached) {
      errors.push(`antigravity ${dbPath}: collection deadline reached before database admission; remaining model evidence is incomplete`);
    }
  } else {
    try {
      hints = readDbHints(dbPath, options);
      if (hints.incomplete) errors.push(`antigravity ${dbPath}: ${hints.incomplete}`);
    } catch (error) {
      throwIfAborted(options);
      if (error instanceof ForeignSqliteReadError && error.kind === "absent") return undefined;
      errors.push(`antigravity ${dbPath}: ${foreignSqliteFailureMessage(error, "conversation unread")}`);
      if (!transcript) return undefined;
    }
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
  options: AntigravityCollectOptions,
): Promise<CollectionResult<CollectedAgent[]>> {
  throwIfAborted(options);
  const errors: string[] = [];
  const agents: CollectedAgent[] = [];
  let rootEntries: BoundedDirectoryEntries;
  try {
    rootEntries = await boundedDirectoryEntries(surface.root, options);
  } catch (error) {
    throwIfAborted(options);
    if (missing(error)) return { value: [], errors: [], absent: true };
    return { value: [], errors: [`antigravity ${surface.root}: ${describe(error)}`] };
  }
  if (rootEntries.deadlineReached) {
    return {
      value: [],
      errors: [`antigravity ${surface.root}: collection deadline reached during root enumeration; remaining source evidence is incomplete`],
    };
  }
  if (rootEntries.truncated) {
    errors.push(`antigravity ${surface.root}: root directory entry budget of ${DIRECTORY_ENTRY_LIMIT} reached; remaining source evidence is incomplete`);
  }

  const conversations = join(surface.root, "conversations");
  if (!rootEntries.entries.some((entry) => entry.name === "conversations")) {
    return { value: [], errors };
  }
  let conversationEntries: BoundedDirectoryEntries;
  try {
    conversationEntries = await boundedDirectoryEntries(conversations, options);
  } catch (error) {
    throwIfAborted(options);
    if (missing(error)) return { value: [], errors };
    return { value: [], errors: [...errors, `antigravity ${conversations}: ${describe(error)}`] };
  }
  if (conversationEntries.deadlineReached) {
    errors.push(`antigravity ${conversations}: collection deadline reached during conversation enumeration; remaining conversation evidence is incomplete`);
    return { value: [], errors };
  }
  if (conversationEntries.truncated) {
    errors.push(`antigravity ${conversations}: conversation directory entry budget of ${DIRECTORY_ENTRY_LIMIT} reached; remaining conversation evidence is incomplete`);
  }
  const candidates = conversationEntries.entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".db") && !entry.name.includes("-wal") && !entry.name.includes("-shm"))
    .sort((left, right) => left.name.localeCompare(right.name));
  let nextCandidate = 0;
  let deadlineReported = false;
  const reportDeadline = (): void => {
    if (deadlineReported) return;
    deadlineReported = true;
    errors.push(`antigravity ${conversations}: collection deadline reached; remaining conversation evidence is incomplete`);
  };
  await Promise.all(Array.from(
    { length: Math.min(CONVERSATION_CONCURRENCY, candidates.length) },
    async () => {
      while (true) {
        throwIfAborted(options);
        if (nextCandidate >= candidates.length) return;
        if (deadlineExpired(options)) {
          reportDeadline();
          return;
        }
        const candidateIndex = nextCandidate;
        nextCandidate += 1;
        const entry = candidates[candidateIndex];
        if (!entry) return;
        const path = join(conversations, entry.name);
        await options.testHooks?.beforeConversation?.(path);
        try {
          throwIfAborted(options);
          if (deadlineExpired(options)) {
            reportDeadline();
            return;
          }
          const agent = await collectConversation(
            path,
            surface,
            windowMs,
            thresholds,
            nowMs,
            errors,
            options,
          );
          if (agent) agents.push(agent);
        } finally {
          options.testHooks?.afterConversation?.(path);
        }
      }
    },
  ));
  return { value: agents, errors };
}

export async function collectAntigravitySessions(
  roots: readonly string[],
  nowMs: number,
  windowMs: number,
  thresholds?: LifecycleThresholds,
  options: AntigravityCollectOptions = {},
): Promise<CollectionResult<CollectedAgent[]>> {
  throwIfAborted(options);
  if (roots.length === 0) return { value: [], errors: [], absent: true };

  const agents: CollectedAgent[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  let anyPresent = false;

  for (const root of roots) {
    const surface = surfaceFor(root);
    const collected = await collectSurface(surface, windowMs, thresholds, nowMs, options);
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
