import { readFileSync } from "node:fs";
import { expect, test } from "bun:test";
import { createMountainFetch, emptySnapshot } from "../src/server/app";
import { MemoryRepoGroupProvenanceStore } from "../src/server/cmux-groups";
import { memorySettingsFiles } from "../src/server/settings";
import { JsonTeamColorsStore } from "../src/server/team-colors";
import {
  addOperatorMember,
  createOperatorTeam,
  handleTeamGroupsRequest,
  removeOperatorMember,
  ungroupOperatorTeam,
  type TeamGroupDependencies,
} from "../src/server/team-groups";
import type { CommandResult, CommandRunner } from "../src/server/types";
import { isOperatorTeam, type CmuxTeam } from "../src/shared/team-tint";

const ORIGIN = "http://127.0.0.1:4701";

interface FakeGroup {
  windowId: string;
  name: string;
  customColor?: string | null;
  anchorWorkspaceId?: string;
  members: string[];
}

/* Models the 2026-08-13 cmux contract: create auto-names Group N, add steals,
   remove of an anchor dissolves the group, ungroup keeps the panes. */
class FakeCmux implements CommandRunner {
  readonly calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  readonly windows = new Map<string, string[]>();
  readonly groups = new Map<string, FakeGroup>();
  failures = new Map<string, string>();
  private nextGroup = 1;

  constructor(windows: Record<string, string[]>) {
    for (const [windowId, workspaceIds] of Object.entries(windows)) {
      this.windows.set(windowId, [...workspaceIds]);
    }
  }

  seedGroup(groupId: string, group: FakeGroup): void {
    const members = [...group.members];
    if (group.anchorWorkspaceId && !members.includes(group.anchorWorkspaceId)) {
      members.unshift(group.anchorWorkspaceId);
    }
    const listed = this.windows.get(group.windowId) ?? [];
    if (group.anchorWorkspaceId && !listed.includes(group.anchorWorkspaceId)) {
      listed.push(group.anchorWorkspaceId);
    }
    this.windows.set(group.windowId, listed);
    this.groups.set(groupId, { ...group, customColor: group.customColor ?? null, members });
  }

  methodCalls(method: string): Array<Record<string, unknown>> {
    return this.calls.filter((call) => call.method === method).map((call) => call.params);
  }

  async run(command: readonly string[], _timeoutMs?: number): Promise<CommandResult> {
    const [, verb, method, rawParams] = command;
    if (verb !== "rpc" || !method) throw new Error(`unexpected cmux invocation: ${command.join(" ")}`);
    const params = JSON.parse(rawParams ?? "{}") as Record<string, unknown>;
    this.calls.push({ method, params });
    const failure = this.failures.get(method);
    if (failure) return { exitCode: 1, stdout: "", stderr: failure, timedOut: false };
    return { exitCode: 0, stdout: JSON.stringify(this.dispatch(method, params)), stderr: "", timedOut: false };
  }

