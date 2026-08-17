import { beforeEach, describe, expect, test } from "bun:test";
import {
  MemoryRepoGroupProvenanceStore,
  normalizeHex,
  reconcileRepoGroups,
  repoGroupReconcileTick,
  registerRepoGroupInputs,
  resetRepoGroupRegistrationForTests,
  type RepoGroupInputs,
  type RepoGroupTarget,
} from "../src/server/cmux-groups";
import type { CommandResult, CommandRunner } from "../src/server/types";

const MUTATING_METHODS = [
  "workspace.group.create",
  "workspace.group.add",
  "workspace.group.remove",
  "workspace.group.rename",
  "workspace.group.ungroup",
  "workspace.group.delete",
  "workspace.group.set_color",
] as const;

interface FakeGroup {
  windowId: string;
  name: string;
  customColor: string | null;
  /* cmux heads every group with a workspace row it creates itself. */
  anchorWorkspaceId?: string;
  members: string[];
}

/* A cmux that behaves the way the real one did on 2026-08-13, verified by hand
   against cmux's own group RPCs: groups belong to a window, `create` names the
   group itself ("Group N") and also creates the anchor workspace row that heads
   it, `add` moves a workspace out of whatever group it was in, `remove`
   resolves the group from the workspace, and removing the ANCHOR destroys the
   group while leaving its row behind. Modelling those facts is the whole point
   — a fixture that just records calls would pass while the module reconciled
   against a cmux that does not exist. */
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
    this.groups.set(groupId, { ...group, members: [...group.members] });
  }

  get mutations(): number {
    return this.calls.filter(({ method }) => MUTATING_METHODS.includes(method as never)).length;
  }

  methodCalls(method: string): Array<Record<string, unknown>> {
    return this.calls.filter((call) => call.method === method).map((call) => call.params);
  }

  windowOf(workspaceId: string): string | undefined {
    for (const [windowId, workspaceIds] of this.windows) {
      if (workspaceIds.includes(workspaceId)) return windowId;
    }
    return undefined;
  }

  groupOf(workspaceId: string): string | undefined {
    for (const [groupId, group] of this.groups) {
      if (group.members.includes(workspaceId)) return groupId;
    }
    return undefined;
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
        /* Verified live 2026-08-13: removing the anchor takes the whole group
           with it and leaves the anchor row orphaned in the sidebar. */
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
      default:
        throw new Error(`fixture cmux was asked for ${method}, which this module must never call`);
    }
  }

  private detach(workspaceId: string): void {
    for (const [groupId, group] of this.groups) {
      group.members = group.members.filter((member) => member !== workspaceId);
      if (!group.members.length && groupId.startsWith("group-")) continue;
    }
  }
}

/** Members minus the anchor row cmux heads every group with. */
function membersOf(cmux: FakeCmux, groupId: string): string[] {
  const group = cmux.groups.get(groupId);
  if (!group) return [];
  return group.members.filter((member) => member !== group.anchorWorkspaceId).sort();
}

function target(workspaceId: string, repoKey: string, hex: string): RepoGroupTarget {
  return { workspaceId, repoKey, hex };
}

/** TINT-G no longer mints groups. Tests that exercise add/rename/teardown
    start from a group we already recorded, the way production Formic does. */
async function own(
  cmux: FakeCmux,
  provenance: MemoryRepoGroupProvenanceStore,
  windowId: string,
  repoKey: string,
  members: string[] = [],
  hex = "#5F7F2A",
): Promise<string> {
  const groupId = `ours-${windowId}-${repoKey}-${cmux.groups.size + 1}`;
  const anchor = `anchor-${groupId}`;
  const listed = cmux.windows.get(windowId) ?? [];
  if (!listed.includes(anchor)) listed.push(anchor);
  cmux.windows.set(windowId, listed);
  cmux.seedGroup(groupId, {
    windowId,
    name: repoKey,
    customColor: hex,
    members: [anchor, ...members],
    anchorWorkspaceId: anchor,
  });
  await provenance.record({ groupId, repoKey, windowId });
  return groupId;
}

interface Funnel {
  setGroupColor: RepoGroupInputs["setGroupColor"];
  writes: Array<{ groupId: string; hex: string; reason: string }>;
}

