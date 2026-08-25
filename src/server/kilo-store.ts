import type { Database, SQLQueryBindings } from "bun:sqlite";
import { opendirSync } from "node:fs";
import { join } from "node:path";
import {
  ForeignSqliteReadError,
  foreignSqliteFailureMessage,
  readForeignSqlite,
} from "./foreign-sqlite";

export const KILO_SCHEMA_COMMIT = "9a6e081e4855e2e6a934bda519c1bef84e14d4b5";
export const KILO_RESEARCH_SHA256 =
  "34db2566dd767ef82c322d2f59b1742b101d78f66ad43715fe6b9505653bf3d0";
export const KILO_LATEST_MIGRATION =
  "20260714141136_session-message-legacy-writer-compat";
export const KILO_FIXTURE_SHA256 =
  "5f34f5864951008f661bddf8eb985a6f28846ac114304795bba5d9eab56b657b";

export const KILO_STORE_LIMITS = {
  dataDirEntries: 64,
  dataDirStores: 16,
  sessions: 50,
  recentMessagesPerSession: 100,
  earlyMessagesPerSession: 16,
  partsPerSession: 400,
  jsonChars: 64_000,
  textChars: 8_000,
  transcriptTailChars: 800,
} as const;

export interface KiloReadOptions {
  sessionId?: string;
  sessionLimit?: number;
  recentMessageLimit?: number;
  earlyMessageLimit?: number;
  partLimit?: number;
  deadlineAtMs?: number;
  nowMs?: () => number;
  signal?: AbortSignal;
  testHooks?: {
    onDataDirEntry?: (path: string, name: string) => void;
    beforeStoreRead?: (path: string) => void;
  };
}

export interface KiloRawModel {
  modelId: string;
  providerRoute: string;
  rawVariant?: string;
}

export interface KiloTokenCounters {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  total?: number;
}

export interface KiloMessageEvidence {
  messageId: string;
  sessionId: string;
  role: "user" | "assistant";
  createdAt?: string;
  completedAt?: string;
  parentMessageId?: string;
  rawModel?: KiloRawModel;
}

interface KiloEventBase {
  sessionId: string;
  messageId: string;
  partId: string;
  observedAt?: string;
}

export type KiloTranscriptEvent =
  | (KiloEventBase & {
    kind: "speech";
    role: "user" | "assistant";
    text: string;
  })
  | (KiloEventBase & {
    kind: "reasoning";
    role: "assistant";
    text: string;
  })
  | (KiloEventBase & {
    kind: "tool";
    role: "assistant";
    callId: string;
    toolName: string;
    status: "pending" | "running" | "completed" | "error";
    title?: string;
  });

export interface KiloSessionEvidence {
  provider: "kilo";
  sessionId: string;
  slug: string;
  parentSessionId?: string;
  sourceTitle?: {
    text: string;
    provenance: "kilo-source-title-unverified-authorship";
  };
  sourceDirectory?: string;
  sourcePath?: string;
  rawModel?: KiloRawModel;
  startedAt?: string;
  updatedAt?: string;
  archivedAt?: string;
  firstTask?: string;
  firstUserText?: string;
  messages: KiloMessageEvidence[];
  prose: Array<Extract<KiloTranscriptEvent, { kind: "speech" }>>;
  assistantClosing?: string;
  transcriptTail?: {
    text: string;
    truncated: boolean;
  };
  events: KiloTranscriptEvent[];
  earliestAssistantCwd?: string;
  latestAssistantCwd?: string;
  latestTurn?: {
    messageId: string;
    parentMessageId?: string;
    createdAt?: string;
    completedAt?: string;
    finish?: string;
  };
  latestCallTokens?: KiloTokenCounters;
  callSizes?: number[];
  callSizesComplete: boolean;
  sessionTokens?: KiloTokenCounters;
  transcriptTruncated: boolean;
}

export interface KiloStoreDiagnostic {
  kind:
    | "invalid-json"
    | "oversized-json"
    | "oversized-content"
    | "invalid-record"
    | "deadline"
    | "truncated";
  table: "store" | "session" | "message" | "part";
  recordId?: string;
  detail: string;
}

export interface KiloStoreEvidence {
  sessions: KiloSessionEvidence[];
  diagnostics: KiloStoreDiagnostic[];
  incomplete: boolean;
  absent: boolean;
}

export interface KiloDataDirStoreEvidence {
  path: string;
  evidence: KiloStoreEvidence;
}

export interface KiloDataDirEvidence {
  stores: KiloDataDirStoreEvidence[];
  errors: string[];
  absent: boolean;
}

export class KiloParserNotImplementedError extends Error {
  readonly code = "KILO_PARSER_NOT_IMPLEMENTED" as const;

  constructor() {
    super("Kilo parser behavior is intentionally not implemented");
    this.name = "KiloParserNotImplementedError";
  }
}

type JsonRecord = Record<string, unknown>;

interface RawSessionRow {
  id: unknown;
  id_length: unknown;
  parent_id: unknown;
  parent_id_length: unknown;
  slug: unknown;
  slug_length: unknown;
  directory: unknown;
  directory_length: unknown;
  path: unknown;
  path_length: unknown;
  title: unknown;
  title_length: unknown;
  model: unknown;
  model_length: unknown;
  tokens_input: unknown;
  tokens_output: unknown;
  tokens_reasoning: unknown;
  tokens_cache_read: unknown;
  tokens_cache_write: unknown;
  time_created: unknown;
  time_updated: unknown;
  time_archived: unknown;
}

interface RawMessageRow {
  id: unknown;
  id_length: unknown;
  time_created: unknown;
  data: unknown;
  data_length: unknown;
}

interface RawPartRow {
  part_rowid: unknown;
  id: unknown;
  id_length: unknown;
  message_id: unknown;
  message_id_length: unknown;
  time_created: unknown;
  time_updated: unknown;
  data: unknown;
  data_length: unknown;
}

interface RawPartBoundaryRow {
  message_order: unknown;
  ascending_rowids: unknown;
  descending_rowids: unknown;
}

interface RawSessionBundle {
  session: RawSessionRow;
  messages: RawMessageRow[];
  parts: RawPartRow[];
  messageTruncated: boolean;
  messageWindowGap: boolean;
  earlyMessageIds: Set<string>;
  partTruncated: boolean;
  recentMessageLimit: number;
  partLimit: number;
}

interface RawStoreSnapshot {
  sessions: RawSessionBundle[];
  sessionTruncated: boolean;
  deadlineExpired: boolean;
}

interface DecodedMessage {
  evidence: KiloMessageEvidence;
  data: JsonRecord;
  messageOrder: number;
  assistantCwd?: string;
  finish?: string;
}

interface PartAuthority {
  partId: string;
}

