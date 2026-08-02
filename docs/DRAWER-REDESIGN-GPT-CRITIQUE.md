# Adversarial critique of the Claude lane's drawer overhaul

**Scope.** Reviewed at `f7e26b1`. The Claude lane's committed drawer artefacts are
`bb5cb3c` (`tests/overhaul-guards.test.ts`, 511 lines) plus the pre-existing B2/B3 pins in
`tests/web-client.test.ts`. Their implementation is **still uncommitted** — `src/web/app.js`
and `src/web/styles.css` are dirty in the shared tree — so this critiques the design as
expressed in the assertions they chose to commit, which is the part they have actually
committed to.

Companion to `docs/DRAWER-REDESIGN-GPT-LANE.md`, written before seeing any of this.

---

## 0. State of the work: the guards are red

Eight tests fail right now, seven of them theirs and drawer-specific:

```
(fail) agent drawer: condensed by default … > the drawer paints the agent it was handed
(fail) agent drawer: condensed by default … > the two token magnitudes it reports are labelled apart
(fail) agent drawer: condensed by default … > the context figure is shown against its window, never bare
(fail) verdict head — act from the top (B2) > drawer order: verdict head → banner → next action → vitals mount → shelf → lineage → dock
(fail) verdict head — act from the top (B2) > the head carries the gate chip and one primary-action control
(fail) vitals instrument band (B3) > (a) renderVitalsBand is exported and renders mono-classed values
(fail) vitals instrument band (B3) > (b) missing vitals render honest fallbacks
(fail) FE-B: harness-backed client behavior > (8) every class in styles.css is emitted by the client
```

Not a criticism of the design — it is mid-flight. But it matters for reading everything
below: **the B2/B3 order pins are being broken by their own in-progress edit**, so the
structure those tests lock may already be under renegotiation. Where I say "they pinned X",
read it as "the committed assertions still require X".

The last failure is worth separating: `every class in styles.css is emitted by the client`
means CSS now exists for markup nothing renders. That is the signature of a restyle landing
ahead of the markup change, and it is exactly how a drawer accumulates dead visual
vocabulary — the thing my proposal measured at 15 type sizes and 12 colours.

---

## 1. Credit where it is due

Three of their committed guards are genuinely good, and better than a design document,
because they are executable:

- **`raw detail ships collapsed, so the drawer opens as a summary`** — this is Emilio's
  brief turned into a test. My proposal argues the same thing in prose; theirs will fail the
  build if someone quietly un-collapses Evidence.
- **`a collapsed disclosure still says what it hides`** — a real trap avoided. A collapsed
  section that does not label its contents is worse than an open one, because the operator
  cannot decide whether to pay the click.
- **`Neither magnitude may appear more than once`** in the token test. I initially misread
  this as enshrining duplication; it is the opposite — a proper anti-repeat property, and
  the correct shape for a guard. Credit withdrawn from my first reading and given here.
- **`severity is only ever error or warning, so the UI can rank it`** — pushes an
  invariant down to where it can be enforced rather than trusting the renderer.

Their instinct to encode the overhaul as *properties over rendered output* rather than
snapshots is right, and it is a better mechanism than the prose I shipped.

---

## 2. Where they are wrong

### 2.1 They pinned `next-action` into the DOM order. It carries no information.

`tests/web-client.test.ts:2578` hard-requires `class: "next-action"` to exist and to sit
between the control banner and the vitals mount.

`agent.nextAction` is generated server-side by `nextActionFor(activity, outcome,
controlState)` in `src/server/snapshot-agent.ts`. All three inputs are already rendered
above it. Concretely:

| `Next` says | What is already on screen directly above |
|---|---|
| `Monitor current work.` | `Working` in the status line |
| `Resolve the reported blocker.` | `Blocked` + the gate chip |
| `Review the latest notification.` | `Alert` + the attention block's own buttons |
| `Resolve the cmux identity conflict to enable controls.` | the control banner's `nextStep` |

It is a rendered tautology, and on a healthy agent it is the third widget in a row whose
job is to say nothing is wrong. Emilio's brief says *no repeat info under different labels*.
This is repeat info under a different label, and their guard now makes deleting it a
test failure.

**Worse:** when an agent is both blocked *and* quarantined, `nextActionFor` returns the
blocked sentence, because blocked outranks quarantine. So `Next` silently picks one of two
independent problems and does not say which. Pinning it institutionalises that ambiguity.

### 2.2 They pinned a duplicate control into the head

`the head carries the gate chip and one primary-action control` requires `headPrimaryAction`
to render Focus/Interrupt in the verdict head, while `renderCommandDock` renders the same
capability from the same `controls[]` array at the bottom.

The strongest evidence against this is in their own codebase: the source comment at the head
action site calls it **"a copy"**. A cockpit with two Focus buttons for one agent is not
condensed; it is two chances to mis-click, and it spends head space — the most valuable space
in the panel — on something already permanently available in the sticky dock.

### 2.3 "Labelled apart" solves the wrong half of the token problem

Their guard requires both `120k` and `480k` to render, each exactly once, under wording that
distinguishes turn from session.

That fixes *ambiguity*. It does not fix *presence*. Emilio asked for **no unnecessary info in
the main two tabs**. Cumulative session tokens is not something an orchestrator acts on
mid-flight — it is a number you read once at the end. Context occupancy is different: it
predicts a failure you can pre-empt by intervening now.

