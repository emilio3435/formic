import { beforeAll, describe, expect, test } from "bun:test";
import { PROVIDERS, type Provider, type SourceHealth } from "../src/shared/types";
import { HubState } from "../src/server/state";
import { buildSnapshot } from "../src/server/snapshot";
import type { ArchiveStore, CollectedAgent, CollectionResult, CommandRunner } from "../src/server/types";

/* Issue #14. The live board published
     healthy=9, degraded=0, absent=1, total=9
   while byProvider listed every collector, including Muse, as healthy: true.

   Census subtracted absent from total. The table treated "no errors" as green,
   even when the collector reported itself unrun. Healthy-empty (home exists,
   zero sessions) is not that state. */

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
const runner: CommandRunner = {
  run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
};

const EMPTY: CollectionResult<CollectedAgent[]> = { value: [], errors: [] };
const ABSENT: CollectionResult<CollectedAgent[]> = { value: [], errors: [], absent: true };
const FAILING: CollectionResult<CollectedAgent[]> = {
  value: [],
  errors: ["claude /Users/me/.claude/projects: EACCES: permission denied"],
};

function stateWith(
  scripts: ReadonlyArray<Partial<Record<Provider, CollectionResult<CollectedAgent[]>>>>,
) {
  let call = 0;
  const collectors = {
    sessions: async () => {
      const script = scripts[Math.min(call++, scripts.length - 1)] ?? {};
      return Object.fromEntries(PROVIDERS.map((provider) => [
        provider,
        script[provider] ?? EMPTY,
      ]));
    },
    cmux: async () => ({ value: [], errors: [] }),
    notifications: async () => ({ value: [], errors: [] }),
    enrichIdentity: async (surfaces: unknown) => ({ value: surfaces, errors: [] }),
  } as never;
  return new HubState(runner, archiveStore, [], { collectors });
}

function classify(health: SourceHealth | undefined): "healthy" | "degraded" | "absent" {
  if (health?.absent === true) return "absent";
  if (health?.healthy === true) return "healthy";
  return "degraded";
}

function assertReconciled(
  sourceHealth: {
    healthy: number;
    degraded: number;
    absent: number;
    total: number;
    byProvider?: Record<Provider, SourceHealth>;
  },
  expected: { healthy: number; degraded: number; absent: number },
) {
  const byProvider = sourceHealth.byProvider;
  expect(byProvider, "byProvider must stay on the wire — do not drop providers to hide a mismatch")
    .toBeDefined();
  const keys = Object.keys(byProvider ?? {});
  expect(keys.sort()).toEqual([...PROVIDERS].sort());
  expect(sourceHealth.total).toBe(PROVIDERS.length);
  expect(sourceHealth.total).toBe(keys.length);
  expect(sourceHealth.healthy + sourceHealth.degraded + sourceHealth.absent)
    .toBe(sourceHealth.total);
  expect(sourceHealth).toMatchObject(expected);

  const buckets = { healthy: 0, degraded: 0, absent: 0 };
  for (const provider of PROVIDERS) {
    const health = byProvider![provider];
    const bucket = classify(health);
    buckets[bucket] += 1;
    if (bucket === "healthy") {
      expect(health.healthy, `${provider} counted healthy while healthy !== true`).toBe(true);
      expect(health.absent, `${provider} is healthy and also marked absent`).not.toBe(true);
    } else if (bucket === "absent") {
      expect(health.healthy, `${provider} is absent and also listed healthy`).toBe(false);
      expect(health.absent).toBe(true);
    } else {
      expect(health.healthy, `${provider} is degraded and also listed healthy`).toBe(false);
      expect(health.absent, `${provider} is degraded and also marked absent`).not.toBe(true);
    }
  }
  expect(buckets).toEqual(expected);
}

describe("sourceHealth census matches byProvider", () => {
  test("a snapshot fixture of every collector healthy-empty publishes N/N, nobody absent", async () => {
    /* The issue's done-when: N healthy providers → healthy=N, absent=0, total=N.
       Current main has eleven collectors, not the ten the migrated issue named. */
    const state = stateWith([{}]);
    await state.refresh();

    assertReconciled(state.get().totals.sourceHealth!, {
      healthy: PROVIDERS.length,
      degraded: 0,
      absent: 0,
    });
    for (const provider of PROVIDERS) {
      expect(state.get().totals.sourceHealth?.byProvider?.[provider].healthy)
        .toBe(true);
    }
  });

  test("a truly missing Muse is absent and not healthy, and stays on the table", async () => {
    const state = stateWith([{ muse: ABSENT }]);
    await state.refresh();

    assertReconciled(state.get().totals.sourceHealth!, {
      healthy: PROVIDERS.length - 1,
      degraded: 0,
      absent: 1,
    });
    expect(state.get().totals.sourceHealth?.byProvider?.muse).toMatchObject({
      healthy: false,
      absent: true,
      lastHealthyAt: null,
    });
    expect(Object.keys(state.get().totals.sourceHealth?.byProvider ?? {}))
      .toContain("muse");
    expect(Object.keys(state.get().totals.sourceHealth?.byProvider ?? {}))
      .toContain("antigravity");
  });

  test("buildSnapshot scalars keep the same census without dropping anyone from the known set", () => {
    const snapshot = buildSnapshot({
      agents: [],
      surfaces: [],
      archiveStore,
      sourceAbsent: { muse: true },
    });
    const health = snapshot.totals.sourceHealth!;
    expect(health).toEqual({
      healthy: PROVIDERS.length - 1,
      degraded: 0,
      absent: 1,
      total: PROVIDERS.length,
    });
    expect(health.healthy + health.degraded + health.absent).toBe(health.total);
  });

  test("a collector that is both absent and erroring is degraded, not absent", async () => {
    const state = stateWith([{
      muse: { value: [], errors: ["muse state: SQLITE_CORRUPT"], absent: true },
    }]);
    await state.refresh();

    assertReconciled(state.get().totals.sourceHealth!, {
      healthy: PROVIDERS.length - 1,
      degraded: 1,
      absent: 0,
    });
    expect(state.get().totals.sourceHealth?.byProvider?.muse).toMatchObject({
      healthy: false,
    });
    expect(state.get().totals.sourceHealth?.byProvider?.muse.absent).not.toBe(true);
  });
});

