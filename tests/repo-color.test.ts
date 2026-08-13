import { beforeEach, describe, expect, test } from "bun:test";
import {
  assignSlot,
  hexForSlot,
  normalizeHex,
  REPO_OVERFLOW_HEX,
  REPO_PALETTE,
  repoKeyForCwd,
  sameHex,
  withAssignments,
  type RepoColorsSettings,
  type RepoKeyExec,
} from "../src/shared/repo-color";
import {
  configureCmuxColor,
  lastWrittenHex,
  resetCmuxColorMemory,
  setGroupColor,
  setWorkspaceColor,
} from "../src/server/cmux-color";
import {
  handleRepoColorsRequest,
  JsonRepoColorsStore,
  memorySettingsFiles,
  normalizeRepoColors,
  repoColorDiscovery,
} from "../src/server/settings";
import { createMountainFetch, emptySnapshot } from "../src/server/app";
import type { CommandResult, CommandRunner } from "../src/server/types";

const ORIGIN = "http://127.0.0.1:4701";

/* ---------------------------------------------------------------------------
   The shared contract: repo key, slots, palette.
   ------------------------------------------------------------------------ */

/** A git stand-in that answers `rev-parse --git-common-dir` from a table of
 *  cwd → common dir, and refuses everything else the way git does.
 *
 *  It INSPECTS the argv, and that is the whole point of it. Reading only
 *  `command[2]` made these tests pass against an implementation asking for
 *  `--show-toplevel` — the exact worktree-fragmenting bug they exist to
 *  prevent. A fake that answers any question with the answer to one question
 *  cannot tell you which question was asked. */
function fakeGit(table: Record<string, string>): RepoKeyExec {
  return (command) => {
    const [binary, dashC, cwd, ...flags] = command;
    if (binary !== "git" || dashC !== "-C") {
      throw new Error(`repoKeyForCwd shelled something other than \`git -C\`: ${command.join(" ")}`);
    }
    if (!flags.includes("rev-parse") || !flags.includes("--git-common-dir")) {
      throw new Error(`repoKeyForCwd must ask for --git-common-dir, not: ${flags.join(" ")}`);
    }
    if (flags.includes("--show-toplevel")) {
      throw new Error("--show-toplevel answers the LINKED WORKTREE's own directory, which fragments one repository into many");
    }
    const answer = table[cwd ?? ""];
    return answer === undefined
      ? { exitCode: 128, stdout: "" }
      : { exitCode: 0, stdout: `${answer}\n` };
  };
}

describe("repoKeyForCwd", () => {
  test("every worktree of one repository collapses to one key", () => {
    /* The trap this function exists for. `--show-toplevel` answers the linked
       worktree's OWN directory, so the board — which runs out of
       the-mountain.worktrees/* all day — would paint one repository as four,
       each in a different colour, and the bug would demo perfectly on a
       machine with no worktrees. */
    const exec = fakeGit({
      "/Users/e/Developer/the-mountain": "/Users/e/Developer/the-mountain/.git",
      "/Users/e/Developer/the-mountain.worktrees/tint-f": "/Users/e/Developer/the-mountain/.git",
      "/Users/e/Developer/the-mountain.worktrees/tint-g/src/web": "/Users/e/Developer/the-mountain/.git",
    });
    const keys = [
      "/Users/e/Developer/the-mountain",
      "/Users/e/Developer/the-mountain.worktrees/tint-f",
      "/Users/e/Developer/the-mountain.worktrees/tint-g/src/web",
    ].map((cwd) => repoKeyForCwd(cwd, { exec }));
    expect(keys).toEqual(["the-mountain", "the-mountain", "the-mountain"]);
  });

  test("a relative common dir is resolved against the cwd, and the key is lowercased", () => {
    const exec = fakeGit({ "/Users/e/Developer/Cooper-Scheduler": ".git" });
    expect(repoKeyForCwd("/Users/e/Developer/Cooper-Scheduler", { exec })).toBe("cooper-scheduler");
  });

  test("outside a repository, and on an empty cwd, the answer is null — never a guess", () => {
    const exec = fakeGit({});
    expect(repoKeyForCwd("/tmp/not-a-repo", { exec })).toBeNull();
    expect(repoKeyForCwd("", { exec })).toBeNull();
  });

  test("git exiting 0 with nothing to say is still not an answer", () => {
    const exec: RepoKeyExec = () => ({ exitCode: 0, stdout: "\n" });
    expect(repoKeyForCwd("/repo", { exec })).toBeNull();
  });

  test("the real git in this checkout resolves this worktree to its repository", () => {
    /* One live call, because every fake above encodes an assumption about what
       `rev-parse --git-common-dir` prints in a LINKED worktree — and this file
       is running inside one. */
    expect(repoKeyForCwd(import.meta.dir)).toBe("the-mountain");
  });
});

