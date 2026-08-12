// Minimal fake DOM so renderers can build real nodes via el()/icon().
// Extracted from tests/b2-render-proof.test.ts for reuse by later lanes.

export function makeNode(tag: string): any {
  const classes = new Set<string>();
  let text = "";
  const node: any = {
    nodeType: 1, tagName: tag,
    get textContent() { return text; },
    set textContent(v: string) { text = String(v ?? ""); node.children.length = 0; },
    dataset: {} as Record<string, string>,
    attributes: {} as Record<string, string>,
    children: [] as any[],
    parent: null as any,
    get className() { return [...classes].join(" "); },
    set className(v: string) { classes.clear(); for (const c of String(v).split(/\s+/)) if (c) classes.add(c); },
    classList: {
      add(...c: string[]) { for (const x of c) if (x) classes.add(x); },
      remove(...c: string[]) { for (const x of c) classes.delete(x); },
      toggle(c: string, on?: boolean) { if (on === undefined ? classes.has(c) : !on) classes.delete(c); else classes.add(c); },
      contains(c: string) { return classes.has(c); },
    },
    get childNodes() { return node.children; },
    get childElementCount() { return node.children.length; },
    get firstChild() { return node.children[0] || null; },
    get firstElementChild() { return node.children[0] || null; },
    get nextSibling() {
      if (!node.parent) return null;
      const i = node.parent.children.indexOf(node);
      return (i >= 0 && node.parent.children[i + 1]) || null;
    },
    get hidden() { return "hidden" in node.attributes; },
    set hidden(v: boolean) {
      if (v) node.setAttribute("hidden", "");
      else node.removeAttribute("hidden");
    },
    setAttribute(k: string, v: unknown) { node.attributes[k] = String(v); },
    removeAttribute(k: string) { delete node.attributes[k]; },
    hasAttribute(k: string) { return k in node.attributes; },
    focus() {
      const doc = (globalThis as any).document;
      if (doc) doc.activeElement = node;
    },
    contains(other: any) {
      let cur = other;
      while (cur) {
        if (cur === node) return true;
        cur = cur.parent;
      }
      return false;
    },
    querySelector: () => null, querySelectorAll: () => [] as unknown[],
    listeners: {} as Record<string, any[]>,
    addEventListener(type: string, fn: any) { (node.listeners[type] ??= []).push(fn); },
    append(...kids: unknown[]) {
      for (const kid of kids) {
        if (kid == null) continue;
        node.children.push(kid as any);
        if (typeof kid === "object" && kid !== null && "parent" in (kid as any)) (kid as any).parent = node;
      }
    },
    insertBefore(child: any, ref: any) {
      if (child.parent) {
        const at = child.parent.children.indexOf(child);
        if (at >= 0) child.parent.children.splice(at, 1);
      }
      child.parent = node;
      const i = ref ? node.children.indexOf(ref) : -1;
      if (i === -1) node.children.push(child); else node.children.splice(i, 0, child);
    },
    remove() {
      if (!node.parent) return;
      const at = node.parent.children.indexOf(node);
      if (at >= 0) node.parent.children.splice(at, 1);
      node.parent = null;
    },
  };
  return node;
}

export function fakeDocument() {
  const byId = new Map<string, any>();
  const doc: any = {
    createElement: (t: string) => makeNode(t),
    createElementNS: (_ns: string, t: string) => makeNode(t),
    createTextNode: (s: string) => ({ nodeType: 3, textContent: String(s) }),
    getElementById: (id: string) => {
      if (!byId.has(id)) byId.set(id, makeNode("div"));
      return byId.get(id);
    },
    register(id: string, node: any) { byId.set(id, node); return node; },
    byId(id: string) { return doc.getElementById(id); },
    querySelectorAll: () => [] as unknown[],
    querySelector: () => null,
    body: makeNode("body"),
    activeElement: null as any,
  };
  return doc;
}

/** Map-backed localStorage stand-in. `throwOn` makes a verb throw, which is how
    the fail-soft storage contracts are exercised. */
export function fakeStorage(
  initial: Record<string, string> = {},
  throwOn: Array<"getItem" | "setItem"> = [],
) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getItem(key: string) {
      if (throwOn.includes("getItem")) throw new Error("storage unavailable");
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      if (throwOn.includes("setItem")) throw new Error("storage unavailable");
      store.set(key, String(value));
    },
    removeItem(key: string) { store.delete(key); },
  };
}

