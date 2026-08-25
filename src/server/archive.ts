import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { readableTask } from "./collectors";
import { sessionKindFor } from "./snapshot-agent";
import type { AgentSnapshot } from "../shared/types";
import type { ArchiveStore, CollectedAgent } from "./types";

/* The defaults, not the law. Retention and the record cap are operator settings
   now (`historyRetentionDays`, `historyRecordLimit`), and the store reads them
   through an injected reader so a change takes effect on the next commit
   instead of at the next restart. These stay as the values used when nothing
   injects anything — tests, and any caller that has no settings store. */
export const ARCHIVE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const MAX_ARCHIVE_RECORDS = 5_000;

export interface ArchiveLimits {
  retentionMs: number;
  recordLimit: number;
}

const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  retentionMs: ARCHIVE_RETENTION_MS,
  recordLimit: MAX_ARCHIVE_RECORDS,
};

type ArchiveKind = "operator" | "history";
/* `archivedAt` is when WE stored the record, which is not `updatedAt`, when the
   agent last did anything. Retention was measured from the latter, so archiving
   a session last active 31 days ago pruned it on the very next commit while the
   operator was told ok: true - the request destroyed the thing it was meant to
   preserve. And 0 of 546 records carried an archive time, so it could not even
   be diagnosed afterwards. */
type StoredAgent = CollectedAgent &
  Pick<AgentSnapshot, "sessionKind" | "sessionKindSource"> &
  { archiveKind?: ArchiveKind; archivedAt?: string };

