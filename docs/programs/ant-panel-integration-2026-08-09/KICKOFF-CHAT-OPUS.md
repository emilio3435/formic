# Chat Opus Kickoff

Goal: Implement the planned mini-chat bubble feed in the right-hand Ant Hill drawer while preserving current agent selection, transcript ownership, and structured TL;DR behavior.

Success means:
- `LANE-REPORT-chat.md` exists before product edits and names the red claims, file fence, and exact verification floor.
- Loaded user and assistant turns render exactly once as accessible chat bubbles in chronological order.
- Loading, error, empty, stale, and wrong-agent transcript states remain explicit and cannot leak another agent's transcript into the selected drawer.
- Opening a drawer auto-loads its transcript at most once per selected agent, while the existing manual retry/read affordance remains available in a quiet feed footer.
- The old duplicate transcript shell is removed only where the new feed replaces it.
- Structured TL;DR cards and the current 65/35 drawer contract remain intact.
- `bun test tests/web-client.test.ts tests/b2-render-proof.test.ts tests/overhaul-guards.test.ts` and `bunx tsc --noEmit` pass in the lane worktree.
- One local commit contains only `src/web/app.js`, `src/web/transcript.js`, `src/web/styles.css`, and `tests/web-client.test.ts`; the lane report records the commit SHA separately and is not committed.

Stop when: `LANE-REPORT-chat.md` records the local commit SHA and exact floor output, or names a precise blocker.

Resume the existing Claude/Opus mini-chat session. Read `GROUND-RULES.md`, `SPEC.md`, the mini-chat plan, current exports, and immediate callers before editing. Work only in the kickoff worktree. Keep scratch in `.lane-evidence/`. Do not use the shared browser daemon; browser QA remains integration-owned. Commit locally and never push.
