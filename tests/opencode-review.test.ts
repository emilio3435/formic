import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { MemoryArchiveStore } from "../src/server/archive";
import { transcriptResponse } from "../src/server/debug-identity";
import { enrichCmuxIdentity, identitiesFromCommand } from "../src/server/identity";
import { collectOpenCodeSessions } from "../src/server/opencode";
import { sessionCallsResponse } from "../src/server/session-calls";
import { buildSnapshot } from "../src/server/snapshot";
import type { CollectedAgent, CommandResult, CommandRunner } from "../src/server/types";

const FIXTURE_PATH = join(import.meta.dir, "fixtures", "opencode-current.sql");
const ROOT_SESSION_ID = "ses_synthetic_root";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `formic-opencode-review-${label}-`));
  temporaryDirectories.push(root);
  return root;
}

async function writeFixtureStore(
  dataDir: string,
  filename = "opencode.db",
  rootInput?: number,
): Promise<string> {
  await mkdir(dataDir, { recursive: true });
  const path = join(dataDir, filename);
  const database = new Database(path, { create: true });
  try {
    database.exec(await readFile(FIXTURE_PATH, "utf8"));
    if (rootInput !== undefined) {
      database.run("UPDATE session SET tokens_input = ? WHERE id = ?", [rootInput, ROOT_SESSION_ID]);
    }
  } finally {
    database.close();
  }
  return path;
}

function mutateStore(path: string, mutate: (database: Database) => void): void {
  const database = new Database(path);
  try {
    mutate(database);
  } finally {
    database.close();
  }
}

function snapshotFor(agents: readonly CollectedAgent[]) {
  return buildSnapshot({ agents, surfaces: [], archiveStore: new MemoryArchiveStore() });
}

function rootAgent(agents: readonly CollectedAgent[]): CollectedAgent {
  const agent = agents.find(({ sourceSessionId }) => sourceSessionId === ROOT_SESSION_ID);
  if (!agent) throw new Error("synthetic OpenCode root session was not collected");
  return agent;
}

interface ChildCollection {
  value: Array<{
    sourceSessionId: string;
    instanceLabel?: string;
    tokens: { input?: number };
  }>;
  errors: string[];
  absent?: boolean;
}

