import { describe, expect, test } from "bun:test";
import {
  collectCmuxWorkspaceColors,
  latestWorkspaceColors,
  loadColorRuntime,
  normalizeHex,
  parseCmuxGroupAnchorIds,
  parseCmuxWindowIds,
  parseCmuxWorkspaceColors,
  reconcileWorkspaceColors,
  repoColorsSettingsFrom,
  resetColorSyncState,
  syncCmuxColors,
  workspaceRepoKeys,
  type ColorFunnel,
  type ColorRuntime,
  type WorkspaceColorObservation,
} from "../src/server/cmux-color-sync";
import { parseCmuxSidebarSnapshot } from "../src/server/cmux";
import type { RepoColorsSettings } from "../src/shared/repo-color";
import type { CmuxSurface, CommandRunner } from "../src/server/types";

/* Measured against live cmux 2026-08-13: a set-color write is echoed back
   UPPERCASED (`--color "#2e66a8"` reads back "#2E66A8"), a named color resolves
   to a hex, and clear-color reads back as null. The fixtures below use that
   shape rather than an idealized one. */

interface FunnelSpy {
  funnel: ColorFunnel;
  writes: { workspaceId: string; hex: string; reason: string }[];
}

function funnelSpy(options: {
  alreadyWritten?: Record<string, string>;
  fail?: boolean;
  throws?: boolean;
} = {}): FunnelSpy {
  const writes: FunnelSpy["writes"] = [];
  const written = new Map(Object.entries(options.alreadyWritten ?? {}));
  return {
    writes,
    funnel: {
      async setWorkspaceColor(workspaceId, hex, reason) {
        if (options.throws) throw new Error("cmux refused the write");
        writes.push({ workspaceId, hex, reason });
        if (options.fail) return false;
        written.set(workspaceId, hex);
        return true;
      },
      lastWrittenHex: (workspaceId) => written.get(workspaceId) ?? null,
    },
  };
}

/* Stands in for TINT-F's repoKeyForCwd: the last path segment that looks like a
   repo, so `~/Developer/the-mountain.worktrees/tint-s` and `~/Developer/the-mountain`
   collapse to one key the way the real one collapses worktrees. */
function repoKeyForCwd(cwd: string): string | null {
  if (cwd.includes("the-mountain")) return "the-mountain";
  if (cwd.includes("cooper-scheduler")) return "cooper-scheduler";
  if (cwd.includes("elio")) return "elio";
  return null;
}

function runtimeWith(funnel: ColorFunnel): ColorRuntime {
  return { repoKeyForCwd, funnel };
}

function settings(
  assignments: RepoColorsSettings["assignments"],
  overrides: Partial<RepoColorsSettings> = {},
): RepoColorsSettings {
  return { assignments, mirrorGroups: true, syncFromCmux: true, ...overrides };
}

function assignment(repoKey: string, hex: string, source: "auto" | "user" = "auto") {
  return { repoKey, hex, slot: null, source };
}

function observation(
  workspaceId: string,
  customColor: string | null,
  extra: Partial<WorkspaceColorObservation> = {},
): WorkspaceColorObservation {
  return { workspaceId, customColor, ...extra };
}

function surface(workspaceId: string, cwd: string, surfaceId = `${workspaceId}-${cwd}`): CmuxSurface {
  return { surfaceId, workspaceId, cwd, sourceSessionIds: [] };
}

