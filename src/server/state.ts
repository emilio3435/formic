import { readFile } from "node:fs/promises";
import { homedir, uptime } from "node:os";
import type { HubSnapshot, IssueLifecycle, OperatorIssue, Provider, SourceHealth, TriageQueueSummary } from "../shared/types";
import { PROVIDERS } from "../shared/types";
import { collectCmux, collectCmuxNotifications, DEFAULT_CMUX_EXECUTABLE } from "./cmux";
import { collectSessions, DEFAULT_SESSION_WINDOW_MS } from "./collectors";
import { buildSnapshot, type ProgramHint, withIssueDecoration, withPulse } from "./snapshot";
import { PulseTracker } from "./pulse";
import type { ArchiveStore, CmuxNotification, CmuxSurface, CollectedAgent, CommandRunner } from "./types";
import { enrichCmuxIdentity } from "./identity";
import { bridgeAgentsWithBindings, updateBindingsFromScan, type IdentityBindingStore } from "./identity-bindings";
import { DEFAULT_SCAN_WINDOW_HOURS, lifecycleThresholds, type HubSettings } from "./settings";
import {
  applyProcessWitness,
  currentBootId,
  witnessesFromScan,
  type ProcessWitnessStore,
} from "./process-witness";
import type { UsageSummary } from "./burnbar";
import {
  candidateFor,
  nameSessions,
  type JsonSessionNameStore,
  type NameCandidate,
} from "./session-names";

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

/* Everything optional about a HubState, as one bag rather than a positional
   tail.

   This was twelve positional parameters, the last nine optional, and the cost
   was not readability — it was that "add a store" and "add a store" are the
   SAME EDIT to the same line. Three times in one day two lanes appended a
   parameter here at once and collided; every call site also had to pad with
   `undefined` to reach the slot it wanted, which is how a new argument lands
   silently in the wrong position. A key has no position to fight over. */
export interface HubStateOptions {
  collectors?: HubCollectors;
  settingsReader?: () => HubSettings;
  triageReader?: () => readonly TriageQueueSummary[];
  burnReader?: () => Promise<UsageSummary>;
  cmuxExecutable?: string;
  bindingStore?: IdentityBindingStore;
  refreshAggregateTimeoutMs?: number;
  sessionNames?: JsonSessionNameStore;
  witnessStore?: ProcessWitnessStore;
  /** Injectable so tests can pin a boot without a clock. */
  bootId?: string;
}

