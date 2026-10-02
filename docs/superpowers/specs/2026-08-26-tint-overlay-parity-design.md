# Board stripe colour

**Date:** 2026-08-26
**Status:** Design locked (Emilio). Previous draft in this file (two Settings plates, “groups override identity”) is **rejected**. Do not implement that draft. Do not implement this spec until Emilio approves it.
**Parent:** TINT 2026-08-13. Teams overlay (no plan file). Investigation 2026-08-26.
**Plan:** `docs/superpowers/plans/2026-08-26-tint-overlay-parity.md`

**Goal:** Colour lives on the stripe you are looking at. Repo colour is an automatic default for ungrouped rows. A named cmux group is the stripe you colour, in Formic and in cmux. Settings is not a grouping UI.

**Success means:** Settings has no colour plates. Ungrouped rows still group and colour by repo without anyone picking. Colouring a group card (or the Select→Group chip, or the folder in cmux) paints that folder and its terminals on both sides. Opening Settings does not touch colours. TINT-G still does not mint folders.

**Stop when:** Acceptance criteria green on the local floor. Cache-bust bumped. ARCHITECTURE.md matches. Do not deploy.

---

## Plain English

Two Settings lists where one silently beat the other was still two systems.

What you actually do: repo colours are all automatic; group colours are the ones you pick. Settings was showing a computer-chosen repo palette next to your real group palette, and they fought over the same stripe.

The product:

- Ungrouped rows sit and colour **by repo**. The six-colour palette assigns that. You do not manage it in Settings.
- When you group terminals, that **group** is the stripe. You colour it on the group card. Formic and cmux follow each other.
- Ungroup, and those rows fall back to the automatic repo colour.
- Rare repo override: click the repo band’s swatch on the board, same interaction as a group card. Not a Settings page.

---

## Rejected (do not revive)

| Rejected | Why |
|---|---|
| Two Settings plates (“Identity” vs “Cmux groups”) with an override footnote | Still two grouping languages in Settings. Emilio bounced it. |
| One Settings list mixing live folders and persisted repos | Same two objects, pretending they are one. |
| Mint a cmux folder per repo (TINT-G create) | Tonight’s thief: create pulls members out of `ANT · probe`. |
| Kill repo colour entirely | Ungrouped Whisper bands lose identity. Spawn chips (`ANTHILL_REPO_COLOR`) lose their source. |
| Kill group colour / Teams | Mixed-repo programs collapse to one magenta pile. |
| Keep Settings colour GET on panel open | GET `/api/repo-colors` is a write. Opening Settings was a fleet-wide colour storm. |
| Shared 6-slot ledger across repos and groups | Burns clay. Colliding hues accepted. |
| Settings toggles for `mirrorGroups` / `syncFromCmux` | Flags stay default-on, no UI. |
| “Group by team, colour by repo” mode | Overlay takes both. Not a new axis. |

---

## Locked decisions

