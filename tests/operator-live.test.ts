import { beforeAll, describe, expect, test } from "bun:test";
import {
  DEFAULT_STALL_THRESHOLD_MS,
  isLive as serverIsLive,
  isStalled as serverIsStalled,
} from "../src/server/live";
import { buildSnapshot } from "../src/server/snapshot";
import { rollupFor } from "../src/server/snapshot-programs";
import type { ArchiveStore, CollectedAgent } from "../src/server/types";
import type { AgentSnapshot } from "../src/shared/types";

const NOW = Date.parse("2026-08-16T12:00:00.000Z");
const THRESHOLD = DEFAULT_STALL_THRESHOLD_MS;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function serverAgent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
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
    scope: "observed",
    outcome: "healthy",
    updatedAt: iso(NOW - 5 * 60_000),
    tokens: { provenance: "unknown" },
    lastHumanMessage: null,
    artifacts: [],
    gates: [],
    target: { resolution: "missing" },
    controls: [],
    ...overrides,
  };
}

describe("server live / stall predicate", () => {
  test("working is live; fresh waiting is live; 28h waiting is stalled and not live", () => {
    const working = serverAgent({
      id: "working",
      lifecycle: "working",
      activity: "working",
      status: "running",
      updatedAt: iso(NOW - 60_000),
    });
    const fresh = serverAgent({
      id: "fresh",
      updatedAt: iso(NOW - 5 * 60_000),
    });
    const zombie = serverAgent({
      id: "zombie",
      provenance: "process-live-quiet",
      processState: "running",
      updatedAt: iso(NOW - 28 * 60 * 60_000),
    });

    expect(serverIsLive(working, NOW, THRESHOLD)).toBe(true);
    expect(serverIsStalled(working, NOW, THRESHOLD)).toBe(false);

    expect(serverIsLive(fresh, NOW, THRESHOLD)).toBe(true);
    expect(serverIsStalled(fresh, NOW, THRESHOLD)).toBe(false);

    expect(serverIsStalled(zombie, NOW, THRESHOLD)).toBe(true);
    expect(serverIsLive(zombie, NOW, THRESHOLD)).toBe(false);
  });

  test("needs-you is live; declaredDone is not; processAlive does not rescue stalled or finished", () => {
    const asking = serverAgent({
      id: "ask",
      attentionSignal: { kind: "question-pending" },
      updatedAt: iso(NOW - 28 * 60 * 60_000),
    });
    const done = serverAgent({
      id: "done",
      taskState: "done",
      lifecycle: "waiting",
      processState: "running",
    });
    const finished = serverAgent({
      id: "finished",
      lifecycle: "finished",
      activity: "ended",
      processState: "running",
    });

    expect(serverIsStalled(asking, NOW, THRESHOLD)).toBe(false);
    expect(serverIsLive(asking, NOW, THRESHOLD)).toBe(true);
    expect(serverIsLive(done, NOW, THRESHOLD)).toBe(false);
    expect(serverIsLive(finished, NOW, THRESHOLD)).toBe(false);
  });

  test("turn-complete long quiet is waiting, not stalled", () => {
    const turnDone = serverAgent({
      id: "turn-done",
      provenance: "turn-complete",
      updatedAt: iso(NOW - 28 * 60 * 60_000),
    });
    expect(serverIsStalled(turnDone, NOW, THRESHOLD)).toBe(false);
    expect(serverIsLive(turnDone, NOW, THRESHOLD)).toBe(true);
  });
});

