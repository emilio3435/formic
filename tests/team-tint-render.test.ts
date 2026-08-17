import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* Team overlay on Whisper: same CSSOM write as TINT-F (`style.setProperty`),
   so a harness that swallows that write would let every assertion pass over a
   board with no colour on it. Copied from repo-tint-render, not shared, for
   the same reason that file does not share web-client's node. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let M: any;
let source = "";
let styles = "";

beforeAll(async () => {
  // @ts-expect-error The dependency-free browser client has no declaration file.
  await import("../src/web/app.js");
  M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
  const webDir = join(import.meta.dir, "../src/web");
  source = readFileSync(join(webDir, "app.js"), "utf8");
  styles = readFileSync(join(webDir, "styles.css"), "utf8");
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
    get textContent() {
      return text + node.children.map((kid) => (kid && kid.textContent) || "").join("");
    },
    set textContent(v: string) { text = String(v ?? ""); node.children.length = 0; },
    get className() { return [...classes].join(" "); },
    set className(v: string) {
      classes.clear();
      for (const c of String(v).split(/\s+/)) if (c) classes.add(c);
    },
    classList: {
      add(...c: string[]) { for (const x of c) if (c) classes.add(x); },
      remove(...c: string[]) { for (const x of c) classes.delete(x); },
      toggle(c: string, on?: boolean) {
        if (on === undefined ? classes.has(c) : !on) classes.delete(c);
        else classes.add(c);
      },
      contains(c: string) { return classes.has(c); },
    },
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
const MOSS = "#5f7f2a";
const TEAL = "#0e9494";

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

function teamBand(overrides: Record<string, unknown> = {}) {
  return {
    kind: "team",
    key: "g1",
    name: "ANT · probe",
    hex: MOSS,
    pullRequestUrls: [],
    worktrees: [{
      program: program(),
      agents: [agent({ team: { id: "g1", name: "ANT · probe", hex: MOSS } })],
      finished: [],
      worktreeKey: "wt1",
      label: "wt1",
    }],
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

const boardIndexStub = () => ({ byId: new Map(), ambiguous: new Set(), sharedNames: new Set() });

beforeEach(() => {
  M.setRepoColors({}, { assignments: {} });
  M.state.liveRepoKeys = [];
  M.state.repoColorSettings = null;
  M.state.teamColors = [];
  M.state.settingsPanelOpen = false;
  if (M.state.paintSig) {
    M.state.paintSig.settings = "";
    M.state.paintSig["repo-colors"] = "";
    M.state.paintSig["team-colors"] = "";
  }
});

describe("teamGroups", () => {
  test("two programs same repo different team become two bands", () => {
    const visible = [
      { program: { id: "p1", name: "orch", groupPath: ["the-ant-hill", "wt1"] },
        agents: [{ team: { id: "g1", name: "ANT · probe", hex: "#5f7f2a" } }], finished: [] },
      { program: { id: "p2", name: "rows", groupPath: ["the-ant-hill", "wt2"] },
        agents: [{ team: { id: "g2", name: "ROWS-0816", hex: "#2e66a8" } }], finished: [] },
    ];
    const groups = M.teamGroups(visible);
    expect(groups.filter((g: { kind: string }) => g.kind === "team").map((g: { name: string }) => g.name)).toEqual([
      "ANT · probe",
      "ROWS-0816",
    ]);
    expect(groups[0].hex).not.toBe(groups[1].hex);
  });

  test("ungrouped program still one repo band", () => {
    const visible = [
      { program: { id: "p3", name: "formic", groupPath: ["the-ant-hill", "wt3"] },
        agents: [{ repo: { repoName: "the-ant-hill" } }], finished: [] },
    ];
    const groups = M.teamGroups(visible);
    expect(groups.some((g: { kind: string; key: string }) => g.kind === "repo" && g.key === "the-ant-hill")).toBe(true);
  });

  test("four Formic swarms on one origin do not share one hex", () => {
    /* This is the product reason the overlay exists: TINT collapsed every
       the-ant-hill checkout to one magenta pile. A snapshot that accepted any
       tint would stay green while four swarms still wore one colour. */
    const hexes = [MOSS, STORM, SIENNA, TEAL];
    const names = ["ANT · probe", "ROWS-0816", "orch", "desk"];
    const visible = names.map((name, i) => ({
      program: { id: "p" + i, name, groupPath: ["the-ant-hill", "wt" + i] },
      agents: [{ team: { id: "g" + i, name, hex: hexes[i] } }],
      finished: [],
    }));
    const groups = M.teamGroups(visible).filter((g: { kind: string }) => g.kind === "team");
    expect(groups.map((g: { hex: string }) => g.hex)).toEqual(hexes);
    expect(new Set(groups.map((g: { hex: string }) => g.hex)).size).toBe(4);
  });

  test("mixed-team program splits; leftover ungrouped agents stay a repo band", () => {
    const visible = [
      {
        program: { id: "p-mix", name: "orch", groupPath: ["the-ant-hill", "wt1"] },
        agents: [
          { id: "a1", team: { id: "g1", name: "ANT · probe", hex: MOSS } },
          { id: "a2", team: { id: "g2", name: "ROWS-0816", hex: STORM } },
          { id: "a3", repo: { repoName: "the-ant-hill" } },
        ],
        finished: [],
      },
    ];
    const groups = M.teamGroups(visible);
    const teams = groups.filter((g: { kind: string }) => g.kind === "team");
    expect(teams.map((g: { name: string }) => g.name)).toEqual(["ANT · probe", "ROWS-0816"]);
    expect(teams[0].worktrees[0].agents.map((a: { id: string }) => a.id)).toEqual(["a1"]);
    expect(teams[1].worktrees[0].agents.map((a: { id: string }) => a.id)).toEqual(["a2"]);
    expect(groups.some((g: { kind: string; key: string }) => g.kind === "repo" && g.key === "the-ant-hill")).toBe(true);
  });
});

describe("tintOfProgram", () => {
  test("returns the team hex when every agent that has a team shares it", () => {
    expect(M.tintOfProgram({
      id: "p1",
      name: "orch",
      agents: [
        { team: { id: "g1", name: "ANT · probe", hex: MOSS }, repo: { repoName: "the-ant-hill" } },
        { team: { id: "g1", name: "ANT · probe", hex: MOSS }, repo: { repoName: "the-ant-hill" } },
      ],
    })).toBe(MOSS);
  });

  test("falls back to the repo hex when team hexes disagree", () => {
    useColors({ "the-ant-hill": "the-ant-hill" }, { "the-ant-hill": SIENNA });
    expect(M.tintOfProgram({
      id: "p1",
      name: "orch",
      agents: [
        { team: { id: "g1", name: "ANT · probe", hex: MOSS }, repo: { repoName: "the-ant-hill" } },
        { team: { id: "g2", name: "ROWS-0816", hex: STORM }, repo: { repoName: "the-ant-hill" } },
      ],
    })).toBe(SIENNA);
  });

  test("falls back to the repo hex when no agent carries a team", () => {
    useColors({ "the-mountain": "mtn" }, { mtn: SIENNA });
    expect(M.tintOfProgram(program())).toBe(SIENNA);
  });

  test("treats #5F7F2A and #5f7f2a as one colour, not two", () => {
    /* Auto-assigned palette hexes may still ship mixed case. Case is spelling,
       not identity — averaging or falling back to repo here would re-collapse
       a unanimous team. */
    expect(M.tintOfProgram({
      id: "p1",
      name: "orch",
      agents: [
        { team: { id: "g1", name: "ANT · probe", hex: "#5F7F2A" } },
        { team: { id: "g1", name: "ANT · probe", hex: "#5f7f2a" } },
      ],
    })).toBe(MOSS);
  });
});

describe("team band paint", () => {
  test("a team band paints the team hex through setProperty and prints the group name", () => {
    const section = withDom(() => M.renderRepoSection(teamBand(), ui())) as unknown as FakeNode;
    expect(section.classList.contains("has-repo-tint")).toBe(true);
    expect(section.props["--repo-tint"]).toBe(MOSS);
    expect(section.attributes.style).toBeUndefined();
    expect(byClass(section, "repo-name")[0]!.textContent).toBe("ANT · probe");
    expect(byClass(section, "swatch")).toHaveLength(1);
  });

  test("a team hex the repo table has never seen still paints — lookup is not by name", () => {
    /* repoTintFor("ANT · probe") misses. The band must take group.hex, or
       every operator team renders as an untinted repo card. */
    expect(M.repoTintFor("ANT · probe")).toBe("");
    const section = withDom(() => M.renderRepoSection(teamBand(), ui())) as unknown as FakeNode;
    expect(section.props["--repo-tint"]).toBe(MOSS);
  });

  test("the band's paint signature moves when group.hex does", () => {
    const before = M.repoShellSig(teamBand(), ui());
    expect(M.repoShellSig(teamBand({ hex: STORM }), ui())).not.toBe(before);
  });

  test("the tint rides a CSSOM property, never a style attribute", () => {
    const section = withDom(() => M.renderRepoSection(teamBand(), ui())) as unknown as FakeNode;
    expect(section.attributes.style).toBeUndefined();
    expect(source).not.toMatch(/style:\s*["'`][^"'`]*--repo-tint/);
  });
});

describe("row and desk wear the team hex", () => {
  test("an unbanded row wears the team hex when agents carry a team", () => {
    const one = agent({ team: { id: "g1", name: "ANT · probe", hex: MOSS } });
    const prog = program({ agents: [one] });
    const plan = M.agentRowPlan(prog, [one], ui(), boardIndexStub(), { finished: [], banded: false });
    const row = withDom(() => plan.find((item: { key: string }) => item.key === "row:" + one.id).build()) as unknown as FakeNode;
    expect(row.classList.contains("has-repo-tick")).toBe(true);
    expect(row.props["--repo-tint"]).toBe(MOSS);
  });

  test("rows inside a team band get no tick — the card above them already says it", () => {
    const one = agent({ team: { id: "g1", name: "ANT · probe", hex: MOSS } });
    const prog = program({ agents: [one] });
    const plan = M.agentRowPlan(prog, [one], ui(), boardIndexStub(), { finished: [], banded: true });
    const row = withDom(() => plan.find((item: { key: string }) => item.key === "row:" + one.id).build()) as unknown as FakeNode;
    expect(row.classList.contains("has-repo-tick")).toBe(false);
    expect(row.props["--repo-tint"]).toBeUndefined();
  });

  test("the evidence desk wears the team hex when agents carry a team", () => {
    const session = agent({ team: { id: "g1", name: "ANT · probe", hex: MOSS } });
    const pane = withDom(() => {
      const root = document.createElement("div") as unknown as FakeNode;
      M.renderAgentDrawer(root, { kind: "agent", agent: session, program: program({ agents: [session] }) });
      return root;
    }) as unknown as FakeNode;
    const desk = byClass(pane, "drawer-desk")[0]!;
    expect(desk.classList.contains("has-repo-tint")).toBe(true);
    expect(desk.props["--repo-tint"]).toBe(MOSS);
  });
});

describe("ALL view wiring", () => {
  test("the board groups through teamGroups, not repoGroups alone", () => {
    expect(source).toMatch(/const groups = teamGroups\(visible\)/);
  });
});

describe("strip heading wears the team hex", () => {
  test("two same-repo programs with different teams get two strip-head hexes", () => {
    /* Alerting Formic pills live here. Looking up by repoName would collapse
       both to one magenta the-ant-hill pill — the defect this overlay exists
       to stop. The word on the pill can stay the repo; only the hex follows
       the team. */
    useColors({ "the-ant-hill": "the-ant-hill" }, { "the-ant-hill": SIENNA });
    const anthill = {
      repoKey: "the-ant-hill",
      repoName: "the-ant-hill",
      worktreePath: "/Users/e/Developer/the-mountain",
      ephemeral: false,
    };
    const orch = program({
      id: "p1",
      name: "orch",
      agents: [agent({ id: "a1", team: { id: "g1", name: "ANT · probe", hex: MOSS }, repo: anthill })],
    });
    const rows = program({
      id: "p2",
      name: "rows",
      agents: [agent({ id: "a2", team: { id: "g2", name: "ROWS-0816", hex: STORM }, repo: anthill })],
    });
    const head1 = withDom(() => M.renderStripGroupHead(orch, "the-ant-hill · wt1")) as unknown as FakeNode;
    const head2 = withDom(() => M.renderStripGroupHead(rows, "the-ant-hill · wt2")) as unknown as FakeNode;
    const pill1 = byClass(head1, "strip-repo-pill")[0]!;
    const pill2 = byClass(head2, "strip-repo-pill")[0]!;
    expect(pill1.textContent).toBe("the-ant-hill");
    expect(pill2.textContent).toBe("the-ant-hill");
    expect(pill1.props["--repo-tint"]).toBe(MOSS);
    expect(pill2.props["--repo-tint"]).toBe(STORM);
    expect(pill1.props["--repo-tint"]).not.toBe(pill2.props["--repo-tint"]);
    /* Alert-row reversed the withhold: the strip row keeps the same wash the
       heading wears. For a single-team program that wash is the team hex, not
       the repo's. The heading pill still says the repo word. */
    expect(M.stripRowOpts(orch, boardIndexStub()).repoTint).toBe(MOSS);
    expect(M.stripRowOpts(rows, boardIndexStub()).repoTint).toBe(STORM);
  });
});

function cssRuleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(escaped + "\\s*\\{([^}]*)\\}"))?.[1] ?? "";
}

function cssLengthPx(body: string, prop: string): number {
  const match = body.match(new RegExp(prop + ":\\s*([0-9.]+)(px|rem)"));
  if (!match) return 0;
  const value = Number(match[1]);
  return match[2] === "rem" ? value * 16 : value;
}

function mediaBlocks(css: string, query: string): string[] {
  const blocks: string[] = [];
  let from = 0;
  while (from < css.length) {
    const start = css.indexOf("@media " + query, from);
    if (start < 0) break;
    const open = css.indexOf("{", start);
    if (open < 0) break;
    let depth = 0;
    let end = -1;
    for (let index = open; index < css.length; index++) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    if (end < 0) break;
    blocks.push(css.slice(open + 1, end));
    from = end + 1;
  }
  return blocks;
}

function teamColorControl(root: unknown): FakeNode | undefined {
  return walk(root, (node) => {
    if (String(node.tagName).toLowerCase() !== "button") return false;
    if (node.attributes.tabindex === "-1") return false;
    if (node.classList.contains("repo-caret")) return false;
    return node.classList.contains("swatch")
      || node.classList.contains("repo-tint-picker")
      || byClass(node, "swatch").length > 0;
  })[0];
}

describe("team band-head picker", () => {
  test("putTeamColor PUTs /api/team-colors/:groupId, never the repo endpoint", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const realFetch = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = async (
      url: string,
      init?: { method?: string; body?: string },
    ) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body });
      return new Response(JSON.stringify({
        teams: [{ id: "g1", name: "ANT · probe", hex: STORM, windowId: "w", memberWorkspaceIds: [] }],
        settings: { assignments: { g1: { groupId: "g1", hex: STORM, source: "user" } } },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      await withDom(() => M.putTeamColor("g1", STORM)).catch(() => {});
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
    }
    expect(calls[0]).toEqual({
      url: "/api/team-colors/g1",
      method: "PUT",
      body: JSON.stringify({ hex: STORM }),
    });
    expect(calls.some((call) => call.url.includes("/api/repo-colors/"))).toBe(false);
  });

  test("a team band head offers a colour picker keyed on the group id", () => {
    const section = withDom(() => M.renderRepoSection(teamBand(), ui())) as unknown as FakeNode;
    const picker = walk(section, (node) =>
      String(node.tagName).toLowerCase() === "input"
      && (node.attributes.type === "color" || node.props.type === "color"))[0];
    expect(picker).toBeTruthy();
    expect(picker!.dataset.fkey).toBe("team-color:g1");
  });

  test("the band head has a focusable colour control whose click target is at least 16px", () => {
    /* Shipped UI hid the picker: a tabindex=-1 1×1 input plus a 7px
       aria-hidden repo-dot. Teal in Settings or on the band is the same
       write — an operator has to be able to tab to it and hit it. */
    const section = withDom(() => M.renderRepoSection(teamBand(), ui())) as unknown as FakeNode;
    const control = teamColorControl(section);
    expect(control).toBeTruthy();
    expect(control!.attributes.tabindex).not.toBe("-1");
    expect(control!.classList.contains("visually-hidden")).toBe(false);
    const pickerRule = cssRuleBody(styles, ".repo-tint-picker");
    const click = Math.max(
      cssLengthPx(pickerRule, "min-width"),
      cssLengthPx(pickerRule, "width"),
    );
    expect(click).toBeGreaterThanOrEqual(16);
    expect(Math.max(
      cssLengthPx(pickerRule, "min-height"),
      cssLengthPx(pickerRule, "height"),
    )).toBeGreaterThanOrEqual(16);
  });

  test("a visible swatch button opens the colour input — the 7px dot is not the target", () => {
    const section = withDom(() => M.renderRepoSection(teamBand(), ui())) as unknown as FakeNode;
    const picker = walk(section, (node) =>
      String(node.tagName).toLowerCase() === "input"
      && (node.attributes.type === "color" || node.props.type === "color"))[0];
    const control = teamColorControl(section);
    expect(control).toBeTruthy();
    expect(byClass(section, "swatch").length).toBeGreaterThan(0);
    expect(picker!.attributes.tabindex).toBe("-1");
    let opened = false;
    picker!.click = () => { opened = true; };
    control!.listeners.click?.[0]?.();
    expect(opened).toBe(true);
  });

  test("at max-width 720px the team colour picker is 44px", () => {
    /* Phone width has no hover. A 16px band-head hit is still a miss. */
    const mobile = mediaBlocks(styles, "(max-width: 720px)").join("\n");
    const rule = cssRuleBody(mobile, ".repo-tint-picker");
    expect(Math.max(
      cssLengthPx(rule, "min-width"),
      cssLengthPx(rule, "width"),
    )).toBe(44);
    expect(Math.max(
      cssLengthPx(rule, "min-height"),
      cssLengthPx(rule, "height"),
    )).toBe(44);
  });
});

describe("Settings Teams plate", () => {
  test("Settings mounts #team-colors-host next to Repo colours", () => {
    withDom(() => {
      M.state.settingsPanelOpen = true;
      M.renderSettingsPanel();
      expect(document.getElementById("team-colors-host")).toBeTruthy();
      const panel = byId.get("settings-panel")!;
      expect(panel.textContent).toContain("Teams");
      expect(panel.textContent).toContain("Repo colours");
    });
  });

  test("the Teams plate says No operator groups when none are live", () => {
    const region = withDom(() => M.renderTeamColorSettings([])) as unknown as FakeNode;
    expect(region.textContent).toBe("No operator groups.");
  });

  test("opening Settings GETs /api/team-colors so the plate lists live groups", async () => {
    const urls: string[] = [];
    const realFetch = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
      urls.push(String(url));
      /* Incomplete on purpose: a success body would paint after withDom
         tears the document down. The assertion is that the GET is issued. */
      return new Response(JSON.stringify({ ok: false }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    };
    try {
      M.state.settingsPanelOpen = false;
      withDom(() => { void M.openSettingsPanel(); });
      expect(urls.some((url) => url === "/api/team-colors" || url.startsWith("/api/team-colors?"))).toBe(true);
      try { M.closeSettingsPanel(); } catch { /* render() needs the board document */ }
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
    }
  });

  test("each live team is a swatch that PUTs /api/team-colors/:id", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const realFetch = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = async (
      url: string,
      init?: { method?: string; body?: string },
    ) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body });
      return new Response(JSON.stringify({
        teams: [{ id: "g1", name: "ANT · probe", hex: STORM, windowId: "w", memberWorkspaceIds: [] }],
        settings: { assignments: { g1: { groupId: "g1", hex: STORM, source: "user" } } },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      await withDom(() => {
        const region = M.renderTeamColorSettings([
          { id: "g1", name: "ANT · probe", hex: MOSS, windowId: "w", memberWorkspaceIds: [] },
        ]) as unknown as FakeNode;
        expect(byClass(region, "swatch").length).toBeGreaterThan(0);
        expect(region.textContent).toContain("ANT · probe");
        const picker = walk(region, (node) => node.dataset.fkey === "team-color:g1")[0];
        expect(picker).toBeTruthy();
        picker!.value = STORM;
        return picker!.listeners.change?.[0]?.({ currentTarget: picker });
      }).catch(() => {});
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
    }
    expect(calls[0]).toEqual({
      url: "/api/team-colors/g1",
      method: "PUT",
      body: JSON.stringify({ hex: STORM }),
    });
  });
});

describe("strip jump keys the team band", () => {
  test("a teamed program's jump key is the team id, not the-ant-hill", () => {
    const prog = program({
      id: "p1",
      name: "orch",
      groupPath: ["the-ant-hill", "wt1"],
      agents: [agent({
        team: { id: "g1", name: "ANT · probe", hex: MOSS },
        repo: { repoKey: "the-ant-hill", repoName: "the-ant-hill", worktreePath: "/x", ephemeral: false },
      })],
    });
    expect(M.teamIdOfProgram(prog)).toBe("g1");
    expect(M.teamIdOfProgram(prog)).not.toBe("the-ant-hill");
    M.state.repoOverrides = new Map([["g1", "closed"], ["the-ant-hill", "closed"]]);
    withDom(() => {
      try { M.jumpToProgramGroup(prog); } catch { /* render() needs the board document */ }
    });
    expect(M.state.repoOverrides.has("g1")).toBe(false);
    expect(M.state.repoOverrides.has("the-ant-hill")).toBe(true);
  });
});
