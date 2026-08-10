import { describe, expect, spyOn, test } from "bun:test";
import { createAgentLinkFetch } from "../src/server/agent-links";
import { MemoryArchiveStore } from "../src/server/archive";
import { handleBroadcastRequest } from "../src/server/broadcast";
import { collectCmuxWorkspaceEnvs } from "../src/server/cmux";
import { handleControlRequest } from "../src/server/http";
import { HubState, type HubCollectors } from "../src/server/state";
import { MemoryIdentityBindingStore, type IdentityBindingStore } from "../src/server/identity-bindings";
import type {
  ArchiveStore,
  CmuxNotification,
  CmuxSurface,
  CollectedAgent,
  CommandRunner,
} from "../src/server/types";
import type { HubSnapshot, TriageQueueSummary } from "../src/shared/types";

const emptySessions = () => ({
  omp: { value: [], errors: [] },
  codex: { value: [], errors: [] },
  claude: { value: [], errors: [] },
  cursor: { value: [], errors: [] },
  factory: { value: [], errors: [] },
  prime: { value: [], errors: [] },
});

const ROUTING_RACE_SESSION_ID = "routing-race-session";
const ROUTING_RACE_AGENT_ID = `codex:${ROUTING_RACE_SESSION_ID}`;
const ROUTING_RACE_PROCESS_ID = 7_077;

function routingRaceSource(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: ROUTING_RACE_AGENT_ID,
    provider: "codex",
    sourceSessionId: ROUTING_RACE_SESSION_ID,
    displayName: "Routing race session",
    status: "waiting",
    statusReason: "Fixture waits for operator input.",
    updatedAt: new Date().toISOString(),
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    ...overrides,
  };
}

function routingRaceSurface(suffix: "OLD" | "NEW"): CmuxSurface {
  const surfaceId = `SURFACE-${suffix}`;
  const tty = suffix === "OLD" ? "ttys077" : "ttys088";
  return {
    surfaceId,
    tty,
    sourceSessionIds: [ROUTING_RACE_SESSION_ID],
    sourceSessionClaims: [{ provider: "codex", sessionId: ROUTING_RACE_SESSION_ID }],
    identityTrace: {
      surfaceId,
      tty,
      processes: [{
        pid: ROUTING_RACE_PROCESS_ID,
        command: `codex resume ${ROUTING_RACE_SESSION_ID}`,
        recognizedAgentProcess: true,
      }],
      openFileMatches: [{
        pid: ROUTING_RACE_PROCESS_ID,
        path: `/tmp/${ROUTING_RACE_SESSION_ID}.jsonl`,
        provider: "codex",
        sessionId: ROUTING_RACE_SESSION_ID,
      }],
      commandHints: [],
      outcome: "open-file-match",
      sourceSessionIds: [ROUTING_RACE_SESSION_ID],
    },
  };
}

function failedRoutingRaceSurface(): CmuxSurface {
  return {
    ...routingRaceSurface("OLD"),
    sourceSessionIds: [],
    sourceSessionClaims: [],
    identityConflict: "process identity lookup timed out",
    identityTrace: {
      surfaceId: "SURFACE-OLD",
      tty: "ttys077",
      processes: [],
      openFileMatches: [],
      commandHints: [],
      outcome: "probe-failed",
      sourceSessionIds: [],
      identityConflict: "process identity lookup timed out",
      notes: ["process identity lookup timed out"],
    },
  };
}

function healthyRoutingRaceIdentity(surfaces: readonly CmuxSurface[]) {
  return {
    value: [...surfaces],
    errors: [],
    liveAgentProcessIds: [ROUTING_RACE_PROCESS_ID],
    recognizedAgentProcessIds: [ROUTING_RACE_PROCESS_ID],
    processStarts: {},
    rosterComplete: true,
  };
}

function deferred() {
  let resolve!: () => void;
  const waiting = new Promise<void>((done) => { resolve = done; });
  return { waiting, resolve };
}

