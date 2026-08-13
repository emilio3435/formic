# TINT — Repo Color Program · Master Plan

> Program: repo-identity color on the Ant Hill board, propagated to cmux.
> Master orchestrator: Fable 5 (this session, `FORMIC · orch`). Orchestrates only — writes the contract stub and merges; never implements lane work.
> Four sub-orchestrators (Opus 5 high via `claude`), each running its own swarm inside its fence: TINT-F, TINT-G, TINT-P, TINT-S.
> Design provenance: treatments approved by Emilio 2026-08-13 (Whisper + Signal, artifact a902d450); palette validated by dataviz `validate_palette.js` (all 5 checks pass vs surface `#FBFCFD`).

## Goal

Land repo-identity color end to end tonight: board rows tinted (Whisper grouped / Signal interleaved), colors persisted and user-overridable, propagated to cmux workspaces, mirrored as cmux sidebar groups (flagged), ingested back from cmux (two-way sync), and injected into future lane spawns as prompt-chip env.

## Success means

- `bunx tsc --noEmit` → 0 and `bun test` → green (the documented local-only `docs/a11y-geometry-gate` red is the only tolerated exception) on the integration branch after every merge.
- The board's ALL view shows Whisper treatment when grouped by repo and Signal treatment under interleaving sorts; an attention row always wins its frame (ember rail + ember wash override repo tint).
- Every repo-mapped cmux workspace wears its repo hex; `cmux rpc workspace.list` confirms `custom_color` matches the board's assignment.
- With `mirrorGroups` enabled, cmux sidebar shows one colored group per repo containing its workspaces; disabling it ungroups cleanly.
- A color set by hand in cmux on an unmapped workspace appears on the board; a hand-edit on a repo-mapped workspace is re-asserted to the board's color on the next sync pass; no write loops (funnel echo-suppression test proves it).
- `/orchestrate` spawn commands carry `ANTHILL_REPO` / `ANTHILL_REPO_COLOR` env, and a prompt segment renders the chip in new lanes' shells.
- Board deployed locally: `launchctl kickstart` + `?v=ah-tN` cache-bust bumped; visual check on the live board, by eyes, not just probes ([[verify-layout-with-eyes]]).

## Stop when

Integration branch green on the floor, deployed locally, visually verified, debris swept under the `TINT` prefix — or a decision only Emilio can make is blocking. Push/PR only on Emilio's explicit word.

---

## 1. The shared contract (frozen before fan-out)

Master commits this stub to the integration branch as the **first commit**. Lanes build against it; only TINT-F fills in implementations. Changing the contract mid-flight requires a master-approved commit on the integration branch and a note to every sub-orch.

```ts
// src/shared/repo-color.ts — CONTRACT (stub by master, implemented by TINT-F)

/** Fixed-slot palette. Validated 2026-08-13 (light surface #FBFCFD): lightness band,
 *  chroma floor ≥0.1, CVD adjacent ΔE ≥8 (worst 11.9 deutan), normal-vision ≥15
 *  (worst 17.0), contrast ≥3:1. Order is load-bearing — never reorder or cycle. */
export const REPO_PALETTE = [
  { slot: 0, name: "olive",  hex: "#5F7F2A" },
  { slot: 1, name: "storm",  hex: "#2E66A8" },
  { slot: 2, name: "sienna", hex: "#B05F3A" },
  { slot: 3, name: "petrol", hex: "#0E9494" },
  { slot: 4, name: "garnet", hex: "#9E3355" },
  { slot: 5, name: "iris",   hex: "#8A4FC0" },
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
export declare function assignSlot(repoKey: string, taken: ReadonlySet<number>): number | null;
```

**Server contract:**

- `GET /api/repo-colors` → `{ settings: RepoColorsSettings, workspaces: Record<workspaceId, { hex: string, repoKey: string | null }> }`
- `PUT /api/repo-colors/:repoKey` body `{ hex: string }` → sets `source: "user"` override. Same-origin local only, like every mutating route.
- **The funnel** — `src/server/cmux-color.ts`. Every cmux color write in the entire program goes through it; no lane shells `workspace-action set-color` directly:

```ts
// src/server/cmux-color.ts — created by TINT-F, consumed by TINT-G and TINT-S
export declare function setWorkspaceColor(workspaceId: string, hex: string, reason: string): Promise<boolean>;
export declare function setGroupColor(groupId: string, hex: string, reason: string): Promise<boolean>;  // TINT-G
/** Echo suppression for TINT-S: last hex this process wrote to a workspace, or null. */
export declare function lastWrittenHex(workspaceId: string): string | null;
```

## 2. Authority rules (locked — resolve every conflict by these, never ad hoc)

1. **Repo-mapped workspace → board authoritative.** Drift (cmux `custom_color` ≠ assignment) is re-asserted through the funnel on the next sync pass.
2. **Unmapped workspace → cmux authoritative.** The board displays its `custom_color` where relevant and never writes to it.
3. **Echo suppression.** TINT-S ignores any read where `custom_color === lastWrittenHex(workspaceId)`.
4. **Shared workspace, multiple repos:** the repo with the most agents in that workspace wins; tie → lexicographically first repoKey. Deterministic, no judgment calls.
5. **Status outranks identity** in every pixel: attention/ember treatments always replace repo tint, never blend.
6. **Text never wears repo color.** Marks only: dots, spines, ticks, pill borders, prompt chips.

## 3. Fences (file ownership — a lane edits nothing outside its fence)

