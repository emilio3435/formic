import { beforeAll, describe, expect, test } from "bun:test";
import { attentionClassFor } from "../src/server/attention-signal";
import {
  DEFAULT_STALL_THRESHOLD_MS,
  isAlerting as serverIsAlerting,
  isLive as serverIsLive,
  isStalled as serverIsStalled,
} from "../src/server/live";
import { PulseTracker } from "../src/server/pulse";
import { buildSnapshot } from "../src/server/snapshot";
import { rollupFor } from "../src/server/snapshot-programs";
import {
  taskStateWantsHuman as taskStateWantsHumanOnServer,
} from "../src/server/task-state";
import type { ArchiveStore, CollectedAgent } from "../src/server/types";
import type { AgentSnapshot, HubSnapshot } from "../src/shared/types";

const NOW = Date.parse("2026-08-16T16:39:00.000Z");
const THRESHOLD = DEFAULT_STALL_THRESHOLD_MS;
const AGENT_ID = "grok:bot:14ee8878-7022-43d7-a6b3-b6c36d56915c";

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };

function collected(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: AGENT_ID,
    provider: "grok",
    sourceSessionId: "14ee8878-7022-43d7-a6b3-b6c36d56915c",
    displayName: "Formic Agent",
    cwd: "/tmp/formic-agent",
    status: "running",
    statusReason: "Source activity within 3 minutes",
    startedAt: iso(NOW - 10 * 60_000),
    updatedAt: iso(NOW - 90_000),
    workingSince: iso(NOW - 3 * 60_000),
    tokens: { provenance: "unknown" },
    lastHumanMessage: "Draft the next pass.",
    lastUserMessage: "Draft the next pass.",
    lastAgentClosing: "Want me to write those up?",
    lastHumanFacingAt: iso(NOW - 90_000),
    artifacts: [],
    gates: [],
    ...overrides,
  };
}

function workingQuestionPending(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: AGENT_ID,
    provider: "grok",
    sourceSessionId: "14ee8878-7022-43d7-a6b3-b6c36d56915c",
    displayName: "Formic Agent",
    programId: "formic-agent",
    status: "running",
    statusReason: "Source activity within 3 minutes",
    activity: "working",
    lifecycle: "working",
    scope: "observed",
    outcome: "healthy",
    attention: undefined,
    updatedAt: iso(NOW - 90_000),
    workingSince: iso(NOW - 3 * 60_000),
    lastThreadAt: iso(NOW - 90_000),
    tokens: { provenance: "unknown" },
    lastHumanMessage: "Draft the next pass.",
    lastAgentClosing: "Want me to write those up?",
    attentionSignal: {
      kind: "question-pending",
      evidence: "Want me to write those up?",
    },
    nextAction: "Answer the question it stopped on.",
    artifacts: [],
    gates: [],
    target: { resolution: "missing" },
    controls: [],
    ...overrides,
  };
}

function pulseSnapshot(agents: readonly AgentSnapshot[]): HubSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: iso(NOW),
    controlHealth: { cmuxReachable: true, lastCheckedAt: iso(NOW), errors: [], staleSources: [] },
    totals: {
      live: agents.filter((agent) => serverIsLive(agent, NOW, THRESHOLD)).length,
      tracked: agents.length,
      attention: 0,
      working: agents.filter((agent) => agent.activity === "working").length,
      idle: agents.filter((agent) => agent.activity === "idle").length,
      ended: 0,
    },
    programs: [{ id: "formic-agent", name: "Formic Agent", agents: [...agents] }],
  };
}

describe("fresh working does not let offer-style question-pending win", () => {
  test("taskStateWantsHuman ignores question-pending while lifecycle is working", () => {
    expect(taskStateWantsHumanOnServer({
      lifecycle: "working",
      attentionSignal: { kind: "question-pending" },
    })).toBe(false);
  });

  test("needsInput and other kinds still count while working", () => {
    expect(taskStateWantsHumanOnServer({
      lifecycle: "working",
      hookLifecycle: "needsInput",
      attentionSignal: { kind: "question-pending" },
    })).toBe(true);
    expect(taskStateWantsHumanOnServer({
      lifecycle: "working",
      attentionSignal: { kind: "handoff-stated" },
    })).toBe(true);
    expect(taskStateWantsHumanOnServer({
      lifecycle: "working",
      attentionSignal: { kind: "permission-requested" },
    })).toBe(true);
  });

  test("question-pending still counts once the turn has stopped", () => {
    expect(taskStateWantsHumanOnServer({
      lifecycle: "waiting",
      attentionSignal: { kind: "question-pending" },
    })).toBe(true);
  });

  test("last-known freshness does not get the working suppress", () => {
    expect(taskStateWantsHumanOnServer({
      lifecycle: "working",
      sourceFreshness: "last-known",
      attentionSignal: { kind: "question-pending" },
    })).toBe(true);
  });

  test("attentionClass stays absent; the signal itself stays on the row", () => {
    const agent = workingQuestionPending();
    expect(agent.attentionSignal?.kind).toBe("question-pending");
    expect(attentionClassFor(agent)).toBeUndefined();
    expect(serverIsAlerting(agent)).toBe(false);
    expect(serverIsLive(agent, NOW, THRESHOLD)).toBe(true);
    expect(serverIsStalled(agent, NOW, THRESHOLD)).toBe(false);
  });

  test("program rollup.needsYou stays 0 unless another row is actually stopped", () => {
    const working = workingQuestionPending();
    const stopped = workingQuestionPending({
      id: "grok:bot:stopped",
      lifecycle: "waiting",
      activity: "idle",
      status: "waiting",
    });
    expect(rollupFor([working], NOW).needsYou).toBe(0);
    expect(rollupFor([working, stopped], NOW).needsYou).toBe(1);
  });

  test("pulse stalledAgentIds do not absorb a fresh working offer-question", () => {
    const tracker = new PulseTracker(undefined, NOW - 60 * 60_000);
    tracker.observe(pulseSnapshot([workingQuestionPending()]), NOW);
    expect(tracker.report(NOW).momentum.stalledAgentIds).toEqual([]);
  });

  test("buildSnapshot keeps the offer evidence and does not invent process liveness", () => {
    const snap = buildSnapshot({
      agents: [collected()],
      surfaces: [],
      archiveStore,
      now: new Date(NOW),
    });
    const agent = snap.programs.flatMap((program) => program.agents).find((row) => row.id === AGENT_ID);
    expect(agent?.lifecycle).toBe("working");
    expect(agent?.attentionSignal?.kind).toBe("question-pending");
    expect(agent?.attentionSignal?.evidence).toMatch(/Want me to write those up/i);
    expect(agent?.processState).toBe("unknown");
    expect(agent?.attention).not.toBe(true);
    expect(snap.totals.needsYou).toBe(0);
    expect(snap.programs[0]?.rollup?.needsYou).toBe(0);
    expect(agent && serverIsAlerting(agent)).toBe(false);
  });
});