const ID_CHARS = 256;
const MIGRATION_ROWS = 1_000;
const REQUIRED_COLUMNS = {
  session: [
    "id",
    "project_id",
    "parent_id",
    "slug",
    "directory",
    "path",
    "title",
    "version",
    "model",
    "tokens_input",
    "tokens_output",
    "tokens_reasoning",
    "tokens_cache_read",
    "tokens_cache_write",
    "time_created",
    "time_updated",
    "time_archived",
  ],
  message: ["id", "session_id", "time_created", "time_updated", "data"],
  part: ["id", "message_id", "session_id", "time_created", "time_updated", "data"],
  migration: ["id", "time_completed"],
} as const;

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function diagnostic(
  diagnostics: KiloStoreDiagnostic[],
  value: KiloStoreDiagnostic,
): void {
  diagnostics.push(value);
}

function decodedTimestamp(
  value: unknown,
  table: "session" | "message" | "part",
  recordId: string,
  field: string,
  diagnostics: KiloStoreDiagnostic[],
): string | undefined {
  if (value === null || value === undefined) return undefined;
  const epochMs = nonNegativeInteger(value);
  if (epochMs !== undefined) {
    const date = new Date(epochMs);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  diagnostic(diagnostics, {
    kind: "invalid-record",
    table,
    recordId,
    detail: `${field} is not a supported nonnegative epoch timestamp and was omitted`,
  });
  return undefined;
}

function boundedLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) return fallback;
  return Math.min(fallback, Math.floor(value as number));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason;
}

/* A signal cannot interrupt a synchronous SQLite statement already executing.
   Bracket each bounded operation so cancellation is observed before starting
   another statement and immediately after the current one returns. */
function runBoundedSync<T>(signal: AbortSignal | undefined, operation: () => T): T {
  throwIfAborted(signal);
  try {
    const result = operation();
    throwIfAborted(signal);
    return result;
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    throw error;
  }
}

function compareRows(
  left: { id: unknown; time_created: unknown },
  right: { id: unknown; time_created: unknown },
): number {
  const time = (nonNegativeInteger(left.time_created) ?? 0) -
    (nonNegativeInteger(right.time_created) ?? 0);
  if (time !== 0) return time;
  return compareNativeIds(String(left.id ?? ""), String(right.id ?? ""));
}

