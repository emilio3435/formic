# VERIFY — TINT-G (cmux sidebar group mirror)

Adversarial, read-only against `feat/tint-g` at `d414cfe` (`06d385c..HEAD`). Original tree not mutated. Floor run here: `bunx tsc --noEmit` exit 0; `bun test tests/cmux-groups.test.ts` → 17 pass / 0 fail.

## Claims — attempted refutation

| Claim | Result |
|---|---|
| Reconcile is per-window; membership = all repo-mapped workspaces; dissolve when a repo empties; full teardown when `mirrorGroups` goes off | **Stands.** Windows enumerated then `workspace.list` + `workspace.group.list` per window (`src/server/cmux-groups.ts:303-328`, loop at `:371`). Buckets every mapped non-anchor workspace (`:383-391`). Empty-repo dissolve is `workspace.group.ungroup` (`:510-515`). Flag-off walks provenance and ungroups live owned groups only (`:355-364`). |
| Anchors exempt from filing AND removal | **Stands.** All window anchors skipped at bucket time (`:376-385`). Remove loop skips `live.anchorWorkspaceId` (`:462-463`). Covered by the two anchor tests. |
| `group.delete` never called; `ungroup` is the only teardown | **Stands.** RPC methods issued: `window.list`, `workspace.group.list`, `workspace.list`, `create`, `add`, `remove`, `rename`, `ungroup`. No `workspace.group.delete`, no `close_workspaces`, no `workspace-action`. Teardown helper is ungroup (`:345-353`). FakeCmux `default` throws if delete is asked. |
| Provenance = recorded group ids, never name-matching | **Stands.** `ourGroups` is provenance filtered by recorded `groupId` still live (`:393-394`). Existing group is `liveGroups.get(existing.groupId)`, not a scan of `group.name` (`:397-398`). Record happens only after a successful create parse (`:423-425`). Flag-off / annex tests seed a user group *named* `the-mountain` and leave it untouched. |
| Colors flow only via TINT-F's `setGroupColor` | **Stands.** Color writes are `inputs.setGroupColor` (`:491-503`). Zero `workspace.group.set_color` RPCs. Funnel type is declared locally so this branch does not import `cmux-color.ts`. |
| `repoGroupReconcileTick` returns null and issues zero cmux calls until `registerRepoGroupInputs` — by design | **Stands.** Guard at `:550-553`. `registerRepoGroupInputs` is called only from tests. `state.ts` calls the tick (`src/server/state.ts:714`) but never registers inputs. Test: "does nothing, and touches no cmux, until inputs are registered". Do not treat as dead code. |

## Additional targets

### 1. Idempotence — stands
Second pass over identical fixture state: `mutations === 0` and funnel write count unchanged (`tests/cmux-groups.test.ts:258-277`). Hex compare is normalized (`src/server/cmux-groups.ts:487-490`), so `#5F7F2A` vs `#5f7f2a` is not drift (`tests/cmux-groups.test.ts:280-297`).

Mutation in a throwaway copy (`/tmp/tint-g-verify-copy.wixw0o`), never the original: replaced `normalizeHex(live.customColor) !== desiredHex` with `live.customColor !== desired.hex`. Both tests went red:

- "a settled sidebar issues zero mutations on the next pass" — Expected `0`, received `1`
- "a color that differs only in case is not drift" — writes length Expected `1`, received `2`

### 2. Failed `group.add` still recorded as filed — stands
Failure path pushes an error and `continue`s without `confirmed.push` (`src/server/cmux-groups.ts:445-449`). `filed` is built from `confirmed` only (`:507`).

Mutation in the same copy: `confirmed.push(workspaceId)` on the failed-add branch. Test "a failed add never records the workspace as filed" went red: `filed["the-mountain"]` received `["ws-a", "ws-b"]`, expected `["ws-a"]`.

### 3. Path to `group.delete` or closing a workspace — none found
No production call site. Empty-repo and flag-off both `ungroup`. `group.remove` is only issued for non-anchor members of a group we created (`:456-472`). Live smoke in the lane report (not re-run; would mutate Emilio's sidebar) already showed ungroup keeps workspaces.

### 4. Annexation by name — none found
Lookup is provenance id → live group. Rename/color only that id. A user group whose *name* equals a repoKey is not selected, not recolored, not dissolved.

### 5. Hollow tests — not hollow on the two mutations checked
17 tests present and passing. Two claimed mutation-sensitive tests are actually mutation-sensitive (evidence above). FakeCmux models live cmux (anchor-destroy on remove, window-scoped create, detach-on-add); it is not a call recorder that would green-light a wrong reconcile.

### 6. Throw inside the tick vs `#performRefresh` — stands
Call site is `void repoGroupReconcileTick(...)` inside the collector aggregate continuation, not `await`ed (`src/server/state.ts:709-714`). Inner reconcile throws are caught (`src/server/cmux-groups.ts:556-563`).

Throwaway script in the copy:

- `registerRepoGroupInputs(() => { throw new Error("tick boom from provider") })` then `await state.refresh({ cmux: true })` → `refreshThrew false`, snapshot returned.
- Runner that throws inside `reconcileRepoGroups` → tick returns `null` (logged, not thrown).

A provider throw *does* become an unhandled rejection (provider() sits outside the tick `try` at `:550-553`, and `state.ts:714` has no `.catch`). That does not reject `#performRefresh`. Residual, not a gate: nothing on this branch registers a provider.

## Residual notes (non-blocking)

- `JsonRepoGroupProvenanceStore` matches `JsonAttentionStore`'s temp+rename persist (`src/server/cmux-groups.ts:133-138` vs `src/server/cmux.ts:190-196`) but has no unit tests; `loadError()` is logged at open and never folded into `result.errors`. Latent until integration wiring.
- `add` / `remove` / `rename` / `ungroup` treat exit 0 as success without parsing JSON. The "unparseable JSON is a failure" comment is fully true for create/list only. A lying exit-0 add would be filed. Same shape as most of this repo's RPC helpers.
- `ARCHITECTURE.md` is outside the strict GOAL fence; `tests/reference-docs.test.ts:113-114` requires naming every `src/server/*.ts`. Necessary, not scope creep.

## Not reported (per brief)

`tests/cross-source-token-agreement.test.ts` red is fleet-state dependent and expected on every TINT lane tonight.

VERDICT: PASS The sidebar mirror matches the contract: per-window, id-provenance, ungroup-only teardown, funnel colors, inert until registration, and the two mutations I planted in a copy turned the tests they claimed to protect.
