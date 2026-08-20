import type { Database, SQLQueryBindings } from "bun:sqlite";
import { ForeignSqliteReadError, readForeignSqlite } from "./foreign-sqlite";

export const OPENCODE_SCHEMA_COMMIT = "e2505d434a6d78904ecfe546c4a1980d26bd8cd1";
export const OPENCODE_LATEST_MIGRATION = "20260622202450_simplify_session_input";

export const OPENCODE_STORE_LIMITS = {
  sessions: 50,
  recentMessagesPerSession: 100,
  earlyMessagesPerSession: 16,
  partsPerSession: 400,
  jsonChars: 64_000,
  textChars: 8_000,
  transcriptTailChars: 800,
} as const;

export interface OpenCodeReadOptions {
  sessionLimit?: number;
  messageLimit?: number;
  partLimit?: number;
  deadlineAtMs?: number;
  nowMs?: () => number;
}

export interface OpenCodeRawModel {
  modelId: string;
  providerRoute: string;
  rawVariant?: string;
}

export interface OpenCodeTokenCounters {
  nonCachedInput: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  total?: number;
}

export interface OpenCodeMessageEvidence {
  messageId: string;
  sessionId: string;
  role: "user" | "assistant";
  createdAt?: string;
  completedAt?: string;
  parentMessageId?: string;
  rawModel?: OpenCodeRawModel;
}

interface OpenCodeEventBase {
  sessionId: string;
  messageId: string;
  partId: string;
  observedAt?: string;
}

export type OpenCodeTranscriptEvent =
  | (OpenCodeEventBase & {
    kind: "speech";
    role: "user" | "assistant";
    text: string;
  })
  | (OpenCodeEventBase & {
    kind: "reasoning";
    role: "assistant";
    text: string;
  })
  | (OpenCodeEventBase & {
    kind: "tool";
    role: "assistant";
    callId: string;
    toolName: string;
    status: "pending" | "running" | "completed" | "error";
    title?: string;
  });

export interface OpenCodeSessionEvidence {
  sessionId: string;
  parentSessionId?: string;
  sourceTitle?: {
    text: string;
    provenance: "opencode-source-title-unverified-authorship";
  };
  sourceDirectory?: string;
  sourcePath?: string;
  rawModel?: OpenCodeRawModel;
  startedAt?: string;
  updatedAt?: string;
  archivedAt?: string;
  firstTask?: string;
  firstUserText?: string;
  messages: OpenCodeMessageEvidence[];
  prose: Array<Extract<OpenCodeTranscriptEvent, { kind: "speech" }>>;
  assistantClosing?: string;
  transcriptTail?: {
    text: string;
    truncated: boolean;
  };
  events: OpenCodeTranscriptEvent[];
  earliestAssistantCwd?: string;
  latestAssistantCwd?: string;
  latestTurn?: {
    messageId: string;
    parentMessageId?: string;
    createdAt?: string;
    completedAt?: string;
    finish?: string;
  };
  latestCallTokens?: OpenCodeTokenCounters;
  callSizes?: number[];
  sessionTokens?: OpenCodeTokenCounters;
  transcriptTruncated: boolean;
}