function funnel(cmux: FakeCmux, answer = true): Funnel {
  const writes: Funnel["writes"] = [];
  return {
    writes,
    setGroupColor: async (groupId, hex, reason) => {
      writes.push({ groupId, hex, reason });
      if (!answer) return false;
      const group = cmux.groups.get(groupId);
      if (group) group.customColor = hex;
      return true;
    },
  };
}

describe("normalizeHex", () => {
  test("case and shorthand collapse to one comparable form", () => {
    expect(normalizeHex("#2E66A8")).toBe("#2e66a8");
    expect(normalizeHex("2e66a8")).toBe("#2e66a8");
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("olive")).toBeUndefined();
    expect(normalizeHex(undefined)).toBeUndefined();
  });
});

describe("reconcileRepoGroups", () => {
  /* The teardown confirmation counter lives at module scope, so two tests using
     the same window and repo names would otherwise inherit each other's tally. */
  beforeEach(resetRepoGroupRegistrationForTests);

  /** Anchor rows cmux minted — the residue an operator sees as "Group N". */
  function anchorRows(cmux: FakeCmux, windowId: string): string[] {
    return (cmux.windows.get(windowId) ?? []).filter((id) => id.startsWith("anchor-"));
  }

  test("a degraded pass dissolves nothing, however empty its targets", async () => {
    const cmux = new FakeCmux({ "window-1": ["ws-a"] });
    const provenance = new MemoryRepoGroupProvenanceStore();
    const colors = funnel(cmux);
    const healthy = {
      mirrorGroups: true,
      targetsComplete: true,
      setGroupColor: colors.setGroupColor,
      targets: [target("ws-a", "the-mountain", "#5F7F2A")],
    };
    const created = await own(cmux, provenance, "window-1", "the-mountain", ["ws-a"]);

    /* What the board publishes when a pass misses its deadline: every agent's
       terminal target withdrawn, so the repo walk yields nothing. No workspace
       moved; the collector simply could not say where they are.

       Run it TWICE, past the confirmation counter's threshold, so this test
       fails if the completeness guard is removed. One degraded pass would be
       held back by the counter alone and would prove nothing about this rule. */
    await reconcileRepoGroups({
      runner: cmux,
      provenance,
      inputs: { ...healthy, targetsComplete: false, targets: [] },
    });
    const result = await reconcileRepoGroups({
      runner: cmux,
      provenance,
      inputs: { ...healthy, targetsComplete: false, targets: [] },
    });

    expect(cmux.methodCalls("workspace.group.ungroup")).toEqual([]);
    expect(provenance.list().map((record) => record.groupId)).toEqual([created]);
    expect(cmux.groups.has(created)).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("a degraded pass never evicts a member it cannot vouch for", async () => {
    const cmux = new FakeCmux({ "window-1": ["ws-a", "ws-b"] });
    const provenance = new MemoryRepoGroupProvenanceStore();
    const colors = funnel(cmux);
    const both = [
      target("ws-a", "the-mountain", "#5F7F2A"),
      target("ws-b", "the-mountain", "#5F7F2A"),
    ];
    await own(cmux, provenance, "window-1", "the-mountain", ["ws-a", "ws-b"]);

    /* ws-b's target went missing on a degraded pass. It has not left the repo,
       and evicting it is how a group loses its last real member. */
    await reconcileRepoGroups({
      runner: cmux,
      provenance,
      inputs: { mirrorGroups: true, targetsComplete: false, setGroupColor: colors.setGroupColor, targets: [both[0]!] },
    });

    expect(cmux.methodCalls("workspace.group.remove")).toEqual([]);
    expect(membersOf(cmux, provenance.list()[0]!.groupId)).toEqual(["ws-a", "ws-b"]);
  });

  test("a degraded pass between two healthy ones mints no second anchor row", async () => {
    const cmux = new FakeCmux({ "window-1": ["ws-a"] });
    const provenance = new MemoryRepoGroupProvenanceStore();
    const colors = funnel(cmux);
    const healthy = {
      mirrorGroups: true,
      targetsComplete: true,
      setGroupColor: colors.setGroupColor,
      targets: [target("ws-a", "the-mountain", "#5F7F2A")],
    };

    const first = await own(cmux, provenance, "window-1", "the-mountain", ["ws-a"]);
    /* Two degraded passes, so the confirmation counter alone cannot be what
       saves the group here — this test answers for the completeness guard. */
    for (let pass = 0; pass < 2; pass += 1) {
      await reconcileRepoGroups({
        runner: cmux,
        provenance,
        inputs: { ...healthy, targetsComplete: false, targets: [] },
      });
    }
    await reconcileRepoGroups({ runner: cmux, provenance, inputs: healthy });

    /* The whole defect in one assertion. Every rebuild makes cmux mint a fresh
       anchor workspace it auto-titles "Group N", and that row outlives the
       group forever — nine of them accumulated on 2026-08-13 alone. */
    expect(anchorRows(cmux, "window-1")).toHaveLength(1);
    expect(cmux.methodCalls("workspace.group.create")).toHaveLength(0);
    expect(provenance.list().map((record) => record.groupId)).toEqual([first]);
  });

  test("a repo that comes back between absences keeps its group", async () => {
    const cmux = new FakeCmux({ "window-1": ["ws-a"] });
    const provenance = new MemoryRepoGroupProvenanceStore();
    const colors = funnel(cmux);
    const healthy = {
      mirrorGroups: true,
      targetsComplete: true,
      setGroupColor: colors.setGroupColor,
      targets: [target("ws-a", "the-mountain", "#5F7F2A")],
    };
    const created = await own(cmux, provenance, "window-1", "the-mountain", ["ws-a"]);

    /* Absent, back, absent. The confirmation must count CONSECUTIVE absences;
       a tally that only ever increments would dissolve on the second blip. */
    await reconcileRepoGroups({ runner: cmux, provenance, inputs: { ...healthy, targets: [] } });
    await reconcileRepoGroups({ runner: cmux, provenance, inputs: healthy });
    await reconcileRepoGroups({ runner: cmux, provenance, inputs: { ...healthy, targets: [] } });

    expect(cmux.methodCalls("workspace.group.ungroup")).toEqual([]);
    expect(cmux.groups.has(created)).toBe(true);
  });

  test("mirrors one group per repo, in the window the workspaces live in", async () => {
    const cmux = new FakeCmux({
      "window-1": ["ws-a", "ws-b", "ws-c"],
      "window-2": ["ws-d"],
    });
    const colors = funnel(cmux);
    const provenance = new MemoryRepoGroupProvenanceStore();
    await own(cmux, provenance, "window-1", "the-mountain", [], "#5F7F2A");
    await own(cmux, provenance, "window-1", "cooper-scheduler", [], "#2E66A8");
    await own(cmux, provenance, "window-2", "the-mountain", [], "#5F7F2A");
    const result = await reconcileRepoGroups({
      runner: cmux,
      provenance,
      inputs: {
        mirrorGroups: true,
        targetsComplete: true,
        setGroupColor: colors.setGroupColor,
        targets: [
          target("ws-a", "the-mountain", "#5F7F2A"),
          target("ws-b", "the-mountain", "#5F7F2A"),
          target("ws-c", "cooper-scheduler", "#2E66A8"),
          target("ws-d", "the-mountain", "#5F7F2A"),
        ],
      },
    });

    expect(result.errors).toEqual([]);
    const groups = [...cmux.groups.values()];
    expect(groups.map((group) => `${group.windowId}:${group.name}`).sort()).toEqual([
      "window-1:cooper-scheduler",
      "window-1:the-mountain",
      "window-2:the-mountain",
    ]);
    const mountainInWindowOne = [...cmux.groups.entries()].find(
      ([, group]) => group.name === "the-mountain" && group.windowId === "window-1",
    );
    expect(membersOf(cmux, mountainInWindowOne?.[0] ?? "")).toEqual(["ws-a", "ws-b"]);
    expect(normalizeHex(mountainInWindowOne?.[1].customColor)).toBe("#5f7f2a");
    /* A repo spanning two windows gets a group in EACH window: cmux refuses a
       child workspace that is not in the group's window, so one global group
       would silently drop half the fleet. */
    expect(cmux.groups.get(cmux.groupOf("ws-d") ?? "")?.windowId).toBe("window-2");
    expect(result.filed["the-mountain"]?.sort()).toEqual(["ws-a", "ws-b", "ws-d"]);
    expect(result.groups).toHaveLength(3);
  });

  test("a settled sidebar issues zero mutations on the next pass", async () => {
    const cmux = new FakeCmux({ "window-1": ["ws-a", "ws-b"] });
    const provenance = new MemoryRepoGroupProvenanceStore();
    const colors = funnel(cmux);
    const inputs: RepoGroupInputs = {
      mirrorGroups: true,
      targetsComplete: true,
      setGroupColor: colors.setGroupColor,
      targets: [target("ws-a", "the-mountain", "#5F7F2A"), target("ws-b", "the-mountain", "#5F7F2A")],
    };

    await own(cmux, provenance, "window-1", "the-mountain", ["ws-a", "ws-b"]);
    const first = await reconcileRepoGroups({ runner: cmux, provenance, inputs });
    expect(first.mutations).toBe(0);
    const mutationsAfterFirst = cmux.mutations;
    const writesAfterFirst = colors.writes.length;

    const second = await reconcileRepoGroups({ runner: cmux, provenance, inputs });
    expect(second.errors).toEqual([]);
    expect(second.mutations).toBe(0);
    expect(cmux.mutations).toBe(mutationsAfterFirst);
    expect(colors.writes.length).toBe(writesAfterFirst);
  });

  test("a color that differs only in case is not drift", async () => {
    const cmux = new FakeCmux({ "window-1": ["ws-a"] });
    const provenance = new MemoryRepoGroupProvenanceStore();
    const colors = funnel(cmux);
    const inputs: RepoGroupInputs = {
      mirrorGroups: true,
      targetsComplete: true,
      setGroupColor: colors.setGroupColor,
      targets: [target("ws-a", "the-mountain", "#5f7f2a")],
    };
    await own(cmux, provenance, "window-1", "the-mountain", ["ws-a"], "#5f7f2a");
    /* cmux hands colors back in ITS casing, not ours; comparing raw strings
       reads the same color as drift and turns every pass into a write forever. */
    const group = cmux.groups.get(cmux.groupOf("ws-a") ?? "");
    if (group) group.customColor = "#5F7F2A";

    const second = await reconcileRepoGroups({ runner: cmux, provenance, inputs });
    expect(colors.writes).toHaveLength(0);
    expect(second.mutations).toBe(0);
  });

  test("colors are written only through the funnel", async () => {
    const cmux = new FakeCmux({ "window-1": ["ws-a"] });
    const colors = funnel(cmux);
    const provenance = new MemoryRepoGroupProvenanceStore();
    await own(cmux, provenance, "window-1", "the-mountain", ["ws-a"], "#000000");
    await reconcileRepoGroups({
      runner: cmux,
      provenance,
      inputs: {
        mirrorGroups: true,
        targetsComplete: true,
        setGroupColor: colors.setGroupColor,
        targets: [target("ws-a", "the-mountain", "#5F7F2A")],
      },
    });
    expect(cmux.methodCalls("workspace.group.set_color")).toEqual([]);
    expect(colors.writes.map(({ hex }) => hex)).toEqual(["#5f7f2a"]);
    expect(colors.writes[0]?.reason).toContain("the-mountain");
  });

  test("a funnel that refuses is reported, not swallowed", async () => {
    const cmux = new FakeCmux({ "window-1": ["ws-a"] });
    const colors = funnel(cmux, false);
    const provenance = new MemoryRepoGroupProvenanceStore();
    await own(cmux, provenance, "window-1", "the-mountain", ["ws-a"], "#000000");
    const result = await reconcileRepoGroups({
      runner: cmux,
      provenance,
      inputs: {
        mirrorGroups: true,
        targetsComplete: true,
        setGroupColor: colors.setGroupColor,
        targets: [target("ws-a", "the-mountain", "#5F7F2A")],
      },
    });
    expect(result.errors.join(" ")).toContain("funnel refused");
  });

  test("a failed add never records the workspace as filed", async () => {
    const cmux = new FakeCmux({ "window-1": ["ws-a", "ws-b"] });
    const provenance = new MemoryRepoGroupProvenanceStore();
    const colors = funnel(cmux);
    await own(cmux, provenance, "window-1", "the-mountain", ["ws-a"]);
    cmux.failures.set("workspace.group.add", "not_found: workspace not found");

    const result = await reconcileRepoGroups({
      runner: cmux,
      provenance,
      inputs: {
        mirrorGroups: true,
        targetsComplete: true,
        setGroupColor: colors.setGroupColor,
        targets: [
          target("ws-a", "the-mountain", "#5F7F2A"),
          target("ws-b", "the-mountain", "#5F7F2A"),
        ],
      },
    });
    expect(result.errors.join(" ")).toContain("workspace.group.add exited 1");
    expect(result.filed["the-mountain"]).toEqual(["ws-a"]);
  });

  test("a repo with nothing left in the window loses its group, workspaces kept", async () => {
    const cmux = new FakeCmux({ "window-1": ["ws-a"] });
    const provenance = new MemoryRepoGroupProvenanceStore();
    const colors = funnel(cmux);
    await own(cmux, provenance, "window-1", "the-mountain", ["ws-a"]);
    expect(cmux.groups.size).toBe(1);

    /* One absent pass is not enough. A single sample is exactly what a degraded
       collector produces, and acting on it is what filled the sidebar with
       "Group N" rows, so the first absence only arms the teardown. */
    const armed = await reconcileRepoGroups({
      runner: cmux,
      provenance,
      inputs: { mirrorGroups: true, targetsComplete: true, setGroupColor: colors.setGroupColor, targets: [] },
    });
    expect(cmux.groups.size).toBe(1);
    expect(armed.errors).toEqual([]);

    const result = await reconcileRepoGroups({
      runner: cmux,
      provenance,
      inputs: { mirrorGroups: true, targetsComplete: true, setGroupColor: colors.setGroupColor, targets: [] },
    });
    expect(cmux.groups.size).toBe(0);
    expect(provenance.list()).toEqual([]);
    /* Dissolved, never deleted: cmux's `group.delete` CLOSES the member
       workspaces, which would take an operator's running agent with it. */
    expect(cmux.methodCalls("workspace.group.ungroup")).toHaveLength(1);
    expect(result.errors).toEqual([]);
    /* The workspace survives the teardown. cmux keeps the anchor row it made
       for the group, which the operator can close — dissolving must never
       close a workspace. */
    expect(cmux.windows.get("window-1")).toContain("ws-a");
  });

  test("flag off dissolves our groups and leaves the operator's alone", async () => {
    const cmux = new FakeCmux({ "window-1": ["ws-a", "ws-mine"] });
    cmux.seedGroup("user-group", {
      windowId: "window-1",
      /* Named exactly like a repo on purpose: provenance is the ids we recorded,
         never a name that looks like ours. */
      name: "the-mountain",
      customColor: "#123456",
      members: ["ws-mine"],
    });
    const provenance = new MemoryRepoGroupProvenanceStore();
    const colors = funnel(cmux);
    await own(cmux, provenance, "window-1", "the-mountain", ["ws-a"]);
    expect(cmux.groups.size).toBe(2);

    const result = await reconcileRepoGroups({
      runner: cmux,
      provenance,
      inputs: {
        mirrorGroups: false,
        targetsComplete: true,
        setGroupColor: colors.setGroupColor,
        targets: [target("ws-a", "the-mountain", "#5F7F2A")],
      },
    });
    expect(result.disabled).toBe(true);
    expect([...cmux.groups.keys()]).toEqual(["user-group"]);
    expect(cmux.groups.get("user-group")?.members).toEqual(["ws-mine"]);
    expect(cmux.groups.get("user-group")?.customColor).toBe("#123456");
    expect(provenance.list()).toEqual([]);
  });

  test("a group the operator made is never annexed, renamed or colored", async () => {
    const cmux = new FakeCmux({ "window-1": ["ws-a", "ws-mine"] });
    cmux.seedGroup("user-group", {
      windowId: "window-1",
      name: "the-mountain",
      customColor: "#123456",
      members: ["ws-mine"],
    });
    const colors = funnel(cmux);
    await reconcileRepoGroups({
      runner: cmux,
      provenance: new MemoryRepoGroupProvenanceStore(),
      inputs: {
        mirrorGroups: true,
        targetsComplete: true,
        setGroupColor: colors.setGroupColor,
        targets: [target("ws-a", "the-mountain", "#5F7F2A")],
      },
    });
    expect(cmux.groups.get("user-group")).toEqual({
      windowId: "window-1",
      name: "the-mountain",
      customColor: "#123456",
      members: ["ws-mine"],
    });
    expect(colors.writes.every(({ groupId }) => groupId !== "user-group")).toBe(true);
    expect(cmux.methodCalls("workspace.group.rename").every((params) => params.group_id !== "user-group")).toBe(true);
  });

  test("a new window does not get a minted repo folder for a targeted workspace", async () => {
    /* Drag orch into a fresh window. The first fix left those panes
       "ungrouped", so the next tick created a repo folder, named it, painted
       it, and ate the operator group. We only maintain groups we already
       recorded for that window. */
    const cmux = new FakeCmux({ "window-new": ["ws-orch"] });
    const result = await reconcileRepoGroups({
      runner: cmux,
      provenance: new MemoryRepoGroupProvenanceStore(),
      inputs: {
        mirrorGroups: true,
        targetsComplete: true,
        setGroupColor: funnel(cmux).setGroupColor,
        targets: [target("ws-orch", "example-repo", "#d70ae6")],
      },
    });
    expect(cmux.methodCalls("workspace.group.create")).toEqual([]);
    expect(cmux.groups.size).toBe(0);
    expect(result.mutations).toBe(0);
    expect(result.groups).toEqual([]);
  });

  test("a targeted workspace already in an operator group is not stolen into the repo group", async () => {
    /* TINT-G used to file every repo-mapped workspace, including lanes the
       operator already parked. create/add then pulled those members out of
       the operator folder. Stealing members is the same annexation as
       renaming an operator group. */
    const cmux = new FakeCmux({ "window-1": ["ws-loose", "ws-program"] });
    cmux.seedGroup("ant-program", {
      windowId: "window-1",
      name: "ANT · example-program",
      customColor: "#5F7F2A",
      members: ["ws-program"],
    });
    const provenance = new MemoryRepoGroupProvenanceStore();
    const colors = funnel(cmux);
    const ours = await own(cmux, provenance, "window-1", "example-repo", ["ws-loose"], "#d70ae6");
    await reconcileRepoGroups({
      runner: cmux,
      provenance,
      inputs: {
        mirrorGroups: true,
        targetsComplete: true,
        setGroupColor: colors.setGroupColor,
        targets: [
          target("ws-loose", "example-repo", "#d70ae6"),
          target("ws-program", "example-repo", "#d70ae6"),
        ],
      },
    });

    expect(cmux.groups.get("ant-program")).toEqual({
      windowId: "window-1",
      name: "ANT · example-program",
      customColor: "#5F7F2A",
      members: ["ws-program"],
    });
    expect(cmux.methodCalls("workspace.group.create").flatMap((params) =>
      (params.child_workspace_ids as string[] | undefined) ?? [])).not.toContain("ws-program");
    expect(cmux.methodCalls("workspace.group.add").every((params) =>
      params.workspace_id !== "ws-program")).toBe(true);
    expect(membersOf(cmux, ours)).toEqual(["ws-loose"]);
  });

  test("an already-mirrored repo group does not later add a workspace the operator grouped", async () => {
    const cmux = new FakeCmux({ "window-1": ["ws-loose", "ws-program"] });
    const provenance = new MemoryRepoGroupProvenanceStore();
    const colors = funnel(cmux);
    await own(cmux, provenance, "window-1", "example-repo", ["ws-loose"], "#d70ae6");
    cmux.seedGroup("ant-program", {
      windowId: "window-1",
      name: "ANT · example-program",
      customColor: "#5F7F2A",
      members: ["ws-program"],
    });
    cmux.calls.length = 0;

    const second = await reconcileRepoGroups({
      runner: cmux,
      provenance,
      inputs: {
        mirrorGroups: true,
        targetsComplete: true,
        setGroupColor: colors.setGroupColor,
        targets: [
          target("ws-loose", "example-repo", "#d70ae6"),
          target("ws-program", "example-repo", "#d70ae6"),
        ],
      },
    });

    expect(second.mutations).toBe(0);
    expect(cmux.groups.get("ant-program")?.members).toEqual(["ws-program"]);
    expect(membersOf(cmux, provenance.list()[0]!.groupId)).toEqual(["ws-loose"]);
    expect(cmux.methodCalls("workspace.group.add")).toEqual([]);
  });

  test("does not mint a competing repo group when every targeted workspace already sits in an operator group", async () => {
    const cmux = new FakeCmux({ "window-1": ["ws-a", "ws-b"] });
    cmux.seedGroup("ant-program", {
      windowId: "window-1",
      name: "ANT · example-program",
      customColor: "#5F7F2A",
      members: ["ws-a", "ws-b"],
    });
    const provenance = new MemoryRepoGroupProvenanceStore();
    const result = await reconcileRepoGroups({
      runner: cmux,
      provenance,
      inputs: {
        mirrorGroups: true,
        targetsComplete: true,
        setGroupColor: funnel(cmux).setGroupColor,
        targets: [
          target("ws-a", "example-repo", "#d70ae6"),
          target("ws-b", "example-repo", "#d70ae6"),
        ],
      },
    });
    expect(result.mutations).toBe(0);
    expect(provenance.list()).toEqual([]);
    expect([...cmux.groups.keys()]).toEqual(["ant-program"]);
    expect(cmux.methodCalls("workspace.group.create")).toEqual([]);
  });

  test("a workspace that left the repo is removed from our group only", async () => {
    const cmux = new FakeCmux({ "window-1": ["ws-a", "ws-b"] });
    const provenance = new MemoryRepoGroupProvenanceStore();
    const colors = funnel(cmux);
    const both: RepoGroupTarget[] = [
      target("ws-a", "the-mountain", "#5F7F2A"),
      target("ws-b", "the-mountain", "#5F7F2A"),
    ];
    await own(cmux, provenance, "window-1", "the-mountain", ["ws-a", "ws-b"]);

    await reconcileRepoGroups({
      runner: cmux,
      provenance,
      inputs: { mirrorGroups: true, targetsComplete: true, setGroupColor: colors.setGroupColor, targets: [both[0]!] },
    });
    expect(membersOf(cmux, provenance.list()[0]!.groupId)).toEqual(["ws-a"]);
    expect(cmux.methodCalls("workspace.group.remove")).toEqual([{ workspace_id: "ws-b" }]);
  });

  test("a window whose group list failed keeps its provenance", async () => {
    const cmux = new FakeCmux({ "window-1": ["ws-a"] });
    const provenance = new MemoryRepoGroupProvenanceStore();
    const colors = funnel(cmux);
    const inputs: RepoGroupInputs = {
      mirrorGroups: true,
      targetsComplete: true,
      setGroupColor: colors.setGroupColor,
      targets: [target("ws-a", "the-mountain", "#5F7F2A")],
    };
    const recordedId = await own(cmux, provenance, "window-1", "the-mountain", ["ws-a"]);
    const recorded = provenance.list().find((row) => row.groupId === recordedId)!;

    cmux.failures.set("workspace.group.list", "socket timeout");
    const result = await reconcileRepoGroups({ runner: cmux, provenance, inputs });
    /* Unreadable is not empty. Forgetting here would orphan a real group in the
       sidebar with nothing left that knows we made it. */
    expect(provenance.list()).toEqual([recorded]);
    expect(result.errors.join(" ")).toContain("workspace.group.list exited 1");
    expect(result.mutations).toBe(0);
  });

  test("cmux missing is absent, not an error", async () => {
    const runner: CommandRunner = {
      run: async () => ({
        exitCode: -1,
        stdout: "",
        stderr: 'Executable not found in $PATH: "cmux"',
        timedOut: false,
      }),
    };
    const result = await reconcileRepoGroups({
      runner,
      provenance: new MemoryRepoGroupProvenanceStore(),
      inputs: { mirrorGroups: true, targetsComplete: true, setGroupColor: async () => true, targets: [] },
    });
    expect(result.absent).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("the anchor row is never removed, so the group survives the next pass", async () => {
    const cmux = new FakeCmux({ "window-1": ["ws-a"] });
    const provenance = new MemoryRepoGroupProvenanceStore();
    const colors = funnel(cmux);
    const inputs: RepoGroupInputs = {
      mirrorGroups: true,
      targetsComplete: true,
      setGroupColor: colors.setGroupColor,
      targets: [target("ws-a", "the-mountain", "#5F7F2A")],
    };
    const groupId = await own(cmux, provenance, "window-1", "the-mountain", ["ws-a"]);
    const anchor = cmux.groups.get(groupId)?.anchorWorkspaceId;
    expect(anchor).toBeTruthy();

    /* The anchor is a member the board never maps, so a naive membership diff
       removes it — and removing it takes the group with it, which the next pass
       reads as "no group" and rebuilds. That is a create/destroy loop, not a
       reconcile. */
    const second = await reconcileRepoGroups({ runner: cmux, provenance, inputs });
    expect(second.mutations).toBe(0);
    expect(cmux.methodCalls("workspace.group.remove")).toEqual([]);
    expect(cmux.groups.has(groupId)).toBe(true);
    expect(membersOf(cmux, groupId)).toEqual(["ws-a"]);
  });

  test("an anchor mapped to another repo is never filed into that repo's group", async () => {
    const cmux = new FakeCmux({ "window-1": ["ws-a", "ws-b"] });
    const provenance = new MemoryRepoGroupProvenanceStore();
    const colors = funnel(cmux);
    const mountainGroupId = await own(cmux, provenance, "window-1", "the-mountain", ["ws-a"]);
    await own(cmux, provenance, "window-1", "cooper-scheduler", [], "#2E66A8");
    const anchor = cmux.groups.get(mountainGroupId)!.anchorWorkspaceId!;

    /* An anchor inherits its group's cwd, so the board maps it to a repo like
       any other workspace. Filing it elsewhere would dissolve the group it
       heads. */
    const result = await reconcileRepoGroups({
      runner: cmux,
      provenance,
      inputs: {
        mirrorGroups: true,
        targetsComplete: true,
        setGroupColor: colors.setGroupColor,
        targets: [
          target("ws-a", "the-mountain", "#5F7F2A"),
          target("ws-b", "cooper-scheduler", "#2E66A8"),
          target(anchor, "cooper-scheduler", "#2E66A8"),
        ],
      },
    });
    expect(cmux.groups.has(mountainGroupId)).toBe(true);
    expect(cmux.groups.get(mountainGroupId)?.members).toContain(anchor);
    expect(cmux.methodCalls("workspace.group.add").some((params) => params.workspace_id === anchor)).toBe(false);
    expect(result.filed["cooper-scheduler"]).toEqual(["ws-b"]);
  });
});

describe("repoGroupReconcileTick", () => {
  test("does nothing, and touches no cmux, until inputs are registered", async () => {
    resetRepoGroupRegistrationForTests();
    const cmux = new FakeCmux({ "window-1": ["ws-a"] });
    expect(await repoGroupReconcileTick(cmux)).toBeNull();
    expect(cmux.calls).toEqual([]);
  });

  test("runs the registered inputs once wired", async () => {
    resetRepoGroupRegistrationForTests();
    const cmux = new FakeCmux({ "window-1": ["ws-a"] });
    const colors = funnel(cmux);
    const provenance = new MemoryRepoGroupProvenanceStore();
    await own(cmux, provenance, "window-1", "the-mountain", ["ws-a"]);
    registerRepoGroupInputs(() => ({
      mirrorGroups: true,
      targetsComplete: true,
      setGroupColor: colors.setGroupColor,
      targets: [target("ws-a", "the-mountain", "#5F7F2A")],
    }), provenance);
    const result = await repoGroupReconcileTick(cmux);
    expect(result?.errors).toEqual([]);
    expect([...cmux.groups.values()][0]?.name).toBe("the-mountain");
    resetRepoGroupRegistrationForTests();
  });

  test("disposing an older registration cannot unregister a newer writer", async () => {
    resetRepoGroupRegistrationForTests();
    const cmux = new FakeCmux({ "window-1": [] });
    const colors = funnel(cmux);
    const disposeOlder = registerRepoGroupInputs(() => ({
      mirrorGroups: true,
      targetsComplete: true,
      setGroupColor: colors.setGroupColor,
      targets: [],
    }), new MemoryRepoGroupProvenanceStore());
    registerRepoGroupInputs(() => ({
      mirrorGroups: false,
      targetsComplete: true,
      setGroupColor: colors.setGroupColor,
      targets: [],
    }), new MemoryRepoGroupProvenanceStore());

    disposeOlder();
    expect((await repoGroupReconcileTick(cmux))?.disabled).toBe(true);
    resetRepoGroupRegistrationForTests();
  });
});