describe("client live / stall / operatorState (mirrors server)", () => {
  let M: any;

  beforeAll(async () => {
    // @ts-expect-error browser client has no declaration
    await import("../src/web/app.js");
    M = (globalThis as any).TheAntHill;
  });

  function clientAgent(overrides: Record<string, unknown> = {}) {
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
      scope: "observed",
      outcome: "healthy",
      updatedAt: iso(NOW - 5 * 60_000),
      tokens: { provenance: "unknown" },
      artifacts: [],
      gates: [],
      target: { resolution: "missing" },
      controls: [],
      ...overrides,
    };
  }

  test("matrix: working live; fresh waiting live; 28h waiting stalled and not live", () => {
    const working = clientAgent({ lifecycle: "working", activity: "working", status: "running" });
    const fresh = clientAgent({ updatedAt: iso(NOW - 5 * 60_000) });
    const zombie = clientAgent({
      provenance: "process-live-quiet",
      processState: "running",
      updatedAt: iso(NOW - 28 * 60 * 60_000),
    });

    expect(M.isLive(working, NOW, THRESHOLD)).toBe(true);
    expect(M.operatorState(working, NOW, THRESHOLD)).toBe("working");

    expect(M.isLive(fresh, NOW, THRESHOLD)).toBe(true);
    expect(M.isStalled(fresh, NOW, THRESHOLD)).toBe(false);
    expect(M.operatorState(fresh, NOW, THRESHOLD)).toBe("waiting");

    expect(M.isStalled(zombie, NOW, THRESHOLD)).toBe(true);
    expect(M.isLive(zombie, NOW, THRESHOLD)).toBe(false);
    expect(M.operatorState(zombie, NOW, THRESHOLD)).toBe("stalled");
    expect(M.viewMatches("board", zombie)).toBe(true);
    expect(M.rowStateWords("idle", "healthy", "board", zombie, false, NOW, THRESHOLD)).toEqual(["Stalled"]);
  });

  test("needs-you is live and amber-worded; done and process-alive finished are not live", () => {
    const asking = clientAgent({
      hookLifecycle: "needsInput",
      updatedAt: iso(NOW - 28 * 60 * 60_000),
    });
    const done = clientAgent({ taskState: "done", processState: "running" });
    const finished = clientAgent({
      lifecycle: "finished",
      activity: "ended",
      processState: "running",
    });

    expect(M.operatorState(asking, NOW, THRESHOLD)).toBe("needs-you");
    expect(M.isLive(asking, NOW, THRESHOLD)).toBe(true);
    expect(M.rowStateWords("idle", "healthy", "board", asking, false, NOW, THRESHOLD)).toEqual(["Needs you"]);

    expect(M.isLive(done, NOW, THRESHOLD)).toBe(false);
    expect(M.operatorState(done, NOW, THRESHOLD)).toBe("done");
    expect(M.viewMatches("board", done)).toBe(false);

    expect(M.isLive(finished, NOW, THRESHOLD)).toBe(false);
    expect(M.viewMatches("board", finished)).toBe(false);
  });

  test("client and server agree on the same fixtures", () => {
    const fixtures: Array<Partial<AgentSnapshot> & Record<string, unknown>> = [
      { id: "w", lifecycle: "working", activity: "working", status: "running", updatedAt: iso(NOW - 60_000) },
      { id: "fresh", lifecycle: "waiting", activity: "idle", updatedAt: iso(NOW - 5 * 60_000) },
      { id: "zombie", lifecycle: "waiting", activity: "idle", provenance: "process-live-quiet", updatedAt: iso(NOW - 28 * 60 * 60_000) },
      { id: "ask", lifecycle: "waiting", activity: "idle", hookLifecycle: "needsInput", updatedAt: iso(NOW - 28 * 60 * 60_000) },
      { id: "done", lifecycle: "waiting", activity: "idle", taskState: "done" },
      { id: "fin", lifecycle: "finished", activity: "ended", processState: "running" },
    ];
    for (const overrides of fixtures) {
      const s = serverAgent(overrides as Partial<AgentSnapshot>);
      const c = clientAgent(overrides);
      expect(M.isLive(c, NOW, THRESHOLD), String(overrides.id)).toBe(serverIsLive(s, NOW, THRESHOLD));
      expect(M.isStalled(c, NOW, THRESHOLD), String(overrides.id)).toBe(serverIsStalled(s, NOW, THRESHOLD));
    }
  });
});

describe("snapshot totals and rollup consume the same live predicate", () => {
  const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };

  function collected(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
    return {
      id: "codex:test",
      provider: "codex",
      sourceSessionId: "test",
      displayName: "Test session",
      cwd: "/tmp/project",
      status: "waiting",
      statusReason: "Fixture.",
      updatedAt: iso(NOW - 5 * 60_000),
      tokens: { provenance: "unknown" },
      artifacts: [],
      gates: [],
      ...overrides,
    } as CollectedAgent;
  }

  test("rollup.live and totals.live drop a process-alive stalled waiter", () => {
    const now = new Date(NOW);
    const working = collected({
      id: "codex:w",
      sourceSessionId: "w",
      status: "running",
      updatedAt: iso(NOW - 60_000),
    });
    const fresh = collected({
      id: "codex:f",
      sourceSessionId: "f",
      status: "waiting",
      updatedAt: iso(NOW - 5 * 60_000),
    });
    const zombie = collected({
      id: "codex:z",
      sourceSessionId: "z",
      status: "waiting",
      updatedAt: iso(NOW - 28 * 60 * 60_000),
      processAlive: true,
      processIds: [4242],
    });
    const snap = buildSnapshot({
      agents: [working, fresh, zombie],
      surfaces: [],
      archiveStore,
      now,
    });
    const published = snap.programs.flatMap((program) => program.agents);
    const publishedZombie = published.find((agent) => agent.id === "codex:z");

    expect(publishedZombie?.lifecycle).toBe("waiting");
    expect(publishedZombie && serverIsLive(publishedZombie, NOW, THRESHOLD)).toBe(false);
    expect(publishedZombie && serverIsStalled(publishedZombie, NOW, THRESHOLD)).toBe(true);

    const rollup = rollupFor(published, NOW);
    expect(rollup.live).toBe(2);
    expect(rollup.idle).toBeGreaterThanOrEqual(1);
    expect(snap.totals.live).toBe(2);
    expect(snap.totals.live).toBe(rollup.live);
    expect(snap.totals.live).toBeLessThan((snap.totals.working ?? 0) + (snap.totals.idle ?? 0));
  });
});
