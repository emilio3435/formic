# VERIFY2 — TINT-F round 2 (adversarial, read-only)

Scope: `git diff 6d18675..HEAD` (ccef942 code, f06b049 report). Original tree not mutated. Throwaway copy at `/tmp/tint-f-verify2` used only for the two required mutations plus the `--show-toplevel` switch. `bunx tsc --noEmit` → 0. `bun test tests/repo-color.test.ts tests/repo-tint-render.test.ts` → 71 pass / 0 fail. `bun test tests/web-client.test.ts -t "inline mode marks every row the strip would have taken"` → pass (the pane-mode assertion at tests/web-client.test.ts:9846 still holds). Known `tests/cross-source-token-agreement.test.ts` red not reported.

## The five claimed fixes

### 1. Two-hop join at both call sites — HOLDS

Production has exactly two writers into `setRepoColors`, and both pass both tables:

```3952:3952:src/web/app.js
    setRepoColors(body.repoNames, body.settings);
```

```12386:12386:src/web/app.js
    setRepoColors(body.repoNames, body.settings);
```

The join itself is name → `repoNames[name]` → `settings.assignments[key].hex`:

```7097:7104:src/web/app.js
function setRepoColors(repoNames, settings) {
  repoColors.clear();
  const assignments = (settings && settings.assignments) || {};
  for (const [name, repoKey] of Object.entries(repoNames || {})) {
    const assignment = assignments[repoKey];
    const hex = normalizeRepoHex(assignment && assignment.hex);
    if (hex) repoColors.set(String(name).toLowerCase(), hex);
```

No remaining call site feeds `repoNames` values into a hex position. A real handler envelope with `repoNames: {"the-ant-hill":"the-mountain"}` yields `assignments["the-mountain"].hex` (`#5f7f2a`); that is the hop the round-1 client discarded.

New tests: `fetchRepoColors` is driven through stubbed `fetch` (apiFetch is a thin wrap of global fetch) against an envelope of that shape; `putRepoColor` is the second call site; collapsing the hops (`setRepoColors(repoNames, {assignments: repoNames})`) paints nothing. Render tests that still call `useColors` / `setRepoColors` now pass a name→key table plus a key→hex table, not the round-1 `{name: "#rrggbb"}` fixture.

**Mutation (copy, one call site only):** `fetchRepoColors` reverted to `setRepoColors(body.repoNames)`. Result: 70 pass / 1 fail — only `fetchRepoColors passes BOTH tables from the response it just read` went red. The `putRepoColor` sibling stayed green. That is the gap the lane's first harness missed, now pinned.

### 2. Ambiguous printed name drops out, order-independent — HOLDS

`repoColorDiscovery` accumulates claimants in a `Set` and emits a name only when `claimants.size === 1` (src/server/settings.ts:576–621). Probe, both insertion orders:

- two keys, one name → `names: {}` both ways; `repoKeys` still `["the-mountain","the-mountain-fork"]`
- same plus a unique third name → `names: {"unique":"unique-repo"}` both ways; the collision stays absent

No order-dependent counterexample. Fan-out is keyed by `repoKey` (`discovery.workspaces`, then `fanOutFor`), so cmux still colours both repositories. Test at tests/repo-color.test.ts:374–396 pins the empty join both directions.

### 3. Signal tick on unbanded rows; strip offers none — HOLDS (approved deviation)

`agentRowPlan` offers the tick only when `!opts.banded` (src/web/app.js:8528, applied per row at :8636). Production wiring: repo bands pass `banded: true` (src/web/app.js:7988); flat `kind === "program"` sections take the default `banded = false` (:7970, :7993). Banded rows get Whisper via the section (`paintRepoTint` on `.repo-section`), not a per-row tick.

`stripRowOpts` sets no `repoTint` (src/web/app.js:8040–8069). Strip rows go through `renderAgentRow` with those opts (`:7961–7965`); `paintRepoTint` no-ops on a missing hex (`:7132–7133`, `:9502`). A hook-`needsInput` row (alerting, healthy outcome, none of `is-needs-you` / `is-blocked` / `is-failed` / `is-alerting`) therefore wears no tick and no wash. The heading pill remains, which is identity on the heading, not the row.

`tests/web-client.test.ts:9846` still asserts pane-mode strip rows do not get `is-alerting`. That test is green; the lane did not overrule the pane-mode decision.

**Mutation 3c (copy):** `repoTint: repoTintOfProgram(program)` re-added to `stripRowOpts`. `the strip offers NO tick` went red (`opts.repoTint` received `#b05f3a`). The web-client double-mark test stayed green — catching the identity hole does not require marking the row.

