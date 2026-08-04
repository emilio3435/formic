import { beforeAll, describe, expect, test } from "bun:test";
import { resolveUsageCost, type PricingConfig } from "../src/server/burnbar";
import { PROVIDERS } from "../src/shared/types";
import { buildSnapshot } from "../src/server/snapshot";
import type { ArchiveStore, CollectedAgent } from "../src/server/types";

/* One bug class: a failure that reaches the operator as a plausible number
   instead of as an error. BurnBar rendering a failed query as "$0.00 spent" is
   the archetype — the board looked calm and correct, and was neither.
   Every test here fixes the boundary between "we measured nothing" and "we
   could not measure", on both sides, so neither can drift into the other. A
   test that only pinned the failure case would still pass if the success case
   collapsed to the same value, so each pair asserts both. */

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
const NOW = new Date("2026-07-21T23:00:30.000Z");

/* Exactly what loadPricingConfig() falls back to when config/models.json is
   missing, unreadable, or malformed. Its silent catch is the reason this
   matters: nothing downstream is told the prices are gone. */
const FAILED_PRICING_LOAD: PricingConfig = {
  pricingVersion: "unavailable",
  modelPricingUsdPerMillionTokens: {},
};

const SIX_MILLION_TOKENS = {
  inputTokens: 5_000_000,
  outputTokens: 1_000_000,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  measuredCostUsd: null,
};

describe("a failed cost lookup never renders as zero spend", () => {
  test("a lost pricing config yields unknown cost, not $0.00, for real token burn", () => {
    const result = resolveUsageCost({ model: "claude-opus-4-8", ...SIX_MILLION_TOKENS }, FAILED_PRICING_LOAD);

    // The archetype. Six million tokens were genuinely spent; the only thing
    // missing is the price sheet. Reporting 0 would tell the operator the
    // fleet was free, and 0 is the number a `?? 0` would produce here.
    expect(result.costUsd).toBeNull();
    expect(result.costUsd).not.toBe(0);
    expect(result.costProvenance).toBe("unknown");
  });

  test("a model absent from a healthy config is also unknown, not free", () => {
    const result = resolveUsageCost({ model: "totally-made-up-model", ...SIX_MILLION_TOKENS });

    expect(result.costUsd).toBeNull();
    expect(result.costProvenance).toBe("unknown");
  });

  test("a measured cost still survives a lost pricing config", () => {
    // Pricing is only needed to derive a cost. A cost the source already
    // measured must not be discarded just because the price sheet is gone.
    const result = resolveUsageCost(
      { model: "claude-opus-4-8", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, measuredCostUsd: 12.5 },
      FAILED_PRICING_LOAD,
    );

    expect(result.costUsd).toBe(12.5);
    expect(result.costProvenance).toBe("measured");
  });

  test("a priced model still produces a real derived number", () => {
    // Without this the three assertions above would all pass on a function
    // that had simply stopped costing anything at all.
    const result = resolveUsageCost({ model: "claude-opus-4-8", ...SIX_MILLION_TOKENS });

    expect(result.costProvenance).toBe("derived_estimate");
    expect(result.costUsd).toBeGreaterThan(0);
  });

  test("genuinely zero token usage on a priced model is a real zero", () => {
    // The other side of the boundary: 0 must remain reachable and must not be
    // conflated with "unknown", or the distinction above is meaningless.
    const result = resolveUsageCost({
      model: "claude-opus-4-8",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      measuredCostUsd: null,
    });

    expect(result.costUsd).toBe(0);
    expect(result.costProvenance).toBe("derived_estimate");
  });
});

describe("a total collection failure never renders as a calm empty fleet", () => {
  const allSourcesDown = () =>
    buildSnapshot({
      agents: [],
      surfaces: [],
      archiveStore,
      sourceErrors: {
        codex: ["EACCES scanning ~/.codex"],
        claude: ["EACCES scanning ~/.claude"],
        cursor: ["cursor state db is locked"],
        /* "four dead sources" counted three providers and the control plane.
           omp is the fourth collector and was missing from the fixture, so the
           scenario this file is named for was never actually all-sources-down. */
        omp: ["EACCES scanning ~/.omp"],
        factory: ["EACCES scanning ~/.factory"],
      },
      cmuxErrors: ["cmux socket refused the connection"],
      cmuxReachable: false,
      now: NOW,
    });

  test("zero tracked agents from every dead source is reported as fully degraded", () => {
    const snapshot = allSourcesDown();

    /* tracked:0 here is not a fleet reading, it is the absence of one. The
       counts alone are indistinguishable from a genuinely idle machine, so the
       health summary is the only thing standing between the operator and
       "nothing is running" — it has to be unambiguous. */
    expect(snapshot.totals.tracked).toBe(0);
    /* Counted from PROVIDERS rather than written as 4. The literal was already
       wrong once — it counted three collectors and the control plane, so the
       scenario this file is named for was not actually all-sources-down — and a
       hardcoded total silently stops covering the newest collector every time
       one is added. */
    expect(snapshot.totals.sourceHealth)
      .toEqual({ healthy: 0, degraded: PROVIDERS.length, absent: 0, total: PROVIDERS.length });
    expect(snapshot.controlHealth?.cmuxReachable).toBe(false);
    expect([...(snapshot.controlHealth?.staleSources ?? [])].sort()).toEqual([...PROVIDERS].sort());
  });

  test("every dead source raises its own issue, so the cause is never anonymous", () => {
    const ids = (allSourcesDown().issues ?? []).map(({ id }) => id);

    expect(ids).toContain("system:codex-collector");
    expect(ids).toContain("system:claude-collector");
    expect(ids).toContain("system:cursor-collector");
    expect(ids).toContain("system:cmux-control");
  });

  test("a lost control plane is an error, not an advisory", () => {
    const control = allSourcesDown().issues?.find(({ id }) => id === "system:cmux-control");

    // Severity drives the frontend's blocking-vs-advisory split: Focus and Send
    // cannot route at all here, and waiting does not help.
    expect(control?.severity).toBe("error");
    expect(control?.technicalDetails).toContain("cmux socket refused the connection");
  });

  test("an idle machine with healthy sources is not mistaken for a failure", () => {
    // The contrast case. Same zero counts, no errors — this must stay quiet, or
    // the tests above would pass on a build that simply always cried degraded.
    const quiet = buildSnapshot({ agents: [], surfaces: [], archiveStore, now: NOW });

    expect(quiet.totals.tracked).toBe(0);
    expect(quiet.totals.sourceHealth)
      .toEqual({ healthy: PROVIDERS.length, degraded: 0, absent: 0, total: PROVIDERS.length });
    expect(quiet.issues ?? []).toEqual([]);
  });
});

