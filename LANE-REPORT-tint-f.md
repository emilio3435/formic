# LANE-REPORT-tint-f

Lane: **TINT-F · Foundation** — board tint + assignment + cmux fan-out funnel.
Branch: `feat/tint-f` · Worktree: `~/Developer/the-mountain.worktrees/tint-f`
Sub-orchestrator: Opus 5 high. 2026-08-13, ~01:00–02:10 CDT.

Swarm size: **one** (master plan §4 permits it explicitly). The fence is four
tightly coupled files — `repo-color.ts` → `settings.ts` → `app.ts` routes →
`app.js` render all read one another's shapes — so a second worker would have
cost more in merge coordination than the work itself.

## 1. What this lane was

Implement repo-identity colour on the board side, end to end:

- the frozen contract in `src/shared/repo-color.ts` given real bodies;
- the single funnel `src/server/cmux-color.ts` that every cmux colour write in
  the whole program goes through — TINT-G and TINT-S build against it;
- persistence plus `GET` / `PUT` / `DELETE /api/repo-colors`;
- Whisper on the grouped repo bands, Signal on the flat Needs-you strip, with
  attention always evicting repo tint (authority rule 5).

Three commits: `c047ef5` foundation (deliberately first, so S and G integrate
early), `8932bee` board, `be4cd41` the group-write fix below.

**Round 2** (02:00–02:35): the Grok verifier returned BLOCK. Report at
`.lane-evidence/VERIFY-tint-f.md`. All five findings fixed in `ccef942`; see §2a.

## 2. Which claims went red first (named)

1. **`withAssignments` stored the palette's own spelling.** `REPO_PALETTE` is
   written `#5F7F2A`; the store lowercases on read. So an assignment held
   `#5F7F2A` in memory and `#5f7f2a` after a reopen — the hex-case trap the
   ground rules name, and the seed of a write loop. Red on *"ensure is
   idempotent and survives a reopen"*. Normalized on the way in, at the last
   place that can be sure.
2. **The overflow loser was order-dependent in my head, not in the code.**
   *"six repositories … the seventh wears clay"* went red because with seven
   FRESH repositories the lexicographic rule hands the clay to `the-mountain`,
   not to `seventh-repo`. The code was right and the claim was wrong; the test
   now pins which repository overflows, proves the answer is identical in both
   discovery directions, and a sibling test covers the sticky case where an
   established repository keeps its hue and the newcomer takes the clay.
3. **`tests/reference-docs.test.ts` went red on the whole branch.** It requires
   every `src/server/*.ts` module to be named in ARCHITECTURE.md, and
   `cmux-color.ts` was not. That red was mine; ARCHITECTURE.md now carries the
   funnel and the colour half of `settings.ts`.
