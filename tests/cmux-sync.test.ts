import { describe, expect, spyOn, test } from "bun:test";
import { MemoryArchiveStore } from "../src/server/archive";
import { recordIssuedAction, resetCmuxActionsMemory } from "../src/server/cmux-actions";
import {
  CmuxSyncSupervisor,
  dispatchCmuxSyncEvent,
  parseCmuxSyncLine,
  registerSyncHandler,
  syncStreamHealthy,
  type CmuxSyncChild,
  type CmuxSyncCursorStore,
  type ScheduleCmuxSyncRestart,
} from "../src/server/cmux-sync";
import { HubState, type HubCollectors } from "../src/server/state";
import type { CmuxSurface, CollectedAgent, CommandRunner } from "../src/server/types";

const encoder = new TextEncoder();

function controlledChild(): {
  child: CmuxSyncChild;
  write(text: string): void;
  finish(exitCode: number): void;
  signals: string[];
} {
  let stdout!: ReadableStreamDefaultController<Uint8Array>;
  let resolveExit!: (exitCode: number) => void;
  let finished = false;
  const exited = new Promise<number>((resolve) => { resolveExit = resolve; });
  const signals: string[] = [];
  const finish = (exitCode: number): void => {
    if (finished) return;
    finished = true;
    stdout.close();
    resolveExit(exitCode);
  };
  return {
    child: {
      stdout: new ReadableStream({ start(controller) { stdout = controller; } }),
      stderr: new ReadableStream({ start(controller) { controller.close(); } }),
      exited,
      kill: (signal) => {
        signals.push(signal);
        finish(143);
      },
    },
    write: (text) => stdout.enqueue(encoder.encode(text)),
    finish,
    signals,
  };
}

class MemoryCursorStore implements CmuxSyncCursorStore {
  value?: number;

  constructor(value?: number) {
    this.value = value;
  }

  async load(): Promise<number | undefined> {
    return this.value;
  }

  async save(value: number): Promise<void> {
    this.value = value;
  }
}

async function eventually(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let turn = 0; turn < 200; turn += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await Promise.resolve();
    }
  }
  throw lastError;
}

function ack(gap: boolean, latestSeq: number): string {
  return `${JSON.stringify({
    type: "ack",
    resume: {
      after_seq: gap ? 0 : null,
      gap,
      latest_seq: latestSeq,
      next_seq: latestSeq + 1,
      oldest_seq: Math.max(0, latestSeq - 4_000),
      requested_after_seq: 0,
    },
  })}\n`;
}

function event(seq: number, name: string, payload: Record<string, unknown>): string {
  return `${JSON.stringify({ type: "event", seq, name, payload })}\n`;
}

