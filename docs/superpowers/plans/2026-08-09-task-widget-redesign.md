# Task Widget Redesign (RHS Expanded Panel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One fixed, scannable anatomy for the drawer's Task widget — title row, refined OBJECTIVE, parsed META line, raw envelope behind a closed "Full brief" disclosure — identical for all six providers regardless of envelope shape.

**Architecture:** A pure envelope parser (`parseTaskEnvelope`) joins the other pure view functions in `src/web/presentation.js`; `_taskBlock` in `renderAgentDrawer` (app.js ~9400) consumes it to build one DOM. One small additive server change: `snapshot.ts` currently *overwrites* `task` with the refined sidecar (snapshot.ts:507), so the raw envelope never reaches the client — we publish it alongside as `rawTask` when (and only when) the sidecar replaced it. Presence of `rawTask` is also the client's signal that `task` is refined.

**Tech Stack:** Bun (server + tests), plain-JS web client (no framework), strict-CSP CSS (no inline styles — classes only).

## Global Constraints

- Type scale: 22/14/13/12/11/10 px only. OBJECTIVE is 13px/1.5 UI ink; META is 12px mono; section titles stay 800 11px mono caps.
- Existing design tokens only (`--ink`, `--muted`, `--faint-strong`, `--line`, `--raise`, `--font-mono`, …). No new hex values.
- Strict CSP: `style-src 'self'` — never set a `style` attribute in JS; everything is a class.
- One DOM for all six providers. Differences come from data presence (empty objective, absent meta, absent brief), never `if (provider === …)` branches.
- The widget keeps its 25% column cap (`.drawer-doc .drawer-chat-task`, styles.css tail media query ≥861px). Internal scrolling happens ONLY inside the open "Full brief" disclosure.
- styles.css has an orphan lint that reads sources as text: every classname removed from app.js must have its CSS rule removed, and every new classname must be a whole literal in both files (no runtime-built names).
- Shared worktree: commit with `git commit -m "…" -- <paths>` (never `git add` + bare commit — it sweeps other lanes' staged work). Forward-only; never amend. Branch is `chore/docker-local-ci`; stay on it.
- Gate: `bunx tsc --noEmit` clean; `tests/web-client.test.ts` and `tests/cwd-adversarial.test.ts` green; full-suite failure count unchanged from the Task 1 baseline (~14 pre-existing, all in files this plan never touches).
- Browser work uses the `/browse` skill only — never `mcp__claude-in-chrome__*` tools.

---

### Task 1: Baseline capture (tests + "before" screenshots)

**Files:**
- Create: `docs/rhs-shots/task-widget/BASELINE.md`
- Create: `docs/rhs-shots/task-widget/before-<n>.png` (5 shots)

**Interfaces:**
- Produces: the pre-change full-suite failure count and file list that Task 6 compares against, and the "before" half of the screenshot pair the spec's stop condition requires.

- [ ] **Step 1: Record the full-suite baseline**

Run:
```bash
cd /Users/emilionunezgarcia/Developer/the-mountain-main
bun test 2>&1 | tail -20
```
Record in `docs/rhs-shots/task-widget/BASELINE.md`: total pass/fail counts and the names of every failing test file. Expect ~14 pre-existing failures. Do NOT try to fix any of them.

- [ ] **Step 2: Confirm the live server serves THIS checkout**

```bash
curl -s http://127.0.0.1:4701/ >/dev/null && echo up
lsof -nP -iTCP:4701 -sTCP:LISTEN
ps -o command= -p <pid-from-lsof>
```
If the serving process's cwd/entry is not `/Users/emilionunezgarcia/Developer/the-mountain-main`, note the actual root in BASELINE.md — Task 6 will need to restart the launchctl service after edits land (`launchctl list | grep -i ant` to find the label, then `launchctl kickstart -k gui/$(id -u)/<label>`). Never kill by port; if a restart is needed, use launchctl.

- [ ] **Step 3: Capture "before" screenshots of five differently-shaped tasks**

Use the `/browse` skill against `http://127.0.0.1:4701`. Open the drawer for five live agents whose Task blocks look visibly different (hunt for: a handoff dump with `Date:/From:/To:` headers, an `<image name=…>` placeholder task, an empty/bare task, a long kickoff, a plain one-liner). Save each drawer screenshot as `docs/rhs-shots/task-widget/before-1.png` … `before-5.png` and note in BASELINE.md which agent id/shape each shows.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(task-widget): baseline failures + before shots [task-widget]" -- docs/rhs-shots/task-widget
```

---

### Task 2: `parseTaskEnvelope` — pure parser + five-shape tests

**Files:**
- Modify: `src/web/presentation.js` (add export next to `withoutSenderHeader`, ~line 728)
- Create: `tests/task-envelope.test.ts`

**Interfaces:**
- Consumes: `withoutSenderHeader(text)` (same file, presentation.js:722) — strips the `[from <agent> run <id>]`-style sender header, returns the body, or `""` for non-strings.
- Produces: `parseTaskEnvelope(raw: string) → { objective: string, meta: { date?, from?, to?, branch?, run? } }`. `objective` is the first sentence of the envelope's prose (≤200 chars, `""` when no prose exists). `meta` holds only fields actually present in a leading `Header: value` block. Task 4 renders exactly this contract.

- [ ] **Step 1: Write the failing tests — the five spec shapes**

Create `tests/task-envelope.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

const P = await import("../src/web/presentation.js");
const parse = (P as { parseTaskEnvelope: (raw: unknown) => { objective: string; meta: Record<string, string> } }).parseTaskEnvelope;

describe("parseTaskEnvelope — one anatomy from five envelope shapes", () => {
  test("kickoff prose: objective is the first sentence, no meta invented", () => {
    const raw = "Redesign the filter bar so tab counts follow the working set. Then wire the aria-live region. Details in the plan doc.";
    const out = parse(raw);
    expect(out.objective).toBe("Redesign the filter bar so tab counts follow the working set.");
    expect(out.meta).toEqual({});
  });

  test("handoff dump: headers land in meta, objective is the body's first sentence, hex ids stay out of the face", () => {
    const raw = [
      "[from orchestrator-1 run 578d9487-dceb-4034-b4f1-97a74ae247fd]",
      "Date: 2026-08-09",
      "From: orchestrator-1",
      "To: lane-fe-2",
      "Branch: chore/docker-local-ci",
      "Run: claude_578d9487-dceb-4034-b4f1-97a74ae247fd",
      "",
      "Take over the drawer task widget. Keep the 25% cap intact.",
    ].join("\n");
    const out = parse(raw);
    expect(out.objective).toBe("Take over the drawer task widget.");
    expect(out.meta).toEqual({
      date: "2026-08-09",
      from: "orchestrator-1",
      to: "lane-fe-2",
      branch: "chore/docker-local-ci",
      run: "claude_578d9487-dceb-4034-b4f1-97a74ae247fd",
    });
    expect(out.objective).not.toMatch(/[0-9a-f]{8}-/);
  });

  test("image-placeholder task: placeholders are not prose, objective is honestly empty", () => {
    const out = parse('<image name="shot-1440.png"> <image name="shot-390.png">');
    expect(out.objective).toBe("");
    expect(out.meta).toEqual({});
  });

  test("empty task: empty in, empty out — never a crash, never invented text", () => {
    expect(parse("")).toEqual({ objective: "", meta: {} });
    expect(parse(undefined)).toEqual({ objective: "", meta: {} });
  });

  test("plain one-liner without terminal punctuation: the whole line is the objective", () => {
    const out = parse("fix the flaky cursor collector");
    expect(out.objective).toBe("fix the flaky cursor collector");
    expect(out.meta).toEqual({});
  });
});
```

- [ ] **Step 2: Run to verify the tests fail**

Run: `bun test tests/task-envelope.test.ts`
Expected: FAIL — `parseTaskEnvelope is not a function`.

- [ ] **Step 3: Implement the parser in presentation.js**

Add directly below `withoutSenderHeader` (so the two envelope readers live together):

```js
/* One anatomy from any envelope. Handoff dumps open with a Header: value
   block (Date:/From:/To:/Branch:/Run:); the face of the Task widget shows
   prose only, so the block is lifted into `meta`, <image …> placeholders are
   dropped, and `objective` is the first sentence of what remains. Empty in,
   empty out — the widget renders the honest "— no task recorded" itself. */
const ENVELOPE_HEADER = /^(date|from|to|branch|run):\s*(.*)$/i;

export function parseTaskEnvelope(raw) {
  const text = withoutSenderHeader(typeof raw === "string" ? raw : "").trim();
  const meta = {};
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i += 1; continue; }
    const match = ENVELOPE_HEADER.exec(line);
    if (!match) break;
    meta[match[1].toLowerCase()] = match[2].trim();
    i += 1;
  }
  const prose = lines.slice(i).join("\n")
    .replace(/<image\b[^>]*>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  let objective = "";
  if (prose) {
    const sentence = /^(.*?[.!?])(?:\s|$)/.exec(prose);
    objective = (sentence ? sentence[1] : prose).slice(0, 200).trim();
  }
  return { objective, meta };
}
```

- [ ] **Step 4: Run to verify all five pass**

Run: `bun test tests/task-envelope.test.ts`
Expected: 5 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(task-widget): parseTaskEnvelope — pure envelope parser, 5 shapes [task-widget]" -- src/web/presentation.js tests/task-envelope.test.ts
```

