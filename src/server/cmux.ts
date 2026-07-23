import { cmuxCommand } from "./cmux-auth";
import type { CmuxNotification, CollectionResult, CmuxSurface, CommandRunner } from "./types";

export const DEFAULT_CMUX_EXECUTABLE =
  "/Applications/cmux.app/Contents/Resources/bin/cmux";

export function runtimeCmuxExecutable(value = process.env.CMUX_EXECUTABLE): string {
  return value?.trim() || DEFAULT_CMUX_EXECUTABLE;
}

export { cmuxCommand, cmuxSocketPassword, loadCmuxSocketEnv, runningInsideCmux } from "./cmux-auth";

function stringValue(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

// cmux prefixes a surface title with a live status glyph/spinner (braille frames
// like ⠂, or ▪/●) while the terminal is active. That glyph is machinery, not the
// operator's rename — strip any leading non-alphanumeric run before the name.
function cleanSurfaceTitle(...values: unknown[]): string | undefined {
  const raw = stringValue(...values);
  if (!raw) return undefined;
  const cleaned = raw.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

export function parseCmuxTerminals(output: string): CmuxSurface[] {
  const parsed = JSON.parse(output);
  const terminals = parsed?.terminals ?? parsed?.result?.terminals;
  if (!Array.isArray(terminals)) throw new Error("cmux response did not contain a terminals array");

  return terminals.flatMap((terminal: Record<string, unknown>) => {
    const surfaceId = stringValue(terminal.surface_id, terminal.surfaceId);
    if (!surfaceId) return [];
    const sourceSessionIds = [
      terminal.session_id,
      terminal.agent_session_id,
      terminal.source_session_id,
      terminal.codex_session_id,
      terminal.claude_session_id,
      terminal.omp_session_id,
      terminal.cursor_session_id,
    ].filter((value): value is string => typeof value === "string" && value.length > 0);
    return [{
      surfaceId,
      workspaceId: stringValue(
        terminal.workspace_id,
        terminal.workspaceId,
        terminal.last_known_workspace_id,
      ),
      paneId: stringValue(terminal.pane_id, terminal.paneId),
      cwd: stringValue(terminal.current_directory, terminal.cwd),
      workspaceTitle: stringValue(terminal.workspace_title, terminal.workspaceTitle),
      title: cleanSurfaceTitle(terminal.surface_title, terminal.surfaceTitle),
      branch: stringValue(terminal.git_branch, terminal.branch),
      dirty: typeof terminal.git_dirty === "boolean" ? terminal.git_dirty : undefined,
      head: stringValue(terminal.git_head, terminal.head),
      tty: stringValue(terminal.tty, terminal.terminal_tty),
      runtimeSurfaceReady: typeof terminal.runtime_surface_ready === "boolean"
        ? terminal.runtime_surface_ready
        : undefined,
      sourceSessionIds: [...new Set(sourceSessionIds)],
    }];
  });
}

export async function collectCmux(
  runner: CommandRunner,
  executable = DEFAULT_CMUX_EXECUTABLE,
): Promise<CollectionResult<CmuxSurface[]>> {
  const result = await runner.run(cmuxCommand(executable, ["rpc", "debug.terminals", "{}"]), 10_000);
  if (result.timedOut) return { value: [], errors: ["cmux terminal discovery timed out"] };
  if (result.exitCode !== 0) {
    return {
      value: [],
      errors: [`cmux terminal discovery exited ${result.exitCode}: ${result.stderr.trim() || "no stderr"}`],
    };
  }
  try {
    return { value: parseCmuxTerminals(result.stdout), errors: [] };
  } catch (error) {
    return {
      value: [],
      errors: [`cmux terminal discovery returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

export function parseCmuxNotifications(output: string): CmuxNotification[] {
  const parsed = JSON.parse(output);
  const notifications = Array.isArray(parsed) ? parsed : parsed?.notifications ?? parsed?.result?.notifications;
  if (!Array.isArray(notifications)) throw new Error("cmux response did not contain a notifications array");
  return notifications.flatMap((notification: Record<string, unknown>) => {
    const surfaceId = stringValue(notification.surface_id, notification.surfaceId);
    if (!surfaceId || notification.read === true || notification.is_read === true || notification.unread === false) return [];
    const createdAtRaw = stringValue(notification.created_at, notification.createdAt);
    const createdAt = createdAtRaw && Number.isFinite(Date.parse(createdAtRaw))
      ? new Date(createdAtRaw).toISOString()
      : new Date(0).toISOString();
    return [{
      id: stringValue(notification.id, notification.notification_id),
      surfaceId,
      workspaceId: stringValue(notification.workspace_id, notification.workspaceId),
      createdAt,
      title: stringValue(notification.title),
      subtitle: stringValue(notification.subtitle),
      body: stringValue(notification.body),
    }];
  });
}

export async function collectCmuxNotifications(
  runner: CommandRunner,
  executable = DEFAULT_CMUX_EXECUTABLE,
): Promise<CollectionResult<CmuxNotification[]>> {
  const result = await runner.run(cmuxCommand(executable, ["list-notifications", "--json"]), 10_000);
  if (result.timedOut) return { value: [], errors: ["cmux notification discovery timed out"] };
  if (result.exitCode !== 0) {
    return {
      value: [],
      errors: [`cmux notification discovery exited ${result.exitCode}: ${result.stderr.trim() || "no stderr"}`],
    };
  }
  try {
    return { value: parseCmuxNotifications(result.stdout), errors: [] };
  } catch (error) {
    return {
      value: [],
      errors: [`cmux notification discovery returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}
