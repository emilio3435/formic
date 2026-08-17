import { canAddressTarget, transmitRefusal } from "./targets";
import type {
  AgentSnapshot,
  ControlAction,
  ControlRequest,
  ControlResponse,
} from "../shared/types";
import { cmuxCommand, DEFAULT_CMUX_EXECUTABLE } from "./cmux";
import {
  assessGrokBotWrite,
  controlSurfaceKind,
  GROK_BOT_GATEWAY_COPY,
  GROK_BOT_INTERRUPT_REASON,
  MISSING_GATEWAY_CAUSE,
  probeGrokBotGateway,
  recordGrokBotProbeResult,
  rememberAcceptedNonce,
  sendGrokBotPrompt,
  wasNonceAccepted,
  withGrokBotNonceLock,
  type GrokBotGatewayOps,
} from "./grok-bot-gateway";
import type { ArchiveStore, CommandResult, CommandRunner } from "./types";

export interface ControlExecution {
  status: number;
  response: ControlResponse;
}

export interface ControlDependencies {
  runner: CommandRunner;
  archiveStore: ArchiveStore;
  cmuxExecutable?: string;
  grokBot?: GrokBotGatewayOps;
}

function failure(
  request: ControlRequest,
  status: number,
  code: string,
  message: string,
  result?: CommandResult,
): ControlExecution {
  return {
    status,
    response: {
      ok: false,
      action: request.action,
      agentId: request.agentId,
      error: {
        code,
        message,
        stderr: result?.stderr.trim() || undefined,
        exitCode: result?.exitCode,
      },
    },
  };
}

export async function runCommand(
  request: ControlRequest,
  runner: CommandRunner,
  command: readonly string[],
): Promise<ControlExecution | null> {
  const result = await runner.run(command);
  if (result.timedOut) return failure(request, 504, "CMUX_TIMEOUT", "cmux command timed out", result);
  if (result.exitCode !== 0) {
    return failure(
      request,
      502,
      "CMUX_COMMAND_FAILED",
      `cmux command exited with status ${result.exitCode}`,
      result,
    );
  }
  return null;
}

function cmuxRpc(executable: string, method: string, payload: Record<string, string>): string[] {
  return cmuxCommand(executable, ["rpc", method, JSON.stringify(payload)]);
}