  private dispatch(method: string, params: Record<string, unknown>): unknown {
    const windowId = String(params.window_id ?? "");
    const groupId = String(params.group_id ?? "");
    const workspaceId = String(params.workspace_id ?? "");
    switch (method) {
      case "window.list":
        return { windows: [...this.windows.keys()].map((id) => ({ id })) };
      case "workspace.list":
        return { workspaces: (this.windows.get(windowId) ?? []).map((id) => ({ id })) };
      case "workspace.group.list":
        return {
          groups: [...this.groups.entries()]
            .filter(([, group]) => group.windowId === windowId)
            .map(([id, group]) => ({
              id,
              name: group.name,
              custom_color: group.customColor,
              anchor_workspace_id: group.anchorWorkspaceId,
              member_workspace_ids: [...group.members],
            })),
        };
      case "workspace.group.create": {
        const children = (params.child_workspace_ids as string[] | undefined) ?? [];
        const inWindow = this.windows.get(windowId) ?? [];
        for (const child of children) {
          if (!inWindow.includes(child)) throw new Error(`Child workspace not found in target window: ${child}`);
          this.detach(child);
        }
        const id = `group-${this.nextGroup}`;
        const name = `Group ${this.nextGroup}`;
        const anchor = `anchor-${this.nextGroup}`;
        this.nextGroup += 1;
        inWindow.push(anchor);
        const members = [anchor, ...children];
        this.groups.set(id, { windowId, name, customColor: null, anchorWorkspaceId: anchor, members });
        return {
          group: {
            id,
            name,
            custom_color: null,
            anchor_workspace_id: anchor,
            member_workspace_ids: [...members],
          },
        };
      }
      case "workspace.group.add": {
        const group = this.groups.get(groupId);
        if (!group) throw new Error("Group or workspace not found");
        this.detach(workspaceId);
        group.members.push(workspaceId);
        return { group_id: groupId, workspace_id: workspaceId };
      }
      case "workspace.group.remove": {
        for (const [id, group] of this.groups) {
          if (group.anchorWorkspaceId === workspaceId) this.groups.delete(id);
        }
        this.detach(workspaceId);
        return { workspace_id: workspaceId };
      }
      case "workspace.group.rename": {
        const group = this.groups.get(groupId);
        if (!group) throw new Error("Missing or invalid group_id");
        group.name = String(params.name ?? "");
        return { group_id: groupId, name: group.name };
      }
      case "workspace.group.ungroup": {
        const group = this.groups.get(groupId);
        if (!group) throw new Error("Missing or invalid group_id");
        this.groups.delete(groupId);
        return { kept_workspace_count: group.members.length };
      }
      case "workspace.group.delete":
        this.groups.delete(groupId);
        return { deleted: true };
      default:
        throw new Error(`fixture cmux was asked for ${method}`);
    }
  }

  private detach(workspaceId: string): void {
    for (const group of this.groups.values()) {
      group.members = group.members.filter((member) => member !== workspaceId);
    }
  }
}

function subject(
  windows: Record<string, string[]>,
  extra: {
    provenanceIds?: ReadonlySet<string>;
    colors?: Array<{ groupId: string; hex: string; reason: string }>;
  } = {},
) {
  const cmux = new FakeCmux(windows);
  const colors = extra.colors ?? [];
  const deps: TeamGroupDependencies = {
    runner: cmux,
    provenanceIds: () => extra.provenanceIds ?? new Set(),
    setGroupColor: async (groupId, hex, reason) => {
      colors.push({ groupId, hex, reason });
      const group = cmux.groups.get(groupId);
      if (group) group.customColor = hex;
      return true;
    },
  };
  return {
    cmux,
    deps,
    colors,
    handle: (request: Request) => handleTeamGroupsRequest(request, deps),
  };
}

function jsonRequest(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

test("create renames off Group N before returning", async () => {
  const { cmux, deps } = subject({ "WINDOW-A": ["ws-a", "ws-b"] });
  const { team } = await createOperatorTeam({
    windowId: "WINDOW-A",
    workspaceIds: ["ws-a", "ws-b"],
    name: "ROWS-0816",
  }, deps);
  expect(team.name).toBe("ROWS-0816");
  expect(team.name).not.toMatch(/^Group \d+$/);
  const methods = cmux.calls.map((call) => call.method);
  const createAt = methods.indexOf("workspace.group.create");
  const renameAt = methods.indexOf("workspace.group.rename");
  expect(createAt).toBeGreaterThanOrEqual(0);
  expect(renameAt).toBeGreaterThan(createAt);
  expect(cmux.calls[createAt]?.params).toEqual({
    window_id: "WINDOW-A",
    child_workspace_ids: ["ws-a", "ws-b"],
  });
  expect(cmux.calls[renameAt]?.params).toEqual({
    group_id: team.id,
    name: "ROWS-0816",
  });
  expect(cmux.groups.get(team.id)?.name).toBe("ROWS-0816");
});

test("create refuses a child already in a foreign group", async () => {
  const { cmux, handle } = subject({ "WINDOW-A": ["ws-a", "ws-b"] });
  cmux.seedGroup("foreign", {
    windowId: "WINDOW-A",
    name: "ANT · probe",
    members: ["ws-a"],
  });
  cmux.calls.length = 0;
  const response = await handle(jsonRequest("POST", "/api/teams", {
    windowId: "WINDOW-A",
    workspaceIds: ["ws-a", "ws-b"],
    name: "ROWS-0816",
  }));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "FOREIGN_GROUP" });
  expect(cmux.methodCalls("workspace.group.create")).toEqual([]);
  expect(cmux.groups.get("foreign")?.members).toContain("ws-a");
});

