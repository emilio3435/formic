/* Harness row parity — every provider gets the same row, or the row says why not.
 *
 * Five gaps were found by reading the client against the fourteen-provider
 * roster. This file holds the four that are about what a row SAYS (FE-1, FE-2,
 * FE-5a, FE-5b); tests/harness-responsive-parity.test.ts holds the one about
 * where a row PUTS things (FE-4), and tests/settings-collectors-dom.test.ts
 * holds FE-3.
 *
 * Every case renders from tests/fixtures/harness-ui-parity.ts, so the legacy
 * cohort and the integrated cohort are compared against one another rather than
 * each being described separately and assumed to match.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findClass, textOf, withDom } from "./helpers/fake-dom";
import {
  atRestRules,
  effectiveProp,
  effectiveProps,
  rules,
  selectRules,
  stripComments as stripCssComments,
  winningDeclaration,
} from "./helpers/css-rules";
import {
  INTEGRATED_COHORT,
  LEGACY_COHORT,
  allProviderBoard,
  allProviderRows,
  ABSENT_ONLY_BOARD,
  ALL_ABSENT_BOARD,
  DEGRADED_ONLY_BOARD,
  R1_CLAUDE_WORKING,
  R2_GEMINI_WORKING,
  R3_OPENCODE_WORKING,
  R10_OPENCODE_PARENT,
  R11_OPENCODE_CHILD,
  R12_GEMINI_LONG,
  R13_OPENCODE_USAGE,
  R14_GEMINI_UNKNOWN_USAGE,
  R15_GEMINI_LINKED,
  R16_OPENCODE_OBSERVED_ONLY,
  R16B_PI_QUARANTINED,
  R20_MISSING_PROVIDER,
  R21_MIX_PROVIDERS,
  R22_OPENCODE_CORRUPT_TIME,
  R23_PI_WORKING,
  CONTROL_CASES,
  controlRow,
  everySnapshotRow,
  longLabelRow,
  searchableStrings,
  syntheticBoard,
  type SyntheticRow,
} from "./fixtures/harness-ui-parity";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let M: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let TF: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let NAMING: any;

const root = resolve(import.meta.dir, "..");
const styles = readFileSync(resolve(root, "src/web/styles.css"), "utf8");
/* src/server/naming.ts trips file(1)'s binary heuristic, so it is read as an
   explicit utf8 string rather than grepped. */
const serverCollectors = readFileSync(resolve(root, "src/server/collectors.ts"), "utf8");
const parityDoc = readFileSync(resolve(root, "docs/PARITY.md"), "utf8");

let PROVIDERS: readonly string[];

beforeAll(async () => {
  // @ts-expect-error The dependency-free browser client intentionally has no declaration file.
  await import("../src/web/app.js");
  M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
  // @ts-expect-error Same: the client modules ship without declarations.
  TF = await import("../src/web/text-formatters.js");
  // @ts-expect-error Same.
  NAMING = await import("../src/web/naming.js");
  ({ PROVIDERS } = await import("../src/shared/types"));
});

/* The client module-global `state` is shared by every suite that runs in this
   Bun worker, so a render that needs a board on it has to put back what it
   found. Four health renders below did not, and the July 22 fixture snapshot
   they left behind reached tests/web-client.test.ts: spanMsOf read a stale
   `generatedAt`, and renderAgentDrawer added stale-feed chrome to rows that had
   neither.

   Snapshots exactly the keys the patch names, assigns the patch, runs the body,
   and restores those keys in `finally`. Synchronous by construction: the body
   is the render itself, so the restore completes before the next test begins. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withClientState<T>(patch: Record<string, any>, body: () => T): T {
  const saved = Object.keys(patch).map((key) => [key, M.state[key]] as const);
  Object.assign(M.state, patch);
  try {
    return body();
  } finally {
    for (const [key, value] of saved) M.state[key] = value;
  }
}

/* ---------- reading a rendered row ---------- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function walk(node: any, out: any[] = []): any[] {
  if (!node || typeof node !== "object") return out;
  out.push(node);
  for (const kid of node.children || []) walk(kid, out);
  return out;
}

/** Every attribute value in the subtree that can carry a human-readable name. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function accessibleStrings(node: any): string[] {
  const out: string[] = [];
  for (const n of walk(node)) {
    const attrs = n.attributes || {};
    for (const key of ["aria-label", "alt", "title", "src"]) {
      if (typeof attrs[key] === "string") out.push(attrs[key]);
    }
  }
  out.push(textOf(node));
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function classNames(node: any): string[] {
  return walk(node).flatMap((n) => String(n.className || "").split(/\s+/)).filter(Boolean);
}

/* ---------- ancestor-aware visibility ----------

   Defined here rather than in tests/helpers/fake-dom.ts: that helper is shared
   with suites outside this slice's fence, and widening it would have made it a
   thirteenth changed path. These two functions are small enough to live beside
   the assertions that need them. */

/** Hidden FROM SIGHT by this node's own state.
 *
 *  Deliberately NOT including `aria-hidden`. The two hide from different
 *  audiences and conflating them is wrong in both directions: the empty-state
 *  proof separates its parts with an `aria-hidden` " · " — correctly, since a
 *  screen reader should not announce a bullet — and that separator is plainly
 *  visible on screen. Treating it as invisible made the composed line read
 *  "…degradedchecked 29.5d ago" and would have reported a correct board as
 *  broken. `aria-hidden` is checked separately, where the question is whether a
 *  node may CARRY meaning rather than whether it can be seen. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function selfHidden(node: any): boolean {
  if (!node || typeof node !== "object") return false;
  const attrs = node.attributes || {};
  if ("hidden" in attrs) return true;
  if (/(^|;)\s*display:\s*none/.test(String(attrs.style || ""))) return true;
  if (/(^|;)\s*visibility:\s*hidden/.test(String(attrs.style || ""))) return true;
  const classes = String(node.className || "").split(/\s+/);
  return ["visually-hidden", "sr-only", "screen-reader-only"].some((c) => classes.includes(c));
}

/** Hidden from the ACCESSIBILITY TREE by this node's own state.
 *
 *  The mirror image of `selfHidden`, and deliberately not the same set:
 *    - `aria-hidden` hides here but NOT visually, so a decorative " · " is
 *      absent from this channel and present in the other;
 *    - `.visually-hidden` hides VISUALLY but not here, so sr-only text is
 *      absent from the other channel and present in this one.
 *  Only `hidden`, `display:none` and `visibility:hidden` remove a node from
 *  both at once. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function a11ySelfHidden(node: any): boolean {
  if (!node || typeof node !== "object") return false;
  const attrs = node.attributes || {};
  if ("hidden" in attrs) return true;
  if (String(attrs["aria-hidden"] || "") === "true") return true;
  if (/(^|;)\s*display:\s*none/.test(String(attrs.style || ""))) return true;
  if (/(^|;)\s*visibility:\s*hidden/.test(String(attrs.style || ""))) return true;
  return false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function a11yHidden(node: any): boolean {
  let cur = node;
  while (cur && typeof cur === "object") {
    if (a11ySelfHidden(cur)) return true;
    cur = cur.parent;
  }
  return false;
}

/** What a screen reader reads: sr-only text retained, aria-hidden dropped. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function a11yTextOf(node: any): string {
  if (a11yHidden(node)) return "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inner = (n: any): string => {
    if (!n || typeof n !== "object") return "";
    if (n.nodeType === 3) return String(n.textContent || "");
    if (a11ySelfHidden(n)) return "";
    let s = n.children?.length ? "" : (typeof n.textContent === "string" ? n.textContent : "");
    for (const kid of n.children || []) s += inner(kid);
    return s;
  };
  return inner(node);
}

/** May this node carry meaning to BOTH audiences? A carrier that is
 *  `aria-hidden` reaches sighted operators only; one that is visually hidden
 *  reaches nobody but a screen reader. Neither states a fact the board owes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function carrierHidden(node: any): boolean {
  return hiddenHere(node) || a11yHidden(node);
}

/** The evidence must reach BOTH audiences, from the node that claims it.
 *
 *  The mutation this rejects is specific and cheap: satisfy a visible check by
 *  putting the real sentence in an `aria-hidden` child, or satisfy an
 *  accessible check by putting it in a `.visually-hidden` one. Either way one
 *  audience is told and the other is not, and a single-channel assertion calls
 *  that done. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bothChannels(node: any): { visible: string; a11y: string } {
  return { visible: visibleTextOf(node), a11y: a11yTextOf(node) };
}

/** Assert one fact is readable on both channels of `node`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function expectBoth(node: any, fact: string, what: string): void {
  const { visible, a11y } = bothChannels(node);
  expect(visible, `${what} is not visible on screen`).toContain(fact);
  expect(a11y, `${what} does not reach the accessibility tree`).toContain(fact);
}

/** Hidden by its own state OR by any ancestor's.
 *
 *  Hiding is INHERITED. A perfectly correct value inside a `hidden` wrapper is
 *  on screen for nobody, and a self-only check would certify it — which is the
 *  mutation "wrap the honest element rather than alter it". */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hiddenHere(node: any): boolean {
  let cur = node;
  while (cur && typeof cur === "object") {
    if (selfHidden(cur)) return true;
    cur = cur.parent;
  }
  return false;
}

/** textOf with every hidden subtree removed and the node's own ancestry
 *  respected. Empty when the node sits inside anything hidden. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function visibleTextOf(node: any): string {
  if (hiddenHere(node)) return "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inner = (n: any): string => {
    if (!n || typeof n !== "object") return "";
    if (n.nodeType === 3) return String(n.textContent || "");
    if (selfHidden(n)) return "";
    let s = n.children?.length ? "" : (typeof n.textContent === "string" ? n.textContent : "");
    for (const kid of n.children || []) s += inner(kid);
    return s;
  };
  return inner(node);
}

const program = { id: "prog_synthetic", name: "Parity fixture", agents: [] as SyntheticRow[] };

function renderRow(agent: SyntheticRow, opts: Record<string, unknown> = {}) {
  return withDom(() => {
    M.state.view = "board";
    return M.renderAgentRow(agent, { ...program, agents: [agent] }, opts);
  });
}

function renderDrawer(agent: SyntheticRow) {
  return withDom(() => {
    M.state.view = "board";
    const pane = document.createElement("div");
    M.renderAgentDrawer(pane, { kind: "agent", agent, program: { ...program, agents: [agent] } });
    return pane;
  });
}

/** The row's `.ri-harness` value, the string an operator actually reads. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function harnessCellText(row: any): string {
  return textOf(findClass(row, "ri-harness"));
}

/* ================= FE-1 — a missing provider is not Claude ================= */

describe("FE-1 a session with no recorded provider is never presented as Claude", () => {
  /* The row's TEXT cell was already honest — `harnessUnknown` is `!agent.provider`,
     so `.ri-harness` prints an em dash. The MARK was not: harnessKeyOf falls back
     to "claude", so the same row printed a dash in the harness column while
     painting Anthropic's logo beside the name. Two contradictory answers to one
     question is worse than either half alone. */

  test("harnessKeyOf does not answer 'claude' for a record with no provider", () => {
    expect(M.harnessKeyOf({})).not.toBe("claude");
    expect(M.harnessKeyOf({ provider: "" })).not.toBe("claude");
    /* And the established path is untouched: a real provider still keys itself. */
    for (const p of PROVIDERS) expect(M.harnessKeyOf({ provider: p })).toBe(p);
  });

  test("the row shows no Claude asset, label or accessible name", () => {
    const row = renderRow(R20_MISSING_PROVIDER);
    for (const value of accessibleStrings(row)) {
      expect(value, `a provider-less row exposed "${value}"`).not.toMatch(/claude/i);
      expect(value, `a provider-less row exposed "${value}"`).not.toMatch(/anthropic/i);
    }
  });

  test("the harness mark falls back to text and says the harness is not recorded", () => {
    const row = renderRow(R20_MISSING_PROVIDER);
    const mark = walk(row).find((n) => String(n.className || "").includes("harness-mark"));
    expect(mark, "the row rendered no harness mark at all").toBeTruthy();
    expect(mark.tagName, "an unknown harness must not resolve to an image").toBe("span");
    expect(String(mark.className)).toContain("provider-mark-text");
    const name = String(mark.attributes["aria-label"] || "");
    expect(name).toMatch(/not recorded/i);
    expect(name).not.toMatch(/claude/i);
  });

  test("no class carries an undefined suffix on the row or in the Inspector", () => {
    const row = renderRow(R20_MISSING_PROVIDER);
    expect(classNames(row)).not.toContain("provider-undefined");
    for (const cls of classNames(row)) {
      expect(cls, `row class "${cls}" ends in undefined`).not.toMatch(/undefined$/);
    }
    const drawer = renderDrawer(R20_MISSING_PROVIDER);
    expect(classNames(drawer)).not.toContain("dw-provider--undefined");
    for (const cls of classNames(drawer)) {
      expect(cls, `drawer class "${cls}" ends in undefined`).not.toMatch(/undefined$/);
    }
  });

  test("the Inspector agrees with the row and never names Claude", () => {
    const drawer = renderDrawer(R20_MISSING_PROVIDER);
    for (const value of accessibleStrings(drawer)) {
      expect(value, `the drawer exposed "${value}"`).not.toMatch(/claude/i);
    }
  });

  test("an established provider's mark is untouched by the unknown branch", () => {
    /* The fix adds a branch; it must not move a row that already had an answer.
       Claude's own row is the one most likely to be disturbed by a change to the
       "claude" fallback, so it is the one pinned. */
    const row = renderRow(R1_CLAUDE_WORKING);
    const mark = walk(row).find((n) => String(n.className || "").includes("harness-mark"));
    expect(mark.tagName).toBe("img");
    expect(mark.attributes.src).toBe("/icons/claude-code.svg");
    expect(mark.attributes.alt).toBe("Claude Code");
    expect(mark.attributes.title).toBe("Harness Claude Code");
  });

  test("the focusable row itself says the harness is not recorded", () => {
    /* The row is a single tabbable div carrying one long accessible name — that
       name IS the row for anyone navigating by keyboard, and it enumerates
       status, message, model, context, tokens, span and access. It never named
       the harness, so the one row on the board whose harness is unknown
       announced every other field and stayed silent about the missing one.
       A screen-reader operator had no way to learn the difference between this
       row and a Claude Code row. */
    const row = renderRow(R20_MISSING_PROVIDER);
    expect(row.attributes.tabindex, "the row is not focusable").toBe("0");
    const name = String(row.attributes["aria-label"] || "");
    expect(name, "the row's accessible name is empty").toBeTruthy();
    expect(name, "the focusable row never mentions the harness at all").toMatch(/Harness not recorded/i);
    expect(name).not.toMatch(/claude/i);
  });

  test("a known harness is named on the focusable row, for all fourteen", () => {
    /* The counter-proof, over the whole roster rather than a four-row sample:
       the fix must ADD the harness to every row's name, not special-case the
       unknown one. A row that names the harness only when it is missing is a
       stranger contract than naming it never — and a fix that covered only the
       providers a cohort happened to include would pass a sampled check. */
    for (const agent of allProviderRows(PROVIDERS)) {
      const name = String(renderRow(agent).attributes["aria-label"] || "");
      expect(name, `${agent.provider} row's accessible name omits its harness`)
        .toContain("Harness: " + TF.providerLabel(agent.provider));
    }
  });

  test("a recovered record with a working directory is named, never 'undefined'", () => {
    /* Found by browser QA on the live board. R20's shape reaches the client
       from an archived file, and such a file can still carry its `cwd` after
       its `provider` is gone. That pair lands in the legacy naming fallback,
       which composes an identity as `providerLabel(provider) + " · " + folder`
       — and providerLabel returns its ARGUMENT when the key is missing, so the
       value `undefined` was coerced to a string and shipped. The row read
       "undefined · formic", the Inspector heading agreed with it, the row's
       accessible name opened with it, and the rename button offered "Rename
       undefined · formic": a JavaScript keyword presented as the name a human
       is invited to edit.

       The cwd is spread on here rather than added to the fixture because R20's
       absent provider is the fixture's own assertion, while the cwd is this
       regression's input. */
    const recovered = { ...R20_MISSING_PROVIDER, cwd: "/synthetic/workspace/formic" };
    const surfaces = [
      ["row", renderRow(recovered)],
      ["Inspector", renderDrawer(recovered)],
    ] as const;

    for (const [where, node] of surfaces) {
      /* Both channels, because a name is read by both audiences. */
      const { visible, a11y } = bothChannels(node);
      expect(visible, `the ${where} prints "undefined" on screen`).not.toMatch(/undefined/);
      expect(a11y, `the ${where} reads "undefined" to a screen reader`).not.toMatch(/undefined/);
      for (const value of accessibleStrings(node)) {
        expect(value, `the ${where} exposed "${value}"`).not.toMatch(/undefined/);
      }
      /* "No undefined" alone is satisfied by printing nothing, so the recovered
         record's own display name is required to survive as the identity. */
      expect(visible, `the ${where} lost the recovered record's name`).toContain("Recovered record");
      expect(a11y, `the ${where} withheld the name from the accessibility tree`)
        .toContain("Recovered record");
    }

    /* ...and the missing harness stays missing. The repair has to buy the name
       from the record itself, not by inventing a provider to label. */
    const rowName = String(surfaces[0][1].attributes["aria-label"] || "");
    expect(rowName).toContain("Recovered record");
    expect(rowName, "the recovered row stopped saying its harness is unknown")
      .toMatch(/Harness not recorded/i);

    /* The rename control offers the exact string an operator is asked to edit. */
    const rename = walk(surfaces[0][1])
      .find((n) => String((n.attributes || {})["aria-label"] || "").startsWith("Rename "));
    expect(rename, "the row rendered no rename control").toBeTruthy();
    expect(String(rename.attributes["aria-label"])).toBe("Rename Recovered record");

    /* The same concatenation has a second site: with no cwd, no display name
       and no task, the fallback was `providerLabel(undefined) + " agent"`. No
       fixture renders that shape, so it is pinned directly rather than left as
       the next undefined a QA pass finds. */
    expect(M.sourceAgentName({})).not.toMatch(/undefined/);
    expect(M.agentName({})).not.toMatch(/undefined/);
    expect(M.agentName({}), "a nameless record must still be called something").toBeTruthy();

    /* Counter-proof: a RECORDED provider still derives its folder identity, and
       all fourteen canonical labels stay byte-identical. A repair that bought
       honesty for the unknown row by dropping cwd naming for everyone would
       pass every assertion above and fail here. */
    for (const p of PROVIDERS) {
      expect(M.sourceAgentName({ provider: p, cwd: "/synthetic/workspace/formic" }),
        `${p} lost its folder identity`).toBe(TF.providerLabel(p) + " · formic");
    }
  });
});

