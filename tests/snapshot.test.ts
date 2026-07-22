import { describe, expect, test } from "bun:test";
import { buildSnapshot, snapshotFingerprint } from "../src/server/snapshot";
import type { ArchiveStore, CmuxSurface, CollectedAgent } from "../src/server/types";

const archiveStore: ArchiveStore = {
  has: () => false,
  archive: async () => {},
};

function collected(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: "codex:test-session",
    provider: "codex",
    sourceSessionId: "test-session",
    displayName: "Test session",
    cwd: "/Users/emilionunezgarcia/Developer/unique-project",
    status: "running",
    statusReason: "Fixture activity is recent.",
    startedAt: "2026-07-21T20:00:00.000Z",
    updatedAt: "2026-07-21T23:00:00.000Z",
    tokens: { total: 42, provenance: "observed" },
    transcriptTail: "Safe routing is under test.",
    artifacts: [],
    gates: [],
    ...overrides,
  };
}

const uniqueSurface: CmuxSurface = {
  workspaceId: "WORKSPACE-UNIQUE",
  surfaceId: "SURFACE-UNIQUE",
  paneId: "PANE-UNIQUE",
  cwd: "/Users/emilionunezgarcia/Developer/unique-project",
  sourceSessionIds: [],
};

describe("snapshot control safety and SSE deduplication", () => {
  test.each([
    {
      label: "ambiguous",
      cwd: "/Users/emilionunezgarcia",
      surfaces: [
        { ...uniqueSurface, surfaceId: "SURFACE-A", cwd: "/Users/emilionunezgarcia" },
        { ...uniqueSurface, surfaceId: "SURFACE-B", cwd: "/Users/emilionunezgarcia" },
      ],
    },
    {
      label: "missing",
      cwd: "/Users/emilionunezgarcia/Developer/not-open",
      surfaces: [uniqueSurface],
    },
  ])("$label routes expose disabled mutating cmux controls", ({ cwd, surfaces }) => {
    const snapshot = buildSnapshot({
      agents: [collected({ cwd })],
      surfaces,
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });
    const agent = snapshot.programs[0]?.agents[0];

    expect(agent?.target.resolution).toBe(cwd.endsWith("not-open") ? "missing" : "ambiguous");
    expect(
      agent?.controls
        .filter(({ action }) => action !== "archive")
        .every(({ enabled, reason }) => !enabled && Boolean(reason)),
    ).toBe(true);
  });

  test("an identity-conflicted surface stays quarantined instead of re-enabling unique-cwd controls", () => {
    const snapshot = buildSnapshot({
      agents: [collected()],
      surfaces: [{
        ...uniqueSurface,
        identityConflict: "two allowlisted agent sessions are open on this tty",
      }],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });
    const agent = snapshot.programs[0]?.agents[0];

    expect(agent?.target).toMatchObject({
      resolution: "ambiguous",
      reason: expect.stringContaining("quarantined"),
    });
    expect(agent?.target.surfaceId).toBeUndefined();
    expect(
      agent?.controls
        .filter(({ action }) => action !== "archive")
        .every(({ enabled }) => !enabled),
    ).toBeTrue();
  });

  test("clock-only refreshes do not rebroadcast a large unchanged archive payload", () => {
    const agents = Array.from({ length: 200 }, (_, index) =>
      collected({
        id: `codex:archive-${index}`,
        sourceSessionId: `archive-${index}`,
        displayName: `Archived session ${index}`,
        status: "archived",
        transcriptTail: "x".repeat(2_000),
      }),
    );
    const first = buildSnapshot({
      agents,
      surfaces: [],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });
    const nextTick = buildSnapshot({
      agents,
      surfaces: [],
      archiveStore,
      now: new Date("2026-07-21T23:00:34.000Z"),
    });

    expect(JSON.stringify(first).length).toBeGreaterThan(400_000);
    expect(
      first.programs.flatMap(({ agents }) => agents).every(({ elapsedMs }) => elapsedMs === 10_800_000),
    ).toBe(true);
    expect(snapshotFingerprint(nextTick)).toBe(snapshotFingerprint(first));
  });

  test("a real routing change produces a new fingerprint and therefore an SSE update", () => {
    const withoutTarget = buildSnapshot({
      agents: [collected()],
      surfaces: [],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });
    const withTarget = buildSnapshot({
      agents: [collected()],
      surfaces: [uniqueSurface],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });

    expect(snapshotFingerprint(withTarget)).not.toBe(snapshotFingerprint(withoutTarget));
  });

  test("snapshot refresh time cannot masquerade as a new cmux collection check", () => {
    const cmuxAttempt = "2026-07-21T22:55:00.000Z";
    const first = buildSnapshot({
      agents: [collected()],
      surfaces: [uniqueSurface],
      archiveStore,
      cmuxLastCheckedAt: cmuxAttempt,
      now: new Date("2026-07-21T23:00:00.000Z"),
    });
    const laterSnapshot = buildSnapshot({
      agents: [collected()],
      surfaces: [uniqueSurface],
      archiveStore,
      cmuxLastCheckedAt: cmuxAttempt,
      now: new Date("2026-07-21T23:05:00.000Z"),
    });

    expect(first.generatedAt).not.toBe(laterSnapshot.generatedAt);
    expect(first.controlHealth.lastCheckedAt).toBe(cmuxAttempt);
    expect(laterSnapshot.controlHealth.lastCheckedAt).toBe(cmuxAttempt);
  });

  test("snapshot exposes the additive summary field and preserves explicit absence", () => {
    const withMessage = buildSnapshot({
      agents: [collected({ lastHumanMessage: "Readable provider prose." })],
      surfaces: [],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });
    const absent = buildSnapshot({
      agents: [collected({ task: undefined, lastHumanMessage: null })],
      surfaces: [],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });

    expect(withMessage.programs[0]?.agents[0]?.lastHumanMessage).toBe("Readable provider prose.");
    expect(absent.programs[0]?.agents[0]?.lastHumanMessage).toBeNull();
  });

  test("exact cmux project metadata groups a home-cwd source without rewriting source truth", () => {
    const source = collected({
      cwd: "/Users/emilionunezgarcia",
      task: "Continue the platform review.",
    });
    const snapshot = buildSnapshot({
      agents: [source],
      surfaces: [{
        ...uniqueSurface,
        cwd: "/Users/emilionunezgarcia/Developer/LaHormigaDormida",
        sourceSessionIds: [source.sourceSessionId],
        workspaceTitle: "CODEX - Platform UX",
      }],
      programHints: [{
        id: "hormiga",
        name: "Hormiga",
        match: ["lahormigadormida", "/developer/hd-"],
      }],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });
    const agent = snapshot.programs[0]?.agents[0];

    expect(snapshot.programs[0]?.name).toBe("Hormiga");
    expect(agent?.cwd).toBe("/Users/emilionunezgarcia");
    expect(agent?.target.resolution).toBe("exact");
  });

  test("a configured HD task hint groups a home-cwd source while unrelated home work stays unassigned", () => {
    const snapshot = buildSnapshot({
      agents: [
        collected({
          id: "codex:hd-task",
          sourceSessionId: "hd-task",
          cwd: "/Users/emilionunezgarcia",
          task: "Verify /Users/emilionunezgarcia/Developer/hd-settings-cockpit-layout-store-20260721.",
        }),
        collected({
          id: "codex:personal-task",
          sourceSessionId: "personal-task",
          cwd: "/Users/emilionunezgarcia",
          task: "Update my resume.",
        }),
      ],
      surfaces: [],
      programHints: [{
        id: "hormiga",
        name: "Hormiga",
        match: ["LaHormigaDormida", "/Developer/hd-"],
      }],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });

    expect(snapshot.programs.find(({ id }) => id === "hormiga")?.agents.map(({ id }) => id)).toEqual([
      "codex:hd-task",
    ]);
    expect(snapshot.programs.find(({ name }) => name === "Home / Unassigned")?.agents.map(({ id }) => id)).toEqual([
      "codex:personal-task",
    ]);
  });

  test("masthead tokens describe active work instead of archived provider history", () => {
    const snapshot = buildSnapshot({
      agents: [
        collected({ tokens: { total: 42, provenance: "observed" } }),
        collected({
          id: "codex:idle-lifetime",
          sourceSessionId: "idle-lifetime",
          status: "waiting",
          tokens: { total: 900_000, sessionTotal: 90_000_000, scope: "latest-turn", provenance: "observed" },
        }),
        collected({
          id: "omp:history",
          provider: "omp",
          sourceSessionId: "history",
          status: "archived",
          tokens: { total: 50_000, provenance: "observed" },
        }),
      ],
      surfaces: [],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });

    expect(snapshot.totals.tokens).toBe(42);
    expect(snapshot.totals.tokenReporting).toBe(1);
    expect(snapshot.totals.tokenEligible).toBe(1);
    expect(snapshot.totals.tokenMedian).toBe(42);
  });

  test("Cursor model policy distinguishes Grok, non-Grok, and unreported sessions", () => {
    const snapshot = buildSnapshot({
      agents: [
        collected({
          id: "cursor:grok",
          provider: "cursor",
          sourceSessionId: "grok",
          model: "cursor-grok-4.5-high-fast",
        }),
        collected({
          id: "cursor:unknown",
          provider: "cursor",
          sourceSessionId: "unknown",
          model: undefined,
          status: "waiting",
        }),
        collected({
          id: "cursor:child-mismatch",
          provider: "cursor",
          sourceSessionId: "child-mismatch",
          parentSourceSessionId: "grok",
          model: "gpt-5.6-sol-xhigh",
          status: "stale",
        }),
        collected({
          id: "cursor:active-child-mismatch",
          provider: "cursor",
          sourceSessionId: "active-child-mismatch",
          parentSourceSessionId: "grok",
          model: "claude-fable-5-thinking-high",
          status: "running",
        }),
      ],
      surfaces: [],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });
    const agents = snapshot.programs.flatMap(({ agents }) => agents);

    expect(agents.find(({ id }) => id === "cursor:grok")?.modelPolicy?.state).toBe("compliant");
    expect(agents.find(({ id }) => id === "cursor:unknown")?.modelPolicy?.state).toBe("unreported");
    expect(agents.find(({ id }) => id === "cursor:child-mismatch")?.modelPolicy).toMatchObject({
      state: "mismatch",
      expected: "cursor-grok-4.5-high-fast",
      observed: "gpt-5.6-sol-xhigh",
      evidence: "cursor-ai-tracking",
    });
    expect(agents.find(({ id }) => id === "cursor:active-child-mismatch")?.modelPolicy?.state).toBe("mismatch");
    expect(snapshot.totals.cursorModelHealth).toEqual({
      compliant: 1,
      mismatch: 1,
      unreported: 1,
      total: 3,
    });
    expect(snapshot.issues).toContainEqual(expect.objectContaining({
      id: "system:cursor-model-policy-active",
      title: "Cursor model routing mismatches",
      affectedAgentIds: ["cursor:active-child-mismatch"],
    }));
    expect(snapshot.issues).toContainEqual(expect.objectContaining({
      id: "system:cursor-model-policy-recent",
      title: "Recent Cursor model routing mismatches",
      affectedAgentIds: ["cursor:child-mismatch"],
    }));
  });

  test("provider-native statuses become one operator state language", () => {
    const snapshot = buildSnapshot({
      agents: [
        collected(),
        collected({
          id: "cursor:ended-turn",
          provider: "cursor",
          sourceSessionId: "ended-turn",
          status: "waiting",
          statusReason: "Cursor recorded the last turn as successfully ended.",
        }),
        collected({
          id: "codex:stale-history",
          sourceSessionId: "stale-history",
          status: "stale",
          updatedAt: "2026-07-21T20:00:00.000Z",
        }),
        collected({
          id: "codex:notification",
          sourceSessionId: "notification",
          status: "attention",
          statusReason: "Unread notification.",
        }),
      ],
      surfaces: [
        { ...uniqueSurface, sourceSessionIds: ["test-session"] },
        { ...uniqueSurface, surfaceId: "SURFACE-CURSOR", sourceSessionIds: ["ended-turn"] },
      ],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });
    const agents = snapshot.programs.flatMap(({ agents }) => agents);

    expect(agents.find(({ id }) => id === "codex:test-session")).toMatchObject({
      activity: "working",
      outcome: "healthy",
      controlState: "linked",
    });
    expect(agents.find(({ id }) => id === "cursor:ended-turn")).toMatchObject({
      activity: "idle",
      outcome: "healthy",
      controlState: "linked",
    });
    expect(agents.find(({ id }) => id === "codex:stale-history")?.activity).toBe("ended");
    expect(agents.find(({ id }) => id === "codex:notification")).toMatchObject({
      activity: "idle",
      outcome: "needs-you",
      controlState: "observed-only",
    });
    expect(snapshot.totals).toMatchObject({ working: 1, idle: 2, ended: 1, history: 1, needsYou: 1 });
  });

  test("cmux identity failures become one human-readable system issue", () => {
    const source = collected();
    const conflict = "conflicting open agent session files on ttys005";
    const snapshot = buildSnapshot({
      agents: [source],
      surfaces: [{ ...uniqueSurface, sourceSessionIds: [source.sourceSessionId], identityConflict: conflict }],
      cmuxErrors: [
        `cmux first has ${conflict}`,
        "cmux second has conflicting open agent session files on ttys003",
      ],
      cmuxReachable: true,
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });

    expect(snapshot.issues).toEqual([
      expect.objectContaining({
        id: "system:cmux-identity-conflicts",
        title: "CMUX identity conflicts",
        affectedAgentIds: [source.id],
        technicalDetails: expect.arrayContaining([expect.stringContaining("ttys003"), expect.stringContaining("ttys005")]),
      }),
    ]);
    expect(snapshot.totals.needsYou).toBe(1);
    expect(snapshot.totals.sourceHealth).toEqual({ healthy: 3, degraded: 1, total: 4 });
  });

  test("native parent IDs and roles produce swarm-ready program rollups", () => {
    const snapshot = buildSnapshot({
      agents: [
        collected({
          id: "codex:root",
          sourceSessionId: "root",
          displayName: "Settings delivery",
          task: "Coordinate the Settings delivery.",
        }),
        collected({
          id: "codex:child",
          sourceSessionId: "child",
          displayName: "Provider registry verifier",
          task: "Adversarially verify the provider registry.",
          parentSourceSessionId: "root",
          threadDepth: 1,
          nickname: "Fermat",
        }),
      ],
      surfaces: [],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });
    const program = snapshot.programs[0]!;
    const root = program.agents.find(({ id }) => id === "codex:root");
    const child = program.agents.find(({ id }) => id === "codex:child");

    expect(root?.role).toBe("orchestrator");
    expect(child).toMatchObject({
      role: "verifier",
      parentAgentId: "codex:root",
      threadDepth: 1,
      nickname: "Fermat",
    });
    expect(program.rollup).toMatchObject({ total: 2, live: 2, working: 2, linked: 0 });
  });
});
