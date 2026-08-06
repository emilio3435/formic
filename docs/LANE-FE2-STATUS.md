# Lane FE-2 status

[23:44] ACK AMENDMENT 1 — read before D3 was built, as instructed. Effects on
work already in flight: (a) the menu primitive gains a checkbox mode
(`menuitemcheckbox`, toggle keeps the menu open) alongside the radio mode
already written; (b) D3 is re-planned as five multi-select lens axes over
set-valued state (`facetProviders`/`facetStatuses`/`facetModels`/`facetSpans`/
`facetContexts`), with every scalar reader migrated; (c) A3 (`ri-scope-mark`)
lands as its own commit. No radio-semantics rework is stranded — the primitive
was still unwired to the lens axes when the amendment arrived.

[23:44] DIVERGENCE (A1 scope) — the TIME menu keeps radio semantics and keeps
closing on select. A1 says multi-select supersedes radio "everywhere", but its
own sentence scopes it to "every LENS menu", and time is not a lens: it is the
working-set control, single-valued by construction (one lookback window, one
`state.lookbackHours`). A checkbox time menu would have to answer "1h AND 7d",
which is either a union that means 7d or a contradiction that means nothing.
Radio there is strictly more faithful to the two-layer model this lane exists to
draw. Provider/Status/Model/Span/Context are all checkbox, as amended.

[23:44] DIVERGENCE (D1) — `state.openFilterMenu` is deliberately NOT threaded
into `programsPaintSig`, against D1's parenthetical. Two reasons, both measured
against the code rather than argued:
  1. It is not needed for the stated goal. `renderFilterBar()` is called
     UNconditionally from `render()` (app.js), outside the programs paint guard,
     so an open menu already survives every repaint. The guard it would be added
     to governs `renderPrograms`, which paints no part of the bar.
  2. It would introduce a real defect. The outside-click dismissal fires on
     `mousedown`; with the flag in the signature, that dismissal would rebuild
     the board's rows before the `click` reached them, so dismissing a menu by
     clicking a row control would silently eat that control's activation.
Logged rather than silently done. The failure class D1 was guarding against
(toggle-mutates-nothing-else, cf. toggleRepo/toggleSwarm/toggleShelf) is real,
but it applies to controls painted INSIDE the guard; this one is not.

[23:44] DIVERGENCE (D2 placement) — the Time trigger is the right-aligned last
control of the filter bar, i.e. the contract's own fallback, not the preferred
`#views` tab-row mount. `index.html` was clean of foreign hunks when I checked,
so co-tenancy was not the blocker; the blocker is behavioural: `#views` owns a
roving-tabindex tablist and `handleCockpitKeys` intercepts Left/Right/Home/End
for anything inside `#views`, so a dropdown mounted there would fight the tab
strip for its own arrow keys. Consequence for the fkey-order pin: the order is
`session-kind:review → provider:menu → status:menu → … → lookback:menu`, with
time LAST rather than mid-bar. D2's "right-aligned last control" instruction and
the Tests section's mid-bar sketch disagree; D2 is the specific one and wins.

[23:44] NOTE (D2 side-effect) — `.filter-bar` lost `overflow-x: auto` and became
`flex-wrap: wrap`. Forced, not cosmetic: an overflow container clips absolutely
positioned descendants, so the first dropdown to open would have been clipped
inside the bar that opened it. The horizontal scroll existed for fifteen chips;
the bar now holds four controls.

[23:52] D1+D2 DONE 46cdbad — time menu (Hours/Days/Everything/Custom), menu
primitive with both radio and checkbox modes, workingSet() as the single
count derivation, QUICKSTART + reference-docs pins updated for the retired 36.
Suite green except a co-tenant's untracked docs/a11y-geometry-gate test, which
needs a live board on a random port and is not this lane's.

[23:52] NOTE (orchestrator addition, accepted) — the Days caveat now carries the
scan window's real number, read from `snap.scanWindowHours` ONLY. When no
snapshot has confirmed one the sentence still renders without a figure: state
.scanWindowHours holds an unconfirmed client-side 36, and printing it as a
boundary is the overclaim renderScanWindow was fixed to stop making.

[00:01] AMENDMENT 2 DONE e919831 — Select-to-send and Action log buttons
removed, with their wiring, their renderTabs/renderActionsPanel maintenance,
and their CSS (the census forbids orphan classes, so those rules could not
stay). Machinery dormant as instructed. Action log is now genuinely
UI-unreachable; SELECTION IS NOT — a program drawer still enters it.

[00:01] DIVERGENCE (Amendment 2, addition not removal) — the broadcast bar
gains a "Done selecting" button. The deleted toolbar button was ALSO the only
exit from selection mode (it wore "Done selecting" as its second label), and
selection stays enterable by mouse from a program drawer. Removing it as
specified would have shipped a state a pointer-only operator can enter and not
leave, with Escape as the sole way out. This is the orphan the removal created,
repaired in the surface that is visible exactly while the mode is on. Pinned by
test, including that "Clear all" is deliberately NOT that exit.