export async function executeControl(
  request: ControlRequest,
  agent: AgentSnapshot,
  dependencies: ControlDependencies,
): Promise<ControlExecution> {
  if (request.agentId !== agent.id) {
    return failure(request, 409, "AGENT_IDENTITY_MISMATCH", "Request agent ID does not match the resolved agent.");
  }
  const capability = agent.controls.find((control) => control.action === request.action);
  if (!capability?.enabled) {
    const refusal = request.action === "instruct" || request.action === "interrupt"
      ? transmitRefusal({
          target: agent.target,
          processState: agent.processState,
          /* Read from the lifecycle, which is what controlsFor consulted when
             it decided whether to offer this button. Reading `status` here and
             the verdict there is how the two sides of one seam drift: the board
             offers a control the endpoint then refuses, or worse, the reverse. */
          archived: agent.lifecycle
            ? agent.lifecycle === "finished" || agent.scope === "retained"
            : agent.status === "archived",
          identityTrace: agent.identityTrace,
        })
      : null;
    return failure(
      request,
      409,
      "CONTROL_DISABLED",
      refusal?.message ?? capability?.reason ?? "This action is not available for the agent.",
    );
  }

  if (request.action === "archive") {
    try {
      await dependencies.archiveStore.archive(agent.id, agent);
    } catch (error) {
      return failure(
        request,
        500,
        "ARCHIVE_WRITE_FAILED",
        `Could not persist archive state: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { status: 200, response: { ok: true, action: request.action, agentId: request.agentId } };
  }

  if (request.action === "unarchive") {
    /* Refused rather than silently ignored when the store cannot do it. A
       control the system will not honour is a promise the board should never
       have made — the same invariant that keeps the button and this endpoint
       agreeing about everything else. */
    if (!dependencies.archiveStore.unarchive) {
      return failure(request, 409, "CONTROL_DISABLED", "This archive store cannot un-archive a session.");
    }
    try {
      await dependencies.archiveStore.unarchive(agent.id);
    } catch (error) {
      return failure(
        request,
        500,
        "ARCHIVE_WRITE_FAILED",
        `Could not un-archive: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { status: 200, response: { ok: true, action: request.action, agentId: request.agentId } };
  }

  /* Dispatch by surface kind. After this branch a Bot row must never reach
     cmuxRpc — that would type into a tty. Later chatbot surfaces (#134/#135)
     fill the same switch; they are not implemented here. */
  if (controlSurfaceKind(agent.target) === "grok-bot") {
    return executeGrokBotControl(request, agent, dependencies);
  }

  if (!canAddressTarget(agent.target)) {
    return failure(request, 409, "UNSAFE_TARGET", agent.target.reason ?? "No safe cmux surface target is available.");
  }
  const surfaceId = agent.target.surfaceId;
  if (!surfaceId) {
    return failure(request, 409, "UNSAFE_TARGET", agent.target.reason ?? "No safe cmux surface target is available.");
  }
  /* `exact` and `unique-cwd` are not the same claim, and this gate used to
     accept them as if they were.

     `exact` means cmux attests the session is on that surface. `unique-cwd`
     (targets.ts) selects surfaces whose `sourceSessionIds` is EMPTY — panes
     with no identity evidence at all — and picks one by process of elimination
     on a directory string. It is, by construction, a pane cmux cannot identify.

     The failure is the most ordinary thing an operator does. A pane cds away,
     another pane cds in; nothing closes and no agent ends. The row re-resolves
     onto the second pane, still showing instruct as available, and a Send
     addressed to ALPHA executes on BRAVO's tty and returns ok: true while ALPHA
     receives nothing. Proven end to end against probe agents in adc1da0.

     So a directory match may inform DISPLAY, but it may not authorise input.
     This codebase's stated principle is that it refuses to type into a terminal
     it cannot positively identify; unique-cwd is the definition of one. Focus
     is still permitted: it types nothing, and going to look at the pane is how
     an operator recovers when the write controls are off. */
  const writesInput = request.action === "instruct" || request.action === "interrupt";
  /* One predicate, shared with controlsFor, so the button the board offers and
     the answer this endpoint gives cannot drift apart. They did once already:
     26a4585 fixed this side and left the board advertising Send on a row whose
     process was known dead. */
  const refusal = writesInput
    ? transmitRefusal({ target: agent.target, processState: agent.processState, identityTrace: agent.identityTrace })
    : null;
  if (refusal) return failure(request, 409, refusal.code, refusal.message);
  const executable = dependencies.cmuxExecutable ?? DEFAULT_CMUX_EXECUTABLE;
  const commands: string[][] = [];
  if (request.action === "focus") {
    commands.push(cmuxRpc(executable, "surface.focus", { surface_id: surfaceId }));
  } else if (request.action === "interrupt") {
    commands.push(cmuxRpc(executable, "surface.send_key", { surface_id: surfaceId, key: "Escape" }));
  } else if (request.action === "instruct") {
    const instruction = request.instruction?.trim();
    if (!instruction) return failure(request, 400, "INSTRUCTION_REQUIRED", "A non-empty instruction is required.");
    if (/[\r\n]/.test(instruction)) {
      return failure(
        request,
        400,
        "INVALID_INSTRUCTION",
        "Instruction must not contain carriage returns or newlines.",
      );
    }
    const textFailure = await runCommand(
      request,
      dependencies.runner,
      cmuxRpc(executable, "surface.send_text", { surface_id: surfaceId, text: instruction }),
    );
    if (textFailure) return textFailure;

    const enter = cmuxRpc(executable, "surface.send_key", { surface_id: surfaceId, key: "Enter" });
    const firstSubmit = await dependencies.runner.run(enter);
    if (!firstSubmit.timedOut && firstSubmit.exitCode === 0) {
      return { status: 200, response: { ok: true, action: request.action, agentId: request.agentId } };
    }
    const retrySubmit = await dependencies.runner.run(enter);
    if (!retrySubmit.timedOut && retrySubmit.exitCode === 0) {
      return { status: 200, response: { ok: true, action: request.action, agentId: request.agentId } };
    }
    return failure(
      request,
      retrySubmit.timedOut ? 504 : 502,
      "TEXT_STAGED_NOT_SUBMITTED",
      "Instruction text was staged, but Enter failed twice.",
      retrySubmit,
    );
  } else {
    const unsupported: never = request.action;
    return failure(request, 400, "INVALID_ACTION", `Unsupported control action: ${String(unsupported)}`);
  }

  for (const command of commands) {
    const commandFailure = await runCommand(request, dependencies.runner, command);
    if (commandFailure) return commandFailure;
  }
  return { status: 200, response: { ok: true, action: request.action, agentId: request.agentId } };
}

async function executeGrokBotControl(
  request: ControlRequest,
  agent: AgentSnapshot,
  dependencies: ControlDependencies,
): Promise<ControlExecution> {
  const ops = dependencies.grokBot ?? {};
  const assessed = assessGrokBotWrite(agent, ops);
  const freshTarget = {
    ...agent.target,
    kind: "grok-bot" as const,
    agentId: assessed.rosterId || agent.target.agentId,
    instanceId: agent.target.instanceId ?? agent.instanceId,
    instanceLabel: agent.target.instanceLabel ?? agent.instanceLabel,
    originCwd: agent.target.originCwd ?? agent.originCwd,
    gatewayReady: assessed.ready,
    ...(assessed.ready || !assessed.miss ? {} : { gatewayMiss: assessed.miss }),
    resolution: assessed.ready ? "gateway" as const : "missing" as const,
    reason: assessed.reason,
  };
  const writesInput = request.action === "instruct" || request.action === "interrupt";
  const refusal = writesInput
    ? transmitRefusal({
        target: freshTarget,
        processState: agent.processState,
        identityTrace: agent.identityTrace,
      })
    : null;
  if (refusal) return failure(request, 409, refusal.code, refusal.message);

  if (request.action === "interrupt") {
    return failure(request, 409, "CONTROL_DISABLED", GROK_BOT_INTERRUPT_REASON);
  }

  if (request.action === "focus") {
    const app = freshTarget.instanceLabel?.trim();
    if (!app) {
      return failure(request, 409, "UNSAFE_TARGET", MISSING_GATEWAY_CAUSE);
    }
    const result = await dependencies.runner.run(["open", "-a", app]);
    if (result.timedOut) return failure(request, 504, "FOCUS_TIMEOUT", "Opening Grok Bot timed out.", result);
    if (result.exitCode !== 0) {
      return failure(
        request,
        502,
        "FOCUS_FAILED",
        `Could not open ${app}.`,
        result,
      );
    }
    return { status: 200, response: { ok: true, action: request.action, agentId: request.agentId } };
  }

  if (request.action !== "instruct") {
    return failure(request, 400, "INVALID_ACTION", `Unsupported control action: ${request.action}`);
  }

  const instruction = request.instruction?.trim();
  if (!instruction) return failure(request, 400, "INSTRUCTION_REQUIRED", "A non-empty instruction is required.");
  if (/[\r\n]/.test(instruction)) {
    return failure(
      request,
      400,
      "INVALID_INSTRUCTION",
      "Instruction must not contain carriage returns or newlines.",
    );
  }

  const rosterId = assessed.rosterId;
  const instanceId = freshTarget.instanceId ?? "";
  const creds = assessed.creds;
  if (!rosterId || !instanceId || !creds) {
    const copy = GROK_BOT_GATEWAY_COPY[assessed.miss ?? "unreachable-box"];
    return failure(request, 409, "UNSAFE_TARGET", `${copy.cause} ${copy.remedy}`);
  }

  const clientNonce = request.clientNonce?.trim() || crypto.randomUUID();
  return withGrokBotNonceLock(instanceId, rosterId, clientNonce, async () => {
    if (wasNonceAccepted(instanceId, rosterId, clientNonce)) {
      return { status: 200, response: { ok: true, action: request.action, agentId: request.agentId } };
    }

    const probe = ops.probe ?? probeGrokBotGateway;
    if (!(await probe(creds))) {
      recordGrokBotProbeResult(instanceId, false);
      const copy = GROK_BOT_GATEWAY_COPY["probe-rejected"];
      return failure(
        request,
        409,
        "UNSAFE_TARGET",
        `${copy.cause} ${copy.remedy}`,
      );
    }
    recordGrokBotProbeResult(instanceId, true);

    const send = ops.sendPrompt ?? sendGrokBotPrompt;
    const sent = await send({
      url: creds.url,
      token: creds.token,
      agentId: rosterId,
      prompt: instruction,
      clientNonce,
    });
    if (!sent.ok) {
      return failure(
        request,
        502,
        "GROK_BOT_SEND_FAILED",
        sent.error ?? "Grok Bot gateway did not accept the prompt.",
      );
    }
    rememberAcceptedNonce(instanceId, rosterId, clientNonce);
    return { status: 200, response: { ok: true, action: request.action, agentId: request.agentId } };
  });
}

export const CONTROL_ACTIONS: readonly ControlAction[] = ["focus", "instruct", "interrupt", "archive", "unarchive"];
