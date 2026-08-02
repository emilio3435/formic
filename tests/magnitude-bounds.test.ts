import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSnapshot } from "../src/server/snapshot";
import type { HubPulse, HubSnapshot } from "../src/shared/types";
import type { ArchiveStore, CollectedAgent } from "../src/server/types";

/* Bounds for the numbers docs/MAGNITUDE-AUDIT-GPT.md ranked as wrong, in the
   form d8162d9 used for tokens: a relation between values the payload already
   carries, never a constant.

   The audit's own conclusion sets the limit of what this file can do —

     "Every offender in the top four is arithmetically correct. Not one is a
      calculation bug. Each is a true number whose label names a different
      quantity."

   An arithmetic bound cannot catch a correct number under a wrong label. So
   this file bounds the findings where a real relation exists and is violated,
   and the block at the bottom names the ones where no honest bound does. A
   fabricated bound is the same species of lie as a fabricated total: it would
   pass on today's data, fail on a legitimate outlier, and teach everyone to
   ignore it. */

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
const NOW = new Date("2026-08-02T10:00:00.000Z");

function collected(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: `codex:${overrides.sourceSessionId ?? "a"}`,
    provider: "codex",
    sourceSessionId: "a",
    displayName: "Worker",
    cwd: "/Users/me/project",
    status: "running",
    statusReason: "Source activity within 3 minutes.",
    startedAt: "2026-08-02T09:00:00.000Z",
    updatedAt: "2026-08-02T09:59:00.000Z",
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    ...overrides,
  };
}

const snapshotOf = (agents: CollectedAgent[]) =>
  buildSnapshot({ agents, surfaces: [], archiveStore, now: NOW } as never);

/* The project's OWN price table, read at test time. The audit noted its
   $0.50/M floor came from general pricing knowledge rather than this repo, and
   flagged that as a caveat; reading the table removes it and keeps the bound
   from rotting when a rate changes. */
function configuredRatesPerMillion(): number[] {
  const config = JSON.parse(readFileSync(join(import.meta.dir, "..", "config", "models.json"), "utf8"));
  return Object.values(config.modelPricingUsdPerMillionTokens as Record<string, Record<string, unknown>>)
    .flatMap((price) => Object.values(price))
    .filter((value): value is number => typeof value === "number" && value > 0);
}

const CHEAPEST_PER_MILLION = Math.min(...configuredRatesPerMillion());

/* ---------------------------------------------------------------- finding 3 */

/** A rate and a cost shown together must be reconcilable: the dollars implied
    by the tokens cannot fall below what the cheapest configured rate charges
    for them. Returns the implied $/M, or null when the pair cannot be judged. */
function impliedDollarsPerMillion(burn: HubPulse["burn"]): number | null {
  if (burn.tokensPerMin == null || burn.costLastHourUsd == null) return null;
  if (burn.costProvenance !== "burnbar") return null;
  // A stated subtotal is legitimately low; only a claimed total is comparable.
  if (burn.costNote) return null;
  const millionsPerHour = (burn.tokensPerMin * 60) / 1_000_000;
  if (!(millionsPerHour > 0)) return null;
  return burn.costLastHourUsd / millionsPerHour;
}

describe("BURN: a rate and a cost on one widget must be able to both be true", () => {
  const burn = (overrides: Partial<HubPulse["burn"]>): HubPulse["burn"] => ({
    tokensPerMin: 50_000,
    windowMs: 600_000,
    coverage: { reporting: 10, eligible: 10, unknown: 0 },
    costLastHourUsd: 20,
    costProvenance: "burnbar",
    ...overrides,
  });

  test("an honest pair implies a price inside the configured table", () => {
    /* 50k/min is 3M/hour; at $20 that is $6.67/M, which sits between the
       cheapest and dearest configured rates. The control for the rest. */
    const implied = impliedDollarsPerMillion(burn({}));

    expect(implied).not.toBeNull();
    expect(implied!).toBeGreaterThanOrEqual(CHEAPEST_PER_MILLION);
  });

  test("the audited pair is caught: $4.41 cannot buy 305M tokens", () => {
    /* The measured contradiction. 5,089,747/min is 305.4M/hour; $4.41 against
       that is $0.0144/M, roughly 35x below the cheapest rate this project
       configures. Both numbers are individually correct — they describe
       different populations over different windows — and that is exactly why
       neither is wrong on its own and the pair is. */
    const implied = impliedDollarsPerMillion(burn({ tokensPerMin: 5_089_747, costLastHourUsd: 4.41 }));

    expect(implied).not.toBeNull();
    expect(implied!).toBeLessThan(CHEAPEST_PER_MILLION);
  });

  test("the second, independent read is caught too", () => {
    // Reproduced at 138.6x apart on a later read: pulse 6,988,595/min against
    // BurnBar's 3,025,675/hour. The ratio moved; the defect did not.
    const implied = impliedDollarsPerMillion(burn({ tokensPerMin: 6_988_595, costLastHourUsd: 2.79 }));

    expect(implied!).toBeLessThan(CHEAPEST_PER_MILLION);
  });

  test("a stated subtotal is not judged as if it were a total", () => {
    /* The cost note concedes unpriced Cursor sessions. A subtotal is
       legitimately below what the tokens imply, so comparing it would fail on
       honest data — the fabricated-bound failure mode. It is excluded rather
       than fudged. */
    expect(impliedDollarsPerMillion(burn({
      tokensPerMin: 5_089_747, costLastHourUsd: 4.41, costNote: "2 Cursor sessions unpriced",
    }))).toBeNull();
  });

  test("an unavailable cost is not reconciled against anything", () => {
    expect(impliedDollarsPerMillion(burn({ costLastHourUsd: null, costProvenance: "unavailable" }))).toBeNull();
    expect(impliedDollarsPerMillion(burn({ tokensPerMin: null }))).toBeNull();
  });

  test("the floor comes from this repo's table, not from memory", () => {
    /* Non-rotting by construction: raise or lower a configured rate and the
       bound moves with it. The audit's own caveat was that its floor came from
       general knowledge; this removes that. */
    expect(configuredRatesPerMillion().length).toBeGreaterThan(0);
    expect(CHEAPEST_PER_MILLION).toBe(Math.min(...configuredRatesPerMillion()));
  });
});

