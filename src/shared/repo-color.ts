/* TINT contract — repo-identity color. Stub committed by the master orchestrator;
   TINT-F replaces the declare-d functions with implementations. Changing any shape
   in this file mid-program requires a master-approved commit on the integration
   branch (see docs/superpowers/plans/2026-08-13-tint/00-MASTER-PLAN.md §1). */

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

/** Derive the repo key for an agent; null when cwd is not in a git repo. */
export declare function repoKeyForCwd(cwd: string): string | null;

/** Deterministic slot assignment: stable string-hash of repoKey mod 6, then
 *  first free slot scanning upward; null when all six taken (overflow). */
export declare function assignSlot(
  repoKey: string,
  taken: ReadonlySet<number>,
): number | null;
