import { describe, expect, test } from "bun:test";
import {
  handleProgramAliasRequest,
  JsonProgramAliasStore,
  type ProgramAliasFileOperations,
} from "../src/server/program-aliases";
import type { AgentSnapshot, HubSnapshot } from "../src/shared/types";

function missing(): NodeJS.ErrnoException {
  return Object.assign(new Error("missing"), { code: "ENOENT" });
}

function agent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: "codex:child-source-id",
    provider: "codex",
    sourceSessionId: "child-source-id",
    displayName: "Source child display name",
    programId: "stable-source-id",
    status: "running",
    statusReason: "Source activity is recent.",
    parentAgentId: "codex:parent-source-id",
    updatedAt: "2026-07-22T07:00:00.000Z",
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    target: {
      resolution: "exact",
      workspaceId: "workspace-source-id",
      workspaceTitle: "Source Workspace Title",
      surfaceId: "room-source-id",
    },
    controls: [],
    ...overrides,
    lastHumanMessage: overrides.lastHumanMessage ?? null,
  };
}

function snapshot(): HubSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-22T07:00:00.000Z",
    controlHealth: { cmuxReachable: true, lastCheckedAt: "2026-07-22T07:00:00.000Z", errors: [], staleSources: [] },
    totals: { live: 1, tracked: 1, attention: 0 },
    programs: [{
      id: "stable-source-id",
      name: "Source program name",
      agents: [agent()],
    }],
  };
}

