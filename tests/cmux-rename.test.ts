import { beforeEach, describe, expect, test } from "bun:test";
import { MemoryArchiveStore } from "../src/server/archive";
import {
  configureCmuxActions,
  isOwnEcho,
  renameWorkspace,
  resolveWorkspaceFromCmux,
  resetCmuxActionsMemory,
} from "../src/server/cmux-actions";
import { dispatchCmuxSyncEvent, type CmuxSyncChild } from "../src/server/cmux-sync";
import { createMountainFetch, type MountainAppState } from "../src/server/app";
import { HubState, type HubCollectors } from "../src/server/state";
import type { AgentSnapshot, HubSnapshot } from "../src/shared/types";
import type {
  CmuxSurface,
  CollectedAgent,
  CommandResult,
  CommandRunner,
} from "../src/server/types";

const CLEAN: CommandResult = {
  exitCode: 0,
  stdout: JSON.stringify({ result: { workspace: { id: "WORKSPACE-1", title: "New title" } } }),
  stderr: "",
  timedOut: false,
};

function recordingRunner(result: CommandResult = CLEAN): {
  runner: CommandRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  return {
    calls,
    runner: {
      run: async (command) => {
        calls.push([...command]);
        return result;
      },
    },
  };
}

beforeEach(() => {
  resetCmuxActionsMemory();
  configureCmuxActions({
    executable: "/fake/cmux",
    log: () => {},
    resolveWorkspace: async () => ({ title: "Old title", anchor: false }),
  });
});

