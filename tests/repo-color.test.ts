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
import type { CommandResult, CommandRunner } from "../src/server/types";

const ORIGIN = "http://127.0.0.1:4701";

/* ---------------------------------------------------------------------------
   The shared contract: repo key, slots, palette.
   ------------------------------------------------------------------------ */

/** A git stand-in that answers `rev-parse --git-common-dir` from a table of
 *  cwd → common dir, and refuses everything else the way git does. */
function fakeGit(table: Record<string, string>): RepoKeyExec {
  return (command) => {
    const cwd = command[2] ?? "";
    const answer = table[cwd];
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

  test("a group write goes through the same door, as an rpc with group_id", async () => {
    const { runner, calls } = recordingRunner(() => clean);
    configureCmuxColor({ runner });
    expect(await setGroupColor("GROUP-1", "#B05F3A", "mirror")).toBe(true);
    expect(calls[0]).toEqual([
      "/fake/cmux", "rpc", "workspace.group.set_color",
      JSON.stringify({ group_id: "GROUP-1", color: "#b05f3a" }),
    ]);
    /* Groups are mirrored FROM the board every pass and never read back as an
       operator's intent, so there is no loop for a memory to break. */
    expect(lastWrittenHex("GROUP-1")).toBeNull();
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

  test("DELETE returns a repository to its palette slot", async () => {
    const handle = await subject();
    const headers = { origin: ORIGIN, "content-type": "application/json" };
    await handle(new Request(`${ORIGIN}/api/repo-colors/formic`, {
      method: "PUT", headers, body: JSON.stringify({ hex: "#123456" }),
    }));
    const body = await (await handle(new Request(`${ORIGIN}/api/repo-colors/formic`, {
      method: "DELETE", headers,
    }))).json() as any;
    expect(body.settings.assignments.formic.source).toBe("auto");
  });
});
