import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OPENCODE_LATEST_MIGRATION,
  OPENCODE_SCHEMA_COMMIT,
  OPENCODE_STORE_LIMITS,
  readOpenCodeStore,
  type OpenCodeSessionEvidence,
  type OpenCodeStoreEvidence,
} from "../src/server/opencode-store";
import {
  ForeignSqliteReadError,
  readForeignSqlite,
} from "../src/server/foreign-sqlite";

const FIXTURE_PATH = join(import.meta.dir, "fixtures", "opencode-current.sql");
const ROOT_SESSION_ID = "ses_synthetic_root";
const CHILD_SESSION_ID = "ses_synthetic_child";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixtureSql(): Promise<string> {
  return readFile(FIXTURE_PATH, "utf8");
}

async function fixtureStore(filename = "opencode.db"): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "formic-opencode-store-"));
  temporaryDirectories.push(directory);
  const path = join(directory, filename);
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

function rootSession(evidence: OpenCodeStoreEvidence): OpenCodeSessionEvidence {
  const session = evidence.sessions.find(({ sessionId }) => sessionId === ROOT_SESSION_ID);
  expect(session, "the pinned V1 fixture must publish its root session").toBeDefined();
  return session!;
}

function expectForeignFailure(path: string, kind: ForeignSqliteReadError["kind"]): void {
  let caught: unknown;
  try {
    readOpenCodeStore(path);
  } catch (error) {
    caught = error;
  }
  expect(caught, `${path} must fail instead of looking like an empty store`).toBeInstanceOf(
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

test("pins the shareable fixture to the reviewed source without private data", async () => {
  expect(OPENCODE_SCHEMA_COMMIT).toBe("e2505d434a6d78904ecfe546c4a1980d26bd8cd1");
  expect(OPENCODE_LATEST_MIGRATION).toBe("20260622202450_simplify_session_input");

  const sql = await fixtureSql();
  expect(sql).toContain("20260622202450_simplify_session_input");
  expect(sql).toContain("/synthetic/workspace");
  expect(sql).not.toMatch(/\/Users\/|\/home\/|access_token|refresh_token|credential|session_share/i);
  expect(sql).not.toMatch(/BEGIN (?:RSA|OPENSSH|EC) PRIVATE KEY|Bearer\s+[A-Za-z0-9._-]+/i);
});

test("the parser source never queries the disposable session_message projection", async () => {
  const source = await readFile(join(import.meta.dir, "..", "src", "server", "opencode-store.ts"), "utf8");
  expect(source).not.toMatch(/\bsession_message\b/i);
});

test("reads native session identity, safe title provenance, raw model route and raw variant", async () => {
  const session = rootSession(readOpenCodeStore(await fixtureStore()));

  expect(session).toMatchObject({
    sessionId: ROOT_SESSION_ID,
    sourceTitle: {
      text: "Synthetic parser contract",
      provenance: "opencode-source-title-unverified-authorship",
    },
    sourceDirectory: "/synthetic/workspace/parser-lab",
    sourcePath: "parser-lab",
    rawModel: {
      modelId: "model-alpha",
      providerRoute: "route-synthetic",
      rawVariant: "high",
    },
  });
  expect(session.sourceTitle?.provenance).not.toBe("human-authored");
  expect(session.rawModel).not.toHaveProperty("effort");
  expect(JSON.stringify(session)).not.toMatch(/"effort"\s*:/);
});

test("uses canonical V1 speech for first task, attributed prose and assistant closing", async () => {
  const session = rootSession(readOpenCodeStore(await fixtureStore()));

  expect(session.firstTask).toBe("Prove the bounded OpenCode parser contract.");
  expect(session.firstUserText).toBe("Prove the bounded OpenCode parser contract.");
  expect(session.assistantClosing).toBe(
    "Parser evidence is bounded and relationships are intact.",
  );
  expect(session.prose.map(({ role, text }) => ({ role, text }))).toEqual([
    { role: "user", text: "Prove the bounded OpenCode parser contract." },
    { role: "assistant", text: "The first bounded pass preserves native IDs." },
    { role: "user", text: "Confirm the final bounded evidence." },
    { role: "assistant", text: "Parser evidence is bounded and relationships are intact." },
  ]);
  expect(session.transcriptTail?.text).not.toContain("REJECTED_PROJECTION_TEXT_MUST_NEVER_APPEAR");
});

test("retains native message and part relationships plus typed reasoning and tool events", async () => {
  const session = rootSession(readOpenCodeStore(await fixtureStore()));

  expect(session.messages).toContainEqual(expect.objectContaining({
    messageId: "msg_synthetic_assistant_2",
    sessionId: ROOT_SESSION_ID,
    role: "assistant",
    parentMessageId: "msg_synthetic_user_2",
  }));
  expect(session.events).toContainEqual(expect.objectContaining({
    kind: "reasoning",
    sessionId: ROOT_SESSION_ID,
    messageId: "msg_synthetic_assistant_1",
    partId: "prt_synthetic_assistant_1_reasoning",
    text: "Check native relationship keys.",
  }));
  expect(session.events).toContainEqual(expect.objectContaining({
    kind: "tool",
    sessionId: ROOT_SESSION_ID,
    messageId: "msg_synthetic_assistant_1",
    partId: "prt_synthetic_assistant_1_tool",
    callId: "call_synthetic_inspect",
    toolName: "inspect",
    status: "completed",
  }));
  const toolEvent = session.events.find(
    (event) => event.kind === "tool" && event.partId === "prt_synthetic_assistant_1_tool",
  );
  expect(toolEvent).not.toHaveProperty("input");
  expect(toolEvent).not.toHaveProperty("output");
  expect(JSON.stringify(session)).not.toContain("Synthetic inspection complete.");
  expect(session.prose.some(({ text }) => text.includes("native relationship keys"))).toBe(false);
});

test("keeps earliest and latest observed assistant cwd and turn completion distinct from session exit", async () => {
  const session = rootSession(readOpenCodeStore(await fixtureStore()));

  expect(session).toMatchObject({
    earliestAssistantCwd: "/synthetic/workspace/parser-lab",
    latestAssistantCwd: "/synthetic/workspace/parser-lab/subdir",
    startedAt: iso(1784689000000),
    updatedAt: iso(1784689180000),
    latestTurn: {
      messageId: "msg_synthetic_assistant_2",
      parentMessageId: "msg_synthetic_user_2",
      createdAt: iso(1784689070000),
      completedAt: iso(1784689180000),
      finish: "stop",
    },
  });
  expect(session.archivedAt).toBeUndefined();
});

test("preserves normalized latest-call and session counters without USD or context invention", async () => {
  const session = rootSession(readOpenCodeStore(await fixtureStore()));

  expect(session.latestCallTokens).toEqual({
    nonCachedInput: 44,
    output: 12,
    reasoning: 3,
    cacheRead: 90,
    cacheWrite: 4,
    total: 153,
  });
  expect(session.sessionTokens).toEqual({
    nonCachedInput: 120,
    output: 30,
    reasoning: 7,
    cacheRead: 400,
    cacheWrite: 11,
  });
  const published = JSON.stringify(session);
  expect(published).not.toMatch(/cost|usd|contextPct|occupancyPct|contextWindow/i);
});

test("V1 step-finish evidence publishes callSizes in transcript order and leaves absent series undefined", async () => {
  const evidence = readOpenCodeStore(await fixtureStore());
  const root = rootSession(evidence);
  const child = evidence.sessions.find(({ sessionId }) => sessionId === CHILD_SESSION_ID);

  expect({
    rootCallSizes: root.callSizes,
    rootCallSizesComplete: root.callSizesComplete,
    childCallSizes: child?.callSizes,
    childCallSizesComplete: child?.callSizesComplete,
  }).toEqual({
    rootCallSizes: [415, 153],
    rootCallSizesComplete: true,
    childCallSizes: undefined,
    childCallSizesComplete: false,
  });
});

test("keeps child parent identity and archive timestamp while rejecting placeholder title authorship", async () => {
  const evidence = readOpenCodeStore(await fixtureStore());
  const child = evidence.sessions.find(({ sessionId }) => sessionId === CHILD_SESSION_ID);

  expect(child, "the child session must remain independently observable").toBeDefined();
  expect(child).toMatchObject({
    sessionId: CHILD_SESSION_ID,
    parentSessionId: ROOT_SESSION_ID,
    archivedAt: iso(1784689130000),
  });
  expect(child?.sourceTitle).toBeUndefined();
});

test("observed all-zero child session counters remain zeros rather than becoming unknown", async () => {
  const evidence = readOpenCodeStore(await fixtureStore());
  const child = evidence.sessions.find(({ sessionId }) => sessionId === CHILD_SESSION_ID);

  expect(child, "the zero-counter child must remain independently observable").toBeDefined();
  expect(child?.sessionTokens).toEqual({
    nonCachedInput: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
  });
});

test("default recent-session enumeration is capped newest-first with explicit truncation diagnostics", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    for (let index = 0; index < OPENCODE_STORE_LIMITS.sessions + 5; index += 1) {
      const suffix = String(index).padStart(3, "0");
      database.run(
        "INSERT INTO session(id, project_id, slug, directory, title, version, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
          `ses_recent_${suffix}`,
          "prj_synthetic",
          `recent-${suffix}`,
          `/synthetic/workspace/recent-${suffix}`,
          `Synthetic recent session ${suffix}`,
          "local-test",
          1784690000000 + index,
          1784690000000 + index,
        ],
      );
    }
  });

  const evidence = readOpenCodeStore(path);
  expect(evidence.sessions).toHaveLength(OPENCODE_STORE_LIMITS.sessions);
  expect(evidence.sessions[0]?.sessionId).toBe("ses_recent_054");
  expect(evidence.sessions.at(-1)?.sessionId).toBe("ses_recent_005");
  expect(evidence.sessions.map(({ sessionId }) => sessionId)).not.toContain("ses_recent_004");
  expect(evidence.diagnostics).toContainEqual(expect.objectContaining({
    kind: "truncated",
    table: "session",
  }));
});

