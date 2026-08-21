import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  KILO_FIXTURE_SHA256,
  KILO_LATEST_MIGRATION,
  KILO_RESEARCH_SHA256,
  KILO_SCHEMA_COMMIT,
  KILO_STORE_LIMITS,
  KiloParserNotImplementedError,
  readKiloDataDir,
  readKiloStore,
  type KiloDataDirEvidence,
  type KiloReadOptions,
  type KiloSessionEvidence,
  type KiloStoreEvidence,
} from "../src/server/kilo-store";
import { ForeignSqliteReadError } from "../src/server/foreign-sqlite";

const FIXTURE_PATH = join(import.meta.dir, "fixtures", "kilo-current.sql");
const PARSER_PATH = join(import.meta.dir, "..", "src", "server", "kilo-store.ts");
const ROOT_SESSION_ID = "ses_fixture_root";
const CHILD_SESSION_ID = "ses_fixture_child";
const ARCHIVED_SESSION_ID = "ses_fixture_archived";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(prefix = "formic-kilo-store-"): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function fixtureSql(): Promise<string> {
  return readFile(FIXTURE_PATH, "utf8");
}

async function fixtureStore(filename = "kilo.db", directory?: string): Promise<string> {
  const root = directory ?? await temporaryDirectory();
  const path = join(root, filename);
  const database = new Database(path, { create: true });
  try {
    database.exec(await fixtureSql());
  } finally {
    database.close();
  }
  return path;
}

function openStore(path: string, mutate: (database: Database) => void): void {
  const database = new Database(path);
  try {
    mutate(database);
  } finally {
    database.close();
  }
}

function redFailure(claim: string, error: KiloParserNotImplementedError): Error {
  return new Error(`INTENTIONAL RED — ${claim}: ${error.code}`);
}

function readStoreForClaim(
  claim: string,
  path: string,
  options: KiloReadOptions = {},
): KiloStoreEvidence {
  try {
    return readKiloStore(path, options);
  } catch (error) {
    if (error instanceof KiloParserNotImplementedError) throw redFailure(claim, error);
    throw error;
  }
}

function readDirForClaim(
  claim: string,
  path: string,
  options: KiloReadOptions = {},
): KiloDataDirEvidence {
  try {
    return readKiloDataDir(path, options);
  } catch (error) {
    if (error instanceof KiloParserNotImplementedError) throw redFailure(claim, error);
    throw error;
  }
}

function rootSession(evidence: KiloStoreEvidence): KiloSessionEvidence {
  const session = evidence.sessions.find(({ sessionId }) => sessionId === ROOT_SESSION_ID);
  expect(session, "the pinned V1 fixture must publish its native root session").toBeDefined();
  return session!;
}

function expectForeignFailure(
  claim: string,
  path: string,
  kind: ForeignSqliteReadError["kind"],
): void {
  let caught: unknown;
  try {
    readStoreForClaim(claim, path);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("INTENTIONAL RED")) throw error;
    caught = error;
  }
  expect(caught, `${claim} must fail closed instead of looking like an empty store`).toBeInstanceOf(
    ForeignSqliteReadError,
  );
  expect((caught as ForeignSqliteReadError).kind).toBe(kind);
}

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

async function fingerprint(path: string): Promise<string | undefined> {
  try {
    const value = await stat(path);
    return `${value.dev}:${value.ino}:${value.size}:${value.mtimeMs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function storeFingerprints(path: string): Promise<Record<string, string | undefined>> {
  return {
    main: await fingerprint(path),
    wal: await fingerprint(`${path}-wal`),
    shm: await fingerprint(`${path}-shm`),
  };
}

function insertSyntheticSession(database: Database, index: number): string {
  const suffix = String(index).padStart(3, "0");
  const id = `ses_bound_${suffix}`;
  database.run(
    "INSERT INTO session(id, project_id, slug, directory, path, title, version, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      "prj_fixture",
      `bound-${suffix}`,
      `/synthetic/kilo/project/bound-${suffix}`,
      `bound-${suffix}`,
      `Invented bounded session ${suffix}`,
      "synthetic",
      0,
      0,
      0,
      0,
      0,
      1800000100000 + index,
      1800000100000 + index,
    ],
  );
  return id;
}

test("01 pins official Kilo source, research, latest migration and sanitized fixture bytes", async () => {
  expect(KILO_SCHEMA_COMMIT).toBe("9a6e081e4855e2e6a934bda519c1bef84e14d4b5");
  expect(KILO_RESEARCH_SHA256).toBe(
    "34db2566dd767ef82c322d2f59b1742b101d78f66ad43715fe6b9505653bf3d0",
  );
  expect(KILO_LATEST_MIGRATION).toBe(
    "20260714141136_session-message-legacy-writer-compat",
  );

  const sql = await fixtureSql();
  const digest = createHash("sha256").update(sql).digest("hex");
  expect(KILO_FIXTURE_SHA256).toBe(
    "5f34f5864951008f661bddf8eb985a6f28846ac114304795bba5d9eab56b657b",
  );
  expect(digest).toBe(KILO_FIXTURE_SHA256);
  expect(sql).toContain(KILO_LATEST_MIGRATION);
  expect(sql).toContain("/synthetic/kilo/project");
  expect(sql).not.toMatch(/\/(?:Users|home|private)\//);
  expect(sql).not.toMatch(/CREATE TABLE [`"]?(?:account|session_share|credential)[`"]?/i);
  expect(sql).not.toMatch(/auth\.json|access[_-]?token|refresh[_-]?token|provider[_-]?token/i);
  expect(sql).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  expect(sql).not.toMatch(/BEGIN (?:RSA|OPENSSH|EC) PRIVATE KEY|Bearer\s+[A-Za-z0-9._-]+/i);
});

test("02 parser source never queries session_message or contains a write/preflight path", async () => {
  const source = await readFile(PARSER_PATH, "utf8");
  expect(source).not.toMatch(/\bsession_message\b/i);
  expect(source).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|REPLACE|VACUUM|ATTACH|DETACH)\b/i);
  expect(source).not.toMatch(/PRAGMA\s+(?:journal_mode|wal_checkpoint)|\bchmod(?:Sync)?\b|DbPreflight/i);
});

test("03 reads native session, parent, message and part identity from V1 only", async () => {
  const evidence = readStoreForClaim(
    "native session/message/part identity remains keyed by V1 relationships",
    await fixtureStore(),
  );
  const session = rootSession(evidence);
  const child = evidence.sessions.find(({ sessionId }) => sessionId === CHILD_SESSION_ID);
  expect(session).toMatchObject({
    provider: "kilo",
    sessionId: ROOT_SESSION_ID,
    slug: "fixture-root",
    sourceDirectory: "/synthetic/kilo/project/root",
  });
  expect(session.messages).toContainEqual(expect.objectContaining({
    messageId: "msg_fixture_assistant_2",
    sessionId: ROOT_SESSION_ID,
    role: "assistant",
    parentMessageId: "msg_fixture_user_2",
  }));
  expect(session.events).toContainEqual(expect.objectContaining({
    partId: "prt_fixture_assistant_2_text",
    messageId: "msg_fixture_assistant_2",
    sessionId: ROOT_SESSION_ID,
  }));
  expect(child, "the native child must remain independently observable").toMatchObject({
    sessionId: CHILD_SESSION_ID,
    parentSessionId: ROOT_SESSION_ID,
  });
});

test("03a native message_id keeps canonical root evidence when redundant part.session_id is stale", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.run(
      "UPDATE part SET session_id = ? WHERE id = ?",
      [CHILD_SESSION_ID, "prt_fixture_user_1_text"],
    );
  });
  const root = rootSession(readStoreForClaim(
    "native message_id remains authoritative over stale redundant part.session_id",
    path,
  ));
  const canonicalPart = root.prose.find(({ partId }) => partId === "prt_fixture_user_1_text");
  expect({
    firstTask: root.firstTask,
    firstUserText: root.firstUserText,
    canonicalPart,
  }).toEqual({
    firstTask: "Prove the invented Kilo V1 authority.",
    firstUserText: "Prove the invented Kilo V1 authority.",
    canonicalPart: expect.objectContaining({
      sessionId: ROOT_SESSION_ID,
      messageId: "msg_fixture_user_1",
      role: "user",
      text: "Prove the invented Kilo V1 authority.",
    }),
  });
});

test("04 publishes Kilo source title with unverified authorship and rejects both placeholder forms", async () => {
  const evidence = readStoreForClaim(
    "source-title provenance is Kilo-specific and placeholder titles stay absent",
    await fixtureStore(),
  );
  expect(rootSession(evidence).sourceTitle).toEqual({
    text: "Invented Kilo parser session",
    provenance: "kilo-source-title-unverified-authorship",
  });
  for (const id of [CHILD_SESSION_ID, "ses_fixture_placeholder"]) {
    expect(evidence.sessions.find(({ sessionId }) => sessionId === id)?.sourceTitle).toBeUndefined();
  }
});

test("05 V1 spoken text alone supplies first task, attributed speech and assistant closing", async () => {
  const session = rootSession(readStoreForClaim(
    "V1 spoken text supplies task, attributed prose and the assistant closing",
    await fixtureStore(),
  ));
  expect(session.firstTask).toBe("Prove the invented Kilo V1 authority.");
  expect(session.firstUserText).toBe("Prove the invented Kilo V1 authority.");
  expect(session.assistantClosing).toBe("Invented Kilo evidence is bounded and complete.");
  expect(session.prose.map(({ role, text }) => ({ role, text }))).toEqual([
    { role: "user", text: "Prove the invented Kilo V1 authority." },
    { role: "assistant", text: "The first invented Kilo pass preserves native IDs." },
    { role: "user", text: "Confirm the final invented Kilo evidence." },
    { role: "assistant", text: "Invented Kilo evidence is bounded and complete." },
  ]);
  expect(JSON.stringify(session)).not.toContain("IGNORED_SYNTHETIC_SPEECH");
});

test("06 reasoning and tool parts are typed while tool bodies never enter speech or published events", async () => {
  const session = rootSession(readStoreForClaim(
    "reasoning and tool parts remain typed without sensitive tool bodies",
    await fixtureStore(),
  ));
  expect(session.events).toContainEqual(expect.objectContaining({
    kind: "reasoning",
    role: "assistant",
    messageId: "msg_fixture_assistant_1",
    partId: "prt_fixture_assistant_1_reasoning",
    text: "Check only invented native relationships.",
  }));
  expect(session.events).toContainEqual(expect.objectContaining({
    kind: "tool",
    role: "assistant",
    callId: "call_fixture_inspect",
    toolName: "inspect",
    status: "completed",
  }));
  expect(JSON.stringify(session)).not.toContain("INVENTED_TOOL_BODY_MUST_NOT_PUBLISH");
  expect(session.prose.some(({ text }) => text.includes("native relationships"))).toBe(false);
});

test("07 earliest/latest assistant cwd and native start/update/turn-completion clocks stay distinct", async () => {
  const session = rootSession(readStoreForClaim(
    "assistant cwd and turn completion preserve distinct native clocks",
    await fixtureStore(),
  ));
  expect(session).toMatchObject({
    earliestAssistantCwd: "/synthetic/kilo/project/root",
    latestAssistantCwd: "/synthetic/kilo/project/root/recent",
    startedAt: iso(1800000001000),
    updatedAt: iso(1800000008000),
    latestTurn: {
      messageId: "msg_fixture_assistant_2",
      parentMessageId: "msg_fixture_user_2",
      createdAt: iso(1800000002100),
      completedAt: iso(1800000008000),
      finish: "stop",
    },
  });
  expect(session.archivedAt).toBeUndefined();
});

test("08 archived sessions carry archive evidence while completed turns do not imply session exit", async () => {
  const evidence = readStoreForClaim(
    "archive is session-exit evidence and assistant completion is only turn-complete",
    await fixtureStore(),
  );
  const root = rootSession(evidence);
  const archived = evidence.sessions.find(({ sessionId }) => sessionId === ARCHIVED_SESSION_ID);
  expect(root.archivedAt).toBeUndefined();
  expect(root.latestTurn?.completedAt).toBe(iso(1800000008000));
  expect(archived).toMatchObject({
    sessionId: ARCHIVED_SESSION_ID,
    archivedAt: iso(1800000005000),
  });
});

test("09 raw provider/model/variant and observed split session counters preserve reasoning separately", async () => {
  const session = rootSession(readStoreForClaim(
    "raw model fields and observed split counters remain lossless",
    await fixtureStore(),
  ));
  expect(session.rawModel).toEqual({
    modelId: "model-invented",
    providerRoute: "provider-invented",
    rawVariant: "high",
  });
  expect(session.latestCallTokens).toEqual({
    input: 4,
    output: 2,
    reasoning: 0,
    cacheRead: 1,
    cacheWrite: 0,
    total: 6,
  });
  expect(session.sessionTokens).toEqual({
    input: 10,
    output: 4,
    reasoning: 1,
    cacheRead: 8,
    cacheWrite: 2,
  });
  expect(session).not.toHaveProperty("effort");
  expect(session).not.toHaveProperty("cost");
  expect(session).not.toHaveProperty("usd");
  expect(session.sessionTokens?.output).toBe(4);
});

test("10 nonzero source cost never promotes to Formic USD or invented context fields", async () => {
  const session = rootSession(readStoreForClaim(
    "I-110 keeps source cost and unavailable context fields unpublished",
    await fixtureStore(),
  ));
  const published = JSON.stringify(session);
  expect(published).not.toMatch(/cost|usd|occupancyPct|contextWindow/i);
});

test("11 complete step-finish rows publish ordered call sizes and incomplete or absent series stay undefined", async () => {
  const evidence = readStoreForClaim(
    "complete-only step-finish call sizes are ordered and absent series stay undefined",
    await fixtureStore(),
  );
  const root = rootSession(evidence);
  const child = evidence.sessions.find(({ sessionId }) => sessionId === CHILD_SESSION_ID);
  expect(root.callSizes).toEqual([9, 6]);
  expect(root.callSizesComplete).toBe(true);
  expect(child?.callSizes).toBeUndefined();
  expect(child?.callSizesComplete).toBe(false);
});

test("11a multiple ordered step-finish parts preserve the complete series and latest valid total", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.run(
      "INSERT INTO part(id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
      [
        "prt_fixture_assistant_2_zz_finish",
        "msg_fixture_assistant_2",
        ROOT_SESSION_ID,
        1800000008100,
        1800000008100,
        JSON.stringify({
          type: "step-finish",
          reason: "stop",
          tokens: {
            total: 99,
            input: 90,
            output: 9,
            reasoning: 0,
            cache: { read: 8, write: 0 },
          },
        }),
      ],
    );
  });
  const root = rootSession(readStoreForClaim(
    "multiple valid step-finish parts preserve every ordered total and the last valid usage",
    path,
  ));
  expect({
    callSizes: root.callSizes,
    callSizesComplete: root.callSizesComplete,
    latestCallTokens: root.latestCallTokens,
  }).toEqual({
    callSizes: [9, 6, 99],
    callSizesComplete: true,
    latestCallTokens: {
      input: 90,
      output: 9,
      reasoning: 0,
      cacheRead: 8,
      cacheWrite: 0,
      total: 99,
    },
  });
});

test("12 a store without session_message remains fully compatible", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => database.exec("DROP TABLE session_message"));
  const session = rootSession(readStoreForClaim(
    "session_message table absence remains compatible with canonical V1",
    path,
  ));
  expect(session.firstTask).toBe("Prove the invented Kilo V1 authority.");
});

test("13 sequenced and null-seq contradictory V2 rows are both ignored", async () => {
  const session = rootSession(readStoreForClaim(
    "sequenced and null-seq V2 contradictions cannot replace V1 speech",
    await fixtureStore(),
  ));
  const published = JSON.stringify(session);
  expect(published).not.toContain("REJECTED_SEQUENCED_V2_TEXT");
  expect(published).not.toContain("REJECTED_NULL_SEQ_V2_TEXT");
  expect(session.firstTask).toBe("Prove the invented Kilo V1 authority.");
});

test("14 V1 transcript survives an empty V2 reset and later stray V2 projection", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => database.exec("DELETE FROM session_message"));
  const reset = rootSession(readStoreForClaim(
    "V1 remains complete after the V2 reset deletes its projection",
    path,
  ));
  expect(reset.assistantClosing).toBe("Invented Kilo evidence is bounded and complete.");

  openStore(path, (database) => {
    database.run(
      "INSERT INTO session_message(id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        "msg_v2_after_reset",
        ROOT_SESSION_ID,
        "assistant",
        1,
        1800000010000,
        1800000010000,
        JSON.stringify({ text: "REJECTED_POST_RESET_V2_TEXT" }),
      ],
    );
  });
  const projected = rootSession(readStoreForClaim(
    "post-reset V2 rows cannot truncate or duplicate canonical V1",
    path,
  ));
  expect(projected.firstTask).toBe(reset.firstTask);
  expect(JSON.stringify(projected)).not.toContain("REJECTED_POST_RESET_V2_TEXT");
});

test("15 bounded newest-session enumeration is ordered newest-first with explicit truncation", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.exec("BEGIN");
    try {
      for (let index = 0; index < KILO_STORE_LIMITS.sessions + 5; index += 1) {
        insertSyntheticSession(database, index);
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  });
  const evidence = readStoreForClaim(
    "default session bounds keep the newest Kilo sessions and report truncation",
    path,
  );
  expect(evidence.sessions).toHaveLength(KILO_STORE_LIMITS.sessions);
  expect(evidence.sessions[0]?.sessionId).toBe("ses_bound_054");
  expect(evidence.sessions.at(-1)?.sessionId).toBe("ses_bound_005");
  expect(evidence.diagnostics).toContainEqual(expect.objectContaining({
    kind: "truncated",
    table: "session",
  }));
});

test("16 early-plus-recent message windows preserve first task and newest closing", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.exec("BEGIN");
    try {
      for (let index = 0; index < 130; index += 1) {
        const suffix = String(index).padStart(3, "0");
        const messageId = `msg_window_${suffix}`;
        const createdAt = 1800000200000 + index * 10;
        database.run(
          "INSERT INTO message(id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
          [
            messageId,
            ROOT_SESSION_ID,
            createdAt,
            createdAt + 1,
            JSON.stringify({
              role: "assistant",
              time: { created: createdAt, completed: createdAt + 1 },
              parentID: "msg_fixture_user_2",
              path: {
                cwd: "/synthetic/kilo/project/root/recent",
                root: "/synthetic/kilo/project",
              },
              finish: "stop",
            }),
          ],
        );
        database.run(
          "INSERT INTO part(id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
          [
            `prt_window_${suffix}`,
            messageId,
            ROOT_SESSION_ID,
            createdAt,
            createdAt,
            JSON.stringify({ type: "text", text: `Invented recent closing ${index}.` }),
          ],
        );
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  });
  const session = rootSession(readStoreForClaim(
    "early-plus-recent windows keep first task and latest close",
    path,
  ));
  expect(session.firstTask).toBe("Prove the invented Kilo V1 authority.");
  expect(session.assistantClosing).toBe("Invented recent closing 129.");
  expect(session.messages).toHaveLength(
    KILO_STORE_LIMITS.earlyMessagesPerSession + KILO_STORE_LIMITS.recentMessagesPerSession,
  );
  expect(session.transcriptTruncated).toBe(true);
});

test("16b overlapping early and recent windows close the gap without transcript loss", async () => {
  const evidence = readStoreForClaim(
    "overlapping early and recent windows retain the complete four-message root",
    await fixtureStore(),
    { sessionId: ROOT_SESSION_ID, earlyMessageLimit: 2, recentMessageLimit: 3 },
  );
  const root = rootSession(evidence);
  expect({
    messages: root.messages.map(({ messageId }) => messageId),
    transcriptTruncated: root.transcriptTruncated,
    messageTruncationDiagnostics: evidence.diagnostics.filter(({ kind, table }) =>
      kind === "truncated" && table === "message"
    ),
    callSizes: root.callSizes,
    callSizesComplete: root.callSizesComplete,
  }).toEqual({
    messages: [
      "msg_fixture_user_1",
      "msg_fixture_assistant_1",
      "msg_fixture_user_2",
      "msg_fixture_assistant_2",
    ],
    transcriptTruncated: false,
    messageTruncationDiagnostics: [],
    callSizes: [9, 6],
    callSizesComplete: true,
  });
});

test("16a a truncated early/recent gap cannot promote retained later user speech to first task", async () => {
  const path = await fixtureStore();
  const isolatedSessionId = "ses_gap_isolated";
  openStore(path, (database) => {
    database.run(
      "INSERT INTO session(id, project_id, slug, directory, path, title, version, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        isolatedSessionId,
        "prj_fixture",
        "gap-isolated",
        "/synthetic/kilo/project/gap-isolated",
        "gap-isolated",
        "Invented gap session",
        "synthetic",
        0,
        0,
        0,
        0,
        0,
        1800000400000,
        1800000401000,
      ],
    );
    const rows = [
      { role: "user", part: { type: "text", text: "SYNTHETIC_EARLY", synthetic: true } },
      { role: "user", part: { type: "text", text: "IGNORED_EARLY", ignored: true } },
      { role: "user", part: { type: "text", text: "Actual first spoken task in the gap." } },
      { role: "user", part: { type: "snapshot", snapshot: "invented-gap" } },
      { role: "user", part: { type: "text", text: "Later retained user speech." } },
      { role: "assistant", part: { type: "text", text: "Later retained assistant speech." } },
    ] as const;
    for (const [index, row] of rows.entries()) {
      const suffix = String(index).padStart(2, "0");
      const messageId = `msg_gap_${suffix}`;
      const createdAt = 1800000400100 + index * 10;
      database.run(
        "INSERT INTO message(id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
        [
          messageId,
          isolatedSessionId,
          createdAt,
          createdAt,
          JSON.stringify({ role: row.role, time: { created: createdAt } }),
        ],
      );
      database.run(
        "INSERT INTO part(id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
        [
          `prt_gap_${suffix}`,
          messageId,
          isolatedSessionId,
          createdAt,
          createdAt,
          JSON.stringify(row.part),
        ],
      );
    }
  });
  const evidence = readStoreForClaim(
    "a message-window gap keeps the first task unknown without de-attributing later speech",
    path,
    {
      sessionId: isolatedSessionId,
      earlyMessageLimit: 2,
      recentMessageLimit: 2,
      partLimit: 8,
    },
  );
  const session = evidence.sessions.find(({ sessionId }) => sessionId === isolatedSessionId);
  expect(session, "the isolated gap session must remain observable").toBeDefined();
  expect({
    firstTask: session?.firstTask,
    firstUserText: session?.firstUserText,
    laterSpeech: session?.prose.find(({ partId }) => partId === "prt_gap_04"),
  }).toEqual({
    firstTask: undefined,
    firstUserText: undefined,
    laterSpeech: expect.objectContaining({
      role: "user",
      text: "Later retained user speech.",
    }),
  });
});

