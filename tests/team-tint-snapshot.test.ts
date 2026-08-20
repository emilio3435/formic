import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { createMountainFetch, emptySnapshot } from "../src/server/app";
import { MemoryArchiveStore } from "../src/server/archive";
import { collectCmuxGroups, type CmuxWindowGroups } from "../src/server/cmux";
import { reconcileWorkspaceColors } from "../src/server/cmux-color-sync";
import { JsonRepoGroupProvenanceStore, MemoryRepoGroupProvenanceStore } from "../src/server/cmux-groups";
import { HubState, type HubCollectors } from "../src/server/state";
import {
  handleTeamColorsRequest,
  JsonTeamColorsStore,
} from "../src/server/team-colors";
import { memorySettingsFiles } from "../src/server/settings";
import type { CollectionResult, CommandRunner, CmuxSurface, CollectedAgent } from "../src/server/types";
import { normalizeHex } from "../src/shared/repo-color";
import {
  attachTeams,
  buildOperatorTeams,
  indexTeamsByWorkspace,
  isOperatorTeam,
  type CmuxTeam,
  type TeamTintSettings,
} from "../src/shared/team-tint";

function agent(id: string, workspaceId: string, repoName = "the-ant-hill"): {
  id: string;
  repo: { repoName: string };
  target: { workspaceId: string; resolution: "exact" };
  team?: { id: string; name: string; hex: string; windowId: string };
} {
  return {
    id,
    repo: { repoName },
    target: { workspaceId, resolution: "exact" as const },
  };
}

test("two agents same repo different teams get different hexes", () => {
  const teams: CmuxTeam[] = [
    { id: "g1", name: "ANT · probe", hex: "#5f7f2a", windowId: "w", memberWorkspaceIds: ["ws-a"] },
    { id: "g2", name: "ROWS-0816", hex: "#2e66a8", windowId: "w", memberWorkspaceIds: ["ws-b"] },
  ];
  const out = attachTeams(
    [agent("a", "ws-a"), agent("b", "ws-b")],
    teams,
    new Set(),
    { assignments: {} },
  );
  expect(out[0]?.team?.hex).toBe("#5f7f2a");
  expect(out[1]?.team?.hex).toBe("#2e66a8");
  expect(out[0]?.team?.hex).not.toBe(out[1]?.team?.hex);
});

test("ungrouped agent has no team", () => {
  const out = attachTeams(
    [agent("c", "ws-ungrouped")],
    [],
    new Set(),
    { assignments: {} },
  );
  expect(out[0]?.team).toBeUndefined();
});

test("workspace in a provenance folder is not published as a team", () => {
  expect(isOperatorTeam("the-ant-hill", "prov", new Set(["prov"]))).toBe(false);
  const teams: CmuxTeam[] = []; // collector already filtered
  const out = attachTeams(
    [agent("d", "ws-d")],
    teams,
    new Set(["prov"]),
    { assignments: {} },
  );
  expect(out[0]?.team).toBeUndefined();
});

function groupPayload(groups: readonly Record<string, unknown>[]): string {
  return JSON.stringify({ result: { groups } });
}

test("collectCmuxGroups returns operator groups from every healthy window", async () => {
  const runner: CommandRunner = {
    run: async (command) => {
      const method = command[2];
      const params = command[3];
      if (method === "window.list") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ windows: [{ id: "WINDOW-A" }, { id: "WINDOW-B" }] }),
          stderr: "",
          timedOut: false,
        };
      }
      if (method === "workspace.group.list" && params === JSON.stringify({ window_id: "WINDOW-A" })) {
        return {
          exitCode: 0,
          stdout: groupPayload([{
            id: "g1",
            name: "ANT · probe",
            custom_color: "#5F7F2A",
            member_workspace_ids: ["ws-a"],
          }]),
          stderr: "",
          timedOut: false,
        };
      }
      if (method === "workspace.group.list" && params === JSON.stringify({ window_id: "WINDOW-B" })) {
        return {
          exitCode: 0,
          stdout: groupPayload([{
            id: "g2",
            name: "ROWS-0816",
            custom_color: "#2E66A8",
            member_workspace_ids: ["ws-b"],
          }]),
          stderr: "",
          timedOut: false,
        };
      }
      return { exitCode: 1, stdout: "", stderr: `unexpected ${method} ${params}`, timedOut: false };
    },
  };

  const result = await collectCmuxGroups(runner, "cmux");
  expect(result.errors).toEqual([]);
  expect(result.value).toEqual([
    {
      windowId: "WINDOW-A",
      groups: [{
        id: "g1",
        name: "ANT · probe",
        customColor: "#5F7F2A",
        memberWorkspaceIds: ["ws-a"],
      }],
    },
    {
      windowId: "WINDOW-B",
      groups: [{
        id: "g2",
        name: "ROWS-0816",
        customColor: "#2E66A8",
        memberWorkspaceIds: ["ws-b"],
      }],
    },
  ]);
});

