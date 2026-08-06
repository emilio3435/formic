# Clean up becomes a Cleaner agent — plan

> **Status: DRAFT — needs Emilio's ratify. One ruling reversal inside, called out rather than buried.**
> **Baseline:** `main` after `6338edb`. Clean up is proven wired end to end on a degraded board.
> Predecessor: `2026-08-05-confidence-header-and-notification-center.md` (S6, and ruling **R2**).

---

## 1. What exists, and the one line that has to change

Today the chip's Clean up action calls `POST /api/cleanup/propose`, gets a plan back, and renders it. **The board never executes.** That is ruling **R2** of the previous program, verbatim:

> A click in a browser is not the same gate as a person reading a plan in a terminal.

Emilio now wants the button to **launch a Cleaner agent** that runs the `/cleanup` skill, with the UX tracking that agent's real progress: *Examining → Launching → Resolving → Resolved.*

**That is a reversal of R2 and it must be ratified, not assumed.** What follows is the smallest version of it that keeps the reason R2 existed.

### R2′ — the revision, and why it is still safe

R2's fear was **an agent removing branches with no human in the loop**. It answered that by keeping the board incapable of deletion.

The Cleaner agent keeps the human in the loop by a different mechanism: **the agent is a visible lane on this very board.** It appears in Needs You when it wants approval, its transcript is readable, and the operator answers it the way they answer every other agent. The gate moves from "you must paste a command" to "you must answer an agent that is asking you" — which is the interaction this entire product exists to make reliable.

**What does not change:**
- The Cleaner **proposes, waits, and only then removes.** `git branch -d`, never `-D`. Per-item rollback SHAs. A live agent process inside a worktree is a hard stop.
- **No destructive HTTP endpoint, still.** The board launches an agent; it does not delete. `/api/cleanup/*` gains a spawn route and never a confirm route. The source-text test asserting destructive verbs are unreachable from the route stays exactly as it is.
- If the Cleaner cannot reach the operator, **it does nothing and says so.**

**⚠ Ratify or reject this section before any code.** If Emilio prefers the terminal gate, stages S2–S4 collapse to "the notification item shows the command" and the rest of the plan still stands.

---

## 2. The state machine — and the rule that keeps it honest

| State | Means | Evidence it is true |
|---|---|---|
| `idle` | offered, nothing running | chip degraded |
| `examining` | the propose sweep is enumerating | the in-flight POST |
| `launching` | a Cleaner lane is being spawned | spawn call issued, no session id yet |
| `watching` | the Cleaner is alive and working | **its session appears on this board** |
| `needs-you` | the Cleaner is asking for approval | `attentionClass: "blocking"` on that session |
| `resolving` | approved; removals executing | the Cleaner's own reported step |
| `resolved` | finished, with counts | the Cleaner's terminal result |
| `failed` / `refused` | it stopped, and why | its error or refusal text |

**The rule, non-negotiable:** every state is **read from the Cleaner's observable state**, never from a timer, never optimistic. This board already knows how to observe an agent — `attentionClass`, `hookLifecycle`, `lastAgentClosing` — and that machinery is the whole point. A progress indicator that advances on `setTimeout` is a lie with a spinner on it, and this codebase has spent a month removing exactly that class of defect (see `docs/S0-T1-DEAD-TIME-MEASUREMENT.md`: dead time was **deleted** rather than faked).

**If a state cannot be observed, it does not exist in the UI.** Better four honest states than eight decorative ones.

---

## 3. Stages

**S1 · The Cleaner lane contract.** What the board spawns: model per the routing table (**Grok 4.5 High Fast** — a mechanical sweep, ruling A7), the `/cleanup` skill, the existing `scripts/anthill-cleanup-sweep.ts` as its tool. It reports progress the way every other lane does; **no new telemetry channel.** If the board cannot see its progress through the ordinary session machinery, that is a finding about the board, not a reason to add a side channel.

