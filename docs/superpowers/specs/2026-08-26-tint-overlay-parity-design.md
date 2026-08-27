# Overlay parity — repo identity vs cmux groups

**Date:** 2026-08-26
**Status:** Design locked (Emilio: overlay). Spec written; do not implement until Emilio approves this file.
**Parent:** TINT 2026-08-13 (`docs/superpowers/plans/2026-08-13-tint/00-MASTER-PLAN.md`) plus the later Teams overlay (no plan file; shipped in `team-tint.ts` / `team-groups.ts` / `team-colors.ts`).
**Investigation:** 2026-08-26 swarm + adversarial review. Verified in production files the same day.

**Goal:** One honest language. Repo colour is durable identity for ungrouped rows. A named cmux group is an overlay that takes the band and the hue, in Formic and in cmux, the same object.

**Success means:** Colouring a named cmux group in Formic paints that folder and its member terminals in cmux. Colouring that folder in cmux paints the Formic band. Ungrouped rows still group and colour by repo. Opening Settings does not repaint team members to the repo hex. TINT-G still does not mint folders.

**Stop when:** The acceptance criteria below are green on the local floor (`bunx tsc --noEmit`, targeted tests, then `bun test` minus the documented a11y-geometry exception). Cache-bust bumped. ARCHITECTURE.md matches the code. Do not deploy. Do not revive TINT-G create.

---

## Why this exists

Settings shows two palettes that both write `--repo-tint`. The board already fused grouping and colour: `teamGroups` then leftover `repoGroups`; unanimous team hex else repo. Cmux gives a workspace one group and one `custom_color`. Two nouns, one scarce resource.

The write path makes the overlay a lie:

1. `GET /api/repo-colors` fans the repo hex onto every discovery-mapped workspace, including team members (`src/server/settings.ts` 708–717, `src/server/app.ts` 497–504). Boot GET, Settings open, and live-repo-set change all trigger it.
2. Production TINT-S is a dummy. `HubState` passes fleet `HubSettings` (no `repoColors`) into `syncCmuxColors` (`src/server/index.ts:70`, `src/server/state.ts:1648-1653`). `repoColorsSettingsFrom` looks for `settings.repoColors` (`src/server/cmux-color-sync.ts:555-567`) and yields `assignments: {}`. Every workspace looks unmapped. The team-guard that “never re-asserts repo hex onto a team member” is tested and unreachable.
3. `POST /api/teams` colours the folder, not the members (`src/server/team-groups.ts:264-269`). `addOperatorMember` does not paint either.
4. Empty provenance plus `isOperatorTeam` = “not `Group N`” classifies a leftover sidebar folder named `the-ant-hill` as a Team (`src/shared/team-tint.ts:17-25`, `data/repo-group-provenance.json` is `[]`).

TINT-G minting is already dead (`if (!live) continue` in `src/server/cmux-groups.ts:438-444`). Do not bring it back. That is Tonight’s thief.

---

## Locked product sentence

**A Formic band is not always a cmux folder. Repo colour is durable identity that folders overlay.**

| Object | What it is | Owns grouping? | Owns hue? | Cmux folder? |
|---|---|---|---|---|
| Repository | Origin basename, persisted in `data/repo-colors.json` | Yes, for ungrouped rows | Yes, until a folder overlays it | **Never.** No `workspace.group.create` from this axis. |
| Cmux group (overlay) | Operator-named live folder, not `Group N`, not TINT-G provenance, not named as a known repo key | Yes: the row leaves the repo band | Yes: folder + members | Yes. Colour the folder in either product, both follow. |

Two Settings plates stay two plates. They are different lifetimes (persisted identity vs live folder). Copy must say so. Do not merge them into one list.

---

## Locked decisions

