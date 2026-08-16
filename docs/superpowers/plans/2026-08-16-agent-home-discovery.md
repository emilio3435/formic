# Agent-home discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Formic scans this Mac for any agent-shaped filesystem, lists what it found in Settings, and collects extra Cursor GUI roots only after the operator confirms Import.

**Architecture:** A pure scan/classify module (injected FS + process list) returns candidates. A JSON store at `data/collector-instances.json` persists import/ignore, copied from `JsonSettingsStore` (temp-file + rename, serial write queue). `GET/POST /api/collector-instances` mirrors settings loopback rules. `collectCursorSessions` takes onboarded extra GUI roots; every other kind is inventory-only. Settings panel adds a Collectors block that does not rebuild on every snapshot.

**Tech Stack:** TypeScript, Bun, existing `el()` DOM helpers, no new dependencies. Validate POST bodies by hand the way `handleSettingsRequest` does — this repo has no Zod.

**Spec:** `docs/superpowers/specs/2026-08-16-instance-discovery.md` (GitHub #67)

## Global Constraints

- Work in a fresh worktree from `main`. Never edit `~/Developer/the-mountain-production`.
- `PROVIDERS` stays the eight names already on `main`. Extra copies are instances, not new providers.
- Do not hardcode `~/Applications/Grok Bot 2.app` or any other wrapper path.
- Scan is read-only, bounded (the four roots in the spec), time-boxed ≤2s.
- Scan never auto-imports extras. Defaults keep collecting with an empty store.
- This PR collects only imported `cursor-gui` roots. Grok CLI extras, Grok Bot blobs, and unknown shapes persist but do not parse.
- Do not deploy.
- HTTP mutating verbs: loopback + exact same-origin Origin + `application/json`, same as `src/server/settings.ts:302-328`.
- Error bodies stay `{ ok: false, error: { code, message } }` like settings, not the Express `{ error, code }` shape.

---

## What already exists

| Need | Reuse |
|---|---|
| Atomic JSON persist | `JsonSettingsStore.update` (`settings.ts:249-284`) — mkdir, `${path}.${pid}.${now}.tmp`, rename, write queue |
| Loopback HTTP gate | Copy `isLoopback` / `requestError` / Origin check from `handleSettingsRequest` |
| Cursor GUI read | `cursorStateEvidence` (`cursor.ts:680`) already keys its cache by path; generalize the hardcoded `…/Cursor/…` string |
| Settings panel paint guard | `renderSettingsPanel` signature at `app.js:3838-3845` — add instance inventory to it |
| Default Cursor home | `collectCursorSessions(home)` today. Extra roots are additive |

```
scan (pure, injected FS)
        │
        ▼
GET /api/collector-instances ── merge ──► store (data/collector-instances.json)
        ▲                                      │
        │                                      ▼
POST Import selected / Ignore          onboarded cursor-gui roots
                                               │
                                               ▼
                                    collectCursorSessions(+roots)
                                               │
                                               ▼
                                    Board rows, instanceLabel
```

---

## File map

| File | Responsibility |
|---|---|
| `src/server/collector-instances.ts` | Kinds, classify, scan, slug ids, store, HTTP handler |
| `src/server/index.ts` | Open the store next to `settingsStore` |
| `src/server/app.ts` | Route `/api/collector-instances`; pass store into `collectSessions` |
| `src/server/collectors.ts` | `collectCursorSessions` gets extra GUI roots from the store |
| `src/server/cursor.ts` | Iterate GUI roots instead of one hardcoded path |
| `src/server/types.ts` | Optional `instanceId` / `instanceLabel` on `CollectedAgent` |
| `src/shared/types.ts` | Same two fields on `AgentSnapshot` |
| `src/server/snapshot.ts` | Copy those fields through |
| `src/web/app.js` | Collectors block in Settings |
| `src/web/styles.css` | `.settings-collectors*` matching existing settings rows |
| `src/web/index.html` | Cache-bust `ah-t34` → `ah-t35` |
| `ANT-GUIDE.md`, `QUICKSTART.md` | Extra homes are Settings, not new providers |
| `tests/collector-instances.test.ts` | Scan, classify, persist, HTTP |
| `tests/cursor-extra-root.test.ts` | Second `state.vscdb` becomes rows |
| `tests/settings.test.ts` | `/api/settings` still rejects instance keys |

---

### Task 1: Classify + scan (pure)

**Files:**
- Create: `src/server/collector-instances.ts` (classify + scan only; store/HTTP come later)
- Test: `tests/collector-instances.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:

```ts
export type CollectorKind =
  | "cursor-gui" | "cursor-cli" | "codex" | "claude" | "factory"
  | "prime" | "omp" | "grok-cli" | "hermes" | "grok-bot"
  | "burnbar" | "cmux-hooks" | "unknown";

export type CollectorReason = "needs-parser" | "needs-home-list";

export interface CollectorCandidate {
  kind: CollectorKind;
  provider: Provider | null;
  dataDir: string;
  label: string;
  default: boolean;
  reason?: CollectorReason;
}

export interface ScanFs {
  home(): string;
  readdir(path: string): string[];          // names only; [] if missing
  isDirectory(path: string): boolean;
  exists(path: string): boolean;
  readTextCapped(path: string, maxBytes: number): string | undefined;
  readAppIdentity(appPath: string): { name?: string; identifier?: string } | undefined;
  processArgv(): string[];                  // one argv string per process
}

export function classifyDataDir(dataDir: string, fs: ScanFs): CollectorCandidate | undefined;
export function scanAgentHomes(fs: ScanFs): CollectorCandidate[];
export function instanceIdFor(kind: CollectorKind, dataDir: string): string;
export function defaultHomes(home: string): ReadonlyArray<{ kind: CollectorKind; dataDir: string }>;
```

- [ ] **Step 1: Write the failing classify tests**

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { classifyDataDir, instanceIdFor, scanAgentHomes, type ScanFs } from "../src/server/collector-instances";

function memFs(root: string, extra?: Partial<ScanFs>): ScanFs {
  const { readdirSync, statSync, existsSync, readFileSync } = require("node:fs");
  return {
    home: () => root,
    readdir: (p) => { try { return readdirSync(p); } catch { return []; } },
    isDirectory: (p) => { try { return statSync(p).isDirectory(); } catch { return false; } },
    exists: (p) => existsSync(p),
    readTextCapped: (p, max) => {
      try { return readFileSync(p, "utf8").slice(0, max); } catch { return undefined; }
    },
    readAppIdentity: () => undefined,
    processArgv: () => [],
    ...extra,
  };
}

describe("classifyDataDir", () => {
  test("Cursor-2 GUI is cursor-gui, not a new provider", () => {
    const root = mkdtempSync(join(tmpdir(), "ah-scan-"));
    const dataDir = join(root, "Library/Application Support/Cursor-2");
    mkdirSync(join(dataDir, "User/globalStorage"), { recursive: true });
    writeFileSync(join(dataDir, "User/globalStorage/state.vscdb"), "");
    const hit = classifyDataDir(dataDir, memFs(root));
    expect(hit?.kind).toBe("cursor-gui");
    expect(hit?.provider).toBe("cursor");
    expect(hit?.default).toBe(false);
  });

  test("Grok Bot persistence is grok-bot / needs-parser", () => {
    const root = mkdtempSync(join(tmpdir(), "ah-scan-"));
    const dataDir = join(root, "Library/Application Support/Grok Bot 2");
    mkdirSync(join(dataDir, "sand-client-persistence"), { recursive: true });
    writeFileSync(join(dataDir, "sand-client-persistence/x.blob"), "");
    const hit = classifyDataDir(dataDir, memFs(root));
    expect(hit?.kind).toBe("grok-bot");
    expect(hit?.provider).toBeNull();
    expect(hit?.reason).toBe("needs-parser");
  });

  test("extra grok home is grok-cli / needs-home-list", () => {
    const root = mkdtempSync(join(tmpdir(), "ah-scan-"));
    const dataDir = join(root, ".grok-2");
    mkdirSync(join(dataDir, "sessions", "cwd", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"), { recursive: true });
    writeFileSync(join(dataDir, "sessions/cwd/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/summary.json"), "{}");
    const hit = classifyDataDir(dataDir, memFs(root));
    expect(hit?.kind).toBe("grok-cli");
    expect(hit?.provider).toBe("grok");
    expect(hit?.reason).toBe("needs-home-list");
  });

  test("codex-2 sessions classify as codex and are not default", () => {
    const root = mkdtempSync(join(tmpdir(), "ah-scan-"));
    const dataDir = join(root, ".codex-2");
    mkdirSync(join(dataDir, "sessions"), { recursive: true });
    writeFileSync(join(dataDir, "sessions/rollout-1.jsonl"), "{}\n");
    const hit = classifyDataDir(dataDir, memFs(root));
    expect(hit?.kind).toBe("codex");
    expect(hit?.provider).toBe("codex");
    expect(hit?.default).toBe(false);
  });

  test("~/.crush/sessions jsonl is unknown / needs-parser", () => {
    const root = mkdtempSync(join(tmpdir(), "ah-scan-"));
    const dataDir = join(root, ".crush");
    mkdirSync(join(dataDir, "sessions"), { recursive: true });
    writeFileSync(join(dataDir, "sessions/a.jsonl"), "{}\n");
    const hit = classifyDataDir(dataDir, memFs(root));
    expect(hit?.kind).toBe("unknown");
    expect(hit?.provider).toBeNull();
    expect(hit?.reason).toBe("needs-parser");
  });

  test("~/.cursor-2 with only extensions is not cursor-cli", () => {
    const root = mkdtempSync(join(tmpdir(), "ah-scan-"));
    const dataDir = join(root, ".cursor-2");
    mkdirSync(join(dataDir, "extensions"), { recursive: true });
    expect(classifyDataDir(dataDir, memFs(root))).toBeUndefined();
  });

  test("default ~/.grok is default: true", () => {
    const root = mkdtempSync(join(tmpdir(), "ah-scan-"));
    const dataDir = join(root, ".grok");
    mkdirSync(join(dataDir, "sessions"), { recursive: true });
    const hit = classifyDataDir(dataDir, memFs(root));
    expect(hit?.kind).toBe("grok-cli");
    expect(hit?.default).toBe(true);
    expect(hit?.reason).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests — they fail because the module does not exist**

Run: `bun test tests/collector-instances.test.ts`
Expected: FAIL, cannot find module

- [ ] **Step 3: Implement classify**

First-match order from the spec table. `default` is true only when `dataDir` equals one of `defaultHomes(fs.home())`.

```ts
export function defaultHomes(home: string): ReadonlyArray<{ kind: CollectorKind; dataDir: string }> {
  return [
    { kind: "cursor-gui", dataDir: join(home, "Library/Application Support/Cursor") },
    { kind: "cursor-cli", dataDir: join(home, ".cursor") },
    { kind: "codex", dataDir: join(home, ".codex") },
    { kind: "claude", dataDir: join(home, ".claude") },
    { kind: "factory", dataDir: join(home, ".factory") },
    { kind: "prime", dataDir: join(home, ".prime") },
    { kind: "omp", dataDir: join(home, ".omp") },
    { kind: "grok-cli", dataDir: join(home, ".grok") },
    { kind: "hermes", dataDir: join(home, ".hermes") },
    { kind: "cmux-hooks", dataDir: join(home, ".cmuxterm") },
    { kind: "burnbar", dataDir: join(home, "Library/Application Support/OpenBurnBar") },
  ];
}

export function instanceIdFor(kind: CollectorKind, dataDir: string): string {
  const base = basename(dataDir).replace(/^\./, "dot-").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${kind}:${base || "home"}`;
}
```

Known checks (existence only, never open sqlite/blobs):

- `cursor-gui`: `basename` starts with `Cursor` AND `User/globalStorage/state.vscdb` exists
- `grok-bot`: `basename` starts with `Grok Bot` AND `sand-client-persistence/` exists
- `grok-cli`: `sessions/` exists under a dir named `.grok` or `.grok-*`
- `codex`: `sessions/` contains a name starting `rollout-`
- `claude`: `projects/` exists under `.claude` / `.claude-*`
- `factory`: `sessions/` has both `*.jsonl` and `*.settings.json`
- `prime`: `agent/sessions/` under `.prime*`
- `omp`: `agent/sessions/` under `.omp*`
- `hermes`: `sessions/` or `cron/` under `.hermes*`
- `cursor-cli`: `.cursor*` AND (`chats/` or `projects/`) AND not extensions-only
- `burnbar`: basename `OpenBurnBar`
- `cmux-hooks`: basename `.cmuxterm` or path ends with `/.cmuxterm`

Unknown: if no known row matched, count how many of the four spec signals fire (name token, session-shaped children at depth ≤3, process argv, app identity). Emit `unknown` when count ≥ 2.

Name token: `/^(claude|codex|cursor|grok|hermes|factory|prime|omp|droid|aider|continue|opencode|gemini|windsurf|copilot|crush|amp)/i` against the basename with leading `.` stripped.

- [ ] **Step 4: Write the failing scan + wrapper tests**

```ts
describe("scanAgentHomes", () => {
  test("finds a Cursor wrapper via --user-data-dir without a hardcoded path", () => {
    const root = mkdtempSync(join(tmpdir(), "ah-scan-"));
    const app = join(root, "Applications/Cursor Extra.app");
    mkdirSync(join(app, "Contents/MacOS"), { recursive: true });
    const dataDir = join(root, "Library/Application Support/Cursor-2");
    mkdirSync(join(dataDir, "User/globalStorage"), { recursive: true });
    writeFileSync(join(dataDir, "User/globalStorage/state.vscdb"), "");
    writeFileSync(join(app, "Contents/MacOS/launch"),
      `#!/bin/bash\nexec /Applications/Cursor.app/Contents/MacOS/Cursor --user-data-dir="${dataDir}"\n`);
    const hits = scanAgentHomes(memFs(root, {
      readAppIdentity: (p) => p.endsWith(".app") ? { name: "Cursor Extra", identifier: "com.todesktop.230313mzl4w4u92" } : undefined,
    }));
    expect(hits.some((h) => h.dataDir === dataDir && h.kind === "cursor-gui")).toBe(true);
    expect(hits.some((h) => h.dataDir.includes("Grok Bot 2.app"))).toBe(false);
  });

  test("dedups the same dataDir from app + Application Support + ps", () => {
    const root = mkdtempSync(join(tmpdir(), "ah-scan-"));
    const dataDir = join(root, "Library/Application Support/Cursor-2");
    mkdirSync(join(dataDir, "User/globalStorage"), { recursive: true });
    writeFileSync(join(dataDir, "User/globalStorage/state.vscdb"), "");
    const hits = scanAgentHomes(memFs(root, {
      processArgv: () => [`Cursor --user-data-dir=${dataDir}`],
    }));
    expect(hits.filter((h) => h.dataDir === dataDir)).toHaveLength(1);
  });

  test("does not walk Downloads or /etc", () => {
    const root = mkdtempSync(join(tmpdir(), "ah-scan-"));
    mkdirSync(join(root, "Downloads/secret"), { recursive: true });
    writeFileSync(join(root, "Downloads/secret/sessions.jsonl"), "");
    const hits = scanAgentHomes(memFs(root));
    expect(hits.some((h) => h.dataDir.includes("Downloads"))).toBe(false);
  });
});
```

- [ ] **Step 5: Implement scan**

Roots only:

1. `join(home, "Applications")` and `"/Applications"` — depth 1 `*.app`
2. `join(home, "Library/Application Support")` — depth 1 dirs
3. `home` — depth 1 names matching `/^\.[A-Za-z0-9._-]+$/`
4. `processArgv()` — extract `--user-data-dir=` values under `home` or `/Applications`

Skip names `node_modules`, `Caches`, `Logs`. Do not follow aliases outside `home`, `/Applications`, `/tmp`.

For each `*.app`: `readAppIdentity`; if `Contents/MacOS/*` is a file, `readTextCapped(path, 8192)` and regex `--user-data-dir=(?:"([^"]+)"|(\S+))`. Classify the extracted dir.

Dedup by `realpath`-equivalent resolved `dataDir`. `scanAgentHomes` must finish without throwing if a root is missing.

- [ ] **Step 6: Run tests — all classify + scan pass**

Run: `bun test tests/collector-instances.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/server/collector-instances.ts tests/collector-instances.test.ts
git commit -m "feat: classify and scan agent homes without hardcoded wrappers"
```

---

### Task 2: Persist store

**Files:**
- Modify: `src/server/collector-instances.ts`
- Test: `tests/collector-instances.test.ts`

**Interfaces:**
- Consumes: `CollectorCandidate`, `instanceIdFor`
- Produces:

```ts
export interface CollectorInstance {
  id: string;
  kind: CollectorKind;
  provider: Provider | null;
  label: string;
  dataDir: string;
  onboarded: boolean;
  ignored: boolean;
  default: boolean;
  discoveredAt: string;
  lastSeenAt: string;
  reason?: CollectorReason;
}

export class JsonCollectorInstanceStore {
  static open(path: string, files?: SettingsFileOperations): Promise<JsonCollectorInstanceStore>;
  get(): CollectorInstance[];
  mergeScan(found: CollectorCandidate[], nowIso: string): CollectorInstance[];
  update(patch: { ids: string[]; onboarded?: boolean; ignored?: boolean; label?: string }): Promise<CollectorInstance[]>;
  onboardedGuiRoots(): string[];   // dataDir of onboarded cursor-gui extras, not defaults
}
```

- [ ] **Step 1: Write failing persist tests**

```ts
describe("JsonCollectorInstanceStore", () => {
  test("empty store + scan leaves extras not onboarded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ah-store-"));
    const store = await JsonCollectorInstanceStore.open(join(dir, "collector-instances.json"));
    const merged = store.mergeScan([{
      kind: "cursor-gui", provider: "cursor", dataDir: "/tmp/Cursor-2",
      label: "Cursor-2", default: false,
    }], "2026-08-16T00:00:00.000Z");
    expect(merged[0].onboarded).toBe(false);
    expect(store.onboardedGuiRoots()).toEqual([]);
  });

  test("update onboarded persists across reopen", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ah-store-"));
    const path = join(dir, "collector-instances.json");
    const store = await JsonCollectorInstanceStore.open(path);
    store.mergeScan([{
      kind: "cursor-gui", provider: "cursor", dataDir: "/Users/me/Library/Application Support/Cursor-2",
      label: "Cursor-2", default: false,
    }], "2026-08-16T00:00:00.000Z");
    await store.update({ ids: ["cursor-gui:cursor-2"], onboarded: true });
    const again = await JsonCollectorInstanceStore.open(path);
    expect(again.get().find((i) => i.id === "cursor-gui:cursor-2")?.onboarded).toBe(true);
    expect(again.onboardedGuiRoots()).toEqual(["/Users/me/Library/Application Support/Cursor-2"]);
  });

  test("defaults cannot be turned off", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ah-store-"));
    const store = await JsonCollectorInstanceStore.open(join(dir, "collector-instances.json"));
    store.mergeScan([{
      kind: "cursor-gui", provider: "cursor",
      dataDir: "/Users/me/Library/Application Support/Cursor",
      label: "Cursor", default: true,
    }], "2026-08-16T00:00:00.000Z");
    await expect(store.update({ ids: ["cursor-gui:cursor"], onboarded: false }))
      .rejects.toThrow(/default/i);
  });

  test("corrupt file boots empty and reports loadError", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ah-store-"));
    const path = join(dir, "collector-instances.json");
    writeFileSync(path, "{nope");
    const store = await JsonCollectorInstanceStore.open(path);
    expect(store.get()).toEqual([]);
    expect(store.loadError).toContain("collector-instances.json");
  });
});
```

- [ ] **Step 2: Run — FAIL (store missing)**

Run: `bun test tests/collector-instances.test.ts`
Expected: FAIL on `JsonCollectorInstanceStore`

- [ ] **Step 3: Implement the store**

Copy the write pattern from `JsonSettingsStore.update`: serialize on `#writeQueue`, write `${path}.${pid}.${now}.tmp`, rename over the target, `JSON.stringify(record, null, 2) + "\n"`.

File shape: `{ version: 1, instances: CollectorInstance[] }`. Unknown version or missing array → empty + `loadError`. `ENOENT` is silent empty.

`mergeScan`: for each candidate, upsert by `instanceIdFor(kind, dataDir)`. New extras: `onboarded: false`. Existing keep `onboarded` / `ignored` / `label`. Always refresh `lastSeenAt`. Drop nothing (a vanished extra stays, so Ignore still has somewhere to live).

`onboardedGuiRoots`: `kind === "cursor-gui" && onboarded && !default` → `dataDir`.

- [ ] **Step 4: Run — PASS**

Run: `bun test tests/collector-instances.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/collector-instances.ts tests/collector-instances.test.ts
git commit -m "feat: persist collector-instance import choices"
```

---

### Task 3: HTTP GET / POST

**Files:**
- Modify: `src/server/collector-instances.ts`
- Test: `tests/collector-instances.test.ts`

**Interfaces:**
- Consumes: `JsonCollectorInstanceStore`, `scanAgentHomes`
- Produces:

```ts
export function handleCollectorInstancesRequest(
  request: Request,
  store: JsonCollectorInstanceStore,
  options: { scan?: () => CollectorCandidate[]; afterUpdate?: () => void | Promise<void> },
): Promise<Response>;
```

GET never writes. It scans (`options.scan ?? () => scanAgentHomes(nodeScanFs())`), `mergeScan` in memory, returns `{ ok: true, instances }` without persisting the merge. Persist happens on POST.

POST body: `{ ids?: string[], id?: string, onboarded?: boolean, ignored?: boolean, label?: string }`. `ids` or `id` required. Same-origin loopback + JSON.

Reject:

- non-loopback → 403 `ORIGIN_REJECTED`
- POST missing/mismatched Origin → 403
- POST not JSON → 415
- unknown id → 400 `UNKNOWN_INSTANCE`
- `dataDir` escape if a later write ever accepts a path (this POST only patches ids already in the store)
- turning off a default → 400 `DEFAULT_LOCKED`

- [ ] **Step 1: Write failing HTTP tests** (construct `Request` objects the way `tests/settings.test.ts` does)

```ts
test("GET is loopback-only", async () => {
  const store = await JsonCollectorInstanceStore.open(join(mkdtempSync(join(tmpdir(), "ah-http-")), "c.json"));
  const res = await handleCollectorInstancesRequest(
    new Request("http://example.com/api/collector-instances"),
    store,
    { scan: () => [] },
  );
  expect(res.status).toBe(403);
});

test("POST import selected marks extras onboarded", async () => {
  const store = await JsonCollectorInstanceStore.open(join(mkdtempSync(join(tmpdir(), "ah-http-")), "c.json"));
  store.mergeScan([{
    kind: "cursor-gui", provider: "cursor",
    dataDir: "/Users/me/Library/Application Support/Cursor-2",
    label: "Cursor-2", default: false,
  }], new Date().toISOString());
  const res = await handleCollectorInstancesRequest(
    new Request("http://127.0.0.1/api/collector-instances", {
      method: "POST",
      headers: { origin: "http://127.0.0.1", "content-type": "application/json" },
      body: JSON.stringify({ ids: ["cursor-gui:cursor-2"], onboarded: true }),
    }),
    store,
    { scan: () => [] },
  );
  expect(res.status).toBe(200);
  expect(store.onboardedGuiRoots()[0]).toContain("Cursor-2");
});

test("POST /etc/passwd as a new dataDir is 400", async () => {
  const store = await JsonCollectorInstanceStore.open(join(mkdtempSync(join(tmpdir(), "ah-http-")), "c.json"));
  const res = await handleCollectorInstancesRequest(
    new Request("http://127.0.0.1/api/collector-instances", {
      method: "POST",
      headers: { origin: "http://127.0.0.1", "content-type": "application/json" },
      body: JSON.stringify({ id: "unknown:passwd", dataDir: "/etc/passwd", onboarded: true }),
    }),
    store,
    { scan: () => [] },
  );
  expect(res.status).toBe(400);
});
```

If the handler never accepts raw `dataDir` on POST, the last test still holds: unknown id → 400. That is the spec's escape hatch.

- [ ] **Step 2: Run — FAIL (handler missing)**

- [ ] **Step 3: Implement handler**

Copy `isLoopback`, `requestError`, Origin, and content-type checks verbatim from `handleSettingsRequest`. Do not add Zod.

GET: `{ ok: true, instances: store.mergeScan(scan(), now) }` — merge in memory only. Call `store.rememberScan(merged)` as an in-memory upsert so POST can see ids from this GET without writing disk yet; OR persist last-seen on GET. Spec says "Scan on GET. Do not scan on every snapshot." It does not forbid persisting last-seen. Persist last-seen on GET so POST ids exist after a refresh. Import/ignore flags are unchanged by GET.

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add src/server/collector-instances.ts tests/collector-instances.test.ts
git commit -m "feat: loopback GET/POST for collector-instance import"
```

---

### Task 4: Wire the route and the store

**Files:**
- Modify: `src/server/index.ts` (open store beside settings)
- Modify: `src/server/app.ts` (route + dependency)
- Modify: `tests/settings.test.ts` (one extra assertion)

**Interfaces:**
- Consumes: `JsonCollectorInstanceStore.open`, `handleCollectorInstancesRequest`
- Produces: `MountainAppDependencies.collectorInstances?: JsonCollectorInstanceStore`

- [ ] **Step 1: Write the settings-rejection test if it is not already there**

```ts
test("settings POST still rejects collector instance keys", async () => {
  // same harness as existing settings tests
  const res = await handleSettingsRequest(
    new Request("http://127.0.0.1/api/settings", {
      method: "POST",
      headers: { origin: "http://127.0.0.1", "content-type": "application/json" },
      body: JSON.stringify({ instances: [] }),
    }),
    store,
  );
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run — PASS already (unknown key). Keep it as a lock.**

- [ ] **Step 3: Wire**

`index.ts` after the settings store:

```ts
const collectorInstanceStore = await JsonCollectorInstanceStore.open(
  join(PROJECT_ROOT, "data/collector-instances.json"),
);
```

Pass it into `createMountainFetch` / `MountainAppDependencies`.

`app.ts` next to the settings route:

```ts
if (url.pathname === "/api/collector-instances") {
  if (!dependencies.collectorInstances) {
    return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
  }
  return handleCollectorInstancesRequest(request, dependencies.collectorInstances, {
    afterUpdate: async () => { await dependencies.state.refresh({ cmux: true }); },
  });
}
```

- [ ] **Step 4: `bunx tsc --noEmit` clean**

- [ ] **Step 5: Commit**

```bash
git add src/server/index.ts src/server/app.ts tests/settings.test.ts
git commit -m "feat: serve /api/collector-instances from the hub"
```

---

### Task 5: Extra Cursor GUI roots collect

**Files:**
- Modify: `src/server/cursor.ts` (`cursorStateEvidence` ~684, the other two `Application Support/Cursor` joins at 1088 and 1331)
- Modify: `src/server/collectors.ts` (`collectSessionProvider` cursor case)
- Modify: `src/server/types.ts` (`CollectedAgent`)
- Modify: `src/shared/types.ts` (`AgentSnapshot`)
- Modify: `src/server/snapshot.ts` (copy the two fields)
- Test: `tests/cursor-extra-root.test.ts`

**Interfaces:**
- Consumes: `store.onboardedGuiRoots(): string[]`
- Produces: extra GUI sessions as `provider: "cursor"` with `instanceId` / `instanceLabel`

`collectCursorSessions` signature becomes:

```ts
export async function collectCursorSessions(
  home = homedir(),
  nowMs = Date.now(),
  windowMs = DEFAULT_CURSOR_SESSION_WINDOW_MS,
  thresholds?: LifecycleThresholds,
  extraGuiRoots: readonly string[] = [],
): Promise<CollectionResult<CollectedAgent[]>>;
```

`collectors.ts` cursor case:

```ts
case "cursor":
  return collectCursorSessions(
    home, Date.now(), windowMs, thresholds,
    options.extraCursorGuiRoots ?? [],
  );
```

Thread `extraCursorGuiRoots` through `collectSessions` / `CollectSessionsOptions` from `HubState` reading the store. Do not read the store inside `cursor.ts`.

- [ ] **Step 1: Write the failing extra-root test**

Build a tiny valid `state.vscdb` the way existing cursor tests do (copy their fixture helper). If they use a checked-in fixture, reuse it in a second directory named `Cursor-2`.

```ts
test("an onboarded Cursor-2 vscdb becomes cursor rows with an instance label", async () => {
  const home = /* fixture home with default Cursor empty and Cursor-2 populated */;
  const result = await collectCursorSessions(home, Date.now(), 36 * 3600_000, undefined, [
    join(home, "Library/Application Support/Cursor-2"),
  ]);
  expect(result.errors).toEqual([]);
  expect(result.value.some((a) => a.provider === "cursor" && a.instanceLabel === "Cursor-2")).toBe(true);
  expect(result.value.every((a) => a.provider === "cursor")).toBe(true);
});

