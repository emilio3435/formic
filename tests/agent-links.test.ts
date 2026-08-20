import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentLinkFetch } from "../src/server/agent-links";
import { readHookSessionStores } from "../src/server/cmux-hook-sessions";
import type { AgentSnapshot, HubSnapshot } from "../src/shared/types";
import type { ArchiveStore, CmuxSurface, CommandResult, CommandRunner } from "../src/server/types";

const temporaryRoots: string[] = [];

class StubRunner implements CommandRunner {
  readonly commands: string[][] = [];

  async run(command: readonly string[]): Promise<CommandResult> {
    this.commands.push([...command]);
    return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
  }
}

const archiveStore: ArchiveStore = {
  has: () => false,
  archive: async () => {},
};

function snapshotAgent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: "codex:live-session",
    provider: "codex",
    sourceSessionId: "live-session",
    displayName: "Live session",
    programId: "test-program",
    status: "running",
    statusReason: "Working.",
    lifecycle: "working",
    scope: "observed",
    lastHumanMessage: null,
    updatedAt: "2026-08-05T13:00:00.000Z",
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    target: { resolution: "missing", reason: "Snapshot did not have a target." },
    controls: [{ action: "focus", enabled: false, reason: "Snapshot did not have a target." }],
    ...overrides,
  };
}

function snapshot(agent: AgentSnapshot): HubSnapshot {
  return {
    generatedAt: "2026-08-05T13:00:00.000Z",
    totals: { live: 1, tracked: 1, attention: 0 },
    programs: [{ id: "test-program", name: "Test program", agents: [agent] }],
  } as HubSnapshot;
}

function surface(surfaceId = "HOOK-SURFACE"): CmuxSurface {
  return {
    workspaceId: "HOOK-WORKSPACE",
    surfaceId,
    cwd: "/tmp/agent-links-project",
    runtimeSurfaceReady: true,
    sourceSessionIds: [],
  };
}

function loadHookStore(input: {
  sessionId: string;
  lifecycle: "running" | "ended";
  transcriptPath?: string;
}): void {
  const root = mkdtempSync(join(tmpdir(), "anthill-agent-links-"));
  temporaryRoots.push(root);
  writeFileSync(join(root, "codex-hook-sessions.json"), JSON.stringify({
    version: 1,
    sessions: {
      [input.sessionId]: {
        sessionId: input.sessionId,
        surfaceId: "HOOK-SURFACE",
        workspaceId: "HOOK-WORKSPACE",
        cwd: "/tmp/agent-links-project",
        pid: 4242,
        agentLifecycle: input.lifecycle,
        transcriptPath: input.transcriptPath,
        updatedAt: 1_785_933_010.5,
      },
    },
  }));
  readHookSessionStores(root);
}

