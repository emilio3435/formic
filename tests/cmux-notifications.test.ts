import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, spyOn, test } from "bun:test";
import { JsonAckStore, MemoryAckStore, alertFingerprintFor } from "../src/server/ack";
import { MemoryArchiveStore } from "../src/server/archive";
import { createMountainFetch, type MountainAppState } from "../src/server/app";
import { collectSessions } from "../src/server/collectors";
import { collectCmuxNotificationSummaries } from "../src/server/cmux";
import {
  dismissNotification,
  configureCmuxActions,
  isOwnEcho,
  markNotificationRead,
  resetCmuxActionsMemory,
} from "../src/server/cmux-actions";
import { dispatchCmuxSyncEvent } from "../src/server/cmux-sync";
import { BunCommandRunner } from "../src/server/command";
import { buildSnapshot } from "../src/server/snapshot";
import { HubState, type HubCollectors } from "../src/server/state";
import type { AgentSnapshot, CmuxNotificationSummary } from "../src/shared/types";
import type { CollectedAgent, CommandResult, CommandRunner } from "../src/server/types";

const ok = (value: unknown): CommandResult => ({
  exitCode: 0,
  stdout: JSON.stringify(value),
  stderr: "",
  timedOut: false,
});

class NotificationListRunner implements CommandRunner {
  readonly commands: string[][] = [];

  async run(command: readonly string[]): Promise<CommandResult> {
    this.commands.push([...command]);
    const method = command[2];
    const params = JSON.parse(command[3] ?? "null") as Record<string, unknown>;
    if (method === "notification.list") {
      return ok({
        result: {
          notifications: [
            {
              id: "NOTICE-UNREAD",
              workspace_id: "WORKSPACE-A",
              surface_id: "SURFACE-A",
              title: "Review ready",
              subtitle: "SYNC-NB",
              body: "Full list-derived body",
              is_read: false,
              created_at: "2026-08-13T09:00:00.000Z",
            },
            {
              id: "NOTICE-ANCHOR-WINDOW-1",
              workspace_id: "WORKSPACE-ANCHOR-WINDOW-1",
              surface_id: "SURFACE-ANCHOR-WINDOW-1",
              title: "First-window anchor must be excluded",
              subtitle: "",
              body: "An anchor is not a notify target.",
              is_read: false,
              created_at: "2026-08-13T09:01:00.000Z",
            },
            {
              id: "NOTICE-ANCHOR-WINDOW-2",
              workspace_id: "WORKSPACE-ANCHOR-WINDOW-2",
              surface_id: "SURFACE-ANCHOR-WINDOW-2",
              title: "Second-window anchor must be excluded",
              subtitle: "",
              body: "A first-window-only filter would leak this notification.",
              is_read: false,
              created_at: "2026-08-13T09:01:30.000Z",
            },
            {
              id: "NOTICE-READ",
              workspaceId: "WORKSPACE-B",
              surfaceId: "SURFACE-B",
              title: "Already seen",
              subtitle: null,
              body: null,
              read: true,
              createdAt: "2026-08-13T09:02:00.000Z",
            },
          ],
        },
      });
    }
    if (method === "window.list") {
      expect(params).toEqual({});
      return ok({ result: { windows: [{ id: "WINDOW-1" }, { id: "WINDOW-2" }] } });
    }
    if (method === "workspace.group.list") {
      if (params.window_id === "WINDOW-1") {
        return ok({ result: { groups: [{ id: "GROUP-1", anchor_workspace_id: "WORKSPACE-ANCHOR-WINDOW-1" }] } });
      }
      return ok({ result: { groups: [{ id: "GROUP-2", anchor_workspace_id: "WORKSPACE-ANCHOR-WINDOW-2" }] } });
    }
    throw new Error(`Unexpected cmux method: ${method}`);
  }
}

