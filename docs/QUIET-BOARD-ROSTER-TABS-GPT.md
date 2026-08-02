# The roster and tabs at n=1 and n=3

Closing the gap my own caveat named: `docs/QUIET-BOARD-AUDIT-GPT.md` exercised
`pulseStripModel` but not the renderer, leaving the roster, program header and tab bar unaudited
at the size a new operator actually meets.

**Recorded for the file:** the cost-suppression finding is independently confirmed by the
operator with correct `from`/`to` parameters after a service restart — 30 days shows Codex
$4,752.32, Claude Code $6,949.58, Hermes $237.39, Factory $0.65, all measured, Cursor unpriced at
45 of 2,980 invocations. Measured total **$11,939.94**, while top-level still reports
`costKnown: false` and `estimatedCostUsd: null`. Render half landed in `c5c6a72`; server half is
with the backend lane.

**Method, and its limit.** I could not inject a small snapshot and read it in situ — the live
feed overwrites an injected snapshot within seconds, and I confirmed that empirically rather than
assuming it. So I called the **exported production renderers directly** —
`renderAgentRow`, `programRollupCells`, `viewMatches` — on 1- and 3-agent slices of the real
payload. That exercises the real row-building code, not a mock. It does **not** exercise
layout, CSS, or in-situ paint, which is stated again in the caveats.

Measured on branch `fix/backend-silent-failures-and-freshness`, board at `127.0.0.1:4701`,
475 agents in the source payload.

---

## 1. At n=1 the token-label defect becomes unexplainable

Rendered, one agent, one program:

```
program header : 1 agent · 1 working · 3.2M session tokens
the only row   : … opus 5 · 24% · 244k latest call · 3d
```

The program contains **exactly one agent**. Its header says `3.2M session tokens`; the single
row that constitutes the entire program says `244k latest call`. Thirteen-fold apart, with
nothing between them.

At 400 agents, "the header sums many rows" is an available explanation — wrong, but available.
**At n=1 that explanation does not exist.** There is one agent, two numbers, and no aggregation
to account for the gap. The defect the frontend lane correctly narrowed by relabelling (`session
tokens` vs `latest call`) is *most confusing* at the smallest fleet, because the operator can see
the entire population and still cannot reconcile it.

Credit where due: `latest call` now renders in the **visible** row text. That was hover-only when
I first audited it, and the fix landed.

**Named fix:** at n=1, or whenever the program header's population equals one row, suppress the
program token cell — the row already carries the number, in the more honest unit.

## 2. The tab bar is mostly zeros at the size a new operator meets

Computed through the production predicate `viewMatches`:

| Tab | n=1 | n=3 |
|---|---:|---:|
| Needs you | 0 | 0 |
| Now | 1 | 3 |
| Working | 1 | 3 |
| Idle | 0 | 0 |
| History | 0 | 0 |

At n=3 the operator's navigation reads `Needs you 0 | Now 3 | Working 3 | Idle 0 | History 0`.
**Three of five tabs read zero, and two of the remaining three are the same number.**

The `Now`/`Working` duplication is a finding from my first cockpit audit that still stands —
`now` is `working ∪ alerting`, so with no alerts they are identical. At 400 agents that
redundancy is a smell. At n=3 it is most of the navigation: five tabs conveying two facts.

This is a scale-inversion of the same rule the cockpit already applies elsewhere. `pulseStripModel`
suppresses a cell that has nothing to report; the tab bar does not. A first-run operator's
strongest impression of the interface is a row of counters reading zero.

**Named fix:** hide `Idle` and `History` when their count is zero and they are not the current
view, exactly as the summary band already hides empty cells. Resolve `Now`/`Working` separately —
that one is not size-dependent.

## 3. `1 agent · 1 working` — the rollup restates itself

At n=1 the header renders two cells carrying one fact. If there is one agent and it is working,
`1 working` adds nothing that `1 agent` did not already imply in a program the operator can see
in full.

The `0 alerts` cell is already correctly suppressed at zero — the convention exists in this exact
function (`programRollupCells`), it simply was not extended to counts that are trivially implied.

**Named fix:** suppress a rollup count cell when it equals the agent count, or when the program
has one agent.

## 4. What holds up at small n

Reported deliberately, because a quiet-board audit that only finds faults has not been calibrated.

- **Row structure survives.** At n=1 and n=3 the row renders name, program, message, model,
  context %, tokens with unit, and span — all populated, all legible. Nothing collapses.
- **`opus 5 · 24%` and `opus 5 · 97%`** render correctly side by side at n=3; the per-agent
  context reading needs no population to be meaningful, which is exactly why it is the one
  summary figure that survived every audit.
- **`viewMatches` is population-independent.** Every predicate returned a correct count at n=1
  and n=3 with no small-*n* special case needed.
- **The rollup omits honestly.** `3.2M session tokens` appears only because agents report a
  session total; the cell disappears when none do. The mechanism is right — the label and the
  redundancy are the problems.

---

## The pattern across both quiet-board audits

Four of the five defects found at small *n* are the same shape: **a suppression rule that exists
in the codebase, applied in one place and not another.**

| Rule | Applied | Not applied |
|---|---|---|
| A cell with nothing to report does not render | summary band cells; `0 alerts` | MOMENTUM at zero; `Idle 0`/`History 0` tabs; `1 working` at n=1 |
| Distinguish cumulative from latest-call | row label (`latest call`) | program header at n=1, where it is least explicable |

The codebase already contains the right rule in each case. Nothing here needs a new idea; it
needs the existing convention extended to the bottom of the range. That is a cheaper class of fix
than anything else I have reported today, and it lands on the state a new operator sees first.

---

## Caveats

- **Renderers were called directly, not painted in situ.** `renderAgentRow` and
  `programRollupCells` are the production functions and I read their real output, but layout,
  CSS truncation and responsive drops at n=1/n=3 remain unaudited. Given that truncation is how
  1.6B hid, that gap is worth closing on a board that can actually be shrunk.
- **§2's tab counts are computed from `viewMatches`**, the same predicate the tab bar uses, not
  read from a painted tab bar at n=3. I state the counts with confidence and the *rendered
  appearance* as inference.
- **The n=1/n=3 slices are real agents from the live payload**, so their message text is
  atypically long (these are audit lanes writing prose). A fresh operator's agents would render
  shorter rows; nothing in the findings depends on message length.
- **I did not test n=0 in the roster** — only in the model, in the previous audit.