test("early-plus-recent message windows retain first task and newest closing while bounding evidence", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.exec("BEGIN");
    try {
      for (let index = 0; index < 130; index += 1) {
        const suffix = String(index).padStart(3, "0");
        const messageId = `msg_window_${suffix}`;
        const createdAt = 1784691000000 + index * 10;
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
              parentID: "msg_synthetic_user_2",
              modelID: "model-alpha",
              providerID: "route-synthetic",
              mode: "build",
              agent: "build",
              path: {
                cwd: "/synthetic/workspace/parser-lab/subdir",
                root: "/synthetic/workspace",
              },
              tokens: {
                total: 0,
                input: 0,
                output: 0,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
              variant: "high",
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
            JSON.stringify({ type: "text", text: `Window assistant closing ${index}.` }),
          ],
        );
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  });

  const evidence = readOpenCodeStore(path);
  const session = rootSession(evidence);
  const publishedMessageIds = session.messages.map(({ messageId }) => messageId);
  expect(session.firstTask).toBe("Prove the bounded OpenCode parser contract.");
  expect(session.assistantClosing).toBe("Window assistant closing 129.");
  expect(session.messages).toHaveLength(
    OPENCODE_STORE_LIMITS.earlyMessagesPerSession +
      OPENCODE_STORE_LIMITS.recentMessagesPerSession,
  );
  expect(publishedMessageIds).toContain("msg_synthetic_user_1");
  expect(publishedMessageIds).toContain("msg_window_129");
  expect(publishedMessageIds).not.toContain("msg_window_020");
  expect(session.transcriptTruncated).toBe(true);
  expect(evidence.diagnostics).toContainEqual(expect.objectContaining({
    kind: "truncated",
    table: "message",
    recordId: ROOT_SESSION_ID,
  }));
});

