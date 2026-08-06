# Board hierarchy re-skin — spec (2026-08-06)

Program: make the board's visual order match the operator's attention order —
**program → topic (worktree) → agent** — after a four-lens adversarial review
(hierarchy weight, containment, lineage, glanceability) measured the current
board as inverted: worktree label is the largest heading (16px vs the repo's
15.2px), the repo band carries 19% of the worktree's ink, worktree and agent
titles share one left edge, and one viewport spends 33 rows of chrome on 15
rows of content.

## Locked decisions (Emilio, 2026-08-06, via AskUserQuestion — override anything contrary)

1. **Scope: all four slices now.** (A) correctness quick wins, (B) hierarchy
   re-skin, (C) row content cleanup, (D) summary strip attention headline.
2. **Sticky model: three-tier stack.** Repo band head + current worktree rule +
   column header all pin (~103px frozen). New `--repo-head-h` token; worktree
   rule pins under the band head; column header under both; all three
   re-pointed in the ≤1024px media block; `scroll-margin-top` on rows updated.
3. **Lineage: server-first follow-up program** after this one lands. Swarm
   launcher writes run manifests / `ANTHILL_*` env (hooks exist as dead code in
   `src/server/run-manifests.ts:357-371`), `reviewOf` field for classifiers,
   run bands on the board, `isSidechain` subagent collection. NOT part of this
   program; do not half-ship client lineage marks here.

## Phase A — correctness quick wins (commit 1)

1. **Green "Alert" ink.** `rowStateWords` can print "Alert" while the status
   class comes from the healthy outcome (`act-working`, green). Pick the ink
   from alerting-ness: `outcome !== "healthy" || wantsHuman(agent)` →
   `row-state-alert`. (app.js ~7517-7529 vs ~7870.)
2. **Suppressed alert word.** `words.push(OUTCOME_LABELS["needs-you"])` is
   gated on `!words.length`, so an idle+healthy+wantsHuman row prints only
   "Waiting". Drop the guard: every alerting row reads "… · Alert". This makes
   the head's "6 alerts" auditable by eye.
3. **Swarm chip honesty.** Chip count uses whole-snapshot descendants; the
   expansion draws same-program filter-admitted rows (40% error measured).
   Count from the set the expansion draws; when the full count is larger, the
   label says `swarm 2 of 7`. `hasAlertingDescendant` restricted to the
   reachable set so a collapsed chip's ember never points at a row expansion
   can't show. (app.js ~7159-7248, ~7403-7412.)
4. **`fmtElapsed` days.** 36h prints "2d" (rounds), "1d" unreachable. One
   decimal above 24h: `1.5d`, `2.0d`. (src/web/text-formatters.js:8-15.)
5. **Bold zero tokens.** `tokens.total === 0` falls through `known` and prints
   a full-ink `0` styled like a measurement. Zero renders as absence
   (`not reported` treatment). (src/web/agent-model.js:544-552.)

## Phase B — hierarchy re-skin (commits 2..n, sub-unit per commit)

B1. **Containment flip.** `.repo-section` takes the card treatment
    (border/`--radius`/`--surface`/`--shadow-soft`); banded `.program` drops
    border/radius/background/shadow/margin and becomes a full-bleed rule
    between siblings (`border-top: 1px solid var(--line)`, first-child
    exempt). `.repo-worktrees` loses `padding-left`/`border-left`; nesting is
    carried by a 0.5rem pad + `box-shadow: inset 2px 0 var(--line)` **on
    `.program-agents`** (inset shadow, never `border-left` — a border would
    de-register the shared column header from row columns). `overflow: clip`
    moves to `.repo-section`; re-verify the sticky head still pins to
    `.pane-list` (styles.css:1129-1133 documents the hidden-vs-clip trap).
B2. **Flat programs become one-worktree bands.** `repoGroups` wraps a
    `groupPath`-less program in a synthetic single-worktree group; the
    subsection head is suppressed (`is-flat` on the section — new literal,
    must be in a paint signature so an arriving `groupPath` repaints).
    One shape per tier: "Home" stops out-dressing real programs.
B3. **Type ladder.** `.repo-name` 1.25rem/750/`--ink`, tracked-caps eyebrow
    optional later. `.program-name` → `--font-mono` 0.85rem/600/`--muted`
    (branch = identifier; fixes I/l/1 homoglyphs). `.agent-name` 14px/640,
    `is-parent` bump 800→720. Drop `mono` from the "N worktrees" count
    (app.js ~6129). Worktree head shrinks toward a 26-30px rule: caret 1.1rem,
    Details/pencil to hover-reveal (the `.agent-rename` opacity pattern).
    Agent rows get an indent step (+0.8rem on row + column header padding).
