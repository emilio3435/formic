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
  /** It laid out alternatives and handed the choice back. */
  | "fork-unresolved"
  /** The agent's last word to us was a question, and it stopped there. */
  | "question-pending"
  /** The agent proceeded on a stated assumption and invited correction. */
  | "assumption-stated"
  /** The process is gone and the transcript does not read as finished. */
  | "stopped-mid-work"
  /** It ended while saying, in its own words, that work was left over. */
  | "exited-unlanded"
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
  /* The agent's closing words, role-attributed by the collector. This is the
     field that made the content detectors possible: lastAgentMessage is a front
     window (first 240 chars) so a question asked after an explanation never
     reached here, and the transcript tail cannot be attributed because its last
     line may be the operator's. */
  lastAgentClosing?: string | null;
  /* The cmux notification body, straight from the control plane.
     This used to be recovered by scanning transcriptTail for the "[Attention]"
     marker snapshot.ts appends — which an agent can simply write. Measured
     live: two sessions discussing the marker in their own transcripts were
     classified as blocked on a permission prompt, one of them while explaining
     that exact spoof. Evidence about whether a human is being waited on has to
     come from the control plane, not from text the agent authors. */
  attentionNotification?: string | null;
  activity: ActivityState;
  processState: ProcessState;
  transcriptEndedCleanly?: boolean;
}

const MAX_EVIDENCE_CHARS = 160;

/* A pending question is an INTERROGATIVE clause that the message ends on — not
   merely a paragraph whose last character is "?".

   The first version capped the closing at 220 characters instead, on the theory
   that a real question is short. Measured live, that was wrong in both
   directions: three closings ended in "?" and it recognised one, rejecting a
   222-character "Want me to write a one-page README that ties both programs
   together …?" and a 241-character list that ended "Which would help?" — both
   genuine asks with a long run-up. Length was never the property that made them
   questions; the interrogative clause was.

   Anchored to the end and bounded, so a narrative that merely contains "is"
   somewhere cannot match, and the capture is the question itself rather than
   the paragraph in front of it. */
/* The last alternative catches a lost line break. Message cleaning flattens
   markdown bullets into one line, so "…easier upload\nWhich would help?" arrives
   with no punctuation at all between the list item and the question. A capital
   directly after a lowercase word is where that break used to be. */
const PENDING_QUESTION =
  /(?:^|[.!?;:,—–-]\s*|\s(?:and|or|but|so)\s|(?<=[a-z])\s(?=[A-Z]))((?:want|should|shall|do|does|did|would|could|can|will|which|what|why|how|who|whom)\b[^?]{0,200}\?)$/i;

