/* FE-4 — where a narrow row PUTS its instruments.
 *
 * The 720px rules were written for a five-child column header. The Harness
 * column was inserted later and nothing here was renumbered, so the map is off
 * by one in a way that is invisible in source and obvious on a phone:
 *
 *   - nth-child(3) is now Harness, and it is placed in the area named `model`,
 *     so the header labels the right-hand column "Harness" while every row
 *     prints a MODEL underneath it;
 *   - nth-child(4) Model and nth-child(5) Ctx are folded away, so the header
 *     hides the label of the value actually on screen;
 *   - nth-child(6) Tokens and nth-child(7) Quiet/Span have neither an area nor
 *     a fold, so the grid invents implicit rows 3 and 4 for them;
 *   - in the row itself `.row-instruments` is display:contents, which makes
 *     `.ri-harness` and `.ri-ctx` direct grid children with no area and no
 *     fold — two more implicit rows on EVERY row on the board.
 *
 * These tests read the stylesheet through the shared reader in
 * tests/helpers/css-rules.ts rather than a second private copy, so this file and
 * tests/row-condensed.test.ts cannot drift into two readings of the same bytes.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  addressesElement,
  areaMatrix as sharedAreaMatrix,
  atRestRules as sharedAtRestRules,
  declaredValues,
  effectiveDeclaration,
  effectiveForSelector,
  effectiveValue,
  isCanonicalFor,
  isAtRestSelector,
  isUniversalFor,
  mediaBlocks,
  outranks,
  specificityOf,
  winningDeclaration,
  effectiveProp,
  effectiveProps,
  normalizeSelector,
  parseSelector,
  parseRules,
  placementIn,
  selectRules,
  splitCompounds,
  stripComments,
} from "./helpers/css-rules";
import { textOf, withDom } from "./helpers/fake-dom";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let M: any;

const root = resolve(import.meta.dir, "..");
const styles = readFileSync(resolve(root, "src/web/styles.css"), "utf8");
const css = stripComments(styles);

beforeAll(async () => {
  // @ts-expect-error The dependency-free browser client intentionally has no declaration file.
  await import("../src/web/app.js");
  M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
});

/** Every 720px block joined — the breakpoint is stated more than once. */
const phone = () => mediaBlocks(css, "(max-width: 720px)").join("\n");

/** The area names declared by any `grid-template-areas` inside `block`. */
function declaredAreas(block: string): Set<string> {
  const names = new Set<string>();
  for (const decl of block.matchAll(/grid-template-areas:\s*([^;]+);/g)) {
    for (const quoted of decl[1].matchAll(/"([^"]*)"/g)) {
      for (const name of quoted[1].trim().split(/\s+/)) if (name && name !== ".") names.add(name);
    }
  }
  return names;
}

/** Does this selector actually address the audited cell ITSELF?
 *
 *  Substring matching is what makes a grid audit lie, in three distinct ways,
 *  and each one would report an unplaced cell as handled:
 *
 *    `.ri-ctx-gauge`            — a different element sharing a prefix
 *    `.ri-model + .ri-ctx::before` — a pseudo-ELEMENT, which is not the cell and
 *                                 cannot carry the cell's grid placement
 *    `.ri-ctx:hover`            — a pseudo-CLASS, which places the cell only
 *                                 while a pointer is over it; a layout that is
 *                                 correct on hover and broken at rest is the
 *                                 defect, not the fix
 *    `.ri-ctx .ri-value`        — a DESCENDANT of the cell; placing or folding a
 *                                 child says nothing about where the cell lands
 *
 *  So the target must be the final compound of the selector, and NO compound in
 *  that selector may carry a pseudo of either kind. An ancestor's pseudo-class
 *  gates the rule exactly as the cell's own does — `.agent-row:hover .ri-ctx`
 *  places the cell only while a pointer rests on the row, which is not a layout
 *  a reader at rest ever sees. The audit's question is whether the cell is
 *  placed UNCONDITIONALLY, so anything conditional is not an answer. */
function addressesCell(selector: string, target: string): boolean {
  /* SUPERSEDED BODY, deliberately delegated. The version that lived here
     rejected EVERY colon, which silently declared the column header's own rules
     invisible: its entire area map is written with `:nth-child(N)`, so the audit
     found nothing and reported all seven children as unplaced — a false reading
     dressed as a finding. The real distinction is structural pseudo (always
     true, describes where a node sits) versus gating pseudo (:hover, :not,
     ::before), and it lives in the shared reader so this file and
     tests/row-condensed.test.ts cannot answer differently about one stylesheet. */
  return addressesElement(selector, target);
}

/** Board rows only. `.agent-grid` is worn by the column header and by preview
 *  surfaces too, so a row cell's placement is read from rules scoped to the row
 *  itself — the universal at-rest board selector. */
const BOARD_ROW = /\.agent-row\b/;

/** How a cell is disposed of inside a block: an explicit named area, an explicit
 *  fold, or nothing at all — which means an implicit track. */
function placement(block: string, selector: string): { area: string | null; folded: boolean } {
  /* Scoped to board rows, and the shared reader lets a LATER declaration win —
     a cell folded by one rule and restored by a later one is visible, and
     calling it folded would excuse it from needing an area. */
  return placementIn(block, selector, BOARD_ROW);
}

/** `grid-template-areas` as a matrix of rows of area names. */
function areaMatrix(body: string): string[][] {
  return sharedAreaMatrix(body);
}

/** Rules whose selector addresses the thing at REST.
 *
 *  `rules(block).find(...)` matching on two class names is too loose to audit a
 *  grid with: `.agent-row:hover .agent-grid`, `.program-preview .agent-grid`, or
 *  a rule scoped to some unrelated ancestor all satisfy it while describing a
 *  layout the reader does not have. A mutation that moved the real area map into
 *  a hover rule would leave every such search still finding something, and every
 *  assertion still passing. */
function atRestRules(block: string, needles: RegExp[]) {
  return sharedAtRestRules(block, needles);
}

/** A guard on the discovery helper itself, exercised as a test below. */
export const AT_REST_SAMPLE = `
      .agent-row .agent-grid { grid-template-areas: "a a" "b c"; }
      .agent-row:hover .agent-grid { grid-template-areas: "z z" "z z"; }
      .program-preview .agent-grid { grid-template-areas: "q q" "q q"; }
    `;

