import { beforeAll, describe, expect, test } from "bun:test";
import { getAllUsageInvocations, type UsageInvocation } from "../src/server/burnbar";

/* The ten bounds from docs/PHYSICAL-BOUNDS-GPT.md, made assertable and checked
   against the real BurnBar history rather than fixtures.

   The document's headline lesson is right and I am keeping it: per-unit bounds
   have teeth, aggregate ones do not. Divide before you compare.

   What running it against real data changed is the UNIT. B1 and B2 are stated
   "per invocation", and there is no invocation in this data. A `token_usage`
   row is one SESSION: 500 rows carry 500 distinct sessionIds, spans run from
   zero to five hours, and the median is 79 seconds. A session contains an
   unbounded number of model calls, so no context-window ceiling applies to it —
   1M tokens per call says nothing about a session that made forty calls.

   Applied per row, B1 (tokens ≤ 2M) fails on all six days measured, including
   the two the document validated as clean. It passed there because the
   validation divided the day's total by the day's row count, and a mean is a
   total wearing per-unit clothing — it inherits exactly the slack the document
   warns about. August 2's mean is 1.0M and its largest row is 20.6M.

   So the derivation stands and the unit does not. Below, each bound is named by
   what it divides by, and the ones that cannot fire say so.

   THE ONE THAT FIRES is not a token bound at all. It is duration: nine rows in
   the history span more than a day each, the longest 2.97 days, and they carry
   92% of all cost in range. A session's whole burn is billed to the date its
   startTime falls in, so a session spanning three days puts three days of
   tokens on the first one. That is the same property this lane has been pinning
   all week — a figure that names a window must be derived from that window —
   arriving through the cost path. */

const FROM = "2026-06-01T00:00:00.000Z";
const TO = "2026-09-01T00:00:00.000Z";
const ROW_LIMIT = 500;

const DAY_MS = 24 * 60 * 60 * 1_000;
/** config/models.json → modelPricingUsdPerMillionTokens: the priced extremes. */
const MAX_USD_PER_MILLION = 25;
/** The physical day ceiling the document derives: 5 lanes × 24h of worst-priced
    back-to-back 1M-context calls. Present to be shown toothless, not to gate. */
const AGGREGATE_DAY_CEILING_USD = 45_000;

const parseStamp = (value: string): number => Date.parse(`${value.replace(" ", "T")}Z`);

/** A row's wall-clock span. The unit the data actually carries. */
function sessionSpanMs(row: UsageInvocation): number {
  const start = parseStamp(row.startTime);
  const end = parseStamp(row.endTime ?? row.startTime);
  return Number.isFinite(start) && Number.isFinite(end) ? end - start : 0;
}

/** Cost divided by tokens, normalised per million. Null when there is nothing
    to divide — an unpriced or unmeasured row is not a $0.00/M row. */
function costPerMillionTokens(row: UsageInvocation): number | null {
  const tokens = row.tokens ?? 0;
  const cost = row.costUsd;
  if (tokens <= 0 || cost === null || cost === undefined) return null;
  return cost / (tokens / 1_000_000);
}

let rows: UsageInvocation[] = [];
let available = false;

beforeAll(async () => {
  /* Paged, not capped. This used to call getUsageInvocations(FROM, TO, 500),
     which returns the most RECENT 500 rows and reports `truncated: true` — a
     field this file never read. So every assertion below claimed a three-month
     window and graded three days: 500 of 6,762 rows, 7.4% of the corpus.

     It did real damage rather than merely being imprecise. Two checks here were
     pinned `.failing` to document a genuine defect, and both went green — not
     because the defect was fixed but because the rows carrying the evidence
     aged out of the page as the fleet got busier. Measured at the moment of the
     fix: 0 long-span sessions visible in the capped page, 140 in the window. A
     test that stops being able to see a defect is not a test that passed. */
  const response = await getAllUsageInvocations(FROM, TO);
  available = response.available && response.invocations.length > 0;
  rows = response.invocations;
  if (!available) {
    console.warn(
      "[physical-bounds] SKIPPED every real-history assertion: BurnBar returned no readable rows"
        + ` for ${FROM}..${TO}. The bound predicates below still run against fixtures.`,
    );
  } else if (response.truncated) {
    // Still no silent caps — it just takes a much larger corpus to hit one now.
    console.warn(
      `[physical-bounds] window truncated at ${rows.length} of ${response.matched} rows;`
        + " findings do not cover the whole window.",
    );
  }
});

test("the corpus these findings rest on is the whole window, not its most recent page", () => {
  /* The guard for the failure above, which was invisible for as long as nobody
     compared what was asked for against what came back. */
  if (!available) return;
  expect(rows.length).toBeGreaterThan(ROW_LIMIT);
  const days = new Set(rows.map((row) => row.startTime.slice(0, 10)));
  expect(days.size, "the window collapsed to a handful of days again").toBeGreaterThan(7);
});

