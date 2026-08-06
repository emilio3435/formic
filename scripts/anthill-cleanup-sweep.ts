#!/usr/bin/env bun
/**
 * Ant Hill cleanup sweep — S6-T1 / S6-T2.
 *
 * ENUMERATE and REPORT completed worktrees and merged local branches, then
 * (only after the operator confirms a written plan) remove them. Never
 * autonomous: propose writes a plan with per-item rollback SHAs and occupancy
 * evidence; confirm re-verifies and only then runs `git worktree remove` and
 * `git branch -d`. Never `-D`. Never `--force`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * THE BOARD NEVER DELETES.
 *
 * The header chip's Clean up action runs `propose` ONLY. Its JSON becomes a
 * notification-center dataflow item listing what is removable, each rollback
 * SHA, and the exact `confirm` command to paste in a terminal. A browser click
 * is not the same gate as a human reading a plan in a terminal — the precedent
 * this program matches is a manual pass that was careful never to delete
 * without a person in the loop.
 *
 *   • No destructive server endpoint, ever.
 *   • Do not wire `confirm` to a route, a button handler, or any UI click.
 *   • Deletion stays a terminal action: the operator pastes `confirmCommand`.
 *
 * Contract for FE: `docs/CLEANUP-SWEEP.md` (fields the notification item needs).
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Occupancy uses the repo's one pid→liveness home (`src/server/process-liveness.ts`)
 * plus `isRecognizedAgentProcess` from identity.ts. A pid found in the process
 * table is NOT liveness — that mistake is why process-liveness.ts exists. A live
 * or unverifiable agent cwd'd inside a worktree is a hard stop regardless of
 * operator approval (A8).
 *
 * `propose` is read-only on the repo and process table. It is safe to run while
 * agents are live, and safe to run twice (double-click): each run atomically
 * replaces the plan file under a lock; nothing is deleted.
 *
 * Usage:
 *   bun scripts/anthill-cleanup-sweep.ts propose [--repo <path>] [--out <plan.json>] [--json]
 *   bun scripts/anthill-cleanup-sweep.ts confirm <plan.json> [--repo <path>]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isRecognizedAgentProcess } from "../src/server/identity";
import {
  livenessOf,
  type ProcessHandle,
  type ProcessLiveness,
  type ProcessRoster,
} from "../src/server/process-liveness";
import { atomicWriteJson, withFileLock } from "./lib/atomic-json";

export const PLAN_VERSION = 1 as const;
export const DEFAULT_MAIN = "main";

export type TreeState = "clean" | "dirty";

export interface OccupantEvidence {
  pid: number;
  command: string;
  cwd: string;
  /** From process-liveness. Bare pid presence never becomes "alive" here. */
  liveness: ProcessLiveness;
  startSeconds?: number;
}

export interface WorktreeReport {
  path: string;
  branch: string | null;
  headSha: string;
  treeState: TreeState;
  mergedIntoMain: boolean;
  isPrimary: boolean;
  occupants: OccupantEvidence[];
  refusals: string[];
  eligible: boolean;
}

export interface BranchReport {
  name: string;
  tipSha: string;
  mergedIntoMain: boolean;
  checkedOutAt: string | null;
  refusals: string[];
  eligible: boolean;
}

export type ProposedRemoval =
  | {
    kind: "worktree";
    path: string;
    branch: string | null;
    rollbackSha: string;
    treeState: TreeState;
    mergedIntoMain: true;
    occupants: OccupantEvidence[];
  }
  | {
    kind: "branch";
    name: string;
    rollbackSha: string;
    mergedIntoMain: true;
  };

export interface CleanupPlan {
  version: typeof PLAN_VERSION;
  createdAt: string;
  repoRoot: string;
  mainRef: string;
  mainTipSha: string;
  worktrees: WorktreeReport[];
  branches: BranchReport[];
  proposed: ProposedRemoval[];
  /** Stable hash of the facts confirm must still observe. */
  fingerprint: string;
  /** Absolute path this plan was written to (set by writePlan). */
  planPath?: string;
  /** Exact terminal command to paste — the only deletion gate. */
  confirmCommand?: string;
}

