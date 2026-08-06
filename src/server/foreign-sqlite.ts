import { Database } from "bun:sqlite";
import {
  accessSync,
  closeSync,
  constants,
  openSync,
  readSync,
  statSync,
} from "node:fs";
import { pathToFileURL } from "node:url";

export type ForeignSqliteFailureKind =
  | "absent"
  | "permission"
  | "locked"
  | "corrupt"
  | "schema"
  | "changed"
  | "unreadable";

export class ForeignSqliteReadError extends Error {
  readonly kind: ForeignSqliteFailureKind;
  readonly detail?: string;

  constructor(kind: ForeignSqliteFailureKind, detail?: string) {
    super(kind === "absent" ? "database not found" : detail ?? kind);
    this.name = "ForeignSqliteReadError";
    this.kind = kind;
    this.detail = detail;
  }
}

interface StoreFingerprint {
  main: string;
  wal?: string;
  shm?: string;
}

function sqliteCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function classify(error: unknown): ForeignSqliteReadError {
  if (error instanceof ForeignSqliteReadError) return error;
  const code = sqliteCode(error);
  const message = errorMessage(error);
  if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") {
    return new ForeignSqliteReadError("locked", message);
  }
  if (code === "SQLITE_CORRUPT" || code === "SQLITE_NOTADB") {
    return new ForeignSqliteReadError("corrupt", message);
  }
  if (
    code === "SQLITE_SCHEMA" ||
    /\bno such (?:table|column)\b|\bdatabase schema (?:has changed|is malformed)\b/i.test(message)
  ) {
    return new ForeignSqliteReadError("schema", message);
  }
  return new ForeignSqliteReadError("unreadable", message);
}

function fileFingerprint(path: string): string | undefined {
  try {
    const details = statSync(path);
    accessSync(path, constants.R_OK);
    return `${details.dev}:${details.ino}:${details.size}:${details.mtimeMs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new ForeignSqliteReadError("permission", errorMessage(error));
  }
}

function inspectStore(path: string): StoreFingerprint {
  let details;
  try {
    details = statSync(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new ForeignSqliteReadError(
      code === "ENOENT" ? "absent" : "permission",
      errorMessage(error),
    );
  }
  if (!details.isFile()) {
    throw new ForeignSqliteReadError("unreadable", "path is not a regular file");
  }
  try {
    accessSync(path, constants.R_OK);
  } catch (error) {
    throw new ForeignSqliteReadError("permission", errorMessage(error));
  }
  return {
    main: `${details.dev}:${details.ino}:${details.size}:${details.mtimeMs}`,
    wal: fileFingerprint(`${path}-wal`),
    shm: fileFingerprint(`${path}-shm`),
  };
}

function walHeader(path: string): boolean {
  const header = Buffer.alloc(20);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, "r");
    if (readSync(descriptor, header, 0, header.length, 0) !== header.length) return false;
  } catch (error) {
    throw new ForeignSqliteReadError("permission", errorMessage(error));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  return header.subarray(0, 16).toString("utf8") === "SQLite format 3\u0000" &&
    header[18] === 2 && header[19] === 2;
}

function databaseUri(path: string, immutable: boolean): string {
  const uri = pathToFileURL(path);
  uri.searchParams.set("mode", "ro");
  if (immutable) uri.searchParams.set("immutable", "1");
  return uri.href;
}

function readWithDatabase<T>(
  path: string,
  immutable: boolean,
  reader: (database: Database) => T,
): T {
  const database = new Database(databaseUri(path, immutable), { readonly: true });
  try {
    return reader(database);
  } finally {
    database.close();
  }
}

function sameStore(left: StoreFingerprint, right: StoreFingerprint): boolean {
  return left.main === right.main && left.wal === right.wal && left.shm === right.shm;
}

/**
 * Reads a SQLite store owned by another application without ever opening it
 * writable. A live WAL is read through SQLite's ordinary read-only snapshot.
 * A stable WAL-header database whose sidecars are absent is read as immutable,
 * then accepted only if neither the database nor its sidecars changed during
 * the read.
 *
 * The callback must return detached data; the database is closed before this
 * function returns.
 */
export function readForeignSqlite<T>(path: string, reader: (database: Database) => T): T {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = inspectStore(path);
    const sidecarsAbsent = before.wal === undefined && before.shm === undefined;
    if (sidecarsAbsent && walHeader(path)) {
      let value: T;
      try {
        value = readWithDatabase(path, true, reader);
      } catch (error) {
        throw classify(error);
      }
      const after = inspectStore(path);
      if (sameStore(before, after)) return value;
      if (attempt === 0) continue;
      throw new ForeignSqliteReadError("changed", "database or WAL sidecars changed while reading");
    }

    try {
      return readWithDatabase(path, false, reader);
    } catch (error) {
      const failure = classify(error);
      if (failure.kind === "unreadable" && sqliteCode(error) === "SQLITE_CANTOPEN" && attempt === 0) {
        continue;
      }
      throw failure;
    }
  }
  throw new ForeignSqliteReadError("unreadable", "database could not be read safely");
}

export function verifyForeignSqlite(path: string): void {
  readForeignSqlite(path, (database) => {
    database.query("select count(*) from sqlite_master").get();
  });
}

export function foreignSqliteFailureMessage(error: unknown, impact: string): string {
  const failure = classify(error);
  const fault = {
    absent: "database is missing",
    permission: "database permissions deny read access",
    locked: "database is locked or busy",
    corrupt: "database is corrupt or is not SQLite",
    schema: "database schema is incompatible",
    changed: "database changed while it was being read",
    unreadable: `database could not be opened safely${failure.detail ? ` (${failure.detail})` : ""}`,
  }[failure.kind];
  return `${fault}; ${impact}.`;
}
