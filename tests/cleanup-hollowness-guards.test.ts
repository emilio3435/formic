/**
 * Live guards for cleanup-sweep / propose-endpoint claims that mutation showed
 * were unguarded. See docs/TEST-HOLLOWNESS-AUDIT.md round 3.
 *
 * Hermetic by construction — safe for `bun run test:ci`. Every git operation
 * targets a temp repo under SCRATCH. Never the production host factory.
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
import {
  confirmCleanup,
  enumerateCleanup,
  fingerprintPlan,
  worktreeRefusals,
  type CleanupPlan,
  type GitResult,
  type ProcessRow,
  type SweepHost,
} from "../scripts/anthill-cleanup-sweep";

const SCRATCH = mkdtempSync(join(tmpdir(), "anthill-cleanup-hollow-"));
const SWEEP_SRC = join(import.meta.dir, "../scripts/anthill-cleanup-sweep.ts");

const realpath = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

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

describe("G3 — defense-in-depth throws must exist in source", () => {
  /* Mutation that stayed GREEN: delete the internal throw that fires if
     --force / -f reaches the worktree-remove arg list. Args are hardcoded
     immediately above, so no behavioral test can reach the throw — it is
     decoration unless the source itself is pinned. */
  test("confirmCleanup throws if worktree remove ever carries --force or -f", () => {
    const src = readFileSync(SWEEP_SRC, "utf8");
    const confirm = src.slice(src.indexOf("export function confirmCleanup"));
    expect(confirm).toMatch(
      /removeArgs\.includes\(["']--force["']\)\s*\|\|\s*removeArgs\.includes\(["']-f["']\)/,
    );
    expect(confirm).toMatch(
      /throw new Error\(["']internal error: worktree remove must never pass --force["']\)/,
    );
  });

  test("confirmCleanup throws if branch delete ever carries -D or --force", () => {
    const src = readFileSync(SWEEP_SRC, "utf8");
    const confirm = src.slice(src.indexOf("export function confirmCleanup"));
    expect(confirm).toMatch(
      /deleteArgs\.includes\(["']-D["']\)\s*\|\|\s*deleteArgs\.includes\(["']--force["']\)/,
    );
    expect(confirm).toMatch(
      /throw new Error\(["']internal error: branch delete must use -d, never -D["']\)/,
    );
  });
});

describe("G4 — unverifiable occupant is fail-closed, not absent", () => {
  /* Mutation that stayed GREEN: drop the unverifiable refusal arm in
     worktreeRefusals so an occupant we cannot verify is treated as absent.
     Existing suite covers alive cwd + blockingOccupants membership, and
     "name every hard stop" lists primary/dirty/unmerged/alive — but never
     an unverifiable-only report. Missing-entry softness: the suite asserts
     what appears, not what fails to. */
  test("worktreeRefusals refuses an unverifiable-only occupant", () => {
    const cleanMerged = {
      path: "/x/wt",
      branch: "feat",
      headSha: "a".repeat(40),
      treeState: "clean" as const,
      mergedIntoMain: true,
      isPrimary: false,
    };
    const refusals = worktreeRefusals({
      ...cleanMerged,
      occupants: [{
        pid: 9,
        command: "claude -p x",
        cwd: "/x/wt",
        liveness: "unverifiable",
      }],
    });
    expect(refusals, "unverifiable must be a hard stop, not treated as absent")
      .toEqual(expect.arrayContaining([expect.stringMatching(/unverifiable/i)]));
    /* Contrast: gone occupant alone must not refuse (fail-closed is only
       alive + unverifiable). */
    expect(worktreeRefusals({
      ...cleanMerged,
      occupants: [{
        pid: 9,
        command: "claude -p x",
        cwd: "/x/wt",
        liveness: "gone",
      }],
    })).toEqual([]);
  });

  test("worktreeRefusals source still names the unverifiable hard stop", () => {
    const src = readFileSync(SWEEP_SRC, "utf8");
    const body = src.slice(src.indexOf("export function worktreeRefusals"));
    const end = body.indexOf("\nexport function branchRefusals");
    const fn = end === -1 ? body : body.slice(0, end);
    expect(fn).toMatch(/liveness === ["']unverifiable["']/);
    expect(fn).toMatch(/unverifiable agent process cwd'd inside this worktree/);
  });
});

describe("G5 — fingerprint re-check is not optional", () => {
  /* Mutation nuance: skipping the fingerprint re-check left the named
     "plan file that went stale…" test GREEN because HEAD-moved still
     returns a message matching /stale/i. A forged fingerprint with an
     otherwise-identical eligible tree is what uniquely demands the check. */
  test("confirmCleanup refuses a plan whose fingerprint was forged", () => {
    const root = initRepo("fp-forge-repo");
    const wt = addMergedWorktree(root, "feat-fp-forge", "fp-forge-wt");
    const host = hostFor(root);
    const plan = enumerateCleanup(root, host);
    expect(plan.proposed.some((p) => p.kind === "worktree" && p.path === realpath(wt))).toBe(true);

    const forged: CleanupPlan = {
      ...plan,
      fingerprint: "0".repeat(64),
    };
    expect(forged.fingerprint).not.toBe(plan.fingerprint);
    /* Recompute to prove the tree is still eligible — only the fingerprint
       field is wrong. */
    expect(fingerprintPlan({
      mainTipSha: forged.mainTipSha,
      proposed: forged.proposed,
    })).toBe(plan.fingerprint);

    const result = confirmCleanup(forged, host);
    expect(result.ok).toBe(false);
    expect(result.refused).toMatch(/stale between propose and confirm/i);
    expect(Bun.spawnSync(["test", "-d", wt]).exitCode).toBe(0);
  });
});