export function withDom<T>(fn: () => T): T {
  (globalThis as any).document = fakeDocument();
  (globalThis as any).CSS = { escape: (s: string) => s };
  try { return fn(); } finally { delete (globalThis as any).document; delete (globalThis as any).CSS; }
}

export function textOf(node: any): string {
  if (!node || typeof node !== "object") return "";
  if (node.nodeType === 3) return String(node.textContent || "");
  let s = typeof node.textContent === "string" ? node.textContent : "";
  for (const kid of node.children || []) s += textOf(kid);
  return s;
}

export function findClass(root: any, className: string): any {
  if (!root) return null;
  if (root.classList?.contains?.(className)) return root;
  for (const kid of root.children || []) {
    const hit = findClass(kid, className);
    if (hit) return hit;
  }
  return null;
}

/** Install a static two-child rail shell and expose TheAntHill. Leaves document installed. */
export async function setupRailDom(): Promise<{ doc: any; M: any }> {
  const doc = fakeDocument();
  (globalThis as any).document = doc;
  (globalThis as any).CSS = { escape: (s: string) => s };

  const lane = makeNode("div");
  lane.className = "health-tldr-lane";
  lane.id = "health-tldr-lane";
  lane.setAttribute("id", "health-tldr-lane");
  doc.register("health-tldr-lane", lane);

  const stack = makeNode("div");
  stack.className = "readings-stack";

  const head = makeNode("div");
  head.className = "stack-head";

  const scan = makeNode("span");
  scan.className = "scan-window";
  scan.setAttribute("id", "scan-window");
  doc.register("scan-window", scan);

  const cleanup = makeNode("span");
  cleanup.className = "visually-hidden";
  cleanup.setAttribute("id", "cleanup-status");
  cleanup.setAttribute("role", "status");
  cleanup.setAttribute("aria-live", "polite");
  doc.register("cleanup-status", cleanup);

  const customize = makeNode("button");
  customize.className = "rail-action";
  customize.setAttribute("id", "customize-summary");
  customize.setAttribute("type", "button");
  doc.register("customize-summary", customize);

  const grid = makeNode("div");
  grid.className = "readings-grid";
  grid.setAttribute("id", "readings-grid");
  doc.register("readings-grid", grid);

  const heading = makeNode("span");
  heading.className = "rail-heading";
  heading.textContent = "Summary";
  head.append(heading, scan, cleanup, customize);
  stack.append(head, grid);

  const widgets = makeNode("div");
  widgets.className = "rail-inner";
  widgets.setAttribute("id", "health-widgets");
  doc.register("health-widgets", widgets);
  widgets.append(lane, stack);

  const rail = makeNode("section");
  rail.className = "health-rail";
  rail.setAttribute("id", "health-rail");
  doc.register("health-rail", rail);
  rail.append(widgets);

  const customizer = makeNode("div");
  customizer.setAttribute("id", "widget-customizer");
  customizer.hidden = true;
  doc.register("widget-customizer", customizer);
  const options = makeNode("div");
  options.setAttribute("id", "widget-options");
  doc.register("widget-options", options);
  customizer.append(options);
  rail.append(customizer);

  /* Masthead disclosure nodes — static in index.html, registered here so the
     collapse/expand contracts can drive the real renderers against the same
     node identities boot() would find. */
  const compact = makeNode("div");
  compact.className = "compact-summary";
  compact.setAttribute("id", "compact-summary");
  compact.setAttribute("role", "group");
  compact.setAttribute("aria-label", "Fleet summary, compact");
  compact.hidden = true;
  doc.register("compact-summary", compact);

  const headerToggle = makeNode("button");
  headerToggle.className = "btn header-summary-toggle";
  headerToggle.setAttribute("id", "header-summary-toggle");
  headerToggle.setAttribute("type", "button");
  headerToggle.setAttribute("aria-controls", "health-rail compact-summary");
  headerToggle.setAttribute("aria-expanded", "true");
  headerToggle.dataset.fkey = "header-summary-toggle";
  headerToggle.textContent = "Collapse header";
  doc.register("header-summary-toggle", headerToggle);

  const notify = makeNode("button");
  notify.setAttribute("id", "notify-toggle");
  const settings = makeNode("button");
  settings.setAttribute("id", "settings-toggle");
  const connection = makeNode("span");
  connection.setAttribute("id", "conn-badge");
  const signals = makeNode("div");
  signals.className = "masthead-signals";
  signals.append(headerToggle, notify, settings, connection);

  // @ts-expect-error browser client has no declaration
  await import("../../src/web/app.js");
  const M = (globalThis as any).TheAntHill;
  M.state.paintSig.widgets = "";
  M.state.snap = null;
  M.state.conn = "live";
  M.state.queueItems = [];
  M.state.queueError = "";
  M.state.widgetCustomizerOpen = false;
  M.state.tldrView = "ALL";
  M.state.cleanup = { running: false, error: "", view: null, at: 0 };
  M.state.cleaner = { sessionId: "", code: "", error: "", launching: false };
  M.state.headerCollapsed = false;
  /* The same wiring boot() performs; conditional so the shell also serves the
     RED phase before the toggle exists. */
  if (typeof M.toggleHeaderCollapsed === "function") {
    headerToggle.addEventListener("click", M.toggleHeaderCollapsed);
  }
  return { doc, M };
}

