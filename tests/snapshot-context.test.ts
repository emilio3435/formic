import { describe, expect, test } from "bun:test";
import { buildSnapshot } from "../src/server/snapshot";
import type { ArchiveStore, CollectedAgent } from "../src/server/types";

const archiveStore: ArchiveStore = {
  has: () => false,
  archive: async () => {},
};

function agent(tokens: CollectedAgent["tokens"]): CollectedAgent {
  return {
    id: "codex:context-test",
    provider: "codex",
    sourceSessionId: "context-test",
    displayName: "Context test",
    status: "running",
    statusReason: "Fixture activity is recent.",
    updatedAt: "2026-07-30T12:00:00.000Z",
    tokens,
    artifacts: [],
    gates: [],
  };
}

function contextPctFor(tokens: CollectedAgent["tokens"]): unknown {
  const snapshot = buildSnapshot({
    agents: [agent(tokens)],
    surfaces: [],
    archiveStore,
    now: new Date("2026-07-30T12:00:30.000Z"),
  });
  const snapshotAgent = snapshot.programs[0]?.agents[0];
  return snapshotAgent ? Reflect.get(snapshotAgent, "contextPct") : undefined;
}

describe("snapshot context utilization", () => {
  test("derives contextPct from observed latest-turn tokens and the context window", () => {
    expect(contextPctFor({
      contextWindow: 200_000,
      total: 125_000,
      sessionTotal: 9_000_000,
      scope: "latest-turn",
      provenance: "observed",
    })).toBe(63);
  });

  test("leaves contextPct unknown when the context window is absent", () => {
    expect(contextPctFor({
      total: 125_000,
      sessionTotal: 125_000,
      scope: "latest-turn",
      provenance: "observed",
    })).toBeUndefined();
  });

  test.each([
    { contextWindow: 200_000, total: 0, sessionTotal: 125_000, scope: "latest-turn", provenance: "observed" } as const,
    { contextWindow: 200_000, scope: "latest-turn", provenance: "observed" } as const,
    { contextWindow: 200_000, sessionTotal: 125_000, scope: "unknown", provenance: "observed" } as const,
    { contextWindow: 200_000, total: 250_000, sessionTotal: 125_000, scope: "latest-turn", provenance: "observed" } as const,
  ])("leaves contextPct unknown without a usable latest-turn token total", (tokens) => {
    expect(contextPctFor(tokens)).toBeUndefined();
  });

  test("derives contextPct from an observed occupancy percent without any token total", () => {
    expect(contextPctFor({
      contextWindow: 500_000,
      occupancyPct: 95.47466666666666,
      scope: "latest-turn",
      provenance: "observed",
    })).toBe(95);
  });

  test("caps an over-100 occupancy reading at 100 and works without a window", () => {
    expect(contextPctFor({
      occupancyPct: 100.3,
      scope: "latest-turn",
      provenance: "observed",
    })).toBe(100);
  });

  /* 100.5 is the exact reading the cap exists for: it is the top of the range
     ingest admits, and Math.round(100.5) is 101 — a percentage the board must
     never show. The 100.3 case above rounds to 100 with or without the cap, so
     it pins the branch but not the cap. */
  test("caps the highest reading ingest admits, which would otherwise round to 101", () => {
    expect(contextPctFor({
      occupancyPct: 100.5,
      scope: "latest-turn",
      provenance: "observed",
    })).toBe(100);
  });

  test("ignores occupancy that is not observed", () => {
    expect(contextPctFor({
      occupancyPct: 95,
      scope: "latest-turn",
      provenance: "unknown",
    })).toBeUndefined();
  });
});
