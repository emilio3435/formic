import type {
  AgentSnapshot,
  HubPulse,
  HubSnapshot,
  IdentityTrace,
  IssueLifecycle,
  IssueWorkState,
  OperatorIssue,
  ProgramSnapshot,
  Provider,
  TriageQueueSummary,
} from "../shared/types";
import { PROVIDERS } from "../shared/types";
import { MODEL_CONFIG } from "./model-config";
import { resolveAgentTarget, resolveAgentTargetWithTrace, transmitRefusal, type TransmitRefusal } from "./targets";
import { lifecycleIssues, withIssueDecoration } from "./snapshot-issues";
import { emptyAttentionCoverage, recordAttention } from "./attention-signal";
import {
  buildOperatorIssues,
  classifyIdentityConflicts,
  controlDebrisFor,
} from "./snapshot-operator-issues";
import { agentSortRank, programFor, rollupFor, type ProgramHint } from "./snapshot-programs";
/* Re-exported so the program-resolution move stays invisible to callers:
   state.ts imports ProgramHint from "./snapshot". */
export type { ProgramHint } from "./snapshot-programs";
/* Re-exported so the issue-lifecycle move stays invisible to callers:
   state.ts and the snapshot tests import these from "./snapshot". */
export {
  MAX_RECENTLY_RESOLVED,
  impactSummaryFor,
  issueWorkStateFor,
  withIssueDecoration,
} from "./snapshot-issues";
import {
  activityFor,
  contextPctFor,
  controlsFor,
  cursorModelPolicy,
  effortFor,
  operatorControlState,
  outcomeFor,
  processStateFor,
  roleFor,
} from "./snapshot-agent";
import {
  MAX_TRANSCRIPT_TAIL_CHARS,
  type ArchiveStore,
  type CmuxNotification,
  type CmuxSurface,
  type CollectedAgent,
} from "./types";

export interface SnapshotInput {
  agents: readonly CollectedAgent[];
  surfaces: readonly CmuxSurface[];
  notifications?: readonly CmuxNotification[];
  programHints?: readonly ProgramHint[];
  sourceErrors?: Partial<Record<Provider, readonly string[]>>;
  /* Providers with nothing installed to read. Absent is not a fault: it is the
     ordinary state of a machine whose owner does not use that tool. */
  sourceAbsent?: Partial<Record<Provider, boolean>>;
  cmuxAbsent?: boolean;
  cmuxErrors?: readonly string[];
  cmuxReachable?: boolean;
  cmuxLastCheckedAt?: string;
  archiveStore: ArchiveStore;
  issueLifecycle?: ReadonlyMap<string, IssueLifecycle>;
  previousIssues?: readonly OperatorIssue[];
  recentlyResolved?: readonly OperatorIssue[];
  triageSummaries?: readonly TriageQueueSummary[];
  now?: Date;
  scanWindowHours?: number;
}

type SnapshotControlRefusal = Omit<TransmitRefusal, "message">;
type AgentSnapshotWithControlRefusal = AgentSnapshot & { controlRefusal?: SnapshotControlRefusal };

export function withPulse(snapshot: HubSnapshot, pulse: HubPulse): HubSnapshot {
  return { ...snapshot, pulse };
}

