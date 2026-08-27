# Overlay parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repo colour is durable identity for ungrouped rows; a named cmux group overlays band and hue in Formic and cmux; Settings copy tells the truth; TINT-G still does not mint.

**Architecture:** Keep two stores and two Settings plates. Close the write fights: skip overlay members on repo fan-out, pass `repo-colors.json` into TINT-S and check team membership before unmapped, paint members on create/add, and exclude leftover repo-named folders from the overlay predicate.

**Tech Stack:** Existing Bun tests, `cmux-color.ts` funnel, `HubState` collector tick. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-26-tint-overlay-parity-design.md`

## Global Constraints

- Overlay, not band=folder. Do not call `workspace.group.create` from `cmux-groups.ts`.
- Every colour write goes through `src/server/cmux-color.ts`.
- `normalizeHex` before compare.
- Six hues + clay. Do not share a slot ledger across repos and teams.
- `workspace.group.ungroup`, never `delete`. Never annex by name. Never touch anchors.
- Cache-bust `ah-t53` → `ah-t54` only in Task 5.
- Do not deploy. Do not push unless Emilio asks.
- Do not add Settings toggles for `mirrorGroups` / `syncFromCmux`.
- Branch is `feat/tint-overlay-parity`. Never commit on `main`.

---

## File map

| File | Responsibility |
|---|---|
| `src/shared/team-tint.ts` | Overlay predicate + `repoIdentityKeys` |
| `src/server/state.ts` | `repoColorsReader`; TINT-S settings shape; keys into `resolveOperatorTeams` |
| `src/server/index.ts` | Open `JsonRepoColorsStore` once; inject |
| `src/server/cmux-color-sync.ts` | Team guard before unmapped |
| `src/server/settings.ts` | `skipWorkspaceIds` on GET/`fanOutFor` |
| `src/server/app.ts` | Wire skip, persist, member paint |
| `src/server/team-groups.ts` | Create/add paint + persist + predicate keys |
| `src/web/settings-panel.js` | Identity / Cmux groups copy |
| `src/web/app.js` | Empty copy |
| `src/web/index.html` | `ah-t54` |
| `ARCHITECTURE.md` | Match the code |

## Parallelization (after approval)

Serial. Predicate first, then skip, then TINT-S, then create/add, then copy. One implementer. Do not fan out: `app.ts` / `state.ts` / `team-groups.ts` would collide.

---

### Task 1: Overlay predicate excludes known repo keys

**Files:**
- Modify: `src/shared/team-tint.ts`
- Modify: `src/server/team-groups.ts` (thread keys into `isOperatorTeam` / `operatorName` / `requireOperatorGroup`)
- Modify: `src/server/state.ts` (`resolveOperatorTeams` call)
- Modify: `src/server/app.ts` (`handleTeamGroupsRequest` / `handleTeamColorsRequest` provenance plus keys)
- Test: `tests/team-tint.test.ts`
- Test: `tests/team-tint-snapshot.test.ts`

**Interfaces:**
- Consumes: existing `isOperatorTeam(name, id, provenance)`
- Produces: `isOperatorTeam(name, id, provenance, repoIdentityKeys?)` with default `new Set()`; `resolveOperatorTeams(..., repoIdentityKeys?)`

- [ ] **Step 1: Write the failing tests**

Add to `tests/team-tint.test.ts`:

```ts
test("a leftover folder named like a known repo is not a team", () => {
  expect(isOperatorTeam(
    "the-ant-hill",
    "orphan-id",
    new Set(),
    new Set(["the-ant-hill"]),
  )).toBe(false);
});

test("ANT · probe stays a team next to a known repo key", () => {
  expect(isOperatorTeam(
    "ANT · probe",
    "abc",
    new Set(),
    new Set(["the-ant-hill"]),
  )).toBe(true);
});

test("omitted repoIdentityKeys keeps today's provenance-only behaviour", () => {
  expect(isOperatorTeam("the-ant-hill", "orphan-id", new Set())).toBe(true);
});
```

Add to `tests/team-tint-snapshot.test.ts` a `resolveOperatorTeams` case: windows contain a group named `the-ant-hill` with a random id, `repoIdentityKeys = {"the-ant-hill"}`, provenance empty → `teams` does not include it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/team-tint.test.ts tests/team-tint-snapshot.test.ts`

