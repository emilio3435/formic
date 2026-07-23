import type { CmuxTarget, IdentityTrace, IdentityTraceStep, IdentityTraceTier } from "../shared/types";
import type { CmuxSurface, CollectedAgent } from "./types";

function normalizeCwd(value?: string): string {
  return (value ?? "").replace(/\/+$/, "");
}

function sameCwd(left?: string, right?: string): boolean {
  const a = normalizeCwd(left);
  const b = normalizeCwd(right);
  if (!a || !b) return false;
  return a === b;
}

function target(
  surface: CmuxSurface,
  resolution: CmuxTarget["resolution"],
  reason: string,
  agent?: CollectedAgent,
): CmuxTarget {
  const surfaceCwd = surface.cwd ? normalizeCwd(surface.cwd) : undefined;
  const agentCwd = agent?.cwd ? normalizeCwd(agent.cwd) : undefined;
  const cwdMismatch = Boolean(
    surfaceCwd &&
    agentCwd &&
    surfaceCwd !== agentCwd &&
    (resolution === "exact" || resolution === "unique-cwd"),
  );
  return {
    workspaceId: surface.workspaceId,
    workspaceTitle: surface.workspaceTitle,
    surfaceId: surface.surfaceId,
    paneId: surface.paneId,
    surfaceCwd,
    cwdMismatch: cwdMismatch || undefined,
    resolution,
    reason: cwdMismatch
      ? `${reason} Pane cwd (${surfaceCwd}) differs from session cwd (${agentCwd}) — treat the workspace title as the terminal, not the agent's project home.`
      : reason,
  };
}

function eligibleForCwdFallback(agent: CollectedAgent): boolean {
  return agent.status === "running" || agent.status === "waiting";
}

function quarantined(matches: readonly CmuxSurface[]): CmuxTarget | undefined {
  const conflict = matches.find((surface) => surface.identityConflict);
  if (!conflict) return undefined;
  return {
    resolution: "ambiguous",
    reason: `cmux surface is quarantined because exact identity evidence conflicts: ${conflict.identityConflict}`,
  };
}

export interface ResolvedAgentTarget {
  target: CmuxTarget;
  trace: IdentityTrace;
}

