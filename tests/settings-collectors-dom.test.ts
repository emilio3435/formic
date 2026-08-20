import { beforeAll, describe, expect, test } from "bun:test";
// @ts-expect-error the dependency-free browser client has no declaration file
import { fetchCollectorInstances } from "../src/web/settings-collectors.js";

/* Same TheAntHill import as tests/grok.test.ts. The settings dialog has no
   dedicated DOM test, so this file paints it through the real renderer. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let web: any;

beforeAll(async () => {
  // @ts-expect-error the dependency-free browser client has no declaration file
  await import("../src/web/app.js");
  web = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
});

interface FakeNode {
  tagName: string;
  nodeType: number;
  className: string;
  classList: { add(...c: string[]): void; contains(c: string): boolean };
  attributes: Record<string, string>;
  dataset: Record<string, string>;
  children: FakeNode[];
  textContent: string;
  parent: FakeNode | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

let byId = new Map<string, FakeNode>();

function attrOf(node: FakeNode, name: string): string | undefined {
  if (node.attributes && name in node.attributes) return node.attributes[name];
  if (name.startsWith("data-") && node.dataset) {
    const camel = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (camel in node.dataset) return String(node.dataset[camel]);
  }
  return undefined;
}

function matchCompound(node: FakeNode, sel: string): boolean {
  if (sel.startsWith("#")) return (node.attributes?.id || "") === sel.slice(1);
  let rest = sel;
  let tag = "";
  const tagMatch = /^([a-zA-Z][\w-]*)/.exec(rest);
  if (tagMatch && !rest.startsWith("[")) {
    tag = tagMatch[1]!;
    rest = rest.slice(tag.length);
  }
  if (tag && node.tagName !== tag) return false;
  const re = /\[([^=\]]+)(?:=['"]([^'"]*)['"])?\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest))) {
    const val = attrOf(node, m[1]!);
    if (m[2] !== undefined) {
      if (val !== m[2]) return false;
    } else if (val == null) return false;
  }
  return true;
}

/* The fake document's `querySelector` is typed by lib.dom as returning
   `Element | null`, but every node in this file is a FakeNode built by
   `makeNode`. Casting at each of the seventeen call sites would bury the
   assertions in noise, so the two readers accept either and narrow once. */
type AnyNode = FakeNode | Element | null;

const asFake = (node: AnyNode): FakeNode | null => (node as unknown as FakeNode | null) ?? null;

function walkNodes(input: AnyNode, out: FakeNode[] = [], seen = new Set<FakeNode>()): FakeNode[] {
  const node = asFake(input);
  if (!node || seen.has(node)) return out;
  seen.add(node);
  if (node.nodeType === 1) out.push(node);
  for (const kid of node.children || []) walkNodes(kid, out, seen);
  return out;
}

function queryFrom(roots: Iterable<FakeNode>, selector: string): FakeNode | null {
  const parts = selector.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const seen = new Set<FakeNode>();
  const pool: FakeNode[] = [];
  for (const root of roots) walkNodes(root, pool, seen);
  if (parts.length === 1) return pool.find((node) => matchCompound(node, parts[0]!)) ?? null;
  for (const start of pool) {
    if (!matchCompound(start, parts[0]!)) continue;
    const desc: FakeNode[] = [];
    for (const kid of start.children || []) walkNodes(kid, desc);
    const hit = desc.find((node) => matchCompound(node, parts.slice(1).join(" ")))
      ?? desc.find((node) => matchCompound(node, parts[1]!));
    if (hit) return hit;
  }
  return null;
}

function makeNode(tag: string): FakeNode {
  const classes = new Set<string>();
  const attributes: Record<string, string> = {};
  const dataset: Record<string, string> = {};
  let text = "";
  const node = {
    tagName: tag,
    nodeType: 1,
    attributes,
    dataset,
    children: [] as FakeNode[],
    parent: null as FakeNode | null,
    listeners: {} as Record<string, Array<(event: unknown) => unknown>>,
    get textContent() {
      return text + node.children.map((kid) => kid.textContent ?? "").join("");
    },
    set textContent(v: string) {
      text = String(v ?? "");
      node.children.length = 0;
    },
    get className() { return [...classes].join(" "); },
    set className(v: string) {
      classes.clear();
      for (const c of String(v).split(/\s+/)) if (c) classes.add(c);
    },
    classList: {
      add(...c: string[]) { for (const x of c) if (x) classes.add(x); },
      remove(...c: string[]) { for (const x of c) classes.delete(x); },
      toggle(c: string, on?: boolean) {
        if (on === undefined ? classes.has(c) : !on) classes.delete(c);
        else classes.add(c);
      },
      contains(c: string) { return classes.has(c); },
    },
    disabled: false,
    get childNodes() { return node.children; },
    get childElementCount() { return node.children.length; },
    get firstChild() { return node.children[0] || null; },
    get nextSibling() { return null; },
    get hidden() { return "hidden" in attributes; },
    set hidden(v: boolean) {
      if (v) node.setAttribute("hidden", "");
      else node.removeAttribute("hidden");
    },
    setAttribute(k: string, v: unknown) {
      attributes[k] = String(v);
      if (k === "id" && v) byId.set(String(v), node as unknown as FakeNode);
      if (k === "type") (node as { type?: string }).type = String(v);
      if (k === "disabled") (node as { disabled?: boolean }).disabled = true;
    },
    removeAttribute(k: string) {
      delete attributes[k];
      if (k === "disabled") (node as { disabled?: boolean }).disabled = false;
    },
    hasAttribute(k: string) { return k in attributes; },
    getAttribute(k: string) { return attributes[k]; },
    addEventListener(type: string, fn: (event: unknown) => unknown) {
      (node.listeners[type] ??= []).push(fn);
    },
    append(...kids: unknown[]) {
      for (const kid of kids) {
        if (kid == null) continue;
        node.children.push(kid as FakeNode);
        if (typeof kid === "object" && kid !== null && "parent" in (kid as FakeNode)) {
          (kid as FakeNode).parent = node as unknown as FakeNode;
        }
      }
    },
    insertBefore(child: FakeNode) { node.append(child); },
    remove() {},
    querySelector(sel: string) { return queryFrom([node as unknown as FakeNode], sel); },
    querySelectorAll() { return [] as unknown[]; },
    focus() {},
  };
  return node as unknown as FakeNode;
}