Expected: FAIL — `isOperatorTeam` has no 4th parameter / leftover folder is classified as a team.

- [ ] **Step 3: Implement the predicate and thread keys**

In `src/shared/team-tint.ts`:

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

Thread the set through `resolveOperatorTeams` / `buildOperatorTeams` into the `isOperatorTeam` call.

`HubState` builds keys each cmux tick:

```ts
const repoIdentityKeys = new Set<string>(
  Object.keys(this.repoColorsReader?.().assignments ?? {}).map((key) => key.toLowerCase()),
);
for (const program of this.#snapshot.programs) {
  for (const agent of program.agents) {
    const name = agent.repo?.repoName?.trim().toLowerCase();
    if (name) repoIdentityKeys.add(name);
  }
}
```

Pass into `resolveOperatorTeams`. For this task, `repoColorsReader` may be missing; keys then come from the snapshot only. Task 3 adds the reader. Snapshot-only is enough to fail the leftover-folder case once a `formic` / `the-ant-hill` row exists.

`TeamGroupDependencies` gains `repoIdentityKeys?: () => ReadonlySet<string>`. `operatorName` / `requireOperatorGroup` / `isOperatorTeam` call sites in `team-groups.ts` and `team-colors.ts` pass `deps.repoIdentityKeys?.() ?? new Set()`.

`app.ts` handlers stay sync. Read from `repoColorsForGroups?.get().assignments` plus live snapshot names. Concrete:

```ts
function repoIdentityKeysFrom(
  store: JsonRepoColorsStore | undefined,
  snapshot: HubSnapshot,
): Set<string> {
  const keys = new Set<string>();
  for (const key of Object.keys(store?.get().assignments ?? {})) keys.add(key.toLowerCase());
  for (const program of snapshot.programs) {
    for (const agent of program.agents) {
      const name = agent.repo?.repoName?.trim().toLowerCase();
      if (name) keys.add(name);
    }
  }
  return keys;
}
```

Put that helper in `app.ts` next to `discoverRepoColors` and pass `() => repoIdentityKeysFrom(repoColorsForGroups, dependencies.state.get())` into both team handlers. `repoColorsForGroups` is already assigned when the store promise resolves.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/team-tint.test.ts tests/team-tint-snapshot.test.ts tests/team-groups.test.ts tests/team-colors.test.ts`

Expected: PASS. Existing “omitted keys ⇒ `the-ant-hill` without provenance is a team” remains true unless keys are passed.

- [ ] **Step 5: Commit**

```bash
git add src/shared/team-tint.ts src/server/team-groups.ts src/server/team-colors.ts src/server/state.ts src/server/app.ts tests/team-tint.test.ts tests/team-tint-snapshot.test.ts
git commit -m "$(cat <<'EOF'
fix(tint): leftover repo-named folders are not overlay teams

