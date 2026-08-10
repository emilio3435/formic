# HANDOFF — Health Rail TL;DR Fold-In Design

**Worktree:** `/Users/emilionunezgarcia/Developer/the-mountain.worktrees/health-rail-tldr-design` (`design/health-rail-tldr-fold-in`)
**Latest committed mockup (closest so far, needs refining):** `/Users/emilionunezgarcia/Developer/the-mountain.worktrees/health-rail-tldr-design/docs/rhs-shots/health-rail-tldr-fold-in/mockup.html`
`file:///Users/emilionunezgarcia/Developer/the-mountain.worktrees/health-rail-tldr-design/docs/rhs-shots/health-rail-tldr-fold-in/mockup.html`
**Latest plan:** `/Users/emilionunezgarcia/Developer/the-mountain.worktrees/health-rail-tldr-design/docs/superpowers/plans/2026-08-09-health-rail-tldr-fold-in.md`
**Base:** `2b42537` — TLDR feature ancestor `0472d7c` (structured v3 per-repo cards, `a1a41ff` first fold-in)
**Current HEAD:** `4faf4529c8cb4e5676f0f277ff55138859b17e57` — `docs(design): reconcile Steps 1 and 3 to two-child rail-inner`
**Lane report (uncommitted, holds all SHAs + evidence):** `/Users/emilionunezgarcia/Developer/the-mountain.worktrees/health-rail-tldr-design/LANE-REPORT-health-rail-tldr.md`

**Status:** Closest mockup so far per user, but needs a lot of refining — handed over as authoritative starting point, not final.

---

## What you asked for — chronologically

1. Initial: Close standalone TLDR Cluster Summary panel into existing section#health-rail fleet-status ribbon — visually ugly, redundant, not shippable; full UX rethink for new ribbon position, not cosmetic patch. Success: change directory to worktree health-rail-tldr-design and prove pwd+git status; keep source read-only; exhaustively investigate health rail, rail header, health widgets, Customize summary flow, TLDR card parser/render, status ribbon layout, responsive breakpoints, accessibility/live-region, persisted widget ordering, CSP constraints, every relevant test with file:line citations; use target structure around section#health-rail as anchor; define hierarchy for Momentum/Burn/Context/scan window/customization/folded TLDR at desktop and 860px; show all meaningful states (useful summaries, no summaries, partial/stale, alerts, long names, many repos, customization open); produce exactly two committed design artifacts (plan + mockup) as high-fidelity responsive mockup eliminating standalone panel; create LANE-REPORT before artifacts, record SHA, not commit report; run git diff --check, one local docs-only commit; do not edit src/tests/config/services/OBB/browser or launch subagents/push/merge.

2. Correction 1: Make second docs-only correction, do not amend a1a41ff; fix git diff --check failures on plan lines 3-5 (trailing whitespace); correct base metadata to 2b42537 with 0472d7c as TLDR feature ancestor; replace 860px design that vertically expands every reading/repo into tall report with compact ribbon-native disclosure (compact readings grid plus Cluster summary headline, highest-attention repo, and explicit Show N repos 44px control that expands on demand); preserve real Context gauge, average/median toggle, subcopy; keep DOM order rail header → health widgets → cluster lane → widget customizer; fix list semantics so role=list directly owns listitem rows and lane heading outside list; choose one non-duplicative announcement contract for cluster changes and explain why not competing with cleanup-status; fix header garrit typo; keep long names/many repos/stale/alert/no-summary/customizer-open states; re-render mentally at 1440/860 (desktop one ribbon without ticker, 860 compact before expansion); update only two artifacts, run git diff --check a1a41ff..HEAD plus HTML sanity, one local docs-only follow-up commit; update LANE-REPORT with new SHA.

3. User: html is hideous. Keep working on the mock and stop drawing up the whole dashboard. Your changes pertain to the ribbon/health rail. Fix that. Then make sure cluster summary shows at most 1 or two repos at a time. TL;DR should be richer summary and text-based section that succinctly visually effuses what's going on with specific repo across all agents it manages.

4. Goal: Close TL;DR design lane with integration owner's actual render evidence for commit 7f49de6.

5. Update only uncommitted LANE-REPORT-health-rail-tldr.md.

6. Cite evidence paths /tmp/health-rail-7f49-1440.png and /tmp/health-rail-7f49-860.png.

7. Record observed results: 1440 is one compact ribbon with inline cluster lane; 860 is compact 2x2 readings grid; gauges remain bounded; one repo stays visible; Show 2 repos is visibly present; collapsed extras absent until expansion; standalone TL;DR panel is represented as removed.

