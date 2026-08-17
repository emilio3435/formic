import { beforeAll, describe, expect, test } from "bun:test";
import { executeControl } from "../src/server/control";
import {
  createCodexAppSession,
  encodeJsonRpcNotification,
  encodeJsonRpcRequest,
  encodeJsonRpcResult,
  initializeParams,
  parseJsonRpcLine,
} from "../src/server/codex-app";
import { controlSurfaceKind } from "../src/server/grok-bot-gateway";
import { isSharedAgentService } from "../src/server/identity";
import { controlsFor, operatorControlState, processStateFor } from "../src/server/snapshot-agent";
import {
  canWriteToTarget,
  resolveAgentTarget,
  transmitRefusal,
} from "../src/server/targets";
import type { AgentSnapshot, CmuxTarget } from "../src/shared/types";
import type {
  ArchiveStore,
  CollectedAgent,
  CommandResult,
  CommandRunner,
  CmuxSurface,
} from "../src/server/types";

const THREAD_ID = "019fd501-3322-7180-8990-b6af48404e15";
const NOW = "2026-08-17T18:00:00.000Z";

class RecordingRunner implements CommandRunner {
  readonly commands: string[][] = [];
  async run(command: readonly string[]): Promise<CommandResult> {
    this.commands.push([...command]);
    return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
  }
}

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };

function collectedCodex(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: `codex:${THREAD_ID}`,
    provider: "codex",
    sourceSessionId: THREAD_ID,
    displayName: "Codex desktop thread",
    status: "waiting",
    statusReason: "Quiet Codex row.",
    updatedAt: NOW,
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    cwd: "/Users/me/project",
    launch: { entrypoint: "Codex Desktop", promptSource: "vscode" },
    ...overrides,
  };
}

function appTarget(overrides: Partial<CmuxTarget> = {}): CmuxTarget {
  return {
    kind: "codex-app",
    threadId: THREAD_ID,
    appServerReady: true,
    resolution: "app-server",
    reason: "Codex app-server accepted thread/resume for this rollout.",
    ...overrides,
  };
}

function snapshotCodex(overrides: {
  target?: CmuxTarget;
  archived?: boolean;
  processState?: AgentSnapshot["processState"];
  collected?: Partial<CollectedAgent>;
} = {}): AgentSnapshot {
  const collected = collectedCodex(overrides.collected);
  const target = overrides.target ?? appTarget();
  const archived = overrides.archived ?? false;
  return {
    ...collected,
    programId: "codex",
    lastHumanMessage: null,
    processState: overrides.processState ?? processStateFor(collected),
    controlState: operatorControlState(target, archived),
    target,
    controls: controlsFor(collected, target, archived),
  } as AgentSnapshot;
}

