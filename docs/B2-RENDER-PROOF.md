# B2 Render Proof — Audit Note (2026-08-09)

## Claim

Ant Hill instrument panel renders the B2 `[TL;DR HH:MM]` heartbeat correctly:

- `src/server/prime.ts` → `transcriptTail` (800c) → `src/server/snapshot.ts` → SSE → `src/web/app.js` (`renderAgentRow` project-tree row + `renderAgentDrawer` Chat)
- Full transcript on disk (`~/.prime/agent/sessions/*.jsonl`) is **never** truncated — only the **wire tail** caps to `MAX_TRANSCRIPT_TAIL_CHARS=800` (`src/server/types.ts:16`). Archive (`~/.prime/agent/session-artifacts` + `data/`) retains complete record.
- `6/6 healthy` counts **PROVIDERS** (6: `omp, codex, claude, cursor, factory, prime`) — not `providers + cmux`. Cited bug in `TODAY.md` where `cmux` (control plane) was double-counted and `omp` omitted, both sets size 4 so the ratio looked self-consistent while membership was wrong.

## Path verified

1. **Prime parser** (`src/server/prime.ts:99`): `tail = t.slice(-MAX_TRANSCRIPT_TAIL_CHARS)` — last assistant text, capped via `MAX_TRANSCRIPT_TAIL_CHARS` imported from `src/server/types.ts`. Fix this lane: replaced hardcoded `800` with the constant.
2. **Snapshot wire** (`src/server/snapshot.ts:532,567-569`): `transcriptTail: source.transcriptTail` and `(... ? `${source.transcriptTail}\n\n[Attention] ${notification.body}`.slice(-MAX_TRANSCRIPT_TAIL_CHARS) : source.transcriptTail)` — byProvider tail already capped, attention merge re-caps. `MAX_TRANSCRIPT_TAIL_CHARS` imported.
3. **Web render** (`src/web/app.js:7594,10346`): `rowSummary()` and `renderChat()` now surface `transcriptTail` when it contains `"[TL;DR"` — the B2 marker. Row uses `conciseText(...,120)` for the dense roster; drawer Chat renders the full 800-char tail as an `assistant` candidate via `dedupeTurns`. Before this fix, both surfaces read only `lastAgentMessage/lastHumanMessage/task` — for Prime (`humanMessages=[]`) that was the stale initial task, so the TL;DR never reached a pixel despite flowing on the wire. Fix: two gates on `"[TL;DR"` (row + drawer).
4. **Full retention** (`~/.prime/agent/sessions/019fe46c-d482-706c-b080-08f1420c8ae3.jsonl`): 135+ lines at time of audit; `transcriptTail` slice is wire-only. `src/server/snapshot.ts` comment (L72) notes the 2.23 MB / 2 MB SSE backlog budget that motivates the cap — median 7 calls, largest 1,575 would blow it uncapped.

## 6/6 healthy — PROVIDERS, not providers+cmux

- **Source of truth**: `src/shared/types.ts:12` — `export const PROVIDERS = ["codex","omp","claude","cursor","factory","prime"] as const satisfies readonly Provider[]` with exhaustive guard `ProvidersAreExhaustive` (line 19-20). Adding a provider to the `Provider` union without adding to the list fails build.
- **Snapshot agreement**: `src/server/snapshot.ts:17,728` — `import { PROVIDERS } from "../shared/types"` and `const collectorProviders: readonly Provider[] = PROVIDERS` — the health accounting iterates PROVIDERS, not a hand-written list. `sourceHealth.total = PROVIDERS.length - absentSources`, `healthy = sourceTotal - degradedSources`. `controlHealth.cmuxReachable` is a separate field, never counted in `sourceHealth`.
- **Bug cited** (`TODAY.md` L7-12, 2026-08-02): `4 of 4 collectors healthy` was computed over `codex/claude/cursor + cmux`; breakdown used `codex/omp/claude/cursor`. Two disjoint 4-sets, `omp` never counted, `cmux` double-reported as collector while also owning `controlHealth`. Fixed commit `0df7714` (see `git log --grep=collector`). Current board `127.0.0.1:4701/api/snapshot` reports `sourceHealth.byProvider` with six keys (`omp, codex, claude, cursor, factory, prime`) and `controlHealth.cmuxReachable` side-car.

## Evidence

- Test: `tests/b2-render-proof.test.ts` — 7 assertions (row, drawer, MAX cap, wire slice, full-retention 100-line jsonl, PROVIDERS=6, `collectorProviders===PROVIDERS`).
- Floor: `bunx tsc --noEmit` clean, `bun test tests/b2-render-proof.test.ts` green, `bun test tests/web-client.test.ts` green (existing `transcriptTail` Evidence-only test still holds for non-TL;DR tails — the `[TL;DR` gate preserves it).

## Rendering bug found and fixed

`src/web/app.js:7593,10304` — `rowSummary` and `renderChat` did not read `agent.transcriptTail` at all. For Prime, TL;DR lived only in `transcriptTail`; `lastAgentMessage/lastHumanMessage` were `null`/`task`. Added two `"[TL;DR"` gates (row + drawer) so B2 marker surfaces in both the project-tree row (120-char concise) and the inspector Chat (full 800-char tail). Non-TL;DR tails remain Evidence-only, preserving the prior dedup contract (`tests/web-client.test.ts:1419`).

## Re-check

```bash
bunx tsc --noEmit
bun test tests/b2-render-proof.test.ts tests/web-client.test.ts
curl -s http://127.0.0.1:4701/api/snapshot | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['totals']['sourceHealth']);print([a['transcriptTail'][:40] for p in d['programs'] for a in p['agents'] if '019fe46c' in a['id']])"
tail -n 40 ~/.prime/agent/sessions/019fe46c-d482-706c-b080-08f1420c8ae3.jsonl
```
