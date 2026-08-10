# Lane P1 — Heartbeat tail backstop (server)

Mission: heartbeat TL;DR envelopes ride `transcriptTail` and die head-first under `slice(-800)`; give envelope-shaped tails a generous cap via one shared helper applied at all three truncation sites. This is **Task 1** of `docs/superpowers/plans/2026-08-09-health-rail-tldr-v2-implementation.md` — execute exactly that task's steps (RED test first), nothing more.

Read first: `docs/programs/health-rail-v2-2026-08-09/GROUND-RULES.md` (your fence is row P1), then the plan's Task 1, then the current code at the cited sites (`src/server/types.ts` MAX_TRANSCRIPT_TAIL_CHARS; `src/server/prime.ts` assistant-tail slice; `src/server/collectors.ts` transcriptTail slice; `src/server/snapshot.ts` transcriptTail re-slice — locate by symbol, lines have shifted).

Non-negotiables:
- `capTranscriptTail` exported from `src/server/types.ts`; rule: tail matching `/^\[TL;DR\s/` after trimStart caps at `MAX_HEARTBEAT_TAIL_CHARS = 6000`, else 800.
- Amend `tests/b2-render-proof.test.ts` cap tests exactly as the plan's Task 1 Step 4 says — the envelope fixture is now preserved, the non-envelope fixture still caps at 800.
- New tests in `tests/health-rail-v2-server.test.ts` (your file; the plan has the code).

Definition of Done: plan Task 1 checkboxes all done; floor green per ground rules (3 foreign OBB reds only); one local commit `feat(server): heartbeat envelope tail backstop via capTranscriptTail` scoped to exactly your fence row; lane report section 4 holds pasted floor output. Commit locally, never push. Do not end your turn to check in; keep going until DoD or genuinely blocked.