function recordingRunner(commands: string[][]): CommandRunner {
  return {
    run: async (command) => {
      commands.push([...command]);
      return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
    },
  };
}

function routingRaceAgent(snapshot: HubSnapshot) {
  return snapshot.programs.flatMap((program) => program.agents)
    .find((agent) => agent.id === ROUTING_RACE_AGENT_ID);
}

function controlMapFrom(
  controls: readonly { action: string; enabled: boolean }[] | undefined,
): Record<string, boolean> {
  return Object.fromEntries(controls?.map(({ action, enabled }) => [action, enabled]) ?? []);
}

function routingRaceHarness(options: {
  source?: () => CollectedAgent;
  surface?: () => CmuxSurface;
  beforeSessions?: () => Promise<void>;
  enrichIdentity?: HubCollectors["enrichIdentity"];
  archiveStore?: ArchiveStore;
  bindingStore?: IdentityBindingStore;
} = {}) {
  const archiveStore = options.archiveStore ?? new MemoryArchiveStore();
  const collectors: HubCollectors = {
    sessions: async () => {
      await options.beforeSessions?.();
      return {
        ...emptySessions(),
        codex: { value: [options.source?.() ?? routingRaceSource()], errors: [] },
      };
    },
    cmux: async () => ({ value: [options.surface?.() ?? routingRaceSurface("OLD")], errors: [] }),
    notifications: async () => ({ value: [], errors: [] }),
    enrichIdentity: options.enrichIdentity
      ?? (async (surfaces) => healthyRoutingRaceIdentity(surfaces)),
  };
  const state = new HubState(recordingRunner([]), archiveStore, [], {
    collectors,
    bindingStore: options.bindingStore,
  });
  return { archiveStore, state };
}

