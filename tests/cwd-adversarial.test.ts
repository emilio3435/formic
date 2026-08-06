import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonArchiveStore, MemoryArchiveStore, type ArchiveFileOperations } from "../src/server/archive";
import { createMountainFetch, type MountainAppState } from "../src/server/app";
import { readHookSessionStores } from "../src/server/cmux-hook-sessions";
import { collectSessions } from "../src/server/collectors";
import { buildSnapshot } from "../src/server/snapshot";
import { programFor, type ProgramHint } from "../src/server/snapshot-programs";
import {
  canAddressTarget,
  canWriteToTarget,
  resolveAgentTarget,
  resolveAgentTargetWithTrace,
  transmitRefusal,
} from "../src/server/targets";
import type { CmuxTarget, HubSnapshot } from "../src/shared/types";
import type {
  ArchiveStore,
  CmuxSurface,
  CollectedAgent,
  CommandResult,
  CommandRunner,
  CmuxWorkspaceSnapshot,
} from "../src/server/types";
import type { RunManifest } from "../src/server/run-manifests";

const NOW = new Date("2026-08-06T16:00:00.000Z");
const OK: CommandResult = { exitCode: 0, stdout: "", stderr: "", timedOut: false };
const noArchive: ArchiveStore = { has: () => false, archive: async () => {} };

let scratch = "";
let hookRoot = "";
let missingHookRoot = "";
let home = "";
let currentDir = "";
let launchDir = "";
let terminalDir = "";
let rememberedDir = "";
let missingDir = "";
let repos: Record<"declared" | "sidebar" | "current" | "launch" | "surface" | "cooper" | "inverse" | "folder", string>;

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString() || `git ${args.join(" ")} failed`);
}

async function fakeRepo(name: string): Promise<string> {
  const cwd = join(scratch, "repos", name);
  await mkdir(cwd, { recursive: true });
  git(cwd, "init", "--initial-branch=main");
  await writeFile(join(cwd, "README.md"), `${name}\n`, "utf8");
  git(cwd, "add", "README.md");
  git(cwd, "-c", "user.name=Ant Hill Test", "-c", "user.email=anthill@example.invalid", "commit", "-m", "fixture");
  return realpath(cwd);
}

function fakeAgent(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: "claude:fixture",
    provider: "claude",
    sourceSessionId: "fixture",
    displayName: "Fixture",
    status: "running",
    statusReason: "Fixture activity is recent.",
    startedAt: "2026-08-06T15:00:00.000Z",
    updatedAt: "2026-08-06T15:59:30.000Z",
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    ...overrides,
  };
}

function fakeSurface(overrides: Partial<CmuxSurface> = {}): CmuxSurface {
  return {
    workspaceId: "WORKSPACE-FIXTURE",
    surfaceId: "SURFACE-FIXTURE",
    paneId: "PANE-FIXTURE",
    runtimeSurfaceReady: true,
    sourceSessionIds: [],
    ...overrides,
  };
}

function hookStoreRecords(): Record<string, unknown> {
  return {
    pictured: {
      sessionId: "pictured",
      surfaceId: "SURFACE-PICTURED-HOOK",
      workspaceId: "WORKSPACE-PICTURED",
      cwd: terminalDir,
      pid: 4101,
      agentLifecycle: "running",
      updatedAt: NOW.getTime() / 1_000,
    },
  };
}

