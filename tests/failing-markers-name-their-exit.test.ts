import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* A `test.failing` that does not say what would resolve it becomes permanent.

   Today established that widening a threshold until a cross-source check passes
   converts a real disagreement into a blind spot that looks identical to
   success forever after. A marker reaches the same place by a slower route.
   `test.failing` passes while the defect stands, so a marker with no stated
   exit is indistinguishable from a test that always passed — and the day it
   hard-fails with "marked as failing but it passed", the cheapest reading is
   that the test is broken and the marker should go.

   The marker is only honest while somebody can tell, from the file, what it is
   waiting for.

   THE CONVENTION, the same shape as the provenance rule and for the same
   reason: it lives at the assertion rather than in a document.

     A `test.failing` must state, within its own comment block, the condition
     that ends it. "Marked failing until X" — where X is a fix, a decision, or
     a measurement someone else owns.

   Enforced over the files this lane owns. Other lanes' markers are theirs to
   annotate; naming their files here would be enforcing a convention they never
   agreed to, and a shared suite that fails on another lane's style is a suite
   people learn to route around.

   WHAT THIS DOES NOT CHECK. That the stated exit is TRUE, or still true. A
   marker can name a condition that was resolved a week ago and this will not
   notice — only the hard-fail will, which is the mechanism working as intended.
   It checks that the question was asked, not that the answer is current. */

/** Files this lane wrote and is responsible for. */
const OWNED = [
  "cross-source-token-agreement.test.ts",
  "physical-bounds.test.ts",
  "published-identities.test.ts",
  "handwritten-snapshots-reconcile.test.ts",
  "known-defects.test.ts",
  "attention-reachability.test.ts",
] as const;

/* Words that name a condition rather than describe a state. A marker saying
   "this is broken" has not said when it stops being broken; one saying "flips
   when the gate reads liveness" has. */
const NAMES_AN_EXIT = /\b(until|when|the moment|once|flips|resolved|is fixed|removes? the marker|remove the marker)\b/i;
/** How far below the marker its explanation may sit. */
const BLOCK_LINES = 24;

interface Unexplained { readonly file: string; readonly line: number; readonly title: string }

function unexplained(file: string): Unexplained[] {
  const lines = readFileSync(join(import.meta.dir, file), "utf8").split("\n");
  const found: Unexplained[] = [];
  lines.forEach((text, index) => {
    if (!/\btest\.failing\s*\(/.test(text)) return;
    // The explanation may precede the marker or open the body beneath it.
    /* Whitespace-normalised before matching. These comment blocks are wrapped
       at ~76 columns, so a phrase like "The moment ingestion splits" arrives
       split across a newline and indentation — and the first version of this
       detector reported a false positive on exactly that, in a marker whose
       exit condition was written out in full. A rule that cries wolf on
       correct work is a rule people delete. */
    const block = lines.slice(Math.max(0, index - 6), index + BLOCK_LINES).join(" ").replace(/\s+/g, " ");
    if (!NAMES_AN_EXIT.test(block)) {
      found.push({ file, line: index + 1, title: text.trim().slice(0, 90) });
    }
  });
  return found;
}

describe("a known-failing test says what would end it", () => {
  test("every failing marker in this lane's files names its exit condition", () => {
    /* THE CONVENTION, enforced. A new marker without a stated exit fails here
       with the file and line, and the fix is one sentence: what has to happen
       for this to go green, and who owns it.

       That sentence is what stops the marker being deleted by whoever meets its
       hard-fail six weeks from now with no context. */
    const all = OWNED.flatMap(unexplained)
      .map(({ file, line, title }) => `${file}:${line}  ${title}`);

    expect(
      all,
      "These are marked failing without saying what would resolve them. Add one sentence to the "
      + "comment block: the fix, decision or measurement that ends it, and whose it is. A marker "
      + "with no stated exit is a permanent green wearing a red's clothes.",
    ).toEqual([]);
  });

  test("the register names files that exist and actually carry markers", () => {
    /* A register rots two ways: an entry that no longer exists, and an entry
       that never had a marker to check. Both leave the rule enforcing nothing
       while reading as coverage. A file with no marker is allowed — markers get
       removed when defects are fixed, which is the good outcome — but it must
       still exist. */
    let withMarkers = 0;
    for (const file of OWNED) {
      const source = readFileSync(join(import.meta.dir, file), "utf8");
      expect(source.length, `${file}: registered but empty or missing`).toBeGreaterThan(0);
      if (/\btest\.failing\s*\(/.test(source)) withMarkers += 1;
    }

    expect(withMarkers, "no registered file carries a marker, so this rule checks nothing").toBeGreaterThan(0);
  });

  test("the detector distinguishes a stated exit from a mere complaint", () => {
    /* The anti-hollow guard. This test asserts an empty list, which a regex
       matching everything also produces. Synthetic blocks, checked directly. */
    const complaint = "/* This is broken and has been for a while. */";
    const stated = "/* Marked failing until the backend decides whether the collector overcounts. */";
    const alsoStated = "/* It flips the moment the join is corrected. */";

    expect(NAMES_AN_EXIT.test(complaint), "a bare complaint was accepted as an exit condition").toBe(false);
    expect(NAMES_AN_EXIT.test(stated)).toBe(true);
    expect(NAMES_AN_EXIT.test(alsoStated)).toBe(true);
  });
});
