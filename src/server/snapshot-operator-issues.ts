/* The operator-issue builder: everything currently wrong with the fleet,
   expressed as rows a human can act on rather than raw collector errors.

   Order is deliberate — identity conflicts first (they quarantine controls),
   then control-plane degradation, then per-source collection gaps, then model
   routing mismatches, then the per-agent findings. Severity and affected-agent
   lists are what the board sorts and counts on, so each branch names the
   agents it actually implicates rather than blaming the whole fleet.

   Takes the sourceErrors map directly instead of SnapshotInput so this module
   does not import back into snapshot.ts. */

import type {
  AgentSnapshot,
  OperatorIssue,
  Provider,
} from "../shared/types";
import type { CmuxSurface } from "./types";

/* The sourceErrors slice of SnapshotInput, named so callers pass it unchanged.
   Optional on SnapshotInput, so `undefined` stays in the union — a collector
   that reported nothing is not the same as one that reported no errors. */
export type SourceErrors = Partial<Record<Provider, readonly string[]>> | undefined;

export function buildOperatorIssues(
  agents: readonly AgentSnapshot[],
  surfaces: readonly CmuxSurface[],
  sourceErrors: SourceErrors,
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
