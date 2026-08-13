/* TINT-S — two-way color sync, cmux ⇄ board.

   The board writes repo identity color onto cmux workspaces; a human can also
   set a color by hand inside cmux. This module is the only place those two
   sources meet, and authority rules §2 of the master plan decide every case:

     repo-mapped workspace  → the board is authoritative; drift is re-asserted.
     unmapped workspace     → cmux is authoritative; we read it and never write.
     echo (our own write)   → ignored, so a write can never feed the next write.

   Every write goes through the funnel (`src/server/cmux-color.ts`, TINT-F) —
   nothing here shells `workspace-action set-color` itself.

   Measured against live cmux 2026-08-13, and both measurements shape the code:

   1. cmux UPPERCASES the hex it stores. `--color "#2e66a8"` reads back as
      "#2E66A8", and a named color ("Amber") is resolved to a hex ("#7D6608").
      Raw string comparison would therefore read our own write as drift and
      re-assert forever — the write loop, arriving dressed as a string bug. All
      comparison here goes through `normalizeHex`.

   2. `extension.sidebar.snapshot {"all_windows":true}` returns ONE window's
      workspaces. On this machine that hid a whole window (6 workspaces, one of
      them carrying a hand-set color) from the collector. Colors are therefore
      collected by enumerating `window.list` and calling `workspace.list` per
      window id, rather than reusing the sidebar snapshot's coverage. */

import { cmuxCommand } from "./cmux-auth";
import { DEFAULT_CMUX_EXECUTABLE, executableMissing } from "./cmux";
import type { RepoColorAssignment, RepoColorsSettings } from "../shared/repo-color";
import type { CmuxSurface, CollectionResult, CommandRunner } from "./types";

/** One workspace as cmux reports it, colour-wise. `customColor` null means the
 *  workspace has NO color — not black, and not drift. */
export interface WorkspaceColorObservation {
  workspaceId: string;
  customColor: string | null;
  currentDirectory?: string;
  projectRootPath?: string;
  windowId?: string;
}

/** TINT-F's funnel, as this lane consumes it. Structurally identical to the
 *  declarations in the master plan §1; kept local so this file type-checks
 *  before `./cmux-color` exists on the integration branch. */
export interface ColorFunnel {
  setWorkspaceColor(workspaceId: string, hex: string, reason: string): Promise<boolean>;
  lastWrittenHex(workspaceId: string): string | null;
}

/** The two implementations this lane consumes but does not own. Injected in
 *  tests; resolved from TINT-F's modules in production by `loadColorRuntime`. */
export interface ColorRuntime {
  repoKeyForCwd(cwd: string): string | null;
  funnel: ColorFunnel;
}

export type ReconcileOutcome = "ignore" | "ingest" | "reassert" | "failed";

export interface ReconcileDecision {
  workspaceId: string;
  outcome: ReconcileOutcome;
  repoKey: string | null;
  /** The color this decision leaves the workspace with, normalized; null when
   *  the workspace has no color. */
  hex: string | null;
  reason: string;
}

export interface ReconcileResult {
  decisions: ReconcileDecision[];
  /** The `workspaces` half of `GET /api/repo-colors` (master plan §1). Only
   *  workspaces that actually carry a color appear. */
  workspaces: Record<string, { hex: string; repoKey: string | null }>;
  errors: string[];
}

const REASSERT_REASON = "sync-reassert";

/* ── colour normalization ─────────────────────────────────────────────── */

/** `#2e66a8`, `#2E66A8` and `2e66a8` are one color; `null`, `""` and junk are
 *  no color. Everything in this module compares normalized values only. */
export function normalizeHex(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const digits = raw.startsWith("#") ? raw.slice(1) : raw;
  if (/^[0-9a-f]{3}$/i.test(digits)) {
    return `#${[...digits].map((digit) => `${digit}${digit}`).join("")}`.toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(digits)) return `#${digits}`.toLowerCase();
  return null;
}

/* ── collection (full window coverage) ────────────────────────────────── */

function stringValue(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
    : [];
}

