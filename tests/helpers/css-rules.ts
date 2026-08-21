/* One CSS reader for every test that has to ask what a stylesheet actually says.
 *
 * `mediaBlocks` / `rules` / `stripComments` were written inside
 * tests/row-condensed.test.ts and were about to be forked a second time by the
 * harness responsive-parity suite. Two copies of a parser is two answers to
 * "what does this @media block contain", and the first divergence would be
 * invisible: both files would pass, against different readings of the same
 * bytes. They live here instead, and row-condensed.test.ts imports them.
 *
 * These readers are deliberately dumb. The blocks they are pointed at do not
 * nest, so a flat `selector { declarations }` scan is the whole contract; a
 * real CSS parser would invite tests that assert on a cascade this project does
 * not compute anywhere else.
 */

/** Declarations only — a selector inside a comment is not a rule. */
export const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every body of `@media <query> {` in source order, braces balanced.
 *
 *  Returns every match rather than the first: a stylesheet may state the same
 *  breakpoint more than once, and a reader that stopped at the first block
 *  would report a rule as absent while it sits in the second. */
export function mediaBlocks(css: string, query: string): string[] {
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

/** The single body of `@media <query>`, or a throw naming the missing query. */
export function oneMediaBlock(css: string, query: string): string {
  const found = mediaBlocks(css, query);
  if (!found.length) throw new Error("no @media " + query + " block");
  return found[0];
}

export interface Rule { sel: string; body: string }

/** Flat `selector { declarations }` pairs. The blocks read here do not nest. */
export function rules(block: string): Rule[] {
  const out: Rule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(block))) {
    out.push({ sel: match[1].trim().replace(/\s+/g, " "), body: match[2].trim() });
  }
  return out;
}

/** Every rule in `block` whose selector mentions `selector` as a whole token.
 *
 *  Substring matching is what makes a grid audit lie: `.ri-ctx` matches
 *  `.ri-ctx-gauge`, so a rule that folds a different element reads as proof the
 *  audited one was handled. The boundary check is the whole point of routing
 *  this through a helper rather than an inline `.includes()`. */
export function rulesFor(block: string, selector: string): Rule[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped + "(?![\\w-])");
  return rules(block).filter((r) => re.test(r.sel));
}

/* ---------- at-rest selectors ----------

   A grid audit asks one question: is this element placed for a reader who is
   just LOOKING at the page? Two kinds of colon answer it differently.

   STRUCTURAL pseudo-classes — :nth-child, :nth-of-type, :first-child and their
   kin — describe where an element sits in the document. They are always true or
   always false for a given node; nothing about a pointer, a keyboard or a state
   changes them. The column header's whole area map is written with
   `:nth-child(N)`, so a reader that rejected every colon would declare the
   header's real rules invisible and pass by finding nothing.

   INTERACTIVE and functional pseudo-classes — :hover, :focus, :active,
   :not(), :is(), :has() — and every pseudo-ELEMENT (`::before`) do not describe
   the at-rest page. A layout correct only on hover is the defect, not the fix.

   So the rule is an allowlist, not a colon count. */
const STRUCTURAL_PSEUDO = /^:(nth-child|nth-last-child|nth-of-type|nth-last-of-type|first-child|last-child|only-child|first-of-type|last-of-type|only-of-type|root)(\(\s*[^)]*\s*\))?$/;

/** Split a selector into compounds WITHOUT breaking inside a functional pseudo.
 *
 *  ":nth-child(n + 2)" contains a "+" and two spaces, and both are combinator
 *  characters at the top level. A naive split turns that one compound into
 *  ":nth-child(n" and "2)", so the audited element becomes the last fragment
 *  and a rule placing the header's third column reads as a rule about "2)".
 *  Parenthesised groups are masked before splitting and restored after. */
export type Combinator = "" | " " | ">" | "+" | "~";

export interface SelectorPart {
  /** How this compound relates to the one before it. "" for the first. */
  combinator: Combinator;
  compound: string;
}

