# SYNC — Formic ⇄ cmux Two-Way Action Sync · Master Plan

> **For agentic workers:** execute ONLY your own kickoff (`KICKOFF-<lane>.md`) plus `02-GROUND-RULES.md`. This file is the shared map; your kickoff is your orders.
>
> **Spec:** `docs/superpowers/specs/2026-08-13-cmux-two-way-sync-design.md` — probe-verified 2026-08-13; its Locked Decisions and Probe Evidence tables govern. The plan argues from the spec; read both.
> Orchestrator: **Fable 5** (this session, `FORMIC · orch`) — orchestrates only: contract stub, merges, floor runs, deploy, sweep. A lane running Fable is a launch error.

**Goal:** Event-driven bidirectional sync of close, notification-clear (+ board-local Ack), and rename between the board and cmux, per the spec's locked decisions.

**Architecture:** One event-subscription module (Phase 0, serial-first) feeds a registration-seam router; one action funnel carries every board→cmux write with echo suppression keyed on cmux's `*_requested` event echoes; three parallel phase-pairs (BE + FE per phase) build close, notifications, rename against a frozen contract.

**Tech stack:** Bun + TypeScript server (`src/server`), vanilla JS board (`src/web/app.js` + `styles.css`, strict CSP — no inline styles), `bun test`, cmux socket CLI/RPC.

## Global constraints

- Locked decisions 1–4 from the spec override everything; the spec's Traps table is mandatory reading (all live-verified tonight).
- Floor everywhere: `bunx tsc --noEmit` → 0 · `bun test` → green; the ONLY tolerated red is `tests/cross-source-token-agreement.test.ts` (fleet-dependent canary, >20 join floor). Paste output, never paraphrase.
- Every cmux mutation goes through `src/server/cmux-actions.ts` (the funnel). No lane shells `cmux` mutating commands directly. Failure honesty: stderr/non-zero/`invalid_state` never surfaces as success.
- All `workspace.list`/`workspace.group.list` walks enumerate `window.list` — window-scoped lists are the trap that bit the master live during probes.
- Sync code never calls `notification.create*`, never sends `all`/`all_read` variants, never closes/renames group-anchor workspaces (TINT anchor rules hold).
- Badge actions never suppress board attention derived from live state; Ack is board-local and self-revoking (spec Phase 2).
- Mutating routes: same-origin loopback, like every sibling.

## Worker stack — PER-RUN DIRECTIVE (Emilio, 2026-08-13 03:29, overrides the standing table)

| Work | Model · vehicle | Launch |
|---|---|---|
| Orchestrator | Fable 5 (this session) | — |
| FE lanes (CF, NF, RF) | **Opus 5 high · Claude Code** | `claude --model opus --effort high --permission-mode auto "<kickoff>"` |
| BE lanes (E, CB, NB, RB) | **GPT 5.6 Sol xhigh · Codex** | `codex -m gpt-5.6-sol -c model_reasoning_effort="xhigh" -a never -s workspace-write "<kickoff>"` |
| Everything else (verification, exploration, PR babysit) | **Grok 4.6 xhigh · Cursor Agent** | `cursor-agent --model cursor-grok-4.6-xhigh --force --trust "<one-line brief-file pointer>"` |

Emilio said "Grok 4.6 Xhigh Fast": the known cursor model string is `cursor-grok-4.6-xhigh`; if `cursor-agent` exposes a distinct `-fast` variant at spawn time, prefer it and record which ran. Verify model AND vehicle on the live process (`ps -o args= -p <pid>`) for every lane; a bare `claude` inherits Fable — always pin. Grok/verify prompts go in brief FILES with a one-line spawn command (inline kickoff-length prompts truncate and strand the shell at `dquote>` — cost us a round tonight). Codex lanes usually cannot commit in linked worktrees: finished work arrives as dirt + report; the master commits it with a message saying so. Codex quota-stall: respawn the lane on Grok 4.6 xhigh without asking.

## Contract (frozen before fan-out; master commits stub as integration branch's first commit)

```ts
// src/server/cmux-sync.ts — CONTRACT STUB (master). SYNC-E implements the
// subscription/router internals; other lanes ONLY register handlers/consume types.

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
/** Registration seam (TINT-G pattern): phases register; E owns dispatch. */
export declare function registerSyncHandler(name: string, handler: SyncHandler): () => void;
/** True while the stream is connected and gap-free; gap/reconnect → E triggers full recollect. */
export declare function syncStreamHealthy(): boolean;
```

```ts
// src/server/cmux-actions.ts — CONTRACT STUB (master). The one funnel.
// Master commits skeleton with fingerprinting; lanes implement their verbs.

export interface ActionResult { ok: boolean; /** cmux's refusal class when !ok, e.g. "invalid_state" */ code?: string; detail?: string; }

export declare function closeSurface(surfaceId: string, reason: string): Promise<ActionResult>;      // SYNC-CB
export declare function closeWorkspace(workspaceId: string, reason: string): Promise<ActionResult>;  // SYNC-CB
export declare function markNotificationRead(id: string): Promise<ActionResult>;                      // SYNC-NB
export declare function dismissNotification(id: string): Promise<ActionResult>;                       // SYNC-NB
export declare function renameWorkspace(workspaceId: string, title: string, reason: string): Promise<ActionResult>; // SYNC-RB
/** Echo suppression: true if this event is the echo of an action this process issued recently. */
export declare function isOwnEcho(event: { name: string; payload: Record<string, unknown> }): boolean;
```

