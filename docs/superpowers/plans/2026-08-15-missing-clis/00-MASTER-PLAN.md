# CLIS · Master plan

Owner: orchestrator. Spec: `docs/superpowers/specs/2026-08-15-missing-clis.md`. Ledger: `docs/2026-08-15-FLEET-DEBT-LEDGER.md`.

**Goal:** One provider list. Grok Build on the board. Hermes spend visible without pretending cron is an agent.

**Success means:** A is merged. B and C rebase on A, merge clean, floor green. No deploy.

**Stop when:** integration branch is green, or Emilio is the only one who can unblock.

```
A  allow-list + stub grok + stub hermes     serial
   ├─ B  Grok Build CLI                     parallel
   └─ C  Hermes                             parallel
```

## Stack

| Lane | Work | Model · vehicle |
|---|---|---|
| A | types + bindings + stubs | Sol xhigh · codex |
| B | Grok collector + identity + shim | Sol xhigh · codex |
| C | Hermes sessions + cron spend + disclosure | Sol xhigh · codex |

B and C do not edit `src/shared/types.ts`. A owns the union.

## Integration branch

`feat/missing-clis-spec` at `~/Developer/the-mountain.worktrees/missing-clis`.