test("17 global part cap bounds one noisy selected message without losing boundary speech", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.exec("BEGIN");
    try {
      for (let index = 0; index < KILO_STORE_LIMITS.partsPerSession + 50; index += 1) {
        const suffix = String(index).padStart(3, "0");
        database.run(
          "INSERT INTO part(id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
          [
            `prt_noise_${suffix}`,
            "msg_fixture_assistant_1",
            ROOT_SESSION_ID,
            1800000001301,
            1800000001301,
            JSON.stringify({ type: "snapshot", snapshot: `invented-${suffix}` }),
          ],
        );
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  });
  const session = rootSession(readStoreForClaim(
    "global part cap preserves bounded boundary speech",
    path,
  ));
  expect(session.firstTask).toBe("Prove the invented Kilo V1 authority.");
  expect(session.assistantClosing).toBe("Invented Kilo evidence is bounded and complete.");
  expect(session.transcriptTruncated).toBe(true);
});

test("17a selected-part SQL pairs test 17 with fixed indexed early/recent reads before bounds", async () => {
  const path = await fixtureStore();
  const executedSql: string[] = [];
  let queryDepth = 0;
  const originals = new Map<string, PropertyDescriptor>();
  for (const method of ["query", "prepare"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(Database.prototype, method);
    if (!descriptor || typeof descriptor.value !== "function") {
      throw new Error(`bun:sqlite Database.${method} is unavailable for query capture`);
    }
    originals.set(method, descriptor);
    const original = descriptor.value as (...args: unknown[]) => unknown;
    Object.defineProperty(Database.prototype, method, {
      ...descriptor,
      value: function (this: Database, ...args: unknown[]) {
        const nestedPrepare = method === "prepare" && queryDepth > 0;
        if (!nestedPrepare) executedSql.push(String(args[0] ?? ""));
        if (method === "query") queryDepth += 1;
        try {
          return Reflect.apply(original, this, args);
        } finally {
          if (method === "query") queryDepth -= 1;
        }
      },
    });
  }
  try {
    readStoreForClaim(
      "selected-part bounds execute through indexed early and recent SQL",
      path,
      { sessionId: ROOT_SESSION_ID, partLimit: 8 },
    );
  } finally {
    for (const [method, descriptor] of originals) {
      Object.defineProperty(Database.prototype, method, descriptor);
    }
  }
  const activeQueries = executedSql
    .map((query) => query
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/--[^\n]*/g, ""))
    .filter((query) =>
      /\b(?:FROM|JOIN)\s+[`"]?part[`"]?(?:\s|$)/i.test(query) &&
      /\bmessage_id\b/i.test(query)
    );
  const boundaryQueries = [...new Set(activeQueries.filter((query) =>
    /\bWHERE\s+message_id\s*=\s*\?/i.test(query) &&
    /\bORDER\s+BY\s+id\s+(?:ASC|DESC)\b/i.test(query)
  ))];
  const plans: Record<"ASC" | "DESC", string[]> = { ASC: [], DESC: [] };
  const planDatabase = new Database(path, { readonly: true });
  try {
    for (const query of boundaryQueries) {
      const direction: "ASC" | "DESC" = /\bORDER\s+BY\s+id\s+DESC\b/i.test(query)
        ? "DESC"
        : "ASC";
      const rows = planDatabase.query(`EXPLAIN QUERY PLAN ${query}`).all(
        "msg_fixture_assistant_2",
        9,
      ) as Array<{ detail?: unknown }>;
      plans[direction] = rows.flatMap(({ detail }) =>
        typeof detail === "string" ? [detail] : []
      );
    }
  } finally {
    planDatabase.close();
  }
  const bound =
    /\bLIMIT\s+(?:\?|[$:@][A-Za-z_][A-Za-z0-9_]*|[1-9][0-9]*)/i;
  const boundOccurrences =
    /\bLIMIT\s+(?:\?|[$:@][A-Za-z_][A-Za-z0-9_]*|[1-9][0-9]*)/gi;
  expect({
    hasAtLeastTwoBoundedReads: activeQueries.reduce(
      (count, query) => count + (query.match(boundOccurrences)?.length ?? 0),
      0,
    ) >= 2,
    ranksMatchingPopulationWithWindowFunctions: activeQueries.some((query) =>
      /\b(?:row_number|rank|dense_rank)\s*\([^)]*\)\s*OVER\s*\(/i.test(query)
    ),
    boundedEarlyQuery: activeQueries.some((query) =>
      bound.test(query) && /\bORDER\s+BY\b[\s\S]*\bASC\b/i.test(query)
    ),
    boundedRecentQuery: activeQueries.some((query) =>
      bound.test(query) && /\bORDER\s+BY\b[\s\S]*\bDESC\b/i.test(query)
    ),
  }).toEqual({
    hasAtLeastTwoBoundedReads: true,
    ranksMatchingPopulationWithWindowFunctions: false,
    boundedEarlyQuery: true,
    boundedRecentQuery: true,
  });
  expect(plans).toEqual({
    ASC: ["SEARCH part USING COVERING INDEX part_message_id_id_idx (message_id=?)"],
    DESC: ["SEARCH part USING COVERING INDEX part_message_id_id_idx (message_id=?)"],
  });
  const planDetails = [...plans.ASC, ...plans.DESC];
  expect({
    boundaryQueryShapes: boundaryQueries.length,
    scansPart: planDetails.some((detail) => /\bSCAN\s+part\b/i.test(detail)),
    usesTemporaryBTree: planDetails.some((detail) => /\bUSE\s+TEMP\s+B-TREE\b/i.test(detail)),
  }).toEqual({
    boundaryQueryShapes: 2,
    scansPart: false,
    usesTemporaryBTree: false,
  });
});

test("18 custom session/message/part bounds are honored without widening defaults", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    for (let index = 0; index < 6; index += 1) insertSyntheticSession(database, index);
  });
  const evidence = readStoreForClaim(
    "custom bounds cap Kilo evidence deterministically",
    path,
    { sessionLimit: 2, recentMessageLimit: 1, earlyMessageLimit: 1, partLimit: 3 },
  );
  expect(evidence.sessions).toHaveLength(2);
  expect(evidence.sessions.every(({ messages }) => messages.length <= 2)).toBe(true);
  expect(evidence.sessions.every(({ events }) => events.length <= 3)).toBe(true);
});

test("19 spoken transcript tail is capped to the last 800 characters", async () => {
  const path = await fixtureStore();
  const longText = `invented-prefix-${"x".repeat(900)}-invented-tail`;
  openStore(path, (database) => {
    database.run(
      "UPDATE part SET data = ? WHERE id = ?",
      [JSON.stringify({ type: "text", text: longText }), "prt_fixture_assistant_2_text"],
    );
  });
  const tail = rootSession(readStoreForClaim(
    "spoken transcript tail is bounded at 800 characters",
    path,
  )).transcriptTail;
  expect(tail?.text.length).toBe(800);
  expect(tail?.text.endsWith("-invented-tail")).toBe(true);
  expect(tail?.truncated).toBe(true);
});

test("20 missing database is absent while an empty current store is present and empty", async () => {
  const directory = await temporaryDirectory();
  const missing = readStoreForClaim(
    "missing Kilo database is absent rather than a successful empty store",
    join(directory, "missing-kilo.db"),
  );
  expect(missing).toEqual({ sessions: [], diagnostics: [], incomplete: false, absent: true });

  const emptyPath = await fixtureStore("empty.db", directory);
  openStore(emptyPath, (database) => database.exec("DELETE FROM session"));
  const empty = readStoreForClaim(
    "empty current Kilo store is present with zero sessions",
    emptyPath,
  );
  expect(empty).toEqual({ sessions: [], diagnostics: [], incomplete: false, absent: false });
});

test("21 config-only home mints no Kilo rows and preserves absent data-root evidence", async () => {
  const home = await temporaryDirectory("formic-kilo-home-");
  await mkdir(join(home, ".config", "kilo"), { recursive: true });
  await writeFile(join(home, ".config", "kilo", "settings.json"), "{}\n");
  const result = readDirForClaim(
    "settings-only config cannot stand in for the XDG Kilo data root",
    join(home, ".local", "share", "kilo"),
  );
  expect(result).toEqual({ stores: [], errors: [], absent: true });
});

test("22 Kilo data dir accepts released, channel and leftover names but excludes unrelated names", async () => {
  const dataDir = await temporaryDirectory("formic-kilo-data-");
  await fixtureStore("kilo.db", dataDir);
  await fixtureStore("kilo-local.db", dataDir);
  await fixtureStore("opencode-local.db", dataDir);
  await fixtureStore("unrelated.db", dataDir);
  const result = readDirForClaim(
    "filename-only Kilo discovery accepts pinned channel names in an identified Kilo data dir",
    dataDir,
  );
  expect(result.stores.map(({ path }) => basename(path)).sort()).toEqual([
    "kilo-local.db",
    "kilo.db",
    "opencode-local.db",
  ]);
  expect(result.stores.every(({ evidence }) => evidence.sessions.length > 0)).toBe(true);
});

test("22a official sanitized channel suffixes may begin underscore, dash or dot", async () => {
  const dataDir = await temporaryDirectory("formic-kilo-sanitized-channels-");
  const accepted = [
    "kilo-_dev.db",
    "kilo--dev.db",
    "kilo-.dev.db",
    "opencode-_dev.db",
    "opencode--dev.db",
    "opencode-.dev.db",
  ];
  for (const filename of accepted) await fixtureStore(filename, dataDir);
  const result = readDirForClaim(
    "official sanitized Kilo and legacy channel suffixes accept leading underscore dash and dot",
    dataDir,
  );
  expect({
    stores: result.stores.map(({ path }) => basename(path)).sort(),
    errors: result.errors,
  }).toEqual({
    stores: [...accepted].sort(),
    errors: [],
  });
});

test("22b an expired shared data-dir deadline reports one unenumerated remainder", async () => {
  const dataDir = await temporaryDirectory("formic-kilo-expired-data-dir-");
  await fixtureStore("kilo-alpha.db", dataDir);
  await fixtureStore("kilo-beta.db", dataDir);
  let deadlineChecks = 0;
  const result = readDirForClaim(
    "an expired shared Kilo data-dir deadline stops before per-store evidence",
    dataDir,
    {
      deadlineAtMs: 10,
      nowMs: () => {
        deadlineChecks += 1;
        if (deadlineChecks > 1) throw new Error("per-store deadline work started");
        return 10;
      },
    },
  );
  expect({ result, deadlineChecks }).toEqual({
    result: {
      stores: [],
      errors: ["Kilo data directory deadline expired with matching stores not enumerated."],
      absent: false,
    },
    deadlineChecks: 1,
  });
});

test("22d a shared data-dir deadline preserves the first accepted store and leaves one remainder", async () => {
  const dataDir = await temporaryDirectory("formic-kilo-data-dir-prefix-deadline-");
  await fixtureStore("kilo-alpha.db", dataDir);
  await fixtureStore("kilo-beta.db", dataDir);
  const descriptor = Object.getOwnPropertyDescriptor(Database.prototype, "exec");
  if (!descriptor || typeof descriptor.value !== "function") {
    throw new Error("bun:sqlite Database.exec is unavailable for store-transaction control");
  }
  const original = descriptor.value as (...args: unknown[]) => unknown;
  let expired = false;
  let completedStoreTransactions = 0;
  Object.defineProperty(Database.prototype, "exec", {
    ...descriptor,
    value: function (this: Database, ...args: unknown[]) {
      const result = Reflect.apply(original, this, args);
      if (/^\s*COMMIT\s*;?\s*$/i.test(String(args[0] ?? ""))) {
        completedStoreTransactions += 1;
        if (completedStoreTransactions === 1) expired = true;
      }
      return result;
    },
  });
  let result: KiloDataDirEvidence;
  try {
    result = readDirForClaim(
      "a shared directory deadline stops between fully accepted stores",
      dataDir,
      { deadlineAtMs: 10, nowMs: () => expired ? 10 : 0 },
    );
  } finally {
    Object.defineProperty(Database.prototype, "exec", descriptor);
  }
  expect({
    acceptedStores: result.stores.map(({ path }) => basename(path)),
    errors: result.errors,
    betaAccepted: result.stores.some(({ path }) => basename(path) === "kilo-beta.db"),
    absent: result.absent,
    completedStoreTransactions,
  }).toEqual({
    acceptedStores: ["kilo-alpha.db"],
    errors: ["Kilo data directory deadline expired with matching stores not enumerated."],
    betaAccepted: false,
    absent: false,
    completedStoreTransactions: 1,
  });
});

test("22e a non-expired shared data-dir deadline accepts both stores", async () => {
  const dataDir = await temporaryDirectory("formic-kilo-data-dir-live-deadline-");
  await fixtureStore("kilo-alpha.db", dataDir);
  await fixtureStore("kilo-beta.db", dataDir);
  const descriptor = Object.getOwnPropertyDescriptor(Database.prototype, "exec");
  if (!descriptor || typeof descriptor.value !== "function") {
    throw new Error("bun:sqlite Database.exec is unavailable for store-transaction control");
  }
  const original = descriptor.value as (...args: unknown[]) => unknown;
  let completedReadOnlyTransactions = 0;
  Object.defineProperty(Database.prototype, "exec", {
    ...descriptor,
    value: function (this: Database, ...args: unknown[]) {
      const result = Reflect.apply(original, this, args);
      if (/^\s*COMMIT\s*;?\s*$/i.test(String(args[0] ?? ""))) {
        completedReadOnlyTransactions += 1;
      }
      return result;
    },
  });
  let result: KiloDataDirEvidence;
  try {
    result = readDirForClaim(
      "a configured non-expired directory deadline reads every matching store",
      dataDir,
      { deadlineAtMs: 10, nowMs: () => 9 },
    );
  } finally {
    Object.defineProperty(Database.prototype, "exec", descriptor);
  }
  expect({
    acceptedStores: result.stores.map(({ path }) => basename(path)),
    errors: result.errors,
    absent: result.absent,
    completedMoreThanOneReadOnlyTransaction: completedReadOnlyTransactions > 1,
  }).toEqual({
    acceptedStores: ["kilo-alpha.db", "kilo-beta.db"],
    errors: [],
    absent: false,
    completedMoreThanOneReadOnlyTransaction: true,
  });
});

test("22c Kilo data-dir reads cap matching stores at sixteen with one fixed remainder error", async () => {
  const dataDir = await temporaryDirectory("formic-kilo-store-limit-");
  const filenames = Array.from(
    { length: 17 },
    (_, index) => `kilo-bound-${String(index).padStart(2, "0")}.db`,
  );
  for (const filename of filenames) await fixtureStore(filename, dataDir);
  const unreadRemainder = filenames.slice(16).map((filename) =>
    new Database(join(dataDir, filename))
  );
  try {
    for (const database of unreadRemainder) {
      database.exec("PRAGMA journal_mode = DELETE; BEGIN EXCLUSIVE");
    }
    const result = readDirForClaim(
      "Kilo data-dir reads stop at the fixed sixteen-store bound",
      dataDir,
    );
    expect({
      stores: result.stores.map(({ path }) => basename(path)),
      errors: result.errors,
      absent: result.absent,
    }).toEqual({
      stores: filenames.slice(0, 16),
      errors: ["Kilo data directory store limit 16 reached with matching stores not enumerated."],
      absent: false,
    });
  } finally {
    for (const database of unreadRemainder) {
      database.exec("ROLLBACK");
      database.close();
    }
  }
});

test("23 missing latest migration fails closed as schema", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.run("DELETE FROM migration WHERE id = ?", [KILO_LATEST_MIGRATION]);
  });
  expectForeignFailure("missing pinned Kilo migration", path, "schema");
});

test("24 missing migration journal and required V1 table fail closed as schema", async () => {
  const missingJournal = await fixtureStore();
  openStore(missingJournal, (database) => database.exec("DROP TABLE migration"));
  expectForeignFailure("missing Kilo migration journal", missingJournal, "schema");

  const missingPart = await fixtureStore();
  openStore(missingPart, (database) => database.exec("DROP TABLE part"));
  expectForeignFailure("missing canonical V1 part table", missingPart, "schema");
});

test("25 missing required V1 columns including session.slug fail closed as schema", async () => {
  const missingSlug = await fixtureStore();
  openStore(missingSlug, (database) => database.exec("ALTER TABLE session DROP COLUMN slug"));
  expectForeignFailure("missing required session.slug column", missingSlug, "schema");

  const missingMessageData = await fixtureStore();
  openStore(
    missingMessageData,
    (database) => database.exec("ALTER TABLE message DROP COLUMN data"),
  );
  expectForeignFailure("missing required V1 message.data column", missingMessageData, "schema");
});

test("25a missing or wrongly defined part boundary index fails closed as schema", async () => {
  const missing = await fixtureStore();
  openStore(missing, (database) => database.exec("DROP INDEX part_message_id_id_idx"));

  const wrongColumns = await fixtureStore();
  openStore(wrongColumns, (database) => {
    database.exec("DROP INDEX part_message_id_id_idx");
    database.exec(
      "CREATE INDEX part_message_id_id_idx ON part(session_id, id)",
    );
  });

  const outcomes: Array<{ variant: string; outcome: string }> = [];
  for (const [variant, path] of [
    ["missing", missing],
    ["wrong (session_id, id) columns", wrongColumns],
  ] as const) {
    try {
      readStoreForClaim(`required part boundary index is ${variant}`, path);
      outcomes.push({ variant, outcome: "accepted" });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("INTENTIONAL RED")) throw error;
      outcomes.push({
        variant,
        outcome: error instanceof ForeignSqliteReadError ? error.kind : "unexpected-error",
      });
    }
  }
  expect(outcomes).toEqual([
    { variant: "missing", outcome: "schema" },
    { variant: "wrong (session_id, id) columns", outcome: "schema" },
  ]);
});

test("25b a same-column partial part boundary index fails closed as schema", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.exec("DROP INDEX part_message_id_id_idx");
    database.exec(`
      CREATE INDEX part_message_id_id_idx ON part(message_id, id)
      WHERE session_id = '${ROOT_SESSION_ID}'
    `);
  });

  const database = new Database(path, { readonly: true });
  let mutationProof: {
    indexColumns: string[];
    partialFlag: number | undefined;
    partialPredicateStored: boolean;
    usesPinnedCoveringPlan: boolean;
  };
  try {
    const indexColumns = database.query('PRAGMA index_info("part_message_id_id_idx")').all() as
      Array<{ name?: unknown }>;
    const indexList = database.query('PRAGMA index_list("part")').all() as Array<{
      name?: unknown;
      partial?: unknown;
    }>;
    const schema = database.query(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?",
    ).get("part_message_id_id_idx") as { sql?: unknown } | null;
    const plans = database.query(`
      EXPLAIN QUERY PLAN
      SELECT rowid AS part_rowid, substr(id, 1, 257) AS part_id
      FROM part
      WHERE message_id = ?
      ORDER BY id ASC
      LIMIT ?
    `).all("msg_fixture_assistant_2", 9) as Array<{ detail?: unknown }>;
    mutationProof = {
      indexColumns: indexColumns.flatMap(({ name }) =>
        typeof name === "string" ? [name] : []
      ),
      partialFlag: indexList.find(({ name }) => name === "part_message_id_id_idx")?.partial as
        number | undefined,
      partialPredicateStored: typeof schema?.sql === "string" && /\bWHERE\b/i.test(schema.sql),
      usesPinnedCoveringPlan: plans.some(({ detail }) =>
        typeof detail === "string" &&
        /USING COVERING INDEX part_message_id_id_idx/i.test(detail)
      ),
    };
  } finally {
    database.close();
  }
  expect(mutationProof).toEqual({
    indexColumns: ["message_id", "id"],
    partialFlag: 1,
    partialPredicateStored: true,
    usesPinnedCoveringPlan: false,
  });

  let outcome = "accepted";
  try {
    readStoreForClaim("partial part boundary indexes are incompatible", path);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("INTENTIONAL RED")) throw error;
    outcome = error instanceof ForeignSqliteReadError
      ? error.kind
      : `unexpected:${error instanceof Error ? error.name : typeof error}`;
  }
  expect(outcome).toBe("schema");
});

test("26 timestamp-shaped future migration fails closed while extra columns remain compatible", async () => {
  const future = await fixtureStore();
  openStore(future, (database) => {
    database.run(
      "INSERT INTO migration(id, time_completed) VALUES (?, ?)",
      ["20270101000000_invented_future", 1800000999999],
    );
  });
  expectForeignFailure("unknown timestamp-shaped Kilo future migration", future, "schema");

  const extra = await fixtureStore();
  openStore(extra, (database) => {
    database.exec("ALTER TABLE session ADD COLUMN invented_extra text");
  });
  expect(rootSession(readStoreForClaim(
    "extra columns without a future migration stay compatible",
    extra,
  )).sessionId).toBe(ROOT_SESSION_ID);
});

test("27 WAL-header database without sidecars uses a stable immutable read", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.exec("PRAGMA journal_mode = WAL");
  });
  await rm(`${path}-wal`, { force: true });
  await rm(`${path}-shm`, { force: true });
  expect(await fingerprint(`${path}-wal`)).toBeUndefined();
  expect(await fingerprint(`${path}-shm`)).toBeUndefined();
  const before = await storeFingerprints(path);
  expect(rootSession(readStoreForClaim(
    "WAL-header store without sidecars uses immutable read-only snapshot",
    path,
  )).sessionId).toBe(ROOT_SESSION_ID);
  expect(await storeFingerprints(path)).toEqual(before);
});

test("28 live WAL rows are visible through ordinary readonly snapshot without sidecar mutation", async () => {
  const path = await fixtureStore();
  const writer = new Database(path);
  try {
    writer.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0");
    writer.run(
      "INSERT INTO session(id, project_id, slug, directory, path, title, version, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        "ses_wal_visible",
        "prj_fixture",
        "wal-visible",
        "/synthetic/kilo/project/wal-visible",
        "wal-visible",
        "Invented WAL session",
        "synthetic",
        1800000300000,
        1800000300000,
      ],
    );
    const before = await storeFingerprints(path);
    const evidence = readStoreForClaim(
      "live Kilo WAL rows are read without checkpoint or mutation",
      path,
    );
    expect(evidence.sessions.map(({ sessionId }) => sessionId)).toContain("ses_wal_visible");
    expect(await storeFingerprints(path)).toEqual(before);
  } finally {
    writer.close();
  }
});

test("29 locked or busy store reports unavailable Kilo population rather than empty success", async () => {
  const path = await fixtureStore();
  const lock = new Database(path);
  try {
    lock.exec("PRAGMA journal_mode = DELETE; BEGIN EXCLUSIVE");
    expectForeignFailure("locked or busy Kilo population", path, "locked");
  } finally {
    lock.exec("ROLLBACK");
    lock.close();
  }
});

test("30 corrupt and not-SQLite bytes fail closed with no minted rows", async () => {
  const directory = await temporaryDirectory();
  const path = join(directory, "kilo.db");
  await writeFile(path, "not a sqlite database\n");
  expectForeignFailure("corrupt or non-SQLite Kilo store", path, "corrupt");
});

test("31 invalid and oversized JSON or strings skip bad records while other sessions survive", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.run("UPDATE message SET data = ? WHERE id = ?", ["{invalid", "msg_fixture_user_1"]);
    database.run(
      "UPDATE part SET data = ? WHERE id = ?",
      [JSON.stringify({ type: "text", text: "x".repeat(KILO_STORE_LIMITS.jsonChars + 1) }), "prt_fixture_assistant_1_text"],
    );
    database.run(
      "UPDATE session SET title = ? WHERE id = ?",
      ["t".repeat(KILO_STORE_LIMITS.textChars + 1), ROOT_SESSION_ID],
    );
  });
  const evidence = readStoreForClaim(
    "invalid and oversized records are isolated without crashing the store",
    path,
  );
  expect(evidence.sessions.map(({ sessionId }) => sessionId)).toContain(CHILD_SESSION_ID);
  expect(evidence.diagnostics).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "invalid-json", table: "message" }),
    expect.objectContaining({ kind: "oversized-json", table: "part" }),
    expect.objectContaining({ kind: "oversized-content", table: "session" }),
  ]));
});

