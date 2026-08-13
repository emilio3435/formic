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

export interface ActionResult {
  ok: boolean;
  /** cmux's refusal class when !ok, e.g. "invalid_state". */
  code?: string;
  detail?: string;
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
  void workspaceId; void title; void reason;
  return unimplemented("SYNC-RB"); // SYNC-RB
}