function installDom() {
  byId = new Map();
  const panel = makeNode("div");
  panel.setAttribute("id", "settings-panel");
  const toggle = makeNode("button");
  toggle.setAttribute("id", "settings-toggle");
  const doc = {
    createElement: (t: string) => makeNode(t),
    createElementNS: (_ns: string, t: string) => makeNode(t),
    createTextNode: (s: string) => ({ nodeType: 3, textContent: String(s) }),
    getElementById: (id: string) => byId.get(id) ?? null,
    querySelector: (sel: string) => queryFrom(byId.values(), sel),
    querySelectorAll: () => [] as unknown[],
    body: makeNode("body"),
  };
  (globalThis as unknown as { document: unknown }).document = doc;
}

function uninstallDom() {
  delete (globalThis as unknown as { document?: unknown }).document;
}

function withDom<T>(fn: () => T): T {
  installDom();
  try { return fn(); } finally { uninstallDom(); }
}

async function withDomAsync<T>(fn: () => Promise<T>): Promise<T> {
  installDom();
  try { return await fn(); } finally { uninstallDom(); }
}

/* The text a sighted operator can actually read.

   `textContent` walks every descendant, hidden ones included, and
   styles.css sets `[hidden] { display: none !important; }` — deliberately
   !important, so nothing can un-hide what the client hid. A collector tile
   carries its board consequence in a `title` attribute and in a `hidden`
   span, which means an assertion on `textContent` passes while the sentence
   is on screen for nobody: not a keyboard user, not a touch user, not a
   screen-reader user. Only hovering a mouse reveals it.

   Every assertion below that claims an operator can READ something goes
   through here instead. */

/* Classes whose whole job is to remove text from the page while leaving it in
   the accessibility tree. `.visually-hidden` (styles.css:139) clips to a 1px
   rect; a screen reader still reads it, a sighted operator never sees it. For
   "can a sighted operator read this?" that is just as hidden as [hidden], and
   omitting it would let a fix satisfy these tests by swapping one hiding
   mechanism for another. */
const CSS_HIDDEN_CLASSES = ["visually-hidden", "sr-only", "screen-reader-only"];

function isHidden(node: FakeNode): boolean {
  const attrs = node.attributes || {};
  if ("hidden" in attrs) return true;
  /* aria-hidden removes a node from the accessibility tree while leaving it on
     screen. It is not the same as CSS hiding and it is not interchangeable with
     it — but a node carrying it is not a carrier this dialog may rely on for a
     sentence an operator must READ, because the two hiding mechanisms together
     are how a "visible" string ends up reaching nobody. */
  if (String(attrs["aria-hidden"] || "") === "true") return true;
  if (/(^|;)\s*display:\s*none/.test(String(attrs.style || ""))) return true;
  if (/(^|;)\s*visibility:\s*hidden/.test(String(attrs.style || ""))) return true;
  const classes = String(node.className || "").split(/\s+/);
  return CSS_HIDDEN_CLASSES.some((c) => classes.includes(c));
}

/** Hidden by this node's own state, or by anything above it.
 *
 *  Hiding is INHERITED. A perfectly visible <b> inside a `hidden` wrapper is on
 *  screen for nobody, and a self-only check would certify it — which is exactly
 *  the mutation "wrap the honest element instead of altering it". */
function hiddenHere(input: AnyNode): boolean {
  let cur = asFake(input);
  while (cur) {
    if (isHidden(cur)) return true;
    cur = cur.parent;
  }
  return false;
}

function visibleText(input: AnyNode): string {
  const node = asFake(input);
  if (!node) return "";
  if (hiddenHere(node)) return "";
  if (node.nodeType === 3) return String(node.textContent ?? "");
  if (isHidden(node)) return "";
  const own = node.children?.length ? "" : String(node.textContent ?? "");
  return own + (node.children || []).map((kid) => visibleText(kid)).join("");
}

