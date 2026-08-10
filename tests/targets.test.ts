import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCmuxTerminals } from "../src/server/cmux";
import { readHookSessionStores } from "../src/server/cmux-hook-sessions";
import { canWriteToTarget, resolveAgentTarget, resolveAgentTargetWithTrace } from "../src/server/targets";
import type { CollectedAgent } from "../src/server/types";

const surfaces = parseCmuxTerminals(
  readFileSync(join(import.meta.dir, "fixtures", "cmux-discovery.json"), "utf8"),
);

afterEach(() => {
  readHookSessionStores(join(import.meta.dir, "fixtures", "missing-hook-sessions"));
});

function agent(overrides: Partial<CollectedAgent>): CollectedAgent {
  return {
    id: "codex:test-session",
    provider: "codex",
    sourceSessionId: "test-session",
    displayName: "Routing test",
    status: "running",
    statusReason: "Fixture activity is recent.",
    updatedAt: "2026-07-21T23:00:00.000Z",
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    ...overrides,
  };
}

describe("safe cmux target resolution", () => {
  test("CWD-SEM-1 exact identity reports a neutral different-directory relation without changing its routing reason", () => {
    const target = resolveAgentTarget(
      agent({ sourceSessionId: "exact-cwd-relation", cwd: "/repos/agent" }),
      [{
        workspaceId: "WORKSPACE-RELATION",
        surfaceId: "SURFACE-RELATION",
        cwd: "/repos/terminal",
        sourceSessionIds: ["exact-cwd-relation"],
      }],
    );

    expect(target).toMatchObject({
      resolution: "exact",
      attestation: "live",
      cwdRelation: "different",
      reason: "Matched source session ID recorded by cmux.",
    });
  });

  test("CWD-SEM-2 known equal directories publish the neutral same relation", () => {
    const target = resolveAgentTarget(
      agent({ sourceSessionId: "same-cwd-relation", cwd: "/repos/shared/" }),
      [{
        surfaceId: "SURFACE-SAME",
        cwd: "/repos/shared",
        sourceSessionIds: ["same-cwd-relation"],
      }],
    );

    expect(target.cwdRelation).toBe("same");
  });

  test("CWD-SEM-3 conflicting exact identity remains quarantined and unwritable", () => {
    const target = resolveAgentTarget(
      agent({ sourceSessionId: "conflicted-session", cwd: "/repos/shared" }),
      [{
        surfaceId: "SURFACE-CONFLICTED",
        cwd: "/repos/shared",
        sourceSessionIds: ["conflicted-session"],
        identityConflict: "two live session files claim this pane",
      }],
    );

    expect(target).toEqual({
      resolution: "ambiguous",
      reason: "cmux surface is quarantined because exact identity evidence conflicts: two live session files claim this pane",
    });
    expect(canWriteToTarget(target)).toBe(false);
  });

  test("a live hook-store surface outranks remembered target IDs", () => {
    readHookSessionStores(join(import.meta.dir, "fixtures", "cmux-hook-sessions"));
    const hookSurface = {
      workspaceId: "LIVE-WORKSPACE",
      surfaceId: "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
      cwd: "/Users/example/Developer/redacted-project",
      sourceSessionIds: [],
    };
    const rememberedSurface = {
      workspaceId: "REMEMBERED-WORKSPACE",
      surfaceId: "REMEMBERED-SURFACE",
      cwd: "/Users/example/Developer/redacted-project",
      sourceSessionIds: [],
    };
    const source = agent({
      id: "claude:11111111-2222-4333-8444-555555555555",
      provider: "claude",
      sourceSessionId: "11111111-2222-4333-8444-555555555555",
      cwd: "/Users/example/Developer/redacted-project",
      recordedTarget: {
        surfaceId: rememberedSurface.surfaceId,
        source: "binding",
      },
    });

    const { target, trace } = resolveAgentTargetWithTrace(source, [hookSurface, rememberedSurface]);

    expect(target).toMatchObject({
      workspaceId: "LIVE-WORKSPACE",
      surfaceId: hookSurface.surfaceId,
      resolution: "exact",
      attestation: "hook-store",
    });
    expect(trace.matchedTier).toBe("hook-store");
    expect(trace.steps[0]).toMatchObject({ tier: "hook-store", outcome: "matched" });
  });

  test("a hook record whose surface is absent falls through to live session evidence", () => {
    readHookSessionStores(join(import.meta.dir, "fixtures", "cmux-hook-sessions"));
    const source = agent({
      id: "claude:11111111-2222-4333-8444-555555555555",
      provider: "claude",
      sourceSessionId: "11111111-2222-4333-8444-555555555555",
    });

    const target = resolveAgentTarget(source, [{
      workspaceId: "FALLBACK-WORKSPACE",
      surfaceId: "FALLBACK-SURFACE",
      sourceSessionIds: [source.sourceSessionId],
    }]);

    expect(target).toMatchObject({
      surfaceId: "FALLBACK-SURFACE",
      resolution: "exact",
      attestation: "live",
    });
  });

  test("an exact source session ID wins even when cwd would be ambiguous", () => {
    const target = resolveAgentTarget(
      agent({
        sourceSessionId: "019f86c4-codex-7000-aeb8-26e2cfd0e8ec",
        cwd: "/Users/emilionunezgarcia",
      }),
      surfaces,
    );

    expect(target).toMatchObject({
      workspaceId: "WORKSPACE-EXACT",
      surfaceId: "SURFACE-EXACT",
      paneId: "PANE-EXACT",
      resolution: "exact",
      surfaceCwd: "/Users/emilionunezgarcia/Developer/the-mountain",
      cwdRelation: "different",
    });
    expect(target.reason).toBe("Matched source session ID recorded by cmux.");
  });

  test("an unqualified legacy session claim fails closed across active providers", () => {
    const collisionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const codex = agent({ sourceSessionId: collisionId });
    const claude = agent({
      id: `claude:${collisionId}`,
      provider: "claude",
      sourceSessionId: collisionId,
    });
    const legacySurface = {
      surfaceId: "SURFACE-LEGACY-COLLISION",
      sourceSessionIds: [collisionId],
    };

    for (const source of [codex, claude]) {
      const target = resolveAgentTarget(source, [legacySurface], [codex, claude]);
      expect(target.resolution).toBe("missing");
      expect(canWriteToTarget(target)).toBeFalse();
    }
  });

  test("an unqualified legacy claim stays unwritable when the colliding provider is stale but process-alive", () => {
    const collisionId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
    const codex = agent({ sourceSessionId: collisionId });
    const staleClaude = agent({
      id: `claude:${collisionId}`,
      provider: "claude",
      sourceSessionId: collisionId,
      status: "stale",
      processAlive: true,
    });
    const legacySurface = {
      surfaceId: "SURFACE-LEGACY-STALE-COLLISION",
      sourceSessionIds: [collisionId],
    };

    const target = resolveAgentTarget(codex, [legacySurface], [codex, staleClaude]);

    expect(target.resolution).toBe("missing");
    expect(canWriteToTarget(target)).toBeFalse();
  });

  test("one parsed surface claiming the same UUID for Codex and Claude authorizes neither provider", () => {
    const collisionId = "cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa";
    const [surface] = parseCmuxTerminals(JSON.stringify({
      terminals: [{
        surface_id: "SURFACE-QUALIFIED-CONFLICT",
        codex_session_id: collisionId,
        claude_session_id: collisionId,
      }],
    }));
    const codex = agent({ sourceSessionId: collisionId });
    const claude = agent({
      id: `claude:${collisionId}`,
      provider: "claude",
      sourceSessionId: collisionId,
    });

    expect(surface?.sourceSessionClaims).toEqual([
      { provider: "codex", sessionId: collisionId },
      { provider: "claude", sessionId: collisionId },
    ]);
    for (const source of [codex, claude]) {
      const target = resolveAgentTarget(source, [surface!], [codex, claude]);
      expect(target.resolution).toBe("missing");
      expect(canWriteToTarget(target)).toBeFalse();
    }
  });

  test("a provider-qualified parsed claim routes only its provider across UUID reuse", () => {
    const collisionId = "eeeeeeee-ffff-4aaa-8bbb-cccccccccccc";
    const [surface] = parseCmuxTerminals(JSON.stringify({
      terminals: [{
        surface_id: "SURFACE-CODEX-QUALIFIED",
        codex_session_id: collisionId,
      }],
    }));
    const codex = agent({ sourceSessionId: collisionId });
    const claude = agent({
      id: `claude:${collisionId}`,
      provider: "claude",
      sourceSessionId: collisionId,
    });

    const codexTarget = resolveAgentTarget(codex, [surface!], [codex, claude]);
    const claudeTarget = resolveAgentTarget(claude, [surface!], [codex, claude]);
    expect(codexTarget).toMatchObject({
      surfaceId: "SURFACE-CODEX-QUALIFIED",
      resolution: "exact",
      attestation: "live",
    });
    expect(canWriteToTarget(codexTarget)).toBeTrue();
    expect(claudeTarget.resolution).toBe("missing");
    expect(canWriteToTarget(claudeTarget)).toBeFalse();
  });

  test("exact session match with agreeing cwd publishes the same-directory relation", () => {
    const target = resolveAgentTarget(
      agent({
        sourceSessionId: "019f86c4-codex-7000-aeb8-26e2cfd0e8ec",
        cwd: "/Users/emilionunezgarcia/Developer/the-mountain",
      }),
      surfaces,
    );

    expect(target).toMatchObject({
      resolution: "exact",
      surfaceCwd: "/Users/emilionunezgarcia/Developer/the-mountain",
      cwdRelation: "same",
    });
  });

  test("the only exact cwd match is allowed as an explicit fallback", () => {
    const target = resolveAgentTarget(
      agent({ cwd: "/Users/emilionunezgarcia/Developer/unique-project" }),
      surfaces,
    );

    expect(target).toMatchObject({
      workspaceId: "WORKSPACE-UNIQUE-CWD",
      surfaceId: "SURFACE-UNIQUE-CWD",
      resolution: "unique-cwd",
    });
    expect(target.reason).toContain("one active source");
    expect(target.reason).toContain("only unclaimed cmux surface");
  });

  test("a duplicate cwd is visibly ambiguous and does not leak a guessed target ID", () => {
    const target = resolveAgentTarget(
      agent({ cwd: "/Users/emilionunezgarcia/" }),
      surfaces,
    );

    expect(target.resolution).toBe("ambiguous");
    expect(target.workspaceId).toBeUndefined();
    expect(target.surfaceId).toBeUndefined();
    expect(target.paneId).toBeUndefined();
    expect(target.reason).toContain("controls are disabled");
  });

  test("a missing route does not invent a target from title or agent name", () => {
    const target = resolveAgentTarget(
      agent({
        displayName: "The Mountain backend",
        cwd: "/Users/emilionunezgarcia/Developer/not-open",
      }),
      surfaces,
    );

    expect(target).toEqual({
      resolution: "missing",
      reason: "No cmux surface matches this source session or cwd.",
    });
  });

  test("a stale source cannot gain control through cwd fallback", () => {
    const target = resolveAgentTarget(
      agent({
        status: "stale",
        cwd: "/Users/emilionunezgarcia/Developer/unique-project",
      }),
      surfaces,
    );

    expect(target.resolution).toBe("missing");
    expect(target.surfaceId).toBeUndefined();
    expect(target.reason).toBe("cwd fallback requires a running or waiting source; source is stale.");
  });

  test("a not-ready CMUX surface is excluded from control routing", () => {
    const target = resolveAgentTarget(
      agent({
        sourceSessionId: "019f86c4-codex-7000-aeb8-26e2cfd0e8ec",
        cwd: "/Users/emilionunezgarcia/Developer/the-mountain",
      }),
      [{
        ...surfaces[0],
        runtimeSurfaceReady: false,
      }],
    );

    expect(target.resolution).toBe("missing");
    expect(target.surfaceId).toBeUndefined();
  });

  test("two active sources sharing one cwd fail closed instead of sharing one surface", () => {
    const first = agent({
      id: "codex:first",
      sourceSessionId: "first",
      cwd: "/Users/emilionunezgarcia/Developer/unique-project",
    });
    const second = agent({
      id: "claude:second",
      provider: "claude",
      sourceSessionId: "second",
      cwd: first.cwd,
      status: "waiting",
    });
    const target = resolveAgentTarget(first, surfaces, [first, second]);

    expect(target.resolution).toBe("ambiguous");
    expect(target.surfaceId).toBeUndefined();
    expect(target.reason).toBe(
      "2 active sources share this cwd; cwd fallback requires exactly one and controls are disabled.",
    );
  });

  test("shared cwd with no cmux surface is view-only missing, not quarantined", () => {
    const first = agent({
      id: "codex:first",
      sourceSessionId: "first",
      cwd: "/Users/emilionunezgarcia/Developer/not-open",
    });
    const second = agent({
      id: "claude:second",
      provider: "claude",
      sourceSessionId: "second",
      cwd: first.cwd,
      status: "waiting",
    });
    const target = resolveAgentTarget(first, surfaces, [first, second]);

    expect(target).toEqual({
      resolution: "missing",
      reason: "No cmux surface matches this source session or cwd.",
    });
  });

  test("stale siblings do not disqualify a single active source from one-to-one cwd fallback", () => {
    const running = agent({ cwd: "/Users/emilionunezgarcia/Developer/unique-project" });
    const stale = agent({
      id: "codex:stale-sibling",
      sourceSessionId: "stale-sibling",
      status: "stale",
      cwd: running.cwd,
    });
    const target = resolveAgentTarget(running, surfaces, [running, stale]);

    expect(target.resolution).toBe("unique-cwd");
    expect(target.surfaceId).toBe("SURFACE-UNIQUE-CWD");
  });

  test("an internal child source does not compete with its controllable parent for cwd fallback", () => {
    const parent = agent({
      id: "codex:parent",
      sourceSessionId: "parent",
      cwd: "/Users/emilionunezgarcia/Developer/unique-project",
    });
    const child = agent({
      id: "codex:guardian",
      sourceSessionId: "guardian",
      parentSourceSessionId: parent.sourceSessionId,
      cwd: parent.cwd,
    });

    const parentTarget = resolveAgentTarget(parent, surfaces, [parent, child]);
    const childTarget = resolveAgentTarget(child, surfaces, [parent, child]);

    expect(parentTarget).toMatchObject({
      resolution: "unique-cwd",
      surfaceId: "SURFACE-UNIQUE-CWD",
    });
    expect(childTarget).toEqual({
      resolution: "missing",
      reason: "Child sources require exact session evidence; cwd fallback is disabled.",
    });
  });

  test("identity-conflicted surfaces remain quarantined from exact and cwd routing", () => {
    const conflicted = {
      ...surfaces.find(({ surfaceId }) => surfaceId === "SURFACE-UNIQUE-CWD")!,
      identityConflict: "OMP and Codex session files disagree",
    };
    const target = resolveAgentTarget(
      agent({ cwd: conflicted.cwd }),
      [conflicted],
    );

    expect(target.resolution).toBe("ambiguous");
    expect(target.surfaceId).toBeUndefined();
    expect(target.reason).toContain("quarantined");
    expect(target.reason).toContain("identity evidence conflicts");
  });

  test("cwd fallback cannot claim a surface carrying another exact session identity", () => {
    const claimed = {
      ...surfaces.find(({ surfaceId }) => surfaceId === "SURFACE-UNIQUE-CWD")!,
      sourceSessionIds: ["another-session"],
    };
    const target = resolveAgentTarget(agent({ cwd: claimed.cwd }), [claimed]);

    expect(target.resolution).toBe("ambiguous");
    expect(target.surfaceId).toBeUndefined();
    expect(target.reason).toBe(
      "cmux surfaces for this cwd already carry exact identity evidence; cwd fallback is disabled.",
    );
  });
});
