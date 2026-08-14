# Repo colour band identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings → Repository colours lists the same objects the unscoped board shows, under the same names; a new origin appears without a reload; rows with no live sessions stay on the list and are marked **Not on the board**.

**Architecture:** Colour identity becomes the GitHub origin basename (what `RepoIdentity.repoName` already prints on the band), not the checkout folder (`git rev-parse --git-common-dir` parent). `the-mountain` and `anthill-pulse` — two clones of `emilio3435/the-ant-hill` — collapse to one assignment keyed `the-ant-hill`. A one-shot rebase copies the winning folder assignment onto that key and deletes the donor folder keys. The client re-GETs `/api/repo-colors` when Settings opens and whenever the snapshot’s set of origin names changes, and paints the colour fieldset independently so a colour refresh cannot wipe the rest of the Settings form.

**Tech Stack:** Bun + TypeScript (strict), bun:test, plain-JS web client (`src/web/app.js`). Same surface as TINT-F.

**Branch:** `feat/repo-color-band-identity` cut from `origin/main` in a **new worktree**. Do **not** edit `/Users/emilionunezgarcia/Developer/the-mountain-production` (that tree is the live 4701 process). Do **not** implement in `docs/formic-evidence-ux-adversarial` — that worktree’s `src/web` does not contain TINT-F. Local commits only; push/PR needs Emilio’s word.

This plan file currently lives at `docs/superpowers/plans/2026-08-13-repo-color-band-identity.md` in the evidence-ux worktree. Copy it into the implementation worktree (same relative path) as the first commit, or read it in place — do not start from a missing plan.

**Why this exists:** RCA 2026-08-13. The board band is named `the-ant-hill` (origin). Settings listed `the-mountain` and `anthill-pulse` (folders). Two folder-keys claimed one printed name, so discovery dropped the join and the band went untinted. Polling would not have created a row called `the-ant-hill`.

## Global Constraints

- Colour key = lowercase origin basename when `git remote get-url origin` succeeds; else the existing folder key (common-dir parent). Never the FNV `RepoIdentity.repoKey` (`6wvl9e`) — that is opaque in Settings and would rename cmux groups to hashes.
- One origin → one colour → one Settings row. Two clones of the same GitHub repo share a colour. That is the point. Independently colouring `anthill-pulse` vs `the-mountain` is out of scope.
- Forks that share a GitHub **basename** but not an origin (rare) also share a colour in v1. Do not add owner slugs unless a second origin actually collides on this machine.
- Assignments still persist forever. Do **not** delete a key because it left the board. Mark it instead.
- `GET /api/repo-colors` remains the only writer that assigns new keys (`ensure`). The client does not invent colours.
- Do not rebuild the Settings **form** when colours arrive. Number fields the operator is typing must survive a colour GET. Colour rows live in their own host node.
- Do not add a timer. Refresh is: boot (already), Settings open, and snapshot live-key set change.
- `fetchRepoColors` keeps the `bootGeneration` guard (geometry gate / `stopBoot`). A colour GET started before freeze must not `render()` after freeze.
- CSP: no `style="…"` attributes. `--repo-tint` stays a CSSOM `setProperty` as today.
- Authority rules 1–6 in `docs/superpowers/plans/2026-08-13-tint/00-MASTER-PLAN.md` still hold. This plan amends only the **definition of repoKey** used for colour (origin basename, not folder).
- Floor per task: the named test file green. Before the branch is called done: `bunx tsc --noEmit` clean and `bun test` at parity with `main` (tolerated red: `docs/a11y-geometry-gate` only, needs a live board).
- Cache-bust: bump `?v=ah-t32` → `?v=ah-t33` in `src/web/index.html` in the task that ships CSS/JS the browser caches.
- Comment style: short “why” paragraphs where the code cannot say it. No essays.

**Copy (locked):**

- Presence, live: keep today’s `auto` / `your colour`.
- Presence, absent: `Not on the board`. If it is also a user override, `your colour · not on the board`.
- Empty catalog: unchanged sentence (“No repository has been given a colour yet — one is assigned the first time the board sees a session in it.”).
- Legend help, replace with: `A colour you pick here follows the repository name on the board, including every clone of that GitHub repo, and travels to its cmux workspaces.`

**Sort (locked):** live rows first, alphabetical by name; then not-on-board rows, alphabetical by name.

**Migration winner (locked):** when two folder keys rebase onto one origin key, keep `source: "user"` over `auto`; then the folder key that appears most often in the live alias list; then lexicographic folder key. On this machine that keeps `the-mountain`’s user hex (`#0ae6e2`) and drops `anthill-pulse` as a separate row.

---

### File map