/** Parse a selector into compounds, depth-aware, KEEPING the combinators.
 *
 *  The previous implementation masked parenthesised groups by substituting an
 *  index and restoring it afterwards. That was fragile in both directions: a
 *  selector containing a bare number could collide with a placeholder, and
 *  nested parens were not handled at all. Worse, it discarded the combinators,
 *  so ".agent-row + .ri-model" and ".agent-row .ri-model" parsed identically —
 *  a sibling rule would have certified a descendant contract.
 *
 *  This walks the string once, tracking paren depth, and splits only on
 *  combinators at depth 0. ":nth-child(n + 2)" survives intact because its "+"
 *  and spaces are inside parens. */
export function parseSelector(selector: string): SelectorPart[] {
  const parts: SelectorPart[] = [];
  let depth = 0;
  let compound = "";
  let pending: Combinator = "";
  let sawSpace = false;

  const flush = () => {
    if (!compound) return;
    parts.push({ combinator: parts.length === 0 ? "" : pending, compound });
    compound = "";
    pending = "";
    sawSpace = false;
  };

  for (const ch of selector.trim()) {
    if (ch === "(") { depth++; compound += ch; continue; }
    if (ch === ")") { depth--; compound += ch; continue; }
    if (depth > 0) { compound += ch; continue; }
    if (ch === " " || ch === "\t" || ch === "\n") {
      if (compound) { flush(); sawSpace = true; pending = " "; }
      else if (parts.length) { sawSpace = true; if (!pending) pending = " "; }
      continue;
    }
    if (ch === ">" || ch === "+" || ch === "~") {
      if (compound) flush();
      pending = ch;
      sawSpace = false;
      continue;
    }
    if (sawSpace && !compound && parts.length && !pending) pending = " ";
    compound += ch;
  }
  flush();
  return parts;
}

/** Compounds only, for callers that do not care how they are joined. */
export function splitCompounds(selector: string): string[] {
  return parseSelector(selector).map((p) => p.compound);
}

/** Every value declared for one property in a rule body, in source order.
 *
 *  Property-boundary safe. A naive /display:/ also matches the CUSTOM property
 *  `--display`, which sets a variable and paints nothing — so a rule declaring
 *  only `--display: none` would read as a fold. The boundary check is why this
 *  is a function rather than an inline regex at each call site. */
export function declaredValues(body: string, property: string): string[] {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("(?:^|[;{]|\\s)" + escaped + "\\s*:\\s*([^;]+)", "g");
  return [...body.matchAll(re)]
    .filter((m) => {
      /* Reject a match whose property name is really the tail of a longer one:
         "--display", "-webkit-display", "grid-display". */
      const at = m.index ?? 0;
      const before = body.slice(Math.max(0, at - 1), at + (m[0].length - m[1].length));
      return !/[-\w]\s*$/.test(before.slice(0, before.indexOf(property)));
    })
    .map((m) => m[1].trim());
}

/** The EFFECTIVE (last) value of one property in a rule body, or null. */
export function effectiveValue(body: string, property: string): string | null {
  const all = declaredValues(body, property);
  return all.length ? all[all.length - 1] : null;
}

/** Whitespace inside a functional pseudo collapsed but never removed, so
 *  "(n+2)" and "(n + 2)" are not treated as different rules. */
export function normalizeCompound(compound: string): string {
  return compound.replace(/\(\s*([^)]*?)\s*\)/g, (_m, inner) =>
    "(" + String(inner).replace(/\s+/g, " ") + ")");
}

/** Is every pseudo in this selector a structural one?
 *
 *  The argument matcher has to survive real CSS spacing: `:nth-child(n + 2)`,
 *  `:nth-child( 2n+1 )` and `:nth-child(odd)` are all structural, and a matcher
 *  that only accepted a bare integer would classify them as gating and drop the
 *  rules silently — the same class of false reading as rejecting every colon. */
export function isAtRestSelector(selector: string): boolean {
  if (selector.includes("::")) return false;
  /* Keep each pseudo with its full argument list, spaces and all, so
     `:nth-child(n + 2)` is judged whole rather than truncated at the space. */
  const pseudos = selector.match(/:[a-z-]+(\([^)]*\))?/g) || [];
  return pseudos.every((p) => STRUCTURAL_PSEUDO.test(p));
}

/** Does this selector address `target` for EVERY instance of it, rather than
 *  for one state of it?
 *
 *  `.agent-row .ri-model` is universal. `.agent-row.is-selected .ri-model` is
 *  not: it describes the one selected row, and reading placement from it would
 *  report the whole board as laid out the way a single row is. Structural
 *  pseudos are still fine — `:nth-child(3)` picks a column, which is exactly
 *  how the header's map is written. */
