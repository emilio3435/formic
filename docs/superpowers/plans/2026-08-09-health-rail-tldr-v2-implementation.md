# Health Rail v2 — TL;DR Fold-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold the standalone `section#heartbeat-tldr` into `section#health-rail` as a 60/40 TL;DR-left ribbon with chevron paging, per the approved spec at `docs/superpowers/specs/2026-08-09-health-rail-tldr-v2-design.md` (commit `c96dc86`, mockup `docs/rhs-shots/health-rail-tldr-fold-in/mockup-v2.html`).

**Architecture:** Static two-child skeleton in `index.html` (so the `#cleanup-status` aria-live region and column shells survive paints — `renderHealthRail` empties only inner render targets); envelope v4 parsing and lane rendering in `app.js`; a new focused module for safe mini-markup; server-side heartbeat tail backstop via one shared cap helper applied at all three truncation sites.

**Tech Stack:** Bun (test + server), vanilla ES modules, no new dependencies.

## Global Constraints

- **Docs said, spec holds:** no raw transcript HTML ever reaches `innerHTML`; mini-markup renders through an allowlist tokenizer only.
- **No invented repo-level spend attribution:** repo-scoped Burn shows `—` / `fleet-wide only` when per-repo cost does not exist in the wire.
- **Serial fence (one lane at a time):** `src/web/app.js`, `src/web/transcript.js`, `src/web/styles.css`, `tests/web-client.test.ts`. This plan **never touches `transcript.js`** (Chat UX, user-owned surface 26). Tasks 1–4 are fence-free; Tasks 5–10 require the fence.
- **Shared-worktree hygiene:** commit path-scoped (`git commit -m … -- <paths>`), forward-only, never amend, re-check branch before every commit (`git rev-parse --abbrev-ref HEAD`).
- **No push / PR / merge; no Chat UX interaction; no broad refactor.** Local commits only.
- **Copy rules:** signals enum `ok · working · idle · needs-you · blocked · failed · all-clear`; blocker ≤ 48 chars (parser slices); localStorage key `mtn3-tldr-view`; backstop constant `MAX_HEARTBEAT_TAIL_CHARS = 6000`.
- **Gate for every commit:** `bunx tsc --noEmit` clean and `bun test` no new failures vs the Task 0 baseline (the known local-only `docs/a11y-geometry-gate` red is pre-existing and excluded).

## Repository anchors (verified 2026-08-09 at `chore/docker-local-ci` tip `6678e65`)

| Surface | Anchor |
|---|---|
| Rail markup + live region | `src/web/index.html:72-105` (`.rail-header` 73–93, `#cleanup-status` 91, `#health-widgets` 94, `#widget-customizer` 95) |
| Standalone panel to remove | `src/web/index.html:107-119` (`section#heartbeat-tldr`) |
| `renderHealthRail` | `src/web/app.js:3746-3846` (empties `#health-widgets` at 3817; calls `renderWidgetCustomizer` 3834, `renderHeartbeatTldr` 3835). Callers: `app.js:909, 2273, 2716, 2724, 4137, 4147, 4156, 11915, 11921, 11987` |
| Heartbeat helpers | `heartbeatTldrAgent` 3849, `parseHeartbeatStructured` 3869-3914, `programForTldrRepo` 3916, `deterministicRepoStats` 3938, `tldrCardSignalClass` 3968, `renderHeartbeatTldr` 3975-4111 |
| TheAntHill exports | `src/web/app.js:1452-1470` (test-visible surface; heartbeat helpers listed at 1470) |
| Widget data | `summaryWidgetData` `app.js:987` (burn branch 1159–1240 reads `snap.pulse.burn`: `tokensPerMin`, `costLastHourUsd`, `costProvenance`, `costIsFloor`, `costAsOf`, `costNote`) |
| Widget catalog / prefs | `src/web/client-catalogs.js:193-229` (`WIDGET_STORAGE_KEY` "mtn3-summary-widgets", `DEFAULT_WIDGET_IDS`, `WIDGET_CATALOG`, `RETIRED_WIDGET_IDS`, `WIDGET_IDS`); load/save `app.js:1780-1787` |
| Provider/model labels | `src/web/text-formatters.js:95-96` (`providerLabel`/`harnessLabel`), `modelShort` same file; provider color tokens `styles.css:62-65` |
| Wire caps | `src/server/types.ts:16` (`MAX_TRANSCRIPT_TAIL_CHARS = 800`); truncation sites `src/server/prime.ts:100` (accumulate), `src/server/collectors.ts:457` (normalize), `src/server/snapshot.ts:586-588` (re-slice + notification concat) |
| Prime agent identity | `prime.ts:~125` — `id: \`prime:${sessionId}\``; heartbeat monitor is `prime:ant-heartbeat-monitor`, with content fallback (any prime tail containing `[TL;DR`) at `app.js:3858-3863` |
| CSS to reuse | `styles.css:352-532` (`.heartbeat-tldr*` container dies; `.tldr-card-signal` 449, `.tldr-det-pill` 502, `.tldr-card-blocker` 476, `.heartbeat-tldr-label` 373, `.tldr-card-repo` 440 are reused); rail family 533–624; `.is-frozen` 335–339; customizer 701 |
| Tests touching this surface | `tests/b2-render-proof.test.ts` (298 lines; cap tests 172–206 and 228–250; parser test 151–170; fake-DOM harness `makeNode`/`withDom` at top), `tests/web-client.test.ts` (13,743 lines — **fenced**; source assertions at 3347, 3392 `.rail-inner .reading` mobile rule, 3537, 13442 renderHealthRail regex) |
| Writer guidance | `.prime/agent/skills/ant-hill-orchestrator/references/heartbeat-tldr.md` (B2 recipe, boot probe), `.prime/agent/ant-hill-heartbeat-fallback.sh:11` (INSTRUCTION line; running loop re-reads only on restart) |
| Test harness pattern | import `../src/web/app.js` → `globalThis.TheAntHill`; fake DOM built in-test (b2 pattern). Geometry is NOT computable in fake DOM — pixel evidence comes from /browse against a live board. |

## Execution context — dirty integration branch and lane fences

