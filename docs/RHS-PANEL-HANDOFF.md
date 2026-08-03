# Right-hand panel overhaul — handoff

**Written 2026-08-03 21:00 CEST**, at the end of a six-lane session, for whoever picks
this up next. Branch `fix/backend-silent-failures-and-freshness`, **17 commits ahead of
its remote, 181 ahead of `main`, nothing pushed.**

The subject is the panel that opens when an operator clicks an agent — the "agent
drawer" or inspector. Emilio's standing brief for it, stated twice and worth keeping in
front of you:

> No repeat info under different labels. No unnecessary info in the main view — the
> collapsed evidence drawer is still the place for that.

---

## Read this first: how to verify anything here

This repo has spent two days learning that **an instrument which stops showing a problem
is not the same as the problem being gone.** Three concrete traps, all of which fired on
someone this week:

- **`npx tsc --noEmit | tail -1; echo $?` reports `tail`'s exit code, not tsc's.** Every
  "tsc clean" from that shape is an unexamined reading. Use `npx tsc --noEmit > /tmp/o 2>&1; echo $?`
  or `${PIPESTATUS[0]}` / `${pipestatus[1]}`.
- **`git show <sha> | grep foo` matches the commit MESSAGE as well as the diff.** I
  reported a fix as landed on that basis and was wrong. Use `git diff <sha>^ <sha> -- <path>`.
- **`test.failing` markers go green when the evidence ages out of view.** Two bounds
  checks "passed" this week because the rows proving the defect scrolled past a 500-row
  cap, not because anything was fixed. Bun reports a `.failing` test that passes as a
  failure; treat that as "re-investigate", never as "fixed".

## Current state

```
1695 pass · 2 fail (consistently) · tsc exit 0 · tree clean but for docs/rhs-shots/lane6-be/
```

The two consistent failures are **Emilio's decision, not a bug to fix** — see Open
Decisions. Two more tests (`anthill-scripts`, `deploy-health`) flake under full-suite
load only and pass in isolation; don't chase them.

---

## What landed (17 commits)

Every one carries a measured number rather than an assertion that something looks better.
That was deliberate and worth continuing.

### The panel's head — identity
- `89ceec3` say provider, program and model **once**, not twice. The H1 read
  `Cursor · LaHormigaDormida` while the line two rows below read
  `LaHormigaDormida · Cursor · grok 4.5`.
- `c489040` liveness chip states a fact instead of promising a check — **then reverted**
  by `4d81fe5` when it broke two drawer tests. Reverting rather than patching around was
  the right call; the wording work is unfinished and available.
- `0f9c643` `realModelName` strips placeholder tokens (`<synthetic>`, `unknown`, `none`)
  from the model slot. Verified against 2 live agents carrying `<synthetic>`.
  (`51821cb` carries this commit's *message* but contains lane 4's work — see Known Defects.)

### The controls and the blocked state
- `f6b9f82` one cause said once, on the **245 rows** that said it three times. The banner
  had four sentences for one fact, the first repeating itself verbatim.
- `93db962` Send stops looking primary on the **724 rows** that cannot send. It rendered
  solid-black highest-emphasis while the composer beside it read "Instruction unavailable".
- `3e870e5` (server) refusal restructured into `cause | remedy | evidence` as separate
  addressable fields + 85-line `tests/control-refusal-shape.test.ts`.
- `716bddf` (server) routing evidence publishes the scanned **observations**, not just the
  conclusion — 20 panes, each with its session IDs and why it did or did not match.

### The thread
- `9bc9d04` test asserts the user message is **present exactly once** rather than **first**.
  The old assertion incidentally pinned reading order, which broke the moment the agent's
  reply was promoted to lead the thread.
- `a2515fd` transcript opens at the newest turn and survives the repaint that rebuilds it.

### Evidence and disclosure
- `0bf8698` the collapsed rail says what it holds and how much. It was "a cog, four
  decorative beads and the word EVIDENCE rotated ninety degrees at 10px".