export function isCanonicalFor(selector: string, ancestor: string, target?: string): boolean {
  /* An allowlist, not a pattern match. After normalization the selector must be
     exactly "<ancestor>" or "<ancestor> <target>". So ".agent-row.is-selected
     .ri-model" (one row), ".program-preview .ri-model" (a foreign ancestor),
     "body.x .agent-row .ri-model" (an extra ancestor) and ".agent-row:hover
     .ri-model" (a state) are all rejected. None of them may certify the board's
     at-rest layout, because none of them describes every row at rest. */
  return selector.split(",").some((part) => {
    const one = part.trim();
    if (!one || !isAtRestSelector(one)) return false;
    const parts = parseSelector(one).map((p) => ({ ...p, compound: normalizeCompound(p.compound) }));
    if (parts.length === 0 || parts[0].compound !== ancestor) return false;
    if (!target) return parts.length === 1;
    /* Exactly two compounds, joined by a DESCENDANT combinator. A sibling
       (".agent-row + .ri-model") describes a cell next to a row, not a cell
       inside one; an intermediate compound (".agent-row .only-some .ri-model")
       describes some cells, not every cell. Neither may certify the contract. */
    return parts.length === 2 && parts[1].compound === target && parts[1].combinator === " ";
  });
}

/** Weaker form: the ancestor is the FIRST compound, matched exactly. */
export function isUniversalFor(selector: string, ancestor: string): boolean {
  return selector.split(",").some((part) => {
    const one = part.trim();
    if (!one || !isAtRestSelector(one)) return false;
    const parts = parseSelector(one);
    return parts.length > 0 && normalizeCompound(parts[0].compound) === ancestor;
  });
}

/** Rules addressing the thing at rest, narrowed by every needle.
 *
 *  `rules(block).find(...)` on two class names is too loose to audit a grid
 *  with: `.agent-row:hover .agent-grid` or a rule scoped to an unrelated
 *  ancestor both satisfy it while describing a layout nobody has. */
export function atRestRules(block: string, needles: RegExp[]): Rule[] {
  return rules(block).filter((r) =>
    isAtRestSelector(r.sel) && needles.every((needle) => needle.test(r.sel)));
}

/** Does this selector address the audited element ITSELF, at rest?
 *
 *  Three ways a looser match reports an unplaced cell as handled:
 *    `.ri-ctx-gauge`              a different element sharing a prefix
 *    `.ri-model + .ri-ctx::before` a pseudo-element, which cannot carry the
 *                                 cell's own grid placement
 *    `.ri-ctx .ri-value`          a DESCENDANT; placing a child says nothing
 *                                 about where the cell lands
 *  plus the interactive gating `isAtRestSelector` rejects. */
export function addressesElement(selector: string, target: string): boolean {
  const token = new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w-])");
  return selector.split(",").some((part) => {
    const one = part.trim();
    if (!one || !isAtRestSelector(one)) return false;
    const compounds = splitCompounds(one);
    const last = compounds[compounds.length - 1];
    return Boolean(last && token.test(last));
  });
}

/** `grid-template-areas` as a matrix of rows of area names. */
export function areaMatrix(body: string): string[][] {
  const decl = body.match(/grid-template-areas:\s*([^;]+);?/);
  if (!decl) return [];
  return [...decl[1].matchAll(/"([^"]*)"/g)].map((m) => m[1].trim().split(/\s+/).filter(Boolean));
}

/** How an element is disposed of inside a block: a named area, an explicit
 *  fold, or neither — which means an implicit track.
 *
 *  Declarations are read in source order and LATER ONES WIN, because that is
 *  what the cascade does at equal specificity. A reader that latched `folded`
 *  on the first `display:none` would report a cell as folded even after a later
 *  rule brought it back, which is the reverse of the defect being audited. */
