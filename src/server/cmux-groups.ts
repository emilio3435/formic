/* TINT-G — the board's repo grouping, mirrored into the cmux sidebar.

   One named, colored group per repo, holding that repo's workspaces, in the
   window those workspaces live in — but only groups we already created.
   A new window never gets a minted repo folder. Everything here is gated on `mirrorGroups`
   and must undo itself when the flag goes off, which is the only reason this
   module keeps a provenance record at all: a group is ours because we wrote its
   id down when we created it, never because its name looks like a repo. Name
   matching would silently annex a group the operator made by hand and then
   dissolve it on the next flag flip. Filing a workspace that already lives
   in someone else's group is the same annexation: create/add pull it out.

   Group state lives in cmux, not here. Every pass re-reads `workspace.group.list`
   and reconciles against that truth — the operator can drag a workspace out of a
   group between two passes, and a module reconciling against its own memory
   would keep issuing writes that cmux has already undone. */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { cmuxCommand } from "./cmux-auth";
import { DEFAULT_CMUX_EXECUTABLE, executableMissing } from "./cmux";
import type { CommandRunner } from "./types";

const RPC_TIMEOUT_MS = 10_000;

/** One repo-mapped workspace, as the board sees it. Produced by TINT-F. */
export interface RepoGroupTarget {
  workspaceId: string;
  repoKey: string;
  hex: string;
}

/* The funnel's group-color half (master plan §1). This module never shells a
   color write itself; it calls what it is handed. The type is declared here
   rather than imported so this lane builds against the contract before
   `cmux-color.ts` exists — at integration the real funnel is what gets passed. */
export type SetGroupColor = (groupId: string, hex: string, reason: string) => Promise<boolean>;

export interface RepoGroupInputs {
  /** RepoColorsSettings.mirrorGroups. False means "undo what we created". */
  mirrorGroups: boolean;
  targets: readonly RepoGroupTarget[];
  /* Whether `targets` is the whole truth this pass. An empty list means two
     different things — "this repo really has no workspaces left" and "the
     collector could not tell us" — and only the caller can distinguish them.
     The board withdraws every agent's terminal target whenever a pass misses
     its deadline or routing evidence is quarantined, which empties `targets`
     without a single workspace having moved. Reading that as intent dissolved
     every repo group and rebuilt it seconds later, and each rebuild mints an
     anchor row cmux auto-names "Group N" that never goes away.

     Required, not optional-defaulting-to-true: a caller that has not thought
     about completeness must be made to, because the wrong default is the one
     that silently destroys the operator's sidebar. */
  targetsComplete: boolean;
  setGroupColor: SetGroupColor;
}

/** Registered at integration by the side that owns repo assignments (TINT-F). */
export type RepoGroupInputProvider = () => RepoGroupInputs | null;

export interface RepoGroupRecord {
  groupId: string;
  repoKey: string;
  windowId: string;
}

export interface RepoGroupProvenanceStore {
  list(): readonly RepoGroupRecord[];
  record(record: RepoGroupRecord): Promise<void>;
  forget(groupId: string): Promise<void>;
}

export interface RepoGroupReconcileResult {
  /** cmux mutations actually issued this pass. Zero on a settled second pass. */
  mutations: number;
  /** Every RPC or funnel failure, in operator-readable words. */
  errors: string[];
  /** cmux is not installed. Absent is not a fault (see cmux.ts). */
  absent?: boolean;
  /** The groups this module owns after the pass. */
  groups: RepoGroupRecord[];
  /** repoKey → workspace ids CONFIRMED filed. A failed add never appears here. */
  filed: Record<string, string[]>;
  /** Set when the pass ran the flag-off teardown instead of the mirror. */
  disabled?: boolean;
}

export class MemoryRepoGroupProvenanceStore implements RepoGroupProvenanceStore {
  protected readonly records = new Map<string, RepoGroupRecord>();

  list(): readonly RepoGroupRecord[] {
    return [...this.records.values()];
  }

  async record(record: RepoGroupRecord): Promise<void> {
    this.records.set(record.groupId, record);
    await this.persist(this.list());
  }

