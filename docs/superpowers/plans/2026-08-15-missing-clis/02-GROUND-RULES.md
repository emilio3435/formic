# CLIS · Ground rules — every lane

Read the spec first. This file outranks your judgment on process.

## First action, before any code

Create `LANE-REPORT-clis-<lane>.md` in the worktree root with five headings, each `PENDING`, filled as work lands:

1. what this lane was
2. which claims went red first (named)
3. what shipped, file-and-fence
4. floor results PASTED, not paraphrased
5. anything unverified, including what the sandbox refused

A lane is not done until §4 holds real output.

## Git

- Commit locally, never push. Path-scoped: `git commit -- <paths>`. Forward-only; never amend.
- Scratch in `.lane-evidence/` (gitignored). Delete nothing.
- Codex: the sandbox often cannot take the linked-worktree lock. Leave finished work as dirt + a complete report §3. Do not fight the lock.

## Floor (paste in report §4)

```
bunx tsc --noEmit    # 0
bun test             # green except tests/cross-source-token-agreement.test.ts (fleet canary)
```

If you add `src/server/<module>.ts`, `tests/reference-docs.test.ts` requires an ARCHITECTURE.md row. That edit is in-fence.

## Silent traps

1. **A `Provider` without `PROVIDER_BINARIES` is declared dead.** Factory shipped that way. Never add a union member without the binary map, path regex, and process-recognition sample.
2. **Handwritten provider records go stale.** Every `Record<Provider, …>` and every four/six-name list must compile against the union. Do not leave a second list.
3. **`identity-bindings.ts` local allow-list crashes the hub** if it rejects a persisted provider. Use shared `PROVIDERS`.
4. **`sourceHealth.absent` cannot see an unmodelled billed tool.** Do not claim completeness by counting collectors you already have.
5. **Grok the model is not Grok the CLI.** `cursor-grok-*` stays `provider: "cursor"`.
6. **Hermes `sessions/` is not the money.** Cron spend is `~/.hermes/cron/`. Collecting only sessions does not close C.
7. **Do not edit `the-mountain-production`.** This worktree only. Never push. Never deploy.

## You do not spawn

You are a worker. If you stall or hit quota, write it in the report and stop.