describe("Settings Collectors inventory", () => {
  test("Collectors lists found extras and does not offer Off on a default", () => {
    const instances = [
      { id: "cursor-gui:cursor", kind: "cursor-gui", label: "Cursor", dataDir: "/Users/me/Library/Application Support/Cursor", default: true, onboarded: true, ignored: false },
      { id: "cursor-gui:cursor-2", kind: "cursor-gui", label: "Cursor-2", dataDir: "/Users/me/Library/Application Support/Cursor-2", default: false, onboarded: false, ignored: false },
      { id: "grok-bot:grok-bot-2", kind: "grok-bot", label: "Grok Bot 2", dataDir: "/Users/me/Library/Application Support/Grok Bot 2", default: false, onboarded: false, ignored: false, reason: "needs-parser" },
    ];
    withDom(() => {
      web.state.collectorInstances = instances;
      web.state.collectorInstancesPending = false;
      web.state.settingsPanelOpen = true;
      if (web.state.paintSig) web.state.paintSig.settings = "";
      web.renderSettingsPanel();
      expect(document.getElementById("settings-collectors")).toBeTruthy();
      expect(document.querySelector("[data-instance='cursor-gui:cursor'] [data-fkey='instance-off']")).toBeNull();
      expect(document.querySelector("[data-instance='cursor-gui:cursor-2'] input[type='checkbox']")).toBeTruthy();
      /* Strengthened: the consequence must be READABLE, not merely present in
         the DOM behind a `hidden` attribute and a hover-only title. */
      expect(visibleText(document.querySelector("[data-group='needs-parser'] [data-instance='grok-bot:grok-bot-2']")))
        .toMatch(/will not appear on the board/);
    });
  });

  test("an imported parser home does not look collected and names the board consequence", () => {
    const instances = [
      { id: "cursor-gui:cursor", kind: "cursor-gui", label: "Cursor", dataDir: "/Users/me/Library/Application Support/Cursor", default: true, onboarded: true, ignored: false },
      { id: "grok-bot:grok-bot-2", kind: "grok-bot", label: "Grok Bot 2", dataDir: "/Users/me/Library/Application Support/Grok Bot 2", default: false, onboarded: true, ignored: false, reason: "needs-parser" },
    ];
    withDom(() => {
      web.state.collectorInstances = instances;
      web.state.collectorInstancesPending = false;
      web.state.settingsPanelOpen = true;
      if (web.state.paintSig) web.state.paintSig.settings = "";
      web.renderSettingsPanel();
      expect(document.querySelector("[data-instance='cursor-gui:cursor'] input[type='checkbox']")).toBeNull();
      expect(visibleText(document.querySelector("[data-instance='cursor-gui:cursor']"))).toMatch(/Collecting/);
      expect(visibleText(document.querySelector("[data-group='imported-no-rows'] [data-instance='grok-bot:grok-bot-2']")))
        .toMatch(/No board rows/i);
      /* And the sentence must not be reachable ONLY through a title attribute:
         a tooltip is not a rendering. */
      const tile = document.querySelector("[data-group='imported-no-rows'] [data-instance='grok-bot:grok-bot-2']");
      /* `attributes` on a real Element is a NamedNodeMap, which has no `.title`.
         The attribute is read through the DOM accessor both node kinds share. */
      expect(tile?.getAttribute("title"), "the tile lost its hover text as well")
        .toMatch(/No board rows/i);
      expect(document.querySelector("[data-instance='grok-bot:grok-bot-2']")?.className).not.toMatch(/settings-field(?!-)/);
    });
  });

  test("Import selected is a ghost and disabled until a box is checked", () => {
    const instances = [
      { id: "cursor-gui:cursor", kind: "cursor-gui", label: "Cursor", dataDir: "/Users/me/Library/Application Support/Cursor", default: true, onboarded: true, ignored: false },
      { id: "cursor-gui:cursor-2", kind: "cursor-gui", label: "Cursor-2", dataDir: "/Users/me/Library/Application Support/Cursor-2", default: false, onboarded: false, ignored: false },
    ];
    withDom(() => {
      web.state.collectorInstances = instances;
      web.state.collectorInstancesPending = false;
      web.state.settingsPanelOpen = true;
      if (web.state.paintSig) web.state.paintSig.settings = "";
      web.renderSettingsPanel();
      const btn = document.querySelector("[data-fkey='collectors-import']") as HTMLButtonElement | null;
      expect(btn?.className.split(/\s+/)).not.toContain("primary");
      expect(btn?.disabled).toBe(true);
    });
  });

  test("home tiles wear harness marks and a waiting Claude is amber", () => {
    const instances = [
      { id: "cursor-gui:cursor", kind: "cursor-gui", label: "Cursor", dataDir: "/Users/me/Library/Application Support/Cursor", default: true, onboarded: true, ignored: false },
      { id: "grok-bot:grok-bot-2", kind: "grok-bot", label: "Grok Bot 2", dataDir: "/Users/me/Library/Application Support/Grok Bot 2", default: false, onboarded: true, ignored: false, reason: "needs-parser" },
      { id: "claude:claude", kind: "claude", label: "Claude", dataDir: "/Users/me/.claude", default: false, onboarded: false, ignored: false, reason: "needs-parser" },
      { id: "muse:muse", kind: "muse", label: "Muse", dataDir: "/Users/me/.local/share/muse", default: false, onboarded: false, ignored: true },
      { id: "copilot:dot-copilot", kind: "copilot", label: ".copilot", dataDir: "/Users/me/.copilot", default: true, onboarded: true, ignored: false },
      { id: "gemini-cli:dot-gemini", kind: "gemini-cli", label: ".gemini", dataDir: "/Users/me/.gemini", default: true, onboarded: true, ignored: false },
      { id: "hermes:dot-hermes", kind: "hermes", label: "Hermes", dataDir: "/Users/me/.hermes", default: true, onboarded: true, ignored: false },
    ];
    withDom(() => {
      web.state.collectorInstances = instances;
      web.state.collectorInstancesPending = false;
      web.state.settingsPanelOpen = true;
      if (web.state.paintSig) web.state.paintSig.settings = "";
      web.renderSettingsPanel();
      const cursor = document.querySelector("[data-instance='cursor-gui:cursor'] img");
      expect(cursor?.getAttribute("src")).toMatch(/cursor\.svg/);
      const grok = document.querySelector("[data-instance='grok-bot:grok-bot-2'] img");
      expect(grok?.getAttribute("src")).toMatch(/grok\.svg/);
      const waiting = document.querySelector("[data-instance='claude:claude']");
      expect(waiting?.className).toMatch(/is-wait/);
      expect(document.querySelector("[data-instance='claude:claude'] input[type='checkbox']")).toBeTruthy();
      expect(document.querySelector("[data-instance='muse:muse'] [data-fkey='instance-restore']")).toBeTruthy();
      expect(document.querySelector("[data-group='needs-parser'] [data-instance='copilot:dot-copilot']")).toBeNull();
      expect(visibleText(document.querySelector("[data-instance='copilot:dot-copilot']"))).toMatch(/Collecting/);
      expect(document.querySelector("[data-instance='gemini-cli:dot-gemini'] img")?.getAttribute("src"))
        .toBe("/icons/gemini-cli.svg");
      const hermes = document.querySelector("[data-instance='hermes:dot-hermes']") as unknown as FakeNode | null;
      expect(hermes?.children[0]).toMatchObject({ tagName: "span", textContent: "H" });
      expect(hermes?.children[0]?.className).toContain("home-letter");
    });
  });

  test("collector fetch paints homes without remounting the span", async () => {
    const waiting = [
      { id: "claude:claude", kind: "claude", label: "Claude", dataDir: "/Users/me/.claude", default: false, onboarded: false, ignored: false, reason: "needs-parser" },
    ];
    const instances = [
      { id: "cursor-gui:cursor", kind: "cursor-gui", label: "Cursor", dataDir: "/Users/me/Library/Application Support/Cursor", default: true, onboarded: true, ignored: false },
      ...waiting,
    ];
    await withDomAsync(async () => {
      web.state.collectorInstances = waiting;
      web.state.collectorInstancesPending = false;
      web.state.settingsPanelOpen = true;
      web.state.settings = {
        activityFreshMinutes: 3,
        activityQuietMinutes: 45,
        scanWindowHours: 36,
        providerWaitMs: 7500,
        historyRetentionDays: 30,
        historyRecordLimit: 5000,
      };
      if (web.state.paintSig) web.state.paintSig.settings = "";
      web.renderSettingsPanel();
      const quiet = document.getElementById("setting-activityQuietMinutes") as unknown as { value: string };
      quiet.value = "12";
      const box = document.querySelector("[data-instance='claude:claude'] input[type='checkbox']") as { checked?: boolean } | null;
      expect(box).toBeTruthy();
      box!.checked = true;
      expect(document.querySelector("[data-instance='cursor-gui:cursor']")).toBeNull();

      const previousFetch = (globalThis as { fetch?: unknown }).fetch;
      (globalThis as { fetch: unknown }).fetch = async () => ({
        ok: true,
        json: async () => ({ ok: true, instances }),
      });
      try {
        await fetchCollectorInstances();
      } finally {
        (globalThis as { fetch?: unknown }).fetch = previousFetch;
      }

      expect(document.querySelector("[data-instance='cursor-gui:cursor']")).toBeTruthy();
      expect((document.getElementById("setting-activityQuietMinutes") as unknown as { value: string }).value).toBe("12");
      const kept = document.querySelector("[data-instance='claude:claude'] input[type='checkbox']") as { checked?: boolean } | null;
      expect(kept?.checked).toBe(true);
      expect((document.querySelector("[data-fkey='collectors-import']") as { disabled?: boolean } | null)?.disabled).toBe(false);
    });
  });
});