async function writeHookStores(): Promise<void> {
  await mkdir(hookRoot, { recursive: true });
  await writeFile(join(hookRoot, "claude-hook-sessions.json"), JSON.stringify({
    version: 1,
    sessions: hookStoreRecords(),
  }), "utf8");
  await writeFile(join(hookRoot, "codex-hook-sessions.json"), JSON.stringify({
    version: 1,
    sessions: {
      secret: {
        sessionId: "11111111-2222-4333-8444-555555555555",
        surfaceId: "SURFACE-SECRET",
        workspaceId: "WORKSPACE-SECRET",
        cwd: terminalDir,
        pid: 4102,
        agentLifecycle: "running",
        launchCommand: {
          executablePath: "SENTINEL_EXECUTABLE_MUST_NOT_PUBLISH",
          arguments: ["SENTINEL_ARGUMENT_MUST_NOT_PUBLISH", "--api-key=SENTINEL_SECRET"],
          workingDirectory: launchDir,
          environment: { PRIVATE_TOKEN: "SENTINEL_ENV_MUST_NOT_PUBLISH" },
        },
        updatedAt: NOW.getTime() / 1_000,
      },
    },
  }), "utf8");
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "anthill-cwd-adversarial-"));
  hookRoot = join(scratch, "hooks");
  missingHookRoot = join(scratch, "no-hooks");
  home = join(scratch, "home");
  currentDir = join(scratch, "current-tool-dir");
  launchDir = join(scratch, "launch-dir");
  terminalDir = join(scratch, "terminal-shell-dir");
  rememberedDir = join(scratch, "remembered-dir");
  missingDir = join(scratch, "missing-dir");
  await Promise.all([home, currentDir, launchDir, terminalDir, rememberedDir].map((path) => mkdir(path, { recursive: true })));
  repos = {
    declared: await fakeRepo("declared-repo"),
    sidebar: await fakeRepo("sidebar-repo"),
    current: await fakeRepo("current-repo"),
    launch: await fakeRepo("launch-repo"),
    surface: await fakeRepo("surface-repo"),
    cooper: await fakeRepo("cooper-scheduler"),
    inverse: await fakeRepo("inverse-project"),
    folder: await fakeRepo("folder-project"),
  };
  await writeHookStores();

  const sessions = join(home, ".codex", "sessions");
  await mkdir(sessions, { recursive: true });
  await mkdir(join(home, ".cmuxterm"), { recursive: true });
  await writeFile(join(sessions, "secret.jsonl"), `${JSON.stringify({
    type: "session_meta",
    timestamp: new Date().toISOString(),
    payload: { id: "11111111-2222-4333-8444-555555555555", cwd: currentDir },
  })}\n`, "utf8");
  await writeFile(join(home, ".cmuxterm", "codex-hook-sessions.json"), await Bun.file(join(hookRoot, "codex-hook-sessions.json")).text(), "utf8");
});

beforeEach(() => {
  readHookSessionStores(hookRoot);
});

afterAll(async () => {
  readHookSessionStores(missingHookRoot);
  await rm(scratch, { recursive: true, force: true });
});

function routingSurfaces(): CmuxSurface[] {
  return [
    fakeSurface({
      workspaceId: "WORKSPACE-PICTURED",
      surfaceId: "SURFACE-PICTURED-HOOK",
      paneId: "PANE-PICTURED",
      cwd: terminalDir,
      workspaceTitle: "Cooper shell",
    }),
    fakeSurface({ surfaceId: "SURFACE-RECORDED", cwd: rememberedDir }),
    fakeSurface({ surfaceId: "SURFACE-SESSION", cwd: repos.inverse, sourceSessionIds: ["pictured"] }),
    fakeSurface({ surfaceId: "SURFACE-CWD", cwd: `${repos.cooper}/` }),
  ];
}

function pictured(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return fakeAgent({
    id: "claude:pictured",
    sourceSessionId: "pictured",
    displayName: "Pictured Claude",
    cwd: repos.cooper,
    launchCwd: home,
    recordedTarget: { surfaceId: "SURFACE-RECORDED", source: "binding" },
    ...overrides,
  });
}