  async forget(groupId: string): Promise<void> {
    if (!this.records.delete(groupId)) return;
    await this.persist(this.list());
  }

  protected async persist(_records: readonly RepoGroupRecord[]): Promise<void> {}
}

/* Durable because provenance outlives the process: a hub restart with the flag
   already off, or flipped off while the hub was down, must still be able to say
   which groups it created — otherwise its groups are orphaned in the sidebar
   with no safe way to tell them from the operator's own. An unreadable file is
   therefore reported, not swallowed: it means teardown will under-clean. */
export class JsonRepoGroupProvenanceStore extends MemoryRepoGroupProvenanceStore {
  private writeNumber = 0;
  private lastLoadError?: string;

  private constructor(private readonly path: string) {
    super();
  }

  static async open(path: string): Promise<JsonRepoGroupProvenanceStore> {
    const store = new JsonRepoGroupProvenanceStore(path);
    try {
      const parsed = JSON.parse(await readFile(path, "utf8"));
      if (!Array.isArray(parsed)) throw new Error("repo group provenance must be an array");
      for (const value of parsed) {
        if (!isRepoGroupRecord(value)) throw new Error("repo group provenance contains an invalid record");
        store.records.set(value.groupId, value);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        store.records.clear();
        store.lastLoadError = `repo group provenance could not be read from ${path}, so groups this module created `
          + "can no longer be told from the operator's own and will not be cleaned up: "
          + (error instanceof Error ? error.message : String(error));
        console.error(`[cmux-groups] ${store.lastLoadError}`);
      }
    }
    return store;
  }

  /** Undefined when provenance on disk is the provenance in force. */
  loadError(): string | undefined {
    return this.lastLoadError;
  }

  protected override async persist(records: readonly RepoGroupRecord[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    this.writeNumber += 1;
    const temporary = `${this.path}.${process.pid}.${this.writeNumber}.tmp`;
    await writeFile(temporary, `${JSON.stringify(records, null, 2)}\n`, "utf8");
    await rename(temporary, this.path);
  }
}

function isRepoGroupRecord(value: unknown): value is RepoGroupRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<RepoGroupRecord>;
  return typeof record.groupId === "string" && record.groupId.length > 0
    && typeof record.repoKey === "string" && record.repoKey.length > 0
    && typeof record.windowId === "string" && record.windowId.length > 0;
}

/* `#2E66A8` and `#2e66a8` are the same color and read as drift, which turns one
   comparison into a write every pass, forever (ground rules, hex case trap). */
export function normalizeHex(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim().toLowerCase();
  const body = raw.startsWith("#") ? raw.slice(1) : raw;
  if (/^[0-9a-f]{3}$/.test(body)) {
    return `#${[...body].map((digit) => `${digit}${digit}`).join("")}`;
  }
  return /^[0-9a-f]{6}$/.test(body) ? `#${body}` : undefined;
}

export interface CmuxGroup {
  id: string;
  name?: string;
  customColor?: string;
  /* cmux materializes a group as a workspace row that heads it. Removing that
     row destroys the group and leaves the row behind — verified live on
     2026-08-13 — so the anchor is never filed, moved, or removed here. */
  anchorWorkspaceId?: string;
  memberWorkspaceIds: string[];
}

interface RpcOutcome {
  ok: boolean;
  stdout?: string;
  error?: string;
  absent?: boolean;
}