describe("normalizeHex — one color has one spelling", () => {
  test("case, shorthand and the missing hash all collapse to one value", () => {
    // The live measurement: we send lowercase, cmux stores uppercase. If these
    // two ever compare unequal, every poll re-asserts and the write loop is on.
    expect(normalizeHex("#2E66A8")).toBe(normalizeHex("#2e66a8"));
    expect(normalizeHex("2E66A8")).toBe("#2e66a8");
    expect(normalizeHex("#abc")).toBe("#aabbcc");
  });

  test("no color, blank and junk are all absent rather than black", () => {
    expect(normalizeHex(null)).toBeNull();
    expect(normalizeHex(undefined)).toBeNull();
    expect(normalizeHex("   ")).toBeNull();
    expect(normalizeHex("Amber")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
  });
});

describe("parsing cmux window and workspace responses", () => {
  test("window ids come from window.list and are deduplicated", () => {
    const output = JSON.stringify({
      windows: [
        { id: "WINDOW-1", index: 0, workspace_count: 6 },
        { id: "WINDOW-2", index: 1, workspace_count: 10 },
        { id: "WINDOW-2", index: 1 },
        { index: 2 },
      ],
    });
    expect(parseCmuxWindowIds(output)).toEqual(["WINDOW-1", "WINDOW-2"]);
  });

  test("a response without a windows array is a failure, not an empty fleet", () => {
    expect(() => parseCmuxWindowIds(JSON.stringify({ result: {} }))).toThrow(/windows array/);
  });

  test("an explicit null color is no color, and a missing field is not black", () => {
    const output = JSON.stringify({
      window_id: "WINDOW-1",
      workspaces: [
        { id: "WS-COLORED", custom_color: "#1A5276", current_directory: "/Users/e/Developer/the-mountain-main" },
        { id: "WS-CLEARED", custom_color: null },
        { id: "WS-SILENT" },
        { custom_color: "#FFFFFF" },
      ],
    });
    expect(parseCmuxWorkspaceColors(output)).toEqual([
      {
        workspaceId: "WS-COLORED",
        customColor: "#1A5276",
        currentDirectory: "/Users/e/Developer/the-mountain-main",
        windowId: "WINDOW-1",
      },
      { workspaceId: "WS-CLEARED", customColor: null, windowId: "WINDOW-1" },
      { workspaceId: "WS-SILENT", customColor: null, windowId: "WINDOW-1" },
    ]);
  });
});

describe("parseCmuxGroupAnchorIds — the only way to know a header from a workspace", () => {
  test("names each group's anchor and deduplicates", () => {
    // Verified live 2026-08-13: workspace.group.create makes an anchor
    // workspace that appears in workspace.list with the group's cwd and NO
    // field of its own to mark it. group.list is the only witness.
    const output = JSON.stringify({
      groups: [
        {
          id: "GROUP-1",
          name: "the-mountain",
          anchor_workspace_id: "WS-ANCHOR",
          member_workspace_ids: ["WS-ANCHOR", "WS-REAL"],
        },
        { id: "GROUP-2", anchor_workspace_id: "WS-ANCHOR" },
        { id: "GROUP-3" },
      ],
    });
    expect(parseCmuxGroupAnchorIds(output)).toEqual(["WS-ANCHOR"]);
  });

  test("a window with no groups has no anchors, and a malformed answer is a failure", () => {
    expect(parseCmuxGroupAnchorIds(JSON.stringify({ groups: [] }))).toEqual([]);
    expect(() => parseCmuxGroupAnchorIds(JSON.stringify({ window_id: "W" }))).toThrow(/groups array/);
  });
});

describe("collectCmuxWorkspaceColors — coverage is every window, not the key one", () => {
  function runnerFor(responses: Record<string, { stdout?: string; exitCode?: number; stderr?: string }>): {
    runner: CommandRunner;
    commands: string[][];
  } {
    const commands: string[][] = [];
    return {
      commands,
      runner: {
        run: async (command) => {
          commands.push([...command]);
          const key = command.slice(1).join(" ");
          const response = responses[key];
          if (!response) return { exitCode: 1, stdout: "", stderr: `no fixture for ${key}`, timedOut: false };
          return {
            exitCode: response.exitCode ?? 0,
            stdout: response.stdout ?? "",
            stderr: response.stderr ?? "",
            timedOut: false,
          };
        },
      },
    };
  }

  const windowList = JSON.stringify({ windows: [{ id: "WINDOW-1" }, { id: "WINDOW-2" }] });
  const noGroups = JSON.stringify({ groups: [] });

  test("reads every window, so a second window's colors cannot go unseen", async () => {
    // The defect this guards: `extension.sidebar.snapshot {"all_windows":true}`
    // answers with ONE window. Measured on this machine it hid six workspaces,
    // one of them carrying a hand-set color, from the board entirely.
    const { runner, commands } = runnerFor({
      "rpc window.list {}": { stdout: windowList },
      [`rpc workspace.list {"window_id":"WINDOW-1"}`]: {
        stdout: JSON.stringify({
          window_id: "WINDOW-1",
          workspaces: [{ id: "WS-A", custom_color: "#1A5276" }],
        }),
      },
      [`rpc workspace.group.list {"window_id":"WINDOW-1"}`]: { stdout: noGroups },
      [`rpc workspace.list {"window_id":"WINDOW-2"}`]: {
        stdout: JSON.stringify({
          window_id: "WINDOW-2",
          workspaces: [{ id: "WS-B", custom_color: null }],
        }),
      },
      [`rpc workspace.group.list {"window_id":"WINDOW-2"}`]: { stdout: noGroups },
    });

    const result = await collectCmuxWorkspaceColors(runner, "cmux");

    expect(result.errors).toEqual([]);
    expect(result.value.map((entry) => entry.workspaceId).sort()).toEqual(["WS-A", "WS-B"]);
    expect(result.anchorWorkspaceIds).toEqual([]);
    expect(commands).toHaveLength(5);
  });

  test("a group anchor never reaches the board, even wearing a repo cwd", async () => {
    /* With mirrorGroups on, every repo group contributes one anchor workspace
       that carries the group's cwd and is otherwise indistinguishable from real
       work. Collected, it becomes a phantom repo-mapped row — the exact defect
       class this board has been burned by before. */
    const { runner } = runnerFor({
      "rpc window.list {}": { stdout: JSON.stringify({ windows: [{ id: "WINDOW-1" }] }) },
      [`rpc workspace.list {"window_id":"WINDOW-1"}`]: {
        stdout: JSON.stringify({
          window_id: "WINDOW-1",
          workspaces: [
            {
              id: "WS-ANCHOR",
              custom_color: null,
              current_directory: "/Users/e/Developer/the-mountain",
            },
            {
              id: "WS-REAL",
              custom_color: "#5F7F2A",
              current_directory: "/Users/e/Developer/the-mountain",
            },
          ],
        }),
      },
      [`rpc workspace.group.list {"window_id":"WINDOW-1"}`]: {
        stdout: JSON.stringify({
          groups: [{
            id: "GROUP-1",
            anchor_workspace_id: "WS-ANCHOR",
            member_workspace_ids: ["WS-ANCHOR", "WS-REAL"],
          }],
        }),
      },
    });

    const result = await collectCmuxWorkspaceColors(runner, "cmux");

    expect(result.value.map((entry) => entry.workspaceId)).toEqual(["WS-REAL"]);
    expect(result.anchorWorkspaceIds).toEqual(["WS-ANCHOR"]);
    expect(result.errors).toEqual([]);
  });

  test("a window whose groups cannot be read is skipped whole rather than guessed at", async () => {
    /* Without the group list there is no way to tell an anchor from a
       workspace, and the failure mode of guessing is painting a phantom. */
    const { runner } = runnerFor({
      "rpc window.list {}": { stdout: windowList },
      [`rpc workspace.list {"window_id":"WINDOW-1"}`]: {
        stdout: JSON.stringify({ window_id: "WINDOW-1", workspaces: [{ id: "WS-A", custom_color: "#1A5276" }] }),
      },
      [`rpc workspace.group.list {"window_id":"WINDOW-1"}`]: { exitCode: 4, stderr: "group service down" },
      [`rpc workspace.list {"window_id":"WINDOW-2"}`]: {
        stdout: JSON.stringify({ window_id: "WINDOW-2", workspaces: [{ id: "WS-B", custom_color: "#0E9494" }] }),
      },
      [`rpc workspace.group.list {"window_id":"WINDOW-2"}`]: { stdout: noGroups },
    });

    const result = await collectCmuxWorkspaceColors(runner, "cmux");

    expect(result.value.map((entry) => entry.workspaceId)).toEqual(["WS-B"]);
    expect(result.errors).toEqual([
      "cmux group discovery for window WINDOW-1 exited 4: group service down; its workspaces were skipped",
    ]);
  });

  test("a missing cmux binary is absent, not a fault", async () => {
    const runner: CommandRunner = {
      run: async () => ({
        exitCode: -1,
        stdout: "",
        stderr: 'Executable not found in $PATH: "cmux"',
        timedOut: false,
      }),
    };
    await expect(collectCmuxWorkspaceColors(runner, "cmux")).resolves.toEqual({
      value: [],
      errors: [],
      anchorWorkspaceIds: [],
      absent: true,
    });
  });

  test("one window failing reports the gap and still reconciles what was read", async () => {
    const { runner } = runnerFor({
      "rpc window.list {}": { stdout: windowList },
      [`rpc workspace.list {"window_id":"WINDOW-1"}`]: {
        stdout: JSON.stringify({ window_id: "WINDOW-1", workspaces: [{ id: "WS-A", custom_color: "#1A5276" }] }),
      },
      [`rpc workspace.group.list {"window_id":"WINDOW-1"}`]: { stdout: noGroups },
      [`rpc workspace.list {"window_id":"WINDOW-2"}`]: { exitCode: 3, stderr: "window vanished" },
      [`rpc workspace.group.list {"window_id":"WINDOW-2"}`]: { stdout: noGroups },
    });

    const result = await collectCmuxWorkspaceColors(runner, "cmux");

    expect(result.value.map((entry) => entry.workspaceId)).toEqual(["WS-A"]);
    expect(result.errors).toEqual([
      "cmux workspace color discovery for window WINDOW-2 exited 3: window vanished",
    ]);
  });

  test("a window enumeration failure yields no observations rather than a partial fleet", async () => {
    const { runner } = runnerFor({ "rpc window.list {}": { exitCode: 2, stderr: "socket closed" } });
    const result = await collectCmuxWorkspaceColors(runner, "cmux");
    expect(result.value).toEqual([]);
    expect(result.errors).toEqual(["cmux window discovery exited 2: socket closed"]);
  });
});

describe("reconcile — a group anchor is untouchable", () => {
  test("an anchor whose color drifts still produces zero actions", async () => {
    const spy = funnelSpy();
    const result = await reconcileWorkspaceColors({
      observations: [
        observation("WS-ANCHOR", "#B05F3A", { currentDirectory: "/Users/e/Developer/the-mountain" }),
        observation("WS-REAL", "#B05F3A", { currentDirectory: "/Users/e/Developer/the-mountain" }),
      ],
      surfaces: [],
      anchorWorkspaceIds: new Set(["WS-ANCHOR"]),
      settings: settings({ "the-mountain": assignment("the-mountain", "#5F7F2A") }),
      runtime: runtimeWith(spy.funnel),
    });

    // The real workspace is re-asserted; the anchor beside it is not written to,
    // not repo-mapped, and not published.
    expect(spy.writes).toEqual([{ workspaceId: "WS-REAL", hex: "#5F7F2A", reason: "sync-reassert" }]);
    expect(result.workspaces).toEqual({ "WS-REAL": { hex: "#5f7f2a", repoKey: "the-mountain" } });
    const anchorDecision = result.decisions.find((decision) => decision.workspaceId === "WS-ANCHOR");
    expect(anchorDecision).toMatchObject({ outcome: "ignore", repoKey: null });
    expect(anchorDecision?.reason).toContain("group anchor");
  });

  test("an anchor with a hand-set color is not ingested either", async () => {
    const spy = funnelSpy();
    const result = await reconcileWorkspaceColors({
      observations: [observation("WS-ANCHOR", "#1A5276", { currentDirectory: "/Users/e/Downloads" })],
      surfaces: [],
      anchorWorkspaceIds: new Set(["WS-ANCHOR"]),
      settings: settings({}),
      runtime: runtimeWith(spy.funnel),
    });

    expect(result.workspaces).toEqual({});
    expect(spy.writes).toEqual([]);
  });

  test("an anchor cannot vote on which repo owns a workspace", async () => {
    // Rule 4 counts agents per repo. An anchor's surfaces would otherwise be a
    // ballot cast by a sidebar header.
    const spy = funnelSpy();
    const result = await reconcileWorkspaceColors({
      observations: [
        observation("WS-ANCHOR", null, { currentDirectory: "/Users/e/Developer/cooper-scheduler" }),
        observation("WS-REAL", "#1A5276", { currentDirectory: "/Users/e/Developer/elio" }),
      ],
      surfaces: [],
      anchorWorkspaceIds: new Set(["WS-ANCHOR"]),
      settings: settings({}),
      runtime: runtimeWith(spy.funnel),
    });

    expect(result.decisions.filter((decision) => decision.outcome === "ingest")).toEqual([{
      workspaceId: "WS-REAL",
      outcome: "ingest",
      repoKey: "elio",
      hex: "#1a5276",
      reason: "unmapped workspace; cmux color ingested",
    }]);
  });
});

describe("reconcile — authority rules decide every workspace", () => {
  test("an unmapped workspace is ingested and never written to", async () => {
    const spy = funnelSpy();
    const result = await reconcileWorkspaceColors({
      observations: [observation("WS-1", "#1A5276", { currentDirectory: "/Users/e/Downloads" })],
      surfaces: [],
      settings: settings({}),
      runtime: runtimeWith(spy.funnel),
    });

    expect(result.decisions[0]?.outcome).toBe("ingest");
    expect(result.workspaces["WS-1"]).toEqual({ hex: "#1a5276", repoKey: null });
    expect(spy.writes).toEqual([]);
  });

  test("a repo we know but have not assigned a color to is still cmux's to own", async () => {
    const spy = funnelSpy();
    const result = await reconcileWorkspaceColors({
      observations: [observation("WS-1", "#1A5276", { currentDirectory: "/Users/e/Developer/elio" })],
      surfaces: [],
      settings: settings({}),
      runtime: runtimeWith(spy.funnel),
    });

    expect(result.decisions[0]).toMatchObject({ outcome: "ingest", repoKey: "elio" });
    expect(spy.writes).toEqual([]);
  });

  test("a color that differs only in case is not drift", async () => {
    // The write loop dressed as a string bug: cmux answers "#5F7F2A" for the
    // "#5f7f2a" we asked for, and a raw comparison re-asserts forever.
    const spy = funnelSpy();
    const result = await reconcileWorkspaceColors({
      observations: [observation("WS-1", "#5F7F2A", { currentDirectory: "/Users/e/Developer/the-mountain" })],
      surfaces: [],
      settings: settings({ "the-mountain": assignment("the-mountain", "#5f7f2a") }),
      runtime: runtimeWith(spy.funnel),
    });

    expect(result.decisions[0]?.outcome).toBe("ignore");
    expect(spy.writes).toEqual([]);
  });

  test("repo-mapped drift is re-asserted through the funnel, with a reason", async () => {
    const spy = funnelSpy();
    const result = await reconcileWorkspaceColors({
      observations: [observation("WS-1", "#B05F3A", { currentDirectory: "/Users/e/Developer/the-mountain" })],
      surfaces: [],
      settings: settings({ "the-mountain": assignment("the-mountain", "#5F7F2A") }),
      runtime: runtimeWith(spy.funnel),
    });

    expect(spy.writes).toEqual([{ workspaceId: "WS-1", hex: "#5F7F2A", reason: "sync-reassert" }]);
    expect(result.decisions[0]).toMatchObject({ outcome: "reassert", hex: "#5f7f2a" });
    expect(result.workspaces["WS-1"]).toEqual({ hex: "#5f7f2a", repoKey: "the-mountain" });
  });

  test("a repo-mapped workspace with no color at all is painted, not left bare", async () => {
    const spy = funnelSpy();
    await reconcileWorkspaceColors({
      observations: [observation("WS-1", null, { currentDirectory: "/Users/e/Developer/the-mountain" })],
      surfaces: [],
      settings: settings({ "the-mountain": assignment("the-mountain", "#5F7F2A") }),
      runtime: runtimeWith(spy.funnel),
    });
    expect(spy.writes).toHaveLength(1);
  });

  test("syncFromCmux off stops the pass entirely — no ingest, no write", async () => {
    const spy = funnelSpy();
    const result = await reconcileWorkspaceColors({
      observations: [observation("WS-1", "#B05F3A", { currentDirectory: "/Users/e/Developer/the-mountain" })],
      surfaces: [],
      settings: settings(
        { "the-mountain": assignment("the-mountain", "#5F7F2A") },
        { syncFromCmux: false },
      ),
      runtime: runtimeWith(spy.funnel),
    });

    expect(spy.writes).toEqual([]);
    expect(result.decisions[0]?.outcome).toBe("ignore");
    expect(result.workspaces).toEqual({});
  });
});

describe("reconcile — echo suppression and the write loop", () => {
  test("a re-assert observed by the next poll produces no further write", async () => {
    const spy = funnelSpy();
    const board = settings({ "the-mountain": assignment("the-mountain", "#5F7F2A") });
    const runtime = runtimeWith(spy.funnel);
    const cwd = "/Users/e/Developer/the-mountain";

    await reconcileWorkspaceColors({
      observations: [observation("WS-1", "#B05F3A", { currentDirectory: cwd })],
      surfaces: [],
      settings: board,
      runtime,
    });
    expect(spy.writes).toHaveLength(1);

    // The next poll sees cmux's own uppercased echo of that write.
    const second = await reconcileWorkspaceColors({
      observations: [observation("WS-1", "#5F7F2A", { currentDirectory: cwd })],
      surfaces: [],
      settings: board,
      runtime,
    });

    expect(spy.writes).toHaveLength(1);
    expect(second.decisions[0]?.outcome).toBe("ignore");
  });

  test("a color the user re-drifts between polls is re-asserted again", async () => {
    const spy = funnelSpy();
    const board = settings({ "the-mountain": assignment("the-mountain", "#5F7F2A") });
    const runtime = runtimeWith(spy.funnel);
    const cwd = "/Users/e/Developer/the-mountain";

    await reconcileWorkspaceColors({
      observations: [observation("WS-1", "#B05F3A", { currentDirectory: cwd })],
      surfaces: [],
      settings: board,
      runtime,
    });
    // The operator recolors it by hand in cmux after our write landed.
    await reconcileWorkspaceColors({
      observations: [observation("WS-1", "#9E3355", { currentDirectory: cwd })],
      surfaces: [],
      settings: board,
      runtime,
    });

    expect(spy.writes).toHaveLength(2);
    expect(spy.writes[1]).toEqual({ workspaceId: "WS-1", hex: "#5F7F2A", reason: "sync-reassert" });
  });

  test("a fresh process whose cmux color already matches ignores rather than re-asserts", async () => {
    // The restart case. Echo suppression keyed on a local cache would have
    // nothing after a restart and would re-fight the operator once per process
    // lifetime; the assignment comparison is what actually settles this.
    const spy = funnelSpy();
    const result = await reconcileWorkspaceColors({
      observations: [observation("WS-1", "#5F7F2A", { currentDirectory: "/Users/e/Developer/the-mountain" })],
      surfaces: [],
      settings: settings({ "the-mountain": assignment("the-mountain", "#5F7F2A") }),
      runtime: runtimeWith(spy.funnel),
    });

    expect(spy.funnel.lastWrittenHex("WS-1")).toBeNull();
    expect(result.decisions[0]?.outcome).toBe("ignore");
    expect(spy.writes).toEqual([]);
  });

  test("a user override this process just wrote is not fought while settings catch up", async () => {
    // TINT-F's PUT writes the operator's chosen hex through the funnel; this
    // pass can run before the new assignment is visible to it. Without echo
    // suppression the sync would immediately undo the operator's own click.
    const spy = funnelSpy({ alreadyWritten: { "WS-1": "#8A4FC0" } });
    const result = await reconcileWorkspaceColors({
      observations: [observation("WS-1", "#8A4FC0", { currentDirectory: "/Users/e/Developer/the-mountain" })],
      surfaces: [],
      settings: settings({ "the-mountain": assignment("the-mountain", "#5F7F2A") }),
      runtime: runtimeWith(spy.funnel),
    });

    expect(spy.writes).toEqual([]);
    expect(result.decisions[0]).toMatchObject({ outcome: "ignore", hex: "#8a4fc0" });
  });
});

describe("reconcile — a failed write is never reconciled", () => {
  test("a funnel that reports failure leaves the workspace as cmux has it", async () => {
    const spy = funnelSpy({ fail: true });
    const result = await reconcileWorkspaceColors({
      observations: [observation("WS-1", "#B05F3A", { currentDirectory: "/Users/e/Developer/the-mountain" })],
      surfaces: [],
      settings: settings({ "the-mountain": assignment("the-mountain", "#5F7F2A") }),
      runtime: runtimeWith(spy.funnel),
    });

    expect(result.decisions[0]?.outcome).toBe("failed");
    expect(result.errors).toEqual([
      "re-assert of the-mountain color on workspace WS-1 failed",
    ]);
    // Not the assigned color: the board must not show what cmux is not wearing.
    expect(result.workspaces["WS-1"]).toEqual({ hex: "#b05f3a", repoKey: "the-mountain" });
  });

  test("a funnel that throws is reported, and the pass keeps going", async () => {
    const spy = funnelSpy({ throws: true });
    const result = await reconcileWorkspaceColors({
      observations: [
        observation("WS-1", "#B05F3A", { currentDirectory: "/Users/e/Developer/the-mountain" }),
        observation("WS-2", "#1A5276", { currentDirectory: "/Users/e/Downloads" }),
      ],
      surfaces: [],
      settings: settings({ "the-mountain": assignment("the-mountain", "#5F7F2A") }),
      runtime: runtimeWith(spy.funnel),
    });

    expect(result.decisions.map((decision) => decision.outcome)).toEqual(["failed", "ingest"]);
    expect(result.errors[0]).toContain("cmux refused the write");
  });

  test("an unusable assigned hex is reported rather than written to cmux", async () => {
    const spy = funnelSpy();
    const result = await reconcileWorkspaceColors({
      observations: [observation("WS-1", "#1A5276", { currentDirectory: "/Users/e/Developer/the-mountain" })],
      surfaces: [],
      settings: settings({ "the-mountain": assignment("the-mountain", "Amber") }),
      runtime: runtimeWith(spy.funnel),
    });

    expect(spy.writes).toEqual([]);
    expect(result.errors[0]).toContain("unusable assigned color");
  });
});

describe("workspaceRepoKeys — authority rule 4", () => {
  test("the repo with the most agents in a shared workspace wins", () => {
    const keys = workspaceRepoKeys(
      [observation("WS-1", null)],
      [
        surface("WS-1", "/Users/e/Developer/the-mountain", "S1"),
        surface("WS-1", "/Users/e/Developer/the-mountain.worktrees/tint-s", "S2"),
        surface("WS-1", "/Users/e/Developer/cooper-scheduler", "S3"),
      ],
      repoKeyForCwd,
    );
    expect(keys.get("WS-1")).toBe("the-mountain");
  });

  test("a tie breaks on the lexicographically first repo key, both orderings", () => {
    const surfaces = [
      surface("WS-1", "/Users/e/Developer/the-mountain", "S1"),
      surface("WS-1", "/Users/e/Developer/cooper-scheduler", "S2"),
    ];
    expect(workspaceRepoKeys([observation("WS-1", null)], surfaces, repoKeyForCwd).get("WS-1"))
      .toBe("cooper-scheduler");
    expect(workspaceRepoKeys([observation("WS-1", null)], [...surfaces].reverse(), repoKeyForCwd).get("WS-1"))
      .toBe("cooper-scheduler");
  });

  test("a workspace with no agents falls back to its own directory", () => {
    const keys = workspaceRepoKeys(
      [
        observation("WS-1", null, { projectRootPath: "/Users/e/Developer/elio" }),
        observation("WS-2", null, { currentDirectory: "/Users/e/Developer/cooper-scheduler" }),
        observation("WS-3", null, { currentDirectory: "/Users/e/Downloads" }),
      ],
      [],
      repoKeyForCwd,
    );
    expect(keys.get("WS-1")).toBe("elio");
    expect(keys.get("WS-2")).toBe("cooper-scheduler");
    expect(keys.has("WS-3")).toBe(false);
  });

  test("an agent-bearing workspace outranks its own stale directory", () => {
    const keys = workspaceRepoKeys(
      [observation("WS-1", null, { currentDirectory: "/Users/e/Developer/elio" })],
      [surface("WS-1", "/Users/e/Developer/cooper-scheduler", "S1")],
      repoKeyForCwd,
    );
    expect(keys.get("WS-1")).toBe("cooper-scheduler");
  });
});

describe("syncCmuxColors — the pass the collector poll calls", () => {
  function twoWindowRunner(
    colors: Record<string, string | null>,
    anchorId?: string,
  ): CommandRunner {
    return {
      run: async (command) => {
        const key = command.slice(1).join(" ");
        if (key === "rpc window.list {}") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({ windows: [{ id: "WINDOW-1" }, { id: "WINDOW-2" }] }),
            stderr: "",
            timedOut: false,
          };
        }
        if (key.startsWith("rpc workspace.group.list")) {
          const inWindowOne = key.includes("WINDOW-1");
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              groups: anchorId && inWindowOne === anchorId.endsWith("-1")
                ? [{ id: "GROUP-1", anchor_workspace_id: anchorId }]
                : [],
            }),
            stderr: "",
            timedOut: false,
          };
        }
        const windowId = key.includes("WINDOW-1") ? "WINDOW-1" : "WINDOW-2";
        const workspaces = Object.entries(colors)
          .filter(([id]) => (windowId === "WINDOW-1" ? id.endsWith("-1") : id.endsWith("-2")))
          .map(([id, custom_color]) => ({
            id,
            custom_color,
            current_directory: id.startsWith("MOUNTAIN")
              ? "/Users/e/Developer/the-mountain"
              : "/Users/e/Downloads",
          }));
        return {
          exitCode: 0,
          stdout: JSON.stringify({ window_id: windowId, workspaces }),
          stderr: "",
          timedOut: false,
        };
      },
    };
  }

  test("collects across windows, re-asserts drift and publishes the ingested colors", async () => {
    resetColorSyncState();
    const spy = funnelSpy();
    const result = await syncCmuxColors({
      runner: twoWindowRunner({ "MOUNTAIN-1": "#B05F3A", "OTHER-2": "#1A5276" }),
      executable: "cmux",
      surfaces: [],
      settings: {
        repoColors: { assignments: { "the-mountain": assignment("the-mountain", "#5F7F2A") }, mirrorGroups: true, syncFromCmux: true },
      },
      runtime: runtimeWith(spy.funnel),
    });

    expect(result.errors).toEqual([]);
    expect(spy.writes).toEqual([{ workspaceId: "MOUNTAIN-1", hex: "#5F7F2A", reason: "sync-reassert" }]);
    expect(latestWorkspaceColors()).toEqual({
      "MOUNTAIN-1": { hex: "#5f7f2a", repoKey: "the-mountain" },
      "OTHER-2": { hex: "#1a5276", repoKey: null },
    });
  });

  test("with mirrorGroups on, the group's anchor is neither published nor painted", async () => {
    resetColorSyncState();
    const spy = funnelSpy();
    const result = await syncCmuxColors({
      runner: twoWindowRunner({ "MOUNTAIN-1": "#B05F3A", "MOUNTAINANCHOR-1": null }, "MOUNTAINANCHOR-1"),
      executable: "cmux",
      surfaces: [],
      settings: {
        repoColors: { assignments: { "the-mountain": assignment("the-mountain", "#5F7F2A") }, mirrorGroups: true, syncFromCmux: true },
      },
      runtime: runtimeWith(spy.funnel),
    });

    expect(spy.writes).toEqual([{ workspaceId: "MOUNTAIN-1", hex: "#5F7F2A", reason: "sync-reassert" }]);
    expect(Object.keys(latestWorkspaceColors())).toEqual(["MOUNTAIN-1"]);
    expect(result.decisions.some((decision) => decision.workspaceId === "MOUNTAINANCHOR-1")).toBe(false);
  });

  test("a collection failure is reported and never publishes as a clean pass", async () => {
    resetColorSyncState();
    const spy = funnelSpy();
    const result = await syncCmuxColors({
      runner: { run: async () => ({ exitCode: 7, stdout: "", stderr: "socket closed", timedOut: false }) },
      executable: "cmux",
      surfaces: [],
      settings: {},
      runtime: runtimeWith(spy.funnel),
    });

    expect(result.errors).toEqual(["cmux window discovery exited 7: socket closed"]);
    expect(spy.writes).toEqual([]);
  });

  test("without TINT-F's implementations the pass stays idle instead of guessing", async () => {
    /* The missing implementations are STATED here, not inherited from the tree.
       This test used to rely on `./cmux-color` genuinely not existing on this
       lane's branch; that made it pass for a reason that stopped being true the
       moment TINT-F merged, without ever going red on the branch that wrote it.

       The board's settings below DO assign the-mountain a color, and the drifted
       workspace's cwd IS in that repo — so a pass that guessed at repo mapping
       would re-assert. With no runtime it must instead treat the workspace as
       unmapped, write nothing, and say why. */
    resetColorSyncState();
    const result = await syncCmuxColors({
      runner: twoWindowRunner({ "MOUNTAIN-1": "#B05F3A" }),
      executable: "cmux",
      surfaces: [],
      settings: {
        repoColors: {
          assignments: { "the-mountain": assignment("the-mountain", "#5F7F2A") },
          mirrorGroups: true,
          syncFromCmux: true,
        },
      },
      modules: { repoColor: async () => ({}), funnel: async () => ({}) },
    });

    expect(result.decisions.every((decision) => decision.outcome !== "reassert")).toBe(true);
    expect(result.workspaces).toEqual({ "MOUNTAIN-1": { hex: "#b05f3a", repoKey: null } });
    expect(result.errors.join(" ")).toContain("TINT-F");
  });

  test("half a runtime is no runtime — a funnel without repo mapping still writes nothing", async () => {
    // Partial availability is the state an in-flight merge actually produces.
    resetColorSyncState();
    const spy = funnelSpy();
    const result = await syncCmuxColors({
      runner: twoWindowRunner({ "MOUNTAIN-1": "#B05F3A" }),
      executable: "cmux",
      surfaces: [],
      settings: {
        repoColors: {
          assignments: { "the-mountain": assignment("the-mountain", "#5F7F2A") },
          mirrorGroups: true,
          syncFromCmux: true,
        },
      },
      modules: { repoColor: async () => ({}), funnel: async () => spy.funnel },
    });

    expect(spy.writes).toEqual([]);
    expect(result.errors.join(" ")).toContain("repoKeyForCwd is not implemented");
  });

  test("a second pass launched while one is running joins it rather than stacking writes", async () => {
    resetColorSyncState();
    const spy = funnelSpy();
    const input = {
      runner: twoWindowRunner({ "MOUNTAIN-1": "#B05F3A" }),
      executable: "cmux",
      surfaces: [],
      settings: {
        repoColors: { assignments: { "the-mountain": assignment("the-mountain", "#5F7F2A") }, mirrorGroups: true, syncFromCmux: true },
      },
      runtime: runtimeWith(spy.funnel),
    };
    const [first, second] = await Promise.all([syncCmuxColors(input), syncCmuxColors(input)]);

    expect(spy.writes).toHaveLength(1);
    expect(second).toBe(first);
  });
});

