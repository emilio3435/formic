import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface AlertSinceRecord {
  agentId: string;
  fingerprint: string;
  firstSeenAt: string;
}

export interface AlertSinceStore {
  observe(current: ReadonlyMap<string, string>, nowMs?: number): Promise<void>;
  get(agentId: string): string | undefined;
  list(): readonly AlertSinceRecord[];
}

export class MemoryAlertSinceStore implements AlertSinceStore {
  protected readonly records = new Map<string, AlertSinceRecord>();
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(protected readonly now: () => number = Date.now) {}

  get(agentId: string): string | undefined {
    return this.records.get(agentId)?.firstSeenAt;
  }

  list(): readonly AlertSinceRecord[] {
    return [...this.records.values()].sort((left, right) => left.agentId.localeCompare(right.agentId));
  }

  observe(current: ReadonlyMap<string, string>, nowMs = this.now()): Promise<void> {
    return this.mutate(async () => {
      const firstSeenAt = new Date(nowMs).toISOString();
      const records = [...current].map(([agentId, fingerprint]) => {
        const existing = this.records.get(agentId);
        return existing?.fingerprint === fingerprint
          ? existing
          : { agentId, fingerprint, firstSeenAt };
      });
      const unchanged = records.length === this.records.size
        && records.every((record) => this.records.get(record.agentId) === record);
      if (unchanged) return;
      await this.persist(records);
      this.records.clear();
      for (const record of records) this.records.set(record.agentId, record);
    });
  }

  private mutate(operation: () => Promise<void>): Promise<void> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  protected async persist(_records: readonly AlertSinceRecord[]): Promise<void> {}
}

export class JsonAlertSinceStore extends MemoryAlertSinceStore {
  private writeNumber = 0;
  private lastLoadError?: string;

  private constructor(private readonly path: string, now: () => number) {
    super(now);
  }

  loadError(): string | undefined {
    return this.lastLoadError;
  }

  static async open(path: string, now: () => number = Date.now): Promise<JsonAlertSinceStore> {
    const store = new JsonAlertSinceStore(path, now);
    try {
      const parsed = JSON.parse(await readFile(path, "utf8"));
      if (!Array.isArray(parsed) || !parsed.every(isAlertSinceRecord)) {
        throw new Error("alert-since state must be an array of AlertSinceRecord records");
      }
      for (const record of parsed) store.records.set(record.agentId, record);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        store.records.clear();
        store.lastLoadError = `alert-since state could not be read from ${path}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[JsonAlertSinceStore] ${store.lastLoadError}`);
      }
    }
    return store;
  }

  protected override async persist(records: readonly AlertSinceRecord[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    this.writeNumber += 1;
    const temporary = `${this.path}.${process.pid}.${this.writeNumber}.tmp`;
    await writeFile(temporary, `${JSON.stringify(records, null, 2)}\n`, "utf8");
    await rename(temporary, this.path);
  }
}

function isAlertSinceRecord(value: unknown): value is AlertSinceRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<AlertSinceRecord>;
  return Object.keys(value).length === 3
    && typeof record.agentId === "string"
    && record.agentId.length > 0
    && typeof record.fingerprint === "string"
    && record.fingerprint.length > 0
    && typeof record.firstSeenAt === "string"
    && Number.isFinite(Date.parse(record.firstSeenAt));
}
