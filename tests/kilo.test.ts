import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { renameSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { PROVIDERS, type Provider } from "../src/shared/types";
import { defaultHomes } from "../src/server/collector-instances";
import {
  collectSessionProvider,
  finalizeSessionProviders,
  type SessionProviderResults,
} from "../src/server/collectors";
import { readHookSessionStores } from "../src/server/cmux-hook-sessions";
import { collectKiloSessions, type KiloCollectOptions } from "../src/server/kilo";
import { KILO_STORE_LIMITS } from "../src/server/kilo-store";
import { transcriptResponse } from "../src/server/debug-identity";
import { identitiesFromCommand } from "../src/server/identity";
import { sessionCallsResponse } from "../src/server/session-calls";
import { buildSnapshot } from "../src/server/snapshot";
import { canWriteToTarget, resolveAgentTarget } from "../src/server/targets";
import type {
  ArchiveStore,
  CollectedAgent,
  CollectionResult,
} from "../src/server/types";

const FIXTURE_PATH = join(import.meta.dir, "fixtures", "kilo-current.sql");
const ROOT_SESSION_ID = "ses_fixture_root";
const CHILD_SESSION_ID = "ses_fixture_child";
const ARCHIVED_SESSION_ID = "ses_fixture_archived";
const KILO = "kilo" as Provider;
const temporaryDirectories: string[] = [];
const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(path);
  return path;
}

