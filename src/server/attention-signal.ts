/* Why an agent wants a human, read from what the agent actually wrote.

   The previous answer to that question was nextActionFor(activity, outcome,
   controlState): three enums, no content. Across a live fleet of 275 it
   produced "Review this session in history." for 248 of them — a restatement
   of `activity === "ended"` dressed as advice. A directive that is the same
   sentence on nine rows out of ten is not a directive, and the drawer lane
   removed it from the UI rather than keep rendering filler.

   Meanwhile the agent's own words were sitting in transcriptTail (present on
   274 of those 275) and lastAgentMessage (193). These detectors read them.

   Two rules hold this file honest:

   1. Deterministic. Plain string and regex tests, no model in the loop. Every
      classification is reproducible from the text alone.
   2. Silence beats filler. A detector that cannot recognise the situation
      returns "unknown" with NO nextAction, and the caller emits nothing. An
      operator can act on "it asked a question and stopped"; nobody can act on
      a sentence printed under every row on the board. */

import type {
  ActivityState,
  AgentSnapshot,
  OperatorControlState,
  OutcomeState,
  ProcessState,
} from "../shared/types";

export type AttentionSignalKind =
  /** cmux says the agent is blocked on an explicit permission prompt. */
  | "permission-requested"
  /** cmux says the agent is waiting, without naming a permission. */
  | "input-requested"
  /** The agent's last word to us was a question, and it stopped there. */
  | "question-pending"
  /** The agent proceeded on a stated assumption and invited correction. */
  | "assumption-stated"
  /** The process is gone and the transcript does not read as finished. */
  | "stopped-mid-work"
  /** Nothing in the text says why. Say so; do not invent a reason. */
  | "unknown";

export interface AttentionSignal {
  kind: AttentionSignalKind;
  /** One thing the operator can do. Absent exactly when kind is "unknown". */
  nextAction?: string;
  /** The agent's own words behind the reading, so the row can quote, not paraphrase. */
  evidence?: string;
}

export interface AttentionSignalInput {
  transcriptTail?: string | null;
  lastAgentMessage?: string | null;
  activity: ActivityState;
  processState: ProcessState;
  transcriptEndedCleanly?: boolean;
}

/* A question is a short closing line, not any paragraph that happens to end in
   "?". Prose summaries routinely close with a rhetorical flourish, and treating
   those as pending questions would rebuild the filler problem with new words. */
const MAX_QUESTION_CHARS = 220;
const MAX_EVIDENCE_CHARS = 160;

const PERMISSION_PATTERN = /\b(?:permission|approve|approval|allow|authoris|authoriz|grant access)\w*\b/i;

/* Deliberately narrow. Each of these is a phrase an agent uses to hand a
   decision back while carrying on, which is the moment a human can still cheaply
   correct it. Broad matches on "assume" alone fired on prose describing
   assumptions rather than making one. */
