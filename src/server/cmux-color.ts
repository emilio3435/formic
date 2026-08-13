/* TINT — the colour funnel. EVERY cmux colour write in this program goes
   through here: the board (TINT-F), the sidebar group mirror (TINT-G) and the
   two-way sync (TINT-S). Nothing shells `workspace-action set-color` directly.

   Two reasons it is one door rather than three call sites.

   Echo suppression. TINT-S reads `custom_color` back off cmux on the collector
   poll and re-asserts the board's answer whenever the two disagree. Our own
   write is the loudest disagreement there is: the board writes storm, the next
   poll reads storm and, with no memory of having written it, calls that drift
   from whatever it thought before. `lastWrittenHex` is that memory, and it only
   exists if all the writes pass one place.

   Failure honesty. A shelled cmux command that exits non-zero or prints to
   stderr is a FAILURE everywhere in this program — the house rule since the
   first GOAL.md. A funnel that returned true on a command that printed
   "workspace not found" would record a hex that is not on the workspace, and
   the sync would then spend the rest of the night suppressing an echo of a
   write that never landed. */

import { cmuxCommand, DEFAULT_CMUX_EXECUTABLE, executableMissing } from "./cmux";
import { BunCommandRunner } from "./command";
import { normalizeHex } from "../shared/repo-color";
import type { CommandRunner } from "./types";

const WRITE_TIMEOUT_MS = 10_000;

interface FunnelConfig {
  runner: CommandRunner;
  executable: string;
  log: (message: string) => void;
}

const config: FunnelConfig = {
  runner: new BunCommandRunner(),
  executable: DEFAULT_CMUX_EXECUTABLE,
  log: (message) => console.error(message),
};

/* Keyed by workspace id, holding the NORMALIZED hex. Process-lifetime memory,
   deliberately not persisted: the point is "did this process just write that",
   and a restart has written nothing. */
const lastWritten = new Map<string, string>();

/** Point the funnel at a runner/executable. Called once at boot; tests use it
 *  to drive the real bodies against a fake runner. */
export function configureCmuxColor(options: Partial<FunnelConfig>): void {
  Object.assign(config, options);
}

/** Forget every recorded write. Test seam — a shared module with process-wide
 *  memory needs one, or test order decides test outcome. */
export function resetCmuxColorMemory(): void {
  lastWritten.clear();
}

/** Echo suppression for TINT-S: last hex this process wrote to a workspace, or null. */
export function lastWrittenHex(workspaceId: string): string | null {
  return lastWritten.get(workspaceId) ?? null;
}

interface WriteOutcome {
  ok: boolean;
  detail: string;
}

async function write(args: readonly string[]): Promise<WriteOutcome> {
  const result = await config.runner.run(cmuxCommand(config.executable, args), WRITE_TIMEOUT_MS);
  if (executableMissing(result)) return { ok: false, detail: "cmux executable not found" };
  if (result.timedOut) return { ok: false, detail: `timed out after ${WRITE_TIMEOUT_MS}ms` };
  if (result.exitCode !== 0) {
    return { ok: false, detail: `exited ${result.exitCode}: ${result.stderr.trim() || "no stderr"}` };
  }
  /* Exit 0 WITH stderr is still a failure here. cmux reports several refusals
     ("Error: not_found: …") on stderr while the CLI itself exits clean, and a
     funnel that reads only the exit code records a colour that is not on the
     surface. */
  const stderr = result.stderr.trim();
  if (stderr) return { ok: false, detail: `exited 0 but reported: ${stderr}` };
  return { ok: true, detail: "" };
}

/** Set a workspace's colour. Records the hex for echo suppression only on a
 *  verified-clean write; returns false — loudly, on stderr — on any failure. */
export async function setWorkspaceColor(
  workspaceId: string,
  hex: string,
  reason: string,
): Promise<boolean> {
  const normalized = normalizeHex(hex);
  if (!workspaceId || !normalized) {
    config.log(`[cmux-color] refused workspace write (${reason}): bad workspace id or hex ${String(hex)}`);
    return false;
  }
  const outcome = await write(
    ["workspace-action", "--action", "set-color", "--workspace", workspaceId, "--color", normalized],
  );
  if (!outcome.ok) {
    config.log(`[cmux-color] workspace ${workspaceId} → ${normalized} (${reason}) FAILED: ${outcome.detail}`);
    return false;
  }
  lastWritten.set(workspaceId, normalized);
  return true;
}

/** Set a sidebar group's colour (TINT-G). Group writes are not echo-suppressed:
 *  groups are mirrored FROM the board every pass and never read back as an
 *  operator's intent, so there is no loop for a memory to break. */
export async function setGroupColor(
  groupId: string,
  hex: string,
  reason: string,
): Promise<boolean> {
  const normalized = normalizeHex(hex);
  if (!groupId || !normalized) {
    config.log(`[cmux-color] refused group write (${reason}): bad group id or hex ${String(hex)}`);
    return false;
  }
  const outcome = await write(
    ["rpc", "workspace.group.set_color", JSON.stringify({ group_id: groupId, color: normalized })],
  );
  if (!outcome.ok) {
    config.log(`[cmux-color] group ${groupId} → ${normalized} (${reason}) FAILED: ${outcome.detail}`);
    return false;
  }
  return true;
}