- Execute in a **fresh worktree branched from the current `chore/docker-local-ci` tip** (use `superpowers:using-git-worktrees`). The main worktree is dirty with foreign in-flight work — Task Widget lane holds uncommitted `src/server/snapshot.ts` (`rawTask`/`refinedTask`) and `src/web/presentation.js` edits; Chat lane owns `src/web/transcript.js` and drawer surfaces. **Never** base on the dirty tree; never edit `transcript.js`.
- `tests/web-client.test.ts` is shared and foreign-modified: edits there are **minimal and additive** — change only assertions your diff broke (expected: the `:3392` mobile-CSS string; verify `:13442`), append new blocks at file end, never reorder or rewrite foreign describe blocks. Rebase onto the integration tip before landing and re-run the gate; conflicts in that file resolve by keeping both sides.
- New tests live in **new files**, one per parallel lane (`tests/health-rail-v2-server.test.ts`, `tests/health-rail-v2-markup.test.ts`, `tests/health-rail-v2-catalog.test.ts`, `tests/health-rail-v2.test.ts` for the serial Phase-2 lane, `tests/helpers/fake-dom.ts`) precisely so integration — and the lanes themselves — cannot overwrite foreign tests.
- The heartbeat fallback loop runs under a PID Emilio owns; this plan edits its INSTRUCTION text but **never kills/restarts the process** — restart is an owner keystroke (see Task 4).

## Parallel execution — lane map and collision rules

**Phase 1 (Tasks 1–4) runs as FOUR PARALLEL LANES.** Their path sets are disjoint by construction — each lane owns its paths exclusively and each writes its **own** new test file:

| Lane | Task | Owns (exclusively, for the lane's lifetime) |
|---|---|---|
| P1 | Task 1 | `src/server/{types,prime,collectors,snapshot}.ts`, `tests/health-rail-v2-server.test.ts` (new), `tests/b2-render-proof.test.ts` |
| P2 | Task 2 | `src/web/tldr-markup.js` (new), `tests/helpers/fake-dom.ts` (new), `tests/health-rail-v2-markup.test.ts` (new) |
| P3 | Task 3 | `src/web/client-catalogs.js`, `tests/health-rail-v2-catalog.test.ts` (new) |
| P4 | Task 4 | `.prime/agent/skills/ant-hill-orchestrator/references/heartbeat-tldr.md`, `.prime/agent/ant-hill-heartbeat-fallback.sh` |

**Phase 2 (Tasks 5–10) is STRICTLY SERIAL: exactly one lane**, holding the fence (`src/web/app.js`, `src/web/styles.css`, `tests/web-client.test.ts`, plus `src/web/index.html` and `src/web/client-catalogs.js` for its window), executing Tasks 5→9 in order as one contiguous run, then Task 10. Phase 2 starts only after every Phase-1 lane has landed and the full gate is green on the integrated tip.

**Collision rules (binding on every implementing agent):**

1. **One writer per path.** The ownership table above is the authority. If your task seems to need a path outside your lane's row, STOP and report to the orchestrator — do not edit it, do not "quickly fix" another lane's file, do not resolve someone else's conflict.
2. **Isolation:** default is one worktree per lane (`git worktree add … -b feat/hr2-<lane>` from the same integration tip). If the orchestrator runs lanes in a shared worktree instead (fleet practice), then: commit **only** with explicit paths (`git commit -m … -- <your paths>`, never `git add .` / `git commit -a` — a bare commit sweeps other lanes' staged work), re-check `git rev-parse --abbrev-ref HEAD` before every commit, and never amend any commit — even your own tip — because another lane may already have built on it. Forward-only fixes.
3. **Test files:** each Phase-1 lane writes only its own new test file named above. Nobody touches `tests/web-client.test.ts` in Phase 1. `tests/b2-render-proof.test.ts` belongs to P1 alone. The Phase-2 lane consolidates its new assertions in `tests/health-rail-v2.test.ts` and may extend `tests/helpers/fake-dom.ts` (P2 has landed by then).
4. **Foreign-dirty stop:** before your first edit, `git status` your owned paths. If any owned path is already modified by someone else, STOP and report — never commit over foreign changes, never stash them away.
5. **Gate honestly:** run `bunx tsc --noEmit && bun test` before each commit. A red you didn't cause is a report, not something to fix in another lane's file, and never a reason to skip/`.skip` a test.
6. **Land order:** Phase-1 lanes land in any order; the integrator rebases each onto the moving tip (conflicts should be impossible if rule 1 held — a conflict is evidence a rule broke; investigate, don't force-resolve).
7. **Report format:** each lane reports commit SHA, exact paths touched (must equal its ownership row), gate output, and anything it observed but did not touch.

---

### Task 0: Worktree + baseline checkpoint

**Files:** none modified.

- [ ] **Step 1:** Create the worktree and prove location:

```bash
git -C /Users/emilionunezgarcia/Developer/the-mountain-main worktree add \
  ../the-mountain.worktrees/health-rail-v2-impl -b feat/health-rail-tldr-v2 chore/docker-local-ci
cd /Users/emilionunezgarcia/Developer/the-mountain.worktrees/health-rail-v2-impl
pwd && git rev-parse --abbrev-ref HEAD && git log --oneline -1
```

Expected: branch `feat/health-rail-tldr-v2` at the `chore/docker-local-ci` tip (`6678e65` or newer).

- [ ] **Step 2:** Record the baseline gate:

```bash
bunx tsc --noEmit && bun test 2>&1 | tail -3
```

Expected: tsc clean; note pass/fail counts verbatim in the lane report (the `docs/a11y-geometry-gate` local-only red may appear — record it as pre-existing). **This is the rollback point for everything below.**

---

### Task 1: Server heartbeat tail backstop (fence-free, Lane P1)

**Files:**
- Modify: `src/server/types.ts:16`
- Modify: `src/server/prime.ts:100` and the `result()` return (`transcriptTail:` field)
- Modify: `src/server/collectors.ts:457`
- Modify: `src/server/snapshot.ts:586-588`
- Test: `tests/health-rail-v2-server.test.ts` (new — P1-owned), `tests/b2-render-proof.test.ts:172-206` (amend — P1-owned)

**Interfaces:**
- Produces: `MAX_HEARTBEAT_TAIL_CHARS = 6000`, `capTranscriptTail(tail?: string): string | undefined` (exported from `src/server/types.ts`). Rule: a tail whose trimmed start matches `/^\[TL;DR\s/` caps at 6000; everything else at 800. Content-based on purpose — it mirrors `heartbeatTldrAgent`'s own fallback contract (`app.js:3858-3863`), so exactly the tails the header can consume are the tails the wire preserves.

- [ ] **Step 1: Write the failing tests** (new file `tests/health-rail-v2-server.test.ts`):

```ts
import { describe, expect, test } from "bun:test";

describe("heartbeat tail backstop", () => {
  test("capTranscriptTail keeps a [TL;DR envelope beyond 800 chars and caps others", async () => {
    const { capTranscriptTail, MAX_HEARTBEAT_TAIL_CHARS, MAX_TRANSCRIPT_TAIL_CHARS } =
      await import("../src/server/types");
    const envelope = "[TL;DR 17:33] " + JSON.stringify({ v: 4, fleet: "f".repeat(1200), repos: [] });
    expect(capTranscriptTail(envelope)!.length).toBe(envelope.length); // < 6000 → untouched
    expect(capTranscriptTail(envelope)).toBe(envelope);                 // head preserved
    const chatter = "z".repeat(2000);
    expect(capTranscriptTail(chatter)!.length).toBe(MAX_TRANSCRIPT_TAIL_CHARS);
    const hugeEnvelope = "[TL;DR 17:33] " + "x".repeat(9000);
    expect(capTranscriptTail(hugeEnvelope)!.length).toBe(MAX_HEARTBEAT_TAIL_CHARS);
  });

  test("prime parser preserves a >800-char envelope end-to-end through buildSnapshot", async () => {
    const { parsePrimeJsonl } = await import("../src/server/prime");
    const { buildSnapshot } = await import("../src/server/snapshot");
    const envelope = "[TL;DR 04:03] " + JSON.stringify({
      v: 4, fleet: "eight agents live. " + "detail ".repeat(160),
      repos: [{ repo: "the-mountain-main", summary: "s".repeat(300), blocker: "question pending", signal: "needs-you" }],
    });
    expect(envelope.length).toBeGreaterThan(800);
    const jsonl = [
      JSON.stringify({ type: "session", id: "ant-heartbeat-monitor", cwd: "/tmp", timestamp: new Date().toISOString() }),
      JSON.stringify({ type: "message", message: { role: "assistant", content: envelope, timestamp: new Date().toISOString() } }),
    ].join("\n");
    const agent: any = parsePrimeJsonl(jsonl);
    expect(agent.transcriptTail).toBe(envelope); // head intact — parse survives
    const snap: any = buildSnapshot({ agents: [agent], surfaces: [],
      archiveStore: { archivedAgents: () => [], has: () => false } as any, now: new Date() });
    const out = snap.programs.flatMap((p: any) => p.agents).find((a: any) => a.id === "prime:ant-heartbeat-monitor");
    expect(out.transcriptTail).toBe(envelope); // snapshot re-slice did not decapitate it
  });
});
```

- [ ] **Step 2:** `bun test tests/health-rail-v2-server.test.ts` → Expected: FAIL (`capTranscriptTail` not exported; end-to-end tail sliced to 800).

- [ ] **Step 3: Implement.** In `types.ts` beside line 16:

```ts
export const MAX_TRANSCRIPT_TAIL_CHARS = 800;
/* Heartbeat TL;DR envelopes ride transcriptTail and die head-first under
   slice(-800): the "[TL;DR …] {"v":4," prefix is the part that gets cut, which
   turns a long envelope into an unparseable stub. Envelope-shaped tails get a
   generous backstop; the writer's guidance governs length, the wire must not. */
export const MAX_HEARTBEAT_TAIL_CHARS = 6000;
export function capTranscriptTail(tail: string | undefined): string | undefined {
  if (tail == null) return tail;
  const cap = /^\[TL;DR\s/.test(tail.trimStart()) ? MAX_HEARTBEAT_TAIL_CHARS : MAX_TRANSCRIPT_TAIL_CHARS;
  return tail.slice(-cap);
}
```

Apply at all three sites (read each site's neighbours first):
- `prime.ts:100`: accumulate generously — `tail = t.slice(-MAX_HEARTBEAT_TAIL_CHARS);` — and in `result()` set `transcriptTail: capTranscriptTail(tail)`.
- `collectors.ts:457`: `transcriptTail: capTranscriptTail(input.transcriptTail),`
- `snapshot.ts:586-588`: both branches through `capTranscriptTail(...)` (the `[Attention]` concat branch still starts with the original tail, so an envelope keeps its generous cap).

- [ ] **Step 4:** Amend `tests/b2-render-proof.test.ts:172-206`: the fixture tail there starts with `[TL;DR` and 2000 chars — under the new rule it is **preserved**, so change the two assertions to `expect(snapAgent.transcriptTail).toBe(longTail)` and retitle the test `"wire caps non-envelope tails to 800; [TL;DR envelopes keep the 6000 backstop"`. Add one non-envelope fixture asserting `length === 800`. Tests 228–250 stay valid (their long fixture does not start with `[TL;DR`) — update only the stale comment at 243.

- [ ] **Step 5:** `bunx tsc --noEmit && bun test tests/health-rail-v2-server.test.ts tests/b2-render-proof.test.ts` → Expected: PASS. Then full `bun test` → no new reds vs baseline.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/health-rail-tldr-v2
git commit -m "feat(server): heartbeat envelope tail backstop via capTranscriptTail" \
  -- src/server/types.ts src/server/prime.ts src/server/collectors.ts src/server/snapshot.ts \
     tests/health-rail-v2-server.test.ts tests/b2-render-proof.test.ts
```

---

### Task 2: Safe mini-markup module (fence-free, Lane P2)

**Files:**
- Create: `src/web/tldr-markup.js`
- Create: `tests/helpers/fake-dom.ts` (extract of the `makeNode`/`withDom` harness from `tests/b2-render-proof.test.ts` top — copy it into the helper and re-export; leave b2's local copy alone, it is P1-owned and foreign-modified)
- Test: `tests/health-rail-v2-markup.test.ts` (new — P2-owned)

**Interfaces:**
- Produces: `tldrMarkupNodes(text: string): Node[]` — tokenizes `*strong*`, `` `mono` ``, `!alert!` (each run ≤ 80 chars, non-greedy) into `el("strong", …)`, `el("span", {class:"mono"})`, `el("span", {class:"is-alert"})`; every other run becomes `el("span", {text})`. **Never** parses HTML; output nodes carry text via `textContent` only.

- [ ] **Step 1: Write the failing tests** (new file `tests/health-rail-v2-markup.test.ts`):

```ts
describe("tldr mini-markup", () => {
  test("renders *strong*, `mono`, !alert! runs into classed spans", async () => {
    const { withDom } = await import("./helpers/fake-dom");
    const { tldrMarkupNodes } = await import("../src/web/tldr-markup.js");
    const nodes = withDom(() => tldrMarkupNodes("agent *blocked* on `main` — !needs you!"));
    const tags = nodes.map((n: any) => n.tagName + ":" + (n.className || ""));
    expect(tags).toEqual(["span:", "strong:", "span:", "span:mono", "span:", "span:is-alert"]);
    expect(nodes.map((n: any) => n.textContent).join("")).toBe("agent blocked on main — needs you");
  });

  test("HTML in writer text renders as literal text, never as elements", async () => {
    const { withDom } = await import("./helpers/fake-dom");
    const { tldrMarkupNodes } = await import("../src/web/tldr-markup.js");
    const hostile = 'x <img src=q onerror="alert(1)"> *<script>y</script>*';
    const nodes = withDom(() => tldrMarkupNodes(hostile));
    for (const n of nodes as any[]) expect(["SPAN", "STRONG"]).toContain(n.tagName.toUpperCase());
    expect(nodes.map((n: any) => n.textContent).join("")).toContain('<img src=q onerror="alert(1)">');
  });
});
```

- [ ] **Step 2:** Run → Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `src/web/tldr-markup.js`:

```js
/* Writer mini-markup → styled nodes. The writer is an agent transcript —
   untrusted input — so this is a tokenizer over three literal delimiters, not
   an HTML parser. Output text always travels through textContent. */
import { el } from "./dom-primitives.js";

const TOKEN = /(\*[^*]{1,80}\*|`[^`]{1,80}`|![^!]{1,80}!)/g;

export function tldrMarkupNodes(text) {
  const s = String(text ?? "");
  const nodes = [];
  let last = 0;
  for (const m of s.matchAll(TOKEN)) {
    if (m.index > last) nodes.push(el("span", { text: s.slice(last, m.index) }));
    const tok = m[0];
    const inner = tok.slice(1, -1);
    if (tok[0] === "*") nodes.push(el("strong", { text: inner }));
    else if (tok[0] === "`") nodes.push(el("span", { class: "mono", text: inner }));
    else nodes.push(el("span", { class: "is-alert", text: inner }));
    last = m.index + tok.length;
  }
  if (last < s.length) nodes.push(el("span", { text: s.slice(last) }));
  return nodes;
}
```

- [ ] **Step 4:** Run both tests → PASS. Full gate → no new reds.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): tldr mini-markup allowlist renderer" -- src/web/tldr-markup.js tests/helpers/fake-dom.ts tests/health-rail-v2-markup.test.ts`

---

### Task 3: View-persistence key (fence-free, Lane P3)

**Files:**
- Modify: `src/web/client-catalogs.js` (beside `CONTEXT_SPREAD_KEY`, ~line 186)
- Test: `tests/health-rail-v2-catalog.test.ts` (new — P3-owned)

**Interfaces:**
- Produces: `export const TLDR_VIEW_KEY = "mtn3-tldr-view";` — stored value is `"ALL"` or a repo name string. (Consumed by Task 7's `state.tldrView` load/save in `app.js:1780-1787` region.)

- [ ] **Step 1: Failing test:**

```ts
test("TLDR_VIEW_KEY is exported for per-browser view persistence", async () => {
  const { TLDR_VIEW_KEY } = await import("../src/web/client-catalogs.js");
  expect(TLDR_VIEW_KEY).toBe("mtn3-tldr-view");
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Add the export with a comment matching its neighbours (a display preference, per-browser, like `CONTEXT_SPREAD_KEY`). **Step 4:** Run → PASS; full gate. **Step 5: Commit** — `git commit -m "feat(web): TLDR view persistence key" -- src/web/client-catalogs.js tests/health-rail-v2-catalog.test.ts`

---

### Task 4: Writer guidance v4 (fence-free, docs/scripts only, Lane P4)

**Files:**
- Modify: `.prime/agent/skills/ant-hill-orchestrator/references/heartbeat-tldr.md` (B2 recipe blocks and boot-probe instruction strings)
- Modify: `.prime/agent/ant-hill-heartbeat-fallback.sh:11` (INSTRUCTION)

- [ ] **Step 1:** Replace the summarize clauses in every instruction string (the two `rlm_heartbeat.create` blocks, the boot-probe python block, and the fallback INSTRUCTION) with the v4 contract:

```
Emit as an assistant turn, prefix "[TL;DR HH:MM] ", then ONE LINE of JSON:
{"v":4,"fleet":"<cross-repo story: who needs the operator, why, what unblocks it — 2–3 sentences>",
 "repos":[{"repo":"<name>","summary":"<cause → blocker → next action, 2–4 sentences>",
           "blocker":"<≤48 chars or all-clear>","signal":"ok|working|idle|needs-you|blocked|failed|all-clear"}]}
Style: mini-markup only — *strong*, `mono`, !alert! — no HTML, no markdown.
NEVER restate momentum/burn/context numbers; the board renders those deterministically.
Length is yours to judge for content; the board clamps prose to 3 lines and the wire
backstop is 6000 chars — end sentences early rather than relying on the clamp.
```

- [ ] **Step 2:** Verify no other instruction text still says "2 sentences + 1 bullet 'Blockers:'": `grep -rn "Blockers:" .prime/agent/ | grep -v reference-history` → only prose explanations remain, no live instruction strings.
- [ ] **Step 3:** **Do not restart the fallback loop.** Note in the lane report: the running PID sends the old INSTRUCTION until restarted — owner keystroke (`bash ~/.prime/agent/ant-hill-boot-probe.sh` after killing his own PID).
- [ ] **Step 4: Commit** — `git commit -m "docs(heartbeat): v4 envelope writer contract (fleet field, mini-markup, no metric restatement)" -- .prime/agent/skills/ant-hill-orchestrator/references/heartbeat-tldr.md .prime/agent/ant-hill-heartbeat-fallback.sh`

---

> **⛔ FENCE GATE — before Task 5:** confirm with the orchestrator that no other lane holds `src/web/app.js`, `src/web/styles.css`, or `tests/web-client.test.ts`. Record the confirmation (who/when) in the lane report. Tasks 5–10 hold the fence; land them as one contiguous run.

### Task 5: Parser v4 + fleet fallback (fenced: app.js)

**Files:**
- Modify: `src/web/app.js:3869-3914` (`parseHeartbeatStructured`), export block `app.js:1470`
- Test: `tests/health-rail-v2.test.ts` (append)

**Interfaces:**
- Produces: parse result gains `fleet: string` (`""` when absent). New pure helper `fleetFallbackLine(snap, repos)` → deterministic ALL-line (`"8 live across 3 repos · 1 needs you — the-mountain-main"`), exported on TheAntHill.

- [ ] **Step 1: Failing tests:**

```ts
describe("parseHeartbeatStructured v4", () => {
  test("v4 exposes fleet; v3 parses with empty fleet (graceful degrade)", async () => {
    await import("../src/web/app.js");
    const M = (globalThis as any).TheAntHill;
    const v4 = M.parseHeartbeatStructured('[TL;DR 17:33] {"v":4,"fleet":"Eight agents live. *the-mountain-main* !needs you!.","repos":[{"repo":"the-mountain-main","summary":"s","blocker":"question pending","signal":"needs-you"}]}');
    expect(v4.legacy).toBe(false);
    expect(v4.fleet).toContain("Eight agents live");
    const v3 = M.parseHeartbeatStructured('[TL;DR 12:34] {"v":3,"repos":[{"repo":"Home","summary":"s","blocker":"all-clear","signal":"working"}]}');
    expect(v3.fleet).toBe("");
    expect(v3.repos.length).toBe(1);
  });

  test("fleetFallbackLine composes a deterministic ALL line from snapshot totals", async () => {
    const M = (globalThis as any).TheAntHill;
    const snap = { totals: { live: 8, attention: 1 }, programs: [{ name: "the-mountain-main" }, { name: "Home" }, { name: "cooper" }] };
    const line = M.fleetFallbackLine(snap, [{ repo: "the-mountain-main", signal: "needs-you" }]);
    expect(line).toContain("8 live");
    expect(line).toContain("3 repos");
    expect(line).toContain("the-mountain-main");
  });
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** In the v3 envelope branch (`app.js:3876-3889`) read `envelope.fleet`, return `{ time, fleet: typeof envelope.fleet === "string" ? envelope.fleet : "", repos, … }`; add `fleet: ""` to the legacy and empty returns. Add `fleetFallbackLine(snap, repos)` beside `deterministicRepoStats` and export both on TheAntHill at `app.js:1470`. **Step 4:** Run → PASS; full gate. **Step 5: Commit** — `git commit -m "feat(web): heartbeat envelope v4 — fleet synthesis field + deterministic fallback" -- src/web/app.js tests/health-rail-v2.test.ts`

---

### Task 6: Static two-child skeleton + lane renderer states A/C (fenced: app.js, styles.css, index.html)

**Files:**
- Modify: `src/web/index.html:72-119`
- Modify: `src/web/app.js` (`renderHealthRail` 3746-3846, `renderHeartbeatTldr` 3975-4111 → becomes `renderHealthTldrLane`)
- Modify: `src/web/styles.css` (rail family 533–624; heartbeat family 352–532)
- Test: `tests/health-rail-v2.test.ts` (append), `tests/web-client.test.ts` (amend broken assertions only)

**Interfaces:**
- Produces: static DOM contract — `#health-widgets.rail-inner` owns exactly `div#health-tldr-lane.health-tldr-lane` then `div.readings-stack` (which owns `div.stack-head` holding the MOVED `#scan-window`, `#cleanup-status`, `#customize-summary` nodes plus the `Summary` heading, and `div#readings-grid.readings-grid`). `renderHealthRail` empties **only** `#readings-grid`; `renderHealthTldrLane()` empties **only** `#health-tldr-lane`. Live region survives every paint (the `index.html:82-90` invariant).

- [ ] **Step 1: Failing tests** (fake-DOM structural, geometry excluded by design):

```ts
describe("health rail v2 DOM contract", () => {
  test("index.html rail-inner is a static two-child shell; standalone heartbeat panel is gone", () => {
    const html = readFileSync("src/web/index.html", "utf8");
    expect(html).not.toContain('id="heartbeat-tldr"');
    const rail = html.slice(html.indexOf('id="health-rail"'), html.indexOf('id="widget-customizer"'));
    expect(rail.indexOf('class="health-tldr-lane"')).toBeGreaterThan(-1);
    expect(rail.indexOf('class="health-tldr-lane"')).toBeLessThan(rail.indexOf('class="readings-stack"'));
    expect(rail).toContain('id="cleanup-status"');      // live region moved INTO stack-head, still static
    expect(rail).toContain('id="readings-grid"');
  });

  test("renderHealthRail empties only #readings-grid — lane and live region survive the paint", () => {
    // withDom builds ids: health-rail, health-widgets, health-tldr-lane, readings-grid,
    // cleanup-status, scan-window, customize-summary, widget-customizer.
    const { doc, M } = setupRailDom();          // helper in fake-dom.ts, returns tracked nodes
    doc.byId("cleanup-status").textContent = "sweep running";
    M.renderHealthRail();
    expect(doc.byId("cleanup-status").textContent).toBe("sweep running"); // not rebuilt
    expect(doc.byId("health-widgets").children.length).toBe(2);           // still the two shells
  });

  test("ALL state renders fleet prose via mini-markup and a chip strip; no-envelope hides the lane", () => {
    const { doc, M } = setupRailDom();
    M.state.snap = snapWithHeartbeat('[TL;DR 17:33] {"v":4,"fleet":"*the-mountain-main* !needs you! on `main`.","repos":[{"repo":"the-mountain-main","summary":"s","blocker":"question pending","signal":"needs-you"}]}');
    M.renderHealthTldrLane();
    const lane = doc.byId("health-tldr-lane");
    expect(lane.attributes.hidden).toBeUndefined();
    expect(textOf(lane)).toContain("needs you");
    expect(findClass(lane, "tldr-chip")).toBeTruthy();
    M.state.snap = snapWithHeartbeat(null);
    M.renderHealthTldrLane();
    expect(doc.byId("health-tldr-lane").attributes.hidden).toBeDefined(); // state C, no placeholder
  });
});
```

(`setupRailDom`, `snapWithHeartbeat`, `textOf`, `findClass` are written into `tests/helpers/fake-dom.ts` in this task — concrete fake-node builders following the b2 `makeNode` pattern, plus a registry `doc.byId`.)

- [ ] **Step 2:** Run → FAIL. **Step 3: Implement:**
  - `index.html`: inside `#health-widgets`, add the two static children; move the `.rail-header` children (`Summary` span, `#scan-window`, `#cleanup-status`, `#customize-summary`) into `div.stack-head`; delete the now-empty `.rail-header` and the whole `section#heartbeat-tldr` (107–119).
  - `app.js` `renderHealthRail`: replace `widgets.textContent = ""` (3817) with `grid.textContent = ""` targeting `#readings-grid`; append calm line / widgets to the grid; keep signature machinery; call `renderHealthTldrLane()` where `renderHeartbeatTldr()` was called (3835), and add to the signature: envelope raw hash, `state.tldrView`, staleness bucket (Task 8 consumes these — wire the fields now, values default).
  - `app.js` `renderHeartbeatTldr` → rename/rewrite as `renderHealthTldrLane()` targeting `#health-tldr-lane`: state A head (TL;DR pill, mono time, meta, pager span skeleton), fleet prose = `tldrMarkupNodes(parsed.fleet || fleetFallbackLine(...))` (import from `./tldr-markup.js`), chip strip from envelope repos + `+N quiet` from unmentioned `snap.programs`; state C sets `lane.hidden = true` and clears content. Reuse `heartbeatTldrAgent`, `tldrCardSignalClass` untouched.
  - `styles.css`: port the mockup's lane/readings/chip/pager/stack-head rules (mockup-v2.html:47–170) into the rail section using the same custom properties; delete the standalone container rules (`.heartbeat-tldr` 353–366, `-head/-time/-meta` 367–395, `-grid` 397–404, `-legacy/-text` 523–532, `.tldr-card` shell 406–433, `.tldr-card-head` 434–439, `.tldr-card-summary` 466–475, `.tldr-card-deterministic` 490–501, `.tldr-det-empty` 521) — keep `.heartbeat-tldr-label`, `.tldr-card-repo`, `.tldr-card-signal`, `.tldr-card-blocker`, `.tldr-det-pill` (all reused by the lane). Run the orphan-CSS guard (`grep -rn "orphan" tests/` to locate it) and satisfy it.
- [ ] **Step 4:** Run new tests → PASS. Full `bun test`; fix **only** assertions this diff broke in `tests/web-client.test.ts` (expected: `:3392` mobile `.rail-inner .reading` rule string — update to the new compact rule; check `:3347` id list still true since ids moved but survive; re-check `:13442` regex extraction). Record every web-client edit line in the lane report.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): fold TL;DR lane into health rail — static two-child ribbon, states A/C" -- src/web/index.html src/web/app.js src/web/styles.css tests/health-rail-v2.test.ts tests/helpers/fake-dom.ts tests/web-client.test.ts`

---

### Task 7: Repo view + re-scoped readings + non-redundancy (fenced: app.js, styles.css)

**Files:** Modify `src/web/app.js` (lane renderer + `renderHealthRail` readings path), `src/web/styles.css` (scope-pill, det-row rules from mockup). Test: `tests/health-rail-v2.test.ts`.

**Interfaces:**
- Produces: `state.tldrView` (`"ALL"` | repo name; loaded from `TLDR_VIEW_KEY` beside `app.js:1780-1787`, saved on change, vanished repo → `"ALL"` at paint). Repo view body = prose (mini-markup) + det row from `deterministicRepoStats` (blocker chip with age, branch, sha `.is-secondary`, dirty, PRs, roster `.is-secondary`). Readings re-scope: `stack-head` gains mono `scope-pill`; Momentum/Context derive from the selected program's agents; **Burn renders `—` with sublabel `fleet-wide only`** (no invented attribution); Health shows the repo's blocked/needs-you verdict.

- [ ] **Step 1: Failing tests:**

```ts
describe("repo-specific view", () => {
  test("repo view renders prose + det pills and NEVER momentum/burn/context values in the lane", () => {
    const { doc, M } = setupRailDom();
    M.state.snap = repoSnapFixture();            // program with branch main, dirty, 1 PR, 2w+1b
    M.state.tldrView = "the-mountain-main";
    M.renderHealthTldrLane();
    const lane = doc.byId("health-tldr-lane");
    const text = textOf(lane);
    expect(text).toContain("main");              // branch pill
    expect(text).toContain("1 PR");
    expect(text).not.toMatch(/\/min/);           // non-redundancy: no momentum/burn units
    expect(text).not.toMatch(/\bavg window\b/);  // no context reading
  });

  test("readings re-scope to the repo and Burn falls back honestly", () => {
    const { doc, M } = setupRailDom();
    M.state.snap = repoSnapFixture();
    M.state.tldrView = "the-mountain-main";
    M.renderHealthRail();
    const stack = findClass(doc.byId("health-widgets"), "readings-stack");
    expect(textOf(findClass(stack, "scope-pill"))).toBe("the-mountain-main");
    const burnCell = readingCell(stack, "Burn");
    expect(textOf(burnCell)).toContain("—");
    expect(textOf(burnCell)).toContain("fleet-wide only");
  });

  test("persisted view survives repaint; vanished repo falls back to ALL", () => {
    const { doc, M } = setupRailDom();
    M.state.snap = repoSnapFixture();
    M.state.tldrView = "the-mountain-main";
    M.renderHealthRail(); M.renderHealthRail();  // signature repaint
    expect(M.state.tldrView).toBe("the-mountain-main");
    M.state.snap = snapWithoutRepo("the-mountain-main");
    M.renderHealthTldrLane();
    expect(M.state.tldrView).toBe("ALL");
  });
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement per the interface block (load/save mirrors `WIDGET_STORAGE_KEY` handling at `app.js:1780-1787`; repo-scoped momentum = working count over the scan window from the program's agents, context = mean of agent context pressure via `contextPressureOf`; keep every derivation in one `repoScopedReadings(program)` helper exported for tests). **Step 4:** PASS + full gate (fix only self-broken web-client assertions, if any). **Step 5: Commit** — `git commit -m "feat(web): repo-specific TL;DR view — re-scoped readings, honest Burn fallback, persisted view" -- src/web/app.js src/web/styles.css tests/health-rail-v2.test.ts tests/helpers/fake-dom.ts`

---

### Task 8: Pager, chips, attention order, staleness (fenced: app.js, styles.css)

**Files:** Modify `src/web/app.js`, `src/web/styles.css`. Test: `tests/health-rail-v2.test.ts`.

**Interfaces:**
- Produces: `tldrRepoOrder(repos)` — sort by signal rank (`needs-you/blocked/failed` → 0, `working/ok` → 2, `idle/all-clear` → 3), tie-break live count desc — exported on TheAntHill; chevron `›` from ALL lands on `tldrRepoOrder(...)[0]`. Chips are `<button class="tldr-chip">` jump targets. `HEARTBEAT_STALE_MS = 7 * 60 * 1000`; stale ⇒ time el gains `.is-frozen`, lane gains `.is-stale` (rail greys via CSS), content still renders. **No view yanking:** view changes only via pager/chips/vanish-fallback — never by data updates.

- [ ] **Step 1: Failing tests:**

```ts
describe("pager + attention + staleness", () => {
  test("attention order puts needs-you first; chevron target from ALL is that repo", () => {
    const M = (globalThis as any).TheAntHill;
    const order = M.tldrRepoOrder([
      { repo: "quiet", signal: "idle" }, { repo: "busy", signal: "working" },
      { repo: "hot", signal: "needs-you" }]);
    expect(order.map((r: any) => r.repo)).toEqual(["hot", "busy", "quiet"]);
  });

  test("clicking a chip jumps to that repo view; incoming data never yanks the view", () => {
    const { doc, M } = setupRailDom();
    M.state.snap = twoRepoSnapFixture();         // repoA ok, repoB ok
    M.state.tldrView = "ALL";
    M.renderHealthTldrLane();
    fireClick(findChip(doc, "repoB"));
    expect(M.state.tldrView).toBe("repoB");
    M.state.snap = twoRepoSnapFixture({ repoA: "needs-you" }); // alert elsewhere
    M.renderHealthTldrLane();
    expect(M.state.tldrView).toBe("repoB");       // parked view holds
  });

  test("a heartbeat older than 7m marks the lane stale but keeps the story", () => {
    const { doc, M } = setupRailDom();
    M.state.snap = snapWithHeartbeat(v4Envelope(), { updatedAt: new Date(Date.now() - 8 * 60_000).toISOString() });
    M.renderHealthTldrLane();
    const lane = doc.byId("health-tldr-lane");
    expect(lane.classList.contains("is-stale")).toBe(true);
    expect(textOf(lane)).toContain("needs you");  // last story still rendered
  });
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement helpers + wire pager buttons (`‹ ›`, `lane-pos` `aria-live=polite` = the single announcement region — do not add others; `#cleanup-status` unaffected); staleness bucket joins the paint signature from Task 6. CSS: `.health-tldr-lane.is-stale{border-left-color:var(--line-strong)}` + `.is-frozen` reuse. **Step 4:** PASS + full gate. **Step 5: Commit** — `git commit -m "feat(web): TL;DR pager — attention-ordered chevrons, chip jumps, staleness marking" -- src/web/app.js src/web/styles.css tests/health-rail-v2.test.ts tests/helpers/fake-dom.ts`

---

### Task 9: Mix + Spend widgets (fenced: app.js; plus client-catalogs.js)

**Files:** Modify `src/web/client-catalogs.js:197-222` (catalog entries), `src/web/app.js:987+` (`summaryWidgetData` branches), `src/web/styles.css` (`.mix-row/.mix-seg/.prov-dot` from mockup). Test: `tests/health-rail-v2.test.ts`.

**Interfaces:**
- Produces: catalog entries `{ id: "mix", label: "Mix" }`, `{ id: "spend", label: "Spend" }` (NOT added to `DEFAULT_WIDGET_IDS` — opt-in via customizer). `summaryWidgetData("mix", …)` → provider counts from `snap.programs[].agents[].provider` (labels via `providerLabel`, `text-formatters.js:95`), sublabel = top models via `modelShort`; `summaryWidgetData("spend", …)` → reuses `snap.pulse.burn` cost fields exactly as the burn branch does (`costLastHourUsd`, `costIsFloor` → `≥$`, `costProvenance`, `costAsOf`) — **no new server work, no window-total invention**; absent cost → `noDataWidget` path.

- [ ] **Step 1: Failing tests:**

```ts
describe("mix and spend widgets", () => {
  test("mix counts sessions per provider and lists top models", () => {
    const M = (globalThis as any).TheAntHill;
    const data = M.summaryWidgetData("mix", mixSnapFixture(), "live", "percent", [], false, "");
    expect(data.value).toContain("6");        // claude count
    expect(data.sublabel).toMatch(/×\d/);     // model counts present
  });
  test("spend renders provenance-honest cost and never fabricates $0", () => {
    const M = (globalThis as any).TheAntHill;
    const known = M.summaryWidgetData("spend", burnSnapFixture({ costLastHourUsd: 18.4, costIsFloor: true }), "live", "percent", [], false, "");
    expect(known.value).toContain("≥$18.40");
    const unknown = M.summaryWidgetData("spend", burnSnapFixture({ costProvenance: "unavailable", costLastHourUsd: null }), "live", "percent", [], false, "");
    expect(unknown.value).not.toContain("$0");
  });
  test("customizer offers mix/spend without changing default layout", async () => {
    const { WIDGET_CATALOG, DEFAULT_WIDGET_IDS } = await import("../src/web/client-catalogs.js");
    expect(WIDGET_CATALOG.map((w: any) => w.id)).toContain("mix");
    expect(WIDGET_CATALOG.map((w: any) => w.id)).toContain("spend");
    expect(DEFAULT_WIDGET_IDS).not.toContain("mix");
    expect(DEFAULT_WIDGET_IDS).not.toContain("spend");
  });
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (catalog entries land in the SAME commit as the data branches so the customizer never offers a widget that cannot render; `renderSummaryWidget` `app.js:2537` is generic — verify the mix value renders through its normal path, with the provider-dot row built in the widget data's `sublabelNodes`-equivalent or as a plain text value if the generic path only takes strings — read `renderSummaryWidget` first and keep to its existing contract). **Step 4:** PASS + full gate. **Step 5: Commit** — `git commit -m "feat(web): Mix and Spend summary widgets (opt-in via customizer)" -- src/web/client-catalogs.js src/web/app.js src/web/styles.css tests/health-rail-v2.test.ts tests/helpers/fake-dom.ts`

---

### Task 10: Render evidence + full gate + fence close

**Files:** none (evidence + report only).

- [ ] **Step 1:** Full verification battery:

```bash
bunx tsc --noEmit
bun test 2>&1 | tail -3          # compare counts to Task 0 baseline — no new reds
git diff --check chore/docker-local-ci..HEAD
```

- [ ] **Step 2:** Launch the app from the worktree (use the `run` skill / project launch pattern; a spare port, NOT the live 4701 board) and capture pixel evidence with /browse at **1440×1000** and **860×1200**, states A, B (chevron once), and C (empty-envelope fixture or quiet board):

```js
// /browse eval snippet — geometry proof mirroring the mockup's checks
const rail = document.querySelector('#health-widgets');
const [lane, stack] = rail.children;
({ children: rail.children.length,
   lane: lane.className, stack: stack.className,
   ratios: [lane.offsetWidth / rail.offsetWidth, stack.offsetWidth / rail.offsetWidth],
   sameTop: Math.abs(lane.getBoundingClientRect().top - stack.getBoundingClientRect().top) <= 1 })
```

Expected: `children: 2`, lane first, ratios ≈ [0.60, 0.40] (0.56–0.64 / 0.36–0.44), `sameTop: true`, at both widths. Save screenshots as `/tmp/health-rail-v2-<sha>-1440.png` and `-860.png`. **Do not reuse old evidence filenames.**

- [ ] **Step 3:** Update the lane report with: baseline vs final test counts, every `tests/web-client.test.ts` line touched, evidence paths + measured ratios, fence-held window (open/close SHAs), and the writer-loop restart note from Task 4.
- [ ] **Step 4:** Kill only the server process this lane started (by recorded PID, never by port). Fence closes at this commit.

---

## Integration manifest

**Touched-path forecast (commit order):**

| # | Commit | Paths | Fence |
|---|---|---|---|
| 1 | server tail backstop (P1) | `src/server/{types,prime,collectors,snapshot}.ts`, `tests/{health-rail-v2-server,b2-render-proof}.test.ts` | no |
| 2 | mini-markup module (P2) | `src/web/tldr-markup.js`, `tests/helpers/fake-dom.ts`, `tests/health-rail-v2-markup.test.ts` | no |
| 3 | view key (P3) | `src/web/client-catalogs.js`, `tests/health-rail-v2-catalog.test.ts` | no |
| 4 | writer guidance v4 (P4) | `.prime/agent/skills/ant-hill-orchestrator/references/heartbeat-tldr.md`, `.prime/agent/ant-hill-heartbeat-fallback.sh` | no |
| 5 | parser v4 | `src/web/app.js`, `tests/health-rail-v2.test.ts` | **yes** |
| 6 | ribbon fold-in A/C | `src/web/index.html`, `src/web/app.js`, `src/web/styles.css`, `tests/{health-rail-v2,web-client}.test.ts`, `tests/helpers/fake-dom.ts` | **yes** |
| 7 | repo view | `src/web/app.js`, `src/web/styles.css`, `tests/health-rail-v2.test.ts` | **yes** |
| 8 | pager/staleness | `src/web/app.js`, `src/web/styles.css`, `tests/health-rail-v2.test.ts` | **yes** |
| 9 | mix/spend | `src/web/client-catalogs.js`, `src/web/app.js`, `src/web/styles.css`, `tests/health-rail-v2.test.ts` | **yes** |

**Integration protocol:** rebase `feat/health-rail-tldr-v2` onto the `chore/docker-local-ci` tip immediately before landing (forward-only; conflicts in `tests/web-client.test.ts` and `src/server/snapshot.ts` resolve by keeping both sides — Task Widget lane's `rawTask`/`refinedTask` edits are orthogonal to the tail-cap lines at 586–588); re-run the full gate post-rebase; land with path-scoped commits; never amend even your own tip. Rollback = `git revert` of the offending commit (each task is one).

**Known conflict surfaces:** `snapshot.ts` (Task Widget lane, uncommitted), `tests/b2-render-proof.test.ts` + `tests/web-client.test.ts` (modified on the integration branch), `styles.css`/`app.js` (fenced — held solely during Tasks 5–10). `transcript.js`: untouched by design.

## Handoff

- **Spec:** `docs/superpowers/specs/2026-08-09-health-rail-tldr-v2-design.md` (approved; c96dc86 lineage)
- **Visual truth:** `docs/rhs-shots/health-rail-tldr-fold-in/mockup-v2.html` — open at 1440/860; in-page checks must print `data-check="pass"`
- **This plan** is independently executable from Task 0; every anchor was verified against `chore/docker-local-ci` at `6678e65` on 2026-08-09 — re-verify anchors with the greps cited above if the tip has moved.

## One remaining owner decision

**Fence scheduling:** when Tasks 5–10 may hold the `app.js` / `styles.css` / `web-client.test.ts` serial fence relative to the in-flight Task Widget lane (uncommitted `snapshot.ts`/`presentation.js` work) and the Chat UX lane (surface 26) — i.e., which lane lands first. In plain terms: three jobs edit the same shared files and only one can hold them at a time — pick the order. **Recommended order: Task Widget lands first** (its work is already half-staged; going first means nobody rebases over it), **then Chat, then this plan's Phase 2 last**. Phase 1 (Tasks 0–4, four parallel lanes) can start immediately regardless of the choice.