function compareNativeIds(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function compareUntypedPartAuthority(
  left: Partial<PartAuthority>,
  right: PartAuthority,
): number | undefined {
  return left.partId === undefined
    ? undefined
    : compareNativeIds(left.partId, right.partId);
}

function schemaColumns(
  database: Database,
  table: keyof typeof REQUIRED_COLUMNS,
  signal?: AbortSignal,
): Set<string> {
  throwIfAborted(signal);
  const rows = database.query(`PRAGMA table_info("${table}")`).all() as Array<{
    name?: unknown;
  }>;
  throwIfAborted(signal);
  return new Set(rows.flatMap(({ name }) => typeof name === "string" ? [name] : []));
}

function assertPinnedSchema(database: Database, signal?: AbortSignal): void {
  for (const [table, expected] of Object.entries(REQUIRED_COLUMNS) as Array<
    [keyof typeof REQUIRED_COLUMNS, readonly string[]]
  >) {
    const columns = schemaColumns(database, table, signal);
    const missing = expected.filter((column) => !columns.has(column));
    if (missing.length > 0) {
      throw new ForeignSqliteReadError(
        "schema",
        `Kilo ${table} table is missing required columns: ${missing.join(", ")}`,
      );
    }
  }

  throwIfAborted(signal);
  const partIndexes = database.query('PRAGMA index_list("part")').all() as Array<{
    name?: unknown;
    partial?: unknown;
  }>;
  throwIfAborted(signal);
  const partBoundaryIndex = partIndexes.find(({ name }) =>
    name === "part_message_id_id_idx"
  );
  throwIfAborted(signal);
  const partBoundaryColumns = partBoundaryIndex
    ? (database.query('PRAGMA index_info("part_message_id_id_idx")').all() as Array<{
        name?: unknown;
      }>).flatMap(({ name }) => typeof name === "string" ? [name] : [])
    : [];
  throwIfAborted(signal);
  if (
    partBoundaryIndex?.partial !== 0 ||
    partBoundaryColumns.length !== 2 ||
    partBoundaryColumns[0] !== "message_id" ||
    partBoundaryColumns[1] !== "id"
  ) {
    throw new ForeignSqliteReadError(
      "schema",
      "Kilo part boundary index part_message_id_id_idx must cover (message_id, id)",
    );
  }

  throwIfAborted(signal);
  const migrations = database.query(`
    SELECT substr(id, 1, ${ID_CHARS + 1}) AS id, length(id) AS id_length
    FROM migration
    ORDER BY id
    LIMIT ${MIGRATION_ROWS + 1}
  `).all() as Array<{ id?: unknown; id_length?: unknown }>;
  throwIfAborted(signal);
  if (migrations.length > MIGRATION_ROWS) {
    throw new ForeignSqliteReadError(
      "schema",
      "Kilo migration journal exceeds the pinned read bound",
    );
  }

  let latestPresent = false;
  for (const row of migrations) {
    const length = nonNegativeInteger(row.id_length);
    const id = nonEmptyString(row.id);
    if (!id || length === undefined || length > ID_CHARS) {
      throw new ForeignSqliteReadError("schema", "Kilo migration journal contains an invalid id");
    }
    if (id === KILO_LATEST_MIGRATION) latestPresent = true;
    if (/^\d{14}_.+/.test(id) && id > KILO_LATEST_MIGRATION) {
      throw new ForeignSqliteReadError("schema", `Kilo store has unknown future migration ${id}`);
    }
  }
  if (!latestPresent) {
    throw new ForeignSqliteReadError(
      "schema",
      `Kilo store is missing pinned migration ${KILO_LATEST_MIGRATION}`,
    );
  }
}

function readMessageWindow(
  database: Database,
  sessionId: string,
  direction: "ASC" | "DESC",
  limit: number,
  signal?: AbortSignal,
): RawMessageRow[] {
  throwIfAborted(signal);
  const rows = database.query(`
    SELECT
      substr(id, 1, ${ID_CHARS + 1}) AS id,
      length(id) AS id_length,
      time_created,
      substr(data, 1, ${KILO_STORE_LIMITS.jsonChars + 1}) AS data,
      length(data) AS data_length
    FROM message
    WHERE session_id = ?
    ORDER BY time_created ${direction}, id ${direction}
    LIMIT ?
  `).all(sessionId, limit) as RawMessageRow[];
  throwIfAborted(signal);
  return rows;
}

function readPartBoundaries(
  database: Database,
  messageIds: string[],
  limit: number,
  signal?: AbortSignal,
): RawPartBoundaryRow[] {
  const selectedMessages = messageIds.map((_, index) => `(?, ${index})`).join(", ");
  throwIfAborted(signal);
  const rows = database.query(`
    WITH selected_messages(message_id, message_order) AS (
      VALUES ${selectedMessages}
    )
    SELECT
      message_order,
      (
        SELECT group_concat(part_rowid, ',')
        FROM (
          SELECT rowid AS part_rowid
          FROM part
          WHERE message_id = selected_messages.message_id
          ORDER BY id COLLATE BINARY ASC
          LIMIT ?
        )
      ) AS ascending_rowids,
      (
        SELECT group_concat(part_rowid, ',')
        FROM (
          SELECT rowid AS part_rowid
          FROM part
          WHERE message_id = selected_messages.message_id
          ORDER BY id COLLATE BINARY DESC
          LIMIT ?
        )
      ) AS descending_rowids
    FROM selected_messages
  `).all(...messageIds, limit, limit) as RawPartBoundaryRow[];
  throwIfAborted(signal);
  return rows;
}

function decodedBoundaryRowids(value: unknown): number[] {
  if (typeof value !== "string" || value.length === 0) return [];
  return value.split(",").flatMap((rowid) => {
    const bounded = nonNegativeInteger(Number(rowid));
    return bounded === undefined ? [] : [bounded];
  });
}

function readSelectedParts(
  database: Database,
  messageIds: string[],
  limit: number,
  pastDeadline: () => boolean,
  signal?: AbortSignal,
): RawPartRow[] {
  throwIfAborted(signal);
  if (messageIds.length === 0 || limit === 0) return [];
  const selected = new Map<number, {
    messageOrder: number;
    boundaryRank: number;
    boundarySide: number;
  }>();
  const boundaries = readPartBoundaries(database, messageIds, limit, signal);
  for (const boundary of boundaries) {
    throwIfAborted(signal);
    const messageOrder = nonNegativeInteger(boundary.message_order);
    if (messageOrder === undefined || messageOrder >= messageIds.length) continue;
    for (const [boundarySide, rowids] of [
      decodedBoundaryRowids(boundary.ascending_rowids),
      decodedBoundaryRowids(boundary.descending_rowids),
    ].entries()) {
      for (const [index, rowid] of rowids.entries()) {
        const candidate = {
          messageOrder,
          boundaryRank: index + 1,
          boundarySide,
        };
        const existing = selected.get(rowid);
        if (
          !existing ||
          candidate.boundaryRank < existing.boundaryRank ||
          (candidate.boundaryRank === existing.boundaryRank &&
            candidate.boundarySide < existing.boundarySide)
        ) {
          selected.set(rowid, candidate);
        }
      }
    }
  }
  if (pastDeadline()) return [];

  const bounded = [...selected.entries()]
    .sort((left, right) =>
      left[1].boundaryRank - right[1].boundaryRank ||
      left[1].messageOrder - right[1].messageOrder ||
      left[1].boundarySide - right[1].boundarySide
    )
    .slice(0, limit);
  if (bounded.length === 0) return [];
  const placeholders = bounded.map(() => "?").join(", ");
  const bindings: SQLQueryBindings[] = bounded.map(([rowid]) => rowid);
  bindings.push(bounded.length);
  throwIfAborted(signal);
  const rows = database.query(`
    SELECT
      rowid AS part_rowid,
      substr(id, 1, ${ID_CHARS + 1}) AS id,
      length(id) AS id_length,
      substr(message_id, 1, ${ID_CHARS + 1}) AS message_id,
      length(message_id) AS message_id_length,
      time_created,
      time_updated,
      substr(data, 1, ${KILO_STORE_LIMITS.jsonChars + 1}) AS data,
      length(data) AS data_length
    FROM part
    WHERE rowid IN (${placeholders})
    LIMIT ?
  `).all(...bindings) as RawPartRow[];
  throwIfAborted(signal);
  const boundedOrder = new Map(bounded.map(([rowid], index) => [rowid, index]));
  return rows.sort((left, right) => {
    const leftRowid = nonNegativeInteger(left.part_rowid);
    const rightRowid = nonNegativeInteger(right.part_rowid);
    const leftRank = leftRowid === undefined
      ? bounded.length
      : boundedOrder.get(leftRowid) ?? bounded.length;
    const rightRank = rightRowid === undefined
      ? bounded.length
      : boundedOrder.get(rightRowid) ?? bounded.length;
    return leftRank - rightRank;
  });
}

function readRawSnapshot(
  database: Database,
  sessionLimit: number,
  recentMessageLimit: number,
  earlyMessageLimit: number,
  partLimit: number,
  pastDeadline: () => boolean,
  selectedSessionId?: string,
  signal?: AbortSignal,
): RawStoreSnapshot {
  throwIfAborted(signal);
  if (pastDeadline()) return { sessions: [], sessionTruncated: false, deadlineExpired: true };
  assertPinnedSchema(database, signal);
  throwIfAborted(signal);
  if (pastDeadline()) return { sessions: [], sessionTruncated: false, deadlineExpired: true };

  const selection = selectedSessionId
    ? "WHERE id = ? LIMIT 1"
    : "ORDER BY session.id DESC LIMIT ?";
  const sessionRows = database.query(`
    SELECT
      substr(id, 1, ${ID_CHARS + 1}) AS id,
      length(id) AS id_length,
      substr(parent_id, 1, ${ID_CHARS + 1}) AS parent_id,
      length(parent_id) AS parent_id_length,
      substr(slug, 1, ${ID_CHARS + 1}) AS slug,
      length(slug) AS slug_length,
      substr(directory, 1, ${KILO_STORE_LIMITS.textChars + 1}) AS directory,
      length(directory) AS directory_length,
      substr(path, 1, ${KILO_STORE_LIMITS.textChars + 1}) AS path,
      length(path) AS path_length,
      substr(title, 1, ${KILO_STORE_LIMITS.textChars + 1}) AS title,
      length(title) AS title_length,
      substr(model, 1, ${KILO_STORE_LIMITS.jsonChars + 1}) AS model,
      length(model) AS model_length,
      tokens_input,
      tokens_output,
      tokens_reasoning,
      tokens_cache_read,
      tokens_cache_write,
      time_created,
      time_updated,
      time_archived
    FROM session
    ${selection}
  `).all(selectedSessionId ?? sessionLimit + 1) as RawSessionRow[];
  throwIfAborted(signal);
  const sessionTruncated = selectedSessionId === undefined && sessionRows.length > sessionLimit;
  const admittedSessionRows = [...sessionRows].sort((left, right) => {
    const leftUpdatedAt = nonNegativeInteger(left.time_updated);
    const rightUpdatedAt = nonNegativeInteger(right.time_updated);
    if (
      leftUpdatedAt === undefined || rightUpdatedAt === undefined ||
      leftUpdatedAt === rightUpdatedAt
    ) return 0;
    return leftUpdatedAt > rightUpdatedAt ? -1 : 1;
  });
  const sessions: RawSessionBundle[] = [];

  for (const session of admittedSessionRows.slice(0, sessionLimit)) {
    throwIfAborted(signal);
    if (pastDeadline()) return { sessions, sessionTruncated, deadlineExpired: true };
    const sessionId = nonEmptyString(session.id);
    const idLength = nonNegativeInteger(session.id_length);
    if (!sessionId || idLength === undefined || idLength > ID_CHARS) {
      sessions.push({
        session,
        messages: [],
        parts: [],
        messageTruncated: false,
        messageWindowGap: false,
        earlyMessageIds: new Set(),
        partTruncated: false,
        recentMessageLimit,
        partLimit,
      });
      continue;
    }

    const early = readMessageWindow(database, sessionId, "ASC", earlyMessageLimit, signal);
    throwIfAborted(signal);
    if (pastDeadline()) return { sessions, sessionTruncated, deadlineExpired: true };
    const recentRows = readMessageWindow(
      database,
      sessionId,
      "DESC",
      recentMessageLimit + 1,
      signal,
    );
    const recentWindowTruncated = recentRows.length > recentMessageLimit;
    const earlyMessageIds = new Set(early.map((message) => String(message.id ?? "")));
    const messageWindowGap = recentWindowTruncated &&
      !earlyMessageIds.has(String(recentRows[recentMessageLimit]?.id ?? ""));
    const selected = new Map<string, RawMessageRow>();
    for (const message of [...early, ...recentRows.slice(0, recentMessageLimit)]) {
      selected.set(String(message.id ?? ""), message);
    }
    const messages = [...selected.values()].sort(compareRows);
    const messageIds = messages.flatMap((message) => {
      const id = nonEmptyString(message.id);
      const length = nonNegativeInteger(message.id_length);
      return id && length !== undefined && length <= ID_CHARS ? [id] : [];
    });

    if (pastDeadline()) return { sessions, sessionTruncated, deadlineExpired: true };
    const partRows = readSelectedParts(database, messageIds, partLimit + 1, pastDeadline, signal);
    if (messageIds.length > 0 && pastDeadline()) {
      return { sessions, sessionTruncated, deadlineExpired: true };
    }
    const partTruncated = partRows.length > partLimit;
    const messageOrder = new Map(messageIds.map((messageId, index) => [messageId, index]));
    const parts = partRows.slice(0, partLimit).sort((left, right) => {
      const messageDifference = (messageOrder.get(String(left.message_id)) ?? messageIds.length) -
        (messageOrder.get(String(right.message_id)) ?? messageIds.length);
      if (messageDifference !== 0) return messageDifference;
      const leftLength = nonNegativeInteger(left.id_length);
      const rightLength = nonNegativeInteger(right.id_length);
      const leftId = typeof left.id === "string" && left.id.length > 0 &&
          leftLength !== undefined && leftLength <= ID_CHARS
        ? left.id
        : undefined;
      const rightId = typeof right.id === "string" && right.id.length > 0 &&
          rightLength !== undefined && rightLength <= ID_CHARS
        ? right.id
        : undefined;
      if (leftId && rightId) return compareNativeIds(leftId, rightId);
      if (leftId) return -1;
      if (rightId) return 1;
      return 0;
    });
    sessions.push({
      session,
      messages,
      parts,
      messageTruncated: messageWindowGap,
      messageWindowGap,
      earlyMessageIds,
      partTruncated,
      recentMessageLimit,
      partLimit,
    });
  }
  return { sessions, sessionTruncated, deadlineExpired: false };
}

function boundedCell(
  value: unknown,
  rawLength: unknown,
  max: number,
  table: KiloStoreDiagnostic["table"],
  recordId: string | undefined,
  field: string,
  diagnostics: KiloStoreDiagnostic[],
): string | undefined {
  if (value === null || value === undefined) return undefined;
  const length = nonNegativeInteger(rawLength);
  if (length !== undefined && length > max) {
    diagnostic(diagnostics, {
      kind: "oversized-content",
      table,
      recordId,
      detail: `${field} exceeds ${max} characters and was omitted`,
    });
    return undefined;
  }
  if (typeof value !== "string" || length === undefined) {
    diagnostic(diagnostics, {
      kind: "invalid-record",
      table,
      recordId,
      detail: `${field} is not a valid text value`,
    });
    return undefined;
  }
  return value;
}

function boundedJsonString(
  value: unknown,
  max: number,
  table: "session" | "message" | "part",
  recordId: string,
  field: string,
  diagnostics: KiloStoreDiagnostic[],
): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") {
    diagnostic(diagnostics, {
      kind: "invalid-record",
      table,
      recordId,
      detail: `${field} is not a valid text value`,
    });
    return undefined;
  }
  if (value.length > max) {
    diagnostic(diagnostics, {
      kind: "oversized-content",
      table,
      recordId,
      detail: `${field} exceeds ${max} characters and was omitted`,
    });
    return undefined;
  }
  return value.trim() ? value : undefined;
}

