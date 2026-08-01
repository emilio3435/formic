# The Ant Hill — Inspector Drawer States: Plan of Attack

> **ARCHIVED 2026-08-01 — do not follow §5.** The design in this plan shipped,
> but §5's instruction to preserve `renderOverview`, `renderSwarmSection`,
> `renderTechnical`, and `renderTarget` is now *inverted*: all four were
> deleted, and `tests/web-client.test.ts` asserts their absence by name
> (`expect(byClass(drawer, "swarm-section")).toBeNull()`). Reintroducing them
> turns the suite red. The `.drawer-*` class names in §1 were also renamed to
> the `dw-*` namespace, and every `file:line` citation in §0 predates the
> `app.js` ES-module split. Kept for the §4 nesting-options rationale.

**Date:** 2026-07-22
**Scope:** Redesign the right-hand inspector drawer (`aside#inspector.pane-inspector`) so it presents a *distinct design per entity type* and *owns ~90% of the interaction*, pulling triage generation, affected-agent chips, technical detail, and investigation results out of the inline list surfaces and into the drawer. This is a scoping/design deliverable — no production code changes beyond these two files.

> Companion visual: `drawer-states-mockups-2026-07-22.html` (open in a browser; each state is rendered side-by-side with the real `:root` tokens).

---

## 0. Inventory — every current drawer + inline surface, by entity type

All references are `src/web/app.js` unless noted. The drawer only renders **one** entity type today (Agent); everything else lives inline in `main.pane-list`.

| Entity type | Data model (`src/shared/types.ts`) | Where it renders today | Key render fns (`file:line`) |
|---|---|---|---|
| **Agent** | `AgentSnapshot` (63) | Drawer (the only drawer today) + list row | `renderInspector` 1805, `renderOverview` 2066, `renderTechnical` 2142, `renderSwarmSection` 2108, `renderPrimaryActions` 1917, `renderPresentationLabels` 1985, `renderDangerZone` 2255, `dtdd` 2047, `renderTarget` 2238; list: `renderAgentRow` 1703, `renderSwarmAnchor` 1628 |
| **Intervention** (act-now) | `OperatorIssue` severity `"error"` (132) | **Inline** `#interventions-list` | `renderIssues` 1258, `renderIntervention` 1304, `renderTriage` 1187, `affectedDisclosure` 1287 |
| **Advisory** (be-aware) | `OperatorIssue` severity `"warning"` (132) | **Inline** `#warnings-list` | `renderAdvisory` 1331 |
| **Investigation** (Luna triage run) | `TriageQueueItem` (165) | **Inline** `#warnings-list` + inline triage plan | `renderInvestigationItem` 1358, `renderTriage` 1187 (queue/run rows) |
| **Resolved** finding | `OperatorIssue` w/ `lifecycle.state==="resolved"` (124) | **Inline** `#warnings-list` | `renderRecentlyResolved` 1347 |
| **Program / Project** | `ProgramSnapshot` + `ProgramRollup` (101,113) | **Inline** program header only — **no drawer** | `renderProgram` 1484, `rollupParts` 1474, `deriveRollup` 206 |

**Label maps / vocab reused across states:** `ACTIVITY_LABELS` 133, `OUTCOME_LABELS` 134, `CONTROL_LABELS` 135, `CONTROL_HINTS` 136, `GLOSSARY` 147, `ISSUE_STATE_LABELS` 1102, `ACTION_LABELS` 1910, `ROLE_LABELS` 443, `RESOLUTION_LABELS` 174, `PROVENANCE_LABELS` 172.

**Icon vocabulary** (`ICON_PATHS` 45): `intervention`, `warning`, `check`, `broadcast`, `linked`, `observed`, `quarantine`, `caret`, `close`, `offline`, `rename`. **No new SVG paths are required** for this plan — every state maps to an existing mark.

**The design north star already in code** (comment, 1256): *"Interventions (act now) and advisories (be aware) are separate information classes with distinct visual weight — never one repetitive card stack."* This plan extends that principle from the list into the drawer.

---

## 1. The shared drawer chassis

Every state reuses **one chassis** so the drawer reads as a single language; only the *lead band*, the *body blocks*, and the *accent token* change. This is the anti-"generic drawer" mechanism: same skeleton, per-type spine color + lead element.