describe("cmux typed sync stream", () => {
  test("parses every cursor field from the live nested ack resume shape", () => {
    expect(parseCmuxSyncLine(ack(true, 40).trim())).toEqual({
      type: "ack",
      resume: {
        afterSeq: 0,
        gap: true,
        latestSeq: 40,
        nextSeq: 41,
        oldestSeq: 0,
      },
    });
  });

  test("dispatches JSONL events once in seq order and a throwing handler cannot kill the stream", async () => {
    const process = controlledChild();
    const commands: string[][] = [];
    const seen: number[] = [];
    const errors: string[] = [];
    const unregister = registerSyncHandler("workspace.closed", ({ seq }) => {
      seen.push(seq);
      if (seq === 1) throw new Error("fixture handler failed");
    });
    const supervisor = new CmuxSyncSupervisor({
      executable: "/opt/cmux/bin/cmux",
      cursorStore: new MemoryCursorStore(),
      spawn: (command) => {
        commands.push([...command]);
        return process.child;
      },
      recollect: async () => {},
      onError: (error) => errors.push(error.message),
    });

    try {
      supervisor.start();
      await eventually(() => expect(commands).toEqual([[
        "/opt/cmux/bin/cmux", "events", "--after", "0",
      ]]));
      process.write(ack(false, 0));
      process.write(event(1, "workspace.closed", { workspace_id: "WS-A" }));
      process.write(event(1, "workspace.closed", { workspace_id: "WS-A" }));
      process.write(event(2, "workspace.closed", { workspace_id: "WS-B" }));

      await eventually(() => expect(seen).toEqual([1, 2]));
      expect(errors).toEqual([expect.stringContaining("fixture handler failed")]);
      expect(syncStreamHealthy()).toBe(true);
    } finally {
      unregister();
      supervisor.stop();
    }
  });

  test("filters this process's action echo before registered handlers see it", () => {
    let dispatched = 0;
    const unregister = registerSyncHandler("notification.mark_read_requested", () => {
      dispatched += 1;
    });
    resetCmuxActionsMemory();
    try {
      recordIssuedAction("notification.mark_read", { id: "NOTICE-1" });
      dispatchCmuxSyncEvent({
        seq: 1,
        name: "notification.mark_read_requested",
        payload: { params: { id: "NOTICE-1" } },
      });
      expect(dispatched).toBe(0);
    } finally {
      resetCmuxActionsMemory();
      unregister();
    }
  });

  test("a gap recollects once, drops replay patches, and resumes only after a fresh ack", async () => {
    const first = controlledChild();
    const second = controlledChild();
    const children = [first, second];
    const commands: string[][] = [];
    const scheduled: Array<() => void> = [];
    const seen: number[] = [];
    let recollects = 0;
    const unregister = registerSyncHandler("workspace.closed", ({ seq }) => { seen.push(seq); });
    const supervisor = new CmuxSyncSupervisor({
      executable: "cmux",
      cursorStore: new MemoryCursorStore(),
      spawn: (command) => {
        commands.push([...command]);
        const next = children[commands.length - 1];
        if (!next) throw new Error("unexpected extra spawn");
        return next.child;
      },
      scheduleRestart: (restart) => {
        scheduled.push(restart);
        return { cancel: () => {} };
      },
      recollect: async () => { recollects += 1; },
    });

    try {
      supervisor.start();
      await eventually(() => expect(commands).toHaveLength(1));
      first.write(ack(true, 40));
      first.write(event(12, "workspace.closed", { workspace_id: "REPLAYED" }));
      await eventually(() => expect(recollects).toBe(1));
      expect(seen).toEqual([]);
      expect(syncStreamHealthy()).toBe(false);
      await eventually(() => expect(scheduled).toHaveLength(1));

      scheduled.shift()?.();
      await eventually(() => expect(commands[1]).toEqual(["cmux", "events", "--after", "40"]));
      second.write(ack(false, 40));
      second.write(event(41, "workspace.closed", { workspace_id: "FRESH" }));
      await eventually(() => expect(seen).toEqual([41]));
      expect(recollects).toBe(1);
      expect(syncStreamHealthy()).toBe(true);
    } finally {
      unregister();
      supervisor.stop();
    }
  });

  test("an exit reconnects after the cursor and a second pre-recovery exit recollects", async () => {
    const first = controlledChild();
    const second = controlledChild();
    const third = controlledChild();
    const children = [first, second, third];
    const commands: string[][] = [];
    const scheduled: Array<() => void> = [];
    let recollects = 0;
    const scheduleRestart: ScheduleCmuxSyncRestart = (restart, delayMs) => {
      expect(delayMs).toBe(1_000);
      scheduled.push(restart);
      return { cancel: () => {} };
    };
    const supervisor = new CmuxSyncSupervisor({
      executable: "cmux",
      cursorStore: new MemoryCursorStore(6),
      spawn: (command) => {
        commands.push([...command]);
        const next = children[commands.length - 1];
        if (!next) throw new Error("unexpected extra spawn");
        return next.child;
      },
      scheduleRestart,
      recollect: async () => { recollects += 1; },
    });

    try {
      supervisor.start();
      await eventually(() => expect(commands[0]).toEqual(["cmux", "events", "--after", "6"]));
      first.write(ack(false, 6));
      first.write(event(7, "unhandled.event", {}));
      await eventually(() => expect(syncStreamHealthy()).toBe(true));

      first.finish(9);
      await eventually(() => expect(scheduled).toHaveLength(1));
      expect(syncStreamHealthy()).toBe(false);
      scheduled.shift()?.();
      await eventually(() => expect(commands[1]).toEqual(["cmux", "events", "--after", "7"]));

      second.finish(9);
      await eventually(() => expect(recollects).toBe(1));
      expect(syncStreamHealthy()).toBe(false);
      await eventually(() => expect(scheduled).toHaveLength(1));
      scheduled.shift()?.();
      await eventually(() => expect(commands[2]).toEqual(["cmux", "events", "--after", "7"]));
      third.write(ack(false, 7));
      await eventually(() => expect(syncStreamHealthy()).toBe(true));
      expect(recollects).toBe(1);
    } finally {
      supervisor.stop();
    }
  });
});

function collected(id: string): CollectedAgent {
  return {
    id: `codex:${id}`,
    provider: "codex",
    sourceSessionId: id,
    displayName: id,
    status: "running",
    statusReason: "Fixture is live.",
    updatedAt: "2026-08-13T08:00:00.000Z",
    processAlive: true,
    processIds: [101],
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
  };
}