test("31a malformed first native text keeps prefix claims absent while complete suffix evidence publishes", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.run(
      "UPDATE part SET data = ? WHERE id = ?",
      [
        JSON.stringify({ type: "text", text: 17 }),
        "prt_fixture_user_1_text",
      ],
    );
  });
  const evidence = readStoreForClaim(
    "numeric first native text invalidates prefix transcript claims without hiding suffix evidence",
    path,
  );
  const root = rootSession(evidence);
  expect({
    firstTask: root.firstTask,
    firstUserText: root.firstUserText,
    transcriptTruncated: root.transcriptTruncated,
    invalidNativePartDiagnostic: evidence.diagnostics.some(({ kind, table, recordId }) =>
      kind === "invalid-record" && table === "part" &&
      recordId === "prt_fixture_user_1_text"
    ),
    assistantClosing: root.assistantClosing,
    latestTurn: root.latestTurn,
    latestAssistantCwd: root.latestAssistantCwd,
    latestCallTokens: root.latestCallTokens,
  }).toEqual({
    firstTask: undefined,
    firstUserText: undefined,
    transcriptTruncated: true,
    invalidNativePartDiagnostic: true,
    assistantClosing: "Invented Kilo evidence is bounded and complete.",
    latestTurn: {
      messageId: "msg_fixture_assistant_2",
      parentMessageId: "msg_fixture_user_2",
      createdAt: iso(1800000002100),
      completedAt: iso(1800000008000),
      finish: "stop",
    },
    latestAssistantCwd: "/synthetic/kilo/project/root/recent",
    latestCallTokens: {
      input: 4,
      output: 2,
      reasoning: 0,
      cacheRead: 1,
      cacheWrite: 0,
      total: 6,
    },
  });
});

test("31b malformed latest assistant text cannot promote older speech as the closing", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.run(
      "UPDATE part SET data = ? WHERE id = ?",
      [
        JSON.stringify({ type: "text", text: 29 }),
        "prt_fixture_assistant_2_text",
      ],
    );
  });
  const root = rootSession(readStoreForClaim(
    "numeric latest assistant text keeps the closing unavailable without hiding message evidence",
    path,
  ));
  expect({
    assistantClosing: root.assistantClosing,
    transcriptTruncated: root.transcriptTruncated,
    latestTurn: root.latestTurn,
    latestAssistantCwd: root.latestAssistantCwd,
    latestCallTokens: root.latestCallTokens,
  }).toEqual({
    assistantClosing: undefined,
    transcriptTruncated: true,
    latestTurn: {
      messageId: "msg_fixture_assistant_2",
      parentMessageId: "msg_fixture_user_2",
      createdAt: iso(1800000002100),
      completedAt: iso(1800000008000),
      finish: "stop",
    },
    latestAssistantCwd: "/synthetic/kilo/project/root/recent",
    latestCallTokens: {
      input: 4,
      output: 2,
      reasoning: 0,
      cacheRead: 1,
      cacheWrite: 0,
      total: 6,
    },
  });
});

test("31c malformed newest native message invalidates suffix claims but preserves proven prefix task", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.run(
      "UPDATE message SET data = ? WHERE id = ?",
      ["{invalid", "msg_fixture_assistant_2"],
    );
  });
  const evidence = readStoreForClaim(
    "malformed newest native message cannot promote an older assistant suffix",
    path,
  );
  const root = rootSession(evidence);
  expect({
    firstTask: root.firstTask,
    assistantClosing: root.assistantClosing,
    latestTurn: root.latestTurn,
    latestAssistantCwd: root.latestAssistantCwd,
    latestCallTokens: root.latestCallTokens,
    transcriptTruncated: root.transcriptTruncated,
    invalidMessageDiagnostics: evidence.diagnostics.filter(({ recordId }) =>
      recordId === "msg_fixture_assistant_2"
    ),
  }).toEqual({
    firstTask: "Prove the invented Kilo V1 authority.",
    assistantClosing: undefined,
    latestTurn: undefined,
    latestAssistantCwd: undefined,
    latestCallTokens: undefined,
    transcriptTruncated: true,
    invalidMessageDiagnostics: [{
      kind: "invalid-json",
      table: "message",
      recordId: "msg_fixture_assistant_2",
      detail: "JSON record could not be decoded and was skipped",
    }],
  });
});

test("31d corrupt earliest native user message keeps prefix claims unavailable", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.run(
      "UPDATE message SET data = ? WHERE id = ?",
      ["{invalid", "msg_fixture_user_1"],
    );
  });
  const database = new Database(path, { readonly: true });
  try {
    expect(database.query(
      "SELECT id, json_valid(data) AS valid FROM message WHERE id = ?",
    ).get("msg_fixture_user_1")).toEqual({
      id: "msg_fixture_user_1",
      valid: 0,
    });
  } finally {
    database.close();
  }

  const evidence = readStoreForClaim(
    "corrupt earliest native user message invalidates only prefix authority",
    path,
  );
  const root = rootSession(evidence);
  expect({
    assistantClosing: root.assistantClosing,
    latestTurn: root.latestTurn,
    latestAssistantCwd: root.latestAssistantCwd,
    latestCallTokens: root.latestCallTokens,
  }).toEqual({
    assistantClosing: "Invented Kilo evidence is bounded and complete.",
    latestTurn: {
      messageId: "msg_fixture_assistant_2",
      parentMessageId: "msg_fixture_user_2",
      createdAt: iso(1800000002100),
      completedAt: iso(1800000008000),
      finish: "stop",
    },
    latestAssistantCwd: "/synthetic/kilo/project/root/recent",
    latestCallTokens: {
      input: 4,
      output: 2,
      reasoning: 0,
      cacheRead: 1,
      cacheWrite: 0,
      total: 6,
    },
  });
  expect({
    firstTask: root.firstTask,
    firstUserText: root.firstUserText,
    transcriptTruncated: root.transcriptTruncated,
    invalidMessageDiagnostic: evidence.diagnostics.some(({ kind, table, recordId }) =>
      kind === "invalid-json" && table === "message" &&
      recordId === "msg_fixture_user_1"
    ),
  }).toEqual({
    firstTask: undefined,
    firstUserText: undefined,
    transcriptTruncated: true,
    invalidMessageDiagnostic: true,
  });
});

test("31e corrupt latest assistant text part cannot promote older closing speech", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.run(
      "UPDATE part SET data = ? WHERE id = ?",
      ["{invalid", "prt_fixture_assistant_2_text"],
    );
  });
  const database = new Database(path, { readonly: true });
  try {
    const rows = database.query(
      "SELECT id, json_valid(data) AS valid FROM part WHERE message_id = ? ORDER BY id",
    ).all("msg_fixture_assistant_2") as Array<{ id: string; valid: number }>;
    expect({
      targetInvalid: rows.find(({ id }) => id === "prt_fixture_assistant_2_text")?.valid,
      otherRowsRemainValid: rows
        .filter(({ id }) => id !== "prt_fixture_assistant_2_text")
        .every(({ valid }) => valid === 1),
      rowCount: rows.length,
    }).toEqual({
      targetInvalid: 0,
      otherRowsRemainValid: true,
      rowCount: 2,
    });
  } finally {
    database.close();
  }

  const evidence = readStoreForClaim(
    "corrupt latest assistant text invalidates closing without hiding native message evidence",
    path,
  );
  const root = rootSession(evidence);
  expect({
    decodedLatestMessage: root.messages.some(({ messageId, role }) =>
      messageId === "msg_fixture_assistant_2" && role === "assistant"
    ),
    latestTurn: root.latestTurn,
    latestAssistantCwd: root.latestAssistantCwd,
    latestCallTokens: root.latestCallTokens,
  }).toEqual({
    decodedLatestMessage: true,
    latestTurn: {
      messageId: "msg_fixture_assistant_2",
      parentMessageId: "msg_fixture_user_2",
      createdAt: iso(1800000002100),
      completedAt: iso(1800000008000),
      finish: "stop",
    },
    latestAssistantCwd: "/synthetic/kilo/project/root/recent",
    latestCallTokens: undefined,
  });
  expect({
    assistantClosing: root.assistantClosing,
    transcriptTruncated: root.transcriptTruncated,
    invalidPartDiagnostics: evidence.diagnostics.filter(({ recordId }) =>
      recordId === "prt_fixture_assistant_2_text"
    ),
  }).toEqual({
    assistantClosing: undefined,
    transcriptTruncated: true,
    invalidPartDiagnostics: [{
      kind: "invalid-json",
      table: "part",
      recordId: "prt_fixture_assistant_2_text",
      detail: "JSON record could not be decoded and was skipped",
    }],
  });
});

test("31f undecodable trailing latest-assistant part revokes suffix and usage authority", async () => {
  const path = await fixtureStore();
  const trailingPartId = "prt_fixture_assistant_2_zz_undecodable";
  openStore(path, (database) => {
    database.run(
      "INSERT INTO part(id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
      [
        trailingPartId,
        "msg_fixture_assistant_2",
        ROOT_SESSION_ID,
        1800000008100,
        1800000008100,
        "{invalid",
      ],
    );
  });
  const database = new Database(path, { readonly: true });
  try {
    expect(database.query(
      "SELECT id, json_valid(data) AS valid FROM part WHERE message_id = ? ORDER BY id DESC LIMIT 1",
    ).get("msg_fixture_assistant_2")).toEqual({ id: trailingPartId, valid: 0 });
  } finally {
    database.close();
  }

  const evidence = readStoreForClaim(
    "an undecodable trailing part revokes latest assistant suffix and usage authority",
    path,
    { sessionId: ROOT_SESSION_ID },
  );
  const root = rootSession(evidence);
  expect({
    storeIncomplete: evidence.incomplete,
    selectedTrailingDiagnostic: evidence.diagnostics.filter(({ recordId }) =>
      recordId === trailingPartId
    ),
    latestTurn: root.latestTurn,
    latestAssistantCwd: root.latestAssistantCwd,
  }).toEqual({
    storeIncomplete: false,
    selectedTrailingDiagnostic: [{
      kind: "invalid-json",
      table: "part",
      recordId: trailingPartId,
      detail: "JSON record could not be decoded and was skipped",
    }],
    latestTurn: {
      messageId: "msg_fixture_assistant_2",
      parentMessageId: "msg_fixture_user_2",
      createdAt: iso(1800000002100),
      completedAt: iso(1800000008000),
      finish: "stop",
    },
    latestAssistantCwd: "/synthetic/kilo/project/root/recent",
  });
  expect({
    assistantClosing: root.assistantClosing,
    latestCallTokens: root.latestCallTokens,
    callSizes: root.callSizes,
    callSizesComplete: root.callSizesComplete,
    transcriptTruncated: root.transcriptTruncated,
  }).toEqual({
    assistantClosing: undefined,
    latestCallTokens: undefined,
    callSizes: undefined,
    callSizesComplete: false,
    transcriptTruncated: true,
  });
});

test("V5-1 unknown earliest native role cannot promote a later user task", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.run(
      "UPDATE message SET data = json_set(data, '$.role', ?) WHERE id = ?",
      ["observer", "msg_fixture_user_1"],
    );
  });
  const database = new Database(path, { readonly: true });
  try {
    const orderedMessages = database.query(`
      SELECT id, time_created AS createdAt, json_extract(data, '$.role') AS role
      FROM message
      WHERE session_id = ?
      ORDER BY time_created, id
    `).all(ROOT_SESSION_ID);
    expect(orderedMessages).toEqual([
      { id: "msg_fixture_user_1", createdAt: 1800000001100, role: "observer" },
      { id: "msg_fixture_assistant_1", createdAt: 1800000001200, role: "assistant" },
      { id: "msg_fixture_user_2", createdAt: 1800000002000, role: "user" },
      { id: "msg_fixture_assistant_2", createdAt: 1800000002100, role: "assistant" },
    ]);
  } finally {
    database.close();
  }

  const evidence = readStoreForClaim(
    "an unknown earliest native role invalidates prefix task authority only",
    path,
    { sessionId: ROOT_SESSION_ID },
  );
  const root = rootSession(evidence);
  expect({
    selectedMessages: root.messages.map(({ messageId, role }) => ({ messageId, role })),
    retainedProse: root.prose.map(({ messageId, role, text }) => ({ messageId, role, text })),
    assistantClosing: root.assistantClosing,
    latestTurn: root.latestTurn,
    sessionTokens: root.sessionTokens,
    transcriptTruncated: root.transcriptTruncated,
    invalidMessageDiagnostics: evidence.diagnostics.filter(({ recordId }) =>
      recordId === "msg_fixture_user_1"
    ),
  }).toEqual({
    selectedMessages: [
      { messageId: "msg_fixture_assistant_1", role: "assistant" },
      { messageId: "msg_fixture_user_2", role: "user" },
      { messageId: "msg_fixture_assistant_2", role: "assistant" },
    ],
    retainedProse: [
      {
        messageId: "msg_fixture_assistant_1",
        role: "assistant",
        text: "The first invented Kilo pass preserves native IDs.",
      },
      {
        messageId: "msg_fixture_user_2",
        role: "user",
        text: "Confirm the final invented Kilo evidence.",
      },
      {
        messageId: "msg_fixture_assistant_2",
        role: "assistant",
        text: "Invented Kilo evidence is bounded and complete.",
      },
    ],
    assistantClosing: "Invented Kilo evidence is bounded and complete.",
    latestTurn: {
      messageId: "msg_fixture_assistant_2",
      parentMessageId: "msg_fixture_user_2",
      createdAt: iso(1800000002100),
      completedAt: iso(1800000008000),
      finish: "stop",
    },
    sessionTokens: {
      input: 10,
      output: 4,
      reasoning: 1,
      cacheRead: 8,
      cacheWrite: 2,
    },
    transcriptTruncated: true,
    invalidMessageDiagnostics: [{
      kind: "invalid-record",
      table: "message",
      recordId: "msg_fixture_user_1",
      detail: "message role is not user or assistant",
    }],
  });
  expect({
    firstTask: root.firstTask,
    firstUserText: root.firstUserText,
  }).toEqual({
    firstTask: undefined,
    firstUserText: undefined,
  });
});

test("V5-2 undecodable message before a later user revokes stale assistant suffix authority", async () => {
  const path = await fixtureStore();
  const undecodableMessageId = "msg_v5_suffix_undecodable";
  const laterUserMessageId = "msg_v5_suffix_user";
  openStore(path, (database) => {
    database.run(
      "INSERT INTO message(id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
      [undecodableMessageId, ROOT_SESSION_ID, 1800000009000, 1800000009000, "{invalid"],
    );
    database.run(
      "INSERT INTO message(id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
      [
        laterUserMessageId,
        ROOT_SESSION_ID,
        1800000009100,
        1800000009100,
        JSON.stringify({ role: "user", time: { created: 1800000009100 } }),
      ],
    );
    database.run(
      "INSERT INTO part(id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
      [
        "prt_v5_suffix_user_text",
        laterUserMessageId,
        ROOT_SESSION_ID,
        1800000009101,
        1800000009101,
        JSON.stringify({ type: "text", text: "Later user evidence after the unknown native row." }),
      ],
    );
  });
  const database = new Database(path, { readonly: true });
  try {
    const orderedMessages = database.query(`
      SELECT
        id,
        time_created AS createdAt,
        json_valid(data) AS valid,
        CASE WHEN json_valid(data) THEN json_extract(data, '$.role') END AS role
      FROM message
      WHERE session_id = ?
      ORDER BY time_created, id
    `).all(ROOT_SESSION_ID);
    expect(orderedMessages).toEqual([
      { id: "msg_fixture_user_1", createdAt: 1800000001100, valid: 1, role: "user" },
      { id: "msg_fixture_assistant_1", createdAt: 1800000001200, valid: 1, role: "assistant" },
      { id: "msg_fixture_user_2", createdAt: 1800000002000, valid: 1, role: "user" },
      { id: "msg_fixture_assistant_2", createdAt: 1800000002100, valid: 1, role: "assistant" },
      { id: undecodableMessageId, createdAt: 1800000009000, valid: 0, role: null },
      { id: laterUserMessageId, createdAt: 1800000009100, valid: 1, role: "user" },
    ]);
  } finally {
    database.close();
  }

  const evidence = readStoreForClaim(
    "an undecodable native row before a later user revokes older assistant suffix claims",
    path,
    { sessionId: ROOT_SESSION_ID },
  );
  const root = rootSession(evidence);
  expect({
    selectedMessages: root.messages.map(({ messageId, role }) => ({ messageId, role })),
    retainedTask: root.firstTask,
    retainedProse: root.prose.map(({ messageId, role, text }) => ({ messageId, role, text })),
    earliestAssistantCwd: root.earliestAssistantCwd,
    sessionTokens: root.sessionTokens,
    transcriptTruncated: root.transcriptTruncated,
    invalidMessageDiagnostics: evidence.diagnostics.filter(({ recordId }) =>
      recordId === undecodableMessageId
    ),
  }).toEqual({
    selectedMessages: [
      { messageId: "msg_fixture_user_1", role: "user" },
      { messageId: "msg_fixture_assistant_1", role: "assistant" },
      { messageId: "msg_fixture_user_2", role: "user" },
      { messageId: "msg_fixture_assistant_2", role: "assistant" },
      { messageId: laterUserMessageId, role: "user" },
    ],
    retainedTask: "Prove the invented Kilo V1 authority.",
    retainedProse: [
      {
        messageId: "msg_fixture_user_1",
        role: "user",
        text: "Prove the invented Kilo V1 authority.",
      },
      {
        messageId: "msg_fixture_assistant_1",
        role: "assistant",
        text: "The first invented Kilo pass preserves native IDs.",
      },
      {
        messageId: "msg_fixture_user_2",
        role: "user",
        text: "Confirm the final invented Kilo evidence.",
      },
      {
        messageId: "msg_fixture_assistant_2",
        role: "assistant",
        text: "Invented Kilo evidence is bounded and complete.",
      },
      {
        messageId: laterUserMessageId,
        role: "user",
        text: "Later user evidence after the unknown native row.",
      },
    ],
    earliestAssistantCwd: "/synthetic/kilo/project/root",
    sessionTokens: {
      input: 10,
      output: 4,
      reasoning: 1,
      cacheRead: 8,
      cacheWrite: 2,
    },
    transcriptTruncated: true,
    invalidMessageDiagnostics: [{
      kind: "invalid-json",
      table: "message",
      recordId: undecodableMessageId,
      detail: "JSON record could not be decoded and was skipped",
    }],
  });
  expect({
    assistantClosing: root.assistantClosing,
    latestTurn: root.latestTurn,
    latestAssistantCwd: root.latestAssistantCwd,
    latestCallTokens: root.latestCallTokens,
    callSizes: root.callSizes,
    callSizesComplete: root.callSizesComplete,
  }).toEqual({
    assistantClosing: undefined,
    latestTurn: undefined,
    latestAssistantCwd: undefined,
    latestCallTokens: undefined,
    callSizes: undefined,
    callSizesComplete: false,
  });
});

test("V5-3 oversized earliest user speech cannot promote a later user task", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.run(
      "UPDATE part SET data = ? WHERE id = ?",
      [
        JSON.stringify({ type: "text", text: "u".repeat(KILO_STORE_LIMITS.textChars + 1) }),
        "prt_fixture_user_1_text",
      ],
    );
  });
  const database = new Database(path, { readonly: true });
  try {
    const earliestUserText = database.query(`
      SELECT
        part.id,
        part.message_id AS messageId,
        message.time_created AS messageCreatedAt,
        part.time_created AS partCreatedAt,
        json_extract(message.data, '$.role') AS role,
        json_extract(part.data, '$.type') AS type,
        length(json_extract(part.data, '$.text')) AS textChars
      FROM message
      JOIN part ON part.message_id = message.id
      WHERE message.session_id = ?
        AND json_extract(message.data, '$.role') = 'user'
        AND json_extract(part.data, '$.type') = 'text'
        AND coalesce(json_extract(part.data, '$.synthetic'), 0) <> 1
        AND coalesce(json_extract(part.data, '$.ignored'), 0) <> 1
      ORDER BY message.time_created, message.id, part.time_created, part.id
      LIMIT 1
    `).get(ROOT_SESSION_ID);
    expect(earliestUserText).toEqual({
      id: "prt_fixture_user_1_text",
      messageId: "msg_fixture_user_1",
      messageCreatedAt: 1800000001100,
      partCreatedAt: 1800000001101,
      role: "user",
      type: "text",
      textChars: KILO_STORE_LIMITS.textChars + 1,
    });
  } finally {
    database.close();
  }

  const evidence = readStoreForClaim(
    "oversized earliest user speech invalidates task authority without hiding later evidence",
    path,
    { sessionId: ROOT_SESSION_ID },
  );
  const root = rootSession(evidence);
  expect({
    selectedMessages: root.messages.map(({ messageId, role }) => ({ messageId, role })),
    retainedProse: root.prose.map(({ messageId, role, text }) => ({ messageId, role, text })),
    assistantClosing: root.assistantClosing,
    latestTurn: root.latestTurn,
    latestAssistantCwd: root.latestAssistantCwd,
    latestCallTokens: root.latestCallTokens,
    transcriptTruncated: root.transcriptTruncated,
    oversizedPartDiagnostics: evidence.diagnostics.filter(({ recordId }) =>
      recordId === "prt_fixture_user_1_text"
    ),
  }).toEqual({
    selectedMessages: [
      { messageId: "msg_fixture_user_1", role: "user" },
      { messageId: "msg_fixture_assistant_1", role: "assistant" },
      { messageId: "msg_fixture_user_2", role: "user" },
      { messageId: "msg_fixture_assistant_2", role: "assistant" },
    ],
    retainedProse: [
      {
        messageId: "msg_fixture_assistant_1",
        role: "assistant",
        text: "The first invented Kilo pass preserves native IDs.",
      },
      {
        messageId: "msg_fixture_user_2",
        role: "user",
        text: "Confirm the final invented Kilo evidence.",
      },
      {
        messageId: "msg_fixture_assistant_2",
        role: "assistant",
        text: "Invented Kilo evidence is bounded and complete.",
      },
    ],
    assistantClosing: "Invented Kilo evidence is bounded and complete.",
    latestTurn: {
      messageId: "msg_fixture_assistant_2",
      parentMessageId: "msg_fixture_user_2",
      createdAt: iso(1800000002100),
      completedAt: iso(1800000008000),
      finish: "stop",
    },
    latestAssistantCwd: "/synthetic/kilo/project/root/recent",
    latestCallTokens: {
      input: 4,
      output: 2,
      reasoning: 0,
      cacheRead: 1,
      cacheWrite: 0,
      total: 6,
    },
    transcriptTruncated: true,
    oversizedPartDiagnostics: [{
      kind: "oversized-content",
      table: "part",
      recordId: "prt_fixture_user_1_text",
      detail: `part text exceeds ${KILO_STORE_LIMITS.textChars} characters and was skipped`,
    }],
  });
  expect({
    firstTask: root.firstTask,
    firstUserText: root.firstUserText,
  }).toEqual({
    firstTask: undefined,
    firstUserText: undefined,
  });
});

