import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCmuxTerminals } from "../src/server/cmux";
import { collectSessions, DEFAULT_SESSION_WINDOW_MS } from "../src/server/collectors";
import { classifyLifecycle } from "../src/server/lifecycle";
import { roleFor2, lifecycleFor } from "../src/server/snapshot-agent";
import type { CollectedAgent } from "../src/server/types";

/* Zombie/service sweeps for Atlas HARDEN G4.

   Two fixtures, one product claim each:
   - a bare `npm run dev` cmux surface with no bound session is an observed
     `service` (not an agent seat);
   - a session whose cwd is gone and whose process probe is negative retires as
     `worktree-deleted` / finished, rather than lingering as a zombie worker. */

const TREE = readFileSync(
  join(import.meta.dir, "fixtures/cmux-zombie-service-tree.json"),
  "utf8",
);
const HOOK_FIXTURE = join(import.meta.dir, "fixtures/cmux-zombie-service-hooks");
const ZOMBIE_SESSION = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const temporaryHomes: string[] = [];

afterEach(() => {
  for (const home of temporaryHomes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function collected(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: `codex:${ZOMBIE_SESSION}`,
    provider: "codex",
    sourceSessionId: ZOMBIE_SESSION,
    displayName: "zombie lane",
    status: "running",
    statusReason: "Fixture activity is recent.",
    updatedAt: "2026-08-05T12:00:00.000Z",
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    ...overrides,
  };
}

describe("cmux zombie/service tree — service classification", () => {
  test("the bare npm run dev surface has no bound session and classifies as service", () => {
    const surfaces = parseCmuxTerminals(TREE);
    const service = surfaces.find((surface) => surface.surfaceId === "SURFACE-SERVICE-DEV");
    const zombie = surfaces.find((surface) => surface.surfaceId === "SURFACE-ZOMBIE");

    expect(service).toMatchObject({
      title: "npm run dev",
      cwd: "/tmp/anthill-g4-live-project",
      sourceSessionIds: [],
    });
    expect(zombie?.sourceSessionIds).toEqual([ZOMBIE_SESSION]);

    expect(roleFor2(undefined, {
      unboundSurface: service!.sourceSessionIds.length === 0,
    })).toEqual({
      role: "service",
      roleSource: "observed",
    });

    /* A bound zombie surface is a session seat, not a service — even with a
       deleted cwd. Classification is unboundness, not the title string. */
    expect(roleFor2(collected(), {
      unboundSurface: (zombie?.sourceSessionIds.length ?? 0) === 0,
    })).not.toMatchObject({ role: "service" });
  });

  test("service cannot be declared on a bound agent session", () => {
    expect(roleFor2(collected({ displayName: "npm run dev" }), {
      declaredRole: "service",
    })).toEqual({
      role: "agent",
      roleSource: "inferred",
    });
  });
});

describe("cmux zombie/service tree — worktree retirement", () => {
  test("deleted cwd + gone process retires as worktree-deleted through the collector", async () => {
    const home = mkdtempSync(join(tmpdir(), "anthill-g4-zombie-"));
    temporaryHomes.push(home);
    const sessions = join(home, ".codex", "sessions");
    const hookRoot = join(home, ".cmuxterm");
    const deletedCwd = join(home, "deleted-worktree");
    mkdirSync(sessions, { recursive: true });
    mkdirSync(hookRoot, { recursive: true });

    writeFileSync(join(sessions, "session.jsonl"), `${JSON.stringify({
      type: "session_meta",
      timestamp: new Date().toISOString(),
      payload: { id: ZOMBIE_SESSION },
    })}\n`);

    const hook = JSON.parse(readFileSync(join(HOOK_FIXTURE, "codex-hook-sessions.json"), "utf8"));
    hook.sessions[ZOMBIE_SESSION].cwd = deletedCwd;
    writeFileSync(join(hookRoot, "codex-hook-sessions.json"), JSON.stringify(hook));

    const result = await collectSessions(home, DEFAULT_SESSION_WINDOW_MS, undefined, {
      hookProcessStarts: () => new Map([[4242, 1_785_933_000]]),
    });
    const agent = result.codex.value[0];

    expect(agent).toMatchObject({
      cwd: deletedCwd,
      processAlive: false,
      endEvidence: "worktree-deleted",
    });

    const verdict = lifecycleFor(agent!, {
      operatorArchived: false,
      scope: "observed",
      nowMs: Date.parse(agent!.updatedAt) + 1_000,
    });
    expect(verdict).toMatchObject({
      lifecycle: "finished",
      provenance: "process-died",
      reason: "Process checked and gone after its worktree was deleted.",
    });
    expect(classifyLifecycle({
      ageMs: 1_000,
      endEvidence: "worktree-deleted",
    })).toEqual(verdict);
  });

  test("negative controls — missing cwd alone, or a dead probe with a living cwd, do not retire", () => {
    expect(classifyLifecycle({ ageMs: 1_000, cwdExists: false }).lifecycle).toBe("working");
    expect(classifyLifecycle({
      ageMs: 1_000,
      processAlive: false,
      cwdExists: true,
    }).lifecycle).toBe("working");
  });
});