export class HubState {
  #snapshot: HubSnapshot;
  #pulse: PulseTracker;
  #surfaces: CmuxSurface[] = [];
  #notifications: CmuxNotification[] = [];
  #cmuxErrors: string[] = ["cmux discovery has not completed"];
  #cmuxReachable = false;
  #cmuxAbsent = false;
  #sourceAbsent: Partial<Record<Provider, boolean>> = {};
  #cmuxLastCheckedAt = new Date(0).toISOString();
  #liveAgentProcessIds?: number[];
  /* Whether the last completed scan enumerated everything it needed to. Held
     like #surfaces rather than recomputed per refresh, because a refresh that
     skips cmux has not learned anything new about the process table either. */
  #rosterComplete = false;
  readonly #bootId: string;
  #refreshing?: Promise<HubSnapshot>;
  /* One naming pass at a time; a second refresh while one runs simply skips. */
  #naming?: Promise<void>;
  #refreshStartedAtMs?: number;
  /* Which refresh pass is the current one. Only the watchdog below can put two
     passes in flight at once, and when it does, the abandoned one must stop
     writing — see #superseded. */
  #refreshGeneration = 0;
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
    factory: { healthy: false, lastHealthyAt: null },
  };

  #scanWindowHours = DEFAULT_SCAN_WINDOW_HOURS;

  private readonly collectors: HubCollectors;
  private readonly settingsReader?: () => HubSettings;
  private readonly triageReader?: () => readonly TriageQueueSummary[];
  private readonly burnReader?: () => Promise<UsageSummary>;
  private readonly cmuxExecutable: string;
  private readonly bindingStore?: IdentityBindingStore;
  private readonly refreshAggregateTimeoutMs: number;
  /* Optional so every existing construction — and the tests are full of them —
     keeps the derived names rather than requiring a naming store. */
  private readonly sessionNames?: JsonSessionNameStore;
  private readonly witnessStore?: ProcessWitnessStore;

  constructor(
    private readonly runner: CommandRunner,
    private readonly archiveStore: ArchiveStore,
    private readonly programHints: readonly ProgramHint[],
    options: HubStateOptions = {},
  ) {
    this.collectors = options.collectors ?? DEFAULT_COLLECTORS;
    this.settingsReader = options.settingsReader;
    this.triageReader = options.triageReader;
    this.burnReader = options.burnReader;
    this.cmuxExecutable = options.cmuxExecutable ?? DEFAULT_CMUX_EXECUTABLE;
    this.bindingStore = options.bindingStore;
    this.refreshAggregateTimeoutMs = options.refreshAggregateTimeoutMs ?? REFRESH_AGGREGATE_TIMEOUT_MS;
    this.sessionNames = options.sessionNames;
    this.witnessStore = options.witnessStore;
    this.#bootId = options.bootId ?? currentBootId(uptime(), Date.now());
    this.#pulse = new PulseTracker(this.burnReader);
    const bootSettings = this.settingsReader?.();
    this.#scanWindowHours = bootSettings?.scanWindowHours ?? DEFAULT_SCAN_WINDOW_HOURS;
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
      thresholds: bootSettings ? lifecycleThresholds(bootSettings) : undefined,
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
    const generation = ++this.#refreshGeneration;
    const refresh = this.#drainRefreshes(generation).finally(() => {
      if (this.#refreshing !== refresh) return;
      this.#refreshing = undefined;
      this.#refreshStartedAtMs = undefined;
    });
    this.#refreshStartedAtMs = Date.now();
    this.#refreshing = refresh;
    return refresh;
  }

  /* A newer pass has taken over, so this one was abandoned by the watchdog and
     everything it holds is older than what the board already publishes. Checked
     at each await boundary that precedes a write, because the damage is not
     only the snapshot: source health, the cmux surfaces, the notifications and
     `#rosterComplete` — which is what lets an ending be called provable — are
     all read by whichever pass runs next. */
  #superseded(generation: number): boolean {
    return generation !== this.#refreshGeneration;
  }

  async #drainRefreshes(generation: number): Promise<HubSnapshot> {
    let snapshot = this.#snapshot;
    do {
      if (this.#superseded(generation)) return this.#snapshot;
      const cmux = this.#cmuxRequested;
      this.#cmuxRequested = false;
      this.#refreshingCmux = cmux;
      try {
        snapshot = await this.#performRefresh({ cmux }, generation);
      } finally {
        // Never clear a flag the pass that replaced this one is relying on.
        if (!this.#superseded(generation)) this.#refreshingCmux = false;
      }
    } while (!this.#superseded(generation) && this.#cmuxRequested);
    return snapshot;
  }

  /* Fire-and-forget, deliberately. The refresh that just finished has already
     published everything the operator asked for, and naming is an improvement
     on a fallback that already works — so it must never be able to delay a pass,
     fail one, or run two at once. One pass at a time, awaited by nobody, and
     every error swallowed into a log line. */
  #nameNewSessions(agents: readonly CollectedAgent[]): void {
    const store = this.sessionNames;
    if (!store || this.#naming) return;
    const unnamed = agents.filter((agent) => !store.has(agent.id));
    if (!unnamed.length) return;
    this.#naming = (async () => {
      try {
        const candidates = (await Promise.all(unnamed.slice(0, 40).map((agent) => candidateFor(agent))))
          .filter((candidate): candidate is NameCandidate => Boolean(candidate));
        if (candidates.length) await nameSessions(candidates, { store });
      } catch (error) {
        console.error(`[HubState] naming pass failed: ${String(error)}`);
      } finally {
        this.#naming = undefined;
      }
    })();
  }

  async #performRefresh(options: { cmux?: boolean }, generation: number): Promise<HubSnapshot> {
    const cmuxAttemptAt = options.cmux ? new Date().toISOString() : undefined;
    /* From the union, not a second list. This WAS a literal, and the literal
       silently dropped Factory: the collector read its sessions correctly and
       this loop never asked for them, so the board showed zero rows and marked
       the source unhealthy — with a green suite, because nothing tested that
       every collected provider survives the refresh. */
    const providers: Provider[] = [...PROVIDERS];
    const settings = this.settingsReader?.();
    this.#scanWindowHours = settings?.scanWindowHours ?? this.#scanWindowHours;
    const windowMs = Math.max(1, this.#scanWindowHours) * 60 * 60 * 1_000 || DEFAULT_SESSION_WINDOW_MS;
    /* Read every refresh, not at construction: a settings POST triggers a
       refresh, and an operator who just widened their quiet threshold should
       see the board reclassify on that refresh rather than at the next
       restart. */
    const thresholds = settings ? lifecycleThresholds(settings) : undefined;
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
      capture("session collection failed", this.collectors.sessions(homedir(), windowMs, thresholds), (value) => {
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
    /* Collection is done; from here every line writes. If the watchdog gave up
       on this pass while it was collecting, stop before the first write. */
    if (this.#superseded(generation)) return this.#snapshot;
    const deadlineError = `collector aggregate exceeded ${this.refreshAggregateTimeoutMs}ms deadline`;
    if (!aggregateSettled) {
      collectionErrors.push(deadlineError);
      console.error(`[HubState] ${deadlineError}; publishing partial snapshot`);
    }
    /* A result missing because the DEADLINE fired did not fail for some other
       collector's reason. This published `collectionErrors[0]` — whichever
       error happened to land first — so a machine where cmux is not installed
       (fails in milliseconds) and transcript reading is slow (never finishes)
       told the operator that Claude, Codex, OMP and Cursor were all unavailable
       because "cmux discovery failed: spawn cmux ENOENT". None of them had
       failed; they had not finished, and the reader was sent to the one
       subsystem that was not the problem.

       Each missing result now answers with its OWN failure if it had one, and
       with the deadline otherwise. Reporting "we ran out of time" is honest;
       naming another component is a guess, and a confident wrong one costs more
       than saying less. */
    const reasonFor = (label: string): string =>
      collectionErrors.find((error) => error.startsWith(`${label}:`)) ?? deadlineError;
    const unavailableSessions = (): SessionsResult => {
      const reason = reasonFor("session collection failed");
      return {
        omp: { value: [], errors: [reason] },
        codex: { value: [], errors: [reason] },
        claude: { value: [], errors: [reason] },
        cursor: { value: [], errors: [reason] },
        factory: { value: [], errors: [reason] },
      };
    };
    const sessions = sessionsResult ?? unavailableSessions();
    const cmux = options.cmux
      ? cmuxResult ?? { value: [], errors: [reasonFor("cmux discovery failed")] }
      : undefined;
    const notifications = options.cmux
      ? notificationsResult ?? { value: [], errors: [reasonFor("cmux notification collection failed")] }
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
    if (cmux) {
      /* Not installed is not unreachable. `cmuxReachable === false` drives a
         degraded collector and the "controls are off" banner, both of which are
         faults; a machine without cmux has no fault, it just has no cmux. */
      this.#cmuxAbsent = cmux.absent === true;
      this.#cmuxReachable = cmux.errors.length === 0;
      let identityErrors: string[] = [];
      let bindingErrors: string[] = [];
      /* Cleared before the attempt, restored only by a scan that completed.
         A degraded refresh must not keep answering "nothing claims this
         session" on the strength of a scan that already finished — that is the
         exact shape of claim this contract exists to refuse. */
      this.#rosterComplete = false;
      if (this.#cmuxReachable) {
        this.#cmuxLastCheckedAt = cmuxAttemptAt ?? this.#cmuxLastCheckedAt;
        if (identityResult) {
          this.#surfaces = identityResult.value;
          this.#liveAgentProcessIds = identityResult.liveAgentProcessIds
            ? [...identityResult.liveAgentProcessIds]
            : undefined;
          this.#rosterComplete = identityResult.rosterComplete === true;
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
        if (this.#superseded(generation)) return this.#snapshot;
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
    /* Bridged FIRST, then recorded, then published — one set of agents through
       all three. The history write used to run before the bindings bridge, so a
       record captured process evidence the snapshot never published and the
       snapshot published evidence the record never saw. Two answers about the
       same session in the same refresh, and the archive kept the older one. */
    const bridgedAgents = this.bindingStore
      ? bridgeAgentsWithBindings(
          this.bindingStore,
          collectedAgents,
          this.#surfaces,
          this.#liveAgentProcessIds,
        )
      : collectedAgents;
    /* Then the persisted witnesses, for sessions this scan found nothing about.
       After the bridge so a live observation always wins, and before both the
       history write and the snapshot so the record and the board agree. */
    const publishedAgents = this.witnessStore
      ? applyProcessWitness(bridgedAgents, this.witnessStore, this.#bootId)
      : bridgedAgents;
    if (this.witnessStore && this.#rosterComplete) {
      /* Only a completed scan may write witnesses: a partial one would record
         "nothing was running" for sessions it simply never looked at, and that
         lie would then outlive the restart it was meant to survive. */
      try {
        await this.witnessStore.record(witnessesFromScan(publishedAgents, this.#bootId, collectedAt));
      } catch (error) {
        console.error(`[HubState] process witness persistence failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    try {
      await this.archiveStore.record?.(publishedAgents);
    } catch (error) {
      historyError = `session history persistence failed: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[HubState] ${historyError}`);
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
    /* The witness and archive writes above are the last awaits before this
       pass publishes. A pass superseded during them would otherwise replace a
       newer board with readings taken before it. */
    if (this.#superseded(generation)) return this.#snapshot;
    this.#sourceAbsent = Object.fromEntries(
      providers.map((provider) => [provider, sessions[provider].absent === true]),
    ) as Record<Provider, boolean>;
    const built = this.#withSourceHealth(buildSnapshot({
      agents: publishedAgents,
      surfaces: this.#surfaces,
      notifications: this.#notifications,
      programHints: this.programHints,
      sourceErrors,
      sourceAbsent: this.#sourceAbsent,
      cmuxAbsent: this.#cmuxAbsent,
      cmuxErrors: this.#cmuxErrors,
      cmuxReachable: this.#cmuxReachable,
      cmuxLastCheckedAt: this.#cmuxLastCheckedAt,
      archiveStore: this.archiveStore,
      sessionNames: this.sessionNames ? (id) => this.sessionNames!.get(id) : undefined,
      issueLifecycle: this.#issueLifecycle,
      previousIssues: this.#hasSourceSnapshot ? this.#snapshot.issues : undefined,
      recentlyResolved: this.#recentlyResolved,
      triageSummaries: this.triageReader?.(),
      scanWindowHours: this.#scanWindowHours,
      thresholds,
      processRosterComplete: this.#rosterComplete,
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
    this.#nameNewSessions(publishedAgents);
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
