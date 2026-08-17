import { describe, expect, test } from "bun:test";
import { agentIsAlerting, agentIsStripAlerting } from "../src/server/strip-alerting";
import type { AgentAck, AgentSnapshot } from "../src/shared/types";

function agent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: "codex:strip",
    provider: "codex",
    sourceSessionId: "strip",
    displayName: "Strip fixture",
    programId: "fixture",
    status: "waiting",
    statusReason: "Waiting.",
    activity: "idle",
    lifecycle: "waiting",
    scope: "observed",
    processState: "unknown",
    outcome: "healthy",
    updatedAt: "2026-08-16T12:00:00.000Z",
    lastHumanMessage: null,
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    target: { resolution: "missing" },
    controls: [],
    ...overrides,
  };
}

describe("A7 agentIsAlerting truth table", () => {
  const older = "2026-08-16T12:00:00.000Z";
  const newer = "2026-08-16T12:10:00.000Z";
  const cases: Array<[string, Partial<AgentSnapshot>, boolean]> = [
    ["A7.1 hook needsInput stays alerting while structurally healthy", {
      hookLifecycle: "needsInput",
    }, true],
    ["A7.2 parked after an older hook is quiet", {
      taskState: "parked",
      taskStateAt: newer,
      hookLifecycle: "needsInput",
      hookLifecycleAt: older,
    }, false],
    ["A7.3 a newer hook reopens a parked lane", {
      taskState: "parked",
      taskStateAt: older,
      hookLifecycle: "needsInput",
      hookLifecycleAt: newer,
    }, true],
    ["A7.4 a failed live row alerts", { outcome: "failed" }, true],
    ["A7.5 a failed parked row stays quiet", {
      outcome: "failed",
      taskState: "parked",
      taskStateAt: newer,
    }, false],
    ["A7.6 a toast overlay on a healthy row is alerting", {
      attention: true,
      attentionSignal: { kind: "input-requested", evidence: "PR merged." },
      outcome: "healthy",
    }, true],
    ["A7.9 attention overlay without a leftover signal is still alerting", {
      attention: true,
      outcome: "healthy",
    }, true],
    ["A7.7 a terminal failed row without a live process stays quiet", {
      activity: "ended",
      lifecycle: "finished",
      outcome: "failed",
    }, false],
    ["A7.8 a terminal failed row with a live process contradiction alerts", {
      activity: "ended",
      lifecycle: "finished",
      outcome: "failed",
      processState: "running",
    }, true],
  ];

  for (const [name, overrides, expected] of cases) {
    test(name, () => {
      expect(agentIsAlerting(agent(overrides))).toBe(expected);
    });
  }
});

describe("A8 agentIsStripAlerting Ack membership", () => {
  test("A8.1 only an Ack for this agent and exact fingerprint removes the row", () => {
    const hook = agent({ hookLifecycle: "needsInput" });
    const exact: AgentAck = {
      agentId: hook.id,
      ackedAt: "2026-08-16T12:01:00.000Z",
      alertFingerprint: "hook:needsInput:hook-input",
    };
    expect(agentIsAlerting(hook)).toBe(true);
    expect(agentIsStripAlerting(hook, [])).toBe(true);
    expect(agentIsStripAlerting(hook, [exact])).toBe(false);
    expect(agentIsStripAlerting(hook, [{ ...exact, agentId: "codex:other" }])).toBe(true);
    expect(agentIsStripAlerting(hook, [{ ...exact, alertFingerprint: "signal:question-pending" }]))
      .toBe(true);
  });
});
