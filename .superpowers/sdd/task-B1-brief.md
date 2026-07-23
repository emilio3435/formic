# Task B1: Backend contract for the inspector revamp (Codex GPT-5.6-Luna MAX)

**Work in:** `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-inspector-totem` — a fresh worktree on branch `ant-hill/luna-inspector-totem-20260722`, cut from `main` at `00f4bf0` (the merged Pulse strip). Deps installed, `bun run check` green at 237 tests. Do all work and all commits THERE — never in `~/Developer/anthill-pulse` (its footer state in your terminal is stale; that lane is landed and retired for writes).

**Files:**
- Modify: `src/shared/types.ts`, `src/server/app.ts`, `src/server/state.ts`
- Test: `tests/state-health.test.ts` (+ the app-route test file if one covers routes)

**Produces (the contract the frontend tasks B2/B3 consume — exact names):**
- `SourceHealth.lastHealthyAt: string | null` — ISO timestamp on the existing per-source health objects in `src/shared/types.ts`; set on every successful collect of that source; null before first success; PRESERVED (not reset) when a later collect of that source fails.
- `POST /api/recollect` — triggers one full collector run and responds with the fresh decorated snapshot (same response shape as `GET /api/snapshot`). Concurrency: **single-flight coalescing** — concurrent POSTs await the same in-flight collect and all receive the same fresh snapshot. (The plan file elsewhere mentions a 503-if-in-flight variant; that is superseded — coalesce, no 503. Controller decision 2026-07-23.)

**Why:** these close the two known gaps flagged during the canvas work — the UI's Refresh only re-serves the cached snapshot, and a degraded verdict cannot say "since when."

## Steps (TDD)

1. Write failing tests first: (a) `lastHealthyAt` is set on successful collect; (b) it survives a subsequent failed collect of the same source; (c) `POST /api/recollect` returns a snapshot-shaped body with fresh data; (d) two concurrent recollect calls coalesce into one collector run (assert the collector ran once).
2. `bun run check` → confirm the new tests FAIL for the right reason.
3. Implement: timestamp in `src/server/state.ts` where per-source collect success is recorded; single-flight recollect (one shared in-flight promise) + route in `src/server/app.ts`; type in `src/shared/types.ts`.
4. `bun run check` → all green (237 existing + yours). No changes to `src/web/` or `tests/web-client.test.ts`.
5. Commit on the lane branch: `feat(server): per-source lastHealthyAt + POST /api/recollect` (body: why + the coalesce decision). NEVER push; never touch `main`.
6. Write your completion report to `/Users/emilionunezgarcia/Developer/the-mountain-main/.superpowers/sdd/task-B1-report.md`: exact final type shape, route request/response contract incl. error behavior, files changed, test names + `bun run check` tail, any concerns. The frontend implementers read this file as the contract — precision over prose.

## Constraints

- Match existing code conventions in `src/server` (module style, error handling, naming). Follow how `snapshot.ts`/`state.ts` already structure collect + decoration — read before writing.
- Keep it minimal: no extra endpoints, no config, no speculative fields.
- If something in the existing collect flow makes the contract ambiguous (e.g. where "per-source success" is recorded), state your assumption in the report rather than silently choosing.
