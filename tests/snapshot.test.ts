import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildSnapshot,
  impactSummaryFor,
  issueWorkStateFor,
  snapshotFingerprint,
  withIssueDecoration,
  withPulse,
} from "../src/server/snapshot";
import { parseOmpJsonl } from "../src/server/collectors";
import {
  bridgeAgentsWithBindings,
  MemoryIdentityBindingStore,
  updateBindingsFromScan,
} from "../src/server/identity-bindings";
import { PulseTracker } from "../src/server/pulse";
import type { ArchiveStore, CmuxSurface, CollectedAgent } from "../src/server/types";
import type { HubPulse, IssueLifecycle, OperatorIssue } from "../src/shared/types";

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dir, "fixtures", name), "utf8");

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
  test("ships config-owned model display labels on the snapshot wire", () => {
    const snapshot = buildSnapshot({
      agents: [],
      surfaces: [],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });

    expect(snapshot.modelConfig?.displayLabels).toMatchObject({
      "claude-opus-4-8": "opus 4.8",
      "gpt-5.6-sol": "sol 5.6",
      "grok-4.5": "grok 4.5",
    });
  });

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

  test("stale elapsed time stops at the last observed activity", () => {
    const snapshot = buildSnapshot({
      agents: [collected({
        status: "stale",
        startedAt: "2026-07-21T20:00:00.000Z",
        updatedAt: "2026-07-21T20:05:00.000Z",
      })],
      surfaces: [],
      archiveStore,
      now: new Date("2026-07-23T20:00:00.000Z"),
    });

    expect(snapshot.programs[0]?.agents[0]?.elapsedMs).toBe(5 * 60 * 1_000);
  });

  test("process state distinguishes running, clean exit, death, and unknown without guessing", () => {
    const snapshot = buildSnapshot({
      agents: [
        collected({ id: "codex:running", sourceSessionId: "running", processIds: [101], processAlive: true }),
        collected({
          id: "omp:exited",
          provider: "omp",
          sourceSessionId: "exited",
          status: "archived",
          transcriptEndedCleanly: true,
        }),
        collected({ id: "codex:died", sourceSessionId: "died", processIds: [202], processAlive: false }),
        collected({ id: "claude:unknown", provider: "claude", sourceSessionId: "unknown" }),
      ],
      surfaces: [],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });
    const states = Object.fromEntries(
      snapshot.programs.flatMap(({ agents }) => agents).map(({ id, processState }) => [id, processState]),
    );

    expect(states).toEqual({
      "codex:running": "running",
      "omp:exited": "exited",
      "codex:died": "died",
      "claude:unknown": "unknown",
    });
  });

  test("identity traces are lazy for diagnostics and absent from snapshot JSON", () => {
    const source = collected();
    const snapshot = buildSnapshot({
      agents: [source],
      surfaces: [{ ...uniqueSurface, sourceSessionIds: [source.sourceSessionId] }],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });
    const agent = snapshot.programs[0]!.agents[0]!;

    expect(Object.getOwnPropertyDescriptor(agent, "identityTrace")?.get).toBeFunction();
    expect(JSON.stringify(snapshot)).not.toContain("identityTrace");
    expect(agent.identityTrace).toMatchObject({ matchedTier: "session", resolution: "exact" });
  });

  test("durable history survives the scan window without being counted as live work", () => {
    const archived = [
      collected({
        id: "codex:fresh-archive",
        sourceSessionId: "fresh-archive",
        status: "archived",
        updatedAt: "2026-07-23T19:00:00.000Z",
      }),
      collected({
        id: "codex:old-archive",
        sourceSessionId: "old-archive",
        status: "archived",
        updatedAt: "2026-07-20T19:00:00.000Z",
      }),
    ];
    const snapshot = buildSnapshot({
      agents: [],
      surfaces: [],
      archiveStore: {
        has: (id) => archived.some((agent) => agent.id === id),
        archive: async () => {},
        archivedAgents: () => archived,
      },
      scanWindowHours: 36,
      now: new Date("2026-07-23T20:00:00.000Z"),
    });

    expect(snapshot.programs.flatMap(({ agents }) => agents).map(({ id }) => id)).toEqual([
      "codex:fresh-archive",
      "codex:old-archive",
    ]);
    expect(snapshot.totals.live).toBe(0);
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

  test("exact cmux link with disagreeing pane cwd keeps home grouping and flags the mismatch", () => {
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

    // Session still lives at ~ — do not file it under Hormiga just because the
    // cmux pane title/folder says so.
    expect(snapshot.programs[0]?.name).toBe("Home");
    expect(agent?.cwd).toBe("/Users/emilionunezgarcia");
    expect(agent?.target).toMatchObject({
      resolution: "exact",
      cwdMismatch: true,
      workspaceTitle: "CODEX - Platform UX",
      surfaceCwd: "/Users/emilionunezgarcia/Developer/LaHormigaDormida",
    });
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
    expect(snapshot.programs.find(({ name }) => name === "Home")?.agents.map(({ id }) => id)).toEqual([
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

  test("reports peak and median context across live agents", () => {
    const snapshot = buildSnapshot({
      agents: [
        collected({ tokens: { provenance: "observed", scope: "session", contextWindow: 100, sessionTotal: 20 } }),
        collected({ id: "codex:idle", sourceSessionId: "idle", status: "waiting", tokens: { provenance: "observed", scope: "session", contextWindow: 100, sessionTotal: 50 } }),
        collected({ id: "codex:high", sourceSessionId: "high", tokens: { provenance: "observed", scope: "session", contextWindow: 100, sessionTotal: 90 } }),
      ],
      surfaces: [],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });

    expect(snapshot.contextPeak).toBe(90);
    expect(snapshot.contextMedian).toBe(50);
  });

  test("uses the latest turn for latest-turn context", () => {
    const snapshot = buildSnapshot({
      agents: [
        collected({
          tokens: {
            total: 25,
            sessionTotal: 900,
            contextWindow: 100,
            scope: "latest-turn",
            provenance: "observed",
          },
        }),
      ],
      surfaces: [],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });

    expect(snapshot.programs[0]?.agents[0]?.contextPct).toBe(25);
  });

  test("uses the session total for session context", () => {
    const snapshot = buildSnapshot({
      agents: [
        collected({
          tokens: {
            total: 25,
            sessionTotal: 60,
            contextWindow: 100,
            scope: "session",
            provenance: "observed",
          },
        }),
      ],
      surfaces: [],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });

    expect(snapshot.programs[0]?.agents[0]?.contextPct).toBe(60);
  });

  test("rejects latest-turn context that exceeds its window", () => {
    const snapshot = buildSnapshot({
      agents: [
        collected({
          tokens: {
            total: 101,
            sessionTotal: 25,
            contextWindow: 100,
            scope: "latest-turn",
            provenance: "observed",
          },
        }),
      ],
      surfaces: [],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });

    expect(snapshot.programs[0]?.agents[0]?.contextPct).toBeUndefined();
  });

  test("requires observed provenance for context", () => {
    const snapshot = buildSnapshot({
      agents: [
        collected({
          tokens: {
            total: 25,
            contextWindow: 100,
            scope: "latest-turn",
            provenance: "estimated",
          },
        }),
      ],
      surfaces: [],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });

    expect(snapshot.programs[0]?.agents[0]?.contextPct).toBeUndefined();
  });

  test("leaves context peak and median undefined without live context reports", () => {
    const snapshot = buildSnapshot({
      agents: [
        collected(),
        collected({ id: "codex:idle", sourceSessionId: "idle", status: "waiting" }),
      ],
      surfaces: [],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });

    expect(snapshot.contextPeak).toBeUndefined();
    expect(snapshot.contextMedian).toBeUndefined();
  });

  test("excludes ended and archived agents from context peak and median", () => {
    const snapshot = buildSnapshot({
      agents: [
        collected({ tokens: { provenance: "observed", scope: "session", contextWindow: 100, sessionTotal: 20 } }),
        collected({ id: "codex:idle", sourceSessionId: "idle", status: "waiting", tokens: { provenance: "observed", scope: "session", contextWindow: 100, sessionTotal: 40 } }),
        collected({ id: "codex:ended", sourceSessionId: "ended", status: "archived", tokens: { provenance: "observed", scope: "session", contextWindow: 100, sessionTotal: 100 } }),
      ],
      surfaces: [],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });

    expect(snapshot.contextPeak).toBe(40);
    expect(snapshot.contextMedian).toBe(30);
  });

  test("rounds the even live-agent context median", () => {
    const snapshot = buildSnapshot({
      agents: [
        collected({ tokens: { provenance: "observed", scope: "session", contextWindow: 100, sessionTotal: 10 } }),
        collected({ id: "codex:twenty", sourceSessionId: "twenty", tokens: { provenance: "observed", scope: "session", contextWindow: 100, sessionTotal: 20 } }),
        collected({ id: "codex:seventy", sourceSessionId: "seventy", status: "waiting", tokens: { provenance: "observed", scope: "session", contextWindow: 100, sessionTotal: 70 } }),
        collected({ id: "codex:eighty", sourceSessionId: "eighty", status: "waiting", tokens: { provenance: "observed", scope: "session", contextWindow: 100, sessionTotal: 80 } }),
      ],
      surfaces: [],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });

    expect(snapshot.contextPeak).toBe(80);
    expect(snapshot.contextMedian).toBe(45);
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

  test("Cursor Composer families count as compliant native models", () => {
    const snapshot = buildSnapshot({
      agents: [
        collected({
          id: "cursor:composer-fast",
          provider: "cursor",
          sourceSessionId: "composer-fast",
          model: "composer-2.5-fast",
        }),
        collected({
          id: "cursor:composer-2",
          provider: "cursor",
          sourceSessionId: "composer-2",
          model: "composer-2",
        }),
        collected({
          id: "cursor:composer-child",
          provider: "cursor",
          sourceSessionId: "composer-child",
          parentSourceSessionId: "composer-fast",
          model: "composer-2.5",
        }),
      ],
      surfaces: [],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });
    const agents = snapshot.programs.flatMap(({ agents }) => agents);

    const composerFast = agents.find(({ id }) => id === "cursor:composer-fast")?.modelPolicy;
    expect(composerFast?.state).toBe("compliant");
    // The summary names the family that actually matched — honest about why.
    expect(composerFast?.summary).toContain("composer-2.5");
    expect(agents.find(({ id }) => id === "cursor:composer-2")?.modelPolicy?.state).toBe("compliant");
    expect(agents.find(({ id }) => id === "cursor:composer-child")?.modelPolicy?.state).toBe("compliant");
    expect(snapshot.totals.cursorModelHealth).toMatchObject({ compliant: 3, mismatch: 0 });
    expect((snapshot.issues ?? []).some((issue) => issue.id.startsWith("system:cursor-model-policy"))).toBe(false);
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

    /* The title names the situation and the summary names the remedy.
       "CMUX identity conflicts" told an operator nothing they could act on:
       it described the scanner's internal state, not theirs. */
    expect(snapshot.issues).toEqual([
      expect.objectContaining({
        id: "system:cmux-identity-conflicts",
        title: "Two live sessions share one cmux pane",
        affectedAgentIds: [source.id],
        technicalDetails: expect.arrayContaining([expect.stringContaining("ttys003"), expect.stringContaining("ttys005")]),
      }),
    ]);
    expect(snapshot.issues?.[0]?.summary).toContain("until one is closed");
    expect(snapshot.totals.needsYou).toBe(1);
    expect(snapshot.totals.sourceHealth).toEqual({ healthy: 3, degraded: 1, total: 4 });
  });

  /* An identity conflict costs one thing: controls stay quarantined for the
     sessions on that pane. A pane whose sessions have all ended is withholding
     controls from nobody, and nobody will ever close a pane from a wave that
     finished last week — so it reported a permanent error, the board could
     never reach Operational, and an operator learned to ignore the one signal
     that was supposed to mean "look at me". */
  test("a pane whose sessions have all ended is debris, not a fault", () => {
    const finished = collected({
      id: "codex:finished-wave",
      sourceSessionId: "finished-wave",
      // Outside the activity window: buildSnapshot derives this as "ended".
      updatedAt: "2026-07-14T09:00:00.000Z",
      status: "archived",
    });
    const snapshot = buildSnapshot({
      agents: [finished],
      surfaces: [{
        ...uniqueSurface,
        sourceSessionIds: [finished.sourceSessionId],
        identityConflict: "conflicting open agent session files on ttys009",
      }],
      cmuxErrors: ["cmux SURFACE-UNIQUE has conflicting open agent session files on ttys009"],
      cmuxReachable: true,
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });

    // Nothing is asked of the operator...
    expect((snapshot.issues ?? []).filter(({ id }) => id === "system:cmux-identity-conflicts")).toEqual([]);
    // ...and nothing drives the board red: this is what makes Operational reachable.
    expect(snapshot.controlHealth.errors).toEqual([]);
    expect(snapshot.totals.sourceHealth).toEqual({ healthy: 4, degraded: 0, total: 4 });

    // But the debris is still named, counted, and carries what to do about it.
    expect(snapshot.controlHealth.debris).toMatchObject({
      kind: "abandoned-cmux-panes",
      count: 1,
      surfaceIds: ["SURFACE-UNIQUE"],
    });
    expect(snapshot.controlHealth.debris?.remedy).toContain("Close 1 cmux pane");
    expect(snapshot.controlHealth.debris?.detail).toHaveLength(1);
  });

  /* Unlike an abandoned pane, this one belongs in errors: every session the
     operator dismissed is back on the board as work in flight, so the count of
     what is running is wrong until someone fixes it. */
  test("an archive that failed to load is a fault on the board, not just a console line", () => {
    const snapshot = buildSnapshot({
      agents: [collected()],
      surfaces: [],
      archiveStore: {
        ...archiveStore,
        loadError: () => "archived agents could not be read from /virtual/archive.json, so the board is showing every session as unarchived: bad JSON",
      },
      cmuxReachable: true,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });

    expect(snapshot.controlHealth.errors.some((error) => error.includes("unarchived"))).toBe(true);
    // It is a fault, so it must NOT be filed as tidy-up debris.
    expect(snapshot.controlHealth.debris).toBeUndefined();
  });

  test("a healthy archive adds nothing to the board", () => {
    const snapshot = buildSnapshot({
      agents: [collected()],
      surfaces: [],
      archiveStore,
      cmuxReachable: true,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });

    expect(snapshot.controlHealth.errors).toEqual([]);
  });

  test("the same pane becomes a fault again the moment a live session appears on it", () => {
    const live = collected({ id: "codex:live-again", sourceSessionId: "live-again" });
    const snapshot = buildSnapshot({
      agents: [live],
      surfaces: [{
        ...uniqueSurface,
        sourceSessionIds: [live.sourceSessionId],
        identityConflict: "conflicting open agent session files on ttys009",
      }],
      cmuxErrors: ["cmux SURFACE-UNIQUE has conflicting open agent session files on ttys009"],
      cmuxReachable: true,
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });

    // No threshold to tune and no state to reset: the classification follows
    // the evidence, so reopening work in the pane restores the alarm.
    expect(snapshot.controlHealth.debris).toBeUndefined();
    expect(snapshot.controlHealth.errors).toHaveLength(1);
    expect(snapshot.totals.sourceHealth?.degraded).toBe(1);
    const issue = (snapshot.issues ?? []).find(({ id }) => id === "system:cmux-identity-conflicts");
    expect(issue?.severity).toBe("error");
    expect(issue?.affectedAgentIds).toEqual([live.id]);
  });

  test("agents quarantined for an unrelated reason are not blamed on pane conflicts", () => {
    /* affectedAgentIds was `controlState === "quarantined" || <named by a
       conflicted surface>`. The first clause swept in every quarantined agent
       whatever the cause, so a fleet quarantined for sharing one cwd — a
       different condition with a different remedy — was reported as collateral
       of surface conflicts it had no connection to. */
    const onConflictedPane = collected({ id: "codex:on-pane", sourceSessionId: "on-pane" });
    /* Two live sessions in one worktree with a surface that cannot tell them
       apart: cwd resolution goes ambiguous, which quarantines both. This is the
       everyday shape of a multi-agent swarm sharing a checkout, and it has
       nothing to do with the conflicted pane above. */
    const sharedCwdA = collected({
      id: "codex:shared-a",
      sourceSessionId: "shared-a",
      cwd: "/Users/emilionunezgarcia/Developer/shared-lane",
    });
    const sharedCwdB = collected({
      id: "codex:shared-b",
      sourceSessionId: "shared-b",
      cwd: "/Users/emilionunezgarcia/Developer/shared-lane",
    });
    const snapshot = buildSnapshot({
      agents: [onConflictedPane, sharedCwdA, sharedCwdB],
      surfaces: [{
        ...uniqueSurface,
        sourceSessionIds: [onConflictedPane.sourceSessionId],
        identityConflict: "conflicting open agent session files on ttys009",
      }, {
        workspaceId: "WORKSPACE-SHARED",
        surfaceId: "SURFACE-SHARED",
        paneId: "PANE-SHARED",
        cwd: "/Users/emilionunezgarcia/Developer/shared-lane",
        sourceSessionIds: [],
      }],
      cmuxErrors: ["cmux SURFACE-UNIQUE has conflicting open agent session files on ttys009"],
      cmuxReachable: true,
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });

    // The fixture only proves anything if those two really are quarantined.
    const quarantined = snapshot.programs
      .flatMap(({ agents }) => agents)
      .filter(({ controlState }) => controlState === "quarantined")
      .map(({ id }) => id);
    expect(quarantined).toContain(sharedCwdA.id);
    expect(quarantined).toContain(sharedCwdB.id);

    const issue = (snapshot.issues ?? []).find(({ id }) => id === "system:cmux-identity-conflicts");
    expect(issue?.affectedAgentIds).toEqual([onConflictedPane.id]);
    expect(issue?.affectedAgentIds).not.toContain(sharedCwdA.id);
    expect(issue?.affectedAgentIds).not.toContain(sharedCwdB.id);
  });

  test("identity-conflict issues link agents named by the conflicting process evidence", () => {
    const first = collected();
    const second = collected({
      id: "codex:other-session",
      sourceSessionId: "other-session",
    });
    const conflict = "cmux SURFACE-UNIQUE has conflicting open agent session files on ttys005";
    const snapshot = buildSnapshot({
      agents: [first, second],
      surfaces: [{
        ...uniqueSurface,
        sourceSessionIds: [],
        identityConflict: conflict,
        identityTrace: {
          surfaceId: uniqueSurface.surfaceId,
          processes: [{ pid: 101, command: "codex", recognizedAgentProcess: true }],
          openFileMatches: [
            { pid: 101, path: `/tmp/${first.sourceSessionId}.jsonl`, provider: "codex", sessionId: first.sourceSessionId },
            { pid: 101, path: `/tmp/${second.sourceSessionId}.jsonl`, provider: "codex", sessionId: second.sourceSessionId },
          ],
          commandHints: [],
          outcome: "open-file-conflict",
          sourceSessionIds: [],
          identityConflict: conflict,
        },
      }],
      cmuxErrors: [conflict],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });

    expect(snapshot.issues?.find(({ id }) => id === "system:cmux-identity-conflicts")?.affectedAgentIds)
      .toEqual([first.id, second.id]);
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

  test("stressed snapshots retain issue decoration and triage summaries", () => {
    const snapshot = buildSnapshot({
      agents: [collected()],
      surfaces: [],
      sourceErrors: {
        codex: ["Codex collection is incomplete."],
        claude: ["Claude collection is incomplete."],
      },
      cmuxErrors: ["cmux control is unavailable"],
      triageSummaries: [
        { issueId: "system:codex-collector", state: "running" },
        { issueId: "queue:detached", state: "queued" },
        { issueId: "queue:verification", state: "completed" },
        { issueId: "queue:blocked", state: "blocked" },
      ],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });

    expect(snapshot.triageSummaries).toEqual([
      { issueId: "system:codex-collector", state: "running" },
      { issueId: "queue:detached", state: "queued" },
      { issueId: "queue:verification", state: "completed" },
      { issueId: "queue:blocked", state: "blocked" },
    ]);
    expect(snapshot.issues?.find(({ id }) => id === "system:cmux-control")).toMatchObject({
      workState: "needs_triage",
      progress: 0,
      impactSummary: "Touches 1 session: Test session (unique-project)",
    });
    expect(snapshot.issues?.find(({ id }) => id === "system:codex-collector")).toMatchObject({
      workState: "investigating",
      progress: 70,
    });
    expect(snapshot.issues?.find(({ id }) => id === "system:claude-collector")).toMatchObject({
      workState: "watching",
      progress: 0,
    });
  });

  test("an empty active snapshot retains resolved findings during the TTL window", () => {
    const previousIssue: OperatorIssue = {
      id: "system:previous",
      kind: "system",
      severity: "error",
      title: "Previous incident",
      summary: "The source used to report an incident.",
      affectedAgentIds: [],
      lifecycle: { state: "open", openedAt: "2026-07-21T22:58:00.000Z" },
    };
    const snapshot = buildSnapshot({
      agents: [],
      surfaces: [],
      previousIssues: [previousIssue],
      triageSummaries: [],
      archiveStore,
      now: new Date("2026-07-21T23:00:00.000Z"),
    });

    expect(snapshot.issues).toEqual([]);
    expect(snapshot.recentlyResolved).toMatchObject([{
      id: previousIssue.id,
      workState: "cleared",
      progress: 100,
      impactSummary: "System-wide — not tied to a specific agent",
    }]);
  });

  test("impact summaries describe zero, one, and many affected sessions", () => {
    const base = buildSnapshot({
      agents: [
        collected({ id: "codex:alpha-a", sourceSessionId: "alpha-a", displayName: "Alpha A", cwd: "/work/alpha" }),
        collected({ id: "codex:alpha-b", sourceSessionId: "alpha-b", displayName: "Alpha B", cwd: "/work/alpha" }),
        collected({ id: "codex:beta", sourceSessionId: "beta", displayName: "Beta", cwd: "/work/beta" }),
      ],
      surfaces: [],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });
    const issue = (affectedAgentIds: string[]): OperatorIssue => ({
      id: `system:impact-${affectedAgentIds.length}`,
      kind: "system",
      severity: "warning",
      title: "Impact fixture",
      summary: "Impact fixture.",
      affectedAgentIds,
    });

    expect(impactSummaryFor(issue([]), base.programs)).toBe(
      "System-wide — not tied to a specific agent",
    );
    expect(impactSummaryFor(issue(["codex:alpha-a"]), base.programs)).toBe(
      "Touches 1 session: Alpha A (alpha)",
    );
    expect(impactSummaryFor(issue(["codex:alpha-a", "codex:alpha-b", "codex:beta"]), base.programs)).toBe(
      "Touches 3 sessions across 2 programs — mainly alpha (2), beta (1)",
    );
  });

  test("issues retain open and verification evidence until a fresh source clears them", () => {
    const sourceErrors = ["cmux control is unavailable"];
    const opened = buildSnapshot({
      agents: [collected()],
      surfaces: [],
      cmuxErrors: sourceErrors,
      archiveStore,
      now: new Date("2026-07-21T23:00:00.000Z"),
    });
    const issue = opened.issues?.[0]!;
    expect(issue.lifecycle).toMatchObject({ state: "open", openedAt: "2026-07-21T23:00:00.000Z" });

    const verifyingLifecycle: IssueLifecycle = {
      state: "verifying",
      openedAt: issue.lifecycle!.openedAt,
      verificationStartedAt: "2026-07-21T23:01:00.000Z",
      result: "Control action completed.",
    };
    const verifying = buildSnapshot({
      agents: [collected()],
      surfaces: [],
      cmuxErrors: sourceErrors,
      issueLifecycle: new Map([[issue.id, verifyingLifecycle]]),
      previousIssues: opened.issues,
      archiveStore,
      now: new Date("2026-07-21T23:02:00.000Z"),
    });
    expect(verifying.issues?.[0]?.lifecycle).toEqual(verifyingLifecycle);
    expect(verifying.issues?.[0]).toMatchObject({ workState: "verifying", progress: 85 });
    expect(verifying.recentlyResolved).toEqual([]);

    const stillReported = buildSnapshot({
      agents: [collected()],
      surfaces: [],
      cmuxErrors: sourceErrors,
      issueLifecycle: new Map([[issue.id, verifying.issues?.[0]?.lifecycle!]]),
      previousIssues: verifying.issues,
      recentlyResolved: verifying.recentlyResolved,
      archiveStore,
      now: new Date("2026-07-21T23:03:00.000Z"),
    });
    expect(stillReported.issues?.[0]?.lifecycle?.state).toBe("verifying");
    expect(stillReported.recentlyResolved).toEqual([]);

    const cleared = buildSnapshot({
      agents: [collected()],
      surfaces: [],
      issueLifecycle: new Map([[issue.id, stillReported.issues?.[0]?.lifecycle!]]),
      previousIssues: stillReported.issues,
      recentlyResolved: stillReported.recentlyResolved,
      archiveStore,
      now: new Date("2026-07-21T23:04:00.000Z"),
    });
    expect(cleared.issues).toEqual([]);
    expect(cleared.recentlyResolved).toMatchObject([{
      id: issue.id,
      workState: "cleared",
      progress: 100,
      lifecycle: {
        state: "resolved",
        resolvedAt: "2026-07-21T23:04:00.000Z",
        result: "Control action completed. Fresh source confirmation no longer reports this issue.",
      },
    }]);
  });

  test("blocked source findings remain visible with the investigation result", () => {
    const opened = buildSnapshot({
      agents: [collected()],
      surfaces: [],
      cmuxErrors: ["cmux control is unavailable"],
      archiveStore,
      now: new Date("2026-07-21T23:00:00.000Z"),
    });
    const issue = opened.issues?.[0]!;
    const blocked: IssueLifecycle = {
      state: "blocked",
      openedAt: issue.lifecycle!.openedAt,
      verificationStartedAt: "2026-07-21T23:01:00.000Z",
      result: "The external identity service is unavailable.",
    };
    const snapshot = buildSnapshot({
      agents: [collected()],
      surfaces: [],
      cmuxErrors: ["cmux control is unavailable"],
      issueLifecycle: new Map([[issue.id, blocked]]),
      previousIssues: opened.issues,
      archiveStore,
      now: new Date("2026-07-21T23:02:00.000Z"),
    });

    expect(snapshot.issues).toMatchObject([{ id: issue.id, lifecycle: blocked }]);
    expect(snapshot.recentlyResolved).toEqual([]);
  });

  test("resolved lifecycle beats a stale blocked triage summary for work state", () => {
    const issue: OperatorIssue = {
      id: "system:cleared-finding",
      kind: "system",
      severity: "warning",
      title: "Cleared finding",
      summary: "Source no longer reports this.",
      affectedAgentIds: [],
      lifecycle: {
        state: "resolved",
        openedAt: "2026-07-21T22:58:00.000Z",
        resolvedAt: "2026-07-21T23:00:00.000Z",
        result: "Fresh source confirmation no longer reports this issue.",
      },
    };
    expect(issueWorkStateFor(issue, { issueId: issue.id, state: "blocked" })).toBe("cleared");
  });

  test("orphan blocked triage summaries do not alter lifecycle decoration", () => {
    const cleared: OperatorIssue = {
      id: "system:previous",
      kind: "system",
      severity: "error",
      title: "Previous incident",
      summary: "Gone from the source.",
      affectedAgentIds: [],
      lifecycle: {
        state: "resolved",
        openedAt: "2026-07-21T22:58:00.000Z",
        resolvedAt: "2026-07-21T23:00:00.000Z",
      },
    };
    const decorated = withIssueDecoration(
      {
        schemaVersion: 1,
        generatedAt: "2026-07-21T23:00:00.000Z",
        controlHealth: { cmuxReachable: true, lastCheckedAt: "", errors: [], staleSources: [] },
        totals: {
          live: 0, tracked: 0, attention: 0, working: 0, idle: 0, history: 0,
          sourceHealth: { healthy: 0, degraded: 0, total: 0 },
        },
        programs: [],
        issues: [],
        recentlyResolved: [cleared],
      },
      [
        { issueId: cleared.id, state: "blocked" },
        { issueId: "queue:orphan-blocked", state: "blocked" },
      ],
    );

    expect(decorated.triageSummaries).toEqual([
      { issueId: cleared.id, state: "blocked" },
      { issueId: "queue:orphan-blocked", state: "blocked" },
    ]);
    expect(decorated.recentlyResolved?.[0]).toMatchObject({
      workState: "cleared",
      progress: 100,
      impactSummary: "System-wide — not tied to a specific agent",
    });
    expect(issueWorkStateFor(cleared, { issueId: cleared.id, state: "blocked" })).toBe("cleared");
  });
  test("live blocked findings retain blocked lifecycle decoration", () => {
    const liveBlocked: OperatorIssue = {
      id: "system:live-blocked",
      kind: "system",
      severity: "warning",
      title: "Needs a decision",
      summary: "Investigation blocked.",
      affectedAgentIds: [],
      lifecycle: { state: "open", openedAt: "2026-07-21T22:58:00.000Z" },
    };
    const decorated = withIssueDecoration(
      {
        schemaVersion: 1,
        generatedAt: "2026-07-21T23:00:00.000Z",
        controlHealth: { cmuxReachable: true, lastCheckedAt: "", errors: [], staleSources: [] },
        totals: {
          live: 0, tracked: 0, attention: 0, working: 0, idle: 0, history: 0,
          sourceHealth: { healthy: 0, degraded: 0, total: 0 },
        },
        programs: [],
        issues: [liveBlocked],
        recentlyResolved: [],
      },
      [{ issueId: liveBlocked.id, state: "blocked" }],
    );

    expect(decorated.issues?.[0]).toMatchObject({
      workState: "blocked",
      progress: 70,
      impactSummary: "System-wide — not tied to a specific agent",
    });
    expect(issueWorkStateFor(liveBlocked, { issueId: liveBlocked.id, state: "blocked" })).toBe("blocked");
  });
  test("pulse is optional and contributes stable data to the fingerprint", () => {
    const first = buildSnapshot({
      agents: [collected()],
      surfaces: [],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });
    const later = buildSnapshot({
      agents: [collected()],
      surfaces: [],
      archiveStore,
      now: new Date("2026-07-21T23:00:34.000Z"),
    });
    const pulse: HubPulse = {
      momentum: {
        working: 1,
        completionsLastHour: 0,
        observedWindowMs: 0,
        stalled: 0,
        stalledAgentIds: [],
        stallThresholdMs: 900_000,
      },
      burn: {
        tokensPerMin: null,
        windowMs: 0,
        coverage: { reporting: 0, eligible: 0, unknown: 0 },
        costLastHourUsd: null,
        costProvenance: "unavailable",
      },
      activity: {
        bucketMinutes: 5,
        windowMinutes: 60,
        observedSince: "2026-07-21T23:00:00.000Z",
        buckets: [],
      },
    };

    expect(first.pulse).toBeUndefined();
    const withFirstPulse = withPulse(first, pulse);
    const withLaterPulse = withPulse(later, pulse);
    expect(withLaterPulse.pulse).toEqual(pulse);
    expect(snapshotFingerprint(withLaterPulse)).toBe(snapshotFingerprint(withFirstPulse));
  });
  test("calm refreshes inside one bucket keep the pulse fingerprint stable", () => {
    const bucketMs = 5 * 60_000;
    const start = Math.floor(Date.now() / bucketMs) * bucketMs;
    const tracker = new PulseTracker(undefined, start);
    const first = buildSnapshot({
      agents: [collected()],
      surfaces: [],
      archiveStore,
      now: new Date(start + 1_000),
    });
    tracker.observe(first, start + 1_000);
    const firstWithPulse = withPulse(first, tracker.report(start + 1_000));

    const later = buildSnapshot({
      agents: [collected()],
      surfaces: [],
      archiveStore,
      now: new Date(start + 4 * 60_000),
    });
    tracker.observe(later, start + 4 * 60_000);
    const laterWithPulse = withPulse(later, tracker.report(start + 4 * 60_000));

    expect(laterWithPulse.pulse?.momentum.working).toBe(later.totals.working);
    expect(snapshotFingerprint(laterWithPulse)).toBe(snapshotFingerprint(firstWithPulse));
  });

});

/* ---------------------------------------------------------------------------
   W5-B follow-up.

   The four ProcessState values already had a test, but it hand-set
   `processAlive` / `transcriptEndedCleanly` on the CollectedAgent — so it
   exercised processStateFor() and nothing that PRODUCES those fields. Measured
   against a live fleet, `exited` and `died` never appeared: 82 of 97 agents
   carried no process evidence at all. These tests drive the real producers —
   the OMP parser and the identity-binding bridge — into buildSnapshot, so the
   chain that has to work in production is the chain under test.
   ------------------------------------------------------------------------- */
describe("process liveness, produced by the real collector and binding paths", () => {
  const BOUND_SESSION = "019f86c4-1558-7000-aeb8-26e2cfd0e8ec";

  function boundSurface(overrides: Partial<CmuxSurface["identityTrace"]> = {}): CmuxSurface {
    return {
      surfaceId: "SURFACE-BOUND",
      workspaceId: "WORKSPACE-BOUND",
      paneId: "PANE-BOUND",
      tty: "ttys033",
      sourceSessionIds: [BOUND_SESSION],
      identityTrace: {
        surfaceId: "SURFACE-BOUND",
        tty: "ttys033",
        processes: [{ pid: 4242, command: "codex resume", recognizedAgentProcess: true }],
        openFileMatches: [{
          pid: 4242,
          path: `/Users/me/.codex/sessions/rollout-${BOUND_SESSION}.jsonl`,
          provider: "codex",
          sessionId: BOUND_SESSION,
        }],
        commandHints: [],
        outcome: "open-file-match",
        sourceSessionIds: [BOUND_SESSION],
        ...overrides,
      },
    };
  }

  const boundAgent = (overrides: Partial<CollectedAgent> = {}): CollectedAgent => collected({
    id: `codex:${BOUND_SESSION}`,
    sourceSessionId: BOUND_SESSION,
    ...overrides,
  });

  test("a recorded session exit reaches processState 'exited' through the real OMP parser", () => {
    // The real fixture plus the one row under test. `exited` is detected in
    // exactly one place in the whole collector (createOmpParser's
    // `row.type === "custom" && row.data?.kind === "session_exit"`), so this is
    // the only path by which any agent can ever read "exited".
    const source = parseOmpJsonl(
      `${fixture("omp-session.jsonl")}\n${JSON.stringify({
        type: "custom",
        timestamp: "2026-07-21T22:21:00.000Z",
        data: { kind: "session_exit" },
      })}`,
      { sourcePath: "/Users/me/.omp/agent/sessions/p/session.jsonl", nowMs: Date.parse("2026-07-21T23:31:00.000Z") },
    );
    // Produced, not planted.
    expect(source?.transcriptEndedCleanly).toBe(true);

    const snapshot = buildSnapshot({
      agents: [source!],
      surfaces: [],
      archiveStore,
      now: new Date("2026-07-21T23:31:00.000Z"),
    });
    const agent = snapshot.programs.flatMap(({ agents }) => agents)[0]!;
    expect(agent.processState).toBe("exited");
    // A clean exit is an ending, and it stays one.
    expect(agent.activity).toBe("ended");
  });

  test("a crashed process in a still-open terminal reaches 'died' through the real binding bridge", async () => {
    const store = new MemoryIdentityBindingStore();
    // Scan 1: lsof confirms the session on pid 4242, so the binding records it.
    await updateBindingsFromScan(store, [boundSurface()], "2026-07-23T06:00:00.000Z");
    expect(store.get(BOUND_SESSION)?.processIds).toEqual([4242]);

    // Scan 2: the terminal is still open and still probes cleanly, but 4242 is
    // gone from it. That is the one shape that can honestly mean "died".
    const crashed = boundSurface({ processes: [], openFileMatches: [], outcome: "no-evidence" });
    const [bridged] = bridgeAgentsWithBindings(store, [boundAgent()], [crashed]);
    expect(bridged).toMatchObject({ processIds: [4242], processAlive: false });

    const snapshot = buildSnapshot({
      agents: [bridged!],
      surfaces: [crashed],
      archiveStore,
      now: new Date("2026-07-23T06:01:00.000Z"),
    });
    expect(snapshot.programs.flatMap(({ agents }) => agents)[0]!.processState).toBe("died");
  });

  test("a terminal that has gone reports unknown, and is never accused of dying", async () => {
    const store = new MemoryIdentityBindingStore();
    await updateBindingsFromScan(store, [boundSurface()], "2026-07-23T06:00:00.000Z");

    // The bound surface is absent from this scan — the terminal closed. There is
    // no trustworthy process scan to read, so there is no verdict to give. This
    // is the shape 82 of 97 live agents were in; if `trustworthyProcessScan`
    // ever collapses, every one of them starts reading as a dead process.
    const [bridged] = bridgeAgentsWithBindings(store, [boundAgent()], []);
    expect(bridged!.processIds).toEqual([4242]);
    expect(bridged!.processAlive).toBeUndefined();

    const snapshot = buildSnapshot({
      agents: [bridged!],
      surfaces: [],
      archiveStore,
      now: new Date("2026-07-23T06:01:00.000Z"),
    });
    expect(snapshot.programs.flatMap(({ agents }) => agents)[0]!.processState).toBe("unknown");
  });

  test("death is never claimed without knowing which process died", () => {
    // processAlive false with no pids on file is not evidence of a death; it is
    // an absent binding. Reading it as "died" would invent a corpse.
    const snapshot = buildSnapshot({
      agents: [boundAgent({ processAlive: false, processIds: [] })],
      surfaces: [],
      archiveStore,
      now: new Date("2026-07-23T06:01:00.000Z"),
    });
    expect(snapshot.programs.flatMap(({ agents }) => agents)[0]!.processState).toBe("unknown");
  });
});

/* ---------------------------------------------------------------------------
   W5-B follow-up: the "ended + running" ghosts.

   `statusFrom()` marks a transcript `stale` after 45 silent minutes, at parse
   time, before any process evidence exists. activityFor() turned that into
   "ended", and operatorControlState() turns "ended" into `observed-only` — so a
   session that was alive, linked and holding an unread notification was filed
   as history with its controls removed, while its own controls[] array still
   said focus/instruct were enabled. Measured live: 4 ghosts, 6 agents in that
   contradiction, 3 of them asking for a human.
   ------------------------------------------------------------------------- */
describe("a stale transcript is silence, not an ending", () => {
  const staleSession = (overrides: Partial<CollectedAgent> = {}): CollectedAgent => collected({
    id: "codex:quiet-but-alive",
    sourceSessionId: "quiet-but-alive",
    status: "stale",
    statusReason: "No source activity in the last 45 minutes.",
    updatedAt: "2026-07-21T22:00:00.000Z",
    ...overrides,
  });

  const linkedSurface = { ...uniqueSurface, sourceSessionIds: ["quiet-but-alive"] };

  function build(agent: CollectedAgent) {
    const snapshot = buildSnapshot({
      agents: [agent],
      surfaces: [linkedSurface],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });
    return snapshot.programs.flatMap(({ agents }) => agents)[0]!;
  }

  test("a provably live process keeps a quiet session idle, linked and controllable", () => {
    const live = build(staleSession({ processIds: [4242], processAlive: true }));

    expect(live.activity).toBe("idle");
    expect(live.processState).toBe("running");
    // The whole point: the controls come back. `observed-only` here contradicted
    // the agent's own controls[], which reported focus/instruct as enabled.
    expect(live.controlState).toBe("linked");
    expect(live.controls.find(({ action }) => action === "instruct")?.enabled).toBe(true);
    // And the operator is no longer sent to history to find a running session.
    expect(live.nextAction).not.toContain("history");
  });

  test("the elapsed clock keeps running for a session that never ended", () => {
    const live = build(staleSession({ processIds: [4242], processAlive: true }));
    const ghost = build(staleSession());

    // Frozen at the last transcript write for a real ending...
    expect(ghost.elapsedMs).toBe(Date.parse("2026-07-21T22:00:00.000Z") - Date.parse("2026-07-21T20:00:00.000Z"));
    // ...and still running for a session that is merely quiet.
    expect(live.elapsedMs).toBe(Date.parse("2026-07-21T23:00:30.000Z") - Date.parse("2026-07-21T20:00:00.000Z"));
    expect(live.elapsedMs).toBeGreaterThan(ghost.elapsedMs!);
  });

  test("absent liveness evidence still ends a quiet session", () => {
    // Absent-first, unchanged. This is every agent whose terminal has gone, and
    // it is the majority of the fleet — silence alone must still read as ended.
    const ghost = build(staleSession());
    expect(ghost.processState).toBe("unknown");
    expect(ghost.activity).toBe("ended");
    expect(ghost.controlState).toBe("observed-only");

    // A process the scan proved is GONE ends the session too — only positive
    // evidence of life can keep it open.
    const dead = build(staleSession({ processIds: [4242], processAlive: false }));
    expect(dead.processState).toBe("died");
    expect(dead.activity).toBe("ended");
  });

  test("a recorded session exit still ends the session, whatever the pid table says", () => {
    // `archived` is the source saying "this session is over". It outranks a
    // live pid, which after an exit is a shell, not an agent.
    const exited = build(staleSession({
      status: "archived",
      transcriptEndedCleanly: true,
      processIds: [4242],
      processAlive: true,
    }));
    expect(exited.activity).toBe("ended");
  });

  test("the rescued sessions move out of history and into the live totals", () => {
    const snapshot = buildSnapshot({
      agents: [
        staleSession({ id: "codex:alive-1", sourceSessionId: "alive-1", processIds: [1], processAlive: true }),
        staleSession({ id: "codex:alive-2", sourceSessionId: "alive-2", processIds: [2], processAlive: true }),
        staleSession({ id: "codex:really-ended", sourceSessionId: "really-ended" }),
      ],
      surfaces: [],
      archiveStore,
      now: new Date("2026-07-21T23:00:30.000Z"),
    });
    // Two quiet-but-alive sessions are live; only the evidence-free one is history.
    expect(snapshot.totals).toMatchObject({ idle: 2, ended: 1, history: 1 });
  });
});
