import type {
  AgentSnapshot,
  HubSnapshot,
  IdentityTraceTier,
  Provider,
  TargetResolution,
} from "../shared/types";
import type { CmuxSurface } from "./types";

export interface IdentityDebugSummary {
  id: string;
  provider: Provider;
  resolution: TargetResolution;
  tier?: IdentityTraceTier;
  surfaceId?: string;
  quarantined: boolean;
  cwdMismatch: boolean;
  bindingBridged: boolean;
}

function summarize(agent: AgentSnapshot): IdentityDebugSummary {
  return {
    id: agent.id,
    provider: agent.provider,
    resolution: agent.target.resolution,
    tier: agent.identityTrace?.matchedTier,
    surfaceId: agent.target.surfaceId,
    quarantined: agent.controlState === "quarantined",
    cwdMismatch: agent.target.cwdMismatch === true,
    bindingBridged: Boolean(
      agent.identityTrace?.bindingBridge && agent.identityTrace.matchedTier === "recorded",
    ),
  };
}

function surfaceView(surface: CmuxSurface): Record<string, unknown> {
  return {
    surfaceId: surface.surfaceId,
    workspaceId: surface.workspaceId,
    paneId: surface.paneId,
    tty: surface.tty,
    cwd: surface.cwd,
    runtimeSurfaceReady: surface.runtimeSurfaceReady,
    sourceSessionIds: surface.sourceSessionIds,
    identityConflict: surface.identityConflict,
    identityTrace: surface.identityTrace,
  };
}

function relatedTo(agent: AgentSnapshot, surface: CmuxSurface): boolean {
  if (agent.target.surfaceId === surface.surfaceId) return true;
  if (agent.identityTrace?.bindingBridge?.surfaceId === surface.surfaceId) return true;
  const sessionId = agent.sourceSessionId.toLowerCase();
  if (surface.sourceSessionIds.some((id) => id.toLowerCase() === sessionId)) return true;
  const trace = surface.identityTrace;
  if (!trace) return false;
  return (
    trace.openFileMatches.some((match) => match.sessionId.toLowerCase() === sessionId) ||
    trace.commandHints.some((hint) => hint.resolvedSessionId?.toLowerCase() === sessionId)
  );
}

/**
 * Read-only inspection of the session↔surface identity chain. Without an
 * `agent` query parameter it summarizes every agent; with one (a query param
 * because agent IDs like "claude:<uuid>" contain a colon) it returns the full
 * per-agent trace plus the evidence of every related surface.
 */
export function identityDebugResponse(
  url: URL,
  snapshot: HubSnapshot,
  surfaces: readonly CmuxSurface[],
  headers: Readonly<Record<string, string>>,
): Response {
  const responseHeaders = { ...headers, "cache-control": "no-store" };
  const agents = snapshot.programs.flatMap((program) => program.agents);
  const agentId = url.searchParams.get("agent");
  if (agentId === null) {
    return Response.json(
      {
        ok: true,
        generatedAt: snapshot.generatedAt,
        agents: agents.map(summarize),
        surfaceCount: surfaces.length,
        conflictedSurfaceIds: surfaces
          .filter((surface) => surface.identityConflict)
          .map((surface) => surface.surfaceId),
      },
      { headers: responseHeaders },
    );
  }
  const agent = agents.find((candidate) => candidate.id === agentId);
  if (!agent) {
    return Response.json(
      {
        ok: false,
        error: { code: "AGENT_NOT_FOUND", message: "The agent is not present in the current snapshot." },
      },
      { status: 404, headers: responseHeaders },
    );
  }
  return Response.json(
    {
      ok: true,
      generatedAt: snapshot.generatedAt,
      agent: {
        ...summarize(agent),
        sourceSessionId: agent.sourceSessionId,
        cwd: agent.cwd,
        status: agent.status,
        controlState: agent.controlState,
        target: agent.target,
        trace: agent.identityTrace,
      },
      relatedSurfaces: surfaces.filter((surface) => relatedTo(agent, surface)).map(surfaceView),
    },
    { headers: responseHeaders },
  );
}
