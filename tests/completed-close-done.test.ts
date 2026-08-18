import { beforeAll, describe, expect, test } from "bun:test";
import {
  DEFAULT_STALL_THRESHOLD_MS,
  isDeclaredDone as serverIsDeclaredDone,
  isLive as serverIsLive,
  isStalled as serverIsStalled,
} from "../src/server/live";
import { PulseTracker } from "../src/server/pulse";
import { buildSnapshot } from "../src/server/snapshot";
import { rollupFor } from "../src/server/snapshot-programs";
import type { ArchiveStore, CollectedAgent, CmuxSurface } from "../src/server/types";
import type { AgentSnapshot, CmuxNotificationSummary, HubSnapshot } from "../src/shared/types";

const NOW = Date.parse("2026-08-16T16:39:00.000Z");
const CLOSE_AT = "2026-08-16T05:00:10.000Z";
const THRESHOLD = DEFAULT_STALL_THRESHOLD_MS;
const AGENT_ID = "codex:01a008e8-e0ad-7c90-b3b3-2383cb62a6fc";
const SURFACE_ID = "SURFACE-GROK-BOT-PARSER";

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };

const surface: CmuxSurface = {
  workspaceId: "WORKSPACE-PARSER",
  surfaceId: SURFACE_ID,
  paneId: "PANE-PARSER",
  cwd: "/tmp/grok-bot-parser",
  sourceSessionIds: ["01a008e8-e0ad-7c90-b3b3-2383cb62a6fc"],
};

function collected(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: AGENT_ID,
    provider: "codex",
    sourceSessionId: "01a008e8-e0ad-7c90-b3b3-2383cb62a6fc",
    displayName: "Codex · grok-bot-parser",
    cwd: "/tmp/grok-bot-parser",
    status: "waiting",
    statusReason: "Quiet 11h · process live.",
    startedAt: "2026-08-15T17:00:00.000Z",
    updatedAt: iso(NOW - 11 * 60 * 60_000),
    tokens: { provenance: "unknown" },
    lastHumanMessage: null,
    lastUserMessage: "Parse the grok-bot transcript.",
    lastAgentClosing: "Done.",
    lastHumanFacingAt: CLOSE_AT,
    hookLifecycle: "idle",
    hookLifecycleAt: CLOSE_AT,
    processAlive: true,
    processIds: [2155],
    artifacts: [],
    gates: [],
    ...overrides,
  };
}

function completedUnread(overrides: Record<string, unknown> = {}) {
  return {
    id: "NOTICE-COMPLETED",
    surfaceId: SURFACE_ID,
    workspaceId: "WORKSPACE-PARSER",
    createdAt: CLOSE_AT,
    title: "Codex",
    subtitle: "Completed in grok-bot-parser",
    body: "Completed in grok-bot-parser",
    ...overrides,
  };
}

function completedSummary(overrides: Partial<CmuxNotificationSummary> = {}): CmuxNotificationSummary {
  return {
    id: "NOTICE-COMPLETED",
    workspaceId: "WORKSPACE-PARSER",
    surfaceId: SURFACE_ID,
    title: "Codex",
    subtitle: "Completed in grok-bot-parser",
    body: "Completed in grok-bot-parser",
    isRead: true,
    createdAt: CLOSE_AT,
    ...overrides,
  };
}

function snapshotOf(
  source: CollectedAgent,
  input: {
    notifications?: readonly ReturnType<typeof completedUnread>[];
    cmuxNotifications?: readonly CmuxNotificationSummary[];
  } = {},
) {
  return buildSnapshot({
    agents: [source],
    surfaces: [surface],
    archiveStore,
    now: new Date(NOW),
    notifications: input.notifications,
    cmuxNotifications: input.cmuxNotifications,
  });
}

function published(snap: ReturnType<typeof snapshotOf>): AgentSnapshot {
  const agent = snap.programs.flatMap((program) => program.agents).find((row) => row.id === AGENT_ID);
  if (!agent) throw new Error("expected the completed-close row to publish");
  return agent;
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
    programs: [{ id: "parser", name: "grok-bot-parser", agents: [...agents] }],
  };
}

