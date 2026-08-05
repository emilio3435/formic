import type { AgentSnapshot, HubSnapshot } from "../shared/types";
import { executeControl, type ControlDependencies } from "./control";
import { hookRecordFor } from "./cmux-hook-sessions";
import { canAddressTarget, resolveAgentTarget } from "./targets";
import type { CmuxSurface, CollectedAgent } from "./types";

type FetchHandler = (request: Request) => Response | Promise<Response>;

export interface AgentLinkDependencies extends ControlDependencies {
  getSnapshot(): HubSnapshot;
  surfaces(): readonly CmuxSurface[];
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

function error(status: number, code: string, message: string): Response {
  return json({ ok: false, error: { code, message } }, status);
}

function snapshotAgents(snapshot: HubSnapshot): AgentSnapshot[] {
  return snapshot.programs.flatMap((program) => program.agents);
}

/* Target resolution still consumes CollectedAgent because it normally runs one
   layer before the wire snapshot. A durable link starts from that snapshot, so
   reconstruct only the routing facts the resolver reads. A persisted binding is
   carried as the remembered evidence it already was. Previous live and
   hook-store targets are re-attested on every link traversal. */
function routingSource(agent: AgentSnapshot): CollectedAgent {
  const recordedTarget = agent.target.attestation === "remembered"
    && agent.target.surfaceId
    ? {
        workspaceId: agent.target.workspaceId,
        surfaceId: agent.target.surfaceId,
        paneId: agent.target.paneId,
        reason: agent.target.reason,
        source: "binding" as const,
      }
    : undefined;
  return {
    id: agent.id,
    provider: agent.provider,
    sourceSessionId: agent.sourceSessionId,
    displayName: agent.displayName,
    cwd: agent.cwd,
    status: agent.status,
    statusReason: agent.statusReason,
    hookLifecycle: agent.hookLifecycle,
    updatedAt: agent.updatedAt,
    tokens: agent.tokens,
    parentSourceSessionId: agent.parentAgentId,
    artifacts: agent.artifacts,
    gates: agent.gates,
    recordedTarget,
    allowCwdFallback: agent.target.resolution === "unique-cwd"
      ? true
      : agent.provider === "cursor"
        ? false
        : undefined,
  };
}

function isRetired(agent: AgentSnapshot): boolean {
  return agent.lifecycle === "finished"
    || agent.scope === "retained"
    || agent.status === "archived"
    || agent.hookLifecycle === "ended"
    || agent.endEvidence === "session-exit"
    || agent.endEvidence === "worktree-deleted";
}

function transcriptPath(agent: AgentSnapshot): string | undefined {
  return hookRecordFor(agent.provider, agent.sourceSessionId)?.transcriptPath
    ?? agent.artifacts.find((artifact) => artifact.kind === "transcript")?.path;
}

async function handleAgentFocus(agentId: string, dependencies: AgentLinkDependencies): Promise<Response> {
  const agents = snapshotAgents(dependencies.getSnapshot());
  const index = agents.findIndex((agent) => agent.id === agentId);
  if (index < 0) return error(404, "AGENT_NOT_FOUND", "The agent is not present in the current snapshot.");

  const agent = agents[index]!;
  if (isRetired(agent) || hookRecordFor(agent.provider, agent.sourceSessionId)?.agentLifecycle === "ended") {
    const path = transcriptPath(agent);
    return path
      ? json({ transcriptPath: path })
      : error(404, "TRANSCRIPT_NOT_FOUND", "The retired agent has no recorded transcript path.");
  }

  const sources = agents.map(routingSource);
  const cmuxTarget = resolveAgentTarget(sources[index]!, dependencies.surfaces(), sources);
  const focusEnabled = canAddressTarget(cmuxTarget);
  const controls = agent.controls.some(({ action }) => action === "focus")
    ? agent.controls.map((control) => control.action === "focus"
        ? { ...control, enabled: focusEnabled, reason: focusEnabled ? undefined : cmuxTarget.reason }
        : control)
    : [...agent.controls, { action: "focus" as const, enabled: focusEnabled, reason: cmuxTarget.reason }];
  const execution = await executeControl(
    { action: "focus", agentId },
    { ...agent, target: cmuxTarget, controls },
    dependencies,
  );
  return execution.response.ok
    ? json({ cmuxTarget })
    : json(execution.response, execution.status);
}

export function createAgentLinkFetch(
  fallback: FetchHandler,
  dependencies: AgentLinkDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const match = new URL(request.url).pathname.match(/^\/agent\/([^/]+)\/focus$/);
    if (!match) return fallback(request);
    if (request.method !== "GET") return error(405, "METHOD_NOT_ALLOWED", "Use GET for agent focus links.");
    let agentId: string;
    try {
      agentId = decodeURIComponent(match[1]!);
    } catch {
      return error(400, "INVALID_AGENT_ID", "The agent ID is not valid URL encoding.");
    }
    return handleAgentFocus(agentId, dependencies);
  };
}
