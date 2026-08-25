import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ForeignSqliteReadError, readForeignSqlite } from "../src/server/foreign-sqlite";

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

test("one foreign-SQLite callback observes one WAL snapshot across a writer commit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "formic-foreign-sqlite-snapshot-"));
  const path = join(directory, "foreign.db");
  const writer = new Database(path, { create: true });
  try {
    writer.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0");
    writer.exec("CREATE TABLE evidence (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    writer.run("INSERT INTO evidence(id, value) VALUES (1, ?)", ["before-commit"]);

    const callbackObservations = readForeignSqlite(path, (reader) => {
      const before = reader.query("SELECT value FROM evidence WHERE id = 1").get() as {
        value: string;
      };
      writer.run("UPDATE evidence SET value = ? WHERE id = 1", ["after-commit"]);
      const after = reader.query("SELECT value FROM evidence WHERE id = 1").get() as {
        value: string;
      };
      expect(() =>
        reader.run("UPDATE evidence SET value = ? WHERE id = 1", ["reader-write"])
      ).toThrow(/read-?only/i);
      return [before.value, after.value];
    });
    const laterObservation = readForeignSqlite(path, (reader) =>
      (reader.query("SELECT value FROM evidence WHERE id = 1").get() as { value: string }).value
    );

    expect(laterObservation).toBe("after-commit");
    expect(callbackObservations).toEqual(["before-commit", "before-commit"]);
  } finally {
    writer.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an initializer runs before the read transaction and reader failure releases the snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "formic-foreign-sqlite-initialize-"));
  const path = join(directory, "foreign.db");
  const setup = new Database(path, { create: true });
  setup.exec("CREATE TABLE evidence (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
  setup.run("INSERT INTO evidence(id, value) VALUES (1, ?)", ["detached"]);
  setup.close();

  let initializerObservation: { inTransaction: boolean; readOnly: boolean } | undefined;
  let readerObservation: { inTransaction: boolean; readOnly: boolean } | undefined;
  let initializerHandle: Database | undefined;
  let readerHandle: Database | undefined;
  const sentinel = new ForeignSqliteReadError("schema", "reader sentinel retained exactly");
  let caught: unknown;
  try {
    Reflect.apply(readForeignSqlite, undefined, [
      path,
      (reader: Database) => {
        readerHandle = reader;
        let readOnly = false;
        try {
          reader.exec("CREATE TABLE forbidden_reader_write (id INTEGER)");
        } catch (error) {
          readOnly = /read-?only/i.test(error instanceof Error ? error.message : String(error));
        }
        readerObservation = { inTransaction: reader.inTransaction, readOnly };
        throw sentinel;
      },
      {
        initialize(database: Database) {
          initializerHandle = database;
          let readOnly = false;
          try {
            database.exec("CREATE TABLE forbidden_initializer_write (id INTEGER)");
          } catch (error) {
            readOnly = /read-?only/i.test(error instanceof Error ? error.message : String(error));
          }
          initializerObservation = { inTransaction: database.inTransaction, readOnly };
        },
      },
    ]);
  } catch (error) {
    caught = error;
  }

  let handleClosed = false;
  try {
    readerHandle?.query("SELECT 1").get();
  } catch (error) {
    handleClosed = /closed/i.test(error instanceof Error ? error.message : String(error));
  }

  let exclusiveLockAcquired = false;
  const later = new Database(path);
  try {
    later.exec("BEGIN EXCLUSIVE");
    exclusiveLockAcquired = later.inTransaction;
  } finally {
    if (later.inTransaction) later.exec("ROLLBACK");
    later.close();
    await rm(directory, { recursive: true, force: true });
  }

  expect({
    initializerObservation,
    readerObservation,
    sameHandle: initializerHandle !== undefined && initializerHandle === readerHandle,
    retainedIdentity: caught === sentinel,
    retainedKind: caught instanceof ForeignSqliteReadError ? caught.kind : undefined,
    retainedDetail: caught instanceof ForeignSqliteReadError ? caught.detail : undefined,
    handleClosed,
    exclusiveLockAcquired,
  }).toEqual({
    initializerObservation: { inTransaction: false, readOnly: true },
    readerObservation: { inTransaction: true, readOnly: true },
    sameHandle: true,
    retainedIdentity: true,
    retainedKind: "schema",
    retainedDetail: "reader sentinel retained exactly",
    handleClosed: true,
    exclusiveLockAcquired: true,
  });
});

