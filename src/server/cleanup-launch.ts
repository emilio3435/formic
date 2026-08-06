import { join } from "node:path";
import type { CommandResult, CommandRunner } from "./types";

export const CLEANER_MODEL = "grok-4.5";
export const CLEANER_NAME = "Cleaner";

export const CLEANER_PROMPT = [
  "Goal: Invoke the /cleanup skill and safely resolve only the repository cleanup plan produced by scripts/anthill-cleanup-sweep.ts.",
  "",
  "Success means:",
  "- Run the sweep tool in propose mode first and report every removable item with its rollback SHA plus every refusal and reason.",
  "- Ask the operator in this session to approve the exact removable items before using the sweep tool's guarded confirm mode.",
  "- Re-check the proposed set at confirmation and treat any live agent process inside a candidate worktree as a hard stop.",
  "- Report each phase and the final removed and refused counts through this ordinary session transcript and lifecycle.",
  "",
  "Stop when: The approved plan finishes and the final counts and rollback SHAs are reported, or operator approval cannot be obtained, in which case leave repository state unchanged and say so.",
  "",
  "Constraints:",
  "- Use scripts/anthill-cleanup-sweep.ts as the cleanup tool for this run.",
  "- Preserve every refusal and leave every item the sweep cannot verify untouched.",
  "- Use this ordinary Cursor session as the sole progress and approval channel.",
].join("\n");

export interface CleanupLaunch {
  sessionId: string;
}

export type CleanupLauncher = () => Promise<CleanupLaunch>;

export class CleanupLaunchError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CleanupLaunchError";
  }
}

export interface NativeCleanupLauncherOptions {
  repoRoot: string;
  cmuxExecutable: string;
  runner: CommandRunner;
  nameSession?: (agentId: string, name: string) => void | Promise<void>;
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CREATE_TIMEOUT_MS = 15_000;
const LAUNCH_TIMEOUT_MS = 15_000;

function commandFailure(result: CommandResult): string {
  if (result.timedOut) return "the command timed out";
  return result.stderr.trim() || result.stdout.trim() || `the command exited ${result.exitCode}`;
}

function cmuxUnreachable(result: CommandResult): boolean {
  return result.timedOut || result.exitCode === -1 ||
    /(?:socket|connect|unreachable|not found|refused|unavailable)/i.test(`${result.stderr}\n${result.stdout}`);
}

function shellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function shellCommand(command: readonly string[]): string {
  return command.map(shellArgument).join(" ");
}

function createdSessionId(output: string): string | undefined {
  const values = output.trim().split(/\s+/).filter(Boolean);
  return values.length === 1 && SESSION_ID.test(values[0]!) ? values[0] : undefined;
}

export function createNativeCleanupLauncher(options: NativeCleanupLauncherOptions): CleanupLauncher {
  const cursorWrapper = join(options.repoRoot, "scripts", "anthill-cursor-agent");
  return async () => {
    const created = await options.runner.run([cursorWrapper, "create-chat"], CREATE_TIMEOUT_MS);
    if (created.timedOut || created.exitCode !== 0) {
      throw new CleanupLaunchError(
        "CLEANER_SESSION_CREATE_FAILED",
        `Cursor could not reserve a Cleaner session: ${commandFailure(created)}.`,
      );
    }
    const sessionId = createdSessionId(created.stdout);
    if (!sessionId) {
      throw new CleanupLaunchError(
        "CLEANER_SESSION_ID_INVALID",
        "Cursor did not return one bindable session UUID, so no Cleaner lane was launched.",
      );
    }

    const command = shellCommand([
      cursorWrapper,
      "--resume",
      sessionId,
      "--model",
      CLEANER_MODEL,
      "--trust",
      CLEANER_PROMPT,
    ]);
    const launched = await options.runner.run([
      options.cmuxExecutable,
      "new-workspace",
      "--name",
      CLEANER_NAME,
      "--description",
      "Human-gated repository cleanup lane",
      "--cwd",
      options.repoRoot,
      "--command",
      command,
      "--focus",
      "false",
    ], LAUNCH_TIMEOUT_MS);
    if (launched.timedOut || launched.exitCode !== 0) {
      throw new CleanupLaunchError(
        cmuxUnreachable(launched) ? "CLEANER_CMUX_UNREACHABLE" : "CLEANER_LAUNCH_FAILED",
        `cmux could not create the Cleaner workspace, so no observable lane was launched: ${commandFailure(launched)}.`,
      );
    }
    await options.nameSession?.(`cursor:${sessionId}`, CLEANER_NAME);
    return { sessionId };
  };
}
