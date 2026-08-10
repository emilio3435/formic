# Task Widget — baseline (TW-UI, 2026-08-09)

Worktree: `/Users/emilionunezgarcia/Developer/the-mountain.worktrees/tw-ui-grok`
Branch: `feat/tw-ui-anatomy` @ `1c9c2b9` (pre-anatomy tip)

## Floor (Task 1)

```
bunx tsc --noEmit
→ clean (EXIT 0)

bun test
→ 2966 pass
→ 30 fail
→ 12403 expect() calls
→ Ran 2996 tests across 161 files. [145.25s]
```

Ground-rules floor expected **3** fails in `tests/cross-source-token-agreement.test.ts` only. This sandbox inherited **30** fails (OBB + board/docs/collector/env). TW-UI will not touch foreign files; gate is **no new failing files** beyond this list.

### Failing files (inherited)

1. `tests/cross-source-token-agreement.test.ts` (3 — foreign OBB)
2. `tests/b2-render-proof.test.ts` (2 — TL;DR / health-rail)
3. Collector / identity / docs / burnbar / refiner / a11y geometry suites (remainder — environment)

Full paste: `.lane-evidence/baseline-floor.txt`

## Live server (Task 1 Step 2)

- `http://127.0.0.1:4701/` → up (HTTP 200)
- Listener PID 88969: `bun src/server/index.ts`
- **cwd: `/Users/emilionunezgarcia/Developer/the-mountain-main`** — NOT this worktree
- Per ground rules: lane must not restart/deploy services. Before/after live shots and Task 6 browser verification are blocked for this checkout; report to integration owner.

## Before screenshots

PENDING / blocked — live board is another checkout; browser QA is integration-owned (`GROUND-RULES.md`). Shape notes for equivalent fixtures will be covered by headless `tests/web-client.test.ts` anatomy claims.

## Closing evidence (Task 6)

Shipped on `feat/tw-ui-anatomy`: `9e88e16` (DOM + tests), `bbe5a90` (CSS anatomy, 25% cap removed).

### Gate

```
bunx tsc --noEmit → EXIT 0

bun test tests/task-envelope.test.ts tests/web-client.test.ts tests/cwd-adversarial.test.ts tests/overhaul-guards.test.ts
→ 595 pass / 0 fail

bun test
→ 2982 pass / 26 fail (see LANE-REPORT-tw-ui.md §4 and .lane-evidence/final-floor.txt)
→ No NEW failing test names vs Task 1 baseline
```

### After screenshots

Blocked — `:4701` still serves `the-mountain-main`. Headless anatomy claims green in `Task widget anatomy: objective + meta + closed Full brief from one DOM`.