| Lane | Owns (create/modify) | Must not touch |
|---|---|---|
| Master | contract stub commit, `docs/superpowers/plans/2026-08-13-tint/**`, merges, deploy | lane implementation files |
| TINT-F | `src/shared/repo-color.ts` (implement), `src/web/app.js` (row/group render + a `renderRepoColorSettings` region), `src/web/styles.css`, `src/server/cmux-color.ts` (create), `src/server/settings.ts` (repoColors persistence), route registration block marked `/* TINT-F routes */` in the file existing `/api` routes live in, tests for all of it | `src/server/cmux.ts`, `cmux-groups.ts`, `cmux-color-sync.ts` |
| TINT-G | `src/server/cmux-groups.ts` (create), one registration line marked `/* TINT-G */`, its tests | `src/web/**`, `settings.ts` beyond reading, the funnel's internals |
| TINT-S | `src/server/cmux-color-sync.ts` (create), `src/server/cmux.ts` (read `custom_color` in workspace collection), one registration line marked `/* TINT-S */`, its tests | `src/web/**`, funnel internals, `cmux-groups.ts` |
| TINT-P | `~/.claude/skills/orchestrate/SKILL.md` (spawn env), prompt segment in dotfiles (`~/dotfiles`), optional read-only `GET /api/repo-colors` consumption | everything in `the-mountain/src/**` |

Registration-line collisions are resolved at source per the orchestrate skill: rename/move in the losing lane's branch, never hand-stitch a merge.

## 4. Topology, spawn, and worker stack

- Integration branch: `feat/tint-integration` cut from `main`. Contract stub is its first commit.
- Each sub-orch: worktree `../the-mountain.worktrees/tint-<goal>`, branch `feat/tint-<goal>`, cmux workspace `TINT · <goal>-orch · opus · 08-13`, launched `claude --model opus --effort high --permission-mode auto "<kickoff>"`.
- Sub-orchs size their own swarm — **a swarm of one (the sub-orch working alone) is legitimate** and right for P and S. Workers follow the standing stack: FE → Opus 5 high via `claude`; BE/tests → GPT 5.6 Sol xhigh via `codex`; fallback/verification → Grok 4.6 via `cursor-agent`. A lane running Fable is a launch error. Verify model AND vehicle on the live process (`ps -o args= -p <pid>`).
- Workers inside a sub-orch default to **sharing the sub-orch's worktree** with path-scoped commits (`git commit -- <paths>`, never `git add` sweeps — [[shared-worktree-commit-sweeps-the-index]]); a sub-orch may cut nested worktrees `feat/tint-<goal>-<worker>` if its workers collide.
- Every workspace this program creates is prefixed `TINT · ` so the sweep is one filter.
- Every lane (sub-orchs and workers alike) writes `LANE-REPORT-<lane>.md` in its worktree root **as its first action**, five headings, `PENDING`-filled — per the orchestrate skill.
- Codex sandbox cannot take the linked-worktree lock: BE workers leave work as dirt + report; the sub-orch commits it with a message saying so.

## 5. Dependency edges and merge order

```
contract stub (master, first commit)
   ├─→ TINT-F (implements; no waits)
   ├─→ TINT-G (builds vs stub; INTEGRATION-blocked on F's funnel)
   ├─→ TINT-S (builds vs stub; INTEGRATION-blocked on F's funnel)
   └─→ TINT-P (reads palette constants; endpoint optional w/ local fallback)
```

All four lanes **build in parallel** against the stub; only merges serialize. G and S write their tests against the funnel's declared signatures and may stub it locally in tests — their code paths must go through the real funnel at integration.

Merge order: **F → S → G → P** (P has no repo code; its "merge" is the skill/dotfiles edit, gated on F's endpoint shape being final). Master runs the floor itself after each merge — lane reports are evidence, never the gate ([[orchestrate]] §5).

## 6. Floor and deploy

- Floor, per lane and per merge: `bunx tsc --noEmit` → 0 · `bun test` → green (tolerated red: `docs/a11y-geometry-gate`, documented local-only).
- TINT-F adds and must pass: row-tint render tests (grouped, interleaved, attention-override), assignment determinism tests, funnel write/echo tests.
- Live checks (master, after deploy): `cmux rpc workspace.list` colors match `GET /api/repo-colors`; screenshot of the board **read with eyes**.
- Deploy: `launchctl kickstart` the Ant Hill job + bump `?v=ah-tN` cache-bust (serving topology memory). Local only; push/PR needs Emilio's word.

## 7. Locked decisions (Emilio, 2026-08-13 — these override anything contrary above)

1. **`mirrorGroups` ships ON at merge.** The sidebar regroups at deploy. Master's mitigation: G merges last among repo lanes, and the master announces the flip in the ledger before deploying so a chaotic sidebar during the run is expected, not alarming.
2. **Group membership: all repo-mapped workspaces**, agent-bearing or not.
3. **Sync cadence: piggyback the existing cmux collector poll.** No new timer.
4. **Push + PR when green: standing approval granted.** Floor-green integration branch tonight → master pushes `feat/tint-integration` and opens the PR without a further ask.

## 8. Parked (recorded so tonight doesn't eat them)

- **Idea 1 — repo sigils** (shape coding, `workspace-action rename` prefixes): parked by Emilio 2026-08-13.
- **Idea 5 — worktree shade steps** (same hue, stepped lightness, re-validated): parked; revisit after repo color has lived on the board.
- **Group icons** (`workspace.group.set_icon`): icon vocabulary unverified; TINT-G may probe it cheaply and note findings in its report, but ships nothing icon-dependent.
