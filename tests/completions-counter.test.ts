import { describe, expect, test } from "bun:test";
import { PulseTracker } from "../src/server/pulse";
import type { AgentSnapshot, HubSnapshot } from "../src/shared/types";

/* "N done this hour" was the worst number on the board.

   It counted `working -> idle|ended` edges. `activity` comes from
   `statusFrom()`, which reads transcript recency alone, so the "completion" it
   counted was "stopped writing for three minutes": thinking, waiting on a tool,
   blocked on a build, rate-limited, crashed and killed all scored identically
   to shipping. It recounted the same agent on every pause and never checked
   success. Its true value could be 0 while it rendered 17.

   SUCCESS is unverifiable here (`outcome` was "healthy" for 479 of 479 agents)
   and COMPLETION is undetectable for 96% of live agents, so the number is
   withheld: `completionsLastHour` is hardcoded null and `completionsProvenance`
   is a single-member union.

   WHY THIS FILE WAS REBUILT. The fix that hardcoded null made every assertion
   in the previous version unfalsifiable. Four `toBeNull`, two `not.toBe(1)`,
   one `(x ?? 0)` under `toBeLessThan(2)`, and two `toHaveProperty` — none of
   which can fail against a constant null. The sharpest part is that
   `not.toBe(1)` was the ORIGINAL check: the assertion that caught the bug
   became the one proving nothing, because it is equally true of null and of
   every value except 1. The three `toBe("not-observable")` assertions were
   never tests at all — the type admits exactly one value, so tsc proves them.

   A file named for a counter stopped testing a counter, and the suite reported
   green.

   So this now tests THE COUNTERS THAT EXIST — `working`, `stalled` and
   `stalledAgentIds` are all live, computed, and were covered by a single
   `toBe(1)` on a one-agent fixture, which cannot tell a counter from a
   constant. They are driven through the same scenarios the old completion
   counter mis-scored.

   The withheld number is ONE branch rather than the whole file, and it is
   asserted in a POPULATED state: alongside a non-zero `working` and the
   transitions the old counter would have scored. "Still null while three agents
   worked and paused" is a claim about behaviour. "Null on an idle tracker" is a
   claim about nothing. */

const base = Math.floor(Date.now() / (5 * 60_000)) * (5 * 60_000);
const iso = (ms: number): string => new Date(ms).toISOString();

function agent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: "codex:worker",
    provider: "codex",
    sourceSessionId: "worker",
    displayName: "Worker",
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
  const live = agents.filter((a) => a.activity === "working" || a.activity === "idle");
  return {
    schemaVersion: 1,
    generatedAt: iso(base),
    controlHealth: { cmuxReachable: true, lastCheckedAt: iso(base), errors: [], staleSources: [] },
    totals: {
      live: live.length,
      tracked: agents.length,
      attention: agents.filter((a) => a.status === "attention").length,
      working: agents.filter((a) => a.activity === "working").length,
      idle: agents.filter((a) => a.activity === "idle").length,
      ended: agents.filter((a) => a.activity === "ended").length,
    },
    programs: agents.length > 0 ? [{ id: "project", name: "Project", agents: [...agents] }] : [],
  } as HubSnapshot;
}

const track = () => new PulseTracker(async () => { throw new Error("no burn source"); }, base);

/** Drives one agent through a sequence of activity states, advancing updatedAt
    each time so the tracker sees genuine forward motion — the old counter
    required that, so a fixture that did not advance it would score 0 for the
    wrong reason and pass hollowly. */
function runStates(states: readonly AgentSnapshot["activity"][], overrides: Partial<AgentSnapshot> = {}) {
  const tracker = track();
  states.forEach((activity, index) => {
    const atMs = base + index * 60_000;
    tracker.observe(snapshot([agent({ activity, updatedAt: iso(atMs), ...overrides })]), atMs);
  });
  return tracker.report(base + states.length * 60_000);
}

/** Observes one fleet at a single moment. */
function observeFleet(agents: readonly AgentSnapshot[], atMs = base) {
  const tracker = track();
  tracker.observe(snapshot(agents), atMs);
  return tracker.report(atMs);
}

const fleet = (activities: readonly AgentSnapshot["activity"][]) =>
  activities.map((activity, index) => agent({ id: `codex:a${index}`, sourceSessionId: `a${index}`, activity }));

