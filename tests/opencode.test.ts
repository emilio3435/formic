import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSnapshot, Provider } from "../src/shared/types";
import { classifyDataDir, type ScanFs } from "../src/server/collector-instances";
import { transcriptResponse } from "../src/server/debug-identity";
import {
  enrichCmuxIdentity,
  identitiesFromCommand,
  identityFromSessionPath,
  isRecognizedAgentProcess,
} from "../src/server/identity";
import { collectOpenCodeSessions } from "../src/server/opencode";
import type { OpenCodeRawModel } from "../src/server/opencode-store";
import { sessionCallsResponse } from "../src/server/session-calls";
import { buildSnapshot } from "../src/server/snapshot";
import { canWriteToTarget, resolveAgentTarget, resolveAgentTargetWithTrace } from "../src/server/targets";
import type {
  ArchiveStore,
  CmuxSurface,
  CollectedAgent,
  CollectionResult,
  CommandResult,
  CommandRunner,
} from "../src/server/types";

const FIXTURE_PATH = join(import.meta.dir, "fixtures", "opencode-current.sql");
const ROOT_SESSION_ID = "ses_synthetic_root";
const CHILD_SESSION_ID = "ses_synthetic_child";
const COMMAND_SESSION_ID = "ses_0123456789abcdefghijklmnop";
const OPENCODE = "opencode" as Provider;
const temporaryDirectories: string[] = [];
const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };

interface SourceTitle {
  text: string;
  provenance: "opencode-source-title-unverified-authorship";
}

type OpenCodeCollectedAgent = CollectedAgent & {
  rawModel?: OpenCodeRawModel;
  sourceTitle?: SourceTitle;
};
type OpenCodeSnapshotAgent = AgentSnapshot & {
  rawModel?: OpenCodeRawModel;
  sourceTitle?: SourceTitle;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixtureSql(): Promise<string> {
  return readFile(FIXTURE_PATH, "utf8");
}

async function optionalSha256(path: string): Promise<string | undefined> {
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex");
  } catch {
    return undefined;
  }
}

