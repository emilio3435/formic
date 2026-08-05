export const SENDER_MESSAGE_HEAD_CHARS = 160;
export const MAX_SENDER_TRANSCRIPT_TAIL_BYTES = 1024 * 1024;

const SENDER_HEADER = /^\s*\[from\s+([^\s\]]+)\s+run\s+([^\s\]]+)\]\s*/;

export interface SenderClaim {
  agentId: string;
  runId: string;
  messageHead: string;
}

export interface SenderClaimSource {
  lastUserMessage?: string | null;
  task?: string;
}

export interface SenderTranscriptSource extends SenderClaimSource {
  id: string;
  artifacts: readonly { kind?: string; path: string }[];
}

export type SenderTranscriptTailReader = (
  path: string,
  maxBytes: number,
) => Promise<string | undefined>;

function comparableText(text: string): string {
  return text
    // Transcript JSON escapes line breaks and quotes around shell arguments.
    // Decode only those presentation differences; the words stay unchanged.
    .replace(/\\r|\\n|\\t/g, " ")
    .replace(/\\"/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function senderClaimFor(source: SenderClaimSource): SenderClaim | undefined {
  /* A present lastUserMessage is the current request and is authoritative even
     when it has no header. `task` is the first request and remains headed after
     later human follow-ups; falling through would attribute those follow-ups to
     the stale kickoff sender and then "verify" the wrong message. */
  const candidate = typeof source.lastUserMessage === "string"
    ? source.lastUserMessage
    : source.task;
  if (typeof candidate !== "string") return undefined;
  const match = SENDER_HEADER.exec(candidate);
  if (!match) return undefined;
  const [, agentId, runId] = match;
  const body = comparableText(candidate.slice(match[0].length));
  if (!agentId || !runId || !body) return undefined;
  return {
    agentId,
    runId,
    messageHead: body.slice(0, SENDER_MESSAGE_HEAD_CHARS).trimEnd(),
  };
}

/* `transcriptTails` contains only tails that were actually readable. A missing
   key therefore means unavailable evidence, while an accessible empty tail is
   affirmative evidence that the claimed send is absent. */
export function senderVerificationFor(
  source: SenderClaimSource,
  transcriptTails: ReadonlyMap<string, string>,
): boolean | undefined {
  const claim = senderClaimFor(source);
  if (!claim || !transcriptTails.has(claim.agentId)) return undefined;
  return comparableText(transcriptTails.get(claim.agentId) ?? "").includes(claim.messageHead);
}

/* Select only transcripts that can answer an active claim. Multiple recipients
   commonly share one orchestrator, so each sender tail is read at most once per
   refresh. Read failures stay absent: inability to inspect a transcript cannot
   honestly become evidence of forgery. */
export async function senderTranscriptTailsFor(
  sources: readonly SenderTranscriptSource[],
  readTail: SenderTranscriptTailReader,
): Promise<Map<string, string>> {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const claimedSenderIds = new Set(
    sources.flatMap((source) => {
      const claim = senderClaimFor(source);
      return claim ? [claim.agentId] : [];
    }),
  );
  const tails = new Map<string, string>();
  await Promise.all([...claimedSenderIds].map(async (senderId) => {
    const transcriptPath = sourceById.get(senderId)?.artifacts
      .find((artifact) => artifact.kind === "transcript")?.path;
    if (!transcriptPath) return;
    try {
      const tail = await readTail(transcriptPath, MAX_SENDER_TRANSCRIPT_TAIL_BYTES);
      if (tail !== undefined) tails.set(senderId, tail);
    } catch {
      // Unreadable is an unavailable verdict, represented by no map entry.
    }
  }));
  return tails;
}
