/* Operator-issue lifecycle and presentation.

   Two jobs live here. The lifecycle half carries an issue across snapshots:
   an issue the sources stop reporting becomes "resolved" rather than
   disappearing, and stays on the board for a TTL so the operator sees that it
   cleared instead of just noticing it is gone. The decoration half answers
   what the row says right now — work state, progress, and who it touches.

   The lifecycle functions take a narrow input shape rather than the whole
   SnapshotInput. They only read three of its fields, SnapshotInput satisfies
   it structurally, and declaring just those keeps this module from importing
   back into snapshot.ts. */

import type {
  HubSnapshot,
  IssueLifecycle,
  IssueWorkState,
  OperatorIssue,
  ProgramSnapshot,
  TriageQueueSummary,
} from "../shared/types";

export const MAX_RECENTLY_RESOLVED = 12;
const RECENTLY_RESOLVED_TTL_MS = 15 * 60 * 1_000;

const ISSUE_PROGRESS: Record<IssueWorkState, number> = {
  needs_triage: 0,
  watching: 0,
  triaging: 15,
  planned: 35,
  queued: 50,
  investigating: 70,
  verifying: 85,
  blocked: 70,
  cleared: 100,
};

/* The slice of SnapshotInput the lifecycle actually reads. SnapshotInput
   satisfies this structurally, so callers pass `input` unchanged. */
export interface IssueLifecycleInput {
  issueLifecycle?: ReadonlyMap<string, IssueLifecycle>;
  previousIssues?: readonly OperatorIssue[];
  recentlyResolved?: readonly OperatorIssue[];
}

export function impactSummaryFor(
  issue: OperatorIssue,
  programs: readonly ProgramSnapshot[],
): string {
  const affectedIds = [...new Set(issue.affectedAgentIds)];
  if (affectedIds.length === 0) return "System-wide — not tied to a specific agent";

  const affected = new Set(affectedIds);
  const matches = programs.flatMap((program) =>
    program.agents
      .filter((agent) => affected.has(agent.id))
      .map((agent) => ({ agent, program })),
  );
  if (affectedIds.length === 1 && matches[0]) {
    return `Touches 1 session: ${matches[0].agent.displayName} (${matches[0].program.name})`;
  }

  const programCounts = new Map<string, number>();
  for (const { program } of matches) {
    programCounts.set(program.name, (programCounts.get(program.name) ?? 0) + 1);
  }
  const programsByImpact = [...programCounts]
    .sort(([leftName, leftCount], [rightName, rightCount]) =>
      rightCount - leftCount || leftName.localeCompare(rightName),
    );
  const topPrograms = programsByImpact
    .slice(0, 2)
    .map(([name, count]) => `${name} (${count})`)
    .join(", ");
  const programLabel = programsByImpact.length === 1 ? "program" : "programs";
  return `Touches ${affectedIds.length} sessions across ${programsByImpact.length} ${programLabel}`
    + (topPrograms ? ` — mainly ${topPrograms}` : "");
}

export function issueWorkStateFor(
  issue: OperatorIssue,
  triage?: TriageQueueSummary,
): IssueWorkState {
  // Source clearance outranks a stale triage/queue row — resolved findings stay Cleared.
  if (issue.lifecycle?.state === "resolved") return "cleared";
  if (triage?.state === "running") return "investigating";
  if (triage?.state === "queued") return "queued";
  if (triage?.state === "completed") return "verifying";
  if (triage?.state === "blocked") return "blocked";
  if (issue.lifecycle?.state === "verifying") return "verifying";
  if (issue.lifecycle?.state === "blocked") return "blocked";
  return issue.severity === "error" ? "needs_triage" : "watching";
}

export function withIssueDecoration(
  snapshot: HubSnapshot,
  triageSummaries: readonly TriageQueueSummary[] = [],
): HubSnapshot {
  const summaries = triageSummaries.map(({ issueId, state }) => ({ issueId, state }));
  const triageByIssue = new Map(summaries.map((summary) => [summary.issueId, summary]));
  const decorate = (issue: OperatorIssue): OperatorIssue => {
    const workState = issueWorkStateFor(issue, triageByIssue.get(issue.id));
    return {
      ...issue,
      workState,
      progress: ISSUE_PROGRESS[workState],
      impactSummary: impactSummaryFor(issue, snapshot.programs),
    };
  };
  return {
    ...snapshot,
    issues: (snapshot.issues ?? []).map(decorate),
    recentlyResolved: (snapshot.recentlyResolved ?? []).map(decorate),
    triageSummaries: summaries,
  };
}

function openLifecycle(now: string): IssueLifecycle {
  return { state: "open", openedAt: now };
}

function lifecycleForIssue(
  issue: OperatorIssue,
  input: IssueLifecycleInput,
  now: string,
): IssueLifecycle {
  const existing = input.issueLifecycle?.get(issue.id) ?? issue.lifecycle;
  if (!existing || existing.state === "resolved") return openLifecycle(now);
  return {
    ...existing,
    openedAt: existing.openedAt || now,
  };
}

function resolvedIssue(
  issue: OperatorIssue,
  now: string,
): OperatorIssue {
  const priorResult = issue.lifecycle?.result;
  return {
    ...issue,
    lifecycle: {
      ...(issue.lifecycle ?? openLifecycle(now)),
      state: "resolved",
      resolvedAt: now,
      result: priorResult
        ? `${priorResult} Fresh source confirmation no longer reports this issue.`
        : "A fresh source snapshot no longer reports this issue.",
    },
  };
}

export function lifecycleIssues(
  sourceIssues: readonly OperatorIssue[],
  input: IssueLifecycleInput,
  now: Date,
): { issues: OperatorIssue[]; recentlyResolved: OperatorIssue[] } {
  const nowIso = now.toISOString();
  const issues = sourceIssues.map((issue) => ({
    ...issue,
    lifecycle: lifecycleForIssue(issue, input, nowIso),
  }));
  const currentIds = new Set(issues.map((issue) => issue.id));
  const newlyResolved = (input.previousIssues ?? [])
    .filter((issue) => !currentIds.has(issue.id))
    .map((issue) => resolvedIssue(issue, nowIso));
  const retained = (input.recentlyResolved ?? []).filter((issue) => {
    const resolvedAt = issue.lifecycle?.resolvedAt ? Date.parse(issue.lifecycle.resolvedAt) : Number.NaN;
    return !currentIds.has(issue.id) && Number.isFinite(resolvedAt) && now.getTime() - resolvedAt <= RECENTLY_RESOLVED_TTL_MS;
  });
  const byId = new Map<string, OperatorIssue>();
  for (const issue of [...newlyResolved, ...retained]) {
    if (!byId.has(issue.id)) byId.set(issue.id, issue);
  }
  const recentlyResolved = [...byId.values()]
    .sort((left, right) => (right.lifecycle?.resolvedAt ?? "").localeCompare(left.lifecycle?.resolvedAt ?? ""))
    .slice(0, MAX_RECENTLY_RESOLVED);
  return { issues, recentlyResolved };
}
