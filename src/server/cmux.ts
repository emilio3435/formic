import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CmuxNotificationSummary, SessionIdentityClaim } from "../shared/types";
import { cmuxCommand } from "./cmux-auth";
import type {
  CmuxNotification,
  CmuxSurface,
  CmuxWorkspaceEnv,
  CmuxWorkspaceEnvVariables,
  CmuxWorkspaceSnapshot,
  CollectionResult,
  CommandResult,
  CommandRunner,
} from "./types";

export const DEFAULT_CMUX_EXECUTABLE =
  "/Applications/cmux.app/Contents/Resources/bin/cmux";
export const ATTENTION_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const MAX_ATTENTION_RECORDS = 500;

export type AttentionAction = "acknowledge" | "dismiss" | "snooze";

export interface AttentionRecord {
  surfaceId: string;
  action: AttentionAction;
  updatedAt: string;
  throughAt?: string;
  notificationId?: string;
  snoozedUntil?: string;
}

export interface AttentionStore {
  list(): readonly AttentionRecord[];
  get(surfaceId: string): AttentionRecord | undefined;
  observe(notifications: readonly CmuxNotification[]): void;
  apply(surfaceId: string, action: AttentionAction, snoozedUntil?: string): Promise<AttentionRecord>;
  filter(notifications: readonly CmuxNotification[]): CmuxNotification[];
  /* Set when empty attention state is standing in for state that could not be
     read. Every notification the operator already acknowledged is unread again
     in that case, so the board asks for attention it was previously given. */
  loadError?(): string | undefined;
}

export class MemoryAttentionStore implements AttentionStore {
  protected readonly records = new Map<string, AttentionRecord>();
  private readonly latest = new Map<string, CmuxNotification>();
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(protected readonly now: () => number = Date.now) {}

  /* In-memory state cannot fail to load; the durable subclass overrides this. */
  loadError(): string | undefined {
    return undefined;
  }