| # | Decision | Call |
|---|---|---|
| 1 | Product | Overlay. Not “one object / band = folder.” Not kill-Teams. Not kill-repo-colour. |
| 2 | TINT-G | Do not mint. Do not annex. `workspace.group.ungroup` never `delete`. Provenance by recorded id only. |
| 3 | Funnel | Every colour write still goes through `src/server/cmux-color.ts`. No direct `workspace-action set-color`. |
| 4 | Hex | `normalizeHex` before compare. Echo via `lastWrittenHex` for workspaces. Group writes still require stdout `custom_color` match. |
| 5 | Palette | Six hues + clay overflow. **Do not** share one 6-slot ledger across repos and teams. Colliding hues are accepted. Unique hues across both axes burns clay and is a later ticket. |
| 6 | Fan-out skip | GET, PUT, and DELETE `/api/repo-colors` skip workspace ids that currently sit in a live overlay team (`HubState.teams()` member ids). SameHex skip remains for everyone else. |
| 7 | TINT-S wiring | Production must pass `JsonRepoColorsStore.get()` as `{ repoColors }`, never bare `HubSettings`. Team membership is checked **before** the unmapped/`!assignment` branch. |
| 8 | TINT-S if unwired | Forbidden. Either wire it or delete the production `void syncCmuxColors` call. This spec wires it. |
| 9 | Create / add | `POST /api/teams` with a hex paints the folder **and** each non-anchor member through the funnel, and persists `source: "user"` in `team-colors.json`. `addOperatorMember` paints the new member with the live group hex when one exists. |
| 10 | Overlay predicate | A group is an overlay team iff: id not in TINT-G provenance, name not `/^Group \d+$/`, name non-empty, **and** `name.trim().toLowerCase()` is not in `repoIdentityKeys`. |
| 11 | `repoIdentityKeys` | Lowercased keys of `repo-colors.json` assignments ∪ lowercased live `agent.repo.repoName` values on the current snapshot. |
| 12 | Settings copy | Plate 1 heading **Identity**. Plate 2 heading **Cmux groups**. Kickers locked below. Same swatch chrome. No flag toggles for `mirrorGroups` / `syncFromCmux`. |
| 13 | Authority (updated TINT-S) | Overlay member → team hex when `hexSource` is `user` or `cmux`; keep observed workspace colour when team hex is `auto`. Ungrouped mapped → repo assignment. Unmapped, no team → cmux ingest, never write. Echo ignored. |
| 14 | Mapped workspace hand-colour | Board still wins for **ungrouped** mapped workspaces (TINT 08-13 rule 1). Overlay members are not “mapped for repo write.” Do not ingest a member workspace colour onto the Formic **band**. Band colour is the folder. |
| 15 | Cache-bust | `ah-t53` → `ah-t54` on every `?v=` in `src/web/index.html`. |
| 16 | Deploy | Not this spec. Preview / local floor only. |
| 17 | Window scope | Overlay teams stay per-window. No cross-window merge. |

---

## Settings copy (locked)

```
Identity
Ungrouped rows. A cmux group overrides this.
  [swatches — existing repo chrome, including is-yours / is-absent]

Cmux groups
Live folders. Colour paints the folder and its terminals.
  [swatches — existing team chrome]
  empty: No named cmux groups.
```

`aria-label` on the plates: `"Repository identity colours"` and `"Cmux groups"`. Host ids stay `#repo-colors-host` and `#team-colors-host` so paint signatures do not churn.

Empty repo copy stays `"No repository has a colour assigned yet."`

---

## Data flow after the patch

```
BOOT / Settings open / live-repo change
  GET /api/repo-colors
    ensure assignments (may mint a clay slot for a new origin)
    fan-out repo hex to discovery-mapped workspaces
      EXCEPT ids in HubState.teams() memberWorkspaceIds

PUT /api/team-colors/:id
  persist user hex
  setGroupColor(folder)
  setWorkspaceColor(each member)     — already shipped; keep

POST /api/teams { workspaceIds, name, hex }
  group.create + rename
  setGroupColor(folder)
  persist user hex
  setWorkspaceColor(each non-anchor member)

cmux collector tick
  resolveOperatorTeams(repoIdentityKeys) → overlay teams
  attachTeams onto snapshot
  syncCmuxColors({ repoColors: store.get(), teamByWorkspaceId })
    member + user/cmux hex → team-reassert if drifted
    member + auto hex + live colour → keep live (ingest)
    ungrouped mapped → repo reassert
    unmapped no team → ingest, never write
```

---

## Predicate change

Today (`src/shared/team-tint.ts:17-25`):

```ts
export function isOperatorTeam(
  name: string,
  groupId: string,
  provenanceIds: ReadonlySet<string>,
): boolean
```

After:

```ts
export function isOperatorTeam(
  name: string,
  groupId: string,
  provenanceIds: ReadonlySet<string>,
  repoIdentityKeys: ReadonlySet<string> = new Set(),
): boolean {
  if (provenanceIds.has(groupId)) return false;
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (GROUP_N.test(trimmed)) return false;
  if (repoIdentityKeys.has(trimmed.toLowerCase())) return false;
  return true;
}
```