describe("working: the live counter, across the transitions the old one mis-scored", () => {
  test("it counts the agents that are working, and only those", () => {
    const pulse = observeFleet(fleet(["working", "working", "idle", "ended", "working"]));

    expect(pulse.momentum.working).toBe(3);
  });

  test("an agent that pauses leaves the working count, and returns to it", () => {
    /* Scenario 1a, now asserted against a counter that exists. The old
       completion counter scored this transition as a finished task; `working`
       must simply drop by one and come back. */
    const paused = observeFleet(fleet(["working", "idle", "working"]));
    const resumed = observeFleet(fleet(["working", "working", "working"]));

    expect(paused.momentum.working).toBe(2);
    expect(resumed.momentum.working).toBe(3);
  });

  test("oscillating five times moves the count with the state, never accumulating", () => {
    /* Scenario 1b. The old counter recounted the same agent on every pause and
       reached five. `working` is a level, not a tally: it follows the current
       state and never exceeds the one agent that exists. */
    const endingWorking = runStates(["working", "idle", "working", "idle", "working"]);
    const endingIdle = runStates(["working", "idle", "working", "idle"]);

    expect(endingWorking.momentum.working).toBe(1);
    expect(endingIdle.momentum.working).toBe(0);
  });

  test("an empty fleet reports zero rather than omitting the count", () => {
    // The zero branch, kept as a branch. A missing counter and a counter
    // reading zero are different claims about the fleet.
    const pulse = observeFleet([]);

    expect(pulse.momentum.working).toBe(0);
    expect(Object.keys(pulse.momentum)).toContain("working");
  });
});

describe("stalled: the other live counter, which had no real coverage", () => {
  test("it counts agents silent past the threshold, and names them", () => {
    /* `stalled` and `stalledAgentIds` must agree, and the ids are what make the
       number actionable. Two agents past the threshold, one inside it. */
    const now = base + 60 * 60_000;
    const threshold = observeFleet([agent()], now).momentum.stallThresholdMs;
    const longAgo = iso(now - 2 * threshold);
    const pulse = observeFleet([
      agent({ id: "codex:quiet-1", sourceSessionId: "q1", updatedAt: longAgo }),
      agent({ id: "codex:quiet-2", sourceSessionId: "q2", updatedAt: longAgo }),
      agent({ id: "codex:busy", sourceSessionId: "b", updatedAt: iso(now - 60_000) }),
    ], now);

    expect(pulse.momentum.stalled).toBe(2);
    expect([...pulse.momentum.stalledAgentIds].sort()).toEqual(["codex:quiet-1", "codex:quiet-2"]);
    expect(pulse.momentum.stalled).toBe(pulse.momentum.stalledAgentIds.length);
  });

  test("a recently active fleet stalls nobody", () => {
    // The other side, so the count above cannot be satisfied by a constant.
    const now = base + 60 * 60_000;
    const recent = fleet(["working", "working"]).map((a) => ({ ...a, updatedAt: iso(now - 60_000) }));
    const pulse = observeFleet(recent, now);

    expect(pulse.momentum.stalled).toBe(0);
    expect(pulse.momentum.stalledAgentIds).toEqual([]);
  });

  test("the published threshold is the one the count is measured against", () => {
    /* A stall count means nothing without the silence it was measured against,
       and the published figure has to be the one actually used. Asserted at the
       boundary rather than against a constant: one minute inside the published
       threshold must not be stalled, one minute outside it must be. */
    const now = base + 60 * 60_000;
    const threshold = observeFleet([agent()], now).momentum.stallThresholdMs;

    const inside = observeFleet([agent({ updatedAt: iso(now - threshold + 60_000) })], now);
    const outside = observeFleet([agent({ updatedAt: iso(now - threshold - 60_000) })], now);

    expect(threshold).toBeGreaterThan(0);
    expect(inside.momentum.stalled).toBe(0);
    expect(outside.momentum.stalled).toBe(1);
  });
});

describe("the withheld number, asserted where a number would exist", () => {
  test("an agent working and pausing repeatedly still produces no completion count", () => {
    /* THE ONE BRANCH. This is what the old file was trying to say, and it only
       says it because `working` is asserted non-zero in the same breath: there
       was a fleet, it was busy, it paused — every condition the old counter
       needed to score — and the number is still withheld.

       Falsifiable against the thing it guards: reinstate any counter and this
       goes red. Null on an idle tracker would not have been. */
    const pulse = runStates(["working", "idle", "working", "idle", "working"]);

    expect(pulse.momentum.working).toBeGreaterThan(0);
    expect(pulse.momentum.completionsLastHour).toBeNull();
  });

  test("an agent that ended FAILED produces no completion count either", () => {
    /* Scenario 1c. The old counter scored a crash as a success, which is the
       worst single thing it did. Paired with a fleet the tracker demonstrably
       observed, so the null is a statement about this transition rather than
       about an idle tracker. */
    const pulse = runStates(["working", "ended"], { outcome: "failed" });

    expect(pulse.momentum.observedWindowMs).toBeGreaterThanOrEqual(0);
    expect(pulse.momentum.stalled).toBe(0);
    expect(pulse.momentum.completionsLastHour).toBeNull();
  });

  test("the field is present and null, so the card can say why rather than render a gap", () => {
    /* Withheld is not absent. A consumer needs the key to exist so it can
       explain the omission; dropping it from the wire renders an empty tile
       instead of "not observable".

       `completionsProvenance` is deliberately NOT asserted: it is a
       single-member union, so tsc already proves it and a runtime check would
       be ceremony. The previous version asserted it three times. */
    const pulse = runStates(["working", "idle"]);

    expect(Object.keys(pulse.momentum)).toContain("completionsLastHour");
    expect(pulse.momentum.completionsLastHour).toBeNull();
  });
});