export function placementIn(
  block: string,
  selector: string,
  scope?: RegExp,
): { area: string | null; folded: boolean } {
  let area: string | null = null;
  let folded = false;
  for (const rule of rules(block)) {
    if (!addressesElement(rule.sel, selector)) continue;
    if (scope && !scope.test(rule.sel)) continue;
    /* Property-boundary safe and last-wins: `--grid-area` sets a variable and
       places nothing, and an earlier rule may not certify what a later one
       overrides. */
    const named = effectiveValue(rule.body, "grid-area");
    if (named) area = named.split(/\s+/)[0];
    const display = effectiveValue(rule.body, "display");
    if (display) folded = display === "none";
  }
  return { area, folded };
}

/** The EFFECTIVE last declaration of one property, read only from rules that
 *  address the element canonically.
 *
 *  An earlier rule cannot certify a property a later rule overrides, so the
 *  answer is the last one in source order. This is not a cascade: no
 *  specificity, no origin, no importance. The canonical filter is what keeps
 *  that honest, because every rule considered has the same selector shape, so
 *  source order is the only thing left to decide between them. */
export function effectiveDeclaration(
  block: string,
  property: string,
  ancestor: string,
  target?: string,
): string | null {
  let value: string | null = null;
  for (const rule of rules(block)) {
    if (!isCanonicalFor(rule.sel, ancestor, target)) continue;
    const hit = effectiveValue(rule.body, property);
    if (hit !== null) value = hit;
  }
  return value;
}

/** The effective value of a property for one EXACT normalized selector.
 *
 *  Used where the contract names a single root selector rather than an
 *  ancestor/target pair — the drawer's channel rail, the long-label clamps.
 *  Equality on the normalized selector, never a substring, so a scoped or
 *  variant rule cannot answer for the base element. */
export function effectiveForSelector(
  block: string,
  property: string,
  selector: string,
): string | null {
  let value: string | null = null;
  for (const rule of rules(block)) {
    const matches = rule.sel.split(",").some((part) => normalizeCompound(part.trim()) === selector);
    if (!matches) continue;
    const hit = effectiveValue(rule.body, property);
    if (hit !== null) value = hit;
  }
  return value;
}

/* ---------- live cascade at one viewport ----------

   Narrow on purpose. This resolves ONE property for ONE audited selector at a
   given width, over the WHOLE stylesheet, so a test never has to hand-assemble
   the input it then audits — extracting media bodies and concatenating them was
   how a previous reader ended up comparing a block against itself.

   It is not a CSS engine: no shorthand expansion, no inheritance, no cascade
   layers, no `@supports`. Anything it cannot classify is reported rather than
   assumed harmless. */

export interface ApplicableRule {
  selectors: string[];
  /** Effective declarations for this rule: name normalized, importance kept. */
  decls: Map<string, EffectiveDecl>;
  /** Absolute offset in the source, so order is the source's, not a slice's. */
  pos: number;
  /** "" for top level, else the media condition text. */
  context: string;
  /** True when the context could not be classified for this viewport. */
  unknown: boolean;
}

export interface EffectiveDecl { value: string; important: boolean }

/** A standard property name is ASCII case-insensitive; a custom property is not.
 *  `DISPLAY` and `display` are one declaration; `--Prov` and `--prov` are two. */
export function normalizePropertyName(name: string): string {
  const trimmed = name.trim();
  return trimmed.startsWith("--") ? trimmed : trimmed.toLowerCase();
}

/** Split a value from its `!important` flag. The bang may carry whitespace on
 *  either side and the keyword is case-insensitive: `! IMPORTANT` is valid CSS
 *  and a reader that only matched `!important` would rank it as ordinary. */
export function splitImportant(rawValue: string): EffectiveDecl {
  const match = rawValue.match(/^([\s\S]*?)\s*!\s*important\s*$/i);
  return match
    ? { value: match[1].trim(), important: true }
    : { value: rawValue.trim(), important: false };
}

/** The effective declarations of ONE rule.
 *
 *  Within a rule the cascade is not simply last-wins: an `!important`
 *  declaration is not displaced by a later ordinary one for the same property.
 *  At equal importance the later declaration does win. */
export function effectiveDeclarationMap(
  declarations: Array<[string, string]>,
): Map<string, EffectiveDecl> {
  const out = new Map<string, EffectiveDecl>();
  for (const [rawName, rawValue] of declarations) {
    const name = normalizePropertyName(rawName);
    const decl = splitImportant(rawValue);
    const held = out.get(name);
    if (held && held.important && !decl.important) continue;
    out.set(name, decl);
  }
  return out;
}

