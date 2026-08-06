/**
 * Live-code guards for claims whose fixture suites were hollow under mutation.
 *
 * Proven hollow in docs/TEST-HOLLOWNESS-AUDIT.md:
 *   - parked-then-asks only asserted fixture.expect against itself for attentionClass
 *   - standby-unmeasurable only inspected fixture JSON, not PulseTracker output
 *   - heartbeat-churn only checked fixture-internal monotonicity, not handoff.since
 *
 * Hermetic — safe for `bun run test:ci`.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PulseTracker } from "../src/server/pulse";
import type { AgentSnapshot, HubSnapshot } from "../src/shared/types";
import type { TaskAttentionEvidence } from "../src/server/task-state";

const FIXTURES = join(import.meta.dir, "fixtures");

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
}

const parked = readJson<{
  cases: Array<{
    name: string;
    claim: string;
    evidence: TaskAttentionEvidence & { attentionSignal?: { kind: string } };
    expect: { wantsHuman: boolean; attentionClass: "blocking" | null; reAlert: boolean };
  }>;
}>("parked-then-asks.json");

const standby = readJson<{
  cases: Array<{
    name: string;
    claim: string;
    agents: Array<{
      id: string;
      attentionClass?: string;
      attentionSignal?: { kind: string };
      blockedSince?: string;
    }>;
    now: string;
    expect: { pulse: { blocked: number }; standbyMs: { never: number } };
  }>;
}>("standby-unmeasurable.json");

const heartbeat = readJson<{
  session: {
    id: string;
    hookLifecycle: string;
    attentionClass?: string;
    attentionSignal?: { kind: string };
  };
  passes: Array<{
    name: string;
    at: string;
    hookRecord: { updatedAt: string; agentLifecycle: string };
  }>;
}>("heartbeat-churn.json");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let notify: any;

beforeAll(async () => {
  // @ts-expect-error dependency-free browser module
  notify = await import("../src/web/notification-center.js");
});

function agent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: "codex:test",
    provider: "codex",
    sourceSessionId: "test",
    displayName: "Test session",
    programId: "project",
    status: "waiting",
    statusReason: "Fixture.",
    activity: "idle",
    lifecycle: "waiting",
    outcome: "needs-you",
    updatedAt: "2026-08-05T12:00:00.000Z",
    tokens: { sessionTotal: 0, provenance: "observed" },
    lastHumanMessage: null,
    artifacts: [],
    gates: [],
    target: { resolution: "missing" },
    controls: [],
    ...overrides,
  } as AgentSnapshot;
}

function snapOf(agents: AgentSnapshot[]): HubSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-05T12:00:00.000Z",
    controlHealth: { cmuxReachable: true, lastCheckedAt: "x", errors: [], staleSources: [] },
    totals: {
      live: agents.length,
      tracked: agents.length,
      attention: agents.length,
      working: 0,
      idle: agents.length,
      ended: 0,
    },
    programs: [{ id: "project", name: "Project", agents }],
  };
}

const DEPS = {
  programNameFor: (program: { name?: string } | null) => (program && program.name) || "",
  impactFor: () => "",
};

describe("parked-then-asks — attentionClassOf must execute the fixture", () => {
  /* Mutation that stayed GREEN against the hollow suite: disable declaredQuiet
     inside attentionClassOf. These rows call the live client path. */
  for (const row of parked.cases) {
    test(`${row.name}`, () => {
      const shaped = {
        id: `codex:${row.name}`,
        programId: "project",
        ...row.evidence,
        attentionSignal: row.evidence.attentionSignal || { kind: "question-pending" },
      };
      expect(notify.attentionClassOf(shaped)).toBe(row.expect.attentionClass);
    });
  }
});

describe("standby-unmeasurable — PulseTracker must omit standbyMs", () => {
  /* Mutation that stayed GREEN against the hollow suite: emit standbyMs: 0 from
     PulseTracker.report. The fixture JSON never ran the producer. */
  for (const row of standby.cases) {
    test(`${row.name}`, () => {
      const nowMs = Date.parse(row.now);
      const tracker = new PulseTracker(undefined, nowMs);
      const agents = row.agents.map((entry) => agent({
        id: entry.id,
        sourceSessionId: entry.id.split(":")[1] || entry.id,
        attentionSignal: entry.attentionSignal as AgentSnapshot["attentionSignal"],
        ...(entry.blockedSince ? { blockedSince: entry.blockedSince } as object : {}),
      }));
      tracker.observe(snapOf(agents), nowMs);
      const report = tracker.report(nowMs);
      expect(report.blocked).toBe(row.expect.pulse.blocked);
      expect(report).not.toHaveProperty("standbyMs");
      expect((report as { standbyMs?: unknown }).standbyMs).not.toBe(row.expect.standbyMs.never);

      const panel = notify.notificationPanelModel(snapOf(agents), [], nowMs, DEPS);
      expect(panel).not.toHaveProperty("standby");
      expect(String(panel.standby ?? "")).not.toBe("0");
    });
  }
});

describe("heartbeat-churn — handoff.since must ignore every candidate clock", () => {
  /* Mutation that stayed GREEN against the hollow suite: wire handoff.since from
     hookLifecycleAt / updatedAt / blockedSince. Fixture-only monotonicity does
     not execute notificationFeed. */
  test("across heartbeat passes, since stays null and never equals a write clock", () => {
    const clocks = ["hookLifecycleAt", "updatedAt", "taskStateAt", "blockedSince"] as const;
    for (const pass of heartbeat.passes) {
      const shaped = agent({
        id: heartbeat.session.id,
        sourceSessionId: "heartbeat-churn",
        hookLifecycle: heartbeat.session.hookLifecycle as AgentSnapshot["hookLifecycle"],
        attentionSignal: heartbeat.session.attentionSignal as AgentSnapshot["attentionSignal"],
        hookLifecycleAt: pass.hookRecord.updatedAt,
        updatedAt: pass.hookRecord.updatedAt,
        taskStateAt: "2026-08-05T11:00:00.000Z",
        ...( { blockedSince: heartbeat.passes[0]!.hookRecord.updatedAt } as object ),
      });
      const items = notify.notificationFeed(snapOf([shaped]), [], Date.parse(pass.at), DEPS);
      expect(items.length, pass.name).toBe(1);
      expect(items[0].since, pass.name).toBeNull();
      const shapedRecord = shaped as unknown as Record<string, unknown>;
      for (const key of clocks) {
        const value = shapedRecord[key];
        if (typeof value === "string") {
          expect(items[0].since, `${pass.name}:${key}`).not.toBe(value);
        }
      }
    }
  });
});