test("global part cap preserves boundary speech when one selected message has 500 harmless early parts", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.exec("BEGIN");
    try {
      for (let index = 0; index < 500; index += 1) {
        const suffix = String(index).padStart(3, "0");
        database.run(
          "INSERT INTO part(id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
          [
            `prt_000_noise_${suffix}`,
            "msg_synthetic_assistant_1",
            ROOT_SESSION_ID,
            1784689021000 + index,
            1784689021000 + index,
            JSON.stringify({ type: "step-start" }),
          ],
        );
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  });

  const evidence = readOpenCodeStore(path);
  const session = rootSession(evidence);
  expect({
    firstTask: session.firstTask,
    assistantClosing: session.assistantClosing,
    retainedReasoning: session.events.some(
      ({ kind, partId }) => kind === "reasoning" && partId === "prt_synthetic_assistant_1_reasoning",
    ),
    retainedTool: session.events.some(
      ({ kind, partId }) => kind === "tool" && partId === "prt_synthetic_assistant_1_tool",
    ),
    callSizes: session.callSizes,
    callSizesComplete: session.callSizesComplete,
    transcriptTruncated: session.transcriptTruncated,
    hasPartTruncationDiagnostic: evidence.diagnostics.some((item) =>
      item.kind === "truncated" && item.table === "part" && item.recordId === ROOT_SESSION_ID
    ),
  }).toEqual({
    firstTask: "Prove the bounded OpenCode parser contract.",
    assistantClosing: "Parser evidence is bounded and relationships are intact.",
    retainedReasoning: true,
    retainedTool: true,
    callSizes: [415, 153],
    callSizesComplete: false,
    transcriptTruncated: true,
    hasPartTruncationDiagnostic: true,
  });
});

test("custom bounds report the applied message and part limits instead of default caps", async () => {
  const evidence = readOpenCodeStore(await fixtureStore(), {
    sessionLimit: 1,
    messageLimit: 1,
    partLimit: 2,
  });
  const truncationDetail = (table: "session" | "message" | "part") =>
    evidence.diagnostics.find((item) => item.kind === "truncated" && item.table === table)?.detail;

  expect({
    session: truncationDetail("session"),
    message: truncationDetail("message"),
    part: truncationDetail("part"),
  }).toEqual({
    session: "recent session window capped at 1",
    message: "recent message window capped at 1",
    part: "selected part window capped at 2",
  });
});