async function fixtureStore(path: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  const database = new Database(path, { create: true });
  try {
    database.exec(await readFile(FIXTURE_PATH, "utf8"));
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

async function withKiloEnvironment<T>(
  environment: { XDG_DATA_HOME?: string; KILO_DB?: string },
  work: () => Promise<T>,
): Promise<T> {
  const previous = {
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    KILO_DB: process.env.KILO_DB,
  };
  for (const key of ["XDG_DATA_HOME", "KILO_DB"] as const) {
    const value = environment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await work();
  } finally {
    for (const key of ["XDG_DATA_HOME", "KILO_DB"] as const) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function collectAtHome(
  home: string,
  environment: { XDG_DATA_HOME?: string; KILO_DB?: string } = {},
  options: KiloCollectOptions = {},
): Promise<CollectionResult<CollectedAgent[]>> {
  return withKiloEnvironment(environment, () => collectKiloSessions(home, options));
}

async function collectKiloInChild(options: {
  home: string;
  xdgDataHome: string;
  kiloDb?: string;
  extraDataDirs?: readonly string[];
}): Promise<CollectionResult<CollectedAgent[]>> {
  const collectorUrl = pathToFileURL(join(import.meta.dir, "..", "src", "server", "kilo.ts")).href;
  const childSource = `
    if (process.env.FORMIC_CLEAR_KILO_DB === "1") delete process.env.KILO_DB;
    const { collectKiloSessions } = await import(process.env.FORMIC_COLLECTOR_URL);
    const result = await collectKiloSessions(process.env.HOME, {
      extraDataDirs: JSON.parse(process.env.FORMIC_EXTRA_DATA_DIRS),
    });
    process.stdout.write(JSON.stringify(result));
  `;
  const child = Bun.spawn([process.execPath, "-e", childSource], {
    cwd: join(import.meta.dir, ".."),
    env: {
      ...process.env,
      HOME: options.home,
      XDG_DATA_HOME: options.xdgDataHome,
      KILO_DB: options.kiloDb ?? "",
      FORMIC_CLEAR_KILO_DB: options.kiloDb === undefined ? "1" : "0",
      FORMIC_COLLECTOR_URL: collectorUrl,
      FORMIC_EXTRA_DATA_DIRS: JSON.stringify(options.extraDataDirs ?? []),
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
    throw new Error(`synthetic Kilo child failed (${exitCode}): ${stderr.trim()}`);
  }
  return JSON.parse(stdout) as CollectionResult<CollectedAgent[]>;
}

function roots(result: CollectionResult<CollectedAgent[]>): CollectedAgent[] {
  return result.value.filter(({ sourceSessionId }) => sourceSessionId === ROOT_SESSION_ID);
}

function root(result: CollectionResult<CollectedAgent[]>): CollectedAgent | undefined {
  return roots(result)[0];
}

function rootLabels(result: CollectionResult<CollectedAgent[]>): string[] {
  return [...new Set(roots(result).map(({ instanceLabel }) => instanceLabel ?? "missing"))].sort();
}

function manualKiloAgent(source: string, overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  const sourceSessionId = overrides.sourceSessionId ?? ROOT_SESSION_ID;
  return {
    id: `kilo:kilo-db:${sourceSessionId}`,
    provider: KILO,
    instanceId: "kilo:kilo-db",
    instanceLabel: "kilo.db",
    sourceSessionId,
    displayName: "Kilo Code · root",
    identity: {
      name: "Kilo Code · root",
      base: "Kilo Code · root",
      source: "origin-cwd",
    },
    cwd: "/synthetic/kilo/project/root/recent",
    originCwd: "/synthetic/kilo/project/root",
    status: "running",
    statusReason: "Synthetic Kilo activity is recent.",
    updatedAt: new Date(1_800_000_008_000).toISOString(),
    tokens: { provenance: "unknown", scope: "unknown" },
    artifacts: [{ label: "Kilo store", path: source, kind: "transcript" }],
    gates: [],
    allowCwdFallback: false,
    ...overrides,
  };
}

function snapshotFor(agent: CollectedAgent) {
  return buildSnapshot({
    agents: [agent],
    surfaces: [],
    archiveStore,
    now: new Date(1_800_000_010_000),
  });
}

async function abortAfterFirstKiloQuery<T>(
  abort: AbortController,
  reason: Error,
  work: () => Promise<T>,
): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(Database.prototype, "query");
  if (!descriptor || typeof descriptor.value !== "function") {
    throw new Error("bun:sqlite Database.query is unavailable for Kilo abort control");
  }
  const original = descriptor.value as (...args: unknown[]) => unknown;
  let queries = 0;
  Object.defineProperty(Database.prototype, "query", {
    ...descriptor,
    value: function (this: Database, ...args: unknown[]) {
      const result = Reflect.apply(original, this, args);
      queries += 1;
      if (queries === 1) abort.abort(reason);
      return result;
    },
  });
  try {
    return await work();
  } finally {
    Object.defineProperty(Database.prototype, "query", descriptor);
  }
}

describe("Kilo central collection red floor", () => {
  test("01 default XDG KILO_DB and channel database discovery", async () => {
    const defaultHome = await temporaryDirectory("formic-kilo-default-");
    const defaultRoot = join(defaultHome, ".local", "share", "kilo");
    await fixtureStore(join(defaultRoot, "kilo.db"));
    await fixtureStore(join(defaultRoot, "kilo-local.db"));

    const xdgHome = await temporaryDirectory("formic-kilo-xdg-home-");
    const xdgDataHome = await temporaryDirectory("formic-kilo-xdg-data-");
    await fixtureStore(join(xdgDataHome, "kilo", "kilo.db"));

    const configuredHome = await temporaryDirectory("formic-kilo-config-home-");
    const configured = await fixtureStore(join(configuredHome, "stores", "kilo-edge.db"));

    const defaultResult = await collectAtHome(defaultHome);
    const xdgResult = await collectKiloInChild({ home: xdgHome, xdgDataHome });
    const configuredResult = await collectAtHome(configuredHome, { KILO_DB: configured });

    expect({
      default: rootLabels(defaultResult),
      xdg: rootLabels(xdgResult),
      configured: rootLabels(configuredResult),
      errors: {
        default: defaultResult.errors,
        xdg: xdgResult.errors,
        configured: configuredResult.errors,
      },
    }).toEqual({
      default: ["kilo-local.db", "kilo.db"],
      xdg: ["kilo.db"],
      configured: ["kilo-edge.db"],
      errors: { default: [], xdg: [], configured: [] },
    });
  });

  test("02 legacy opencode database names belong to Kilo only inside its root", async () => {
    const home = await temporaryDirectory("formic-kilo-legacy-owner-");
    const kiloRoot = join(home, ".local", "share", "kilo");
    const openCodeRoot = join(home, ".local", "share", "opencode");
    const leftover = await fixtureStore(join(kiloRoot, "opencode-local.db"));
    await fixtureStore(join(kiloRoot, "opencode.db"));
    await fixtureStore(join(openCodeRoot, "opencode.db"));

    const result = await collectAtHome(home);
    expect(roots(result).map(({ instanceLabel, artifacts }) => ({
      instanceLabel,
      artifactPaths: artifacts.map(({ path }) => path),
    }))).toEqual([{
      instanceLabel: "opencode-local.db",
      artifactPaths: [leftover],
    }]);
  });

  test("03 non UUID native ids stay provider and database qualified", async () => {
    const home = await temporaryDirectory("formic-kilo-identity-");
    const dataRoot = join(home, ".local", "share", "kilo");
    await fixtureStore(join(dataRoot, "kilo.db"));
    await fixtureStore(join(dataRoot, "kilo-nightly.db"));

    const result = await collectAtHome(home);
    const rows = roots(result)
      .map(({ id, instanceId, instanceLabel, provider, sourceSessionId }) => ({
        id,
        instanceId,
        instanceLabel,
        provider,
        sourceSessionId,
        nativeIdIsUuid: /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(sourceSessionId),
      }))
      .sort((left, right) => left.id.localeCompare(right.id));

    expect({ rows, errors: result.errors }).toEqual({
      rows: [
        {
          id: `kilo:kilo-db:${ROOT_SESSION_ID}`,
          instanceId: "kilo:kilo-db",
          instanceLabel: "kilo.db",
          provider: KILO,
          sourceSessionId: ROOT_SESSION_ID,
          nativeIdIsUuid: false,
        },
        {
          id: `kilo:kilo-nightly-db:${ROOT_SESSION_ID}`,
          instanceId: "kilo:kilo-nightly-db",
          instanceLabel: "kilo-nightly.db",
          provider: KILO,
          sourceSessionId: ROOT_SESSION_ID,
          nativeIdIsUuid: false,
        },
      ],
      errors: [],
    });
  });

  test("04 Kilo controls require exact provider qualified cmux identity", async () => {
    const agent = manualKiloAgent("/synthetic/kilo/kilo.db");
    const cwdOnly = resolveAgentTarget(agent, [{
      surfaceId: "SURFACE-KILO-CWD-ONLY",
      cwd: agent.cwd,
      sourceSessionIds: [],
      runtimeSurfaceReady: true,
    }], [agent]);
    const exact = resolveAgentTarget(agent, [{
      surfaceId: "SURFACE-KILO-EXACT",
      sourceSessionClaims: [{ provider: KILO, sessionId: ROOT_SESSION_ID }],
      sourceSessionIds: [ROOT_SESSION_ID],
      runtimeSurfaceReady: true,
    }], [agent]);

    expect({
      allowCwdFallback: agent.allowCwdFallback,
      cwdResolution: cwdOnly.resolution,
      cwdWritable: canWriteToTarget(cwdOnly),
      exactResolution: exact.resolution,
      exactAttestation: exact.attestation,
      exactSurface: exact.surfaceId,
      exactKind: exact.kind ?? "cmux",
      exactWritable: canWriteToTarget(exact),
    }).toEqual({
      allowCwdFallback: false,
      cwdResolution: "missing",
      cwdWritable: false,
      exactResolution: "exact",
      exactAttestation: "live",
      exactSurface: "SURFACE-KILO-EXACT",
      exactKind: "cmux",
      exactWritable: true,
    });
  });

  test("05 health distinguishes absence empty success and source qualified degradation", async () => {
    const absentHome = await temporaryDirectory("formic-kilo-health-absent-");
    const absent = await collectAtHome(absentHome);

    const emptyHome = await temporaryDirectory("formic-kilo-health-empty-");
    const emptyPath = await fixtureStore(join(emptyHome, ".local", "share", "kilo", "kilo.db"));
    mutateStore(emptyPath, (database) => {
      database.exec("DELETE FROM part; DELETE FROM message; DELETE FROM session;");
    });
    const empty = await collectAtHome(emptyHome);

    const degradedHome = await temporaryDirectory("formic-kilo-health-degraded-");
    const degradedRoot = join(degradedHome, ".local", "share", "kilo");
    await fixtureStore(join(degradedRoot, "kilo.db"));
    await mkdir(degradedRoot, { recursive: true });
    await writeFile(join(degradedRoot, "kilo-local.db"), "synthetic non-SQLite input");
    const degraded = await collectAtHome(degradedHome);

    expect({
      absent: { marker: absent.absent, rows: absent.value, errors: absent.errors },
      empty: { marker: empty.absent, rows: empty.value, errors: empty.errors },
      degradedLabels: rootLabels(degraded),
      degradedMarker: degraded.absent,
      degradedErrors: degraded.errors,
    }).toEqual({
      absent: { marker: true, rows: [], errors: [] },
      empty: { marker: undefined, rows: [], errors: [] },
      degradedLabels: ["kilo.db"],
      degradedMarker: undefined,
      degradedErrors: [expect.stringMatching(/Kilo.*kilo-local\.db|kilo-local\.db.*Kilo/i)],
    });
  });

  test("06 Inspector transports reasoning and tool cards without tool bodies", async () => {
    const directory = await temporaryDirectory("formic-kilo-inspector-");
    const source = await fixtureStore(join(directory, "kilo.db"));
    const agent = manualKiloAgent(source);
    const response = await transcriptResponse(snapshotFor(agent), agent.id, 200, {});
    const body = await response.json() as { lines?: Array<{ role?: string; text?: string }> };
    const serialized = JSON.stringify(body);

    expect({
      lines: body.lines,
      leakedToolBody: serialized.match(/INVENTED_TOOL_BODY_MUST_NOT_PUBLISH/)?.[0],
    }).toEqual({
      lines: expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          text: "Thought\nCheck only invented native relationships.",
        }),
        expect.objectContaining({
          role: "tool",
          text: "Inspect invented schema\nCall: call_fixture_inspect\nStatus: completed",
        }),
      ]),
      leakedToolBody: undefined,
    });
  });

  test("06b Inspector preserves source timestamps on typed Kilo events", async () => {
    const directory = await temporaryDirectory("formic-kilo-inspector-timestamps-");
    try {
      const source = await fixtureStore(join(directory, "kilo.db"));
      const agent = manualKiloAgent(source);
      const response = await transcriptResponse(snapshotFor(agent), agent.id, 200, {});
      const body = await response.json() as {
        lines?: Array<{ role?: string; text?: string; at?: string }>;
      };
      const reasoning = body.lines?.find(({ role, text }) =>
        role === "system" && text === "Thought\nCheck only invented native relationships.");
      const tool = body.lines?.find(({ role, text }) =>
        role === "tool"
        && text === "Inspect invented schema\nCall: call_fixture_inspect\nStatus: completed");

      expect({ reasoningAt: reasoning?.at, toolAt: tool?.at }).toEqual({
        reasoningAt: new Date(1_800_000_001_201).toISOString(),
        toolAt: new Date(1_800_000_001_300).toISOString(),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("07 complete usage maps losslessly while cost effort and context stay absent", async () => {
    const completeHome = await temporaryDirectory("formic-kilo-usage-complete-");
    await fixtureStore(join(completeHome, ".local", "share", "kilo", "kilo.db"));
    const completeResult = await collectAtHome(completeHome);
    const complete = root(completeResult);
    const published = complete
      ? snapshotFor(complete).programs.flatMap(({ agents }) => agents)
        .find(({ sourceSessionId }) => sourceSessionId === ROOT_SESSION_ID)
      : undefined;

    const incompleteHome = await temporaryDirectory("formic-kilo-usage-incomplete-");
    const incompletePath = await fixtureStore(
      join(incompleteHome, ".local", "share", "kilo", "kilo.db"),
    );
    mutateStore(incompletePath, (database) => {
      database.run("UPDATE part SET data = ? WHERE id = ?", [
        JSON.stringify({
          type: "step-finish",
          reason: "stop",
          tokens: {
            total: 6,
            input: "invalid",
            output: 2,
            reasoning: 0,
            cache: { read: 1, write: 0 },
          },
        }),
        "prt_fixture_assistant_2_finish",
      ]);
    });
    const incomplete = root(await collectAtHome(incompleteHome));

    expect({
      model: complete?.model,
      rawModel: complete?.rawModel,
      callSizes: complete?.callSizes,
      latestTotal: complete?.tokens.total,
      sessionProcessed: complete?.tokens.sessionProcessed,
      sessionTotal: complete?.tokens.sessionTotal,
      sessionCachedInput: complete?.tokens.sessionCachedInput,
      cost: complete?.cost,
      effort: complete?.effort,
      contextWindow: complete?.tokens.contextWindow,
      contextPct: complete?.contextPct,
      snapshotCost: published?.cost,
      snapshotEffort: published?.effort,
      snapshotContextWindow: published?.tokens.contextWindow,
      snapshotContextPct: published?.contextPct,
      incompleteCallSizes: incomplete?.callSizes,
      incompleteProcessed: incomplete?.tokens.sessionProcessed,
    }).toEqual({
      model: "provider-invented/model-invented",
      rawModel: {
        modelId: "model-invented",
        providerRoute: "provider-invented",
        rawVariant: "high",
      },
      callSizes: [9, 6],
      latestTotal: 6,
      sessionProcessed: 15,
      sessionTotal: 17,
      sessionCachedInput: 8,
      cost: undefined,
      effort: undefined,
      contextWindow: undefined,
      contextPct: undefined,
      snapshotCost: undefined,
      snapshotEffort: undefined,
      snapshotContextWindow: undefined,
      snapshotContextPct: undefined,
      incompleteCallSizes: undefined,
      incompleteProcessed: undefined,
    });
  });

  test("08 session calls publishes only a complete rederived Kilo series", async () => {
    const completeDir = await temporaryDirectory("formic-kilo-calls-complete-");
    const completePath = await fixtureStore(join(completeDir, "kilo.db"));
    const completeAgent = manualKiloAgent(completePath);
    const completeResponse = await sessionCallsResponse(
      snapshotFor(completeAgent),
      completeAgent.id,
      {},
    );
    const complete = await completeResponse.json() as {
      calls?: unknown;
      sessionProcessed?: unknown;
      prefixSums?: unknown;
      unavailable?: unknown;
    };

    const incompleteDir = await temporaryDirectory("formic-kilo-calls-incomplete-");
    const incompletePath = await fixtureStore(join(incompleteDir, "kilo.db"));
    mutateStore(incompletePath, (database) => {
      database.run("UPDATE part SET data = ? WHERE id = ?", [
        JSON.stringify({ type: "step-finish", tokens: { total: 6, input: "invalid" } }),
        "prt_fixture_assistant_2_finish",
      ]);
    });
    const incompleteAgent = manualKiloAgent(incompletePath);
    const incompleteResponse = await sessionCallsResponse(
      snapshotFor(incompleteAgent),
      incompleteAgent.id,
      {},
    );
    const incomplete = await incompleteResponse.json() as {
      calls?: unknown;
      sessionProcessed?: unknown;
      prefixSums?: unknown;
      unavailable?: unknown;
    };

    expect({
      complete: {
        calls: complete.calls,
        sessionProcessed: complete.sessionProcessed,
        prefixSums: complete.prefixSums,
        unavailable: complete.unavailable,
      },
      incomplete: {
        calls: incomplete.calls,
        sessionProcessed: incomplete.sessionProcessed,
        prefixSums: incomplete.prefixSums,
        unavailable: incomplete.unavailable,
      },
    }).toEqual({
      complete: {
        calls: [9, 6],
        sessionProcessed: 15,
        prefixSums: [9, 15],
        unavailable: undefined,
      },
      incomplete: {
        calls: null,
        sessionProcessed: null,
        prefixSums: null,
        unavailable: expect.stringMatching(/invalid|corrupt|incomplete|truncat/i),
      },
    });
  });

  test("08a transcript cancellation during a store read rethrows the exact request reason", async () => {
    const directory = await temporaryDirectory("formic-kilo-transcript-abort-");
    const source = await fixtureStore(join(directory, "kilo.db"));
    const agent = manualKiloAgent(source);
    const abort = new AbortController();
    const reason = new Error("cancel Kilo transcript request");

    await expect(abortAfterFirstKiloQuery(
      abort,
      reason,
      () => transcriptResponse(snapshotFor(agent), agent.id, 200, {}, abort.signal),
    )).rejects.toBe(reason);
  });

  test("08b session-call cancellation during a store read rethrows the exact request reason", async () => {
    const directory = await temporaryDirectory("formic-kilo-session-call-abort-");
    const source = await fixtureStore(join(directory, "kilo.db"));
    const agent = manualKiloAgent(source);
    const abort = new AbortController();
    const reason = new Error("cancel Kilo session-call request");

    await expect(abortAfterFirstKiloQuery(
      abort,
      reason,
      () => sessionCallsResponse(snapshotFor(agent), agent.id, {}, abort.signal),
    )).rejects.toBe(reason);
  });

  test("09 Kilo harness and provider marks are distinct runtime contracts", async () => {
    // @ts-expect-error the dependency-free browser client has no declaration file
    await import("../src/web/app.js");
    // @ts-expect-error the dependency-free browser client has no declaration file
    const settings = await import("../src/web/settings-collectors.js") as unknown as {
      HOME_MARK?: Record<string, string>;
    };
    const web = (globalThis as unknown as {
      TheAntHill?: {
        HARNESS_MARK?: Record<string, { src?: string; label?: string }>;
        PROVIDER_MARK?: Record<string, { src?: string }>;
      };
    }).TheAntHill;
    const harness = web?.HARNESS_MARK?.kilo;
    const providerRoute = web?.PROVIDER_MARK?.kilo;

    expect({
      harness,
      providerRoute,
      settingsHome: settings.HOME_MARK?.kilo,
    }).toEqual({
      harness: { src: "/icons/kilo.svg", label: "Kilo Code" },
      providerRoute: { src: "/icons/kilo-provider.svg" },
      settingsHome: "/icons/kilo.svg",
    });
  });

  test("10 relative KILO_DB resolves under the selected data root and ignores extra roots", async () => {
    const home = await temporaryDirectory("formic-kilo-relative-home-");
    const xdgDataHome = await temporaryDirectory("formic-kilo-relative-xdg-");
    const extraRoot = await temporaryDirectory("formic-kilo-relative-extra-");
    await fixtureStore(join(xdgDataHome, "kilo", "nested", "kilo-relative.db"));
    await fixtureStore(join(extraRoot, "kilo-extra.db"));

    const result = await collectKiloInChild({
      home,
      xdgDataHome,
      kiloDb: join("nested", "kilo-relative.db"),
      extraDataDirs: [extraRoot],
    });

    expect(rootLabels(result)).toEqual(["kilo-relative.db"]);
  });

  test("10b missing configured KILO_DB remains clean absence", async () => {
    const home = await temporaryDirectory("formic-kilo-configured-absence-");
    try {
      const missing = join(home, "stores", "kilo-missing.db");

      expect(await collectAtHome(home, { KILO_DB: missing })).toEqual({
        value: [],
        errors: [],
        absent: true,
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("11 KILO_DB memory is present-empty and ignores extra roots", async () => {
    const home = await temporaryDirectory("formic-kilo-memory-home-");
    const extraRoot = await temporaryDirectory("formic-kilo-memory-extra-");
    await fixtureStore(join(extraRoot, "kilo.db"));

    const result = await collectAtHome(
      home,
      { KILO_DB: ":memory:" },
      { extraDataDirs: [extraRoot] },
    );

    expect(result).toEqual({ value: [], errors: [] });
  });

  test("12 extraDataDirs deduplicates roots while duplicate native IDs remain instance-qualified", async () => {
    const home = await temporaryDirectory("formic-kilo-extra-home-");
    const defaultRoot = join(home, ".local", "share", "kilo");
    const alternateRoot = await temporaryDirectory("formic-kilo-extra-root-");
    await fixtureStore(join(defaultRoot, "kilo.db"));
    await fixtureStore(join(alternateRoot, "kilo.db"));

    const result = await collectAtHome(
      home,
      {},
      { extraDataDirs: [alternateRoot, alternateRoot] },
    );
    const rows = roots(result);

    expect({
      rows: rows.length,
      ids: new Set(rows.map(({ id }) => id)).size,
      instances: new Set(rows.map(({ instanceId }) => instanceId)).size,
      labels: rows.map(({ instanceLabel }) => instanceLabel).sort(),
      errors: result.errors,
    }).toEqual({
      rows: 2,
      ids: 2,
      instances: 2,
      labels: ["kilo.db", "kilo.db"],
      errors: [],
    });
  });

  test("12b real and symlink Kilo roots share the real-parent instance identity", async () => {
    const home = await temporaryDirectory("formic-kilo-alias-home-");
    const realRoot = await realpath(await temporaryDirectory("formic-kilo-real-root-"));
    const aliasParent = await temporaryDirectory("formic-kilo-alias-parent-");
    const aliasRoot = join(aliasParent, "alias");
    try {
      await fixtureStore(join(realRoot, "kilo.db"));
      await symlink(realRoot, aliasRoot, "dir");

      const realFirst = await collectAtHome(home, {}, { extraDataDirs: [realRoot, aliasRoot] });
      const symlinkFirst = await collectAtHome(home, {}, {
        extraDataDirs: [aliasRoot, realRoot],
      });
      const token = createHash("sha256").update(realRoot).digest("hex").slice(0, 8);
      const expected = [{
        instanceId: `kilo:kilo-db-${token}`,
        sessionId: `kilo:kilo-db-${token}:${ROOT_SESSION_ID}`,
      }];

      expect({
        realFirst: roots(realFirst).map(({ id, instanceId }) => ({ instanceId, sessionId: id })),
        symlinkFirst: roots(symlinkFirst)
          .map(({ id, instanceId }) => ({ instanceId, sessionId: id })),
      }).toEqual({ realFirst: expected, symlinkFirst: expected });
    } finally {
      await Promise.all([home, realRoot, aliasParent]
        .map((path) => rm(path, { recursive: true, force: true })));
    }
  });

  test("13 config-only Kilo installation evidence mints no central rows", async () => {
    const home = await temporaryDirectory("formic-kilo-config-only-");
    await mkdir(join(home, ".config", "kilo"), { recursive: true });
    await writeFile(join(home, ".config", "kilo", "settings.json"), "{}\n");

    expect(await collectAtHome(home)).toEqual({ value: [], errors: [], absent: true });
  });

  test("14 non-regular Kilo stores are errors while healthy rows survive", async () => {
    const home = await temporaryDirectory("formic-kilo-nonregular-");
    const dataRoot = join(home, ".local", "share", "kilo");
    await fixtureStore(join(dataRoot, "kilo.db"));
    await mkdir(join(dataRoot, "kilo-broken.db"));

    const result = await collectAtHome(home);

    expect({ labels: rootLabels(result), errors: result.errors }).toEqual({
      labels: ["kilo.db"],
      errors: [expect.stringMatching(/Kilo.*kilo-broken\.db|kilo-broken\.db.*Kilo/i)],
    });
  });

  test("15 locked or busy Kilo stores are errors while healthy rows survive", async () => {
    const home = await temporaryDirectory("formic-kilo-locked-");
    const dataRoot = join(home, ".local", "share", "kilo");
    await fixtureStore(join(dataRoot, "kilo.db"));
    const lockedPath = await fixtureStore(join(dataRoot, "kilo-locked.db"));
    const lock = new Database(lockedPath);
    lock.exec("PRAGMA journal_mode = DELETE; BEGIN EXCLUSIVE");
    try {
      const result = await collectAtHome(home);
      expect({ labels: rootLabels(result), errors: result.errors }).toEqual({
        labels: ["kilo.db"],
        errors: [expect.stringMatching(/Kilo.*kilo-locked\.db.*(?:locked|busy)|kilo-locked\.db.*Kilo.*(?:locked|busy)/i)],
      });
    } finally {
      lock.exec("ROLLBACK");
      lock.close();
    }
  });

  test("16 schema-incompatible Kilo stores are errors while healthy rows survive", async () => {
    const home = await temporaryDirectory("formic-kilo-schema-");
    const dataRoot = join(home, ".local", "share", "kilo");
    await fixtureStore(join(dataRoot, "kilo.db"));
    const incompatible = await fixtureStore(join(dataRoot, "kilo-schema.db"));
    mutateStore(incompatible, (database) => database.exec("DROP TABLE migration"));

    const result = await collectAtHome(home);

    expect({ labels: rootLabels(result), errors: result.errors }).toEqual({
      labels: ["kilo.db"],
      errors: [expect.stringMatching(/Kilo.*kilo-schema\.db.*schema|kilo-schema\.db.*Kilo.*schema/i)],
    });
  });

  test("17 corrupt Kilo stores are errors while healthy rows survive", async () => {
    const home = await temporaryDirectory("formic-kilo-corrupt-");
    const dataRoot = join(home, ".local", "share", "kilo");
    await fixtureStore(join(dataRoot, "kilo.db"));
    await mkdir(dataRoot, { recursive: true });
    await writeFile(join(dataRoot, "kilo-corrupt.db"), "synthetic corrupt Kilo store");

    const result = await collectAtHome(home);

    expect({ labels: rootLabels(result), errors: result.errors }).toEqual({
      labels: ["kilo.db"],
      errors: [expect.stringMatching(/Kilo.*kilo-corrupt\.db.*corrupt|kilo-corrupt\.db.*Kilo.*corrupt/i)],
    });
  });

  test("18 deadline-limited Kilo stores are source-qualified errors rather than empty success", async () => {
    const home = await temporaryDirectory("formic-kilo-deadline-");
    const dataRoot = join(home, ".local", "share", "kilo");
    await fixtureStore(join(dataRoot, "kilo.db"));

    const result = await collectAtHome(home, {}, {
      readOptions: { deadlineAtMs: 10, nowMs: () => 10 },
    });

    expect({ rows: result.value, absent: result.absent, errors: result.errors }).toEqual({
      rows: [],
      absent: undefined,
      errors: [`${dataRoot}: Kilo data directory deadline expired with matching stores not enumerated.`],
    });
  });

  test("18a truncated invalid and oversized parser diagnostics publish source-qualified health", async () => {
    const home = await temporaryDirectory("formic-kilo-parser-health-");
    const dataRoot = join(home, ".local", "share", "kilo");
    const truncatedPath = await fixtureStore(join(dataRoot, "kilo-truncated.db"));
    const invalidPath = await fixtureStore(join(dataRoot, "kilo-invalid.db"));
    const oversizedPath = await fixtureStore(join(dataRoot, "kilo-oversized.db"));

    mutateStore(truncatedPath, (database) => {
      for (let index = 0; index < KILO_STORE_LIMITS.sessions; index += 1) {
        const suffix = String(index).padStart(3, "0");
        database.run(
          "INSERT INTO session(id, project_id, slug, directory, path, title, version, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            `ses_health_bound_${suffix}`,
            "prj_fixture",
            `health-bound-${suffix}`,
            `/synthetic/kilo/health/${suffix}`,
            `health/${suffix}`,
            `Health bound ${suffix}`,
            "synthetic",
            1900000000000 + index,
            1900000000000 + index,
          ],
        );
      }
    });
    mutateStore(invalidPath, (database) => {
      database.run("UPDATE message SET data = ? WHERE id = ?", [
        "{invalid-kilo-message-json",
        "msg_fixture_assistant_2",
      ]);
    });
    mutateStore(oversizedPath, (database) => {
      database.run("UPDATE part SET data = ? WHERE id = ?", [
        JSON.stringify({
          type: "text",
          text: `OVERSIZED_KILO_HEALTH_${"x".repeat(KILO_STORE_LIMITS.textChars + 1)}`,
        }),
        "prt_fixture_assistant_2_text",
      ]);
    });

    const result = await collectAtHome(home);
    const expected = [
      { path: truncatedPath, kind: "truncated" },
      { path: invalidPath, kind: "invalid-json" },
      { path: oversizedPath, kind: "oversized-content" },
    ] as const;
    const health = expected.map(({ path, kind }) => {
      const sourceErrors = result.errors.filter((error) => error.startsWith(`${path}: `));
      return {
        kind,
        matchingKind: sourceErrors.some((error) => error.includes(`Kilo ${kind}:`)),
        sourceQualified: sourceErrors.length > 0 && sourceErrors.every((error) =>
          error.split(path).length - 1 === 1
        ),
      };
    });

    expect({ health, errorsEmpty: result.errors.length === 0 }).toEqual({
      health: [
        { kind: "truncated", matchingKind: true, sourceQualified: true },
        { kind: "invalid-json", matchingKind: true, sourceQualified: true },
        { kind: "oversized-content", matchingKind: true, sourceQualified: true },
      ],
      errorsEmpty: false,
    });
  });

  test("18b each failed Kilo store error is qualified once by its own store path", async () => {
    const home = await temporaryDirectory("formic-kilo-error-qualification-");
    const dataRoot = join(home, ".local", "share", "kilo");
    const alpha = join(dataRoot, "kilo-alpha.db");
    const beta = join(dataRoot, "kilo-beta.db");
    try {
      await mkdir(dataRoot, { recursive: true });
      await writeFile(alpha, "synthetic corrupt Kilo alpha store");
      await mkdir(beta);

      const result = await collectAtHome(home);
      const failureClasses = [
        { path: alpha, otherPath: beta, matches: (error: string) => /corrupt/i.test(error) },
        {
          path: beta,
          otherPath: alpha,
          matches: (error: string) => /not a regular file/i.test(error),
        },
      ] as const;
      const acceptsQualifiedFailures = (errors: readonly string[]) =>
        errors.length === failureClasses.length
        && failureClasses.every(({ path, otherPath, matches }) => {
          const classified = errors.filter(matches);
          if (classified.length !== 1) return false;
          const error = classified[0]!;
          return error.startsWith(`${path}: `)
            && error.split(path).length - 1 === 1
            && error.split(otherPath).length - 1 === 0;
        });
      const gold = [
        `${alpha}: Kilo store is corrupt.`,
        `${beta}: Kilo store is not a regular file.`,
      ] as const;
      const swapped = [
        `${beta}: ${gold[0].slice(`${alpha}: `.length)}`,
        `${alpha}: ${gold[1].slice(`${beta}: `.length)}`,
      ] as const;

      expect({
        goldAccepted: acceptsQualifiedFailures(gold),
        swappedAccepted: acceptsQualifiedFailures(swapped),
        resultAccepted: acceptsQualifiedFailures(result.errors),
      }).toEqual({ goldAccepted: true, swappedAccepted: false, resultAccepted: true });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("18c vanished discovered Kilo store keeps its own qualification while another store survives", async () => {
    const home = await temporaryDirectory("formic-kilo-vanished: store-");
    const dataRoot = join(home, ".local", "share", "kilo");
    const vanishedStorePath = await fixtureStore(join(dataRoot, "kilo-alpha.db"));
    const survivorStorePath = await fixtureStore(join(dataRoot, "kilo-beta.db"));
    let vanished = false;
    try {
      const result = await collectAtHome(home, {}, {
        readOptions: {
          deadlineAtMs: Number.MAX_SAFE_INTEGER,
          nowMs: () => 0,
          testHooks: {
            beforeStoreRead(path) {
              if (!vanished && path === vanishedStorePath) {
                renameSync(vanishedStorePath, `${vanishedStorePath}.gone`);
                vanished = true;
              }
            },
          },
        },
      });
      const error = result.errors[0];

      expect({
        survivorRows: roots(result).filter(({ artifacts }) =>
          artifacts.some(({ path }) => path === survivorStorePath)
        ).length,
        errors: result.errors.length,
        startsWithVanished: error?.startsWith(`${vanishedStorePath}: `),
        vanishedPathOccurrences: error?.split(vanishedStorePath).length - 1,
        survivorPathOccurrences: error?.split(survivorStorePath).length - 1,
        absent: result.absent,
      }).toEqual({
        survivorRows: 1,
        errors: 1,
        startsWithVanished: true,
        vanishedPathOccurrences: 1,
        survivorPathOccurrences: 0,
        absent: undefined,
      });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("19 parent identities resolve to the matching database instance only", async () => {
    const home = await temporaryDirectory("formic-kilo-parent-home-");
    const alternateRoot = await temporaryDirectory("formic-kilo-parent-extra-");
    await fixtureStore(join(home, ".local", "share", "kilo", "kilo.db"));
    await fixtureStore(join(alternateRoot, "kilo.db"));
    const result = await collectAtHome(home, {}, { extraDataDirs: [alternateRoot] });
    const snapshot = buildSnapshot({
      agents: result.value,
      surfaces: [],
      archiveStore,
      now: new Date(1_800_000_010_000),
    });
    const published = snapshot.programs.flatMap(({ agents }) => agents) as unknown as Array<{
      id: string;
      sourceSessionId: string;
      parentAgentId?: string;
    }>;
    const alternateToken = createHash("sha256").update(alternateRoot).digest("hex").slice(0, 8);
    const expected = [
      {
        id: `kilo:kilo-db:${CHILD_SESSION_ID}`,
        parentAgentId: `kilo:kilo-db:${ROOT_SESSION_ID}`,
      },
      {
        id: `kilo:kilo-db-${alternateToken}:${CHILD_SESSION_ID}`,
        parentAgentId: `kilo:kilo-db-${alternateToken}:${ROOT_SESSION_ID}`,
      },
    ].sort((left, right) => left.id.localeCompare(right.id));

    expect(published
      .filter(({ sourceSessionId }) => sourceSessionId === CHILD_SESSION_ID)
      .map(({ id, parentAgentId }) => ({ id, parentAgentId }))
      .sort((left, right) => left.id.localeCompare(right.id))).toEqual(expected);
  });

  test("20 an unqualified duplicate native Kilo claim is ambiguous and non-writable", () => {
    const primary = manualKiloAgent("/synthetic/kilo/default/kilo.db");
    const alternate = manualKiloAgent("/synthetic/kilo/alternate/kilo.db", {
      id: `kilo:kilo-db-deadbeef:${ROOT_SESSION_ID}`,
      instanceId: "kilo:kilo-db-deadbeef",
    });
    const target = resolveAgentTarget(primary, [{
      surfaceId: "SURFACE-KILO-DUPLICATE",
      sourceSessionClaims: [{ provider: KILO, sessionId: ROOT_SESSION_ID }],
      sourceSessionIds: [ROOT_SESSION_ID],
      runtimeSurfaceReady: true,
    }], [primary, alternate]);

    expect({ resolution: target.resolution, writable: canWriteToTarget(target) }).toEqual({
      resolution: "ambiguous",
      writable: false,
    });
  });

  test("20b duplicate Kilo ownership with hook facts stays ambiguous and non-writable", async () => {
    const home = await temporaryDirectory("formic-kilo-hook-home-");
    const hookRoot = join(home, ".cmuxterm");
    const emptyHookRoot = await temporaryDirectory("formic-kilo-empty-hook-");
    const surfaceId = "SURFACE-KILO-HOOK-ONLY";
    try {
      await mkdir(hookRoot, { recursive: true });
      await writeFile(join(hookRoot, "kilo-hook-sessions.json"), JSON.stringify({
        sessions: {
          [ROOT_SESSION_ID]: {
            sessionId: ROOT_SESSION_ID,
            surfaceId,
            workspaceId: "WORKSPACE-KILO-HOOK-ONLY",
            cwd: join(home, "missing-cwd"),
            pid: 4242,
            pidStartSeconds: 1_800_000_000,
            agentLifecycle: "ended",
            updatedAt: 1_800_000_009,
          },
        },
      }));
      readHookSessionStores(hookRoot);
      const matching = manualKiloAgent("/synthetic/kilo/unique/kilo.db");
      const unrelated = manualKiloAgent("/synthetic/kilo/unrelated/kilo.db", {
        sourceSessionId: "ses_fixture_unrelated",
      });
      const uniqueResults = Object.fromEntries(PROVIDERS.map((provider) => [
        provider,
        { value: provider === KILO ? [matching, unrelated] : [], errors: [] },
      ])) as unknown as SessionProviderResults;
      const uniqueOwners = finalizeSessionProviders(uniqueResults, home, {
        hookProcessStarts: () => new Map(),
      }).kilo.value;
      const matchingOwner = uniqueOwners.find(
        ({ sourceSessionId }) => sourceSessionId === ROOT_SESSION_ID,
      )!;
      const unrelatedOwner = uniqueOwners.find(
        ({ sourceSessionId }) => sourceSessionId === "ses_fixture_unrelated",
      )!;
      const uniqueTarget = resolveAgentTarget(matchingOwner, [{
        surfaceId,
        sourceSessionClaims: [{ provider: KILO, sessionId: ROOT_SESSION_ID }],
        sourceSessionIds: [ROOT_SESSION_ID],
        runtimeSurfaceReady: true,
      }], uniqueOwners);

      const primary = manualKiloAgent("/synthetic/kilo/default/kilo.db");
      const alternate = manualKiloAgent("/synthetic/kilo/alternate/kilo.db", {
        id: `kilo:kilo-db-deadbeef:${ROOT_SESSION_ID}`,
        instanceId: "kilo:kilo-db-deadbeef",
      });
      const duplicateResults = Object.fromEntries(PROVIDERS.map((provider) => [
        provider,
        { value: provider === KILO ? [primary, alternate] : [], errors: [] },
      ])) as unknown as SessionProviderResults;

      const agents = finalizeSessionProviders(duplicateResults, home, {
        hookProcessStarts: () => new Map(),
      }).kilo.value;
      const target = resolveAgentTarget(agents[0]!, [{
        surfaceId,
        sourceSessionClaims: [{ provider: KILO, sessionId: ROOT_SESSION_ID }],
        sourceSessionIds: [ROOT_SESSION_ID],
        runtimeSurfaceReady: true,
      }], agents);

      expect({
        uniqueOwners: {
          matching: {
            sourceSessionId: matchingOwner.sourceSessionId,
            hookLifecycle: matchingOwner.hookLifecycle,
            hookLifecycleAt: matchingOwner.hookLifecycleAt,
            processIds: matchingOwner.processIds,
            processStarts: matchingOwner.processStarts,
            processAlive: matchingOwner.processAlive,
            endEvidence: matchingOwner.endEvidence,
          },
          unrelated: {
            sourceSessionId: unrelatedOwner.sourceSessionId,
            hookLifecycle: unrelatedOwner.hookLifecycle,
            hookLifecycleAt: unrelatedOwner.hookLifecycleAt,
            processIds: unrelatedOwner.processIds,
            processStarts: unrelatedOwner.processStarts,
            processAlive: unrelatedOwner.processAlive,
            endEvidence: unrelatedOwner.endEvidence,
          },
          target: {
            resolution: uniqueTarget.resolution,
            attestation: uniqueTarget.attestation,
            surfaceId: uniqueTarget.surfaceId,
            writable: canWriteToTarget(uniqueTarget),
          },
        },
        duplicateOwners: {
          facts: agents.map((agent) => ({
            hookLifecycle: agent.hookLifecycle,
            hookLifecycleAt: agent.hookLifecycleAt,
            processIds: agent.processIds,
            processStarts: agent.processStarts,
            processAlive: agent.processAlive,
            endEvidence: agent.endEvidence,
          })),
          target: { resolution: target.resolution, writable: canWriteToTarget(target) },
        },
      }).toEqual({
        uniqueOwners: {
          matching: {
            sourceSessionId: ROOT_SESSION_ID,
            hookLifecycle: "ended",
            hookLifecycleAt: "2027-01-15T08:00:09.000Z",
            processIds: [4242],
            processStarts: { 4242: 1_800_000_000 },
            processAlive: false,
            endEvidence: "session-exit",
          },
          unrelated: {
            sourceSessionId: "ses_fixture_unrelated",
            hookLifecycle: undefined,
            hookLifecycleAt: undefined,
            processIds: undefined,
            processStarts: undefined,
            processAlive: undefined,
            endEvidence: undefined,
          },
          target: {
            resolution: "exact",
            attestation: "hook-store",
            surfaceId,
            writable: true,
          },
        },
        duplicateOwners: {
          facts: [
            {
              hookLifecycle: undefined,
              hookLifecycleAt: undefined,
              processIds: undefined,
              processStarts: undefined,
              processAlive: undefined,
              endEvidence: undefined,
            },
            {
              hookLifecycle: undefined,
              hookLifecycleAt: undefined,
              processIds: undefined,
              processStarts: undefined,
              processAlive: undefined,
              endEvidence: undefined,
            },
          ],
          target: { resolution: "ambiguous", writable: false },
        },
      });
    } finally {
      readHookSessionStores(emptyHookRoot);
      await Promise.all([home, emptyHookRoot]
        .map((path) => rm(path, { recursive: true, force: true })));
    }
  });

  test("21 Inspector returns TRANSCRIPT_SESSION_GONE when the selected Kilo session disappears", async () => {
    const directory = await temporaryDirectory("formic-kilo-gone-");
    const source = await fixtureStore(join(directory, "kilo.db"));
    const agent = manualKiloAgent(source);
    const snapshot = snapshotFor(agent);
    mutateStore(source, (database) => {
      database.run("DELETE FROM part WHERE session_id = ?", [ROOT_SESSION_ID]);
      database.run("DELETE FROM message WHERE session_id = ?", [ROOT_SESSION_ID]);
      database.run("DELETE FROM session WHERE id = ?", [ROOT_SESSION_ID]);
    });

    const response = await transcriptResponse(snapshot, agent.id, 200, {});
    const body = await response.json() as {
      ok?: boolean;
      error?: { code?: string; message?: string };
    };

    expect({ status: response.status, ok: body.ok, code: body.error?.code }).toEqual({
      status: 410,
      ok: false,
      code: "TRANSCRIPT_SESSION_GONE",
    });
  });

  test("22 source titles retain Kilo unverified-authorship provenance", async () => {
    const home = await temporaryDirectory("formic-kilo-title-provenance-");
    await fixtureStore(join(home, ".local", "share", "kilo", "kilo.db"));

    expect(root(await collectAtHome(home))?.sourceTitle as unknown).toEqual({
      text: "Invented Kilo parser session",
      provenance: "kilo-source-title-unverified-authorship",
    });
  });

  test("23 source titles do not become authored Kilo display names", async () => {
    const home = await temporaryDirectory("formic-kilo-title-display-");
    await fixtureStore(join(home, ".local", "share", "kilo", "kilo.db"));
    const agent = root(await collectAtHome(home));

    expect({ displayName: agent?.displayName, identitySource: agent?.identity?.source }).toEqual({
      displayName: "Kilo · root",
      identitySource: "origin-cwd",
    });
  });

  test("24 archived Kilo sessions publish session-exit evidence", async () => {
    const home = await temporaryDirectory("formic-kilo-archived-");
    await fixtureStore(join(home, ".local", "share", "kilo", "kilo.db"));
    const archived = (await collectAtHome(home)).value.find(
      ({ sourceSessionId }) => sourceSessionId === ARCHIVED_SESSION_ID,
    );

    expect(archived?.endEvidence).toBe("session-exit");
  });

  test("25 turn completion and a complete process roster do not finish a quiet live Kilo session", async () => {
    const home = await temporaryDirectory("formic-kilo-quiet-live-");
    await fixtureStore(join(home, ".local", "share", "kilo", "kilo.db"));
    const result = await collectAtHome(home);
    const snapshot = buildSnapshot({
      agents: roots(result),
      surfaces: [],
      archiveStore,
      now: new Date(1_800_000_010_000),
      processRosterComplete: true,
    });
    const published = snapshot.programs.flatMap(({ agents }) => agents)
      .find(({ sourceSessionId }) => sourceSessionId === ROOT_SESSION_ID);

    expect({
      endEvidence: published?.endEvidence,
      lifecycle: published?.lifecycle,
      processRosterComplete: published?.processRosterComplete,
    }).toEqual({
      endEvidence: undefined,
      lifecycle: "working",
      processRosterComplete: undefined,
    });
  });

  const validKiloSessionId = "ses_0123456789abcdefghijklmnop";
  for (const [label, command] of [
    ["separate long option", `kilo --session ${validKiloSessionId}`],
    ["equals long option", `/usr/local/bin/kilo --session=${validKiloSessionId}`],
    ["short option", `kilo -s ${validKiloSessionId}`],
  ] as const) {
    test(`26 exact Kilo ${label} identifies one native session`, () => {
      expect(identitiesFromCommand(command)).toEqual([{
        provider: KILO,
        value: validKiloSessionId,
        full: true,
      }]);
    });
  }

  for (const [label, command] of [
    ["bare command", "kilo"],
    ["continue long option", "kilo --continue"],
    ["continue short option", "kilo -c"],
    ["invented resume option", `kilo --resume ${validKiloSessionId}`],
    ["malformed native id", "kilo --session ses_too_short"],
    ["database path selector", "kilo --session /synthetic/kilo/kilo.db"],
    ["database path process", "sqlite3 /synthetic/kilo/kilo.db"],
    ["cwd similarity", "bun run --cwd /synthetic/kilo/project dev"],
    ["fork source", `kilo --session ${validKiloSessionId} --fork`],
    ["cloud-fork source", `kilo --session=${validKiloSessionId} --cloud-fork`],
    [
      "cmux-agent-resume UUID",
      "/tmp/cmux-agent-resume/kilo-01234567-89ab-cdef-0123-456789abcdef.zsh",
    ],
  ] as const) {
    test(`27 Kilo ${label} remains identity-negative`, () => {
      expect(identitiesFromCommand(command)).toEqual([]);
    });
  }

  test("27b later Kilo-looking argv tokens do not mint identity", () => {
    const direct = [
      identitiesFromCommand(`kilo --session ${validKiloSessionId}`),
      identitiesFromCommand(`/usr/local/bin/kilo --session=${validKiloSessionId}`),
      identitiesFromCommand(`kilo -s ${validKiloSessionId}`),
    ];
    const laterArguments = [
      identitiesFromCommand(`bun /opt/tools/kilo --session ${validKiloSessionId}`),
      identitiesFromCommand(`echo /usr/local/bin/kilo --session=${validKiloSessionId}`),
      identitiesFromCommand(`cat /tmp/kilo -s ${validKiloSessionId}`),
    ];
    const identity = { provider: KILO, value: validKiloSessionId, full: true };

    expect({ direct, laterArguments }).toEqual({
      direct: [[identity], [identity], [identity]],
      laterArguments: [[], [], []],
    });
  });

  test("28 the runtime Provider roster registers Kilo", () => {
    expect(PROVIDERS).toContain(KILO);
  });

  test("29 default collector homes register Kilo as a CollectorKind", () => {
    const homes = defaultHomes("/synthetic/home") as ReadonlyArray<{
      kind: string;
      dataDir: string;
    }>;
    expect(homes).toContainEqual({
      kind: "kilo",
      dataDir: "/synthetic/home/.local/share/kilo",
    });
  });

  test("30 the public provider label is canonical Kilo", async () => {
    // @ts-expect-error the dependency-free browser client has no declaration file
    const { providerLabel } = await import("../src/web/text-formatters.js");

    expect(providerLabel(KILO)).toBe("Kilo");
  });

  test("31 collectSessionProvider routes Kilo through the public collector path", async () => {
    const home = await temporaryDirectory("formic-kilo-public-route-");
    const primaryPath = await fixtureStore(join(home, ".local", "share", "kilo", "kilo.db"));

    const result = await collectSessionProvider(KILO, home);

    expect(result).toMatchObject({
      value: expect.arrayContaining([
        expect.objectContaining({
          provider: KILO,
          sourceSessionId: ROOT_SESSION_ID,
          instanceLabel: "kilo.db",
          artifacts: expect.arrayContaining([
            { label: "Kilo store", path: primaryPath, kind: "transcript" },
          ]),
        }),
      ]),
      errors: [],
    });
  });

  test("31a provider collection forwards cancellation through the Kilo store catch", async () => {
    const home = await temporaryDirectory("formic-kilo-provider-abort-");
    await fixtureStore(join(home, ".local", "share", "kilo", "kilo.db"));
    const abort = new AbortController();
    const reason = new Error("cancel Kilo provider collection");

    await expect(abortAfterFirstKiloQuery(
      abort,
      reason,
      () => collectSessionProvider(KILO, home, undefined, undefined, {}, abort.signal),
    )).rejects.toBe(reason);
  });

  test("31b the Kilo collector turns the SQLite duration into one absolute deadline", async () => {
    const home = await temporaryDirectory("formic-kilo-absolute-deadline-");
    await fixtureStore(join(home, ".local", "share", "kilo", "kilo.db"));
    const clock = spyOn(Date, "now").mockReturnValue(1_000);
    const descriptor = Object.getOwnPropertyDescriptor(Database.prototype, "exec");
    if (!descriptor || typeof descriptor.value !== "function") {
      throw new Error("bun:sqlite Database.exec is unavailable for absolute-deadline control");
    }
    const original = descriptor.value as (...args: unknown[]) => unknown;
    let expired = false;
    Object.defineProperty(Database.prototype, "exec", {
      ...descriptor,
      value: function (this: Database, ...args: unknown[]) {
        const result = Reflect.apply(original, this, args);
        if (/^\s*COMMIT\s*;?\s*$/i.test(String(args[0] ?? ""))) expired = true;
        return result;
      },
    });
    try {
      const result = await collectKiloSessions(home, {
        sqliteReadBudgetMs: 50,
        readOptions: { nowMs: () => expired ? 1_050 : 1_049 },
      });

      expect({
        retainedRoot: result.value.some(({ sourceSessionId }) => sourceSessionId === ROOT_SESSION_ID),
        deadlineNamed: result.errors.some((error) => /deadline/i.test(error)),
      }).toEqual({ retainedRoot: true, deadlineNamed: true });
    } finally {
      Object.defineProperty(Database.prototype, "exec", descriptor);
      clock.mockRestore();
    }
  });

  test("31c collector diagnostics cannot rescan beyond the bounded primary dirent witness", async () => {
    const home = await temporaryDirectory("formic-kilo-no-diagnostic-rescan-");
    const dataRoot = join(home, ".local", "share", "kilo");
    await mkdir(dataRoot, { recursive: true });
    for (let index = 0; index <= 64; index += 1) {
      await writeFile(join(dataRoot, `irrelevant-${String(index).padStart(3, "0")}`), "noise");
    }
    await mkdir(join(dataRoot, "kilo-late.db"));
    const observed: string[] = [];

    const result = await collectKiloSessions(home, {
      readOptions: {
        testHooks: {
          onDataDirEntry(_path: string, name: string) { observed.push(name); },
        },
      } as KiloCollectOptions["readOptions"],
    });

    expect(observed).toHaveLength(65);
    expect(result.errors).toContainEqual(
      expect.stringMatching(/directory entry limit 64.*not enumerated/i),
    );
    expect(result.errors.some((error) => /not a regular file/i.test(error))).toBe(
      observed.slice(0, 64).includes("kilo-late.db"),
    );
  });
});
