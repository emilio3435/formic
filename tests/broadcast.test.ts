import { describe, expect, test } from "bun:test";
import { handleBroadcastRequest } from "../src/server/broadcast";
import type { AgentSnapshot, ControlAction, HubSnapshot } from "../src/shared/types";
import type { ArchiveStore, CommandResult, CommandRunner } from "../src/server/types";

class RecordingRunner implements CommandRunner {
  readonly commands: string[][] = [];
  async run(command: readonly string[]): Promise<CommandResult> {
    this.commands.push([...command]);
    return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
  }
}

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };

function agent(id: string, surfaceId: string, instruct = true): AgentSnapshot {
  const actions: readonly ControlAction[] = ["focus", "instruct", "interrupt", "archive"];
  return {
    id, provider: "codex", sourceSessionId: id, displayName: id, programId: "program",
    status: "running", statusReason: "Active", updatedAt: "2026-07-22T07:00:00.000Z",
    tokens: { provenance: "unknown" }, artifacts: [], gates: [],
    target: { surfaceId, resolution: "exact" },
    controls: actions.map((action) => ({ action, enabled: action !== "instruct" || instruct, reason: action === "instruct" && !instruct ? "Observed only." : undefined })),
  };
}

function snapshot(agents: AgentSnapshot[]): HubSnapshot {
  return {
    schemaVersion: 1, generatedAt: "2026-07-22T07:00:00.000Z",
    controlHealth: { cmuxReachable: true, lastCheckedAt: "2026-07-22T07:00:00.000Z", errors: [], staleSources: [] },
    totals: { live: agents.length, tracked: agents.length, attention: 0 },
    programs: [{ id: "program", name: "Program", agents }],
  };
}

function post(body: unknown): Request {
  return new Request("http://127.0.0.1:4701/api/broadcast", {
    method: "POST", headers: { origin: "http://127.0.0.1:4701", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("safe sequential broadcast", () => {
  test("sends the same instruction sequentially and refreshes exactly once", async () => {
    const runner = new RecordingRunner();
    let refreshes = 0;
    const instruction = "Verify current state, then report evidence.";
    const response = await handleBroadcastRequest(post({ agentIds: ["first", "second"], instruction }), {
      runner, archiveStore, cmuxExecutable: "cmux", getSnapshot: () => snapshot([agent("first", "S1"), agent("second", "S2")]),
      afterControl: () => { refreshes += 1; },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, partial: false, sent: 2, failed: 0 });
    expect(runner.commands).toEqual([
      ["cmux", "rpc", "surface.send_text", JSON.stringify({ surface_id: "S1", text: instruction })],
      ["cmux", "rpc", "surface.send_key", JSON.stringify({ surface_id: "S1", key: "Enter" })],
      ["cmux", "rpc", "surface.send_text", JSON.stringify({ surface_id: "S2", text: instruction })],
      ["cmux", "rpc", "surface.send_key", JSON.stringify({ surface_id: "S2", key: "Enter" })],
    ]);
    expect(refreshes).toBe(1);
  });

  test("reports disabled and missing recipients without sending to them", async () => {
    const runner = new RecordingRunner();
    let refreshes = 0;
    const response = await handleBroadcastRequest(post({ agentIds: ["safe", "disabled", "missing"], instruction: "Check in." }), {
      runner, archiveStore, cmuxExecutable: "cmux", getSnapshot: () => snapshot([agent("safe", "SAFE"), agent("disabled", "NOPE", false)]),
      afterControl: () => { refreshes += 1; },
    });
    const body = await response.json();

    expect(response.status).toBe(207);
    expect(body).toMatchObject({ ok: false, partial: true, sent: 1, failed: 2 });
    expect(body.results).toEqual([
      { agentId: "safe", ok: true },
      { agentId: "disabled", ok: false, error: { code: "CONTROL_DISABLED", message: "Observed only." } },
      { agentId: "missing", ok: false, error: { code: "AGENT_NOT_FOUND", message: "The agent is not present in the current snapshot." } },
    ]);
    expect(runner.commands).toHaveLength(2);
    expect(refreshes).toBe(1);
  });

  test.each([
    { agentIds: ["first", "first"], instruction: "Check in." },
    { agentIds: ["first"], instruction: "Check in.", command: "open -a Calculator" },
    { agentIds: ["first"], instruction: "Check in.", cwd: "/tmp" },
  ])("rejects duplicate IDs and arbitrary command or cwd fields", async (body) => {
    const runner = new RecordingRunner();
    const response = await handleBroadcastRequest(post(body), {
      runner, archiveStore, getSnapshot: () => snapshot([agent("first", "S1")]),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_BROADCAST_REQUEST" } });
    expect(runner.commands).toHaveLength(0);
  });

  test("all-disabled recipients return a failure and do not refresh", async () => {
    const runner = new RecordingRunner();
    let refreshes = 0;
    const response = await handleBroadcastRequest(post({ agentIds: ["disabled"], instruction: "Check in." }), {
      runner, archiveStore, getSnapshot: () => snapshot([agent("disabled", "NOPE", false)]),
      afterControl: () => { refreshes += 1; },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, partial: false, sent: 0, failed: 1 });
    expect(runner.commands).toHaveLength(0);
    expect(refreshes).toBe(0);
  });

  test("accepts an exact same-origin IPv6 loopback broadcast", async () => {
    const runner = new RecordingRunner();
    const request = new Request("http://[::1]:4701/api/broadcast", {
      method: "POST",
      headers: { origin: "http://[::1]:4701", "content-type": "application/json" },
      body: JSON.stringify({ agentIds: ["first"], instruction: "Check in." }),
    });
    const response = await handleBroadcastRequest(request, {
      runner, archiveStore, cmuxExecutable: "cmux", getSnapshot: () => snapshot([agent("first", "S1")]),
    });
    expect(response.status).toBe(200);
    expect(runner.commands).toHaveLength(2);
  });
});