test("collectCmuxGroups keeps a healthy window when another window fails", async () => {
  const runner: CommandRunner = {
    run: async (command) => {
      const method = command[2];
      const params = command[3];
      if (method === "window.list") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ windows: [{ id: "WINDOW-A" }, { id: "WINDOW-B" }] }),
          stderr: "",
          timedOut: false,
        };
      }
      if (method === "workspace.group.list" && params === JSON.stringify({ window_id: "WINDOW-A" })) {
        return { exitCode: 1, stdout: "", stderr: "group service down", timedOut: false };
      }
      if (method === "workspace.group.list" && params === JSON.stringify({ window_id: "WINDOW-B" })) {
        return {
          exitCode: 0,
          stdout: groupPayload([{
            id: "g2",
            name: "ROWS-0816",
            member_workspace_ids: ["ws-b"],
          }]),
          stderr: "",
          timedOut: false,
        };
      }
      return { exitCode: 1, stdout: "", stderr: `unexpected ${method} ${params}`, timedOut: false };
    },
  };

  const result = await collectCmuxGroups(runner, "cmux");
  expect(result.value.map((window) => window.windowId)).toEqual(["WINDOW-B"]);
  expect(result.value[0]?.groups[0]?.name).toBe("ROWS-0816");
  expect(result.errors.join(" ")).toContain("WINDOW-A");
});

test("four Formic swarms must not share one hex", () => {
  const windows: CmuxWindowGroups[] = ["ANT · probe", "ROWS-0816", "TINT-G fix", "sync desk"].map((name, index) => ({
    windowId: "w",
    groups: [{
      id: `g${index + 1}`,
      name,
      memberWorkspaceIds: [`ws-${index + 1}`],
    }],
  }));
  const teams = buildOperatorTeams(windows, new Set(), { assignments: {} });
  const hexes = teams.map((team) => normalizeHex(team.hex));
  expect(hexes).toHaveLength(4);
  expect(new Set(hexes).size).toBe(4);
});

test("teal in cmux must be teal on the board next collect", () => {
  const teams = buildOperatorTeams(
    [{ windowId: "w", groups: [{
      id: "g1", name: "ANT · probe", customColor: "#0e9494",
      memberWorkspaceIds: ["ws-a"],
    }] }],
    new Set(),
    { assignments: { g1: { groupId: "g1", hex: "#5f7f2a", source: "user" } } },
  );
  expect(teams[0]?.hex).toBe("#0e9494");
});

test("Formic PUT echo lag keeps disk until cmux matches", () => {
  const teams = buildOperatorTeams(
    [{ windowId: "w", groups: [{
      id: "g1", name: "ANT · probe", customColor: "#5f7f2a",
      memberWorkspaceIds: ["ws-a"],
    }] }],
    new Set(),
    { assignments: { g1: { groupId: "g1", hex: "#b05f3a", source: "user" } } },
    new Map([["g1", "#b05f3a"]]),
  );
  expect(teams[0]?.hex).toBe("#b05f3a");
});

test("without expectEcho, live teal beats stale user disk", () => {
  const teams = buildOperatorTeams(
    [{ windowId: "w", groups: [{
      id: "g1", name: "ANT · probe", customColor: "#0e9494",
      memberWorkspaceIds: ["ws-a"],
    }] }],
    new Set(),
    { assignments: { g1: { groupId: "g1", hex: "#b05f3a", source: "user" } } },
  );
  expect(teams[0]?.hex).toBe("#0e9494");
});

test("missing live hex keeps disk and does not snap back to auto", () => {
  const teams = buildOperatorTeams(
    [{
      windowId: "w",
      groups: [{
        id: "g1",
        name: "ANT · probe",
        memberWorkspaceIds: ["ws-a"],
      }],
    }],
    new Set(),
    { assignments: { g1: { groupId: "g1", hex: "#0e9494", source: "cmux" } } },
  );
  expect(teams[0]?.hex).toBe("#0e9494");
});

