import { describe, expect, test } from "bun:test";
import { PulseTracker } from "../src/server/pulse";
import type { AgentSnapshot, HubSnapshot } from "../src/shared/types";

/* "N done this hour" was the worst number on the board.

   It counted `working -> idle|ended` edges. `activity` comes from
   `statusFrom()`, which reads transcript recency alone, so the "completion" it
   counted was "stopped writing for three minutes": thinking, waiting on a tool,
   blocked on a build, rate-limited, crashed and killed all scored identically
   to shipping. It recounted the same agent on every pause and never checked
   success. Its true value could be 0 while it rendered 17 — the only unbounded
   error on the board, under the strongest success word on it.

   Fixing it needs terminality, success, idempotence and attribution. Two are
   not available in this data, measured on the live fleet:

     - SUCCESS is unverifiable: `outcome` is "healthy" for 479 of 479 agents and
       `gates` is empty for all 479. A filter on them excludes nothing, so it
       would look like verification and perform none.
     - COMPLETION is undetectable for 96% of live agents. Only Codex emits a
       real per-task event (`task_complete`), and Codex is 1 of 24 live
       sessions. Claude's `stop_reason: "end_turn"` fires on every assistant
       reply — a turn, not a task. Cursor has nothing.

   So the number is withheld. These tests are not "assert null equals null":
   each one reconstructs a scenario the old counter scored, and fails if any
   counter that scores it is reinstated. */

const BUCKET_MS = 5 * 60_000;
const base = Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS;
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

/* Drives the tracker through a sequence of activity states for one agent,
   advancing updatedAt each time so the tracker sees genuine forward motion —
   the old counter required that, so a test that did not advance it would score
   0 for the wrong reason and pass hollowly. */
function runStates(states: readonly AgentSnapshot["activity"][], overrides: Partial<AgentSnapshot> = {}) {
  const tracker = new PulseTracker(async () => { throw new Error("no burn source"); }, base);
  states.forEach((activity, index) => {
    const atMs = base + index * 60_000;
    tracker.observe(snapshot([agent({ activity, updatedAt: iso(atMs), ...overrides })]), atMs);
  });
  return tracker.report(base + states.length * 60_000);
}

describe("a counter labelled done never scores a pause", () => {
  test("1a: an agent that pauses and resumes contributes nothing", () => {
    /* The defect in one line: `working -> idle` fired for an agent that thought
       for three minutes, and the agent going back to `working` proves it was
       never finished. The old counter scored this 1. */
    const pulse = runStates(["working", "idle", "working"]);

    expect(pulse.momentum.completionsLastHour).toBeNull();
    expect(pulse.momentum.completionsLastHour).not.toBe(1);
    expect(pulse.momentum.completionsProvenance).toBe("not-observable");
  });

  test("1b: an agent oscillating five times is not five completions", () => {
    // Agent memory held only lastActivity, so every falling edge counted.
    const pulse = runStates([
      "working", "idle", "working", "idle", "working",
      "idle", "working", "idle", "working", "idle",
    ]);

    expect(pulse.momentum.completionsLastHour).toBeNull();
    // The old counter scored this 5. Any counter that still does fails here.
    expect(pulse.momentum.completionsLastHour ?? 0).toBeLessThan(2);
  });

  test("1c: an agent that ended FAILED is never counted as done", () => {
    /* There was no reference to outcome, gates, exited or transcriptEndedCleanly
       anywhere in the counting path, so a crash and a ship were the same event. */
    const pulse = runStates(["working", "ended"], { outcome: "failed", gates: ["tests failed"] });

    expect(pulse.momentum.completionsLastHour).toBeNull();
    expect(pulse.momentum.completionsLastHour).not.toBe(1);
  });

  test("even a clean working-to-ended transition is not claimed as a completion", () => {
    /* The case most likely to be argued back in. It still is not evidence: the
       activity came from transcript recency, and nothing here says the work
       succeeded. Withholding is the claim, and it has to hold for the flattering
       case too or it is not a rule. */
    const pulse = runStates(["working", "ended"]);

    expect(pulse.momentum.completionsLastHour).toBeNull();
    expect(pulse.momentum.completionsProvenance).toBe("not-observable");
  });

  test("the withheld number is stated as withheld, not omitted from the wire", () => {
    /* Absent-first, but not silent: a consumer must be able to tell "we cannot
       observe this" from "this key is missing because the server is old". */
    const pulse = runStates(["working"]);

    expect(pulse.momentum).toHaveProperty("completionsLastHour");
    expect(pulse.momentum).toHaveProperty("completionsProvenance");
    expect(pulse.momentum.completionsProvenance).toBe("not-observable");
  });

  test("withholding completions does not silence the rest of momentum", () => {
    /* The risk of deleting a number is deleting its neighbours' credibility.
       Working and stalled are still observed and must still be reported. */
    const pulse = runStates(["working", "working"]);

    expect(pulse.momentum.working).toBe(1);
    expect(pulse.momentum.stallThresholdMs).toBe(900_000);
    expect(Array.isArray(pulse.momentum.stalledAgentIds)).toBe(true);
  });
});
