# Lane PHASE2-UI — Health Rail v2 fold-in (fenced, serial)

Mission: fold the standalone `section#heartbeat-tldr` into `section#health-rail` as the 60/40 TL;DR-left ribbon with chevron paging, per **Tasks 5–9** of `docs/superpowers/plans/2026-08-09-health-rail-tldr-v2-implementation.md`, executed in order as one contiguous run, RED test first per task, one commit per task. Task 10 (render evidence) is integrator-owned — stop after Task 9's floor.

Read first, in order:
1. `docs/programs/health-rail-v2-2026-08-09/GROUND-RULES.md` — git discipline, lane report first, silent traps. **Floor update:** fails are allowed ONLY in `tests/cross-source-token-agreement.test.ts` (foreign OBB; its count varies with their live repair — record what you see, touch nothing there).
2. The plan's Tasks 5–9 (they contain test code, implementation code, and commit messages).
3. `docs/superpowers/specs/2026-08-09-health-rail-tldr-v2-design.md` — the contract.
4. `docs/rhs-shots/health-rail-tldr-fold-in/mockup-v2.html` — the visual truth; port its lane/readings/chip/pager CSS into `styles.css` using the app's existing custom properties.

Already landed for you to consume (do NOT re-implement):
- `tldrMarkupNodes` from `./tldr-markup.js` (P2) — the ONLY way writer text becomes nodes.
- `TLDR_VIEW_KEY` from `./client-catalogs.js` (P3).
- `tests/helpers/fake-dom.ts` (P2) — extend it with `setupRailDom`/fixture builders per plan Task 6; do not fork a second harness.
- The Task Widget anatomy and chat feed landed in `app.js`/`styles.css` — your diff sits on top; locate render code by symbol (`renderHealthRail`, `renderHeartbeatTldr`, `heartbeatTldrAgent`), never by plan line numbers.

Fence you own (exclusively, until you report done): `src/web/app.js`, `src/web/styles.css`, `src/web/index.html`, `src/web/client-catalogs.js`, `tests/web-client.test.ts` (minimal — only assertions your diff breaks), `tests/health-rail-v2.test.ts` (new), `tests/helpers/fake-dom.ts` (extend).

The one invariant that must survive every decision: `#cleanup-status` (index.html, aria-live) must NEVER be rebuilt by a paint. That is why Task 6 makes the two-child ribbon a STATIC skeleton in index.html and `renderHealthRail` empties only `#readings-grid` while `renderHealthTldrLane` empties only `#health-tldr-lane`. If you find yourself rebuilding the columns in JS, stop and re-read Task 6.

Definition of Done: plan Tasks 5–9 checkboxes done, one commit each with the plan's commit messages; `bunx tsc --noEmit` clean; full `bun test` green except the foreign OBB file; `LANE-REPORT-phase2.md` section 4 holds pasted floor output. Commit locally path-scoped, never push, never amend. Do not end your turn to check in; keep going until DoD or genuinely blocked.