| # | Decision | Call |
|---|---|---|
| 1 | Product | Colour the stripe on the board. Settings has **zero** colour plates. |
| 2 | Repo colour | Automatic. `withAssignments` on GET `/api/repo-colors` still assigns the six hues + clay. Persist in `data/repo-colors.json`. Used for ungrouped bands, ungrouped cmux workspaces, and spawn chips. |
| 3 | Group colour | Operator-set. Lives on the group card swatch, the Select→Group chip, and the cmux folder. PUT `/api/team-colors/:id` and POST `/api/teams` `{ hex }` stay the write path. |
| 4 | Board grouping | Unchanged: `teamGroups` then leftover `repoGroups`. Unanimous team hex else repo. Never average. |
| 5 | Settings | Remove `#repo-colors-host` and `#team-colors-host`. Unwrap Needs-you out of the two-column `.split` so it is a full-width plate between Collectors and Horizon. Opening Settings must **not** GET `/api/repo-colors` or `/api/team-colors`. |
| 6 | Group card swatch | Keep `teamBandPicker`. Click always opens the native colour input. PUT team colour. |
| 7 | Repo card swatch | Replace the decorative `.repo-dot` with the **same** `.repo-tint-picker.swatch` chrome as the group card. Click always opens the picker and PUTs a user override. Shift-click, only when `source === "user"`, DELETEs the override and restores automatic (frees the palette slot). `is-yours` ring when overridden. `title`: `"Colour for {name}. Shift-click to restore automatic."` when yours; `"Colour for {name}"` when auto. No swatch when the server has not assigned a hex. |
| 8 | Select→Group chip | Keep name + swatch + Group. Default hex from live snapshot team hexes, not `state.teamColors`. |
| 9 | `state.teamColors` / `fetchTeamColors` | Dead. Snapshot `agent.team` is the board’s source of truth. After create/rename/ungroup, `fetchSnapshot` only. |
| 10 | TINT-G | Do not mint. Do not annex. `ungroup` never `delete`. Provenance by recorded id only. |
| 11 | Funnel | Every colour write through `src/server/cmux-color.ts`. |
| 12 | Hex | `normalizeHex` before compare. Workspace echo via `lastWrittenHex`. |
| 13 | Palette | Six hues + clay. No shared ledger. |
| 14 | Fan-out skip | GET/PUT/DELETE `/api/repo-colors` skip workspace ids in live overlay teams. SameHex skip remains. |
| 15 | TINT-S | Production passes `{ repoColors: JsonRepoColorsStore.get() }`, never bare `HubSettings`. Team membership checked **before** unmapped. Either wire it or delete the production call — this spec wires it. |
| 16 | Create / add | POST `/api/teams` with hex paints folder **and** non-anchor members, persists `source: "user"`. `addOperatorMember` paints the new member with the live group hex. Member paint failure does not 502 create. `setGroupColor` failure still 502s create. |
| 17 | Overlay predicate | Not provenance, not `Group N`, not empty, **and** `name.trim().toLowerCase()` not in `repoIdentityKeys` (assignment keys ∪ live `repo.repoName`). |
| 18 | Authority | Overlay member + `hexSource` user/cmux → team hex. Overlay member + auto + live colour → keep live. Ungrouped mapped → repo assignment. Unmapped, no team → ingest, never write. Echo ignored. |
| 19 | Mapped workspace hand-colour | Board still wins for **ungrouped** mapped workspaces. Overlay members are not repo-writable. Band colour is the folder, not a member pane’s hand colour. |
| 20 | Cache-bust | `ah-t53` → `ah-t54` on every `?v=` in `src/web/index.html`. |
| 21 | Deploy | Not this spec. |
| 22 | Window scope | Overlay teams stay per-window. `MIXED_WINDOW` stays. |
| 23 | PUT repo from the board | Use the assignment `repoKey` from the GET join (`repoNames` name → key), never `group.key` (that is the FNV `groupPath[0]`). Ambiguous printed names stay untinted and get no swatch (no tint beats wrong tint). |

---

## Settings after

```
Collectors
Time (Working / Quiet / postures)
Needs-you          ← full width, not half a two-column split
Horizon
Save time / Reset span
```

No “Repo colours.” No “Teams.” No “Identity.” No “Cmux groups.”

`openSettingsPanel` fetches collector instances only (plus the panel render). It does not fetch colours.

---

## Colour on the board

```
repo band head
  caret | swatch (picker) | name | worktree count | PRs | rollup

team band head
  caret | swatch (picker) | rename-name | Ungroup | worktree count | PRs | rollup

filter bar, Select on
  Group N terminals | name | swatch | Group
```

Whisper spine / wash still use `--repo-tint`. The swatch **is** Whisper’s mark (the 7px `.repo-dot` goes away whenever a hex exists). Same 44px hit target as the team picker (`.repo-tint-picker`).

Client join for repo PUT:

`setRepoColors` keeps the hex map for paint **and** a record map `name → { hex, repoKey, source }` so the repo swatch can PUT/DELETE the canonical key and know `is-yours`.

---

## Write-path (parity, still required)

Removing Settings does not fix the fight. Boot GET `/api/repo-colors` still fans out. Create still colours the folder only. TINT-S still receives empty assignments.

```
BOOT / new origin on the roster
  GET /api/repo-colors
    ensure automatic assignments
    fan-out repo hex to mapped workspaces EXCEPT overlay members

PUT repo from repo-band swatch
  same skip

PUT /api/team-colors/:id  (group-band swatch)
  persist user hex
  setGroupColor(folder)
  setWorkspaceColor(each member)

POST /api/teams { workspaceIds, name, hex }  (Select → Group)
  create + rename
  setGroupColor
  persist user hex
  setWorkspaceColor(each non-anchor child)

cmux collector tick
  resolveOperatorTeams(repoIdentityKeys)
  attachTeams
  syncCmuxColors({ repoColors: store.get(), teamByWorkspaceId })
    member + user/cmux → team-reassert
    ungrouped mapped → repo reassert
    unmapped no team → ingest
```

`nextGroupingHex` walks `state.snap.programs[].agents[].team.hex`, not `state.teamColors`.

---

## Predicate

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

Default empty set keeps tests that omit keys. Production always passes keys (assignment keys ∪ live `repo.repoName`).

Thread through `resolveOperatorTeams`, `buildOperatorTeams`, `team-groups.ts` (`operatorName` / `requireOperatorGroup`), `team-colors.ts`.

`HubState` and `app.ts` share one helper:

```ts
function repoIdentityKeysFrom(
  assignments: Record<string, { repoKey?: string }>,
  snapshot: HubSnapshot,
): Set<string> {
  const keys = new Set<string>();
  for (const key of Object.keys(assignments)) keys.add(key.toLowerCase());
  for (const program of snapshot.programs) {
    for (const agent of program.agents) {
      const name = agent.repo?.repoName?.trim().toLowerCase();
      if (name) keys.add(name);
    }
  }
  return keys;
}
```

---

## TINT-S wiring

`HubStateOptions.repoColorsReader?: () => RepoColorsSettings`.

`src/server/index.ts` opens `JsonRepoColorsStore` once (`data/repo-colors.json`) and injects it into HubState and `createMountainFetch({ repoColorsStore })`. Do not open the file twice in production.

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

`reconcileWorkspaceColors` order per non-anchor observation:

1. Team membership (existing hexSource rules).
2. Else `!assignment` → ingest / ignore. Never write.
3. Else match / echo / repo reassert.

Add a test: overlay member with **no** repo assignment and `hexSource: "user"` team-reasserts.

Keep `repoColorsSettingsFrom(hubSettingsShaped) → assignments {}` as a regression lock.

---

## Fan-out skip

`RepoColorsRequestOptions.skipWorkspaceIds?: () => ReadonlySet<string>`.

GET write list and `fanOutFor` drop those ids before `fanOut`.

```ts
skipWorkspaceIds: () => new Set(
  (dependencies.state.teams?.() ?? []).flatMap((team) => team.memberWorkspaceIds),
),
```

JSON `workspaces` in the GET body may still list everyone; the client ignores that map. Do not use it to paint cmux.

Boot GET may run before the first cmux collect (`teams()` empty). TINT-S on the first collect restores overlay hexes. Skip is the steady-state guard.

---

## Create / add paint

`TeamGroupDependencies` gains `setWorkspaceColor?` and `persistTeamColor?`.

After successful group colour on create:

```ts
if (hex) {
  await deps.persistTeamColor?.(created.id, hex);
  for (const workspaceId of created.memberWorkspaceIds) {
    if (workspaceId === created.anchorWorkspaceId) continue;
    await deps.setWorkspaceColor?.(workspaceId, hex, "board team create");
  }
}
```