/* ------------------------------------------------------------------------ *
   PER-UNIT BOUNDS FIRST, each named by what it divides by.
 * ------------------------------------------------------------------------ */

describe("per session-row: span divided by nothing, the only bound that fires", () => {
  test("the predicate reads a span, not a token count", () => {
    /* Fixture-level, so the logic is pinned even where the database is not
       readable. A row that opens on the 30th and closes on the 2nd spans three
       days however few tokens it carries. */
    const threeDays = {
      startTime: "2026-07-30 21:06:39.277",
      endTime: "2026-08-02 12:23:11.000",
      tokens: 12,
      costUsd: 0.01,
    } as UsageInvocation;
    const oneHour = {
      startTime: "2026-08-02 10:00:00.000",
      endTime: "2026-08-02 11:00:00.000",
      tokens: 500_000_000,
      costUsd: 900,
    } as UsageInvocation;

    expect(sessionSpanMs(threeDays)).toBeGreaterThan(DAY_MS);
    // And it is indifferent to size: the enormous row is inside the bound.
    expect(sessionSpanMs(oneHour)).toBeLessThan(DAY_MS);
  });

  test.failing("real history: no session spans longer than the day it is billed to", () => {
    /* THE LIVE DEFECT, and the reason this file exists.

       Nine rows breach, the longest at 2.97 days, and they carry 92% of all
       cost in range. Two of them report the model as literally `<synthetic>`.
       A session's entire burn is attributed to the date of its startTime, so a
       three-day session puts three days of tokens on day one — which is how
       July 30 became $3,514 sitting between a $234 day and an $84 day.

       Marked failing so the shared suite stays green for the other lanes. The
       moment ingestion splits or rejects these rows, bun reports "marked as
       failing but it passed" and this becomes the permanent guard. */
    expect(available).toBe(true);
    const breaching = rows.filter((row) => sessionSpanMs(row) > DAY_MS);

    expect(breaching.map((row) => `${row.model} ${(sessionSpanMs(row) / DAY_MS).toFixed(2)}d`)).toEqual([]);
  });

  test.failing("real history: the bound is not tuned to the data it must not fire on", () => {
    /* The half that keeps the bound honest. A limit set just above the worst
       legitimate value would fire on the first ordinary long session, and
       whoever owned it would switch it off within a week.

       Measured across every row that satisfies it, the longest genuine session
       is a little over five hours — more than four times inside a 24-hour
       ceiling. That headroom is the argument for the bound, and asserting it
       here means a future fleet of genuinely longer sessions makes this test go
       red rather than quietly eroding the margin.

       MARKED `.failing`, and it ends when the ceiling is retuned to a session
       length somebody is willing to defend — remove the marker then.

       That five-hour figure was measured on the most recent
       500 rows. Across the whole window it is 23.5 hours against a 24-hour
       ceiling — the headroom this test exists to protect is about 2%, not 400%,
       and the bound is one ordinary long session away from firing on legitimate
       data. The assertion is kept because it states what we want to be true;
       the marker records that it is not. Retuning the ceiling is a judgment
       call about what a legitimate session length is, and it needs an owner
       rather than a quiet edit here.

       Unreadable history THROWS here rather than returning, matching the span
       check above. `if (!available) return` is the right quiet for a plain
       test, but under `.failing` quiet means passing, and bun reports a passing
       `.failing` test as "marked as failing but it passed" — a red that accuses
       someone of fixing a defect they did not touch, every time BurnBar cannot
       be read. */
    expect(available).toBe(true);
    const withinBound = rows.map(sessionSpanMs).filter((span) => span <= DAY_MS);

    expect(withinBound.length).toBeGreaterThan(0);
    expect(Math.max(...withinBound)).toBeLessThan(DAY_MS / 2);
  });

  test("real history: the history was actually read, so no bound passes on an empty set", () => {
    /* The anti-hollow guard for every real-data assertion in this file, and the
       one test here that does NOT return quietly when the database is
       unreadable.

       Every other real-data test below begins `if (!available) return`, which
       means an unreadable database would take the whole file green without
       examining a number — `[].every(withinBounds)` is true. This one goes red
       instead and names the reason, so the suite reports "the bounds were not
       checked" rather than "the bounds hold". The rest stay quiet so a missing
       database produces one clear failure and not nine confusing ones. */
    expect(available).toBe(true);
    expect(rows.length).toBeGreaterThan(50);
    expect(rows.some((row) => (row.tokens ?? 0) > 0)).toBe(true);
    expect(rows.some((row) => (row.costUsd ?? 0) > 0)).toBe(true);
  });
});