test("ungroup keeps workspaces (never group.delete)", async () => {
  const { cmux, handle } = subject({ "WINDOW-A": ["ws-a", "ws-b"] });
  cmux.seedGroup("g1", {
    windowId: "WINDOW-A",
    name: "ROWS-0816",
    members: ["ws-a", "ws-b"],
    anchorWorkspaceId: "anchor-g1",
  });
  const response = await handle(jsonRequest("DELETE", "/api/teams/g1"));
  expect(response.status).toBe(200);
  expect(cmux.methodCalls("workspace.group.ungroup")).toEqual([{ group_id: "g1" }]);
  expect(cmux.methodCalls("workspace.group.delete")).toEqual([]);
  expect(cmux.windows.get("WINDOW-A")).toEqual(expect.arrayContaining(["ws-a", "ws-b"]));
  expect(cmux.groups.has("g1")).toBe(false);
});

test("remove refuses the anchor", async () => {
  const { cmux, handle } = subject({ "WINDOW-A": ["ws-a"] });
  cmux.seedGroup("g1", {
    windowId: "WINDOW-A",
    name: "ROWS-0816",
    members: ["anchor-g1", "ws-a"],
    anchorWorkspaceId: "anchor-g1",
  });
  cmux.calls.length = 0;
  const response = await handle(jsonRequest("DELETE", "/api/teams/g1/members/anchor-g1"));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "ANCHOR" });
  expect(cmux.methodCalls("workspace.group.remove")).toEqual([]);
  expect(cmux.groups.has("g1")).toBe(true);
});

test("isOperatorTeam still rejects Group N and provenance", () => {
  expect(isOperatorTeam("Group 2", "x", new Set())).toBe(false);
  expect(isOperatorTeam("ANT · probe", "prov", new Set(["prov"]))).toBe(false);
});

test("create refuses Group N so the next collect cannot hide the band", async () => {
  const { cmux, handle } = subject({ "WINDOW-A": ["ws-a"] });
  const response = await handle(jsonRequest("POST", "/api/teams", {
    windowId: "WINDOW-A",
    workspaceIds: ["ws-a"],
    name: "Group 2",
  }));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "INVALID_NAME" });
  expect(cmux.methodCalls("workspace.group.create")).toEqual([]);
});

test("create without windowId uses the window that already holds every child", async () => {
  const { cmux, deps } = subject({
    "WINDOW-A": ["ws-a", "ws-b"],
    "WINDOW-B": ["ws-c"],
  });
  const { team } = await createOperatorTeam({
    workspaceIds: ["ws-a", "ws-b"],
    name: "ROWS-0816",
  }, deps);
  expect(team.windowId).toBe("WINDOW-A");
  expect(cmux.methodCalls("workspace.group.create")).toEqual([{
    window_id: "WINDOW-A",
    child_workspace_ids: ["ws-a", "ws-b"],
  }]);
});

test("create without windowId refuses children that do not share a window", async () => {
  const { cmux, handle } = subject({
    "WINDOW-A": ["ws-a"],
    "WINDOW-B": ["ws-b"],
  });
  const response = await handle(jsonRequest("POST", "/api/teams", {
    workspaceIds: ["ws-a", "ws-b"],
    name: "ROWS-0816",
  }));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "MIXED_WINDOW" });
  expect(cmux.methodCalls("workspace.group.create")).toEqual([]);
});