B4. **Chrome elision.** One `.agent-column-header` per band (hoisted out of
    `agentRowPlan` into the band plan; flat bands have exactly one worktree so
    the hoist is uniform). Lifecycle dividers only when >1 section has rows
    (`agentRowPlan` already computes `drawn`).
B5. **Three-tier sticky** (locked decision 2). `.repo-head` sticky top:0 z:4
    opaque; worktree rule sticky at `--repo-head-h` z:3; column header at
    `calc(--repo-head-h + --program-head-h)` z:2. Single-line/truncation
    contract on the repo head (same discipline as styles.css:1136-1139).
    Update `scroll-margin-top` (styles.css ~1294, ~1829) and the ≤1024px
    token block (~2925, ~2992).
B6. **Band-head rollup.** Band head renders `programRollupCells` over
    `group.worktrees.flatMap(w => w.program.agents)` — REUSE the function,
    never a fresh sum (app.js:335-338 documents the two-derivations defect
    class); cells enter `repoShellSig` or the head freezes. Worktree rule
    keeps only `N live · N alert`, suppressed at n=1 (8 of 9 boxes today);
    per-worktree "session tokens" leaves the Board head (see C4).
B7. **Attention-only left rail.** Delete `.agent-row.provider-*` border
    tints (provider stays on the avatar glyph + MODEL cell). Delete
    `ctx-warn`/`ctx-hot` row rails (styles.css ~3292-3293 — the MODEL·CTX
    value already colors). Depth rails lose per-depth hues → neutral rail +
    existing elbow (provider-palette collision). `is-died` /
    `is-lineage-disputed` move off the left rail (right-edge 3px or inline
    glyph) so integrity facts can't be occluded by — or occlude — attention.
B8. **Worktree label dedup.** `worktreeLabel` drops the `@base` half when
    `base` duplicates the branch tail or equals the repo band name
    (today: `feat/ev2-g1@ev2-g1`, and `…@the-mountain-main` contradicting
    band "the-ant-hill"). Guard: only strip while labels stay unique within
    the band. Needs group context — post-pass in `repoGroups`, keep
    `worktreeLabel(program)` pure for its existing callers/tests.

## Phase C — row content cleanup (commit n+1)

C1. **Snippet sanitization** in `conciseText` (src/web/presentation.js:191):
    `[text](url)` → text; bare URLs → host+last segment; 32-hex/UUID runs →
    `…`. Pure-function tests.
C2. **SPAN → QUIET on Board.** The Board tab's fifth column shows
    `rowStalenessText` (`3h`, blank when fresh — blank IS the signal); History
    keeps SPAN (total duration is the point there). Header label per view.
C3. **`fmtTok` sig figs.** ≤3 significant figures at every magnitude
    (377k / 6.6M / 326M — not 325.8M).
C4. **Head reconciliation.** Board-view worktree/band rollup reads
    `N of M shown` when the filter hides rows (precedent: app.js:5834);
    `ended` and `session tokens` leave the Board head (History keeps them).

## Phase D — summary strip (commit n+2)

D1. MOMENTUM headline becomes the attention count (`13 need you`, ember),
    sub carries `6 shipping · 19 quiet 15m+`. Deliberately breaks the
    "nothing here is a to-do" rule (app.js:1105-1110) — decision: the rule is
    wrong for a fleet console.
D2. BURN loses unconditional green (`--ink`; green only means "within band").
D3. CONTEXT: colored by peak while showing average — surface the peak
    (`peak 79%` in the sub) so the color and the number agree.

## Verification

- Per phase: `bun test tests/web-client.test.ts` green before commit;
  full `bun test` before each commit (known standing red:
  `docs/a11y-geometry-gate`, local-only).
- After B: live pass on 4701 — sticky stack depth-scroll probe (head offsets
  at scroll), both needs-you display modes (pane AND inline), collapsed band,
  filtered-to-one-row band, ≤1024px width.
- Counts invariants re-checked: Board tab, "N of M" scope note, rollups.

## Parked (recorded, not in scope)

- Lineage server program (locked decision 3) — including run bands,
  `reviewOf`, `isSidechain`, `subagentCount` chip, strip lineage ties.
- Ember overload beyond the rail: focus ring / hover / Board-tab count
  recolor; amber advisory tier; LIVE dot animation; `Class ⊘` disclosure;
  `Details` button weight; "Home" relabel; snippet hover-expand.
- Dark theme: does not exist (single light palette) — decide deliberately
  someday; contrast work here is light-mode only.
- One critic argued the two-mode needs-you pref fragments shared vocabulary;
  Emilio chose the pref deliberately — revisit only if it bites.
- Critic reports: session task outputs (four lenses), 2026-08-06.