- `51821cb` `"More"` became `"Archive this session"`. **Read this reasoning before touching
  it**: the lane considered folding `More` into the evidence rail and refused, because the
  rail holds things to READ and this holds one thing to DO — collapsing them would put a
  destructive control inside a drawer labelled "evidence". Two doors onto different
  content is correct here; it is not the repeat-info problem.

### Panel behaviour
- `267afa0` the scroll offset outlived the agent it belonged to — one agent's scroll
  position persisting onto the next.
- `28d22ac` a control that renames itself stopped stranding focus on `<body>`.
- `38e7a8e`, `ab88744` before/after screenshots in `docs/rhs-shots/`.
- `d7de1a7` backend handoff — **read `docs/RHS-6-BACKEND-HANDOFF.md`**, it is the best
  artefact of the session and separates verified / assumed / left-open explicitly.

---

## Known defects and unfinished work

**The placeholder guard was applied to the head but not to the list row.** The drawer now
reads correctly while the row behind it still prints `<synthetic>`. Same leak, one surface
over. Lane 4 was capturing a drawer-correct/row-wrong screenshot pair and naming the
rendering function in its commit body when it ran low on context — check for that commit.
**This is the single best next task.**

**`51821cb` is mis-attributed.** Its message says "a placeholder is not a model name";
its content is the `More` → `Archive this session` change. The real placeholder fix is
`0f9c643`. Two commits this session were mislabeled this way — content correct, authorship
wrong — because four lanes edited one file and staged adjacent hunks.

**The liveness-chip wording is unfinished**, reverted in `4d81fe5`. Whoever retries it must
keep `W4-B (3) the drawer states all four verdicts, so unknown reads as unknown` and
`W5-B (1) a real processState reaches the row and the drawer` green.

**`state.transcript` is single-agent by design** — switching agents discards the transcript
rather than resetting scroll. Reversing it means holding every agent's transcript in
memory. Reported deliberately without acting; it is an architecture tradeoff, not a bug.

**The routing observations add +55,384 bytes per snapshot (~4.1%)**, and the observation
list repeats under every active refusal. The SSE payload was already 2.23 MB against a
backlog budget fixed earlier today (`26199b3`). Deduplicating the shared surface inventory,
or moving detail fully on-demand without losing operator-visible proof, is the named
first pick-up in the backend handoff.

**Production still serves the pre-change server shape.** Lane 6 deliberately did not
restart or deploy. The launchd service is `ai.imaginethat.anthill` on `:4701`; restart with
`launchctl kickstart -k gui/$UID/ai.imaginethat.anthill`. **Never restart while `src/` has
uncommitted work.**

---

## Open decisions — Emilio's, not yours

1. **The two cross-source failures.** `tests/cross-source-token-agreement.test.ts` fails
   when the fleet is busy and passes when it is quiet — seven sessions disagreed at peak,
   board-higher by 203%–23,505%. I removed its `.failing` marker at 17:46 after verifying
   it passed on a paged window; **that was premature** — the check is volatile, not
   resolved. Either re-mark it `.failing` (suite green, defect recorded) or leave it red as
   a standing signal. The failure text is honest and points at
   `/api/debug/session-calls` and `docs/CROSS-SOURCE-DRIFT-FINDING.md`. Do not loosen the
   5% tolerance — that tolerance is the claim.

2. **A single committer for `app.js`.** Lane 4's proposal after the second mis-attribution.
   Alternatives: serialize `app.js` to one lane at a time (clean history, slower), or give
   each lane its own git worktree (parallel, merge later). Hunk-staging is the current
   workaround and it stopped commits *swallowing* other lanes' work but not *mislabeling*.

3. **PR #5** — 181 commits above `main`, open, `MERGEABLE / CLEAN`. Explicitly his call and
   has been all week. Nothing here is pushed.

---

## The lanes, and how to drive them

Six cmux surfaces worked one shared checkout. **Ownership is by FUNCTION NAME, not line
range** — my original line ranges were wrong because `renderControlBanner` (5419) and
`renderVitalsBand` (5805) sit physically inside ranges I had assigned elsewhere. The
corrected map is in the session scratchpad as `BOUNDARIES.md`; regenerate it with:

