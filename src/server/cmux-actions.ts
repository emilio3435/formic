/* SYNC — the action funnel. Contract stub (master); shapes frozen by
   docs/superpowers/plans/2026-08-13-sync/00-MASTER-PLAN.md §Contract.

   EVERY board→cmux mutation in this program goes through here — close
   (SYNC-CB), notification clear (SYNC-NB), rename (SYNC-RB). Nothing shells a
   mutating cmux command directly. The pattern is TINT's cmux-color funnel
   generalized, and it is one door for the same two reasons:

   Echo suppression. Every RPC we issue comes back off the event stream as a
   `*_requested` event with the params embedded (probe-verified 2026-08-13).
   Without a memory of what THIS process just wrote, the sync reads its own
   write as foreign drift and answers it — the write loop. `isOwnEcho` is that
   memory, and it only works if every write records itself here.

   Failure honesty. stderr, non-zero exit, or a typed refusal
   (`invalid_state`) is a FAILURE — surfaced in the ActionResult, never
   smoothed into success. TINT precedent: a wrong param name was ACCEPTED with
   exit 0 and changed nothing.

   Master commits the skeleton with fingerprinting; each lane implements its
   own verbs and nothing else (fences in the master plan). */

import {
  cmuxCommand,
  DEFAULT_CMUX_EXECUTABLE,
  executableMissing,
  parseCmuxWindowIds,
} from "./cmux";
import { BunCommandRunner } from "./command";
import type { CommandResult, CommandRunner } from "./types";

export interface ActionResult {
  ok: boolean;
  /** cmux's refusal class when !ok, e.g. "invalid_state". */
  code?: string;
  detail?: string;
}

const ACTION_TIMEOUT_MS = 10_000;

export interface RenameWorkspaceTarget {
  title?: string;
  anchor: boolean;
}

interface WorkspaceLookupFailure {
  error: ActionResult;
}

type ResolveWorkspace = (
  workspaceId: string,
) => Promise<RenameWorkspaceTarget | WorkspaceLookupFailure | undefined>;

interface CmuxActionsConfig {
  runner: CommandRunner;
  executable: string;
  log: (message: string) => void;
  resolveWorkspace: ResolveWorkspace;
}

const config: CmuxActionsConfig = {
  runner: new BunCommandRunner(),
  executable: DEFAULT_CMUX_EXECUTABLE,
  log: (message) => console.error(message),
  resolveWorkspace: resolveWorkspaceFromCmux,
};

/** Point the shared funnel at the process runner. Tests also inject the current
 *  workspace reading so trim-identical and anchor refusals prove zero calls. */
export function configureCmuxActions(options: Partial<CmuxActionsConfig>): void {
  Object.assign(config, options);
}

/* ---------------------------------------------------------------- echoes --- */

/* Issued-action fingerprints live for a bounded window: long enough for the
   event round-trip (<2s measured), short enough that a stale entry cannot
   swallow a genuinely foreign action minutes later. Process-lifetime and
   deliberately not persisted — the question is "did this process just write
   that", and a restarted process has written nothing. */
const FINGERPRINT_WINDOW_MS = 10_000;
const FINGERPRINT_CAP = 256;

interface IssuedAction {
  method: string;
  params: Record<string, unknown>;
  at: number;
}

const issued: IssuedAction[] = [];

/** Record a verified-clean write for echo suppression. Lanes call this from
 *  their verbs ONLY after the write is known good — a fingerprint for a write
 *  that never landed suppresses a real foreign action. */
export function recordIssuedAction(
  method: string,
  params: Record<string, unknown>,
  at: number = Date.now(),
): void {
  issued.push({ method, params, at });
  if (issued.length > FINGERPRINT_CAP) issued.splice(0, issued.length - FINGERPRINT_CAP);
}

/** Forget every recorded write. Test seam — a shared module with process-wide
 *  memory needs one, or test order decides test outcome. */