async function exerciseRoutingRace(
  state: HubState,
  archiveStore: ArchiveStore,
  includeFocus = false,
) {
  const terminalInputCommands: string[][] = [];
  const focusCommands: string[][] = [];
  const request = (path: string, body: unknown) => new Request(`http://127.0.0.1:4701/${path}`, {
    method: "POST",
    headers: { origin: "http://127.0.0.1:4701", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const control = await handleControlRequest(
    request("api/control", {
      action: "instruct",
      agentId: ROUTING_RACE_AGENT_ID,
      instruction: "Probe the authorization barrier.",
    }),
    { runner: recordingRunner(terminalInputCommands), archiveStore, getSnapshot: () => state.get() },
  );
  const broadcast = await handleBroadcastRequest(
    request("api/broadcast", {
      agentIds: [ROUTING_RACE_AGENT_ID],
      instruction: "Probe the broadcast barrier.",
    }),
    { runner: recordingRunner(terminalInputCommands), archiveStore, getSnapshot: () => state.get() },
  );
  const focus = includeFocus
    ? await createAgentLinkFetch(
        () => new Response(null, { status: 404 }),
        {
          runner: recordingRunner(focusCommands),
          archiveStore,
          getSnapshot: () => state.get(),
          surfaces: () => state.surfaces(),
        },
      )(new Request(`http://127.0.0.1:4701/agent/${encodeURIComponent(ROUTING_RACE_AGENT_ID)}/focus`))
    : undefined;
  return {
    controlStatus: control.status,
    broadcastStatus: broadcast.status,
    focusStatus: focus?.status,
    terminalInputCommands,
    focusCommands,
  };
}

function expectRoutingQuarantine(
  snapshot: HubSnapshot,
  previouslyPublished: HubSnapshot,
): void {
  const agent = routingRaceAgent(snapshot);
  const previousControls = controlMapFrom(routingRaceAgent(previouslyPublished)?.controls);
  expect(agent).toMatchObject({
    controlState: "observed-only",
    target: { resolution: "missing" },
  });
  expect(controlMapFrom(agent?.controls)).toMatchObject({
    focus: false,
    instruct: false,
    interrupt: false,
    archive: previousControls.archive,
    unarchive: previousControls.unarchive,
  });
  expect(snapshot.generatedAt).toBe(previouslyPublished.generatedAt);
}

function expectWritableRoute(snapshot: HubSnapshot, surfaceId: string): void {
  const agent = routingRaceAgent(snapshot);
  expect(agent?.target).toMatchObject({ surfaceId, resolution: "exact", attestation: "live" });
  expect(controlMapFrom(agent?.controls)).toMatchObject({
    focus: true,
    instruct: true,
    interrupt: true,
  });
}

function bindingWriteBarrier() {
  const memory = new MemoryIdentityBindingStore();
  let armed = false;
  let blocked = deferred();
  let release = deferred();
  const store: IdentityBindingStore = {
    get: (sessionId) => memory.get(sessionId),
    getForProvider: (provider, sessionId) => memory.getForProvider(provider, sessionId),
    list: () => memory.list(),
    put: (binding) => memory.put(binding),
    putMany: async (bindings) => {
      if (armed) {
        armed = false;
        blocked.resolve();
        await release.waiting;
      }
      await memory.putMany(bindings);
    },
  };
  return {
    store,
    arm: () => {
      blocked = deferred();
      release = deferred();
      armed = true;
      return { waiting: blocked.waiting, release: release.resolve };
    },
  };
}

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

  test("a current A-to-B identity replacement withdraws the published route before binding persistence", async () => {
    let currentSurface = routingRaceSurface("OLD");
    const bindingBarrier = bindingWriteBarrier();
    const { archiveStore, state } = routingRaceHarness({
      surface: () => currentSurface,
      bindingStore: bindingBarrier.store,
    });

    await state.refresh({ cmux: true });
    const unchangedPublications: ReturnType<HubState["get"]>[] = [];
    const unsubscribeUnchanged = state.subscribe((snapshot) => { unchangedPublications.push(snapshot); });
    const unchanged = await state.refresh({ cmux: true });
    unsubscribeUnchanged();
    expect(unchangedPublications).toHaveLength(1);
    expectWritableRoute(unchangedPublications[0]!, "SURFACE-OLD");

    const transitionPublications: ReturnType<HubState["get"]>[] = [];
    const unsubscribeTransition = state.subscribe((snapshot) => { transitionPublications.push(snapshot); });
    const bindingWrite = bindingBarrier.arm();
    currentSurface = routingRaceSurface("NEW");
    const changing = state.refresh({ cmux: true });
    await bindingWrite.waiting;

    const barrierSnapshot = state.get();
    const requests = await exerciseRoutingRace(state, archiveStore, true);

    bindingWrite.release();
    const recovered = await changing;
    unsubscribeTransition();

    expect(requests).toMatchObject({
      controlStatus: 409,
      broadcastStatus: 409,
      terminalInputCommands: [],
    });
    expect([200, 409]).toContain(requests.focusStatus!);
    expect(requests.focusCommands.flat().join(" ")).not.toContain("SURFACE-OLD");
    if (requests.focusStatus === 200) {
      expect(requests.focusCommands).toEqual([
        expect.arrayContaining([
          "surface.focus",
          expect.stringContaining('\"surface_id\":\"SURFACE-NEW\"'),
        ]),
      ]);
    } else {
      expect(requests.focusCommands).toEqual([]);
    }
    expectRoutingQuarantine(barrierSnapshot, unchanged);
    expect(transitionPublications).toHaveLength(2);
    expect(transitionPublications[0]?.generatedAt).toBe(unchanged.generatedAt);
    expect(routingRaceAgent(recovered)?.processState).toBe("running");
    expectWritableRoute(recovered, "SURFACE-NEW");
  });

  test("watchdog supersession preserves quarantine after failed current identity evidence", async () => {
    let nowMs = Date.now();
    const now = spyOn(Date, "now").mockImplementation(() => nowMs);
    const logged = spyOn(console, "error").mockImplementation(() => {});
    let phase: "healthy" | "failed" | "replacement" = "healthy";
    const replacementStarted = deferred();
    const replacementRelease = deferred();
    const bindingBarrier = bindingWriteBarrier();
    const { archiveStore, state } = routingRaceHarness({
      beforeSessions: async () => {
        if (phase === "replacement") {
          replacementStarted.resolve();
          await replacementRelease.waiting;
        }
      },
      surface: () => routingRaceSurface(phase === "replacement" ? "NEW" : "OLD"),
      enrichIdentity: async (surfaces) => phase === "failed"
        ? {
            value: [failedRoutingRaceSurface()],
            errors: ["process identity lookup timed out"],
            liveAgentProcessIds: [],
            recognizedAgentProcessIds: [],
            processStarts: {},
            rosterComplete: false,
          }
        : healthyRoutingRaceIdentity(surfaces),
      bindingStore: bindingBarrier.store,
    });

    const healthy = await state.refresh({ cmux: true });
    const bindingWrite = bindingBarrier.arm();
    phase = "failed";
    const superseded = state.refresh({ cmux: true });
    await bindingWrite.waiting;
    expect(state.surfaces()).toEqual([
      expect.objectContaining({
        surfaceId: "SURFACE-OLD",
        sourceSessionIds: [],
        sourceSessionClaims: [],
        identityTrace: expect.objectContaining({ outcome: "probe-failed" }),
      }),
    ]);

    nowMs += 12_001;
    phase = "replacement";
    const replacement = state.refresh({ cmux: true });
    await replacementStarted.waiting;
    bindingWrite.release();
    await superseded;

    const barrierSnapshot = state.get();
    const requests = await exerciseRoutingRace(state, archiveStore, true);

    replacementRelease.resolve();
    const recovered = await replacement;
    now.mockRestore();
    logged.mockRestore();

    expect(requests).toEqual({
      controlStatus: 409,
      broadcastStatus: 409,
      focusStatus: 409,
      terminalInputCommands: [],
      focusCommands: [],
    });
    expectRoutingQuarantine(barrierSnapshot, healthy);
    expect(routingRaceAgent(recovered)?.processState).toBe("running");
    expectWritableRoute(recovered, "SURFACE-NEW");
  });

  test("a source-only session exit withdraws terminal authority before history persistence", async () => {
    let ended = false;
    let recordArmed = false;
    const recordStarted = deferred();
    const recordRelease = deferred();
    const archiveStore: ArchiveStore = {
      has: () => false,
      archive: async () => {},
      record: async () => {
        if (!recordArmed) return;
        recordArmed = false;
        recordStarted.resolve();
        await recordRelease.waiting;
      },
    };
    const { state } = routingRaceHarness({
      archiveStore,
      source: () => routingRaceSource(ended ? { endEvidence: "session-exit" } : {}),
    });

    const healthy = await state.refresh({ cmux: true });
    ended = true;
    recordArmed = true;
    const terminalRefresh = state.refresh();
    await recordStarted.waiting;

    const barrierSnapshot = state.get();
    const requests = await exerciseRoutingRace(state, archiveStore);

    recordRelease.resolve();
    const completed = await terminalRefresh;

    expect(requests).toMatchObject({
      controlStatus: 409,
      broadcastStatus: 409,
      terminalInputCommands: [],
    });
    expectRoutingQuarantine(barrierSnapshot, healthy);
    const completedAgent = completed.programs[0]?.agents[0];
    expect(completedAgent).toMatchObject({
      lifecycle: "finished",
      processState: "exited",
    });
    expect(controlMapFrom(completedAgent?.controls)).toMatchObject({
      focus: false,
      instruct: false,
      interrupt: false,
    });
  });

  test("a failed cmux or identity scan quarantines retained routing and PID evidence until recovery re-attests it", async () => {
    const processId = 4_242;
    const processStart = 1_786_000_000;
    const source: CollectedAgent = {
      id: "codex:retained-session",
      provider: "codex",
      sourceSessionId: "retained-session",
      displayName: "Retained session",
      status: "waiting",
      statusReason: "Fixture is waiting for a reply.",
      updatedAt: new Date().toISOString(),
      tokens: { provenance: "unknown" },
      artifacts: [],
      gates: [],
    };
    const surface: CmuxSurface = {
      workspaceId: "WORKSPACE-RETAINED",
      surfaceId: "SURFACE-RETAINED",
      paneId: "PANE-RETAINED",
      tty: "ttys042",
      sourceSessionIds: [source.sourceSessionId],
      identityTrace: {
        surfaceId: "SURFACE-RETAINED",
        tty: "ttys042",
        processes: [{
          pid: processId,
          command: `codex resume ${source.sourceSessionId}`,
          recognizedAgentProcess: true,
          startSeconds: processStart,
        }],
        openFileMatches: [{
          pid: processId,
          path: `/tmp/${source.sourceSessionId}.jsonl`,
          provider: "codex",
          sessionId: source.sourceSessionId,
        }],
        commandHints: [],
        outcome: "open-file-match",
        sourceSessionIds: [source.sourceSessionId],
      },
    };
    const notification: CmuxNotification = {
      id: "notification-retained",
      surfaceId: surface.surfaceId,
      createdAt: "2026-07-28T08:00:00.000Z",
      title: "Needs review",
    };
    let failCmux = false;
    let failIdentity = false;
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
      enrichIdentity: async (surfaces) => {
        if (failIdentity) throw new Error("identity probe timed out");
        return {
          value: [...surfaces],
          errors: [],
          liveAgentProcessIds: [processId],
          recognizedAgentProcessIds: [processId],
          processStarts: { [processId]: processStart },
          rosterComplete: true,
        };
      },
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    let recordCalls = 0;
    let releaseRecord!: () => void;
    let recordBlocked!: () => void;
    const blockedRecord = new Promise<void>((resolve) => { recordBlocked = resolve; });
    const recordRelease = new Promise<void>((resolve) => { releaseRecord = resolve; });
    const archived: string[] = [];
    const archiveStore: ArchiveStore = {
      has: () => false,
      archive: async (agentId) => { archived.push(agentId); },
      record: async () => {
        recordCalls += 1;
        if (recordCalls !== 2) return;
        recordBlocked();
        await recordRelease;
      },
    };
    const bindingStore = new MemoryIdentityBindingStore();
    const state = new HubState(runner, archiveStore, [], { collectors, bindingStore });

    const healthy = await state.refresh({ cmux: true });
    const lastSuccessfulCheck = state.get().controlHealth.lastCheckedAt;
    expect(bindingStore.get(source.sourceSessionId)).toMatchObject({
      target: { surfaceId: surface.surfaceId },
      processIds: [processId],
      processStarts: { [processId]: processStart },
    });
    expect(state.surfaces()).toEqual([surface]);
    expect(healthy.programs[0]?.agents[0]).toMatchObject({
      outcome: "needs-you",
      processState: "running",
      target: { surfaceId: surface.surfaceId, resolution: "exact" },
    });
    const recordingRunner = (commands: string[][]): CommandRunner => ({
      run: async (command) => {
        commands.push([...command]);
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
      },
    });
    const instruct = (commands: string[][]) => handleControlRequest(
      new Request("http://127.0.0.1:4701/api/control", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:4701", "content-type": "application/json" },
        body: JSON.stringify({ action: "instruct", agentId: source.id, instruction: "Report current state." }),
      }),
      { runner: recordingRunner(commands), archiveStore, getSnapshot: () => state.get() },
    );
    const focus = (commands: string[][]) => createAgentLinkFetch(
      () => new Response(null, { status: 404 }),
      {
        runner: recordingRunner(commands),
        archiveStore,
        getSnapshot: () => state.get(),
        surfaces: () => state.surfaces(),
      },
    )(new Request(`http://127.0.0.1:4701/agent/${encodeURIComponent(source.id)}/focus`));
    const broadcast = (commands: string[][]) => handleBroadcastRequest(
      new Request("http://127.0.0.1:4701/api/broadcast", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:4701", "content-type": "application/json" },
        body: JSON.stringify({ agentIds: [source.id], instruction: "Report current state." }),
      }),
      { runner: recordingRunner(commands), archiveStore, getSnapshot: () => state.get() },
    );
    const healthyControls = Object.fromEntries(
      healthy.programs[0]?.agents[0]?.controls.map(({ action, enabled }) => [action, enabled]) ?? [],
    );
    const publicationTimes: string[] = [];
    const unsubscribe = state.subscribe((snapshot) => { publicationTimes.push(snapshot.generatedAt); });

    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    failCmux = true;
    const failedRefresh = state.refresh({ cmux: true });
    await blockedRecord;

    const barrierSnapshot = state.get();
    const barrierAgent = barrierSnapshot.programs[0]?.agents[0];
    const barrierControls = Object.fromEntries(
      barrierAgent?.controls.map(({ action, enabled }) => [action, enabled]) ?? [],
    );
    const barrierControlCommands: string[][] = [];
    const barrierBroadcastCommands: string[][] = [];
    const barrierFocusCommands: string[][] = [];
    const barrierControlResponse = await instruct(barrierControlCommands);
    const barrierBroadcastResponse = await broadcast(barrierBroadcastCommands);
    const barrierFocusResponse = await focus(barrierFocusCommands);
    const archiveResponse = await handleControlRequest(
      new Request("http://127.0.0.1:4701/api/control", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:4701", "content-type": "application/json" },
        body: JSON.stringify({ action: "archive", agentId: source.id }),
      }),
      { runner, archiveStore, getSnapshot: () => state.get() },
    );
    const publicationTimesAtBarrier = [...publicationTimes];
    unsubscribe();
    releaseRecord();

    const failed = await failedRefresh;
    const failedAgent = failed.programs[0]?.agents[0];

    expect({
      controlStatus: barrierControlResponse.status,
      broadcastStatus: barrierBroadcastResponse.status,
      focusStatus: barrierFocusResponse.status,
      terminalCommands: [
        ...barrierControlCommands,
        ...barrierBroadcastCommands,
        ...barrierFocusCommands,
      ],
    }).toEqual({
      controlStatus: 409,
      broadcastStatus: 409,
      focusStatus: 409,
      terminalCommands: [],
    });
    expect(barrierControls).toMatchObject({
      focus: false,
      instruct: false,
      interrupt: false,
      archive: true,
    });
    expect({ archive: barrierControls.archive, unarchive: barrierControls.unarchive }).toEqual({
      archive: healthyControls.archive,
      unarchive: healthyControls.unarchive,
    });
    expect(barrierAgent?.target).toMatchObject({ resolution: "missing" });
    expect(barrierAgent?.target.surfaceId).toBeUndefined();
    expect(barrierSnapshot.generatedAt).toBe(healthy.generatedAt);
    expect(barrierSnapshot.controlHealth.cmuxReachable).toBe(false);
    expect(publicationTimesAtBarrier).toEqual([healthy.generatedAt]);
    expect(archiveResponse.status).toBe(200);
    expect(archived).toEqual([source.id]);

    // A failed current scan cannot re-mint liveness from the previous PID roster.
    expect(failedAgent?.processState).toBe("unknown");
    expect(failedAgent).toMatchObject({
      target: { resolution: "missing" },
    });
    expect(failedAgent?.target.surfaceId).toBeUndefined();
    expect(failedAgent?.target.attestation).toBeUndefined();
    expect(Object.fromEntries(
      failedAgent?.controls
        .filter(({ action }) => action === "focus" || action === "instruct" || action === "interrupt")
        .map(({ action, enabled }) => [action, enabled]) ?? [],
    )).toEqual({ focus: false, instruct: false, interrupt: false });
    expect(state.surfaces()).toEqual([
      expect.objectContaining({
        surfaceId: surface.surfaceId,
        runtimeSurfaceReady: false,
        sourceSessionIds: [],
        sourceSessionClaims: [],
        identityTrace: expect.objectContaining({
          outcome: "stale-surface",
          processes: [],
          openFileMatches: [],
          commandHints: [],
          sourceSessionIds: [],
        }),
      }),
    ]);
    expect(state.get().controlHealth).toMatchObject({
      cmuxReachable: false,
      lastCheckedAt: lastSuccessfulCheck,
      errors: [
        "cmux terminal discovery timed out",
        "cmux notification discovery timed out",
      ],
    });
    const controlCommands: string[][] = [];
    const controlResponse = await instruct(controlCommands);
    expect(controlResponse.status).toBe(409);
    expect(await controlResponse.json()).toMatchObject({ error: { code: "CONTROL_DISABLED" } });
    expect(controlCommands).toEqual([]);

    const focusCommands: string[][] = [];
    const focusResponse = await focus(focusCommands);
    expect(focusResponse.status).toBe(409);
    expect(await focusResponse.json()).toMatchObject({ error: { code: "CONTROL_DISABLED" } });
    expect(focusCommands).toEqual([]);

    const broadcastCommands: string[][] = [];
    const broadcastResponse = await broadcast(broadcastCommands);
    expect(broadcastResponse.status).toBe(409);
    expect(await broadcastResponse.json()).toMatchObject({ ok: false, sent: 0, failed: 1 });
    expect(broadcastCommands).toEqual([]);

    failCmux = false;
    const recovered = await state.refresh({ cmux: true });
    expect(state.surfaces()).toEqual([surface]);
    expect(recovered.controlHealth.cmuxReachable).toBe(true);
    const recoveredAgent = recovered.programs[0]?.agents[0];
    expect({
      processState: recoveredAgent?.processState,
      resolution: recoveredAgent?.target.resolution,
      surfaceId: recoveredAgent?.target.surfaceId,
      attestation: recoveredAgent?.target.attestation,
    }).toEqual({
      processState: "running",
      resolution: "exact",
      surfaceId: surface.surfaceId,
      attestation: "live",
    });
    expect(Object.fromEntries(
      recoveredAgent?.controls.map(({ action, enabled }) => [action, enabled]) ?? [],
    )).toMatchObject({
      focus: true,
      instruct: true,
      interrupt: true,
    });

    const lastBindingConfirmation = bindingStore.get(source.sourceSessionId)?.confirmedAt;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    failIdentity = true;
    const identityFailed = await state.refresh({ cmux: true });
    const identityFailedAgent = identityFailed.programs[0]?.agents[0];

    expect(identityFailedAgent).toMatchObject({
      processState: "unknown",
      target: { resolution: "missing" },
    });
    expect(Object.fromEntries(
      identityFailedAgent?.controls
        .filter(({ action }) => action === "focus" || action === "instruct" || action === "interrupt")
        .map(({ action, enabled }) => [action, enabled]) ?? [],
    )).toEqual({ focus: false, instruct: false, interrupt: false });
    expect(state.surfaces()).toEqual([
      expect.objectContaining({
        surfaceId: surface.surfaceId,
        runtimeSurfaceReady: false,
        sourceSessionIds: [],
        sourceSessionClaims: [],
        identityTrace: expect.objectContaining({ outcome: "stale-surface" }),
      }),
    ]);
    expect(identityFailed.controlHealth).toMatchObject({
      cmuxReachable: true,
      errors: ["cmux identity enrichment failed: identity probe timed out"],
    });
    expect(bindingStore.get(source.sourceSessionId)?.confirmedAt).toBe(lastBindingConfirmation);

    failIdentity = false;
    const identityRecovered = await state.refresh({ cmux: true });
    expect(identityRecovered.programs[0]?.agents[0]).toMatchObject({
      processState: "running",
      target: { surfaceId: surface.surfaceId, resolution: "exact", attestation: "live" },
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
        prime: { value: [], errors: [] },
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