| File | Role |
|---|---|
| `src/shared/repo-color.ts` | Origin-preferring `repoKeyForCwd`; keep folder fallback as `folderKeyForCwd`; `originBasename`; `rebaseAssignmentsOntoOriginKeys` |
| `src/server/settings.ts` | Discovery aliases; `ensure` rebases then assigns; payload `liveKeys` |
| `src/server/app.ts` | `discoverRepoColors` passes origin key + folder alias |
| `src/web/client-state.js` | `repoColorSettings`, `liveRepoKeys` |
| `src/web/app.js` | Independent colour paint; Settings open GET; live-key sig; row copy/sort |
| `src/web/styles.css` | `.is-absent` treatment |
| `src/web/index.html` | cache-bust |
| `tests/repo-color.test.ts` | origin key, rebase, liveKeys |
| `tests/repo-tint-render.test.ts` | Settings rows, independent paint, fetch triggers |

TINT-S (`cmux-color-sync.ts`) injects `repoKeyForCwd` from the shared module. Changing that function’s production body is enough; its unit tests inject a fake and stay internally consistent. Do not rewrite those fakes unless a test imports the **real** `repoKeyForCwd` and pins `the-mountain` as this checkout’s key.

---

### Task 1: Origin basename is the colour key

**Files:**
- Modify: `src/shared/repo-color.ts`
- Test: `tests/repo-color.test.ts`

**Interfaces:**
- Consumes: existing `RepoKeyExec`, `repoKeyForCwd(cwd, options?)`
- Produces: `folderKeyForCwd(cwd, options?)` (today’s body); `originBasename(remote: string): string | null`; `repoKeyForCwd` prefers origin basename, else `folderKeyForCwd`

- [ ] **Step 1: Write the failing tests**

In `tests/repo-color.test.ts`, extend `fakeGit` so it inspects argv for **both** `rev-parse --git-common-dir` and `remote get-url origin`. Existing tests pass no origins table and must keep working (folder fallback).

```ts
function fakeGit(
  commonDirs: Record<string, string>,
  origins: Record<string, string> = {},
): RepoKeyExec {
  return (command) => {
    const [binary, dashC, cwd, ...rest] = command;
    if (binary !== "git" || dashC !== "-C") {
      throw new Error(`repoKeyForCwd shelled something other than \`git -C\`: ${command.join(" ")}`);
    }
    if (rest[0] === "remote" && rest[1] === "get-url" && rest[2] === "origin") {
      const origin = origins[cwd ?? ""];
      return origin === undefined
        ? { exitCode: 2, stdout: "" }
        : { exitCode: 0, stdout: `${origin}\n` };
    }
    const flags = rest;
    if (!flags.includes("rev-parse") || !flags.includes("--git-common-dir")) {
      throw new Error(`unexpected git invocation: ${command.join(" ")}`);
    }
    if (flags.includes("--show-toplevel")) {
      throw new Error("--show-toplevel answers the LINKED WORKTREE's own directory, which fragments one repository into many");
    }
    const answer = commonDirs[cwd ?? ""];
    return answer === undefined
      ? { exitCode: 128, stdout: "" }
      : { exitCode: 0, stdout: `${answer}\n` };
  };
}
```

Add tests (keep the existing worktree-collapse test, which has no origins table and must still return `the-mountain`):

```ts
test("an origin basename wins over the folder the clone happens to sit in", () => {
  const exec = fakeGit(
    {
      "/Users/e/Developer/the-mountain": "/Users/e/Developer/the-mountain/.git",
      "/Users/e/Developer/anthill-pulse": "/Users/e/Developer/anthill-pulse/.git",
      "/Users/e/Developer/the-mountain.worktrees/tint-f": "/Users/e/Developer/the-mountain/.git",
    },
    {
      "/Users/e/Developer/the-mountain": "https://github.com/emilio3435/the-ant-hill.git",
      "/Users/e/Developer/anthill-pulse": "git@github.com:emilio3435/the-ant-hill.git",
      "/Users/e/Developer/the-mountain.worktrees/tint-f": "https://github.com/emilio3435/the-ant-hill.git",
    },
  );
  expect(repoKeyForCwd("/Users/e/Developer/the-mountain", { exec })).toBe("the-ant-hill");
  expect(repoKeyForCwd("/Users/e/Developer/anthill-pulse", { exec })).toBe("the-ant-hill");
  expect(repoKeyForCwd("/Users/e/Developer/the-mountain.worktrees/tint-f", { exec })).toBe("the-ant-hill");
});

test("without an origin, the folder key is still the answer", () => {
  const exec = fakeGit({
    "/Users/e/Developer/the-mountain": "/Users/e/Developer/the-mountain/.git",
  });
  expect(repoKeyForCwd("/Users/e/Developer/the-mountain", { exec })).toBe("the-mountain");
});

