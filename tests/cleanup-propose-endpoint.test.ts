import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createMountainFetch,
  emptySnapshot,
  type MountainAppState,
} from "../src/server/app";
import {
  CLEANER_MODEL,
  CLEANER_PROMPT,
  CleanupLaunchError,
  createNativeCleanupLauncher,
  type CleanupLauncher,
} from "../src/server/cleanup-launch";
import type {
  CleanupNotificationView,
} from "../scripts/anthill-cleanup-sweep";
import type { AgentSnapshot, HubSnapshot } from "../src/shared/types";
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

function launchRequest(path = "/api/cleanup/launch"): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { origin: ORIGIN },
  });
}

function cleanerAgent(sessionId: string, activity: AgentSnapshot["activity"] = "working"): AgentSnapshot {
  return {
    id: `cursor:${sessionId}`,
    provider: "cursor",
    sourceSessionId: sessionId,
    displayName: "Cleaner",
    identity: { name: "Cleaner", base: "Cleaner", source: "authored", authoredBy: "launch-env" },
    programId: "cleanup",
    status: activity === "ended" ? "archived" : "running",
    statusReason: "Cleaner is using the ordinary Cursor session machinery.",
    activity,
    lastHumanMessage: null,
    updatedAt: "2026-08-06T14:00:00.000Z",
    tokens: { scope: "unknown", provenance: "unknown" },
    artifacts: [],
    gates: [],
    target: { resolution: "missing" },
    controls: [],
  };
}

function stateThatObserves(sessionId: string): MountainAppState {
  let snapshot: HubSnapshot = emptySnapshot();
  const listeners = new Set<(value: HubSnapshot) => void>();
  return {
    get: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh: async () => {
      snapshot = {
        ...snapshot,
        generatedAt: "2026-08-06T14:00:00.000Z",
        programs: [{ id: "cleanup", name: "Cleanup", agents: [cleanerAgent(sessionId)] }],
      };
      for (const listener of listeners) listener(snapshot);
      return snapshot;
    },
  };
}

function launchServer(cleanupLauncher: CleanupLauncher, state: MountainAppState) {
  const runner: CommandRunner = {
    run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
  };
  const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
  return createMountainFetch({
    state,
    runner,
    archiveStore,
    cleanupLauncher,
    webRoot: import.meta.dir,
  });
}

class ScriptedRunner implements CommandRunner {
  readonly commands: string[][] = [];

  constructor(private readonly results: Array<{
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }>) {}

  async run(command: readonly string[]): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }> {
    this.commands.push([...command]);
    const result = this.results.shift();
    if (!result) throw new Error("No scripted command result remains");
    return result;
  }
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

  test("the cleanup routes can reach propose or launch only; destructive verbs and a confirm route are absent", async () => {
    const root = join(import.meta.dir, "..");
    const app = readFileSync(join(root, "src/server/app.ts"), "utf8");
    const proposer = readFileSync(join(root, "src/server/cleanup-propose.ts"), "utf8");
    const worker = readFileSync(join(root, "src/server/cleanup-propose-worker.ts"), "utf8");
    const launcher = readFileSync(join(root, "src/server/cleanup-launch.ts"), "utf8");
    const production = readFileSync(join(root, "src/server/index.ts"), "utf8");
    const reachable = [app, proposer, worker, launcher, production].join("\n");

    expect(worker).toContain("enumerateCleanup");
    expect(launcher).not.toMatch(/from\s+["'][^"']*anthill-cleanup-sweep/);
    expect(reachable).not.toContain("confirmCleanup");
    expect(reachable).not.toMatch(/\bworktree remove\b/);
    expect(reachable).not.toMatch(/\bbranch -[dD]\b/);
    expect(reachable).not.toContain("--force");
    expect(app).toContain('"/api/cleanup/propose"');
    expect(app).toContain('"/api/cleanup/launch"');
    expect(app).not.toContain('"/api/cleanup/confirm"');

    const fetch = server(async () => notification);
    expect((await fetch(proposeRequest("/api/cleanup/confirm"))).status).toBe(404);
  });
});