/** Compact shape the notification-center dataflow item builds from. See docs/CLEANUP-SWEEP.md. */
export interface CleanupNotificationView {
  version: typeof PLAN_VERSION;
  createdAt: string;
  repoRoot: string;
  mainRef: string;
  mainTipSha: string;
  fingerprint: string;
  planPath: string;
  /** Paste into a terminal. Never invoke from the board. */
  confirmCommand: string;
  removable: Array<{
    kind: "worktree" | "branch";
    target: string;
    rollbackSha: string;
    branch?: string | null;
  }>;
  refused: {
    worktrees: Array<{ path: string; branch: string | null; reasons: string[] }>;
    branches: Array<{ name: string; reasons: string[] }>;
  };
}

export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type GitRunner = (args: readonly string[], cwd: string) => GitResult;

export interface ProcessRow {
  pid: number;
  startSeconds: number;
  command: string;
}

export interface SweepHost {
  git: GitRunner;
  /** Full process table used to build the liveness roster. */
  listProcesses: () => { complete: boolean; rows: ProcessRow[] };
  /** cwd per pid for recognized agent pids (and only those we ask about). */
  cwdOf: (pids: readonly number[]) => Map<number, string>;
  nowIso: () => string;
  realpath: (path: string) => string;
}

export class CleanupEnumerationIncompleteError extends Error {
  readonly code = "CLEANUP_ENUMERATION_INCOMPLETE";

  constructor(message: string) {
    super(message);
    this.name = "CleanupEnumerationIncompleteError";
  }
}

function runGit(args: readonly string[], cwd: string): GitResult {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, LC_ALL: "C" },
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function parsePsLstart(stdout: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of stdout.split("\n")) {
    const match = line.match(
      /^\s*(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/,
    );
    if (!match) continue;
    const pid = Number(match[1]);
    const startedAtMs = Date.parse(match[2]!);
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isFinite(startedAtMs)) continue;
    rows.push({
      pid,
      startSeconds: Math.floor(startedAtMs / 1_000),
      command: match[3]!.trim(),
    });
  }
  return rows;
}

export function processTableFromPs(stdout: string): { complete: boolean; rows: ProcessRow[] } {
  const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
  const rows = parsePsLstart(stdout);
  return { complete: lines.length > 0 && rows.length === lines.length, rows };
}

function listProcessesDefault(): { complete: boolean; rows: ProcessRow[] } {
  const result = Bun.spawnSync(["ps", "-axo", "pid=,lstart=,command="], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, LC_ALL: "C" },
  });
  if (result.exitCode !== 0) return { complete: false, rows: [] };
  return processTableFromPs(result.stdout.toString());
}

function cwdOfDefault(pids: readonly number[]): Map<number, string> {
  const out = new Map<number, string>();
  if (pids.length === 0) return out;
  const result = Bun.spawnSync(
    ["/usr/sbin/lsof", "-a", "-d", "cwd", "-p", pids.join(","), "-Fn"],
    { stdout: "pipe", stderr: "pipe", env: { ...process.env, LC_ALL: "C" } },
  );
  let pid: number | undefined;
  for (const line of result.stdout.toString().split("\n")) {
    if (line.startsWith("p") && /^p\d+$/.test(line)) {
      pid = Number(line.slice(1));
    } else if (pid !== undefined && line.startsWith("n")) {
      out.set(pid, line.slice(1));
    }
  }
  return out;
}

export function defaultHost(): SweepHost {
  return {
    git: runGit,
    listProcesses: listProcessesDefault,
    cwdOf: cwdOfDefault,
    nowIso: () => new Date().toISOString(),
    realpath: (path) => {
      try {
        return realpathSync(path);
      } catch {
        return resolve(path);
      }
    },
  };
}

function gitOk(host: SweepHost, args: readonly string[], cwd: string): string {
  const result = host.git(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${result.exitCode}): ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result.stdout;
}

function gitText(host: SweepHost, args: readonly string[], cwd: string): string {
  return gitOk(host, args, cwd).trim();
}

export function buildRoster(rows: readonly ProcessRow[], complete: boolean): ProcessRoster {
  const startsByPid = new Map(rows.map((row) => [row.pid, row.startSeconds] as const));
  const agentPids = new Set(
    rows.filter((row) => isRecognizedAgentProcess(row.command)).map((row) => row.pid),
  );
  return { complete, startsByPid, agentPids };
}

export function pathInsideWorktree(cwd: string, worktreePath: string, realpath: (p: string) => string): boolean {
  const root = realpath(worktreePath).replace(/\/+$/, "");
  let cursor: string;
  try {
    cursor = realpath(cwd).replace(/\/+$/, "");
  } catch {
    cursor = resolve(cwd).replace(/\/+$/, "");
  }
  return cursor === root || cursor.startsWith(`${root}/`);
}