8. Replace prior 'mentally re-rendered' limitation with actual integration-owned proof while preserving other verifier gaps honestly.

9. Leave product files, committed docs, tests, browser state, services, OBB, and history unchanged.

10. Stop when: uncommitted lane report contains two screenshot paths and honest docs-design READY verdict for 7f49de6, then remain idle for integration-owner review.

11. Goal revision: as a tile into the existing health and add chevrons to toggle between ALL (with comprehensive TL;DR) and repo-specific TL;DRs and stats on health rail. By this I mean: 1 ALL inclusive health rail with longer TL;DR per repo. Then with chevron toggles, filter to repo-specific TL;DR that's more tiled and include repo-specific deterministic info like momentum, burn, context, etc.

12. Follow-up: no— the TL;DR summary is now a TILE within the same rail as the deterministic info on the health rail. It sits besides that info, not under it. It can consume larger % of horizontal column width, given its importance. Other det info can be stacked or condensed to keep fitting nicely and not taking too much vertical space.

13. Goal: two column layout. 60% for Summary/TL;DR prose/detail. 40% for deterministic info. One ROW.

14. User: lol that's no different. WTF. try again. TWO columns!!! Goal: Correct commit f431708 so mockup visibly implements approved direction: large Cluster Summary tile beside compact readings stack inside health-rail ribbon.

15. Success means: ... (implied large tile beside compact stack, visibly two columns)

16. Correction — treat this as the authoritative layout contract.

17. Goal: Design status/health ribbon as ONE shallow row deep and exactly TWO top-level columns wide.

18. Success means: ... (one shallow row, two columns, etc.)

19. Every rendered ribbon instance has one horizontal content row only.

20. Column 1 is condensed deterministic health/status readings, about 40% of width.

21. Column 2 is richer Cluster TL;DR, about 60% of width.

22. Summary label, scan window, and Customize action are compactly incorporated without creating separate header row above two columns.

23. TL;DR never sits below health readings. Do not use stacked breakpoint at 860px; remain two columns and compact/truncate secondary detail to preserve one-row depth.

24. Chevrons replace content of right-hand TL;DR column between ALL and repo-specific states. They do not add row or move tile.

25. Documentation page may show ALL and repo-specific examples one after another, but each individual ribbon example must itself be one row deep and two columns wide.

26. Remove or correct all copy that says below readings, readings stack, responsive stack, or implies second ribbon row.

27. Render 1440x1000 and 860x1200 screenshots and visually confirm both contracts before committing.

28. Keep changes limited to mockup and design plan, run git diff --check, create new local commit without publishing.

29. Report commit SHA, exact files, verification, and any remaining visual caveat. Stop when both rendered widths demonstrate intentional use of full ribbon width, new local commit is clean, lane report complete.

30. Goal: Reconcile implementation steps with accepted 4c5a8a4 DOM without changing mockup. Success: Rewrite Step 1 so div#health-widgets.rail-inner remains ribbon and owns exactly two direct children: div.readings-stack wrapping existing readings, followed by div.health-tldr-lane; never insert lane between #health-widgets and #widget-customizer. Rewrite Step 3 so renderHealthTldrLane renders into existing lane inside #health-widgets after renderHealthRail has populated readings wrapper, not after/below ribbon. Audit plan for remaining below/after-ribbons/sibling wording contradicting two-child contract and correct only those lines. Keep mockup/layout unchanged, run git diff --check, make one local docs-only commit after 46641d9, report SHA and exact lines, then stop.

31. Goal: Fix exact DOM-parent defect so two top-level columns actually render beside each other. For both examples, direct children of .rail-inner must be exactly .readings-stack and .health-tldr-lane. Add deterministic browser check before visual claims: for every .rail-inner, assert children.length ===2, children[0] is readings-stack, children[1] is health-tldr-lane, same top within 1px. At 1440 and 860, measure bounding boxes and report actual widths and ratios (readings ~40%, TL;DR ~60%, adjacent, no blank column). Render fresh screenshots with new filenames tied to new commit; inspect actual pixels. Do not reuse evidence from false fb45477. Keep ribbon one row deep at both widths, with no separate header row and no stacked breakpoint. Make smallest correction in mockup and plan/report truth. Run git diff --check and create new local commit; do not amend.

32. Success means: — (followed by detailed list, truncated in log)

33. Correction: HEAD 4c5a8a4 actually renders 860px readings as compact 2x2 grid, so retain 2x2 wording and undo vertical-column wording from stale instruction; change only malformed Verification markdown into one coherent numbered item, run git diff --check, make one local docs-only commit, report SHA, and stop.

