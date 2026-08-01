import { describe, expect, test } from "bun:test";
import {
  attentionFieldsFor,
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
      transcriptTail: "Same conflict, and I already know the resolution. Applying it.",
      attentionNotification: "Claude needs your permission to run git push",
    }));

    expect(signal.kind).toBe("permission-requested");
    expect(signal.nextAction).toContain("Approve or deny");
    // The operator sees what they are approving, quoted rather than paraphrased.
    expect(signal.evidence).toContain("needs your permission");
  });

  test("a cmux wait that names no permission stays the weaker claim", () => {
    const signal = detectAttentionSignal(input({
      transcriptTail: "Fix or delete them and report the count.",
      attentionNotification: "Claude is waiting for your input",
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

  test("a real question with a long run-up is recognised, and quoted without the run-up", () => {
    /* Measured live: three closings ended in "?" and a 220-character cap
       recognised only one, rejecting two genuine asks for being preceded by too
       much explanation. Length was never what made them questions. */
    const signal = detectAttentionSignal(input({
      lastAgentClosing:
        "…Want me to write a one-page docs/sem-engine/README.md umbrella that ties both programs together — "
        + "shared spine ownership, run order, and a status table for all four lanes, so you can drive the whole "
        + "thing from one place instead of three?",
    }));

    expect(signal.kind).toBe("question-pending");
    expect(signal.evidence?.startsWith("Want me to write")).toBe(true);
  });

  test("a question buried at the end of a flattened list is still found", () => {
    const signal = detectAttentionSignal(input({
      lastAgentClosing:
        "…I could sharpen the faces so it resolves the specific people, crop and convert the photo for upload, "
        + "or hand the whole thing to an image tool with the style notes attached. Which would help?",
    }));

    expect(signal.kind).toBe("question-pending");
    // The evidence is the question, not the paragraph in front of it.
    expect(signal.evidence).toBe("Which would help?");
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

describe("fork detection", () => {
  test("named alternatives handed back are a fork, not a generic question", () => {
    const signal = detectAttentionSignal(input({
      lastAgentClosing: "I can either widen the lock or shard the writer queue. Which would you prefer?",
    }));

    expect(signal.kind).toBe("fork-unresolved");
    expect(signal.nextAction).toBe("Pick one of the options it stopped between.");
    expect(signal.evidence).toContain("shard the writer queue");
  });

  test("enumerated options across a paragraph are recognised", () => {
    const signal = detectAttentionSignal(input({
      lastAgentClosing: "Option A keeps the existing schema and backfills nightly. Option B migrates in place with a short write freeze.",
    }));

    expect(signal.kind).toBe("fork-unresolved");
  });

  test("narration containing 'or' is not a fork", () => {
    /* The whole discipline in one test: a sentence that merely contains
       alternatives is not a decision handed back, and raising one would put a
       choice on the board that the operator never has to make. */
    const signal = detectAttentionSignal(input({
      lastAgentClosing: "I checked whether the cache or the index was stale, and it was the index.",
    }));

    expect(signal.kind).toBe("unknown");
  });
});

describe("unlanded work detection", () => {
  test("an ended session that names leftover work asks for a decision", () => {
    const signal = detectAttentionSignal(input({
      activity: "ended",
      processState: "exited",
      lastAgentClosing: "Three of the five migrations are converted. Still need to do the audit tables and the backfill.",
    }));

    expect(signal.kind).toBe("exited-unlanded");
    expect(signal.nextAction).toContain("unfinished");
  });

  test("an ended session that says it finished is left alone", () => {
    const signal = detectAttentionSignal(input({
      activity: "ended",
      processState: "exited",
      lastAgentClosing: "All five migrations converted and committed. Done.",
    }));

    expect(signal.kind).toBe("unknown");
  });

  test("leftover work is inferred from words, never from a missing completion phrase", () => {
    /* An ended session whose closing line simply does not contain "done" is not
       evidence of unfinished work. Inferring from absence is how the old layer
       ended up speaking on nine rows out of ten. */
    const signal = detectAttentionSignal(input({
      activity: "ended",
      processState: "exited",
      lastAgentClosing: "The parser now handles the nested case and the fixtures were regenerated.",
    }));

    expect(signal.kind).toBe("unknown");
  });

  test("a live session naming leftover work is not flagged: it is still working on it", () => {
    const signal = detectAttentionSignal(input({
      activity: "working",
      lastAgentClosing: "Still need to do the audit tables.",
    }));

    expect(signal.kind).toBe("unknown");
  });
});

describe("closing-line attribution", () => {
  test("the attributed closing beats both fallbacks", () => {
    /* lastAgentMessage is a front window and the tail is unattributed. When the
       collector supplies lastAgentClosing, that is the agent's actual last word
       and must win — this is the field that made these detectors possible. */
    const signal = detectAttentionSignal(input({
      lastAgentClosing: "Do you want me to land this now?",
      lastAgentMessage: "I reviewed the diff and walked every changed file in turn, starting with",
      transcriptTail: "some unrelated operator instruction that ends the slice",
    }));

    expect(signal.kind).toBe("question-pending");
    expect(signal.evidence).toBe("Do you want me to land this now?");
  });

  test("a question buried after a long explanation is now reachable", () => {
    // The exact shape front-truncation used to destroy.
    const explanation = "I traced the regression through the writer path. ".repeat(12);
    const signal = detectAttentionSignal(input({
      lastAgentClosing: "…Should I revert the writer change?",
      lastAgentMessage: explanation.slice(0, 240),
    }));

    expect(signal.kind).toBe("question-pending");
  });
});

describe("notification provenance", () => {
  /* Measured live: two sessions were reported as blocked on a permission prompt
     because their transcripts DISCUSSED the "[Attention]" marker — one of them
     while explaining that this exact spoof was possible. Whether a human is
     being waited on is a control-plane fact and must never be recoverable from
     text the agent authors. */
  test("an agent writing the marker into its own transcript cannot fake a permission block", () => {
    const signal = detectAttentionSignal(input({
      transcriptTail: "The server appends `[Attention] ${notification.body}` after matching an unread cmux notification.",
      lastAgentClosing: "A transcript containing [Attention] Claude needs your permission would otherwise surface as a pill.",
    }));

    expect(signal.kind).toBe("unknown");
  });

  test("the same words coming from cmux are trusted", () => {
    const signal = detectAttentionSignal(input({
      attentionNotification: "Claude needs your permission to run git push",
    }));

    expect(signal.kind).toBe("permission-requested");
  });
});

describe("attentionFieldsFor", () => {
  test("content beats structure: a fork outranks the failed-outcome fallback", () => {
    const fields = attentionFieldsFor(
      input({ lastAgentClosing: "Should I roll back the migration or patch forward?" }),
      "failed",
      "linked",
    );

    // Two named alternatives handed back, so the operator is told to choose
    // rather than merely to "answer" — even though a failure is also on record.
    expect(fields.attentionSignal?.kind).toBe("fork-unresolved");
    expect(fields.nextAction).toBe("Pick one of the options it stopped between.");
  });

  test("content beats structure: a plain question also outranks it", () => {
    const fields = attentionFieldsFor(
      input({ lastAgentClosing: "Do you want the migration rerun tonight?" }),
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