export function resetCmuxActionsMemory(): void {
  issued.length = 0;
}

/* An echo names its RPC either in the event name (`notification.mark_read_requested`
   → `notification.mark_read`) or in an embedded `method` field
   (`workspace.renamed` carries method+params — probe-verified). Params ride in
   `payload.params` when present, else the payload itself. */
function echoMethod(event: { name: string; payload: Record<string, unknown> }): string {
  if (typeof event.payload.method === "string") return event.payload.method;
  return event.name.endsWith("_requested") ? event.name.slice(0, -"_requested".length) : event.name;
}

function echoParams(event: { payload: Record<string, unknown> }): Record<string, unknown> {
  const params = event.payload.params;
  if (params && typeof params === "object" && !Array.isArray(params)) {
    return params as Record<string, unknown>;
  }
  return event.payload;
}

/** Echo suppression: true if this event is the echo of an action this process
 *  issued recently. Match = same method, and every param we sent appears in
 *  the echo with the same value (the echo may carry MORE — result fields,
 *  server-added context — so subset, not equality). */
export function isOwnEcho(
  event: { name: string; payload: Record<string, unknown> },
  at: number = Date.now(),
): boolean {
  while (issued.length > 0 && at - issued[0].at > FINGERPRINT_WINDOW_MS) issued.shift();
  const method = echoMethod(event);
  const params = echoParams(event);
  return issued.some((action) => {
    if (action.method !== method) return false;
    return Object.entries(action.params).every(
      ([key, value]) => JSON.stringify(params[key]) === JSON.stringify(value),
    );
  });
}

/* ----------------------------------------------------------------- verbs --- */

/* Bodies are lane work — the stub refuses honestly rather than pretending.
   An unimplemented verb that returned ok would be the quiet false positive
   this whole file exists to prevent. */
function unimplemented(lane: string): ActionResult {
  return { ok: false, code: "unimplemented", detail: `${lane} implements this verb` };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(record(entry)))
    : [];
}

function resultRecord(stdout: string): Record<string, unknown> {
  const parsed = JSON.parse(stdout) as unknown;
  const root = record(parsed);
  if (!root) throw new Error("cmux response was not an object");
  return record(root.result) ?? root;
}

