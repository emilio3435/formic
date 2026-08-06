/**
 * Hermetic by construction — safe for `bun run test:ci`.
 *
 * Every git operation targets a temp repo under SCRATCH. Every SweepHost stubs
 * listProcesses/cwdOf (never the production host factory, never this machine's
 * process table or worktree list). No machine home dirs or localhost. The
 * branch name "main" exists only because initRepo creates it inside the temp clone.
 */
import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const realpath = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};
import {
  assertPlanShape,
  branchRefusals,
  buildRoster,
  blockingOccupants,
  confirmCleanup,
  enumerateCleanup,
  fingerprintPlan,
  occupantsForWorktrees,
  parseWorktreePorcelain,
  pathInsideWorktree,
  worktreeRefusals,
  writePlan,
  readPlan,
  runPropose,
  notificationViewFromPlan,
  confirmCommandFor,
  type CleanupPlan,
  type GitResult,
  type OccupantEvidence,
  type ProcessRow,
  type SweepHost,
} from "../scripts/anthill-cleanup-sweep";
import { livenessOf } from "../src/server/process-liveness";
import { isRecognizedAgentProcess } from "../src/server/identity";

const SCRATCH = mkdtempSync(join(tmpdir(), "anthill-cleanup-sweep-"));
const REPO_ROOT = resolve(import.meta.dir, "..");

/** Git env that cannot see the developer's global config or home repos. */
function hermeticGitEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    LC_ALL: "C",
    HOME: SCRATCH,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "sweep",
    GIT_AUTHOR_EMAIL: "sweep@example.com",
    GIT_COMMITTER_NAME: "sweep",
    GIT_COMMITTER_EMAIL: "sweep@example.com",
    ...extra,
  };
}

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

function underScratch(path: string): boolean {
  const root = realpath(SCRATCH);
  const abs = realpath(path);
  return abs === root || abs.startsWith(`${root}/`);
}

function git(cwd: string, args: string[]): string {
  if (!underScratch(cwd)) {
    throw new Error(`git cwd escapes SCRATCH: ${cwd}`);
  }
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: hermeticGitEnv(),
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")}: ${result.stderr.toString() || result.stdout.toString()}`);
  }
  return result.stdout.toString();
}

function initRepo(name: string): string {
  const root = join(SCRATCH, name);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.name", "sweep"]);
  git(root, ["config", "user.email", "sweep@example.com"]);
  writeFileSync(join(root, "README.md"), `# ${name}\n`);
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-m", "init"]);
  return root;
}

function addMergedWorktree(root: string, branch: string, dirName: string): string {
  git(root, ["checkout", "-b", branch]);
  writeFileSync(join(root, `${branch}.txt`), `${branch}\n`);
  git(root, ["add", `${branch}.txt`]);
  git(root, ["commit", "-m", `work on ${branch}`]);
  git(root, ["checkout", "main"]);
  git(root, ["merge", "--no-ff", branch, "-m", `merge ${branch}`]);
  const path = join(SCRATCH, dirName);
  rmSync(path, { recursive: true, force: true });
  // Recreate the branch tip as a worktree of the already-merged branch.
  // After merge, branch still points at its tip which is an ancestor of main.
  git(root, ["worktree", "add", path, branch]);
  return path;
}

function addUnmergedWorktree(root: string, branch: string, dirName: string): string {
  git(root, ["checkout", "-b", branch]);
  writeFileSync(join(root, `${branch}.txt`), `${branch}\n`);
  git(root, ["add", `${branch}.txt`]);
  git(root, ["commit", "-m", `work on ${branch}`]);
  git(root, ["checkout", "main"]);
  const path = join(SCRATCH, dirName);
  rmSync(path, { recursive: true, force: true });
  git(root, ["worktree", "add", path, branch]);
  return path;
}

function hostFor(
  root: string,
  extras: {
    processes?: ProcessRow[];
    complete?: boolean;
    cwds?: Map<number, string>;
    gitTap?: string[][];
  } = {},
): SweepHost {
  const commands: string[][] = extras.gitTap ?? [];
  return {
    git: (args, cwd) => {
      if (!underScratch(cwd)) {
        throw new Error(`SweepHost.git cwd escapes SCRATCH: ${cwd}`);
      }
      commands.push(["git", ...args]);
      const result = Bun.spawnSync(["git", ...args], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        env: hermeticGitEnv(),
      });
      return {
        exitCode: result.exitCode,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
      } satisfies GitResult;
    },
    listProcesses: () => ({
      complete: extras.complete ?? true,
      rows: extras.processes ?? [],
    }),
    cwdOf: (pids) => {
      const out = new Map<number, string>();
      for (const pid of pids) {
        const cwd = extras.cwds?.get(pid);
        if (cwd) out.set(pid, cwd);
      }
      return out;
    },
    nowIso: () => "2026-08-05T21:00:00.000Z",
    realpath,
  };
}

