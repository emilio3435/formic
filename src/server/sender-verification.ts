export const SENDER_MESSAGE_HEAD_CHARS = 160;
export const MIN_TRUNCATED_SENDER_MESSAGE_HEAD_CHARS = 100;
export const MAX_SENDER_TRANSCRIPT_TAIL_BYTES = 1024 * 1024;

const SENDER_HEADER = /^\s*\[from\s+([^\s\]]+)\s+run\s+([^\s\]]+)\]\s*/;

export interface SenderClaim {
  agentId: string;
  runId: string;
  messageHead: string;
  messageHeadTruncated: boolean;
}

export interface SenderClaimSource {
  lastUserMessage?: string | null;
  task?: string;
}

export interface SenderTranscriptSource extends SenderClaimSource {
  id: string;
  artifacts: readonly { kind?: string; path: string }[];
}

export interface SenderTranscriptEvidence {
  text: string;
  complete: boolean;
}

export type SenderTranscriptTailReader = (
  path: string,
  maxBytes: number,
) => Promise<SenderTranscriptEvidence | undefined>;

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
  const messageHeadTruncated = body.endsWith("…");
  const comparableBody = messageHeadTruncated ? body.slice(0, -1).trimEnd() : body;
  if (!comparableBody) return undefined;
  return {
    agentId,
    runId,
    messageHead: comparableBody.slice(0, SENDER_MESSAGE_HEAD_CHARS).trimEnd(),
    messageHeadTruncated,
  };
}

/* A bounded tail can prove presence, but only a complete transcript can prove
   absence. A wire-truncated head is weaker still: after stripping its U+2026
   marker, a long prefix may verify the send but can never prove forgery. */
export function senderVerificationFor(
  source: SenderClaimSource,
  transcriptTails: ReadonlyMap<string, SenderTranscriptEvidence>,
): boolean | undefined {
  const claim = senderClaimFor(source);
  const transcript = claim ? transcriptTails.get(claim.agentId) : undefined;
  if (!claim || !transcript) return undefined;
  const matches = comparableText(transcript.text).includes(claim.messageHead);
  if (claim.messageHeadTruncated) {
    return matches && claim.messageHead.length >= MIN_TRUNCATED_SENDER_MESSAGE_HEAD_CHARS
      ? true
      : undefined;
  }
  if (matches) return true;
  return transcript.complete ? false : undefined;
}

/* Select only transcripts that can answer an active claim. Multiple recipients
   commonly share one orchestrator, so each sender tail is read at most once per
   refresh. Read failures stay absent: inability to inspect a transcript cannot
   honestly become evidence of forgery. */
export async function senderTranscriptTailsFor(
  sources: readonly SenderTranscriptSource[],
  readTail: SenderTranscriptTailReader,
): Promise<Map<string, SenderTranscriptEvidence>> {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const claimedSenderIds = new Set(
    sources.flatMap((source) => {
      const claim = senderClaimFor(source);
      return claim ? [claim.agentId] : [];
    }),
  );
  const tails = new Map<string, SenderTranscriptEvidence>();
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