/* FE-3 — Settings states its groups and its consequences where they can be read.
 *
 * Two separate silences, confirmed in source:
 *
 *   1. `collectorGroup(title, rows, group)` ACCEPTS a title and never renders
 *      it. All five headings survive only as a `data-group` attribute, which is
 *      announced by nothing and seen by nobody. The dialog shows five unlabelled
 *      slabs of tiles and the operator is left to infer why a home is in one
 *      rather than another.
 *   2. `collectorStatusLine(inst)` reaches the operator only as the tile's
 *      `title` attribute and a `hidden` span. The consequence — whether this
 *      home will produce board rows — is hover-only.
 */
describe("FE-3 Settings Collectors says what it is showing", () => {
  /* The canonical catalog, stated once. The Settings expectations read from
     here rather than carrying their own copies, so the dialog is checked
     against the same roster the row, the Mix and the filter use. */
  const CANONICAL_LABELS: Record<string, string> = {
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

  /** One home in each of the five groups, plus the mark cases. */
  const INSTANCES = [
    { id: "claude:claude", kind: "claude", label: "Claude", dataDir: "/synthetic/.claude", default: true, onboarded: true, ignored: false },
    { id: "opencode:opencode", kind: "opencode", label: "OpenCode", dataDir: "/synthetic/.local/share/opencode", default: true, onboarded: true, ignored: false },
    { id: "pi:pi", kind: "pi", label: "Pi", dataDir: "/synthetic/.pi/agent", default: true, onboarded: true, ignored: false },
    { id: "grok-bot:imported", kind: "grok-bot", label: "Grok Bot 2", dataDir: "/synthetic/grok-bot-2", default: false, onboarded: true, ignored: false, reason: "needs-parser" },
    { id: "cursor-gui:found", kind: "cursor-gui", label: "Cursor-2", dataDir: "/synthetic/Cursor-2", default: false, onboarded: false, ignored: false },
    /* A home whose kind has no HOME_MARK entry at all. OpenCode used to stand in
       for this case; it is wired with an official mark now, so the unmarked case
       needs its own synthetic home or the letter-fallback branch stops being
       exercised by anything. */
    { id: "synthetic-unwired:home", kind: "synthetic-unwired", label: "Unwired Home", dataDir: "/synthetic/unwired", default: false, onboarded: false, ignored: false, reason: "needs-parser" },
    { id: "muse:muse", kind: "muse", label: "Muse", dataDir: "/synthetic/muse", default: false, onboarded: false, ignored: true },
  ];

  const GROUP_HEADINGS: Array<[string, string]> = [
    ["on-board", "On the board"],
    ["imported-no-rows", "Imported, no rows yet"],
    ["found", "Found, not imported"],
    ["needs-parser", "Needs a parser"],
    ["ignored", "Ignored"],
  ];

  function paint() {
    web.state.collectorInstances = INSTANCES;
    web.state.collectorInstancesPending = false;
    web.state.settingsPanelOpen = true;
    if (web.state.paintSig) web.state.paintSig.settings = "";
    web.renderSettingsPanel();
  }

  test("each collector group states its heading as a semantic, readable heading", () => {
    /* Visible text is necessary and not sufficient. These five strings are what
       tells an operator WHY a home is in one slab rather than another, so they
       have to be reachable the way a heading is reachable — by an element that
       announces itself as one, so a screen-reader user can jump between the
       groups instead of hearing five undifferentiated lists of tiles. */
    const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"];
    withDom(() => {
      paint();
      for (const [group, heading] of GROUP_HEADINGS) {
        const node = document.querySelector(`[data-group='${group}']`);
        expect(node, `the ${group} group did not render at all`).toBeTruthy();
        expect(
          visibleText(node),
          `the ${group} group renders its tiles with no visible heading — "${heading}" exists only as a data attribute`,
        ).toContain(heading);

        const carrier = walkNodes(node).find((n) =>
          !isHidden(n) && String(n.textContent || "").trim() === heading);
        expect(carrier, `"${heading}" is not carried by any readable element`).toBeTruthy();
        const semantic = HEADING_TAGS.includes(String(carrier!.tagName).toLowerCase())
          || String(carrier!.attributes?.role || "") === "heading";
        expect(semantic, `"${heading}" renders as a <${carrier!.tagName}> with no heading role`).toBe(true);
      }
    });
  });

  test("each home states ITS OWN consequence, not merely some consequence", () => {
    /* One alternation over five sentences let any tile satisfy the test with any
       other tile's sentence — an ignored home reading "Collecting from …" would
       have passed. Each state is pinned to the sentence that state produces, so
       a fix that renders one line everywhere fails here. */
    const EXPECTED: Array<[string, RegExp]> = [
      ["claude:claude", /Collecting from/],
      ["opencode:opencode", /Collecting from/],
      ["pi:pi", /Collecting from/],
      ["grok-bot:imported", /Imported\. No board rows/],
      ["cursor-gui:found", /Found\. Import to collect from/],
      ["synthetic-unwired:home", /Found\. Import records it; it will not appear on the board\./],
      ["muse:muse", /Ignored\./],
    ];
    expect(EXPECTED.length, "the expectation table drifted from the fixture").toBe(INSTANCES.length);

    withDom(() => {
      paint();
      for (const [id, sentence] of EXPECTED) {
        const tile = document.querySelector(`[data-instance='${id}']`);
        expect(tile, `${id} did not render`).toBeTruthy();
        const shown = visibleText(tile);
        expect(shown, `${id} does not visibly state its own consequence`).toMatch(sentence);

        /* And it states ONLY its own. A tile carrying two states' sentences is
           telling the operator two different things about one home, and a fix
           that rendered every consequence on every tile would satisfy a
           per-tile containment check while making the dialog unreadable. */
        for (const [otherId, otherSentence] of EXPECTED) {
          if (otherId === id) continue;
          if (String(otherSentence) === String(sentence)) continue; // same state, same words
          expect(shown, `${id} also prints the consequence belonging to ${otherId}`)
            .not.toMatch(otherSentence);
        }
      }
    });
  });

  test("each group states its own heading, and no group borrows another's", () => {
    withDom(() => {
      paint();
      for (const [group, heading] of GROUP_HEADINGS) {
        const node = document.querySelector(`[data-group='${group}']`);
        const shown = visibleText(node);
        expect(shown, `the ${group} group does not state "${heading}"`).toContain(heading);
        for (const [other, otherHeading] of GROUP_HEADINGS) {
          if (other === group) continue;
          expect(shown, `the ${group} group also prints the ${other} heading`).not.toContain(otherHeading);
        }
      }
    });
  });

  test("the five moved harness labels reach Settings without losing instance identity", () => {
    /* The fixture feeds the RAW labels the collector actually publishes for a
       default home — the directory basenames ".claude", ".grok", "muse",
       ".copilot", ".gemini". An earlier draft fed "Claude Code" directly and
       then asserted "Claude Code" appeared, which tested the fixture: the dialog
       could have rendered the string with no catalog involved at all.

       Settings names a home by its INSTANCE label, which is how two Claude homes
       stay distinguishable, so the catalog has to qualify the default without
       flattening the custom one. */
    /* ALL FOURTEEN, not only the five whose labels move. A catalog wired for
       the renamed five and left raw for the other nine would satisfy a
       five-provider check while the dialog still showed ".codex" and
       ".opencode" — the exact half-fix this slice exists to prevent.

       The `raw` values are the directory basenames the collector actually
       publishes for a default home; the expectations come from the shared
       catalog, never from this table, so the test cannot pass by agreeing with
       itself. */
    const MOVED = [
      { id: "claude:default", kind: "claude", raw: ".claude", provider: "claude" },
      { id: "codex:default", kind: "codex", raw: ".codex", provider: "codex" },
      { id: "omp:default", kind: "omp", raw: ".omp", provider: "omp" },
      { id: "cursor-gui:default", kind: "cursor-gui", raw: "Cursor", provider: "cursor" },
      { id: "factory:default", kind: "factory", raw: ".factory", provider: "factory" },
      { id: "prime:default", kind: "prime", raw: ".prime", provider: "prime" },
      { id: "grok-cli:default", kind: "grok-cli", raw: ".grok", provider: "grok" },
      { id: "hermes:default", kind: "hermes", raw: ".hermes", provider: "hermes" },
      { id: "muse:default", kind: "muse", raw: "muse", provider: "muse" },
      { id: "antigravity-cli:default", kind: "antigravity-cli", raw: ".antigravity", provider: "antigravity" },
      { id: "copilot:default", kind: "copilot", raw: ".copilot", provider: "copilot" },
      { id: "gemini-cli:default", kind: "gemini-cli", raw: ".gemini", provider: "gemini" },
      { id: "opencode:default", kind: "opencode", raw: "opencode", provider: "opencode" },
      { id: "pi:default", kind: "pi", raw: ".pi", provider: "pi" },
    ].map((m) => ({ ...m, label: CANONICAL_LABELS[m.provider] }));
    const instances = [
      ...MOVED.map((m) => ({
        id: m.id, kind: m.kind, label: m.raw,
        dataDir: `/synthetic/${m.raw}`, default: true, onboarded: true, ignored: false,
      })),
      /* Instance identity: a second Claude home the operator renamed. */
      { id: "claude:work", kind: "claude", label: "work-claude", dataDir: "/synthetic/work-claude", default: false, onboarded: true, ignored: false },
    ];
    withDom(() => {
      web.state.collectorInstances = instances;
      web.state.collectorInstancesPending = false;
      web.state.settingsPanelOpen = true;
      if (web.state.paintSig) web.state.paintSig.settings = "";
      web.renderSettingsPanel();

      for (const { id, raw, label } of MOVED) {
        const tile = document.querySelector(`[data-instance='${id}']`);
        expect(tile, `${id} did not render`).toBeTruthy();
        /* The exact CARRIER, not whole-tile containment. A tile also prints its
           consequence sentence, and "Collecting from …/.gemini" contains the
           directory — so a containment check on the whole tile can be satisfied
           by the path while the NAME still reads ".gemini". The home's name is
           the <b>, and that is what has to change.

           EXACTLY ONE, and it must be the visible one. A fix that appended a
           hidden canonical <b> beside the visible raw one would satisfy "some
           <b> says Gemini CLI" while every sighted operator still read
           ".gemini" — the same hidden-carrier dishonesty this suite already
           rejects for the board-consequence line. */
        const carriers = walkNodes(tile)
          .filter((n) => String(n.tagName).toLowerCase() === "b")
          .filter((n) => !hiddenHere(n));
        expect(carriers.length, `${id} does not have exactly one visible name element`).toBe(1);

        const carrier = carriers[0];
        expect(visibleText(carrier),
          `${id}'s visible name still reads as the raw "${raw}" instead of "${label}"`).toBe(label);

        /* And no hidden <b> is smuggling the canonical name in behind it. */
        const hiddenCarriers = walkNodes(tile)
          .filter((n) => String(n.tagName).toLowerCase() === "b")
          .filter((n) => hiddenHere(n));
        /* And the tile itself must be visible — a hidden tile has no visible
           carrier at all, and "exactly one" would otherwise be satisfied by a
           tile nobody can see. */
        expect(hiddenHere(tile), `${id}'s tile is itself hidden`).toBe(false);
        expect(hiddenCarriers.map((n) => String(n.textContent || "").trim()),
          `${id} carries a hidden name element beside its visible one`).toEqual([]);
      }
      /* The renamed home keeps its own name and does not acquire the canonical
         one — a catalog that overwrote instance labels would merge the two
         Claude homes into one indistinguishable pair. */
      const work = document.querySelector("[data-instance='claude:work']");
      const workName = walkNodes(work).find((n) => String(n.tagName).toLowerCase() === "b");
      expect(String(workName?.textContent || "").trim(),
        "the catalog overwrote a custom instance label").toBe("work-claude");
    });
  });

  test("every one of the fourteen tiles states its own name AND its own consequence, visibly", () => {
    /* The name check above proves the catalog reaches the dialog. It says
       nothing about whether each tile also states what that home DOES for the
       board — and a tile whose consequence is hidden is a home an operator
       cannot act on. Both facts, on every tile, through self and ancestors.

       Sampled fixtures were the gap: a fix wired for the five renamed labels
       and left raw for the other nine passed a five-tile check while Codex and
       OpenCode still showed a directory name and no consequence. */
    const KINDS: Array<[string, string, string]> = [
      ["claude", ".claude", "claude"],
      ["codex", ".codex", "codex"],
      ["omp", ".omp", "omp"],
      ["cursor-gui", "Cursor", "cursor"],
      ["factory", ".factory", "factory"],
      ["prime", ".prime", "prime"],
      ["grok-cli", ".grok", "grok"],
      ["hermes", ".hermes", "hermes"],
      ["muse", "muse", "muse"],
      ["antigravity-cli", ".antigravity", "antigravity"],
      ["copilot", ".copilot", "copilot"],
      ["gemini-cli", ".gemini", "gemini"],
      ["opencode", "opencode", "opencode"],
      ["pi", ".pi", "pi"],
    ];
    /* Two states per provider, so the consequence is state-correct rather than
       merely present: a collecting home and a found-not-imported one.

       DEFAULTS ARE CANONICAL; ALTERNATES PRESERVE THEIR OWN IDENTITY. The
       collector publishes `label: basename(dataDir)`, so a found home rooted at
       `/synthetic/found-.claude` is labelled "found-.claude" and never
       ".claude". The earlier fixture gave the found home the DEFAULT home
       basename while pointing it at a different directory — a record the server
       cannot emit — and then expected the canonical label for it. That
       contradicted the rule this dialog exists to keep: two homes that both
       read "Claude Code" are one home as far as the operator is concerned, so
       only `default: true` earns the catalog name. */
    const instances = [
      ...KINDS.map(([kind, raw]) => ({
        id: `${kind}:on`, kind, label: raw, dataDir: `/synthetic/${raw}`,
        default: true, onboarded: true, ignored: false,
      })),
      ...KINDS.map(([kind, raw]) => ({
        id: `${kind}:found`, kind, label: `found-${raw}`, dataDir: `/synthetic/found-${raw}`,
        default: false, onboarded: false, ignored: false,
      })),
    ];

    withDom(() => {
      web.state.collectorInstances = instances;
      web.state.collectorInstancesPending = false;
      web.state.settingsPanelOpen = true;
      if (web.state.paintSig) web.state.paintSig.settings = "";
      web.renderSettingsPanel();

      for (const [kind, raw, provider] of KINDS) {
        /* EXACT sentences, hard-bound to the controlled fixture's own path.
           A regex was acceptance by prefix: "Collecting from" matched a tile
           naming the wrong directory, and "Found. Import to collect from"
           matched one that had lost its trailing path entirely. */
        const EXPECTED: Record<string, string> = {
          on: `Collecting from synthetic/${raw}`,
          found: `Found. Import to collect from synthetic/found-${raw}.`,
        };
        /* The name each state earns: the catalog label for the built-in home,
           the operator-visible directory identity for the alternate one. */
        const EXPECTED_NAME: Record<string, string> = {
          on: CANONICAL_LABELS[provider]!,
          found: `found-${raw}`,
        };
        for (const suffix of ["on", "found"] as const) {
          const expected = EXPECTED[suffix];
          const opposite = EXPECTED[suffix === "on" ? "found" : "on"];
          const id = `${kind}:${suffix}`;
          const tile = document.querySelector(`[data-instance='${id}']`);
          expect(tile, `${id} did not render`).toBeTruthy();
          expect(hiddenHere(tile), `${id}'s tile is hidden`).toBe(false);

          /* One visible name, and it is the one this state earns. */
          const names = walkNodes(tile)
            .filter((n) => String(n.tagName).toLowerCase() === "b")
            .filter((n) => !hiddenHere(n));
          expect(names.length, `${id} does not have exactly one visible name`).toBe(1);
          expect(visibleText(names[0]),
            `${id}'s visible name is not the ${suffix === "on" ? "canonical" : "alternate-home"} label`)
            .toBe(EXPECTED_NAME[suffix]);

          /* EXCLUSIVITY BY PREFIX, not by expected text.

             Filtering leaves down to the expected sentence could only ever
             count carriers that were already right — a second carrier naming
             the WRONG root ("Collecting from synthetic/elsewhere") was invisible
             to it, and so was a hidden one. Every consequence-LIKE leaf is
             collected first, whatever it says and whether or not it is shown,
             and the tile must have exactly one of them. */
          const CONSEQUENCE_PREFIXES = ["Collecting from", "Found. Import to collect from"];
          const consequenceLeaves = walkNodes(tile)
            .filter((n) => !(n.children || []).length)
            .filter((n) => CONSEQUENCE_PREFIXES.some((pre) =>
              String(n.textContent || "").trim().startsWith(pre)));

          expect(consequenceLeaves.length,
            `${id} carries ${consequenceLeaves.length} consequence sentences, not one: `
            + consequenceLeaves.map((n) => JSON.stringify(String(n.textContent || "").trim())).join(", "),
          ).toBe(1);

          const carrier = consequenceLeaves[0];
          /* The one carrier must be readable by both audiences — a hidden or
             aria-hidden consequence reaches one of them and not the other. */
          expect(hiddenHere(carrier), `${id}'s consequence is hidden from sight`).toBe(false);
          expect(String(carrier.attributes?.["aria-hidden"] || ""),
            `${id}'s consequence is hidden from the accessibility tree`).not.toBe("true");
          /* And it says exactly this state's sentence, for this tile's own root. */
          expect(String(carrier.textContent || "").trim(),
            `${id}'s consequence is not the exact expected sentence`).toBe(expected);
          expect(String(carrier.textContent || "").trim(),
            `${id} prints the opposite state's consequence`).not.toBe(opposite);
        }
      }
    });
  });

  test("no tile makes a hidden node the sole carrier of its consequence", () => {
    withDom(() => {
      paint();
      for (const inst of INSTANCES) {
        const tile = document.querySelector(`[data-instance='${inst.id}']`);
        const hiddenOnly = walkNodes(tile).filter((n) => "hidden" in (n.attributes || {}));
        for (const node of hiddenOnly) {
          const sentence = String(node.textContent || "");
          if (!sentence.trim()) continue;
          expect(
            visibleText(tile),
            `${inst.id} hides "${sentence}" and says it nowhere else`,
          ).toContain(sentence.trim());
        }
      }
    });
  });

  test("OpenCode and Pi wear their official marks, with no letter fallback", () => {
    withDom(() => {
      paint();
      for (const [id, src] of [["opencode:opencode", "/icons/opencode.svg"], ["pi:pi", "/icons/pi.svg"]] as const) {
        const img = document.querySelector(`[data-instance='${id}'] img`);
        expect(img, `${id} rendered no mark image`).toBeTruthy();
        expect(img?.getAttribute("src")).toBe(src);
        /* And it did not ALSO fall back — a tile wearing both is a broken image
           beside a letter, which is what an unwired kind used to look like. */
        const tile = document.querySelector(`[data-instance='${id}']`);
        const letters = walkNodes(tile).filter((n) => String(n.className || "").includes("home-letter"));
        expect(letters.length, `${id} rendered a letter fallback beside its official mark`).toBe(0);
      }
    });
  });

  test("a genuinely unmarked home uses a visible letter with an accessible name", () => {
    withDom(() => {
      paint();
      const tile = document.querySelector("[data-instance='synthetic-unwired:home']");
      expect(tile, "the unwired home did not render").toBeTruthy();
      const letter = walkNodes(tile).find((n) => String(n.className || "").includes("home-letter"));
      expect(letter, "an unmarked home rendered no letter fallback").toBeTruthy();
      expect(letter!.textContent).toBe("U");
      /* A bare glyph names nothing. The fallback has to carry the home's name
         for anyone not reading it visually — and `title` does not do that job.
         A tooltip needs a pointer a touch or keyboard operator does not have,
         and accepting it here would let this dialog answer one accessibility
         question two contradictory ways: the very same slice is removing
         `title`-only carriage from the board-consequence line six tests up. */
      const name = String(letter!.attributes["aria-label"] || "");
      expect(name, "the letter fallback has no aria-label — a title attribute is not an accessible name")
        .toBeTruthy();
      expect(name, "the letter fallback's accessible name does not identify the home")
        .toContain("Unwired Home");
      /* And no broken image was emitted for a kind with no asset. */
      expect(document.querySelector("[data-instance='synthetic-unwired:home'] img")).toBeNull();
    });
  });

  test("Hermes keeps its evidence-blocked letter and gains no invented asset", () => {
    withDom(() => {
      web.state.collectorInstances = [
        { id: "hermes:dot-hermes", kind: "hermes", label: "Hermes", dataDir: "/synthetic/.hermes", default: true, onboarded: true, ignored: false },
      ];
      web.state.collectorInstancesPending = false;
      web.state.settingsPanelOpen = true;
      if (web.state.paintSig) web.state.paintSig.settings = "";
      web.renderSettingsPanel();
      const tile = document.querySelector("[data-instance='hermes:dot-hermes']");
      const letter = walkNodes(tile).find((n) => String(n.className || "").includes("home-letter"));
      expect(letter?.textContent, "Hermes has no vendor-published mark; the letter is the honest answer").toBe("H");
      expect(document.querySelector("[data-instance='hermes:dot-hermes'] img")).toBeNull();
    });
  });
});

/* ============== FE-SOURCE-REPAIR — Settings seams the green floor missed ==============
 *
 * Two of the five defects that survived the first source candidate. The other
 * three are row and Inspector seams and live in tests/harness-ui-parity.test.ts.
 *
 * Both cases feed the dialog the record shape the SERVER publishes — a
 * collector label is basename(dataDir), never a pretty name — and both fail on
 * their own received/expected delta rather than on setup.
 */

function paintCollectorInstances(instances: Array<Record<string, unknown>>): void {
  web.state.collectorInstances = instances;
  web.state.collectorInstancesPending = false;
  web.state.settingsPanelOpen = true;
  if (web.state.paintSig) web.state.paintSig.settings = "";
  web.renderSettingsPanel();
}

test("FE-SOURCE-REPAIR-4 a NON-default Claude home whose basename is .claude keeps its own name", () => {
  /* collectorDisplayName canonicalizes on the label alone: any home whose label
     reduces to the provider key becomes the built-in label. It never consults
     inst.default, which is the server field that actually says whether this is
     the built-in home. An alternate Claude root — same basename, different
     parent — is therefore renamed "Claude Code" and becomes indistinguishable
     from the real default home in the one dialog whose job is telling homes
     apart. default:false is the authoritative answer and it is being ignored. */
  withDom(() => {
    paintCollectorInstances([
      {
        id: "claude:alt-root",
        kind: "claude",
        provider: "claude",
        label: ".claude",
        dataDir: "/synthetic/alt-root/.claude",
        default: false,
        onboarded: false,
        ignored: false,
        reason: "needs-parser",
      },
    ]);

    const tile = document.querySelector("[data-instance='claude:alt-root']");
    expect(tile, "the alternate Claude home did not render").toBeTruthy();

    /* The exact visible carrier, exactly one of them. A repair that appended a
       hidden raw name beside a visible canonical one would satisfy a
       containment check while every sighted operator still read the wrong
       thing. */
    const carriers = walkNodes(tile)
      .filter((n) => String(n.tagName).toLowerCase() === "b")
      .filter((n) => !hiddenHere(n));
    expect(carriers.length, "the alternate home does not have exactly one visible name element").toBe(1);
    expect(visibleText(carriers[0]!),
      "a home the server marked default:false was canonicalized to the built-in label anyway")
      .toBe(".claude");

    /* And the consequence of default:false is unchanged: this home is found,
       not collecting. A repair that reached the name by flipping the record
       into some other state would move this sentence too. */
    expect(visibleText(tile), "the alternate home lost or changed its own consequence")
      .toContain("Found. Import records it; it will not appear on the board.");
    expect(visibleText(tile), "a home that is not collecting claims to be collecting")
      .not.toContain("Collecting from");
  });
});

test("FE-SOURCE-REPAIR-5 a default Hermes home labelled .hermes paints H, not its leading dot", () => {
  /* The server publishes label: basename(dataDir), so the real default Hermes
     home arrives labelled ".hermes" — not "Hermes", which is the string the
     existing coverage feeds it. homeMark slices the first character off the RAW
     label, so the honest letter fallback for the one harness with no vendor
     mark paints a full stop. The accessible name is already right, which is why
     nothing caught it: the two carriers disagree, and only the visible one is
     wrong. */
  withDom(() => {
    paintCollectorInstances([
      {
        id: "hermes:default",
        kind: "hermes",
        provider: "hermes",
        label: ".hermes",
        dataDir: "/synthetic/.hermes",
        default: true,
        onboarded: true,
        ignored: false,
      },
    ]);

    const tile = document.querySelector("[data-instance='hermes:default']");
    expect(tile, "the default Hermes home did not render").toBeTruthy();

    /* EVERY letter node first, then exactly one that reaches both audiences.
       Taking the first match would certify a repair that left the dot carrier
       standing and appended a corrected initial beside it; counting only
       visible ones would certify a repair that hid the honest letter from the
       accessibility tree. */
    const letters = walkNodes(tile)
      .filter((n) => String(n.className || "").split(/\s+/).includes("home-letter"));
    expect(letters.length, "the unmarked Hermes home rendered no letter fallback")
      .toBeGreaterThan(0);
    const readable = letters.filter((n) =>
      !hiddenHere(n) && String(n.attributes?.["aria-hidden"] || "") !== "true");
    expect(readable.length,
      `the Hermes home offers ${readable.length} readable letter carriers, not one`).toBe(1);

    const letter = readable[0]!;
    expect(visibleText(letter),
      "the collector publishes basename(dataDir), so the tile paints the leading dot instead of the initial")
      .toBe("H");
    expect(String(letter.attributes["aria-label"] || ""),
      "the letter fallback stopped naming the home it stands for")
      .toBe("Hermes collector home");

    /* The wrong letter is GONE, not merely outvoted. A repair that kept the dot
       carrier alongside a new initial still paints a full stop on this tile. */
    for (const node of letters) {
      expect(String(node.textContent || "").trim(),
        "the Hermes tile retains a letter fallback still painting the leading dot")
        .not.toBe(".");
    }

    /* And no asset was invented for a harness that publishes none. */
    expect(document.querySelector("[data-instance='hermes:default'] img"),
      "Hermes gained a mark its vendor never published").toBeNull();
  });
});