Default empty set keeps existing tests that do not pass keys. Production always passes keys.

`resolveOperatorTeams` and `buildOperatorTeams` take the same optional set and thread it into `isOperatorTeam`.

`HubState` builds the set each cmux tick from `repoColorsReader().assignments` keys plus snapshot `repo.repoName` values. Until the first snapshot exists, assignment keys alone still exclude leftover `the-ant-hill` folders.

`handleTeamGroupsRequest` / `requireOperatorGroup` / `operatorName` must receive the same set so an operator cannot rename a folder onto a known repo key and thereby hide it from overlay (or the reverse: name a campaign `formic` and have it classified as identity).

---

## TINT-S wiring

`HubStateOptions` gains:

```ts
repoColorsReader?: () => RepoColorsSettings;
```

`src/server/index.ts` opens `JsonRepoColorsStore` once (same path as today, `data/repo-colors.json`) and injects it into **both** `HubState` and `createMountainFetch({ repoColorsStore })`. Do not open the file twice.

The production call becomes:

```ts
void syncCmuxColors({
  runner: this.runner,
  executable: this.cmuxExecutable,
  surfaces: this.#surfaces,
  settings: { repoColors: this.repoColorsReader?.() },
  teamByWorkspaceId,
});
```

Never pass `HubSettings` as `settings`.

Inside `reconcileWorkspaceColors`, for each non-anchor observation, order is:

1. Team membership (existing team hexSource rules).
2. Else `!assignment` → ingest / ignore. Never write.
3. Else match / echo / repo reassert.

Add a test: overlay member with **no** repo assignment and `hexSource: "user"` still team-reasserts. That path is unreachable today because unmapped returns first.

Keep the existing tests that inject nested `{ repoColors: { assignments } }`. Add one test that `repoColorsSettingsFrom(aHubSettingsObject)` still yields empty assignments — so a future caller cannot silently re-break production by passing fleet settings again.

---

## Fan-out skip

`RepoColorsRequestOptions` gains:

```ts
skipWorkspaceIds?: () => ReadonlySet<string>;
```

`handleRepoColorsRequest` GET write list and `fanOutFor` both drop ids in that set **before** calling `fanOut`. The JSON `workspaces` map in the GET body may still list the assignment for debugging; the client ignores `body.workspaces` today. Do not use that map to paint cmux.

`src/server/app.ts` wires:

```ts
skipWorkspaceIds: () => new Set(
  (dependencies.state.teams?.() ?? []).flatMap((team) => team.memberWorkspaceIds),
),
```

Anchors are already absent from discovery (no agent `target.workspaceId`). Do not special-case them here.

Boot GET may still run before the first cmux collect, when `teams()` is empty. That is why TINT-S must be wired: the first collect restores overlay member hexes. Skip is the steady-state guard so Settings open does not undo a team PUT.

---

## Create / add paint

`TeamGroupDependencies` gains:

```ts
setWorkspaceColor?: (workspaceId: string, hex: string, reason: string) => Promise<boolean>;
persistTeamColor?: (groupId: string, hex: string) => Promise<void>;
```

`createOperatorTeam`, after successful rename and optional `setGroupColor`:

- If `hex` is set: `persistTeamColor(id, hex)` then `setWorkspaceColor(member, hex, "board team create")` for every `created.memberWorkspaceIds` entry except `created.anchorWorkspaceId`.
- A failed member write does not roll back the group. Surface it the same way team PUT already does (continue, do not 502 the whole create unless `setGroupColor` itself failed). Prefer: create still 200 if the folder exists; member paint is best-effort through the funnel. **Locked:** if `setGroupColor` is requested and fails, keep today’s 502. Member paint failures log via thrown funnel false; do not 502 create. Tests pin: create with hex issues N-1 workspace colour writes (children, not anchor) even if one of them returns false.

`addOperatorMember` after a successful add: if `normalizeHex(live.customColor)` is set, `setWorkspaceColor(id, hex, "board team add")`. No persist change (the group already has a colour).

`src/server/app.ts` `/api/teams` handler passes `setWorkspaceColor` (same funnel as team-colors) and `persistTeamColor: (id, hex) => teamColorsStore.setUserColor(id, hex)`.

Do not paint on ungroup. Ungrouped members return to repo identity on the next GET or TINT-S pass.

---

## Sacred cows (do not violate)

From TINT 08-13 and Teams, still live:

