# Task B4 completion report — all entity drawers on the verdict totem

## Commit

- Worktree: `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-inspector-totem`
- Branch: `ant-hill/luna-inspector-totem-20260722`
- Commit: `f83e85e feat(inspector): all entity drawers lead with verdict + action` (on top of B3's `8783946`)
- Not pushed. Worktree clean after commit.

## Implementation summary

Extended B2's verdict totem to the five entity drawers through one shared helper,
`drawerVerdictHead({ eyebrow, title, sub, action })`, which owns the
`.inspector-head.inspector-verdict` chassis: the status kicker (`dwEyebrow`) +
title (+ optional sub) in `.inspector-id`, and Close + the promoted action stacked
in `.verdict-side` / `.verdict-action`. Every drawer now opens with verdict +
action BEFORE any evidence/detail, mirroring the agent drawer. The agent drawer
keeps its own richer head (provider rail, `renderStatusLine`, `verdictGate`); the
five entity drawers share this one — one helper vs. five hand-rolled near-identical
blocks.

Three small data/action helpers feed the heads:
- `issueHeadAction(issue)` — the promoted lever for intervention/advisory. Queued
  investigation → `Launch` (`head:run:<id>`); not-yet-triaged → `Triage`
  (`head:triage:<id>`); anything in flight → null. Reuses the same `triageIssue(...)`
  calls the body controls use; the `head:` fkey prefix (B2 convention) keeps the key
  distinct from the body twin.
- `investigationHeadAction(item)` — the queued-run `Launch` (`head:run:<issueId>`),
  null unless queued.
- `programRollupLine(program)` — the swarm-at-a-glance line, aggregated client-side.

## Per-drawer decisions (with evidence)

**Intervention** — head = `dwEyebrow("ember", "intervention", work.label)` + issue
title + `issueHeadAction(issue)`. `workStateBanner` → `impactBlock` → Fix block
(`renderTriage`) all stay below, byte-untouched. The head is a compact shortcut to
the same triage lever the Fix block owns (B2's head+body pattern, distinct fkeys).

**Advisory** — head = `dwEyebrow("amber", "warning", "Advisory · " + work.label)` +
title + `issueHeadAction(issue)`. Guards below intact. Live DOM (screenshot)
confirms: verdict head → `dw-work work-watching` → `dw-lead--quiet` → `dw-affects` →
`controls-row`; head action fkey `head:triage:system:cursor-model-policy-recent`,
body button fkey `escalate:system:cursor-model-policy-recent` — distinct, no
collision.

**Investigation** — head = `dwEyebrow("slate", "broadcast", "Investigation · " +
stateLabel)` + `item.headline` + `investigationHeadAction(item)` (the queued `Launch`).
The full-width body `Launch read-only Luna` stays (kept intact — surgical; the head
is a shortcut, `head:run:` vs the body `run:`). Head → `dw-status` → steps.

**Resolved** — head = `dwEyebrow("moss", "check", "Resolved")` + title, **no action**.
The resolved drawer has no reopen/inspect control in source, so per the contract none
was invented. Test (a) pins this: `renderResolvedDrawer` contains no `issueHeadAction`
and no `action:` key.

**Program** — head = `dwEyebrow("ink", null, "Program")` + `programName(program)` +
`sub: programRollupLine(program)`. The rollup line is the swarm glance: agent count,
working count, alert count (all always derivable, shown even at 0), and aggregate
**session** tokens (`sum of agent.tokens.sessionTotal`) — **omitted honestly** when no
agent on the client reports `sessionTotal`. Values ride `dw-rollup-value mono`; unit
words are ui/`--faint`; the alert cell earns ember ink when `needsYou > 0`. Because the
head now owns the numeric glance, the body meter's redundant `dw-impact` caption
(`rollupParts(...).join(" · ")`) and its now-unused `const r` were removed — the
segmented `svgSegmentMeter` (the unique visual) and its `N agents` label stay. Live
DOM (screenshot): `dw-accent--ink | inspector-head inspector-verdict | dw-block |
detail-grid | controls-row | roster`; rollup line rendered `4 agents · 0 working ·
1 alert · 32.9M tokens`, values classed `dw-rollup-value mono`, the alert cell
`is-alert` (ember). Broadcast stays a body control (`prog-broadcast:`), not promoted.

### Selection rationale (per the "surface if ambiguous" note)

The issue drawers have several controls (generate / queue / launch inside `renderTriage`,
plus the advisory's `escalate` ghost button). I promoted the **top lever only**:
generate-triage when un-triaged, queued-run Launch when a run is queued, else null. The
rich multi-state Fix/Triage block stays intact in the body (it carries the plan, queue,
launch sub-flow and results). This mirrors B2's agent head (a single promoted Focus
alongside the full dock) rather than hoisting the whole block. Investigation's sole
body action (Launch) was promoted as a shortcut with the body button kept — no removal,
so no behavior regressed.

## Helper-vs-duplication balance

One shared `drawerVerdictHead` (the identical chassis across five drawers) plus three
small per-type feeders (`issueHeadAction`, `investigationHeadAction`,
`programRollupLine`). The chassis is genuinely identical, so it earns extraction; the
feeders differ per type (triage lever vs. queued-launch vs. rollup aggregation), so they
stay separate rather than forced into one contorted function. No premature abstraction.

## Audit findings closed (inspector scope)

1. **Dead `.state-pill` / `.inspector-state` CSS** — removed (14 unreferenced rules;
   grep-confirmed no refs in app.js/index.html/tests). This also cleared the only
   `#fff`-on-a-fill in the per-type section (`.state-pill.policy-mismatch`), closing the
   `#fff`-vs-`--surface` finding there. The live `.policy-chip` `#fff` is in agent-rows
   (WS-C) and left untouched.
2. **`.control-banner` dual-red-token** — conformed to the **settled ruling** (`--failed`
   ink + `--ember-soft` tint is sanctioned). The border/icon/tint were already
   conformant; the stray was `.control-banner-link { color: var(--ember) }`, changed to
   `var(--failed)` so the banner uses exactly one red ink over the one sanctioned tint.
   No third scheme; no `--failed-soft` token invented (ESCALATE option b).

## Conflict resolution — rollup label font

The brief's binding constraint reads "Mono only for values; labels ui/`--faint`." I made
the rollup **values mono** (unambiguous, and what test (c) asserts) and the **unit words
ui/`--faint`** — reading the rollup as inline value+unit pairs (`14`‑mono + `working`‑ui),
which satisfies the constraint literally and reads clean. (The kicker-style `.vital-label`
mono micro-labels are a different role; the rollup line is not a kicker.)

## TDD RED → GREEN

New describe block `per-type drawers lead with verdict + action (B4)` — 6 tests, written
first.

**RED** (`bun test -t "B4"` before implementation): 5 fail for the right reasons, 1 passes
as an honest already-true regression guard (disclosed):
```
✗ (a) every entity drawer opens with a shared verdict-head block   (drawers still call drawerHead)
✓ (b) regression guard: workStateBanner + impactBlock still render  (already-true guard — disclosed)
✗ (c) program head carries the rollup vitals with mono values       (M.renderProgramDrawer is not a function)
✗ (c2) the token cell is omitted honestly …                         (same — not exported / no rollup)
✗ (d1) dead .state-pill / .inspector-state CSS removed              (.state-pill still present)
✗ (d2) control-banner conforms to --failed ink + --ember-soft tint  (link still var(--ember))
```
One RED iteration on (d1): the first assertion `not.toContain("color: #fff; background:
var(--failed)")` wrongly caught the live `.policy-chip` (agent-rows, out of scope); scoped
the `#fff` check to the inspector per-type section slice instead.

**GREEN** (`bun run check`):
```
bunx tsc --noEmit ✓
260 pass / 0 fail / 1058 expect() calls — Ran 260 tests across 20 files
```
254 pre-existing + 6 new; none skipped or filtered.

The program-drawer test (c/c2) is executable, not grep: it exports `renderProgramDrawer`,
builds it under the B2/B3 `withDom` fake-document idiom against a small program of fake
agents, walks the built node tree, and asserts the verdict head, the `dw-rollup-value mono`
class, the aggregated text (`3agents`/`2working`/`1alert`/`30k`/`tokens`), and honest token
omission when no agent reports `sessionTotal`.

## Files changed

- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-inspector-totem/src/web/app.js`
  — 4 head helpers before the drawers; 5 drawer heads rewritten to `drawerVerdictHead`;
  program body de-duplicated; `renderProgramDrawer` + `programRollupLine` exported.
- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-inspector-totem/src/web/styles.css`
  — `.verdict-action .dw-head-action` + `.dw-rollup*` in the per-type section; dead
  `.state-pill`/`.inspector-state` block removed; control-banner link `--ember`→`--failed`;
  `.verdict-action .dw-head-action` added to the 44px touch sweep.
- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/luna-inspector-totem/tests/web-client.test.ts`
  — new B4 describe block (6 tests).

## Visual QA (browse skill, preview :4711, killed after)

Live data had 70 programs and 2 advisories (warning issues) but 0 error-severity
interventions, 0 queued investigations, 0 recentlyResolved — so intervention /
investigation / resolved are **absent from live data**. Per the brief's fixture-fallback
rule (A4/B2 precedent), those three are covered by the source-ordering test (a) and the
executable program test (c); the two present types were screenshotted.

- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/b4-after-program.png`
  — 1440×900, program drawer. Totem: `PROGRAM / anthill-pulse`, rollup line
  `4 agents · 0 working · 1 alert · 32.9M tokens` (mono values, ember alert), Close in the
  verdict side; segmented meter below with no redundant caption; PATH, Broadcast, Roster.
- `/Users/emilionunezgarcia/Developer/the-mountain-lanes/qa-baseline-20260722/b4-after-advisory.png`
  — 1440×900, advisory drawer. Totem: amber `ADVISORY · WATCHING` + title, compact `Triage`
  head action under Close; `WATCHING` banner + `IMPACT` block below (guards intact); body
  `Triage this advisory` control.

Verified live: verdict head present and first in both; head action fkey `head:triage:…`
distinct from body `escalate:…`; head action `min-height` 32px at 1440px and **44px at
900px** (touch sweep); zero console errors on load and after each drawer opened.

## Self-review

- **Five drawers on the totem** — verified in source (test a, per-function ordering) and
  live DOM (program + advisory screenshots).
- **Guards byte-untouched** — `git diff` touches no `workStateBanner`/`impactBlock` body
  line (grep of the diff for their bodies returns 0); both still `pane.append(...)`-ed in
  intervention + advisory (test b quotes the call sites).
- **Helper-vs-duplication balance** — one shared chassis + three genuinely-different
  feeders; defensible both ways.
- **Audit findings closed exactly** — dead pill CSS + its `#fff` gone; control-banner
  unified to `--failed` ink over `--ember-soft`; nothing outside inspector scope touched
  (agent-row washes = WS-C, `.policy-chip`/`.btn.primary` `#fff` left alone).
- **Test output pristine** — 260 pass / 0 fail, none skipped; typecheck clean.

## Concerns

1. **Head + body twin controls** (advisory/intervention/investigation): the promoted head
   lever and the full body control both render in some states (e.g. advisory shows head
   `Triage` + body `Triage this advisory`). This is the sanctioned B2 head+body pattern
   with distinct `head:` fkeys, and visually the head action is compact while the body is
   the full control — but it is two triage affordances on screen at once. Intentional
   ("act from the top"); flag if a reviewer prefers the head to suppress the body twin.
2. **Program "0 working / 0 alerts" shown when zero**: the count cells always render
   (only the un-derivable token aggregate is omitted, per the contract's literal wording).
   A stricter calm-collapse reading might omit zero cells; I kept them as honest instrument
   readings. Easy to flip if desired.
3. **Absent live types** (intervention/investigation/resolved): no live data to
   photograph; covered by the source-ordering test and the executable program test, per
   the brief's fixture-fallback rule. Not visually confirmed in a running app.

---

## Review fixes — dead-class assertions, confirm parity, orphan cleanup

Commit: `44bf8ad fix(inspector): dead-class assertions, head/body confirm parity, drop orphaned drawerHead` (on top of `f83e85e`). Not pushed. Worktree clean.

### 1. Dead-class safety (Important) — FIXED

The B4 report claimed grep showed no JS reference to `.state-pill`/`.inspector-state`; that claim was not suite-backed. Re-verified by grep (`grep -n "state-pill\|inspector-state" src/web/app.js src/web/index.html` → no matches), so no surviving reference to remove. Backed it in the suite: test `(d1)` now also asserts `source` (app.js text) and `html` (index.html text) contain neither `"state-pill"` nor `"inspector-state"` as class strings. Had a reference survived, it would have been a live unstyled-element bug once the CSS was deleted; the assertion now guards that.

### 2. Confirm parity (Important, controller ruling) — DETERMINATION: body fires directly, no confirm gate → head is parity-correct as-is

Trace (exact source cites, `src/web/app.js`):

- **`triageIssue(issueId, action)` — lines 1623-1661.** The single entry point for every triage/queue/run control (head and body). It dedups on `state.triagePending`, `POST`s `/api/triage/<action>`, and updates state. **No `window.confirm`, no `state.confirming`, no `NEEDS_CONFIRM`.** Its own comment (lines 1650-1652) is explicit: *"queueing is bounded and persistent, and launch stays a separate explicit operator action, so the extra click was a dead stop, not a safety gate."* Launch/queue are deliberately un-gated.
- **The confirm mechanism is scoped to `renderDockTool`.** `state.confirming` is set only at line 3772, inside `renderDockTool`, and only when `NEEDS_CONFIRM.has(action)` — and `NEEDS_CONFIRM = new Set(["interrupt", "archive"])` (line 3627). The confirm strip (`state.confirming === fkey`, line 3748) and the Escape-restore (lines 4942-4946) all live in that dock path. Triage/queue/run controls are plain buttons that never call `renderDockTool`, so they cannot enter the gate.
- **Body twins fire directly:** `renderTriage` generate (line ~1908), queue (~1928), run/"Launch read-only Luna" (~1940); the advisory "Triage this advisory" escalate (~3159, `onclick: () => triageIssue(issue.id, "generate")`); the investigation body launch (~3206, `onclick: () => triageIssue(item.issueId, "run")`). All are bare `onclick: () => triageIssue(...)`.
- **Head twins fire identically:** `issueHeadAction` (`triageIssue(id, "run")` / `triageIssue(id, "generate")`) and `investigationHeadAction` (`triageIssue(item.issueId, "run")`) — same direct call, same actions, `head:`-prefixed instance fkeys.

Determination: **the body genuinely fires directly with no confirm step**, so per the controller ruling ("parity is the rule, not confirm-for-its-own-sake") the head is left as-is — a `state.confirming` gate on the head would be a *divergence* from the body, not parity. No behavior changed, so no confirm-gate fixture test is warranted (there is no gate to honor). Instead, new test `(f)` proves the parity at the source level: both head helpers and both body twins (`renderTriage`, `renderInvestigationDrawer`) contain `triageIssue(` and contain neither `state.confirming` nor `NEEDS_CONFIRM`, and the head's `triageIssue(...)` actions match the body's. It also pins `NEEDS_CONFIRM = new Set(["interrupt", "archive"])` so a future addition of a triage action to the confirm set would fail the test.

### 3. Orphaned `drawerHead` (Important) — FIXED

`grep -n "drawerHead(" src/web/app.js` returned only the definition (old line 2954); `grep -rn "drawerHead" tests/` returned nothing; and app.js minus the definition had zero references. All five entity heads moved to `drawerVerdictHead`, so `drawerHead` was a true orphan created by this migration. Deleted it (6 lines). The base `.inspector-head` class stays live — `missingDrawer()` builds a bare `.inspector-head`, and the agent drawer builds `.inspector-head.inspector-verdict` inline — so no CSS was orphaned. New test `(e)` asserts `source` no longer contains `function drawerHead(` or `drawerHead(`, that `drawerVerdictHead`'s `inspector-head inspector-verdict` div is present, and that all five entity render functions call `drawerVerdictHead(`.

### Test summary

`bun run check`: `bunx tsc --noEmit ✓`; **262 pass / 0 fail / 1093 expect() calls** across 20 files. 260 prior + 2 new B4 tests (e, f); (d1) extended. None skipped. Worktree clean after commit; not pushed.

---

## Lane-close hardening

Commit: `1bdd8cd test(inspector): harden totem regression coverage (ordering anchor, priority permutation, band re-inline guard)` (on top of the merged `f464587`). Not pushed. Worktree clean after commit. `tests/web-client.test.ts` only — mandate was tests, no code touched, no code bug found.

Closed the three test-debt items the earlier task reviews deferred:

**1. Ordering-regex hardening.** The `agentDrawer()` helper backing the drawer-order test (and two sibling tests in the same describe block) used `source.match(/function renderAgentDrawer\(pane, view\) \{[\s\S]*?\n\}\n/)` — a lazy regex that stops at the first column-0 `}\n`, with no structural guarantee that's the function's own close. Replaced it with a local `extractFunctionBody(signature)` helper that walks from the signature's opening `{` counting brace depth to the true matching `}` — immune to a stray column-0 `}` inside the body and to anything inserted elsewhere in the file. (Landmark-anchored alternatives were rejected: while scoping this I found the file's *existing* landmark-fallback idiom for this same function, lines ~1055-1056, `\n}\n\n/* One calm status` / `\n}\n\nfunction renderStatusLine`, is itself stale against the current source — neither the `renderStatusLine` landmark nor the comment sits immediately after the real close anymore, so the first alternate's lazy match over-runs past `renderAgentDrawer` into `renderShelfSection` and beyond, ~2.4KB too far. That test only uses `.not.toContain(...)`, so the over-match didn't produce a visible failure, but it's the same class of latent bug — noted here, not fixed, since it's outside the three mandated items and touching it isn't surgical to this task.) Proof of non-vacuity, done by script before committing, not left as a permanent assertion:
  - Compared the new brace-counted body against the old regex's match on the real file today: identical content (old regex's trailing `\n` is the only diff) — length 3419 (old) vs. 3418 (new, sans trailing newline). Confirms the hardened extraction yields the same body today.
  - Simulated "a future top-level helper inserted mid-file" by splicing a synthetic `function futureHelper(x) { return { a: 1 }; }` immediately after `renderAgentDrawer`'s true close, in a copied string (never touched the real file): re-ran the extraction against the mutated source and confirmed the returned body is byte-identical to the pre-mutation body. This is the non-vacuity/truncation check — a truncated extraction would have gone shorter or the ordering `indexOf`s would have gone to -1; neither happened.
  - The existing `expect(drawer).toBeTruthy()` in the ordering test still guards against an empty/failed match; the length/mutation comparisons above additionally guard against a *truncated-but-truthy* match, which `toBeTruthy()` alone would miss.

**2. Head-action priority permutation.** Added a `bothEnabled` fixture (`controls: [{action:"focus",enabled:true},{action:"interrupt",enabled:true}]`) inside the existing `withDom` "headPrimaryAction" test (renamed to include "both enabled → focus wins"), asserting `headPrimaryAction` returns the focus tool (`dataset.fkey === "head:act:codex:a1:focus"`), not the interrupt tool. Previously the safe-locked/focus-only/interrupt-only/absent fixtures never enabled both levers at once, so the priority order in `headPrimaryAction`'s `if (focusCap && focusCap.enabled) … else if (interruptCap …)` was only exercised branch-by-branch, never head-to-head.

**3. Post-rename sibling assertion gap.** `expect(operate).not.toContain("renderVitals(")` (Take A shelf test) predates the B3 vitals-band rename and no longer catches `renderOperate` calling `renderVitalsBand(` — a different substring. Added `expect(operate).not.toContain("renderVitalsBand(");` alongside it, mirroring the sibling `evidenceShelf` assertions three lines above that already check both spellings.

### Test summary

`bun run check`: `bunx tsc --noEmit ✓`; **276 pass / 0 fail / 1140 expect() calls** across 20 files (276 test-count unchanged from the pre-hardening `f464587` baseline — all three items extended existing `test()` blocks rather than adding new ones, so expect() count rose 1137→1140 but test count did not; verified by diffing `bun test` output against `f464587`'s copy of this file: 654→657 expect() calls within `tests/web-client.test.ts`, 123 tests both times). None skipped, none `.only`. Worktree clean after commit; not pushed.

No real code bug surfaced. The stale-landmark over-match noted in item 1 above is source-adjacent test debt in a *different* test than the one mandated, left as a flagged observation per the surgical-changes mandate.