---

### Task 3: Server — publish `rawTask` alongside the refined sidecar

**Files:**
- Modify: `src/shared/types.ts:363` (inside `interface AgentSnapshot`, next to `task?: string;`)
- Modify: `src/server/snapshot.ts:507`
- Create: `tests/refined-task-publish.test.ts`

**Interfaces:**
- Consumes: existing sidecar read in `buildSnapshot` (snapshot.ts:493-507): reads `data/task-summaries/<id-with-:/\ replaced by _>.txt`, slices to 120 chars, and — today — replaces `task` wholesale, losing the raw envelope.
- Produces: `AgentSnapshot.rawTask?: string` — present ONLY when a sidecar replaced `task`. Task 4 relies on both halves of that contract: `rawTask` is the envelope for META + Full brief, and its presence means `agent.task` is already refined prose.

Why this and not a client-only change: without it, sidecar-refined agents can never show their raw envelope (the server discarded it), and the client cannot tell refined from raw. Additive optional field, zero change for agents without sidecars.

- [ ] **Step 1: Write the failing test**

Create `tests/refined-task-publish.test.ts`. Model the fixture on `tests/active-time.test.ts:133-154` (minimal `CollectedAgent` + `buildSnapshot`):

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSnapshot } from "../src/server/snapshot";
import type { ArchiveStore } from "../src/server/archive";
import type { CollectedAgent } from "../src/server/types";

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
const RAW = "Date: 2026-08-09\nFrom: orchestrator-1\nTo: lane-fe-2\n\nTake over the drawer task widget. Keep the 25% cap intact.";
const REFINED = "Redesigning the drawer Task widget";