async function collectRealHomeInChild(options: {
  home: string;
  xdgDataHome: string;
  opencodeDb: string;
  clearOverride?: boolean;
}): Promise<ChildCollection> {
  const collectorUrl = pathToFileURL(join(import.meta.dir, "..", "src", "server", "collectors.ts")).href;
  const childSource = `
    if (process.env.FORMIC_CLEAR_OPENCODE_DB === "1") delete process.env.OPENCODE_DB;
    const { collectSessionProvider } = await import(process.env.FORMIC_COLLECTOR_URL);
    const result = await collectSessionProvider("opencode");
    process.stdout.write(JSON.stringify(result));
  `;
  const child = Bun.spawn([process.execPath, "-e", childSource], {
    cwd: join(import.meta.dir, ".."),
    env: {
      ...process.env,
      HOME: options.home,
      XDG_DATA_HOME: options.xdgDataHome,
      OPENCODE_DB: options.opencodeDb,
      FORMIC_CLEAR_OPENCODE_DB: options.clearOverride ? "1" : "0",
      FORMIC_COLLECTOR_URL: collectorUrl,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`synthetic OpenCode child failed (${exitCode}): ${stderr.trim()}`);
  }
  return JSON.parse(stdout) as ChildCollection;
}

function addPartWindowNoise(path: string): void {
  mutateStore(path, (database) => {
    database.exec("BEGIN");
    try {
      for (let index = 0; index < 500; index += 1) {
        const suffix = String(index).padStart(3, "0");
        database.run(
          "INSERT INTO part(id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
          [
            `prt_review_noise_${suffix}`,
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
}

describe("OpenCode owner-review red floor", () => {
  test("01 primary instance identity stays stable when a same-named extra root appears", async () => {
    const primaryRoot = await temporaryRoot("stable-primary");
    const extraRoot = await temporaryRoot("stable-extra");
    await writeFixtureStore(primaryRoot);
    await writeFixtureStore(extraRoot);

    const before = rootAgent((await collectOpenCodeSessions(primaryRoot)).value);
    const after = (await collectOpenCodeSessions(primaryRoot, { extraDataDirs: [extraRoot] })).value
      .filter(({ sourceSessionId }) => sourceSessionId === ROOT_SESSION_ID);
    const primaryAfter = after[0]!;
    const extraAfter = after[1]!;

    expect({
      stableId: primaryAfter.id === before.id,
      stableInstanceId: primaryAfter.instanceId === before.instanceId,
      extraDistinct: extraAfter.id !== primaryAfter.id && extraAfter.instanceId !== primaryAfter.instanceId,
      pathFree: ![extraAfter.id, extraAfter.instanceId, extraAfter.instanceLabel].some((value) =>
        typeof value === "string" && (value.includes(primaryRoot) || value.includes(extraRoot))
      ),
    }).toEqual({ stableId: true, stableInstanceId: true, extraDistinct: true, pathFree: true });
  });

  test("02 real-home collection defaults to XDG_DATA_HOME/opencode", async () => {
    const root = await temporaryRoot("xdg-default");
    const home = join(root, "home");
    const xdgDataHome = join(root, "xdg-data");
    await mkdir(home, { recursive: true });
    await writeFixtureStore(join(xdgDataHome, "opencode"), "opencode.db", 202);

    const result = await collectRealHomeInChild({
      home,
      xdgDataHome,
      opencodeDb: join(root, "safe-unused", "opencode.db"),
      clearOverride: true,
    });

    const observedInput = result.value.find(({ sourceSessionId }) =>
      sourceSessionId === ROOT_SESSION_ID
    )?.tokens.input;
    expect(observedInput).toBe(202);
  });

  test("03 absolute and relative OPENCODE_DB overrides replace the default database", async () => {
    const root = await temporaryRoot("db-overrides");
    const home = join(root, "home");
    const xdgDataHome = join(root, "xdg-data");
    await writeFixtureStore(join(home, ".local", "share", "opencode"), "opencode.db", 301);
    await writeFixtureStore(join(xdgDataHome, "opencode"), "opencode.db", 302);
    const absolute = await writeFixtureStore(join(root, "absolute"), "opencode-absolute.db", 311);
    await writeFixtureStore(join(xdgDataHome, "opencode"), "opencode-relative.db", 312);

    const absoluteResult = await collectRealHomeInChild({ home, xdgDataHome, opencodeDb: absolute });
    const relativeResult = await collectRealHomeInChild({
      home,
      xdgDataHome,
      opencodeDb: "opencode-relative.db",
    });

    expect({
      absolute: rootAgent(absoluteResult.value as CollectedAgent[]).tokens.input,
      relative: rootAgent(relativeResult.value as CollectedAgent[]).tokens.input,
    }).toEqual({ absolute: 311, relative: 312 });
  });

  test("04 OPENCODE_DB memory mode mints no durable rows even beside a default file", async () => {
    const root = await temporaryRoot("memory");
    const home = join(root, "home");
    const xdgDataHome = join(root, "xdg-data");
    await writeFixtureStore(join(home, ".local", "share", "opencode"));
    await writeFixtureStore(join(xdgDataHome, "opencode"));

    const result = await collectRealHomeInChild({ home, xdgDataHome, opencodeDb: ":memory:" });

    expect({ rows: result.value.length, errors: result.errors }).toEqual({ rows: 0, errors: [] });
  });

  test("05 complete callSizes without session counters still have session scope", async () => {
    const root = await temporaryRoot("processed-scope");
    const path = await writeFixtureStore(root);
    mutateStore(path, (database) => {
      database.run("UPDATE session SET tokens_input = -1 WHERE id = ?", [ROOT_SESSION_ID]);
    });

    const agent = rootAgent((await collectOpenCodeSessions(root)).value);

    expect({ callSizes: agent.callSizes, sessionProcessed: agent.tokens.sessionProcessed, scope: agent.tokens.scope })
      .toEqual({ callSizes: [415, 153], sessionProcessed: 568, scope: "session" });
  });

  test("06 mixed-case command identity preserves native spelling and matches case-insensitively", async () => {
    const nativeId = "ses_0123456789AbCdEfGhIjKlMnOp";
    const selectorId = "ses_0123456789aBcDeFgHiJkLmNoP";
    const agent: CollectedAgent = {
      id: `opencode:opencode-db:${nativeId}`,
      provider: "opencode",
      sourceSessionId: nativeId,
      displayName: "OpenCode review identity",
      cwd: "/synthetic/workspace",
      status: "running",
      statusReason: "Synthetic OpenCode command is running.",
      updatedAt: "2026-08-19T18:00:00.000Z",
      tokens: { provenance: "unknown" },
      artifacts: [],
      gates: [],
      allowCwdFallback: false,
    };
    const command = `/opt/homebrew/bin/opencode --session ${selectorId}`;
    const responses: CommandResult[] = [
      { exitCode: 0, stdout: `4242 ttys077 ${command}`, stderr: "", timedOut: false },
      { exitCode: 0, stdout: "p4242\n", stderr: "", timedOut: false },
    ];
    const runner: CommandRunner = {
      run: async () => responses.shift() ?? {
        exitCode: 0, stdout: "", stderr: "", timedOut: false,
      },
    };
    const enriched = await enrichCmuxIdentity(
      [{ surfaceId: "SURFACE-MIXED-CASE", tty: "ttys077", sourceSessionIds: [] }],
      [agent],
      runner,
    );

    expect({
      parsedValue: identitiesFromCommand(command)[0]?.value,
      resolvedSessionIds: enriched.value[0]?.sourceSessionIds,
    }).toEqual({ parsedValue: selectorId, resolvedSessionIds: [nativeId] });
  });

  test("07 Inspector tool cards keep call id and status while omitting bodies", async () => {
    const root = await temporaryRoot("tool-card");
    const path = await writeFixtureStore(root);
    mutateStore(path, (database) => {
      database.run("UPDATE part SET data = ? WHERE id = ?", [
        JSON.stringify({
          type: "tool",
          callID: "call_synthetic_inspect",
          tool: "inspect",
          state: {
            status: "completed",
            title: "Inspect synthetic schema",
            input: { marker: "SYNTHETIC_TOOL_INPUT_BODY" },
            output: "SYNTHETIC_TOOL_OUTPUT_BODY",
          },
        }),
        "prt_synthetic_assistant_1_tool",
      ]);
    });
    const result = await collectOpenCodeSessions(root);
    const agent = rootAgent(result.value);
    const body = await (await transcriptResponse(snapshotFor(result.value), agent.id, 200, {})).json() as {
      lines: Array<{ role: string; text: string }>;
    };
    const tool = body.lines.find(({ role }) => role === "tool");
    const serialized = JSON.stringify(tool);

    expect({
      callId: tool?.text.includes("call_synthetic_inspect") ?? false,
      status: tool?.text.includes("completed") ?? false,
      inputBody: serialized.includes("SYNTHETIC_TOOL_INPUT_BODY"),
      outputBody: serialized.includes("SYNTHETIC_TOOL_OUTPUT_BODY"),
    }).toEqual({ callId: true, status: true, inputBody: false, outputBody: false });
  });

  test("08 session-calls keeps an accepted complete series outside the later store window", async () => {
    const root = await temporaryRoot("session-window");
    const path = await writeFixtureStore(root);
    const initial = await collectOpenCodeSessions(root);
    const agent = rootAgent(initial.value);
    const snapshot = snapshotFor(initial.value);
    mutateStore(path, (database) => {
      for (let index = 0; index < 55; index += 1) {
        const suffix = String(index).padStart(3, "0");
        database.run(
          "INSERT INTO session(id, project_id, slug, directory, title, version, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [
            `ses_review_newer_${suffix}`,
            "prj_synthetic",
            `review-newer-${suffix}`,
            `/synthetic/workspace/newer-${suffix}`,
            `Synthetic newer session ${suffix}`,
            "local-test",
            1784691000000 + index,
            1784691000000 + index,
          ],
        );
      }
    });

    const body = await (await sessionCallsResponse(snapshot, agent.id, {})).json() as {
      calls?: number[] | null;
      sessionProcessed?: number | null;
      unavailable?: string;
    };

    expect({ calls: body.calls, sessionProcessed: body.sessionProcessed, unavailable: body.unavailable })
      .toEqual({ calls: [415, 153], sessionProcessed: 568, unavailable: undefined });
  });

  test("09 Inspector truncation includes parser truncation below the response line limit", async () => {
    const root = await temporaryRoot("inspector-truncated");
    const path = await writeFixtureStore(root);
    addPartWindowNoise(path);
    const result = await collectOpenCodeSessions(root);
    const agent = rootAgent(result.value);
    const body = await (await transcriptResponse(snapshotFor(result.value), agent.id, 200, {})).json() as {
      truncated: boolean;
      lines: unknown[];
    };

    expect({ belowResponseLimit: body.lines.length < 200, truncated: body.truncated })
      .toEqual({ belowResponseLimit: true, truncated: true });
  });

  test("10 Inspector names a native session that disappeared after snapshot collection", async () => {
    const root = await temporaryRoot("missing-session");
    const path = await writeFixtureStore(root);
    const initial = await collectOpenCodeSessions(root);
    const agent = rootAgent(initial.value);
    const snapshot = snapshotFor(initial.value);
    mutateStore(path, (database) => {
      database.exec("DELETE FROM part; DELETE FROM message; DELETE FROM session;");
    });

    const response = await transcriptResponse(snapshot, agent.id, 200, {});
    const body = await response.json() as {
      ok?: boolean;
      error?: { code?: string; message?: string };
    };

    expect({
      status: response.status,
      ok: body.ok,
      code: body.error?.code,
      explicitAbsence: /absent|contain|longer present|missing/i.test(body.error?.message ?? ""),
    }).toEqual({ status: 410, ok: false, code: "TRANSCRIPT_SESSION_GONE", explicitAbsence: true });
  });

  test("11 a discovered non-regular opencode.db is unhealthy rather than absent", async () => {
    const root = await temporaryRoot("non-regular");
    await mkdir(join(root, "opencode.db"));

    const result = await collectOpenCodeSessions(root);

    expect({
      rows: result.value.length,
      absent: result.absent === true,
      namedError: result.errors.some((error) => /opencode\.db/i.test(error) && /regular|read|file/i.test(error)),
    }).toEqual({ rows: 0, absent: false, namedError: true });
  });

  test("12 archive retention keeps source-title and raw-model evidence without invention", async () => {
    const root = await temporaryRoot("archive-evidence");
    await writeFixtureStore(root);
    const agent = rootAgent((await collectOpenCodeSessions(root)).value);
    const archive = new MemoryArchiveStore();
    await archive.record([agent]);
    const retained = archive.archivedAgents()[0] as CollectedAgent & { contextPct?: number };

    expect({
      sourceTitle: retained.sourceTitle,
      rawModel: retained.rawModel,
      effort: retained.effort,
      contextWindow: retained.tokens.contextWindow,
      contextPct: retained.contextPct,
    }).toEqual({
      sourceTitle: {
        text: "Synthetic parser contract",
        provenance: "opencode-source-title-unverified-authorship",
      },
      rawModel: {
        providerRoute: "route-synthetic",
        modelId: "model-alpha",
        rawVariant: "high",
      },
      effort: undefined,
      contextWindow: undefined,
      contextPct: undefined,
    });
  });
});