test("V5-4 oversized latest assistant speech cannot promote an older closing", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.run(
      "UPDATE part SET data = ? WHERE id = ?",
      [
        JSON.stringify({ type: "text", text: "a".repeat(KILO_STORE_LIMITS.textChars + 1) }),
        "prt_fixture_assistant_2_text",
      ],
    );
  });
  const database = new Database(path, { readonly: true });
  try {
    const latestAssistantText = database.query(`
      SELECT
        part.id,
        part.message_id AS messageId,
        message.time_created AS messageCreatedAt,
        part.time_created AS partCreatedAt,
        json_extract(message.data, '$.role') AS role,
        json_extract(part.data, '$.type') AS type,
        length(json_extract(part.data, '$.text')) AS textChars
      FROM message
      JOIN part ON part.message_id = message.id
      WHERE message.session_id = ?
        AND json_extract(message.data, '$.role') = 'assistant'
        AND json_extract(part.data, '$.type') = 'text'
      ORDER BY message.time_created DESC, message.id DESC, part.time_created DESC, part.id DESC
      LIMIT 1
    `).get(ROOT_SESSION_ID);
    expect(latestAssistantText).toEqual({
      id: "prt_fixture_assistant_2_text",
      messageId: "msg_fixture_assistant_2",
      messageCreatedAt: 1800000002100,
      partCreatedAt: 1800000007900,
      role: "assistant",
      type: "text",
      textChars: KILO_STORE_LIMITS.textChars + 1,
    });
  } finally {
    database.close();
  }

  const evidence = readStoreForClaim(
    "oversized latest assistant speech invalidates only closing-text authority",
    path,
    { sessionId: ROOT_SESSION_ID },
  );
  const root = rootSession(evidence);
  expect({
    firstTask: root.firstTask,
    firstUserText: root.firstUserText,
    retainedProse: root.prose.map(({ messageId, role, text }) => ({ messageId, role, text })),
    latestMessage: root.messages.at(-1),
    latestTurn: root.latestTurn,
    latestAssistantCwd: root.latestAssistantCwd,
    latestCallTokens: root.latestCallTokens,
    transcriptTruncated: root.transcriptTruncated,
    oversizedPartDiagnostics: evidence.diagnostics.filter(({ recordId }) =>
      recordId === "prt_fixture_assistant_2_text"
    ),
  }).toEqual({
    firstTask: "Prove the invented Kilo V1 authority.",
    firstUserText: "Prove the invented Kilo V1 authority.",
    retainedProse: [
      {
        messageId: "msg_fixture_user_1",
        role: "user",
        text: "Prove the invented Kilo V1 authority.",
      },
      {
        messageId: "msg_fixture_assistant_1",
        role: "assistant",
        text: "The first invented Kilo pass preserves native IDs.",
      },
      {
        messageId: "msg_fixture_user_2",
        role: "user",
        text: "Confirm the final invented Kilo evidence.",
      },
    ],
    latestMessage: {
      messageId: "msg_fixture_assistant_2",
      sessionId: ROOT_SESSION_ID,
      role: "assistant",
      createdAt: iso(1800000002100),
      completedAt: iso(1800000008000),
      parentMessageId: "msg_fixture_user_2",
      rawModel: {
        modelId: "model-invented",
        providerRoute: "provider-invented",
        rawVariant: "high",
      },
    },
    latestTurn: {
      messageId: "msg_fixture_assistant_2",
      parentMessageId: "msg_fixture_user_2",
      createdAt: iso(1800000002100),
      completedAt: iso(1800000008000),
      finish: "stop",
    },
    latestAssistantCwd: "/synthetic/kilo/project/root/recent",
    latestCallTokens: {
      input: 4,
      output: 2,
      reasoning: 0,
      cacheRead: 1,
      cacheWrite: 0,
      total: 6,
    },
    transcriptTruncated: true,
    oversizedPartDiagnostics: [{
      kind: "oversized-content",
      table: "part",
      recordId: "prt_fixture_assistant_2_text",
      detail: `part text exceeds ${KILO_STORE_LIMITS.textChars} characters and was skipped`,
    }],
  });
  expect({ assistantClosing: root.assistantClosing }).toEqual({
    assistantClosing: undefined,
  });
});

test("V6-1 oversized earliest user part identity cannot promote later user speech", async () => {
  const path = await fixtureStore();
  const oversizedPartId = "u".repeat(300);
  let selected: {
    rowId: number;
    id: string;
    messageId: string;
    messageCreatedAt: number;
    partCreatedAt: number;
    role: string;
    type: string;
  } | null = null;
  openStore(path, (database) => {
    selected = database.query(`
      SELECT
        part.rowid AS rowId,
        part.id,
        part.message_id AS messageId,
        message.time_created AS messageCreatedAt,
        part.time_created AS partCreatedAt,
        json_extract(message.data, '$.role') AS role,
        json_extract(part.data, '$.type') AS type
      FROM message
      JOIN part ON part.message_id = message.id
      WHERE message.session_id = ?
        AND json_extract(message.data, '$.role') = 'user'
        AND json_extract(part.data, '$.type') = 'text'
        AND coalesce(json_extract(part.data, '$.synthetic'), 0) <> 1
        AND coalesce(json_extract(part.data, '$.ignored'), 0) <> 1
      ORDER BY message.time_created, message.id, part.time_created, part.id
      LIMIT 1
    `).get(ROOT_SESSION_ID) as typeof selected;
    if (!selected) throw new Error("native earliest user text selection was empty");
    database.run("UPDATE part SET id = ? WHERE rowid = ?", [oversizedPartId, selected.rowId]);
  });
  expect(selected as unknown).toEqual({
    rowId: expect.any(Number),
    id: "prt_fixture_user_1_text",
    messageId: "msg_fixture_user_1",
    messageCreatedAt: 1800000001100,
    partCreatedAt: 1800000001101,
    role: "user",
    type: "text",
  });

  const database = new Database(path, { readonly: true });
  try {
    const orderedUserSpeech = database.query(`
      SELECT
        part.id,
        length(part.id) AS idChars,
        part.message_id AS messageId,
        message.time_created AS messageCreatedAt,
        part.time_created AS partCreatedAt,
        json_extract(part.data, '$.type') AS type,
        json_extract(part.data, '$.text') AS text
      FROM message
      JOIN part ON part.message_id = message.id
      WHERE message.session_id = ?
        AND json_extract(message.data, '$.role') = 'user'
        AND json_extract(part.data, '$.type') = 'text'
        AND coalesce(json_extract(part.data, '$.synthetic'), 0) <> 1
        AND coalesce(json_extract(part.data, '$.ignored'), 0) <> 1
      ORDER BY message.time_created, message.id, part.time_created, part.id
    `).all(ROOT_SESSION_ID);
    expect(orderedUserSpeech).toEqual([
      {
        id: oversizedPartId,
        idChars: 300,
        messageId: "msg_fixture_user_1",
        messageCreatedAt: 1800000001100,
        partCreatedAt: 1800000001101,
        type: "text",
        text: "Prove the invented Kilo V1 authority.",
      },
      {
        id: "prt_fixture_user_2_text",
        idChars: 23,
        messageId: "msg_fixture_user_2",
        messageCreatedAt: 1800000002000,
        partCreatedAt: 1800000002001,
        type: "text",
        text: "Confirm the final invented Kilo evidence.",
      },
    ]);
  } finally {
    database.close();
  }

  const evidence = readStoreForClaim(
    "an oversized earliest native part id invalidates prefix speech authority only",
    path,
    { sessionId: ROOT_SESSION_ID },
  );
  const root = rootSession(evidence);
  expect({
    retainedProse: root.prose.map(({ messageId, role, text }) => ({ messageId, role, text })),
    assistantClosing: root.assistantClosing,
    latestTurn: root.latestTurn,
    latestAssistantCwd: root.latestAssistantCwd,
    latestCallTokens: root.latestCallTokens,
    sessionTokens: root.sessionTokens,
    callSizes: root.callSizes,
    callSizesComplete: root.callSizesComplete,
    transcriptTruncated: root.transcriptTruncated,
    oversizedPartIdDiagnostics: evidence.diagnostics.filter(({ detail }) =>
      detail === "part id exceeds 256 characters and was omitted"
    ),
  }).toEqual({
    retainedProse: [
      {
        messageId: "msg_fixture_assistant_1",
        role: "assistant",
        text: "The first invented Kilo pass preserves native IDs.",
      },
      {
        messageId: "msg_fixture_user_2",
        role: "user",
        text: "Confirm the final invented Kilo evidence.",
      },
      {
        messageId: "msg_fixture_assistant_2",
        role: "assistant",
        text: "Invented Kilo evidence is bounded and complete.",
      },
    ],
    assistantClosing: "Invented Kilo evidence is bounded and complete.",
    latestTurn: {
      messageId: "msg_fixture_assistant_2",
      parentMessageId: "msg_fixture_user_2",
      createdAt: iso(1800000002100),
      completedAt: iso(1800000008000),
      finish: "stop",
    },
    latestAssistantCwd: "/synthetic/kilo/project/root/recent",
    latestCallTokens: {
      input: 4,
      output: 2,
      reasoning: 0,
      cacheRead: 1,
      cacheWrite: 0,
      total: 6,
    },
    sessionTokens: {
      input: 10,
      output: 4,
      reasoning: 1,
      cacheRead: 8,
      cacheWrite: 2,
    },
    callSizes: undefined,
    callSizesComplete: false,
    transcriptTruncated: true,
    oversizedPartIdDiagnostics: [{
      kind: "oversized-content",
      table: "part",
      recordId: undefined,
      detail: "part id exceeds 256 characters and was omitted",
    }],
  });
  expect({
    firstTask: root.firstTask,
    firstUserText: root.firstUserText,
  }).toEqual({
    firstTask: undefined,
    firstUserText: undefined,
  });
});

test("V6-2 oversized latest assistant part identity cannot promote older speech", async () => {
  const path = await fixtureStore();
  const oversizedPartId = "a".repeat(300);
  let selected: {
    rowId: number;
    id: string;
    messageId: string;
    messageCreatedAt: number;
    partCreatedAt: number;
    role: string;
    type: string;
  } | null = null;
  openStore(path, (database) => {
    selected = database.query(`
      SELECT
        part.rowid AS rowId,
        part.id,
        part.message_id AS messageId,
        message.time_created AS messageCreatedAt,
        part.time_created AS partCreatedAt,
        json_extract(message.data, '$.role') AS role,
        json_extract(part.data, '$.type') AS type
      FROM message
      JOIN part ON part.message_id = message.id
      WHERE message.session_id = ?
        AND json_extract(message.data, '$.role') = 'assistant'
        AND json_extract(part.data, '$.type') = 'text'
      ORDER BY message.time_created DESC, message.id DESC, part.time_created DESC, part.id DESC
      LIMIT 1
    `).get(ROOT_SESSION_ID) as typeof selected;
    if (!selected) throw new Error("native latest assistant text selection was empty");
    database.run("UPDATE part SET id = ? WHERE rowid = ?", [oversizedPartId, selected.rowId]);
  });
  expect(selected as unknown).toEqual({
    rowId: expect.any(Number),
    id: "prt_fixture_assistant_2_text",
    messageId: "msg_fixture_assistant_2",
    messageCreatedAt: 1800000002100,
    partCreatedAt: 1800000007900,
    role: "assistant",
    type: "text",
  });

  const database = new Database(path, { readonly: true });
  try {
    const orderedLatestParts = database.query(`
      SELECT
        id,
        length(id) AS idChars,
        message_id AS messageId,
        time_created AS partCreatedAt,
        json_extract(data, '$.type') AS type,
        json_extract(data, '$.tokens.total') AS total
      FROM part
      WHERE message_id = ?
      ORDER BY time_created, id
    `).all("msg_fixture_assistant_2");
    expect(orderedLatestParts).toEqual([
      {
        id: oversizedPartId,
        idChars: 300,
        messageId: "msg_fixture_assistant_2",
        partCreatedAt: 1800000007900,
        type: "text",
        total: null,
      },
      {
        id: "prt_fixture_assistant_2_finish",
        idChars: 30,
        messageId: "msg_fixture_assistant_2",
        partCreatedAt: 1800000008000,
        type: "step-finish",
        total: 6,
      },
    ]);
  } finally {
    database.close();
  }

  const evidence = readStoreForClaim(
    "an oversized latest assistant part id invalidates closing authority before a valid finish",
    path,
    { sessionId: ROOT_SESSION_ID },
  );
  const root = rootSession(evidence);
  expect({
    firstTask: root.firstTask,
    firstUserText: root.firstUserText,
    retainedProse: root.prose.map(({ messageId, role, text }) => ({ messageId, role, text })),
    latestTurn: root.latestTurn,
    latestAssistantCwd: root.latestAssistantCwd,
    latestCallTokens: root.latestCallTokens,
    callSizes: root.callSizes,
    callSizesComplete: root.callSizesComplete,
    transcriptTruncated: root.transcriptTruncated,
    oversizedPartIdDiagnostics: evidence.diagnostics.filter(({ detail }) =>
      detail === "part id exceeds 256 characters and was omitted"
    ),
  }).toEqual({
    firstTask: "Prove the invented Kilo V1 authority.",
    firstUserText: "Prove the invented Kilo V1 authority.",
    retainedProse: [
      {
        messageId: "msg_fixture_user_1",
        role: "user",
        text: "Prove the invented Kilo V1 authority.",
      },
      {
        messageId: "msg_fixture_assistant_1",
        role: "assistant",
        text: "The first invented Kilo pass preserves native IDs.",
      },
      {
        messageId: "msg_fixture_user_2",
        role: "user",
        text: "Confirm the final invented Kilo evidence.",
      },
    ],
    latestTurn: {
      messageId: "msg_fixture_assistant_2",
      parentMessageId: "msg_fixture_user_2",
      createdAt: iso(1800000002100),
      completedAt: iso(1800000008000),
      finish: "stop",
    },
    latestAssistantCwd: "/synthetic/kilo/project/root/recent",
    latestCallTokens: undefined,
    callSizes: undefined,
    callSizesComplete: false,
    transcriptTruncated: true,
    oversizedPartIdDiagnostics: [{
      kind: "oversized-content",
      table: "part",
      recordId: undefined,
      detail: "part id exceeds 256 characters and was omitted",
    }],
  });
  expect({ assistantClosing: root.assistantClosing }).toEqual({
    assistantClosing: undefined,
  });
});

test("V6-3 unknown earliest user part type cannot promote later user speech", async () => {
  const path = await fixtureStore();
  const unknownType = "invented-v6-unknown-user-speech";
  let selected: {
    rowId: number;
    id: string;
    messageId: string;
    messageCreatedAt: number;
    partCreatedAt: number;
    role: string;
    type: string;
  } | null = null;
  openStore(path, (database) => {
    selected = database.query(`
      SELECT
        part.rowid AS rowId,
        part.id,
        part.message_id AS messageId,
        message.time_created AS messageCreatedAt,
        part.time_created AS partCreatedAt,
        json_extract(message.data, '$.role') AS role,
        json_extract(part.data, '$.type') AS type
      FROM message
      JOIN part ON part.message_id = message.id
      WHERE message.session_id = ?
        AND json_extract(message.data, '$.role') = 'user'
        AND json_extract(part.data, '$.type') = 'text'
        AND coalesce(json_extract(part.data, '$.synthetic'), 0) <> 1
        AND coalesce(json_extract(part.data, '$.ignored'), 0) <> 1
      ORDER BY message.time_created, message.id, part.time_created, part.id
      LIMIT 1
    `).get(ROOT_SESSION_ID) as typeof selected;
    if (!selected) throw new Error("native earliest user text selection was empty");
    database.run(
      "UPDATE part SET data = json_set(data, '$.type', ?) WHERE rowid = ?",
      [unknownType, selected.rowId],
    );
  });
  expect(selected as unknown).toEqual({
    rowId: expect.any(Number),
    id: "prt_fixture_user_1_text",
    messageId: "msg_fixture_user_1",
    messageCreatedAt: 1800000001100,
    partCreatedAt: 1800000001101,
    role: "user",
    type: "text",
  });

  const database = new Database(path, { readonly: true });
  try {
    const orderedUserPayloads = database.query(`
      SELECT
        part.id,
        part.message_id AS messageId,
        message.time_created AS messageCreatedAt,
        part.time_created AS partCreatedAt,
        json_extract(part.data, '$.type') AS type,
        json_extract(part.data, '$.text') AS text
      FROM message
      JOIN part ON part.message_id = message.id
      WHERE message.session_id = ?
        AND json_extract(message.data, '$.role') = 'user'
        AND json_extract(part.data, '$.text') IS NOT NULL
        AND coalesce(json_extract(part.data, '$.synthetic'), 0) <> 1
        AND coalesce(json_extract(part.data, '$.ignored'), 0) <> 1
      ORDER BY message.time_created, message.id, part.time_created, part.id
    `).all(ROOT_SESSION_ID);
    expect(orderedUserPayloads).toEqual([
      {
        id: "prt_fixture_user_1_text",
        messageId: "msg_fixture_user_1",
        messageCreatedAt: 1800000001100,
        partCreatedAt: 1800000001101,
        type: unknownType,
        text: "Prove the invented Kilo V1 authority.",
      },
      {
        id: "prt_fixture_user_2_text",
        messageId: "msg_fixture_user_2",
        messageCreatedAt: 1800000002000,
        partCreatedAt: 1800000002001,
        type: "text",
        text: "Confirm the final invented Kilo evidence.",
      },
    ]);
  } finally {
    database.close();
  }

  const evidence = readStoreForClaim(
    "an unknown earliest user part type invalidates prefix and completeness authority",
    path,
    { sessionId: ROOT_SESSION_ID },
  );
  const root = rootSession(evidence);
  expect({
    retainedProse: root.prose.map(({ messageId, role, text }) => ({ messageId, role, text })),
    assistantClosing: root.assistantClosing,
    latestTurn: root.latestTurn,
    latestAssistantCwd: root.latestAssistantCwd,
    latestCallTokens: root.latestCallTokens,
    sessionTokens: root.sessionTokens,
    unknownPartDiagnostics: evidence.diagnostics.filter(({ recordId }) =>
      recordId === "prt_fixture_user_1_text"
    ),
  }).toEqual({
    retainedProse: [
      {
        messageId: "msg_fixture_assistant_1",
        role: "assistant",
        text: "The first invented Kilo pass preserves native IDs.",
      },
      {
        messageId: "msg_fixture_user_2",
        role: "user",
        text: "Confirm the final invented Kilo evidence.",
      },
      {
        messageId: "msg_fixture_assistant_2",
        role: "assistant",
        text: "Invented Kilo evidence is bounded and complete.",
      },
    ],
    assistantClosing: "Invented Kilo evidence is bounded and complete.",
    latestTurn: {
      messageId: "msg_fixture_assistant_2",
      parentMessageId: "msg_fixture_user_2",
      createdAt: iso(1800000002100),
      completedAt: iso(1800000008000),
      finish: "stop",
    },
    latestAssistantCwd: "/synthetic/kilo/project/root/recent",
    latestCallTokens: {
      input: 4,
      output: 2,
      reasoning: 0,
      cacheRead: 1,
      cacheWrite: 0,
      total: 6,
    },
    sessionTokens: {
      input: 10,
      output: 4,
      reasoning: 1,
      cacheRead: 8,
      cacheWrite: 2,
    },
    unknownPartDiagnostics: [{
      kind: "invalid-record",
      table: "part",
      recordId: "prt_fixture_user_1_text",
      detail: "part type is unknown or invalid and was skipped",
    }],
  });
  expect({
    firstTask: root.firstTask,
    firstUserText: root.firstUserText,
    callSizes: root.callSizes,
    callSizesComplete: root.callSizesComplete,
    transcriptTruncated: root.transcriptTruncated,
  }).toEqual({
    firstTask: undefined,
    firstUserText: undefined,
    callSizes: undefined,
    callSizesComplete: false,
    transcriptTruncated: true,
  });
});

