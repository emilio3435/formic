# Board stripe colour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings has no colour plates. Ungrouped rows colour by automatic repo hue. Group colour is set on the board stripe and matches cmux.

**Architecture:** Keep the two stores. Stop showing them in Settings. Put repo override on the repo band swatch (same chrome as the group band). Close the write fights so boot GET and TINT-S cannot paint overlay members back to the repo hex.

**Tech Stack:** Existing Bun tests, `cmux-color.ts` funnel, `HubState` collector tick. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-26-tint-overlay-parity-design.md`

## Global Constraints

- Colour the stripe on the board. Settings has zero colour plates.
- Do not call `workspace.group.create` from `cmux-groups.ts`.
- Every colour write goes through `src/server/cmux-color.ts`.
- `normalizeHex` before compare.
- Six hues + clay. Do not share a slot ledger.
- `workspace.group.ungroup`, never `delete`. Never annex by name. Never touch anchors.
- Cache-bust `ah-t53` → `ah-t54` only in Task 5.
- Do not deploy. Do not push unless Emilio asks.
- Branch is `feat/tint-overlay-parity`. Never commit on `main`.
- Do not reintroduce Settings “Identity” / “Cmux groups” / “Repo colours” / “Teams” plates.

---

## File map

| File | Responsibility |
|---|---|
| `src/shared/team-tint.ts` | Overlay predicate |
| `src/server/state.ts` | `repoColorsReader`; TINT-S settings shape |
| `src/server/index.ts` | Open repo-colors store once |
| `src/server/cmux-color-sync.ts` | Team guard before unmapped |
| `src/server/settings.ts` | Fan-out skip |
| `src/server/app.ts` | Skip, persist, member paint, identity keys |
| `src/server/team-groups.ts` | Create/add paint |
| `src/web/app.js` | Repo band picker; dead Settings colour UI gone |
| `src/web/settings-panel.js` | No colour plates; no colour GET on open |
| `src/web/client-state.js` | Drop `teamColors` |
| `ARCHITECTURE.md` | Match |

## Parallelization

Serial. One implementer. `app.js` / `settings-panel.js` / `app.ts` collide if fanned out.

---

### Task 1: Overlay predicate excludes known repo keys

**Files:**
- Modify: `src/shared/team-tint.ts`
- Modify: `src/server/team-groups.ts`
- Modify: `src/server/team-colors.ts`
- Modify: `src/server/state.ts`
- Modify: `src/server/app.ts`
- Test: `tests/team-tint.test.ts`
- Test: `tests/team-tint-snapshot.test.ts`

**Interfaces:**
- Consumes: `isOperatorTeam(name, id, provenance)`
- Produces: `isOperatorTeam(name, id, provenance, repoIdentityKeys = new Set())`; `resolveOperatorTeams` takes the same optional set

- [ ] **Step 1: Write the failing tests**

Add to `tests/team-tint.test.ts`:

```ts
test("a leftover folder named like a known repo is not a team", () => {
  expect(isOperatorTeam("the-ant-hill", "orphan-id", new Set(), new Set(["the-ant-hill"]))).toBe(false);
});

test("ANT · probe stays a team next to a known repo key", () => {
  expect(isOperatorTeam("ANT · probe", "abc", new Set(), new Set(["the-ant-hill"]))).toBe(true);
});

test("omitted repoIdentityKeys keeps today's provenance-only behaviour", () => {
  expect(isOperatorTeam("the-ant-hill", "orphan-id", new Set())).toBe(true);
});
```

In `tests/team-tint-snapshot.test.ts`, add a `resolveOperatorTeams` case: a window group named `the-ant-hill` with a random id, empty provenance, `repoIdentityKeys = {"the-ant-hill"}` → that group is not in `teams`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/team-tint.test.ts tests/team-tint-snapshot.test.ts`

Expected: FAIL — fourth argument unused / leftover folder still a team.

- [ ] **Step 3: Implement the predicate and thread keys**

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

Thread through `resolveOperatorTeams` / `buildOperatorTeams`.

Add in `src/server/app.ts` next to `discoverRepoColors`:

```ts
export function repoIdentityKeysFrom(
  assignments: Record<string, unknown> | undefined,
  snapshot: HubSnapshot,
): Set<string> {
  const keys = new Set<string>();
  for (const key of Object.keys(assignments ?? {})) keys.add(key.toLowerCase());
  for (const program of snapshot.programs) {
    for (const agent of program.agents) {
      const name = agent.repo?.repoName?.trim().toLowerCase();
      if (name) keys.add(name);
    }
  }
  return keys;
}
```

