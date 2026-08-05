import { expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveRepoIdentity,
  type RepoIdentityExec,
} from "../src/server/repo-identity";

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString() || `git ${args.join(" ")} exited ${result.exitCode}`);
  }
}

test("one repository keeps its identity across distinct worktrees", async () => {
  const root = await mkdtemp(join(tmpdir(), "anthill-repo-identity-"));
  try {
    const checkout = join(root, "ProjectAtlas");
    const worktree = join(root, "feature-worktree");
    await mkdir(checkout);
    git(checkout, "init", "--initial-branch=main");
    await writeFile(join(checkout, "README.md"), "atlas\n", "utf8");
    git(checkout, "add", "README.md");
    git(
      checkout,
      "-c",
      "user.name=Ant Hill Test",
      "-c",
      "user.email=anthill@example.invalid",
      "commit",
      "-m",
      "fixture",
    );
    git(checkout, "worktree", "add", "-b", "feature/atlas", worktree);

    const mainIdentity = resolveRepoIdentity(checkout);
    const worktreeIdentity = resolveRepoIdentity(worktree);

    expect(mainIdentity).not.toBeNull();
    expect(worktreeIdentity).not.toBeNull();
    expect(worktreeIdentity?.repoKey).toBe(mainIdentity?.repoKey);
    expect(mainIdentity?.repoName).toBe("ProjectAtlas");
    expect(worktreeIdentity?.repoName).toBe("ProjectAtlas");
    expect(mainIdentity?.worktreePath).toBe(await realpath(checkout));
    expect(worktreeIdentity?.worktreePath).toBe(await realpath(worktree));
    expect(mainIdentity?.branch).toBe("main");
    expect(worktreeIdentity?.branch).toBe("feature/atlas");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a non-git working directory has no repository identity", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "anthill-not-a-repo-"));
  try {
    expect(resolveRepoIdentity(cwd)).toBeNull();
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("a Codex disposable worktree is marked ephemeral", () => {
  const worktreePath = join(homedir(), ".codex", "worktrees", "atlas-run", "ProjectAtlas");
  const commonDir = join(homedir(), "Developer", "ProjectAtlas", ".git");
  const exec: RepoIdentityExec = () => ({
    exitCode: 0,
    stdout: `${commonDir}\n${worktreePath}\nfeature/atlas\n`,
  });

  expect(resolveRepoIdentity(worktreePath, { exec, realpath: (path) => path })).toMatchObject({
    repoName: "ProjectAtlas",
    worktreePath,
    ephemeral: true,
  });
});

test("a cache hit inside the TTL does not respawn git", () => {
  const cwd = "/Users/example/Developer/ProjectAtlas";
  const commonDir = join(cwd, ".git");
  const executor = {
    run: (_command: readonly string[]) => ({
      exitCode: 0,
      stdout: `${commonDir}\n${cwd}\nmain\n`,
    }),
  };
  const exec = spyOn(executor, "run");
  const options = { exec, realpath: (path: string) => path, now: () => 1_000 };

  expect(resolveRepoIdentity(cwd, options)).not.toBeNull();
  expect(resolveRepoIdentity(cwd, options)).not.toBeNull();
  expect(exec).toHaveBeenCalledTimes(1);
});
