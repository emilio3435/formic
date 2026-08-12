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
import { fakeStorage } from "./helpers/fake-dom";

const WEB = join(import.meta.dir, "../src/web");
const read = (name: string) => readFileSync(join(WEB, name), "utf8");

/* Whole @media block bodies for one query, brace-balanced, all occurrences.
   The A11Y-1 parser above slices to the NEXT @media, which misses rules in a
   later block for the same query; the collapse rules live in their own blocks. */
export function mediaBlocks(css: string, query: string): string {
  const out: string[] = [];
  const needle = "@media " + query;
  let idx = 0;
  while ((idx = css.indexOf(needle, idx)) !== -1) {
    const open = css.indexOf("{", idx);
    let depth = 1;
    let i = open + 1;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
      i += 1;
    }
    out.push(css.slice(open + 1, i - 1));
    idx = i;
  }
  return out.join("\n");
}

/* Flat {selector, body} rules, comments stripped. Good enough for a stylesheet
   with no nesting outside @media. */
export function cssRules(cssText: string): Array<{ selector: string; body: string }> {
  const bare = cssText.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "");
  return [...bare.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .map((m) => ({ selector: m[1].trim(), body: m[2] }));
}

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

/* ---------- header collapse — preference honesty ----------
   The preference must parse strictly (only the literal "true" collapses),
   default to expanded on anything else, and fail soft when storage is absent
   or throwing. Driven through the real load/save functions, not source regex:
   a regex showing getItem is not persistence evidence. */

