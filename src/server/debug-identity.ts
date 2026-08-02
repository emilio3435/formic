import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type {
  AgentSnapshot,
  HubSnapshot,
  IdentityTraceTier,
  Provider,
  TargetResolution,
} from "../shared/types";
import { readableHumanMessage } from "./human-message";
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
  const identityTrace = surface.identityTrace
    ? {
        ...surface.identityTrace,
        processes: surface.identityTrace.processes.map((process) => ({
          ...process,
          command: "[redacted]",
        })),
      }
    : undefined;
  return {
    surfaceId: surface.surfaceId,
    workspaceId: surface.workspaceId,
    paneId: surface.paneId,
    tty: surface.tty,
    cwd: surface.cwd,
    runtimeSurfaceReady: surface.runtimeSurfaceReady,
    sourceSessionIds: surface.sourceSessionIds,
    identityConflict: surface.identityConflict,
    identityTrace,
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

export interface TranscriptLine {
  at: string | null;
  role: "user" | "assistant" | "tool" | "system" | "unknown";
  text: string;
}

function transcriptRole(value: unknown): TranscriptLine["role"] {
  return value === "user" || value === "assistant" || value === "tool" || value === "system"
    ? value
    : "unknown";
}

function transcriptCandidate(
  agent: AgentSnapshot,
  row: Record<string, any>,
): { at: unknown; role: unknown; content: unknown } | undefined {
  if (agent.provider === "codex") {
    const payload = row.payload ?? row;
    if (row.type === "event_msg" && payload.type === "user_message") {
      return { at: row.timestamp, role: "user", content: payload.message };
    }
    if (row.type !== "response_item") return undefined;
    if (payload.type === "message") {
      return { at: row.timestamp, role: payload.role, content: payload.content };
    }
    if (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") {
      return { at: row.timestamp, role: "tool", content: payload.output };
    }
    return undefined;
  }
  if (agent.provider === "omp") {
    if (row.type !== "message") return undefined;
    return {
      at: row.timestamp ?? row.message?.timestamp,
      role: row.message?.role,
      content: row.message?.content,
    };
  }
  if (agent.provider === "claude") {
    if (!["user", "assistant", "system"].includes(String(row.type))) return undefined;
    return {
      at: row.timestamp ?? row.message?.timestamp,
      role: row.message?.role ?? row.type,
      content: row.message?.content ?? row.content,
    };
  }
  if (row.message?.content === undefined && row.content === undefined) return undefined;
  return {
    at: row.timestamp ?? row.createdAt,
    role: row.role ?? row.message?.role,
    content: row.message?.content ?? row.content,
  };
}

function transcriptLines(agent: AgentSnapshot, contents: string): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  for (const raw of contents.split("\n")) {
    if (!raw.trim()) continue;
    let row: unknown;
    try {
      row = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const candidate = transcriptCandidate(agent, row as Record<string, any>);
    if (!candidate) continue;
    const text = readableHumanMessage(agent.provider, candidate.content);
    if (!text) continue;
    const timestamp = typeof candidate.at === "string" && Number.isFinite(Date.parse(candidate.at))
      ? new Date(candidate.at).toISOString()
      : null;
    const line: TranscriptLine = { at: timestamp, role: transcriptRole(candidate.role), text };
    const previous = lines.at(-1);
    if (previous?.role === line.role && previous.text === line.text) continue;
    lines.push(line);
  }
  return lines;
}

export async function transcriptResponse(
  snapshot: HubSnapshot,
  agentId: string,
  limit: number,
  headers: Readonly<Record<string, string>>,
): Promise<Response> {
  const responseHeaders = { ...headers, "cache-control": "no-store" };
  const agent = snapshot.programs
    .flatMap((program) => program.agents)
    .find((candidate) => candidate.id === agentId);
  if (!agent) {
    return Response.json(
      {
        ok: false,
        error: { code: "AGENT_NOT_FOUND", message: "The agent is not present in the current snapshot." },
      },
      { status: 404, headers: responseHeaders },
    );
  }
  const source = agent.artifacts.find((artifact) => artifact.kind === "transcript")?.path;
  if (!source || !isAbsolute(source)) {
    return Response.json(
      { ok: true, agentId, source: null, truncated: false, lines: [] },
      { headers: responseHeaders },
    );
  }
  try {
    const lines = transcriptLines(agent, await readFile(source, "utf8"));
    if (lines.length === 0) {
      return Response.json(
        { ok: true, agentId, source, truncated: false, lines: [] },
        { headers: responseHeaders },
      );
    }
    return Response.json(
      {
        ok: true,
        agentId,
        source,
        truncated: lines.length > limit,
        lines: lines.slice(-limit),
      },
      { headers: responseHeaders },
    );
  } catch (error) {
    /* A transcript we could not read is not a session with nothing to say.
       Returning the same {source:null, lines:[]} envelope as the no-artifact
       branch above asserted that no evidence exists, when the truth is that the
       evidence was unreachable — the strongest available claim made from the
       weakest available position. Keep the path we tried, and say what stopped
       us, so "gone" and "never had one" stay distinguishable. */
    return Response.json(
      {
        ok: true,
        agentId,
        source,
        truncated: false,
        lines: [],
        error: (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "The transcript file is no longer present."
          : error instanceof Error ? error.message : String(error),
      },
      { headers: responseHeaders },
    );
  }
}
