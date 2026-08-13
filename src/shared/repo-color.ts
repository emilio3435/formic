/* TINT contract — repo-identity color. Stub committed by the master orchestrator;
   TINT-F replaces the declare-d functions with implementations. Changing any shape
   in this file mid-program requires a master-approved commit on the integration
   branch (see docs/superpowers/plans/2026-08-13-tint/00-MASTER-PLAN.md §1). */

import { basename, dirname, resolve } from "node:path";

/** Fixed-slot palette. Validated 2026-08-13 (light surface #FBFCFD): lightness band,
 *  chroma floor ≥0.1, CVD adjacent ΔE ≥8 (worst 11.9 deutan), normal-vision ≥15
 *  (worst 17.0), contrast ≥3:1. Order is load-bearing — never reorder or cycle. */
export const REPO_PALETTE = [
  { slot: 0, name: "olive", hex: "#5F7F2A" },
  { slot: 1, name: "storm", hex: "#2E66A8" },
  { slot: 2, name: "sienna", hex: "#B05F3A" },
  { slot: 3, name: "petrol", hex: "#0E9494" },
  { slot: 4, name: "garnet", hex: "#9E3355" },
  { slot: 5, name: "iris", hex: "#8A4FC0" },
] as const;

/** Repo #7+ folds to neutral clay — never invent a 7th hue. */
export const REPO_OVERFLOW_HEX = "#64707C";

export interface RepoColorAssignment {
  /** Canonical repo key: basename of the git common dir's toplevel, lowercased.
   *  All worktrees of a repo collapse to one key (git rev-parse --git-common-dir). */
  repoKey: string;
  hex: string;
  /** Palette slot, or null when overflow/user-picked hex. */
  slot: number | null;
  source: "auto" | "user";
}

export interface RepoColorsSettings {
  assignments: Record<string, RepoColorAssignment>;
  /** TINT-G flag. Default true (locked decision 1, Emilio 2026-08-13). */
  mirrorGroups: boolean;
  /** TINT-S flag. Default true. */
  syncFromCmux: boolean;
}

/* ---------------------------------------------------------------------------
   Implementation (TINT-F). Shapes above are frozen; everything below is body.
   ------------------------------------------------------------------------ */

export interface RepoKeyExecResult {
  exitCode: number;
  stdout: string;
}

/** Injectable git seam. The contract's one-argument call still type-checks:
 *  the options bag is optional, so `repoKeyForCwd(cwd)` is the shipped call and
 *  the tests drive the same body without a real repository on disk. */
export type RepoKeyExec = (command: readonly string[]) => RepoKeyExecResult;

export interface RepoKeyOptions {
  exec?: RepoKeyExec;
}

const defaultExec: RepoKeyExec = (command) => {
  const result = Bun.spawnSync([...command], { stdout: "pipe", stderr: "ignore" });
  return { exitCode: result.exitCode, stdout: result.stdout.toString() };
};

/** Derive the repo key for an agent; null when cwd is not in a git repo. */
export function repoKeyForCwd(cwd: string, options: RepoKeyOptions = {}): string | null {
  if (!cwd) return null;
  const exec = options.exec ?? defaultExec;
  const result = exec(["git", "-C", cwd, "rev-parse", "--git-common-dir"]);
  if (result.exitCode !== 0) return null;
  const raw = result.stdout.split(/\r?\n/, 1)[0]?.trim();
  if (!raw) return null;
  /* The COMMON dir, never --show-toplevel. A linked worktree's toplevel is its
     own directory, so `the-mountain.worktrees/tint-f` and `the-mountain` would
     read as two repositories and wear two colors — and this board runs from
     worktrees all day, so the bug demos fine and ships broken. The common dir
     is `<repo>/.git` for every worktree of one repository alike; its parent
     directory is the repository. */
  const commonDir = resolve(cwd, raw);
  const key = basename(dirname(commonDir)).toLowerCase();
  return key || null;
}

/* FNV-1a, the same stable string hash `repo-identity` already uses for its own
   key. Deterministic across processes and machines — Math.random or an
   insertion counter would repaint the whole board on every restart. */
function stableHash(value: string): number {
  let result = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16_777_619);
  }
  return result >>> 0;
}

/** Deterministic slot assignment: stable string-hash of repoKey mod 6, then
 *  first free slot scanning upward; null when all six taken (overflow). */
export function assignSlot(repoKey: string, taken: ReadonlySet<number>): number | null {
  const start = stableHash(repoKey) % REPO_PALETTE.length;
  for (let step = 0; step < REPO_PALETTE.length; step += 1) {
    const slot = (start + step) % REPO_PALETTE.length;
    if (!taken.has(slot)) return slot;
  }
  return null;
}

/** The hex a slot wears; overflow clay for the seventh repository onward. */
export function hexForSlot(slot: number | null): string {
  return REPO_PALETTE.find((entry) => entry.slot === slot)?.hex ?? REPO_OVERFLOW_HEX;
}

/* Colors arrive from three places — this palette, an operator's picker, and
   cmux's own `custom_color` — and two of the three can spell one color two
   ways. `#2E66A8` compared against `#2e66a8` reads as drift, drift provokes a
   re-assert through the funnel, and the re-assert is read back as drift again:
   an infinite write loop dressed as a string bug. Every comparison in this
   program goes through here first. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const short = /^#([0-9a-fA-F]{3})$/.exec(trimmed);
  if (short) {
    const [r, g, b] = short[1]!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function sameHex(left: unknown, right: unknown): boolean {
  const a = normalizeHex(left);
  const b = normalizeHex(right);
  return a !== null && a === b;
}

export function defaultRepoColorsSettings(): RepoColorsSettings {
  return { assignments: {}, mirrorGroups: true, syncFromCmux: true };
}

/** Assign colors to every repoKey in `keys`, keeping existing assignments.
 *
 *  Order-independent by construction: newly discovered keys are taken in
 *  lexicographic order, not discovery order, so the same set of repositories
 *  produces the same six colors whichever agent the collector happened to read
 *  first. Existing assignments are sticky — a repository does not change color
 *  because a new one appeared beside it. */
export function withAssignments(
  settings: RepoColorsSettings,
  keys: readonly string[],
): RepoColorsSettings {
  const assignments: Record<string, RepoColorAssignment> = { ...settings.assignments };
  const taken = new Set<number>();
  for (const assignment of Object.values(assignments)) {
    if (assignment.slot !== null) taken.add(assignment.slot);
  }
  const fresh = [...new Set(keys)].filter((key) => key && !assignments[key]).sort();
  for (const key of fresh) {
    const slot = assignSlot(key, taken);
    if (slot !== null) taken.add(slot);
    /* Normalized on the way in, not on the way out. REPO_PALETTE spells its
       hexes the way the design brief does — `#5F7F2A` — and a stored `#5F7F2A`
       compared against a `#5f7f2a` read back from cmux or from disk reports
       drift that is only spelling. Everything downstream of here compares
       colours, so this is the last place that can be sure. */
    assignments[key] = { repoKey: key, hex: normalizeHex(hexForSlot(slot))!, slot, source: "auto" };
  }
  return { ...settings, assignments };
}
