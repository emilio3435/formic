import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { PROVIDERS, type AgentSnapshot, type HubSnapshot, type ProgramSnapshot, type Provider, type SourceHealth, type TriageQueueItem } from "../shared/types";
import { alertFingerprintFor, MemoryAckStore, type AckStore } from "./ack";
import { ARCHIVE_RETENTION_MS, MAX_ARCHIVE_RECORDS } from "./archive";
import { handleBroadcastRequest } from "./broadcast";
import { handleUsageRequest } from "./burnbar";
import { CleanupProposeError, type CleanupProposer } from "./cleanup-propose";
import { CLEANER_NAME, CleanupLaunchError, type CleanupLaunch, type CleanupLauncher } from "./cleanup-launch";
import {
  defaultAttentionStore,
  DEFAULT_CMUX_EXECUTABLE,
  MemoryAttentionStore,
  cmuxCommand,
  type AttentionAction,
  type AttentionStore,
} from "./cmux";
import { closeSurface, closeWorkspace, configureCmuxActions, dismissNotification, markNotificationRead, renameWorkspace } from "./cmux-actions";
import { identityDebugResponse, transcriptResponse } from "./debug-identity";
import { sessionCallsResponse } from "./session-calls";
import { readPublishState, type PublishState } from "./publish-state";
import { canWriteToTarget } from "./targets";
import { modelConfigLoadError } from "./model-config";
import { handleCollectorInstancesRequest, type JsonCollectorInstanceStore } from "./collector-instances";
import { handleControlRequest } from "./http";
import { handleProgramAliasRequest, type ProgramAliasStore } from "./program-aliases";
import {
  DEFAULT_SCAN_WINDOW_HOURS,
  handleSettingsRequest,
  type JsonSettingsStore,
  /* TINT-F */
  handleRepoColorsRequest,
  JsonRepoColorsStore,
  memorySettingsFiles,
  repoColorDiscovery,
  type RepoColorDiscovery,
} from "./settings";
/* TINT-F */
import { setWorkspaceColor, setGroupColor, lastWrittenHex } from "./cmux-color";
/* TINT integration wiring (master) */
import {
  registerRepoGroupInputs,
  JsonRepoGroupProvenanceStore,
  MemoryRepoGroupProvenanceStore,
} from "./cmux-groups";
import { folderKeyForCwd, sameHex } from "../shared/repo-color";
import { snapshotFingerprint } from "./snapshot";
import { handleTriageRequest, MemoryTriageQueueStore, type TriageInvestigationRunner, type TriageQueueStore } from "./triage";
import type { ArchiveStore, CmuxSurface, CommandRunner, FormicHubSnapshot } from "./types";

export interface MountainAppState {
  get(): HubSnapshot;
  subscribe(listener: (snapshot: HubSnapshot) => void): () => void;
  refresh(options?: { cmux?: boolean }): Promise<HubSnapshot>;
  markIssueVerifying?(issueId: string, result?: string): void | Promise<void>;
  markIssueBlocked?(issueId: string, result?: string): void | Promise<void>;
  /** Latest enriched cmux surfaces, for read-only identity debugging. */
  surfaces?(): readonly CmuxSurface[];
}

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ts": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
};

const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

export const PUBLISH_CACHE_MS = 30_000;
export const MAX_SSE_CLIENTS = 16;
/* Under the 30s most proxies and browsers use to declare an idle stream dead. */
export const SSE_HEARTBEAT_MS = 25_000;
/* A client's stream is dropped once its unread backlog exceeds this. The number
   has to be read against the payload it must carry: every client's FIRST event
   is a whole snapshot, enqueued directly and deliberately unchecked, because a
   delta is meaningless without the base it applies to.

   At 2MB it had been overtaken. A live snapshot measured 2,334,323 bytes — 11%
   OVER the entire budget — so from the moment of connection every client sat at
   a negative desiredSize until it finished draining, and the next delta to
   arrive in that window closed its stream. The guard meant to tolerate a slow
   client and drop only a stuck one had no slack left to tolerate anything: one
   byte behind and ten megabytes behind were the same verdict.

   Measured, it was not yet biting — the drain takes 2.2ms on loopback against a
   delta roughly every 3.8s, so the exposure is about 0.06% per update. But it
   grows on both axes at once as the fleet does: a bigger board takes longer to
   drain AND changes more often. 8MB is a little over three snapshots at today's
   size, which is what a BACKLOG budget should mean — a client may fall a few
   updates behind before it is given up on. Worst case it bounds memory at
   MAX_SSE_CLIENTS x this, and `sseBacklogDrops` on /api/health says whether the
   headroom is actually being used. */
export const MAX_SSE_BACKLOG_BYTES = 8 * 1024 * 1024;
export const MAX_HEALTH_SNAPSHOT_AGE_MS = 60_000;
export const ACTION_LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const MAX_ACTION_LOG_ENTRIES = 500;
const CLEANER_OBSERVE_ATTEMPTS = 10;
const CLEANER_OBSERVE_INTERVAL_MS = 500;

export type OperatorActionKind = "focus" | "instruct" | "interrupt" | "broadcast" | "archive" | "unarchive";
export type OperatorActionOutcome = "ok" | "failed" | "partial" | "staged";

export interface OperatorAction {
  id: string;
  at: string;
  kind: OperatorActionKind;
  agentIds: string[];
  outcome: OperatorActionOutcome;
  detail: string;
}

export type NewOperatorAction = Omit<OperatorAction, "id" | "at">;

export interface ActionLogStore {
  list(limit: number): readonly OperatorAction[];
  append(action: NewOperatorAction): Promise<OperatorAction>;
  /* Why the list may be short. appendAction deliberately swallows a persist
     failure — the control it is journalling has already run, so failing the
     response would invite the operator to repeat a completed action — but that
     left the failure nowhere except stderr, and /api/actions went on serving a
     silently incomplete history as though it were the whole record. */
  persistError?(): string | undefined;
}

const ACTION_ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function createActionId(nowMs: number): string {
  let timestamp = Math.floor(nowMs);
  const time = Array.from({ length: 10 }, () => "0");
  for (let index = time.length - 1; index >= 0; index -= 1) {
    time[index] = ACTION_ID_ALPHABET[timestamp % 32]!;
    timestamp = Math.floor(timestamp / 32);
  }
  const random = [...randomBytes(16)]
    .map((value) => ACTION_ID_ALPHABET[value % 32])
    .join("");
  return `act_${time.join("")}${random}`;
}

export class MemoryActionLogStore implements ActionLogStore {
  protected actions: OperatorAction[] = [];
  private mutationQueue: Promise<void> = Promise.resolve();
  private lastPersistError?: string;

  constructor(
    protected readonly now: () => number = Date.now,
    private readonly createId: (nowMs: number) => string = createActionId,
  ) {}

  list(limit: number): readonly OperatorAction[] {
    return this.actions.slice(0, limit);
  }

  append(action: NewOperatorAction): Promise<OperatorAction> {
    return this.mutate(async () => {
      const nowMs = this.now();
      const item: OperatorAction = {
        id: this.createId(nowMs),
        at: new Date(nowMs).toISOString(),
        ...action,
      };
      await this.commit([item, ...this.actions]);
      return item;
    });
  }

  protected async replace(actions: readonly OperatorAction[]): Promise<void> {
    this.actions = retainActions(actions, this.now());
  }

  persistError(): string | undefined {
    return this.lastPersistError;
  }

  private async commit(actions: readonly OperatorAction[]): Promise<void> {
    const retained = retainActions(actions, this.now());
    try {
      await this.persist(retained);
    } catch (error) {
      // Remember it, then rethrow so append() still rejects as it always has.
      this.lastPersistError = error instanceof Error ? error.message : String(error);
      throw error;
    }
    this.lastPersistError = undefined;
    this.actions = retained;
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  protected async persist(_actions: readonly OperatorAction[]): Promise<void> {}
}

export class JsonActionLogStore extends MemoryActionLogStore {
  private writeNumber = 0;

  private constructor(private readonly path: string, now: () => number) {
    super(now);
  }

