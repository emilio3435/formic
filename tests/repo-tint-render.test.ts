import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* TINT-F — the two board treatments, as renders rather than as substrings.

   This file carries its own fake document instead of borrowing web-client's,
   for one reason: the repo tint travels into the DOM as a CSS custom property
   set through `style.setProperty`, and web-client's node has no `style` at all.
   A harness that silently swallows the one write under test would let every
   assertion below pass over a board with no colour on it. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let M: any;
let styles = "";
let source = "";

beforeAll(async () => {
  // @ts-expect-error The dependency-free browser client has no declaration file.
  await import("../src/web/app.js");
  M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
  const webDir = join(import.meta.dir, "../src/web");
  styles = readFileSync(join(webDir, "styles.css"), "utf8");
  source = readFileSync(join(webDir, "app.js"), "utf8");
});

interface FakeNode {
  tagName: string;
  nodeType: number;
  className: string;
  classList: { add(...c: string[]): void; contains(c: string): boolean };
  style: { setProperty(name: string, value: string): void };
  props: Record<string, string>;
  attributes: Record<string, string>;
  dataset: Record<string, string>;
  children: FakeNode[];
  textContent: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

let byId = new Map<string, FakeNode>();

function makeNode(tag: string): FakeNode {
  const classes = new Set<string>();
  const props: Record<string, string> = {};
  let text = "";
  const node = {
    tagName: tag,
    nodeType: 1,
    props,
    attributes: {} as Record<string, string>,
    dataset: {} as Record<string, string>,
    children: [] as FakeNode[],
    listeners: {} as Record<string, Array<(event: unknown) => unknown>>,
    get textContent() { return text; },
    set textContent(v: string) { text = String(v ?? ""); node.children.length = 0; },
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
    /* The real thing: a CSSOM property write, which the board's strict CSP
       permits, unlike the style ATTRIBUTE it would otherwise have used. */
    style: {
      setProperty(name: string, value: string) { props[name] = String(value); },
    },
    setAttribute(k: string, v: unknown) {
      node.attributes[k] = String(v);
      if (k === "id" && v) byId.set(String(v), node as unknown as FakeNode);
    },
    removeAttribute(k: string) { delete node.attributes[k]; },
    hasAttribute(k: string) { return k in node.attributes; },
    addEventListener(type: string, fn: (event: unknown) => unknown) {
      (node.listeners[type] ??= []).push(fn);
    },
    append(...kids: unknown[]) {
      for (const kid of kids) {
        if (kid == null) continue;
        node.children.push(kid as FakeNode);
      }
    },
    insertBefore(child: FakeNode) { node.children.push(child); },
    remove() {},
    querySelector: () => null,
    querySelectorAll: () => [] as unknown[],
    get firstChild() { return node.children[0] || null; },
    get nextSibling() { return null; },
    get childNodes() { return node.children; },
    get childElementCount() { return node.children.length; },
  };
  return node as unknown as FakeNode;
}

function withDom<T>(fn: () => T): T {
  byId = new Map();
  const panel = makeNode("div");
  panel.setAttribute("id", "settings-panel");
  const toggle = makeNode("button");
  toggle.setAttribute("id", "settings-toggle");
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (t: string) => makeNode(t),
    createElementNS: (_ns: string, t: string) => makeNode(t),
    createTextNode: (s: string) => ({ nodeType: 3, textContent: String(s) }),
    getElementById: (id: string) => byId.get(id) ?? null,
    querySelector: () => null,
    querySelectorAll: () => [] as unknown[],
  };
  try { return fn(); } finally {
    delete (globalThis as unknown as { document?: unknown }).document;
  }
}

function walk(node: unknown, hit: (node: FakeNode) => boolean, out: FakeNode[] = []): FakeNode[] {
  if (!node || typeof node !== "object") return out;
  const candidate = node as FakeNode;
  if (candidate.nodeType === 1 && hit(candidate)) out.push(candidate);
  for (const kid of candidate.children || []) walk(kid, hit, out);
  return out;
}

const byClass = (root: unknown, name: string): FakeNode[] =>
  walk(root, (node) => node.classList.contains(name));

const STORM = "#2e66a8";
const SIENNA = "#b05f3a";
const COLOUR_HELP = "A colour you pick here follows the repository name on the board, including every clone of that GitHub repo, and travels to its cmux workspaces.";

/* Origin-named envelope: after discovery keyed by the printed band name,
   name and colour key are the same word. A synthetic name≠key join is kept
   below for the no-origin folder fallback. */
const originEnvelope = {
  ok: true,
  settings: {
    assignments: {
      "the-ant-hill": { repoKey: "the-ant-hill", hex: STORM, slot: 1, source: "auto" },
      "cooper-scheduler": { repoKey: "cooper-scheduler", hex: SIENNA, slot: 2, source: "user" },
    },
    mirrorGroups: true, syncFromCmux: true,
  },
  repoNames: { "the-ant-hill": "the-ant-hill", "cooper-scheduler": "cooper-scheduler" },
  liveKeys: ["the-ant-hill"],
};

/* The colour state as the SERVER actually hands it over: two tables, joined by
   the canonical repo key. */