describe("Cleaner lane contract", () => {
  test("launches the ratified model and cleanup skill through the ordinary Cursor hook wrapper", async () => {
    const sessionId = "79592379-c8fb-4ea4-800c-57c22d3c435e";
    const runner = new ScriptedRunner([
      { exitCode: 0, stdout: `${sessionId}\n`, stderr: "", timedOut: false },
      { exitCode: 0, stdout: "workspace:9\n", stderr: "", timedOut: false },
    ]);
    const named: Array<{ agentId: string; name: string }> = [];
    const launch = createNativeCleanupLauncher({
      repoRoot: "/repo",
      cmuxExecutable: "cmux",
      runner,
      nameSession: async (agentId, name) => { named.push({ agentId, name }); },
    });

    expect(await launch()).toEqual({ sessionId });
    expect(runner.commands[0]).toEqual(["/repo/scripts/anthill-cursor-agent", "create-chat"]);
    expect(runner.commands[1]?.slice(0, 2)).toEqual(["cmux", "new-workspace"]);
    expect(runner.commands[1]).toContain("Cleaner");
    expect(runner.commands[1]).toContain("false");
    const command = runner.commands[1]?.[runner.commands[1]!.indexOf("--command") + 1] ?? "";
    expect(command).toContain("/repo/scripts/anthill-cursor-agent");
    expect(command).toContain(`'--resume' '${sessionId}'`);
    expect(command).toContain(`'--model' '${CLEANER_MODEL}'`);
    expect(command).toContain("/cleanup");
    expect(command).toContain("scripts/anthill-cleanup-sweep.ts");
    expect(named).toEqual([{ agentId: `cursor:${sessionId}`, name: "Cleaner" }]);

    expect(CLEANER_PROMPT.startsWith("Goal:")).toBe(true);
    expect(CLEANER_PROMPT).toContain("Success means:");
    expect(CLEANER_PROMPT).toContain("Stop when:");
    expect(CLEANER_PROMPT).toMatch(/operator.*approv/i);
    expect(CLEANER_PROMPT).toMatch(/rollback SHA/i);
    expect(CLEANER_PROMPT).toMatch(/live agent process.*hard stop/i);
    expect(CLEANER_PROMPT).toMatch(/ordinary session/i);
  });

  test("reports cmux refusal as a launch failure and leaves no authored lane name behind", async () => {
    const sessionId = "79592379-c8fb-4ea4-800c-57c22d3c435e";
    const runner = new ScriptedRunner([
      { exitCode: 0, stdout: `${sessionId}\n`, stderr: "", timedOut: false },
      { exitCode: 1, stdout: "", stderr: "socket unavailable", timedOut: false },
    ]);
    const named: string[] = [];
    const launch = createNativeCleanupLauncher({
      repoRoot: "/repo",
      cmuxExecutable: "cmux",
      runner,
      nameSession: async (agentId) => { named.push(agentId); },
    });

    await expect(launch()).rejects.toMatchObject({
      code: "CLEANER_CMUX_UNREACHABLE",
      message: expect.stringContaining("socket unavailable"),
    });
    expect(named).toEqual([]);
  });

  test("refuses an unbindable create-chat response before asking cmux for a workspace", async () => {
    const runner = new ScriptedRunner([
      { exitCode: 0, stdout: "created something\n", stderr: "", timedOut: false },
    ]);
    const launch = createNativeCleanupLauncher({ repoRoot: "/repo", cmuxExecutable: "cmux", runner });

    await expect(launch()).rejects.toMatchObject({ code: "CLEANER_SESSION_ID_INVALID" });
    expect(runner.commands).toHaveLength(1);
  });
});

describe("POST /api/cleanup/launch", () => {
  test("rejects non-POST and cross-origin requests before invoking the launcher", async () => {
    let calls = 0;
    const sessionId = "79592379-c8fb-4ea4-800c-57c22d3c435e";
    const fetch = launchServer(async () => {
      calls += 1;
      return { sessionId };
    }, stateThatObserves(sessionId));

    expect((await fetch(new Request(`${ORIGIN}/api/cleanup/launch`))).status).toBe(405);
    expect((await fetch(new Request(`${ORIGIN}/api/cleanup/launch`, {
      method: "POST",
      headers: { origin: "http://example.test" },
    }))).status).toBe(403);
    expect(calls).toBe(0);
  });

  test("a double launch shares one spawn and returns the still-running Cleaner", async () => {
    const sessionId = "79592379-c8fb-4ea4-800c-57c22d3c435e";
    let release!: (value: { sessionId: string }) => void;
    const pending = new Promise<{ sessionId: string }>((resolve) => { release = resolve; });
    let calls = 0;
    const fetch = launchServer(() => {
      calls += 1;
      return pending;
    }, stateThatObserves(sessionId));

    const first = fetch(launchRequest());
    const second = fetch(launchRequest());
    expect(calls).toBe(1);
    release({ sessionId });

    const bodies = await Promise.all([
      first.then((response) => response.json()),
      second.then((response) => response.json()),
    ]);
    expect(bodies).toEqual([
      { ok: true, sessionId },
      { ok: true, sessionId },
    ]);
    const alreadyRunning = await fetch(launchRequest());
    expect(alreadyRunning.status).toBe(409);
    expect(await alreadyRunning.json()).toMatchObject({
      ok: false,
      sessionId,
      error: { code: "CLEANER_ALREADY_RUNNING" },
    });
    expect(calls).toBe(1);
  });

  test("reports a native spawn failure instead of returning a dead session id", async () => {
    const state = stateThatObserves("79592379-c8fb-4ea4-800c-57c22d3c435e");
    const fetch = launchServer(async () => {
      throw new CleanupLaunchError("CLEANER_LAUNCH_FAILED", "cmux could not create the Cleaner workspace.");
    }, state);

    const response = await fetch(launchRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: "CLEANER_LAUNCH_FAILED",
        message: "cmux could not create the Cleaner workspace.",
      },
    });
  });

  test("returns only after the session id resolves in the next ordinary snapshot", async () => {
    const sessionId = "79592379-c8fb-4ea4-800c-57c22d3c435e";
    const fetch = launchServer(async () => ({ sessionId }), stateThatObserves(sessionId));

    const launched = await (await fetch(launchRequest())).json() as { sessionId: string };
    const snapshot = await (await fetch(new Request(`${ORIGIN}/api/snapshot`))).json() as HubSnapshot;
    const cleaner = snapshot.programs.flatMap(({ agents }) => agents)
      .find(({ sourceSessionId }) => sourceSessionId === launched.sessionId);

    expect(cleaner?.identity?.name).toBe("Cleaner");
    expect(cleaner?.provider).toBe("cursor");
  });

  test("an unobservable session fails closed and a retry cannot launch a duplicate", async () => {
    const sessionId = "79592379-c8fb-4ea4-800c-57c22d3c435e";
    let calls = 0;
    const snapshot = emptySnapshot();
    const state: MountainAppState = {
      get: () => snapshot,
      subscribe: () => () => {},
      refresh: async () => snapshot,
    };
    const fetch = launchServer(async () => {
      calls += 1;
      return { sessionId };
    }, state);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(launchRequest());
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: { code: "CLEANER_SESSION_NOT_OBSERVED" },
      });
    }
    expect(calls).toBe(1);
  });
});
