import { beforeAll, describe, expect, test } from "bun:test";
import { PulseTracker } from "../src/server/pulse";
import { buildSnapshot } from "../src/server/snapshot";
import type { HubSnapshot } from "../src/shared/types";
import type { ArchiveStore, CollectedAgent } from "../src/server/types";

/* The quiet board.

   Every measurement and nearly every fixture in this project has assumed a busy
   fleet — 382 to 441 agents during the magnitude audit. So the zero, one and
   three agent paths are the least exercised code here, and they are the first
   thing a new operator sees: an empty board on first run, one agent while they
   try it, three while they get going.

   Aggregates are where small n bites. A mean over zero agents divides by zero,
   a median over an even count averages two elements that may not exist, a rate
   needs a window it has not had time to fill, and a percentage needs a
   denominator. Each is asserted here at n = 0, 1, 2 and 3.

   The last block guards the cost surface, which is the same shape of problem —
   an aggregate over a window and a population — and which was verified correct
   but unprotected. */

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
const NOW = new Date("2026-08-02T10:00:00.000Z");
const HOUR_MS = 60 * 60_000;

function agentN(index: number, overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: `codex:a${index}`,
    provider: "codex",
    sourceSessionId: `a${index}`,
    displayName: `Worker ${index}`,
    cwd: "/Users/me/project",
    status: "running",
    statusReason: "Source activity within 3 minutes.",
    startedAt: "2026-08-02T09:00:00.000Z",
    updatedAt: "2026-08-02T09:59:00.000Z",
    tokens: { scope: "latest-turn", provenance: "observed", total: 1_000 * index, contextWindow: 1_000_000 },
    artifacts: [],
    gates: [],
    ...overrides,
  };
}

const fleetOf = (size: number): HubSnapshot =>
  buildSnapshot({
    agents: Array.from({ length: size }, (_, index) => agentN(index + 1)),
    surfaces: [],
    archiveStore,
    now: NOW,
  } as never);

/** Every number the snapshot publishes, flattened, so none can be missed. */
function publishedNumbers(snapshot: HubSnapshot): [string, unknown][] {
  const totals = snapshot.totals as unknown as Record<string, unknown>;
  return [
    ...Object.entries(totals).filter(([, value]) => typeof value === "number").map(([key, value]) => [`totals.${key}`, value] as [string, unknown]),
    ["contextPeak", snapshot.contextPeak],
    ["contextMedian", snapshot.contextMedian],
    ...snapshot.programs.flatMap((program) =>
      Object.entries((program.rollup ?? {}) as Record<string, unknown>)
        .map(([key, value]) => [`rollup.${key}`, value] as [string, unknown])),
  ];
}

describe("a board with almost nothing on it still computes", () => {
  test.each([0, 1, 2, 3])("no published number is NaN or Infinity at %i agents", (size) => {
    /* The floor. A mean over zero, a median over an even count, and a
       percentage with no denominator are the three classic ways small n
       produces a number that renders as "NaN" or "Infinity" on a board. */
    for (const [name, value] of publishedNumbers(fleetOf(size))) {
      if (value === undefined || value === null) continue;
      expect(`${name}=${value}`).toBe(`${name}=${value}`);
      expect(Number.isFinite(value as number), `${name} is ${value}`).toBe(true);
    }
  });

  test.each([0, 1, 2, 3])("counts partition exactly at %i agents", (size) => {
    // The partition property from a20605d, at the sizes where an off-by-one is
    // invisible in a fleet of 400.
    const snapshot = fleetOf(size);
    const { working, idle, ended, tracked } = snapshot.totals;

    expect(tracked).toBe(size);
    expect(working! + idle! + ended!).toBe(size);
  });

  test("an empty board reports absence, not zero, for what it cannot measure", () => {
    /* Zero tokens burned and "nobody reported tokens" are different claims, and
       on an empty board only the second is true. Reporting 0 would tell a new
       operator their fleet is free. */
    const empty = fleetOf(0);

    expect(empty.totals.tracked).toBe(0);
    expect(empty.totals.tokens).toBeUndefined();
    expect(empty.totals.tokenMedian).toBeUndefined();
    expect(empty.contextPeak).toBeUndefined();
    expect(empty.contextMedian).toBeUndefined();
  });

  test("one agent is its own total, median and peak", () => {
    /* n = 1 is where a median implementation that averages the two middle
       elements reads past the end of the array. */
    const single = fleetOf(1);

    expect(single.totals.tokens).toBe(1_000);
    expect(single.totals.tokenMedian).toBe(1_000);
  });

  test("two agents take the mean of the middle pair, not an element that is not there", () => {
    // The even branch, at the smallest size that has one.
    const pair = fleetOf(2);

    expect(pair.totals.tokens).toBe(3_000);
    expect(pair.totals.tokenMedian).toBe(1_500);
  });

  test("three agents take the true middle", () => {
    const trio = fleetOf(3);

    expect(trio.totals.tokens).toBe(6_000);
    expect(trio.totals.tokenMedian).toBe(2_000);
  });

  test("the source health denominator survives an empty fleet", () => {
    /* Four sources exist whether or not any agent does, so an empty board is
       4/4 healthy rather than 0/0 — which would render as a division by zero
       or an empty meter on first run. */
    for (const size of [0, 1, 3]) {
      expect(fleetOf(size).totals.sourceHealth).toEqual({ healthy: 4, degraded: 0, total: 4 });
    }
  });
});

