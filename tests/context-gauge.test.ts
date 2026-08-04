import { describe, expect, test } from "bun:test";
// @ts-expect-error The dependency-free browser client has no declaration file.
import { CONTEXT_PRESSURE, contextPressureOf, gaugeArc, gaugePoint } from "../src/web/dom-primitives.js";

/* The dial's geometry, asserted without a DOM.
 *
 * A gauge is the one widget whose bug is invisible in review: an arc that
 * sweeps the wrong way, or a needle a few degrees off, renders as a perfectly
 * plausible picture of the wrong number. These pin the ends and the middle
 * against the arithmetic rather than against a screenshot. */

describe("half-circle dial geometry", () => {
  test("0% is the left end, 100% the right, 50% the top", () => {
    // Radius 42 about (50,50): the dial's own defaults.
    expect(gaugePoint(0)).toEqual({ x: 8, y: 50 });
    expect(gaugePoint(100)).toEqual({ x: 92, y: 50 });
    expect(gaugePoint(50)).toEqual({ x: 50, y: 8 });
  });

  test("the arc sweeps over the top, not under", () => {
    // A quarter of the way is up and to the left of centre; if the sweep flag
    // were wrong this would render below the baseline instead.
    const quarter = gaugePoint(25);
    expect(quarter.y).toBeLessThan(50);
    expect(quarter.x).toBeLessThan(50);
    expect(gaugeArc(50)).toContain("A 42 42 0 0 1");
  });

  /* An empty dial must draw NOTHING. A zero-length arc still paints its round
     stroke cap, which reads as a small non-zero value — a gauge quietly
     claiming a few percent of a window nobody is using. */
  test("an empty dial draws no arc at all", () => {
    expect(gaugeArc(0)).toBe("");
    expect(gaugeArc(-5)).toBe("");
    expect(gaugeArc(0.5)).not.toBe("");
  });

  test("out-of-range readings clamp instead of leaving the dial", () => {
    expect(gaugePoint(140)).toEqual(gaugePoint(100));
    expect(gaugePoint(-40)).toEqual(gaugePoint(0));
  });
});

describe("context pressure", () => {
  /* One definition, because the row highlight and the dial both ask it. They
     used to hardcode the same two numbers separately, which is how a row could
     be painted calm underneath a dial reading hot. */
  test("the bands are closed at their lower edge", () => {
    expect(contextPressureOf(CONTEXT_PRESSURE.warn - 1)).toBe("");
    expect(contextPressureOf(CONTEXT_PRESSURE.warn)).toBe("warn");
    expect(contextPressureOf(CONTEXT_PRESSURE.hot - 1)).toBe("warn");
    expect(contextPressureOf(CONTEXT_PRESSURE.hot)).toBe("hot");
  });

  test("a missing reading is not a calm one", () => {
    // Absent context must not paint a row green-by-omission; it paints nothing.
    expect(contextPressureOf(undefined as unknown as number)).toBe("");
    expect(contextPressureOf(Number.NaN)).toBe("");
    expect(contextPressureOf(0)).toBe("");
  });
});