test("ordinary prose tails longer than 800 are suffix-capped without becoming oversized content", async () => {
  const path = await fixtureStore();
  const ordinaryLongText = `${"tail-segment-".repeat(100)}TAIL_END`;
  expect(ordinaryLongText.length).toBeGreaterThan(OPENCODE_STORE_LIMITS.transcriptTailChars);
  expect(ordinaryLongText.length).toBeLessThan(OPENCODE_STORE_LIMITS.textChars);
  openStore(path, (database) => {
    database.run("UPDATE part SET data = ? WHERE id = ?", [
      JSON.stringify({ type: "text", text: ordinaryLongText }),
      "prt_synthetic_assistant_2_text",
    ]);
  });

  const evidence = readOpenCodeStore(path);
  const session = rootSession(evidence);
  expect(session.transcriptTail).toEqual({
    text: ordinaryLongText.slice(-OPENCODE_STORE_LIMITS.transcriptTailChars),
    truncated: true,
  });
  expect(evidence.diagnostics).not.toContainEqual(expect.objectContaining({
    kind: "oversized-content",
    table: "part",
    recordId: "prt_synthetic_assistant_2_text",
  }));
});

test("missing file and empty current store are different outcomes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "formic-opencode-missing-"));
  temporaryDirectories.push(directory);
  expectForeignFailure(join(directory, "opencode.db"), "absent");

  const path = await fixtureStore();
  openStore(path, (database) => database.exec("DELETE FROM part; DELETE FROM message; DELETE FROM session;"));
  expect(readOpenCodeStore(path)).toEqual({ sessions: [], diagnostics: [], incomplete: false });
});

test("missing latest migration fails closed as an incompatible partial store", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.run("DELETE FROM migration WHERE id = ?", [OPENCODE_LATEST_MIGRATION]);
  });
  expectForeignFailure(path, "schema");
});

test("missing required V1 columns fail closed even when the latest migration is stamped", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.exec("DROP TABLE part; CREATE TABLE part (id text PRIMARY KEY, message_id text, session_id text, time_created integer, time_updated integer);");
  });
  expectForeignFailure(path, "schema");
});

test("timestamp-shaped future migration fails closed while legacy names and extra columns coexist", async () => {
  const compatible = await fixtureStore();
  openStore(compatible, (database) => database.exec("ALTER TABLE session ADD COLUMN extra_note text"));
  expect(readOpenCodeStore(compatible).sessions).toHaveLength(2);

  const future = await fixtureStore();
  openStore(future, (database) => {
    database.run("INSERT INTO migration(id, time_completed) VALUES (?, ?)", [
      "20260701000000_future_schema",
      1784689200000,
    ]);
  });
  expectForeignFailure(future, "schema");
});

test("live WAL rows are visible through the shared read-only snapshot", async () => {
  const path = await fixtureStore();
  const writer = new Database(path);
  try {
    expect(writer.query("PRAGMA journal_mode = WAL").get()).toEqual({ journal_mode: "wal" });
    writer.exec("PRAGMA wal_autocheckpoint = 0");
    writer.run(
      "INSERT INTO session(id, project_id, slug, directory, title, version, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        "ses_wal_visible",
        "prj_synthetic",
        "wal-visible",
        "/synthetic/workspace/wal",
        "Synthetic WAL session",
        "local-test",
        1784689200000,
        1784689200000,
      ],
    );
    expect(await fingerprint(`${path}-wal`)).toBeDefined();
    expect(readOpenCodeStore(path).sessions.map(({ sessionId }) => sessionId)).toContain("ses_wal_visible");
  } finally {
    writer.close();
  }
});

test("WAL-header stores without sidecars parse immutably without creating sidecars", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    expect(database.query("PRAGMA journal_mode = WAL").get()).toEqual({ journal_mode: "wal" });
  });

  const header = await readFile(path);
  expect([header[18], header[19]]).toEqual([2, 2]);
  expect({
    wal: await fingerprint(`${path}-wal`),
    shm: await fingerprint(`${path}-shm`),
  }).toEqual({ wal: undefined, shm: undefined });

  const evidence = readOpenCodeStore(path);
  expect(evidence.sessions.map(({ sessionId }) => sessionId)).toContain(ROOT_SESSION_ID);
  expect({
    wal: await fingerprint(`${path}-wal`),
    shm: await fingerprint(`${path}-shm`),
  }).toEqual({ wal: undefined, shm: undefined });
});