`addOperatorMember` after add: if `normalizeHex(live.customColor)`, `setWorkspaceColor(id, hex, "board team add")`.

`app.ts` `/api/teams` passes the funnel’s `setWorkspaceColor` and `persistTeamColor: (id, hex) => store.setUserColor(id, hex)`.

Ungroup does not paint. Next GET or TINT-S returns members to repo identity.

---

## Dead code this spec deletes

| Symbol | Fate |
|---|---|
| `paintRepoColorSettings`, `renderRepoColorSettings` | Delete. Behaviour moves to `repoBandPicker`. |
| `paintTeamColorSettings`, `renderTeamColorSettings` | Delete. Board already has `teamBandPicker`. |
| `fetchTeamColors`, `state.teamColors` | Delete. |
| `bindSettingsPanel` colour deps | Drop those four bindings. |
| Settings tests that mount `#repo-colors-host` / `#team-colors-host` / “Repo colours” / “Teams” / “No operator groups” | Rewrite: Settings must **not** contain those strings or hosts. |
| `opening Settings GETs /api/repo-colors` | Invert: opening Settings must **not** GET it. Boot + live-roster change still do. |
| `opening Settings GETs /api/team-colors` | Invert: must not. |
| `renderRepoColorSettings` describe in `tests/repo-tint-render.test.ts` | Replace with `repoBandPicker` tests (yours ring, click PUT, shift-click DELETE, no swatch without hex, join uses printed name not `the-mountain`). |

Keep `putRepoColor` / `putTeamColor`. Keep GET `/api/repo-colors` for boot join.

---

## Sacred cows (unchanged)

Six hues; never a 7th; clay overflow. Normalize before compare. One funnel. Status/selection/flight outrank identity wash. Text never wears identity colour. Whisper/Signal mixes. CSP `setProperty` only. Window-scoped groups. Never annex by name. `ungroup` not `delete`. Never file/remove anchors. Incomplete targets do not dissolve TINT-G groups. Colour key = origin basename. Sync piggybacks the collector. Overlay title cannot be `Group N`. Teams never write TINT-G provenance. Last-good teams survive a total group-collect miss. Never average mixed hexes. Pick-set is `groupingIds`, never `selectedId`.

---

## Acceptance criteria

1. Settings panel text does not contain `Repo colours`, `Teams`, `Identity`, or `Cmux groups`. There is no `#repo-colors-host` or `#team-colors-host`.
2. `openSettingsPanel` does not GET `/api/repo-colors` or `/api/team-colors`.
3. Needs-you in Settings is full width (not a 1fr hole in a 2-column split).
4. A repo band with a hex renders `.repo-tint-picker.swatch` and no `.repo-dot`. Click dispatches PUT `/api/repo-colors/<assignment.repoKey>`. Shift-click on a `source: "user"` assignment dispatches DELETE. Auto assignments have no yours ring; user assignments do.
5. A team band swatch still PUTs `/api/team-colors/<id>` on change.
6. `nextGroupingHex` ignores `state.teamColors` (which does not exist) and does not reuse a hex already on `agent.team` in the snapshot.
7. `GET /api/repo-colors` with two mapped workspaces, one skipped as an overlay member, fans out **only** the ungrouped id. PUT/DELETE of that repo behave the same.
8. `syncCmuxColors({ settings: { repoColors: store.get() }, teamByWorkspaceId })` re-asserts team hex on a drifted overlay member and repo hex on an ungrouped mapped workspace.
9. Overlay member with no repo assignment and `hexSource: "user"` is team-reasserted.
10. `repoColorsSettingsFrom` on a HubSettings-shaped object yields empty `assignments`.
11. `POST /api/teams` with `{ hex }` paints each non-anchor child and persists `source: "user"`.
12. `addOperatorMember` paints the new id when the live group has a hex.
13. `isOperatorTeam("the-ant-hill", "orphan-id", empty, keys={"the-ant-hill"})` is false. `ANT · probe` next to that key is true.
14. `ARCHITECTURE.md` no longer claims TINT-G creates one group per repo, no longer describes Settings colour plates, and states board swatches + fan-out skip + TINT-S reading `repo-colors.json`.
15. `src/web/index.html` is `ah-t54`.
16. `bunx tsc --noEmit` is 0. Targeted tests green. Full `bun test` green except documented `docs/a11y-geometry-gate`.
17. `cmux-groups.ts` still has `if (!live) continue`. No new `workspace.group.create` there.

