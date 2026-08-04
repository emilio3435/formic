/* What work is finished but unpublished.

   An orchestrator running many agents accumulates committed-but-unpushed work
   faster than a human can track it. Measured on this machine while designing
   this: `main` sat 120 commits ahead of origin/main across 57 local branches,
   and the only way to learn that was to run git by hand. The cockpit showed
   none of it.

   Three rules shape what this reports.

   1. It NEVER publishes. No push, no one-click, no "publish" verb anywhere in
      this file. Publishing is the operator's decision and stays manual; this is
      read-only reporting, and the only git verbs it runs are remote, rev-parse,
      rev-list, for-each-ref and cherry — every one of which only reads. A test
      asserts that list, so a future edit cannot quietly widen it.

   2. It stays quiet about merged and abandoned work. A branch whose commits are
      already in the trunk is finished business and is counted, never listed.

   3. The trunk is measured separately from the branches, because otherwise the
      same commits are reported many times over. Every wave branch here descends
      from an unpublished main, so per-branch counts against the remote read
      "94 commits unpublished" on a dozen branches that share the same 120. The
      honest split is: the trunk's own debt, then each branch's UNIQUE work. */

import type { CommandResult, CommandRunner } from "./types";

/* A branch nobody has touched in this long is history, not a pending decision.
   Two weeks is a judgement call, and it is reported rather than applied
   silently: stale branches are counted and summarised, never itemised, so they
   cannot nag while still being visible as a number. */
export const STALE_BRANCH_MS = 14 * 24 * 60 * 60 * 1_000;
const GIT_TIMEOUT_MS = 5_000;
/* Enough to see the shape of the backlog without turning the surface into a
   branch manager. The remainder is reported as a count. */
const MAX_LISTED_BRANCHES = 8;

export interface UnpublishedBranch {
  name: string;
  /** Commits on this branch that are not in the local trunk. */
  unique: number;
  lastCommitAt: string;
  /** No commits within STALE_BRANCH_MS. Listed separately so it cannot nag. */
  stale: boolean;
}

export interface PublishState {
  /** False when git, the repo, or the remote could not be read. */
  available: boolean;
  /** Why not, in the operator's words. Present exactly when available is false. */
  reason?: string;
  /** The push target, so the operator knows where "published" would mean. */
  remote?: string;
  trunk?: {
    branch: string;
    /** Commits on the trunk that the remote does not have. */
    unpublished: number;
    /** Commits the remote has that the trunk does not. Non-zero means a plain
        push would not fast-forward, so the work is not ready to publish as-is. */
    behind: number;
    /** False when there is no remote-tracking ref to compare against at all. */
    tracked: boolean;
  };
  /** Branches holding work that is not in the trunk, newest first. */
  branches: UnpublishedBranch[];
  /** Unpublished branches beyond MAX_LISTED_BRANCHES. */
  more: number;
  /** Branches fully contained in the trunk. Counted, never listed. */
  merged: number;
  /** Unpublished branches untouched for longer than STALE_BRANCH_MS. */
  stale: number;
}

function unavailable(reason: string): PublishState {
  return { available: false, reason, branches: [], more: 0, merged: 0, stale: 0 };
}

async function git(
  runner: CommandRunner,
  cwd: string,
  args: readonly string[],
): Promise<CommandResult> {
  return runner.run(["git", "-C", cwd, ...args], GIT_TIMEOUT_MS);
}

async function countCommits(
  runner: CommandRunner,
  cwd: string,
  range: string,
): Promise<number | undefined> {
  const result = await git(runner, cwd, ["rev-list", "--count", range]);
  if (result.exitCode !== 0) return undefined;
  const count = Number.parseInt(result.stdout.trim(), 10);
  return Number.isFinite(count) ? count : undefined;
}

/* Commits on `branch` whose PATCH is not already in `trunk`.

   `--no-merged` only knows about ancestry, so a branch that was squash- or
   rebase-merged still looks unmerged forever — its commits are gone from the
   graph but its content is in the trunk. Measured here: nine leftover wave
   branches, every one of them already applied, all of which would have been
   listed as unpublished work indefinitely. `git cherry` compares patch ids and
   marks those "-", so they can be silenced on evidence rather than by guessing
   from a date. */
async function unappliedCommits(
  runner: CommandRunner,
  cwd: string,
  trunk: string,
  branch: string,
): Promise<number | undefined> {
  const result = await git(runner, cwd, ["cherry", trunk, branch]);
  if (result.exitCode !== 0) return undefined;
  return result.stdout
    .split("\n")
    .filter((line) => line.trimStart().startsWith("+"))
    .length;
}