Pass `() => repoIdentityKeysFrom(repoColorsForGroups?.get().assignments, dependencies.state.get())` into team-groups and team-colors handlers.

`TeamGroupDependencies.repoIdentityKeys?: () => ReadonlySet<string>`. Every `isOperatorTeam` in `team-groups.ts` and `team-colors.ts` passes `deps.repoIdentityKeys?.() ?? new Set()`.

`HubState` builds the same set each cmux tick. For this task, if `repoColorsReader` is not wired yet, use snapshot names only plus `this.teamColorsStore` is irrelevant — assignment keys wait for Task 3. Snapshot-only still excludes a live `the-ant-hill` row’s leftover folder.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/team-tint.test.ts tests/team-tint-snapshot.test.ts tests/team-groups.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/team-tint.ts src/server/team-groups.ts src/server/team-colors.ts src/server/state.ts src/server/app.ts tests/team-tint.test.ts tests/team-tint-snapshot.test.ts
git commit -m "$(cat <<'EOF'
fix(tint): leftover repo-named folders are not overlay teams

Empty provenance was classifying the-ant-hill sidebar leftovers as
operator teams.
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
- Consumes: `HubState.teams()`
- Produces: `RepoColorsRequestOptions.skipWorkspaceIds?: () => ReadonlySet<string>`

- [ ] **Step 1: Write the failing test**

In `tests/repo-color.test.ts` beside `"GET fans out to repo-MAPPED workspaces only"` (that test’s `discovery` already has `WS-1` → `the-mountain`, `WS-2` → `formic`):

```ts
test("GET/PUT skip overlay team members", async () => {
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

Keep the existing unmapped-vs-mapped fan-out test. When `skipWorkspaceIds` is omitted it still writes both `WS-1` and `WS-2`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/repo-color.test.ts`

Expected: FAIL — option unknown or `WS-1` still written.

- [ ] **Step 3: Implement skip**

```ts
skipWorkspaceIds?: () => ReadonlySet<string>;
```

```ts
function withoutSkipped(
  writes: readonly { workspaceId: string; hex: string }[],
  options: RepoColorsRequestOptions,
): { workspaceId: string; hex: string }[] {
  const skip = options.skipWorkspaceIds?.() ?? new Set<string>();
  return writes.filter((write) => !skip.has(write.workspaceId));
}
```

GET and `fanOutFor` pass writes through `withoutSkipped` before `fanOut`.

`app.ts` `/api/repo-colors`:

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

Boot GET was painting grouped terminals back to the repo hex.
EOF
)"
```

---

### Task 3: Wire TINT-S to repo-colors.json and check team first

**Files:**
- Modify: `src/server/cmux-color-sync.ts`
- Modify: `src/server/state.ts`
- Modify: `src/server/index.ts`
- Modify: `src/server/app.ts` (accept injected store; already optional)
- Test: `tests/cmux-color-sync.test.ts`

**Interfaces:**
- Consumes: `JsonRepoColorsStore.get()`
- Produces: `HubStateOptions.repoColorsReader?: () => RepoColorsSettings`

- [ ] **Step 1: Write the failing tests**

In `tests/cmux-color-sync.test.ts`:

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

test("a HubSettings-shaped object does not smuggle assignments", () => {
  expect(repoColorsSettingsFrom({
    version: 1,
    activityFreshMinutes: 3,
    scanWindowHours: 36,
  }).assignments).toEqual({});
});
```

The HubSettings test should already pass (lock). The first test fails until the guard moves.

- [ ] **Step 2: Run tests to verify the new reconcile case fails**

Run: `bun test tests/cmux-color-sync.test.ts`

Expected: FAIL on `"overlay member with no repo assignment still team-reasserts"`.

- [ ] **Step 3: Move the team guard and wire the store**

In `reconcileWorkspaceColors`, run the existing team block **before** `if (!assignment)`.

`HubStateOptions.repoColorsReader?: () => RepoColorsSettings`. Store on the instance.

Replace the production call:

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

Pass `repoColorsReader: () => repoColorsStore.get()` into `HubState` and `repoColorsStore` into `createMountainFetch`. Production must not open the file twice.

Update the comment on `repoColorsSettingsFrom`: production nests `repoColors`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/cmux-color-sync.test.ts tests/team-tint-snapshot.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/cmux-color-sync.ts src/server/state.ts src/server/index.ts src/server/app.ts tests/cmux-color-sync.test.ts
git commit -m "$(cat <<'EOF'
fix(tint): TINT-S reads repo-colors.json and honours overlay first