export function resolveAgentTargetWithTrace(
  agent: CollectedAgent,
  surfaces: readonly CmuxSurface[],
  sources: readonly CollectedAgent[] = [agent],
): ResolvedAgentTarget {
  const steps: IdentityTraceStep[] = [];
  const recorded = agent.recordedTarget;
  const finish = (resolved: CmuxTarget, matchedTier?: IdentityTraceTier): ResolvedAgentTarget => ({
    target: resolved,
    trace: {
      steps,
      matchedTier,
      resolution: resolved.resolution,
      reason: resolved.reason,
      surfaceId: resolved.surfaceId,
      bindingBridge: recorded?.source === "binding" && recorded.surfaceId
        ? {
            surfaceId: recorded.surfaceId,
            workspaceId: recorded.workspaceId,
            paneId: recorded.paneId,
            confirmedAt: recorded.confirmedAt,
          }
        : undefined,
    },
  });

  const routableSurfaces = surfaces.filter((surface) => surface.runtimeSurfaceReady !== false);
  if (recorded && (recorded.surfaceId || recorded.workspaceId || recorded.paneId)) {
    const matches = routableSurfaces.filter(
      (surface) =>
        (!recorded.surfaceId || recorded.surfaceId === surface.surfaceId) &&
        (!recorded.workspaceId || recorded.workspaceId === surface.workspaceId) &&
        (!recorded.paneId || recorded.paneId === surface.paneId),
    );
    const quarantine = quarantined(matches);
    if (quarantine) {
      steps.push({ tier: "recorded", outcome: "quarantined", detail: quarantine.reason ?? "Recorded surface has an identity conflict." });
      return finish(quarantine);
    }
    if (matches.length === 1) {
      steps.push({
        tier: "recorded",
        outcome: "matched",
        detail: `Recorded cmux target IDs matched surface ${matches[0].surfaceId}${recorded.source === "binding" ? " via a persisted identity binding" : ""}.`,
      });
      return finish(
        target(matches[0], "exact", recorded.reason ?? "Matched recorded cmux target IDs.", agent),
        "recorded",
      );
    }
    if (matches.length > 1) {
      steps.push({ tier: "recorded", outcome: "ambiguous", detail: `Recorded cmux IDs matched ${matches.length} surfaces.` });
      return finish({ resolution: "ambiguous", reason: "Recorded cmux IDs matched multiple surfaces; controls are disabled." });
    }
    steps.push({ tier: "recorded", outcome: "no-match", detail: "Recorded cmux target IDs matched no ready surface; falling through to session evidence." });
  } else {
    steps.push({ tier: "recorded", outcome: "skipped", detail: "No recorded cmux target IDs on this source." });
  }

  const sessionMatches = routableSurfaces.filter((surface) =>
    surface.sourceSessionIds.includes(agent.sourceSessionId),
  );
  const sessionQuarantine = quarantined(sessionMatches);
  if (sessionQuarantine) {
    steps.push({ tier: "session", outcome: "quarantined", detail: sessionQuarantine.reason ?? "Session-matched surface has an identity conflict." });
    return finish(sessionQuarantine);
  }
  if (sessionMatches.length === 1) {
    steps.push({
      tier: "session",
      outcome: "matched",
      detail: `Source session ID ${agent.sourceSessionId} recorded by cmux on surface ${sessionMatches[0].surfaceId}.`,
    });
    return finish(
      target(
        sessionMatches[0],
        "exact",
        "Matched source session ID recorded by cmux.",
        agent,
      ),
      "session",
    );
  }
  if (sessionMatches.length > 1) {
    steps.push({ tier: "session", outcome: "ambiguous", detail: `Source session ID appears on ${sessionMatches.length} cmux surfaces.` });
    return finish({
      resolution: "ambiguous",
      reason: `Source session ID appears on ${sessionMatches.length} cmux surfaces; controls are disabled.`,
    });
  }
  steps.push({ tier: "session", outcome: "no-match", detail: "Source session ID is not present on any ready cmux surface this scan." });

  if (agent.allowCwdFallback === false) {
    steps.push({ tier: "cwd", outcome: "rejected", detail: "Cursor GUI agents require exact cmux identity; cwd fallback is disabled." });
    return finish({
      resolution: "missing",
      reason: "Cursor GUI agents require exact cmux identity; cwd fallback is disabled.",
    });
  }

  if (!agent.cwd) {
    steps.push({ tier: "cwd", outcome: "rejected", detail: "Source did not record a cwd." });
    return finish({ resolution: "missing", reason: "Source did not record a cwd or exact cmux target." });
  }
  const cwdMatches = routableSurfaces.filter((surface) => sameCwd(surface.cwd, agent.cwd));
  const cwdQuarantine = quarantined(cwdMatches);
  if (cwdQuarantine) {
    steps.push({ tier: "cwd", outcome: "quarantined", detail: cwdQuarantine.reason ?? "A cwd-matched surface has an identity conflict." });
    return finish(cwdQuarantine);
  }
  if (!eligibleForCwdFallback(agent)) {
    steps.push({ tier: "cwd", outcome: "rejected", detail: `cwd fallback requires a running or waiting source; source is ${agent.status}.` });
    return finish({
      resolution: "missing",
      reason: `cwd fallback requires a running or waiting source; source is ${agent.status}.`,
    });
  }
  const cwdSources = sources.filter(
    (candidate) => eligibleForCwdFallback(candidate) && sameCwd(candidate.cwd, agent.cwd),
  );
  if (cwdSources.length !== 1 || cwdSources[0]?.id !== agent.id) {
    // Shared cwd with no cmux surface is "not linked" (view only), not an
    // identity conflict. Only quarantine when a surface exists and ownership
    // would be a guess among multiple active sources.
    if (cwdMatches.length === 0) {
      steps.push({ tier: "cwd", outcome: "no-match", detail: "No ready cmux surface shares this cwd." });
      return finish({ resolution: "missing", reason: "No cmux surface matches this source session or cwd." });
    }
    steps.push({ tier: "cwd", outcome: "ambiguous", detail: `${cwdSources.length} active sources share this cwd; cwd fallback requires exactly one.` });
    return finish({
      resolution: "ambiguous",
      reason: `${cwdSources.length} active sources share this cwd; cwd fallback requires exactly one and controls are disabled.`,
    });
  }
  const eligibleSurfaces = cwdMatches.filter((surface) => surface.sourceSessionIds.length === 0);
  if (eligibleSurfaces.length === 1) {
    steps.push({
      tier: "cwd",
      outcome: "matched",
      detail: `This source is the only active one with cwd ${normalizeCwd(agent.cwd)}, and surface ${eligibleSurfaces[0].surfaceId} is the only unclaimed surface with that cwd.`,
    });
    return finish(
      target(
        eligibleSurfaces[0],
        "unique-cwd",
        "Matched one active source to the only unclaimed cmux surface with this exact cwd.",
        agent,
      ),
      "cwd",
    );
  }
  if (eligibleSurfaces.length > 1) {
    steps.push({ tier: "cwd", outcome: "ambiguous", detail: `${eligibleSurfaces.length} unclaimed cmux surfaces share this cwd.` });
    return finish({
      resolution: "ambiguous",
      reason: `${eligibleSurfaces.length} unclaimed cmux surfaces share this cwd; controls are disabled.`,
    });
  }
  if (cwdMatches.length > 0) {
    steps.push({ tier: "cwd", outcome: "rejected", detail: "All surfaces with this cwd already carry exact identity evidence for other sessions." });
    return finish({
      resolution: "ambiguous",
      reason: "cmux surfaces for this cwd already carry exact identity evidence; cwd fallback is disabled.",
    });
  }
  steps.push({ tier: "cwd", outcome: "no-match", detail: "No ready cmux surface shares this cwd." });
  return finish({ resolution: "missing", reason: "No cmux surface matches this source session or cwd." });
}

export function resolveAgentTarget(
  agent: CollectedAgent,
  surfaces: readonly CmuxSurface[],
  sources: readonly CollectedAgent[] = [agent],
): CmuxTarget {
  return resolveAgentTargetWithTrace(agent, surfaces, sources).target;
}