test("folderKeyForCwd ignores origin and still collapses worktrees", () => {
  const exec = fakeGit(
    {
      "/Users/e/Developer/the-mountain": "/Users/e/Developer/the-mountain/.git",
      "/Users/e/Developer/the-mountain.worktrees/tint-f": "/Users/e/Developer/the-mountain/.git",
    },
    {
      "/Users/e/Developer/the-mountain": "https://github.com/emilio3435/the-ant-hill.git",
      "/Users/e/Developer/the-mountain.worktrees/tint-f": "https://github.com/emilio3435/the-ant-hill.git",
    },
  );
  expect(folderKeyForCwd("/Users/e/Developer/the-mountain", { exec })).toBe("the-mountain");
  expect(folderKeyForCwd("/Users/e/Developer/the-mountain.worktrees/tint-f", { exec })).toBe("the-mountain");
});
```

Update the live-git test comment: it currently explains that CI’s folder is `the-ant-hill` and the laptop’s is `the-mountain`. After this task, **origin makes them the same key**. Keep the “one key from root and subdirectory” assertion. Optionally assert `repoKeyForCwd(root) === "the-ant-hill"` **only if** `git remote get-url origin` on that root contains `the-ant-hill`; skip the name pin when origin is missing so a weird checkout cannot fail CI.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/repo-color.test.ts`
Expected: FAIL — `folderKeyForCwd` is not exported; origin URLs are ignored; `the-mountain` clone still keys as `the-mountain`.

- [ ] **Step 3: Implement**

In `src/shared/repo-color.ts`:

1. Rename today’s `repoKeyForCwd` body to `folderKeyForCwd` (same exec, same `--git-common-dir` rules). Export it.
2. Add `originBasename(remote: string): string | null` in this file (shared cannot import `src/server/repo-identity.ts`). Strip a trailing `.git`, take the last path segment, lowercase. Handle `https://github.com/emilio3435/the-ant-hill.git` and `git@github.com:emilio3435/the-ant-hill.git`. Empty / junk → `null`.
3. `repoKeyForCwd`:
   - `exec(["git", "-C", cwd, "remote", "get-url", "origin"])`
   - if exit 0 and `originBasename(stdout)` is non-null, return that
   - else `folderKeyForCwd(cwd, options)`
4. Update the `RepoColorAssignment.repoKey` doc comment: canonical colour key is the origin basename, folder key only when origin is absent.

Do not add a ninth palette slot. Do not change `assignSlot`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/repo-color.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/repo-color.ts tests/repo-color.test.ts
git commit -m "$(cat <<'EOF'
feat(tint): colour identity follows GitHub origin, not checkout folder

