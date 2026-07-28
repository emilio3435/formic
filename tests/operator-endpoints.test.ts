import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, spyOn, test } from "bun:test";
import {
  createMountainFetch,
  JsonActionLogStore,
  MemoryActionLogStore,
  type MountainAppState,
} from "../src/server/app";
import { MemoryAttentionStore } from "../src/server/cmux";
import type { AgentSnapshot, HubSnapshot } from "../src/shared/types";
import type { ArchiveStore, CommandResult, CommandRunner } from "../src/server/types";

const ORIGIN = "http://127.0.0.1:4701";

class StubRunner implements CommandRunner {
  readonly commands: string[][] = [];

  constructor(private readonly results: CommandResult[] = []) {}

  async run(command: readonly string[]): Promise<CommandResult> {
    this.commands.push([...command]);
    return this.results.shift() ?? { exitCode: 0, stdout: "", stderr: "", timedOut: false };
  }
}

function snapshot(transcriptPath?: string): HubSnapshot {
  const agent: AgentSnapshot = {
    id: "codex:test-session",
    provider: "codex",
    sourceSessionId: "test-session",
    displayName: "Endpoint fixture",
    programId: "fixture",
    status: "running",
    statusReason: "Fixture is active.",
    outcome: "needs-you",
    lastHumanMessage: null,
    updatedAt: "2026-07-28T09:00:00.000Z",
    tokens: { provenance: "unknown" },
    artifacts: transcriptPath
      ? [{ label: "Codex transcript", path: transcriptPath, kind: "transcript" }]
      : [],
    gates: [],
    target: { resolution: "exact", surfaceId: "SURFACE-1" },
    controls: (["focus", "instruct", "interrupt", "archive"] as const)
      .map((action) => ({ action, enabled: true })),
  };
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    controlHealth: {
      cmuxReachable: true,
      lastCheckedAt: new Date().toISOString(),
      errors: [],
      staleSources: [],
    },
    totals: { live: 1, tracked: 1, attention: 1 },
    programs: [{ id: "fixture", name: "Fixture", agents: [agent] }],
  };
}

function app(
  current: HubSnapshot,
  options: {
    runner?: CommandRunner;
    actions?: MemoryActionLogStore;
    attention?: MemoryAttentionStore;
    refreshes?: Array<{ cmux?: boolean } | undefined>;
    now?: () => number;
  } = {},
) {
  const refreshes = options.refreshes ?? [];
  const state: MountainAppState = {
    get: () => current,
    subscribe: () => () => {},
    refresh: async (value) => {
      refreshes.push(value);
      return current;
    },
  };
  const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
  return createMountainFetch({
    state,
    runner: options.runner ?? new StubRunner(),
    archiveStore,
    actionLogStore: options.actions ?? new MemoryActionLogStore(),
    attentionStore: options.attention ?? new MemoryAttentionStore(),
    now: options.now,
    webRoot: import.meta.dir,
  });
}

function get(path: string, origin = ORIGIN): Request {
  return new Request(`${ORIGIN}${path}`, { headers: { origin } });
}