function decodedJson(
  value: unknown,
  rawLength: unknown,
  table: "session" | "message" | "part",
  recordId: string | undefined,
  diagnostics: KiloStoreDiagnostic[],
): JsonRecord | undefined {
  const length = nonNegativeInteger(rawLength);
  if (length !== undefined && length > KILO_STORE_LIMITS.jsonChars) {
    diagnostic(diagnostics, {
      kind: "oversized-json",
      table,
      recordId,
      detail: `JSON exceeds ${KILO_STORE_LIMITS.jsonChars} characters and was skipped`,
    });
    return undefined;
  }
  if (typeof value !== "string" || length === undefined) {
    diagnostic(diagnostics, {
      kind: "invalid-record",
      table,
      recordId,
      detail: "JSON field is not valid text",
    });
    return undefined;
  }
  try {
    const parsed = record(JSON.parse(value));
    if (parsed) return parsed;
  } catch {
    // The bounded record is diagnosed without including its contents.
  }
  diagnostic(diagnostics, {
    kind: "invalid-json",
    table,
    recordId,
    detail: "JSON record could not be decoded and was skipped",
  });
  return undefined;
}

function rawModel(
  value: unknown,
  table: "session" | "message",
  recordId: string,
  fieldPrefix: string,
  diagnostics: KiloStoreDiagnostic[],
): KiloRawModel | undefined {
  const model = record(value);
  const modelId = boundedJsonString(
    model?.id ?? model?.modelID,
    ID_CHARS,
    table,
    recordId,
    `${fieldPrefix} model id`,
    diagnostics,
  );
  const providerRoute = boundedJsonString(
    model?.providerID,
    ID_CHARS,
    table,
    recordId,
    `${fieldPrefix} provider route`,
    diagnostics,
  );
  const rawVariant = boundedJsonString(
    model?.variant,
    ID_CHARS,
    table,
    recordId,
    `${fieldPrefix} raw variant`,
    diagnostics,
  );
  if (!modelId || !providerRoute) return undefined;
  return { modelId, providerRoute, ...(rawVariant ? { rawVariant } : {}) };
}

function tokenCounters(value: unknown): KiloTokenCounters | undefined {
  const tokens = record(value);
  const cache = record(tokens?.cache);
  const input = nonNegativeInteger(tokens?.input);
  const output = nonNegativeInteger(tokens?.output);
  const reasoning = nonNegativeInteger(tokens?.reasoning);
  const cacheRead = nonNegativeInteger(cache?.read);
  const cacheWrite = nonNegativeInteger(cache?.write);
  if (
    input === undefined || output === undefined || reasoning === undefined ||
    cacheRead === undefined || cacheWrite === undefined
  ) return undefined;
  const total = nonNegativeInteger(tokens?.total);
  return { input, output, reasoning, cacheRead, cacheWrite, ...(total === undefined ? {} : { total }) };
}

