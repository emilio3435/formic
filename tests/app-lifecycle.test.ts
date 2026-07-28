import { describe, expect, test } from "bun:test";
import {
  createMountainFetch,
  emptySnapshot,
  MAX_SSE_BACKLOG_BYTES,
  MAX_SSE_CLIENTS,
  type MountainAppState,
} from "../src/server/app";
import { MemoryTriageQueueStore } from "../src/server/triage";
import type { AgentSnapshot, HubSnapshot, OperatorIssue } from "../src/shared/types";
import type { ArchiveStore, CommandRunner } from "../src/server/types";

function lifecycleSnapshot(generatedAt = new Date().toISOString()): HubSnapshot {
  const agent: AgentSnapshot = {
    id: "codex:control",
    provider: "codex",
    sourceSessionId: "control",
    displayName: "Control fixture",
    programId: "fixture",
    status: "running",
    statusReason: "Fixture is active.",
    lastHumanMessage: null,
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
    generatedAt,
    controlHealth: { cmuxReachable: true, lastCheckedAt: generatedAt, errors: [], staleSources: [] },
    totals: { live: 1, tracked: 1, attention: 0 },
    issues: [issue],
    programs: [{ id: "fixture", name: "Fixture", agents: [agent] }],
  };
}

describe("SSE lifecycle", () => {
  test("control requests use the runtime cmux executable override", async () => {
    const current = lifecycleSnapshot();
    const controlAgent = current.programs[0]!.agents[0]!;
    controlAgent.controls = [{ action: "instruct", enabled: true }];
    const state: MountainAppState = {
      get: () => current,
      subscribe: () => () => {},
      refresh: async () => current,
    };
    const commands: string[][] = [];
    const runner: CommandRunner = {
      run: async (command) => {
        commands.push([...command]);
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
      },
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    const fetch = createMountainFetch({
      state,
      runner,
      archiveStore,
      cmuxExecutable: "/opt/cmux/bin/cmux",
      webRoot: import.meta.dir,
    });

    const response = await fetch(new Request("http://127.0.0.1:4701/api/control", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:4701", "content-type": "application/json" },
      body: JSON.stringify({
        action: "instruct",
        agentId: controlAgent.id,
        instruction: "Continue.",
      }),
    }));

    expect(response.status).toBe(200);
    expect(commands.map((command) => command[0])).toEqual([
      "/opt/cmux/bin/cmux",
      "/opt/cmux/bin/cmux",
    ]);
    fetch.dispose();
  });

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

  test("event streams keep the full snapshot wire contract on accepted state changes", async () => {
    const initial = emptySnapshot();
    let listener: ((snapshot: HubSnapshot) => void) | undefined;
    const state: MountainAppState = {
      get: () => initial,
      subscribe(next) {
        listener = next;
        return () => {};
      },
      refresh: async () => initial,
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    const fetch = createMountainFetch({ state, runner, archiveStore, webRoot: import.meta.dir });
    const response = await fetch(new Request("http://127.0.0.1:4701/api/events"));
    const reader = response.body!.getReader();
    await reader.read();

    const changed = {
      ...initial,
      totals: { ...initial.totals, tracked: initial.totals.tracked + 1 },
    };
    listener!(changed);
    const event = String((await reader.read()).value);

    expect(event).toStartWith("event: snapshot\ndata: ");
    expect(JSON.parse(event.split("\ndata: ")[1]!.trim())).toEqual(changed);
    fetch.dispose();
  });

  test("event streams reject clients beyond the admission cap", async () => {
    const state: MountainAppState = {
      get: emptySnapshot,
      subscribe: () => () => {},
      refresh: async () => emptySnapshot(),
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    const fetch = createMountainFetch({ state, runner, archiveStore, webRoot: import.meta.dir });

    const admitted = await Promise.all(
      Array.from(
        { length: MAX_SSE_CLIENTS },
        () => fetch(new Request("http://127.0.0.1:4701/api/events")),
      ),
    );
    const rejected = await fetch(new Request("http://127.0.0.1:4701/api/events"));

    expect(admitted.every((response) => response.status === 200)).toBe(true);
    expect(rejected.status).toBe(503);
    expect(await rejected.text()).toBe("Too many event streams");
    fetch.dispose();
  });

  test("a stalled event stream is dropped before another snapshot can grow its backlog", async () => {
    const initial = lifecycleSnapshot();
    initial.programs[0]!.agents[0]!.statusReason = "x".repeat(MAX_SSE_BACKLOG_BYTES);
    let listener: ((snapshot: HubSnapshot) => void) | undefined;
    const state: MountainAppState = {
      get: () => initial,
      subscribe(next) {
        listener = next;
        return () => {};
      },
      refresh: async () => initial,
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    const fetch = createMountainFetch({ state, runner, archiveStore, webRoot: import.meta.dir });
    const response = await fetch(new Request("http://127.0.0.1:4701/api/events"));

    listener!({
      ...initial,
      programs: [{
        ...initial.programs[0]!,
        agents: [{ ...initial.programs[0]!.agents[0]!, statusReason: "changed" }],
      }],
    });

    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    expect((await reader.read()).done).toBe(true);
    fetch.dispose();
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
  test("POST /api/recollect returns the fresh snapshot after one full refresh", async () => {
    const cached = lifecycleSnapshot();
    const fresh = { ...cached, generatedAt: "2026-07-22T06:01:00.000Z" };
    const refreshOptions: Array<{ cmux?: boolean } | undefined> = [];
    const state: MountainAppState = {
      get: () => cached,
      subscribe: () => () => {},
      refresh: async (options) => {
        refreshOptions.push(options);
        return fresh;
      },
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    const fetch = createMountainFetch({ state, runner, archiveStore, webRoot: import.meta.dir });

    const response = await fetch(new Request("http://127.0.0.1:4701/api/recollect", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:4701" },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(fresh);
    expect(refreshOptions).toEqual([{ cmux: true }]);
    fetch.dispose();
  });

  test("concurrent POST /api/recollect requests share one in-flight refresh", async () => {
    const cached = lifecycleSnapshot();
    const fresh = { ...cached, generatedAt: "2026-07-22T06:02:00.000Z" };
    let releaseRefresh!: (snapshot: HubSnapshot) => void;
    const refreshPromise = new Promise<HubSnapshot>((resolve) => {
      releaseRefresh = resolve;
    });
    let refreshCalls = 0;
    const state: MountainAppState = {
      get: () => cached,
      subscribe: () => () => {},
      refresh: async () => {
        refreshCalls += 1;
        return refreshPromise;
      },
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    const fetch = createMountainFetch({ state, runner, archiveStore, webRoot: import.meta.dir });

    const firstResponse = fetch(new Request("http://127.0.0.1:4701/api/recollect", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:4701" },
    }));
    const secondResponse = fetch(new Request("http://127.0.0.1:4701/api/recollect", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:4701" },
    }));
    releaseRefresh(fresh);
    const [first, second] = await Promise.all([firstResponse, secondResponse]);

    expect(refreshCalls).toBe(1);
    expect(await first.json()).toEqual(fresh);
    expect(await second.json()).toEqual(fresh);
    fetch.dispose();
  });
  test("POST /api/recollect rejects cross-origin requests without refreshing", async () => {
    let refreshCalls = 0;
    const state: MountainAppState = {
      get: emptySnapshot,
      subscribe: () => () => {},
      refresh: async () => {
        refreshCalls += 1;
        return emptySnapshot();
      },
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    const fetch = createMountainFetch({ state, runner, archiveStore, webRoot: import.meta.dir });

    const response = await fetch(new Request("http://127.0.0.1:4701/api/recollect", {
      method: "POST",
      headers: { origin: "http://evil.example" },
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: "ORIGIN_REJECTED",
        message: "Recollect requests require an exact same-origin loopback Origin header.",
      },
    });
    expect(refreshCalls).toBe(0);
    fetch.dispose();
  });

  test("failed POST /api/recollect returns the error envelope and allows a retry", async () => {
    const fresh = lifecycleSnapshot();
    let refreshCalls = 0;
    const state: MountainAppState = {
      get: () => fresh,
      subscribe: () => () => {},
      refresh: async () => {
        refreshCalls += 1;
        if (refreshCalls === 1) throw new Error("collector failed");
        return fresh;
      },
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    const fetch = createMountainFetch({ state, runner, archiveStore, webRoot: import.meta.dir });
    const request = () => fetch(new Request("http://127.0.0.1:4701/api/recollect", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:4701" },
    }));

    const failed = await request();
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      ok: false,
      error: { code: "RECOLLECT_FAILED", message: "collector failed" },
    });
    expect(refreshCalls).toBe(1);

    const recovered = await request();
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual(fresh);
    expect(refreshCalls).toBe(2);
    fetch.dispose();
  });
});
