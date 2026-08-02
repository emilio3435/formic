# A bound is a gap — the belief behind five defects, named

Five instances tonight, and you are right that it is not five bugs.

```
spike list capped at 12, reporting complete: true, skipped: 0   200719e
archive retention measured from the wrong instant
the invocations row cap at 50
the usage range clamp at 90 days
archive eviction at MAX_ARCHIVE_RECORDS
```

**One belief, held independently by five authors.** Catalogue the instances and someone writes the
sixth. So: the belief, stated plainly, and a test that fails on the sixth.

---

## The belief

> **"The limit I applied is *how I computed* the answer, not *part of* the answer."**

That is what each author believed, and in each case it felt obviously true. The bound was applied
for a different, locally correct reason every time — response size, memory, query cost, storage —
and a decision made to solve *your* problem feels like an implementation detail of *your* solution.

**Nobody experiences "I capped this at twelve" as "I withheld data."** That is why it recurs
independently rather than spreading by copying.

## The correction

> **A bound is a gap. A result that was limited must carry its limit and whether it was reached.**

`200719e`'s own comment states the failure exactly: *the ward returned 12 and reported
`complete: true, skipped: 0`* — a bounded result asserting its own completeness. And it names why
nothing caught it: *"Nothing else on the board computes spikes, so no second figure"* — the
uncorroborated property, arriving at the same defect from the other direction.

## Why this project should have caught it, and the reason it did not

**This codebase already believes the value-shaped version of this rule, thoroughly.** It has
implemented it at least five times:

```
tokensMissing         beside the token sum
costKnown             beside the cost
costProvenance        beside the measured figure
completionsProvenance beside the withheld counter
priorSpend            beside the window total
```

**Every one of those discloses a gap in a *value*. Not one of them discloses a gap in a
*collection*.** The project believes a missing number must be named and does not yet believe a
missing **row** must be.

That is the whole distance between five defects and zero.

## The remedies have already converged — they just have no name

Three endpoints now do the right thing, and they were fixed separately:

```
/api/usage/invocations →  limit, matched, truncated     ← landed tonight
/api/usage/ward        →  spikeCoverage { complete, skipped, truncated }
/api/usage/summary     →  priorSpend { earliestAt, invocations, measuredCostUsd }
```

**Three authors, three fixes, one shape: the bound travels with the result.** The pattern exists
and is proven; what is missing is a name, so the fourth author reaches for it instead of
rediscovering it after someone finds the defect.

**Call it what it is: a bounded collection returns `{ items, limit, truncated }`.**

## The test that fails on the sixth

A catalogue ages. This does not:

```ts
// Every endpoint that returns a collection must disclose its bound.
test.each(COLLECTION_ENDPOINTS)("%s discloses its bound", async (path) => {
  const body = await get(path);
  expect(body).toHaveProperty("limit");
  expect(body).toHaveProperty("truncated");
});
```

**Non-vacuity requirement, since it is exactly the trap I have written about all night:** at least
one endpoint in the list must be driven past its bound so `truncated` is *true* in a real run. A
suite where every endpoint returns fewer rows than its cap asserts the fields exist and never that
they work.

## What "fixed" looks like, for the next author

Not *"remove the bound"* — the bounds are correct and were applied for good reasons. **Disclose
them.** The invocations endpoint is the model: it still caps at 50, and now it says so, and my own
sweep tonight had to work around that cap by querying twelve 2-hour windows. **With `truncated`
present I would have known in one request instead of inferring it from a suspiciously round
number.**

---

# Routed separately: the `pricingVersion` inversion

`config/models.json` carries `pricingVersion: "2026-07-28"`, and `tests/model-config.test.ts:50`
asserts that literal. **It pins the version rather than the thing the version describes**, so:

- **prices change, version not bumped → the test passes and the version is silently a lie**
- version bumped, prices unchanged → test fails, harmlessly

**Invert it: pin the priced output, not the version string.**

```ts
test("the price table has not changed without its version changing", () => {
  expect(priceFor("claude-opus-4-8")).toEqual({ input: 5, output: 25, cacheRead: 0.5, cacheCreation: 6.25 });
  expect(shipped.pricingVersion).toBe("2026-07-28");
});
```

Now editing a price without bumping the version goes red, which is the direction that matters.
**Same correction as the collector stamp in `d29cb54`, and the same reason: a version is only worth
having if changing the thing it describes is what breaks the test.**

**One caveat I will keep flagging:** I do not know whether `model-config.test.ts:50` was written as
a change-detector or as a shipped-config assertion. **If the latter it is doing its job**, and the
routing is *add the inverted test*, not *replace it*.

## Limits

- **Five instances are yours plus mine**; I verified `MAX_WARD_SPIKES = 12` and the three disclosing
  endpoints tonight, and the retention and eviction ones earlier today. I did not independently
  re-verify the range clamp beyond the `INVALID_RANGE` response I measured.
- **The live ward payload shows `complete` and `skipped`**; `truncated` appears in `200719e`'s diff
  and I did not observe it in a response, since only one spike is present and nothing is being
  truncated right now.
