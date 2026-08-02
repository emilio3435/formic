import { describe, expect, test } from "bun:test";
import {
  createMountainFetch,
  emptySnapshot,
  MAX_HEALTH_SNAPSHOT_AGE_MS,
  MAX_SSE_BACKLOG_BYTES,
  MAX_SSE_CLIENTS,
  type MountainAppState,
} from "../src/server/app";
import { MemoryAttentionStore } from "../src/server/cmux";
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

describe("health endpoint", () => {
  test("reports cached snapshot freshness without waiting for a wedged refresh", async () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    let current = lifecycleSnapshot(new Date(now - MAX_HEALTH_SNAPSHOT_AGE_MS).toISOString());
    let refreshes = 0;
    const state: MountainAppState = {
      get: () => current,
      subscribe: () => () => {},
      refresh: () => {
        refreshes += 1;
        return new Promise(() => {});
      },
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    const fetch = createMountainFetch({
      state,
      runner,
      archiveStore,
      now: () => now,
      webRoot: import.meta.dir,
    });

    const healthy = await fetch(new Request("http://127.0.0.1:4701/api/health"));
    expect(healthy.status).toBe(200);
    expect(await healthy.json()).toEqual({
      ok: true,
      verdict: "healthy",
      snapshot: {
        generatedAt: current.generatedAt,
        ageMs: MAX_HEALTH_SNAPSHOT_AGE_MS,
        maxAgeMs: MAX_HEALTH_SNAPSHOT_AGE_MS,
      },
      data: { complete: true, staleSources: [], cmuxReachable: true, controlErrors: 0 },
    });

    current = lifecycleSnapshot(new Date(now - MAX_HEALTH_SNAPSHOT_AGE_MS - 1).toISOString());
    const stale = await fetch(new Request("http://127.0.0.1:4701/api/health"));
    expect(stale.status).toBe(503);
    expect(await stale.json()).toMatchObject({
      ok: false,
      verdict: "stale",
      snapshot: {
        generatedAt: current.generatedAt,
        ageMs: MAX_HEALTH_SNAPSHOT_AGE_MS + 1,
      },
    });
    expect(refreshes).toBe(0);
    fetch.dispose();
  });

  /* A collector that times out still leaves a freshly generated snapshot, so
     the age check alone answered "healthy" over a board missing a provider. The
     process really is live, so `ok` must stay true and the supervisor must not
     restart it — but a monitor has to be able to see that the DATA is partial. */
  test("a fresh snapshot with a failed collector stays live but reports incomplete data", async () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    const degraded = lifecycleSnapshot(new Date(now).toISOString());
    degraded.controlHealth = {
      cmuxReachable: true,
      lastCheckedAt: new Date(now).toISOString(),
      errors: ["codex sessions: EACCES"],
      staleSources: ["codex"],
    };
    const state: MountainAppState = {
      get: () => degraded,
      subscribe: () => () => {},
      refresh: async () => degraded,
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    const fetch = createMountainFetch({
      state, runner, archiveStore, now: () => now, webRoot: import.meta.dir,
    });

    const response = await fetch(new Request("http://127.0.0.1:4701/api/health"));
    const body = await response.json();

    // The process is alive and the snapshot is current: do not flap the service.
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.verdict).toBe("healthy");
    // But the board is missing codex, and a monitor must be able to tell.
    expect(body.data.complete).toBe(false);
    expect(body.data.staleSources).toEqual(["codex"]);
    expect(body.data.controlErrors).toBe(1);
    fetch.dispose();
  });

  test("unreadable operator state makes the board incomplete without killing the process", async () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    const current = lifecycleSnapshot(new Date(now).toISOString());
    const state: MountainAppState = {
      get: () => current,
      subscribe: () => () => {},
      refresh: async () => current,
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    // A store whose acknowledged notifications failed to load: everything the
    // operator already dismissed is unread again.
    const attentionStore = new MemoryAttentionStore(() => now);
    attentionStore.loadError = () => "attention state could not be read, so acknowledged notifications are unread again: bad JSON";
    const fetch = createMountainFetch({
      state, runner, archiveStore, attentionStore, now: () => now, webRoot: import.meta.dir,
    });

    const body = await (await fetch(new Request("http://127.0.0.1:4701/api/health"))).json();

    expect(body.ok).toBe(true); // the process is fine
    expect(body.data.complete).toBe(false); // what it is showing is not
    expect(body.data.operatorStateError).toContain("unread again");
    fetch.dispose();
  });

  test("an unreachable control plane is incomplete data, not a dead process", async () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    const offline = lifecycleSnapshot(new Date(now).toISOString());
    offline.controlHealth = {
      cmuxReachable: false,
      lastCheckedAt: new Date(now).toISOString(),
      errors: ["cmux unreachable"],
      staleSources: [],
    };
    const state: MountainAppState = {
      get: () => offline,
      subscribe: () => () => {},
      refresh: async () => offline,
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    const fetch = createMountainFetch({
      state, runner, archiveStore, now: () => now, webRoot: import.meta.dir,
    });

    const body = await (await fetch(new Request("http://127.0.0.1:4701/api/health"))).json();
    expect(body.ok).toBe(true);
    expect(body.data.complete).toBe(false);
    expect(body.data.cmuxReachable).toBe(false);
    fetch.dispose();
  });

  test("rejects a non-loopback Host before exposing health", async () => {
    const current = lifecycleSnapshot();
    const state: MountainAppState = {
      get: () => current,
      subscribe: () => () => {},
      refresh: async () => current,
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    const fetch = createMountainFetch({ state, runner, archiveStore, webRoot: import.meta.dir });

    const response = await fetch(new Request("http://ant-hill.example/api/health"));

    expect(response.status).toBe(403);
    fetch.dispose();
  });
});