Two clones of the-ant-hill were two Settings rows because the key was the
directory the .git lived in. Origin basename is what the board already prints.
EOF
)"
```

---

### Task 2: Rebase stored folder keys onto origin keys

**Files:**
- Modify: `src/shared/repo-color.ts`
- Modify: `src/server/settings.ts` (`JsonRepoColorsStore.ensure`, `RepoColorDiscovery`, `repoColorsPayload`)
- Test: `tests/repo-color.test.ts`

**Interfaces:**
- Consumes: `folderKeyForCwd`, `repoKeyForCwd` from Task 1
- Produces:
  - `rebaseAssignmentsOntoOriginKeys(settings, aliases) → RepoColorsSettings`
  - `RepoColorDiscovery.aliases: { folderKey: string; originKey: string }[]`
  - `RepoColorDiscovery` / payload field `liveKeys: string[]` (sorted unique origin keys currently discovered — same as `repoKeys`)
  - `ensure(repoKeys, aliases?)` rebases then `withAssignments`

- [ ] **Step 1: Write the failing tests**

```ts
describe("rebaseAssignmentsOntoOriginKeys", () => {
  const empty = defaultRepoColorsSettings();

  test("two folder clones of one origin become one assignment, user hex of the heavier clone wins", () => {
    const seeded: RepoColorsSettings = {
      ...empty,
      assignments: {
        "the-mountain": { repoKey: "the-mountain", hex: "#0ae6e2", slot: null, source: "user" },
        "anthill-pulse": { repoKey: "anthill-pulse", hex: "#10d2f9", slot: null, source: "user" },
      },
    };
    const aliases = [
      { folderKey: "the-mountain", originKey: "the-ant-hill" },
      { folderKey: "the-mountain", originKey: "the-ant-hill" },
      { folderKey: "the-mountain", originKey: "the-ant-hill" },
      { folderKey: "anthill-pulse", originKey: "the-ant-hill" },
    ];
    const next = rebaseAssignmentsOntoOriginKeys(seeded, aliases);
    expect(next.assignments["the-ant-hill"]?.hex).toBe("#0ae6e2");
    expect(next.assignments["the-ant-hill"]?.source).toBe("user");
    expect(next.assignments["the-mountain"]).toBeUndefined();
    expect(next.assignments["anthill-pulse"]).toBeUndefined();
  });

  test("a user override beats an auto donor even if the auto folder is heavier", () => {
    const seeded: RepoColorsSettings = {
      ...empty,
      assignments: {
        "the-mountain": { repoKey: "the-mountain", hex: "#5f7f2a", slot: 0, source: "auto" },
        "anthill-pulse": { repoKey: "anthill-pulse", hex: "#10d2f9", slot: null, source: "user" },
      },
    };
    const aliases = [
      { folderKey: "the-mountain", originKey: "the-ant-hill" },
      { folderKey: "the-mountain", originKey: "the-ant-hill" },
      { folderKey: "anthill-pulse", originKey: "the-ant-hill" },
    ];
    expect(rebaseAssignmentsOntoOriginKeys(seeded, aliases).assignments["the-ant-hill"]?.hex)
      .toBe("#10d2f9");
  });

  test("an origin key that already exists is left alone; donor folder keys still drop", () => {
    const seeded: RepoColorsSettings = {
      ...empty,
      assignments: {
        "the-ant-hill": { repoKey: "the-ant-hill", hex: "#2e66a8", slot: 1, source: "user" },
        "the-mountain": { repoKey: "the-mountain", hex: "#0ae6e2", slot: null, source: "user" },
      },
    };
    const next = rebaseAssignmentsOntoOriginKeys(seeded, [
      { folderKey: "the-mountain", originKey: "the-ant-hill" },
    ]);
    expect(next.assignments["the-ant-hill"]?.hex).toBe("#2e66a8");
    expect(next.assignments["the-mountain"]).toBeUndefined();
  });

  test("a folder assignment with no live alias stays — it will render as not on the board", () => {
    const seeded: RepoColorsSettings = {
      ...empty,
      assignments: {
        "job-bored": { repoKey: "job-bored", hex: "#e24677", slot: null, source: "user" },
      },
    };
    const next = rebaseAssignmentsOntoOriginKeys(seeded, [
      { folderKey: "the-mountain", originKey: "the-ant-hill" },
    ]);
    expect(next.assignments["job-bored"]?.hex).toBe("#e24677");
  });
});
```

Also extend the existing GET handler test (same file, `handleRepoColorsRequest` describe) so a GET with discoverer returning `liveKeys`/`aliases` includes `liveKeys` on the JSON body. If no such GET test exists yet, add one:

```ts
test("GET reports liveKeys separately from persisted assignments", async () => {
  const store = await JsonRepoColorsStore.open("colors.json", memorySettingsFiles());
  await store.ensure(["cooper-scheduler", "the-mountain"]);
  const response = await handleRepoColorsRequest(new Request("http://127.0.0.1:4701/api/repo-colors"), store, {
    discover: () => ({
      repoKeys: ["the-ant-hill"],
      names: { "the-ant-hill": "the-ant-hill" },
      workspaces: {},
      aliases: [{ folderKey: "the-mountain", originKey: "the-ant-hill" }],
    }),
  });
  const body = await response.json() as {
    liveKeys: string[];
    settings: { assignments: Record<string, unknown> };
  };
  expect(body.liveKeys).toEqual(["the-ant-hill"]);
  expect(body.settings.assignments["the-ant-hill"]).toBeTruthy();
  expect(body.settings.assignments["the-mountain"]).toBeUndefined();
  expect(body.settings.assignments["cooper-scheduler"]).toBeTruthy(); // persisted, not live
});
```

`RepoColorDiscovery` must gain `aliases` (default `[]` at every current construction site so TypeScript fails until you add it). `repoKeys` stays the live origin keys.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/repo-color.test.ts`
Expected: FAIL — `rebaseAssignmentsOntoOriginKeys` missing; GET body has no `liveKeys`.

- [ ] **Step 3: Implement**

`rebaseAssignmentsOntoOriginKeys`:

```ts
export interface ColorKeyAlias {
  folderKey: string;
  originKey: string;
}

export function rebaseAssignmentsOntoOriginKeys(
  settings: RepoColorsSettings,
  aliases: readonly ColorKeyAlias[],
): RepoColorsSettings {
  const assignments: Record<string, RepoColorAssignment> = { ...settings.assignments };
  const byOrigin = new Map<string, string[]>();
  for (const { folderKey, originKey } of aliases) {
    if (!folderKey || !originKey) continue;
    const list = byOrigin.get(originKey) ?? [];
    list.push(folderKey);
    byOrigin.set(originKey, list);
  }
  const weight = (originKey: string, folderKey: string) =>
    aliases.filter((row) => row.originKey === originKey && row.folderKey === folderKey).length;
  for (const [originKey, folderKeys] of byOrigin) {
    const uniqueFolders = [...new Set(folderKeys)];
    if (!assignments[originKey]) {
      const donors = uniqueFolders
        .map((key) => ({ key, assignment: assignments[key] }))
        .filter((row): row is { key: string; assignment: RepoColorAssignment } => Boolean(row.assignment));
      if (donors.length) {
        donors.sort((left, right) => {
          const source = Number(right.assignment.source === "user") - Number(left.assignment.source === "user");
          if (source) return source;
          const heaviness = weight(originKey, right.key) - weight(originKey, left.key);
          if (heaviness) return heaviness;
          return left.key.localeCompare(right.key);
        });
        const winner = donors[0]!.assignment;
        assignments[originKey] = { ...winner, repoKey: originKey };
      }
    }
    for (const folderKey of uniqueFolders) {
      if (folderKey !== originKey) delete assignments[folderKey];
    }
  }
  return { ...settings, assignments };
}
```