describe("healthy-empty is not absent; absence has history", () => {
  test("a present collector with zero sessions stays healthy", async () => {
    const state = stateWith([{ claude: EMPTY }]);
    await state.refresh();

    expect(state.get().totals.sourceHealth?.byProvider?.claude).toMatchObject({
      healthy: true,
    });
    expect(state.get().totals.sourceHealth?.byProvider?.claude.absent).not.toBe(true);
    expect(state.get().totals.sourceHealth?.absent).toBe(0);
    expect(state.get().totals.sourceHealth?.healthy).toBe(PROVIDERS.length);
  });

  test("an unrun collector that later appears becomes healthy and records the moment", async () => {
    const state = stateWith([{ muse: ABSENT }, { muse: EMPTY }]);
    await state.refresh();
    expect(state.get().totals.sourceHealth?.byProvider?.muse).toMatchObject({
      healthy: false,
      absent: true,
      lastHealthyAt: null,
    });

    await state.refresh();
    const after = state.get().totals.sourceHealth?.byProvider?.muse;
    expect(after?.healthy).toBe(true);
    expect(after?.absent).not.toBe(true);
    expect(after?.lastHealthyAt).toBeTruthy();
    expect(state.get().totals.sourceHealth?.absent).toBe(0);
  });

  test("a collector that was healthy and then goes missing keeps lastHealthyAt and is not green", async () => {
    const state = stateWith([{}, { muse: ABSENT }]);
    await state.refresh();
    const healthyAt = state.get().totals.sourceHealth?.byProvider?.muse.lastHealthyAt;
    expect(healthyAt).toBeTruthy();

    await state.refresh();
    expect(state.get().totals.sourceHealth?.byProvider?.muse).toEqual({
      healthy: false,
      absent: true,
      lastHealthyAt: healthyAt,
    });
    expect(state.get().totals.sourceHealth?.degraded).toBe(0);
    expect(state.get().totals.sourceHealth?.absent).toBe(1);
  });

  test("one collector failing does not reclassify a neighbour that is merely absent", async () => {
    const state = stateWith([{ claude: FAILING, muse: ABSENT }]);
    await state.refresh();

    assertReconciled(state.get().totals.sourceHealth!, {
      healthy: PROVIDERS.length - 2,
      degraded: 1,
      absent: 1,
    });
    expect(state.get().totals.sourceHealth?.byProvider?.claude).toMatchObject({
      healthy: false,
    });
    expect(state.get().totals.sourceHealth?.byProvider?.claude.absent).not.toBe(true);
    expect(state.get().totals.sourceHealth?.byProvider?.muse).toMatchObject({
      healthy: false,
      absent: true,
    });
  });
});

describe("the client does not treat absence as a fault", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let M: any;

  beforeAll(async () => {
    // @ts-expect-error The dependency-free browser client has no declaration file.
    await import("../src/web/app.js");
    M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
  });

  const at = "2026-08-16T16:39:00.000Z";
  const ok = { healthy: true, lastHealthyAt: at };
  const missing = { healthy: false, absent: true, lastHealthyAt: null };
  const broke = { healthy: false, lastHealthyAt: at };

  const byProvider = (overrides: Partial<Record<Provider, SourceHealth>> = {}) =>
    Object.fromEntries(PROVIDERS.map((provider) => [
      provider,
      overrides[provider] ?? ok,
    ])) as Record<Provider, SourceHealth>;

  test("healthy + absent = total stays Operational", () => {
    const sourceHealth = {
      healthy: PROVIDERS.length - 1,
      degraded: 0,
      absent: 1,
      total: PROVIDERS.length,
      byProvider: byProvider({ muse: missing }),
    };
    const snap = {
      generatedAt: at,
      controlHealth: { cmuxReachable: true, lastCheckedAt: at, errors: [], staleSources: [] },
      totals: { tracked: 0, sourceHealth },
    };
    expect(M.systemStatus(snap, "live").label).toBe("Operational");
    expect(M.emptyBoardVerdict(snap).degraded).toBe(false);
    expect(M.emptyBoardVerdict(snap).sources)
      .toBe(`${PROVIDERS.length - 1} of ${PROVIDERS.length - 1} collectors healthy · 1 not installed`);
    expect(M.degradedSinceText(snap)).toBe("");
  });

  test("an absent provider is not named as a degraded source", () => {
    const snap = {
      generatedAt: at,
      controlHealth: { cmuxReachable: true, lastCheckedAt: at, errors: [], staleSources: ["claude"] },
      issues: [],
      programs: [],
      totals: {
        tracked: 0,
        sourceHealth: {
          healthy: PROVIDERS.length - 2,
          degraded: 1,
          absent: 1,
          total: PROVIDERS.length,
          byProvider: byProvider({ claude: broke, muse: missing }),
        },
      },
    };
    const card = M.summaryWidgetData("health", snap, "live");
    expect(M.systemStatus(snap, "live").label).toBe("Degraded");
    expect(card.sublabel).toMatch(/Claude/i);
    expect(card.sublabel).not.toMatch(/Muse/i);
    expect(M.degradedSinceText(snap)).toBeTruthy();
  });
});
