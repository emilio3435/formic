/* rows-0816 Swarm A — the condensed row when the inspector is docked (#158).
 *
 * Gate A1 picked Alt 2: the instrument cluster becomes a two-line grid inside a
 * DEFINITE 12.5rem second track — `Status … Span` over `Model · Ctx · Tokens` —
 * so every fact lands at one x down the whole list and the agent name survives
 * the 380px clamp floor.
 *
 * These tests pin the SHAPE of the fix, not just its presence: the width
 * override must live under `body.inspector-open` (the base `.ri-cell` rule is
 * the closed 7-track grid's ellipsis lock and stays `width: 100%`), the middot
 * must only join two fields that are both present, and the two breakpoint
 * blocks the pick must not disturb are compared byte-for-byte against `main`.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findClass, textOf, withDom } from "./helpers/fake-dom";
import { mediaBlocks, oneMediaBlock, parseRules, rules, stripComments } from "./helpers/css-rules";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let M: any;
const stylesPath = resolve(import.meta.dir, "../src/web/styles.css");
const styles = readFileSync(stylesPath, "utf8");

beforeAll(async () => {
  // @ts-expect-error The dependency-free browser client intentionally has no declaration file.
  await import("../src/web/app.js");
  M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
});

/* The CSS readers moved to tests/helpers/css-rules.ts when the harness
   responsive suite needed the same three functions. Two copies of a parser is
   two answers to "what does this @media block contain", and the first
   divergence would be invisible — both files passing against different
   readings of the same bytes. */

/** styles.css as it stands on the base branch — the tree this pick is a delta
 *  against. CI checks out a shallow PR ref with no `main`, so this resolves
 *  the first ref that exists and returns null when none does; RC-4 then falls
 *  back to its self-contained invariants and says so, rather than throwing on
 *  a missing ref (which is what turned #166's first CI run red). */
function stylesOnBase(): { ref: string; css: string } | null {
  for (const ref of ["main", "origin/main"]) {
    try {
      const shown = Bun.spawnSync(["git", "show", ref + ":src/web/styles.css"], {
        cwd: resolve(import.meta.dir, ".."),
      });
      if (shown.exitCode === 0) return { ref, css: shown.stdout.toString() };
    } catch {
      return null; // no git binary at all — same answer as no ref
    }
  }
  return null;
}

const condensed = () => oneMediaBlock(stripComments(styles), "(min-width: 1025px)");

/* ---------- the one FE-4 licensing predicate ----------

   A licensed 720 state is base's exact state or the approved target's exact
   state, and nothing between. There is deliberately no third answer and no
   second algorithm: RC-4 asks this about the real stylesheet, RC-4b asks the
   SAME function about synthetic mutants, so neither can drift into its own
   idea of what is allowed. */
export type LicensedState = Array<readonly [string, string[]]>;

export function licensedStateVerdict(
  state: LicensedState,
  baseState: LicensedState,
  targetState: LicensedState,
): "base" | "target" | null {
  const key = (s: LicensedState) => JSON.stringify(s);
  if (key(state) === key(baseState)) return "base";
  if (key(state) === key(targetState)) return "target";
  return null;
}

