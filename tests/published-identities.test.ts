import { beforeAll, describe, expect, test } from "bun:test";
import { getUsageSummary } from "../src/server/burnbar";

/* The identities from docs/PUBLISHED-IDENTITIES-GPT.md, pinned.

   A bound says a number is wrong. An identity says a number is wrong AND WHERE,
   because the pattern of its failure across parameters localises the defect.
   I1 is the proof: it read 47,700.90 at 1h and 24h, then 46,238.51 at 7d and
   44,528.08 at 30d, and that shape alone — two narrow windows agreeing exactly
   while the total shrinks as the window widens — diagnosed the window being
   deduplicated while priorSpend was not, without anyone opening burnbar.ts.

   SO EVERY IDENTITY HERE IS ASSERTED ACROSS FOUR WINDOW SIZES, not one. A
   single-window assertion would have passed at 1h and reported nothing. The
   diagnosis lives in the comparison between parameters, so the comparison is
   what has to be in the suite.

   Measured three times while writing this, and the numbers moved twice:

     BEFORE the dedup   I1 47,700.90 / 47,700.90 / 46,238.51 / 44,528.08
                        I2 8,632 / 8,632 / 8,629 / 8,604  (~28 duplicate rows)
     AFTER the dedup    I2 HOLDS at 7,846 everywhere. I1 still failed, with its
                        signature INVERTED — constant through 7d then jumping UP
                        by 1,824.67 at 30d instead of shrinking.
     AFTER priorSpend   I1 HOLDS at 32,471.40 everywhere.
       was deduped too

   Both of those fixes landed mid-run, which is the argument for this file
   existing: I wrote I1 as a failing test, it reported "marked as failing but it
   passed" on the next run, and that is how I learned the second fix had landed.

   I3 is unchanged through all of it: exact through 7d, $1.17 short at 30d. It
   is the only one still failing, and it is the residual the other two fixes did
   not reach.

   The narrow-window halves of I1 and I3 are asserted SEPARATELY from the
   all-window versions. That is where the localisation lives: a failing test is
   already red and cannot tell you when a defect spreads, so the assertion that
   1h/24h/7d still agree is what would report the discrepancy moving inward. */

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

const WINDOWS = [
  { label: "1h", ms: HOUR_MS },
  { label: "24h", ms: DAY_MS },
  { label: "7d", ms: 7 * DAY_MS },
  { label: "30d", ms: 30 * DAY_MS },
] as const;

/** Windows whose contents are entirely recent enough that both residuals are
    absent today. Kept separate so the localisation itself is asserted: if a
    defect spreads inward from 30d, these go red and say so. */
const NARROW = ["1h", "24h", "7d"] as const;

type Summary = Awaited<ReturnType<typeof getUsageSummary>>;

const summaries = new Map<string, Summary>();
let available = false;

beforeAll(async () => {
  /* One clock for every window, so the four are nested by construction. Reading
     Date.now() per window would let a slow run shift the boundaries and turn a
     genuine identity failure into a timing artefact. */
  const now = Date.now();
  for (const { label, ms } of WINDOWS) {
    summaries.set(label, await getUsageSummary(new Date(now - ms).toISOString(), new Date(now).toISOString()));
  }
  available = [...summaries.values()].every((summary) => summary.available);
  if (!available) console.warn("[published-identities] BurnBar unavailable; identity assertions did not run.");
});

const at = (label: string): Summary => summaries.get(label)!;
const priorCost = (label: string): number => at(label).priorSpend.measuredCostUsd ?? 0;
const totalCost = (label: string): number => (at(label).measuredCostUsd ?? 0) + priorCost(label);
const totalInvocations = (label: string): number => (at(label).invocations ?? 0) + at(label).priorSpend.invocations;
const providerCost = (label: string): number =>
  at(label).byProvider.reduce((total, provider) => total + (provider.costUsd ?? 0), 0);
const round = (value: number): number => Math.round(value * 100) / 100;

