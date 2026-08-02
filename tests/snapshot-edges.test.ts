import { describe, expect, test } from "bun:test";
import { buildSnapshot } from "../src/server/snapshot";
import type { ArchiveStore, CollectedAgent } from "../src/server/types";

/* Degenerate-input coverage for buildSnapshot: an empty fleet, records missing
   every optional field, a status the type system says cannot exist, and a
   control plane that is unreachable without saying why. Each of these reaches
   the hub from a source it does not control, so "does not throw" is the floor,
   not the assertion — every test below pins the verdict the operator is shown. */

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
const NOW = new Date("2026-07-21T23:00:30.000Z");

function collected(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: "codex:test-session",
    provider: "codex",
    sourceSessionId: "test-session",
    displayName: "Test session",
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

const agentsOf = (snapshot: ReturnType<typeof buildSnapshot>) =>
  snapshot.programs.flatMap(({ agents }) => agents);

describe("snapshot edge cases", () => {
  test("an empty fleet reports zeroes, not absent or NaN totals", () => {
    const snapshot = buildSnapshot({ agents: [], surfaces: [], archiveStore, now: NOW });

    // The rail renders these directly; undefined would paint a blank tile and
    // NaN would paint "NaN", so every count has to be a real zero.
    expect(snapshot.totals).toMatchObject({
      live: 0,
      tracked: 0,
      attention: 0,
      working: 0,
      idle: 0,
      ended: 0,
      needsYou: 0,
      history: 0,
      tokenReporting: 0,
      tokenEligible: 0,
    });
    expect(snapshot.programs).toEqual([]);
    expect(snapshot.issues ?? []).toEqual([]);
  });

  test("an empty fleet omits aggregates it cannot compute rather than reporting zero", () => {
    const snapshot = buildSnapshot({ agents: [], surfaces: [], archiveStore, now: NOW });

    // Zero tokens burned and "no session reported tokens" are different claims.
    // Reporting 0 here would tell the operator the fleet is free.
    expect(snapshot.totals.tokens).toBeUndefined();
    expect(snapshot.totals.tokenMedian).toBeUndefined();
    expect(snapshot.contextPeak).toBeUndefined();
    expect(snapshot.contextMedian).toBeUndefined();
  });

  test("an empty fleet still calls all four sources healthy", () => {
    const snapshot = buildSnapshot({ agents: [], surfaces: [], archiveStore, now: NOW });

    // No agents is not evidence of a broken collector.
    expect(snapshot.totals.sourceHealth).toEqual({ healthy: 4, degraded: 0, absent: 0, total: 4 });
    expect(snapshot.controlHealth?.cmuxReachable).toBe(true);
  });

  test("an agent missing every optional field still renders without inventing data", () => {
    const bare = {
      id: "codex:bare",
      provider: "codex",
      sourceSessionId: "bare",
      displayName: "Bare",
      status: "waiting",
      statusReason: "",
      updatedAt: "2026-07-21T23:00:00.000Z",
      tokens: {},
      artifacts: [],
      gates: [],
    } as unknown as CollectedAgent;

    const snapshot = buildSnapshot({ agents: [bare], surfaces: [], archiveStore, now: NOW });
    const agent = agentsOf(snapshot)[0]!;

    expect(agent.activity).toBe("idle");
    expect(agent.tokens.total).toBeUndefined();
    // A session with no cwd cannot be matched to a surface, so controls stay off.
    expect(agent.controlState).toBe("observed-only");
    expect(snapshot.totals.tracked).toBe(1);
    expect(snapshot.totals.tokens).toBeUndefined();
  });

  test("an unrecognized status degrades to unknown instead of guessing working", () => {
    // AgentStatus is a closed union, so this only arrives from a collector
    // parsing a source format that changed under us. The default must not
    // promote an unreadable session into the working count or hand it controls.
    const snapshot = buildSnapshot({
      agents: [collected({ status: "banana" as CollectedAgent["status"] })],
      surfaces: [],
      archiveStore,
      now: NOW,
    });
    const agent = agentsOf(snapshot)[0]!;

    expect(agent.activity).toBe("unknown");
    expect(agent.processState).toBe("unknown");
    expect(snapshot.totals.working).toBe(0);
    expect(snapshot.totals.idle).toBe(0);
    expect(snapshot.totals.ended).toBe(0);
    // It is still tracked: an unreadable session must not vanish from the board.
    expect(snapshot.totals.tracked).toBe(1);
  });

  test("an unreachable control plane counts as a degraded source", () => {
    const snapshot = buildSnapshot({
      agents: [],
      surfaces: [],
      archiveStore,
      cmuxReachable: false,
      now: NOW,
    });

    expect(snapshot.controlHealth?.cmuxReachable).toBe(false);
    expect(snapshot.totals.sourceHealth).toEqual({ healthy: 3, degraded: 1, absent: 0, total: 4 });
  });

  test("an unreachable control plane carries the errors that explain it", () => {
    const snapshot = buildSnapshot({
      agents: [collected()],
      surfaces: [],
      archiveStore,
      cmuxReachable: false,
      cmuxErrors: ["cmux socket refused the connection"],
      now: NOW,
    });

    /* HubState derives cmuxReachable from the error list, so the two always
       travel together in production. This pins that coupling: an operator told
       a source is degraded must also be told which failure caused it. */
    const control = snapshot.issues?.find(({ id }) => id === "system:cmux-control");
    expect(control?.severity).toBe("error");
    expect(control?.technicalDetails).toContain("cmux socket refused the connection");
    expect(snapshot.controlHealth?.errors).toContain("cmux socket refused the connection");
  });

  test("a stale session with a live process is idle, and controls survive", () => {
    const snapshot = buildSnapshot({
      agents: [collected({ status: "stale", processAlive: true, processIds: [4_242] })],
      surfaces: [],
      archiveStore,
      now: NOW,
    });
    const agent = agentsOf(snapshot)[0]!;

    // 45 minutes of silence from a provably running process is a quiet agent,
    // not a finished one; calling it ended would strip focus and instruct.
    expect(agent.activity).toBe("idle");
    expect(agent.processState).toBe("running");
    expect(snapshot.totals.ended).toBe(0);
  });

  test("a stale session with no process evidence reads as ended, not died", () => {
    const snapshot = buildSnapshot({
      agents: [collected({ status: "stale" })],
      surfaces: [],
      archiveStore,
      now: NOW,
    });
    const agent = agentsOf(snapshot)[0]!;

    expect(agent.activity).toBe("ended");
    // Absent evidence is not evidence of death.
    expect(agent.processState).toBe("unknown");
    expect(snapshot.totals.ended).toBe(1);
  });

  test("a Cursor child whose parent never reported a model is unreported, not accused", () => {
    const parent = collected({
      id: "cursor:parent",
      provider: "cursor",
      sourceSessionId: "parent",
      displayName: "Parent",
      model: undefined,
    });
    const child = collected({
      id: "cursor:child",
      provider: "cursor",
      sourceSessionId: "child",
      displayName: "Child",
      model: "gpt-5.6-sol",
      parentSourceSessionId: "parent",
    });

    const snapshot = buildSnapshot({ agents: [parent, child], surfaces: [], archiveStore, now: NOW });
    const policy = agentsOf(snapshot).find(({ id }) => id === "cursor:child")?.modelPolicy;

    /* Inheritance cannot be verified against a parent model nobody reported, so
       the verdict is "unreported" and the session is not counted as a routing
       violation. NOTE: this fires ahead of the Cursor-native family check, so a
       demonstrably non-native model escapes `mismatch` on this path — which the
       comment above cursorModelPolicy says should happen "regardless of the
       parent model". Pinned as-built; see the lane report. */
    expect(policy?.state).toBe("unreported");
    expect(policy?.observed).toBe("gpt-5.6-sol");
    expect(policy?.expected).toBe("Parent model (unreported)");
    expect(policy?.evidence).toBe("cursor-ai-tracking");
    expect(snapshot.totals.cursorModelHealth).toMatchObject({ mismatch: 0, unreported: 2 });
  });

  test("a rootless Cursor session with no model is unreported against the configured root", () => {
    const snapshot = buildSnapshot({
      agents: [collected({
        id: "cursor:solo",
        provider: "cursor",
        sourceSessionId: "solo",
        displayName: "Solo",
        model: undefined,
      })],
      surfaces: [],
      archiveStore,
      now: NOW,
    });
    const policy = agentsOf(snapshot)[0]!.modelPolicy;

    expect(policy?.state).toBe("unreported");
    expect(policy?.evidence).toBe("none");
    expect(policy?.observed).toBeUndefined();
  });
});