describe("cleanup sweep — liveness reuse", () => {
  test("isRecognizedAgentProcess still names the agent binaries", () => {
    expect(isRecognizedAgentProcess("codex resume abc")).toBe(true);
    expect(isRecognizedAgentProcess("/usr/libexec/siriknowledged")).toBe(false);
  });

  test("buildRoster + livenessOf: bare pid presence is not alive without provenance", () => {
    const rows: ProcessRow[] = [
      { pid: 4242, startSeconds: 100, command: "/usr/libexec/siriknowledged" },
    ];
    const roster = buildRoster(rows, true);
    // Daemon holding a number with no recorded start match → unverifiable, not alive.
    expect(livenessOf({ pid: 4242 }, roster)).toBe("unverifiable");
    // Agent name without start match is the weak positive the module documents.
    const agentRows: ProcessRow[] = [
      { pid: 99, startSeconds: 50, command: "codex exec something" },
    ];
    const agentRoster = buildRoster(agentRows, true);
    expect(livenessOf({ pid: 99 }, agentRoster)).toBe("alive");
    expect(livenessOf({ pid: 99, startSeconds: 50 }, agentRoster)).toBe("alive");
    expect(livenessOf({ pid: 99, startSeconds: 1 }, agentRoster)).toBe("gone");
  });

  test("occupantsForWorktrees hard-stops on alive and unverifiable, never on gone", () => {
    const tree = join(SCRATCH, "occ-tree");
    const src = join(tree, "src");
    mkdirSync(src, { recursive: true });
    const treeReal = realpath(tree);
    const srcReal = realpath(src);
    const host = hostFor(tree, {
      processes: [
        { pid: 1, startSeconds: 10, command: "codex resume aaa" },
        { pid: 2, startSeconds: 20, command: "claude -p hi" },
        { pid: 3, startSeconds: 30, command: "codex resume bbb" },
      ],
      cwds: new Map([
        [1, srcReal],
        [2, srcReal],
        [3, "/tmp/elsewhere"],
      ]),
    });
    const evidence: OccupantEvidence[] = [
      { pid: 1, command: "codex", cwd: treeReal, liveness: "alive", startSeconds: 10 },
      { pid: 2, command: "claude", cwd: treeReal, liveness: "unverifiable", startSeconds: 20 },
      { pid: 3, command: "codex", cwd: treeReal, liveness: "gone", startSeconds: 30 },
    ];
    const blockers = blockingOccupants(evidence);
    expect(blockers.map((o) => o.pid).sort()).toEqual([1, 2]);

    const map = occupantsForWorktrees([tree], host);
    const found = map.get(treeReal) ?? [];
    expect(found.map((o) => o.pid).sort()).toEqual([1, 2]);
    expect(found.every((o) => o.liveness === "alive")).toBe(true);
  });

  test("pathInsideWorktree is prefix-safe", () => {
    const id = (p: string) => p;
    expect(pathInsideWorktree("/tmp/wt/src", "/tmp/wt", id)).toBe(true);
    expect(pathInsideWorktree("/tmp/wt", "/tmp/wt", id)).toBe(true);
    expect(pathInsideWorktree("/tmp/wt-other", "/tmp/wt", id)).toBe(false);
  });
});