/** Ordered {label, value} tuples for every reading cell under `container`.
    The calm line is not a cell; read it via findClass(…, "pulse-calm"). */
export function readingTuples(container: any): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (node.classList?.contains?.("reading")) {
      out.push({
        label: textOf(findClass(node, "reading-label")).trim(),
        value: textOf(findClass(node, "reading-value")).trim(),
      });
      return;
    }
    for (const kid of node.children || []) walk(kid);
  };
  walk(container);
  return out;
}

export function snapWithHeartbeat(raw: string | null, agentOver: Record<string, unknown> = {}) {
  if (raw == null) {
    return {
      schemaVersion: 1,
      totals: { live: 0, attention: 0, tracked: 0, working: 0 },
      programs: [{ id: "p1", name: "Home", agents: [] }],
      pulse: { activity: { buckets: [] }, burn: {}, momentum: {} },
    };
  }
  return {
    schemaVersion: 1,
    totals: { live: 8, attention: 1, tracked: 8, working: 6 },
    programs: [{
      id: "p-mountain",
      name: "the-mountain-main",
      agents: [{
        id: "prime:ant-heartbeat-monitor",
        lifecycle: "working",
        transcriptTail: raw,
        updatedAt: new Date().toISOString(),
        ...agentOver,
      }],
    }, {
      id: "p-home",
      name: "Home",
      agents: [],
    }],
    pulse: { activity: { buckets: [] }, burn: {}, momentum: {} },
  };
}

const V4_MOUNTAIN = '[TL;DR 17:33] {"v":4,"fleet":"*the-mountain-main* !needs you! on `main`.","repos":[{"repo":"the-mountain-main","summary":"Drawer agent blocked — answer the question on `main`.","blocker":"question pending","signal":"needs-you"},{"repo":"Home","summary":"Idle after green run.","blocker":"all-clear","signal":"ok"}]}';

export function repoSnapFixture() {
  return {
    schemaVersion: 1,
    scanWindowHours: 36,
    totals: { live: 3, attention: 1, tracked: 3, working: 2 },
    programs: [{
      id: "p-mountain",
      name: "the-mountain-main",
      agents: [
        {
          id: "prime:ant-heartbeat-monitor",
          lifecycle: "working",
          transcriptTail: V4_MOUNTAIN,
          updatedAt: new Date().toISOString(),
        },
        {
          id: "codex:worker-1",
          lifecycle: "working",
          attentionSignal: false,
          outcome: "ok",
          git: { branch: "main", dirty: true, head: "a1b2c3d4e5f6" },
          repo: { branch: "main" },
          pullRequestUrls: ["https://example.com/pr/1"],
          tokens: { provenance: "observed", scope: "latest-turn", total: 20_000, contextWindow: 100_000 },
        },
        {
          id: "codex:blocked-1",
          lifecycle: "waiting",
          attentionSignal: true,
          outcome: "blocked",
          git: { branch: "main", dirty: true, head: "a1b2c3d4e5f6" },
          tokens: { provenance: "observed", scope: "latest-turn", total: 40_000, contextWindow: 100_000 },
        },
      ],
    }, {
      id: "p-home",
      name: "Home",
      agents: [{ id: "codex:home-1", lifecycle: "waiting", outcome: "ok" }],
    }],
    pulse: {
      activity: { buckets: [{ activeSessions: 2 }] },
      burn: { tokensPerMin: 1000, costLastHourUsd: 1.2 },
      momentum: {},
    },
  };
}

