import { describe, expect, test } from "bun:test";
import {
  attentionFieldsFor,
  attentionMarker,
  detectAttentionSignal,
  type AttentionSignalInput,
} from "../src/server/attention-signal";

/* The layer these tests cover replaced nextActionFor(activity, outcome,
   controlState), which read no content and answered "Review this session in
   history." for 248 of 275 live agents.

   Two properties matter more than any individual detector:
     - a recognised situation is named in the agent's own words, and
     - an unrecognised one produces NOTHING, because filler on nine rows out of
       ten is what made the old layer unreadable.
   The second is the easier one to regress, so it is tested hardest. */

function input(overrides: Partial<AttentionSignalInput> = {}): AttentionSignalInput {
  return {
    transcriptTail: null,
    lastAgentMessage: null,
    activity: "idle",
    processState: "running",
    ...overrides,
  };
}

describe("attention signal detectors", () => {
  test("a cmux permission prompt is named as a permission, not as generic waiting", () => {
    const signal = detectAttentionSignal(input({
      transcriptTail: "Same conflict, and I already know the resolution. Applying it.\n\n[Attention] Claude needs your permission to run git push",
    }));

    expect(signal.kind).toBe("permission-requested");
    expect(signal.nextAction).toContain("Approve or deny");
    // The operator sees what they are approving, quoted rather than paraphrased.
    expect(signal.evidence).toContain("needs your permission");
  });

  test("a cmux wait that names no permission stays the weaker claim", () => {
    const signal = detectAttentionSignal(input({
      transcriptTail: "Fix or delete them and report the count.\n\n[Attention] Claude is waiting for your input",
    }));

    expect(signal.kind).toBe("input-requested");
    expect(signal.evidence).toBe("Claude is waiting for your input");
  });

  test("a question the agent stopped on is recognised and quoted", () => {
    const signal = detectAttentionSignal(input({
      lastAgentMessage: "I can go either way here.\nWant the full accounting against all 79 findings, or is the working state enough?",
    }));

    expect(signal.kind).toBe("question-pending");
    expect(signal.nextAction).toBe("Answer the question it stopped on.");
    expect(signal.evidence).toBe("Want the full accounting against all 79 findings, or is the working state enough?");
  });

  test("a long paragraph that merely ends in a question mark is not a pending question", () => {
    /* Prose summaries close on rhetorical questions all the time. Treating those
       as "this agent is waiting on you" would rebuild the filler problem with
       new words, which is the exact failure being fixed. */
    const rhetorical = "a".repeat(240) + "?";
    const signal = detectAttentionSignal(input({ lastAgentMessage: rhetorical }));

    expect(signal.kind).toBe("unknown");
    expect(signal.nextAction).toBeUndefined();
  });

  test("a stated assumption is surfaced with the sentence it lives in", () => {
    const signal = detectAttentionSignal(input({
      lastAgentMessage: "The spec is ambiguous about retries. I'll assume three attempts with backoff unless you say otherwise. Moving on to the writer.",
    }));

    expect(signal.kind).toBe("assumption-stated");
    expect(signal.nextAction).toContain("Confirm or correct");
    expect(signal.evidence).toContain("three attempts with backoff");
  });

  test("prose that describes assumptions in the abstract is not a stated assumption", () => {
    const signal = detectAttentionSignal(input({
      lastAgentMessage: "The report lists every assumption the previous lane made about retry behaviour.",
    }));

    expect(signal.kind).toBe("unknown");
  });

  test("a died process whose work does not read as finished is flagged for a resume decision", () => {
    const signal = detectAttentionSignal(input({
      activity: "ended",
      processState: "died",
      lastAgentMessage: "Rewriting the migration now; the first two tables are converted and the third",
    }));

    expect(signal.kind).toBe("stopped-mid-work");
    expect(signal.nextAction).toContain("resume");
  });

  test("a died process that had already finished is left alone", () => {
    // Exiting after the work landed is not an incident, and the board must not
    // ask for a decision that has already been made.
    const signal = detectAttentionSignal(input({
      activity: "ended",
      processState: "died",
      lastAgentMessage: "All 18 guards pass and the branch is committed. Done.",
    }));

    expect(signal.kind).toBe("unknown");
  });

  test("a clean exit is never stopped-mid-work, whatever the transcript says", () => {
    const signal = detectAttentionSignal(input({
      activity: "ended",
      processState: "exited",
      lastAgentMessage: "Converting the third table and then",
      transcriptEndedCleanly: true,
    }));

    expect(signal.kind).toBe("unknown");
  });

  test("an ordinary finished session says nothing at all", () => {
    /* This is the 90% case. Under the old layer every one of these rows read
       "Review this session in history." */
    const signal = detectAttentionSignal(input({
      activity: "ended",
      processState: "exited",
      lastAgentMessage: "No security vulnerabilities identified in this diff.",
      transcriptTail: "No source→sink path with a plausible attacker-controllable impact.",
    }));

    expect(signal).toEqual({ kind: "unknown" });
  });

  test("an agent with no text at all is unknown rather than guessed at", () => {
    expect(detectAttentionSignal(input())).toEqual({ kind: "unknown" });
  });

  test("the operator's own closing words are never read as the agent's question", () => {
    /* A tail can end on the human's message. Reading that as the agent asking
       something inverts who is waiting for whom, so the tail is only consulted
       when the agent's own last message is absent — and even then a trailing
       [Attention] marker is not treated as speech. */
    const signal = detectAttentionSignal(input({
      lastAgentMessage: "Applying the fix now.",
      transcriptTail: "Applying the fix now.\n\nShould we also bump the timeout?",
    }));

    expect(signal.kind).toBe("unknown");
  });
});