const agent = (overrides: Partial<CollectedAgent>): CollectedAgent => ({
  id: "claude:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  provider: "claude",
  sourceSessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  displayName: "Lane FE-2",
  cwd: "/Users/me/project",
  status: "running",
  statusReason: "Fixture activity.",
  updatedAt: new Date().toISOString(),
  tokens: { provenance: "unknown" },
  artifacts: [],
  gates: [],
  ...overrides,
});

const rowFor = (source: CollectedAgent, taskSummaryRoot?: string) =>
  buildSnapshot({ agents: [source], surfaces: [], archiveStore, now: new Date(), ...(taskSummaryRoot ? { taskSummaryRoot } : {}) })
    .programs.flatMap((program) => program.agents)
    .find((row) => row.id === source.id);

describe("refined sidecar publishes the raw envelope it replaced", () => {
  let root: string | undefined;
  afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = undefined; });

  test("sidecar landed: task is the refined text AND rawTask carries the envelope", () => {
    root = mkdtempSync(join(tmpdir(), "task-summaries-"));
    writeFileSync(join(root, "claude_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.txt"), REFINED);
    const row = rowFor(agent({ task: RAW }), root);
    expect(row?.task).toBe(REFINED);
    expect(row?.rawTask).toBe(RAW);
  });

  test("no sidecar: task is the raw envelope and rawTask is absent — presence IS the refinement signal", () => {
    const row = rowFor(agent({ task: RAW }));
    expect(row?.task).toBe(RAW);
    expect(row?.rawTask).toBeUndefined();
  });

  test("sidecar but the source never had a task: no phantom rawTask", () => {
    root = mkdtempSync(join(tmpdir(), "task-summaries-"));
    writeFileSync(join(root, "claude_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.txt"), REFINED);
    const row = rowFor(agent({}), root);
    expect(row?.task).toBe(REFINED);
    expect(row?.rawTask).toBeUndefined();
  });
});
```

Note: check `SnapshotInput` (snapshot.ts:92) for the exact `taskSummaryRoot` field name and `ArchiveStore` import path (copy whatever `tests/active-time.test.ts` imports); adjust the fixture if `buildSnapshot` requires more input fields — copy them from that file, don't invent.

- [ ] **Step 2: Run to verify the new assertions fail**

Run: `bun test tests/refined-task-publish.test.ts`
Expected: FAIL — `rawTask` does not exist / is undefined in the sidecar case (first test), others may already pass.

- [ ] **Step 3: Add the field to the snapshot type**

In `src/shared/types.ts`, inside `interface AgentSnapshot` (line ~346), directly under `task?: string;` (line 363):

```ts
/** The provider's original task envelope, published only when a refined
    sidecar summary replaced `task`. Presence is the client's signal that
    `task` is refined prose; the drawer's Full brief renders this. */