describe("hostile synthetic cmux routing", () => {
  test("ADV-CWD-ROUTE-1 preserves hook, recorded ID, live session ID, then cwd precedence", () => {
    const surfaces = routingSurfaces();
    const byHook = resolveAgentTargetWithTrace(pictured(), [...surfaces].reverse());
    expect(byHook.trace.matchedTier).toBe("hook-store");
    expect(byHook.target).toMatchObject({
      surfaceId: "SURFACE-PICTURED-HOOK",
      resolution: "exact",
      attestation: "hook-store",
      cwdRelation: "different",
    });
    expect(byHook.target.reason).toBe("Matched source session to a live surface via the cmux hook-session store.");

    readHookSessionStores(missingHookRoot);
    const byRecorded = resolveAgentTargetWithTrace(pictured(), [...surfaces].reverse());
    expect(byRecorded.trace.matchedTier).toBe("recorded");
    expect(byRecorded.target).toMatchObject({ surfaceId: "SURFACE-RECORDED", attestation: "remembered" });

    const bySession = resolveAgentTargetWithTrace(pictured({ recordedTarget: undefined }), [...surfaces].reverse());
    expect(bySession.trace.matchedTier).toBe("session");
    expect(bySession.target).toMatchObject({ surfaceId: "SURFACE-SESSION", attestation: "live" });

    const cwdOnly = pictured({ sourceSessionId: "cwd-only", recordedTarget: undefined });
    const byCwd = resolveAgentTargetWithTrace(cwdOnly, [...surfaces].reverse(), [cwdOnly]);
    expect(byCwd.trace.matchedTier).toBe("cwd");
    expect(byCwd.target).toMatchObject({ surfaceId: "SURFACE-CWD", resolution: "unique-cwd" });
  });

  test("ADV-CWD-ROUTE-2 directory changes never change exact IDs, attestation, or write authority", () => {
    const surfaces = routingSurfaces();
    const variants = [repos.cooper, `${repos.cooper}/`, home, undefined].map((cwd) =>
      resolveAgentTarget(pictured({ cwd }), [...surfaces].reverse()));

    for (const target of variants) {
      expect(target.surfaceId).toBe("SURFACE-PICTURED-HOOK");
      expect(target.resolution).toBe("exact");
      expect(target.attestation).toBe("hook-store");
      expect(canWriteToTarget(target)).toBeTrue();
    }
    expect(variants.map(({ cwdRelation }) => cwdRelation)).toEqual(["different", "different", "different", undefined]);
  });

  test("ADV-CWD-QUAR-1 conflicting identity fails closed at every exact tier and under duplicate surface IDs", () => {
    const hookConflict = resolveAgentTarget(pictured(), [
      fakeSurface({ surfaceId: "SURFACE-PICTURED-HOOK", identityConflict: "hook occupant disagrees" }),
    ]);
    expect(hookConflict).toMatchObject({ resolution: "ambiguous" });
    expect(hookConflict.surfaceId).toBeUndefined();
    expect(canWriteToTarget(hookConflict)).toBeFalse();

    const duplicate = resolveAgentTarget(pictured(), [
      fakeSurface({ surfaceId: "SURFACE-PICTURED-HOOK" }),
      fakeSurface({ surfaceId: "SURFACE-PICTURED-HOOK", paneId: "PANE-DUPLICATE" }),
    ]);
    expect(duplicate).toMatchObject({ resolution: "ambiguous" });
    expect(duplicate.surfaceId).toBeUndefined();

    readHookSessionStores(missingHookRoot);
    const recordedConflict = resolveAgentTarget(pictured(), [
      fakeSurface({ surfaceId: "SURFACE-RECORDED", identityConflict: "recorded occupant disagrees" }),
    ]);
    const sessionConflict = resolveAgentTarget(pictured({ recordedTarget: undefined }), [
      fakeSurface({ surfaceId: "SURFACE-SESSION", sourceSessionIds: ["pictured"], identityConflict: "session occupant disagrees" }),
    ]);
    for (const target of [recordedConflict, sessionConflict]) {
      expect(target.resolution).toBe("ambiguous");
      expect(target.surfaceId).toBeUndefined();
      expect(canAddressTarget(target)).toBeFalse();
      expect(canWriteToTarget(target)).toBeFalse();
    }
  });

  test("ADV-CWD-WRITE-1 address and write capabilities remain distinct for every routing tier", () => {
    const cases: Array<[CmuxTarget, boolean, boolean]> = [
      [{ surfaceId: "HOOK", resolution: "exact", attestation: "hook-store" }, true, true],
      [{ surfaceId: "LIVE", resolution: "exact", attestation: "live" }, true, true],
      [{ surfaceId: "MEMORY", resolution: "exact", attestation: "remembered" }, true, false],
      [{ surfaceId: "FOLDER", resolution: "unique-cwd" }, true, false],
      [{ resolution: "ambiguous" }, false, false],
      [{ resolution: "missing" }, false, false],
    ];
    for (const [target, addressable, writable] of cases) {
      expect(canAddressTarget(target)).toBe(addressable);
      expect(canWriteToTarget(target)).toBe(writable);
    }
  });

  test("ADV-CWD-LIVE-1 archive and confirmed death refuse while running, unknown, and turn-exited stay writable", () => {
    const target: CmuxTarget = { surfaceId: "LIVE", resolution: "exact", attestation: "live" };
    expect(transmitRefusal({ target, processState: "running" })).toBeNull();
    expect(transmitRefusal({ target, processState: "unknown" })).toBeNull();
    expect(transmitRefusal({ target, processState: "exited" })).toBeNull();
    expect(transmitRefusal({ target, processState: "died" })?.code).toBe("AGENT_NOT_RUNNING");
    expect(transmitRefusal({ target, archived: true })?.code).toBe("AGENT_ARCHIVED");
    expect(transmitRefusal({ target: { surfaceId: "MEMORY", resolution: "exact", attestation: "remembered" } })?.code)
      .toBe("UNSAFE_TARGET");
  });
});

