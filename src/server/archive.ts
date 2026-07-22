import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ArchiveStore, CollectedAgent } from "./types";

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
  readonly #agents = new Map<string, CollectedAgent>();
  #writeQueue: Promise<void> = Promise.resolve();
  #writeNumber = 0;

  private constructor(
    private readonly path: string,
    private readonly files: ArchiveFileOperations,
  ) {}

  static async open(
    path: string,
    files: ArchiveFileOperations = nodeFileOperations,
  ): Promise<JsonArchiveStore> {
    const store = new JsonArchiveStore(path, files);
    try {
      const parsed = JSON.parse(await files.readText(path));
      if (Array.isArray(parsed)) {
        for (const value of parsed) {
          if (typeof value === "string") {
            store.#agentIds.add(value);
          } else if (isCollectedAgent(value)) {
            store.#agentIds.add(value.id);
            store.#agents.set(value.id, value);
          } else {
            throw new Error("archive file contains an invalid agent record");
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return store;
  }

  has(agentId: string): boolean {
    return this.#agentIds.has(agentId);
  }

  archivedAgents(): readonly CollectedAgent[] {
    return [...this.#agents.values()];
  }

  archive(agentId: string, agent?: CollectedAgent): Promise<void> {
    const write = this.#writeQueue.then(() => this.#persist(agentId, agent));
    // A failed write rejects its caller but does not poison later queued writes.
    this.#writeQueue = write.catch(() => {});
    return write;
  }

  async #persist(agentId: string, agent?: CollectedAgent): Promise<void> {
    const archivedAgent = agent ? archiveCopy(agent) : undefined;
    if (this.#agentIds.has(agentId) && (!archivedAgent || this.#agents.has(agentId))) return;
    const nextAgentIds = new Set(this.#agentIds).add(agentId);
    const nextAgents = new Map(this.#agents);
    if (archivedAgent) nextAgents.set(agentId, archivedAgent);
    const persisted = [...nextAgentIds]
      .sort()
      .map((id) => nextAgents.get(id) ?? id);
    await this.files.makeDirectory(dirname(this.path));
    this.#writeNumber += 1;
    const temporaryPath = `${this.path}.${process.pid}.${this.#writeNumber}.tmp`;
    await this.files.writeText(temporaryPath, `${JSON.stringify(persisted, null, 2)}\n`);
    await this.files.rename(temporaryPath, this.path);
    // The in-memory state becomes visible only after the atomic rename commits.
    this.#agentIds.add(agentId);
    if (archivedAgent) this.#agents.set(agentId, archivedAgent);
  }
}

export class MemoryArchiveStore implements ArchiveStore {
  readonly #agentIds = new Set<string>();
  readonly #agents = new Map<string, CollectedAgent>();

  has(agentId: string): boolean {
    return this.#agentIds.has(agentId);
  }

  archivedAgents(): readonly CollectedAgent[] {
    return [...this.#agents.values()];
  }

  async archive(agentId: string, agent?: CollectedAgent): Promise<void> {
    this.#agentIds.add(agentId);
    if (agent) this.#agents.set(agentId, archiveCopy(agent));
  }
}

function archiveCopy(agent: CollectedAgent): CollectedAgent {
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
    statusReason: "Archived by operator.",
    startedAt: agent.startedAt,
    updatedAt: agent.updatedAt,
    tokens: { ...agent.tokens },
    cost: agent.cost ? { ...agent.cost } : agent.cost,
    subagentCount: agent.subagentCount,
    parentSourceSessionId: agent.parentSourceSessionId,
    threadDepth: agent.threadDepth,
    nickname: agent.nickname,
    lastHumanMessage: agent.lastHumanMessage,
    transcriptTail: agent.transcriptTail,
    artifacts: agent.artifacts.map((artifact) => ({ ...artifact })),
    gates: [...agent.gates],
    recordedTarget: agent.recordedTarget ? { ...agent.recordedTarget } : undefined,
  };
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