test("live custom_color wins over an auto slot", () => {
  const teams = buildOperatorTeams(
    [{
      windowId: "w",
      groups: [{
        id: "g1",
        name: "ANT · probe",
        customColor: "#2E66A8",
        memberWorkspaceIds: ["ws-a"],
      }],
    }],
    new Set(),
    { assignments: {} },
  );
  expect(teams[0]?.hex).toBe("#2e66a8");
});

test("live cmux wins over a cmux-source disk row", () => {
  const teams = buildOperatorTeams(
    [{
      windowId: "w",
      groups: [{
        id: "g1",
        name: "ANT · probe",
        customColor: "#2e66a8",
        memberWorkspaceIds: ["ws-a"],
      }],
    }],
    new Set(),
    { assignments: { g1: { groupId: "g1", hex: "#9e3355", source: "cmux" } } },
  );
  expect(teams[0]?.hex).toBe("#2e66a8");
});

test("buildOperatorTeams drops provenance folders and Group N titles", () => {
  const teams = buildOperatorTeams(
    [{
      windowId: "w",
      groups: [
        { id: "prov", name: "the-ant-hill", memberWorkspaceIds: ["ws-repo"] },
        { id: "auto", name: "Group 2", memberWorkspaceIds: ["ws-auto"] },
        { id: "g1", name: "ANT · probe", customColor: "#5F7F2A", memberWorkspaceIds: ["ws-a"] },
      ],
    }],
    new Set(["prov"]),
    { assignments: {} },
  );
  expect(teams.map((team) => team.id)).toEqual(["g1"]);
});

const emptySessions = () => ({
  omp: { value: [], errors: [] },
  codex: { value: [], errors: [] },
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
  opencode: { value: [], errors: [] },
});

function collectedAgent(id: string, sessionId: string): CollectedAgent {
  return {
    id,
    provider: "codex",
    sourceSessionId: sessionId,
    displayName: id,
    cwd: "/Users/emilionunezgarcia/Developer/the-ant-hill",
    status: "running",
    statusReason: "Fixture activity is recent.",
    updatedAt: new Date().toISOString(),
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
  };
}

function surfaceFor(workspaceId: string, sessionId: string): CmuxSurface {
  return {
    workspaceId,
    surfaceId: `SURFACE-${workspaceId}`,
    cwd: "/Users/emilionunezgarcia/Developer/the-ant-hill",
    sourceSessionIds: [sessionId],
    sourceSessionClaims: [{ provider: "codex", sessionId }],
  };
}

async function hubWithTeams(options: {
  rows: readonly { id: string; sessionId: string; workspaceId: string }[];
  groups: CollectionResult<CmuxWindowGroups[]> | (() => CollectionResult<CmuxWindowGroups[]>);
  settings?: TeamTintSettings;
  provenanceIds?: readonly string[];
  store?: JsonTeamColorsStore;
}): Promise<HubState> {
  const store = options.store ?? await JsonTeamColorsStore.open("team-colors.json", memorySettingsFiles());
  if (options.settings) {
    for (const assignment of Object.values(options.settings.assignments)) {
      await store.writeAssignment(assignment.groupId, assignment.hex, assignment.source);
    }
  }
  const provenance = new MemoryRepoGroupProvenanceStore();
  for (const groupId of options.provenanceIds ?? []) {
    await provenance.record({ groupId, repoKey: "the-ant-hill", windowId: "w" });
  }
  const collectors: HubCollectors = {
    sessions: async () => ({
      ...emptySessions(),
      codex: {
        value: options.rows.map((row) => collectedAgent(row.id, row.sessionId)),
        errors: [],
      },
    }),
    cmux: async () => ({
      value: options.rows.map((row) => surfaceFor(row.workspaceId, row.sessionId)),
      errors: [],
    }),
    notifications: async () => ({ value: [], errors: [] }),
    enrichIdentity: async (surfaces) => ({
      value: [...surfaces],
      errors: [],
      liveAgentProcessIds: [],
      recognizedAgentProcessIds: [],
      processStarts: {},
      rosterComplete: true,
    }),
    groups: async () => typeof options.groups === "function" ? options.groups() : options.groups,
  };
  return new HubState(
    {
      run: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({ windows: [] }),
        stderr: "",
        timedOut: false,
      }),
    },
    new MemoryArchiveStore(),
    [],
    {
      collectors,
      teamColorsStore: store,
      repoGroupProvenance: provenance,
      refreshAggregateTimeoutMs: 2_000,
    },
  );
}