Empty provenance was classifying the-ant-hill sidebar leftovers as
operator teams. Identity keys from assignments plus live repo names
close that annexation hole.
EOF
)"
```

---

### Task 2: Repo colour fan-out skips overlay members

**Files:**
- Modify: `src/server/settings.ts`
- Modify: `src/server/app.ts`
- Test: `tests/repo-color.test.ts`

**Interfaces:**
- Consumes: `HubState.teams()` (already public)
- Produces: `RepoColorsRequestOptions.skipWorkspaceIds?: () => ReadonlySet<string>`

- [ ] **Step 1: Write the failing test**

In `tests/repo-color.test.ts` next to `"GET fans out to repo-MAPPED workspaces only"`:

```ts
test("GET/PUT/DELETE skip overlay team members", async () => {
  const writes: { workspaceId: string; hex: string }[] = [];
  const store = await JsonRepoColorsStore.open("colors.json", memorySettingsFiles());
  const handle = (request: Request) => handleRepoColorsRequest(request, store, {
    discover: () => discovery,
    fanOut: (batch) => { writes.push(...batch); },
    skipWorkspaceIds: () => new Set(["WS-1"]),
  });

  writes.length = 0;
  await handle(new Request(`${ORIGIN}/api/repo-colors`));
  expect(writes.map((write) => write.workspaceId).sort()).toEqual(["WS-2"]);

  writes.length = 0;
  await handle(new Request(`${ORIGIN}/api/repo-colors/the-mountain`, {
    method: "PUT",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ hex: "#123456" }),
  }));
  expect(writes.map((write) => write.workspaceId)).toEqual([]);

  writes.length = 0;
  await handle(new Request(`${ORIGIN}/api/repo-colors/formic`, {
    method: "PUT",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ hex: "#abcdef" }),
  }));
  expect(writes.map((write) => write.workspaceId)).toEqual(["WS-2"]);
});
```

Rewrite the existing GET fan-out test comment to: mapped, and not skipped. Keep asserting both WS-1 and WS-2 when `skipWorkspaceIds` is omitted.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/repo-color.test.ts`

Expected: FAIL — `skipWorkspaceIds` is not a known option; GET still writes `WS-1`.

- [ ] **Step 3: Implement skip**

`RepoColorsRequestOptions`:

```ts
skipWorkspaceIds?: () => ReadonlySet<string>;
```

Helper used by GET and `fanOutFor`:

```ts
function fanOutWrites(
  writes: readonly { workspaceId: string; hex: string }[],
  options: RepoColorsRequestOptions,
): { workspaceId: string; hex: string }[] {
  const skip = options.skipWorkspaceIds?.() ?? new Set<string>();
  return writes.filter((write) => !skip.has(write.workspaceId));
}
```

GET (after building `writes`) and `fanOutFor` both `await options.fanOut?.(fanOutWrites(writes, options))`.

`app.ts` `/api/repo-colors` handler:

```ts
skipWorkspaceIds: () => new Set(
  (dependencies.state.teams?.() ?? []).flatMap((team) => team.memberWorkspaceIds),
),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/repo-color.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/settings.ts src/server/app.ts tests/repo-color.test.ts
git commit -m "$(cat <<'EOF'
fix(tint): repo colour fan-out skips overlay members

GET/PUT/DELETE /api/repo-colors were painting team terminals back to
the repo hex on boot and Settings open.
EOF
)"
```

---

### Task 3: Wire TINT-S to repo-colors.json and check team first

**Files:**
- Modify: `src/server/state.ts`
- Modify: `src/server/index.ts`
- Modify: `src/server/cmux-color-sync.ts`
- Modify: `src/server/app.ts` (accept injected `repoColorsStore` from index; already optional)
- Test: `tests/cmux-color-sync.test.ts`

**Interfaces:**
- Consumes: `JsonRepoColorsStore.get(): RepoColorsSettings`
- Produces: `HubStateOptions.repoColorsReader?: () => RepoColorsSettings`; production `syncCmuxColors` settings `{ repoColors }`

- [ ] **Step 1: Write the failing tests**

In `tests/cmux-color-sync.test.ts` inside the operator-team describe:

```ts
test("overlay member with no repo assignment still team-reasserts", async () => {
  const spy = funnelSpy();
  const result = await reconcileWorkspaceColors({
    observations: [observation("ws-a", "#111111")],
    surfaces: [],
    settings: { assignments: {}, mirrorGroups: true, syncFromCmux: true },
    runtime: runtimeWith(spy.funnel),
    teamByWorkspaceId: new Map([["ws-a", { id: "g1", hex: "#5f7f2a", hexSource: "user" }]]),
  });
  expect(result.decisions[0]).toMatchObject({ outcome: "reassert", hex: "#5f7f2a" });
  expect(spy.writes).toEqual([{ workspaceId: "ws-a", hex: "#5f7f2a", reason: "team-reassert" }]);
});
```

Keep the existing `"answers with the locked defaults until repo-color settings exist"` test. Add:

