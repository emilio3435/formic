# The Board's all-clear is unreachable

Found 2026-08-05 by the sentinel lane (ws:63) while auditing
`ant-hill/integration-20260804` before deleting it. **Confirmed by execution, not
by reading.** Unowned — this doc is the handoff.

## The claim

On `main` today, the rich empty state in `renderPrograms()` (`src/web/app.js`,
the block after `if (shown || !tracked) return;`) cannot render on Board under
any lookback preset.

```js
const lookbackHiding = lookbackApplies(state.view) && state.lookbackHours != null;
if (state.query || state.facetProgram || state.facetProvider || lookbackHiding || reviewsHidden) {
  // terse: "Nothing matches the current ... in this view."
} else {
  // the rich all-clear
}
```

`lookbackApplies("board")` is `true`, and `LOOKBACK_PRESETS = [1, 6, 24, 36]`
contains no `null`. So `lookbackHiding` is `true` for every preset, the first
branch always wins, and the `else` is dead on the default view.
`DEFAULT_LOOKBACK_HOURS = 6`.

The only way to reach it is the separate **"Everything"** chip, which calls
`setLookbackHours(null)`.

## What is lost while it is unreachable

Everything in the `else` branch, which this file's own comments call "the GOOD
state and the one an operator sees most":

- the verdict mark and the **"Nothing is live"** headline
- the fleet's vital signs with a ticking age — the comment explains these exist
  so an operator can tell *"nothing is wrong"* from *"nothing has loaded"*
- the open-findings disclosure and the escape hatch into History
- the **false-all-clear protection** — added after a board carrying a collector
  fault and no waiting agent rendered a check mark and told the operator to go
  home while the rail beside it counted the fault

That last one is the reason this matters more than a cosmetic empty state: the
protection was written to stop a specific wrong reassurance, and it lives inside
the branch that never runs.

## How it was measured

No DOM needed. Both modules are pure and exported:

```js
const am = await import("./src/web/agent-model.js");
const cc = await import("./src/web/client-catalogs.js");
for (const lb of [...cc.LOOKBACK_PRESETS, null]) {
  console.log(lb, am.lookbackApplies("board") && lb != null);
}
```

Run against `origin/main` (extracted with `git archive`, not the shared working
tree, which four lanes are editing):

| `lookbackHours` | `lookbackHiding` | result |
| --- | --- | --- |
| 1, 6, 24, 36 | `true` | terse line — rich state unreachable |
| `null` | `false` | rich all-clear |

## Why there is no failing test to point at

`renderPrograms()` is **not** exported on `globalThis.TheAntHill`, so it cannot
be driven directly the way `syncProgramList` can. And `grep "Nothing is live"
tests/` returns nothing — the rich empty state has no coverage at all, which is
why this went unnoticed. Whoever fixes it should decide whether to export the
function or lift the branch decision into a pure helper that can be asserted.

## Prior art — read it before redesigning

The deleted branch `ant-hill/integration-20260804` fixed exactly this. It
restructured to a `hiddenByLookback(state)` helper and disclosed the window
*inside* the rich state instead of short-circuiting past it, and it carried a
long comment describing this failure. Recover it with:

```
git show d527c75:src/web/app.js
```

**Do not merge that branch.** Its five web commits revert current `main` —
`swarmAnchorSig`/`renderSwarmAnchor` now take a `board = {}` context object where
the branch still passes `open = true`, and it would delete the T1
lineage-contradiction chips. Only the idea is worth taking.

## Ownership

Not claimed. The sentinel lane deliberately did not touch `src/web/app.js`:
several lanes edit it continuously and a competing PR would collide.
