# Lane FE-4 — the Class axis, and the sentence moves up

You are lane FE-4. Emilio's directive, 2026-08-06 06:29. Prior contract for
idiom and landmines: `docs/LANE-FE2-FILTER-MENUS.md` (the axis table, menu
primitive, count invariants) and its status file. The bar today:
`⊘ N reviewers hidden · Provider ▾ · Status ▾ · Model ▾ · Span ▾ · Context ▾`
with Time right-aligned, and the reconciling sentence below the search bar.

## D1 — `agentClassOf(agent)` (pure, in `agent-model.js`)

One class per agent — the partition invariant (FE2-D3 test: "options
partition the working set") requires exactly-one-bucket membership, so the
classification is a PRECEDENCE, documented in a comment:

1. `sessionKind === "review"` → `reviewer`
2. `sessionKind === "automation"` or `role === "automation"` → `automation`
3. `role === "orchestrator"` → `orchestrator`
4. `specialty === "frontend"` → `frontend`; `"backend"` → `backend`
5. any other published role (`tester`, `verifier`, `worker`, `human`) → that
   role, verbatim
6. else → `agent`

Consume the published fields only (`sessionKindOf(agent)` for 1–2 so the
transition fallback keeps working, `agent.role`, `agent.specialty`). Do not
re-derive from prose. Live distribution for your fixtures: orchestrator 177,
automation 130, tester 4, verifier 2, worker 19, agent ~1000, specialties
sparse. Unit-test the precedence (an orchestrator with a frontend specialty
is `orchestrator`; a review-kind orchestrator is `reviewer`).

## D2 — Class becomes the FIRST lens axis

- New entry at the head of `LENS_AXES`: key `class`, stateKey `facetClasses`
  (set-valued like the rest), label "Class", allLabel "All classes",
  options from populated `agentClassOf` values with human labels
  (Reviewer / Orchestrator / Frontend / Backend / Automation / Tester /
  Verifier / Worker / Human / Agent), `matches: (a, v) =>
  agentClassOf(a) === v`. fkeys `class:menu`, `class:<value>`.
- The existing FE2-D3 table-driven tests (count agreement, partition,
  counts-do-not-move) pick the axis up automatically — verify they do, and
  extend the lens fixture so at least two classes are populated.
- Bar order becomes: `Class ▾ · Provider ▾ · Status ▾ · Model ▾ · Span ▾ ·
  Context ▾` — Class leads because it answers WHO the agent is; update the
  fkey-order pin deliberately.

## D3 — the ⊘ policy folds INTO the Class menu

The standalone `⊘ N reviewers hidden` fragment leaves the bar. The policy
(fleet-shared `showReviewWorkers`, default-hide) is not a lens and must not
become one — it lives as a visually distinct FOOTER ROW inside the Class
menu:

- A separated item (divider above, distinct class, NOT `menuitemcheckbox` —
  it is a `menuitem` action): label "⊘ Show N hidden reviewers — fleet-wide
  setting" / "⊘ Hide routine reviewers — fleet-wide setting". Keeps fkey
  `session-kind:review` (muscle memory) and calls `setShowReviewWorkers`.
  Rendered only when it changes something (`reviewWorkerCount > 0` or
  currently showing).
- Disclosure invariant: while reviewers are hidden and `reviewWorkerCount >
  0`, the Class TRIGGER carries the mark — label "Class ⊘" (title states
  the count and that it is fleet-wide). A hidden population stays one
  visible control away, now one level deep but marked at the surface.
- Interplay is already coherent and needs no special cases: the working set
  excludes hidden reviewers, so the Reviewer lens option simply has count 0
  and does not render while hidden; flip the policy and it appears with its
  count. Pin exactly that in a test.
- The sentence keeps its exclusion: Clear never touches the policy.

## D4 — the sentence moves into the filter bar row

The reconciling sentence ("Showing working sessions — 22 of 22 · Clear")
moves from below the search bar to the filter bar row, sitting AFTER the
lens triggers and BEFORE the right-aligned Time control (it fills the void
between the two layers — lenses left, working-set control right, the
reconciliation between them, which is also its meaning).

- Keep it an `aria-live="polite"` region; it may keep the `#scope-note` id
  or move to a new element inside `#filter-bar` — whichever keeps the
  Usage-view branch of `renderScopeNote` working (Usage still uses the old
  line's slot; only the board/history sentence relocates).
- It must wrap gracefully on narrow widths (flex, `min-width: 0`); the bar
  must never scroll horizontally.
- Update the D5 sentence tests' render targets; behavior is unchanged.

## D5 — Time stays right-aligned (no code change; recorded ruling)

Emilio is undecided on the right-aligned Time trigger. It is DESIGN, not
afterthought (two-layer boundary; the tab-row mount was rejected for the
tablist arrow-key conflict — FE-2 status). With D4 the sentence fills the
gap, which is expected to make the alignment read composed rather than
stranded. No change in this lane; if Emilio still dislikes it after seeing
D4 live, it is a one-line CSS revert (`margin-left: auto` off).

## Gates and law

- Test-first where a behavior is new (D1 precedence, D3 policy row + trigger
  mark + reappearing Reviewer option); the table tests cover D2 for free.
- `bunx tsc --noEmit` + `bun test tests/web-client.test.ts` per deliverable;
  full `bun test` before LANE DONE. Known foreign red: the
  docs/a11y-geometry-gate live-board test.
- Shared-worktree law, unabridged (it bit four times yesterday): re-check
  branch before commits; stage ONLY your hunks and commit in the same shell
  invocation; verify foreign hunks survive; FORWARD-ONLY — never amend or
  rebase, even your own tip. One deliverable per commit (D2+D3 may combine
  if splitting strands a half-wired menu).
- Do not push. Do not commit this kickoff or your status file.

## Status protocol

Append to `docs/LANE-FE4-STATUS.md`: `[HH:MM] D<N> DONE <sha>` / `BLOCKED` /
`DIVERGENCE` lines, final `[HH:MM] LANE DONE`.