function useColors(repoNames: Record<string, string>, hexByKey: Record<string, string>) {
  const assignments: Record<string, unknown> = {};
  for (const [key, hex] of Object.entries(hexByKey)) {
    assignments[key] = { repoKey: key, hex, slot: null, source: "auto" };
  }
  M.setRepoColors(repoNames, { assignments, mirrorGroups: true, syncFromCmux: true });
}

function agent(overrides: Record<string, unknown> = {}) {
  return {
    id: "codex:a1",
    provider: "codex",
    sourceSessionId: "a1",
    displayName: "Ridge worker",
    programId: "p1",
    status: "running",
    statusReason: "Streaming output.",
    updatedAt: "2026-08-13T03:00:00.000Z",
    lifecycle: "working",
    scope: "observed",
    tokens: { provenance: "observed", total: 1200 },
    artifacts: [],
    gates: [],
    target: { resolution: "exact", surfaceId: "s1", workspaceId: "w1" },
    controls: [],
    repo: {
      repoKey: "hash",
      repoName: "the-mountain",
      worktreePath: "/Users/e/Developer/the-mountain",
      ephemeral: false,
    },
    ...overrides,
  };
}

function program(overrides: Record<string, unknown> = {}) {
  return { id: "p1", name: "the-mountain", agents: [agent()], ...overrides };
}

function band(overrides: Record<string, unknown> = {}) {
  return {
    kind: "repo",
    key: "repo-1",
    name: "the-mountain",
    pullRequestUrls: [],
    worktrees: [{ program: program(), agents: [agent()], finished: [], worktreeKey: "wt", label: "main" }],
    ...overrides,
  };
}

const ui = () => ({
  view: "board",
  labels: new Map(),
  repoOverrides: new Map(),
  programOverrides: new Map(),
  swarmOverrides: new Map(),
  selectedId: null,
  renaming: null,
  renamePending: false,
  renameError: "",
  contextDisplay: "percent",
});

beforeEach(() => {
  M.setRepoColors({}, { assignments: {} });
  M.state.liveRepoKeys = [];
  M.state.repoColorSettings = null;
  M.state.settingsPanelOpen = false;
  if (M.state.paintSig) {
    M.state.paintSig.settings = "";
    M.state.paintSig["repo-colors"] = "";
  }
});

/* ---------------------------------------------------------------------------
   The join.
   ------------------------------------------------------------------------ */