rawTask?: string;
```

- [ ] **Step 4: Publish it in buildSnapshot**

In `src/server/snapshot.ts:507`, change:

```ts
...(refinedTask ? { task: refinedTask } : {}),
```
to:
```ts
...(refinedTask
  ? { task: refinedTask, ...(publishable.task ? { rawTask: publishable.task } : {}) }
  : {}),
```

- [ ] **Step 5: Run tests + typecheck**

Run: `bun test tests/refined-task-publish.test.ts && bunx tsc --noEmit`
Expected: 3 pass; tsc clean.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(snapshot): publish rawTask when refined sidecar replaces task [task-widget]" -- src/shared/types.ts src/server/snapshot.ts tests/refined-task-publish.test.ts
```

---

### Task 4: Widget DOM — one anatomy in `_taskBlock`

**Files:**
- Modify: `src/web/app.js:9396-9410` (`_taskBlock` inside `renderAgentDrawer`)
- Modify: `src/web/app.js:1447` import block (add `parseTaskEnvelope`)

**Interfaces:**
- Consumes: `parseTaskEnvelope(raw)` → `{ objective, meta: { date?, from?, to?, branch?, run? } }` (Task 2); `agent.rawTask` presence = `agent.task` is refined (Task 3); existing `el()`, `icon()`, `roleView()`, `withoutSenderHeader()` helpers; `el()` skips `null` children (see app.js:9391 for the pattern).
- Produces: classnames Task 5 styles: `drawer-task-objective` (+ `is-empty`), `drawer-task-meta`, `drawer-task-brief`, `drawer-task-brief-summary`, `drawer-task-brief-body`. Removes usage of `drawer-task-full` and `drawer-chat-task is-bare`.

- [ ] **Step 1: Add `parseTaskEnvelope` to the presentation.js import list**

In the destructured import block around `src/web/app.js:1447`, add `parseTaskEnvelope` alongside `withoutSenderHeader` (alphabetical-ish placement matching neighbors).

- [ ] **Step 2: Replace the `_taskBlock` construction**

Replace app.js lines 9397-9409 (from `const _roleView = …` through the `is-bare` branch; KEEP the CSP comment at 9399-9401) with:

```js
  const _roleView = roleView(agent.role);
  /* One anatomy for every provider: title row → OBJECTIVE (prose only) →
     META (only fields actually parsed) → the raw envelope folded behind
     "Full brief". Differences come from data presence, never per-harness
     branches. `rawTask` present means the refined sidecar landed and
     `agent.task` is already the objective; otherwise the objective is the
     first sentence the parser finds in the envelope. */
  const fullTask = String(agent.rawTask || agent.task || "").trim();
  const _parsedTask = parseTaskEnvelope(fullTask);
  const _objective = agent.rawTask
    ? withoutSenderHeader(String(agent.task || "")).trim()
    : _parsedTask.objective;
  const _metaBits = [];
  if (_parsedTask.meta.from || _parsedTask.meta.to)
    _metaBits.push([_parsedTask.meta.from, _parsedTask.meta.to].filter(Boolean).join(" → "));
  if (_parsedTask.meta.date) _metaBits.push(_parsedTask.meta.date);
  if (_parsedTask.meta.branch) _metaBits.push(_parsedTask.meta.branch);
  const _showBrief = Boolean(fullTask) && fullTask !== _objective;
  const _taskBlock = el("div", { class: "drawer-chat-task" },
    el("div", { class: "drawer-task-head" },
      el("h3", { class: "section-title" }, icon("file-text", { label: "" }), "Task", el("span", { class: "rule", "aria-hidden": "true" })),
      el("span", { class: "badge drawer-role-badge role-" + _roleView.key }, _roleView.label)),
    _objective
      ? el("p", { class: "drawer-task-objective", text: _objective })
      : el("p", { class: "drawer-task-objective is-empty", title: "No prose task was recorded for this lane", text: "— no task recorded" }),
    _metaBits.length ? el("p", { class: "drawer-task-meta", text: _metaBits.join(" · ") }) : null,
    _showBrief
      ? el("details", { class: "drawer-task-brief" },
          el("summary", { class: "drawer-task-brief-summary" }, "Full brief"),
          el("pre", { class: "drawer-task-brief-body", text: fullTask }))
      : null);
```