test("create refuses children that do not share the named window", async () => {
  const { cmux, handle } = subject({
    "WINDOW-A": ["ws-a"],
    "WINDOW-B": ["ws-b"],
  });
  const response = await handle(jsonRequest("POST", "/api/teams", {
    windowId: "WINDOW-A",
    workspaceIds: ["ws-a", "ws-b"],
    name: "ROWS-0816",
  }));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "MIXED_WINDOW" });
  expect(cmux.methodCalls("workspace.group.create")).toEqual([]);
});

test("add refuses to steal a member of another group", async () => {
  const { cmux, handle } = subject({ "WINDOW-A": ["ws-a", "ws-b"] });
  cmux.seedGroup("ours", {
    windowId: "WINDOW-A",
    name: "ROWS-0816",
    members: ["ws-a"],
    anchorWorkspaceId: "anchor-ours",
  });
  cmux.seedGroup("theirs", {
    windowId: "WINDOW-A",
    name: "ANT · probe",
    members: ["ws-b"],
    anchorWorkspaceId: "anchor-theirs",
  });
  cmux.calls.length = 0;
  const response = await handle(jsonRequest("POST", "/api/teams/ours/members", { workspaceId: "ws-b" }));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "FOREIGN_GROUP" });
  expect(cmux.methodCalls("workspace.group.add")).toEqual([]);
  expect(cmux.groups.get("theirs")?.members).toContain("ws-b");
});

test("add and remove refuse an anchor workspace", async () => {
  const { cmux, deps } = subject({ "WINDOW-A": ["ws-a", "ws-b"] });
  cmux.seedGroup("ours", {
    windowId: "WINDOW-A",
    name: "ROWS-0816",
    members: ["ws-a"],
    anchorWorkspaceId: "anchor-ours",
  });
  cmux.seedGroup("theirs", {
    windowId: "WINDOW-A",
    name: "ANT · probe",
    members: ["ws-b"],
    anchorWorkspaceId: "anchor-theirs",
  });
  cmux.calls.length = 0;
  await expect(addOperatorMember("ours", "anchor-theirs", deps)).rejects.toMatchObject({ code: "ANCHOR" });
  await expect(removeOperatorMember("ours", "anchor-ours", deps)).rejects.toMatchObject({ code: "ANCHOR" });
  expect(cmux.methodCalls("workspace.group.add")).toEqual([]);
  expect(cmux.methodCalls("workspace.group.remove")).toEqual([]);
});

test("optional hex is written after the rename lands", async () => {
  const colors: Array<{ groupId: string; hex: string; reason: string }> = [];
  const { cmux, deps } = subject({ "WINDOW-A": ["ws-a"] }, { colors });
  const { team } = await createOperatorTeam({
    windowId: "WINDOW-A",
    workspaceIds: ["ws-a"],
    name: "ROWS-0816",
    hex: "#0E9494",
  }, deps);
  const methods = cmux.calls.map((call) => call.method);
  expect(methods.indexOf("workspace.group.rename")).toBeGreaterThan(methods.indexOf("workspace.group.create"));
  expect(colors).toEqual([{ groupId: team.id, hex: "#0e9494", reason: "board team create" }]);
  expect(team.hex).toBe("#0e9494");
});

test("mutating routes require exact same-origin loopback", async () => {
  const { handle } = subject({ "WINDOW-A": ["ws-a"] });
  const remote = await handle(new Request("http://10.0.0.5:4701/api/teams", {
    method: "POST",
    headers: { origin: "http://10.0.0.5:4701", "content-type": "application/json" },
    body: JSON.stringify({ windowId: "WINDOW-A", workspaceIds: ["ws-a"], name: "ROWS-0816" }),
  }));
  expect(remote.status).toBe(403);
  expect(await remote.json()).toMatchObject({ code: "ORIGIN_REJECTED" });

  const cross = await handle(jsonRequest("POST", "/api/teams", {
    windowId: "WINDOW-A",
    workspaceIds: ["ws-a"],
    name: "ROWS-0816",
  }, { origin: "http://evil.example" }));
  expect(cross.status).toBe(403);
  expect(await cross.json()).toMatchObject({ code: "ORIGIN_REJECTED" });
});