describe("the wire join: a real GET envelope reaches a rendered row", () => {
  /* THE test this lane shipped without, and the whole reason the board never
     tinted while 64 tests stayed green. Every other test in this file sets the
     colour state by hand, so all of them agreed with each other about a shape
     that no server ever sends.

     This one takes the envelope the real handler emits and pushes it through
     the real client entry points, so the two halves are pinned to each other.
     Live colour keys are origin names — `the-ant-hill` is both the band and
     the assignment key. */
  const envelope = originEnvelope;

  test("name → repoKey → hex, and the band actually paints", () => {
    M.setRepoColors(envelope.repoNames, envelope.settings);
    expect(M.repoTintFor("the-ant-hill")).toBe(STORM);
    const section = withDom(() =>
      M.renderRepoSection(band({ name: "the-ant-hill" }), ui())) as unknown as FakeNode;
    expect(section.classList.contains("has-repo-tint")).toBe(true);
    expect(section.props["--repo-tint"]).toBe(STORM);
    M.state.repoColorSettings = envelope.settings;
    M.state.liveRepoKeys = envelope.liveKeys;
    const region = withDom(() => M.renderRepoColorSettings()) as unknown as FakeNode;
    expect(byClass(region, "repo-colors-name").map((node) => node.textContent))
      .toContain("the-ant-hill");
    expect(byClass(region, "repo-colors-name").map((node) => node.textContent))
      .not.toContain("the-mountain");
  });

  test("a no-origin folder still joins when the printed name and the colour key differ", () => {
    /* The origin-named envelope makes name === key, so the old collapsing
       defect (looking up hex by name in the key table) is gone on this
       checkout. The join must still work when a folder has no origin. */
    M.setRepoColors(
      { "job-bored": "job-bored-folder" },
      {
        assignments: {
          "job-bored-folder": { repoKey: "job-bored-folder", hex: STORM, slot: 1, source: "auto" },
        },
        mirrorGroups: true,
        syncFromCmux: true,
      },
    );
    expect(M.repoTintFor("job-bored")).toBe(STORM);
    const section = withDom(() =>
      M.renderRepoSection(band({ name: "job-bored" }), ui())) as unknown as FakeNode;
    expect(section.classList.contains("has-repo-tint")).toBe(true);
    expect(section.props["--repo-tint"]).toBe(STORM);
  });

  test("fetchRepoColors passes BOTH tables from the response it just read", async () => {
    /* The join lives at the two call sites as much as in the function: passing
       only body.repoNames type-checks, runs, logs nothing and tints nothing. */
    const calls: string[] = [];
    const realFetch = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify(envelope), {
        status: 200, headers: { "content-type": "application/json" },
      });
    };
    try {
      await M.fetchRepoColors();
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
    }
    expect(calls).toEqual(["/api/repo-colors"]);
    expect(M.repoTintFor("the-ant-hill")).toBe(STORM);
    expect(M.state.liveRepoKeys).toEqual(["the-ant-hill"]);
  });

  /* stopBoot() has to mean stopped, including for work boot already started.

     This fetch is fired once from boot(). When it lands it calls render(), and
     that is a repaint nothing else asked for — which is fine in a browser and
     wrong for anything that froze the board on purpose. The geometry gate does
     exactly that: it calls stopBoot(), installs a fixture, and measures. A
     response arriving in that window repaints over the fixture mid-measurement,
     and the gate fails on a geometry it never rendered.

     Measured 2026-08-13 by A/B over six interleaved runs each: unchanged, the
     header-collapse gate failed in half of them; with the late repaint
     suppressed (network request unchanged), zero. Pre-TINT code, which had no
     such fetch, was also zero across eight runs. The network call is not the
     problem — the repaint after the freeze is.

     Same failure class stopBoot's own EventSource line already fixed once: it
     "kept a live EventSource alive after stopBoot() claimed to have stopped."

     Generation rather than a boolean, matching loadIdentityEvidence's stale
     guard: a fetch STARTED after a stop is legitimate and still applies (the
     test above drives exactly that), while one started before and landing after
     is stale and is dropped. */
  test("a boot fetch that lands after stopBoot() is dropped, not painted over the frozen board", async () => {
    M.setRepoColors({}, { assignments: {} });
    expect(M.repoTintFor("the-ant-hill")).toBe("");

    let release: (() => void) | null = null;
    const realFetch = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = () => new Promise((resolve) => {
      release = () => resolve(new Response(JSON.stringify(envelope), {
        status: 200, headers: { "content-type": "application/json" },
      }));
    });
    try {
      const inFlight = M.fetchRepoColors();  // boot fires it
      M.stopBoot();                          // the board is frozen mid-flight
      release!();                            // and only now does it land
      await inFlight;
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
    }

    expect(M.repoTintFor("the-ant-hill")).toBe("");
  });

  test("putRepoColor re-joins from ITS response too — the second call site", async () => {
    /* There are two places that turn a response into colours, and a mutation
       run proved only one of them was covered: collapsing the join at the
       putRepoColor call site alone left every test green. Two call sites, two
       tests, or half the defect stays shippable. */
    const picked = "#0e9494";
    const reply = {
      ok: true,
      settings: {
        assignments: { "the-mountain": { repoKey: "the-mountain", hex: picked, slot: null, source: "user" } },
        mirrorGroups: true,
        syncFromCmux: true,
      },
      repoNames: { "the-ant-hill": "the-mountain" },
    };
    const calls: { url: string; method: string }[] = [];
    const realFetch = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = async (url: string, init?: { method?: string }) => {
      calls.push({ url: String(url), method: init?.method ?? "GET" });
      return new Response(JSON.stringify(reply), {
        status: 200, headers: { "content-type": "application/json" },
      });
    };
    try {
      /* putRepoColor repaints the whole board and the settings panel after the
         join, and neither survives this file's deliberately minimal document.
         The join runs BEFORE them, so the assertions below still measure it —
         and they measure it honestly: a broken join leaves the map empty and
         `repoTintFor` returns "", which fails here just as loudly. */
      await withDom(() => M.putRepoColor("the-mountain", picked)).catch(() => {});
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
    }
    expect(calls[0]).toEqual({ url: "/api/repo-colors/the-mountain", method: "PUT" });
    expect(M.repoTintFor("the-ant-hill")).toBe(picked);
  });
});

describe("repoTintFor", () => {
  test("joins on the repository name the board already prints, case-insensitively", () => {
    useColors({ "the-ant-hill": "the-mountain" }, { "the-mountain": "#2E66A8" });
    expect(M.repoTintFor("The-Ant-Hill")).toBe(STORM);
    expect(M.repoTintFor("  the-ant-hill  ")).toBe(STORM);
  });

  test("a repository the endpoint has not assigned gets NO colour, not a default", () => {
    /* A fallback hue here would be a colour the board shows and the cmux
       workspaces are not wearing — an identity claim with nothing behind it. */
    useColors({ "the-ant-hill": "the-mountain" }, { "the-mountain": "#2E66A8" });
    expect(M.repoTintFor("cooper-scheduler")).toBe("");
    expect(M.repoTintFor("")).toBe("");
    expect(M.repoTintFor(null)).toBe("");
  });

  test("a hex the client cannot compare later is dropped rather than stored", () => {
    useColors({ "the-mountain": "k1", formic: "k2" }, { k1: "cornflower", k2: "#abc" });
    expect(M.repoTintFor("the-mountain")).toBe("");
    expect(M.repoTintFor("formic")).toBe("#aabbcc");
  });
});

/* ---------------------------------------------------------------------------
   Whisper — the grouped repo band.
   ------------------------------------------------------------------------ */

