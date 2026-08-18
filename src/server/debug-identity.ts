import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type {
  AgentSnapshot,
  HubSnapshot,
  IdentityTraceTier,
  Provider,
  TargetResolution,
} from "../shared/types";
import { readableChatBody } from "./human-message";
import { isReplicaBlob, parseReplicaBlob } from "./grok-bot";
import { routingSurfaceObservations, type RoutingSurfaceObservation } from "./targets";
import type { CmuxSurface } from "./types";

export interface IdentityDebugSummary {
  id: string;
  provider: Provider;
  resolution: TargetResolution;
  tier?: IdentityTraceTier;
  surfaceId?: string;
  quarantined: boolean;
  cwdRelation?: "same" | "different";
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
    cwdRelation: agent.target.cwdRelation,
    bindingBridged: Boolean(
      agent.identityTrace?.bindingBridge && agent.identityTrace.matchedTier === "recorded",
    ),
  };
}

function surfaceView(
  surface: CmuxSurface,
  routeObservation?: RoutingSurfaceObservation,
): Record<string, unknown> {
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
    sourceSessionClaims: surface.sourceSessionClaims,
    sourceSessionIds: surface.sourceSessionIds,
    identityConflict: surface.identityConflict,
    routeObservation,
    identityTrace,
  };
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
  const observations = routingSurfaceObservations(agent, surfaces, agents);
  const observationBySurface = new Map(
    observations.map((observation) => [observation.surfaceId, observation]),
  );
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
      relatedSurfaces: surfaces
        .map((surface) => surfaceView(surface, observationBySurface.get(surface.surfaceId))),
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

function transcriptTimestamp(value: unknown): string | null {
  const millis = typeof value === "number"
    ? value * (value < 10_000_000_000 ? 1_000 : 1)
    : typeof value === "string"
      ? Date.parse(value)
      : Number.NaN;
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

function transcriptCandidate(
  agent: AgentSnapshot,
  row: Record<string, any>,
): { at: unknown; role: unknown; content: unknown } | undefined {
  if (agent.provider === "omp") {
    if (row.type !== "message") return undefined;
    return {
      at: row.timestamp ?? row.message?.timestamp,
      role: row.message?.role,
      content: row.message?.content,
    };
  }
  if (row.message?.content === undefined && row.content === undefined) return undefined;
  return {
    at: row.timestamp ?? row.createdAt,
    role: row.role ?? row.message?.role,
    content: row.message?.content ?? row.content,
  };
}

function pushTranscriptLine(
  lines: TranscriptLine[],
  role: unknown,
  content: unknown,
  at: unknown,
  provider: AgentSnapshot["provider"],
): void {
  const text = readableChatBody(provider, content);
  if (!text) return;
  const line: TranscriptLine = { at: transcriptTimestamp(at), role: transcriptRole(role), text };
  const previous = lines.at(-1);
  if (previous?.role === line.role && previous.text === line.text) return;
  lines.push(line);
}

function replicaTranscriptLines(agent: AgentSnapshot, contents: string): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  for (const message of parseReplicaBlob(contents).humanMessages) {
    pushTranscriptLine(lines, message.role, message.content, message.timestamp, agent.provider);
  }
  return lines;
}

type GrokSpeechDraft = {
  kind: "speech";
  at: unknown;
  role: "user" | "assistant" | "system";
  content: unknown;
};

type GrokToolDraft = {
  kind: "tool";
  at: unknown;
  callId: string;
  title?: string;
  status?: string;
  output?: string;
  historyOutput?: string;
  startedMs?: number;
  endedMs?: number;
};

type GrokTranscriptDraft = GrokSpeechDraft | GrokToolDraft;

function object(value: unknown): Record<string, any> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : undefined;
}

function grokChunkText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  const item = object(content);
  return typeof item?.text === "string" ? item.text : undefined;
}

function timestampMillis(value: unknown): number | undefined {
  const normalized = transcriptTimestamp(value);
  return normalized === null ? undefined : Date.parse(normalized);
}