/* ================= FE-2 — one operator label per provider ================= */

describe("FE-2 every PROVIDERS member has one operator label shared by every surface", () => {
  /* Five maps carry a provider's name and they did not agree. PROVIDER_LABELS is
     an untyped object literal, which is exactly why it was the one that slipped:
     the four typed Record<Provider, string> maps failed the build when Gemini was
     added and this one silently returned the raw key. So one board printed
     "gemini" in the Mix beside "Gemini CLI" in the filter, the row and the
     Inspector. */

  /** The canonical roster. The column these strings head is titled Harness, so
   *  the qualified form is the correct one — "Claude" names a model family as
   *  readily as a harness, and the board has a separate Agent mark for that. */
  const CANONICAL: Record<string, string> = {
    codex: "Codex",
    omp: "OMP",
    claude: "Claude Code",
    cursor: "Cursor",
    factory: "Factory",
    prime: "Prime",
    grok: "Grok Build",
    hermes: "Hermes",
    muse: "Muse Code",
    antigravity: "Antigravity",
    copilot: "Copilot CLI",
    gemini: "Gemini CLI",
    opencode: "OpenCode",
    pi: "Pi",
  };

  test("the canonical roster covers PROVIDERS exactly — no member, no extra", () => {
    /* Written over PROVIDERS rather than over the map's own keys: a catalog that
       audits itself cannot notice the provider nobody added to it. */
    expect([...PROVIDERS].sort()).toEqual(Object.keys(CANONICAL).sort());
  });

  test("providerLabel never leaks a raw provider key", () => {
    for (const p of PROVIDERS) {
      /* The failure this catches is silent: PROVIDER_LABELS[p] || p returns the
         key itself, which is a plausible-looking lowercase word. Nothing throws,
         nothing is undefined, and the Mix simply prints "opencode". */
      expect(TF.providerLabel(p), `providerLabel("${p}") returned the raw key`).not.toBe(p);
      expect(TF.PROVIDER_LABELS[p], `PROVIDER_LABELS has no entry for "${p}"`).toBeTypeOf("string");
    }
  });

  test("every label map answers with the one canonical string", () => {
    for (const p of PROVIDERS) {
      const want = CANONICAL[p];
      expect(TF.providerLabel(p), `providerLabel(${p})`).toBe(want);
      expect(M.HARNESS_MARK[p]?.label, `HARNESS_MARK.${p}.label`).toBe(want);
      expect(NAMING.PROVIDER_DISPLAY_NAMES[p], `client PROVIDER_DISPLAY_NAMES.${p}`).toBe(want);
    }
  });

  test("the server NAMES a session with the canonical label, for every provider", async () => {
    /* Behaviour, not a source scrape. An earlier draft regex-matched the
       PROVIDER_NAMES literal out of src/server/collectors.ts, which proves only
       that a string appears in a file — it would pass against a map nothing
       reads, and fail against a correct refactor that moved it. `resolveAgentName`
       is the public resolver every server-side name goes through, so calling it
       tests the contract instead of the spelling. */
    const { resolveAgentName } = await import("../src/server/naming");
    for (const p of PROVIDERS) {
      const named = resolveAgentName(
        { provider: p as never, sourceSessionId: "ses_synthetic_name", originCwd: "/synthetic/workspace/formic" },
        "/synthetic",
      );
      expect(named.name, `the server named a ${p} session "${named.name}"`)
        .toBe(`${CANONICAL[p]} · formic`);
    }
  });

  test("the collector COMPOSES durable display names from the canonical label", async () => {
    /* `resolveAgentName` is one of two server paths and it reads
       PROVIDER_DISPLAY_NAMES. `makeAgent` is the other, and it reads a
       different map — PROVIDER_NAMES — to build the `displayName` that is
       written down and survives restarts. Testing only the first would leave
       the durable one free to disagree, which is exactly the split this whole
       gap is about. Both are public; both are exercised. */
    const { makeAgent } = await import("../src/server/collectors");
    for (const p of PROVIDERS) {
      const withCwd = makeAgent({
        provider: p as never,
        sourceSessionId: "ses_synthetic_name",
        cwd: "/synthetic/workspace/formic",
        meta: {},
      } as never);
      expect(withCwd.displayName, `makeAgent named a ${p} session "${withCwd.displayName}"`)
        .toBe(`${CANONICAL[p]} · formic`);

      /* And the last-resort fallback, which is the one an operator sees when a
         session has neither a folder nor a task. */
      const bare = makeAgent({
        provider: p as never,
        sourceSessionId: "ses_synthetic_bare",
        meta: {},
      } as never);
      expect(bare.displayName, `makeAgent's ${p} fallback is "${bare.displayName}"`)
        .toBe(`${CANONICAL[p]} session`);
    }
  });

  test("the five moved labels are moved everywhere a name is composed", () => {
    /* These five are the ones that CHANGE, so they are the five a partial fix
       leaves behind. Named individually rather than looped, so a failure says
       which product was missed. */
    const MOVED: Array<[string, string]> = [
      ["claude", "Claude Code"],
      ["grok", "Grok Build"],
      ["muse", "Muse Code"],
      ["copilot", "Copilot CLI"],
      ["gemini", "Gemini CLI"],
    ];
    for (const [key, label] of MOVED) {
      expect(TF.providerLabel(key), `providerLabel(${key})`).toBe(label);
      expect(M.HARNESS_MARK[key]?.label, `HARNESS_MARK.${key}`).toBe(label);
      expect(NAMING.PROVIDER_DISPLAY_NAMES[key], `client display name for ${key}`).toBe(label);
    }
  });

  test("the qualified names are pinned exactly, not merely present", () => {
    /* These are the ones that MOVE. A test that only checked non-emptiness would
       pass against the short forms and the whole ruling would evaporate. */
    expect(TF.providerLabel("claude")).toBe("Claude Code");
    expect(TF.providerLabel("grok")).toBe("Grok Build");
    expect(TF.providerLabel("muse")).toBe("Muse Code");
    expect(TF.providerLabel("copilot")).toBe("Copilot CLI");
    expect(TF.providerLabel("gemini")).toBe("Gemini CLI");
    /* And the ones that must NOT acquire a qualifier they never had. */
    expect(TF.providerLabel("codex")).toBe("Codex");
    expect(TF.providerLabel("opencode")).toBe("OpenCode");
    expect(TF.providerLabel("pi")).toBe("Pi");
  });

  test("all fourteen print that one string in the rendered row, drawer and Mix", () => {
    /* Every provider, through the three surfaces that actually paint the label —
       not four hand-picked ones, and not the label function standing in for the
       surfaces that call it. The rows carry display names like "worker-3" on
       purpose: a fixture whose name repeats the label would let each assertion
       pass through the name and never touch the surface under test. */
    const rows = allProviderRows(PROVIDERS);
    const mix = renderMixOf(PROVIDERS.map((p, i) => ({ prov: p, n: i + 1 })));
    const segs = mixSegments(mix);
    expect(segs.length, "the Mix dropped a provider").toBe(PROVIDERS.length);

    for (const [i, agent] of rows.entries()) {
      const p = String(agent.provider);
      const want = CANONICAL[p];
      expect(harnessCellText(renderRow(agent)), `row .ri-harness for ${p}`).toBe(want);
      expect(textOf(renderDrawer(agent)), `Inspector for ${p}`).toContain(want);
      const segText = textOf(segs[i]) + " " + String(segs[i].attributes["aria-label"] || "");
      expect(segText, `Mix segment for ${p}`).toContain(want);
    }
  });

  test("the Harness lens offers every provider under the canonical label", () => {
    /* Through the real axis and the real option builder. An earlier draft copied
       the facet's expression into the test and evaluated the copy, which proves
       the test can do arithmetic, not that the filter bar can. */
    const axis = M.LENS_AXES.find((a: { key: string }) => a.key === "provider");
    expect(axis, "the provider lens axis is gone").toBeTruthy();
    const ui = {
      ...M.state,
      snap: allProviderBoard(PROVIDERS),
      view: "board",
      lookbackHours: 24 * 365 * 20,
      showReviewWorkers: true,
      [axis.stateKey]: [],
    };
    const options = M.lensOptions(axis, ui);
    const byValue = new Map(options.map((o: { value: string; label: string }) => [o.value, o.label]));
    for (const p of PROVIDERS) {
      expect(byValue.has(p), `the Harness lens never offers ${p}`).toBe(true);
      expect(byValue.get(p), `the ${p} lens option leaked a raw key`).toBe(CANONICAL[p]);
    }
  });

  test("typing the harness label a row prints finds that row", () => {
    /* The operator reads "Gemini CLI" on the row and types it into search. The
       query haystack carries the raw provider key, so the label they can see
       finds nothing — unless the session happens to be named after it, which is
       exactly why these rows are named worker-N instead. */
    const rows = allProviderRows(PROVIDERS);
    const progName = "Synthetic board";
    const prog = { id: "prog_synthetic", name: progName, agents: rows };

    /* NEUTRALITY, PROVEN MECHANICALLY. Every searchable string is checked
       against every provider key and every canonical label. Eyeballing this is
       how "comparison" survived — it contains `omp`, so an OMP search matched
       all fourteen rows and the cross-provider negative below could never fail.
       If the inputs are not neutral, the positive assertions are worthless, so
       this runs first. */
    for (const agent of rows) {
      for (const s of searchableStrings(agent, progName)) {
        const low = s.toLowerCase();
        for (const key of PROVIDERS) {
          expect(low, `a searchable string "${s}" contains the provider key "${key}"`)
            .not.toContain(key);
        }
        for (const p of PROVIDERS) {
          expect(low, `a searchable string "${s}" seeds the label "${CANONICAL[p]}"`)
            .not.toContain(CANONICAL[p].toLowerCase());
        }
      }
    }

    /* Only then: the label an operator reads on the row must find that row, and
       the ONLY path left for it to travel is the real label seam. */
    for (const agent of rows) {
      const p = String(agent.provider);
      expect(M.matchesQuery(agent, prog, CANONICAL[p].toLowerCase()),
        `searching "${CANONICAL[p]}" does not find its own ${p} row`).toBe(true);
    }
  });

  test("search still says no to things the board does not have", () => {
    /* The negative half. Widening the haystack to carry the harness label is a
       one-line change, and the laziest passing version of it returns true for
       everything — `matchesQuery` could be made to answer yes and every
       assertion above would go green while search became useless. These are the
       assertions that fail when it does. */
    const rows = allProviderRows(PROVIDERS);
    const prog = { id: "prog_synthetic", name: "Synthetic board", agents: rows };
    const gemini = rows.find((r) => r.provider === "gemini")!;

    /* Unrelated ordinary words, not just nonsense strings: a matcher widened
       carelessly tends to answer yes to real vocabulary before it answers yes to
       gibberish. */
    for (const nonsense of [
      "zzzz-not-a-provider", "kilocode", "emacs", "9f3b7c1d-absent",
      "deployment", "invoice", "refactor the parser",
    ]) {
      expect(M.matchesQuery(gemini, prog, nonsense), `search matched "${nonsense}", which is on no row`)
        .toBe(false);
    }

    /* And one provider's label must not find another provider's row: a haystack
       that carried the whole catalog on every row would pass the positive test
       and make the Harness filter meaningless. */
    for (const agent of rows) {
      const own = String(agent.provider);
      for (const other of PROVIDERS) {
        if (other === own) continue;
        /* Skip labels that are substrings of the row's own label — "Pi" inside
           a longer word is a matcher artefact, not a leak. */
        if (CANONICAL[own].toLowerCase().includes(CANONICAL[other].toLowerCase())) continue;
        expect(
          M.matchesQuery(agent, prog, CANONICAL[other].toLowerCase()),
          `the ${own} row answers to "${CANONICAL[other]}"`,
        ).toBe(false);
      }
    }

    /* A providerless record answers to no harness label at all. */
    for (const p of PROVIDERS) {
      expect(
        M.matchesQuery(R20_MISSING_PROVIDER, prog, CANONICAL[p].toLowerCase()),
        `the providerless row answers to "${CANONICAL[p]}"`,
      ).toBe(false);
    }
  });

  test("docs/PARITY.md carries one delimited key-to-label table that matches the code", () => {
    /* `toContain` was worthless here: "Pi" appears in "Pi session", "Codex" in
       every Codex paragraph, and the assertion passed on prose that stated no
       catalog at all. The ledger has to carry ONE table, uniquely delimited, and
       it is parsed and compared key by key. */
    const table = parityDoc.match(
      /<!--\s*harness-labels:begin\s*-->([\s\S]*?)<!--\s*harness-labels:end\s*-->/,
    );
    expect(table, "docs/PARITY.md has no <!-- harness-labels:begin --> … :end block").toBeTruthy();
    const occurrences = parityDoc.match(/<!--\s*harness-labels:begin\s*-->/g) || [];
    expect(occurrences.length, "the harness-labels block is declared more than once").toBe(1);

    const parsed = new Map<string, string>();
    const seen: string[] = [];
    for (const line of table![1].split("\n")) {
      const cells = line.match(/^\s*\|\s*`([a-z]+)`\s*\|\s*([^|]+?)\s*\|\s*$/);
      if (!cells) continue;
      seen.push(cells[1]);
      parsed.set(cells[1], cells[2]);
    }
    /* A duplicate row is how a table drifts from the code while still parsing:
       two `claude` rows disagreeing, and the Map silently keeps the last. */
    const duplicates = seen.filter((k, i) => seen.indexOf(k) !== i);
    expect(duplicates, `docs/PARITY.md lists ${duplicates.join(", ")} more than once`).toEqual([]);
    expect(seen.length, "the table's row count does not match its distinct keys").toBe(parsed.size);

    expect([...parsed.keys()].sort(), "the documented roster is not the code's roster")
      .toEqual([...PROVIDERS].sort());
    for (const p of PROVIDERS) {
      expect(parsed.get(p), `docs/PARITY.md documents ${p} as "${parsed.get(p)}"`).toBe(CANONICAL[p]);
    }
  });
});