describe("RC — condensed row, inspector docked (#158, Alt 2)", () => {
  test("RC-1 the width override lives under body.inspector-open; the base .ri-cell lock survives", () => {
    const block = condensed();
    const cellRules = rules(block).filter((r) => /\.ri-cell\b/.test(r.sel) && /\binspector-open\b/.test(r.sel));
    expect(cellRules.length).toBeGreaterThan(0);
    /* A 100%-wide flex/grid item cannot share a line with a sibling — that is
       the whole defect. Either an explicit auto width or a `flex: 0 0 auto`
       basis releases it. */
    const released = cellRules.filter((r) => /width:\s*auto/.test(r.body) || /flex:\s*0 0 auto/.test(r.body));
    expect(released.length).toBeGreaterThan(0);

    /* Silent trap 1: the CLOSED 7-track grid still ellipsises long values inside
       their track because the base rule pins width: 100%. Overriding it here
       instead of there would trade one layout bug for another. */
    expect(stripComments(styles)).toMatch(/(^|\n)\.ri-cell\s*\{[^}]*width:\s*100%/);
  });

  test("RC-2 the cluster is a two-line grid in a definite 12.5rem track", () => {
    const block = condensed();
    const cluster = rules(block).find((r) => /\.row-instruments\b/.test(r.sel) && /\binspector-open\b/.test(r.sel));
    expect(cluster).toBeDefined();
    expect(cluster!.body).toMatch(/display:\s*grid/);
    expect(cluster!.body).toContain('"st st el"');
    expect(cluster!.body).toContain('"mo ctx tok"');
    /* Reserved rows: an omitted field leaves a hole, so the cluster is the same
       height whether or not tokens/ctx are known. */
    expect(cluster!.body).toMatch(/grid-template-rows:/);

    /* Every .agent-row is its own grid. An `auto` track is sized by that row's
       own content, so the instrument column lands at a different x on every row
       — measured at 160px of spread. A definite track is what makes it tabular. */
    const track = rules(block).find((r) =>
      /\.agent-grid\b/.test(r.sel) && /\.agent-column-header\b/.test(r.sel) && /grid-template-columns/.test(r.body));
    expect(track).toBeDefined();
    expect(track!.body).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*12\.5rem/);
    expect(block).not.toContain("minmax(4.5rem, auto)");
  });

  test("RC-3 harness folds, and a middot only ever joins two present fields", () => {
    const block = condensed();
    const harness = rules(block).find((r) => /\.ri-harness\b/.test(r.sel) && /\binspector-open\b/.test(r.sel));
    expect(harness).toBeDefined();
    expect(harness!.body).toMatch(/display:\s*none/);

    const middots = rules(block).filter((r) => /content:\s*"·"/.test(r.body));
    expect(middots).toHaveLength(1);
    const sel = middots[0].sel;
    expect(sel).toContain(".ri-model + .ri-ctx::before");
    expect(sel).toContain(".ri-ctx + .ri-tokens::before");
    /* A blanket `* + *::before` would open the SELECTED row's line with a stray
       dot: that row folds the model away, and the tokens/elapsed cells with it. */
    expect(sel).not.toMatch(/\*\s*\+\s*\*/);
    expect(sel).not.toContain(".ri-harness");

    /* Adjacency is a DOM relation, not a layout one: the selected row FOLDS the
       model with display: none and it stays .ri-ctx's previous sibling, so the
       rule above still paints a dot with nothing before it. Measured live at a
       520px board: the selected row read "· —". */
    const cancelled = rules(block).find((r) =>
      /\.is-selected\b/.test(r.sel) && /::before/.test(r.sel) && /content:\s*none/.test(r.body));
    expect(cancelled).toBeDefined();
    expect(cancelled!.sel).toContain(".ri-ctx::before");
  });

  test("RC-4 the ≤1180 and ≤720 blocks — and the selected-row folds — are untouched", () => {
    /* Self-contained invariants first — these run everywhere, shallow CI
       checkout included. The condensed row exists only at ≥1025px with the
       inspector docked; the tablet 7-track grid and the ≤720 area map are a
       different layout answering a different question, so none of Alt 2's
       vocabulary may appear in them. */
    const tablet = mediaBlocks(stripComments(styles), "(max-width: 1180px)").join("\n");
    const phone = mediaBlocks(stripComments(styles), "(max-width: 720px)").join("\n");
    for (const block of [tablet, phone]) {
      expect(block).not.toContain("12.5rem");
      expect(block).not.toContain("ri-col-stack");
      expect(block).not.toContain('"st st el"');
      expect(block).not.toContain(".ri-ctx.is-unknown");
    }
    /* The tablet grid keeps one explicit track per visible cell (regression-4
       pins the count; this pins that Alt 2 did not restate the rule here). */
    expect(tablet.match(/\.agent-grid[^{]*\{[^}]*grid-template-columns:[^;]*/)?.[0].match(/minmax\(/g)?.length).toBe(7);
    /* The ≤720 area map and its tokens/elapsed folds are the phone answer. */
    expect(phone).toContain('"identity identity"');
    expect(phone).toMatch(/\.ri-tokens[^{]*\{[^}]*display:\s*none/);

    /* The selected row alone stays quiet — its drawer carries those facts inches
       away. Alt 2 changes what UNSELECTED rows show; the folds are orthogonal. */
    const foldOf = (css: string) => {
      const anchor = "body.inspector-open .agent-row.is-selected .ri-model,";
      const start = css.indexOf(anchor);
      if (start === -1) throw new Error("selected-row fold rule not found");
      return css.slice(start, css.indexOf("}", start) + 1);
    };
    expect(foldOf(styles)).toContain(".ri-tokens,");
    expect(foldOf(styles)).toContain(".ri-elapsed,");
    expect(foldOf(styles)).toContain(".row-description,");
    expect(foldOf(styles)).toMatch(/display:\s*none;\s*\}$/);

    /* Byte-for-byte against the base branch when a ref is reachable. On a
       shallow CI checkout there is none; the invariants above still ran, and
       the skip is printed rather than swallowed. */
    const base = stylesOnBase();
    if (!base) {
      console.warn("[RC-4] no main/origin/main ref in this checkout — byte-compare against base skipped; invariants ran");
      return;
    }
    expect(mediaBlocks(styles, "(max-width: 1180px)")).toEqual(mediaBlocks(base.css, "(max-width: 1180px)"));
    /* Team-parity added a NEW 720 block for 44px hit targets on the team
       swatch, grouping checkbox, and ungroup. That extra block is allowed only
       if it names those three selectors and nothing from Alt 2. */
    const phoneNow = mediaBlocks(styles, "(max-width: 720px)");
    const phoneBase = mediaBlocks(base.css, "(max-width: 720px)");

    /* THE ROW/HEADER LAYOUT BLOCK IS EXEMPT FROM THE BYTE PIN, AND ONLY IT.

       This pin was written when the 720 area map was correct, and it is not:
       the map was authored for a five-child column header, a sixth column was
       inserted later, and nothing was renumbered — so the header labels one
       column while the rows print another, and four cells fall into implicit
       tracks. Fixing that necessarily edits this block, which means a byte pin
       over it does not protect a correct layout; it forbids one.

       So the exemption is drawn as narrowly as it can be: within that ONE
       block, only rules addressing the row/header grid and its instrument cells
       may move. Every other rule in it — the masthead, the rail, the pane list,
       the summary clamps, the touch targets — is still compared rule for rule,
       and every other 720 block is still compared byte for byte. */
    const isLayoutBlock = (block: string) =>
      /\.agent-column-header/.test(block) && /grid-template-areas/.test(block);

    /* The licence is drawn as an EXACT selector allowlist plus an exact property
       allowlist, not a family of patterns.

       A pattern like /\.agent-grid\b/ licenses any change to any rule mentioning
       the grid — a new gap, a new padding, a font change — none of which FE-4
       needs and any of which would then ship unreviewed under this exemption.
       FE-4 needs to re-point areas and folds, and nothing else, so those are the
       only declarations that may move. */
    const FE4_SELECTORS = new Set([
      ".agent-column-header, .agent-grid",
      ".agent-column-header",
      ".agent-column-header > :nth-child(1)",
      ".agent-column-header > :nth-child(2)",
      ".agent-column-header > :nth-child(3)",
      ".agent-column-header > :nth-child(4)",
      ".agent-column-header > :nth-child(5)",
      ".agent-column-header > :nth-child(6)",
      ".agent-column-header > :nth-child(7)",
      ".agent-column-header > :nth-child(4), .agent-column-header > :nth-child(5)",
      ".agent-row .agent-grid",
      ".agent-row .row-identity",
      ".agent-row .row-state",
      ".agent-row .ri-harness",
      ".agent-row .ri-model",
      ".agent-row .ri-ctx",
      ".agent-row .ri-tokens",
      ".agent-row .ri-elapsed",
      ".agent-row .ri-tokens, .agent-row .ri-elapsed",
    ]);
    /* PER-SELECTOR permitted values. A shared value table let any licensed
       selector take any licensed area, so `.ri-model { grid-area: identity }`
       — which parks the model on top of the session name — read as legal.
       Each selector now carries only the values IT may take. */
    const ROW_MAP = `"identity identity" "status model"`;
    const HEADER_MAP = `"agent agent" "status model"`;
    const TRACKS = "minmax(0, 1fr) minmax(5.2rem, auto)";
    /* The per-selector property allowlist that used to live here went with the
       second algorithm it fed. Whole-state equality needs no allowlist: a state
       is base's or the target's, and a value nobody approved cannot appear in
       either. */

    /* EXACT ORDERED BLOCK COMPARISON.

       Same number of 720 blocks, in the same order, and every one byte-identical
       to base EXCEPT the single canonical row/header block. No new extra block
       is admissible: the team hit-target block already exists in base, so it is
       byte-identical automatically and needs no classification of its own. The
       old `extra[0]`/`startsWith`/content heuristics are gone. */
    expect(phoneNow.length, "the number of 720 blocks changed").toBe(phoneBase.length);
    const changed: number[] = [];
    for (let i = 0; i < phoneNow.length; i++) {
      if (phoneNow[i] === phoneBase[i]) continue;
      expect(isLayoutBlock(phoneNow[i]) && isLayoutBlock(phoneBase[i]),
        `720 block ${i} changed and is not the canonical row/header block`).toBe(true);
      changed.push(i);
    }
    expect(changed.length, "more than one 720 block changed").toBeLessThanOrEqual(1);

    /* Comments stripped before any SELECTOR comparison: a rule commented out in
       one tree and live in the other must not compare equal, and a selector
       written inside a comment must not be read as a rule at all. The block
       comparison above deliberately still runs on raw bytes. */
    const nowLayout = phoneNow.filter(isLayoutBlock).map(stripComments);
    const baseLayout = phoneBase.filter(isLayoutBlock).map(stripComments);
    expect(nowLayout.length, "the 720 row/header layout block vanished or was split").toBe(baseLayout.length);
    expect(nowLayout.length, "there must be exactly one canonical 720 block").toBe(1);

    /* ORDERED, never Map-collapsed. Keying rules by selector loses duplicates:
       two rules with the same selector and different bodies collapse to
       whichever came last, so an appended rule that undoes the first would be
       the only one compared and the original would vanish from the audit. Every
       OCCURRENCE is listed, in source order. */
    /* ONE EXPLICIT DELTA, compared occurrence for occurrence.

       The previous shape was a set of subset heuristics stacked on each other:
       "unrelated rules match", "licensed rules keep their other declarations",
       "selectors are known", "values look right". Each was individually true
       and collectively leaky — a change could satisfy every one of them and
       still be a rule nobody reviewed.

       This states the delta positively instead. An occurrence is either
       IDENTICAL to base, or it is explained by the licence: its complete
       selector list must be a licensed list, every licensed property must carry
       a licensed value, and every UNLICENSED declaration must survive exactly as
       base wrote it. Nothing else is admissible in either direction. */
    const listOf = (r: { selectors: string[] }) => r.selectors.join(",");
    const nowRules = parseRules(nowLayout[0]);
    const baseRules = parseRules(baseLayout[0]);

    /* THE LICENSED PORTION IS COMPARED AS A WHOLE STATE.

       Per-rule licensing kept running into the same wall: the header's Model
       and Ctx columns share one rule (`:nth-child(4),(5)`) and the fix has to
       show one and hide the other, so it MUST split that list. Any rule-by-rule
       licence either forbids the split or has to permit selector drift in
       general, and permitting it in general is how an unreviewed rule gets in.

       So the licensed rules are compared as one ordered state: they are either
       exactly base's, or exactly the approved target's. There is nothing in
       between to smuggle anything through — a reorder, a dropped declaration, a
       duplicated rule, an empty insertion or a wrong area all produce a state
       that equals neither.

       This encodes ONE approved fix shape. A different but equally correct
       shape must be re-approved here rather than slipped past. */
    const isLicensed = (list: string) =>
      /(\.agent-column-header|\.agent-grid|\.agent-row (\.ri-|\.row-identity|\.row-state|\.agent-grid))/.test(list);

    const stateOf = (rs: typeof nowRules) =>
      rs.filter((r) => isLicensed(listOf(r)))
        .map((r) => [listOf(r), r.declarations.map(([p, v]) => p + ":" + v)] as const);

    /* Base's licensed state, read from base rather than restated, so this table
       cannot drift from the tree it is meant to protect. */
    const BASE_STATE = stateOf(baseRules);

    /* The approved FE-4 target: Harness folded, Model placed where Harness was,
       Ctx/Tokens/Quiet folded, and the two row cells that had no rule at all
       given one. Every declaration is complete and nonempty. */
    const HDR = ".agent-column-header > :nth-child";
    const TARGET_STATE: Array<readonly [string, string[]]> = [
      [".agent-column-header,.agent-grid",
        ["grid-template-columns:minmax(0, 1fr) minmax(5.2rem, auto)", "gap:0.25rem 0.5rem", "align-items:center"]],
      [".agent-column-header",
        ['grid-template-areas:"agent agent" "status model"', "padding:0.4rem 0.45rem"]],
      [`${HDR}(1)`, ["grid-area:agent", "justify-self:start", "text-align:left"]],
      [`${HDR}(2)`, ["grid-area:status", "justify-self:start", "text-align:left"]],
      [`${HDR}(3)`, ["display:none"]],
      [`${HDR}(4)`, ["grid-area:model", "justify-self:end", "text-align:right"]],
      [`${HDR}(5),${HDR}(6),${HDR}(7)`, ["display:none"]],
      [".agent-row .agent-grid", ['grid-template-areas:"identity identity" "status model"']],
      [".agent-row .row-identity", ["grid-area:identity"]],
      [".agent-row .row-state", ["grid-area:status", "justify-self:start", "padding-top:0"]],
      [".agent-row .ri-model", ["grid-area:model", "justify-self:end"]],
      [".agent-row .ri-harness,.agent-row .ri-ctx,.agent-row .ri-tokens,.agent-row .ri-elapsed",
        ["display:none"]],
    ];

    expect(licensedStateVerdict(stateOf(nowRules), BASE_STATE, TARGET_STATE),
      "the licensed 720 rules are neither base's exact state nor the approved FE-4 target state")
      .not.toBeNull();

    /* Every UNLICENSED rule is byte-semantically identical to base, in order. */
    const unlicensedState = (rs: typeof nowRules) =>
      rs.filter((r) => !isLicensed(listOf(r)))
        .map((r) => listOf(r) + "{" + r.declarations.map(([p, v]) => p + ":" + v).join(";") + "}");
    expect(unlicensedState(nowRules), "an unlicensed rule in the canonical 720 block changed")
      .toEqual(unlicensedState(baseRules));

    /* SUPERSEDED AND DELETED: the ordered-survivor / licensed-insertion /
       per-occurrence-allowlist pass that used to run here. It was a SECOND
       licensing algorithm sitting behind the whole-state check above, reaching
       its own verdict by its own rules — so a change had two chances to be
       explained and the two could disagree without either being wrong on its
       own terms. One predicate decides now, and RC-4b drives that same
       function rather than a copy of it. */
    expect(foldOf(styles)).toBe(foldOf(base.css));
  });

  test("RC-4b the FE-4 licence rejects each named mutant", () => {
    /* At HEAD the licensed state equals base, so RC-4's comparison passes
       without exercising a single rejection — the guards are latent until a
       delta exists. This drives the SAME predicate against synthetic states so
       each named mutant is rejected now, rather than being discovered when
       someone writes the fix.

       The predicate is whole-state equality: licensed rules are exactly base's
       or exactly the target's, and nothing else. Every mutant below produces a
       third state. */
    const BASE_STATE: LicensedState = [
      [".agent-column-header > :nth-child(3)", ["grid-area:model", "justify-self:end"]],
      [".agent-row .ri-model", ["grid-area:model", "justify-self:end"]],
      [".agent-row .ri-tokens,.agent-row .ri-elapsed", ["display:none"]],
    ];
    const TARGET_STATE: LicensedState = [
      [".agent-column-header > :nth-child(3)", ["display:none"]],
      [".agent-row .ri-model", ["grid-area:model", "justify-self:end"]],
      [".agent-row .ri-harness,.agent-row .ri-ctx", ["display:none"]],
      [".agent-row .ri-tokens,.agent-row .ri-elapsed", ["display:none"]],
    ];
    /* THE SAME FUNCTION RC-4 calls, not a copy of its rule. A local
       reimplementation here would let the mutant suite certify a predicate the
       real audit does not use — the two could drift and both stay green. */
    const ok = (s: LicensedState) =>
      licensedStateVerdict(s, BASE_STATE, TARGET_STATE) !== null;

    /* Both approved states pass. */
    expect(ok(BASE_STATE), "base's own state was rejected").toBe(true);
    expect(ok(TARGET_STATE), "the intended FE-4 target was rejected").toBe(true);

    const clone = () => TARGET_STATE.map(([s, d]) => [s, [...d]] as readonly [string, string[]]);
    const named: Array<[string, LicensedState]> = [
      ["reorder", [clone()[1], clone()[0], clone()[2], clone()[3]]],
      ["whole-rule deletion", clone().slice(0, 3)],
      ["licensed declaration deletion",
        clone().map((e) => (e[0] === ".agent-row .ri-model" ? [e[0], ["justify-self:end"]] as const : e))],
      ["duplicate declaration",
        clone().map((e) => (e[0] === ".agent-row .ri-model"
          ? [e[0], ["grid-area:model", "grid-area:model", "justify-self:end"]] as const : e))],
      ["wrong selector-specific area",
        clone().map((e) => (e[0] === ".agent-row .ri-model"
          ? [e[0], ["grid-area:identity", "justify-self:end"]] as const : e))],
      ["selector-list drift",
        clone().map((e) => (e[0] === ".agent-row .ri-harness,.agent-row .ri-ctx"
          ? [".agent-row .ri-harness,.pane-list", e[1]] as const : e))],
      ["empty licensed insertion", [...clone(), [".agent-row .ri-elapsed", []] as const]],
      ["duplicate licensed occurrence", [...clone(), clone()[1]]],
    ];
    for (const [name, state] of named) {
      expect(ok(state), `the licence accepted the "${name}" mutant`).toBe(false);
    }
  });


  test("RC-5 the condensed value face stays 11px / 500", () => {
    /* The exact selector tests/formic-typography-weights.test.ts pins — the
       condensed value face, not the model cell's max-width companion. */
    const value = rules(condensed()).find((r) => r.sel === "body.inspector-open .agent-grid .ri-value");
    expect(value).toBeDefined();
    expect(value!.body).toMatch(/font-size:\s*11px/);
    expect(value!.body).toMatch(/font-weight:\s*500/);
  });

  test("RC-7 an unknown context leaves a hole in the stack, not a dash", () => {
    /* renderAgentRow always emits .ri-ctx, printing an em-dash when the model's
       context window is unknown. In the closed seven-column grid that dash sits
       in its own column and reads as a placeholder; folded into the docked
       two-line stack it reads as "grok 4.6 · —", which is a fact the row does
       not have. Honest omission (#158, spec §3): an unknown field is a hole. The
       middot rules already key off adjacency, so hiding the cell also drops the
       stray separator. */
    const block = condensed();
    const hole = rules(block).find((r) =>
      /\.ri-ctx\.is-unknown\b/.test(r.sel) && /\binspector-open\b/.test(r.sel));
    expect(hole).toBeDefined();
    expect(hole!.body).toMatch(/display:\s*none/);
    /* Never at the base rule: the closed board keeps its placeholder column. */
    expect(stripComments(styles)).not.toMatch(/(^|\n)\.ri-ctx\.is-unknown\s*\{[^}]*display:\s*none/);
  });

  test("RC-6 the header prints the same two lines it labels, and stays a 7-column table", () => {
    expect(typeof M.renderAgentColumnHeader).toBe("function");
    const previousView = M.state.view;
    try {
      M.state.view = "board";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const header: any = withDom(() => M.renderAgentColumnHeader());
      expect(header.attributes["aria-colcount"]).toBe("7");

      const stack = findClass(header, "ri-col-stack");
      expect(stack).not.toBeNull();
      const text = textOf(stack);
      expect(text).toContain("Status");
      expect(text).toContain("Model · Ctx · Tokens");
      /* Board says Quiet (staleness), History says Span (first-to-last). The
         header label must be the SAME word the seventh column already chose —
         a label that disagrees with its own column is worse than no label. */
      expect(text).toContain("Quiet");
      /* Two children, one per line: `el()` never takes innerHTML, so the break
         is structural, not a <br> string. */
      expect(stack.children.length).toBe(2);
      /* Closed board: the seven real labels ARE the header, so the substitute
         must not print an eighth column at any width. It is hidden in CSS, not
         with a `hidden` attribute — this file's [hidden] rule is !important on
         purpose (styles.css:104), so a hidden element can never be revealed. */
      expect(stack.attributes.hidden).toBeUndefined();
      expect(stripComments(styles)).toMatch(/(^|\n)\.ri-col-stack\s*\{[^}]*display:\s*none/);

      M.state.view = "history";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const historyHeader: any = withDom(() => M.renderAgentColumnHeader());
      expect(textOf(findClass(historyHeader, "ri-col-stack"))).toContain("Span");
    } finally {
      M.state.view = previousView;
    }
  });

  test("RC-6b the docked header shows the stack and hides the per-column labels", () => {
    const block = condensed();
    const shown = rules(block).find((r) => /\.ri-col-stack\b/.test(r.sel) && /display:\s*grid/.test(r.body));
    expect(shown).toBeDefined();
    expect(shown!.sel).toContain("inspector-open");
    /* Status is inside the stack's first line, so the standalone Status label
       would print it twice. Everything but the stack folds. */
    const hidden = rules(block).find((r) =>
      /\.agent-column-header\b/.test(r.sel) && /:not\(\.ri-col-stack\)/.test(r.sel) && /display:\s*none/.test(r.body));
    expect(hidden).toBeDefined();
    expect(hidden!.sel).toMatch(/nth-child\(n \+ 2\)/);
  });
});
