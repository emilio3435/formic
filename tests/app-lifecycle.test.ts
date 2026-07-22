import { describe, expect, test } from "bun:test";
import { createMountainFetch, emptySnapshot, type MountainAppState } from "../src/server/app";
import { MemoryTriageQueueStore } from "../src/server/triage";
import type { AgentSnapshot, HubSnapshot, OperatorIssue } from "../src/shared/types";
import type { ArchiveStore, CommandRunner } from "../src/server/types";

function lifecycleSnapshot(): HubSnapshot {
  const agent: AgentSnapshot = {
    id: "codex:control",
    provider: "codex",
    sourceSessionId: "control",
    displayName: "Control fixture",
    programId: "fixture",
    status: "running",
    statusReason: "Fixture is active.",
    updatedAt: "2026-07-22T06:00:00.000Z",
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    target: { resolution: "exact", surfaceId: "surface-1" },
    controls: [{ action: "archive", enabled: true }],
  };
  const issue: OperatorIssue = {
    id: "agent:codex:control",
    kind: "agent",
    severity: "warning",
    title: "Control fixture needs review",
    summary: "The fixture is waiting for source confirmation.",
    affectedAgentIds: [agent.id],
  };
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-22T06:00:00.000Z",
    controlHealth: { cmuxReachable: true, lastCheckedAt: "2026-07-22T06:00:00.000Z", errors: [], staleSources: [] },
    totals: { live: 1, tracked: 1, attention: 0 },
    issues: [issue],
    programs: [{ id: "fixture", name: "Fixture", agents: [agent] }],
  };
}

describe("SSE lifecycle", () => {
  test("disposing the app unsubscribes state, closes active streams, and rejects new clients", async () => {
    const listeners = new Set<(snapshot: ReturnType<typeof emptySnapshot>) => void>();
    const state: MountainAppState = {
      get: emptySnapshot,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      refresh: async () => emptySnapshot(),
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    const fetch = createMountainFetch({ state, runner, archiveStore, webRoot: import.meta.dir });
    const response = await fetch(new Request("http://127.0.0.1:4701/api/events"));
    const reader = response.body!.getReader();

    expect(response.status).toBe(200);
    expect((await reader.read()).done).toBe(false);
    expect(listeners.size).toBe(1);

    fetch.dispose();
    expect((await reader.read()).done).toBe(true);
    expect(listeners.size).toBe(0);
    expect((await fetch(new Request("http://127.0.0.1:4701/api/events"))).status).toBe(503);

    expect(() => fetch.dispose()).not.toThrow();
  });

  test("successful control and triage actions mark verification and force a fresh cmux refresh", async () => {
    const listeners = new Set<(snapshot: HubSnapshot) => void>();
    const current = lifecycleSnapshot();
    const marked: string[] = [];
    const refreshOptions: Array<{ cmux?: boolean } | undefined> = [];
    const state: MountainAppState = {
      get: () => current,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      refresh: async (options) => {
        refreshOptions.push(options);
        return current;
      },
      markIssueVerifying: (issueId) => { marked.push(issueId); },
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    const triageStore = new MemoryTriageQueueStore();
    const fetch = createMountainFetch({ state, runner, archiveStore, triageStore, webRoot: import.meta.dir });

    const control = await fetch(new Request("http://127.0.0.1:4701/api/control", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:4701", "content-type": "application/json" },
      body: JSON.stringify({ action: "archive", agentId: "codex:control" }),
    }));
    expect(control.status).toBe(200);

    const triage = await fetch(new Request("http://127.0.0.1:4701/api/triage/queue", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:4701", "content-type": "application/json" },
      body: JSON.stringify({ issueId: "agent:codex:control" }),
    }));
    expect(triage.status).toBe(200);
    expect(marked).toEqual(["agent:codex:control", "agent:codex:control"]);
    expect(refreshOptions).toEqual([{ cmux: true }, { cmux: true }]);
    expect(listeners.size).toBe(1);

    fetch.dispose();
  });
});
