# Ant Hill Body Restyle — Three-Workstream Implementation Plan (2026-07-22)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the "techno orchestra" design language of the new Pulse summary strip to the whole operator console body — restyled shell, a revamped right-hand inspector with the important information at the top of the totem pole, and a denser-but-calmer left-hand program/agent tree.

**Architecture:** Vanilla JS + hand-written CSS, no build step. The server (`src/server`) serves `src/web/{index.html,app.js,styles.css}` from disk; all UI is DOM built in `app.js` via `el()`. Three workstreams: **WS-A** (design language across the body), **WS-B** (inspector revamp + small BE contract), **WS-C** (left tree touch-up). Each runs as its own worktree lane branched from `main` **after** `feat/pulse-strip` lands (Gate G0).

**Tech Stack:** Bun (`bun run check` = tsc + tests), vanilla DOM, SVG-attribute meters (strict CSP — no inline styles), `@browse` for visual QA, `scripts/anthill-preview.sh` for throwaway previews.

## Global Constraints

- Strict CSP: never set inline `style`; meters/colors via SVG attributes and classes (e.g. `dw-provider--<provider>` pattern).
- Light scheme only (`<meta name="color-scheme" content="light">`); no dark variant work.
- Monospace (`--font-mono`) is reserved for identifiers, paths, timestamps, and token/cost values — never headings or prose.
- Indicator inks, not flood fills: status uses outline marks, colored text, and 2px left-edge signal rails (`--signal-rail`); no filled hospital banners.
- All full-width bands align to the shared frame: `--frame: min(1680px, calc(100vw - 64px))`.
- Inspector width stays `--inspector-w: clamp(480px, 32vw, 520px)` on desktop; full-surface drawer <1024px; 44px touch targets <1024px.
- `prefers-reduced-motion` must disable every animation added.
- `bun run check` green before every commit (no `.skip`, no filtered tests).
- No feature flags for visible UI changes (standing rule: dev mirrors prod).
- Never commit on `main`. Lanes: `ant-hill/luna-<lane>-20260722` branches in worktrees under `~/Developer/the-mountain-lanes/`. Land INTO `main` via merge, deploy with `scripts/anthill-deploy.sh`. Push only with Emilio's approval.
- Repo tests are string/regex-over-source intent tests; real layout proof is `@browse` screenshots at 1440×900, 1024, and 375 widths.

## Honesty note on granularity

`feat/pulse-strip` is mid-flight (±700-line uncommitted diff to the exact files this plan touches). Code blocks below define the **structural contract** (element order, class names, data shown); implementing lanes adapt them to the landed pulse code rather than pasting blind. Function-name anchors are stable; line numbers are not and are omitted on purpose.

---

## Coordination state (read before starting anything)

| Lane | Where | Status at plan time |
|---|---|---|
| `pulse-strip-fe` ultracode workflow | Fable 5 xhigh pane, cmux surface `C6989EB6-…`, worktree `~/Developer/anthill-pulse` (`feat/pulse-strip`) | RUNNING — Implement done, Tests in progress, Verify pending. Do not touch its worktree; do not type into its pane (workflow watcher has single-key bindings; `x` kills the run). |
| Pulse BE | Codex GPT-5.6-Luna MAX pane, cmux surface `E7DB370C-…`, same worktree | DONE, uncommitted — `PulseTracker`, `HubSnapshot.pulse`, report in `.pulse/BE_DONE.md`. Idle; reuse this pane for Task B1. |
| Prod | `:4701` ← launchd `ai.imaginethat.anthill` ← `~/Developer/the-mountain-main` on `main` (`e02e398`) | Serving; untouched by this plan until final landings. |

**Gate G0 (hard):** `feat/pulse-strip` is committed and merged into `main`. Every task below except A1, A2, and the baseline QA capture waits for G0 — the pulse diff rewrites `app.js`/`styles.css`/`index.html` and the server snapshot files; branching before G0 guarantees a three-way merge mess.

**Runs NOW (pre-G0, zero collision):**
1. Task A1 — codify the design language doc (new file, reads only).
2. Task A2 — Sonnet 5 (1M) body-vs-language audit (read-only report).
3. Baseline `@browse` screenshots of live `:4701` at 1440/1024/375 into `~/Developer/the-mountain-lanes/qa-baseline-20260722/` for before/after.