Production passed HubSettings, so every workspace looked unmapped
and team reassert never ran.
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
- Consumes: `setGroupColor` on deps
- Produces: `setWorkspaceColor?`, `persistTeamColor?` on `TeamGroupDependencies`

- [ ] **Step 1: Write the failing tests**

In `tests/team-groups.test.ts`. Adjust painted ids to whatever the fake create returns as children minus `anchor_workspace_id`. The rule is: every id from the request’s `workspaceIds`, never the anchor.

```ts
test("create with hex paints each non-anchor member and persists", async () => {
  const painted: Array<{ workspaceId: string; hex: string; reason: string }> = [];
  const persisted: Array<{ groupId: string; hex: string }> = [];
  const { deps } = subject({ "WINDOW-A": ["ws-a", "ws-b"] });
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
  expect(new Set(painted.map((row) => row.workspaceId))).toEqual(new Set(["ws-a", "ws-b"]));
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

If the fake `workspace.group.create` injects an extra anchor id into `member_workspace_ids`, filter it out of the expect using the fake group’s `anchorWorkspaceId`. Do not paint the anchor.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/team-groups.test.ts`

Expected: FAIL — `setWorkspaceColor` is not on deps.

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

After successful `setGroupColor` on create (keep 502 if that write was requested and failed):

```ts
if (hex) {
  await deps.persistTeamColor?.(created.id, hex);
  for (const workspaceId of created.memberWorkspaceIds) {
    if (workspaceId === created.anchorWorkspaceId) continue;
    await deps.setWorkspaceColor?.(workspaceId, hex, "board team create");
  }
}
```

Member `false` does not 502 create.

`addOperatorMember` after add:

```ts
const hex = normalizeHex(live.customColor);
if (hex) await deps.setWorkspaceColor?.(id, hex, "board team add");
```

`app.ts` `/api/teams`:

```ts
setWorkspaceColor: dependencies.teamColorWrites?.setWorkspaceColor ?? setWorkspaceColor,
persistTeamColor: async (groupId, hex) => {
  await (await teamColorsStore).setUserColor(groupId, hex);
},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/team-groups.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/team-groups.ts src/server/app.ts tests/team-groups.test.ts
git commit -m "$(cat <<'EOF'
fix(tint): grouping a team paints member terminals

Create coloured the sidebar folder only. Members kept the last repo
fan-out hex until a later colour PUT.
EOF
)"
```

---

### Task 5: Colour lives on the board; Settings drops both plates

**Files:**
- Modify: `src/web/app.js`
- Modify: `src/web/settings-panel.js`
- Modify: `src/web/client-state.js`
- Modify: `src/web/index.html`
- Modify: `ARCHITECTURE.md`
- Test: `tests/team-tint-render.test.ts`
- Test: `tests/repo-tint-render.test.ts`

**Interfaces:**
- Consumes: `putRepoColor(repoKey, hex | null)`, `putTeamColor(id, hex)`, `teamBandPicker` (already shipped)
- Produces: `repoBandPicker(group)`; `setRepoColors` also fills a record map `name → { hex, repoKey, source }`; Settings with no colour chrome

- [ ] **Step 1: Write the failing tests**

**Settings absence** — replace `describe("Settings Teams plate")` in `tests/team-tint-render.test.ts`:

```ts
describe("Settings has no colour plates", () => {
  test("Settings does not mount colour hosts or colour headings", () => {
    withDom(() => {
      M.state.settingsPanelOpen = true;
      M.renderSettingsPanel();
      expect(document.getElementById("team-colors-host")).toBeNull();
      expect(document.getElementById("repo-colors-host")).toBeNull();
      const text = byId.get("settings-panel")!.textContent;
      expect(text).not.toContain("Repo colours");
      expect(text).not.toContain("Teams");
      expect(text).not.toContain("Identity");
      expect(text).not.toContain("Cmux groups");
    });
  });

  test("opening Settings does not GET team-colors or repo-colors", async () => {
    const urls: string[] = [];
    const realFetch = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
      urls.push(String(url));
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      M.state.settingsPanelOpen = false;
      withDom(() => { void M.openSettingsPanel(); });
      expect(urls.some((url) => url.includes("/api/team-colors"))).toBe(false);
      expect(urls.some((url) => url.includes("/api/repo-colors"))).toBe(false);
      try { M.closeSettingsPanel(); } catch { /* render() needs the board document */ }
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
    }
  });
});
```

