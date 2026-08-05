import { describe, expect, test } from "bun:test";
import { roleFor2 } from "../src/server/snapshot-agent";
import type { CollectedAgent } from "../src/server/types";

function agent(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: "claude:role-fixture",
    provider: "claude",
    sourceSessionId: "role-fixture",
    displayName: "Implementation lane",
    status: "running",
    statusReason: "Fixture activity is recent.",
    updatedAt: "2026-08-05T12:00:00.000Z",
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    ...overrides,
  };
}

describe("role taxonomy v2", () => {
  test("a manifest-declared orchestrator needs no observed children", () => {
    expect(roleFor2(agent(), { declaredRole: "orchestrator" })).toEqual({
      role: "orchestrator",
      roleSource: "declared",
    });
  });

  test("a Claude SubagentStop-observed child makes its parent an observed orchestrator", () => {
    expect(roleFor2(agent({ subagentCount: 1 }))).toEqual({
      role: "orchestrator",
      roleSource: "observed",
    });
  });

  test("an orchestrator-shaped title is only inferred", () => {
    expect(roleFor2(agent({ displayName: "Coordinate the swarm" }))).toEqual({
      role: "orchestrator",
      roleSource: "inferred",
    });
  });

  test("a terminal surface with no bound agent is an observed service", () => {
    expect(roleFor2(undefined, { unboundSurface: true })).toEqual({
      role: "service",
      roleSource: "observed",
    });
  });

  test("frontend and backend are worker specialties, not roles", () => {
    expect(roleFor2(agent({ displayName: "Frontend rendering lane" }))).toEqual({
      role: "worker",
      roleSource: "inferred",
      specialty: "frontend",
    });
    expect(roleFor2(agent({ displayName: "Backend server lane" }))).toEqual({
      role: "worker",
      roleSource: "inferred",
      specialty: "backend",
    });
  });

  test("human and monitor are never inferred from titles", () => {
    expect(roleFor2(agent({ displayName: "Human operator" }))).toEqual({
      role: "agent",
      roleSource: "inferred",
    });
    expect(roleFor2(agent({ displayName: "Deployment monitor" }))).toEqual({
      role: "agent",
      roleSource: "inferred",
    });
  });
});