describe("a partly-failed collection never silently shrinks the fleet", () => {
  function collected(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
    return {
      id: "codex:one",
      provider: "codex",
      sourceSessionId: "one",
      displayName: "One",
      cwd: "/Users/emilionunezgarcia/Developer/unique-project",
      status: "running",
      statusReason: "Fixture activity is recent.",
      startedAt: "2026-07-21T20:00:00.000Z",
      updatedAt: "2026-07-21T23:00:00.000Z",
      tokens: { total: 42, provenance: "observed" },
      artifacts: [],
      gates: [],
      ...overrides,
    };
  }

  test("agents that did survive are still counted, and the failure is still flagged", () => {
    /* The dangerous middle case: Claude's scan died, Codex's did not. The board
       shows one agent. That number is true for Codex and unknowable for Claude,
       and only the degraded source count carries the second half. */
    const snapshot = buildSnapshot({
      agents: [collected()],
      surfaces: [],
      archiveStore,
      sourceErrors: { claude: ["EACCES scanning ~/.claude"] },
      now: NOW,
    });

    expect(snapshot.totals.tracked).toBe(1);
    /* One degraded, the rest healthy — expressed against PROVIDERS so the
       "all but one" claim stays true as collectors are added. */
    expect(snapshot.totals.sourceHealth)
      .toEqual({ healthy: PROVIDERS.length - 1, degraded: 1, absent: 0, total: PROVIDERS.length });
    const claude = snapshot.issues?.find(({ id }) => id === "system:claude-collector");
    expect(claude?.severity).toBe("warning");
    expect(claude?.technicalDetails).toContain("EACCES scanning ~/.claude");
  });
});

describe("the dashboard's burn widget separates no spend from no reading", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let M: any;

  beforeAll(async () => {
    // @ts-expect-error The dependency-free browser client has no declaration file.
    await import("../src/web/app.js");
    M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
  });

  const snapshotWith = (burn: unknown) => ({
    schemaVersion: 1,
    generatedAt: "2026-07-22T03:00:00.000Z",
    programs: [],
    totals: { working: 0, idle: 0, tracked: 0, sourceHealth: { healthy: 4, degraded: 0, absent: 0, total: 4 } },
    controlHealth: { cmuxReachable: true, errors: [], staleSources: [] },
    issues: [],
    pulse: { burn },
  });

  test("a failed burn query reads as No data and cost unavailable", () => {
    const widget = M.summaryWidgetData("burn", snapshotWith({
      tokensPerMin: null,
      costLastHourUsd: null,
      coverage: { reporting: 0, eligible: 3 },
    }));

    expect(widget.value).toBe("No data");
    expect(widget.sublabel).toContain("cost unavailable");
    expect(widget.sublabel).not.toContain("$");
    expect(widget.tone).toBe("missing");
  });

  test("a genuine zero-spend hour reads as an actual zero", () => {
    const widget = M.summaryWidgetData("burn", snapshotWith({
      tokensPerMin: 0,
      costLastHourUsd: 0,
      coverage: { reporting: 3, eligible: 3 },
    }));

    // Same shape, opposite meaning. If these two ever render alike, the
    // archetype bug is back.
    expect(widget.value).toBe("0");
    expect(widget.unit).toBe("/min");
    expect(widget.sublabel).toContain("$0.00 last hour");
    expect(widget.tone).toBe("ok");
  });

  test("an absent burn report is No data rather than a fabricated zero", () => {
    const widget = M.summaryWidgetData("burn", snapshotWith(undefined));

    expect(widget.value).toBe("No data");
    expect(widget.tone).toBe("missing");
  });

  test("totalsOf trusts a server-reported zero instead of recounting the board", () => {
    /* totalsOf falls back to walking `programs` when the server omits a total.
       That fallback must key on absence, not falsiness: with `||` a truthful
       "0 working" would be overridden by a client-side recount and the operator
       would read 1. This is the whole difference between `??` and `||` here. */
    const snapshot = {
      schemaVersion: 1,
      generatedAt: "2026-07-22T03:00:00.000Z",
      totals: { working: 0, idle: 0, tracked: 0 },
      programs: [{
        id: "p1",
        name: "P",
        agents: [{
          id: "codex:a",
          provider: "codex",
          sourceSessionId: "a",
          displayName: "A",
          programId: "p1",
          status: "running",
          activity: "working",
          outcome: "healthy",
          updatedAt: "2026-07-22T03:00:00.000Z",
          tokens: { provenance: "observed", total: 1200 },
          artifacts: [],
          gates: [],
        }],
      }],
    };

    expect(M.totalsOf(snapshot).working).toBe(0);
    expect(M.totalsOf(snapshot).tracked).toBe(0);
  });
});