My position: `Context` is the only token figure that earns permanent space; `Session tokens`
belongs behind Evidence. Their guard freezes both into the always-visible drawer. Two
correctly-labelled numbers are still one number too many.

### 2.4 The vitals mount is pinned, but the band is the densest duplication site in the drawer

`vitalsAt` is required to exist between next-action and the shelf. The band renders up to
seven tiles, of which:

- `Uptime` restates roster `Elapsed` (same `elapsedMs`)
- `Last update` restates roster `updated … ago` (same `updatedAt`)
- `Session tokens` restates Evidence `session total` (same `tokens.sessionTotal`)
- `Latest call` / `Tokens` restates Evidence `latest call` (same input/output/cached/total)
- `Context` encodes one quantity twice inside itself — a percentage ring **and** the raw
  `total / contextWindow` fraction

Five of seven tiles are re-labellings of values on screen elsewhere. Pinning the mount's
position before resolving what belongs in it locks the slot for a widget that mostly should
not exist.

### 2.5 The Operate tab survives unchallenged

Nothing in their committed guards questions the shelf's two-open-column structure. `Operate`
holds exactly four things:

- `Last human message` — **also rendered in Chat**, which explicitly falls back to
  `lastHumanMessage` when `lastUserMessage` is absent. The same sentence, in both open tabs,
  simultaneously.
- outcome note — restates outcome + `statusReason`, already split across verdict/gate/attention
- `model` — restates the head chip
- `role` — the only unique datum, and it is one word

It costs an equal-width column and a 14rem minimum height on a narrow panel, and it squeezes
Chat, the only genuinely long-form content. "No unnecessary info in the main two tabs" is
hard to satisfy while one of the two tabs is three duplicates and a word.

### 2.6 Source-text assertions will fight the redesign

`drawer order` works by `indexOf` against the **source text** of `app.js`
(`drawer.indexOf('class: "next-action"')`). This pins implementation strings, not behaviour.
Two consequences:

1. It fails on refactors that change nothing an operator sees — which is why it is red right
   now, mid-extraction.
2. It makes *removing* a widget a test failure rather than a design decision, which inverts
   the intended relationship: the guard should protect the operator's experience, not a
   particular line of code.

Their newer `overhaul-guards.test.ts` gets this right by asserting over `textOf(nodes[0])`.
The B2/B3 pins should be migrated to that style or retired.

---

## 3. What neither lane's guards cover: the signals already computed and thrown away

No committed test on either side asserts that the drawer reads any of this, and all of it
already ships in the snapshot:

| Signal | Already computed at | Drawer status |
|---|---|---|
| **Is this agent stuck?** | `pulse.momentum.stalledAgentIds`, 15-min threshold in `pulse.ts` | drawer never reads `snapshot.pulse` |
| Is its problem shared with other agents? | `issues[].affectedAgentIds`, `.impactSummary`, `.workState` | drawer destructures only `{ agent, program }` |
| Is the surrounding program healthy? | `program.rollup` | head renders `programName` only; `renderOperate(agent, _program)` ignores the argument |
| True context occupancy | `AgentSnapshot.contextPct`, scope-correct server-side | drawer ignores it and recomputes a ring only for `latest-turn` |
| Why exactly are controls locked? | `target.reason`, `controls[].reason` | UI shows generic `IDENTITY_CAUSES` prose instead |

An orchestrator cockpit that cannot say *"this agent has been stalled for 40 minutes"* while
the backend is already computing precisely that is a larger miss than anything in the
styling. The overhaul is spending its effort on the surfaces that are already too loud and
none on the one question the operator most needs answered.

---

## 4. Recommendation to the frontend lane

Ranked, cheapest first:

1. **Delete the `next-action` line** and drop its order pin. Let the state-owning widget
   carry the one instruction.
2. **Delete the head primary action.** The dock already has it; your own comment says so.
3. **Move `Session tokens`, `Uptime`, `Last update` and the raw latest-call breakdown behind
   Evidence.** Keep `Context` as the single permanent vital.
4. **Collapse Operate into the head** (`role` + meaningfully-different `task`) and give Chat
   the full width.
5. **Wire `pulse.momentum.stalledAgentIds`** into the verdict line. One field, highest
   operator value in the whole panel.
6. **Migrate the B2/B3 source-text pins** to rendered-output properties, so the redesign can
   proceed without fighting its own tests.

Items 1–4 are deletions. If the overhaul lands without net deletion, it has not met the
brief — "condensed" is a subtraction, and a drawer that gains a coat of paint while keeping
six narrators of one state is the same drawer.

---

## 5. Where this critique could itself be wrong

- I am reviewing **assertions, not the implementation**, because the implementation is
  uncommitted. If their dirty `app.js` already deletes `next-action` and the head action,
  then §2.1 and §2.2 are criticisms of stale pins they are in the middle of removing — and
  the guards simply have not caught up. Their red suite is consistent with that reading.
- Every "it duplicates the roster" argument (`Uptime`, `Last update`, `Died`) assumes the
  roster row stays visible beside the open drawer. On a narrow viewport where the drawer
  covers the roster, those cuts are wrong and the fields must return.
- I have not seen the rendered result. The Claude lane has. Taste calls about spacing and
  rhythm should go to whoever is looking at pixels; the arguments above are deliberately
  restricted to field-level duplication and information content, which can be settled from
  the source.
