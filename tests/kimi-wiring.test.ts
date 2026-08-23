import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SUPPORTED_ALTERNATE_HOME_KINDS,
  defaultHomes,
} from "../src/server/collector-instances";
import { collectSessionProvider } from "../src/server/collectors";
import { identitiesFromCommand, isRecognizedAgentProcess } from "../src/server/identity";
import { collectKimiSessions } from "../src/server/kimi";
import { resolveAgentName } from "../src/server/naming";
import { ProviderSettlementCoordinator } from "../src/server/provider-settlement";
import { buildSnapshot } from "../src/server/snapshot";
import { controlsFor } from "../src/server/snapshot-agent";
import { HubState, providerCollectionConfigKey, type HubCollectors } from "../src/server/state";
import { canWriteToTarget, resolveAgentTarget } from "../src/server/targets";
import type {
  ArchiveStore,
  CmuxSurface,
  CollectedAgent,
  CommandRunner,
} from "../src/server/types";
import { PROVIDERS, type Provider } from "../src/shared/types";

const KIMI = "kimi" as Provider;
const SESSION_ID = "session_01234567-89ab-4cde-8f01-23456789abcd";
const PREFIX = SESSION_ID.slice(0, -4);
const SOURCE = "/tmp/formic-kimi-red-fixture/agents/main/wire.jsonl";
const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
const runner: CommandRunner = {
  run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
};

function kimiAgent(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: `kimi:${SESSION_ID}`,
    provider: KIMI,
    sourceSessionId: SESSION_ID,
    runtimeSessionId: SESSION_ID,
    displayName: "Kimi public fixture contract",
    cwd: "/tmp/formic-kimi-fixture/project",
    status: "waiting",
    statusReason: "Kimi Code source is quiet.",
    updatedAt: "2026-08-21T15:00:08.000Z",
    tokens: { scope: "unknown", provenance: "unknown" },
    artifacts: [{ label: "Kimi Code session", path: SOURCE, kind: "transcript" }],
    gates: [],
    allowCwdFallback: false,
    ...overrides,
  };
}

function surface(overrides: Partial<CmuxSurface> = {}): CmuxSurface {
  return {
    workspaceId: "KIMI-WORKSPACE",
    surfaceId: "KIMI-SURFACE",
    cwd: "/tmp/formic-kimi-fixture/project",
    runtimeSurfaceReady: true,
    sourceSessionIds: [],
    sourceSessionClaims: [],
    ...overrides,
  };
}

function resultMap(): any {
  return Object.fromEntries(PROVIDERS.map((provider) => [provider, { value: [], errors: [] }]));
}