describe("completed cmux close is declaredDone even with a live prompt pid", () => {
  test("unread Completed + idle hook + spoken Done. is done, not waiting, not stalled", () => {
    const snap = snapshotOf(collected(), { notifications: [completedUnread()] });
    const agent = published(snap);

    expect(agent.lifecycle).toBe("waiting");
    expect(agent.processState).toBe("running");
    expect(agent.completedCloseAt).toBe(CLOSE_AT);
    expect(agent.attention).not.toBe(true);
    expect(agent.attentionSignal).toBeUndefined();
    expect(agent.statusReason).not.toMatch(/Unread cmux notification/i);
    expect(agent.statusReason).not.toMatch(/Completed in/i);
    expect(agent.transcriptTail ?? "").not.toContain("[Attention]");

    expect(serverIsDeclaredDone(agent)).toBe(true);
    expect(serverIsLive(agent, NOW, THRESHOLD)).toBe(false);
    expect(serverIsStalled(agent, NOW, THRESHOLD)).toBe(false);
    expect(snap.totals.live).toBe(0);
    expect(snap.totals.needsYou).toBe(0);
    expect(snap.programs[0]?.rollup?.needsYou).toBe(0);
    expect(rollupFor([agent], NOW).needsYou).toBe(0);
  });

  test("a read Completed toast still counts after the overlay is gone", () => {
    const snap = snapshotOf(collected(), { cmuxNotifications: [completedSummary({ isRead: true })] });
    const agent = published(snap);

    expect(agent.completedCloseAt).toBe(CLOSE_AT);
    expect(agent.attention).not.toBe(true);
    expect(serverIsDeclaredDone(agent)).toBe(true);
    expect(serverIsLive(agent, NOW, THRESHOLD)).toBe(false);
    expect(serverIsStalled(agent, NOW, THRESHOLD)).toBe(false);
  });

  test("pulse stalledAgentIds omit the completed-close row", () => {
    const agent = published(snapshotOf(collected(), { notifications: [completedUnread()] }));
    expect(agent.attention).not.toBe(true);
    expect(serverIsDeclaredDone(agent)).toBe(true);
    const tracker = new PulseTracker(undefined, NOW - 60 * 60_000);
    tracker.observe(pulseSnapshot([agent]), NOW);
    expect(tracker.report(NOW).momentum.stalledAgentIds).toEqual([]);
    expect(tracker.report(NOW).momentum.stalled).toBe(0);
  });

  test("hook running, a later user turn, or newer needsInput revives the same pid", () => {
    const closed = snapshotOf(collected(), { notifications: [completedUnread()] });
    expect(serverIsDeclaredDone(published(closed))).toBe(true);

    const running = snapshotOf(collected({
      hookLifecycle: "running",
      hookLifecycleAt: iso(NOW - 30_000),
      updatedAt: iso(NOW - 30_000),
      status: "running",
      statusReason: "Hook is running on the same pid.",
    }), {
      notifications: [completedUnread()],
    });
    const runningAgent = published(running);
    expect(runningAgent.completedCloseAt).toBe(CLOSE_AT);
    expect(serverIsDeclaredDone(runningAgent)).toBe(false);
    expect(serverIsLive(runningAgent, NOW, THRESHOLD)).toBe(true);

    const laterTurn = snapshotOf(collected({
      lastUserFacingAt: iso(NOW - 60_000),
      updatedAt: iso(NOW - 60_000),
      statusReason: "New user turn on the same prompt.",
    }), {
      cmuxNotifications: [completedSummary({ isRead: true })],
    });
    const laterAgent = published(laterTurn);
    expect(laterAgent.completedCloseAt).toBe(CLOSE_AT);
    expect(serverIsDeclaredDone(laterAgent)).toBe(false);
    expect(serverIsLive(laterAgent, NOW, THRESHOLD)).toBe(true);

    const asking = snapshotOf(collected({
      hookLifecycle: "needsInput",
      hookLifecycleAt: iso(NOW - 10_000),
      lastAgentClosing: "Should I start the next parser pass?",
    }), { cmuxNotifications: [completedSummary({ isRead: true })] });
    const askingAgent = published(asking);
    expect(serverIsDeclaredDone(askingAgent)).toBe(false);
    expect(serverIsLive(askingAgent, NOW, THRESHOLD)).toBe(true);
    expect(asking.totals.needsYou).toBe(1);
  });

  test("a permission toast is still an overlay; Completed never is", () => {
    const asking = snapshotOf(collected({ lastAgentClosing: "Need approval to write." }), {
      notifications: [{
        id: "NOTICE-PERMISSION",
        surfaceId: SURFACE_ID,
        workspaceId: "WORKSPACE-PARSER",
        createdAt: CLOSE_AT,
        title: "Codex",
        subtitle: "Permission required",
        body: "Allow write access to /tmp/grok-bot-parser?",
      }],
    });
    expect(published(asking).attention).toBe(true);
    expect(published(asking).completedCloseAt).toBeUndefined();
    expect(serverIsDeclaredDone(published(asking))).toBe(false);
  });
});

