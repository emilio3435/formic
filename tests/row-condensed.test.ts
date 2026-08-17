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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let M: any;
const stylesPath = resolve(import.meta.dir, "../src/web/styles.css");
const styles = readFileSync(stylesPath, "utf8");

beforeAll(async () => {
  // @ts-expect-error The dependency-free browser client intentionally has no declaration file.
  await import("../src/web/app.js");
  M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
});

/* ---------- CSS reading helpers ---------- */

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every body of `@media <query> {` in source order, braces balanced. */
function mediaBlocks(css: string, query: string): string[] {
  const header = "@media " + query + " {";
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const start = css.indexOf(header, from);
    if (start === -1) return out;
    const open = start + header.length - 1;
    let depth = 0;
    let end = -1;
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) throw new Error("unterminated @media " + query);
    out.push(css.slice(open + 1, end));
    from = end;
  }
}

function oneMediaBlock(css: string, query: string): string {
  const found = mediaBlocks(css, query);
  if (!found.length) throw new Error("no @media " + query + " block");
  return found[0];
}

interface Rule { sel: string; body: string }

/** Flat `selector { declarations }` pairs. The blocks read here do not nest. */
function rules(block: string): Rule[] {
  const out: Rule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(block))) {
    out.push({ sel: match[1].trim().replace(/\s+/g, " "), body: match[2].trim() });
  }
  return out;
}

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
    expect(mediaBlocks(styles, "(max-width: 720px)")).toEqual(mediaBlocks(base.css, "(max-width: 720px)"));
    expect(foldOf(styles)).toBe(foldOf(base.css));
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