describe("Codex desktop is its own surface kind", () => {
  test("Codex Desktop and work-desktop launches resolve to codex-app, never a fake cmux exact", () => {
    for (const launch of [
      { entrypoint: "Codex Desktop", promptSource: "vscode" },
      { entrypoint: "codex_work_desktop" },
    ]) {
      const agent = collectedCodex({ launch });
      const surface: CmuxSurface = {
        surfaceId: "SURFACE-FAKE",
        paneId: "PANE-1",
        cwd: agent.cwd,
        sourceSessionIds: [],
      };
      const target = resolveAgentTarget(agent, [surface], [agent]);
      expect(target.kind).toBe("codex-app");
      expect(target.threadId).toBe(THREAD_ID);
      expect(target.surfaceId).toBeUndefined();
      expect(target.resolution).not.toBe("exact");
      expect(target.resolution).not.toBe("unique-cwd");
      expect(controlSurfaceKind(target)).toBe("codex-app");
    }
  });

  test("a Codex CLI row with exact cmux stays on the cmux path", () => {
    const agent = collectedCodex({
      launch: { entrypoint: "codex-tui", promptSource: "cli" },
    });
    const surface: CmuxSurface = {
      surfaceId: "SURFACE-CLI",
      paneId: "PANE-CLI",
      cwd: agent.cwd,
      sourceSessionIds: [THREAD_ID],
    };
    const target = resolveAgentTarget(agent, [surface], [agent]);
    expect(target.kind ?? "cmux").toBe("cmux");
    expect(controlSurfaceKind(target)).toBe("cmux");
    expect(target.resolution).toBe("exact");
    expect(target.surfaceId).toBe("SURFACE-CLI");
    expect(canWriteToTarget(target)).toBe(true);
  });

  test("canWriteToTarget for codex-app requires the rollout UUID plus accepted resume, not an open FD", () => {
    expect(canWriteToTarget(appTarget())).toBe(true);
    expect(canWriteToTarget(appTarget({ appServerReady: false, resolution: "missing" }))).toBe(false);
    expect(canWriteToTarget(appTarget({ threadId: undefined, appServerReady: true }))).toBe(false);
    expect(canWriteToTarget({
      resolution: "exact",
      surfaceId: "SURFACE-FAKE",
      attestation: "live",
    })).toBe(true);
    expect(canWriteToTarget({
      kind: "codex-app",
      resolution: "exact",
      surfaceId: "SURFACE-FAKE",
      attestation: "live",
      threadId: THREAD_ID,
      appServerReady: false,
    })).toBe(false);
  });

  test("a stale app-server FD is a multiplexer and never authorizes Send", () => {
    expect(isSharedAgentService(
      "/Applications/ChatGPT.app/Contents/Resources/codex app-server --analytics-default-enabled",
    )).toBe(true);
    const agent = snapshotCodex({
      processState: "unknown",
      target: appTarget({ appServerReady: false, resolution: "missing", appServerMiss: "resume-rejected" }),
    });
    expect(agent.controls.find((control) => control.action === "instruct")?.enabled).toBe(false);
    const refusal = transmitRefusal({
      target: agent.target,
      processState: "unknown",
    });
    expect(refusal?.code).toBe("UNSAFE_TARGET");
    expect(refusal?.message).not.toMatch(/cmux pane/i);
    expect(refusal?.message).not.toMatch(/no safe cmux target/i);
  });
});

describe("consumer ChatGPT is not the Codex app surface", () => {
  test("a consumer ChatGPT row refuses Send with a non-cmux reason", () => {
    const agent = collectedCodex({
      launch: { entrypoint: "ChatGPT" },
    });
    const target = resolveAgentTarget(agent, [], [agent]);
    expect(target.kind).toBe("chatgpt");
    expect(canWriteToTarget(target)).toBe(false);
    const refusal = transmitRefusal({ target, processState: "unknown" });
    expect(refusal?.code).toBe("UNSAFE_TARGET");
    expect(refusal?.message).toMatch(/consumer ChatGPT/i);
    expect(refusal?.message).not.toMatch(/cmux pane/i);
    expect(refusal?.message).not.toMatch(/no safe cmux target/i);
    expect(refusal?.message).not.toMatch(/open it in a cmux/i);
  });
});

