import type {
  AgentSnapshot,
  HubPulse,
  HubSnapshot,
  IssueLifecycle,
  IssueWorkState,
  OperatorIssue,
  ProgramSnapshot,
  Provider,
  TriageQueueSummary,
} from "../shared/types";
import { MODEL_CONFIG } from "./model-config";
import { resolveAgentTarget, resolveAgentTargetWithTrace } from "./targets";
import { lifecycleIssues, withIssueDecoration } from "./snapshot-issues";
import { attentionFieldsFor } from "./attention-signal";
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
    const surface = target.surfaceId
      ? input.surfaces.find((candidate) => candidate.surfaceId === target.surfaceId)
      : undefined;
    const notification = target.surfaceId
      ? [...(input.notifications ?? [])]
          .filter((candidate) => {
            if (candidate.surfaceId !== target.surfaceId) return false;
            const startedAtMs = source.startedAt ? Date.parse(source.startedAt) : Number.NaN;
            const notificationAtMs = Date.parse(candidate.createdAt);
            return !Number.isFinite(startedAtMs) || (
              Number.isFinite(notificationAtMs) && notificationAtMs >= startedAtMs
            );
          })
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
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
    const agent: AgentSnapshot = {
      ...source,
      programId: program.id,
      status: archived ? "archived" : notification ? "attention" : source.status,
      statusReason: snapshotStatusReason,
      activity,
      processState: processStateFor(source),
      outcome,
      controlState,
      role: roleFor(source, (childCounts.get(source.id) ?? 0) > 0),
      effort: effortFor(source),
      ...(contextPct === undefined ? {} : { contextPct }),
      ...attentionFieldsFor({
        transcriptTail: notification?.body
          ? `${source.transcriptTail ? `${source.transcriptTail}\n\n` : ""}[Attention] ${notification.body}`
          : source.transcriptTail,
        lastAgentMessage: source.lastAgentMessage,
        activity,
        processState: processStateFor(source),
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
      lastHumanMessage: source.lastHumanMessage !== undefined
        ? source.lastHumanMessage === source.statusReason
          ? snapshotStatusReason
          : source.lastHumanMessage
        : source.task ?? source.statusReason ?? null,
      transcriptTail: notification?.body
        ? `${source.transcriptTail ? `${source.transcriptTail}\n\n` : ""}[Attention] ${notification.body}`.slice(-MAX_TRANSCRIPT_TAIL_CHARS)
        : source.transcriptTail,
      elapsedMs: source.startedAt ? Math.max(0, elapsedEndMs - Date.parse(source.startedAt)) : undefined,
      git: surface
        ? { branch: surface.branch, dirty: surface.dirty, head: surface.head }
        : undefined,
      target,
      controls: controlsFor(source, target, archived),
    };
    Object.defineProperty(agent, "identityTrace", {
      configurable: false,
      enumerable: false,
      get: () => resolveAgentTargetWithTrace(source, input.surfaces, sources).trace,
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
  const degradedSources =
    ["codex", "claude", "cursor"].filter((provider) =>
      (input.sourceErrors?.[provider as Provider]?.length ?? 0) > 0,
    ).length + (operationalCmuxErrors.length > 0 || input.cmuxReachable === false ? 1 : 0);
  const sourceTotal = 4;
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
    controlHealth: {
      cmuxReachable: input.cmuxReachable ?? operationalCmuxErrors.length === 0,
      lastCheckedAt: input.cmuxLastCheckedAt ?? new Date(0).toISOString(),
      errors: [
        ...operationalCmuxErrors,
        ...sourceErrors,
        ...(archiveLoadError ? [archiveLoadError] : []),
      ],
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
      needsYou: issues.length,
      history: allAgents.filter((agent) => agent.activity === "ended").length,
      tokenReporting: workingAgents.filter((agent) => typeof agent.tokens.total === "number").length,
      tokenEligible: workingAgents.length,
      tokenMedian,
      cursorModelHealth,
      sourceHealth: {
        healthy: Math.max(0, sourceTotal - degradedSources),
        degraded: Math.min(sourceTotal, degradedSources),
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
