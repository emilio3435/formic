# CLIS · Master ledger

| Gate | State | Evidence |
|---|---|---|
| Spec on disk | DONE | `docs/superpowers/specs/2026-08-15-missing-clis.md` |
| Integration branch | DONE | `feat/missing-clis-spec` |
| A spawned | DONE | workspace:11 `CLIS · allow-list · sol · 08-15`; cwd clis-a; `codex -m gpt-5.6-sol` `model_reasoning_effort=xhigh` ps-verified 15:12 |
| A merged + floor | DONE | ff-only e51c411 onto feat/missing-clis-spec. Orchestrator floor: tsc 0, 337/337 named suites. Lane full bun test 10 red = canaries + geometry listen (sandbox), not A. |
| B + C spawned | DONE | workspace:12 grok-build; workspace:13 hermes |
| B merged | DONE | `b94e1ad` rescued+committed by orch; merged `da711ff` |
| C merged | DONE | `2a78ef7` rescued+committed by orch; merged `14b15f1` after 3 conflicts (imports, ARCHITECTURE, absence tests) |
| Integration floor | DONE | orch: `tsc` 0, 211/211 named suites (grok+hermes+absence+identity+hooks+docs+models) |
| Push | Emilio's word | not pushed, not deployed |

## Lanes

| Lane | Branch / worktree | Workspace | Status |
|---|---|---|---|
| A | `feat/clis-a` | pending | pending |
| B | `feat/clis-b` | — | blocked on A |
| C | `feat/clis-c` | — | blocked on A |