/**
 * Occupancy evidence for worktrees. Only recognized agent processes are
 * considered; each is judged through livenessOf. Presence alone never hard-stops.
 * `alive` and `unverifiable` both refuse deletion (fail-closed). `gone` does not.
 */
export function occupantsForWorktrees(
  worktreePaths: readonly string[],
  host: SweepHost,
): Map<string, OccupantEvidence[]> {
  const byTree = new Map<string, OccupantEvidence[]>();
  for (const path of worktreePaths) byTree.set(host.realpath(path), []);

  const { complete, rows } = host.listProcesses();
  if (!complete) {
    throw new CleanupEnumerationIncompleteError(
      "Process table enumeration is incomplete; no cleanup plan was produced.",
    );
  }
  const roster = buildRoster(rows, complete);
  const agentRows = rows.filter((row) => isRecognizedAgentProcess(row.command));
  const cwds = host.cwdOf(agentRows.map((row) => row.pid));
  const missingCwds = agentRows.filter((row) => !cwds.has(row.pid));
  if (missingCwds.length > 0) {
    throw new CleanupEnumerationIncompleteError(
      `Process cwd enumeration is incomplete for ${missingCwds.length} recognized agent process(es); no cleanup plan was produced.`,
    );
  }

  for (const row of agentRows) {
    const cwd = cwds.get(row.pid);
    if (!cwd) continue;
    const handle: ProcessHandle = { pid: row.pid, startSeconds: row.startSeconds };
    const liveness = livenessOf(handle, roster);
    const evidence: OccupantEvidence = {
      pid: row.pid,
      command: row.command,
      cwd,
      liveness,
      startSeconds: row.startSeconds,
    };
    for (const [treePath, list] of byTree) {
      if (pathInsideWorktree(cwd, treePath, host.realpath)) list.push(evidence);
    }
  }
  return byTree;
}

export function blockingOccupants(occupants: readonly OccupantEvidence[]): OccupantEvidence[] {
  return occupants.filter((o) => o.liveness === "alive" || o.liveness === "unverifiable");
}

interface PorcelainWorktree {
  path: string;
  head: string;
  branch: string | null;
  bare: boolean;
}

export function parseWorktreePorcelain(stdout: string): PorcelainWorktree[] {
  const trees: PorcelainWorktree[] = [];
  let current: Partial<PorcelainWorktree> = {};
  const flush = () => {
    if (typeof current.path === "string" && typeof current.head === "string") {
      trees.push({
        path: current.path,
        head: current.head,
        branch: current.branch ?? null,
        bare: Boolean(current.bare),
      });
    }
    current = {};
  };
  for (const line of stdout.split("\n")) {
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) current.path = line.slice("worktree ".length);
    else if (line.startsWith("HEAD ")) current.head = line.slice("HEAD ".length);
    else if (line.startsWith("branch ")) {
      const ref = line.slice("branch ".length);
      current.branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
    } else if (line === "bare") current.bare = true;
    else if (line === "detached") current.branch = null;
  }
  flush();
  return trees;
}

function treeStateOf(host: SweepHost, worktreePath: string): TreeState {
  const result = host.git(["status", "--porcelain"], worktreePath);
  if (result.exitCode !== 0) return "dirty";
  return result.stdout.trim() === "" ? "clean" : "dirty";
}

function isMergedIntoMain(host: SweepHost, repoRoot: string, mainRef: string, tipSha: string): boolean {
  // `git merge-base --is-ancestor <tip> <main>` → 0 when tip is an ancestor of main.
  const result = host.git(["merge-base", "--is-ancestor", tipSha, mainRef], repoRoot);
  return result.exitCode === 0;
}

function listLocalBranches(host: SweepHost, repoRoot: string): Array<{ name: string; tipSha: string }> {
  const stdout = gitOk(host, ["for-each-ref", "refs/heads/", "--format=%(refname:short)\t%(objectname)"], repoRoot);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, tipSha] = line.split("\t");
      return { name: name!, tipSha: tipSha! };
    });
}