describe("GET /api/transcript", () => {
  test("returns a sanitized tail with an honest source and truncation flag", async () => {
    const directory = await mkdtemp(join(tmpdir(), "anthill-transcript-"));
    const path = join(directory, "session.jsonl");
    await writeFile(path, [
      JSON.stringify({
        timestamp: "2026-07-28T09:00:00.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "<user_query>Inspect the failing route.</user_query>" },
      }),
      JSON.stringify({
        timestamp: "2026-07-28T09:00:01.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "**Found** the boundary mismatch." }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-07-28T09:00:02.000Z",
        type: "response_item",
        payload: { type: "function_call_output", output: "Tool completed safely." },
      }),
    ].join("\n"));
    const fetch = app(snapshot(path));
    try {
      const response = await fetch(get("/api/transcript?agent=codex%3Atest-session&limit=2"));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        ok: true,
        agentId: "codex:test-session",
        source: path,
        truncated: true,
        lines: [
          {
            at: "2026-07-28T09:00:01.000Z",
            role: "assistant",
            text: "Found the boundary mismatch.",
          },
          {
            at: "2026-07-28T09:00:02.000Z",
            role: "tool",
            text: "Tool completed safely.",
          },
        ],
      });
    } finally {
      fetch.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("unknown agents are 404 and agents without readable files return an honest empty result", async () => {
    const fetch = app(snapshot());
    const missing = await fetch(get("/api/transcript?agent=codex%3Amissing"));
    const empty = await fetch(get("/api/transcript?agent=codex%3Atest-session"));

    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ ok: false, error: { code: "AGENT_NOT_FOUND" } });
    expect(await empty.json()).toEqual({
      ok: true,
      agentId: "codex:test-session",
      source: null,
      truncated: false,
      lines: [],
    });
    fetch.dispose();
  });

  test("requires exact same-origin loopback access and enforces the hard limit", async () => {
    const fetch = app(snapshot());
    const rejected = await fetch(get("/api/transcript?agent=codex%3Atest-session", "http://evil.example"));
    const foreignHost = await fetch(new Request(
      "http://evil.example:4701/api/transcript?agent=codex%3Atest-session",
      { headers: { origin: "http://evil.example:4701" } },
    ));
    const oversized = await fetch(get("/api/transcript?agent=codex%3Atest-session&limit=1001"));

    expect(rejected.status).toBe(403);
    expect(await rejected.json()).toMatchObject({ error: { code: "ORIGIN_REJECTED" } });
    expect(foreignHost.status).toBe(403);
    expect(await foreignHost.json()).toMatchObject({ error: { code: "ORIGIN_REJECTED" } });
    expect(oversized.status).toBe(400);
    expect(await oversized.json()).toMatchObject({ error: { code: "INVALID_LIMIT" } });
    fetch.dispose();
  });
});

