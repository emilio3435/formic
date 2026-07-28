import { describe, expect, test } from "bun:test";
import { executeControl } from "../src/server/control";
import { handleControlRequest, MAX_INSTRUCTION_BYTES } from "../src/server/http";
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

function agent(): AgentSnapshot {
  const actions: readonly ControlAction[] = ["focus", "instruct", "interrupt", "archive"];
  return {
    id: "codex:control-safety",
    provider: "codex",
    sourceSessionId: "control-safety",
    displayName: "Control safety",
    programId: "test-program",
    status: "running",
    statusReason: "Fixture activity is recent.",
    lastHumanMessage: null,
    updatedAt: "2026-07-28T10:00:00.000Z",
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    target: { surfaceId: "SURFACE-SAFE", resolution: "exact" },
    controls: actions.map((action) => ({ action, enabled: true })),
  };
}

function snapshot(): HubSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-28T10:00:00.000Z",
    controlHealth: {
      cmuxReachable: true,
      lastCheckedAt: "2026-07-28T10:00:00.000Z",
      errors: [],
      staleSources: [],
    },
    totals: { live: 1, tracked: 1, attention: 0 },
    programs: [{ id: "test-program", name: "Test program", agents: [agent()] }],
  };
}

function dependencies(runner: CommandRunner) {
  return { runner, archiveStore, cmuxExecutable: "cmux" };
}

describe("control execution safety guards", () => {
  test("rejects an identity mismatch before any cmux command", async () => {
    const runner = new RecordingRunner();
    const execution = await executeControl(
      { action: "focus", agentId: "codex:different-agent" },
      agent(),
      dependencies(runner),
    );

    expect(execution.status).toBe(409);
    expect(execution.response).toMatchObject({
      ok: false,
      error: { code: "AGENT_IDENTITY_MISMATCH" },
    });
    expect(runner.commands).toHaveLength(0);
  });

  test("rejects a whitespace instruction before sending text or Enter", async () => {
    const runner = new RecordingRunner();
    const execution = await executeControl(
      { action: "instruct", agentId: agent().id, instruction: "   " },
      agent(),
      dependencies(runner),
    );

    expect(execution.status).toBe(400);
    expect(execution.response).toMatchObject({
      ok: false,
      error: { code: "INSTRUCTION_REQUIRED" },
    });
    expect(runner.commands).toHaveLength(0);
  });

  test.each(["First line\nSecond line", "First line\rSecond line"])(
    "rejects CR/LF instruction text before typing it into a terminal",
    async (instruction) => {
      const runner = new RecordingRunner();
      const execution = await executeControl(
        { action: "instruct", agentId: agent().id, instruction },
        agent(),
        dependencies(runner),
      );

      expect(execution.status).toBe(400);
      expect(execution.response).toMatchObject({
        ok: false,
        error: {
          code: "INVALID_INSTRUCTION",
          message: "Instruction must not contain carriage returns or newlines.",
        },
      });
      expect(runner.commands).toHaveLength(0);
    },
  );
});

describe("control HTTP method, media type, and instruction size boundaries", () => {
  const httpDependencies = (runner: CommandRunner) => ({
    ...dependencies(runner),
    getSnapshot: snapshot,
  });

  test("rejects non-POST requests", async () => {
    const response = await handleControlRequest(
      new Request("http://127.0.0.1:4701/api/control"),
      httpDependencies(new RecordingRunner()),
    );

    expect(response.status).toBe(405);
    expect(await response.json()).toMatchObject({ error: { code: "METHOD_NOT_ALLOWED" } });
  });

  test("rejects non-JSON POST requests", async () => {
    const response = await handleControlRequest(
      new Request("http://127.0.0.1:4701/api/control", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:4701", "content-type": "text/plain" },
        body: "{}",
      }),
      httpDependencies(new RecordingRunner()),
    );

    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ error: { code: "CONTENT_TYPE_REJECTED" } });
  });

  test("rejects an instruction one byte over the terminal paste cap", async () => {
    const runner = new RecordingRunner();
    const response = await handleControlRequest(
      new Request("http://127.0.0.1:4701/api/control", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:4701", "content-type": "application/json" },
        body: JSON.stringify({
          action: "instruct",
          agentId: agent().id,
          instruction: "x".repeat(MAX_INSTRUCTION_BYTES + 1),
        }),
      }),
      httpDependencies(runner),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: "INVALID_CONTROL_REQUEST",
        message: `instruction exceeds ${MAX_INSTRUCTION_BYTES} bytes.`,
      },
    });
    expect(runner.commands).toHaveLength(0);
  });
});
