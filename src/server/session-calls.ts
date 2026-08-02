import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { parseClaudeJsonl, parseCodexJsonl, parseOmpJsonl } from "./collectors";
import type { CollectedAgent } from "./types";
import type { HubSnapshot } from "../shared/types";

/* The per-call series, served on demand.

   `sessionProcessed` gave this board a unit it shares with OpenBurnBar, and the
   first cross-source disagreement it produced could not be adjudicated from the
   totals alone: the board said 293,235 and BurnBar said 112,258, and nothing
   published distinguished "we overcounted" from "they stopped recording".

   Settling it took a hand recomputation from the raw transcript, which found
   that 112,258 was the sum of that session's first three calls of seven —
   BurnBar's cumulative row had stopped advancing. That is a mechanical test, and
   it is the reason this endpoint exists: a foreign total equal to a PREFIX of
   this series means the other side is behind, and one that falls BETWEEN call
   boundaries or exceeds the whole series is a real accounting disagreement.

   Note what it does and does not establish. Two records differing tells you they
   differ; it never tells you which is right, and this endpoint does not claim
   to. It publishes the board's evidence in checkable form so that a
   disagreement can be attributed by argument instead of by assumption. See
   docs/CROSS-SOURCE-DRIFT-FINDING.md.

   It re-reads the transcript rather than caching the series, following
   transcriptResponse: the series is stripped where a CollectedAgent becomes an
   AgentSnapshot, so whoever asks for it pays for it. */

export interface SessionCallsPayload {
  readonly ok: true;
  readonly agentId: string;
  readonly provider: string;
  readonly source: string | null;
  /** Per-call processed sizes in transcript order, or null when unavailable. */
  readonly calls: readonly number[] | null;
  /** Sum of `calls`. Absent rather than 0 when the series is unavailable. */
  readonly sessionProcessed: number | null;
  /** Cumulative sums, so a foreign total can be prefix-matched without re-adding. */
  readonly prefixSums: readonly number[] | null;
  /** Why `calls` is null. Absent when it is not. */
  readonly unavailable?: string;
}

/** Re-derives the agent from its transcript using the SAME parser that produced
    the published total. A second extraction written here would be a second
    derivation, and the whole value of the series is that it is the one the
    board actually added up. */
function reparse(agent: { provider: string }, source: string, text: string): CollectedAgent | null {
  const meta = { sourcePath: source };
  switch (agent.provider) {
    case "claude": return parseClaudeJsonl(text, meta);
    case "omp": return parseOmpJsonl(text, meta);
    case "codex": return parseCodexJsonl(text, meta);
    default: return null;
  }
}

/* Providers that report only session-cumulative totals have no call boundaries
   to publish. Saying so beats returning [] — an empty series asserts the
   session made no calls, which is a different and false claim. */
const NO_PER_CALL_REPORTING: Readonly<Record<string, string>> = {
  codex: "Codex reports session-cumulative totals rather than per-call usage, so this session has no call boundaries to publish.",
  cursor: "Cursor's store does not record per-call token usage.",
};

export async function sessionCallsResponse(
  snapshot: HubSnapshot,
  agentId: string,
  headers: Readonly<Record<string, string>>,
): Promise<Response> {
  const responseHeaders = { ...headers, "cache-control": "no-store" };
  const agent = snapshot.programs
    .flatMap((program) => program.agents)
    .find((candidate) => candidate.id === agentId);
  if (!agent) {
    return Response.json(
      { ok: false, error: { code: "AGENT_NOT_FOUND", message: "The agent is not present in the current snapshot." } },
      { status: 404, headers: responseHeaders },
    );
  }

  const answer = (payload: Omit<SessionCallsPayload, "ok" | "agentId" | "provider">): Response =>
    Response.json({ ok: true, agentId, provider: agent.provider, ...payload }, { headers: responseHeaders });

  const reason = NO_PER_CALL_REPORTING[agent.provider];
  const source = agent.artifacts.find((artifact) => artifact.kind === "transcript")?.path;
  if (reason) {
    return answer({ source: source ?? null, calls: null, sessionProcessed: null, prefixSums: null, unavailable: reason });
  }
  if (!source || !isAbsolute(source)) {
    return answer({
      source: null, calls: null, sessionProcessed: null, prefixSums: null,
      unavailable: "This agent has no transcript on disk, so its calls cannot be re-derived.",
    });
  }

  let parsed: CollectedAgent | null;
  try {
    parsed = reparse(agent, source, await readFile(source, "utf8"));
  } catch (error) {
    /* Loud, not empty. A transcript that has rotated away is a reason the
       series is missing, and reporting [] would let a caller conclude the
       session made no calls. */
    return answer({
      source, calls: null, sessionProcessed: null, prefixSums: null,
      unavailable: `The transcript could not be read: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  const calls = parsed?.callSizes;
  if (!calls || calls.length === 0) {
    return answer({
      source, calls: null, sessionProcessed: null, prefixSums: null,
      unavailable: "The transcript records no usage for this session.",
    });
  }

  let running = 0;
  const prefixSums = calls.map((size) => (running += size));
  return answer({ source, calls, sessionProcessed: running, prefixSums });
}
