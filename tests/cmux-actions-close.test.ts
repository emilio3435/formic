import { beforeEach, describe, expect, test } from "bun:test";
import {
  closeSurface,
  closeWorkspace,
  configureCmuxActions,
  isOwnEcho,
  resetCmuxActionsMemory,
} from "../src/server/cmux-actions";
import {
  createMountainFetch,
  type MountainAppState,
} from "../src/server/app";
import type { AgentSnapshot, HubSnapshot } from "../src/shared/types";
import type {
  ArchiveStore,
  CommandResult,
  CommandRunner,
} from "../src/server/types";

const ORIGIN = "http://127.0.0.1:4701";
const EXECUTABLE = "cmux-fixture";

function result(
  exitCode = 0,
  stdout = '{"result":{"closed":true}}',
  stderr = "",
  timedOut = false,
): CommandResult {
  return { exitCode, stdout, stderr, timedOut };
}

class MethodRunner implements CommandRunner {
  readonly commands: string[][] = [];

  constructor(private readonly replies: Record<string, CommandResult[]>) {}

  async run(command: readonly string[]): Promise<CommandResult> {
    this.commands.push([...command]);
    const method = command[2] ?? "";
    return this.replies[method]?.shift()
      ?? result(1, "", `unexpected cmux method ${method}`);
  }
}

beforeEach(() => {
  resetCmuxActionsMemory();
});

describe("SYNC-CB close action funnel", () => {
  test.each([
    {
      close: () => closeSurface("SURFACE-1", "board close"),
      method: "surface.close",
      params: { surface_id: "SURFACE-1" },
      event: "surface.closed",
    },
    {
      close: () => closeWorkspace("WORKSPACE-1", "confirmed board close"),
      method: "workspace.close",
      params: { workspace_id: "WORKSPACE-1" },
      event: "workspace.closed",
    },
  ])("$method records a fingerprint only after a clean RPC", async ({ close, method, params, event }) => {
    const runner = new MethodRunner({ [method]: [result()] });
    configureCmuxActions({ runner, executable: EXECUTABLE, log: () => {} });

    expect(await close()).toEqual({ ok: true });
    expect(runner.commands).toEqual([[
      EXECUTABLE,
      "rpc",
      method,
      JSON.stringify(params),
    ]]);
    expect(isOwnEcho({
      name: event,
      payload: { method, params },
    })).toBe(true);
  });

  test.each([
    ["non-zero", result(17, "", "permission_denied: surface is protected")],
    ["stderr with exit zero", result(0, "", "not_found: surface is gone")],
  ])("%s is a typed failure and records no echo fingerprint", async (_label, failure) => {
    const runner = new MethodRunner({ "surface.close": [failure] });
    configureCmuxActions({ runner, executable: EXECUTABLE, log: () => {} });

    expect(await closeSurface("SURFACE-FAIL", "board close")).toMatchObject({
      ok: false,
      code: expect.any(String),
      detail: expect.any(String),
    });
    expect(isOwnEcho({
      name: "surface.closed",
      payload: {
        method: "surface.close",
        params: { surface_id: "SURFACE-FAIL" },
      },
    })).toBe(false);
  });

  test("last-surface invalid_state is returned, not thrown or retried", async () => {
    const runner = new MethodRunner({
      "surface.close": [result(1, "", "invalid_state: Cannot close the last surface")],
    });
    configureCmuxActions({ runner, executable: EXECUTABLE, log: () => {} });

    expect(await closeSurface("SURFACE-LAST", "board close")).toEqual({
      ok: false,
      code: "invalid_state",
      detail: "Cannot close the last surface",
    });
    expect(runner.commands).toHaveLength(1);
  });

  test("an exit-zero RPC error body is still a typed refusal", async () => {
    const runner = new MethodRunner({
      "surface.close": [result(0, JSON.stringify({
        error: { code: "invalid_state", message: "Cannot close the last surface" },
      }))],
    });
    configureCmuxActions({ runner, executable: EXECUTABLE, log: () => {} });

    expect(await closeSurface("SURFACE-LAST", "board close")).toEqual({
      ok: false,
      code: "invalid_state",
      detail: "Cannot close the last surface",
    });
    expect(isOwnEcho({
      name: "surface.close_requested",
      payload: { params: { surface_id: "SURFACE-LAST" } },
    })).toBe(false);
  });
});

function agent(
  id: string,
  name: string,
  surfaceId: string,
  workspaceId: string,
  activity: AgentSnapshot["activity"] = "working",
): AgentSnapshot {
  return {
    id,
    provider: "codex",
    sourceSessionId: id.slice(id.indexOf(":") + 1),
    displayName: name,
    identity: { name, base: name, source: "authored", authoredBy: "codex-nickname" },
    programId: "sync-close",
    status: activity === "ended" ? "archived" : "running",
    statusReason: "Close-route fixture.",
    activity,
    lifecycle: activity === "ended" ? "finished" : "working",
    lastHumanMessage: null,
    updatedAt: "2026-08-13T09:00:00.000Z",
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    target: {
      resolution: "exact",
      attestation: "live",
      surfaceId,
      workspaceId,
    },
    controls: [],
  };
}