describe("Kimi Code CLI assertion-only wiring contract", () => {
  test("KIMI-RED-13 only exact full session and resume values mint Kimi identity", () => {
    const exactCommands = [
      `kimi --session ${SESSION_ID}`,
      `kimi -S ${SESSION_ID}`,
      `kimi --resume ${SESSION_ID}`,
      `kimi -r ${SESSION_ID}`,
    ];
    const refusedCommands = [
      "kimi --session",
      "kimi -S",
      "kimi --resume",
      "kimi -r",
      "kimi --continue",
      "kimi -c",
      "kimi -C",
      `kimi --session ${PREFIX}`,
      `kimi --session /tmp/${SESSION_ID}`,
      `kimi --session /tmp/formic-kimi-fixture/project`,
      `bun --cwd /tmp/formic-kimi-fixture/project dev kimi --session ${SESSION_ID}`,
      `echo kimi --resume ${SESSION_ID}`,
    ];

    expect({
      process: isRecognizedAgentProcess(exactCommands[0]!),
      exact: exactCommands.map((command) => identitiesFromCommand(command)),
      refused: refusedCommands.map((command) => identitiesFromCommand(command)),
    }).toEqual({
      process: true,
      exact: exactCommands.map(() => [{ provider: KIMI, value: SESSION_ID, full: true }]),
      refused: refusedCommands.map(() => []),
    });
  });

  test("KIMI-RED-14 Send Focus and Interrupt require one unique exact-attested Kimi owner", () => {
    const one = kimiAgent();
    const claimed = surface({
      sourceSessionIds: [SESSION_ID],
      sourceSessionClaims: [{ provider: KIMI, sessionId: SESSION_ID }],
    });
    const exact = resolveAgentTarget(one, [claimed], [one]);
    const exactControls = controlsFor(one, exact, false);
    const first = kimiAgent({ instanceId: "kimi:first", id: `kimi:first:${SESSION_ID}` });
    const second = kimiAgent({ instanceId: "kimi:second", id: `kimi:second:${SESSION_ID}` });
    const duplicates = [first, second].map((agent) => {
      const target = resolveAgentTarget(agent, [claimed], [first, second]);
      return {
        resolution: target.resolution,
        writable: canWriteToTarget(target),
        enabled: controlsFor(agent, target, false)
          .filter(({ action }) => ["focus", "instruct", "interrupt"].includes(action))
          .filter(({ enabled }) => enabled)
          .map(({ action }) => action),
      };
    });

    expect({
      exact: {
        resolution: exact.resolution,
        attestation: exact.attestation,
        writable: canWriteToTarget(exact),
        enabled: exactControls
          .filter(({ action }) => ["focus", "instruct", "interrupt"].includes(action))
          .filter(({ enabled }) => enabled)
          .map(({ action }) => action),
      },
      duplicates,
    }).toEqual({
      exact: {
        resolution: "exact",
        attestation: "live",
        writable: true,
        enabled: ["focus", "instruct", "interrupt"],
      },
      duplicates: [
        { resolution: "ambiguous", writable: false, enabled: [] },
        { resolution: "ambiguous", writable: false, enabled: [] },
      ],
    });
  });

  test("KIMI-RED-15 provider registry collector kind alternate home route config key and result shape include Kimi once", async () => {
    const safeHome = mkdtempSync(join(tmpdir(), "formic-kimi-red-registry-"));
    const serverIndex = readFileSync(join(import.meta.dir, "../src/server/index.ts"), "utf8");
    const key = providerCollectionConfigKey as unknown as (...args: unknown[]) => string;
    const config = key(
      10_000, undefined,
      [], [], [], [], [], [], [],
      [], 250, [], ["/tmp/formic-kimi-alternate"],
    );
    let routed: unknown;
    try {
      routed = await (collectSessionProvider as unknown as (...args: unknown[]) => Promise<unknown>)(
        KIMI, safeHome, Number.POSITIVE_INFINITY, undefined, {}, undefined,
      );
    } finally {
      rmSync(safeHome, { recursive: true, force: true });
    }
    const direct = await collectKimiSessions("/tmp/formic-kimi-red-direct", 1, undefined);

    expect({
      providerCount: PROVIDERS.filter((provider) => provider === ("kimi" as string)).length,
      providersUnique: new Set(PROVIDERS).size === PROVIDERS.length,
      alternateKindCount: SUPPORTED_ALTERNATE_HOME_KINDS.filter((kind) => kind === ("kimi" as string)).length,
      defaultHomes: (defaultHomes("/synthetic/home") as ReadonlyArray<{ kind: string; dataDir: string }>)
        .filter((row) => row.kind === "kimi"),
      configHasRoot: config.includes("kimi=/tmp/formic-kimi-alternate"),
      productionRootsReader: (serverIndex.match(/^\s*kimiRootsReader:\s*\(\)\s*=>\s*onboardedSessionRoots\(collectorInstanceStore\)\.extraKimiRoots,\s*$/gm) ?? []).length,
      routed,
      direct,
    }).toEqual({
      providerCount: 1,
      providersUnique: true,
      alternateKindCount: 1,
      defaultHomes: [{ kind: "kimi", dataDir: "/synthetic/home/.kimi-code" }],
      configHasRoot: true,
      productionRootsReader: 1,
      routed: { value: [], errors: [], absent: true },
      direct: { value: [], errors: [], absent: true },
    });
  });

  test("KIMI-RED-16 server web Settings labels official mark and PARITY ledger are exhaustive without an invented model mark", async () => {
    // @ts-expect-error dependency-free browser client has no declaration file
    await import("../src/web/app.js");
    // @ts-expect-error dependency-free browser client has no declaration file
    const settings = await import("../src/web/settings-collectors.js") as unknown as {
      HOME_MARK?: Record<string, string>;
    };
    // @ts-expect-error dependency-free browser client has no declaration file
    const webNaming = await import("../src/web/naming.js") as unknown as {
      PROVIDER_DISPLAY_NAMES?: Record<string, string>;
    };
    const web = (globalThis as unknown as {
      TheAntHill?: {
        HARNESS_MARK?: Record<string, { src?: string; label?: string }>;
        PROVIDER_MARK?: Record<string, { src?: string }>;
        AGENT_MARK?: Record<string, { src?: string }>;
        agentKeyOf?: (agent: { rawModel?: { providerRoute?: string }; model?: string }) => string;
      };
    }).TheAntHill;
    const asset = join(import.meta.dir, "../src/web/icons/kimi.svg");
    const parity = readFileSync(join(import.meta.dir, "../docs/PARITY.md"), "utf8");
    const digest = existsSync(asset)
      ? createHash("sha256").update(readFileSync(asset)).digest("hex")
      : "missing";

    expect({
      serverFallback: resolveAgentName({ provider: KIMI, sourceSessionId: SESSION_ID }, "/tmp/home"),
      webLabel: webNaming.PROVIDER_DISPLAY_NAMES?.kimi,
      settingsHome: settings.HOME_MARK?.kimi,
      harness: web?.HARNESS_MARK?.kimi,
      provider: web?.PROVIDER_MARK?.kimi,
      inventedModelMark: web?.AGENT_MARK?.kimi,
      rawRouteAgent: web?.agentKeyOf?.({
        rawModel: { providerRoute: "kimi" },
        model: "claude-opus-5",
      }),
      digest,
      parity: {
        package: parity.includes("@moonshot-ai/kimi-code"),
        release: parity.includes("0.38.0"),
        commit: parity.includes("0999454bdcb5ddd98f39bffee434dcf0a810f394"),
        protocol: /Kimi[^\n]*(?:wire|protocol)[^\n]*1\.5/i.test(parity),
        metadata: /Kimi[^\n]*(?:metadata|meta)[^\n]*v?2/i.test(parity),
        money: /I-110[^\n]*Kimi[^\n]*(?:USD|cost)|Kimi[^\n]*(?:USD|cost)[^\n]*I-110/i.test(parity),
      },
    }).toEqual({
      serverFallback: { name: "Kimi Code session", base: "Kimi Code session", source: "provider-fallback" },
      webLabel: "Kimi Code",
      settingsHome: "/icons/kimi.svg",
      harness: { src: "/icons/kimi.svg", label: "Kimi Code" },
      provider: { src: "/icons/kimi.svg" },
      inventedModelMark: undefined,
      rawRouteAgent: "kimi",
      digest: "60685e25b2db869030290485a35eed8ca77e535d2c6b7731374df49edbfa98c8",
      parity: { package: true, release: true, commit: true, protocol: true, metadata: true, money: true },
    });
  });

  test("KIMI-RED-18 snapshot and state preserve unknowns abort supersession and path-qualified Kimi health", async () => {
    const sourceHealthPath = "/tmp/formic-kimi-red-health/agents/main/wire.jsonl";
    let kimiCalls = 0;
    const collectors: HubCollectors = {
      sessions: async () => resultMap(),
      sessionProvider: (async (provider: Provider) => {
        if (provider !== KIMI) return { value: [], errors: [] };
        kimiCalls += 1;
        return { value: [], errors: [`${sourceHealthPath}: Kimi metadata is malformed.`] };
      }) as never,
      finalizeSessions: ((results: unknown) => results) as never,
      cmux: async () => ({ value: [], errors: [] }),
      notifications: async () => ({ value: [], errors: [] }),
      enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [], rosterComplete: true }),
    };
    const state = new HubState(runner, archiveStore, [], {
      collectors,
      refreshAggregateTimeoutMs: 250,
      piLaunchReader: async () => [],
    } as never);
    const stateSnapshot = await state.refresh();

    let snapshotError: string | undefined;
    let published: any;
    try {
      const snapshot = buildSnapshot({
        agents: [kimiAgent()],
        surfaces: [],
        archiveStore,
        sourceErrors: { [KIMI]: [] },
        sourceAbsent: { [KIMI]: false },
        now: new Date("2026-08-21T15:00:09.000Z"),
      });
      published = snapshot.programs.flatMap(({ agents }) => agents)
        .find(({ sourceSessionId }) => sourceSessionId === SESSION_ID);
    } catch (error) {
      snapshotError = error instanceof Error ? error.message : String(error);
    }

    const controller = new AbortController();
    const abortReason = new Error("kimi snapshot caller abort sentinel");
    controller.abort(abortReason);
    let abortPreserved = false;
    try {
      await collectKimiSessions("/tmp/formic-kimi-red-abort", 1, undefined, {}, controller.signal);
    } catch (error) {
      abortPreserved = error === abortReason;
    }

    const coordinator = new ProviderSettlementCoordinator<Provider, string>(() => true);
    let release!: (value: string) => void;
    const pending = new Promise<string>((resolve) => { release = resolve; });
    let cutoff!: () => void;
    const first = coordinator.settle([KIMI], () => pending, {
      waitMs: 1,
      wait: () => new Promise<void>((resolve) => { cutoff = resolve; }),
    });
    await Promise.resolve();
    cutoff();
    const firstResult = await first;
    coordinator.discardInFlight();
    release("discarded-kimi-result");
    await Promise.resolve();
    const secondResult = await coordinator.settle([KIMI], async () => "replacement-kimi-result", { waitMs: 10 });

    expect({
      snapshotError,
      unknowns: published && {
        tokens: published.tokens,
        total: published.tokens?.total,
        cost: published.cost,
        endEvidence: published.endEvidence,
        processIds: published.processIds,
        processAlive: published.processAlive,
        launchCwd: published.launchCwd,
      },
      kimiCalls,
      stateHealth: stateSnapshot.totals.sourceHealth?.byProvider?.[KIMI],
      pathQualified: JSON.stringify(stateSnapshot).includes(sourceHealthPath),
      abortPreserved,
      firstTimedOut: firstResult.timedOut,
      replacement: secondResult.current,
      lastKnown: secondResult.lastKnown,
    }).toEqual({
      snapshotError: undefined,
      unknowns: {
        tokens: { scope: "unknown", provenance: "unknown" },
        total: undefined,
        cost: undefined,
        endEvidence: undefined,
        processIds: undefined,
        processAlive: undefined,
        launchCwd: undefined,
      },
      kimiCalls: 1,
      stateHealth: { healthy: false, lastHealthyAt: null },
      pathQualified: true,
      abortPreserved: true,
      firstTimedOut: [KIMI],
      replacement: { [KIMI]: "replacement-kimi-result" } as Record<string, string>,
      lastKnown: {},
    });
  });
});