---

## Testing pyramid

| Layer | What | Count |
|---|---|---|
| Unit | Predicate; `repoColorsSettingsFrom(HubSettings)`; team-before-unmapped | +6 |
| Integration | Fan-out skip; create/add paint; TINT-S with real `{ repoColors }` | +6 |
| DOM | Settings has no colour plates and does not GET colours; repo band picker PUT/DELETE/yours; team picker unchanged; grouping chip still has a swatch | +8 replacing the deleted Settings colour tests |
| Floor | `tsc`; targeted; full `bun test` | 1 |

---

## Files reference

| File | Change |
|---|---|
| `src/shared/team-tint.ts` | 4th arg `repoIdentityKeys` |
| `src/server/cmux-color-sync.ts` | Team guard before unmapped |
| `src/server/state.ts` | `repoColorsReader`; `{ repoColors }` into TINT-S; keys into `resolveOperatorTeams` |
| `src/server/index.ts` | Open `JsonRepoColorsStore` once; inject |
| `src/server/settings.ts` | `skipWorkspaceIds` |
| `src/server/app.ts` | Wire skip, persist, member paint, `repoIdentityKeys` |
| `src/server/team-groups.ts` | Predicate keys; create/add paint + persist |
| `src/server/team-colors.ts` | Predicate keys |
| `src/web/settings-panel.js` | Remove colour plates and colour fetches; unwrap Needs-you |
| `src/web/app.js` | `repoBandPicker`; `setRepoColors` records; `nextGroupingHex` from snapshot; delete Settings colour painters and `fetchTeamColors` |
| `src/web/client-state.js` | Remove `teamColors` |
| `src/web/index.html` | `ah-t54` |
| `ARCHITECTURE.md` | Match |
| `tests/team-tint.test.ts` | Predicate |
| `tests/team-tint-snapshot.test.ts` | Leftover folder |
| `tests/cmux-color-sync.test.ts` | Guard order + HubSettings lock |
| `tests/repo-color.test.ts` | Fan-out skip |
| `tests/team-groups.test.ts` | Create/add paint |
| `tests/team-tint-render.test.ts` | Settings absence; keep team picker tests |
| `tests/repo-tint-render.test.ts` | Replace Settings describe with repo band picker; invert Settings GET |

---

## Sequencing

```
#1 Predicate
#2 Fan-out skip
#3 TINT-S wiring
#4 Create/add member paint
#5 Board swatches + Settings colour plates gone + cache-bust + ARCHITECTURE
```

#1–4 make parity true. #5 is the product you can see. One PR. Shipping #5 without #2/#3 leaves boot GET undoing group colours.

---

## Rollback

Revert the PR. Store shapes unchanged. No migration.

---

## Effort

| Slice | Time |
|---|---|
| Predicate | ~1.5h |
| Fan-out skip | ~1h |
| TINT-S wiring | ~2h |
| Create/add paint | ~1.5h |
| Board swatches + Settings removal + tests rewrite + docs | ~3h |
| Floor | ~0.5h |

---

## Out of scope

- Deploy.
- Shared palette ledger.
- Flag UI.
- TINT-G mint.
- Strip mixed-team hue vs split roster.
- Mixed-repo team worktree labels omitting the repo word.
- Prompt-chip changes beyond continuing to read GET `/api/repo-colors`.
- Cooper or any other product.