`JsonRepoColorsStore.ensure`:

```ts
async ensure(
  repoKeys: readonly string[],
  aliases: readonly ColorKeyAlias[] = [],
): Promise<RepoColorsSettings> {
  const rebased = aliases.length
    ? rebaseAssignmentsOntoOriginKeys(this.#settings, aliases)
    : this.#settings;
  const next = withAssignments(rebased, repoKeys);
  const sameKeys =
    Object.keys(next.assignments).length === Object.keys(this.#settings.assignments).length
    && Object.keys(next.assignments).every((key) => {
      const left = next.assignments[key];
      const right = this.#settings.assignments[key];
      return left && right && left.hex === right.hex && left.source === right.source;
    });
  if (sameKeys) return this.get();
  return this.#write(next);
}
```

The old `ensure` compared only assignment **counts**. After rebase, count can stay 7 while keys change (`the-mountain` → `the-ant-hill`). Compare identity, not length.

`repoColorDiscovery`: build `aliases` from subjects that carry both keys. Add optional `folderKey?: string | null` on `RepoColorSubject`. `liveKeys` is `[...repoKeys]` (already sorted).

`repoColorsPayload`: add `liveKeys: discovery.repoKeys`.

`handleRepoColorsRequest` GET: `store.ensure(discovery.repoKeys, discovery.aliases ?? [])`. PUT/DELETE payloads must include `liveKeys` too (same helper).

Default `aliases: []` on every `discover?.() ?? { repoKeys: [], names: {}, workspaces: {}, aliases: [] }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/repo-color.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/repo-color.ts src/server/settings.ts tests/repo-color.test.ts
git commit -m "$(cat <<'EOF'
feat(tint): rebase folder colour keys onto origin names

Persisted the-mountain / anthill-pulse rows become one the-ant-hill
assignment so Settings can name the band the operator already sees.
EOF
)"
```

---

### Task 3: Discovery walks origin names, not folders

**Files:**
- Modify: `src/server/app.ts` (`discoverRepoColors`, keep `cachedRepoKey` as **folder** cache via `folderKeyForCwd`)
- Test: `tests/repo-color.test.ts` (route-level if one exists against `createMountainFetch`; otherwise a unit test of `discoverRepoColors` if you export it — prefer exporting `discoverRepoColors` over testing through the whole app)

**Interfaces:**
- Consumes: `agent.repo.repoName`, `folderKeyForCwd` / `cachedRepoKey`
- Produces: subjects `{ repoKey: originName, repoName, folderKey, workspaceId }`

- [ ] **Step 1: Write the failing test**

Export `discoverRepoColors` from `app.ts` if it is not already (it is a file-private function today). Add:

```ts
test("two clones of the-ant-hill.git discover as one live key", () => {
  const snapshot = {
    ...emptySnapshot(),
    programs: [
      {
        id: "a", name: "the-ant-hill",
        agents: [{
          id: "1", repo: { repoName: "the-ant-hill", repoKey: "6wvl9e", worktreePath: "/Users/e/Developer/the-mountain", ephemeral: false },
          target: { workspaceId: "WS-1" },
        }],
      },
      {
        id: "b", name: "the-ant-hill",
        agents: [{
          id: "2", repo: { repoName: "the-ant-hill", repoKey: "6wvl9e", worktreePath: "/Users/e/Developer/anthill-pulse", ephemeral: false },
          target: { workspaceId: "WS-2" },
        }],
      },
    ],
  };
  const discovery = discoverRepoColors(snapshot as HubSnapshot);
  expect(discovery.repoKeys).toEqual(["the-ant-hill"]);
  expect(discovery.names).toEqual({ "the-ant-hill": "the-ant-hill" });
  expect(new Set(discovery.aliases.map((row) => row.originKey))).toEqual(new Set(["the-ant-hill"]));
});
```

Stub `cachedRepoKey` by not requiring real git: `discoverRepoColors` must take origin from `agent.repo.repoName` (already on the snapshot) and folder from `cachedRepoKey(worktreePath)` only for aliases. If `cachedRepoKey` would spawn git in this test, inject a map or skip aliases when git fails — **origin key must not depend on git**.

Shape the production function as:

```ts
repoKey: agent.repo?.repoName?.trim().toLowerCase() || null,
repoName: agent.repo?.repoName,
folderKey: worktreePath ? cachedRepoKey(worktreePath) : null,
workspaceId: agent.target?.workspaceId,
```

`cachedRepoKey` must call `folderKeyForCwd`, not `repoKeyForCwd`, or aliases would be origin→origin and rebase would never see `the-mountain`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/repo-color.test.ts`
Expected: FAIL — discovery still keys by folder via `repoKeyForCwd`.

- [ ] **Step 3: Implement**

In `src/server/app.ts`:

- `cachedRepoKey` → `folderKeyForCwd` (update the import).
- `discoverRepoColors` as above.
- `resetRepoKeyCache` unchanged.

Ambiguous-name drop: after this, origin key **is** the printed name, so `the-mountain` + `anthill-pulse` no longer claim `the-ant-hill` as two keys. The existing drop test (two **different** origin keys, same printed name) remains valid for actual forks; do not delete it. It will not fire on this fleet.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/repo-color.test.ts`
Expected: PASS. Also run `bun test tests/cmux-color-sync.test.ts tests/cmux-groups.test.ts` if those files exist — they must stay green because they inject fakes.

