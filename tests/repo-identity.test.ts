import { expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  fnvKey,
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

test("independent HTTPS and SSH clones of one origin share one repository key", () => {
  const identity = (cwd: string, commonDir: string, origin: string) => {
    const exec: RepoIdentityExec = (command) => command.includes("rev-parse")
      ? { exitCode: 0, stdout: `${commonDir}\n${cwd}\nmain\n` }
      : { exitCode: 0, stdout: `${origin}\n` };
    return resolveRepoIdentity(cwd, { exec, realpath: (path) => path });
  };

  const httpsClone = identity(
    "/Users/example/Developer/ProjectAtlas-copy",
    "/Users/example/Developer/ProjectAtlas-copy/.git",
    "https://alice:placeholder@GitHub.com/Example/ProjectAtlas.git",
  );
  const sshClone = identity(
    "/Volumes/work/atlas",
    "/Volumes/work/atlas/.git",
    "git@github.com:Example/ProjectAtlas.git",
  );

  expect(httpsClone?.repoKey).toBe(fnvKey("github.com/Example/ProjectAtlas"));
  expect(sshClone?.repoKey).toBe(httpsClone?.repoKey);
  expect(httpsClone?.repoName).toBe("ProjectAtlas");
  expect(sshClone?.repoName).toBe("ProjectAtlas");
  expect(sshClone?.worktreePath).not.toBe(httpsClone?.worktreePath);
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
  const exec: RepoIdentityExec = (command) => command.includes("rev-parse")
    ? { exitCode: 0, stdout: `${commonDir}\n${worktreePath}\nfeature/atlas\n` }
    : { exitCode: 1, stdout: "" };

  expect(resolveRepoIdentity(worktreePath, { exec, realpath: (path) => path })).toMatchObject({
    repoKey: fnvKey(commonDir),
    repoName: "ProjectAtlas",
    worktreePath,
    ephemeral: true,
  });
});

test("a cache hit inside the TTL does not rerun either git identity probe", () => {
  const cwd = "/Users/example/Developer/ProjectAtlas";
  const commonDir = join(cwd, ".git");
  const executor = {
    run: (command: readonly string[]) => command.includes("rev-parse")
      ? { exitCode: 0, stdout: `${commonDir}\n${cwd}\nmain\n` }
      : { exitCode: 0, stdout: "https://github.com/example/ProjectAtlas.git\n" },
  };
  const exec = spyOn(executor, "run");
  const options = { exec, realpath: (path: string) => path, now: () => 1_000 };

  expect(resolveRepoIdentity(cwd, options)).not.toBeNull();
  expect(resolveRepoIdentity(cwd, options)).not.toBeNull();
  expect(exec).toHaveBeenCalledTimes(2);
  expect(exec.mock.calls.map(([command]) => command)).toEqual([
    ["git", "-C", cwd, "rev-parse", "--git-common-dir", "--show-toplevel", "--abbrev-ref", "HEAD"],
    ["git", "-C", cwd, "remote", "get-url", "origin"],
  ]);
});