describe("client mirrors the working question-pending suppress", () => {
  let M: {
    wantsHuman: (agent: AgentSnapshot) => boolean;
    alerting: (agent: AgentSnapshot) => boolean;
    operatorState: (agent: AgentSnapshot, nowMs?: number, thresholdMs?: number) => string | null;
    isLive: (agent: AgentSnapshot, nowMs?: number, thresholdMs?: number) => boolean;
    isStalled: (agent: AgentSnapshot, nowMs?: number, thresholdMs?: number) => boolean;
    deriveRollup: (agents: AgentSnapshot[], nowMs?: number, thresholdMs?: number) => { needsYou: number; live: number };
    rowTimeBand: (agent: AgentSnapshot, nowMs?: number, thresholdMs?: number) => { kind: string; tone?: string; verb?: string; duration?: string } | null;
    attentionClassOf: (agent: AgentSnapshot) => string | null;
    repoScopedReadings: (program: { agents: AgentSnapshot[] }) => { health: { value: string } };
    deterministicRepoStats: (program: { agents: AgentSnapshot[] }, snap?: HubSnapshot) => { needsYou: number };
    stripAlerting: (agent: AgentSnapshot, snap?: HubSnapshot) => boolean;
  };
  let clientTaskState: { taskStateWantsHuman: (evidence: unknown) => boolean };

  beforeAll(async () => {
    // @ts-expect-error browser client has no declaration
    await import("../src/web/app.js");
    M = (globalThis as unknown as { TheAntHill: typeof M }).TheAntHill;
    // @ts-expect-error browser client has no declaration
    clientTaskState = await import("../src/web/task-state.js");
  });

  test("server and client agree on the live Bot fixture", () => {
    const agent = workingQuestionPending();
    const evidence = {
      lifecycle: "working" as const,
      attentionSignal: { kind: "question-pending" as const },
    };
    expect(clientTaskState.taskStateWantsHuman(evidence)).toBe(false);
    expect(clientTaskState.taskStateWantsHuman(evidence))
      .toBe(taskStateWantsHumanOnServer(evidence));
    expect(M.wantsHuman(agent)).toBe(false);
    expect(M.alerting(agent)).toBe(false);
    expect(M.attentionClassOf(agent)).toBeNull();
    expect(M.operatorState(agent, NOW, THRESHOLD)).toBe("working");
    expect(M.isLive(agent, NOW, THRESHOLD)).toBe(true);
    expect(M.isStalled(agent, NOW, THRESHOLD)).toBe(false);
    expect(M.deriveRollup([agent], NOW, THRESHOLD).needsYou).toBe(0);
    expect(M.deriveRollup([agent], NOW, THRESHOLD).needsYou).toBe(rollupFor([agent], NOW).needsYou);
    expect(M.rowTimeBand(agent, NOW, THRESHOLD)).toMatchObject({
      kind: "doing",
      tone: "working",
      duration: "3m",
    });
  });

  test("repo-scoped and strip counts do not inflate from a mid-work offer", () => {
    const agent = workingQuestionPending();
    const program = { id: "formic-agent", name: "Formic Agent", agents: [agent] };
    const snap = pulseSnapshot([agent]);
    expect(M.repoScopedReadings(program).health.value).toBe("Steady");
    expect(M.deterministicRepoStats(program, snap).needsYou).toBe(0);
    expect(M.stripAlerting(agent, snap)).toBe(false);
  });

  test("a stopped sibling still paints needs-you and inflates the rollup", () => {
    const working = workingQuestionPending();
    const stopped = workingQuestionPending({
      id: "grok:bot:stopped",
      lifecycle: "waiting",
      activity: "idle",
      status: "waiting",
    });
    const program = { id: "formic-agent", name: "Formic Agent", agents: [working, stopped] };
    const snap = pulseSnapshot([working, stopped]);
    expect(M.operatorState(stopped, NOW, THRESHOLD)).toBe("needs-you");
    expect(M.deriveRollup([working, stopped], NOW, THRESHOLD).needsYou).toBe(1);
    expect(M.deterministicRepoStats(program, snap).needsYou).toBe(1);
    expect(M.attentionClassOf(stopped)).toBe("blocking");
    expect(M.attentionClassOf(working)).toBeNull();
  });
});