describe("cleanup sweep — refusal matrix", () => {
  test("occupied worktree is refused (live agent cwd)", () => {
    const root = initRepo("occ-repo");
    const wt = addMergedWorktree(root, "feat-occ", "occ-wt");
    const host = hostFor(root, {
      processes: [{ pid: 777, startSeconds: 40, command: "codex resume sess" }],
      cwds: new Map([[777, join(wt, "src")]]),
    });
    mkdirSync(join(wt, "src"), { recursive: true });
    const plan = enumerateCleanup(root, host);
    const report = plan.worktrees.find((t) => t.path === realpath(wt));
    expect(report).toBeDefined();
    expect(report!.eligible).toBe(false);
    expect(report!.refusals.join(" ")).toMatch(/live agent process/i);
    expect(plan.proposed.some((p) => p.kind === "worktree" && p.path === report!.path)).toBe(false);
  });

  test("dirty tree is refused", () => {
    const root = initRepo("dirty-repo");
    const wt = addMergedWorktree(root, "feat-dirty", "dirty-wt");
    writeFileSync(join(wt, "dirt.txt"), "nope\n");
    const plan = enumerateCleanup(root, hostFor(root));
    const report = plan.worktrees.find((t) => t.path === realpath(wt));
    expect(report!.treeState).toBe("dirty");
    expect(report!.eligible).toBe(false);
    expect(report!.refusals.join(" ")).toMatch(/dirty/i);
  });

  test("unmerged branch is refused and never proposed for -D", () => {
    const root = initRepo("unmerged-repo");
    const wt = addUnmergedWorktree(root, "feat-unmerged", "unmerged-wt");
    const plan = enumerateCleanup(root, hostFor(root));
    const tree = plan.worktrees.find((t) => t.path === realpath(wt));
    expect(tree!.mergedIntoMain).toBe(false);
    expect(tree!.eligible).toBe(false);
    expect(tree!.refusals.join(" ")).toMatch(/not merged/i);
    const branch = plan.branches.find((b) => b.name === "feat-unmerged");
    expect(branch!.eligible).toBe(false);
    expect(branch!.refusals.join(" ")).toMatch(/never -D/);
  });

  test("worktreeRefusals / branchRefusals name every hard stop", () => {
    expect(worktreeRefusals({
      path: "/x",
      branch: "b",
      headSha: "a".repeat(40),
      treeState: "dirty",
      mergedIntoMain: false,
      isPrimary: true,
      occupants: [{ pid: 1, command: "codex", cwd: "/x", liveness: "alive" }],
    })).toEqual(expect.arrayContaining([
      expect.stringMatching(/primary/),
      expect.stringMatching(/dirty/),
      expect.stringMatching(/not merged/),
      expect.stringMatching(/live agent/),
    ]));
    expect(branchRefusals({
      name: "main",
      tipSha: "b".repeat(40),
      mergedIntoMain: false,
      checkedOutAt: "/x",
    }, "main")).toEqual(expect.arrayContaining([
      expect.stringMatching(/main/),
      expect.stringMatching(/not merged/),
      expect.stringMatching(/checked out/),
    ]));
  });
});

