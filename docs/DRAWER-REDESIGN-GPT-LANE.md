# Agent drawer redesign — independent GPT-lane proposal

**Provenance.** Produced by the GPT half of the drawer swarm as a counterweight to the
Claude lane, so the result is not one model's taste. Four Codex workers at high reasoning
effort each took a different lens — information architecture, visual hierarchy and density,
duplication hunting, and missing signals — reading the source directly. This document was
written **before the Claude lane committed any redesign**; at the time of analysis the only
frontend commits touching the drawer were module extractions (`3b0bd7b`, `83fe30e`,
`95a7bd2`, `6c9963e`), not design changes. Nothing here is a reaction to their answer.

**Citations pinned at `bb5cb3c`** (`src/web/app.js` = 6656 lines). The frontend lane is
actively moving code between `app.js`, `presentation.js`, `agent-model.js` and
`client-state.js`, so line numbers drift; field names and label strings are the durable part
of every citation.

**Measured against the north star.** The Ant Hill is a cockpit for one orchestrator running
many agents. Every pixel must tell the operator something is wrong, tell them what is
happening, or let them act. This document treats "it is interesting" as a failing grade.

---

## Verdict in one paragraph

The drawer's problem is not styling, it is **arithmetic**. It renders roughly 90 distinct
fields, of which a large fraction are the same handful of `AgentSnapshot` values re-labelled.
Six independent widgets narrate one agent state. Fifteen type sizes encode eight meanings.
Meanwhile the backend already computes the single most valuable thing an orchestrator wants
— *is this agent stuck?* — and the drawer never reads it. The fix is not to restyle the panel
but to **delete most of it**, keep one verdict line and one conditional intervention card,
demote everything raw behind Evidence, and spend the reclaimed space on signals that do not
exist yet.

---

## Part 1 — What the code actually does

### 1.1 True duplication: one value, several labels

Every row below is the *same source field* reaching the screen more than once.

| Source field | Rendered at | Verdict |
|---|---|---|
| `agent.model` | roster `Model · Ctx`; head provider chip; Operate `model` row | 3 sites. Keep the head chip. |
| `tokens.sessionTotal` | vitals `Session tokens`; Evidence `session total` | Same number, two labels. Keep Evidence. |
| `tokens.input/output/cachedInput/total` | roster token cell; vitals `Latest call`/`Tokens`; Evidence `latest call` | 3 sites. Keep Evidence. |
| `agent.lastHumanMessage` | Operate `Last human message`; Chat `User` (explicit fallback when `lastUserMessage` is absent) | **Both open tabs show the same message.** Keep Chat. |
| `agent.statusReason` | Attention block; Operate outcome note; and via `snapshot.ts` it can be copied into `lastHumanMessage`, then again into Chat | Up to 4 sites. Keep the intervention card. |
| `agentName(agent)` | head title; lineage current node `· this` | Keep the head title. |
| `controls[].action` | `headPrimaryAction` Focus/Interrupt; command dock Focus/Interrupt | The source comment calls the head one "a copy". Keep the dock. |
| `artifacts[].path` (transcript) | Chat `Transcript:` + `Copy path`; Evidence `Artifacts` + `Copy path` | Two copy buttons for one path. Keep Evidence. |
| `target.workspaceTitle` | head source line; Names workspace target; Names room target; Evidence control link; Focus tooltip | 5 sites. Keep Evidence control link. |
| `elapsedMs` | roster `Elapsed`; drawer `Uptime` | Roster is visible behind the drawer. Keep roster. |
| `updatedAt` | roster `updated … ago`; drawer `Last update` | Same. Keep roster. |
| `processState === "died"` | roster `Died`; `verdictLiveness` `Died` | Keep roster; full detail to Evidence. |

The Names disclosure duplicates *itself*: it prints `item.source` as the primary value and
then prints it again as `Source: {item.source}` when no alias exists.

### 1.2 Split duplication: one concept cut across labels

- **`agent.nextAction` carries no information.** The server derives all eight sentences purely
  from `activity`, `outcome` and `controlState` (`snapshot-agent.ts` `nextActionFor`) — every
  one of which is already on screen above it. `Resolve the reported blocker.` restates
  `Blocked` plus the gate; `Monitor current work.` restates `Working`. It is a rendered
  tautology. **Cut it.**
- **Context pressure is encoded twice inside one tile:** a percentage ring *and* the raw
  `total / contextWindow` fraction, both in `Context`.
- **`controlState` is fragmented across six surfaces:** status line word, banner headline,
  banner reason, banner next step, dock `Ready · linked`, and the disabled composer
  placeholder.
