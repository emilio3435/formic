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
  "- Put the re-verification caveat and every other operational note above the approval question.",
  "",
  "Stop when: The approved plan finishes and the final counts and rollback SHAs are reported, or operator approval cannot be obtained, in which case leave repository state unchanged and say so.",
  "",
  "Constraints:",
  "- Use scripts/anthill-cleanup-sweep.ts as the cleanup tool for this run.",
  "- Preserve every refusal and leave every item the sweep cannot verify untouched.",
  "- Use this ordinary Cursor session as the sole progress and approval channel.",
  "",
  "After the proposal body and every caveat, end the proposal turn with exactly this question and no text after it:",
  "Should I run guarded confirm for the exact removable items above, or decline and leave the repository unchanged?",
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
const READY_POLL_MS = 100;
const READY_ATTEMPTS = 50;
const CMUX_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_READY = /^\s*Cursor Agent\s*$/m;

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

function createdWorkspaceTarget(output: string): string | undefined {
  const ids = [...output.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)]
    .map(([id]) => id);
  if (new Set(ids.map((id) => id.toLowerCase())).size === 1) return ids[0];
  const refs = [...output.matchAll(/\bworkspace:\d+\b/g)].map(([ref]) => ref);
  return new Set(refs).size === 1 ? refs[0] : undefined;
}

function singleSurfaceId(output: string): string | undefined {
  const ids = output.split("\n").flatMap((line) => {
    const match = /^\s*(?:\*\s*)?([0-9a-f-]+)(?:\s|$)/i.exec(line);
    return match?.[1] && CMUX_ID.test(match[1]) ? [match[1]] : [];
  });
  return ids.length === 1 ? ids[0] : undefined;
}

async function waitForCursorSurface(
  runner: CommandRunner,
  cmuxExecutable: string,
  surfaceId: string,
): Promise<void> {
  for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
    const screen = await runner.run([
      cmuxExecutable,
      "read-screen",
      "--surface",
      surfaceId,
    ], LAUNCH_TIMEOUT_MS);
    if (screen.timedOut || screen.exitCode !== 0) {
      throw new CleanupLaunchError(
        cmuxUnreachable(screen) ? "CLEANER_CMUX_UNREACHABLE" : "CLEANER_LAUNCH_FAILED",
        `cmux could not observe the Cleaner terminal while Cursor started: ${commandFailure(screen)}.`,
      );
    }
    if (CURSOR_READY.test(screen.stdout)) return;
    if (attempt + 1 < READY_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
    }
  }
  throw new CleanupLaunchError(
    "CLEANER_LAUNCH_FAILED",
    "The Cleaner terminal opened, but Cursor did not become ready to receive its prompt.",
  );
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
      "agent",
      "--resume",
      sessionId,
      "--model",
      CLEANER_MODEL,
      "--trust",
    ]);
    const launched = await options.runner.run([
      options.cmuxExecutable,
      "--id-format",
      "uuids",
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
    const workspaceTarget = createdWorkspaceTarget(launched.stdout);
    if (!workspaceTarget) {
      throw new CleanupLaunchError(
        "CLEANER_LAUNCH_FAILED",
        "cmux created a Cleaner workspace but did not return one exact workspace target, so no prompt was sent.",
      );
    }

    const listed = await options.runner.run([
      options.cmuxExecutable,
      "--id-format",
      "uuids",
      "list-pane-surfaces",
      "--workspace",
      workspaceTarget,
    ], LAUNCH_TIMEOUT_MS);
    if (listed.timedOut || listed.exitCode !== 0) {
      throw new CleanupLaunchError(
        cmuxUnreachable(listed) ? "CLEANER_CMUX_UNREACHABLE" : "CLEANER_LAUNCH_FAILED",
        `cmux could not resolve the Cleaner terminal surface, so no prompt was sent: ${commandFailure(listed)}.`,
      );
    }
    const surfaceId = singleSurfaceId(listed.stdout);
    if (!surfaceId) {
      throw new CleanupLaunchError(
        "CLEANER_LAUNCH_FAILED",
        "cmux did not return one exact Cleaner terminal surface, so no prompt was sent.",
      );
    }

    await waitForCursorSurface(options.runner, options.cmuxExecutable, surfaceId);

    const staged = await options.runner.run([
      options.cmuxExecutable,
      "rpc",
      "surface.send_text",
      JSON.stringify({ surface_id: surfaceId, text: CLEANER_PROMPT }),
    ], LAUNCH_TIMEOUT_MS);
    if (staged.timedOut || staged.exitCode !== 0) {
      throw new CleanupLaunchError(
        cmuxUnreachable(staged) ? "CLEANER_CMUX_UNREACHABLE" : "CLEANER_LAUNCH_FAILED",
        `cmux could not stage the Cleaner prompt in its exact surface: ${commandFailure(staged)}.`,
      );
    }
    const submitted = await options.runner.run([
      options.cmuxExecutable,
      "rpc",
      "surface.send_key",
      JSON.stringify({ surface_id: surfaceId, key: "Enter" }),
    ], LAUNCH_TIMEOUT_MS);
    if (submitted.timedOut || submitted.exitCode !== 0) {
      throw new CleanupLaunchError(
        cmuxUnreachable(submitted) ? "CLEANER_CMUX_UNREACHABLE" : "CLEANER_LAUNCH_FAILED",
        `The Cleaner prompt was staged but not submitted, so the lane was not reported as launched: ${commandFailure(submitted)}.`,
      );
    }
    await options.nameSession?.(`cursor:${sessionId}`, CLEANER_NAME);
    return { sessionId };
  };
}
