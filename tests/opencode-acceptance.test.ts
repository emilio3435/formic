import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonArchiveStore, MemoryArchiveStore } from "../src/server/archive";
import { transcriptResponse } from "../src/server/debug-identity";
import { collectOpenCodeSessions } from "../src/server/opencode";
import { sessionCallsResponse } from "../src/server/session-calls";
import { buildSnapshot } from "../src/server/snapshot";
import type { CollectedAgent } from "../src/server/types";

const FIXTURE_PATH = join(import.meta.dir, "fixtures", "opencode-current.sql");
const ROOT_SESSION_ID = "ses_synthetic_root";
const NAMED_NATIVE_ACTIVITY = {
  recordId: "msg_synthetic_assistant_2",
  field: "message.data.time.completed",
  epochMs: 1_784_689_180_000,
  iso: "2026-07-22T02:59:40.000Z",
} as const;
const DATABASE_MTIME = new Date("2026-08-20T05:30:00.000Z");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixtureStore(label: string): Promise<{ dataDir: string; path: string }> {
  const dataDir = await mkdtemp(join(tmpdir(), `formic-opencode-acceptance-${label}-`));
  temporaryDirectories.push(dataDir);
  const path = join(dataDir, "opencode.db");
  const database = new Database(path, { create: true });
  try {
    database.exec(await readFile(FIXTURE_PATH, "utf8"));
  } finally {
    database.close();
  }
  return { dataDir, path };
}

function mutateStore(path: string, mutate: (database: Database) => void): void {
  const database = new Database(path);
  try {
    mutate(database);
  } finally {
    database.close();
  }
}

function rootAgent(agents: readonly CollectedAgent[]): CollectedAgent {
  const agent = agents.find(({ sourceSessionId }) => sourceSessionId === ROOT_SESSION_ID);
  if (!agent) throw new Error("synthetic OpenCode root session was not collected");
  return agent;
}

function snapshotFor(agents: readonly CollectedAgent[]) {
  return buildSnapshot({
    agents,
    surfaces: [],
    archiveStore: new MemoryArchiveStore(),
    now: new Date("2026-08-20T05:31:00.000Z"),
  });
}