Refute attempts that did not land: strip is a sibling of repo sections (`#programs` first child), so Whisper's `.repo-section.has-repo-tint .agent-row` wash cannot leak onto strip rows. Interleaved (unbanded) non-attention rows do receive `has-repo-tick` (tests/repo-tint-render.test.ts:378–388).

### 4. fakeGit inspects argv — HOLDS (3/4 fakes; see residual)

`fakeGit` (tests/repo-color.test.ts:45–61) throws if `--git-common-dir` is missing or `--show-toplevel` is present. Production still asks only for `--git-common-dir` (src/shared/repo-color.ts:68).

**Copy switch to `--show-toplevel`:**
- `every worktree of one repository collapses to one key` — FAIL (fakeGit throw)
- `a relative common dir is resolved against the cwd` — FAIL
- `outside a repository, and on an empty cwd` — FAIL
- `git exiting 0 with nothing to say is still not an answer` — PASS (custom exec, ignores argv)
- live worktree test — FAIL (`tmp` rather than `the-mountain`)

The worktree-trap tests are no longer hollow. The empty-stdout fake was never a flag pin; it still is not. Not a remaining production defect.

### 5. PUT and DELETE share `fanOutFor` — HOLDS

One helper (src/server/settings.ts:660–671). DELETE calls it at :714; PUT at :732. The only other mutating refusal is 405 for any other verb (:694–696). No PATCH/POST write path. `createMountainFetch` registers one handler for the whole `/api/repo-colors` tree (src/server/app.ts:1227–1231).

DELETE of an override still leaves an assignment (`clearUserColor` → `withAssignments`, src/server/settings.ts:530–535), so `fanOutFor` does not early-return on the restored palette hex. Test at tests/repo-color.test.ts:562–585 asserts the restored hex is what was written.

GET still inlines its own all-workspaces fan-out (:687–691). That is not a mutating verb skipping fan-out; PUT/DELETE cannot take that path.

## Still true after the fix round

- **Hex normalization at `withAssignments`.** Palette olive is stored `#5f7f2a`, not `#5F7F2A` (src/shared/repo-color.ts:163). Probe: in-memory, on-disk JSON, and store reopen are byte-identical `#5f7f2a`. Test tests/repo-color.test.ts:431–438 still equates `reopened.get().assignments` with the pre-reopen object.
- **No inline `style=` for tint.** Source regex in tests/repo-tint-render.test.ts still holds; `paintRepoTint` uses `style.setProperty` (src/web/app.js:7132–7136). Pill text is `color: var(--muted)` (src/web/styles.css:5750); no `--repo-tint` on `color:`.
- **Funnel untouched.** Diffstat `6d18675..HEAD`: `LANE-REPORT-tint-f.md`, `src/server/settings.ts`, `src/web/app.js`, `tests/repo-color.test.ts`, `tests/repo-tint-render.test.ts`. No `cmux-color.ts` / `cmux.ts` / `cmux-groups.ts` / `cmux-color-sync.ts`.

## Residuals that did not block

- The “collapsing the two hops” test (tests/repo-tint-render.test.ts:230–236) also passes against the *old* one-arg `setRepoColors(entries)` — `normalizeRepoHex("the-mountain")` is null either way. The fetch/put tests are the real pin; mutation 1 proved it.
- `fetchRepoColors` in this file’s harness still `console.warn`s `document is not defined` from `render()` after the join. The assertion is on `repoTintFor`, which runs after `setRepoColors` and before the throw is swallowed.
- Client wire envelopes are hand-authored, not piped from `handleRepoColorsRequest`. A live handler with name≠key discovery emits the same `repoNames`/`settings` shape the stubs use.
- CSS comment at src/web/styles.css:5730 still describes Signal as “the flat Needs-you strip”; the tick now lives on unbanded rows. Comment drift only.

## Mutations (copy only)

| Mutation | Result |
|---|---|
| Revert join at `fetchRepoColors` only | 70/1 — `fetchRepoColors passes BOTH tables` red; `putRepoColor` still green |
| 3c: `repoTint` restored on `stripRowOpts` | `the strip offers NO tick` red (`#b05f3a`) |
| `repoKeyForCwd` → `--show-toplevel` | 3 fakeGit tests red + live test red; empty-stdout fake still green |

VERDICT: PASS All five round-1 defects are gone at the production sites, both required mutations go red, and the still-true pins (hex reopen, no inline tint style, funnel untouched) hold.