const INTERROGATIVE_OPENER =
  /^[…\s"'(-]*(?:want|should|shall|do|does|did|would|could|can|will|which|what|why|how|who|whom)\b/i;

function pendingQuestion(closing: string): string | undefined {
  const sentence = finalSentence(closing);
  if (!sentence.endsWith("?")) return undefined;
  /* When the sentence OPENS on the interrogative, the whole sentence is the
     question and quoting a sub-clause of it would hand the operator a fragment.
     Otherwise take the LAST interrogative clause, which is the actual ask at the
     end of a longer run-up — the first one is usually narration ("I could
     sharpen the faces …") that happens to share a word with a question. */
  if (INTERROGATIVE_OPENER.test(sentence)) return sentence.replace(/^…\s*/, "");
  /* The EARLIEST clause-initial match. Every match is anchored to the final "?",
     so the earliest one is the outermost — the whole question rather than a tail
     of it ("would help?" instead of "Which would help?"). The clause boundary is
     what makes this safe: narration like "I could sharpen the faces" is not
     clause-initial, so it cannot open a match. */
  return PENDING_QUESTION.exec(sentence)?.[1]?.trim();
}

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

/* A fork is a choice handed back, not merely a sentence containing "or". Each
   pattern requires BOTH named alternatives and an explicit hand-off, because
   "I checked the cache or the index" is narration and must not raise a decision
   the operator never has to make. */
const FORK_PATTERNS: readonly RegExp[] = [
  /\bwhich (?:one )?(?:would|do) you (?:prefer|want|like|pick|choose)\b/i,
  /\blet me know which\b/i,
  /\b(?:do|would) you want me to\b[^.?!]*\bor\b[^.?!]*\?/i,
  /\b(?:should|shall) (?:i|we)\b[^.?!]*\bor\b[^.?!]*\?/i,
  /\beither\b[^.?!]*\bor\b[^.?!]*\?/i,
  /\boption\s+(?:a|1|one)\b[\s\S]{0,400}?\boption\s+(?:b|2|two)\b/i,
  /\btwo (?:options|choices|paths|ways)\b/i,
];

/* Positive evidence that work was left over. Deliberately NOT "no completion
   marker found": absence of a phrase is not evidence of unfinished work, and
   inferring from absence is how a detector starts firing on nine rows out of
   ten again. The agent has to say it. */
const UNLANDED_PATTERNS: readonly RegExp[] = [
  /\bstill (?:need|needs|needed|to do|outstanding|pending)\b/i,
  /\bnot (?:yet )?(?:done|finished|landed|committed|merged|complete)\b/i,
  /\b(?:have|has) not yet\b|\bhaven'?t yet\b/i,
  /\bnext steps?\b\s*[:—-]/i,
  /\b(?:remaining|outstanding) (?:work|tasks?|items?|findings?)\b/i,
  /\bstill in progress\b/i,
  /\bwill (?:continue|resume|pick (?:this|it) up)\b/i,
  /\bran out of (?:time|context|budget)\b/i,
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

/* The last SENTENCE, not the last window. The length guard on questions exists
   to reject paragraphs that merely trail off in a question mark, but the
   attributed closing arrives as a fixed 240-character slice — so measuring the
   whole slice threw away real questions for being preceded by too much
   explanation. Measured live: three closings ended in "?" and only one was
   recognised, purely because the other two carried a longer run-up. */
function finalSentence(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  // The trailing [.!?]? matters: without it the lookahead fails on exactly the
  // sentences this exists for, the ones ending in "?".
  const boundary = collapsed.search(/(?:[.!?])\s+(?=[^.!?]*[.!?]?$)/);
  return boundary === -1 ? collapsed : collapsed.slice(boundary + 1).trim();
}

/* Machine data that survived message cleaning. A closing line is the END of a
   message, so a turn that finishes by dumping JSON, a diff hunk or a log line
   lands here even when its opening prose was clean. Measured live: a serialized
   finding blob ("fingerprint":"…/PYTHON_VERSION_REQUIREMENTS.md:138") matched an
   unfinished-work phrase and asked the operator to pick up work nobody left. */
const MACHINE_TEXT = /\{"|"\}|":\s*"|\[\{|\}\]|^\s*[+-]{3}\s|\b[\w./-]+:\d+:\d+\b|\{\s*\w+\s*=|\w+="[^"]*"/;

function isMachineText(value: string): boolean {
  return MACHINE_TEXT.test(value);
}

/* The agent's own final utterance. Prefer lastAgentMessage, which the collectors
   already isolate as agent-authored; fall back to the tail only when it is
   absent, since a tail can end on the operator's words and mistaking those for
   the agent's would invert the whole reading. */
function agentClosingLine(input: AttentionSignalInput): string {
  /* lastAgentClosing is end-anchored AND attributed, so it is the only source
     that can answer "what did the agent stop on". The others are fallbacks for
     collectors that do not populate it yet: lastAgentMessage is a front window
     (a question after an explanation is not in it), and the transcript tail is
     an unattributed slice whose final line may be the operator's — reading that
     as the agent's question inverts who is waiting for whom. */
  const closing = clean(input.lastAgentClosing);
  if (closing) return isMachineText(closing) ? "" : lastNonEmptyLine(closing);
  const spoken = clean(input.lastAgentMessage);
  if (spoken) return isMachineText(spoken) ? "" : lastNonEmptyLine(spoken);
  const tail = clean(input.transcriptTail);
  if (!tail) return "";
  const line = lastNonEmptyLine(tail);
  if (line.startsWith("[Attention]") || isMachineText(line)) return "";
  return line;
}

export function detectAttentionSignal(input: AttentionSignalInput): AttentionSignal {
  const marker = clean(input.attentionNotification) || undefined;
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

  /* Checked before question-pending: a fork IS a question, but "choose between
     these two" is a more useful instruction than "answer it", and the operator
     can act on it without reading the transcript first. */
  const forkSource = closing || clean(input.lastAgentClosing);
  if (forkSource && !isMachineText(forkSource) && FORK_PATTERNS.some((pattern) => pattern.test(forkSource))) {
    return {
      kind: "fork-unresolved",
      nextAction: "Pick one of the options it stopped between.",
      evidence: truncate(forkSource),
    };
  }

  const question = pendingQuestion(closing);
  if (question) {
    return {
      kind: "question-pending",
      nextAction: "Answer the question it stopped on.",
      evidence: truncate(question),
    };
  }

  const spokenRaw = clean(input.lastAgentClosing) || clean(input.lastAgentMessage) || clean(input.transcriptTail);
  const spoken = isMachineText(spokenRaw) ? "" : spokenRaw;
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

  /* Ended while saying work was left over. Weaker than a dead process — the
     session may have exited perfectly cleanly — so it needs the agent to have
     SAID so, and it is checked after the crash case which has harder evidence. */
  if (input.activity === "ended") {
    const spokenAll = clean(input.lastAgentClosing) || clean(input.lastAgentMessage);
    const unlanded = spokenAll && !isMachineText(spokenAll)
      ? UNLANDED_PATTERNS.find((pattern) => pattern.test(spokenAll))
      : undefined;
    if (unlanded && !COMPLETION_PATTERN.test(closing)) {
      return {
        kind: "exited-unlanded",
        nextAction: "Pick up the work it named as unfinished, or close it out.",
        evidence: truncate(spokenAll),
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