  static async open(path: string, now: () => number = Date.now): Promise<JsonActionLogStore> {
    const store = new JsonActionLogStore(path, now);
    let pruned = false;
    try {
      const parsed = JSON.parse(await readFile(path, "utf8"));
      if (!Array.isArray(parsed)) throw new Error("action log must be an array");
      for (const value of parsed) {
        if (!isOperatorAction(value)) throw new Error("action log contains an invalid entry");
      }
      const retained = retainActions(parsed, now());
      pruned = retained.length !== parsed.length;
      await store.replace(retained);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        await store.replace([]);
        console.error(
          `[JsonActionLogStore] Ignoring unreadable action log at ${path}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (pruned) await store.persist(store.list(MAX_ACTION_LOG_ENTRIES));
    return store;
  }

  protected override async persist(actions: readonly OperatorAction[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    this.writeNumber += 1;
    const temporary = `${this.path}.${process.pid}.${this.writeNumber}.tmp`;
    await writeFile(temporary, `${JSON.stringify(actions, null, 2)}\n`, "utf8");
    await rename(temporary, this.path);
  }
}

function isOperatorAction(value: unknown): value is OperatorAction {
  if (!value || typeof value !== "object") return false;
  const action = value as Partial<OperatorAction>;
  return typeof action.id === "string" &&
    action.id.startsWith("act_") &&
    typeof action.at === "string" &&
    Number.isFinite(Date.parse(action.at)) &&
    ["focus", "instruct", "interrupt", "broadcast", "archive", "unarchive"].includes(String(action.kind)) &&
    Array.isArray(action.agentIds) &&
    action.agentIds.every((agentId) => typeof agentId === "string") &&
    ["ok", "failed", "partial", "staged"].includes(String(action.outcome)) &&
    typeof action.detail === "string";
}

function retainActions(actions: readonly OperatorAction[], nowMs: number): OperatorAction[] {
  return [...actions]
    .filter((action) => nowMs - Date.parse(action.at) <= ACTION_LOG_RETENTION_MS)
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, MAX_ACTION_LOG_ENTRIES);
}

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

/* Retention as observed rather than as configured. `oldestDays` is the age of
   the oldest record we still hold, which is the only number that answers "is
   the promise being kept" — a policy of 30 days delivering 11 is a different
   fact from one delivering 30, and until now neither was visible. */
function deliveredRetention(
  agents: readonly { archivedAt?: string }[],
  nowMs: number,
): { measured: number; unmeasurable: number; oldestDays: number | null } {
  const ages = agents
    .map((agent) => (agent.archivedAt ? nowMs - Date.parse(agent.archivedAt) : Number.NaN))
    .filter((age) => Number.isFinite(age) && age >= 0);
  return {
    measured: ages.length,
    // Written before archivedAt existed. Counted, not guessed at.
    unmeasurable: agents.length - ages.length,
    oldestDays: ages.length === 0
      ? null
      : Math.round((Math.max(...ages) / (24 * 60 * 60 * 1_000)) * 10) / 10,
  };
}

function compactSnapshotFingerprint(snapshot: HubSnapshot): string {
  return createHash("sha256").update(snapshotFingerprint(snapshot)).digest("base64url");
}

interface SnapshotDeltaProgram extends Omit<ProgramSnapshot, "agents"> {
  agentIds: string[];
  agents: AgentSnapshot[];
}

interface SnapshotDelta {
  schemaVersion: 1;
  baseSequence: number;
  sequence: number;
  snapshot: Omit<HubSnapshot, "programs">;
  programs: SnapshotDeltaProgram[];
}

function snapshotEvent(snapshot: HubSnapshot, sequence: number): string {
  return `id: ${sequence}\nevent: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`;
}

function snapshotDelta(
  previous: HubSnapshot,
  next: HubSnapshot,
  baseSequence: number,
  sequence: number,
): SnapshotDelta {
  const previousPrograms = new Map(previous.programs.map((program) => [program.id, program]));
  const programs = next.programs.map((program): SnapshotDeltaProgram => {
    const previousAgents = new Map(
      (previousPrograms.get(program.id)?.agents ?? []).map((agent) => [agent.id, agent]),
    );
    const changedAgents = program.agents.filter((agent) => {
      const previousAgent = previousAgents.get(agent.id);
      return !previousAgent || JSON.stringify(previousAgent) !== JSON.stringify(agent);
    });
    const { agents: _agents, ...programFields } = program;
    return {
      ...programFields,
      agentIds: program.agents.map((agent) => agent.id),
      agents: changedAgents,
    };
  });
  const { programs: _programs, ...snapshot } = next;
  return { schemaVersion: 1, baseSequence, sequence, snapshot, programs };
}

function snapshotDeltaEvent(delta: SnapshotDelta): string {
  return `id: ${delta.sequence}\nevent: snapshot-delta\ndata: ${JSON.stringify(delta)}\n\n`;
}

export interface MountainAppDependencies {
  state: MountainAppState;
  runner: CommandRunner;
  archiveStore: ArchiveStore;
  actionLogStore?: ActionLogStore;
  attentionStore?: AttentionStore;
  ackStore?: AckStore;
  triageStore?: TriageQueueStore;
  triageRunner?: TriageInvestigationRunner;
  programAliasStore?: ProgramAliasStore;
  settingsStore?: JsonSettingsStore;
  collectorInstances?: JsonCollectorInstanceStore;
  /* TINT-F — repo colour assignments. Defaults to the shipped JSON file when
     the web root is the shipped one, and to memory everywhere else. */
  repoColorsStore?: JsonRepoColorsStore;
  /** TINT-F test seam: skip the cmux fan-out so route tests write nothing. */
  repoColorFanOut?: (writes: readonly { workspaceId: string; hex: string }[]) => void | Promise<void>;
  /**
   * Grants this server process permission to mutate cmux workspace groups.
   * False by default: index.ts grants it only to the OS-exclusive production
   * port, so previews can inspect the same fleet without becoming writers.
   */
  repoGroupMirrorWriter?: boolean;
  cleanupProposer?: CleanupProposer;
  cleanupLauncher?: CleanupLauncher;
  /** Delay between Cleaner publication checks; zero keeps route tests deterministic. */
  cleanupObserveIntervalMs?: number;
  cmuxExecutable?: string;
  now?: () => number;
  webRoot: string;
  /* Repository root for the read-only publish surface. Defaults to the web
     root's parent, which is the checkout in every deployment we ship. */
  repoRoot?: string;
  /* How often an idle event stream sends a heartbeat. Injectable ONLY so the
     path can be exercised: at the shipped 25s no test can afford to wait, which
     is why the interval callback was among the largest never-executed blocks in
     src/server. The heartbeat is what tells a client the connection is alive,
     so a stream that silently stops sending is a board that stops updating and
     reads as merely quiet — the failure this project keeps finding. */
  heartbeatMs?: number;
}

export interface MountainFetch {
  (request: Request): Promise<Response>;
  dispose(): void;
}

function responseError(status: number, code: string, message: string): Response {
  return Response.json(
    { ok: false, error: { code, message } },
    { status, headers: { ...SECURITY_HEADERS, "cache-control": "no-store" } },
  );
}

function sameOriginLoopback(request: Request): boolean {
  const url = new URL(request.url);
  return isLoopback(url.hostname) && request.headers.get("origin") === url.origin;
}

function limitFrom(url: URL, fallback: number, maximum: number): number | Response {
  const raw = url.searchParams.get("limit");
  if (raw === null) return fallback;
  if (!/^[1-9]\d*$/.test(raw) || Number(raw) > maximum) {
    return responseError(400, "INVALID_LIMIT", `limit must be an integer between 1 and ${maximum}.`);
  }
  return Number(raw);
}

/* TINT-F — repo colours: discovery, the default store, and the fan-out.

   Kept beside the route it serves for the same reason defaultActionLogStore is:
   a store that only makes sense for one endpoint. Live colour keys come from
   the band name already on the snapshot (`agent.repo.repoName`). Folder git
   (`folderKeyForCwd`) is memoized by worktree path and used only as an alias
   so persisted the-mountain rows can rebase onto the-ant-hill. A worktree's
   repository does not change under it; a restart re-reads them all. */
const repoKeyByWorktree = new Map<string, string | null>();

function cachedRepoKey(worktreePath: string): string | null {
  let key = repoKeyByWorktree.get(worktreePath);
  if (key === undefined) {
    key = folderKeyForCwd(worktreePath);
    repoKeyByWorktree.set(worktreePath, key);
  }
  return key;
}

export function resetRepoKeyCache(): void {
  repoKeyByWorktree.clear();
}

/* Workspaces come from the collector's own resolved bindings — an agent's
   `target.workspaceId` — and from nowhere else. That is what keeps GROUP ANCHOR
   workspaces out of the fan-out once mirrorGroups is on: `workspace.group.create`
   also mints an anchor row carrying the group's cwd, which looks repo-mapped
   from `workspace.list` but holds no session, so no agent ever points at it and
   it never reaches this walk. TINT-S filters anchors at the collector; anything
   here that started enumerating workspaces directly would have to filter them
   again, and writing a colour to an anchor is a defect the sync then fights. */
export function discoverRepoColors(
  snapshot: HubSnapshot,
  folderKeys?: Readonly<Record<string, string | null>>,
): RepoColorDiscovery {
  return repoColorDiscovery(snapshot.programs.flatMap((program) =>
    program.agents.flatMap((agent) => {
      const worktreePath = agent.repo?.worktreePath;
      return [{
        repoKey: agent.repo?.repoName?.trim().toLowerCase() || null,
        repoName: agent.repo?.repoName,
        folderKey: worktreePath
          ? (folderKeys && worktreePath in folderKeys ? folderKeys[worktreePath] : cachedRepoKey(worktreePath))
          : null,
        workspaceId: agent.target?.workspaceId,
      }];
    })));
}

function defaultRepoColorsStore(webRoot: string): Promise<JsonRepoColorsStore> {
  const productionWebRoot = resolve(import.meta.dir, "../web");
  return resolve(webRoot) === productionWebRoot
    ? JsonRepoColorsStore.open(resolve(productionWebRoot, "../../data/repo-colors.json"))
    : JsonRepoColorsStore.open("repo-colors.json", memorySettingsFiles());
}

async function fanOutRepoColors(writes: readonly { workspaceId: string; hex: string }[]): Promise<void> {
  /* Only what has changed since this process last wrote it. Re-asserting an
     already-correct colour on every poll would be dozens of cmux round trips a
     minute, and every one of them a chance for TINT-S to read an echo. */
  for (const { workspaceId, hex } of writes) {
    if (sameHex(lastWrittenHex(workspaceId), hex)) continue;
    await setWorkspaceColor(workspaceId, hex, "board assignment");
  }
}

function defaultActionLogStore(webRoot: string): Promise<ActionLogStore> {
  const productionWebRoot = resolve(import.meta.dir, "../web");
  return resolve(webRoot) === productionWebRoot
    ? JsonActionLogStore.open(resolve(productionWebRoot, "../../data/actions.json"))
    : Promise.resolve(new MemoryActionLogStore());
}

async function jsonRecord(request: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

async function actionResponse(response: Response): Promise<Record<string, any> | undefined> {
  try {
    const value = await response.clone().json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, any>
      : undefined;
  } catch {
    return undefined;
  }
}

async function appendAction(
  store: ActionLogStore,
  action: NewOperatorAction,
): Promise<void> {
  try {
    await store.append(action);
  } catch (error) {
    console.error(
      `[ActionLog] Could not persist ${action.kind}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function recordControlAction(
  store: ActionLogStore,
  requestBody: Record<string, unknown> | undefined,
  response: Response,
): Promise<void> {
  const kind = requestBody?.action;
  const agentId = requestBody?.agentId;
  if (
    !["focus", "instruct", "interrupt", "archive", "unarchive"].includes(String(kind)) ||
    typeof agentId !== "string"
  ) return;
  const body = await actionResponse(response);
  const code = typeof body?.error?.code === "string" ? body.error.code : undefined;
  const message = typeof body?.error?.message === "string" ? body.error.message : undefined;
  const outcome: OperatorActionOutcome = body?.ok === true
    ? "ok"
    : code === "TEXT_STAGED_NOT_SUBMITTED"
      ? "staged"
      : "failed";
  const detail = outcome === "ok"
    ? `${kind} completed for 1 agent`
    : code
      ? `${code}: ${message ?? "Control failed."}`
      : `Control returned HTTP ${response.status}.`;
  await appendAction(store, {
    kind: kind as OperatorActionKind,
    agentIds: [agentId],
    outcome,
    detail,
  });
}

async function recordBroadcastAction(
  store: ActionLogStore,
  requestBody: Record<string, unknown> | undefined,
  response: Response,
): Promise<void> {
  const agentIds = requestBody?.agentIds;
  if (!Array.isArray(agentIds) || !agentIds.every((agentId) => typeof agentId === "string")) return;
  const body = await actionResponse(response);
  const sent = typeof body?.sent === "number" ? body.sent : 0;
  const failed = typeof body?.failed === "number" ? body.failed : agentIds.length;
  const outcome: OperatorActionOutcome = failed === 0 && body?.ok === true
    ? "ok"
    : sent > 0
      ? "partial"
      : "failed";
  const detail = typeof body?.sent === "number" && typeof body?.failed === "number"
    ? `${sent} of ${sent + failed} recipients delivered`
    : `Broadcast returned HTTP ${response.status}.`;
  await appendAction(store, {
    kind: "broadcast",
    agentIds: [...agentIds],
    outcome,
    detail,
  });
}

export function createMountainFetch(dependencies: MountainAppDependencies): MountainFetch {
  let disposed = false;
  configureCmuxActions({
    runner: dependencies.runner,
    ...(dependencies.cmuxExecutable ? { executable: dependencies.cmuxExecutable } : {}),
  });
  const triageStore = dependencies.triageStore ?? new MemoryTriageQueueStore();
  const actionLogStore = dependencies.actionLogStore
    ? Promise.resolve(dependencies.actionLogStore)
    : defaultActionLogStore(dependencies.webRoot);
  const attentionStore = dependencies.attentionStore
    ? Promise.resolve(dependencies.attentionStore)
    : resolve(dependencies.webRoot) === resolve(import.meta.dir, "../web")
      ? defaultAttentionStore()
      : Promise.resolve(new MemoryAttentionStore());
  /* TINT-F */
  const repoColorsStore = dependencies.repoColorsStore
    ? Promise.resolve(dependencies.repoColorsStore)
    : defaultRepoColorsStore(dependencies.webRoot);
  /* TINT integration wiring (master): the one call TINT-G left to the
     integrator. The provider feeds the sidebar mirror from the same discovery
     walk and store the /api/repo-colors endpoint uses, so the mirror and the
     endpoint can never disagree about a repository's colour. Sync by contract:
     store.get() is the cached settings and discovery reads the last snapshot —
     the tick rides the collector poll, so both are at most one poll old. The
     provider returns null until the store resolves; the tick treats null as
     "not wired yet" and stays inert, so startup order cannot race. */
  let repoColorsForGroups: JsonRepoColorsStore | undefined;
  void repoColorsStore.then((store) => { repoColorsForGroups = store; });
  let disposeRepoGroupRegistration: (() => void) | undefined;
  if (dependencies.repoGroupMirrorWriter === true) {
    const groupProvenance = resolve(dependencies.webRoot) === resolve(import.meta.dir, "../web")
      ? JsonRepoGroupProvenanceStore.open(resolve(import.meta.dir, "../../data/repo-group-provenance.json"))
      : Promise.resolve(new MemoryRepoGroupProvenanceStore());
    void groupProvenance.then((provenance) => {
      if (disposed) return;
      disposeRepoGroupRegistration = registerRepoGroupInputs(() => {
        const store = repoColorsForGroups;
        if (!store) return null;
        const settings = store.get();
        const snapshot = dependencies.state.get();
        const discovery = discoverRepoColors(snapshot);
        const targets = Object.entries(discovery.workspaces).flatMap(([workspaceId, repoKey]) => {
          const assignment = settings.assignments[repoKey];
          return assignment ? [{ workspaceId, repoKey, hex: assignment.hex }] : [];
        });
        /* A pass that missed its deadline, or whose routing evidence was
           withdrawn, publishes agents with no terminal target at all — the walk
           above then yields nothing, and an empty `targets` is indistinguishable
           from "every repo emptied at once". Both of those land in
           controlHealth.errors (state.ts pushes the deadline into
           collectionErrors, which becomes #cmuxErrors, which becomes this), so
           the same snapshot that hides the targets also says it cannot vouch for
           them. The mirror may keep building on a degraded pass; it may not tear
           anything down. */
        const controlHealth = snapshot.controlHealth;
        const targetsComplete = controlHealth.cmuxReachable && controlHealth.errors.length === 0;
        return { mirrorGroups: settings.mirrorGroups, targets, targetsComplete, setGroupColor };
      }, provenance);
    });
  }
  const ackStore = dependencies.ackStore ?? new MemoryAckStore(dependencies.now);
  const cleanupObserveIntervalMs = dependencies.cleanupObserveIntervalMs ?? CLEANER_OBSERVE_INTERVAL_MS;
  let recollectInFlight: Promise<HubSnapshot> | undefined;
  const recollect = (): Promise<HubSnapshot> => {
    if (!recollectInFlight) {
      recollectInFlight = dependencies.state.refresh({ cmux: true }).finally(() => {
        recollectInFlight = undefined;
      });
    }
    return recollectInFlight;
  };
  let cleanupProposeInFlight: ReturnType<CleanupProposer> | undefined;
  const cleanupPropose = (): ReturnType<CleanupProposer> => {
    if (!dependencies.cleanupProposer) {
      return Promise.reject(
        new CleanupProposeError("CLEANUP_UNAVAILABLE", "Cleanup propose is not configured on this server."),
      );
    }
    if (!cleanupProposeInFlight) {
      const run = dependencies.cleanupProposer();
      const tracked = run.finally(() => {
        if (cleanupProposeInFlight === tracked) cleanupProposeInFlight = undefined;
      });
      cleanupProposeInFlight = tracked;
    }
    return cleanupProposeInFlight;
  };
  let cleanerSession: CleanupLaunch & { observed: boolean } | undefined;
  let cleanupLaunchInFlight: Promise<CleanupLaunch> | undefined;
  const cleanerAgent = (sessionId: string, snapshot = dependencies.state.get()) =>
    snapshot.programs.flatMap(({ agents }) => agents).find(
      (agent) => agent.provider === "cursor" && agent.sourceSessionId === sessionId,
    );
  const runningCleaner = () => dependencies.state.get().programs
    .flatMap(({ agents }) => agents)
    .find((agent) =>
      agent.provider === "cursor" && agent.identity?.name === CLEANER_NAME && agent.activity !== "ended"
    );
  const alreadyRunning = (sessionId: string): CleanupLaunchError => Object.assign(
    new CleanupLaunchError(
      "CLEANER_ALREADY_RUNNING",
      `Cleaner session ${sessionId} is already running; bind to that session instead of launching another lane.`,
    ),
    { sessionId },
  );
  const observeCleaner = async (sessionId: string): Promise<void> => {
    for (let attempt = 0; attempt < CLEANER_OBSERVE_ATTEMPTS; attempt += 1) {
      const snapshot = await recollect();
      if (cleanerAgent(sessionId, snapshot)) return;
      if (attempt + 1 < CLEANER_OBSERVE_ATTEMPTS && cleanupObserveIntervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, cleanupObserveIntervalMs));
      }
    }
    throw new CleanupLaunchError(
      "CLEANER_SESSION_NOT_OBSERVED",
      `Cursor session ${sessionId} did not appear in a fresh snapshot, so the board cannot bind to the Cleaner lane.`,
    );
  };
  const runCleanupLaunch = async (): Promise<CleanupLaunch> => {
    if (cleanerSession) {
      const current = cleanerAgent(cleanerSession.sessionId);
      if (cleanerSession.observed && current?.activity === "ended") cleanerSession = undefined;
      else {
        if (!cleanerSession.observed) {
          await observeCleaner(cleanerSession.sessionId);
          cleanerSession.observed = true;
          return { sessionId: cleanerSession.sessionId };
        }
        throw alreadyRunning(cleanerSession.sessionId);
      }
    }
    const existing = runningCleaner();
    if (existing) {
      cleanerSession = { sessionId: existing.sourceSessionId, observed: true };
      throw alreadyRunning(existing.sourceSessionId);
    }
    if (!dependencies.cleanupLauncher) {
      throw new CleanupLaunchError("CLEANER_UNAVAILABLE", "Cleaner launch is not configured on this server.");
    }
    const launched = await dependencies.cleanupLauncher();
    cleanerSession = { ...launched, observed: false };
    await observeCleaner(launched.sessionId);
    cleanerSession.observed = true;
    return launched;
  };
  const cleanupLaunch = (): Promise<CleanupLaunch> => {
    if (!cleanupLaunchInFlight) {
      const run = runCleanupLaunch();
      const tracked = run.finally(() => {
        if (cleanupLaunchInFlight === tracked) cleanupLaunchInFlight = undefined;
      });
      cleanupLaunchInFlight = tracked;
    }
    return cleanupLaunchInFlight;
  };
  const clients = new Set<ReadableStreamDefaultController<string>>();
  /* Streams the server closed for backpressure, as distinct from clients that
     left. Nonzero means the board is outgrowing its own delivery budget. */
  let sseBacklogDrops = 0;
  const heartbeatTimers = new Map<ReadableStreamDefaultController<string>, ReturnType<typeof setInterval>>();
  const removeClient = (client: ReadableStreamDefaultController<string>): void => {
    clients.delete(client);
    const timer = heartbeatTimers.get(client);
    if (timer) clearInterval(timer);
    heartbeatTimers.delete(client);
  };
  const dropClient = (client: ReadableStreamDefaultController<string>): void => {
    removeClient(client);
    try {
      client.close();
    } catch {
      // A disconnected client may already have closed its stream.
    }
  };
  const enqueueClient = (client: ReadableStreamDefaultController<string>, event: string): void => {
    if (client.desiredSize !== null && client.desiredSize <= 0) {
      /* Recorded, because this is the one disconnect the SERVER chooses. A
         client that goes away throws on enqueue below and is simply forgotten;
         this one was still connected and we stopped talking to it. It presents
         to the operator as a board that quietly stopped updating — EventSource
         reconnects, pulls another whole snapshot, and can be dropped again — so
         leaving it uncounted meant the only symptom was staleness with nothing
         anywhere to explain it. */
      sseBacklogDrops += 1;
      console.error(
        `[SSE] dropped a client whose backlog exceeded ${MAX_SSE_BACKLOG_BYTES} bytes `
        + `(${sseBacklogDrops} so far); it will reconnect and be sent a full snapshot again`,
      );
      dropClient(client);
      return;
    }
    try {
      client.enqueue(event);
    } catch {
      removeClient(client);
    }
  };
  const markIssuesForAgents = async (agentIds: readonly string[]): Promise<void> => {
    if (agentIds.length === 0) return;
    const affected = new Set(agentIds);
    for (const issue of dependencies.state.get().issues ?? []) {
      if (issue.affectedAgentIds.some((agentId) => affected.has(agentId))) {
        await dependencies.state.markIssueVerifying?.(issue.id);
      }
    }
  };
  const refreshForTriage = async (item: TriageQueueItem): Promise<void> => {
    if (item.state === "blocked") {
      await dependencies.state.markIssueBlocked?.(item.issueId, item.result);
    } else {
      await dependencies.state.markIssueVerifying?.(item.issueId, item.result);
    }
    await dependencies.state.refresh({ cmux: true });
  };
  const unsubscribeTriage = triageStore.subscribe?.((item) => {
    if (item.state === "completed" || item.state === "blocked") void refreshForTriage(item);
  });
  const hydrateTriageLifecycle = async (): Promise<void> => {
    const items = triageStore.list();
    if (items.length === 0) return;
    for (const item of items) {
      if (item.state === "blocked") {
        await dependencies.state.markIssueBlocked?.(item.issueId, item.result);
      } else {
        await dependencies.state.markIssueVerifying?.(item.issueId, item.result);
      }
    }
    await dependencies.state.refresh({ cmux: true });
  };
  void hydrateTriageLifecycle();
  const initialSnapshot = dependencies.state.get();
  let fingerprint = compactSnapshotFingerprint(initialSnapshot);
  let currentSnapshot = initialSnapshot;
  let snapshotSequence = 0;
  let currentSnapshotEvent = snapshotEvent(initialSnapshot, snapshotSequence);
  const unsubscribe = dependencies.state.subscribe((snapshot) => {
    const nextFingerprint = compactSnapshotFingerprint(snapshot);
    /* The fingerprint deliberately ignores generatedAt, controlHealth
       .lastCheckedAt and elapsedMs, so "no material change" still means "newer
       evidence". Returning early used to leave currentSnapshot pinned to an old
       object while /api/health reported the age of state.get(): the two
       endpoints answered from different snapshots, and a quiet fleet could hold
       /api/snapshot's generatedAt past the 60s staleness line while health kept
       saying ok. Adopt every snapshot; spend a sequence number and an SSE delta
       only on a material one. */
    if (nextFingerprint === fingerprint) {
      currentSnapshot = snapshot;
      currentSnapshotEvent = snapshotEvent(snapshot, snapshotSequence);
      return;
    }
    const baseSequence = snapshotSequence;
    snapshotSequence += 1;
    const deltaEvent = snapshotDeltaEvent(
      snapshotDelta(currentSnapshot, snapshot, baseSequence, snapshotSequence),
    );
    fingerprint = nextFingerprint;
    currentSnapshot = snapshot;
    currentSnapshotEvent = snapshotEvent(snapshot, snapshotSequence);
    for (const client of clients) {
      enqueueClient(client, deltaEvent);
    }
  });

  /* Reading the publish state costs a handful of git calls, so it is computed
     on demand and held briefly rather than recomputed on every poll. */
  let publishCache: { atMs: number; value: PublishState } | undefined;
  const publishState = async (): Promise<PublishState> => {
    const nowMs = dependencies.now?.() ?? Date.now();
    if (publishCache && nowMs - publishCache.atMs < PUBLISH_CACHE_MS) return publishCache.value;
    const value = await readPublishState(
      dependencies.runner,
      dependencies.repoRoot ?? resolve(dependencies.webRoot, ".."),
      nowMs,
    );
    publishCache = { atMs: nowMs, value };
    return value;
  };

  const fetch = (async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (!isLoopback(url.hostname)) {
      if (["/api/transcript", "/api/actions", "/api/publish"].includes(url.pathname)) {
        return responseError(403, "ORIGIN_REJECTED", "Read endpoints require exact same-origin loopback access.");
      }
      return new Response("Forbidden", { status: 403, headers: SECURITY_HEADERS });
    }
    if (disposed) return new Response("Server is shutting down", { status: 503, headers: SECURITY_HEADERS });
    if (url.pathname === "/api/transcript") {
      if (request.method !== "GET") return responseError(405, "METHOD_NOT_ALLOWED", "Use GET for transcript reads.");
      const agentId = url.searchParams.get("agent");
      if (!agentId?.trim() || agentId.length > 300) {
        return responseError(400, "INVALID_AGENT_ID", "agent must be a non-empty ID no longer than 300 characters.");
      }
      const limit = limitFrom(url, 200, 1_000);
      if (limit instanceof Response) return limit;
      return transcriptResponse(dependencies.state.get(), agentId, limit, SECURITY_HEADERS);
    }
    if (url.pathname === "/api/publish") {
      if (request.method !== "GET") {
        /* Read-only by construction. Publishing is the operator's decision and
           stays manual, so this surface reports and never acts: there is no
           POST here and no push anywhere behind it. */
        return responseError(405, "METHOD_NOT_ALLOWED", "Use GET. This surface reports and never publishes.");
      }
      return Response.json(await publishState(), {
        headers: { ...SECURITY_HEADERS, "cache-control": "no-store" },
      });
    }
    if (url.pathname === "/api/cleanup/propose") {
      if (request.method !== "POST") {
        return responseError(405, "METHOD_NOT_ALLOWED", "Use POST to enumerate a cleanup proposal.");
      }
      if (!sameOriginLoopback(request)) {
        return responseError(403, "ORIGIN_REJECTED", "Cleanup proposals require an exact same-origin loopback Origin header.");
      }
      try {
        return Response.json(
          { ok: true, complete: true, plan: await cleanupPropose() },
          { headers: { ...SECURITY_HEADERS, "cache-control": "no-store" } },
        );
      } catch (error) {
        const candidate = error as { code?: unknown; message?: unknown };
        return Response.json(
          {
            ok: false,
            complete: false,
            error: {
              code: typeof candidate.code === "string" ? candidate.code : "CLEANUP_PROPOSE_FAILED",
              message: typeof candidate.message === "string" ? candidate.message : String(error),
            },
          },
          { status: 503, headers: { ...SECURITY_HEADERS, "cache-control": "no-store" } },
        );
      }
    }
    if (url.pathname === "/api/cleanup/launch") {
      if (request.method !== "POST") {
        return responseError(405, "METHOD_NOT_ALLOWED", "Use POST to launch the Cleaner lane.");
      }
      if (!sameOriginLoopback(request)) {
        return responseError(403, "ORIGIN_REJECTED", "Cleaner launch requires an exact same-origin loopback Origin header.");
      }
      try {
        const { sessionId } = await cleanupLaunch();
        return Response.json(
          { ok: true, sessionId },
          { headers: { ...SECURITY_HEADERS, "cache-control": "no-store" } },
        );
      } catch (error) {
        const candidate = error as { code?: unknown; message?: unknown; sessionId?: unknown };
        const code = typeof candidate.code === "string" ? candidate.code : "CLEANER_LAUNCH_FAILED";
        return Response.json(
          {
            ok: false,
            ...(typeof candidate.sessionId === "string" ? { sessionId: candidate.sessionId } : {}),
            error: {
              code,
              message: typeof candidate.message === "string" ? candidate.message : String(error),
            },
          },
          {
            status: code === "CLEANER_ALREADY_RUNNING" ? 409 : 503,
            headers: { ...SECURITY_HEADERS, "cache-control": "no-store" },
          },
        );
      }
    }
    if (url.pathname === "/api/actions") {
      if (request.method !== "GET") return responseError(405, "METHOD_NOT_ALLOWED", "Use GET for action-log reads.");
      const limit = limitFrom(url, 100, 500);
      if (limit instanceof Response) return limit;
      const store = await actionLogStore;
      const journalError = store.persistError?.();
      return Response.json(
        {
          ok: true,
          actions: store.list(limit),
          // An incomplete history must not read as a complete one.
          journal: journalError ? { healthy: false, error: journalError } : { healthy: true },
        },
        { headers: { ...SECURITY_HEADERS, "cache-control": "no-store" } },
      );
    }
    if (url.pathname === "/api/history/export") {
      if (request.method !== "GET") return responseError(405, "METHOD_NOT_ALLOWED", "Use GET for history exports.");
      const exportedAt = new Date(dependencies.now?.() ?? Date.now()).toISOString();
      return Response.json(
        {
          schemaVersion: 1,
          exportedAt,
          /* The POLICY. It was published alone, which made it a claim nobody
             could check: the window was measured from each agent's last
             activity rather than from when we archived it, so a session quiet
             for 31 days was pruned on the very next commit while the operator
             was told ok: true. A constant printed beside data it does not
             describe is the same defect as a figure with no coverage. */
          retentionDays: ARCHIVE_RETENTION_MS / (24 * 60 * 60 * 1_000),
          /* What was actually DELIVERED, measured from the records themselves.
             Absent-first: records written before archivedAt existed cannot be
             measured, and are counted rather than guessed at, so a reader can
             tell "we kept 30 days" from "we cannot yet say". */
          deliveredRetention: deliveredRetention(
            dependencies.archiveStore.archivedAgents?.() ?? [],
            Date.parse(exportedAt),
          ),
          maxRecords: MAX_ARCHIVE_RECORDS,
          agents: dependencies.archiveStore.archivedAgents?.() ?? [],
        },
        {
          headers: {
            ...SECURITY_HEADERS,
            "cache-control": "no-store",
            "content-disposition": `attachment; filename="ant-hill-history-${exportedAt.slice(0, 10)}.json"`,
          },
        },
      );
    }
    if (url.pathname === "/api/attention") {
      if (request.method !== "POST") return responseError(405, "METHOD_NOT_ALLOWED", "Use POST for attention changes.");
      if (!sameOriginLoopback(request)) {
        return responseError(403, "ORIGIN_REJECTED", "Attention changes require an exact same-origin loopback Origin header.");
      }
      if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
        return responseError(415, "CONTENT_TYPE_REJECTED", "Attention changes require application/json.");
      }
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > 2_048) {
        return responseError(413, "BODY_TOO_LARGE", "Attention body exceeds 2048 bytes.");
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return responseError(400, "INVALID_JSON", "Attention body is not valid JSON.");
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return responseError(400, "INVALID_ATTENTION_REQUEST", "Body must be an attention action object.");
      }
      const record = body as Record<string, unknown>;
      const action = record.action;
      const agentId = record.agentId;
      const keys = Object.keys(record);
      if (
        !["acknowledge", "dismiss", "snooze"].includes(String(action)) ||
        typeof agentId !== "string" ||
        !agentId.trim() ||
        agentId.length > 300 ||
        keys.some((key) => !["action", "agentId", "until"].includes(key)) ||
        (action === "snooze" ? keys.length !== 3 : keys.length !== 2)
      ) {
        return responseError(
          400,
          "INVALID_ATTENTION_REQUEST",
          "Body must contain agentId and acknowledge, dismiss, or snooze; snooze also requires until.",
        );
      }
      let until: string | undefined;
      if (action === "snooze") {
        const nowMs = dependencies.now?.() ?? Date.now();
        const untilMs = typeof record.until === "string" ? Date.parse(record.until) : Number.NaN;
        if (!Number.isFinite(untilMs) || untilMs <= nowMs || untilMs > nowMs + ACTION_LOG_RETENTION_MS) {
          return responseError(400, "INVALID_SNOOZE_UNTIL", "until must be a future ISO timestamp no more than seven days away.");
        }
        until = new Date(untilMs).toISOString();
      }
      const agent = dependencies.state.get().programs
        .flatMap((program) => program.agents)
        .find((candidate) => candidate.id === agentId);
      if (!agent) return responseError(404, "AGENT_NOT_FOUND", "The agent is not present in the current snapshot.");
      /* Acknowledging writes attention state keyed by SURFACE, so on a row
         resolved by directory match it clears the notification belonging to
         whatever pane that row currently points at. 547679e closed this hole in
         control.ts and missed it here, which is how the same defect survived on
         two paths. Clearing another agent's request for a human is quieter than
         a misrouted instruction and worse in one respect: the signal that
         someone needed help is gone and nothing reports that it was. */
      if (!canWriteToTarget(agent.target)) {
        return responseError(
          409,
          "UNSAFE_TARGET",
          agent.target.surfaceId
            ? "This pane was matched by its working directory, not attested by cmux, so the session on it cannot be proven."
              + " Acknowledging here could clear a different agent's request for a human."
              + " This returns as soon as cmux attests the session."
            : "The agent has no safely resolved cmux surface.",
        );
      }
      try {
        const state = await (await attentionStore).apply(
          agent.target.surfaceId,
          action as AttentionAction,
          until,
        );
        try {
          await dependencies.state.refresh({ cmux: true });
        } catch (error) {
          return responseError(
            500,
            "ATTENTION_REFRESH_FAILED",
            `Attention state was persisted, but the snapshot refresh failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        return Response.json(
          { ok: true, agentId, state },
          { headers: { ...SECURITY_HEADERS, "cache-control": "no-store" } },
        );
      } catch (error) {
        const code = (error as Error & { code?: string }).code;
        return responseError(
          code === "ATTENTION_NOT_FOUND" ? 404 : 500,
          code ?? "ATTENTION_WRITE_FAILED",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    if (request.method === "POST" && url.pathname === "/api/recollect") {
      const origin = request.headers.get("origin");
      if (!origin || origin !== url.origin) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "ORIGIN_REJECTED",
              message: "Recollect requests require an exact same-origin loopback Origin header.",
            },
          },
          { status: 403, headers: { ...SECURITY_HEADERS, "cache-control": "no-store" } },
        );
      }
      try {
        const snapshot = await recollect();
        return Response.json(snapshot, {
          headers: {
            ...SECURITY_HEADERS,
            "cache-control": "no-store",
            "x-ant-hill-snapshot-sequence": String(snapshotSequence),
          },
        });
      } catch (error) {
        return Response.json(
          {
            ok: false,
            error: {
              code: "RECOLLECT_FAILED",
              message: error instanceof Error ? error.message : String(error),
            },
          },
          { status: 500, headers: { ...SECURITY_HEADERS, "cache-control": "no-store" } },
        );
      }
    }
    if (request.method === "GET" && url.pathname === "/api/debug/session-calls") {
      const agentId = url.searchParams.get("agent");
      if (!agentId) {
        return responseError(400, "AGENT_REQUIRED", "Pass ?agent=<agent id> to read a session's per-call series.");
      }
      return sessionCallsResponse(dependencies.state.get(), agentId, SECURITY_HEADERS);
    }
    if (request.method === "GET" && url.pathname === "/api/debug/identity") {
      return identityDebugResponse(url, dependencies.state.get(), dependencies.state.surfaces?.() ?? [], SECURITY_HEADERS);
    }
    if (url.pathname === "/api/health") {
      if (request.method !== "GET") {
        return responseError(405, "METHOD_NOT_ALLOWED", "Use GET for health reads.");
      }
      const snapshot = dependencies.state.get();
      const generatedAtMs = Date.parse(snapshot.generatedAt);
      const ageMs = Number.isFinite(generatedAtMs)
        ? Math.max(0, (dependencies.now?.() ?? Date.now()) - generatedAtMs)
        : null;
      const healthy = ageMs !== null && ageMs <= MAX_HEALTH_SNAPSHOT_AGE_MS;
      /* Freshness is not completeness. A collector that times out or errors
         still leaves a freshly generated snapshot behind, so a partial or empty
         board answered "healthy" for the next 60 seconds and liveness
         monitoring reported green over data that was missing.
         `ok` deliberately stays a liveness verdict — a supervisor must not
         restart a perfectly live process because one provider hiccupped — so
         the data verdict rides alongside it instead of collapsing into it.
         Read from staleSources and cmuxReachable rather than the sourceHealth
         scalars: those count a different population than their own byProvider
         map, which is a separate unresolved defect this must not inherit. */
      const staleSources = snapshot.controlHealth?.staleSources ?? [];
      const cmuxReachable = snapshot.controlHealth?.cmuxReachable ?? null;
      const controlErrors = snapshot.controlHealth?.errors?.length ?? 0;
      /* Operator state that failed to load is an incompleteness of what the
         board is showing, not of the fleet: acknowledged notifications come
         back unread, so the board asks for attention it was already given. */
      const operatorStateError = (await attentionStore).loadError?.();
      /* Built-in model defaults standing in for a config that failed to load
         change context percentages and compliance verdicts without looking
         wrong, so the health surface names it rather than leaving it in stderr. */
      const configError = modelConfigLoadError();
      return Response.json(
        {
          ok: healthy,
          verdict: healthy ? "healthy" : "stale",
          snapshot: {
            generatedAt: snapshot.generatedAt,
            ageMs,
            maxAgeMs: MAX_HEALTH_SNAPSHOT_AGE_MS,
          },
          data: {
            complete: staleSources.length === 0 && cmuxReachable !== false
              && !operatorStateError && !configError,
            staleSources: [...staleSources],
            cmuxReachable,
            controlErrors,
            /* Not part of `complete`: a dropped stream does not make the
               SNAPSHOT incomplete, it makes delivery of it unreliable. It rides
               here because this is where facts live that a liveness check calls
               green — the board keeps rendering whatever it last received. */
            sseBacklogDrops,
            ...(operatorStateError ? { operatorStateError } : {}),
            ...(configError ? { configError } : {}),
          },
        },
        {
          status: healthy ? 200 : 503,
          headers: { ...SECURITY_HEADERS, "cache-control": "no-store" },
        },
      );
    }
    if (request.method === "GET" && url.pathname === "/api/snapshot") {
      return Response.json(currentSnapshot, {
        headers: {
          ...SECURITY_HEADERS,
          "cache-control": "no-store",
          "x-ant-hill-snapshot-sequence": String(snapshotSequence),
        },
      });
    }
    if (request.method === "GET" && url.pathname === "/api/events") {
      if (clients.size >= MAX_SSE_CLIENTS) {
        return new Response("Too many event streams", {
          status: 503,
          headers: { ...SECURITY_HEADERS, "cache-control": "no-store" },
        });
      }
      let client: ReadableStreamDefaultController<string> | undefined;
      const stream = new ReadableStream<string>({
        start(controller) {
          client = controller;
          clients.add(controller);
          controller.enqueue(currentSnapshotEvent);
          heartbeatTimers.set(
            controller,
            setInterval(() => {
              enqueueClient(
                controller,
                `event: heartbeat\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`,
              );
            }, dependencies.heartbeatMs ?? SSE_HEARTBEAT_MS),
          );
        },
        cancel() {
          if (client) removeClient(client);
        },
      }, {
        highWaterMark: MAX_SSE_BACKLOG_BYTES,
        size: (event) => new TextEncoder().encode(event).byteLength,
      });
      return new Response(stream, {
        headers: {
          ...SECURITY_HEADERS,
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "content-type": "text/event-stream; charset=utf-8",
        },
      });
    }
    if (url.pathname === "/api/control") {
      const body = jsonRecord(request.clone());
      const response = await handleControlRequest(request, {
        getSnapshot: () => dependencies.state.get(),
        runner: dependencies.runner,
        archiveStore: dependencies.archiveStore,
        cmuxExecutable: dependencies.cmuxExecutable,
        afterControl: async (agentIds) => {
          await markIssuesForAgents(agentIds ?? []);
          await dependencies.state.refresh({ cmux: true });
        },
      });
      await recordControlAction(await actionLogStore, await body, response);
      return response;
    }
    if (url.pathname === "/api/broadcast") {
      const body = jsonRecord(request.clone());
      const response = await handleBroadcastRequest(request, {
        getSnapshot: () => dependencies.state.get(),
        runner: dependencies.runner,
        archiveStore: dependencies.archiveStore,
        cmuxExecutable: dependencies.cmuxExecutable,
        afterControl: async (agentIds) => {
          await markIssuesForAgents(agentIds ?? []);
          await dependencies.state.refresh({ cmux: true });
        },
      });
      await recordBroadcastAction(await actionLogStore, await body, response);
      return response;
    }
    if (url.pathname === "/api/program-aliases") {
      if (!dependencies.programAliasStore) return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
      return handleProgramAliasRequest(request, dependencies.state.get(), dependencies.programAliasStore);
    }
    if (url.pathname === "/api/settings") {
      if (!dependencies.settingsStore) return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
      return handleSettingsRequest(request, dependencies.settingsStore, {
        afterUpdate: async () => {
          await dependencies.state.refresh({ cmux: true });
        },
      });
    }
    if (url.pathname === "/api/collector-instances") {
      if (!dependencies.collectorInstances) {
        return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
      }
      return handleCollectorInstancesRequest(request, dependencies.collectorInstances, {
        afterUpdate: async () => { await dependencies.state.refresh({ cmux: true }); },
      });
    }
    /* TINT-F routes — repo-identity colour. GET is the board's read (and the
       pass that assigns a colour to any repository it has not seen yet); PUT
       and DELETE are the operator's own colour for one repository. Both
       mutating verbs are same-origin loopback, like every other mutating route
       here, and the handler enforces it a second time. */
    if (url.pathname === "/api/repo-colors" || url.pathname.startsWith("/api/repo-colors/")) {
      return handleRepoColorsRequest(request, await repoColorsStore, {
        discover: () => discoverRepoColors(dependencies.state.get()),
        fanOut: dependencies.repoColorFanOut ?? fanOutRepoColors,
      });
    }
    /* end TINT-F routes */
    if (url.pathname.startsWith("/api/usage/")) {
      return handleUsageRequest(request);
    }
    if (["/api/triage/generate", "/api/triage/queue", "/api/triage/run"].includes(url.pathname)) {
      const triageBody = request.method === "POST" ? request.clone() : undefined;
      const response = await handleTriageRequest(request, dependencies.state.get(), triageStore, dependencies.triageRunner);
      if (
        response.ok &&
        (url.pathname === "/api/triage/queue" || url.pathname === "/api/triage/run") &&
        (request.method === "POST" || request.method === "DELETE")
      ) {
        let issueId: string | undefined;
        if (request.method === "DELETE") {
          issueId = url.searchParams.get("issueId") ?? undefined;
        } else {
          try {
            const body = await triageBody?.json() as { issueId?: unknown };
            if (typeof body.issueId === "string") issueId = body.issueId;
          } catch {
            // The triage handler already returned the authoritative parse error.
          }
        }
        const item = issueId ? triageStore.get(issueId) : undefined;
        if (item) await refreshForTriage(item);
        else await dependencies.state.refresh({ cmux: true });
      }
      return response;
    }
    /* SYNC routes — docs/superpowers/plans/2026-08-13-sync, shapes frozen in
       00-MASTER-PLAN.md §Contract. Every route here is same-origin-loopback
       gated like its siblings above, and every cmux mutation behind them goes
       through src/server/cmux-actions.ts (the funnel), never a direct shell.
         SYNC-CB: POST /api/sync/close
         SYNC-NB: POST /api/sync/notifications · PUT/DELETE /api/sync/ack/:agentId
         SYNC-RB: POST /api/sync/rename */
    if (url.pathname === "/api/sync/rename") {
      if (request.method !== "POST") {
        return responseError(405, "METHOD_NOT_ALLOWED", "Use POST for workspace rename.");
      }
      if (!sameOriginLoopback(request)) {
        return responseError(
          403,
          "ORIGIN_REJECTED",
          "Workspace rename requires an exact same-origin loopback Origin header.",
        );
      }
      const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== "application/json") {
        return responseError(415, "CONTENT_TYPE_REJECTED", "Workspace rename requires application/json.");
      }
      const body = await jsonRecord(request);
      if (
        !body
        || Object.keys(body).some((key) => key !== "workspaceId" && key !== "title")
        || typeof body.workspaceId !== "string"
        || !body.workspaceId.trim()
        || body.workspaceId.length > 300
        || typeof body.title !== "string"
      ) {
        return responseError(
          400,
          "INVALID_RENAME_REQUEST",
          "Body must contain only a non-empty workspaceId and a string title.",
        );
      }

      const workspaceId = body.workspaceId.trim();
      const title = body.title.trim();
      const currentTitle = dependencies.state.get().programs
        .flatMap((program) => program.agents)
        .find((agent) => agent.target.workspaceId === workspaceId)
        ?.target.workspaceTitle
        ?? dependencies.state.surfaces?.()
          .find((surface) => surface.workspaceId === workspaceId)
          ?.workspaceTitle;
      const result = title && currentTitle?.trim() === title
        ? { ok: true }
        : await renameWorkspace(workspaceId, body.title, "board rename");
      const status = result.ok
        ? 200
        : result.code === "not_found"
          ? 404
          : result.code === "invalid_title" || result.code === "invalid_workspace"
            ? 400
            : result.code === "unavailable" || result.code === "timeout"
              ? 503
              : result.code === "cmux_error" || result.code === "invalid_response"
                ? 502
                : 409;
      return Response.json(result, {
        status,
        headers: { ...SECURITY_HEADERS, "cache-control": "no-store" },
      });
    }
    if (url.pathname === "/api/sync/notifications") {
      if (request.method !== "POST") {
        return responseError(405, "METHOD_NOT_ALLOWED", "Use POST for cmux notification changes.");
      }
      if (!sameOriginLoopback(request)) {
        return responseError(403, "ORIGIN_REJECTED", "Notification changes require an exact same-origin loopback Origin header.");
      }
      if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
        return responseError(415, "CONTENT_TYPE_REJECTED", "Notification changes require application/json.");
      }
      const body = await jsonRecord(request);
      const keys = body ? Object.keys(body) : [];
      const action = body?.action;
      const id = body?.id;
      if (
        keys.length !== 2
        || !keys.includes("action")
        || !keys.includes("id")
        || (action !== "mark_read" && action !== "dismiss")
        || typeof id !== "string"
        || !id.trim()
        || id.length > 300
      ) {
        return responseError(
          400,
          "INVALID_NOTIFICATION_REQUEST",
          "Body must contain exactly action (mark_read or dismiss) and a non-empty notification id.",
        );
      }
      const result = action === "mark_read"
        ? await markNotificationRead(id)
        : await dismissNotification(id);
      return Response.json(result, {
        status: result.ok ? 200 : result.code === "invalid_state" ? 409 : 502,
        headers: { ...SECURITY_HEADERS, "cache-control": "no-store" },
      });
    }
    if (url.pathname.startsWith("/api/sync/ack/")) {
      if (request.method !== "PUT" && request.method !== "DELETE") {
        return responseError(405, "METHOD_NOT_ALLOWED", "Use PUT to Ack or DELETE to unack an agent alert.");
      }
      if (!sameOriginLoopback(request)) {
        return responseError(403, "ORIGIN_REJECTED", "Ack changes require an exact same-origin loopback Origin header.");
      }
      const encodedAgentId = url.pathname.slice("/api/sync/ack/".length);
      let agentId: string;
      try {
        agentId = decodeURIComponent(encodedAgentId);
      } catch {
        return responseError(400, "INVALID_AGENT_ID", "The Ack route contains an invalid encoded agent id.");
      }
      if (!agentId || agentId.length > 300 || agentId.includes("/")) {
        return responseError(400, "INVALID_AGENT_ID", "Ack requires one non-empty agent id no longer than 300 characters.");
      }
      try {
        if (request.method === "PUT") {
          const agent = dependencies.state.get().programs
            .flatMap((program) => program.agents)
            .find((candidate) => candidate.id === agentId);
          if (!agent) return responseError(404, "AGENT_NOT_FOUND", "The agent is not present in the current snapshot.");
          const alertFingerprint = alertFingerprintFor(agent);
          if (!alertFingerprint) {
            return responseError(409, "AGENT_NOT_ALERTING", "Only an agent with a current alert can be acknowledged.");
          }
          const ack = await ackStore.put(agentId, alertFingerprint);
          try {
            await dependencies.state.refresh();
          } catch (error) {
            return responseError(
              500,
              "ACK_REFRESH_FAILED",
              `Ack was persisted, but the snapshot refresh failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          return Response.json(
            { ok: true, ack },
            { headers: { ...SECURITY_HEADERS, "cache-control": "no-store" } },
          );
        }
        await ackStore.delete(agentId);
        try {
          await dependencies.state.refresh();
        } catch (error) {
          return responseError(
            500,
            "ACK_REFRESH_FAILED",
            `Ack was removed, but the snapshot refresh failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        return Response.json(
          { ok: true, agentId },
          { headers: { ...SECURITY_HEADERS, "cache-control": "no-store" } },
        );
      } catch (error) {
        return responseError(
          500,
          "ACK_WRITE_FAILED",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    if (url.pathname === "/api/sync/close") {
      if (request.method !== "POST") {
        return responseError(405, "METHOD_NOT_ALLOWED", "Use POST for sync close requests.");
      }
      if (!sameOriginLoopback(request)) {
        return responseError(403, "ORIGIN_REJECTED", "Sync close requests require an exact same-origin loopback Origin header.");
      }
      if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
        return responseError(415, "CONTENT_TYPE_REJECTED", "Sync close requests require application/json.");
      }
      const body = await jsonRecord(request);
      const keys = body ? Object.keys(body) : [];
      if (
        !body ||
        (body.target !== "surface" && body.target !== "workspace") ||
        typeof body.id !== "string" ||
        !body.id.trim() ||
        body.id.length > 300 ||
        (body.confirm !== undefined && typeof body.confirm !== "boolean") ||
        keys.some((key) => !["target", "id", "confirm"].includes(key))
      ) {
        return responseError(
          400,
          "INVALID_SYNC_CLOSE_REQUEST",
          "Body must contain target surface or workspace and a non-empty id; confirm is the only optional field.",
        );
      }

      const target = body.target as "surface" | "workspace";
      const id = body.id;
      const agents = dependencies.state.get().programs.flatMap((program) => program.agents);
      const liveAgents = agents.filter((agent) =>
        agent.activity !== "ended" && agent.lifecycle !== "finished" && agent.status !== "archived"
      );
      const nameOf = (agent: AgentSnapshot): string => agent.identity?.name ?? agent.displayName;
      const escalation = (
        workspaceId: string,
        excludeSurfaceId?: string,
      ): { workspaceId: string; siblingAgents: { id: string; name: string }[] } => ({
        workspaceId,
        siblingAgents: liveAgents.flatMap((agent) =>
          agent.target.resolution === "exact" &&
          agent.target.workspaceId === workspaceId &&
          agent.target.surfaceId !== excludeSurfaceId
            ? [{ id: agent.id, name: nameOf(agent) }]
            : []
        ),
      });
      const syncResponse = (value: object, status = 200): Response => Response.json(
        value,
        { status, headers: { ...SECURITY_HEADERS, "cache-control": "no-store" } },
      );

      configureCmuxActions({
        runner: dependencies.runner,
        executable: dependencies.cmuxExecutable ?? DEFAULT_CMUX_EXECUTABLE,
      });

      if (target === "surface") {
        const agent = liveAgents.find((candidate) =>
          candidate.target.resolution === "exact" && candidate.target.surfaceId === id
        );
        const workspaceId = agent?.target.workspaceId;
        if (!workspaceId) {
          return syncResponse({
            ok: false,
            code: "target_not_found",
            detail: "No live agent has an exact snapshot binding to this surface.",
          }, 409);
        }
        const result = await closeSurface(id, "board close");
        if (!result.ok && result.code === "invalid_state") {
          return syncResponse({
            ...result,
            escalation: escalation(workspaceId, id),
          }, 409);
        }
        return syncResponse(result, result.ok ? 200 : 502);
      }

      /* Group anchors are materialized as workspaces, so an arbitrary id from
         curl can name one even though no agent row ever binds to it. Group
         lists are window-scoped: enumerate every window and pass window_id,
         then refuse before the mutation funnel if any group owns this id. */
      const executable = dependencies.cmuxExecutable ?? DEFAULT_CMUX_EXECUTABLE;
      const readList = async (
        method: "window.list" | "workspace.group.list",
        params: Record<string, unknown>,
        collection: "windows" | "groups",
      ): Promise<{ values?: Record<string, unknown>[]; failure?: string }> => {
        const result = await dependencies.runner.run(
          cmuxCommand(executable, ["rpc", method, JSON.stringify(params)]),
          10_000,
        );
        if (result.timedOut) return { failure: `${method} timed out` };
        if (result.exitCode !== 0 || result.stderr.trim()) {
          return {
            failure: `${method} exited ${result.exitCode}: ${result.stderr.trim() || result.stdout.trim() || "no detail"}`,
          };
        }
        try {
          const parsed = JSON.parse(result.stdout) as unknown;
          const root = parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : undefined;
          const nested = root?.result && typeof root.result === "object" && !Array.isArray(root.result)
            ? root.result as Record<string, unknown>
            : root;
          const values = nested?.[collection];
          return Array.isArray(values)
            ? { values: values.filter(
                (value): value is Record<string, unknown> =>
                  value !== null && typeof value === "object" && !Array.isArray(value),
              ) }
            : { failure: `${method} response did not contain ${collection}` };
        } catch (error) {
          return { failure: `${method} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}` };
        }
      };

      const windows = await readList("window.list", {}, "windows");
      if (windows.failure) {
        return syncResponse({ ok: false, code: "anchor_check_failed", detail: windows.failure }, 503);
      }
      const anchorWorkspaceIds = new Set<string>();
      for (const window of windows.values ?? []) {
        const windowId = [window.id, window.window_id].find(
          (value): value is string => typeof value === "string" && value.length > 0,
        );
        if (!windowId) continue;
        const groups = await readList(
          "workspace.group.list",
          { window_id: windowId },
          "groups",
        );
        if (groups.failure) {
          return syncResponse({ ok: false, code: "anchor_check_failed", detail: groups.failure }, 503);
        }
        for (const group of groups.values ?? []) {
          const anchor = group.anchor_workspace_id ?? group.anchorWorkspaceId;
          if (typeof anchor === "string" && anchor.length > 0) anchorWorkspaceIds.add(anchor);
        }
      }
      if (anchorWorkspaceIds.has(id)) {
        return syncResponse({
          ok: false,
          code: "anchor",
          detail: "Group-anchor workspaces cannot be closed by sync.",
        }, 409);
      }

      const workspaceAgents = liveAgents.filter((agent) =>
        agent.target.resolution === "exact" && agent.target.workspaceId === id
      );
      if (workspaceAgents.length === 0) {
        return syncResponse({
          ok: false,
          code: "target_not_found",
          detail: "No live agent has an exact snapshot binding to this workspace.",
        }, 409);
      }
      const workspaceEscalation = escalation(id);
      if (body.confirm !== true) {
        return syncResponse({
          ok: false,
          code: "confirm_required",
          escalation: workspaceEscalation,
        }, 409);
      }
      const result = await closeWorkspace(id, "confirmed board close");
      return syncResponse(result, result.ok ? 200 : 502);
    }
    if (url.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: SECURITY_HEADERS });
    }
    return serveStatic(url.pathname, dependencies.webRoot, request.method === "HEAD");
  }) as MountainFetch;

  fetch.dispose = (): void => {
    if (disposed) return;
    disposed = true;
    /* Drop only this app's registration. A read-only preview owns none, and a
       stale app cannot clear a newer writer's provider. */
    disposeRepoGroupRegistration?.();
    unsubscribe();
    unsubscribeTriage?.();
    for (const client of [...clients]) {
      dropClient(client);
    }
  };
  return fetch;
}

async function serveStatic(pathname: string, webRoot: string, headOnly: boolean): Promise<Response> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  } catch {
    return new Response("Bad path", { status: 400, headers: SECURITY_HEADERS });
  }
  const root = resolve(webRoot);
  const path = resolve(root, `.${decoded}`);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
  }
  try {
    const details = await stat(path);
    if (!details.isFile()) throw new Error("not a file");
  } catch {
    return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
  }
  return new Response(headOnly ? null : Bun.file(path), {
    headers: {
      ...SECURITY_HEADERS,
      "cache-control": extname(path) === ".html" ? "no-cache" : "public, max-age=60",
      "content-type": CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
    },
  });
}

export function emptySnapshot(): HubSnapshot {
  const now = new Date().toISOString();
  const snapshot: FormicHubSnapshot = {
    schemaVersion: 1,
    generatedAt: now,
    scanWindowHours: DEFAULT_SCAN_WINDOW_HOURS,
    lookbackHours: DEFAULT_SCAN_WINDOW_HOURS,
    controlHealth: { cmuxReachable: false, lastCheckedAt: now, errors: [], staleSources: [] },
    totals: {
      live: 0,
      tracked: 0,
      attention: 0,
      working: 0,
      idle: 0,
      ended: 0,
      needsYou: 0,
      history: 0,
      tokenReporting: 0,
      tokenEligible: 0,
      sourceHealth: {
        healthy: 0,
        // A snapshot that could not be built has read nothing, which is a real
        // fault in every provider — not an absent provider.
        degraded: PROVIDERS.length,
        absent: 0,
        total: PROVIDERS.length,
        byProvider: Object.fromEntries(PROVIDERS.map((provider) => [
          provider,
          { healthy: false, lastHealthyAt: null },
        ])) as Record<Provider, SourceHealth>,
      },
    },
    issues: [],
    recentlyResolved: [],
    triageSummaries: [],
    programs: [],
    spendSources: [],
  };
  return snapshot;
}