```ts
test("a HubSettings-shaped object does not smuggle assignments", () => {
  expect(repoColorsSettingsFrom({
    version: 1,
    activityFreshMinutes: 3,
    scanWindowHours: 36,
  }).assignments).toEqual({});
});
```

That second test should already PASS (it locks the hole). The first test should FAIL until the guard moves above `if (!assignment)`.

- [ ] **Step 2: Run tests to verify the new reconcile case fails**

Run: `bun test tests/cmux-color-sync.test.ts`

Expected: FAIL on `"overlay member with no repo assignment still team-reasserts"` with `outcome: "ingest"` or `"ignore"`.

- [ ] **Step 3: Move the team guard and wire the store**

In `reconcileWorkspaceColors`, after computing `repoKey` / `assignment` / `observed`, **before** `if (!assignment)`:

```ts
const team = input.teamByWorkspaceId?.get(workspaceId);
if (team) {
  // existing team match / auto-ingest / team-reassert block, unchanged
  continue;
}
if (!assignment) {
  // existing unmapped ingest / ignore
  continue;
}
// existing match / echo / repo reassert
```

`HubStateOptions`:

```ts
repoColorsReader?: () => RepoColorsSettings;
```

Store the reader on the instance. Replace the production call:

```ts
void syncCmuxColors({
  runner: this.runner,
  executable: this.cmuxExecutable,
  surfaces: this.#surfaces,
  settings: { repoColors: this.repoColorsReader?.() },
  teamByWorkspaceId,
});
```

`src/server/index.ts`:

```ts
import { JsonRepoColorsStore } from "./settings";

const repoColorsStore = await JsonRepoColorsStore.open(join(PROJECT_ROOT, "data/repo-colors.json"));
```

Pass `repoColorsReader: () => repoColorsStore.get()` into `HubState`, and `repoColorsStore` into `createMountainFetch`. Delete the implicit second open inside `defaultRepoColorsStore` for production by injecting the same instance. Previews that call `createMountainFetch` without a store still use `defaultRepoColorsStore`.

Update the comment on `repoColorsSettingsFrom`: production must nest `repoColors`; HubSettings is the wrong object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/cmux-color-sync.test.ts tests/team-tint-snapshot.test.ts`

Expected: PASS. Existing “mapped workspace in an operator team is not re-asserted to the repo hex” still passes.

- [ ] **Step 5: Commit**

```bash
git add src/server/cmux-color-sync.ts src/server/state.ts src/server/index.ts src/server/app.ts tests/cmux-color-sync.test.ts
git commit -m "$(cat <<'EOF'
fix(tint): TINT-S reads repo-colors.json and honours overlay first

Production passed HubSettings, so assignments were always empty and
every workspace looked unmapped. Team reassert never ran.
EOF
)"
```

---

### Task 4: Create and add paint overlay members

**Files:**
- Modify: `src/server/team-groups.ts`
- Modify: `src/server/app.ts`
- Test: `tests/team-groups.test.ts`

**Interfaces:**
- Consumes: `setGroupColor` (already on deps)
- Produces: `TeamGroupDependencies.setWorkspaceColor?`, `persistTeamColor?`

- [ ] **Step 1: Write the failing tests**

In `tests/team-groups.test.ts`, extend `TeamGroupDependencies` test doubles with recording stubs.

```ts
test("create with hex paints each non-anchor member and persists", async () => {
  const painted: Array<{ workspaceId: string; hex: string; reason: string }> = [];
  const persisted: Array<{ groupId: string; hex: string }> = [];
  const { cmux, deps } = subject({ "WINDOW-A": ["ws-a", "ws-b"] });
  const { team } = await createOperatorTeam({
    windowId: "WINDOW-A",
    workspaceIds: ["ws-a", "ws-b"],
    name: "ANT · probe",
    hex: "#5f7f2a",
  }, {
    ...deps,
    setWorkspaceColor: async (workspaceId, hex, reason) => {
      painted.push({ workspaceId, hex, reason });
      return true;
    },
    persistTeamColor: async (groupId, hex) => {
      persisted.push({ groupId, hex });
    },
  });
  const anchor = cmux.groups.get(team.id)?.anchorWorkspaceId;
  expect(painted.every((row) => row.workspaceId !== anchor)).toBe(true);
  expect(painted.map((row) => row.workspaceId).sort()).toEqual(["ws-a", "ws-b"].sort());
  expect(painted.every((row) => row.hex === "#5f7f2a" && row.reason === "board team create")).toBe(true);
  expect(persisted).toEqual([{ groupId: team.id, hex: "#5f7f2a" }]);
});