/* ================= FE-5a — the Mix reading ================= */

function renderMixOf(mixProviders: Array<{ prov: string; n: number }>) {
  return withDom(() => {
    M.state.view = "board";
    return M.renderSummaryWidget("mix", "normal", { mixProviders, value: "" });
  });
}

const renderMix = () => renderMixOf(R21_MIX_PROVIDERS);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mixSegments(node: any): any[] {
  return walk(node).filter((n) => String(n.className || "").split(/\s+/).includes("mix-seg"));
}

describe("FE-5a a Mix segment keeps its provider name when the visible text collapses", () => {
  test("the rule that removes the visible name at 900px is still present", () => {
    /* If this ever stops being true, the two tests below are guarding a problem
       that no longer exists and should be re-read rather than deleted. */
    /* Comments stripped first: the same declaration written inside a block
       comment would satisfy a raw-text match, and this test's whole job is to
       confirm a LIVE rule still exists. */
    expect(stripCssComments(styles), "the 900px .prov-name fold is gone — re-read FE-5a")
      .toMatch(/@media \(max-width: 900px\) \{[^@]*\.mix-seg \.prov-name \{[^}]*display:\s*none/);
  });

  test("all fourteen segments carry an aria-label with the canonical label and count", () => {
    /* At 900px and below — which includes BOTH the 720 and 390 screenshot
       viewports — the visible name is display:none and the segment is left as a
       bare integer. A screen reader reads the whole Mix as "3 2 1 1 5 2 1".

       `title` is NOT accepted here. A tooltip needs a pointer that a touch or
       keyboard operator does not have, and it is precisely the affordance FE-3
       is being fixed for elsewhere in this same slice; accepting it here would
       let the board answer one accessibility question two contradictory ways. */
    const mixed = PROVIDERS.map((p, i) => ({ prov: p, n: i + 1 }));
    const segs = mixSegments(renderMixOf(mixed));
    expect(segs.length, "the Mix dropped a provider").toBe(PROVIDERS.length);
    for (const [i, seg] of segs.entries()) {
      const { prov, n } = mixed[i];
      const label = TF.providerLabel(prov);

      /* The VISIBLE name is exactly the canonical label — not a truncation, not
         the raw key, not the label with something appended. This is the string
         the ≤900px rule removes, and the aria-label has to reinstate it. */
      const visible = walk(seg).find((n2) => String(n2.className || "").split(/\s+/).includes("prov-name"));
      expect(visible, `the ${prov} segment has no .prov-name`).toBeTruthy();
      expect(textOf(visible), `the ${prov} segment's visible name`).toBe(label);

      const name = String(seg.attributes["aria-label"] || "");
      expect(name, `the ${prov} Mix segment has no aria-label`).toBeTruthy();
      expect(name, `the ${prov} Mix segment's name omits its label`).toContain(label);

      /* The segment ROOT must survive on both channels. The ≤900px rule folds
         the visible `.prov-name` away, and the cheapest way to "fix" the
         accessible name is to hide the whole segment from one audience — an
         aria-hidden segment reads to nobody, a display:none one shows to
         nobody, and either satisfies a name-only check. */
      expect(carrierHidden(seg), `the ${prov} Mix segment root is hidden from one audience`)
        .toBe(false);
      expect(a11yTextOf(seg), `the ${prov} Mix segment contributes nothing to the accessibility tree`)
        .not.toBe("");
      expect(visibleTextOf(seg), `the ${prov} Mix segment renders nothing visible`).not.toBe("");

      /* BOUNDED count grammar: the accessible name must carry this segment's
         count and no other number. `toContain("1")` passes on "11", on a stray
         percentage, and on the label of a different segment — so the digits are
         extracted and compared as a set. */
      const digits = name.replace(label, " ").match(/\d+/g) || [];
      expect(digits, `the ${prov} segment's name carries numbers ${digits.join(",")} instead of just ${n}`)
        .toEqual([String(n)]);
    }
  });

  test("a re-rendered Mix names the new count, not the one it first painted", () => {
    /* An accessible name computed once and cached to the node would read
       correctly on the first paint and lie on every one after it — the failure
       mode a name assembled from live data cannot have, and the reason this is
       asserted rather than assumed. The board repaints the Mix on every
       snapshot. */
    const label = TF.providerLabel("gemini");
    const digitsOf = (seg: { attributes: Record<string, string> }) =>
      (String(seg.attributes["aria-label"] || "").replace(label, " ").match(/\d+/g) || []);

    const before = mixSegments(renderMixOf([{ prov: "gemini", n: 5 }]))[0];
    expect(digitsOf(before), "the first paint does not announce its count").toEqual(["5"]);

    const after = mixSegments(renderMixOf([{ prov: "gemini", n: 9 }]))[0];
    expect(digitsOf(after), "the re-rendered segment kept a stale count").toEqual(["9"]);

    /* And the visible text moved with it, so the two carriers cannot disagree. */
    const visible = walk(after).find((n2) => String(n2.className || "").split(/\s+/).includes("prov-name"));
    expect(textOf(visible)).toBe(label);
    expect(textOf(after), "the visible segment text disagrees with its accessible name").toContain("9");
  });

  test("two providers never share one swatch appearance AND one absent name", () => {
    /* CSS-side companion to the DOM checks above: the segment ROOT must survive
       the 900px fold, read through the same live full-stylesheet cascade the
       FE-4 audit uses. The DOM cannot see a stylesheet rule that removes the
       segment at exactly the width the fold applies, which is the width FE-5a
       is about. */
    const at900 = (sheet: string, sel: string, prop: string) =>
      winningDeclaration(sheet, 900, sel, prop);

    /* CSS keywords are case-insensitive and `opacity` is a number, not a
       string. Comparing raw values let `display: NONE`, `visibility: Hidden`
       and `opacity: 0.0` hide the Mix while every check read them as different
       from the forbidden literal. Keywords are trimmed and lowercased; opacity
       is parsed and compared as a number. */
    const segHidden = (sheet: string): string | null => {
      const keyword = (prop: string) => {
        const v = at900(sheet, ".mix-seg", prop).value;
        return v === null ? null : v.trim().toLowerCase();
      };
      if (keyword("display") === "none") return "display:none";
      const vis = keyword("visibility");
      if (vis === "hidden" || vis === "collapse") return `visibility:${vis}`;
      const raw = at900(sheet, ".mix-seg", "opacity").value;
      if (raw !== null) {
        /* `opacity` accepts a number OR a percentage, and they mean the same
           alpha: `0%` is as invisible as `0`. Parsing only `Number(raw)` made
           `0%` NaN, which is not finite, so a fully transparent segment read as
           visible. */
        const text = raw.trim();
        const pct = text.match(/^([+-]?(?:\d+\.?\d*|\.\d+))\s*%$/);
        const alpha = pct ? Number(pct[1]) / 100 : Number(text);
        if (Number.isFinite(alpha) && alpha === 0) return `opacity:${text}`;
      }
      return null;
    };

    for (const prop of ["display", "visibility", "opacity"]) {
      const { unclassified } = at900(styles, ".mix-seg", prop);
      expect(unclassified,
        `an unclassifiable context writes ${prop} for .mix-seg: ${unclassified.join("; ")}`).toEqual([]);
    }
    expect(segHidden(styles),
      "the Mix segment root is hidden at 900px — the whole reading disappears").toBeNull();

    /* Each mutant edits the FULL stylesheet and goes through the same call,
       in the casing and numeric form a real stylesheet may legitimately use. */
    expect(segHidden(styles + `\n@media (max-width: 900px) { .mix-seg { display: NONE; } }`),
      "an upper-case display:NONE was not detected").toBe("display:none");
    expect(segHidden(styles + `\n@media (max-width: 900px) { .mix-seg { visibility: Hidden; } }`),
      "a mixed-case visibility:Hidden was not detected").toBe("visibility:hidden");
    expect(segHidden(styles + `\n@media (max-width: 900px) { .mix-seg { opacity: 0.0; } }`),
      "a numeric opacity:0.0 was not detected").toBe("opacity:0.0");
    expect(segHidden(styles + `\n@media (max-width: 900px) { .mix-seg { opacity: 0%; } }`),
      "a percentage opacity:0% was not detected").toBe("opacity:0%");
    expect(segHidden(styles + `\n@media (max-width: 900px) { .mix-seg { opacity: 0.00%; } }`),
      "a percentage opacity:0.00% was not detected").toBe("opacity:0.00%");
    expect(segHidden(styles + `\n@media (max-width: 900px) { .mix-seg { visibility: collapse; } }`),
      "visibility:collapse was not detected").toBe("visibility:collapse");
    /* A non-zero alpha is not hiding, in either notation. */
    expect(segHidden(styles + `\n@media (max-width: 900px) { .mix-seg { opacity: 0.5; } }`),
      "a partially transparent segment was reported as hidden").toBeNull();
    expect(segHidden(styles + `\n@media (max-width: 900px) { .mix-seg { opacity: 50%; } }`),
      "a 50% opaque segment was reported as hidden").toBeNull();

    /* The existing `.prov-name` fold stays allowed — it hides the NAME, not the
       segment, which is exactly why the aria-label has to carry it. */
    expect(at900(styles, ".prov-name", "display").value,
      "the .prov-name responsive fold is gone — re-read FE-5a").toBe("none");

    /* .prov-dot.is-* is defined for claude/codex/cursor/omp (plus prime, which
       resolves to the default slate). Every other provider renders the identical
       square. That is tolerable only while each segment still says which
       provider it is. */
    const coloured = new Set(
      [...styles.matchAll(/\.prov-dot\.is-([a-z-]+)\s*\{/g)].map((m) => m[1]),
    );
    const mixed = PROVIDERS.map((p, i) => ({ prov: p, n: i + 1 }));
    const segs = mixSegments(renderMixOf(mixed));
    const mute = segs
      .map((seg, i) => ({ prov: mixed[i].prov, named: Boolean(seg.attributes["aria-label"]) }))
      .filter((s) => !coloured.has(s.prov) && !s.named)
      .map((s) => s.prov);
    expect(
      mute,
      `${mute.join(", ")} share the default swatch and carry no accessible name, so they are one undifferentiated square`,
    ).toEqual([]);
  });
});

/* ================= FE-5b — the Inspector's provider channel ================= */

describe("FE-5b the Inspector channel is provider-specific or a declared shared fallback", () => {
  /* The PUBLIC proof is the rendered drawer for all fourteen providers. The
     stylesheet and ledger reads below are SUPPORT only: they answer "was the
     shared fallback declared on purpose", which no rendered node can show,
     and they are scoped so a colour named in a comment cannot satisfy them. */

  /** The classes on the pane ROOT — not anywhere in its subtree. The channel is
   *  painted by `.pane-inspector.dw-provider`, an inset box-shadow on the pane
   *  itself, so a class landing on some descendant paints nothing. Searching the
   *  whole subtree would report that mutation as correct. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rootClasses = (pane: any) => String(pane.className || "").split(/\s+/).filter(Boolean);

  test("every provider's drawer root carries EXACTLY the base classes plus its own suffix", () => {
    /* An exact set, not containment. Containment passes on a root that also
       carries a stale `dw-provider--claude` from a previous selection, or an
       extra variant class that paints a different rail — and a drawer wearing
       two provider suffixes resolves --prov by source order, which is not a
       decision anyone made. */
    for (const agent of allProviderRows(PROVIDERS)) {
      const cls = rootClasses(renderDrawer(agent)).sort();
      expect(cls, `${agent.provider} drawer root class set`)
        .toEqual(["dw-agent", "dw-provider", "dw-provider--" + agent.provider].sort());
    }
  });

  test("an unknown provider gets the base classes and NO provider suffix at all", () => {
    const unknown = rootClasses(renderDrawer(R20_MISSING_PROVIDER)).sort();
    expect(unknown.filter((c) => c.startsWith("dw-provider--")),
      "an unrecorded provider still produced a provider-suffixed class").toEqual([]);
    expect(unknown, "the unknown drawer root class set").toEqual(["dw-agent", "dw-provider"]);
    expect(classNames(renderDrawer(R20_MISSING_PROVIDER)).some((c) => /dw-provider--undefined/.test(c)))
      .toBe(false);
  });

  test("support: the shared fallback is declared, and declared about THESE providers", () => {
    /* Comments stripped first — a `--prov` written inside a block comment is
       documentation, not a rule, and matching it would let a note stand in for a
       declaration. */
    const sheet = stripCssComments(styles);
    /* Discovered through the exact selector API, not a regex over the sheet.
       The regex matched `--prov` anywhere inside the braces, including inside a
       `var(--prov, …)` REFERENCE, so a provider that merely READ the variable
       counted as having declared its own colour. */
    const declared = new Set(
      PROVIDERS.filter((p) => effectiveProp(sheet, ".dw-provider--" + p, "--prov") !== null),
    );
    /* The literal set, written down. Deriving BOTH sides from the stylesheet
       lets docs and CSS drift together in lockstep and still agree — the one
       failure a cross-check exists to catch. This is the roster with no
       `--prov` rule of its own today; changing it is a deliberate edit here. */
    const EXPECTED_FALLBACK = [
      "antigravity", "copilot", "factory", "gemini", "grok",
      "hermes", "muse", "opencode", "pi", "prime",
    ];
    const uncovered = PROVIDERS.filter((p) => !declared.has(p));
    expect([...uncovered].sort(), "the set of providers relying on the shared channel changed")
      .toEqual([...EXPECTED_FALLBACK].sort());

    /* The fallback has to be attached to the selectors that actually PAINT the
       channel, at rest, and via the property that draws it — an inset
       box-shadow. `--prov` resolving somewhere in the sheet proves nothing
       about whether a rail appears. */
    /* EXACT normalized selectors, not substrings. `.pane-inspector.dw-provider`
       as a regex also matches `.pane-inspector.dw-provider.is-wide` and
       `.foo .pane-inspector.dw-provider`, either of which could declare the rail
       for one variant while the base pane lost it. The rule is found by
       comparing the normalized selector for equality. */
    for (const selector of [".pane-inspector.dw-provider", ".dw-provider .drawer-session-facts"]) {
      /* The EFFECTIVE box-shadow for that exact root selector. Three mutations
         this rejects, each of which leaves a rail-shaped string in the file
         while painting no channel:
           - a later `box-shadow: none` on the same selector;
           - `--box-shadow: inset ...`, a custom property that paints nothing;
           - an inset shadow that does not resolve --prov, or an OUTER shadow
             (no `inset`), which draws a border rather than the channel. */
      /* The rail grammar pinned LITERALLY, as the effective last declaration for
         the exact root selector. Each mutation fails on the value itself: a
         later `box-shadow: none`, a `--box-shadow` custom property that paints
         nothing, an arbitrary offset, an outer (non-inset) shadow that draws a
         border rather than a channel, and an extra comma-separated layer that
         could cover the rail. */
      expect(selectRules(sheet, selector).length, `no rule names exactly "${selector}"`)
        .toBeGreaterThan(0);
      expect(effectiveProp(sheet, selector, "box-shadow"),
        `${selector} does not paint the intended rail`)
        .toBe("inset 3px 0 var(--prov, var(--line-strong))");
    }

    /* The fallback POLICY, stated once: the shared colour is what --prov
       resolves to when no provider rule sets it. A stylesheet that gave every
       provider a colour would make the fallback dead code, and this is where
       that shows up as a deliberate decision rather than an accident. */
    expect(uncovered.length, "no provider relies on the shared channel any more")
      .toBeGreaterThan(0);

    if (uncovered.length) {
      const scoped = parityDoc.match(
        /<!--\s*harness-channel:begin\s*-->([\s\S]*?)<!--\s*harness-channel:end\s*-->/,
      );
      expect(
        scoped,
        `providers ${uncovered.join(", ")} have no --prov rule, so docs/PARITY.md must declare the shared Inspector channel in a <!-- harness-channel --> block`,
      ).toBeTruthy();
      expect(scoped![1], "the channel block does not say the fallback is shared").toMatch(/shared/i);
      /* It must name EXACTLY the providers relying on the fallback, parsed as
         backticked tokens and never as substrings: `toContain("pi")` is
         satisfied by the word "copilot", so a ledger that forgot Pi entirely
         would still have passed. Documented set and uncovered set must match —
         no missing provider, and no stale one left behind after a provider
         gains a colour of its own. */
      const documented = [...scoped![1].matchAll(/`([a-z]+)`/g)].map((m) => m[1]);
      expect([...new Set(documented)].sort(), "the documented fallback set is not the uncovered set")
        .toEqual([...EXPECTED_FALLBACK].sort());
    }
  });
});