- **Cache efficiency is split from its inputs:** `Session tokens` computes a `% cache hit`
  meter from `cachedInput`/`input`, while Evidence shows those same two raw numbers.

### 1.3 Six widgets narrate one state

`renderAgentDrawer` appends these independently, so they stack:

| Surface | What it says on a healthy linked worker |
|---|---|
| `renderStatusLine` | `Working · Healthy · Ready` |
| `verdictLiveness` | `Process live` |
| `verdictGate` | (absent) |
| `renderAttentionBlock` | (absent) |
| `renderControlBanner` | (absent) |
| `Next` | `Monitor current work.` |

Three surfaces to say *nothing is wrong* — the exact opposite of "stay silent about
everything that does not require attention". On a blocked, quarantined agent it inverts:
`Blocked`, a gate name, `Quarantined`, a routing-lock narrative, and `Resolve the reported
blocker.` — and because blocked outranks quarantine in `nextActionFor`, `Next` does not even
tell the operator *which of the two independent problems* it means.

### 1.4 The visual vocabulary is larger than the meaning set

Measured in `styles.css`: **15 authored type sizes** (9px, 9.5, 10, 10.5, 11, 0.7rem, 11.5,
12, 12.5, 13, 13.5, 15px, 1.4rem, 1.45rem, 0.86em), **7 font weights** (400, 500, 600, 640,
650, 700, 750), **12 foreground colours**, and **4 distinct badge/chip shapes**.

The meanings that vocabulary has to encode: identity, activity, outcome, liveness, control
availability, warning, evidence, action. **Eight.** Weight 640 exists for exactly one class
(`.vital-big`); labels oscillate between 650/700/750 with no corresponding change in meaning.
The `chip provider-…` class on the provider node defines no chip treatment at all — it
inherits `.inspector-sub`, so a class that looks semantic is decorative.

### 1.5 Computed by the backend, never rendered

This is the cheapest available win: the data already exists and ships in the snapshot.

| Signal | Where it is computed | Drawer status |
|---|---|---|
| **Stalled verdict** — `pulse.momentum.stalledAgentIds`, `stallThresholdMs` | `pulse.ts` marks a healthy live agent stalled after 15 min without an `updatedAt` advance | Drawer never reads `snapshot.pulse`. **The "is it stuck?" answer is computed and discarded.** |
| Issues affecting this agent | `OperatorIssue.affectedAgentIds`, `.workState`, `.progress`, `.impactSummary` | Drawer destructures only `{ agent, program }`; never filters `snapshot.issues` by `agent.id` |
| Program health around the agent | `program.rollup` (`working`/`needsYou`/`blocked`/`failed`) | Head renders only `programName`; `renderOperate(agent, _program)` explicitly ignores the argument |
| `contextPct` | `snapshot-agent.ts` derives it scope-correctly (`total` for latest-turn, `sessionTotal` for session) | Drawer ignores it and recomputes a ring only for `latest-turn`, so session-scoped occupancy is lost |
| `effort` | collected, normalized by `effortFor`, emitted | `Session meta` renders only `role` and `model` |
| `subagentCount`, `threadDepth` | Cursor counts child transcripts on disk | Lineage reconstructs children from `parentAgentId` only, caps at 5 |
| `ModelPolicy.observed` / `.evidence` | `cursorModelPolicy` computes all four fields | `modelPolicyView` drops two; `unreported` state is silent |
| All `gates[]` | outcome classification reads the whole array | Drawer shows only `gates[0]`, truncated to 64 chars, rest unreachable |

---

## Part 2 — The proposal

### 2.1 Kill the Operate tab

`Operate` is not worth one of two permanent columns. It holds four things, and three are
duplicates: `Last human message` (Chat has it), the outcome note (the verdict has it),
`model` (the head chip has it). Only `role` is unique, and it is one word.

Its cost is real: the shelf gives it an equal-width column and enforces a 14rem minimum
height, and it is the narrower of the two columns on a panel that is already narrow — while
Chat, the only genuinely long-form content, is squeezed beside it.

**Do not manufacture a replacement second tab.** The two open regions during normal
supervision should be the condensed head and Chat.

### 2.2 Collapse six attention surfaces into two

1. **One always-present verdict line.** Activity, plus *exception-only* outcome, liveness,
   model-policy and gate. Routine `Healthy`, `Ready` and `Process live` are cut: the absence
   of an intervention card and the presence of enabled controls already say them. Silence is
   the healthy state.
