import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import type { AgentSnapshot, HubSnapshot, ProgramSnapshot, TriageQueueItem } from "../shared/types";
import { ARCHIVE_RETENTION_MS, MAX_ARCHIVE_RECORDS } from "./archive";
import { handleBroadcastRequest } from "./broadcast";
import { handleUsageRequest } from "./burnbar";
import {
  defaultAttentionStore,
  MemoryAttentionStore,
  type AttentionAction,
  type AttentionStore,
} from "./cmux";
import { identityDebugResponse, transcriptResponse } from "./debug-identity";
import { handleControlRequest } from "./http";
import { handleProgramAliasRequest, type ProgramAliasStore } from "./program-aliases";
import { handleSettingsRequest, type JsonSettingsStore } from "./settings";
import { snapshotFingerprint } from "./snapshot";
import { handleTriageRequest, MemoryTriageQueueStore, type TriageInvestigationRunner, type TriageQueueStore } from "./triage";
import type { ArchiveStore, CmuxSurface, CommandRunner } from "./types";

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
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ts": "text/javascript; charset=utf-8",
};

const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

export const MAX_SSE_CLIENTS = 16;
export const MAX_SSE_BACKLOG_BYTES = 2 * 1024 * 1024;
export const MAX_HEALTH_SNAPSHOT_AGE_MS = 60_000;
export const ACTION_LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const MAX_ACTION_LOG_ENTRIES = 500;

export type OperatorActionKind = "focus" | "instruct" | "interrupt" | "broadcast" | "archive";
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

  private async commit(actions: readonly OperatorAction[]): Promise<void> {
    const retained = retainActions(actions, this.now());
    await this.persist(retained);
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
    ["focus", "instruct", "interrupt", "broadcast", "archive"].includes(String(action.kind)) &&
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
  triageStore?: TriageQueueStore;
  triageRunner?: TriageInvestigationRunner;
  programAliasStore?: ProgramAliasStore;
  settingsStore?: JsonSettingsStore;
  cmuxExecutable?: string;
  now?: () => number;
  webRoot: string;
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
    !["focus", "instruct", "interrupt", "archive"].includes(String(kind)) ||
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
  const triageStore = dependencies.triageStore ?? new MemoryTriageQueueStore();
  const actionLogStore = dependencies.actionLogStore
    ? Promise.resolve(dependencies.actionLogStore)
    : defaultActionLogStore(dependencies.webRoot);
  const attentionStore = dependencies.attentionStore
    ? Promise.resolve(dependencies.attentionStore)
    : resolve(dependencies.webRoot) === resolve(import.meta.dir, "../web")
      ? defaultAttentionStore()
      : Promise.resolve(new MemoryAttentionStore());
  let recollectInFlight: Promise<HubSnapshot> | undefined;
  const recollect = (): Promise<HubSnapshot> => {
    if (!recollectInFlight) {
      recollectInFlight = dependencies.state.refresh({ cmux: true }).finally(() => {
        recollectInFlight = undefined;
      });
    }
    return recollectInFlight;
  };
  const clients = new Set<ReadableStreamDefaultController<string>>();
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
  let disposed = false;
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

  const fetch = (async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (!isLoopback(url.hostname)) {
      if (url.pathname === "/api/transcript" || url.pathname === "/api/actions") {
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
    if (url.pathname === "/api/actions") {
      if (request.method !== "GET") return responseError(405, "METHOD_NOT_ALLOWED", "Use GET for action-log reads.");
      const limit = limitFrom(url, 100, 500);
      if (limit instanceof Response) return limit;
      return Response.json(
        { ok: true, actions: (await actionLogStore).list(limit) },
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
          retentionDays: ARCHIVE_RETENTION_MS / (24 * 60 * 60 * 1_000),
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
      if (
        !agent.target.surfaceId ||
        !["exact", "unique-cwd"].includes(agent.target.resolution)
      ) {
        return responseError(409, "UNSAFE_TARGET", "The agent has no safely resolved cmux surface.");
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
      return Response.json(
        {
          ok: healthy,
          verdict: healthy ? "healthy" : "stale",
          snapshot: {
            generatedAt: snapshot.generatedAt,
            ageMs,
            maxAgeMs: MAX_HEALTH_SNAPSHOT_AGE_MS,
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
            }, 25_000),
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
  return {
    schemaVersion: 1,
    generatedAt: now,
    scanWindowHours: 36,
    lookbackHours: 36,
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
        degraded: 4,
        total: 4,
        byProvider: {
          omp: { healthy: false, lastHealthyAt: null },
          codex: { healthy: false, lastHealthyAt: null },
          claude: { healthy: false, lastHealthyAt: null },
          cursor: { healthy: false, lastHealthyAt: null },
        },
      },
    },
    issues: [],
    recentlyResolved: [],
    triageSummaries: [],
    programs: [],
  };
}
