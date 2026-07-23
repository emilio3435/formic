import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import type { HubSnapshot, IssueLifecycle, OperatorIssue, Provider, TriageQueueSummary } from "../shared/types";
import { collectCmux, collectCmuxNotifications } from "./cmux";
import { collectSessions, DEFAULT_SESSION_WINDOW_MS } from "./collectors";
import { buildSnapshot, type ProgramHint, withIssueDecoration, withPulse } from "./snapshot";
import { PulseTracker } from "./pulse";
import type { ArchiveStore, CmuxNotification, CmuxSurface, CommandRunner } from "./types";
import { enrichCmuxIdentity } from "./identity";
import { DEFAULT_SCAN_WINDOW_HOURS, type HubSettings } from "./settings";
import type { UsageSummary } from "./burnbar";

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
  #pulse: PulseTracker;
  #surfaces: CmuxSurface[] = [];
  #notifications: CmuxNotification[] = [];
  #cmuxErrors: string[] = ["cmux discovery has not completed"];
  #cmuxReachable = false;
  #cmuxLastCheckedAt = new Date(0).toISOString();
  #refreshing?: Promise<HubSnapshot>;
  #cmuxRequested = false;
  #refreshingCmux = false;
  #listeners = new Set<(snapshot: HubSnapshot) => void>();
  #issueLifecycle = new Map<string, IssueLifecycle>();
  #recentlyResolved: OperatorIssue[] = [];
  #hasSourceSnapshot = false;

  #scanWindowHours = DEFAULT_SCAN_WINDOW_HOURS;

  constructor(
    private readonly runner: CommandRunner,
    private readonly archiveStore: ArchiveStore,
    private readonly programHints: readonly ProgramHint[],
    private readonly collectors: HubCollectors = DEFAULT_COLLECTORS,
    private readonly settingsReader?: () => HubSettings,
    private readonly triageReader?: () => readonly TriageQueueSummary[],
    private readonly burnReader?: () => Promise<UsageSummary>,
  ) {
    this.#pulse = new PulseTracker(this.burnReader);
    this.#scanWindowHours = settingsReader?.().scanWindowHours ?? DEFAULT_SCAN_WINDOW_HOURS;
    this.#snapshot = buildSnapshot({
      agents: [],
      surfaces: [],
      archiveStore,
      programHints,
      cmuxErrors: this.#cmuxErrors,
      cmuxReachable: this.#cmuxReachable,
      cmuxLastCheckedAt: this.#cmuxLastCheckedAt,
      issueLifecycle: this.#issueLifecycle,
      recentlyResolved: this.#recentlyResolved,
      triageSummaries: this.triageReader?.(),
      scanWindowHours: this.#scanWindowHours,
    });
  }

  get(): HubSnapshot {
    return this.#snapshot;
  }

  subscribe(listener: (snapshot: HubSnapshot) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  markIssueVerifying(issueId: string, result?: string): void {
    this.#markIssue(issueId, "verifying", result);
  }

  markIssueBlocked(issueId: string, result?: string): void {
    this.#markIssue(issueId, "blocked", result);
  }

  #markIssue(issueId: string, state: IssueLifecycle["state"], result?: string): void {
    const current = this.#issueLifecycle.get(issueId) ?? this.#snapshot.issues?.find((issue) => issue.id === issueId)?.lifecycle;
    const now = new Date().toISOString();
    const lifecycle: IssueLifecycle = {
      state,
      openedAt: current?.openedAt ?? now,
      verificationStartedAt: state === "open"
        ? undefined
        : current?.state === "verifying" && current.verificationStartedAt
          ? current.verificationStartedAt
          : current?.verificationStartedAt ?? now,
      result,
    };
    this.#issueLifecycle.set(issueId, lifecycle);
    const issues = (this.#snapshot.issues ?? []).map((issue) =>
      issue.id === issueId ? { ...issue, lifecycle } : issue,
    );
    if (issues.every((issue, index) => issue === this.#snapshot.issues?.[index])) return;
    this.#snapshot = withIssueDecoration(
      { ...this.#snapshot, issues },
      this.triageReader?.() ?? this.#snapshot.triageSummaries,
    );
    for (const listener of this.#listeners) listener(this.#snapshot);
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
    this.#scanWindowHours = this.settingsReader?.().scanWindowHours ?? this.#scanWindowHours;
    const windowMs = Math.max(1, this.#scanWindowHours) * 60 * 60 * 1_000 || DEFAULT_SESSION_WINDOW_MS;
    const [sessions, cmux, notifications] = await Promise.all([
      this.collectors.sessions(homedir(), windowMs),
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
    const built = buildSnapshot({
      agents: providers.flatMap((provider) => sessions[provider].value),
      surfaces: this.#surfaces,
      notifications: this.#notifications,
      programHints: this.programHints,
      sourceErrors,
      cmuxErrors: this.#cmuxErrors,
      cmuxReachable: this.#cmuxReachable,
      cmuxLastCheckedAt: this.#cmuxLastCheckedAt,
      archiveStore: this.archiveStore,
      issueLifecycle: this.#issueLifecycle,
      previousIssues: this.#hasSourceSnapshot ? this.#snapshot.issues : undefined,
      recentlyResolved: this.#recentlyResolved,
      triageSummaries: this.triageReader?.(),
      scanWindowHours: this.#scanWindowHours,
    });
    this.#hasSourceSnapshot = true;
    this.#recentlyResolved = [...(built.recentlyResolved ?? [])];
    const nextLifecycle = new Map<string, IssueLifecycle>();
    for (const issue of [...(built.issues ?? []), ...this.#recentlyResolved]) {
      if (issue.lifecycle) nextLifecycle.set(issue.id, issue.lifecycle);
    }
    this.#issueLifecycle = nextLifecycle;
    const pulseNowMs = Date.now();
    this.#pulse.observe(built, pulseNowMs);
    this.#pulse.maybeRefreshBurnCost();
    this.#snapshot = withPulse(built, this.#pulse.report(pulseNowMs));
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
