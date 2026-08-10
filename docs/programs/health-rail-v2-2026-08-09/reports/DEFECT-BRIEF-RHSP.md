# RHSP Defect Brief — three drawer defects (operator-reported, 2026-08-09 18:24)

You just shipped the Task Widget anatomy in this worktree — same drawer tree, so you have the context. Fix these three defects on THIS branch (`feat/tw-ui-anatomy`), RED test first per defect, one commit per defect. Ground rules from `docs/programs/health-rail-v2-2026-08-09/GROUND-RULES.md` still bind (path-scoped commits, never push/amend, lane report).

**Fence for this brief:** `src/web/app.js`, `src/web/transcript.js`, `src/web/styles.css`, `tests/web-client.test.ts` — **drawer/chat region ONLY**. A parallel lane owns the health-rail region of the same files right now: do NOT touch `renderHealthRail`, `renderHeartbeatTldr`/`renderHealthTldrLane`, `parseHeartbeatStructured`, the `.health-rail`/`.heartbeat-*`/`.tldr-*` CSS sections, or `index.html`. If a fix seems to need those, STOP and report.

## Defect A — Cursor-harness drawer is completely blank

Repro: open the drawer for a Cursor agent (e.g. a `cursor:*` lane session). Below the head + "No matching process" pill the panel is EMPTY — no task widget, no feed, no empty state (operator screenshot: totally blank pane).

Likely shape: the bubble feed and/or task block render nothing when the agent has no `transcriptTail`/no dedupable turns (cursor collector supplies different evidence), and there is no empty-state branch — silence instead of honesty.

Acceptance (RED test with a cursor-shaped fixture: no transcriptTail, no humanMessages):
- The drawer ALWAYS renders the Task widget (or its honest `— no task recorded` face) and the dock cluster.
- An empty feed renders an explicit quiet state (e.g. "No readable turns recorded for this session yet") plus the transcript foot ("Read the transcript" / "No transcript file is recorded"), never a blank region.
- Nothing invents turns; absence is stated, not faked.

## Defect B — Prime/Claude/Codex chat feed compressed into a tiny area

Repro: drawer for a Prime/Claude/Codex agent — the bubble feed collapses to a sliver; duplicated section chrome ("TRANSCRIPT — LAST 3 TURNS (EXPAND FOR FULL)" heading AND a second "TRANSCRIPT" heading) with dead space below (operator screenshot).

Acceptance (RED tests):
- The feed (`.drawer-chat-scroll` / `#drawer-chat-feed`) GROWS to own the Document column's height (the `min-height: 16rem` floor holds; flex chain lets it fill), instead of sizing to its two bubbles while the pane shows dead space.
- Exactly ONE transcript section heading renders — kill the duplicate.
- Existing scroll-ownership and overhaul-guard tests stay green (they pin the contract — do not weaken them).

## Defect C — RHSP sticks at the top while the left panel scrolls

Operator words: "the RHSP doesn't effectively or beautifully float while the left hand side panel moves/progresses. It stays stuck at the top. The content of the RHSP should always be vertically centralized vs what's on the left."

Acceptance (≥1025px float mode; RED test on the rules + behavior where testable):
- While the left column scrolls, the drawer stays fully in view (sticky within the desk column, never scrolled out the top).
- When the drawer is SHORTER than the viewport, it rides vertically centered in the viewport (a small ResizeObserver/JS assist setting a CSS variable is acceptable; no timers, no scroll-jacking of the left column).
- When the drawer is TALLER than the viewport, it pins with a comfortable gap (~1.25rem) and its internal regions scroll per the landed contract — the document never scrolls horizontally and body scroll ownership rules stay untouched.
- Reduced-motion safe: no animated following.

## Verification

- `bunx tsc --noEmit` clean; `bun test` — fails allowed ONLY in `tests/cross-source-token-agreement.test.ts` (foreign OBB).
- Visual proof required (frontend rule): headless Chrome screenshots at 1440×1000 and 860×1200 of (1) a cursor agent drawer, (2) a codex/prime agent drawer mid-scroll showing the centered float. Save under `.lane-evidence/` and reference paths in the lane report.
- Update `LANE-REPORT-tw-ui.md` with a new section "RHSP defects" holding the pasted floor output + evidence paths.

Commit messages: `fix(drawer): honest empty state for turn-less agents`, `fix(drawer): chat feed owns the document column height; single transcript heading`, `feat(drawer): sticky centered float against the left panel scroll`.
