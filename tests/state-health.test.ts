import { describe, expect, spyOn, test } from "bun:test";
import { MemoryArchiveStore } from "../src/server/archive";
import { collectCmuxWorkspaceEnvs } from "../src/server/cmux";
import { HubState, type HubCollectors } from "../src/server/state";
import type { IdentityBindingStore } from "../src/server/identity-bindings";
import type {
  ArchiveStore,
  CmuxNotification,
  CmuxSurface,
  CollectedAgent,
  CommandRunner,
} from "../src/server/types";
import type { TriageQueueSummary } from "../src/shared/types";

const emptySessions = () => ({
  omp: { value: [], errors: [] },
  codex: { value: [], errors: [] },
  claude: { value: [], errors: [] },
  cursor: { value: [], errors: [] },
  factory: { value: [], errors: [] },
});

describe("cmux collection time truth", () => {
  test("production publishes consumption only from a complete session scan", async () => {
    let collectionErrors: string[] = [];
    const source: CollectedAgent = {
      id: "codex:consumption",
      provider: "codex",
      sourceSessionId: "consumption",
      displayName: "Consumption fixture",
      status: "running",
      statusReason: "Fixture activity is recent.",
      updatedAt: new Date().toISOString(),
      tokens: {
        total: 90_000,
        sessionTotal: 1_500,
        sessionCachedInput: 74_000,
        sessionProcessed: 75_500,
        provenance: "observed",
      },
      artifacts: [],
      gates: [],
    };
    const collectors: HubCollectors = {
      sessions: async () => ({
        ...emptySessions(),
        codex: { value: [source], errors: collectionErrors },
      }),
      cmux: async () => ({ value: [], errors: [] }),
      notifications: async () => ({ value: [], errors: [] }),
      enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [] }),
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const state = new HubState(runner, new MemoryArchiveStore(), [], { collectors });

    expect(state.get().totals).not.toHaveProperty("consumption");
    await state.refresh();
    expect(state.get().totals.consumption).toBe(1_500);

    collectionErrors = ["codex session enumeration failed"];
    await state.refresh();
    expect(state.get().totals).not.toHaveProperty("consumption");
  });

  test("boot and issue decoration retain a coherent, current pulse across repeated reads", () => {
    let nowMs = 1_000;
    const now = spyOn(Date, "now").mockImplementation(() => nowMs);
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    const state = new HubState(runner, archiveStore, []);

    const boot = state.get();
    expect(boot.pulse?.momentum).toMatchObject({
      completionsLastHour: null,
      observedWindowMs: 0,
    });
    expect(state.get().pulse?.momentum.completionsLastHour).toBe(boot.pulse?.momentum.completionsLastHour);

    nowMs += 20 * 60_000;
    state.markIssueVerifying("system:cmux-control");
    const decorated = state.get();
    expect(decorated.pulse?.momentum).toMatchObject({
      completionsLastHour: null,
      observedWindowMs: 20 * 60_000,
    });
    expect(state.get().pulse?.momentum.completionsLastHour).toBe(decorated.pulse?.momentum.completionsLastHour);
    now.mockRestore();
  });

  test("passes the runtime executable to terminal and notification discovery", async () => {
    const executables: string[] = [];
    const collectors: HubCollectors = {
      sessions: async () => emptySessions(),
      cmux: async (_runner, executable) => {
        executables.push(executable ?? "missing");
        return { value: [], errors: [] };
      },
      notifications: async (_runner, executable) => {
        executables.push(executable ?? "missing");
        return { value: [], errors: [] };
      },
      enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [] }),
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    const state = new HubState(
      runner,
      archiveStore,
      [],
      { collectors, cmuxExecutable: "/opt/cmux/bin/cmux" },
    );

    await state.refresh({ cmux: true });

    expect(executables).toEqual(["/opt/cmux/bin/cmux", "/opt/cmux/bin/cmux"]);
  });

  test("stale workspace metadata does not degrade an otherwise reachable control plane", async () => {
    const collectors: HubCollectors = {
      sessions: async () => emptySessions(),
      cmux: async () => ({
        value: [{ workspaceId: "WORKSPACE-STALE", surfaceId: "SURFACE-STALE", sourceSessionIds: [] }],
        errors: [],
      }),
      workspaceEnv: collectCmuxWorkspaceEnvs,
      notifications: async () => ({ value: [], errors: [] }),
      enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [] }),
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 1, stdout: "", stderr: "Error: not_found: Workspace not found", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    const state = new HubState(runner, archiveStore, [], { collectors });

    await state.refresh({ cmux: true });

    expect(state.get().controlHealth).toMatchObject({ cmuxReachable: true, errors: [] });
    expect(state.get().issues?.find((issue) => issue.id === "system:cmux-control")).toBeUndefined();
  });

  test("a cmux request coalesced behind a source refresh still runs once and remains the lastCheckedAt", async () => {
    let releaseFirst!: () => void;
    const firstSessionScan = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let sessionCalls = 0;
    let cmuxCalls = 0;
    const collectors: HubCollectors = {
      sessions: async () => {
        sessionCalls += 1;
        if (sessionCalls === 1) await firstSessionScan;
        return emptySessions();
      },
      cmux: async () => {
        cmuxCalls += 1;
        return { value: [], errors: [] };
      },
      notifications: async () => ({ value: [], errors: [] }),
      enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [] }),
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    const state = new HubState(runner, archiveStore, [], { collectors });

    const sourceOnly = state.refresh();
    const queuedCmux = state.refresh({ cmux: true });
    releaseFirst();
    await Promise.all([sourceOnly, queuedCmux]);

    const checkedAt = state.get().controlHealth.lastCheckedAt;
    expect(cmuxCalls).toBe(1);
    expect(checkedAt).not.toBe(new Date(0).toISOString());
    expect(state.get().controlHealth.cmuxReachable).toBe(true);

    await state.refresh();
    expect(sessionCalls).toBe(3);
    expect(cmuxCalls).toBe(1);
    expect(state.get().controlHealth.lastCheckedAt).toBe(checkedAt);
  });

  test("a failed cmux poll preserves the last confirmed surfaces and notifications without advancing check time", async () => {
    const source: CollectedAgent = {
      id: "codex:retained-session",
      provider: "codex",
      sourceSessionId: "retained-session",
      displayName: "Retained session",
      status: "attention",
      statusReason: "Fixture needs attention.",
      updatedAt: "2026-07-28T08:00:00.000Z",
      tokens: { provenance: "unknown" },
      artifacts: [],
      gates: [],
    };
    const surface: CmuxSurface = {
      workspaceId: "WORKSPACE-RETAINED",
      surfaceId: "SURFACE-RETAINED",
      sourceSessionIds: [source.sourceSessionId],
    };
    const notification: CmuxNotification = {
      id: "notification-retained",
      surfaceId: surface.surfaceId,
      createdAt: "2026-07-28T08:00:00.000Z",
      title: "Needs review",
    };
    let failCmux = false;
    const collectors: HubCollectors = {
      sessions: async () => ({
        ...emptySessions(),
        codex: { value: [source], errors: [] },
      }),
      cmux: async () => failCmux
        ? { value: [], errors: ["cmux terminal discovery timed out"] }
        : { value: [surface], errors: [] },
      notifications: async () => failCmux
        ? { value: [], errors: ["cmux notification discovery timed out"] }
        : { value: [notification], errors: [] },
      enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [] }),
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    const state = new HubState(runner, archiveStore, [], { collectors });

    await state.refresh({ cmux: true });
    const lastSuccessfulCheck = state.get().controlHealth.lastCheckedAt;
    expect(state.surfaces()).toEqual([surface]);
    expect(state.get().programs[0]?.agents[0]).toMatchObject({
      outcome: "needs-you",
      target: { surfaceId: surface.surfaceId, resolution: "exact" },
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    failCmux = true;
    await state.refresh({ cmux: true });

    expect(state.surfaces()).toEqual([surface]);
    expect(state.get().controlHealth).toMatchObject({
      cmuxReachable: false,
      lastCheckedAt: lastSuccessfulCheck,
      errors: [
        "cmux terminal discovery timed out",
        "cmux notification discovery timed out",
      ],
    });
    expect(state.get().programs[0]?.agents[0]).toMatchObject({
      outcome: "needs-you",
      target: { surfaceId: surface.surfaceId, resolution: "exact" },
    });
  });

  test("a refresh pending beyond three tick intervals is dropped so the next tick can complete", async () => {
    let nowMs = 1_000;
    const now = spyOn(Date, "now").mockImplementation(() => nowMs);
    const logged = spyOn(console, "error").mockImplementation(() => {});
    let sessionCalls = 0;
    let releaseFirst!: () => void;
    const firstSessionScan = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const collectors: HubCollectors = {
      sessions: async () => {
        sessionCalls += 1;
        if (sessionCalls === 1) await firstSessionScan;
        return emptySessions();
      },
      cmux: async () => ({ value: [], errors: [] }),
      notifications: async () => ({ value: [], errors: [] }),
      enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [] }),
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    const state = new HubState(runner, archiveStore, [], { collectors });

    const droppedRefresh = state.refresh();
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    expect(sessionCalls).toBe(1);

    nowMs += 12_001;
    await state.refresh();
    releaseFirst();
    await droppedRefresh;

    expect(sessionCalls).toBe(2);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("refresh watchdog"));
    now.mockRestore();
    logged.mockRestore();
  });

  test("the collector aggregate deadline publishes partial source truth with visible degradation", async () => {
    const source: CollectedAgent = {
      id: "codex:partial",
      provider: "codex",
      sourceSessionId: "partial",
      displayName: "Completed before aggregate deadline",
      status: "waiting",
      statusReason: "Fixture completed collection.",
      updatedAt: new Date().toISOString(),
      tokens: { provenance: "unknown" },
      artifacts: [],
      gates: [],
    };
    const never = new Promise<never>(() => {});
    const collectors: HubCollectors = {
      sessions: async () => ({
        ...emptySessions(),
        codex: { value: [source], errors: [] },
      }),
      cmux: async () => ({ value: [], errors: [] }),
      notifications: async () => never,
      enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [] }),
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    const logged = spyOn(console, "error").mockImplementation(() => {});
    const state = new HubState(
      runner,
      archiveStore,
      [],
      { collectors, refreshAggregateTimeoutMs: 5 },
    );

    const snapshot = await state.refresh({ cmux: true });

    expect(snapshot.programs.flatMap(({ agents }) => agents).map(({ id }) => id)).toEqual([source.id]);
    expect(snapshot.controlHealth.cmuxReachable).toBeTrue();
    expect(snapshot.controlHealth.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("collector aggregate exceeded 5ms deadline"),
    ]));
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("publishing partial snapshot"));
    logged.mockRestore();
  });

  test("observed sessions survive later scans as ended history and never count as live", async () => {
    const source: CollectedAgent = {
      id: "codex:durable-history",
      provider: "codex",
      sourceSessionId: "durable-history",
      displayName: "Durable history",
      status: "running",
      statusReason: "Source is active.",
      updatedAt: new Date().toISOString(),
      tokens: { provenance: "unknown" },
      artifacts: [],
      gates: [],
    };
    let includeSource = true;
    const collectors: HubCollectors = {
      sessions: async () => ({
        ...emptySessions(),
        codex: { value: includeSource ? [source] : [], errors: [] },
      }),
      cmux: async () => ({ value: [], errors: [] }),
      notifications: async () => ({ value: [], errors: [] }),
      enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [] }),
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const state = new HubState(runner, new MemoryArchiveStore(), [], { collectors });

    const live = await state.refresh();
    includeSource = false;
    const retained = await state.refresh();

    expect(live.totals.live).toBe(1);
    expect(retained.programs.flatMap(({ agents }) => agents)).toEqual([
      expect.objectContaining({ id: source.id, status: "archived", activity: "ended" }),
    ]);
    expect(retained.totals.live).toBe(0);
  });

  test("snapshot refreshes read current triage summaries", async () => {
    const collectors: HubCollectors = {
      sessions: async () => emptySessions(),
      cmux: async () => ({ value: [], errors: [] }),
      notifications: async () => ({ value: [], errors: [] }),
      enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [] }),
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    let triageSummaries: TriageQueueSummary[] = [{ issueId: "queue:detached", state: "queued" }];
    const state = new HubState(
      runner,
      archiveStore,
      [],
      { collectors, triageReader: () => triageSummaries },
    );

    await state.refresh({ cmux: true });
    expect(state.get().triageSummaries).toEqual([{ issueId: "queue:detached", state: "queued" }]);
    expect(state.get().issues).toEqual([]);

    // Orphan blocked triage rows remain passthrough data without live issues.
    triageSummaries = [{ issueId: "queue:detached", state: "blocked" }];
    await state.refresh();
    expect(state.get().triageSummaries).toEqual([{ issueId: "queue:detached", state: "blocked" }]);
    expect(state.get().issues).toEqual([]);
  });
  test("per-source health timestamps set on success and survive later failure", async () => {
    let codexErrors: string[] = [];
    const collectors: HubCollectors = {
      sessions: async () => ({
        ...emptySessions(),
        codex: { value: [], errors: codexErrors },
      }),
      cmux: async () => ({ value: [], errors: [] }),
      notifications: async () => ({ value: [], errors: [] }),
      enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [] }),
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    const state = new HubState(runner, archiveStore, [], { collectors });

    expect(state.get().totals.sourceHealth?.byProvider?.codex).toEqual({
      healthy: false,
      lastHealthyAt: null,
    });

    await state.refresh();
    const firstSuccess = state.get().totals.sourceHealth?.byProvider?.codex;
    expect(firstSuccess?.healthy).toBe(true);
    expect(typeof firstSuccess?.lastHealthyAt).toBe("string");
    expect(Number.isFinite(Date.parse(firstSuccess?.lastHealthyAt ?? ""))).toBe(true);
    const lastHealthyAt = firstSuccess?.lastHealthyAt ?? null;

    codexErrors = ["Codex collection failed."];
    await state.refresh();
    expect(state.get().totals.sourceHealth?.byProvider?.codex).toEqual({
      healthy: false,
      lastHealthyAt,
    });
  });
  test("a hung burn reader cannot block refresh", async () => {
    const collectors: HubCollectors = {
      sessions: async () => emptySessions(),
      cmux: async () => ({ value: [], errors: [] }),
      notifications: async () => ({ value: [], errors: [] }),
      enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [] }),
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    let burnCalls = 0;
    const burnReader = () => {
      burnCalls += 1;
      return new Promise<never>(() => {});
    };
    const state = new HubState(
      runner,
      archiveStore,
      [],
      { collectors, burnReader },
    );

    const refresh = state.refresh();
    let settled = false;
    void refresh.then(() => {
      settled = true;
    });
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();

    expect(settled).toBe(true);
    expect(burnCalls).toBe(1);
    expect((await refresh).pulse).toBeDefined();
  });
});