function hints(): ProgramHint[] {
  return [
    { id: "cooper", name: "Cooper", match: [repos.cooper] },
    { id: "inverse", name: "Inverse", match: [repos.inverse] },
    { id: "folder", name: "Folder project", match: [repos.folder] },
    { id: "home-tools", name: "Home tools", match: [home] },
  ];
}

function fleetSnapshot(): HubSnapshot {
  const agents = [
    pictured(),
    fakeAgent({ id: "codex:inverse", provider: "codex", sourceSessionId: "inverse", cwd: home, launchCwd: repos.inverse }),
    fakeAgent({
      id: "cursor:remembered",
      provider: "cursor",
      sourceSessionId: "remembered",
      cwd: rememberedDir,
      recordedTarget: { surfaceId: "SURFACE-REMEMBERED", source: "binding" },
    }),
    fakeAgent({ id: "factory:folder", provider: "factory", sourceSessionId: "folder", cwd: repos.folder }),
    fakeAgent({ id: "omp:conflict", provider: "omp", sourceSessionId: "conflict", cwd: join(scratch, "conflict") }),
    fakeAgent({ id: "claude:missing", sourceSessionId: "missing", cwd: missingDir }),
  ];
  const surfaces = [
    ...routingSurfaces().slice(0, 1),
    fakeSurface({ surfaceId: "SURFACE-INVERSE", cwd: repos.inverse, sourceSessionIds: ["inverse"] }),
    fakeSurface({ surfaceId: "SURFACE-REMEMBERED", cwd: rememberedDir }),
    fakeSurface({ surfaceId: "SURFACE-FOLDER", cwd: `${repos.folder}/` }),
    fakeSurface({ surfaceId: "SURFACE-CONFLICT", sourceSessionIds: ["conflict"], identityConflict: "two live identities claim this pane" }),
  ];
  return buildSnapshot({ agents, surfaces: [...surfaces].reverse(), programHints: hints(), archiveStore: noArchive, now: NOW });
}

function snapshotAgent(snapshot: HubSnapshot, id: string) {
  return snapshot.programs.flatMap(({ agents }) => agents).find((agent) => agent.id === id);
}

