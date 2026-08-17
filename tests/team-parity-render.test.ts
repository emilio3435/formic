import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* Select-mode pick-set is not the drawer. A harness that let grouping reuse
   selectedId / .is-selected would stay green while Whisper wash vanished and
   the inspector stole the click. Copied from team-tint-render so style.setProperty
   is still the colour write — this file is about grouping, not tint. */

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
  parentNode: FakeNode | null;
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
    parentNode: null as FakeNode | null,
    props,
    attributes: {} as Record<string, string>,
    dataset: {} as Record<string, string>,
    children: [] as FakeNode[],
    listeners: {} as Record<string, Array<(event: unknown) => unknown>>,
    value: "",
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
        const child = kid as FakeNode;
        if (child && typeof child === "object") child.parentNode = node as unknown as FakeNode;
        node.children.push(child);
      }
    },
    insertBefore(child: FakeNode, ref?: FakeNode | null) {
      if (child && typeof child === "object") child.parentNode = node as unknown as FakeNode;
      const index = ref ? node.children.indexOf(ref) : -1;
      if (index >= 0) node.children.splice(index, 0, child);
      else node.children.push(child);
    },
    remove() {
      const parent = node.parentNode;
      if (!parent) return;
      const siblings = parent.children || [];
      const index = siblings.indexOf(node as unknown as FakeNode);
      if (index >= 0) siblings.splice(index, 1);
      node.parentNode = null;
    },
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
  const bar = makeNode("div");
  bar.setAttribute("id", "filter-bar");
  const note = makeNode("p");
  note.setAttribute("id", "bar-scope-note");
  bar.append(note);
  const toast = makeNode("div");
  toast.setAttribute("id", "toast");
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
      agents: [agent({ team: { id: "g1", name: "ANT · probe", hex: MOSS, windowId: "WINDOW-A" } })],
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
  selectMode: false,
  groupingIds: new Set<string>(),
});

const boardIndexStub = () => ({ byId: new Map(), ambiguous: new Set(), sharedNames: new Set() });

function resetGrouping() {
  M.state.selectMode = false;
  M.state.groupingIds = new Set();
  M.state.groupingName = "";
  M.state.groupingHex = "";
  M.state.groupingPending = false;
  M.state.selectedId = null;
  M.state.teamRenaming = null;
  M.state.teamRenameDraft = "";
  M.state.teamRenamePending = false;
  M.state.teamRenameError = "";
  M.state.view = "board";
  M.state.snap = null;
}

function renderRow(one = agent(), extras: Record<string, unknown> = {}) {
  const prog = program({ agents: [one] });
  const plan = M.agentRowPlan(prog, [one], { ...ui(), ...extras, selectMode: M.state.selectMode, groupingIds: M.state.groupingIds, selectedId: M.state.selectedId }, boardIndexStub(), { finished: [], banded: false });
  return withDom(() => plan.find((item: { key: string }) => item.key === "row:" + one.id).build()) as unknown as FakeNode;
}

function groupingCheck(root: unknown): FakeNode | undefined {
  return walk(root, (node) =>
    String(node.tagName).toLowerCase() === "input"
    && (node.attributes.type === "checkbox" || node.props.type === "checkbox")
    && (node.classList.contains("grouping-check") || String(node.dataset.fkey || "").startsWith("group-pick:")))[0];
}

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
  resetGrouping();
});

describe("groupingIds is not the drawer", () => {
  test("checking a row for a group does not move selectedId", () => {
    /* Drawer selectedId paints .is-selected and evicts Whisper wash. The pick
       set has to be a second bag or grouping a teal band would bleach it. */
    const one = agent();
    M.state.selectedId = "codex:other";
    M.state.selectMode = true;
    M.setGrouping(one.id, true);
    expect(M.state.groupingIds.has(one.id)).toBe(true);
    expect(M.state.selectedId).toBe("codex:other");
    const row = renderRow(one);
    expect(row.classList.contains("is-grouping")).toBe(true);
    expect(row.classList.contains("is-selected")).toBe(false);
  });

  test("the open drawer row can stay is-selected while another row is is-grouping", () => {
    M.state.selectedId = "codex:a1";
    M.state.selectMode = true;
    M.setGrouping("codex:a2", true);
    const drawer = renderRow(agent({ id: "codex:a1" }));
    const picked = renderRow(agent({ id: "codex:a2", target: { resolution: "exact", workspaceId: "w2" } }));
    expect(drawer.classList.contains("is-selected")).toBe(true);
    expect(drawer.classList.contains("is-grouping")).toBe(false);
    expect(picked.classList.contains("is-grouping")).toBe(true);
    expect(picked.classList.contains("is-selected")).toBe(false);
  });
});