describe("operator thresholds reach the collectors", () => {
  /* The settings the board classifies by are useless if they stop at the store.
     This asserts the whole path — settingsReader -> HubState -> collectSessions
     -> ParseMetadata -> the comparison — by watching what the collector is
     handed, and asserts it is re-read per refresh rather than captured once at
     construction, because a settings POST triggers a refresh and the operator
     expects that refresh to use their new numbers. */
  test("a refresh hands the collector the operator's freshness and quiet bands", async () => {
    const seen: Array<{ freshMs: number; quietMs: number } | undefined> = [];
    const collectors: HubCollectors = {
      sessions: async (_home, _windowMs, thresholds) => {
        seen.push(thresholds);
        return emptySessions();
      },
      cmux: async () => ({ value: [], errors: [] }),
      notifications: async () => ({ value: [], errors: [] }),
      enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [] }),
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    let activityQuietMinutes = 45;
    const state = new HubState(
      runner,
      archiveStore,
      [],
      {
        collectors,
        settingsReader: () => ({
          version: 2,
          activityFreshMinutes: 3,
          activityQuietMinutes,
          stalledActiveMinutes: 30,
          scanWindowHours: 36,
          historyRetentionDays: 30,
          historyRecordLimit: 5000,
          defaultView: "needs-you",
          showReviewWorkers: false,
        }),
      },
    );

    await state.refresh({});
    expect(seen.at(-1)).toEqual({ freshMs: 3 * 60_000, quietMs: 45 * 60_000 });

    activityQuietMinutes = 180;
    await state.refresh({});
    expect(seen.at(-1)).toEqual({ freshMs: 3 * 60_000, quietMs: 180 * 60_000 });
  });

  test("a hub with no settings store leaves the collector on its own defaults", async () => {
    const seen: Array<unknown> = [];
    const collectors: HubCollectors = {
      sessions: async (_home, _windowMs, thresholds) => {
        seen.push(thresholds);
        return emptySessions();
      },
      cmux: async () => ({ value: [], errors: [] }),
      notifications: async () => ({ value: [], errors: [] }),
      enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [] }),
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const state = new HubState(runner, { has: () => false, archive: async () => {} }, [], { collectors });

    await state.refresh({});
    expect(seen).toEqual([undefined]);
  });
});