describe("a rate is not claimed before there is a window to divide by", () => {
  const pulseFor = (size: number, watchedMs: number) => {
    const tracker = new PulseTracker(undefined, NOW.getTime() - watchedMs);
    tracker.observe(fleetOf(size), NOW.getTime());
    return tracker.report(NOW.getTime());
  };

  test.each([0, 1, 3])("a brand-new tracker over %i agents reports no rate rather than zero", (size) => {
    /* First run: the tracker has just started, so there is no window to divide
       tokens by. Null is the honest answer; 0 would read as "this fleet is
       burning nothing", which is a measurement rather than an absence. */
    const pulse = pulseFor(size, 0);

    expect(pulse.burn.tokensPerMin).toBeNull();
    expect(pulse.burn.windowMs).toBe(0);
  });

  test.each([0, 1, 3])("no pulse figure is NaN at %i agents", (size) => {
    const pulse = pulseFor(size, HOUR_MS);

    for (const value of [pulse.burn.tokensPerMin, pulse.burn.windowMs, pulse.momentum.completionsLastHour,
      pulse.momentum.observedWindowMs, pulse.momentum.stalled, pulse.momentum.working]) {
      if (value === null) continue;
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  test("coverage never names more reporters than the fleet holds", () => {
    /* The percentage trap at small n: one agent of one reporting is 100%, and
       zero of zero must not be computed at all. */
    for (const size of [0, 1, 3]) {
      const { reporting, eligible } = pulseFor(size, HOUR_MS).burn.coverage;

      expect(reporting).toBeLessThanOrEqual(eligible);
      expect(eligible).toBeLessThanOrEqual(size);
    }
  });

  test("an empty fleet reports no stalls rather than dividing to find them", () => {
    const pulse = pulseFor(0, HOUR_MS);

    expect(pulse.momentum.stalled).toBe(0);
    expect(pulse.momentum.stalledAgentIds).toEqual([]);
    expect(pulse.momentum.working).toBe(0);
  });
});

describe("the cost surface reports what it measured, over the window it names", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let M: any;

  beforeAll(async () => {
    // @ts-expect-error The dependency-free browser client has no declaration file.
    await import("../src/web/app.js");
    M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
  });

  test("a partly-priced range reports the measured subtotal, not 'not reported'", () => {
    /* Verified correct and previously unprotected. A headline reading "not
       reported" above a provider row reading "$0.050" contradicts itself; the
       honest form states the subtotal and how much of the range it misses. */
    /* Fixture moved to the server contract. This originally supplied byProvider
       rows, because the client summed them itself while estimatedCostUsd was
       the only cost field on the wire. The server now ships measuredCostUsd and
       costMissingInvocations, and the client-side sum was deleted rather than
       kept as a second opinion — two derivations of one number is the seam
       behind every attention and token defect on this board. The intent below
       is unchanged and is what actually matters. */
    const reading = M.usageCostReading({
      costKnown: false, estimatedCostUsd: null, invocations: 3,
      measuredCostUsd: 0.05, costMissingInvocations: 1,
    });

    expect(reading.value).not.toBe("not reported");
    expect(reading.value).toContain("0.05");
    expect(reading.sub).toMatch(/unpriced/i);
  });

  test("a range with nothing priced says so rather than inventing a subtotal", () => {
    // The other side: a subtotal of nothing is not a subtotal.
    const reading = M.usageCostReading({
      costKnown: false, estimatedCostUsd: null, invocations: 1,
      measuredCostUsd: null, costMissingInvocations: 1,
    });

    expect(reading.value).toBe("not reported");
  });

  test("a fully priced range reports the total it was given", () => {
    const reading = M.usageCostReading({ costKnown: true, estimatedCostUsd: 1.25, invocations: 4, byProvider: [] });

    expect(reading.value).toContain("1.25");
  });
});