describe("select mode checkboxes", () => {
  test("rows have no grouping checkbox until Select is on", () => {
    M.state.selectMode = false;
    expect(groupingCheck(renderRow())).toBeUndefined();
  });

  test("Select stamps a checkbox on a mapped row and a disabled one when there is no workspaceId", () => {
    M.state.selectMode = true;
    const mapped = groupingCheck(renderRow(agent()));
    expect(mapped).toBeTruthy();
    expect(mapped!.hasAttribute("disabled")).toBe(false);

    const bareAgent = agent({
      id: "codex:bare",
      target: { resolution: "unresolved" },
    });
    const bare = groupingCheck(renderRow(bareAgent));
    expect(bare).toBeTruthy();
    expect(bare!.hasAttribute("disabled")).toBe(true);
    M.state.snap = { programs: [program({ agents: [bareAgent] })] };
    M.setGrouping("codex:bare", true);
    expect(M.state.groupingIds.has("codex:bare")).toBe(false);
  });
});

describe("group chip", () => {
  test("the Group chip is hidden while the pick-set is empty", () => {
    M.state.selectMode = true;
    const bar = withDom(() => {
      M.renderFilterBar();
      return document.getElementById("filter-bar");
    }) as unknown as FakeNode;
    expect(bar.textContent).toContain("Select");
    expect(byClass(bar, "grouping-chip")).toHaveLength(0);
    expect(bar.textContent).not.toMatch(/Group \d+ terminals?/);
  });

  test("a non-empty pick-set mounts a temporary chip whose default name is not Group N", () => {
    const one = agent();
    M.state.snap = { programs: [program({ agents: [one] })] };
    M.state.selectMode = true;
    M.setGrouping(one.id, true);
    expect(M.defaultGroupingName()).toBe("the-mountain");
    expect(M.defaultGroupingName()).not.toMatch(/^Group \d+$/);
    const bar = withDom(() => {
      M.renderFilterBar();
      return document.getElementById("filter-bar");
    }) as unknown as FakeNode;
    const chip = byClass(bar, "grouping-chip")[0];
    expect(chip).toBeTruthy();
    expect(chip!.textContent).toMatch(/Group 1 terminals?/);
    const name = walk(chip, (node) =>
      String(node.tagName).toLowerCase() === "input"
      && (node.attributes.type === "text" || node.props.type === "text"))[0];
    expect(name).toBeTruthy();
    expect(name!.value || name!.attributes.value || name!.props.value).toBe("the-mountain");
  });

  test("with no program name the default is Team, never Group N", () => {
    const one = agent();
    M.state.snap = { programs: [program({ name: "", agents: [one] })] };
    M.setGrouping(one.id, true);
    expect(M.defaultGroupingName()).toBe("Team");
    expect(M.defaultGroupingName()).not.toMatch(/^Group \d+$/);
  });
});

