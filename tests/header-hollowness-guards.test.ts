/**
 * Live guards for header claims that mutation showed were unguarded or only
 * CSS-text-guarded. See docs/TEST-HOLLOWNESS-AUDIT.md round 2.
 *
 * Hermetic — safe for `bun run test:ci`. No jsdom (repo policy); geometry is a
 * pure layout model fed by the CSS strategy the narrow media block declares,
 * using the 420px numbers measured on the live board for A11Y-1.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dir, "../src/web");
const read = (name: string) => readFileSync(join(WEB, name), "utf8");

describe("S3 — context spread preference must persist", () => {
  /* Mutation that stayed GREEN across the whole CI-relevant suite: drop
     localStorage get/set for CONTEXT_SPREAD_KEY so the inverted toggle forgets
     across reloads. Nothing in tests/ named the key. */
  test("CONTEXT_SPREAD_KEY is written on toggle and read on boot", () => {
    const catalogs = read("client-catalogs.js");
    const app = read("app.js");
    expect(catalogs).toMatch(/export const CONTEXT_SPREAD_KEY\s*=\s*"mtn3-contextSpread"/);
    expect(app).toMatch(/localStorage\.setItem\(\s*CONTEXT_SPREAD_KEY\s*,\s*state\.contextSpread\s*\)/);
    expect(app).toMatch(/localStorage\.getItem\(\s*CONTEXT_SPREAD_KEY\s*\)/);
    /* The toggle is what persists the choice — a load without a write is a
       preference that can never stick. */
    const toggle = app.match(/class:\s*"spread-toggle"[\s\S]{0,500}?onclick:\s*\(\)\s*=>\s*\{([\s\S]*?)\n\s*\},/);
    expect(toggle?.[1] ?? "", "spread-toggle onclick").toMatch(/setItem\(\s*CONTEXT_SPREAD_KEY/);
  });
});

/* ---------- A11Y-1 geometry model ----------
   The shipped regression test asserts CSS text (`align-self: stretch`,
   `left: 0`, `width: auto`, no `100vw`). That goes red when the declaration
   changes, but it never measures whether the panel fits on screen.

   Live measurement that motivated the fix (420px viewport):
     - centred .masthead-signals island ≈ 372px (24px gutter each side)
     - panel sized off the viewport ≈ 396px, right-aligned to the island
     - left overhang = 24px — "WAITING ON YOU" read as "AITING ON YOU"
*/

export type NarrowPanelStrategy = {
  anchorAlignSelf: "center" | "stretch" | "other";
  panelFillsAnchor: boolean;
  panelUsesViewportWidth: boolean;
};

export function parseNarrowPanelStrategy(css: string): NarrowPanelStrategy {
  const from = css.indexOf("@media (max-width: 760px)");
  expect(from).toBeGreaterThanOrEqual(0);
  const nextAt = css.indexOf("@media", from + 1);
  const block = css.slice(from, nextAt === -1 ? undefined : nextAt);
  const signals = block.match(/\.masthead-signals\s*\{([^}]*)\}/);
  const align = /align-self:\s*(stretch|center)/.exec(signals?.[1] ?? "");
  const panelIdx = block.indexOf(".notify-panel");
  const panelBody = panelIdx >= 0
    ? (block.slice(panelIdx).match(/\.notify-panel\s*\{([^}]*)\}/)?.[1] ?? "")
    : "";
  const fills = /\bleft:\s*0\b/.test(panelBody)
    && /\bright:\s*0\b/.test(panelBody)
    && /\bwidth:\s*auto\b/.test(panelBody);
  const usesVw = panelBody.includes("100vw");
  return {
    anchorAlignSelf: align?.[1] === "stretch" || align?.[1] === "center" ? align[1] : "other",
    panelFillsAnchor: fills,
    panelUsesViewportWidth: usesVw,
  };
}

/** Left-edge overhang in CSS pixels. Positive means the panel is clipped. */
export function leftOverhangPx(input: {
  viewportWidth: number;
  anchorWidth: number;
  anchorAlignSelf: "center" | "stretch";
  panelWidth: number;
}): number {
  const anchorLeft = input.anchorAlignSelf === "stretch"
    ? 0
    : (input.viewportWidth - input.anchorWidth) / 2;
  // Panel is absolutely positioned with right: 0 against the signals anchor.
  const panelLeft = anchorLeft + input.anchorWidth - input.panelWidth;
  return Math.max(0, -panelLeft);
}

/** Resolve the 420px case from the CSS strategy, using the live-board numbers
    for the pre-fix (center + viewport-width) configuration. */
export function layoutAt420(strategy: NarrowPanelStrategy): {
  viewportWidth: number;
  anchorWidth: number;
  anchorAlignSelf: "center" | "stretch";
  panelWidth: number;
} {
  const viewportWidth = 420;
  if (strategy.panelFillsAnchor) {
    if (strategy.anchorAlignSelf === "stretch") {
      return { viewportWidth, anchorWidth: 420, anchorAlignSelf: "stretch", panelWidth: 420 };
    }
    // Fill a centred island — on-screen, but not the A11Y-1 fix.
    return { viewportWidth, anchorWidth: 372, anchorAlignSelf: "center", panelWidth: 372 };
  }
  // Viewport-measured width (100vw) right-aligned to a centred island — the defect.
  return {
    viewportWidth,
    anchorWidth: strategy.anchorAlignSelf === "stretch" ? 420 : 372,
    anchorAlignSelf: strategy.anchorAlignSelf === "stretch" ? "stretch" : "center",
    panelWidth: viewportWidth,
  };
}

describe("A11Y-1 — panel geometry at 420px, not just CSS text", () => {
  const css = read("styles.css");

  test("the pre-fix configuration overhangs the left edge by the measured gutter", () => {
    /* Documents the defect the CSS-text test cannot state: a centred island
       with a viewport-width panel right-aligned to it clips 24px on the left
       at 420. (Island 372 + 24px gutters; panel 100vw = 420 → panelLeft −24.) */
    expect(leftOverhangPx({
      viewportWidth: 420,
      anchorWidth: 372,
      anchorAlignSelf: "center",
      panelWidth: 420,
    })).toBe(24);
  });

  test("the shipped narrow strategy fills its anchor and yields zero left overhang at 420px", () => {
    const strategy = parseNarrowPanelStrategy(css);
    /* Stretch alone is not the fix — a viewport-measured width under stretch
       still fails to fill the anchor (the CSS-text test's left/right/auto
       clause). Geometry names both halves. */
    expect(strategy.anchorAlignSelf, JSON.stringify(strategy)).toBe("stretch");
    expect(strategy.panelFillsAnchor, JSON.stringify(strategy)).toBe(true);
    expect(strategy.panelUsesViewportWidth, JSON.stringify(strategy)).toBe(false);
    const layout = layoutAt420(strategy);
    expect(leftOverhangPx(layout), JSON.stringify({ strategy, layout })).toBe(0);
  });

  test("center + viewport-measured width is rejected by the geometry model", () => {
    /* The CSS-text test fails when `align-self: stretch` is reverted even if
       the panel still fills its (narrower) anchor — overhang stays 0, clipping
       does not return. This row fails only when the clipping geometry returns. */
    const broken = leftOverhangPx(layoutAt420({
      anchorAlignSelf: "center",
      panelFillsAnchor: false,
      panelUsesViewportWidth: true,
    }));
    expect(broken).toBe(24);
    const centerButFill = leftOverhangPx(layoutAt420({
      anchorAlignSelf: "center",
      panelFillsAnchor: true,
      panelUsesViewportWidth: false,
    }));
    expect(centerButFill).toBe(0);
  });
});