```bash
awk '/^function /{print NR": "$2}' src/web/app.js
```

| Lane | Surface | Owns | Context left |
|---|---|---|---|
| L1 head | `6D6ED113` | `renderInspector`, `drawerSessionTag`, `drawerObjective`, `headSubParts`, `realModelName` | **3% — retired** |
| L2 controls | `918B3318` | `renderControlBanner`, `renderCommandDock`, `renderDockTool`, `renderAttentionBlock` | 49% |
| L3 thread | `6A4A8619` | `renderChat`, `renderChatTurn`, `dedupeTurns`, `transcript.js` | **8% — retired** |
| L4 evidence | `D36D3BB4` | `renderShelfSection`, `renderEvidenceShelf`, `renderNamesDisclosure`, `renderVitalsBand`, `renderEvidence` | 15% |
| L5 shell | `6801849F` | `presentation.js`, `agent-model.js`, `client-state.js`, plus `render()`'s focus loop | 72% |
| L6 backend | `F8E4D3F1` | `src/server/` only | retired, handed off |
| L0 | `7A736BC8` | — | **SPEND-BLOCKED all session; needs Emilio** |

**Driving a lane.** Long prompts get collapsed into a paste and never submit. Write the
brief to a file and send a short pointer:

```bash
CMUX=/Applications/cmux.app/Contents/Resources/bin/cmux
$CMUX rpc surface.send_text '{"surface_id":"<UUID>","text":"Read /path/brief.md and follow it."}'
sleep 2
$CMUX rpc surface.send_key '{"surface_id":"<UUID>","key":"Enter"}'
```

If a pane wedges showing "Press up to edit queued messages", `escape` then `ctrl-c` then a
fresh short message clears it; a bare `Enter` does not.

**Launch new lanes with the cmux CLI, not the Ant Hill.** Claude for frontend, `sol 5.6`
(= `gpt-5.6-sol`, confirmed at `src/server/model-config.ts:34`) for backend:

```bash
cmux new-workspace --name "<lane>" --cwd /Users/emilionunezgarcia/Developer/the-mountain-main --command "claude"
cmux new-workspace --name "<lane>" --cwd /Users/emilionunezgarcia/Developer/the-mountain-main --command "codex -m gpt-5.6-sol"
```

Freshly-created workspaces do **not** inherit the permissive mode the older panes have —
one lane blocked six times on read-only `curl`, `sed -n`, `tsc` and `bun test`. Cycle to
auto mode with `shift-tab` and **check the mode after each press**: the cycle passes
through plan mode, which is worse.

---

## Process lessons worth keeping

**Land early, not when finished.** Two lanes came within one turn of losing completed work
at 98–99% context. A committed guard without its screenshots beats a verified one that
never landed. Watch the context bar and push lanes to commit at ~20%.

**"Stage your own files by path" does not work when four lanes share one file.** Use
`git add -p` and verify before committing:

```bash
git diff --cached -U0 -- src/web/app.js | grep '^@@'
```

**Never `git stash` while lanes are live.** I did it once to attribute a failure; it could
have pulled work out from under four active writers. A read-only `git diff` inspection
answered the same question and risked nothing.

**Refuse destructive commands from lanes.** One asked to run a mutation test whose restore
step was `cp app.orig.js src/web/app.js` — that would have wiped three lanes' uncommitted
work. Mutate a scratch copy instead.

**Verify before relaying.** A lane's report is evidence, not fact. Lane 4 correctly caught
a mislabeled commit I had signed off on; a lane's claim that "the gate is red" was accurate
and well-attributed. Both were worth checking, and checking cost one command each.

## Suggested order of work

1. Fix the row-level `<synthetic>` leak (highest value, precisely scoped, evidence already captured)
2. Get Emilio's call on the two cross-source markers so the suite has an unambiguous green
3. Dedup the +55 KB routing observations against the SSE payload
4. Retry the liveness-chip wording, keeping the two W4-B/W5-B tests green
5. Decide the `app.js` committer question before running four lanes in that file again
