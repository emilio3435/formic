import { describe, expect, test } from "bun:test";
import { buildSnapshot } from "../src/server/snapshot";
import type { ArchiveStore, CollectedAgent } from "../src/server/types";

/* Live :4701 2026-08-16 ~16:39Z. Two cooper-scheduler Claudes shared one
   displayName and one attention title while carrying leftover launch-env
   identity. They are different models and different threads. Merging them
   would hide one of the two needs-you sessions.

   #10 — authoredBy launch-env must not outrank the current resumed-pane task.
   #16 — two live sessions must not paint as identical twins; issue titles
   stay 1:1 with a session. Same title + same openedAt on two ids is a bug. */

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
const NOW = "2026-08-16T10:41:58.491Z";
const CWD = "/Users/ant/Developer/cooper-scheduler";

const FIRST_ID = "09958d2e-5c72-4111-a5c7-95a0fdb767c0";
const SECOND_ID = "e2fc869c-02dd-46fb-836b-4c4e14d9b744";

function claudeTwin(overrides: Partial<CollectedAgent> & { sourceSessionId: string }): CollectedAgent {
  return {
    id: `claude:${overrides.sourceSessionId}`,
    provider: "claude",
    displayName: "Claude · cooper-scheduler",
    identity: {
      name: "Claude · cooper-scheduler",
      base: "Claude · cooper-scheduler",
      source: "origin-cwd",
    },
    cwd: CWD,
    originCwd: CWD,
    status: "attention",
    statusReason: "Unread cmux notification: Claude Code — Waiting.",
    updatedAt: "2026-08-16T10:31:00.000Z",
    tokens: { total: 1, provenance: "observed" },
    artifacts: [],
    gates: [],
    ...overrides,
  };
}

function snapshotAgents(input: Parameters<typeof buildSnapshot>[0]) {
  const snapshot = buildSnapshot(input);
  return {
    snapshot,
    agents: snapshot.programs.flatMap((program) => program.agents),
    agentIssues: (snapshot.issues ?? []).filter((issue) => issue.kind === "agent"),
  };
}

describe("two live Claude sessions that share a cwd stay two sessions", () => {
  test("sharing displayName still publishes distinct ids, names, and issue titles", () => {
    const { snapshot, agents, agentIssues } = snapshotAgents({
      agents: [
        claudeTwin({
          sourceSessionId: FIRST_ID,
          model: "claude-fable-5",
          startedAt: "2026-08-10T10:31:00.000Z",
          lastThreadAt: "2026-08-16T10:31:00.000Z",
        }),
        claudeTwin({
          sourceSessionId: SECOND_ID,
          model: "claude-opus-5",
          startedAt: "2026-08-10T02:43:00.000Z",
          lastThreadAt: "2026-08-16T02:43:00.000Z",
        }),
      ],
      surfaces: [],
      archiveStore,
      now: new Date(NOW),
    });

    expect(agents.map((agent) => agent.id).sort()).toEqual([
      `claude:${FIRST_ID}`,
      `claude:${SECOND_ID}`,
    ]);
    expect(new Set(agents.map((agent) => agent.identity?.name)).size).toBe(2);
    expect(agentIssues).toHaveLength(2);
    expect(new Set(agentIssues.map((issue) => issue.title)).size).toBe(2);
    expect(new Set(agentIssues.map((issue) => `${issue.title}|${issue.lifecycle?.openedAt}`)).size).toBe(2);
    for (const issue of agentIssues) {
      expect(issue.affectedAgentIds).toHaveLength(1);
      const agent = agents.find((candidate) => candidate.id === issue.affectedAgentIds[0]);
      expect(issue.title).toBe(`${agent?.identity?.name} needs review`);
    }
    expect(snapshot.programs.flatMap((program) => program.agents)).toHaveLength(2);
  });

  test("stale launch-env plus a later task publishes the current task, still as two rows", () => {
    const { agents, agentIssues } = snapshotAgents({
      agents: [
        claudeTwin({
          sourceSessionId: FIRST_ID,
          model: "claude-fable-5",
          task: "Ship the current cooper-scheduler review",
        }),
        claudeTwin({
          sourceSessionId: SECOND_ID,
          model: "claude-opus-5",
          task: "Clarify the scheduling hub empty states",
        }),
      ],
      sessionNames: (id) => id === `claude:${FIRST_ID}`
        ? { name: "System Cleanup and Initialization", by: "launch-env", at: "2026-07-01T00:00:00.000Z" }
        : { name: "Scheduling Hub Clarity and User Experience Improvements", by: "launch-env", at: "2026-07-02T00:00:00.000Z" },
      surfaces: [],
      archiveStore,
      now: new Date(NOW),
    });

    expect(agents).toHaveLength(2);
    expect(agents.map((agent) => agent.id).sort()).toEqual([
      `claude:${FIRST_ID}`,
      `claude:${SECOND_ID}`,
    ]);
    expect(agents.find((agent) => agent.id === `claude:${FIRST_ID}`)?.identity).toMatchObject({
      name: "Ship the current cooper-scheduler review",
      source: "task",
    });
    expect(agents.find((agent) => agent.id === `claude:${SECOND_ID}`)?.identity).toMatchObject({
      name: "Clarify the scheduling hub empty states",
      source: "task",
    });
    for (const agent of agents) {
      expect(agent.identity?.authoredBy).not.toBe("launch-env");
      expect(agent.identity?.name).not.toContain("System Cleanup");
      expect(agent.identity?.name).not.toContain("Scheduling Hub Clarity");
    }
    expect(new Set(agentIssues.map((issue) => issue.title)).size).toBe(2);
    expect(agentIssues.map((issue) => issue.title).sort()).toEqual([
      "Clarify the scheduling hub empty states needs review",
      "Ship the current cooper-scheduler review needs review",
    ]);
  });
});
