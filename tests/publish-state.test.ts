import { describe, expect, test } from "bun:test";
import {
  displayRemote,
  readPublishState,
  STALE_BRANCH_MS,
} from "../src/server/publish-state";
import type { CommandResult, CommandRunner } from "../src/server/types";

/* An orchestrator running many agents accumulates committed-but-unpushed work
   faster than a human tracks it. Measured while designing this: main sat 120
   commits ahead of origin/main across 57 local branches, and the only way to
   learn that was to run git by hand.

   The properties worth pinning are not the numbers but the manners: it never
   publishes, it stays quiet about merged and abandoned work, and it says so
   plainly when it cannot tell. */

const NOW = Date.parse("2026-08-02T12:00:00.000Z");
const fresh = new Date(NOW - 60 * 60 * 1_000).toISOString();
const ancient = new Date(NOW - STALE_BRANCH_MS - 60 * 60 * 1_000).toISOString();

function ok(stdout: string): CommandResult {
  return { exitCode: 0, stdout, stderr: "", timedOut: false };
}
function fail(): CommandResult {
  return { exitCode: 1, stdout: "", stderr: "not found", timedOut: false };
}

/* A git stub keyed on the meaningful part of each argv, so a test states only
   what it cares about and anything unasked-for fails closed. */
function gitRunner(replies: Record<string, CommandResult>): CommandRunner & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async run(command: readonly string[]): Promise<CommandResult> {
      calls.push([...command]);
      const args = command.slice(3).join(" "); // drop ["git","-C",cwd]
      for (const [key, reply] of Object.entries(replies)) {
        if (args === key || args.startsWith(`${key} `)) return reply;
      }
      return fail();
    },
  };
}

const REPO = {
  "remote get-url origin": ok("https://github.com/emilio3435/the-ant-hill.git\n"),
  "rev-parse --verify main": ok("abc123\n"),
  "rev-parse --verify origin/main": ok("def456\n"),
  "rev-list --count origin/main..main": ok("120\n"),
  "rev-list --count main..origin/main": ok("0\n"),
};

describe("publish state", () => {
  test("reports the trunk's own backlog separately from the branches", async () => {
    /* The design decision this pins. Every wave branch descends from an
       unpublished main, so counting each branch against the REMOTE reported
       "94 commits unpublished" on a dozen branches that shared the same 120.
       The trunk's debt is stated once; branches report only their own work. */
    const runner = gitRunner({
      ...REPO,
      "for-each-ref --no-merged main": ok(`feature/live|${fresh}\n`),
      "for-each-ref --format=%(refname:short) refs/heads/": ok("main\nfeature/live\nold/one\nold/two\n"),
      "cherry main feature/live": ok("+ aaa\n".repeat(98)),
    });

    const state = await readPublishState(runner, "/repo", NOW);

    expect(state.available).toBe(true);
    expect(state.trunk).toEqual({ branch: "main", unpublished: 120, behind: 0, tracked: true });
    expect(state.branches).toEqual([
      { name: "feature/live", unique: 98, lastCommitAt: fresh, stale: false },
    ]);
    // Merged branches are counted, never listed: finished business must not nag.
    expect(state.merged).toBe(2);
  });

  test("never runs a command that could publish", async () => {
    const runner = gitRunner({
      ...REPO,
      "for-each-ref --no-merged main": ok(`leftover|${fresh}\n`),
      "for-each-ref --format=%(refname:short) refs/heads/": ok("main\nleftover\n"),
      "cherry main leftover": ok("+ ccc\n"),
    });

    await readPublishState(runner, "/repo", NOW);

    /* The hard rule. Publishing is the operator's decision and stays manual, so
       this surface must be incapable of it — not merely uninterested. */
    const verbs = runner.calls.map((call) => call[3]);
    expect(verbs.every((verb) => ["remote", "rev-parse", "rev-list", "for-each-ref", "cherry"].includes(verb ?? ""))).toBe(true);
    for (const forbidden of ["push", "commit", "merge", "rebase", "reset", "checkout", "fetch"]) {
      expect(runner.calls.flat()).not.toContain(forbidden);
    }
  });

  test("a branch untouched for a fortnight is counted as stale, not paraded", async () => {
    const runner = gitRunner({
      ...REPO,
      "for-each-ref --no-merged main": ok(`old/straggler|${ancient}\nfeature/live|${fresh}\n`),
      "for-each-ref --format=%(refname:short) refs/heads/": ok("main\nold/straggler\nfeature/live\n"),
      "cherry main old/straggler": ok("+ bbb\n"),
      "cherry main feature/live": ok("+ aaa\n".repeat(98)),
    });

    const state = await readPublishState(runner, "/repo", NOW);

    expect(state.stale).toBe(1);
    // Fresh work leads regardless of size: it is what an operator can still act on.
    expect(state.branches[0]?.name).toBe("feature/live");
    expect(state.branches[1]).toMatchObject({ name: "old/straggler", stale: true });
  });

  test("a trunk behind its remote is reported, because a plain push would not fast-forward", async () => {
    const runner = gitRunner({
      ...REPO,
      "rev-list --count main..origin/main": ok("7\n"),
      "for-each-ref --no-merged main": ok(""),
      "for-each-ref --format=%(refname:short) refs/heads/": ok("main\n"),
    });

    const state = await readPublishState(runner, "/repo", NOW);

    expect(state.trunk).toMatchObject({ unpublished: 120, behind: 7 });
  });

  test("no origin is a real answer, not a failure to report", async () => {
    const state = await readPublishState(gitRunner({}), "/repo", NOW);

    expect(state.available).toBe(false);
    expect(state.reason).toContain("No origin remote");
    expect(state.branches).toEqual([]);
  });

  test("an untracked trunk says so rather than inventing a count", async () => {
    const runner = gitRunner({
      "remote get-url origin": ok("git@github.com:emilio3435/the-ant-hill.git\n"),
      "rev-parse --verify main": ok("abc\n"),
      "for-each-ref --no-merged main": ok(""),
      "for-each-ref --format=%(refname:short) refs/heads/": ok("main\n"),
    });

    const state = await readPublishState(runner, "/repo", NOW);

    // origin/main does not exist locally, so there is nothing to compare to.
    expect(state.trunk).toMatchObject({ tracked: false, unpublished: 0 });
  });

  test("a branch whose size cannot be measured is skipped, not guessed at", async () => {
    const runner = gitRunner({
      ...REPO,
      "for-each-ref --no-merged main": ok(`broken/ref|${fresh}\n`),
      "for-each-ref --format=%(refname:short) refs/heads/": ok("main\nbroken/ref\n"),
      // no cherry reply for broken/ref: the stub fails closed
    });

    const state = await readPublishState(runner, "/repo", NOW);

    expect(state.branches).toEqual([]);
  });

  test("credentials in a remote URL are never echoed back", async () => {
    // This string is rendered, and an https remote can carry a token.
    expect(displayRemote("https://user:ghp_secret@github.com/emilio3435/the-ant-hill.git"))
      .toBe("https://github.com/emilio3435/the-ant-hill.git");
    expect(displayRemote("git@github.com:emilio3435/the-ant-hill.git"))
      .toBe("git@github.com:emilio3435/the-ant-hill.git");
  });
});