**Repo band picker** — in `tests/repo-tint-render.test.ts`, replace `describe("renderRepoColorSettings")` with tests driven through `renderRepoSection` on a `{ kind: "repo", key: "…", name: "the-ant-hill", worktrees: [...] }` group after `setRepoColors(originEnvelope.repoNames, originEnvelope.settings)`:

- A hexed repo band has `.repo-tint-picker.swatch` and no `.repo-dot`.
- `dataset.fkey` on the hidden input is `repo-color:<assignment.repoKey>` (printed name `the-ant-hill`, key from the join, **not** `the-mountain` and **not** `group.key`).
- User assignment wears `is-yours` on the swatch; auto does not.
- No hex → no swatch, no dot (same as today’s missing mark).
- Invert `opening Settings GETs /api/repo-colors` to **must not**. Keep `maybeRefreshRepoColors` on roster change.

Read `originEnvelope` in that file for the join table. If `renderRepoSection` is easier to drive with a tiny fixture program whose `repo.repoName` is `the-ant-hill`, do that. Do not PUT against `group.key` (FNV).

Keep the existing `"opening Settings GETs /api/repo-colors"` test’s sibling `"a new origin on a later snapshot GETs colours"` — that path stays.

**Grouping chip hex source** — add in `tests/team-parity-render.test.ts` or `tests/team-tint-render.test.ts`:

```ts
test("nextGroupingHex skips hexes already on snapshot teams, not state.teamColors", () => {
  M.state.teamColors = undefined;
  M.state.snap = {
    programs: [{
      agents: [{ team: { id: "g1", name: "A", hex: "#5f7f2a", windowId: "w" } }],
    }],
  };
  expect(M.nextGroupingHex()).not.toBe("#5f7f2a");
});
```

Export `nextGroupingHex` from `app.js` if tests cannot reach it today (it is already in the local-function export block around 15585 — add it if missing).

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
bun test tests/team-tint-render.test.ts tests/repo-tint-render.test.ts
```

Expected: FAIL on hosts still present, Settings still GETting colours, repo band still a `.repo-dot`.

- [ ] **Step 3: Implement board swatches and strip Settings**

**`setRepoColors`** in `app.js` — keep the hex Map for `repoTintFor`. Add:

```js
const repoColorRecords = new Map(); // lowercased printed name -> { hex, repoKey, source }

function setRepoColors(repoNames, settings) {
  repoColors.clear();
  repoColorRecords.clear();
  const assignments = (settings && settings.assignments) || {};
  for (const [name, repoKey] of Object.entries(repoNames || {})) {
    const assignment = assignments[repoKey];
    const hex = normalizeRepoHex(assignment && assignment.hex);
    if (!hex) continue;
    const record = {
      hex,
      repoKey: String(repoKey),
      source: assignment && assignment.source === "user" ? "user" : "auto",
    };
    repoColors.set(String(name).toLowerCase(), hex);
    repoColorRecords.set(String(name).toLowerCase(), record);
  }
  repoColorsVersion += 1;
}
```

**`repoBandPicker(group)`** — clone `teamBandPicker` structure:

```js
function repoBandPicker(group, tint) {
  const record = repoColorRecords.get(String(group.name || "").toLowerCase());
  if (!record || !tint) return null;
  const picker = el("input", {
    type: "color",
    class: "visually-hidden",
    tabindex: "-1",
    value: tint || "#888888",
    "aria-label": "Colour for " + group.name,
    dataset: { fkey: "repo-color:" + record.repoKey },
    onchange: (event) => { void putRepoColor(record.repoKey, event.currentTarget.value); },
  });
  const yours = record.source === "user";
  const swatch = el("button", {
    type: "button",
    class: "repo-tint-picker swatch" + (yours ? " is-yours" : ""),
    "aria-label": "Colour for " + group.name,
    title: yours
      ? "Colour for " + group.name + ". Shift-click to restore automatic."
      : "Colour for " + group.name,
    onclick: (event) => {
      if (event.shiftKey && yours) {
        event.preventDefault();
        void putRepoColor(record.repoKey, null);
        return;
      }
      if (typeof picker.click === "function") picker.click();
    },
  });
  return el("span", {}, paintRepoTint(swatch, tint, "has-repo-tint"), picker);
}
```

In `renderRepoSection`, both kinds use a picker:

```js
...(group.kind === "team"
  ? [teamBandPicker(group, tint)]
  : [repoBandPicker(group, tint)].filter(Boolean)),