describe("what is recorded is what is published", () => {
  /* The history write used to run BEFORE the bindings bridge, and the bridge
     rewrites processAlive/processIds for every bound agent. So the record
     captured pre-bridge evidence while the snapshot published post-bridge
     evidence — two answers about the same session in the same refresh, and the
     archive kept the older one. Harmless while a record was just a row of text;
     not harmless now that the record carries a lifecycle verdict derived from
     exactly the evidence the two disagreed about. */
  test("the archive records the agents the snapshot publishes, after bridging", async () => {
    const collected: CollectedAgent = {
      id: "codex:bridged",
      provider: "codex",
      sourceSessionId: "bridged",
      displayName: "Bridged session",
      cwd: "/Users/me/project",
      status: "running",
      statusReason: "Observed.",
      updatedAt: new Date().toISOString(),
      tokens: { provenance: "unknown" },
      artifacts: [],
      gates: [],
    };
    const recorded: CollectedAgent[][] = [];
    const archiveStore: ArchiveStore = {
      has: () => false,
      archive: async () => {},
      record: async (agents) => {
        calls.push("record");
        recorded.push(agents.map((agent) => ({ ...agent })));
      },
      archivedAgents: () => [],
    };
    const collectors: HubCollectors = {
      sessions: async () => ({
        omp: { value: [], errors: [] },
        codex: { value: [collected], errors: [] },
        claude: { value: [], errors: [] },
        cursor: { value: [], errors: [] },
        factory: { value: [], errors: [] },
      }),
      cmux: async () => ({ value: [], errors: [] }),
      notifications: async () => ({ value: [], errors: [] }),
      enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [] }),
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    /* The bridge is observed through the store it reads. Every bound agent
       makes buildSnapshot's input pass through `get`, so a `get` that lands
       AFTER the history write is the exact defect this asserts against. */
    const calls: string[] = [];
    const bindingStore: IdentityBindingStore = {
      get: (sessionId) => { calls.push(`bridge:${sessionId}`); return undefined; },
      list: () => [],
      put: async () => {},
      putMany: async () => {},
    };
    const state = new HubState(
      runner,
      archiveStore,
      [],
      { collectors, bindingStore },
    );

    const snapshot = await state.refresh({ cmux: true });

    expect(recorded).toHaveLength(1);
    const published = snapshot.programs.flatMap((program) => program.agents);
    expect(recorded[0]!.map(({ id }) => id)).toEqual(published.map(({ id }) => id));
    // Both sides of the claim: the bridge ran, and it ran first.
    expect(calls).toContain("bridge:bridged");
    expect(calls.indexOf("bridge:bridged")).toBeLessThan(calls.indexOf("record"));
  });
});