/* Redacts credentials from a remote URL before it is shown. An https remote can
   carry a token in its userinfo, and this string is rendered. */
export function displayRemote(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  return trimmed.replace(/\/\/[^@/]*@/, "//");
}

export async function readPublishState(
  runner: CommandRunner,
  cwd: string,
  nowMs: number = Date.now(),
): Promise<PublishState> {
  const remoteResult = await git(runner, cwd, ["remote", "get-url", "origin"]);
  if (remoteResult.exitCode !== 0) {
    /* No origin is a real answer, not a failure to report: a repo with nowhere
       to publish has no unpublished work by definition.

       But "no origin" is a CAUSE, and this reported it without establishing it.
       `git remote get-url` also fails when the directory is not a repository at
       all — someone who downloaded a zip rather than cloning — and telling them
       to configure a remote sends them to fix the wrong thing. Naming a cause
       we did not check is the defect this file exists to avoid, so the two are
       now distinguished by asking. */
    const insideRepo = await git(runner, cwd, ["rev-parse", "--is-inside-work-tree"]);
    if (insideRepo.exitCode !== 0) {
      return unavailable("This folder is not a git repository, so there is nothing to publish from.");
    }
    return unavailable("No origin remote is configured, so nothing can be published.");
  }
  const remote = displayRemote(remoteResult.stdout);

  const trunkName = await resolveTrunk(runner, cwd);
  if (!trunkName) {
    return { ...unavailable("No main or master branch was found to measure against."), remote };
  }

  const tracked = (await git(runner, cwd, ["rev-parse", "--verify", `origin/${trunkName}`])).exitCode === 0;
  const unpublished = tracked ? await countCommits(runner, cwd, `origin/${trunkName}..${trunkName}`) : undefined;
  const behind = tracked ? await countCommits(runner, cwd, `${trunkName}..origin/${trunkName}`) : undefined;
  if (tracked && (unpublished === undefined || behind === undefined)) {
    return { ...unavailable(`Could not compare ${trunkName} with origin/${trunkName}.`), remote };
  }

  /* One call for everything merged, so the common case costs nothing per
     branch. Only the remainder is measured individually. */
  const unmerged = await git(runner, cwd, [
    "for-each-ref", "--no-merged", trunkName,
    "--format=%(refname:short)|%(committerdate:iso-strict)", "refs/heads/",
  ]);
  const allRefs = await git(runner, cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"]);
  const totalBranches = allRefs.exitCode === 0
    ? allRefs.stdout.split("\n").map((line) => line.trim()).filter(Boolean).length
    : 0;

  const branches: UnpublishedBranch[] = [];
  if (unmerged.exitCode === 0) {
    for (const line of unmerged.stdout.split("\n")) {
      const [name, lastCommitAt] = line.split("|");
      if (!name?.trim() || name.trim() === trunkName) continue;
      const unique = await unappliedCommits(runner, cwd, trunkName, name.trim());
      // A branch we cannot measure is skipped rather than guessed at.
      if (unique === undefined || unique === 0) continue;
      const at = lastCommitAt?.trim() ?? "";
      const atMs = Date.parse(at);
      branches.push({
        name: name.trim(),
        unique,
        lastCommitAt: at,
        stale: Number.isFinite(atMs) ? nowMs - atMs > STALE_BRANCH_MS : false,
      });
    }
  }

  branches.sort((left, right) =>
    right.lastCommitAt.localeCompare(left.lastCommitAt) || right.unique - left.unique);
  /* Fresh work is what an operator can still act on, so stale branches never
     displace it in the list even when they are larger. */
  const listed = [...branches.filter((b) => !b.stale), ...branches.filter((b) => b.stale)];

  return {
    available: true,
    remote,
    trunk: {
      branch: trunkName,
      unpublished: unpublished ?? 0,
      behind: behind ?? 0,
      tracked,
    },
    branches: listed.slice(0, MAX_LISTED_BRANCHES),
    more: Math.max(0, listed.length - MAX_LISTED_BRANCHES),
    merged: Math.max(0, totalBranches - branches.length - 1),
    stale: branches.filter((branch) => branch.stale).length,
  };
}

async function resolveTrunk(runner: CommandRunner, cwd: string): Promise<string | undefined> {
  for (const candidate of ["main", "master"]) {
    if ((await git(runner, cwd, ["rev-parse", "--verify", candidate])).exitCode === 0) return candidate;
  }
  return undefined;
}
