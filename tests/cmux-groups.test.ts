import { describe, expect, test } from "bun:test";
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
  members: string[];
}

/* A cmux that behaves the way the real one did on 2026-08-13, verified by hand
   against cmux's own group RPCs: groups belong to a window, `create` names the
   group itself ("Group N") and takes no name, `add` moves a workspace out of
   whatever group it was in, and `remove` resolves the group from the workspace.
   Modelling those four facts is the whole point — a fixture that just records
   calls would pass while the module reconciled against a cmux that does not
   exist. */
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
        this.nextGroup += 1;
        this.groups.set(id, { windowId, name, customColor: null, members: [...children] });
        return {
          group: { id, name, custom_color: null, member_workspace_ids: [...children] },
        };
      }
      case "workspace.group.add": {
        const group = this.groups.get(groupId);
        if (!group) throw new Error("Group or workspace not found");
        this.detach(workspaceId);
        group.members.push(workspaceId);
        return { group_id: groupId, workspace_id: workspaceId };
      }
      case "workspace.group.remove":
        this.detach(workspaceId);
        return { workspace_id: workspaceId };
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

function target(workspaceId: string, repoKey: string, hex: string): RepoGroupTarget {
  return { workspaceId, repoKey, hex };
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
  test("mirrors one group per repo, in the window the workspaces live in", async () => {
    const cmux = new FakeCmux({
      "window-1": ["ws-a", "ws-b", "ws-c"],
      "window-2": ["ws-d"],
    });
    const colors = funnel(cmux);
    const result = await reconcileRepoGroups({
      runner: cmux,
      provenance: new MemoryRepoGroupProvenanceStore(),
      inputs: {
        mirrorGroups: true,
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
    const mountainInWindowOne = groups.find(
      (group) => group.name === "the-mountain" && group.windowId === "window-1",
    );
    expect(mountainInWindowOne?.members.sort()).toEqual(["ws-a", "ws-b"]);
    expect(mountainInWindowOne?.customColor).toBe("#5f7f2a");
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
      setGroupColor: colors.setGroupColor,
      targets: [target("ws-a", "the-mountain", "#5F7F2A"), target("ws-b", "the-mountain", "#5F7F2A")],
    };

    const first = await reconcileRepoGroups({ runner: cmux, provenance, inputs });
    expect(first.mutations).toBeGreaterThan(0);
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
      setGroupColor: colors.setGroupColor,
      targets: [target("ws-a", "the-mountain", "#5f7f2a")],
    };
    await reconcileRepoGroups({ runner: cmux, provenance, inputs });
    /* cmux hands colors back in ITS casing, not ours; comparing raw strings
       reads the same color as drift and turns every pass into a write forever. */
    const group = cmux.groups.get(cmux.groupOf("ws-a") ?? "");
    if (group) group.customColor = "#5F7F2A";

    const second = await reconcileRepoGroups({ runner: cmux, provenance, inputs });
    expect(colors.writes).toHaveLength(1);
    expect(second.mutations).toBe(0);
  });

  test("colors are written only through the funnel", async () => {
    const cmux = new FakeCmux({ "window-1": ["ws-a"] });
    const colors = funnel(cmux);
    await reconcileRepoGroups({
      runner: cmux,
      provenance: new MemoryRepoGroupProvenanceStore(),
      inputs: {
        mirrorGroups: true,
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
    const result = await reconcileRepoGroups({
      runner: cmux,
      provenance: new MemoryRepoGroupProvenanceStore(),
      inputs: {
        mirrorGroups: true,
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
    await reconcileRepoGroups({
      runner: cmux,
      provenance,
      inputs: {
        mirrorGroups: true,
        setGroupColor: colors.setGroupColor,
        targets: [target("ws-a", "the-mountain", "#5F7F2A")],
      },
    });
    cmux.failures.set("workspace.group.add", "not_found: workspace not found");

    const result = await reconcileRepoGroups({
      runner: cmux,
      provenance,
      inputs: {
        mirrorGroups: true,
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
    await reconcileRepoGroups({
      runner: cmux,
      provenance,
      inputs: {
        mirrorGroups: true,
        setGroupColor: colors.setGroupColor,
        targets: [target("ws-a", "the-mountain", "#5F7F2A")],
      },
    });
    expect(cmux.groups.size).toBe(1);

    const result = await reconcileRepoGroups({
      runner: cmux,
      provenance,
      inputs: { mirrorGroups: true, setGroupColor: colors.setGroupColor, targets: [] },
    });
    expect(cmux.groups.size).toBe(0);
    expect(provenance.list()).toEqual([]);
    /* Dissolved, never deleted: cmux's `group.delete` CLOSES the member
       workspaces, which would take an operator's running agent with it. */
    expect(cmux.methodCalls("workspace.group.ungroup")).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(cmux.windows.get("window-1")).toEqual(["ws-a"]);
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
    await reconcileRepoGroups({
      runner: cmux,
      provenance,
      inputs: {
        mirrorGroups: true,
        setGroupColor: colors.setGroupColor,
        targets: [target("ws-a", "the-mountain", "#5F7F2A")],
      },
    });
    expect(cmux.groups.size).toBe(2);

    const result = await reconcileRepoGroups({
      runner: cmux,
      provenance,
      inputs: {
        mirrorGroups: false,
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

  test("a workspace that left the repo is removed from our group only", async () => {
    const cmux = new FakeCmux({ "window-1": ["ws-a", "ws-b"] });
    const provenance = new MemoryRepoGroupProvenanceStore();
    const colors = funnel(cmux);
    const both: RepoGroupTarget[] = [
      target("ws-a", "the-mountain", "#5F7F2A"),
      target("ws-b", "the-mountain", "#5F7F2A"),
    ];
    await reconcileRepoGroups({
      runner: cmux,
      provenance,
      inputs: { mirrorGroups: true, setGroupColor: colors.setGroupColor, targets: both },
    });

    await reconcileRepoGroups({
      runner: cmux,
      provenance,
      inputs: { mirrorGroups: true, setGroupColor: colors.setGroupColor, targets: [both[0]!] },
    });
    expect(cmux.groups.get(provenance.list()[0]!.groupId)?.members).toEqual(["ws-a"]);
    expect(cmux.methodCalls("workspace.group.remove")).toEqual([{ workspace_id: "ws-b" }]);
  });

  test("a window whose group list failed keeps its provenance", async () => {
    const cmux = new FakeCmux({ "window-1": ["ws-a"] });
    const provenance = new MemoryRepoGroupProvenanceStore();
    const colors = funnel(cmux);
    const inputs: RepoGroupInputs = {
      mirrorGroups: true,
      setGroupColor: colors.setGroupColor,
      targets: [target("ws-a", "the-mountain", "#5F7F2A")],
    };
    await reconcileRepoGroups({ runner: cmux, provenance, inputs });
    const recorded = provenance.list()[0]!;

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
      inputs: { mirrorGroups: true, setGroupColor: async () => true, targets: [] },
    });
    expect(result.absent).toBe(true);
    expect(result.errors).toEqual([]);
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
    registerRepoGroupInputs(() => ({
      mirrorGroups: true,
      setGroupColor: colors.setGroupColor,
      targets: [target("ws-a", "the-mountain", "#5F7F2A")],
    }), new MemoryRepoGroupProvenanceStore());
    const result = await repoGroupReconcileTick(cmux);
    expect(result?.errors).toEqual([]);
    expect([...cmux.groups.values()][0]?.name).toBe("the-mountain");
    resetRepoGroupRegistrationForTests();
  });
});
