import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  compactHookStore,
  compactHookStoreFile,
  DEFAULT_COMPACTION_DAYS,
} from "../scripts/cmux-hook-store-compact";

const REAL_CMUXTERM = join(process.env.HOME ?? "", ".cmuxterm");
const SCRATCH = `/private/tmp/claude-501/anthill-hook-compact-${process.pid}`;
const NOW = 1_785_940_000; // fixture "now" in unix seconds

function fresh(name: string): string {
  const root = join(SCRATCH, name);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  return root;
}

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

describe("cmux hook-store compaction", () => {
  test("prunes dead activeSessionsBySurface entries older than N days", () => {
    const stale = NOW - (DEFAULT_COMPACTION_DAYS + 1) * 86_400;
    const recent = NOW - 60;
    const result = compactHookStore({
      version: 1,
      sessions: {
        "live-session": {
          sessionId: "live-session",
          agentLifecycle: "running",
          updatedAt: recent,
        },
        "ended-session": {
          sessionId: "ended-session",
          agentLifecycle: "ended",
          updatedAt: stale,
        },
      },
      activeSessionsBySurface: {
        "SURFACE-DEAD-ENDED": { sessionId: "ended-session", updatedAt: stale },
        "SURFACE-DEAD-MISSING": { sessionId: "gone", updatedAt: stale },
        "SURFACE-LIVE": { sessionId: "live-session", updatedAt: recent },
        "SURFACE-ENDED-BUT-FRESH": { sessionId: "ended-session", updatedAt: recent },
      },
      activeSessionsByWorkspace: {
        "WORKSPACE-DEAD": { sessionId: "gone", updatedAt: stale },
        "WORKSPACE-LIVE": { sessionId: "live-session", updatedAt: recent },
      },
    }, { nowSeconds: NOW, maxAgeDays: DEFAULT_COMPACTION_DAYS });

    expect(result.prunedSurfaceIds.sort()).toEqual([
      "SURFACE-DEAD-ENDED",
      "SURFACE-DEAD-MISSING",
    ]);
    expect(result.prunedWorkspaceIds).toEqual(["WORKSPACE-DEAD"]);
    expect(result.store.activeSessionsBySurface).toEqual({
      "SURFACE-LIVE": { sessionId: "live-session", updatedAt: recent },
      "SURFACE-ENDED-BUT-FRESH": { sessionId: "ended-session", updatedAt: recent },
    });
    expect(result.store.activeSessionsByWorkspace).toEqual({
      "WORKSPACE-LIVE": { sessionId: "live-session", updatedAt: recent },
    });
    // Session records are never compacted away.
    expect(Object.keys(result.store.sessions ?? {})).toEqual([
      "live-session",
      "ended-session",
    ]);
  });

  test("file compaction writes only under a temp root", () => {
    const root = fresh("file");
    expect(root.startsWith(SCRATCH)).toBeTrue();
    expect(root.startsWith(REAL_CMUXTERM)).toBeFalse();

    const stale = NOW - 10 * 86_400;
    const path = join(root, "cursor-hook-sessions.json");
    writeFileSync(path, `${JSON.stringify({
      version: 1,
      sessions: {},
      activeSessionsBySurface: {
        "SURFACE-OLD": { sessionId: "missing", updatedAt: stale },
      },
      activeSessionsByWorkspace: {},
    }, null, 2)}\n`);

    const result = compactHookStoreFile(path, {
      nowSeconds: NOW,
      maxAgeDays: 7,
    });

    expect(result.wrote).toBeTrue();
    expect(result.prunedSurfaceIds).toEqual(["SURFACE-OLD"]);
    const written = JSON.parse(readFileSync(path, "utf8")) as {
      activeSessionsBySurface: Record<string, unknown>;
    };
    expect(written.activeSessionsBySurface).toEqual({});
  });

  test("dry-run reports prunes without rewriting the file", () => {
    const root = fresh("dry");
    const stale = NOW - 10 * 86_400;
    const path = join(root, "factory-hook-sessions.json");
    const original = `${JSON.stringify({
      version: 1,
      sessions: {},
      activeSessionsBySurface: {
        "SURFACE-OLD": { sessionId: "missing", updatedAt: stale },
      },
      activeSessionsByWorkspace: {},
    }, null, 2)}\n`;
    writeFileSync(path, original);

    const result = compactHookStoreFile(path, {
      nowSeconds: NOW,
      maxAgeDays: 7,
      dryRun: true,
    });

    expect(result.wrote).toBeFalse();
    expect(result.prunedSurfaceIds).toEqual(["SURFACE-OLD"]);
    expect(readFileSync(path, "utf8")).toBe(original);
  });

  test("CLI compacts provider files under ANTHILL_CMUXTERM_ROOT", () => {
    const root = fresh("cli");
    writeFileSync(join(root, "cursor-hook-sessions.json"), `${JSON.stringify({
      version: 1,
      sessions: {},
      activeSessionsBySurface: {
        // Ancient updatedAt so wall-clock "now" in the CLI always qualifies.
        "SURFACE-OLD": { sessionId: "missing", updatedAt: 1 },
      },
      activeSessionsByWorkspace: {},
    })}\n`);

    const result = Bun.spawnSync([
      process.execPath,
      join(import.meta.dir, "../scripts/cmux-hook-store-compact.ts"),
      "--root",
      root,
      "--days",
      "7",
      "--provider",
      "cursor",
    ], {
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: join(root, "home"),
        ANTHILL_CMUXTERM_ROOT: root,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    const summary = JSON.parse(result.stdout.toString()) as {
      files: Array<{ prunedSurfaceIds: string[] }>;
    };
    expect(summary.files[0]?.prunedSurfaceIds).toEqual(["SURFACE-OLD"]);
  });
});