function surface(surfaceId: string, workspaceId: string, sessionId: string): CmuxSurface {
  return {
    surfaceId,
    workspaceId,
    sourceSessionIds: [sessionId],
    sourceSessionClaims: [{ provider: "codex", sessionId }],
    runtimeSurfaceReady: true,
  };
}

async function livenessFixture() {
  const agents = [collected("agent-a1"), collected("agent-a2"), collected("agent-b1")];
  const surfaces = [
    surface("SURFACE-A1", "WORKSPACE-A", "agent-a1"),
    surface("SURFACE-A2", "WORKSPACE-A", "agent-a2"),
    surface("SURFACE-B1", "WORKSPACE-B", "agent-b1"),
  ];
  const empty = () => ({
    omp: { value: [], errors: [] },
    codex: { value: agents, errors: [] },
    claude: { value: [], errors: [] },
    cursor: { value: [], errors: [] },
    factory: { value: [], errors: [] },
    prime: { value: [], errors: [] },
    grok: { value: [], errors: [] },
    hermes: { value: [], errors: [] },
  });
  const collectors: HubCollectors = {
    sessions: async () => empty(),
    cmux: async () => ({ value: surfaces, errors: [] }),
    notifications: async () => ({ value: [], errors: [] }),
    enrichIdentity: async (value) => ({
      value: [...value],
      errors: [],
      liveAgentProcessIds: [101],
      recognizedAgentProcessIds: [101],
      rosterComplete: true,
    }),
  };
  const runner: CommandRunner = {
    run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
  };
  const state = new HubState(runner, new MemoryArchiveStore(), [], { collectors });
  await state.refresh({ cmux: true });
  const process = controlledChild();
  state.startCmuxSync({
    cursorStore: new MemoryCursorStore(),
    spawn: () => process.child,
    recollect: async () => { throw new Error("ordinary event must not poll"); },
  });
  process.write(ack(false, 0));
  await eventually(() => expect(syncStreamHealthy()).toBe(true));
  return { state, process };
}

function agentsById(state: HubState) {
  return new Map(state.get().programs.flatMap((program) => program.agents).map((agent) => [agent.id, agent]));
}

describe("cmux close events update HubState in the same dispatch", () => {
  test("workspace.closed ends every bound agent with reason cmux-closed without a poll", async () => {
    const { state, process } = await livenessFixture();
    const refresh = spyOn(state, "refresh");
    const unaffectedActivity = agentsById(state).get("codex:agent-b1")?.activity;
    try {
      process.write(event(1, "workspace.closed", { workspace_id: "WORKSPACE-A" }));
      await eventually(() => expect(agentsById(state).get("codex:agent-a1")?.activity).toBe("ended"));
      expect(agentsById(state).get("codex:agent-a2")).toMatchObject({
        activity: "ended", lifecycle: "finished", statusReason: "cmux-closed",
      });
      expect(agentsById(state).get("codex:agent-b1")?.activity).toBe(unaffectedActivity);
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      refresh.mockRestore();
      state.stopCmuxSync();
    }
  });

  test("surface.closed ends only its bound agent", async () => {
    const { state, process } = await livenessFixture();
    const siblingActivity = agentsById(state).get("codex:agent-a2")?.activity;
    const otherActivity = agentsById(state).get("codex:agent-b1")?.activity;
    try {
      process.write(event(1, "surface.closed", { surface_id: "SURFACE-A1" }));
      await eventually(() => expect(agentsById(state).get("codex:agent-a1")?.activity).toBe("ended"));
      expect(agentsById(state).get("codex:agent-a2")?.activity).toBe(siblingActivity);
      expect(agentsById(state).get("codex:agent-b1")?.activity).toBe(otherActivity);
    } finally {
      state.stopCmuxSync();
    }
  });

  test("workspace teardown surface events do not double-fire before workspace.closed", async () => {
    const { state, process } = await livenessFixture();
    let publications = 0;
    const unsubscribe = state.subscribe(() => { publications += 1; });
    try {
      process.write(event(1, "surface.closed", {
        surface_id: "SURFACE-A1",
        origin: "workspace_teardown",
      }));
      await eventually(() => expect(syncStreamHealthy()).toBe(true));
      expect(agentsById(state).get("codex:agent-a1")?.activity).not.toBe("ended");
      expect(publications).toBe(0);

      process.write(event(2, "workspace.closed", { workspace_id: "WORKSPACE-A" }));
      await eventually(() => expect(publications).toBe(1));
      expect(agentsById(state).get("codex:agent-a1")?.statusReason).toBe("cmux-closed");
      expect(agentsById(state).get("codex:agent-a2")?.statusReason).toBe("cmux-closed");
    } finally {
      unsubscribe();
      state.stopCmuxSync();
    }
  });
});