export function worktreeRefusals(report: Omit<WorktreeReport, "refusals" | "eligible">): string[] {
  const refusals: string[] = [];
  if (report.isPrimary) refusals.push("primary worktree — never remove the main checkout");
  if (report.treeState === "dirty") refusals.push("dirty worktree — commit, stash, or discard local changes first");
  if (!report.mergedIntoMain) refusals.push("branch tip is not merged into main — refusing (would need -D)");
  const blockers = blockingOccupants(report.occupants);
  if (blockers.some((o) => o.liveness === "alive")) {
    refusals.push("live agent process cwd'd inside this worktree — hard stop");
  }
  if (blockers.some((o) => o.liveness === "unverifiable")) {
    refusals.push("unverifiable agent process cwd'd inside this worktree — fail-closed hard stop");
  }
  return refusals;
}

export function branchRefusals(
  report: Omit<BranchReport, "refusals" | "eligible">,
  mainRef: string,
): string[] {
  const refusals: string[] = [];
  if (report.name === mainRef) refusals.push("refuses to delete main");
  if (!report.mergedIntoMain) refusals.push("branch is not merged into main — git branch -d would refuse; never -D");
  if (report.checkedOutAt) refusals.push(`branch is checked out at ${report.checkedOutAt}`);
  return refusals;
}

