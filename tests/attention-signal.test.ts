import { describe, expect, test } from "bun:test";
import {
  attentionFieldsFor,
  detectAttentionSignal,
  readableClosingText,
  emptyAttentionCoverage,
  recordAttention,
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

    expect(signal.kind).toBe("nothing-wanted");
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

    expect(signal.kind).toBe("nothing-wanted");
  });

  test("an ordinary finished session says nothing at all", () => {
    /* This is the 90% case. Under the old layer every one of these rows read
       "Review this session in history." It is now skipped before any detector
       runs: an ended session cannot be answered, so it is never asked. */
    const signal = detectAttentionSignal(input({
      activity: "ended",
      processState: "exited",
      lastAgentMessage: "No security vulnerabilities identified in this diff.",
      transcriptTail: "No source→sink path with a plausible attacker-controllable impact.",
    }));

    expect(signal).toEqual({ kind: "out-of-scope" });
  });

  test("an agent with no text at all reports that it could not read, not that all is well", () => {
    /* The distinction the GPT lane's critique turned on: 288 of 302 silences
       were this state, and counting them as "we looked and found nothing" made
       a blind layer look like a disciplined one. */
    expect(detectAttentionSignal(input())).toEqual({ kind: "not-readable" });
  });

  test("a front-truncated message is not readable either, however much of it survived", () => {
    // 205 of 302 live agents carried exactly this: the visible third of a turn
    // whose conclusion — where the ask lives — was cut off.
    const clipped = detectAttentionSignal(input({
      lastAgentMessage: "Checked in. Here is the honest state. The program's work is landed and live, and I verif…",
    }));

    expect(clipped.kind).toBe("not-readable");
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

    expect(signal.kind).toBe("nothing-wanted");
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

    expect(signal.kind).toBe("nothing-wanted");
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

    expect(signal.kind).toBe("nothing-wanted");
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
  });

  test("a quarantined agent is not told to resolve a conflict that may not exist", () => {
    /* Measured live: this fallback read on 22 of 26 live rows — one identical
       sentence on almost every agent — and it was false. All 22 were
       quarantined by cwd ambiguity ("26 active sources share this cwd") while
       controlHealth.errors held ZERO identity conflicts. A real conflict is
       reported once, as the system:cmux-identity-conflicts issue with the
       sessions it actually blocks; repeating it per row added no information
       and cost the column its credibility. */
    expect(attentionFieldsFor(input(), "healthy", "quarantined")).toEqual({});
  });

  test("an ended quarantined session is not told to fix controls it will never use", () => {
    const fields = attentionFieldsFor(input({ activity: "ended" }), "healthy", "quarantined");
    expect(fields).toEqual({});
  });

  test("an ended failed session is not told to choose a repair either", () => {
    // The board already shows outcome: failed. A dead row cannot be repaired,
    // and every control on it is disabled.
    expect(attentionFieldsFor(input({ activity: "ended" }), "failed", "linked")).toEqual({});
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

/* §4 of the GPT lane's critique, and the largest single recall gap it found:
   of five turns genuinely waiting on a human, FOUR ended in a statement rather
   than a question. question-pending is structurally blind to all of them. */
describe("declarative hand-backs", () => {
  test.each([
    ["6 commits are in, unpushed — publishing is your call.", "your call"],
    ["The remaining scope is left to you.", "left to you"],
    ["I have staged everything and I'm blocked on you for the credentials.", "blocked on you"],
    ["Two candidate fixes are written up; tell me which you want.", "tell me which"],
    ["Nothing else runs without a decision here, so I'll hold.", "I'll hold"],
    ["This needs your sign-off before it can land.", "needs your sign-off"],
    ["That is the lot — two things for you before I continue.", "two things for you"],
  ])("recognises %j as a hand-back", (closing) => {
    const signal = detectAttentionSignal(input({ lastAgentClosing: closing }));
    expect(signal.kind).toBe("handoff-stated");
    expect(signal.nextAction).toBe("Take the decision it handed back.");
  });

  test.each([
    "Hope that helps — happy to keep going if useful.",
    "Let me know how it goes.",
    "I reviewed the diff and found no security issues.",
    "The report explains what was left to the previous lane.",
  ])("does not fire on politeness or narration: %j", (closing) => {
    /* A sign-off is not a stop. Firing on these would put a decision on the
       board that the operator does not have to make, which is the filler
       failure wearing a new phrase. */
    expect(detectAttentionSignal(input({ lastAgentClosing: closing })).kind)
      .toBe("nothing-wanted");
  });

  test("a question still outranks a hand-back in the same message", () => {
    const signal = detectAttentionSignal(input({
      lastAgentClosing: "It is your call in the end. Should I land it now?",
    }));
    expect(signal.kind).toBe("question-pending");
  });
});

describe("attention coverage", () => {
  test("separates what it read from what it could not, and reports dead preconditions", () => {
    /* §1 and §6. 288 of 302 live silences were blind, not honest, and two
       detectors could not fire at all — both invisible before this. */
    const coverage = emptyAttentionCoverage();
    recordAttention(coverage, input({ lastAgentClosing: "All tests pass and it is committed." }), "healthy", "linked");
    recordAttention(coverage, input({ lastAgentMessage: "Checked in. The work is landed and I verif…" }), "healthy", "linked");
    recordAttention(coverage, input(), "healthy", "linked");
    recordAttention(coverage, input({ lastAgentClosing: "Publishing is your call." }), "healthy", "linked");
    recordAttention(
      coverage,
      input({ attentionNotification: "Claude needs your permission", processState: "died" }),
      "healthy",
      "linked",
    );

    expect(coverage.agents).toBe(5);
    // Two blind rows: one with no text, one whose message was front-truncated.
    expect(coverage.notReadable).toBe(2);
    expect(coverage.readable).toBe(3);
    expect(coverage.signals["handoff-stated"]).toBe(1);
    expect(coverage.signals["permission-requested"]).toBe(1);
    // Silent kinds never appear as signals — they are not findings on a row.
    expect(coverage.signals["nothing-wanted"]).toBeUndefined();
    // Preconditions bound the detectors that depend on them.
    expect(coverage.preconditions.withNotification).toBe(1);
    expect(coverage.preconditions.withProvenDeath).toBe(1);
  });

  test("a fleet with no notifications reports zero, not an absent precondition", () => {
    // "0 fired" and "0 could fire" must be distinguishable.
    const coverage = emptyAttentionCoverage();
    recordAttention(coverage, input({ lastAgentClosing: "Done." }), "healthy", "linked");
    expect(coverage.preconditions).toEqual({ withNotification: 0, withProvenDeath: 0 });
    expect(coverage.signals).toEqual({});
  });
});

describe("self-reference", () => {
  test("a hand-back phrase inside quotation marks is reported, not performed", () => {
    /* The self-amplification class from §5, reached through content instead of
       the marker: this swarm discusses its own detectors constantly, and a
       transcript quoting "publishing is your call" was classified as handing a
       decision back. Quoting is not asserting. */
    const signal = detectAttentionSignal(input({
      lastAgentClosing: 'The detector caught the critique example verbatim: "6 commits, unpushed — publishing is your call."',
    }));

    expect(signal.kind).toBe("nothing-wanted");
  });

  test("the same phrase unquoted is still a hand-back", () => {
    // The control: quoting-awareness must not disarm the detector generally.
    const signal = detectAttentionSignal(input({
      lastAgentClosing: "6 commits, unpushed — publishing is your call.",
    }));

    expect(signal.kind).toBe("handoff-stated");
  });
});

describe("coverage preconditions are bounded by scope", () => {
  test("an ended agent's notification is not counted as a detector that could have fired", () => {
    /* Measured live: withNotification read 2 against signals {}, which looks
       like two broken detectors. Both were archived rows, skipped before the
       notification was ever read — a capability scope had already removed. */
    const coverage = emptyAttentionCoverage();
    recordAttention(
      coverage,
      input({ activity: "ended", attentionNotification: "Claude needs your permission" }),
      "healthy",
      "linked",
    );

    expect(coverage.ended).toBe(1);
    expect(coverage.preconditions.withNotification).toBe(0);
  });

  test("a live agent's notification still counts, and still fires", () => {
    const coverage = emptyAttentionCoverage();
    const fields = recordAttention(
      coverage,
      input({ activity: "idle", attentionNotification: "Claude needs your permission" }),
      "healthy",
      "linked",
    );

    expect(coverage.preconditions.withNotification).toBe(1);
    expect(fields.attentionSignal?.kind).toBe("permission-requested");
  });
});

describe("evidence quotes the choice, and never breaks a word", () => {
  test("a fork after a long run-up quotes the options, not the reasoning", () => {
    /* The exact text from the live end-to-end probe. The evidence used to open
       on "…Dropping it now is a one-way door" — the reasoning — and cut off at
       "legacy colum…" mid-word. The operator needs the choice, not the essay. */
    const signal = detectAttentionSignal(input({
      lastAgentClosing:
        "I traced the column through the writer and the backfill job. "
        + "Dropping it now is a one-way door because the nightly export still reads it, "
        + "and migrating in place needs a short write freeze. "
        + "Should I drop the legacy column or migrate it first?",
    }));

    expect(signal.kind).toBe("fork-unresolved");
    expect(signal.evidence).toBe("Should I drop the legacy column or migrate it first?");
    expect(signal.evidence).not.toContain("one-way door");
  });

  test("a bare ask reaches back for the alternatives it is asking about", () => {
    // "Which would you prefer?" alone names no options; they are the sentence before.
    const signal = detectAttentionSignal(input({
      lastAgentClosing: "I can either widen the lock or shard the writer queue. Which would you prefer?",
    }));

    expect(signal.evidence).toContain("shard the writer queue");
    expect(signal.evidence).toContain("Which would you prefer?");
  });

  test("evidence is never cut mid-word", () => {
    /* "…migrate the legacy colum…" reads as a rendering bug rather than an
       elision, and costs the quote its authority. One long ask, so the quote
       genuinely exceeds the evidence cap and has to be clipped. */
    const ask = `Should I ${"reconcile the ledger and ".repeat(12)}or leave it for the next run?`;
    const signal = detectAttentionSignal(input({ lastAgentClosing: ask }));

    const evidence = signal.evidence ?? "";
    expect(evidence.endsWith("…")).toBe(true);
    const body = evidence.slice(0, -1);
    // Every clipped quote must end on a whole word from the original text.
    expect(ask.replace(/\s+/g, " ")).toContain(body);
    expect(/\w$/.test(body)).toBe(true);
    expect(ask.replace(/\s+/g, " ").startsWith(body)).toBe(true);
  });
});

/* The same <timestamp> transport markup the namer must not read (see
   session-names) also arrives here, where closings become quoted evidence. */
describe("timestamp markup in transcripts", () => {
  const CLOCK = "<timestamp>Tuesday, Aug 4, 2026, 6:10 PM (UTC-5)</timestamp>";

  test("a question that stops on the clock is still the closing line", () => {
    const signal = detectAttentionSignal(input({
      lastAgentClosing: `Want the full accounting against all 79 findings, or is the working state enough?\n${CLOCK}`,
    }));

    expect(signal.kind).toBe("question-pending");
    expect(signal.evidence).toBe("Want the full accounting against all 79 findings, or is the working state enough?");
  });

  test("a closing that is only the clock is no closing at all", () => {
    expect(readableClosingText(input({ lastAgentClosing: CLOCK }))).toBeUndefined();
  });

  test("readable closing text quotes the words, never the clock among them", () => {
    const text = readableClosingText(input({
      lastAgentClosing: `Should I delete the stale fixtures? ${CLOCK}`,
    }));
    expect(text).toBe("Should I delete the stale fixtures?");
  });
});