async function snapshotWithTeams(options: {
  rows: readonly { id: string; sessionId: string; workspaceId: string }[];
  groups: CollectionResult<CmuxWindowGroups[]>;
  settings?: TeamTintSettings;
  provenanceIds?: readonly string[];
}): Promise<ReturnType<HubState["get"]>> {
  const state = await hubWithTeams(options);
  return state.refresh({ cmux: true });
}

function publishedAgent(snapshot: ReturnType<HubState["get"]>, id: string) {
  return snapshot.programs.flatMap((program) => program.agents).find((row) => row.id === id);
}

test("snapshot publishes different team hexes for two agents in the same repo", async () => {
  const snapshot = await snapshotWithTeams({
    rows: [
      { id: "codex:a", sessionId: "a", workspaceId: "ws-a" },
      { id: "codex:b", sessionId: "b", workspaceId: "ws-b" },
    ],
    groups: {
      value: [{
        windowId: "w",
        groups: [
          { id: "g1", name: "ANT · probe", customColor: "#5F7F2A", memberWorkspaceIds: ["ws-a"] },
          { id: "g2", name: "ROWS-0816", customColor: "#2E66A8", memberWorkspaceIds: ["ws-b"] },
        ],
      }],
      errors: [],
    },
  });
  const left = publishedAgent(snapshot, "codex:a");
  const right = publishedAgent(snapshot, "codex:b");
  expect(left?.team).toEqual({ id: "g1", name: "ANT · probe", hex: "#5f7f2a", windowId: "w" });
  expect(right?.team).toEqual({ id: "g2", name: "ROWS-0816", hex: "#2e66a8", windowId: "w" });
  expect(left?.team?.hex).not.toBe(right?.team?.hex);
});

test("snapshot: live custom_color #2e66a8 with empty settings is the team hex", async () => {
  const snapshot = await snapshotWithTeams({
    rows: [{ id: "codex:a", sessionId: "a", workspaceId: "ws-a" }],
    groups: {
      value: [{
        windowId: "w",
        groups: [{
          id: "g1",
          name: "ANT · probe",
          customColor: "#2e66a8",
          memberWorkspaceIds: ["ws-a"],
        }],
      }],
      errors: [],
    },
  });
  expect(publishedAgent(snapshot, "codex:a")?.team?.hex).toBe("#2e66a8");
});

test("snapshot: live cmux #2e66a8 beats stale user PUT #9e3355", async () => {
  const snapshot = await snapshotWithTeams({
    rows: [{ id: "codex:a", sessionId: "a", workspaceId: "ws-a" }],
    settings: { assignments: { g1: { groupId: "g1", hex: "#9e3355", source: "user" } } },
    groups: {
      value: [{
        windowId: "w",
        groups: [{
          id: "g1",
          name: "ANT · probe",
          customColor: "#2e66a8",
          memberWorkspaceIds: ["ws-a"],
        }],
      }],
      errors: [],
    },
  });
  expect(publishedAgent(snapshot, "codex:a")?.team?.hex).toBe("#2e66a8");
});

test("after persist cmux hex, a later different live hex still wins", async () => {
  const store = await JsonTeamColorsStore.open("team-colors.json", memorySettingsFiles());
  const live = {
    value: [{
      windowId: "w",
      groups: [{
        id: "g1",
        name: "ANT · probe",
        customColor: "#0e9494",
        memberWorkspaceIds: ["ws-a"],
      }],
    }],
    errors: [],
  };
  const state = await hubWithTeams({
    store,
    rows: [{ id: "codex:a", sessionId: "a", workspaceId: "ws-a" }],
    groups: () => live,
  });
  const first = await state.refresh({ cmux: true });
  expect(publishedAgent(first, "codex:a")?.team?.hex).toBe("#0e9494");
  expect(store.get().assignments.g1).toEqual({
    groupId: "g1",
    hex: "#0e9494",
    source: "cmux",
  });
  expect(store.expectedEchoes().has("g1")).toBe(false);

  live.value[0]!.groups[0]!.customColor = "#b05f3a";
  const second = await state.refresh({ cmux: true });
  expect(publishedAgent(second, "codex:a")?.team?.hex).toBe("#b05f3a");
  expect(store.get().assignments.g1).toEqual({
    groupId: "g1",
    hex: "#b05f3a",
    source: "cmux",
  });
});