/** Is a media condition in force at `width`? `null` when unclassifiable. */
export function mediaApplies(condition: string, width: number): boolean | null {
  const text = condition.trim().toLowerCase();
  if (!text) return true;
  if (text.includes(",")) return null;      // condition lists: not modelled
  if (text.includes(" or ")) return null;
  if (text.startsWith("not ")) return null;
  let applies = true;
  for (const part of text.split(" and ")) {
    const term = part.trim().replace(/^\(|\)$/g, "").trim();
    if (!term || term === "screen" || term === "all") continue;
    const max = term.match(/^max-width:\s*(\d+)px$/);
    if (max) { applies &&= width <= Number(max[1]); continue; }
    const min = term.match(/^min-width:\s*(\d+)px$/);
    if (min) { applies &&= width >= Number(min[1]); continue; }
    /* prefers-reduced-motion, forced-colors, hover, print and friends do not
       describe this audit's viewport question. */
    return null;
  }
  return applies;
}

/** Every rule the browser would consider at `width`, in source order.
 *
 *  Top-level rules always apply. A media block applies when its condition is in
 *  force. A block whose condition cannot be classified is still returned, with
 *  `unknown: true`, so a caller can fail closed rather than silently skip it. */
/* Parsing the whole stylesheet is linear, but the winner lookup runs once per
   selector/property pair and the mutation proofs repeat it across a dozen
   mutated sheets. That is several hundred full parses, slow enough to trip a
   test timeout. The result depends only on (sheet, width), so it is memoized;
   every key is a sheet this run constructed, so the cache stays bounded. */
const APPLICABLE_CACHE = new Map<string, ApplicableRule[]>();

export function applicableRulesAt(sheet: string, width: number): ApplicableRule[] {
  const key = width + " " + sheet;
  const cached = APPLICABLE_CACHE.get(key);
  if (cached) return cached;
  const computed = computeApplicableRulesAt(sheet, width);
  APPLICABLE_CACHE.set(key, computed);
  return computed;
}

function computeApplicableRulesAt(sheet: string, width: number): ApplicableRule[] {
  const css = stripComments(sheet);
  const out: ApplicableRule[] = [];
  const emit = (body: string, offset: number, context: string, unknown: boolean) => {
    for (const r of rules(body)) {
      out.push({
        selectors: r.sel.split(",").map((s) => normalizeSelector(s.trim())).filter(Boolean),
        decls: effectiveDeclarationMap(parseDeclarations(r.body)),
        pos: offset + out.length,
        context,
        unknown,
      });
    }
  };

  let at = 0;
  for (;;) {
    const next = css.indexOf("@", at);
    if (next === -1) { emit(css.slice(at), at, "", false); return out; }
    emit(css.slice(at, next), at, "", false);

    const open = css.indexOf("{", next);
    if (open === -1) return out;
    const prelude = css.slice(next, open);
    let depth = 0;
    let end = -1;
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) return out;

    const body = css.slice(open + 1, end);
    if (/^@media\b/i.test(prelude)) {
      const verdict = mediaApplies(prelude.replace(/^@media/i, ""), width);
      if (verdict === true) emit(body, open + 1, prelude.trim(), false);
      else if (verdict === null) emit(body, open + 1, prelude.trim(), true);
      /* verdict === false: not in force at this width, correctly ignored. */
    } else {
      /* @supports, @layer, @container: not modelled. Reported as unknown so a
         targeted declaration hiding inside one cannot pass unnoticed. */
      emit(body, open + 1, prelude.trim(), true);
    }
    at = end + 1;
  }
}

/** (ids, classes/attributes/pseudo-classes, elements). */
export function specificityOf(selector: string): [number, number, number] {
  return [
    (selector.match(/#[\w-]+/g) || []).length,
    (selector.match(/\.[\w-]+|\[[^\]]*\]|:[a-z-]+(\([^)]*\))?/g) || []).length,
    (selector.match(/(^|[\s>+~])[a-z][\w-]*/g) || []).length,
  ];
}

export function outranks(a: [number, number, number], b: [number, number, number]): boolean {
  return a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
}

