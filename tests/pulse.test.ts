import { describe, expect, test } from "bun:test";
import type { UsageSummary } from "../src/server/burnbar";
import { PulseTracker } from "../src/server/pulse";
import type { AgentSnapshot, HubSnapshot } from "../src/shared/types";

const BUCKET_MS = 5 * 60_000;
const HOUR_MS = 60 * 60_000;
const base = Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function agent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: "codex:test",
    provider: "codex",
    sourceSessionId: "test",
    displayName: "Test session",
    programId: "project",
    status: "running",
    statusReason: "Fixture activity is recent.",
    activity: "working",
    outcome: "healthy",
    updatedAt: iso(base),
    tokens: { sessionTotal: 0, provenance: "observed" },
    lastHumanMessage: null,
    artifacts: [],
    gates: [],
    target: { resolution: "missing" },
    controls: [],
    ...overrides,
  };
}

function snapshot(agents: readonly AgentSnapshot[]): HubSnapshot {
  const live = agents.filter((candidate) => candidate.activity === "working" || candidate.activity === "idle");
  return {
    schemaVersion: 1,
    generatedAt: iso(base),
    controlHealth: { cmuxReachable: true, lastCheckedAt: iso(base), errors: [], staleSources: [] },
    totals: {
      live: live.length,
      tracked: agents.length,
      attention: agents.filter((candidate) => candidate.status === "attention").length,
      working: agents.filter((candidate) => candidate.activity === "working").length,
      idle: agents.filter((candidate) => candidate.activity === "idle").length,
      ended: agents.filter((candidate) => candidate.activity === "ended").length,
    },
    programs: agents.length > 0 ? [{ id: "project", name: "Project", agents: [...agents] }] : [],
  };
}

function usageSummary(overrides: Partial<UsageSummary> = {}): UsageSummary {
  return {
    ok: true,
    available: true,
    provenance: "burnbar",
    source: "burnbar",
    from: iso(base - HOUR_MS),
    to: iso(base),
    processedTokens: 100,
    tokensKnown: true,
    tokensMissing: 0,
    estimatedCostUsd: 1.25,
    measuredCostUsd: 1.25,
    costMissingInvocations: 0,
    costKnown: true,
    invocations: 2,
    burnRateTokensPerHour: 100,
    byProvider: [],
    ...overrides,
  };
}

