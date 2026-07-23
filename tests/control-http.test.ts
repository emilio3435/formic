import { describe, expect, test } from "bun:test";
import { executeControl } from "../src/server/control";
import {
  handleControlRequest,
  MAX_CONTROL_BODY_BYTES,
} from "../src/server/http";
import type {
  AgentSnapshot,
  ControlAction,
  HubSnapshot,
  TargetResolution,
} from "../src/shared/types";
import type {
  ArchiveStore,
  CommandResult,
  CommandRunner,
} from "../src/server/types";

class StubRunner implements CommandRunner {
  readonly commands: readonly string[][] = [];

  constructor(private readonly results: CommandResult[]) {}

  async run(command: readonly string[]): Promise<CommandResult> {
    (this.commands as string[][]).push([...command]);
    return (
      this.results.shift() ?? {
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
      }
    );
  }
}

function archiveStore(): ArchiveStore & { archived: string[] } {
  const archived: string[] = [];
  return {
    archived,
    has: (id) => archived.includes(id),
    archive: async (id) => {
      archived.push(id);
    },
  };
}

function agent(
  resolution: TargetResolution = "exact",
  enabledActions: readonly ControlAction[] = ["focus", "instruct", "interrupt", "archive"],
): AgentSnapshot {
  return {
    id: "codex:test-session",
    provider: "codex",
    sourceSessionId: "test-session",
    displayName: "Control test",
    programId: "test-program",
    status: "running",
    statusReason: "Fixture activity is recent.",
    lastHumanMessage: null,
    updatedAt: "2026-07-21T23:00:00.000Z",
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    target: {
      workspaceId: resolution === "exact" ? "WORKSPACE-EXACT" : undefined,
      surfaceId: resolution === "exact" ? "SURFACE-EXACT" : undefined,
      paneId: resolution === "exact" ? "PANE-EXACT" : undefined,
      resolution,
      reason: resolution === "exact" ? "Matched exact IDs." : `${resolution} target; controls are disabled.`,
    },
    controls: (["focus", "instruct", "interrupt", "archive"] as const).map((action) => ({
      action,
      enabled: enabledActions.includes(action),
      reason: enabledActions.includes(action) ? undefined : "No safe target.",
    })),
  };
}

function snapshot(value = agent()): HubSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-21T23:00:00.000Z",
    controlHealth: {
      cmuxReachable: true,
      lastCheckedAt: "2026-07-21T23:00:00.000Z",
      errors: [],
      staleSources: [],
    },
    totals: { live: 1, tracked: 1, attention: 0 },
    programs: [{ id: "test-program", name: "Test program", agents: [value] }],
  };
}

function post(body: string, origin = "http://127.0.0.1:4701"): Request {
  return new Request("http://127.0.0.1:4701/api/control", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body,
  });
}

describe("fail-loud control execution", () => {
  test("a non-zero cmux exit with stdout and stderr is never reported as success", async () => {
    const runner = new StubRunner([
      {
        exitCode: 17,
        stdout: "queued",
        stderr: "surface is no longer available",
        timedOut: false,
      },
    ]);
    const execution = await executeControl(
      { action: "focus", agentId: "codex:test-session" },
      agent(),
      { runner, archiveStore: archiveStore(), cmuxExecutable: "cmux" },
    );

    expect(execution.status).toBe(502);
    expect(execution.response).toMatchObject({
      ok: false,
      error: {
        code: "CMUX_COMMAND_FAILED",
        stderr: "surface is no longer available",
        exitCode: 17,
      },
    });
  });

  test("an archive persistence failure is a structured non-2xx result", async () => {
    const runner = new StubRunner([]);
    const failingStore: ArchiveStore = {
      has: () => false,
      archive: async () => {
        throw new Error("disk is read-only");
      },
    };
    const execution = await executeControl(
      { action: "archive", agentId: "codex:test-session" },
      agent(),
      { runner, archiveStore: failingStore },
    );

    expect(execution.status).toBe(500);
    expect(execution.response).toMatchObject({
      ok: false,
      error: {
        code: "ARCHIVE_WRITE_FAILED",
        message: "Could not persist archive state: disk is read-only",
      },
    });
    expect(runner.commands).toHaveLength(0);
  });

  test.each(["ambiguous", "missing"] as const)(
    "%s targets are rejected before the command runner is called",
    async (resolution) => {
      const runner = new StubRunner([]);
      const unsafeAgent = agent(resolution);
      unsafeAgent.controls = unsafeAgent.controls.map((control) => ({ ...control, enabled: true }));

      const execution = await executeControl(
        { action: "interrupt", agentId: unsafeAgent.id },
        unsafeAgent,
        { runner, archiveStore: archiveStore(), cmuxExecutable: "cmux" },
      );

      expect(execution.status).toBe(409);
      expect(execution.response).toMatchObject({ ok: false, error: { code: "UNSAFE_TARGET" } });
      expect(runner.commands).toHaveLength(0);
    },
  );

  test("instruction text remains one JSON RPC argument and never becomes a local shell command", async () => {
    const runner = new StubRunner([]);
    const instruction = "$(touch /tmp/mountain-should-not-exist); rm -rf /";
    const execution = await executeControl(
      { action: "instruct", agentId: "codex:test-session", instruction },
      agent(),
      { runner, archiveStore: archiveStore(), cmuxExecutable: "cmux" },
    );

    expect(execution.status).toBe(200);
    expect(runner.commands).toHaveLength(2);
    expect(runner.commands[0]).toEqual([
      "cmux",
      "rpc",
      "surface.send_text",
      JSON.stringify({ surface_id: "SURFACE-EXACT", text: instruction }),
    ]);
  });

  test("an Enter failure is retried once and succeeds without restaging text", async () => {
    const runner = new StubRunner([
      { exitCode: 0, stdout: "", stderr: "", timedOut: false },
      { exitCode: 7, stdout: "", stderr: "surface was busy", timedOut: false },
      { exitCode: 0, stdout: "", stderr: "", timedOut: false },
    ]);

    const execution = await executeControl(
      { action: "instruct", agentId: "codex:test-session", instruction: "Continue." },
      agent(),
      { runner, archiveStore: archiveStore(), cmuxExecutable: "cmux" },
    );

    expect(execution.status).toBe(200);
    expect(runner.commands.map((command) => command[2])).toEqual([
      "surface.send_text",
      "surface.send_key",
      "surface.send_key",
    ]);
  });

  test("a second Enter failure reports that staged text was not submitted", async () => {
    const runner = new StubRunner([
      { exitCode: 0, stdout: "", stderr: "", timedOut: false },
      { exitCode: 7, stdout: "", stderr: "first failure", timedOut: false },
      { exitCode: 23, stdout: "", stderr: "surface rejected Enter", timedOut: false },
    ]);

    const execution = await executeControl(
      { action: "instruct", agentId: "codex:test-session", instruction: "Continue." },
      agent(),
      { runner, archiveStore: archiveStore(), cmuxExecutable: "cmux" },
    );

    expect(execution.status).toBe(502);
    expect(execution.response).toMatchObject({
      ok: false,
      error: {
        code: "TEXT_STAGED_NOT_SUBMITTED",
        stderr: "surface rejected Enter",
        exitCode: 23,
      },
    });
  });

  test("send_text failures retain CMUX_COMMAND_FAILED without attempting Enter", async () => {
    const runner = new StubRunner([
      { exitCode: 19, stdout: "", stderr: "text rejected", timedOut: false },
    ]);

    const execution = await executeControl(
      { action: "instruct", agentId: "codex:test-session", instruction: "Continue." },
      agent(),
      { runner, archiveStore: archiveStore(), cmuxExecutable: "cmux" },
    );

    expect(execution.response).toMatchObject({
      ok: false,
      error: { code: "CMUX_COMMAND_FAILED", stderr: "text rejected", exitCode: 19 },
    });
    expect(runner.commands).toHaveLength(1);
  });
});