const emptySessions = () => ({
  omp: { value: [], errors: [] },
  codex: { value: [], errors: [] },
  claude: { value: [], errors: [] },
  cursor: { value: [], errors: [] },
  factory: { value: [], errors: [] },
  prime: { value: [], errors: [] },
});

async function eventually(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let turn = 0; turn < 200; turn += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await Promise.resolve();
    }
  }
  throw lastError;
}

describe("SYNC-NB notification ingest", () => {
  test("notification.list maps the frozen snapshot summaries and drops group anchors across every window", async () => {
    const runner = new NotificationListRunner();
    const collected = await collectCmuxNotificationSummaries(runner, "cmux");

    expect(collected).toEqual({
      value: [
        {
          id: "NOTICE-UNREAD",
          workspaceId: "WORKSPACE-A",
          surfaceId: "SURFACE-A",
          title: "Review ready",
          subtitle: "SYNC-NB",
          body: "Full list-derived body",
          isRead: false,
          createdAt: "2026-08-13T09:00:00.000Z",
        },
        {
          id: "NOTICE-READ",
          workspaceId: "WORKSPACE-B",
          surfaceId: "SURFACE-B",
          title: "Already seen",
          subtitle: "",
          body: "",
          isRead: true,
          createdAt: "2026-08-13T09:02:00.000Z",
        },
      ],
      errors: [],
    });

    const snapshot = buildSnapshot({
      agents: [],
      surfaces: [],
      archiveStore: new MemoryArchiveStore(),
      cmuxNotifications: collected.value,
    });
    expect(snapshot.cmuxNotifications).toEqual(collected.value);

    expect(runner.commands.map((command) => command[2])).toEqual([
      "notification.list",
      "window.list",
      "workspace.group.list",
      "workspace.group.list",
    ]);
    expect(runner.commands.slice(2).map((command) => JSON.parse(command[3] ?? "null"))).toEqual([
      { window_id: "WINDOW-1" },
      { window_id: "WINDOW-2" },
    ]);
  });

  test("notification created/read/removed in one tick trigger one targeted re-list and no session recollect", async () => {
    let sessionCollections = 0;
    let notificationLists = 0;
    const summary = (id: string): CmuxNotificationSummary => ({
      id,
      workspaceId: "WORKSPACE-A",
      surfaceId: "SURFACE-A",
      title: "Review ready",
      subtitle: "SYNC-NB",
      body: "Full list-derived body",
      isRead: false,
      createdAt: "2026-08-13T09:00:00.000Z",
    });
    const collectors: HubCollectors = {
      sessions: async () => {
        sessionCollections += 1;
        return emptySessions();
      },
      cmux: async () => ({ value: [], errors: [] }),
      notifications: async () => ({ value: [], errors: [] }),
      syncNotifications: async () => {
        notificationLists += 1;
        return { value: [summary(`NOTICE-${notificationLists}`)], errors: [] };
      },
      enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [] }),
    };
    const state = new HubState(
      { run: async () => ok({}) },
      new MemoryArchiveStore(),
      [],
      { collectors },
    );
    state.startCmuxSync({
      cursorStore: {
        load: async () => await new Promise<number | undefined>(() => {}),
        save: async () => {},
      },
    });

    try {
      dispatchCmuxSyncEvent({ seq: 1, name: "notification.created", payload: { args: "<redacted>" } });
      dispatchCmuxSyncEvent({ seq: 2, name: "notification.read", payload: { id: "NOTICE-OLD" } });
      dispatchCmuxSyncEvent({ seq: 3, name: "notification.removed", payload: { id: "NOTICE-OLD" } });

      await eventually(() => {
        expect(notificationLists).toBe(1);
        expect(state.get().cmuxNotifications).toEqual([summary("NOTICE-1")]);
      });
      expect(sessionCollections).toBe(0);

      dispatchCmuxSyncEvent({ seq: 4, name: "notification.created", payload: { args: "<redacted>" } });
      await eventually(() => expect(notificationLists).toBe(2));
    } finally {
      state.stopCmuxSync();
    }
  });
});

