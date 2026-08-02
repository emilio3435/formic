import { canAddressTarget, transmitRefusal } from "./targets";
import type {
  AgentSnapshot,
  ControlAction,
  ControlRequest,
  ControlResponse,
} from "../shared/types";
import { cmuxCommand, DEFAULT_CMUX_EXECUTABLE } from "./cmux";
import type { ArchiveStore, CommandResult, CommandRunner } from "./types";

export interface ControlExecution {
  status: number;
  response: ControlResponse;
}

export interface ControlDependencies {
  runner: CommandRunner;
  archiveStore: ArchiveStore;
  cmuxExecutable?: string;
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
    return failure(
      request,
      409,
      "CONTROL_DISABLED",
      capability?.reason ?? "This action is not available for the agent.",
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

  if (!canAddressTarget(agent.target)) {
    return failure(request, 409, "UNSAFE_TARGET", agent.target.reason ?? "No safe cmux surface target is available.");
  }
  const surfaceId = agent.target.surfaceId;
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
    ? transmitRefusal({ target: agent.target, processState: agent.processState })
    : null;
  if (refusal) return failure(request, 409, refusal.code, refusal.reason);
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

export const CONTROL_ACTIONS: readonly ControlAction[] = ["focus", "instruct", "interrupt", "archive"];