describe("executeControl dispatches Codex app-server JSON-RPC", () => {
  test("instruct initializes, resumes the exact rollout UUID, then turn/start", async () => {
    const runner = new RecordingRunner();
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const agent = snapshotCodex();
    const execution = await executeControl(
      { action: "instruct", agentId: agent.id, instruction: "Ship the resume path." },
      agent,
      {
        runner,
        archiveStore,
        codexApp: {
          threadExists: (threadId) => threadId === THREAD_ID,
          rpc: async (method, params) => {
            calls.push({ method, params });
            if (method === "initialize") return { ok: true };
            if (method === "thread/resume") {
              expect(params.threadId).toBe(THREAD_ID);
              return { ok: true, status: "idle" };
            }
            if (method === "turn/start") {
              expect(params.threadId).toBe(THREAD_ID);
              expect(params.input).toEqual([{ type: "text", text: "Ship the resume path." }]);
              return { ok: true, turnId: "turn_1" };
            }
            throw new Error(`unexpected method ${method}`);
          },
        },
      },
    );
    expect(execution.response.ok).toBe(true);
    expect(runner.commands).toEqual([]);
    expect(calls.map((call) => call.method)).toEqual([
      "initialize",
      "thread/resume",
      "turn/start",
    ]);
    expect(JSON.stringify(calls[0]?.params)).toContain("\"name\":\"formic\"");
  });

  test("an already-generating thread uses turn/steer, not a second turn/start", async () => {
    const calls: string[] = [];
    const agent = snapshotCodex();
    const execution = await executeControl(
      { action: "instruct", agentId: agent.id, instruction: "Focus on the failing test." },
      agent,
      {
        runner: new RecordingRunner(),
        archiveStore,
        codexApp: {
          threadExists: () => true,
          rpc: async (method, params) => {
            calls.push(method);
            if (method === "initialize") return { ok: true };
            if (method === "thread/resume") return { ok: true, status: "inProgress", turnId: "turn_active" };
            if (method === "turn/steer") {
              expect(params.threadId).toBe(THREAD_ID);
              expect(params.expectedTurnId).toBe("turn_active");
              expect(params.input).toEqual([{ type: "text", text: "Focus on the failing test." }]);
              return { ok: true, turnId: "turn_active" };
            }
            throw new Error(`unexpected method ${method}`);
          },
        },
      },
    );
    expect(execution.response.ok).toBe(true);
    expect(calls).toEqual(["initialize", "thread/resume", "turn/steer"]);
    expect(calls).not.toContain("turn/start");
  });

  test("command approvals are declined, never auto-accepted", async () => {
    const decisions: unknown[] = [];
    const agent = snapshotCodex();
    const execution = await executeControl(
      { action: "instruct", agentId: agent.id, instruction: "Run the tests." },
      agent,
      {
        runner: new RecordingRunner(),
        archiveStore,
        codexApp: {
          threadExists: () => true,
          rpc: async (method) => {
            if (method === "initialize") return { ok: true };
            if (method === "thread/resume") return { ok: true, status: "idle" };
            if (method === "turn/start") {
              return {
                ok: true,
                turnId: "turn_2",
                approvals: [{
                  method: "item/commandExecution/requestApproval",
                  id: 99,
                  params: { threadId: THREAD_ID, turnId: "turn_2", command: "rm -rf /" },
                }],
              };
            }
            throw new Error(`unexpected method ${method}`);
          },
          answerApproval: async (request) => {
            decisions.push(request.decision);
            return { ok: true };
          },
        },
      },
    );
    expect(execution.response.ok).toBe(true);
    expect(decisions).toEqual(["decline"]);
    expect(decisions).not.toContain("accept");
    expect(decisions).not.toContain("acceptForSession");
  });

  test("Focus opens the Codex thread deeplink and is not Send", async () => {
    const runner = new RecordingRunner();
    const methods: string[] = [];
    const agent = snapshotCodex();
    const execution = await executeControl(
      { action: "focus", agentId: agent.id },
      agent,
      {
        runner,
        archiveStore,
        codexApp: {
          rpc: async (method) => {
            methods.push(method);
            return { ok: true };
          },
        },
      },
    );
    expect(execution.response.ok).toBe(true);
    expect(runner.commands).toEqual([["open", `codex://threads/${THREAD_ID}`]]);
    expect(methods).toEqual([]);
    expect(JSON.stringify(runner.commands)).not.toContain("codex://new");
    expect(JSON.stringify(runner.commands)).not.toContain("turn/start");
  });

  test("a Codex CLI instruct still types into the cmux pane", async () => {
    const runner = new RecordingRunner();
    const agent = snapshotCodex({
      collected: { launch: { entrypoint: "codex-tui", promptSource: "cli" } },
      target: {
        surfaceId: "SURFACE-CLI",
        resolution: "exact",
        attestation: "live",
      },
    });
    const execution = await executeControl(
      { action: "instruct", agentId: agent.id, instruction: "Stay on cmux." },
      agent,
      { runner, archiveStore },
    );
    expect(execution.response.ok).toBe(true);
    expect(JSON.stringify(runner.commands)).toContain("surface.send_text");
    expect(JSON.stringify(runner.commands)).toContain("SURFACE-CLI");
  });

  test("resume rejection never enables the composer", async () => {
    const agent = snapshotCodex({
      target: appTarget({ appServerReady: false, resolution: "missing", appServerMiss: "resume-rejected" }),
    });
    expect(agent.controls.find((control) => control.action === "instruct")?.enabled).toBe(false);
    const execution = await executeControl(
      { action: "instruct", agentId: agent.id, instruction: "No." },
      agent,
      { runner: new RecordingRunner(), archiveStore },
    );
    expect(execution.response.ok).toBe(false);
    expect(execution.status).toBe(409);
    expect(execution.response.error?.message).not.toMatch(/cmux pane/i);
  });
});