function stringValue(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function typedFailure(text: string, fallbackCode = "cmux_error"): ActionResult {
  const detail = text.trim() || "cmux refused the request";
  const typed = /^(?:error:\s*)?([a-z][a-z0-9_]*):\s*(.+)$/i.exec(detail);
  if (typed) return { ok: false, code: typed[1]!.toLowerCase(), detail: typed[2]!.trim() };
  if (/not[_ ]found/i.test(detail)) return { ok: false, code: "not_found", detail };
  return { ok: false, code: fallbackCode, detail };
}

function stdoutFailure(stdout: string): ActionResult | undefined {
  if (!stdout.trim()) return undefined;
  try {
    const root = record(JSON.parse(stdout));
    if (!root || root.error === undefined) return undefined;
    if (typeof root.error === "string") return typedFailure(root.error);
    const error = record(root.error);
    const code = stringValue(error?.code, error?.type) ?? "cmux_error";
    const detail = stringValue(error?.message, error?.detail) ?? JSON.stringify(root.error);
    return { ok: false, code, detail };
  } catch {
    return undefined;
  }
}

function commandFailure(result: CommandResult): ActionResult | undefined {
  if (executableMissing(result)) {
    return { ok: false, code: "unavailable", detail: "cmux executable not found" };
  }
  if (result.timedOut) {
    return { ok: false, code: "timeout", detail: `timed out after ${ACTION_TIMEOUT_MS}ms` };
  }
  if (result.exitCode !== 0) {
    return typedFailure(result.stderr, "cmux_error");
  }
  if (result.stderr.trim()) return typedFailure(result.stderr);
  return stdoutFailure(result.stdout);
}

async function runCmux(args: readonly string[]): Promise<{
  result: CommandResult;
  failure?: ActionResult;
}> {
  const result = await config.runner.run(cmuxCommand(config.executable, args), ACTION_TIMEOUT_MS);
  return { result, failure: commandFailure(result) };
}

export async function resolveWorkspaceFromCmux(
  workspaceId: string,
): Promise<RenameWorkspaceTarget | WorkspaceLookupFailure | undefined> {
  const windows = await runCmux(["rpc", "window.list", "{}"]);
  if (windows.failure) return { error: windows.failure };
  let windowIds: string[];
  try {
    windowIds = parseCmuxWindowIds(windows.result.stdout);
  } catch (error) {
    return {
      error: {
        ok: false,
        code: "invalid_response",
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }

  let found: RenameWorkspaceTarget | undefined;
  for (const windowId of windowIds) {
    const [workspaceList, groupList] = await Promise.all([
      runCmux(["rpc", "workspace.list", JSON.stringify({ window_id: windowId })]),
      runCmux(["rpc", "workspace.group.list", JSON.stringify({ window_id: windowId })]),
    ]);
    if (workspaceList.failure || groupList.failure) {
      return { error: workspaceList.failure ?? groupList.failure! };
    }
    try {
      const groups = records(resultRecord(groupList.result.stdout).groups);
      if (groups.some((group) =>
        stringValue(group.anchor_workspace_id, group.anchorWorkspaceId) === workspaceId)) {
        return { anchor: true };
      }
      const workspaces = records(resultRecord(workspaceList.result.stdout).workspaces);
      const workspace = workspaces.find((entry) =>
        stringValue(entry.id, entry.workspace_id, entry.workspaceId) === workspaceId);
      if (workspace) {
        found = {
          anchor: false,
          title: stringValue(workspace.title, workspace.workspace_title, workspace.workspaceTitle),
        };
      }
    } catch (error) {
      return {
        error: {
          ok: false,
          code: "invalid_response",
          detail: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
  return found;
}

export async function closeSurface(surfaceId: string, reason: string): Promise<ActionResult> {
  void surfaceId; void reason;
  return unimplemented("SYNC-CB"); // SYNC-CB
}

export async function closeWorkspace(workspaceId: string, reason: string): Promise<ActionResult> {
  void workspaceId; void reason;
  return unimplemented("SYNC-CB"); // SYNC-CB
}

export async function markNotificationRead(id: string): Promise<ActionResult> {
  void id;
  return unimplemented("SYNC-NB"); // SYNC-NB
}

export async function dismissNotification(id: string): Promise<ActionResult> {
  void id;
  return unimplemented("SYNC-NB"); // SYNC-NB
}

export async function renameWorkspace(
  workspaceId: string,
  title: string,
  reason: string,
): Promise<ActionResult> {
  const normalizedWorkspaceId = workspaceId.trim();
  const normalizedTitle = title.trim();
  if (!normalizedWorkspaceId) return { ok: false, code: "invalid_workspace" };
  if (!normalizedTitle) return { ok: false, code: "invalid_title" };

  const workspace = await config.resolveWorkspace(normalizedWorkspaceId);
  if (workspace && "error" in workspace) return workspace.error;
  if (!workspace) return { ok: false, code: "not_found" };
  if (workspace.anchor) return { ok: false, code: "anchor" };
  if (workspace.title?.trim() === normalizedTitle) return { ok: true };

  const params = { workspace_id: normalizedWorkspaceId, title: normalizedTitle };
  const outcome = await runCmux(["rpc", "workspace.rename", JSON.stringify(params)]);
  if (outcome.failure) {
    config.log(
      `[cmux-actions] workspace ${normalizedWorkspaceId} rename (${reason}) FAILED: `
      + `${outcome.failure.code ?? "cmux_error"}: ${outcome.failure.detail ?? "no detail"}`,
    );
    return outcome.failure;
  }
  recordIssuedAction("workspace.rename", params);
  return { ok: true };
}
