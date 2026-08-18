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
  ControlDebris,
  OperatorIssue,
  Provider,
} from "../shared/types";
import { SHARED_HOST_REASON, TWO_OWNER_REASON } from "../shared/identity-copy";
import { PROVIDERS } from "../shared/types";
import { PROVIDER_DISPLAY_NAMES } from "./naming";
import type { CmuxSurface } from "./types";

const IDENTITY_CONFLICT_PATTERN = /conflicting open agent session files|refused command identity:|conflicting recognized agent commands/i;

type AgentWithRuntimeSession = AgentSnapshot & { runtimeSessionId?: string };

/* An identity conflict costs exactly one thing: controls stay quarantined for
   the sessions on that surface until the ambiguity clears. So the conflict is
   only a fault while there is a live session to withhold controls FROM.

   A cmux pane whose sessions have all ended still holds open transcript
   handles, so the scanner reports it forever. Nobody is going to close a pane
   from a wave that finished last week, which makes such a conflict permanent by
   construction — and a permanent error is a board that always says something is
   wrong and an operator who stops reading it.

   Classifying on live impact rather than on age needs no threshold to tune, and
   it self-heals: reopen work in that pane and a live session appears, so it
   becomes a real fault again on the very next scan. */
export interface IdentityConflictSplit {
  /** Conflicts holding controls away from at least one live session. */
  liveErrors: string[];
  /** Conflicts on panes where every session has ended. */
  debrisErrors: string[];
  /** Surfaces behind debrisErrors, so the UI can offer to close them. */
  debrisSurfaceIds: string[];
  /** Live sessions actually quarantined by a live conflict. */
  affectedLiveAgentIds: string[];
}

export function classifyIdentityConflicts(
  agents: readonly AgentSnapshot[],
  surfaces: readonly CmuxSurface[],
  cmuxErrors: readonly string[],
): IdentityConflictSplit {
  const identityErrors = cmuxErrors.filter((error) => IDENTITY_CONFLICT_PATTERN.test(error));
  const liveSessionIds = new Set(
    agents
      .filter((agent) => agent.activity !== "ended")
      .map((agent) => agent.sourceSessionId.toLowerCase()),
  );

  /* A conflicted surface declares itself either through the scan trace or
     through identityConflict alone; take both, or a surface that named its
     sessions without a full trace would look like a pane with nothing on it and
     be written off as debris. */
  const conflicted = surfaces.filter(
    (surface) => surface.identityTrace?.outcome === "open-file-conflict" || Boolean(surface.identityConflict),
  );
  const liveSurfaceIds = new Set<string>();
  const debrisSurfaceIds: string[] = [];
  const affectedLiveAgentIds = new Set<string>();

  for (const surface of conflicted) {
    const sessionIds = [
      ...(surface.identityTrace?.openFileMatches ?? []).map(({ sessionId }) => sessionId),
      ...surface.sourceSessionIds,
    ].map((sessionId) => sessionId.toLowerCase());
    for (const hint of surface.identityTrace?.commandHints ?? []) {
      if (!hint.rejectionReason) continue;
      for (const agent of agents as readonly AgentWithRuntimeSession[]) {
        const runtimeSessionId = agent.runtimeSessionId?.toLowerCase();
        if (
          agent.provider === hint.provider &&
          (agent.sourceSessionId.toLowerCase() === hint.value.toLowerCase() || runtimeSessionId === hint.value.toLowerCase())
        ) {
          sessionIds.push(agent.sourceSessionId.toLowerCase());
        }
      }
    }
    const commandHintConflict = surface.identityTrace?.outcome === "command-hint-conflict"
      && (surface.identityTrace.commandHints ?? []).some(({ rejectionReason }) => Boolean(rejectionReason));
    const liveHere = sessionIds.filter((sessionId) => liveSessionIds.has(sessionId));
    if (liveHere.length > 0 || (commandHintConflict && sessionIds.length === 0)) {
      liveSurfaceIds.add(surface.surfaceId);
      for (const agent of agents) {
        if (agent.activity === "ended") continue;
        if (liveHere.includes(agent.sourceSessionId.toLowerCase())) affectedLiveAgentIds.add(agent.id);
      }
    } else {
      debrisSurfaceIds.push(surface.surfaceId);
    }
  }

  /* Errors name their surface, so split the scanner strings the same way. An
     error we cannot attribute to a surface stays a fault: unexplained evidence
     is not evidence of nothing. */
  const liveErrors: string[] = [];
  const debrisErrors: string[] = [];
  for (const error of identityErrors) {
    const debris = debrisSurfaceIds.some((surfaceId) => error.includes(surfaceId));
    const live = [...liveSurfaceIds].some((surfaceId) => error.includes(surfaceId));
    if (debris && !live) debrisErrors.push(error);
    else liveErrors.push(error);
  }

  return {
    liveErrors,
    debrisErrors,
    debrisSurfaceIds,
    affectedLiveAgentIds: [...affectedLiveAgentIds],
  };
}