describe("repoColorsSettingsFrom — reading TINT-F's settings without owning them", () => {
  test("answers with the locked defaults until repo-color settings exist", () => {
    expect(repoColorsSettingsFrom(undefined)).toEqual({
      assignments: {},
      mirrorGroups: true,
      syncFromCmux: true,
    });
  });

  test("an explicit false is honored; a missing flag is not read as off", () => {
    expect(repoColorsSettingsFrom({ repoColors: { syncFromCmux: false } }).syncFromCmux).toBe(false);
    expect(repoColorsSettingsFrom({ repoColors: {} }).syncFromCmux).toBe(true);
  });
});

describe("loadColorRuntime — the seam reports what has not landed", () => {
  const workingFunnel = () => funnelSpy().funnel;

  test("both halves present yields a runtime and no complaint", async () => {
    const loaded = await loadColorRuntime({
      repoColor: async () => ({ repoKeyForCwd }),
      funnel: async () => workingFunnel(),
    });
    expect(loaded.errors).toEqual([]);
    expect(typeof loaded.runtime?.repoKeyForCwd).toBe("function");
    expect(typeof loaded.runtime?.funnel.setWorkspaceColor).toBe("function");
  });

  test("each missing half is named, and neither leaves a half-built runtime", async () => {
    const noFunnel = await loadColorRuntime({
      repoColor: async () => ({ repoKeyForCwd }),
      funnel: async () => ({}),
    });
    expect(noFunnel.runtime).toBeUndefined();
    expect(noFunnel.errors.join(" ")).toContain("funnel is not implemented yet (TINT-F)");

    const noRepoKey = await loadColorRuntime({
      repoColor: async () => ({}),
      funnel: async () => workingFunnel(),
    });
    expect(noRepoKey.runtime).toBeUndefined();
    expect(noRepoKey.errors.join(" ")).toContain("repoKeyForCwd is not implemented yet (TINT-F)");
  });

  test("a module that cannot be resolved at all is reported, not thrown", async () => {
    const loaded = await loadColorRuntime({
      repoColor: async () => ({ repoKeyForCwd }),
      funnel: async () => { throw new Error("Cannot find module './cmux-color'"); },
    });
    expect(loaded.runtime).toBeUndefined();
    expect(loaded.errors.join(" ")).toContain("Cannot find module");
  });

  test("the real specifiers resolve to whatever this tree actually holds", async () => {
    /* The one environment-dependent check, and deliberately tolerant: on this
       lane's branch TINT-F's funnel does not exist, and on the integration
       branch it does. Either answer is correct — what must never happen is a
       half-built runtime or a silent failure. The behavior itself is pinned by
       the injected tests above. */
    const loaded = await loadColorRuntime();
    if (loaded.runtime) {
      expect(typeof loaded.runtime.repoKeyForCwd).toBe("function");
      expect(typeof loaded.runtime.funnel.setWorkspaceColor).toBe("function");
      expect(typeof loaded.runtime.funnel.lastWrittenHex).toBe("function");
    } else {
      expect(loaded.errors.length).toBeGreaterThan(0);
    }
  });
});

describe("the sidebar snapshot carries the workspace color", () => {
  test("an explicit null is no color and an old fixture stays silent", () => {
    const [colored, cleared, silent] = parseCmuxSidebarSnapshot(JSON.stringify({
      workspaces: [
        { id: "WS-1", custom_color: "#1A5276", pull_request_urls: [] },
        { id: "WS-2", custom_color: null },
        { id: "WS-3" },
      ],
    }));
    expect(colored?.customColor).toBe("#1A5276");
    expect(cleared?.customColor).toBeNull();
    expect(silent?.customColor).toBeUndefined();
  });
});
