import { describe, expect, test } from "bun:test";
import { attentionFieldsFor, detectAttentionSignal } from "../src/server/attention-signal";
import type {
  ActivityState,
  OperatorControlState,
  OutcomeState,
  ProcessState,
} from "../src/shared/types";

/* Silence is the product requirement, not a side effect.

   nextActionFor used to classify by clock and control state, and 248 of 275
   live agents read "Review this session in history." — a restatement of
   `activity === "ended"` dressed as advice. Advice on almost every row is the
   same failure as a health card that is always red: the operator stops reading
   the column, and the two rows that genuinely needed a human are lost inside
   the 273 that did not.

   So the property worth pinning is not which sentence each detector emits. It
   is that a row the detectors cannot explain carries NOTHING, and that this
   stays true across the whole state space rather than in one hand-picked case.
   These tests are written to fail if anyone reintroduces a default catch-all,
   wherever they put it. */

const ACTIVITIES: readonly ActivityState[] = ["working", "idle", "ended", "unknown"];
const PROCESS_STATES: readonly ProcessState[] = ["running", "exited", "died", "unknown"];
const OUTCOMES: readonly OutcomeState[] = ["healthy", "needs-you", "blocked", "failed"];
const CONTROL_STATES: readonly OperatorControlState[] = ["linked", "observed-only", "quarantined"];

/* Ordinary working prose. It reports progress, asks nothing, states no
   assumption, and does not read as a completion — so nothing in the text can
   justify asking for a human. Every row below differs only by machine state. */
const SAYS_NOTHING = "Refactored the parser and updated the tests that cover it.";

interface Row {
  activity: ActivityState;
  processState: ProcessState;
  outcome: OutcomeState;
  controlState: OperatorControlState;
  fields: ReturnType<typeof attentionFieldsFor>;
}

function sweep(text: string): Row[] {
  const rows: Row[] = [];
  for (const activity of ACTIVITIES) {
    for (const processState of PROCESS_STATES) {
      for (const outcome of OUTCOMES) {
        for (const controlState of CONTROL_STATES) {
          rows.push({
            activity,
            processState,
            outcome,
            controlState,
            fields: attentionFieldsFor(
              { transcriptTail: text, lastAgentMessage: text, activity, processState },
              outcome,
              controlState,
            ),
          });
        }
      }
    }
  }
  return rows;
}

const SPEAKS = (row: Row) => Boolean(row.fields.nextAction);

describe("a row the detectors cannot explain says nothing", () => {
  test("rows with nothing structurally wrong stay overwhelmingly silent", () => {
    /* The population property, and the one a catch-all cannot survive.

       The population is chosen, not swept uniformly: a full cross-product makes
       half the fleet `failed` or `blocked`, and those SHOULD speak, so it would
       measure the wrong thing. The rows filler used to pollute were the ordinary
       ones — the 248 that had simply ended — so the population here is every row
       where nothing is structurally wrong: outcome healthy or needs-you, control
       not quarantined. Across all four activities and all four process states,
       with text that gives no reason, these must be quiet.

       The single exception is a died process on unfinished work, which is a
       reading of the text rather than of the clock. */
    const rows = sweep(SAYS_NOTHING).filter(
      (row) => row.outcome !== "failed" && row.outcome !== "blocked" && row.controlState !== "quarantined",
    );
    const speaking = rows.filter(SPEAKS);

    expect(rows.length).toBe(2 * 2 * ACTIVITIES.length * PROCESS_STATES.length);
    // Every speaking row must be the one text-derived case, not a clock reading.
    for (const row of speaking) {
      expect(row.activity).toBe("ended");
      expect(row.processState).toBe("died");
    }
    // Nine in ten of an ordinary board says nothing. A catch-all drops this to zero.
    expect(speaking.length / rows.length).toBeLessThan(0.1);
  });

  test("the healthiest row in the fleet carries no fields at all", () => {
    /* A working, healthy, linked agent producing ordinary prose is the modal
       row on a busy board. It must be completely empty — not an empty string,
       not a placeholder object. */
    const fields = attentionFieldsFor(
      { transcriptTail: SAYS_NOTHING, lastAgentMessage: SAYS_NOTHING, activity: "working", processState: "running" },
      "healthy",
      "linked",
    );

    expect(Object.keys(fields)).toEqual([]);
    expect(fields.nextAction).toBeUndefined();
    expect(fields.attentionSignal).toBeUndefined();
  });

  test("every sentence the sweep does emit names a specific repair", () => {
    /* Whatever survives must be a closed, small vocabulary tied to a real
       condition. The three sentences deleted for being filler are named
       explicitly: each described the board or an affordance rather than
       answering why THIS agent, out of two hundred, wants a human. */
    const sentences = new Set(sweep(SAYS_NOTHING).filter(SPEAKS).map((row) => row.fields.nextAction!));

    expect(sentences.size).toBeGreaterThan(0);
    expect(sentences.size).toBeLessThanOrEqual(4);
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/review this session in history/i);
      expect(sentence).not.toMatch(/monitor current work/i);
      expect(sentence).not.toMatch(/focus or send a follow-?up/i);
    }
  });

  test("a healthy outcome on a linked agent never speaks from machine state alone", () => {
    /* The sharpest slice: hold outcome and control state at "nothing is wrong",
       vary only the clock and the process, and require total silence. Any
       classifier that reads activity or processState to produce advice — which
       is what nextActionFor did — lights this up immediately. */
    const quiet = sweep(SAYS_NOTHING).filter(
      (row) => row.outcome === "healthy" && row.controlState !== "quarantined",
    );

    expect(quiet.length).toBeGreaterThan(0);
    for (const row of quiet) {
      if (row.activity === "ended" && row.processState === "died") continue; // stopped-mid-work, a text reading
      expect(row.fields.nextAction).toBeUndefined();
      expect(row.fields.attentionSignal).toBeUndefined();
    }
  });

  test("an unexplainable row is unknown with no advice attached to it", () => {
    const signal = detectAttentionSignal({
      transcriptTail: SAYS_NOTHING,
      lastAgentMessage: SAYS_NOTHING,
      activity: "idle",
      processState: "running",
    });

    // Exactly one key. A nextAction or evidence riding along on "unknown" is a
    // catch-all wearing a different hat.
    expect(signal.kind).toBe("unknown");
    expect(Object.keys(signal)).toEqual(["kind"]);
  });

  test("empty text is unknown rather than an excuse to guess", () => {
    for (const text of ["", "   ", "\n\n"]) {
      const signal = detectAttentionSignal({
        transcriptTail: text,
        lastAgentMessage: text,
        activity: "idle",
        processState: "running",
      });
      expect(signal.kind).toBe("unknown");
      expect(signal.nextAction).toBeUndefined();
    }
  });
});