describe("create POST", () => {
  test("POST /api/teams sends unique workspace ids and a real name", async () => {
    const twin = agent({ id: "codex:a2", target: { resolution: "exact", workspaceId: "w1" } });
    const other = agent({ id: "codex:a3", target: { resolution: "exact", workspaceId: "w2" } });
    const bare = agent({ id: "codex:bare", target: { resolution: "unresolved" } });
    M.state.snap = { programs: [program({ name: "ROWS-0816", agents: [agent(), twin, other, bare] })] };
    M.state.groupingIds = new Set(["codex:a1", "codex:a2", "codex:a3", "codex:bare"]);
    M.state.groupingName = "";
    M.state.groupingHex = TEAL;
    const calls: { url: string; method: string; body?: string }[] = [];
    const realFetch = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = async (
      url: string,
      init?: { method?: string; body?: string },
    ) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body });
      return new Response(JSON.stringify({
        team: { id: "g9", name: "ROWS-0816", hex: TEAL, windowId: "WINDOW-A", memberWorkspaceIds: ["w1", "w2"] },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      await withDom(() => M.createGroupingTeam()).catch(() => {});
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
    }
    const create = calls.find((call) => call.url === "/api/teams" && call.method === "POST");
    expect(create).toBeTruthy();
    const body = JSON.parse(create!.body || "{}") as { workspaceIds: string[]; name: string; hex?: string; windowId?: string };
    expect(body.workspaceIds).toEqual(["w1", "w2"]);
    expect(body.workspaceIds).not.toContain("");
    expect(body.name).toBe("ROWS-0816");
    expect(body.name).not.toMatch(/^Group \d+$/);
    expect(body.hex).toBe(TEAL);
    expect(body.windowId).toBeUndefined();
  });

  test("when every pick shares one team.windowId the POST names that window", async () => {
    const one = agent({ team: { id: "g1", name: "ANT · probe", hex: MOSS, windowId: "WINDOW-A" } });
    const two = agent({
      id: "codex:a2",
      target: { resolution: "exact", workspaceId: "w2" },
      team: { id: "g1", name: "ANT · probe", hex: MOSS, windowId: "WINDOW-A" },
    });
    M.state.snap = { programs: [program({ agents: [one, two] })] };
    M.state.groupingIds = new Set([one.id, two.id]);
    M.state.groupingName = "ROWS-0816";
    M.state.groupingHex = STORM;
    const calls: { url: string; method: string; body?: string }[] = [];
    const realFetch = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = async (
      url: string,
      init?: { method?: string; body?: string },
    ) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body });
      return new Response(JSON.stringify({
        team: { id: "g9", name: "ROWS-0816", hex: STORM, windowId: "WINDOW-A", memberWorkspaceIds: ["w1", "w2"] },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      await withDom(() => M.createGroupingTeam()).catch(() => {});
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
    }
    const body = JSON.parse(calls[0]!.body || "{}") as { windowId?: string; workspaceIds: string[] };
    expect(body.windowId).toBe("WINDOW-A");
    expect(body.workspaceIds).toEqual(["w1", "w2"]);
  });

  test("mixed team.windowId values toast MIXED_WINDOW and do not invent a window", async () => {
    const one = agent({ team: { id: "g1", name: "ANT · probe", hex: MOSS, windowId: "WINDOW-A" } });
    const two = agent({
      id: "codex:a2",
      target: { resolution: "exact", workspaceId: "w2" },
      team: { id: "g2", name: "ROWS-0816", hex: STORM, windowId: "WINDOW-B" },
    });
    M.state.snap = { programs: [program({ agents: [one, two] })] };
    M.state.groupingIds = new Set([one.id, two.id]);
    M.state.groupingName = "ROWS-0816";
    expect(M.groupingSharedWindowId()).toBe("");
    const calls: { url: string; method: string; body?: string }[] = [];
    const realFetch = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = async (
      url: string,
      init?: { method?: string; body?: string },
    ) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body });
      return new Response(JSON.stringify({ error: "Every workspace must already live in the same window.", code: "MIXED_WINDOW" }), {
        status: 400, headers: { "content-type": "application/json" },
      });
    };
    try {
      await withDom(() => M.createGroupingTeam()).catch(() => {});
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
    }
    const create = calls.find((call) => call.url === "/api/teams");
    expect(create).toBeTruthy();
    const body = JSON.parse(create!.body || "{}") as { windowId?: string };
    expect(body.windowId).toBeUndefined();
  });
});

