# UI Luna Kickoff

Goal: Add the Task widget anatomy to the landed RHS mini-chat and current 65/35 drawer as one coherent DOM and CSS change.

Success means:
- Task renders a fixed title, objective, optional metadata, and closed Full brief anatomy for all providers.
- The landed chat feed keeps rendering loaded turns exactly once; loading, error, empty, and wrong-agent states remain honest.
- Structured TL;DR turns still render and the `0472d7c` card path remains intact.
- The current client, B2, drawer, and typecheck floors are green.
- One local commit contains only the Task UI fence; browser evidence remains integration-owned.

Stop when: The local commit SHA and exact floor output are recorded in `LANE-REPORT-ui.md`, or the report names a precise blocker.

Read `GROUND-RULES.md`, `SPEC.md`, the Task widget plan, and the landed Chat and Foundation Luna diffs before editing. Treat the current code as source of truth when old line anchors disagree. Use GPT-5.6 Luna. Start by creating the lane report. Commit locally and never push.
