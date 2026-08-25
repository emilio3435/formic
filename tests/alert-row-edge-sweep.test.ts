import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let styles = "";

beforeAll(() => {
  styles = readFileSync(join(import.meta.dir, "../src/web/styles.css"), "utf8");
});

/* The alert mark's geometry contract.

   The mark used to LIFT: `translateY(-2px) scale(1.02)` from a left origin,
   under an outward `0 0 0 2px` ring. Both halves cost more than they bought.
   The scale pushed a full-width row 2% wider to the RIGHT, so CTX / TOKENS /
   QUIET drifted rightward under `.program { overflow: clip }` and QUIET
   clipped off the card — the row that most needs reading became the one row
   whose instruments you could not read. The outward ring, spreading beyond the
   row's own box, painted over the WAITING / ACTIVE band label sitting directly
   above it.

   The replacement keeps every pixel of the row where it was and moves the
   attention INTO the row's own footprint: a static inset hairline in repo ink,
   with a comet sweeping the perimeter on a masked `::after`. These tests pin
   that the geometry never comes back, and that the sweep degrades correctly
   for reduced motion and stands aside for the keyboard focus ring. */
describe("the alert row marks itself without moving", () => {
  const baseRule = () => styles.match(/\.agent-row\.is-alert-hot \{[^}]*\}/)?.[0] ?? "";

  test("the base rule changes no geometry — no scale, no translate", () => {
    /* The regression itself. `scale(1.02)` is what walked the numeric columns
       under the clipping card; `translateY(-2px)` is what lifted the row into
       the band label's line. Neither may return to this rule in any form. */
    const block = baseRule();
    expect(block).not.toBe("");
    expect(block).not.toContain("scale(");
    expect(block).not.toContain("translateY(");
    expect(block).not.toContain("transform:");
  });

  test("the ring is INSET — it may not paint outside the row's own box", () => {
    /* An outward spread is drawn over whatever sits above the row, and on the
       strip that is the band label. Inset keeps the mark inside the box the
       row already occupies, which is the whole point of the change. */
    const block = baseRule();
    expect(block).toMatch(/box-shadow:\s*inset 0 0 0/);
  });

  test("the ink is still repo tint darkened, and the fallback is still amber", () => {
    /* Carried forward unchanged from the lift: an operator scanning eight
       repos reads "this repo, and it needs me", not "some alert, somewhere".
       Ember is reserved for blocking notification badges (DESIGN-LANGUAGE),
       so the fallback is --color-status-warning and never the failed hue. */
    expect(baseRule()).toContain(
      "--alert-ink: color-mix(in srgb, var(--repo-tint, var(--color-status-warning)) 78%, #000 22%)",
    );
  });
});

describe("the sweep is a masked pseudo-element driven by a registered angle", () => {
  const sweepRule = () => styles.match(/\.agent-row\.is-alert-hot::after \{[^}]*\}/)?.[0] ?? "";

  test("a ::after carries the sweep and paints it with a conic gradient", () => {
    /* The comet has to be its own layer: box-shadow cannot be swept around a
       perimeter, and the row's box-shadow slot is already spoken for by the
       inset ring (and contested by the repo tick and the focus ring). */
    const rule = sweepRule();
    expect(rule).not.toBe("");
    expect(rule).toContain("conic-gradient(");
    expect(rule).toContain("from var(--alert-sweep)");
  });

  test("the gradient is masked to a ring, never a fill", () => {
    /* SORT-INK-1: the 4% repo wash is the row's only background. The conic
       gradient is legitimate ONLY because the two-layer mask xors the content
       box away and leaves a hairline perimeter. Without the mask this rule is
       a full-bleed wash in alert ink — precisely the thing that was retired. */
    const rule = sweepRule();
    expect(rule).toContain("mask-composite: exclude");
    expect(rule).toContain("-webkit-mask-composite: xor");
    expect(rule).toMatch(/mask:\s*linear-gradient\(#000 0 0\) content-box/);
    // The masked-out middle is what makes the padding a ring THICKNESS.
    expect(rule).toMatch(/padding:\s*[\d.]+px/);
    // A decorative layer must never eat a click meant for the row.
    expect(rule).toContain("pointer-events: none");
  });

  test("--alert-sweep is a registered <angle>, or the sweep cannot animate at all", () => {
    /* A bare custom property is an untyped token: interpolating it is a
       discrete swap from 0deg to 360deg and the comet simply teleports once
       per cycle. @property is what makes the angle a smoothly animatable
       value, so registration is load-bearing, not decoration. */
    const registration = styles.match(/@property --alert-sweep \{[^}]*\}/)?.[0] ?? "";
    expect(registration).not.toBe("");
    expect(registration).toContain('syntax: "<angle>"');
    expect(registration).toContain("inherits: false");
    expect(registration).toMatch(/initial-value:\s*0deg/);
    // …and something must actually drive it.
    expect(styles).toMatch(/@keyframes alert-edge-sweep \{[^}]*--alert-sweep:\s*360deg/);
    expect(styles).toMatch(/\.agent-row\.is-alert-hot::after \{[^}]*animation:\s*alert-edge-sweep/);
  });

  test("the thick-line pulse is gone — the sweep replaces it, it does not join it", () => {
    /* alert-outline-shimmer breathed the ring 2px→3px. Two simultaneous
       attention animations on one row is noise, and the 3px frame is an
       outward spread by another name. */
    expect(styles).not.toContain("alert-outline-shimmer");
  });
});

