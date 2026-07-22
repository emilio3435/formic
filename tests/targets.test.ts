import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCmuxTerminals } from "../src/server/cmux";
import { resolveAgentTarget } from "../src/server/targets";
import type { CollectedAgent } from "../src/server/types";

const surfaces = parseCmuxTerminals(
  readFileSync(join(import.meta.dir, "fixtures", "cmux-discovery.json"), "utf8"),
);

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
      cwdMismatch: true,
    });
    expect(target.reason).toContain("differs from session cwd");
  });

  test("exact session match with agreeing cwd does not flag a mismatch", () => {
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
    });
    expect(target.cwdMismatch).toBeUndefined();
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