describe("assignSlot", () => {
  test("the same repository always lands on the same slot, restart after restart", () => {
    const first = assignSlot("the-mountain", new Set());
    for (let run = 0; run < 5; run += 1) {
      expect(assignSlot("the-mountain", new Set())).toBe(first);
    }
    expect(first).not.toBeNull();
  });

  test("a taken slot pushes upward, wrapping, and never reuses a hue", () => {
    const start = assignSlot("cooper-scheduler", new Set())!;
    const taken = new Set([start]);
    const second = assignSlot("cooper-scheduler", taken)!;
    expect(second).toBe((start + 1) % REPO_PALETTE.length);
    expect(second).not.toBe(start);
  });

  test("the seventh repository overflows rather than inventing a hue", () => {
    const taken = new Set(REPO_PALETTE.map((entry) => entry.slot));
    expect(assignSlot("seventh", taken)).toBeNull();
    expect(hexForSlot(null)).toBe(REPO_OVERFLOW_HEX);
  });
});

describe("withAssignments", () => {
  const empty: RepoColorsSettings = { assignments: {}, mirrorGroups: true, syncFromCmux: true };
  const repos = ["the-mountain", "cooper-scheduler", "elio-web", "formic", "gstack", "dotfiles"];

  test("discovery ORDER cannot change a colour", () => {
    /* The collector reads whichever agent it reads first, and that order moves
       between polls. If it decided colours, the whole board would repaint for
       no reason an operator could see. */
    const forward = withAssignments(empty, repos).assignments;
    const backward = withAssignments(empty, [...repos].reverse()).assignments;
    const shuffled = withAssignments(empty, [repos[3]!, repos[0]!, repos[5]!, repos[1]!, repos[4]!, repos[2]!]).assignments;
    for (const key of repos) {
      expect(backward[key]!.hex, key).toBe(forward[key]!.hex);
      expect(shuffled[key]!.hex, key).toBe(forward[key]!.hex);
    }
  });

  test("six repositories wear six distinct palette hues, stored in one spelling", () => {
    const six = withAssignments(empty, repos).assignments;
    const hexes = repos.map((key) => six[key]!.hex);
    expect(new Set(hexes).size).toBe(6);
    /* Lowercase in the store, whatever case the palette constant is spelled in
       — a stored `#5F7F2A` compared against a `#5f7f2a` read back off cmux is
       drift that is only spelling, and drift provokes a write. */
    expect(hexes.every((hex) => hex === hex.toLowerCase())).toBe(true);
    expect(hexes.every((hex) => REPO_PALETTE.some((entry) => entry.hex.toLowerCase() === hex))).toBe(true);
  });

  test("the seventh repository in one batch wears clay, and WHICH one is deterministic", () => {
    /* Six hues and seven repositories: somebody wears clay. Which one must not
       depend on the order the collector happened to read them in, so newcomers
       are taken lexicographically and the last one out overflows. */
    const seven = [...repos, "seventh-repo"];
    const forward = withAssignments(empty, seven).assignments;
    const backward = withAssignments(empty, [...seven].reverse()).assignments;
    const clay = seven.filter((key) => forward[key]!.hex === REPO_OVERFLOW_HEX.toLowerCase());
    expect(clay).toEqual(["the-mountain"]); // lexicographically last of the eight
    expect(forward["the-mountain"]).toEqual({
      repoKey: "the-mountain",
      hex: REPO_OVERFLOW_HEX.toLowerCase(),
      slot: null,
      source: "auto",
    });
    for (const key of seven) expect(backward[key]!.hex, key).toBe(forward[key]!.hex);
  });

  test("a repository that already has a hue keeps it when a newcomer overflows", () => {
    /* Stickiness is what makes the batch rule tolerable: the-mountain only
       overflows above because nothing had been assigned yet. Once it holds a
       slot, an eighth repository arriving takes the clay instead. */
    const established = withAssignments(empty, repos);
    const later = withAssignments(established, [...repos, "seventh-repo"]);
    for (const key of repos) {
      expect(later.assignments[key]!.hex, key).toBe(established.assignments[key]!.hex);
    }
    expect(later.assignments["seventh-repo"]!.hex).toBe(REPO_OVERFLOW_HEX.toLowerCase());
  });

  test("an existing assignment is never re-coloured by a newcomer arriving", () => {
    const first = withAssignments(empty, ["the-mountain"]);
    const later = withAssignments(first, ["the-mountain", "cooper-scheduler"]);
    expect(later.assignments["the-mountain"]).toEqual(first.assignments["the-mountain"]!);
  });

  test("an operator's colour survives a discovery pass and keeps its slot free", () => {
    const seeded: RepoColorsSettings = {
      ...empty,
      assignments: { formic: { repoKey: "formic", hex: "#123456", slot: null, source: "user" } },
    };
    const next = withAssignments(seeded, ["formic", "the-mountain"]);
    expect(next.assignments.formic).toEqual(seeded.assignments.formic!);
    expect(next.assignments["the-mountain"]!.source).toBe("auto");
  });
});

