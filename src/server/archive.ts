import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ArchiveStore, CollectedAgent } from "./types";

export const ARCHIVE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
export const MAX_ARCHIVE_RECORDS = 5_000;

type ArchiveKind = "operator" | "history";
type StoredAgent = CollectedAgent & { archiveKind?: ArchiveKind };

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

  private constructor(
    private readonly path: string,
    private readonly files: ArchiveFileOperations,
    private readonly now: () => number,
  ) {}

  static async open(
    path: string,
    files: ArchiveFileOperations = nodeFileOperations,
    now: () => number = Date.now,
  ): Promise<JsonArchiveStore> {
    const store = new JsonArchiveStore(path, files, now);
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
            if (!isFresh(value, now())) continue;
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
        console.error(
          `[JsonArchiveStore] Ignoring unreadable archive at ${path}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return store;
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

  #enqueue(operation: () => Promise<void>): Promise<void> {
    const write = this.#writeQueue.then(operation);
    // A failed write rejects its caller but does not poison later queued writes.
    this.#writeQueue = write.catch(() => {});
    return write;
  }

  async #persistArchive(agentId: string, agent?: CollectedAgent): Promise<void> {
    const archivedAgent = agent ? archiveCopy(agent, "operator") : undefined;
    const existing = this.#agents.get(agentId);
    if (
      this.#agentIds.has(agentId) &&
      (!archivedAgent || (existing?.archiveKind === "operator" && sameAgent(existing, archivedAgent)))
    ) return;
    const nextAgentIds = new Set(this.#agentIds).add(agentId);
    const nextAgents = new Map(this.#agents);
    if (archivedAgent) nextAgents.set(agentId, archivedAgent);
    else if (existing) nextAgents.set(agentId, archiveCopy(existing, "operator"));
    await this.#commit(nextAgentIds, nextAgents);
  }

  async #persistHistory(agents: readonly CollectedAgent[]): Promise<void> {
    const nextAgentIds = new Set(this.#agentIds);
    const nextAgents = new Map(this.#agents);
    let changed = false;
    for (const agent of agents) {
      const copy = archiveCopy(agent, nextAgentIds.has(agent.id) ? "operator" : "history");
      const existing = nextAgents.get(agent.id);
      if (existing && sameAgent(existing, copy)) continue;
      nextAgents.set(agent.id, copy);
      changed = true;
    }
    const needsPrune = nextAgents.size + [...nextAgentIds].filter((id) => !nextAgents.has(id)).length >
      MAX_ARCHIVE_RECORDS || [...nextAgents.values()].some((agent) => !isFresh(agent, this.now()));
    if (!changed && !needsPrune) return;
    await this.#commit(nextAgentIds, nextAgents);
  }

  async #commit(agentIds: Set<string>, agents: Map<string, StoredAgent>): Promise<void> {
    const retainedAgents = [...agents.values()]
      .filter((agent) => isFresh(agent, this.now()))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      .slice(0, MAX_ARCHIVE_RECORDS);
    const retainedAgentIds = new Set(
      retainedAgents
        .filter((agent) => agent.archiveKind !== "history")
        .map((agent) => agent.id),
    );
    const remaining = MAX_ARCHIVE_RECORDS - retainedAgents.length;
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
    if (agent) this.#agents.set(agentId, archiveCopy(agent, "operator"));
  }

  async record(agents: readonly CollectedAgent[]): Promise<void> {
    for (const agent of agents) {
      this.#agents.set(agent.id, archiveCopy(agent, this.#agentIds.has(agent.id) ? "operator" : "history"));
    }
  }
}

function archiveCopy(agent: CollectedAgent, archiveKind: ArchiveKind): StoredAgent {
  return {
    id: agent.id,
    provider: agent.provider,
    sourceSessionId: agent.sourceSessionId,
    displayName: agent.displayName,
    cwd: agent.cwd,
    model: agent.model,
    effort: agent.effort,
    task: agent.task,
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
    lastUserMessage: agent.lastUserMessage,
    lastAgentMessage: agent.lastAgentMessage,
    transcriptTail: agent.transcriptTail,
    artifacts: agent.artifacts.map((artifact) => ({ ...artifact })),
    gates: [...agent.gates],
    allowCwdFallback: agent.allowCwdFallback,
    recordedTarget: agent.recordedTarget ? { ...agent.recordedTarget } : undefined,
    archiveKind,
  };
}

function publicCopy(agent: StoredAgent): CollectedAgent {
  const { archiveKind: _, ...copy } = agent;
  return copy;
}

function sameAgent(left: StoredAgent, right: StoredAgent): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isFresh(agent: CollectedAgent, nowMs: number): boolean {
  const updatedAtMs = Date.parse(agent.updatedAt);
  return Number.isFinite(updatedAtMs) && nowMs - updatedAtMs <= ARCHIVE_RETENTION_MS;
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