function closeSnapshot(): HubSnapshot {
  const agents = [
    agent("codex:ada", "Ada", "SURFACE-CURRENT", "WORKSPACE-A"),
    agent("codex:babbage", "Babbage", "SURFACE-SIBLING", "WORKSPACE-A"),
    agent("codex:curie", "Curie", "SURFACE-ENDED", "WORKSPACE-A", "ended"),
    agent("codex:dijkstra", "Dijkstra", "SURFACE-OTHER", "WORKSPACE-B"),
  ];
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-13T09:00:00.000Z",
    controlHealth: {
      cmuxReachable: true,
      lastCheckedAt: "2026-08-13T09:00:00.000Z",
      errors: [],
      staleSources: [],
    },
    totals: { live: 3, tracked: 4, attention: 0 },
    programs: [{ id: "sync-close", name: "SYNC close", agents }],
  };
}

function server(runner: CommandRunner, snapshot = closeSnapshot()) {
  const state: MountainAppState = {
    get: () => snapshot,
    subscribe: () => () => {},
    refresh: async () => snapshot,
  };
  const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
  return createMountainFetch({
    state,
    runner,
    archiveStore,
    cmuxExecutable: EXECUTABLE,
    webRoot: import.meta.dir,
  });
}

function closeRequest(
  body: Record<string, unknown>,
  origin = ORIGIN,
): Request {
  return new Request(`${ORIGIN}/api/sync/close`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function windowList(...windowIds: string[]): CommandResult {
  return result(0, JSON.stringify({ result: { windows: windowIds.map((id) => ({ id })) } }));
}

function groupList(...anchorWorkspaceIds: string[]): CommandResult {
  return result(0, JSON.stringify({
    result: {
      groups: anchorWorkspaceIds.map((anchor_workspace_id, index) => ({
        id: `GROUP-${index + 1}`,
        anchor_workspace_id,
      })),
    },
  }));
}

describe("POST /api/sync/close", () => {
  test("rejects a foreign Origin before any cmux call", async () => {
    const runner = new MethodRunner({});
    const fetch = server(runner);
    try {
      const response = await fetch(closeRequest(
        { target: "surface", id: "SURFACE-CURRENT" },
        "http://evil.example",
      ));

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: { code: "ORIGIN_REJECTED" },
      });
      expect(runner.commands).toEqual([]);
    } finally {
      fetch.dispose();
    }
  });

  test("invalid_state names every other live agent in the target workspace", async () => {
    const runner = new MethodRunner({
      "surface.close": [result(1, "", "invalid_state: Cannot close the last surface")],
    });
    const fetch = server(runner);
    try {
      const response = await fetch(closeRequest({
        target: "surface",
        id: "SURFACE-CURRENT",
      }));

      expect(await response.json()).toEqual({
        ok: false,
        code: "invalid_state",
        detail: "Cannot close the last surface",
        escalation: {
          workspaceId: "WORKSPACE-A",
          siblingAgents: [{ id: "codex:babbage", name: "Babbage" }],
        },
      });
      expect(runner.commands.filter((command) => command[2] === "surface.close")).toHaveLength(1);
    } finally {
      fetch.dispose();
    }
  });

  test("a group-anchor workspace is refused before workspace.close", async () => {
    const runner = new MethodRunner({
      "window.list": [windowList("WINDOW-1", "WINDOW-2")],
      "workspace.group.list": [groupList(), groupList("WORKSPACE-ANCHOR")],
    });
    const fetch = server(runner);
    try {
      const response = await fetch(closeRequest({
        target: "workspace",
        id: "WORKSPACE-ANCHOR",
        confirm: true,
      }));

      expect(await response.json()).toMatchObject({ ok: false, code: "anchor" });
      expect(runner.commands).toEqual([
        [EXECUTABLE, "rpc", "window.list", "{}"],
        [
          EXECUTABLE,
          "rpc",
          "workspace.group.list",
          JSON.stringify({ window_id: "WINDOW-1" }),
        ],
        [
          EXECUTABLE,
          "rpc",
          "workspace.group.list",
          JSON.stringify({ window_id: "WINDOW-2" }),
        ],
      ]);
      expect(runner.commands.some((command) => command[2] === "workspace.close")).toBe(false);
    } finally {
      fetch.dispose();
    }
  });

  test("workspace close requires server-side confirmation and returns impact data", async () => {
    const runner = new MethodRunner({
      "window.list": [windowList("WINDOW-1")],
      "workspace.group.list": [groupList()],
    });
    const fetch = server(runner);
    try {
      const response = await fetch(closeRequest({
        target: "workspace",
        id: "WORKSPACE-A",
      }));

      expect(await response.json()).toEqual({
        ok: false,
        code: "confirm_required",
        escalation: {
          workspaceId: "WORKSPACE-A",
          siblingAgents: [
            { id: "codex:ada", name: "Ada" },
            { id: "codex:babbage", name: "Babbage" },
          ],
        },
      });
      expect(runner.commands.some((command) => command[2] === "workspace.close")).toBe(false);
    } finally {
      fetch.dispose();
    }
  });

  test("confirmed non-anchor workspace close reaches the funnel once", async () => {
    const runner = new MethodRunner({
      "window.list": [windowList("WINDOW-1")],
      "workspace.group.list": [groupList()],
      "workspace.close": [result()],
    });
    const fetch = server(runner);
    try {
      const response = await fetch(closeRequest({
        target: "workspace",
        id: "WORKSPACE-A",
        confirm: true,
      }));

      expect(await response.json()).toEqual({ ok: true });
      expect(runner.commands.filter((command) => command[2] === "workspace.close")).toEqual([[
        EXECUTABLE,
        "rpc",
        "workspace.close",
        JSON.stringify({ workspace_id: "WORKSPACE-A" }),
      ]]);
    } finally {
      fetch.dispose();
    }
  });
});