Line 9410 (`renderChat(agent, state, { taskCarried: Boolean(fullTask) })`) keeps working unchanged — `fullTask` still means "this agent has a task".

- [ ] **Step 3: Verify no other reader of the removed classnames**

Run: `grep -rn "drawer-task-full\|is-bare" src/web/*.js tests/*.ts`
Expected: no hits left in JS (CSS cleanup is Task 5). If a test hits, update it to the new classnames — do not keep both DOMs.

- [ ] **Step 4: Typecheck + targeted tests**

Run: `bunx tsc --noEmit && bun test tests/web-client.test.ts tests/cwd-adversarial.test.ts`
Expected: clean / green (these suites load app.js headlessly; a syntax error or missing import fails here).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(drawer): Task widget — fixed anatomy: objective + meta + Full brief [task-widget]" -- src/web/app.js
```

---

### Task 5: CSS — anatomy styles, scroll discipline, orphan cleanup

**Files:**
- Modify: `src/web/styles.css:2271-2272` (base `.drawer-chat-task` + remove `.drawer-task-full`)
- Modify: `src/web/styles.css` tail — 65/35 integration layer (`.drawer-chat-task.is-bare` removal, 25%-cap rule, new anatomy rules)

**Interfaces:**
- Consumes: classnames from Task 4; tokens `--ink`, `--muted`, `--faint-strong`, `--line`, `--font-mono`; existing ≥861px cap rule `.drawer-doc .drawer-chat-task { flex: 0 1 auto; max-height: 25%; overflow-y: auto; }`.
- Produces: the finished visual anatomy; only the open disclosure body scrolls.

- [ ] **Step 1: Base rule — flex column, drop the dead prose rule**

At styles.css:2271, change `display: grid` to a flex column (grid can't let one variable row shrink-and-scroll):

```css
.drawer-chat-task { border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--raise); padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
```

Delete line 2272 (`.drawer-task-full { … }`) — Task 4 removed its only user, and the orphan lint reads sources as text.

- [ ] **Step 2: Integration layer — remove `is-bare`, retarget the cap's scroll**

In the tail integration layer, delete `.drawer-chat-task.is-bare { padding: 8px 0; }` (no longer emitted).

In the ≥861px media block, change:
```css
.drawer-doc .drawer-chat-task { flex: 0 1 auto; max-height: 25%; overflow-y: auto; }
```
to:
```css
.drawer-doc .drawer-chat-task { flex: 0 1 auto; max-height: 25%; overflow: hidden; }
```
(The cap stays; the scrollport moves into the disclosure body below.)

- [ ] **Step 3: Append the anatomy rules to the integration layer**

Add at the end of the integration layer (before the mini-chat-window block or after it — keep the layer's comment style):

```css
/* ---------- Task widget anatomy ----------
   Face shows prose only: OBJECTIVE (13px UI ink, clamped to two lines),
   META (12px mono, only parsed fields), and the raw envelope folded behind
   "Full brief" — the ONE scroller inside the widget. The widget itself is
   overflow:hidden under its 25% cap; the flex chain (details min-height:0 →
   body min-height:0) is what lets the body scroll instead of the widget. */