function resultRoot(output: string): Record<string, unknown> {
  const parsed = JSON.parse(output) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("cmux response was not an object");
  }
  const record = parsed as Record<string, unknown>;
  const nested = record.result;
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : record;
}

export function parseCmuxWindowIds(output: string): string[] {
  const root = resultRoot(output);
  if (!Array.isArray(root.windows)) throw new Error("cmux response did not contain a windows array");
  return [...new Set(records(root.windows).flatMap((window) => {
    const id = stringValue(window.id, window.window_id, window.windowId);
    return id ? [id] : [];
  }))];
}

/** The anchor workspace of every group in one window.
 *
 *  Verified live 2026-08-13: `workspace.group.create` also creates an ANCHOR
 *  workspace which heads the group, carries the group's cwd, and appears in
 *  `workspace.list` looking exactly like any other workspace — there is no flag
 *  on the workspace itself to tell them apart. With `mirrorGroups` on, every
 *  repo group would therefore contribute one repo-mapped-looking phantom that
 *  this pass would ingest or paint. `workspace.group.list` is the only source
 *  that can name them. */
export function parseCmuxGroupAnchorIds(output: string): string[] {
  const root = resultRoot(output);
  if (!Array.isArray(root.groups)) throw new Error("cmux response did not contain a groups array");
  return [...new Set(records(root.groups).flatMap((group) => {
    const anchorId = stringValue(group.anchor_workspace_id, group.anchorWorkspaceId);
    return anchorId ? [anchorId] : [];
  }))];
}

export function parseCmuxWorkspaceColors(output: string): WorkspaceColorObservation[] {
  const root = resultRoot(output);
  if (!Array.isArray(root.workspaces)) throw new Error("cmux response did not contain a workspaces array");
  const windowId = stringValue(root.window_id, root.windowId);
  return records(root.workspaces).flatMap((workspace) => {
    const workspaceId = stringValue(workspace.id, workspace.workspace_id, workspace.workspaceId);
    if (!workspaceId) return [];
    /* A missing key and an explicit null both mean "no color". Only a usable
       string is a color, so junk in the field never becomes drift. */
    const customColor = stringValue(workspace.custom_color, workspace.customColor) ?? null;
    return [{
      workspaceId,
      customColor,
      ...(stringValue(workspace.current_directory, workspace.currentDirectory)
        ? { currentDirectory: stringValue(workspace.current_directory, workspace.currentDirectory) }
        : {}),
      ...(stringValue(workspace.project_root_path, workspace.projectRootPath, workspace.root_path)
        ? { projectRootPath: stringValue(workspace.project_root_path, workspace.projectRootPath, workspace.root_path) }
        : {}),
      ...(windowId ? { windowId } : {}),
    }];
  });
}

export interface WorkspaceColorCollection extends CollectionResult<WorkspaceColorObservation[]> {
  /** Group anchors seen while collecting. Already removed from `value`; carried
   *  so a caller can prove an anchor never reached reconciliation. */
  anchorWorkspaceIds: string[];
}

/** Every workspace in every window, with the color cmux currently holds, minus
 *  the group anchors.
 *
 *  Partial coverage is reported, never hidden: a window whose workspace list
 *  fails contributes an error and no observations, and the workspaces that WERE
 *  read still reconcile — a write aimed at a workspace we actually saw is valid
 *  regardless of what we could not see.
 *
 *  A window whose GROUP list fails is different, and is dropped whole: without
 *  it there is no way to tell an anchor from a workspace, and the failure mode
 *  of guessing is painting a phantom. One skipped window for one poll is the
 *  cheaper error. */