/* ================= row parity across the two cohorts ================= */

/** The row's structural signature: which instrument cells exist, in order.
 *  Values differ per provider by design; the SHAPE must not. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function topology(row: any): string[] {
  const instruments = findClass(row, "row-instruments");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((instruments?.children || []) as any[])
    .map((c) => String(c.className || "").split(/\s+/).filter((x) => x.startsWith("ri-") || x === "row-state").join("."))
    .filter(Boolean);
}

describe("the integrated cohort renders the same row grammar as the legacy cohort", () => {
  /** A normalized behavioral signature for one rendered row.
   *
   *  Topology alone compared which instrument cells exist. That misses every
   *  way two rows can differ while carrying the same cells: a different root
   *  element, a row that is not focusable, a focus key shaped differently, an
   *  accessible name missing a whole clause, or a control surface that appears
   *  for one harness and not another.
   *
   *  Missing nodes are recorded as `null`, never dropped. A signature that
   *  omitted absent cells would make "this row has no tokens cell" and "this row
   *  was never asked about tokens" the same string — normalizing away exactly
   *  the difference the comparison exists to find. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function signature(row: any): Record<string, unknown> {
    const keyed = walk(row).find((n) => n.dataset && n.dataset.fkey);
    const name = String(row.attributes["aria-label"] || "");
    /* The clause SHAPE, not the values: every row's name is a sequence of
       "Label: value." clauses, and the labels are the contract. */
    const clauses = (name.match(/(?:^|\.\s)([A-Z][A-Za-z/ ,-]*?):/g) || [])
      .map((c) => c.replace(/^[.\s]*/, "").replace(/:$/, ""));
    return {
      tag: row.tagName,
      role: row.attributes.role ?? null,
      tabindex: row.attributes.tabindex ?? null,
      fkeyShape: keyed ? String(keyed.dataset.fkey).replace(/:.*$/, ":<id>") : null,
      clauses,
      instruments: topology(row),
      /* Control topology: which control affordances the row offers at all. */
      controls: walk(row)
        .filter((n) => n.dataset && typeof n.dataset.fkey === "string")
        .map((n) => String(n.dataset.fkey).replace(/:.*$/, ":<id>"))
        .sort(),
      marks: walk(row)
        .filter((n) => String(n.className || "").includes("provider-mark"))
        .map((n) => (n.tagName === "img" ? "img" : "text"))
        .sort(),
    };
  }

  test("both cohorts, complete, render one behavioral signature", () => {
    /* An earlier draft compared every integrated row against LEGACY_COHORT[0]
       alone, which proved the integrated cohort agrees with ONE legacy row and
       said nothing about whether the legacy cohort agrees with itself. Had Codex
       and Cursor drifted apart, the comparison would still have passed by
       picking Claude as the reference. Both cohorts are now compared entire, and
       the legacy set is checked for internal agreement FIRST so a split there is
       reported as a legacy defect rather than as an integration one. */
    const legacy = LEGACY_COHORT.map((a) => ({ p: String(a.provider), t: signature(renderRow(a)) }));
    const integrated = INTEGRATED_COHORT.map((a) => ({ p: String(a.provider), t: signature(renderRow(a)) }));

    expect(legacy.length, "the legacy cohort is too small to compare").toBeGreaterThan(1);
    expect(integrated.length, "the integrated cohort is too small to compare").toBeGreaterThan(1);

    /* The signature is a RECORD. An earlier draft asked it for `.length`, which
       is `undefined` on an object — an assertion that could never pass and never
       named a product defect. Substance is proven field by field below. */
    const reference = legacy[0].t;
    /* The reference must itself be substantive — an empty signature would make
       every comparison below vacuously true. */
    expect((reference.instruments as string[]).length, "the reference row rendered no instruments")
      .toBeGreaterThan(0);
    expect((reference.clauses as string[]).length, "the reference row's accessible name has no clauses")
      .toBeGreaterThan(3);
    expect(reference.tabindex, "the reference row is not focusable").toBe("0");

    for (const { p, t } of legacy) {
      expect(t, `the LEGACY cohort disagrees with itself: ${p} differs from ${legacy[0].p}`).toEqual(reference);
    }
    for (const { p, t } of integrated) {
      expect(t, `integrated row signature for ${p}`).toEqual(reference);
    }
  });

  test("each row wears both marks and names both in one accessible group", () => {
    for (const agent of INTEGRATED_COHORT) {
      const row = renderRow(agent);
      const group = findClass(row, "dual-marks");
      expect(group, `${agent.provider} row has no dual-marks group`).toBeTruthy();
      expect(group.attributes.role).toBe("group");
      const name = String(group.attributes["aria-label"] || "");
      expect(name, `${agent.provider} dual-marks name`).toContain("Harness");
      expect(name, `${agent.provider} dual-marks name`).toContain("Agent");
    }
  });

  test("the official marks are used and no mark is invented", () => {
    const want: Record<string, string> = {
      gemini: "/icons/gemini-cli.svg",
      opencode: "/icons/opencode.svg",
      pi: "/icons/pi.svg",
      claude: "/icons/claude-code.svg",
    };
    for (const agent of INTEGRATED_COHORT) {
      const row = renderRow(agent);
      const mark = walk(row).find((n) => String(n.className || "").includes("harness-mark"));
      expect(mark.attributes.src, `${agent.provider} harness mark`).toBe(want[String(agent.provider)]);
    }
  });

  test("a long label clamps rather than reflows, for every affected provider", () => {
    /* Topology alone was not enough: it says the same cells exist, not that the
       long string was clamped rather than printed whole and left to push its
       neighbours. Each provider is RENDERED — a clamp proven on Gemini is not
       proven on Pi, whose label is nine characters shorter before a model
       string is added. */
    const reference = topology(renderRow(R2_GEMINI_WORKING));
    for (const p of ["claude", "codex", "cursor", "omp", "gemini", "opencode", "pi"]) {
      const long = renderRow(longLabelRow(p));
      expect(topology(long), `${p}'s long-label row changed shape`).toEqual(reference);

      /* The harness cell still prints exactly the canonical label — a long
         model or name must not bleed into, truncate, or displace it. */
      expect(harnessCellText(long), `${p}'s harness cell moved under a long label`)
        .toBe(TF.providerLabel(p));

      /* And the model cell is clamped by modelShort's own bound rather than
         printed at full length. */
      const model = findClass(long, "ri-model");
      expect(model, `${p}'s long-label row lost its model cell`).toBeTruthy();
      expect(textOf(model).length, `${p}'s model cell printed an unclamped string`)
        .toBeLessThanOrEqual(18);
    }

    /* The clamp is a real declaration, not an emergent property of the fixture's
       string lengths. These two rules are what stop a long name or a long model
       from widening its track and shoving its neighbours; without them the
       length assertions above would still pass on a board that reflowed. */
    const sheet = stripCssComments(styles);
    expect(sheet, ".agent-name lost the clamp that keeps a long session name in its track")
      .toMatch(/\.agent-name\b[^{]*\{[^}]*(text-overflow:\s*ellipsis|overflow:\s*hidden)/);
    expect(sheet, ".ri-value lost the clamp that keeps a long instrument value in its cell")
      .toMatch(/\.ri-value\b[^{]*\{[^}]*(text-overflow:\s*ellipsis|overflow:\s*hidden)/);
    expect(sheet, "the identity cell can no longer shrink, so a long name pushes instead of clamping")
      .toMatch(/\.row-identity\b[^{]*\{[^}]*min-width:\s*0/);
    /* And as an effective-last read, so a later `min-width: auto` — which
       restores the content floor and lets a long name push its neighbours
       again — is what the audit reports. */
    expect(effectiveProp(sheet, ".row-identity", "min-width"),
      "the identity cell can no longer shrink").toBe("0");
    expect(effectiveProp(sheet + `\n.row-identity { min-width: auto; }`, ".row-identity", "min-width"),
      "a later min-width:auto did not override the clamp").toBe("auto");

    /* The clamp is three declarations working together, and all three are
       required: without `nowrap` a long label wraps to a second line instead of
       clamping, without `overflow: hidden` it spills past its track, and without
       `text-overflow: ellipsis` it is cut mid-glyph with nothing to say it was
       truncated. Pinning only one of the three lets the other two be dropped. */
    /* The clamp read as an effective property MAP for each exact selector. A
       later `white-space: normal`, `overflow: visible` or `text-overflow: clip`
       is what the audit reports, and a `--white-space` lookalike satisfies
       nothing because the map is keyed by the literal property name. */
    for (const [selector, label] of [
      [".agent-name", "the session name"],
      [".ri-value", "an instrument value"],
    ] as const) {
      expect(selectRules(sheet, selector).length, `${selector} no longer exists as a rule of its own`)
        .toBeGreaterThan(0);
      const props = effectiveProps(sheet, selector);
      expect(props.get("white-space"), `${label} may now wrap instead of clamping`).toBe("nowrap");
      expect(props.get("overflow"), `${label} may now spill past its track`).toBe("hidden");
      expect(props.get("text-overflow"), `${label} is truncated with no ellipsis to show it`)
        .toBe("ellipsis");
    }
  });
});

/* ================= unknown fields stay unknown ================= */

describe("an unreported figure is absent, never zero", () => {
  test("R14 · a known context window with no observed total renders no percent", () => {
    const row = renderRow(R14_GEMINI_UNKNOWN_USAGE);
    const ctx = findClass(row, "ri-ctx");
    expect(ctx, "the context cell vanished entirely").toBeTruthy();
    expect(String(ctx.className)).toContain("is-unknown");

    /* EXACT, on both channels, ancestor-aware. The dash is what a sighted
       operator sees; the accessible name is what a screen reader hears. Neither
       may carry a percentage, and neither may be the other's job. */
    expect(carrierHidden(ctx), "the context cell cannot be read by both audiences").toBe(false);
    expect(visibleTextOf(ctx), "the context cell's visible reading is not the unknown dash")
      .toBe("—");
    expect(String(ctx.attributes["aria-label"] || ""),
      "the context cell's accessible name is not the exact unreported reading")
      .toBe("Context: not reported");
    for (const surface of [
      visibleTextOf(ctx), a11yTextOf(ctx),
      String(ctx.attributes["aria-label"] || ""), String(ctx.attributes.title || ""),
    ]) {
      expect(surface, `a context percentage appeared in "${surface}"`).not.toMatch(/\d+(\.\d+)?\s*%/);
    }
    /* The dash is the closed grid's unknown INDICATOR, not a measurement. What
       must never appear is a number: 0%, or a percent invented from the window
       with no observed total to divide into it. */
    expect(textOf(ctx)).toBe("—");
    expect(textOf(ctx)).not.toMatch(/\d/);

    /* A dash is invisible to a screen reader, so the accessible name has to say
       the word. An earlier draft only rejected "0%" here, which a name reading
       "Context %: " — announcing a label and then nothing — would have passed. */
    const name = String(ctx.attributes["aria-label"] || "");
    expect(name, "the context cell has no accessible name").toBeTruthy();
    expect(name, `the context cell announces "${name}" without saying the value is unknown`)
      .toMatch(/not reported|unknown|unavailable/i);

    /* And no percent of ANY magnitude, on any of the cell's three carriers —
       not 0%, and not one invented by dividing into a window with no observed
       total to divide. */
    for (const surface of [textOf(ctx), name, String(ctx.attributes.title || "")]) {
      expect(surface, `a context percent appeared in "${surface}"`).not.toMatch(/\d+(\.\d+)?\s*%/);
    }
    /* And no counts were reported, so the tokens cell is omitted outright. */
    expect(findClass(row, "ri-tokens"), "a cell was drawn for tokens nobody reported").toBeNull();

    /* POSITIVE reading, not only the absence of a percent. A drawer that simply
       omitted the context row entirely would satisfy every "no %" assertion
       while telling the operator nothing — silence and "not reported" look the
       same to a negative check and completely different to a person. */
    const ctxName = String(ctx.attributes["aria-label"] || "");
    expect(ctxName, "the row's context cell does not positively report the unknown")
      .toMatch(/not reported|unknown|unavailable/i);

    /* The Inspector is a second surface with its own composition, and an
       unreported occupancy has to stay unreported there too — a drawer that
       divided the known window by nothing and printed 0% would be the same
       fabrication one panel over. */
    const drawer = renderDrawer(R14_GEMINI_UNKNOWN_USAGE);
    /* The Inspector must SAY the occupancy is unreported, in its own context
       fact, rather than merely decline to print a number. */
    /* The EXACT node must exist and carry its own targeted reading. An earlier
       draft fell back to scanning the whole drawer, which let any sentence
       anywhere on the panel — the process line, an eyebrow, a hint — satisfy a
       claim about the context fact. And it accepted a bare dash, which is
       invisible to a screen reader: the fact has to say the word. */
    const drawerCtx = findClass(drawer, "drawer-session-context");
    expect(drawerCtx, "the Inspector publishes no context fact for a session whose window is known")
      .toBeTruthy();
    /* The fact is a dt/dd PAIR. Reading the whole node lets the label satisfy a
       claim about the value: "Context" contains no percent and says nothing
       unknown, so a dd that had gone silent would still pass. Both halves are
       identified and the VALUE is what carries the reading. */
    /* Exactly one pair, correct tags, in order. A fact rendered as two divs, or
       with a second dd appended, is not the dt/dd contract the drawer's <dl>
       announces, and a reader taking children[0]/[1] positionally would not
       notice either. */
    const kids = (drawerCtx.children || []) as Array<{ tagName: string }>;
    expect(kids.length, "the context fact is not a single label/value pair").toBe(2);
    const [ctxDt, ctxDd] = kids;
    expect(String(ctxDt.tagName).toLowerCase(), "the context label is not a <dt>").toBe("dt");
    expect(String(ctxDd.tagName).toLowerCase(), "the context value is not a <dd>").toBe("dd");
    expect(textOf(ctxDt), "the context fact's label changed").toBe("Context");

    /* The VISIBLE value first, exactly. An accessible name saying "unknown"
       over a dd printing "0" is the worst of both: sighted operators read a
       measurement, screen-reader users hear an absence, and a check that ORed
       the two carriers together would pass. */
    /* VISIBLE text, ancestor-aware. A dd whose value is correct but which sits
       inside a hidden wrapper reads as nothing on screen, and a self-only check
       would certify it. */
    expect(carrierHidden(ctxDd), "the context value cannot be read by both audiences").toBe(false);
    expect(visibleTextOf(ctxDd), "the context value is not the honest unreported reading")
      .toBe("not reported");
    /* BOTH CHANNELS. A drawer that put "not reported" in an aria-hidden child
       and left the dd visually empty would satisfy a visible-only check while
       telling a screen-reader user nothing, and vice versa. */
    expectBoth(ctxDd, "not reported", "the Inspector's context value");

    const ctxValue = textOf(ctxDd) + " " + accessibleStrings(ctxDd).join(" ");
    expect(ctxValue, "the context VALUE does not say the occupancy is unreported")
      .toMatch(/not reported|unknown|unavailable/i);
    expect(ctxValue, "the context value borrowed a percentage it cannot have")
      .not.toMatch(/\d+(\.\d+)?\s*%/);
    for (const surface of [textOf(drawer), ...accessibleStrings(drawer)]) {
      expect(surface, `the Inspector printed a context percent in "${surface}"`)
        .not.toMatch(/\d+(\.\d+)?\s*%/);
      expect(surface, "the Inspector printed a price for a session with no cost reading")
        .not.toContain("$");
    }
  });

  test("R11 · an observed zero renders as the literal reading it is", () => {
    /* An observed all-zero counter block is EVIDENCE: the source counted and
       found none. The row must print that zero rather than answer "not
       reported" about numbers it was handed — the board discarding a real
       reading is the same class of dishonesty as inventing one, pointed the
       other way.

       The counter-case stays intact: a block with `unknown` provenance, or one
       carrying no counters at all, is absence and still reads as absence. That
       distinction is pinned as a unit in tests/web-client.test.ts; this pins it
       where an operator actually meets it. */
    const row = renderRow(R11_OPENCODE_CHILD);
    const tokens = findClass(row, "ri-tokens");

    expect(tokens, "the row dropped an observed reading entirely").toBeTruthy();
    expect(textOf(tokens), "an observed zero was not rendered as 0").toBe("0");

    const name = String(tokens.attributes["aria-label"] || "");
    expect(name, "the tokens cell has no accessible name").toBeTruthy();
    expect(name, "the accessible name does not carry the observed zero").toBe("Tokens: 0");
    /* BOTH CHANNELS from the cell itself: a "0" parked in an aria-hidden child
       is legible and silent; one in a .visually-hidden child is the reverse. */
    expect(carrierHidden(tokens), "R11's token cell cannot be read by both audiences").toBe(false);
    expectBoth(tokens, "0", "R11's observed-zero token reading");
    /* Not a dash: in a column of magnitudes a dash reads as "unmeasured", which
       is the opposite of what an observed zero means. */
    expect(textOf(tokens)).not.toBe("—");
    expect(textOf(tokens)).not.toMatch(/not reported/i);

    /* The absence guarantees still hold — a rendered zero count is not licence
       to invent a zero PRICE or a zero PERCENT, which nobody measured. */
    for (const surface of [textOf(row), textOf(renderDrawer(R11_OPENCODE_CHILD))]) {
      expect(surface, "per-row USD is unavailable for every harness under I-110").not.toContain("$");
      expect(surface, "an unreported context percent was invented").not.toMatch(/\b0\s*%/);
    }
    expect(String(findClass(row, "ri-ctx")?.className)).toContain("is-unknown");
  });

  test("R13 · a session with observed counters shows them without a percent or a price", () => {
    /* `sessionProcessed` (568) is carried on the wire and has NO client render
       path — it appears in src/web/app.js only inside a comment. So this asserts
       what the client actually draws: an honestly unknown context and no price.
       It deliberately does NOT demand that 568 be rendered; that would be a
       request for a figure the board has never drawn, not a regression against
       the harness-parity contract.

       The claim that `callSizes` never reaches a snapshot also moved out of
       here: asserting it about a hand-written fixture proves only that the
       fixture omits it. That boundary belongs to the snapshot publisher. */
    const row = renderRow(R13_OPENCODE_USAGE);
    const drawer = renderDrawer(R13_OPENCODE_USAGE);

    expect(String(findClass(row, "ri-ctx")?.className),
      "a context percent appeared for a session that reported no window occupancy").toContain("is-unknown");
    expect(textOf(row), "per-row USD is unavailable for every harness under I-110").not.toContain("$");
    expect(textOf(drawer), "the Inspector printed a price").not.toContain("$");
    /* The processed total must never be presented AS consumption: they are
       different units (568 counts cache re-reads, 557 does not), and printing
       one under the other's label is the sessionTotal disease this ledger
       already names. */
    /* Checking the whole row's text would let 568 hide inside any other string,
       so this reads the token cell ITSELF: its value, its accessible name and
       its hover text are the three places a number can claim to be the
       session's consumption. */
    const tokens = findClass(row, "ri-tokens");
    /* The cell must EXIST. An `if (tokens)` guard let the whole assertion
       evaporate the moment a mutation stopped rendering the cell — the strongest
       possible way to pass a test about what a cell says. This session reported
       three real counters, so a row that draws nothing has dropped them. */
    expect(tokens, "the row drew no token cell for a session that reported counters").toBeTruthy();

    const value = textOf(tokens);
    const name = String(tokens.attributes["aria-label"] || "");
    const title = String(tokens.attributes.title || "");

    /* The exact honest reading: the three counters the source published, in the
       order the row composes them. No total was reported, so no total is shown. */
    expect(value, "the row's token reading is not the counters the source published")
      .toBe("in 120 · out 30 · cache 400");
    expect(carrierHidden(tokens), "R13's row token cell cannot be read by both audiences").toBe(false);
    expectBoth(tokens, "in 120 · out 30 · cache 400", "R13's row token reading");
    expect(name, "the token cell's accessible name does not carry the reading")
      .toBe("Tokens: in 120 · out 30 · cache 400");

    /* And 568 may not appear as consumption in either carrier. */
    expect(value, "the row's token reading is the processed total wearing a consumption label")
      .not.toContain("568");
    expect(name, "the accessible name announces the processed total as tokens")
      .not.toContain("568");
    if (title.includes("568")) {
      expect(title, "the hover text names 568 without saying it is processed flow")
        .toMatch(/processed/i);
    }
    /* The Inspector's session line is CONSUMPTION: 557, counting each prompt
       token once. 568 is processed flow, which counts cache re-reads too.
       Bound to the exact node — `.drawer-session-usage` is one `dt`/`dd` pair —
       because "the drawer contains 557 somewhere" is satisfied by any string on
       the panel, including a different fact that happens to share the digits. */
    const usage = findClass(drawer, "drawer-session-usage");
    expect(usage, "the Inspector no longer publishes a session usage fact").toBeTruthy();
    const dt = (usage.children || [])[0];
    const dd = (usage.children || [])[1];
    expect(textOf(dt), "the session fact's label changed").toBe("Session");
    expect(textOf(dd), "the session fact reports something other than the consumption total")
      .toBe("557");
    expect(carrierHidden(dd), "R13's session value cannot be read by both audiences").toBe(false);
    expectBoth(dd, "557", "R13's session consumption total");
    /* Same structural contract as the Context fact: exactly one label/value
       pair, correct tags, no third child smuggling a second figure in. */
    const usageKids = (usage.children || []) as Array<{ tagName: string }>;
    expect(usageKids.length, "the session fact is not a single label/value pair").toBe(2);
    expect(String(usageKids[0].tagName).toLowerCase(), "the session label is not a <dt>").toBe("dt");
    expect(String(usageKids[1].tagName).toLowerCase(), "the session value is not a <dd>").toBe("dd");

    /* 568 may not appear on ANY consumption carrier. The earlier draft accepted
       it anywhere the word "processed" also appeared somewhere on the panel —
       a substring check so loose that an unrelated paragraph licensed it. The
       only licence is a field whose own label names processed flow. */
    /* UNCONDITIONAL. An earlier draft licensed 568 whenever a "processed" node
       happened to exist, which let the presence of one element certify a number
       printed somewhere else entirely. The client has no processed-flow surface
       at all - `sessionProcessed` appears in src/web/app.js only inside a
       comment - so the honest contract is that the figure never reaches a
       consumption carrier. If a processed surface is ever added, this is the
       assertion to revisit deliberately. */
    for (const surface of [textOf(usage), ...accessibleStrings(usage)]) {
      expect(surface, "the session consumption carrier printed the processed total")
        .not.toContain("568");
    }
    expect(textOf(drawer), "the processed total reached the Inspector as a consumption reading")
      .not.toContain("568");

    /* The whole visible row, not only its token cell. A figure printed in the
       summary, the status line or any other cell is just as wrong as one in the
       tokens column, and the cell-scoped checks above would not see it. */
    expect(textOf(row), "the processed total is printed somewhere on the row")
      .not.toContain("568");

    /* Every carrier, including dataset values — the live-clock and elapsed
       hooks write numbers there, and a figure parked in a data attribute is one
       repaint away from being printed. */
    for (const node of [...walk(row), ...walk(drawer)]) {
      for (const [k, v] of Object.entries(node.dataset || {})) {
        expect(String(v), `568 is parked in data-${k}`).not.toContain("568");
      }
      for (const [k, v] of Object.entries(node.attributes || {})) {
        expect(String(v), `568 reached the ${k} attribute`).not.toContain("568");
      }
    }
    for (const surface of [textOf(drawer), ...accessibleStrings(drawer)]) {
      expect(surface, `the Inspector printed a context percent in "${surface}"`)
        .not.toMatch(/\d+(\.\d+)?\s*%/);
      expect(surface, "the Inspector printed a price").not.toContain("$");
    }

    /* The row's ROOT accessible name is the whole row for a keyboard operator,
       so the same rule holds there. */
    const rootName = String(row.attributes["aria-label"] || "");
    expect(rootName, "the row's accessible name announces the processed total as tokens")
      .not.toContain("568");
    expect(rootName, "the row's accessible name lost its token reading")
      .toContain("Tokens: in 120 · out 30 · cache 400");
  });

  test("no snapshot-shaped row anywhere in this fixture carries callSizes", () => {
    /* `callSizes` is debug-only evidence. Asserting it about two hand-picked
       rows proved those two rows; this walks every snapshot-shaped row the
       fixture publishes — R1-R23, both cohorts, the uniform set, the long-label
       set and every control case — so a future row cannot quietly introduce it.
       `Object.hasOwn` rather than a truthiness check: `callSizes: []` and
       `callSizes: undefined` are both present, and both are the claim this
       forbids. */
    for (const r of everySnapshotRow(PROVIDERS)) {
      expect(Object.hasOwn(r, "callSizes"), `${r.id} carries callSizes on the row`).toBe(false);
      const tokens = r.tokens as Record<string, unknown> | undefined;
      if (tokens) {
        expect(Object.hasOwn(tokens, "callSizes"), `${r.id} carries callSizes in its token block`)
          .toBe(false);
      }
    }
    /* Named explicitly, because these two are the cases the ledger calls out. */
    expect(Object.hasOwn(R11_OPENCODE_CHILD.tokens as object, "callSizes")).toBe(false);
    expect(Object.hasOwn(R13_OPENCODE_USAGE.tokens as object, "callSizes")).toBe(false);
  });

  test("per-row USD is absent for every provider", () => {
    for (const agent of INTEGRATED_COHORT) {
      expect(textOf(renderRow(agent)), `${agent.provider} row printed a price`).not.toContain("$");
    }
  });

  test("R22 · an unreadable timestamp omits its own cell and nothing else", () => {
    const row = renderRow(R22_OPENCODE_CORRUPT_TIME);
    const drawer = renderDrawer(R22_OPENCODE_CORRUPT_TIME);
    const text = textOf(row);

    /* Identity and prose survive — one corrupt epoch must not delete the row. */
    expect(text).toContain("corrupt-timestamp-fixture");
    expect(text).toContain("Timestamps unreadable");

    /* The time cell is OMITTED rather than filled. A rendered dash here would be
       a measurement-implying placeholder in a column of real durations. */
    expect(findClass(row, "ri-elapsed"),
      "a duration cell was drawn for a session whose timestamps cannot be read").toBeNull();

    /* The live-clock hooks must not claim an age either. `tickClocks` rewrites
       EVERY node carrying one of these dataset keys, so an age attached to an
       unreadable timestamp becomes a counter advancing from nonsense. All four
       carriers are audited, on both surfaces — checking one key would let a
       mutation move the hook to its sibling and stay green. */
    /* Every key `tickClocks` rewrites, read from its own loops: data-elapsed-base
       (with data-elapsed-from), data-ago, data-working-since and
       data-compact-ago. An earlier draft guessed "elapsed" and "since", which
       match nothing — so the audit checked two keys that do not exist while
       skipping two that do. */
    const CLOCK_KEYS = ["elapsedBase", "elapsedFrom", "ago", "workingSince", "compactAgo"];
    for (const [surfaceName, node] of [["row", row], ["Inspector", drawer]] as const) {
      const aged = walk(node).filter((n) => n.dataset && CLOCK_KEYS.some((k) => k in n.dataset));
      expect(aged.map((n) => JSON.stringify(n.dataset)),
        `the ${surfaceName} attached a live clock to an unreadable timestamp`).toEqual([]);
    }

    /* `agoText` on an unparseable timestamp yields a bare "— ago" — a phrase
       reading as a measurement whose value is merely missing, rather than as a
       timestamp that could not be read at all. The age node must be omitted. */
    for (const surface of [textOf(row), textOf(drawer)]) {
      expect(surface, "an unreadable timestamp rendered as a dash-shaped age")
        .not.toMatch(/—\s*ago/);
    }

    /* Every carrier an operator can reach: visible text, accessible names and
       hover text. A fabricated age hiding in a title is still a fabricated age. */
    const carriers: string[] = [text, textOf(drawer)];
    for (const node of [...walk(row), ...walk(drawer)]) {
      const attrs = node.attributes || {};
      for (const key of ["aria-label", "title"]) {
        if (typeof attrs[key] === "string") carriers.push(attrs[key]);
      }
    }
    for (const surface of carriers) {
      expect(surface).not.toContain("Invalid Date");
      expect(surface).not.toContain("1970");
      expect(surface).not.toMatch(/\bNaN\b/);
      /* Bounded: `0s` as its own reading, and also `0s` closing a compound
         duration like "0h 0s". An unanchored /0s/ would fire on "10s". */
      expect(surface, `an unreadable timestamp was rendered as a zero duration in "${surface}"`)
        .not.toMatch(/(^|[\s:·])0s\b/);
    }
  });
});

/* ================= control attestation ================= */

describe("controls follow the server's attestation, not the provider", () => {
  test("exact identity links; observed-only and ambiguous do not", () => {
    expect(M.deriveControlState(R15_GEMINI_LINKED)).toBe("linked");
    expect(M.deriveControlState(R16_OPENCODE_OBSERVED_ONLY)).toBe("observed-only");
    expect(M.deriveControlState(R16B_PI_QUARANTINED)).toBe("quarantined");
  });

  test("no client-side per-provider shortcut decides these states", () => {
    /* The same agent shape, relabelled provider by provider, must resolve to the
       same control state every time. A provider-specific predicate would show up
       here as one harness disagreeing with the other thirteen. */
    for (const p of PROVIDERS) {
      expect(M.deriveControlState({ ...R16_OPENCODE_OBSERVED_ONLY, provider: p }), p).toBe("observed-only");
      expect(M.deriveControlState({ ...R15_GEMINI_LINKED, provider: p }), p).toBe("linked");
    }
  });

  test("every control state renders the same way on the row and in the Inspector, for every provider", () => {
    /* deriveControlState is one function; what an operator meets is a row's
       accessible name and a drawer. Calling the function fourteen times proves
       the FUNCTION is provider-neutral and says nothing about whether the two
       surfaces agree — a row reading "Ready" beside a drawer that refuses to
       send is the failure this pins. */
    const ACCESS_TEXT: Record<string, string> = {
      linked: "Ready",
      quarantined: "Quarantined",
      "observed-only": "View only",
    };
    for (const p of PROVIDERS) {
      for (const { key, state, refusal, over } of CONTROL_CASES) {
        const agent = controlRow(p, over);
        expect(M.deriveControlState(agent), `${p}/${key} resolved the wrong control state`).toBe(state);

        /* 1 — the row's accessible name states the access level. */
        const name = String(renderRow(agent).attributes["aria-label"] || "");
        expect(name, `${p}/${key} row does not state its access level`)
          .toContain("Access: " + ACCESS_TEXT[state]);

        /* 2 — the Inspector's control banner. It renders only when a capability
           is refused, so its presence or absence IS the assertion. */
        const banner = withDom(() => {
          M.state.view = "board";
          return M.renderControlBanner(agent, M.deriveControlState(agent));
        });
        if (refusal === null) {
          expect(banner, `${p}/${key} raised a refusal banner over enabled controls`).toBeNull();
        } else {
          expect(banner, `${p}/${key} refuses every control and says so nowhere`).toBeTruthy();
        }

        /* 3 - the REAL dock. `renderCommandDock` is the surface an operator
           meets: the composer textarea, the Send button and the action verbs,
           assembled together. An earlier draft drove `renderDockTool(agent, cap,
           "instruct")` instead, which is not the route Send takes - so it
           certified a control the dock never renders that way, and would have
           stayed green through a broken composer. */
        const dock = withDom(() => {
          M.state.view = "board";
          return M.renderCommandDock(agent, M.deriveControlState(agent), null, []);
        });
        expect(dock, `${p}/${key} rendered no command dock`).toBeTruthy();

        const textarea = walk(dock).find((n) => n.tagName === "textarea");
        /* EXACT BOUNDED names, and three DISTINCT nodes. A substring match on
           the concatenated text let one button named "Focus Send Interrupt"
           answer to all three probes — three assertions, one control, and an
           operator with two verbs that do not exist. */
        const nameOf = (n: { attributes: Record<string, string> }) =>
          String(n.attributes["aria-label"] || "").trim();
        /* EXACT equality, not a bounded prefix. `^Focus\b` still admitted
           "Focus now" and `^Send\b` admitted "Send unavailable" — names that
           describe a different control, or a state the button does not have. */
        const buttonNamed = (verb: string) => walk(dock).find((n) =>
          n.tagName === "button" && nameOf(n) === verb);
        const send = buttonNamed("Send");
        const isDisabled = (n: { disabled?: boolean; attributes?: Record<string, string> }) =>
          n.disabled === true || "disabled" in (n.attributes || {})
          || String((n.attributes || {})["aria-disabled"] || "") === "true";

        if (refusal === null) {
          /* A linked session gets a live composer. Send itself is correctly
             disabled while the textarea is empty — that is the composer's own
             guard, not a control refusal, and asserting otherwise would demand
             a button that submits nothing. What matters here is that the
             composer is offered and is not itself locked. */
          expect(textarea, `${p}/${key} offers no composer on a session it can drive`).toBeTruthy();
          expect(isDisabled(textarea), `${p}/${key} locked the composer on a linked session`).toBe(false);
        } else {
          if (send) {
            expect(isDisabled(send), `${p}/${key} offers a live Send it cannot honour`).toBe(true);
          }
          if (textarea) {
            expect(isDisabled(textarea), `${p}/${key} offers a live composer it cannot honour`).toBe(true);
          }
          /* The state's OWN reason, inside the rendered refusal node. Scanning
             the whole dock would pass on one generic banner reused for every
             state, which is the defect: two different situations described by
             one sentence. The reason has to be in the banner the operator is
             actually shown. */
          expect(banner, `${p}/${key} refuses with no banner to explain it`).toBeTruthy();
          /* The state's OWN reason, on BOTH channels, from the banner itself.
             Concatenating text and every accessible string let a reason hidden
             from sight satisfy the check as long as it appeared in some
             attribute — and a refusal a sighted operator cannot read is a dead
             control with no explanation. */
          expect(carrierHidden(banner), `${p}/${key}'s banner cannot be read by both audiences`)
            .toBe(false);
          expectBoth(banner, refusal, `${p}/${key}'s refusal reason`);
          /* OWN-ONLY. Every other reason in the state matrix must be absent
             from this banner on both channels — a generic banner listing all
             three refusals satisfies a "contains my reason" check while telling
             the operator three contradictory things about one session. */
          for (const other of CONTROL_CASES) {
            if (other.key === key || !other.refusal || other.refusal === refusal) continue;
            const { visible, a11y } = bothChannels(banner);
            expect(visible, `${p}/${key}'s banner also prints ${other.key}'s reason`)
              .not.toContain(other.refusal);
            expect(a11y, `${p}/${key}'s banner also announces ${other.key}'s reason`)
              .not.toContain(other.refusal);
          }
        }

        /* 4 - the composer and Send exist on every state, and are REACHABLE. A
           dock that dropped them would satisfy every "not enabled" assertion by
           removing the control instead of refusing it; one that hid them behind
           a hidden ancestor would do the same thing more quietly. */
        expect(textarea, `${p}/${key} rendered no composer at all`).toBeTruthy();
        expect(send, `${p}/${key} rendered no Send button at all`).toBeTruthy();
        expect(hiddenHere(dock), `${p}/${key}'s command dock is hidden`).toBe(false);
        expect(hiddenHere(textarea), `${p}/${key}'s composer is hidden`).toBe(false);
        expect(carrierHidden(send), `${p}/${key}'s Send control is hidden from one audience`)
          .toBe(false);

        /* The composer carries its own accessible name, reachable on both
           channels — an unnamed textarea is an unlabelled box. */
        expect(carrierHidden(textarea), `${p}/${key}'s composer is hidden from one audience`).toBe(false);
        expect(String(textarea.attributes["aria-label"] || "").trim(),
          `${p}/${key}'s composer has no accessible name`).not.toBe("");
        expect(String(textarea.attributes["aria-label"] || "").trim(),
          `${p}/${key}'s composer is not named for its own session`)
          .toBe(`Instruction for ${p}-controls`);

        /* Three distinct node identities, each named exactly for its own verb. */
        const focusBtn = buttonNamed("Focus");
        const interruptBtn = buttonNamed("Interrupt");
        for (const [verb, node] of [["Send", send], ["Focus", focusBtn], ["Interrupt", interruptBtn]] as const) {
          expect(node, `${p}/${key} offers no control named exactly for ${verb}`).toBeTruthy();
          expect(carrierHidden(node), `${p}/${key}'s ${verb} control is hidden from one audience`).toBe(false);
        }
        expect(new Set([send, focusBtn, interruptBtn]).size,
          `${p}/${key} answers Send, Focus and Interrupt with fewer than three distinct controls`).toBe(3);

        /* And each generic action verb is present with a state-appropriate
           enabled flag. */
        /* The SAME nodes already resolved above, by their exact capitalized
           names. Re-looking them up with the lowercase capability key was
           internally contradictory once `buttonNamed` became exact equality:
           `nameOf(n) === "focus"` can never match a control named `Focus`, so
           the assertion could only pass on a lowercase duplicate — a button
           the product does not render, and must not be made to render. */
        for (const [action, verb] of [["focus", focusBtn], ["interrupt", interruptBtn]] as const) {
          const cap = (agent.controls as Array<{ action: string; enabled: boolean }>)
            .find((c) => c.action === action)!;
          expect(verb, `${p}/${key} offers no ${action} control`).toBeTruthy();
          expect(isDisabled(verb), `${p}/${key}'s ${action} control has the wrong enabled state`)
            .toBe(!cap.enabled);
          /* Reachable by both audiences, with its name intact. A control hidden
             from sight is unusable; one hidden from the accessibility tree is
             unnameable. */
          expect(carrierHidden(verb), `${p}/${key}'s ${action} control is hidden from one audience`)
            .toBe(false);
          expect(nameOf(verb!), `${p}/${key}'s ${action} control is not named exactly for its verb`)
            .toBe(action.charAt(0).toUpperCase() + action.slice(1));
        }
        /* The lowercase-duplicate rejection moved to its own test below. It sat
           here behind assertions that fail on today's board, so it was never
           reached: the enclosing test dies on the first refused state and the
           check was reported as covered while never having run. */

        /* 4 — the Inspector still identifies the session it is refusing for. */
        expect(textOf(renderDrawer(agent)), `${p}/${key} Inspector lost the session`)
          .toContain(`${p}-controls`);
      }
    }
  });

  test("the dock names its verbs in exactly one casing, for every provider and state", () => {
    /* STANDALONE AND PASSING, deliberately.

       This lived inside the state-matrix test above, after assertions that fail
       on today's board — so it never executed. A guard that cannot be reached
       is a guard that is not there, and it was being counted as coverage.

       It renders the real command dock for all fourteen providers across all
       four control states and makes one claim: the verbs are named in exactly
       one casing. A lowercase twin would let the exact-name lookups elsewhere
       be satisfied by a control the product does not render. */
    const nameOf = (n: { attributes: Record<string, string> }) =>
      String(n.attributes["aria-label"] || "").trim();

    for (const p of PROVIDERS) {
      for (const { key, over } of CONTROL_CASES) {
        const agent = controlRow(p, over);
        const dock = withDom(() => {
          M.state.view = "board";
          return M.renderCommandDock(agent, M.deriveControlState(agent), null, []);
        });
        expect(dock, `${p}/${key} rendered no command dock`).toBeTruthy();
        const buttons = walk(dock).filter((n) => n.tagName === "button");

        /* No lowercase twin, for any of the three verbs. */
        for (const lower of ["send", "focus", "interrupt"]) {
          expect(buttons.filter((n) => nameOf(n) === lower).length,
            `${p}/${key} renders a lowercase '${lower}' control`).toBe(0);
        }

        /* And exactly the three capitalized controls, as three distinct nodes. */
        const exact = ["Send", "Focus", "Interrupt"].map((verb) => {
          const hits = buttons.filter((n) => nameOf(n) === verb);
          expect(hits.length, `${p}/${key} does not render exactly one control named "${verb}"`).toBe(1);
          return hits[0];
        });
        expect(new Set(exact).size,
          `${p}/${key} answers Send, Focus and Interrupt with fewer than three distinct controls`).toBe(3);
      }
    }
  });

  test("unavailable keeps its own explanation and is not certified by an observed-only alias", () => {
    /* Both refuse; they refuse for DIFFERENT reasons. One session's terminal was
       never identified; the other has no control channel at all. An operator
       told the wrong one goes looking for the wrong fix, so the two sentences
       must not be the same sentence — and a test that accepted either would let
       a fix collapse them. */
    const byKey = Object.fromEntries(CONTROL_CASES.map((c) => [c.key, c]));
    const unavailable = byKey.unavailable.refusal!;
    const observedOnly = byKey["observed-only"].refusal!;
    expect(unavailable, "unavailable borrowed observed-only's refusal text").not.toBe(observedOnly);

    for (const p of PROVIDERS) {
      const agent = controlRow(p, byKey.unavailable.over);
      const reasons = (agent.controls as Array<{ reason?: string }>).map((c) => c.reason);
      expect(reasons.every((r) => r === unavailable), `${p} unavailable case lost its own reason`).toBe(true);
      expect(reasons.some((r) => r === observedOnly), `${p} unavailable case reuses observed-only's reason`)
        .toBe(false);

      /* The SERVER already publishes the distinction: each case carries its own
         `controls[].reason`. The client resolves both to "observed-only" and
         prints one generic sentence, so the operator is told the same thing
         about two different situations — one whose terminal was never
         identified, and one that has no control channel at all. They go looking
         for the wrong fix.

         This asserts the published reason REACHES the operator, which is the
         same honesty rule the rest of this slice applies to tokens and context:
         evidence the server sent must not be silently discarded. */
      const seen = (over: SyntheticRow) => withDom(() => {
        M.state.view = "board";
        const a = controlRow(p, over);
        const d = M.renderCommandDock(a, M.deriveControlState(a), null, []);
        const b = M.renderControlBanner(a, M.deriveControlState(a));
        return textOf(d) + " " + accessibleStrings(d).join(" ")
          + " " + (b ? textOf(b) + " " + accessibleStrings(b).join(" ") : "");
      });
      expect(seen(byKey.unavailable.over), `${p}: the published unavailable reason never reaches the operator`)
        .toContain(unavailable);
      expect(seen(byKey["observed-only"].over), `${p}: the published observed-only reason never reaches the operator`)
        .toContain(observedOnly);
    }
  });
});

/* ================= source health ================= */

describe("a source that was never installed is not a source that broke", () => {
  /* R18 and R19 used to share one board, which meant both verdicts were read
     off the same number — "degraded is a fault" and "absent is not" cannot both
     be proven by a board containing one of each. Each case now gets a board
     carrying only itself. */

  /* `sources` is the counting line under the verdict, and it is where the
     absent/degraded distinction is actually SPENT — the boolean only chooses
     which sentence prints, while this line chooses what number the operator
     reads. Each is pinned exactly: a substring check would let "1 of 2
     collectors degraded" satisfy a board carrying three faults. */

  test("R18 alone · a collector that WAS healthy and is not now is a fault", () => {
    const verdict = M.emptyBoardVerdict(DEGRADED_ONLY_BOARD());
    expect(verdict.degraded, "a degraded collector was not counted as a fault").toBe(true);
    expect(verdict.message, "the fault is not stated in the operator's own words")
      .toMatch(/not every collector can see/i);
    expect(verdict.hint, "the consequence of a degraded collector is not explained")
      .toMatch(/incomplete rather than empty/i);
    expect(verdict.sources, "the degraded count is wrong").toBe("1 of 2 collectors degraded");
    /* The verdict is stamped with the snapshot it read, not with the clock.
       A null or invented `checkedAt` turns "as of this scan" into "as of now",
       which is the same class of fabrication as an invented token count. */
    expect(verdict.checkedAt, "the degraded verdict lost the snapshot it was read from")
      .toBe("2026-07-22T02:45:00.000Z");
    /* And the degraded source keeps the timestamp that makes it degraded rather
       than absent: it WAS healthy once, and that is the whole distinction. */
    const degradedEntry = (DEGRADED_ONLY_BOARD().totals as Record<string, Record<string, Record<string, Record<string, unknown>>>>)
      .sourceHealth.byProvider.opencode;
    expect(degradedEntry.lastHealthyAt, "the degraded source lost its lastHealthyAt evidence")
      .toBe("2026-07-22T01:00:00.000Z");
    expect(Object.hasOwn(degradedEntry, "absent"),
      "the degraded source declared an absent flag, which would file it as never installed").toBe(false);
  });

  test("R19 alone · a collector that was never installed is not a fault", () => {
    const verdict = M.emptyBoardVerdict(ABSENT_ONLY_BOARD());
    expect(verdict.degraded, "an absent collector was reported as degraded").toBe(false);
    expect(verdict.message, "an absent collector produced a fault sentence")
      .not.toMatch(/not every collector can see/i);
    expect(verdict.message).toMatch(/watching/i);
    /* The absent collector is counted OUT of the denominator and named
       separately — "1 of 2 healthy" would read as a shortfall on a machine
       where nothing is wrong. */
    expect(verdict.sources).toBe("1 of 1 collectors healthy · 1 not installed");
    expect(verdict.checkedAt, "the calm verdict lost the snapshot it was read from")
      .toBe("2026-07-22T02:45:00.000Z");
  });

  test("nothing installed at all still reports calm and still says something", () => {
    /* The day-one screen. A newcomer running one harness must not be told that
       something is broken because they have not installed the other thirteen —
       and the line must not go silent either, because QUICKSTART sends them here
       to look for exactly this proof that the board is working. */
    const verdict = M.emptyBoardVerdict(ALL_ABSENT_BOARD());
    expect(verdict.degraded).toBe(false);
    expect(verdict.sources)
      .toBe("No collectors installed yet — Claude Code, Codex, Cursor, Grok Build or Copilot CLI will appear here");
  });

  test("the synthetic board's own health summary agrees with its breakdown", () => {
    /* The fixture used to assert a summary that contradicted the breakdown it
       summarised — total 14 over seven entries — which is a board that could
       make a correct verdict look wrong. The totals are derived now, and these
       are the derived numbers, named so a drifting fixture fails here rather
       than somewhere downstream. */
    const health = (syntheticBoard().totals as Record<string, Record<string, number>>).sourceHealth;
    expect(health.total, "the synthetic board's collector total drifted").toBe(7);
    expect(health.healthy, "the synthetic board's healthy count drifted").toBe(5);
    expect(health.degraded, "the synthetic board's degraded count drifted").toBe(1);
    expect(health.absent, "the synthetic board's absent count drifted").toBe(1);
    expect(health.healthy + health.degraded + health.absent, "the parts do not sum to the total")
      .toBe(health.total);
    /* The board stamps its own generation time, and the verdict reads it. */
    expect(syntheticBoard().generatedAt).toBe("2026-07-22T02:45:00.000Z");
    expect(M.emptyBoardVerdict(syntheticBoard()).checkedAt).toBe("2026-07-22T02:45:00.000Z");
    /* A board with no generatedAt reports null rather than inventing one. */
    expect(M.emptyBoardVerdict({ totals: { sourceHealth: { total: 0 } } }).checkedAt,
      "a snapshot with no generation time was given one").toBeNull();
  });

  test("the board PAINTS the checked-at stamp and the last-healthy evidence", () => {
    /* The verdict helper returning the right strings is half the contract. The
       other half is that the empty state actually paints them: deleting either
       paint path leaves the helper green and the operator with a board that
       says nothing about when it last looked or when the broken collector last
       worked. Both are asserted on the RENDERED node. */
    const board = DEGRADED_ONLY_BOARD();
    /* The empty state writes into sibling mount points by id, so the proof line
       is read from its own node rather than from the container. */
    const painted = withDom(() => withClientState({ view: "board", snap: board, conn: "live" }, () => {
      M.renderEmpty();
      return {
        proof: document.getElementById("empty-proof"),
        message: document.getElementById("empty-message"),
        hint: document.getElementById("empty-hint"),
      };
    }));
    expect(painted.proof, "the empty state paints no proof line at all").toBeTruthy();

    /* EXACT COMPOSITION, visible, in one canonical order: the collector count,
       then when the board last looked, then when the degraded collector last
       worked. Independent substring checks pass on a reordered or duplicated
       line, and on one whose parts are individually hidden. */
    expect(carrierHidden(painted.proof), "the proof line cannot be read by both audiences").toBe(false);
    const shown = visibleTextOf(painted.proof);
    expect(shown, "the degraded empty-state proof is not the composition it should be")
      .toBe("1 of 2 collectors degraded"
        + " · checked " + TF.agoText("2026-07-22T02:45:00.000Z")
        + " · last healthy " + TF.agoText("2026-07-22T01:00:00.000Z"));
    /* The last-healthy evidence specifically, on both channels — it is the fact
       that separates a collector that BROKE from one never installed, and the
       one most cheaply satisfied by a hidden child. */
    expectBoth(painted.proof, "last healthy " + TF.agoText("2026-07-22T01:00:00.000Z"),
      "the empty-state last-healthy evidence");

    /* Each fact EXACTLY ONCE on each channel. A proof line that printed the
       count twice, or repeated the checked age in a hidden twin, satisfies a
       containment check while reading as a stutter. */
    const once = (haystack: string, needle: string, what: string) =>
      expect(haystack.split(needle).length - 1, `${what} appears more than once`).toBe(1);
    for (const [channel, text] of [
      ["visible", visibleTextOf(painted.proof)],
      ["accessible", a11yTextOf(painted.proof)],
    ] as const) {
      once(text, "1 of 2 collectors degraded", `the ${channel} source count`);
      once(text, "checked " + TF.agoText("2026-07-22T02:45:00.000Z"), `the ${channel} checked age`);
      once(text, "last healthy " + TF.agoText("2026-07-22T01:00:00.000Z"), `the ${channel} last-healthy age`);
    }

    /* The degraded message and hint, exactly, on both channels. */
    for (const [what, node, exact] of [
      ["message", painted.message, "No sessions found — and not every collector can see."],
      ["hint", painted.hint,
        "A degraded collector reports no sessions whether or not any are running, so this board is incomplete rather than empty."],
    ] as const) {
      expect(carrierHidden(node), `the degraded ${what} cannot be read by both audiences`).toBe(false);
      expect(visibleTextOf(node), `the degraded ${what} is not its exact copy`).toBe(exact);
      expect(a11yTextOf(node), `the degraded ${what} never reaches the accessibility tree`).toBe(exact);
    }
    /* The fault itself is painted too, not only counted. */
    expect(textOf(painted.message), "the painted message does not state the fault")
      .toMatch(/not every collector can see/i);
    expect(textOf(painted.hint), "the painted hint does not explain the consequence")
      .toMatch(/incomplete rather than empty/i);

    /* The stamp is bound to the snapshot's own time, carried on the node the
       clock ticker rewrites, not re-derived from the wall clock. */
    const stamp = walk(painted.proof).find((n) => n.dataset && n.dataset.ago);
    expect(stamp, "no checked-at node carries the snapshot timestamp").toBeTruthy();
    expect(stamp.dataset.ago, "the checked-at stamp is not the snapshot's own time")
      .toBe("2026-07-22T02:45:00.000Z");

    /* The EXACT visible copy, not merely the word "checked". The node prints
       "checked " + agoText(stamp), so the age string is pinned against the same
       formatter the board uses — a stamp rendered raw, or as an epoch, or with
       the wrong preposition, all fail here. */
    expect(textOf(stamp), "the checked-at copy is not what the board composes")
      .toBe("checked " + TF.agoText("2026-07-22T02:45:00.000Z"));

    /* And the last-healthy suffix, exactly as degradedSinceText composes it,
       reaching the same painted surface. This is the sentence that separates a
       collector that BROKE from one that was never installed. */
    const since = M.degradedSinceText(board);
    expect(since, "the last-healthy suffix is no longer composed")
      .toBe(" · last healthy " + TF.agoText("2026-07-22T01:00:00.000Z"));
  });

  test("the NORMAL health card paints both the snapshot age and the degraded-since suffix", () => {
    /* The empty-state proof line is one surface; the health READING is the other
       and the one an operator sees on a board that has rows. It composes its
       sub-line as `problemText + sinceNote + snapNote`, so deleting either note
       leaves a card that still renders — and still looks fine — while dropping
       when the board last looked or when the broken collector last worked.

       Asserted on the rendered node, with both strings pinned exactly against
       the same formatter the card uses. */
    const board = DEGRADED_ONLY_BOARD();
    const card = withDom(() => withClientState({ view: "board", snap: board, conn: "live" }, () => {
      return M.renderSummaryWidget("health", "normal", {
        tone: "degraded",
        severityKey: "degraded",
        severityDetail: "One collector cannot see.",
        value: "Degraded",
        icon: "warning",
      });
    }));
    expect(card, "the health card did not render").toBeTruthy();

    const sub = findClass(card, "reading-sub-text");
    expect(sub, "the health card paints no sub-line at all").toBeTruthy();
    const copy = textOf(sub);

    /* EXACT COMPOSITION, not three independent substrings.

       Three `toContain` checks pass on a line carrying all three fragments in
       any order, twice over, or with anything spliced between them. The card
       composes `problemText + sinceNote + snapNote` in that order, so that is
       what is asserted — one equality that fails on a deletion, a reorder, a
       duplication or an insertion alike. */
    expect(carrierHidden(sub), "the health sub-line cannot be read by both audiences").toBe(false);
    expect(visibleTextOf(sub), "the health card's sub-line is not the composition it should be")
      .toBe("One collector cannot see."
        + " · last healthy " + TF.agoText("2026-07-22T01:00:00.000Z")
        + " · snapshot " + TF.agoText("2026-07-22T02:45:00.000Z"));
    /* And the same composition reaches the accessibility tree. Asserting only
       the visible channel would accept a card whose sub-line is aria-hidden
       entirely — legible, and silent. */
    expect(a11yTextOf(sub), "the health card's sub-line never reaches the accessibility tree")
      .toBe("One collector cannot see."
        + " · last healthy " + TF.agoText("2026-07-22T01:00:00.000Z")
        + " · snapshot " + TF.agoText("2026-07-22T02:45:00.000Z"));

    /* A calm board carries neither suffix — the notes are evidence, not
       decoration, so they appear only when there is something to evidence. */
    const calm = withDom(() => withClientState({ view: "board", snap: ABSENT_ONLY_BOARD(), conn: "live" }, () => {
      return M.renderSummaryWidget("health", "normal", {
        tone: "ok", severityKey: "ok", severityDetail: "All collectors can see.",
        value: "Healthy", icon: "check",
      });
    }));
    expect(textOf(findClass(calm, "reading-sub-text")),
      "a calm board still claims a degraded-since time").not.toContain("last healthy");

    /* And the calm sub-line is pinned exactly, on both channels. Asserting only
       the absence of "last healthy" passes on a card that says nothing at all —
       a blank qualifier under a Healthy verdict is not the same as a card that
       states what it checked and when. */
    const calmSub = findClass(calm, "reading-sub-text");
    expect(carrierHidden(calmSub), "the calm sub-line cannot be read by both audiences").toBe(false);
    const calmCopy = "All collectors can see."
      + " · snapshot " + TF.agoText("2026-07-22T02:45:00.000Z");
    expect(visibleTextOf(calmSub), "the calm health sub-line is not the composition it should be")
      .toBe(calmCopy);
    expect(a11yTextOf(calmSub), "the calm health sub-line never reaches the accessibility tree")
      .toBe(calmCopy);
  });

  test("R19 · the absent-only board PAINTS a calm empty state, with no fault copy", () => {
    /* The degraded branch is painted and asserted above; the calm branch was
       only ever read from the verdict helper. They are different code paths in
       renderEmpty, and the one a newcomer meets on day one is this one — a
       machine with a single harness installed must not be told something is
       broken. */
    const painted = withDom(() => withClientState({ view: "board", snap: ABSENT_ONLY_BOARD(), conn: "live" }, () => {
      M.renderEmpty();
      return {
        proof: document.getElementById("empty-proof"),
        message: document.getElementById("empty-message"),
        hint: document.getElementById("empty-hint"),
      };
    }));
    expect(painted.proof, "the calm empty state paints no proof line").toBeTruthy();

    for (const [what, node] of [
      ["message", painted.message], ["hint", painted.hint], ["proof", painted.proof],
    ] as const) {
      expect(carrierHidden(node), `the calm ${what} cannot be read by both audiences`).toBe(false);
    }

    /* Exact calm copy, both channels. */
    expect(visibleTextOf(painted.message)).toBe("Watching. No sessions running yet.");
    expect(a11yTextOf(painted.message)).toBe("Watching. No sessions running yet.");
    /* The calm HINT, exactly, on both channels — this is the sentence QUICKSTART
       sends a newcomer to look for, and it names the harnesses by their operator
       labels. */
    const CALM_HINT = "Claude Code, Codex, Cursor, Grok Build and Copilot CLI"
      + " sessions appear here on their own, within seconds of starting.";
    expect(visibleTextOf(painted.hint), "the calm hint is not its exact copy").toBe(CALM_HINT);
    expect(a11yTextOf(painted.hint), "the calm hint never reaches the accessibility tree").toBe(CALM_HINT);
    expect(visibleTextOf(painted.proof))
      .toBe("1 of 1 collectors healthy · 1 not installed"
        + " · checked " + TF.agoText("2026-07-22T02:45:00.000Z"));
    expect(a11yTextOf(painted.proof))
      .toContain("1 of 1 collectors healthy · 1 not installed");
    /* The checked-age PHRASE on both channels, not only the count prefix — a
       calm board that stopped saying when it last looked is a board whose
       silence cannot be told from staleness. */
    for (const [channel, text] of [
      ["visible", visibleTextOf(painted.proof)],
      ["accessible", a11yTextOf(painted.proof)],
    ] as const) {
      expect(text, `the calm proof's ${channel} channel omits the checked age`)
        .toContain("checked " + TF.agoText("2026-07-22T02:45:00.000Z"));
    }

    /* The stamp is the snapshot's own time here too. */
    const stamp = walk(painted.proof).find((n) => n.dataset && n.dataset.ago);
    expect(stamp?.dataset.ago, "the calm checked-at stamp is not the snapshot's own time")
      .toBe("2026-07-22T02:45:00.000Z");

    /* Calm state, not fault state — and none of the degraded vocabulary. */
    expect(String(painted.proof?.className || ""), "a calm board wears the degraded class")
      .not.toContain("is-degraded");
    for (const [what, node] of [
      ["message", painted.message], ["hint", painted.hint], ["proof", painted.proof],
    ] as const) {
      const { visible, a11y } = bothChannels(node);
      for (const surface of [visible, a11y]) {
        expect(surface, `the calm ${what} carries degraded copy`).not.toMatch(/not every collector can see/i);
        expect(surface, `the calm ${what} carries degraded copy`).not.toMatch(/degraded/i);
        expect(surface, `the calm ${what} claims a last-healthy time`).not.toMatch(/last healthy/i);
      }
    }
  });
});

/* ================= filters, grouping and search ================= */

describe("the lens counts every provider it offers", () => {
  /* The label side of this moved into FE-2, where it runs through M.LENS_AXES
     and M.lensOptions. What stays here is the COUNT, because an option that
     names a provider and reports the wrong population is its own defect. */

  test("each Harness option counts the rows that provider actually has", () => {
    const axis = M.LENS_AXES.find((a: { key: string }) => a.key === "provider");
    const board = allProviderBoard(PROVIDERS);
    const ui = {
      ...M.state,
      snap: board,
      view: "board",
      lookbackHours: 24 * 365 * 20,
      showReviewWorkers: true,
      [axis.stateKey]: [],
    };
    const options = M.lensOptions(axis, ui);
    expect(options.length, "the lens offered a different roster than the board carries")
      .toBe(PROVIDERS.length);
    for (const option of options) {
      expect(option.count, `the ${option.value} lens option counts ${option.count} rows, not 1`).toBe(1);
    }
  });
});

/* ================= keyboard and focus ================= */

describe("every row is reachable and returns focus by its own key", () => {
  test("each row carries a stable focus key naming its session", () => {
    for (const agent of INTEGRATED_COHORT) {
      const row = renderRow(agent);
      const keyed = walk(row).find((n) => n.dataset && n.dataset.fkey);
      expect(keyed, `${agent.provider} row exposes no focus key`).toBeTruthy();
      expect(String(keyed.dataset.fkey)).toContain(String(agent.id));
    }
  });

  test("the real cluster walk gives the child its depth and the parent its count", () => {
    /* Hand-feeding `{ depth: 1 }` proved only that renderAgentRow accepts a
       number. The tree is built by agentRowPlan from `parentAgentId`, so the
       PLAN is what gets exercised: a fixture naming the wrong parent field
       rendered as an orphan while every hand-fed depth assertion still passed. */
    const agents = [R10_OPENCODE_PARENT, R11_OPENCODE_CHILD];
    const program = { id: "prog_synthetic", name: "Parity fixture", agents };
    const snap = {
      generatedAt: "2026-07-22T02:45:00.000Z",
      agents,
      programs: [program],
      totals: { sourceHealth: { total: 1, healthy: 1, degraded: 0, absent: 0, byProvider: { opencode: { healthy: true } } } },
    };
    const base = { ...M.state, snap, view: "board", lookbackHours: 24 * 365 * 20, showReviewWorkers: true };

    const planWith = (overrides: Map<string, string>) => withDom(() => {
      M.state.view = "board";
      const ui = { ...base, swarmOverrides: overrides };
      return M.agentRowPlan(program, agents, ui)
        .map((entry: { key: string; build: () => unknown }) => ({ key: entry.key, node: entry.build() }));
    });

    /* agentRowPlan returns reconcile entries — `{ key, sig, build }` — where
       `build()` is the thunk the board calls to produce the node. Driving that
       thunk is what makes this the REAL walk: depth and child count are whatever
       the cluster builder decided from `parentAgentId`, with nothing passed in
       by hand for the renderer to echo back.

       COLLAPSED first, because that is the board's default and the child is
       correctly not drawn — the parent stands for it. */
    const collapsed = planWith(new Map());
    const find = (built: Array<{ key: string }>, id: string) =>
      built.find((b) => b.key.includes(id));

    const parent = find(collapsed, String(R10_OPENCODE_PARENT.id));
    expect(parent, "the parent never reached the plan").toBeTruthy();
    expect(find(collapsed, String(R11_OPENCODE_CHILD.id)),
      "a collapsed swarm drew its child as a row").toBeFalsy();

    /* The parent is marked as one and its control counts the child the walk
       actually found — a count that comes from the linkage, not from opts. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parentNode = (parent as any).node;
    expect(classNames(parentNode), "the parent was not marked as a parent").toContain("is-parent");
    const chip = walk(parentNode).find((n) => String(n.className || "").split(/\s+/).includes("swarm-chip"));
    expect(chip, "the parent rendered no swarm control").toBeTruthy();
    expect(chip.attributes["aria-expanded"], "the collapsed swarm does not report its state").toBe("false");
    /* BOUNDED: the whole accessible name, not a prefix. A name carrying a second
       number — a stale count, a depth, an id fragment — would satisfy a prefix
       match while telling the operator something untrue about what the caret
       reveals. */
    expect(String(chip.attributes["aria-label"] || ""), "the collapsed swarm's accessible name")
      .toBe("Expand 1 subagents under " + R10_OPENCODE_PARENT.displayName);

    /* OPENED: the same walk now draws the child, nested. */
    const opened = planWith(new Map([[String(R10_OPENCODE_PARENT.id), "open"]]));
    const child = find(opened, String(R11_OPENCODE_CHILD.id));
    expect(child, "opening the swarm drew no child — the walk never linked them").toBeTruthy();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const childClasses = classNames((child as any).node);
    expect(childClasses, "the child rendered as a root — the cluster walk did not link it")
      .toContain("is-child");
    expect(childClasses, "the child rendered at the wrong depth").toContain("depth-1");

    /* And the same control, opened, flips both the state and the verb — pinned
       whole for the same reason. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const openParent = find(opened, String(R10_OPENCODE_PARENT.id)) as any;
    const openChip = walk(openParent.node)
      .find((n) => String(n.className || "").split(/\s+/).includes("swarm-chip"));
    expect(openChip.attributes["aria-expanded"], "the open swarm still reports itself collapsed").toBe("true");
    expect(String(openChip.attributes["aria-label"] || ""), "the expanded swarm's accessible name")
      .toBe("Collapse 1 subagents under " + R10_OPENCODE_PARENT.displayName);
  });

  test("Arrow, Home and End walk the rows; Enter and Escape pass through (physical focus RESTORATION is not exercised here)", () => {
    /* The exported handler, driven against real nodes.

       HONEST LIMIT, stated in the title rather than buried: this proves the
       navigation handler moves focus and refuses keys it does not own, and that
       a row's focus key is stable across renders. It does NOT prove that focus
       physically returns to the originating row after the Inspector closes —
       that restoration runs against a live document during a repaint, and this
       harness has no such document. Stable-key equality is a precondition for
       restoration, not evidence of it, and treating it as proof is exactly the
       overclaim this note exists to prevent. The 390px and 1600px browser lane
       owns that check. */
    expect(M.nextRowIndex(-1, "ArrowDown", 3), "Down from nowhere does not enter at the top").toBe(0);
    expect(M.nextRowIndex(-1, "ArrowUp", 3), "Up from nowhere does not enter at the bottom").toBe(2);
    expect(M.nextRowIndex(0, "ArrowUp", 3), "Up at the top wrapped instead of holding").toBe(0);
    expect(M.nextRowIndex(2, "ArrowDown", 3), "Down at the bottom wrapped instead of holding").toBe(2);
    expect(M.nextRowIndex(1, "Home", 3)).toBe(0);
    expect(M.nextRowIndex(1, "End", 3)).toBe(2);
    /* A key the row list does not own is left to the browser. */
    expect(M.nextRowIndex(1, "Enter", 3), "Enter was treated as navigation").toBe(-1);

    const rows = allProviderRows(PROVIDERS).slice(0, 3).map((agent) => renderRow(agent));
    const focused: unknown[] = [];
    for (const r of rows) r.focus = () => focused.push(r);

    /* The handler walks up from the event target with `closest`, which is how it
       refuses a keystroke that began inside a rename field. The fake DOM has no
       ancestor chain, so the target answers for itself: it IS the row, and it is
       not inside an input. */
    const targetOf = (row: unknown) => ({
      closest: (sel: string) => (sel.includes("input") ? null : row),
    });

    const press = (key: string, extra: Record<string, unknown> = {}) => {
      let prevented = false;
      const handled = M.handleRowNavigation(
        { key, preventDefault: () => { prevented = true; }, target: targetOf(rows[0]), ...extra },
        rows,
      );
      return { handled, prevented };
    };

    /* NOT DUPLICATED HERE. tests/web-client.test.ts already drives this exact
       handler for ArrowDown/ArrowUp/Home/End with exact landing targets, both
       boundary clamps, preventDefault semantics, and Enter/Escape pass-through.
       Re-asserting it against the same handler would be a second copy of one
       contract, and the first divergence between the copies would be invisible.

       What this file adds is the part that is about HARNESS PARITY rather than
       about the handler: that the navigable set is the fourteen-provider board,
       and that each provider's row key is stable enough to be returned to. */
    expect(press("ArrowDown").handled, "the provider rows are not navigable at all").toBe(true);
    expect(press("ArrowDown").prevented, "row navigation did not consume the keystroke").toBe(true);
    expect(rows.length, "the navigable set is not the provider roster").toBe(3);

    /* And a keystroke that began inside a rename field belongs to the field. */
    const inField = M.handleRowNavigation(
      { key: "ArrowDown", preventDefault: () => {}, target: { closest: (sel: string) => (sel.includes("input") ? {} : rows[0]) } },
      rows,
    );
    expect(inField, "an arrow typed inside a rename field was stolen by row navigation").toBe(false);

    /* Focus keys are stable across renders, which is what makes focus RETURN
       possible after the Inspector closes: the board finds the row again by key. */
    for (const agent of allProviderRows(PROVIDERS)) {
      const keyOf = (node: unknown) =>
        String((walk(node).find((n) => n.dataset && n.dataset.fkey) || { dataset: {} }).dataset.fkey || "");
      const key = keyOf(renderRow(agent));
      /* NONEMPTY AND EXACT, before stability is compared. Two rows that both
         expose no key at all are trivially "stable" — `"" === ""` — so the
         stability assertion alone certified a board with no focus keys, which is
         a board no keyboard operator can return to. */
      expect(key, `${agent.provider}'s row exposes an empty focus key`).not.toBe("");
      expect(key, `${agent.provider}'s focus key is not the agent's own`)
        .toBe("agent:" + String(agent.id));
      expect(keyOf(renderRow(agent)), `${agent.provider}'s focus key is not stable across renders`)
        .toBe(key);
    }
  });

  test("a collapsed parent offers an Expand control that says so", () => {
    /* Closed and open are two different renders, and the earlier draft only ever
       built one of them — so `aria-expanded` was never observed changing, which
       is the only thing that makes it a state rather than a decoration. */
    const row = renderRow(R10_OPENCODE_PARENT, { childCount: 3, swarmOpen: false });
    expect(classNames(row), "a row with children is not marked as a parent").toContain("is-parent");

    const chip = walk(row).find((n) => String(n.className || "").split(/\s+/).includes("swarm-chip"));
    expect(chip, "a parent with visible children rendered no swarm control").toBeTruthy();
    expect(chip.tagName, "the swarm control is not operable").toBe("button");
    expect(chip.attributes["aria-expanded"], "the collapsed swarm does not report its state").toBe("false");
    const name = String(chip.attributes["aria-label"] || "");
    expect(name, "the collapsed control does not say what pressing it does").toMatch(/^Expand /);
    expect(name, "the control does not say how many sessions it reveals").toContain("3");

    /* The caret takes its own focus key, so a keyboard operator who opens a
       swarm is not dropped onto the row beneath the control they just pressed. */
    expect(String(chip.dataset.fkey)).toBe("swarm:" + R10_OPENCODE_PARENT.id);
  });

  test("an expanded parent flips both the state and the verb", () => {
    const row = renderRow(R10_OPENCODE_PARENT, { childCount: 3, swarmOpen: true });
    const chip = walk(row).find((n) => String(n.className || "").split(/\s+/).includes("swarm-chip"));
    expect(chip.attributes["aria-expanded"], "the open swarm still reports itself collapsed").toBe("true");
    const name = String(chip.attributes["aria-label"] || "");
    expect(name, "the open control still offers to Expand what is already open").toMatch(/^Collapse /);
    expect(classNames(chip)).toContain("is-open");
  });
});

/* ============== FE-SOURCE-REPAIR — public seams the green floor missed ==============
 *
 * Three of the five defects that survived the first source candidate. The other
 * two are Settings tiles and live in tests/settings-collectors-dom.test.ts.
 *
 * Each case renders through the same public entry points the rest of this file
 * uses, and each one fails on its own received/expected delta rather than on
 * setup, so a red here names a source defect and nothing else.
 */

test("FE-SOURCE-REPAIR-1 a providerless dual-mark group is named for the unknown harness, not for undefined", () => {
  /* harnessAgentMarks composes its group name as
     HARNESS_MARK[harnessKeyOf(agent)]?.label || providerLabel(agent.provider).
     A record with no provider keys to UNKNOWN_HARNESS, which HARNESS_MARK does
     not carry, so the fallback asks the label catalog about undefined and is
     handed undefined straight back. The group a screen reader announces reads
     "Harness undefined" on the one row whose harness is genuinely unknown,
     while the mark INSIDE that same group already says "not recorded". Two
     answers to one question, one subtree apart. */
  for (const [surface, root] of [
    ["row", renderRow(R20_MISSING_PROVIDER)],
    ["Inspector", renderDrawer(R20_MISSING_PROVIDER)],
  ] as const) {
    /* EVERY dual-mark carrier, collected before anything is read off one.
       findClass answers with the FIRST match, so a repair that left the wrong
       group in place and appended a corrected one beside it would be certified
       by whichever the walk reached first, and the operator would still hear
       two contradictory names for one harness. */
    const groups = walk(root).filter((n) =>
      String(n.className || "").split(/\s+/).includes("dual-marks"));
    expect(groups.length,
      `the ${surface} renders ${groups.length} dual-marks groups for a providerless record, not one`)
      .toBe(1);
    const group = groups[0];
    expect(group.attributes.role, `the ${surface} dual-mark group is not a group`).toBe("group");

    /* And the one carrier has to REACH both audiences. A group whose name is
       perfectly correct but which sits inside a hidden wrapper, or which is
       itself aria-hidden, states the harness to nobody — and every assertion
       below would go green on it. Visual and accessibility hiding are checked
       separately because they fail in opposite directions. */
    expect(hiddenHere(group), `the ${surface} dual-mark group is hidden from sight`).toBe(false);
    expect(a11yHidden(group),
      `the ${surface} dual-mark group is hidden from the accessibility tree`).toBe(false);

    const name = String(group.attributes["aria-label"] || "");
    expect(name, `the ${surface} dual-mark group has no accessible name at all`).toBeTruthy();
    expect(name, `the ${surface} dual-mark group announces "${name}" and never names the unknown harness`)
      .toContain("Harness not recorded");
    expect(name, `the ${surface} dual-mark group leaked a JavaScript undefined into "${name}"`)
      .not.toMatch(/undefined/i);

    /* The rest of the subtree was already honest and has to stay that way: this
       repair belongs in the group name, not in the mark, the root or a class. */
    const mark = walk(group).find((n) => String(n.className || "").includes("harness-mark"));
    expect(mark, `the ${surface} dual-mark group carries no harness mark`).toBeTruthy();
    expect(mark.tagName, `the ${surface} unknown harness resolved to an image`).toBe("span");
    expect(String(mark.className), `the ${surface} unknown mark lost its unknown state`)
      .toContain("is-unknown");
    expect(String(mark.attributes["aria-label"] || ""),
      `the ${surface} harness mark changed the accessible name it already got right`)
      .toBe("Harness not recorded");
    for (const cls of classNames(root)) {
      expect(cls, `the ${surface} carries a class "${cls}" ending in undefined`).not.toMatch(/undefined$/);
    }
  }
});

test("FE-SOURCE-REPAIR-2 the canonical harness label a row prints finds that row when the session name was authored", () => {
  /* matchesQuery hays agentName(agent) and the raw record fields. A session
     whose server identity was AUTHORED — the normal shape for a named lane —
     never reaches the provider-derived fallback name, so the only string on the
     row that carries the harness is the one the label catalog produces for the
     harness cell, and that string is in no field of the haystack. Nine
     providers hide the defect because their raw key already spells their label
     in lower case; the five qualified labels have no such cover. */
  const NEUTRAL: SyntheticRow[] = PROVIDERS.map((p, i) => ({
    id: `${p}:ses_synthetic_repair_${i}`,
    programId: "prog_synthetic",
    provider: p,
    sourceSessionId: `ses_synthetic_repair_${i}`,
    identity: { name: `lane-${i}`, base: `lane-${i}`, source: "authored" },
    displayName: `lane-${i}`,
    model: "synthetic-model-1",
    task: "Authored lane row.",
    cwd: "/synthetic/workspace/lane",
    status: "running",
    activity: "working",
    outcome: "healthy",
    lifecycle: "working",
    scope: "observed",
    startedAt: "2026-07-22T02:00:00.000Z",
    updatedAt: "2026-07-22T02:40:00.000Z",
    artifacts: [],
    gates: [],
    tokens: { provenance: "observed", scope: "latest-turn", input: 90, output: 30, total: 1200, contextWindow: 200_000 },
  }));
  const progName = "Authored lane board";
  const prog = { id: "prog_synthetic", name: progName, agents: NEUTRAL };
  /* The five whose canonical label is not merely their raw key in prettier
     case. For these the label seam is the only remaining path, and that is
     proven mechanically below rather than asserted by inspection. */
  const QUALIFIED = ["claude", "grok", "muse", "copilot", "gemini"];

  expect(NEUTRAL.length, "the authored cohort no longer covers the whole roster").toBe(PROVIDERS.length);

  for (const agent of NEUTRAL) {
    const p = String(agent.provider);
    /* The query is read off the RENDERED row rather than a table in this file,
       so it is exactly the string an operator can see and would type. */
    const label = harnessCellText(renderRow(agent));
    expect(label, `the ${p} row prints no harness label to search for`).toBe(TF.providerLabel(p));

    if (QUALIFIED.includes(p)) {
      const elsewhere = [
        p, agent.cwd, agent.task, agent.model, agent.displayName,
        (agent.identity as { name: string }).name, M.agentName(agent),
        agent.sourceSessionId, agent.status, progName,
      ].join(" ").toLowerCase();
      expect(elsewhere, `the ${p} row can answer "${label}" without the label seam at all`)
        .not.toContain(label.toLowerCase());
    }

    expect(M.matchesQuery(agent, prog, label.toLowerCase()),
      `searching the exact label "${label}" that the ${p} row prints does not find that row`).toBe(true);
  }

  /* And widening the haystack must not make search answer yes to everything: a
     record with no provider answers to no harness label at all. */
  for (const p of PROVIDERS) {
    const label = TF.providerLabel(p);
    expect(M.matchesQuery(R20_MISSING_PROVIDER, prog, label.toLowerCase()),
      `the providerless row answers to "${label}"`).toBe(false);
  }
});

test("FE-SOURCE-REPAIR-3 R14 says its OCCUPANCY is unreported, not its window", () => {
  /* R14 carries a context window of 1,048,576 tokens and no observed total. The
     window is known; only the occupancy is missing. The cell tooltip answers
     "Context window not reported for this model", which contradicts the very
     figure the record supplied and tells the operator the wrong thing is
     absent. The window-not-reported wording belongs to the control below, and
     to nothing else. */
  const row = renderRow(R14_GEMINI_UNKNOWN_USAGE);
  const ctx = findClass(row, "ri-ctx");
  expect(ctx, "the context cell vanished entirely").toBeTruthy();

  const title = String(ctx.attributes.title || "");
  expect(title,
    `R14 declares a finite contextWindow, yet its context cell reads "${title}"`)
    .toBe("Context occupancy not reported for this session");
  expect(title, "the context tooltip carries a percentage it has no total to compute")
    .not.toMatch(/\d+(\.\d+)?\s*%/);

  /* The control that keeps the two absences distinguishable: a session whose
     window really is absent must keep the window wording, so a repair that
     simply renamed one sentence into the other fails here. */
  const noWindow = renderRow({
    ...R14_GEMINI_UNKNOWN_USAGE,
    id: "gemini:ses_synthetic_repair_nowindow",
    sourceSessionId: "ses_synthetic_repair_nowindow",
    tokens: { provenance: "observed", scope: "session" },
  });
  const noWindowCtx = findClass(noWindow, "ri-ctx");
  expect(noWindowCtx, "the absent-window control rendered no context cell").toBeTruthy();
  const noWindowTitle = String(noWindowCtx.attributes.title || "");
  expect(noWindowTitle, "the absent-window control borrowed the occupancy sentence")
    .not.toBe("Context occupancy not reported for this session");
  expect(noWindowTitle, "the absent-window control stopped saying the window is unreported")
    .toMatch(/window/i);
});