test("provenance folders cannot be renamed, filled, or ungrouped", async () => {
  const { cmux, handle } = subject({ "WINDOW-A": ["ws-a", "ws-b"] }, {
    provenanceIds: new Set(["prov"]),
  });
  cmux.seedGroup("prov", {
    windowId: "WINDOW-A",
    name: "the-ant-hill",
    members: ["ws-a"],
    anchorWorkspaceId: "anchor-prov",
  });
  cmux.calls.length = 0;
  const rename = await handle(jsonRequest("PATCH", "/api/teams/prov", { name: "ROWS-0816" }));
  const add = await handle(jsonRequest("POST", "/api/teams/prov/members", { workspaceId: "ws-b" }));
  const ungroup = await handle(jsonRequest("DELETE", "/api/teams/prov"));
  expect(rename.status).toBe(404);
  expect(add.status).toBe(404);
  expect(ungroup.status).toBe(404);
  expect(cmux.methodCalls("workspace.group.rename")).toEqual([]);
  expect(cmux.methodCalls("workspace.group.add")).toEqual([]);
  expect(cmux.methodCalls("workspace.group.ungroup")).toEqual([]);
});

test("ungroup never closes panes even when called at the service layer", async () => {
  const { cmux, deps } = subject({ "WINDOW-A": ["ws-a"] });
  cmux.seedGroup("g1", {
    windowId: "WINDOW-A",
    name: "ROWS-0816",
    members: ["ws-a"],
    anchorWorkspaceId: "anchor-g1",
  });
  await ungroupOperatorTeam("g1", deps);
  expect(cmux.methodCalls("workspace.group.delete")).toEqual([]);
  expect(cmux.windows.get("WINDOW-A")).toEqual(expect.arrayContaining(["ws-a", "anchor-g1"]));
});

test("the mutator never names workspace.group.delete or writes TINT-G provenance", () => {
  const source = readFileSync(new URL("../src/server/team-groups.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/workspace\.group\.delete/);
  expect(source).not.toMatch(/provenance\.(record|forget)/);
});

test("TINT-G still continues instead of creating when a repo has no live group", () => {
  const source = readFileSync(new URL("../src/server/cmux-groups.ts", import.meta.url), "utf8");
  expect(source).toMatch(/if \(!live\) \{[\s\S]{0,400}?continue;/);
  expect(source).toContain("Do not mint a new sidebar group");
});

test("POST /api/teams reaches the handler through createMountainFetch", async () => {
  const cmux = new FakeCmux({ "WINDOW-A": ["ws-a", "ws-b"] });
  const store = await JsonTeamColorsStore.open("team-colors.json", memorySettingsFiles());
  const provenance = new MemoryRepoGroupProvenanceStore();
  const fetch = createMountainFetch({
    state: {
      get: () => emptySnapshot(),
      subscribe: () => () => {},
      refresh: async () => emptySnapshot(),
    },
    runner: cmux,
    archiveStore: { has: () => false, archive: async () => {} },
    teamColorsStore: store,
    repoGroupProvenance: provenance,
    teamColorWrites: {
      setGroupColor: async () => true,
      setWorkspaceColor: async () => true,
    },
    webRoot: import.meta.dir,
  });
  try {
    const response = await fetch(jsonRequest("POST", "/api/teams", {
      windowId: "WINDOW-A",
      workspaceIds: ["ws-a", "ws-b"],
      name: "ROWS-0816",
      hex: "#2E66A8",
    }));
    expect(response.status).toBe(200);
    const body = await response.json() as { team: CmuxTeam };
    expect(body.team.name).toBe("ROWS-0816");
    expect(body.team.windowId).toBe("WINDOW-A");
    expect(cmux.methodCalls("workspace.group.create")).toEqual([{
      window_id: "WINDOW-A",
      child_workspace_ids: ["ws-a", "ws-b"],
    }]);
    expect(cmux.methodCalls("workspace.group.rename")).toEqual([{
      group_id: body.team.id,
      name: "ROWS-0816",
    }]);
    expect(cmux.methodCalls("workspace.group.delete")).toEqual([]);
    expect(provenance.list()).toEqual([]);
  } finally {
    fetch.dispose();
  }
});
