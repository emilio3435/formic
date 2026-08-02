import { describe, expect, test } from "bun:test";
import type { UsageSummary } from "../src/server/burnbar";
import { PulseTracker } from "../src/server/pulse";

/* The BURN card carried the same fleet-level gate the usage card had just lost.

   `#applyBurnSummary` showed a cost only when `costKnown` was true — that is,
   only when EVERY invocation in the window was priced. One unpriced Cursor call
   turned an hour of measured spend into "cost unavailable". The usage card had
   already stopped doing this; the hour had not, and the hour is the figure an
   operator watches to decide whether to keep a swarm running, which makes it
   the most expensive place on the board to withhold a number we hold.

   Two failures to keep apart, because the fix for one is the other:
     - withholding a measured floor reads as "we have no idea what this cost";
     - rendering a floor unmarked reads as a complete total, understating real
       spend while looking authoritative.
   So the floor ships AND is marked. */

const HOUR_MS = 60 * 60_000;
const base = Math.floor(Date.now() / (5 * 60_000)) * (5 * 60_000);

function summary(overrides: Partial<UsageSummary> = {}): UsageSummary {
  return {
    ok: true,
    available: true,
    provenance: "burnbar",
    source: "burnbar",
    from: new Date(base - HOUR_MS).toISOString(),
    to: new Date(base).toISOString(),
    processedTokens: 100,
    tokensKnown: true,
    tokensMissing: 0,
    estimatedCostUsd: null,
    measuredCostUsd: null,
    costMissingInvocations: 0,
    costKnown: false,
    invocations: 0,
    burnRateTokensPerHour: 100,
    byProvider: [],
    ...overrides,
  };
}

async function burnFrom(overrides: Partial<UsageSummary>) {
  const tracker = new PulseTracker(async () => summary(overrides), base);
  tracker.maybeRefreshBurnCost(base);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return tracker.report(base + 1_000).burn;
}

describe("the hour's cost is reported to the limit of what was measured", () => {
  test("a partly-priced hour reports its floor instead of going blank", async () => {
    /* The defect, as an assertion. $42.50 of measured spend in the last hour
       was rendered "cost unavailable" because 3 of 200 calls had no price. */
    const burn = await burnFrom({
      estimatedCostUsd: null,
      costKnown: false,
      measuredCostUsd: 42.5,
      costMissingInvocations: 3,
      invocations: 200,
    });

    expect(burn.costLastHourUsd).toBe(42.5);
    expect(burn.costProvenance).toBe("burnbar");
  });

  test("the floor is marked as a floor, so it cannot be banked as a total", async () => {
    const burn = await burnFrom({
      estimatedCostUsd: null,
      costKnown: false,
      measuredCostUsd: 42.5,
      costMissingInvocations: 3,
      invocations: 200,
    });

    expect(burn.costIsFloor).toBe(true);
    // And the note says how much of the hour it is not describing.
    expect(burn.costNote).toMatch(/3 of 200 calls unpriced/);
  });

  test("a fully-priced hour is a total, and is not marked as a floor", async () => {
    /* The control. If costIsFloor were set unconditionally the mark would stop
       meaning anything, which is how a qualifier becomes decoration. */
    const burn = await burnFrom({
      estimatedCostUsd: 19.54,
      costKnown: true,
      measuredCostUsd: 19.54,
      costMissingInvocations: 0,
      invocations: 200,
    });

    expect(burn.costLastHourUsd).toBe(19.54);
    expect(burn.costIsFloor).toBeUndefined();
    expect(burn.costNote).toBeUndefined();
  });

  test("an hour that priced nothing still says so rather than inventing a floor", async () => {
    // Absent-first survives the change: no priced call means no floor, not $0.
    const burn = await burnFrom({ measuredCostUsd: null, invocations: 12 });

    expect(burn.costLastHourUsd).toBeNull();
    expect(burn.costIsFloor).toBeUndefined();
    expect(burn.costNote).toBe("No priced invocations in this window.");
  });

  test("an unreadable source is still unavailable, not a floor of zero", async () => {
    /* A source that could not be read and a source that priced nothing are
       different facts an operator acts on differently — the distinction this
       card already drew, which the fallback must not flatten. */
    const burn = await burnFrom({ available: false, error: "SQLCipher key unavailable", measuredCostUsd: 99 });

    expect(burn.costLastHourUsd).toBeNull();
    expect(burn.costProvenance).toBe("unavailable");
    expect(burn.costNote).toBe("SQLCipher key unavailable");
  });

  test("a floor that changes only in its note still refreshes the card", async () => {
    /* The card's state is the figure AND its explanation. An hour whose dollar
       total is unchanged but whose gap grew is a different claim, and the
       de-duplication that keeps this card stable must not swallow it. */
    const stable = { estimatedCostUsd: null, costKnown: false, measuredCostUsd: 42.5, invocations: 200 };
    const first = await burnFrom({ ...stable, costMissingInvocations: 3 });
    const second = await burnFrom({ ...stable, costMissingInvocations: 40 });

    expect(first.costLastHourUsd).toBe(second.costLastHourUsd);
    expect(first.costNote).not.toBe(second.costNote);
  });
});