**Lane creation (after G0), one worktree per workstream:**
```bash
cd ~/Developer/the-mountain
git worktree add ~/Developer/the-mountain-lanes/luna-body-language -b ant-hill/luna-body-language-20260722 main
git worktree add ~/Developer/the-mountain-lanes/luna-inspector-totem -b ant-hill/luna-inspector-totem-20260722 main
git worktree add ~/Developer/the-mountain-lanes/luna-tree-glance -b ant-hill/luna-tree-glance-20260722 main
```
**Landing order (serial, each rebases on the previous):** WS-A → WS-B → WS-C. WS-A establishes the shared tokens/classes the other two consume; WS-B and WS-C implement against them.

## Model routing (Emilio's per-task override — supersedes the global "Fable for all subagents" rule for this program)

| Work | Model / vehicle |
|---|---|
| Orchestration judgment, gate reviews, integration merges | Fable 5 xhigh (this session or the Fable pane) — scarce, judgment only |
| A1 design-language codification, B2 inspector information architecture | Fable 5 xhigh (the two most intricate FE pieces) |
| A3–A6, B3–B4, C1–C3 implementation | Opus 4.8 workers |
| A2 audit, all test authoring (A/B/C test steps), final consistency sweep | Sonnet 5 (1M) — holds `app.js` + `styles.css` + diffs whole |
| B1 backend contract | Codex GPT-5.6-Luna MAX via existing cmux pane `E7DB370C-…` |

---

# WS-A — Design language: reshape the body to the header's vocabulary

### Task A1: Codify the design language (pre-G0, Fable 5 xhigh)

**Files:**
- Create: `DESIGN-LANGUAGE.md` (repo root, alongside `DEPLOY.md`/`GOAL.md`)

**Interfaces:**
- Produces: the named vocabulary every later task cites in commit messages and tests — token names, the six rules below, and a per-section conformance checklist.