describe("FE-4 at 720px every instrument cell is placed or explicitly folded", () => {
  /* `.row-instruments` is display:contents, so each of these is a direct child
     of `.agent-grid` and is laid out by the grid itself. A cell with no area and
     no fold does not disappear — it is given a brand-new implicit row. */
  const CELLS = [".row-state", ".ri-harness", ".ri-model", ".ri-ctx", ".ri-tokens", ".ri-elapsed"];

  /* The literal selectors the narrow layout is written with. Tests ask for
     these by name rather than by pattern, so a rule that stops existing fails
     by absence instead of quietly matching nothing. */
  const ROW_GRID = ".agent-row .agent-grid";
  const HEADER = ".agent-column-header";
  const cellSel = (cell: string) => ".agent-row " + cell;

  /* ---------- the FE-4 winner table, shared by the product expectation and
       the mutation proofs ----------

     Both tests must ask the SAME question of the sheet, so the table and the
     reader live here rather than inside one of them. */
  const HDRC = (n: number) => `${HEADER} > :nth-child(${n})`;
  const FE4_PLACED: Array<[string, string]> = [
    [cellSel(".row-identity"), "identity"],
    [cellSel(".row-state"), "status"],
    [cellSel(".ri-model"), "model"],
    [HDRC(1), "agent"],
    [HDRC(2), "status"],
    [HDRC(4), "model"],
  ];
  const FE4_FOLDED: string[] = [
    cellSel(".ri-harness"), cellSel(".ri-ctx"), cellSel(".ri-tokens"), cellSel(".ri-elapsed"),
    HDRC(3), HDRC(5), HDRC(6), HDRC(7),
  ];
  const FE4_EXACT: Array<[string, string, string]> = [
    [".agent-grid", "grid-template-columns", "minmax(0, 1fr) minmax(5.2rem, auto)"],
    [HEADER, "grid-template-areas", `"agent agent" "status model"`],
    [ROW_GRID, "grid-template-areas", `"identity identity" "status model"`],
    [".row-instruments", "display", "contents"],
  ];

  /** Every way `sheet` departs from that table at 720.
   *
   *  FAIL CLOSED everywhere, not only on the EXACT rows: an unclassifiable
   *  context — an `@supports`, a condition list, a feature query — that writes a
   *  placement or a fold is a violation, because the reader cannot say whether
   *  it wins. Reporting it is the only honest answer. */
  const fe4Violations = (sheet: string): string[] => {
    return fe4ViolationsImpl(sheet);
  };

  /** The live winner at 720, shared by both tests. */
  const at720 = (sheet: string, target: string, prop: string) =>
    winningDeclaration(sheet, 720, target, prop);

  const fe4ViolationsImpl = (sheet: string): string[] => {
    const found: string[] = [];
    const win = (sel: string, prop: string) => {
      const r = winningDeclaration(sheet, 720, sel, prop);
      if (r.unclassified.length) found.push(`${sel}{${prop}} unclassified:${r.unclassified.join("|")}`);
      return r.value;
    };
    /* `display` is a keyword, and keywords are case-insensitive: `NONE` folds a
       cell exactly as `none` does, and comparing raw text let it through. */
    const displayOf = (sel: string) => {
      const v = win(sel, "display");
      return v === null ? null : v.trim().toLowerCase();
    };
    for (const [sel, prop, want] of FE4_EXACT) {
      if (win(sel, prop) !== want) found.push(`${sel}{${prop}}`);
    }
    for (const [sel, area] of FE4_PLACED) {
      if (win(sel, "grid-area") !== area) found.push(`${sel}{grid-area}`);
      /* A placed cell that is also folded is not placed at all. */
      if (displayOf(sel) === "none") found.push(`${sel}{display}`);
    }
    for (const sel of FE4_FOLDED) {
      if (displayOf(sel) !== "none") found.push(`${sel}{display}`);
      if (win(sel, "grid-area") !== null) found.push(`${sel}{grid-area}`);
    }
    return found;
  };

  /* The header emits eight children; every rule that places or folds one
     addresses it as `:nth-child(N)`. Each is queried by that exact selector. */
  const HEADER_CHILDREN = [1, 2, 3, 4, 5, 6, 7, 8];

  test("the narrow layout is written with exactly the selectors this audit names", () => {
    /* If the sheet stops using a selector this file queries, every assertion
       built on it would pass vacuously by finding no rule. Presence is checked
       once, here, so the rest can assert about values. */
    const block = phone();
    expect(selectRules(block, ROW_GRID).length, `no rule names "${ROW_GRID}"`).toBeGreaterThan(0);
    expect(selectRules(block, HEADER).length, `no rule names "${HEADER}"`).toBeGreaterThan(0);
    expect(selectRules(block, ".agent-grid").length, `no rule names ".agent-grid"`).toBeGreaterThan(0);
    /* Normalization is identity-preserving on the shapes we query. */
    expect(normalizeSelector(".agent-row   .agent-grid")).toBe(ROW_GRID);
    expect(normalizeSelector(".agent-column-header >  :nth-child(n + 2)"))
      .toBe(".agent-column-header > :nth-child(n + 2)");
  });

  test("the narrow grid declares exactly the intended track definition", () => {
    /* Read as the EFFECTIVE last value for the exact selector, so a later rule
       redefining the tracks is what the audit reports. */
    const block = phone();
    expect(effectiveProp(block, ".agent-grid", "grid-template-columns"),
      "the 720 track definition changed").toBe("minmax(0, 1fr) minmax(5.2rem, auto)");
  });

  test("each instrument cell has exactly one disposition: a named area or a fold", () => {
    /* The same claim the placement audit makes, expressed against exact rules
       instead of a regex walk. A cell with neither is in an implicit track. */
    const block = phone();
    const unplaced: string[] = [];
    for (const cell of CELLS) {
      const sel = cellSel(cell);
      const area = effectiveProp(block, sel, "grid-area");
      const display = effectiveProp(block, sel, "display");
      if (display === "none") continue;
      if (area) continue;
      unplaced.push(cell);
    }
    expect(unplaced, `these cells have no exact-selector disposition at 720px: ${unplaced.join(", ")}`)
      .toEqual([]);
  });

  test("each cell's disposition is exclusive, and lands in its own intended area", () => {
    /* Placed OR folded, never both: a rule carrying an area AND display:none
       says two contradictory things, and whichever the browser honours is not a
       decision anyone made.

       And the areas are not interchangeable. Harness, context, tokens, quiet
       and the docked stack are all DROPPED at this width; only identity, status
       and model are drawn. A fix that parked `.ri-harness` in `status` would
       satisfy "has an area" while putting two values in one cell. */
    const block = phone();
    const INTENDED: Record<string, string | null> = {
      ".row-identity": "identity",
      ".row-state": "status",
      ".ri-model": "model",
      /* null = folded, no area of its own. */
      ".ri-harness": null,
      ".ri-ctx": null,
      ".ri-tokens": null,
      ".ri-elapsed": null,
    };
    for (const [cell, area] of Object.entries(INTENDED)) {
      const sel = cellSel(cell);
      const has = effectiveProp(block, sel, "grid-area");
      const folded = effectiveProp(block, sel, "display") === "none";
      expect(has !== null && folded, `${cell} is both placed in "${has}" and folded`).toBe(false);
      if (area === null) {
        expect(folded, `${cell} must be folded at 720, and is not`).toBe(true);
        expect(has, `${cell} is folded but still claims the "${has}" area`).toBeNull();
      } else {
        expect(has, `${cell} is not placed in its intended "${area}" area`).toBe(area);
      }
    }
  });

  test("the folded cells are folded, and the placed cells name a declared area", () => {
    const block = phone();
    /* Tokens and Span are deliberately dropped; those are the only two. */
    expect(effectiveProp(block, cellSel(".ri-tokens"), "display")).toBe("none");
    expect(effectiveProp(block, cellSel(".ri-elapsed"), "display")).toBe("none");
    /* Identity and status keep their areas, by exact selector. */
    expect(effectiveProp(block, ".agent-row .row-identity", "grid-area")).toBe("identity");
    expect(effectiveProp(block, ".agent-row .row-state", "grid-area")).toBe("status");
  });

  test("a later rule on the SAME exact selector is what the audit reports", () => {
    /* The mutation: leave the correct rule in place and append one that undoes
       it. A first-match reader reports the contract as intact. */
    const mutant = `
      .agent-row .ri-tokens { display: none; }
      .agent-row .ri-tokens { display: block; }
      .agent-grid { grid-template-columns: minmax(0, 1fr) minmax(5.2rem, auto); }
      .agent-grid { grid-template-columns: 1fr 1fr 1fr; }
    `;
    expect(effectiveProp(mutant, ".agent-row .ri-tokens", "display")).toBe("block");
    expect(effectiveProp(mutant, ".agent-grid", "grid-template-columns")).toBe("1fr 1fr 1fr");
    /* And a custom-property lookalike is not the property. */
    expect(effectiveProp(`.agent-row .ri-tokens { --display: none; }`, ".agent-row .ri-tokens", "display"))
      .toBeNull();
    /* A scoped variant does not answer for the exact selector. */
    expect(effectiveProp(`.agent-row.is-selected .ri-tokens { display: none; }`, ".agent-row .ri-tokens", "display"))
      .toBeNull();
  });

  test("the row instruments are grid children, which is why placement is mandatory", () => {
    /* Read through the exact rule API, and across the WHOLE sheet rather than
       the media body alone. A regex over the raw text matched the first rule
       mentioning both strings; a later global rule setting `display: block` on
       the same selector would take the cell out of the grid at runtime while
       the regex still reported `contents`. The effective last value is what the
       browser uses, so it is what the audit reports. */
    expect(effectiveProp(css, ".row-instruments", "display"),
      ".row-instruments is no longer display:contents at runtime — re-read FE-4")
      .toBe("contents");
    /* The mutant that motivates it. */
    expect(effectiveProp(css + `\n.row-instruments { display: block; }`, ".row-instruments", "display"),
      "a later global rule did not override the earlier display:contents").toBe("block");
  });

  test("the asserted 720 disposition is the winning declaration, by importance then specificity then source order", () => {
    /* SOURCE-POSITION AWARE, and the previous version was not.

       It computed `css.indexOf(phone())`, where `phone()` is every 720 block
       JOINED with newlines — a string that appears nowhere in the stylesheet.
       `indexOf` returned -1, so `slice(-1 + length)` made the "tail" the whole
       sheet, and the audit compared the block against a superset of itself. It
       reported no override because it could not see one.

       This walks the real 720 ranges at their real offsets and ranks candidate
       declarations the way a browser does for this narrow case: `!important`
       first, then specificity, then absolute source order. Deliberately not a
       CSS engine — no shorthand expansion, no inheritance, no cascade layers,
       and only the targeted row/header placement selectors. */
    /* THE LIVE INPUT IS THE WHOLE STYLESHEET. Every earlier version handed the
       audit a pre-extracted, hand-concatenated slice of the very thing it was
       meant to check — and one of them concatenated so wrongly that the audit
       compared the block against itself and could not report an override at
       all. The mutants below edit a full stylesheet STRING and go through this
       same call, so the test exercises the path the product would. */
    const at720 = (sheet: string, target: string, prop: string) =>
      winningDeclaration(sheet, 720, target, prop);
    const block = phone();
    /* THE CONTRACT IS ENUMERATED, NOT DERIVED.

       Deriving the audited pairs from `effectiveProp(block, …) !== null` made
       the audit unreachable exactly where it matters: a property the phone
       block never writes was skipped, so a top-level `display` inherited from
       elsewhere — or a later global override of it — was never examined. The
       cells whose 720 disposition is MISSING are the FE-4 defect, and those are
       precisely the pairs that got silently dropped.

       Each targeted selector is listed with the properties its contract owns,
       and every pair is resolved against the full sheet whether or not the
       phone block mentions it. */
    /* THE EXACT FE-4 WINNER TABLE, enumerated rather than derived.

       Deriving the audited pairs from `effectiveProp(block, …) !== null` made
       the audit unreachable exactly where it matters: a property the phone
       block never writes was skipped, and the cells whose 720 disposition is
       MISSING are the FE-4 defect. Those were precisely the pairs dropped.

       This is the layout's own table, no broader: what each targeted selector
       must resolve to at 720 across the whole sheet. */
    /* THE PRODUCT EXPECTATION. Red today: the narrow layout folds neither
       `.ri-harness` nor `.ri-ctx`, and places the Harness header where the rows
       print a model.

       Every mutation proof lives in its own test below. Keeping them here put
       them AFTER this assertion, so the first failure ended the test and none of
       the named mutants ever reached an assertion — they were reported as
       covered while never having run. */
    expect(fe4Violations(styles),
      `the 720 layout departs from its own winner table: ${fe4Violations(styles).join("; ")}`)
      .toEqual([]);
  });

  test("the FE-4 winner table rejects each named full-sheet mutant", () => {
    /* Independent of the product red above, so these assertions run and are
       seen to run. `added` compares against the clean sheet's own violations,
       so a mutant is only credited with what it introduces. */
    const added = (sheet: string) => fe4Violations(sheet)
      .filter((v) => !fe4Violations(styles).includes(v));

    expect(added(styles + `\nbody .row-instruments { display: block; }`),
      "a global .row-instruments override was not rejected")
      .toContain(".row-instruments{display}");

    /* Case-insensitive keyword: NONE folds a placed cell exactly as none does. */
    expect(added(styles + `\nbody ${cellSel(".ri-model")} { display: NONE; }`),
      "an upper-case display:NONE fold of a placed cell was not rejected")
      .toContain(`${cellSel(".ri-model")}{display}`);

    expect(added(styles + `\n@media (max-width: 900px) { body ${cellSel(".ri-model")} { display: none; } }`),
      "an ACTIVE max-width 900 fold of .ri-model was not rejected")
      .toContain(`${cellSel(".ri-model")}{display}`);

    expect(added(styles + `\n@media (min-width: 700px) { body ${cellSel(".ri-harness")} { grid-area: model; } }`),
      "an ACTIVE min-width 700 placement of .ri-harness was not rejected")
      .toContain(`${cellSel(".ri-harness")}{grid-area}`);

    /* The inactive negative stays: a min-width 721 rule is not in force at 720. */
    expect(added(styles + `\n@media (min-width: 721px) { body .row-instruments { display: block; } }`),
      "a rule from a non-applicable media query changed the 720 verdict")
      .toEqual([]);

    /* UNCLASSIFIED CONTEXT. An @supports block is not modelled, so a placement
       hidden inside one cannot be resolved — and must be reported rather than
       skipped as harmless. */
    expect(
      added(styles + `\n@supports (display: grid) { ${cellSel(".row-identity")} { display: none; } }`)
        .some((v) => v.startsWith(`${cellSel(".row-identity")}{display} unclassified:`)),
      "an @supports rule hiding a placed cell was not reported as unclassified",
    ).toBe(true);

    /* ANCESTOR SCOPE PLUS AN EXTENSION on the target's final compound. */
    expect(added(styles + `\nbody .row-instruments.row-instruments { display: block; }`),
      "an ancestor-scoped same-element extension was not rejected")
      .toContain(".row-instruments{display}");
    expect(added(styles + `\nbody ${cellSel(".ri-model")}.ri-model { display: none; }`),
      "an ancestor-scoped .ri-model.ri-model fold was not rejected")
      .toContain(`${cellSel(".ri-model")}{display}`);

    /* And the negatives: a prefix-sharing class and a DESCENDANT of the target
       are different elements. */
    expect(added(styles + `\nbody .row-instruments-extra { display: block; }`),
      "a prefix-sharing class was read as the audited element").toEqual([]);
    expect(added(styles + `\nbody .row-instruments .child { display: block; }`),
      "a descendant of the audited element was read as the element").toEqual([]);

    /* EVERY JOIN COMBINATOR. The combinator attaching an added prefix to the
       target's first compound is scope, not shape: each of these still selects
       the very element being audited, more narrowly. Requiring a descendant
       join let three real ways of writing a stronger rule slip past. */
    expect(added(styles + `\nbody > .row-instruments.row-instruments { display: block; }`),
      "a direct-child join was not recognised as scope over the same element")
      .toContain(".row-instruments{display}");
    expect(added(styles + `\n.board > ${cellSel(".ri-model")}.ri-model { display: none; }`),
      "a direct-child join above a multi-compound target was not recognised")
      .toContain(`${cellSel(".ri-model")}{display}`);
    expect(added(styles + `\n.peer + .row-instruments.row-instruments { display: block; }`),
      "an adjacent-sibling join was not recognised as scope over the same element")
      .toContain(".row-instruments{display}");
    expect(added(styles + `\n.peer ~ .row-instruments.row-instruments { display: block; }`),
      "a general-sibling join was not recognised as scope over the same element")
      .toContain(".row-instruments{display}");

    /* But a combinator INSIDE the target's own chain is shape. With a target of
       `.agent-row .ri-model`, writing `.agent-row > .ri-model` describes a
       direct child — a different set of elements — and must not be read as the
       audited cell. */
    expect(added(styles + `\n.agent-row > .ri-model.ri-model { display: none; }`),
      "a changed internal chain combinator was read as the audited element").toEqual([]);

    /* SEMANTICS-PRESERVING SPELLINGS. Each of these selects exactly the audited
       element by a purely notational difference, so a rule written this way
       overrides the layout just as surely — and an audit that missed it would
       certify a board the browser does not render. */
    expect(added(styles + `\n.agent-row.agent-row .ri-model { grid-area: identity; }`),
      "a repeated ancestor compound was not recognised as the same element")
      .toContain(`${cellSel(".ri-model")}{grid-area}`);
    expect(added(styles + `\n*.row-instruments { display: block; }`),
      "a universal-star prefix was not recognised as the same element")
      .toContain(".row-instruments{display}");
    expect(added(styles + `\n.agent-row *.ri-model { display: none; }`),
      "a universal star before the target compound was not recognised")
      .toContain(`${cellSel(".ri-model")}{display}`);

    /* AND THE BOUNDARY. Every one of these ADDS a condition, so it selects a
       strictly smaller set than the audited element and must not answer for it.
       `:hover` and `::before` are refused earlier still, by the at-rest reader. */
    for (const [why, rule] of [
      ["an extra class on an ancestor", `.agent-row.other .ri-model { grid-area: identity; }`],
      ["an attribute qualifier", `[data-x].row-instruments { display: block; }`],
      ["an id qualifier", `#x.row-instruments { display: block; }`],
      ["a prefix-sharing class", `.row-instruments-extra { display: block; }`],
      ["a descendant of the target", `.row-instruments .child { display: block; }`],
      ["a changed internal combinator", `.agent-row > .ri-model { display: none; }`],
      ["an interactive pseudo-class", `.row-instruments:hover { display: block; }`],
      ["a pseudo-element", `.row-instruments::before { display: block; }`],
      ["an extra class on the target itself", `.row-instruments.other { display: block; }`],
    ] as const) {
      expect(added(styles + "\n" + rule), `${why} was read as the audited element`).toEqual([]);
    }

    /* SELECTOR-LIST SPECIFICITY, on the actual sheet. The weaker branch is
       listed first and the rule is PREPENDED, so only reading the strongest
       branch of the list gets the right answer. */
    expect(added(`${cellSel(".ri-model")}, body ${cellSel(".ri-model")} { grid-area: identity; }\n` + styles),
      "a prepended selector-list whose stronger branch wins was not rejected")
      .toContain(`${cellSel(".ri-model")}{grid-area}`);
    expect(
      winningDeclaration(
        `${cellSel(".ri-model")}, body ${cellSel(".ri-model")} { grid-area: identity; }\n` + styles,
        720, cellSel(".ri-model"), "grid-area").value,
      "the stronger branch of a prepended selector list did not win",
    ).toBe("identity");
    expect(
      winningDeclaration(
        `${cellSel(".ri-model")}, body ${cellSel(".ri-model")} { grid-area: identity !important; }\n` + styles,
        720, cellSel(".ri-model"), "grid-area").value,
      "an important prepended selector list did not win",
    ).toBe("identity");

    /* IMPORTANCE AND CASE, through the same live path. */
    const disp = (sheet: string) =>
      winningDeclaration(sheet, 720, ".row-instruments", "display").value;
    expect(disp(styles + `\n.row-instruments { DISPLAY: block !important; }`),
      "an upper-case property name was not recognised").toBe("block");
    expect(disp(styles + `\n.row-instruments { display: block !IMPORTANT; }`),
      "an upper-case !IMPORTANT was not recognised").toBe("block");
    expect(disp(styles + `\n.row-instruments { display: block ! important ; }`),
      "a spaced ! important was not recognised").toBe("block");
    /* Within one rule: important is not displaced by a later ordinary duplicate. */
    expect(disp(styles + `\n.row-instruments { display: grid !important; display: block; }`),
      "a later ordinary declaration displaced an !important one in the same rule").toBe("grid");
    /* At equal importance the later declaration still wins. */
    expect(disp(styles + `\n.row-instruments { display: grid; display: block; }`),
      "the later of two equal-priority declarations did not win").toBe("block");

    /* MUTANT 1 — an EARLIER rule with HIGHER specificity. Source order alone
       dismisses it, because it precedes the canonical block; but `body
       .agent-row .ri-model` outranks `.agent-row .ri-model`, so it still wins
       and the board renders a layout the canonical rule never described. */
    expect(
      at720(`body ${cellSel(".ri-model")} { grid-area: identity; }\n` + styles,
        cellSel(".ri-model"), "grid-area").value,
      "an EARLIER top-level higher-specificity rule was not recognised as the winner",
    ).toBe("identity");

    /* MUTANT 2 — a SAME-ELEMENT specificity extension. `.row-instruments`
       repeated addresses the very same node with double the class count, so an
       audit matching only the exact selector or an ancestor-scoped suffix would
       never see it. */
    expect(
      at720(styles + `\n.row-instruments.row-instruments { display: block; }`,
        ".row-instruments", "display").value,
      "a same-element `.row-instruments.row-instruments` extension was not recognised",
    ).toBe("block");

    /* MUTANT 3 — a later ancestor-scoped override. */
    expect(
      at720(styles + `\nbody .row-instruments { display: block; }`, ".row-instruments", "display").value,
      "a later `body .row-instruments` override was not recognised",
    ).toBe("block");

    /* A prefix-sharing selector is a DIFFERENT element and changes nothing. */
    expect(
      at720(styles + `\nbody ${cellSel(".ri-model")}-extra { grid-area: identity; }`,
        cellSel(".ri-model"), "grid-area").value,
      "a prefix-sharing selector was read as an override",
    ).toBe(at720(styles, cellSel(".ri-model"), "grid-area").value);

    /* And the ranking itself: importance outranks specificity, which outranks
       order. */
    expect(outranks(specificityOf("body .agent-row .ri-model"), specificityOf(".agent-row .ri-model"))).toBe(true);
    expect(outranks(specificityOf(".row-instruments.row-instruments"), specificityOf(".row-instruments"))).toBe(true);
    expect(
      at720(`.row-instruments { display: grid !important; }\n`
        + `.row-instruments.row-instruments { display: block; }`,
        ".row-instruments", "display").value,
      "!important did not outrank a later, more specific rule",
    ).toBe("grid");

    /* A rule inside a media query NOT in force at 720 must be ignored. */
    expect(
      at720(styles + `\n@media (min-width: 1200px) { .row-instruments { display: block; } }`,
        ".row-instruments", "display").value,
      "a rule from a non-applicable media query was applied at 720",
    ).toBe(at720(styles, ".row-instruments", "display").value);
    /* Each mutant is a distinct full stylesheet, so each is parsed fresh — the
       memo is keyed on the sheet text. Two dozen mutants over a 7,000-line
       sheet exceed the 5s default, so this test carries its own budget rather
       than shedding coverage to fit one. */
  }, 60_000);

  /* SUPERSEDED: a regex walk over every rule mentioning the cell used to make
     this claim. It is now made by "each instrument cell has exactly one
     disposition" above, against exact parsed rules. Two readers asserting one
     contract is two places for the contract to drift. */

  test("the row's area map is exactly the intended 2x2, in order", () => {
    /* Dimensions alone are not a layout. A map reading
         "status model" / "identity identity"
       is still 2x2 and puts the instruments ABOVE the name; one reading
         "identity status" / "identity model"
       is still 2x2 and splits the name down the left column. Both satisfy a
       shape check, so the matrix is pinned literally — every name, in every
       cell, in order — and the identity cell's own placement is pinned with it,
       because a matrix naming an area nothing is assigned to describes a layout
       that does not exist. */
    const block = phone();
    /* The EFFECTIVE map for the exact selector. A first-match search over rules
       mentioning both class names reported whichever rule came first, so a
       later rule on the same selector could replace the map entirely and this
       assertion would still read the original. */
    const rowAreas = effectiveProp(block, ROW_GRID, "grid-template-areas");
    expect(rowAreas, `no rule declares grid-template-areas for "${ROW_GRID}"`).toBeTruthy();
    expect(areaMatrix("grid-template-areas: " + rowAreas + ";"),
      "the narrow row's area map is not the intended 2x2")
      .toEqual([["identity", "identity"], ["status", "model"]]);

    /* The HEADER's map is pinned literally too. The two are a matched pair: a
       header laid out "agent agent" / "status model" over rows laid out
       "identity identity" / "status model" IS the contract, and a header that
       drifted to a different map would put its labels over the wrong columns
       while every row-side assertion still passed. */
    const headerAreas = effectiveProp(block, HEADER, "grid-template-areas");
    expect(headerAreas, `no rule declares grid-template-areas for "${HEADER}"`).toBeTruthy();
    expect(areaMatrix("grid-template-areas: " + headerAreas + ";"),
      "the narrow header's area map is not the intended 2x2")
      .toEqual([["agent", "agent"], ["status", "model"]]);

    /* THE PRODUCT ASSERTION ITSELF must reject a later override, not merely a
       helper unit guard. These run the same reads this test just made, against
       a sheet where the correct rule is followed by a bad one. */
    const overridden = block
      + `\n${ROW_GRID} { grid-template-areas: "x y" "z q"; }`
      + `\n${HEADER} { grid-template-areas: "q q" "q q"; }`;
    expect(areaMatrix("grid-template-areas: " + effectiveProp(overridden, ROW_GRID, "grid-template-areas") + ";"),
      "a later row area map did not replace the earlier one")
      .toEqual([["x", "y"], ["z", "q"]]);
    expect(areaMatrix("grid-template-areas: " + effectiveProp(overridden, HEADER, "grid-template-areas") + ";"),
      "a later header area map did not replace the earlier one")
      .toEqual([["q", "q"], ["q", "q"]]);

    /* Identity spans the whole first row, placed by the cell's own at-rest rule. */
    const identity = placement(block, ".row-identity");
    expect(identity.folded, "the narrow row folds away the session's own name").toBe(false);
    expect(identity.area, "the identity cell is not placed in the identity area").toBe("identity");

    /* And every placed instrument lands inside that matrix. */
    const declared = new Set(["identity", "status", "model"]);
    for (const cell of CELLS) {
      const { area, folded } = placement(block, cell);
      if (folded || !area) continue;
      expect(declared.has(area), `${cell} is placed in "${area}", which the row's matrix never declares`).toBe(true);
    }
  });

  test("at-rest discovery ignores pseudo-gated and unrelated rules", () => {
    const found = atRestRules(AT_REST_SAMPLE, [/\.agent-row\b/, /\.agent-grid\b/]);
    expect(found.length, "at-rest discovery matched a hover or unrelated rule").toBe(1);
    expect(areaMatrix(found[0].body)).toEqual([["a", "a"], ["b", "c"]]);
  });

  test("the reader keeps structural pseudo-classes and drops gating ones", () => {
    /* The header's ENTIRE area map is written with :nth-child(N). A reader that
       rejected every colon found none of it and reported all seven children as
       unplaced — a false finding, which is the most dangerous way for a grid
       audit to look like it is working. Structural pseudos say where a node
       sits and are always true; gating ones describe a state a reader at rest
       is not in. */
    expect(isAtRestSelector(".agent-column-header > :nth-child(3)")).toBe(true);
    expect(isAtRestSelector(".agent-column-header > :first-child")).toBe(true);
    /* Real CSS spacing and expression forms, which a bare-integer matcher would
       misread as gating and drop — the same false-reading class as rejecting
       every colon. */
    expect(isAtRestSelector(".agent-column-header > :nth-child(n + 2)")).toBe(true);
    expect(isAtRestSelector(".agent-column-header > :nth-child( 2n+1 )")).toBe(true);
    expect(isAtRestSelector(".agent-column-header > :nth-child(odd)")).toBe(true);
    expect(isAtRestSelector(".agent-row:hover .ri-ctx")).toBe(false);
    expect(isAtRestSelector(".agent-row:focus-within .ri-ctx")).toBe(false);
    expect(isAtRestSelector(".ri-ctx:not(.is-unknown)")).toBe(false);
    expect(isAtRestSelector(".ri-model + .ri-ctx::before")).toBe(false);

    expect(addressesCell(".agent-row .ri-model", ".ri-model")).toBe(true);
    expect(addressesCell(".agent-row:hover .ri-ctx", ".ri-ctx")).toBe(false);
    expect(addressesCell(".ri-ctx .ri-value", ".ri-ctx")).toBe(false);
    expect(addressesCell(".ri-ctx-gauge", ".ri-ctx")).toBe(false);
  });

  test("placement is read from the universal board row, never a selected-only variant", () => {
    /* `.agent-row.is-selected .ri-model` describes ONE row. Reading the board's
       layout from it would report every row as laid out the way the selected one
       is — and the selected row deliberately folds cells its drawer is already
       showing, so that reading is not merely narrow, it is the opposite of the
       truth. */
    expect(isUniversalFor(".agent-row .ri-model", ".agent-row")).toBe(true);
    expect(isUniversalFor(".agent-column-header > :nth-child(3)", ".agent-column-header")).toBe(true);
    expect(isUniversalFor(".agent-row.is-selected .ri-model", ".agent-row")).toBe(false);
    expect(isUniversalFor("body.inspector-open .agent-row.is-selected .ri-model", ".agent-row")).toBe(false);
    expect(isUniversalFor(".program-preview .ri-model", ".agent-row")).toBe(false);
    expect(isUniversalFor(".agent-row:hover .ri-model", ".agent-row")).toBe(false);
  });

  test("the parser keeps functional pseudos intact and keeps combinators", () => {
    /* The previous implementation masked parenthesised groups by substituting an
       index. A selector containing a bare number could collide with a
       placeholder, nested parens were unhandled, and the combinators were
       thrown away entirely — so ".agent-row + .ri-model" parsed identically to
       ".agent-row .ri-model" and a SIBLING rule could certify a contract about
       cells inside a row. */
    expect(splitCompounds(".agent-column-header > :nth-child(n + 2)"))
      .toEqual([".agent-column-header", ":nth-child(n + 2)"]);
    expect(splitCompounds(".a:not(:nth-child(2)) .b")).toEqual([".a:not(:nth-child(2))", ".b"]);
    expect(splitCompounds(".col-2 .ri-model")).toEqual([".col-2", ".ri-model"]);

    expect(parseSelector(".agent-row + .ri-model").map((p) => p.combinator)).toEqual(["", "+"]);
    expect(parseSelector(".agent-row .ri-model").map((p) => p.combinator)).toEqual(["", " "]);
    expect(parseSelector(".agent-column-header > :nth-child(3)").map((p) => p.combinator))
      .toEqual(["", ">"]);
  });

  test("named selector mutants are each rejected by a direct guard", () => {
    const canonical = (sel: string) => isCanonicalFor(sel, ".agent-row", ".ri-model");
    expect(canonical(".agent-row .ri-model"), "the canonical form must be accepted").toBe(true);

    /* Each of these describes something other than "this cell, in every row, at
       rest", and each is named so a failure says which mutant slipped. */
    expect(canonical(".agent-row + .ri-model"), "a SIBLING rule was accepted").toBe(false);
    expect(canonical(".agent-row > .ri-model"), "a CHILD-combinator rule was accepted").toBe(false);
    expect(canonical(".agent-row ~ .ri-model"), "a GENERAL-SIBLING rule was accepted").toBe(false);
    expect(canonical(".agent-row .only-some .ri-model"), "an INTERMEDIATE compound was accepted").toBe(false);
    expect(canonical(".program-preview .ri-model"), "a FOREIGN ancestor was accepted").toBe(false);
    expect(canonical("body.inspector-open .agent-row .ri-model"), "an EXTRA ancestor was accepted").toBe(false);
    expect(canonical(".agent-row.is-selected .ri-model"), "a SELECTED-only rule was accepted").toBe(false);
    expect(canonical(".agent-row:hover .ri-model"), "a HOVER state rule was accepted").toBe(false);
    expect(canonical(".agent-row .ri-model::before"), "a PSEUDO-ELEMENT rule was accepted").toBe(false);
    expect(canonical(".agent-row .ri-model .ri-value"), "a DESCENDANT of the cell was accepted").toBe(false);
    expect(canonical(".agent-row .ri-model-extra"), "a PREFIX-SHARING class was accepted").toBe(false);

    expect(addressesCell(".agent-row .ri-model", ".ri-model")).toBe(true);
    expect(addressesCell(".agent-row .ri-model .ri-value", ".ri-model")).toBe(false);
    expect(addressesCell(".agent-row .ri-model::before", ".ri-model")).toBe(false);
  });

  test("a custom property never satisfies the real property it is named after", () => {
    /* `--display: none` sets a variable and folds nothing. A naive /display:/
       matches it, so a rule declaring only the custom property would read as a
       fold and the audited cell would be excused from needing an area. */
    expect(declaredValues("--display: none;", "display"), "--display satisfied display").toEqual([]);
    expect(declaredValues("--grid-area: model;", "grid-area"), "--grid-area satisfied grid-area").toEqual([]);
    expect(declaredValues("--box-shadow: inset 3px 0 red;", "box-shadow")).toEqual([]);
    expect(declaredValues("--white-space: nowrap;", "white-space")).toEqual([]);
    expect(effectiveValue("display: none; display: block;", "display")).toBe("block");
    expect(effectiveValue("--display: none; display: grid;", "display")).toBe("grid");
  });

  test("a later canonical override is what the audit reports, for every pinned property", () => {
    /* The mutation this rejects: appending a rule that undoes the contract while
       the original stays in the file to satisfy a first-match reader. */
    expect(effectiveDeclaration(
      `.agent-row .agent-grid { grid-template-areas: "identity identity" "status model"; }
       .agent-row .agent-grid { grid-template-areas: "status model" "identity identity"; }`,
      "grid-template-areas", ".agent-row", ".agent-grid",
    ), "a later area map did not win").toBe(`"status model" "identity identity"`);

    expect(effectiveDeclaration(
      `.agent-row .ri-tokens { display: none; }\n.agent-row .ri-tokens { display: block; }`,
      "display", ".agent-row", ".ri-tokens",
    ), "a later display:block did not win").toBe("block");

    expect(effectiveForSelector(
      `.pane-inspector.dw-provider { box-shadow: inset 3px 0 var(--prov, var(--line-strong)); }
       .pane-inspector.dw-provider { box-shadow: none; }`,
      "box-shadow", ".pane-inspector.dw-provider",
    ), "a later box-shadow:none did not win").toBe("none");

    for (const [prop, mutant] of [
      ["white-space", "normal"], ["overflow", "visible"],
      ["text-overflow", "clip"], ["min-width", "auto"],
    ] as const) {
      expect(effectiveForSelector(
        `.agent-name { ${prop}: nowrap; }\n.agent-name { ${prop}: ${mutant}; }`,
        prop, ".agent-name",
      ), `a later ${prop}:${mutant} did not win`).toBe(mutant);
    }

    /* And the 720 block's own row rules are universal ones. */
    const block = phone();
    const rowRules = sharedAtRestRules(block, [/\.agent-row\b/])
      .filter((r) => /grid-area|display:\s*none/.test(r.body));
    expect(rowRules.length, "the 720 block has no row placement rules at all").toBeGreaterThan(0);
    for (const r of rowRules) {
      expect(isUniversalFor(r.sel, ".agent-row"), `"${r.sel}" places only some rows`).toBe(true);
    }
  });

  test("a later rule wins, so an un-folded cell is not reported as folded", () => {
    /* The cascade's own rule, which the audit has to obey or it reports the
       opposite of the truth: a cell folded by one rule and restored by a later
       one is VISIBLE, and calling it folded would excuse it from needing an
       area — turning a real implicit-track defect into a pass. */
    const sample = `
      .agent-row .ri-tokens { display: none; }
      .agent-row .ri-tokens { display: flex; grid-area: model; }
    `;
    const after = placement(sample, ".ri-tokens");
    expect(after.folded, "a later display:flex did not override the earlier fold").toBe(false);
    expect(after.area).toBe("model");

    /* And placement is scoped to board rows: a rule for some other surface
       wearing the same class must not answer for the row. */
    const foreign = placement(`.program-preview .ri-tokens { grid-area: elsewhere; }`, ".ri-tokens");
    expect(foreign.area, "a non-row rule was read as the row's placement").toBeNull();

    /* Read as an effective DECLARATION, and only from canonical rules: a
       selected-only rule may not answer for the whole board. */
    expect(effectiveDeclaration(sample, "display", ".agent-row", ".ri-tokens")).toBe("flex");
    const shadowed = `
      .agent-row .ri-tokens { display: none; }
      .agent-row.is-selected .ri-tokens { display: flex; }
    `;
    expect(
      effectiveDeclaration(shadowed, "display", ".agent-row", ".ri-tokens"),
      "a selected-only rule was allowed to answer for every row",
    ).toBe("none");
  });

  test("the folded fields are folded by their own effective declaration", () => {
    /* Tokens and Span/Quiet are DELIBERATELY dropped at 720. That is a real
       contract, and it has to be read the way everything else is: the last
       canonical declaration, not the first rule that happens to mention them. */
    const block = phone();
    for (const cell of [".ri-tokens", ".ri-elapsed"]) {
      expect(
        effectiveDeclaration(block, "display", ".agent-row", cell),
        `${cell} is no longer folded at 720 by its own canonical rule`,
      ).toBe("none");
    }
  });

  test("placement is read from the cell's own rule, not a descendant or pseudo rule", () => {
    /* A guard on the reader itself. If `addressesCell` ever loosened, every
       assertion in this file would start passing against rules that place
       something else — the failure mode where a green suite certifies a broken
       grid. */
    expect(addressesCell(".agent-row .ri-model", ".ri-model")).toBe(true);
    expect(addressesCell(".agent-row .ri-tokens, .agent-row .ri-elapsed", ".ri-elapsed")).toBe(true);
    expect(addressesCell(".ri-model + .ri-ctx::before", ".ri-ctx"), "a pseudo-element is not the cell").toBe(false);
    expect(addressesCell(".ri-ctx:hover", ".ri-ctx"), "a hover rule is not unconditional placement").toBe(false);
    expect(addressesCell(".agent-row:hover .ri-ctx", ".ri-ctx"), "an ancestor hover gates it just as surely").toBe(false);
    expect(addressesCell(".ri-ctx.is-unknown:not(.x)", ".ri-ctx"), "a pseudo-class on the cell gates it").toBe(false);
    /* A plain class on the cell or an ancestor is NOT conditional in this sense
       — it is how the sheet addresses a variant, and the variant is still laid
       out at rest. */
    expect(addressesCell(".agent-row.is-selected .ri-model", ".ri-model")).toBe(true);
    expect(addressesCell(".ri-ctx .ri-value", ".ri-ctx"), "a descendant rule is not placement").toBe(false);
    expect(addressesCell(".ri-ctx-gauge", ".ri-ctx"), "a prefix-sharing class is a different element").toBe(false);
  });

  test("the column header labels the field its rows actually print", () => {
    /* The header's children are positional: the 720px map addresses them by
       nth-child, so inserting a column silently re-points every rule after it.
       Read the real header, find which child is placed in the right-hand area,
       and check the word it prints. */
    const header = withDom(() => {
      M.state.view = "board";
      return M.renderAgentColumnHeader();
    });
    const labels = (header.children || []).map((c: unknown) => textOf(c).trim());
    const block = phone();

    /* Which nth-child does the stylesheet put in the row's right-hand area?
       Read from the cell's own at-rest rule, never from a hover or an unrelated
       ancestor — otherwise a mutation could satisfy this with a rule that never
       applies. */
    const rightArea = effectiveProp(block, cellSel(".ri-model"), "grid-area") ?? "model";
    /* Ask each header child by its EXACT selector which area it is placed in,
       and take the effective last answer. A first-match search returned the
       first rule whose body mentioned the area name, so a later rule re-pointing
       that child was invisible here. */
    const childArea = (n: number) =>
      effectiveProp(block, `${HEADER} > :nth-child(${n})`, "grid-area");
    const nth = HEADER_CHILDREN.find((n) => childArea(n) === rightArea);
    expect(nth, `no header child is placed in the "${rightArea}" area`).toBeDefined();
    if (nth === undefined) return;

    const printed = labels[nth - 1];
    /* The rows print `.ri-model` in that area, so the header above it must say
       Model. Today it says Harness. */
    expect(printed, `the header prints "${printed}" over the column whose rows print a model`)
      .toBe("Model");
  });

  test("no header column is hidden while its value is still on screen", () => {
    const header = withDom(() => {
      M.state.view = "board";
      return M.renderAgentColumnHeader();
    });
    const labels = (header.children || []).map((c: unknown) => textOf(c).trim());
    const block = phone();
    const folded = new Set<number>(
      HEADER_CHILDREN.filter((n) => effectiveProp(block, `${HEADER} > :nth-child(${n})`, "display") === "none"),
    );
    /* A folded header column is only honest if the matching row cell is folded
       too. Model is the one that broke: its label is hidden while every row still
       prints a model in the right-hand column. */
    for (const nth of folded) {
      const label = labels[nth - 1];
      if (label !== "Model") continue;
      const cellFolded = effectiveProp(block, cellSel(".ri-model"), "display") === "none";
      expect(cellFolded, "the Model header is hidden while rows still print a model").toBe(true);
    }
  });

  test("every header child is placed or folded — none falls into an implicit row", () => {
    const header = withDom(() => {
      M.state.view = "board";
      return M.renderAgentColumnHeader();
    });
    const count = (header.children || []).length;
    const block = phone();
    const handled = new Set<number>(
      HEADER_CHILDREN.filter((n) => {
        const sel = `${HEADER} > :nth-child(${n})`;
        return Boolean(effectiveProp(block, sel, "grid-area"))
          || effectiveProp(block, sel, "display") === "none";
      }),
    );
    /* `.ri-col-stack` carries display:none in the base sheet, so the docked
        two-line label is already accounted for wherever it sits. */
    const stackIndex = (header.children || [])
      .findIndex((c: { className?: string }) => String(c.className || "").includes("ri-col-stack"));
    const missing: number[] = [];
    for (let i = 1; i <= count; i++) {
      if (i - 1 === stackIndex) continue;
      if (!handled.has(i)) missing.push(i);
    }
    expect(missing, `header children ${missing.join(", ")} have no area and no fold at 720px`).toEqual([]);
  });
});

