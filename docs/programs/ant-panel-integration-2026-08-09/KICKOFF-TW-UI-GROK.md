# Lane TW-UI — Task Widget DOM/CSS anatomy (Grok, fenced)

Mission: ship the Task Widget redesign's DOM/CSS anatomy on top of the landed chat tree, per the approved plan `docs/superpowers/plans/2026-08-09-task-widget-redesign.md` **as amended below**. The parser (Task 2, `parseTaskEnvelope` in `src/web/presentation.js`) and the Foundation (`rawTask` on `AgentSnapshot`, refiner sidecar in `snapshot.ts`) are ALREADY LANDED — consume them, do not re-implement.

Read first: `docs/programs/health-rail-v2-2026-08-09/GROUND-RULES.md` (your fence is row TW-UI; the floor and git discipline bind you), then the plan, then the current drawer code — the chat lane's "the feed IS the transcript" merge (`40e7099`) moved things: locate `_taskBlock` / `const fullTask` in `src/web/app.js` by symbol (~9642 in the chat tree), `withoutSenderHeader` in the `presentation.js` import block, `.drawer-chat-task` rules in `styles.css` (~2330 base, ~4295 provider rail).

## Binding amendment (supersedes plan Task 5 and the 25%-cap Global Constraint)

- The CLOSED widget face is intrinsically bounded by its anatomy: 2-line clamp on `.drawer-task-objective`, single `.drawer-task-meta` line, closed disclosure. NO height cap, NO widget-level scroller.
- The OPEN Full brief body (`.drawer-task-brief-body`) is the widget's ONLY scroller: `max-height` in rem (≈18rem) + `overflow-y: auto`.
- Do NOT touch body/stage/inspector-open scroll rules — those landed with the chat merge and are settled.
- The 25%-cap rule (`.drawer-doc .drawer-chat-task` in the ≥861px media tail) is superseded: remove it (or replace with an intrinsic-bound comment) in the same commit that ships the anatomy.
- Task 5's flex-shrink chain existed only to serve the cap — skip it. Base rule grid→flex is optional; prefer the SMALLER diff against the landed chat tree.
- `rawTask`: when `agent.rawTask` is present, the open Full brief shows the original task text (that is what the field exists for); the closed face shows the refined `task`.

Non-negotiables: RED test first for every behavior change (tests in `tests/web-client.test.ts` — append/adjust only what your diff breaks, plus `tests/task-envelope.test.ts` if envelope rendering needs cases); no `innerHTML` for task/transcript text; keep every disclosure shipped closed (`aria-expanded="false"` or `details` sans `open` — `tests/overhaul-guards.test.ts` pins this and is NOT yours to edit).

Definition of Done: plan Tasks 1, 3–6 (as amended; 2 landed) implemented; floor green per ground rules (3 foreign OBB reds only); local commits path-scoped to your fence row; `LANE-REPORT-tw-ui.md` section 4 holds pasted floor output. Commit locally, never push. Do not end your turn to check in; keep going until DoD or genuinely blocked.