- [ ] **Step 1: Extract the vocabulary from the pulse work.** Read `~/Developer/anthill-pulse/src/web/styles.css` header comment and `:root` block; document, with the exact custom-property names: graphite ground (`--canvas/--surface/--raise/--sand`), ink scale (`--ink/--muted/--faint`), indicator inks (`--ember/--amber/--moss/--slate/--clay` + `-soft` mixes), signal rails (`--signal-rail`), frame (`--frame`), inspector width, shadow scale, provider inks, mono-for-values rule, SVG-attribute meter rule, urgency-weighted cell + calm-collapse pattern, progressive disclosure (thin trigger → drawer).
- [ ] **Step 2: Write the conformance checklist** — one line per body section from the `styles.css` section map (`utilities`, `masthead`, `app body`, `toolbar`, `programs`, `agent rows`, `inspector: layered drawer`, `per-type drawer states`, `vitals band`, `controls`, `broadcast dock`, `empty state`, `toast`, `responsive`, `usage tab`, `motion`) with pass/fail columns for each of the six rules.
- [ ] **Step 3: Commit** (on the pre-G0 doc branch or fold into WS-A lane's first commit): `docs: codify techno-orchestra design language + conformance checklist`

### Task A2: Body audit against the language (pre-G0, Sonnet 5 1M, read-only)

**Files:**
- Create: `~/Developer/the-mountain-lanes/qa-baseline-20260722/AUDIT.md` (outside the repo; findings fold into A3–A6 scope)

- [ ] **Step 1:** With `DESIGN-LANGUAGE.md` + full `styles.css` + `index.html` + the render functions of `app.js` in context, fill the A1 checklist. For every FAIL record: selector/function, which rule it breaks, and the concrete fix (e.g. "`.view-tab[aria-pressed=true]` uses a filled pill — replace with ink text + 2px bottom signal rail").
- [ ] **Step 2:** Deliver AUDIT.md ordered by section, each finding tagged A3/A4/A5/A6 so the Opus workers pick up scoped lists, and flag anything ambiguous for the Fable orchestrator instead of guessing.

### Task A3: Toolbar + view tabs to instrument-rail language (Opus 4.8)

**Files:**
- Modify: `src/web/styles.css` (`toolbar: views, filter chips, search` section), `src/web/app.js` (`renderTabs`, `renderFilterBar`), `src/web/index.html` (`.toolbar` markup only if class contract changes)
- Test: `tests/web-client.test.ts`

**Interfaces:**
- Produces: `.view-tab` active state = ink text + `--signal-rail` underline (class `is-current`); count badges in `--font-mono`; search and `Select` as quiet outline controls. WS-C reuses `is-current` semantics unchanged.

- [ ] **Step 1:** Write failing intent tests asserting: styles source contains an `is-current` rule using `--signal-rail` for `.view-tab`, contains no filled-background active-tab rule, and `.count` uses `var(--font-mono)`.
- [ ] **Step 2:** `bun run check` → the new assertions FAIL.
- [ ] **Step 3:** Implement per the A2 finding list for this section (active-tab rail, mono counts, outline search/select, alert count keeps `--ember` ink not fill).
- [ ] **Step 4:** `bun run check` → PASS. `scripts/anthill-preview.sh` + `@browse` screenshot at 1440 and 375; verify no horizontal scroll and tabs align to `--frame`.
- [ ] **Step 5:** Commit: `feat(web): toolbar + view tabs on the instrument-rail language`

### Task A4: Masthead + program section headers alignment (Opus 4.8)

**Files:**
- Modify: `src/web/styles.css` (`masthead`, `programs` sections), `src/web/app.js` (`renderProgram` header block)
- Test: `tests/web-client.test.ts`

- [ ] **Step 1:** Failing intent tests: masthead and `.programs` rules reference `--frame`; program header meta values use `--font-mono`; no program-header background fill beyond `--surface`/`--raise`.
- [ ] **Step 2:** `bun run check` → FAIL. Implement the A2 findings for both sections (shared content edge, quiet header, eyebrow style consistent with the rail heading).
- [ ] **Step 3:** `bun run check` → PASS; preview screenshots 1440/375. Commit: `feat(web): masthead + program headers share the frame + quiet header language`

### Task A5: Peripherals — empty state, toast, broadcast dock, usage tab (Opus 4.8)

**Files:**
- Modify: `src/web/styles.css` (those four sections), `src/web/app.js` (their render fns) — scope strictly to A2's FAIL list
- Test: `tests/web-client.test.ts`

- [ ] **Step 1:** Failing intent tests per A2 finding (same pattern as A3 Step 1 — assert the specific replacement rule exists and the offending pattern is gone).
- [ ] **Step 2:** Implement; `bun run check` PASS; preview screenshots. Commit: `feat(web): peripheral surfaces conform to the design language`

### Task A6: Motion + responsive conformance sweep (Opus 4.8, then Sonnet 5 verify)

**Files:**
- Modify: `src/web/styles.css` (`responsive`, `motion` sections)
- Test: `tests/web-client.test.ts`

- [ ] **Step 1:** Failing intent test: every `@keyframes`/`animation` introduced by WS-A appears inside the existing `prefers-reduced-motion` guard block; 44px touch-target rules cover any new interactive class below 1024px.
- [ ] **Step 2:** Implement; `bun run check` PASS. `@browse` at 1440/1024/375: no overflow-x, drawer still full-surface <1024. Commit: `feat(web): motion + responsive conformance for the restyled body`
- [ ] **Step 3 (lane close):** Sonnet 5 (1M) re-runs the A1 checklist over the finished lane → all PASS or explicitly waived by the Fable orchestrator. Then land WS-A into `main` (merge, `bun run check` on main, `scripts/anthill-deploy.sh`).

---

# WS-B — Right panel: the totem pole

**The ordering contract (what "important at the top" means, from Emilio's standing dashboard brief):**
1. **Verdict head** — agent name + status word + outcome + blocker/gate chip, with the primary action **in the head** (act without scrolling).
2. **Next action** line.
3. **Vitals instrument band** — model + context %, tokens + cost, elapsed/phase time, subagents spawned, git/test state. Promoted OUT of the Evidence caterpillar.
4. **Operate | Chat** shelf (unchanged behavior).
5. **Lineage spine** (demoted below the shelf — context, not action).
6. **Evidence rail** — paths, routing, transcript tail (vitals removed; the rest stays).
7. **Command dock** pinned at the bottom (unchanged).

Today's order in `renderAgentDrawer` is head (with naming noise) → control banner → lineage → nextAction → shelf (vitals buried in Evidence) → dock. The naming variants (`Terminal: … · session cwd ≠ pane folder` etc.) collapse to one quiet `inspector-source-name` sub-line whose full detail moves to `title` tooltip.

### Task B1: Backend contract (Codex GPT-5.6-Luna MAX, cmux pane `E7DB370C-…`, after G0)

**Files:**
- Modify: `src/shared/types.ts`, `src/server/app.ts`, `src/server/state.ts`
- Test: `tests/state-health.test.ts` (+ route coverage where app routes are tested)

**Interfaces:**
- Produces: `SourceHealth.lastHealthyAt: string | null` (ISO, set on every successful collect; null before first success) on the existing per-source health objects in `src/shared/types.ts`; `POST /api/recollect` → runs all collectors once, responds with the fresh decorated snapshot (same shape as `/api/snapshot`), 503 with `{ error }` if a collect is already in flight. These close the two flagged blockers (Refresh only re-served cache; degraded verdict had no "since when").
- Consumes: the landed `HubSnapshot` shape from `feat/pulse-strip`.

- [ ] **Step 1:** Failing tests: `lastHealthyAt` updates on successful collect and survives a subsequent failed collect; `/api/recollect` returns a snapshot and coalesces concurrent calls.
- [ ] **Step 2:** `bun run check` → FAIL. Implement in `state.ts` (timestamp on collect success; single-flight recollect) + `app.ts` (route). No `src/web` changes in this task.
- [ ] **Step 3:** `bun run check` → PASS. Commit: `feat(server): per-source lastHealthyAt + POST /api/recollect`
- [ ] **Step 4:** Write `.pulse/`-style handoff (`B1_DONE.md` in the WS-B worktree) stating the exact type + route contract for B2/B3.

### Task B2: Verdict head + section reorder (Fable 5 xhigh)

**Files:**
- Modify: `src/web/app.js` (`renderAgentDrawer`, `renderStatusLine`, `renderPrimaryActions`), `src/web/styles.css` (`inspector: layered drawer` section)
- Test: `tests/web-client.test.ts`

**Interfaces:**
- Consumes: WS-A classes (`is-current`, rail language); B1 contract for the degraded case.
- Produces: head structure below; `.inspector-vitals` mount point directly under `.next-action` that B3 fills.

Structural contract for the head (adapt to landed code, keep `el()` idiom):
```js
pane.append(el("div", { class: "inspector-head" },
  el("div", { class: "inspector-verdict" },
    el("h2", { class: "inspector-title", text: agentName(agent) }),
    renderStatusLine(agent, activity, outcome, control, policy),   // status word + outcome, ink-colored
    control && control.blocked
      ? el("span", { class: "verdict-gate", text: control.reason })  // ember ink chip, outline not fill
      : null,
    headPrimaryAction(agent)),                                       // the single most-relevant action, from renderPrimaryActions logic
  el("p", { class: "inspector-source-name", title: fullSourceDetail(agent), text: quietSourceLine(agent) }),
  closeButton()));
```
Then, in order: control banner (unchanged) → `nextAction` → `.inspector-vitals` (empty mount until B3) → drawer-shelf (Operate | Chat | Evidence) → lineage spine → command dock.

- [ ] **Step 1:** Failing intent tests: `renderAgentDrawer` source appends the lineage spine **after** the drawer-shelf; head contains `verdict-gate` and a primary-action control; source-name variants collapse to one element with a `title`.
- [ ] **Step 2:** `bun run check` → FAIL. Implement head + reorder; move the three-way naming ternaries into `quietSourceLine`/`fullSourceDetail` helpers.
- [ ] **Step 3:** `bun run check` → PASS. Preview + `@browse`: at 1440 the head, next action, and vitals mount are all visible without scrolling in a 900px-tall window. Commit: `feat(inspector): verdict head with in-head action; lineage demoted below the shelf`

### Task B3: Vitals instrument band promotion (Opus 4.8)

**Files:**
- Modify: `src/web/app.js` (vitals markup out of `renderEvidenceShelf` into a `renderVitalsBand(agent)` filling `.inspector-vitals`), `src/web/styles.css` (`vitals band` section)
- Test: `tests/web-client.test.ts`

**Interfaces:**
- Consumes: B2's `.inspector-vitals` mount; existing vitals tiles (model/context from `CLAUDE_CONTEXT_WINDOWS` derivation, tokens, elapsed) plus subagent count where the agent record carries it.
- Produces: compact tile row — values in `--font-mono`, labels in `--faint`; context meter stays an SVG-attribute meter; unknown values render the honest fallbacks already in the codebase ("not reported"), never invented numbers.

- [ ] **Step 1:** Failing intent tests: vitals tiles render inside `.inspector-vitals`; the Evidence shelf source no longer contains the vitals block; mono class on values.
- [ ] **Step 2:** `bun run check` → FAIL. Implement; Evidence keeps paths/routing/transcript tail.
- [ ] **Step 3:** `bun run check` → PASS. Preview screenshot. Commit: `feat(inspector): vitals promoted to an instrument band under the verdict head`

### Task B4: Per-type drawer conformance (Opus 4.8)

**Files:**
- Modify: `src/web/app.js` (`renderInterventionDrawer`, `renderAdvisoryDrawer`, `renderInvestigationDrawer`, `renderResolvedDrawer`, `renderProgramDrawer`), `src/web/styles.css` (`per-type drawer states`)
- Test: `tests/web-client.test.ts`

- [ ] **Step 1:** Failing intent tests: each of the five drawers opens with a verdict-head-shaped block (title + status ink + its one primary action) before any evidence/detail; `workStateBanner` + `impactBlock` still render in the intervention/advisory/investigation drawers (regression guard from the pulse plan).
- [ ] **Step 2:** `bun run check` → FAIL. Apply the same totem ordering to each drawer; program drawer's head shows rollup vitals (agent count, alert count, aggregate tokens).
- [ ] **Step 3:** `bun run check` → PASS. Preview: open each entity type via its trigger, screenshot each. Commit: `feat(inspector): all entity drawers lead with verdict + action`
- [ ] **Step 4 (lane close):** Sonnet 5 test-hardening pass over WS-B (tests that would fail if the totem order regressed), then land WS-B into `main` on top of WS-A and deploy.

---

# WS-C — Left tree: maximum glance, zero clutter

**Row contract:** one line per agent — `[provider mark] [name] [role chip if not agent] … [status word·outcome] [model + ctx%] [tokens] [elapsed]` with the right-side cluster in `--font-mono`, tabular-nums, right-aligned. The `terminal:`/`source:`/`cwd differs` text tags leave the row: default rendering keeps only a small mark (mismatch = ember dot) with the full sentence in the row `title` and the drawer. Task summary stays as the second line, single-line ellipsized.

### Task C1: Row instrument cluster + de-noise (Opus 4.8)

**Files:**
- Modify: `src/web/app.js` (`renderAgentRow`, `renderAgentColumnHeader`), `src/web/styles.css` (`agent rows`)
- Test: `tests/web-client.test.ts`

**Interfaces:**
- Consumes: existing `modelShort`, context-window derivation, token/elapsed fields; WS-A mono/value discipline.
- Produces: `.row-instruments` cluster class; column header updated to name the new columns.

- [ ] **Step 1:** Failing intent tests: row source renders `.row-instruments` containing model, tokens, elapsed; the literal `"terminal: "` prefix no longer appears in `renderAgentRow` output (moved to `title`); column header names the instrument columns.
- [ ] **Step 2:** `bun run check` → FAIL. Implement; keep rename button, selection checkbox, and swarm anchor behavior untouched.
- [ ] **Step 3:** `bun run check` → PASS. Preview at 1440: a 12-agent program fits without wrapping; at 375 the instrument cluster collapses to model+status only (responsive rule). Commit: `feat(rows): instrument cluster per agent; naming noise demoted to tooltip`

### Task C2: Program header rollups (Opus 4.8)

**Files:**
- Modify: `src/web/app.js` (`renderProgram`), `src/web/styles.css` (`programs`)
- Test: `tests/web-client.test.ts`

- [ ] **Step 1:** Failing intent tests: program header renders agent count, working count, alert count (ember ink only when >0), aggregate tokens — mono values.
- [ ] **Step 2:** Implement from data already aggregated client-side over the program's agents; `bun run check` PASS; preview screenshot. Commit: `feat(programs): at-a-glance rollups in program headers`

### Task C3: Density + keyboard pass (Opus 4.8, Sonnet 5 verify)

**Files:**
- Modify: `src/web/styles.css` (`agent rows`, `responsive`)
- Test: `tests/web-client.test.ts`

- [ ] **Step 1:** Failing intent test: row vertical padding tightens at ≥1440 (compact rule exists) while touch rules keep ≥44px targets <1024.
- [ ] **Step 2:** Implement; `bun run check` PASS. `@browse`: keyboard walk (tab/arrows) through rows → drawer still works; screenshot 1440 dense + 375. Commit: `feat(rows): density pass with touch + keyboard integrity`
- [ ] **Step 3 (program close):** Sonnet 5 (1M) final consistency sweep across the three landed lanes against `DESIGN-LANGUAGE.md`; Fable orchestrator reviews before/after against the `qa-baseline-20260722` screenshots; land WS-C, deploy `scripts/anthill-deploy.sh`, live QA on `:4701` with real collectors + BurnBar.

---

## Self-review (done at authoring)

- All three requested workstreams covered (A = language, B = right panel totem, C = left tree glance); model routing honors the override (Opus 4.8 workhorse, Sonnet 5 1M audits/tests, Fable 5 xhigh only for A1/B2 + orchestration, Codex Luna MAX for the only backend task, via cmux).
- Type/name consistency: `is-current` (A3→C reuse), `.inspector-vitals` (B2→B3), `SourceHealth.lastHealthyAt` + `POST /api/recollect` (B1→B2), `.row-instruments` (C1→C3) — each defined where produced and cited where consumed.
- Known deliberate gaps: exact code is structural-contract level (pulse base still moving — see Honesty note); per-agent cost tile in B3 depends on what the landed BurnBar/pulse work exposes per agent — if only program-level cost exists, the tile renders at program scope and the per-agent cell is omitted, not faked.