test("add paints the new member with the live group hex", async () => {
  const painted: Array<{ workspaceId: string; hex: string; reason: string }> = [];
  const { cmux, deps } = subject({ "WINDOW-A": ["ws-a", "ws-b"] });
  cmux.seedGroup("g1", {
    windowId: "WINDOW-A",
    name: "ANT · probe",
    customColor: "#5f7f2a",
    members: ["ws-a"],
  });
  await addOperatorMember("g1", "ws-b", {
    ...deps,
    setWorkspaceColor: async (workspaceId, hex, reason) => {
      painted.push({ workspaceId, hex, reason });
      return true;
    },
  });
  expect(painted).toEqual([{ workspaceId: "ws-b", hex: "#5f7f2a", reason: "board team add" }]);
});
```

Check `subject()`’s `FakeGroup` / `parseCreatedGroup` path: create’s fake must return `anchor_workspace_id` so the test can exclude it. If the fake currently omits the anchor, add it in the fake `workspace.group.create` dispatcher so production and tests share the same shape. If create’s children list **is** `["ws-a", "ws-b"]` and the fake adds a third anchor id, expect painted `["ws-a", "ws-b"]` and not the anchor. Adjust the expect to whatever the fake actually returns — the rule is “every child passed in `workspaceIds`, never the anchor.”

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/team-groups.test.ts`

Expected: FAIL — `setWorkspaceColor` is not on `TeamGroupDependencies`; create does not paint members.

- [ ] **Step 3: Implement paint + persist**

```ts
export interface TeamGroupDependencies {
  runner: CommandRunner;
  executable?: string;
  provenanceIds: () => ReadonlySet<string>;
  repoIdentityKeys?: () => ReadonlySet<string>;
  setGroupColor?: (groupId: string, hex: string, reason: string) => Promise<boolean>;
  setWorkspaceColor?: (workspaceId: string, hex: string, reason: string) => Promise<boolean>;
  persistTeamColor?: (groupId: string, hex: string) => Promise<void>;
}
```

In `createOperatorTeam`, after successful `setGroupColor` (keep 502 if that write was requested and failed):

```ts
if (hex) {
  await deps.persistTeamColor?.(created.id, hex);
  const anchor = created.anchorWorkspaceId;
  for (const workspaceId of created.memberWorkspaceIds) {
    if (workspaceId === anchor) continue;
    await deps.setWorkspaceColor?.(workspaceId, hex, "board team create");
  }
}
```

Member write `false` does not 502 create.

In `addOperatorMember`, after successful add:

```ts
const hex = normalizeHex(live.customColor);
if (hex) await deps.setWorkspaceColor?.(id, hex, "board team add");
```

`app.ts` `/api/teams` handler:

```ts
setWorkspaceColor: dependencies.teamColorWrites?.setWorkspaceColor ?? setWorkspaceColor,
persistTeamColor: async (groupId, hex) => {
  await (await teamColorsStore).setUserColor(groupId, hex);
},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/team-groups.test.ts tests/team-colors.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/team-groups.ts src/server/app.ts tests/team-groups.test.ts
git commit -m "$(cat <<'EOF'
fix(tint): grouping a team paints member terminals

Create coloured the sidebar folder only. Members kept the last repo
fan-out hex until a later Teams PUT.
EOF
)"
```

---

### Task 5: Honest Settings copy, ARCHITECTURE, cache-bust

**Files:**
- Modify: `src/web/settings-panel.js`
- Modify: `src/web/app.js` (`renderTeamColorSettings` empty copy)
- Modify: `src/web/index.html`
- Modify: `ARCHITECTURE.md`
- Test: `tests/team-tint-render.test.ts`