test("locked or busy store is not laundered into a successful empty result", async () => {
  const path = await fixtureStore();
  const writer = new Database(path);
  writer.exec("PRAGMA journal_mode = DELETE; BEGIN EXCLUSIVE");
  try {
    expectForeignFailure(path, "locked");
  } finally {
    writer.exec("ROLLBACK");
    writer.close();
  }
});

test("corrupt non-SQLite input names corruption rather than publishing zero sessions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "formic-opencode-corrupt-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "opencode.db");
  await writeFile(path, "this is synthetic non-SQLite input");
  expectForeignFailure(path, "corrupt");
});

test("corrupt and oversized JSON are diagnosed, bounded, and never published as complete prose", async () => {
  const path = await fixtureStore();
  const oversizedText = `OVERSIZED_CONTENT_MARKER_${"x".repeat(OPENCODE_STORE_LIMITS.textChars + 1)}`;
  const oversizedJson = JSON.stringify({
    type: "text",
    text: `OVERSIZED_JSON_MARKER_${"y".repeat(OPENCODE_STORE_LIMITS.jsonChars + 1)}`,
  });
  openStore(path, (database) => {
    database.run(
      "INSERT INTO message(id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
      ["msg_synthetic_bad", ROOT_SESSION_ID, 1784689190000, 1784689190000, "{"],
    );
    database.run(
      "INSERT INTO message(id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
      [
        "msg_synthetic_oversized",
        ROOT_SESSION_ID,
        1784689191000,
        1784689191000,
        JSON.stringify({
          role: "assistant",
          time: { created: 1784689191000, completed: 1784689191001 },
          parentID: "msg_synthetic_user_2",
          modelID: "model-alpha",
          providerID: "route-synthetic",
          mode: "build",
          agent: "build",
          path: { cwd: "/synthetic/workspace/parser-lab/subdir", root: "/synthetic/workspace" },
          tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 1, write: 0 } },
        }),
      ],
    );
    database.run(
      "INSERT INTO part(id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
      [
        "prt_synthetic_oversized_content",
        "msg_synthetic_oversized",
        ROOT_SESSION_ID,
        1784689191000,
        1784689191000,
        JSON.stringify({ type: "text", text: oversizedText }),
      ],
    );
    database.run(
      "INSERT INTO part(id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
      [
        "prt_synthetic_oversized_json",
        "msg_synthetic_oversized",
        ROOT_SESSION_ID,
        1784689191001,
        1784689191001,
        oversizedJson,
      ],
    );
  });

  const evidence = readOpenCodeStore(path);
  const session = rootSession(evidence);
  expect(evidence.diagnostics).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "invalid-json", table: "message", recordId: "msg_synthetic_bad" }),
    expect.objectContaining({ kind: "oversized-content", table: "part", recordId: "prt_synthetic_oversized_content" }),
    expect.objectContaining({ kind: "oversized-json", table: "part", recordId: "prt_synthetic_oversized_json" }),
  ]));
  expect(JSON.stringify(session)).not.toMatch(/OVERSIZED_(?:CONTENT|JSON)_MARKER/);
});

