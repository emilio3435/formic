import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMountainFetch, type MountainAppState } from "../src/server/app";
import { transcriptLines, transcriptResponse } from "../src/server/debug-identity";
import type { AgentSnapshot, HubSnapshot } from "../src/shared/types";
import type { ArchiveStore, CmuxSurface, CommandRunner } from "../src/server/types";

const AGENT_ID = "claude:019f86c4-1558-7000-aeb8-26e2cfd0e8ec";

function linkedAgent(): AgentSnapshot {
  return {
    id: AGENT_ID,
    provider: "claude",
    sourceSessionId: "019f86c4-1558-7000-aeb8-26e2cfd0e8ec",
    displayName: "Identity fixture",
    programId: "fixture",
    status: "running",
    statusReason: "Fixture is active.",
    controlState: "linked",
    lastHumanMessage: null,
    updatedAt: "2026-07-23T06:00:00.000Z",
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    target: {
      resolution: "exact",
      surfaceId: "SURFACE-HEALTH",
      workspaceId: "WORKSPACE-HEALTH",
      paneId: "PANE-HEALTH",
      reason: "Matched source session ID recorded by cmux.",
    },
    identityTrace: {
      steps: [
        { tier: "recorded", outcome: "skipped", detail: "No recorded cmux target IDs on this source." },
        {
          tier: "session",
          outcome: "matched",
          detail: "Source session ID 019f86c4-1558-7000-aeb8-26e2cfd0e8ec recorded by cmux on surface SURFACE-HEALTH.",
        },
      ],
      matchedTier: "session",
      resolution: "exact",
      reason: "Matched source session ID recorded by cmux.",
      surfaceId: "SURFACE-HEALTH",
    },
    controls: [],
  };
}

function quarantinedAgent(): AgentSnapshot {
  const agent = linkedAgent();
  return {
    ...agent,
    id: "codex:33333333-3333-4333-8333-333333333333",
    provider: "codex",
    sourceSessionId: "33333333-3333-4333-8333-333333333333",
    controlState: "quarantined",
    target: {
      resolution: "ambiguous",
      reason: "cmux surface is quarantined because exact identity evidence conflicts: conflicting open agent session files",
    },
    identityTrace: {
      steps: [
        { tier: "recorded", outcome: "skipped", detail: "No recorded cmux target IDs on this source." },
        { tier: "session", outcome: "quarantined", detail: "Session-matched surface has an identity conflict." },
      ],
      resolution: "ambiguous",
    },
  };
}

function snapshot(): HubSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-23T06:00:00.000Z",
    controlHealth: { cmuxReachable: true, lastCheckedAt: "2026-07-23T06:00:00.000Z", errors: [], staleSources: [] },
    totals: { live: 2, tracked: 2, attention: 0 },
    programs: [{ id: "fixture", name: "Fixture", agents: [linkedAgent(), quarantinedAgent()] }],
  };
}

const surfaces: CmuxSurface[] = [
  {
    surfaceId: "SURFACE-HEALTH",
    workspaceId: "WORKSPACE-HEALTH",
    paneId: "PANE-HEALTH",
    tty: "ttys033",
    sourceSessionClaims: [{
      provider: "claude",
      sessionId: "019f86c4-1558-7000-aeb8-26e2cfd0e8ec",
    }],
    sourceSessionIds: ["019f86c4-1558-7000-aeb8-26e2cfd0e8ec"],
    identityTrace: {
      surfaceId: "SURFACE-HEALTH",
      tty: "ttys033",
      processes: [{
        pid: 4242,
        command: "claude --resume --api-key super-secret",
        recognizedAgentProcess: true,
      }],
      openFileMatches: [
        {
          pid: 4242,
          path: "/Users/me/.claude/projects/p/019f86c4-1558-7000-aeb8-26e2cfd0e8ec.jsonl",
          provider: "claude",
          sessionId: "019f86c4-1558-7000-aeb8-26e2cfd0e8ec",
        },
      ],
      commandHints: [],
      outcome: "open-file-match",
      sourceSessionIds: ["019f86c4-1558-7000-aeb8-26e2cfd0e8ec"],
    },
  },
  {
    surfaceId: "SURFACE-CONFLICT",
    workspaceId: "WORKSPACE-CONFLICT",
    paneId: "PANE-CONFLICT",
    tty: "ttys005",
    sourceSessionIds: [],
    identityConflict: "cmux SURFACE-CONFLICT has conflicting open agent session files on ttys005",
  },
];

