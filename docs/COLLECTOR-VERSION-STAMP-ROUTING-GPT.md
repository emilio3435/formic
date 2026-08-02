# Routed: the collector-version stamp

> **What it is for, in one line:**
> **It answers "were these two numbers produced by the same arithmetic?" — nothing else.**

Everything below follows from that sentence, including when it must *not* change.

---

## Why the one-line purpose has to ship with it

A stamp with no stated purpose gets bumped on every edit, every comparison becomes cross-version,
the floor check never fires, and **it expires by passing.** That is the same failure as a vacuous
assertion: green, permanently, and indistinguishable from working.

**So the rule is not "bump it when you change collectors.ts."** It is:

| Change | Bump? |
|---|---|
| dedup rule changes (`uniqueUsage` grouping) | **yes** |
| what a sum includes or excludes — cache reads, cache creation | **yes** |
| the unit or scope of the stored quantity | **yes** |
| rename, refactor, extract a helper, reorder | **no** |
| performance work with identical output | **no** |
| anything elsewhere in `collectors.ts` | **no** |

**The stamp describes the meaning of the number, not the state of the file.**

## The surface it describes

Four lines, `collectors.ts:676-690`:

```ts
const uniqueUsage        = [...usageByMessage.values()].sort(…)   // the dedup
const usageNew           = (usage) => …                            // what counts as new
const sessionTotal       = uniqueUsage.reduce(… usageNew …)        // the sum
const sessionCachedInput = uniqueUsage.reduce(… cachedInput …)
```

If a change alters what any of those *produce* for the same input, the stamp moves. If it does not,
it does not.

## Make it checkable, not remembered — and do not copy the precedent as-is

**This repo already has this pattern, and its enforcement runs the wrong way round.**
`config/models.json` carries `pricingVersion: "2026-07-28"`, and `tests/model-config.test.ts:50`
asserts:

```ts
expect(shipped.pricingVersion).toBe("2026-07-28");
```

**That pins the version, not the thing the version describes.** So:

- **prices change, version not bumped** → test still passes → **the version is a lie, silently**
- version bumped, prices unchanged → test fails → harmless annoyance

**It catches the safe direction and misses the dangerous one.** Do not reproduce that.

**Invert it: pin the derivation's output on a fixed fixture.**

```ts
// tests/token-derivation-version.test.ts
test("the token derivation has not changed without its stamp changing", () => {
  const out = deriveTokens(FROZEN_TRANSCRIPT_FIXTURE);
  expect(out.sessionTotal).toBe(4_570_664);          // golden
  expect(out.sessionCachedInput).toBe(712_057);
  expect(TOKEN_DERIVATION_VERSION).toBe("2026-08-02.1");
});
```

Now the dangerous direction fails: **change the arithmetic and the golden values move, the test goes
red, and the failure message tells you to bump the stamp.** The stamp becomes checkable rather than
remembered — the same principle as the publication form's blanks: *a rule installs when skipping it
looks unfinished rather than merely wrong.*

## Where it is written

On each archived record, beside the tokens it qualifies — **not in a global config.** The floor
check compares a record written weeks ago against a value computed now, so the stamp has to travel
with the record. A single global constant tells you only today's version and cannot answer the
question the check asks.

## Acceptance criteria

1. **Golden test fails** when `usageNew` or the dedup grouping changes and the stamp does not.
2. **Golden test passes** across a rename or refactor with identical output — otherwise it trains
   people to bump mechanically, which is the failure this exists to prevent.
3. **Archived records carry the stamp**; records written before it exists compare as
   *version-unknown* and are skipped rather than assumed-comparable.
4. **The skip is counted and reported.** A floor check that silently skips every legacy record
   passes while testing nothing — the non-vacuity counter's second consumer.
5. **One line of prose beside the constant** stating what it is for. Without it, criterion 2 erodes
   within a month.

## Limits

- **I am proposing this, not describing it** — no `TOKEN_DERIVATION_VERSION` exists today.
- **The golden values above are illustrative**, taken from a live archive record; whoever
  implements it should freeze a fixture rather than use production numbers that move.
- I have not checked whether `tests/model-config.test.ts:50` was *intended* as a change-detector or
  as a shipped-config assertion. **If the latter, it is doing its job and my criticism is of
  copying it here, not of the test.**
