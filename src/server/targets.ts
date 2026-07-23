import type { CmuxTarget } from "../shared/types";
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

export function resolveAgentTarget(
  agent: CollectedAgent,
  surfaces: readonly CmuxSurface[],
  sources: readonly CollectedAgent[] = [agent],
): CmuxTarget {
  const recorded = agent.recordedTarget;
  if (recorded && (recorded.surfaceId || recorded.workspaceId || recorded.paneId)) {
    const matches = surfaces.filter(
      (surface) =>
        (!recorded.surfaceId || recorded.surfaceId === surface.surfaceId) &&
        (!recorded.workspaceId || recorded.workspaceId === surface.workspaceId) &&
        (!recorded.paneId || recorded.paneId === surface.paneId),
    );
    const quarantine = quarantined(matches);
    if (quarantine) return quarantine;
    if (matches.length === 1) {
      return target(matches[0], "exact", "Matched recorded cmux target IDs.", agent);
    }
    if (matches.length > 1) {
      return { resolution: "ambiguous", reason: "Recorded cmux IDs matched multiple surfaces; controls are disabled." };
    }
  }

  const sessionMatches = surfaces.filter((surface) =>
    surface.sourceSessionIds.includes(agent.sourceSessionId),
  );
  const sessionQuarantine = quarantined(sessionMatches);
  if (sessionQuarantine) return sessionQuarantine;
  if (sessionMatches.length === 1) {
    return target(
      sessionMatches[0],
      "exact",
      "Matched source session ID recorded by cmux.",
      agent,
    );
  }
  if (sessionMatches.length > 1) {
    return {
      resolution: "ambiguous",
      reason: `Source session ID appears on ${sessionMatches.length} cmux surfaces; controls are disabled.`,
    };
  }

  if (agent.allowCwdFallback === false) {
    return {
      resolution: "missing",
      reason: "Cursor GUI agents require exact cmux identity; cwd fallback is disabled.",
    };
  }

  if (!agent.cwd) {
    return { resolution: "missing", reason: "Source did not record a cwd or exact cmux target." };
  }
  const cwdMatches = surfaces.filter((surface) => sameCwd(surface.cwd, agent.cwd));
  const cwdQuarantine = quarantined(cwdMatches);
  if (cwdQuarantine) return cwdQuarantine;
  if (!eligibleForCwdFallback(agent)) {
    return {
      resolution: "missing",
      reason: `cwd fallback requires a running or waiting source; source is ${agent.status}.`,
    };
  }
  const cwdSources = sources.filter(
    (candidate) => eligibleForCwdFallback(candidate) && sameCwd(candidate.cwd, agent.cwd),
  );
  if (cwdSources.length !== 1 || cwdSources[0]?.id !== agent.id) {
    // Shared cwd with no cmux surface is "not linked" (view only), not an
    // identity conflict. Only quarantine when a surface exists and ownership
    // would be a guess among multiple active sources.
    if (cwdMatches.length === 0) {
      return { resolution: "missing", reason: "No cmux surface matches this source session or cwd." };
    }
    return {
      resolution: "ambiguous",
      reason: `${cwdSources.length} active sources share this cwd; cwd fallback requires exactly one and controls are disabled.`,
    };
  }
  const eligibleSurfaces = cwdMatches.filter((surface) => surface.sourceSessionIds.length === 0);
  if (eligibleSurfaces.length === 1) {
    return target(
      eligibleSurfaces[0],
      "unique-cwd",
      "Matched one active source to the only unclaimed cmux surface with this exact cwd.",
      agent,
    );
  }
  if (eligibleSurfaces.length > 1) {
    return {
      resolution: "ambiguous",
      reason: `${eligibleSurfaces.length} unclaimed cmux surfaces share this cwd; controls are disabled.`,
    };
  }
  if (cwdMatches.length > 0) {
    return {
      resolution: "ambiguous",
      reason: "cmux surfaces for this cwd already carry exact identity evidence; cwd fallback is disabled.",
    };
  }
  return { resolution: "missing", reason: "No cmux surface matches this source session or cwd." };
}