describe("normalizeHex", () => {
  test("case is not drift", () => {
    /* `#2E66A8` read back as `#2e66a8` is the same colour. Comparing them raw
       reports drift, drift provokes a re-assert, the re-assert reads as drift:
       an infinite write loop dressed as a string bug. */
    expect(normalizeHex("#2E66A8")).toBe("#2e66a8");
    expect(sameHex("#2E66A8", "#2e66a8")).toBe(true);
    expect(sameHex(" #2E66A8 ", "#2e66a8")).toBe(true);
  });

  test("shorthand expands; anything else is null, never a coerced colour", () => {
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    for (const bad of ["", "2e66a8", "#2e66a", "#gggggg", "blue", null, undefined, 42, {}]) {
      expect(normalizeHex(bad), String(bad)).toBeNull();
    }
    expect(sameHex(null, null)).toBe(false);
  });
});

/* ---------------------------------------------------------------------------
   The funnel.
   ------------------------------------------------------------------------ */

function recordingRunner(reply: (command: readonly string[]) => CommandResult): {
  runner: CommandRunner;
  calls: string[][];
} {
  const calls: string[][] = [];
  return {
    calls,
    runner: {
      run: async (command) => {
        calls.push([...command]);
        return reply(command);
      },
    },
  };
}

const clean: CommandResult = { exitCode: 0, stdout: "", stderr: "", timedOut: false };

