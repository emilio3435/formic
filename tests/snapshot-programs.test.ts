import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RepoIdentity } from "../src/shared/types";
import { fnvKey, resolveRepoIdentity } from "../src/server/repo-identity";
import { buildSnapshot } from "../src/server/snapshot";
import { programFor } from "../src/server/snapshot-programs";
import { HubState, type HubCollectors } from "../src/server/state";
import type { ArchiveStore, CollectedAgent, CommandRunner } from "../src/server/types";

const archiveStore: ArchiveStore = {
  has: () => false,
  archive: async () => {},
};

function collected(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: "codex:atlas",
    provider: "codex",
    sourceSessionId: "atlas",
    displayName: "Atlas",
    cwd: "/Users/example/Developer/ProjectAtlas",
    status: "running",
    statusReason: "Fixture activity is recent.",
    startedAt: "2026-08-05T12:00:00.000Z",
    updatedAt: "2026-08-05T12:01:00.000Z",
    tokens: { total: 42, provenance: "observed" },
    artifacts: [],
    gates: [],
    ...overrides,
  };
}

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
}

async function repositoryWithWorktree(): Promise<{ root: string; checkout: string; worktree: string }> {
  const root = await mkdtemp(join(tmpdir(), "anthill-snapshot-programs-"));
  const checkout = join(root, "ProjectAtlas");
  const worktree = join(root, "ProjectAtlas-feature");
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
  return { root, checkout, worktree };
}

test("repo-derived programs use the repo id and a stable worktree group path", () => {
  const first: RepoIdentity = {
    repoKey: "atlas-repo",
    repoName: "ProjectAtlas",
    worktreePath: "/repos/ProjectAtlas",
    branch: "main",
    ephemeral: false,
  };
  const second = { ...first, worktreePath: "/repos/ProjectAtlas-feature", branch: "feature/atlas" };

  const firstWorktreeKey = fnvKey(first.worktreePath);
  const secondWorktreeKey = fnvKey(second.worktreePath);
  expect(programFor(collected(), [], undefined, false, first)).toEqual({
    id: `repo:atlas-repo:worktree:${firstWorktreeKey}`,
    name: "ProjectAtlas",
    path: first.worktreePath,
    groupPath: ["atlas-repo", firstWorktreeKey],
  });
  expect(programFor(collected(), [], undefined, false, second)).toEqual({
    id: `repo:atlas-repo:worktree:${secondWorktreeKey}`,
    name: "ProjectAtlas",
    path: second.worktreePath,
    groupPath: ["atlas-repo", secondWorktreeKey],
  });
});

test("operator program hints outrank repository derivation", () => {
  const repo: RepoIdentity = {
    repoKey: "atlas-repo",
    repoName: "ProjectAtlas",
    worktreePath: "/repos/ProjectAtlas",
    ephemeral: false,
  };

  expect(programFor(collected(), [{
    id: "operator-atlas",
    name: "Operator Atlas",
    match: ["ProjectAtlas"],
  }], undefined, false, repo)).toEqual({
    id: "operator-atlas",
    name: "Operator Atlas",
    purpose: undefined,
    path: undefined,
  });
});

test("sessions without a repository keep the existing cwd fallback", () => {
  const fallback = programFor(collected({ cwd: "/opt/work/standalone-task" }), []);

  expect(fallback.name).toBe("standalone-task");
  expect(fallback.path).toBe("/opt/work/standalone-task");
  expect(fallback.id).toStartWith("cwd-standalone-task-");
  expect(fallback).not.toHaveProperty("groupPath");
});

test("one repo publishes separate worktree leaves without losing either session", async () => {
  const fixture = await repositoryWithWorktree();
  try {
    const snapshot = buildSnapshot({
      agents: [
        collected({ id: "codex:main", sourceSessionId: "main", cwd: fixture.checkout }),
        collected({ id: "codex:feature", sourceSessionId: "feature", cwd: fixture.worktree }),
      ],
      surfaces: [],
      archiveStore,
      now: new Date("2026-08-05T12:01:30.000Z"),
    });

    expect(snapshot.programs).toHaveLength(2);
    expect(new Set(snapshot.programs.map(({ id }) => id)).size).toBe(2);
    expect(new Set(snapshot.programs.map(({ groupPath }) => groupPath?.[1]))).toEqual(new Set([
      fnvKey(resolveRepoIdentity(fixture.checkout)!.worktreePath),
      fnvKey(resolveRepoIdentity(fixture.worktree)!.worktreePath),
    ]));
    expect(snapshot.programs.flatMap(({ agents }) => agents).map(({ id }) => id).sort()).toEqual([
      "codex:feature",
      "codex:main",
    ]);
    expect(new Set(snapshot.programs.flatMap(({ agents }) => agents).map(({ programId }) => programId)))
      .toEqual(new Set([`repo:${resolveRepoIdentity(fixture.checkout)?.repoKey}`]));
    expect(snapshot.programs.flatMap(({ agents }) => agents).every(({ repo }) => Boolean(repo))).toBeTrue();
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("the cmux tick keeps sidebar repo facts and they outrank spawned git branch state", async () => {
  const repo = resolveRepoIdentity(process.cwd());
  expect(repo).not.toBeNull();
  if (!repo) throw new Error("test checkout must be a git repository");
  let sidebarCalls = 0;
  const source = collected({ cwd: process.cwd() });
  const collectors: HubCollectors = {
    sessions: async () => ({
      omp: { value: [], errors: [] },
      codex: { value: [source], errors: [] },
      claude: { value: [], errors: [] },
      cursor: { value: [], errors: [] },
      factory: { value: [], errors: [] },
    }),
    cmux: async () => ({
      value: [{
        workspaceId: "WORKSPACE-ATLAS",
        surfaceId: "SURFACE-ATLAS",
        cwd: process.cwd(),
        branch: "stale-surface-branch",
        dirty: false,
        sourceSessionIds: [source.sourceSessionId],
      }],
      errors: [],
    }),
    sidebar: async () => {
      sidebarCalls += 1;
      return {
        value: [{
          workspaceId: "WORKSPACE-ATLAS",
          projectRootPath: process.cwd(),
          branch: "sidebar/live",
          dirty: true,
          pullRequestUrls: ["https://github.com/example/atlas/pull/42"],
        }],
        errors: [],
      };
    },
    notifications: async () => ({ value: [], errors: [] }),
    enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [] }),
  };
  const runner: CommandRunner = {
    run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
  };
  const state = new HubState(runner, archiveStore, [], { collectors });

  const snapshot = await state.refresh({ cmux: true });
  const agent = snapshot.programs.flatMap(({ agents }) => agents)[0];

  expect(sidebarCalls).toBe(1);
  expect(agent?.repo).toEqual({ ...repo, branch: "sidebar/live" });
  expect(agent?.git).toEqual({ branch: "sidebar/live", dirty: true, head: undefined });
  expect(agent?.pullRequestUrls).toEqual(["https://github.com/example/atlas/pull/42"]);
  expect(snapshot.programs[0]?.id).toStartWith(`repo:${repo.repoKey}:worktree:`);
  expect(agent?.programId).toBe(`repo:${repo.repoKey}`);

  await state.refresh();
  expect(sidebarCalls).toBe(1);
});