describe("official app-server JSON-RPC wire", () => {
  test("initialize names formic and the session resumes then starts a turn", async () => {
    const written: string[] = [];
    const incoming: string[] = [];
    let sendLine: ((line: string) => void) | undefined;
    let closed = false;
    const transport = {
      write(line: string) {
        written.push(line);
        const message = parseJsonRpcLine(line);
        if (message?.method === "initialize") {
          queueMicrotask(() => sendLine?.(encodeJsonRpcResult(Number(message.id), { ok: true })));
        }
        if (message?.method === "thread/resume") {
          expect(message.params).toEqual({ threadId: THREAD_ID });
          queueMicrotask(() => sendLine?.(encodeJsonRpcResult(Number(message.id), { thread: { id: THREAD_ID, status: "idle" } })));
        }
        if (message?.method === "turn/start") {
          queueMicrotask(() => sendLine?.(encodeJsonRpcResult(Number(message.id), { turn: { id: "turn_1", status: "inProgress" } })));
        }
        if (message?.method === "item/commandExecution/requestApproval") {
          throw new Error("client must not send approval requests");
        }
      },
      async *read() {
        while (!closed) {
          const line = incoming.shift();
          if (line) {
            yield line;
            continue;
          }
          await new Promise<void>((resolve) => {
            sendLine = (next) => {
              incoming.push(next);
              resolve();
            };
          });
        }
      },
      close() {
        closed = true;
        sendLine?.("");
      },
    };
    const session = createCodexAppSession(transport);
    const init = await session.rpc!("initialize", initializeParams());
    expect(init.ok).toBe(true);
    expect(written[0]).toBe(encodeJsonRpcRequest(1, "initialize", initializeParams()));
    expect(written[1]).toBe(encodeJsonRpcNotification("initialized"));
    expect(JSON.parse(written[0]!).clientInfo ?? JSON.parse(written[0]!).params.clientInfo)
      .toEqual({ name: "formic", title: "Formic" });
    const resumed = await session.rpc!("thread/resume", { threadId: THREAD_ID });
    expect(resumed.ok).toBe(true);
    expect(resumed.status).toBe("idle");
    const started = await session.rpc!("turn/start", {
      threadId: THREAD_ID,
      input: [{ type: "text", text: "Ship it." }],
    });
    expect(started.ok).toBe(true);
    session.close!();
  });

  test("an inbound command approval is declined on the wire and never accepted", async () => {
    const written: string[] = [];
    const incoming: string[] = [];
    let sendLine: ((line: string) => void) | undefined;
    let closed = false;
    const transport = {
      write(line: string) {
        written.push(line);
        const message = parseJsonRpcLine(line);
        if (message?.method === "initialize") {
          queueMicrotask(() => {
            sendLine?.(encodeJsonRpcResult(Number(message.id), { ok: true }));
            sendLine?.(JSON.stringify({
              method: "item/commandExecution/requestApproval",
              id: 77,
              params: { threadId: THREAD_ID, command: "rm -rf /" },
            }));
          });
        }
      },
      async *read() {
        while (!closed) {
          const line = incoming.shift();
          if (line) {
            yield line;
            continue;
          }
          await new Promise<void>((resolve) => {
            sendLine = (next) => {
              incoming.push(next);
              resolve();
            };
          });
        }
      },
      close() {
        closed = true;
        sendLine?.("");
      },
    };
    const session = createCodexAppSession(transport);
    const init = await session.rpc!("initialize", initializeParams());
    expect(init.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const declined = written.map((line) => parseJsonRpcLine(line)).find((message) => message?.id === 77);
    expect(declined).toEqual({ id: 77, result: { decision: "decline" } });
    expect(JSON.stringify(written)).not.toContain("accept");
    session.close!();
  });
});

describe("Codex app dock copy", () => {
  let presentation: { controlUnavailableText: (state: string, agent?: object) => string };

  beforeAll(async () => {
    presentation = await import("../src/web/presentation.js");
  });

  test("a not-ready desktop row does not tell the operator to open a cmux pane", () => {
    const agent = snapshotCodex({
      target: appTarget({ appServerReady: false, resolution: "missing", appServerMiss: "resume-rejected" }),
    });
    const text = presentation.controlUnavailableText("observed-only", agent);
    expect(text).not.toMatch(/cmux pane/i);
    expect(text).not.toMatch(/no safe cmux target/i);
    expect(text).toMatch(/app-server|thread\/resume|Codex desktop/i);
  });
});