test("V6-4 unknown trailing assistant part type revokes speech and usage authority", async () => {
  const path = await fixtureStore();
  const unknownType = "invented-v6-unknown-assistant-speech";
  let selectedText: {
    rowId: number;
    id: string;
    messageId: string;
    messageCreatedAt: number;
    partCreatedAt: number;
    role: string;
    type: string;
  } | null = null;
  let selectedFinish: {
    rowId: number;
    id: string;
    messageId: string;
    partCreatedAt: number;
    type: string;
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  } | null = null;
  openStore(path, (database) => {
    selectedText = database.query(`
      SELECT
        part.rowid AS rowId,
        part.id,
        part.message_id AS messageId,
        message.time_created AS messageCreatedAt,
        part.time_created AS partCreatedAt,
        json_extract(message.data, '$.role') AS role,
        json_extract(part.data, '$.type') AS type
      FROM message
      JOIN part ON part.message_id = message.id
      WHERE message.session_id = ?
        AND json_extract(message.data, '$.role') = 'assistant'
        AND json_extract(part.data, '$.type') = 'text'
      ORDER BY message.time_created DESC, message.id DESC, part.time_created DESC, part.id DESC
      LIMIT 1
    `).get(ROOT_SESSION_ID) as typeof selectedText;
    if (!selectedText) throw new Error("native latest assistant text selection was empty");
    selectedFinish = database.query(`
      SELECT
        rowid AS rowId,
        id,
        message_id AS messageId,
        time_created AS partCreatedAt,
        json_extract(data, '$.type') AS type,
        json_extract(data, '$.tokens.input') AS input,
        json_extract(data, '$.tokens.output') AS output,
        json_extract(data, '$.tokens.reasoning') AS reasoning,
        json_extract(data, '$.tokens.cache.read') AS cacheRead,
        json_extract(data, '$.tokens.cache.write') AS cacheWrite,
        json_extract(data, '$.tokens.total') AS total
      FROM part
      WHERE message_id = ?
        AND json_extract(data, '$.type') = 'step-finish'
      ORDER BY time_created DESC, id DESC
      LIMIT 1
    `).get(selectedText.messageId) as typeof selectedFinish;
    if (!selectedFinish) throw new Error("native latest valid step-finish selection was empty");
    const unknownCreatedAt = selectedFinish.partCreatedAt + 1;
    database.run(
      "UPDATE part SET data = json_set(data, '$.type', ?), time_created = ?, time_updated = ? WHERE rowid = ?",
      [unknownType, unknownCreatedAt, unknownCreatedAt, selectedText.rowId],
    );
  });
  expect({
    selectedText: selectedText as unknown,
    selectedFinish: selectedFinish as unknown,
  }).toEqual({
    selectedText: {
      rowId: expect.any(Number),
      id: "prt_fixture_assistant_2_text",
      messageId: "msg_fixture_assistant_2",
      messageCreatedAt: 1800000002100,
      partCreatedAt: 1800000007900,
      role: "assistant",
      type: "text",
    },
    selectedFinish: {
      rowId: expect.any(Number),
      id: "prt_fixture_assistant_2_finish",
      messageId: "msg_fixture_assistant_2",
      partCreatedAt: 1800000008000,
      type: "step-finish",
      input: 4,
      output: 2,
      reasoning: 0,
      cacheRead: 1,
      cacheWrite: 0,
      total: 6,
    },
  });

  const database = new Database(path, { readonly: true });
  try {
    const orderedLatestParts = database.query(`
      SELECT
        id,
        message_id AS messageId,
        time_created AS partCreatedAt,
        json_extract(data, '$.type') AS type,
        json_extract(data, '$.text') AS text,
        json_extract(data, '$.tokens.total') AS total
      FROM part
      WHERE message_id = ?
      ORDER BY time_created, id
    `).all("msg_fixture_assistant_2");
    expect(orderedLatestParts).toEqual([
      {
        id: "prt_fixture_assistant_2_finish",
        messageId: "msg_fixture_assistant_2",
        partCreatedAt: 1800000008000,
        type: "step-finish",
        text: null,
        total: 6,
      },
      {
        id: "prt_fixture_assistant_2_text",
        messageId: "msg_fixture_assistant_2",
        partCreatedAt: 1800000008001,
        type: unknownType,
        text: "Invented Kilo evidence is bounded and complete.",
        total: null,
      },
    ]);
  } finally {
    database.close();
  }

  const evidence = readStoreForClaim(
    "an unknown assistant row after the valid finish revokes closing and usage authority",
    path,
    { sessionId: ROOT_SESSION_ID },
  );
  const root = rootSession(evidence);
  expect({
    firstTask: root.firstTask,
    firstUserText: root.firstUserText,
    retainedProse: root.prose.map(({ messageId, role, text }) => ({ messageId, role, text })),
    latestTurn: root.latestTurn,
    latestAssistantCwd: root.latestAssistantCwd,
    sessionTokens: root.sessionTokens,
    unknownPartDiagnostics: evidence.diagnostics.filter(({ recordId }) =>
      recordId === "prt_fixture_assistant_2_text"
    ),
  }).toEqual({
    firstTask: "Prove the invented Kilo V1 authority.",
    firstUserText: "Prove the invented Kilo V1 authority.",
    retainedProse: [
      {
        messageId: "msg_fixture_user_1",
        role: "user",
        text: "Prove the invented Kilo V1 authority.",
      },
      {
        messageId: "msg_fixture_assistant_1",
        role: "assistant",
        text: "The first invented Kilo pass preserves native IDs.",
      },
      {
        messageId: "msg_fixture_user_2",
        role: "user",
        text: "Confirm the final invented Kilo evidence.",
      },
    ],
    latestTurn: {
      messageId: "msg_fixture_assistant_2",
      parentMessageId: "msg_fixture_user_2",
      createdAt: iso(1800000002100),
      completedAt: iso(1800000008000),
      finish: "stop",
    },
    latestAssistantCwd: "/synthetic/kilo/project/root/recent",
    sessionTokens: {
      input: 10,
      output: 4,
      reasoning: 1,
      cacheRead: 8,
      cacheWrite: 2,
    },
    unknownPartDiagnostics: [{
      kind: "invalid-record",
      table: "part",
      recordId: "prt_fixture_assistant_2_text",
      detail: "part type is unknown or invalid and was skipped",
    }],
  });
  expect({
    assistantClosing: root.assistantClosing,
    latestCallTokens: root.latestCallTokens,
    callSizes: root.callSizes,
    callSizesComplete: root.callSizesComplete,
    transcriptTruncated: root.transcriptTruncated,
  }).toEqual({
    assistantClosing: undefined,
    latestCallTokens: undefined,
    callSizes: undefined,
    callSizesComplete: false,
    transcriptTruncated: true,
  });
});

test("V7-1 SQLite BINARY part-ID order revokes usage authority despite an earlier timestamp", async () => {
  const path = await fixtureStore();
  const unknownPartId = "prt_fixture_assistant_2_zz_v7_unknown";
  const unknownType = "invented-v7-native-id-unknown";
  const unknownCreatedAt = 1800000007850;
  const unknownData = JSON.stringify({ type: unknownType });
  openStore(path, (database) => {
    database.run(
      "INSERT INTO part(id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
      [
        unknownPartId,
        "msg_fixture_assistant_2",
        ROOT_SESSION_ID,
        unknownCreatedAt,
        unknownCreatedAt,
        unknownData,
      ],
    );
  });

  const database = new Database(path, { readonly: true });
  try {
    const binaryIdOrder = database.query(`
      SELECT
        part.rowid AS rowId,
        part.id,
        length(part.id) AS idChars,
        part.message_id AS messageId,
        part.session_id AS partSessionId,
        message.session_id AS messageSessionId,
        message.time_created AS messageCreatedAt,
        json_extract(message.data, '$.role') AS role,
        part.time_created AS partCreatedAt,
        part.time_updated AS partUpdatedAt,
        json_valid(part.data) AS dataValid,
        length(part.data) AS dataChars,
        json_extract(part.data, '$.type') AS type,
        json_extract(part.data, '$.text') AS text,
        json_extract(part.data, '$.tokens.input') AS input,
        json_extract(part.data, '$.tokens.output') AS output,
        json_extract(part.data, '$.tokens.reasoning') AS reasoning,
        json_extract(part.data, '$.tokens.cache.read') AS cacheRead,
        json_extract(part.data, '$.tokens.cache.write') AS cacheWrite,
        json_extract(part.data, '$.tokens.total') AS total
      FROM part
      JOIN message ON message.id = part.message_id
      WHERE part.id IN (?, ?, ?)
      ORDER BY part.id COLLATE BINARY
    `).all(
      "prt_fixture_assistant_2_text",
      "prt_fixture_assistant_2_finish",
      unknownPartId,
    );
    expect(binaryIdOrder).toEqual([
      {
        rowId: 9,
        id: "prt_fixture_assistant_2_finish",
        idChars: 30,
        messageId: "msg_fixture_assistant_2",
        partSessionId: ROOT_SESSION_ID,
        messageSessionId: ROOT_SESSION_ID,
        messageCreatedAt: 1800000002100,
        role: "assistant",
        partCreatedAt: 1800000008000,
        partUpdatedAt: 1800000008000,
        dataValid: 1,
        dataChars: 135,
        type: "step-finish",
        text: null,
        input: 4,
        output: 2,
        reasoning: 0,
        cacheRead: 1,
        cacheWrite: 0,
        total: 6,
      },
      {
        rowId: 8,
        id: "prt_fixture_assistant_2_text",
        idChars: 28,
        messageId: "msg_fixture_assistant_2",
        partSessionId: ROOT_SESSION_ID,
        messageSessionId: ROOT_SESSION_ID,
        messageCreatedAt: 1800000002100,
        role: "assistant",
        partCreatedAt: 1800000007900,
        partUpdatedAt: 1800000007900,
        dataValid: 1,
        dataChars: 72,
        type: "text",
        text: "Invented Kilo evidence is bounded and complete.",
        input: null,
        output: null,
        reasoning: null,
        cacheRead: null,
        cacheWrite: null,
        total: null,
      },
      {
        rowId: 10,
        id: unknownPartId,
        idChars: 37,
        messageId: "msg_fixture_assistant_2",
        partSessionId: ROOT_SESSION_ID,
        messageSessionId: ROOT_SESSION_ID,
        messageCreatedAt: 1800000002100,
        role: "assistant",
        partCreatedAt: unknownCreatedAt,
        partUpdatedAt: unknownCreatedAt,
        dataValid: 1,
        dataChars: 40,
        type: unknownType,
        text: null,
        input: null,
        output: null,
        reasoning: null,
        cacheRead: null,
        cacheWrite: null,
        total: null,
      },
    ]);

    const conflictingTimestampOrder = database.query(`
      SELECT id, length(id) AS idChars, time_created AS partCreatedAt
      FROM part
      WHERE id IN (?, ?, ?)
      ORDER BY time_created, id COLLATE BINARY
    `).all(
      "prt_fixture_assistant_2_text",
      "prt_fixture_assistant_2_finish",
      unknownPartId,
    );
    expect(conflictingTimestampOrder).toEqual([
      { id: unknownPartId, idChars: 37, partCreatedAt: unknownCreatedAt },
      { id: "prt_fixture_assistant_2_text", idChars: 28, partCreatedAt: 1800000007900 },
      { id: "prt_fixture_assistant_2_finish", idChars: 30, partCreatedAt: 1800000008000 },
    ]);
  } finally {
    database.close();
  }

  const evidence = readStoreForClaim(
    "SQLite BINARY part-ID order makes a trailing decoded unknown row revoke usage authority",
    path,
    { sessionId: ROOT_SESSION_ID },
  );
  const root = rootSession(evidence);
  expect({
    storeIncomplete: evidence.incomplete,
    session: { provider: root.provider, sessionId: root.sessionId, slug: root.slug },
    firstTask: root.firstTask,
    firstUserText: root.firstUserText,
    retainedProse: root.prose.map(({ messageId, role, text }) => ({ messageId, role, text })),
    latestMessage: root.messages.at(-1),
    latestTurn: root.latestTurn,
    earliestAssistantCwd: root.earliestAssistantCwd,
    latestAssistantCwd: root.latestAssistantCwd,
    sessionTokens: root.sessionTokens,
    unknownPartDiagnostics: evidence.diagnostics.filter(({ recordId }) =>
      recordId === unknownPartId
    ),
    transcriptTruncated: root.transcriptTruncated,
    callSizes: root.callSizes,
    callSizesComplete: root.callSizesComplete,
  }).toEqual({
    storeIncomplete: false,
    session: { provider: "kilo", sessionId: ROOT_SESSION_ID, slug: "fixture-root" },
    firstTask: "Prove the invented Kilo V1 authority.",
    firstUserText: "Prove the invented Kilo V1 authority.",
    retainedProse: [
      {
        messageId: "msg_fixture_user_1",
        role: "user",
        text: "Prove the invented Kilo V1 authority.",
      },
      {
        messageId: "msg_fixture_assistant_1",
        role: "assistant",
        text: "The first invented Kilo pass preserves native IDs.",
      },
      {
        messageId: "msg_fixture_user_2",
        role: "user",
        text: "Confirm the final invented Kilo evidence.",
      },
      {
        messageId: "msg_fixture_assistant_2",
        role: "assistant",
        text: "Invented Kilo evidence is bounded and complete.",
      },
    ],
    latestMessage: {
      messageId: "msg_fixture_assistant_2",
      sessionId: ROOT_SESSION_ID,
      role: "assistant",
      createdAt: iso(1800000002100),
      completedAt: iso(1800000008000),
      parentMessageId: "msg_fixture_user_2",
      rawModel: {
        modelId: "model-invented",
        providerRoute: "provider-invented",
        rawVariant: "high",
      },
    },
    latestTurn: {
      messageId: "msg_fixture_assistant_2",
      parentMessageId: "msg_fixture_user_2",
      createdAt: iso(1800000002100),
      completedAt: iso(1800000008000),
      finish: "stop",
    },
    earliestAssistantCwd: "/synthetic/kilo/project/root",
    latestAssistantCwd: "/synthetic/kilo/project/root/recent",
    sessionTokens: {
      input: 10,
      output: 4,
      reasoning: 1,
      cacheRead: 8,
      cacheWrite: 2,
    },
    unknownPartDiagnostics: [{
      kind: "invalid-record",
      table: "part",
      recordId: unknownPartId,
      detail: "part type is unknown or invalid and was skipped",
    }],
    transcriptTruncated: true,
    callSizes: undefined,
    callSizesComplete: false,
  });
  expect({
    assistantClosingPresent: Object.prototype.hasOwnProperty.call(root, "assistantClosing"),
    assistantClosing: root.assistantClosing,
  }).toEqual({
    assistantClosingPresent: false,
    assistantClosing: undefined,
  });
  expect({
    latestCallTokensPresent: Object.prototype.hasOwnProperty.call(root, "latestCallTokens"),
    latestCallTokens: root.latestCallTokens,
  }).toEqual({
    latestCallTokensPresent: false,
    latestCallTokens: undefined,
  });
});

test("V7-2 SQLite BINARY same-time order governs closing and usage authority", async () => {
  const path = await fixtureStore();
  const renamedFinishId = "Y_v7_same_time_finish";
  const renamedTextId = "Z_v7_same_time_text";
  const unknownPartId = "a_v7_same_time_unknown";
  const unknownType = "invented-v7-same-time-unknown";
  const sameCreatedAt = 1800000008000;
  const unknownData = JSON.stringify({ type: unknownType });
  let originalFinish: {
    rowId: number;
    id: string;
    idChars: number;
    messageId: string;
    partSessionId: string;
    messageSessionId: string;
    role: string;
    partCreatedAt: number;
    partUpdatedAt: number;
    dataValid: number;
    type: string;
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  } | null = null;
  openStore(path, (database) => {
    originalFinish = database.query(`
      SELECT
        part.rowid AS rowId,
        part.id,
        length(part.id) AS idChars,
        part.message_id AS messageId,
        part.session_id AS partSessionId,
        message.session_id AS messageSessionId,
        json_extract(message.data, '$.role') AS role,
        part.time_created AS partCreatedAt,
        part.time_updated AS partUpdatedAt,
        json_valid(part.data) AS dataValid,
        json_extract(part.data, '$.type') AS type,
        json_extract(part.data, '$.tokens.input') AS input,
        json_extract(part.data, '$.tokens.output') AS output,
        json_extract(part.data, '$.tokens.reasoning') AS reasoning,
        json_extract(part.data, '$.tokens.cache.read') AS cacheRead,
        json_extract(part.data, '$.tokens.cache.write') AS cacheWrite,
        json_extract(part.data, '$.tokens.total') AS total
      FROM part
      JOIN message ON message.id = part.message_id
      WHERE part.id = ?
    `).get("prt_fixture_assistant_2_finish") as typeof originalFinish;
    if (!originalFinish) throw new Error("native latest valid step-finish selection was empty");
    database.run(
      "UPDATE part SET id = ?, time_created = ?, time_updated = ? WHERE rowid = ?",
      [renamedFinishId, sameCreatedAt, sameCreatedAt, originalFinish.rowId],
    );
    database.run(
      "UPDATE part SET id = ?, time_created = ?, time_updated = ? WHERE id = ?",
      [renamedTextId, sameCreatedAt, sameCreatedAt, "prt_fixture_assistant_2_text"],
    );
    database.run(
      "INSERT INTO part(id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
      [
        unknownPartId,
        "msg_fixture_assistant_2",
        ROOT_SESSION_ID,
        sameCreatedAt,
        sameCreatedAt,
        unknownData,
      ],
    );
  });
  expect(originalFinish as unknown).toEqual({
    rowId: 9,
    id: "prt_fixture_assistant_2_finish",
    idChars: 30,
    messageId: "msg_fixture_assistant_2",
    partSessionId: ROOT_SESSION_ID,
    messageSessionId: ROOT_SESSION_ID,
    role: "assistant",
    partCreatedAt: sameCreatedAt,
    partUpdatedAt: sameCreatedAt,
    dataValid: 1,
    type: "step-finish",
    input: 4,
    output: 2,
    reasoning: 0,
    cacheRead: 1,
    cacheWrite: 0,
    total: 6,
  });

  const database = new Database(path, { readonly: true });
  try {
    const binaryIdOrder = database.query(`
      SELECT
        part.rowid AS rowId,
        part.id,
        length(part.id) AS idChars,
        part.message_id AS messageId,
        part.session_id AS partSessionId,
        message.session_id AS messageSessionId,
        message.time_created AS messageCreatedAt,
        json_extract(message.data, '$.role') AS role,
        part.time_created AS partCreatedAt,
        part.time_updated AS partUpdatedAt,
        json_valid(part.data) AS dataValid,
        length(part.data) AS dataChars,
        json_extract(part.data, '$.type') AS type,
        json_extract(part.data, '$.text') AS text,
        json_extract(part.data, '$.tokens.input') AS input,
        json_extract(part.data, '$.tokens.output') AS output,
        json_extract(part.data, '$.tokens.reasoning') AS reasoning,
        json_extract(part.data, '$.tokens.cache.read') AS cacheRead,
        json_extract(part.data, '$.tokens.cache.write') AS cacheWrite,
        json_extract(part.data, '$.tokens.total') AS total
      FROM part
      JOIN message ON message.id = part.message_id
      WHERE part.id IN (?, ?, ?)
      ORDER BY part.id COLLATE BINARY
    `).all(renamedFinishId, renamedTextId, unknownPartId);
    expect(binaryIdOrder).toEqual([
      {
        rowId: 9,
        id: renamedFinishId,
        idChars: 21,
        messageId: "msg_fixture_assistant_2",
        partSessionId: ROOT_SESSION_ID,
        messageSessionId: ROOT_SESSION_ID,
        messageCreatedAt: 1800000002100,
        role: "assistant",
        partCreatedAt: sameCreatedAt,
        partUpdatedAt: sameCreatedAt,
        dataValid: 1,
        dataChars: 135,
        type: "step-finish",
        text: null,
        input: 4,
        output: 2,
        reasoning: 0,
        cacheRead: 1,
        cacheWrite: 0,
        total: 6,
      },
      {
        rowId: 8,
        id: renamedTextId,
        idChars: 19,
        messageId: "msg_fixture_assistant_2",
        partSessionId: ROOT_SESSION_ID,
        messageSessionId: ROOT_SESSION_ID,
        messageCreatedAt: 1800000002100,
        role: "assistant",
        partCreatedAt: sameCreatedAt,
        partUpdatedAt: sameCreatedAt,
        dataValid: 1,
        dataChars: 72,
        type: "text",
        text: "Invented Kilo evidence is bounded and complete.",
        input: null,
        output: null,
        reasoning: null,
        cacheRead: null,
        cacheWrite: null,
        total: null,
      },
      {
        rowId: 10,
        id: unknownPartId,
        idChars: 22,
        messageId: "msg_fixture_assistant_2",
        partSessionId: ROOT_SESSION_ID,
        messageSessionId: ROOT_SESSION_ID,
        messageCreatedAt: 1800000002100,
        role: "assistant",
        partCreatedAt: sameCreatedAt,
        partUpdatedAt: sameCreatedAt,
        dataValid: 1,
        dataChars: 40,
        type: unknownType,
        text: null,
        input: null,
        output: null,
        reasoning: null,
        cacheRead: null,
        cacheWrite: null,
        total: null,
      },
    ]);
  } finally {
    database.close();
  }

  const evidence = readStoreForClaim(
    "SQLite BINARY native part-ID order makes the decoded unknown row authoritative",
    path,
    { sessionId: ROOT_SESSION_ID },
  );
  const root = rootSession(evidence);
  expect({
    storeIncomplete: evidence.incomplete,
    session: { provider: root.provider, sessionId: root.sessionId, slug: root.slug },
    firstTask: root.firstTask,
    firstUserText: root.firstUserText,
    retainedProse: root.prose.map(({ messageId, role, text }) => ({ messageId, role, text })),
    latestMessage: root.messages.at(-1),
    latestTurn: root.latestTurn,
    latestAssistantCwd: root.latestAssistantCwd,
    sessionTokens: root.sessionTokens,
    unknownPartDiagnostics: evidence.diagnostics.filter(({ recordId }) =>
      recordId === unknownPartId
    ),
    transcriptTruncated: root.transcriptTruncated,
    callSizes: root.callSizes,
    callSizesComplete: root.callSizesComplete,
  }).toEqual({
    storeIncomplete: false,
    session: { provider: "kilo", sessionId: ROOT_SESSION_ID, slug: "fixture-root" },
    firstTask: "Prove the invented Kilo V1 authority.",
    firstUserText: "Prove the invented Kilo V1 authority.",
    retainedProse: [
      {
        messageId: "msg_fixture_user_1",
        role: "user",
        text: "Prove the invented Kilo V1 authority.",
      },
      {
        messageId: "msg_fixture_assistant_1",
        role: "assistant",
        text: "The first invented Kilo pass preserves native IDs.",
      },
      {
        messageId: "msg_fixture_user_2",
        role: "user",
        text: "Confirm the final invented Kilo evidence.",
      },
      {
        messageId: "msg_fixture_assistant_2",
        role: "assistant",
        text: "Invented Kilo evidence is bounded and complete.",
      },
    ],
    latestMessage: {
      messageId: "msg_fixture_assistant_2",
      sessionId: ROOT_SESSION_ID,
      role: "assistant",
      createdAt: iso(1800000002100),
      completedAt: iso(1800000008000),
      parentMessageId: "msg_fixture_user_2",
      rawModel: {
        modelId: "model-invented",
        providerRoute: "provider-invented",
        rawVariant: "high",
      },
    },
    latestTurn: {
      messageId: "msg_fixture_assistant_2",
      parentMessageId: "msg_fixture_user_2",
      createdAt: iso(1800000002100),
      completedAt: iso(1800000008000),
      finish: "stop",
    },
    latestAssistantCwd: "/synthetic/kilo/project/root/recent",
    sessionTokens: {
      input: 10,
      output: 4,
      reasoning: 1,
      cacheRead: 8,
      cacheWrite: 2,
    },
    unknownPartDiagnostics: [{
      kind: "invalid-record",
      table: "part",
      recordId: unknownPartId,
      detail: "part type is unknown or invalid and was skipped",
    }],
    transcriptTruncated: true,
    callSizes: undefined,
    callSizesComplete: false,
  });
  expect({
    assistantClosingPresent: Object.prototype.hasOwnProperty.call(root, "assistantClosing"),
    assistantClosing: root.assistantClosing,
    latestCallTokensPresent: Object.prototype.hasOwnProperty.call(root, "latestCallTokens"),
    latestCallTokens: root.latestCallTokens,
  }).toEqual({
    assistantClosingPresent: false,
    assistantClosing: undefined,
    latestCallTokensPresent: false,
    latestCallTokens: undefined,
  });
});

