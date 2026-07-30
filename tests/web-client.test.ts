import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* app.js guards all DOM wiring behind a `typeof document` check and exposes its
   pure helpers on globalThis.TheAntHill, so importing it under Bun is safe. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let M: any;
let source = "";
let html = "";
let styles = "";

beforeAll(async () => {
  // @ts-expect-error The dependency-free browser client intentionally has no declaration file.
  await import("../src/web/app.js");
  M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
  source = readFileSync(join(import.meta.dir, "../src/web/app.js"), "utf8");
  html = readFileSync(join(import.meta.dir, "../src/web/index.html"), "utf8");
  styles = readFileSync(join(import.meta.dir, "../src/web/styles.css"), "utf8");
});

function agent(overrides: Record<string, unknown> = {}) {
  return {
    id: "codex:a1",
    provider: "codex",
    sourceSessionId: "a1",
    displayName: "Ridge worker",
    programId: "p1",
    status: "running",
    statusReason: "Streaming output.",
    updatedAt: "2026-07-22T03:00:00.000Z",
    tokens: { provenance: "observed", total: 1200 },
    artifacts: [],
    gates: [],
    target: { resolution: "exact", surfaceId: "s1", workspaceId: "w1" },
    controls: [],
    ...overrides,
  };
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-22T03:00:00.000Z",
    controlHealth: { cmuxReachable: true, lastCheckedAt: "", errors: [], staleSources: [] },
    totals: {
      live: 1, tracked: 1, attention: 0, working: 1, idle: 0, history: 0,
      sourceHealth: { healthy: 2, degraded: 0, total: 2 },
    },
    programs: [{ id: "p", name: "P", agents: [agent()] }],
    ...overrides,
  };
}

/* ---------------------------------------------------------------------------
   FE-B shared render harness.

   The client guards all DOM wiring behind `typeof document`, so a minimal fake
   document lets its real render functions build real nodes through el()/icon().
   Tests can then assert on what a surface RENDERS instead of on the source text
   that builds it. The node is a linked list (firstChild/nextSibling/insertBefore/
   remove) because the keyed row reconciler manipulates siblings directly.
   ------------------------------------------------------------------------- */
export interface FakeNode {
  nodeType: number;
  tagName: string;
  className: string;
  textContent: string;
  hidden?: boolean;
  id?: string;
  dataset: Record<string, string>;
  attributes: Record<string, string>;
  classList: { add(...c: string[]): void; remove(...c: string[]): void; toggle(c: string, on?: boolean): void; contains(c: string): boolean };
  children: FakeNode[];
  parent: FakeNode | null;
  value?: unknown;
  readonly firstChild: FakeNode | null;
  readonly nextSibling: FakeNode | null;
  setAttribute(k: string, v: unknown): void;
  hasAttribute(k: string): boolean;
  // el() wires every handler through addEventListener, so the harness has to
  // record them or no test can click anything the client builds.
  listeners: Record<string, Array<(event: unknown) => unknown>>;
  addEventListener(type: string, fn: (event: unknown) => unknown): void;
  append(...kids: unknown[]): void;
  insertBefore(node: FakeNode, ref: FakeNode | null): void;
  remove(): void;
}

function makeNode(tag: string): FakeNode {
  const classes = new Set<string>();
  const node = {
    nodeType: 1,
    tagName: tag,
    textContent: "",
    dataset: {} as Record<string, string>,
    attributes: {} as Record<string, string>,
    children: [] as FakeNode[],
    parent: null as FakeNode | null,
    get className() { return [...classes].join(" "); },
    set className(v: string) {
      classes.clear();
      for (const c of String(v).split(/\s+/)) if (c) classes.add(c);
    },
    classList: {
      add(...c: string[]) { for (const x of c) if (x) classes.add(x); },
      remove(...c: string[]) { for (const x of c) classes.delete(x); },
      toggle(c: string, on?: boolean) { if (on === undefined ? classes.has(c) : !on) classes.delete(c); else classes.add(c); },
      contains(c: string) { return classes.has(c); },
    },
    // Render code asks for childNodes/childElementCount to decide whether a
    // panel is empty; both are the same array in this DOM-less stand-in.
    get childNodes(): FakeNode[] { return node.children; },
    get childElementCount(): number { return node.children.length; },
    get firstChild(): FakeNode | null { return node.children[0] || null; },
    get nextSibling(): FakeNode | null {
      if (!node.parent) return null;
      const i = node.parent.children.indexOf(node as unknown as FakeNode);
      return (i >= 0 && node.parent.children[i + 1]) || null;
    },
    setAttribute(k: string, v: unknown) { node.attributes[k] = String(v); },
    hasAttribute(k: string) { return k in node.attributes; },
    listeners: {} as Record<string, Array<(event: unknown) => unknown>>,
    addEventListener(type: string, fn: (event: unknown) => unknown) {
      (node.listeners[type] ??= []).push(fn);
    },
    append(...kids: unknown[]) {
      for (const kid of kids) {
        if (kid == null) continue;
        node.children.push(kid as FakeNode);
        if (typeof kid === "object" && kid !== null && "parent" in (kid as FakeNode)) (kid as FakeNode).parent = node as unknown as FakeNode;
      }
    },
    insertBefore(child: FakeNode, ref: FakeNode | null) {
      if (child.parent) {
        const at = child.parent.children.indexOf(child);
        if (at >= 0) child.parent.children.splice(at, 1);
      }
      child.parent = node as unknown as FakeNode;
      const i = ref ? node.children.indexOf(ref) : -1;
      if (i === -1) node.children.push(child);
      else node.children.splice(i, 0, child);
    },
    remove() {
      if (!node.parent) return;
      const at = node.parent.children.indexOf(node as unknown as FakeNode);
      if (at >= 0) node.parent.children.splice(at, 1);
      node.parent = null;
    },
  };
  return node as unknown as FakeNode;
}

const domById = new Map<string, FakeNode>();
function fakeDocument() {
  domById.clear();
  return {
    createElement: (t: string) => makeNode(t),
    createElementNS: (_ns: string, t: string) => makeNode(t),
    createTextNode: (s: string) => ({ nodeType: 3, textContent: String(s) }),
    getElementById: (id: string) => {
      if (!domById.has(id)) domById.set(id, makeNode("div"));
      return domById.get(id) as FakeNode;
    },
    querySelectorAll: () => [] as unknown[],
    querySelector: () => null,
  };
}

function withDom<T>(fn: () => T): T {
  (globalThis as unknown as { document: unknown }).document = fakeDocument();
  try { return fn(); } finally {
    delete (globalThis as unknown as { document?: unknown }).document;
  }
}

function newNode(tag = "div"): FakeNode {
  return makeNode(tag);
}

/* ---------------------------------------------------------------------------
   W4-B request harness.

   The client's request and confirmation logic was private, so the tests that
   covered it asserted that substrings appear in the raw text of app.js. Those
   tests gate the deploy and cannot fail when the behaviour breaks: sendControl
   could stop requiring confirmation, or start treating HTTP 200 as success, and
   every one of them would still pass.

   app.js now exports the request functions and the module state they mutate.
   This drives them for real against a fake `fetch` and the fake document, so
   the assertions are about what the client SENDS and what it then BELIEVES.
   ------------------------------------------------------------------------- */
export interface FakeCall { url: string; method: string; body: any }
type FakeReply = { status?: number; json?: unknown } | Error;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const G = globalThis as any;

async function withRequests<T>(replies: FakeReply[], fn: (calls: FakeCall[]) => Promise<T> | T): Promise<T> {
  const calls: FakeCall[] = [];
  const realFetch = G.fetch;
  const realDoc = G.document;
  const realCss = G.CSS;
  const document = fakeDocument() as Record<string, unknown>;
  // render() toggles a class on document.body and restores focus through
  // CSS.escape; neither exists in Bun, and both are on the real paint path.
  document.body = makeNode("body");
  G.document = document;
  G.CSS = realCss ?? { escape: (s: string) => s };
  let index = 0;
  G.fetch = async (url: string, init: Record<string, any> = {}) => {
    const reply = replies[Math.min(index, replies.length - 1)] ?? { status: 200, json: { ok: true } };
    index += 1;
    calls.push({
      url: String(url),
      method: String(init.method || "GET").toUpperCase(),
      body: typeof init.body === "string" ? JSON.parse(init.body) : null,
    });
    if (reply instanceof Error) throw reply;
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (!("json" in reply)) throw new Error("response is not JSON");
        return reply.json;
      },
    };
  };
  try {
    return await fn(calls);
  } finally {
    G.fetch = realFetch;
    if (realDoc === undefined) delete G.document; else G.document = realDoc;
    if (realCss === undefined) delete G.CSS; else G.CSS = realCss;
  }
}

/* The seam exports the REAL module state, so every test that writes it puts
   back exactly what it found. Paint signatures are reset too: the guards early-
   return on an unchanged signature, so a leftover one would silently skip the
   very paint under test. */
async function withState<T>(patch: Record<string, unknown>, fn: () => Promise<T> | T): Promise<T> {
  const full = {
    paintSig: { programs: "", inspector: "", widgets: "", broadcast: "", alarm: null, actions: null },
    ...patch,
  };
  const keys = Object.keys(full);
  const saved = Object.fromEntries(keys.map((key) => [key, M.state[key]]));
  Object.assign(M.state, full);
  try {
    return await fn();
  } finally {
    Object.assign(M.state, saved);
  }
}

function requiredSlice(haystack: string, pattern: RegExp, label: string): string {
  const match = haystack.match(pattern)?.[0];
  if (!match) throw new Error(`Required ${label} source slice no longer matches`);
  return match;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function textOf(node: any): string {
  if (!node || typeof node !== "object") return "";
  if (node.nodeType === 3) return String(node.textContent || "");
  let s = typeof node.textContent === "string" ? node.textContent : "";
  for (const kid of node.children || []) s += textOf(kid);
  return s;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findAll(node: any, pred: (n: any) => boolean, out: any[] = []): any[] {
  if (!node || typeof node !== "object") return out;
  if (pred(node)) out.push(node);
  for (const kid of node.children || []) findAll(kid, pred, out);
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const buttonsOf = (node: any) => findAll(node, (n) => n.tagName === "button");

/* Fire a recorded handler. Returns whatever the handler returns, so an async
   click can be awaited — the request functions are all async. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fire(node: any, type = "click", event: Record<string, unknown> = {}): Promise<void> {
  const handlers = (node && node.listeners && node.listeners[type]) || [];
  if (!handlers.length) throw new Error(`no ${type} handler on <${node && node.tagName}>`);
  for (const handler of handlers) await handler({ preventDefault() {}, stopPropagation() {}, ...event });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const byFkey = (node: any, key: string) =>
  findAll(node, (n) => n.dataset && n.dataset.fkey === key)[0] || null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const allByClass = (node: any, token: string) =>
  findAll(node, (n) => typeof n.className === "string" && n.className.split(/\s+/).includes(token));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const byClass = (node: any, token: string) => allByClass(node, token)[0] || null;

/* A stand-in for the module's `state`, for helpers that take it as an argument. */
function identityUi(overrides: Record<string, unknown> = {}) {
  return {
    snap: null,
    queueItems: [] as unknown[],
    triage: new Map(),
    triagePending: new Set<string>(),
    evidenceOpen: false,
    pending: new Set<string>(),
    feedback: new Map(),
    drafts: new Map(),
    confirming: null,
    renaming: null,
    renameDraft: "",
    renamePending: false,
    renameError: "",
    labelsLoading: false,
    labelLoadError: "",
    labels: new Map<string, string>(),
    identity: { agentId: null, loading: false, error: "", data: null },
    ...overrides,
  };
}

/* A `state` stand-in for renderTriage. */
function triageUi(overrides: Record<string, unknown> = {}) {
  return {
    queueItems: [] as unknown[],
    triage: new Map(),
    triagePending: new Set<string>(),
    triageErrors: new Map(),
    ...overrides,
  };
}

/* A `state` stand-in for the list helpers (row/shell signatures, row plans). */
function listUi(overrides: Record<string, unknown> = {}) {
  return {
    snap: null,
    view: "now",
    query: "",
    facetProgram: "",
    facetProvider: "",
    lookbackHours: 24,
    contextDisplay: "percent",
    selecting: false,
    selection: new Set<string>(),
    selected: null,
    selectedId: null,
    programOverrides: new Map<string, string>(),
    labels: new Map<string, string>(),
    renaming: null,
    renameDraft: "",
    renamePending: false,
    renameError: "",
    ...overrides,
  };
}

/* The three drawer panels, rendered and flattened to text. */
function panelTexts(a: Record<string, unknown>) {
  return withDom(() => ({
    operate: textOf(M.renderOperate(a, { id: "p", name: "P", agents: [] })),
    chat: textOf(M.renderChat(a)),
    evidence: textOf(M.renderEvidence(a)),
  }));
}

describe("summary status and widgets", () => {
  test("maps live connection, source, and control evidence to one system verdict", () => {
    const healthy = snapshot();
    expect(M.systemStatus(healthy, "live").label).toBe("Operational");
    expect(M.systemStatus(snapshot({ totals: { ...healthy.totals, sourceHealth: { healthy: 1, degraded: 1, total: 2 } } }), "live").label).toBe("Degraded");
    expect(M.systemStatus(snapshot({ controlHealth: { ...healthy.controlHealth, cmuxReachable: false } }), "live").label).toBe("Degraded");
    expect(M.systemStatus(healthy, "stale").label).toBe("Degraded");
    expect(M.systemStatus(null, "offline").label).toBe("Offline");
  });

  /* F3: "Degraded" said something is wrong and never the question an operator
     actually has — am I blocked, or is this cosmetic? cmux unreachable (Focus
     and Send dead) and 15 tidy-up warnings both rendered the same word. */
  test("a Degraded verdict says whether the operator is blocked or merely informed", () => {
    const healthy = snapshot();
    expect(M.degradedSeverity(healthy, "live", false)).toBeNull(); // Operational is untouched

    // Blocking: the control plane is gone, so no operator action can route.
    const noCmux = snapshot({ controlHealth: { ...healthy.controlHealth, cmuxReachable: false } });
    expect(M.degradedSeverity(noCmux, "live", false)).toMatchObject({ key: "blocking", label: "Blocking" });
    expect(M.degradedSeverity(noCmux, "live", false).detail).toContain("Focus and Send");
    expect(M.degradedSeverity(null, "offline", false)).toMatchObject({ key: "blocking" });

    // Stale: controls work, but the numbers may have moved on. Distinct from
    // blocking, because the fix is a refresh rather than repairing the plane.
    expect(M.degradedSeverity(healthy, "stale", false)).toMatchObject({ key: "stale" });
    expect(M.degradedSeverity(healthy, "live", true)).toMatchObject({ key: "stale" });
    expect(M.degradedSeverity(healthy, "live", true).detail).toContain("previous good snapshot");

    // Advisory: the live case — cmux reachable, everything usable, evidence
    // just needs tidying. This must NOT read as blocking.
    const noisy = snapshot({ controlHealth: { ...healthy.controlHealth, errors: ["conflicting session files"] } });
    const advisory = M.degradedSeverity(noisy, "live", false);
    expect(advisory).toMatchObject({ key: "advisory", label: "Advisory" });
    expect(advisory.detail).toContain("usable");

    // Severity outranks reason: a blocked board says so even when the loudest
    // finding is a mere warning, which is the case that misled operators.
    const blockedAndNoisy = snapshot({
      controlHealth: { ...healthy.controlHealth, cmuxReachable: false, errors: ["conflicting session files"] },
    });
    expect(M.degradedSeverity(blockedAndNoisy, "live", false).key).toBe("blocking");
  });

  /* F2: the BURN card read "cost unavailable" because the cost source returns
     null, and that is the correct render of an unknown — but nothing pinned it
     down. The failure worth guarding is not the missing number, it is a missing
     number quietly becoming $0.00: a fleet that looks free is worse than one
     that admits it does not know. */
  test("BURN shows a dollar figure when cost is reported and never invents $0.00", () => {
    const burnSnap = (burn: Record<string, unknown>) => snapshot({
      pulse: { burn: { tokensPerMin: 840, windowMs: 600_000, coverage: { reporting: 7, eligible: 7 }, ...burn } },
    });

    const priced = M.summaryWidgetData("burn", burnSnap({ costLastHourUsd: 12.5 }), "live", "percent", [], false);
    expect(priced.sublabel).toContain("$12.50 last hour");
    expect(priced.value).toBe("840");

    // Unknown cost states its ignorance and never renders as free.
    const unknown = M.summaryWidgetData("burn", burnSnap({ costLastHourUsd: null }), "live", "percent", [], false);
    expect(unknown.sublabel).toContain("cost unavailable");
    expect(unknown.sublabel).not.toContain("$");

    // A real zero is a real number and must survive as one.
    const free = M.summaryWidgetData("burn", burnSnap({ costLastHourUsd: 0 }), "live", "percent", [], false);
    expect(free.sublabel).toContain("$0.00 last hour");
    expect(free.sublabel).not.toContain("unavailable");

    // Token throughput is independent of cost: no price must not blank the rate.
    expect(unknown.value).toBe("840");
    expect(unknown.tone).toBe("ok");
  });

  /* Claude transcripts report observed totals with no context-window size, so a
     truthful percentage is impossible for them. Showing the absolute count is
     the honest answer; a fabricated denominator would misreport a 1M-context
     session by roughly 5x. 45 of 139 agents on the live board are in this state. */
  test("CTX falls back to an absolute count rather than inventing a denominator", () => {
    const noWindow = { provenance: "observed", scope: "latest-turn", total: 47_432 };
    expect(M.contextDisplayValue(noWindow, "percent")).toBe("47k tokens");
    expect(M.contextDisplayValue(noWindow, "percent")).not.toContain("%");
    expect(M.contextUsage(noWindow)).toBeNull();

    // And the moment the backend does report a window, the percentage appears
    // with no client change — this is the contract between the two lanes.
    expect(M.contextDisplayValue({ ...noWindow, contextWindow: 258_400 }, "percent")).toBe("18%");
  });

  test("keeps the 5-widget Pulse catalog, needs-you pin, and persisted order valid", () => {
    expect(M.DEFAULT_WIDGET_IDS).toEqual(["needs-you", "momentum", "burn", "context-peak", "health"]);
    expect(M.WIDGET_CATALOG.map((widget: { id: string }) => widget.id)).toEqual([
      "needs-you", "momentum", "burn", "context-peak", "health",
    ]);
    expect(M.WIDGET_STORAGE_KEY).toBe("mtn3-summary-widgets");
    expect(M.parseWidgetPreference(JSON.stringify(["needs-you", "burn", "health"]))).toEqual(["needs-you", "burn", "health"]);
    expect(M.parseWidgetPreference("not-json")).toEqual(M.DEFAULT_WIDGET_IDS);
    // Old "system"-first stored preferences (and any preference not pinned on
    // needs-you) fall through the existing fallback-to-defaults path — the
    // retired ids are simply unknown to the new catalog, no bespoke migration.
    expect(M.normalizeWidgetIds(["system", "attention", "context-peak"])).toEqual(M.DEFAULT_WIDGET_IDS);
    expect(M.normalizeWidgetIds(["burn", "needs-you"])).toEqual(M.DEFAULT_WIDGET_IDS);
    expect(M.normalizeWidgetIds(["needs-you", "burn", "burn"])).toEqual(M.DEFAULT_WIDGET_IDS);
  });

  test("reorders selectable widgets while keeping the needs-you verdict pinned first", () => {
    const defaults = M.DEFAULT_WIDGET_IDS;
    expect(M.reorderWidgetIds(defaults, "momentum", -1)).toEqual(defaults); // already the first movable slot
    expect(M.reorderWidgetIds(defaults, "burn", -1)).toEqual([
      "needs-you", "burn", "momentum", "context-peak", "health",
    ]);
    expect(M.reorderWidgetIds(defaults, "needs-you", 1)).toEqual(defaults); // the pin never moves
    expect(M.reorderWidgetIds(["needs-you", "momentum", "health"], "health", -1)).toEqual([
      "needs-you", "health", "momentum",
    ]);
  });

  test("needs-you counts active interventions and advisories once, with a top-2 title sublabel", () => {
    const snap = snapshot({
      issues: [
        { id: "system:1", kind: "system", severity: "error", title: "Control failure", summary: "s", affectedAgentIds: [] },
        { id: "system:2", kind: "system", severity: "warning", title: "Stale source", summary: "s", affectedAgentIds: [] },
      ],
    });
    expect(M.attentionSummary(snap)).toEqual({ count: 2, interventions: 1, advisories: 1 });
    const data = M.summaryWidgetData("needs-you", snap);
    expect(data).toMatchObject({ value: "2", unit: "findings", tone: "hot" });
    expect(data.sublabel).toBe("Control failure · Stale source");
  });

  test("uses explicit No data values when optional pulse/context evidence is absent", () => {
    const snap = snapshot();
    for (const id of ["context-peak", "burn"]) {
      expect(M.summaryWidgetData(id, snap).value, id).toBe("No data");
      expect(M.summaryWidgetData(id, snap).sublabel, id).toBeTruthy();
    }
    expect(M.summaryWidgetData("momentum", null).value).toBe("No data");
    expect(M.summaryWidgetData("health", null, "offline").value).toBe("Offline");
  });

  test("momentum copy stays window-honest and never fabricates a zero-window readout", () => {
    const withMomentum = (momentum: Record<string, unknown>) => snapshot({ pulse: { momentum } });
    // No pulse at all (older server) degrades gracefully.
    expect(M.summaryWidgetData("momentum", snapshot()).sublabel).toBe("No completion data yet.");
    // Under one completed 5-min bucket there is no completion window to report,
    // but stall detection (updatedAt-based) is valid immediately.
    expect(M.summaryWidgetData("momentum", withMomentum({ completionsLastHour: 0, observedWindowMs: 0, stalled: 0 })).sublabel)
      .toBe("No completion data yet.");
    expect(M.summaryWidgetData("momentum", withMomentum({ completionsLastHour: 0, observedWindowMs: 0, stalled: 2 })).sublabel)
      .toBe("2 quiet 15m+");
    // A young tracker reports its real window, never a fabricated "this hour".
    expect(M.summaryWidgetData("momentum", withMomentum({ completionsLastHour: 3, observedWindowMs: 20 * 60_000, stalled: 1 })).sublabel)
      .toBe("↑3 done in 20m observed · 1 quiet 15m+");
    expect(M.summaryWidgetData("momentum", withMomentum({ completionsLastHour: 3, observedWindowMs: 3_600_000, stalled: 0 })).sublabel)
      .toBe("↑3 done this hour");
  });
});

describe("state derivations fall back from provider-native status", () => {
  test("legacy statuses map to the provider-neutral language", () => {
    expect(M.deriveActivity(agent({ status: "running" }))).toBe("working");
    expect(M.deriveActivity(agent({ status: "waiting" }))).toBe("idle");
    expect(M.deriveActivity(agent({ status: "attention" }))).toBe("idle");
    expect(M.deriveActivity(agent({ status: "stale" }))).toBe("ended");
    expect(M.deriveActivity(agent({ status: "archived" }))).toBe("ended");
  });

  test("a completed Cursor turn (waiting) is Idle/Healthy, not a warning", () => {
    const cursorDone = agent({ provider: "cursor", status: "waiting" });
    expect(M.deriveActivity(cursorDone)).toBe("idle");
    expect(M.deriveOutcome(cursorDone)).toBe("healthy");
  });

  test("attention maps to needs-you; ended sessions stop being outcome problems", () => {
    expect(M.deriveOutcome(agent({ status: "attention" }))).toBe("needs-you");
    expect(M.deriveOutcome(agent({ status: "archived" }))).toBe("healthy");
  });

  test("backend-provided fields always win over the fallback", () => {
    const a = agent({ status: "waiting", activity: "working", outcome: "blocked", controlState: "quarantined" });
    expect(M.deriveActivity(a)).toBe("working");
    expect(M.deriveOutcome(a)).toBe("blocked");
    expect(M.deriveControlState(a)).toBe("quarantined");
  });

  test("control state derives from routing evidence when absent", () => {
    expect(M.deriveControlState(agent())).toBe("linked");
    expect(M.deriveControlState(agent({ target: { resolution: "ambiguous" } }))).toBe("quarantined");
    expect(M.deriveControlState(agent({ target: { resolution: "missing" } }))).toBe("observed-only");
    expect(M.deriveControlState(agent({ status: "archived" }))).toBe("observed-only");
  });
});

describe("provider-aware row summaries", () => {
  test("uses the sanitized snapshot field and never falls back to technical transcript text", () => {
    const value = agent({
      lastHumanMessage: "Readable review result.",
      transcriptTail: "diff --git a/src/server/identity.ts b/src/server/identity.ts",
      statusReason: "Tool result: /Users/me/the-mountain/src/server/identity.ts",
    });

    expect(M.rowSummary(value)).toBe("Readable review result.");
    expect(M.rowSummary(value)).not.toContain("diff --git");
    expect(M.rowSummary(value)).not.toContain("identity.ts");
  });

  test("renders explicit absence instead of inventing a message from the transcript", () => {
    expect(M.formatLastHumanMessage(agent({ lastHumanMessage: null, transcriptTail: "tool output" })))
      .toBe("No readable message yet");
    expect(M.formatLastHumanMessage(agent())).toBe("No readable message yet");
  });

  /* FE-B: this used to extract the three panels by matching source text between
     landmark function names, which pinned file ordering rather than behavior.
     It now renders the panels and reads what they actually show. */
  test("keeps the raw transcript tail in Chat/Evidence, not Operate", () => {
    const TAIL = "RAW-TOOL-DUMP-9f2c";
    const rich = agent({
      lastHumanMessage: "ship the fix",
      lastAgentMessage: "pushed the branch",
      transcriptTail: TAIL,
    });
    const panels = panelTexts(rich);
    // Bookshelf seam: Chat shows readable You/Agent turns only — the raw
    // transcript tail is Evidence-only machinery behind the disclosure.
    expect(panels.operate).not.toContain(TAIL);
    expect(panels.chat).toContain("pushed the branch");
    expect(panels.chat).not.toContain(TAIL);
    expect(panels.evidence).toContain(TAIL);
  });
});

describe("views split Now from History", () => {
  test("Now is active work only; Idle and History remain explicit views", () => {
    const live = agent({ status: "running" });
    const idle = agent({ status: "waiting" });
    const done = agent({ status: "archived" });
    expect(M.viewMatches("now", live)).toBe(true);
    expect(M.viewMatches("now", idle)).toBe(false);
    expect(M.viewMatches("now", agent({ status: "waiting", outcome: "needs-you" }))).toBe(true);
    expect(M.viewMatches("now", done)).toBe(false);
    expect(M.viewMatches("history", live)).toBe(false);
    expect(M.viewMatches("history", done)).toBe(true);
  });

  /* Regression: an alert outranks the activity clock. A live snapshot carried
     two agents reading activity "ended" (transcript stopped) whose process was
     still `running` and whose status was "attention" — waiting on a human. The
     old `act !== "ended"` gate hid them from Now AND from Alerts, so a session
     needing a human appeared in no default view. Now must key off the alert. */
  test("Now keeps an alerted agent even when its activity reads ended", () => {
    const strandedButAlerting = agent({
      status: "attention",
      activity: "ended",
      outcome: "needs-you",
      processState: "running",
    });
    expect(M.viewMatches("now", strandedButAlerting)).toBe(true);

    // The guard that makes this safe: an ended agent with nothing wrong stays
    // in History, so Now cannot silt up with the 100+ finished sessions.
    const endedAndFine = agent({ status: "archived", activity: "ended", outcome: "healthy" });
    expect(M.viewMatches("now", endedAndFine)).toBe(false);
    expect(M.viewMatches("history", endedAndFine)).toBe(true);
  });

  /* alerting() is the one verdict behind Now, Alerts, the program expander and
     the notifier. It has to answer two opposite failures at once: a session that
     stopped transcribing while its process runs on IS waiting on a human, and a
     long-archived session's last verdict is NOT. Liveness evidence is what tells
     them apart — which is why this is gated on processState rather than on the
     outcome alone. */
  test("alerting() frees a live-but-silent session without resurrecting archived ones", () => {
    // The live-snapshot case: transcript stopped, process still running.
    expect(M.alerting(agent({
      status: "attention", activity: "ended", outcome: "needs-you", processState: "running",
    }))).toBe(true);

    // The guard. Same outcome, no evidence the process survives — this is a
    // stale verdict on a finished session and must stay in History.
    expect(M.alerting(agent({ status: "archived", activity: "ended", outcome: "needs-you" }))).toBe(false);
    expect(M.alerting(agent({
      status: "archived", activity: "ended", outcome: "failed", processState: "unknown",
    }))).toBe(false);
    expect(M.alerting(agent({
      status: "archived", activity: "ended", outcome: "failed", processState: "died",
    }))).toBe(false);

    // Live sessions never needed liveness evidence to alert.
    expect(M.alerting(agent({ status: "attention", outcome: "needs-you" }))).toBe(true);
    expect(M.alerting(agent({ status: "running", outcome: "healthy" }))).toBe(false);

    // And the views inherit it rather than restating it — the disagreement
    // between Now and Alerts is what let these agents hide in the first place.
    const revived = agent({ status: "attention", activity: "ended", outcome: "needs-you", processState: "running" });
    expect(M.viewMatches("now", revived)).toBe(true);
    expect(M.viewMatches("needs-you", revived)).toBe(true);
  });

  test("Needs you contains only live unhealthy sessions", () => {
    expect(M.viewMatches("needs-you", agent({ status: "attention" }))).toBe(true);
    expect(M.viewMatches("needs-you", agent({ status: "running" }))).toBe(false);
    expect(M.viewMatches("needs-you", agent({ status: "archived", outcome: "failed" }))).toBe(false);
    expect(M.viewMatches("working", agent({ status: "running" }))).toBe(true);
    expect(M.viewMatches("idle", agent({ status: "waiting" }))).toBe(true);
  });

  test("lookback filters by updatedAt age and defaults to 6h", () => {
    expect(M.DEFAULT_LOOKBACK_HOURS).toBe(6);
    expect(M.parseLookbackHours("all")).toBeNull();
    expect(M.parseLookbackHours("12")).toBe(12);
    const now = Date.parse("2026-07-22T12:00:00.000Z");
    const fresh = agent({ updatedAt: "2026-07-22T10:00:00.000Z" });
    const stale = agent({ updatedAt: "2026-07-21T12:00:00.000Z" });
    expect(M.withinLookback(fresh, 6, now)).toBe(true);
    expect(M.withinLookback(stale, 6, now)).toBe(false);
    expect(M.withinLookback(stale, null, now)).toBe(true);
    expect(M.lookbackApplies("history")).toBe(true);
    expect(M.lookbackApplies("now")).toBe(false);
  });
});

describe("program rollups", () => {
  test("server rollup is used verbatim when present", () => {
    const rollup = { total: 9, live: 3, working: 2, idle: 1, ended: 6, needsYou: 1, blocked: 0, failed: 0, linked: 2 };
    expect(M.programRollup({ id: "p", name: "P", agents: [], rollup })).toBe(rollup);
  });

  test("fallback rollup counts derived states", () => {
    const agents = [
      agent({ id: "1", status: "running" }),
      agent({ id: "2", status: "attention", target: { resolution: "missing" } }),
      agent({ id: "3", status: "archived" }),
    ];
    const r = M.deriveRollup(agents);
    expect(r).toMatchObject({ total: 3, live: 2, working: 1, idle: 1, ended: 1, needsYou: 1, linked: 1 });
  });
});

describe("swarm clusters", () => {
  test("children group under their orchestrator; orphans stay at top level", () => {
    const parent = agent({ id: "codex:p" });
    const child = agent({ id: "codex:c", parentAgentId: "codex:p" });
    const orphan = agent({ id: "codex:o", parentAgentId: "codex:gone" });
    const { roots, children } = M.buildClusters([parent, child, orphan]);
    expect(roots.map((a: { id: string }) => a.id)).toEqual(["codex:p", "codex:o"]);
    expect(children.get("codex:p").map((a: { id: string }) => a.id)).toEqual(["codex:c"]);
  });
});

describe("token honesty", () => {
  test("unavailable Cursor usage renders as not reported, never invented", () => {
    const s = M.tokenSummary({ provenance: "unknown" });
    expect(s.known).toBe(false);
    expect(s.text).toBe("not reported");
    expect(s.title).toContain("unknown");
  });

  test("observed and estimated totals are formatted and marked", () => {
    expect(M.tokenSummary({ provenance: "observed", total: 1_500_000 }).text).toBe("1.5M tokens");
    expect(M.tokenSummary({ provenance: "estimated", total: 2000 }).text).toBe("≈2k tokens");
  });

  test("totals expose reporting coverage instead of inventing numbers", () => {
    const t = M.totalsOf({
      programs: [],
      totals: { live: 5, tracked: 10, attention: 0, tokenReporting: 3, tokenEligible: 5 },
    });
    expect(t.tokenReporting).toBe(3);
    expect(t.tokenEligible).toBe(5);
    expect(t.tokens).toBeUndefined();
  });
});

describe("latest-turn token semantics", () => {
  test("latest-turn usage is labeled as the latest call, not session usage", () => {
    const s = M.tokenSummary({ provenance: "observed", scope: "latest-turn", total: 42_000, input: 40_000, output: 2000 });
    expect(s.label).toBe("latest call");
    expect(s.text).toBe("42k tokens");
    expect(s.title).toContain("latest model call");
  });

  test("legacy tokens without a scope keep the neutral label", () => {
    expect(M.tokenSummary({ provenance: "observed", total: 1200 }).label).toBe("tokens");
    expect(M.tokenSummary(undefined).label).toBe("tokens");
  });

  test("context usage reports capacity honestly and only when available", () => {
    const ctx = M.contextUsage({ provenance: "observed", scope: "latest-turn", total: 50_000, contextWindow: 200_000 });
    expect(ctx.pct).toBe(25);
    expect(ctx.text).toBe("50k of 200k (25%)");
    expect(M.contextUsage({ provenance: "observed", total: 50_000 })).toBeNull();
    expect(M.contextUsage({ provenance: "estimated", scope: "latest-turn", total: 50_000, contextWindow: 200_000 })).toBeNull();
    expect(M.contextUsage({ provenance: "observed", scope: "session", total: 50_000, contextWindow: 200_000 })).toBeNull();
    expect(M.contextUsage({ provenance: "observed", scope: "latest-turn", total: 250_000, contextWindow: 200_000 })).toEqual({ pct: 100, text: "250k of 200k (125%)" });
    expect(M.contextUsage({ provenance: "observed", contextWindow: 200_000 })).toBeNull();
    expect(M.contextUsage(undefined)).toBeNull();
  });

  test("context display switches between percentage and readable token capacity", () => {
    const tokens = { provenance: "observed", scope: "latest-turn", total: 50_000, contextWindow: 200_000 };
    expect(M.contextDisplayValue(tokens, "percent")).toBe("25%");
    expect(M.contextDisplayValue(tokens, "tokens")).toBe("50k / 200k");
    expect(M.contextDisplayValue({ provenance: "unknown" }, "percent")).toBe("not reported");
  });

  test("role aliases resolve to stable visual role categories", () => {
    expect(M.roleView("orchestration")).toEqual({ key: "orchestrator", label: "Orchestrator" });
    expect(M.roleView("designer")).toEqual({ key: "frontend", label: "Frontend / designer" });
    expect(M.roleView("implementer")).toEqual({ key: "backend", label: "Backend implementer" });
    expect(M.roleView("qa")).toEqual({ key: "tester", label: "Tester" });
    expect(M.roleView("unknown lane")).toEqual({ key: "agent", label: "Agent" });
  });
});

describe("typical request (header token truth)", () => {
  test("prefers the server-reported totals.tokenMedian", () => {
    const snap = {
      programs: [{ id: "p", name: "P", agents: [agent({ tokens: { provenance: "observed", scope: "latest-turn", total: 9_000_000 } })] }],
      totals: { tokenMedian: 12_000 },
    };
    expect(M.typicalRequestOf(snap)).toEqual({ value: 12_000, source: "reported" });
  });

  test("falls back to the median of live latest-turn totals", () => {
    const snap = {
      programs: [{
        id: "p", name: "P",
        agents: [
          agent({ id: "1", tokens: { provenance: "observed", scope: "latest-turn", total: 10_000 } }),
          agent({ id: "2", tokens: { provenance: "observed", scope: "latest-turn", total: 30_000 } }),
          agent({ id: "3", status: "archived", tokens: { provenance: "observed", scope: "latest-turn", total: 900_000 } }),
          agent({ id: "4", tokens: { provenance: "observed", total: 700_000 } }), // session-scoped: excluded
          agent({ id: "5", tokens: { provenance: "unknown" } }),
        ],
      }],
    };
    expect(M.typicalRequestOf(snap)).toEqual({ value: 20_000, source: "derived" });
  });

  test("reports nothing when no live session reports latest-turn usage", () => {
    const snap = { programs: [{ id: "p", name: "P", agents: [agent({ tokens: { provenance: "unknown" } })] }] };
    expect(M.typicalRequestOf(snap)).toBeNull();
  });
});

describe("Cursor model policy", () => {
  test("current and legacy states map to Compliant / Model mismatch / Model unreported", () => {
    expect(M.modelPolicyView(agent({ modelPolicy: { state: "compliant" } })).label).toBe("Compliant");
    expect(M.modelPolicyView(agent({ modelPolicy: { state: "mismatch", expected: "grok" } })).label).toBe("Model mismatch");
    expect(M.modelPolicyView(agent({ modelPolicy: { state: "violation", expected: "grok" } })).state).toBe("mismatch");
    expect(M.modelPolicyView(agent({ modelPolicy: { state: "unreported" } })).label).toBe("Model unreported");
    expect(M.modelPolicyView(agent({ modelPolicy: { state: "unverified" } })).state).toBe("unreported");
  });

  test("unknown is neither compliant nor a violation", () => {
    expect(M.modelPolicyView(agent())).toBeNull();
    const unreported = M.modelPolicyView(agent({ modelPolicy: { state: "unreported" } }));
    expect(unreported.state).toBe("unreported");
    expect(unreported.summary).toContain("cannot be verified");
    expect(M.modelPolicyView(agent({ modelPolicy: { state: "definitely-fine" } }))).toBeNull();
  });

  test("totals pass through tokenMedian, aggregate tokens, and cursorModelHealth", () => {
    const totals = {
      live: 33, tracked: 427, working: 8, idle: 25, history: 394, attention: 0,
      tokenReporting: 8, tokenEligible: 8, tokenMedian: 170_912, tokens: 1_223_880,
      cursorModelHealth: { compliant: 2, mismatch: 0, unreported: 4, total: 6 },
    };
    const t = M.totalsOf({ programs: [], totals });
    expect(t.tokenMedian).toBe(170_912);
    expect(t.tokens).toBe(1_223_880);
    expect(t.cursorModelHealth).toEqual(totals.cursorModelHealth);
  });

  test("fleet policy glance: zero active mismatches is calm, any mismatch is hot", () => {
    const calm = M.cursorPolicyParts({ compliant: 2, mismatch: 0, unreported: 4, total: 6 });
    expect(calm.map((p: { text: string }) => p.text)).toEqual(["0 mismatches", "2 compliant", "4 unreported"]);
    expect(calm[0].tone).toBe("ok");
    const hot = M.cursorPolicyParts({ compliant: 1, mismatch: 1, unreported: 0, total: 2 });
    expect(hot[0]).toEqual({ text: "1 mismatch", tone: "bad" });
    expect(M.cursorPolicyParts(undefined)).toBeNull();
    expect(M.cursorPolicyParts({ compliant: 0, mismatch: 0, unreported: 0, total: 0 })).toBeNull();
  });

  test("fallback issues surface live violations for Needs you", () => {
    const snap = {
      programs: [{
        id: "p", name: "P",
        agents: [
          agent({ id: "v", provider: "cursor", modelPolicy: { state: "mismatch", expected: "grok", summary: "Reported model is gpt-5." } }),
          agent({ id: "done", status: "archived", modelPolicy: { state: "mismatch" } }),
          agent({ id: "ok", provider: "cursor", modelPolicy: { state: "compliant" } }),
        ],
      }],
      controlHealth: { cmuxReachable: true, lastCheckedAt: "", errors: [], staleSources: [] },
    };
    const issues = M.issuesOf(snap);
    const policy = issues.filter((i: { kind: string }) => i.kind === "policy");
    expect(policy).toHaveLength(1);
    expect(policy[0].severity).toBe("error");
    expect(policy[0].affectedAgentIds).toEqual(["v"]);
    expect(policy[0].summary).toContain("Expected: grok");
  });
});

describe("modelShort — Cursor-native short forms within the 18-char bound", () => {
  test("Composer flattens to 'composer <version> <qualifier>'", () => {
    expect(M.modelShort("composer-2.5-fast")).toBe("composer 2.5 fast");
    expect(M.modelShort("composer-2.5")).toBe("composer 2.5");
    expect(M.modelShort("composer-2")).toBe("composer 2");
    // The recognizable output must stay within the row's 18-char budget.
    expect(M.modelShort("composer-2.5-fast").length).toBeLessThanOrEqual(18);
  });

  test("Grok keeps a recognizable family + dotted version, dropping qualifiers", () => {
    expect(M.modelShort("cursor-grok-4.5-high-fast")).toBe("grok 4.5");
    expect(M.modelShort("grok-4.5-fast-xhigh")).toBe("grok 4.5");
    expect(M.modelShort("grok-4.5")).toBe("grok 4.5");
    expect(M.modelShort("grok")).toBe("grok");
  });

  test("existing Anthropic, Codex, and Cursor-agent short forms are unchanged", () => {
    expect(M.modelShort("claude-opus-4-8-thinking-high")).toBe("opus 4.8");
    expect(M.modelShort("claude-fable-5-thinking-high")).toBe("fable 5");
    expect(M.modelShort("gpt-5.6-sol-xhigh")).toBe("sol 5.6");
    expect(M.modelShort("gpt-5-codex")).toBe("gpt-5-codex");
    expect(M.modelShort(null)).toBeNull();
  });
});

describe("issues", () => {
  test("normalized server issues pass through untouched", () => {
    const issues = [{ id: "system:x", kind: "system", severity: "error", title: "t", summary: "s", affectedAgentIds: [] }];
    expect(M.issuesOf({ programs: [], issues })).toBe(issues);
  });

  test("fallback surfaces collector errors as a system issue even with zero attention agents", () => {
    const snap = {
      programs: [{ id: "p", name: "P", agents: [agent()] }],
      controlHealth: { cmuxReachable: true, lastCheckedAt: "", errors: ["boom"], staleSources: [] },
    };
    const issues = M.issuesOf(snap);
    expect(issues.some((i: { kind: string }) => i.kind === "system")).toBe(true);
    expect(issues[0].technicalDetails).toEqual(["boom"]);
  });

  test("issue lifecycle labels keep verification and source-confirmed resolution distinct", () => {
    const verifying = {
      id: "system:verification",
      kind: "system",
      severity: "error",
      title: "Identity conflict",
      summary: "Source still reports the conflict.",
      affectedAgentIds: [],
      lifecycle: { state: "verifying", openedAt: "2026-07-22T05:00:00.000Z", verificationStartedAt: "2026-07-22T05:01:00.000Z" },
    };
    const resolved = {
      ...verifying,
      lifecycle: { state: "resolved", openedAt: verifying.lifecycle.openedAt, resolvedAt: "2026-07-22T05:02:00.000Z", result: "Fresh source evidence is clear." },
    };
    expect(M.issueStateLabel(verifying)).toBe("Verifying");
    expect(M.issueStateLabel(resolved)).toBe("Resolved");
    expect(M.issuesOf({ programs: [], issues: [verifying] })[0].lifecycle.state).toBe("verifying");
    expect(M.recentlyResolvedOf({ programs: [], recentlyResolved: [resolved] })).toEqual([resolved]);
  });
});

describe("search", () => {
  test("matches across name, role, provider, model, status, cwd, and transcript", () => {
    const a = agent({
      role: "verifier", model: "gpt-5.6-sol", cwd: "/Users/emilio/Developer/the-mountain",
      transcriptTail: "All checks passed on ridge-7.", nickname: "Scout",
    });
    const program = { id: "p", name: "The Mountain" };
    for (const q of ["scout", "verifier", "codex", "sol", "working", "the-mountain", "ridge-7", "mountain"]) {
      expect(M.matchesQuery(a, program, q)).toBe(true);
    }
    expect(M.matchesQuery(a, program, "zzz-nope")).toBe(false);
  });

  test("the search affordance advertises exactly the fields matchesQuery covers", () => {
    const input = html.match(/<input id="search"[^>]*>/)?.[0];
    expect(input).toBeDefined();
    const placeholder = input!.match(/placeholder="([^"]*)"/)?.[1] ?? "";
    const title = input!.match(/title="([^"]*)"/)?.[1] ?? "";
    // Both surfaces name the same searchable fields; every advertised field is
    // one matchesQuery actually indexes — no promise the search can't keep.
    const program = { id: "p", name: "Prog" };
    const probes: Array<[string, string]> = [
      ["name", "ridge-scout"], ["model", "gpt-5.6-sol"], ["cwd", "/Users/emilio/Developer/deep-ridge"],
      ["provider", "codex"], ["role", "verifier"], ["status", "running"], ["session id", "sess-ridge-9"],
    ];
    const a = agent({
      displayName: "ridge-scout", model: "gpt-5.6-sol", cwd: "/Users/emilio/Developer/deep-ridge",
      provider: "codex", role: "verifier", status: "running", sourceSessionId: "sess-ridge-9",
    });
    for (const [field, sample] of probes) {
      expect(placeholder.toLowerCase()).toContain(field);
      expect(title.toLowerCase()).toContain(field);
      expect(M.matchesQuery(a, program, sample.toLowerCase())).toBe(true);
    }
  });
});

describe("stable-feed elapsed clocks", () => {
  test("live sessions get a ticking clock; ended sessions freeze", () => {
    const generatedAt = new Date(Date.now() - 5000).toISOString();
    const live = M.elapsedDataset(agent({ elapsedMs: 60_000 }), generatedAt);
    expect(live.elapsedBase).toBe("60000");
    expect(live.elapsedFrom).toBe(generatedAt);
    const done = M.elapsedDataset(agent({ status: "archived", elapsedMs: 60_000 }), generatedAt);
    expect(done).toEqual({});
    expect(M.liveElapsedText(agent({ status: "archived", elapsedMs: 60_000 }), generatedAt)).toBe("60s");
  });
});

describe("unavailable-control explanation stays plain-language", () => {
  test("messages come from control state and never carry raw routing IDs", () => {
    const quarantined = M.controlUnavailableText("quarantined");
    const observed = M.controlUnavailableText("observed-only");
    expect(quarantined).toContain("identity is ambiguous");
    expect(observed).toContain("no safe cmux target is linked");
    for (const msg of [quarantined, observed]) {
      expect(msg).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i); // no UUID fragments
      expect(msg).not.toMatch(/ttys|workspace:|surface/); // no cmux identifiers
    }
  });

  /* W4-B: was seven source substrings over two hand-sliced function bodies —
     it could not fail if a reason were echoed through a variable, and it broke
     whenever a function moved. Now a real routing reason is planted and both
     surfaces are read: the banner explains, the dock stays silent. */
  test("command dock never echoes capability reasons in the Operate chrome", () => {
    const reason = "surface a1b2 is claimed by two sessions (lsof evidence conflicts)";
    const quarantined = agent({
      controlState: "quarantined",
      target: { resolution: "ambiguous", reason },
      controls: [
        { action: "instruct", enabled: false, reason },
        { action: "focus", enabled: false, reason },
        { action: "interrupt", enabled: false, reason },
        { action: "archive", enabled: false, reason },
      ],
    });
    const dock = withDom(() => M.renderCommandDock(quarantined, "quarantined", null, []));
    const banner = withDom(() => M.renderControlBanner(quarantined, "quarantined"));

    // The banner owns the explanation — in its own operator sentence, not by
    // pasting the resolver's evidence string at someone.
    expect(banner).not.toBeNull();
    expect(textOf(banner)).toContain(M.controlUnavailableText("quarantined"));
    expect(textOf(banner)).not.toContain(reason);

    // The dock never repeats the raw routing reason — not in text, not in a
    // title, not in an aria-label. That string is evidence, not operator copy.
    const dockText = textOf(dock);
    expect(dockText).not.toContain(reason);
    expect(dockText).toContain(M.controlUnavailableText("quarantined"));
    const leaked = findAll(dock, (n: any) =>
      Object.values(n.attributes || {}).some((v) => String(v).includes(reason)));
    expect(leaked).toEqual([]);
  });
});

describe("broadcast recipient eligibility", () => {
  test("only live, instruct-capable sessions are eligible", () => {
    const live = agent({ status: "running", controls: [{ action: "instruct", enabled: true }] });
    expect(M.broadcastEligible(live)).toBe(true);
  });

  test("ended, observed-only, and instruction-less sessions are never eligible", () => {
    expect(M.broadcastEligible(agent({ status: "archived", controls: [{ action: "instruct", enabled: true }] }))).toBe(false);
    expect(M.broadcastEligible(agent({ status: "running", controls: [{ action: "instruct", enabled: false, reason: "Observed only." }] }))).toBe(false);
    expect(M.broadcastEligible(agent({ status: "running", controls: [{ action: "focus", enabled: true }] }))).toBe(false);
    expect(M.broadcastEligible(agent({ status: "running", controls: [] }))).toBe(false);
  });

  test("ineligible recipients name their reason from the same state the gate reads", () => {
    // Ended splits archived (explicit) vs ended (stale / other non-live).
    expect(M.broadcastIneligibleReason(agent({ status: "archived" }))).toBe("archived");
    expect(M.broadcastIneligibleReason(agent({ status: "stale" }))).toBe("ended");
    expect(M.broadcastIneligibleReason(agent({ activity: "ended", status: "running" }))).toBe("ended");
    // Live-but-locked reads its control state: ambiguous target → quarantined,
    // everything else → view only. Same fields deriveControlState consumes.
    expect(M.broadcastIneligibleReason(agent({ status: "running", target: { resolution: "ambiguous" } }))).toBe("quarantined");
    expect(M.broadcastIneligibleReason(agent({ status: "running", target: { resolution: "missing" } }))).toBe("view only");
    expect(M.broadcastIneligibleReason(agent({ status: "running", controlState: "quarantined" }))).toBe("quarantined");
    // Never the bare "unavailable" placeholder.
    for (const a of [agent({ status: "archived" }), agent({ status: "running", target: { resolution: "missing" } })]) {
      expect(M.broadcastIneligibleReason(a)).not.toBe("unavailable");
    }
  });

  test("the broadcast dock chip renders the reason word, not a bare 'unavailable'", () => {
    const barSrc = source.match(/function renderBroadcastBar\(\) \{[\s\S]*?\n\}/)?.[0];
    expect(barSrc).toBeDefined();
    // The chip's resting state label is derived, never the old hard-coded string.
    expect(barSrc).toContain('text: ok ? "ready" : broadcastIneligibleReason(agent)');
    expect(barSrc).not.toContain('"unavailable"');
  });
});

describe("redesigned network contracts (source-level)", () => {
  test("program rename is presentation-only via GET/POST /api/program-aliases", () => {
    expect(source).toContain('fetch("/api/program-aliases"');
    const program = { id: "stable-source-id", name: "Source program" };
    expect(M.presentationLabelKey({ kind: "program", programId: program.id }))
      .toBe("program:stable-source-id");
    expect(M.programName(program)).toBe("Source program");
  });

  /* W4-B: was seven source substrings. They could not fail if fetchLabels
     stopped reading `body.labels`, or if submitRename posted the display name
     instead of the stable target. Both are the actual contract with the server,
     so both are now driven. */
  test("labels hydrate from the existing loopback path and submit stable target payloads", async () => {
    const target = { kind: "program", programId: "p1" };
    await withState({ labels: new Map(), aliases: new Map(), labelsLoaded: false, labelLoadError: "" }, async () => {
      await withRequests([{ status: 200, json: { ok: true, labels: { "program:p1": "Ridge" } } }], async (calls) => {
        await M.fetchLabels();
        expect(calls.map((c) => [c.method, c.url])).toEqual([["GET", "/api/program-aliases"]]);
        expect(M.state.labels.get("program:p1")).toBe("Ridge");
        expect(M.state.labelsLoaded).toBe(true);
      });
    });

    // A malformed envelope must not be adopted as "no labels" — that would
    // silently wipe every custom name on the board.
    await withState({ labels: new Map([["program:p1", "Ridge"]]), aliases: new Map(), labelsLoaded: false, labelLoadError: "" }, async () => {
      await withRequests([{ status: 200, json: { ok: true } }], async () => {
        await M.fetchLabels();
        expect(M.state.labels.get("program:p1")).toBe("Ridge");
        expect(M.state.labelLoadError).not.toBe("");
      });
    });

    // The POST carries the stable presentation target, never the rendered name.
    await withState({
      snap: snapshot(), labels: new Map(), aliases: new Map(),
      renaming: M.presentationLabelKey(target), renameDraft: "  Ridge crew  ",
      renamePending: false, renameError: "",
    }, async () => {
      await withRequests([{ status: 200, json: { ok: true } }], async (calls) => {
        await M.submitRename(target);
        expect(calls[0]!.method).toBe("POST");
        expect(calls[0]!.url).toBe("/api/program-aliases");
        expect(calls[0]!.body).toEqual({ target, label: "Ridge crew" });
        expect(M.state.aliases.get("program:p1")).toBe("Ridge crew");
        expect(M.state.renaming).toBeNull();
      });
    });

    // An empty label is a reset, and it clears the stored alias rather than
    // saving an empty string that would render as a blank name.
    await withState({
      snap: snapshot(), labels: new Map([["program:p1", "Ridge crew"]]),
      aliases: new Map([["program:p1", "Ridge crew"]]),
      renaming: M.presentationLabelKey(target), renameDraft: "   ",
      renamePending: false, renameError: "",
    }, async () => {
      await withRequests([{ status: 200, json: { ok: true } }], async (calls) => {
        await M.submitRename(target);
        expect(calls[0]!.body.label).toBe("");
        expect(M.state.aliases.has("program:p1")).toBe(false);
      });
    });
  });

  test("program labels use semantic keyboard controls with a caret that only expands", () => {
    const program = { id: "p1", name: "P", agents: [agent()] };
    const root = newNode("div");
    withDom(() => M.syncProgramList(
      root,
      [{ program, agents: program.agents }],
      listUi({ snap: { schemaVersion: 1, programs: [program] } }),
    ));
    const head = byClass(root, "program-head");
    const caret = byClass(root, "program-caret");
    const label = byClass(root, "program-label");
    expect(head).not.toBeNull();
    expect(caret?.tagName).toBe("button");
    expect(caret?.attributes.type).toBe("button");
    expect(label?.tagName).toBe("button");
    expect(label?.attributes.type).toBe("button");
    expect(label?.attributes.role).toBeUndefined();

    const form = withDom(() => M.renderLabelForm(
      { kind: "program", programId: program.id },
      {
        inputKey: "rename-input:p1",
        placeholder: "Display name",
        ariaLabel: "New display name for P",
        source: "Source program: P · id stays p1",
      },
    ));
    const input = findAll(form, (node) => node.tagName === "input")[0];
    const submit = buttonsOf(form).find((button) => button.attributes.type === "submit");
    expect(form.tagName).toBe("form");
    expect(input?.attributes.type).toBe("text");
    expect(input?.attributes["aria-label"]).toBe("New display name for P");
    expect(submit).toBeDefined();
    expect(source).toContain('onkeydown: (e) => { if (e.key === "Escape")');
  });

  test("agent names track terminal titles and stay editable in the list", () => {
    const linked = agent({
      displayName: "Codex · ridge",
      target: {
        resolution: "exact",
        workspaceId: "WORKSPACE-1",
        surfaceId: "SURFACE-1",
        workspaceTitle: "Ridge terminal",
      },
    });
    expect(M.agentLabelEligible(linked)).toBe(true);
    expect(M.agentLabelEligible(null)).toBe(false);
    expect(M.terminalSourceName(linked)).toBe("Ridge terminal");
    expect(M.preferredRenameTarget(linked)).toEqual({
      kind: "workspace",
      workspaceId: "WORKSPACE-1",
    });
    expect(M.agentName(linked)).toBe("Ridge terminal");
    expect(M.agentName({
      ...linked,
      target: { ...linked.target, cwdMismatch: true },
    })).toBe("Codex · ridge");

    const program = { id: "p1", name: "P", agents: [linked] };
    const row = withDom(() => M.renderAgentRow(linked, program));
    expect(row.tagName).toBe("div");
    expect(row.attributes.role).toBe("button");
    expect(byClass(row, "agent-rename")?.tagName).toBe("button");
    expect(M.agentRowSig(linked, listUi({
      renaming: "workspace:WORKSPACE-1",
    }), { depth: 0, childCount: 0, fullById: new Map() }))
      .not.toBe(M.agentRowSig(linked, listUi(), {
        depth: 0,
        childCount: 0,
        fullById: new Map(),
      }));
  });

  /* W4-B: was five source substrings that could not fail if sendBroadcast
     started posting every selected id, or started calling a 200 a delivery.
     Both are now asserted from the request it makes and the results it keeps. */
  test("broadcast posts only eligible recipients and never fabricates delivery", async () => {
    const live = agent({ id: "codex:live", controls: [{ action: "instruct", enabled: true }] });
    const locked = agent({ id: "codex:locked", controls: [{ action: "instruct", enabled: false, reason: "quarantined" }] });
    const ended = agent({ id: "codex:ended", status: "archived", controls: [{ action: "instruct", enabled: true }] });
    const snap = snapshot({ programs: [{ id: "p", name: "P", agents: [live, locked, ended] }] });

    await withState({
      snap, conn: "live", selecting: true,
      selection: new Set([live.id, locked.id, ended.id]),
      broadcastDraft: "rebase onto main", broadcastConfirming: true,
      broadcastPending: false, broadcastResults: null, broadcastError: "",
    }, async () => {
      await withRequests([{
        status: 200,
        json: { ok: false, partial: true, sent: 0, failed: 1, results: [{ agentId: live.id, ok: false, error: { code: "CMUX_FAILED", message: "no pane" } }] },
      }], async (calls) => {
        await M.sendBroadcast();
        // Only the eligible recipient is offered to the server; the locked and
        // ended sessions are never counted as instructed.
        expect(calls).toHaveLength(1);
        expect(calls[0]!.url).toBe("/api/broadcast");
        expect(calls[0]!.body.agentIds).toEqual([live.id]);
        expect(calls[0]!.body.instruction).toBe("rebase onto main");
        // A per-recipient failure is kept as a failure — never smoothed into
        // "sent", and the composer keeps the text so it can be retried.
        expect(M.state.broadcastResults.get(live.id).ok).toBe(false);
        expect(M.state.broadcastDraft).toBe("rebase onto main");
        expect(M.state.broadcastConfirming).toBe(false);
      });
    });

    // A response with no per-recipient results is an error, not a success.
    await withState({
      snap, conn: "live", selecting: true, selection: new Set([live.id]),
      broadcastDraft: "go", broadcastConfirming: true, broadcastPending: false,
      broadcastResults: null, broadcastError: "",
    }, async () => {
      await withRequests([{ status: 200, json: { ok: true, sent: 1, failed: 0 } }], async () => {
        await M.sendBroadcast();
        expect(M.state.broadcastResults).toBeNull();
        expect(M.state.broadcastError).toContain("Broadcast failed");
      });
    });
  });
});

describe("calm program and agent list rendering", () => {
  test("the message lane is additive and falls back to the existing summary", () => {
    const message = "Review the responsive control room layout across desktop and mobile widths.";
    expect(M.rowSummary(agent({ lastHumanMessage: message }))).toContain("Review the responsive control room layout");
    expect(M.rowSummary(agent({ lastHumanMessage: "   " }))).toBe("Streaming output.");
  });

  test("program lists share the five primary columns and keep secondary details out of the row grid", () => {
    expect(source).toContain("function renderAgentColumnHeader()");
    /* FE-B: the row list is now a keyed PLAN reconciled into the program body
       rather than an array appended wholesale, so this asserts on the plan the
       list actually produces — the column header still leads it. */
    const program = { id: "p1", name: "P", agents: [agent({ id: "codex:a1" }), agent({ id: "codex:a2" })] };
    const plan = M.agentRowPlan(program, program.agents, listUi({ snap: { schemaVersion: 1, programs: [program] } }));
    expect(plan.map((item: { key: string }) => item.key)).toEqual(["columns", "row:codex:a1", "row:codex:a2"]);
    // C1: the header names the identity column plus the promoted instrument
    // cluster (status word, model+ctx%, tokens, elapsed) — "Context"/"Access" text
    // tags left the row grid (Access folds into the aria-label; ctx% rides Model).
    const header = withDom(() => plan[0].build());
    expect(header.className).toContain("agent-column-header");
    for (const label of ["Agent/message", "Status", "Model · Ctx", "Tokens", "Elapsed"]) {
      expect(textOf(header)).toContain(label);
    }
    expect(source).not.toContain('rowFact("Effort"');
    expect(source).not.toContain("class: \"fact-age\"");
    expect(styles).toContain(".agent-column-header");
    expect(styles).toContain("-webkit-line-clamp: 3");
  });

  test("status column is the state-colored activity word plus a red alert span, not a bare dot", () => {
    const row = source.match(/function renderAgentRow\(agent, program, opts = \{\}\) \{[\s\S]*?\n\}/)?.[0];
    expect(row).toBeDefined();
    // Full state still lives in the tooltip + row aria-label.
    expect(row).toContain('title: stateText');
    // The activity word carries the state color (act-<activity>); no duplicate dot glyph.
    expect(row).toContain('class: "act-" + activity, text: ACTIVITY_LABELS[activity]');
    expect(row).not.toContain("act-glyph act-");
    // The alert suffix rides its own red span rather than an uncolored word.
    expect(row).toContain('class: "row-state-alert"');
    expect(styles).toContain(".row-state-alert { color: var(--needs); }");
  });

  test("selected rows retain an accessible full-text inspector path", () => {
    const message = "Review the full terminal transcript before dispatch.";
    const selected = agent({ lastHumanMessage: message, lastAgentMessage: "Evidence checked." });
    const program = { id: "p1", name: "P", agents: [selected] };
    const row = withDom(() => M.renderAgentRow(selected, program));
    expect(row.attributes["aria-label"]).toContain(
      "Select to open the full message and session details in the inspector.",
    );

    const drawer = withDom(() => {
      const pane = newNode("div");
      M.renderAgentDrawer(pane, { kind: "agent", agent: selected, program });
      return pane;
    });
    const humanMessage = byClass(drawer, "last-human-message");
    expect(humanMessage).not.toBeNull();
    expect(textOf(humanMessage)).toBe(message);
    expect(textOf(drawer)).toContain("Evidence checked.");
    expect(styles).toContain("white-space: pre-wrap");
    expect(styles).toContain("min-height: 44px");
  });
});

describe("agent rows: instrument cluster + de-noise (C1)", () => {
  /* Same DOM-less execution trick B2/B3/B4 used: a minimal fake document lets
     renderAgentRow build real nodes via el()/icon(), so these assert on what the
     row actually renders — not merely on source substrings. */
  function fakeDom() {
    const make = (tag: string) => ({
      nodeType: 1,
      tagName: tag,
      className: "",
      textContent: "",
      dataset: {} as Record<string, string>,
      attributes: {} as Record<string, string>,
      children: [] as unknown[],
      setAttribute(k: string, v: unknown) { this.attributes[k] = String(v); },
      addEventListener() {},
      append(...kids: unknown[]) { this.children.push(...kids); },
    });
    return {
      createElement: (t: string) => make(t),
      createElementNS: (_ns: string, t: string) => make(t),
      createTextNode: (s: string) => ({ nodeType: 3, textContent: String(s) }),
    };
  }
  function withDom<T>(fn: () => T): T {
    (globalThis as unknown as { document: unknown }).document = fakeDom();
    try { return fn(); } finally {
      delete (globalThis as unknown as { document?: unknown }).document;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function classesOf(node: any, out: string[] = []): string[] {
    if (!node || typeof node !== "object") return out;
    if (typeof node.className === "string" && node.className) out.push(node.className);
    for (const kid of node.children || []) classesOf(kid, out);
    return out;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function textOf(node: any): string {
    if (!node || typeof node !== "object") return "";
    if (node.nodeType === 3) return String(node.textContent || "");
    let s = typeof node.textContent === "string" ? node.textContent : "";
    for (const kid of node.children || []) s += textOf(kid);
    return s;
  }
  // First node whose className carries the given token (whitespace-separated).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function findByClass(node: any, token: string): any {
    if (!node || typeof node !== "object") return null;
    if (typeof node.className === "string" && node.className.split(/\s+/).includes(token)) return node;
    for (const kid of node.children || []) {
      const hit = findByClass(kid, token);
      if (hit) return hit;
    }
    return null;
  }

  const program = { id: "p1", name: "Prog" };

  test("(a) the executed row renders a .row-instruments cluster with mono model/ctx%/tokens/elapsed", () => {
    expect(typeof M.renderAgentRow).toBe("function");
    const live = agent({
      model: "gpt-5-codex",
      tokens: { provenance: "observed", scope: "latest-turn", total: 40000, contextWindow: 200000 },
      elapsedMs: 125000,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: any = withDom(() => M.renderAgentRow(live, program));
    const instruments = findByClass(row, "row-instruments");
    expect(instruments).not.toBeNull();
    const text = textOf(instruments);
    expect(text).toContain("gpt-5-codex"); // model short id, reused from modelShort
    expect(text).toContain("20%");         // ctx% (40k/200k) — DESIGN "model + ctx%"
    expect(text).toContain("40k");         // observed tokens, reused from tokenSummary
    expect(text).toContain("2m");          // 125s uptime → fmtElapsed "2m"
    // Values ride the canonical "<size> mono" convention (DESIGN rule 2 —
    // mono for values), like vital-big mono; status word is the one non-value.
    const monoVals = classesOf(instruments)
      .filter((c) => /\bri-value\b/.test(c) && /\bmono\b/.test(c));
    expect(monoVals.length).toBeGreaterThanOrEqual(3); // model, tokens, elapsed
  });

  test("(b) unknown tokens/context omit cells honestly — no fabricated numbers", () => {
    const bare = agent({
      provider: "claude",
      model: "claude-opus-4-8",
      tokens: { provenance: "unknown" },
      elapsedMs: undefined,
      updatedAt: undefined,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: any = withDom(() => M.renderAgentRow(bare, program));
    const instruments = findByClass(row, "row-instruments");
    expect(instruments).not.toBeNull();
    // Model still shows its honest short id, but no invented context percentage.
    const modelCell = findByClass(instruments, "ri-model");
    expect(modelCell).not.toBeNull();
    expect(textOf(modelCell)).toContain("opus 4.8");
    // Honest omission (vitals-band precedent): no tokens cell, no elapsed cell.
    expect(findByClass(instruments, "ri-tokens")).toBeNull();
    expect(findByClass(instruments, "ri-elapsed")).toBeNull();
    const text = textOf(instruments);
    expect(text).not.toContain("%");            // no invented percentage
    expect(text).not.toContain("not reported"); // cell omitted, never faked as text
  });

  test("(c) naming noise leaves the row — mismatch keeps a marked, accessible indicator; detail folds to title/aria", () => {
    const rowSrc = source.match(/function renderAgentRow\(agent, program, opts = \{\}\) \{[\s\S]*?\n\}/)?.[0];
    expect(rowSrc).toBeDefined();
    // The visible "terminal: " / "source: " / "cwd differs" text tags are gone
    // from the row output path (they now live in the drawer + tooltip only).
    expect(rowSrc).not.toContain('"terminal: " + terminal');
    expect(rowSrc).not.toContain('"source: " + sourceName');
    expect(rowSrc).not.toContain('" · cwd differs"');
    // De-noised detail is reused from the drawer's helper, not re-forked.
    expect(rowSrc).toContain("fullSourceDetail(agent)");
    // Executed: a cwd-mismatch session renders exactly one small marked indicator
    // carrying an accessible label — and no naming prose survives on the row.
    const mism = agent({
      target: { resolution: "exact", surfaceId: "s1", workspaceId: "w1", cwdMismatch: true, workspaceTitle: "ridge-term" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: any = withDom(() => M.renderAgentRow(mism, program));
    const dot = findByClass(row, "source-mismatch-dot");
    expect(dot).not.toBeNull();
    expect(dot.attributes["aria-label"]).toBeTruthy();
    expect(textOf(row)).not.toContain("cwd differs");
    expect(textOf(row)).not.toContain("terminal:");
    // A calm (non-mismatch) session shows no source mark at all on the row.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calmRow: any = withDom(() => M.renderAgentRow(agent(), program));
    expect(findByClass(calmRow, "source-mismatch-dot")).toBeNull();
  });

  test("(c2) watch-only rows carry a dot instead of an Access column, and only when it informs", () => {
    // The Access column was dropped with the instrument cluster (9d79c76) and left
    // control state visible only to screen readers. These assertions pin the
    // replacement: a dot where control is genuinely unavailable, silence where a
    // dot on every row would say nothing. Each case states WHY it renders or not,
    // so weakening the suppression rule fails here instead of shipping row noise.
    const reachable = { controlHealth: { cmuxReachable: true, errors: [], staleSources: [] } };
    const unreachable = { controlHealth: { cmuxReachable: false, errors: ["cmux discovery failed"], staleSources: [] } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const previousSnap = (M.state as any).snap;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dotFor = (overrides: Record<string, unknown>, snap: unknown): any => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (M.state as any).snap = snap;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row: any = withDom(() => M.renderAgentRow(agent(overrides) as any, program));
      return findByClass(row, "control-dot");
    };
    try {
      // Controllable session: nothing to warn about, so no mark.
      expect(dotFor({ controlState: "linked" }, reachable)).toBeNull();

      // Watch-only while control DOES work elsewhere — the informative case.
      const watch = dotFor({ controlState: "observed-only" }, reachable);
      expect(watch).not.toBeNull();
      expect(watch.className).toContain("is-observed");
      // The sentence must survive somewhere reachable, since the column is gone.
      expect(watch.attributes["aria-label"]).toContain("Watch only");
      expect(watch.attributes.title).toBeTruthy();

      // cmux unreachable: the header already reports controls offline fleet-wide,
      // so marking every row would restate it N times. Must stay silent.
      expect(dotFor({ controlState: "observed-only" }, unreachable)).toBeNull();

      // An ended session is uncontrollable by definition — not news.
      // "stale" and "archived" are the two statuses deriveActivity maps to ended.
      expect(dotFor({ controlState: "observed-only", status: "stale" }, reachable)).toBeNull();
      expect(dotFor({ controlState: "observed-only", status: "archived" }, reachable)).toBeNull();

      // Quarantine is a real, fixable identity conflict: always marked, and it
      // must survive cmux being unreachable, unlike plain watch-only.
      for (const snap of [reachable, unreachable]) {
        const quarantined = dotFor({ controlState: "quarantined" }, snap);
        expect(quarantined).not.toBeNull();
        expect(quarantined.className).toContain("is-quarantined");
        expect(quarantined.attributes["aria-label"]).toContain("quarantined");
      }

      // Both inks exist and differ, so the dot's meaning is carried by more than
      // position in the row.
      expect(styles).toContain(".control-dot.is-observed");
      expect(styles).toContain(".control-dot.is-quarantined");
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (M.state as any).snap = previousSnap;
    }
  });

  test("(d) the column header names the promoted instrument columns", () => {
    expect(source).toContain("function renderAgentColumnHeader()");
    // The Access column stays dropped — the row dot above is its replacement.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const noAccess: any = withDom(() => M.renderAgentColumnHeader());
    expect(textOf(noAccess)).not.toContain("Access");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const header: any = withDom(() => M.renderAgentColumnHeader());
    const text = textOf(header);
    for (const label of ["Agent", "Status", "Model", "Tokens", "Elapsed"]) {
      expect(text).toContain(label);
    }
  });

  test("(e) alert washes pair their tint with a state-colored edge rail (Rule 1 — indicator inks, not flood fills)", () => {
    // WS-C audit finding: is-needs-you / is-blocked / is-failed carried a soft tint
    // but NO colored rail. Codified open-q2 threshold: a ≤10% tint must always ride
    // WITH a status-colored edge mark. Assert each alert modifier now sets one.
    for (const [mod, ink] of [["is-needs-you", "--needs"], ["is-blocked", "--blocked"], ["is-failed", "--failed"]]) {
      const rail = styles.match(
        new RegExp(`\\.agent-row\\.${mod}[^\\n{]*\\{[^}]*box-shadow:[^;}]*inset[^;}]*var\\(${ink}\\)`),
      );
      expect(rail).not.toBeNull();
      // And the tint it rides with is still present (paired, not replaced).
      const tint = styles.match(new RegExp(`\\.agent-row\\.${mod}\\b[^\\n{]*\\{[^}]*background:[^;}]*color-mix`));
      expect(tint).not.toBeNull();
    }
  });

  test("(f) the CSS the removed row-fact / control-access helpers owned is gone and can't return", () => {
    // rowFact / contextFact / controlFact were deleted with the instrument-cluster
    // rewrite, so no element emits their classes anymore. Guard both the emitters
    // (app.js) and the now-dead rules (styles) so neither silently comes back.
    for (const cls of ["row-fact", "control-access"]) {
      expect(source).not.toContain(cls);
    }
    for (const rule of [".row-fact {", ".row-fact-value {", ".fact-control {", ".control-access {", ".control-icon {"]) {
      expect(styles).not.toContain(rule);
    }
    // The live neighbours the cleanup must NOT touch stay put.
    expect(styles).toContain(".tm-track { fill: var(--line); }");            // SVG meter fill, shared
    expect(styles).toContain(".status-line-item.control-linked");            // drawer status line, distinct selector
  });

  test("(g) keyboard focus survives the alert rails — each alert state combines its rail with the focus ring", () => {
    // The alert rails `.agent-row.is-needs-you:not(.is-selected)` (and -blocked /
    // -failed) sit at (0,3,0) on the SAME box-shadow property as the (0,2,0)
    // :focus-visible ring, so on exactly the alert rows the rail clobbered the ring
    // and keyboard focus went invisible. The fix is a :focus-visible variant per
    // alert state (0,4,0) that combines BOTH shadow layers — rail + inset ring.
    for (const [mod, ink] of [["is-needs-you", "--needs"], ["is-blocked", "--blocked"], ["is-failed", "--failed"]]) {
      const rule = styles.match(
        new RegExp(`\\.agent-row\\.${mod}:not\\(\\.is-selected\\):focus-visible\\s*\\{[^}]*\\}`),
      )?.[0] ?? "";
      expect(rule).not.toBe("");
      // Both components present: the state-colored 4px rail AND the 1px focus ring.
      expect(rule).toContain(`inset 4px 0 var(${ink})`);
      expect(rule).toContain("inset 0 0 0 1px var(--line-strong)");
    }
  });

  test("(h) linked rows carry a terminal breadcrumb in the identity tags, deduped against the name", () => {
    // exact / unique-cwd links resolve a destination; the breadcrumb rides the
    // existing .row-identity-tags row, not a new line, and never repeats the name.
    const linked = agent({
      displayName: "ridge-term",
      target: { resolution: "exact", surfaceId: "s1", workspaceId: "w1", workspaceTitle: "ridge-term", surfaceCwd: "/Users/emilio/Developer/deep-ridge" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: any = withDom(() => M.renderAgentRow(linked, program));
    const crumb = findByClass(row, "row-terminal");
    expect(crumb).not.toBeNull();
    // The breadcrumb lives inside the identity tag row (not a fabricated line).
    expect(findByClass(findByClass(row, "row-identity-tags"), "row-terminal")).not.toBeNull();
    // Workspace title equals the display name, so it is deduped OUT; the pane
    // folder is the surviving, non-redundant segment.
    expect(textOf(crumb)).toBe("deep-ridge");
    // The breadcrumb tag previews the same destination the Focus button does.
    expect(crumb.attributes["title"]).toContain("/Users/emilio/Developer/deep-ridge");

    // When the shown name is NOT the terminal title (here a home-cwd orch parked
    // in a project-titled pane, so agentName keeps its own identity), both the
    // workspace title and the pane folder survive as distinct destination info.
    const twoPart = agent({
      nickname: "Scout",
      cwd: "/Users/emilio",
      target: { resolution: "unique-cwd", surfaceId: "s2", workspaceId: "w2", workspaceTitle: "CODEX · platform", surfaceCwd: "/srv/app/web", cwdMismatch: true },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const two: any = withDom(() => M.renderAgentRow(twoPart, program));
    expect(textOf(findByClass(two, "row-terminal"))).toBe("CODEX · platform · web");

    // Ambiguous / missing targets resolve no safe destination — no breadcrumb.
    for (const res of ["ambiguous", "missing"]) {
      const unlinked = agent({ target: { resolution: res, workspaceTitle: "ghost", surfaceCwd: "/x/y" } });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r: any = withDom(() => M.renderAgentRow(unlinked, program));
      expect(findByClass(r, "row-terminal")).toBeNull();
    }
  });

  test("(i) the Focus dock button title previews the destination (terminal + pane cwd)", () => {
    const linked = agent({
      target: { resolution: "exact", surfaceId: "s1", workspaceId: "w1", workspaceTitle: "ridge-term", surfaceCwd: "/Users/emilio/Developer/deep-ridge" },
    });
    expect(M.focusDestinationHint(linked)).toBe("Jump to ridge-term · /Users/emilio/Developer/deep-ridge");
    // No resolved destination falls back to the generic label, never a broken one.
    expect(M.focusDestinationHint(agent({ target: { resolution: "missing" } }))).toBe("Jump to terminal pane");
    // The dock tool wires the hint through for the focus action only.
    const toolSrc = source.match(/function renderDockTool\([\s\S]*?\n\}/)?.[0];
    expect(toolSrc).toContain('action === "focus" ? focusDestinationHint(agent) : label');
  });

  test("(j) the terminal breadcrumb stays compact and mono to protect row density", () => {
    const rule = styles.match(/\.row-terminal\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).not.toBe("");
    expect(rule).toContain("var(--font-mono)"); // Rule 2 — identifiers/paths in mono
    expect(rule).toContain("var(--faint)");     // dim quiet fact, not a status chip
    expect(rule).toContain("white-space: nowrap");
    expect(rule).toContain("text-overflow: ellipsis"); // truncates, never wraps a new line
  });

  test("(k) a live row gone quiet >10min shows a dim staleness fact; fresh rows don't", () => {
    // Threshold is exact: 10 min. Only running/waiting (working/idle) rows qualify.
    const now = Date.parse("2026-07-22T03:00:00.000Z");
    const at = (min: number) => new Date(now - min * 60_000).toISOString();
    // Pure-function contract (nowMs injected so no wall-clock flake).
    expect(M.rowStalenessText(agent({ status: "running", updatedAt: at(9) }), now)).toBe("");
    expect(M.rowStalenessText(agent({ status: "running", updatedAt: at(15) }), now)).toBe("updated 15m ago");
    expect(M.rowStalenessText(agent({ status: "waiting", updatedAt: at(42) }), now)).toBe("updated 42m ago");
    // Ended rows never go "stale" — they are done, not quiet.
    expect(M.rowStalenessText(agent({ status: "archived", updatedAt: at(120) }), now)).toBe("");
    // Missing timestamp is honestly silent, never a fabricated age.
    expect(M.rowStalenessText(agent({ status: "running", updatedAt: undefined }), now)).toBe("");

    // Executed: a stale running row renders a .row-stale fact inside the tag row,
    // and it is NOT an ember/alert element (staleness is a nudge, not a status).
    const stale = agent({ status: "running", updatedAt: new Date(Date.now() - 20 * 60_000).toISOString() });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: any = withDom(() => M.renderAgentRow(stale, program));
    const fact = findByClass(row, "row-stale");
    expect(fact).not.toBeNull();
    expect(textOf(fact)).toContain("ago");
    expect(findByClass(findByClass(row, "row-identity-tags"), "row-stale")).not.toBeNull();
    // A fresh running row renders exactly as today — no staleness fact.
    const fresh = agent({ status: "running", updatedAt: new Date().toISOString() });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const freshRow: any = withDom(() => M.renderAgentRow(fresh, program));
    expect(findByClass(freshRow, "row-stale")).toBeNull();
  });

  test("(l) the staleness fact is dim, not an alert ink", () => {
    const rule = styles.match(/\.row-stale\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).not.toBe("");
    expect(rule).toContain("var(--faint)");        // dim
    expect(rule).toContain("var(--font-mono)");    // relative timestamp → mono (Rule 2)
    expect(rule).not.toContain("--ember");         // never an alert
  });
});

describe("operations canvas layout", () => {
  test("the desktop shell shares one 1680px content frame", () => {
    expect(styles).toContain("--frame: min(1680px, calc(100vw - 64px))");
    const framed = styles.match(/max-width:\s*var\(--frame\)/g) ?? [];
    expect(framed.length).toBeGreaterThanOrEqual(5);
    expect(styles).not.toContain("--maxw");
  });

  test("workboard + inspector share one ops-stage shell with an internal divider", () => {
    expect(html).toContain('class="ops-stage"');
    const stageIdx = html.indexOf('class="ops-stage"');
    const mainIdx = html.indexOf('id="main"');
    const inspectorIdx = html.indexOf('id="inspector"');
    expect(stageIdx).toBeGreaterThan(-1);
    expect(stageIdx).toBeLessThan(mainIdx);
    expect(mainIdx).toBeLessThan(inspectorIdx);
    expect(styles).toContain(".ops-stage");
    expect(styles).toMatch(/\.app-body\s*\{[^}]*display:\s*flex/);
    expect(styles).not.toMatch(/\.app-body\s*\{[^}]*gap:\s*1\.5rem/);
    expect(styles).toMatch(/\.pane-inspector\s*\{[^}]*border-left:\s*1px solid var\(--line-strong\)/);
    expect(styles).toMatch(/\.pane-inspector\s*\{[^}]*box-shadow:\s*none/);
  });

  test("finding rows open the drawer; the strip never grows its own triage chrome", () => {
    expect(source).toContain("function renderFindingRow(");
    expect(source).toContain("function pulseStripModel(");
    expect(source).toContain('selectEntity({ kind: finding.kind, id: finding.id })');
    expect(source).toContain("renderTriage(issue)");
    // The strip must not grow Generate-triage chrome; the drawer keeps it.
    expect(source).not.toContain('class: "signal-primary"');
    expect(source).not.toContain('class: "signal-title-btn"');
  });

  test("the inspector/drawer holds a stable 480-520px desktop pane, no 42vw overshoot", () => {
    expect(styles).toContain("--inspector-w: clamp(480px, 32vw, 520px)");
    expect(styles).not.toContain("clamp(38rem, 42vw, 60rem)");
    expect(styles).not.toContain("grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)");
  });

  test("below 1024px the inspector becomes a full-surface drawer and keeps the workboard wide", () => {
    expect(styles).toContain("@media (max-width: 1024px)");
    expect(styles).not.toContain("@media (max-width: 900px)");
    const after = styles.slice(styles.indexOf("@media (max-width: 1024px)"));
    const block = after.slice(0, after.indexOf("@media (max-width: 720px)"));
    expect(block).toContain(".pane-inspector");
    expect(block).toContain("position: fixed");
    expect(block).toContain("inset: 0");
    expect(block).toContain("min-height: 44px");
  });

  test("the full-width strip cannot introduce horizontal overflow", () => {
    expect(styles).toMatch(/body\s*\{[\s\S]*?overflow-x:\s*hidden/);
  });

  test("a Degraded verdict names its reason and exposes the existing refresh action", () => {
    const degraded = snapshot({
      issues: [
        { id: "system:2", kind: "system", severity: "warning", title: "Stale source", summary: "s", affectedAgentIds: [] },
        { id: "system:1", kind: "system", severity: "error", title: "CMUX control is degraded", summary: "s", affectedAgentIds: [] },
      ],
    });
    expect(M.topSourceIssue(degraded)?.title).toBe("CMUX control is degraded");
    expect(M.topSourceIssue(snapshot())).toBeNull();
    expect(source).toContain("topSourceIssue(state.snap)");
    expect(source).toContain('dataset: { fkey: "degraded-refresh" }');
    expect(source).toContain("onclick: () => recollectSnapshot()");
    expect(styles).toContain(".reading-repair");
  });

  test("the degraded Refresh forces a fresh recollect, not a cache re-serve, and never dead-ends", async () => {
    // B1 built POST /api/recollect but the UI never consumed it: the button re-served
    // cache via fetchSnapshot. It now POSTs a fresh collection and applies the result
    // through fetchSnapshot's own apply path; a non-OK envelope (e.g. 500
    // RECOLLECT_FAILED) falls back to fetchSnapshot so Refresh is never a dead button.
    // W4-B: was six source substrings that could not fail if the button went
    // back to a GET. Driven now: the request it makes, the snapshot it adopts,
    // and the fallback that keeps it from dead-ending.
    const fresh = snapshot({ generatedAt: "2026-07-22T04:00:00.000Z" });
    await withState({ snap: null, conn: "live", fetchFailed: true }, async () => {
      await withRequests([{ status: 200, json: fresh }], async (calls) => {
        await M.recollectSnapshot();
        expect(calls.map((c) => [c.method, c.url])).toEqual([["POST", "/api/recollect"]]);
        expect(M.state.snap.generatedAt).toBe(fresh.generatedAt);
        expect(M.state.fetchFailed).toBe(false);
      });
    });

    // A refused recollect must still re-serve the cache, not leave a dead button.
    await withState({ snap: null, conn: "live", fetchFailed: false }, async () => {
      await withRequests([
        { status: 500, json: { ok: false, error: { code: "RECOLLECT_FAILED", message: "collector wedged" } } },
        { status: 200, json: fresh },
      ], async (calls) => {
        await M.recollectSnapshot();
        expect(calls.map((c) => [c.method, c.url]))
          .toEqual([["POST", "/api/recollect"], ["GET", "/api/snapshot"]]);
        expect(M.state.snap.generatedAt).toBe(fresh.generatedAt);
      });
    });
  });

  test("the degraded reason names how long since the source was last healthy, and stays silent when never healthy", () => {
    const twelveMinAgo = new Date(Date.now() - 12 * 60_000).toISOString();
    const withHistory = snapshot({
      totals: {
        live: 1, tracked: 1, attention: 0, working: 1, idle: 0, history: 0,
        sourceHealth: {
          healthy: 1, degraded: 1, total: 2,
          byProvider: {
            codex: { healthy: true, lastHealthyAt: twelveMinAgo },
            claude: { healthy: false, lastHealthyAt: twelveMinAgo },
          },
        },
      },
    });
    // A degraded source with a known last-healthy moment names it (reuses agoText).
    expect(M.degradedSinceText(withHistory)).toBe(" · last healthy 12m ago");
    // Honest omission: a source that has NEVER been healthy says nothing extra —
    // "never seen healthy" would be a lie.
    const neverHealthy = snapshot({
      totals: {
        live: 1, tracked: 1, attention: 0, working: 1, idle: 0, history: 0,
        sourceHealth: {
          healthy: 1, degraded: 1, total: 2,
          byProvider: {
            codex: { healthy: true, lastHealthyAt: twelveMinAgo },
            claude: { healthy: false, lastHealthyAt: null },
          },
        },
      },
    });
    expect(M.degradedSinceText(neverHealthy)).toBe("");
    // No per-provider source health at all → no suffix (default fixture omits it).
    expect(M.degradedSinceText(snapshot())).toBe("");
  });

  test("live re-render preserves focus via the stable fkey restore loop", () => {
    expect(source).toContain("document.activeElement.dataset");
    expect(source).toContain("node.focus({ preventScroll: true })");
    expect(source).toContain('document.getElementById("agent-" + id)');
  });
});

describe("source hygiene", () => {
  test("no literal control bytes in the client source", () => {
    // eslint-disable-next-line no-control-regex
    expect(source).not.toMatch(new RegExp("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f]"));
  });

  test("meters use SVG geometry, never inline style, so the CSP holds", () => {
    // style-src 'self' forbids inline style attributes: no `style:` props at all.
    expect(source).not.toMatch(/\bstyle:\s*`/);
    expect(source).not.toContain("width:${");
    expect(source).toContain("function svgMeter(");
    expect(source).toContain("function svgSparkline(");
    expect(source).toContain("createElementNS");
    expect(source).toContain("function icon(");
  });

  test("the redesigned control surface exposes its structural anchors", () => {
    for (const id of ["health-rail", "filter-bar", "select-toggle", "broadcast-bar",
      "pulse-findings", "nest-beacon", "health-widgets", "customize-summary",
      "widget-customizer", "widget-options", "widget-reset"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain(">Alerts<span");
    expect(source).toContain("function renderWidgetCustomizer()");
    expect(source).toContain("onchange: (event) => setWidgetEnabled");
    expect(source).toContain('aria-label": `Move ${widget.label} up`');
    expect(html).not.toContain('class="colony"');
    expect(html).not.toContain('class="trail"');
    expect(html).not.toMatch(/class="ant /);
    expect(html).toContain('id="filter-bar" aria-label="Filters" hidden');
    expect(html).toContain('data-view="usage"');
    expect(html).toContain('id="usage-panel"');
    expect(source).toContain("function renderUsagePanel(");
    expect(source).toContain("setLookbackHours");
    expect(styles).not.toContain("@keyframes forage");
    expect(styles).not.toMatch(/\.colony\b/);
    expect(source).not.toContain('text: "Call tokens"');
    expect(source).not.toContain('+ " tok"');
  });

  test("reduced motion still disables the remaining interface transitions", () => {
    const reduced = styles.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(reduced).toContain("animation: none");
    expect(reduced).toContain("transition: none");
  });

  test("base type stays readable and the parchment slop layer is gone", () => {
    expect(styles).toMatch(/body\s*\{[\s\S]*?font-size:\s*16px/);
    expect(styles).not.toContain("background-image: url");
  });

  test("the strip stacks to one cell per row on mobile; customization stays touch-sized", () => {
    const mobile = styles.match(/@media \(max-width: 720px\)\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(mobile).toContain(".rail-inner .reading { flex: 1 1 100%; border-right: 0; padding-right: 0; }");
    expect(mobile).toContain(".widget-options { grid-template-columns: 1fr; }");
    expect(mobile).toContain(".widget-option { min-height: 2.8rem; }");
    expect(mobile).toContain(".widget-move { width: 2.75rem; height: 2.75rem; }");
    expect(styles).toContain(".widget-move");
  });

  /* W4-B: was ten source substrings. They could not fail if a "Triage" click
     started a run, so the separation — the whole point of the read-only gate —
     is now asserted from the routes the buttons actually call. */
  test("interventions separate recommendation, queueing, and explicit read-only launch", async () => {
    const issue = { id: "system:x", kind: "system", severity: "error", title: "T", summary: "s", affectedAgentIds: [] };
    const plan = {
      issueId: issue.id, generatedAt: "2026-07-22T03:00:00.000Z", mode: "investigation",
      headline: "H", rationale: "R", affectedAgents: 2, affectedPrograms: 1, providers: ["codex"],
      evidence: [], steps: [{ title: "s1", detail: "d1" }], queueRecommended: true,
    };

    // Triage asks for a recommendation and NOTHING else runs.
    await withState({
      snap: snapshot({ issues: [issue] }), conn: "live",
      triage: new Map(), triagePending: new Set(), triageErrors: new Map(), queueItems: [],
    }, async () => {
      await withRequests([
        { status: 200, json: { ok: true, recommendation: { ...plan, queueRecommended: false } } },
      ], async (calls) => {
        await M.triageIssue(issue.id, "generate");
        expect(calls.map((c) => c.url)).toEqual(["/api/triage/generate"]);
        expect(calls[0]!.body).toEqual({ issueId: issue.id });
        expect(M.state.triage.get(issue.id).headline).toBe("H");
        expect(M.state.queueItems).toEqual([]);
      });
    });

    // Queueing is bounded and persistent; it still does not launch anything.
    await withState({
      snap: snapshot({ issues: [issue] }), conn: "live",
      triage: new Map([[issue.id, plan]]), triagePending: new Set(), triageErrors: new Map(), queueItems: [],
    }, async () => {
      await withRequests([
        { status: 200, json: { ok: true, item: { ...plan, id: "triage:" + issue.id, state: "queued", createdAt: plan.generatedAt } } },
        { status: 200, json: snapshot({ issues: [issue] }) },
        { status: 200, json: { ok: true, items: [{ ...plan, id: "triage:" + issue.id, state: "queued", createdAt: plan.generatedAt }] } },
      ], async (calls) => {
        await M.triageIssue(issue.id, "queue");
        expect(calls.map((c) => c.url)).toEqual(["/api/triage/queue", "/api/snapshot", "/api/triage/queue"]);
        expect(M.state.queueItems.map((i: any) => i.state)).toEqual(["queued"]);
      });
    });

    // Only the explicit Launch reaches /api/triage/run.
    await withState({
      snap: snapshot({ issues: [issue] }), conn: "live",
      triage: new Map([[issue.id, plan]]), triagePending: new Set(), triageErrors: new Map(),
      queueItems: [{ ...plan, id: "triage:" + issue.id, state: "queued", createdAt: plan.generatedAt }],
    }, async () => {
      await withRequests([
        { status: 200, json: { ok: true, item: { ...plan, id: "triage:" + issue.id, state: "running", createdAt: plan.generatedAt, runModel: "GPT-5.6 Luna · XHIGH · read-only" } } },
        { status: 200, json: snapshot({ issues: [issue] }) },
        { status: 200, json: { ok: true, items: [] } },
      ], async (calls) => {
        await M.triageIssue(issue.id, "run");
        expect(calls[0]!.url).toBe("/api/triage/run");
        expect(calls[0]!.method).toBe("POST");
      });
    });

    // No spawn/execute route was ever invented for this.
    expect(source).not.toMatch(/\/api\/triage\/(spawn|execute)/);
  });

  test("the ham-fisted Subdue/Show buttons and ticket ticker are gone", () => {
    expect(html).not.toContain("Subdue");
    expect(html).not.toContain("Show interventions");
    expect(html).not.toContain("Show advisories");
    expect(html).not.toContain('id="interventions-ticker"');
    expect(html).not.toContain('id="warnings-ticker"');
    expect(html).not.toContain('class="signal-collapse"');
    expect(source).not.toContain("function buildSignalTicker(");
    expect(source).not.toContain("SIGNAL_PANEL_STORAGE_KEY");
    expect(source).not.toContain("loadSignalPanels(");
    expect(styles).not.toContain("@keyframes signal-ticker-run");
    expect(styles).not.toContain(".signal-ticker");
    expect(styles).not.toContain(".signal-subdued");
  });

  test("resolved lifecycle beats a blocked queue row for the finding label", () => {
    const issue = {
      id: "system:cleared",
      kind: "system",
      severity: "warning",
      title: "Cleared advisory",
      summary: "Gone.",
      affectedAgentIds: [],
      lifecycle: { state: "resolved", openedAt: "2026-07-21T22:00:00.000Z", resolvedAt: "2026-07-21T23:00:00.000Z" },
    };
    const blockedQueue = [{ issueId: issue.id, state: "blocked", headline: "stale" }];
    expect(M.issueWorkState(issue, blockedQueue)).toEqual({
      key: "cleared", label: "Cleared", tone: "moss",
    });
    expect(M.issueStateLabel(issue)).toBe("Resolved");
    expect(M.issueStage(issue)).toBe(4);
  });

  test("live blocked findings still show Blocked, and a queued/running investigation moves an issue in motion", () => {
    const issue = {
      id: "system:live-blocked",
      kind: "system",
      severity: "warning",
      title: "Needs a decision",
      summary: "s",
      affectedAgentIds: [],
      lifecycle: { state: "open", openedAt: "2026-07-21T22:00:00.000Z" },
    };
    expect(M.issueWorkState(issue, [{ issueId: issue.id, state: "blocked", headline: "blocked" }])).toEqual({
      key: "blocked", label: "Blocked", tone: "error",
    });
    expect(M.issueStage("blocked")).toBe(3);
    expect(M.issueWorkState(issue, [{ issueId: issue.id, state: "running" }]).key).toBe("investigating");
    expect(M.issueWorkState(issue, [{ issueId: issue.id, state: "queued" }]).key).toBe("queued");
  });

  test("signal chrome uses techno-orchestra tokens, not hospital banner fills", () => {
    expect(styles).toContain('"Techno orchestra"');
    expect(styles).toContain("--signal-rail: 2px");
    expect(styles).toContain(".glyph.act");
    expect(styles).not.toMatch(/#warnings-list\.signal-list\s*\{[^}]*background:\s*color-mix\(in srgb,\s*var\(--amber-soft\)/);
  });
});

describe("pulse strip — verdict-first summary", () => {
  test("the verdict button and calm line carry the markup the strip depends on", () => {
    expect(html).toContain('<div id="pulse-findings" hidden></div>');
    expect(source).toContain('class: valueClass + " pulse-verdict"');
    expect(source).toContain('"aria-expanded": String(state.pulseExpanded)');
    expect(source).toContain('"aria-controls": "pulse-findings"');
    expect(source).toContain('dataset: { fkey: "pulse-verdict" }');
    expect(source).toContain("onclick: togglePulseFindings");
    expect(source).toContain('class: "pulse-calm", role: "status"');
    expect(source).toContain("function renderPulseCalm(");
    expect(source).toContain("function renderHealthRail(");
  });

  test("pulseStripModel collapses to calm only when nothing needs the operator", () => {
    expect(M.pulseStripModel(snapshot(), "live", []).calm).toBe(true);

    const withIssue = snapshot({
      issues: [{ id: "e", kind: "system", severity: "error", title: "t", summary: "s", affectedAgentIds: [] }],
    });
    expect(M.pulseStripModel(withIssue, "live", []).calm).toBe(false);

    const degradedControl = snapshot({ controlHealth: { cmuxReachable: false, lastCheckedAt: "", errors: [], staleSources: [] } });
    expect(M.pulseStripModel(degradedControl, "live", []).calm).toBe(false);

    const hotContext = snapshot({
      programs: [{
        id: "p", name: "P",
        agents: [agent({ tokens: { provenance: "observed", scope: "latest-turn", total: 190_000, contextWindow: 200_000 } })],
      }],
    });
    expect(M.pulseStripModel(hotContext, "live", []).calm).toBe(false); // 95% peak context is hot

    expect(M.pulseStripModel(null, "live", []).calm).toBe(false);
  });

  test("ordered findings put true interventions and advisories ahead of in-motion work", () => {
    const verifyingError = {
      id: "e-verifying", kind: "system", severity: "error", title: "Verifying error", summary: "s",
      affectedAgentIds: [],
      lifecycle: { state: "verifying", openedAt: "2026-07-22T05:00:00.000Z", verificationStartedAt: "2026-07-22T05:01:00.000Z" },
    };
    const openError = { id: "e-open", kind: "system", severity: "error", title: "Open error", summary: "s", affectedAgentIds: [] };
    const advisory = { id: "w-open", kind: "system", severity: "warning", title: "Open advisory", summary: "s", affectedAgentIds: [] };
    const snap = snapshot({ issues: [verifyingError, openError, advisory] });

    const model = M.pulseStripModel(snap, "live", []);
    expect(model.findings.map((f: { id: string }) => f.id)).toEqual(["e-open", "w-open", "e-verifying"]);
    expect(model.findings.map((f: { work: { key: string } }) => f.work.key)).toEqual(["needs", "watching", "verifying"]);

    // An in-motion error must never surface in the needs-you top-2 sublabel —
    // that would contradict the strip's own "in motion" classification.
    const data = M.summaryWidgetData("needs-you", snap);
    expect(data.sublabel).toBe("Open error · Open advisory");
  });

  test("orphan queue items referencing a resolved issue are excluded; live orphans are included", () => {
    const snap = snapshot({
      issues: [],
      recentlyResolved: [
        {
          id: "system:gone", kind: "system", severity: "error", title: "Gone", summary: "s",
          affectedAgentIds: [],
          lifecycle: { state: "resolved", openedAt: "2026-07-21T22:00:00.000Z", resolvedAt: "2026-07-21T23:00:00.000Z" },
        },
      ],
    });
    const model = M.pulseStripModel(snap, "live", [
      { issueId: "system:gone", state: "blocked", headline: "stale" },
      { issueId: "queue:orphan", state: "blocked", headline: "orphan investigation" },
    ]);
    expect(model.findings.map((f: { id: string }) => f.id)).toEqual(["queue:orphan"]);
  });

  test("the strip renders findings and widgets with no board-level triage CTAs — triage stays drawer-only", () => {
    const pulseFindingsPanel = source.match(/function renderPulseFindings\([\s\S]*?\n\}\n/)?.[0] ?? "";
    const summaryWidget = source.match(/function renderSummaryWidget\([\s\S]*?\n\}\n/)?.[0] ?? "";
    const pulseCalm = source.match(/function renderPulseCalm\([\s\S]*?\n\}\n/)?.[0] ?? "";
    const findingRow = source.match(/function renderFindingRow\([\s\S]*?\n\}\n/)?.[0] ?? "";
    expect(pulseFindingsPanel).toBeTruthy();
    expect(summaryWidget).toBeTruthy();
    expect(pulseCalm).toBeTruthy();
    expect(findingRow).toBeTruthy();
    for (const chunk of [pulseFindingsPanel, summaryWidget, pulseCalm, findingRow]) {
      expect(chunk).not.toContain("triageIssue(");
      expect(chunk).not.toContain('"Triage this finding"');
      expect(chunk).not.toContain('"Queue investigation"');
      expect(chunk).not.toContain("renderTriage(");
    }
    expect(findingRow).toContain('selectEntity({ kind: finding.kind, id: finding.id })');
  });

  test("strip CSS binds to the DOM app.js actually builds", () => {
    // The expansion panel carries only the id (the markup is a fixed contract),
    // so a class selector would never bind — the panel must be styled by id.
    expect(styles).toMatch(/#pulse-findings\s*\{/);
    expect(styles).not.toMatch(/\.pulse-findings\s*\{/);
    // app.js drops the one-shot pulse-cleared class on the rail, so the moss
    // wash must reach the calm line through the rail, not expect the class
    // on the (rebuilt-each-paint) calm line itself.
    expect(source).toContain('rail.classList.add("pulse-cleared")');
    expect(styles).toMatch(/\.health-rail\.pulse-cleared \.pulse-calm/);
    // svgSparkline emits only a viewBox (CSP: no inline styles); without a CSS
    // size the SVG falls back to the 300×150 default and breaks the calm line.
    expect(styles).toMatch(/\.pulse-spark\s*\{[^}]*width/);
  });
});

describe("state cards — two-line ledger rows, instrument brief, verdict result (mockups A2/B1/C1)", () => {
  test("strip findings carry the ledger row data: summary, evidence tokens, and an honest since", () => {
    const life = { state: "verifying", openedAt: "2026-07-23T03:00:00.000Z", verificationStartedAt: "2026-07-23T04:15:00.000Z" };
    const snap = snapshot({
      issues: [{
        id: "sys:1", kind: "system", severity: "warning", title: "Routing mismatch",
        summary: "4 ended Cursor sessions used a different model than expected.",
        affectedAgentIds: ["codex:a1"], lifecycle: life,
      }],
    });
    const model = M.pulseStripModel(snap, "live", []);
    const finding = model.findings[0];
    expect(finding.summary).toBe("4 ended Cursor sessions used a different model than expected.");
    // Evidence = program rollup tokens, derived from real affected agents.
    expect(finding.evidence).toEqual(["P · 1"]);
    // Verification start outranks openedAt; no timestamp means no fabricated age.
    expect(finding.since).toBe("2026-07-23T04:15:00.000Z");
    const bare = snapshot({ issues: [{ id: "sys:2", kind: "system", severity: "warning", title: "T", summary: "s", affectedAgentIds: [] }] });
    expect(M.pulseStripModel(bare, "live", []).findings[0].since).toBeNull();
  });

  test("routeFromBullet extracts evidence routing and refuses prose", () => {
    expect(M.routeFromBullet("`542577F9…` → `ttys003`")).toEqual({ from: "542577F9…", to: "ttys003" });
    expect(M.routeFromBullet("8C3BB027… -> ttys005")).toEqual({ from: "8C3BB027…", to: "ttys005" });
    // Prose containing an arrow mid-sentence, chained arrows, and empty sides stay bullets.
    expect(M.routeFromBullet("The launcher moved a → b and then failed on c")).toBeNull();
    expect(M.routeFromBullet("a → b → c")).toBeNull();
    expect(M.routeFromBullet("→ ttys003")).toBeNull();
    expect(M.routeFromBullet("x".repeat(130) + " → y")).toBeNull();
  });

  test("the plan renders as an always-visible spine — the details disclosure is gone", () => {
    const triage = source.match(/function renderTriage\([\s\S]*?\n\}\n/)?.[0] ?? "";
    expect(triage).toContain('"tri-spine"');
    expect(triage).toContain('"tri-band"');
    expect(triage).not.toContain("-step plan");
    // The band never invents instruments: model/effort/access appear only
    // when the launcher reported runModel.
    expect(triage).toContain("queueItem.runModel");
    /* FE-B: a reload mid-investigation must not regress to the Triage button —
       the queue item itself hydrates the recommendation. Asserted by rendering
       with an empty local triage map and only a queue row, as a reload leaves it. */
    const issue = { id: "system:1", kind: "system", severity: "error", title: "t", summary: "s", affectedAgentIds: [] };
    const queueItem = {
      issueId: "system:1", state: "running", headline: "Re-bind the quarantined sessions",
      mode: "investigate", rationale: "Two sessions share a terminal.",
      steps: [{ title: "Read", detail: "Inspect the trace." }],
      queueRecommended: true, runModel: "luna 5.6 · high", createdAt: "2026-07-28T01:00:00.000Z",
      startedAt: "2026-07-28T01:01:00.000Z",
    };
    const rendered = withDom(() => M.renderTriage(issue, triageUi({ queueItems: [queueItem] })));
    const text = textOf(rendered);
    expect(text).not.toContain("Triage this finding");
    expect(text).toContain("Re-bind the quarantined sessions");
    expect(byClass(rendered, "tri-spine")).not.toBeNull();
    // Both queue-row controls carry a data-fkey so focus survives a repaint.
    const keys = buttonsOf(rendered).map((b) => b.dataset.fkey);
    expect(keys).toContain("triage-queue:system:1");
    expect(keys.every(Boolean)).toBe(true);
  });

  test("state-card CSS binds to the DOM app.js builds, and the replaced chrome is gone", () => {
    for (const selector of [".finding .lede", ".finding .gist", ".finding .trace", ".finding .meta",
      ".finding .state.st-hot", ".tri-band", ".tri-spine", ".tri-dot", ".brf-head", ".brf-glyph",
      ".brf-routes", ".brf-route", ".brf-times"]) {
      expect(styles).toContain(selector);
    }
    for (const dead of [".triage-plan-head", ".triage-mode", ".triage-details", ".triage-steps",
      ".triage-briefing-kicker "]) {
      expect(styles).not.toContain(dead);
    }
  });
});

describe("single lock narrative in the agent drawer", () => {
  test("the banner owns the lock reason; the dock meta never repeats it", () => {
    const dockStart = source.indexOf("function renderCommandDock(");
    const dockEnd = source.indexOf("\nfunction renderDockTool(", dockStart);
    const dock = source.slice(dockStart, dockEnd);
    expect(dock).not.toContain("Send disabled");
    expect(dock).toContain('"Ready · linked"');
    expect(dock).toContain("command-dock--linked");
    // The ⌘↵ hint renders only when Send can actually send.
    expect(dock).toContain("instructCap && instructCap.enabled");
    // Control feedback lives inside the dock, above the composer.
    expect(dock).toContain("control-feedback");
    // Archive is demoted under More when Send/Focus are locked.
    expect(dock).toContain("command-dock-more");
    expect(styles).toContain(".command-dock--linked");
  });
});

describe("investigation briefings lead with one wired action", () => {
  /* W4-B: was six source substrings that could not fail if the CTA stopped
     being rendered. Driven now through renderTriage, which is how a finished
     investigation actually reaches the drawer. */
  test("blocked and verifying results expose a primary button, not prose only", () => {
    const issue = { id: "system:x", kind: "system", severity: "error", title: "T", summary: "s", affectedAgentIds: [] };
    const item = (state: string, result: string) => ({
      issueId: issue.id, id: "triage:system:x", generatedAt: "2026-07-22T03:00:00.000Z",
      mode: "investigation", headline: "H", rationale: "R", affectedAgents: 1, affectedPrograms: 1,
      providers: ["codex"], evidence: [], steps: [{ title: "s1", detail: "d1" }],
      queueRecommended: true, createdAt: "2026-07-22T03:00:00.000Z",
      startedAt: "2026-07-22T03:01:00.000Z", completedAt: "2026-07-22T03:09:00.000Z",
      state, result,
    });
    const render = (state: string, result: string) => withDom(() => M.renderTriage(
      issue, triageUi({ queueItems: [item(state, result)], triage: new Map([[issue.id, item(state, result)]]) })));

    // Blocked: the operator gets a lever, not a paragraph to read and abandon.
    const blocked = render("blocked", "Blocker: the cmux socket password is missing, so nothing could be probed.");
    expect(buttonsOf(blocked).map((b: any) => textOf(b))).toContain("Retriage from evidence");
    // Completed: the next act is confirming the finding actually cleared.
    const done = render("completed", "Root cause: two sessions shared one TTY. Repair applied.");
    expect(buttonsOf(done).map((b: any) => textOf(b))).toContain("Check source now");

    // The briefing is capped — a wall of bullets is prose again. Ten bullets in,
    // at most three reach the body, and the count is stated rather than dropped.
    const raw = ["Findings:", ...Array.from({ length: 10 }, (_, index) => `- bullet ${index}`)].join("\n");
    const many = render("completed", raw);
    const shown = allByClass(many, "triage-briefing-list")
      .flatMap((list: any) => list.children)
      .filter((item: any) => textOf(item).startsWith("bullet ")).length;
    expect(shown).toBeLessThanOrEqual(3);
    expect(shown).toBeGreaterThan(0);
    // Capping the body must never DROP evidence: the full text is still there.
    expect(textOf(many)).toContain(raw);
  });
});

describe("fail-loud control invariants (source-level)", () => {
  /* W4-B: was `expect(source).toContain('const NEEDS_CONFIRM = ...')`, which
     could not fail if the gate were removed from the click handler. Now the
     real dock tool is clicked and the real sendControl is watched. */
  test("interrupt and archive require explicit confirmation", async () => {
    const target = agent({ controls: [{ action: "interrupt", enabled: true }, { action: "focus", enabled: true }] });
    const snap = snapshot({ programs: [{ id: "p", name: "P", agents: [target] }] });

    await withState({ snap, conn: "live", confirming: null, pending: new Set(), feedback: new Map() }, async () => {
      await withRequests([{ status: 200, json: { ok: true } }], async (calls) => {
        const tool = M.renderDockTool(target, { action: "interrupt", enabled: true }, "interrupt", { held: false });
        // The first click must arm a confirmation, not send anything.
        await fire(tool);
        expect(calls).toHaveLength(0);
        expect(M.state.confirming).toBe("act:" + target.id + ":interrupt");

        // The armed strip is what actually sends.
        const strip = M.renderDockTool(target, { action: "interrupt", enabled: true }, "interrupt", { held: false });
        const confirm = buttonsOf(strip).find((b: any) => textOf(b) === "Confirm");
        expect(confirm).toBeDefined();
        await fire(confirm);
        expect(calls.map((c) => [c.method, c.url])).toEqual([["POST", "/api/control"]]);
        expect(calls[0]!.body).toMatchObject({ action: "interrupt", agentId: target.id });
      });
    });

    // Focus is NOT gated — a confirmation on every button is a confirmation on none.
    await withState({ snap, conn: "live", confirming: null, pending: new Set(), feedback: new Map() }, async () => {
      await withRequests([{ status: 200, json: { ok: true } }], async (calls) => {
        const tool = M.renderDockTool(target, { action: "focus", enabled: true }, "focus", { held: false });
        await fire(tool);
        expect(M.state.confirming).toBeNull();
        expect(calls.map((c) => c.body.action)).toEqual(["focus"]);
      });
    });
  });

  /* W4-B: was two source substrings. A server that answers `200 {}` (or HTML,
     or `200 {ok:false}`) must never be recorded as a success — that is the
     whole invariant, and it is now asserted from the feedback the drawer
     actually renders. */
  test("HTTP completion alone is never treated as control success", async () => {
    const target = agent();
    const snap = snapshot({ programs: [{ id: "p", name: "P", agents: [target] }] });
    const outcomes: Array<[FakeReply, boolean, string]> = [
      [{ status: 200, json: { ok: true } }, true, "succeeded"],
      [{ status: 200, json: {} }, false, "unexpected response"],
      [{ status: 200, json: { ok: false, error: { code: "CMUX_FAILED", message: "no pane" } } }, false, "CMUX_FAILED"],
      [{ status: 200 }, false, "unexpected response"], // 200 with a non-JSON body
    ];
    for (const [reply, ok, fragment] of outcomes) {
      await withState({ snap, conn: "live", pending: new Set(), feedback: new Map(), drafts: new Map() }, async () => {
        await withRequests([reply], async () => {
          await M.sendControl(target, "instruct", "go");
          const recorded = M.state.feedback.get(target.id);
          expect(recorded.ok, JSON.stringify(reply)).toBe(ok);
          expect(recorded.message).toContain(fragment);
        });
      });
    }
  });

  test("no dynamic content flows through innerHTML", () => {
    const payload = '<img src=x onerror="globalThis.pwned=true">';
    const node = withDom(() => M.el("p", { text: payload }));
    expect(textOf(node)).toBe(payload);
    expect(node.children).toHaveLength(0);
    expect(source).not.toMatch(/\.innerHTML\s*=/);
  });

  test("drawer omits empty fields instead of filler absences", () => {
    expect(source).toContain("if (value == null || value === \"\") return;");
    expect(source).not.toContain('absent: "not reported"');
    expect(source).not.toContain('absent: "not evaluated"');
    expect(source).not.toContain('absent: "none"');
    // FE-B: cost/tests/gates are never filler rows in the drawer body — asserted
    // by rendering the panels with all three present and reading the output,
    // rather than by matching source text between landmark function names.
    const loaded = agent({
      cost: { totalUsd: 12.3456, provenance: "observed" },
      tests: { passing: 7, failing: 1 },
      gates: ["needs-review"],
      lastHumanMessage: "ship the fix",
      lastAgentMessage: "pushed",
      transcriptTail: "tail",
    });
    const panels = panelTexts(loaded);
    for (const [where, text] of Object.entries(panels)) {
      expect(text, where + " must not render a cost row").not.toContain("12.34");
      expect(text, where + " must not render a $ figure").not.toContain("$");
    }
    expect(panels.chat).not.toContain("needs-review");
    expect(panels.chat).not.toContain("passing");
  });
});

describe("Take A agent drawer — Operate · Chat · Evidence", () => {
  test("bookshelf shelf replaces tabs: Operate + Chat open, Evidence behind the caterpillar rail", () => {
    // No tab dance — the drawer is a horizontal shelf.
    expect(source).not.toContain("inspectorTabButton(");
    expect(source).toContain('class: "drawer-shelf"');
    expect(source).toContain('key: "operate"');
    expect(source).toContain('key: "chat"');
    expect(source).toContain("renderEvidenceShelf(agent)");
    // Evidence is opt-in: collapsed caterpillar rail until the cog opens it.
    expect(source).toContain("evidenceOpen: false");
    expect(source).toContain('class: "shelf-evidence-rail"');
    // B3: metrics are promoted to the instrument band under the verdict head —
    // Evidence no longer builds vitals (neither the old call nor the band), and
    // Operate never did.
    const evidenceShelf = requiredSlice(
      source,
      /function renderEvidenceShelf\([\s\S]*?\n}\n/,
      "renderEvidenceShelf",
    );
    expect(evidenceShelf).not.toContain("renderVitals(agent)");
    expect(evidenceShelf).not.toContain("renderVitalsBand(agent)");
    const operate = requiredSlice(source, /function renderOperate\([\s\S]*?\n}\n/, "renderOperate");
    expect(operate).not.toContain("renderVitals(");
    expect(operate).not.toContain("renderVitalsBand(");
    expect(styles).toContain(".drawer-shelf {");
    expect(styles).toContain(".shelf-evidence-rail {");
    // Widescreen split: roster rail ~40%, drawer ~60%.
    expect(styles).toContain("body.inspector-open .pane-list");
    expect(styles).toContain("flex: 0 0 clamp(380px, 40%, 760px)");
  });

  test("Names rename UI stays collapsed under a disclosure", () => {
    expect(source).toContain("function renderNamesDisclosure(");
    expect(source).toContain('el("summary", { text: "Names" })');
    expect(source).toContain('class: "names-disclosure"');
    expect(source).not.toContain('text: "Presentation labels"');
    expect(styles).toContain(".names-disclosure");
    // FE-B: Names live in Evidence, not always-on chrome above the shelf —
    // asserted against the rendered drawer, not against source adjacency.
    const named = agent({ cwd: "/repos/x" });
    const program = { id: "p", name: "P", agents: [named] };
    const drawer = withDom(() => {
      const pane = newNode("div");
      M.renderAgentDrawer(pane, { kind: "agent", agent: named, program });
      return pane;
    });
    // Evidence is collapsed by default, so the rename disclosure is not on screen.
    expect(byClass(drawer, "names-disclosure")).toBeNull();
    expect(byClass(drawer, "shelf-evidence-rail")).not.toBeNull();
    // …and it IS what Evidence carries once opened.
    const evidence = withDom(() => M.renderEvidence(named));
    expect(byClass(evidence, "names-disclosure")).not.toBeNull();
    expect(withDom(() => M.renderNamesDisclosure(named))).not.toBeNull();
  });

  test("Evidence carries Learn-style tooltips for cwd mismatch and token scope", () => {
    const evidence = withDom(() => M.renderEvidence(agent({
      cwd: "/repos/session",
      target: {
        resolution: "exact",
        workspaceId: "WORKSPACE-1",
        surfaceId: "SURFACE-1",
        paneId: "PANE-1",
        workspaceTitle: "Ridge",
        surfaceCwd: "/repos/pane",
        cwdMismatch: true,
      },
      tokens: {
        provenance: "observed",
        scope: "latest-turn",
        input: 100,
        output: 25,
        total: 125,
        sessionTotal: 2_000,
      },
    })));
    const hints = findAll(evidence, (node) => typeof node.attributes?.title === "string")
      .map((node) => node.attributes.title);
    expect(hints).toContain(
      "Session cwd ≠ pane folder: the provider session working directory disagrees with the cmux terminal pane folder (common when the process started in ~ and the shell later moved).",
    );
    expect(hints).toContain(
      "Tokens for the latest model call only — not the cumulative session total.",
    );
    expect(hints).toContain(
      "Cumulative tokens for this whole session. Differs from “latest call,” which is only the most recent invocation.",
    );
    expect(textOf(evidence)).toContain("Linked to terminal: Ridge for Focus and Send");
    expect(textOf(evidence)).toContain("session cwd ≠ pane folder");
    expect(buttonsOf(evidence).map((button) => button.attributes.title)).toEqual([
      "WORKSPACE-1",
      "SURFACE-1",
      "PANE-1",
    ]);
  });

  test("Operate shows task only when meaningfully different from the human message", () => {
    // FE-B: rendered, not grepped. A task that merely restates the human message
    // earns no second heading; a genuinely different one does.
    const echoed = agent({ lastHumanMessage: "rebuild the collector", task: "Rebuild the collector." });
    const distinct = agent({ lastHumanMessage: "rebuild the collector", task: "Port the SEM forecast rate limiter", model: "claude-opus-4-8" });
    expect(M.taskMeaningfullyDifferent(echoed)).toBe(false);
    expect(M.taskMeaningfullyDifferent(distinct)).toBe(true);
    const echoedPanel = withDom(() => M.renderOperate(echoed, { id: "p", name: "P", agents: [] }));
    expect(textOf(echoedPanel)).not.toContain("Task");
    const distinctPanel = withDom(() => M.renderOperate(distinct, { id: "p", name: "P", agents: [] }));
    expect(textOf(distinctPanel)).toContain("Task");
    expect(textOf(distinctPanel)).toContain("Port the SEM forecast rate limiter");
    // Operate still carries the identity meta row (role/model), not vitals.
    expect(byClass(distinctPanel, "operate-meta")).not.toBeNull();
    expect(textOf(byClass(distinctPanel, "operate-meta"))).toContain("opus 4.8");
  });
});

describe("verdict head — act from the top (B2)", () => {
  /* Brace-counted extraction, not a landmark regex: it walks from the
     signature's opening `{` to its true matching `}` by depth, so it can
     never stop early at a column-0 `}` that belongs to nested content, and
     it never depends on whatever function/comment happens to follow —
     inserting a new top-level helper anywhere else in the file cannot
     truncate or widen the body it returns. */
  function extractFunctionBody(signature: string): string {
    const start = source.indexOf(signature);
    if (start === -1) return "";
    const braceStart = source.indexOf("{", start);
    if (braceStart === -1) return "";
    let depth = 0;
    for (let i = braceStart; i < source.length; i++) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return source.slice(start, i + 1);
      }
    }
    return "";
  }
  const agentDrawer = () => extractFunctionBody("function renderAgentDrawer(pane, view) {");

  test("drawer order: verdict head → banner → next action → vitals mount → shelf → lineage → dock", () => {
    const drawer = agentDrawer();
    expect(drawer).toBeTruthy();
    const headAt = drawer.indexOf("inspector-head inspector-verdict");
    const bannerAt = drawer.indexOf("renderControlBanner(agent, control)");
    const nextAt = drawer.indexOf('class: "next-action"');
    const vitalsAt = drawer.indexOf('class: "inspector-vitals"');
    const shelfAt = drawer.indexOf('class: "drawer-shelf"');
    const lineageAt = drawer.indexOf("renderLineageSpine(agent)");
    const dockAt = drawer.indexOf("renderCommandDock(agent, control)");
    for (const at of [headAt, bannerAt, nextAt, vitalsAt, shelfAt, lineageAt, dockAt]) {
      expect(at).toBeGreaterThan(-1);
    }
    // The banner stays state, pinned immediately after the head.
    expect(bannerAt).toBeGreaterThan(headAt);
    // Next action directly under the head; the vitals mount (B3's slot) sits
    // between next-action and the Operate | Chat shelf.
    expect(nextAt).toBeGreaterThan(bannerAt);
    expect(vitalsAt).toBeGreaterThan(nextAt);
    expect(shelfAt).toBeGreaterThan(vitalsAt);
    // Lineage is demoted below the shelf — context, not action — and the
    // command dock stays pinned at the bottom.
    expect(lineageAt).toBeGreaterThan(shelfAt);
    expect(dockAt).toBeGreaterThan(lineageAt);
    // The empty mount must not spend a flex gap until B3 fills it.
    expect(styles).toContain(".inspector-vitals:empty { display: none; }");
  });

  test("the head carries the gate chip and one primary-action control", () => {
    const drawer = agentDrawer();
    const head = drawer.slice(0, drawer.indexOf("renderControlBanner(agent, control)"));
    expect(head).toContain("verdictGate(");
    expect(head).toContain("headPrimaryAction(");
    // headPrimaryAction reuses the dock's derivation — capability() +
    // renderDockTool() — never a duplicated action implementation.
    const headFn = source.match(/function headPrimaryAction\([\s\S]*?\n\}\n/)?.[0] ?? "";
    expect(headFn).toContain('capability(agent, "focus")');
    expect(headFn).toContain("renderDockTool(");
    // The gate is ember ink + outline, never a filled banner.
    const gateCss = styles.match(/\.verdict-gate\s*\{[^}]*\}/)?.[0] ?? "";
    expect(gateCss).toContain("border: 1px solid color-mix(in srgb, var(--ember)");
    expect(gateCss).toContain("color: var(--ember)");
    expect(gateCss).toContain("background: none");
    // Touch sweep: the head action clears 44px below 1024px.
    const after = styles.slice(styles.indexOf("@media (max-width: 1024px)"));
    const block = after.slice(0, after.indexOf("@media (max-width: 720px)"));
    expect(block).toContain(".verdict-action .dock-tool");
  });

  test("head de-noising: one quiet source line, full sentence in the tooltip", () => {
    const drawer = agentDrawer();
    // The three-way naming ternary collapsed into a single render.
    expect((drawer.match(/inspector-source-name/g) || []).length).toBe(1);
    expect(drawer).toContain("quietSourceLine(agent)");
    expect(drawer).toContain("fullSourceDetail(agent)");
    expect(drawer).not.toContain('session cwd ≠ pane folder"');
    // The mismatch state keeps a visible ember mark on the quiet line.
    expect(styles).toMatch(/\.inspector-source-name\.is-mismatch::before\s*\{[^}]*var\(--ember\)/);
  });

  test("quietSourceLine goes quiet when the terminal title is the shown name; the mismatch sentence moves to fullSourceDetail", () => {
    // Terminal title IS the display name → no source line at all.
    const matching = agent({ target: { resolution: "exact", surfaceId: "s1", workspaceId: "w1", workspaceTitle: "ridge-pane" } });
    expect(M.quietSourceLine(matching)).toBeNull();
    expect(M.fullSourceDetail(matching)).toBeNull();

    // cwd mismatch → the quiet line is short; the explanation lives in the tooltip.
    const mismatched = agent({
      cwd: "/Users/op",
      target: { resolution: "exact", surfaceId: "s1", workspaceId: "w1", workspaceTitle: "ridge-pane", cwdMismatch: true },
    });
    expect(M.quietSourceLine(mismatched)).toBe("Terminal: ridge-pane");
    expect(M.quietSourceLine(mismatched)).not.toContain("≠");
    expect(M.fullSourceDetail(mismatched)).toContain("Terminal: ridge-pane");
    expect(M.fullSourceDetail(mismatched)).toContain("Session cwd ≠ pane folder");

    // No terminal title, no custom name → still quiet.
    expect(M.quietSourceLine(agent())).toBeNull();
  });
});

describe("B2 review fixes — instance-scoped head keys + executable head logic", () => {
  /* app.js is imported without a document (DOM wiring stays un-booted), but
     headPrimaryAction/verdictGate build real nodes via el()/icon(). A minimal
     fake document, installed only around each call, lets the tests execute the
     actual helpers and assert on the returned nodes. */
  function fakeDom() {
    const make = (tag: string) => ({
      nodeType: 1,
      tagName: tag,
      className: "",
      textContent: "",
      dataset: {} as Record<string, string>,
      attributes: {} as Record<string, string>,
      children: [] as unknown[],
      setAttribute(k: string, v: unknown) { this.attributes[k] = String(v); },
      addEventListener() {},
      append(...kids: unknown[]) { this.children.push(...kids); },
    });
    return {
      createElement: (t: string) => make(t),
      createElementNS: (_ns: string, t: string) => make(t),
      createTextNode: (s: string) => ({ nodeType: 3, textContent: String(s) }),
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function withDom<T>(fn: () => T): T {
    (globalThis as unknown as { document: unknown }).document = fakeDom();
    try { return fn(); } finally {
      delete (globalThis as unknown as { document?: unknown }).document;
    }
  }

  test("headPrimaryAction: safe-locked → null; focus leads; interrupt only as sole lever; both enabled → focus wins; absent → null", () => {
    const locked = agent({ controls: [
      { action: "focus", enabled: false, reason: "no route" },
      { action: "instruct", enabled: true },
      { action: "interrupt", enabled: true },
    ] });
    expect(withDom(() => M.headPrimaryAction(locked))).toBeNull();

    const focusReady = agent({ controls: [
      { action: "focus", enabled: true },
      { action: "instruct", enabled: true },
    ] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const focusTool: any = withDom(() => M.headPrimaryAction(focusReady));
    expect(focusTool).not.toBeNull();
    expect(focusTool.className).toContain("dock-tool");
    expect(focusTool.dataset.fkey).toBe("head:act:codex:a1:focus");

    const interruptOnly = agent({ controls: [{ action: "interrupt", enabled: true }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const interruptTool: any = withDom(() => M.headPrimaryAction(interruptOnly));
    expect(interruptTool).not.toBeNull();
    expect(interruptTool.dataset.fkey).toBe("head:act:codex:a1:interrupt");

    // Priority head-to-head: both focus and interrupt enabled at once — focus
    // must win, not just when interrupt is absent entirely.
    const bothEnabled = agent({ controls: [
      { action: "focus", enabled: true },
      { action: "interrupt", enabled: true },
    ] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bothTool: any = withDom(() => M.headPrimaryAction(bothEnabled));
    expect(bothTool).not.toBeNull();
    expect(bothTool.dataset.fkey).toBe("head:act:codex:a1:focus");

    expect(withDom(() => M.headPrimaryAction(agent({ controls: [] })))).toBeNull();
  });

  test("verdictGate: gate text with tooltip fallback; statusReason fallback; null when not blocked", () => {
    // Visible text from gates; statusReason empty → the tooltip carries the
    // gate text, never an empty title.
    const gated = agent({ gates: ["needs-review"], statusReason: "" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chip: any = withDom(() => M.verdictGate(gated, "blocked"));
    expect(chip).not.toBeNull();
    expect(chip.className).toBe("verdict-gate");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(chip.children.some((c: any) => c.textContent === "needs-review")).toBe(true);
    expect(chip.attributes.title).toBe("needs-review");

    // No gate → statusReason carries both the visible text and the tooltip.
    const reason = agent({ statusReason: "Blocked by CI gate on main." });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chip2: any = withDom(() => M.verdictGate(reason, "blocked"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(chip2.children.some((c: any) => c.textContent === "Blocked by CI gate on main.")).toBe(true);
    expect(chip2.attributes.title).toBe("Blocked by CI gate on main.");

    expect(withDom(() => M.verdictGate(agent(), "healthy"))).toBeNull();
  });

  test("cwd mismatch keeps its mark even when the shown name equals the terminal title", () => {
    const aliasLike = agent({
      nickname: "Ridge pane",
      target: { resolution: "exact", surfaceId: "s1", workspaceId: "w1", workspaceTitle: "Ridge pane", cwdMismatch: true },
    });
    expect(M.quietSourceLine(aliasLike)).toBe("Terminal: Ridge pane");
    expect(M.fullSourceDetail(aliasLike)).toContain("Session cwd ≠ pane folder");
    // Without the mismatch the same identity stays quiet.
    const calm = agent({
      nickname: "Ridge pane",
      target: { resolution: "exact", surfaceId: "s1", workspaceId: "w1", workspaceTitle: "Ridge pane" },
    });
    expect(M.quietSourceLine(calm)).toBeNull();
  });

  test("instance-scoped keys: head prefixes its fkeys; confirm strip and Escape bind to one instance", () => {
    const dockToolFn = source.match(/function renderDockTool\([\s\S]*?\n\}\n/)?.[0] ?? "";
    expect(dockToolFn).toContain('opts.fkeyPrefix || ""');
    // The confirm strip renders only for the instance that opened it.
    expect(dockToolFn).toContain("state.confirming === fkey");
    expect(dockToolFn).toContain("state.confirming = fkey");
    const headFn = source.match(/function headPrimaryAction\([\s\S]*?\n\}\n/)?.[0] ?? "";
    expect(headFn).toContain('fkeyPrefix: "head:"');
    // Escape restores focus to the exact instance fkey stored in state.confirming.
    expect(source).toContain('document.querySelector(`[data-fkey="${CSS.escape(key)}"]`)');
  });
});

describe("vitals instrument band (B3)", () => {
  /* Same DOM-less execution trick B2 used: a minimal fake document installed
     around each call lets renderVitalsBand build real nodes via el()/svg helpers,
     so tests assert on what actually renders — not merely on source substrings. */
  function fakeDom() {
    const make = (tag: string) => ({
      nodeType: 1,
      tagName: tag,
      className: "",
      textContent: "",
      dataset: {} as Record<string, string>,
      attributes: {} as Record<string, string>,
      children: [] as unknown[],
      setAttribute(k: string, v: unknown) { this.attributes[k] = String(v); },
      addEventListener() {},
      append(...kids: unknown[]) { this.children.push(...kids); },
    });
    return {
      createElement: (t: string) => make(t),
      createElementNS: (_ns: string, t: string) => make(t),
      createTextNode: (s: string) => ({ nodeType: 3, textContent: String(s) }),
    };
  }
  function withDom<T>(fn: () => T): T {
    (globalThis as unknown as { document: unknown }).document = fakeDom();
    try { return fn(); } finally {
      delete (globalThis as unknown as { document?: unknown }).document;
    }
  }
  // Walk the built node tree: collect el()-set classNames and concatenated text.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function classesOf(node: any, out: string[] = []): string[] {
    if (!node || typeof node !== "object") return out;
    if (typeof node.className === "string" && node.className) out.push(node.className);
    for (const kid of node.children || []) classesOf(kid, out);
    return out;
  }
  // el() writes leaf text via the `text:` attr (node.textContent) and multi-child
  // text via createTextNode kids; a node uses one or the other, so summing both
  // never double-counts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function textOf(node: any): string {
    if (!node || typeof node !== "object") return "";
    if (node.nodeType === 3) return String(node.textContent || "");
    let s = typeof node.textContent === "string" ? node.textContent : "";
    for (const kid of node.children || []) s += textOf(kid);
    return s;
  }

  test("(a) renderVitalsBand is exported and renders mono-classed values for a live agent", () => {
    expect(typeof M.renderVitalsBand).toBe("function");
    const live = agent({
      model: "gpt-5-codex",
      tokens: { provenance: "observed", scope: "latest-turn", total: 40000, contextWindow: 200000 },
      elapsedMs: 125000,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const band: any = withDom(() => M.renderVitalsBand(live));
    expect(band).not.toBeNull();
    expect(band.className).toContain("vitals");
    const classes = classesOf(band);
    // Values ride the canonical "vital-big mono" convention (DESIGN rule 2).
    expect(classes.some((c) => c.includes("vital-big") && c.includes("mono"))).toBe(true);
    // An observed context window renders a real SVG ring; uptime is present.
    expect(classes.some((c) => c.includes("vital-ring"))).toBe(true);
    const text = textOf(band);
    expect(text).toContain("40k"); // observed context total
    expect(text).toContain("2m");  // 125s uptime → fmtElapsed "2m"
  });

  test("(b) missing vitals render honest fallbacks — observed count without a fabricated window, omit-empty otherwise", () => {
    // Claude-style: observed total but NO context window → absolute count, never a
    // fabricated percentage/ring (no invented denominator).
    const noWindow = agent({
      provider: "claude",
      tokens: { provenance: "observed", total: 40000 },
      elapsedMs: undefined,
      updatedAt: undefined,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const band: any = withDom(() => M.renderVitalsBand(noWindow));
    expect(band).not.toBeNull();
    const classes = classesOf(band);
    expect(classes.some((c) => c.includes("vital-ring"))).toBe(false); // no fabricated ring
    const text = textOf(band);
    expect(text).toContain("40k");   // honest observed count
    expect(text).not.toContain("%"); // no invented percentage
    // Nothing reported at all → the band is omitted entirely (never a fake $0/0 tile).
    const blank = withDom(() => M.renderVitalsBand(
      agent({ tokens: { provenance: "unknown" }, elapsedMs: undefined, updatedAt: undefined }),
    ));
    expect(blank).toBeNull();
    // The honest "not reported" string itself stays byte-identical.
    expect(M.tokenSummary({ provenance: "unknown" }).text).toBe("not reported");
  });

  test("(c) renderEvidenceShelf no longer builds the vitals block — it moved to the band", () => {
    const evidenceShelf = source.match(/function renderEvidenceShelf\([\s\S]*?\n}\n/)?.[0] ?? "";
    expect(evidenceShelf).toBeTruthy();
    // The moved pattern, quoted from the pre-B3 source: the vitals prepend.
    expect(evidenceShelf).not.toContain("body.prepend(vitals)");
    // No vitals tiles are built in Evidence now — neither the old call nor the band.
    expect(evidenceShelf).not.toContain("renderVitals(agent)");
    expect(evidenceShelf).not.toContain("renderVitalsBand(agent)");
  });

  test("(d) renderAgentDrawer fills the .inspector-vitals mount with the band, before the shelf", () => {
    const drawer = source.match(/function renderAgentDrawer\(pane, view\) \{[\s\S]*?\n\}\n/)?.[0] ?? "";
    expect(drawer).toContain('class: "inspector-vitals"');
    expect(drawer).toContain("renderVitalsBand(agent)");
    // B2 appended the mount EMPTY; B3 must fill it — that bare append is gone.
    expect(drawer).not.toContain('pane.append(el("div", { class: "inspector-vitals" }))');
    const vitalsAt = drawer.indexOf('class: "inspector-vitals"');
    const shelfAt = drawer.indexOf('class: "drawer-shelf"');
    expect(vitalsAt).toBeGreaterThan(-1);
    expect(vitalsAt).toBeLessThan(shelfAt);
  });
});

describe("per-type drawers lead with verdict + action (B4)", () => {
  /* Same DOM-less execution trick B2/B3 used, so the program-rollup test asserts
     on the real built tree — not merely on source substrings. */
  function fakeDom() {
    const make = (tag: string) => ({
      nodeType: 1,
      tagName: tag,
      className: "",
      textContent: "",
      dataset: {} as Record<string, string>,
      attributes: {} as Record<string, string>,
      children: [] as unknown[],
      setAttribute(k: string, v: unknown) { this.attributes[k] = String(v); },
      addEventListener() {},
      append(...kids: unknown[]) { this.children.push(...kids); },
    });
    return {
      createElement: (t: string) => make(t),
      createElementNS: (_ns: string, t: string) => make(t),
      createTextNode: (s: string) => ({ nodeType: 3, textContent: String(s) }),
    };
  }
  function withDom<T>(fn: () => T): T {
    (globalThis as unknown as { document: unknown }).document = fakeDom();
    try { return fn(); } finally {
      delete (globalThis as unknown as { document?: unknown }).document;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function classesOf(node: any, out: string[] = []): string[] {
    if (!node || typeof node !== "object") return out;
    if (typeof node.className === "string" && node.className) out.push(node.className);
    for (const kid of node.children || []) classesOf(kid, out);
    return out;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function textOf(node: any): string {
    if (!node || typeof node !== "object") return "";
    if (node.nodeType === 3) return String(node.textContent || "");
    let s = typeof node.textContent === "string" ? node.textContent : "";
    for (const kid of node.children || []) s += textOf(kid);
    return s;
  }
  const bodyOf = (name: string) =>
    source.match(new RegExp("function " + name + "\\(pane, view\\) \\{[\\s\\S]*?\\n\\}\\n"))?.[0] ?? "";

  test("(a) every entity drawer opens with a shared verdict-head block before its detail", () => {
    // The shared head is verdict-shaped: the totem chassis + a right-side stack
    // that carries Close and the one promoted action.
    const helper = source.match(/function drawerVerdictHead\([\s\S]*?\n\}\n/)?.[0] ?? "";
    expect(helper).toBeTruthy();
    expect(helper).toContain("inspector-head inspector-verdict");
    expect(helper).toContain('class: "verdict-side"');
    expect(helper).toContain('class: "verdict-action"');

    // Intervention: head → workStateBanner → impactBlock (guards stay below).
    const iv = bodyOf("renderInterventionDrawer");
    const ivHead = iv.indexOf("drawerVerdictHead(");
    expect(ivHead).toBeGreaterThan(-1);
    expect(ivHead).toBeLessThan(iv.indexOf("workStateBanner(issue)"));
    expect(iv.indexOf("workStateBanner(issue)")).toBeLessThan(iv.indexOf("impactBlock(issue)"));

    // Advisory: head → workStateBanner → impactBlock.
    const av = bodyOf("renderAdvisoryDrawer");
    const avHead = av.indexOf("drawerVerdictHead(");
    expect(avHead).toBeGreaterThan(-1);
    expect(avHead).toBeLessThan(av.indexOf("workStateBanner(issue)"));
    expect(av.indexOf("workStateBanner(issue)")).toBeLessThan(av.indexOf("impactBlock(issue)"));

    // Investigation: head → status line → steps.
    const inv = bodyOf("renderInvestigationDrawer");
    const invHead = inv.indexOf("drawerVerdictHead(");
    expect(invHead).toBeGreaterThan(-1);
    expect(invHead).toBeLessThan(inv.indexOf('class: "dw-status"'));

    // Resolved: head → cleared lead → before/after grid. No invented action.
    const rv = bodyOf("renderResolvedDrawer");
    const rvHead = rv.indexOf("drawerVerdictHead(");
    expect(rvHead).toBeGreaterThan(-1);
    expect(rvHead).toBeLessThan(rv.indexOf("dw-lead--past"));
    expect(rv.indexOf("dw-lead--past")).toBeLessThan(rv.indexOf('class: "detail-grid"'));
    expect(rv).not.toContain("issueHeadAction"); // no action invented for a past-tense drawer
    expect(rv).not.toContain("action:");

    // Program: head (with the rollup line) → roster.
    const pr = bodyOf("renderProgramDrawer");
    const prHead = pr.indexOf("drawerVerdictHead(");
    expect(prHead).toBeGreaterThan(-1);
    expect(pr).toContain("programRollupLine(program)");
    expect(prHead).toBeLessThan(pr.indexOf('class: "dw-roster"'));
    // The broadcast lever stays a body control (not promoted into the head).
    expect(pr).toContain("prog-broadcast:");
  });

  test("(b) regression guard: workStateBanner + impactBlock still render, logic byte-untouched", () => {
    const iv = bodyOf("renderInterventionDrawer");
    const av = bodyOf("renderAdvisoryDrawer");
    expect(iv).toContain("pane.append(workStateBanner(issue));");
    expect(iv).toContain("pane.append(impactBlock(issue));");
    expect(av).toContain("pane.append(workStateBanner(issue));");
    expect(av).toContain("pane.append(impactBlock(issue));");
    // The two guarded functions are untouched — quote their load-bearing lines.
    const wsb = source.match(/function workStateBanner\(issue\) \{[\s\S]*?\n\}\n/)?.[0] ?? "";
    const imp = source.match(/function impactBlock\(issue\) \{[\s\S]*?\n\}\n/)?.[0] ?? "";
    expect(wsb).toContain('el("div", { class: "dw-work work-" + work.key, role: "status" }');
    expect(imp).toContain('el("h3", { class: "section-title", text: "Impact" })');
  });

  test("(c) program head carries the rollup vitals with mono values, aggregated over the swarm", () => {
    expect(typeof M.renderProgramDrawer).toBe("function");
    const mk = (over: Record<string, unknown>) => agent({
      tokens: { provenance: "observed", sessionTotal: 10000 }, ...over,
    });
    const program = {
      id: "p1", name: "Ridge program",
      agents: [
        mk({ id: "codex:w1", status: "running" }),
        mk({ id: "codex:w2", status: "running" }),
        mk({ id: "codex:n1", status: "attention" }),
      ],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pane: any = withDom(() => {
      const p = (globalThis as unknown as { document: { createElement(t: string): unknown } })
        .document.createElement("div");
      M.renderProgramDrawer(p, { program });
      return p;
    });
    const classes = classesOf(pane);
    // Verdict-shaped head + a rollup line whose VALUES ride the mono convention.
    expect(classes.some((c) => c.includes("inspector-head") && c.includes("inspector-verdict"))).toBe(true);
    expect(classes.some((c) => c.includes("dw-rollup"))).toBe(true);
    expect(classes.some((c) => c.includes("dw-rollup-value") && c.includes("mono"))).toBe(true);
    const text = textOf(pane);
    // 3 agents · 2 working · 1 alert · aggregate session tokens (10k×3 = 30k).
    expect(text).toContain("3agents");
    expect(text).toContain("2working");
    expect(text).toContain("1alert");
    expect(text).toContain("30k");
    expect(text).toContain("tokens");
  });

  test("(c2) the token cell is omitted honestly when no agent reports session usage", () => {
    const program = {
      id: "p2", name: "Quiet program",
      agents: [
        agent({ id: "codex:a", status: "running", tokens: { provenance: "observed", total: 500 } }),
        agent({ id: "codex:b", status: "running", tokens: { provenance: "unknown" } }),
      ],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pane: any = withDom(() => {
      const p = (globalThis as unknown as { document: { createElement(t: string): unknown } })
        .document.createElement("div");
      M.renderProgramDrawer(p, { program });
      return p;
    });
    const text = textOf(pane);
    expect(text).toContain("2agents");   // counts are always derivable
    expect(text).not.toContain("tokens"); // an un-derivable aggregate is never faked
  });

  test("(d1) audit closed: dead .state-pill / .inspector-state CSS (and its #fff-on-fill) removed", () => {
    expect(styles).not.toContain(".state-pill");
    expect(styles).not.toContain(".inspector-state");
    // The dead policy-mismatch pill was the only #fff literal in the inspector
    // per-type section — scope the check there (the live .policy-chip #fff lives
    // in agent-rows, WS-C's territory, and is out of scope for this task).
    const perType = styles.slice(
      styles.indexOf("/* ---------- inspector: per-type drawer states"),
      styles.indexOf("/* ---------- vitals band"),
    );
    expect(perType).toBeTruthy();
    expect(perType).not.toContain("#fff");
    // Dead-class safety: with the CSS gone, nothing in the JS/HTML may still emit
    // those class strings, or it would render as an unstyled element. Back the
    // grep claim with the suite (source = app.js text, html = index.html text).
    expect(source).not.toContain("state-pill");
    expect(source).not.toContain("inspector-state");
    expect(html).not.toContain("state-pill");
    expect(html).not.toContain("inspector-state");
  });

  test("(e) orphan cleanup: drawerHead is gone; every drawer head is drawerVerdictHead", () => {
    // The migration moved all five entity heads to drawerVerdictHead, orphaning
    // drawerHead — the change created the orphan, so the change removes it.
    expect(source).not.toContain("function drawerHead(");
    expect(source).not.toContain("drawerHead(");
    // The agent drawer builds its head inline; missingDrawer uses a bare
    // .inspector-head — so the base class stays live, only the helper is gone.
    expect(source).toContain('el("div", { class: "inspector-head inspector-verdict" }'); // drawerVerdictHead
    for (const fn of ["renderInterventionDrawer", "renderAdvisoryDrawer",
      "renderInvestigationDrawer", "renderResolvedDrawer", "renderProgramDrawer"]) {
      expect(bodyOf(fn)).toContain("drawerVerdictHead(");
    }
  });

  test("(f) confirm parity: head triage/launch fire triageIssue directly, exactly like their body twins", () => {
    // Controller ruling: a head action must have IDENTICAL confirm semantics to
    // its body twin. The confirm mechanism (state.confirming) is scoped to
    // renderDockTool and gated on NEEDS_CONFIRM = {interrupt, archive} only —
    // triage/queue/run never enter it. So the parity-correct head is a direct
    // triageIssue() call, mirroring the body. This test pins that both sides
    // fire directly and neither reaches for the confirm gate.
    expect(source).toContain('const NEEDS_CONFIRM = new Set(["interrupt", "archive"]);');
    const head1 = source.match(/function issueHeadAction\([\s\S]*?\n\}\n/)?.[0] ?? "";
    const head2 = source.match(/function investigationHeadAction\([\s\S]*?\n\}\n/)?.[0] ?? "";
    const bodyTriage = source.match(/function renderTriage\([\s\S]*?\n\}\n/)?.[0] ?? "";
    const bodyInvestigation = bodyOf("renderInvestigationDrawer");
    for (const chunk of [head1, head2, bodyTriage, bodyInvestigation]) {
      expect(chunk).toBeTruthy();
      expect(chunk).toContain("triageIssue(");        // direct fire on both sides
      expect(chunk).not.toContain("state.confirming"); // no confirm gate on either
      expect(chunk).not.toContain("NEEDS_CONFIRM");
    }
    // The head's onclick calls the SAME triageIssue actions the body does.
    expect(head1).toContain('triageIssue(id, "run")');
    expect(head1).toContain('triageIssue(id, "generate")');
    expect(bodyTriage).toContain('triageIssue(issue.id, "generate")');
    expect(bodyTriage).toContain('triageIssue(issue.id, "run")');
    expect(head2).toContain('triageIssue(item.issueId, "run")');
    expect(bodyInvestigation).toContain('triageIssue(item.issueId, "run")');
  });

  test("(d2) audit closed: control-banner conforms to --failed ink + --ember-soft tint (settled ruling)", () => {
    const banner = styles.match(/\.control-banner\s*\{[^}]*\}/)?.[0] ?? "";
    const bannerIco = styles.match(/\.control-banner \.ico\s*\{[^}]*\}/)?.[0] ?? "";
    const bannerLink = styles.match(/\.control-banner-link\s*\{[^}]*\}/)?.[0] ?? "";
    // Sanctioned pattern: --failed ink (border + icon + link) over the one --ember-soft tint.
    expect(banner).toContain("var(--ember-soft)");       // the sole sanctioned soft tint
    expect(banner).toContain("var(--failed)");           // border ink from the failed family
    expect(bannerIco).toContain("color: var(--failed)"); // icon ink
    // The link previously reached for the OTHER red (--ember); unify it to --failed so
    // the banner never mixes two red inks (only --failed ink + --ember-soft tint).
    expect(bannerLink).toContain("color: var(--failed)");
    expect(bannerLink).not.toContain("var(--ember)");
  });
});

describe("program-header at-a-glance rollups (C2)", () => {
  /* DOM-less execution, same idiom the drawer rollup tests (B4) use: build the
     real .program-rollup tree in a fake document and assert on the built nodes,
     not on source substrings. */
  function fakeDom() {
    const make = (tag: string) => ({
      nodeType: 1, tagName: tag, className: "", textContent: "",
      dataset: {} as Record<string, string>,
      attributes: {} as Record<string, string>,
      children: [] as unknown[],
      setAttribute(k: string, v: unknown) { this.attributes[k] = String(v); },
      addEventListener() {},
      append(...kids: unknown[]) { this.children.push(...kids); },
    });
    return {
      createElement: (t: string) => make(t),
      createElementNS: (_ns: string, t: string) => make(t),
      createTextNode: (s: string) => ({ nodeType: 3, textContent: String(s) }),
    };
  }
  function withDom<T>(fn: () => T): T {
    (globalThis as unknown as { document: unknown }).document = fakeDom();
    try { return fn(); } finally {
      delete (globalThis as unknown as { document?: unknown }).document;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function classesOf(node: any, out: string[] = []): string[] {
    if (!node || typeof node !== "object") return out;
    if (typeof node.className === "string" && node.className) out.push(node.className);
    for (const kid of node.children || []) classesOf(kid, out);
    return out;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function textOf(node: any): string {
    if (!node || typeof node !== "object") return "";
    if (node.nodeType === 3) return String(node.textContent || "");
    let s = typeof node.textContent === "string" ? node.textContent : "";
    for (const kid of node.children || []) s += textOf(kid);
    return s;
  }
  // Every node whose className carries the given token (whitespace-separated).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function allByClass(node: any, token: string, out: any[] = []): any[] {
    if (!node || typeof node !== "object") return out;
    if (typeof node.className === "string" && node.className.split(/\s+/).includes(token)) out.push(node);
    for (const kid of node.children || []) allByClass(kid, token, out);
    return out;
  }
  const mk = (over: Record<string, unknown>) => agent({
    tokens: { provenance: "observed", sessionTotal: 10000 }, ...over,
  });

  test("(a) header rollup renders all four cells — mono values, ember class on the alert cell", () => {
    expect(typeof M.programHeadRollup).toBe("function");
    // 3 agents: 2 running (working), 1 attention (alert); each reports 10k session tokens.
    const agents = [
      mk({ id: "codex:w1", status: "running" }),
      mk({ id: "codex:w2", status: "running" }),
      mk({ id: "codex:n1", status: "attention" }),
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rollup: any = withDom(() => M.programHeadRollup(agents));
    // Four cells: agents · working · alert · tokens.
    expect(allByClass(rollup, "program-rollup-cell").length).toBe(4);
    // Values ride the mono convention (Rule 2 — mono for values), like the drawer.
    const monoVals = classesOf(rollup).filter((c) =>
      /\bprogram-rollup-value\b/.test(c) && /\bmono\b/.test(c));
    expect(monoVals.length).toBe(4);
    const text = textOf(rollup);
    expect(text).toContain("3agents");
    expect(text).toContain("2working");
    expect(text).toContain("1alert");
    expect(text).toContain("30k");   // 10k × 3 aggregate session tokens
    expect(text).toContain("tokens");
    // Alert ink is class-gated (is-alerting → --ember), never inline (strict CSP),
    // and rides on the alert cell only.
    const alerting = allByClass(rollup, "is-alerting");
    expect(alerting.length).toBe(1);
    expect(textOf(alerting[0])).toContain("1alert");
  });

  test("(b) calm earns no color: 0 alerts renders the count WITHOUT the ember class", () => {
    const agents = [
      mk({ id: "codex:w1", status: "running" }),
      mk({ id: "codex:w2", status: "running" }),
      mk({ id: "codex:w3", status: "running" }),
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rollup: any = withDom(() => M.programHeadRollup(agents));
    const text = textOf(rollup);
    expect(text).toContain("0alerts");                       // the alert cell still renders...
    expect(allByClass(rollup, "is-alerting").length).toBe(0); // ...but takes no ember ink at zero
  });

  test("(c) honest omission: an un-derivable token aggregate drops the token cell", () => {
    const agents = [
      agent({ id: "codex:a", status: "running", tokens: { provenance: "observed", total: 500 } }),
      agent({ id: "codex:b", status: "running", tokens: { provenance: "unknown" } }),
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rollup: any = withDom(() => M.programHeadRollup(agents));
    const text = textOf(rollup);
    expect(text).toContain("2agents");                              // counts are always derivable
    expect(text).not.toContain("tokens");                          // no session total → no faked aggregate
    expect(allByClass(rollup, "program-rollup-cell").length).toBe(3); // agents · working · alert only
  });

  test("(d) header and drawer rollups share ONE aggregation source — no duplicated arithmetic", () => {
    // The aggregation core is defined exactly once.
    expect((source.match(/function programRollupCells\(/g) ?? []).length).toBe(1);
    // BOTH DOM builders feed off it rather than re-deriving counts/tokens.
    const drawer = source.match(/function programRollupLine\(program\) \{[\s\S]*?\n\}\n/)?.[0] ?? "";
    const header = source.match(/function programHeadRollup\(agents\) \{[\s\S]*?\n\}\n/)?.[0] ?? "";
    expect(drawer).toContain("programRollupCells(");
    expect(header).toContain("programRollupCells(");
    // The token reduce — the one bit of arithmetic that could drift — lives ONLY in
    // the shared core: it appears exactly once in the whole file.
    expect((source.match(/sum \+ a\.tokens\.sessionTotal/g) ?? []).length).toBe(1);
    // renderProgram delegates its header rollup to the shared builder and keeps no
    // parallel arithmetic; the old rollupParts text summary is gone.
    const rp = source.match(/function renderProgram\(program, agents\) \{[\s\S]*?\n\}\n/)?.[0] ?? "";
    expect(rp).toContain("programHeadRollup(agents)");
    expect(rp).not.toContain("deriveRollup(agents)");
    expect(source).not.toContain("rollupParts");
  });

  test("(e) rollup data rides the header's accessible text (extends the drawer aria pattern)", () => {
    const agents = [
      mk({ id: "codex:w1", status: "running" }),
      mk({ id: "codex:w2", status: "running" }),
      mk({ id: "codex:n1", status: "attention" }),
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rollup: any = withDom(() => M.programHeadRollup(agents));
    const label = rollup.attributes["aria-label"] ?? "";
    expect(label).toContain("Program rollup"); // extends the drawer's group name…
    expect(label).toContain("3 agents");        // …and carries the data itself
    expect(label).toContain("2 working");
    expect(label).toContain("1 alert");
    expect(label).toContain("30k tokens");
  });
});

describe("agent-row density pass at ≥1440px (C3)", () => {
  // The compact rule is a single min-width:1440px media block holding one
  // .agent-row override with the inner rule on one line, so it closes on the
  // first `\n}` after the query opens — that boundary is the whole block.
  function compactBlock() {
    const idx = styles.indexOf("@media (min-width: 1440px)");
    if (idx < 0) return "";
    const end = styles.indexOf("\n}", idx);
    return end < 0 ? styles.slice(idx) : styles.slice(idx, end + 2);
  }
  // The base .agent-row rule (top of the `agent rows` section) — the comfortable
  // default that must survive untouched below the 1440px breakpoint.
  function baseAgentRow() {
    return styles.match(/\.agent-row\s*\{[^}]*\}/)?.[0] ?? "";
  }

  // (a) A ≥1440px media rule tightens .agent-row vertical padding. The compact
  //     0.35rem is one step down the `agent rows` section's own spacing scale —
  //     it is exactly the .agent-column-header's bottom padding (0.45rem 0.85rem
  //     0.35rem 0.8rem), so the row's dense vertical rhythm at width matches the
  //     header it sits under. Not an invented pixel.
  test("(a) a ≥1440px rule tightens .agent-row vertical padding to the section's 0.35rem step", () => {
    expect(styles).toContain("@media (min-width: 1440px)");
    const block = compactBlock();
    expect(block).toContain(".agent-row");
    // Compact vertical padding, both edges, matched to the header's 0.35rem step.
    expect(block).toContain("padding-top: 0.35rem");
    expect(block).toContain("padding-bottom: 0.35rem");
    // The header whose bottom padding we borrow really is 0.35rem — locks the
    // derivation so a future scale change can't silently orphan the compact value.
    expect(baseAgentRow()).not.toBe("");
    expect(styles).toContain("padding: 0.45rem 0.85rem 0.35rem 0.8rem"); // .agent-column-header
  });

  // (c) The compact override lives ONLY inside min-width:1440px, so it cannot
  //     reach tablet/mobile: the base row keeps its comfortable 0.45rem, and the
  //     compact 0.35rem padding-top appears exactly once — inside that query.
  test("(c) the compact rule is fenced inside min-width:1440px and never leaks below it", () => {
    // The base .agent-row rule is unchanged: comfortable 0.45rem all around.
    expect(baseAgentRow()).toContain("padding: 0.45rem 0.85rem 0.45rem 0.8rem");
    // The compact override exists exactly once, and it is the 1440px block's.
    const overrides = styles.match(/padding-top: 0\.35rem/g) ?? [];
    expect(overrides.length).toBe(1);
    expect(compactBlock()).toContain("padding-top: 0.35rem");
    // It is a min-width query — it cannot match below tablet. No max-width block
    // (the <1024px sheet sweep or the <720px stack) carries the compact row.
    const sweep1024 = styles.slice(styles.indexOf("@media (max-width: 1024px)"), styles.indexOf("@media (max-width: 720px)"));
    expect(sweep1024).not.toContain("padding-top: 0.35rem");
    const stack720 = styles.slice(styles.indexOf("@media (max-width: 720px)"), styles.indexOf("@media (prefers-reduced-motion"));
    expect(stack720).not.toContain("padding-top: 0.35rem");
  });

  // (b) Honest regression guard (not a fresh RED — this passes before the density
  //     rule is written): the <1024px 44px touch sweep must keep its full selector
  //     list, including the one agent-row-scoped control in it (.agent-rename).
  //     The density pass is ≥1440px only; it must not disturb the touch sweep that
  //     wins below 1024px. Binding constraint: 44px touch targets below 1024px.
  test("(b) the <1024px 44px touch sweep keeps its full list incl. the row's rename control", () => {
    const after = styles.slice(styles.indexOf("@media (max-width: 1024px)"));
    const block = after.slice(0, after.indexOf("@media (max-width: 720px)"));
    const sweep = block.match(/[^{}]*\{\s*min-height:\s*44px;\s*\}/)?.[0] ?? "";
    // The row treatment in the sweep: the agent-row rename button.
    expect(sweep).toContain(".agent-rename");
    // The full current list is intact — quote its anchors end-to-end so an
    // accidental drop during the density pass fails here.
    // FE-B: .inspector-tab, .swarm-link, .signal-* and .instruct-form left this
    // list because nothing in the client emits those classes any more — the
    // constraint is unchanged for every control that actually exists.
    expect(sweep).toContain(".view-tab, .btn, #search, .inspector-close, .swarm-anchor");
    expect(sweep).toContain(".program-rename, .agent-rename");
    expect(sweep).toContain(".command-composer input, .rename-form input");
    expect(sweep).toContain("min-height: 44px");
  });
});

describe("toolbar on the instrument-rail language (A3)", () => {
  // Interface contract (later WS-C tasks reuse `is-current` unchanged):
  // Interface contract (later WS-C tasks reuse `is-current` unchanged):
  // the active view-tab is ink text + a 2px --signal-rail bottom rail driven
  // by the class `is-current`, never a filled/boxed tab.
  test("active view-tab is an is-current ink signal rail, not a filled tab (Rule 1)", () => {
    const currentRule = styles.match(/\.view-tab\.is-current\s*\{[^}]*\}/)?.[0] ?? "";
    expect(currentRule).toContain("color: var(--ink)");
    expect(currentRule).toContain("var(--signal-rail)");
    // Rule 1 — indicator inks, not flood fills: no --surface fill / boxed tab.
    expect(currentRule).not.toContain("var(--surface)");
    // renderTabs drives the active marker by class, not by aria-pressed styling.
    expect(source).toContain('classList.toggle("is-current"');
  });

  test("the old filled-surface active-tab rule is gone (Rule 1)", () => {
    // Quote the current offending pattern from source and assert it is gone.
    expect(styles).not.toContain(
      '.view-tab[aria-pressed="true"] { color: var(--ink); background: var(--surface)',
    );
    // The active state no longer keys off aria-pressed at all in CSS.
    expect(styles).not.toContain('.view-tab[aria-pressed="true"]');
  });

  test("view-tab count badges render in mono (Rule 2: mono for values)", () => {
    const countRule = styles.match(/\.view-tab \.count\s*\{[^}]*\}/)?.[0] ?? "";
    expect(countRule).toContain("font-family: var(--font-mono)");
  });

  test("the Alerts tab count takes ember ink only when alerting (>0), quiet at zero (converges on C2's is-alerting)", () => {
    // Reviewer Minor 3 drift, toolbar direction: renderTabs marks the Alerts
    // (needs-you) count with the SAME is-alerting modifier the program rollup alert
    // cell uses — driven by class, never inline (strict CSP). Zero keeps the default.
    const fn = source.match(/function renderTabs\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).toContain('view === "needs-you"');
    expect(fn).toContain('classList.toggle("is-alerting", count > 0)');
    // CSS gives that class ember ink only — no fill (Rule 1: indicator ink, not flood).
    const rule = styles.match(/\.view-tab \.count\.is-alerting\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("color: var(--ember)");
    expect(rule).not.toContain("background");
  });

  test("select-toggle pressed state is an ink outline + tint, not a flood fill (Rule 1)", () => {
    const rule = styles.match(/\.select-toggle\[aria-pressed="true"\]\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("color: var(--ink)");
    expect(rule).toContain("background: var(--sand)");
    expect(rule).toContain("border-color: var(--ink)");
    // The old ink flood fill (ink background, surface text) is gone.
    expect(rule).not.toContain("background: var(--ink)");
  });

  test("index.html seeds is-current on the default Now tab (honest guard — the markup already does)", () => {
    // renderTabs re-derives the active marker on every render, but the first paint
    // before JS runs must already present Now as current. This locks the seed markup
    // so a future edit to the tab list can't ship a currentless first frame.
    expect(html).toContain('class="view-tab is-current" data-view="now" aria-pressed="true"');
  });
});

describe("masthead + program headers share the frame + quiet header language (A4)", () => {
  // Rule 3 — shared frame: the masthead full-width band caps its content at
  // --frame, the same alignment contract the pulse strip and toolbar follow.
  test("masthead aligns its content to the shared --frame (Rule 3)", () => {
    const innerRule = styles.match(/\.masthead-inner\s*\{[^}]*\}/)?.[0] ?? "";
    expect(innerRule).toContain("max-width: var(--frame)");
    expect(innerRule).toContain("margin: 0 auto");
  });

  // The programs band aligns to --frame through its container: #programs lives
  // inside .app-body, the one centered canvas the masthead, summary, and
  // toolbar all share — not its own full-width strip.
  test("the programs band aligns to --frame through its .app-body container (Rule 3)", () => {
    const bodyRule = styles.match(/\.app-body\s*\{[^}]*\}/)?.[0] ?? "";
    expect(bodyRule).toContain("max-width: var(--frame)");
    expect(bodyRule).toContain("margin: 0 auto");
    expect(html).toContain('<section id="programs" class="programs"');
  });

  // Rule 2 — mono for values: the program-header rollup renders counts (data),
  // so they carry --font-mono, like the view-tab count badges (A3). C2 decomposed
  // the single .program-rollup text span into value/label cells (mirroring the
  // drawer's .dw-rollup-value mono), so the mono now lives on .program-rollup-value.
  test("program-header rollup counts render in mono (Rule 2: mono for values)", () => {
    const valueRule = styles.match(/\.program-rollup-value\s*\{[^}]*\}/)?.[0] ?? "";
    expect(valueRule).toContain("font-family: var(--font-mono)");
  });

  // A4 audit finding: .program-alias-tag is a 9px uppercase tracked micro-label
  // exactly like .eyebrow / .agent-column-label / .vital-label — the ratified
  // mono micro-label idiom — but was the one outlier missing --font-mono.
  test("program-alias-tag joins the mono micro-label idiom (Rule 2, A4 finding)", () => {
    const tagRule = styles.match(/\.program-alias-tag\s*\{[^}]*\}/)?.[0] ?? "";
    // Replacement rule: the alias tag now carries mono like every other label.
    expect(tagRule).toContain("font-family: var(--font-mono)");
    // Absence: the old rule that opened straight into font-size, with no
    // font-family, is gone.
    expect(styles).not.toContain(".program-alias-tag { font-size: 9px");
    // It keeps its micro-label furniture (uppercase, tracked, faint ink).
    expect(tagRule).toContain("text-transform: uppercase");
    expect(tagRule).toContain("color: var(--faint)");
  });
});

describe("motion + responsive conformance for the restyled body (A6)", () => {
  // The single 44px touch-sweep rule inside the <1024px block: the selector list
  // that terminates in `{ min-height: 44px; }`. This is the rule the audit says
  // must grow to close the touch-target gaps.
  function touchSweep1024() {
    const after = styles.slice(styles.indexOf("@media (max-width: 1024px)"));
    const block = after.slice(0, after.indexOf("@media (max-width: 720px)"));
    return block.match(/[^{}]*\{\s*min-height:\s*44px;\s*\}/)?.[0] ?? "";
  }

  // A6 finding 1: .filter-chip (toolbar, 30px min-height) was never swept to 44px
  // at any breakpoint — absent from both the 1024px and 720px sweep lists.
  // Binding constraint: 44px touch targets below 1024px.
  test("the <1024px touch sweep now covers the filter chip (A6 finding)", () => {
    expect(touchSweep1024()).toContain(".filter-chip");
  });

  // A6 finding 1: .program-details (programs, 30px) was swept only at ≤720px, so it
  // stayed 30px through the 721–1024px tablet range where the constraint already
  // requires 44px. It graduates into the <1024px sweep.
  test("program-details gets its 44px treatment at <1024px, not just <720px (A6 finding)", () => {
    // Replacement: .program-details is now in the <1024px sweep.
    expect(touchSweep1024()).toContain(".program-details");
    // Absence: the old <720px-only pattern that carried .program-details is gone;
    // the 720px list keeps only the drawer-scoped controls.
    expect(styles).not.toContain(".dw-lin-name, .program-details { min-height: 44px; }");
    // FE-B: .signal-trigger dropped out of this list with the rest of the
    // removed signal-surface board; the drawer-scoped controls are unchanged.
    expect(styles).toContain(
      ".dw-roster-row, .dw-kid, .dw-lin-name { min-height: 44px; }",
    );
  });

  // A6 finding 1: the text inputs were never swept at any breakpoint —
  // .command-composer input (40px) and .rename-form input (36px) — while
  // #search (a sibling input) already was. (.instruct-form input was the third;
  // FE-B removed it with the rest of the orphaned stylesheet, since no element
  // in the client has ever carried that class.)
  test("every text input clears 44px below 1024px (A6 finding)", () => {
    const sweep = touchSweep1024();
    expect(sweep).toContain(".command-composer input");
    expect(sweep).toContain(".rename-form input");
    expect(styles).not.toContain(".instruct-form");
  });

  // A6 finding 2 — Rule 6 (motion respects prefers-reduced-motion). Honest
  // regression guard, not a fresh RED: WS-A (b4f9d80..d516ad7) added and removed
  // no @keyframes or `animation:` declarations, so the pre-existing universal
  // guard already disables the full animation set. This locks that guarantee.
  test("reduced-motion universally disables the full WS-A animation set (A6 regression guard)", () => {
    const reduced = styles.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    // Universal selector + !important: disables ANY animation/transition regardless
    // of specificity — every current keyframe and any a later task might add.
    expect(reduced).toContain("*, *::before, *::after");
    expect(reduced).toContain("animation: none !important");
    expect(reduced).toContain("transition: none !important");
    // The full existing animation set the guard covers.
    const keyframes = [...styles.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]).sort();
    expect(keyframes).toEqual(["conn-beat", "drawer-in", "dw-pulse", "sheet-up", "status-pulse", "sun-pulse"]);
    // Every live `animation:` usage keys off one of those keyframes — none escapes.
    const animated = [...styles.matchAll(/animation:\s*([\w-]+)/g)].map((m) => m[1]).filter((n) => n !== "none");
    expect(new Set(animated)).toEqual(new Set(keyframes));
  });
});

describe("peripheral surfaces conform to the design language (A5)", () => {
  // A5 audit finding: the .usage-table "Recent invocations" rows render Tokens,
  // Cost, and Session-ID cells — token/cost values and a literal identifier, the
  // exact subjects of Rule 2 — yet they rendered in plain --font-ui with no mono
  // treatment, unlike .row-fact-value / .swarm-chip / .artifact-path elsewhere.
  // Rule 2 — mono for values only.
  test("usage-table token/cost/session values render in mono (Rule 2, A5 finding)", () => {
    // Replacement rule: a mono modifier scoped to the invocation-table value cells.
    const valRule = styles.match(/\.usage-table td\.usage-val\s*\{[^}]*\}/)?.[0] ?? "";
    expect(valRule).toContain("font-family: var(--font-mono)");
    // The render tags the Tokens, Cost, and Session value cells with it...
    expect(source).toContain('class: "usage-val", text: row.tokens == null');
    expect(source).toContain('class: "usage-val", text: row.costUsd == null');
    expect(source).toContain('el("td", { class: "usage-val" }, sessionCell)');
    // ...and leaves the prose columns (When / Provider / Model) in --font-ui, so
    // the test fails if mono is over-applied to non-value cells.
    expect(source).not.toContain('class: "usage-val", text: row.startTime');
    expect(source).not.toContain('class: "usage-val", text: row.provider');
    expect(source).not.toContain('class: "usage-val", text: modelShort');
  });

  // A5 audit finding: .toast.err carried a hardcoded #f4c9bd text color — a magic
  // hex outside the token vocabulary (DESIGN-LANGUAGE §5 open q5, "non-token
  // hexes"). Tokenize it as a light-ember mix on --surface, the file's soft-tint
  // idiom, so the error-toast text stays inside the vocabulary.
  test("toast error text is tokenized, not a hardcoded hex (§5 non-token hexes, A5 finding)", () => {
    const errRule = styles.match(/\.toast\.err\s*\{[^}]*\}/)?.[0] ?? "";
    // Absence: the magic hex is gone from the rule and the whole sheet.
    expect(errRule).not.toContain("#f4c9bd");
    expect(styles).not.toContain("color: #f4c9bd");
    // Replacement: the text tint is built from vocabulary tokens.
    expect(errRule).toContain("color: color-mix(in srgb, var(--ember)");
    expect(errRule).toContain("var(--surface)");
    // The status border stays the --bad token.
    expect(errRule).toContain("border-color: var(--bad)");
  });
});

/* Scroll shell + sticky headers (Emilio 2026-07-23).
   Part 0 root cause: the `flex:none` .health-rail hosts unbounded inline
   expansions (#pulse-findings, #widget-customizer); on the fragile height:100%
   body box (overflow-y computes to auto) that chrome can exceed the viewport and
   the DOCUMENT scrolls, carrying masthead + summary away. The fix is a 100dvh app
   frame with bounded expansions + contained pane scrolling; sticky program/column
   headers within the roster; a capped tree indent. Intent-test idioms only. */
describe("scroll shell: 100dvh app frame + contained pane scrolling (Part 1)", () => {
  // (a) The body is a dynamic-viewport frame (dvh), not the fragile height:100%
  //     chain, with a 100vh fallback line before it for old engines.
  test("(a) the shell sizes to 100dvh with a 100vh fallback", () => {
    const bodyRule = styles.match(/\nbody\s*\{[^}]*\}/)?.[0] ?? "";
    expect(bodyRule).toContain("height: 100vh");   // fallback line
    expect(bodyRule).toContain("height: 100dvh");  // 2026 dynamic viewport frame
    // The full-width strip guard stays; a vertical clip guard rides in addition
    // to the root-cause fix (never instead of one).
    expect(bodyRule).toContain("overflow-x: hidden");
    expect(bodyRule).toContain("overflow-y: clip");
  });

  // (a) Both desktop scroll surfaces contain their scroll — no chaining to the
  //     page when a pane hits its end — and the inspector gains a stable gutter.
  test("(a) both panes carry overscroll-behavior: contain; inspector adds a stable gutter", () => {
    expect(styles).toMatch(/\.pane-list\s*\{[^}]*overscroll-behavior:\s*contain/);
    expect(styles).toMatch(/\.pane-inspector\s*\{[^}]*overscroll-behavior:\s*contain/);
    expect(styles).toMatch(/\.pane-inspector\s*\{[^}]*scrollbar-gutter:\s*stable/);
  });

  // (a) The summary strip's inline expansions are the Part-0 culprit: `flex:none`
  //     chrome with no height bound. Each expansion gets a max-height + internal
  //     scroll so the chrome can never push the document into scrolling.
  test("(a) the findings + customizer expansions are height-bounded with internal scroll", () => {
    const findings = styles.match(/#pulse-findings\s*\{[^}]*\}/)?.[0] ?? "";
    // vh fallback line before the dvh bound, matching the body's fallback discipline.
    expect(findings).toContain("max-height: min(40vh");
    expect(findings).toContain("max-height: min(40dvh"); // sized against the viewport
    expect(findings).toContain("overflow-y: auto");
    expect(findings).not.toContain("overflow: hidden"); // the unbounded clip is replaced
    const customizer = styles.match(/\.widget-customizer\s*\{[^}]*\}/)?.[0] ?? "";
    expect(customizer).toContain("max-height: min(50vh");
    expect(customizer).toContain("max-height: min(50dvh");
    expect(customizer).toContain("overflow-y: auto");
  });

  // (e) Regression guard: the <1024px full-sheet fixed-inspector contract is a
  //     DIFFERENT contract and must stay untouched.
  test("(e) the <1024px fixed-inspector contract is unchanged", () => {
    const after = styles.slice(styles.indexOf("@media (max-width: 1024px)"));
    const block = after.slice(0, after.indexOf("@media (max-width: 720px)"));
    // Bind the three invariants to the ONE extracted .pane-inspector rule, so the
    // guard can't pass on stray matches elsewhere in the block.
    const inspRule = block.match(/\.pane-inspector\s*\{[^}]*\}/)?.[0] ?? "";
    expect(inspRule).not.toBe("");
    expect(inspRule).toContain("position: fixed");
    expect(inspRule).toContain("inset: 0");
    // The desktop shell is not forced onto it: no dvh height leaks into the sheet.
    expect(inspRule).not.toContain("height: 100dvh");
  });
});
describe("scroll shell: sticky left-pane headers (Part 2)", () => {
  // (b) The program head pins to the top of the roster scroll with an OPAQUE
  //     surface so rows occlude under it, above the rows in z.
  test("(b) .program-head is sticky at top:0 with an opaque --surface background", () => {
    const head = styles.match(/\.program-head\s*\{[^}]*\}/)?.[0] ?? "";
    expect(head).toContain("position: sticky");
    expect(head).toContain("top: 0");
    expect(head).toContain("background: var(--surface)");
    expect(head).toMatch(/z-index:\s*\d/);
    // Prevented from wrapping so its stuck height is a stable single line.
    expect(head).toContain("flex-wrap: nowrap");
  });

  // (b) The column header pins directly below the stuck program head, offset by a
  //     CSS var that matches the single-line head, keeping its opaque --sand.
  test("(b) .agent-column-header is sticky below the head via --program-head-h, keeping --sand", () => {
    const col = styles.match(/\.agent-column-header\s*\{[^}]*\}/)?.[0] ?? "";
    expect(col).toContain("position: sticky");
    expect(col).toContain("top: var(--program-head-h)");
    expect(col).toContain("background: var(--sand)"); // already opaque, preserved
    // The offset var is defined (and re-pointed where the touch sweep grows the head).
    expect(styles).toContain("--program-head-h:");
  });

  // (b) The `.program { overflow: hidden }` scroll-scope is what breaks sticky
  //     (probe D: head scrolls to -269 under hidden). `clip` keeps the rounded
  //     corners AND lets the head pin to the roster.
  test("(b) .program uses overflow: clip (not hidden) so sticky escapes the card scope", () => {
    const prog = styles.match(/\.program\s*\{[^}]*\}/)?.[0] ?? "";
    expect(prog).toContain("overflow: clip");
    expect(prog).not.toContain("overflow: hidden");
  });

  // (c) Keyboard parity: focused rows clear the stuck stack (head + column header)
  //     so Tab/arrow focus never lands hidden beneath the frozen headers.
  test("(c) rows carry scroll-margin-top equal to the stuck header stack (head + column)", () => {
    // Both focusable roster elements — agent rows AND swarm anchors — clear the stack.
    const row = styles.match(/\.agent-row\s*\{[^}]*\}/)?.[0] ?? "";
    expect(row).toContain("scroll-margin-top:");
    expect(row).toContain("var(--program-head-h)");
    expect(row).toContain("var(--column-head-h)");   // magic px replaced by a coupled var
    const anchor = styles.match(/\.swarm-anchor\s*\{[^}]*\}/)?.[0] ?? "";
    expect(anchor).toContain("scroll-margin-top:");
    expect(anchor).toContain("var(--program-head-h)");
    expect(anchor).toContain("var(--column-head-h)");
    // The offset vars are defined together on the scroll container.
    expect(styles).toMatch(/\.pane-list\s*\{[^}]*--program-head-h:/);
    expect(styles).toMatch(/\.pane-list\s*\{[^}]*--column-head-h:/);
  });
});
describe("scroll shell: capped tree indent for deep swarms (Part 3)", () => {
  // (d) Deep nesting stops indenting past level 3 (N·step: 3·1.3rem + 0.8rem base
  //     = 4.7rem = 75px ≤ 25% of the 380px min pane); depth colour + chips carry
  //     the deeper hierarchy. The cap must bind at EVERY indenting site, not just
  //     one file-wide match — so each rule is extracted and checked on its own.
  test("(d) the cap min(var(--tree-depth), 3) binds at all five indenting sites", () => {
    // 1. desktop child row indent
    const isChild = styles.match(/\.agent-row\.is-child\s*\{[^}]*\}/)?.[0] ?? "";
    expect(isChild).toContain("min(var(--tree-depth), 3) * 1.3rem");
    // 2. desktop child row while selecting
    const selecting = styles.match(/\.agent-row\.is-child\.is-selecting\s*\{[^}]*\}/)?.[0] ?? "";
    expect(selecting).toContain("min(var(--tree-depth), 3) * 1.3rem");
    // 3. connector rail (tracks the same cap so it stays aligned)
    const connector = styles.match(/\.agent-row\.is-child::before\s*\{[^}]*\}/)?.[0] ?? "";
    expect(connector).toContain("(min(var(--tree-depth), 3) - 1) * 1.3rem");
    // 4. swarm anchor indent (matches the row indent)
    const anchor = styles.match(/\.swarm-anchor\.is-child\s*\{[^}]*\}/)?.[0] ?? "";
    expect(anchor).toContain("min(var(--tree-depth), 3) * 1.3rem");
    // 5. the ≤720px mobile step rules (smaller 0.85rem step)
    const mobile = styles.slice(styles.indexOf("@media (max-width: 720px)"), styles.indexOf("@media (prefers-reduced-motion"));
    const mChild = mobile.match(/\.agent-row\.is-child\s*\{[^}]*\}/)?.[0] ?? "";
    expect(mChild).toContain("min(var(--tree-depth), 3) * 0.85rem");
    const mSelecting = mobile.match(/\.agent-row\.is-child\.is-selecting\s*\{[^}]*\}/)?.[0] ?? "";
    expect(mSelecting).toContain("min(var(--tree-depth), 3) * 0.85rem");
    // Absence: no uncapped multiplier survives at any width (the ", 3)" between
    // the var and the operator means the capped form is not a false match here).
    expect(styles).not.toContain("var(--tree-depth) * 1.3rem");
    expect(styles).not.toContain("var(--tree-depth) * 0.85rem");
  });
});

/* Review fixes (2026-07-23): the fix's own edge cases. */
describe("scroll shell: review fixes", () => {
  // (1 Important) The findings ledger and the widget customizer are BOTH
  //   flex:none summary-strip expansions; opening both at once was 918px > 900px
  //   at 1440×900 (clipped invisibly by body overflow-y:clip). Make them mutually
  //   exclusive — opening either collapses the other — so combined overflow is
  //   structurally impossible (the max-height bounds stay as belt-and-suspenders).
  test("(1) the two summary-strip expansions are mutually exclusive", () => {
    // Opening the findings collapses the customizer.
    const pulse = source.match(/function togglePulseFindings\(\)\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(pulse).toContain("state.pulseExpanded = !state.pulseExpanded");
    expect(pulse).toContain("state.widgetCustomizerOpen = false");
    // Opening the customizer collapses the findings.
    const handler = source.match(/"customize-summary"\)\.addEventListener\("click",\s*\(\)\s*=>\s*\{[\s\S]*?\}\);/)?.[0] ?? "";
    expect(handler).toContain("state.widgetCustomizerOpen = !state.widgetCustomizerOpen");
    expect(handler).toContain("state.pulseExpanded = false");
  });

  // (2 Important) The nowrap rollup sits inside a .program overflow:clip card, so
  //   at narrow widths the fixed cluster was cropped with zero indication. It must
  //   shrink HONESTLY (min-width:0 + per-cell overflow), the alerts cell must never
  //   shrink (last to go, always legible), and the least-critical tokens cell is
  //   dropped outright at ≤720px.
  test("(2) the rollup shrinks honestly and never crops the alerts cell", () => {
    const rollup = styles.match(/\.program-rollup\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rollup).toContain("min-width: 0");
    expect(rollup).toContain("flex: 0 1 auto");   // shrinks after the name truncates
    const cell = styles.match(/\.program-rollup-cell\s*\{[^}]*\}/)?.[0] ?? "";
    expect(cell).toContain("min-width: 0");
    expect(cell).toContain("overflow: hidden");
    // The alerts cell is pinned against shrink — it is the last thing to give.
    const alert = styles.match(/\.program-rollup-cell\.is-alerting\s*\{[^}]*\}/)?.[0] ?? "";
    expect(alert).toContain("flex-shrink: 0");
    // The tokens cell (tagged by JS with a key) is dropped on narrow screens.
    expect(source).toContain('label: "tokens", key: "tokens"');
    expect(source).toContain('" program-rollup-cell--" + c.key');
    const mobile = styles.slice(styles.indexOf("@media (max-width: 720px)"), styles.indexOf("@media (prefers-reduced-motion"));
    expect(mobile).toContain(".program-rollup-cell--tokens { display: none; }");
    // The alerts cell is never targeted for dropping.
    expect(styles).not.toContain(".program-rollup-cell.is-alerting { display: none");
  });
});

/* ---------------------------------------------------------------------------
   Wave 1 / FE-A — dead controls and the lying Live badge.

   Every test below asserts BEHAVIOR (a returned verdict, a computed signature,
   a built node), never a source substring: the bugs in this lane all survived a
   suite that only grepped app.js text. Paint-signature tests follow one shape —
   flip exactly one field and require the signature to move — because a signature
   that omits a field is precisely how a control becomes a dead click.
--------------------------------------------------------------------------- */
describe("FE-A: snapshot freshness drives the connection verdict", () => {
  const NOW = Date.parse("2026-07-28T12:00:00.000Z");
  const ago = (ms: number) => new Date(NOW - ms).toISOString();

  test("freshness is measured on the data, in three honest bands", () => {
    expect(M.snapshotFreshness(ago(4_000), NOW).state).toBe("fresh");
    expect(M.snapshotFreshness(ago(15_000), NOW).state).toBe("fresh");   // inclusive edge
    expect(M.snapshotFreshness(ago(15_001), NOW).state).toBe("lagging");
    expect(M.snapshotFreshness(ago(60_000), NOW).state).toBe("lagging"); // inclusive edge
    expect(M.snapshotFreshness(ago(60_001), NOW).state).toBe("stale");
    expect(M.snapshotFreshness(ago(91 * 3_600_000), NOW)).toEqual({ state: "stale", ageMs: 91 * 3_600_000 });
    // A clock skew that puts generatedAt in the future is not "negative age".
    expect(M.snapshotFreshness(new Date(NOW + 5_000).toISOString(), NOW)).toEqual({ state: "fresh", ageMs: 0 });
    // No verdict is claimed when there is nothing to measure.
    for (const bad of [undefined, null, "", "not-a-date"]) {
      expect(M.snapshotFreshness(bad, NOW)).toEqual({ state: "unknown", ageMs: null });
    }
  });

  /* THE regression. Production served a 91-hour-old snapshot under a green
     "Live" badge because the only staleness check read the heartbeat clock, and
     the server heartbeats every 25s under a 60s threshold — so a heartbeat that
     landed one millisecond ago (lastEventAt === now) always won. The verdict now
     takes the heartbeat clock AND the data age, and the data age must be able to
     override a perfectly healthy pipe. */
  test("a heartbeat that just landed cannot make a frozen snapshot read as Live", () => {
    expect(M.connVerdictFor({ open: true, lastEventAt: NOW, generatedAt: ago(91 * 3_600_000), now: NOW })).toBe("stale");
    expect(M.connVerdictFor({ open: true, lastEventAt: NOW, generatedAt: ago(61_000), now: NOW })).toBe("stale");
    // …and a fresh snapshot still reads Live, so the badge is not merely pessimistic.
    expect(M.connVerdictFor({ open: true, lastEventAt: NOW, generatedAt: ago(3_000), now: NOW })).toBe("live");
    // A silent socket (no event of any kind for a full stale window) is still stale
    // even when the last snapshot it delivered was fresh at the time.
    expect(M.connVerdictFor({ open: true, lastEventAt: NOW - 61_000, generatedAt: ago(3_000), now: NOW })).toBe("stale");
    // Boot: the socket is open but no snapshot has landed — no stale claim yet.
    expect(M.connVerdictFor({ open: true, lastEventAt: 0, generatedAt: null, now: NOW })).toBe("live");
    // A closed/failed socket is owned by onerror and the health poll, not here.
    expect(M.connVerdictFor({ open: false, lastEventAt: NOW, generatedAt: ago(3_000), now: NOW })).toBeNull();
  });

  test("the badge shows the actual snapshot age as soon as it stops being fresh", () => {
    expect(M.connLabelText("live", ago(3_000), NOW)).toBe("Live");
    expect(M.connLabelText("live", ago(40_000), NOW)).toBe("Live · snapshot 40s ago");
    expect(M.connLabelText("stale", ago(91 * 3_600_000), NOW)).toBe("Stale feed · snapshot 4d ago");
    // Nothing measurable → no fabricated age suffix.
    expect(M.connLabelText("live", null, NOW)).toBe("Live");
    expect(M.connLabelText("connecting", ago(91 * 3_600_000), NOW)).toBe("Connecting");
    expect(M.connLabelText("offline", ago(91 * 3_600_000), NOW)).toBe("Server unreachable");
  });
});

describe("FE-A: the dead SSE stream recovers instead of painting hours-old state", () => {
  const NOW = 1_000_000;

  test("a CLOSED stream is re-armed, with backoff, and OPEN resets the backoff", () => {
    // 2 = CLOSED. EventSource never retries this state on its own.
    const first = M.reconnectPlan(2, NOW, 0, 0);
    expect(first.reconnect).toBe(true);
    expect(first.attempts).toBe(1);
    expect(first.dueAt).toBe(NOW + 2_000);
    // Inside the backoff window the poll must not hammer a server that is down.
    expect(M.reconnectPlan(2, NOW + 500, first.attempts, first.dueAt)).toEqual({
      reconnect: false, attempts: 1, dueAt: first.dueAt,
    });
    // Backoff grows and then caps at 30s rather than running away.
    expect(M.reconnectPlan(2, NOW, 1, 0).dueAt).toBe(NOW + 4_000);
    expect(M.reconnectPlan(2, NOW, 9, 0).dueAt).toBe(NOW + 30_000);
    // 0 = CONNECTING: a retry is already in flight, leave it alone.
    expect(M.reconnectPlan(0, NOW, 3, 0)).toEqual({ reconnect: false, attempts: 3, dueAt: 0 });
    // 1 = OPEN: healthy again, so the next outage starts from a clean backoff.
    expect(M.reconnectPlan(1, NOW, 4, NOW + 30_000)).toEqual({ reconnect: false, attempts: 0, dueAt: 0 });
  });

  test("an unhealthy feed falls back to polling the snapshot, throttled", () => {
    expect(M.fallbackPollDue("live", NOW, NOW - 600_000, 0)).toBe(false);      // healthy: never poll
    expect(M.fallbackPollDue("stale", NOW, NOW - 61_000, 0)).toBe(true);       // wedged collector
    expect(M.fallbackPollDue("reconnecting", NOW, NOW - 61_000, 0)).toBe(true);
    expect(M.fallbackPollDue("reconnecting", NOW, NOW - 10_000, 0)).toBe(false); // give the stream a chance first
    expect(M.fallbackPollDue("offline", NOW, NOW - 61_000, NOW + 5_000)).toBe(false); // throttle window
  });
});

describe("FE-A: every snapshot transport uses the one apply path", () => {
  test("both stream envelopes resolve to a snapshot; anything else is not one", () => {
    const snap = snapshot();
    expect(M.eventSnapshot(snap)).toBe(snap);                     // bare snapshot event
    expect(M.eventSnapshot({ snapshot: snap })).toBe(snap);       // wrapped envelope
    // Unknown event kinds resolve to null, which handleEventPayload turns into a
    // refetch rather than adopting a half-understood payload.
    expect(M.eventSnapshot({ type: "heartbeat" })).toBeNull();
    expect(M.eventSnapshot({ schemaVersion: 2, programs: [] })).toBeNull();
    expect(M.eventSnapshot(null)).toBeNull();
    expect(M.eventSnapshot(undefined)).toBeNull();
  });
});

describe("FE-A: a failed snapshot refresh is visible instead of swallowed", () => {
  test("fetchFailed degrades the health verdict and names itself", () => {
    const healthy = snapshot();
    expect(M.systemStatus(healthy, "live", false).label).toBe("Operational");
    expect(M.systemStatus(healthy, "live", true)).toMatchObject({ key: "degraded", label: "Degraded", tone: "degraded" });
    // Degraded tone is what puts the existing Refresh affordance on screen.
    const failed = M.summaryWidgetData("health", healthy, "live", "percent", [], true);
    expect(failed.tone).toBe("degraded");
    expect(failed.value).toBe("Degraded");
    expect(failed.sublabel).toContain("refresh failed");
    expect(M.summaryWidgetData("health", healthy, "live", "percent", [], false).sublabel).not.toContain("refresh failed");
  });
});

describe("FE-A: paint signatures cover the state their surfaces render", () => {
  /* A minimal document is only needed by the el() test; the signature helpers are
     pure functions of (records, ui). */
  function fakeDom() {
    const make = (tag: string) => ({
      nodeType: 1,
      tagName: tag,
      className: "",
      textContent: "",
      dataset: {} as Record<string, string>,
      attributes: {} as Record<string, string>,
      children: [] as unknown[],
      setAttribute(k: string, v: unknown) { this.attributes[k] = String(v); },
      addEventListener() {},
      append(...kids: unknown[]) { this.children.push(...kids); },
    });
    return {
      createElement: (t: string) => make(t),
      createElementNS: (_ns: string, t: string) => make(t),
      createTextNode: (s: string) => ({ nodeType: 3, textContent: String(s) }),
    };
  }
  function withDom<T>(fn: () => T): T {
    (globalThis as unknown as { document: unknown }).document = fakeDom();
    try { return fn(); } finally {
      delete (globalThis as unknown as { document?: unknown }).document;
    }
  }

  // A stand-in for the module's `state`. The signature helpers take it as an
  // argument precisely so a test can flip one field at a time.
  function ui(overrides: Record<string, unknown> = {}) {
    return {
      snap: snapshot(),
      queueItems: [] as unknown[],
      triage: new Map(),
      triagePending: new Set<string>(),
      evidenceOpen: false,
      pending: new Set<string>(),
      feedback: new Map(),
      drafts: new Map(),
      confirming: null,
      renaming: null,
      renameDraft: "",
      renamePending: false,
      renameError: "",
      labelsLoading: false,
      labelLoadError: "",
      view: "now",
      query: "",
      facetProgram: "",
      facetProvider: "",
      lookbackHours: 24,
      selecting: false,
      selected: null,
      selection: new Set<string>(),
      programOverrides: new Map<string, string>(),
      labels: new Map<string, string>(),
      broadcastResults: null,
      broadcastConfirming: false,
      broadcastPending: false,
      broadcastError: "",
      broadcastDraft: "",
      ...overrides,
    };
  }

  const SEL = { kind: "agent", id: "codex:a1" };
  const program = { id: "p", name: "P", agents: [agent()] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agentView = (over: Record<string, unknown> = {}) => ({ kind: "agent", agent: agent(over) as any, program });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isig = (view: any, u: any) => M.inspectorPaintSig(SEL, view, u);

  /* Finding 1. For an agent selection the old signature collapsed to
     kind/id/"agent"/""/""/""/""/""/""/evidenceOpen — queueItem, triage and issue
     are all undefined for an agent — so ONLY the evidence cog could ever move it.
     render() therefore early-returned for an open agent drawer: clicking
     Interrupt or Archive set state.confirming and repainted nothing, so the
     confirm strip never existed and the button was unreachable. */
  test("(1) the agent drawer signature moves for every interaction flag its controls set", () => {
    const base = isig(agentView(), ui());
    const moves: Array<[string, Record<string, unknown>]> = [
      ["confirming (Interrupt/Archive confirm strip)", { confirming: "act:codex:a1:interrupt" }],
      ["pending (Send busy state)", { pending: new Set(["codex:a1:instruct"]) }],
      ["feedback (control result banner)", { feedback: new Map([["codex:a1", { ok: false, action: "instruct", message: "Send failed" }]]) }],
      ["renaming (Evidence rename form)", { renaming: "agent:codex:a1" }],
      ["renamePending", { renamePending: true }],
      ["renameError", { renameError: "Keep the label under 80 characters." }],
      ["labelsLoading", { labelsLoading: true }],
      ["labelLoadError", { labelLoadError: "bad label response" }],
      ["evidenceOpen (already covered before the fix)", { evidenceOpen: true }],
    ];
    for (const [why, over] of moves) {
      expect(isig(agentView(), ui(over)), why).not.toBe(base);
    }
    // The confirm strip is instance-scoped, so two different instances of the
    // same action must not share a signature.
    expect(isig(agentView(), ui({ confirming: "head:act:codex:a1:interrupt" })))
      .not.toBe(isig(agentView(), ui({ confirming: "act:codex:a1:interrupt" })));
    // Another agent's pending work must not repaint this drawer.
    expect(isig(agentView(), ui({ pending: new Set(["codex:other:instruct"]) }))).toBe(base);
  });

  test("(1) the agent drawer signature moves for every agent field the drawer paints", () => {
    const base = isig(agentView(), ui());
    const moves: Array<[string, Record<string, unknown>]> = [
      ["status", { status: "attention" }],
      ["statusReason", { statusReason: "Waiting on review." }],
      ["model", { model: "claude-opus-4-8" }],
      ["gates", { gates: ["needs-review"] }],
      ["controls enablement", { controls: [{ action: "focus", enabled: false, reason: "no route" }] }],
      ["tokens", { tokens: { provenance: "observed", total: 99_000, contextWindow: 200_000 } }],
      ["lastHumanMessage", { lastHumanMessage: "ship the fix" }],
      ["lastAgentMessage", { lastAgentMessage: "done" }],
      ["transcriptTail", { transcriptTail: "…tail" }],
      ["cwd", { cwd: "/repos/x" }],
      ["target routing", { target: { resolution: "ambiguous", surfaceId: "s1", workspaceId: "w1" } }],
      ["cwdMismatch", { target: { resolution: "exact", surfaceId: "s1", workspaceId: "w1", cwdMismatch: true } }],
      ["modelPolicy", { modelPolicy: { state: "violation", summary: "off policy" } }],
      ["nextAction", { nextAction: "Review the diff" }],
      ["artifacts", { artifacts: [{ kind: "file", label: "log", path: "/tmp/a.log" }] }],
    ];
    for (const [why, over] of moves) {
      expect(isig(agentView(over), ui()), why).not.toBe(base);
    }
  });

  /* The guard still has to earn its keep: the 4s snapshot cadence must not
     strobe the drawer just because the live clocks moved, and a text box must
     never be torn down while it is being typed into. */
  test("(1) tick-driven clocks and live inputs deliberately do NOT move the signature", () => {
    const base = isig(agentView({ elapsedMs: 60_000, updatedAt: "2026-07-22T03:00:00.000Z" }), ui());
    // tickClocks() rewrites these in place from data-elapsed-base / data-ago.
    expect(isig(agentView({ elapsedMs: 61_000, updatedAt: "2026-07-22T03:00:00.000Z" }), ui())).toBe(base);
    expect(isig(agentView({ elapsedMs: 60_000, updatedAt: "2026-07-22T03:00:04.000Z" }), ui())).toBe(base);
    // …but their PRESENCE still matters: a tile appears when the field arrives.
    expect(isig(agentView({ updatedAt: "2026-07-22T03:00:00.000Z" }), ui())).not.toBe(base);
    // The instruct composer keeps its text across snapshots.
    expect(isig(agentView({ elapsedMs: 60_000, updatedAt: "2026-07-22T03:00:00.000Z" }),
      ui({ drafts: new Map([["codex:a1", "half a sentence"]]) }))).toBe(base);
  });

  test("(1) the drawer tracks the lineage it paints, and non-agent drawers are unaffected", () => {
    const parent = agent({ id: "codex:orch", status: "running" });
    const child = agent({ id: "codex:kid", parentAgentId: "codex:a1", status: "running" });
    const withKin = snapshot({ programs: [{ id: "p", name: "P", agents: [agent({ parentAgentId: "codex:orch" }), parent, child] }] });
    const view = { kind: "agent", agent: agent({ parentAgentId: "codex:orch" }), program };
    const base = isig(view, ui({ snap: withKin }));
    const kidIdle = snapshot({ programs: [{ id: "p", name: "P", agents: [agent({ parentAgentId: "codex:orch" }), parent, agent({ id: "codex:kid", parentAgentId: "codex:a1", status: "waiting" })] }] });
    expect(isig(view, ui({ snap: kidIdle }))).not.toBe(base);

    // Non-agent drawers keep the signature they always had.
    const issue = { id: "system:1", kind: "system", severity: "error", title: "t", summary: "s", affectedAgentIds: [], workState: "open" };
    const advisorySel = { kind: "advisory", id: "system:1" };
    const advBase = M.inspectorPaintSig(advisorySel, { kind: "advisory", issue }, ui());
    expect(M.inspectorPaintSig(advisorySel, { kind: "advisory", issue: { ...issue, workState: "acting" } }, ui())).not.toBe(advBase);
    expect(M.inspectorPaintSig(advisorySel, null, ui())).not.toBe(advBase); // dropped from the snapshot
  });

  /* Finding 4. toggleProgram only writes programOverrides and both rename
     pencils only write renaming, so on a quiet fleet render() early-returned and
     the caret/rename form never appeared — and startRename's querySelector then
     always found nothing to focus. */
  test("(4) the program list signature moves for expand/collapse and rename state", () => {
    const visible = [{ program, agents: [agent()] }];
    const base = M.programsPaintSig(visible, ui());
    expect(M.programsPaintSig(visible, ui({ programOverrides: new Map([["p", "closed"]]) }))).not.toBe(base);
    expect(M.programsPaintSig(visible, ui({ programOverrides: new Map([["p", "open"]]) }))).not.toBe(base);
    // Collapsed and expanded are distinguishable from each other, not just from base.
    expect(M.programsPaintSig(visible, ui({ programOverrides: new Map([["p", "open"]]) })))
      .not.toBe(M.programsPaintSig(visible, ui({ programOverrides: new Map([["p", "closed"]]) })));
    expect(M.programsPaintSig(visible, ui({ renaming: "program:p" }))).not.toBe(base);
    expect(M.programsPaintSig(visible, ui({ renamePending: true }))).not.toBe(base);
    expect(M.programsPaintSig(visible, ui({ renameError: "Save failed" }))).not.toBe(base);
    // The rename input keeps its text across snapshots (same reasoning as the
    // broadcast composer); every external reset of it flips renamePending.
    expect(M.programsPaintSig(visible, ui({ renameDraft: "half a name" }))).toBe(base);
    // The fields the signature already covered still work.
    expect(M.programsPaintSig(visible, ui({ query: "ridge" }))).not.toBe(base);
    expect(M.programsPaintSig([{ program, agents: [agent({ status: "attention" })] }], ui())).not.toBe(base);
  });

  /* Finding 3. <textarea> has no `value` content attribute, so el()'s
     setAttribute fallback produced a permanently empty composer — the operator
     watched their broadcast text vanish on every 4s snapshot. */
  test("(3) el() assigns value as a property so a textarea actually shows its text", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const area: any = withDom(() => M.el("textarea", { value: "restart the collector", "aria-label": "Broadcast instruction" }));
    expect(area.tagName).toBe("textarea");
    expect(area.value).toBe("restart the collector");
    // Proof it is not the inert attribute the bug relied on.
    expect(area.attributes.value).toBeUndefined();
    expect(area.attributes["aria-label"]).toBe("Broadcast instruction"); // other attrs unchanged
    // The instruct composer is an <input> and must round-trip identically.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const input: any = withDom(() => M.el("input", { type: "text", value: "focus pane 3" }));
    expect(input.value).toBe("focus pane 3");
    expect(input.attributes.type).toBe("text");
    // A null value is still skipped entirely rather than assigned.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const empty: any = withDom(() => M.el("textarea", { value: null }));
    expect(empty.value).toBeUndefined();
  });

  test("(3) an idle snapshot does not tear down a live broadcast composer", () => {
    const recipients = [{ agent: agent(), program }];
    const eligible = recipients;
    const base = M.broadcastPaintSig(recipients, eligible, ui());
    // Typing must not change the signature — that is what used to wipe the box
    // every ~4s when the next SSE snapshot arrived.
    expect(M.broadcastPaintSig(recipients, eligible, ui({ broadcastDraft: "restart the collector" }))).toBe(base);
    // Everything the dock actually paints does change it.
    expect(M.broadcastPaintSig(recipients, eligible, ui({ broadcastConfirming: true }))).not.toBe(base);
    expect(M.broadcastPaintSig(recipients, eligible, ui({ broadcastPending: true }))).not.toBe(base);
    expect(M.broadcastPaintSig(recipients, eligible, ui({ broadcastError: "Broadcast failed (HTTP 500)" }))).not.toBe(base);
    expect(M.broadcastPaintSig(recipients, eligible, ui({
      broadcastResults: new Map([["codex:a1", { agentId: "codex:a1", ok: true }]]),
    }))).not.toBe(base);
    // Per-recipient outcomes are distinguished, not just presence.
    expect(M.broadcastPaintSig(recipients, eligible, ui({
      broadcastResults: new Map([["codex:a1", { agentId: "codex:a1", ok: true }]]),
    }))).not.toBe(M.broadcastPaintSig(recipients, eligible, ui({
      broadcastResults: new Map([["codex:a1", { agentId: "codex:a1", ok: false, error: { code: "AGENT_NOT_FOUND" } }]]),
    })));
    // Selection changes rebuild the recipient chips.
    expect(M.broadcastPaintSig([], [], ui())).not.toBe(base);
    // An agent losing eligibility mid-compose must repaint its chip.
    const gone = [{ agent: agent({ status: "stale", controls: [] }), program }];
    expect(M.broadcastPaintSig(gone, [], ui())).not.toBe(base);
  });
});

/* ---------------------------------------------------------------------------
   WAVE 2 / FE-B — client cost, dead weight, and the quarantine dead end.

   Everything below asserts on rendered DOM or on pure model functions. The
   shared harness is the same DOM-less trick the C1/B2 blocks use, extended with
   getElementById + a linked-list node so the keyed row reconciler can be driven
   for real.
   ------------------------------------------------------------------------- */
describe("FE-B: harness-backed client behavior", () => {
  /* -------- finding 11: the retry hint named a port it was not served on ---- */
  test("(11) the unreachable hint names the address the page came from, not a hardcoded 4701", () => {
    expect(M.serverUnreachableHint("127.0.0.1:4715"))
      .toBe("Check that the Ant Hill server is running on 127.0.0.1:4715, then retry.");
    // The production default still reads correctly — this is not a regression trade.
    expect(M.serverUnreachableHint("127.0.0.1:4701")).toContain("127.0.0.1:4701");
    // No internal version jargon in the one screen a broken instance shows.
    expect(M.serverUnreachableHint("127.0.0.1:4702")).not.toContain("v3");
    // A hostless context (file://) must not claim an address it does not know.
    expect(M.serverUnreachableHint("")).toBe("Check that the Ant Hill server is running at this address, then retry.");
  });

  /* -------- finding 10: SVG <rect> has no title ATTRIBUTE ------------------- */
  test("(10) usage bars carry a real SVG <title> child, so hovering reports the bucket", () => {
    const points = [
      { bucketStart: "2026-07-28T01:00:00.000Z", tokens: 12_000, provider: "claude" },
      { bucketStart: "2026-07-28T02:00:00.000Z", tokens: 4_000, provider: "codex" },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chart: any = withDom(() => M.renderUsageSeriesChart(points));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rects = findAll(chart, (n: any) => n.tagName === "rect");
    expect(rects.length).toBe(2);
    for (const rect of rects) {
      // The bug: setAttribute("title", …) on a <rect> renders nothing at all.
      expect(rect.attributes.title).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const titles = (rect.children || []).filter((k: any) => k && k.tagName === "title");
      expect(titles.length).toBe(1);
      expect(String(titles[0].textContent)).toMatch(/tokens$/);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const first = (rects[0].children as any[])[0];
    expect(first.textContent).toBe(M.usageBarTitle("2026-07-28T01:00:00.000Z", 12_000));
    expect(first.textContent).toContain("2026-07-28T01:00:00.000Z");
    expect(first.textContent).toContain("12k");
  });

  /* -------- finding 8: ~40 orphaned CSS classes still shipped --------------
     There is no build step and no CSS pruning, so every dead rule shipped on
     every load — and, more expensively, poisoned grep: a developer editing
     .advisory-title found rules that looked authoritative and had no effect,
     because the live advisory drawer uses .dw-lead / .dw-impact.

     This is a dead-asset lint over the stylesheet, not a behavior test. It is
     here because nothing else can express "this rule has no emitter", and the
     allowlist below is deliberately the COMPLETE set of class prefixes the
     client composes at runtime — a new dynamic prefix has to be added here on
     purpose, which is the point. */
  test("(8) every class in styles.css is emitted by the client", () => {
    const RUNTIME_PREFIXES = [
      "act-", "outcome-", "provider-", "conn-", "dw-accent--", "dw-eyebrow--",
      "dw-provider--", "work-", "role-", "verdict-", "st-", "tri-kind-",
      "tri-live-", "depth-", "chat-turn--", "program-rollup-cell--",
      "widget-option-", "identity-step--", "control-", "is-", "dw-d",
      // W4-B: the drawer composes "liveness-" + the normalized liveness word.
      "liveness-",
      // F3: the health card composes "health-severity-" + the severity key.
      "health-severity-",
    ];
    const declared = [...new Set(styles.match(/\.-?[_A-Za-z][-\w]*/g) ?? [])]
      .map((selector) => selector.slice(1));
    expect(declared.length).toBeGreaterThan(400); // the extraction actually ran
    const client = source + "\n" + html;
    const orphans = declared.filter((name) =>
      !client.includes(name) && !RUNTIME_PREFIXES.some((prefix) => name.startsWith(prefix)));
    expect(orphans).toEqual([]);

    // The allowlist is a prefix list, not a blanket: a fully invented name that
    // merely starts like a live one is still caught.
    expect(client.includes("signal-tech")).toBe(true); // the one signal-* survivor
    for (const gone of ["signal-intervention", "danger-zone", "tests-passing", "advisory-title", "instruct-form", "target-chip"]) {
      expect(styles.includes("." + gone), gone).toBe(false);
    }
  });

  /* -------- finding 7: the same derivation, four times a paint -------------
     affectedImpact rebuilt a Map of the WHOLE fleet once per issue, and
     renderHealthRail drove that chain roughly four times per paint. */
  test("(7) the fleet index is built once per snapshot, not once per issue", () => {
    const agents = Array.from({ length: 40 }, (_, i) => agent({ id: "codex:a" + i }));
    const issues = agents.slice(0, 12).map((a, i) => ({
      id: "agent:" + a.id, kind: "agent", severity: i % 2 ? "warning" : "error",
      title: "Issue " + i, summary: "s", affectedAgentIds: [a.id],
    }));
    const snap = snapshot({ programs: [{ id: "p", name: "P", agents }], issues });

    // The mechanism: one index object, reused for the life of the snapshot.
    const first = M.agentsById(snap);
    expect(first.size).toBe(40);
    expect(M.agentsById(snap)).toBe(first);

    // Driving the real derivation chain does not replace it either — that is
    // what made it O(issues × agents) per pass.
    M.pulseStripModel(snap, "live", []);
    for (const issue of issues) M.affectedImpact(issue, snap);
    expect(M.agentsById(snap)).toBe(first);
    // …and the answers are still right.
    expect(M.affectedImpact(issues[0], snap).total).toBe(1);
    expect(M.affectedImpact(issues[0], snap).plain).toContain("Touches 1 session");

    // A new snapshot object gets a fresh index — no manual invalidation, so a
    // stale board can never be served out of this cache.
    const next = snapshot({ programs: [{ id: "p", name: "P", agents: agents.slice(0, 3) }] });
    const nextIndex = M.agentsById(next);
    expect(nextIndex).not.toBe(first);
    expect(nextIndex.size).toBe(3);
    expect(M.agentsById(null).size).toBe(0);
  });

  test("(7) pulseStripModel threads the context display so a paint derives each widget once", () => {
    const withCtx = snapshot({
      programs: [{ id: "p", name: "P", agents: [agent({ tokens: { provenance: "observed", scope: "latest-turn", total: 50_000, contextWindow: 200_000 } })] }],
    });
    const percentCell = M.pulseStripModel(withCtx, "live", [], "percent").cells.find((c: { id: string }) => c.id === "context-peak");
    const tokenCell = M.pulseStripModel(withCtx, "live", [], "tokens").cells.find((c: { id: string }) => c.id === "context-peak");
    expect(percentCell.data.value).toBe("25%");
    expect(tokenCell.data.value).not.toBe("25%");
    expect(tokenCell.data.value).toContain("50k");
    // Weighting is unaffected by the display — the cell the signature and the
    // renderer share is the same object either way.
    expect(percentCell.weight).toBe(tokenCell.weight);
    // The default is unchanged, so every existing caller keeps its behavior.
    expect(M.pulseStripModel(withCtx, "live", []).cells.find((c: { id: string }) => c.id === "context-peak").data.value).toBe("25%");
  });

  /* -------- finding 4: five copies of one enum, already disagreeing --------
     `completed` read "Complete" on the plan chip, "complete · verifying" on the
     queue button, "verifying" in the pulse row, "Verifying" in the drawer
     eyebrow and "complete · waiting for fresh data" in the drawer status. */
  test("(4) one investigation state reads with one word on every surface", () => {
    const issue = { id: "system:1", kind: "system", severity: "error", title: "t", summary: "s", affectedAgentIds: [] };
    const item = (state: string) => ({
      issueId: "system:1", state, headline: "Re-bind the sessions", mode: "investigate",
      rationale: "why", steps: [{ title: "Read", detail: "d" }], queueRecommended: true,
      createdAt: "2026-07-28T01:00:00.000Z", startedAt: "2026-07-28T01:01:00.000Z",
    });
    const triageText = (state: string) =>
      textOf(withDom(() => M.renderTriage(issue, triageUi({ queueItems: [item(state)] }))));

    // The state that was broken in four ways.
    const completed = triageText("completed");
    expect(completed).toContain("Verifying");                     // plan chip
    expect(completed).toContain("✓ Investigation verifying");      // queue button
    expect(completed).not.toContain("Complete");                   // the old chip word
    expect(completed).not.toContain("complete · verifying");       // the old button text
    const pulseRow = (state: string) =>
      M.pulseStripModel({ schemaVersion: 1, programs: [], issues: [] }, "live", [item(state)]).findings[0];
    expect(pulseRow("completed").work.label).toBe("Verifying");     // pulse row

    // Every surface agrees for every state, and the four states stay distinct.
    for (const [state, word] of [["queued", "Queued"], ["running", "Running"], ["completed", "Verifying"], ["blocked", "Blocked"]] as const) {
      const view = M.investigationView(state);
      expect(view.label, state).toBe(word);
      expect(triageText(state), state).toContain(word);
      expect(pulseRow(state).impact, state).toBe("Investigation " + word.toLowerCase());
    }
    const labels = Object.values(M.INVESTIGATION_STATE_VIEW as Record<string, { label: string }>).map((v) => v.label);
    expect(new Set(labels).size).toBe(4);

    // A sixth server state degrades to the server's own word CONSISTENTLY,
    // instead of a confident wrong label on one surface and a raw enum on the next.
    const unknown = M.investigationView("cancelled");
    expect(unknown.label).toBe("cancelled");
    expect(unknown.button).toBe("Investigation cancelled");
    expect(triageText("cancelled")).toContain("Investigation cancelled");
  });

  /* -------- finding 3: repaint-and-lose-focus ------------------------------
     render()'s focus-restore contract keys on data-fkey and nothing else, and
     renderFilterBar wipes the whole bar unconditionally on every paint. Chips
     without an fkey were destroyed, nothing was restored, and a keyboard or
     screen-reader operator was thrown back to <body> ~15 times a minute. */

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function focusKeysOf(node: any): string[] {
    return buttonsOf(node).map((b: { dataset: Record<string, string> }) => b.dataset.fkey);
  }

  test("(3) filterChip carries the focus key it is given", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chip: any = withDom(() => M.filterChip("6h", true, () => {}, { fkey: "lookback:6" }));
    expect(chip.tagName).toBe("button");
    expect(chip.dataset.fkey).toBe("lookback:6");
    expect(chip.attributes["aria-pressed"]).toBe("true");
    // The key names the control, not its label, so it survives the label change
    // that "Custom" → "Custom 12h" performs on the very chip being clicked.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const custom: any = withDom(() => M.filterChip("Custom 12h", true, () => {}, { fkey: "lookback:custom" }));
    expect(custom.dataset.fkey).toBe("lookback:custom");
  });

  test("(3) every control the filter bar rebuilds every paint is focus-restorable", () => {
    const bar = () => domById.get("filter-bar");

    // Idle/History: Lookback presets + All + Custom, then the Scan window.
    withDom(() => {
      M.renderFilterBar(listUi({ view: "idle", lookbackHours: 6, scanWindowHours: 36 }));
      const keys = focusKeysOf(bar());
      expect(keys.length).toBe(7); // 1h, 6h, 24h, 36h, All, Custom, Scan
      expect(keys.every(Boolean)).toBe(true);
      expect(new Set(keys).size).toBe(keys.length); // querySelector must find ONE node
      expect(keys).toEqual(["lookback:1", "lookback:6", "lookback:24", "lookback:36", "lookback:all", "lookback:custom", "scan-window"]);
    });

    // Usage: the range chips, rebuilt on the same cadence.
    withDom(() => {
      M.renderFilterBar(listUi({ view: "usage", usageRangeId: "24h", usageCustomHours: 24 }));
      const keys = focusKeysOf(bar());
      expect(keys).toEqual(["usage-range:1h", "usage-range:24h", "usage-range:7d", "usage-range:30d", "usage-range:custom"]);
    });

    // The key of the chip an operator is standing on does not move when the
    // selection changes — otherwise focus restore finds nothing after the click.
    const keyAt = (hours: number | null) => withDom(() => {
      M.renderFilterBar(listUi({ view: "idle", lookbackHours: hours }));
      return focusKeysOf(bar());
    });
    expect(keyAt(6)).toEqual(keyAt(24));
    expect(keyAt(null)).toEqual(keyAt(6));
  });

  test("(3) the rename form and the usage panel keep their controls addressable", () => {
    const target = { kind: "program", programId: "p1" };
    const form = withDom(() => M.renderLabelForm(target, {
      inputKey: "rename-input:p1", placeholder: "Display name", ariaLabel: "New display name", source: "Source program: P",
    }));
    const keys = focusKeysOf(form);
    expect(keys).toEqual(["label-save:program:p1", "label-cancel:program:p1"]);
    expect(keys.every(Boolean)).toBe(true);

    // Usage: Retry on an unavailable BurnBar, and the session links in the table.
    const failed = withDom(() => {
      M.renderUsagePanel({
        usageLoading: false, usageError: "locked", usageWard: null, usageSeries: null, usageInvocations: null,
        usageSummary: { available: false, error: "BurnBar database is locked." },
      });
      return domById.get("usage-panel");
    });
    expect(focusKeysOf(failed)).toEqual(["usage-retry"]);

    const table = withDom(() => {
      M.renderUsagePanel({
        usageLoading: false, usageError: "", usageWard: null,
        usageSummary: { available: true, processedTokens: 10, invocations: 1, costKnown: false, burnRateTokensPerHour: null },
        usageSeries: { points: [] },
        usageInvocations: { invocations: [{ sessionId: "a1", provider: "codex", model: "gpt-5-codex", tokens: 10, costUsd: null, startTime: "2026-07-28T01:00:00.000Z" }] },
      });
      return domById.get("usage-panel");
    });
    expect(textOf(table)).toContain("Recent invocations");
    /* The session-link button only exists when the invocation maps to an agent
       in state.snap, which this suite cannot set; likewise the two confirm-strip
       Cancel buttons are gated behind state.confirming / state.broadcastConfirming.
       All three carry an fkey now, but they are covered by inspection, not here —
       said plainly in LANE-REPORT.md rather than faked with a vacuous loop. */
  });

  /* -------- finding 2: one agent's tick rebuilt the whole list -------------
     The list guard was all-or-nothing: any visible agent's status, tokens or
     summary moving invalidated one signature for the WHOLE list, and the next
     paint ran root.textContent = "" and reconstructed every program and every
     row (~27 elements each), taking the operator's text selection with it. */

  const listProgram = (agents: unknown[]) => ({ id: "p1", name: "Prog", agents });
  function planFor(agents: Record<string, unknown>[], over: Record<string, unknown> = {}) {
    const program = listProgram(agents);
    return M.agentRowPlan(program, agents, listUi({ snap: { schemaVersion: 1, programs: [program] }, ...over }));
  }

  test("(2) reconcileKeyed keeps the DOM node of every key whose signature held", () => {
    const parent = newNode("div");
    const cache = new Map();
    const plan = (sigs: Record<string, string>) => Object.entries(sigs).map(([key, sig]) => ({
      key, sig, build: () => newNode("div"),
    }));

    M.reconcileKeyed(parent, plan({ a: "1", b: "1", c: "1" }), cache);
    const [a0, b0, c0] = parent.children;
    expect(parent.children.length).toBe(3);

    // Only b moved. a and c must be the SAME objects — that is the whole point:
    // a node that is never detached keeps its selection, hover and focus.
    M.reconcileKeyed(parent, plan({ a: "1", b: "2", c: "1" }), cache);
    expect(parent.children[0]).toBe(a0);
    expect(parent.children[1]).not.toBe(b0);
    expect(parent.children[2]).toBe(c0);
    const b1 = parent.children[1];

    // Insertion lands in order without disturbing its neighbours.
    M.reconcileKeyed(parent, plan({ a: "1", d: "1", b: "2", c: "1" }), cache);
    expect(parent.children.length).toBe(4);
    expect(parent.children[0]).toBe(a0);
    expect(parent.children[2]).toBe(b1);
    expect(parent.children[3]).toBe(c0);

    // Removal drops exactly the missing key…
    const kept = M.reconcileKeyed(parent, plan({ a: "1", c: "1" }), cache);
    expect(parent.children.map((n: { tagName: string }) => n)).toEqual([a0, c0]);
    expect([...kept]).toEqual(["a", "c"]);

    // …and reordering moves nodes rather than rebuilding them.
    M.reconcileKeyed(parent, plan({ c: "1", a: "1" }), cache);
    expect(parent.children).toEqual([c0, a0]);
  });

  test("(2) a row signature moves only for the row that actually changed", () => {
    const a = agent({ id: "codex:a1", tokens: { provenance: "observed", total: 1200 } });
    const b = agent({ id: "codex:a2", tokens: { provenance: "observed", total: 800 } });
    const before = planFor([a, b]);
    // The exact production tick the finding describes: one agent's token count
    // advances on the 4s snapshot.
    const after = planFor([{ ...a, tokens: { provenance: "observed", total: 40_000 } }, b]);
    expect(after[0].sig).toBe(before[0].sig); // column header
    expect(after[1].sig).not.toBe(before[1].sig); // the agent that moved
    expect(after[2].sig).toBe(before[2].sig); // …and nothing else
    expect(after.map((i: { key: string }) => i.key)).toEqual(before.map((i: { key: string }) => i.key));
  });

  test("(2) the row signature still covers everything a row paints", () => {
    const base = agent({ id: "codex:a1", elapsedMs: 60_000 });
    const sig = (over: Record<string, unknown> = {}, ui: Record<string, unknown> = {}) =>
      M.agentRowSig({ ...base, ...over }, listUi(ui), { depth: 0, childCount: 0, fullById: new Map() });
    const start = sig();
    const moves: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      ["status", { status: "attention" }, {}],
      ["statusReason", { statusReason: "Waiting on review." }, {}],
      ["model", { model: "claude-opus-4-8" }, {}],
      ["tokens", { tokens: { provenance: "observed", total: 40_000, contextWindow: 200_000 } }, {}],
      ["lastHumanMessage (row summary)", { lastHumanMessage: "ship the fix" }, {}],
      ["role chip", { role: "verifier" }, {}],
      ["model policy chip", { modelPolicy: { state: "violation", summary: "off policy" } }, {}],
      ["cwd mismatch dot", { target: { resolution: "exact", surfaceId: "s1", cwdMismatch: true } }, {}],
      ["terminal breadcrumb", { target: { resolution: "exact", surfaceId: "s1", workspaceTitle: "ridge" } }, {}],
      ["staleness fact", { updatedAt: new Date(Date.now() - 40 * 60_000).toISOString() }, {}],
      ["selection highlight", {}, { selectedId: "codex:a1" }],
      ["select mode", {}, { selecting: true }],
      ["checkbox", {}, { selecting: true, selection: new Set(["codex:a1"]) }],
      ["rename form", {}, { renaming: M.presentationLabelKey(M.preferredRenameTarget(base)) }],
      ["rename pending", {}, { renamePending: true }],
      ["rename error", {}, { renameError: "Too long" }],
      ["custom label", {}, { labels: new Map([["agent:codex:a1", "Ridge"]]) }],
      ["context display toggle", {}, { contextDisplay: "tokens" }],
    ];
    for (const [why, over, ui] of moves) expect(sig(over, ui), why).not.toBe(start);

    // The live elapsed clock is deliberately OUT: tickClocks rewrites it in
    // place from data-elapsed-base, so letting it in would rebuild every row
    // every 5s and undo the entire fix.
    expect(sig({ elapsedMs: 61_000 })).toBe(start);
    // Another agent's rename never touches this row.
    expect(sig({}, { renaming: "agent:codex:other" })).toBe(start);
  });

  test("(2) a token tick leaves the program shell alone, so its rows stay attached", () => {
    const a = agent({ id: "codex:a1", status: "running", tokens: { provenance: "observed", total: 1200 } });
    const b = agent({ id: "codex:a2", status: "running" });
    const shell = (agents: Record<string, unknown>[], ui: Record<string, unknown> = {}) =>
      M.programShellSig(listProgram(agents), agents, listUi(ui));
    const base = shell([a, b]);
    // The tick that used to rebuild everything now rebuilds nothing above the row.
    expect(shell([{ ...a, tokens: { provenance: "observed", total: 40_000 } }, b])).toBe(base);
    expect(shell([{ ...a, statusReason: "Still streaming." }, b])).toBe(base);
    // What the shell DOES paint still moves it.
    expect(shell([{ ...a, status: "attention" }, b])).not.toBe(base); // rollup counts
    expect(shell([a, b], { programOverrides: new Map([["p1", "closed"]]) })).not.toBe(base); // caret
    expect(shell([a, b], { labels: new Map([["program:p1", "Ridge"]]) })).not.toBe(base); // head label
    expect(shell([a, b], { selecting: true })).not.toBe(base); // selection row
    expect(shell([a, b], { renaming: "program:p1" })).not.toBe(base); // rename form
    expect(shell([a], { })).not.toBe(base); // fewer visible agents
  });

  test("(2) end to end: a tick that changes one agent rebuilds one row", () => {
    const a = agent({ id: "codex:a1", tokens: { provenance: "observed", total: 1200 } });
    const b = agent({ id: "codex:a2" });
    const c = agent({ id: "codex:a3" });
    const body = newNode("div");
    const cache = new Map();

    withDom(() => M.reconcileKeyed(body, planFor([a, b, c]), cache));
    expect(body.children.length).toBe(4); // header + 3 rows
    const [header, rowA, rowB, rowC] = body.children;

    withDom(() => M.reconcileKeyed(
      body,
      planFor([{ ...a, tokens: { provenance: "observed", total: 40_000 } }, b, c]),
      cache,
    ));
    expect(body.children.length).toBe(4);
    expect(body.children[0]).toBe(header);
    expect(body.children[1]).not.toBe(rowA);
    expect(body.children[2]).toBe(rowB);
    expect(body.children[3]).toBe(rowC);
    // The rebuilt row really is the one that moved, and it shows the new number.
    expect(textOf(body.children[1])).toContain("40k");

    // A repaint with nothing changed touches no node at all.
    const settled = [...body.children];
    withDom(() => M.reconcileKeyed(body, planFor([{ ...a, tokens: { provenance: "observed", total: 40_000 } }, b, c]), cache));
    expect(body.children).toEqual(settled);

    // An agent leaving the view removes exactly its row.
    withDom(() => M.reconcileKeyed(body, planFor([{ ...a, tokens: { provenance: "observed", total: 40_000 } }, c]), cache));
    expect(body.children.length).toBe(3);
    expect(body.children[2]).toBe(rowC);
  });

  test("(2) the whole list path: a live tick repaints one row, not the list", () => {
    /* Drives syncProgramList — the exact two-level path renderPrograms runs —
       with real nodes, so this covers section reuse as well as row reuse. */
    const mk = (id: string, over: Record<string, unknown> = {}) => agent({ id, status: "running", ...over });
    const build = (a1Tokens: number, a3Status = "running") => {
      const alpha = { id: "sync-alpha", name: "Alpha", agents: [mk("codex:s1", { tokens: { provenance: "observed", total: a1Tokens } }), mk("codex:s2")] };
      const beta = { id: "sync-beta", name: "Beta", agents: [mk("codex:s3", { status: a3Status })] };
      return [{ program: alpha, agents: alpha.agents }, { program: beta, agents: beta.agents }];
    };
    const root = newNode("div");
    const ui = (visible: ReturnType<typeof build>) => listUi({
      snap: { schemaVersion: 1, programs: visible.map((v) => v.program) },
    });

    let visible = build(1200);
    const shown = withDom(() => M.syncProgramList(root, visible, ui(visible)));
    expect(shown).toBe(3);
    expect(root.children.length).toBe(2);
    const [alphaSection, betaSection] = root.children;
    const alphaBody = alphaSection.children[alphaSection.children.length - 1];
    const betaBody = betaSection.children[betaSection.children.length - 1];
    expect(alphaBody.children.length).toBe(3); // header + 2 rows
    const [, rowS1, rowS2] = alphaBody.children;
    const rowS3 = betaBody.children[1];

    // A token tick on codex:s1 — the production case. Everything else must be
    // the same node object it was, including both program sections.
    visible = build(40_000);
    withDom(() => M.syncProgramList(root, visible, ui(visible)));
    expect(root.children[0]).toBe(alphaSection);
    expect(root.children[1]).toBe(betaSection);
    expect(alphaBody.children[1]).not.toBe(rowS1);
    expect(alphaBody.children[2]).toBe(rowS2);
    expect(betaBody.children[1]).toBe(rowS3);
    expect(textOf(alphaBody.children[1])).toContain("40k");

    // A status flip DOES move the program rollup, so Beta's shell is rebuilt —
    // but its row node is re-adopted rather than reconstructed.
    visible = build(40_000, "attention");
    withDom(() => M.syncProgramList(root, visible, ui(visible)));
    expect(root.children[0]).toBe(alphaSection);
    expect(root.children[1]).not.toBe(betaSection);
    const newBetaBody = root.children[1].children[root.children[1].children.length - 1];
    expect(newBetaBody.children.length).toBe(2);
    expect(newBetaBody.children[1]).not.toBe(rowS3); // its own signature moved too
    // Alpha is untouched by Beta's rebuild.
    expect(alphaBody.children[2]).toBe(rowS2);
  });

  /* Regression: the alerted row that passed the filter and still never painted.
     programRollup prefers the SERVER's rollup, and the server counts needsYou
     over non-ended agents only. A live snapshot carried two programs whose agent
     read activity "ended" (transcript stopped) while its process was still
     running and its status was "attention" — server rollup needsYou: 0, so the
     program stayed collapsed and the row was dropped from the plan. The agent
     cleared the "now" filter and was invisible anyway. */
  test("(3) a program holding an alerted agent expands even when its server rollup says needsYou: 0", () => {
    const stranded = agent({
      id: "codex:w6-server",
      displayName: "Codex · w6-server",
      status: "attention",
      activity: "ended",
      outcome: "needs-you",
      processState: "running",
    });
    const program = {
      id: "cwd-w6-server",
      name: "w6-server",
      agents: [stranded],
      // Verbatim shape the server emitted for this program.
      rollup: { total: 1, live: 0, working: 0, idle: 0, ended: 1, needsYou: 0, blocked: 0, failed: 0, linked: 0 },
    };

    expect(M.viewMatches("now", stranded)).toBe(true); // clears the filter...
    expect(M.programOpen(program, listUi())).toBe(true); // ...and now also paints.

    const root = newNode("div");
    const visible = [{ program, agents: [stranded] }];
    const shown = withDom(() => M.syncProgramList(root, visible, listUi({
      snap: { schemaVersion: 1, programs: [program] },
    })));
    expect(shown).toBe(1);
    const body = root.children[0].children[root.children[0].children.length - 1];
    expect(body.children.length).toBe(2); // column header + the rescued row
    const rowText = textOf(body.children[1]);
    expect(rowText).toContain("Codex · w6-server");
    expect(rowText).toContain("Alert"); // and it reads as needing a human

    // The guard: a program of finished, healthy agents still collapses, so this
    // cannot expand the 60+ done programs on a real board.
    const quiet = {
      id: "cwd-done",
      name: "done",
      agents: [agent({ id: "codex:done", status: "archived", activity: "ended", outcome: "healthy" })],
      rollup: { total: 1, live: 0, working: 0, idle: 0, ended: 1, needsYou: 0, blocked: 0, failed: 0, linked: 0 },
    };
    expect(M.programOpen(quiet, listUi())).toBe(false);
  });

  /* -------- finding 1: the quarantine dead end -----------------------------
     Identity resolution refuses to bind a session, Focus and Send go dead, and
     the operator was given a fixed sentence with no reason and no way forward —
     while agent.identityTrace sat unread in the payload the client had already
     received, and GET /api/debug/identity sat unused beside it. */

  const CONFLICTED = {
    identityTrace: {
      resolution: "ambiguous",
      reason: "cmux 6952219A-6C2F-4A61-9C0E-1F0B2D3E4A55 has conflicting open agent session files on ttys082.",
      surfaceId: "SURFACE-82",
      steps: [
        { tier: "recorded", outcome: "skipped", detail: "No recorded cmux target IDs on this source." },
        { tier: "session", outcome: "quarantined", detail: "ttys082 has open session files for two providers." },
        { tier: "cwd", outcome: "no-match", detail: "Two terminals report the same working folder." },
      ],
    },
    target: { resolution: "ambiguous", surfaceId: "SURFACE-82" },
    controlState: "quarantined",
    controls: [
      { action: "focus", enabled: false, reason: "Identity conflict on ttys082." },
      { action: "instruct", enabled: false, reason: "Identity conflict on ttys082." },
    ],
  };

  const DEBUG_PAYLOAD = {
    ok: true,
    agent: { id: "codex:a1", resolution: "ambiguous" },
    relatedSurfaces: [{
      surfaceId: "SURFACE-82",
      tty: "ttys082",
      identityConflict: "Two providers hold open session files on this terminal.",
      identityTrace: {
        surfaceId: "SURFACE-82",
        tty: "ttys082",
        processes: [
          { pid: 4242, command: "codex resume 019f94a1", recognizedAgentProcess: true },
          { pid: 5150, command: "claude --resume", recognizedAgentProcess: true },
          { pid: 9001, command: "zsh", recognizedAgentProcess: false },
        ],
        openFileMatches: [
          { pid: 4242, path: "/Users/me/.codex/sessions/019f94a1-....jsonl", provider: "codex", sessionId: "019f94a1-1558-7000-aeb8-26e2cfd0e8ec" },
          { pid: 5150, path: "/Users/me/.claude/projects/p/c0eb6d3f-....jsonl", provider: "claude", sessionId: "c0eb6d3f-9a41-7000-b2aa-77c1f0e93b21" },
        ],
        commandHints: [],
        outcome: "conflict",
        sourceSessionIds: ["019f94a1-1558-7000-aeb8-26e2cfd0e8ec", "c0eb6d3f-9a41-7000-b2aa-77c1f0e93b21"],
      },
    }],
  };

  test("(1) the trace the payload already carried becomes a normalized view", () => {
    const view = M.identityTraceView(agent(CONFLICTED));
    expect(view.resolution).toBe("ambiguous");
    expect(view.matchedTier).toBeNull();
    expect(view.reason).toContain("ttys082");
    expect(view.steps.map((s: { tier: string }) => s.tier)).toEqual(["recorded", "session", "cwd"]);
    expect(view.steps[1]).toMatchObject({
      tierLabel: "Session ID on a terminal",
      outcome: "quarantined",
      outcomeLabel: "quarantined",
    });
    // A bound session still reports which tier bound it.
    const bound = M.identityTraceView(agent({
      identityTrace: { resolution: "exact", matchedTier: "session", surfaceId: "s1", steps: [{ tier: "session", outcome: "matched", detail: "Session ID recorded by cmux." }] },
    }));
    expect(bound.matchedTier).toBe("session");
    // An agent with no trace at all degrades to its target, never to a guess.
    const bare = M.identityTraceView(agent());
    expect(bare.resolution).toBe("exact");
    expect(bare.steps).toEqual([]);
    expect(bare.reason).toBeNull();
  });

  test("(1) a quarantined session gets a reason and a next step, not just 'no'", () => {
    const brief = M.quarantineBrief(agent(CONFLICTED), "quarantined");
    expect(brief.title).toBe("Control routing locked.");
    expect(brief.cause).toBe("contested-terminal");
    expect(brief.why).toContain("More than one session claims the same terminal");
    // The whole point: a way forward, and one that does not require a restart.
    expect(brief.nextStep).toContain("End or close one of the sessions sharing that terminal");

    /* The shape the LIVE board actually produces: every one of the 9 quarantined
       sessions on 127.0.0.1:4701 resolves "ambiguous" having refused at the cwd
       tier, not the session tier — so keying the copy off the resolution alone
       would have told all of them to close a terminal that is not the problem. */
    const sharedFolder = M.quarantineBrief(agent({
      identityTrace: {
        resolution: "ambiguous",
        reason: "2 active sources share this cwd; cwd fallback requires exactly one and controls are disabled.",
        steps: [
          { tier: "recorded", outcome: "skipped", detail: "No recorded cmux target IDs on this source." },
          { tier: "session", outcome: "no-match", detail: "Source session ID is not present on any ready cmux surface this scan." },
          { tier: "cwd", outcome: "ambiguous", detail: "2 active sources share this cwd; cwd fallback requires exactly one." },
        ],
      },
    }), "quarantined");
    expect(sharedFolder.cause).toBe("shared-folder");
    expect(sharedFolder.why).toContain("shares its working folder");
    expect(sharedFolder.nextStep).toContain("own cmux pane");

    // Observed-only with nothing claiming it is a third failure, third next step.
    const observed = M.quarantineBrief(agent({ target: { resolution: "missing" } }), "observed-only");
    expect(observed.title).toBe("Controls unavailable.");
    expect(observed.cause).toBe("missing");
    expect(observed.nextStep).toContain("cmux pane");
    // The three causes really do read differently — this is not one string thrice.
    expect(new Set([brief.nextStep, sharedFolder.nextStep, observed.nextStep]).size).toBe(3);
    // A healthy session gets no banner at all.
    expect(M.quarantineBrief(agent(), "linked")).toBeNull();
  });

  test("(1) the control banner names the reason and the exit, and leaks no cmux identifiers", () => {
    const locked = agent(CONFLICTED);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const banner: any = withDom(() => M.renderControlBanner(locked, "quarantined"));
    expect(banner).not.toBeNull();
    const text = textOf(banner);
    expect(text).toContain("Control routing locked.");
    expect(text).toContain("More than one session claims the same terminal");
    expect(text).toContain("End or close one of the sessions sharing that terminal");
    expect(text).toContain("See routing evidence");
    // The established Operate-chrome rule holds: raw cmux/session identifiers
    // live in Evidence, never in the banner — even though the trace is full of
    // them and the capability reasons name the tty.
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    expect(text).not.toContain("ttys082");
    expect(text).not.toContain("SURFACE-82");
    // The evidence link is focus-restorable like every other repainted control.
    const link = buttonsOf(banner)[0];
    expect(link.dataset.fkey).toBe("control-evidence:codex:a1");
    // A linked session still renders no banner.
    expect(withDom(() => M.renderControlBanner(agent({ controls: [{ action: "focus", enabled: true }] }), "linked"))).toBeNull();
  });

  test("(1) Evidence renders the tier trail the resolver actually walked", () => {
    const locked = agent(CONFLICTED);
    const evidence = withDom(() => M.renderEvidence(locked));
    const block = byClass(evidence, "identity-block");
    expect(block).not.toBeNull();
    const text = textOf(block);
    expect(text).toContain("Not bound");
    expect(text).toContain("ambiguous");
    // Every tier the resolver walked, in order, with its own words. THIS is
    // where the raw identifiers belong.
    expect(text).toContain("No recorded cmux target IDs on this source.");
    expect(text).toContain("ttys082 has open session files for two providers.");
    expect(text).toContain("Two terminals report the same working folder.");
    expect(allByClass(block, "identity-step").length).toBe(3);
    // Terminal evidence is opt-in — a button until the operator asks for it.
    const load = buttonsOf(block).find((b) => String(b.dataset.fkey).startsWith("identity-load:"));
    expect(load).toBeDefined();
    expect(textOf(load)).toContain("Show which terminals claim this session");
    // A healthy session with no trace grows no block at all.
    expect(byClass(withDom(() => M.renderEvidence(agent())), "identity-block")).toBeNull();
  });

  test("(1) debug-endpoint evidence becomes 'this tty has both of these sessions open'", () => {
    const collisions = M.surfaceCollisions(DEBUG_PAYLOAD);
    expect(collisions.length).toBe(1);
    expect(collisions[0]).toMatchObject({ surfaceId: "SURFACE-82", tty: "ttys082" });
    expect(collisions[0].claims.length).toBe(2);
    // The process that is NOT holding a session file is not presented as a claim.
    expect(collisions[0].claims.map((c: { pid: number }) => c.pid)).toEqual([4242, 5150]);

    const line = M.collisionLine(collisions[0]);
    expect(line).toContain("ttys082");
    expect(line).toContain("2 sessions claim it");
    expect(line).toContain("Codex 019f94a1…");
    expect(line).toContain("Claude c0eb6d3f…");
    expect(line).toContain("pid 4242, codex resume 019f94a1");
    expect(line).toContain("pid 5150, claude --resume");

    // An uncontested terminal reads as one session, and an empty one says so
    // rather than implying a conflict that is not there.
    expect(M.collisionLine({ tty: "ttys001", surfaceId: "S1", conflict: "", claims: [{ provider: "claude", sessionId: "abcdefghijkl", pid: 7, command: "claude" }] }))
      .toBe("ttys001 — one session open: Claude abcdefgh… (pid 7, claude)");
    expect(M.collisionLine({ tty: "", surfaceId: "S9", conflict: "", claims: [] }))
      .toBe("S9 — no open agent session files observed.");
    expect(M.surfaceCollisions(null)).toEqual([]);
  });

  test("(1) fetched terminal evidence reaches the screen and moves the drawer signature", () => {
    const locked = agent(CONFLICTED);
    const loaded = { agentId: "codex:a1", loading: false, error: "", data: DEBUG_PAYLOAD };
    const block = withDom(() => M.renderIdentityBlock(locked, { identity: loaded }));
    const text = textOf(block);
    expect(text).toContain("ttys082 — 2 sessions claim it");
    expect(text).toContain("Two providers hold open session files on this terminal.");
    expect(byClass(block, "is-contested")).not.toBeNull();

    // Failure is reported, never smoothed into "no conflicts found".
    const failed = withDom(() => M.renderIdentityBlock(locked, {
      identity: { agentId: "codex:a1", loading: false, error: "HTTP 404", data: null },
    }));
    expect(textOf(failed)).toContain("Terminal evidence unavailable: HTTP 404");
    expect(buttonsOf(failed).some((b) => textOf(b) === "Retry")).toBe(true);

    // Evidence that arrives while nothing else changed must still repaint: the
    // drawer signature is the only thing standing between the fetch and the DOM.
    const program = { id: "p", name: "P", agents: [locked] };
    const view = { kind: "agent", agent: locked, program };
    const sel = { kind: "agent", id: "codex:a1" };
    const base = M.inspectorPaintSig(sel, view, identityUi());
    expect(M.inspectorPaintSig(sel, view, identityUi({ identity: { agentId: "codex:a1", loading: true, error: "", data: null } }))).not.toBe(base);
    expect(M.inspectorPaintSig(sel, view, identityUi({ identity: loaded }))).not.toBe(base);
    expect(M.inspectorPaintSig(sel, view, identityUi({ identity: { agentId: "codex:a1", loading: false, error: "HTTP 404", data: null } }))).not.toBe(base);
    // Another agent's evidence must not repaint this drawer.
    expect(M.inspectorPaintSig(sel, view, identityUi({ identity: { agentId: "codex:other", loading: false, error: "", data: DEBUG_PAYLOAD } }))).toBe(base);
    // And a trace that changes repaints, now that the drawer renders it.
    const rebound = { ...locked, identityTrace: { ...CONFLICTED.identityTrace, resolution: "exact", matchedTier: "session" } };
    expect(M.inspectorPaintSig(sel, { kind: "agent", agent: rebound, program }, identityUi())).not.toBe(base);
  });

  /* -------- findings 5 + 12: five unreachable render functions -------------
     They were kept alive only by regexes that matched app.js's source TEXT —
     function names, their ordering, even the blank lines between them. Those
     assertions were replaced with the rendered-DOM ones above and below, and
     the functions deleted. What the drawer actually builds is the contract. */
  test("(5) the agent drawer builds Operate + Chat + the Evidence rail, and no swarm section", () => {
    const a = agent({
      lastHumanMessage: "ship it",
      lastAgentMessage: "done",
      cwd: "/repos/x",
      controls: [{ action: "focus", enabled: true }, { action: "instruct", enabled: true }],
    });
    const program = { id: "p", name: "P", agents: [a] };
    const drawer = withDom(() => {
      const pane = newNode("div");
      M.renderAgentDrawer(pane, { kind: "agent", agent: a, program });
      return pane;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shelves = findAll(drawer, (n: any) => n.dataset && n.dataset.shelf).map((n) => n.dataset.shelf);
    expect(shelves).toEqual(["operate", "chat"]);
    expect(byClass(drawer, "shelf-evidence-rail")).not.toBeNull();
    // renderSwarmSection's output — the thing the "do not delete" comment was
    // protecting — is nowhere in the drawer; renderLineageSpine superseded it.
    expect(byClass(drawer, "swarm-section")).toBeNull();
    expect(byClass(drawer, "swarm-link")).toBeNull();
    // The command dock still owns the lock copy renderPrimaryActions claimed to
    // keep "discoverable" — proof the alias carried nothing of its own.
    expect(textOf(drawer)).toContain("Send");
  });

  /* -------- finding 9: the shadowed `state` identifier ---------------------- */
  test("(9) modelPolicyView returns the same shape after the shadow rename", () => {
    // The rename must be invisible at the boundary: violation → mismatch,
    // unverified → unreported, and the summary keyed off the NORMALIZED state.
    expect(M.modelPolicyView(agent({ modelPolicy: { state: "violation" } }))).toEqual({
      state: "mismatch",
      label: "Model mismatch",
      expected: null,
      summary: "The reported model is outside the approved model policy.",
    });
    expect(M.modelPolicyView(agent({ modelPolicy: { state: "unverified" } }))).toEqual({
      state: "unreported",
      label: "Model unreported",
      expected: null,
      summary: "The model is unavailable, so policy compliance cannot be verified.",
    });
    expect(M.modelPolicyView(agent({ modelPolicy: { state: "compliant" } })).summary)
      .toBe("The reported model matches the approved model policy.");
    // No identifier named `state` is declared inside the function any more.
    const fn = source.match(/function modelPolicyView\(agent\) \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn).not.toMatch(/\bconst state\b/);
  });
});

/* ---------------------------------------------------------------------------
   WAVE 3 / FE-C — the four things the operator could not do.

   Finding 1: :4701 served a 91-hour-frozen snapshot while the UI read "Live".
   Wave 1 fixed the BADGE. A badge is something you have to go and look at; the
   failure was that the operator looked at the board and believed it. This block
   pins the alarm, the clocks and the controls all keying off ONE predicate, so
   they can never disagree about whether the board is trustworthy.
   ------------------------------------------------------------------------- */

const FROZEN_AT = "2026-07-24T12:42:29.656Z";   // the real generatedAt on the wedged box
const FROZEN_NOW = Date.parse("2026-07-28T08:00:00.000Z"); // ~91h later

describe("FE-C: a frozen feed is announced, not merely available on inspection", () => {
  test("(1) the alarm fires on DATA age — a live socket cannot talk it down", () => {
    const now = FROZEN_NOW;
    // Fresh data: no alarm, whatever the transport thinks.
    expect(M.feedAlarm("live", new Date(now - 3_000).toISOString(), now)).toBeNull();
    expect(M.feedAlarm("reconnecting", new Date(now - 3_000).toISOString(), now)).toBeNull();
    // The exact production failure: conn === "live" (the server heartbeats every
    // 25s from a timer that knows nothing about the collector) over a snapshot
    // generated four days ago. The alarm must fire anyway.
    const alarm = M.feedAlarm("live", FROZEN_AT, now);
    expect(alarm).not.toBeNull();
    expect(alarm.kind).toBe("frozen");
    expect(alarm.headline).toContain("Feed frozen");
    expect(alarm.headline).toContain("4d");              // the age, in the headline
    expect(alarm.ageMs).toBeGreaterThan(91 * 3_600_000);
    // It names the consequence, not just the condition.
    expect(alarm.detail).toContain("Controls are held");
  });

  test("(1) it does not cry wolf: a merely lagging snapshot is not an alarm", () => {
    const now = FROZEN_NOW;
    // 30s > SNAPSHOT_FRESH_MS but <= SNAPSHOT_STALE_MS: "lagging", not stale.
    expect(M.snapshotFreshness(new Date(now - 30_000).toISOString(), now).state).toBe("lagging");
    expect(M.feedAlarm("live", new Date(now - 30_000).toISOString(), now)).toBeNull();
    // Nothing collected yet is not evidence of staleness — never invent one.
    expect(M.feedAlarm("connecting", null, now)).toBeNull();
    expect(M.feedAlarm("live", "not-a-date", now)).toBeNull();
    // 61s past the stale threshold does alarm.
    expect(M.feedAlarm("live", new Date(now - 61_000).toISOString(), now)).not.toBeNull();
  });

  test("(1) an unreachable server is its own alarm, with no invented age", () => {
    const alarm = M.feedAlarm("offline", FROZEN_AT, FROZEN_NOW);
    expect(alarm.kind).toBe("offline");
    expect(alarm.ageMs).toBeNull();               // no age claim we cannot support
    expect(alarm.headline).toContain("not updating");
  });

  test("(1) the alarm names the age and carries the one action that repairs it", () => {
    const alarm = M.feedAlarm("live", FROZEN_AT, FROZEN_NOW);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const node: any = withDom(() => M.feedAlarmNode(alarm));
    const text = textOf(node);
    expect(text).toContain("Feed frozen");
    expect(text).toContain("4d");
    expect(text).toContain("Refresh now");
    const refresh = buttonsOf(node);
    expect(refresh).toHaveLength(1);
    // Repainted chrome without an fkey loses keyboard focus on every snapshot.
    expect(refresh[0].dataset.fkey).toBe("feed-alarm-refresh");
    // Offline gets the severed-node mark, not the advisory diamond.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const offline: any = withDom(() => M.feedAlarmNode(M.feedAlarm("offline", null, FROZEN_NOW)));
    expect(byClass(offline, "is-offline")).not.toBeNull();
  });

  test("(1) tickClocks stops extrapolating a dead agent's uptime while the feed is frozen", () => {
    const base = 60_000;
    const from = "2026-07-24T12:42:29.656Z";
    const now = Date.parse(from) + 5_000;
    // Healthy board: the clock advances with wall time, exactly as before.
    expect(M.elapsedTickText(base, from, now, false)).toBe("65s");
    // Frozen board: it HOLDS at the value the snapshot actually reported. The
    // bug was that this number kept climbing for four days, which made a dead
    // agent the most convincingly alive thing on the page.
    expect(M.elapsedTickText(base, from, FROZEN_NOW, true)).toBe("60s");
    expect(M.elapsedTickText(base, from, FROZEN_NOW, false)).toBe("4d"); // the lie, for contrast
    // Unreadable datasets yield null rather than "—" written over a real value.
    expect(M.elapsedTickText("nope", from, now, false)).toBeNull();
    expect(M.elapsedTickText(base, "nope", now, false)).toBeNull();
    expect(M.elapsedTickText(base, "nope", now, true)).toBe("60s"); // frozen needs no `from`
  });

  test("(1) the 5s clock tick itself holds — not merely the helper it calls", () => {
    // End-to-end over the real loop: tickClocks walks [data-elapsed-base] nodes
    // and rewrites them in place, which is where the four-day lie was painted.
    const uptime = newNode("div");
    uptime.dataset.elapsedBase = "60000";
    uptime.dataset.elapsedFrom = FROZEN_AT;
    const ago = newNode("div");
    ago.dataset.ago = FROZEN_AT;
    const doc = {
      querySelectorAll: (sel: string) =>
        (sel === "[data-elapsed-base]" ? [uptime] : sel === "[data-ago]" ? [ago] : []),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const withStub = (fn: () => void) => {
      (globalThis as unknown as { document: unknown }).document = doc;
      try { fn(); } finally { delete (globalThis as unknown as { document?: unknown }).document; }
    };

    withStub(() => M.tickClocks(false, FROZEN_NOW));
    expect(uptime.textContent).toBe("4d");                 // the bug, reproduced
    expect(uptime.classList.contains("is-frozen")).toBe(false);

    withStub(() => M.tickClocks(true, FROZEN_NOW));
    expect(uptime.textContent).toBe("60s");                // held at the reported value
    expect(uptime.classList.contains("is-frozen")).toBe(true);

    // "4d ago" is a real distance from a real past moment — freezing it would
    // replace one lie with another, so it keeps ticking.
    expect(ago.textContent).toContain("ago");
  });

  test("(1) one predicate drives the alarm, the clocks and the controls", () => {
    for (const [conn, at] of [["live", FROZEN_AT], ["offline", null], ["live", null]] as [string, string | null][]) {
      expect(M.clocksFrozen(conn, at, FROZEN_NOW)).toBe(M.feedAlarm(conn, at, FROZEN_NOW) !== null);
    }
    // feedFrozen reads the same rule off a state-shaped object.
    expect(M.feedFrozen({ conn: "live", snap: { generatedAt: FROZEN_AT } }, FROZEN_NOW)).toBe(true);
    expect(M.feedFrozen({ conn: "live", snap: { generatedAt: new Date(FROZEN_NOW).toISOString() } }, FROZEN_NOW)).toBe(false);
    expect(M.feedFrozen({ conn: "connecting", snap: null }, FROZEN_NOW)).toBe(false);
  });

  test("(1) every control in the dock is held — and says so — on a frozen board", () => {
    const live = agent({
      controls: [
        { action: "focus", enabled: true },
        { action: "instruct", enabled: true },
        { action: "interrupt", enabled: true },
        { action: "archive", enabled: true },
      ],
    });
    const alarm = M.feedAlarm("live", FROZEN_AT, FROZEN_NOW);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ok: any = withDom(() => M.renderCommandDock(live, "linked", null));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const heldDock: any = withDom(() => M.renderCommandDock(live, "linked", alarm));

    // Baseline: on a healthy board these controls are live.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const enabledOf = (n: any) => buttonsOf(n).map((b: any) => b.hasAttribute("disabled"));
    expect(enabledOf(ok).every((d: boolean) => d === false)).toBe(true);
    expect(byClass(ok, "command-dock-stale")).toBeNull();
    expect(byClass(ok, "command-dock--linked")).not.toBeNull();

    // Frozen: nothing is clickable, and the input cannot be typed into either.
    expect(enabledOf(heldDock).every((d: boolean) => d === true)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const input: any = findAll(heldDock, (n: any) => n.tagName === "input")[0];
    expect(input.hasAttribute("disabled")).toBe(true);
    expect(input.attributes.placeholder).toContain("Held");
    // The reason is stated, and it is about the FEED — not a routing capability
    // reason, which this chrome is forbidden to echo.
    const note = byClass(heldDock, "command-dock-stale");
    expect(note).not.toBeNull();
    expect(textOf(note)).toContain("out of date");
    // "Ready · linked" is a claim the board cannot support while frozen.
    expect(textOf(heldDock)).not.toContain("Ready · linked");
  });

  test("(1) the held reason is about the feed, and offline vs frozen read differently", () => {
    expect(M.staleControlNote(null)).toBe("");
    expect(M.staleControlNote(M.feedAlarm("offline", null, FROZEN_NOW))).toContain("unreachable");
    const frozen = M.staleControlNote(M.feedAlarm("live", FROZEN_AT, FROZEN_NOW));
    expect(frozen).toContain("4d");
    expect(frozen).toContain("Refresh");
  });

  test("(1) a feed that freezes under an OPEN drawer repaints its held controls", () => {
    // Found by driving the real boot path, not by reading the code: when the
    // feed freezes, generatedAt is not in this signature and agentRecordSig is
    // byte-identical across the frozen refresh, so the drawer never repainted —
    // the dock kept offering live-looking Focus/Send over four-day-old routing.
    const a = agent();
    const sel = { kind: "agent", id: a.id };
    const view = { kind: "agent", agent: a, program: { id: "p", name: "P", agents: [] } };
    const fresh = identityUi({ conn: "live", snap: { generatedAt: new Date().toISOString(), programs: [] } });
    const stuck = identityUi({ conn: "live", snap: { generatedAt: FROZEN_AT, programs: [] } });
    expect(M.inspectorPaintSig(sel, view, stuck)).not.toBe(M.inspectorPaintSig(sel, view, fresh));
    // And an unreachable server is the same story.
    expect(M.inspectorPaintSig(sel, view, identityUi({ ...fresh, conn: "offline" })))
      .not.toBe(M.inspectorPaintSig(sel, view, fresh));
  });

  test("(1) a board that freezes mid-compose repaints the broadcast dock", () => {
    const recipients = [{ agent: agent({ status: "running", controls: [{ action: "instruct", enabled: true }] }), program: { id: "p", name: "P", agents: [] } }];
    // broadcastPaintSig reads the wall clock (it is called during a real paint),
    // so "fresh" here has to be a snapshot generated a moment ago.
    const fresh = { conn: "live", snap: { generatedAt: new Date().toISOString() }, broadcastResults: null, broadcastConfirming: false, broadcastPending: false, broadcastError: "" };
    const stuck = { ...fresh, snap: { generatedAt: FROZEN_AT } };
    // The guard exists so the dock does not strobe; it must still notice this.
    expect(M.broadcastPaintSig(recipients, recipients, stuck))
      .not.toBe(M.broadcastPaintSig(recipients, recipients, fresh));
    // …and typing still must not move it (FE-A's live-input rule, unchanged).
    expect(M.broadcastPaintSig(recipients, recipients, { ...fresh, broadcastDraft: "half a sentence" }))
      .toBe(M.broadcastPaintSig(recipients, recipients, fresh));
  });
});

/* ---------------------------------------------------------------------------
   Finding 2: reading what an agent actually did required leaving the dashboard.
   The snapshot carries a fixed 800-char tail; the decision the operator makes
   most often — "this lane claims done, is that true?" — cannot be made from it.

   The route is being built in a parallel lane and does not exist here, so the
   degrade path is as important as the happy path and is tested first.
   ------------------------------------------------------------------------- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transcriptUi(over: Record<string, unknown> = {}): any {
  return { transcript: { agentId: null, loading: false, error: "", data: null, limit: 200, ...over } };
}

describe("FE-C: the transcript is readable inside the drawer", () => {
  test("(2) the request names an agent and a bounded line budget — never a path", () => {
    expect(M.transcriptUrl("claude:abc-123", 200)).toBe("/api/transcript?agent=claude%3Aabc-123&limit=200");
    // The contract's hard max is 1000 and the floor is 1; a caller cannot widen it.
    expect(M.transcriptUrl("a", 99999)).toContain("limit=1000");
    expect(M.clampTranscriptLimit(0)).toBe(1);
    expect(M.clampTranscriptLimit(5000)).toBe(1000);
    expect(M.clampTranscriptLimit("nonsense")).toBe(200);
    expect(M.clampTranscriptLimit(350)).toBe(350);
    // "Load more" walks a fixed ladder and stops at the ceiling.
    expect(M.nextTranscriptLimit(200)).toBe(500);
    expect(M.nextTranscriptLimit(500)).toBe(1000);
    expect(M.nextTranscriptLimit(1000)).toBeNull();
  });

  test("(2) a build without the route says so — it never claims the agent is silent", () => {
    // The exact shape a server with no such route returns: 404, non-JSON body.
    expect(M.transcriptFailureText(404, null)).toBe("Transcript view is not available in this build.");
    // …which must NOT be confused with the contract's real 404.
    expect(M.transcriptFailureText(404, { ok: false, error: { code: "AGENT_NOT_FOUND" } }))
      .toContain("no longer tracked");
    expect(M.transcriptFailureText(0, null)).toContain("Could not reach the server");
    const other = M.transcriptFailureText(500, { ok: false, error: { code: "READ_FAILED", message: "EACCES" } });
    expect(other).toContain("READ_FAILED");
    expect(other).toContain("EACCES");
    // Every degrade names the failure; none of them is silence or a spinner.
    for (const text of [M.transcriptFailureText(404, null), M.transcriptFailureText(0, null), other]) {
      expect(text.length).toBeGreaterThan(10);
    }
  });

  test("(2) the wire payload is defended: no invented content, no invented source", () => {
    const view = M.normalizeTranscript({
      ok: true,
      source: "/Users/e/.claude/projects/x/3de6d691.jsonl",
      truncated: true,
      lines: [
        { at: "2026-07-28T09:12:03.114Z", role: "assistant", text: "pushed the branch" },
        { at: "not-a-date", role: "wizard", text: "odd role and odd time" },
        { at: null, role: "tool", text: "" },
        { role: "user", text: { nope: 1 } },      // non-string text is dropped…
        null,                                     // …as is a non-object row
      ],
    });
    expect(view.source).toBe("/Users/e/.claude/projects/x/3de6d691.jsonl");
    expect(view.truncated).toBe(true);
    expect(view.lines).toHaveLength(3);
    expect(view.lines[1].role).toBe("unknown");   // unknown role collapses, not passed through
    expect(view.lines[1].at).toBeNull();          // an unparseable time becomes absent
    expect(view.lines[2].text).toBe("");          // an empty turn is still a turn
    // An honest empty answer stays empty — source null, zero lines, no filler.
    const empty = M.normalizeTranscript({ ok: true, source: null, truncated: false, lines: [] });
    expect(empty).toEqual({ source: null, truncated: false, lines: [] });
    expect(M.normalizeTranscript({ ok: true }).lines).toEqual([]);
  });

  test("(2) a very long transcript is windowed, and says how much it is hiding", () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ at: null, role: "assistant", text: "turn " + i }));
    const win = M.transcriptWindow(many);
    expect(win.shown).toHaveLength(300);          // the cap — never 1000 nodes
    expect(win.hidden).toBe(700);
    expect(win.total).toBe(1000);
    expect(win.shown[299].text).toBe("turn 999"); // the window is the TAIL
    // Under the cap nothing is hidden and nothing is copied away.
    const few = many.slice(0, 12);
    expect(M.transcriptWindow(few)).toEqual({ shown: few, hidden: 0, total: 12 });
  });

  test("(2) untrusted transcript text reaches the DOM as text, never as markup", () => {
    const hostile = "<img src=x onerror=alert(1)> & <script>steal()</script>";
    const a = agent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const panel: any = withDom(() => M.renderTranscriptPanel(a, transcriptUi({
      agentId: a.id,
      data: { source: "/tmp/t.jsonl", truncated: false, lines: [{ at: null, role: "assistant", text: hostile }] },
    })));
    const body = byClass(panel, "tr-text");
    // el({ text }) assigns textContent. If it ever became an attribute or markup
    // assignment, the string would not be the node's own textContent.
    expect(body.textContent).toBe(hostile);
    expect(body.children).toHaveLength(0);
    expect(body.attributes.text).toBeUndefined();
  });

  test("(2) the drawer covers all four states: unloaded, empty, loaded, failed", () => {
    const a = agent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const render = (over: Record<string, unknown>): any =>
      withDom(() => M.renderTranscriptPanel(a, transcriptUi(over)));

    // Unloaded: one opt-in control, because fetching a transcript for every
    // drawer open would hammer the server for a panel nobody asked for.
    const idle = render({});
    expect(textOf(idle)).toContain("Read the transcript");
    expect(buttonsOf(idle)[0].dataset.fkey).toBe("transcript-load:codex:a1");

    // Loading: a stated status, and loadTranscript always settles into data or
    // an error, so this is never an endless spinner.
    expect(textOf(render({ agentId: a.id, loading: true }))).toContain("Reading the transcript");

    // Failed: the reason, plus a way out.
    const failed = render({ agentId: a.id, error: "Transcript view is not available in this build." });
    expect(textOf(failed)).toContain("not available in this build");
    expect(buttonsOf(failed).map((b: { dataset: { fkey: string } }) => b.dataset.fkey)).toEqual(["transcript-retry:codex:a1"]);

    // Empty: honest about which kind of empty it is, and never invents a turn.
    const noFile = render({ agentId: a.id, data: { source: null, truncated: false, lines: [] } });
    expect(textOf(noFile)).toContain("No transcript file is recorded");
    expect(allByClass(noFile, "tr-line")).toHaveLength(0);
    const emptyFile = render({ agentId: a.id, data: { source: "/tmp/t.jsonl", truncated: false, lines: [] } });
    expect(textOf(emptyFile)).toContain("no readable turns");

    // Loaded: the turns, the count, the source, and a bounded node count.
    const lines = Array.from({ length: 400 }, (_, i) => ({ at: null, role: "assistant", text: "turn " + i }));
    const loaded = render({ agentId: a.id, limit: 500, data: { source: "/tmp/t.jsonl", truncated: true, lines } });
    expect(allByClass(loaded, "tr-line")).toHaveLength(300);
    expect(textOf(loaded)).toContain("Last 300 of 400");
    expect(textOf(loaded)).toContain("older turns exist above this window");
    expect(textOf(loaded)).toContain("/tmp/t.jsonl");
    // Refresh, and one step up the ladder — every repainted control keyed.
    const keys = buttonsOf(loaded).map((b: { dataset: { fkey: string } }) => b.dataset.fkey);
    expect(keys).toEqual(["transcript-refresh:codex:a1", "transcript-more:codex:a1"]);
    // At the ceiling there is no "load more" to offer.
    const maxed = render({ agentId: a.id, limit: 1000, data: { source: "/tmp/t.jsonl", truncated: true, lines } });
    expect(buttonsOf(maxed).map((b: { dataset: { fkey: string } }) => b.dataset.fkey))
      .toEqual(["transcript-refresh:codex:a1"]);
  });

  test("(2) another agent's transcript never bleeds into this drawer", () => {
    const a = agent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const panel: any = withDom(() => M.renderTranscriptPanel(a, transcriptUi({
      agentId: "claude:someone-else",
      data: { source: "/tmp/other.jsonl", truncated: false, lines: [{ at: null, role: "assistant", text: "NOT MINE" }] },
    })));
    expect(textOf(panel)).not.toContain("NOT MINE");
    expect(textOf(panel)).toContain("Read the transcript");
  });

  test("(2) the panel lives in Evidence, and a landed fetch actually repaints it", () => {
    const a = agent({ transcriptTail: "…tail" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const evidence: any = withDom(() => M.renderEvidence(a, transcriptUi()));
    expect(byClass(evidence, "transcript-view")).not.toBeNull();

    // Without the drawer signature tracking it, the fetched turns would sit in
    // state and never reach the screen — the exact failure mode identity had.
    const sel = { kind: "agent", id: a.id };
    const view = { kind: "agent", agent: a, program: { id: "p", name: "P", agents: [] } };
    const base = M.inspectorPaintSig(sel, view, identityUi(transcriptUi()));
    for (const [why, over] of [
      ["loading", { agentId: a.id, loading: true }],
      ["error", { agentId: a.id, error: "Transcript view is not available in this build." }],
      ["landed", { agentId: a.id, data: { source: "/tmp/t.jsonl", truncated: false, lines: [{ at: null, role: "user", text: "hi" }] } }],
      ["widened", { agentId: a.id, limit: 500 }],
    ] as [string, Record<string, unknown>][]) {
      expect(M.inspectorPaintSig(sel, view, identityUi(transcriptUi(over))), why).not.toBe(base);
    }
    // A transcript belonging to a different agent must not move this signature.
    expect(M.inspectorPaintSig(sel, view, identityUi(transcriptUi({
      agentId: "claude:other", data: { source: "/x", truncated: false, lines: [] },
    })))).toBe(base);
  });
});

/* ---------------------------------------------------------------------------
   Finding 3: what was broadcast, to whom, and whether it landed lived only in
   client memory and died on reload. A broadcast reaches up to 50 agents and
   instruct is fire-and-forget text typed into a terminal, so the natural
   recovery after a refresh is to send it again — double-instructing lanes that
   already got it.
   ------------------------------------------------------------------------- */

function actionsUi(over: Record<string, unknown> = {}) {
  return { actions: { loading: false, error: "", available: true, items: [] as unknown[], fetchedAt: 1, ...over } };
}

const ACT = {
  delivered: { id: "act_01", at: "2026-07-28T09:12:03.114Z", kind: "instruct", agentIds: ["codex:a1"], outcome: "ok", detail: "typed and submitted" },
  staged: { id: "act_02", at: "2026-07-28T09:10:00.000Z", kind: "instruct", agentIds: ["codex:a1"], outcome: "staged", detail: "TEXT_STAGED_NOT_SUBMITTED" },
  failed: { id: "act_03", at: "2026-07-28T09:05:00.000Z", kind: "broadcast", agentIds: ["codex:a1", "claude:b", "claude:c", "claude:d"], outcome: "failed", detail: "0 of 4 recipients delivered" },
  partial: { id: "act_04", at: "2026-07-28T09:00:00.000Z", kind: "broadcast", agentIds: ["claude:b", "claude:c"], outcome: "partial", detail: "3 of 4 recipients delivered" },
};

describe("FE-C: operator actions survive a reload, failures included", () => {
  test("(3) the request is bounded and the payload is defended", () => {
    expect(M.actionsUrl()).toBe("/api/actions?limit=100");
    expect(M.actionsUrl(9999)).toBe("/api/actions?limit=500");   // the contract's hard cap
    expect(M.clampActionsLimit(0)).toBe(1);
    expect(M.clampActionsLimit("x")).toBe(100);

    const items = M.normalizeActions({
      ok: true,
      actions: [
        ACT.delivered,
        { ...ACT.staged, kind: "telepathy" },              // unknown kind: dropped
        { ...ACT.failed, id: "" },                          // no id: dropped
        { ...ACT.partial, at: "nonsense", agentIds: ["ok", 7, ""], outcome: "" },
        null,
      ],
    });
    expect(items.map((a: { id: string }) => a.id)).toEqual(["act_01", "act_04"]);
    expect(items[1].at).toBeNull();                         // unparseable time → absent
    expect(items[1].agentIds).toEqual(["ok"]);              // non-string ids dropped
    expect(items[1].outcome).toBe("unknown");               // never silently "ok"
    expect(M.normalizeActions({ ok: true }).length).toBe(0);
  });

  test("(3) every outcome the contract can return has its own word", () => {
    expect(M.actionOutcomeView("ok").label).toBe("Delivered");
    expect(M.actionOutcomeView("failed").label).toBe("Failed");
    expect(M.actionOutcomeView("partial").label).toBe("Partly delivered");
    // The one the operator most needs to see, and the reason a success-only log
    // is worse than none: text sat in a terminal and was never submitted.
    expect(M.actionOutcomeView("staged").label).toContain("not submitted");
    // The four are distinct — no two states share a word.
    const labels = ["ok", "failed", "partial", "staged"].map((o) => M.actionOutcomeView(o).label);
    expect(new Set(labels).size).toBe(4);
    // Tones separate the good from the bad, so scanning one column works.
    expect(M.actionOutcomeView("ok").tone).toBe("ok");
    expect(M.actionOutcomeView("failed").tone).toBe("err");
    // An outcome the server adds later reads as the server's own word.
    expect(M.actionOutcomeView("rejected").label).toBe("rejected");
    expect(M.actionOutcomeView(undefined).label).toBe("unknown");
  });

  test("(3) the log renders newest-first with failures and staged fully visible", () => {
    const items = [ACT.delivered, ACT.staged, ACT.failed, ACT.partial];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const panel: any = withDom(() => M.renderActionLog(actionsUi({ items }), (id: string) => (id === "codex:a1" ? "Ridge worker" : null)));
    const rows = allByClass(panel, "action-row");
    expect(rows).toHaveLength(4);
    // Contract order is newest-first; the view must not resort and lose it. The
    // detail strings are unique, so this pins position, not just membership.
    expect(rows.map((r: unknown) => textOf(r).includes(ACT.delivered.detail))).toEqual([true, false, false, false]);
    expect(items.map((a) => a.detail).every((d, i) => textOf(rows[i]).includes(d))).toBe(true);
    const text = textOf(panel);
    expect(text).toContain("Delivered");
    expect(text).toContain("not submitted");
    expect(text).toContain("Failed");
    expect(text).toContain("Partly delivered");
    // The failure's own words survive — "0 of 4 recipients delivered" is the
    // whole point, and a log that dropped it would read as four successes.
    expect(text).toContain("0 of 4 recipients delivered");
    // Recipients resolve to names where the snapshot still knows them, and a
    // fan-out collapses to a count instead of a wall of session ids.
    expect(text).toContain("Ridge worker");
    expect(text).toContain("4 sessions");
    // Outcome tone rides a data attribute so one column is scannable.
    expect(rows.map((r: { dataset: { tone: string } }) => r.dataset.tone)).toEqual(["ok", "warn", "err", "warn"]);
  });

  test("(3) recipients degrade honestly rather than dropping unknown sessions", () => {
    expect(M.actionRecipients({ agentIds: [] }, () => "x")).toBe("no recipients");
    // An agent gone from the snapshot keeps its raw id — never silently omitted
    // from the record of who was instructed.
    expect(M.actionRecipients({ agentIds: ["codex:gone"] }, () => null)).toBe("codex:gone");
    expect(M.actionRecipients({ agentIds: ["a", "b", "c"] }, (id: string) => id.toUpperCase())).toBe("A, B, C");
    expect(M.actionRecipients({ agentIds: ["a", "b", "c", "d"] }, () => "n")).toBe("4 sessions");
  });

  test("(3) an empty log, a loading log and a missing endpoint each read differently", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const render = (over: Record<string, unknown>): any => withDom(() => M.renderActionLog(actionsUi(over)));
    // Empty is empty — and says what WILL appear, including the failures.
    const empty = textOf(render({}));
    expect(empty).toContain("No operator actions recorded yet");
    expect(empty).toContain("including the ones that fail");
    expect(textOf(render({ loading: true }))).toContain("Reading the action log");
    // A build without the route says so; it never renders as "nothing happened".
    const missing = textOf(render({ error: "The action log is not available in this build." }));
    expect(missing).toContain("not available in this build");
    expect(missing).not.toContain("No operator actions recorded yet");
    expect(M.actionsFailureText(404, null)).toBe("The action log is not available in this build.");
    expect(M.actionsFailureText(0, null)).toContain("Could not reach the server");
    expect(M.actionsFailureText(500, { error: { code: "LOG_CORRUPT" } })).toContain("LOG_CORRUPT");
  });

  test("(3) the dock answers 'did I already send this?' next to the button that resends", () => {
    const live = agent({ controls: [{ action: "instruct", enabled: true }, { action: "focus", enabled: true }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const withLog: any = withDom(() => M.renderCommandDock(live, "linked", null, [ACT.staged, ACT.delivered]));
    const fact = byClass(withLog, "command-dock-last");
    expect(fact).not.toBeNull();
    // Newest-first: the staged one is the most recent, and staged is exactly the
    // case where resending blindly is the wrong move.
    expect(textOf(fact)).toContain("not submitted");
    expect(fact.dataset.tone).toBe("warn");

    // Silence before the log has loaded: an unanswered endpoint must never read
    // as "nothing was ever sent to this agent".
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const noLog: any = withDom(() => M.renderCommandDock(live, "linked", null, []));
    expect(byClass(noLog, "command-dock-last")).toBeNull();
    // An action for a different agent is not this agent's history.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const other: any = withDom(() => M.renderCommandDock(live, "linked", null, [ACT.partial]));
    expect(byClass(other, "command-dock-last")).toBeNull();
    expect(M.lastActionFor([ACT.partial], "codex:a1")).toBeNull();
    expect(M.lastActionFor([ACT.staged, ACT.delivered], "codex:a1").id).toBe("act_02");
  });

  test("(3) a new journal entry repaints the open drawer", () => {
    const a = agent();
    const sel = { kind: "agent", id: a.id };
    const view = { kind: "agent", agent: a, program: { id: "p", name: "P", agents: [] } };
    const base = M.inspectorPaintSig(sel, view, identityUi(actionsUi()));
    // A landed entry for this agent moves it…
    expect(M.inspectorPaintSig(sel, view, identityUi(actionsUi({ items: [ACT.delivered] })))).not.toBe(base);
    // …and so does the SAME entry coming back with a different outcome.
    expect(M.inspectorPaintSig(sel, view, identityUi(actionsUi({ items: [ACT.delivered] }))))
      .not.toBe(M.inspectorPaintSig(sel, view, identityUi(actionsUi({ items: [{ ...ACT.delivered, outcome: "failed" }] }))));
    // Someone else's action does not.
    expect(M.inspectorPaintSig(sel, view, identityUi(actionsUi({ items: [ACT.partial] })))).toBe(base);
  });
});

/* ---------------------------------------------------------------------------
   Finding 4: the operator had to keep the tab visible to learn an agent was
   waiting. grep for Notification / document.title / favicon / vibrate / Audio
   over app.js returned zero matches; the only attention affordances were the
   in-page beacon and the Alerts tab count.

   The firing RULE is the feature. A notifier that cries wolf gets muted, and
   then the feature is worthless — so these tests are mostly about silence.
   ------------------------------------------------------------------------- */

describe("FE-C: an agent that starts waiting reaches the operator outside the tab", () => {
  const waiting = (id: string) => agent({ id, status: "attention", outcome: "needs-you", displayName: id });
  const calm = (id: string) => agent({ id, status: "running", outcome: "healthy", displayName: id });
  const snapOf = (...agents: unknown[]) => snapshot({ programs: [{ id: "p", name: "P", agents }] });

  test("(4) 'needs a human' is the board's own verdict, not a second definition", () => {
    const snap = snapOf(
      waiting("codex:1"),
      agent({ id: "codex:2", outcome: "blocked" }),
      agent({ id: "codex:3", outcome: "failed" }),
      calm("codex:4"),
      // An ended session is not waiting for anyone, whatever it last reported.
      agent({ id: "codex:5", status: "archived", outcome: "needs-you" }),
    );
    expect(M.needsHumanIds(snap)).toEqual(["codex:1", "codex:2", "codex:3"]);
    expect(M.needsHumanIds(snapOf(calm("codex:4")))).toEqual([]);
    expect(M.needsHumanIds(null)).toEqual([]);
  });

  test("(4) it fires for a NEW waiter and stays silent for everything else", () => {
    // The one case worth interrupting someone for.
    const fired = M.notificationPlan(["codex:1"], ["codex:1", "codex:2"], (id: string) => "Lane " + id.slice(-1));
    expect(fired.fire).toBe(true);
    expect(fired.title).toBe("1 agent needs you");
    expect(fired.body).toBe("Lane 2");

    // Routine churn, all of which must be silent:
    expect(M.notificationPlan(["codex:1"], ["codex:1"]).fire).toBe(false);              // unchanged
    expect(M.notificationPlan(["codex:1", "codex:2"], ["codex:1"]).fire).toBe(false);   // one resolved
    expect(M.notificationPlan(["codex:1"], []).fire).toBe(false);                       // all cleared
    expect(M.notificationPlan([], []).fire).toBe(false);                                // quiet fleet
    // Same agents, different order off the wire — not news.
    expect(M.notificationPlan(["codex:1", "codex:2"], ["codex:2", "codex:1"]).fire).toBe(false);
    // A swap (one clears, one starts) IS news about the one that started.
    const swap = M.notificationPlan(["codex:1"], ["codex:2"]);
    expect(swap.fire).toBe(true);
    expect(swap.title).toBe("1 agent needs you");
  });

  test("(4) opening the page to a backlog is silent — a reload is not news", () => {
    // This is what stops the feature being unusable on a fleet of 200: the first
    // snapshot seeds the baseline, it does not announce it.
    const first = M.notificationPlan(null, ["codex:1", "codex:2", "codex:3"]);
    expect(first.fire).toBe(false);
    expect(first.reason).toBe("seeded");
    expect(first.ids).toEqual(["codex:1", "codex:2", "codex:3"]);
    // Only what arrives AFTER the baseline is announced.
    expect(M.notificationPlan(first.ids, ["codex:1", "codex:2", "codex:3"]).fire).toBe(false);
    expect(M.notificationPlan(first.ids, ["codex:1", "codex:2", "codex:3", "codex:4"]).fire).toBe(true);
  });

  test("(4) a burst names a few agents and counts the rest instead of listing 40", () => {
    const many = Array.from({ length: 40 }, (_, i) => "codex:" + i);
    const plan = M.notificationPlan([], many, (id: string) => id.toUpperCase());
    expect(plan.fire).toBe(true);
    expect(plan.title).toBe("40 agents need you");
    expect(plan.body).toBe("CODEX:0, CODEX:1, CODEX:10 and 37 more");
    // An agent the snapshot no longer names keeps its id rather than vanishing.
    expect(M.notificationPlan([], ["codex:gone"], () => null).body).toBe("codex:gone");
  });

  test("(4) delivery is gated: opted out, blocked and unsupported are all silent", () => {
    const plan = M.notificationPlan(["codex:1"], ["codex:1", "codex:2"]);
    const sent: { title: string; opts: { body: string; tag: string } }[] = [];
    class FakeNotification {
      constructor(title: string, opts: { body: string; tag: string }) { sent.push({ title, opts }); }
    }
    const granted = { enabled: true, permission: "granted" };

    expect(M.deliverNotification(plan, granted, FakeNotification)).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe(plan.title);
    // One tag, so a second burst REPLACES the first instead of stacking a pile
    // of notifications the operator has to dismiss.
    expect(sent[0].opts.tag).toBe("anthill-needs-you");

    // Every silent path, each with its own reason — never an ambiguous no-op.
    expect(M.deliverNotification(plan, { enabled: false, permission: "granted" }, FakeNotification)).toBe("muted");
    expect(M.deliverNotification(plan, { enabled: true, permission: "denied" }, FakeNotification)).toBe("not-granted");
    expect(M.deliverNotification(plan, granted, null)).toBe("unsupported");
    expect(M.deliverNotification({ fire: false, reason: "seeded" }, granted, FakeNotification)).toBe("seeded");
    // A browser that refuses to construct one degrades, it does not throw.
    const Broken = function Broken() { throw new Error("nope"); } as unknown as new () => unknown;
    expect(M.deliverNotification(plan, granted, Broken)).toBe("refused");
    expect(sent).toHaveLength(1); // nothing else was delivered
  });

  test("(4) the tab title carries the count without asking for anything", () => {
    const base = "The Ant Hill — operator console";
    expect(M.titleWithAlerts(base, 3)).toBe("(3) " + base);
    expect(M.titleWithAlerts(base, 0)).toBe(base);
    // Idempotent: repainting must not stack prefixes into "(3) (2) (1) …".
    expect(M.titleWithAlerts(M.titleWithAlerts(base, 3), 2)).toBe("(2) " + base);
    expect(M.titleWithAlerts(M.titleWithAlerts(base, 3), 0)).toBe(base);
  });

  /* F3: "Alerts off" sat silently beside four waiting agents. The button
     reported the delivery channel and never the backlog, so muting the channel
     also hid the work. The count must therefore survive every muted state. */
  test("(4) the waiting count rides every toggle state, muted and blocked included", () => {
    const off = M.notifyToggleView({ enabled: false, permission: "default" }, true, 4);
    expect(off.label).toBe("Alerts off");
    expect(off.count).toBe(4);
    expect(off.ariaLabel).toBe("Alerts off, 4 agents waiting on you");
    expect(off.title).toContain("4 waiting on you");

    // Blocked and unsupported are exactly the states where the operator has no
    // other channel — hiding the number there is the worst case, not a spared one.
    expect(M.notifyToggleView({ enabled: false, permission: "denied" }, true, 4).count).toBe(4);
    expect(M.notifyToggleView({ enabled: false, permission: "default" }, false, 4).count).toBe(4);

    // A quiet fleet stays quiet: no badge, no count noise in the label or title.
    const calmView = M.notifyToggleView({ enabled: true, permission: "granted" }, true, 0);
    expect(calmView.count).toBe(0);
    expect(calmView.ariaLabel).toBe("Alerts on");
    expect(calmView.title).not.toContain("waiting on you");
    // Singular reads as English, not "1 agents".
    expect(M.notifyToggleView({ enabled: false, permission: "default" }, true, 1).ariaLabel)
      .toBe("Alerts off, 1 agent waiting on you");

    // The badge is a real node carrying the digit, not text glued onto the label.
    expect(source).toContain('class: "notify-badge"');
    expect(source).toMatch(/btn\.setAttribute\("aria-label", view\.ariaLabel\)/);

    /* Placement rule, not style — this is the bug the unit tests above could
       not see. The toggle used to paint once in boot() and on click, which was
       fine for pure preference state. Now that it carries a snapshot-derived
       count it MUST paint inside render(), because boot() runs before the first
       snapshot exists: the count was always 0 and the badge never appeared on
       the real page even though every assertion above passed. */
    const renderFn = source.match(/\nfunction render\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    expect(renderFn).toContain("renderNotifyToggle()");
  });

  test("(4) permission is asked from a click and nowhere else, and denial is quiet", () => {
    // The control states an operator can actually reach.
    expect(M.notifyToggleView({ enabled: false, permission: "default" }, true).label).toBe("Alerts off");
    expect(M.notifyToggleView({ enabled: true, permission: "granted" }, true))
      .toMatchObject({ label: "Alerts on", pressed: true, disabled: false });
    // Denied: stated once, disabled, no nagging and no repeated prompt.
    const denied = M.notifyToggleView({ enabled: false, permission: "denied" }, true);
    expect(denied.disabled).toBe(true);
    expect(denied.label).toBe("Alerts blocked");
    expect(M.notifyToggleView({ enabled: false, permission: "default" }, false).disabled).toBe(true);

    // The one requestPermission call in the client is inside the click handler.
    // Asking on load is how a page gets denied permanently, which would disable
    // the feature forever — so this is a placement rule, not a style rule.
    expect(source.match(/requestPermission\(/g) ?? []).toHaveLength(1);
    const toggle = source.match(/async function toggleNotifications\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    expect(toggle).toContain("requestPermission(");
    const bootFn = source.match(/function boot\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    expect(bootFn).not.toContain("requestPermission(");
    expect(bootFn).toContain('$("notify-toggle").addEventListener("click"');
  });
});

/* ===========================================================================
   WAVE 4 / W4-B — the client meets the endpoints that now exist.

   Item 1 was live-verified against a scratch server on :4788 rather than a fake
   fetch: both read endpoints answer 403 ORIGIN_REJECTED to a browser, because a
   browser attaches no Origin header to a same-origin GET and `Origin` is a
   forbidden header name so fetch() cannot add one. The client cannot fix that;
   what it CAN do is say so honestly, which is what these tests pin.
   ========================================================================= */
describe("W4-B: read endpoints, liveness, attention, triage lifecycle", () => {
  test("(1) ORIGIN_REJECTED reads as a server refusal, not as a missing build", () => {
    const body = { ok: false, error: { code: "ORIGIN_REJECTED", message: "Transcript reads require an exact same-origin loopback Origin header." } };
    const transcript = M.transcriptFailureText(403, body);
    // Never the "this build" sentence: the route IS deployed, and sending the
    // operator to look for a deploy that already happened is the expensive lie.
    expect(transcript).not.toContain("not available in this build");
    expect(transcript).toContain("ORIGIN_REJECTED");
    // W5-B: was `toContain("same-origin GET")`. The server stopped requiring an
    // Origin header on these two GETs, so that sentence became false; the code
    // now means "you reached the server under a non-loopback hostname". The
    // replacement copy is pinned in full by the W5-B block below.
    expect(transcript).toContain("loopback");
    // Not a bare echo of the server's own sentence about HTTP internals.
    expect(transcript).not.toBe(body.error.message);

    const actions = M.actionsFailureText(403, { ok: false, error: { code: "ORIGIN_REJECTED", message: "Action-log reads require an exact same-origin loopback Origin header." } });
    expect(actions).not.toContain("not available in this build");
    expect(actions).toContain("loopback");

    // The other degradations are unchanged: a build with no route at all still
    // says so, and a missing agent still reads as a missing agent.
    expect(M.transcriptFailureText(404, null)).toBe("Transcript view is not available in this build.");
    expect(M.transcriptFailureText(404, { ok: false, error: { code: "AGENT_NOT_FOUND", message: "gone" } }))
      .toContain("no longer tracked");
    expect(M.actionsFailureText(404, null)).toBe("The action log is not available in this build.");
  });

  test("(1) the real /api/transcript envelope normalizes without loss", () => {
    // Captured from the live route on :4788 (45 lines, 4 roles, absolute source
    // path, truncated:false) — the shape FE-C built against, now confirmed.
    const wire = {
      ok: true,
      agentId: "codex:a1",
      source: "/Users/x/.codex/sessions/2026/07/28/rollout.jsonl",
      truncated: false,
      lines: [
        { at: "2026-07-28T20:45:39.752Z", role: "user", text: "Memory You have access to a memory folder" },
        { at: "2026-07-28T20:45:41.000Z", role: "tool", text: "ran ls" },
        { at: null, role: "assistant", text: "done" },
        { at: "2026-07-28T20:45:42.000Z", role: "reasoning", text: "collapses to unknown" },
      ],
    };
    const view = M.normalizeTranscript(wire);
    expect(view.source).toBe(wire.source);
    expect(view.truncated).toBe(false);
    expect(view.lines.map((l: any) => l.role)).toEqual(["user", "tool", "assistant", "unknown"]);
    expect(view.lines[2]!.at).toBeNull();
    // The server's limit ceiling is 1000 and the action log's is 500; asking for
    // more is a 400 INVALID_LIMIT, so the client must never ask for more.
    expect(M.transcriptUrl("codex:a1", 5000)).toBe("/api/transcript?agent=codex%3Aa1&limit=1000");
    expect(M.actionsUrl(5000)).toBe("/api/actions?limit=500");
  });

  test("(3) liveness is absent-first and never infers death", () => {
    // Absent: no verdict at all, so nothing new renders anywhere.
    expect(M.livenessState(agent())).toBeNull();
    expect(M.livenessView(agent())).toBeNull();

    // Both carriers, string or object.
    expect(M.livenessState(agent({ processLiveness: "died" }))).toBe("died");
    expect(M.livenessState(agent({ liveness: "process-gone" }))).toBe("died");
    expect(M.livenessState(agent({ processLiveness: { state: "running" } }))).toBe("running");
    expect(M.livenessState(agent({ processLiveness: { status: "exited" } }))).toBe("exited");

    // The full vocabulary the emitting lane might use.
    for (const word of ["running", "alive", "process-alive", "up"]) {
      expect(M.livenessState(agent({ processLiveness: word })), word).toBe("running");
    }
    for (const word of ["exited", "exited-clean", "finished", "completed", "done"]) {
      expect(M.livenessState(agent({ processLiveness: word })), word).toBe("exited");
    }
    for (const word of ["died", "dead", "process-gone", "crashed", "killed", "terminated"]) {
      expect(M.livenessState(agent({ processLiveness: word })), word).toBe("died");
    }

    // A word this client does not own is unknown — never death, and never health.
    for (const word of ["zombie", "", "  ", "stopped-maybe", "no-evidence"]) {
      expect(M.livenessState(agent({ processLiveness: word })), JSON.stringify(word)).toBe("unknown");
    }
    expect(M.livenessState(agent({ processLiveness: {} }))).toBe("unknown");
    expect(M.livenessState(agent({ processLiveness: 7 }))).toBe("unknown");
  });

  test("(3) 'died' is unmistakable on the row; absence changes nothing", () => {
    const program = { id: "p", name: "P" };
    const calm = withDom(() => M.renderAgentRow(agent(), program));
    const dead = withDom(() => M.renderAgentRow(agent({ processLiveness: "died" }), program));
    const unclear = withDom(() => M.renderAgentRow(agent({ processLiveness: "unknown" }), program));

    // Absent renders exactly what it renders today: no mark, no row class.
    expect(byClass(calm, "row-died")).toBeNull();
    expect(calm.className.split(/\s+/)).not.toContain("is-died");
    expect(calm.attributes["aria-label"]).not.toContain("Process:");

    // Died is marked in text, in the row class, and in the accessible name.
    expect(textOf(byClass(dead, "row-died"))).toContain("Died");
    expect(dead.className.split(/\s+/)).toContain("is-died");
    expect(dead.attributes["aria-label"]).toContain("Process: Died");

    // Unknown is never marked as death, but it is still stated to a reader.
    expect(byClass(unclear, "row-died")).toBeNull();
    expect(unclear.className.split(/\s+/)).not.toContain("is-died");
    expect(unclear.attributes["aria-label"]).toContain("Process: Liveness unknown");
  });

  test("(3) the drawer states all four verdicts, so unknown reads as unknown", () => {
    expect(withDom(() => M.verdictLiveness(agent()))).toBeNull();
    const cases: Array<[string, string, string]> = [
      ["running", "Process live", "liveness-running"],
      ["exited", "Exited cleanly", "liveness-exited"],
      ["died", "Died", "liveness-died"],
      ["unknown", "Liveness unknown", "liveness-unknown"],
    ];
    for (const [word, label, cls] of cases) {
      const chip = withDom(() => M.verdictLiveness(agent({ processLiveness: word })));
      expect(textOf(chip), word).toContain(label);
      expect(chip.className.split(/\s+/), word).toContain(cls);
    }
    // The four labels are distinct words — "exited" must never read like "died".
    const labels = cases.map(([word]) => M.livenessView(agent({ processLiveness: word })).label);
    expect(new Set(labels).size).toBe(4);
  });

  test("(2) attention: acknowledge, dismiss and snooze all reach the server", async () => {
    const asking = agent({ status: "attention", statusReason: "Unread cmux notification: Codex — Permission" });
    const snap = snapshot({ programs: [{ id: "p", name: "P", agents: [asking] }] });
    const record = { surfaceId: "s1", action: "acknowledge", updatedAt: "2026-07-22T03:00:00.000Z", throughAt: "2026-07-22T02:00:00.000Z" };

    for (const action of ["acknowledge", "dismiss"]) {
      await withState({
        snap, conn: "live", attention: new Map(), attentionPending: new Set(), attentionErrors: new Map(),
      }, async () => {
        await withRequests([
          { status: 200, json: { ok: true, agentId: asking.id, state: { ...record, action } } },
          { status: 200, json: snap },
        ], async (calls) => {
          await M.applyAttention(asking.id, action);
          expect(calls[0]!.method, action).toBe("POST");
          expect(calls[0]!.url, action).toBe("/api/attention");
          expect(calls[0]!.body, action).toEqual({ action, agentId: asking.id });
          // The snapshot is re-read, which is what makes the agent visibly leave
          // the needs-a-human set rather than just greying a button.
          expect(calls[1]!.url, action).toBe("/api/snapshot");
          expect(M.state.attention.get(asking.id).action, action).toBe(action);
        });
      });
    }

    // Snooze carries an `until`; the server rejects a body without one (400).
    await withState({
      snap, conn: "live", attention: new Map(), attentionPending: new Set(), attentionErrors: new Map(),
    }, async () => {
      const until = new Date(Date.parse("2026-07-22T04:00:00.000Z")).toISOString();
      await withRequests([
        { status: 200, json: { ok: true, agentId: asking.id, state: { surfaceId: "s1", action: "snooze", updatedAt: "2026-07-22T03:00:00.000Z", snoozedUntil: until } } },
        { status: 200, json: snap },
      ], async (calls) => {
        await M.applyAttention(asking.id, "snooze", until);
        expect(calls[0]!.body).toEqual({ action: "snooze", agentId: asking.id, until });
      });
    });
  });

  test("(2) attention failures are named, not swallowed", async () => {
    const asking = agent({ status: "attention" });
    const snap = snapshot({ programs: [{ id: "p", name: "P", agents: [asking] }] });
    const cases: Array<[number, string, string]> = [
      [404, "ATTENTION_NOT_FOUND", "no unread notification recorded"],
      [409, "UNSAFE_TARGET", "no safely resolved terminal"],
      [404, "AGENT_NOT_FOUND", "no longer in the current snapshot"],
    ];
    for (const [status, code, fragment] of cases) {
      await withState({
        snap, conn: "live", attention: new Map(), attentionPending: new Set(), attentionErrors: new Map(),
      }, async () => {
        await withRequests([{ status, json: { ok: false, error: { code, message: "server prose" } } }], async () => {
          await M.applyAttention(asking.id, "acknowledge");
          expect(M.state.attentionErrors.get(asking.id), code).toContain(fragment);
          // A failed change is never recorded as if it had worked.
          expect(M.state.attention.has(asking.id), code).toBe(false);
        });
      });
    }
  });

  test("(2) an expired snooze visibly returns", () => {
    const asking = agent({ status: "attention", statusReason: "Unread cmux notification: Codex — Permission" });
    const now = Date.parse("2026-07-22T03:00:00.000Z");
    const live = { surfaceId: "s1", action: "snooze", updatedAt: "2026-07-22T02:00:00.000Z", snoozedUntil: "2026-07-22T04:00:00.000Z" };
    const expired = { ...live, snoozedUntil: "2026-07-22T02:30:00.000Z" };

    // While it holds, the record is live and states its deadline.
    expect(M.attentionRecord(asking.id, { attention: new Map([[asking.id, live]]) }, now)).toEqual(live);
    expect(M.attentionStateText(live)).toContain("Snoozed until");

    // Once it runs out the record is gone — no timer, no stuck state.
    expect(M.attentionRecord(asking.id, { attention: new Map([[asking.id, expired]]) }, now)).toBeNull();
    // A malformed deadline is treated as expired, never as an eternal snooze.
    expect(M.attentionRecord(asking.id, { attention: new Map([[asking.id, { ...live, snoozedUntil: "not a date" }]]) }, now)).toBeNull();

    // And the drawer says so, rather than letting the alert quietly reappear.
    const ui = { attention: new Map([[asking.id, expired]]), attentionPending: new Set(), attentionErrors: new Map() };
    const returned = withDom(() => M.renderAttentionBlock(asking, ui, now));
    expect(textOf(returned)).toContain("snooze has run out");
    expect(buttonsOf(returned).map((b: any) => b.dataset.fkey)).toEqual([
      "attn:" + asking.id + ":acknowledge",
      "attn:" + asking.id + ":dismiss",
      "attn:" + asking.id + ":snooze",
    ]);

    // A snooze still running shows the state, not the controls again.
    const held = withDom(() => M.renderAttentionBlock(
      agent({ status: "running" }),
      { attention: new Map([["codex:a1", live]]), attentionPending: new Set(), attentionErrors: new Map() },
      now,
    ));
    expect(textOf(held)).toContain("Snoozed until");
    expect(buttonsOf(held)).toHaveLength(0);

    // An agent nobody is waiting on, with nothing recorded, gets no block at all.
    expect(withDom(() => M.renderAttentionBlock(agent(), { attention: new Map(), attentionPending: new Set(), attentionErrors: new Map() }, now))).toBeNull();
  });

  test("(2) triage lifecycle: cancel a run, remove a record, investigate again", async () => {
    const issue = { id: "system:x", kind: "system", severity: "error", title: "T", summary: "s", affectedAgentIds: [] };
    const base = {
      issueId: issue.id, id: "triage:system:x", generatedAt: "2026-07-22T03:00:00.000Z",
      mode: "investigation", headline: "H", rationale: "R", affectedAgents: 2, affectedPrograms: 1,
      providers: ["codex"], evidence: [], steps: [{ title: "s1", detail: "d1" }],
      queueRecommended: true, createdAt: "2026-07-22T03:00:00.000Z",
    };
    const ui = (state: string) => triageUi({ queueItems: [{ ...base, state }], triage: new Map([[issue.id, base]]) });

    // The lever offered depends on where the run actually is.
    const keys = (state: string) => buttonsOf(withDom(() => M.renderTriage(issue, ui(state))))
      .map((b: any) => b.dataset.fkey).filter((k: string) => /^triage-(cancel|remove|rerun|run)/.test(k));
    expect(keys("running")).toEqual(["triage-cancel:system:x"]);
    expect(keys("queued")).toEqual(["triage-run:system:x", "triage-remove:system:x"]);
    expect(keys("completed")).toEqual(["triage-rerun:system:x", "triage-remove:system:x"]);
    expect(keys("blocked")).toEqual(["triage-rerun:system:x", "triage-remove:system:x"]);
    // An untriaged finding grows no lifecycle chrome.
    expect(M.triageLifecycleControls(issue, undefined, false, triageUi())).toEqual([]);

    // Cancel stops the run: the server reports `cancelled`, the item leaves the
    // queue, and the plan survives so it can be re-queued without re-analysing.
    await withState({
      snap: snapshot({ issues: [issue] }), conn: "live",
      triage: new Map(), triagePending: new Set(), triageErrors: new Map(),
      queueItems: [{ ...base, state: "running", pid: 4321 }],
    }, async () => {
      await withRequests([
        { status: 200, json: { ok: true, removed: { ...base, state: "running" }, cancelled: true } },
        { status: 200, json: snapshot({ issues: [issue] }) },
        { status: 200, json: { ok: true, items: [] } },
      ], async (calls) => {
        await M.removeTriageItem(issue.id, "cancel");
        expect(calls[0]!.method).toBe("DELETE");
        expect(calls[0]!.url).toBe("/api/triage/queue?issueId=system%3Ax");
        expect(M.state.queueItems).toEqual([]);
        expect(M.state.triage.get(issue.id).headline).toBe("H");
        expect(M.state.triageErrors.has(issue.id)).toBe(false);
      });
    });

    // A server that cannot safely cancel says so (409) — the client must NOT
    // report a stopped run it did not stop.
    await withState({
      snap: snapshot({ issues: [issue] }), conn: "live",
      triage: new Map(), triagePending: new Set(), triageErrors: new Map(),
      queueItems: [{ ...base, state: "running" }],
    }, async () => {
      await withRequests([{
        status: 409,
        json: { ok: false, error: { code: "INVESTIGATION_CANCEL_UNAVAILABLE", message: "The active investigation has no safe cancellation handle." } },
      }], async () => {
        await M.removeTriageItem(issue.id, "cancel");
        expect(M.state.triageErrors.get(issue.id)).toContain("no safe cancellation handle");
        expect(M.state.queueItems.map((i: any) => i.state)).toEqual(["running"]);
      });
    });

    // "Investigate again" re-queues through the same route the first queue used;
    // the server replaces a finished item, so no second vocabulary exists.
    await withState({
      snap: snapshot({ issues: [issue] }), conn: "live",
      triage: new Map([[issue.id, base]]), triagePending: new Set(), triageErrors: new Map(),
      queueItems: [{ ...base, state: "completed", result: "done" }],
    }, async () => {
      await withRequests([
        { status: 200, json: { ok: true, item: { ...base, state: "queued" } } },
        { status: 200, json: snapshot({ issues: [issue] }) },
        { status: 200, json: { ok: true, items: [{ ...base, state: "queued" }] } },
      ], async (calls) => {
        const rerun = M.triageLifecycleControls(issue, { ...base, state: "completed" }, false, M.state)
          .find((b: any) => b.dataset.fkey === "triage-rerun:system:x");
        await fire(rerun);
        expect(calls[0]!.url).toBe("/api/triage/queue");
        expect(calls[0]!.method).toBe("POST");
        expect(M.state.queueItems.map((i: any) => i.state)).toEqual(["queued"]);
      });
    });
  });

  /* FE-C's lesson: a surface that renders correctly in isolation and is never
     mounted, or never repainted, is not shipped. Both halves are checked. */
  test("(2)(3) both new surfaces are actually mounted in the drawer, and repaint", () => {
    const asking = agent({ status: "attention", statusReason: "Unread cmux notification: Codex — Permission", processLiveness: "died" });
    const program = { id: "p", name: "P", agents: [asking] };
    const pane = newNode("div");
    withDom(() => M.renderAgentDrawer(pane, { kind: "agent", agent: asking, program }));
    expect(byClass(pane, "verdict-liveness")).not.toBeNull();
    expect(textOf(byClass(pane, "verdict-liveness"))).toContain("Died");
    expect(byClass(pane, "attn-block")).not.toBeNull();
    expect(buttonsOf(byClass(pane, "attn-block")).map((b: any) => textOf(b)))
      .toEqual(["Acknowledge", "Dismiss", "Snooze 1 hour"]);

    // A drawer with neither field and no attention keeps exactly its old shape.
    const calmPane = newNode("div");
    withDom(() => M.renderAgentDrawer(calmPane, { kind: "agent", agent: agent(), program: { id: "p", name: "P", agents: [agent()] } }));
    expect(byClass(calmPane, "verdict-liveness")).toBeNull();
    expect(byClass(calmPane, "attn-block")).toBeNull();

    // Nothing else in the drawer moves when an attention verdict lands, so
    // without it in the signature the block would never reach the screen —
    // the exact failure state.identity and state.transcript both had.
    const snap = snapshot({ programs: [program] });
    const base = identityUi({ snap, attention: new Map(), attentionPending: new Set(), attentionErrors: new Map(), actions: { items: [] }, transcript: {} });
    const sel = { kind: "agent", id: asking.id };
    const view = { kind: "agent", agent: asking, program };
    const before = M.inspectorPaintSig(sel, view, base);
    const acked = M.inspectorPaintSig(sel, view, { ...base, attention: new Map([[asking.id, { action: "acknowledge", updatedAt: "2026-07-22T03:00:00.000Z" }]]) });
    const failing = M.inspectorPaintSig(sel, view, { ...base, attentionErrors: new Map([[asking.id, "nope"]]) });
    const busy = M.inspectorPaintSig(sel, view, { ...base, attentionPending: new Set([asking.id]) });
    expect(acked).not.toBe(before);
    expect(failing).not.toBe(before);
    expect(busy).not.toBe(before);
  });
});

/* ---------------------------------------------------------------------------
   W5-B.

   Every payload quoted in this block was captured VERBATIM off a live server
   started from this worktree on 127.0.0.1:4792, not hand-written to the
   contract. The previous lane could only test the transcript viewer and the
   action log against a fake `fetch`, and the lane after it could not test them
   at all because both routes answered 403 to every browser. Both are now
   reachable, so these tests pin the client against what the server really
   sends.
   ------------------------------------------------------------------------- */
describe("W5-B: the wire, as the server actually speaks it", () => {
  /* The whole liveness feature was dark: the server emits `processState` and
     the client read only `processLiveness` / `liveness`, so livenessState()
     returned null for all 96 agents in a live snapshot and nothing rendered. */
  test("(1) processState is a liveness carrier, with the server's own four words", () => {
    // src/shared/types.ts: ProcessState = "running" | "exited" | "died" | "unknown".
    const wire: Array<["running" | "exited" | "died" | "unknown", string]> = [
      ["running", "Process live"],
      ["exited", "Exited cleanly"],
      ["died", "Died"],
      ["unknown", "Liveness unknown"],
    ];
    for (const [word, label] of wire) {
      expect(M.livenessState(agent({ processState: word })), word).toBe(word);
      expect(M.livenessView(agent({ processState: word })).label, word).toBe(label);
    }
    // The four labels stay four distinct words: "Exited cleanly" collapsing
    // into "Died" is the one confusion this feature exists to remove.
    expect(new Set(wire.map(([w]) => M.livenessView(agent({ processState: w })).label)).size).toBe(4);
  });

  test("(1) processState wins over the legacy carriers", () => {
    // Both carriers on one record can only happen while something is migrating.
    // Read the field the server actually emits, never the guess it replaced.
    expect(M.livenessState(agent({ processState: "died", processLiveness: "running" }))).toBe("died");
    expect(M.livenessState(agent({ processState: "running", liveness: "process-gone" }))).toBe("running");
    // The aliases still work on their own — dropping them would buy nothing and
    // would re-open exactly the failure this test exists for.
    expect(M.livenessState(agent({ processLiveness: "died" }))).toBe("died");
    expect(M.livenessState(agent({ liveness: "process-gone" }))).toBe("died");
  });

  test("(1) processState keeps the absent-first rules", () => {
    // Absent: nothing new renders. A snapshot without the field paints as before.
    expect(M.livenessState(agent())).toBeNull();
    expect(M.livenessState(agent({ processState: null }))).toBeNull();
    expect(M.livenessState(agent({ processState: undefined }))).toBeNull();
    // A word this client does not own is never read as death.
    for (const word of ["zombie", "stopped", "", "  ", 7, {}, []]) {
      expect(M.livenessState(agent({ processState: word })), JSON.stringify(word)).toBe("unknown");
    }
  });

  test("(1) a real processState reaches the row and the drawer", () => {
    const program = { id: "p", name: "P", agents: [] as unknown[] };

    // The row marks only death, and it must be driven by the REAL carrier —
    // reading processLiveness alone left every dead process unmarked.
    const dead = withDom(() => M.renderAgentRow(agent({ processState: "died" }), program));
    expect(dead.className).toContain("is-died");
    expect(dead.attributes["aria-label"]).toContain("Process: Died");

    const alive = withDom(() => M.renderAgentRow(agent({ processState: "running" }), program));
    expect(alive.className).not.toContain("is-died");
    expect(alive.attributes["aria-label"]).toContain("Process: Process live");

    // Absent stays byte-identical to the pre-feature row: no mark, no aria text.
    const bare = withDom(() => M.renderAgentRow(agent(), program));
    expect(bare.className).not.toContain("is-died");
    expect(bare.attributes["aria-label"]).not.toContain("Process:");

    // The drawer states all four, so "unknown" is stated as unknown somewhere
    // rather than quietly reading as health.
    const unclear = agent({ processState: "unknown" });
    const pane = newNode("div");
    withDom(() => M.renderAgentDrawer(pane, { kind: "agent", agent: unclear, program: { id: "p", name: "P", agents: [unclear] } }));
    expect(textOf(byClass(pane, "verdict-liveness"))).toContain("Liveness unknown");
  });

  /* The route that used to 403 every browser now answers. This is a verbatim
     slice of what it returned for a real Codex session on :4792 — including a
     `role: "unknown"` the SERVER itself emits for an unmapped row, which the
     old hand-written fixture did not have. */
  const LIVE_TRANSCRIPT = {
    ok: true,
    agentId: "codex:019faca3-5c0b-71b1-9501-d27671ba2083",
    source: "/Users/emilionunezgarcia/.codex/sessions/2026/07/29/rollout-2026-07-29T08-50-14-019faca3-5c0b-71b1-9501-d27671ba2083.jsonl",
    truncated: false,
    lines: [
      { at: "2026-07-29T06:50:18.291Z", role: "unknown", text: "Memory You have access to a memory folder with guidance from" },
      { at: "2026-07-29T06:50:18.359Z", role: "user", text: "WAVE 5 / W5-C — the suite has a time bomb" },
      { at: "2026-07-29T06:50:29.866Z", role: "assistant", text: "I'll treat the diagnosed triage clock leak as the primary fi" },
      { at: "2026-07-29T06:51:02.100Z", role: "tool", text: "ran bun test" },
    ],
  };

  test("(3) the live transcript route loads and renders through the real client path", async () => {
    const who = agent({ id: LIVE_TRANSCRIPT.agentId });
    const program = { id: "p", name: "P", agents: [who] };
    await withState({ snap: snapshot({ programs: [program] }), transcript: {} }, async () => {
      await withRequests([{ status: 200, json: LIVE_TRANSCRIPT }], async (calls) => {
        await M.loadTranscript(who.id);
        // The client must ask for a limit the server will accept: its ceiling
        // is 1000 and anything above it is a 400 INVALID_LIMIT.
        expect(calls[0]!.method).toBe("GET");
        expect(calls[0]!.url).toBe("/api/transcript?agent=" + encodeURIComponent(who.id) + "&limit=200");
        // Settled into data, never a spinner and never a named failure.
        expect(M.state.transcript.loading).toBe(false);
        expect(M.state.transcript.error).toBe("");

        const panel = withDom(() => M.renderTranscriptPanel(who, M.state));
        expect(byClass(panel, "err")).toBeNull();
        expect(allByClass(panel, "tr-line")).toHaveLength(4);
        // The real absolute source path reaches the operator verbatim.
        expect(textOf(byClass(panel, "transcript-source-path"))).toBe(LIVE_TRANSCRIPT.source);
        expect(textOf(byClass(panel, "transcript-source"))).toBe("4 turns");
        // Untrusted agent text, rendered as text.
        expect(textOf(panel)).toContain("WAVE 5 / W5-C — the suite has a time bomb");
      });
    });
  });

  test("(3) the live action-log route loads and renders every real outcome", async () => {
    // Verbatim from :4792 after two refused control attempts. A journal that
    // showed only successes would read as proof the instruction landed.
    const live = {
      ok: true,
      actions: [
        {
          id: "act_01KYPANEX9M7N7TMPX77ESF6MN",
          at: "2026-07-29T06:58:18.153Z",
          kind: "interrupt",
          agentIds: ["codex:w5b-probe-not-a-real-agent"],
          outcome: "failed",
          detail: "AGENT_NOT_FOUND: The agent is not present in the current snapshot.",
        },
        {
          id: "act_01KYPANEX22GXBHQ0QA06PFVRH",
          at: "2026-07-29T06:58:18.146Z",
          kind: "focus",
          agentIds: ["codex:w5b-probe-not-a-real-agent"],
          outcome: "failed",
          detail: "AGENT_NOT_FOUND: The agent is not present in the current snapshot.",
        },
      ],
    };
    await withState({ snap: snapshot(), actions: { loading: false, error: "", available: true, items: [], fetchedAt: 0 } }, async () => {
      await withRequests([{ status: 200, json: live }], async (calls) => {
        await M.loadActions();
        expect(calls[0]!.url).toBe("/api/actions?limit=100");
        expect(M.state.actions.error).toBe("");
        // fetchedAt is what lets a later control refresh the journal at all;
        // the 403 era left it 0 forever, so refreshActions() never fired.
        expect(M.state.actions.fetchedAt).toBeGreaterThan(0);
        expect(M.state.actions.items).toHaveLength(2);

        const panel = withDom(() => M.renderActionLog(M.state, null));
        expect(byClass(panel, "action-log-note")).toBeNull();
        expect(allByClass(panel, "action-row")).toHaveLength(2);
        const first = allByClass(panel, "action-row")[0];
        expect(textOf(byClass(first, "action-kind"))).toBe("Interrupt");
        expect(textOf(byClass(first, "action-outcome"))).toBe("Failed");
        // The server's own reason survives to the screen, not summarised away.
        expect(textOf(byClass(first, "action-detail"))).toBe(live.actions[0]!.detail);
        // An agent the snapshot no longer names keeps its raw id rather than
        // vanishing from the record of who was instructed.
        expect(textOf(byClass(first, "action-who"))).toBe("codex:w5b-probe-not-a-real-agent");
      });
    });
  });

  /* The routes stopped requiring an `Origin` header, so the client's
     explanation of ORIGIN_REJECTED became a lie in the opposite direction:
     it told the operator to go and get a server fix that had already shipped. */
  test("(3) ORIGIN_REJECTED names the address, not a server change that already landed", () => {
    const body = { ok: false, error: { code: "ORIGIN_REJECTED", message: "Read endpoints require exact same-origin loopback access." } };
    for (const text of [M.transcriptFailureText(403, body), M.actionsFailureText(403, body)]) {
      // The one thing the operator can act on.
      expect(text).toContain("127.0.0.1");
      expect(text).toContain("loopback");
      expect(text).toContain("ORIGIN_REJECTED");
      // Not a routed fix that has shipped, and not a deploy that has happened.
      expect(text).not.toContain("have to stop requiring");
      expect(text).not.toContain("same-origin GET");
      expect(text).not.toContain("not available in this build");
      // Not a bare echo of the server's own sentence about HTTP internals.
      expect(text).not.toBe(body.error.message);
    }
    // Every other degradation is untouched.
    expect(M.transcriptFailureText(404, null)).toBe("Transcript view is not available in this build.");
    expect(M.actionsFailureText(404, null)).toBe("The action log is not available in this build.");
    expect(M.transcriptFailureText(404, { ok: false, error: { code: "AGENT_NOT_FOUND", message: "gone" } }))
      .toContain("no longer tracked");
  });
});

/* ---------------------------------------------------------------------------
   Server health probe + the real startup path.

   Two gaps this closes. (1) /api/health had no client surface at all: the
   endpoint gates scripts/anthill-deploy.sh but nothing on the board read it, so
   the operator and the deploy could disagree about whether the server was
   healthy. (2) boot() was unreachable from tests — not exported, and it runs
   only behind a document/window guard — so the startup path was covered by
   source-text assertions that cannot fail when the wiring breaks.

   These drive both for real against the fake document and a fake fetch.
   ------------------------------------------------------------------------- */
describe("server health probe (/api/health)", () => {
  test("stays silent while the server calls itself healthy", async () => {
    await withRequests([{ status: 200, json: { ok: true, verdict: "healthy", snapshot: { ageMs: 900, maxAgeMs: 60000 } } }], async (calls) => {
      const result = await M.pollServerHealth();
      expect(calls[0].url).toContain("/api/health");
      expect(result.ok).toBe(true);
      // The connection badge and feed alarm already carry every healthy-state
      // fact; a third green light would be a third thing to read. Hidden is the
      // contract, not an accident of styling.
      expect(M.state.serverHealth.ok).toBe(true);
      const node = (globalThis as unknown as { document: any }).document.getElementById("server-health");
      expect(node.hidden).toBe(true);
    });
    M.state.serverHealth = null;
  });

  test("speaks when the server disowns its own snapshot", async () => {
    await withRequests([{ status: 200, json: { ok: false, verdict: "stale", snapshot: { ageMs: 240000, maxAgeMs: 60000 } } }], async () => {
      const result = await M.pollServerHealth();
      expect(result.ok).toBe(false);
      expect(result.verdict).toBe("stale");
      const node = (globalThis as unknown as { document: any }).document.getElementById("server-health");
      expect(node.hidden).toBe(false);
      expect(node.className).toContain("is-stale");
      // The age must reach the operator, not just the boolean.
      expect(node.attributes.title).toContain("stale");
      expect(node.attributes["aria-label"]).toBeTruthy();
    });
    M.state.serverHealth = null;
  });

  test("a non-200 and a refused request both read as unreachable", async () => {
    await withRequests([{ status: 503 }], async () => {
      const result = await M.pollServerHealth();
      expect(result.ok).toBe(false);
      expect(result.verdict).toBe("unreachable");
      const node = (globalThis as unknown as { document: any }).document.getElementById("server-health");
      expect(node.className).toContain("is-unreachable");
    });
    await withRequests([new Error("connection refused")], async () => {
      // A thrown request is itself the finding — it must not crash the poller.
      const result = await M.pollServerHealth();
      expect(result.ok).toBe(false);
      expect(result.verdict).toBe("unreachable");
    });
    M.state.serverHealth = null;
  });

  test("both inks are defined and the markup slot exists", () => {
    expect(styles).toContain(".server-health.is-stale");
    expect(styles).toContain(".server-health.is-unreachable");
    expect(html).toContain('id="server-health"');
  });
});

describe("boot() is exported and drives the real startup path", () => {
  test("boot wires the page, polls health, and stopBoot leaves no timers", async () => {
    expect(typeof M.boot).toBe("function");
    expect(typeof M.stopBoot).toBe("function");

    // EventSource and localStorage are the two browser globals boot() needs that
    // Bun does not provide. Stub them narrowly rather than adding a DOM library:
    // this project has zero dependencies by design.
    const G = globalThis as unknown as Record<string, any>;
    const realES = G.EventSource;
    const realLS = G.localStorage;
    const store = new Map<string, string>();
    G.localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
    };
    let opened = 0;
    G.EventSource = class {
      static OPEN = 1;
      readyState = 1;
      constructor() { opened += 1; }
      addEventListener() {}
      close() {}
    };
    try {
      await withRequests([{ status: 200, json: { ok: true, verdict: "healthy", snapshot: { ageMs: 10, maxAgeMs: 60000 } } }], async (calls) => {
        const doc = (globalThis as unknown as { document: any }).document;
        doc.title = "The Ant Hill";
        doc.addEventListener = () => {};
        M.boot();
        // boot() deliberately fires several requests without awaiting them, so
        // let them settle while the fake document still exists — otherwise the
        // harness tears down mid-flight and the client renders into nothing.
        await Bun.sleep(10);
        // The startup path must actually reach the network and the transport,
        // which is exactly what a source-text assertion could never prove.
        expect(opened).toBe(1);
        const urls = calls.map((c) => c.url).join(" ");
        expect(urls).toContain("/api/snapshot");
        expect(urls).toContain("/api/health");
        // Title is captured before any notification rewrites it.
        expect(M.state.notify.baseTitle).toBe("The Ant Hill");
      });
    } finally {
      M.stopBoot();
      if (realES === undefined) delete G.EventSource; else G.EventSource = realES;
      if (realLS === undefined) delete G.localStorage; else G.localStorage = realLS;
      M.state.serverHealth = null;
    }
  });
});
