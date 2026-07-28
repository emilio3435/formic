import { describe, expect, test } from "bun:test";
import { createMountainFetch, type MountainAppState } from "../src/server/app";
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
        cwdMismatch: false,
        bindingBridged: false,
      },
      {
        id: "codex:33333333-3333-4333-8333-333333333333",
        provider: "codex",
        resolution: "ambiguous",
        quarantined: true,
        cwdMismatch: false,
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
    expect(body.relatedSurfaces).toHaveLength(1);
    expect(body.relatedSurfaces[0]).toMatchObject({
      surfaceId: "SURFACE-HEALTH",
      identityTrace: {
        outcome: "open-file-match",
        processes: [{ pid: 4242, command: "[redacted]", recognizedAgentProcess: true }],
      },
    });
    expect(JSON.stringify(body)).not.toContain("super-secret");
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