describe("the sweep stands down where motion is unwelcome", () => {
  test("reduced motion stops the sweep and leaves the static ring behind", () => {
    /* The static inset ring lives on the base rule with no animation of its
       own, so it survives this block untouched — that is the reduced-motion
       fallback, and it is why this block needs no box-shadow restatement the
       way the old shimmer's did. Only the ::after has to be stilled. */
    const reduceBlocks = [...styles.matchAll(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g)]
      .map((m) => m[0]);
    const alertReduce = reduceBlocks.find((block) => block.includes(".agent-row.is-alert-hot::after")) ?? "";
    expect(alertReduce).not.toBe("");
    expect(alertReduce).toMatch(/\.agent-row\.is-alert-hot::after \{[^}]*animation: none/);
  });

  test("the sweep is opt-IN on no-preference, so an undecided UA gets the still ring", () => {
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*\.agent-row\.is-alert-hot::after \{[^}]*animation:\s*alert-edge-sweep/,
    );
  });

  test("keyboard focus keeps BOTH rings, and the sweep gets out of its way", () => {
    /* The box-shadow slot is occupied by the alert ring, so the focus rule has
       to restate everything it wants in one composite — and "everything" is
       three layers, not two. Dropping the alert ink here is the defect this
       assertion closes: the base rule's inset ring is overridden by this rule
       and the comet is hidden below, so an alert-ink layer that is merely
       implied is an alert row that looks exactly like a calm one for as long
       as an operator has it focused — on the row they most likely arrived at
       by keyboard, i.e. the one they were sent to deal with.

       Order matters and is asserted as ink-outermost: inset shadows paint
       first-listed on top, so the 1px alert ring holds the edge and the 3px
       interactive spread shows through beneath it as a 2px band. Reverse them
       and the interactive ring covers the alert ink completely. */
    const focusRule = styles.match(/\.agent-row\.is-alert-hot:focus-visible \{[^}]*\}/)?.[0] ?? "";
    expect(focusRule).not.toBe("");
    expect(focusRule).toContain("var(--color-focus-ring)");
    expect(focusRule).toContain("inset 0 0 0 1px color-mix(in srgb, var(--alert-ink) 85%, transparent)");
    expect(focusRule).toContain("inset 0 0 0 3px var(--color-interactive)");
    expect(focusRule.indexOf("var(--alert-ink)")).toBeLessThan(focusRule.indexOf("var(--color-interactive)"));
    /* Both ALERT layers stay inset — the mark itself never paints outside the
       row's own border box, focused or not. The third layer in the composite
       does spread: `--color-focus-ring` resolves to an outset
       `0 0 0 3px rgba(91,79,209,.28)`, exactly as it does on every other
       focused row. So this guard is deliberately LITERAL — it forbids an
       outward alert ring written into this rule, which is the real regression,
       and says nothing about the shared token's own geometry.

       The lookbehind is load-bearing: without it the space inside
       `inset 0 0 0 1px` satisfies a leading `[\s,]` and every inset layer
       reads as a violation. */
    expect(focusRule).not.toMatch(/(?<!inset )0 0 0 \d+px/);
    const focusSweep = styles.match(/\.agent-row\.is-alert-hot:focus-visible::after \{[^}]*\}/)?.[0] ?? "";
    expect(focusSweep).not.toBe("");
    expect(focusSweep).toMatch(/display: none|opacity: 0/);
  });
});
