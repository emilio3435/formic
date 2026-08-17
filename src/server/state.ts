import { open, readFile } from "node:fs/promises";
import { homedir, uptime } from "node:os";
import type { AgentSnapshot, CmuxNotificationSummary, HubSnapshot, IssueLifecycle, OperatorIssue, Provider, SourceHealth, TriageQueueSummary } from "../shared/types";
import { PROVIDERS } from "../shared/types";
import { alertFingerprintFor, MemoryAckStore, type AckStore } from "./ack";
import { MemoryAlertSinceStore, type AlertSinceStore } from "./alert-since";
import {
  collectCmux,
  collectCmuxGroups,
  collectCmuxNotificationSummaries,
  collectCmuxNotifications,
  collectCmuxSidebar,
  collectCmuxWorkspaceEnvs,
  DEFAULT_CMUX_EXECUTABLE,
  type CmuxWindowGroups,
} from "./cmux";
import type { RepoGroupProvenanceStore } from "./cmux-groups";
import type { JsonTeamColorsStore } from "./team-colors";
import { attachTeams, indexTeamsByWorkspace, resolveOperatorTeams, type CmuxTeam } from "../shared/team-tint";
import { normalizeHex } from "../shared/repo-color";
/* TINT-S */ import { syncCmuxColors } from "./cmux-color-sync";
import {
  CmuxEventsSupervisor,
  cmuxEventsCommand,
  type CmuxEventFrame,
  type CmuxEventsRuntime,
} from "./cmux-events";
/* TINT-G */ import { repoGroupReconcileTick } from "./cmux-groups";
import {
  CmuxSyncSupervisor,
  registerSyncHandler,
  type CmuxSyncEvent,
  type CmuxSyncRuntime,
} from "./cmux-sync";
import {
  collectSessionProvider,
  collectSessions,
  DEFAULT_SESSION_WINDOW_MS,
  finalizeSessionProviders,
  type SessionProviderResult,
  type SessionProviderResults,
} from "./collectors";
import { withAttentionClasses } from "./attention-signal";
import { collectHermesSpendSources } from "./hermes";
import { buildSnapshot, type ProgramHint, withIssueDecoration, withPulse } from "./snapshot";
import { isLive } from "./live";
import { rollupFor } from "./snapshot-programs";
import { agentIsStripAlerting } from "./strip-alerting";
import { PulseTracker } from "./pulse";
import type {
  ArchiveStore,
  CmuxNotification,
  CmuxSurface,
  CmuxWorkspaceEnv,
  CmuxWorkspaceSnapshot,
  CollectedAgent,
  CommandRunner,
  SpendSource,
} from "./types";
import { enrichCmuxIdentity } from "./identity";
import { bridgeAgentsWithBindings, updateBindingsFromScan, type IdentityBindingStore } from "./identity-bindings";
import {
  DEFAULT_PROVIDER_WAIT_MS,
  DEFAULT_SCAN_WINDOW_HOURS,
  lifecycleThresholds,
  type HubSettings,
} from "./settings";
import { controlsFor, lifecycleFor } from "./snapshot-agent";
import { resolveAgentTarget } from "./targets";
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
import { readRunManifests, type RunManifest } from "./run-manifests";
import {
  senderClaimFor,
  senderTranscriptTailsFor,
  type SenderTranscriptEvidence,
  type SenderTranscriptTailReader,
} from "./sender-verification";
import { ProviderSettlementCoordinator } from "./provider-settlement";

type Abortable<T extends (...args: any[]) => any> = (
  ...args: [...Parameters<T>, signal?: AbortSignal]
) => ReturnType<T>;

export interface HubCollectors {
  sessions: Abortable<typeof collectSessions>;
  sessionProvider?: Abortable<typeof collectSessionProvider>;
  finalizeSessions?: typeof finalizeSessionProviders;
  spendSources?: typeof collectHermesSpendSources;
  cmux: Abortable<typeof collectCmux>;
  sidebar?: typeof collectCmuxSidebar;
  groups?: typeof collectCmuxGroups;
  workspaceEnv?: typeof collectCmuxWorkspaceEnvs;
  manifests?: typeof readRunManifests;
  notifications: Abortable<typeof collectCmuxNotifications>;
  syncNotifications?: typeof collectCmuxNotificationSummaries;
  enrichIdentity: Abortable<typeof enrichCmuxIdentity>;
}

const DEFAULT_COLLECTORS: HubCollectors = {
  sessions: collectSessions,
  sessionProvider: collectSessionProvider,
  finalizeSessions: finalizeSessionProviders,
  spendSources: collectHermesSpendSources,
  cmux: collectCmux,
  sidebar: collectCmuxSidebar,
  groups: collectCmuxGroups,
  workspaceEnv: collectCmuxWorkspaceEnvs,
  manifests: readRunManifests,
  notifications: collectCmuxNotifications,
  syncNotifications: collectCmuxNotificationSummaries,
  enrichIdentity: enrichCmuxIdentity,
};

const MIN_REFRESH_WATCHDOG_MS = 12_000;
const MIN_CONTROL_AGGREGATE_TIMEOUT_MS = 10_000;
/* Collection and publication have separate budgets. Five seconds keeps the
   production worst case near the spec's 15-second ceiling while still letting
   completed provider truth reach persistence after a 10-second cutoff. */
const PUBLISHING_TAIL_TIMEOUT_MS = 5_000;

/* Settlement reuses an in-flight or staged scan when this key matches. Extra
   Cursor GUI roots must be in it or Import's refresh keeps the previous
   cursor result. */
export function providerCollectionConfigKey(
  windowMs: number,
  thresholds: { readonly freshMs?: number; readonly quietMs?: number } | undefined,
  extraCursorGuiRoots: readonly string[],
  extraGrokBotRoots: readonly string[] = [],
  extraGrokCliRoots: readonly string[] = [],
  extraCopilotRoots: readonly string[] = [],
): string {
  return `${windowMs}:${thresholds?.freshMs ?? "default"}:${thresholds?.quietMs ?? "default"}:${extraCursorGuiRoots.join(",")}:bot=${extraGrokBotRoots.join(",")}:cli=${extraGrokCliRoots.join(",")}:copilot=${extraCopilotRoots.join(",")}`;
}

function waitWithAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("refresh cancelled"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason ?? new Error("refresh cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

function syncEventRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function endedByCmux(agent: AgentSnapshot): AgentSnapshot {
  const {
    attentionClass: _attentionClass,
    attentionSignal: _attentionSignal,
    nextAction: _nextAction,
    ...retained
  } = agent;
  return {
    ...retained,
    status: "archived",
    statusReason: "cmux-closed",
    activity: "ended",
    lifecycle: "finished",
    provenance: "process-died",
    processState: "died",
    outcome: "healthy",
    controlState: "observed-only",
    attention: false,
    controls: agent.controls.map((control) =>
      control.action === "focus" || control.action === "instruct" || control.action === "interrupt"
        ? { ...control, enabled: false, reason: "cmux-closed" }
        : control),
  };
}

async function readBoundedTranscriptTail(
  path: string,
  maxBytes: number,
): Promise<SenderTranscriptEvidence | undefined> {
  const handle = await open(path, "r");
  try {
    const before = await handle.stat();
    const length = Math.min(before.size, Math.max(0, Math.floor(maxBytes)));
    const buffer = Buffer.alloc(length);
    const offset = before.size - length;
    let bytesRead = 0;
    while (bytesRead < length) {
      const read = await handle.read(buffer, bytesRead, length - bytesRead, offset + bytesRead);
      if (read.bytesRead === 0) break;
      bytesRead += read.bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) return undefined;
    return {
      text: buffer.subarray(0, bytesRead).toString("utf8"),
      complete: offset === 0,
    };
  } finally {
    await handle.close();
  }
}

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
  guiRootsReader?: () => readonly string[];
  botRootsReader?: () => readonly string[];
  grokCliRootsReader?: () => readonly string[];
  copilotRootsReader?: () => readonly string[];
  triageReader?: () => readonly TriageQueueSummary[];
  burnReader?: () => Promise<UsageSummary>;
  cmuxExecutable?: string;
  bindingStore?: IdentityBindingStore;
  refreshAggregateTimeoutMs?: number;
  transcriptTailReader?: SenderTranscriptTailReader;
  sessionNames?: JsonSessionNameStore;
  witnessStore?: ProcessWitnessStore;
  ackStore?: AckStore;
  alertSinceStore?: AlertSinceStore;
  /** Injectable so tests can pin a boot without a clock. */
  bootId?: string;
  teamColorsStore?: Pick<JsonTeamColorsStore, "get" | "setCmuxColor" | "expectedEchoes" | "clearExpectedEcho">;
  repoGroupProvenance?: Pick<RepoGroupProvenanceStore, "list">;
}

export class HubState {
  #snapshot: HubSnapshot;
  #pulse: PulseTracker;
  #surfaces: CmuxSurface[] = [];
  #sidebarWorkspaces: CmuxWorkspaceSnapshot[] = [];
  #workspaceEnvs: CmuxWorkspaceEnv[] = [];
  #runManifests: RunManifest[] = [];
  #notifications: CmuxNotification[] = [];
  #cmuxNotifications: CmuxNotificationSummary[] = [];
  #cmuxErrors: string[] = ["cmux discovery has not completed"];
  #cmuxReachable = false;
  #cmuxAbsent = false;
  #sourceAbsent: Partial<Record<Provider, boolean>> = {};
  #spendSources: SpendSource[] = [];
  #cmuxLastCheckedAt = new Date(0).toISOString();
  #liveAgentProcessIds?: number[];
  #recognizedAgentProcessIds?: number[];
  #processStartsByPid?: Map<number, number>;
  /* Whether the last completed scan enumerated everything it needed to. Held
     like #surfaces rather than recomputed per refresh, because a refresh that
     skips cmux has not learned anything new about the process table either. */
  #rosterComplete = false;
  readonly #bootId: string;
  #refreshing?: Promise<HubSnapshot>;
  /* One naming pass at a time; a second refresh while one runs simply skips. */
  #naming?: Promise<void>;
  #refreshStartedAtMs?: number;
  #refreshWatchdogMs?: number;
  /* Which refresh pass is the current one. Only the watchdog below can put two
     passes in flight at once, and when it does, the abandoned one must stop
     writing — see #superseded. */
  #refreshGeneration = 0;
  #refreshAbort?: AbortController;
  #cmuxRequested = false;
  #refreshingCmux = false;
  #cmuxEvents?: CmuxEventsSupervisor;
  #cmuxEventsBootId?: string;
  #cmuxSync?: CmuxSyncSupervisor;
  #unregisterCmuxSync?: () => void;
  #notificationRelistQueued = false;
  #notificationRelistGeneration = 0;
  #listeners = new Set<(snapshot: HubSnapshot) => void>();
  #issueLifecycle = new Map<string, IssueLifecycle>();
  #recentlyResolved: OperatorIssue[] = [];
  #hasSourceSnapshot = false;
  #sourceHealth = Object.fromEntries(PROVIDERS.map((provider) => [
    provider,
    { healthy: false, lastHealthyAt: null },
  ])) as Record<Provider, SourceHealth>;
  #operatorTeams: CmuxTeam[] = [];

  #scanWindowHours = DEFAULT_SCAN_WINDOW_HOURS;
  readonly #providerSettlement = new ProviderSettlementCoordinator<Provider, SessionProviderResult>(
    (result) => result.errors.length === 0,
  );

  private readonly collectors: HubCollectors;
  private readonly settingsReader?: () => HubSettings;
  private readonly guiRootsReader?: () => readonly string[];
  private readonly botRootsReader?: () => readonly string[];
  private readonly grokCliRootsReader?: () => readonly string[];
  private readonly copilotRootsReader?: () => readonly string[];
  private readonly triageReader?: () => readonly TriageQueueSummary[];
  private readonly burnReader?: () => Promise<UsageSummary>;
  private readonly cmuxExecutable: string;
  private readonly bindingStore?: IdentityBindingStore;
  private readonly refreshAggregateTimeoutMs?: number;
  private readonly transcriptTailReader: SenderTranscriptTailReader;
  /* Optional so every existing construction — and the tests are full of them —
     keeps the derived names rather than requiring a naming store. */
  private readonly sessionNames?: JsonSessionNameStore;
  private readonly witnessStore?: ProcessWitnessStore;
  private readonly ackStore: AckStore;
  private readonly alertSinceStore: AlertSinceStore;
  private readonly teamColorsStore?: Pick<JsonTeamColorsStore, "get" | "setCmuxColor" | "expectedEchoes" | "clearExpectedEcho">;
  private readonly repoGroupProvenance?: Pick<RepoGroupProvenanceStore, "list">;

  constructor(
    private readonly runner: CommandRunner,
    private readonly archiveStore: ArchiveStore,
    private readonly programHints: readonly ProgramHint[],
    options: HubStateOptions = {},
  ) {
    this.collectors = options.collectors ?? DEFAULT_COLLECTORS;
    this.settingsReader = options.settingsReader;
    this.guiRootsReader = options.guiRootsReader;
    this.botRootsReader = options.botRootsReader;
    this.grokCliRootsReader = options.grokCliRootsReader;
    this.copilotRootsReader = options.copilotRootsReader;
    this.triageReader = options.triageReader;
    this.burnReader = options.burnReader;
    this.cmuxExecutable = options.cmuxExecutable ?? DEFAULT_CMUX_EXECUTABLE;
    this.bindingStore = options.bindingStore;
    this.refreshAggregateTimeoutMs = options.refreshAggregateTimeoutMs;
    this.transcriptTailReader = options.transcriptTailReader ?? readBoundedTranscriptTail;
    this.sessionNames = options.sessionNames;
    this.witnessStore = options.witnessStore;
    this.ackStore = options.ackStore ?? new MemoryAckStore();
    this.alertSinceStore = options.alertSinceStore ?? new MemoryAlertSinceStore();
    this.teamColorsStore = options.teamColorsStore;
    this.repoGroupProvenance = options.repoGroupProvenance;
    this.#bootId = options.bootId ?? currentBootId(uptime(), Date.now());
    this.#pulse = new PulseTracker(this.burnReader);
    const bootSettings = this.settingsReader?.();
    this.#scanWindowHours = bootSettings?.scanWindowHours ?? DEFAULT_SCAN_WINDOW_HOURS;
    const initialSnapshot = withAttentionClasses(this.#withSourceHealth(buildSnapshot({
      agents: [],
      spendSources: this.#spendSources,
      surfaces: [],
      archiveStore,
      nameTagStore: this.bindingStore,
      programHints,
      cmuxErrors: this.#cmuxErrors,
      cmuxReachable: this.#cmuxReachable,
      cmuxLastCheckedAt: this.#cmuxLastCheckedAt,
      cmuxNotifications: this.#cmuxNotifications,
      acks: this.ackStore.list(),
      issueLifecycle: this.#issueLifecycle,
      recentlyResolved: this.#recentlyResolved,
      triageSummaries: this.triageReader?.(),
      scanWindowHours: this.#scanWindowHours,
      thresholds: bootSettings ? lifecycleThresholds(bootSettings) : undefined,
      stalledActiveMinutes: bootSettings?.stalledActiveMinutes,
    })));
    this.#snapshot = withPulse(initialSnapshot, this.#pulse.report(Date.now()));
  }

  get(): HubSnapshot {
    return this.#snapshot;
  }

  teams(): readonly CmuxTeam[] {
    return this.#operatorTeams;
  }

  surfaces(): readonly CmuxSurface[] {
    return this.#surfaces;
  }

  #quarantineRetainedIdentityEvidence(): void {
    /* Keep the last panes for diagnostics, but withdraw every claim that could
       authorize a control or re-mint process liveness. A failed current scan
       says nothing about whether the old session still owns the pane or
       whether the old PID still names the same process. `#surfaces` also feeds
       durable focus links directly, so quarantining only the published
       snapshot would leave that second route writable. */
    this.#surfaces = this.#surfaces.map((surface) => ({
      ...surface,
      runtimeSurfaceReady: false,
      sourceSessionIds: [],
      /* Provider-qualified claims carry the same authority as legacy IDs, so
         they age out at the same boundary. */
      sourceSessionClaims: [],
      identityConflict: undefined,
      identityTrace: {
        surfaceId: surface.surfaceId,
        ...(surface.tty ? { tty: surface.tty } : {}),
        processes: [],
        openFileMatches: [],
        commandHints: [],
        outcome: "stale-surface",
        sourceSessionIds: [],
      },
    }));
    this.#liveAgentProcessIds = undefined;
    this.#recognizedAgentProcessIds = undefined;
    this.#processStartsByPid = undefined;
  }

  #publishQuarantinedRoutingEvidence(agentIds?: ReadonlySet<string>): void {
    const reason = "Current collection evidence no longer supports this published terminal target; wait for refresh completion.";
    this.#snapshot = {
      ...this.#snapshot,
      controlHealth: {
        ...this.#snapshot.controlHealth,
        cmuxReachable: this.#cmuxReachable,
        lastCheckedAt: this.#cmuxLastCheckedAt,
        errors: [...this.#cmuxErrors],
      },
      programs: this.#snapshot.programs.map((program) => ({
        ...program,
        agents: program.agents.map((agent) =>
          agentIds && !agentIds.has(agent.id)
            ? agent
            : {
                ...agent,
                controlState: "observed-only",
                target: { resolution: "missing", reason },
                controls: agent.controls.map((control) =>
                  control.action === "focus" || control.action === "instruct" || control.action === "interrupt"
                    ? { ...control, enabled: false, reason }
                    : control
                ),
              }
        ),
      })),
    };
    for (const listener of this.#listeners) listener(this.#snapshot);
  }

  #quarantineDisprovedPublishedAuthority(
    agents: readonly CollectedAgent[],
    surfaces: readonly CmuxSurface[],
    options: {
      processRosterComplete: boolean;
      thresholds?: ReturnType<typeof lifecycleThresholds>;
    },
  ): void {
    const currentById = new Map(agents.map((agent) => [agent.id, agent]));
    const invalid = new Set<string>();
    const nowMs = Date.now();
    for (const published of this.#snapshot.programs.flatMap((program) => program.agents)) {
      const enabledTerminalActions = published.controls
        .filter((control) =>
          control.enabled
          && (control.action === "focus" || control.action === "instruct" || control.action === "interrupt")
        )
        .map(({ action }) => action);
      if (enabledTerminalActions.length === 0) continue;
      const current = currentById.get(published.id);
      if (!current) {
        invalid.add(published.id);
        continue;
      }
      const target = resolveAgentTarget(current, surfaces, agents);
      const operatorArchived = this.archiveStore.has(current.id);
      const terminal = lifecycleFor(current, {
        operatorArchived,
        scope: "observed",
        nowMs,
        thresholds: options.thresholds,
        processRosterComplete: options.processRosterComplete,
        persisted: current.lifecycle
          ? { lifecycle: current.lifecycle, provenance: current.provenance }
          : operatorArchived
            ? { lifecycle: "finished", provenance: "operator-archive" }
            : undefined,
      }).lifecycle === "finished";
      const currentControls = new Map(
        controlsFor(
          current,
          target,
          terminal,
          undefined,
          Boolean(this.archiveStore.unarchive) && operatorArchived,
        ).map((control) => [control.action, control.enabled]),
      );
      if (
        target.surfaceId !== published.target.surfaceId
        || enabledTerminalActions.some((action) => currentControls.get(action) !== true)
      ) {
        invalid.add(published.id);
      }
    }
    if (invalid.size > 0) this.#publishQuarantinedRoutingEvidence(invalid);
  }

  subscribe(listener: (snapshot: HubSnapshot) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  startCmuxEvents(runtime: CmuxEventsRuntime = {}): void {
    if (this.#cmuxEvents) return;
    const supervisor = new CmuxEventsSupervisor({
      command: cmuxEventsCommand(this.cmuxExecutable, runtime.cursorFile),
      spawn: runtime.spawn,
      scheduleRestart: runtime.scheduleRestart,
      onFrame: (frame) => this.#refreshFromCmuxEvent(frame),
      onError: (error) => console.error(`[HubState] cmux event subscriber: ${error.message}`),
    });
    this.#cmuxEvents = supervisor;
    supervisor.start();
    /* A test-injected coarse child owns its own fixture stream. Production's
       default start owns both deliberately separate children. */
    if (!runtime.spawn && !runtime.scheduleRestart) this.startCmuxSync();
  }

  stopCmuxEvents(): void {
    const supervisor = this.#cmuxEvents;
    this.#cmuxEvents = undefined;
    supervisor?.stop();
    this.stopCmuxSync();
  }

  startCmuxSync(runtime: CmuxSyncRuntime = {}): void {
    if (this.#cmuxSync) return;
    /* SYNC-E */
    const unregisterWorkspace = registerSyncHandler(
      "workspace.closed",
      (event) => this.#applyCmuxClosedEvent(event),
    );
    const unregisterSurface = registerSyncHandler(
      "surface.closed",
      (event) => this.#applyCmuxClosedEvent(event),
    );
    const unregisterRename = registerSyncHandler(
      "workspace.renamed",
      (event) => this.#applyCmuxRenamedEvent(event),
    );
    const unregisterNotifications = ["notification.created", "notification.read", "notification.removed"]
      .map((name) => registerSyncHandler(name, () => this.#queueNotificationRelist()));
    this.#unregisterCmuxSync = () => {
      unregisterWorkspace();
      unregisterSurface();
      unregisterRename();
      for (const unregister of unregisterNotifications) unregister();
    };
    const supervisor = new CmuxSyncSupervisor({
      executable: this.cmuxExecutable,
      cursorStore: runtime.cursorStore,
      spawn: runtime.spawn,
      scheduleRestart: runtime.scheduleRestart,
      onError: runtime.onError,
      recollect: runtime.recollect ?? (() => this.refresh({ cmux: true }).then(() => undefined)),
    });
    this.#cmuxSync = supervisor;
    supervisor.start();
  }

  stopCmuxSync(): void {
    const supervisor = this.#cmuxSync;
    this.#cmuxSync = undefined;
    this.#notificationRelistGeneration += 1;
    supervisor?.stop();
    this.#unregisterCmuxSync?.();
    this.#unregisterCmuxSync = undefined;
  }

  #queueNotificationRelist(): void {
    if (this.#notificationRelistQueued) return;
    this.#notificationRelistQueued = true;
    queueMicrotask(() => {
      this.#notificationRelistQueued = false;
      if (!this.#cmuxSync) return;
      const generation = ++this.#notificationRelistGeneration;
      void this.#relistNotifications(generation).catch((error) => {
        console.error(`[HubState] cmux notification re-list failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    });
  }

  async #relistNotifications(generation: number): Promise<void> {
    const collector = this.collectors.syncNotifications;
    if (!collector) return;
    const result = await collector(this.runner, this.cmuxExecutable);
    if (generation !== this.#notificationRelistGeneration || !this.#cmuxSync) return;
    if (result.errors.length > 0) throw new Error(result.errors.join("; "));
    this.#cmuxNotifications = [...result.value];
    this.#snapshot = {
      ...this.#snapshot,
      generatedAt: new Date().toISOString(),
      cmuxNotifications: [...this.#cmuxNotifications],
    };
    for (const listener of this.#listeners) listener(this.#snapshot);
  }

  #applyCmuxClosedEvent(event: CmuxSyncEvent): void {
    const params = syncEventRecord(event.payload.params);
    const result = syncEventRecord(event.payload.result);
    const resultWorkspace = syncEventRecord(result?.workspace);
    const resultSurface = syncEventRecord(result?.surface);
    const records = [event.payload, params, result, resultWorkspace, resultSurface];
    const value = (...keys: string[]): string | undefined => {
      for (const record of records) {
        if (!record) continue;
        for (const key of keys) {
          const candidate = record[key];
          if (typeof candidate === "string" && candidate.length > 0) return candidate;
        }
      }
      return undefined;
    };

    const workspaceId = value("workspace_id", "workspaceId");
    const surfaceId = value("surface_id", "surfaceId");
    if (event.name === "surface.closed" && value("origin") === "workspace_teardown") return;
    if (event.name === "workspace.closed") {
      if (!workspaceId) return;
      this.#surfaces = this.#surfaces.filter((surface) => surface.workspaceId !== workspaceId);
    } else if (event.name === "surface.closed") {
      if (!surfaceId) return;
      this.#surfaces = this.#surfaces.filter((surface) => surface.surfaceId !== surfaceId);
    } else {
      return;
    }

    let changed = false;
    const programs = this.#snapshot.programs.map((program) => {
      const agents = program.agents.map((agent) => {
        const matches = event.name === "workspace.closed"
          ? agent.target.workspaceId === workspaceId
          : agent.target.surfaceId === surfaceId;
        if (!matches || agent.lifecycle === "finished" || agent.activity === "ended") return agent;
        changed = true;
        return endedByCmux(agent);
      });
      return agents.some((agent, index) => agent !== program.agents[index])
        ? { ...program, agents, rollup: rollupFor(agents, Date.now(), this.#snapshot.acks ?? []) }
        : program;
    });
    if (!changed) return;

    const allAgents = programs.flatMap((program) => program.agents);
    const observed = allAgents.filter(
      (agent) => agent.scope !== "retained" && agent.sourceFreshness !== "last-known",
    );
    const countLifecycle = (lifecycle: NonNullable<AgentSnapshot["lifecycle"]>): number =>
      observed.filter((agent) => agent.lifecycle === lifecycle).length;
    const next = withAttentionClasses({
      ...this.#snapshot,
      generatedAt: new Date().toISOString(),
      programs,
      totals: {
        ...this.#snapshot.totals,
        live: observed.filter((agent) => isLive(agent, Date.now())).length,
        attention: observed.filter((agent) => agent.attention === true).length
          + (this.#snapshot.unboundWaiting?.length ?? 0),
        working: observed.filter((agent) => agent.activity === "working").length,
        idle: observed.filter((agent) => agent.activity === "idle").length,
        ended: allAgents.filter((agent) => agent.activity === "ended").length,
        byLifecycle: {
          working: countLifecycle("working"),
          waiting: countLifecycle("waiting"),
          unverified: countLifecycle("unverified"),
          finished: countLifecycle("finished"),
        },
        needsYou: observed.filter((agent) =>
          agentIsStripAlerting(agent, this.#snapshot.acks ?? [])).length,
        history: allAgents.filter((agent) => agent.activity === "ended").length,
      },
    });
    const pulseNowMs = Date.now();
    this.#pulse.observe(next, pulseNowMs);
    this.#snapshot = withPulse(next, this.#pulse.report(pulseNowMs));
    for (const listener of this.#listeners) listener(this.#snapshot);
  }

  #applyCmuxRenamedEvent(event: CmuxSyncEvent): void {
    const params = syncEventRecord(event.payload.params);
    const result = syncEventRecord(event.payload.result);
    const resultWorkspace = syncEventRecord(result?.workspace);
    const records = [event.payload, params, result, resultWorkspace];
    const value = (...keys: string[]): string | undefined => {
      for (const source of records) {
        if (!source) continue;
        for (const key of keys) {
          const candidate = source[key];
          if (typeof candidate === "string" && candidate.length > 0) return candidate;
        }
      }
      return undefined;
    };
    const workspaceId = value("workspace_id", "workspaceId", "id");
    const title = value("title", "workspace_title", "workspaceTitle")?.trim();
    if (!workspaceId || !title) return;

    this.#surfaces = this.#surfaces.map((surface) =>
      surface.workspaceId === workspaceId && surface.workspaceTitle !== title
        ? { ...surface, workspaceTitle: title }
        : surface);
    let changed = false;
    const programs = this.#snapshot.programs.map((program) => {
      const agents = program.agents.map((agent) => {
        if (
          agent.target.workspaceId !== workspaceId
          || agent.target.workspaceTitle === title
        ) return agent;
        changed = true;
        return { ...agent, target: { ...agent.target, workspaceTitle: title } };
      });
      return agents.some((agent, index) => agent !== program.agents[index])
        ? { ...program, agents }
        : program;
    });
    if (!changed) return;
    this.#snapshot = {
      ...this.#snapshot,
      generatedAt: new Date().toISOString(),
      programs,
    };
    for (const listener of this.#listeners) listener(this.#snapshot);
  }

  #refreshFromCmuxEvent(frame: CmuxEventFrame): void {
    const bootChanged = this.#cmuxEventsBootId !== undefined
      && frame.bootId !== this.#cmuxEventsBootId;
    this.#cmuxEventsBootId = frame.bootId;
    const fullSnapshot = bootChanged
      || (frame.type === "ack" && frame.resumeGap)
      || (frame.type === "event" && frame.category !== "agent");
    if (!fullSnapshot && frame.type !== "event") return;
    void this.refresh(fullSnapshot ? { cmux: true } : {}).catch((error) => {
      console.error(`[HubState] cmux event refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    });
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
      if (pendingMs <= (this.#refreshWatchdogMs ?? MIN_REFRESH_WATCHDOG_MS)) {
        if (options.cmux && !this.#refreshingCmux) this.#cmuxRequested = true;
        return this.#refreshing;
      }
      console.error(`[HubState] refresh watchdog dropped a pass pending for ${pendingMs}ms`);
      this.#refreshAbort?.abort(new Error("refresh superseded by watchdog"));
      this.#refreshing = undefined;
      this.#refreshAbort = undefined;
      this.#refreshStartedAtMs = undefined;
      this.#refreshWatchdogMs = undefined;
      this.#refreshingCmux = false;
    }
    if (options.cmux) this.#cmuxRequested = true;
    const generation = ++this.#refreshGeneration;
    const abort = new AbortController();
    const refresh = this.#drainRefreshes(generation, abort.signal).finally(() => {
      if (this.#refreshing !== refresh) return;
      this.#refreshing = undefined;
      this.#refreshAbort = undefined;
      this.#refreshStartedAtMs = undefined;
      this.#refreshWatchdogMs = undefined;
    });
    this.#refreshing = refresh;
    this.#refreshAbort = abort;
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

  async #drainRefreshes(generation: number, signal: AbortSignal): Promise<HubSnapshot> {
    let snapshot = this.#snapshot;
    do {
      if (this.#superseded(generation)) return this.#snapshot;
      const cmux = this.#cmuxRequested;
      this.#cmuxRequested = false;
      this.#refreshingCmux = cmux;
      const settings = this.settingsReader?.();
      const providerWaitMs = settings?.providerWaitMs ?? DEFAULT_PROVIDER_WAIT_MS;
      this.#refreshStartedAtMs = Date.now();
      this.#refreshWatchdogMs = Math.max(MIN_REFRESH_WATCHDOG_MS, providerWaitMs + 2_000);
      try {
        snapshot = await this.#performRefresh({ cmux }, generation, providerWaitMs, settings, signal);
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
    /* SDK tasks already name their automation; the out-of-band namer is for
       humans' untitled work sessions. */
    const unnamed = agents.filter((agent) =>
      !store.has(agent.id) && agent.launch?.promptSource !== "sdk"
    );
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

  async #performRefresh(
    options: { cmux?: boolean },
    generation: number,
    providerWaitMs: number,
    settings: HubSettings | undefined,
    signal: AbortSignal,
  ): Promise<HubSnapshot> {
    const cmuxAttemptAt = options.cmux ? new Date().toISOString() : undefined;
    /* From the union, not a second list. This WAS a literal, and the literal
       silently dropped Factory: the collector read its sessions correctly and
       this loop never asked for them, so the board showed zero rows and marked
       the source unhealthy — with a green suite, because nothing tested that
       every collected provider survives the refresh. */
    const providers: Provider[] = [...PROVIDERS];
    this.#scanWindowHours = settings?.scanWindowHours ?? this.#scanWindowHours;
    const windowMs = Math.max(1, this.#scanWindowHours) * 60 * 60 * 1_000 || DEFAULT_SESSION_WINDOW_MS;
    /* Read every refresh, not at construction: a settings POST triggers a
       refresh, and an operator who just widened their quiet threshold should
       see the board reclassify on that refresh rather than at the next
       restart. */
    const thresholds = settings ? lifecycleThresholds(settings) : undefined;
    const extraCursorGuiRoots = this.guiRootsReader?.() ?? [];
    const extraGrokBotRoots = this.botRootsReader?.() ?? [];
    const extraGrokCliRoots = this.grokCliRootsReader?.() ?? [];
    const extraCopilotRoots = this.copilotRootsReader?.() ?? [];
    type SessionsResult = Awaited<ReturnType<HubCollectors["sessions"]>>;
    type SpendSourcesResult = Awaited<ReturnType<typeof collectHermesSpendSources>>;
    type CmuxResult = Awaited<ReturnType<HubCollectors["cmux"]>>;
    type SidebarResult = Awaited<ReturnType<typeof collectCmuxSidebar>>;
    type GroupsResult = Awaited<ReturnType<typeof collectCmuxGroups>>;
    type WorkspaceEnvResult = Awaited<ReturnType<typeof collectCmuxWorkspaceEnvs>>;
    type NotificationsResult = Awaited<ReturnType<HubCollectors["notifications"]>>;
    type SyncNotificationsResult = Awaited<ReturnType<typeof collectCmuxNotificationSummaries>>;
    type IdentityResult = Awaited<ReturnType<HubCollectors["enrichIdentity"]>>;
    let sessionsResult: SessionsResult | undefined;
    let spendSourcesResult: SpendSourcesResult | undefined;
    const providerSettledAtMs: Partial<Record<Provider, number>> = {};
    let lastKnownAgents: CollectedAgent[] = [];
    const lastKnownSourceReasons: Partial<Record<Provider, string>> = {};
    let cmuxResult: CmuxResult | undefined;
    let sidebarResult: SidebarResult | undefined;
    let groupsResult: GroupsResult | undefined;
    let workspaceEnvResult: WorkspaceEnvResult | undefined;
    let runManifestsResult: RunManifest[] | undefined;
    let notificationsResult: NotificationsResult | undefined;
    let syncNotificationsResult: SyncNotificationsResult | undefined;
    let identityResult: IdentityResult | undefined;
    const collectionErrors: string[] = [];
    let controlDeadlineExpired = false;
    /* Which collector actually spent the deadline. Two investigations named a
       culprit from code reading and both dissolved on measurement — the
       transcript walk reads one file, and Cursor's store measures fast while the
       board misses the deadline continuously. The answer has to come off the
       running board.

       What names the guilty collector is `pending`, not `timings`: at the moment
       the deadline fires the slow one has not returned, so it has no duration to
       report. The set of labels still outstanding IS the finding. */
    const passStartedMs = Date.now();
    const timings = new Map<string, number>();
    const pending = new Set<string>();
    const track = async <T>(label: string, work: Promise<T>): Promise<T> => {
      const startedMs = Date.now();
      pending.add(label);
      try {
        return await work;
      } finally {
        pending.delete(label);
        timings.set(label, Date.now() - startedMs);
      }
    };
    const passBreakdown = (): string => {
      const finished = [...timings.entries()]
        .sort(([, a], [, b]) => b - a)
        .map(([label, ms]) => `${label}=${ms}ms`)
        .join(" ");
      /* Sorted so the line is stable enough to diff across passes. */
      const outstanding = [...pending].sort().join(",");
      return `total=${Date.now() - passStartedMs}ms ${finished}`
        + (outstanding ? ` PENDING=[${outstanding}]` : " PENDING=[none]");
    };
    const capture = async <T>(
      label: string,
      work: Promise<T>,
      assign: (value: T) => void,
    ): Promise<void> => {
      try {
        const value = await track(label, work);
        if (!controlDeadlineExpired) assign(value);
      } catch (error) {
        if (!controlDeadlineExpired && !signal.aborted) {
          collectionErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    };
    const providerTimeoutMs = this.refreshAggregateTimeoutMs ?? providerWaitMs;
    const controlTimeoutMs = this.refreshAggregateTimeoutMs
      ?? Math.max(MIN_CONTROL_AGGREGATE_TIMEOUT_MS, providerWaitMs);
    const tailTimeoutMs = Math.min(
      PUBLISHING_TAIL_TIMEOUT_MS,
      this.refreshAggregateTimeoutMs ?? PUBLISHING_TAIL_TIMEOUT_MS,
    );
    let providerDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const providerDeadlineReached = new Promise<void>((resolve) => {
      providerDeadlineTimer = setTimeout(resolve, providerTimeoutMs);
    });
    let controlDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const controlDeadlineReached = new Promise<void>((resolve) => {
      controlDeadlineTimer = setTimeout(() => {
        controlDeadlineExpired = true;
        resolve();
      }, controlTimeoutMs);
    });
    const providerCollection = (this.collectors.sessionProvider && this.collectors.finalizeSessions
      ? track("providers", (async () => {
          const configKey = providerCollectionConfigKey(
            windowMs, thresholds, extraCursorGuiRoots, extraGrokBotRoots, extraGrokCliRoots, extraCopilotRoots,
          );
          const selection = await this.#providerSettlement.settle(
            providers,
            async (provider) => {
              try {
                return await this.collectors.sessionProvider!(
                  provider, homedir(), windowMs, thresholds, { extraCursorGuiRoots, extraGrokBotRoots, extraGrokCliRoots, extraCopilotRoots }, signal,
                );
              } catch (error) {
                return {
                  value: [],
                  errors: [`${provider} collection failed: ${error instanceof Error ? error.message : String(error)}`],
                };
              }
            },
            { waitMs: providerTimeoutMs, configKey, wait: () => providerDeadlineReached },
          );
          Object.assign(providerSettledAtMs, selection.settledAtMs);
          const selected = Object.fromEntries(providers.map((provider) => {
            const current = selection.current[provider];
            if (current) return [provider, current];
            const seconds = providerWaitMs / 1_000;
            const label = `${provider[0]!.toUpperCase()}${provider.slice(1)}`;
            const fallback = selection.lastKnown[provider];
            const hasFallbackRows = (fallback?.value.length ?? 0) > 0;
            const reason = `${label} collection exceeded the ${seconds}s provider wait; `
              + (hasFallbackRows ? `showing last-known ${label} sessions.` : `no last-known ${label} sessions are available.`);
            if (hasFallbackRows) lastKnownSourceReasons[provider] = reason;
            return [provider, { value: [], errors: [reason] }];
          })) as SessionProviderResults;
          try {
            sessionsResult = this.collectors.finalizeSessions!(selected, homedir());
            lastKnownAgents = providers.flatMap((provider) => selection.lastKnown[provider]?.value ?? []);
          } catch (error) {
            collectionErrors.push(
              `session collection failed: provider fleet finalization failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        })())
      : capture("session collection failed", this.collectors.sessions(homedir(), windowMs, thresholds, { extraCursorGuiRoots, extraGrokBotRoots, extraGrokCliRoots, extraCopilotRoots }, signal), (value) => {
          sessionsResult = value;
        })).catch((error) => {
          if (!signal.aborted) {
            collectionErrors.push(
              `session collection failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        });
    let aggregateSettled = false;
    const aggregate = Promise.all([
      providerCollection,
      ...(this.collectors.spendSources
        ? [capture(
            "Hermes spend collection failed",
            this.collectors.spendSources(homedir()),
            (value) => {
              spendSourcesResult = value;
            },
          )]
        : []),
      ...(options.cmux
        ? [
            capture("cmux discovery failed", this.collectors.cmux(this.runner, this.cmuxExecutable, signal), (value) => {
              cmuxResult = value;
            }),
            ...(this.collectors.sidebar
              ? [capture(
                  "cmux sidebar discovery failed",
                  this.collectors.sidebar(this.runner, this.cmuxExecutable, {
                    deadlineMs: controlTimeoutMs,
                    signal,
                  }),
                  (value) => {
                    sidebarResult = value;
                  },
                )]
              : []),
            ...(this.collectors.groups
              ? [capture(
                  "cmux group discovery failed",
                  this.collectors.groups(this.runner, this.cmuxExecutable, {
                    deadlineMs: controlTimeoutMs,
                    signal,
                  }),
                  (value) => {
                    groupsResult = value;
                  },
                )]
              : []),
            ...(this.collectors.manifests
              ? [capture(
                  "run manifest discovery failed",
                  Promise.resolve().then(() => this.collectors.manifests!()),
                  (value) => {
                    runManifestsResult = value;
                  },
                )]
              : []),
            capture(
              "cmux notification collection failed",
              this.collectors.notifications(this.runner, this.cmuxExecutable, undefined, signal),
              (value) => {
                notificationsResult = value;
              },
            ),
            ...(this.collectors.syncNotifications
              ? [capture(
                  "cmux sync notification collection failed",
                  this.collectors.syncNotifications(this.runner, this.cmuxExecutable, {
                    deadlineMs: controlTimeoutMs,
                    signal,
                  }),
                  (value) => {
                    syncNotificationsResult = value;
                  },
                )]
              : []),
          ]
        : []),
    ]).then(async () => {
      if (signal.aborted) return;
      const agents = sessionsResult
        ? providers.flatMap((provider) => sessionsResult![provider].value)
        : [];
      if (options.cmux && cmuxResult?.errors.length === 0) {
        const workspaceIds = [...new Set(cmuxResult.value.flatMap((surface) =>
          surface.workspaceId ? [surface.workspaceId] : []))];
        await Promise.all([
          capture(
            "cmux identity enrichment failed",
            this.collectors.enrichIdentity(cmuxResult.value, agents, this.runner, signal),
            (value) => {
              identityResult = value;
            },
          ),
          ...(this.collectors.workspaceEnv
            ? [capture(
                "cmux workspace env discovery failed",
                this.collectors.workspaceEnv(this.runner, workspaceIds, this.cmuxExecutable),
                (value) => {
                  workspaceEnvResult = value;
                },
              )]
            : []),
        ]);
        /* TINT-G: mirror the board's repo grouping into the cmux sidebar. Rides
           this poll rather than a timer of its own (locked decision 3), and is
           fire-and-forget like the naming pass — a sidebar is an improvement on
           a board that already works, so it must never delay or fail a refresh.
           A no-op until TINT-F registers the repo assignments. */
        if (!signal.aborted) void repoGroupReconcileTick(this.runner, this.cmuxExecutable);
      }
      aggregateSettled = true;
    });
    try {
      await Promise.race([
        waitWithAbort(aggregate, signal),
        controlDeadlineReached,
      ]);
    } catch (error) {
      if (providerDeadlineTimer) clearTimeout(providerDeadlineTimer);
      if (controlDeadlineTimer) clearTimeout(controlDeadlineTimer);
      if (signal.aborted) return this.#snapshot;
      throw error;
    }
    if (this.collectors.sessionProvider && this.collectors.finalizeSessions) {
      /* Coordinator settlement is independently bounded by the earlier
         provider deadline, which is never longer than this control deadline.
         Awaiting it here therefore cannot turn a hung provider into an
         unbounded control pass; it only lets the selected fleet finalizer run. */
      try {
        await waitWithAbort(providerCollection, signal);
      } catch (error) {
        if (providerDeadlineTimer) clearTimeout(providerDeadlineTimer);
        if (controlDeadlineTimer) clearTimeout(controlDeadlineTimer);
        if (signal.aborted) return this.#snapshot;
        throw error;
      }
      /* Let the aggregate's completion continuation run when providers were
         the only work. A provider timeout is already reported by that source;
         it is not also an aggregate failure. */
      await Promise.resolve();
    }
    if (providerDeadlineTimer) clearTimeout(providerDeadlineTimer);
    if (aggregateSettled && controlDeadlineTimer) clearTimeout(controlDeadlineTimer);
    /* Collection is done; from here every line writes. If the watchdog gave up
       on this pass while it was collecting, stop before the first write. */
    if (signal.aborted || this.#superseded(generation)) return this.#snapshot;
    const deadlineError = `collector aggregate exceeded ${controlTimeoutMs}ms deadline`;
    if (!aggregateSettled) {
      collectionErrors.push(deadlineError);
      console.error(`[HubState] ${deadlineError}; publishing partial snapshot`);
      /* Only on a miss. A healthy pass says nothing, so this cannot become the
         next wall of noise the last one hid behind. */
      console.error(`[HubState] pass timings: ${passBreakdown()}`);
    }
    type TailStepResult<T> = { completed: true; value: T } | { completed: false };
    const tailPending = new Set<string>();
    let tailDeadlineExpired = false;
    let tailOverrunLogged = false;
    let tailDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let resolveTailDeadline!: () => void;
    const tailDeadline = Symbol("tail deadline");
    const tailAborted = Symbol("tail aborted");
    const tailDeadlineReached = new Promise<void>((resolve) => {
      resolveTailDeadline = resolve;
      tailDeadlineTimer = setTimeout(() => {
        tailDeadlineExpired = true;
        resolve();
      }, tailTimeoutMs);
    });
    let removeTailAbortListener = (): void => {};
    const tailAbortReached = new Promise<typeof tailAborted>((resolve) => {
      const onAbort = (): void => resolve(tailAborted);
      signal.addEventListener("abort", onAbort, { once: true });
      removeTailAbortListener = () => signal.removeEventListener("abort", onAbort);
    });
    const clearTailDeadline = (): void => {
      if (tailDeadlineTimer) clearTimeout(tailDeadlineTimer);
      removeTailAbortListener();
      resolveTailDeadline();
    };
    const logTailOverrun = (): void => {
      if (tailOverrunLogged) return;
      tailOverrunLogged = true;
      const outstanding = [...tailPending].sort().join(",");
      console.error(
        `[HubState] publishing tail exceeded ${tailTimeoutMs}ms deadline; `
          + `PENDING=[${outstanding || "none"}]`,
      );
    };
    const tailStep = async <T>(
      label: string,
      work: () => Promise<T>,
    ): Promise<TailStepResult<T>> => {
      if (signal.aborted) return { completed: false };
      tailPending.add(label);
      if (tailDeadlineExpired) {
        logTailOverrun();
        tailPending.delete(label);
        return { completed: false };
      }
      let promise: Promise<T>;
      try {
        promise = work();
      } catch (error) {
        tailPending.delete(label);
        throw error;
      }
      try {
        const outcome = await Promise.race([
          promise,
          tailDeadlineReached.then(() => tailDeadline),
          tailAbortReached,
        ]);
        if (outcome === tailDeadline) {
          logTailOverrun();
          return { completed: false };
        }
        if (outcome === tailAborted) {
          clearTailDeadline();
          return { completed: false };
        }
        return { completed: true, value: outcome as T };
      } finally {
        tailPending.delete(label);
      }
    };
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
      return Object.fromEntries(PROVIDERS.map((provider): [Provider, SessionProviderResult] => [
        provider,
        { value: [], errors: [reason] },
      ])) as SessionProviderResults;
    };
    const sessions = sessionsResult ?? unavailableSessions();
    const spendSourceErrors = this.collectors.spendSources
      ? spendSourcesResult?.errors ?? [reasonFor("Hermes spend collection failed")]
      : [];
    const sessionCollectionComplete = sessionsResult !== undefined
      && providers.every((provider) => sessions[provider].errors.length === 0);
    const cmux = options.cmux
      ? cmuxResult ?? { value: [], errors: [reasonFor("cmux discovery failed")] }
      : undefined;
    const sidebar = options.cmux && this.collectors.sidebar
      ? sidebarResult ?? { value: [], errors: [reasonFor("cmux sidebar discovery failed")] }
      : undefined;
    const groups = options.cmux && this.collectors.groups
      ? groupsResult ?? { value: [] as CmuxWindowGroups[], errors: [reasonFor("cmux group discovery failed")] }
      : undefined;
    const workspaceEnv = options.cmux && this.collectors.workspaceEnv
      ? workspaceEnvResult ?? { value: [], errors: [reasonFor("cmux workspace env discovery failed")] }
      : undefined;
    const notifications = options.cmux
      ? notificationsResult ?? { value: [], errors: [reasonFor("cmux notification collection failed")] }
      : undefined;
    const syncNotifications = options.cmux && this.collectors.syncNotifications
      ? syncNotificationsResult ?? { value: [], errors: [reasonFor("cmux sync notification collection failed")] }
      : undefined;
    const collectedAt = new Date().toISOString();
    for (const provider of providers) {
      const source = sessions[provider];
      const providerErrors = provider === "hermes"
        ? [...source.errors, ...spendSourceErrors]
        : source.errors;
      this.#sourceHealth[provider] = providerErrors.length === 0
        ? source.absent === true
          ? {
              healthy: false,
              absent: true,
              lastHealthyAt: this.#sourceHealth[provider].lastHealthyAt,
            }
          : {
              healthy: true,
              lastHealthyAt: providerSettledAtMs[provider] === undefined
                ? collectedAt
                : new Date(providerSettledAtMs[provider]!).toISOString(),
            }
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
      let routingEvidenceQuarantined = false;
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
          this.#recognizedAgentProcessIds = identityResult.recognizedAgentProcessIds
            ? [...identityResult.recognizedAgentProcessIds]
            : undefined;
          this.#processStartsByPid = identityResult.processStarts
            ? new Map(Object.entries(identityResult.processStarts).map(([pid, start]) => [Number(pid), start]))
            : undefined;
          this.#rosterComplete = identityResult.rosterComplete === true;
          identityErrors = identityResult.errors;
          const currentAuthorityAgents = this.bindingStore
            ? bridgeAgentsWithBindings(
                this.bindingStore,
                collectedAgents,
                this.#surfaces,
                this.#liveAgentProcessIds,
                this.#recognizedAgentProcessIds,
                this.#processStartsByPid,
              )
            : collectedAgents;
          this.#quarantineDisprovedPublishedAuthority(currentAuthorityAgents, this.#surfaces, {
            processRosterComplete: this.#rosterComplete,
            thresholds,
          });
          // Only completed identity scans confirm bindings; a failed write is
          // an operator-visible error, never a silent skip or broken refresh.
          if (this.bindingStore) {
            const bindingWrite = await tailStep(
              "identity binding persistence",
              () => updateBindingsFromScan(this.bindingStore!, this.#surfaces, collectedAt),
            );
            bindingErrors = bindingWrite.completed ? bindingWrite.value.errors : [];
          }
        } else if (cmux.errors.length === 0) {
          identityErrors = [
            collectionErrors.find((error) => error.startsWith("cmux identity enrichment failed")) ?? deadlineError,
          ];
          this.#quarantineRetainedIdentityEvidence();
          routingEvidenceQuarantined = true;
        }
        if (signal.aborted || this.#superseded(generation)) {
          clearTailDeadline();
          return this.#snapshot;
        }
      } else {
        this.#quarantineRetainedIdentityEvidence();
        routingEvidenceQuarantined = true;
      }
      if (notifications && notifications.errors.length === 0) {
        this.#notifications = notifications.value;
      }
      if (syncNotifications && syncNotifications.errors.length === 0) {
        this.#cmuxNotifications = syncNotifications.value;
      }
      if (sidebar && sidebar.errors.length === 0) {
        this.#sidebarWorkspaces = sidebar.value;
      }
      /* A total miss must not wipe last-good teams: TINT-S still runs when
         surfaces collected, and an empty index re-asserts the repo hex. */
      const teamSettings = this.teamColorsStore?.get() ?? { assignments: {} };
      if (groups && !(groups.errors.length > 0 && groups.value.length === 0)) {
        if (this.teamColorsStore) {
          for (const window of groups.value) {
            for (const group of window.groups) {
              const liveHex = normalizeHex(group.customColor);
              const expected = this.teamColorsStore.expectedEchoes().get(group.id);
              if (liveHex && expected && liveHex === normalizeHex(expected)) {
                this.teamColorsStore.clearExpectedEcho(group.id);
              }
            }
          }
        }
        const resolved = resolveOperatorTeams(
          groups.value,
          new Set((this.repoGroupProvenance?.list() ?? []).map((record) => record.groupId)),
          teamSettings,
          this.teamColorsStore?.expectedEchoes() ?? new Map(),
        );
        this.#operatorTeams = resolved.teams;
        if (this.teamColorsStore) {
          for (const row of resolved.ingested) {
            try {
              await this.teamColorsStore.setCmuxColor(row.groupId, row.hex);
            } catch (error) {
              console.error(
                `[HubState] team color ingest persist failed for ${row.groupId}: `
                  + (error instanceof Error ? error.message : String(error)),
              );
            }
          }
        }
      } else if (!groups) {
        this.#operatorTeams = [];
      }
      if (workspaceEnv && workspaceEnv.errors.length === 0) {
        this.#workspaceEnvs = workspaceEnv.value;
      }
      if (runManifestsResult) {
        this.#runManifests = runManifestsResult;
      }
      /* TINT-S */ if (this.#cmuxReachable) {
        const storedAfter = this.teamColorsStore?.get() ?? teamSettings;
        const teamByWorkspaceId = new Map(
          [...indexTeamsByWorkspace(this.#operatorTeams)].map(([workspaceId, team]) => [
            workspaceId,
            {
              id: team.id,
              hex: team.hex,
              hexSource: storedAfter.assignments[team.id]?.source ?? "auto",
            },
          ]),
        );
        void syncCmuxColors({
          runner: this.runner,
          executable: this.cmuxExecutable,
          surfaces: this.#surfaces,
          settings,
          teamByWorkspaceId,
        });
      }
      this.#cmuxErrors = [...new Set([
        ...cmux.errors,
        ...(sidebar?.errors ?? []),
        ...(groups?.errors ?? []),
        ...(workspaceEnv?.errors ?? []),
        ...(notifications?.errors ?? []),
        ...(syncNotifications?.errors ?? []),
        ...identityErrors,
        ...bindingErrors,
        ...collectionErrors,
      ])];
      if (routingEvidenceQuarantined) this.#publishQuarantinedRoutingEvidence();
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
          this.#recognizedAgentProcessIds,
          this.#processStartsByPid,
        )
      : collectedAgents;
    /* Then the persisted witnesses, for sessions this scan found nothing about.
       After the bridge so a live observation always wins, and before both the
       history write and the snapshot so the record and the board agree. */
    const publishedAgents = this.witnessStore
      ? applyProcessWitness(bridgedAgents, this.witnessStore, this.#bootId)
      : bridgedAgents;
    this.#quarantineDisprovedPublishedAuthority(publishedAgents, this.#surfaces, {
      processRosterComplete: this.#rosterComplete,
      thresholds,
    });
    const transcriptSources = [...(this.archiveStore.archivedAgents?.() ?? []), ...publishedAgents];
    const senderTranscriptTailsPromise = transcriptSources.some((source) => senderClaimFor(source))
      ? tailStep(
          "sender transcript tails",
          () => senderTranscriptTailsFor(transcriptSources, this.transcriptTailReader),
        )
      : undefined;
    if (this.witnessStore && this.#rosterComplete) {
      /* Only a completed scan may write witnesses: a partial one would record
         "nothing was running" for sessions it simply never looked at, and that
      lie would then outlive the restart it was meant to survive. */
      try {
        await tailStep(
          "process witness persistence",
          () => this.witnessStore!.record(witnessesFromScan(publishedAgents, this.#bootId, collectedAt)),
        );
      } catch (error) {
        console.error(`[HubState] process witness persistence failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    try {
      if (this.archiveStore.record) {
        await tailStep(
          "session history persistence",
          () => this.archiveStore.record!(publishedAgents),
        );
      }
    } catch (error) {
      historyError = `session history persistence failed: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[HubState] ${historyError}`);
    }
    const senderTranscriptTailsResult = senderTranscriptTailsPromise
      ? await senderTranscriptTailsPromise
      : undefined;
    const senderTranscriptTails = senderTranscriptTailsResult?.completed
      ? senderTranscriptTailsResult.value
      : senderTranscriptTailsResult === undefined ? new Map<string, SenderTranscriptEvidence>() : undefined;
    const sourceErrors = Object.fromEntries(
      providers.map((provider) => [
        provider,
        [...new Set([
          ...sessions[provider].errors,
          ...(provider === "hermes" ? spendSourceErrors : []),
          ...(!sessionsResult ? collectionErrors : []),
          ...(historyError ? [historyError] : []),
        ])],
      ]),
    ) as Record<Provider, string[]>;
    /* The witness, archive and bounded transcript reads above are the last
       awaits before this pass publishes. A pass superseded during them would
       otherwise replace a newer board with readings taken before it. */
    if (signal.aborted || this.#superseded(generation)) {
      clearTailDeadline();
      return this.#snapshot;
    }
    this.#sourceAbsent = Object.fromEntries(
      providers.map((provider) => [provider, sessions[provider].absent === true]),
    ) as Record<Provider, boolean>;
    this.#spendSources = spendSourcesResult?.value ?? [];
    const built = this.#withSourceHealth(buildSnapshot({
      agents: publishedAgents,
      spendSources: this.#spendSources,
      lastKnownAgents,
      lastKnownSourceReasons,
      surfaces: this.#surfaces,
      workspaceEnvs: this.#workspaceEnvs,
      sidebarWorkspaces: this.#sidebarWorkspaces,
      runManifests: this.#runManifests,
      notifications: this.#notifications,
      cmuxNotifications: this.#cmuxNotifications,
      acks: this.ackStore.list(),
      programHints: this.programHints,
      sourceErrors,
      sourceAbsent: this.#sourceAbsent,
      cmuxAbsent: this.#cmuxAbsent,
      cmuxErrors: this.#cmuxErrors,
      cmuxReachable: this.#cmuxReachable,
      cmuxLastCheckedAt: this.#cmuxLastCheckedAt,
      archiveStore: this.archiveStore,
      nameTagStore: this.bindingStore,
      sessionNames: this.sessionNames ? (id) => this.sessionNames!.get(id) : undefined,
      issueLifecycle: this.#issueLifecycle,
      previousIssues: this.#hasSourceSnapshot ? this.#snapshot.issues : undefined,
      recentlyResolved: this.#recentlyResolved,
      triageSummaries: this.triageReader?.(),
      scanWindowHours: this.#scanWindowHours,
      sessionCollectionComplete,
      thresholds,
      stalledActiveMinutes: settings?.stalledActiveMinutes,
      processRosterComplete: this.#rosterComplete,
      senderTranscriptTails,
    }));
    const teamProvenanceIds = new Set(
      (this.repoGroupProvenance?.list() ?? []).map((record) => record.groupId),
    );
    const teamSettings = this.teamColorsStore?.get() ?? { assignments: {} };
    const teamed = {
      ...built,
      programs: built.programs.map((program) => ({
        ...program,
        agents: attachTeams(program.agents, this.#operatorTeams, teamProvenanceIds, teamSettings),
      })),
    };
    this.#hasSourceSnapshot = true;
    this.#recentlyResolved = [...(teamed.recentlyResolved ?? [])];
    const nextLifecycle = new Map<string, IssueLifecycle>();
    for (const issue of [...(teamed.issues ?? []), ...this.#recentlyResolved]) {
      if (issue.lifecycle) nextLifecycle.set(issue.id, issue.lifecycle);
    }
    this.#issueLifecycle = nextLifecycle;
    const classified = withAttentionClasses(teamed);
    const currentAlerts = new Map<string, string>();
    for (const agent of classified.programs.flatMap((program) => program.agents)) {
      const fingerprint = alertFingerprintFor(agent);
      if (fingerprint) currentAlerts.set(agent.id, fingerprint);
    }
    await tailStep(
      "acknowledgement reconciliation",
      () => this.ackStore.reconcile(currentAlerts),
    );
    await tailStep(
      "alert-since observation",
      () => this.alertSinceStore.observe(currentAlerts),
    );
    if (signal.aborted || this.#superseded(generation)) {
      clearTailDeadline();
      return this.#snapshot;
    }
    const alertSinceOf = (id: string) => this.alertSinceStore.get(id);
    const programs = classified.programs.map((program) => ({
      ...program,
      agents: program.agents.map((agent) => {
        const alertSince = alertSinceOf(agent.id);
        return alertSince ? { ...agent, alertSince } : agent;
      }),
    }));
    const published = { ...classified, programs, acks: [...this.ackStore.list()] };
    const pulseNowMs = Date.now();
    this.#pulse.observe(published, pulseNowMs);
    this.#pulse.maybeRefreshBurnCost();
    this.#snapshot = withPulse(published, this.#pulse.report(pulseNowMs));
    for (const listener of this.#listeners) listener(this.#snapshot);
    this.#nameNewSessions(publishedAgents);
    clearTailDeadline();
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
