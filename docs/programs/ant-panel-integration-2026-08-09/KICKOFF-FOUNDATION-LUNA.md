# Foundation Luna Kickoff

Goal: Add the pure Task-envelope parser and additive `rawTask` snapshot contract on the integrated baseline.

Success means:
- `parseTaskEnvelope` handles kickoff prose, header envelopes, image-only placeholders, empty input, and one-line input through intent-first tests.
- `AgentSnapshot.rawTask` is present only when a refined sidecar replaced a real source task.
- Existing task-refiner sidecar behavior remains intact.
- The owned floor is green and one local commit contains only the owned fence.

Stop when: The local commit SHA and exact floor output are recorded in `LANE-REPORT-foundation.md`, or the report names a precise blocker.

Read `GROUND-RULES.md`, `SPEC.md`, the two original plan documents, the current exports/callers, and then execute only the Foundation Luna fence. Use GPT-5.6 Luna. Start by creating the lane report. Commit locally and never push.
