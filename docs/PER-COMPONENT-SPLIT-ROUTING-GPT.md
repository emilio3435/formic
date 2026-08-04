# Routed: the per-component split — and it needs a field before it needs a test

For diagnosing the 161% overcount on `fe1d8020-259` (board 293,235 vs burnbar 112,258).

**Check the constructibility before writing the test: it is not constructible today.** I looked
before routing, because routing an impossible test wastes a lane.

---

## The blocker

The components **exist in the schema** — `burnbar.ts:203-206`:

```ts
inputTokens · outputTokens · cacheReadTokens · cacheCreationTokens
```

**And no endpoint exposes them.**

```
/api/usage/invocations row keys : id, provider, model, sessionId, projectName,
                                  tokens, costUsd, costProvenance, startTime, endTime
/api/usage/summary keys         : … processedTokens, tokensKnown, tokensMissing …
```

One `tokens` scalar per row; one `processedTokens` per window. This is deliberate — I recorded in
`3d2af4c` that the summary query **zeroes the components for every measured row**, using them only
for fallback pricing.

**So the split needs four fields exposed first.** That is the routing.

## What to expose

Per invocation row on `/api/usage/invocations`:

```ts
inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens
```

They are already selected in the query for pricing; this is a projection change, not a new read.

## Then the test, and what each outcome means

Compare per session, per component, board against burnbar:

| Component agrees | Component disagrees | Reading |
|---|---|---|
| input, output | `cacheCreationTokens` | **My hypothesis.** The board sums cache creation once per *call*; burnbar counts it once per *cache*. Board runs high by the creation share, which is large here |
| input, output, creation | `cacheReadTokens` | Cache reads are being counted per call on one side and per prefix on the other — the same shape as the `sessionTotal` distinction `collectors.ts:664` already draws |
| all four | — | The join is picking up rows burnbar does not have for that session; **not an arithmetic defect, a population one** |
| output only | input and cache | The board is reading a different usage record entirely |

**The point of splitting is that the total cannot distinguish these four**, and they need different
fixes. A 161% overcount on a sum is one number; on four components it is a diagnosis.

## Why this is worth more than the one bug

**Exposing those four fields unblocks three things I have already reported as stuck:**

1. **This diagnosis.**
2. **Bound B5** — *components sum to total* — which I marked **unevaluable by construction** in
   `1ae3982`, because the payload has no components to sum. It becomes a real, non-vacuous check
   the moment they exist.
3. **The cache-share question the 1.6B defect turned on.** In `3d2af4c` I wrote that an operator
   *"cannot tell whether 135.6M is mostly fresh content or mostly re-read context"* and that I
   declined to assert it. With the components published, that stops being unanswerable.

One projection change, three unblocked.

## The caution I would attach

**Do not let the fix be "make the numbers match."** If the two sources count cache creation
differently, one of them is right for its purpose and the other is right for *its* purpose — the
same way `total` and `sessionTotal` are both correct and mean different things, which
`collectors.ts:664` documents carefully.

**The deliverable is a stated relationship, not equality.** Something the board can publish:
*"board per-call totals exceed burnbar session sums by the cache-creation share, which is
expected because X."* Then the check asserts *that* relationship and can fail when it breaks.
Forcing equality between two deliberately different measurements would destroy information and
reintroduce exactly the unit confusion that made July 30 look like a physics violation.

## Limits

- **I have not seen the failing test**, only your figures. The component hypothesis is ranked first
  because it is cheap, not because I have evidence over the alternatives in the table.
- **I did not verify that all four components are populated** for Claude rows in the burnbar store
  — only that the schema names them. If they are null for measured rows, the split needs the
  ingestion fixed first, not the projection.