test("oversized JSON-derived strings are omitted with field-specific diagnostics", async () => {
  const path = await fixtureStore();
  const idChars = 256;
  const oversized = (marker: string, max: number) =>
    `${marker}${"x".repeat(max + 1 - marker.length)}`;
  const markers = {
    parentMessageId: "OVERSIZED_PARENT_ID_MARKER_",
    modelId: "OVERSIZED_MODEL_ID_MARKER_",
    providerRoute: "OVERSIZED_PROVIDER_ROUTE_MARKER_",
    rawVariant: "OVERSIZED_RAW_VARIANT_MARKER_",
    cwd: "OVERSIZED_CWD_MARKER_",
    finish: "OVERSIZED_FINISH_MARKER_",
    callId: "OVERSIZED_CALL_ID_MARKER_",
    toolName: "OVERSIZED_TOOL_NAME_MARKER_",
    toolTitle: "OVERSIZED_TOOL_TITLE_MARKER_",
  } as const;
  const messageData = JSON.stringify({
    role: "assistant",
    time: { created: 1784689070000, completed: 1784689180000 },
    parentID: oversized(markers.parentMessageId, idChars),
    modelID: oversized(markers.modelId, idChars),
    providerID: oversized(markers.providerRoute, idChars),
    mode: "build",
    agent: "build",
    path: {
      cwd: oversized(markers.cwd, OPENCODE_STORE_LIMITS.textChars),
      root: "/synthetic/workspace",
    },
    tokens: {
      total: 153,
      input: 44,
      output: 12,
      reasoning: 3,
      cache: { read: 90, write: 4 },
    },
    variant: oversized(markers.rawVariant, idChars),
    finish: oversized(markers.finish, idChars),
  });
  const toolData = JSON.stringify({
    type: "tool",
    callID: oversized(markers.callId, idChars),
    tool: oversized(markers.toolName, idChars),
    state: {
      status: "completed",
      title: oversized(markers.toolTitle, OPENCODE_STORE_LIMITS.textChars),
    },
  });
  expect(messageData.length).toBeLessThan(OPENCODE_STORE_LIMITS.jsonChars);
  expect(toolData.length).toBeLessThan(OPENCODE_STORE_LIMITS.jsonChars);

  openStore(path, (database) => {
    database.run("UPDATE message SET data = ? WHERE id = ?", [
      messageData,
      "msg_synthetic_assistant_2",
    ]);
    database.run("UPDATE part SET data = ? WHERE id = ?", [
      toolData,
      "prt_synthetic_assistant_1_tool",
    ]);
  });

  const evidence = readOpenCodeStore(path);
  const published = JSON.stringify(rootSession(evidence));
  const publishedMarkerNames = Object.entries(markers).flatMap(([field, marker]) =>
    published.includes(marker) ? [field] : []
  );
  const omissionDetails = evidence.diagnostics
    .filter(({ kind }) => kind === "oversized-content")
    .map(({ detail }) => detail);
  expect({ publishedMarkerNames, omissionDetails }).toEqual({
    publishedMarkerNames: [],
    omissionDetails: expect.arrayContaining([
      "message parent id exceeds 256 characters and was omitted",
      "message model id exceeds 256 characters and was omitted",
      "message provider route exceeds 256 characters and was omitted",
      "message raw variant exceeds 256 characters and was omitted",
      "message path cwd exceeds 8000 characters and was omitted",
      "message finish exceeds 256 characters and was omitted",
      "tool call id exceeds 256 characters and was omitted",
      "tool name exceeds 256 characters and was omitted",
      "tool title exceeds 8000 characters and was omitted",
    ]),
  });
});

test("unsupported source timestamps are omitted with diagnostics without dropping native transcript evidence", async () => {
  const path = await fixtureStore();
  const unsupportedTimestamp = Number.MAX_SAFE_INTEGER;
  openStore(path, (database) => {
    database.run(
      "UPDATE session SET time_created = ?, time_updated = ?, time_archived = ? WHERE id = ?",
      [unsupportedTimestamp, unsupportedTimestamp, unsupportedTimestamp, ROOT_SESSION_ID],
    );
    database.run("UPDATE message SET data = ? WHERE id = ?", [
      JSON.stringify({
        role: "assistant",
        time: { created: unsupportedTimestamp, completed: unsupportedTimestamp },
        parentID: "msg_synthetic_user_2",
        modelID: "model-alpha",
        providerID: "route-synthetic",
        mode: "build",
        agent: "build",
        path: { cwd: "/synthetic/workspace/parser-lab/subdir", root: "/synthetic/workspace" },
        tokens: {
          total: 153,
          input: 44,
          output: 12,
          reasoning: 3,
          cache: { read: 90, write: 4 },
        },
        variant: "high",
        finish: "stop",
      }),
      "msg_synthetic_assistant_2",
    ]);
    database.run(
      "UPDATE part SET time_created = ?, time_updated = ? WHERE id = ?",
      [unsupportedTimestamp, unsupportedTimestamp, "prt_synthetic_assistant_2_text"],
    );
  });

  let evidence: OpenCodeStoreEvidence | undefined;
  expect(() => {
    evidence = readOpenCodeStore(path);
  }).not.toThrow();

  const session = rootSession(evidence!);
  expect({
    sessionId: session.sessionId,
    prose: session.prose.map(({ role, text }) => ({ role, text })),
  }).toEqual({
    sessionId: ROOT_SESSION_ID,
    prose: [
      { role: "user", text: "Prove the bounded OpenCode parser contract." },
      { role: "assistant", text: "The first bounded pass preserves native IDs." },
      { role: "user", text: "Confirm the final bounded evidence." },
      { role: "assistant", text: "Parser evidence is bounded and relationships are intact." },
    ],
  });

  const affectedEvent = session.events.find(
    ({ partId }) => partId === "prt_synthetic_assistant_2_text",
  );
  expect({
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    archivedAt: session.archivedAt,
    latestCreatedAt: session.latestTurn?.createdAt,
    latestCompletedAt: session.latestTurn?.completedAt,
    affectedEventPartId: affectedEvent?.partId,
    affectedObservedAt: affectedEvent?.observedAt,
  }).toEqual({
    startedAt: undefined,
    updatedAt: undefined,
    archivedAt: undefined,
    latestCreatedAt: iso(1784689070000),
    latestCompletedAt: undefined,
    affectedEventPartId: "prt_synthetic_assistant_2_text",
    affectedObservedAt: undefined,
  });

  const expectedTimestampFields = [
    { table: "session", recordId: ROOT_SESSION_ID, field: "time_created" },
    { table: "session", recordId: ROOT_SESSION_ID, field: "time_updated" },
    { table: "session", recordId: ROOT_SESSION_ID, field: "time_archived" },
    { table: "message", recordId: "msg_synthetic_assistant_2", field: "time.created" },
    { table: "message", recordId: "msg_synthetic_assistant_2", field: "time.completed" },
    { table: "part", recordId: "prt_synthetic_assistant_2_text", field: "time_created" },
    { table: "part", recordId: "prt_synthetic_assistant_2_text", field: "time_updated" },
  ] as const;
  const diagnosedTimestampFields = expectedTimestampFields.filter(({ table, recordId, field }) =>
    evidence!.diagnostics.some((item) =>
      item.kind === "invalid-record" && item.table === table && item.recordId === recordId &&
      item.detail.includes(field) && item.detail.includes("omitted")
    )
  );
  expect(diagnosedTimestampFields).toEqual([...expectedTimestampFields]);
});