```
┌─ .pane-inspector ───────────────────────────┐
│  .drawer-accent   (2px top rule, per-type)   │  ← the one visual "channel" that differs
│  .inspector-head  (type-eyebrow + title + ✕) │
│  .drawer-lead     (THE differentiator band)  │  ← intervention→consequence, agent→state pills…
│  .drawer-actions  (primary vs secondary)     │
│  .drawer-body     (type-specific blocks)     │
│  .drawer-foot     (danger / provenance)      │
└──────────────────────────────────────────────┘
```

New entry point (replaces the body of `renderInspector` 1805, keeps the name for the test's `source.includes`): a **router** on the selected entity's kind.

```js
// state.selected = { kind: "agent"|"intervention"|"advisory"|"investigation"|"resolved"|"program", id }
function renderInspector() {
  const pane = $("inspector"); pane.textContent = "";
  const sel = state.selected;                       // was: state.selectedId (agent-only)
  pane.hidden = !sel; document.body.classList.toggle("inspector-open", !!sel);
  if (!sel) return;
  const view = resolveSelection(sel);               // {kind, agent?, issue?, item?, program?}
  if (!view) return pane.append(missingDrawer());
  pane.append(drawerChassis(view, {
    agent:        renderAgentDrawer,
    intervention: renderInterventionDrawer,
    advisory:     renderAdvisoryDrawer,
    investigation:renderInvestigationDrawer,
    resolved:     renderResolvedDrawer,
    program:      renderProgramDrawer,
  }[view.kind]));
}
```

`drawerChassis(view, bodyFn)` renders `.drawer-accent`, the `.inspector-head` (type eyebrow + title + `closeButton()` 1888), then the body function's output. The accent class is `drawer-accent--<kind>` and drives the single per-type color channel (below).

**Backward-compat guard:** `state.selectedId` stays as a derived getter (`state.selected?.kind === "agent" ? state.selected.id : null`) so `renderAgentRow`'s `is-selected` check (1709), `closeInspector` (1785), and `findSelected` (1796) keep working untouched. `selectAgent(id)` (1779) becomes `selectEntity({kind:"agent", id})`.

### Per-type differentiation cues (the palette contract)

Restrained, curated — **one accent token per type**, never rainbow. Weight and icon carry the rest.

| State | Accent token | Lead element | Icon | Eyebrow |
|---|---|---|---|---|
| Intervention | `--ember` (#b42318) | Consequence sentence (large) + one **primary** fix action | `intervention` | `OPEN · ACT NOW` (ember) |
| Advisory | `--amber` (#8a5100) | Plain "what & why" summary, muted | `warning` | `ADVISORY` (amber) |
| Agent | provider var (`--claude`/`--codex`/`--cursor`/`--omp`) as a **1px** left channel; state carried by pills | provider mark | `ACTIVITY · OUTCOME` |
| Program | `--ink` (neutral, structural) | Rollup meter + roster | `caret`/`broadcast` | `PROGRAM` |
| Investigation | `--slate` (#46647e), running→pulse on `--moss` | Status line + step timeline | `broadcast` | `INVESTIGATION · <state>` |
| Resolved | `--moss` (#216e49), de-emphasized (0.85 opacity) | "Cleared" line + before/after | `check` | `RESOLVED` |

The accent is a **2px top rule + eyebrow color only** — not a filled card — to stay off glassmorphism and off austere monochrome while never color-coding by topic.

---

## 2. Per-state designs

### 2.1 Intervention drawer — *"what breaks, and the one thing to do"*

- **Leads with:** the consequence. Big `.drawer-lead` sentence (from `issue.summary`) under the ember eyebrow `OPEN · ACT NOW`. This is the highest-weight text in the whole app.
- **Info hierarchy:** consequence → **fix affordance** (Generate triage → plan → Queue/Launch, moved in from `renderTriage`) → affected agents (chips, moved in from `affectedDisclosure`) → technical evidence (`issue.technicalDetails`, collapsible) → lifecycle note.
- **Primary action:** `Generate triage` (full width, ink button). Once a plan exists, primary becomes `Queue investigation` / `Launch read-only Luna` (reuse `triageIssue` 1152 verbatim). **Secondary:** each affected-agent chip → opens that Agent drawer (`selectEntity`).
- **Differentiation:** ember accent + `intervention` icon + heaviest type; the *only* state whose lead is a full-width primary CTA.
- **Reuses:** `renderTriage` 1187 (unchanged), `affectedDisclosure` 1287 (unchanged — now mounted in drawer), `issueLifecycleNote` 1128, `issueStateLabel` 1115.

```
┌────────────────────────────────────────────┐
│▔▔▔▔▔ ember 2px ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ │
│ ⚠ OPEN · ACT NOW                      [✕]   │
│ Backend lane failed typecheck and is        │
│ blocking 3 downstream agents.               │  ← .drawer-lead (1.2rem, ink, 700)
│                                             │
│ ┌───────────── Fix ──────────────────────┐ │
│ │  [ Generate triage ]  (ink, full-width) │ │  ← primary
│ └─────────────────────────────────────────┘ │
│ Affected (3)  ▸                             │  ← chips open Agent drawers
│   [luna-be · Hormiga] [sol-fe] [tester-2]   │
│ Technical ▾                                 │
│   • tsc: 4 errors in x-campaign-builder…    │  ← mono, from technicalDetails
│ Verifying since 3:14 PM · awaiting snapshot │
└────────────────────────────────────────────┘
```

### 2.2 Advisory drawer — *"be aware, no action forced"*

- **Leads with:** a calm plain-English summary (amber eyebrow `ADVISORY`). Deliberately lower weight than Intervention — this is the "distinct visual weight" contract.
- **Info hierarchy:** summary → affected (single primary agent link, or "system") → lifecycle note → optional technical.
- **Primary action:** none forced. The affected-agent link (reuse the `renderAdvisory` title-button behavior, 1336) is the main affordance; `Escalate to triage` offered as a *secondary* ghost button (calls `triageIssue(id,"generate")`).
- **Differentiation:** amber accent, `warning` icon, no CTA card, more whitespace — visibly "quieter" than intervention.

```
┌────────────────────────────────────────────┐
│▔▔▔▔▔ amber 2px ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ │
│ △ ADVISORY                            [✕]   │
│ Cursor session reports a non-approved model │  ← .drawer-lead (1rem, muted)
│ (grok expected).                            │
│                                             │
│ Affects → luna-audit · Hormiga  (open)      │
│ Open · 1 affected                           │
│ [ Escalate to triage ]  (ghost, secondary)  │
└────────────────────────────────────────────┘
```

### 2.3 Agent drawer — *the workhorse (keep, refine)*

- **Leads with:** provider mark + name + state pills (activity/outcome/control/policy) — **unchanged** from today (1829–1852). This is already good; the refactor only re-homes it inside the chassis.
- **Info hierarchy:** identity → state pills → primary actions (Focus/Send) → **lineage spine** (new, see §4) → Overview ∥ Technical (two-column ≥1200px, tabs below) → danger zone.
- **Primary:** `Focus` + `Send` (`renderPrimaryActions` 1917, unchanged — keeps the test-asserted `controlUnavailableText(deriveControlState(agent))`). **Secondary:** presentation labels, artifacts copy, interrupt/archive in danger foot.
- **Differentiation:** the *only* state with the provider-colored 1px channel + the four state pills + the Overview/Technical split. No ember/amber shouting.
- **Reuses everything** in `renderInspector` today — `renderOverview` 2066 (MUST stay immediately followed by `renderSwarmSection` per test 170), `renderTechnical` 2142 (MUST stay immediately before `renderTarget`, MUST keep `transcriptTail` per test 173), `renderDangerZone`, `renderPresentationLabels`.

```
┌────────────────────────────────────────────┐
│ ▏claude          WORKING · HEALTHY    [✕]   │
│ luna-integration                            │
│ Hormiga · Claude · sol 5.6                  │
│ [●Working][Healthy][⬡Linked][Compliant]     │  ← state pills (unchanged)
│ ┌ Focus ┐ ┌ Send an instruction…  →Send ┐   │  ← primary actions
│ ● Lineage:  Orchestrator › swarm-3 › ▸this  │  ← NEW spine (§4)
│    └ 4 subagents ▸                          │
│ ── Overview ────────┬── Technical ────────  │  ← two-col ≥1200px
│ Last human message  │ session id  claude:…  │
│ task  Wire Luna…    │ working dir /Users/…  │
│ running for 22m     │ model  sol 5.6        │
│ latest call 48k     │ nesting level 1       │
│ context 41%         │ git  feat/x-cb @a1b2  │
│ ── Danger ─────────────────────────────────  │
│ [Interrupt] [Archive]                       │
└────────────────────────────────────────────┘
```

### 2.4 Program / Project drawer — *"the swarm at a glance"* (NEW)

- **Leads with:** the rollup as a **segmented health meter** (working/idle/needs-you/ended) built from `deriveRollup` 206 / `rollupParts` 1474 — a bar, not a card stack.
- **Info hierarchy:** rollup meter → purpose/path → **roster** (agents grouped by role via `roleView` 486) → program-level broadcast.
- **Primary:** `Broadcast to N eligible` (enters select mode scoped to this program — reuse `selectProgramEligible` 2435). **Secondary:** rename label (reuse `renderPresentationLabels` pattern / `startRename` with `programLabelTarget`), open each agent.
- **Differentiation:** neutral `--ink` structural accent (a program isn't an alarm), the segmented meter is unique to this state, roster uses role-color chips (`.role-*` tokens 657) which already exist.
- **Reuses:** `programRollup` 222, `rollupParts` 1474, `roleView` 486, `broadcastEligible` 2423, `selectProgramEligible` 2435, `agentLabelTarget`/`programLabelTarget`.

```
┌────────────────────────────────────────────┐
│ ▏ink             PROGRAM               [✕]   │
│ Hormiga Dormida                             │
│ ▐▐▐▐▐▐▐▐░░░░  9 agents                       │  ← segmented rollup meter
│ 2 working · 1 idle · 1 alert · 5 done        │
│ purpose  Paid-social crawl→plan engine      │
│ [ Broadcast to 3 eligible ]  (primary)      │
│ ── Roster ─────────────────────────────────  │
│ Orchestrator  luna-lead        ●Working     │
│ Backend       codex-be         ●Working     │
│ Frontend      sol-fe           ○Idle        │
│ Tester        tester-2      ⚠ Needs you     │
└────────────────────────────────────────────┘
```

### 2.5 Investigation drawer — *"the Luna run, live"* (NEW)

- **Leads with:** a **status line + step timeline** (`TriageQueueItem.state` + `recommendation.steps`). Running state gets a moss pulse on the eyebrow.
- **Info hierarchy:** status (queued/running/completed→verifying/blocked) → the generated plan (`headline` + `rationale` + numbered `steps`, reuse `renderTriage`'s `.triage-steps`) → result `<pre>` when present → back-link to the originating intervention.
- **Primary:** state-dependent — `Launch read-only Luna` when `queued` (calls `triageIssue(id,"run")`); `View result` when `completed`. **Secondary:** open the source issue, open the run's target agent.
- **Differentiation:** `--slate` accent + `broadcast` icon + the **timeline** is unique here; running uses the moss pulse (reuse `.act-working` glow token 699). Never ember — an investigation is not itself an alarm.
- **Reuses:** `renderTriage` internals (`.triage-plan`, `.triage-steps`, `.triage-result` — all styled already, 1207–1248), `triageIssue` 1152, `issueTimestamp` 1119.

```
┌────────────────────────────────────────────┐
│▔▔▔ slate 2px ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ │
│ ⇢ INVESTIGATION · RUNNING             [✕]   │  ← moss pulse dot while running
│ Diagnose backend typecheck failure          │
│ ● running · native Luna                     │
│ ── Plan (4 steps) ─────────────────────────  │
│ 01 Reproduce   tsc --noEmit in cwd          │
│ 02 Localize    parse first error frame      │
│ 03 …                                        │
│ Result ▾   (appears on completion)          │
│ ↖ From intervention: Backend lane failed…   │  ← back-link
└────────────────────────────────────────────┘
```

### 2.6 Resolved drawer — *"it cleared; here's the trail"* (NEW)

- **Leads with:** a `check` + "Resolved <when>" line, `--moss`, whole drawer at ~0.9 opacity (calm, past-tense).
- **Info hierarchy:** resolution line (`lifecycle.result`) → before (original title/summary) → after (what cleared it) → affected agents (now healthy) as secondary links.
- **Primary:** none. **Secondary:** open the (now-healthy) agents; `Dismiss` (local only).
- **Differentiation:** moss accent, reduced opacity, `check` icon — the only past-tense, no-action state.
- **Reuses:** `renderRecentlyResolved` 1347 fields, `issueTimestamp` 1119, `issueLifecycle` 1109.

```
┌────────────────────────────────────────────┐
│▔▔▔ moss 2px ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ │
│ ✓ RESOLVED                            [✕]   │
│ Cleared 3:40 PM · source confirmation       │  ← .drawer-lead, moss
│ Was: Backend lane failed typecheck          │
│ Now: fresh snapshot shows tests passing     │
│ Recovered → codex-be (open)                 │
└────────────────────────────────────────────┘
```

---

## 3. Inline → drawer migration table

Principle: the list keeps a **thin trigger** (one scannable line that says *what* and *how bad*); everything actionable/expandable moves into the drawer. This is what shifts the interaction weight to ~90% in the drawer.

| Surface today | Inline fn | Moves INTO drawer | Thin trigger that STAYS inline |
|---|---|---|---|
| Intervention band (title + consequence + inline triage + affected + technical) | `renderIntervention` 1304 | Generate-triage flow, affected chips, technical `<ul>`, lifecycle note | One row: `intervention` icon + kicker + **title only**, whole row opens the Intervention drawer |
| Inline triage generation/plan | `renderTriage` 1187 (mounted in list) | **Entire** triage plan + Queue/Launch rows render **only in drawer** | The "Generate triage" affordance leaves the list; band shows `Not yet triaged` / `Triage ready ▸` status text |
| Affected-agent chips | `affectedDisclosure` 1287 | Chips render in drawer under "Affected (N)" | Inline shows just the count `3 affected` (no expandable disclosure in the band) |
| Advisory band | `renderAdvisory` 1331 | Summary, lifecycle, escalate action | icon + title + impact chip; row opens Advisory drawer |
| Investigation item | `renderInvestigationItem` 1358 | Step timeline, result `<pre>`, launch/relaunch | icon + headline + state chip; row opens Investigation drawer |
| Resolved item | `renderRecentlyResolved` 1347 | Before/after + recovered agents | icon + title + `Resolved` chip |
| Program header | `renderProgram` 1484 | Rollup meter, roster, program broadcast, purpose | **Caret + label + rollup summary stay** (list still needs to expand/collapse); a new `ⓘ` / name-click opens the Program drawer |
| Agent row | `renderAgentRow` 1703 | (already the drawer) — add lineage spine + subagent fan | Row unchanged; still the trigger |
| Swarm anchor (untracked parent) | `renderSwarmAnchor` 1628 | Opens Agent drawer for the parent | Anchor row unchanged |

**Net inline change:** the `#interventions-list` / `#warnings-list` bands become **single-line triggers**. The heavy `renderTriage`/`affectedDisclosure`/`technicalDetails`/`renderInvestigationItem` markup stops rendering in the list. This is the largest simplification and the highest-risk (tests + muscle memory) — phased carefully in §5.

---

## 4. Nesting scaffolding — 3 options + recommendation

Data available (per agent): `parentAgentId`, `threadDepth`, `subagentCount`, and children via matching `parentAgentId` (`buildClusters` 376 already does this; `renderSwarmSection` 2108 already resolves parent + direct children). Goal: show orchestrator → subagent → sub-subagent **without a repeated indented card stack**.

### Option A — Lineage spine / rail  ★ RECOMMENDED
A single thin vertical rail at the drawer's left inset. Ancestors are small dots climbing to the current agent (a filled ring); direct children fan out below as a compact cluster. Depth is encoded by the existing `--tree-color` depth tokens (798–801), **not** by indentation. One spine, drawn once — structurally impossible to become a "card stack."

```
 ●  Orchestrator (luna-lead)        ← ancestor dot, depth-0 color, click to open
 │
 ◐  swarm-3 (verifier)              ← ancestor dot, depth-1 color
 │
 ⬤  luna-integration  ▸THIS         ← current, filled ring, provider color
 ├─ ○ codex-be     ●Working         ← direct children fan (max ~5, then "+N more")
 ├─ ○ sol-fe        ○Idle
 └─ ⊕ 4 more subagents ▸
```
- **Pros:** one element, scannable top-to-bottom, reuses depth-color tokens + `act-glyph`, collapses gracefully (deep chains → dots only), zero new icons. Ancestors *and* descendants visible at once.
- **Cons:** needs a small amount of new CSS for the rail/dots; very deep trees (>4) compress ancestor dots (mitigated by a breadcrumb fallback, below).

### Option B — Breadcrumb + children minimap
Top breadcrumb of ancestors (`Orchestrator › swarm-3 › this`) + a small grid "minimap" of children colored by activity.
- **Pros:** breadcrumb is a familiar pattern; minimap scales to many children.
- **Cons:** two separate widgets (ancestors vs children) split the mental model; breadcrumb truncates badly on long names; more markup than the spine.

### Option C — Depth-encoded lineage chip
A single compact chip: `⬡ depth 1 · under luna-lead · 4 below`, ring-colored by `--tree-color`, expanding to a popover on click.
- **Pros:** tiniest footprint, trivial to build, never a stack.
- **Cons:** hides the tree behind an interaction; doesn't *show* nesting at a glance — weakest on the "visually show nesting" brief.

**Recommendation: Option A (lineage spine)**, with Option B's breadcrumb as the **overflow fallback** when the ancestor chain exceeds 4 (collapse middle ancestors into a `⋯` breadcrumb crumb, keep the spine for the nearest ancestor + self + children). It best satisfies "non-obvious, non-repetitive," reuses existing depth tokens and `act-glyph`, adds no icons, and replaces the current flat `renderSwarmSection` list (2108) with something that actually *reads* as a tree. Implemented as a new `renderLineageSpine(agent)` that supersedes `renderSwarmSection` inside the Agent drawer (keep `renderSwarmSection` exported/adjacent so test 170's `renderOverview…renderSwarmSection` regex still matches — see §5 risk).

---

## 5. Phased plan of attack

Ordered so each phase ships independently, reuses existing fns, and never breaks `tests/web-client.test.ts`. Sizes: **S** ≈ <½ day, **M** ≈ 1 day, **L** ≈ 2+ days.

> **Test constraints that gate every phase** (`tests/web-client.test.ts`):
> - 170–173: `renderOverview` source must be immediately followed by `function renderSwarmSection`, and must **not** contain `transcriptTail`; `renderTechnical` must be immediately before `function renderTarget` and **must** contain `transcriptTail`. → **Do not reorder or rename these four functions; do not move `transcriptTail` out of `renderTechnical`.**
> - 458–462: `renderPrimaryActions(agent)` must contain `controlUnavailableText(deriveControlState(agent))` and not `.reason`. → keep verbatim.
> - 499–507: `renderProgram(program, agents)` must keep `program-head`, `program-caret`, `program-label`, `onclick: () => toggleProgram(program)`, no `role: "button"`. → the Program *drawer* is additive; the *header* keeps its structure.
> - 480–514: source must still contain `fetch("/api/program-aliases"`, `agentLabelEligible = (agent) => …`, `text: "Source agent: " + sourceAgentName(agent)`, the `Name agent` ternary, etc. → keep presentation-label code intact.

**Phase 0 — Chassis + selection model (M).** *Files: `app.js`, `styles.css`.*
Introduce `state.selected = {kind,id}` with a `selectedId` compat getter; add `selectEntity()`, keep `selectAgent()` as a thin wrapper. Add `resolveSelection()`, `drawerChassis()`, `renderInspector` router. Move today's inspector body into `renderAgentDrawer()` **calling** the existing `renderOverview`/`renderTechnical`/`renderDangerZone`/`renderPrimaryActions`/`renderPresentationLabels` unchanged. Add `.drawer-accent`, `.drawer-lead`, `.drawer-actions` CSS using existing tokens. *Verify:* full suite green; agent drawer visually identical; clicking a row still opens it. **Risk:** the router must default-safe when `state.selected` is stale (session left snapshot → reuse the existing "Session left the snapshot" block 1814).

**Phase 1 — Intervention + Advisory drawers (L).** *Files: `app.js`, `styles.css`.*
Add `renderInterventionDrawer(issue)` and `renderAdvisoryDrawer(issue)` that **mount the existing** `renderTriage(issue)` 1187 and `affectedDisclosure(issue,byId)` 1287 (unchanged) inside the chassis. Make `#interventions-list`/`#warnings-list` items thin triggers that `selectEntity({kind:"intervention"|"advisory", id})`. Keep `renderTriage`/`affectedDisclosure` functions where they are (tests + reuse). *Verify:* generate-triage, queue, launch all still work from the drawer; inline bands collapse to one line; `renderIssues` 1258 still splits interventions vs advisories. **Risk:** `renderTriage` reads/writes `state.triage`/`state.queueItems` — it works identically mounted in the drawer, but confirm `render()` re-entrancy (it calls `render()` on completion, which now re-renders the drawer — fine).

**Phase 2 — Investigation + Resolved drawers (M).** *Files: `app.js`, `styles.css`.*
Add `renderInvestigationDrawer(item)` (reuse `.triage-plan`/`.triage-steps`/`.triage-result` styles) and `renderResolvedDrawer(issue)`. Convert `renderInvestigationItem` 1358 and `renderRecentlyResolved` 1347 to thin triggers. *Verify:* running/completed/blocked states render; back-link to source issue opens the Intervention drawer. **Risk:** low — pure additive read views.

**Phase 3 — Program drawer (M).** *Files: `app.js`, `styles.css`.*
Add `renderProgramDrawer(program)` (segmented rollup meter via `deriveRollup`/`rollupParts`, roster via `roleView`, program broadcast via `selectProgramEligible`). Add an open affordance to `renderProgram` **without** touching the caret/label/toggle structure the test asserts (e.g. make `.program-name` also fire `selectEntity({kind:"program"})` via a new sibling button, or an `ⓘ` control). *Verify:* test 499–507 still green; caret still only expands; broadcast scoping works. **Risk:** the header test is strict — add, don't restructure.

**Phase 4 — Lineage spine (M).** *Files: `app.js`, `styles.css`.*
Add `renderLineageSpine(agent)` and swap it into `renderAgentDrawer` in place of the flat `renderSwarmSection` **call** — but keep `renderSwarmSection` defined immediately after `renderOverview` so test 170's regex holds (the function can remain defined-but-unused, or `renderLineageSpine` can wrap it). Reuse `buildClusters` 376, depth tokens (798–801), `act-glyph`. Implement the >4-depth breadcrumb fallback. *Verify:* ancestors + children clickable; deep chains collapse; suite green. **Risk:** the `renderOverview`↔`renderSwarmSection` adjacency regex — the cleanest move is: `renderOverview` calls `renderLineageSpine`, and `renderSwarmSection` stays physically right after `renderOverview` (even if only called by the spine). Add a source comment so a future edit doesn't reorder them.

**Phase 5 — Polish + a11y pass (S).** *Files: `styles.css`, `app.js`.*
Focus management on drawer open per kind (lead element gets focus), `aria-label`s per state eyebrow, reduced-motion for the running pulse, 44px touch targets (reuse the `@media` at 1167). *Verify:* keyboard-only walk of each state; no horizontal scroll at mobile width.

**Must stay backward-compatible throughout:** the four regex-anchored functions (`renderOverview`, `renderSwarmSection`, `renderTechnical`, `renderTarget`) keep their names, order, and `transcriptTail` placement; `renderPrimaryActions` keeps its exact `controlUnavailableText(...)` string; `renderProgram` header keeps caret/label/toggle; all `/api/program-aliases` + presentation-label source strings stay. New drawer functions are **additive**; no exported helper in `globalThis.TheAntHill` (750) changes signature.

---

## 6. Open questions / calls to make before build

1. **Program drawer trigger** — new `ⓘ` button vs. repurposing the name-click (name-click currently starts rename). Recommend a small `ⓘ` to avoid overloading rename. *One-line decision needed.*
2. **Does an intervention's "affected agent" chip open the Agent drawer and lose the intervention context?** Recommend a breadcrumb back-crumb (`↖ from intervention`) in the Agent drawer when arrived-from an issue — small `state.selected.from` field.
3. **Investigation results** can be long — keep the `<pre>` capped at 18rem (existing `.triage-result pre` 477) with scroll; don't expand the drawer.