export function buildSnapshot(input: SnapshotInput): HubSnapshot {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const programs = new Map<string, ProgramSnapshot>();
  const newestById = new Map<string, CollectedAgent>();
  const archivedAgents = input.archiveStore.archivedAgents?.() ?? [];
  for (const agent of [...archivedAgents, ...input.agents]) {
    const existing = newestById.get(agent.id);
    if (!existing || agent.updatedAt >= existing.updatedAt) newestById.set(agent.id, agent);
  }

  const attentionCoverage = emptyAttentionCoverage();
  const sources = [...newestById.values()];
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const childCounts = new Map<string, number>();
  for (const source of sources) {
    if (!source.parentSourceSessionId) continue;
    const parentId = `${source.provider}:${source.parentSourceSessionId}`;
    childCounts.set(parentId, (childCounts.get(parentId) ?? 0) + 1);
  }
  for (const source of sources) {
    const archived = input.archiveStore.has(source.id) || source.status === "archived";
    const target = resolveAgentTarget(source, input.surfaces, sources);
    let identityTrace: IdentityTrace | undefined;
    const readIdentityTrace = (): IdentityTrace => {
      identityTrace ??= resolveAgentTargetWithTrace(source, input.surfaces, sources).trace;
      return identityTrace;
    };
    const surface = target.surfaceId
      ? input.surfaces.find((candidate) => candidate.surfaceId === target.surfaceId)
      : undefined;
    const notification = target.surfaceId
      ? [...(input.notifications ?? [])]
          .filter((candidate) => {
            if (candidate.surfaceId !== target.surfaceId) return false;
            const startedAtMs = source.startedAt ? Date.parse(source.startedAt) : Number.NaN;
            if (!Number.isFinite(startedAtMs)) return true;
            /* A notification whose time would not parse is kept. It cannot be
               proven older than the session, and dropping it here would restore
               the silence the parser stopped inventing: an agent asking for a
               human, suppressed because its clock was unreadable. */
            if (candidate.createdAt === undefined) return true;
            const notificationAtMs = Date.parse(candidate.createdAt);
            return Number.isFinite(notificationAtMs) && notificationAtMs >= startedAtMs;
          })
          // Newest first; an unknown time sorts last so a dated notification is
          // preferred when both exist, without discarding the undated one.
          .sort((left, right) =>
            (right.createdAt ?? "").localeCompare(left.createdAt ?? ""))[0]
      : undefined;
    // Only let the cmux pane own program grouping when the session cwd agrees.
    // Otherwise a home-cwd orchestrator in a project-titled workspace gets filed
    // under the wrong program (the bug that made "Settings UX" look like Home).
    const program = programFor(
      source,
      input.programHints ?? [],
      surface,
      target.resolution === "exact" && !target.cwdMismatch,
    );
    const notificationSummary = notification
      ? [notification.title, notification.subtitle, notification.body].filter(Boolean).join(" — ").slice(0, 500)
      : undefined;
    const updatedAtMs = Date.parse(source.updatedAt);
    const activity = activityFor(source, archived);
    const processState = processStateFor(source);
    const initialRefusal = transmitRefusal({ target, processState, archived });
    const refusal = initialRefusal?.code === "UNSAFE_TARGET"
      ? transmitRefusal({ target, processState, archived, identityTrace: readIdentityTrace() })
      : initialRefusal;
    /* Ended rows already explain their terminal state and have no action to
       recover. Shipping routing evidence on every history row added the same
       three observations hundreds of times to a snapshot already over its SSE
       budget. Keep the actionable shape on the live board; history can still
       fetch the full identity trace on demand. */
    const controlRefusal: SnapshotControlRefusal | undefined = activity !== "ended" && refusal
      ? (({ message: _message, ...published }) => published)(refusal)
      : undefined;
    // Freeze the elapsed clock only for a session that really ended. This used
    // to re-derive `archived || status === "stale"` independently of
    // activityFor, so a live-but-quiet session had its clock frozen by the same
    // inference that mislabelled it — one verdict, read in two places.
    const ended = activity === "ended";
    const elapsedEndMs = ended && Number.isFinite(updatedAtMs) ? Math.min(nowMs, updatedAtMs) : nowMs;
    const outcome = outcomeFor(source, archived, Boolean(notification));
    const controlState = operatorControlState(target, archived || activity === "ended");
    const contextPct = contextPctFor(source);
    const snapshotStatusReason = archived
      ? "Archived by source or operator."
      : notificationSummary
        ? `Unread cmux notification: ${notificationSummary}`
        : source.statusReason;
    /* `callSizes` is server-side evidence, not board content. Stripped HERE, at
       the one point a CollectedAgent becomes an AgentSnapshot, so there is a
       single boundary to test rather than a rule to remember: the snapshot is
       already 2.23MB against a 2MB SSE backlog budget, and the largest session
       on this machine has 1,575 calls. It is served on demand from
       /api/debug/session-calls, where the cost is paid by whoever asks. */
    const { callSizes: _callSizes, ...publishable } = source;
    const agent: AgentSnapshotWithControlRefusal = {
      ...publishable,
      programId: program.id,
      status: archived ? "archived" : notification ? "attention" : source.status,
      statusReason: snapshotStatusReason,
      activity,
      processState,
      outcome,
      controlState,
      role: roleFor(source, (childCounts.get(source.id) ?? 0) > 0),
      effort: effortFor(source),
      ...(contextPct === undefined ? {} : { contextPct }),
      ...recordAttention(attentionCoverage, {
        transcriptTail: source.transcriptTail,
        // Straight from cmux, never recovered from the rendered marker: an agent
        // that writes "[Attention] …" into its own transcript must not be able
        // to report itself as blocked on a permission prompt.
        attentionNotification: notification?.body,
        lastAgentMessage: source.lastAgentMessage,
        lastAgentClosing: source.lastAgentClosing,
        activity,
        processState,
        transcriptEndedCleanly: source.transcriptEndedCleanly,
      }, outcome, controlState),
      modelPolicy: cursorModelPolicy(source, sourcesById),
      parentAgentId: source.parentSourceSessionId
        ? `${source.provider}:${source.parentSourceSessionId}`
        : undefined,
      threadDepth: source.threadDepth,
      nickname: source.nickname,
      lastUserMessage: source.lastUserMessage,
      lastAgentMessage: source.lastAgentMessage,
      lastAgentClosing: source.lastAgentClosing,
      lastHumanMessage: source.lastHumanMessage !== undefined
        ? source.lastHumanMessage === source.statusReason
          ? snapshotStatusReason
          : source.lastHumanMessage
        : source.task ?? source.statusReason ?? null,
      transcriptTail: notification?.body
        ? `${source.transcriptTail ? `${source.transcriptTail}\n\n` : ""}[Attention] ${notification.body}`.slice(-MAX_TRANSCRIPT_TAIL_CHARS)
        : source.transcriptTail,
      elapsedMs: source.startedAt ? Math.max(0, elapsedEndMs - Date.parse(source.startedAt)) : undefined,
      ...(source.activeMs === undefined ? {} : { activeMs: source.activeMs }),
      git: surface
        ? { branch: surface.branch, dirty: surface.dirty, head: surface.head }
        : undefined,
      target,
      controls: controlsFor(source, target, archived, identityTrace),
      ...(controlRefusal ? { controlRefusal } : {}),
    };
    Object.defineProperty(agent, "identityTrace", {
      configurable: false,
      enumerable: false,
      get: readIdentityTrace,
    });
    const group = programs.get(program.id) ?? { ...program, agents: [] };
    group.agents.push(agent);
    programs.set(program.id, group);
  }

  const orderedPrograms = [...programs.values()]
    .map((program) => ({
      ...program,
      agents: program.agents.sort((left, right) =>
        agentSortRank(left) - agentSortRank(right) || right.updatedAt.localeCompare(left.updatedAt),
      ),
    }))
    .map((program) => ({ ...program, rollup: rollupFor(program.agents) }))
    .sort((left, right) =>
      (right.rollup.needsYou - left.rollup.needsYou) ||
      (right.rollup.working - left.rollup.working) ||
      left.name.localeCompare(right.name),
    );
  const allAgents = orderedPrograms.flatMap((program) => program.agents);
  const liveAgents = allAgents.filter((agent) => agent.activity === "working" || agent.activity === "idle");
  const workingAgents = allAgents.filter((agent) => agent.activity === "working");
  const tokenValues = workingAgents
    .map((agent) => agent.tokens.total)
    .filter((value): value is number => typeof value === "number")
    .sort((left, right) => left - right);
  const tokenMedian = tokenValues.length === 0
    ? undefined
    : tokenValues.length % 2 === 1
      ? tokenValues[(tokenValues.length - 1) / 2]
      : Math.round((tokenValues[tokenValues.length / 2 - 1]! + tokenValues[tokenValues.length / 2]!) / 2);
  const contextValues = liveAgents
    .map((agent) => agent.contextPct)
    .filter((value): value is number => typeof value === "number")
    .sort((left, right) => left - right);
  const contextPeak = contextValues.length === 0 ? undefined : contextValues[contextValues.length - 1];
  /* Coverage for contextPeak, from the SAME array it is taken from.

     The card previously borrowed totals.tokenReporting/tokenEligible, which
     counts working agents reporting TOKENS — a different population measuring a
     different thing. Measured by the frontend lane: the suffix read 8/9 while
     32 live agents were reporting contextPct. Deriving it client-side would
     have been a third population, since the headline comes from this filter, so
     the number and its coverage now ship together. */
  const contextReporting = contextValues.length;
  const contextEligible = liveAgents.length;
  const contextMedian = contextValues.length === 0
    ? undefined
    : contextValues.length % 2 === 1
      ? contextValues[(contextValues.length - 1) / 2]
      : Math.round((contextValues[contextValues.length / 2 - 1]! + contextValues[contextValues.length / 2]!) / 2);
  const sourceErrors = Object.values(input.sourceErrors ?? {}).flat();
  const cmuxErrors = [...(input.cmuxErrors ?? [])];
  const staleSources = (Object.entries(input.sourceErrors ?? {}) as [Provider, readonly string[]][])
    .filter(([, errors]) => errors.length > 0)
    .map(([provider]) => provider);
  const sourceIssues = buildOperatorIssues(allAgents, input.surfaces, input.sourceErrors, cmuxErrors);
  const { issues, recentlyResolved } = lifecycleIssues(sourceIssues, input, now);
  /* Abandoned panes are separated out before anything downstream counts errors.
     They are permanent by construction — nobody closes a pane from a finished
     wave — so leaving them in `errors` made Operational unreachable on any
     machine that had ever run a swarm, which is every machine this ships to. */
  const identitySplit = classifyIdentityConflicts(allAgents, input.surfaces, cmuxErrors);
  const debris = controlDebrisFor(identitySplit);
  const operationalCmuxErrors = cmuxErrors.filter(
    (error) => !identitySplit.debrisErrors.includes(error),
  );
  /* A cleared archive is a live fault, not debris: every session the operator
     dismissed is back on the board as work in flight, and the count of what is
     running is wrong until it is fixed. */
  const archiveLoadError = input.archiveStore.loadError?.();
  /* DEGRADED means "this is here and I cannot read it" — a fault worth
     alarming about. ABSENT means "there is nothing here to read, because this
     person does not use Cursor" — not a fault at all. Collapsing them told a
     first-time user with a working install that their board was incomplete,
     because a fresh machine has no cmux binary and no ~/.cursor.

     Measured on a virgin clone with an empty HOME: all four collectors report
     zero errors, yet the first screen read "No sessions found — and not every
     collector can see · 1 of 4 collectors degraded". The one was cmux, missing
     because it had never been installed. This is the same honesty rule the rest
     of the board follows, pointed at the newcomer instead of at us: we spent
     the day deleting numbers that overclaimed, and this one underclaimed. */
  /* Every provider that has a collector, not a hand-written subset of them.
     This list said codex/claude/cursor and omitted omp, while the byProvider
     breakdown shipped on the same card is built from all four. Both sets had
     four members — omp missing here, cmux missing there — so the totals looked
     consistent right up until an omp collector broke, at which point the header
     read "healthy" and the drawer read "broken" off the same snapshot. */
  const collectorProviders: readonly Provider[] = PROVIDERS;
  const absentSources = collectorProviders.filter((provider) =>
    input.sourceAbsent?.[provider] === true
    && (input.sourceErrors?.[provider]?.length ?? 0) === 0,
  ).length;
  const degradedSources = collectorProviders.filter((provider) =>
    (input.sourceErrors?.[provider]?.length ?? 0) > 0,
  ).length;
  /* The ratio counts collectors that EXIST on this machine, and cmux is not one
     of them. `collectSessions` returns exactly { omp, codex, claude, cursor },
     and ANT-GUIDE tells the reader "the four collectors are the same everywhere"
     before naming those. cmux is the control plane: it has its own
     `controlHealth.cmuxReachable`, its errors become operator issues, and it is
     rendered separately. Counting it here made an unreachable control plane
     print as a broken *collector* — the same fault under two labels, on a board
     whose whole complaint about itself was repeated information.

     The literal 4 that used to sit here was right by arithmetic accident. This
     block dropped omp (-1) and added cmux (+1), and the two cancelled, so the
     published ratio stayed plausible while its membership was wrong. */
  const knownCollectors = collectorProviders.length;
  const sourceTotal = Math.max(0, knownCollectors - absentSources);
  const activeCursorAgents = liveAgents.filter((agent) => agent.provider === "cursor");
  const cursorModelHealth = {
    compliant: activeCursorAgents.filter((agent) => agent.modelPolicy?.state === "compliant").length,
    mismatch: activeCursorAgents.filter((agent) => agent.modelPolicy?.state === "mismatch").length,
    unreported: activeCursorAgents.filter((agent) => agent.modelPolicy?.state === "unreported").length,
    total: activeCursorAgents.length,
  };

  const scanWindowHours = input.scanWindowHours;
  const snapshot: HubSnapshot = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    modelConfig: {
      displayLabels: MODEL_CONFIG.modelDisplayLabels,
    },
    scanWindowHours,
    lookbackHours: scanWindowHours,
    contextPeak,
    contextMedian,
    contextReporting,
    contextEligible,
    attentionCoverage,
    controlHealth: {
      cmuxReachable: input.cmuxReachable ?? operationalCmuxErrors.length === 0,
      lastCheckedAt: input.cmuxLastCheckedAt ?? new Date(0).toISOString(),
      /* Deduplicated. `sourceErrors` is flattened across providers, and a fault
         that stops the whole aggregate stops all four of them, so one deadline
         arrived here as ten entries. Harmless while this was only counted; the
         card now prints the first and appends "(+N more)", which turned two
         real faults into "(+9 more)" and sent an operator looking for eight
         problems that did not exist. Per-provider errors keep their copies —
         that is what `staleSources` is derived from. */
      errors: [...new Set([
        ...operationalCmuxErrors,
        ...sourceErrors,
        ...(archiveLoadError ? [archiveLoadError] : []),
      ])],
      staleSources,
      ...(debris ? { debris } : {}),
    },
    totals: {
      live: liveAgents.length,
      tracked: allAgents.length,
      attention: allAgents.filter((agent) => agent.status === "attention").length,
      tokens: tokenValues.length ? tokenValues.reduce((total, value) => total + value, 0) : undefined,
      working: allAgents.filter((agent) => agent.activity === "working").length,
      idle: allAgents.filter((agent) => agent.activity === "idle").length,
      ended: allAgents.filter((agent) => agent.activity === "ended").length,
      /* Agents waiting on a human, counted from the same signal the tab, the
         title badge, the notifier and the program rollup all read. This was
         issues.length — system findings — which meant the rollup cell and the
         totals disagreed about what the word meant while sharing it. */
      needsYou: allAgents.filter((agent) => Boolean(agent.attentionSignal)).length,
      /* System findings keep their own vocabulary. A degraded collector and an
         agent that asked a question are both worth surfacing and neither is the
         other; folding them into one word is what made "needs you" unreadable. */
      systemFindings: issues.length,
      history: allAgents.filter((agent) => agent.activity === "ended").length,
      tokenReporting: workingAgents.filter((agent) => typeof agent.tokens.total === "number").length,
      tokenEligible: workingAgents.length,
      tokenMedian,
      cursorModelHealth,
      sourceHealth: {
        healthy: Math.max(0, sourceTotal - degradedSources),
        degraded: Math.min(sourceTotal, degradedSources),
        /* Reported so a card can say "Cursor is not installed" rather than
           implying we are watching something that is not there. healthy +
           degraded === total, and total + absent === the four known kinds. */
        absent: Math.min(knownCollectors, absentSources),
        total: sourceTotal,
      },
    },
    issues,
    recentlyResolved,
    programs: orderedPrograms,
  };
  return withIssueDecoration(snapshot, input.triageSummaries);
}

export function snapshotFingerprint(snapshot: HubSnapshot): string {
  const { generatedAt: _generatedAt, controlHealth, ...stable } = snapshot;
  const { lastCheckedAt: _lastCheckedAt, ...stableHealth } = controlHealth;
  // identityTrace is a non-enumerable lazy getter, so ordinary snapshot/SSE
  // serialization never constructs or ships debug-only evidence.
  const programs = stable.programs.map((program) => ({
    ...program,
    agents: program.agents.map(({ elapsedMs: _elapsedMs, ...agent }) => agent),
  }));
  return JSON.stringify({ ...stable, programs, controlHealth: stableHealth });
}
