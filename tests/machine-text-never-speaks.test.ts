import { describe, expect, test } from "bun:test";
import { detectAttentionSignal, readableClosingText } from "../src/server/attention-signal";
import type { AttentionSignalInput } from "../src/server/attention-signal";

/* Machine output presented to an operator as an agent speaking to them.

   Found by the disjunction sweep: three of the four arms guarding the
   operator-facing evidence text were unexercised. Each is one term of an OR
   whose other terms every fixture already satisfied, so dropping it left 138
   tests green across attention-signal, attention-silence,
   attention-reachability, human-message and snapshot.

     readableClosingText  `!spoken || spoken.endsWith("…") || isMachineText(spoken)`
                          — only the ellipsis arm was covered.
     agentClosingLine     `line.startsWith("[Attention]") || isMachineText(line)`
                          — neither arm was covered.

   WHAT THE ARMS ARE FOR. MACHINE_TEXT matches JSON fragments, diff markers,
   file:line:column references and key="value" pairs. The evidence field is the
   sentence an operator reads to decide whether an agent needs them, so a tool
   result or a stack frame arriving there is not merely ugly: it is the system
   attributing machine noise to the agent as its request for help. And
   "[Attention]" is the control plane's own marker line, so echoing it back
   presents the notification's plumbing as the agent's words.

   Every fixture below is deliberately NOT truncated and NOT empty, so the two
   covered arms cannot satisfy it. That is the route-3 discipline applied to
   this file: a fixture that tripped several arms at once would test none. */

const base: AttentionSignalInput = {
  transcriptTail: null,
  lastAgentMessage: null,
  lastAgentClosing: null,
  activity: "idle",
  processState: "running",
};

const MACHINE_SAMPLES: { label: string; text: string }[] = [
  { label: "a JSON object", text: '{"tool":"read_file","path":"/tmp/x.ts","ok":true}' },
  { label: "a JSON array", text: '[{"id":1},{"id":2}]' },
  { label: "a diff header", text: "--- a/src/server/snapshot.ts" },
  { label: "a file:line:column reference", text: "src/server/pulse.ts:196:8 error TS2322" },
  { label: "an attribute pair", text: 'status="failed" retries="3"' },
];

describe("machine output is never presented as the agent's own words", () => {
  test.each(MACHINE_SAMPLES)("readableClosingText withholds $label", ({ text }) => {
    /* The arm that was dead. The message is complete — no trailing ellipsis —
       and non-empty, so neither covered arm can produce this verdict. Only the
       machine-text arm can. */
    expect(text.endsWith("…")).toBe(false);
    expect(text.length).toBeGreaterThan(0);

    expect(readableClosingText({ ...base, lastAgentMessage: text })).toBeUndefined();
  });

  test("a real sentence of the same length IS returned, so the filter is not refusing everything", () => {
    /* The control every suppression test needs. Without it, a build that
       withheld every closing line would satisfy all five cases above while
       removing the evidence field entirely. */
    const spoken = "I need a decision on whether to drop the legacy column before I continue.";

    expect(readableClosingText({ ...base, lastAgentMessage: spoken })).toBe(spoken);
  });

  test("an empty message is withheld rather than returned as blank evidence", () => {
    /* The third arm, `!spoken`. Dropping it returns the empty string, which
       renders as an agent that asked for a human and then said nothing —
       indistinguishable from a signal whose text failed to load. */
    expect(readableClosingText({ ...base, lastAgentMessage: "" })).toBeUndefined();
    expect(readableClosingText({ ...base, lastAgentMessage: "   " })).toBeUndefined();
  });

  test("a truncated message is withheld, which was the one arm already covered", () => {
    // Kept so the three arms are asserted together and none can be removed on
    // the belief that another covers it.
    expect(readableClosingText({ ...base, lastAgentMessage: "I was about to say something imp…" })).toBeUndefined();
  });
});

/* THE TAIL PATH, AND WHAT I COULD NOT REACH.

   `agentClosingLine` guards the transcript tail with
   `line.startsWith("[Attention]") || isMachineText(line)`, and NEITHER arm can
   be killed from outside. Dropping either one leaves these tests green, because
   something upstream in detectAttentionSignal decides "not-readable" for these
   inputs before the closing line is consulted at all.

   So the two tests below are true and worth having — a marker line and a JSON
   line must not become an agent's question — but they do NOT cover those arms,
   and I am not claiming they do. Reaching them needs either an input shape I
   could not construct or an export that does not exist. Left as a named gap
   rather than an assertion that looks like coverage. */
describe("the control plane's own marker is not echoed back as speech", () => {
  test("a transcript tail ending on the [Attention] line yields no closing text", () => {
    /* ASSERTED AS A DISCRIMINATING PAIR, because the obvious form was hollow.
       A suppressed line yields kind "not-readable" with NO evidence field at
       all, so `expect(signal.evidence ?? "").not.toContain("[Attention]")`
       compares "" against the marker and passes whatever the code does — my
       first draft of this test did exactly that and the mutation survived it.

       The same words WITHOUT the marker produce a question-pending signal
       carrying them as evidence. So the pair is the assertion: identical text,
       one prefixed, and only the unprefixed one may speak. */
    const question = "should I drop the legacy column?";
    const prefixed = detectAttentionSignal({ ...base, transcriptTail: `Ran it.\n[Attention] ${question}` });
    const plain = detectAttentionSignal({ ...base, transcriptTail: `Ran it.\n${question}` });

    expect(plain.kind).toBe("question-pending");
    expect(plain.evidence).toContain(question);

    expect(prefixed.kind).not.toBe("question-pending");
    expect(prefixed.evidence ?? "").not.toContain("[Attention]");
  });

  test("machine text at the end of a tail is not echoed either", () => {
    // The sibling arm, through the same path.
    const machine = detectAttentionSignal({
      ...base,
      transcriptTail: 'Finished the sweep.\n{"result":"ok","done":"yes"}',
    });
    const plain = detectAttentionSignal({
      ...base,
      transcriptTail: "Finished the sweep.\nshould I merge this now?",
    });

    expect(plain.kind).toBe("question-pending");
    expect(machine.kind).not.toBe("question-pending");
    expect(machine.evidence ?? "").not.toContain('{"result"');
  });

  test("an ordinary last line of a tail is still usable, so the tail path is not disabled", () => {
    /* The control for both arms above: a build ignoring the tail entirely would
       satisfy them while discarding the only evidence available for agents
       whose collectors attribute nothing. */
    const signal = detectAttentionSignal({
      ...base,
      transcriptTail: "Ran the migration.\nShould I drop the legacy column before continuing?",
    });

    expect(String(signal.evidence ?? "")).toContain("legacy column");
  });
});