  list(): readonly AttentionRecord[] {
    return [...this.records.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  get(surfaceId: string): AttentionRecord | undefined {
    return this.records.get(surfaceId);
  }

  observe(notifications: readonly CmuxNotification[]): void {
    for (const notification of notifications) {
      const current = this.latest.get(notification.surfaceId);
      // A known time always beats an unknown one; otherwise the later wins.
      const newer = !current
        || (notification.createdAt !== undefined
          && (current.createdAt === undefined || notification.createdAt > current.createdAt));
      if (newer) this.latest.set(notification.surfaceId, notification);
    }
  }

  async apply(
    surfaceId: string,
    action: AttentionAction,
    snoozedUntil?: string,
  ): Promise<AttentionRecord> {
    return this.mutate(async () => {
      const notification = this.latest.get(surfaceId);
      if (!notification) {
        const error = new Error("The agent has no observed unread cmux notification.");
        Object.assign(error, { code: "ATTENTION_NOT_FOUND" });
        throw error;
      }
      const untilMs = Date.parse(snoozedUntil ?? "");
      if (
        action === "snooze" &&
        (!Number.isFinite(untilMs) || untilMs <= this.now() || untilMs > this.now() + ATTENTION_RETENTION_MS)
      ) {
        const error = new Error("Snooze requires a future timestamp no more than seven days away.");
        Object.assign(error, { code: "INVALID_SNOOZE_UNTIL" });
        throw error;
      }
      const updatedAt = new Date(this.now()).toISOString();
      const record: AttentionRecord = action === "snooze"
        ? { surfaceId, action, updatedAt, snoozedUntil }
        : {
            surfaceId,
            action,
            updatedAt,
            throughAt: notification.createdAt,
            notificationId: notification.id,
          };
      await this.commit([
        ...this.list().filter((value) => value.surfaceId !== surfaceId),
        record,
      ]);
      return record;
    });
  }

  filter(notifications: readonly CmuxNotification[]): CmuxNotification[] {
    const nowMs = this.now();
    return notifications.filter((notification) => {
      const record = this.records.get(notification.surfaceId);
      if (!record) return true;
      const snoozedUntil = Date.parse(record.snoozedUntil ?? "");
      if (Number.isFinite(snoozedUntil) && snoozedUntil > nowMs) return false;
      /* Identity first, because it is the only thing that can retire a
         notification whose time is unknown. The id is already recorded on
         acknowledge; filter simply never read it, so the timestamp was doing
         work it could not do. Without this, refusing to invent a time would
         trade permanent silence for a permanent nag. */
      if (record.notificationId && notification.id === record.notificationId) return false;
      if (!record.throughAt) return true;
      // An unknown time is not PROVABLY older, so it is shown rather than hidden.
      return notification.createdAt === undefined || notification.createdAt > record.throughAt;
    });
  }

  private async commit(records: readonly AttentionRecord[]): Promise<void> {
    const retained = retainAttentionRecords(records, this.now());
    await this.persist(retained);
    this.records.clear();
    for (const record of retained) this.records.set(record.surfaceId, record);
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  protected async persist(_records: readonly AttentionRecord[]): Promise<void> {}
}

export class JsonAttentionStore extends MemoryAttentionStore {
  private writeNumber = 0;
  private lastLoadError?: string;

  override loadError(): string | undefined {
    return this.lastLoadError;
  }

  private constructor(private readonly path: string, now: () => number) {
    super(now);
  }

  static async open(path: string, now: () => number = Date.now): Promise<JsonAttentionStore> {
    const store = new JsonAttentionStore(path, now);
    let pruned = false;
    try {
      const parsed = JSON.parse(await readFile(path, "utf8"));
      if (!Array.isArray(parsed)) throw new Error("attention state must be an array");
      for (const value of parsed) {
        if (!isAttentionRecord(value)) throw new Error("attention state contains an invalid record");
      }
      const retained = retainAttentionRecords(parsed, now());
      pruned = retained.length !== parsed.length;
      for (const record of retained) store.records.set(record.surfaceId, record);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        store.records.clear();
        /* Empty attention state is not neutral: every notification the operator
           already acknowledged, snoozed or dismissed is unread again, so the
           board asks for attention it was previously given and the count of
           what needs a human is wrong. Start empty, but stop making the console
           the only witness. */
        store.lastLoadError = `attention state could not be read from ${path}, so acknowledged notifications are unread again: `
          + (error instanceof Error ? error.message : String(error));
        console.error(`[JsonAttentionStore] ${store.lastLoadError}`);
      }
    }
    if (pruned) await store.persist(store.list());
    return store;
  }

  protected override async persist(records: readonly AttentionRecord[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    this.writeNumber += 1;
    const temporary = `${this.path}.${process.pid}.${this.writeNumber}.tmp`;
    await writeFile(temporary, `${JSON.stringify(records, null, 2)}\n`, "utf8");
    await rename(temporary, this.path);
  }
}

function isAttentionRecord(value: unknown): value is AttentionRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<AttentionRecord>;
  return typeof record.surfaceId === "string" &&
    ["acknowledge", "dismiss", "snooze"].includes(String(record.action)) &&
    typeof record.updatedAt === "string" &&
    Number.isFinite(Date.parse(record.updatedAt)) &&
    (record.throughAt === undefined || Number.isFinite(Date.parse(record.throughAt))) &&
    (record.snoozedUntil === undefined || Number.isFinite(Date.parse(record.snoozedUntil))) &&
    (record.action === "snooze"
      ? typeof record.snoozedUntil === "string"
      : typeof record.throughAt === "string");
}

function retainAttentionRecords(records: readonly AttentionRecord[], nowMs: number): AttentionRecord[] {
  return [...records]
    .filter((record) => nowMs - Date.parse(record.updatedAt) <= ATTENTION_RETENTION_MS)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_ATTENTION_RECORDS);
}

let defaultAttentionStorePromise: Promise<JsonAttentionStore> | undefined;

export function defaultAttentionStore(): Promise<JsonAttentionStore> {
  defaultAttentionStorePromise ??= JsonAttentionStore.open(
    join(import.meta.dir, "../../data/attention-state.json"),
  );
  return defaultAttentionStorePromise;
}

export function runtimeCmuxExecutable(value = process.env.CMUX_EXECUTABLE): string {
  return value?.trim() || DEFAULT_CMUX_EXECUTABLE;
}

export { cmuxCommand, cmuxSocketPassword, loadCmuxSocketEnv, runningInsideCmux } from "./cmux-auth";

function stringValue(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

// cmux prefixes a surface title with a live status glyph/spinner (braille frames
// like ⠂, or ▪/●) while the terminal is active. That glyph is machinery, not the
// operator's rename — strip any leading non-alphanumeric run before the name.
function cleanSurfaceTitle(...values: unknown[]): string | undefined {
  const raw = stringValue(...values);
  if (!raw) return undefined;
  const cleaned = raw.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

export function parseCmuxTerminals(output: string): CmuxSurface[] {
  const parsed = JSON.parse(output);
  const terminals = parsed?.terminals ?? parsed?.result?.terminals;
  if (!Array.isArray(terminals)) throw new Error("cmux response did not contain a terminals array");

  return terminals.flatMap((terminal: Record<string, unknown>) => {
    const surfaceId = stringValue(terminal.surface_id, terminal.surfaceId);
    if (!surfaceId) return [];
    const rawClaims: Array<[SessionIdentityClaim["provider"], unknown]> = [
      [undefined, terminal.session_id],
      [undefined, terminal.agent_session_id],
      [undefined, terminal.source_session_id],
      ["codex", terminal.codex_session_id],
      ["claude", terminal.claude_session_id],
      ["omp", terminal.omp_session_id],
      ["cursor", terminal.cursor_session_id],
    ];
    const sourceSessionClaims = [...new Map(
      rawClaims.flatMap(([provider, value]): Array<[string, SessionIdentityClaim]> =>
        typeof value === "string" && value.length > 0
          ? [[`${provider ?? "legacy"}:${value.toLowerCase()}`, {
              sessionId: value,
              ...(provider ? { provider } : {}),
            }]]
          : []),
    ).values()];
    const sourceSessionIds = [...new Set(sourceSessionClaims.map(({ sessionId }) => sessionId))];
    return [{
      surfaceId,
      workspaceId: stringValue(
        terminal.workspace_id,
        terminal.workspaceId,
        terminal.last_known_workspace_id,
      ),
      paneId: stringValue(terminal.pane_id, terminal.paneId),
      cwd: stringValue(terminal.current_directory, terminal.cwd),
      workspaceTitle: stringValue(terminal.workspace_title, terminal.workspaceTitle),
      title: cleanSurfaceTitle(terminal.surface_title, terminal.surfaceTitle),
      branch: stringValue(terminal.git_branch, terminal.branch),
      dirty: typeof terminal.git_dirty === "boolean" ? terminal.git_dirty : undefined,
      head: stringValue(terminal.git_head, terminal.head),
      tty: stringValue(terminal.tty, terminal.terminal_tty),
      runtimeSurfaceReady: typeof terminal.runtime_surface_ready === "boolean"
        ? terminal.runtime_surface_ready
        : undefined,
      sourceSessionClaims,
      sourceSessionIds,
    }];
  });
}

/* A binary that is not installed is ABSENT, not degraded.

   BunCommandRunner catches the spawn failure and reports exitCode -1 with
   `Executable not found in $PATH: "cmux"`. Matching on that string is admittedly
   brittle, so tests/collector-absence.test.ts drives the REAL runner against a
   genuinely missing binary: if Bun ever changes the wording, that test fails
   loudly rather than this quietly reverting to calling every cmux-less machine
   degraded — which is the whole defect. Nothing here treats a timeout or a
   non-zero exit as absence: those mean cmux IS here and did not answer. */
export function executableMissing(result: CommandResult): boolean {
  return !result.timedOut
    && result.exitCode === -1
    && /executable not found/i.test(result.stderr);
}

export async function collectCmux(
  runner: CommandRunner,
  executable = DEFAULT_CMUX_EXECUTABLE,
): Promise<CollectionResult<CmuxSurface[]>> {
  const result = await runner.run(cmuxCommand(executable, ["rpc", "debug.terminals", "{}"]), 10_000);
  if (executableMissing(result)) return { value: [], errors: [], absent: true };
  if (result.timedOut) return { value: [], errors: ["cmux terminal discovery timed out"] };
  if (result.exitCode !== 0) {
    return {
      value: [],
      errors: [`cmux terminal discovery exited ${result.exitCode}: ${result.stderr.trim() || "no stderr"}`],
    };
  }
  try {
    return { value: parseCmuxTerminals(result.stdout), errors: [] };
  } catch (error) {
    return {
      value: [],
      errors: [`cmux terminal discovery returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

const WORKSPACE_ENV_CACHE_TTL_MS = 60_000;
const workspaceEnvCache = new Map<string, {
  expiresAt: number;
  variables: CmuxWorkspaceEnvVariables;
}>();
const ANTHILL_ENV_KEYS = [
  "ANTHILL_RUN",
  "ANTHILL_LANE",
  "ANTHILL_ROLE",
  "ANTHILL_PARENT",
] as const;
const CMUX_WORKSPACE_NOT_FOUND = /not_found:\s*workspace not found/i;

function envRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function parseCmuxWorkspaceEnv(output: string): CmuxWorkspaceEnvVariables {
  const parsed = JSON.parse(output) as unknown;
  const root = envRecord(parsed)?.result ?? parsed;
  const rootRecord = envRecord(root);
  const nested = rootRecord?.variables ?? rootRecord?.environment ?? rootRecord?.env;
  const source = envRecord(nested) ?? rootRecord;
  const entries = Array.isArray(nested)
    ? nested.flatMap((value): [string, unknown][] => {
        const item = envRecord(value);
        const key = stringValue(item?.name, item?.key);
        return key ? [[key, item?.value]] : [];
      })
    : Object.entries(source ?? {});
  const values = new Map(entries);
  return Object.fromEntries(ANTHILL_ENV_KEYS.flatMap((key) => {
    const value = values.get(key);
    return typeof value === "string" && value.trim().length > 0
      ? [[key, value.trim()]]
      : [];
  })) as CmuxWorkspaceEnvVariables;
}

export async function collectCmuxWorkspaceEnvs(
  runner: CommandRunner,
  workspaceIds: readonly string[],
  executable = DEFAULT_CMUX_EXECUTABLE,
  now: () => number = Date.now,
): Promise<CollectionResult<CmuxWorkspaceEnv[]>> {
  const errors: string[] = [];
  const uniqueWorkspaceIds = [...new Set(workspaceIds.filter(Boolean))];
  const values = await Promise.all(uniqueWorkspaceIds.map(async (workspaceId): Promise<CmuxWorkspaceEnv | undefined> => {
    const cacheKey = `${executable}\u001f${workspaceId}`;
    const cached = workspaceEnvCache.get(cacheKey);
    const nowMs = now();
    if (cached && cached.expiresAt > nowMs) {
      return { workspaceId, variables: cached.variables };
    }
    const result = await runner.run(cmuxCommand(executable, [
      "workspace",
      "env",
      workspaceId,
      "--json",
    ]), 10_000);
    if (result.timedOut) {
      errors.push(`cmux workspace env ${workspaceId} timed out`);
      return undefined;
    }
    if (result.exitCode !== 0) {
      /* Terminal discovery retains last-known workspace IDs for tombstoned
         panes. Their env lookup is an expected enrichment miss, not a control
         failure; every other lookup failure remains operator-visible. */
      if (CMUX_WORKSPACE_NOT_FOUND.test(result.stderr)) return undefined;
      errors.push(
        `cmux workspace env ${workspaceId} exited ${result.exitCode}: ${result.stderr.trim() || "no stderr"}`,
      );
      return undefined;
    }
    try {
      const variables = parseCmuxWorkspaceEnv(result.stdout);
      workspaceEnvCache.set(cacheKey, {
        expiresAt: nowMs + WORKSPACE_ENV_CACHE_TTL_MS,
        variables,
      });
      return { workspaceId, variables };
    } catch (error) {
      errors.push(
        `cmux workspace env ${workspaceId} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }));
  return { value: values.filter((value): value is CmuxWorkspaceEnv => Boolean(value)), errors };
}

function sidebarWorkspaces(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((workspace): workspace is Record<string, unknown> =>
      Boolean(workspace) && typeof workspace === "object" && !Array.isArray(workspace));
  }
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const direct = sidebarWorkspaces(record.workspaces);
  const windows = Array.isArray(record.windows)
    ? record.windows.flatMap((window) => sidebarWorkspaces(window))
    : [];
  return [...direct, ...windows];
}

export function parseCmuxSidebarSnapshot(output: string): CmuxWorkspaceSnapshot[] {
  const parsed = JSON.parse(output) as unknown;
  const root = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? ((parsed as Record<string, unknown>).result ?? parsed)
    : parsed;
  const workspaces = sidebarWorkspaces(root);
  if (!workspaces.length) {
    const hasWorkspaceCollection = Array.isArray(root)
      || (Boolean(root) && typeof root === "object" && (
        Array.isArray((root as Record<string, unknown>).workspaces)
        || Array.isArray((root as Record<string, unknown>).windows)
      ));
    if (!hasWorkspaceCollection) throw new Error("cmux response did not contain a workspace snapshot");
  }
  const byWorkspace = new Map<string, CmuxWorkspaceSnapshot>();
  for (const workspace of workspaces) {
    const workspaceId = stringValue(workspace.id, workspace.workspace_id, workspace.workspaceId);
    if (!workspaceId) continue;
    const branches = Array.isArray(workspace.git_branches)
      ? workspace.git_branches
      : Array.isArray(workspace.gitBranches)
        ? workspace.gitBranches
        : [];
    const git = branches.find((value): value is Record<string, unknown> =>
      Boolean(value) && typeof value === "object" && !Array.isArray(value)
        && Boolean(stringValue((value as Record<string, unknown>).branch)));
    const dirty = git
      ? [git.dirty, git.is_dirty, git.isDirty].find((value): value is boolean => typeof value === "boolean")
      : undefined;
    const pullRequestValues = Array.isArray(workspace.pull_request_urls)
      ? workspace.pull_request_urls
      : Array.isArray(workspace.pullRequestURLs)
        ? workspace.pullRequestURLs
        : Array.isArray(workspace.pullRequestUrls)
          ? workspace.pullRequestUrls
          : [];
    /* Present in the snapshot as `custom_color: null` for an uncolored
       workspace, so an explicit null is carried through as "no color" while a
       snapshot that never mentions the field stays undefined. (TINT-S) */
    const customColor = "custom_color" in workspace || "customColor" in workspace
      ? stringValue(workspace.custom_color, workspace.customColor) ?? null
      : undefined;
    byWorkspace.set(workspaceId, {
      workspaceId,
      ...(customColor === undefined ? {} : { customColor }),
      ...(stringValue(workspace.project_root_path, workspace.projectRootPath)
        ? { projectRootPath: stringValue(workspace.project_root_path, workspace.projectRootPath) }
        : {}),
      ...(git ? { branch: stringValue(git.branch) } : {}),
      ...(dirty === undefined ? {} : { dirty }),
      pullRequestUrls: [...new Set(pullRequestValues.filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      ))],
    });
  }
  return [...byWorkspace.values()];
}

export function parseCmuxWindowIds(output: string): string[] {
  const parsed = JSON.parse(output) as unknown;
  const root = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? ((parsed as Record<string, unknown>).result ?? parsed)
    : parsed;
  const windows = root && typeof root === "object" && !Array.isArray(root)
    ? (root as Record<string, unknown>).windows
    : undefined;
  if (!Array.isArray(windows)) throw new Error("cmux response did not contain a windows array");
  return [...new Set(windows.flatMap((window): string[] => {
    if (!window || typeof window !== "object" || Array.isArray(window)) return [];
    const record = window as Record<string, unknown>;
    const id = stringValue(record.id, record.window_id, record.windowId);
    return id ? [id] : [];
  }))];
}

export function parseCmuxNotificationSummaries(output: string): CmuxNotificationSummary[] {
  const parsed = JSON.parse(output) as unknown;
  const root = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? ((parsed as Record<string, unknown>).result ?? parsed)
    : parsed;
  const notifications = Array.isArray(root)
    ? root
    : root && typeof root === "object" && !Array.isArray(root)
      ? (root as Record<string, unknown>).notifications
      : undefined;
  if (!Array.isArray(notifications)) {
    throw new Error("cmux response did not contain a notifications array");
  }
  return notifications.flatMap((value): CmuxNotificationSummary[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const notification = value as Record<string, unknown>;
    const createdAtRaw = stringValue(notification.created_at, notification.createdAt) ?? "";
    const createdAtMs = Date.parse(createdAtRaw);
    const isRead = [notification.is_read, notification.isRead, notification.read]
      .find((candidate): candidate is boolean => typeof candidate === "boolean")
      ?? notification.unread === false;
    return [{
      id: stringValue(notification.id, notification.notification_id) ?? "",
      workspaceId: stringValue(notification.workspace_id, notification.workspaceId) ?? "",
      surfaceId: stringValue(notification.surface_id, notification.surfaceId) ?? "",
      title: stringValue(notification.title) ?? "",
      subtitle: stringValue(notification.subtitle) ?? "",
      body: stringValue(notification.body) ?? "",
      isRead,
      createdAt: Number.isFinite(createdAtMs) ? new Date(createdAtMs).toISOString() : createdAtRaw,
    }];
  });
}

export function parseCmuxAnchorWorkspaceIds(output: string): string[] {
  const parsed = JSON.parse(output) as unknown;
  const root = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? ((parsed as Record<string, unknown>).result ?? parsed)
    : parsed;
  const groups = Array.isArray(root)
    ? root
    : root && typeof root === "object" && !Array.isArray(root)
      ? ((root as Record<string, unknown>).groups
        ?? (root as Record<string, unknown>).workspace_groups)
      : undefined;
  if (!Array.isArray(groups)) throw new Error("cmux response did not contain a workspace groups array");
  return [...new Set(groups.flatMap((value): string[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const group = value as Record<string, unknown>;
    const id = stringValue(group.anchor_workspace_id, group.anchorWorkspaceId);
    return id ? [id] : [];
  }))];
}

export async function collectCmuxNotificationSummaries(
  runner: CommandRunner,
  executable = DEFAULT_CMUX_EXECUTABLE,
): Promise<CollectionResult<CmuxNotificationSummary[]>> {
  const listed = await runner.run(
    cmuxCommand(executable, ["rpc", "notification.list", "{}"]),
    10_000,
  );
  if (executableMissing(listed)) return { value: [], errors: [], absent: true };
  if (listed.timedOut) return { value: [], errors: ["cmux notification.list timed out"] };
  if (listed.exitCode !== 0) {
    return {
      value: [],
      errors: [`cmux notification.list exited ${listed.exitCode}: ${listed.stderr.trim() || "no stderr"}`],
    };
  }
  let notifications: CmuxNotificationSummary[];
  try {
    notifications = parseCmuxNotificationSummaries(listed.stdout);
  } catch (error) {
    return {
      value: [],
      errors: [`cmux notification.list returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  const windows = await runner.run(
    cmuxCommand(executable, ["rpc", "window.list", "{}"]),
    10_000,
  );
  if (executableMissing(windows)) return { value: [], errors: [], absent: true };
  if (windows.timedOut) return { value: [], errors: ["cmux window discovery timed out"] };
  if (windows.exitCode !== 0) {
    return {
      value: [],
      errors: [`cmux window discovery exited ${windows.exitCode}: ${windows.stderr.trim() || "no stderr"}`],
    };
  }
  let windowIds: string[];
  try {
    windowIds = parseCmuxWindowIds(windows.stdout);
  } catch (error) {
    return {
      value: [],
      errors: [`cmux window discovery returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  const errors: string[] = [];
  const anchors = await Promise.all(windowIds.map(async (windowId): Promise<string[]> => {
    const result = await runner.run(cmuxCommand(executable, [
      "rpc",
      "workspace.group.list",
      JSON.stringify({ window_id: windowId }),
    ]), 10_000);
    if (result.timedOut) {
      errors.push(`cmux workspace group discovery for window ${windowId} timed out`);
      return [];
    }
    if (result.exitCode !== 0) {
      errors.push(
        `cmux workspace group discovery for window ${windowId} exited ${result.exitCode}: ${result.stderr.trim() || "no stderr"}`,
      );
      return [];
    }
    try {
      return parseCmuxAnchorWorkspaceIds(result.stdout);
    } catch (error) {
      errors.push(
        `cmux workspace group discovery for window ${windowId} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }));
  if (errors.length > 0) return { value: [], errors };
  const anchorWorkspaceIds = new Set(anchors.flat());
  return {
    value: notifications.filter((notification) => !anchorWorkspaceIds.has(notification.workspaceId)),
    errors: [],
  };
}

export async function collectCmuxSidebar(
  runner: CommandRunner,
  executable = DEFAULT_CMUX_EXECUTABLE,
): Promise<CollectionResult<CmuxWorkspaceSnapshot[]>> {
  const windows = await runner.run(
    cmuxCommand(executable, ["rpc", "window.list", "{}"]),
    10_000,
  );
  if (executableMissing(windows)) return { value: [], errors: [], absent: true };
  if (windows.timedOut) return { value: [], errors: ["cmux window discovery timed out"] };
  if (windows.exitCode !== 0) {
    return {
      value: [],
      errors: [`cmux window discovery exited ${windows.exitCode}: ${windows.stderr.trim() || "no stderr"}`],
    };
  }
  let windowIds: string[];
  try {
    windowIds = parseCmuxWindowIds(windows.stdout);
  } catch (error) {
    return {
      value: [],
      errors: [`cmux window discovery returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  const errors: string[] = [];
  const perWindow = await Promise.all(windowIds.map(async (windowId) => {
    const result = await runner.run(cmuxCommand(executable, [
      "rpc",
      "workspace.list",
      JSON.stringify({ window_id: windowId }),
    ]), 10_000);
    if (result.timedOut) {
      errors.push(`cmux workspace discovery for window ${windowId} timed out`);
      return [];
    }
    if (result.exitCode !== 0) {
      errors.push(
        `cmux workspace discovery for window ${windowId} exited ${result.exitCode}: ${result.stderr.trim() || "no stderr"}`,
      );
      return [];
    }
    try {
      return parseCmuxSidebarSnapshot(result.stdout);
    } catch (error) {
      errors.push(
        `cmux workspace discovery for window ${windowId} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }));
  const byWorkspace = new Map<string, CmuxWorkspaceSnapshot>();
  for (const workspace of perWindow.flat()) {
    if (!byWorkspace.has(workspace.workspaceId)) byWorkspace.set(workspace.workspaceId, workspace);
  }
  return { value: [...byWorkspace.values()], errors };
}

export function parseCmuxNotifications(output: string): CmuxNotification[] {
  const parsed = JSON.parse(output);
  const notifications = Array.isArray(parsed) ? parsed : parsed?.notifications ?? parsed?.result?.notifications;
  if (!Array.isArray(notifications)) throw new Error("cmux response did not contain a notifications array");
  return notifications.flatMap((notification: Record<string, unknown>) => {
    if (notification.read === true || notification.is_read === true || notification.unread === false) return [];
    /* An unattributable notification used to be dropped here, silently shrinking
       the unread count. It cannot be matched to an agent without a surface, but
       it can still be counted and shown: vanishing is the one handling that
       tells the operator nothing. */
    const surfaceId = stringValue(notification.surface_id, notification.surfaceId) ?? "";
    const createdAtRaw = stringValue(notification.created_at, notification.createdAt);
    /* Left UNSET when unparseable rather than stamped 1970. Acknowledging a
       surface records throughAt from the notification's own time and filter()
       keeps only what is newer, so the epoch lost that comparison forever — a
       parse failure rendered as "nobody needs you". */
    const createdAt = createdAtRaw && Number.isFinite(Date.parse(createdAtRaw))
      ? new Date(createdAtRaw).toISOString()
      : undefined;
    return [{
      id: stringValue(notification.id, notification.notification_id),
      surfaceId,
      workspaceId: stringValue(notification.workspace_id, notification.workspaceId),
      createdAt,
      title: stringValue(notification.title),
      subtitle: stringValue(notification.subtitle),
      body: stringValue(notification.body),
    }];
  });
}

export async function collectCmuxNotifications(
  runner: CommandRunner,
  executable = DEFAULT_CMUX_EXECUTABLE,
  attentionStore?: AttentionStore,
): Promise<CollectionResult<CmuxNotification[]>> {
  const result = await runner.run(cmuxCommand(executable, ["list-notifications", "--json"]), 10_000);
  if (executableMissing(result)) return { value: [], errors: [], absent: true };
  if (result.timedOut) return { value: [], errors: ["cmux notification discovery timed out"] };
  if (result.exitCode !== 0) {
    return {
      value: [],
      errors: [`cmux notification discovery exited ${result.exitCode}: ${result.stderr.trim() || "no stderr"}`],
    };
  }
  try {
    const notifications = parseCmuxNotifications(result.stdout);
    const store = attentionStore ?? await defaultAttentionStore();
    store.observe(notifications);
    return { value: store.filter(notifications), errors: [] };
  } catch (error) {
    return {
      value: [],
      errors: [`cmux notification discovery returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}