export async function collectCmuxWorkspaceColors(
  runner: CommandRunner,
  executable = DEFAULT_CMUX_EXECUTABLE,
): Promise<WorkspaceColorCollection> {
  const windows = await runner.run(cmuxCommand(executable, ["rpc", "window.list", "{}"]), 10_000);
  if (executableMissing(windows)) return { value: [], errors: [], anchorWorkspaceIds: [], absent: true };
  if (windows.timedOut) {
    return { value: [], errors: ["cmux window discovery timed out"], anchorWorkspaceIds: [] };
  }
  if (windows.exitCode !== 0) {
    return {
      value: [],
      errors: [`cmux window discovery exited ${windows.exitCode}: ${windows.stderr.trim() || "no stderr"}`],
      anchorWorkspaceIds: [],
    };
  }
  let windowIds: string[];
  try {
    windowIds = parseCmuxWindowIds(windows.stdout);
  } catch (error) {
    return {
      value: [],
      errors: [`cmux window discovery returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`],
      anchorWorkspaceIds: [],
    };
  }

  const errors: string[] = [];
  const anchorWorkspaceIds = new Set<string>();
  const perWindow = await Promise.all(windowIds.map(async (windowId) => {
    const [workspaces, groups] = await Promise.all([
      runner.run(cmuxCommand(executable, [
        "rpc",
        "workspace.list",
        JSON.stringify({ window_id: windowId }),
      ]), 10_000),
      runner.run(cmuxCommand(executable, [
        "rpc",
        "workspace.group.list",
        JSON.stringify({ window_id: windowId }),
      ]), 10_000),
    ]);

    /* Anchors first: an unknown anchor set makes every workspace in this window
       unsafe to touch, so the window is skipped rather than guessed at. */
    let anchors: string[];
    if (groups.timedOut) {
      errors.push(`cmux group discovery for window ${windowId} timed out; its workspaces were skipped`);
      return [];
    }
    if (groups.exitCode !== 0) {
      errors.push(
        `cmux group discovery for window ${windowId} exited ${groups.exitCode}: ${groups.stderr.trim() || "no stderr"}; its workspaces were skipped`,
      );
      return [];
    }
    try {
      anchors = parseCmuxGroupAnchorIds(groups.stdout);
    } catch (error) {
      errors.push(
        `cmux group discovery for window ${windowId} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}; its workspaces were skipped`,
      );
      return [];
    }
    for (const anchor of anchors) anchorWorkspaceIds.add(anchor);

    if (workspaces.timedOut) {
      errors.push(`cmux workspace color discovery for window ${windowId} timed out`);
      return [];
    }
    if (workspaces.exitCode !== 0) {
      errors.push(
        `cmux workspace color discovery for window ${windowId} exited ${workspaces.exitCode}: ${workspaces.stderr.trim() || "no stderr"}`,
      );
      return [];
    }
    try {
      return parseCmuxWorkspaceColors(workspaces.stdout);
    } catch (error) {
      errors.push(
        `cmux workspace color discovery for window ${windowId} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }));

  /* One workspace belongs to one window, but a workspace moved mid-poll could
     be read twice; the first reading wins so the map stays deterministic. */
  const byWorkspace = new Map<string, WorkspaceColorObservation>();
  for (const observation of perWindow.flat()) {
    /* An anchor found in ANY window is dropped from every window: it is a
       group's sidebar header, not a workspace anything may be painted on. */
    if (anchorWorkspaceIds.has(observation.workspaceId)) continue;
    if (!byWorkspace.has(observation.workspaceId)) byWorkspace.set(observation.workspaceId, observation);
  }
  return { value: [...byWorkspace.values()], errors, anchorWorkspaceIds: [...anchorWorkspaceIds] };
}

/* ── repo mapping ─────────────────────────────────────────────────────── */

/** Which repo owns each workspace, per authority rule 4: the repo with the most
 *  agents in that workspace wins, ties break on the lexicographically first
 *  repo key. A workspace with no agent-bearing surface falls back to its own
 *  directory, so an idle repo-mapped workspace still wears its color. */
export function workspaceRepoKeys(
  observations: readonly WorkspaceColorObservation[],
  surfaces: readonly CmuxSurface[],
  repoKeyForCwd: (cwd: string) => string | null,
): Map<string, string> {
  const countsByWorkspace = new Map<string, Map<string, number>>();
  for (const surface of surfaces) {
    if (!surface.workspaceId || !surface.cwd) continue;
    const repoKey = repoKeyForCwd(surface.cwd);
    if (!repoKey) continue;
    const counts = countsByWorkspace.get(surface.workspaceId) ?? new Map<string, number>();
    counts.set(repoKey, (counts.get(repoKey) ?? 0) + 1);
    countsByWorkspace.set(surface.workspaceId, counts);
  }
  const winners = new Map<string, string>();
  for (const observation of observations) {
    const counts = countsByWorkspace.get(observation.workspaceId);
    const winner = counts
      ? [...counts.entries()].sort(
          ([leftKey, leftCount], [rightKey, rightCount]) =>
            rightCount - leftCount || leftKey.localeCompare(rightKey),
        )[0]?.[0]
      : undefined;
    const fallbackCwd = observation.projectRootPath ?? observation.currentDirectory;
    const repoKey = winner ?? (fallbackCwd ? repoKeyForCwd(fallbackCwd) : null);
    if (repoKey) winners.set(observation.workspaceId, repoKey);
  }
  return winners;
}

/* ── reconciliation ───────────────────────────────────────────────────── */

export interface ReconcileInput {
  observations: readonly WorkspaceColorObservation[];
  surfaces: readonly CmuxSurface[];
  settings: RepoColorsSettings;
  runtime: ColorRuntime;
  /** Group anchors. Collection already drops them; this is the second lock, so
   *  an anchor reaching this function by any other route is still inert. */
  anchorWorkspaceIds?: ReadonlySet<string>;
}

export async function reconcileWorkspaceColors(input: ReconcileInput): Promise<ReconcileResult> {
  const { surfaces, settings, runtime } = input;
  const anchors = input.anchorWorkspaceIds ?? new Set<string>();
  const decisions: ReconcileDecision[] = [];
  const workspaces: ReconcileResult["workspaces"] = {};
  const errors: string[] = [];

  /* A group anchor wears the group's cwd and so reads as fully repo-mapped, but
     it is the group's sidebar header rather than a place work happens. It is
     removed here BEFORE repo mapping, so it can neither be painted nor vote on
     which repo owns a workspace, and it never enters the published map — a
     phantom row is exactly the defect class this board has been burned by. */
  const observations = input.observations.filter(
    (observation) => !anchors.has(observation.workspaceId),
  );
  for (const observation of input.observations) {
    if (!anchors.has(observation.workspaceId)) continue;
    decisions.push({
      workspaceId: observation.workspaceId,
      outcome: "ignore",
      repoKey: null,
      hex: normalizeHex(observation.customColor),
      reason: "group anchor: invisible to the board and never written to",
    });
  }

  if (!settings.syncFromCmux) {
    /* The flag turns the whole pass off — including the read. Reporting an
       explicit ignore per workspace keeps the shape uniform for callers rather
       than making "off" look like "nothing was there". */
    return {
      decisions: [
        ...decisions,
        ...observations.map((observation) => ({
          workspaceId: observation.workspaceId,
          outcome: "ignore" as const,
          repoKey: null,
          hex: normalizeHex(observation.customColor),
          reason: "syncFromCmux is off",
        })),
      ],
      workspaces,
      errors,
    };
  }

  const repoKeys = workspaceRepoKeys(observations, surfaces, runtime.repoKeyForCwd);
  for (const observation of observations) {
    const { workspaceId } = observation;
    const repoKey = repoKeys.get(workspaceId) ?? null;
    const assignment: RepoColorAssignment | undefined = repoKey
      ? settings.assignments[repoKey]
      : undefined;
    const observed = normalizeHex(observation.customColor);
    const record = (
      outcome: ReconcileOutcome,
      hex: string | null,
      reason: string,
    ): void => {
      decisions.push({ workspaceId, outcome, repoKey, hex, reason });
      if (hex) workspaces[workspaceId] = { hex, repoKey };
    };

    /* Unmapped — including a repo we know but have not assigned a color. cmux
       is authoritative here and this branch never writes. */
    if (!assignment) {
      if (observed) record("ingest", observed, "unmapped workspace; cmux color ingested");
      else record("ignore", null, "unmapped workspace with no cmux color");
      continue;
    }

    const assigned = normalizeHex(assignment.hex);
    if (!assigned) {
      errors.push(`repo ${assignment.repoKey} has an unusable assigned color ${assignment.hex}`);
      record("ignore", observed, "assigned color is not a usable hex");
      continue;
    }
    if (observed === assigned) {
      record("ignore", assigned, "cmux color already matches the assignment");
      continue;
    }
    /* Echo suppression, keyed on the funnel's record of what THIS process last
       wrote — never a cache of our own, which would desync across a restart and
       re-fight the operator once per process lifetime. It catches the case a
       plain assignment comparison cannot: cmux storing something other than the
       exact string we handed it. */
    if (observed && observed === normalizeHex(runtime.funnel.lastWrittenHex(workspaceId))) {
      record("ignore", observed, "cmux color is the echo of this process's own write");
      continue;
    }

    let written = false;
    try {
      written = await runtime.funnel.setWorkspaceColor(workspaceId, assignment.hex, REASSERT_REASON);
    } catch (error) {
      errors.push(
        `re-assert of ${assignment.repoKey} color on workspace ${workspaceId} threw: ${error instanceof Error ? error.message : String(error)}`,
      );
      /* A failed write leaves the workspace exactly as cmux has it. Recording
         the assignment here would mark it reconciled on a write that never
         landed — the board would then show a color cmux is not wearing. */
      record("failed", observed, "funnel write threw; workspace left as cmux has it");
      continue;
    }
    if (!written) {
      errors.push(
        `re-assert of ${assignment.repoKey} color on workspace ${workspaceId} failed`,
      );
      record("failed", observed, "funnel write reported failure; workspace left as cmux has it");
      continue;
    }
    record("reassert", assigned, "repo-mapped drift re-asserted through the funnel");
  }

  return { decisions, workspaces, errors };
}

/* ── integration seam ─────────────────────────────────────────────────── */

/* Both modules below are TINT-F's, and this lane builds in parallel with F
   against the master plan's declared signatures. The specifiers are held in
   consts so this file type-checks on `feat/tint-s`, where `./cmux-color` does
   not exist yet and `repoKeyForCwd` is still a bare `declare`; a static import
   of either would be a link error at run time, not a compile error, which is
   the worst of both. The seam degrades honestly — no runtime, no writes, an
   error the caller reports — and it resolves to F's real implementations the
   moment they land, with no further edit here. */
const REPO_COLOR_MODULE = "../shared/repo-color";
const COLOR_FUNNEL_MODULE = "./cmux-color";

export async function loadColorRuntime(): Promise<{
  runtime?: ColorRuntime;
  errors: string[];
}> {
  const errors: string[] = [];
  let repoKeyForCwd: ColorRuntime["repoKeyForCwd"] | undefined;
  let funnel: ColorFunnel | undefined;
  try {
    const module = await import(REPO_COLOR_MODULE) as Partial<ColorRuntime>;
    if (typeof module.repoKeyForCwd === "function") repoKeyForCwd = module.repoKeyForCwd;
    else errors.push("repo color sync is idle: repoKeyForCwd is not implemented yet (TINT-F)");
  } catch (error) {
    errors.push(`repo color contract could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const module = await import(COLOR_FUNNEL_MODULE) as Partial<ColorFunnel>;
    if (typeof module.setWorkspaceColor === "function" && typeof module.lastWrittenHex === "function") {
      funnel = {
        setWorkspaceColor: module.setWorkspaceColor,
        lastWrittenHex: module.lastWrittenHex,
      };
    } else {
      errors.push("repo color sync is idle: the cmux color funnel is not implemented yet (TINT-F)");
    }
  } catch (error) {
    errors.push(`cmux color funnel could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
  }
  return repoKeyForCwd && funnel ? { runtime: { repoKeyForCwd, funnel }, errors } : { errors };
}

/** The board's repo-color settings, read defensively out of whatever the
 *  settings store currently holds. `settings.ts` is TINT-F's file; this reads
 *  it and never writes it, and answers with the locked defaults until F's
 *  persistence lands. */
export function repoColorsSettingsFrom(settings: unknown): RepoColorsSettings {
  const held = settings && typeof settings === "object"
    ? (settings as { repoColors?: unknown }).repoColors
    : undefined;
  const record = held && typeof held === "object" ? held as Partial<RepoColorsSettings> : undefined;
  const assignments = record?.assignments && typeof record.assignments === "object"
    ? record.assignments
    : {};
  return {
    assignments,
    mirrorGroups: record?.mirrorGroups !== false,
    syncFromCmux: record?.syncFromCmux !== false,
  };
}

/* ── the pass the collector cycle calls ───────────────────────────────── */

let lastResult: ReconcileResult = { decisions: [], workspaces: {}, errors: [] };
let inFlight: Promise<ReconcileResult> | undefined;
/* The pass runs on every collector poll, so a standing failure — cmux gone, the
   funnel not landed yet — would otherwise print the same line every few seconds
   until it drowned everything else in the log. Reported when it CHANGES, which
   still surfaces every distinct failure exactly once. */
let lastLoggedErrors = "";

/** The colors the last completed pass observed, for `GET /api/repo-colors`. */
export function latestWorkspaceColors(): ReconcileResult["workspaces"] {
  return { ...lastResult.workspaces };
}

/** What the last completed pass could not do. Empty when it was clean. */
export function latestColorSyncErrors(): string[] {
  return [...lastResult.errors];
}

export interface SyncCmuxColorsInput {
  runner: CommandRunner;
  executable?: string;
  surfaces: readonly CmuxSurface[];
  /** The hub settings object; repo-color settings are read out of it. */
  settings: unknown;
  /** Injected by tests. Production resolves TINT-F's modules instead. */
  runtime?: ColorRuntime;
}

/** One reconcile pass, piggybacked on the cmux collector poll (locked decision
 *  3 — no new timer). Never throws and never runs twice at once: a slow pass
 *  must not stack writes behind itself. */
export async function syncCmuxColors(input: SyncCmuxColorsInput): Promise<ReconcileResult> {
  if (inFlight) return inFlight;
  const pass = (async (): Promise<ReconcileResult> => {
    try {
      const settings = repoColorsSettingsFrom(input.settings);
      const collected = await collectCmuxWorkspaceColors(input.runner, input.executable);
      if (collected.absent) return { decisions: [], workspaces: {}, errors: [] };
      const loaded = input.runtime
        ? { runtime: input.runtime, errors: [] as string[] }
        : await loadColorRuntime();
      const { runtime } = loaded;
      if (!runtime) {
        /* No runtime means no repo mapping and no funnel, so every observed
           color is reported as cmux holds it and nothing is written. */
        const idle = await reconcileWorkspaceColors({
          observations: collected.value,
          surfaces: input.surfaces,
          anchorWorkspaceIds: new Set(collected.anchorWorkspaceIds),
          settings: { ...settings, assignments: {} },
          runtime: {
            repoKeyForCwd: () => null,
            funnel: {
              setWorkspaceColor: async () => false,
              lastWrittenHex: () => null,
            },
          },
        });
        return {
          ...idle,
          errors: [...collected.errors, ...idle.errors, ...loaded.errors],
        };
      }
      const reconciled = await reconcileWorkspaceColors({
        observations: collected.value,
        surfaces: input.surfaces,
        anchorWorkspaceIds: new Set(collected.anchorWorkspaceIds),
        settings,
        runtime,
      });
      return { ...reconciled, errors: [...collected.errors, ...reconciled.errors] };
    } catch (error) {
      return {
        decisions: [],
        workspaces: {},
        errors: [`cmux color sync failed: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  })();
  inFlight = pass;
  try {
    lastResult = await pass;
    const signature = lastResult.errors.join("");
    if (signature !== lastLoggedErrors) {
      for (const error of lastResult.errors) console.error(`[cmux-color-sync] ${error}`);
      lastLoggedErrors = signature;
    }
    return lastResult;
  } finally {
    inFlight = undefined;
  }
}

/** Test seam: forget the last pass so one test's result cannot leak into the
 *  next one's assertions. */
export function resetColorSyncState(): void {
  lastResult = { decisions: [], workspaces: {}, errors: [] };
  inFlight = undefined;
  lastLoggedErrors = "";
}