async function flushBurnReader(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("PulseTracker", () => {
  /* Two tests stood here: "counts working-to-idle/ended transitions, ages them
     out, and ignores disappearance" and "uses the agent completion time rather
     than the later observation time". Both pinned the mechanics of a counter
     that has been removed, because the edge it counted was never a completion —
     see tests/completions-counter.test.ts, which pins that those same scenarios
     now score nothing. Deleted rather than adapted: there is no quantity left
     for them to be about. */

  test("includes only healthy live sessions quiet for at least fifteen minutes", () => {
    const now = base + HOUR_MS;
    const tracker = new PulseTracker(undefined, base);
    tracker.observe(
      snapshot([
        agent({ id: "attention", status: "attention", activity: "idle", outcome: "healthy", updatedAt: iso(now - 20 * 60_000) }),
        agent({ id: "ended", status: "archived", activity: "ended", outcome: "healthy", updatedAt: iso(now - 20 * 60_000) }),
        agent({ id: "fresh", updatedAt: iso(now - 14 * 60_000) }),
        agent({ id: "stalled", activity: "idle", status: "waiting", updatedAt: iso(now - 15 * 60_000) }),
      ]),
      now,
    );

    expect(tracker.report(now).momentum).toMatchObject({ stalled: 1, stalledAgentIds: ["stalled"] });
    expect(tracker.report(now).momentum.stallThresholdMs).toBe(15 * 60_000);
  });

  test("derives token rate from observed deltas, excludes Cursor, and never subtracts after a reset", () => {
    const tracker = new PulseTracker(undefined, base);
    const codexAt = (minutes: number, sessionTotal: number): AgentSnapshot => agent({
      id: "codex:reporting",
      updatedAt: iso(base + minutes * 60_000),
      tokens: { sessionTotal, provenance: "observed" },
    });
    const cursorAt = (minutes: number): AgentSnapshot => agent({
      id: "cursor:unknown",
      provider: "cursor",
      updatedAt: iso(base + minutes * 60_000),
      tokens: { provenance: "unknown" },
    });

    tracker.observe(snapshot([codexAt(1, 100), cursorAt(1)]), base + 60_000);
    tracker.observe(snapshot([codexAt(2, 160), cursorAt(2)]), base + 2 * 60_000);
    tracker.observe(snapshot([codexAt(6, 220), cursorAt(6)]), base + 6 * 60_000);
    tracker.observe(snapshot([codexAt(11, 260), cursorAt(11)]), base + 11 * 60_000);

    const first = tracker.report(base + 15 * 60_000 + 1_000);
    expect(first.burn.tokensPerMin).toBe(10);
    expect(first.burn.windowMs).toBe(10 * 60_000);
    expect(first.burn.coverage).toEqual({ reporting: 1, eligible: 1, unknown: 1 });

    tracker.observe(snapshot([codexAt(16, 10), cursorAt(16)]), base + 16 * 60_000);
    tracker.observe(snapshot([codexAt(17, 25), cursorAt(17)]), base + 17 * 60_000);
    const afterReset = tracker.report(base + 20 * 60_000 + 1_000);
    expect(afterReset.burn.tokensPerMin).toBe(6);
    expect(afterReset.activity.buckets.at(-1)?.tokens).toBe(15);
  });

  test("keeps BurnBar spend honest, refreshes at most once per minute, and stabilizes rounded cost metadata", async () => {
    const firstAsOf = iso(base + 2 * 60_000);
    const sameRoundedAsOf = iso(base + 3 * 60_000);
    const changedAsOf = iso(base + 4 * 60_000);
    const summaries: UsageSummary[] = [
      usageSummary({ available: false, provenance: "unavailable", estimatedCostUsd: null, costKnown: false, to: iso(base + 1 * 60_000) }),
      usageSummary({ available: true, estimatedCostUsd: 99, costKnown: false, to: iso(base + 2 * 60_000), byProvider: [{ provider: "Cursor", tokens: 50, tokensMissing: 0, costUsd: null, measuredCostUsd: null, costMissingInvocations: 0, invocations: 2 }] }),
      usageSummary({ estimatedCostUsd: 1.234, to: firstAsOf }),
      usageSummary({ estimatedCostUsd: 1.231, to: sameRoundedAsOf }),
      usageSummary({ estimatedCostUsd: 1.239, to: changedAsOf }),
    ];
    let reads = 0;
    const tracker = new PulseTracker(async () => summaries[Math.min(reads++, summaries.length - 1)]!, base);

    tracker.maybeRefreshBurnCost(base);
    await flushBurnReader();
    expect(reads).toBe(1);
    expect(tracker.report(base + 1_000).burn.costLastHourUsd).toBeNull();

    tracker.maybeRefreshBurnCost(base + 30_000);
    await flushBurnReader();
    expect(reads).toBe(1);

    tracker.maybeRefreshBurnCost(base + 60_001);
    await flushBurnReader();
    expect(reads).toBe(2);
    expect(tracker.report(base + 60_001).burn).toMatchObject({ costLastHourUsd: null, costProvenance: "unavailable" });

    tracker.maybeRefreshBurnCost(base + 120_001);
    await flushBurnReader();
    const known = tracker.report(base + 120_001).burn;
    expect(known.costLastHourUsd).toBe(1.23);
    expect(known.costAsOf).toBe(firstAsOf);

    tracker.maybeRefreshBurnCost(base + 180_001);
    await flushBurnReader();
    expect(tracker.report(base + 180_001).burn).toMatchObject({ costLastHourUsd: 1.23, costAsOf: firstAsOf });

    tracker.maybeRefreshBurnCost(base + 240_001);
    await flushBurnReader();
    expect(tracker.report(base + 240_001).burn).toMatchObject({ costLastHourUsd: 1.24, costAsOf: changedAsOf });
  });

  /* The BURN card was seen reporting 37k/min, "cost unavailable" and
     "9 of 9 reporting" at once. All three numbers were individually true, but
     burn.coverage counts agents reporting TOKEN totals — it is the coverage of
     tokensPerMin and never described the cost, which comes from the encrypted
     BurnBar database instead. With no reason to print beside "cost
     unavailable", the card reached for the token coverage. The payload now
     carries the cost's own reason, so the two are never conflated again. */
  test("an unavailable cost states its own reason rather than leaving the card to borrow coverage", async () => {
    const tracker = new PulseTracker(
      async () => usageSummary({
        available: false,
        provenance: "unavailable",
        estimatedCostUsd: null,
        costKnown: false,
        error: "BurnBar database not found",
      }),
      base,
    );
    // A fleet whose tokens ARE fully covered: this is the exact shape that made
    // the card contradict itself.
    tracker.observe(snapshot([agent({ tokens: { sessionTotal: 1_000, provenance: "observed" } })]), base);
    tracker.maybeRefreshBurnCost(base);
    await flushBurnReader();

    const burn = tracker.report(base + 1_000).burn;
    expect(burn.costLastHourUsd).toBeNull();
    expect(burn.costProvenance).toBe("unavailable");
    // The cost explains itself...
    expect(burn.costNote).toBe("BurnBar database not found");
    // ...while coverage keeps describing the token rate, its actual subject.
    expect(burn.coverage).toMatchObject({ reporting: 1, eligible: 1 });
  });

  test("a priced window with no cost reports the absence of priced invocations, not a source failure", async () => {
    const tracker = new PulseTracker(
      async () => usageSummary({ available: true, estimatedCostUsd: null, costKnown: false }),
      base,
    );
    tracker.maybeRefreshBurnCost(base);
    await flushBurnReader();

    const burn = tracker.report(base + 1_000).burn;
    expect(burn.costLastHourUsd).toBeNull();
    // A reachable source that priced nothing is a different fact from a source
    // that could not be read, and the operator acts differently on each.
    expect(burn.costNote).toBe("No priced invocations in this window.");
  });

  test("a burn reader deadline marks stale cost unavailable and permits a later retry", async () => {
    let reads = 0;
    const never = new Promise<never>(() => {});
    const tracker = new PulseTracker(async () => {
      reads += 1;
      if (reads === 1) return usageSummary({ estimatedCostUsd: 1.25 });
      if (reads === 2) return never;
      return usageSummary({ estimatedCostUsd: 2.5, to: iso(base + 3 * 60_000) });
    }, base, 20);

    tracker.maybeRefreshBurnCost(base);
    await flushBurnReader();
    expect(tracker.report(base).burn).toMatchObject({
      costLastHourUsd: 1.25,
      costProvenance: "burnbar",
    });

    tracker.maybeRefreshBurnCost(base + 60_001);
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
    expect(tracker.report(base + 60_041).burn).toMatchObject({
      costLastHourUsd: null,
      costProvenance: "unavailable",
    });

    tracker.maybeRefreshBurnCost(base + 120_002);
    await flushBurnReader();
    expect(reads).toBe(3);
    expect(tracker.report(base + 120_002).burn).toMatchObject({
      costLastHourUsd: 2.5,
      costProvenance: "burnbar",
    });
  });

  test("aligns five-minute buckets, publishes completed history only, counts each agent once, and caps history", () => {
    const tracker = new PulseTracker(undefined, base);
    expect(tracker.report(base + 1_000).activity.buckets).toEqual([]);

    const updates = [1, 2, 3, 6].map((minutes) => base + minutes * 60_000);
    for (const updateAt of updates) {
      tracker.observe(snapshot([agent({ updatedAt: iso(updateAt) })]), updateAt);
    }
    expect(tracker.report(base + 4 * 60_000).activity.buckets).toEqual([]);

    const firstTwo = tracker.report(base + 10 * 60_000 + 1_000).activity.buckets;
    expect(firstTwo).toHaveLength(2);
    expect(firstTwo.map(({ start }) => Date.parse(start))).toEqual([base, base + BUCKET_MS]);
    expect(firstTwo.every(({ activeSessions }) => activeSessions === 1)).toBe(true);

    const capped = new PulseTracker(undefined, base);
    for (let bucket = 0; bucket < 20; bucket += 1) {
      const updatedAt = base + bucket * BUCKET_MS + 1_000;
      capped.observe(snapshot([agent({ updatedAt: iso(updatedAt) })]), updatedAt);
    }
    const history = capped.report(base + 20 * BUCKET_MS + 1_000).activity.buckets;
    expect(history).toHaveLength(12);
    expect(history.every(({ start }) => Date.parse(start) % BUCKET_MS === 0)).toBe(true);
    expect(history.every(({ tokens }) => tokens === 0)).toBe(true);
  });
});
