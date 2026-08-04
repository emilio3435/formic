import type { CollectedAgent } from "./types";

/* What the board has ever witnessed about a session's process, kept across
   restarts.

   THE PROBLEM THIS SOLVES. Process ids are only observable for processes
   running at scan time, and they were held in memory alone. Every launchd
   kickstart threw away the entire record of what the board had seen alive, so a
   session it had watched for hours became unprovable the moment the server
   blinked — and `unverified` is where unprovable sessions go. Restarting the
   dashboard actively destroyed evidence.

   WHAT PERSISTING BUYS, beyond surviving a restart. A process cannot outlive
   the boot it was started in. So a witness recorded under a DIFFERENT boot id
   is not merely stale — it proves the process is gone, which is stronger
   evidence than any roster argument. That is the one case where the board can
   say "died" about a session it never watched exit, and be certain. */

/** Minute-resolution identity for the current boot. */
export function currentBootId(uptimeSeconds: number, nowMs: number): string {
  /* Rounded to the minute because `nowMs - uptime` jitters by milliseconds
     between calls, and an id that changes on jitter would invalidate every
     witness on every scan — silently turning persistence back off. */
  return String(Math.round((nowMs - uptimeSeconds * 1_000) / 60_000));
}

export interface ProcessWitness {
  agentId: string;
  /** Process ids observed serving this session, within `bootId`. */
  processIds: number[];
  /** The boot the ids were observed in. Ids from another boot cannot be live. */
  bootId: string;
  /** When a scan last saw one of them running. */
  witnessedAt: string;
}

export interface ProcessWitnessStore {
  get(agentId: string): ProcessWitness | undefined;
  /** Record what this scan saw alive. Absent agents keep their prior witness. */
  record(witnesses: readonly ProcessWitness[]): Promise<void>;
  /** Set when an empty store is standing in for one that could not be read. */
  loadError?(): string | undefined;
}

export interface WitnessFileOperations {
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
}

const nodeFileOperations: WitnessFileOperations = {
  readText: (path) => Bun.file(path).text(),
  writeText: async (path, text) => {
    await Bun.write(path, text);
  },
};

function isWitness(value: unknown): value is ProcessWitness {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.agentId === "string"
    && typeof record.bootId === "string"
    && typeof record.witnessedAt === "string"
    && Array.isArray(record.processIds)
    && record.processIds.every((pid) => typeof pid === "number" && Number.isInteger(pid) && pid > 0);
}

export class JsonProcessWitnessStore implements ProcessWitnessStore {
  readonly #witnesses = new Map<string, ProcessWitness>();
  #writeQueue: Promise<void> = Promise.resolve();
  #loadError?: string;

  private constructor(
    private readonly path: string,
    private readonly files: WitnessFileOperations,
    private readonly limit: number,
  ) {}

  static async open(
    path: string,
    files: WitnessFileOperations = nodeFileOperations,
    limit = 5_000,
  ): Promise<JsonProcessWitnessStore> {
    const store = new JsonProcessWitnessStore(path, files, limit);
    try {
      const parsed = JSON.parse(await store.files.readText(path));
      if (!Array.isArray(parsed)) throw new Error("witness file is not an array");
      for (const value of parsed) {
        if (!isWitness(value)) continue;
        store.#witnesses.set(value.agentId, value);
      }
    } catch (error) {
      /* A missing file is the ordinary first-run state, not a fault. Anything
         else means the board is about to under-report endings, which an
         operator should be told rather than left to infer from the counts. */
      const message = error instanceof Error ? error.message : String(error);
      if (!/ENOENT|no such file/i.test(message)) {
        store.#loadError = `process witnesses could not be read from ${path}, so sessions seen alive before this restart cannot be proven finished: ${message}`;
      }
    }
    return store;
  }

  get(agentId: string): ProcessWitness | undefined {
    return this.#witnesses.get(agentId);
  }

  loadError(): string | undefined {
    return this.#loadError;
  }

  async record(witnesses: readonly ProcessWitness[]): Promise<void> {
    let changed = false;
    for (const witness of witnesses) {
      const previous = this.#witnesses.get(witness.agentId);
      if (previous
        && previous.bootId === witness.bootId
        && previous.witnessedAt === witness.witnessedAt
        && previous.processIds.length === witness.processIds.length
        && previous.processIds.every((pid, index) => pid === witness.processIds[index])) {
        continue;
      }
      this.#witnesses.set(witness.agentId, witness);
      changed = true;
    }
    if (!changed) return;
    /* Newest first, then truncate: the cap has to drop the LEAST recently
       witnessed, or a busy machine would evict the sessions it just saw. */
    const ordered = [...this.#witnesses.values()]
      .sort((left, right) => right.witnessedAt.localeCompare(left.witnessedAt))
      .slice(0, this.limit);
    if (ordered.length < this.#witnesses.size) {
      this.#witnesses.clear();
      for (const witness of ordered) this.#witnesses.set(witness.agentId, witness);
    }
    const payload = JSON.stringify(ordered, null, 2);
    this.#writeQueue = this.#writeQueue
      .then(() => this.files.writeText(this.path, payload))
      .catch(() => {});
    await this.#writeQueue;
  }
}

/** What a scan observed, ready to persist. */
export function witnessesFromScan(
  agents: readonly CollectedAgent[],
  bootId: string,
  nowIso: string,
): ProcessWitness[] {
  const witnesses: ProcessWitness[] = [];
  for (const agent of agents) {
    if (agent.processAlive !== true) continue;
    if (!agent.processIds?.length) continue;
    witnesses.push({
      agentId: agent.id,
      processIds: [...agent.processIds],
      bootId,
      witnessedAt: nowIso,
    });
  }
  return witnesses;
}

/**
 * Restore what earlier boots and earlier scans witnessed onto agents that have
 * no process evidence of their own.
 *
 * Never overwrites a live observation: a scan that just saw the process running
 * is better evidence than any record, and clobbering it is the erasure bug the
 * binding bridge already had to be taught not to repeat.
 */
export function applyProcessWitness(
  agents: readonly CollectedAgent[],
  store: Pick<ProcessWitnessStore, "get">,
  bootId: string,
): CollectedAgent[] {
  return agents.map((agent) => {
    if (agent.processAlive === true) return agent;
    if (agent.processIds?.length) return agent;
    const witness = store.get(agent.id);
    if (!witness?.processIds.length) return agent;
    if (witness.bootId === bootId) {
      /* Same boot: the ids are still meaningful, so hand them back and let the
         liveness check answer. It may well find them running. */
      return { ...agent, processIds: [...witness.processIds] };
    }
    /* A different boot. These ids were real and the machine has restarted since,
       so the processes they named cannot be running — no roster argument
       needed. This is the one path that proves death for a session the board
       never watched exit. */
    return { ...agent, processIds: [...witness.processIds], processAlive: false };
  });
}