describe("cmux colour funnel", () => {
  beforeEach(() => {
    resetCmuxColorMemory();
    configureCmuxColor({ executable: "/fake/cmux", log: () => {} });
  });

  test("a workspace write shells set-color with the normalized hex and remembers it", async () => {
    const { runner, calls } = recordingRunner(() => clean);
    configureCmuxColor({ runner });
    expect(await setWorkspaceColor("WS-1", "#2E66A8", "board assignment")).toBe(true);
    expect(calls).toEqual([[
      "/fake/cmux", "workspace-action", "--action", "set-color",
      "--workspace", "WS-1", "--color", "#2e66a8",
    ]]);
    expect(lastWrittenHex("WS-1")).toBe("#2e66a8");
    expect(lastWrittenHex("WS-2")).toBeNull();
  });

  test("a non-zero exit is a failure, and nothing is remembered", async () => {
    const { runner } = recordingRunner(() => ({ ...clean, exitCode: 1, stderr: "workspace not found" }));
    configureCmuxColor({ runner });
    expect(await setWorkspaceColor("WS-1", "#2e66a8", "board assignment")).toBe(false);
    /* The whole point of the house rule. Remembering a hex that is not on the
       workspace would make TINT-S suppress the echo of a write that never
       landed, and the colour would never be re-asserted. */
    expect(lastWrittenHex("WS-1")).toBeNull();
  });

  test("exit 0 with stderr is a failure too — cmux refuses on stderr and exits clean", async () => {
    const { runner } = recordingRunner(() => ({ ...clean, stderr: "Error: not_found: Workspace not found" }));
    configureCmuxColor({ runner });
    expect(await setWorkspaceColor("WS-1", "#2e66a8", "board assignment")).toBe(false);
    expect(lastWrittenHex("WS-1")).toBeNull();
  });

  test("a timeout and a missing executable are failures, not silence", async () => {
    const timedOut = recordingRunner(() => ({ exitCode: -1, stdout: "", stderr: "", timedOut: true }));
    configureCmuxColor({ runner: timedOut.runner });
    expect(await setWorkspaceColor("WS-1", "#2e66a8", "t")).toBe(false);

    const missing = recordingRunner(() => ({
      exitCode: -1, stdout: "", stderr: "executable not found", timedOut: false,
    }));
    configureCmuxColor({ runner: missing.runner });
    expect(await setWorkspaceColor("WS-1", "#2e66a8", "t")).toBe(false);
    expect(lastWrittenHex("WS-1")).toBeNull();
  });

  test("a hex the funnel could not compare later is refused before cmux is called", async () => {
    const { runner, calls } = recordingRunner(() => clean);
    configureCmuxColor({ runner });
    expect(await setWorkspaceColor("WS-1", "cornflower", "board")).toBe(false);
    expect(await setWorkspaceColor("", "#2e66a8", "board")).toBe(false);
    expect(calls).toEqual([]);
  });

  /* The group RPC echoes the colour it now holds; a no-op echoes null. */
  const groupEcho = (hex: string | null): CommandResult =>
    ({ ...clean, stdout: JSON.stringify({ id: "GROUP-1", custom_color: hex }) });

  test("a group write names its parameters EXACTLY group_id and hex", async () => {
    /* Not a spelling preference. `color` and `custom_color` are both accepted
       by this RPC, both exit 0 with no stderr, and both change nothing while
       returning custom_color: null — verified live against the binary
       2026-08-13. A funnel written against the obvious name reports success and
       colours nothing, forever. */
    const { runner, calls } = recordingRunner(() => groupEcho("#B05F3A"));
    configureCmuxColor({ runner });
    expect(await setGroupColor("GROUP-1", "#B05F3A", "mirror")).toBe(true);
    expect(calls[0]).toEqual([
      "/fake/cmux", "rpc", "workspace.group.set_color",
      JSON.stringify({ group_id: "GROUP-1", hex: "#b05f3a" }),
    ]);
    const params = JSON.parse(calls[0]![3]!) as Record<string, unknown>;
    expect(Object.keys(params).sort()).toEqual(["group_id", "hex"]);
    /* Groups are mirrored FROM the board every pass and never read back as an
       operator's intent, so there is no loop for a memory to break. */
    expect(lastWrittenHex("GROUP-1")).toBeNull();
  });

  test("a clean exit that echoes no colour is the silent no-op, and reads as failure", async () => {
    const nulled = recordingRunner(() => groupEcho(null));
    configureCmuxColor({ runner: nulled.runner });
    expect(await setGroupColor("GROUP-1", "#b05f3a", "mirror")).toBe(false);

    const silent = recordingRunner(() => clean); // exit 0, no stdout at all
    configureCmuxColor({ runner: silent.runner });
    expect(await setGroupColor("GROUP-1", "#b05f3a", "mirror")).toBe(false);

    const wrong = recordingRunner(() => groupEcho("#123456"));
    configureCmuxColor({ runner: wrong.runner });
    expect(await setGroupColor("GROUP-1", "#b05f3a", "mirror")).toBe(false);
  });

  test("the echoed colour is compared by value, not by spelling", async () => {
    const { runner } = recordingRunner(() => groupEcho("#B05F3A"));
    configureCmuxColor({ runner });
    expect(await setGroupColor("GROUP-1", "#b05f3a", "mirror")).toBe(true);
  });
});