- [ ] **Step 5: Commit**

```bash
git add src/server/app.ts tests/repo-color.test.ts
git commit -m "$(cat <<'EOF'
feat(tint): discover colour keys from the band name already on the snapshot

Folder git is only an alias for migrating old assignments. Live identity
does not spawn rev-parse per agent.
EOF
)"
```

---

### Task 4: Settings rows — band name, sort, not-on-board, independent paint

**Files:**
- Modify: `src/web/client-state.js`
- Modify: `src/web/app.js` (`renderSettingsPanel`, `renderRepoColorSettings`, `fetchRepoColors`, `putRepoColor`)
- Modify: `src/web/styles.css`
- Test: `tests/repo-tint-render.test.ts`

**Interfaces:**
- Consumes: `body.liveKeys`, `body.settings.assignments`, `body.repoNames`
- Produces: `state.liveRepoKeys: string[]`; host `#repo-colors-host`; `paintRepoColorSettings()`; Settings form signature **without** `repoColorsVersion`

- [ ] **Step 1: Write the failing tests**

In `tests/repo-tint-render.test.ts`:

1. Rewrite the wire-join fixture so this checkout’s envelope is origin-named (the defect the old fixture pinned is **gone** when name === key). Keep one synthetic test that name≠key still joins (no-origin folder fallback):

```ts
const envelope = {
  ok: true,
  settings: {
    assignments: {
      "the-ant-hill": { repoKey: "the-ant-hill", hex: STORM, slot: 1, source: "auto" },
      "cooper-scheduler": { repoKey: "cooper-scheduler", hex: SIENNA, slot: 2, source: "user" },
    },
    mirrorGroups: true, syncFromCmux: true,
  },
  repoNames: { "the-ant-hill": "the-ant-hill", "cooper-scheduler": "cooper-scheduler" },
  liveKeys: ["the-ant-hill"],
};
```

Band named `the-ant-hill` must tint. Settings must show a row whose **visible name** is `the-ant-hill`, not `the-mountain`.

2. `cooper-scheduler` is persisted but not in `liveKeys` → row has class `is-absent` and text `Not on the board` (and `your colour` because source is user → `your colour · not on the board`).

3. Sort: live `the-ant-hill` before absent `cooper-scheduler` even though C < T alphabetically.

4. Independent paint: open Settings, set a number input value to `"9"`, bump colours (`setRepoColors` / `state.liveRepoKeys` + `paintRepoColorSettings`), assert the input is still `"9"`. Today `repoColorsVersion` is in the Settings signature, so this fails until you drop it.

Use the existing fake-DOM harness in that file. Export `paintRepoColorSettings` on `TheAntHill` next to `renderRepoColorSettings`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/repo-tint-render.test.ts`
Expected: FAIL — Settings lists assignment keys with no presence mark; form rebuilds on colour version.

- [ ] **Step 3: Implement**

`client-state.js`:

```js
repoColorSettings: null,
liveRepoKeys: [],
```

`fetchRepoColors` / `putRepoColor`:

```js
state.liveRepoKeys = Array.isArray(body.liveKeys) ? body.liveKeys.map(String) : [];
state.repoColorSettings = body.settings;
setRepoColors(body.repoNames, body.settings);
```

`renderSettingsPanel` signature: **remove** `String(repoColorsVersion)`. After building the fieldset, append a host, do not inline the rows:

```js
el("fieldset", { class: "settings-local" },
  el("legend", { text: "Repository colours" }),
  el("p", { class: "settings-help", text: "A colour you pick here follows the repository name on the board, including every clone of that GitHub repo, and travels to its cmux workspaces." }),
  el("div", { id: "repo-colors-host", class: "repo-colors-host" })),
```

At the end of a full panel rebuild, and on the `paintUnchanged("settings")` early-return path, call `paintRepoColorSettings()`.

`paintRepoColorSettings`:

- Find `#repo-colors-host`. If missing, return.
- Sig: `JSON.stringify(state.repoColorSettings) + "\u001f" + (state.liveRepoKeys || []).join(",")`. `paintUnchanged("repo-colors", sig)` then return.
- `textContent = ""` then append `renderRepoColorSettings()`.

`renderRepoColorSettings`:

```js
const live = new Set((state.liveRepoKeys || []).map((key) => String(key).toLowerCase()));
const keys = Object.keys(assignments);
const ranked = keys.sort((left, right) => {
  const leftLive = live.has(left.toLowerCase()) ? 0 : 1;
  const rightLive = live.has(right.toLowerCase()) ? 0 : 1;
  return leftLive - rightLive || left.localeCompare(right);
});
```

