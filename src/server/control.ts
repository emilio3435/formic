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

  const surfaceId = agent.target.surfaceId;
  if (!surfaceId || !["exact", "unique-cwd"].includes(agent.target.resolution)) {
    return failure(request, 409, "UNSAFE_TARGET", agent.target.reason ?? "No safe cmux surface target is available.");
  }
  const executable = dependencies.cmuxExecutable ?? DEFAULT_CMUX_EXECUTABLE;
  const commands: string[][] = [];
  if (request.action === "focus") {
    commands.push(cmuxRpc(executable, "surface.focus", { surface_id: surfaceId }));
  } else if (request.action === "interrupt") {
    commands.push(cmuxRpc(executable, "surface.send_key", { surface_id: surfaceId, key: "Escape" }));
  } else if (request.action === "instruct") {
    const instruction = request.instruction?.trim();
    if (!instruction) return failure(request, 400, "INSTRUCTION_REQUIRED", "A non-empty instruction is required.");
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
