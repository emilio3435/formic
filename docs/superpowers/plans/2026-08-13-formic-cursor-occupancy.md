# Cursor Context Occupancy (Spec A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Light the Formic context ring for Cursor CLI and GUI sessions from Cursor's own `contextUsagePercent` meter, while keeping Cursor token counts and cost honestly unknown.

**Architecture:** One new read in the existing `state.vscdb` pass (`cursorStateEvidence`) captures ItemTable key `composer.composerHeaders` into a `Map<sessionId, pct>` cached on `cursorStateCache`. One post-pass in `collectCursorSessions` (next to the existing `fillMissingCursorModels`) stamps `tokens.occupancyPct` onto any collected Cursor agent whose own `sourceSessionId` is in the map — which covers CLI, GUI, and children with one code path and makes parent-inheritance structurally impossible. `contextPctFor` (server) and `contextUsage` (web) each grow an occupancy branch that renders a percent without ever inventing a token count.

**Tech Stack:** Bun + TypeScript (strict), bun:test, bun:sqlite fixtures, plain-JS web client (`src/web/agent-model.js`).

**Spec:** `docs/superpowers/specs/2026-08-13-formic-cursor-context-pct-spec-a.md` — read it before starting; every non-goal there is binding.

**Branch:** `feat/cursor-context-occupancy` cut from `main` in a fresh worktree (the `docs/formic-evidence-ux-adversarial` worktree holds unrelated in-progress docs — do not build there). Local commits only; PR needs Emilio's explicit approval (CI-worthiness gate).

## Global Constraints