test("V7-3 SQLite BINARY part-ID order selects the native-latest valid finish despite earlier time", async () => {
  const path = await fixtureStore();
  const latestFinishId = "prt_fixture_assistant_2_zz_v7_finish";
  const latestFinishCreatedAt = 1800000007950;
  const latestFinishData = JSON.stringify({
    type: "step-finish",
    reason: "stop",
    tokens: {
      total: 99,
      input: 90,
      output: 9,
      reasoning: 0,
      cache: { read: 8, write: 0 },
    },
  });
  openStore(path, (database) => {
    database.run(
      "INSERT INTO part(id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
      [
        latestFinishId,
        "msg_fixture_assistant_2",
        ROOT_SESSION_ID,
        latestFinishCreatedAt,
        latestFinishCreatedAt,
        latestFinishData,
      ],
    );
  });

  const database = new Database(path, { readonly: true });
  try {
    const binaryIdOrder = database.query(`
      SELECT
        part.rowid AS rowId,
        part.id,
        length(part.id) AS idChars,
        part.message_id AS messageId,
        part.session_id AS partSessionId,
        message.session_id AS messageSessionId,
        message.time_created AS messageCreatedAt,
        json_extract(message.data, '$.role') AS role,
        part.time_created AS partCreatedAt,
        part.time_updated AS partUpdatedAt,
        json_valid(part.data) AS dataValid,
        length(part.data) AS dataChars,
        json_extract(part.data, '$.type') AS type,
        json_extract(part.data, '$.text') AS text,
        json_extract(part.data, '$.tokens.input') AS input,
        json_extract(part.data, '$.tokens.output') AS output,
        json_extract(part.data, '$.tokens.reasoning') AS reasoning,
        json_extract(part.data, '$.tokens.cache.read') AS cacheRead,
        json_extract(part.data, '$.tokens.cache.write') AS cacheWrite,
        json_extract(part.data, '$.tokens.total') AS total
      FROM part
      JOIN message ON message.id = part.message_id
      WHERE part.id IN (?, ?, ?)
      ORDER BY part.id COLLATE BINARY
    `).all(
      "prt_fixture_assistant_2_text",
      "prt_fixture_assistant_2_finish",
      latestFinishId,
    );
    expect(binaryIdOrder).toEqual([
      {
        rowId: 9,
        id: "prt_fixture_assistant_2_finish",
        idChars: 30,
        messageId: "msg_fixture_assistant_2",
        partSessionId: ROOT_SESSION_ID,
        messageSessionId: ROOT_SESSION_ID,
        messageCreatedAt: 1800000002100,
        role: "assistant",
        partCreatedAt: 1800000008000,
        partUpdatedAt: 1800000008000,
        dataValid: 1,
        dataChars: 135,
        type: "step-finish",
        text: null,
        input: 4,
        output: 2,
        reasoning: 0,
        cacheRead: 1,
        cacheWrite: 0,
        total: 6,
      },
      {
        rowId: 8,
        id: "prt_fixture_assistant_2_text",
        idChars: 28,
        messageId: "msg_fixture_assistant_2",
        partSessionId: ROOT_SESSION_ID,
        messageSessionId: ROOT_SESSION_ID,
        messageCreatedAt: 1800000002100,
        role: "assistant",
        partCreatedAt: 1800000007900,
        partUpdatedAt: 1800000007900,
        dataValid: 1,
        dataChars: 72,
        type: "text",
        text: "Invented Kilo evidence is bounded and complete.",
        input: null,
        output: null,
        reasoning: null,
        cacheRead: null,
        cacheWrite: null,
        total: null,
      },
      {
        rowId: 10,
        id: latestFinishId,
        idChars: 36,
        messageId: "msg_fixture_assistant_2",
        partSessionId: ROOT_SESSION_ID,
        messageSessionId: ROOT_SESSION_ID,
        messageCreatedAt: 1800000002100,
        role: "assistant",
        partCreatedAt: latestFinishCreatedAt,
        partUpdatedAt: latestFinishCreatedAt,
        dataValid: 1,
        dataChars: 125,
        type: "step-finish",
        text: null,
        input: 90,
        output: 9,
        reasoning: 0,
        cacheRead: 8,
        cacheWrite: 0,
        total: 99,
      },
    ]);

    const conflictingTimestampOrder = database.query(`
      SELECT id, length(id) AS idChars, time_created AS partCreatedAt
      FROM part
      WHERE id IN (?, ?, ?)
      ORDER BY time_created, id COLLATE BINARY
    `).all(
      "prt_fixture_assistant_2_text",
      "prt_fixture_assistant_2_finish",
      latestFinishId,
    );
    expect(conflictingTimestampOrder).toEqual([
      { id: "prt_fixture_assistant_2_text", idChars: 28, partCreatedAt: 1800000007900 },
      { id: latestFinishId, idChars: 36, partCreatedAt: latestFinishCreatedAt },
      { id: "prt_fixture_assistant_2_finish", idChars: 30, partCreatedAt: 1800000008000 },
    ]);
  } finally {
    database.close();
  }

  const evidence = readStoreForClaim(
    "SQLite BINARY part-ID order makes the bounded 99-token step-finish native-latest",
    path,
    { sessionId: ROOT_SESSION_ID },
  );
  const root = rootSession(evidence);
  expect({
    storeIncomplete: evidence.incomplete,
    diagnostics: evidence.diagnostics,
    session: { provider: root.provider, sessionId: root.sessionId, slug: root.slug },
    firstTask: root.firstTask,
    firstUserText: root.firstUserText,
    retainedProse: root.prose.map(({ messageId, role, text }) => ({ messageId, role, text })),
    assistantClosing: root.assistantClosing,
    latestMessage: root.messages.at(-1),
    latestTurn: root.latestTurn,
    earliestAssistantCwd: root.earliestAssistantCwd,
    latestAssistantCwd: root.latestAssistantCwd,
    sessionTokens: root.sessionTokens,
    transcriptTruncated: root.transcriptTruncated,
    callSizes: root.callSizes,
    callSizesComplete: root.callSizesComplete,
  }).toEqual({
    storeIncomplete: false,
    diagnostics: [],
    session: { provider: "kilo", sessionId: ROOT_SESSION_ID, slug: "fixture-root" },
    firstTask: "Prove the invented Kilo V1 authority.",
    firstUserText: "Prove the invented Kilo V1 authority.",
    retainedProse: [
      {
        messageId: "msg_fixture_user_1",
        role: "user",
        text: "Prove the invented Kilo V1 authority.",
      },
      {
        messageId: "msg_fixture_assistant_1",
        role: "assistant",
        text: "The first invented Kilo pass preserves native IDs.",
      },
      {
        messageId: "msg_fixture_user_2",
        role: "user",
        text: "Confirm the final invented Kilo evidence.",
      },
      {
        messageId: "msg_fixture_assistant_2",
        role: "assistant",
        text: "Invented Kilo evidence is bounded and complete.",
      },
    ],
    assistantClosing: "Invented Kilo evidence is bounded and complete.",
    latestMessage: {
      messageId: "msg_fixture_assistant_2",
      sessionId: ROOT_SESSION_ID,
      role: "assistant",
      createdAt: iso(1800000002100),
      completedAt: iso(1800000008000),
      parentMessageId: "msg_fixture_user_2",
      rawModel: {
        modelId: "model-invented",
        providerRoute: "provider-invented",
        rawVariant: "high",
      },
    },
    latestTurn: {
      messageId: "msg_fixture_assistant_2",
      parentMessageId: "msg_fixture_user_2",
      createdAt: iso(1800000002100),
      completedAt: iso(1800000008000),
      finish: "stop",
    },
    earliestAssistantCwd: "/synthetic/kilo/project/root",
    latestAssistantCwd: "/synthetic/kilo/project/root/recent",
    sessionTokens: {
      input: 10,
      output: 4,
      reasoning: 1,
      cacheRead: 8,
      cacheWrite: 2,
    },
    transcriptTruncated: false,
    callSizes: [9, 6, 99],
    callSizesComplete: true,
  });
  expect(root.latestCallTokens).toEqual({
    input: 90,
    output: 9,
    reasoning: 0,
    cacheRead: 8,
    cacheWrite: 0,
    total: 99,
  });
});

test("32 invalid timestamps, counters and unknown records are omitted with diagnostics", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.run(
      "UPDATE session SET time_created = ?, tokens_input = ?, tokens_reasoning = ? WHERE id = ?",
      [-1, -2, 1.5, ROOT_SESSION_ID],
    );
    database.run(
      "UPDATE message SET data = ? WHERE id = ?",
      [JSON.stringify({ role: "invented-unknown" }), "msg_fixture_user_1"],
    );
    database.run(
      "UPDATE part SET data = ? WHERE id = ?",
      [JSON.stringify({ type: "invented-unknown" }), "prt_fixture_assistant_1_reasoning"],
    );
  });
  const evidence = readStoreForClaim(
    "invalid timestamps, counters, roles and part types are diagnosed and omitted",
    path,
  );
  const root = rootSession(evidence);
  expect(root.startedAt).toBeUndefined();
  expect(root.sessionTokens).toBeUndefined();
  expect(evidence.diagnostics).toContainEqual(expect.objectContaining({ kind: "invalid-record" }));
});

test("33 invalid latest step-finish falls back only to valid latest assistant message counters", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.run(
      "UPDATE part SET data = ? WHERE id = ?",
      [
        JSON.stringify({
          type: "step-finish",
          reason: "stop",
          tokens: { input: -1, output: 2, reasoning: 0, cache: { read: 1, write: 0 } },
        }),
        "prt_fixture_assistant_2_finish",
      ],
    );
  });
  const root = rootSession(readStoreForClaim(
    "invalid latest step-finish falls back to valid latest assistant message counters only",
    path,
  ));
  expect(root.latestCallTokens).toEqual({
    input: 4,
    output: 2,
    reasoning: 0,
    cacheRead: 1,
    cacheWrite: 0,
    total: 6,
  });
  expect(root.callSizes).toBeUndefined();
  expect(root.callSizesComplete).toBe(false);
});

test("33a valid latest step-finish overrides contradictory valid latest assistant message counters", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.run(
      "UPDATE message SET data = json_set(data, '$.tokens', json(?)) WHERE id = ?",
      [
        JSON.stringify({
          total: 8,
          input: 7,
          output: 1,
          reasoning: 0,
          cache: { read: 2, write: 0 },
        }),
        "msg_fixture_assistant_2",
      ],
    );
  });
  const root = rootSession(readStoreForClaim(
    "valid latest step-finish overrides contradictory valid latest assistant message counters",
    path,
  ));
  expect(root.latestCallTokens).toEqual({
    input: 4,
    output: 2,
    reasoning: 0,
    cacheRead: 1,
    cacheWrite: 0,
    total: 6,
  });
  expect(root.latestCallTokens).not.toEqual({
    input: 7,
    output: 1,
    reasoning: 0,
    cacheRead: 2,
    cacheWrite: 0,
    total: 8,
  });
  expect(root.callSizes).toEqual([9, 6]);
  expect(root.callSizesComplete).toBe(true);
});

test("33e optional step-finish total stays absent without invalidating valid split counters", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.run(
      "UPDATE part SET data = json_remove(data, '$.tokens.total') WHERE id = ?",
      ["prt_fixture_assistant_2_finish"],
    );
  });
  const evidence = readStoreForClaim(
    "optional step-finish total does not invalidate complete split counters",
    path,
  );
  const root = rootSession(evidence);
  expect({
    latestCallTokens: root.latestCallTokens,
    latestCallTokensHasTotal: root.latestCallTokens
      ? "total" in root.latestCallTokens
      : undefined,
    callSizes: root.callSizes,
    callSizesComplete: root.callSizesComplete,
    invalidPartDiagnostic: evidence.diagnostics.some(({ kind, table, recordId }) =>
      kind === "invalid-record" && table === "part" &&
      recordId === "prt_fixture_assistant_2_finish"
    ),
  }).toEqual({
    latestCallTokens: {
      input: 4,
      output: 2,
      reasoning: 0,
      cacheRead: 1,
      cacheWrite: 0,
    },
    latestCallTokensHasTotal: false,
    callSizes: undefined,
    callSizesComplete: false,
    invalidPartDiagnostic: false,
  });
});

test("33d an invalid newest step-finish falls back instead of retaining an earlier valid part", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.run(
      "UPDATE part SET data = ? WHERE id = ?",
      [
        JSON.stringify({
          type: "step-finish",
          reason: "stop",
          tokens: {
            total: 77,
            input: 70,
            output: 7,
            reasoning: 0,
            cache: { read: 6, write: 0 },
          },
        }),
        "prt_fixture_assistant_2_finish",
      ],
    );
    database.run(
      "INSERT INTO part(id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
      [
        "prt_fixture_assistant_2_zz_invalid_finish",
        "msg_fixture_assistant_2",
        ROOT_SESSION_ID,
        1800000008200,
        1800000008200,
        JSON.stringify({
          type: "step-finish",
          reason: "stop",
          tokens: { input: -1, output: 3, reasoning: 0, cache: { read: 1, write: 0 } },
        }),
      ],
    );
  });
  const evidence = readStoreForClaim(
    "the newest step-finish controls and invalid newest usage falls back to message counters",
    path,
  );
  const root = rootSession(evidence);
  expect({
    latestCallTokens: root.latestCallTokens,
    callSizes: root.callSizes,
    callSizesComplete: root.callSizesComplete,
    invalidNewestDiagnostic: evidence.diagnostics.some(({ kind, table, recordId }) =>
      kind === "invalid-record" && table === "part" &&
      recordId === "prt_fixture_assistant_2_zz_invalid_finish"
    ),
  }).toEqual({
    latestCallTokens: {
      input: 4,
      output: 2,
      reasoning: 0,
      cacheRead: 1,
      cacheWrite: 0,
      total: 6,
    },
    callSizes: undefined,
    callSizesComplete: false,
    invalidNewestDiagnostic: true,
  });
});

test("33c part truncation cannot promote contradictory message usage over an omitted step-finish", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.run(
      "UPDATE message SET data = json_set(data, '$.tokens', json(?)) WHERE id = ?",
      [
        JSON.stringify({
          total: 8,
          input: 7,
          output: 1,
          reasoning: 0,
          cache: { read: 2, write: 0 },
        }),
        "msg_fixture_assistant_2",
      ],
    );
  });
  const root = rootSession(readStoreForClaim(
    "known part truncation keeps latest-call usage unavailable when step-finish may be omitted",
    path,
    { sessionId: ROOT_SESSION_ID, partLimit: 5 },
  ));
  expect({
    latestCallTokens: root.latestCallTokens,
    callSizes: root.callSizes,
  }).toEqual({
    latestCallTokens: undefined,
    callSizes: undefined,
  });
});

test("33b latest-call counters stay undefined when message and step-finish sources are absent", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.run(
      "UPDATE message SET data = ? WHERE id = ?",
      [
        JSON.stringify({
          role: "assistant",
          time: { created: 1800000002100, completed: 1800000008000 },
          parentID: "msg_fixture_user_2",
          modelID: "model-invented",
          providerID: "provider-invented",
          mode: "build",
          agent: "build",
          path: {
            cwd: "/synthetic/kilo/project/root/recent",
            root: "/synthetic/kilo/project",
          },
          variant: "high",
          finish: "stop",
        }),
        "msg_fixture_assistant_2",
      ],
    );
    database.run("DELETE FROM part WHERE id = ?", ["prt_fixture_assistant_2_finish"]);
  });
  const root = rootSession(readStoreForClaim(
    "latest-call counters remain undefined when both native latest sources are absent",
    path,
  ));
  expect(root.latestCallTokens).toBeUndefined();
  expect(root.callSizes).toBeUndefined();
  expect(root.callSizesComplete).toBe(false);
});

test("34 an already-expired deadline returns no invented rows and names unenumerated Kilo work", async () => {
  const evidence = readStoreForClaim(
    "expired Kilo deadline reports unenumerated population without invented rows",
    await fixtureStore(),
    { deadlineAtMs: 10, nowMs: () => 10 },
  );
  expect(evidence.sessions).toEqual([]);
  expect(evidence.incomplete).toBe(true);
  expect(evidence.diagnostics).toContainEqual(expect.objectContaining({
    kind: "deadline",
    table: "store",
    detail: expect.stringMatching(/Kilo.*not enumerated|unenumerated.*Kilo/i),
  }));
});

test("35 in-flight deadline preserves an accepted prefix and reports the unenumerated remainder", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    for (let index = 0; index < 12; index += 1) insertSyntheticSession(database, index);
  });
  let checks = 0;
  const evidence = readStoreForClaim(
    "in-flight deadline keeps only the already-decoded Kilo prefix",
    path,
    { deadlineAtMs: 10, nowMs: () => checks++ < 6 ? 0 : 10 },
  );
  expect(evidence.sessions.length).toBeGreaterThan(0);
  expect(evidence.sessions.length).toBeLessThan(16);
  expect(evidence.incomplete).toBe(true);
  expect(evidence.diagnostics).toContainEqual(expect.objectContaining({ kind: "deadline" }));
});