function stringField(record: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function parseCmuxGroups(output: string): CmuxGroup[] {
  const root = asRecord(JSON.parse(output));
  const groups = (asRecord(root?.result) ?? root)?.groups;
  if (!Array.isArray(groups)) throw new Error("cmux response did not contain a groups array");
  return groups.flatMap((value): CmuxGroup[] => {
    const group = asRecord(value);
    const id = stringField(group, "id", "group_id");
    if (!group || !id) return [];
    const members = Array.isArray(group.member_workspace_ids) ? group.member_workspace_ids : [];
    return [{
      id,
      name: stringField(group, "name"),
      customColor: stringField(group, "custom_color"),
      anchorWorkspaceId: stringField(group, "anchor_workspace_id"),
      memberWorkspaceIds: members.filter((member): member is string => typeof member === "string"),
    }];
  });
}

/** The group `workspace.group.create` answers with, or undefined when it named none. */
export function parseCreatedGroup(output: string): CmuxGroup | undefined {
  const root = asRecord(JSON.parse(output));
  const group = asRecord(asRecord(root?.result)?.group ?? root?.group);
  const id = stringField(group, "id", "group_id");
  if (!group || !id) return undefined;
  const members = Array.isArray(group.member_workspace_ids) ? group.member_workspace_ids : [];
  return {
    id,
    name: stringField(group, "name"),
    customColor: stringField(group, "custom_color"),
    anchorWorkspaceId: stringField(group, "anchor_workspace_id"),
    memberWorkspaceIds: members.filter((member): member is string => typeof member === "string"),
  };
}

function parseIdList(output: string, collection: "windows" | "workspaces"): string[] {
  const root = asRecord(JSON.parse(output));
  const items = (asRecord(root?.result) ?? root)?.[collection];
  if (!Array.isArray(items)) throw new Error(`cmux response did not contain a ${collection} array`);
  return items.flatMap((value) => {
    const id = stringField(asRecord(value), "id");
    return id ? [id] : [];
  });
}

/* A cmux command that exits non-zero, times out, or answers with unparseable
   JSON is a failure here and stays a failure all the way out to the lane's
   errors — the house rule this program runs on. Silence would let a group the
   sidebar never got report as filed. */
async function rpc(
  runner: CommandRunner,
  executable: string,
  method: string,
  params: Record<string, unknown>,
): Promise<RpcOutcome> {
  const result = await runner.run(
    cmuxCommand(executable, ["rpc", method, JSON.stringify(params)]),
    RPC_TIMEOUT_MS,
  );
  if (executableMissing(result)) return { ok: false, absent: true, error: `cmux ${method} is unavailable: cmux is not installed` };
  if (result.timedOut) return { ok: false, error: `cmux ${method} timed out` };
  if (result.exitCode !== 0) {
    return { ok: false, error: `cmux ${method} exited ${result.exitCode}: ${result.stderr.trim() || "no stderr"}` };
  }
  return { ok: true, stdout: result.stdout };
}

/* How many consecutive passes a repo must be missing from a COMPLETE target set
   before its group is dissolved. One is enough to be correct and not enough to
   be safe: the completeness flag is a claim by the caller, and this is what
   holds when that claim is wrong. Passes ride the collector poll, so the cost
   of confirming is one poll of staleness on a genuine teardown. */
const DISSOLVE_AFTER_ABSENT_PASSES = 2;
const absentPasses = new Map<string, number>();

export interface ReconcileOptions {
  runner: CommandRunner;
  provenance: RepoGroupProvenanceStore;
  inputs: RepoGroupInputs;
  executable?: string;
}

/* One reconcile pass, driven by cmux's own group truth.

   Order inside a window matters: create-then-name-then-color, because
   `workspace.group.create` names the group itself ("Group 1") and takes no name
   — verified against cmux 2026-08-13. Membership is settled before color so a
   failed add cannot leave a colored group that does not hold what it claims. */
export async function reconcileRepoGroups(
  options: ReconcileOptions,
): Promise<RepoGroupReconcileResult> {
  const executable = options.executable ?? DEFAULT_CMUX_EXECUTABLE;
  const { runner, provenance, inputs } = options;
  const errors: string[] = [];
  const filed: Record<string, string[]> = {};
  let mutations = 0;

  const windowsOutcome = await rpc(runner, executable, "window.list", {});
  if (windowsOutcome.absent) {
    return { mutations: 0, errors: [], absent: true, groups: [...provenance.list()], filed };
  }
  if (!windowsOutcome.ok) {
    return { mutations: 0, errors: [windowsOutcome.error ?? "cmux window.list failed"], groups: [...provenance.list()], filed };
  }
  let windowIds: string[];
  try {
    windowIds = parseIdList(windowsOutcome.stdout ?? "", "windows");
  } catch (error) {
    return {
      mutations: 0,
      errors: [`cmux window.list returned an unexpected shape: ${error instanceof Error ? error.message : String(error)}`],
      groups: [...provenance.list()],
      filed,
    };
  }

  /* Per window, because groups are per window and a child workspace cmux cannot
     find in the target window is a create failure ("Child workspace not found in
     target window"). A one-window implementation looks finished until the
     operator opens a second window. */
  const groupsByWindow = new Map<string, CmuxGroup[]>();
  const workspacesByWindow = new Map<string, Set<string>>();
  for (const windowId of windowIds) {
    const groupOutcome = await rpc(runner, executable, "workspace.group.list", { window_id: windowId });
    if (!groupOutcome.ok) {
      errors.push(groupOutcome.error ?? `cmux workspace.group.list failed for window ${windowId}`);
      continue;
    }
    const workspaceOutcome = await rpc(runner, executable, "workspace.list", { window_id: windowId });
    if (!workspaceOutcome.ok) {
      errors.push(workspaceOutcome.error ?? `cmux workspace.list failed for window ${windowId}`);
      continue;
    }
    try {
      groupsByWindow.set(windowId, parseCmuxGroups(groupOutcome.stdout ?? ""));
      workspacesByWindow.set(windowId, new Set(parseIdList(workspaceOutcome.stdout ?? "", "workspaces")));
    } catch (error) {
      errors.push(
        `cmux returned an unexpected shape for window ${windowId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const liveGroups = new Map<string, { windowId: string; group: CmuxGroup }>();
  for (const [windowId, groups] of groupsByWindow) {
    for (const group of groups) liveGroups.set(group.id, { windowId, group });
  }

  /* Provenance for a group cmux no longer has is dropped, but only for windows
     we actually read this pass: a window whose group.list failed is unknown, not
     empty, and forgetting on unknown state is how a group becomes an orphan
     nobody will ever clean up. */
  const readWindows = new Set(groupsByWindow.keys());
  for (const record of provenance.list()) {
    if (liveGroups.has(record.groupId) || !readWindows.has(record.windowId)) continue;
    await provenance.forget(record.groupId);
  }

  const ungroup = async (record: RepoGroupRecord): Promise<void> => {
    const outcome = await rpc(runner, executable, "workspace.group.ungroup", { group_id: record.groupId });
    if (!outcome.ok) {
      errors.push(outcome.error ?? `cmux workspace.group.ungroup failed for ${record.repoKey}`);
      return;
    }
    mutations += 1;
    await provenance.forget(record.groupId);
  };

  /* Flag off is a teardown, not a no-op: the groups this module created go away
     and the operator's stay. `ungroup` dissolves and KEEPS its workspaces;
     `group.delete` CLOSES them (cmux prints "group deleted (closed N
     workspaces)"), which is why nothing in this module ever calls delete. */
  if (!inputs.mirrorGroups) {
    for (const record of provenance.list()) {
      if (liveGroups.has(record.groupId)) await ungroup(record);
    }
    return { mutations, errors, groups: [...provenance.list()], filed, disabled: true };
  }

  const targetsByWorkspace = new Map<string, RepoGroupTarget>();
  for (const target of inputs.targets) {
    if (target.workspaceId && target.repoKey) targetsByWorkspace.set(target.workspaceId, target);
  }

  for (const windowId of windowIds) {
    const workspaceIds = workspacesByWindow.get(windowId);
    const groups = groupsByWindow.get(windowId);
    if (!workspaceIds || !groups) continue;

    /* Every group's anchor row, ours and the operator's alike. cmux lists these
       rows as workspaces and TINT-F maps them to a repo like any other, since
       an anchor inherits its group's cwd — filing one into a different group
       would silently destroy the group it heads. */
    const anchorIds = new Set(groups.flatMap((group) =>
      group.anchorWorkspaceId ? [group.anchorWorkspaceId] : []));

    const ourGroups = provenance.list().filter((record) =>
      record.windowId === windowId && liveGroups.has(record.groupId));
    const ourGroupIds = new Set(ourGroups.map((record) => record.groupId));
    const homeGroupId = (workspaceId: string): string | undefined => {
      for (const group of groups) {
        if (group.anchorWorkspaceId === workspaceId) return group.id;
        if (group.memberWorkspaceIds.includes(workspaceId)) return group.id;
      }
      return undefined;
    };

    const byRepo = new Map<string, { hex: string; workspaceIds: string[] }>();
    for (const workspaceId of workspaceIds) {
      if (anchorIds.has(workspaceId)) continue;
      const target = targetsByWorkspace.get(workspaceId);
      if (!target) continue;
      /* An operator-made group is not ours even when its members share a
         repoKey. Filing those members would annex the folder by theft —
         create/add pulls them out — which is the same harm the header
         already forbids for name-matching. Ungrouped workspaces and
         members of groups we created still belong in the mirror. */
      const home = homeGroupId(workspaceId);
      if (home && !ourGroupIds.has(home)) continue;
      const bucket = byRepo.get(target.repoKey) ?? { hex: target.hex, workspaceIds: [] };
      bucket.workspaceIds.push(workspaceId);
      byRepo.set(target.repoKey, bucket);
    }

    for (const [repoKey, desired] of byRepo) {
      const existing = ourGroups.find((record) => record.repoKey === repoKey);
      let live = existing ? liveGroups.get(existing.groupId)?.group : undefined;

      if (!live) {
        /* Do not mint a new sidebar group. Create-then-rename is what
           paints a fresh window magenta with the repo name the moment a
           Formic pane lands there, and create() pulls members out of
           ANT · probe. We only maintain groups this module already
           recorded for this window. */
        continue;
      }

      const currentMembers = new Set(live.memberWorkspaceIds);
      const confirmed = desired.workspaceIds.filter((id) => currentMembers.has(id));

      for (const workspaceId of desired.workspaceIds) {
        if (currentMembers.has(workspaceId)) continue;
        const outcome = await rpc(runner, executable, "workspace.group.add", {
          group_id: live.id,
          workspace_id: workspaceId,
        });
        if (!outcome.ok) {
          /* Never recorded as filed. A workspace the sidebar does not hold must
             not be reported as held. */
          errors.push(outcome.error ?? `cmux workspace.group.add failed for ${workspaceId}`);
          continue;
        }
        mutations += 1;
        confirmed.push(workspaceId);
        currentMembers.add(workspaceId);
      }

      /* Only ever out of a group we created: cmux resolves `remove` from the
         workspace's own group, so running it on a member of somebody else's
         group would quietly take their workspace out of it. The anchor is
         exempt in both directions — removing it dissolves the group and orphans
         the row, which on the next pass looks like a missing group and rebuilds
         it: a create/destroy loop that never settles. */
      for (const workspaceId of live.memberWorkspaceIds) {
        if (workspaceId === live.anchorWorkspaceId) continue;
        /* A workspace missing from an incomplete target set has not left the
           repo; the board simply could not vouch for it this pass. Evicting it
           on that evidence is how a group loses its last real member. */
        if (!inputs.targetsComplete) continue;
        if (currentMembers.has(workspaceId) && desired.workspaceIds.includes(workspaceId)) continue;
        const outcome = await rpc(runner, executable, "workspace.group.remove", { workspace_id: workspaceId });
        if (!outcome.ok) {
          errors.push(outcome.error ?? `cmux workspace.group.remove failed for ${workspaceId}`);
          continue;
        }
        mutations += 1;
        currentMembers.delete(workspaceId);
      }

      if (live.name !== repoKey) {
        const outcome = await rpc(runner, executable, "workspace.group.rename", {
          group_id: live.id,
          name: repoKey,
        });
        if (outcome.ok) {
          mutations += 1;
          live.name = repoKey;
        } else {
          errors.push(outcome.error ?? `cmux workspace.group.rename failed for ${repoKey}`);
        }
      }

      const desiredHex = normalizeHex(desired.hex);
      if (!desiredHex) {
        errors.push(`repo ${repoKey} has an unusable color ${String(desired.hex)}`);
      } else if (normalizeHex(live.customColor) !== desiredHex) {
        try {
          const written = await inputs.setGroupColor(live.id, desiredHex, `TINT-G repo group ${repoKey}`);
          if (written) {
            mutations += 1;
            live.customColor = desiredHex;
          } else {
            errors.push(`funnel refused the group color for ${repoKey}`);
          }
        } catch (error) {
          errors.push(
            `funnel threw setting the group color for ${repoKey}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      live.memberWorkspaceIds = [...currentMembers];
      filed[repoKey] = [...new Set([...(filed[repoKey] ?? []), ...confirmed])];
    }

    /* A repo with nothing left in this window loses its group — dissolved, not
       deleted, so the workspaces survive.

       Two independent things must hold before a group is torn down, because a
       teardown is unrecoverable: cmux mints a new anchor row on the rebuild and
       the old one never goes away. First, the caller must vouch that `targets`
       was complete — an empty list from a degraded pass says nothing about
       where workspaces live. Second, the absence must survive a second pass, so
       that a caller which wrongly claims completeness still cannot dissolve the
       sidebar on one bad sample. A repo that has genuinely gone stays gone, so
       it clears both. */
    for (const record of ourGroups) {
      const tally = `${record.windowId}:${record.repoKey}`;
      if (byRepo.has(record.repoKey)) {
        absentPasses.delete(tally);
        continue;
      }
      if (!inputs.targetsComplete) continue;
      const absent = (absentPasses.get(tally) ?? 0) + 1;
      if (absent < DISSOLVE_AFTER_ABSENT_PASSES) {
        absentPasses.set(tally, absent);
        continue;
      }
      absentPasses.delete(tally);
      await ungroup(record);
    }
  }

  return { mutations, errors, groups: [...provenance.list()], filed };
}

let inputProvider: RepoGroupInputProvider | undefined;
let provenanceStore: RepoGroupProvenanceStore | undefined;
let reconciling = false;

/** Wired at integration by the side that owns repo assignments (TINT-F). */
export function registerRepoGroupInputs(
  provider: RepoGroupInputProvider | undefined,
  provenance?: RepoGroupProvenanceStore,
): () => void {
  inputProvider = provider;
  provenanceStore = provenance ?? provenanceStore;
  return () => {
    /* A newer app may have registered after this one. Its provider is now the
       authority, so disposing the older app must not pull the newer one's
       registration out from under the collector. */
    if (inputProvider !== provider) return;
    inputProvider = undefined;
    provenanceStore = undefined;
  };
}

/** Test seam — drop the registration between cases. */
export function resetRepoGroupRegistrationForTests(): void {
  inputProvider = undefined;
  provenanceStore = undefined;
  reconciling = false;
  absentPasses.clear();
}

/* Called from the collector cycle. Returns null when nothing is wired yet, and
   never runs two passes at once inside the registered writer: cmux mutations
   from two overlapping passes would race each other into duplicate groups.
   createMountainFetch separately admits only the production server role as a
   writer, so preview processes never reach this process-local guard. Like the
   naming pass, this is fire-and-forget by design — the sidebar is an
   improvement on a board that already works, so it must never delay or fail a
   refresh. */
export async function repoGroupReconcileTick(
  runner: CommandRunner,
  executable: string = DEFAULT_CMUX_EXECUTABLE,
): Promise<RepoGroupReconcileResult | null> {
  const provider = inputProvider;
  if (!provider || reconciling) return null;
  const inputs = provider();
  if (!inputs) return null;
  const provenance = provenanceStore ?? (provenanceStore = new MemoryRepoGroupProvenanceStore());
  reconciling = true;
  try {
    const result = await reconcileRepoGroups({ runner, executable, provenance, inputs });
    for (const error of result.errors) console.error(`[cmux-groups] ${error}`);
    return result;
  } catch (error) {
    console.error(`[cmux-groups] reconcile pass failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally {
    reconciling = false;
  }
}