afterEach(() => {
  readHookSessionStores(join(tmpdir(), "anthill-agent-links-missing"));
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("durable agent focus links", () => {
  test("a last-known provider row cannot re-attest Focus through a durable link", async () => {
    loadHookStore({ sessionId: "live-session", lifecycle: "running" });
    const runner = new StubRunner();
    const agent = snapshotAgent({ sourceFreshness: "last-known" });
    const fetch = createAgentLinkFetch(
      () => new Response("fallback", { status: 418 }),
      {
        getSnapshot: () => snapshot(agent),
        surfaces: () => [surface()],
        runner,
        archiveStore,
        cmuxExecutable: "cmux",
      },
    );

    const response = await fetch(new Request(
      `http://127.0.0.1:4701/agent/${encodeURIComponent(agent.id)}/focus`,
    ));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "CONTROL_DISABLED" },
    });
    expect(runner.commands).toHaveLength(0);
  });

  test("a Gemini missing exact target cannot Focus through unique-cwd", async () => {
    const runner = new StubRunner();
    const agent = snapshotAgent({
      id: "gemini:abcd1234-e5f6-7890-abcd-ef1234567890",
      provider: "gemini",
      sourceSessionId: "abcd1234-e5f6-7890-abcd-ef1234567890",
      cwd: "/tmp/agent-links-project",
      target: {
        resolution: "missing",
        reason: "This harness requires exact cmux identity; cwd fallback is disabled.",
      },
      controls: [{
        action: "focus",
        enabled: false,
        reason: "This harness requires exact cmux identity; cwd fallback is disabled.",
      }],
    });
    const fetch = createAgentLinkFetch(
      () => new Response("fallback", { status: 418 }),
      {
        getSnapshot: () => snapshot(agent),
        surfaces: () => [surface("SURFACE-CWD-ONLY")],
        runner,
        archiveStore,
        cmuxExecutable: "cmux",
      },
    );

    const response = await fetch(new Request(
      `http://127.0.0.1:4701/agent/${encodeURIComponent(agent.id)}/focus`,
    ));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: "CONTROL_DISABLED" } });
    expect(body.error.message).toMatch(/exact cmux identity/);
    expect(runner.commands).toHaveLength(0);
  });

  test("a Pi durable link with no target issues zero cmux commands", async () => {
    const runner = new StubRunner();
    const agent = snapshotAgent({
      id: "pi:pi.native_2026-08-20",
      provider: "pi" as never,
      sourceSessionId: "pi.native_2026-08-20",
      cwd: "/tmp/agent-links-project",
      target: {
        resolution: "missing",
        reason: "This harness requires exact cmux identity; cwd fallback is disabled.",
      },
      controls: [{
        action: "focus",
        enabled: false,
        reason: "This harness requires exact cmux identity; cwd fallback is disabled.",
      }],
    });
    const fetch = createAgentLinkFetch(
      () => new Response("fallback", { status: 418 }),
      {
        getSnapshot: () => snapshot(agent),
        surfaces: () => [],
        runner,
        archiveStore,
        cmuxExecutable: "cmux",
      },
    );

    const response = await fetch(new Request(
      `http://127.0.0.1:4701/agent/${encodeURIComponent(agent.id)}/focus`,
    ));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "CONTROL_DISABLED" } });
    expect(runner.commands).toHaveLength(0);
  });

  test("a Pi durable link preserves exact-only routing and issues zero commands for unique same cwd", async () => {
    const runner = new StubRunner();
    const agent = snapshotAgent({
      id: "pi:pi.native_2026-08-20",
      provider: "pi" as never,
      sourceSessionId: "pi.native_2026-08-20",
      cwd: "/tmp/agent-links-project",
      target: {
        resolution: "missing",
        reason: "This harness requires exact cmux identity; cwd fallback is disabled.",
      },
      controls: [{
        action: "focus",
        enabled: false,
        reason: "This harness requires exact cmux identity; cwd fallback is disabled.",
      }],
    });
    const fetch = createAgentLinkFetch(
      () => new Response("fallback", { status: 418 }),
      {
        getSnapshot: () => snapshot(agent),
        surfaces: () => [surface("PI-CWD-ONLY")],
        runner,
        archiveStore,
        cmuxExecutable: "cmux",
      },
    );

    const response = await fetch(new Request(
      `http://127.0.0.1:4701/agent/${encodeURIComponent(agent.id)}/focus`,
    ));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: "CONTROL_DISABLED" } });
    expect(body.error.message).toMatch(/exact cmux identity/);
    expect(runner.commands).toHaveLength(0);
  });

  test("an exact agent URL re-resolves through the hook-store tier and focuses that surface", async () => {
    loadHookStore({ sessionId: "live-session", lifecycle: "running" });
    const runner = new StubRunner();
    const agent = snapshotAgent();
    const fetch = createAgentLinkFetch(
      () => new Response("fallback", { status: 418 }),
      {
        getSnapshot: () => snapshot(agent),
        surfaces: () => [surface()],
        runner,
        archiveStore,
        cmuxExecutable: "cmux",
      },
    );

    const response = await fetch(new Request(
      `http://127.0.0.1:4701/agent/${encodeURIComponent(agent.id)}/focus`,
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      cmuxTarget: {
        attestation: "hook-store",
        workspaceId: "HOOK-WORKSPACE",
        surfaceId: "HOOK-SURFACE",
        resolution: "exact",
      },
    });
    expect(runner.commands).toEqual([
      ["cmux", "rpc", "surface.focus", JSON.stringify({ surface_id: "HOOK-SURFACE" })],
    ]);
  });

  test("re-resolution follows current session evidence instead of a previous live target", async () => {
    const runner = new StubRunner();
    const agent = snapshotAgent({
      target: {
        attestation: "live",
        workspaceId: "OLD-WORKSPACE",
        surfaceId: "OLD-SURFACE",
        resolution: "exact",
        reason: "Previous live scan.",
      },
      controls: [{ action: "focus", enabled: true }],
    });
    const fetch = createAgentLinkFetch(
      () => new Response("fallback", { status: 418 }),
      {
        getSnapshot: () => snapshot(agent),
        surfaces: () => [
          {
            workspaceId: "OLD-WORKSPACE",
            surfaceId: "OLD-SURFACE",
            cwd: "/tmp/other-project",
            runtimeSurfaceReady: true,
            sourceSessionIds: ["someone-else"],
          },
          {
            workspaceId: "CURRENT-WORKSPACE",
            surfaceId: "CURRENT-SURFACE",
            cwd: "/tmp/agent-links-project",
            runtimeSurfaceReady: true,
            sourceSessionIds: [agent.sourceSessionId],
          },
        ],
        runner,
        archiveStore,
        cmuxExecutable: "cmux",
      },
    );

    const response = await fetch(new Request(
      `http://127.0.0.1:4701/agent/${encodeURIComponent(agent.id)}/focus`,
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      cmuxTarget: { workspaceId: "CURRENT-WORKSPACE", surfaceId: "CURRENT-SURFACE" },
    });
    expect(runner.commands).toEqual([
      ["cmux", "rpc", "surface.focus", JSON.stringify({ surface_id: "CURRENT-SURFACE" })],
    ]);
  });

  test("an ended hook session resolves to its transcript without focusing a terminal", async () => {
    const transcriptPath = "/Users/example/.codex/sessions/ended-session.jsonl";
    loadHookStore({ sessionId: "ended-session", lifecycle: "ended", transcriptPath });
    const runner = new StubRunner();
    const agent = snapshotAgent({
      id: "codex:ended-session",
      sourceSessionId: "ended-session",
      hookLifecycle: "ended",
      lifecycle: "working",
    });
    const fetch = createAgentLinkFetch(
      () => new Response("fallback", { status: 418 }),
      {
        getSnapshot: () => snapshot(agent),
        surfaces: () => [surface()],
        runner,
        archiveStore,
      },
    );

    const response = await fetch(new Request(
      `http://127.0.0.1:4701/agent/${encodeURIComponent(agent.id)}/focus`,
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ transcriptPath });
    expect(runner.commands).toHaveLength(0);
  });

  test("a retired session falls back to its collected transcript artifact", async () => {
    const transcriptPath = "/Users/example/.codex/sessions/deleted-worktree.jsonl";
    const runner = new StubRunner();
    const agent = snapshotAgent({
      id: "codex:deleted-worktree",
      sourceSessionId: "deleted-worktree",
      lifecycle: "finished",
      endEvidence: "worktree-deleted",
      artifacts: [{ label: "Codex transcript", path: transcriptPath, kind: "transcript" }],
    });
    const fetch = createAgentLinkFetch(
      () => new Response("fallback", { status: 418 }),
      {
        getSnapshot: () => snapshot(agent),
        surfaces: () => [],
        runner,
        archiveStore,
      },
    );

    const response = await fetch(new Request(
      `http://127.0.0.1:4701/agent/${encodeURIComponent(agent.id)}/focus`,
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ transcriptPath });
    expect(runner.commands).toHaveLength(0);
  });

  test("non-link requests fall through and link lookup uses the full agent id", async () => {
    const runner = new StubRunner();
    const agent = snapshotAgent();
    let fallthroughs = 0;
    const fetch = createAgentLinkFetch(
      () => {
        fallthroughs += 1;
        return new Response("fallback", { status: 418 });
      },
      {
        getSnapshot: () => snapshot(agent),
        surfaces: () => [],
        runner,
        archiveStore,
      },
    );

    const ordinary = await fetch(new Request("http://127.0.0.1:4701/api/snapshot"));
    const prefix = await fetch(new Request("http://127.0.0.1:4701/agent/codex%3Alive/focus"));

    expect(ordinary.status).toBe(418);
    expect(prefix.status).toBe(404);
    expect((await prefix.json()).error.code).toBe("AGENT_NOT_FOUND");
    expect(fallthroughs).toBe(1);
    expect(runner.commands).toHaveLength(0);
  });
});