describe("OpenCode final semantic red floor", () => {
  test("01 invalid session times use the named native message completion or omit the row", async () => {
    const { dataDir, path } = await fixtureStore("timestamp");
    let fixtureMessageCompletedAt: unknown;
    mutateStore(path, (database) => {
      const row = database.query("SELECT data FROM message WHERE id = ?")
        .get(NAMED_NATIVE_ACTIVITY.recordId) as { data: string };
      fixtureMessageCompletedAt = (JSON.parse(row.data) as {
        time?: { completed?: unknown };
      }).time?.completed;
      database.run(
        "UPDATE session SET time_created = ?, time_updated = ? WHERE id = ?",
        [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, ROOT_SESSION_ID],
      );
    });
    await utimes(path, DATABASE_MTIME, DATABASE_MTIME);
    const databaseMtimeIso = new Date((await stat(path)).mtimeMs).toISOString();

    const result = await collectOpenCodeSessions(dataDir);
    const agent = result.value.find(({ sourceSessionId }) => sourceSessionId === ROOT_SESSION_ID);
    const published = agent
      ? snapshotFor([agent]).programs.flatMap(({ agents }) => agents)[0]
      : undefined;
    const namedTimestampUnavailable = result.errors.some((error) =>
      error.includes(ROOT_SESSION_ID) && /timestamp.*unavailable|activity time.*unavailable/i.test(error)
    );
    const sourceBackedOrNamedOmission = agent
      ? agent.updatedAt === NAMED_NATIVE_ACTIVITY.iso
      : namedTimestampUnavailable;
    const lifecycleFreshWithoutNamedSource = agent !== undefined &&
      agent.updatedAt !== NAMED_NATIVE_ACTIVITY.iso &&
      (agent.status === "running" || published?.lifecycle === "working" || published?.lifecycle === "waiting");

    expect(fixtureMessageCompletedAt).toBe(NAMED_NATIVE_ACTIVITY.epochMs);
    expect({
      sourceBackedOrNamedOmission,
      databaseMtimePublished: agent?.updatedAt === databaseMtimeIso,
      lifecycleFreshWithoutNamedSource,
      invalidSessionFieldsNamed: ["time_created", "time_updated"].every((field) =>
        result.errors.some((error) => error.includes(field) && /omitted/i.test(error))
      ),
    }).toEqual({
      sourceBackedOrNamedOmission: true,
      databaseMtimePublished: false,
      lifecycleFreshWithoutNamedSource: false,
      invalidSessionFieldsNamed: true,
    });
  });

  test("02 corrupt step-finish keeps partial debug sizes but withholds complete-series claims", async () => {
    const { dataDir, path } = await fixtureStore("corrupt-series");
    mutateStore(path, (database) => {
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

    const result = await collectOpenCodeSessions(dataDir);
    const agent = rootAgent(result.value);
    const response = await sessionCallsResponse(snapshotFor(result.value), agent.id, {});
    const body = await response.json() as {
      calls?: number[] | null;
      sessionProcessed?: number | null;
      unavailable?: string;
    };

    expect({
      invalidStepFinishNamed: result.errors.some((error) =>
        /invalid-record.*step-finish.*invalid.*unavailable/i.test(error)
      ),
      retainedPartialCallSizes: agent.callSizes,
      directSessionCounters: {
        input: agent.tokens.input,
        output: agent.tokens.output,
        cachedInput: agent.tokens.cachedInput,
        sessionCachedInput: agent.tokens.sessionCachedInput,
      },
      publishedSessionProcessed: agent.tokens.sessionProcessed,
      endpointCalls: body.calls,
      endpointSessionProcessed: body.sessionProcessed,
      explicitCorruptOrIncompleteReason: typeof body.unavailable === "string" &&
        /corrupt|invalid|incomplete/i.test(body.unavailable),
    }).toEqual({
      invalidStepFinishNamed: true,
      retainedPartialCallSizes: [415],
      directSessionCounters: {
        input: 120,
        output: 30,
        cachedInput: 400,
        sessionCachedInput: 400,
      },
      publishedSessionProcessed: undefined,
      endpointCalls: null,
      endpointSessionProcessed: null,
      explicitCorruptOrIncompleteReason: true,
    });
  });

  test("03 disappeared SQLite session returns a structured non-2xx transcript failure", async () => {
    const { dataDir, path } = await fixtureStore("session-gone");
    const initial = await collectOpenCodeSessions(dataDir);
    const agent = rootAgent(initial.value);
    const snapshot = snapshotFor(initial.value);
    mutateStore(path, (database) => {
      database.run("DELETE FROM part WHERE session_id = ?", [ROOT_SESSION_ID]);
      database.run("DELETE FROM message WHERE session_id = ?", [ROOT_SESSION_ID]);
      database.run("DELETE FROM session WHERE id = ?", [ROOT_SESSION_ID]);
    });

    const response = await transcriptResponse(snapshot, agent.id, 200, {});
    const body = await response.json() as {
      ok?: boolean;
      error?: string | { code?: string; message?: string };
    };
    const error = typeof body.error === "object" && body.error !== null ? body.error : undefined;
    const message = error?.message;

    expect({
      non2xx: response.status < 200 || response.status >= 300,
      ok: body.ok,
      code: error?.code,
      boundedHumanMessage: typeof message === "string" &&
        message.length > 0 && message.length <= 240 &&
        /session/i.test(message) && /gone|missing|no longer/i.test(message),
    }).toEqual({
      non2xx: true,
      ok: false,
      code: "TRANSCRIPT_SESSION_GONE",
      boundedHumanMessage: true,
    });
  });

  test("04 reasoning stays outside output but inside session consumption total", async () => {
    const { dataDir } = await fixtureStore("reasoning-total");
    const agent = rootAgent((await collectOpenCodeSessions(dataDir)).value);

    expect({
      input: agent.tokens.input,
      output: agent.tokens.output,
      cachedInput: agent.tokens.cachedInput,
      sessionTotal: agent.tokens.sessionTotal,
      publicReasoningField: Object.prototype.hasOwnProperty.call(agent.tokens, "reasoning"),
    }).toEqual({
      input: 120,
      output: 30,
      cachedInput: 400,
      sessionTotal: 168,
      publicReasoningField: false,
    });
  });

  test("05 durable archive retains safe OpenCode evidence without private or invented fields", async () => {
    const { dataDir, path } = await fixtureStore("durable-archive");
    const inputSentinel = "SYNTHETIC_TOOL_INPUT_MUST_NOT_ARCHIVE";
    const outputSentinel = "SYNTHETIC_TOOL_OUTPUT_MUST_NOT_ARCHIVE";
    mutateStore(path, (database) => {
      database.run("UPDATE part SET data = ? WHERE id = ?", [
        JSON.stringify({
          type: "tool",
          callID: "call_synthetic_inspect",
          tool: "inspect",
          state: {
            status: "completed",
            title: "Inspect synthetic schema",
            input: { body: inputSentinel },
            output: outputSentinel,
          },
        }),
        "prt_synthetic_assistant_1_tool",
      ]);
    });
    const agent = rootAgent((await collectOpenCodeSessions(dataDir)).value);
    const archivePath = join(dataDir, "archive.json");
    const now = () => Date.parse("2026-08-20T06:00:00.000Z");
    const archive = await JsonArchiveStore.open(archivePath, undefined, now);
    await archive.record([agent]);
    const persisted = await readFile(archivePath, "utf8");
    const reopened = await JsonArchiveStore.open(archivePath, undefined, now);
    const retained = reopened.archivedAgents().find(({ id }) => id === agent.id);

    expect({
      loadError: reopened.loadError(),
      sourceTitle: retained?.sourceTitle,
      rawModel: retained?.rawModel,
      toolInputBodyArchived: persisted.includes(inputSentinel),
      toolOutputBodyArchived: persisted.includes(outputSentinel),
      cost: retained?.cost,
      effort: retained?.effort,
      contextWindow: retained?.tokens.contextWindow,
      contextPct: retained?.contextPct,
    }).toEqual({
      loadError: undefined,
      sourceTitle: {
        text: "Synthetic parser contract",
        provenance: "opencode-source-title-unverified-authorship",
      },
      rawModel: {
        providerRoute: "route-synthetic",
        modelId: "model-alpha",
        rawVariant: "high",
      },
      toolInputBodyArchived: false,
      toolOutputBodyArchived: false,
      cost: undefined,
      effort: undefined,
      contextWindow: undefined,
      contextPct: undefined,
    });
  });
});