describe("identities that must hold whatever window you ask for", () => {
  test("the identities were actually evaluated, so none of them passed on an empty read", () => {
    /* The loud canary. Every other test here returns quietly when BurnBar is
       unreadable, which would take the file green without comparing a single
       number. This one goes red and names the reason. */
    expect(available).toBe(true);
    expect(summaries.size).toBe(WINDOWS.length);
    expect(at("30d").invocations ?? 0).toBeGreaterThan(0);
  });

  test("I2: invocations plus prior invocations is the same count at every window", () => {
    /* HOLDS, and it did not before — 8,632 at the narrow windows against 8,604
       at 30d, implying about 28 duplicated rows. That spread is now zero.

       Kept as a permanent guard rather than deleted with the bug: this is the
       identity that would catch the dedup being applied to one side again, and
       it is the cheapest of the three to satisfy accidentally. */
    if (!available) return;
    const counts = WINDOWS.map(({ label }) => totalInvocations(label));

    expect(new Set(counts).size, `invocations+prior differed across windows: ${counts.join(" ")}`).toBe(1);
  });

  test("I1: cost plus prior cost is the same total at every window", () => {
    /* HOLDS, as of the priorSpend dedup landing.

       The identity says the total measured spend ever cannot depend on where
       you draw the window boundary, because everything outside the window is
       exactly what priorSpend reports. It failed in two distinct ways today —
       first shrinking as the window widened, then jumping up at 30d after the
       window side alone was treated — and each shape named which side was
       untreated without anyone reading burnbar.ts.

       Kept as the permanent guard. It is the identity that catches a dedup, a
       filter or a cap being applied to one side of this sum and not the other,
       which has now happened twice. */
    if (!available) return;
    const totals = WINDOWS.map(({ label }) => `${label}=${round(totalCost(label))}`);

    expect(new Set(WINDOWS.map(({ label }) => round(totalCost(label)))).size, totals.join(" ")).toBe(1);
  });

  test("I1 holds across every window inside a week, which is where it broke first", () => {
    /* The localisation, asserted rather than described.

       This is the half of I1 that passes, and keeping it separate is what makes
       the failure diagnostic instead of merely present. If the discrepancy ever
       reaches 7d, this goes red and says the defect moved inward — which the
       failing test above could not tell you, since it is already red. */
    if (!available) return;
    const totals = NARROW.map((label) => round(totalCost(label)));

    expect(new Set(totals).size, `narrow windows disagreed: ${totals.join(" ")}`).toBe(1);
  });

  test.failing("I3: the provider breakdown sums to the scalar it breaks down, at every window", () => {
    /* FAILS at 30d by $1.17, exact everywhere else. A breakdown that does not
       add up to its own total means the scalar and the per-provider rows are
       computed over differently treated row sets — the same shape as I1, in a
       third place, and confined to the same old rows.

       Marked failing until the backend resolves where the $1.17 is dropped —
       it is routed, and two fixes to this family have now passed it without
       touching it. It flips to a hard failure the moment the scalar and the
       breakdown are computed over the same rows, which is the signal to remove
       this marker rather than the test. */
    if (!available) return;
    const gaps = WINDOWS.map(({ label }) => `${label}=${round(providerCost(label) - (at(label).measuredCostUsd ?? 0))}`);

    /* Counted, because an identity that never meets a non-zero case passes
       forever and proves nothing. The 1h window is routinely EMPTY on this
       fleet — measured 0 invocations, $0.00, and an empty byProvider — so its
       evaluation here is 0 === 0 and carries no information.

       The file-level non-vacuity test below cannot see that: it asserts the
       four windows collectively differ, which they do, while one of them
       contributes a vacuous comparison. Per case, not globally. */
    let compared = 0;
    for (const { label } of WINDOWS) {
      expect(providerCost(label), gaps.join(" ")).toBeCloseTo(at(label).measuredCostUsd ?? 0, 2);
      if (at(label).byProvider.length > 0 && providerCost(label) > 0) compared += 1;
    }

    expect(compared, "every window compared an empty breakdown").toBeGreaterThan(0);
  });

  test("I3 holds across every window inside a week", () => {
    // Same localisation as I1, and they move together — which is the evidence
    // that this is one omission rather than two.
    if (!available) return;
    for (const label of NARROW) {
      expect(providerCost(label), `${label} breakdown does not sum to its scalar`)
        .toBeCloseTo(at(label).measuredCostUsd ?? 0, 2);
    }
  });

  test("I4: the provider breakdown sums to the invocation count, at every window", () => {
    /* Holds, and it is the counterpart to I3 that makes the pair informative:
       counts reconcile while costs do not, so whatever is missed is being
       dropped from a cost sum and not from a row set. An identity that fails
       alongside its own control tells you much less. */
    if (!available) return;
    let compared = 0;
    for (const { label } of WINDOWS) {
      const counted = at(label).byProvider.reduce((total, provider) => total + provider.invocations, 0);
      expect(counted, `${label} provider invocations do not sum`).toBe(at(label).invocations ?? 0);
      if (counted > 0) compared += 1;
    }

    // Same reason as I3: the empty window's 0 === 0 is not evidence of anything.
    expect(compared, "every window compared an empty breakdown").toBeGreaterThan(0);
  });

  test("I7: widening the window never reduces the cost inside it", () => {
    /* Nested windows must be monotone: a superset cannot measure less than the
       set it contains. This is the identity that would have caught the original
       I1 shape from the window side alone. */
    if (!available) return;
    for (let index = 1; index < WINDOWS.length; index += 1) {
      const wider = at(WINDOWS[index]!.label).measuredCostUsd ?? 0;
      const narrower = at(WINDOWS[index - 1]!.label).measuredCostUsd ?? 0;
      expect(wider, `${WINDOWS[index]!.label} measured less than ${WINDOWS[index - 1]!.label}`)
        .toBeGreaterThanOrEqual(narrower);
    }
  });

  test("the four windows genuinely differ, so agreement across them means something", () => {
    /* The anti-hollow guard, and this file needs it more than most.

       Every identity above is of the form "these are all equal". On a fleet
       with no data they would be equal at zero and every assertion would pass
       while comparing nothing. Worse, if all four windows returned identical
       payloads — a caching bug, a broken date filter — the constancy tests
       would pass by construction and I1's failure would be the only signal left
       that the parameters were being varied at all. */
    if (!available) return;
    const measured = WINDOWS.map(({ label }) => at(label).measuredCostUsd ?? 0);
    const invocations = WINDOWS.map(({ label }) => at(label).invocations ?? 0);

    expect(new Set(measured).size, `all windows measured the same cost: ${measured.join(" ")}`).toBeGreaterThan(1);
    expect(new Set(invocations).size).toBeGreaterThan(1);
    expect(at("30d").invocations ?? 0).toBeGreaterThan(at("1h").invocations ?? 0);
    // And the prior side has to be carrying something, or I1 and I2 are
    // comparing the window against zero four times.
    expect(at("1h").priorSpend.invocations).toBeGreaterThan(0);
  });
});