/* ---------------------------------------------------------------------------
   Discovery, persistence, endpoint.
   ------------------------------------------------------------------------ */

describe("repoColorDiscovery", () => {
  test("agents without a repository are skipped; names index by lowercase", () => {
    const discovery = repoColorDiscovery([
      { repoKey: "the-mountain", repoName: "The-Mountain", workspaceId: "WS-1" },
      { repoKey: null, repoName: "nowhere", workspaceId: "WS-9" },
      { repoKey: "formic", repoName: "formic" },
    ]);
    expect(discovery.repoKeys).toEqual(["formic", "the-mountain"]);
    expect(discovery.names).toEqual({ "the-mountain": "the-mountain", formic: "formic" });
    expect(discovery.workspaces).toEqual({ "WS-1": "the-mountain" });
  });

  test("a shared workspace goes to the repository with the most agents in it", () => {
    const discovery = repoColorDiscovery([
      { repoKey: "formic", workspaceId: "WS-1" },
      { repoKey: "the-mountain", workspaceId: "WS-1" },
      { repoKey: "the-mountain", workspaceId: "WS-1" },
    ]);
    expect(discovery.workspaces["WS-1"]).toBe("the-mountain");
  });

  test("a printed name claimed by two repositories drops out of the join entirely", () => {
    /* Ruling (master, 2026-08-13). Two repositories can print the same name —
       the board prints RepoIdentity.repoName, which is an origin basename, and
       two checkouts of forks share it while their canonical keys differ. The
       previous `names[name] = key` was last-writer-wins over COLLECTOR order,
       so one of the two wore the other's colour and which one changed between
       polls. No tint beats wrong tint: an operator who sees an uncoloured band
       asks why; one who sees it wearing its neighbour's hue never knows to. */
    const forward = repoColorDiscovery([
      { repoKey: "the-mountain", repoName: "the-ant-hill" },
      { repoKey: "the-mountain-fork", repoName: "the-ant-hill" },
    ]);
    const backward = repoColorDiscovery([
      { repoKey: "the-mountain-fork", repoName: "the-ant-hill" },
      { repoKey: "the-mountain", repoName: "the-ant-hill" },
    ]);
    expect(forward.names).toEqual({});
    expect(backward.names).toEqual(forward.names);
    /* Both repositories still get COLOURS — they are real repositories and the
       cmux fan-out is keyed by repoKey, which is never ambiguous. It is only
       the board's name-based lookup that has to abstain. */
    expect(forward.repoKeys).toEqual(["the-mountain", "the-mountain-fork"]);
  });

  test("one repository seen many times is not ambiguous", () => {
    const discovery = repoColorDiscovery([
      { repoKey: "the-mountain", repoName: "the-ant-hill" },
      { repoKey: "the-mountain", repoName: "The-Ant-Hill" },
      { repoKey: "the-mountain", repoName: "the-ant-hill" },
    ]);
    expect(discovery.names).toEqual({ "the-ant-hill": "the-mountain" });
  });

  test("a tie breaks lexicographically, not by whoever was read last", () => {
    const forward = repoColorDiscovery([
      { repoKey: "zeta", workspaceId: "WS-1" },
      { repoKey: "alpha", workspaceId: "WS-1" },
    ]);
    const backward = repoColorDiscovery([
      { repoKey: "alpha", workspaceId: "WS-1" },
      { repoKey: "zeta", workspaceId: "WS-1" },
    ]);
    expect(forward.workspaces["WS-1"]).toBe("alpha");
    expect(backward.workspaces["WS-1"]).toBe("alpha");
  });
});