test("initializer failure retains its sentinel and closes the read-only handle", async () => {
  const directory = await mkdtemp(join(tmpdir(), "formic-foreign-sqlite-initialize-failure-"));
  const path = join(directory, "foreign.db");
  try {
    const setup = new Database(path, { create: true });
    try {
      setup.exec("CREATE TABLE evidence (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
      setup.run("INSERT INTO evidence(id, value) VALUES (1, ?)", ["sanitized"]);
    } finally {
      setup.close();
    }

    let initializerHandle: Database | undefined;
    let initializerObservation: { inTransaction: boolean; readOnly: boolean } | undefined;
    let readerInvocations = 0;
    const sentinel = new ForeignSqliteReadError(
      "corrupt",
      "initializer sentinel retained exactly",
    );
    let caught: unknown;
    try {
      Reflect.apply(readForeignSqlite, undefined, [
        path,
        () => {
          readerInvocations += 1;
          return undefined;
        },
        {
          initialize(database: Database) {
            initializerHandle = database;
            let readOnly = false;
            try {
              database.exec("CREATE TABLE forbidden_initializer_write (id INTEGER)");
            } catch (error) {
              readOnly = /read-?only/i.test(error instanceof Error ? error.message : String(error));
            }
            initializerObservation = { inTransaction: database.inTransaction, readOnly };
            throw sentinel;
          },
        },
      ]);
    } catch (error) {
      caught = error;
    }

    let initializerHandleClosed = false;
    try {
      initializerHandle?.query("SELECT 1").get();
    } catch (error) {
      initializerHandleClosed = /closed/i.test(
        error instanceof Error ? error.message : String(error),
      );
    }

    let exclusiveLockAcquired = false;
    let exclusiveLockError: string | undefined;
    const later = new Database(path);
    try {
      later.exec("BEGIN EXCLUSIVE");
      exclusiveLockAcquired = later.inTransaction;
    } catch (error) {
      exclusiveLockError = error instanceof Error ? error.message : String(error);
    } finally {
      if (later.inTransaction) later.exec("ROLLBACK");
      later.close();
    }

    expect({
      initializerObservation,
      retainedIdentity: caught === sentinel,
      retainedKind: caught instanceof ForeignSqliteReadError ? caught.kind : undefined,
      retainedDetail: caught instanceof ForeignSqliteReadError ? caught.detail : undefined,
      readerInvocations,
      initializerHandleClosed,
      exclusiveLockAcquired,
      exclusiveLockError,
    }).toEqual({
      initializerObservation: { inTransaction: false, readOnly: true },
      retainedIdentity: true,
      retainedKind: "corrupt",
      retainedDetail: "initializer sentinel retained exactly",
      readerInvocations: 0,
      initializerHandleClosed: true,
      exclusiveLockAcquired: true,
      exclusiveLockError: undefined,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a sidecarless WAL-header database runs its initializer on the immutable path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "formic-foreign-sqlite-immutable-"));
  const path = join(directory, "foreign.db");
  try {
    const setup = new Database(path, { create: true });
    try {
      setup.exec("PRAGMA journal_mode = WAL");
      setup.exec("CREATE TABLE evidence (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
      setup.run("INSERT INTO evidence(id, value) VALUES (1, ?)", ["sanitized"]);
    } finally {
      setup.close();
    }

    await rm(`${path}-wal`, { force: true });
    await rm(`${path}-shm`, { force: true });
    const header = await readFile(path);
    const sidecarsAbsentBeforeCall =
      !await pathExists(`${path}-wal`) && !await pathExists(`${path}-shm`);
    let initializerObservation: { inTransaction: boolean; readOnly: boolean } | undefined;
    let readerObservation: { inTransaction: boolean; readOnly: boolean } | undefined;
    let initializerHandle: Database | undefined;
    let readerHandle: Database | undefined;
    const detachedRow = Reflect.apply(readForeignSqlite, undefined, [
      path,
      (database: Database) => {
        readerHandle = database;
        let readOnly = false;
        try {
          database.exec("CREATE TABLE forbidden_reader_write (id INTEGER)");
        } catch (error) {
          readOnly = /read-?only/i.test(error instanceof Error ? error.message : String(error));
        }
        readerObservation = { inTransaction: database.inTransaction, readOnly };
        return database.query("SELECT id, value FROM evidence").get();
      },
      {
        initialize(database: Database) {
          initializerHandle = database;
          let readOnly = false;
          try {
            database.exec("CREATE TABLE forbidden_initializer_write (id INTEGER)");
          } catch (error) {
            readOnly = /read-?only/i.test(error instanceof Error ? error.message : String(error));
          }
          initializerObservation = { inTransaction: database.inTransaction, readOnly };
        },
      },
    ]);

    let readerHandleClosed = false;
    try {
      readerHandle?.query("SELECT 1").get();
    } catch (error) {
      readerHandleClosed = /closed/i.test(error instanceof Error ? error.message : String(error));
    }

    expect({
      header: {
        magic: header.subarray(0, 16).toString("utf8"),
        writeVersion: header[18],
        readVersion: header[19],
      },
      sidecarsAbsentBeforeCall,
      initializerObservation,
      readerObservation,
      sameHandle: initializerHandle !== undefined && initializerHandle === readerHandle,
      detachedRow,
      readerHandleClosed,
    }).toEqual({
      header: { magic: "SQLite format 3\u0000", writeVersion: 2, readVersion: 2 },
      sidecarsAbsentBeforeCall: true,
      initializerObservation: { inTransaction: false, readOnly: true },
      readerObservation: { inTransaction: true, readOnly: true },
      sameHandle: true,
      detachedRow: { id: 1, value: "sanitized" },
      readerHandleClosed: true,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