/* ---------------------------------------------------------------- finding 5 */

describe("activity window: the buckets must cover the window the label claims", () => {
  const activity = (overrides: Partial<HubPulse["activity"]>): HubPulse["activity"] => ({
    bucketMinutes: 5,
    windowMinutes: 60,
    observedSince: new Date(NOW.getTime() - 60 * 60_000).toISOString(),
    buckets: Array.from({ length: 12 }, (_, index) => ({
      start: new Date(NOW.getTime() - (12 - index) * 5 * 60_000).toISOString(),
      activeSessions: 1,
      completions: 0,
      tokens: null,
    })),
    ...overrides,
  });

  /** Minutes of evidence actually held, against minutes the label claims. */
  const observedMinutes = (a: HubPulse["activity"]) => a.buckets.length * a.bucketMinutes;

  test("a full hour of buckets covers an hour-labelled window", () => {
    const full = activity({});

    expect(observedMinutes(full)).toBe(full.windowMinutes);
  });

  test("a partly-filled window is detectable rather than silently claimed", () => {
    /* Measured: 12.7 minutes of buckets under a label reading "the last hour",
       a 4.7x overstatement. The payload carries everything needed to say
       "12 minutes observed" instead — bucket count, bucket size and
       observedSince — so the shortfall is computable and must not be rounded
       up into the claim. */
    const partial = activity({ buckets: activity({}).buckets.slice(0, 3) });

    expect(observedMinutes(partial)).toBe(15);
    expect(observedMinutes(partial)).toBeLessThan(partial.windowMinutes);
  });

  test("the buckets never claim more than the window holds", () => {
    /* The other direction, and the one that would be an arithmetic fault
       rather than a labelling one: more evidence than the window can contain
       means buckets are being double counted or never evicted. */
    for (const a of [activity({}), activity({ buckets: activity({}).buckets.slice(0, 3) })]) {
      expect(observedMinutes(a)).toBeLessThanOrEqual(a.windowMinutes);
    }
  });

  test("observedSince agrees with the evidence actually held", () => {
    // The span since observation began cannot be shorter than the buckets
    // covering it, or the buckets predate the observation.
    const partial = activity({
      buckets: activity({}).buckets.slice(0, 3),
      observedSince: new Date(NOW.getTime() - 15 * 60_000).toISOString(),
    });
    const spanMinutes = (NOW.getTime() - Date.parse(partial.observedSince)) / 60_000;

    expect(observedMinutes(partial)).toBeLessThanOrEqual(Math.ceil(spanMinutes));
  });
});

/* ---------------------------------------------------------------- finding 6 */