describe("renameWorkspace — explicit writes only", () => {
  test("trims the title, issues workspace.rename with exact params, and records its echo", async () => {
    const { runner, calls } = recordingRunner();
    configureCmuxActions({ runner });

    await expect(renameWorkspace("WORKSPACE-1", "  New title  ", "board rename"))
      .resolves.toEqual({ ok: true });
    expect(calls).toEqual([[
      "/fake/cmux",
      "rpc",
      "workspace.rename",
      JSON.stringify({ workspace_id: "WORKSPACE-1", title: "New title" }),
    ]]);
    expect(isOwnEcho({
      name: "workspace.renamed",
      payload: {
        method: "workspace.rename",
        params: { workspace_id: "WORKSPACE-1", title: "New title" },
      },
    })).toBe(true);
  });

  test("rejects an empty title before any cmux call", async () => {
    const { runner, calls } = recordingRunner();
    configureCmuxActions({ runner });

    await expect(renameWorkspace("WORKSPACE-1", " \n\t ", "board rename"))
      .resolves.toEqual({ ok: false, code: "invalid_title" });
    expect(calls).toEqual([]);
  });

  test("a trim-identical title is a successful no-op with no cmux call", async () => {
    const { runner, calls } = recordingRunner();
    configureCmuxActions({ runner });

    await expect(renameWorkspace("WORKSPACE-1", "  Old title  ", "board rename"))
      .resolves.toEqual({ ok: true });
    expect(calls).toEqual([]);
  });

  test("a group-anchor workspace is refused before any mutation", async () => {
    const { runner, calls } = recordingRunner();
    configureCmuxActions({
      runner,
      resolveWorkspace: async () => ({ title: "Group header", anchor: true }),
    });

    await expect(renameWorkspace("WORKSPACE-ANCHOR", "Changed", "board rename"))
      .resolves.toEqual({ ok: false, code: "anchor" });
    expect(calls).toEqual([]);
  });

  test("the production anchor check enumerates windows and reads each window's group list", async () => {
    const calls: string[][] = [];
    const runner: CommandRunner = {
      run: async (command) => {
        calls.push([...command]);
        const method = command[2];
        const params = command[3];
        const windowId = params ? (JSON.parse(params) as { window_id?: string }).window_id : undefined;
        const stdout = method === "window.list"
          ? JSON.stringify({ windows: [{ id: "WINDOW-1" }, { id: "WINDOW-2" }] })
          : method === "workspace.group.list" && windowId === "WINDOW-2"
            ? JSON.stringify({ groups: [{ anchor_workspace_id: "WORKSPACE-ANCHOR" }] })
            : method === "workspace.group.list"
              ? JSON.stringify({ groups: [] })
              : JSON.stringify({ workspaces: [{ id: `REGULAR-${windowId}` }] });
        return { ...CLEAN, stdout };
      },
    };
    configureCmuxActions({ runner, resolveWorkspace: resolveWorkspaceFromCmux });

    await expect(renameWorkspace("WORKSPACE-ANCHOR", "Changed", "board rename"))
      .resolves.toEqual({ ok: false, code: "anchor" });
    expect(calls).toEqual([
      ["/fake/cmux", "rpc", "window.list", "{}"],
      ["/fake/cmux", "rpc", "workspace.list", JSON.stringify({ window_id: "WINDOW-1" })],
      ["/fake/cmux", "rpc", "workspace.group.list", JSON.stringify({ window_id: "WINDOW-1" })],
      ["/fake/cmux", "rpc", "workspace.list", JSON.stringify({ window_id: "WINDOW-2" })],
      ["/fake/cmux", "rpc", "workspace.group.list", JSON.stringify({ window_id: "WINDOW-2" })],
    ]);
    expect(calls.some((command) => command[2] === "workspace.rename")).toBe(false);
  });

  test("cmux refusal is typed and never records a fingerprint", async () => {
    const { runner } = recordingRunner({
      exitCode: 0,
      stdout: "",
      stderr: "Error: invalid_state: workspace cannot be renamed",
      timedOut: false,
    });
    configureCmuxActions({ runner });

    const result = await renameWorkspace("WORKSPACE-1", "New title", "board rename");
    expect(result).toEqual({
      ok: false,
      code: "invalid_state",
      detail: "workspace cannot be renamed",
    });
    expect(isOwnEcho({
      name: "workspace.renamed",
      payload: {
        method: "workspace.rename",
        params: { workspace_id: "WORKSPACE-1", title: "New title" },
      },
    })).toBe(false);
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

function surface(surfaceId: string, sessionId: string, title = "Old title"): CmuxSurface {
  return {
    surfaceId,
    workspaceId: "WORKSPACE-1",
    workspaceTitle: title,
    sourceSessionIds: [sessionId],
    sourceSessionClaims: [{ provider: "codex", sessionId }],
    runtimeSurfaceReady: true,
  };
}

function controlledChild(): CmuxSyncChild {
  let stdout!: ReadableStreamDefaultController<Uint8Array>;
  let finish!: (code: number) => void;
  const exited = new Promise<number>((resolve) => { finish = resolve; });
  return {
    stdout: new ReadableStream({ start(controller) { stdout = controller; } }),
    stderr: new ReadableStream({ start(controller) { controller.close(); } }),
    exited,
    kill: () => {
      stdout.close();
      finish(143);
    },
  };
}

async function renameState(): Promise<HubState> {
  const agents = [collected("agent-1"), collected("agent-2")];
  const surfaces = [surface("SURFACE-1", "agent-1"), surface("SURFACE-2", "agent-2")];
  const sessions = () => ({
    omp: { value: [], errors: [] },
    codex: { value: agents, errors: [] },
    claude: { value: [], errors: [] },
    cursor: { value: [], errors: [] },
    factory: { value: [], errors: [] },
    prime: { value: [], errors: [] },
    grok: { value: [], errors: [] },
    hermes: { value: [], errors: [] },
    muse: { value: [], errors: [] },
    antigravity: { value: [], errors: [] },
    copilot: { value: [], errors: [] },
    gemini: { value: [], errors: [] },
    opencode: { value: [], errors: [] },
    pi: { value: [], errors: [] },
  });
  const collectors: HubCollectors = {
    sessions: async () => sessions(),
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
  const runner: CommandRunner = { run: async () => CLEAN };
  const state = new HubState(runner, new MemoryArchiveStore(), [], { collectors });
  await state.refresh({ cmux: true });
  const child = controlledChild();
  state.startCmuxSync({
    cursorStore: { load: async () => 0, save: async () => {} },
    spawn: () => child,
    recollect: async () => { throw new Error("rename events must patch without polling"); },
  });
  return state;
}

function workspaceTitles(state: HubState): string[] {
  return state.get().programs
    .flatMap((program) => program.agents)
    .map((agent) => agent.target.workspaceTitle ?? "");
}

function renamed(title: string, seq = 1) {
  return {
    seq,
    name: "workspace.renamed",
    payload: {
      method: "workspace.rename",
      params: { workspace_id: "WORKSPACE-1", title },
    },
  } as const;
}

describe("workspace.renamed — cmux truth wins in the same dispatch", () => {
  test("a foreign event patches every bound agent without a poll", async () => {
    const state = await renameState();
    try {
      dispatchCmuxSyncEvent(renamed("Foreign title"));
      expect(workspaceTitles(state)).toEqual(["Foreign title", "Foreign title"]);
    } finally {
      state.stopCmuxSync();
    }
  });

  test("this process's echo still patches state and never issues a second write", async () => {
    const state = await renameState();
    const { runner, calls } = recordingRunner();
    configureCmuxActions({ runner });
    try {
      expect(await renameWorkspace("WORKSPACE-1", "Our title", "board rename"))
        .toEqual({ ok: true });
      dispatchCmuxSyncEvent(renamed("Our title"));

      expect(workspaceTitles(state)).toEqual(["Our title", "Our title"]);
      expect(calls).toHaveLength(1);
    } finally {
      state.stopCmuxSync();
    }
  });

  test("ours then a rapid foreign rename converges to the foreign title with one write total", async () => {
    const state = await renameState();
    const { runner, calls } = recordingRunner();
    configureCmuxActions({ runner });
    try {
      expect(await renameWorkspace("WORKSPACE-1", "Our title", "board rename"))
        .toEqual({ ok: true });
      dispatchCmuxSyncEvent(renamed("Our title", 1));
      dispatchCmuxSyncEvent(renamed("Human wins", 2));

      expect(workspaceTitles(state)).toEqual(["Human wins", "Human wins"]);
      expect(calls).toHaveLength(1);
    } finally {
      state.stopCmuxSync();
    }
  });
});

function routeState(snapshot: HubSnapshot): MountainAppState {
  return {
    get: () => snapshot,
    subscribe: () => () => {},
    refresh: async () => snapshot,
    surfaces: () => [],
  };
}

function routeSnapshot(): HubSnapshot {
  const agent: AgentSnapshot = {
    id: "codex:rename",
    programId: "fixture",
    provider: "codex",
    sourceSessionId: "rename",
    displayName: "Rename fixture",
    status: "running",
    statusReason: "Fixture is live.",
    lastHumanMessage: null,
    updatedAt: "2026-08-13T08:00:00.000Z",
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    target: {
      resolution: "exact",
      workspaceId: "WORKSPACE-1",
      workspaceTitle: "Old title",
      surfaceId: "SURFACE-1",
    },
    controls: [],
  };
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-13T08:00:00.000Z",
    controlHealth: {
      cmuxReachable: true,
      lastCheckedAt: "2026-08-13T08:00:00.000Z",
      errors: [],
      staleSources: [],
    },
    totals: { live: 1, tracked: 1, attention: 0 },
    programs: [{ id: "fixture", name: "Fixture", agents: [agent] }],
  };
}

function renameRequest(
  body: Record<string, unknown>,
  origin = "http://127.0.0.1:4701",
): Request {
  return new Request("http://127.0.0.1:4701/api/sync/rename", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/sync/rename", () => {
  test("rejects cross-origin before issuing a cmux call", async () => {
    const { runner, calls } = recordingRunner();
    configureCmuxActions({ runner });
    const fetch = createMountainFetch({
      state: routeState(routeSnapshot()),
      runner,
      archiveStore: new MemoryArchiveStore(),
      webRoot: import.meta.dir,
    });
    try {
      const response = await fetch(renameRequest(
        { workspaceId: "WORKSPACE-1", title: "New title" },
        "http://evil.example",
      ));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ ok: false, error: { code: "ORIGIN_REJECTED" } });
      expect(calls).toEqual([]);
    } finally {
      fetch.dispose();
    }
  });

  test("returns 404 for an unknown workspace and never calls workspace.rename", async () => {
    const { runner, calls } = recordingRunner();
    configureCmuxActions({ runner, resolveWorkspace: async () => undefined });
    const fetch = createMountainFetch({
      state: routeState(routeSnapshot()),
      runner,
      archiveStore: new MemoryArchiveStore(),
      webRoot: import.meta.dir,
    });
    try {
      const response = await fetch(renameRequest({ workspaceId: "MISSING", title: "New title" }));
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ ok: false, code: "not_found" });
      expect(calls).toEqual([]);
    } finally {
      fetch.dispose();
    }
  });

  test("returns anchor for a group header and issues no cmux mutation", async () => {
    const { runner, calls } = recordingRunner();
    configureCmuxActions({
      runner,
      resolveWorkspace: async () => ({ title: "Group header", anchor: true }),
    });
    const fetch = createMountainFetch({
      state: routeState(routeSnapshot()),
      runner,
      archiveStore: new MemoryArchiveStore(),
      webRoot: import.meta.dir,
    });
    try {
      const response = await fetch(renameRequest({ workspaceId: "WORKSPACE-ANCHOR", title: "Changed" }));
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ ok: false, code: "anchor" });
      expect(calls).toEqual([]);
    } finally {
      fetch.dispose();
    }
  });

  test("returns the funnel result for a valid same-origin rename", async () => {
    const { runner, calls } = recordingRunner();
    configureCmuxActions({ runner });
    const fetch = createMountainFetch({
      state: routeState(routeSnapshot()),
      runner,
      archiveStore: new MemoryArchiveStore(),
      webRoot: import.meta.dir,
    });
    try {
      const response = await fetch(renameRequest({ workspaceId: "WORKSPACE-1", title: "New title" }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(calls).toHaveLength(1);
    } finally {
      fetch.dispose();
    }
  });
});