describe("cleanup sweep — propose then confirm", () => {
  test("happy path: merged clean unoccupied worktree + branch, -d only", () => {
    const root = initRepo("happy-repo");
    const wt = addMergedWorktree(root, "feat-happy", "happy-wt");
    const tap: string[][] = [];
    const host = hostFor(root, { gitTap: tap });
    const plan = enumerateCleanup(root, host);
    const wtPath = realpath(wt);
    expect(plan.proposed.some((p) => p.kind === "worktree" && p.path === wtPath)).toBe(true);
    expect(plan.proposed.some((p) => p.kind === "branch" && p.name === "feat-happy")).toBe(true);
    for (const item of plan.proposed) {
      if (item.kind === "worktree") expect(item.rollbackSha).toMatch(/^[0-9a-f]{40}$/);
      if (item.kind === "branch") expect(item.rollbackSha).toMatch(/^[0-9a-f]{40}$/);
    }

    const result = confirmCleanup(plan, host);
    expect(result.ok, result.refused).toBe(true);
    const flat = tap.map((c) => c.join(" "));
    expect(flat.some((c) => c.includes("worktree remove"))).toBe(true);
    expect(flat.some((c) => /branch -d feat-happy/.test(c))).toBe(true);
    expect(flat.some((c) => c.includes("branch -D") || c.includes("branch --force"))).toBe(false);
    expect(flat.some((c) => c.includes("worktree remove") && c.includes("--force"))).toBe(false);
    // Worktree is gone.
    expect(Bun.spawnSync(["test", "-d", wt]).exitCode).not.toBe(0);
  });

  test("plan file that went stale between propose and confirm is refused", () => {
    const root = initRepo("stale-repo");
    const wt = addMergedWorktree(root, "feat-stale", "stale-wt");
    const host = hostFor(root);
    const plan = enumerateCleanup(root, host);
    expect(plan.proposed.length).toBeGreaterThan(0);

    // Mutate the worktree after propose — fingerprint must disagree.
    writeFileSync(join(wt, "stale.txt"), "changed after propose\n");
    git(wt, ["add", "stale.txt"]);
    git(wt, ["commit", "-m", "post-propose change"]);

    const result = confirmCleanup(plan, host);
    expect(result.ok).toBe(false);
    expect(result.refused).toMatch(/stale/i);
    // Nothing deleted.
    expect(Bun.spawnSync(["test", "-d", wt]).exitCode).toBe(0);
  });

  test("git branch -d refusal is surfaced, never escalated to -D", () => {
    const root = initRepo("d-refuse-merged");
    const wt = addMergedWorktree(root, "feat-d-merged", "d-merged-wt");
    git(root, ["worktree", "remove", wt]);

    const tap: string[][] = [];
    const live = enumerateCleanup(root, hostFor(root));
    const branchOnly: CleanupPlan = {
      ...live,
      proposed: live.proposed.filter((p) => p.kind === "branch" && p.name === "feat-d-merged"),
    };
    expect(branchOnly.proposed).toHaveLength(1);
    branchOnly.fingerprint = fingerprintPlan({
      mainTipSha: branchOnly.mainTipSha,
      proposed: branchOnly.proposed,
    });

    const failingHost: SweepHost = {
      ...hostFor(root, { gitTap: tap }),
      git: (args, cwd) => {
        tap.push(["git", ...args]);
        if (args[0] === "branch" && args[1] === "-d") {
          return {
            exitCode: 1,
            stdout: "",
            stderr: `error: the branch '${args[2]}' is not fully merged.\nIf you are sure you want to delete it, run 'git branch -D ${args[2]}'\n`,
          };
        }
        if (!underScratch(cwd)) {
          throw new Error(`failingHost git cwd escapes SCRATCH: ${cwd}`);
        }
        const result = Bun.spawnSync(["git", ...args], {
          cwd,
          stdout: "pipe",
          stderr: "pipe",
          env: hermeticGitEnv(),
        });
        return {
          exitCode: result.exitCode,
          stdout: result.stdout.toString(),
          stderr: result.stderr.toString(),
        };
      },
    };

    const result = confirmCleanup(branchOnly, failingHost);
    expect(result.ok).toBe(false);
    expect(result.refused).toMatch(/branch -d refused/i);
    expect(tap.some((c) => c.includes("-D") || c.includes("--force"))).toBe(false);
    expect(tap.some((c) => c[0] === "git" && c[1] === "branch" && c[2] === "-d")).toBe(true);
  });

  test("fingerprint changes when occupants appear after propose", () => {
    const root = initRepo("fp-repo");
    const wt = addMergedWorktree(root, "feat-fp", "fp-wt");
    const empty = hostFor(root);
    const plan = enumerateCleanup(root, empty);
    const occupied = hostFor(root, {
      processes: [{ pid: 42, startSeconds: 9, command: "claude -p x" }],
      cwds: new Map([[42, realpath(wt)]]),
    });
    const fresh = enumerateCleanup(root, occupied);
    expect(fresh.proposed.length).toBeLessThan(plan.proposed.length);
    expect(fresh.fingerprint).not.toBe(plan.fingerprint);
    const result = confirmCleanup(plan, occupied);
    expect(result.ok).toBe(false);
    expect(result.refused).toMatch(/stale/i);
  });

  test("writePlan / readPlan round-trip preserves fingerprint", () => {
    const root = initRepo("io-repo");
    addMergedWorktree(root, "feat-io", "io-wt");
    const plan = enumerateCleanup(root, hostFor(root));
    const path = join(SCRATCH, "plan.json");
    writePlan(plan, path);
    const loaded = readPlan(path);
    expect(assertPlanShape(loaded).fingerprint).toBe(plan.fingerprint);
  });
});

describe("cleanup sweep — porcelain parser", () => {
  test("parses worktree list --porcelain", () => {
    const trees = parseWorktreePorcelain(`worktree /repo
HEAD abcdef
branch refs/heads/main

worktree /repo/.wt/feat
HEAD 123456
branch refs/heads/feat

worktree /repo/detached
HEAD fedcba
detached

`);
    expect(trees).toEqual([
      { path: "/repo", head: "abcdef", branch: "main", bare: false },
      { path: "/repo/.wt/feat", head: "123456", branch: "feat", bare: false },
      { path: "/repo/detached", head: "fedcba", branch: null, bare: false },
    ]);
  });
});