34. Goal: Reconcile implementation steps with accepted 4c5a8a4 DOM without changing mockup. (repeated) — Rewrite Step 1 and 3, audit below/after-ribbons/sibling wording, keep mockup unchanged, commit after 46641d9.

35. Goal: Fix exact DOM-parent defect so two top-level columns actually render beside each other. (repeated)

36. Success means: Fix malformed Verification markdown into one coherent numbered item; replace claims that 860px readings become 2x2 grid with rendered truth: they remain condensed vertical readings column occupying about 40%, beside 60% TLDR column, while overall ribbon stays one row deep. (then corrected to retain 2x2 per latest instruction)

37. Latest: Two column layout 60% TL;DR / 40% deterministic, One ROW; Fix DOM nesting so two top-level columns actually render beside each other; one shallow row deep, two columns; etc. — culminating in commit 4c5a8a4 (fix 860 stack) and 0b3c21f/84f07b0 DOM fixes, with fresh screenshots at /tmp/health-rail-4c5a8a4-1440.png and /tmp/health-rail-4c5a8a4-860.png showing 40/60 with no blank column, DOM assertions pass.

38. Current request: give design over via handoff. Include everything I've told you so far and your latest mockup. It's the closest one so far but needs a lot of refining.


---

## Latest mockup — what it currently implements (commit 4faf452)

**File:** `docs/rhs-shots/health-rail-tldr-fold-in/mockup.html` at `4faf4529c8cb4e5676f0f277ff55138859b17e57`

**Ribbon contract (authoritative as of 4faf452):**
- **One shallow row deep, exactly two top-level columns inside `div#health-widgets.rail-inner`:** Column 1 is condensed deterministic health/status readings, about 40% width (`div.readings-stack` as `2×2 grid` of Health/Momentum/Burn/Context at `1.05rem`/`10.3px`, hairline dividers, `min-height:84px`); Column 2 is richer Cluster TL;DR, about 60% width (`div.health-tldr-lane` as large tile with left accent, `60%`, rich prose `13-14px`, chevrons). Both are direct children of `.rail-inner` (`children.length === 2`), share top within 1px, adjacent with no blank column.
- **No separate header row above two columns:** `Summary` label, `36h` scan window, and `Customize` are compactly incorporated as `div.stack-head` inside the 40% column (9px heading, 10px mono, 11px button), not a full-width header row.
- **Tile beside, not below:** `health-tldr-lane` is sibling of `readings-stack` inside `rail-inner`, not a sibling of `#health-widgets` between `#health-widgets` and `#widget-customizer` (rejected layout). At 1440 deterministic 40% beside large tile 60% visibly occupies remaining majority immediately below compact header, one ROW.
- **At 860px:** remain two columns (40/60 row, `gap:0`, hairline), not stacked below; secondary detail compacted/truncated (`is-collapsed-extra` hidden until `Show`/`is-expanded` or chevron), no large blank column. Text remains condensed vertical readings column (~40%) beside 60% tile — one row deep.
- **Chevrons replace content:** `‹/›` in tile header replace *content* of right-hand 60% column between `ALL` (longer TL;DR per repo, at most 2 rich blocks, only 1 visible keeping row shallow) and repo-specific (detailed prose + 3-up `momentum / burn / context` tiles) — they do **not** add a row, move the tile, or create second lane.
- **Context gauge preserved:** `svg.ctx-gauge` with `width:100%; max-width:5rem; height:auto; display:block`, `reading-sub:has(.ctx-gauge) flex`, gauge strokes, `Context` button + value unit `average/median window` + `spread-toggle` + subcopy `peak`/`median` — not invented `Context — Peak` text, not 300×150 hero.
- **List semantics:** `div.tldr-lane-list[role=list]` directly owns `div.tldr-rich[role=listitem]` / `div.tldr-row[role=listitem]`; lane head `div.tldr-lane-head[role=status aria-live=polite]` sits outside list; `Show` control outside list.
- **Announcement:** single `lane head[role=status aria-live=polite]` for count change only, not per-row, does not compete with visually-hidden `cleanup-status[role=status aria-live]`.