- Six fixed hues; never invent a 7th; overflow clay `#64707C`.
- Normalize before compare.
- One colour funnel.
- Status/selection/flight outrank identity wash on rows.
- Text never wears identity colour.
- Whisper/Signal mix percentages stay.
- CSP: `style.setProperty("--repo-tint")` only.
- Groups are window-scoped. Enumerate `window.list`. Never `extension.sidebar.snapshot {"all_windows":true}` for colour collection.
- Never annex by name. Provenance = recorded ids.
- `workspace.group.ungroup`, never `delete`.
- Never file/remove group anchors. Skip the whole window if `group.list` fails.
- Incomplete `targets` must not dissolve TINT-G groups.
- Colour key = origin basename.
- Sync piggybacks the collector poll. No new timer.
- Overlay title cannot be `Group N`.
- Teams module never writes TINT-G provenance.
- Last-good overlay teams survive a total group-collect miss.
- Unanimous hex / unanimous id; never average.
- Pick-set for create is `groupingIds`, never `selectedId`.

---

## What this is not

Rejected. Do not revive in this patch.

| Rejected | Why |
|---|---|
| Revive TINT-G `workspace.group.create` | Tonight’s thief. Create pulls members out of `ANT · probe`. |
| Merge Settings into one band list | Different lifetimes. A live folder and a persisted repo are not one row. |
| Shared 6-slot ledger | Burns clay (live: 6 filled repo slots + overflow already, plus off-palette teams). Separate ticket if Emilio wants unique hues. |
| Settings toggles for `mirrorGroups` / `syncFromCmux` | Flags stay default-on, no UI. `setFlags` remains unused. |
| Ingest cmux **workspace** colour onto Formic bands | Band colour is folder (overlay) or repo (ungrouped). Workspace hand-colour on an overlay member is kept on the pane only when team hex is `auto`. |
| “Group by team, color by repo” mode | Does not exist and this spec does not add it. Overlay takes both. |
| Cross-window teams | cmux refuses. Keep `MIXED_WINDOW`. |
| Strip mixed-team hue vs split roster | Real UX bug (`tintOfProgram` on the unsplit program). Not required to make overlay parity true. Parked. |
| `worktreeLabel` printing the repo inside a mixed-repo team band | Parked. |
| Repo sigils, worktree shade steps, group icons | Parked 2026-08-13. |

---

## Acceptance criteria

Numbered. Pass/fail.

1. `GET /api/repo-colors` with two mapped workspaces, one of them in `skipWorkspaceIds`, fans out **only** the ungrouped id. PUT and DELETE of that repo behave the same.
2. Production-shaped call `syncCmuxColors({ settings: { repoColors: store.get() }, teamByWorkspaceId })` re-asserts **team** hex onto an overlay member that drifted, and re-asserts **repo** hex onto an ungrouped mapped workspace.
3. Passing a bare `HubSettings`-shaped object into `repoColorsSettingsFrom` still yields empty assignments (regression lock so index.ts cannot quietly pass fleet settings again).
4. Overlay member with no repo assignment and `hexSource: "user"` is team-reasserted (guard runs before unmapped).
5. `POST /api/teams` with `{ hex }` issues `workspace.group.set_color` and `setWorkspaceColor` for each non-anchor child. `team-colors.json` gains `source: "user"` for that group id.
6. `addOperatorMember` issues `setWorkspaceColor` for the new id when the live group has a hex.
7. `isOperatorTeam("the-ant-hill", "orphan-id", emptyProvenance, keys={"the-ant-hill"})` is false. `isOperatorTeam("ANT · probe", "abc", empty, keys={"the-ant-hill"})` is true. Provenance and `Group N` still exclude.
8. Settings panel text includes `Identity`, `Ungrouped rows. A cmux group overrides this.`, `Cmux groups`, and `No named cmux groups.` It does not include the heading `Repo colours` or `Teams`.
9. `ARCHITECTURE.md` no longer claims TINT-G creates one group per repo per window. It states overlay skip, GET fan-out skip, and TINT-S reading `repo-colors.json`.
10. `src/web/index.html` cache-bust is `ah-t54`.
11. `bunx tsc --noEmit` is 0. Targeted tests listed in the plan are green. Full `bun test` is green except the documented local-only `docs/a11y-geometry-gate` red.
12. No new `workspace.group.create` in `cmux-groups.ts`. The `if (!live) continue` mint-guard stays.

---

## Testing pyramid