function appFetch() {
  const state: MountainAppState = {
    get: snapshot,
    subscribe: () => () => {},
    refresh: async () => snapshot(),
    surfaces: () => surfaces,
  };
  const runner: CommandRunner = {
    run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
  };
  const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
  return createMountainFetch({ state, runner, archiveStore, webRoot: import.meta.dir });
}

describe("read-only identity debug endpoint", () => {
  test("CWD-SEM-2 debug summaries report the optional neutral directory relation", async () => {
    const fetch = appFetch();
    const current = snapshot();
    current.programs[0]!.agents[0]!.target.cwdRelation = "different";
    const state: MountainAppState = {
      get: () => current,
      subscribe: () => () => {},
      refresh: async () => current,
      surfaces: () => surfaces,
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    fetch.dispose();
    const relationFetch = createMountainFetch({ state, runner, archiveStore, webRoot: import.meta.dir });

    const response = await relationFetch(new Request("http://127.0.0.1:4701/api/debug/identity"));
    const body = await response.json();

    expect(body.agents[0]).toMatchObject({ cwdRelation: "different" });
    expect(body.agents[1]).not.toHaveProperty("cwdRelation");
    relationFetch.dispose();
  });

  test("GET /api/debug/identity summarizes every agent with tier and conflict flags", async () => {
    const fetch = appFetch();
    const response = await fetch(new Request("http://127.0.0.1:4701/api/debug/identity"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      surfaceCount: 2,
      conflictedSurfaceIds: ["SURFACE-CONFLICT"],
    });
    expect(body.agents).toEqual([
      {
        id: AGENT_ID,
        provider: "claude",
        resolution: "exact",
        tier: "session",
        surfaceId: "SURFACE-HEALTH",
        quarantined: false,
        bindingBridged: false,
      },
      {
        id: "codex:33333333-3333-4333-8333-333333333333",
        provider: "codex",
        resolution: "ambiguous",
        quarantined: true,
        bindingBridged: false,
      },
    ]);
    fetch.dispose();
  });

  test("?agent= returns the full trace and related surface evidence for one agent", async () => {
    const fetch = appFetch();
    const response = await fetch(
      new Request(`http://127.0.0.1:4701/api/debug/identity?agent=${encodeURIComponent(AGENT_ID)}`),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.agent).toMatchObject({
      id: AGENT_ID,
      resolution: "exact",
      tier: "session",
      sourceSessionId: "019f86c4-1558-7000-aeb8-26e2cfd0e8ec",
      target: { surfaceId: "SURFACE-HEALTH" },
    });
    expect(body.agent.trace.steps).toHaveLength(2);
    expect(body.relatedSurfaces).toHaveLength(2);
    expect(body.relatedSurfaces[0]).toMatchObject({
      surfaceId: "SURFACE-HEALTH",
      routeObservation: {
        reportedSessionIds: ["019f86c4-1558-7000-aeb8-26e2cfd0e8ec"],
        reportedSessionClaims: [{
          provider: "claude",
          sessionId: "019f86c4-1558-7000-aeb8-26e2cfd0e8ec",
        }],
        sessionIdMatched: true,
        reason: "Pane PANE-HEALTH (surface SURFACE-HEALTH, ttys033) reported claude:019f86c4-1558-7000-aeb8-26e2cfd0e8ec.",
      },
      identityTrace: {
        outcome: "open-file-match",
        processes: [{ pid: 4242, command: "[redacted]", recognizedAgentProcess: true }],
      },
    });
    expect(body.relatedSurfaces[1]).toMatchObject({
      surfaceId: "SURFACE-CONFLICT",
      paneId: "PANE-CONFLICT",
      sourceSessionIds: [],
      routeObservation: {
        reportedSessionIds: [],
        reportedSessionClaims: [],
        sessionIdMatched: false,
        reason: "Pane PANE-CONFLICT (surface SURFACE-CONFLICT, ttys005) reported no source session IDs; source session 019f86c4-1558-7000-aeb8-26e2cfd0e8ec could not match.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("super-secret");
    fetch.dispose();
  });

  test("retained stale panes stay visible as non-authoritative debug evidence", async () => {
    const current = snapshot();
    const staleSurface: CmuxSurface = {
      ...surfaces[0]!,
      runtimeSurfaceReady: false,
      sourceSessionClaims: [],
      sourceSessionIds: [],
      identityTrace: {
        surfaceId: "SURFACE-HEALTH",
        tty: "ttys033",
        processes: [],
        openFileMatches: [],
        commandHints: [],
        outcome: "stale-surface",
        sourceSessionIds: [],
      },
    };
    const state: MountainAppState = {
      get: () => current,
      subscribe: () => () => {},
      refresh: async () => current,
      surfaces: () => [staleSurface],
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    const fetch = createMountainFetch({ state, runner, archiveStore, webRoot: import.meta.dir });

    const response = await fetch(
      new Request(`http://127.0.0.1:4701/api/debug/identity?agent=${encodeURIComponent(AGENT_ID)}`),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.relatedSurfaces).toEqual([
      expect.objectContaining({
        surfaceId: "SURFACE-HEALTH",
        runtimeSurfaceReady: false,
        sourceSessionClaims: [],
        sourceSessionIds: [],
        identityTrace: expect.objectContaining({
          outcome: "stale-surface",
          processes: [],
          openFileMatches: [],
          commandHints: [],
          sourceSessionIds: [],
        }),
      }),
    ]);
    fetch.dispose();
  });

  test("an unbound agent receives the observation from every pane the resolver scanned", async () => {
    const fetch = appFetch();
    const agentId = "codex:33333333-3333-4333-8333-333333333333";
    const response = await fetch(
      new Request(`http://127.0.0.1:4701/api/debug/identity?agent=${encodeURIComponent(agentId)}`),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.relatedSurfaces.map((surface: any) => surface.paneId)).toEqual([
      "PANE-HEALTH",
      "PANE-CONFLICT",
    ]);
    expect(body.relatedSurfaces.map((surface: any) => surface.routeObservation)).toEqual([
      {
        workspaceId: "WORKSPACE-HEALTH",
        surfaceId: "SURFACE-HEALTH",
        paneId: "PANE-HEALTH",
        tty: "ttys033",
        reportedSessionIds: ["019f86c4-1558-7000-aeb8-26e2cfd0e8ec"],
        reportedSessionClaims: [{
          provider: "claude",
          sessionId: "019f86c4-1558-7000-aeb8-26e2cfd0e8ec",
        }],
        sessionIdMatched: false,
        cwdMatched: false,
        reason: "Pane PANE-HEALTH (surface SURFACE-HEALTH, ttys033) reported claude:019f86c4-1558-7000-aeb8-26e2cfd0e8ec; none safely matches codex:33333333-3333-4333-8333-333333333333.",
      },
      {
        workspaceId: "WORKSPACE-CONFLICT",
        surfaceId: "SURFACE-CONFLICT",
        paneId: "PANE-CONFLICT",
        tty: "ttys005",
        reportedSessionIds: [],
        reportedSessionClaims: [],
        sessionIdMatched: false,
        cwdMatched: false,
        reason: "Pane PANE-CONFLICT (surface SURFACE-CONFLICT, ttys005) reported no source session IDs; source session 33333333-3333-4333-8333-333333333333 could not match.",
      },
    ]);
    fetch.dispose();
  });

  test("an unknown agent id is a structured 404", async () => {
    const fetch = appFetch();
    const response = await fetch(
      new Request("http://127.0.0.1:4701/api/debug/identity?agent=codex%3Amissing"),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: "AGENT_NOT_FOUND", message: "The agent is not present in the current snapshot." },
    });
    fetch.dispose();
  });

  test("the endpoint stays read-only: POST falls through to the API 404", async () => {
    const fetch = appFetch();
    const response = await fetch(
      new Request("http://127.0.0.1:4701/api/debug/identity", { method: "POST" }),
    );

    expect(response.status).toBe(404);
    fetch.dispose();
  });
});

describe("Grok Build ACP transcript lines", () => {
  const grok = { provider: "grok" } as AgentSnapshot;
  const fixture = readFileSync(join(import.meta.dir, "fixtures/grok-session/updates.jsonl"), "utf8");

  test("T-updates-speech: user and assistant ACP chunks become coalesced speech lines", () => {
    expect(transcriptLines(grok, fixture)).toEqual([
      {
        at: "2026-08-15T20:00:30.000Z",
        role: "user",
        text: "Add Grok Build to the board.",
      },
      {
        at: "2026-08-15T20:02:00.000Z",
        role: "assistant",
        text: "The Grok collector is wired and verified.",
      },
    ]);
  });

  test("T-thought: thought chunks become one Thought-prefixed system line", () => {
    const raw = [
      {
        timestamp: 1_786_824_121,
        method: "_x.ai/session/update",
        params: {
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: "Check the collector" },
          },
        },
      },
      {
        timestamp: 1_786_824_122,
        method: "_x.ai/session/update",
        params: {
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: " before changing it." },
          },
        },
      },
    ].map((row) => JSON.stringify(row)).join("\n");

    expect(transcriptLines(grok, raw)).toEqual([{
      at: "2026-08-15T20:02:01.000Z",
      role: "system",
      text: "Thought\nCheck the collector before changing it.",
    }]);
  });

  test("T-tool: call updates coalesce to one tool line with title, status, duration, and output", () => {
    const raw = [
      {
        timestamp: 1_786_824_123,
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "call-1",
            title: "Inspect collector files",
          },
        },
      },
      {
        timestamp: 1_786_824_124,
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "call-1",
            status: "completed",
            rawOutput: { type: "command", output: [102, 111, 117, 110, 100] },
          },
        },
      },
      {
        timestamp: 1_786_824_125,
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "call-1",
            status: "completed",
          },
        },
      },
    ].map((row) => JSON.stringify(row)).join("\n");

    const lines = transcriptLines(grok, raw);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ role: "tool", at: "2026-08-15T20:02:03.000Z" });
    expect(lines[0]?.text).toContain("Inspect collector files");
    expect(lines[0]?.text).toContain("completed");
    expect(lines[0]?.text).toContain("2s");
    expect(lines[0]?.text).toContain("found");
  });

  test("T-skip-hooks: hook and other non-feed updates produce no lines", () => {
    const skipped = [
      "hook_execution",
      "session_recap",
      "auto_compact_started",
      "compaction_completed",
      "retry_state",
      "image_dropped",
      "plan",
      "subagent_started",
      "task_started",
    ].map((sessionUpdate) => JSON.stringify({
      timestamp: 1_786_824_126,
      method: "session/update",
      params: { update: { sessionUpdate, content: { type: "text", text: "not feed text" } } },
    })).join("\n");

    expect(transcriptLines(grok, skipped)).toEqual([]);
  });

  test("T-empty-is-not-success-for-populated-file: the populated speech fixture is non-empty", () => {
    const lines = transcriptLines(grok, fixture);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.map((line) => line.role)).toEqual(["user", "assistant"]);
  });

  test("T-chat-history-enrichment: sibling history fills assistant speech and tool result bodies", async () => {
    const root = mkdtempSync(join(tmpdir(), "formic-grok-transcript-"));
    const source = join(root, "updates.jsonl");
    writeFileSync(source, [
      {
        timestamp: 1_786_824_123,
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "" },
          },
        },
      },
      {
        timestamp: 1_786_824_124,
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "call-history",
            title: "Read the session",
          },
        },
      },
    ].map((row) => JSON.stringify(row)).join("\n"));
    writeFileSync(join(root, "chat_history.jsonl"), [
      { type: "assistant", content: "Recovered assistant turn.", tool_calls: [] },
      { type: "reasoning", encrypted_content: "ciphertext" },
      { type: "tool_result", tool_call_id: "call-history", content: "Recovered tool result." },
    ].map((row) => JSON.stringify(row)).join("\n"));
    const agent = {
      ...linkedAgent(),
      id: "grok:fixture",
      provider: "grok",
      sourceSessionId: "fixture",
      artifacts: [{ label: "GROK transcript", path: source, kind: "transcript" }],
    } as AgentSnapshot;
    const current = snapshot();
    current.programs[0]!.agents = [agent];

    const response = await transcriptResponse(current, agent.id, 200, {});
    const body = await response.json();

    expect(body.lines.map((line: { role: string }) => line.role)).toEqual(["assistant", "tool"]);
    expect(body.lines[0].text).toBe("Recovered assistant turn.");
    expect(body.lines[1].text).toContain("Recovered tool result.");
    expect(JSON.stringify(body)).not.toContain("ciphertext");
  });
});

