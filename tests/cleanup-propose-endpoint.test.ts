import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createMountainFetch,
  emptySnapshot,
  type MountainAppState,
} from "../src/server/app";
import type {
  CleanupNotificationView,
} from "../scripts/anthill-cleanup-sweep";
import type { ArchiveStore, CommandRunner } from "../src/server/types";

const ORIGIN = "http://127.0.0.1:4701";

const notification: CleanupNotificationView = {
  version: 1,
  createdAt: "2026-08-05T21:00:00.000Z",
  repoRoot: "/repo",
  mainRef: "main",
  mainTipSha: "a".repeat(40),
  fingerprint: "b".repeat(64),
  planPath: "/repo/.anthill/cleanup-plan.json",
  confirmCommand: "bun scripts/anthill-cleanup-sweep.ts confirm /repo/.anthill/cleanup-plan.json",
  removable: [{
    kind: "worktree",
    target: "/repo-worktrees/merged",
    rollbackSha: "c".repeat(40),
    branch: "feat/merged",
  }],
  refused: {
    worktrees: [{
      path: "/repo-worktrees/busy",
      branch: "feat/busy",
      reasons: ["live agent process cwd'd inside this worktree — hard stop"],
    }],
    branches: [{
      name: "feat/unmerged",
      reasons: ["branch is not merged into main — git branch -d would refuse; never -D"],
    }],
  },
};

function server(cleanupProposer: () => Promise<CleanupNotificationView>) {
  const snapshot = emptySnapshot();
  const state: MountainAppState = {
    get: () => snapshot,
    subscribe: () => () => {},
    refresh: async () => snapshot,
  };
  const runner: CommandRunner = {
    run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
  };
  const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
  return createMountainFetch({
    state,
    runner,
    archiveStore,
    cleanupProposer,
    webRoot: import.meta.dir,
  });
}

function proposeRequest(path = "/api/cleanup/propose"): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { origin: ORIGIN },
  });
}

describe("POST /api/cleanup/propose", () => {
  test("returns rollback-backed removals, refusals, and the terminal confirm command", async () => {
    const fetch = server(async () => notification);
    const response = await fetch(proposeRequest());
    const body = await response.json() as {
      ok: boolean;
      complete: boolean;
      plan: CleanupNotificationView;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, complete: true });
    expect(body.plan.removable).toEqual(notification.removable);
    expect(body.plan.refused).toEqual(notification.refused);
    expect(body.plan.confirmCommand).toBe(notification.confirmCommand);
  });

  test("concurrent clicks share one slow run while snapshots keep responding", async () => {
    let release!: (value: CleanupNotificationView) => void;
    const pending = new Promise<CleanupNotificationView>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const fetch = server(() => {
      calls += 1;
      return pending;
    });

    const first = fetch(proposeRequest());
    const second = fetch(proposeRequest());
    expect(calls).toBe(1);

    const snapshot = await fetch(new Request(`${ORIGIN}/api/snapshot`));
    expect(snapshot.status).toBe(200);

    release(notification);
    const bodies = await Promise.all([
      first.then((response) => response.json()),
      second.then((response) => response.json()),
    ]) as Array<{ plan: CleanupNotificationView }>;
    expect(bodies.map((body) => body.plan.fingerprint)).toEqual([
      notification.fingerprint,
      notification.fingerprint,
    ]);
    expect(calls).toBe(1);
  });

  test("incomplete enumeration is explicit and never returns a partial plan", async () => {
    const error = Object.assign(
      new Error("Process table enumeration is incomplete; no cleanup plan was produced."),
      { code: "CLEANUP_ENUMERATION_INCOMPLETE" },
    );
    const fetch = server(async () => { throw error; });
    const response = await fetch(proposeRequest());
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      ok: false,
      complete: false,
      error: {
        code: "CLEANUP_ENUMERATION_INCOMPLETE",
        message: expect.stringMatching(/incomplete/i),
      },
    });
    expect(body).not.toHaveProperty("plan");
  });

  test("the route can reach propose only; destructive verbs and a confirm route are absent", async () => {
    const root = join(import.meta.dir, "..");
    const app = readFileSync(join(root, "src/server/app.ts"), "utf8");
    const proposer = readFileSync(join(root, "src/server/cleanup-propose.ts"), "utf8");
    const worker = readFileSync(join(root, "src/server/cleanup-propose-worker.ts"), "utf8");
    const production = readFileSync(join(root, "src/server/index.ts"), "utf8");
    const reachable = [app, proposer, worker, production].join("\n");

    expect(worker).toContain("enumerateCleanup");
    expect(reachable).not.toContain("confirmCleanup");
    expect(reachable).not.toMatch(/\bworktree remove\b/);
    expect(reachable).not.toMatch(/\bbranch -[dD]\b/);
    expect(reachable).not.toContain("--force");
    expect(app).toContain('"/api/cleanup/propose"');
    expect(app).not.toContain('"/api/cleanup/confirm"');

    const fetch = server(async () => notification);
    expect((await fetch(proposeRequest("/api/cleanup/confirm"))).status).toBe(404);
  });
});