describe("repository-led grouping and the complete fake fleet", () => {
  test("ADV-CWD-REPO-1 repository candidates resolve in declared, sidebar, current, launch, then eligible surface order", async () => {
    const one = (agent: CollectedAgent, options: {
      surface?: CmuxSurface;
      sidebar?: CmuxWorkspaceSnapshot;
      manifest?: RunManifest;
    } = {}) => buildSnapshot({
      agents: [agent],
      surfaces: options.surface ? [options.surface] : [],
      sidebarWorkspaces: options.sidebar ? [options.sidebar] : [],
      runManifests: options.manifest ? [options.manifest] : [],
      archiveStore: noArchive,
      now: NOW,
    });
    const repoOf = (snapshot: HubSnapshot) => snapshot.programs[0]?.agents[0]?.repo?.worktreePath;

    const declaredAgent = fakeAgent({ id: "claude:declared", sourceSessionId: "declared", cwd: repos.current });
    const manifest: RunManifest = {
      runId: "declared-run",
      createdAt: NOW.toISOString(),
      repoRoot: repos.declared,
      orchestrator: { provider: "claude", sessionId: "declared" },
      lanes: [],
    };
    expect(repoOf(one(declaredAgent, { manifest }))).toBe(repos.declared);

    const sidebarAgent = fakeAgent({ id: "claude:sidebar", sourceSessionId: "sidebar", cwd: repos.current });
    const sidebarSurface = fakeSurface({ workspaceId: "WORKSPACE-SIDEBAR", sourceSessionIds: ["sidebar"], cwd: repos.surface });
    expect(repoOf(one(sidebarAgent, {
      surface: sidebarSurface,
      sidebar: { workspaceId: "WORKSPACE-SIDEBAR", projectRootPath: repos.sidebar, pullRequestUrls: [] },
    }))).toBe(repos.sidebar);

    expect(repoOf(one(fakeAgent({ id: "claude:current", sourceSessionId: "current", cwd: repos.current })))).toBe(repos.current);

    const launchAgent = fakeAgent({ id: "claude:launch", sourceSessionId: "launch", cwd: missingDir, launchCwd: repos.launch });
    expect(repoOf(one(launchAgent, {
      surface: fakeSurface({ sourceSessionIds: ["launch"], cwd: repos.surface }),
    }))).toBe(repos.launch);

    const surfaceAgent = fakeAgent({ id: "claude:surface", sourceSessionId: "surface", cwd: undefined });
    expect(repoOf(one(surfaceAgent, {
      surface: fakeSurface({ sourceSessionIds: ["surface"], cwd: repos.surface }),
    }))).toBe(repos.surface);

    const different = fakeAgent({
      id: "claude:different",
      sourceSessionId: "different",
      cwd: repos.current,
      launchCwd: repos.launch,
    });
    expect(repoOf(one(different, {
      surface: fakeSurface({ sourceSessionIds: ["different"], cwd: repos.surface }),
    }))).toBe(repos.current);

    const suppressedSurface = fakeAgent({
      id: "claude:suppressed-surface",
      sourceSessionId: "suppressed-surface",
      cwd: missingDir,
    });
    expect(repoOf(one(suppressedSurface, {
      surface: fakeSurface({ sourceSessionIds: ["suppressed-surface"], cwd: repos.surface }),
    }))).toBeUndefined();

    expect(await realpath(repos.current)).toBe(repos.current);
  });

  test("ADV-CWD-PROGRAM-1 explicit identity and operator hints win, otherwise repository evidence precedes raw cwd", () => {
    const source = fakeAgent({ id: "claude:program", sourceSessionId: "program", cwd: home });
    const repo = {
      repoKey: "cooper-key",
      repoName: "cooper-scheduler",
      worktreePath: repos.cooper,
      ephemeral: false,
    };
    expect(programFor(source, [
      { id: "agent-id", name: "Explicit agent", match: [source.id] },
      { id: "cooper", name: "Cooper", match: [repos.cooper] },
      { id: "home", name: "Home", match: [home] },
    ], undefined, false, repo).id).toBe("agent-id");
    expect(programFor(source, [
      { id: "cooper", name: "Cooper", match: [repos.cooper] },
      { id: "home", name: "Home", match: [home] },
    ], undefined, false, repo).id).toBe("cooper");
    expect(programFor(source, [{ id: "home", name: "Home", match: [home] }]).id).toBe("home");
  });

  test("ADV-CWD-GROUP-1 pictured and inverse directory shapes keep exact controls and repository-owned groups", () => {
    const snapshot = fleetSnapshot();
    const picturedAgent = snapshotAgent(snapshot, "claude:pictured");
    const inverseAgent = snapshotAgent(snapshot, "codex:inverse");
    const remembered = snapshotAgent(snapshot, "cursor:remembered");
    const folder = snapshotAgent(snapshot, "factory:folder");
    const conflict = snapshotAgent(snapshot, "omp:conflict");
    const missing = snapshotAgent(snapshot, "claude:missing");

    expect(picturedAgent).toMatchObject({ programId: "cooper", cwd: repos.cooper, launchCwd: home });
    expect(picturedAgent?.target).toMatchObject({ resolution: "exact", attestation: "hook-store", cwdRelation: "different" });
    expect(inverseAgent).toMatchObject({ programId: "inverse", cwd: home, launchCwd: repos.inverse });
    expect(inverseAgent?.target).toMatchObject({ resolution: "exact", attestation: "live", cwdRelation: "different" });
    expect(remembered?.target).toMatchObject({ resolution: "exact", attestation: "remembered" });
    expect(remembered?.controls.find(({ action }) => action === "instruct")?.enabled).toBeFalse();
    expect(folder?.target.resolution).toBe("unique-cwd");
    expect(folder?.controls.find(({ action }) => action === "focus")?.enabled).toBeTrue();
    expect(folder?.controls.find(({ action }) => action === "instruct")?.enabled).toBeFalse();
    expect(conflict?.target).toMatchObject({ resolution: "ambiguous" });
    expect(conflict?.target.surfaceId).toBeUndefined();
    expect(missing?.target).toMatchObject({ resolution: "missing" });
  });
});