export function controlDebrisFor(split: IdentityConflictSplit): ControlDebris | undefined {
  if (split.debrisErrors.length === 0) return undefined;
  const panes = split.debrisSurfaceIds.length || split.debrisErrors.length;
  return {
    kind: "abandoned-cmux-panes",
    count: panes,
    surfaceIds: [...split.debrisSurfaceIds],
    remedy: `Close ${panes} cmux ${panes === 1 ? "pane" : "panes"} left over from finished work. `
      + `Every session in ${panes === 1 ? "it" : "them"} has ended, so nothing on the board is `
      + `waiting on ${panes === 1 ? "it" : "them"} — this is tidying, not a fault.`,
    detail: [...split.debrisErrors],
  };
}

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
  const split = classifyIdentityConflicts(agents, surfaces, cmuxErrors);
  const identityErrors = cmuxErrors.filter((error) => IDENTITY_CONFLICT_PATTERN.test(error));
  /* Only the live half becomes a finding. Debris rides controlHealth.debris,
     where the UI can collapse it into one quiet line: a pane nobody is using is
     not something requiring attention, and putting it in the alert count is how
     the board taught its operator to stop looking.

     affectedAgentIds used to be `controlState === "quarantined" || <on a
     conflicted surface>`. That first clause swept in EVERY quarantined agent
     whatever the cause, so a fleet quarantined for sharing one cwd — a
     different condition entirely, with a different remedy — was blamed on
     surface conflicts it had no connection to. Blame only the sessions the
     conflicting surfaces actually name. */
  if (split.liveErrors.length > 0) {
    issues.push({
      id: "system:cmux-identity-conflicts",
      kind: "system",
      severity: "error",
      title: "Two sessions share one terminal",
      summary: TWO_OWNER_REASON,
      affectedAgentIds: split.affectedLiveAgentIds,
      technicalDetails: split.liveErrors,
    });
  }

  const sharedHostSurfaces = surfaces.filter(
    (surface) => surface.runtimeSurfaceReady !== false
      && surface.identityTrace?.outcome === "shared-host",
  );
  if (sharedHostSurfaces.length > 0) {
    const grokSessionIds = new Set(
      sharedHostSurfaces.flatMap((surface) => surface.identityTrace?.openFileMatches
        .filter(({ provider }) => provider === "grok")
        .map(({ sessionId }) => sessionId.toLowerCase()) ?? []),
    );
    issues.push({
      id: "system:grok-shared-host",
      kind: "system",
      severity: "warning",
      title: "Several Grok chats share one terminal",
      summary: SHARED_HOST_REASON,
      affectedAgentIds: agents
        .filter((agent) => agent.provider === "grok"
          && grokSessionIds.has(agent.sourceSessionId.toLowerCase()))
        .map((agent) => agent.id),
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

  /* Walked from PROVIDERS, and named from the same Record<Provider, string> the
     rest of the board reads. The listed form covered three of five collectors
     and chained ternaries for their names, so omp and Factory could fail, be
     counted in the degraded tally, and raise nothing that said which source had
     gone — a number with no cause, which is the failure this file is about. */
  for (const provider of PROVIDERS) {
    const errors = [...(sourceErrors?.[provider] ?? [])];
    if (errors.length === 0) continue;
    const label = PROVIDER_DISPLAY_NAMES[provider];
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

  /* Two Cursor model-routing findings stood here — one for active sessions, one
     for ended ones. Both are gone with the policy that produced them: the hub
     has no rule about which model a Cursor session may run, so it raises no
     finding when Cursor picks one. See snapshot-agent.ts for why the rule was
     wrong rather than merely mis-rendered. */

  for (const agent of agents) {
    if (!agent.outcome || agent.outcome === "healthy" || agent.activity === "ended") continue;
    const name = agent.identity?.name?.trim() || agent.displayName;
    issues.push({
      id: `agent:${agent.id}`,
      kind: "agent",
      severity: agent.outcome === "failed" ? "error" : "warning",
      title: agent.outcome === "failed" ? `${name} failed` : `${name} needs review`,
      summary: agent.statusReason,
      affectedAgentIds: [agent.id],
    });
  }
  return issues;
}