export function snapWithoutRepo(repoName: string) {
  const snap: any = repoSnapFixture();
  snap.programs = snap.programs.filter((p: any) => p.name !== repoName);
  const raw = '[TL;DR 17:33] {"v":4,"fleet":"Home is quiet.","repos":[{"repo":"Home","summary":"Idle.","blocker":"all-clear","signal":"ok"}]}';
  for (const p of snap.programs) {
    for (const a of p.agents || []) {
      if (a.id === "prime:ant-heartbeat-monitor") a.transcriptTail = raw;
    }
  }
  // Ensure a heartbeat agent still exists on remaining programs
  if (!snap.programs.some((p: any) => (p.agents || []).some((a: any) => a.id === "prime:ant-heartbeat-monitor"))) {
    const host = snap.programs[0];
    if (host) {
      host.agents = host.agents || [];
      host.agents.unshift({
        id: "prime:ant-heartbeat-monitor",
        lifecycle: "working",
        transcriptTail: raw,
        updatedAt: new Date().toISOString(),
      });
    }
  }
  return snap;
}

export function readingCell(stack: any, label: string): any {
  for (const node of stack?.children || []) {
    const hit = walkReading(node, label);
    if (hit) return hit;
  }
  return null;
}

function walkReading(node: any, label: string): any {
  if (!node) return null;
  if (node.classList?.contains?.("reading") || String(node.className || "").includes("reading")) {
    if (textOf(node).includes(label)) return node;
  }
  for (const kid of node.children || []) {
    const hit = walkReading(kid, label);
    if (hit) return hit;
  }
  return null;
}

export function v4Envelope(fleet = "*the-mountain-main* !needs you!.", repos = [
  { repo: "the-mountain-main", summary: "s", blocker: "question pending", signal: "needs-you" },
]): string {
  return `[TL;DR 17:33] ${JSON.stringify({ v: 4, fleet, repos })}`;
}

export function twoRepoSnapFixture(signals: Record<string, string> = {}) {
  const repoA = signals.repoA || "ok";
  const repoB = signals.repoB || "ok";
  const raw = v4Envelope("Two repos.", [
    { repo: "repoA", summary: "A summary", blocker: "all-clear", signal: repoA },
    { repo: "repoB", summary: "B summary", blocker: "all-clear", signal: repoB },
  ]);
  return {
    schemaVersion: 1,
    totals: { live: 2, attention: repoA === "needs-you" || repoB === "needs-you" ? 1 : 0, tracked: 2, working: 2 },
    programs: [
      { id: "p-a", name: "repoA", agents: [{ id: "prime:ant-heartbeat-monitor", lifecycle: "working", transcriptTail: raw, updatedAt: new Date().toISOString() }] },
      { id: "p-b", name: "repoB", agents: [{ id: "codex:b", lifecycle: "working" }] },
    ],
    pulse: { activity: { buckets: [] }, burn: {}, momentum: {} },
  };
}

export function findChip(doc: any, repoName: string): any {
  const lane = doc.byId("health-tldr-lane");
  const walk = (node: any): any => {
    if (!node) return null;
    if (node.classList?.contains?.("tldr-chip") && textOf(node).includes(repoName) && !node.classList.contains("is-more")) {
      return node;
    }
    for (const kid of node.children || []) {
      const hit = walk(kid);
      if (hit) return hit;
    }
    return null;
  };
  return walk(lane);
}

export function fireClick(node: any) {
  if (!node) throw new Error("fireClick: missing node");
  const fns = node.listeners?.click || [];
  for (const fn of fns) fn({ preventDefault() {}, currentTarget: node, target: node });
}

export function mixSnapFixture() {
  const agents = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: `claude:${i}`, provider: "claude", model: "claude-opus-5", lifecycle: "working" })),
    { id: "codex:1", provider: "codex", model: "gpt-5-codex", lifecycle: "working" },
    { id: "codex:2", provider: "codex", model: "gpt-5-codex", lifecycle: "waiting" },
    { id: "cursor:1", provider: "cursor", model: "composer-2", lifecycle: "working" },
  ];
  return {
    schemaVersion: 1,
    totals: { live: agents.length, attention: 0, tracked: agents.length, working: 8 },
    programs: [{ id: "p1", name: "Home", agents }],
    pulse: { activity: { buckets: [] }, burn: {}, momentum: {} },
  };
}

export function burnSnapFixture(burnOver: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    totals: { live: 1, attention: 0, tracked: 1, working: 1 },
    programs: [{ id: "p1", name: "Home", agents: [{ id: "codex:1", provider: "codex", lifecycle: "working" }] }],
    pulse: {
      activity: { buckets: [] },
      momentum: {},
      burn: {
        tokensPerMin: 1000,
        costLastHourUsd: 18.4,
        costIsFloor: true,
        costProvenance: "partial",
        costAsOf: new Date().toISOString(),
        ...burnOver,
      },
    },
  };
}