describe("cleanup sweep — propose is board-safe", () => {
  test("enumerate issues only read-only git verbs", () => {
    const root = initRepo("readonly-repo");
    addMergedWorktree(root, "feat-ro", "ro-wt");
    const tap: string[][] = [];
    enumerateCleanup(root, hostFor(root, { gitTap: tap }));
    const flat = tap.map((c) => c.slice(1).join(" "));
    for (const cmd of flat) {
      expect(cmd).not.toMatch(/\bworktree remove\b/);
      expect(cmd).not.toMatch(/\bbranch -[dD]\b/);
      expect(cmd).not.toMatch(/\b--force\b/);
      expect(cmd).not.toMatch(/\bclean\b/);
      expect(cmd).not.toMatch(/\breset\b/);
    }
    expect(flat.some((c) => c.startsWith("worktree list"))).toBe(true);
  });

  test("notification view names removable, refused, and confirmCommand", () => {
    const root = initRepo("notify-repo");
    const wt = addMergedWorktree(root, "feat-notify", "notify-wt");
    writeFileSync(join(wt, "dirt.txt"), "x\n"); // refuse dirty
    const planPath = join(SCRATCH, "notify-plan.json");
    const { plan, notification } = runPropose(root, planPath, hostFor(root));
    expect(notification.planPath).toBe(resolve(planPath));
    expect(notification.confirmCommand).toBe(confirmCommandFor(resolve(planPath)));
    expect(notification.confirmCommand).toContain("confirm ");
    expect(notification.removable.every((r) => /^[0-9a-f]{40}$/.test(r.rollbackSha))).toBe(true);
    expect(notification.refused.worktrees.some((t) => t.reasons.some((r) => /dirty/i.test(r)))).toBe(true);
    expect(notification.refused.worktrees.every((t) => t.reasons.length > 0)).toBe(true);
    expect(notificationViewFromPlan(plan, planPath).fingerprint).toBe(plan.fingerprint);
  });

  test("concurrent propose writes serialize and leave valid JSON", async () => {
    const root = initRepo("concurrent-repo");
    addMergedWorktree(root, "feat-cc", "cc-wt");
    const planPath = join(SCRATCH, "concurrent-plan.json");
    const host = hostFor(root);
    const runs = await Promise.all([
      Promise.resolve(runPropose(root, planPath, host)),
      Promise.resolve(runPropose(root, planPath, { ...host, nowIso: () => "2026-08-05T21:00:01.000Z" })),
      Promise.resolve(runPropose(root, planPath, { ...host, nowIso: () => "2026-08-05T21:00:02.000Z" })),
    ]);
    const loaded = readPlan(planPath);
    expect(loaded.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(loaded.confirmCommand).toContain(planPath);
    expect(runs.every((r) => r.notification.confirmCommand.includes("confirm"))).toBe(true);
  });

  test("script header forbids wiring confirm to the board", () => {
    const src = readFileSync(
      join(import.meta.dir, "../scripts/anthill-cleanup-sweep.ts"),
      "utf8",
    );
    expect(src).toMatch(/THE BOARD NEVER DELETES/);
    expect(src).toMatch(/No destructive server endpoint/);
    expect(src).toMatch(/Do not wire `confirm` to a route/);
  });
});

describe("cleanup sweep — hermeticity pins", () => {
  test("SCRATCH is outside this repo and HOME-independent", () => {
    expect(resolve(SCRATCH).startsWith(resolve(REPO_ROOT))).toBe(false);
    expect(SCRATCH.startsWith(tmpdir()) || resolve(SCRATCH).includes("/tmp") || resolve(SCRATCH).includes("T/")).toBe(true);
  });

  test("this file never imports the production host factory or machine paths", () => {
    const src = readFileSync(join(import.meta.dir, "cleanup-sweep.test.ts"), "utf8");
    // Import line only — the symbol name of scripts/anthill-cleanup-sweep.ts's live host.
    expect(src).not.toMatch(/import\s*\{[^}]*\bdefaultHost\b/);
    expect(src).not.toMatch(/~\/\.cmuxterm/);
    expect(src).not.toMatch(/~\/\.anthill/);
    expect(src).not.toMatch(/127\.0\.0\.1/);
    expect(src).not.toMatch(/localhost:\d+/);
  });

  test("SweepHost refuses a git cwd outside SCRATCH", () => {
    const host = hostFor(join(SCRATCH, "unused"));
    expect(() => host.git(["status"], REPO_ROOT)).toThrow(/escapes SCRATCH/);
  });
});
