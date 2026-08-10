# Lane E - Formic TL;DR hierarchy and attention count

Goal: Reskin the existing flat TL;DR lane and add its deterministic attention count without changing its paging, filtering, or health semantics.

Success means:
- `.heartbeat-tldr-label` reads prominently in Inter at arm's length.
- `.tldr-attention-count` is rendered from deterministic snapshot/repo state, uses tabular mono figures, and says `N need you` or `all clear` truthfully.
- TL;DR needs-you maps to warning, break/failed maps to danger, healthy maps to success, and brand clay carries no status meaning.
- The lane remains a white/hairline flat surface with its sharp proof/story geometry.
- `#cleanup-status`, the two-child health shell, repo/ALL paging, chip filtering, staleness, and reading scope remain intact.
- Named TL;DR Formic claims go from RED to green and all health-rail suites pass.

Stop when: The TL;DR slice is committed locally with exact focused evidence and no readings/dashboard restyle.

Read first:
1. `SPEC.md` and `GROUND-RULES.md`
2. Current `renderHealthRail()`, `renderHealthTldrLane()`, `renderTldrAllLane()`, `renderTldrRepoLane()`, and their immediate helpers
3. Current TL;DR CSS and health-rail tests, including inherited dirty assertions
4. Canonical Formic status and typography rules

Own exclusively:
- the TL;DR render/helper fence in `src/web/app.js`
- the TL;DR selector section in `src/web/styles.css`
- TL;DR Formic assertions in `tests/formic-reskin.test.ts`
- necessary additive assertions in `tests/health-rail-v2.test.ts`

Claims:
- `FORMIC-TLDR-HIERARCHY-RED`
- the TL;DR subset of `FORMIC-NOTIFICATION-STATUS-RED`
- the TL;DR subset of `FORMIC-INTERACTION-RED`

Focused floor:

```bash
bun test tests/formic-reskin.test.ts tests/health-rail-v2.test.ts tests/health-rail-v2-markup.test.ts tests/health-rail-v2-server.test.ts
bun run typecheck
```

Create `LANE-REPORT-tldr.md` first. Commit only owned paths locally and return the SHA and report path. Preserve the flat/chill DOM and leave readings, board, inspector, dock, settings, and notifications for Phase 2.