function byteText(value: unknown): string | undefined {
  if (!Array.isArray(value) || !value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
    return undefined;
  }
  return new TextDecoder().decode(Uint8Array.from(value));
}

function grokToolOutput(value: unknown, depth = 0): string | undefined {
  if (typeof value === "string") return value.trim() ? value : undefined;
  if (depth > 3) return undefined;
  const bytes = byteText(value);
  if (bytes !== undefined) return bytes.trim() ? bytes : undefined;
  if (Array.isArray(value)) {
    const parts = value.flatMap((item) => {
      const part = grokToolOutput(item, depth + 1);
      return part ? [part] : [];
    });
    return parts.length > 0 ? parts.join("\n") : undefined;
  }
  const item = object(value);
  if (!item) return undefined;
  for (const key of [
    "output_for_prompt",
    "tool_output_for_prompt",
    "tool_output_for_prompt_concise",
    "content_concise",
    "raw_output",
    "content",
    "output",
    "stdout",
    "stderr",
  ]) {
    const rendered = grokToolOutput(item[key], depth + 1);
    if (rendered) return rendered;
  }
  for (const key of ["Content", "FileContent", "EditsApplied"]) {
    const rendered = grokToolOutput(item[key], depth + 1);
    if (rendered) return rendered;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function pushGrokSpeech(
  drafts: GrokTranscriptDraft[],
  role: GrokSpeechDraft["role"],
  content: string,
  at: unknown,
): void {
  const previous = drafts.at(-1);
  if (previous?.kind === "speech" && previous.role === role && typeof previous.content === "string") {
    previous.content += content;
    return;
  }
  drafts.push({ kind: "speech", at, role, content });
}

function grokToolTitle(update: Record<string, any>): string | undefined {
  if (typeof update.title === "string" && update.title.trim()) return update.title.trim();
  const metadata = object(object(update._meta)?.["x.ai/tool"]);
  for (const candidate of [metadata?.label, metadata?.name]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function enrichGrokHistory(
  drafts: GrokTranscriptDraft[],
  tools: Map<string, GrokToolDraft>,
  historyContents: string | undefined,
): void {
  if (!historyContents) return;
  const speech = {
    user: drafts.filter((draft): draft is GrokSpeechDraft => draft.kind === "speech" && draft.role === "user"),
    assistant: drafts.filter((draft): draft is GrokSpeechDraft => draft.kind === "speech" && draft.role === "assistant"),
  };
  const consumed = { user: 0, assistant: 0 };

  for (const raw of historyContents.split("\n")) {
    if (!raw.trim()) continue;
    let row: Record<string, any> | undefined;
    try {
      row = object(JSON.parse(raw));
    } catch {
      continue;
    }
    if (!row) continue;
    if (row.type === "tool_result" && typeof row.tool_call_id === "string") {
      const tool = tools.get(row.tool_call_id);
      const output = grokToolOutput(row.content);
      if (tool && output) tool.historyOutput = output;
      continue;
    }
    if (row.type === "assistant" && Array.isArray(row.tool_calls)) {
      for (const call of row.tool_calls) {
        const item = object(call);
        const tool = typeof item?.id === "string" ? tools.get(item.id) : undefined;
        if (tool && !tool.title && typeof item?.name === "string" && item.name.trim()) {
          tool.title = item.name.trim();
        }
      }
    }
    if (row.type !== "user" && row.type !== "assistant") continue;
    const role: "user" | "assistant" = row.type;
    const content = readableChatBody("grok", row.content);
    if (!content) continue;
    const target = speech[role][consumed[role]++];
    if (!target) {
      drafts.push({ kind: "speech", at: null, role, content });
      continue;
    }
    const current = readableChatBody("grok", target.content);
    if (!current || (content.length > current.length && content.includes(current))) {
      target.content = content;
    }
  }
}

function formatDuration(startedMs: number | undefined, endedMs: number | undefined): string | undefined {
  if (startedMs === undefined || endedMs === undefined || endedMs < startedMs) return undefined;
  const seconds = (endedMs - startedMs) / 1_000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
}

function grokToolLine(tool: GrokToolDraft): TranscriptLine {
  const duration = formatDuration(tool.startedMs, tool.endedMs);
  const output = tool.historyOutput ?? tool.output;
  const text = [
    tool.title ?? "Tool call",
    ...(tool.callId ? [`Call: ${tool.callId}`] : []),
    ...(tool.status ? [`Status: ${tool.status}`] : []),
    ...(duration ? [`Duration: ${duration}`] : []),
    ...(output ? [`Output:\n${output}`] : []),
  ].join("\n");
  return { at: transcriptTimestamp(tool.at), role: "tool", text };
}

function speechRole(value: unknown): GrokSpeechDraft["role"] | undefined {
  return value === "user" || value === "assistant" || value === "system" ? value : undefined;
}

function pushSpeechDraft(
  drafts: GrokTranscriptDraft[],
  role: unknown,
  content: unknown,
  at: unknown,
): void {
  const next = speechRole(role);
  if (!next || content === undefined) return;
  drafts.push({ kind: "speech", at, role: next, content });
}

function pushThoughtDraft(drafts: GrokTranscriptDraft[], text: string, at: unknown): void {
  if (!text.trim()) return;
  drafts.push({ kind: "speech", at, role: "system", content: `Thought\n${text}` });
}

function attestedText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() ? value : undefined;
  if (!Array.isArray(value)) return undefined;
  const parts = value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [item];
    const rec = object(item);
    if (!rec) return [];
    if (typeof rec.text === "string" && rec.text.trim()) return [rec.text];
    if (typeof rec.content === "string" && rec.content.trim()) return [rec.content];
    return [];
  });
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function emitTranscriptDrafts(
  drafts: GrokTranscriptDraft[],
  provider: AgentSnapshot["provider"],
): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  for (const draft of drafts) {
    if (draft.kind === "tool") {
      if (!draft.title && !draft.callId && !draft.output && !draft.historyOutput) continue;
      if (!draft.title && !draft.callId && draft.output) {
        pushTranscriptLine(lines, "tool", draft.output, draft.at, provider);
        continue;
      }
      lines.push(grokToolLine(draft));
      continue;
    }
    pushTranscriptLine(
      lines,
      draft.role,
      draft.content,
      draft.at,
      provider,
    );
  }
  return lines;
}

function upsertToolDraft(
  drafts: GrokTranscriptDraft[],
  tools: Map<string, GrokToolDraft>,
  input: {
    at: unknown;
    callId?: string;
    title?: string;
    status?: string;
    output?: string;
  },
): GrokToolDraft | undefined {
  const callId = input.callId?.trim() ?? "";
  const title = input.title?.trim() || undefined;
  const output = input.output;
  if (!callId && !title && !output) return undefined;
  const atMs = timestampMillis(input.at);
  let tool = callId ? tools.get(callId) : undefined;
  if (!tool) {
    tool = {
      kind: "tool",
      at: input.at,
      callId,
      title,
      status: input.status,
      output,
      startedMs: atMs,
    };
    if (callId) tools.set(callId, tool);
    drafts.push(tool);
    return tool;
  }
  tool.title ??= title;
  if (input.status) tool.status = input.status;
  if (output) tool.output = output;
  if (atMs !== undefined) tool.endedMs = atMs;
  return tool;
}

function claudeThinkingText(part: Record<string, any>): string | undefined {
  if (part.type === "redacted_thinking") return "[redacted]";
  if (part.type !== "thinking") return undefined;
  if (typeof part.thinking === "string") return part.thinking.trim() ? part.thinking : undefined;
  if (typeof part.text === "string") return part.text.trim() ? part.text : undefined;
  return undefined;
}

function claudeTranscriptLines(agent: AgentSnapshot, contents: string): TranscriptLine[] {
  const drafts: GrokTranscriptDraft[] = [];
  const tools = new Map<string, GrokToolDraft>();
  for (const raw of contents.split("\n")) {
    if (!raw.trim()) continue;
    let row: Record<string, any> | undefined;
    try {
      row = object(JSON.parse(raw));
    } catch {
      continue;
    }
    if (!row || !["user", "assistant", "system"].includes(String(row.type))) continue;
    const at = row.timestamp ?? row.message?.timestamp;
    const role = row.message?.role ?? row.type;
    const content = row.message?.content ?? row.content;
    if (typeof content === "string") {
      pushSpeechDraft(drafts, role, content, at);
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (typeof part === "string") {
        pushSpeechDraft(drafts, role, part, at);
        continue;
      }
      const item = object(part);
      if (!item) continue;
      const thought = claudeThinkingText(item);
      if (thought !== undefined) {
        pushThoughtDraft(drafts, thought, at);
        continue;
      }
      if (item.type === "tool_use") {
        upsertToolDraft(drafts, tools, {
          at,
          callId: typeof item.id === "string" ? item.id : undefined,
          title: typeof item.name === "string" ? item.name : undefined,
          status: "running",
        });
        continue;
      }
      if (item.type === "tool_result") {
        const output = attestedText(item.content);
        upsertToolDraft(drafts, tools, {
          at,
          callId: typeof item.tool_use_id === "string" ? item.tool_use_id : undefined,
          output,
          status: item.is_error === true ? "failed" : output || item.tool_use_id ? "completed" : undefined,
        });
        continue;
      }
      if (item.type === "text" || item.type === undefined) {
        if (typeof item.text === "string") pushSpeechDraft(drafts, role, item.text, at);
      }
    }
  }
  return emitTranscriptDrafts(drafts, agent.provider);
}

function codexReasoningSummary(payload: Record<string, any>): string | undefined {
  const from = (value: unknown): string | undefined => {
    if (typeof value === "string") return value.trim() ? value : undefined;
    if (!Array.isArray(value)) return undefined;
    const parts = value.flatMap((item) => {
      if (typeof item === "string" && item.trim()) return [item];
      const rec = object(item);
      if (!rec) return [];
      if (rec.type && rec.type !== "summary_text" && rec.type !== "summary") return [];
      return typeof rec.text === "string" && rec.text.trim() ? [rec.text] : [];
    });
    return parts.length > 0 ? parts.join("\n") : undefined;
  };
  return from(payload.summary);
}

function codexTranscriptLines(agent: AgentSnapshot, contents: string): TranscriptLine[] {
  const drafts: GrokTranscriptDraft[] = [];
  const tools = new Map<string, GrokToolDraft>();
  for (const raw of contents.split("\n")) {
    if (!raw.trim()) continue;
    let row: Record<string, any> | undefined;
    try {
      row = object(JSON.parse(raw));
    } catch {
      continue;
    }
    if (!row) continue;
    const payload = object(row.payload) ?? row;
    if (row.type === "event_msg" && payload.type === "user_message") {
      pushSpeechDraft(drafts, "user", payload.message, row.timestamp);
      continue;
    }
    if (row.type !== "response_item") continue;
    if (payload.type === "message") {
      /* Pass the attested content array through so readableChatBody still
         strips citation trailers the same way the collector close path does. */
      pushSpeechDraft(drafts, payload.role, payload.content, row.timestamp);
      continue;
    }
    if (payload.type === "reasoning") {
      const summary = codexReasoningSummary(payload);
      if (summary) pushThoughtDraft(drafts, summary, row.timestamp);
      continue;
    }
    if (payload.type === "function_call" || payload.type === "custom_tool_call") {
      upsertToolDraft(drafts, tools, {
        at: row.timestamp,
        callId: typeof payload.call_id === "string" ? payload.call_id : undefined,
        title: typeof payload.name === "string" ? payload.name : undefined,
        status: "running",
      });
      continue;
    }
    if (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") {
      const output = typeof payload.output === "string" && payload.output.trim() ? payload.output : undefined;
      upsertToolDraft(drafts, tools, {
        at: row.timestamp,
        callId: typeof payload.call_id === "string" ? payload.call_id : undefined,
        output,
        status: output ? "completed" : undefined,
      });
    }
  }
  return emitTranscriptDrafts(drafts, agent.provider);
}

function grokTranscriptLines(
  agent: AgentSnapshot,
  contents: string,
  historyContents?: string,
): TranscriptLine[] {
  const drafts: GrokTranscriptDraft[] = [];
  const tools = new Map<string, GrokToolDraft>();
  for (const raw of contents.split("\n")) {
    if (!raw.trim()) continue;
    let row: Record<string, any> | undefined;
    try {
      row = object(JSON.parse(raw));
    } catch {
      continue;
    }
    if (!row || (row.method !== "session/update" && row.method !== "_x.ai/session/update")) continue;
    const update = object(object(row.params)?.update);
    if (!update) continue;
    const content = grokChunkText(update.content);
    if (update.sessionUpdate === "user_message_chunk") {
      if (object(update._meta)?.hideFromScrollback !== true) {
        pushGrokSpeech(drafts, "user", content ?? "", row.timestamp);
      }
      continue;
    }
    if (update.sessionUpdate === "agent_message_chunk") {
      pushGrokSpeech(drafts, "assistant", content ?? "", row.timestamp);
      continue;
    }
    if (update.sessionUpdate === "agent_thought_chunk") {
      pushGrokSpeech(drafts, "system", content ?? "", row.timestamp);
      continue;
    }
    if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") continue;
    if (typeof update.toolCallId !== "string" || !update.toolCallId.trim()) continue;
    let tool = tools.get(update.toolCallId);
    const atMs = timestampMillis(row.timestamp);
    if (!tool) {
      tool = {
        kind: "tool",
        at: row.timestamp,
        callId: update.toolCallId,
        startedMs: atMs,
        endedMs: atMs,
      };
      tools.set(update.toolCallId, tool);
      drafts.push(tool);
    }
    tool.title ??= grokToolTitle(update);
    if (typeof update.status === "string" && update.status.trim()) tool.status = update.status.trim();
    const output = grokToolOutput(update.rawOutput) ?? grokToolOutput(update.content);
    if (output) tool.output = output;
    if (atMs !== undefined) tool.endedMs = atMs;
  }

  enrichGrokHistory(drafts, tools, historyContents);
  const lines: TranscriptLine[] = [];
  for (const draft of drafts) {
    if (draft.kind === "tool") {
      lines.push(grokToolLine(draft));
      continue;
    }
    pushTranscriptLine(
      lines,
      draft.role,
      draft.role === "system" ? `Thought\n${draft.content}` : draft.content,
      draft.at,
      agent.provider,
    );
  }
  return lines;
}

export function transcriptLines(
  agent: AgentSnapshot,
  contents: string,
  historyContents?: string,
): TranscriptLine[] {
  /* Grok Bot sand replicas are one JSON envelope, not JSONL. Splitting on
     newlines leaves the root object (no content/message) and an empty feed. */
  if (isReplicaBlob(contents)) return replicaTranscriptLines(agent, contents);
  if (agent.provider === "grok") return grokTranscriptLines(agent, contents, historyContents);
  /* Claude and Codex thoughts/tools use the same inspector wire as Grok:
     system text `Thought\n…` and role `tool` cards. spoken-text helpers stay
     on text/output_text only so last-close cannot leak thinking or tool guts. */
  if (agent.provider === "claude") return claudeTranscriptLines(agent, contents);
  if (agent.provider === "codex") return codexTranscriptLines(agent, contents);

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
    pushTranscriptLine(lines, candidate.role, candidate.content, candidate.at, agent.provider);
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
    const contents = await readFile(source, "utf8");
    let historyContents: string | undefined;
    if (agent.provider === "grok") {
      try {
        historyContents = await readFile(join(dirname(source), "chat_history.jsonl"), "utf8");
      } catch {
        // The history is optional enrichment; updates.jsonl remains authoritative.
      }
    }
    const lines = transcriptLines(agent, contents, historyContents);
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