[00:01] CROSS-LANE EVENT — commit 6d8a567 (the Burn/Cost lane) swept two of my
uncommitted `tests/web-client.test.ts` hunks into its own commit: the
structural-anchors absence pins (@3209) and the removed-button style pin
(@4927). Nothing was lost and the branch is correct, but the Amendment 2 test
changes are SPLIT across 6d8a567 and e919831 — noted so the archaeology works.
My own staging held: 46cdbad was hunk-filtered and carries none of their work.

[00:34] D3 + AMENDMENT 1 + A2 DONE 43dcdc7 — five multi-select lens axes
(Provider · Status · Model · Span · Context) over set-valued state. LENS_AXES is
a TABLE: the menus, the filter predicate, the counts, the shelf exemption and the
sentence all read it, which is what makes "every axis filters by the rule it
counts by" assertable rather than merely intended. Span reads liveElapsedMs,
split out of liveElapsedText so the lens and the SPAN cell are provably one
number.

[00:34] DIVERGENCE (A2, additive) — Span gains an "Unreported" member, which A2
specified for Context but not for Span. Rows with no measurable elapsedMs are a
real population; without the member they would match no bucket and vanish behind
a filter with no item able to un-hide them. Same reason Context has one, same
reason this board names Unverified at all.

[00:34] NOTE (D3 applicability rule) — an axis renders when ≥2 of its options are
POPULATED in the working set, or when the operator has already narrowed it. First
half generalises the old provider rule ("a filter whose only option is everything
is furniture"); second half is not optional — a lens with no visible way off is
the one thing this bar may never ship. Consequence: an empty board carries only
the Time control, and the fkey-order pin now says so.

[00:41] A3 DONE 32eed36 — tokens ⓘ removed, qualification kept in aria-label and
title. Orchestrator nit (leftover tombstone comment in styles.css) swept in
f905254.

[00:48] D4 DONE f905254 — review policy is now `⊘ N reviewers hidden` /
`⊘ showing N reviewers`, class .filter-policy, no aria-pressed, title states it
is a fleet setting shared by every browser.

[00:59] D5 + D6 DONE 73f4ce4 — the sentence, and the count rule it exists to
state. D6 pins the boundary in BOTH directions: five lenses and the query leave
count-board untouched, and the lookback moves it. The fixture carries a
three-hour-old session for the second half, or "time moves the count" would pass
vacuously.

[01:06] LIVE VERIFICATION on the running board (127.0.0.1:4701), not just the
DOM-less suite. No console errors. Measured:
  - bar renders `⊘ 21 reviewers hidden · Provider ▾ · Status ▾ · Model ▾ ·
    Span ▾ · Context ▾ · Last 6h ▾`
  - Working AND Waiting both ticked, menu STAYED OPEN across both toggles,
    trigger read "Status: working+waiting" — the operator's actual ask
  - tab count held at 25 through every lens state (D6 live)
  - sentence read "Showing working sessions — 7 of 25 · Clear" against exactly
    7 rendered rows
  - Clear reset the lens and left BOTH "Last 6h" and "21 reviewers hidden"
    untouched (D5's two exclusions)
  - counts partition the working set: working 7 + waiting 18 + unverified 0 = 25
    = workingSet() = tab. An earlier read showed working=6 against 7 rows; on
    re-measure through the test seam it was live drift between two reads on a
    board with agents actively working, not an off-by-one. Measured before
    reporting rather than assumed either way.

[01:06] SUITE — `bunx tsc --noEmit` clean; `bun test` 2842 pass / 3 fail. All
three failures are foreign: two are a co-tenant's red-on-purpose TDD pins in the
uncommitted "Board all-clear is reachable" block, one is
docs/a11y-geometry-gate/, which needs a live board on a random port. Every hunk
of theirs survived all six of my commits (verified after each).

[01:10] SUITE, RE-MEASURED — the line above went stale within minutes and is
corrected rather than left standing. The all-clear lane landed its fix (9ebb698)
and origin/main merged in (28e306c), so both of its reds went green: `bun test`
is now 2844 pass / 1 fail, `bunx tsc --noEmit` still clean. The single remaining
failure is docs/a11y-geometry-gate/notification-center-geometry.test.ts, which
boots its own board on a random port and never gets an answer — foreign, and
already parked by the lane that owns it.

[01:10] MERGE CHECK — all six FE-2 commits re-verified as ancestors of HEAD after
28e306c: 46cdbad, e919831, 43dcdc7, 32eed36, f905254, 73f4ce4. Nothing of mine
was lost or rewritten by the merge.

[01:10] LANE DONE
