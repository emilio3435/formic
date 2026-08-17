import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentAck, AgentSnapshot } from "../shared/types";
import { fnvKey } from "./repo-identity";
import { hookInputWantsHuman } from "./task-state";

export interface AckStore {
  list(): readonly AgentAck[];
  get(agentId: string): AgentAck | undefined;
  put(agentId: string, alertFingerprint: string): Promise<AgentAck>;
  delete(agentId: string): Promise<boolean>;
  reconcile(currentAlerts: ReadonlyMap<string, string>): Promise<void>;
  loadError?(): string | undefined;
}

function terminalWithoutLiveContradiction(agent: AgentSnapshot): boolean {
  if (agent.scope === "retained" || agent.lifecycle === "finished") return agent.processState !== "running";
  return agent.activity === "ended" && agent.processState !== "running";
}

/* Evidence, not transcript time, identifies the request the operator saw.
 * `lastHumanFacingAt` advances on an ordinary reply as well as on a new ask;
 * using it here revoked Ack while the same request was still on screen. The
 * evidence is bounded upstream and hashed before persistence so acks.json does
 * not become a second transcript store. */
function alertEvidenceKey(agent: AgentSnapshot): string | undefined {
  const evidence = agent.attentionSignal?.evidence?.trim();
  return evidence ? fnvKey(evidence) : undefined;
}

function withEvidence(prefix: string, agent: AgentSnapshot): string {
  const evidenceKey = alertEvidenceKey(agent);
  return evidenceKey ? `${prefix}:${evidenceKey}` : prefix;
}

/** Semantic alert identity. Conversation, hook-write and snapshot clocks are
 * never fingerprint inputs; a changed request changes its bounded evidence. */
export function alertFingerprintFor(agent: AgentSnapshot): string | undefined {
  if (terminalWithoutLiveContradiction(agent)) return undefined;
  if (hookInputWantsHuman(agent)) {
    return withEvidence(
      `hook:${agent.hookLifecycle}:${agent.attentionSignal?.kind ?? "hook-input"}`,
      agent,
    );
  }
  if (agent.taskState === "parked" || agent.taskState === "done") return undefined;
  if (agent.attentionSignal) {
    if (agent.attentionSignal.kind === "stalled-active") {
      return "signal:stalled-active";
    }
    return withEvidence(`signal:${agent.attentionSignal.kind}`, agent);
  }
  if (agent.outcome && agent.outcome !== "healthy") {
    return `outcome:${agent.outcome}`;
  }
  if (agent.attention === true) {
    return "attention:unread";
  }
  if (agent.status === "attention") {
    return "status:attention";
  }
  return undefined;
}

export class MemoryAckStore implements AckStore {
  protected readonly records = new Map<string, AgentAck>();
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(protected readonly now: () => number = Date.now) {}

  loadError(): string | undefined {
    return undefined;
  }

  list(): readonly AgentAck[] {
    return [...this.records.values()].sort((left, right) =>
      right.ackedAt.localeCompare(left.ackedAt) || left.agentId.localeCompare(right.agentId));
  }

  get(agentId: string): AgentAck | undefined {
    return this.records.get(agentId);
  }

  put(agentId: string, alertFingerprint: string): Promise<AgentAck> {
    return this.mutate(async () => {
      const ack: AgentAck = {
        agentId,
        ackedAt: new Date(this.now()).toISOString(),
        alertFingerprint,
      };
      await this.commit([
        ack,
        ...this.list().filter((record) => record.agentId !== agentId),
      ]);
      return ack;
    });
  }

  delete(agentId: string): Promise<boolean> {
    return this.mutate(async () => {
      if (!this.records.has(agentId)) return false;
      await this.commit(this.list().filter((record) => record.agentId !== agentId));
      return true;
    });
  }

  reconcile(currentAlerts: ReadonlyMap<string, string>): Promise<void> {
    return this.mutate(async () => {
      const retained = this.list().filter((ack) =>
        currentAlerts.get(ack.agentId) === ack.alertFingerprint);
      if (retained.length === this.records.size) return;
      await this.commit(retained);
    });
  }

  private async commit(records: readonly AgentAck[]): Promise<void> {
    await this.persist(records);
    this.records.clear();
    for (const record of records) this.records.set(record.agentId, record);
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  protected async persist(_records: readonly AgentAck[]): Promise<void> {}
}

export class JsonAckStore extends MemoryAckStore {
  private writeNumber = 0;
  private lastLoadError?: string;

  private constructor(private readonly path: string, now: () => number) {
    super(now);
  }

  override loadError(): string | undefined {
    return this.lastLoadError;
  }

  static async open(path: string, now: () => number = Date.now): Promise<JsonAckStore> {
    const store = new JsonAckStore(path, now);
    try {
      const parsed = JSON.parse(await readFile(path, "utf8"));
      if (!Array.isArray(parsed) || !parsed.every(isAgentAck)) {
        throw new Error("ack state must be an array of AgentAck records");
      }
      for (const ack of parsed) store.records.set(ack.agentId, ack);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        store.records.clear();
        store.lastLoadError = `ack state could not be read from ${path}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[JsonAckStore] ${store.lastLoadError}`);
      }
    }
    return store;
  }

  protected override async persist(records: readonly AgentAck[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    this.writeNumber += 1;
    const temporary = `${this.path}.${process.pid}.${this.writeNumber}.tmp`;
    await writeFile(temporary, `${JSON.stringify(records, null, 2)}\n`, "utf8");
    await rename(temporary, this.path);
  }
}

function isAgentAck(value: unknown): value is AgentAck {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<AgentAck>;
  return Object.keys(value).length === 3
    && typeof record.agentId === "string"
    && record.agentId.length > 0
    && typeof record.ackedAt === "string"
    && Number.isFinite(Date.parse(record.ackedAt))
    && typeof record.alertFingerprint === "string"
    && record.alertFingerprint.length > 0;
}