describe("when a detector does speak, it quotes the agent", () => {
  test("evidence is the agent's own words, never a paraphrase", () => {
    /* The row shows evidence beside the reason. If evidence were generated
       rather than extracted, the operator would be reading the classifier's
       opinion while believing they were reading the agent.

       Deliberately says nothing about WHICH detector fires. An earlier draft
       asserted "question-pending" here and broke the moment a fork-unresolved
       detector landed and claimed the same sentence — the classification is the
       lane's to tune, the quoting is the contract. Whitespace is normalised on
       the way out, so the comparison is too. */
    const closings = [
      "Should I drop the legacy column or migrate it first?",
      "Do you want me to keep the old endpoint?",
      "I'll assume the staging bucket is fine unless you say otherwise.",
    ];

    const quoted = closings.filter((closing) => {
      const signal = detectAttentionSignal({
        transcriptTail: `Looked at the schema.\n${closing}`,
        lastAgentMessage: `Looked at the schema.\n${closing}`,
        activity: "idle",
        processState: "running",
      });
      if (!signal.evidence) return false;
      const flat = (value: string) => value.replace(/\s+/g, " ").trim();
      expect(flat(`Looked at the schema. ${closing}`)).toContain(flat(signal.evidence).replace(/…$/, ""));
      return true;
    });

    // At least one must actually produce evidence, or the loop asserts nothing.
    expect(quoted.length).toBeGreaterThan(0);
  });

  test("a clean exit is never read as stopping mid-work", () => {
    /* transcriptEndedCleanly is authoritative: the source recorded that the
       session finished. Reading a finished session as interrupted would put
       "decide whether to resume it" on rows that need nothing — filler again,
       just with a narrower trigger. */
    const signal = detectAttentionSignal({
      transcriptTail: SAYS_NOTHING,
      lastAgentMessage: SAYS_NOTHING,
      activity: "ended",
      processState: "died",
      transcriptEndedCleanly: true,
    });

    expect(signal.kind).not.toBe("stopped-mid-work");
    expect(signal.kind).toBe("unknown");
  });

  test("a died process with unfinished work does speak, so the silence above is a choice", () => {
    // The control. Without it, every silence assertion here would also pass on
    // a build where no detector fired at all.
    const signal = detectAttentionSignal({
      transcriptTail: SAYS_NOTHING,
      lastAgentMessage: SAYS_NOTHING,
      activity: "ended",
      processState: "died",
    });

    expect(signal.kind).toBe("stopped-mid-work");
    expect(signal.nextAction).toBeTruthy();
  });
});
