# Lane FE-4 status

[06:47] D1 DONE a83cdfb — `agentClassOf(agent)` in `agent-model.js`, pure, one
class per agent by documented precedence. The test pins the ORDER (a review-kind
orchestrator is `reviewer`; an orchestrator with a frontend specialty is
`orchestrator`), because a test that only checked "an orchestrator is an
orchestrator" would pass over a table that ranked specialty first.

[06:47] NOTE (D1 vocabulary) — step 5 is implemented as "any member of AgentRole
the precedence has not already answered", which is `tester · verifier · worker ·
monitor · service · human`. The contract's parenthetical named four of those six;
`monitor` and `service` are published `AgentRole` members too, and dropping them
would file a monitor under `agent` with no menu item able to undo it. Their
labels are added to the class label map alongside the ten the contract lists.

[07:05] D2 + D3 DONE 1d8c826 — combined, as the contract permits: splitting them
would have landed a bar carrying BOTH a Class menu and the standalone ⊘
fragment, and churned the fkey-order pin twice for a state nobody wants shipped.

[07:05] DIVERGENCE (D3 applicability, additive) — `lensApplies` gains a general
rule rather than a Class special case: an axis whose menu carries something other
than its own options renders whenever that something must be reachable
(`axis.footer`). Without it the one-option case would have deleted the policy
along with the menu — reviewers hidden with no control anywhere able to show
them. Consequence, pinned: on a board of one class where the fleet is SHOWING
reviewers and none are in the window, the Class menu still renders, because
otherwise an operator who turned the setting on could not turn it off until a
reviewer happened to appear.

[07:05] NOTE (pre-existing defect repaired in passing) — `FILTER_MENU_TRIGGERS`
was a hand-kept map of three (time, provider, status) while the bar already had
five lens menus, so Escape out of Model, Span or Context resolved no trigger fkey
and dropped a keyboard operator on `<body>` — the exact failure the data-fkey
contract exists to prevent. Adding Class would have made it four names short of
six. It is derived from `LENS_AXES` now and pinned across every axis; the loop
fails on the old map for four of the six.

[07:24] D4 DONE 29e17b3 — the sentence renders in the filter bar row, between the
lens triggers and the right-aligned Time control. The D5 tests change render
target only; their behaviour is untouched.

[07:24] DIVERGENCE (D4 element choice) — the sentence gets a NEW element,
`#bar-scope-note`, declared in `index.html` and never rebuilt, rather than one
created by `renderFilterBar`. D4 offered either; only one of them is a live
region. `renderFilterBar` runs on every paint, and an `aria-live` element that is
destroyed and recreated announces nothing — the region has to already be in the
tree when its content changes, or the announcement is the region's own insertion,
which assistive tech does not read. So `renderFilterBar` now empties the bar
AROUND that one node (`clearFilterBar`) and places controls on either side of it
with `insertBefore` / `append`. `#scope-note` stays exactly where it was and is
the Usage line's slot alone, which is what D4 asked for.

Honest limit: the announcement itself is not observable in a DOM-less suite, so
what the tests pin is the checkable half — the region is DECLARED in the markup
(`html` contains `id="bar-scope-note"`), it is a single child of the bar across
repaints, and it sits between the last lens and the Time trigger. The a11y
consequence is argued in the comments, not measured by the suite.

[07:24] NOTE (D4, pre-existing bug fixed in passing) — the Usage branch of
`renderScopeNote` set `textContent` and never cleared `hidden`. A quiet board
hides `#scope-note`; switching to Usage then wrote the range line into an element
still carrying that flag, so it was written and never shown. The restructure gave
each slot an explicit hidden state, so this is one line, in the function being
rewritten, and it is verified live below.

[07:24] D5 — no code change, as ruled. Time keeps `margin-left: auto`. The live
screenshots below are the evidence for the ruling's prediction: with the sentence
filling the gap, the right-aligned trigger reads as the far end of a composed row
rather than as a stranded control. If Emilio still dislikes it, it is one
declaration in `.filter-menu-wrap.is-trailing`.

[07:24] LIVE VERIFICATION on the running board (127.0.0.1:4701, served from this
worktree — confirmed by fetching `/app.js` and `/`). No console errors. Measured:
  - bar reads `Filters · Class ⊘ ▾ · Provider ▾ · Status ▾ · Model ▾ · Span ▾ ·
    Context ▾ ················ Last 6h ▾` — Class leads, the ⊘ is on the closed
    trigger, and the trigger's title carries "⊘ 7 reviewers hidden from the Board
    by the fleet's review setting"
  - the open Class menu: `All classes · Frontend 1 · Agent 22 · ——— · ⊘ Show 7
    hidden reviewers — fleet-wide setting`, the last one `role="menuitem"` with no
    `aria-checked`, separated by a rule and set in the quieter ink
  - counts partition the working set: Frontend 1 + Agent 22 = 23 = the tab number
  - with the Frontend lens on: sentence "Showing frontend sessions — 1 of 23 ·
    Clear" against exactly 1 rendered row, tab still 23 (D6 live, over a new axis)
  - the bar's children, in order: `filter-lead · class:menu · provider:menu ·
    status:menu · model:menu · span:menu · context:menu · bar-scope-note ·
    lookback:menu` — the sentence is between the lenses and the working-set
    control, which is the D4 contract read straight off the live DOM
  - narrow (620px): the bar WRAPS to two lines and does not scroll —
    `scrollWidth === clientWidth` on the bar and on the document
  - Usage: `#scope-note` reads "Usage range 24h · source BurnBar" and is VISIBLE
    (the fix above), `#bar-scope-note` empty and hidden
  - History: no Class menu (one class, no review policy there), both slots quiet
  - the fleet's review setting was NOT written at any point — it stayed at hide,
    so nothing a colleague sees was changed to take these measurements

[07:24] SUITE — `bun run check`: `bunx tsc --noEmit` clean, `bun test` 2841 pass /
1 fail. The single failure is `docs/a11y-geometry-gate/`, which boots its own
board on a random port and never gets an answer — the foreign red this lane's
contract names, and it fails identically on the pre-lane tree.

[07:24] CROSS-LANE — a co-tenant landed uncommitted work in `src/web/app.js` and
`src/web/index.html` between my last commit and the final gate (the Clean up
sweep's `aria-disabled` / paint-signature fix, and a `#cleanup-status` live region
that cites `#bar-scope-note` as its precedent). It is theirs; I did not stage,
commit or touch it, and the gate above was run with it present. All three of my
commits re-verified as ancestors of HEAD afterwards, and every marker of mine is
still in the working file.

[07:24] LANE DONE
