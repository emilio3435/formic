import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* A CONVENTION, because fixing instances only resets the clock.

   A transcribed constant and a derived one look identical in a passing test.
   That is the whole problem: `expect(dearest.costUsd).toBeGreaterThan(100)`
   reads exactly like a considered bound and was in fact the biggest row someone
   saw one morning. It had 4.12x headroom and falling. Three assertions have now
   gone red in this suite with no defect behind them, all the same way.

   So the rule is not "do not transcribe constants" — the next person will
   transcribe one the moment it is convenient, and be right to, because it is
   the fastest way to write a passing test. The rule is that the two must be
   TELLABLE APART AT A GLANCE, which means the provenance has to be written down
   where the number is.

   THE CONVENTION:

     In a file that reads live data, any assertion carrying a numeric literal of
     three digits or more must have a `provenance:` note on the same line or
     within the three lines above it.

   Fixture-based files are exempt on purpose. A literal there is checked against
   a fixture in the same file, so changing one without the other fails loudly and
   immediately — which is correct behaviour, not a hazard. The danger is
   specific to numbers asserted against data that moves on its own.

   WHAT A GOOD NOTE SAYS. Where the number came from, so a future reader can
   decide whether a failure is evidence or maintenance:

     provenance: derived — 2 * the 1M context window in config/models.json
     provenance: shape — a sample-size floor, not a measurement
     provenance: observed 2026-08-02 — REVIEW, this will drift

   The third form is allowed. Transcribing is sometimes the only option, and
   saying so plainly is far better than dressing it as a bound. What is not
   allowed is silence.

   WHAT THE DETECTOR REACHES, stated because a rule that quietly under-enforces
   is worse than no rule. It matches a bare literal of three or more digits
   sitting directly inside the matcher call. It does NOT match:

     - a decimal below one, `toBeLessThan(0.2)` — those are ratios here, and a
       ratio carries its meaning in the expression around it
     - an EXPRESSION, `toBeGreaterThan(2 * 1_000_000)` — arithmetic against a
       named quantity is already showing its work, which is the outcome the rule
       is trying to produce
     - anything in a fixture-based file, by design

   So this catches the specific shape that burned us three times — a round
   number pasted into a matcher — and nothing subtler. A determined transcription
   can still get through as `toBeGreaterThan(100 * 1)`. The rule is a prompt,
   not a proof. */

const LIVE_DATA_FILES = [
  "physical-bounds.test.ts",
  "published-identities.test.ts",
  "cross-source-token-agreement.test.ts",
] as const;

/** Three digits or more: below that a literal is almost always a count, an
    index or a small fixture size, and flagging those would make the rule noise
    that people learn to route around. */
const BIG_LITERAL = /\.toBe(?:GreaterThan|LessThan|GreaterThanOrEqual|LessThanOrEqual|CloseTo)?\(\s*-?\d[\d_]{2,}/;
const PROVENANCE = /provenance:/i;
const LOOKBACK = 3;

interface Offence { readonly file: string; readonly line: number; readonly text: string }

function offences(file: string): Offence[] {
  const lines = readFileSync(join(import.meta.dir, file), "utf8").split("\n");
  const found: Offence[] = [];
  lines.forEach((text, index) => {
    if (!BIG_LITERAL.test(text)) return;
    const window = lines.slice(Math.max(0, index - LOOKBACK), index + 1).join("\n");
    if (!PROVENANCE.test(window)) found.push({ file, line: index + 1, text: text.trim() });
  });
  return found;
}

describe("a number asserted against live data says where it came from", () => {
  test("every literal in a live-data file declares its provenance", () => {
    /* THE CONVENTION, enforced. Adding a bare three-digit literal to one of
       these files fails here with the file and line, and the fix is to write
       one line saying where the number came from — including "observed, this
       will drift", which is an honest answer and the one that would have saved
       three red assertions today. */
    const all = LIVE_DATA_FILES.flatMap(offences)
      .map(({ file, line, text }) => `${file}:${line}  ${text}`);

    expect(
      all,
      "These assert a number against data that moves on its own, without saying where the number "
      + "came from. Add a `provenance:` note on the line or just above it: derived (and from what), "
      + "shape (a sample-size floor), or observed (and therefore expected to drift).",
    ).toEqual([]);
  });

  test("the rule is checked against files that exist and are actually live", () => {
    /* A register of filenames rots into a register of typos. Each entry must
       exist and must genuinely read live data, or the rule is being enforced
       against nothing while reading as coverage. */
    for (const file of LIVE_DATA_FILES) {
      const source = readFileSync(join(import.meta.dir, file), "utf8");
      expect(source.length, `${file}: registered but empty or missing`).toBeGreaterThan(0);
      expect(
        /getUsageSummary|getUsageInvocations|127\.0\.0\.1:4701/.test(source),
        `${file}: registered as live-data but reads neither BurnBar nor the board`,
      ).toBe(true);
      expect(
        /BURNBAR_DB_PATH\s*=/.test(source),
        `${file}: sets BURNBAR_DB_PATH, so it reads a fixture and does not belong in this register`,
      ).toBe(false);
    }
  });

  test("the detector actually fires, so a green here is not the regex missing everything", () => {
    /* The anti-hollow guard, and this file needs it more than most: it asserts
       an empty list, which is what a broken regex also produces. Synthetic
       lines, checked directly against the two rules. */
    const bare = "    expect(worstDay).toBeGreaterThan(1_000);";
    const noted = "    // provenance: shape — a sample-size floor\n    expect(rows.length).toBeGreaterThan(100);";
    const small = "    expect(kept).toHaveLength(3);";

    expect(BIG_LITERAL.test(bare), "the detector missed a bare four-digit literal").toBe(true);
    expect(PROVENANCE.test(noted), "the provenance marker was not recognised").toBe(true);
    expect(BIG_LITERAL.test(small), "a two-digit count should not be flagged").toBe(false);
  });
});