test("the same composer id in two DBs is one row", async () => {
  // same fixture copied into Cursor and Cursor-2
  const result = await collectCursorSessions(home, Date.now(), 36 * 3600_000, undefined, [
    join(home, "Library/Application Support/Cursor-2"),
  ]);
  const ids = result.value.map((a) => a.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test("a missing extra root is a named error, default Cursor still collects", async () => {
  const result = await collectCursorSessions(home, Date.now(), 36 * 3600_000, undefined, [
    join(home, "Library/Application Support/Does-Not-Exist"),
  ]);
  expect(result.errors.some((e) => e.includes("Does-Not-Exist"))).toBe(true);
});
```

- [ ] **Step 2: Run — FAIL (no extraGuiRoots param)**

- [ ] **Step 3: Implement**

Replace the single hardcoded

`join(home, "Library", "Application Support", "Cursor", ...)`

with a loop over `[join(home, "Library/Application Support/Cursor"), ...extraGuiRoots]`. Keep `cursorStateCache` keyed by path (it already is). On extra-root open failure, push a named error and continue.

When building each GUI agent, if the root is not the default Cursor path:

```ts
instanceId: instanceIdFor("cursor-gui", root),
instanceLabel: basename(root),
```

Dedup by `id` (`cursor:<composer-or-session-id>`). First root wins; `console.info` the skip.

Add optional `instanceId?: string` and `instanceLabel?: string` to `CollectedAgent` and `AgentSnapshot`. In `snapshot.ts`, copy them onto the published row next to `provider`.

- [ ] **Step 4: Run cursor extra-root + existing cursor tests**

Run: `bun test tests/cursor-extra-root.test.ts tests/cursor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/cursor.ts src/server/collectors.ts src/server/types.ts src/shared/types.ts src/server/snapshot.ts tests/cursor-extra-root.test.ts
git commit -m "feat: collect onboarded extra Cursor GUI roots"
```

---

### Task 6: Settings Collectors block

**Files:**
- Modify: `src/web/app.js` (`renderSettingsPanel` ~3813, client state, paint signature)
- Modify: `src/web/styles.css`
- Modify: `src/web/index.html` (`ah-t34` → `ah-t35` on every `?v=`)
- Test: extend whatever settings-panel test already paints the dialog (search `settings-panel` under `tests/`). If none exists, add `tests/settings-collectors-dom.test.ts` using the same `TheAntHill` import as `tests/grok.test.ts`.

**Interfaces:**
- Consumes: `GET/POST /api/collector-instances`
- Produces: operator-visible inventory + Import selected

- [ ] **Step 1: Write a failing DOM test**

```ts
test("Collectors lists found extras and does not offer Off on a default", () => {
  // boot TheAntHill, open settings, inject instances fixture
  const instances = [
    { id: "cursor-gui:cursor", kind: "cursor-gui", label: "Cursor", dataDir: "/Users/me/Library/Application Support/Cursor", default: true, onboarded: true, ignored: false },
    { id: "cursor-gui:cursor-2", kind: "cursor-gui", label: "Cursor-2", dataDir: "/Users/me/Library/Application Support/Cursor-2", default: false, onboarded: false, ignored: false },
    { id: "grok-bot:grok-bot-2", kind: "grok-bot", label: "Grok Bot 2", dataDir: "/Users/me/Library/Application Support/Grok Bot 2", default: false, onboarded: false, ignored: false, reason: "needs-parser" },
  ];
  // after render:
  expect(document.getElementById("settings-collectors")).toBeTruthy();
  expect(document.querySelector("[data-instance='cursor-gui:cursor'] [data-fkey='instance-off']")).toBeNull();
  expect(document.querySelector("[data-instance='cursor-gui:cursor-2'] input[type='checkbox']")).toBeTruthy();
  expect(document.querySelector("[data-instance='grok-bot:grok-bot-2']")?.textContent).toMatch(/parser/i);
});
```

- [ ] **Step 2: Run — FAIL (no #settings-collectors)**

- [ ] **Step 3: Implement the panel**

Add `state.collectorInstances` (array) and `state.collectorInstancesPending`. Fetch on panel open only (`GET /api/collector-instances` via existing `apiFetch`). Include `JSON.stringify(state.collectorInstances)` and pending in the paint signature at `app.js:3838`.

Append, below the time fields and above Advanced:

```js
el("section", { id: "settings-collectors", class: "settings-collectors" },
  el("h3", { text: "Collectors" }),
  el("p", { class: "settings-help", text: preview }),  // "N homes on. M found, waiting on you."
  group("On now", onNow),
  group("Found, not imported", found),
  group("Needs a parser", needsParser),
  group("Ignored", ignored),
  found.length ? el("button", {
    type: "button", class: "btn",
    dataset: { fkey: "collectors-import" },
    onclick: importSelected,
  }, "Import selected") : null,
)
```

`importSelected` POSTs `{ ids, onboarded: true }`, then re-GETs. Per-row Ignore POSTs `{ id, ignored: true }`.

Defaults: no checkbox, no Off. Preview counts `default || onboarded` vs `!onboarded && !ignored && !default`.

CSS: reuse `.settings-field`, `.settings-help`, add a top rule like `.settings-local` so the block is ruled off from the time fields. Do not invent a new visual language.

- [ ] **Step 4: Run DOM test + `bunx tsc --noEmit`**

- [ ] **Step 5: Commit**

```bash
git add src/web/app.js src/web/styles.css src/web/index.html tests/settings-collectors-dom.test.ts
git commit -m "feat: Settings inventory for scanned agent homes"
```

---

### Task 7: Docs + acceptance lock

**Files:**
- Modify: `ANT-GUIDE.md`, `QUICKSTART.md` (one sentence each: extra homes are Settings → Collectors, not new providers)
- Modify: `tests/reference-docs.test.ts` only if a new claim needs a pin
- Modify: `docs/2026-08-15-FLEET-DEBT-LEDGER.md` — mark #1 as in progress / this PR

- [ ] **Step 1: Add the two sentences. Do not rewrite the guides.**

QUICKSTART collector table: add a line that extra copies are opted in under Settings → Collectors.

ANT-GUIDE: same, next to the existing collector-home list.

- [ ] **Step 2: Run `bun test tests/reference-docs.test.ts tests/collector-instances.test.ts tests/cursor-extra-root.test.ts`**

Expected: PASS. If reference-docs fails because a count drifted, fix the guide claim, not the test.

- [ ] **Step 3: Manual preview check (not deploy)**

`bash scripts/anthill-preview.sh` from the worktree. Open Settings. Confirm:

1. Default Cursor is On, no Off.
2. If this machine has Cursor-2 / Grok Bot 2, they appear under Found or Needs a parser.
3. Import Cursor-2 → after refresh, GUI chats from that DB show `instanceLabel` Cursor-2.
4. Import Grok Bot 2 → still no Board rows.

- [ ] **Step 4: Commit**

```bash
git add ANT-GUIDE.md QUICKSTART.md docs/2026-08-15-FLEET-DEBT-LEDGER.md
git commit -m "docs: extra agent homes are Settings, not new providers"
```

---

## Rollback

Revert the PR. Delete `data/collector-instances.json`. Default collectors keep working.

## Out of scope (do not do in this plan)

- #2 extra Grok CLI collection (`collectGrokSessions` multi-root)
- #3 Grok Bot `sand-client-persistence` blob parser
- Parsers for unknown kinds (Crush, Aider, Continue, Windsurf, …)
- New Provider keys
- Cloud Cursor (`bc-`)
- Walking the whole disk
- Auto-import
- Adding Zod
- Deploy

## Spec coverage

| Spec requirement | Task |
|---|---|
| Bounded scan of 4 roots | 1 |
| Known kinds table | 1 |
| Unknown ≥2 signals | 1 |
| No hardcoded wrapper path | 1 |
| Wrapper `--user-data-dir` | 1 |
| Persist separate store | 2 |
| Defaults implicit / locked | 2 |
| GET scan + POST import | 3 |
| Loopback + Origin | 3 |
| Route + boot | 4 |
| Settings still rejects instance keys | 4 |
| Extra Cursor GUI collects | 5 |
| Dedup same composer id | 5 |
| Extra-root error named | 5 |
| `instanceId` / `instanceLabel` | 5 |
| Settings inventory + Import selected | 6 |
| Paint guard includes instances | 6 |
| Docs | 7 |
| PROVIDERS unchanged | all (never edited) |
| #2 / #3 not implemented | out of scope |

## Parallelization

| Lane | Tasks | Depends on |
|---|---|---|
| A scan+store+HTTP | 1 → 2 → 3 → 4 | — |
| B Cursor extra roots | 5 | 2 (needs `onboardedGuiRoots`) |
| C Settings UI | 6 | 3 (needs the API) |
| D docs | 7 | 6 for the screenshot sentence |

Launch A. After Task 2, B can start. After Task 3, C can start. D last.
