/* SYNC — contract stub (master). Frozen by
   docs/superpowers/plans/2026-08-13-sync/00-MASTER-PLAN.md §Contract.

   SYNC-E implements the subscription/router internals in THIS file: the
   long-lived `cmux events --after <cursor>` child, seq tracking, gap-safe
   recollect, and dispatch. Every other lane ONLY registers handlers through
   `registerSyncHandler` and consumes the exported types — the seam is the
   TINT-G registration pattern, so phases stay fence-clean.

   NOTE (master, 2026-08-13): `src/server/cmux-events.ts` already supervises a
   `cmux events` child as a poll accelerator with its own cursor file
   (`~/.anthill/events.cursor`). This module is the TYPED dispatch router and
   must coexist with it — own cursor persistence, never that file. SYNC-E
   decides reuse-vs-parallel-child and records the choice in its report. */

/** Event names verified live 2026-08-13 (spec Probe Evidence). */
export type CmuxSyncEventName =
  | "workspace.created" | "workspace.renamed" | "workspace.closed"
  | "surface.created" | "surface.closed"
  | "notification.created" | "notification.read" | "notification.removed";

export interface CmuxSyncEvent {
  seq: number;
  name: CmuxSyncEventName | (string & {});
  /** Raw payload; notification bodies are REDACTED in events — fetch via notification.list. */
  payload: Record<string, unknown>;
}

export type SyncHandler = (event: CmuxSyncEvent) => void | Promise<void>;

/* The registry is live from the stub onward so phase lanes can register and
   test against it before SYNC-E's stream lands. Dispatch order inside one
   event name is registration order; SYNC-E's dispatcher must preserve that. */
const handlers = new Map<string, Set<SyncHandler>>();

/** Registration seam (TINT-G pattern): phases register; SYNC-E owns dispatch.
 *  Returns the unregister function. */
export function registerSyncHandler(name: string, handler: SyncHandler): () => void {
  let set = handlers.get(name);
  if (!set) {
    set = new Set();
    handlers.set(name, set);
  }
  set.add(handler);
  return () => {
    set.delete(handler);
    if (set.size === 0) handlers.delete(name);
  };
}

/** Handlers registered for an event name, in registration order. SYNC-E's
 *  dispatcher reads through this; tests may use it to assert registration. */
export function syncHandlersFor(name: string): readonly SyncHandler[] {
  return [...(handlers.get(name) ?? [])];
}

/** True while the stream is connected and gap-free; gap/reconnect → SYNC-E
 *  triggers full recollect. Stub answer is false: no stream exists yet, and a
 *  stub that claimed health would let a consumer trust patches nobody sends. */
export function syncStreamHealthy(): boolean {
  return false;
}