**Rendered truth (independent headless Chrome at exact viewports, not mental model):**
- **1440×1000:** `railWidth=1374.0` `readings=549.6 (40.0%)` `tldr=824.4 (60.0%)` gap 0.0px, no blank column — **PASS** — screenshot `/tmp/health-rail-7f49-1440.png` (at `7f49de6`) and fresh `/tmp/health-rail-4faf452-1440.png` (at `4faf452`) both show shallow single-row 40/60, gauges bounded, no stacked content.
- **860×1200:** `railWidth=794.0` `readings=317.6 (40.0%)` `tldr=476.4 (60.0%)` gap 0.0px — **PASS** — screenshot `/tmp/health-rail-7f49-860.png` and `/tmp/health-rail-4faf452-860.png` show same two columns at 860, compact.

**Implementation steps (as reconciled to `4c5a8a4` DOM, an implementer following them cannot recreate rejected below-the-readings layout):**
- **Step 1 (`index.html:94`):** Keep `div#health-widgets.rail-inner` as the ribbon; it must own **exactly two direct children**: `div.readings-stack` wrapping existing readings (Health/Momentum/Burn/Context) followed by `div.health-tldr-lane` as large 60% tile. **Never** insert lane between `#health-widgets` and `#widget-customizer` as sibling of ribbon.
- **Step 3 (`app.js:3869-4120`):** `renderHealthTldrLane()` renders into existing `div.health-tldr-lane` **inside** `div#health-widgets.rail-inner` after `renderHealthRail()` populates `div.readings-stack` wrapper (call ≈ `app.js:3835` after `renderScanWindow()`), **not** after/below ribbon.

**File fence:** Only `docs/superpowers/plans/…` + `docs/rhs-shots/…/mockup.html` ever committed (plus uncommitted lane report); `src/tests/services/OBB/browser` untouched.

**Verification in mockup `<script>` (deterministic before visual claims):**
```js
for every .rail-inner: rail.children.length===2
children[0] is readings-stack, children[1] is health-tldr-lane
Math.abs(top0-top1) <=1px
ratio0 36-44% (~40%), ratio1 56-64% (~60%), gap ≤1.5px, sum ≈ rail width
```
Gates: `git diff --check a1a41ff..HEAD` clean, HTML parser OK, `bunx tsc --noEmit` / `bun test` deferred to implementation lane.

---

## What still needs refining (per your “closest so far but needs a lot of refining”)

- **Visual weight:** 60/40 split is code-correct (measured 40.0/60.0) but still reads as “hideous” at a glance — needs typographic hierarchy, spacing, and color tuning (your earlier hideous feedback).
- **Richer TL;DR prose:** At most 2 rich blocks keeps row shallow, but prose still generic — needs repo-specific cross-agent story editing per the “longer TL;DR per repo” and “detailed tiled stats” direction.
- **860 legibility:** Two columns preserved at 860 per contract, but at <640 will need explicit full-width stack fallback not yet designed.
- **Interaction polish:** Chevrons and `Show N repos` both exist (chevrons replace content, Show reveals collapsed extra) — needs single clear disclosure model.
- **Copy:** Any remaining `below/after-ribbons/sibling` phrasing outside the corrected Steps 1/3 should be audited — lane report already notes honest gaps (no unit-test run at docs close, shared browser not launched by lane beyond owner renders).

---

## How to continue

1.  Open the mockup: `file:///Users/emilionunezgarcia/Developer/the-mountain.worktrees/health-rail-tldr-design/docs/rhs-shots/health-rail-tldr-fold-in/mockup.html` at `1440×1000` and `860×1200` — check the two columns, gauge at `5rem`, chevrons, and one-row depth.
2.  Apply visual refinements directly to `mockup.html` (no src changes) — keep the two-child `rail-inner` contract and deterministic checks.
3.  Update `LANE-REPORT-health-rail-tldr.md` (still `??` uncommitted) with new SHA and fresh screenshot paths, then `git diff --check` and new local docs-only commit.
4.  Iterate until `git diff --check a1a41ff..HEAD` clean and `lane report` shows `READY` with fresh `1440`/`860` PNGs.

---

## Evidence paths (fresh, not reused from false `fb45477`)

- `/tmp/health-rail-4faf452-1440.png` — 1440×1000, 40/60, no blank column, shallow
- `/tmp/health-rail-4faf452-860.png` — 860×1200, same, compact
- Legacy pinned: `/tmp/health-rail-7f49-1440.png` / `/tmp/health-rail-7f49-860.png` (at `7f49de6`, integration-owner headless Chrome)
- Raw HTML: `/tmp/evidence_7f49de6_mockup.html` (`git show 7f49de6:docs/.../mockup.html`)

---

*Handoff generated 2026-08-09T16:04:04.972312 — all prior instructions included verbatim or faithfully summarized, latest mockup at `4faf452` handed as authoritative starting point.*