export function fingerprintPlan(input: {
  mainTipSha: string;
  proposed: readonly ProposedRemoval[];
}): string {
  const payload = {
    mainTipSha: input.mainTipSha,
    proposed: input.proposed.map((item) => {
      if (item.kind === "worktree") {
        return {
          kind: item.kind,
          path: item.path,
          branch: item.branch,
          rollbackSha: item.rollbackSha,
          treeState: item.treeState,
          occupants: item.occupants.map((o) => ({
            pid: o.pid,
            startSeconds: o.startSeconds ?? null,
            liveness: o.liveness,
            cwd: o.cwd,
          })),
        };
      }
      return {
        kind: item.kind,
        name: item.name,
        rollbackSha: item.rollbackSha,
      };
    }),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function enumerateCleanup(repoRoot: string, host: SweepHost = defaultHost(), mainRef = DEFAULT_MAIN): CleanupPlan {
  const root = host.realpath(repoRoot);
  const mainTipSha = gitText(host, ["rev-parse", mainRef], root);
  const porcelain = parseWorktreePorcelain(gitOk(host, ["worktree", "list", "--porcelain"], root));
  const trees = porcelain.filter((tree) => !tree.bare);
  const primaryPath = trees[0] ? host.realpath(trees[0].path) : root;

  const occupantMap = occupantsForWorktrees(trees.map((tree) => tree.path), host);

  const worktrees: WorktreeReport[] = trees.map((tree) => {
    const path = host.realpath(tree.path);
    const headSha = tree.head;
    const mergedIntoMain = isMergedIntoMain(host, root, mainRef, headSha);
    const base = {
      path,
      branch: tree.branch,
      headSha,
      treeState: treeStateOf(host, path),
      mergedIntoMain,
      isPrimary: path === primaryPath,
      occupants: occupantMap.get(path) ?? [],
    };
    const refusals = worktreeRefusals(base);
    return { ...base, refusals, eligible: refusals.length === 0 };
  });

  const checkedOut = new Map<string, string>();
  for (const tree of worktrees) {
    if (tree.branch) checkedOut.set(tree.branch, tree.path);
  }

  const branches: BranchReport[] = listLocalBranches(host, root).map((branch) => {
    const mergedIntoMain = isMergedIntoMain(host, root, mainRef, branch.tipSha);
    const base = {
      name: branch.name,
      tipSha: branch.tipSha,
      mergedIntoMain,
      checkedOutAt: checkedOut.get(branch.name) ?? null,
    };
    const refusals = branchRefusals(base, mainRef);
    return { ...base, refusals, eligible: refusals.length === 0 };
  });

  const proposed: ProposedRemoval[] = [];
  const branchesCoveredByWorktree = new Set<string>();

  for (const tree of worktrees) {
    if (!tree.eligible) continue;
    proposed.push({
      kind: "worktree",
      path: tree.path,
      branch: tree.branch,
      rollbackSha: tree.headSha,
      treeState: "clean",
      mergedIntoMain: true,
      occupants: tree.occupants,
    });
    if (tree.branch) branchesCoveredByWorktree.add(tree.branch);
  }

  for (const branch of branches) {
    /* A branch checked out in a worktree we are already removing is still
       deletable — worktree remove runs first. Other refusals (unmerged, main)
       still apply. */
    const covered = branchesCoveredByWorktree.has(branch.name);
    const refusals = branch.refusals.filter((reason) =>
      !(covered && reason.startsWith("branch is checked out")),
    );
    if (refusals.length > 0) continue;
    if (!branch.mergedIntoMain || branch.name === mainRef) continue;
    proposed.push({
      kind: "branch",
      name: branch.name,
      rollbackSha: branch.tipSha,
      mergedIntoMain: true,
    });
  }

  const fingerprint = fingerprintPlan({ mainTipSha, proposed });
  return {
    version: PLAN_VERSION,
    createdAt: host.nowIso(),
    repoRoot: root,
    mainRef,
    mainTipSha,
    worktrees,
    branches,
    proposed,
    fingerprint,
  };
}

export function assertPlanShape(value: unknown): CleanupPlan {
  if (!value || typeof value !== "object") throw new Error("plan is not an object");
  const plan = value as CleanupPlan;
  if (plan.version !== PLAN_VERSION) throw new Error(`unsupported plan version: ${String((value as { version?: unknown }).version)}`);
  if (typeof plan.fingerprint !== "string" || !plan.fingerprint) throw new Error("plan missing fingerprint");
  if (typeof plan.repoRoot !== "string" || !plan.repoRoot) throw new Error("plan missing repoRoot");
  if (!Array.isArray(plan.proposed)) throw new Error("plan missing proposed[]");
  return plan;
}

export interface ConfirmResult {
  ok: boolean;
  refused?: string;
  executed: Array<{ kind: "worktree" | "branch"; target: string; command: string[] }>;
  rollbacks: Array<{ branch: string; rollbackSha: string }>;
}

/**
 * Re-enumerate, demand an identical fingerprint, then remove. Every git command
 * is recorded so tests can assert `-D` and `--force` never appear.
 */
export function confirmCleanup(
  plan: CleanupPlan,
  host: SweepHost = defaultHost(),
): ConfirmResult {
  const executed: ConfirmResult["executed"] = [];
  const rollbacks: ConfirmResult["rollbacks"] = [];
  const root = host.realpath(plan.repoRoot);

  const fresh = enumerateCleanup(root, host, plan.mainRef);
  if (fresh.mainTipSha !== plan.mainTipSha || fresh.fingerprint !== plan.fingerprint) {
    return {
      ok: false,
      refused: "plan has gone stale between propose and confirm — re-run propose",
      executed,
      rollbacks,
    };
  }

  // Worktrees first, then branches. Re-check each item immediately before acting.
  for (const item of plan.proposed) {
    if (item.kind === "worktree") {
      const report = fresh.worktrees.find((tree) => tree.path === item.path);
      if (!report) {
        return { ok: false, refused: `worktree vanished: ${item.path}`, executed, rollbacks };
      }
      if (report.headSha !== item.rollbackSha) {
        return {
          ok: false,
          refused: `worktree HEAD moved since propose (${item.path}); plan stale`,
          executed,
          rollbacks,
        };
      }
      if (!report.eligible) {
        return {
          ok: false,
          refused: `worktree no longer eligible: ${item.path} — ${report.refusals.join("; ")}`,
          executed,
          rollbacks,
        };
      }
      const removeArgs = ["worktree", "remove", item.path];
      if (removeArgs.includes("--force") || removeArgs.includes("-f")) {
        throw new Error("internal error: worktree remove must never pass --force");
      }
      const result = host.git(removeArgs, root);
      executed.push({ kind: "worktree", target: item.path, command: ["git", ...removeArgs] });
      if (result.exitCode !== 0) {
        return {
          ok: false,
          refused: `git worktree remove refused for ${item.path}: ${result.stderr.trim() || result.stdout.trim()}`,
          executed,
          rollbacks,
        };
      }
      if (item.branch) rollbacks.push({ branch: item.branch, rollbackSha: item.rollbackSha });
    }
  }

  for (const item of plan.proposed) {
    if (item.kind !== "branch") continue;
    const report = fresh.branches.find((branch) => branch.name === item.name);
    if (!report) {
      return { ok: false, refused: `branch vanished: ${item.name}`, executed, rollbacks };
    }
    if (report.tipSha !== item.rollbackSha) {
      return {
        ok: false,
        refused: `branch tip moved since propose (${item.name}); plan stale`,
        executed,
        rollbacks,
      };
    }
    // After worktree removal the branch may no longer be checked out.
    const stillCheckedOut = fresh.worktrees.some(
      (tree) => tree.branch === item.name && existsSync(tree.path),
    );
    if (stillCheckedOut) {
      return {
        ok: false,
        refused: `branch ${item.name} is still checked out — hard stop`,
        executed,
        rollbacks,
      };
    }
    if (!report.mergedIntoMain) {
      return {
        ok: false,
        refused: `branch ${item.name} is not merged into main — refusing -D`,
        executed,
        rollbacks,
      };
    }
    const deleteArgs = ["branch", "-d", item.name];
    if (deleteArgs.includes("-D") || deleteArgs.includes("--force")) {
      throw new Error("internal error: branch delete must use -d, never -D");
    }
    const result = host.git(deleteArgs, root);
    executed.push({ kind: "branch", target: item.name, command: ["git", ...deleteArgs] });
    rollbacks.push({ branch: item.name, rollbackSha: item.rollbackSha });
    if (result.exitCode !== 0) {
      return {
        ok: false,
        refused: `git branch -d refused for ${item.name}: ${result.stderr.trim() || result.stdout.trim()}`,
        executed,
        rollbacks,
      };
    }
  }

  return { ok: true, executed, rollbacks };
}

export function confirmCommandFor(planPath: string): string {
  return `bun scripts/anthill-cleanup-sweep.ts confirm ${planPath}`;
}

/**
 * The fields a notification-center dataflow item needs — removable work,
 * refusals with reasons, and the confirm command string. Derived from a plan;
 * never a second source of truth.
 */
export function notificationViewFromPlan(plan: CleanupPlan, planPath: string): CleanupNotificationView {
  const abs = resolve(planPath);
  return {
    version: plan.version,
    createdAt: plan.createdAt,
    repoRoot: plan.repoRoot,
    mainRef: plan.mainRef,
    mainTipSha: plan.mainTipSha,
    fingerprint: plan.fingerprint,
    planPath: abs,
    confirmCommand: confirmCommandFor(abs),
    removable: plan.proposed.map((item) => (
      item.kind === "worktree"
        ? {
          kind: "worktree" as const,
          target: item.path,
          rollbackSha: item.rollbackSha,
          branch: item.branch,
        }
        : {
          kind: "branch" as const,
          target: item.name,
          rollbackSha: item.rollbackSha,
        }
    )),
    refused: {
      worktrees: plan.worktrees
        .filter((tree) => !tree.eligible)
        .map((tree) => ({
          path: tree.path,
          branch: tree.branch,
          reasons: tree.refusals,
        })),
      branches: plan.branches
        .filter((branch) => !branch.eligible)
        .map((branch) => ({
          name: branch.name,
          reasons: branch.refusals,
        })),
    },
  };
}

/**
 * Write the plan under an exclusive lock + atomic rename.
 * Safe for double-click / concurrent propose: waiters serialize; each winner
 * replaces the file wholly. Never partial JSON. Does not delete anything.
 */
export function writePlan(plan: CleanupPlan, outPath: string): CleanupPlan {
  const abs = resolve(outPath);
  mkdirSync(dirname(abs), { recursive: true });
  const enriched: CleanupPlan = {
    ...plan,
    planPath: abs,
    confirmCommand: confirmCommandFor(abs),
  };
  withFileLock(`${abs}.lock`, () => {
    atomicWriteJson(abs, enriched);
  });
  return enriched;
}

export function readPlan(path: string): CleanupPlan {
  return assertPlanShape(JSON.parse(readFileSync(path, "utf8")));
}

/** propose end-to-end: enumerate (read-only) then locked write. */
export function runPropose(
  repoRoot: string,
  outPath: string,
  host: SweepHost = defaultHost(),
  mainRef = DEFAULT_MAIN,
): { plan: CleanupPlan; notification: CleanupNotificationView } {
  const plan = enumerateCleanup(repoRoot, host, mainRef);
  const written = writePlan(plan, outPath);
  return {
    plan: written,
    notification: notificationViewFromPlan(written, written.planPath ?? outPath),
  };
}

function printReport(plan: CleanupPlan): void {
  console.log(`Cleanup sweep — ${plan.repoRoot}`);
  console.log(`main ${plan.mainRef} @ ${plan.mainTipSha.slice(0, 12)}`);
  console.log(`fingerprint ${plan.fingerprint.slice(0, 16)}…`);
  console.log("");
  console.log("Worktrees:");
  for (const tree of plan.worktrees) {
    const mark = tree.eligible ? "PROPOSE" : "REFUSE ";
    console.log(
      `  [${mark}] ${tree.path}`
      + `  branch=${tree.branch ?? "(detached)"}`
      + `  ${tree.treeState}`
      + `  merged=${tree.mergedIntoMain}`
      + `  sha=${tree.headSha.slice(0, 12)}`,
    );
    for (const reason of tree.refusals) console.log(`           · ${reason}`);
    for (const occ of tree.occupants) {
      console.log(
        `           · occupant pid=${occ.pid} liveness=${occ.liveness}`
        + ` start=${occ.startSeconds ?? "∅"} cwd=${occ.cwd}`,
      );
    }
  }
  console.log("");
  console.log("Branches:");
  for (const branch of plan.branches) {
    const mark = branch.eligible ? "PROPOSE" : "REFUSE ";
    console.log(
      `  [${mark}] ${branch.name}  sha=${branch.tipSha.slice(0, 12)}`
      + `  merged=${branch.mergedIntoMain}`
      + (branch.checkedOutAt ? `  checkout=${branch.checkedOutAt}` : ""),
    );
    for (const reason of branch.refusals) console.log(`           · ${reason}`);
  }
  console.log("");
  console.log(`Proposed removals: ${plan.proposed.length}`);
  for (const item of plan.proposed) {
    if (item.kind === "worktree") {
      console.log(`  - worktree ${item.path}  rollback=${item.rollbackSha}`);
    } else {
      console.log(`  - branch   ${item.name}  rollback=${item.rollbackSha}`);
    }
  }
}

function usage(): never {
  console.error(`Usage:
  bun scripts/anthill-cleanup-sweep.ts propose [--repo <path>] [--out <plan.json>] [--main <ref>] [--json]
  bun scripts/anthill-cleanup-sweep.ts confirm <plan.json> [--repo <path>]

  propose is the only command the board may run. confirm is terminal-only.`);
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const args = [...argv];
  const command = args.shift();
  if (command !== "propose" && command !== "confirm") usage();
  let repo = process.cwd();
  let out = join(process.cwd(), ".anthill", "cleanup-plan.json");
  let main = DEFAULT_MAIN;
  let json = false;
  let planPath: string | undefined;
  if (command === "confirm") {
    planPath = args.shift();
    if (!planPath) usage();
  }
  while (args.length) {
    const flag = args.shift()!;
    if (flag === "--repo") repo = args.shift() || usage();
    else if (flag === "--out") out = args.shift() || usage();
    else if (flag === "--main") main = args.shift() || usage();
    else if (flag === "--json") json = true;
    else usage();
  }
  return { command, repo, out, main, planPath, json };
}

async function main(): Promise<void> {
  const { command, repo, out, main, planPath, json } = parseArgs(process.argv.slice(2));
  const host = defaultHost();
  if (command === "propose") {
    const { plan, notification } = runPropose(repo, out, host, main);
    if (json) {
      // Notification view only — what fe-notify / the dataflow item consumes.
      console.log(JSON.stringify(notification, null, 2));
      return;
    }
    printReport(plan);
    console.log("");
    console.log(`Wrote plan → ${plan.planPath ?? out}`);
    console.log("Nothing was deleted. THE BOARD NEVER DELETES — paste this in a terminal:");
    console.log(`  ${plan.confirmCommand ?? confirmCommandFor(out)}`);
    return;
  }
  const plan = readPlan(planPath!);
  if (resolve(repo) !== resolve(plan.repoRoot) && host.realpath(repo) !== plan.repoRoot) {
    // Allow confirm --repo to pin the same tree; mismatch is a hard refuse.
    if (host.realpath(repo) !== host.realpath(plan.repoRoot)) {
      console.error(`repo mismatch: --repo ${repo} vs plan ${plan.repoRoot}`);
      process.exit(1);
    }
  }
  const result = confirmCleanup(plan, host);
  for (const step of result.executed) {
    console.log(`ran: ${step.command.join(" ")}`);
  }
  if (!result.ok) {
    console.error(`REFUSED: ${result.refused}`);
    process.exit(1);
  }
  console.log("Confirmed. Removals complete.");
  for (const rb of result.rollbacks) {
    console.log(`  rollback ${rb.branch} → ${rb.rollbackSha}`);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
