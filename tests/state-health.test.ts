import { describe, expect, spyOn, test } from "bun:test";
import { HubState, type HubCollectors } from "../src/server/state";
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
});

describe("cmux collection time truth", () => {
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
      collectors,
      undefined,
      undefined,
      undefined,
      "/opt/cmux/bin/cmux",
    );

    await state.refresh({ cmux: true });

    expect(executables).toEqual(["/opt/cmux/bin/cmux", "/opt/cmux/bin/cmux"]);
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
    const state = new HubState(runner, archiveStore, [], collectors);

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
    const state = new HubState(runner, archiveStore, [], collectors);

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
    const never = new Promise<never>(() => {});
    const collectors: HubCollectors = {
      sessions: async () => {
        sessionCalls += 1;
        if (sessionCalls === 1) await never;
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
    const state = new HubState(runner, archiveStore, [], collectors);

    void state.refresh();
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    expect(sessionCalls).toBe(1);

    nowMs += 12_001;
    await state.refresh();

    expect(sessionCalls).toBe(2);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("refresh watchdog"));
    now.mockRestore();
    logged.mockRestore();
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
      collectors,
      undefined,
      () => triageSummaries,
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
    const state = new HubState(runner, archiveStore, [], collectors);

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
      collectors,
      undefined,
      undefined,
      burnReader,
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