describe("JsonRepoColorsStore", () => {
  const store = () => JsonRepoColorsStore.open("colors.json", memorySettingsFiles());

  test("the locked defaults are both flags ON", async () => {
    const settings = (await store()).get();
    expect(settings.mirrorGroups).toBe(true);
    expect(settings.syncFromCmux).toBe(true);
    expect(settings.assignments).toEqual({});
  });

  test("ensure is idempotent and survives a reopen", async () => {
    const files = memorySettingsFiles();
    const first = await JsonRepoColorsStore.open("colors.json", files);
    const assigned = await first.ensure(["the-mountain", "formic"]);
    expect(await first.ensure(["the-mountain", "formic"])).toEqual(assigned);
    const reopened = await JsonRepoColorsStore.open("colors.json", files);
    expect(reopened.get().assignments).toEqual(assigned.assignments);
  });

  test("an operator colour frees its palette slot instead of squatting on it", async () => {
    const subject = await store();
    const auto = (await subject.ensure(["formic"])).assignments.formic!;
    expect(auto.slot).not.toBeNull();
    const overridden = (await subject.setUserColor("formic", "#123456")).assignments.formic!;
    expect(overridden).toEqual({ repoKey: "formic", hex: "#123456", slot: null, source: "user" });
    /* Leaving the old slot number behind would keep that hue marked taken
       forever, pushing the next repository into overflow clay while a colour
       nobody is wearing sat reserved. */
    const next = (await subject.ensure(["formic", "other-repo"])).assignments["other-repo"]!;
    expect(next.slot).not.toBeNull();
  });

  test("clearing an override returns the repository to a palette slot", async () => {
    const subject = await store();
    await subject.setUserColor("formic", "#123456");
    const cleared = (await subject.clearUserColor("formic")).assignments.formic!;
    expect(cleared.source).toBe("auto");
    expect(cleared.slot).not.toBeNull();
  });

  test("a hex this program could not compare later is rejected, never coerced", async () => {
    const subject = await store();
    await expect(subject.setUserColor("formic", "cornflower")).rejects.toThrow(/hex/);
  });

  test("one unreadable assignment costs that repository, not the whole board", () => {
    const settings = normalizeRepoColors({
      assignments: {
        good: { repoKey: "good", hex: "#5F7F2A", slot: 0, source: "auto" },
        bad: { repoKey: "bad", hex: "not-a-colour", slot: 1, source: "auto" },
      },
      mirrorGroups: false,
    });
    expect(Object.keys(settings.assignments)).toEqual(["good"]);
    expect(settings.assignments.good!.hex).toBe("#5f7f2a");
    expect(settings.mirrorGroups).toBe(false);
    expect(settings.syncFromCmux).toBe(true);
  });
});