test("live teal ingest persists source cmux over stale user disk", async () => {
  const store = await JsonTeamColorsStore.open("team-colors.json", memorySettingsFiles());
  await store.writeAssignment("g1", "#5f7f2a", "user");
  const state = await hubWithTeams({
    store,
    rows: [{ id: "codex:a", sessionId: "a", workspaceId: "ws-a" }],
    groups: {
      value: [{
        windowId: "w",
        groups: [{
          id: "g1",
          name: "ANT · probe",
          customColor: "#0e9494",
          memberWorkspaceIds: ["ws-a"],
        }],
      }],
      errors: [],
    },
  });
  await state.refresh({ cmux: true });
  expect(store.get().assignments.g1).toEqual({
    groupId: "g1",
    hex: "#0e9494",
    source: "cmux",
  });
});

test("a Formic PUT keeps disk while group.list still shows the old hex", async () => {
  const store = await JsonTeamColorsStore.open("team-colors.json", memorySettingsFiles());
  await store.setUserColor("g1", "#b05f3a");
  const live = {
    value: [{
      windowId: "w",
      groups: [{
        id: "g1",
        name: "ANT · probe",
        customColor: "#5f7f2a",
        memberWorkspaceIds: ["ws-a"],
      }],
    }],
    errors: [],
  };
  const state = await hubWithTeams({
    store,
    rows: [{ id: "codex:a", sessionId: "a", workspaceId: "ws-a" }],
    groups: () => live,
  });
  const first = await state.refresh({ cmux: true });
  expect(publishedAgent(first, "codex:a")?.team?.hex).toBe("#b05f3a");
  expect(store.get().assignments.g1).toEqual({
    groupId: "g1",
    hex: "#b05f3a",
    source: "user",
  });

  live.value[0]!.groups[0]!.customColor = "#b05f3a";
  await state.refresh({ cmux: true });
  expect(store.expectedEchoes().has("g1")).toBe(false);

  live.value[0]!.groups[0]!.customColor = "#0e9494";
  const third = await state.refresh({ cmux: true });
  expect(publishedAgent(third, "codex:a")?.team?.hex).toBe("#0e9494");
});

test("snapshot leaves an ungrouped agent without a team", async () => {
  const snapshot = await snapshotWithTeams({
    rows: [{ id: "codex:c", sessionId: "c", workspaceId: "ws-ungrouped" }],
    groups: { value: [], errors: [] },
  });
  expect(publishedAgent(snapshot, "codex:c")?.team).toBeUndefined();
});

test("collection failure publishes no team and does not crash", async () => {
  const snapshot = await snapshotWithTeams({
    rows: [{ id: "codex:d", sessionId: "d", workspaceId: "ws-a" }],
    groups: { value: [], errors: ["cmux window discovery timed out"] },
  });
  const row = publishedAgent(snapshot, "codex:d");
  expect(row?.team).toBeUndefined();
  expect(row?.id).toBe("codex:d");
});

test("total group collect miss keeps last-good teams and does not hand TINT-S the repo hex", async () => {
  const liveGroups: CollectionResult<CmuxWindowGroups[]> = {
    value: [{
      windowId: "w",
      groups: [{
        id: "g1",
        name: "ANT · probe",
        customColor: "#5F7F2A",
        memberWorkspaceIds: ["ws-a"],
      }],
    }],
    errors: [],
  };
  let groups = liveGroups;
  const state = await hubWithTeams({
    rows: [{ id: "codex:a", sessionId: "a", workspaceId: "ws-a" }],
    groups: () => groups,
  });

  const first = await state.refresh({ cmux: true });
  expect(publishedAgent(first, "codex:a")?.team).toEqual({
    id: "g1",
    name: "ANT · probe",
    hex: "#5f7f2a",
    windowId: "w",
  });

  groups = { value: [], errors: ["timeout"] };
  const second = await state.refresh({ cmux: true });
  expect(publishedAgent(second, "codex:a")?.team).toEqual({
    id: "g1",
    name: "ANT · probe",
    hex: "#5f7f2a",
    windowId: "w",
  });

  const writes: { workspaceId: string; hex: string }[] = [];
  const teamByWorkspaceId = new Map(
    [...indexTeamsByWorkspace(state.teams())].map(([workspaceId, team]) => [
      workspaceId,
      { id: team.id, hex: team.hex },
    ]),
  );
  await reconcileWorkspaceColors({
    observations: [{
      workspaceId: "ws-a",
      customColor: "#111111",
      currentDirectory: "/Users/emilionunezgarcia/Developer/the-ant-hill",
    }],
    surfaces: state.surfaces(),
    settings: {
      assignments: {
        "the-ant-hill": { repoKey: "the-ant-hill", hex: "#d70ae6", slot: null, source: "auto" },
      },
      mirrorGroups: true,
      syncFromCmux: true,
    },
    runtime: {
      repoKeyForCwd: (cwd) => cwd.includes("the-ant-hill") ? "the-ant-hill" : null,
      funnel: {
        setWorkspaceColor: async (workspaceId, hex) => {
          writes.push({ workspaceId, hex });
          return true;
        },
        lastWrittenHex: () => null,
      },
    },
    teamByWorkspaceId,
  });
  expect(teamByWorkspaceId.get("ws-a")).toEqual({ id: "g1", hex: "#5f7f2a" });
  expect(writes.some((write) => write.hex.toLowerCase() === "#d70ae6")).toBe(false);
});