Row class: `"repo-colors-row" + (onBoard ? "" : " is-absent")`.
Source text: onBoard ? (`user` → `your colour` : `auto`) : (user ? `your colour · not on the board` : `Not on the board`).
Visible name: the assignment key (now the band name). `aria-label` on the swatch: `Colour for the-ant-hill` plus `, not on the board` when absent.

CSS:

```css
.repo-colors-row.is-absent {
  background: var(--sand);
}
.repo-colors-row.is-absent .repo-colors-name {
  color: var(--muted);
}
.repo-colors-row.is-absent .repo-colors-source {
  color: var(--muted);
  font-weight: 650;
}
```

Do not use opacity on the whole row — the swatch must stay a real colour chip.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/repo-tint-render.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/web/client-state.js src/web/app.js src/web/styles.css tests/repo-tint-render.test.ts
git commit -m "$(cat <<'EOF'
feat(web): Settings colours use band names and mark idle repos

The colour list is no longer a frozen folder catalog. Absent origins stay
pickable and say they are not on the board, without rebuilding the form.
EOF
)"
```

---

### Task 5: Refresh on Settings open and on live roster change

**Files:**
- Modify: `src/web/app.js` (`applySnapshot`, settings toggle, `liveRepoSig`)
- Test: `tests/repo-tint-render.test.ts`

**Interfaces:**
- Consumes: `state.snap.programs[].agents[].repo.repoName`
- Produces: `liveRepoSig(snap) → string`; `maybeRefreshRepoColors(snap)` 

- [ ] **Step 1: Write the failing tests**

Export `liveRepoSig`, `maybeRefreshRepoColors`, and `openSettingsPanel` (extract the toggle body) on `TheAntHill`. Stub `globalThis.fetch` as the existing `fetchRepoColors` test already does.

```ts
function snapWithRepos(names: string[]) {
  return {
    schemaVersion: 1,
    programs: names.map((repoName, i) => ({
      id: "p" + i,
      name: repoName,
      agents: [{
        id: "a" + i, provider: "codex", sourceSessionId: "s" + i,
        displayName: repoName, programId: "p" + i, status: "running",
        statusReason: "", updatedAt: "2026-08-13T03:00:00.000Z",
        lifecycle: "working", scope: "observed",
        tokens: { provenance: "observed", total: 1 },
        artifacts: [], gates: [], controls: [],
        repo: { repoKey: "k" + i, repoName, worktreePath: "/x/" + repoName, ephemeral: false },
      }],
    })),
  };
}

test("liveRepoSig is the sorted unique origin names", () => {
  expect(M.liveRepoSig(snapWithRepos(["the-ant-hill", "BurnBar", "the-ant-hill"])))
    .toBe("burnbar,the-ant-hill");
});

