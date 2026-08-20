import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  envFactsFor,
  manifestFactsFor,
  readRunManifests,
  type RunManifest,
} from "../src/server/run-manifests";
import {
  collectCmuxWorkspaceEnvs,
  parseCmuxWorkspaceEnv,
} from "../src/server/cmux";
import { resolveRepoIdentity } from "../src/server/repo-identity";
import { buildSnapshot } from "../src/server/snapshot";
import { HubState, type HubCollectors } from "../src/server/state";
import type { ArchiveStore, CollectedAgent, CommandRunner } from "../src/server/types";

const FIXTURE_ROOT = join(import.meta.dir, "fixtures", "runs");

test("a valid run manifest binds its lane and orchestrator to declared lineage", () => {
  const manifests = readRunManifests([FIXTURE_ROOT]);

  expect(manifests).toHaveLength(1);
  expect(manifests[0]).toMatchObject({
    runId: "inbox-ux-overhaul-2026-08-05",
    repoRoot: "/Users/ant/Developer/LaHormigaDormida",
    lanes: [{ laneId: "fe1-geometry", role: "worker" }],
  });
  expect(manifestFactsFor("claude:lane-geometry-20260805", manifests)).toEqual({
    runId: "inbox-ux-overhaul-2026-08-05",
    laneId: "fe1-geometry",
    role: "worker",
    parentAgentId: "claude:orch-atlas-20260805",
    repoRoot: "/Users/ant/Developer/LaHormigaDormida",
  });
  expect(manifestFactsFor("claude:orch-atlas-20260805", manifests)).toEqual({
    runId: "inbox-ux-overhaul-2026-08-05",
    laneId: "inbox-ux-overhaul-2026-08-05",
    role: "orchestrator",
    parentAgentId: undefined,
    repoRoot: "/Users/ant/Developer/LaHormigaDormida",
  });
});

test("malformed files are skipped and the newest duplicate run declaration wins", async () => {
  const root = await mkdtemp(join(tmpdir(), "anthill-run-manifests-"));
  try {
    const manifest = (createdAt: string, laneId: string) => JSON.stringify({
      runId: "duplicate-run",
      createdAt,
      repoRoot: "/repos/atlas",
      orchestrator: { provider: "claude", sessionId: "orchestrator" },
      lanes: [{ laneId, role: "verifier", provider: "codex", sessionId: "lane" }],
    });
    await writeFile(join(root, "broken.json"), "{not-json", "utf8");
    await writeFile(join(root, "older.json"), manifest("2026-08-05T12:00:00.000+02:00", "old-lane"), "utf8");
    await writeFile(join(root, "newer.json"), manifest("2026-08-05T11:00:00.000Z", "new-lane"), "utf8");

    const manifests = readRunManifests([root]);

    expect(manifests).toHaveLength(1);
    expect(manifests[0]?.createdAt).toBe("2026-08-05T11:00:00.000Z");
    expect(manifestFactsFor("codex:lane", manifests)?.laneId).toBe("new-lane");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace env supplies declared lineage and is cached without retaining unrelated variables", async () => {
  const output = JSON.stringify({
    count: 5,
    env: {
      ANTHILL_RUN: "env-only-run",
      ANTHILL_LANE: "be-env-lane",
      ANTHILL_ROLE: "verifier",
      ANTHILL_PARENT: "claude:env-orchestrator",
      PRIVATE_TOKEN: "must-not-enter-the-snapshot-pipeline",
    },
    workspace_ref: "workspace:68",
  });
  expect(parseCmuxWorkspaceEnv(output)).toEqual({
    ANTHILL_RUN: "env-only-run",
    ANTHILL_LANE: "be-env-lane",
    ANTHILL_ROLE: "verifier",
    ANTHILL_PARENT: "claude:env-orchestrator",
  });

  const commands: readonly string[][] = [];
  const runner: CommandRunner = {
    run: async (command) => {
      (commands as string[][]).push([...command]);
      return { exitCode: 0, stdout: output, stderr: "", timedOut: false };
    },
  };
  const workspaceId = "WORKSPACE-B3-ENV-CACHE";

  const first = await collectCmuxWorkspaceEnvs(runner, [workspaceId, workspaceId], "cmux");
  const second = await collectCmuxWorkspaceEnvs(runner, [workspaceId], "cmux");

  expect(first).toEqual({
    value: [{
      workspaceId,
      variables: {
        ANTHILL_RUN: "env-only-run",
        ANTHILL_LANE: "be-env-lane",
        ANTHILL_ROLE: "verifier",
        ANTHILL_PARENT: "claude:env-orchestrator",
      },
    }],
    errors: [],
  });
  expect(second).toEqual(first);
  expect(envFactsFor(first.value[0]!.variables)).toEqual({
    runId: "env-only-run",
    laneId: "be-env-lane",
    role: "verifier",
    parentAgentId: "claude:env-orchestrator",
  });
  expect(envFactsFor({
    ANTHILL_RUN: "partial-run",
    ANTHILL_LANE: "partial-lane",
    ANTHILL_ROLE: "verifier",
  })).toBeUndefined();
  expect(envFactsFor({
    ANTHILL_RUN: "partial-run",
    ANTHILL_LANE: "partial-lane",
    ANTHILL_ROLE: "verifier",
    ANTHILL_PARENT: "not-an-agent-id",
  })).toBeUndefined();
  expect(commands).toEqual([[
    "cmux",
    "workspace",
    "env",
    workspaceId,
    "--json",
  ]]);
});

test("a tombstoned workspace is an enrichment miss while other env failures stay visible", async () => {
  const missing = await collectCmuxWorkspaceEnvs({
    run: async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "Error: not_found: Workspace not found",
      timedOut: false,
    }),
  }, ["WORKSPACE-TOMBSTONED-20260805"]);
  expect(missing).toEqual({ value: [], errors: [] });

  const failed = await collectCmuxWorkspaceEnvs({
    run: async () => ({
      exitCode: 13,
      stdout: "",
      stderr: "permission denied",
      timedOut: false,
    }),
  }, ["WORKSPACE-ENV-FAILURE-20260805"]);
  expect(failed.value).toEqual([]);
  expect(failed.errors).toEqual([
    "cmux workspace env WORKSPACE-ENV-FAILURE-20260805 exited 13: permission denied",
  ]);
});