4. **`setGroupColor` was a silent no-op — the worst defect of the night, and it
   was green.** `workspace.group.set_color` takes `{group_id, hex}`. The funnel
   was sending `color`, taken from the CLI's own `--color` flag. `color` is
   *accepted*: exit 0, no stderr, `custom_color: null`, and nothing changes. So
   is `custom_color`. Every unit test passed and every group in cmux would have
   stayed grey forever. Caught from fleet memory `[[cmux-group-rpc-traps]]`
   (TINT-G's live verification), and the master relayed the same finding
   independently a few minutes later. Fixed in `be4cd41`: correct parameter,
   plus a read-back of the response's own `custom_color` compared by value —
   because for this RPC the exit code is not evidence.

## 2a. Round 2 — what the verifier found, and what it says about my testing

The headline is worth stating plainly: **the board never tinted, and I shipped
it with 64 green tests.** `setRepoColors(body.repoNames)` fed a
name→repoKey table into a function whose values must be `#rrggbb`, so every
entry failed `normalizeRepoHex`, the map stayed empty, and Whisper, Signal and
the pills all read `""`. The Settings region still looked right because it reads
`assignments` directly, which is exactly the kind of partial correctness that
makes a defect survive a demo.

The reason 64 tests missed it is the lesson. **Every one of them set the colour
state by hand**, so they all agreed with each other about a shape no server ever
sends — and nothing in the suite ever loaded `fetchRepoColors`. A fixture I
author and a payload the server emits are two different things, and only the
second one is a fact.

It is worse than a coincidence that `name === key` in all my fixtures: on this
very checkout they differ. Origin is `…/the-ant-hill.git`, so
`RepoIdentity.repoName` — what the band prints — is `the-ant-hill`, while
`repoKeyForCwd` reads the git common dir and answers `the-mountain`. The join
table exists *precisely* for that split. I built the table, then wrote every
test as though the split did not exist.

| # | Finding | Fix |
|---|---|---|
| 1 (BLOCK) | Two-hop join collapsed to one; board never tints | `setRepoColors(repoNames, settings)` does name → key → hex. Three new tests: a real GET envelope through `fetchRepoColors` with a stubbed `fetch`; the same through `putRepoColor`; and one asserting the collapsed form paints **nothing**, so the suite cannot be satisfied by `name === key`. |
| 2 (HIGH) | `names[name] = key` last-writer-wins, order-dependent | Per the master's ruling an ambiguous printed name **drops out of the join entirely**. Both insertion orders give the identical absent join. Both repos still get colours — the cmux fan-out keys on `repoKey`, which is never ambiguous. |
| 3 (HIGH) | Signal applied to nothing; rule-5 hole | The tick now comes from `agentRowPlan` for unbanded (interleaved) rows. Rule-5 hole closed by **withholding** identity in the strip — see below. |
| 4 (MED) | `fakeGit` never inspected argv | It now throws on `--show-toplevel` and on a missing `--git-common-dir`, so the four fake tests finally pin the worktree trap instead of passing against either flag. |
| 5 (MED) | `DELETE` did not fan out | `PUT` and `DELETE` share one `fanOutFor`, so a verb cannot quietly skip it again. |

**One order I did not follow, and why.** The master's fix for the rule-5 hole
was to set `alerting: true` in `stripRowOpts` so the row takes an ember class.
I implemented it, and it went red on
`tests/web-client.test.ts:9846` — *"Pane mode: the strip is the signal; its rows
do not double-mark."* That is a deliberate, tested decision from an earlier
lane, and overruling it is not mine to do. Withholding the tick achieves the
same guarantee: a hook-needsInput agent is alerting with a healthy outcome and
carries none of the `is-…` classes the identity selectors exclude, so an
*offered* tick would paint on it — but an identity treatment that is never
offered cannot be diluted. Hole closed, decision left standing, master flagged.

**Mutation-checked, per the verifier's own standard.** Eleven mutations in a
throwaway copy, each reverting one fix, plus the two join call sites separately.
**All CAUGHT, none hollow** — including the one that mattered:

```
BASELINE (3 live-git tests need the real worktree)  673 pass / 4 fail
1 client join collapsed (both sites)                671 pass / 6 fail   CAUGHT
1c setRepoColors ignores the hex table              664 pass / 13 fail  CAUGHT
2 ambiguous name back to last-writer-wins           672 pass / 5 fail   CAUGHT
3a interleaved rows lose the tick                   672 pass / 5 fail   CAUGHT
3b banded rows wrongly GET the tick                 672 pass / 5 fail   CAUGHT
3c strip re-offers a repo tick (rule-5 hole)        672 pass / 5 fail   CAUGHT
4 impl switches to --show-toplevel                  670 pass / 7 fail   CAUGHT
5 DELETE stops fanning out                          672 pass / 5 fail   CAUGHT
```

The first sweep reported mutation 1 as HOLLOW. That was my harness patching only
the first of two call sites — and chasing it found a real gap: nothing tested
`putRepoColor`. Fixing the harness *and* adding the second test is why 1a and 1b
are both caught above.

## 3. What shipped, file-and-fence

| File | Fence | What |
|---|---|---|
| `src/shared/repo-color.ts` | owned | `repoKeyForCwd` (git **common** dir, so every worktree of one repository collapses to one key), `assignSlot` (FNV start, first-free scan upward, null at seven), `hexForSlot`, `normalizeHex`/`sameHex`, `withAssignments`. Contract shapes untouched. |
| `src/server/cmux-color.ts` | owned (created) | The funnel: `setWorkspaceColor` / `setGroupColor` / `lastWrittenHex`, plus `configureCmuxColor` and `resetCmuxColorMemory` test seams. |
| `src/server/settings.ts` | owned | `JsonRepoColorsStore`, `normalizeRepoColors`, `repoColorDiscovery` (authority rule 4), `handleRepoColorsRequest`, `memorySettingsFiles`. |
| `src/server/app.ts` | marked block | `/* TINT-F routes */` … `/* end TINT-F routes */` for `/api/repo-colors`; a `/* TINT-F */`-marked helper block (discovery, default store, fan-out); two marked fields on `MountainAppDependencies`. |
| `src/web/app.js` | owned | The colour join, `paintRepoTint`, Whisper in `renderRepoSection`, Signal in `renderAgentRow` + `renderStripGroupHead`, `renderRepoColorSettings` + `putRepoColor`, `fetchRepoColors`, and five paint signatures taught to carry the colour. |
| `src/web/styles.css` | owned | The two treatments and the Settings region. |
| `ARCHITECTURE.md` | outside fence — forced by a test | Two table rows. See §5. |
| `tests/repo-color.test.ts`, `tests/repo-tint-render.test.ts` | owned (created) | 42 + 22 = 64 tests. |

**Design fidelity.** Whisper = 2px spine at 45% + head dot + 4% row wash + 7%
hover. Signal = 3px tick at 55% + 4% wash + quiet bordered repo pill on the
strip heading. A test asserts those four percentages against the stylesheet, so
a well-meaning nudge fails the floor.

**Authority rule 5** is enforced as `:not()` exclusions against all four
attention classes *and* selection, on all five repo row rules — not by source
order. A test extracts every repo row selector and fails any that omits an
exclusion. Rule order is a fact about a stylesheet; "attention REPLACES repo
tint" is a fact about the product.

**Authority rule 6**: a test walks every rule mentioning `--repo-tint` and fails
any that inks text with it. The marks are the spine, the dot, the tick and the
pill border.

**CSP**: the hex travels via `style.setProperty`, never a `style` attribute —
`style-src 'self'` would drop the attribute silently and the tint would simply
not appear. `tests/repo-tint-render.test.ts` carries its own fake DOM because
`web-client.test.ts`'s node has no `style` at all and would have swallowed the
one write under test.

## 4. Floor results — pasted, not paraphrased

Round 2, after the verifier's five fixes (`ccef942`):

```
$ bunx tsc --noEmit
tsc exit: 0

$ bun test
(fail) what this board counted is what a separate application recorded > the comparison actually ran against both sources [0.14ms]
 3372 pass
 1 fail
Ran 3373 tests across 180 files. [84.13s]
```

The one red is **`tests/cross-source-token-agreement.test.ts`**, and it is not
this lane's. Proof rather than assertion: `06d385c` (the branch point) was
checked out detached into a scratch worktree and the same test failed there with
the same verdict, before a line of TINT-F existed.

```
$ cd <scratch worktree @ 06d385c> && bun test tests/cross-source-token-agreement.test.ts
(fail) what this board counted is what a separate application recorded > the comparison actually ran against both sources [0.18ms]
 19 pass
 1 fail
```

It compares this machine's transcript sums against OpenBurnBar's rows — live
fleet state, no code in its path from this lane. The master independently
confirmed it is red on other TINT lanes tonight and excluded from CI gates.
`docs/a11y-geometry-gate` passed in this run.

New tests, all green (and `web-client` alongside them, since round 2 touched a
surface it owns assertions about):

```
$ bun test tests/repo-color.test.ts tests/repo-tint-render.test.ts tests/web-client.test.ts
 690 pass
 0 fail
```

Live probe of the funnel against the real binary (`.lane-evidence/funnel-probe.ts`,
bogus ids so nothing real is recoloured):

```
executable: /Applications/cmux.app/Contents/Resources/bin/cmux
workspace write -> false
remembered      -> null
group write     -> false
  log: [cmux-color] workspace 00000000-…-000000000000 → #2e66a8 (live probe) FAILED: exited 1: Error: not_found: Workspace not found
  log: [cmux-color] group 00000000-…-000000000000 → #b05f3a (live probe) FAILED: exited 1: Error: not_found: Group not found
```

cmux reached the *lookup* stage in both cases ("not_found", not "unknown flag"
or "invalid_params"), so the real binary accepts both argv shapes; the refusal
is reported as failure and nothing is remembered.

## 5. Anything unverified, including what a sandbox refused

1. **An additive field on the endpoint's response: `repoNames`.** The contract
   declares `{ settings, workspaces }`. A browser cannot run `git rev-parse` to
   derive the canonical repo key for itself, so the board joins on the
   repository name it already prints, lowercased, against this server-built
   table. The TS interfaces in `src/shared/repo-color.ts` are untouched and
   nothing S or G consumes changed shape — but the response envelope grew a key,
   and that is the master's to bless.
2. **`ARCHITECTURE.md` is outside my fence.** I edited it because
   `tests/reference-docs.test.ts` fails the floor until every server module is
   on the map, and `cmux-color.ts` is a new server module. Two table rows, no
   other prose touched. Flagged rather than assumed.
3. **`setGroupColor`'s success path is verified by reasoning, not by a live
   green write.** The failure path is verified live (above). The success path
   requires a real group, and creating one mints an anchor workspace and moves
   rows in Emilio's live sidebar at 02:00 with lanes running — outside what this
   lane was asked to do. The read-back is deliberately strict, so if a real
   success does not echo `custom_color`, TINT-G sees a loud false negative on
   its first live group write rather than a quiet false positive at deploy.
   **TINT-G should confirm this on its first real write.**
4. **The board has not been looked at with eyes.** Every treatment is asserted
   as a render and as a stylesheet rule, which is not the same thing as seeing
   it. Deploy and the visual check are the master's (master plan §6), and
   nothing here is deployed: no `launchctl kickstart`, no `?v=ah-tN` bump.
5. **Nothing pushed.** Three local commits on `feat/tint-f`.
6. **The fan-out's cadence is untested under load.** It writes only when the hex
   differs from `lastWrittenHex`, so a steady fleet costs zero cmux calls after
   the first pass — asserted in unit tests, never watched against a live fleet
   for a minute.
7. **`repoKeyForCwd` is memoized by worktree path for the life of the process.**
   A worktree that is deleted and recreated pointing at a different repository
   keeps the old key until restart. Deliberate — it saves one `git` spawn per
   agent per poll — but it is a staleness window, not an absence of one.

8. **New in round 2 — the strip's rule-5 fix diverges from the master's stated
   mechanism.** Identity is withheld rather than the row being marked, because
   marking it contradicts a tested pane-mode decision (§2a). Same guarantee,
   different lever; the master should confirm they are content with it.
9. **New in round 2 — an ambiguous printed name now shows NO tint.** Two
   repositories whose origin basenames collide leave both bands uncoloured on
   the board, while both still get colours in cmux (the fan-out keys on
   `repoKey`). That asymmetry is deliberate per the ruling, and it is the kind
   of thing that reads as a bug at a glance during the eyes-on check.

---

**Status: done, round 2.** Floor green (one proven pre-existing red), five
commits local on `feat/tint-f`, nothing pushed. Ready for delta-verification
and for the master to merge F first per the F → S → G → P order.