function post(body: unknown, origin = "http://127.0.0.1:4701"): Request {
  return new Request("http://127.0.0.1:4701/api/program-aliases", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function filesFor(contents: Map<string, string>, writes: string[] = []): ProgramAliasFileOperations {
  return {
    readText: async (path) => contents.get(path) ?? Promise.reject(missing()),
    makeDirectory: async () => {},
    writeText: async (path, value) => { writes.push(path); contents.set(path, value); },
    rename: async (from, to) => { contents.set(to, contents.get(from) ?? ""); },
  };
}

describe("durable presentation-only labels", () => {
  test("persists a trimmed program label atomically, hydrates after reopen, and resets cleanly", async () => {
    const contents = new Map<string, string>();
    const writes: string[] = [];
    const path = "/virtual/presentation-labels.json";
    const store = await JsonProgramAliasStore.open(path, filesFor(contents, writes));
    const source = snapshot();
    const target = { kind: "program", programId: "stable-source-id" } as const;

    const changed = await handleProgramAliasRequest(post({ target, label: "  Calm Program  " }), source, store);
    expect(changed.status).toBe(200);
    expect(store.all()).toEqual({ "program:stable-source-id": "Calm Program" });
    expect(writes.some((write) => write.endsWith(".tmp"))).toBe(true);
    expect(source.programs[0]).toMatchObject({ id: "stable-source-id", name: "Source program name" });
    expect(source.programs[0]?.agents[0]).toMatchObject({
      id: "codex:child-source-id",
      displayName: "Source child display name",
    });

    const reopened = await JsonProgramAliasStore.open(path, filesFor(contents));
    expect(reopened.all()).toEqual({ "program:stable-source-id": "Calm Program" });
    const reset = await handleProgramAliasRequest(post({ target, label: "  " }), source, reopened);
    expect(reset.status).toBe(200);
    expect(await reset.json()).toMatchObject({ target, label: null, reset: true });
    expect(reopened.all()).toEqual({});
  });

  test("serializes concurrent writes and retains every committed target label", async () => {
    const contents = new Map<string, string>();
    const store = await JsonProgramAliasStore.open("/virtual/labels.json", filesFor(contents));
    await Promise.all([
      store.set("workspace:one", "First workspace"),
      store.set("room:two", "Second room"),
      store.set("agent:three", "Third agent"),
    ]);
    expect(store.all()).toEqual({
      "agent:three": "Third agent",
      "room:two": "Second room",
      "workspace:one": "First workspace",
    });
    expect(JSON.parse(contents.get("/virtual/labels.json") ?? "{}"))
      .toEqual(store.all());
  });

  test("accepts workspace, room, and unnamed child targets with stable keys", async () => {
    const store = await JsonProgramAliasStore.open("/virtual/labels.json", filesFor(new Map()));
    const source = snapshot();
    const targets = [
      [{ kind: "workspace", workspaceId: "workspace-source-id" }, "Calm workspace"],
      [{ kind: "room", surfaceId: "room-source-id" }, "Quiet room"],
      [{ kind: "agent", agentId: "codex:child-source-id" }, "Named child"],
    ] as const;
    for (const [target, label] of targets) {
      const response = await handleProgramAliasRequest(post({ target, label }), source, store);
      expect(response.status).toBe(200);
    }
    expect(store.all()).toEqual({
      "agent:codex:child-source-id": "Named child",
      "room:room-source-id": "Quiet room",
      "workspace:workspace-source-id": "Calm workspace",
    });
    expect(source.programs[0]?.agents[0]?.target).toMatchObject({
      workspaceId: "workspace-source-id",
      workspaceTitle: "Source Workspace Title",
      surfaceId: "room-source-id",
    });
  });

  test("validates target existence, exact request shape, length, and cross-origin mutation", async () => {
    const store = await JsonProgramAliasStore.open("/virtual/labels.json", filesFor(new Map()));
    const source = snapshot();
    const requests = [
      post({ target: { kind: "program", programId: "missing" }, label: "Name" }),
      post({ target: { kind: "workspace", workspaceId: "missing" }, label: "Name" }),
      post({ target: { kind: "agent", agentId: "codex:child-source-id", extra: "nope" }, label: "Name" }),
      post({ target: { kind: "program", programId: "stable-source-id" }, label: "x".repeat(81) }),
      post({ target: { kind: "program", programId: "stable-source-id" }, label: "Name" }, "http://localhost:4700"),
    ];
    const responses = await Promise.all(requests.map((request) => handleProgramAliasRequest(request, source, store)));
    expect(responses.map((response) => response.status)).toEqual([404, 404, 400, 400, 403]);
    expect(store.all()).toEqual({});
  });

  test("does not allow a source-named child to be replaced by a presentation label", async () => {
    const store = await JsonProgramAliasStore.open("/virtual/labels.json", filesFor(new Map()));
    const source = snapshot();
    source.programs[0]!.agents[0] = agent({ nickname: "Authoritative child nickname" });
    const response = await handleProgramAliasRequest(post({
      target: { kind: "agent", agentId: "codex:child-source-id" },
      label: "Replacement",
    }), source, store);
    expect(response.status).toBe(404);
    expect(store.all()).toEqual({});
    expect(source.programs[0]?.agents[0]?.nickname).toBe("Authoritative child nickname");
  });

  test("GET hydrates all presentation labels over loopback and accepts exact IPv6 mutation", async () => {
    const contents = new Map([["/virtual/labels.json", '{"workspace:source":"My Workspace"}']]);
    const store = await JsonProgramAliasStore.open("/virtual/labels.json", filesFor(contents));
    const response = await handleProgramAliasRequest(
      new Request("http://127.0.0.1:4701/api/program-aliases"), snapshot(), store,
    );
    expect(await response.json()).toEqual({ ok: true, labels: { "workspace:source": "My Workspace" } });

    const ipv6 = new Request("http://[::1]:4701/api/program-aliases", {
      method: "POST",
      headers: { origin: "http://[::1]:4701", "content-type": "application/json" },
      body: JSON.stringify({ target: { kind: "program", programId: "stable-source-id" }, label: "IPv6 Program" }),
    });
    const changed = await handleProgramAliasRequest(ipv6, snapshot(), store);
    expect(changed.status).toBe(200);
    expect(store.all()).toMatchObject({ "program:stable-source-id": "IPv6 Program" });
  });
});