describe("/api/repo-colors", () => {
  const discovery = {
    repoKeys: ["formic", "the-mountain"],
    names: { formic: "formic", "the-mountain": "the-mountain" },
    workspaces: { "WS-1": "the-mountain", "WS-2": "formic" },
  };

  async function subject(fanOut?: (writes: readonly { workspaceId: string; hex: string }[]) => void) {
    const store = await JsonRepoColorsStore.open("colors.json", memorySettingsFiles());
    return (request: Request) => handleRepoColorsRequest(request, store, {
      discover: () => discovery,
      ...(fanOut ? { fanOut } : {}),
    });
  }

  test("GET assigns every discovered repository and answers the contract shape", async () => {
    const handle = await subject();
    const body = await (await handle(new Request(`${ORIGIN}/api/repo-colors`))).json() as any;
    expect(body.ok).toBe(true);
    expect(Object.keys(body.settings.assignments).sort()).toEqual(["formic", "the-mountain"]);
    expect(body.workspaces["WS-1"]).toEqual({
      hex: body.settings.assignments["the-mountain"].hex,
      repoKey: "the-mountain",
    });
    expect(body.repoNames).toEqual(discovery.names);
  });

  test("GET fans out to repo-MAPPED workspaces only", async () => {
    const writes: { workspaceId: string; hex: string }[] = [];
    const handle = await subject((batch) => { writes.push(...batch); });
    await handle(new Request(`${ORIGIN}/api/repo-colors`));
    /* Authority rule 2: an unmapped workspace is cmux's own, and writing to it
       is a defect TINT-S would then fight forever. */
    expect(writes.map((write) => write.workspaceId).sort()).toEqual(["WS-1", "WS-2"]);
  });

  test("PUT sets an operator colour and re-asserts it on that repository's workspaces", async () => {
    const writes: { workspaceId: string; hex: string }[] = [];
    const handle = await subject((batch) => { writes.push(...batch); });
    const response = await handle(new Request(`${ORIGIN}/api/repo-colors/the-mountain`, {
      method: "PUT",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ hex: "#123456" }),
    }));
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.settings.assignments["the-mountain"]).toEqual({
      repoKey: "the-mountain", hex: "#123456", slot: null, source: "user",
    });
    expect(writes).toEqual([{ workspaceId: "WS-1", hex: "#123456" }]);
  });

  test("a mutating call without an exact same-origin Origin is refused", async () => {
    const handle = await subject();
    const response = await handle(new Request(`${ORIGIN}/api/repo-colors/formic`, {
      method: "PUT",
      headers: { origin: "http://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ hex: "#123456" }),
    }));
    expect(response.status).toBe(403);
  });

  test("a bad hex, a bad repo key and a bad verb each say what is wrong", async () => {
    const handle = await subject();
    const headers = { origin: ORIGIN, "content-type": "application/json" };
    const badHex = await handle(new Request(`${ORIGIN}/api/repo-colors/formic`, {
      method: "PUT", headers, body: JSON.stringify({ hex: "cornflower" }),
    }));
    expect(badHex.status).toBe(400);
    expect((await badHex.json() as any).error.code).toBe("INVALID_HEX");

    const badKey = await handle(new Request(`${ORIGIN}/api/repo-colors/..%2Fetc`, {
      method: "PUT", headers, body: JSON.stringify({ hex: "#123456" }),
    }));
    expect(badKey.status).toBe(400);
    expect((await badKey.json() as any).error.code).toBe("INVALID_REPO_KEY");

    const badVerb = await handle(new Request(`${ORIGIN}/api/repo-colors`, { method: "POST", headers }));
    expect(badVerb.status).toBe(405);
  });

  test("DELETE returns a repository to its palette slot AND pushes it to cmux", async () => {
    /* Clearing an override is a colour change, so it fans out exactly as
       setting one does. Returning the restored hex and writing nothing left
       cmux wearing the colour the operator just took back, until some later GET
       happened to notice — a write path that pushes only half its outcomes. */
    const writes: { workspaceId: string; hex: string }[] = [];
    const handle = await subject((batch) => { writes.push(...batch); });
    const headers = { origin: ORIGIN, "content-type": "application/json" };
    await handle(new Request(`${ORIGIN}/api/repo-colors/formic`, {
      method: "PUT", headers, body: JSON.stringify({ hex: "#123456" }),
    }));
    expect(writes).toEqual([{ workspaceId: "WS-2", hex: "#123456" }]);
    writes.length = 0;

    const body = await (await handle(new Request(`${ORIGIN}/api/repo-colors/formic`, {
      method: "DELETE", headers,
    }))).json() as any;
    const restored = body.settings.assignments.formic;
    expect(restored.source).toBe("auto");
    expect(restored.slot).not.toBeNull();
    expect(writes).toEqual([{ workspaceId: "WS-2", hex: restored.hex }]);
    // And only that repository's workspaces — formic's, never the-mountain's.
    expect(writes.every((write) => write.workspaceId === "WS-2")).toBe(true);
  });
});