function sourceTitle(value: string | undefined): KiloSessionEvidence["sourceTitle"] {
  if (!value) return undefined;
  for (const prefix of ["New session - ", "Child session - "]) {
    if (value.startsWith(prefix) && Number.isFinite(Date.parse(value.slice(prefix.length)))) {
      return undefined;
    }
  }
  return { text: value, provenance: "kilo-source-title-unverified-authorship" };
}

function safePartText(
  value: unknown,
  partId: string,
  diagnostics: KiloStoreDiagnostic[],
): string | undefined {
  if (typeof value !== "string") {
    diagnostic(diagnostics, {
      kind: "invalid-record",
      table: "part",
      recordId: partId,
      detail: "part text is not a valid text value",
    });
    return undefined;
  }
  if (!value.trim()) return undefined;
  if (value.length > KILO_STORE_LIMITS.textChars) {
    diagnostic(diagnostics, {
      kind: "oversized-content",
      table: "part",
      recordId: partId,
      detail: `part text exceeds ${KILO_STORE_LIMITS.textChars} characters and was skipped`,
    });
    return undefined;
  }
  return value;
}

function parseSession(
  bundle: RawSessionBundle,
  diagnostics: KiloStoreDiagnostic[],
): KiloSessionEvidence | undefined {
  const sessionId = boundedCell(
    bundle.session.id,
    bundle.session.id_length,
    ID_CHARS,
    "session",
    undefined,
    "session id",
    diagnostics,
  );
  if (!sessionId) return undefined;

  const slug = nonEmptyString(boundedCell(
    bundle.session.slug,
    bundle.session.slug_length,
    ID_CHARS,
    "session",
    sessionId,
    "session slug",
    diagnostics,
  ));
  if (!slug) {
    diagnostic(diagnostics, {
      kind: "invalid-record",
      table: "session",
      recordId: sessionId,
      detail: "session slug is missing or invalid and the row was skipped",
    });
    return undefined;
  }

  const parentSessionId = boundedCell(
    bundle.session.parent_id,
    bundle.session.parent_id_length,
    ID_CHARS,
    "session",
    sessionId,
    "parent session id",
    diagnostics,
  );
  const sourceDirectory = nonEmptyString(boundedCell(
    bundle.session.directory,
    bundle.session.directory_length,
    KILO_STORE_LIMITS.textChars,
    "session",
    sessionId,
    "directory",
    diagnostics,
  ));
  const sourcePath = nonEmptyString(boundedCell(
    bundle.session.path,
    bundle.session.path_length,
    KILO_STORE_LIMITS.textChars,
    "session",
    sessionId,
    "path",
    diagnostics,
  ));
  const title = nonEmptyString(boundedCell(
    bundle.session.title,
    bundle.session.title_length,
    KILO_STORE_LIMITS.textChars,
    "session",
    sessionId,
    "title",
    diagnostics,
  ));
  const startedAt = decodedTimestamp(
    bundle.session.time_created,
    "session",
    sessionId,
    "time_created",
    diagnostics,
  );
  const updatedAt = decodedTimestamp(
    bundle.session.time_updated,
    "session",
    sessionId,
    "time_updated",
    diagnostics,
  );
  const archivedAt = decodedTimestamp(
    bundle.session.time_archived,
    "session",
    sessionId,
    "time_archived",
    diagnostics,
  );

  let sessionModel: KiloRawModel | undefined;
  if (bundle.session.model !== null && bundle.session.model !== undefined) {
    const model = decodedJson(
      bundle.session.model,
      bundle.session.model_length,
      "session",
      sessionId,
      diagnostics,
    );
    sessionModel = rawModel(model, "session", sessionId, "session", diagnostics);
    if (model && !sessionModel) {
      diagnostic(diagnostics, {
        kind: "invalid-record",
        table: "session",
        recordId: sessionId,
        detail: "model JSON lacks a model id or provider route",
      });
    }
  }

  const input = nonNegativeInteger(bundle.session.tokens_input);
  const output = nonNegativeInteger(bundle.session.tokens_output);
  const reasoning = nonNegativeInteger(bundle.session.tokens_reasoning);
  const cacheRead = nonNegativeInteger(bundle.session.tokens_cache_read);
  const cacheWrite = nonNegativeInteger(bundle.session.tokens_cache_write);
  const sessionTokens = input === undefined || output === undefined || reasoning === undefined ||
      cacheRead === undefined || cacheWrite === undefined
    ? undefined
    : { input, output, reasoning, cacheRead, cacheWrite };
  if (!sessionTokens) {
    diagnostic(diagnostics, {
      kind: "invalid-record",
      table: "session",
      recordId: sessionId,
      detail: "session token counters are invalid and remain unavailable",
    });
  }

  let transcriptTruncated = bundle.messageTruncated || bundle.partTruncated;
  if (bundle.messageTruncated) {
    diagnostic(diagnostics, {
      kind: "truncated",
      table: "message",
      recordId: sessionId,
      detail: `recent message window capped at ${bundle.recentMessageLimit}`,
    });
  }
  if (bundle.partTruncated) {
    diagnostic(diagnostics, {
      kind: "truncated",
      table: "part",
      recordId: sessionId,
      detail: `selected part window capped at ${bundle.partLimit}`,
    });
  }

  const decodedMessages: DecodedMessage[] = [];
  const messageAuthorityHoles: number[] = [];
  for (const [messageIndex, row] of bundle.messages.entries()) {
    const messageId = boundedCell(
      row.id,
      row.id_length,
      ID_CHARS,
      "message",
      undefined,
      "message id",
      diagnostics,
    );
    if (!messageId) {
      messageAuthorityHoles.push(messageIndex);
      transcriptTruncated = true;
      continue;
    }
    const data = decodedJson(row.data, row.data_length, "message", messageId, diagnostics);
    if (!data) {
      messageAuthorityHoles.push(messageIndex);
      transcriptTruncated = true;
      continue;
    }
    const role = data.role;
    if (role !== "user" && role !== "assistant") {
      diagnostic(diagnostics, {
        kind: "invalid-record",
        table: "message",
        recordId: messageId,
        detail: "message role is not user or assistant",
      });
      messageAuthorityHoles.push(messageIndex);
      transcriptTruncated = true;
      continue;
    }

    const time = record(data.time);
    const rowCreatedAt = decodedTimestamp(
      row.time_created,
      "message",
      messageId,
      "time_created",
      diagnostics,
    );
    const jsonCreatedAt = time?.created === null || time?.created === undefined
      ? undefined
      : decodedTimestamp(
        time.created,
        "message",
        messageId,
        "time.created",
        diagnostics,
      );
    const createdAt = jsonCreatedAt ?? rowCreatedAt;
    const completedAt = role === "assistant"
      ? decodedTimestamp(
        time?.completed,
        "message",
        messageId,
        "time.completed",
        diagnostics,
      )
      : undefined;
    const parentMessageId = role === "assistant"
      ? boundedJsonString(
        data.parentID,
        ID_CHARS,
        "message",
        messageId,
        "message parent id",
        diagnostics,
      )
      : undefined;
    const messageModel = role === "assistant"
      ? rawModel(
        { id: data.modelID, providerID: data.providerID, variant: data.variant },
        "message",
        messageId,
        "message",
        diagnostics,
      )
      : undefined;
    const assistantCwd = role === "assistant"
      ? boundedJsonString(
        record(data.path)?.cwd,
        KILO_STORE_LIMITS.textChars,
        "message",
        messageId,
        "message path cwd",
        diagnostics,
      )
      : undefined;
    const finish = role === "assistant"
      ? boundedJsonString(
        data.finish,
        ID_CHARS,
        "message",
        messageId,
        "message finish",
        diagnostics,
      )
      : undefined;
    decodedMessages.push({
      evidence: {
        messageId,
        sessionId,
        role,
        ...(createdAt ? { createdAt } : {}),
        ...(completedAt ? { completedAt } : {}),
        ...(parentMessageId ? { parentMessageId } : {}),
        ...(messageModel ? { rawModel: messageModel } : {}),
      },
      data,
      messageOrder: messageIndex,
      ...(assistantCwd ? { assistantCwd } : {}),
      ...(finish ? { finish } : {}),
    });
  }

  const decodedById = new Map(decodedMessages.map((message) => [message.evidence.messageId, message]));
  const partsByMessage = new Map<string, RawPartRow[]>();
  for (const row of bundle.parts) {
    const messageId = boundedCell(
      row.message_id,
      row.message_id_length,
      ID_CHARS,
      "part",
      undefined,
      "part message id",
      diagnostics,
    );
    if (!messageId || !decodedById.has(messageId)) continue;
    const rows = partsByMessage.get(messageId) ?? [];
    rows.push(row);
    partsByMessage.set(messageId, rows);
  }

  const events: KiloTranscriptEvent[] = [];
  const speechBoundaries: Array<{
    role: "user" | "assistant";
    messageId: string;
    messageOrder: number;
    text?: string;
  }> = [];
  const unknownPartMessageOrders = {
    user: [] as number[],
    assistant: [] as number[],
  };
  const latestStepFinish = new Map<string, {
    authority: PartAuthority;
    tokens?: KiloTokenCounters;
  }>();
  const latestValidStepFinish = new Map<string, PartAuthority>();
  const untypedPartAuthorities = new Map<string, Array<Partial<PartAuthority>>>();
  const validStepFinishTotals = new Map<string, number>();
  const callSizes: number[] = [];
  let invalidStepFinish = false;
  for (const message of decodedMessages) {
    const registerUntypedPart = (authority: Partial<PartAuthority>): void => {
      if (authority.partId === undefined) {
        unknownPartMessageOrders[message.evidence.role].push(message.messageOrder);
      } else {
        speechBoundaries.push({
          role: message.evidence.role,
          messageId: message.evidence.messageId,
          messageOrder: message.messageOrder,
        });
      }
      if (message.evidence.role === "assistant") {
        const authorities = untypedPartAuthorities.get(message.evidence.messageId) ?? [];
        authorities.push(authority);
        untypedPartAuthorities.set(message.evidence.messageId, authorities);
      }
    };
    for (const row of partsByMessage.get(message.evidence.messageId) ?? []) {
      const partId = boundedCell(
        row.id,
        row.id_length,
        ID_CHARS,
        "part",
        undefined,
        "part id",
        diagnostics,
      );
      if (!partId) {
        transcriptTruncated = true;
        registerUntypedPart({});
        continue;
      }
      const observedAt = decodedTimestamp(
        row.time_created,
        "part",
        partId,
        "time_created",
        diagnostics,
      );
      const authority = { partId };
      decodedTimestamp(
        row.time_updated,
        "part",
        partId,
        "time_updated",
        diagnostics,
      );
      const data = decodedJson(row.data, row.data_length, "part", partId, diagnostics);
      if (!data) {
        transcriptTruncated = true;
        registerUntypedPart(authority);
        continue;
      }

      const type = data.type;
      if (type === "step-finish") {
        if (message.evidence.role !== "assistant") continue;
        const tokens = tokenCounters(data.tokens);
        const rawTokens = record(data.tokens);
        const totalPresent = rawTokens !== undefined &&
          Object.prototype.hasOwnProperty.call(rawTokens, "total");
        if (tokens && tokens.total !== undefined) {
          callSizes.push(tokens.total);
          validStepFinishTotals.set(
            message.evidence.messageId,
            (validStepFinishTotals.get(message.evidence.messageId) ?? 0) + 1,
          );
        } else if (tokens) {
          invalidStepFinish = true;
          if (totalPresent) {
            diagnostic(diagnostics, {
              kind: "invalid-record",
              table: "part",
              recordId: partId,
              detail: "step-finish total is invalid and remains unavailable",
            });
          }
        } else {
          invalidStepFinish = true;
          diagnostic(diagnostics, {
            kind: "invalid-record",
            table: "part",
            recordId: partId,
            detail: "step-finish token counters are invalid and remain unavailable",
          });
        }
        const latest = latestStepFinish.get(message.evidence.messageId);
        if (!latest || compareNativeIds(authority.partId, latest.authority.partId) >= 0) {
          latestStepFinish.set(message.evidence.messageId, {
            authority,
            ...(tokens ? { tokens } : {}),
          });
        }
        if (tokens) {
          const latestValid = latestValidStepFinish.get(message.evidence.messageId);
          if (!latestValid || compareNativeIds(authority.partId, latestValid.partId) >= 0) {
            latestValidStepFinish.set(message.evidence.messageId, authority);
          }
        }
        continue;
      }

      if (type === "text") {
        if (data.synthetic === true || data.ignored === true) continue;
        const text = safePartText(data.text, partId, diagnostics);
        if (!text) {
          if (
            typeof data.text !== "string" ||
            data.text.length > KILO_STORE_LIMITS.textChars
          ) {
            transcriptTruncated = true;
            speechBoundaries.push({
              role: message.evidence.role,
              messageId: message.evidence.messageId,
              messageOrder: message.messageOrder,
            });
          }
          continue;
        }
        speechBoundaries.push({
          role: message.evidence.role,
          messageId: message.evidence.messageId,
          messageOrder: message.messageOrder,
          text,
        });
        events.push({
          kind: "speech",
          role: message.evidence.role,
          sessionId,
          messageId: message.evidence.messageId,
          partId,
          ...(observedAt ? { observedAt } : {}),
          text,
        });
        continue;
      }

      if (type === "reasoning" && message.evidence.role === "assistant") {
        const text = safePartText(data.text, partId, diagnostics);
        if (!text) {
          if (
            typeof data.text !== "string" ||
            data.text.length > KILO_STORE_LIMITS.textChars
          ) {
            transcriptTruncated = true;
          }
          continue;
        }
        events.push({
          kind: "reasoning",
          role: "assistant",
          sessionId,
          messageId: message.evidence.messageId,
          partId,
          ...(observedAt ? { observedAt } : {}),
          text,
        });
        continue;
      }

      if (type === "tool" && message.evidence.role === "assistant") {
        const state = record(data.state);
        const status = state?.status;
        const callId = boundedJsonString(
          data.callID,
          ID_CHARS,
          "part",
          partId,
          "tool call id",
          diagnostics,
        );
        const toolName = boundedJsonString(
          data.tool,
          ID_CHARS,
          "part",
          partId,
          "tool name",
          diagnostics,
        );
        const toolTitle = boundedJsonString(
          state?.title,
          KILO_STORE_LIMITS.textChars,
          "part",
          partId,
          "tool title",
          diagnostics,
        );
        if (
          !callId || !toolName ||
          (status !== "pending" && status !== "running" && status !== "completed" && status !== "error")
        ) {
          diagnostic(diagnostics, {
            kind: "invalid-record",
            table: "part",
            recordId: partId,
            detail: "tool part lacks a bounded call id, tool name, or status",
          });
          continue;
        }
        events.push({
          kind: "tool",
          role: "assistant",
          sessionId,
          messageId: message.evidence.messageId,
          partId,
          ...(observedAt ? { observedAt } : {}),
          callId,
          toolName,
          status,
          ...(toolTitle ? { title: toolTitle } : {}),
        });
        continue;
      }

      const nonPublishedTypes = [
        "step-start",
        "file",
        "agent",
        "subtask",
        "snapshot",
        "patch",
        "retry",
        "compaction",
      ];
      if (
        typeof type === "string" &&
        (type === "reasoning" || type === "tool" || nonPublishedTypes.includes(type))
      ) {
        continue;
      }
      diagnostic(diagnostics, {
        kind: "invalid-record",
        table: "part",
        recordId: partId,
        detail: "part type is unknown or invalid and was skipped",
      });
      transcriptTruncated = true;
      registerUntypedPart(authority);
    }
  }

  const prose = events.filter(
    (event): event is Extract<KiloTranscriptEvent, { kind: "speech" }> => event.kind === "speech",
  );
  const firstUserBoundary = speechBoundaries.find(({ role, messageId }) =>
    role === "user" && (!bundle.messageWindowGap || bundle.earlyMessageIds.has(messageId))
  );
  const firstUser = firstUserBoundary && !messageAuthorityHoles.some(
    (messageOrder) => messageOrder < firstUserBoundary.messageOrder,
  ) && !unknownPartMessageOrders.user.some(
    (messageOrder) => messageOrder <= firstUserBoundary.messageOrder,
  )
    ? firstUserBoundary.text
    : undefined;
  const assistantMessages = decodedMessages.filter(({ evidence }) => evidence.role === "assistant");
  const latestKnownAssistant = assistantMessages.at(-1);
  const assistantSuffixAuthoritative = latestKnownAssistant !== undefined &&
    !messageAuthorityHoles.some((messageOrder) =>
      messageOrder > latestKnownAssistant.messageOrder
    );
  const assistantClosingBoundary = assistantSuffixAuthoritative
    ? [...speechBoundaries].reverse().find(({ role }) => role === "assistant")
    : undefined;
  const assistantClosing = assistantClosingBoundary &&
      !unknownPartMessageOrders.assistant.some(
        (messageOrder) => messageOrder >= assistantClosingBoundary.messageOrder,
      )
    ? assistantClosingBoundary.text
    : undefined;
  const callSizesComplete = assistantMessages.length > 0 && callSizes.length > 0 &&
    !transcriptTruncated && !invalidStepFinish &&
    assistantMessages.every(({ evidence }) =>
      (validStepFinishTotals.get(evidence.messageId) ?? 0) > 0
  );
  const earliestAssistantCwd = assistantMessages.find(({ assistantCwd }) => assistantCwd)?.assistantCwd;
  const latestAssistantCwd = assistantSuffixAuthoritative
    ? [...assistantMessages].reverse().find(({ assistantCwd }) => assistantCwd)?.assistantCwd
    : undefined;
  const latestAssistant = assistantSuffixAuthoritative ? latestKnownAssistant : undefined;
  const latestTurn = latestAssistant
    ? {
      messageId: latestAssistant.evidence.messageId,
      ...(latestAssistant.evidence.parentMessageId
        ? { parentMessageId: latestAssistant.evidence.parentMessageId }
        : {}),
      ...(latestAssistant.evidence.createdAt ? { createdAt: latestAssistant.evidence.createdAt } : {}),
      ...(latestAssistant.evidence.completedAt
        ? { completedAt: latestAssistant.evidence.completedAt }
        : {}),
      ...(latestAssistant.finish ? { finish: latestAssistant.finish } : {}),
    }
    : undefined;
  let latestCallTokens: KiloTokenCounters | undefined;
  if (latestAssistant) {
    const latestAssistantId = latestAssistant.evidence.messageId;
    const latestValidAuthority = latestValidStepFinish.get(latestAssistantId);
    const untypedPartRevokesUsage =
      (untypedPartAuthorities.get(latestAssistantId) ?? []).some((authority) => {
        if (!latestValidAuthority) return true;
        const order = compareUntypedPartAuthority(authority, latestValidAuthority);
        return order === undefined || order >= 0;
      });
    if (!bundle.partTruncated && !untypedPartRevokesUsage) {
      latestCallTokens = latestStepFinish.get(latestAssistantId)?.tokens ??
        tokenCounters(latestAssistant.data.tokens);
      if (!latestCallTokens && latestAssistant.data.tokens !== undefined) {
        diagnostic(diagnostics, {
          kind: "invalid-record",
          table: "message",
          recordId: latestAssistantId,
          detail: "latest assistant token counters are invalid and remain unavailable",
        });
      }
    }
  }

  const tailSource = prose.map(({ text }) => text).join("\n");
  const tailCapped = tailSource.length > KILO_STORE_LIMITS.transcriptTailChars;
  const transcriptTail = tailSource
    ? {
      text: tailSource.slice(-KILO_STORE_LIMITS.transcriptTailChars),
      truncated: transcriptTruncated || tailCapped,
    }
    : undefined;
  const publishedTitle = sourceTitle(title);

  return {
    provider: "kilo",
    sessionId,
    slug,
    ...(parentSessionId ? { parentSessionId } : {}),
    ...(publishedTitle ? { sourceTitle: publishedTitle } : {}),
    ...(sourceDirectory ? { sourceDirectory } : {}),
    ...(sourcePath ? { sourcePath } : {}),
    ...(sessionModel ? { rawModel: sessionModel } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(archivedAt ? { archivedAt } : {}),
    ...(firstUser ? { firstTask: firstUser, firstUserText: firstUser } : {}),
    messages: decodedMessages.map(({ evidence }) => evidence),
    prose,
    ...(assistantClosing ? { assistantClosing } : {}),
    ...(transcriptTail ? { transcriptTail } : {}),
    events,
    ...(earliestAssistantCwd ? { earliestAssistantCwd } : {}),
    ...(latestAssistantCwd ? { latestAssistantCwd } : {}),
    ...(latestTurn ? { latestTurn } : {}),
    ...(latestCallTokens ? { latestCallTokens } : {}),
    ...(callSizesComplete ? { callSizes } : {}),
    callSizesComplete,
    ...(sessionTokens ? { sessionTokens } : {}),
    transcriptTruncated,
  };
}

function deadlineResult(): KiloStoreEvidence {
  return {
    sessions: [],
    diagnostics: [{
      kind: "deadline",
      table: "store",
      detail: "Kilo store deadline expired with remaining population not enumerated",
    }],
    incomplete: true,
    absent: false,
  };
}

export function readKiloStore(
  path: string,
  options: KiloReadOptions = {},
): KiloStoreEvidence {
  throwIfAborted(options.signal);
  const nowMs = options.nowMs ?? Date.now;
  const pastDeadline = () => {
    throwIfAborted(options.signal);
    const expired = options.deadlineAtMs !== undefined && nowMs() >= options.deadlineAtMs;
    throwIfAborted(options.signal);
    return expired;
  };
  if (pastDeadline()) return deadlineResult();

  const sessionLimit = boundedLimit(options.sessionLimit, KILO_STORE_LIMITS.sessions);
  const recentMessageLimit = boundedLimit(
    options.recentMessageLimit,
    KILO_STORE_LIMITS.recentMessagesPerSession,
  );
  const earlyMessageLimit = boundedLimit(
    options.earlyMessageLimit,
    KILO_STORE_LIMITS.earlyMessagesPerSession,
  );
  const partLimit = boundedLimit(options.partLimit, KILO_STORE_LIMITS.partsPerSession);

  let raw: RawStoreSnapshot;
  try {
    raw = runBoundedSync(options.signal, () =>
      readForeignSqlite(path, (database) =>
        readRawSnapshot(
          database,
          sessionLimit,
          recentMessageLimit,
          earlyMessageLimit,
          partLimit,
          pastDeadline,
          nonEmptyString(options.sessionId),
          options.signal,
        )
      )
    );
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    if (error instanceof ForeignSqliteReadError && error.kind === "absent") {
      return { sessions: [], diagnostics: [], incomplete: false, absent: true };
    }
    throw error;
  }

  const diagnostics: KiloStoreDiagnostic[] = [];
  if (raw.sessionTruncated) {
    diagnostic(diagnostics, {
      kind: "truncated",
      table: "session",
      detail: `bounded session window capped at ${sessionLimit}; admission uses native id order and global recency is unproven`,
    });
  }
  const sessions: KiloSessionEvidence[] = [];
  let deadlineExpired = raw.deadlineExpired;
  for (const [index, bundle] of raw.sessions.entries()) {
    throwIfAborted(options.signal);
    const session = parseSession(bundle, diagnostics);
    throwIfAborted(options.signal);
    if (session) sessions.push(session);
    if (
      !deadlineExpired && pastDeadline() &&
      (index + 1 < raw.sessions.length || raw.sessionTruncated)
    ) {
      deadlineExpired = true;
      break;
    }
  }
  if (deadlineExpired) {
    diagnostic(diagnostics, {
      kind: "deadline",
      table: "store",
      detail: "Kilo store deadline expired with remaining population not enumerated",
    });
  }
  return {
    sessions,
    diagnostics,
    incomplete: deadlineExpired,
    absent: false,
  };
}

function isKiloStoreName(name: string): boolean {
  return /^kilo(?:-[A-Za-z0-9._-]+)?\.db$/.test(name) ||
    /^opencode-[A-Za-z0-9._-]+\.db$/.test(name);
}

export function readKiloDataDir(
  dataDir: string,
  options: KiloReadOptions = {},
): KiloDataDirEvidence {
  throwIfAborted(options.signal);
  const pastDeadline = () => {
    throwIfAborted(options.signal);
    const expired = options.deadlineAtMs !== undefined &&
      (options.nowMs ?? Date.now)() >= options.deadlineAtMs;
    throwIfAborted(options.signal);
    return expired;
  };
  const matchingNames: string[] = [];
  const errors: string[] = [];
  let deadlineReached = false;
  let directoryTruncated = false;
  let exhausted = false;
  let directory: ReturnType<typeof opendirSync> | undefined;
  try {
    if (pastDeadline()) {
      return {
        stores: [],
        errors: ["Kilo data directory deadline expired with matching stores not enumerated."],
        absent: false,
      };
    }
    directory = runBoundedSync(options.signal, () => opendirSync(dataDir));
    let admittedEntries = 0;
    while (admittedEntries < KILO_STORE_LIMITS.dataDirEntries) {
      if (pastDeadline()) {
        deadlineReached = true;
        break;
      }
      const entry = runBoundedSync(options.signal, () => directory!.readSync());
      if (!entry) {
        exhausted = true;
        break;
      }
      admittedEntries += 1;
      options.testHooks?.onDataDirEntry?.(dataDir, entry.name);
      throwIfAborted(options.signal);
      if (pastDeadline()) {
        deadlineReached = true;
        break;
      }
      if (!isKiloStoreName(entry.name)) continue;
      const path = join(dataDir, entry.name);
      if (!entry.isFile()) {
        errors.push(`${path}: Kilo store is not a regular file.`);
        continue;
      }
      matchingNames.push(entry.name);
    }
    if (
      !deadlineReached &&
      !exhausted &&
      admittedEntries === KILO_STORE_LIMITS.dataDirEntries
    ) {
      if (pastDeadline()) {
        deadlineReached = true;
      } else {
        const witness = runBoundedSync(options.signal, () => directory!.readSync());
        if (witness) {
          options.testHooks?.onDataDirEntry?.(dataDir, witness.name);
          throwIfAborted(options.signal);
          if (pastDeadline()) deadlineReached = true;
          else directoryTruncated = true;
        }
      }
    }
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { stores: [], errors: [], absent: true };
    }
    return {
      stores: [],
      errors: [foreignSqliteFailureMessage(error, "Kilo data directory could not be enumerated")],
      absent: false,
    };
  } finally {
    directory?.closeSync();
  }

  throwIfAborted(options.signal);

  if (deadlineReached) {
    errors.push("Kilo data directory deadline expired with matching stores not enumerated.");
  }
  if (directoryTruncated) {
    errors.push(`Kilo data directory entry limit ${KILO_STORE_LIMITS.dataDirEntries} reached with entries not enumerated.`);
  }
  if (deadlineReached) return { stores: [], errors, absent: false };

  const stores: KiloDataDirStoreEvidence[] = [];
  if (matchingNames.length > KILO_STORE_LIMITS.dataDirStores) {
    errors.push(`Kilo data directory store limit ${KILO_STORE_LIMITS.dataDirStores} reached with matching stores not enumerated.`);
  }
  for (const name of matchingNames
    .sort((left, right) => left.localeCompare(right))
    .slice(0, KILO_STORE_LIMITS.dataDirStores)) {
    throwIfAborted(options.signal);
    const path = join(dataDir, name);
    options.testHooks?.beforeStoreRead?.(path);
    throwIfAborted(options.signal);
    if (pastDeadline()) {
      errors.push("Kilo data directory deadline expired with matching stores not enumerated.");
      break;
    }
    try {
      const evidence = readKiloStore(path, options);
      if (evidence.absent) {
        errors.push(`${path}: Kilo database disappeared before it could be read.`);
      } else {
        stores.push({ path, evidence });
      }
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      errors.push(`${path}: ${foreignSqliteFailureMessage(error, "Kilo population is unavailable")}`);
    }
  }
  return { stores, errors, absent: false };
}
