# Lane P2 — TL;DR mini-markup allowlist module

Mission: a tokenizer that turns writer mini-markup (`*strong*`, `` `mono` ``, `!alert!`) into safe styled nodes — never an HTML parser, untrusted transcript text always travels through `textContent`. This is **Task 2** of `docs/superpowers/plans/2026-08-09-health-rail-tldr-v2-implementation.md` — execute exactly that task's steps (RED test first), nothing more.

Read first: `docs/programs/health-rail-v2-2026-08-09/GROUND-RULES.md` (your fence is row P2), then the plan's Task 2 (it contains the module code and both tests), then `tests/b2-render-proof.test.ts` top (the `makeNode`/`withDom` fake-DOM harness you extract into `tests/helpers/fake-dom.ts` — copy, do not edit b2's local copy; that file is P1-owned).

Non-negotiables:
- `src/web/tldr-markup.js` exports `tldrMarkupNodes(text): Node[]` built on `el()` from `./dom-primitives.js`.
- The hostile-input test must prove HTML renders as literal text (only SPAN/STRONG nodes ever created).
- Your tests live in `tests/health-rail-v2-markup.test.ts` (your file).
- `tests/helpers/fake-dom.ts` must export `withDom` plus reusable node builders — a later serial lane extends it, so keep it a clean module.

Definition of Done: plan Task 2 checkboxes done; floor green per ground rules (3 foreign OBB reds only); one local commit `feat(web): tldr mini-markup allowlist renderer` scoped to exactly your fence row; lane report section 4 holds pasted floor output. Commit locally, never push. Do not end your turn to check in; keep going until DoD or genuinely blocked.