| Layer | What | Count |
|---|---|---|
| Unit | `isOperatorTeam` repo-key exclusion; `repoColorsSettingsFrom(HubSettings)` empty assignments; team-before-unmapped reconcile | +6 |
| Integration | GET/PUT/DELETE fan-out skip; create paints members + persists; add paints; `syncCmuxColors` with real `{ repoColors }` | +6 |
| DOM | Settings headings + kickers + empty copy (`tests/team-tint-render.test.ts`) | +2 |
| Floor | `bunx tsc --noEmit`; targeted files; full `bun test` | 1 |

Existing tests that pin “GET fans out to every mapped workspace” must be **rewritten** to say “every mapped workspace not in an overlay team.” Do not delete the mapped-vs-unmapped rule.

---

## Files reference

| File | Change |
|---|---|
| `src/shared/team-tint.ts` | 4th arg `repoIdentityKeys`; thread through `resolveOperatorTeams` / `buildOperatorTeams` |
| `src/server/cmux-color-sync.ts` | Team guard before unmapped; production comment that settings must nest `repoColors` |
| `src/server/state.ts` | `repoColorsReader`; pass `{ repoColors }` into `syncCmuxColors`; build `repoIdentityKeys` for `resolveOperatorTeams` |
| `src/server/index.ts` | Open `JsonRepoColorsStore` once; inject into HubState and `createMountainFetch` |
| `src/server/settings.ts` | `skipWorkspaceIds` on GET and `fanOutFor` |
| `src/server/app.ts` | Wire skip from `state.teams()`; pass `setWorkspaceColor` + `persistTeamColor` into `/api/teams` |
| `src/server/team-groups.ts` | Paint members on create/add; persist; thread `repoIdentityKeys` into the overlay predicate |
| `src/web/settings-panel.js` | Headings + kickers |
| `src/web/app.js` | Empty copy `"No named cmux groups."` in `renderTeamColorSettings` |
| `src/web/index.html` | `ah-t53` → `ah-t54` |
| `ARCHITECTURE.md` | Overlay paragraph; kill the “create one group per repo” claim |
| `tests/team-tint.test.ts` | Repo-key exclusion |
| `tests/cmux-color-sync.test.ts` | Team-before-unmapped; HubSettings-shaped empty assignments still locked |
| `tests/repo-color.test.ts` | Fan-out skip |
| `tests/team-groups.test.ts` | Create/add paint |
| `tests/team-tint-render.test.ts` | Settings copy |
| `tests/team-tint-snapshot.test.ts` | `resolveOperatorTeams` with repo keys (leftover `the-ant-hill` folder is not a team) |

---

## Sequencing

```
#1 Predicate (repoIdentityKeys)
   └─> #2 Fan-out skip (needs teams() which already exists; skip is independently testable)
   └─> #3 TINT-S wiring + guard order
         └─> #4 Create/add member paint
               └─> #5 Settings copy + ARCHITECTURE + cache-bust
```

#1 before #4 because create/rename uses the predicate. #3 before claiming parity, because skip alone loses the boot race. #5 last so copy tests do not churn under earlier DOM work.

One PR. Splitting skip without TINT-S ships a Settings-open fix and leaves boot GET broken.

---

## Rollback

Revert the PR. `data/repo-colors.json` and `data/team-colors.json` shapes do not change. No migration. Overlay members may wear repo hex again until the next team PUT, which is today’s bug.

---

## Effort

| Slice | Time |
|---|---|
| Predicate + snapshot/groups plumbing | ~1.5h |
| Fan-out skip | ~1h |
| TINT-S wiring + guard order + index.ts store lift | ~2h |
| Create/add paint + persist | ~1.5h |
| Settings copy + ARCHITECTURE + cache-bust | ~0.5h |
| Floor | ~0.5h |

---

## Out of scope

- Deploy / `anthill-deploy.sh` / launchd.
- Shared palette ledger.
- Settings flag UI.
- TINT-G mint revival.
- Strip mixed-team colour disagreement.
- Mixed-repo team worktree labels.
- Prompt-chip / `ANTHILL_REPO_COLOR` changes.
- Cooper scheduler or any other product.

---

## Related

- `docs/superpowers/plans/2026-08-13-tint/00-MASTER-PLAN.md` — original TINT authority rules.
- `docs/superpowers/specs/2026-08-16-settings-shell.md` — Settings had Repo colours only; this spec updates the later second plate’s copy, not the shell layout.
- `tests/cmux-groups.test.ts` — “Tonight’s thief.”
- Implementation plan: `docs/superpowers/plans/2026-08-26-tint-overlay-parity.md`