describe("rollups partition the population they count", () => {
  /* Deliberately populated so every sub-count is non-zero. An all-zero fixture
     satisfies "no part exceeds the total" without exercising a single
     comparison — the assertion would pass on a rollup that had stopped
     counting entirely. */
  const mixedFleet = () => snapshotOf([
    collected({ sourceSessionId: "w1", status: "running" }),
    collected({ sourceSessionId: "w2", status: "waiting", gates: ["awaiting review"] }),
    collected({ sourceSessionId: "w3", status: "running", gates: ["tests failed"] }),
    collected({ sourceSessionId: "e1", status: "archived" }),
    collected({ sourceSessionId: "e2", status: "archived" }),
  ]);

  test("a program's total is exactly its live plus its ended", () => {
    /* "220 agents" was 38 live plus 182 ended. The count is arithmetically
       right and the label is what misleads, so this cannot catch the labelling
       — but it does catch the arithmetic failure that would look identical to
       an operator: a total that exceeds its own parts because something was
       counted twice. */
    const rollup = mixedFleet().programs[0]?.rollup;

    expect(rollup).toBeDefined();
    expect(rollup!.total).toBe(rollup!.live + rollup!.ended);
  });

  test("live is exactly working plus idle", () => {
    const rollup = mixedFleet().programs[0]?.rollup;

    expect(rollup!.live).toBe(rollup!.working + rollup!.idle);
  });

  test("the fleet totals partition the same way", () => {
    const totals = mixedFleet().totals;
    /* Read through explicitly rather than with `?? 0`: a missing count would
       otherwise be silently treated as zero and the partition would appear to
       hold on a snapshot that had stopped reporting. */
    const { working, idle, ended, tracked, live } = totals;

    expect(working).toBeDefined();
    expect(idle).toBeDefined();
    expect(ended).toBeDefined();
    expect(tracked).toBe(working! + idle! + ended!);
    expect(live).toBeLessThanOrEqual(tracked);
  });

  test("no sub-count exceeds the total it belongs to", () => {
    /* The general form. Any of these rising above `total` is double counting,
       which is how a program of 38 live agents can read as a program of 220. */
    const rollup = mixedFleet().programs[0]!.rollup!;

    for (const part of ["live", "working", "idle", "ended", "needsYou", "blocked", "failed", "linked"] as const) {
      expect(rollup[part]).toBeLessThanOrEqual(rollup.total);
      expect(rollup[part]).toBeGreaterThanOrEqual(0);
    }
    // The comparison has to be exercised, not just satisfied: at least one
    // outcome bucket must actually be carrying agents in this fixture.
    expect(rollup.blocked + rollup.failed).toBeGreaterThan(0);
  });
});

/* ---------------------------------------------------------------- finding 1 */

describe("momentum: the window a count claims must be the window it observed", () => {
  /* An earlier draft of this block asserted `300_000 >= 3_600_000` against
     local constants and could not fail — arithmetic on numbers the test itself
     wrote down, which is the hollow shape this whole effort exists to remove.
     It now drives the client's own derivation instead. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let M: any;

  const momentum = (observedWindowMs: number) => ({
    working: 3, completionsLastHour: 17, observedWindowMs,
    stalled: 0, stalledAgentIds: [], stallThresholdMs: 900_000,
  });

  const line = async (observedWindowMs: number): Promise<string> => {
    if (!M) {
      // @ts-expect-error The dependency-free browser client has no declaration file.
      await import("../src/web/app.js");
      M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
    }
    return String(M.completionWindowText(momentum(observedWindowMs)));
  };

  test("a five-minute observation is not reported as an hour", async () => {
    /* The compounding half of finding 1: completionsLastHour was computed over
       an observedWindowMs of 300,000 — five minutes — under a label reading
       "this hour", a 12x window overstatement on top of the counter's own
       problem. observedWindowMs is on the wire, so the shortfall is computable
       and must be stated rather than rounded up into the claim. */
    const text = await line(300_000);

    expect(text).not.toContain("this hour");
    expect(text).toContain("observed");
  });

  test("a full hour of observation may say so", async () => {
    // The control. Without it the assertion above would pass on a build that
    // never says "this hour" at all, which would understate every real hour.
    const text = await line(3_600_000);

    expect(text).toContain("this hour");
  });

  test("the boundary is asserted from both sides", async () => {
    // One millisecond short of an hour is not an hour.
    expect(await line(3_599_999)).not.toContain("this hour");
    expect(await line(3_600_001)).toContain("this hour");
  });

  test("a count with no window yet says so instead of implying one", async () => {
    /* A restarted tracker knows a COUNT before it has a window to rate it over.
       Printing it under any window label would state something the data does
       not support. */
    const text = await line(0);

    expect(text).not.toContain("this hour");
    expect(text).not.toContain("observed");
  });
});

/* ===========================================================================
   NOT BOUNDED, AND WHY

   Two audit findings have no honest bound, and inventing one would be the same
   species of lie as the totals this work exists to catch — a threshold that
   passes on today's data, fails on a legitimate outlier, and trains everyone to
   ignore the alarm.

   FINDING 2 — `Elapsed`, measured at 87.1 days, overstating by ~204x.
   The number is `updatedAt - startedAt` and it is arithmetically correct; the
   audit verified the startedAt dates are real. The defect is that "Elapsed"
   names working time while measuring a span with all dormancy inside it.
   Nothing in the snapshot separates the two: dormancy is not recorded, so no
   relation between the fields present can distinguish 87 days of work from 87
   days of a session lying open. A ceiling like "a session cannot exceed 36
   hours" is a guess about human working patterns, not physics — a genuinely
   long-running agent would trip it. Fixing this needs either an active-time
   field on the wire or a label that says span. It is not a test's job to
   invent either.

   FINDING 1 (core) — `N done this hour`, whose true value may be 0.
   The counter counts transitions into a quiet state and never verifies that
   anything succeeded. Success is not recorded anywhere in the snapshot, so no
   assertion over the payload can tell a completion from a crash, an interrupt,
   or a silence. The window half IS bounded above; the success half cannot be
   until something on the wire distinguishes finishing from stopping.

   FINDING 4 — tokens — is bounded in tests/token-plausibility.test.ts.
   =========================================================================== */