describe("Whisper", () => {
  test("a tinted band carries the class, the custom property and a head dot", () => {
    useColors({ "the-mountain": "mtn" }, { mtn: STORM });
    const section = withDom(() => M.renderRepoSection(band(), ui())) as unknown as FakeNode;
    expect(section.classList.contains("has-repo-tint")).toBe(true);
    expect(section.props["--repo-tint"]).toBe(STORM);
    expect(byClass(section, "repo-dot")).toHaveLength(1);
  });

  test("the tint rides a CSSOM property, never a style attribute", () => {
    /* The board ships `style-src 'self'` with no 'unsafe-inline'. A style
       ATTRIBUTE is dropped silently by that policy — the band would render, the
       colour would not, and nothing anywhere would say why. */
    useColors({ "the-mountain": "mtn" }, { mtn: STORM });
    const section = withDom(() => M.renderRepoSection(band(), ui())) as unknown as FakeNode;
    expect(section.attributes.style).toBeUndefined();
    expect(source).not.toMatch(/style:\s*["'`][^"'`]*--repo-tint/);
  });

  test("an unassigned repository draws no dot and no tint class", () => {
    const section = withDom(() => M.renderRepoSection(band(), ui())) as unknown as FakeNode;
    expect(section.classList.contains("has-repo-tint")).toBe(false);
    expect(section.props["--repo-tint"]).toBeUndefined();
    expect(byClass(section, "repo-dot")).toHaveLength(0);
  });

  test("the band's paint signature moves when its colour arrives", () => {
    /* The colour lands on its own clock, one fetch after boot, with nothing
       else in the signature moving — so a signature blind to it would serve the
       first paint's colourless card forever. */
    const before = M.repoShellSig(band(), ui());
    useColors({ "the-mountain": "mtn" }, { mtn: STORM });
    expect(M.repoShellSig(band(), ui())).not.toBe(before);
  });

  test("the repository's NAME is never tinted — only the dot is", () => {
    useColors({ "the-mountain": "mtn" }, { mtn: STORM });
    const section = withDom(() => M.renderRepoSection(band(), ui())) as unknown as FakeNode;
    const name = byClass(section, "repo-name")[0]!;
    expect(name.props["--repo-tint"]).toBeUndefined();
    expect(name.classList.contains("has-repo-tint")).toBe(false);
  });
});

/* ---------------------------------------------------------------------------
   Signal — the interleaved rows, and what the strip does instead.
   ------------------------------------------------------------------------ */

const boardIndexStub = () => ({ byId: new Map(), ambiguous: new Set(), sharedNames: new Set() });

function planFor(agents: Record<string, unknown>[], banded: boolean) {
  const prog = program({ agents });
  return M.agentRowPlan(prog, agents, ui(), boardIndexStub(), { finished: [], banded });
}

describe("Signal", () => {
  test("an interleaved (flat, unbanded) row carries the tick class and the hex", () => {
    /* This is the surface Signal is FOR. It went untested and unwired at first:
       stripRowOpts was the only thing setting repoTint, so the treatment shipped
       applying to nothing at all. */
    useColors({ "the-mountain": "mtn" }, { mtn: SIENNA });
    const one = agent();
    const plan = planFor([one], false);
    const row = withDom(() => plan.find((item: { key: string }) => item.key === "row:" + one.id).build()) as unknown as FakeNode;
    expect(row.classList.contains("has-repo-tick")).toBe(true);
    expect(row.props["--repo-tint"]).toBe(SIENNA);
  });

  test("rows inside a band get NO tick — the card above them already says it", () => {
    useColors({ "the-mountain": "mtn" }, { mtn: SIENNA });
    const one = agent();
    const plan = planFor([one], true);
    const row = withDom(() => plan.find((item: { key: string }) => item.key === "row:" + one.id).build()) as unknown as FakeNode;
    expect(row.classList.contains("has-repo-tick")).toBe(false);
    expect(row.props["--repo-tint"]).toBeUndefined();
  });

  test("the strip offers NO tick — identity never reaches an attention row", () => {
    /* needsYouStrip admits only alerting agents, so every strip row is an
       attention row and rule 5 gives it to status outright. Identity is carried
       by the heading pill instead.

       Withholding the tick, rather than offering one for the stylesheet to
       drop, is what makes this airtight for the hook-needsInput shape below:
       that agent is alerting with a HEALTHY outcome, so it carries none of the
       is-needs-you / is-blocked / is-failed classes the identity selectors
       exclude. An offered tick would paint on it. */
    useColors({ "the-mountain": "mtn" }, { mtn: SIENNA });
    const opts = M.stripRowOpts(program(), boardIndexStub());
    expect(opts.repoTint).toBeUndefined();

    const hookShaped = agent({ status: "waiting", lifecycle: "waiting", hookLifecycle: "needsInput" });
    const row = withDom(() => M.renderAgentRow(hookShaped, program(), opts)) as unknown as FakeNode;
    expect(row.classList.contains("has-repo-tick")).toBe(false);
    expect(row.props["--repo-tint"]).toBeUndefined();
    /* Pinning the shape that makes this necessary: no attention class either,
       because pane mode deliberately does not double-mark — the strip IS the
       signal. So there is nothing for a `:not()` to catch, and the only safe
       treatment is none. */
    for (const attention of ["is-needs-you", "is-blocked", "is-failed", "is-alerting"]) {
      expect(row.classList.contains(attention), attention).toBe(false);
    }
  });

  test("the strip heading wears the quiet repo pill, bordered rather than inked", () => {
    useColors({ "the-mountain": "mtn" }, { mtn: SIENNA });
    const head = withDom(() => M.renderStripGroupHead(program(), "the-mountain · main")) as unknown as FakeNode;
    const pill = byClass(head, "strip-repo-pill")[0]!;
    expect(pill).toBeDefined();
    expect(pill.textContent).toBe("the-mountain");
    expect(pill.props["--repo-tint"]).toBe(SIENNA);
    /* Decoration over a fact the heading states in full, so it is hidden from
       assistive tech rather than read out twice. */
    expect(pill.attributes["aria-hidden"]).toBe("true");
  });

  test("an unassigned repository gets no pill", () => {
    const head = withDom(() => M.renderStripGroupHead(program(), "the-mountain · main")) as unknown as FakeNode;
    expect(byClass(head, "strip-repo-pill")).toHaveLength(0);
  });

  test("the row signature moves when the tick's colour does", () => {
    const plain = M.agentRowSig(agent(), ui(), {});
    const tinted = M.agentRowSig(agent(), ui(), { repoTint: SIENNA });
    const other = M.agentRowSig(agent(), ui(), { repoTint: STORM });
    expect(tinted).not.toBe(plain);
    expect(other).not.toBe(tinted);
  });
});

/* ---------------------------------------------------------------------------
   Authority rules 5 and 6, where they are actually enforced: the stylesheet.
   ------------------------------------------------------------------------ */

describe("status outranks identity (authority rule 5)", () => {
  const ATTENTION = ["is-needs-you", "is-blocked", "is-failed", "is-alerting"];

  function repoRowSelectors(): string[] {
    return [...styles.matchAll(/^(\.[^{\n]*(?:has-repo-tint|has-repo-tick)[^{\n]*\.agent-row[^{\n]*|\.agent-row\.has-repo-tick[^{\n]*)\{/gm)]
      .map((match) => match[1]!.trim());
  }

  test("the extraction actually found the row rules", () => {
    expect(repoRowSelectors().length).toBeGreaterThanOrEqual(4);
  });

  test("every repo row treatment excludes every attention class, and selection", () => {
    /* Written as :not() exclusions rather than left to source order. Order is a
       fact about the stylesheet; "an alerting row REPLACES the repo wash, never
       blends with it" is a fact about the product, and the second one should
       not be enforced by the first. */
    for (const selector of repoRowSelectors()) {
      for (const attention of [...ATTENTION, "is-selected"]) {
        expect(selector, `${selector} must exclude .${attention}`)
          .toContain(`:not(.${attention})`);
      }
    }
  });

  test("the attention rows keep the ember rail and the ember wash they already had", () => {
    expect(styles).toMatch(/\.agent-row\.is-alerting\s*\{[^}]*color-mix\(in srgb, var\(--ember\) 6%/);
    expect(styles).toMatch(/\.agent-row\.is-alerting:not\(\.is-selected\)\s*\{[^}]*inset 4px 0 var\(--needs\)/);
  });

  test("the approved mix percentages are what shipped", () => {
    /* 45% spine, 4% wash, 7% hover, 55% tick are design-approved values, not
       suggestions — this catches a well-meaning nudge. */
    expect(styles).toMatch(/\.repo-section\.has-repo-tint\s*\{[^}]*var\(--repo-tint\) 45%/);
    expect(styles).toMatch(/has-repo-tint[^{]*\.agent-row[^{]*\{[^}]*var\(--repo-tint\) 4%/);
    expect(styles).toMatch(/has-repo-tint[^{]*\.agent-row[^{]*:hover\s*\{[^}]*var\(--repo-tint\) 7%/);
    expect(styles).toMatch(/\.agent-row\.has-repo-tick[^{]*\{[^}]*inset 3px 0 color-mix\(in srgb, var\(--repo-tint\) 55%/);
  });
});

describe("text never wears repo colour (authority rule 6)", () => {
  test("no repo-tint rule sets a text colour", () => {
    const blocks = [...styles.matchAll(/([^{}]*--repo-tint[^{}]*|[^{}]*(?:has-repo-tint|has-repo-tick|repo-dot|strip-repo-pill)[^{}]*)\{([^}]*)\}/g)];
    expect(blocks.length).toBeGreaterThan(4);
    for (const [, selector, body] of blocks) {
      const colorDeclarations = [...body!.matchAll(/(?:^|;)\s*color\s*:\s*([^;]+)/g)].map((m) => m[1]!.trim());
      for (const declaration of colorDeclarations) {
        expect(declaration, `${selector!.trim()} must not ink text with the repo tint`)
          .not.toContain("--repo-tint");
      }
    }
  });

  test("the marks are the spine, the dot, the tick and the pill border — nothing else", () => {
    expect(styles).toMatch(/\.repo-dot\s*\{[^}]*background: var\(--repo-tint\)/);
    expect(styles).toMatch(/\.strip-repo-pill\s*\{[^}]*border: 1px solid color-mix\(in srgb, var\(--repo-tint\) 55%/);
  });
});

/* ---------------------------------------------------------------------------
   The Settings region.
   ------------------------------------------------------------------------ */

describe("renderRepoColorSettings", () => {
  const settings = {
    assignments: {
      "the-mountain": { repoKey: "the-mountain", hex: STORM, slot: 1, source: "auto" },
      formic: { repoKey: "formic", hex: "#123456", slot: null, source: "user" },
    },
    mirrorGroups: true,
    syncFromCmux: true,
  };

  test("one row per repository, sorted, each swatch carrying its own hex", () => {
    M.state.liveRepoKeys = ["the-mountain", "formic"];
    const region = withDom(() => M.renderRepoColorSettings(settings)) as unknown as FakeNode;
    const rows = byClass(region, "repo-colors-row");
    expect(rows.map((row) => byClass(row, "repo-colors-name")[0]!.textContent))
      .toEqual(["formic", "the-mountain"]);
    expect(rows[0]!.props["--repo-tint"]).toBe("#123456");
    expect(rows[1]!.props["--repo-tint"]).toBe(STORM);
  });

  test("only an operator's own colour offers a reset", () => {
    M.state.liveRepoKeys = ["the-mountain", "formic"];
    const region = withDom(() => M.renderRepoColorSettings(settings)) as unknown as FakeNode;
    const rows = byClass(region, "repo-colors-row");
    expect(byClass(rows[0]!, "repo-colors-reset")).toHaveLength(1); // formic, user
    expect(byClass(rows[1]!, "repo-colors-reset")).toHaveLength(0); // the-mountain, auto
    expect(byClass(rows[0]!, "repo-colors-source")[0]!.textContent).toBe("your colour");
    expect(byClass(rows[1]!, "repo-colors-source")[0]!.textContent).toBe("auto");
  });

  test("with nothing assigned it says so rather than rendering an empty box", () => {
    const region = withDom(() => M.renderRepoColorSettings({ assignments: {} })) as unknown as FakeNode;
    expect(byClass(region, "repo-colors-empty")[0]!.textContent).toContain("No repository");
  });

  test("the visible name is the band, the-ant-hill, not the-mountain", () => {
    M.state.liveRepoKeys = originEnvelope.liveKeys;
    const region = withDom(() => M.renderRepoColorSettings(originEnvelope.settings)) as unknown as FakeNode;
    const names = byClass(region, "repo-colors-name").map((node) => node.textContent);
    expect(names).toContain("the-ant-hill");
    expect(names).not.toContain("the-mountain");
  });

  test("a persisted repo missing from liveKeys is not on the board", () => {
    M.state.liveRepoKeys = originEnvelope.liveKeys;
    const region = withDom(() => M.renderRepoColorSettings(originEnvelope.settings)) as unknown as FakeNode;
    const rows = byClass(region, "repo-colors-row");
    expect(rows.map((row) => byClass(row, "repo-colors-name")[0]!.textContent))
      .toEqual(["the-ant-hill", "cooper-scheduler"]);
    expect(rows[0]!.classList.contains("is-absent")).toBe(false);
    expect(rows[1]!.classList.contains("is-absent")).toBe(true);
    expect(byClass(rows[0]!, "repo-colors-source")[0]!.textContent).toBe("auto");
    expect(byClass(rows[1]!, "repo-colors-source")[0]!.textContent).toBe("your colour · not on the board");
    expect(byClass(rows[0]!, "repo-colors-swatch")[0]!.attributes["aria-label"])
      .toBe("Colour for the-ant-hill");
    expect(byClass(rows[1]!, "repo-colors-swatch")[0]!.attributes["aria-label"])
      .toBe("Colour for cooper-scheduler, not on the board");
  });

  test("live rows sort first, then not-on-board, each group alphabetical", () => {
    /* C < T, so alphabetical-only would put cooper-scheduler first. */
    M.state.liveRepoKeys = originEnvelope.liveKeys;
    const region = withDom(() => M.renderRepoColorSettings(originEnvelope.settings)) as unknown as FakeNode;
    expect(byClass(region, "repo-colors-row").map((row) => byClass(row, "repo-colors-name")[0]!.textContent))
      .toEqual(["the-ant-hill", "cooper-scheduler"]);
  });

  test("an auto assignment off the board says Not on the board", () => {
    M.state.liveRepoKeys = [];
    const region = withDom(() => M.renderRepoColorSettings({
      assignments: {
        "the-ant-hill": { repoKey: "the-ant-hill", hex: STORM, slot: 1, source: "auto" },
      },
    })) as unknown as FakeNode;
    const row = byClass(region, "repo-colors-row")[0]!;
    expect(row.classList.contains("is-absent")).toBe(true);
    expect(byClass(row, "repo-colors-source")[0]!.textContent).toBe("Not on the board");
  });

  test("a colour GET does not wipe a number the operator is typing", () => {
    withDom(() => {
      M.state.settingsPanelOpen = true;
      M.state.repoColorSettings = originEnvelope.settings;
      M.state.liveRepoKeys = originEnvelope.liveKeys;
      M.setRepoColors(originEnvelope.repoNames, originEnvelope.settings);
      M.renderSettingsPanel();
      const panel = byId.get("settings-panel")!;
      const numbers = walk(panel, (node) => node.tagName === "input" && node.attributes.type === "number");
      expect(numbers.length).toBeGreaterThan(0);
      numbers[0]!.value = "9";
      M.setRepoColors(originEnvelope.repoNames, originEnvelope.settings);
      M.state.liveRepoKeys = originEnvelope.liveKeys;
      M.paintRepoColorSettings();
      M.renderSettingsPanel();
      const after = walk(panel, (node) => node.tagName === "input" && node.attributes.type === "number");
      expect(after[0]!.value).toBe("9");
    });
  });

  test("legend help follows the repository name, including clones", () => {
    withDom(() => {
      M.state.settingsPanelOpen = true;
      M.renderSettingsPanel();
      const helps = walk(byId.get("settings-panel"), (node) => node.classList.contains("settings-help"));
      expect(helps.map((node) => node.textContent)).toContain(COLOUR_HELP);
    });
  });

  test("absent rows are sand, not faded — the swatch stays a real colour", () => {
    expect(styles).toMatch(/\.repo-colors-row\.is-absent\s*\{[^}]*background:\s*var\(--sand\)/);
    expect(styles).not.toMatch(/\.repo-colors-row\.is-absent\s*\{[^}]*\bopacity\s*:/);
  });
});

/* ---------------------------------------------------------------------------
   Refresh: Settings open, and a new origin on a later snapshot.
   ------------------------------------------------------------------------ */

function snapWithRepos(names: string[]) {
  return {
    schemaVersion: 1,
    programs: names.map((repoName, i) => ({
      id: "p" + i,
      name: repoName,
      agents: [{
        id: "a" + i, provider: "codex", sourceSessionId: "s" + i,
        displayName: repoName, programId: "p" + i, status: "running",
        statusReason: "", updatedAt: "2026-08-13T03:00:00.000Z",
        lifecycle: "working", scope: "observed",
        tokens: { provenance: "observed", total: 1 },
        artifacts: [], gates: [], controls: [],
        repo: { repoKey: "k" + i, repoName, worktreePath: "/x/" + repoName, ephemeral: false },
      }],
    })),
  };
}

describe("refresh on Settings open and live roster change", () => {
  const envelope = originEnvelope;

  test("liveRepoSig is the sorted unique origin names", () => {
    expect(M.liveRepoSig(snapWithRepos(["the-ant-hill", "BurnBar", "the-ant-hill"])))
      .toBe("burnbar,the-ant-hill");
  });

  test("opening Settings GETs /api/repo-colors; closing does not", async () => {
    const urls: string[] = [];
    const realFetch = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify(envelope), { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      M.state.settingsPanelOpen = false;
      withDom(() => { void M.openSettingsPanel(); });
      const afterOpen = urls.filter((u) => u.includes("/api/repo-colors")).length;
      expect(afterOpen).toBeGreaterThan(0);
      urls.length = 0;
      try { M.closeSettingsPanel(); } catch { /* render() needs the board document */ }
      expect(urls.filter((u) => u.includes("/api/repo-colors"))).toEqual([]);
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
    }
  });

  test("a new origin on a later snapshot GETs colours; a repeat roster does not", async () => {
    const urls: string[] = [];
    const realFetch = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify(envelope), { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      M.stopBoot();
      M.maybeRefreshRepoColors(snapWithRepos(["the-ant-hill"])); // first = boot-equivalent, no GET
      M.maybeRefreshRepoColors(snapWithRepos(["the-ant-hill"])); // unchanged
      expect(urls.filter((u) => u.includes("/api/repo-colors"))).toEqual([]);
      M.maybeRefreshRepoColors(snapWithRepos(["the-ant-hill", "job-bored"]));
      expect(urls.filter((u) => u.includes("/api/repo-colors"))).toEqual(["/api/repo-colors"]);
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
    }
  });
});

describe("the Evidence desk wears the repo tint", () => {
  function inspectorUi(overrides: Record<string, unknown> = {}) {
    return {
      snap: null,
      queueItems: [] as unknown[],
      triage: new Map(),
      triagePending: new Set<string>(),
      evidenceOpen: false,
      pending: new Set<string>(),
      feedback: new Map(),
      confirming: null,
      renaming: null,
      renamePending: false,
      renameError: "",
      labelsLoading: false,
      labelLoadError: "",
      identity: { agentId: null, loading: false, error: "", data: null },
      transcript: {},
      actions: { items: [] },
      wsRenaming: null,
      wsRenamePending: false,
      wsRenameError: "",
      attentionPending: new Set<string>(),
      attentionErrors: new Map(),
      attention: new Map(),
      ...overrides,
    };
  }

  function paintDesk(session: ReturnType<typeof agent>, prog: ReturnType<typeof program>) {
    return withDom(() => {
      const pane = document.createElement("div") as unknown as FakeNode;
      M.renderAgentDrawer(pane, { kind: "agent", agent: session, program: prog });
      return pane;
    });
  }

  test("an assigned printed name tints the desk, not Chat or the pane", () => {
    useColors({ "the-mountain": "mtn" }, { mtn: SIENNA });
    const session = agent();
    const pane = paintDesk(session, program({ agents: [session] }));
    const desk = byClass(pane, "drawer-desk")[0]!;
    expect(desk.classList.contains("has-repo-tint")).toBe(true);
    expect(desk.props["--repo-tint"]).toBe(SIENNA);
    expect(pane.classList.contains("has-repo-tint")).toBe(false);
    expect(byClass(pane, "drawer-doc")[0]!.classList.contains("has-repo-tint")).toBe(false);
    expect(byClass(pane, "drawer-shell-head")[0]!.classList.contains("has-repo-tint")).toBe(false);
  });

  test("the origin-named join tints when repoName is the-ant-hill", () => {
    M.setRepoColors(originEnvelope.repoNames, originEnvelope.settings);
    const session = agent({
      repo: {
        repoKey: "the-ant-hill",
        repoName: "the-ant-hill",
        worktreePath: "/Users/e/Developer/the-mountain",
        ephemeral: false,
      },
    });
    const pane = paintDesk(session, program({ name: "the-ant-hill", agents: [session] }));
    const desk = byClass(pane, "drawer-desk")[0]!;
    expect(M.repoTintFor("the-ant-hill")).toBe(STORM);
    expect(desk.classList.contains("has-repo-tint")).toBe(true);
    expect(desk.props["--repo-tint"]).toBe(STORM);
  });

  test("the join refuses a folder name when the assignment is origin-named", () => {
    /* repoKey is a live assignment key. repoName is not. paintRepoTint(…, repo.repoKey)
       would tint; paintRepoTint(…, repo.repoName) must not. Default agent() cannot
       catch this — its repoKey is "hash", which has no hex either way. */
    M.setRepoColors(originEnvelope.repoNames, originEnvelope.settings);
    const session = agent({
      repo: {
        repoKey: "the-ant-hill",
        repoName: "the-mountain",
        worktreePath: "/Users/e/Developer/the-mountain",
        ephemeral: false,
      },
    });
    const pane = paintDesk(session, program({ agents: [session] }));
    const desk = byClass(pane, "drawer-desk")[0]!;
    expect(M.repoTintFor("the-mountain")).toBe("");
    expect(M.repoTintFor("the-ant-hill")).toBe(STORM);
    expect(desk.classList.contains("has-repo-tint")).toBe(false);
    expect(desk.props["--repo-tint"]).toBeUndefined();
  });

  test("an unassigned repository leaves the desk on the unscoped CSS", () => {
    const session = agent();
    const pane = paintDesk(session, program({ agents: [session] }));
    const desk = byClass(pane, "drawer-desk")[0]!;
    expect(desk.classList.contains("has-repo-tint")).toBe(false);
    expect(desk.props["--repo-tint"]).toBeUndefined();
  });

  test("a needs-you session still tints the desk when a hex exists", () => {
    /* status:"attention" → deriveOutcome "needs-you". The hook-shaped
       waiting+needsInput fixture in this file is outcome "healthy" and wears
       no attention class — a paint skip on needs-you/blocked/failed would
       stay green on that shape. Do not use it here. */
    useColors({ "the-mountain": "mtn" }, { mtn: SIENNA });
    const session = agent({ status: "attention", lifecycle: "waiting" });
    const pane = paintDesk(session, program({ agents: [session] }));
    const desk = byClass(pane, "drawer-desk")[0]!;
    expect(desk.classList.contains("has-repo-tint")).toBe(true);
    expect(desk.props["--repo-tint"]).toBe(SIENNA);
  });

  test("inspectorPaintSig moves when repoColorsVersion does, with the agent unchanged", () => {
    const session = agent();
    const view = { kind: "agent", agent: session, program: program({ agents: [session] }) };
    const sel = { kind: "agent", id: session.id };
    const ui = inspectorUi();
    M.setRepoColors({}, { assignments: {} });
    const before = M.inspectorPaintSig(sel, view, ui);
    M.setRepoColors({}, { assignments: {} });
    const after = M.inspectorPaintSig(sel, view, ui);
    expect(after).not.toBe(before);
  });

  test("the desk override is 4% into --surface and a 45% spine; the unscoped desk is untouched", () => {
    expect(styles).toMatch(
      /\.drawer-desk\.has-repo-tint[\s\S]{0,200}var\(--repo-tint\) 4%[\s\S]{0,80}var\(--surface\)/,
    );
    expect(styles).toMatch(
      /\.drawer-desk\.has-repo-tint[\s\S]{0,240}border-left:\s*2px\s+solid\s+color-mix\(in srgb, var\(--repo-tint\) 45%/,
    );
    expect(styles).toMatch(/\.drawer-desk\s*\{[^}]*border-left:\s*2px\s+solid\s+var\(--ink\)/);
    expect(styles).toMatch(/\n\.drawer-desk \{([^}]*overflow-y:\s*auto[^}]*--sand[^}]*)\}/);
  });
});