describe("SYNC-NB notification verbs", () => {
  test("mark_read and dismiss emit exactly {id}, pin no all variant, and record exact echo fingerprints", async () => {
    const commands: string[][] = [];
    const run = spyOn(BunCommandRunner.prototype, "run").mockImplementation(
      async (command: readonly string[]): Promise<CommandResult> => {
        commands.push([...command]);
        const params = JSON.parse(command[3] ?? "null") as Record<string, unknown>;
        if (Object.keys(params).join(",") !== "id") {
          return ok({ error: { code: "invalid_params", message: "notification actions require id" } });
        }
        return ok({ result: { id: params.id } });
      },
    );
    configureCmuxActions({ runner: new BunCommandRunner() });
    resetCmuxActionsMemory();
    try {
      await expect(markNotificationRead("NOTICE-READ")).resolves.toEqual({ ok: true });
      await expect(dismissNotification("NOTICE-DISMISS")).resolves.toEqual({ ok: true });

      expect(commands.map((command) => command[2])).toEqual([
        "notification.mark_read",
        "notification.dismiss",
      ]);
      const params = commands.map((command) => JSON.parse(command[3] ?? "null") as Record<string, unknown>);
      expect(params.map((value) => Object.keys(value))).toEqual([["id"], ["id"]]);
      expect(params).toEqual([{ id: "NOTICE-READ" }, { id: "NOTICE-DISMISS" }]);
      for (const value of params) {
        expect(value).not.toHaveProperty("notification_id");
        expect(value).not.toHaveProperty("tab_id");
        expect(value).not.toHaveProperty("all");
        expect(value).not.toHaveProperty("all_read");
      }
      expect(isOwnEcho({
        name: "notification.mark_read_requested",
        payload: { params: { id: "NOTICE-READ" } },
      })).toBe(true);
      expect(isOwnEcho({
        name: "notification.dismiss_requested",
        payload: { params: { id: "NOTICE-DISMISS" } },
      })).toBe(true);
      expect(isOwnEcho({
        name: "notification.mark_read_requested",
        payload: { params: { notification_id: "NOTICE-READ" } },
      })).toBe(false);
    } finally {
      resetCmuxActionsMemory();
      run.mockRestore();
    }
  });

  test("RPC refusal at exit zero and non-zero process failure stay typed failures and never mint echoes", async () => {
    const results: CommandResult[] = [
      ok({ error: { code: "invalid_state", message: "notification is already removed" } }),
      ok({ error: "invalid_state: notification cannot be dismissed" }),
      { exitCode: 9, stdout: "", stderr: "socket unavailable", timedOut: false },
    ];
    const run = spyOn(BunCommandRunner.prototype, "run").mockImplementation(async () => results.shift()!);
    configureCmuxActions({ runner: new BunCommandRunner() });
    resetCmuxActionsMemory();
    try {
      await expect(markNotificationRead("NOTICE-REFUSED")).resolves.toEqual({
        ok: false,
        code: "invalid_state",
        detail: "notification is already removed",
      });
      await expect(dismissNotification("NOTICE-STRING-REFUSAL")).resolves.toEqual({
        ok: false,
        code: "invalid_state",
        detail: "invalid_state: notification cannot be dismissed",
      });
      await expect(dismissNotification("NOTICE-FAILED")).resolves.toEqual({
        ok: false,
        code: "cmux_exit",
        detail: "socket unavailable",
      });
      expect(isOwnEcho({
        name: "notification.mark_read_requested",
        payload: { params: { id: "NOTICE-REFUSED" } },
      })).toBe(false);
      expect(isOwnEcho({
        name: "notification.dismiss_requested",
        payload: { params: { id: "NOTICE-FAILED" } },
      })).toBe(false);
    } finally {
      resetCmuxActionsMemory();
      run.mockRestore();
    }
  });
});