.drawer-task-objective { margin: 0; font-size: 13px; line-height: 1.5; color: var(--ink); overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.drawer-task-objective.is-empty { font-style: italic; color: var(--faint-strong); }
.drawer-task-meta { margin: 0; font: 500 12px/1.4 var(--font-mono); color: var(--muted); overflow-wrap: anywhere; }
.drawer-task-brief { min-height: 0; display: flex; flex-direction: column; }
.drawer-task-brief-summary { cursor: pointer; user-select: none; font: 800 11px/1 var(--font-mono); letter-spacing: 0.09em; text-transform: uppercase; color: var(--muted); list-style: none; flex: none; }
.drawer-task-brief-summary::-webkit-details-marker { display: none; }
.drawer-task-brief-summary:hover { color: var(--ink); }
.drawer-task-brief-body { margin: 6px 0 0; font: 400 12px/1.5 var(--font-mono); color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere; overflow-y: auto; min-height: 0; max-height: 18rem; }
```

(`max-height: 18rem` bounds the body in the <861px stacked layout where the widget has no 25% cap; under the cap, `min-height: 0` shrinks it further so the widget never grows a second scrollbar.)

- [ ] **Step 4: Verify sizes and orphans**

Run:
```bash
grep -n "drawer-task-full\|is-bare" src/web/styles.css        # expect: nothing
grep -rn "drawer-task-objective\|drawer-task-meta\|drawer-task-brief" src/web/app.js   # expect: every new CSS class emitted
bun test tests/web-client.test.ts tests/cwd-adversarial.test.ts
```
Expected: both greps consistent, suites green. Every font-size used is in {13, 12, 11, 10} ✓.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(drawer): Task widget anatomy CSS — clamp, meta, Full brief scrollport [task-widget]" -- src/web/styles.css
```

---

### Task 6: Full verification — suites, live render, "after" screenshots

**Files:**
- Create: `docs/rhs-shots/task-widget/after-<n>.png` (5 shots)
- Modify: `docs/rhs-shots/task-widget/BASELINE.md` (append the closing evidence)

**Interfaces:**
- Consumes: BASELINE.md failure list (Task 1); the served-checkout note from Task 1 Step 2.

- [ ] **Step 1: Gate — typecheck + named suites + full suite vs baseline**

```bash
bunx tsc --noEmit
bun test tests/task-envelope.test.ts tests/refined-task-publish.test.ts tests/web-client.test.ts tests/cwd-adversarial.test.ts
bun test 2>&1 | tail -20
```
Expected: tsc clean; named suites green; full-suite failing FILES identical to BASELINE.md (the ~14 pre-existing failures unchanged — compare file names, not just the count). Any NEW failing file is yours: fix before proceeding.

- [ ] **Step 2: Get the change live on 127.0.0.1:4701**

If Task 1 Step 2 found the server serving this checkout, a browser reload suffices for static web assets, but the server change (Task 3) needs a process restart:
```bash
launchctl list | grep -i ant     # find the label
launchctl kickstart -k gui/$(id -u)/<label>
curl -s http://127.0.0.1:4701/ >/dev/null && echo up
```
If it serves a DIFFERENT checkout, stop — report to Emilio which root it serves rather than deploying elsewhere; the stop condition needs the live board.

- [ ] **Step 3: Verify the anatomy on five live agents + "after" screenshots**

With `/browse` on `http://127.0.0.1:4701`, open the drawers of the same five agents (or equivalent shapes) from Task 1 Step 3 and check each against the spec:
- Title row: 800 11px mono caps + rule + role badge — unchanged.
- OBJECTIVE: 13px prose, max two lines, no `Date:`/`From:` headers, no hex ids, no `<image …>` placeholders on the face.
- META (when the envelope had headers): one 12px mono line, `from → to · date · branch`, only parsed fields.
- "Full brief" closed by default; opening it scrolls INSIDE the body (the widget and column do not grow — check the 25% cap holds at ≥861px).
- Empty task: italic "— no task recorded" with a title tooltip; same head, no brief.
- The DOM shape is identical across providers (devtools: same element sequence, differences are presence only).

Save `docs/rhs-shots/task-widget/after-1.png` … `after-5.png`. Append to BASELINE.md: agent → shape → pass/fail per check, plus the gate outputs from Step 1.

- [ ] **Step 4: Commit the evidence**

```bash
git commit -m "docs(task-widget): after shots + verification evidence [task-widget]" -- docs/rhs-shots/task-widget
```

---

## Self-review notes

- Spec coverage: anatomy (T4+T5), objective source order refined→first-sentence→honest-empty (T3+T4), handoff headers to META/fold (T2+T4), pure exported parser + five bun-tested shapes (T2), tokens + 6-size scale + 25% cap + disclosure-only scrolling (T5), one DOM (T4), stop condition — five live agents, before/after pair, tsc + web-client + cwd-adversarial with baseline unchanged (T1+T6).
- The one deliberate scope addition is `rawTask` (T3): without it the raw envelope is unrecoverable for sidecar-refined agents (snapshot.ts:507 discards it) and the client cannot honor the spec's source ordering. Additive optional field; fallback if Emilio objects is client-only parsing of `agent.task`, which loses the Full brief for refined agents.
- `fullTask !== _objective` gates the brief: a refined one-liner equal to its own face gets no disclosure — data presence, not a provider branch.