export interface ArchiveFileOperations {
  readText(path: string): Promise<string>;
  makeDirectory(path: string): Promise<void>;
  writeText(path: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

const nodeFileOperations: ArchiveFileOperations = {
  readText: (path) => readFile(path, "utf8"),
  makeDirectory: async (path) => {
    await mkdir(path, { recursive: true });
  },
  writeText: async (path, contents) => {
    await writeFile(path, contents, "utf8");
  },
  rename,
};

export class JsonArchiveStore implements ArchiveStore {
  readonly #agentIds = new Set<string>();
  readonly #agents = new Map<string, StoredAgent>();
  #writeQueue: Promise<void> = Promise.resolve();
  #writeNumber = 0;
  #loadError?: string;

  private constructor(
    private readonly path: string,
    private readonly files: ArchiveFileOperations,
    private readonly now: () => number,
    private readonly limits: () => ArchiveLimits,
  ) {}

  static async open(
    path: string,
    files: ArchiveFileOperations = nodeFileOperations,
    now: () => number = Date.now,
    limits: () => ArchiveLimits = () => DEFAULT_ARCHIVE_LIMITS,
  ): Promise<JsonArchiveStore> {
    const store = new JsonArchiveStore(path, files, now, limits);
    try {
      const parsed = JSON.parse(await files.readText(path));
      if (Array.isArray(parsed)) {
        for (const value of parsed) {
          if (typeof value === "string") {
            store.#agentIds.add(value);
          } else if (isCollectedAgent(value)) {
            const stored = value as StoredAgent;
            if (stored.archiveKind && stored.archiveKind !== "operator" && stored.archiveKind !== "history") {
              throw new Error("archive file contains an invalid archive kind");
            }
            if (!isFresh(value, now(), limits().retentionMs)) continue;
            if (stored.archiveKind !== "history") store.#agentIds.add(value.id);
            store.#agents.set(value.id, stored);
          } else {
            throw new Error("archive file contains an invalid agent record");
          }
        }
      } else {
        throw new Error("archive file must contain an array");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        store.#agentIds.clear();
        store.#agents.clear();
        /* An archive we could not read is not an empty archive. Clearing it
           silently puts every previously dismissed agent back on the board as
           live work, so the operator sees more running than exists and no
           reason for it — a wrong number stated confidently, with the console
           as the only record. Boot on empty, but say so out loud. */
        store.#loadError = `archived agents could not be read from ${path}, so the board is showing every session as unarchived: `
          + (error instanceof Error ? error.message : String(error));
        console.error(`[JsonArchiveStore] ${store.#loadError}`);
      }
    }
    return store;
  }

  /* Undefined when the archive on disk is the one in force, or when there was
     never a file. Set only when an empty archive is standing in for one we
     failed to read. */
  loadError(): string | undefined {
    return this.#loadError;
  }

  has(agentId: string): boolean {
    return this.#agentIds.has(agentId);
  }

  archivedAgents(): readonly CollectedAgent[] {
    return [...this.#agents.values()].map(publicCopy);
  }

  archive(agentId: string, agent?: CollectedAgent): Promise<void> {
    return this.#enqueue(() => this.#persistArchive(agentId, agent));
  }

  record(agents: readonly CollectedAgent[]): Promise<void> {
    return this.#enqueue(() => this.#persistHistory(agents));
  }

  /* Undo an operator archive without losing the record.

     The id leaves `#agentIds`, which is what "this board archived it" means, and
     the record is DEMOTED to history rather than deleted — an operator undoing a
     filing decision is not asking to destroy what the session did, and a
     destructive undo is a worse failure than the one it repairs. Idempotent:
     un-archiving something that was never archived is a no-op, not an error. */
  unarchive(agentId: string): Promise<void> {
    return this.#enqueue(() => this.#persistUnarchive(agentId));
  }

  async #persistUnarchive(agentId: string): Promise<void> {
    const existing = this.#agents.get(agentId);
    if (!this.#agentIds.has(agentId) && existing?.archiveKind !== "operator") return;
    const nextAgentIds = new Set(this.#agentIds);
    nextAgentIds.delete(agentId);
    const nextAgents = new Map(this.#agents);
    if (existing) nextAgents.set(agentId, { ...existing, archiveKind: "history" });
    await this.#commit(nextAgentIds, nextAgents);
  }

  #enqueue(operation: () => Promise<void>): Promise<void> {
    const write = this.#writeQueue.then(operation);
    // A failed write rejects its caller but does not poison later queued writes.
    this.#writeQueue = write.catch(() => {});
    return write;
  }

  async #persistArchive(agentId: string, agent?: CollectedAgent): Promise<void> {
    const existing = this.#agents.get(agentId);
    // Custody began when the record was FIRST stored; a re-archive is not a new one.
    const archivedAgent = agent
      ? archiveCopy(agent, "operator", this.now(), existing?.archivedAt)
      : undefined;
    if (
      this.#agentIds.has(agentId) &&
      (!archivedAgent || (existing?.archiveKind === "operator" && sameAgent(existing, archivedAgent)))
    ) return;
    const nextAgentIds = new Set(this.#agentIds).add(agentId);
    const nextAgents = new Map(this.#agents);
    if (archivedAgent) nextAgents.set(agentId, archivedAgent);
    else if (existing) nextAgents.set(agentId, archiveCopy(existing, "operator", this.now(), existing.archivedAt));
    await this.#commit(nextAgentIds, nextAgents);
  }

  async #persistHistory(agents: readonly CollectedAgent[]): Promise<void> {
    const nextAgentIds = new Set(this.#agentIds);
    const nextAgents = new Map(this.#agents);
    let changed = false;
    for (const agent of agents) {
      const existing = nextAgents.get(agent.id);
      const copy = archiveCopy(
        agent,
        nextAgentIds.has(agent.id) ? "operator" : "history",
        this.now(),
        existing?.archivedAt,
      );
      if (existing && sameAgent(existing, copy)) continue;
      nextAgents.set(agent.id, copy);
      changed = true;
    }
    const { retentionMs, recordLimit } = this.limits();
    const needsPrune = nextAgents.size + [...nextAgentIds].filter((id) => !nextAgents.has(id)).length >
      recordLimit || [...nextAgents.values()].some((agent) => !isFresh(agent, this.now(), retentionMs));
    if (!changed && !needsPrune) return;
    await this.#commit(nextAgentIds, nextAgents);
  }

  async #commit(agentIds: Set<string>, agents: Map<string, StoredAgent>): Promise<void> {
    const { retentionMs, recordLimit } = this.limits();
    const retainedAgents = [...agents.values()]
      .filter((agent) => isFresh(agent, this.now(), retentionMs))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      .slice(0, recordLimit);
    const retainedAgentIds = new Set(
      retainedAgents
        .filter((agent) => agent.archiveKind !== "history")
        .map((agent) => agent.id),
    );
    const remaining = recordLimit - retainedAgents.length;
    const plainIds = [...agentIds]
      .filter((id) => !agents.has(id))
      .sort()
      .slice(0, remaining);
    for (const id of plainIds) retainedAgentIds.add(id);
    const persisted: Array<string | StoredAgent> = [...retainedAgents, ...plainIds];
    await this.files.makeDirectory(dirname(this.path));
    this.#writeNumber += 1;
    const temporaryPath = `${this.path}.${process.pid}.${this.#writeNumber}.tmp`;
    await this.files.writeText(temporaryPath, `${JSON.stringify(persisted, null, 2)}\n`);
    await this.files.rename(temporaryPath, this.path);
    // The in-memory state becomes visible only after the atomic rename commits.
    this.#agentIds.clear();
    for (const id of retainedAgentIds) this.#agentIds.add(id);
    this.#agents.clear();
    for (const value of retainedAgents) this.#agents.set(value.id, value);
  }
}

export class MemoryArchiveStore implements ArchiveStore {
  readonly #agentIds = new Set<string>();
  readonly #agents = new Map<string, StoredAgent>();

  has(agentId: string): boolean {
    return this.#agentIds.has(agentId);
  }

  archivedAgents(): readonly CollectedAgent[] {
    return [...this.#agents.values()].map(publicCopy);
  }

  async archive(agentId: string, agent?: CollectedAgent): Promise<void> {
    this.#agentIds.add(agentId);
    if (agent) this.#agents.set(agentId, archiveCopy(agent, "operator", Date.now(), this.#agents.get(agentId)?.archivedAt));
  }

  async unarchive(agentId: string): Promise<void> {
    this.#agentIds.delete(agentId);
    const existing = this.#agents.get(agentId);
    if (existing) this.#agents.set(agentId, { ...existing, archiveKind: "history" });
  }

  async record(agents: readonly CollectedAgent[]): Promise<void> {
    for (const agent of agents) {
      this.#agents.set(
        agent.id,
        archiveCopy(agent, this.#agentIds.has(agent.id) ? "operator" : "history", Date.now(), this.#agents.get(agent.id)?.archivedAt),
      );
    }
  }
}

function archiveCopy(
  agent: CollectedAgent,
  archiveKind: ArchiveKind,
  nowMs: number,
  existingArchivedAt?: string,
): StoredAgent {
  const published = agent as CollectedAgent & Pick<AgentSnapshot, "sessionKind" | "sessionKindSource">;
  const kind = published.sessionKind && published.sessionKindSource
    ? { sessionKind: published.sessionKind, sessionKindSource: published.sessionKindSource }
    : sessionKindFor({ launch: agent.launch, task: agent.task });
  return {
    id: agent.id,
    provider: agent.provider,
    sourceSessionId: agent.sourceSessionId,
    sourceTitle: agent.sourceTitle,
    rawModel: agent.rawModel,
    displayName: agent.displayName,
    /* Written down for the same reason the lifecycle verdict below is: this is
       an allow-list, and a record that has left the scan window can never be
       re-derived. The transcript that held its first working directory may be
       gone, so an identity dropped here is not recoverable — History would fall
       back to naming a thirty-day-old record after whatever `displayName`
       happened to be when it was filed. */
    identity: agent.identity,
    cwd: agent.cwd,
    launchCwd: agent.launchCwd,
    originCwd: agent.originCwd,
    instanceId: agent.instanceId,
    instanceLabel: agent.instanceLabel,
    model: agent.model,
    effort: agent.effort,
    task: agent.task,
    sessionKind: kind.sessionKind,
    sessionKindSource: kind.sessionKindSource,
    status: "archived",
    statusReason: archiveKind === "operator" ? "Archived by operator." : "Retained session history.",
    startedAt: agent.startedAt,
    updatedAt: agent.updatedAt,
    tokens: { ...agent.tokens },
    cost: agent.cost ? { ...agent.cost } : agent.cost,
    subagentCount: agent.subagentCount,
    parentSourceSessionId: agent.parentSourceSessionId,
    threadDepth: agent.threadDepth,
    nickname: agent.nickname,
    lastHumanMessage: agent.lastHumanMessage,
    lastHumanFacingAt: agent.lastHumanFacingAt,
    lastThreadAt: agent.lastThreadAt,
    workingSince: agent.workingSince,
    lastUserMessage: agent.lastUserMessage,
    lastAgentMessage: agent.lastAgentMessage,
    lastUserChatBody: agent.lastUserChatBody,
    lastAgentChatBody: agent.lastAgentChatBody,
    /* Measured on the live board after the restart: 362 agents, 269 of them
       unreadable by the attention layer, and 133 of those were archived records
       carrying lastAgentMessage but not this. An archived session that ended by
       asking a question is exactly the one an operator can still act on, so
       dropping the closing line here made the whole history permanently blind —
       and the layer reported that blindness as "we could not read", correctly
       but avoidably. */
    lastAgentClosing: agent.lastAgentClosing,
    transcriptTail: agent.transcriptTail,
    artifacts: agent.artifacts.map((artifact) => ({ ...artifact })),
    gates: [...agent.gates],
    allowCwdFallback: agent.allowCwdFallback,
    recordedTarget: agent.recordedTarget ? { ...agent.recordedTarget } : undefined,
    /* The verdict and the evidence behind it, written down BECAUSE the evidence
       itself is not. Everything above is an allow-list that deliberately drops
       processAlive/processIds — a record out of the scan window has no process
       to check and never will — so without these three fields a re-entering
       record would be reclassified from nothing at all. */
    endEvidence: agent.endEvidence,
    lifecycle: agent.lifecycle,
    provenance: agent.provenance,
    archiveKind,
    /* Set once, on first archive, and carried forward on every later rewrite.
       Re-stamping it would restart the retention clock each time a record was
       touched, so nothing would ever expire; and because sameAgent compares
       whole records, a fresh timestamp on every pass would also rewrite the
       file continuously. */
    archivedAt: existingArchivedAt ?? new Date(nowMs).toISOString(),
  };
}

/* `archiveKind` stays off the wire. It is custody bookkeeping, and the fact it
   used to be the only carrier of — "a human filed this" versus "this is simply
   the record we kept" — now ships explicitly as `provenance`, declared, with
   the operator-archive case still readable through `has(id)`. */
function publicCopy(agent: StoredAgent): CollectedAgent {
  const { archiveKind: _, ...copy } = agent;
  /* Read, not write: the stored record keeps whatever was true when it was
     written, and this is the one door every archived agent leaves by. A record
     from July still holds a task the collector would no longer produce. */
  return { ...copy, task: readableTask(copy.task) };
}

function sameAgent(left: StoredAgent, right: StoredAgent): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/* Retention runs from when we took custody, not from when the agent last spoke.
   Records written before archivedAt existed have none; they fall back to
   updatedAt, which is the old behaviour and the only honest option - inventing
   an archive time for them would be fabricating the very evidence this adds. */
function isFresh(agent: StoredAgent, nowMs: number, retentionMs = ARCHIVE_RETENTION_MS): boolean {
  const retentionStart = Date.parse(agent.archivedAt ?? agent.updatedAt);
  return Number.isFinite(retentionStart) && nowMs - retentionStart <= retentionMs;
}

function isCollectedAgent(value: unknown): value is CollectedAgent {
  if (!value || typeof value !== "object") return false;
  const agent = value as Partial<CollectedAgent>;
  return Boolean(
    typeof agent.id === "string" &&
      typeof agent.provider === "string" &&
      typeof agent.sourceSessionId === "string" &&
      typeof agent.displayName === "string" &&
      typeof agent.status === "string" &&
      typeof agent.statusReason === "string" &&
      typeof agent.updatedAt === "string" &&
      agent.tokens &&
      typeof agent.tokens === "object" &&
      Array.isArray(agent.artifacts) &&
      Array.isArray(agent.gates)
  );
}