const archiveStore: ArchiveStore = {
  has: () => false,
  archive: async () => {},
};

function collected(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: "codex:declared-lane",
    provider: "codex",
    sourceSessionId: "declared-lane",
    displayName: "Declared lane",
    identity: {
      name: "Provider-authored name",
      base: "Provider-authored name",
      source: "authored",
      authoredBy: "codex-nickname",
    },
    originCwd: process.cwd(),
    cwd: process.cwd(),
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

function manifest(): RunManifest {
  return {
    runId: "manifest-run",
    createdAt: "2026-08-05T12:00:00.000Z",
    repoRoot: process.cwd(),
    orchestrator: { provider: "claude", sessionId: "manifest-orchestrator" },
    lanes: [{
      laneId: "be-manifest-lane",
      role: "worker",
      provider: "codex",
      sessionId: "declared-lane",
    }],
  };
}

test("lane history links every session cycle and retires each predecessor", async () => {
  const root = await mkdtemp(join(tmpdir(), "anthill-run-succession-"));
  try {
    await writeFile(join(root, "manifest-run.json"), JSON.stringify({
      runId: "manifest-run",
      createdAt: "2026-08-05T12:00:00.000Z",
      repoRoot: process.cwd(),
      orchestrator: { provider: "claude", sessionId: "manifest-orchestrator" },
      lanes: [{
        laneId: "be-manifest-lane",
        role: "worker",
        provider: "codex",
        sessionId: "cycle-3",
        status: "active",
        statusAt: "2026-08-05T12:01:00.000Z",
      }],
    }), "utf8");
    await writeFile(join(root, "manifest-run.history.jsonl"), [
      JSON.stringify({
        at: "2026-08-05T11:00:00.000Z",
        op: "boot",
        laneId: "be-manifest-lane",
        provider: "codex",
        sessionId: "cycle-1",
      }),
      "{not-json",
      JSON.stringify({
        // Append order is authoritative; a caller-supplied clock can move backward.
        at: "2026-08-05T10:30:00.000Z",
        op: "backfill",
        laneId: "be-manifest-lane",
        provider: "codex",
        sessionId: "cycle-2",
        previousProvider: null,
        previousSessionId: "cycle-1",
        succession: true,
      }),
      JSON.stringify({
        at: "2026-08-05T11:45:00.000Z",
        op: "done",
        laneId: "be-manifest-lane",
        provider: "codex",
        sessionId: "cycle-2",
      }),
    ].join("\n") + "\n", "utf8");

    const manifests = readRunManifests([root]);

    expect(Object.keys(manifests[0]!)).not.toContain("history");
    expect(manifestFactsFor("codex:cycle-1", manifests)).toMatchObject({
      runId: "manifest-run",
      laneId: "be-manifest-lane",
      succeededBy: "codex:cycle-2",
    });
    expect(manifestFactsFor("codex:cycle-2", manifests)).toMatchObject({
      supersedes: "codex:cycle-1",
      succeededBy: "codex:cycle-3",
    });
    expect(manifestFactsFor("codex:cycle-3", manifests)).toMatchObject({
      supersedes: "codex:cycle-2",
      taskState: "active",
      taskStateAt: "2026-08-05T12:01:00.000Z",
    });

    const sources = ["cycle-1", "cycle-2", "cycle-3"].map((sessionId) => collected({
      id: `codex:${sessionId}`,
      sourceSessionId: sessionId,
      displayName: sessionId,
      processAlive: true,
      processIds: [4242],
    }));
    const snapshot = buildSnapshot({
      agents: sources,
      surfaces: sources.map((source, index) => ({
        workspaceId: `WORKSPACE-SUCCESSION-${index}`,
        surfaceId: `SURFACE-SUCCESSION-${index}`,
        cwd: process.cwd(),
        sourceSessionIds: [source.sourceSessionId],
      })),
      runManifests: manifests,
      archiveStore,
      now: new Date("2026-08-05T12:01:30.000Z"),
    });
    const agents = snapshot.programs.flatMap((program) => program.agents);
    const first = agents.find((agent) => agent.id === "codex:cycle-1");
    const second = agents.find((agent) => agent.id === "codex:cycle-2");
    const current = agents.find((agent) => agent.id === "codex:cycle-3");

    expect(first).toMatchObject({
      lifecycle: "finished",
      provenance: "provider-exit",
      statusReason: "Replaced by a newer session for this lane.",
      endEvidence: "superseded",
      processState: "running",
      controlState: "observed-only",
      succeededBy: "codex:cycle-2",
    });
    expect(first?.controls.find(({ action }) => action === "instruct")?.enabled).toBe(false);
    expect(second).toMatchObject({
      lifecycle: "finished",
      endEvidence: "superseded",
      supersedes: "codex:cycle-1",
      succeededBy: "codex:cycle-3",
    });
    expect(current).toMatchObject({
      lifecycle: "working",
      endEvidence: undefined,
      supersedes: "codex:cycle-2",
      taskState: "active",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("manifest lineage outranks workspace env and transcript parentage, including run grouping", () => {
  const repo = resolveRepoIdentity(process.cwd());
  expect(repo).not.toBeNull();
  if (!repo) throw new Error("test checkout must be a git repository");
  const source = collected({ parentSourceSessionId: "transcript-parent" });

  const snapshot = buildSnapshot({
    agents: [source],
    surfaces: [{
      workspaceId: "WORKSPACE-B3-PRECEDENCE",
      surfaceId: "SURFACE-B3-PRECEDENCE",
      cwd: process.cwd(),
      sourceSessionIds: [source.sourceSessionId],
    }],
    workspaceEnvs: [{
      workspaceId: "WORKSPACE-B3-PRECEDENCE",
      variables: {
        ANTHILL_RUN: "env-run",
        ANTHILL_LANE: "env-lane",
        ANTHILL_ROLE: "tester",
        ANTHILL_PARENT: "claude:env-orchestrator",
      },
    }],
    runManifests: [manifest()],
    archiveStore,
    now: new Date("2026-08-05T12:01:30.000Z"),
  });
  const program = snapshot.programs[0];
  const agent = program?.agents[0];

  expect(agent?.parentAgentId).toBe("claude:manifest-orchestrator");
  expect(agent?.role).toBe("worker");
  expect(agent?.roleSource).toBe("declared");
  expect(agent?.identity).toMatchObject({
    name: "be-manifest-lane",
    source: "manifest",
    authoredBy: "manifest",
  });
  expect(agent?.programId).toBe("run:manifest-run");
  expect(program?.groupPath).toEqual([repo.repoKey, "run:manifest-run"]);
  expect(program?.id).toBe(`repo:${repo.repoKey}:run:manifest-run`);
});

test("workspace env supplies lineage when no manifest binds the session", () => {
  const repo = resolveRepoIdentity(process.cwd());
  expect(repo).not.toBeNull();
  if (!repo) throw new Error("test checkout must be a git repository");
  const source = collected({ parentSourceSessionId: "transcript-parent" });

  const snapshot = buildSnapshot({
    agents: [source],
    surfaces: [{
      workspaceId: "WORKSPACE-B3-ENV-ONLY",
      surfaceId: "SURFACE-B3-ENV-ONLY",
      cwd: process.cwd(),
      sourceSessionIds: [source.sourceSessionId],
    }],
    workspaceEnvs: [{
      workspaceId: "WORKSPACE-B3-ENV-ONLY",
      variables: {
        ANTHILL_RUN: "env-run",
        ANTHILL_LANE: "env-lane",
        ANTHILL_ROLE: "verifier",
        ANTHILL_PARENT: "claude:env-orchestrator",
      },
    }],
    runManifests: [],
    archiveStore,
    now: new Date("2026-08-05T12:01:30.000Z"),
  });
  const program = snapshot.programs[0];
  const agent = program?.agents[0];

  expect(agent?.parentAgentId).toBe("claude:env-orchestrator");
  expect(agent?.role).toBe("verifier");
  expect(agent?.identity).toMatchObject({ name: "env-lane", source: "manifest" });
  expect(agent?.programId).toBe("run:env-run");
  expect(program?.groupPath).toEqual([repo.repoKey, "run:env-run"]);
});

test("a declared lane groups under its target repository instead of its non-git cwd", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "anthill-declared-non-git-"));
  try {
    const targetRepo = resolveRepoIdentity(process.cwd());
    expect(targetRepo).not.toBeNull();
    if (!targetRepo) throw new Error("test checkout must be a git repository");
    const source = collected({ cwd, originCwd: cwd });
    const snapshot = buildSnapshot({
      agents: [source],
      surfaces: [{
        workspaceId: "WORKSPACE-B3-TARGET-REPO",
        surfaceId: "SURFACE-B3-TARGET-REPO",
        cwd,
        branch: "wrong/live-branch",
        dirty: true,
        head: "wrong-live-head",
        sourceSessionIds: [source.sourceSessionId],
      }],
      sidebarWorkspaces: [{
        workspaceId: "WORKSPACE-B3-TARGET-REPO",
        projectRootPath: cwd,
        branch: "wrong/sidebar-branch",
        dirty: true,
        pullRequestUrls: ["https://example.invalid/wrong-repo/pull/1"],
      }],
      runManifests: [manifest()],
      archiveStore,
      now: new Date("2026-08-05T12:01:30.000Z"),
    });
    const program = snapshot.programs[0];
    const agent = program?.agents[0];

    expect(agent?.programId).toBe("run:manifest-run");
    expect(agent?.repo).toEqual(targetRepo);
    expect(program?.id).toBe(`repo:${targetRepo.repoKey}:run:manifest-run`);
    expect(program?.groupPath).toEqual([targetRepo.repoKey, "run:manifest-run"]);
    expect(agent?.git?.branch).toBe(targetRepo.branch);
    expect(agent?.git?.dirty).toBeUndefined();
    expect(agent?.git?.head).toBeUndefined();
    expect(agent?.pullRequestUrls).toBeUndefined();
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("CWD-GROUP-1 an unresolved declared path falls through to the sidebar repository", async () => {
  const missingDeclaredRoot = await mkdtemp(join(tmpdir(), "anthill-missing-declared-repo-"));
  try {
    const source = collected({ cwd: missingDeclaredRoot, originCwd: missingDeclaredRoot });
    const declared = { ...manifest(), repoRoot: join(missingDeclaredRoot, "gone") };
    const sidebarRepo = resolveRepoIdentity(process.cwd());
    expect(sidebarRepo).not.toBeNull();
    if (!sidebarRepo) throw new Error("test checkout must be a git repository");
    const snapshot = buildSnapshot({
      agents: [source],
      surfaces: [{
        workspaceId: "WORKSPACE-CWD-FALLTHROUGH",
        surfaceId: "SURFACE-CWD-FALLTHROUGH",
        cwd: missingDeclaredRoot,
        sourceSessionIds: [source.sourceSessionId],
      }],
      sidebarWorkspaces: [{
        workspaceId: "WORKSPACE-CWD-FALLTHROUGH",
        projectRootPath: process.cwd(),
        branch: "sidebar/observed",
        dirty: false,
        pullRequestUrls: [],
      }],
      runManifests: [declared],
      archiveStore,
      now: new Date("2026-08-05T12:01:30.000Z"),
    });
    const published = snapshot.programs[0]?.agents[0];

    expect(published?.repo).toMatchObject({
      repoKey: sidebarRepo.repoKey,
      worktreePath: sidebarRepo.worktreePath,
      branch: "sidebar/observed",
    });
    expect(published?.programId).toBe("run:manifest-run");
  } finally {
    await rm(missingDeclaredRoot, { recursive: true, force: true });
  }
});


test("an operator program hint still outranks declared run grouping", () => {
  const source = collected();
  const snapshot = buildSnapshot({
    agents: [source],
    surfaces: [],
    runManifests: [manifest()],
    programHints: [{ id: "operator-program", name: "Operator program", match: [process.cwd()] }],
    archiveStore,
    now: new Date("2026-08-05T12:01:30.000Z"),
  });
  const program = snapshot.programs[0];
  const agent = program?.agents[0];

  expect(program?.id).toBe("operator-program");
  expect(program?.groupPath).toBeUndefined();
  expect(agent?.programId).toBe("operator-program");
});

test("the cmux refresh tick supplies manifests and workspace env to the snapshot once", async () => {
  const source = collected({ parentSourceSessionId: "transcript-parent" });
  let manifestCalls = 0;
  let envCalls = 0;
  const collectors: HubCollectors = {
    sessions: async () => ({
      omp: { value: [], errors: [] },
      codex: { value: [source], errors: [] },
      claude: { value: [], errors: [] },
      cursor: { value: [], errors: [] },
      factory: { value: [], errors: [] },
      prime: { value: [], errors: [] },
      grok: { value: [], errors: [] },
      hermes: { value: [], errors: [] },
      muse: { value: [], errors: [] },
      antigravity: { value: [], errors: [] },
      copilot: { value: [], errors: [] },
      gemini: { value: [], errors: [] },
    }),
    cmux: async () => ({
      value: [{
        workspaceId: "WORKSPACE-B3-STATE",
        surfaceId: "SURFACE-B3-STATE",
        cwd: process.cwd(),
        sourceSessionIds: [source.sourceSessionId],
      }],
      errors: [],
    }),
    workspaceEnv: async (_runner, workspaceIds) => {
      envCalls += 1;
      expect(workspaceIds).toEqual(["WORKSPACE-B3-STATE"]);
      return {
        value: [{
          workspaceId: "WORKSPACE-B3-STATE",
          variables: {
            ANTHILL_RUN: "env-run",
            ANTHILL_LANE: "env-lane",
            ANTHILL_ROLE: "tester",
            ANTHILL_PARENT: "claude:env-orchestrator",
          },
        }],
        errors: [],
      };
    },
    manifests: () => {
      manifestCalls += 1;
      return [manifest()];
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

  expect(manifestCalls).toBe(1);
  expect(envCalls).toBe(1);
  expect(agent?.parentAgentId).toBe("claude:manifest-orchestrator");
  expect(agent?.identity).toMatchObject({ name: "be-manifest-lane", source: "manifest" });
  expect(agent?.programId).toBe("run:manifest-run");

  await state.refresh();
  expect(manifestCalls).toBe(1);
  expect(envCalls).toBe(1);
});