const ASSUMPTION_PATTERNS: readonly RegExp[] = [
  /\bI(?:'ll| will| am going to) assume\b/i,
  /\bassuming (?:that )?(?:you|we|it|this)\b[^.?!]*\bunless\b/i,
  /\bunless you(?:'d| would)? (?:prefer|rather|say)\b/i,
  /\bI(?:'ll| will) (?:proceed|continue|go) with\b[^.?!]*\bunless\b/i,
  /\btell me if (?:that|this) is wrong\b/i,
];

/* Closing lines that mean the agent finished rather than stalled. Used only to
   keep "stopped-mid-work" from firing on a session that ended on purpose. */
const COMPLETION_PATTERN =
  /\b(?:done|complete[d]?|finished|landed|shipped|committed|all (?:tests? )?pass(?:ing|ed)?|no (?:issues|vulnerabilities|findings)|nothing (?:further|else))\b/i;

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\r/g, "").trim();
}

function truncate(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length <= MAX_EVIDENCE_CHARS
    ? collapsed
    : `${collapsed.slice(0, MAX_EVIDENCE_CHARS - 1).trimEnd()}…`;
}

function lastNonEmptyLine(value: string): string {
  const lines = value.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

/* snapshot.ts appends "[Attention] <body>" to the tail when cmux reports an
   unread notification. That marker is the one place the control plane states,
   in words, that a human is being waited on — the strongest signal available
   and the only one that does not have to be inferred. */
export function attentionMarker(transcriptTail: string | null | undefined): string | undefined {
  const tail = clean(transcriptTail);
  if (!tail) return undefined;
  const marker = tail.lastIndexOf("[Attention]");
  if (marker === -1) return undefined;
  const body = tail.slice(marker + "[Attention]".length).trim();
  return body || undefined;
}

/* The agent's own final utterance. Prefer lastAgentMessage, which the collectors
   already isolate as agent-authored; fall back to the tail only when it is
   absent, since a tail can end on the operator's words and mistaking those for
   the agent's would invert the whole reading. */
function agentClosingLine(input: AttentionSignalInput): string {
  const spoken = clean(input.lastAgentMessage);
  if (spoken) return lastNonEmptyLine(spoken);
  const tail = clean(input.transcriptTail);
  if (!tail) return "";
  const line = lastNonEmptyLine(tail);
  return line.startsWith("[Attention]") ? "" : line;
}

export function detectAttentionSignal(input: AttentionSignalInput): AttentionSignal {
  const marker = attentionMarker(input.transcriptTail);
  if (marker) {
    return PERMISSION_PATTERN.test(marker)
      ? {
        kind: "permission-requested",
        nextAction: "Approve or deny the permission it is blocked on.",
        evidence: truncate(marker),
      }
      : {
        kind: "input-requested",
        nextAction: "Answer it: cmux reports it is waiting on you.",
        evidence: truncate(marker),
      };
  }

  const closing = agentClosingLine(input);

  if (closing.endsWith("?") && closing.length <= MAX_QUESTION_CHARS) {
    return {
      kind: "question-pending",
      nextAction: "Answer the question it stopped on.",
      evidence: truncate(closing),
    };
  }

  const spoken = clean(input.lastAgentMessage) || clean(input.transcriptTail);
  const assumption = ASSUMPTION_PATTERNS.map((pattern) => pattern.exec(spoken)).find(Boolean);
  if (assumption) {
    // Quote the sentence the assumption sits in, not the bare regex hit: the
    // operator is being asked to confirm a decision, and needs to see it.
    const start = spoken.lastIndexOf(".", assumption.index) + 1;
    const end = spoken.indexOf(".", assumption.index);
    return {
      kind: "assumption-stated",
      nextAction: "Confirm or correct the assumption it proceeded on.",
      evidence: truncate(spoken.slice(start, end === -1 ? undefined : end + 1)),
    };
  }

  /* Only "died" counts. A clean exit is an agent that finished, and an unknown
     process state is exactly the case this file refuses to guess about. */
  if (input.activity === "ended" && input.processState === "died" && !input.transcriptEndedCleanly) {
    const finished = COMPLETION_PATTERN.test(closing);
    if (!finished) {
      return {
        kind: "stopped-mid-work",
        nextAction: "Decide whether to resume it: the process died before the work read as finished.",
        ...(closing ? { evidence: truncate(closing) } : {}),
      };
    }
  }

  // Nothing in the text says why this agent would want a human. Say nothing.
  return { kind: "unknown" };
}

/* The snapshot fields for one agent: the content signal where there is one, a
   structural fallback only for states that name a real repair, and NOTHING
   otherwise.

   The states deliberately dropped are the ones that carried the filler:
   "Review this session in history." (a restatement of activity === "ended"),
   "Monitor current work." (what an operator is already doing by looking at the
   board) and "Focus or send a follow-up." (an affordance, not a reason). None
   of them answered why this agent, out of two hundred, wants a human.

   attentionSignal is emitted only when it says something. Its absence means
   "we could not tell from the text", which is the honest reading and cannot be
   rendered as advice by mistake. */
export function attentionFieldsFor(
  input: AttentionSignalInput,
  outcome: OutcomeState,
  controlState: OperatorControlState,
): Pick<AgentSnapshot, "nextAction" | "attentionSignal"> {
  const signal = detectAttentionSignal(input);
  if (signal.kind !== "unknown" && signal.nextAction) {
    return {
      nextAction: signal.nextAction,
      attentionSignal: {
        kind: signal.kind,
        ...(signal.evidence ? { evidence: signal.evidence } : {}),
      },
    };
  }

  // Structural states that name a repair even when the text does not.
  if (outcome === "failed") return { nextAction: "Review the failure and choose a repair." };
  if (outcome === "blocked") return { nextAction: "Resolve the reported blocker." };
  if (controlState === "quarantined" && input.activity !== "ended") {
    return { nextAction: "Resolve the cmux identity conflict to enable controls." };
  }
  return {};
}