/* ---------------------------------------------------------------------------
   The route as it is actually registered.

   Everything above drives handleRepoColorsRequest directly, which proves the
   handler and proves nothing about whether the board can reach it: the path
   match, the default store and the snapshot→discovery walk all live in app.ts
   and none of them are exercised by calling the handler by hand.
   ------------------------------------------------------------------------ */

describe("createMountainFetch wiring", () => {
  function board(agents: readonly Record<string, unknown>[]) {
    const snapshot = { ...emptySnapshot(), programs: [{ id: "p1", name: "p", agents: agents as never }] };
    const writes: { workspaceId: string; hex: string }[] = [];
    const fetch = createMountainFetch({
      state: { get: () => snapshot, subscribe: () => () => {}, refresh: async () => snapshot },
      runner: { run: async () => clean },
      archiveStore: { has: () => false, archive: async () => {} },
      /* The fan-out is stubbed for one reason: the real one writes colours to
         this machine's live cmux workspaces, and a test suite must not repaint
         somebody's sidebar. */
      repoColorFanOut: (batch) => { writes.push(...batch); },
      webRoot: import.meta.dir,
    });
    return { fetch, writes };
  }

  /* This worktree IS a linked worktree of the-mountain, so the real
     repoKeyForCwd behind the route has to collapse it to the repository — the
     exact trap the fake-git tests above are written against. */
  const here = import.meta.dir;

  test("GET /api/repo-colors reaches the handler and colours the live fleet", async () => {
    const { fetch, writes } = board([{
      id: "a1",
      repo: { repoKey: "hash", repoName: "the-mountain", worktreePath: here, ephemeral: false },
      target: { resolution: "exact", workspaceId: "WS-LIVE" },
    }]);
    const body = await (await fetch(new Request(`${ORIGIN}/api/repo-colors`))).json() as any;
    expect(body.ok).toBe(true);
    expect(Object.keys(body.settings.assignments)).toEqual(["the-mountain"]);
    expect(body.repoNames).toEqual({ "the-mountain": "the-mountain" });
    expect(body.workspaces["WS-LIVE"].repoKey).toBe("the-mountain");
    expect(writes).toEqual([{ workspaceId: "WS-LIVE", hex: body.settings.assignments["the-mountain"].hex }]);
    fetch.dispose();
  });

  test("an agent with no repository, and one with no workspace, are both left alone", async () => {
    const { fetch, writes } = board([
      { id: "a1", target: { resolution: "none" } },
      { id: "a2", repo: { repoKey: "h", repoName: "the-mountain", worktreePath: here, ephemeral: false }, target: { resolution: "none" } },
    ]);
    const body = await (await fetch(new Request(`${ORIGIN}/api/repo-colors`))).json() as any;
    expect(Object.keys(body.settings.assignments)).toEqual(["the-mountain"]);
    /* Authority rule 2 at the route: no workspace was resolved, so nothing in
       cmux is written to. */
    expect(body.workspaces).toEqual({});
    expect(writes).toEqual([]);
    fetch.dispose();
  });

  test("PUT reaches the handler through the same registration", async () => {
    const { fetch } = board([{
      id: "a1",
      repo: { repoKey: "h", repoName: "the-mountain", worktreePath: here, ephemeral: false },
      target: { resolution: "exact", workspaceId: "WS-LIVE" },
    }]);
    const response = await fetch(new Request(`${ORIGIN}/api/repo-colors/the-mountain`, {
      method: "PUT",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ hex: "#0E9494" }),
    }));
    const body = await response.json() as any;
    expect(response.status).toBe(200);
    expect(body.settings.assignments["the-mountain"]).toMatchObject({ hex: "#0e9494", source: "user" });
    fetch.dispose();
  });
});
