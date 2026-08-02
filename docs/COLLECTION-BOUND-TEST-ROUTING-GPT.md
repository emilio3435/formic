# Routed: the collection-bound test

> **A bound is a gap.** A result that was limited must carry its limit and whether it was reached.

The test that fails on the sixth instance, with the endpoints that fail it **today** — measured,
not assumed.

---

## What fails right now

| Endpoint | Collection | Cap in code | Discloses? |
|---|---|---:|---|
| `/api/usage/invocations` | `invocations` | 50 | **`limit, matched, truncated`** ✓ |
| `/api/usage/ward` | `spikes` | `MAX_WARD_SPIKES = 12` | **`spikeCoverage`** ✓ |
| `/api/usage/quotas` | `quotas` (18 returned) | — | **NONE** |
| `/api/triage/queue` | `items` | `MAX_TRIAGE_ITEMS = 500` | **NONE** |
| `/api/actions` | `actions` | `MAX_ACTION_LOG_ENTRIES = 500` | **NONE** |

**Three failing, two passing.** The two that pass are the model and were fixed independently —
which is the argument for naming the pattern rather than fixing instances.

**Also capped and undisclosed, inside `/api/snapshot`:**

```
MAX_RECENTLY_RESOLVED = 12     ← same number, same shape as the ward's spike cap
MAX_ARCHIVE_RECORDS  = 5_000   ← reachable, and it evicts operator intent first (see earlier routing)
MAX_ATTENTION_RECORDS = 500
MAX_LISTED_BRANCHES   = 8
MAX_BUCKETS = 13 · MAX_PUBLISHED_BUCKETS = 12   ← the series
```

`MAX_RECENTLY_RESOLVED = 12` is worth calling out: **the same cap, the same size, and the same
silence as the spike list `200719e` just fixed.** It is the sixth instance, already written, waiting
to be found.

## The test

```ts
const COLLECTIONS = [
  { path: "/api/usage/invocations?range=24h", key: "invocations" },
  { path: "/api/usage/ward?range=24h",        key: "spikes"      },
  { path: "/api/usage/quotas",                key: "quotas"      },
  { path: "/api/triage/queue",                key: "items"       },
  { path: "/api/actions",                     key: "actions"     },
];

test.each(COLLECTIONS)("$path discloses the bound on $key", async ({ path, key }) => {
  const body = await get(path);
  expect(Array.isArray(body[key])).toBe(true);
  expect(body).toHaveProperty("limit");       // or an equivalent coverage object
  expect(body).toHaveProperty("truncated");
});
```

**Accept an equivalent shape rather than forcing one name.** `spikeCoverage { complete, skipped,
truncated }` is a correct answer and richer than `limit/truncated` — the contract is *the bound
travels with the result*, not a particular field name. A test that demands one spelling will be
worked around.

## The non-vacuity requirement — the part that makes it real

**At least one endpoint must be driven past its bound in a real run, so `truncated` is observed
`true`.** Otherwise the suite asserts the fields exist and never that they work, which is the exact
trap in `1ae3982`: five of my own twenty-eight checks were vacuous the same way.

**`recentlyResolved` at 12 is the cheapest to exceed** — resolve thirteen issues in a fixture and
assert the disclosure fires. `MAX_ACTION_LOG_ENTRIES = 500` against 15 live entries is not going to
truncate on its own and will pass forever.

**Report the count of endpoints where truncation was actually exercised.** An endpoint that has
never been driven past its cap is *untested*, not *passing*.

## Where a bound legitimately does not apply

Do not force disclosure where nothing is dropped. `/api/usage/summary`'s `byProvider` returns every
provider; there is no cap and inventing one would be worse than silence. **The test's list should be
explicit rather than derived** — a collection that is complete by construction stays off it, with a
comment saying why, so the next reader does not add it mechanically.

## One extension worth considering, not routed

The same belief covers bounds on things that are not collections:

```
MAX_SSE_CLIENTS = 16 · MAX_SSE_BACKLOG_BYTES · MAX_TRANSCRIPT_TAIL_CHARS = 800
```

**If the seventeenth SSE client is refused, does anything say so?** A refused connection is a
dropped consumer, and the belief — *the limit is how I did it, not part of the answer* — applies
identically. I have not checked whether these disclose; flagging the shape rather than claiming a
defect.

## Acceptance criteria

1. **Three named endpoints disclose** their bound in the agreed shape.
2. **The test goes red today** against `quotas`, `triage/queue` and `actions`, before the fix.
3. **At least one endpoint is exercised past its bound**, with `truncated: true` observed.
4. **The exercised count is reported**, so an all-under-cap run cannot read as a pass.
5. **`recentlyResolved` is included** — it is the sixth instance and it is already written.

## Limits

- **I probed five endpoints.** `/api/usage/series`, `/api/attention`, `/api/history/export` and the
  in-snapshot collections were read from their constants, not by driving them.
- **`MAX_RANGE_MS = 400` and `MAX_SSE_BACKLOG_BYTES = 2`** look like units I have not understood
  (400ms? 2 what?); I did not chase them and they may not be collection bounds at all.