/** Does `candidate` address the same element as `target`?
 *
 *  Itself; a same-element extension (`.x.x`, `.x:not(.y)`); or an
 *  ancestor-scoped form (`body .a .x`). A prefix-sharing class (`.x-extra`) is
 *  a different element. */
export function addressesSameElement(candidate: string, target: string): boolean {
  if (candidate === target) return true;

  /* SEMANTICS-PRESERVING SPELLINGS ONLY.

     Two compounds are equivalent when they select the same elements for a
     reason that is purely notational:

       - a leading universal star, which constrains nothing:
         `*.row-instruments` selects exactly `.row-instruments`;
       - the same simple-selector sequence written more than once, which is
         idempotent: `.agent-row.agent-row` selects exactly `.agent-row`.

     Anything that ADDS a condition is a different element set and is rejected:
     `.agent-row.other`, `[data-x].row-instruments`, `#x.row-instruments`,
     `.ri-model:not(.x)`. A hyphen continuation is a different class outright,
     so `.row-instruments-extra` never matches.

     Note this is deliberately narrower than the previous rule, which admitted
     ANY extension of the final compound — that treated `.ri-model.other`, a
     strictly smaller element set, as the audited cell. */
  const compoundEquivalent = (compound: string, base: string) => {
    const bare = compound.startsWith("*") ? compound.slice(1) : compound;
    if (bare === base) return true;
    if (base.length === 0 || bare.length % base.length !== 0) return false;
    for (let at = 0; at < bare.length; at += base.length) {
      if (bare.slice(at, at + base.length) !== base) return false;
    }
    return true;
  };

  const targetParts = parseSelector(target);
  const candidateParts = parseSelector(candidate);
  if (targetParts.length === 0 || candidateParts.length < targetParts.length) return false;

  /* The candidate must END with the target's chain — same compounds, same
     combinators — with the final compound allowed to be an extension. Anything
     before that is ancestor scope, which only strengthens the rule.

     `body .row-instruments.row-instruments` and `body .agent-row .ri-model.ri-model`
     are therefore recognised; `.row-instruments .child` is not, because the
     target is not the LAST compound there. */
  const offset = candidateParts.length - targetParts.length;
  for (let i = 0; i < targetParts.length; i++) {
    const want = targetParts[i];
    const got = candidateParts[offset + i];
    const last = i === targetParts.length - 1;

    /* THE JOIN vs THE CHAIN.

       The combinator that attaches an added PREFIX to the first compound of the
       target's own chain is scope, not shape: `body > .row-instruments`,
       `.peer + .row-instruments` and `.peer ~ .row-instruments` all still
       select the same rightmost element, more narrowly. Requiring a descendant
       join there rejected three real ways to write a stronger rule about the
       very element being audited — so any join is accepted.

       Combinators INSIDE the target chain are shape and stay exact: with a
       target of `.agent-row .ri-model`, a candidate written
       `.agent-row > .ri-model` describes a direct child, which is a different
       set of elements, and is rejected. */
    if (i > 0 && got.combinator !== want.combinator) return false;
    if (i === 0 && offset > 0 && got.combinator === "") return false;

    /* Every compound in the chain is compared the same way: a repeated or
       star-prefixed spelling is the same element wherever it appears, so
       `.agent-row.agent-row .ri-model` and `.agent-row *.ri-model` both address
       what `.agent-row .ri-model` addresses. */
    if (!compoundEquivalent(got.compound, want.compound)) return false;
  }
  return true;
}

export interface WinnerResult {
  value: string | null;
  /** Contexts that wrote this property but could not be classified. */
  unclassified: string[];
}

/** The winning declaration for one audited selector/property at `width`,
 *  ranked by !important, then specificity, then absolute source order. */