```ts
// src/shared/types.ts additions (master stub; exact keys frozen)
export interface AgentAck { agentId: string; ackedAt: string; alertFingerprint: string; }
export interface CmuxNotificationSummary {
  id: string; workspaceId: string; surfaceId: string;
  title: string; subtitle: string; body: string; isRead: boolean; createdAt: string;
}
```

Routes (shapes frozen; implementations per lane):
- `POST /api/sync/close` `{ target: "surface"|"workspace", id: string }` → `ActionResult` + on `code:"invalid_state"` (last surface) the response includes `escalation: { workspaceId, siblingAgents: {id, name}[] }` (SYNC-CB).
- `POST /api/sync/notifications` `{ action: "mark_read"|"dismiss", id: string }` (SYNC-NB).
- `PUT /api/sync/ack/:agentId` · `DELETE /api/sync/ack/:agentId` (SYNC-NB).
- `POST /api/sync/rename` `{ workspaceId: string, title: string }` (SYNC-RB).

## Fences

| Lane | Model | Owns |
|---|---|---|
| SYNC-E | Sol | `src/server/cmux-sync.ts` (implement), multi-window fix in `src/server/cmux.ts` collector walks, live→ended liveness handlers + one marked registration in `state.ts` (`/* SYNC-E */`), tests |
| SYNC-CB | Sol | close verbs in `cmux-actions.ts`, `/api/sync/close` route in the marked `/* SYNC routes */` block, sibling-agent enumeration for escalation, `workspace.closed`/`surface.closed` handler registration, tests |
| SYNC-CF | Opus | row/drawer close affordance in `src/web/app.js`, exact-resolution gating, escalation confirm dialog (names siblings, states non-undoable), `styles.css` additions, tests |
| SYNC-NB | Sol | notification ingest (list-based) into snapshot, notification verbs in funnel, `/api/sync/notifications` + ack routes, `JsonAckStore` + fingerprint/self-revoke logic, event handler registrations, tests |
| SYNC-NF | Opus | badge rendering (rows + notifications dropdown, minimal — no redesign), clear verbs UI, Ack button + acked mark + strip filtering, tests |
| SYNC-RB | Sol | rename verb + pin rules in funnel, `/api/sync/rename`, `workspace.renamed` patch handler, tests |
| SYNC-RF | Opus | inline rename affordance (drawer session header; tab titles where shown), tests |
| Master | — | both contract stubs + route-block marker, merges, floor, deploy, sweep |

Registration-line and `ARCHITECTURE.md` collisions resolve in the later branch, never by hand-stitching (three lanes will touch `ARCHITECTURE.md`; `tests/reference-docs.test.ts` forces it — that is in-fence for every lane adding a server module).

## Dependency edges & merge order

```
contract stubs (master, first commits)
   └─→ SYNC-E lands ALONE (serial-first; its seams are load-bearing)
         ├─→ SYNC-CB ─→ SYNC-CF   (CF consumes CB's route shapes; both build vs stubs immediately,
         ├─→ SYNC-NB ─→ SYNC-NF    FE lanes integrate for real after their BE half merges)
         └─→ SYNC-RB ─→ SYNC-RF
```

All six phase lanes SPAWN together after E merges; BE and FE halves of a phase share nothing on disk, so they build in parallel — the arrow is merge order only. Merge: **E → CB → CF → NB → NF → RB → RF**, master runs the floor after each. Every lane gets a Grok verification pass (brief file, VERDICT line) before its merge; BLOCK verdicts reopen the lane, TINT protocol.

## Verification & deploy (master)

- Per-merge floor + named-fail check (the count is not evidence; the name is).
- Live checks after full merge, on a side port first: create/rename/close a disposable workspace and watch the board react within one event round-trip; clear a real notification from the board and confirm `is_read` via `notification.list`; rename from both sides and confirm no loop in 3 poll cycles (funnel log shows zero re-writes).
- Eyes-on screenshots read by the master. Deploy honors serving-topology rules: check who holds 4701 before any kickstart; bump `?v=ah-tN`; if `the-mountain-main` is dirty/on someone's branch again, side-port deploy + cutover rides the PR (tonight's precedent).
- Push + PR only on Emilio's word (no standing approval has been given for SYNC).

## Sweep

`SYNC · ` prefix on every workspace; lane worktrees `../the-mountain.worktrees/sync-<lane>`, branches `feat/sync-<lane>`, integration `feat/sync-integration` from `main` (rebase onto merged TINT if PR #47 lands first — the funnel pattern files collide by design; SYNC's `cmux-actions.ts` is new and TINT's `cmux-color.ts` is untouched, so expect clean coexistence). Archive `LANE-REPORT-*` + `VERIFY-*` to `docs/programs/sync/` before removing worktrees.