describe("attentionMarker", () => {
  test("reads the last marker, so an older one cannot outrank the current state", () => {
    expect(attentionMarker("[Attention] older\n\nwork\n\n[Attention] newest")).toBe("newest");
  });

  test("absent, empty and marker-less tails are all undefined", () => {
    expect(attentionMarker(null)).toBeUndefined();
    expect(attentionMarker("")).toBeUndefined();
    expect(attentionMarker("just a transcript")).toBeUndefined();
    expect(attentionMarker("trailing marker with no body\n\n[Attention]")).toBeUndefined();
  });
});

describe("attentionFieldsFor", () => {
  test("content beats structure: a question outranks the failed-outcome fallback", () => {
    const fields = attentionFieldsFor(
      input({ lastAgentMessage: "Should I roll back the migration or patch forward?" }),
      "failed",
      "linked",
    );

    expect(fields.attentionSignal?.kind).toBe("question-pending");
    expect(fields.nextAction).toBe("Answer the question it stopped on.");
  });

  test("structural states that name a real repair still speak when the text does not", () => {
    expect(attentionFieldsFor(input(), "failed", "linked").nextAction)
      .toBe("Review the failure and choose a repair.");
    expect(attentionFieldsFor(input(), "blocked", "linked").nextAction)
      .toBe("Resolve the reported blocker.");
    expect(attentionFieldsFor(input(), "healthy", "quarantined").nextAction)
      .toContain("identity conflict");
  });

  test("an ended quarantined session is not told to fix controls it will never use", () => {
    const fields = attentionFieldsFor(input({ activity: "ended" }), "healthy", "quarantined");
    expect(fields).toEqual({});
  });

  test("a healthy working session gets no directive and no signal", () => {
    // "Monitor current work." is what the operator is already doing by looking.
    const fields = attentionFieldsFor(input({ activity: "working" }), "healthy", "linked");
    expect(fields).toEqual({});
  });

  test("attentionSignal is omitted rather than emitted as unknown", () => {
    /* Absence means "we could not tell". Shipping {kind:"unknown"} on nine rows
       out of ten would hand the UI a new string to render under every agent —
       the same bug in a different field. */
    const fields = attentionFieldsFor(input({ activity: "ended" }), "healthy", "linked");
    expect(fields.attentionSignal).toBeUndefined();
    expect(fields.nextAction).toBeUndefined();
  });
});
