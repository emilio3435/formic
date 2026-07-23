# Backend handoff — light up the vitals ring for every provider

**Agent:** Luna · sol 5.6 · MAX effort
**Branch:** `feat/vitals-collectors-be` (this worktree, based on `main`)
**Lane:** backend / collectors only. Do NOT touch `src/web/*` — a parallel FE lane owns that.

## Why this exists

The FE lane just shipped an inspector "vitals band" (Context ring, Session tokens, Uptime)
on branch `feat/inspector-instrument-panel`. The Context ring is driven by
`contextUsage(tokens)` in `src/web/app.js`, which only returns a value when:

```js
tokens.scope === "latest-turn" && tokens.provenance === "observed"
&& Number.isFinite(tokens.total) && tokens.contextWindow > 0
```

Today only the **Codex** collector emits that shape (`src/server/collectors.ts:323–360`
sets `contextWindow`, `scope:"latest-turn"`, `provenance:"observed"`). Every other
provider emits `{ scope:"unknown", provenance:"unknown" }` and no `contextWindow`, so the
ring shows "not reported" for them. Your job: make the other providers emit the same
observed latest-turn shape **where the underlying data actually exists** — never fabricate.

## Scope — the seam

- `src/server/cursor.ts:179` and `:242` — currently `tokens: { scope: "unknown", provenance: "unknown" }`.
  If the Cursor session data exposes a per-turn token total and a model context window,
  emit `scope:"latest-turn"`, `provenance:"observed"`, `total`, `cachedInput`, `input`,
  `output`, and `contextWindow`. If Cursor genuinely doesn't expose a window, leave it
  unknown and say so in your report — do not guess a window size.
- `src/server/collectors.ts:295` (the `scope:"session"` path) and any Claude/omp/opencode
  collector — same treatment: promote to observed latest-turn + `contextWindow` when the
  source reports it.
- Look at how the Codex path at `collectors.ts:323–360` reads `payload.info.model_context_window`
  and mirror that pattern per provider.

## Hard constraints

1. **Truth over coverage.** Only emit `provenance:"observed"` when the number is really
   observed from the source. Only emit `contextWindow` when the source reports it. A missing
   window must stay absent, not a hardcoded 200k/250k. This dashboard has a documented
   "truth audit" culture — fabricated telemetry is worse than a blank tile.
2. **No FE edits.** `src/web/*` is off-limits. The FE already consumes the contract.
3. **Cache-hit %** in the FE is `cachedInput / input`. If you can populate `cachedInput` and
   `input` for a provider, the FE's "% cache hit" lights up for free — bonus, not required.
4. Match existing collector style (`TokenUsage` type, provenance enum). Read the type def
   before adding fields.

## Success criteria

- For each provider you touch: a unit test proving that when the source payload includes a
  context window + observed turn tokens, the emitted `TokenUsage` has
  `scope:"latest-turn"`, `provenance:"observed"`, and a finite `contextWindow` — and that
  when it does NOT, the shape stays unknown/absent (the truth guard).
- `bun test` green.
- A short report at the end: which providers can now feed the ring, which genuinely can't
  (and why), and whether `cachedInput`/`input` are available per provider.

## When done

Commit on `feat/vitals-collectors-be` (do not push unless asked). Leave the report in this
file under a `## Luna report` heading so the FE lane can merge the two branches.

## Luna report

- **Codex:** feeds the Context ring with observed latest-turn usage and its source-reported
  `model_context_window`. `input` and `cachedInput` are available.
- **OMP:** now emits its final observed assistant turn as `scope:"latest-turn"`, preserving
  the accumulated `sessionTotal` separately. Its source exposes `input`, `output`, and
  `cacheRead` (`cachedInput`), but no context-window field, so it cannot truthfully feed the
  Context ring.
- **Claude:** already emits observed latest-turn usage with `input`, `output`, and
  cache-read `cachedInput`; its persisted JSONL usage schema has no context-window field, so
  it cannot truthfully feed the Context ring.
- **Cursor:** its collected metadata, transcript, and read-only store evidence expose identity,
  model, text, and turn status but no token accounting or context window. It remains
  `{ scope:"unknown", provenance:"unknown" }` rather than fabricating telemetry.

Truth guards cover absent OMP/Claude usage and an absent Codex context window. Verification:
`bun test` — 203 passing, 0 failing; `git diff --check` passed. No `src/web/*` files changed.