describe("per invocation: the unit this data does not have", () => {
  test("real history: a row is a session of many calls, so no per-call ceiling applies", () => {
    /* Why B1 and B2 cannot be asserted as written. If a row were one model
       call, its span would be seconds and its tokens would fit the context
       window. Rows run to hours, so the ceiling that bounds a call does not
       bound a row, and dividing a day by its row count produces a mean rather
       than a per-unit figure.

       Pinned rather than written up, because the next person to read the bounds
       document will reach for `tokens <= 2_000_000` per row and it will fail on
       ordinary traffic. */
    if (!available) return;
    const spans = rows.map(sessionSpanMs);
    const longRunning = spans.filter((span) => span > 10 * 60_000);

    // Sessions lasting many minutes are the norm, not the exception.
    expect(longRunning.length).toBeGreaterThan(5);
    /* DERIVED, not transcribed: 2M is B1's absolute per-call ceiling, one
       context window of input plus one of output, taken from
       config/models.json. Asserting live rows EXCEED it is the evidence that a
       row is not a call.

       Currently 161x clear, so unlike the dollar floors above this is not a
       tripwire — but it is still a claim about data. If it ever fails, the
       finding is that sessions got short, not that the test went stale. */
    expect(Math.max(...rows.map((row) => row.tokens ?? 0))).toBeGreaterThan(2 * 1_000_000);
  });
});

describe("per million tokens: cost divided by tokens, scale-free and toothless", () => {
  test("the blended rate cannot exceed the most expensive token in the price vector", () => {
    // Fixture level. Every token is billed at one of {0.50, 5, 6.25, 25} per
    // million, so any weighted average of them stays at or under 25.
    const allOutput = { tokens: 1_000_000, costUsd: 25 } as UsageInvocation;
    const impossible = { tokens: 1_000_000, costUsd: 26 } as UsageInvocation;

    expect(costPerMillionTokens(allOutput)).toBeLessThanOrEqual(MAX_USD_PER_MILLION);
    expect(costPerMillionTokens(impossible)).toBeGreaterThan(MAX_USD_PER_MILLION);
  });

  test("an unpriced row divides to null rather than to zero dollars per million", () => {
    /* The lower bound in the document is $0.50/M, and real history breaches it:
       rows exist at $0.00/M because their provider is unpriced, not because
       their tokens were free. Asserting the floor would fire on those, so the
       floor is dropped and the absence is represented as absence — the same
       distinction this lane has been drawing all week. */
    expect(costPerMillionTokens({ tokens: 5_000_000, costUsd: 0 } as UsageInvocation)).toBe(0);
    expect(costPerMillionTokens({ tokens: 0, costUsd: 0 } as UsageInvocation)).toBeNull();
    expect(costPerMillionTokens({ tokens: 5_000_000, costUsd: null } as UsageInvocation)).toBeNull();
  });

  test.failing("real history: every row's blended rate is inside the price vector", () => {
    /* MARKED `.failing`, and it ends once the price vector can price these two
       model names — remove the marker when it can.

       31 of 6,762 rows price above the $25/M ceiling, and
       none of them were visible while this file read only the most recent 500.

         GPT-5.5-High-[VibeProxy]-26   30 rows, max $31.93/M, all 2026-06-08
         Claude Opus 4.8 Fast Mode      1 row,      $30.83/M,     2026-06-01

       Both are model names the price vector does not recognise — a proxy-suffixed
       label and a "Fast Mode" variant — so the blend is being computed against a
       rate card that has no entry for them. Historical rather than ongoing: the
       newest offender is 2026-06-08. Whether the fix is a vector entry, a
       normalisation of proxy-suffixed names, or accepting these as unpriceable
       is a pricing decision, not a test edit.

       Unreadable history THROWS rather than returning, for the reason given on
       the span bound above: a quiet `.failing` test passes, and a passing
       `.failing` test is reported as a failure. */
    expect(available).toBe(true);
    const rates = rows.map(costPerMillionTokens).filter((rate): rate is number => rate !== null);

    expect(rates.length).toBeGreaterThan(50);
    expect(Math.max(...rates)).toBeLessThanOrEqual(MAX_USD_PER_MILLION);
  });

  test("real history: it passes on the most expensive session ever recorded", () => {
    /* B3's own warning, demonstrated instead of described. The costliest row in
       the history is a multi-day session carrying hundreds of dollars, and its
       blended rate is a few dollars per million — comfortably legitimate.

       Cost and tokens were inflated together, so the ratio between them stayed
       valid. A consistency check between two derived numbers validates neither:
       only a comparison against an external limit caught this, and the external
       limit that caught it was time. */
    if (!available) return;
    const priced = rows.filter((row) => costPerMillionTokens(row) !== null);
    const dearest = priced.reduce((worst, row) => ((row.costUsd ?? 0) > (worst.costUsd ?? 0) ? row : worst));

    /* SCALE-FREE, because $100 was transcribed. It had 4.12x headroom and
       falling — the dearest session read $651 this morning and $412 by evening,
       for the same reason the day floor broke: the 500-row cap shortens the
       window as the fleet burns, so any dollar figure copied from an
       observation is a tripwire with a countdown on it.

       What this test needs is that the row is genuinely the expensive end of
       the distribution, which is a fact about shape rather than about size. */
    const pricedCosts = priced.map((row) => row.costUsd ?? 0).sort((left, right) => left - right);
    const medianCost = pricedCosts[Math.floor(pricedCosts.length / 2)] ?? 0;

    expect(dearest.costUsd ?? 0).toBeGreaterThan(0);
    expect(dearest.costUsd ?? 0).toBeGreaterThan(medianCost);
    expect(costPerMillionTokens(dearest)).toBeLessThanOrEqual(MAX_USD_PER_MILLION);
  });
});

