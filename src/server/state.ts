import { readFile } from "node:fs/promises";
import type { HubSnapshot, Provider } from "../shared/types";
import { collectCmux, collectCmuxNotifications } from "./cmux";
import { collectSessions } from "./collectors";
import { buildSnapshot, type ProgramHint } from "./snapshot";
import type { ArchiveStore, CmuxNotification, CmuxSurface, CommandRunner } from "./types";
import { enrichCmuxIdentity } from "./identity";

export interface HubCollectors {
  sessions: typeof collectSessions;
  cmux: typeof collectCmux;
  notifications: typeof collectCmuxNotifications;
  enrichIdentity: typeof enrichCmuxIdentity;
}

const DEFAULT_COLLECTORS: HubCollectors = {
  sessions: collectSessions,
  cmux: collectCmux,
  notifications: collectCmuxNotifications,
  enrichIdentity: enrichCmuxIdentity,
};

export class HubState {
  #snapshot: HubSnapshot;
  #surfaces: CmuxSurface[] = [];
  #notifications: CmuxNotification[] = [];
  #cmuxErrors: string[] = ["cmux discovery has not completed"];
  #cmuxReachable = false;
  #cmuxLastCheckedAt = new Date(0).toISOString();
  #refreshing?: Promise<HubSnapshot>;
  #cmuxRequested = false;
  #refreshingCmux = false;
  #listeners = new Set<(snapshot: HubSnapshot) => void>();

  constructor(
    private readonly runner: CommandRunner,
    private readonly archiveStore: ArchiveStore,
    private readonly programHints: readonly ProgramHint[],
    private readonly collectors: HubCollectors = DEFAULT_COLLECTORS,
  ) {
    this.#snapshot = buildSnapshot({
      agents: [],
      surfaces: [],
      archiveStore,
      programHints,
      cmuxErrors: this.#cmuxErrors,
      cmuxReachable: this.#cmuxReachable,
      cmuxLastCheckedAt: this.#cmuxLastCheckedAt,
    });
  }

  get(): HubSnapshot {
    return this.#snapshot;
  }

  subscribe(listener: (snapshot: HubSnapshot) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async refresh(options: { cmux?: boolean } = {}): Promise<HubSnapshot> {
    if (options.cmux && !this.#refreshingCmux) this.#cmuxRequested = true;
    if (this.#refreshing) return this.#refreshing;
    this.#refreshing = this.#drainRefreshes().finally(() => {
      this.#refreshing = undefined;
    });
    return this.#refreshing;
  }

  async #drainRefreshes(): Promise<HubSnapshot> {
    let snapshot = this.#snapshot;
    do {
      const cmux = this.#cmuxRequested;
      this.#cmuxRequested = false;
      this.#refreshingCmux = cmux;
      try {
        snapshot = await this.#performRefresh({ cmux });
      } finally {
        this.#refreshingCmux = false;
      }
    } while (this.#cmuxRequested);
    return snapshot;
  }

  async #performRefresh(options: { cmux?: boolean }): Promise<HubSnapshot> {
    const cmuxAttemptAt = options.cmux ? new Date().toISOString() : undefined;
    const providers: Provider[] = ["omp", "codex", "claude", "cursor"];
    const [sessions, cmux, notifications] = await Promise.all([
      this.collectors.sessions(),
      options.cmux ? this.collectors.cmux(this.runner) : Promise.resolve(undefined),
      options.cmux ? this.collectors.notifications(this.runner) : Promise.resolve(undefined),
    ]);
    if (cmux) {
      this.#cmuxLastCheckedAt = cmuxAttemptAt ?? this.#cmuxLastCheckedAt;
      const collectedAgents = providers.flatMap(
        (provider) => sessions[provider].value,
      );
      const enriched = await this.collectors.enrichIdentity(cmux.value, collectedAgents, this.runner);
      this.#surfaces = enriched.value;
      this.#notifications = notifications?.value ?? [];
      this.#cmuxReachable = cmux.errors.length === 0;
      this.#cmuxErrors = [...cmux.errors, ...(notifications?.errors ?? []), ...enriched.errors];
    }
    const sourceErrors = Object.fromEntries(
      providers.map((provider) => [provider, sessions[provider].errors]),
    ) as Record<Provider, string[]>;
    this.#snapshot = buildSnapshot({
      agents: providers.flatMap((provider) => sessions[provider].value),
      surfaces: this.#surfaces,
      notifications: this.#notifications,
      programHints: this.programHints,
      sourceErrors,
      cmuxErrors: this.#cmuxErrors,
      cmuxReachable: this.#cmuxReachable,
      cmuxLastCheckedAt: this.#cmuxLastCheckedAt,
      archiveStore: this.archiveStore,
    });
    for (const listener of this.#listeners) listener(this.#snapshot);
    return this.#snapshot;
  }
}

export async function loadProgramHints(path: string): Promise<ProgramHint[]> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(parsed?.programs)) return [];
    return parsed.programs.filter(
      (program: unknown): program is ProgramHint =>
        Boolean(
          program &&
            typeof program === "object" &&
            typeof (program as ProgramHint).id === "string" &&
            typeof (program as ProgramHint).name === "string" &&
            Array.isArray((program as ProgramHint).match) &&
            (program as ProgramHint).match.every((match) => typeof match === "string"),
        ),
    );
  } catch {
    return [];
  }
}
