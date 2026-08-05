import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readRunManifests } from "../src/server/run-manifests";
import {
  defaultRunsRoot,
  parseAgentId,
  writeLaneRegistration,
} from "../scripts/anthill-manifest";

const PROJECT_ROOT = join(import.meta.dir, "..");
const REAL_RUNS = join(process.env.HOME ?? "", ".anthill", "runs");
const SCRATCH_ROOT = `/private/tmp/claude-501/anthill-manifest-register-${process.pid}`;

function freshFixture(name: string): string {
  const root = join(SCRATCH_ROOT, name);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  return root;
}

function seedManifest(root: string, runId: string, lanes: Record<string, unknown>[]): string {
  const path = join(root, `${runId}.json`);
  writeFileSync(path, `${JSON.stringify({
    runId,
    createdAt: "2026-08-05T15:34:20.000Z",
    repoRoot: "/tmp/repo",
    orchestrator: { provider: "claude", sessionId: "orch-1" },
    lanes,
  }, null, 2)}\n`);
  return path;
}

function assertNeverTouchesRealRuns(root: string): void {
  expect(root.startsWith(SCRATCH_ROOT)).toBeTrue();
  expect(root).not.toBe(REAL_RUNS);
  expect(root.startsWith(`${REAL_RUNS}/`)).toBeFalse();
}

