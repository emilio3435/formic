import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import type { HubSnapshot, IssueLifecycle, OperatorIssue, Provider, SourceHealth, TriageQueueSummary } from "../shared/types";
import { collectCmux, collectCmuxNotifications, DEFAULT_CMUX_EXECUTABLE } from "./cmux";
import { collectSessions, DEFAULT_SESSION_WINDOW_MS } from "./collectors";
import { buildSnapshot, type ProgramHint, withIssueDecoration, withPulse } from "./snapshot";
import { PulseTracker } from "./pulse";
import type { ArchiveStore, CmuxNotification, CmuxSurface, CommandRunner } from "./types";
import { enrichCmuxIdentity } from "./identity";
import { bridgeAgentsWithBindings, updateBindingsFromScan, type IdentityBindingStore } from "./identity-bindings";
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

const REFRESH_WATCHDOG_MS = 12_000;
export const REFRESH_AGGREGATE_TIMEOUT_MS = 10_000;

export class HubState {
  #snapshot: HubSnapshot;
  #pulse: PulseTracker;
  #surfaces: CmuxSurface[] = [];
  #notifications: CmuxNotification[] = [];
  #cmuxErrors: string[] = ["cmux discovery has not completed"];
  #cmuxReachable = false;
  #cmuxLastCheckedAt = new Date(0).toISOString();
  #liveAgentProcessIds?: number[];
  #refreshing?: Promise<HubSnapshot>;
  #refreshStartedAtMs?: number;
  #cmuxRequested = false;
  #refreshingCmux = false;
  #listeners = new Set<(snapshot: HubSnapshot) => void>();
  #issueLifecycle = new Map<string, IssueLifecycle>();
  #recentlyResolved: OperatorIssue[] = [];
  #hasSourceSnapshot = false;
  #sourceHealth: Record<Provider, SourceHealth> = {
    omp: { healthy: false, lastHealthyAt: null },
    codex: { healthy: false, lastHealthyAt: null },
    claude: { healthy: false, lastHealthyAt: null },
    cursor: { healthy: false, lastHealthyAt: null },
  };

  #scanWindowHours = DEFAULT_SCAN_WINDOW_HOURS;

  constructor(
    private readonly runner: CommandRunner,
    private readonly archiveStore: ArchiveStore,
    private readonly programHints: readonly ProgramHint[],
    private readonly collectors: HubCollectors = DEFAULT_COLLECTORS,
    private readonly settingsReader?: () => HubSettings,
    private readonly triageReader?: () => readonly TriageQueueSummary[],
    private readonly burnReader?: () => Promise<UsageSummary>,
    private readonly cmuxExecutable = DEFAULT_CMUX_EXECUTABLE,
    private readonly bindingStore?: IdentityBindingStore,
    private readonly refreshAggregateTimeoutMs = REFRESH_AGGREGATE_TIMEOUT_MS,
  ) {
    this.#pulse = new PulseTracker(this.burnReader);
    this.#scanWindowHours = settingsReader?.().scanWindowHours ?? DEFAULT_SCAN_WINDOW_HOURS;
    const initialSnapshot = this.#withSourceHealth(buildSnapshot({
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
    }));
    this.#snapshot = withPulse(initialSnapshot, this.#pulse.report(Date.now()));
  }

  get(): HubSnapshot {
    return this.#snapshot;
  }

  surfaces(): readonly CmuxSurface[] {
    return this.#surfaces;
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
    const decorated = withIssueDecoration(
      { ...this.#snapshot, issues },
      this.triageReader?.() ?? this.#snapshot.triageSummaries,
    );
    this.#snapshot = withPulse(decorated, this.#pulse.report(Date.now()));
    for (const listener of this.#listeners) listener(this.#snapshot);
  }

  #withSourceHealth(snapshot: HubSnapshot): HubSnapshot {
    const sourceHealth = snapshot.totals.sourceHealth;
    if (!sourceHealth) return snapshot;
    return {
      ...snapshot,
      totals: {
        ...snapshot.totals,
        sourceHealth: { ...sourceHealth, byProvider: { ...this.#sourceHealth } },
      },
    };
  }

  async refresh(options: { cmux?: boolean } = {}): Promise<HubSnapshot> {
    if (this.#refreshing) {
      const pendingMs = Date.now() - (this.#refreshStartedAtMs ?? Date.now());
      if (pendingMs <= REFRESH_WATCHDOG_MS) {
        if (options.cmux && !this.#refreshingCmux) this.#cmuxRequested = true;
        return this.#refreshing;
      }
      console.error(`[HubState] refresh watchdog dropped a pass pending for ${pendingMs}ms`);
      this.#refreshing = undefined;
      this.#refreshStartedAtMs = undefined;
      this.#refreshingCmux = false;
    }
    if (options.cmux) this.#cmuxRequested = true;
    const refresh = this.#drainRefreshes().finally(() => {
      if (this.#refreshing !== refresh) return;
      this.#refreshing = undefined;
      this.#refreshStartedAtMs = undefined;
    });
    this.#refreshStartedAtMs = Date.now();
    this.#refreshing = refresh;
    return refresh;
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
    type SessionsResult = Awaited<ReturnType<HubCollectors["sessions"]>>;
    type CmuxResult = Awaited<ReturnType<HubCollectors["cmux"]>>;
    type NotificationsResult = Awaited<ReturnType<HubCollectors["notifications"]>>;
    type IdentityResult = Awaited<ReturnType<HubCollectors["enrichIdentity"]>>;
    let sessionsResult: SessionsResult | undefined;
    let cmuxResult: CmuxResult | undefined;
    let notificationsResult: NotificationsResult | undefined;
    let identityResult: IdentityResult | undefined;
    const collectionErrors: string[] = [];
    const capture = async <T>(
      label: string,
      work: Promise<T>,
      assign: (value: T) => void,
    ): Promise<void> => {
      try {
        assign(await work);
      } catch (error) {
        collectionErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    let aggregateSettled = false;
    const aggregate = Promise.all([
      capture("session collection failed", this.collectors.sessions(homedir(), windowMs), (value) => {
        sessionsResult = value;
      }),
      ...(options.cmux
        ? [
            capture("cmux discovery failed", this.collectors.cmux(this.runner, this.cmuxExecutable), (value) => {
              cmuxResult = value;
            }),
            capture(
              "cmux notification collection failed",
              this.collectors.notifications(this.runner, this.cmuxExecutable),
              (value) => {
                notificationsResult = value;
              },
            ),
          ]
        : []),
    ]).then(async () => {
      const agents = sessionsResult
        ? providers.flatMap((provider) => sessionsResult![provider].value)
        : [];
      if (options.cmux && cmuxResult?.errors.length === 0) {
        await capture(
          "cmux identity enrichment failed",
          this.collectors.enrichIdentity(cmuxResult.value, agents, this.runner),
          (value) => {
            identityResult = value;
          },
        );
      }
      aggregateSettled = true;
    });
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      aggregate,
      new Promise<void>((resolve) => {
        deadlineTimer = setTimeout(resolve, this.refreshAggregateTimeoutMs);
      }),
    ]);
    if (aggregateSettled && deadlineTimer) clearTimeout(deadlineTimer);
    const deadlineError = `collector aggregate exceeded ${this.refreshAggregateTimeoutMs}ms deadline`;
    if (!aggregateSettled) {
      collectionErrors.push(deadlineError);
      console.error(`[HubState] ${deadlineError}; publishing partial snapshot`);
    }
    const unavailableError = collectionErrors[0] ?? deadlineError;
    const unavailableSessions = (): SessionsResult => ({
      omp: { value: [], errors: [unavailableError] },
      codex: { value: [], errors: [unavailableError] },
      claude: { value: [], errors: [unavailableError] },
      cursor: { value: [], errors: [unavailableError] },
    });
    const sessions = sessionsResult ?? unavailableSessions();
    const cmux = options.cmux
      ? cmuxResult ?? { value: [], errors: [unavailableError] }
      : undefined;
    const notifications = options.cmux
      ? notificationsResult ?? { value: [], errors: [unavailableError] }
      : undefined;
    const collectedAt = new Date().toISOString();
    for (const provider of providers) {
      const source = sessions[provider];
      this.#sourceHealth[provider] = source.errors.length === 0
        ? { healthy: true, lastHealthyAt: collectedAt }
        : { healthy: false, lastHealthyAt: this.#sourceHealth[provider].lastHealthyAt };
    }
    const collectedAgents = providers.flatMap((provider) => sessions[provider].value);
    let historyError: string | undefined;
    try {
      await this.archiveStore.record?.(collectedAgents);
    } catch (error) {
      historyError = `session history persistence failed: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[HubState] ${historyError}`);
    }
    if (cmux) {
      this.#cmuxReachable = cmux.errors.length === 0;
      let identityErrors: string[] = [];
      let bindingErrors: string[] = [];
      if (this.#cmuxReachable) {
        this.#cmuxLastCheckedAt = cmuxAttemptAt ?? this.#cmuxLastCheckedAt;
        if (identityResult) {
          this.#surfaces = identityResult.value;
          this.#liveAgentProcessIds = identityResult.liveAgentProcessIds
            ? [...identityResult.liveAgentProcessIds]
            : undefined;
          identityErrors = identityResult.errors;
        } else if (cmux.errors.length === 0) {
          identityErrors = [
            collectionErrors.find((error) => error.startsWith("cmux identity enrichment failed")) ?? deadlineError,
          ];
        }
        // Only completed identity scans confirm bindings; a failed write is an
        // operator-visible error, never a silent skip or a broken refresh loop.
        bindingErrors = this.bindingStore
          ? (await updateBindingsFromScan(this.bindingStore, this.#surfaces, collectedAt)).errors
          : [];
      }
      if (notifications && notifications.errors.length === 0) {
        this.#notifications = notifications.value;
      }
      this.#cmuxErrors = [...new Set([
        ...cmux.errors,
        ...(notifications?.errors ?? []),
        ...identityErrors,
        ...bindingErrors,
        ...collectionErrors,
      ])];
    }
    const sourceErrors = Object.fromEntries(
      providers.map((provider) => [
        provider,
        [...new Set([
          ...sessions[provider].errors,
          ...(!sessionsResult ? collectionErrors : []),
          ...(historyError ? [historyError] : []),
        ])],
      ]),
    ) as Record<Provider, string[]>;
    const built = this.#withSourceHealth(buildSnapshot({
      agents: this.bindingStore
        ? bridgeAgentsWithBindings(
            this.bindingStore,
            collectedAgents,
            this.#surfaces,
            this.#liveAgentProcessIds,
          )
        : collectedAgents,
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
    }));
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

/* Program grouping is operator-authored config. Every way it can fail still
   returns [] — the hub must boot — but a typo silently ungrouping the whole
   board is indistinguishable from "no config written yet" unless we say so. */
export async function loadProgramHints(path: string): Promise<ProgramHint[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    // Absent file is the normal state until an operator writes one.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`[HubState] could not read program hints at ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(`[HubState] program hints at ${path} are not valid JSON, so no programs are grouped: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
  const programs = (parsed as { programs?: unknown } | null)?.programs;
  if (!Array.isArray(programs)) {
    console.error(`[HubState] program hints at ${path} have no "programs" array, so no programs are grouped.`);
    return [];
  }
  const hints = programs.filter(
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
  if (hints.length < programs.length) {
    console.error(
      `[HubState] ${programs.length - hints.length} of ${programs.length} program hints in ${path} were dropped for a missing or non-string id, name, or match[].`,
    );
  }
  return hints;
}
