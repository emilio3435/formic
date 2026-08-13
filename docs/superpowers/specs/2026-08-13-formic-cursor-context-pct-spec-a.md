# Spec A — Cursor context % from composerHeaders

Repo: emilio3435/the-ant-hill (Formic). Branch from `main`. Status: implement. Not a research note.

## Goal

Light the Formic context ring for Cursor GUI and CLI sessions using Cursor's own occupancy meter. Leave Cursor token counts and cost unknown.

Live evidence (Emilio's Mac, 2026-08-13): `composer.composerHeaders.allComposers[].contextUsagePercent` is a 0–100 float (one row was `95.47466666666666`). JSONL transcripts and store.db assistant blobs still have no usage.

## Non-goals

- Do not set `tokens.sessionTotal`, `tokens.sessionCachedInput`, `tokens.sessionProcessed`.
- Do not set `tokens.input` / `output` / `cachedInput` / `total` from this meter.
- Do not derive occupancy tokens as percent × models.json window. Formic's window table is a constant (docs/CONSTANTS-AS-MEASUREMENTS-GPT.md); multiplying it by a percent invents a token count.
- Do not set cost.
- Do not drop `provider !== "cursor"` in `src/server/pulse.ts`.
- Do not chars/4, tokenizer-guess, or treat missing as 0.
- Do not scrape Admin API, `agent --print` stream-json, or `GET /v1/agents/{id}/usage` (Spec B, later).
- Do not change Claude / Codex / Factory / Prime collectors.
- Children without their own header row stay unknown. Do not inherit the parent's percent.

## Data

Source (macOS, already opened by Formic): `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` ItemTable key `composer.composerHeaders` (JSON).

Shape:

```json
{
  "allComposers": [
    {
      "composerId": "<uuid>",
      "contextUsagePercent": 95.47466666666666
    }
  ]
}
```

Join: `composerId === Formic sourceSessionId` (CLI `~/.cursor/chats/<ws>/<uuid>`, GUI conversation-search.db `conversations.id`, child transcript uuid).

Linux, if the file exists: `~/.config/Cursor/User/globalStorage/state.vscdb`, same key. Absence is not an error.

This is not `cursorDiskKV composerData:<id>`. Formic already reads that for model/effort. Occupancy lives on ItemTable `composer.composerHeaders`. The key has already moved once (composerData → composerHeaders); if `allComposers` or `contextUsagePercent` is missing, skip occupancy and stay unknown. Do not search the whole DB for lookalike fields.

## Design

In `cursorStateEvidence` (src/server/cursor.ts ~649), same readForeignSqlite pass that already reads ItemTable (glass.localAgentProjectMembership.v1) and cursorDiskKV: also `SELECT value FROM ItemTable WHERE key = 'composer.composerHeaders'`. Parse JSON. Build `Map<string, number>` occupancyPctByComposerId for rows where composerId is a uuid string and contextUsagePercent is a finite number in [0, 100.5]. Cap display at 100. Values outside that range: omit that id (do not clamp garbage). Parse failure: push one named error, leave the map empty, do not fail the scan.

Cache that map on cursorStateCache next to composerData. Fingerprint invalidation unchanged.

Extend TokenUsage (src/shared/types.ts):

```ts
/** Observed context fill 0–100 from the harness meter. Not derived from total. */
occupancyPct?: number;
```

Comment: occupancyPct is a size percentage Cursor computed. It is not billed spend and must not be multiplied into total or sessionTotal.

parseCursorSession / both CLI (tryReadCursorTokens path ~1102) and GUI (collectCursorGuiSessions ~903, which currently passes no tokens): if tryReadCursorTokens returns observed total, keep today's path (rare; blobs are empty on current Cursor). Else if the occupancy map has sessionId, set

```ts
tokens: {
  scope: "latest-turn",
  provenance: "observed",
  contextWindow: cursorContextWindow(model), // already attached today even when unknown
  occupancyPct: <header value>,
}
```

Do not set total. tokensWithWindow still attaches contextWindow from config/models.json.

contextPctFor (src/server/snapshot-agent.ts:326):

```ts
if (provenance === "observed" && Number.isFinite(occupancyPct) && occupancyPct >= 0)
  return Math.round(Math.min(100, occupancyPct));
// existing total / contextWindow path unchanged
```

Missing occupancyPct + missing total → undefined, same as today.

UI contextUsage (src/web/agent-model.js:596): if occupancyPct is observed and total is absent, return `{ pct, text: pct + "%" }`. Do not print "X of Y tokens" from a reconstructed product. Existing total / contextWindow path unchanged for Claude/Codex.

tokenSummary: still "not reported" when total/input/output are absent. Occupancy is context, not the token cell.

Snapshot tokenValues / totals.tokens keep keying off tokens.total. Cursor occupancy therefore cannot enter the fleet token sum. Context peak already keys off agent.contextPct (snapshot.ts ~663) — Cursor rows with occupancyPct should enter contextPeak / contextReporting. That is intended: 38 of 40 missing sessionTotals were Cursor, which is why context coverage was lying.

## Tests (red first)

tests/cursor.test.ts honesty cases stay green:

- "parses exact session … unknown billing honestly" — fixtures without headers: tokens.total undefined, cost: null, scope/provenance unknown.
- "keeps Cursor sessions out of the token usage and burn rollups" — even with occupancyPct set, tokens.total and sessionTotal stay undefined; pulse still excludes provider === "cursor"; snapshot tokenValues does not include the Cursor agent.

New tests:

- Fixture composer.composerHeaders with composerId matching the session uuid and contextUsagePercent: 95.47 → tokens.occupancyPct === 95.47, contextPctFor(agent) === 95, tokens.total === undefined, cost === null.
- Header absent / malformed / percent NaN / percent 250 → occupancy omitted, unknown billing path.
- CLI and GUI collect both join the same map (one test each).
- Child uuid not in allComposers → child occupancy omitted; parent unchanged.
- tryReadCursorTokens observed total present → occupancyPct header is not required; existing total/window contextPctFor wins (store.db still authoritative if it ever has usage).

Do not weaken tests/usage-cost-honesty.test.ts.

## Files likely to change

- src/server/cursor.ts — read headers, join, pass occupancyPct (CLI + GUI).
- src/shared/types.ts — occupancyPct?.
- src/server/snapshot-agent.ts — contextPctFor.
- src/web/agent-model.js — contextUsage percent-only branch.
- tests/cursor.test.ts plus a small headers fixture.
- tests/snapshot-context.test.ts if it reimplements contextPctFor.

## Done when

- A live Cursor composer with contextUsagePercent shows a context % on the board and is counted in contextReporting.
- That same row still says tokens not reported, cost unavailable.
- Fleet token sum and burn rate do not move because a Cursor session appeared.
- Existing Cursor honesty tests pass without edits to their expected total/cost.
- `bunx tsc --noEmit` and the repo's baseline test command; do not "fix" unrelated failures.

## Out of spec (do not sneak in)

Spec B: Cloud Agents GET /v1/agents/{id}/usage. preCompact hook writer (nice fallback if headers rename again; not this PR). Renaming composerHeaders defensive crawlers.
