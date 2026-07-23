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
    estimatedCostUsd: 1.25,
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
  test("counts working-to-idle/ended transitions, ages them out, and ignores disappearance", () => {
    const tracker = new PulseTracker(undefined, base);
    tracker.observe(snapshot([agent({ updatedAt: iso(base + 1_000) })]), base + 1_000);
    tracker.observe(
      snapshot([agent({ activity: "idle", status: "waiting", updatedAt: iso(base + 2_000) })]),
      base + 2_000,
    );
    expect(tracker.report(base + 2_000).momentum.completionsLastHour).toBe(1);

    tracker.observe(snapshot([]), base + 3_000);
    expect(tracker.report(base + 3_000).momentum.completionsLastHour).toBe(1);

    const disappeared = new PulseTracker(undefined, base);
    disappeared.observe(snapshot([agent({ updatedAt: iso(base + 1_000) })]), base + 1_000);
    disappeared.observe(snapshot([]), base + 2_000);
    expect(disappeared.report(base + 2_000).momentum.completionsLastHour).toBe(0);

    tracker.observe(snapshot([agent({ activity: "idle", status: "waiting", updatedAt: iso(base + HOUR_MS + 1_000) })]), base + HOUR_MS + 1_000);
    expect(tracker.report(base + HOUR_MS + 3_000).momentum.completionsLastHour).toBe(0);
  });

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
      usageSummary({ available: true, estimatedCostUsd: 99, costKnown: false, to: iso(base + 2 * 60_000), byProvider: [{ provider: "Cursor", tokens: 50, costUsd: null, invocations: 2 }] }),
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
