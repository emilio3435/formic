# Health Rail v2 + Task Widget — Lane Ground Rules (2026-08-09)

Integration owner: Fable 5 orchestrator on `chore/docker-local-ci`. Lanes commit locally in their own worktree/branch and NEVER push.

## First action — before any code

Create `LANE-REPORT-<lane>.md` in your worktree root with five headings, each marked `PENDING`, filled in as work lands:
1. What this lane was
2. Which claims went red first (named tests)
3. What shipped, file-and-fence
4. Floor results pasted, not paraphrased
5. Anything unverified, including what the sandbox refused

A lane is not done until section 4 holds real output.

## The floor (Definition of Done gate)

```bash
bunx tsc --noEmit && bun test
```

Expected: tsc clean; `bun test` shows exactly **3 pre-existing fails**, all in `tests/cross-source-token-agreement.test.ts` (foreign OBB program — do NOT touch that file, do not "fix" it, just report it). Any other red you did not inherit is yours.

## Fences (one writer per path — binding)

| Lane | Owns exclusively |
|---|---|
| P1 server | `src/server/types.ts`, `src/server/prime.ts`, `src/server/collectors.ts`, `src/server/snapshot.ts`, `tests/health-rail-v2-server.test.ts` (new), `tests/b2-render-proof.test.ts` |
| P2 markup | `src/web/tldr-markup.js` (new), `tests/helpers/fake-dom.ts` (new), `tests/health-rail-v2-markup.test.ts` (new) |
| P3 catalog | `src/web/client-catalogs.js`, `tests/health-rail-v2-catalog.test.ts` (new) |
| TW-UI | `src/web/app.js`, `src/web/styles.css`, `src/web/presentation.js`, `tests/web-client.test.ts`, `tests/task-envelope.test.ts` |

Need a path outside your row? STOP, write it in your lane report, end your turn with the report — never edit it, never "quickly fix" another lane's file, never resolve someone else's conflict.

## Git discipline

- Work ONLY in your own worktree on your own `feat/…` branch. Verify before every commit: `git rev-parse --abbrev-ref HEAD` (the DCG blocks `git branch` shorthand — use rev-parse).
- Commit path-scoped: `git commit -m "…" -- <your paths>`. Never `git add .`, never `git commit -a`, never amend (even your own tip), never push, never rebase.
- Scratch goes in `.lane-evidence/` (gitignored). Delete nothing you did not create.

## Anchors moved — locate by symbol

The chat lane and the rawTask Foundation landed today (merge `40e7099`, `9fe6ac6`). Any `file:line` in the plan was verified at `6678e65` and may have shifted. Current code is truth; locate by symbol, not line number.

## Silent traps

- `el()` builds text via `textContent` — NEVER `innerHTML` for anything transcript-derived (untrusted; XSS boundary).
- `[hidden] { display:none !important }` is global — don't fight it with display rules.
- zsh eats bare `==` in echo commands — quote them.
- Tests import `../src/web/app.js` to get `globalThis.TheAntHill`; renderers need the fake-DOM pattern (see `tests/b2-render-proof.test.ts` top).