/* /api/health reads state.get() while /api/snapshot serves a cached object the
   subscriber only replaced on a material change. Because the fingerprint drops
   generatedAt, lastCheckedAt and elapsedMs, a quiet fleet froze the served
   snapshot while health kept measuring a newer one — health could report "fresh"
   for a snapshot nobody was being given. */
describe("snapshot freshness", () => {
  test("a refresh with no material change still advances what /api/snapshot serves", async () => {
    const first = lifecycleSnapshot("2026-07-28T12:00:00.000Z");
    let current = first;
    let publish: ((snapshot: HubSnapshot) => void) | undefined;
    const state: MountainAppState = {
      get: () => current,
      subscribe: (listener) => {
        publish = listener;
        return () => {};
      },
      refresh: async () => current,
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    const fetch = createMountainFetch({ state, runner, archiveStore, webRoot: import.meta.dir });

    const before = await fetch(new Request("http://127.0.0.1:4701/api/snapshot"));
    expect((await before.json()).generatedAt).toBe(first.generatedAt);
    const baseSequence = before.headers.get("x-ant-hill-snapshot-sequence");

    // Same fleet, newer evidence: only generatedAt and lastCheckedAt move.
    current = lifecycleSnapshot("2026-07-28T12:00:30.000Z");
    publish?.(current);

    const after = await fetch(new Request("http://127.0.0.1:4701/api/snapshot"));
    expect((await after.json()).generatedAt).toBe("2026-07-28T12:00:30.000Z");
    // Freshness alone must not cost a sequence number or wake every client.
    expect(after.headers.get("x-ant-hill-snapshot-sequence")).toBe(baseSequence);

    // A material change still earns its sequence bump.
    const changed = lifecycleSnapshot("2026-07-28T12:01:00.000Z");
    changed.totals = { ...changed.totals, live: 2 };
    current = changed;
    publish?.(changed);

    const bumped = await fetch(new Request("http://127.0.0.1:4701/api/snapshot"));
    expect((await bumped.json()).totals.live).toBe(2);
    expect(bumped.headers.get("x-ant-hill-snapshot-sequence")).not.toBe(baseSequence);
    fetch.dispose();
  });
});

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

  test("event streams bootstrap and reconnect with a sequenced full snapshot", async () => {
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
    const first = String((await reader.read()).value);

    expect(first).toStartWith("id: 0\nevent: snapshot\ndata: ");
    expect(JSON.parse(first.split("\ndata: ")[1]!.trim())).toEqual(initial);

    const changed = {
      ...initial,
      totals: { ...initial.totals, tracked: initial.totals.tracked + 1 },
    };
    listener!(changed);
    await reader.read();

    const reconnected = await fetch(new Request("http://127.0.0.1:4701/api/events"));
    const reconnectEvent = String((await reconnected.body!.getReader().read()).value);

    expect(reconnectEvent).toStartWith("id: 1\nevent: snapshot\ndata: ");
    expect(JSON.parse(reconnectEvent.split("\ndata: ")[1]!.trim())).toEqual(changed);
    fetch.dispose();
  });

  test("event streams send ordered deltas without repeating immutable ended agents", async () => {
    const initial = lifecycleSnapshot("2026-07-29T08:00:00.000Z");
    const ended = {
      ...initial.programs[0]!.agents[0]!,
      id: "codex:ended",
      sourceSessionId: "ended",
      displayName: "Ended fixture",
      status: "archived" as const,
      statusReason: "x".repeat(500_000),
      transcriptTail: "y".repeat(500_000),
      controls: [],
    };
    initial.programs[0]!.agents.push(ended);
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
    const fullEvent = String((await reader.read()).value);

    const changed: HubSnapshot = {
      ...initial,
      generatedAt: "2026-07-29T08:00:04.000Z",
      programs: [{
        ...initial.programs[0]!,
        agents: [
          { ...initial.programs[0]!.agents[0]!, statusReason: "Active fixture changed." },
          ended,
        ],
      }],
    };
    listener!(changed);
    const deltaEvent = String((await reader.read()).value);
    const delta = JSON.parse(deltaEvent.split("\ndata: ")[1]!.trim());

    expect(deltaEvent).toStartWith("id: 1\nevent: snapshot-delta\ndata: ");
    expect(delta).toMatchObject({
      schemaVersion: 1,
      baseSequence: 0,
      sequence: 1,
      snapshot: { generatedAt: changed.generatedAt },
      programs: [{
        id: "fixture",
        agentIds: ["codex:control", "codex:ended"],
        agents: [{ id: "codex:control", statusReason: "Active fixture changed." }],
      }],
    });
    expect(delta.programs[0].agents.map((agent: AgentSnapshot) => agent.id)).toEqual(["codex:control"]);
    expect(deltaEvent).not.toContain("y".repeat(100));
    expect(new TextEncoder().encode(deltaEvent).byteLength)
      .toBeLessThan(new TextEncoder().encode(fullEvent).byteLength / 20);

    const snapshotResponse = await fetch(new Request("http://127.0.0.1:4701/api/snapshot"));
    expect(snapshotResponse.headers.get("x-ant-hill-snapshot-sequence")).toBe("1");
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
