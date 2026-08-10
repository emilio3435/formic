import { readFileSync } from "node:fs";
import type { CollectedAgent } from "./types";
import type { IncrementalParser, ParseMetadata } from "./collectors";
import type { TokenUsage } from "../shared/types";
import { resolveAgentName } from "./naming";
import { MAX_HEARTBEAT_TAIL_CHARS, capTranscriptTail } from "./types";
import { MODEL_CONFIG } from "./model-config";
import { claudeContextWindow } from "./collectors";

const PRIME_HEARTBEAT_MONITOR_SESSION_ID = "ant-heartbeat-monitor";

/* Prime Agent sessions — the orchestrator itself.

   Prime writes:
     ~/.prime/agent/sessions/<uuid>.jsonl   transcript (session, model_change, message, agent_status)
   No settings sibling — model lives in the transcript's model_change / message.model.
   We map the *provider* inside the session (meta/xai/openai-codex) to the Ant Hill
   model display, but the harness is always "prime" — that's the point of
   harness ≠ agent. So a session with provider=meta model=muse-spark-1.2 renders
   as [Prime] + [Spark 1.2].
*/

function text(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function createPrimeParser(): IncrementalParser {
  let sessionId: string | undefined;
  let cwd: string | undefined;
  let originCwd: string | undefined;
  let startedAt: string | undefined;
  let updatedAt: string | undefined;
  let model: string | undefined; // agent model, e.g. muse-spark-1.2-contributor
  let providerInside: string | undefined; // meta/xai etc — not used for harness
  let task: string | undefined;
  let tail: string | undefined;
  let messages = 0;
  let lastUsage: { input?: number; output?: number; cachedInput?: number; total?: number } | undefined;
  let sessionTotal = 0;
  let sessionCachedInput = 0;
  let callSizes: number[] = [];

  const append = (rows: readonly Record<string, unknown>[]): void => {
    for (const row of rows) {
      if (row.type === "session" && typeof row.id === "string") {
        sessionId ??= row.id.toLowerCase();
        if (typeof row.cwd === "string") {
          cwd ??= row.cwd;
          originCwd ??= row.cwd;
        }
        if (typeof row.timestamp === "string" && Number.isFinite(Date.parse(row.timestamp))) {
          const iso = new Date(row.timestamp).toISOString();
          startedAt ??= iso;
          updatedAt = iso;
        }
        continue;
      }
      if (row.type === "model_change" && typeof (row as any).modelId === "string") {
        model = (row as any).modelId;
        providerInside = (row as any).provider;
        continue;
      }
      if (row.type !== "message") continue;
      messages += 1;
      const ts = text((row as any).timestamp) || text((row as any).message?.timestamp);
      if (ts && Number.isFinite(Date.parse(ts))) {
        const iso = new Date(ts).toISOString();
        startedAt ??= iso;
        updatedAt = iso;
      }
      const msg = (row as any).message as Record<string, unknown> | undefined;
      if (!msg) continue;
      // capture model from message if not yet set
      if (typeof msg.model === "string" && !model) model = msg.model;
      // capture usage for token accounting
      const usage = (msg as any).usage as Record<string, unknown> | undefined;
      if (usage && msg.role === "assistant" && typeof usage.input === "number" && typeof usage.output === "number") {
        const inp = Number(usage.input) || 0;
        const out = Number(usage.output) || 0;
        const cached = Number(usage.cacheRead ?? usage.cachedInput ?? 0) || 0;
        const tot = Number(usage.totalTokens ?? inp + out + cached) || inp + out + cached;
        lastUsage = { input: inp, output: out, cachedInput: cached, total: tot };
        const callSize = inp + out + cached;
        callSizes.push(callSize);
        sessionTotal += inp + out;
        sessionCachedInput += cached;
      }
      // task = first user text
      if (msg.role === "user" && !task) {
        const c = msg.content as unknown;
        let t: string | undefined;
        if (typeof c === "string") t = c.trim();
        else if (Array.isArray(c)) t = c.map((p: any) => typeof p.text === "string" ? p.text : "").join("\n").trim();
        if (t) task = t.slice(0, 500);
      }
      // tail = last assistant text
      if (msg.role === "assistant") {
        const c = msg.content as unknown;
        let t: string | undefined;
        if (typeof c === "string") t = c.trim();
        else if (Array.isArray(c)) t = c.map((p: any) => typeof p.text === "string" ? p.text : (typeof p.content === "string" ? p.content : "")).join("\n").trim();
        /* Accumulate generously; the per-agent cap is applied once at result()
           via capTranscriptTail, so an envelope head survives collection. */
        if (t) tail = t.slice(-MAX_HEARTBEAT_TAIL_CHARS);
      }
    }
  };

  const result = (meta: ParseMetadata): CollectedAgent | null => {
    if (!sessionId) return null;
    if (!messages) return null; // no turns yet
    const fallback = new Date(meta.mtimeMs ?? meta.nowMs ?? Date.now()).toISOString();
    const agentModel = model || "prime";
    const contextWindow = claudeContextWindow(agentModel, MODEL_CONFIG) ?? (agentModel.toLowerCase().includes("spark") ? 1_000_000 : agentModel.toLowerCase().includes("grok") ? 131_072 : undefined);
    const tokens: TokenUsage = lastUsage
      ? {
          input: lastUsage.input,
          output: lastUsage.output,
          cachedInput: lastUsage.cachedInput,
          total: lastUsage.total,
          sessionTotal,
          sessionCachedInput,
          sessionProcessed: callSizes.length ? callSizes.reduce((a,b)=>a+b,0) : undefined,
          contextWindow,
          scope: "latest-turn" as const,
          provenance: "observed" as const,
        }
      : { provenance: "unknown" as const, contextWindow };
    /* This exact reserved source is a synthetic infrastructure mailbox, not an
       interactive Prime session. The declaration classifies what it is; it
       deliberately contributes no process, surface, target, or route. */
    const sessionDeclaration: Pick<CollectedAgent, "sessionKind" | "sessionKindSource"> =
      sessionId === PRIME_HEARTBEAT_MONITOR_SESSION_ID
        ? { sessionKind: "system", sessionKindSource: "declared" }
        : {};
    return {
      id: `prime:${sessionId}`,
      provider: "prime",
      sourceSessionId: sessionId,
      displayName: `Prime · ${sessionId.slice(0, 8)}`,
      identity: resolveAgentName({
        provider: "prime",
        sourceSessionId: sessionId,
        originCwd: cwd,
        taskName: task,
      }),
      cwd,
      originCwd,
      ...sessionDeclaration,
      model: agentModel,
      task,
      startedAt: startedAt ?? fallback,
      updatedAt: updatedAt ?? fallback,
      tokens,
      transcriptTail: capTranscriptTail(tail),
      humanMessages: [],
      statusReason: "Prime agent — harness prime, agent " + agentModel,
      transcriptEndedCleanly: false,
      endEvidence: undefined,
      meta,
      artifacts: [],
      gates: [],
    } as unknown as CollectedAgent;
  };

  return { append, result };
}

export function parsePrimeJsonl(jsonl: string, meta: ParseMetadata = {}): CollectedAgent | null {
  const parser = createPrimeParser();
  const rows: Record<string, unknown>[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try { const v = JSON.parse(line); if (v && typeof v === "object") rows.push(v); } catch {}
  }
  parser.append(rows);
  return parser.result(meta);
}