class ArmedRecordingRunner implements CommandRunner {
  readonly commands: string[][] = [];
  async run(command: readonly string[]): Promise<CommandResult> {
    if (command[0] !== "fake-cmux" || command[1] !== "rpc") {
      throw new Error(`unarmed command: ${command.join(" ")}`);
    }
    this.commands.push([...command]);
    return OK;
  }
}

describe("collector to archive, snapshot, API, and control boundary", () => {
  test("ADV-CWD-PROV-1 transcript current cwd wins and hook cwd is fallback only", async () => {
    const collected = (await collectSessions(home, undefined, undefined, { hookProcessStarts: () => new Map() })).codex.value[0];
    expect(collected).toMatchObject({ cwd: currentDir, launchCwd: launchDir });

    await rm(join(home, ".codex", "sessions", "secret.jsonl"));
    await writeFile(join(home, ".codex", "sessions", "secret.jsonl"), `${JSON.stringify({
      type: "session_meta",
      timestamp: new Date().toISOString(),
      payload: { id: "11111111-2222-4333-8444-555555555555" },
    })}\n`, "utf8");
    const fallback = (await collectSessions(home, undefined, undefined, { hookProcessStarts: () => new Map() })).codex.value[0];
    expect(fallback?.cwd).toBe(terminalDir);
    expect(fallback?.launchCwd).toBe(launchDir);
  });

  test("ADV-CWD-PROV-2 and ADV-CWD-SECRET-1 publish only launch workingDirectory through every server boundary", async () => {
    const collected = (await collectSessions(home, undefined, undefined, { hookProcessStarts: () => new Map() })).codex.value[0];
    expect(collected?.launchCwd).toBe(launchDir);
    const collectedJson = JSON.stringify(collected);
    expect(collectedJson).not.toContain("SENTINEL_");
    expect(collectedJson).not.toContain("launchCommand");

    const archive = new MemoryArchiveStore();
    await archive.record([collected!]);
    const archivedJson = JSON.stringify(archive.archivedAgents());
    expect(archivedJson).toContain(launchDir);
    expect(archivedJson).not.toContain("SENTINEL_");
    expect(archivedJson).not.toContain("launchCommand");

    const snapshot = buildSnapshot({
      agents: [collected!],
      surfaces: [fakeSurface({ surfaceId: "SURFACE-SECRET", cwd: terminalDir, sourceSessionIds: [] })],
      archiveStore: noArchive,
      now: new Date(),
    });
    expect(snapshotAgent(snapshot, collected!.id)?.launchCwd).toBe(launchDir);
    const state: MountainAppState = {
      get: () => snapshot,
      subscribe: () => () => {},
      refresh: async () => snapshot,
    };
    const fetch = createMountainFetch({ state, runner: new ArmedRecordingRunner(), archiveStore: noArchive, webRoot: import.meta.dir });
    try {
      const response = await fetch(new Request("http://127.0.0.1:4710/api/snapshot"));
      const apiJson = JSON.stringify(await response.json());
      expect(apiJson).toContain(launchDir);
      expect(apiJson).not.toContain("SENTINEL_");
      expect(apiJson).not.toContain("launchCommand");
    } finally {
      fetch.dispose();
    }
  });

  test("ADV-CWD-API-1 unsafe POSTs execute nothing while a live exact hook target reaches only the fake runner", async () => {
    const snapshot = fleetSnapshot();
    snapshot.generatedAt = new Date().toISOString();
    const exactAgent = snapshotAgent(snapshot, "claude:pictured");
    expect(exactAgent?.target).toMatchObject({
      surfaceId: "SURFACE-PICTURED-HOOK",
      resolution: "exact",
      attestation: "hook-store",
    });
    expect(exactAgent?.processState).not.toBe("died");
    expect(exactAgent?.controls.find(({ action }) => action === "instruct")?.enabled).toBeTrue();
    const state: MountainAppState = {
      get: () => snapshot,
      subscribe: () => () => {},
      refresh: async () => snapshot,
    };
    const runner = new ArmedRecordingRunner();
    const fetch = createMountainFetch({
      state,
      runner,
      archiveStore: noArchive,
      cmuxExecutable: "fake-cmux",
      now: () => NOW.getTime(),
      webRoot: import.meta.dir,
    });
    const control = (agentId: string, instruction: string) => fetch(new Request("http://127.0.0.1:4710/api/control", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:4710", "content-type": "application/json" },
      body: JSON.stringify({ action: "instruct", agentId, instruction }),
    }));
    try {
      for (const id of ["cursor:remembered", "factory:folder", "omp:conflict", "claude:missing"]) {
        const response = await control(id, `MUST-NOT-RUN-${id}`);
        expect(response.status).toBe(409);
      }
      expect(runner.commands).toEqual([]);

      const exact = await control("claude:pictured", "Synthetic safe command.");
      expect(exact.status).toBe(200);
      expect(runner.commands).toHaveLength(2);
      expect(runner.commands.every((command) => command[0] === "fake-cmux")).toBeTrue();
      expect(runner.commands.join(" ")).toContain("SURFACE-PICTURED-HOOK");
      expect(runner.commands.join(" ")).not.toContain("MUST-NOT-RUN");
    } finally {
      fetch.dispose();
    }
  });

  test("ADV-CWD-WIRE-1 old archive records remain readable with launch cwd absent", async () => {
    const old = fakeAgent({
      id: "claude:legacy",
      sourceSessionId: "legacy",
      status: "archived",
      statusReason: "Retained session history.",
      updatedAt: NOW.toISOString(),
    }) as CollectedAgent & { archiveKind: "history"; cwdMismatch: boolean };
    old.archiveKind = "history";
    old.cwdMismatch = true;
    const contents = new Map([["/virtual/archive.json", JSON.stringify([old])]]);
    const files: ArchiveFileOperations = {
      readText: async (path) => {
        const value = contents.get(path);
        if (value === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
        return value;
      },
      makeDirectory: async () => {},
      writeText: async (path, value) => { contents.set(path, value); },
      rename: async (from, to) => { contents.set(to, contents.get(from) ?? "[]"); },
    };
    const store = await JsonArchiveStore.open("/virtual/archive.json", files, () => NOW.getTime());
    expect(store.loadError()).toBeUndefined();
    expect(store.archivedAgents()[0]).toMatchObject({ id: "claude:legacy" });
    expect(store.archivedAgents()[0]?.launchCwd).toBeUndefined();
  });
});