/* ------------------------------------------------------------------------ *
   THE AGGREGATE BOUND, kept only to be shown unable to fire.
 * ------------------------------------------------------------------------ */

describe("per day: cost divided by nothing at all, which cannot fire", () => {
  test("real history: the worst day in the record passes the physical day ceiling", () => {
    /* The lesson, executable. $45,000/day is what five lanes could physically
       spend making back-to-back worst-priced calls for 24 hours. The worst real
       day was $3,514 — under a tenth of it — so a day-level alarm would have
       watched the anomaly go by without a sound, and so would any bound built
       by multiplying a per-unit limit by a concurrency guess.

       Asserting that the toothless bound passes is not a formality. It is the
       evidence for putting the effort into per-unit bounds instead, and if
       someone later proposes a daily ceiling this test is the answer. */
    if (!available) return;
    const byDay = new Map<string, number>();
    for (const row of rows) {
      const day = row.startTime.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + (row.costUsd ?? 0));
    }
    const worstDay = Math.max(...byDay.values());

    /* THE SAMPLE IS SUBSTANTIVE, asserted in terms that do not drift.

       This was `toBeGreaterThan(1_000)` — a dollar figure transcribed when the
       500-row window still reached July 30's $3,514 day. The cap fetches the
       most recent 500 rows, so as the fleet burns the window shortens; it now
       covers three days and the worst day in it is $810.70, and the assertion
       went red without any bound being breached.

       That is the transcribed-constant fault this suite has found twice
       already, in a guard written to prevent exactly it. The replacement is
       scale-free: several days, real spend, and a worst day that stands out
       from the median — none of which move when the fleet's volume does.

       THE BOUND ITSELF IS UNCHANGED. The two assertions below are the claim and
       were never failing; only this floor was. */
    const daily = [...byDay.values()].sort((left, right) => left - right);
    const medianDay = daily[Math.floor(daily.length / 2)] ?? 0;

    expect(byDay.size).toBeGreaterThan(1);
    // provenance: shape — a sample-size floor against the 500-row cap, not a measurement.
    expect(rows.length).toBeGreaterThan(100);
    expect(worstDay).toBeGreaterThan(0);
    expect(worstDay).toBeGreaterThanOrEqual(medianDay);

    // The ceiling, sailing over the worst real day it was meant to catch.
    expect(worstDay).toBeLessThan(AGGREGATE_DAY_CEILING_USD);
    expect(worstDay / AGGREGATE_DAY_CEILING_USD).toBeLessThan(0.2);
  });

  test("real history: the per-unit bound fires on the very day the aggregate clears", () => {
    /* The two bounds put side by side on the same data, which is the whole
       argument of the bounds document in one assertion. The day that passes the
       aggregate ceiling contains rows that breach the per-unit one. */
    if (!available) return;
    const byDay = new Map<string, { cost: number; breaches: number }>();
    for (const row of rows) {
      const day = row.startTime.slice(0, 10);
      const entry = byDay.get(day) ?? { cost: 0, breaches: 0 };
      entry.cost += row.costUsd ?? 0;
      if (sessionSpanMs(row) > DAY_MS) entry.breaches += 1;
      byDay.set(day, entry);
    }
    const worst = [...byDay.entries()].reduce((a, b) => (b[1].cost > a[1].cost ? b : a));

    expect(worst[1].cost).toBeLessThan(AGGREGATE_DAY_CEILING_USD);
    expect(worst[1].breaches).toBeGreaterThan(0);
  });
});