**S2 · The spawn route.** `POST /api/cleanup/launch` — starts a lane, returns its session id, and nothing else. It cannot delete. It cannot confirm. Extend the existing source-text guard to cover it: `confirmCleanup`, `worktree remove`, `branch -d/-D`, `--force` remain absent from every file reachable from a route.

**S3 · Binding the lane to the chip.** The chip follows one session id. When that session appears in the snapshot, the chip's state is derived from it. When the Cleaner asks a question, the chip says so **and the notification center carries the ask** — it is a handoff item like any other, because it *is* one.

**S4 · The result.** Counts removed, counts refused with reasons, rollback SHAs, as a `dataflow` item. Unchanged from S6-T4 except that it now describes what happened rather than what could.

**S5 · The launch moment — flair, earned.** See §4.

**S6 · The chip's own geometry.** See §5 — Emilio reports the control still reads "off".

---

## 4. Delight, in this product's register

The design language is restrained on purpose: outline indicators, a left-edge signal rail, monospace only for identifiers. **Flair here cannot mean decoration** — a confetti burst on a board that manages 500 agent sessions would read as a toy.

Delight comes from **the machine visibly working on your behalf**, expressed with precision:

- **The launch has a beat.** The chip's ring completes one rotation and *lands* — a spinner that resolves rather than loops forever. Motion that terminates reads as competence; motion that repeats reads as waiting.
- **The Cleaner announces itself where agents live.** It appears as a row on the board, with its own name, and the chip hands off to it visibly — the operator watches a colleague arrive, not a progress bar advance. That is the delight: the fleet gained a worker and you can see it.
- **The verdict is a number, not an adjective.** "3 worktrees, 2 branches, 1 refused" beats "Cleanup complete!". This product's whole voice is that a count is honest where a word is not.
- **Nothing bounces.** Every motion respects `prefers-reduced-motion`, which is now genuinely testable — `Emulation.setEmulatedMedia` was added to the browse allowlist on 2026-08-06, so the reduce branch must be **measured**, not asserted.

---

## 5. Why the chip still looks wrong — diagnosis

Emilio: *"it just looks off."* Three things, and the third is the actual cause.

1. **It is appended to a heading.** The pill sits immediately after "Readings degraded" at verdict type size, so it parses as a **badge on the heading** — a label, not an action. Badges do not get pressed.
2. **It has no anchor.** It floats after a variable-length verdict word, so its x-position moves with the copy. Nothing in that card is aligned to it.
3. **It acts on the sentence below it, not the one beside it.** The thing needing cleanup is described in the *detail* line — `cursor GUI conversations: … · last healthy 5m ago`. The control is one line above its own subject.

**Recommendation:** move it to the **end of the detail line, right-aligned to the card's edge.** The verdict stays a reading, the action sits with the fault it acts on, and the card's right edge gives it a fixed anchor instead of a floating one. Vertically center it on the detail line's cap height, not the heading's.

Right-aligning it where it is (Emilio's suggestion) fixes #2 but not #1 or #3 — worth trying both and looking at them side by side, but the detail line is where I would put it.

---

## 6. Tests

- The chip's state is derived from a session, never a timer: a fixture where the Cleaner session is absent must **not** advance past `launching`.
- A Cleaner that dies mid-run leaves the chip in a stated failure, never a permanent spinner.
- The spawn route cannot reach a destructive verb (extend the existing source-text guard).
- Reduced motion: `setEmulatedMedia` reduce → the ring is static and the state is still legible. **Measured, not asserted.**
- Double-click launches one Cleaner, not two.
- A refusal from the sweep survives to the UI with its reason — a plan missing a refusal proposes deleting something it should not.

## 7. Open for Emilio

1. **Ratify or reject R2′** (§1). Everything downstream depends on it.
2. **Approval inside the Cleaner, or approval on the board?** The Cleaner asking as a normal agent is simpler and reuses everything. A board-level approve button is fewer clicks and more machinery.
3. **Chip placement** (§5) — detail line right-aligned, or right-aligned where it is.
