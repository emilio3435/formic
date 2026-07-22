import { describe, expect, test } from "bun:test";
import {
  handleProgramAliasRequest,
  JsonProgramAliasStore,
  type ProgramAliasFileOperations,
} from "../src/server/program-aliases";
import type { HubSnapshot } from "../src/shared/types";

function missing(): NodeJS.ErrnoException {
  return Object.assign(new Error("missing"), { code: "ENOENT" });
}

function snapshot(): HubSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-22T07:00:00.000Z",
    controlHealth: { cmuxReachable: true, lastCheckedAt: "2026-07-22T07:00:00.000Z", errors: [], staleSources: [] },
    totals: { live: 0, tracked: 0, attention: 0 },
    programs: [{ id: "stable-source-id", name: "Source name", agents: [] }],
  };
}

function post(body: unknown, origin = "http://127.0.0.1:4701"): Request {
  return new Request("http://127.0.0.1:4701/api/program-aliases", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("durable presentation-only program aliases", () => {
  test("persists trimmed aliases atomically and resets without changing the source program", async () => {
    const contents = new Map<string, string>();
    const files: ProgramAliasFileOperations = {
      readText: async (path) => contents.get(path) ?? Promise.reject(missing()),
      makeDirectory: async () => {},
      writeText: async (path, value) => { contents.set(path, value); },
      rename: async (from, to) => { contents.set(to, contents.get(from) ?? ""); },
    };
    const path = "/virtual/program-aliases.json";
    const store = await JsonProgramAliasStore.open(path, files);
    const source = snapshot();

    const changed = await handleProgramAliasRequest(post({ programId: "stable-source-id", alias: "  Calm Room  " }), source, store);
    expect(changed.status).toBe(200);
    expect(store.all()).toEqual({ "stable-source-id": "Calm Room" });
    expect(source.programs[0]).toMatchObject({ id: "stable-source-id", name: "Source name" });

    const reopened = await JsonProgramAliasStore.open(path, files);
    expect(reopened.all()).toEqual({ "stable-source-id": "Calm Room" });
    const reset = await handleProgramAliasRequest(post({ programId: "stable-source-id", alias: "  " }), source, reopened);
    expect(reset.status).toBe(200);
    expect(reopened.all()).toEqual({});
  });

  test("serializes concurrent writes and retains every committed alias", async () => {
    const contents = new Map<string, string>();
    const files: ProgramAliasFileOperations = {
      readText: async () => { throw missing(); },
      makeDirectory: async () => {},
      writeText: async (path, value) => { await Promise.resolve(); contents.set(path, value); },
      rename: async (from, to) => { contents.set(to, contents.get(from) ?? ""); },
    };
    const store = await JsonProgramAliasStore.open("/virtual/aliases.json", files);
    await Promise.all([store.set("one", "First"), store.set("two", "Second")]);
    expect(store.all()).toEqual({ one: "First", two: "Second" });
    expect(JSON.parse(contents.get("/virtual/aliases.json") ?? "{}"))
      .toEqual({ one: "First", two: "Second" });
  });

  test("rejects unknown programs, extra fields, long aliases, and cross-origin mutation", async () => {
    const store = await JsonProgramAliasStore.open("/virtual/aliases.json", {
      readText: async () => { throw missing(); }, makeDirectory: async () => {},
      writeText: async () => {}, rename: async () => {},
    });
    const source = snapshot();
    const requests = [
      post({ programId: "missing", alias: "Name" }),
      post({ programId: "stable-source-id", alias: "Name", id: "replacement" }),
      post({ programId: "stable-source-id", alias: "x".repeat(81) }),
      post({ programId: "stable-source-id", alias: "Name" }, "http://localhost:4700"),
    ];
    const responses = await Promise.all(requests.map((request) => handleProgramAliasRequest(request, source, store)));
    expect(responses.map((response) => response.status)).toEqual([404, 400, 400, 403]);
    expect(store.all()).toEqual({});
  });

  test("GET exposes aliases from loopback without requiring a mutation Origin header", async () => {
    const store = await JsonProgramAliasStore.open("/virtual/aliases.json", {
      readText: async () => '{"stable-source-id":"My Room"}', makeDirectory: async () => {},
      writeText: async () => {}, rename: async () => {},
    });
    const response = await handleProgramAliasRequest(
      new Request("http://127.0.0.1:4701/api/program-aliases"), snapshot(), store,
    );
    expect(await response.json()).toEqual({ ok: true, aliases: { "stable-source-id": "My Room" } });
  });

  test("accepts an exact same-origin IPv6 loopback mutation", async () => {
    const store = await JsonProgramAliasStore.open("/virtual/aliases.json", {
      readText: async () => { throw missing(); }, makeDirectory: async () => {},
      writeText: async () => {}, rename: async () => {},
    });
    const request = new Request("http://[::1]:4701/api/program-aliases", {
      method: "POST",
      headers: { origin: "http://[::1]:4701", "content-type": "application/json" },
      body: JSON.stringify({ programId: "stable-source-id", alias: "IPv6 Room" }),
    });
    const response = await handleProgramAliasRequest(request, snapshot(), store);
    expect(response.status).toBe(200);
    expect(store.all()).toEqual({ "stable-source-id": "IPv6 Room" });
  });
});