function run(
  command: string[],
  cwd: string,
  env: Record<string, string>,
): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(command, { cwd, env, stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

afterAll(() => {
  rmSync(SCRATCH_ROOT, { recursive: true, force: true });
});

describe("anthill manifest registration (T9)", () => {
  test("defaultRunsRoot honors ANTHILL_RUNS_ROOT", () => {
    expect(defaultRunsRoot({ ANTHILL_RUNS_ROOT: "/tmp/runs-override" })).toBe("/tmp/runs-override");
    expect(defaultRunsRoot({ ANTHILL_RUNS_ROOT: "  " })).toBe(REAL_RUNS);
  });

  test("parseAgentId requires provider:sessionId", () => {
    expect(parseAgentId("cursor:c1111111-2222-4333-8444-555555555555")).toEqual({
      provider: "cursor",
      sessionId: "c1111111-2222-4333-8444-555555555555",
    });
    expect(parseAgentId("not-an-agent-id")).toBeUndefined();
  });

  test("boot writes sessionId + status/statusAt pair and stays fail-closed-parseable", () => {
    const root = freshFixture("boot");
    assertNeverTouchesRealRuns(root);
    seedManifest(root, "atlas-hardening-2026-08-05", [{
      laneId: "harden2",
      role: "tester",
      provider: "cursor",
      worktree: "/tmp/wt",
      branch: "ant-hill/hardening-harden2-20260805",
      model: "grok-4.5-high-fast",
      brief: "/tmp/brief.md",
    }]);

    const result = writeLaneRegistration({
      root,
      runId: "atlas-hardening-2026-08-05",
      laneId: "harden2",
      provider: "cursor",
      sessionId: "c1111111-2222-4333-8444-555555555555",
      mode: "boot",
      statusAt: "2026-08-05T17:00:00.000Z",
    });

    expect(result).toMatchObject({ ok: true, wrote: true, reason: "created-binding" });
    const manifests = readRunManifests([root]);
    expect(manifests).toHaveLength(1);
    expect(manifests[0]?.lanes[0]).toMatchObject({
      laneId: "harden2",
      provider: "cursor",
      sessionId: "c1111111-2222-4333-8444-555555555555",
      status: "active",
      statusAt: "2026-08-05T17:00:00.000Z",
    });
  });

  test("boot is first-write-wins when another session already owns the lane", () => {
    const root = freshFixture("first-write-wins");
    assertNeverTouchesRealRuns(root);
    seedManifest(root, "run-a", [{
      laneId: "be-truth",
      role: "worker",
      provider: "codex",
      sessionId: "already-bound",
      status: "active",
      statusAt: "2026-08-05T16:00:00.000Z",
    }]);

    const result = writeLaneRegistration({
      root,
      runId: "run-a",
      laneId: "be-truth",
      provider: "codex",
      sessionId: "intruder-session",
      mode: "boot",
      statusAt: "2026-08-05T17:00:00.000Z",
    });

    expect(result).toMatchObject({ ok: true, wrote: false, reason: "first-write-wins" });
    const lane = readRunManifests([root])[0]?.lanes[0];
    expect(lane?.sessionId).toBe("already-bound");
    expect(lane?.statusAt).toBe("2026-08-05T16:00:00.000Z");
  });

  test("done marks the owning session done; refuses a foreign session", () => {
    const root = freshFixture("done");
    assertNeverTouchesRealRuns(root);
    seedManifest(root, "run-b", [{
      laneId: "fe-states",
      role: "worker",
      provider: "claude",
      sessionId: "mine",
      status: "active",
      statusAt: "2026-08-05T16:00:00.000Z",
    }]);

    expect(writeLaneRegistration({
      root,
      runId: "run-b",
      laneId: "fe-states",
      provider: "claude",
      sessionId: "other",
      mode: "done",
      statusAt: "2026-08-05T17:00:00.000Z",
    })).toMatchObject({ ok: true, wrote: false, reason: "first-write-wins" });

    expect(writeLaneRegistration({
      root,
      runId: "run-b",
      laneId: "fe-states",
      provider: "claude",
      sessionId: "mine",
      mode: "done",
      statusAt: "2026-08-05T17:05:00.000Z",
    })).toMatchObject({ ok: true, wrote: true, reason: "updated-status" });

    expect(readRunManifests([root])[0]?.lanes[0]).toMatchObject({
      sessionId: "mine",
      status: "done",
      statusAt: "2026-08-05T17:05:00.000Z",
    });
  });

  test("backfill adopts a visible session and appends history on succession", () => {
    const root = freshFixture("backfill");
    assertNeverTouchesRealRuns(root);
    seedManifest(root, "run-c", [{
      laneId: "harden2",
      role: "tester",
      provider: "cursor",
      sessionId: "old-session",
      status: "active",
      statusAt: "2026-08-05T16:00:00.000Z",
    }]);

    const cli = run(
      [
        process.execPath,
        join(PROJECT_ROOT, "scripts/anthill-manifest.ts"),
        "backfill",
        "run-c",
        "harden2",
        "cursor:new-session",
        "--root",
        root,
        "--status-at",
        "2026-08-05T18:00:00.000Z",
      ],
      PROJECT_ROOT,
      {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: join(root, "home"),
        ANTHILL_RUNS_ROOT: root,
      },
    );

    expect(cli.exitCode).toBe(0);
    expect(readRunManifests([root])[0]?.lanes[0]).toMatchObject({
      sessionId: "new-session",
      provider: "cursor",
      status: "active",
      statusAt: "2026-08-05T18:00:00.000Z",
    });
    const history = readFileSync(join(root, "run-c.history.jsonl"), "utf8").trim().split("\n");
    expect(history).toHaveLength(1);
    expect(JSON.parse(history[0]!)).toMatchObject({
      op: "backfill",
      laneId: "harden2",
      sessionId: "new-session",
      previousSessionId: "old-session",
      succession: true,
    });
  });

  test("anthill-backfill wrapper delegates to the manifest writer", () => {
    const root = freshFixture("backfill-wrapper");
    assertNeverTouchesRealRuns(root);
    seedManifest(root, "run-d", [{
      laneId: "be-live",
      role: "worker",
      provider: "codex",
    }]);

    const result = run(
      [
        join(PROJECT_ROOT, "scripts/anthill-backfill"),
        "run-d",
        "be-live",
        "codex:019fd291-62e4-7152-a9b4-6d781396802c",
        "--root",
        root,
        "--status-at",
        "2026-08-05T18:30:00.000Z",
      ],
      PROJECT_ROOT,
      {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: join(root, "home"),
        BUN_BIN: process.execPath,
        ANTHILL_RUNS_ROOT: root,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(readRunManifests([root])[0]?.lanes[0]?.sessionId)
      .toBe("019fd291-62e4-7152-a9b4-6d781396802c");
  });

  test("sourced self-register boot then EXIT writes active then done", () => {
    const root = freshFixture("self-register");
    assertNeverTouchesRealRuns(root);
    seedManifest(root, "run-e", [{
      laneId: "harden2",
      role: "tester",
      provider: "cursor",
    }]);

    const script = [
      "set -euo pipefail",
      `export ANTHILL_RUN=run-e`,
      `export ANTHILL_LANE=harden2`,
      `export ANTHILL_PROVIDER=cursor`,
      `export ANTHILL_SESSION=c2222222-3333-4444-8555-666666666666`,
      `export ANTHILL_RUNS_ROOT=${root}`,
      `export BUN_BIN=${process.execPath}`,
      `source ${join(PROJECT_ROOT, "scripts/anthill-self-register.sh")}`,
      // Still inside the shell — boot must have fired; done waits for EXIT.
      `python3 - <<'PY'`,
      `import json`,
      `from pathlib import Path`,
      `lane=json.loads(Path(${JSON.stringify(join(root, "run-e.json"))}).read_text())["lanes"][0]`,
      `assert lane["status"]=="active", lane`,
      `assert lane["sessionId"]=="c2222222-3333-4444-8555-666666666666", lane`,
      `PY`,
    ].join("\n");

    const result = run(["bash", "-c", script], PROJECT_ROOT, {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: join(root, "home"),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    // After the bash -c process exits, the EXIT trap should have marked done.
    expect(readRunManifests([root])[0]?.lanes[0]).toMatchObject({
      sessionId: "c2222222-3333-4444-8555-666666666666",
      status: "done",
    });
  });

  test("half-pair writes never land — status and statusAt stay coupled", () => {
    const root = freshFixture("pair");
    assertNeverTouchesRealRuns(root);
    seedManifest(root, "run-f", [{
      laneId: "fe-states",
      role: "worker",
      provider: "claude",
    }]);

    writeLaneRegistration({
      root,
      runId: "run-f",
      laneId: "fe-states",
      provider: "claude",
      sessionId: "sess",
      mode: "boot",
      statusAt: "2026-08-05T19:00:00.000Z",
    });

    const raw = JSON.parse(readFileSync(join(root, "run-f.json"), "utf8")) as {
      lanes: Array<{ status?: string; statusAt?: string }>;
    };
    const lane = raw.lanes[0]!;
    expect(Boolean(lane.status)).toBe(Boolean(lane.statusAt));
    expect(lane.status).toBe("active");
    expect(lane.statusAt).toBe("2026-08-05T19:00:00.000Z");
    // Parser accepts the file (fail-closed would drop a half pair).
    expect(readRunManifests([root])).toHaveLength(1);
  });
});