function objectLiteralBody(source: string, name: string): string | undefined {
  return source.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\};`))?.[1];
}

async function fixtureDataDir(filenames: readonly string[] = ["opencode.db"]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "formic-opencode-central-"));
  temporaryDirectories.push(directory);
  const sql = await fixtureSql();
  for (const filename of filenames) {
    const database = new Database(join(directory, filename), { create: true });
    try {
      database.exec(sql);
    } finally {
      database.close();
    }
  }
  return directory;
}

function mutateStore(
  dataDir: string,
  filename: string,
  mutate: (database: Database) => void,
): void {
  const database = new Database(join(dataDir, filename));
  try {
    mutate(database);
  } finally {
    database.close();
  }
}

function rootAgent(result: CollectionResult<CollectedAgent[]>): OpenCodeCollectedAgent | undefined {
  return result.value.find(({ sourceSessionId }) => sourceSessionId === ROOT_SESSION_ID) as
    | OpenCodeCollectedAgent
    | undefined;
}

function childAgent(result: CollectionResult<CollectedAgent[]>): OpenCodeCollectedAgent | undefined {
  return result.value.find(({ sourceSessionId }) => sourceSessionId === CHILD_SESSION_ID) as
    | OpenCodeCollectedAgent
    | undefined;
}

function publishedAgents(agents: readonly CollectedAgent[], options: {
  processRosterComplete?: boolean;
  sessionNames?: (agentId: string) => { name: string; by: "launch-env"; at: string } | undefined;
  now?: Date;
  surfaces?: readonly CmuxSurface[];
} = {}): OpenCodeSnapshotAgent[] {
  return buildSnapshot({
    agents,
    surfaces: options.surfaces ?? [],
    archiveStore,
    processRosterComplete: options.processRosterComplete,
    sessionNames: options.sessionNames,
    now: options.now,
  }).programs.flatMap((program) => program.agents) as OpenCodeSnapshotAgent[];
}

function manualOpenCodeAgent(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  const sourceSessionId = overrides.sourceSessionId ?? COMMAND_SESSION_ID;
  return {
    id: `opencode:opencode-db:${sourceSessionId}`,
    provider: OPENCODE,
    instanceId: "opencode:opencode-db",
    instanceLabel: "opencode.db",
    sourceSessionId,
    displayName: "OpenCode · parser-lab",
    identity: {
      name: "OpenCode · parser-lab",
      base: "OpenCode · parser-lab",
      source: "origin-cwd",
    },
    cwd: "/synthetic/workspace/parser-lab",
    originCwd: "/synthetic/workspace/parser-lab",
    status: "running",
    statusReason: "Synthetic OpenCode activity is recent.",
    updatedAt: "2026-08-19T18:00:00.000Z",
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    allowCwdFallback: false,
    ...overrides,
  };
}

function memoryFs(root: string): ScanFs {
  const underRoot = (path: string): boolean => path === root || path.startsWith(`${root}/`);
  return {
    home: () => root,
    readdir: (path) => {
      if (!underRoot(path)) return [];
      try {
        return readdirSync(path);
      } catch {
        return [];
      }
    },
    isDirectory: (path) => {
      if (!underRoot(path)) return false;
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    },
    exists: (path) => underRoot(path) && existsSync(path),
    readTextCapped: () => undefined,
    readAppIdentity: () => undefined,
    processArgv: () => [],
  };
}

function addPartStarvationNoise(dataDir: string): void {
  mutateStore(dataDir, "opencode.db", (database) => {
    database.exec("BEGIN");
    try {
      for (let index = 0; index < 500; index += 1) {
        const suffix = String(index).padStart(3, "0");
        database.run(
          "INSERT INTO part(id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
          [
            `prt_000_central_noise_${suffix}`,
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

describe("OpenCode title provenance", () => {
  test("01 non-placeholder source title reaches collected and snapshot payloads with provenance", async () => {
    const result = await collectOpenCodeSessions(await fixtureDataDir());
    const collected = rootAgent(result);
    const snapshot = publishedAgents(result.value).find(({ sourceSessionId }) =>
      sourceSessionId === ROOT_SESSION_ID
    );

    expect({ collected: collected?.sourceTitle, snapshot: snapshot?.sourceTitle }).toEqual({
      collected: {
        text: "Synthetic parser contract",
        provenance: "opencode-source-title-unverified-authorship",
      },
      snapshot: {
        text: "Synthetic parser contract",
        provenance: "opencode-source-title-unverified-authorship",
      },
    });
  });

  test("02 OpenCode source title never creates authored identity", async () => {
    const agent = rootAgent(await collectOpenCodeSessions(await fixtureDataDir()));

    expect({ source: agent?.identity?.source, authoredBy: agent?.identity?.authoredBy }).toEqual({
      source: "origin-cwd",
      authoredBy: undefined,
    });
  });

  test("03 display identity comes from origin cwd and not the unverified source title", async () => {
    const agent = rootAgent(await collectOpenCodeSessions(await fixtureDataDir()));

    expect({ displayName: agent?.displayName, identityName: agent?.identity?.name }).toEqual({
      displayName: "OpenCode · parser-lab",
      identityName: "OpenCode · parser-lab",
    });
    expect(agent?.displayName).not.toBe("Synthetic parser contract");
  });

  test("04 placeholder title stays absent and never becomes authored identity", async () => {
    const agent = childAgent(await collectOpenCodeSessions(await fixtureDataDir()));

    expect({
      sourceTitle: agent?.sourceTitle,
      identitySource: agent?.identity?.source,
      authoredBy: agent?.identity?.authoredBy,
    }).toEqual({
      sourceTitle: undefined,
      identitySource: "origin-cwd",
      authoredBy: undefined,
    });
  });

  test("05 collector mapping never passes sourceTitle text as makeAgent displayName", async () => {
    const source = await readFile(join(import.meta.dir, "..", "src", "server", "opencode.ts"), "utf8");

    expect(source).not.toMatch(/displayName\s*:\s*(?:\w+\.)*sourceTitle(?:\?\.)?\.text/);
  });

  test("06 remembered Formic name may become authored while sourceTitle alone may not", () => {
    const source = {
      ...manualOpenCodeAgent(),
      sourceTitle: {
        text: "Synthetic parser contract",
        provenance: "opencode-source-title-unverified-authorship",
      },
    } as OpenCodeCollectedAgent;
    const withoutOverlay = publishedAgents([source])[0];
    const withOverlay = publishedAgents([source], {
      sessionNames: (agentId) => agentId === source.id
        ? { name: "Remembered by Formic", by: "launch-env", at: "2026-08-19T18:01:00.000Z" }
        : undefined,
    })[0];

    expect({
      sourceOnly: withoutOverlay?.identity?.source,
      remembered: withOverlay?.identity,
    }).toEqual({
      sourceOnly: "origin-cwd",
      remembered: {
        name: "Remembered by Formic",
        base: "Remembered by Formic",
        source: "authored",
        authoredBy: "launch-env",
      },
    });
  });
});

describe("OpenCode multi-database identity and health", () => {
  test("07 duplicate native ids in release and channel databases stay as two instance-qualified rows", async () => {
    const dataDir = await fixtureDataDir(["opencode.db", "opencode-local.db"]);
    const result = await collectOpenCodeSessions(dataDir);
    const matches = result.value.filter(({ sourceSessionId }) => sourceSessionId === ROOT_SESSION_ID);

    expect(matches.map((agent) => ({
      id: agent.id,
      instanceId: agent.instanceId,
      instanceLabel: agent.instanceLabel,
      sourceSessionId: agent.sourceSessionId,
      labelLeaksPath: agent.instanceLabel?.includes(dataDir) ?? false,
    }))).toEqual([
      {
        id: `opencode:opencode-db:${ROOT_SESSION_ID}`,
        instanceId: expect.any(String),
        instanceLabel: "opencode.db",
        sourceSessionId: ROOT_SESSION_ID,
        labelLeaksPath: false,
      },
      {
        id: `opencode:opencode-local-db:${ROOT_SESSION_ID}`,
        instanceId: expect.any(String),
        instanceLabel: "opencode-local.db",
        sourceSessionId: ROOT_SESSION_ID,
        labelLeaksPath: false,
      },
    ]);
    expect(new Set(matches.map(({ instanceId }) => instanceId)).size).toBe(2);
  });

  test("08 duplicate native ids are not skipped merged or newest-wins", async () => {
    const dataDir = await fixtureDataDir(["opencode.db", "opencode-local.db"]);
    mutateStore(dataDir, "opencode-local.db", (database) => {
      database.run(
        "UPDATE session SET tokens_input = ?, time_updated = ? WHERE id = ?",
        [999, 1784689300000, ROOT_SESSION_ID],
      );
    });

    const result = await collectOpenCodeSessions(dataDir);
    const matches = result.value
      .filter(({ sourceSessionId }) => sourceSessionId === ROOT_SESSION_ID)
      .map((agent) => ({
        label: agent.instanceLabel,
        updatedAt: agent.updatedAt,
        input: agent.tokens.input,
      }));
    expect(matches).toEqual([
      { label: "opencode.db", updatedAt: "2026-07-22T02:59:40.000Z", input: 120 },
      { label: "opencode-local.db", updatedAt: "2026-07-22T03:01:40.000Z", input: 999 },
    ]);
  });

  test("09 locked channel database cannot erase or launder healthy release rows", async () => {
    const dataDir = await fixtureDataDir(["opencode.db", "opencode-local.db"]);
    const writer = new Database(join(dataDir, "opencode-local.db"));
    writer.exec("PRAGMA journal_mode = DELETE; BEGIN EXCLUSIVE");
    try {
      const result = await collectOpenCodeSessions(dataDir);
      expect({
        releaseRows: result.value.filter(({ instanceLabel }) => instanceLabel === "opencode.db").length,
        lockedError: result.errors.some((error) =>
          /opencode-local\.db/i.test(error) && /locked|busy/i.test(error)
        ),
        absent: result.absent,
      }).toEqual({ releaseRows: 2, lockedError: true, absent: undefined });
    } finally {
      writer.exec("ROLLBACK");
      writer.close();
    }
  });

  test("10 readable empty supported database is healthy empty and not absent", async () => {
    const dataDir = await fixtureDataDir();
    mutateStore(dataDir, "opencode.db", (database) => {
      database.exec("DELETE FROM part; DELETE FROM message; DELETE FROM session;");
    });

    expect(await collectOpenCodeSessions(dataDir)).toEqual({ value: [], errors: [] });
  });

  test("11 missing XDG data root is absent with zero rows", async () => {
    const home = await mkdtemp(join(tmpdir(), "formic-opencode-missing-"));
    temporaryDirectories.push(home);

    expect(await collectOpenCodeSessions(join(home, ".local/share/opencode"))).toEqual({
      value: [],
      errors: [],
      absent: true,
    });
  });

  test("12 config-only OpenCode home mints zero rows", async () => {
    const home = await mkdtemp(join(tmpdir(), "formic-opencode-config-only-"));
    temporaryDirectories.push(home);
    await mkdir(join(home, ".config/opencode"), { recursive: true });
    await writeFile(join(home, ".config/opencode/opencode.json"), "{}\n");

    expect(await collectOpenCodeSessions(join(home, ".local/share/opencode"))).toEqual({
      value: [],
      errors: [],
      absent: true,
    });
  });

  test("13 child parentAgentId resolves only inside its own database instance", async () => {
    const result = await collectOpenCodeSessions(
      await fixtureDataDir(["opencode.db", "opencode-local.db"]),
    );
    const published = publishedAgents(result.value);
    const children = published.filter(({ sourceSessionId }) => sourceSessionId === CHILD_SESSION_ID);

    expect(children.map(({ instanceLabel, parentAgentId }) => ({ instanceLabel, parentAgentId }))).toEqual([
      { instanceLabel: "opencode.db", parentAgentId: `opencode:opencode-db:${ROOT_SESSION_ID}` },
      {
        instanceLabel: "opencode-local.db",
        parentAgentId: `opencode:opencode-local-db:${ROOT_SESSION_ID}`,
      },
    ]);
  });

  test("14 extra roots sharing opencode.db keep distinct path-free instance ids", async () => {
    const primary = await mkdtemp(join(tmpdir(), "formic-opencode-primary-missing-"));
    temporaryDirectories.push(primary);
    const first = await fixtureDataDir();
    const second = await fixtureDataDir();
    const result = await collectOpenCodeSessions(join(primary, "missing"), {
      extraDataDirs: [first, second],
    });
    const matches = result.value.filter(({ sourceSessionId }) => sourceSessionId === ROOT_SESSION_ID);

    expect({
      count: matches.length,
      distinctIds: new Set(matches.map(({ id }) => id)).size,
      distinctInstances: new Set(matches.map(({ instanceId }) => instanceId)).size,
      labels: matches.map(({ instanceLabel }) => instanceLabel),
      leaksPrivateRoots: matches.some(({ id, instanceId, instanceLabel }) =>
        [id, instanceId, instanceLabel].some((value) =>
          typeof value === "string" && (value.includes(first) || value.includes(second))
        )
      ),
    }).toEqual({
      count: 2,
      distinctIds: 2,
      distinctInstances: 2,
      labels: ["opencode.db", "opencode.db"],
      leaksPrivateRoots: false,
    });
  });
});

describe("OpenCode usage completeness", () => {
  test("15 complete callSizes derive sessionProcessed while snapshots strip the series", async () => {
    const result = await collectOpenCodeSessions(await fixtureDataDir());
    const collected = rootAgent(result);
    const snapshot = publishedAgents(result.value).find(({ sourceSessionId }) =>
      sourceSessionId === ROOT_SESSION_ID
    );

    expect({
      callSizes: collected?.callSizes,
      collectedTokens: collected?.tokens,
      snapshotCallSizes: (snapshot as OpenCodeSnapshotAgent & { callSizes?: readonly number[] } | undefined)
        ?.callSizes,
      snapshotProcessed: snapshot?.tokens.sessionProcessed,
    }).toEqual({
      callSizes: [415, 153],
      collectedTokens: {
        input: 120,
        output: 30,
        cachedInput: 400,
        total: 153,
        sessionTotal: 168,
        sessionCachedInput: 400,
        sessionProcessed: 568,
        scope: "session",
        provenance: "observed",
      },
      snapshotCallSizes: undefined,
      snapshotProcessed: 568,
    });
  });

  test("16 no valid step-finish means callSizes and sessionProcessed are absent not empty or zero", async () => {
    const agent = childAgent(await collectOpenCodeSessions(await fixtureDataDir()));

    expect({
      agentPresent: agent !== undefined,
      callSizes: agent?.callSizes,
      sessionProcessed: agent?.tokens.sessionProcessed,
    }).toEqual({
      agentPresent: true,
      callSizes: undefined,
      sessionProcessed: undefined,
    });
  });

  test("17 truncated transcript keeps direct callSizes but omits derived sessionProcessed", async () => {
    const dataDir = await fixtureDataDir();
    addPartStarvationNoise(dataDir);
    const result = await collectOpenCodeSessions(dataDir);
    const collected = rootAgent(result);
    const snapshot = publishedAgents(result.value).find(({ sourceSessionId }) =>
      sourceSessionId === ROOT_SESSION_ID
    );

    expect({
      callSizes: collected?.callSizes,
      collectedProcessed: collected?.tokens.sessionProcessed,
      snapshotProcessed: snapshot?.tokens.sessionProcessed,
      observedSessionTotal: snapshot?.tokens.sessionTotal,
      truncationNamed: result.errors.some((error) => /truncat/i.test(error)),
    }).toEqual({
      callSizes: [415, 153],
      collectedProcessed: undefined,
      snapshotProcessed: undefined,
      observedSessionTotal: 168,
      truncationNamed: true,
    });
  });

  test("18 deadline-incomplete store retains a complete accepted sessionProcessed series", async () => {
    let checks = 0;
    const result = await collectOpenCodeSessions(await fixtureDataDir(), {
      readOptions: {
        deadlineAtMs: 50,
        nowMs: () => checks++ < 6 ? 0 : 50,
      },
    });
    const agent = rootAgent(result);

    expect({
      checksAdvancedPastAcceptedBundle: checks > 6,
      sessionProcessed: agent?.tokens.sessionProcessed,
      callSizes: agent?.callSizes,
      deadlineNamed: result.errors.some((error) => /deadline|incomplete|not enumerated/i.test(error)),
    }).toEqual({
      checksAdvancedPastAcceptedBundle: true,
      sessionProcessed: 568,
      callSizes: [415, 153],
      deadlineNamed: true,
    });
  });

  test("19 truncated session-calls returns explicit unavailability and never an unexplained calls array", async () => {
    const dataDir = await fixtureDataDir();
    addPartStarvationNoise(dataDir);
    const source = join(dataDir, "opencode.db");
    const collected = manualOpenCodeAgent({
      sourceSessionId: ROOT_SESSION_ID,
      id: `opencode:opencode-db:${ROOT_SESSION_ID}`,
      artifacts: [{ label: "OpenCode store", path: source, kind: "transcript" }],
    });
    const snapshot = buildSnapshot({ agents: [collected], surfaces: [], archiveStore });
    const response = await sessionCallsResponse(snapshot, collected.id, {});
    const body = await response.json() as { calls?: unknown; unavailable?: unknown };

    expect({
      calls: body.calls,
      explainsTruncation: typeof body.unavailable === "string" && /truncat|incomplete/i.test(body.unavailable),
    }).toEqual({ calls: null, explainsTruncation: true });
  });

  test("20 invalid step-finish is omitted from callSizes while latest fallback remains direct", async () => {
    const dataDir = await fixtureDataDir();
    mutateStore(dataDir, "opencode.db", (database) => {
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
    const agent = rootAgent(await collectOpenCodeSessions(dataDir));

    expect({
      callSizes: agent?.callSizes,
      latestTotal: agent?.tokens.total,
      sessionProcessed: agent?.tokens.sessionProcessed,
    }).toEqual({ callSizes: [415], latestTotal: 153, sessionProcessed: undefined });
  });
});

describe("OpenCode controls process and lifecycle", () => {
  test("21 allowCwdFallback false keeps a unique cwd view-only", () => {
    const agent = manualOpenCodeAgent();
    const target = resolveAgentTarget(agent, [{
      surfaceId: "SURFACE-UNIQUE-OPENCODE-CWD",
      cwd: agent.cwd,
      sourceSessionIds: [],
    }]);

    expect({
      allowCwdFallback: agent.allowCwdFallback,
      resolution: target.resolution,
      writable: canWriteToTarget(target),
    }).toEqual({ allowCwdFallback: false, resolution: "missing", writable: false });
  });

  test("22 exact provider-qualified cmux claim resolves one OpenCode row exactly", () => {
    const agent = manualOpenCodeAgent();
    const target = resolveAgentTarget(agent, [{
      surfaceId: "SURFACE-EXACT-OPENCODE",
      sourceSessionClaims: [{ provider: OPENCODE, sessionId: agent.sourceSessionId }],
      sourceSessionIds: [agent.sourceSessionId],
      runtimeSurfaceReady: true,
    }]);

    expect(target).toMatchObject({
      surfaceId: "SURFACE-EXACT-OPENCODE",
      resolution: "exact",
      attestation: "live",
    });
  });

  test("23 duplicate OpenCode instances reject one unqualified cmux claim as ambiguous", () => {
    const first = manualOpenCodeAgent();
    const second = manualOpenCodeAgent({
      id: `opencode:opencode-local-db:${COMMAND_SESSION_ID}`,
      instanceId: "opencode:opencode-local-db",
      instanceLabel: "opencode-local.db",
    });
    const surface = {
      surfaceId: "SURFACE-UNQUALIFIED-OPENCODE-COLLISION",
      sourceSessionIds: [COMMAND_SESSION_ID],
    };
    const targets = [first, second].map((agent) =>
      resolveAgentTarget(agent, [surface], [first, second])
    );

    expect(targets.map((target) => ({
      resolution: target.resolution,
      writable: canWriteToTarget(target),
    }))).toEqual([
      { resolution: "missing", writable: false },
      { resolution: "missing", writable: false },
    ]);
  });

  test("24 one OpenCode database open for two sessions is not exact or conflicted", async () => {
    const first = manualOpenCodeAgent();
    const second = manualOpenCodeAgent({
      id: "opencode:opencode-db:ses_abcdefghijklmnopqrstuvwxyz",
      sourceSessionId: "ses_abcdefghijklmnopqrstuvwxyz",
    });
    const surface: CmuxSurface = {
      surfaceId: "SURFACE-OPENCODE-SHARED-HOST",
      tty: "ttys077",
      sourceSessionIds: [],
    };
    const responses: CommandResult[] = [
      {
        exitCode: 0,
        stdout: "4242 ttys077 /opt/homebrew/bin/opencode",
        stderr: "",
        timedOut: false,
      },
      {
        exitCode: 0,
        stdout: "p4242\nn/synthetic/store/opencode.db",
        stderr: "",
        timedOut: false,
      },
    ];
    const runner: CommandRunner = {
      run: async () => responses.shift() ?? {
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
      },
    };
    const enriched = await enrichCmuxIdentity([surface], [first, second], runner);
    const observed = enriched.value[0]!;
    const target = resolveAgentTarget(first, [observed], [first, second]);

    expect({
      exact: target.resolution === "exact",
      writable: canWriteToTarget(target),
      identityConflict: observed.identityConflict,
    }).toEqual({ exact: false, writable: false, identityConflict: undefined });
  });

  test("25 OpenCode database path never becomes a session identity hint", () => {
    expect(identityFromSessionPath("/synthetic/store/opencode.db")).toBeNull();
  });

  test("26 complete process roster cannot finish a quiet OpenCode row without exact session evidence", () => {
    const agent = manualOpenCodeAgent({
      status: "stale",
      statusReason: "Synthetic OpenCode activity is quiet.",
      updatedAt: "2026-08-19T12:00:00.000Z",
    });
    const published = publishedAgents([agent], {
      processRosterComplete: true,
      now: new Date("2026-08-19T18:00:00.000Z"),
    })[0];

    expect({
      lifecycle: published?.lifecycle,
      provenance: published?.provenance,
      processRosterComplete: published?.processRosterComplete,
    }).toEqual({
      lifecycle: "unverified",
      provenance: "no-evidence",
      processRosterComplete: undefined,
    });
  });

  test("27 provider archive timestamp maps to session-exit independently of process evidence", async () => {
    const result = await collectOpenCodeSessions(await fixtureDataDir());
    const collected = childAgent(result);
    const snapshot = publishedAgents(result.value).find(({ sourceSessionId }) =>
      sourceSessionId === CHILD_SESSION_ID
    );

    expect({ collected: collected?.endEvidence, snapshot: snapshot?.endEvidence }).toEqual({
      collected: "session-exit",
      snapshot: "session-exit",
    });
  });

  test("28 exact-identity refusal copy is provider-neutral and names OpenCode", () => {
    const agent = manualOpenCodeAgent();
    const { target, trace } = resolveAgentTargetWithTrace(agent, []);
    const detail = `${target.reason ?? ""} ${trace.steps.map(({ detail }) => detail).join(" ")}`;

    expect({ namesOpenCode: /OpenCode/i.test(detail), leaksCursorCopy: /Cursor GUI/i.test(detail) })
      .toEqual({ namesOpenCode: true, leaksCursorCopy: false });
  });

  test("29 OpenCode binary is recognized without implying a bare-command session id", () => {
    expect({
      recognized: isRecognizedAgentProcess("/opt/homebrew/bin/opencode"),
      hints: identitiesFromCommand("/opt/homebrew/bin/opencode"),
    }).toEqual({ recognized: true, hints: [] });
  });

  test("30 Inspector rehydrates reasoning and tool roles from SQLite without tool bodies", async () => {
    const dataDir = await fixtureDataDir();
    const source = join(dataDir, "opencode.db");
    const collected = manualOpenCodeAgent({
      sourceSessionId: ROOT_SESSION_ID,
      id: `opencode:opencode-db:${ROOT_SESSION_ID}`,
      artifacts: [{ label: "OpenCode store", path: source, kind: "transcript" }],
    });
    const snapshot = buildSnapshot({ agents: [collected], surfaces: [], archiveStore });
    const response = await transcriptResponse(snapshot, collected.id, 200, {});
    const body = await response.json() as { lines?: Array<{ role?: string; text?: string }> };
    const serialized = JSON.stringify(body);

    expect({
      thought: body.lines?.some(({ role, text }) =>
        role === "system" && text === "Thought\nCheck native relationship keys."
      ) ?? false,
      tool: body.lines?.some(({ role }) => role === "tool") ?? false,
      leaksToolBody: serialized.includes("Synthetic inspection complete."),
    }).toEqual({ thought: true, tool: true, leaksToolBody: false });
  });

  test("31 exact OpenCode command selectors attest full native ids across entrypoints", () => {
    const commands = [
      `opencode --session ${COMMAND_SESSION_ID}`,
      `opencode --session=${COMMAND_SESSION_ID}`,
      `opencode -s ${COMMAND_SESSION_ID}`,
      `/opt/homebrew/bin/opencode --session ${COMMAND_SESSION_ID}`,
      `opencode run --session ${COMMAND_SESSION_ID}`,
      `opencode run --session=${COMMAND_SESSION_ID}`,
      `opencode run -s ${COMMAND_SESSION_ID}`,
      `opencode attach --session ${COMMAND_SESSION_ID}`,
      `opencode attach -s ${COMMAND_SESSION_ID}`,
    ];

    expect(commands.map((command) => identitiesFromCommand(command))).toEqual(
      commands.map(() => [{ provider: OPENCODE, value: COMMAND_SESSION_ID, full: true }]),
    );
  });

  test("32 OpenCode session selector plus fork never attests the source session", () => {
    const commands = [
      `opencode --session ${COMMAND_SESSION_ID} --fork`,
      `opencode --fork --session ${COMMAND_SESSION_ID}`,
      `opencode -s ${COMMAND_SESSION_ID} --fork`,
      `opencode --fork -s ${COMMAND_SESSION_ID}`,
    ];

    expect(commands.map((command) => identitiesFromCommand(command))).toEqual(commands.map(() => []));
  });

  test("33 continuation resume guesses malformed ids UUIDs and bare OpenCode emit no hint", () => {
    const commands = [
      "opencode --continue",
      "opencode -c",
      "opencode",
      `opencode --resume ${COMMAND_SESSION_ID}`,
      "opencode --resume 11111111-2222-4333-8444-555555555555",
      "opencode --session ses_",
      "opencode --session ses_short",
      "opencode --session 11111111-2222-4333-8444-555555555555",
    ];

    expect(commands.map((command) => identitiesFromCommand(command))).toEqual(commands.map(() => []));
  });
});

describe("OpenCode discovery and health", () => {
  test("34 supported database in the XDG data root classifies as collectable OpenCode", async () => {
    const home = await mkdtemp(join(tmpdir(), "formic-opencode-discovery-"));
    temporaryDirectories.push(home);
    const dataDir = join(home, ".local/share/opencode");
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, "opencode.db"), "synthetic classification marker");

    const classified = classifyDataDir(dataDir, memoryFs(home));
    const observed = classified
      ? {
          kind: String(classified.kind),
          provider: String(classified.provider),
          dataDir: classified.dataDir,
          label: classified.label,
          default: classified.default,
        }
      : undefined;
    expect(observed).toEqual({
      kind: "opencode",
      provider: "opencode",
      dataDir,
      label: "opencode",
      default: true,
    });
  });

  test("35 source states stay distinct across absent empty populated degraded incomplete and unreadable stores", async () => {
    const missingHome = await mkdtemp(join(tmpdir(), "formic-opencode-health-missing-"));
    temporaryDirectories.push(missingHome);
    const absent = await collectOpenCodeSessions(join(missingHome, "missing"));

    const emptyDir = await fixtureDataDir();
    mutateStore(emptyDir, "opencode.db", (database) => {
      database.exec("DELETE FROM part; DELETE FROM message; DELETE FROM session;");
    });
    const empty = await collectOpenCodeSessions(emptyDir);

    const populated = await collectOpenCodeSessions(await fixtureDataDir());

    const truncatedDir = await fixtureDataDir();
    addPartStarvationNoise(truncatedDir);
    const truncated = await collectOpenCodeSessions(truncatedDir);

    let deadlineChecks = 0;
    const incomplete = await collectOpenCodeSessions(await fixtureDataDir(), {
      readOptions: {
        deadlineAtMs: 50,
        nowMs: () => deadlineChecks++ < 6 ? 0 : 50,
      },
    });

    const corruptDir = await mkdtemp(join(tmpdir(), "formic-opencode-health-corrupt-"));
    temporaryDirectories.push(corruptDir);
    await writeFile(join(corruptDir, "opencode.db"), "synthetic non-SQLite input");
    const corrupt = await collectOpenCodeSessions(corruptDir);

    const schemaDir = await fixtureDataDir();
    mutateStore(schemaDir, "opencode.db", (database) => {
      database.run("DELETE FROM migration WHERE id = ?", ["20260622202450_simplify_session_input"]);
    });
    const schema = await collectOpenCodeSessions(schemaDir);

    const lockedDir = await fixtureDataDir();
    const writer = new Database(join(lockedDir, "opencode.db"));
    writer.exec("PRAGMA journal_mode = DELETE; BEGIN EXCLUSIVE");
    let locked: CollectionResult<CollectedAgent[]>;
    try {
      locked = await collectOpenCodeSessions(lockedDir);
    } finally {
      writer.exec("ROLLBACK");
      writer.close();
    }

    expect({
      absent: absent.absent === true && absent.value.length === 0 && absent.errors.length === 0,
      healthyEmpty: empty.absent !== true && empty.value.length === 0 && empty.errors.length === 0,
      healthyPopulated: populated.value.length > 0 && populated.errors.length === 0,
      degradedTruncated: truncated.value.length > 0 && truncated.errors.some((error) => /truncat/i.test(error)),
      deadlineIncomplete: incomplete.value.length > 0 && incomplete.errors.some((error) =>
        /deadline|incomplete|not enumerated/i.test(error)
      ),
      locked: locked!.absent !== true && locked!.value.length === 0 && locked!.errors.some((error) =>
        /locked|busy/i.test(error)
      ),
      corrupt: corrupt.absent !== true && corrupt.value.length === 0 && corrupt.errors.some((error) =>
        /corrupt|not SQLite/i.test(error)
      ),
      schema: schema.absent !== true && schema.value.length === 0 && schema.errors.some((error) =>
        /schema|migration/i.test(error)
      ),
    }).toEqual({
      absent: true,
      healthyEmpty: true,
      healthyPopulated: true,
      degradedTruncated: true,
      deadlineIncomplete: true,
      locked: true,
      corrupt: true,
      schema: true,
    });
  });
});

describe("OpenCode official marks and raw-model honesty", () => {
  test("36 official harness and provider-route assets match the vendor pin and every mark map uses the right one", async () => {
    const harnessAsset = join(import.meta.dir, "..", "src", "web", "icons", "opencode.svg");
    const providerRouteAsset = join(import.meta.dir, "..", "src", "web", "icons", "opencode-provider.svg");
    const appSource = await readFile(join(import.meta.dir, "..", "src", "web", "app.js"), "utf8");
    const settingsSource = await readFile(
      join(import.meta.dir, "..", "src", "web", "settings-collectors.js"),
      "utf8",
    );
    const harnessMarks = objectLiteralBody(appSource, "HARNESS_MARK") ?? "";
    const providerMarks = objectLiteralBody(appSource, "PROVIDER_MARK") ?? "";
    const settingsMarks = objectLiteralBody(settingsSource, "HOME_MARK") ?? "";

    expect({
      harnessAssetSha256: await optionalSha256(harnessAsset),
      providerRouteAssetSha256: await optionalSha256(providerRouteAsset),
      harnessMapUsesHarnessAsset: /opencode:\s*\{\s*src:\s*"\/icons\/opencode\.svg",\s*label:\s*"OpenCode"\s*\}/.test(harnessMarks),
      settingsMapUsesHarnessAsset: /opencode:\s*"\/icons\/opencode\.svg"/.test(settingsMarks),
      providerMapUsesProviderRouteAsset: /opencode:\s*\{\s*src:\s*"\/icons\/opencode-provider\.svg"\s*\}/.test(providerMarks),
    }).toEqual({
      harnessAssetSha256: "e29bbe33380ad1c1ada9134b52f229d30e9776d60481512c9d81f2bb6f37def9",
      providerRouteAssetSha256: "018a85654f13635373dc283ecc27928fa4e001c06cde47f7efa1cbcab567b51c",
      harnessMapUsesHarnessAsset: true,
      settingsMapUsesHarnessAsset: true,
      providerMapUsesProviderRouteAsset: true,
    });
  });

  test("37 raw model route id and variant reach collection and snapshot without invented effort or catalog data", async () => {
    const result = await collectOpenCodeSessions(await fixtureDataDir());
    const collected = rootAgent(result);
    const snapshot = buildSnapshot({
      agents: result.value,
      surfaces: [],
      archiveStore,
      now: new Date("2026-08-19T18:01:00.000Z"),
    });
    const published = snapshot.programs
      .flatMap((program) => program.agents)
      .find(({ sourceSessionId }) => sourceSessionId === ROOT_SESSION_ID) as
        | OpenCodeSnapshotAgent
        | undefined;
    const syntheticModel = "route-synthetic/model-alpha";

    expect({
      collectedModel: collected?.model,
      collectedRawModel: collected?.rawModel,
      collectedEffort: collected?.effort,
      collectedContextWindow: collected?.tokens.contextWindow,
      snapshotModel: published?.model,
      snapshotRawModel: published?.rawModel,
      snapshotEffort: published?.effort,
      snapshotContextWindow: published?.tokens.contextWindow,
      snapshotContextPct: published?.contextPct,
      catalogLabel: snapshot.modelConfig?.displayLabels[syntheticModel],
    }).toEqual({
      collectedModel: syntheticModel,
      collectedRawModel: {
        providerRoute: "route-synthetic",
        modelId: "model-alpha",
        rawVariant: "high",
      },
      collectedEffort: undefined,
      collectedContextWindow: undefined,
      snapshotModel: syntheticModel,
      snapshotRawModel: {
        providerRoute: "route-synthetic",
        modelId: "model-alpha",
        rawVariant: "high",
      },
      snapshotEffort: undefined,
      snapshotContextWindow: undefined,
      snapshotContextPct: undefined,
      catalogLabel: undefined,
    });
  });
});