2. **One conditional intervention card.** Renders only when a human decision is required.
   Carries the canonical `statusReason`, the concrete gate, `Acknowledge`/`Dismiss`/`Snooze`,
   and — when routing is *independently* broken — the control `why`, recovery step, and the
   evidence link. Absent otherwise.

Delete `Next` entirely.

### 2.3 Recommended DOM order

1. **Condensed head.** `agentName`; `role`; program *with rollup exceptions only*;
   provider/model chip; meaningfully-different `task`; one verdict line; `Close`.
   No duplicate Focus/Interrupt.
2. **Conditional intervention card.** Nothing when nothing is wrong.
3. **Compact lineage.** Ancestors with role, untracked-parent warning, children with
   activity/outcome, overflow count. Drop the current-node name repetition.
4. **Chat, full width.** Latest `User` and `Assistant` turns. No transcript path.
5. **Collapsed Evidence.** One plain button — not a decorative caterpillar rail. Behind it:
   uptime/last-update, token detail, context numerator and denominator, cwd and terminal
   folder, git, control link and copyable IDs, identity trace, terminal collisions, Names,
   artifacts, on-demand transcript. Drop `Transcript tail` (an arbitrary 800-char slice
   sitting beside the readable transcript).
6. **Sticky command dock.** Stale-feed diagnosis, control feedback, last operator action,
   instruction field, `Send`, `Focus`, `Interrupt`, `Archive`. Drop `Ready · linked` and the
   permanent `⌘↵ to send` chrome.

### 2.4 Visual system

Cut to **4 type sizes** (title, body, label, caption), **3 weights** (400/600/700), and
**one state-colour ramp** reused everywhere rather than per-widget colours. One badge shape,
not four. Every remaining colour must map to exactly one meaning; if two treatments encode
the same meaning, one is decoration.

Of the seven vitals tiles: `Uptime` and `Last update` duplicate the roster and go to
Evidence; `Session tokens` and `latest call` are raw and go to Evidence; **`Context` is the
only tile that earns permanent space**, because it is the only one that predicts a failure
the operator can pre-empt.

---

## Part 3 — What to add (ranked)

| Gap | Signal | Data | Impact | Cost |
|---|---|---|---|---|
| Is this agent stuck? | Stalled badge + time since real progress | `pulse.momentum.stalledAgentIds` **already computed** | High | Wire only |
| Is its problem shared? | "3 other agents blocked by this" | `issues[].affectedAgentIds`, `impactSummary` | High | Wire only |
| Is the program healthy? | Peers needing attention | `program.rollup` | High | Wire only |
| Real context occupancy | Server-scoped `contextPct` | `AgentSnapshot.contextPct` | Med | Wire only |
| Why exactly are controls locked? | `target.reason`, `controls[].reason` | Already on the wire; UI shows generic prose | Med | Wire only |
| Is it burning tokens without output? | Per-agent token velocity | `PulseTracker` already keeps per-agent deltas; publishes fleet-wide only | High | Derivable |
| Who owns the wait — me or it? | `waitOwner` + `waitingSince` | Partly derivable from notifications/gates | High | Needs collection |
| What changed on disk? | Changed files, diff stat, commits since start | `git` carries only branch/dirty/head | High | Needs collection |
| Did its tests pass? | `tests` state + failing summary | Field is **declared in types but no collector produces it** | High | Needs collection |
| Are two agents duplicating work? | Task fingerprint + changed-file overlap | `cwd` + `git.branch` gives a weak candidate only | Med | Needs collection |

The top five are free. An orchestrator cockpit that cannot say "this agent has been stalled
for 40 minutes" while the backend is already computing exactly that is the single largest
miss in the current design.

---

## Part 4 — Where this proposal could be wrong

Stated plainly so the frontend lane can push back with evidence rather than taste:

1. **"Keep roster, cut drawer" assumes the roster row stays visible.** Every
   `Uptime`/`Last update`/`Died` cut above depends on the selected row remaining on screen
   beside the drawer. If the drawer ever covers the roster on narrow viewports, those cuts
   are wrong and the fields must come back.
2. **Killing Operate is the most aggressive call here.** The counter-argument is that a
   named tab is a place to *grow* into. I judge that speculative: today it is three
   duplicates and one word.
3. **Silence-as-healthy has a failure mode.** If the verdict line renders nothing, an
   operator cannot distinguish "healthy" from "the panel is broken". The verdict line must
   always render *something* — activity at minimum — even when all exceptions are absent.
4. **The 4-size/3-weight target is a budget, not a measurement.** It is asserted from the
   count of meanings, not tested against the rendered board.