**Interfaces:**
- Consumes: existing paint hosts
- Produces: locked copy from the spec

- [ ] **Step 1: Write the failing DOM tests**

Replace the two tests in `tests/team-tint-render.test.ts` that look for `Repo colours` / `Teams` / `No operator groups.`:

```ts
test("Settings mounts identity and cmux-group plates", () => {
  // existing openSettingsPanel harness
  expect(panel.textContent).toContain("Identity");
  expect(panel.textContent).toContain("Ungrouped rows. A cmux group overrides this.");
  expect(panel.textContent).toContain("Cmux groups");
  expect(panel.textContent).not.toContain("Repo colours");
  expect(panel.querySelector("#repo-colors-host")).toBeTruthy();
  expect(panel.querySelector("#team-colors-host")).toBeTruthy();
});

test("the cmux-groups plate says No named cmux groups when none are live", () => {
  expect(region.textContent).toBe("No named cmux groups.");
});
```

Keep host ids. Add a kicker as `p.kicker` under each `h3` in `settings-panel.js` so the identity kicker is not flattened into the swatch list.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/team-tint-render.test.ts`

Expected: FAIL on copy.

- [ ] **Step 3: Implement copy, docs, cache-bust**

`settings-panel.js` plates:

```js
el("section", { class: "plate", "aria-label": "Repository identity colours" },
  el("h3", { text: "Identity" }),
  el("p", { class: "kicker", text: "Ungrouped rows. A cmux group overrides this." }),
  el("div", { id: "repo-colors-host", class: "repo-colors-host" })),
el("section", { class: "plate", "aria-label": "Cmux groups" },
  el("h3", { text: "Cmux groups" }),
  el("p", { class: "kicker", text: "Live folders. Colour paints the folder and its terminals." }),
  el("div", { id: "team-colors-host", class: "team-colors-host" })),
```

`renderTeamColorSettings` empty text: `"No named cmux groups."`

`src/web/index.html`: replace `ah-t53` with `ah-t54` on all four `?v=` URLs.

`ARCHITECTURE.md` TINT-S paragraph: overlay members are skipped by repo fan-out; TINT-S reads `repo-colors.json` via `repoColorsReader`; team guard runs before unmapped. TINT-G paragraph: maintain provenance-owned groups only; do not mint; do not steal overlay members.

- [ ] **Step 4: Run tests and the floor**

Run:

```bash
bun test tests/team-tint-render.test.ts tests/team-tint.test.ts tests/team-tint-snapshot.test.ts tests/repo-color.test.ts tests/cmux-color-sync.test.ts tests/team-groups.test.ts
bunx tsc --noEmit
bun test
```

Expected: targeted green; `tsc` 0; full suite green except documented `docs/a11y-geometry-gate`.

- [ ] **Step 5: Commit**

```bash
git add src/web/settings-panel.js src/web/app.js src/web/index.html ARCHITECTURE.md tests/team-tint-render.test.ts
git commit -m "$(cat <<'EOF'
fix(tint): say identity vs cmux group in Settings

Two plates, two lifetimes. Copy stops presenting them as equal
grouping languages. Cache-bust ah-t54.
EOF
)"
```

---

## Spec coverage

| Spec decision | Task |
|---|---|
| Overlay product sentence | all (constraint) |
| Predicate / leftover folders | 1 |
| Fan-out skip | 2 |
| TINT-S wiring + team-before-unmapped | 3 |
| Create/add paint + persist | 4 |
| Settings copy | 5 |
| ARCHITECTURE + cache-bust | 5 |
| Do not mint TINT-G | constraint; Task 5 docs |
| No shared ledger / no flag UI / no deploy | constraints |

## Self-review

- No TBD/TODO in task steps.
- `setWorkspaceColor` / `persistTeamColor` / `repoIdentityKeys` / `skipWorkspaceIds` / `repoColorsReader` names are used consistently across tasks.
- Task 3 depends on Task 1 only for keys on `resolveOperatorTeams`; TINT-S wiring does not need skip.
- Task 4 create uses the Task 1 predicate. Do not start 4 before 1.