describe("header collapse — the preference parses strictly and fails soft", () => {
  test("parseHeaderCollapsed accepts only the literal string 'true'", async () => {
    // @ts-expect-error browser client has no declaration
    await import("../src/web/app.js");
    const M = (globalThis as any).TheAntHill;
    expect(M.parseHeaderCollapsed("true")).toBe(true);
    for (const raw of [null, undefined, "", "false", "TRUE", "True", "1", "yes", " true", '{"collapsed":true}']) {
      expect(M.parseHeaderCollapsed(raw), JSON.stringify(raw)).toBe(false);
    }
  });

  test("load resolves expanded on a missing key and on a throwing store; save survives a throwing store and writes literals", async () => {
    // @ts-expect-error browser client has no declaration
    await import("../src/web/app.js");
    const M = (globalThis as any).TheAntHill;
    const G = globalThis as unknown as Record<string, any>;
    const realLS = G.localStorage;
    try {
      G.localStorage = fakeStorage();
      M.state.headerCollapsed = true; // stale value the load must overwrite
      M.loadHeaderCollapsed();
      expect(M.state.headerCollapsed).toBe(false);

      G.localStorage = fakeStorage({ "mtn3-header-collapsed": "true" });
      M.loadHeaderCollapsed();
      expect(M.state.headerCollapsed).toBe(true);

      G.localStorage = fakeStorage({ "mtn3-header-collapsed": "TRUE" });
      M.loadHeaderCollapsed();
      expect(M.state.headerCollapsed).toBe(false);

      G.localStorage = fakeStorage({}, ["getItem"]);
      M.state.headerCollapsed = true;
      expect(() => M.loadHeaderCollapsed()).not.toThrow();
      expect(M.state.headerCollapsed).toBe(false);

      G.localStorage = fakeStorage({}, ["setItem"]);
      M.state.headerCollapsed = true;
      expect(() => M.saveHeaderCollapsed()).not.toThrow();

      const store = fakeStorage();
      G.localStorage = store;
      M.state.headerCollapsed = true;
      M.saveHeaderCollapsed();
      expect(store.store.get("mtn3-header-collapsed")).toBe("true");
      M.state.headerCollapsed = false;
      M.saveHeaderCollapsed();
      expect(store.store.get("mtn3-header-collapsed")).toBe("false");
    } finally {
      if (realLS === undefined) delete G.localStorage; else G.localStorage = realLS;
      M.state.headerCollapsed = false;
    }
  });

  test("the storage key is declared in the catalog and loaded in boot() before the first fetch", () => {
    const catalogs = read("client-catalogs.js");
    const app = read("app.js");
    expect(catalogs).toMatch(/export const HEADER_COLLAPSED_STORAGE_KEY\s*=\s*"mtn3-header-collapsed"/);
    const bootBody = app.match(/function boot\(\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(bootBody).toContain("loadHeaderCollapsed()");
    /* Loading after the first snapshot request is a preference that loses the
       race to the first paint. */
    expect(bootBody.indexOf("loadHeaderCollapsed()")).toBeLessThan(bootBody.indexOf("fetchSnapshot()"));
    expect(bootBody).toMatch(/\$\("header-summary-toggle"\)\.addEventListener\("click",\s*toggleHeaderCollapsed\)/);
  });

  test("syncHeaderDisclosure does not insertBefore the toggle when it is already in the mode slot", () => {
    const app = read("app.js");
    const body = app.match(/function syncHeaderDisclosure\(\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(body).toContain("alreadyPlaced");
    expect(body).toMatch(/firstElementChild/);
    expect(body).toMatch(/lastElementChild/);
    expect(body).toMatch(/if\s*\(\s*!alreadyPlaced\s*\)/);
  });
});

/* ---------- header collapse — compact layout strategy ----------
   Source-contract layer only: these prove the declared strategy exists and is
   scoped to the collapsed body state. Real Chromium in
   docs/header-collapse-geometry-gate owns every geometry claim. */

describe("header collapse — compact layout strategy stays collapsed-scoped", () => {
  const css = read("styles.css");

  test("collapsed rules exist and never touch RHSP, workboard, or scroll-owner selectors", () => {
    const collapsedRules = cssRules(css).filter((rule) => rule.selector.includes("header-summary-collapsed"));
    expect(collapsedRules.length).toBeGreaterThan(0);
    const fence = [
      ".pane-inspector", "#inspector", ".drawer-", ".command-composer",
      ".app-body", ".ops-stage", ".pane-list", "#programs", ".workboard",
    ];
    for (const rule of collapsedRules) {
      for (const banned of fence) {
        expect(rule.selector.includes(banned), rule.selector).toBe(false);
      }
    }
    /* And the compact container's own rules stay inside the container: every
       .compact-summary selector is either the container itself or its
       descendants — never a sibling/ancestor combinator that could restyle
       expanded chrome. */
    const compactRules = cssRules(css).filter((rule) => rule.selector.includes(".compact-summary"));
    expect(compactRules.length).toBeGreaterThan(0);
    for (const rule of compactRules) {
      for (const part of rule.selector.split(",")) {
        const s = part.trim();
        if (!s.includes(".compact-summary")) continue;
        expect(/\.compact-summary[^ ]*\s*[+~>]?/.test(s), s).toBe(true);
        expect(s.includes("~ ") || s.includes("+ "), s).toBe(false);
      }
    }
  });

  test("desktop row, intermediate wrap, and mobile two-column strategies exist at the locked boundaries", () => {
    /* Desktop base: the compact face is a flex row. */
    const base = cssRules(css).find((rule) => rule.selector.trim() === ".compact-summary");
    expect(base, "base .compact-summary rule").toBeTruthy();
    expect(base!.body).toMatch(/display:\s*flex/);

    /* Intermediate 721–1024: collapsed masthead may wrap onto a second line. */
    const mid = mediaBlocks(css, "(max-width: 1024px)");
    expect(mid).toContain("header-summary-collapsed");
    expect(mid).toMatch(/header-summary-collapsed[^{]*\{[^}]*flex-wrap:\s*wrap/);

    /* Mobile <=720: compact readings become a two-column grid. minmax(0, …)
       is part of the contract — bare 1fr tracks keep a content min-width
       floor, which measured 436px of masthead on a 390px viewport. */
    const mobile = mediaBlocks(css, "(max-width: 720px)");
    expect(mobile).toContain("header-summary-collapsed");
    expect(mobile).toMatch(/header-summary-collapsed[^{]*\.compact-summary[^{]*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  });

  test("the compact container hides expanded-only sublabels and gauges, and declares no font family", () => {
    const rules = cssRules(css);
    const hides = (cls: string) => rules.some((rule) =>
      rule.selector.split(",").some((part) => part.includes(".compact-summary") && part.includes(cls))
      && /display:\s*none/.test(rule.body));
    expect(hides(".reading-sub"), ".reading-sub").toBe(true);
    expect(hides(".ctx-gauge"), ".ctx-gauge").toBe(true);
    /* Compact Context keeps its label, but app.js renders it as a static span
       instead of copying the expanded face's toggle into the compact face. */
    expect(hides(".context-toggle"), ".context-toggle").toBe(false);
    /* Shipped fonts and weights only: the compact face inherits type from the
       existing reading classes and may resize, never re-family or re-weight. */
    const compactish = rules.filter((rule) =>
      rule.selector.includes(".compact-summary") || rule.selector.includes("header-summary-collapsed"));
    for (const rule of compactish) {
      expect(/font-family|font-weight|font:/.test(rule.body), rule.selector).toBe(false);
    }
  });

  test("mobile both-mode packing is documented outside the collapsed-only block", () => {
    const marker = "Header collapse — the masthead's compact summary face.";
    const next = "Header disclosure — mobile operability in both modes.";
    const block = css.slice(css.indexOf(marker), css.indexOf(next));
    expect(block).not.toMatch(/@media\s*\(max-width:\s*720px\)[\s\S]*?\n\s*\.masthead-signals\s*\{/);
    expect(css).toContain(next);
  });
});