describe("same-origin loopback control HTTP boundary", () => {
  test("a valid same-origin archive request succeeds without invoking cmux", async () => {
    const store = archiveStore();
    const runner = new StubRunner([]);
    const response = await handleControlRequest(
      post(JSON.stringify({ action: "archive", agentId: "codex:test-session" })),
      { runner, archiveStore: store, getSnapshot: snapshot },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, action: "archive" });
    expect(store.archived).toEqual(["codex:test-session"]);
    expect(runner.commands).toHaveLength(0);
  });

  test.each([
    ["missing Origin", undefined],
    ["cross-origin", "http://localhost:4700"],
  ])("rejects %s before reading a control action", async (_label, origin) => {
    const request = new Request("http://127.0.0.1:4701/api/control", {
      method: "POST",
      headers: {
        ...(origin ? { origin } : {}),
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "archive", agentId: "codex:test-session" }),
    });
    const response = await handleControlRequest(request, {
      runner: new StubRunner([]),
      archiveStore: archiveStore(),
      getSnapshot: snapshot,
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "ORIGIN_REJECTED" } });
  });

  test("rejects a non-loopback host even when its Origin matches", async () => {
    const request = new Request("http://mountain.example:4701/api/control", {
      method: "POST",
      headers: { origin: "http://mountain.example:4701", "content-type": "application/json" },
      body: JSON.stringify({ action: "archive", agentId: "codex:test-session" }),
    });
    const response = await handleControlRequest(request, {
      runner: new StubRunner([]),
      archiveStore: archiveStore(),
      getSnapshot: snapshot,
    });

    expect(response.status).toBe(403);
  });

  test("malformed JSON and oversized bodies return explicit non-2xx errors", async () => {
    const dependencies = {
      runner: new StubRunner([]),
      archiveStore: archiveStore(),
      getSnapshot: snapshot,
    };
    const malformed = await handleControlRequest(post("{"), dependencies);
    const oversized = await handleControlRequest(
      post(JSON.stringify({ action: "instruct", agentId: "codex:test-session", instruction: "x".repeat(MAX_CONTROL_BODY_BYTES) })),
      dependencies,
    );

    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: "INVALID_JSON" } });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ error: { code: "BODY_TOO_LARGE" } });
  });

  test.each([
    { action: "command", agentId: "codex:test-session", command: "open -a Calculator" },
    { action: "focus", agentId: "codex:test-session", command: "open -a Calculator" },
  ])("rejects unsupported and arbitrary-command request shapes", async (body) => {
    const runner = new StubRunner([]);
    const response = await handleControlRequest(post(JSON.stringify(body)), {
      runner,
      archiveStore: archiveStore(),
      getSnapshot: snapshot,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "INVALID_CONTROL_REQUEST" } });
    expect(runner.commands).toHaveLength(0);
  });

  test("command failure propagates through HTTP as non-2xx with stderr", async () => {
    const runner = new StubRunner([
      { exitCode: 9, stdout: "", stderr: "permission denied", timedOut: false },
    ]);
    const response = await handleControlRequest(
      post(JSON.stringify({ action: "focus", agentId: "codex:test-session" })),
      { runner, archiveStore: archiveStore(), getSnapshot: snapshot },
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "CMUX_COMMAND_FAILED", stderr: "permission denied", exitCode: 9 },
    });
  });
});