describe("FE-4 long integrated labels do not disturb the narrow layout", () => {
  test("the narrow grid's track definition is fixed, not content-sized", () => {
    /* A track sized by content lets one long Gemini or OpenCode model string
       widen the whole column and shove its neighbour. The 720px grid pins the
       identity track to minmax(0, 1fr), which is what makes a long label clamp
       instead of push. */
    const block = phone();
    const tracks = effectiveProp(block, ".agent-grid", "grid-template-columns");
    expect(tracks, "the 720px grid definition is gone").toBeTruthy();
    expect(tracks, "the narrow grid's tracks changed").toBe("minmax(0, 1fr) minmax(5.2rem, auto)");
    /* And a later track definition on the same selector is what wins. */
    expect(effectiveProp(block + `\n.agent-grid { grid-template-columns: 999px 999px; }`,
      ".agent-grid", "grid-template-columns"),
      "a later track definition did not replace the earlier one").toBe("999px 999px");
  });

  test("the identity cell can shrink, so a long name clamps rather than reflows", () => {
    expect(css).toMatch(/\.row-identity\b[^{]*\{[^}]*min-width:\s*0/);
  });
});

describe("high-contrast and reduced-motion contracts hold for every mark", () => {
  test("forced colors keeps a visible border on every provider mark", () => {
    /* In forced-colors the SVG marks lose their fill, so without this rule a
       Gemini, OpenCode or Pi mark becomes an invisible square. */
    const block = mediaBlocks(css, "(forced-colors: active)").join("\n");
    expect(block, "the forced-colors block is gone").toBeTruthy();
    expect(block).toMatch(/\.dual-marks \.provider-mark\s*\{[^}]*border:[^;]*CanvasText/);
  });

  test("reduced motion is honoured in the stylesheet", () => {
    /* This project's browser harness cannot emulate prefers-reduced-motion, so
       the CSS assertion is the standing proof and the visual check is reported
       as not-run rather than as a pass. */
    const blocks = mediaBlocks(css, "(prefers-reduced-motion: reduce)");
    expect(blocks.length, "no reduced-motion block remains").toBeGreaterThan(0);
    expect(blocks.join("\n")).toMatch(/animation|transition/);
  });
});