test("opening Settings GETs /api/repo-colors; closing does not", async () => {
  const urls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url: string) => {
    urls.push(String(url));
    return new Response(JSON.stringify(envelope), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    M.state.settingsPanelOpen = false;
    await M.openSettingsPanel();
    const afterOpen = urls.filter((u) => u.includes("/api/repo-colors")).length;
    expect(afterOpen).toBeGreaterThan(0);
    urls.length = 0;
    M.closeSettingsPanel();
    expect(urls.filter((u) => u.includes("/api/repo-colors"))).toEqual([]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a new origin on a later snapshot GETs colours; a repeat roster does not", async () => {
  const urls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url: string) => {
    urls.push(String(url));
    return new Response(JSON.stringify(envelope), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    M.maybeRefreshRepoColors(snapWithRepos(["the-ant-hill"])); // first = boot-equivalent, no GET
    M.maybeRefreshRepoColors(snapWithRepos(["the-ant-hill"])); // unchanged
    expect(urls.filter((u) => u.includes("/api/repo-colors"))).toEqual([]);
    M.maybeRefreshRepoColors(snapWithRepos(["the-ant-hill", "job-bored"]));
    expect(urls.filter((u) => u.includes("/api/repo-colors"))).toEqual(["/api/repo-colors"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
```

Rules to pin:

1. Settings toggle from closed → open calls `fetchRepoColors`. Close does not.
2. `applySnapshot` calls `maybeRefreshRepoColors`. First snapshot does **not** GET (boot already did). Later snapshots GET only when `liveRepoSig` changes.
3. `liveRepoSig` is the sorted unique lowercase `agent.repo.repoName` set. Agents without `repo` do not count.

```js
function liveRepoSig(snap) {
  const keys = new Set();
  for (const program of (snap && snap.programs) || []) {
    for (const agent of program.agents || []) {
      const name = agent.repo && agent.repo.repoName;
      if (name && String(name).trim()) keys.add(String(name).trim().toLowerCase());
    }
  }
  return [...keys].sort().join(",");
}

let lastLiveRepoSig = null;
function maybeRefreshRepoColors(snap) {
  const sig = liveRepoSig(snap);
  if (lastLiveRepoSig === sig) return;
  const first = lastLiveRepoSig === null;
  lastLiveRepoSig = sig;
  if (!first) void fetchRepoColors();
}
```

Call `maybeRefreshRepoColors(snap)` at the end of `applySnapshot`, before or after `render()` — after is fine; `fetchRepoColors` will `render()` again when it lands.

Settings toggle (~line 14088):

```js
$("settings-toggle").addEventListener("click", () => {
  const opening = !state.settingsPanelOpen;
  state.settingsPanelOpen = opening;
  renderSettingsPanel();
  if (opening) void fetchRepoColors();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/repo-tint-render.test.ts`
Expected: FAIL — still boot-only fetch.

- [ ] **Step 3: Implement** the functions already sketched above. Also:

```js
function openSettingsPanel() {
  state.settingsPanelOpen = true;
  renderSettingsPanel();
  void fetchRepoColors();
}
```

Settings toggle: opening calls `openSettingsPanel()`; closing calls `closeSettingsPanel()`.

`applySnapshot`: call `maybeRefreshRepoColors(snap)` after `state.snap = snap`.

`stopBoot` (search `bootGeneration`): also set `lastLiveRepoSig = null`. Tests reuse the module; a leaked sig would swallow the first “new origin” GET.

Export `liveRepoSig`, `maybeRefreshRepoColors`, `openSettingsPanel` on `TheAntHill` next to `fetchRepoColors`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/repo-tint-render.test.ts tests/repo-color.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/web/app.js tests/repo-tint-render.test.ts
git commit -m "$(cat <<'EOF'
feat(web): refresh repo colours when Settings opens or an origin appears

Boot still loads the catalog. A new GitHub repo on the snapshot no longer
waits for a full reload, and opening Settings re-runs ensure.
EOF
)"
```

---

### Task 6: Cache-bust, contract comment, floor

**Files:**
- Modify: `src/web/index.html` (`ah-t32` → `ah-t33` on icon, tokens, styles, app.js)
- Modify: `src/shared/repo-color.ts` header comment (canonical key sentence)
- Modify: `docs/superpowers/plans/2026-08-13-tint/00-MASTER-PLAN.md` only the **one sentence** under `RepoColorAssignment.repoKey` that says “basename of the git common dir’s toplevel”. Replace with origin basename, folder fallback. Do not restage the TINT program.

- [ ] **Step 1: Write a failing assertion if one exists for cache-bust**

If tests do not pin `ah-t32`, skip a red test. Bump the four query strings together.

- [ ] **Step 2: Bump and comment**

- [ ] **Step 3: Floor**

Run: `bunx tsc --noEmit && bun test`
Expected: tsc 0; bun test at `main` parity (geometry gate may be red without a live board).

- [ ] **Step 4: Live check (operator, not CI)**

On a **preview port** (`bash scripts/anthill-preview.sh`, 4710–4719 — do not fight 4701):

1. Settings → Repository colours shows **the-ant-hill**, not `the-mountain` / `anthill-pulse`.
2. The unscoped board band **the-ant-hill** wears that row’s colour.
3. A repo with no current sessions (if any extra assignment remains) sits below, labelled **Not on the board**, still has a working swatch.
4. Open Settings, change a Working-minutes field, wait for a snapshot: the field must not reset.
5. `data/repo-colors.json` in the **preview’s** data dir (not production’s) contains `the-ant-hill` and not the two donor folder keys.

- [ ] **Step 5: Commit**

```bash
git add src/web/index.html src/shared/repo-color.ts docs/superpowers/plans/2026-08-13-tint/00-MASTER-PLAN.md
git commit -m "$(cat <<'EOF'
chore(tint): bust colour-identity cache and record the key change

Origin basename is now the TINT repoKey. Folder names were a laptop
accident that split one GitHub repo into two colours.
EOF
)"
```

---

## Out of scope

- Place-color pips (`docs/superpowers/specs/2026-08-12-place-color-design.md`). Different palette, different grain, not on 4701.
- Per-clone colours (option 2).
- Deleting idle rows.
- A poll interval.
- Changing `RepoIdentity.repoKey` (FNV). Board grouping stays hashed; colour **display** matches `repoName`.
- Rewriting TINT-G group membership. Groups will start being named `the-ant-hill` because they already take the colour key as the sidebar name — that is desired. First reconcile after deploy may recreate the old `the-mountain` group; that is one-time churn, not a bug to paper over.

## Self-review

- Spec coverage: #1 origin identity (Tasks 1–3), #3 refresh (Task 5), idle mark (Task 4), form safety (Task 4 independent paint).
- No TBD / “handle edge cases” steps.
- `ensure` key comparison, `cachedRepoKey` → `folderKeyForCwd`, and `liveKeys` on PUT/DELETE are named because missing any one of them re-introduces the RCA.
- TINT-S production path follows `repoKeyForCwd`; unit fakes stay folder-shaped and do not need a mass rewrite.