describe("client declaredDone / operatorState / rollup match the server", () => {
  let M: {
    declaredDone: (agent: AgentSnapshot) => boolean;
    isLive: (agent: AgentSnapshot, nowMs?: number, thresholdMs?: number) => boolean;
    isStalled: (agent: AgentSnapshot, nowMs?: number, thresholdMs?: number) => boolean;
    operatorState: (agent: AgentSnapshot, nowMs?: number, thresholdMs?: number) => string | null;
    viewMatches: (view: string, agent: AgentSnapshot) => boolean;
    deriveRollup: (agents: AgentSnapshot[], nowMs?: number, thresholdMs?: number) => { needsYou: number; live: number };
    alerting: (agent: AgentSnapshot) => boolean;
  };

  beforeAll(async () => {
    // @ts-expect-error browser client has no declaration
    await import("../src/web/app.js");
    M = (globalThis as unknown as { TheAntHill: typeof M }).TheAntHill;
  });

  test("the live 11h Codex fixture leaves the waiting board as Done", () => {
    const agent = published(snapshotOf(collected(), { notifications: [completedUnread()] }));

    expect(M.declaredDone(agent)).toBe(serverIsDeclaredDone(agent));
    expect(M.declaredDone(agent)).toBe(true);
    expect(M.operatorState(agent, NOW, THRESHOLD)).toBe("done");
    expect(M.isLive(agent, NOW, THRESHOLD)).toBe(false);
    expect(M.isStalled(agent, NOW, THRESHOLD)).toBe(false);
    expect(M.viewMatches("board", agent)).toBe(false);
    expect(M.alerting(agent)).toBe(false);
    expect(M.deriveRollup([agent], NOW, THRESHOLD)).toMatchObject({ live: 0, needsYou: 0 });
    expect(M.deriveRollup([agent], NOW, THRESHOLD).live).toBe(rollupFor([agent], NOW).live);
  });

  test("a later user turn on the same pid returns it to the live board", () => {
    const agent = published(snapshotOf(collected({
      lastUserFacingAt: iso(NOW - 60_000),
      updatedAt: iso(NOW - 60_000),
      statusReason: "New user turn on the same prompt.",
    }), {
      cmuxNotifications: [completedSummary({ isRead: true })],
    }));

    expect(M.declaredDone(agent)).toBe(false);
    const revived = M.operatorState(agent, NOW, THRESHOLD);
    expect(revived === "waiting" || revived === "working").toBe(true);
    expect(M.isLive(agent, NOW, THRESHOLD)).toBe(true);
    expect(M.viewMatches("board", agent)).toBe(true);
    expect(M.declaredDone(agent)).toBe(serverIsDeclaredDone(agent));
    expect(M.isLive(agent, NOW, THRESHOLD)).toBe(serverIsLive(agent, NOW, THRESHOLD));
  });
});