- Never set `tokens.total`, `sessionTotal`, `sessionCachedInput`, `sessionProcessed`, `input`, `output`, `cachedInput`, or `cost` from the occupancy meter.
- Never compute tokens as `percent × contextWindow`. The window table (`config/models.json`) is a constant; percent × constant is an invented measurement.
- `occupancyPct` is stored raw (e.g. `95.47466666666666`); accept only finite numbers in `[0, 100.5]` at ingest (drop, don't clamp, garbage); cap at 100 only at render/derive time.
- Missing/malformed header ⇒ session stays on today's unknown path. Absence of the key is silent; a JSON parse failure is one named error and an empty map, never a failed scan.
- Children join by their **own** uuid only. No fallback to the parent's percent.
- `src/server/pulse.ts` keeps `provider !== "cursor"` (line 189) untouched. `tests/usage-cost-honesty.test.ts` is not edited.
- Only these files change: `src/server/cursor.ts`, `src/shared/types.ts`, `src/server/snapshot-agent.ts`, `src/web/agent-model.js`, `tests/cursor.test.ts`, `tests/snapshot-context.test.ts`, `tests/web-client.test.ts`. No other collector is touched.
- macOS path only (`~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`). GUI state collection is already macOS-only in `collectCursorSessions` (it gates on that globalStorage path existing), so there is no Linux branch to add — do not add one.
- Verification floor per task: the named test file green. Before the branch is called done: `bunx tsc --noEmit` clean and `bun test` at parity with `main` (the only known local-only red is `docs/a11y-geometry-gate`, which needs a live board; leave it).
- TS strict, no `any`; kebab-case files; named exports; match surrounding comment style (this codebase writes "why" paragraphs — keep yours short and only where the code can't say it).

**One deliberate deviation from the spec's Design section, already reflected above:** the spec sketches setting tokens inside each collect call-site (CLI at `cursor.ts:1102`, GUI at `:951`). The CLI loop runs *before* `cursorStateEvidence` is awaited (`:1122`), so per-call-site threading would require reordering the collector. The post-pass (`fillCursorOccupancy`, Task 2) achieves the spec's exact observable behavior — same join key, same precedence, same outputs — without reordering, in one place. The spec's Tests and Done-when sections are unchanged by this and are what the tasks verify.

---

### Task 1: `occupancyPct` type + `parseComposerHeaders` parser

**Files:**
- Modify: `src/shared/types.ts:174-205` (interface `TokenUsage`)
- Modify: `src/server/cursor.ts` (new exported function, near `composerModelForSession` ~line 763)
- Test: `tests/cursor.test.ts`

**Interfaces:**
- Consumes: `asRecord` and `UUID_PATTERN` helpers already in `cursor.ts`.
- Produces: `TokenUsage.occupancyPct?: number`; `export function parseComposerHeaders(value: string | Uint8Array | undefined | null): Map<string, number>` — throws on invalid JSON, returns an empty Map for absent value or missing/foreign shape, and a `composerId → contextUsagePercent` Map for valid entries. Tasks 2–5 rely on both names exactly.

- [ ] **Step 1: Write the failing tests**

In `tests/cursor.test.ts`, add `parseComposerHeaders` to the existing import from `../src/server/cursor`, and add:

```ts
describe("Cursor composer headers occupancy", () => {
  const COMPOSER_ID = "7f3a2b10-9c4d-4e5f-8a6b-1c2d3e4f5a6b";

  test("parses a valid header row into a composerId → percent map", () => {
    const map = parseComposerHeaders(JSON.stringify({
      allComposers: [{ composerId: COMPOSER_ID, contextUsagePercent: 95.47466666666666 }],
    }));
    expect(map.get(COMPOSER_ID)).toBe(95.47466666666666);
    expect(map.size).toBe(1);
  });

  test("absent value and missing allComposers are empty, not errors", () => {
    expect(parseComposerHeaders(undefined).size).toBe(0);
    expect(parseComposerHeaders(null).size).toBe(0);
    expect(parseComposerHeaders(JSON.stringify({ somethingElse: [] })).size).toBe(0);
  });

  test("drops non-uuid ids and out-of-range or non-finite percents without clamping", () => {
    const map = parseComposerHeaders(JSON.stringify({
      allComposers: [
        { composerId: "not-a-uuid", contextUsagePercent: 50 },
        { composerId: COMPOSER_ID, contextUsagePercent: 250 },
        { composerId: "8f3a2b10-9c4d-4e5f-8a6b-1c2d3e4f5a6b", contextUsagePercent: Number.NaN },
        { composerId: "9f3a2b10-9c4d-4e5f-8a6b-1c2d3e4f5a6b", contextUsagePercent: -1 },
        { composerId: "af3a2b10-9c4d-4e5f-8a6b-1c2d3e4f5a6b", contextUsagePercent: 100.3 },
      ],
    }));
    // Only the 100.3 row survives: within [0, 100.5], capped later at render.
    expect(map.size).toBe(1);
    expect(map.get("af3a2b10-9c4d-4e5f-8a6b-1c2d3e4f5a6b")).toBe(100.3);
  });

  test("invalid JSON throws so the caller can record a named error", () => {
    expect(() => parseComposerHeaders("{ this is not json")).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/cursor.test.ts -t "composer headers occupancy"`
Expected: FAIL — `parseComposerHeaders` is not exported.

- [ ] **Step 3: Implement**

In `src/shared/types.ts`, inside `interface TokenUsage` after `sessionProcessed` (line 201):

```ts
  /* Observed context fill 0–100, read verbatim from the harness's own meter
     (Cursor: ItemTable composer.composerHeaders). A SIZE percentage, not billed
     spend: it must never be multiplied into `total` or `sessionTotal` — that
     product would be an invented token count against a constant window. */
  occupancyPct?: number;
```

In `src/server/cursor.ts`, after `composerModelForSession` (~line 781):

```ts
// ItemTable composer.composerHeaders carries Cursor's own context meter per
// composer. The key has already moved once (composerData → composerHeaders):
// a missing key or missing allComposers is Cursor changing shape and means
// "no occupancy this scan", never an error. Invalid JSON throws so the caller
// names the failure instead of reading it as absence.
export function parseComposerHeaders(
  value: string | Uint8Array | undefined | null,
): Map<string, number> {
  const map = new Map<string, number>();
  if (value === undefined || value === null) return map;
  const json = typeof value === "string" ? value : Buffer.from(value).toString("utf8");
  const parsed: unknown = JSON.parse(json);
  const composers = asRecord(parsed)?.allComposers;
  if (!Array.isArray(composers)) return map;
  for (const entry of composers) {
    const record = asRecord(entry);
    const id = record?.composerId;
    const pct = record?.contextUsagePercent;
    if (typeof id !== "string" || !UUID_PATTERN.test(id)) continue;
    // [0, 100.5]: drop garbage rather than clamp it; 100.x floats round-trip
    // from Cursor and are capped at 100 only at render time.
    if (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 100.5) continue;
    map.set(id, pct);
  }
  return map;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `bun test tests/cursor.test.ts -t "composer headers occupancy"` → PASS, then `bunx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/server/cursor.ts tests/cursor.test.ts
git commit -m "feat(cursor): parse composer.composerHeaders occupancy meter"
```

---

### Task 2: Read headers in `cursorStateEvidence` + `fillCursorOccupancy` post-pass (GUI path proven)

**Files:**
- Modify: `src/server/cursor.ts` — `cursorStateCache` type (~line 41), `cursorStateEvidence` (~lines 649–707), new `fillCursorOccupancy`, call site in `collectCursorSessions` (~line 1131)
- Test: `tests/cursor.test.ts` (extend `setupGuiComposerHome`, ~line 59)

**Interfaces:**
- Consumes: `parseComposerHeaders` from Task 1.
- Produces: `cursorStateCache.occupancyPct: Map<string, number>` (internal); collected Cursor agents whose uuid has a header row now carry `tokens: { scope: "latest-turn", provenance: "observed", occupancyPct, contextWindow? }`. Tasks 3–6 rely on that tokens shape.

- [ ] **Step 1: Write the failing tests**

Extend `setupGuiComposerHome`'s options (tests/cursor.test.ts:59) with `contextUsagePercent?: number` and, in its `state.vscdb` block (after the two `glass.*` inserts, ~line 90), write the header row when set:

```ts
  if (options.contextUsagePercent !== undefined) {
    state.run("insert into ItemTable(key, value) values (?, ?)", [
      "composer.composerHeaders",
      JSON.stringify({
        allComposers: [
          { composerId: GUI_SESSION_ID, contextUsagePercent: options.contextUsagePercent },
        ],
      }),
    ]);
  }
```

Also add `corruptComposerHeaders?: boolean` writing the literal `"{ this is not json"` under the same key. Then add tests:

```ts
  test("GUI session with a composer header reports occupancy but never tokens or cost", async () => {
    const home = await setupGuiComposerHome({ contextUsagePercent: 95.47, trackingModel: "grok-4.5" });
    const result = await collectCursorSessions(home, 1784692000000);
    expect(result.errors).toEqual([]);
    const agent = result.value.find(({ id }) => id === `cursor:${GUI_SESSION_ID}`);
    expect(agent?.tokens).toMatchObject({
      scope: "latest-turn",
      provenance: "observed",
      occupancyPct: 95.47,
    });
    expect(agent?.tokens.total).toBeUndefined();
    expect(agent?.tokens.sessionTotal).toBeUndefined();
    expect(agent?.cost).toBeNull();
  });

  test("a session with no header row stays on the unknown billing path", async () => {
    const home = await setupGuiComposerHome({ trackingModel: "grok-4.5" });
    const result = await collectCursorSessions(home, 1784692000000);
    const agent = result.value.find(({ id }) => id === `cursor:${GUI_SESSION_ID}`);
    expect(agent?.tokens.occupancyPct).toBeUndefined();
    expect(agent?.tokens.provenance).toBe("unknown");
  });

  test("a corrupt composerHeaders record degrades the source without deleting occupancy-less sessions", async () => {
    const home = await setupGuiComposerHome({ corruptComposerHeaders: true, trackingModel: "grok-4.5" });
    const result = await collectCursorSessions(home, 1784692000000);
    expect(result.errors.join(" ")).toContain("composer headers");
    const agent = result.value.find(({ id }) => id === `cursor:${GUI_SESSION_ID}`);
    expect(agent).toBeDefined();
    expect(agent?.tokens.occupancyPct).toBeUndefined();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/cursor.test.ts -t "composer header"`
Expected: first and third FAIL (`occupancyPct` undefined / no error recorded); second may already pass — that is fine, it pins the invariant.

- [ ] **Step 3: Implement**

1. `cursorStateCache` type (~line 41): add `occupancyPct: Map<string, number>;` alongside `composerData`.
2. In `cursorStateEvidence`'s `readForeignSqlite` callback (~line 670), also read the raw row and return it:

```ts
      const headerRow = database
        .query("select value from ItemTable where key = 'composer.composerHeaders'")
        .get() as { value?: string | Uint8Array | null } | null;
      return {
        sessionCwds: guiSessionCwds(database),
        hasComposerData,
        composerData,
        composerHeadersRaw: headerRow?.value ?? undefined,
      };
```

3. After the read (~line 693), parse outside the sqlite callback so a bad record degrades the source instead of failing the whole state scan:

```ts
    const { composerHeadersRaw, ...rest } = evidence;
    let occupancyPct = new Map<string, number>();
    try {
      occupancyPct = parseComposerHeaders(composerHeadersRaw);
    } catch (error) {
      errors.push(`cursor composer headers: ${error instanceof Error ? error.message : String(error)}; context occupancy will be missing for this scan`);
    }
    cursorStateCache = {
      path,
      fingerprint: fingerprint ?? "",
      ...rest,
      occupancyPct,
      composers: new Map(),
    };
```

4. New post-pass, next to `fillMissingCursorModels` (~line 998):

```ts
// Cursor's own context meter, joined strictly by each agent's OWN session id —
// children without a header row of their own stay unknown by construction.
// store.db stays authoritative: an observed total (if Cursor ever writes usage
// again) outranks the meter and keeps the total/contextWindow derivation.
function fillCursorOccupancy(
  state: NonNullable<typeof cursorStateCache> | undefined,
  agents: CollectedAgent[],
): void {
  if (!state || state.occupancyPct.size === 0) return;
  for (const agent of agents) {
    const pct = state.occupancyPct.get(agent.sourceSessionId);
    if (pct === undefined) continue;
    if (agent.tokens.provenance === "observed" && agent.tokens.total !== undefined) continue;
    agent.tokens = {
      ...agent.tokens,
      scope: "latest-turn",
      provenance: "observed",
      occupancyPct: pct,
    };
  }
}
```

5. Call it in `collectCursorSessions` immediately after `fillMissingCursorModels(state, agents, errors);` (~line 1131): `fillCursorOccupancy(state, agents);`

- [ ] **Step 4: Run to verify they pass**

Run: `bun test tests/cursor.test.ts` (whole file — the cache-fingerprint and honesty tests must stay green) → PASS. `bunx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/server/cursor.ts tests/cursor.test.ts
git commit -m "feat(cursor): join composer occupancy onto collected sessions"
```

---

### Task 3: CLI join, store.db precedence, child non-inheritance

**Files:**
- Test: `tests/cursor.test.ts` (new CLI fixture helper; child fixture mirrors the existing one used by "fills a subagent's model from composerData by session id when no other source has it", tests/cursor.test.ts:889 — read that test's home-builder before writing)
- Modify: `src/server/cursor.ts` only if a test exposes a gap (none expected — Task 2's post-pass already covers every entry path)

**Interfaces:**
- Consumes: `fillCursorOccupancy` behavior from Task 2 (via `collectCursorSessions` output only).
- Produces: pinned behavior for Tasks 4–6; no new names.

- [ ] **Step 1: Write the failing/pinning tests**

New CLI fixture helper next to `setupGuiComposerHome`:

```ts
const CLI_OCCUPANCY_SESSION_ID = "0d9f6afe-2e34-4bd0-9d10-53146a02a111";

async function setupCliOccupancyHome(contextUsagePercent?: number): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "mountain-cursor-cli-occupancy-"));
  temporaryDirectories.push(home);
  const sessionDir = join(home, ".cursor", "chats", "workspace-hash", CLI_OCCUPANCY_SESSION_ID);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(join(sessionDir, "meta.json"), JSON.stringify({
    createdAtMs: 1784691200000,
    updatedAtMs: 1784691238958,
    cwd: "/Users/me/project",
    hasConversation: true,
  }));
  const globalStorage = join(home, "Library", "Application Support", "Cursor", "User", "globalStorage");
  await mkdir(globalStorage, { recursive: true });
  const state = new Database(join(globalStorage, "state.vscdb"));
  state.run("create table ItemTable (key text primary key, value blob)");
  if (contextUsagePercent !== undefined) {
    state.run("insert into ItemTable(key, value) values (?, ?)", [
      "composer.composerHeaders",
      JSON.stringify({ allComposers: [{ composerId: CLI_OCCUPANCY_SESSION_ID, contextUsagePercent }] }),
    ]);
  }
  state.close();
  // Empty conversations table so the GUI pass enumerates zero rows instead of
  // reporting a missing store as a fault of this CLI-only fixture.
  const conversations = new Database(join(globalStorage, "conversation-search.db"));
  conversations.run(`create table conversations (
    fts_rowid integer primary key, source text not null, scope text not null,
    id text not null, title text not null, updated_at integer not null,
    is_archived integer not null, root_fingerprint text, cache_fingerprint text
  )`);
  conversations.close();
  return home;
}
```

Tests:

```ts
  test("CLI chats session joins the same occupancy map as GUI sessions", async () => {
    const home = await setupCliOccupancyHome(41.2);
    const result = await collectCursorSessions(home, 1784691250000);
    expect(result.errors).toEqual([]);
    const agent = result.value.find(({ id }) => id === `cursor:${CLI_OCCUPANCY_SESSION_ID}`);
    expect(agent?.tokens).toMatchObject({ scope: "latest-turn", provenance: "observed", occupancyPct: 41.2 });
    expect(agent?.tokens.total).toBeUndefined();
    expect(agent?.cost).toBeNull();
  });

  test("a CLI session absent from allComposers stays unknown", async () => {
    const home = await setupCliOccupancyHome();
    const result = await collectCursorSessions(home, 1784691250000);
    const agent = result.value.find(({ id }) => id === `cursor:${CLI_OCCUPANCY_SESSION_ID}`);
    expect(agent?.tokens.occupancyPct).toBeUndefined();
    expect(agent?.tokens.provenance).toBe("unknown");
  });
```

Child non-inheritance: copy the home-builder from the subagent-model test at :889, give the **parent** uuid a header row (`contextUsagePercent: 88`) and the child uuid none, then:

```ts
    const child = result.value.find(({ id }) => id === `cursor:${CHILD_SESSION_ID}`);
    expect(child?.tokens.occupancyPct).toBeUndefined();
    expect(child?.tokens.provenance).toBe("unknown");
    const parent = result.value.find(({ id }) => id === `cursor:${PARENT_SESSION_ID}`);
    expect(parent?.tokens.occupancyPct).toBe(88);
```

store.db precedence: mirror the store-building fixture used by "falls back to the newest assistant blob modelName, detecting Composer models" (tests/cursor.test.ts:433 — read it first) to write a store.db whose newest assistant blob carries usage (`{"totalTokens": 120000, ...}` in whatever shape `tryReadCursorTokens`/its blob parser at cursor.ts:501-504 accepts), plus a header row of 95 for the same uuid, then assert:

```ts
    expect(agent?.tokens.total).toBe(120000);
    expect(agent?.tokens.provenance).toBe("observed");
    expect(agent?.tokens.occupancyPct).toBeUndefined();
```

- [ ] **Step 2: Run to verify**

Run: `bun test tests/cursor.test.ts -t "occupancy"`
Expected: CLI + child + precedence tests PASS against Task 2's implementation (they are pins). Any FAIL is a real gap — fix it in `fillCursorOccupancy`, nowhere else.

- [ ] **Step 3: Commit**

```bash
git add tests/cursor.test.ts
git commit -m "test(cursor): pin CLI join, store precedence, child non-inheritance for occupancy"
```

---

### Task 4: `contextPctFor` occupancy branch (server)

**Files:**
- Modify: `src/server/snapshot-agent.ts:326-349`
- Test: `tests/snapshot-context.test.ts` (it exercises the real code through `buildSnapshot` — no reimplementation to sync)

**Interfaces:**
- Consumes: `TokenUsage.occupancyPct` from Task 1.
- Produces: `contextPctFor` returns `Math.round(min(100, occupancyPct))` for observed occupancy; unchanged total/window path. Snapshot `contextPct`, `contextPeak`, `contextReporting` (snapshot.ts:663-675) pick it up with no further change.

- [ ] **Step 1: Write the failing tests**

In `tests/snapshot-context.test.ts` (the local `contextPctFor` helper at line 25 routes through `buildSnapshot`, so tokens in = snapshot contextPct out):

```ts
  test("derives contextPct from an observed occupancy percent without any token total", () => {
    expect(contextPctFor({
      contextWindow: 500_000,
      occupancyPct: 95.47466666666666,
      scope: "latest-turn",
      provenance: "observed",
    })).toBe(95);
  });

  test("caps an over-100 occupancy reading at 100 and works without a window", () => {
    expect(contextPctFor({
      occupancyPct: 100.3,
      scope: "latest-turn",
      provenance: "observed",
    })).toBe(100);
  });

  test("ignores occupancy that is not observed", () => {
    expect(contextPctFor({
      occupancyPct: 95,
      scope: "latest-turn",
      provenance: "unknown",
    })).toBeUndefined();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/snapshot-context.test.ts`
Expected: first two FAIL (undefined), third passes as a pin.

- [ ] **Step 3: Implement**

In `contextPctFor` (src/server/snapshot-agent.ts:326), before the existing `const numerator = total;` derivation:

```ts
  /* Cursor publishes occupancy directly as a percent; there is no token
     numerator to divide, and multiplying the percent back into the window
     would invent one. The raw float was range-checked at ingest ([0, 100.5]);
     the cap to 100 here is display truncation of a legitimate 100.x reading. */
  if (provenance === "observed" && typeof occupancyPct === "number" &&
      Number.isFinite(occupancyPct) && occupancyPct >= 0) {
    return Math.round(Math.min(100, occupancyPct));
  }
```

(destructure `occupancyPct` alongside the others on line 327).

- [ ] **Step 4: Run to verify**

Run: `bun test tests/snapshot-context.test.ts tests/snapshot.test.ts tests/snapshot-agent.test.ts` → PASS. `bunx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/server/snapshot-agent.ts tests/snapshot-context.test.ts
git commit -m "feat(snapshot): contextPct from observed occupancy percent"
```

---

### Task 5: Web `contextUsage` percent-only branch; token cell unchanged

**Files:**
- Modify: `src/web/agent-model.js:596-601`
- Test: `tests/web-client.test.ts` (existing `contextUsage` cases at ~lines 2116-2124)

**Interfaces:**
- Consumes: `tokens.occupancyPct` on the served snapshot.
- Produces: `contextUsage` returns `{ pct, text: pct + "%" }` when occupancy is observed and `total` is absent; every existing return shape unchanged. `tokenSummary` untouched (its absence check reads only total/input/output/cachedInput, so occupancy-only tokens already say "not reported" — the test pins that).

- [ ] **Step 1: Write the failing tests**

Next to the existing contextUsage cases (~line 2116):

```ts
    // Occupancy-only: percent renders alone; no "X of Y" is reconstructed.
    expect(M.contextUsage({ provenance: "observed", scope: "latest-turn", occupancyPct: 95.47, contextWindow: 500_000 }))
      .toEqual({ pct: 95, text: "95%" });
    expect(M.contextUsage({ provenance: "observed", scope: "latest-turn", occupancyPct: 100.3 }))
      .toEqual({ pct: 100, text: "100%" });
    // A real observed total still wins the detailed rendering.
    expect(M.contextUsage({ provenance: "observed", scope: "latest-turn", total: 50_000, contextWindow: 200_000, occupancyPct: 95 }).text)
      .toBe("50k of 200k (25%)");
    // Unknown provenance or scope never lights the ring from a bare percent.
    expect(M.contextUsage({ provenance: "unknown", scope: "latest-turn", occupancyPct: 95 })).toBeNull();
    expect(M.contextUsage({ provenance: "observed", scope: "session", occupancyPct: 95 })).toBeNull();
    // The token cell stays honest: occupancy is context, not tokens.
    expect(M.tokenSummary({ provenance: "observed", scope: "latest-turn", occupancyPct: 95.47 }).text).toBe("not reported");
    expect(M.tokenSummary({ provenance: "observed", scope: "latest-turn", occupancyPct: 95.47 }).known).toBe(false);
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/web-client.test.ts -t "contextUsage"` (adjust `-t` to the enclosing test's name at line ~2110)
Expected: FAIL on the two occupancy-only expectations; the rest pass as pins.

- [ ] **Step 3: Implement**

In `src/web/agent-model.js:596`:

```js
export function contextUsage(tokens) {
  if (tokens && tokens.scope === "latest-turn" && tokens.provenance === "observed" &&
      !Number.isFinite(tokens.total) &&
      Number.isFinite(tokens.occupancyPct) && tokens.occupancyPct >= 0) {
    /* Cursor reports a bare percent. Rendering it as "X of Y tokens" would
       require multiplying it back into the window constant — an invented
       measurement — so the ring shows the percent and nothing else. */
    const pct = Math.min(100, Math.round(tokens.occupancyPct));
    return { pct, text: pct + "%" };
  }
  if (!tokens || tokens.scope !== "latest-turn" || tokens.provenance !== "observed" ||
      !Number.isFinite(tokens.total) || !Number.isFinite(tokens.contextWindow) || !(tokens.contextWindow > 0)) return null;
  const rawPct = Math.max(0, Math.round((tokens.total / tokens.contextWindow) * 100));
  return { pct: Math.min(100, rawPct), text: fmtTok(tokens.total) + " of " + fmtTok(tokens.contextWindow) + " (" + rawPct + "%)" };
}
```

`tokenSummary` gets no edit.

- [ ] **Step 4: Run to verify**

Run: `bun test tests/web-client.test.ts` → PASS (whole file — the ring/board tests at 6255+ consume `contextUsage` too).

- [ ] **Step 5: Commit**

```bash
git add src/web/agent-model.js tests/web-client.test.ts
git commit -m "feat(web): context ring renders observed occupancy percent alone"
```

---

### Task 6: Rollup honesty pin, full gate, live smoke

**Files:**
- Test: `tests/cursor.test.ts` — "keeps Cursor sessions out of the token usage and burn rollups" (line 971)
- No source changes expected.

**Interfaces:**
- Consumes: everything above.
- Produces: the branch is verifiable done per the spec's Done-when.

- [ ] **Step 1: Extend the rollup honesty test**

Inside the existing test at :971, after `pulse.report`, add a second snapshot built from a Cursor agent whose tokens carry occupancy, and assert the rollups still exclude it while context coverage includes it:

```ts
    const occupiedCursor: CollectedAgent = {
      ...cursorAgent,
      id: "cursor:occupied",
      sourceSessionId: "occupied",
      tokens: { scope: "latest-turn", provenance: "observed", occupancyPct: 95.47, contextWindow: 500_000 },
    };
    const occupiedSnapshot = buildSnapshot({
      agents: [occupiedCursor, claudeAgent],
      surfaces: [],
      archiveStore,
      now: new Date(nowMs),
    });
    // Occupancy lights the context ring…
    expect(occupiedSnapshot.programs.flatMap((p) => p.agents).find((a) => a.id === "cursor:occupied")?.contextPct).toBe(95);
    expect(occupiedSnapshot.totals.contextReporting).toBe(1);
    // …and moves nothing in the token economy.
    expect(occupiedSnapshot.totals.tokens).toBe(1000);
    expect(occupiedSnapshot.totals.tokenReporting).toBe(1);
```

(If `totals.contextReporting` is named differently on the snapshot totals — check `snapshot.ts:759-762` — use the field actually published there.)

- [ ] **Step 2: Run the full gate**

Run: `bunx tsc --noEmit` → clean. `bun test` → parity with `main` (only the documented local-only `docs/a11y-geometry-gate` red is tolerated; anything else newly red is yours). Do not weaken `tests/usage-cost-honesty.test.ts`.

- [ ] **Step 3: Live smoke against the real machine**

```bash
bun -e '
import { collectCursorSessions } from "./src/server/cursor";
const r = await collectCursorSessions();
for (const a of r.value.filter((a) => a.tokens.occupancyPct !== undefined))
  console.log(a.sourceSessionId, a.tokens.occupancyPct, a.tokens.total, a.cost);
'
```

Expected: at least one live composer row prints a percent (Emilio's machine had 95.47 on 2026-08-13), `total` prints `undefined`, cost `null`. If zero rows print, check that a Cursor composer was active recently and that `composer.composerHeaders` still exists in the live state.vscdb before concluding anything (an absence proves nothing until the source is confirmed present).

- [ ] **Step 4: Commit and stop**

```bash
git add tests/cursor.test.ts
git commit -m "test(cursor): occupancy lights context coverage without touching token rollups"
```

Stop here. PR to `main` and any board deploy (launchd kickstart + `?v=ah-tN` cache-bust bump per the serving topology notes) need Emilio's explicit approval.

---

## Follow-up: Spec B — cloud (`bc-`) Cursor agents (separate spec + plan, not this branch)

The user's "covered whether cli-launched or cloud-based" splits cleanly: this plan finishes context % for everything launched on this machine (CLI, GUI, IDE chats — they all live in the same local stores). Cloud agents are the remaining gap, and it is **bigger than one API call**: Formic currently has *zero* cloud-agent enumeration — `collectCursorGuiSessions` deliberately filters `source = 'local'` (cursor.ts:930), and nothing anywhere references `bc-` ids. Usage cannot be attached to rows that are never collected.

Before writing Spec B, verify three facts on the live machine (10 minutes, no code):

1. `sqlite3 "$HOME/Library/Application Support/Cursor/User/globalStorage/conversation-search.db" "select distinct source from conversations"` — do cloud conversations appear under a non-`local` source, and do their rows carry a `bc-` id or a composer uuid?
2. Does Emilio want a Cursor API key stored for Formic at all (secret lives where? `.env`? Keychain?) — the `GET /v1/agents/{id}/usage` endpoint needs one.
3. One `curl` of that endpoint against a real recent `bc-` id: confirm the response fields map onto `input/output/cachedInput` with `scope: "session"`, `provenance: "observed"` — and that no field resembles occupancy (Cursor declined a per-step context API; cloud rows will have tokens but **no** context %, the mirror image of this plan).

Then Spec B is: enumerate cloud rows (from whatever fact 1 shows), fetch usage per row, fill billed tokens and possibly cost, never `occupancyPct`, and revisit the `provider !== "cursor"` pulse exclusion *only* for cloud rows with observed session totals — that last point is the one honesty-sensitive decision and deserves its own spec review.