export interface OpenCodeStoreDiagnostic {
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

export interface OpenCodeStoreEvidence {
  sessions: OpenCodeSessionEvidence[];
  diagnostics: OpenCodeStoreDiagnostic[];
  incomplete: boolean;
}

type JsonRecord = Record<string, unknown>;

interface RawSessionRow {
  id: unknown;
  id_length: unknown;
  parent_id: unknown;
  parent_id_length: unknown;
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
  id: unknown;
  id_length: unknown;
  message_id: unknown;
  message_id_length: unknown;
  time_created: unknown;
  time_updated: unknown;
  data: unknown;
  data_length: unknown;
}

interface RawSessionBundle {
  session: RawSessionRow;
  messages: RawMessageRow[];
  parts: RawPartRow[];
  messageTruncated: boolean;
  partTruncated: boolean;
  messageLimit: number;
  partLimit: number;
}

interface RawStoreSnapshot {
  sessions: RawSessionBundle[];
  sessionTruncated: boolean;
  deadlineExpired: boolean;
}

interface DecodedMessage {
  evidence: OpenCodeMessageEvidence;
  data: JsonRecord;
  assistantCwd?: string;
  finish?: string;
}

const ID_CHARS = 256;
const MIGRATION_ROWS = 1_000;
const REQUIRED_COLUMNS = {
  session: [
    "id",
    "project_id",
    "parent_id",
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

function decodedTimestamp(
  value: unknown,
  table: "session" | "message" | "part",
  recordId: string,
  field: string,
  diagnostics: OpenCodeStoreDiagnostic[],
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

function compareRows(
  left: { id: unknown; time_created: unknown },
  right: { id: unknown; time_created: unknown },
): number {
  const time = (nonNegativeInteger(left.time_created) ?? 0) -
    (nonNegativeInteger(right.time_created) ?? 0);
  if (time !== 0) return time;
  return String(left.id ?? "").localeCompare(String(right.id ?? ""));
}

function schemaColumns(database: Database, table: keyof typeof REQUIRED_COLUMNS): Set<string> {
  const rows = database.query(`PRAGMA table_info("${table}")`).all() as Array<{ name?: unknown }>;
  return new Set(rows.flatMap(({ name }) => typeof name === "string" ? [name] : []));
}

function assertPinnedSchema(database: Database): void {
  for (const [table, expected] of Object.entries(REQUIRED_COLUMNS) as Array<
    [keyof typeof REQUIRED_COLUMNS, readonly string[]]
  >) {
    const columns = schemaColumns(database, table);
    const missing = expected.filter((column) => !columns.has(column));
    if (missing.length > 0) {
      throw new ForeignSqliteReadError(
        "schema",
        `OpenCode ${table} table is missing required columns: ${missing.join(", ")}`,
      );
    }
  }

  const migrations = database.query(`
    SELECT substr(id, 1, ${ID_CHARS + 1}) AS id, length(id) AS id_length
    FROM migration
    ORDER BY id
    LIMIT ${MIGRATION_ROWS + 1}
  `).all() as Array<{ id?: unknown; id_length?: unknown }>;
  if (migrations.length > MIGRATION_ROWS) {
    throw new ForeignSqliteReadError("schema", "OpenCode migration journal exceeds the pinned read bound");
  }

  let latestPresent = false;
  for (const row of migrations) {
    const length = nonNegativeInteger(row.id_length);
    const id = nonEmptyString(row.id);
    if (!id || length === undefined || length > ID_CHARS) {
      throw new ForeignSqliteReadError("schema", "OpenCode migration journal contains an invalid id");
    }
    if (id === OPENCODE_LATEST_MIGRATION) latestPresent = true;
    if (/^\d{14}_.+/.test(id) && id > OPENCODE_LATEST_MIGRATION) {
      throw new ForeignSqliteReadError("schema", `OpenCode store has unknown future migration ${id}`);
    }
  }
  if (!latestPresent) {
    throw new ForeignSqliteReadError(
      "schema",
      `OpenCode store is missing pinned migration ${OPENCODE_LATEST_MIGRATION}`,
    );
  }
}

function readMessageWindow(
  database: Database,
  sessionId: string,
  direction: "ASC" | "DESC",
  limit: number,
): RawMessageRow[] {
  return database.query(`
    SELECT
      substr(id, 1, ${ID_CHARS + 1}) AS id,
      length(id) AS id_length,
      time_created,
      substr(data, 1, ${OPENCODE_STORE_LIMITS.jsonChars + 1}) AS data,
      length(data) AS data_length
    FROM message
    WHERE session_id = ?
    ORDER BY time_created ${direction}, id ${direction}
    LIMIT ?
  `).all(sessionId, limit) as RawMessageRow[];
}

function readSelectedParts(
  database: Database,
  sessionId: string,
  messageIds: string[],
  limit: number,
): RawPartRow[] {
  if (messageIds.length === 0) return [];
  const selectedValues = messageIds.map(() => "(?, ?)").join(", ");
  const bindings: SQLQueryBindings[] = [];
  for (const [messageOrder, messageId] of messageIds.entries()) {
    bindings.push(messageId, messageOrder);
  }
  bindings.push(sessionId, limit);
  return database.query(`
    WITH selected(message_id, message_order) AS (
      VALUES ${selectedValues}
    ), ranked AS (
      SELECT
        part.rowid AS part_rowid,
        part.id AS part_id,
        selected.message_order,
        row_number() OVER (PARTITION BY part.message_id ORDER BY part.id) AS early_rank,
        row_number() OVER (PARTITION BY part.message_id ORDER BY part.id DESC) AS recent_rank
      FROM part
      JOIN selected ON selected.message_id = part.message_id
      WHERE part.session_id = ?
    ), bounded AS (
      SELECT part_rowid, part_id, message_order, early_rank, recent_rank
      FROM ranked
      ORDER BY min(early_rank, recent_rank), message_order, part_id
      LIMIT ?
    )
    SELECT
      substr(part.id, 1, ${ID_CHARS + 1}) AS id,
      length(part.id) AS id_length,
      substr(part.message_id, 1, ${ID_CHARS + 1}) AS message_id,
      length(part.message_id) AS message_id_length,
      part.time_created,
      part.time_updated,
      substr(part.data, 1, ${OPENCODE_STORE_LIMITS.jsonChars + 1}) AS data,
      length(part.data) AS data_length
    FROM bounded
    JOIN part ON part.rowid = bounded.part_rowid
    ORDER BY min(bounded.early_rank, bounded.recent_rank), bounded.message_order, bounded.part_id
  `).all(...bindings) as RawPartRow[];
}

function readRawSnapshot(
  database: Database,
  sessionLimit: number,
  messageLimit: number,
  partLimit: number,
  pastDeadline: () => boolean,
): RawStoreSnapshot {
  if (pastDeadline()) return { sessions: [], sessionTruncated: false, deadlineExpired: true };
  assertPinnedSchema(database);
  if (pastDeadline()) return { sessions: [], sessionTruncated: false, deadlineExpired: true };

  const sessionRows = database.query(`
    SELECT
      substr(id, 1, ${ID_CHARS + 1}) AS id,
      length(id) AS id_length,
      substr(parent_id, 1, ${ID_CHARS + 1}) AS parent_id,
      length(parent_id) AS parent_id_length,
      substr(directory, 1, ${OPENCODE_STORE_LIMITS.textChars + 1}) AS directory,
      length(directory) AS directory_length,
      substr(path, 1, ${OPENCODE_STORE_LIMITS.textChars + 1}) AS path,
      length(path) AS path_length,
      substr(title, 1, ${OPENCODE_STORE_LIMITS.textChars + 1}) AS title,
      length(title) AS title_length,
      substr(model, 1, ${OPENCODE_STORE_LIMITS.jsonChars + 1}) AS model,
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
    ORDER BY time_updated DESC, id DESC
    LIMIT ?
  `).all(sessionLimit + 1) as RawSessionRow[];
  const sessionTruncated = sessionRows.length > sessionLimit;
  const sessions: RawSessionBundle[] = [];

  for (const session of sessionRows.slice(0, sessionLimit)) {
    if (pastDeadline()) return { sessions, sessionTruncated, deadlineExpired: true };
    const sessionId = nonEmptyString(session.id);
    const idLength = nonNegativeInteger(session.id_length);
    if (!sessionId || idLength === undefined || idLength > ID_CHARS) {
      sessions.push({
        session,
        messages: [],
        parts: [],
        messageTruncated: false,
        partTruncated: false,
        messageLimit,
        partLimit,
      });
      continue;
    }

    const early = readMessageWindow(
      database,
      sessionId,
      "ASC",
      OPENCODE_STORE_LIMITS.earlyMessagesPerSession,
    );
    if (pastDeadline()) return { sessions, sessionTruncated, deadlineExpired: true };
    const recentRows = readMessageWindow(database, sessionId, "DESC", messageLimit + 1);
    const messageTruncated = recentRows.length > messageLimit;
    const selected = new Map<string, RawMessageRow>();
    for (const message of [...early, ...recentRows.slice(0, messageLimit)]) {
      selected.set(String(message.id ?? ""), message);
    }
    const messages = [...selected.values()].sort(compareRows);
    const messageIds = messages.flatMap((message) => {
      const id = nonEmptyString(message.id);
      const length = nonNegativeInteger(message.id_length);
      return id && length !== undefined && length <= ID_CHARS ? [id] : [];
    });

    if (pastDeadline()) return { sessions, sessionTruncated, deadlineExpired: true };
    const partRows = readSelectedParts(database, sessionId, messageIds, partLimit + 1);
    const partTruncated = partRows.length > partLimit;
    const messageOrder = new Map(messageIds.map((messageId, index) => [messageId, index]));
    const parts = partRows.slice(0, partLimit).sort((left, right) => {
      const messageDifference = (messageOrder.get(String(left.message_id)) ?? messageIds.length) -
        (messageOrder.get(String(right.message_id)) ?? messageIds.length);
      return messageDifference || String(left.id ?? "").localeCompare(String(right.id ?? ""));
    });
    sessions.push({
      session,
      messages,
      parts,
      messageTruncated,
      partTruncated,
      messageLimit,
      partLimit,
    });
  }
  return { sessions, sessionTruncated, deadlineExpired: false };
}

function diagnostic(
  diagnostics: OpenCodeStoreDiagnostic[],
  value: OpenCodeStoreDiagnostic,
): void {
  diagnostics.push(value);
}

function boundedCell(
  value: unknown,
  rawLength: unknown,
  max: number,
  table: OpenCodeStoreDiagnostic["table"],
  recordId: string | undefined,
  field: string,
  diagnostics: OpenCodeStoreDiagnostic[],
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
  diagnostics: OpenCodeStoreDiagnostic[],
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
  diagnostics: OpenCodeStoreDiagnostic[],
): JsonRecord | undefined {
  const length = nonNegativeInteger(rawLength);
  if (length !== undefined && length > OPENCODE_STORE_LIMITS.jsonChars) {
    diagnostic(diagnostics, {
      kind: "oversized-json",
      table,
      recordId,
      detail: `JSON exceeds ${OPENCODE_STORE_LIMITS.jsonChars} characters and was skipped`,
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
    // The bounded record is diagnosed below without including its contents.
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
  diagnostics: OpenCodeStoreDiagnostic[],
): OpenCodeRawModel | undefined {
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

function tokenCounters(value: unknown): OpenCodeTokenCounters | undefined {
  const tokens = record(value);
  const cache = record(tokens?.cache);
  const nonCachedInput = nonNegativeInteger(tokens?.input);
  const output = nonNegativeInteger(tokens?.output);
  const reasoning = nonNegativeInteger(tokens?.reasoning);
  const cacheRead = nonNegativeInteger(cache?.read);
  const cacheWrite = nonNegativeInteger(cache?.write);
  if (
    nonCachedInput === undefined || output === undefined || reasoning === undefined ||
    cacheRead === undefined || cacheWrite === undefined
  ) return undefined;
  const total = nonNegativeInteger(tokens?.total);
  return {
    nonCachedInput,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    ...(total === undefined ? {} : { total }),
  };
}

function sourceTitle(value: string | undefined): OpenCodeSessionEvidence["sourceTitle"] {
  if (!value) return undefined;
  const prefix = "New session - ";
  if (value.startsWith(prefix) && Number.isFinite(Date.parse(value.slice(prefix.length)))) {
    return undefined;
  }
  return { text: value, provenance: "opencode-source-title-unverified-authorship" };
}

function safePartText(
  value: unknown,
  partId: string,
  diagnostics: OpenCodeStoreDiagnostic[],
): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  if (value.length > OPENCODE_STORE_LIMITS.textChars) {
    diagnostic(diagnostics, {
      kind: "oversized-content",
      table: "part",
      recordId: partId,
      detail: `part text exceeds ${OPENCODE_STORE_LIMITS.textChars} characters and was skipped`,
    });
    return undefined;
  }
  return value;
}

function parseSession(
  bundle: RawSessionBundle,
  diagnostics: OpenCodeStoreDiagnostic[],
): OpenCodeSessionEvidence | undefined {
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
    OPENCODE_STORE_LIMITS.textChars,
    "session",
    sessionId,
    "directory",
    diagnostics,
  ));
  const sourcePath = nonEmptyString(boundedCell(
    bundle.session.path,
    bundle.session.path_length,
    OPENCODE_STORE_LIMITS.textChars,
    "session",
    sessionId,
    "path",
    diagnostics,
  ));
  const title = nonEmptyString(boundedCell(
    bundle.session.title,
    bundle.session.title_length,
    OPENCODE_STORE_LIMITS.textChars,
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

  let sessionModel: OpenCodeRawModel | undefined;
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
    : { nonCachedInput: input, output, reasoning, cacheRead, cacheWrite };
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
      detail: `recent message window capped at ${bundle.messageLimit}`,
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
  for (const row of bundle.messages) {
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
      transcriptTruncated = true;
      continue;
    }
    const data = decodedJson(row.data, row.data_length, "message", messageId, diagnostics);
    if (!data) {
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
    const jsonCreatedPresent = time?.created !== null && time?.created !== undefined;
    const jsonCreatedAt = jsonCreatedPresent
      ? decodedTimestamp(
        time?.created,
        "message",
        messageId,
        "time.created",
        diagnostics,
      )
      : undefined;
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
        OPENCODE_STORE_LIMITS.textChars,
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

  const events: OpenCodeTranscriptEvent[] = [];
  const stepFinishTokens = new Map<string, OpenCodeTokenCounters>();
  const callSizes: number[] = [];
  for (const message of decodedMessages) {
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
        continue;
      }
      const observedAt = decodedTimestamp(
        row.time_created,
        "part",
        partId,
        "time_created",
        diagnostics,
      );
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
        continue;
      }
      const type = data.type;
      if (type === "step-finish") {
        const tokens = tokenCounters(data.tokens);
        if (tokens) {
          stepFinishTokens.set(message.evidence.messageId, tokens);
          if (tokens.total !== undefined) callSizes.push(tokens.total);
        }
        else {
          diagnostic(diagnostics, {
            kind: "invalid-record",
            table: "part",
            recordId: partId,
            detail: "step-finish token counters are invalid and remain unavailable",
          });
        }
        continue;
      }
      if (type === "text") {
        if (data.synthetic === true || data.ignored === true) continue;
        const text = safePartText(data.text, partId, diagnostics);
        if (!text) {
          if (typeof data.text === "string" && data.text.length > OPENCODE_STORE_LIMITS.textChars) {
            transcriptTruncated = true;
          }
          continue;
        }
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
          if (typeof data.text === "string" && data.text.length > OPENCODE_STORE_LIMITS.textChars) {
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
          OPENCODE_STORE_LIMITS.textChars,
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
      }
    }
  }

  const prose = events.filter(
    (event): event is Extract<OpenCodeTranscriptEvent, { kind: "speech" }> => event.kind === "speech",
  );
  const firstUser = prose.find(({ role }) => role === "user")?.text;
  const assistantClosing = [...prose].reverse().find(({ role }) => role === "assistant")?.text;
  const assistantMessages = decodedMessages.filter(({ evidence }) => evidence.role === "assistant");
  const earliestAssistantCwd = assistantMessages.find(({ assistantCwd }) => assistantCwd)?.assistantCwd;
  const latestAssistantCwd = [...assistantMessages].reverse()
    .find(({ assistantCwd }) => assistantCwd)?.assistantCwd;
  const latestAssistant = assistantMessages.at(-1);
  const latestTurn = latestAssistant
    ? {
      messageId: latestAssistant.evidence.messageId,
      ...(latestAssistant.evidence.parentMessageId
        ? { parentMessageId: latestAssistant.evidence.parentMessageId }
        : {}),
      ...(latestAssistant.evidence.createdAt ? { createdAt: latestAssistant.evidence.createdAt } : {}),
      ...(latestAssistant.evidence.completedAt ? { completedAt: latestAssistant.evidence.completedAt } : {}),
      ...(latestAssistant.finish ? { finish: latestAssistant.finish } : {}),
    }
    : undefined;
  let latestCallTokens: OpenCodeTokenCounters | undefined;
  if (latestAssistant) {
    latestCallTokens = stepFinishTokens.get(latestAssistant.evidence.messageId) ??
      tokenCounters(latestAssistant.data.tokens);
    if (!latestCallTokens && latestAssistant.data.tokens !== undefined) {
      diagnostic(diagnostics, {
        kind: "invalid-record",
        table: "message",
        recordId: latestAssistant.evidence.messageId,
        detail: "latest assistant token counters are invalid and remain unavailable",
      });
    }
  }

  const tailSource = prose.map(({ text }) => text).join("\n");
  const tailCapped = tailSource.length > OPENCODE_STORE_LIMITS.transcriptTailChars;
  const transcriptTail = tailSource
    ? {
      text: tailSource.slice(-OPENCODE_STORE_LIMITS.transcriptTailChars),
      truncated: transcriptTruncated || tailCapped,
    }
    : undefined;
  const publishedTitle = sourceTitle(title);

  return {
    sessionId,
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
    ...(callSizes.length > 0 ? { callSizes } : {}),
    ...(sessionTokens ? { sessionTokens } : {}),
    transcriptTruncated,
  };
}

function deadlineResult(): OpenCodeStoreEvidence {
  return {
    sessions: [],
    diagnostics: [{
      kind: "deadline",
      table: "store",
      detail: "OpenCode store deadline expired before enumeration completed",
    }],
    incomplete: true,
  };
}

export function readOpenCodeStore(
  path: string,
  options: OpenCodeReadOptions = {},
): OpenCodeStoreEvidence {
  const nowMs = options.nowMs ?? Date.now;
  const pastDeadline = () => options.deadlineAtMs !== undefined && nowMs() >= options.deadlineAtMs;
  if (pastDeadline()) return deadlineResult();

  const sessionLimit = boundedLimit(options.sessionLimit, OPENCODE_STORE_LIMITS.sessions);
  const messageLimit = boundedLimit(options.messageLimit, OPENCODE_STORE_LIMITS.recentMessagesPerSession);
  const partLimit = boundedLimit(options.partLimit, OPENCODE_STORE_LIMITS.partsPerSession);
  const raw = readForeignSqlite(path, (database) =>
    readRawSnapshot(database, sessionLimit, messageLimit, partLimit, pastDeadline)
  );
  const diagnostics: OpenCodeStoreDiagnostic[] = [];
  if (raw.sessionTruncated) {
    diagnostic(diagnostics, {
      kind: "truncated",
      table: "session",
      detail: `recent session window capped at ${sessionLimit}`,
    });
  }

  const sessions: OpenCodeSessionEvidence[] = [];
  const incomplete = raw.deadlineExpired;
  for (const bundle of raw.sessions) {
    const session = parseSession(bundle, diagnostics);
    if (session) sessions.push(session);
  }
  if (incomplete) {
    diagnostic(diagnostics, {
      kind: "deadline",
      table: "store",
      detail: "OpenCode store deadline expired before enumeration completed",
    });
  }
  return { sessions, diagnostics, incomplete };
}