test("invalid latest step-finish falls back only for latestCallTokens and is omitted from callSizes", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.run("UPDATE part SET data = ? WHERE id = ?", [
      JSON.stringify({
        type: "step-finish",
        reason: "stop",
        tokens: {
          total: 153,
          input: "invalid",
          output: 12,
          reasoning: 3,
          cache: { read: 90, write: 4 },
        },
      }),
      "prt_synthetic_assistant_2_finish",
    ]);
  });

  const evidence = readOpenCodeStore(path);
  const session = rootSession(evidence);
  expect(evidence.diagnostics).toContainEqual(expect.objectContaining({
    kind: "invalid-record",
    table: "part",
    recordId: "prt_synthetic_assistant_2_finish",
    detail: "step-finish token counters are invalid and remain unavailable",
  }));
  expect(session.latestCallTokens).toEqual({
    nonCachedInput: 44,
    output: 12,
    reasoning: 3,
    cacheRead: 90,
    cacheWrite: 4,
    total: 153,
  });
  expect({ callSizes: session.callSizes, callSizesComplete: session.callSizesComplete })
    .toEqual({ callSizes: [415], callSizesComplete: false });
});

test("unknown latest-call counters remain absent instead of collapsing to zeros", async () => {
  const path = await fixtureStore();
  openStore(path, (database) => {
    database.run("UPDATE message SET data = ? WHERE id = 'msg_synthetic_assistant_2'", [
      JSON.stringify({
        role: "assistant",
        time: { created: 1784689070000, completed: 1784689180000 },
        parentID: "msg_synthetic_user_2",
        modelID: "model-alpha",
        providerID: "route-synthetic",
        mode: "build",
        agent: "build",
        path: { cwd: "/synthetic/workspace/parser-lab/subdir", root: "/synthetic/workspace" },
        tokens: { input: "unknown" },
        variant: "high",
        finish: "stop",
      }),
    ]);
    database.run("DELETE FROM part WHERE id = 'prt_synthetic_assistant_2_finish'");
  });

  const session = rootSession(readOpenCodeStore(path));
  expect(session.latestCallTokens).toBeUndefined();
  expect(session.sessionTokens?.nonCachedInput).toBe(120);
});

test("expired and in-flight deadlines stop bounded enumeration with explicit diagnostics", async () => {
  const path = await fixtureStore();
  const expired = readOpenCodeStore(path, { deadlineAtMs: 10, nowMs: () => 10 });
  expect(expired).toMatchObject({ sessions: [], incomplete: true });
  expect(expired.diagnostics).toContainEqual(expect.objectContaining({ kind: "deadline" }));

  let checks = 0;
  const inFlight = readOpenCodeStore(path, {
    deadlineAtMs: 50,
    nowMs: () => (checks++ === 0 ? 0 : 100),
  });
  expect(checks).toBeGreaterThan(1);
  expect(inFlight.incomplete).toBe(true);
  expect(inFlight.diagnostics).toContainEqual(expect.objectContaining({ kind: "deadline" }));
});

test("in-flight deadline retains the accepted root bundle and names the incomplete remainder", async () => {
  const path = await fixtureStore();
  let checks = 0;
  const evidence = readOpenCodeStore(path, {
    deadlineAtMs: 50,
    nowMs: () => checks++ < 6 ? 0 : 50,
  });

  expect(checks).toBeGreaterThan(6);
  expect({
    sessionIds: evidence.sessions.map(({ sessionId }) => sessionId),
    incomplete: evidence.incomplete,
    hasDeadlineDiagnostic: evidence.diagnostics.some(({ kind }) => kind === "deadline"),
  }).toEqual({
    sessionIds: [ROOT_SESSION_ID],
    incomplete: true,
    hasDeadlineDiagnostic: true,
  });
});

