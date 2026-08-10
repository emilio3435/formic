# Parser Luna Kickoff

Goal: Add the pure Task-envelope parser and its five-shape behavioral contract without touching the shared drawer or server.

Success means:
- Create `LANE-REPORT-parser.md` before source edits with every required heading marked `PENDING`.
- Add failing tests for kickoff prose, leading metadata headers, image-only placeholders, empty input, and a one-line task.
- Export `parseTaskEnvelope` beside `withoutSenderHeader` in `src/web/presentation.js`.
- Preserve sender-header stripping, cap the objective at 200 characters, and publish only metadata fields actually present.
- Run `bun test tests/task-envelope.test.ts` and `bunx tsc --noEmit` successfully.
- Commit only `src/web/presentation.js` and `tests/task-envelope.test.ts` locally.

Stop when: `LANE-REPORT-parser.md` contains the local commit SHA and exact floor output, or names a precise blocker.

Read `GROUND-RULES.md`, `SPEC.md`, the Task widget plan, the current `presentation.js` exports, and immediate callers. Use GPT-5.6 Luna. Work only in the kickoff worktree. Keep scratch in `.lane-evidence/`. Commit locally and never push.