describe("Grok Bot replica transcript lines", () => {
  const NOW = Date.parse("2026-08-16T12:00:00.000Z");
  const grok = { provider: "grok" } as AgentSnapshot;

  test("T-replica-untouched: a schemaVersion 1 replica still yields user and assistant lines", () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      value: {
        entries: [
          {
            kind: "message",
            role: "user",
            content: "Please parse the persisted conversation.",
            timestampMs: NOW - 4_000,
          },
          {
            kind: "send-message",
            message: { type: "text", content: "Parsed the Grok Bot transcript." },
            timestampMs: NOW - 3_000,
          },
          {
            kind: "message",
            role: "user",
            content: "Ship the closer next.",
            timestampMs: NOW - 2_000,
          },
          {
            kind: "send-message",
            message: "Shipped the closer from send-message.",
            timestampMs: NOW - 1_000,
          },
        ],
      },
    });

    const lines = transcriptLines(grok, raw);
    expect(lines).toHaveLength(4);
    expect(lines.map((line) => line.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(lines.map((line) => line.text)).toEqual([
      "Please parse the persisted conversation.",
      "Parsed the Grok Bot transcript.",
      "Ship the closer next.",
      "Shipped the closer from send-message.",
    ]);
    expect(lines.map((line) => line.at)).toEqual([
      new Date(NOW - 4_000).toISOString(),
      new Date(NOW - 3_000).toISOString(),
      new Date(NOW - 2_000).toISOString(),
      new Date(NOW - 1_000).toISOString(),
    ]);
  });

  test("skips attachment, widget, cursor-agent, and inter-agent assistant copies", () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      value: {
        entries: [
          { kind: "message", role: "user", content: "Look at this file.", timestampMs: NOW - 6_000 },
          { kind: "user-attachment", timestampMs: NOW - 5_500 },
          { kind: "send-message", message: { type: "attachment", name: "notes.md" }, timestampMs: NOW - 5_000 },
          { kind: "send-message", message: { type: "widget", id: "card-1" }, timestampMs: NOW - 4_500 },
          { kind: "send-message", message: { type: "cursor-agent", id: "agent-1" }, timestampMs: NOW - 4_000 },
          { kind: "send-message", message: { type: "text", content: "Here is the close after the cards." }, timestampMs: NOW - 3_000 },
          {
            kind: "message",
            role: "assistant",
            toAgent: "other-bot",
            content: "Inter-agent copy must not become inspector speech.",
            timestampMs: NOW - 2_000,
          },
        ],
      },
    });

    expect(transcriptLines(grok, raw)).toEqual([
      {
        at: new Date(NOW - 6_000).toISOString(),
        role: "user",
        text: "Look at this file.",
      },
      {
        at: new Date(NOW - 3_000).toISOString(),
        role: "assistant",
        text: "Here is the close after the cards.",
      },
    ]);
  });
});
