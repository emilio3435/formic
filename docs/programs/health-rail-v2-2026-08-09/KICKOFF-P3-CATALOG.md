# Lane P3 — TL;DR view persistence key

Mission: one exported constant so the health rail's selected TL;DR view persists per-browser. This is **Task 3** of `docs/superpowers/plans/2026-08-09-health-rail-tldr-v2-implementation.md` — execute exactly that task's steps (RED test first), nothing more. It is deliberately tiny; do not grow it.

Read first: `docs/programs/health-rail-v2-2026-08-09/GROUND-RULES.md` (your fence is row P3), then the plan's Task 3, then `src/web/client-catalogs.js` around `CONTEXT_SPREAD_KEY` / `NEEDS_YOU_DISPLAY_KEY` (match their comment style: a display preference, per-browser, not a fact about the fleet).

Non-negotiables:
- `export const TLDR_VIEW_KEY = "mtn3-tldr-view";` in `src/web/client-catalogs.js`.
- Test in `tests/health-rail-v2-catalog.test.ts` (your file; the plan has the code).
- Do NOT add Mix/Spend catalog entries — those land with the serial Phase-2 lane so the customizer never offers a widget that cannot render.

Definition of Done: plan Task 3 checkboxes done; floor green per ground rules (3 foreign OBB reds only); one local commit `feat(web): TLDR view persistence key` scoped to exactly your fence row; lane report section 4 holds pasted floor output. Commit locally, never push.