const ORIGIN = "http://127.0.0.1:4701";

test("GET /api/team-colors returns only the operator team", async () => {
  const store = await JsonTeamColorsStore.open("team-colors.json", memorySettingsFiles());
  await store.setUserColor("g1", "#5f7f2a");
  const response = await handleTeamColorsRequest(
    new Request(`${ORIGIN}/api/team-colors`),
    store,
    {
      teams: () => [
        { id: "g1", name: "ANT · probe", hex: "#5f7f2a", windowId: "w", memberWorkspaceIds: ["ws-a"] },
        { id: "prov", name: "the-ant-hill", hex: "#2e66a8", windowId: "w", memberWorkspaceIds: ["ws-b"] },
      ],
      provenanceIds: () => new Set(["prov"]),
    },
  );
  expect(response.status).toBe(200);
  const body = await response.json() as {
    teams: CmuxTeam[];
    settings: TeamTintSettings;
  };
  expect(body.teams.map((team) => team.id)).toEqual(["g1"]);
  expect(body.settings.assignments.g1).toEqual({
    groupId: "g1",
    hex: "#5f7f2a",
    source: "user",
  });
});

test("GET /api/team-colors is loopback only and tails 404", async () => {
  const store = await JsonTeamColorsStore.open("team-colors.json", memorySettingsFiles());
  const remote = await handleTeamColorsRequest(
    new Request("http://10.0.0.5:4701/api/team-colors"),
    store,
  );
  expect(remote.status).toBe(403);
  const remoteBody = await remote.json() as { error: string; code: string };
  expect(remoteBody.code).toBe("ORIGIN_REJECTED");
  expect(remoteBody.error).toBeTruthy();

  const tail = await handleTeamColorsRequest(
    new Request(`${ORIGIN}/api/team-colors/g1`),
    store,
  );
  expect(tail.status).toBe(404);
  const tailBody = await tail.json() as { error: string; code: string };
  expect(tailBody.code).toBe("NOT_FOUND");
  expect(tailBody.error).toBeTruthy();
});

test("GET /api/team-colors filters a leaked TINT-G folder without an injected provenance store", async () => {
  const leakedId = "prov-leaked-team-colors-get";
  const disk = await JsonRepoGroupProvenanceStore.open(
    resolve(import.meta.dir, "../data/repo-group-provenance.json"),
  );
  await disk.record({ groupId: leakedId, repoKey: "the-ant-hill", windowId: "w" });
  const store = await JsonTeamColorsStore.open("team-colors.json", memorySettingsFiles());
  const snapshot = emptySnapshot();
  const fetch = createMountainFetch({
    state: {
      get: () => snapshot,
      subscribe: () => () => {},
      refresh: async () => snapshot,
      teams: () => [
        { id: "g1", name: "ANT · probe", hex: "#5f7f2a", windowId: "w", memberWorkspaceIds: ["ws-a"] },
        { id: leakedId, name: "the-ant-hill", hex: "#2e66a8", windowId: "w", memberWorkspaceIds: ["ws-b"] },
      ],
    },
    runner: { run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }) },
    archiveStore: { has: () => false, archive: async () => {} },
    teamColorsStore: store,
    webRoot: import.meta.dir,
  });
  try {
    const response = await fetch(new Request(`${ORIGIN}/api/team-colors`));
    expect(response.status).toBe(200);
    const body = await response.json() as { teams: CmuxTeam[] };
    expect(body.teams.map((team) => team.id)).toEqual(["g1"]);
  } finally {
    fetch.dispose();
    await disk.forget(leakedId);
  }
});