export function winningDeclaration(
  sheet: string,
  width: number,
  target: string,
  property: string,
): WinnerResult {
  let best: { imp: number; spec: [number, number, number]; pos: number; value: string } | null = null;
  const unclassified: string[] = [];
  for (const rule of applicableRulesAt(sheet, width)) {
    /* A rule's selector LIST may address the target more than once, at
       different strengths: `.row-instruments, .row-instruments.row-instruments`
       is one rule whose stronger branch is what actually decides the element.
       Taking the first matching branch understated the rule and let a later,
       weaker rule appear to win — so the strongest matching branch is the one
       this rule is ranked by. */
    let hit: string | null = null;
    let hitSpec: [number, number, number] | null = null;
    for (const s of rule.selectors) {
      if (!addressesSameElement(s, target) || !isAtRestSelector(s)) continue;
      const spec = specificityOf(s);
      if (!hitSpec || outranks(spec, hitSpec)) { hit = s; hitSpec = spec; }
    }
    if (!hit || !hitSpec) continue;
    const decl = rule.decls.get(normalizePropertyName(property));
    if (decl === undefined) continue;
    if (rule.unknown) { unclassified.push(rule.context); continue; }
    const imp = decl.important ? 1 : 0;
    const value = decl.value;
    const spec = hitSpec;
    const wins = !best
      || imp > best.imp
      || (imp === best.imp && outranks(spec, best.spec))
      || (imp === best.imp && !outranks(best.spec, spec) && rule.pos >= best.pos);
    if (wins) best = { imp, spec, pos: rule.pos, value };
  }
  return { value: best ? best.value : null, unclassified };
}

/* ---------- exact parsed rules ----------

   Everything above grew by accretion: a regex for placement, another for
   universality, another for a property. Each addition needed its own escaping,
   its own boundary check and its own guard test, and the audit's correctness
   lived in the union of all of them.

   This is the replacement. A rule is parsed ONCE into an ordered selector list
   and an ordered declaration list, and every test asks the same two questions:
   "which rules name exactly this selector" and "what is the effective last
   value of this property". There is no pattern matching left to get wrong. */

/** One selector, whitespace-normalized, combinators and pseudos intact. */
export function normalizeSelector(selector: string): string {
  return parseSelector(selector)
    .map((part, i) => {
      const compound = normalizeCompound(part.compound);
      if (i === 0) return compound;
      return (part.combinator === " " ? " " : " " + part.combinator + " ") + compound;
    })
    .join("");
}

export interface ParsedRule {
  /** Every selector in the rule's list, normalized, in source order. */
  selectors: string[];
  /** Every declaration in source order, so duplicates stay visible. */
  declarations: Array<[string, string]>;
  /** Property to its EFFECTIVE (last) value. */
  props: Map<string, string>;
  /** Where this rule sits in the block, so order is auditable. */
  index: number;
}

/** Split a declaration body into ordered [property, value] pairs.
 *
 *  Custom properties are kept as written (`--display` stays `--display`), which
 *  is what makes them unable to satisfy the real property of the same name:
 *  the map is keyed by the literal name. */
export function parseDeclarations(body: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const raw of body.split(";")) {
    const decl = raw.trim();
    if (!decl) continue;
    const at = decl.indexOf(":");
    if (at === -1) continue;
    out.push([decl.slice(0, at).trim(), decl.slice(at + 1).trim().replace(/\s+/g, " ")]);
  }
  return out;
}

/** Every rule in a block, parsed exactly. */
export function parseRules(block: string): ParsedRule[] {
  return rules(block).map((r, index) => {
    const declarations = parseDeclarations(r.body);
    const props = new Map<string, string>();
    /* Last wins, which is what the cascade does between rules of equal
       specificity and what a reader must report. */
    for (const [prop, value] of declarations) props.set(prop, value);
    return {
      selectors: r.sel.split(",").map((s) => normalizeSelector(s.trim())).filter(Boolean),
      declarations,
      props,
      index,
    };
  });
}

/** Rules whose selector list contains EXACTLY this normalized selector. */
export function selectRules(block: string, selector: string): ParsedRule[] {
  const want = normalizeSelector(selector);
  return parseRules(block).filter((r) => r.selectors.includes(want));
}

/** The effective last value of one property for one exact selector, or null.
 *
 *  Later rules override earlier ones, so a contract satisfied by an early rule
 *  and undone by a late one reads as undone. */
export function effectiveProp(block: string, selector: string, property: string): string | null {
  let value: string | null = null;
  for (const rule of selectRules(block, selector)) {
    const hit = rule.props.get(property);
    if (hit !== undefined) value = hit;
  }
  return value;
}

/** The effective property map for one exact selector, across every rule that
 *  names it, in source order. */
export function effectiveProps(block: string, selector: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rule of selectRules(block, selector)) {
    for (const [prop, value] of rule.declarations) out.set(prop, value);
  }
  return out;
}