describe("operator action log", () => {
  test("records staged control failure and partial broadcast exactly once each, newest first", async () => {
    const actions = new MemoryActionLogStore(() => Date.parse("2026-07-28T09:12:03.114Z"));
    const runner = new StubRunner([
      { exitCode: 0, stdout: "", stderr: "", timedOut: false },
      { exitCode: 7, stdout: "", stderr: "first", timedOut: false },
      { exitCode: 8, stdout: "", stderr: "second", timedOut: false },
      { exitCode: 0, stdout: "", stderr: "", timedOut: false },
      { exitCode: 0, stdout: "", stderr: "", timedOut: false },
    ]);
    const fetch = app(snapshot(), { actions, runner });

    const staged = await fetch(new Request(`${ORIGIN}/api/control`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({
        action: "instruct",
        agentId: "codex:test-session",
        instruction: "Continue.",
      }),
    }));
    expect(staged.status).toBe(502);

    const partial = await fetch(new Request(`${ORIGIN}/api/broadcast`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({
        agentIds: ["codex:test-session", "codex:missing"],
        instruction: "Report status.",
      }),
    }));
    expect(partial.status).toBe(207);

    const response = await fetch(get("/api/actions?limit=2"));
    const body = await response.json();
    expect(body.ok).toBeTrue();
    expect(body.actions).toHaveLength(2);
    expect(body.actions[0]).toMatchObject({
      kind: "broadcast",
      agentIds: ["codex:test-session", "codex:missing"],
      outcome: "partial",
      detail: "1 of 2 recipients delivered",
    });
    expect(body.actions[1]).toMatchObject({
      kind: "instruct",
      agentIds: ["codex:test-session"],
      outcome: "staged",
    });
    expect(body.actions.every((action: { id: string }) => action.id.startsWith("act_01"))).toBeTrue();
    fetch.dispose();
  });

  test("records successful and failed controls from their authoritative HTTP outcomes", async () => {
    let now = Date.parse("2026-07-28T09:12:03.114Z");
    const actions = new MemoryActionLogStore(() => now);
    const runner = new StubRunner([
      { exitCode: 17, stdout: "", stderr: "surface missing", timedOut: false },
    ]);
    const fetch = app(snapshot(), { actions, runner });

    const failed = await fetch(new Request(`${ORIGIN}/api/control`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ action: "focus", agentId: "codex:test-session" }),
    }));
    expect(failed.status).toBe(502);

    now += 1;
    const archived = await fetch(new Request(`${ORIGIN}/api/control`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ action: "archive", agentId: "codex:test-session" }),
    }));
    expect(archived.status).toBe(200);

    expect(actions.list(10)).toMatchObject([
      { kind: "archive", outcome: "ok", agentIds: ["codex:test-session"] },
      {
        kind: "focus",
        outcome: "failed",
        agentIds: ["codex:test-session"],
        detail: "CMUX_COMMAND_FAILED: cmux command exited with status 17",
      },
    ]);
    fetch.dispose();
  });

  test("bounds the in-memory ring buffer at 500 newest actions", async () => {
    let now = Date.parse("2026-07-28T09:00:00.000Z");
    const store = new MemoryActionLogStore(() => now++);
    for (let index = 0; index < 501; index += 1) {
      await store.append({
        kind: "focus",
        agentIds: [`codex:${index}`],
        outcome: "ok",
        detail: `Focused ${index}.`,
      });
    }

    expect(store.list(1)[0]?.agentIds).toEqual(["codex:500"]);
    expect(store.list(1_000)).toHaveLength(500);
    expect(store.list(1_000).at(-1)?.agentIds).toEqual(["codex:1"]);
  });

  test("persists, prunes, and loudly recovers a corrupt action file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "anthill-actions-"));
    const path = join(directory, "actions.json");
    let now = Date.parse("2026-07-28T09:00:00.000Z");
    try {
      const store = await JsonActionLogStore.open(path, () => now);
      await store.append({
        kind: "focus",
        agentIds: ["codex:test-session"],
        outcome: "ok",
        detail: "Focused agent.",
      });
      const reopened = await JsonActionLogStore.open(path, () => now);
      expect(reopened.list(10)).toHaveLength(1);

      now += 8 * 24 * 60 * 60 * 1_000;
      const pruned = await JsonActionLogStore.open(path, () => now);
      expect(pruned.list(10)).toEqual([]);
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual([]);

      await writeFile(path, "{");
      const logged = spyOn(console, "error").mockImplementation(() => {});
      try {
        const recovered = await JsonActionLogStore.open(path, () => now);
        expect(recovered.list(10)).toEqual([]);
        expect(logged).toHaveBeenCalledWith(expect.stringContaining("Ignoring unreadable action log"));
      } finally {
        logged.mockRestore();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("POST /api/attention", () => {
  test("persists a snooze and refreshes cmux so attention disappears immediately", async () => {
    const attention = new MemoryAttentionStore(() => Date.parse("2026-07-28T09:01:00.000Z"));
    attention.observe([{
      id: "notice-1",
      surfaceId: "SURFACE-1",
      createdAt: "2026-07-28T09:00:00.000Z",
      body: "Needs operator",
    }]);
    const refreshes: Array<{ cmux?: boolean } | undefined> = [];
    const fetch = app(snapshot(), {
      attention,
      refreshes,
      now: () => Date.parse("2026-07-28T09:01:00.000Z"),
    });

    const response = await fetch(new Request(`${ORIGIN}/api/attention`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({
        action: "snooze",
        agentId: "codex:test-session",
        until: "2026-07-28T09:10:00.000Z",
      }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      agentId: "codex:test-session",
      state: { action: "snooze", snoozedUntil: "2026-07-28T09:10:00.000Z" },
    });
    expect(refreshes).toEqual([{ cmux: true }]);
    fetch.dispose();
  });
});