```

No `.repo-dot`.

**`.repo.is-yours .swatch` already exists.** Add:

```css
.repo-tint-picker.swatch.is-yours { box-shadow: 0 0 0 2px var(--ink); }
```

in `src/web/styles.css` next to the team picker rules so the ring works on the band (the Settings `.repo.is-yours` path is going away).

**`nextGroupingHex`:**

```js
function nextGroupingHex() {
  const taken = new Set();
  for (const program of (state.snap && state.snap.programs) || []) {
    for (const agent of program.agents || []) {
      const hex = normalizeRepoHex(agent && agent.team && agent.team.hex);
      if (hex) taken.add(hex);
    }
  }
  return TEAM_PALETTE.find((hex) => !taken.has(hex)) || "#64707c";
}
```

**Delete** `paintRepoColorSettings`, `renderRepoColorSettings`, `paintTeamColorSettings`, `renderTeamColorSettings`, `fetchTeamColors`. Remove them from `bindSettingsPanel`, the settings-panel import/deps, and the `TheAntHill` export list. After create/rename/ungroup, drop `void fetchTeamColors()` — `fetchSnapshot()` stays.

**`client-state.js`:** delete `teamColors`.

**`settings-panel.js` `openSettingsPanel`:** only `renderSettingsPanel()` + `fetchCollectorInstances()`. No colour GETs.

**Settings DOM:** remove the two colour `<section>`s. Do not leave Needs-you inside `.split` (one child in `grid-template-columns: 1fr 1fr` is a half-width hole). Needs-you is a full-width `.plate` sibling of collectors and horizon:

```js
el("div", { id: "settings-homes", class: "homes" }, renderCollectorsBlock()),
el("div", { id: "settings-needs-you", class: "plate" }),
el("section", { class: "horizon", "aria-label": "Horizon" }, …),
```

`paintNeedsYouPlates` still targets `#settings-needs-you`. Drop `paintRepoColorSettings()` / `paintTeamColorSettings()` from `renderSettingsPanel`.

**`index.html`:** `ah-t53` → `ah-t54` on all four `?v=`.

**`ARCHITECTURE.md`:** TINT-S reads `repo-colors.json`; overlay members skipped on repo fan-out; colour UI is board swatches; TINT-G does not mint; delete any “Settings → Repo colours / Teams” description.

- [ ] **Step 4: Run tests and the floor**

Run:

```bash
bun test tests/team-tint-render.test.ts tests/repo-tint-render.test.ts tests/team-parity-render.test.ts tests/team-tint.test.ts tests/team-tint-snapshot.test.ts tests/repo-color.test.ts tests/cmux-color-sync.test.ts tests/team-groups.test.ts
bunx tsc --noEmit
bun test
```

Expected: targeted green; `tsc` 0; full suite green except documented `docs/a11y-geometry-gate`. Grep the test run for leftover `renderRepoColorSettings` / `fetchTeamColors` / `team-colors-host` failures and fix — those symbols must be gone, so any remaining import is a test you missed rewriting.

- [ ] **Step 5: Commit**

```bash
git add src/web/app.js src/web/settings-panel.js src/web/client-state.js src/web/styles.css src/web/index.html ARCHITECTURE.md tests/team-tint-render.test.ts tests/repo-tint-render.test.ts tests/team-parity-render.test.ts
git commit -m "$(cat <<'EOF'
feat(board): colour the stripe; Settings is not a palette

Repo hue stays automatic. Group colour is picked on the card.
Settings drops both colour plates so they cannot fight.
EOF
)"
```

---

## Spec coverage

| Spec | Task |
|---|---|
| Predicate / leftover folders | 1 |
| Fan-out skip | 2 |
| TINT-S wiring | 3 |
| Create/add paint | 4 |
| Settings has no colour plates | 5 |
| Repo band swatch + shift-click reset | 5 |
| Group band swatch unchanged | 5 (keep) |
| `nextGroupingHex` from snapshot | 5 |
| No colour GET on Settings open | 5 |
| ARCHITECTURE + cache-bust | 5 |
| Do not mint TINT-G | constraint |

## Self-review

- No TBD in task steps.
- Names `skipWorkspaceIds`, `repoColorsReader`, `persistTeamColor`, `repoBandPicker`, `repoColorRecords`, `repoIdentityKeysFrom` are used consistently.
- Task 5 deletes Settings colour tests rather than leaving them red against deleted functions.
- Task 5 inverts the Settings GET tests rather than deleting the boot/roster GET coverage.