test("separate readers overlap on detached WAL evidence without changing sidecars", async () => {
  const path = await fixtureStore();
  const writer = new Database(path);
  try {
    writer.query("PRAGMA journal_mode = WAL").get();
    writer.exec("PRAGMA wal_autocheckpoint = 0");
    writer.run("UPDATE session SET time_updated = ? WHERE id = ?", [1784689200000, ROOT_SESSION_ID]);
    const before = {
      wal: await fingerprint(`${path}-wal`),
      shm: await fingerprint(`${path}-shm`),
    };
    const parserUrl = new URL("../src/server/opencode-store.ts", import.meta.url).href;
    const startSignal = `${path}.readers-start`;
    const readerCount = 4;
    const repeatedReads = 24;
    const readyPaths = Array.from(
      { length: readerCount },
      (_, index) => `${path}.reader-${index}.ready`,
    );
    const childSource = `
      import { existsSync, writeFileSync } from "node:fs";

      const storePath = process.env.OPENCODE_STORE_PATH;
      const parserUrl = process.env.OPENCODE_PARSER_URL;
      const readyPath = process.env.OPENCODE_READY_PATH;
      const startSignal = process.env.OPENCODE_START_SIGNAL;
      const readerIndex = Number(process.env.OPENCODE_READER_INDEX);
      const repeatedReads = Number(process.env.OPENCODE_REPEATED_READS);
      if (!storePath || !parserUrl || !readyPath || !startSignal) {
        throw new Error("missing synchronized OpenCode reader environment");
      }

      const { readOpenCodeStore } = await import(parserUrl);
      writeFileSync(readyPath, "ready");
      const waitDeadline = Date.now() + 4_000;
      while (!existsSync(startSignal)) {
        if (Date.now() >= waitDeadline) throw new Error("OpenCode reader start barrier timed out");
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
        const evidence = readOpenCodeStore(storePath);
        const endedAt = now();
        readIntervals.push({ startedAt, endedAt });
        sessionIdsByRead.push(evidence.sessions.map(({ sessionId }) => sessionId));
        const serialized = JSON.stringify(evidence);
        if (canonicalEvidence === undefined) canonicalEvidence = serialized;
        else if (serialized !== canonicalEvidence) sameEvidence = false;
        if (firstEvidence === undefined) firstEvidence = evidence;
      }

      firstEvidence.sessions.splice(0);
      const detachedStartedAt = now();
      const detachedEvidence = readOpenCodeStore(storePath);
      const detachedEndedAt = now();
      readIntervals.push({ startedAt: detachedStartedAt, endedAt: detachedEndedAt });
      sessionIdsByRead.push(detachedEvidence.sessions.map(({ sessionId }) => sessionId));
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
          OPENCODE_STORE_PATH: path,
          OPENCODE_PARSER_URL: parserUrl,
          OPENCODE_READY_PATH: readyPath,
          OPENCODE_START_SIGNAL: startSignal,
          OPENCODE_READER_INDEX: String(index),
          OPENCODE_REPEATED_READS: String(repeatedReads),
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
    const expectedSessionIds = [ROOT_SESSION_ID, CHILD_SESSION_ID];
    const expectedSerialized = JSON.stringify(expectedSessionIds);
    expect(results.map((result) => ({
      readerIndex: result.readerIndex,
      readCount: result.readIntervals.length,
      allReadsSawSameTwoSessions: result.sameEvidence && result.sessionIdsByRead.every(
        (sessionIds) => JSON.stringify(sessionIds) === expectedSerialized,
      ),
      detached: result.detached,
    }))).toEqual(Array.from({ length: readerCount }, (_, readerIndex) => ({
      readerIndex,
      readCount: repeatedReads + 1,
      allReadsSawSameTwoSessions: true,
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
    expect({
      wal: await fingerprint(`${path}-wal`),
      shm: await fingerprint(`${path}-shm`),
    }).toEqual(before);
  } finally {
    writer.close();
  }
});

test("the parser and shared reader cannot mutate the source store", async () => {
  const path = await fixtureStore();
  readOpenCodeStore(path);

  expect(() => readForeignSqlite(path, (database) => {
    database.exec("UPDATE session SET title = 'mutated' WHERE id = 'ses_synthetic_root'");
  })).toThrow();

  const check = new Database(path, { readonly: true });
  try {
    expect(check.query("SELECT title FROM session WHERE id = ?").get(ROOT_SESSION_ID)).toEqual({
      title: "Synthetic parser contract",
    });
  } finally {
    check.close();
  }
});