describe("POST /api/sync/notifications", () => {
  test("routes only exact mark_read/dismiss requests through the funnel under the same-origin gate", async () => {
    const current = buildSnapshot({
      agents: [],
      surfaces: [],
      archiveStore: new MemoryArchiveStore(),
    });
    const state: MountainAppState = {
      get: () => current,
      subscribe: () => () => {},
      refresh: async () => current,
    };
    const runner = new NotificationListRunner();
    const fetch = createMountainFetch({
      state,
      runner,
      archiveStore: new MemoryArchiveStore(),
      webRoot: import.meta.dir,
    });
    const commands: string[][] = [];
    const run = spyOn(BunCommandRunner.prototype, "run").mockImplementation(async (command) => {
      commands.push([...command]);
      return ok({ result: { id: JSON.parse(command[3] ?? "null").id } });
    });
    /* createMountainFetch pointed the shared funnel at this app's collection
       runner (one-substrate); the funnel assertions here watch the spied
       BunCommandRunner, so repoint it explicitly. */
    configureCmuxActions({ runner: new BunCommandRunner() });
    const request = (body: unknown, origin = "http://127.0.0.1:4701") => new Request(
      "http://127.0.0.1:4701/api/sync/notifications",
      {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    try {
      const markRead = await fetch(request({ action: "mark_read", id: "NOTICE-1" }));
      expect(markRead.status).toBe(200);
      expect(await markRead.json()).toEqual({ ok: true });
      const dismiss = await fetch(request({ action: "dismiss", id: "NOTICE-2" }));
      expect(dismiss.status).toBe(200);
      expect(await dismiss.json()).toEqual({ ok: true });

      const foreign = await fetch(request({ action: "dismiss", id: "NOTICE-3" }, "http://evil.example"));
      expect(foreign.status).toBe(403);
      const all = await fetch(request({ action: "all", id: "NOTICE-4" }));
      expect(all.status).toBe(400);
      expect(commands.map((command) => command[2])).toEqual([
        "notification.mark_read",
        "notification.dismiss",
      ]);
    } finally {
      resetCmuxActionsMemory();
      run.mockRestore();
      fetch.dispose();
    }
  });
});

describe("SYNC-NB alert fingerprints and Ack store", () => {
  const baseAlertAgent = (overrides: Partial<AgentSnapshot> = {}): AgentSnapshot => ({
    id: "codex:ack-agent",
    provider: "codex",
    sourceSessionId: "ack-agent",
    displayName: "Ack agent",
    programId: "fixture",
    status: "waiting",
    statusReason: "Waiting for operator input.",
    activity: "idle",
    lifecycle: "waiting",
    scope: "observed",
    outcome: "needs-you",
    hookLifecycle: "needsInput",
    hookLifecycleAt: "2026-08-13T10:00:00.000Z",
    lastHumanFacingAt: "2026-08-13T09:59:00.000Z",
    updatedAt: "2026-08-13T10:00:30.000Z",
    lastHumanMessage: null,
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    target: { resolution: "missing" },
    controls: [],
    ...overrides,
  });

  test("fingerprints change only when the semantic alert changes, never on conversation or hook clocks", () => {
    const hook = baseAlertAgent();
    expect(alertFingerprintFor(hook)).toBe("hook:needsInput:hook-input");
    expect(alertFingerprintFor({ ...hook, updatedAt: "2026-08-13T10:15:00.000Z" }))
      .toBe(alertFingerprintFor(hook));
    expect(alertFingerprintFor({ ...hook, hookLifecycleAt: "2026-08-13T10:16:00.000Z" }))
      .toBe(alertFingerprintFor(hook));
    expect(alertFingerprintFor({ ...hook, lastHumanFacingAt: "2026-08-13T10:16:00.000Z" }))
      .toBe(alertFingerprintFor(hook));

    const signal = baseAlertAgent({
      hookLifecycle: "idle",
      hookLifecycleAt: "2026-08-13T09:55:00.000Z",
      attentionSignal: { kind: "question-pending", evidence: "Which option should I use?" },
      lastHumanFacingAt: "2026-08-13T10:01:00.000Z",
    });
    expect(alertFingerprintFor(signal)).toMatch(/^signal:question-pending:[a-z0-9]+$/);
    expect(alertFingerprintFor({ ...signal, updatedAt: "2026-08-13T10:20:00.000Z" }))
      .toBe(alertFingerprintFor(signal));
    expect(alertFingerprintFor({ ...signal, lastHumanFacingAt: "2026-08-13T10:21:00.000Z" }))
      .toBe(alertFingerprintFor(signal));
    expect(alertFingerprintFor({
      ...signal,
      attentionSignal: { kind: "question-pending", evidence: "Should I publish this now?" },
    })).not.toBe(alertFingerprintFor(signal));
  });

  test("JsonAckStore persists the frozen AgentAck shape and explicit delete", async () => {
    const directory = await mkdtemp(join(tmpdir(), "formic-acks-"));
    const path = join(directory, "acks.json");
    const now = Date.parse("2026-08-13T10:02:00.000Z");
    try {
      const store = await JsonAckStore.open(path, () => now);
      await store.put("codex:ack-agent", "hook:needsInput:hook-input:2026-08-13T10:00:00.000Z");
      expect(store.list()).toEqual([{
        agentId: "codex:ack-agent",
        ackedAt: "2026-08-13T10:02:00.000Z",
        alertFingerprint: "hook:needsInput:hook-input:2026-08-13T10:00:00.000Z",
      }]);
      const reopened = await JsonAckStore.open(path, () => now);
      expect(reopened.list()).toEqual(store.list());
      await reopened.delete("codex:ack-agent");
      expect((await JsonAckStore.open(path, () => now)).list()).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("PUT/DELETE /api/sync/ack/:agentId", () => {
  test("ordinary replies preserve Ack, a new request self-revokes, DELETE unacks, and quiet agents are 409", async () => {
    const now = Date.parse("2026-08-13T10:02:00.000Z");
    const ackStore = new MemoryAckStore(() => now);
    const home = await mkdtemp(join(tmpdir(), "formic-ack-hook-producer-"));
    const hookRoot = join(home, ".cmuxterm");
    const sessionRoot = join(home, ".codex", "sessions");
    const transcriptPath = join(sessionRoot, "ack-agent.jsonl");
    await mkdir(hookRoot, { recursive: true });
    await mkdir(sessionRoot, { recursive: true });
    let hookLifecycle: CollectedAgent["hookLifecycle"] = "needsInput";
    let hookRecordUpdatedAt = Date.parse("2026-08-13T10:00:00.000Z") / 1_000;
    await writeFile(transcriptPath, [
      JSON.stringify({
        type: "session_meta",
        timestamp: "2026-08-13T09:58:00.000Z",
        payload: { id: "ack-agent", cwd: home },
      }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-08-13T09:58:30.000Z",
        payload: { type: "user_message", message: "Please prepare the change." },
      }),
      JSON.stringify({
        type: "response_item",
        timestamp: "2026-08-13T09:59:00.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Which option should I use?" }],
        },
      }),
    ].join("\n") + "\n");
    const writeHookRecord = async (): Promise<void> => {
      await writeFile(join(hookRoot, "codex-hook-sessions.json"), JSON.stringify({
        version: 1,
        sessions: {
          "ack-agent": {
            sessionId: "ack-agent",
            surfaceId: "SURFACE-ACK",
            workspaceId: "WORKSPACE-ACK",
            cwd: home,
            pid: 4242,
            agentLifecycle: hookLifecycle,
            updatedAt: hookRecordUpdatedAt,
          },
        },
      }));
    };
    const collectors: HubCollectors = {
      sessions: async () => collectSessions(home, undefined, undefined, {
        hookProcessStarts: () => new Map(),
      }),
      cmux: async () => ({ value: [], errors: [] }),
      notifications: async () => ({ value: [], errors: [] }),
      enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [] }),
    };
    const archiveStore = new MemoryArchiveStore();
    const runner: CommandRunner = { run: async () => ok({}) };
    const state = new HubState(runner, archiveStore, [], { collectors, ackStore });
    await writeHookRecord();
    await state.refresh();
    const initialFingerprint = alertFingerprintFor(
      state.get().programs.flatMap((program) => program.agents)[0]!,
    );
    expect(initialFingerprint).toMatch(/^hook:needsInput:question-pending:[a-z0-9]+$/);
    const fetch = createMountainFetch({
      state,
      runner,
      archiveStore,
      ackStore,
      now: () => now,
      webRoot: import.meta.dir,
    });
    const request = (method: "PUT" | "DELETE") => new Request(
      `http://127.0.0.1:4701/api/sync/ack/${encodeURIComponent("codex:ack-agent")}`,
      { method, headers: { origin: "http://127.0.0.1:4701" } },
    );

    try {
      const put = await fetch(request("PUT"));
      expect(put.status).toBe(200);
      expect(await put.json()).toEqual({
        ok: true,
        ack: {
          agentId: "codex:ack-agent",
          ackedAt: "2026-08-13T10:02:00.000Z",
          alertFingerprint: initialFingerprint,
        },
      });
      expect(state.get().acks).toEqual([...ackStore.list()]);

      hookRecordUpdatedAt = Date.parse("2026-08-13T10:10:00.000Z") / 1_000;
      await writeHookRecord();
      await state.refresh();
      expect(state.get().acks).toEqual([...ackStore.list()]);
      expect(ackStore.list()).toHaveLength(1);
      expect(state.get().programs.flatMap((program) => program.agents)[0]?.hookLifecycleAt)
        .toBe("2026-08-13T10:10:00.000Z");

      await appendFile(transcriptPath, `${JSON.stringify({
        type: "event_msg",
        timestamp: "2026-08-13T10:10:30.000Z",
        payload: { type: "user_message", message: "Use the first option." },
      })}\n`);
      await state.refresh();
      expect(ackStore.list()).toHaveLength(1);

      hookRecordUpdatedAt = Date.parse("2026-08-13T10:11:00.000Z") / 1_000;
      await appendFile(transcriptPath, [
        JSON.stringify({
          type: "response_item",
          timestamp: "2026-08-13T10:11:00.000Z",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Should I publish the result?" }],
          },
        }),
      ].join("\n") + "\n");
      await writeHookRecord();
      await state.refresh();
      expect(state.get().acks).toEqual([]);
      expect(ackStore.list()).toEqual([]);

      expect((await fetch(request("PUT"))).status).toBe(200);
      const removed = await fetch(request("DELETE"));
      expect(removed.status).toBe(200);
      expect(await removed.json()).toEqual({ ok: true, agentId: "codex:ack-agent" });
      expect(state.get().acks).toEqual([]);

      hookLifecycle = "idle";
      hookRecordUpdatedAt = Date.parse("2026-08-13T10:12:00.000Z") / 1_000;
      await appendFile(transcriptPath, `${JSON.stringify({
        type: "response_item",
        timestamp: "2026-08-13T10:12:00.000Z",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Implemented locally." }],
        },
      })}\n`);
      await writeHookRecord();
      await state.refresh();
      const quiet = await fetch(request("PUT"));
      expect(quiet.status).toBe(409);
      expect(await quiet.json()).toMatchObject({ error: { code: "AGENT_NOT_ALERTING" } });
    } finally {
      fetch.dispose();
      await rm(home, { recursive: true, force: true });
    }
  });
});