test("35a expiry during the selected-part query rejects the unfinished session", async () => {
  const path = await fixtureStore();
  const descriptor = Object.getOwnPropertyDescriptor(Database.prototype, "query");
  if (!descriptor || typeof descriptor.value !== "function") {
    throw new Error("bun:sqlite Database.query is unavailable for selected-part deadline control");
  }
  const original = descriptor.value as (...args: unknown[]) => unknown;
  let expired = false;
  let selectedPartQueries = 0;
  Object.defineProperty(Database.prototype, "query", {
    ...descriptor,
    value: function (this: Database, ...args: unknown[]) {
      const result = Reflect.apply(original, this, args);
      const sql = String(args[0] ?? "");
      if (/\bFROM\s+part\b[\s\S]*\bWHERE\s+rowid\s+IN\s*\(/i.test(sql)) {
        selectedPartQueries += 1;
        expired = true;
      }
      return result;
    },
  });
  let evidence: KiloStoreEvidence;
  try {
    evidence = readStoreForClaim(
      "expiry during the final bounded selected-part query rejects the unfinished session",
      path,
      { sessionId: ROOT_SESSION_ID, deadlineAtMs: 10, nowMs: () => expired ? 10 : 0 },
    );
  } finally {
    Object.defineProperty(Database.prototype, "query", descriptor);
  }
  expect({
    sessions: evidence.sessions,
    incomplete: evidence.incomplete,
    deadlineDiagnostics: evidence.diagnostics.filter(({ kind }) => kind === "deadline"),
    selectedPartQueries,
  }).toEqual({
    sessions: [],
    incomplete: true,
    deadlineDiagnostics: [expect.objectContaining({
      kind: "deadline",
      table: "store",
    })],
    selectedPartQueries: 1,
  });
});

test("35c expiry after the first part boundary prevents all later part SQL", async () => {
  const path = await fixtureStore();
  const descriptor = Object.getOwnPropertyDescriptor(Database.prototype, "query");
  if (!descriptor || typeof descriptor.value !== "function") {
    throw new Error("bun:sqlite Database.query is unavailable for part-boundary deadline control");
  }
  const original = descriptor.value as (...args: unknown[]) => unknown;
  let expired = false;
  let boundaryQueriesCreated = 0;
  const partSql: string[] = [];
  Object.defineProperty(Database.prototype, "query", {
    ...descriptor,
    value: function (this: Database, ...args: unknown[]) {
      const result = Reflect.apply(original, this, args);
      const sql = String(args[0] ?? "");
      if (/\bFROM\s+part\b/i.test(sql)) {
        partSql.push(sql);
        if (/\bWHERE\s+message_id\s*=\s*\?/i.test(sql)) {
          boundaryQueriesCreated += 1;
          if (boundaryQueriesCreated === 1) expired = true;
        }
      }
      return result;
    },
  });
  let evidence: KiloStoreEvidence;
  try {
    evidence = readStoreForClaim(
      "expiry after the first real part boundary stops later SQL and rejects the session",
      path,
      { sessionId: ROOT_SESSION_ID, deadlineAtMs: 10, nowMs: () => expired ? 10 : 0 },
    );
  } finally {
    Object.defineProperty(Database.prototype, "query", descriptor);
  }
  const boundaryDirections = partSql.flatMap((sql) => {
    const match = sql.match(/\bORDER\s+BY\s+id\s+(ASC|DESC)\b/i);
    return match?.[1] ? [match[1].toUpperCase()] : [];
  });
  expect({
    partQueriesStarted: partSql.length,
    boundaryDirections,
    finalPartQueries: partSql.filter((sql) =>
      /\bWHERE\s+rowid\s+IN\s*\(/i.test(sql)
    ).length,
    sessions: evidence.sessions,
    incomplete: evidence.incomplete,
    deadlineDiagnostics: evidence.diagnostics.filter(({ kind }) => kind === "deadline"),
  }).toEqual({
    partQueriesStarted: 1,
    boundaryDirections: ["ASC"],
    finalPartQueries: 0,
    sessions: [],
    incomplete: true,
    deadlineDiagnostics: [{
      kind: "deadline",
      table: "store",
      detail: "Kilo store deadline expired with remaining population not enumerated",
    }],
  });
});

test("35b expiry during the first bounded decode preserves only that completed session", async () => {
  const path = await fixtureStore();
  const database = new Database(path, { readonly: true });
  const first = database.query(
    "SELECT id FROM session ORDER BY time_updated DESC, id DESC LIMIT 1",
  ).get() as { id: string };
  database.close();

  const descriptor = Object.getOwnPropertyDescriptor(JSON, "parse");
  if (!descriptor || typeof descriptor.value !== "function") {
    throw new Error("JSON.parse is unavailable for bounded-decode deadline control");
  }
  const original = descriptor.value as (text: string) => unknown;
  let expired = false;
  let decodeCalls = 0;
  Object.defineProperty(JSON, "parse", {
    ...descriptor,
    value(text: string): unknown {
      const parsed = original(text);
      decodeCalls += 1;
      if (decodeCalls === 1) expired = true;
      return parsed;
    },
  });
  let evidence: KiloStoreEvidence;
  try {
    evidence = readStoreForClaim(
      "expiry during one bounded session decode preserves that complete prefix only",
      path,
      { deadlineAtMs: 10, nowMs: () => expired ? 10 : 0 },
    );
  } finally {
    Object.defineProperty(JSON, "parse", descriptor);
  }
  expect({
    sessionIds: evidence.sessions.map(({ sessionId }) => sessionId),
    incomplete: evidence.incomplete,
    deadlineDiagnostics: evidence.diagnostics.filter(({ kind }) => kind === "deadline"),
    decodeStarted: decodeCalls > 0,
  }).toEqual({
    sessionIds: [first.id],
    incomplete: true,
    deadlineDiagnostics: [expect.objectContaining({
      kind: "deadline",
      table: "store",
    })],
    decodeStarted: true,
  });
});

test("36 real cross-process overlapping readers leave main, WAL and SHM fingerprints unchanged", async () => {
  const path = await fixtureStore();
  const writer = new Database(path);
  try {
    writer.query("PRAGMA journal_mode = WAL").get();
    writer.exec("PRAGMA wal_autocheckpoint = 0");
    writer.run(
      "UPDATE session SET time_updated = ? WHERE id = ?",
      [1800000011000, ROOT_SESSION_ID],
    );
    readStoreForClaim(
      "four synchronized Kilo readers must prove measured cross-process overlap",
      path,
    );

    const before = await storeFingerprints(path);
    const parserUrl = new URL("../src/server/kilo-store.ts", import.meta.url).href;
    const startSignal = `${path}.readers-start`;
    const readerCount = 4;
    const repeatedReads = 24;
    const readyPaths = Array.from(
      { length: readerCount },
      (_, index) => `${path}.reader-${index}.ready`,
    );
    const childSource = `
      import { existsSync, writeFileSync } from "node:fs";

      const storePath = process.env.KILO_STORE_PATH;
      const parserUrl = process.env.KILO_PARSER_URL;
      const readyPath = process.env.KILO_READY_PATH;
      const startSignal = process.env.KILO_START_SIGNAL;
      const readerIndex = Number(process.env.KILO_READER_INDEX);
      const repeatedReads = Number(process.env.KILO_REPEATED_READS);
      if (!storePath || !parserUrl || !readyPath || !startSignal) {
        throw new Error("missing synchronized Kilo reader environment");
      }

      const { readKiloStore } = await import(parserUrl);
      writeFileSync(readyPath, "ready");
      const waitDeadline = Date.now() + 4_000;
      while (!existsSync(startSignal)) {
        if (Date.now() >= waitDeadline) throw new Error("Kilo reader start barrier timed out");
        await Bun.sleep(2);
      }

      const now = () => performance.timeOrigin + performance.now();
      const readIntervals = [];
      const sessionIdsByRead = [];
      let canonicalEvidence;
      let firstEvidence;
      let sameEvidence = true;
      for (let index = 0; index < repeatedReads; index += 1) {
        const startedAt = now();
        const evidence = readKiloStore(storePath);
        const endedAt = now();
        readIntervals.push({ startedAt, endedAt });
        sessionIdsByRead.push(evidence.sessions.map(({ sessionId }) => sessionId).sort());
        const serialized = JSON.stringify(evidence);
        if (canonicalEvidence === undefined) canonicalEvidence = serialized;
        else if (serialized !== canonicalEvidence) sameEvidence = false;
        if (firstEvidence === undefined) firstEvidence = evidence;
      }

      firstEvidence.sessions.splice(0);
      const detachedStartedAt = now();
      const detachedEvidence = readKiloStore(storePath);
      const detachedEndedAt = now();
      readIntervals.push({ startedAt: detachedStartedAt, endedAt: detachedEndedAt });
      sessionIdsByRead.push(detachedEvidence.sessions.map(({ sessionId }) => sessionId).sort());
      const detached = JSON.stringify(detachedEvidence) === canonicalEvidence;

      process.stdout.write(JSON.stringify({
        readerIndex,
        readIntervals,
        sessionIdsByRead,
        sameEvidence,
        detached,
        startedAt: readIntervals[0].startedAt,
        endedAt: readIntervals[readIntervals.length - 1].endedAt,
      }));
    `;
    const readers = readyPaths.map((readyPath, index) => Bun.spawn(
      [process.execPath, "-e", childSource],
      {
        env: {
          ...process.env,
          KILO_STORE_PATH: path,
          KILO_PARSER_URL: parserUrl,
          KILO_READY_PATH: readyPath,
          KILO_START_SIGNAL: startSignal,
          KILO_READER_INDEX: String(index),
          KILO_REPEATED_READS: String(repeatedReads),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    ));

    const readyDeadline = Date.now() + 3_000;
    let allReady = false;
    while (Date.now() < readyDeadline) {
      const readyFingerprints = await Promise.all(readyPaths.map(fingerprint));
      if (readyFingerprints.every((value) => value !== undefined)) {
        allReady = true;
        break;
      }
      await Bun.sleep(2);
    }
    await writeFile(startSignal, "start");

    const completed = await Promise.all(readers.map(async (reader) => {
      const [exitCode, stdout, stderr] = await Promise.all([
        reader.exited,
        new Response(reader.stdout).text(),
        new Response(reader.stderr).text(),
      ]);
      return { exitCode, stdout, stderr: stderr.trim() };
    }));
    expect(allReady).toBe(true);
    expect(completed.map(({ exitCode, stderr }) => ({ exitCode, stderr }))).toEqual(
      Array.from({ length: readerCount }, () => ({ exitCode: 0, stderr: "" })),
    );

    interface ReaderResult {
      readerIndex: number;
      readIntervals: Array<{ startedAt: number; endedAt: number }>;
      sessionIdsByRead: string[][];
      sameEvidence: boolean;
      detached: boolean;
      startedAt: number;
      endedAt: number;
    }
    const results = completed
      .map(({ stdout }) => JSON.parse(stdout) as ReaderResult)
      .sort((left, right) => left.readerIndex - right.readerIndex);
    const expectedSessionIds = [
      ARCHIVED_SESSION_ID,
      CHILD_SESSION_ID,
      "ses_fixture_placeholder",
      ROOT_SESSION_ID,
    ].sort();
    const expectedSerialized = JSON.stringify(expectedSessionIds);
    expect(results.map((result) => ({
      readerIndex: result.readerIndex,
      readCount: result.readIntervals.length,
      monotonicIntervals: result.readIntervals.every((interval, index, intervals) =>
        interval.startedAt <= interval.endedAt &&
        (index === 0 || intervals[index - 1]!.endedAt <= interval.startedAt)
      ),
      allReadsSawExactSessions: result.sessionIdsByRead.every(
        (sessionIds) => JSON.stringify(sessionIds) === expectedSerialized,
      ),
      sameEvidence: result.sameEvidence,
      detached: result.detached,
    }))).toEqual(Array.from({ length: readerCount }, (_, readerIndex) => ({
      readerIndex,
      readCount: repeatedReads + 1,
      monotonicIntervals: true,
      allReadsSawExactSessions: true,
      sameEvidence: true,
      detached: true,
    })));

    const commonLifetimeOverlap = Math.min(...results.map(({ endedAt }) => endedAt)) -
      Math.max(...results.map(({ startedAt }) => startedAt));
    const overlappingReadPair = results.some((left, leftIndex) =>
      results.slice(leftIndex + 1).some((right) =>
        left.readIntervals.some((leftInterval) =>
          right.readIntervals.some((rightInterval) =>
            Math.max(leftInterval.startedAt, rightInterval.startedAt) <
              Math.min(leftInterval.endedAt, rightInterval.endedAt)
          )
        )
      )
    );
    expect({
      commonReaderLifetimeOverlap: commonLifetimeOverlap > 0,
      overlappingReadPair,
    }).toEqual({
      commonReaderLifetimeOverlap: true,
      overlappingReadPair: true,
    });
    expect(await storeFingerprints(path)).toEqual(before);
  } finally {
    writer.close();
  }
});

test("37 parser runtime refuses mutation and leaves store plus sidecars byte-state unchanged", async () => {
  const path = await fixtureStore();
  const writer = new Database(path);
  try {
    writer.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0");
    const before = await storeFingerprints(path);
    const session = rootSession(readStoreForClaim(
      "Kilo parser performs no write, chmod, checkpoint or preflight mutation",
      path,
    ));
    expect(session.sessionId).toBe(ROOT_SESSION_ID);
    expect(await storeFingerprints(path)).toEqual(before);
  } finally {
    writer.close();
  }
});

test("38 every Kilo data-dir result names only readable synthetic store paths", async () => {
  const dataDir = await temporaryDirectory("formic-kilo-filenames-");
  await fixtureStore("kilo-beta.db", dataDir);
  const result = readDirForClaim(
    "Kilo filename discovery returns bounded explicit store evidence",
    dataDir,
  );
  expect(result.absent).toBe(false);
  expect(result.errors).toEqual([]);
  expect(result.stores).toHaveLength(1);
  expect(result.stores[0]?.path).toBe(join(dataDir, "kilo-beta.db"));
  expect(await readdir(dataDir)).toEqual(expect.arrayContaining(["kilo-beta.db"]));
});

test("V7-4 SQLite BINARY nontrailing unknown preserves closing and usage authority", async () => {
  const path = await fixtureStore();
  const unknownPartId = "prt_fixture_assistant_2_aa_v7_nontrailing_unknown";
  const unknownType = "invented-v7-nontrailing-id-unknown";
  const unknownCreatedAt = 1800000008100;
  openStore(path, (database) => {
    database.run(
      "UPDATE part SET data = ? WHERE id = ?",
      [
        JSON.stringify({
          type: "step-finish",
          reason: "stop",
          cost: 7.78,
          tokens: {
            total: 77,
            input: 70,
            output: 7,
            reasoning: 0,
            cache: { read: 6, write: 0 },
          },
        }),
        "prt_fixture_assistant_2_finish",
      ],
    );
    database.run(
      "INSERT INTO part(id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
      [
        unknownPartId,
        "msg_fixture_assistant_2",
        ROOT_SESSION_ID,
        unknownCreatedAt,
        unknownCreatedAt,
        JSON.stringify({ type: unknownType }),
      ],
    );
  });

  const database = new Database(path, { readonly: true });
  try {
    const binaryIdOrder = database.query(`
      SELECT
        id,
        time_created AS partCreatedAt,
        json_valid(data) AS dataValid,
        json_extract(data, '$.type') AS type,
        json_extract(data, '$.text') AS text,
        json_extract(data, '$.tokens.total') AS total
      FROM part
      WHERE message_id = ? AND id IN (?, ?, ?)
      ORDER BY id COLLATE BINARY
    `).all(
      "msg_fixture_assistant_2",
      unknownPartId,
      "prt_fixture_assistant_2_finish",
      "prt_fixture_assistant_2_text",
    );
    expect(binaryIdOrder).toEqual([
      {
        id: unknownPartId,
        partCreatedAt: unknownCreatedAt,
        dataValid: 1,
        type: unknownType,
        text: null,
        total: null,
      },
      {
        id: "prt_fixture_assistant_2_finish",
        partCreatedAt: 1800000008000,
        dataValid: 1,
        type: "step-finish",
        text: null,
        total: 77,
      },
      {
        id: "prt_fixture_assistant_2_text",
        partCreatedAt: 1800000007900,
        dataValid: 1,
        type: "text",
        text: "Invented Kilo evidence is bounded and complete.",
        total: null,
      },
    ]);

    const conflictingTimestampOrder = database.query(`
      SELECT id, time_created AS partCreatedAt
      FROM part
      WHERE message_id = ? AND id IN (?, ?, ?)
      ORDER BY time_created, id COLLATE BINARY
    `).all(
      "msg_fixture_assistant_2",
      unknownPartId,
      "prt_fixture_assistant_2_finish",
      "prt_fixture_assistant_2_text",
    );
    expect(conflictingTimestampOrder).toEqual([
      { id: "prt_fixture_assistant_2_text", partCreatedAt: 1800000007900 },
      { id: "prt_fixture_assistant_2_finish", partCreatedAt: 1800000008000 },
      { id: unknownPartId, partCreatedAt: unknownCreatedAt },
    ]);
  } finally {
    database.close();
  }

  const evidence = readStoreForClaim(
    "a BINARY-nontrailing decoded unknown keeps later native closing and usage authority",
    path,
    { sessionId: ROOT_SESSION_ID },
  );
  const root = rootSession(evidence);
  expect({
    storeIncomplete: evidence.incomplete,
    session: { provider: root.provider, sessionId: root.sessionId, slug: root.slug },
    latestMessage: root.messages.at(-1),
    retainedProse: root.prose.map(({ messageId, role, text }) => ({ messageId, role, text })),
    assistantClosing: root.assistantClosing,
    latestCallTokens: root.latestCallTokens,
    unknownPartDiagnostics: evidence.diagnostics.filter(({ recordId }) =>
      recordId === unknownPartId
    ),
    transcriptTruncated: root.transcriptTruncated,
    callSizes: root.callSizes,
    callSizesComplete: root.callSizesComplete,
  }).toEqual({
    storeIncomplete: false,
    session: { provider: "kilo", sessionId: ROOT_SESSION_ID, slug: "fixture-root" },
    latestMessage: {
      messageId: "msg_fixture_assistant_2",
      sessionId: ROOT_SESSION_ID,
      role: "assistant",
      createdAt: iso(1800000002100),
      completedAt: iso(1800000008000),
      parentMessageId: "msg_fixture_user_2",
      rawModel: {
        modelId: "model-invented",
        providerRoute: "provider-invented",
        rawVariant: "high",
      },
    },
    retainedProse: [
      {
        messageId: "msg_fixture_user_1",
        role: "user",
        text: "Prove the invented Kilo V1 authority.",
      },
      {
        messageId: "msg_fixture_assistant_1",
        role: "assistant",
        text: "The first invented Kilo pass preserves native IDs.",
      },
      {
        messageId: "msg_fixture_user_2",
        role: "user",
        text: "Confirm the final invented Kilo evidence.",
      },
      {
        messageId: "msg_fixture_assistant_2",
        role: "assistant",
        text: "Invented Kilo evidence is bounded and complete.",
      },
    ],
    assistantClosing: "Invented Kilo evidence is bounded and complete.",
    latestCallTokens: {
      input: 70,
      output: 7,
      reasoning: 0,
      cacheRead: 6,
      cacheWrite: 0,
      total: 77,
    },
    unknownPartDiagnostics: [{
      kind: "invalid-record",
      table: "part",
      recordId: unknownPartId,
      detail: "part type is unknown or invalid and was skipped",
    }],
    transcriptTruncated: true,
    callSizes: undefined,
    callSizesComplete: false,
  });
});

test("V7-5 SQLite BINARY same-time message-ID order governs first user authority", async () => {
  const path = await fixtureStore();
  const sessionId = "ses_v7_same_time_message_binary";
  const binaryFirstMessageId = "msg_v7_A_same_time_user";
  const localeFirstMessageId = "msg_v7_a_same_time_user";
  const binaryFirstPartId = "prt_v7_binary_first_user_text";
  const localeFirstPartId = "prt_v7_locale_first_user_text";
  const binaryFirstText = "BINARY-first invented user task.";
  const localeFirstText = "Locale-first invented user task.";
  const sameMessageCreatedAt = 1800000020000;
  const samePartCreatedAt = 1800000020001;
  openStore(path, (database) => {
    database.run(
      "INSERT INTO session(id, project_id, slug, directory, path, title, version, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        sessionId,
        "prj_fixture",
        "v7-same-time-message-binary",
        "/synthetic/kilo/project/v7-message-order",
        "v7-message-order",
        "Invented same-time message order",
        "synthetic",
        1800000019000,
        1800000021000,
      ],
    );
    for (const messageId of [binaryFirstMessageId, localeFirstMessageId]) {
      database.run(
        "INSERT INTO message(id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
        [
          messageId,
          sessionId,
          sameMessageCreatedAt,
          sameMessageCreatedAt,
          JSON.stringify({
            role: "user",
            time: { created: sameMessageCreatedAt },
            agent: "build",
            model: {
              providerID: "provider-invented",
              modelID: "model-invented",
              variant: "high",
            },
          }),
        ],
      );
    }
    for (const [partId, messageId, text] of [
      [binaryFirstPartId, binaryFirstMessageId, binaryFirstText],
      [localeFirstPartId, localeFirstMessageId, localeFirstText],
    ]) {
      database.run(
        "INSERT INTO part(id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
        [
          partId,
          messageId,
          sessionId,
          samePartCreatedAt,
          samePartCreatedAt,
          JSON.stringify({ type: "text", text }),
        ],
      );
    }
  });

  const database = new Database(path, { readonly: true });
  try {
    const binaryMessageOrder = database.query(`
      SELECT
        message.id AS messageId,
        length(message.id) AS messageIdChars,
        message.session_id AS messageSessionId,
        message.time_created AS messageCreatedAt,
        json_valid(message.data) AS messageDataValid,
        json_extract(message.data, '$.role') AS role,
        part.id AS partId,
        part.session_id AS partSessionId,
        part.time_created AS partCreatedAt,
        json_valid(part.data) AS partDataValid,
        json_extract(part.data, '$.type') AS partType,
        json_extract(part.data, '$.text') AS text
      FROM message
      JOIN part ON part.message_id = message.id
      WHERE message.session_id = ?
      ORDER BY message.time_created, message.id COLLATE BINARY
    `).all(sessionId);
    expect(binaryMessageOrder).toEqual([
      {
        messageId: binaryFirstMessageId,
        messageIdChars: 23,
        messageSessionId: sessionId,
        messageCreatedAt: sameMessageCreatedAt,
        messageDataValid: 1,
        role: "user",
        partId: binaryFirstPartId,
        partSessionId: sessionId,
        partCreatedAt: samePartCreatedAt,
        partDataValid: 1,
        partType: "text",
        text: binaryFirstText,
      },
      {
        messageId: localeFirstMessageId,
        messageIdChars: 23,
        messageSessionId: sessionId,
        messageCreatedAt: sameMessageCreatedAt,
        messageDataValid: 1,
        role: "user",
        partId: localeFirstPartId,
        partSessionId: sessionId,
        partCreatedAt: samePartCreatedAt,
        partDataValid: 1,
        partType: "text",
        text: localeFirstText,
      },
    ]);
  } finally {
    database.close();
  }

  expect({
    binaryFirstComparedToLocaleFirst: binaryFirstMessageId.localeCompare(localeFirstMessageId),
    runtimeLocaleOrder: [binaryFirstMessageId, localeFirstMessageId].sort((left, right) =>
      left.localeCompare(right)
    ),
  }).toEqual({
    binaryFirstComparedToLocaleFirst: 1,
    runtimeLocaleOrder: [localeFirstMessageId, binaryFirstMessageId],
  });

  const evidence = readStoreForClaim(
    "SQLite BINARY same-time message-ID order controls attributed prose and first-user authority",
    path,
    { sessionId },
  );
  const session = evidence.sessions.find((candidate) => candidate.sessionId === sessionId);
  expect(session, "the sanitized same-time native session must be published").toBeDefined();
  expect({
    storeIncomplete: evidence.incomplete,
    storeAbsent: evidence.absent,
    diagnostics: evidence.diagnostics,
    identity: {
      provider: session?.provider,
      sessionId: session?.sessionId,
      slug: session?.slug,
    },
    firstTask: session?.firstTask,
    firstUserText: session?.firstUserText,
    messages: session?.messages,
    attributedProse: session?.prose.map(
      ({ messageId, partId, role, text }) => ({ messageId, partId, role, text }),
    ),
    assistantClosingPresent: Object.prototype.hasOwnProperty.call(
      session ?? {},
      "assistantClosing",
    ),
    latestTurnPresent: Object.prototype.hasOwnProperty.call(session ?? {}, "latestTurn"),
    latestCallTokensPresent: Object.prototype.hasOwnProperty.call(
      session ?? {},
      "latestCallTokens",
    ),
    callSizesPresent: Object.prototype.hasOwnProperty.call(session ?? {}, "callSizes"),
    callSizesComplete: session?.callSizesComplete,
    transcriptTruncated: session?.transcriptTruncated,
  }).toEqual({
    storeIncomplete: false,
    storeAbsent: false,
    diagnostics: [],
    identity: {
      provider: "kilo",
      sessionId,
      slug: "v7-same-time-message-binary",
    },
    firstTask: binaryFirstText,
    firstUserText: binaryFirstText,
    messages: [
      {
        messageId: binaryFirstMessageId,
        sessionId,
        role: "user",
        createdAt: iso(sameMessageCreatedAt),
      },
      {
        messageId: localeFirstMessageId,
        sessionId,
        role: "user",
        createdAt: iso(sameMessageCreatedAt),
      },
    ],
    attributedProse: [
      {
        messageId: binaryFirstMessageId,
        partId: binaryFirstPartId,
        role: "user",
        text: binaryFirstText,
      },
      {
        messageId: localeFirstMessageId,
        partId: localeFirstPartId,
        role: "user",
        text: localeFirstText,
      },
    ],
    assistantClosingPresent: false,
    latestTurnPresent: false,
    latestCallTokensPresent: false,
    callSizesPresent: false,
    callSizesComplete: false,
    transcriptTruncated: false,
  });
});

test("V7-6 SQLite BINARY part-ID order governs bounded selected-part admission", async () => {
  const path = await fixtureStore();
  const sessionId = "ses_v7_bounded_part_binary";
  const messageId = "msg_v7_bounded_part_binary";
  const partLimit = 2;
  const sameCreatedAt = 1800000030000;
  const binaryFirstId = "prt_v7_bound_A";
  const binaryRankTwoId = "prt_v7_bound_B";
  const localeRankTwoId = "prt_v7_bound_a";
  const binaryLastId = "prt_v7_bound_z";
  const binaryFirstText = "Invented fixed A boundary prose.";
  const binaryRankTwoText = "Invented BINARY-admitted B prose.";
  const localeRankTwoText = "Invented locale-only a prose.";
  const binaryLastText = "Invented fixed z boundary prose.";
  const insertedParts = [
    [binaryLastId, binaryLastText],
    [localeRankTwoId, localeRankTwoText],
    [binaryFirstId, binaryFirstText],
    [binaryRankTwoId, binaryRankTwoText],
  ] as const;

  openStore(path, (database) => {
    database.run(
      "INSERT INTO session(id, project_id, slug, directory, path, title, version, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        sessionId,
        "prj_fixture",
        "v7-bounded-part-binary",
        "/synthetic/kilo/project/v7-bounded-part-order",
        "v7-bounded-part-order",
        "Invented bounded part order",
        "synthetic",
        sameCreatedAt - 1,
        sameCreatedAt + 1,
      ],
    );
    database.run(
      "INSERT INTO message(id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
      [
        messageId,
        sessionId,
        sameCreatedAt,
        sameCreatedAt,
        JSON.stringify({
          role: "user",
          time: { created: sameCreatedAt },
          agent: "build",
          model: {
            providerID: "provider-invented",
            modelID: "model-invented",
            variant: "high",
          },
        }),
      ],
    );
    for (const [partId, text] of insertedParts) {
      database.run(
        "INSERT INTO part(id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
        [
          partId,
          messageId,
          sessionId,
          sameCreatedAt,
          sameCreatedAt,
          JSON.stringify({ type: "text", text }),
        ],
      );
    }
  });

  interface FixturePartRow {
    rowId: number;
    id: string;
    messageId: string;
    messageSessionId: string;
    role: string;
    partSessionId: string;
    type: string;
    text: string;
  }
  let binaryRows: FixturePartRow[] = [];
  const database = new Database(path, { readonly: true });
  try {
    binaryRows = database.query(`
      SELECT
        part.rowid AS rowId,
        part.id,
        message.id AS messageId,
        message.session_id AS messageSessionId,
        json_extract(message.data, '$.role') AS role,
        part.session_id AS partSessionId,
        json_extract(part.data, '$.type') AS type,
        json_extract(part.data, '$.text') AS text
      FROM part
      JOIN message ON message.id = part.message_id
      WHERE message.session_id = ?
      ORDER BY part.id COLLATE BINARY
    `).all(sessionId) as FixturePartRow[];
    expect(binaryRows).toEqual([
      {
        rowId: 12,
        id: binaryFirstId,
        messageId,
        messageSessionId: sessionId,
        role: "user",
        partSessionId: sessionId,
        type: "text",
        text: binaryFirstText,
      },
      {
        rowId: 13,
        id: binaryRankTwoId,
        messageId,
        messageSessionId: sessionId,
        role: "user",
        partSessionId: sessionId,
        type: "text",
        text: binaryRankTwoText,
      },
      {
        rowId: 11,
        id: localeRankTwoId,
        messageId,
        messageSessionId: sessionId,
        role: "user",
        partSessionId: sessionId,
        type: "text",
        text: localeRankTwoText,
      },
      {
        rowId: 10,
        id: binaryLastId,
        messageId,
        messageSessionId: sessionId,
        role: "user",
        partSessionId: sessionId,
        type: "text",
        text: binaryLastText,
      },
    ]);
  } finally {
    database.close();
  }

  const binaryRankedRows = binaryRows.map((row, index, rows) => ({
    ...row,
    binaryPosition: index,
    boundaryRank: Math.min(index + 1, rows.length - index),
  }));
  const expectedBinaryCandidates = [...binaryRankedRows]
    .sort((left, right) =>
      left.boundaryRank - right.boundaryRank ||
      left.binaryPosition - right.binaryPosition
    )
    .slice(0, partLimit + 1);
  const expectedLocaleCandidates = [...binaryRankedRows]
    .sort((left, right) =>
      left.boundaryRank - right.boundaryRank || left.id.localeCompare(right.id)
    )
    .slice(0, partLimit + 1);
  expect({
    insertedRowIdOrder: [...binaryRows]
      .sort((left, right) => left.rowId - right.rowId)
      .map(({ id }) => id),
    sqliteBinaryOrder: binaryRows.map(({ id }) => id),
    boundaryRanks: binaryRankedRows.map(({ id, boundaryRank }) => ({ id, boundaryRank })),
    runtimeLocaleOrder: binaryRows
      .map(({ id }) => id)
      .sort((left, right) => left.localeCompare(right)),
    binaryCandidateIds: expectedBinaryCandidates.map(({ id }) => id),
    localeCandidateIds: expectedLocaleCandidates.map(({ id }) => id),
  }).toEqual({
    insertedRowIdOrder: [
      binaryLastId,
      localeRankTwoId,
      binaryFirstId,
      binaryRankTwoId,
    ],
    sqliteBinaryOrder: [
      binaryFirstId,
      binaryRankTwoId,
      localeRankTwoId,
      binaryLastId,
    ],
    boundaryRanks: [
      { id: binaryFirstId, boundaryRank: 1 },
      { id: binaryRankTwoId, boundaryRank: 2 },
      { id: localeRankTwoId, boundaryRank: 2 },
      { id: binaryLastId, boundaryRank: 1 },
    ],
    runtimeLocaleOrder: [
      localeRankTwoId,
      binaryFirstId,
      binaryRankTwoId,
      binaryLastId,
    ],
    binaryCandidateIds: [binaryFirstId, binaryLastId, binaryRankTwoId],
    localeCandidateIds: [binaryFirstId, binaryLastId, localeRankTwoId],
  });

  const descriptor = Object.getOwnPropertyDescriptor(Database.prototype, "query");
  if (!descriptor || typeof descriptor.value !== "function") {
    throw new Error("bun:sqlite Database.query is unavailable for selected-part binding capture");
  }
  const originalQuery = descriptor.value as (...args: unknown[]) => unknown;
  const selectedPartBindings: unknown[][] = [];
  Object.defineProperty(Database.prototype, "query", {
    ...descriptor,
    value: function (this: Database, ...args: unknown[]) {
      const statement = Reflect.apply(originalQuery, this, args) as object;
      const normalizedSql = String(args[0] ?? "").replace(/\s+/g, " ").trim();
      const selectedPartStatement =
        /\bFROM part\b.*\bWHERE rowid IN \((?:\?(?:, )?)+\) LIMIT \?$/i.test(normalizedSql);
      if (!selectedPartStatement) return statement;

      const originalAll = Reflect.get(statement, "all", statement);
      if (typeof originalAll !== "function") {
        throw new Error("bun:sqlite selected-part statement.all is unavailable for binding capture");
      }
      return new Proxy(statement, {
        get(target, property) {
          if (property !== "all") return Reflect.get(target, property, target);
          return (...bindings: unknown[]) => {
            selectedPartBindings.push([...bindings]);
            return Reflect.apply(originalAll, target, bindings);
          };
        },
      });
    },
  });

  let evidence: KiloStoreEvidence;
  try {
    evidence = readStoreForClaim(
      "SQLite BINARY native part-ID order controls the bounded selected-part candidate",
      path,
      { sessionId, partLimit },
    );
  } finally {
    Object.defineProperty(Database.prototype, "query", descriptor);
  }
  expect(Object.getOwnPropertyDescriptor(Database.prototype, "query")).toEqual(descriptor);

  const session = evidence.sessions.find((candidate) => candidate.sessionId === sessionId);
  expect(session, "the sanitized bounded native session must be published").toBeDefined();
  const retainedPartIds = session?.prose.map(({ partId }) => partId) ?? [];
  expect({
    storeIncomplete: evidence.incomplete,
    storeAbsent: evidence.absent,
    diagnostics: evidence.diagnostics,
    identity: {
      provider: session?.provider,
      sessionId: session?.sessionId,
      slug: session?.slug,
    },
    messageCount: session?.messages.length,
    messageIdentity: session?.messages[0],
    retainedCount: retainedPartIds.length,
    retainedWithinLimit: retainedPartIds.length <= partLimit,
    onlyFixtureIdsPublished: retainedPartIds.every((id) =>
      insertedParts.some(([fixtureId]) => fixtureId === id)
    ),
    assistantMessagesPresent: session?.messages.some(({ role }) => role === "assistant"),
    assistantClosingPresent: Object.prototype.hasOwnProperty.call(
      session ?? {},
      "assistantClosing",
    ),
    latestTurnPresent: Object.prototype.hasOwnProperty.call(session ?? {}, "latestTurn"),
    latestCallTokensPresent: Object.prototype.hasOwnProperty.call(
      session ?? {},
      "latestCallTokens",
    ),
    callSizesPresent: Object.prototype.hasOwnProperty.call(session ?? {}, "callSizes"),
    callSizesComplete: session?.callSizesComplete,
    transcriptTruncated: session?.transcriptTruncated,
  }).toEqual({
    storeIncomplete: false,
    storeAbsent: false,
    diagnostics: [{
      kind: "truncated",
      table: "part",
      recordId: sessionId,
      detail: `selected part window capped at ${partLimit}`,
    }],
    identity: {
      provider: "kilo",
      sessionId,
      slug: "v7-bounded-part-binary",
    },
    messageCount: 1,
    messageIdentity: {
      messageId,
      sessionId,
      role: "user",
      createdAt: iso(sameCreatedAt),
    },
    retainedCount: partLimit,
    retainedWithinLimit: true,
    onlyFixtureIdsPublished: true,
    assistantMessagesPresent: false,
    assistantClosingPresent: false,
    latestTurnPresent: false,
    latestCallTokensPresent: false,
    callSizesPresent: false,
    callSizesComplete: false,
    transcriptTruncated: true,
  });

  const capturedBindings = selectedPartBindings[0] ?? [];
  const candidateRowids = capturedBindings.slice(0, -1);
  const localeRankTwoRowid = binaryRows.find(({ id }) => id === localeRankTwoId)?.rowId;
  expect({
    selectedRowRetrievals: selectedPartBindings.length,
    candidateRowidCount: candidateRowids.length,
    boundArgument: capturedBindings.at(-1),
    orderedCandidateRowids: candidateRowids,
    localeRankTwoExcluded: !candidateRowids.includes(localeRankTwoRowid),
  }, "bounded admission must bind exactly the three SQLite BINARY-ranked rowids").toEqual({
    selectedRowRetrievals: 1,
    candidateRowidCount: partLimit + 1,
    boundArgument: partLimit + 1,
    orderedCandidateRowids: expectedBinaryCandidates.map(({ rowId }) => rowId),
    localeRankTwoExcluded: true,
  });
});

test("V10 selected-part retention preserves BINARY boundary authority across unordered row retrieval", async () => {
  const path = await fixtureStore();
  const partLimit = 2;
  const sameCreatedAt = 1800000031000;

  interface BoundaryPart {
    id: string;
    text: string;
  }
  interface BoundaryCase {
    role: "assistant" | "user";
    sessionId: string;
    messageId: string;
    slug: string;
    parts: Record<"A" | "B" | "a" | "z", BoundaryPart>;
    insertionOrder: Array<"A" | "B" | "a" | "z">;
    forcedReturnOrder: Array<"A" | "B" | "a" | "z">;
  }

  const assistantCase: BoundaryCase = {
    role: "assistant",
    sessionId: "ses_v10_boundary_order_assistant",
    messageId: "msg_v10_boundary_order_assistant",
    slug: "v10-boundary-order-assistant",
    parts: {
      A: {
        id: "prt_v10_boundary_assistant_A",
        text: "Invented assistant A boundary preface.",
      },
      B: {
        id: "prt_v10_boundary_assistant_B",
        text: "Invented assistant B row-order decoy.",
      },
      a: {
        id: "prt_v10_boundary_assistant_a",
        text: "Invented assistant lowercase-a interior prose.",
      },
      z: {
        id: "prt_v10_boundary_assistant_z",
        text: "Invented assistant z authoritative closing.",
      },
    },
    insertionOrder: ["A", "B", "z", "a"],
    forcedReturnOrder: ["A", "B", "z"],
  };
  const userCase: BoundaryCase = {
    role: "user",
    sessionId: "ses_v10_boundary_order_user",
    messageId: "msg_v10_boundary_order_user",
    slug: "v10-boundary-order-user",
    parts: {
      A: {
        id: "prt_v10_boundary_user_A",
        text: "Invented user A authoritative first task.",
      },
      B: {
        id: "prt_v10_boundary_user_B",
        text: "Invented user B row-order decoy.",
      },
      a: {
        id: "prt_v10_boundary_user_a",
        text: "Invented user lowercase-a interior prose.",
      },
      z: {
        id: "prt_v10_boundary_user_z",
        text: "Invented user z boundary follow-up.",
      },
    },
    insertionOrder: ["B", "z", "A", "a"],
    forcedReturnOrder: ["B", "z", "A"],
  };
  const boundaryCases = [assistantCase, userCase];

  openStore(path, (database) => {
    for (const boundaryCase of boundaryCases) {
      database.run(
        "INSERT INTO session(id, project_id, slug, directory, path, title, version, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          boundaryCase.sessionId,
          "prj_fixture",
          boundaryCase.slug,
          `/synthetic/kilo/project/${boundaryCase.slug}`,
          boundaryCase.slug,
          `Invented ${boundaryCase.role} boundary-order session`,
          "synthetic",
          0,
          0,
          0,
          0,
          0,
          sameCreatedAt - 1,
          sameCreatedAt + 1,
        ],
      );
      database.run(
        "INSERT INTO message(id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
        [
          boundaryCase.messageId,
          boundaryCase.sessionId,
          sameCreatedAt,
          sameCreatedAt,
          JSON.stringify({
            role: boundaryCase.role,
            time: { created: sameCreatedAt },
            agent: "build",
            model: {
              providerID: "provider-invented",
              modelID: "model-invented",
              variant: "high",
            },
          }),
        ],
      );
      for (const partKey of boundaryCase.insertionOrder) {
        const part = boundaryCase.parts[partKey];
        database.run(
          "INSERT INTO part(id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
          [
            part.id,
            boundaryCase.messageId,
            boundaryCase.sessionId,
            sameCreatedAt,
            sameCreatedAt,
            JSON.stringify({ type: "text", text: part.text }),
          ],
        );
      }
    }
  });

  interface FixturePartRow {
    rowId: number;
    id: string;
    messageId: string;
    messageSessionId: string;
    role: string;
    partSessionId: string;
    type: string;
    text: string;
  }
  const binaryRowsBySession = new Map<string, FixturePartRow[]>();
  const database = new Database(path, { readonly: true });
  try {
    for (const boundaryCase of boundaryCases) {
      const rows = database.query(`
        SELECT
          part.rowid AS rowId,
          part.id,
          message.id AS messageId,
          message.session_id AS messageSessionId,
          json_extract(message.data, '$.role') AS role,
          part.session_id AS partSessionId,
          json_extract(part.data, '$.type') AS type,
          json_extract(part.data, '$.text') AS text
        FROM part
        JOIN message ON message.id = part.message_id
        WHERE message.session_id = ?
        ORDER BY part.id COLLATE BINARY
      `).all(boundaryCase.sessionId) as FixturePartRow[];
      binaryRowsBySession.set(boundaryCase.sessionId, rows);
    }
  } finally {
    database.close();
  }

  expect(boundaryCases.map((boundaryCase) => {
    const rows = binaryRowsBySession.get(boundaryCase.sessionId) ?? [];
    return {
      sessionId: boundaryCase.sessionId,
      sqliteBinaryOrder: rows.map(({ id }) => id),
      insertedRowIdOrder: [...rows]
        .sort((left, right) => left.rowId - right.rowId)
        .map(({ id }) => id),
      exactNativeIdentity: rows.every((row) =>
        row.messageId === boundaryCase.messageId &&
        row.messageSessionId === boundaryCase.sessionId &&
        row.role === boundaryCase.role &&
        row.partSessionId === boundaryCase.sessionId &&
        row.type === "text"
      ),
      distinctHarmlessTexts: new Set(rows.map(({ text }) => text)).size,
    };
  }), "the throwaway store must contain both exact native BINARY and rowid orders").toEqual([
    {
      sessionId: assistantCase.sessionId,
      sqliteBinaryOrder: [
        assistantCase.parts.A.id,
        assistantCase.parts.B.id,
        assistantCase.parts.a.id,
        assistantCase.parts.z.id,
      ],
      insertedRowIdOrder: [
        assistantCase.parts.A.id,
        assistantCase.parts.B.id,
        assistantCase.parts.z.id,
        assistantCase.parts.a.id,
      ],
      exactNativeIdentity: true,
      distinctHarmlessTexts: 4,
    },
    {
      sessionId: userCase.sessionId,
      sqliteBinaryOrder: [
        userCase.parts.A.id,
        userCase.parts.B.id,
        userCase.parts.a.id,
        userCase.parts.z.id,
      ],
      insertedRowIdOrder: [
        userCase.parts.B.id,
        userCase.parts.z.id,
        userCase.parts.A.id,
        userCase.parts.a.id,
      ],
      exactNativeIdentity: true,
      distinctHarmlessTexts: 4,
    },
  ]);

  const candidateIds = (boundaryCase: BoundaryCase): string[] => [
    boundaryCase.parts.A.id,
    boundaryCase.parts.z.id,
    boundaryCase.parts.B.id,
  ];
  const candidateRowids = (boundaryCase: BoundaryCase): number[] => {
    const rows = binaryRowsBySession.get(boundaryCase.sessionId) ?? [];
    return candidateIds(boundaryCase).map((id) => {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row) throw new Error(`missing native V10 fixture row ${id}`);
      return row.rowId;
    });
  };

  interface SelectedPartCapture {
    sessionId: string;
    bindings: unknown[];
    candidateBindingIds: string[];
    nativeIds: string[];
    forcedReturnIds: string[];
    returnedOnlyNativeRows: boolean;
  }
  const descriptor = Object.getOwnPropertyDescriptor(Database.prototype, "query");
  if (!descriptor || typeof descriptor.value !== "function") {
    throw new Error("bun:sqlite Database.query is unavailable for selected-part permutation");
  }
  const originalQuery = descriptor.value as (...args: unknown[]) => unknown;
  const selectedPartCaptures: SelectedPartCapture[] = [];
  Object.defineProperty(Database.prototype, "query", {
    ...descriptor,
    value: function (this: Database, ...args: unknown[]) {
      const statement = Reflect.apply(originalQuery, this, args) as object;
      const normalizedSql = String(args[0] ?? "").replace(/\s+/g, " ").trim();
      const selectedPartStatement =
        /\bFROM part\b.*\bWHERE rowid IN \((?:\?(?:, )?)+\) LIMIT \?$/i.test(normalizedSql);
      if (!selectedPartStatement) return statement;

      const originalAll = Reflect.get(statement, "all", statement);
      if (typeof originalAll !== "function") {
        throw new Error("bun:sqlite selected-part statement.all is unavailable for permutation");
      }
      return new Proxy(statement, {
        get(target, property) {
          if (property !== "all") return Reflect.get(target, property, target);
          return (...bindings: unknown[]) => {
            const nativeRows = Reflect.apply(originalAll, target, bindings) as Array<
              Record<string, unknown>
            >;
            const boundCandidateRowids = bindings.slice(0, -1);
            const boundaryCase = boundaryCases.find((candidate) => {
              const expected = candidateRowids(candidate);
              return expected.length === boundCandidateRowids.length &&
                expected.every((rowid, index) => rowid === boundCandidateRowids[index]);
            });
            if (!boundaryCase) {
              throw new Error("selected-part retrieval widened or changed native candidate bindings");
            }

            const expectedIds = candidateIds(boundaryCase);
            const nativeById = new Map(nativeRows.map((row) => [String(row.id), row]));
            if (
              nativeRows.length !== expectedIds.length ||
              expectedIds.some((id) => !nativeById.has(id))
            ) {
              throw new Error("selected-part retrieval changed the exact native candidate rows");
            }
            const forcedRows = boundaryCase.forcedReturnOrder.map((partKey) => {
              const id = boundaryCase.parts[partKey].id;
              const row = nativeById.get(id);
              if (!row) throw new Error(`selected-part retrieval omitted native row ${id}`);
              return row;
            });
            const fixtureRows = binaryRowsBySession.get(boundaryCase.sessionId) ?? [];
            selectedPartCaptures.push({
              sessionId: boundaryCase.sessionId,
              bindings: [...bindings],
              candidateBindingIds: boundCandidateRowids.map((rowid) =>
                fixtureRows.find((row) => row.rowId === rowid)?.id ?? "MISSING_NATIVE_ROW"
              ),
              nativeIds: nativeRows.map((row) => String(row.id)),
              forcedReturnIds: forcedRows.map((row) => String(row.id)),
              returnedOnlyNativeRows: forcedRows.length === nativeRows.length &&
                forcedRows.every((row) => nativeRows.includes(row)),
            });
            return forcedRows;
          };
        },
      });
    },
  });

  const evidenceBySession = new Map<string, KiloStoreEvidence>();
  try {
    for (const boundaryCase of boundaryCases) {
      evidenceBySession.set(
        boundaryCase.sessionId,
        readStoreForClaim(
          `${boundaryCase.role} native boundary rank survives unordered selected-part rows`,
          path,
          { sessionId: boundaryCase.sessionId, partLimit },
        ),
      );
    }
  } finally {
    Object.defineProperty(Database.prototype, "query", descriptor);
    expect(Object.getOwnPropertyDescriptor(Database.prototype, "query")).toEqual(descriptor);
  }

  expect(selectedPartCaptures.map((capture) => {
    const boundaryCase = boundaryCases.find(({ sessionId }) => sessionId === capture.sessionId)!;
    return {
      sessionId: capture.sessionId,
      candidateBindings: capture.bindings.slice(0, -1),
      boundArgument: capture.bindings.at(-1),
      candidateBindingIds: capture.candidateBindingIds,
      nativeIdSet: [...capture.nativeIds].sort(),
      nativeRowCount: capture.nativeIds.length,
      forcedReturnIds: capture.forcedReturnIds,
      returnedOnlyNativeRows: capture.returnedOnlyNativeRows,
      excludedInteriorAbsent: !capture.nativeIds.includes(boundaryCase.parts.a.id),
    };
  }), "both native statements must bind and return only A,z,B before exact permutation").toEqual([
    {
      sessionId: assistantCase.sessionId,
      candidateBindings: candidateRowids(assistantCase),
      boundArgument: partLimit + 1,
      candidateBindingIds: candidateIds(assistantCase),
      nativeIdSet: [
        assistantCase.parts.A.id,
        assistantCase.parts.B.id,
        assistantCase.parts.z.id,
      ],
      nativeRowCount: partLimit + 1,
      forcedReturnIds: [
        assistantCase.parts.A.id,
        assistantCase.parts.B.id,
        assistantCase.parts.z.id,
      ],
      returnedOnlyNativeRows: true,
      excludedInteriorAbsent: true,
    },
    {
      sessionId: userCase.sessionId,
      candidateBindings: candidateRowids(userCase),
      boundArgument: partLimit + 1,
      candidateBindingIds: candidateIds(userCase),
      nativeIdSet: [
        userCase.parts.A.id,
        userCase.parts.B.id,
        userCase.parts.z.id,
      ],
      nativeRowCount: partLimit + 1,
      forcedReturnIds: [
        userCase.parts.B.id,
        userCase.parts.z.id,
        userCase.parts.A.id,
      ],
      returnedOnlyNativeRows: true,
      excludedInteriorAbsent: true,
    },
  ]);

  const assistantEvidence = evidenceBySession.get(assistantCase.sessionId);
  const userEvidence = evidenceBySession.get(userCase.sessionId);
  const assistant = assistantEvidence?.sessions.find(
    ({ sessionId }) => sessionId === assistantCase.sessionId,
  );
  const user = userEvidence?.sessions.find(({ sessionId }) => sessionId === userCase.sessionId);
  const unpublishedUsage = (session: KiloSessionEvidence | undefined) => ({
    latestCallTokensPresent: Object.prototype.hasOwnProperty.call(
      session ?? {},
      "latestCallTokens",
    ),
    callSizesPresent: Object.prototype.hasOwnProperty.call(session ?? {}, "callSizes"),
    callSizesComplete: session?.callSizesComplete,
    inventedContextPresent: /cost|usd|occupancyPct|contextWindow/i.test(JSON.stringify(session)),
  });

  expect({
    selectedRowRetrievals: selectedPartCaptures.length,
    assistant: {
      storeAbsent: assistantEvidence?.absent,
      storeIncomplete: assistantEvidence?.incomplete,
      diagnostics: assistantEvidence?.diagnostics,
      identity: {
        provider: assistant?.provider,
        sessionId: assistant?.sessionId,
        slug: assistant?.slug,
      },
      messages: assistant?.messages,
      prosePartIds: assistant?.prose.map(({ partId }) => partId),
      assistantClosing: assistant?.assistantClosing,
      transcriptTruncated: assistant?.transcriptTruncated,
      usage: unpublishedUsage(assistant),
    },
    user: {
      storeAbsent: userEvidence?.absent,
      storeIncomplete: userEvidence?.incomplete,
      diagnostics: userEvidence?.diagnostics,
      identity: {
        provider: user?.provider,
        sessionId: user?.sessionId,
        slug: user?.slug,
      },
      messages: user?.messages,
      prosePartIds: user?.prose.map(({ partId }) => partId),
      firstTask: user?.firstTask,
      firstUserText: user?.firstUserText,
      transcriptTruncated: user?.transcriptTruncated,
      usage: unpublishedUsage(user),
    },
  }, "selected-part retention must preserve native A/z boundary authority after unordered retrieval")
    .toEqual({
      selectedRowRetrievals: 2,
      assistant: {
        storeAbsent: false,
        storeIncomplete: false,
        diagnostics: [{
          kind: "truncated",
          table: "part",
          recordId: assistantCase.sessionId,
          detail: `selected part window capped at ${partLimit}`,
        }],
        identity: {
          provider: "kilo",
          sessionId: assistantCase.sessionId,
          slug: assistantCase.slug,
        },
        messages: [{
          messageId: assistantCase.messageId,
          sessionId: assistantCase.sessionId,
          role: "assistant",
          createdAt: iso(sameCreatedAt),
        }],
        prosePartIds: [assistantCase.parts.A.id, assistantCase.parts.z.id],
        assistantClosing: assistantCase.parts.z.text,
        transcriptTruncated: true,
        usage: {
          latestCallTokensPresent: false,
          callSizesPresent: false,
          callSizesComplete: false,
          inventedContextPresent: false,
        },
      },
      user: {
        storeAbsent: false,
        storeIncomplete: false,
        diagnostics: [{
          kind: "truncated",
          table: "part",
          recordId: userCase.sessionId,
          detail: `selected part window capped at ${partLimit}`,
        }],
        identity: {
          provider: "kilo",
          sessionId: userCase.sessionId,
          slug: userCase.slug,
        },
        messages: [{
          messageId: userCase.messageId,
          sessionId: userCase.sessionId,
          role: "user",
          createdAt: iso(sameCreatedAt),
        }],
        prosePartIds: [userCase.parts.A.id, userCase.parts.z.id],
        firstTask: userCase.parts.A.text,
        firstUserText: userCase.parts.A.text,
        transcriptTruncated: true,
        usage: {
          latestCallTokensPresent: false,
          callSizesPresent: false,
          callSizesComplete: false,
          inventedContextPresent: false,
        },
      },
    });
});
