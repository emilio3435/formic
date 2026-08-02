import { describe, expect, test } from "bun:test";
import { PulseTracker } from "../src/server/pulse";
import type { AgentSnapshot, HubSnapshot } from "../src/shared/types";

/* The window the tracker reports having observed.

   `magnitude-bounds.test.ts` pins the CLIENT half of audit finding 1: a
   five-minute observation must not be rendered as "this hour". That test hands
   completionWindowText a momentum object and checks the wording, so it is only
   as honest as the number it is given — hard-coding `observedWindowMs` to an
   hour in the tracker survives it completely, and the client would then render
   "this hour" correctly from a fabricated input.

   This is the other half: the reported window must reflect observation that
   actually happened. It is a relation between two values the tracker already
   holds — now, and when it started watching — so it needs no constant.

   Measured on the live board: observedWindowMs was 300,000 under a label
   reading "this hour", a 12x overstatement. */

const BUCKET_MS = 5 * 60_000;
const HOUR_MS = 60 * 60_000;
const START = Math.floor(Date.parse("2026-08-02T10:00:00.000Z") / BUCKET_MS) * BUCKET_MS;

const iso = (ms: number) => new Date(ms).toISOString();

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
    updatedAt: iso(START),
    tokens: { sessionTotal: 0, provenance: "observed" },
    lastHumanMessage: null,
    artifacts: [],
    gates: [],
    target: { resolution: "missing" },
    ...overrides,
  } as AgentSnapshot;
}

function snapshot(generatedAtMs: number): HubSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: iso(generatedAtMs),
    programs: [{ id: "project", name: "Project", agents: [agent({ updatedAt: iso(generatedAtMs) })] }],
    totals: { live: 1, tracked: 1, attention: 0, working: 1, idle: 0, ended: 0, needsYou: 0, history: 0 },
    issues: [],
  } as unknown as HubSnapshot;
}

/** Runs a tracker that began watching at START and reports at START + elapsed. */
function windowAfter(elapsedMs: number): number {
  const tracker = new PulseTracker(undefined, START);
  for (let at = START; at <= START + elapsedMs; at += BUCKET_MS) {
    tracker.observe(snapshot(at), at);
  }
  return tracker.report(START + elapsedMs).momentum.observedWindowMs;
}

describe("the tracker cannot claim a window it has not watched", () => {
  test("a five-minute-old tracker reports a five-minute window, not an hour", () => {
    /* The audited case. A tracker restarted five minutes ago knows five minutes
       of history; reporting an hour upgrades a partial observation into a
       stronger claim than the data supports, which is exactly what an
       orchestrator extrapolating a rate would be misled by. */
    const observed = windowAfter(5 * 60_000);

    expect(observed).toBeLessThanOrEqual(5 * 60_000);
    expect(observed).toBeLessThan(HOUR_MS);
  });

  test("the reported window never exceeds the time actually elapsed", () => {
    /* The general relation, swept across the range rather than sampled at one
       point, so a tracker that inflates only past some threshold is caught too. */
    for (const elapsed of [0, BUCKET_MS, 3 * BUCKET_MS, 6 * BUCKET_MS, 11 * BUCKET_MS]) {
      expect(windowAfter(elapsed)).toBeLessThanOrEqual(elapsed);
    }
  });

  test("a tracker that has run for over an hour reports an hour and no more", () => {
    /* The control, and the ceiling. Without it every assertion above would pass
       on a tracker that always reported zero — which would understate every
       real window and make the qualifier permanent noise. */
    const observed = windowAfter(2 * HOUR_MS);

    expect(observed).toBe(HOUR_MS);
  });

  test("a full hour of watching is reported as a full hour", () => {
    // The boundary from below: an hour of observation must be usable as one,
    // or the "this hour" wording becomes unreachable.
    expect(windowAfter(HOUR_MS)).toBe(HOUR_MS);
  });

  test("a tracker asked before any time has passed claims nothing", () => {
    // A restarted tracker has a count before it has a window to rate it over.
    // Zero is the honest answer; any positive number here is invented.
    expect(windowAfter(0)).toBe(0);
  });
});
