import { homedir } from "node:os";
import { basename } from "node:path";
import type {
  AgentSnapshot,
  HubPulse,
  HubSnapshot,
  IssueLifecycle,
  IssueWorkState,
  OperatorIssue,
  OutcomeState,
  ProgramSnapshot,
  ProgramRollup,
  Provider,
  TriageQueueSummary,
} from "../shared/types";
import { MODEL_CONFIG } from "./model-config";
import { resolveAgentTarget, resolveAgentTargetWithTrace } from "./targets";
import { lifecycleIssues, withIssueDecoration } from "./snapshot-issues";
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
  nextActionFor,
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

export interface ProgramHint {
  id: string;
  name: string;
  purpose?: string;
  path?: string;
  match: string[];
}

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

function hash(value: string): string {
  let result = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16_777_619);
  }
  return (result >>> 0).toString(36);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unassigned";
}

function rollupFor(agents: readonly AgentSnapshot[]): ProgramRollup {
  const outcomeCount = (outcome: OutcomeState): number => agents.filter((agent) => agent.outcome === outcome).length;
  return {
    total: agents.length,
    live: agents.filter((agent) => agent.activity === "working" || agent.activity === "idle").length,
    working: agents.filter((agent) => agent.activity === "working").length,
    idle: agents.filter((agent) => agent.activity === "idle").length,
    ended: agents.filter((agent) => agent.activity === "ended").length,
    needsYou: agents.filter((agent) => agent.outcome && agent.outcome !== "healthy" && agent.activity !== "ended").length,
    blocked: outcomeCount("blocked"),
    failed: outcomeCount("failed"),
    linked: agents.filter((agent) => agent.controlState === "linked").length,
  };
}

function agentSortRank(agent: AgentSnapshot): number {
  if (agent.outcome === "failed") return 0;
  if (agent.outcome === "needs-you") return 1;
  if (agent.outcome === "blocked") return 2;
  if (agent.activity === "working") return 3;
  if (agent.activity === "idle") return 4;
  return 5;
}

function buildOperatorIssues(
  agents: readonly AgentSnapshot[],
  surfaces: readonly CmuxSurface[],
  sourceErrors: SnapshotInput["sourceErrors"],
  cmuxErrors: readonly string[],
): OperatorIssue[] {
  const issues: OperatorIssue[] = [];
  const identityErrors = cmuxErrors.filter((error) => /conflicting open agent session files/i.test(error));
  if (identityErrors.length > 0) {
    const conflictedSessionIds = new Set(
      surfaces
        .filter((surface) => surface.identityTrace?.outcome === "open-file-conflict")
        .flatMap((surface) => surface.identityTrace?.openFileMatches ?? [])
        .map(({ sessionId }) => sessionId.toLowerCase()),
    );
    issues.push({
      id: "system:cmux-identity-conflicts",
      kind: "system",
      severity: "error",
      title: "CMUX identity conflicts",
      summary: `${identityErrors.length} ${identityErrors.length === 1 ? "surface has" : "surfaces have"} conflicting agent-session evidence. Controls remain quarantined until identity is unambiguous.`,
      affectedAgentIds: agents
        .filter((agent) =>
          agent.controlState === "quarantined" ||
          conflictedSessionIds.has(agent.sourceSessionId.toLowerCase()),
        )
        .map((agent) => agent.id),
      technicalDetails: identityErrors,
    });
  }

  const otherCmuxErrors = cmuxErrors.filter((error) => !identityErrors.includes(error));
  if (otherCmuxErrors.length > 0) {
    issues.push({
      id: "system:cmux-control",
      kind: "system",
      severity: "error",
      title: "CMUX control is degraded",
      summary: `${otherCmuxErrors.length} control-plane ${otherCmuxErrors.length === 1 ? "problem may" : "problems may"} limit focus, instruction, or interrupt actions.`,
      affectedAgentIds: agents
        .filter((agent) => agent.controlState !== "linked" && agent.activity !== "ended")
        .map((agent) => agent.id),
      technicalDetails: otherCmuxErrors,
    });
  }

  for (const provider of ["codex", "claude", "cursor"] as const) {
    const errors = [...(sourceErrors?.[provider] ?? [])];
    if (errors.length === 0) continue;
    const label = provider === "codex" ? "Codex" : provider === "claude" ? "Claude" : "Cursor";
    issues.push({
      id: `system:${provider}-collector`,
      kind: "system",
      severity: "warning",
      title: `${label} collection is degraded`,
      summary: `${errors.length} collection ${errors.length === 1 ? "problem makes" : "problems make"} ${label} session data potentially incomplete.`,
      affectedAgentIds: agents.filter((agent) => agent.provider === provider).map((agent) => agent.id),
      technicalDetails: errors,
    });
  }

  const cursorMismatches = agents.filter((agent) => agent.modelPolicy?.state === "mismatch");
  const activeCursorMismatches = cursorMismatches.filter((agent) => agent.activity !== "ended");
  const endedCursorMismatches = cursorMismatches.filter((agent) => agent.activity === "ended");
  if (activeCursorMismatches.length > 0) {
    issues.push({
      id: "system:cursor-model-policy-active",
      kind: "system",
      severity: "error",
      title: "Cursor model routing mismatches",
      summary: `${activeCursorMismatches.length} active Cursor ${activeCursorMismatches.length === 1 ? "session uses" : "sessions use"} a different model than expected.`,
      affectedAgentIds: activeCursorMismatches.map((agent) => agent.id),
      technicalDetails: activeCursorMismatches.map((agent) =>
        `${agent.id}: observed ${agent.modelPolicy?.observed ?? "unreported"}; expected ${agent.modelPolicy?.expected ?? "unreported"}.`),
    });
  }
  if (endedCursorMismatches.length > 0) {
    issues.push({
      id: "system:cursor-model-policy-recent",
      kind: "system",
      severity: "warning",
      title: "Recent Cursor model routing mismatches",
      summary: `${endedCursorMismatches.length} ended Cursor ${endedCursorMismatches.length === 1 ? "session used" : "sessions used"} a different model than expected. Ended sessions are retained as history, not presented as active.`,
      affectedAgentIds: endedCursorMismatches.map((agent) => agent.id),
      technicalDetails: endedCursorMismatches.map((agent) =>
        `${agent.id}: observed ${agent.modelPolicy?.observed ?? "unreported"}; expected ${agent.modelPolicy?.expected ?? "unreported"}.`),
    });
  }

  for (const agent of agents) {
    if (!agent.outcome || agent.outcome === "healthy" || agent.activity === "ended") continue;
    issues.push({
      id: `agent:${agent.id}`,
      kind: "agent",
      severity: agent.outcome === "failed" ? "error" : "warning",
      title: agent.outcome === "failed" ? `${agent.displayName} failed` : `${agent.displayName} needs review`,
      summary: agent.statusReason,
      affectedAgentIds: [agent.id],
    });
  }
  return issues;
}