describe("band rename and ungroup", () => {
  test("a team band name is a program-label button, not a static span", () => {
    const section = withDom(() => M.renderRepoSection(teamBand(), ui())) as unknown as FakeNode;
    const name = byClass(section, "repo-name")[0];
    expect(name).toBeTruthy();
    expect(String(name!.tagName).toLowerCase()).toBe("button");
    expect(name!.classList.contains("program-label")).toBe(true);
    expect(name!.textContent).toBe("ANT · probe");
    expect(byClass(section, "team-ungroup").length).toBeGreaterThan(0);
  });

  test("saving the band name PATCHes /api/teams/:id", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const realFetch = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = async (
      url: string,
      init?: { method?: string; body?: string },
    ) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      M.state.teamRenameDraft = "ROWS-0816";
      await withDom(() => M.submitTeamRename("g1")).catch(() => {});
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
    }
    expect(calls[0]).toEqual({
      url: "/api/teams/g1",
      method: "PATCH",
      body: JSON.stringify({ name: "ROWS-0816" }),
    });
  });

  test("ungroup DELETEs /api/teams/:id only after confirm", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const realFetch = (globalThis as { fetch?: unknown }).fetch;
    const realConfirm = (globalThis as { confirm?: unknown }).confirm;
    (globalThis as unknown as { fetch: unknown }).fetch = async (
      url: string,
      init?: { method?: string; body?: string },
    ) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    };
    (globalThis as unknown as { confirm: unknown }).confirm = () => false;
    try {
      await withDom(() => M.ungroupTeam("g1", "ANT · probe")).catch(() => {});
      expect(calls).toEqual([]);
      (globalThis as unknown as { confirm: unknown }).confirm = () => true;
      await withDom(() => M.ungroupTeam("g1", "ANT · probe")).catch(() => {});
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
      if (realConfirm === undefined) delete (globalThis as { confirm?: unknown }).confirm;
      else (globalThis as unknown as { confirm: unknown }).confirm = realConfirm;
    }
    expect(calls[0]).toEqual({ url: "/api/teams/g1", method: "DELETE" });
  });
});

describe("select-mode identity grid", () => {
  test("a grouping checkbox adds a track so the name stays out of the marks column", () => {
    /* .row-identity.has-dual-marks is 2.2rem / 1fr. Auto-placing the checkbox
       as a third child wrapped the name into the 2.2rem marks cell, and a
       44px box cannot live in 2.2rem. The name must stay in the last track. */
    const dual = cssRuleBody(styles, ".row-identity.has-dual-marks:has(.grouping-check)");
    expect(dual).toMatch(/grid-template-columns:\s*auto\s+2\.2rem\s+minmax\(\s*0\s*,\s*1fr\s*\)/);
    const name = cssRuleBody(styles, ".row-identity:has(.grouping-check) .agent-name-wrap");
    const time = cssRuleBody(styles, ".row-identity:has(.grouping-check) .row-time-band");
    const tags = cssRuleBody(styles, ".row-identity:has(.grouping-check) .row-identity-tags");
    expect(name).toMatch(/grid-column:\s*3/);
    expect(time).toMatch(/grid-column:\s*3/);
    expect(tags).toMatch(/grid-column:\s*3/);
    M.state.selectMode = true;
    const row = renderRow(agent());
    const identity = byClass(row, "row-identity")[0];
    expect(identity).toBeTruthy();
    expect(identity!.classList.contains("has-dual-marks")).toBe(true);
    expect(groupingCheck(identity)).toBeTruthy();
    expect(byClass(identity, "agent-name-wrap").length).toBe(1);
  });

  test("is-grouping does not write box-shadow so the strip tick and alert outline keep the slot", () => {
    /* Ember/alert-hot and the 3px repo tick both live in box-shadow.
       A pick rail in that slot vanished on Needs-you rows. */
    const grouping = cssRuleBody(styles, ".agent-row.is-grouping");
    expect(grouping).not.toMatch(/box-shadow/);
    expect(styles).not.toMatch(/\.agent-row\.is-grouping[^{]*\{[^}]*box-shadow/);
    const alert = cssRuleBody(styles, ".agent-row.is-alert-hot");
    expect(alert).toMatch(/box-shadow/);
    const tick = cssRuleBody(styles, ".agent-row.has-repo-tick:not(.is-alert-hot):not(.is-selected):not(.is-floating)");
    expect(tick).toMatch(/box-shadow/);
  });
});

describe("phone hit targets", () => {
  test("at max-width 720px the grouping checkbox is 44px", () => {
    /* 420 has no hover. A hover-only 16px box is a miss. */
    const mobile = mediaBlocks(styles, "(max-width: 720px)").join("\n");
    const rule = cssRuleBody(mobile, ".grouping-check");
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

describe("source pins", () => {
  test("grouping never writes selectedId or is-selected", () => {
    expect(source).toMatch(/groupingIds/);
    expect(source).toMatch(/is-grouping/);
    expect(source).not.toMatch(/groupingIds\s*=\s*state\.selectedId/);
  });
});