function configuredProgram(
  hints: readonly ProgramHint[],
  values: readonly (string | undefined)[],
): ProgramHint | undefined {
  return hints.find((hint) =>
    hint.match.some((needle) =>
      values.some((value) => value?.toLowerCase().includes(needle.toLowerCase())),
    ),
  );
}

function programFor(
  agent: CollectedAgent,
  hints: readonly ProgramHint[],
  surface?: CmuxSurface,
  exactSurface = false,
): Omit<ProgramSnapshot, "agents"> {
  const configured =
    configuredProgram(hints, [agent.cwd, agent.id]) ??
    (exactSurface ? configuredProgram(hints, [surface?.cwd, surface?.workspaceTitle]) : undefined) ??
    configuredProgram(hints, [agent.task, agent.displayName]);
  if (configured) {
    return { id: configured.id, name: configured.name, purpose: configured.purpose, path: configured.path };
  }
  const cwd = exactSurface && surface?.cwd ? surface.cwd : agent.cwd;
  if (!cwd) return { id: `${agent.provider}-unassigned`, name: `${agent.provider.toUpperCase()} · No project` };
  const normalizedCwd = cwd.replace(/\/+$/, "");
  if (normalizedCwd === homedir().replace(/\/+$/, "")) {
    // cwd is literally ~ — not "unassigned", just not a project checkout.
    return { id: `cwd-home-${hash(normalizedCwd)}`, name: "Home", path: cwd };
  }
  const name = basename(cwd) || cwd;
  return { id: `cwd-${slug(name)}-${hash(cwd)}`, name, path: cwd };
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
      nextAction: nextActionFor(activity, outcome, controlState),
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
  const degradedSources =
    ["codex", "claude", "cursor"].filter((provider) =>
      (input.sourceErrors?.[provider as Provider]?.length ?? 0) > 0,
    ).length + (cmuxErrors.length > 0 || input.cmuxReachable === false ? 1 : 0);
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
      cmuxReachable: input.cmuxReachable ?? cmuxErrors.length === 0,
      lastCheckedAt: input.cmuxLastCheckedAt ?? new Date(0).toISOString(),
      errors: [...cmuxErrors, ...sourceErrors],
      staleSources,
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
