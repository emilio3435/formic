import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* SYNC-CF — the board's half of POST /api/sync/close.

   Two properties are pinned here and nothing else is invented:

   1. GATING. Close destroys a terminal, so it is offered only where the board
      can name exactly one. `exact` is the only resolution that qualifies —
      `unique-cwd` is a folder match, and Focus/Send accept it because looking
      at a pane and typing into one are recoverable. Closing the wrong pane is
      not. A session the board no longer watches offers nothing at all.

   2. THE ENVELOPE. Every request and every reply in this file is the shape
      frozen in the master plan's Contract section, driven through the real
      client against a fake fetch. The lane's named trap is
      [[fixtures-are-not-payloads]]: a hand-authored reply shape that the route
      will never send buys a green test and no coverage, so the wrong-envelope
      case is asserted too — a refusal the client cannot fully read must open
      NO dialog rather than a dialog that names nobody, because "no other
      agents share this workspace" printed over an unread payload is a false
      statement about who a click is about to kill. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let M: any;
let source = "";
let styles = "";

/* ---------------------------------------------------------------------------
   Render harness — the minimal fake DOM the client's real render functions
   build into, matching tests/web-client.test.ts. Handlers are recorded through
   addEventListener because el() wires every one of them that way; without the
   record no test can click what the client builds.
   ------------------------------------------------------------------------- */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node_ = any;

function makeNode(tag: string): Node_ {
  const classes = new Set<string>();
  let text = "";
  const node: Node_ = {
    nodeType: 1,
    tagName: tag,
    get textContent() { return text; },
    set textContent(v: string) { text = String(v ?? ""); node.children.length = 0; },
    dataset: {} as Record<string, string>,
    attributes: {} as Record<string, string>,
    children: [] as Node_[],
    parent: null as Node_ | null,
    get className() { return [...classes].join(" "); },
    set className(v: string) { classes.clear(); for (const c of String(v).split(/\s+/)) if (c) classes.add(c); },
    classList: {
      add: (...c: string[]) => { for (const x of c) if (x) classes.add(x); },
      remove: (...c: string[]) => { for (const x of c) classes.delete(x); },
      toggle: (c: string, on?: boolean) => { if (on === undefined ? classes.has(c) : !on) classes.delete(c); else classes.add(c); },
      contains: (c: string) => classes.has(c),
    },
    get childNodes() { return node.children; },
    get childElementCount() { return node.children.length; },
    get firstChild() { return node.children[0] || null; },
    get nextSibling() {
      if (!node.parent) return null;
      const i = node.parent.children.indexOf(node);
      return (i >= 0 && node.parent.children[i + 1]) || null;
    },
    setAttribute(k: string, v: unknown) { node.attributes[k] = String(v); },
    getAttribute(k: string) { return node.attributes[k] ?? null; },
    removeAttribute(k: string) { delete node.attributes[k]; },
    hasAttribute(k: string) { return k in node.attributes; },
    // render() asks the drawer whether focus is inside it before repainting, so
    // a harness without this cannot drive any path that has an activeElement.
    contains(other: Node_) {
      for (let at = other; at; at = at.parent) if (at === node) return true;
      return false;
    },
    querySelector: () => null,
    querySelectorAll: () => [] as unknown[],
    listeners: {} as Record<string, Array<(event: unknown) => unknown>>,
    addEventListener(type: string, fn: (event: unknown) => unknown) { (node.listeners[type] ??= []).push(fn); },
    append(...kids: unknown[]) {
      for (const kid of kids) {
        if (kid == null) continue;
        node.children.push(kid as Node_);
        if (typeof kid === "object" && kid !== null && "parent" in (kid as Node_)) (kid as Node_).parent = node;
      }
    },
    insertBefore(child: Node_, ref: Node_ | null) {
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

const domById = new Map<string, Node_>();
function fakeDocument(): Record<string, unknown> {
  domById.clear();
  return {
    createElement: (t: string) => makeNode(t),
    createElementNS: (_ns: string, t: string) => makeNode(t),
    createTextNode: (s: string) => ({ nodeType: 3, textContent: String(s) }),
    getElementById: (id: string) => {
      if (!domById.has(id)) domById.set(id, makeNode("div"));
      return domById.get(id) as Node_;
    },
    querySelectorAll: () => [] as unknown[],
    querySelector: () => null,
  };
}

function withDom<T>(fn: () => T): T {
  (globalThis as unknown as { document: unknown }).document = fakeDocument();
  try { return fn(); } finally { delete (globalThis as unknown as { document?: unknown }).document; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const G = globalThis as any;

interface FakeCall { url: string; method: string; headers: Record<string, string>; body: any }
type FakeReply = { status?: number; json?: unknown } | Error;

/* Drives the real request functions against a fake fetch and the fake document,
   so every assertion below is about what the client SENDS and what it then
   BELIEVES — never about the source text that builds the request. */
async function withRequests<T>(replies: FakeReply[], fn: (calls: FakeCall[]) => Promise<T> | T): Promise<T> {
  const calls: FakeCall[] = [];
  const realFetch = G.fetch;
  const realDoc = G.document;
  const realCss = G.CSS;
  const document = fakeDocument();
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
      headers: Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)])),
      body: typeof init.body === "string" ? JSON.parse(init.body) : null,
    });
    if (reply instanceof Error) throw reply;
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => {
        if (!("json" in reply)) throw new Error("response is not JSON");
        return reply.json;
      },
    };
  };
  try { return await fn(calls); } finally {
    G.fetch = realFetch;
    if (realDoc === undefined) delete G.document; else G.document = realDoc;
    if (realCss === undefined) delete G.CSS; else G.CSS = realCss;
  }
}

/* The seam exports the REAL module state, so every test that writes it puts
   back exactly what it found. */
async function withState<T>(patch: Record<string, unknown>, fn: () => Promise<T> | T): Promise<T> {
  const full = {
    paintSig: { programs: "", inspector: "", widgets: "", alarm: null, actions: null },
    ...patch,
  };
  const keys = Object.keys(full);
  const saved = Object.fromEntries(keys.map((key) => [key, M.state[key]]));
  Object.assign(M.state, full);
  try { return await fn(); } finally { Object.assign(M.state, saved); }
}

function findAll(node: Node_, pred: (n: Node_) => boolean, out: Node_[] = []): Node_[] {
  if (!node || typeof node !== "object") return out;
  if (pred(node)) out.push(node);
  for (const kid of node.children || []) findAll(kid, pred, out);
  return out;
}

function textOf(node: Node_): string {
  if (!node || typeof node !== "object") return "";
  if (node.nodeType === 3) return String(node.textContent || "");
  let s = typeof node.textContent === "string" ? node.textContent : "";
  for (const kid of node.children || []) s += textOf(kid);
  return s;
}

const byFkey = (node: Node_, key: string) => findAll(node, (n) => n.dataset && n.dataset.fkey === key)[0] || null;
const allByClass = (node: Node_, token: string) =>
  findAll(node, (n) => typeof n.className === "string" && n.className.split(/\s+/).includes(token));
const byClass = (node: Node_, token: string) => allByClass(node, token)[0] || null;
const buttonsOf = (node: Node_) => findAll(node, (n) => n.tagName === "button");

async function fire(node: Node_, type = "click", event: Record<string, unknown> = {}): Promise<void> {
  // A disabled control dispatches nothing in a browser. Keep the harness honest
  // about that boundary or a disabled-looking button passes by being invoked.
  if (node?.hasAttribute?.("disabled")) return;
  const handlers = (node && node.listeners && node.listeners[type]) || [];
  if (!handlers.length) throw new Error(`no ${type} handler on <${node && node.tagName}>`);
  for (const handler of handlers) await handler({ preventDefault() {}, stopPropagation() {}, ...event });
}

/* ---------------------------------------------------------------------------
   Fixtures. The agent carries the full control list a live snapshot carries,
   because the dock's cluster only exists when the server advertised something
   to put in it — a close tool bolted onto a capability-less dock would be a
   test passing against a surface the board never paints.
   ------------------------------------------------------------------------- */
const CONTROLS = [
  { action: "focus", enabled: true },
  { action: "instruct", enabled: true },
  { action: "interrupt", enabled: true },
  { action: "archive", enabled: true },
  { action: "unarchive", enabled: false },
];

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
    target: { resolution: "exact", attestation: "live", surfaceId: "SURFACE-1", workspaceId: "WORKSPACE-1", workspaceTitle: "SYNC · ridge" },
    controls: CONTROLS,
    ...overrides,
  };
}

function snapshot(agents: Array<Record<string, unknown>>) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    controlHealth: { cmuxReachable: true, lastCheckedAt: "", errors: [], staleSources: [] },
    totals: {
      live: agents.length, tracked: agents.length, attention: 0, working: agents.length, idle: 0, history: 0,
      byLifecycle: { working: agents.length, waiting: 0, unverified: 0, finished: 0 },
      retained: 0,
      sourceHealth: { healthy: 2, degraded: 0, absent: 0, total: 2 },
    },
    programs: [{ id: "p1", name: "P", agents }],
  };
}

/* The REAL escalation envelope, exactly as the master plan freezes it:
   POST /api/sync/close answers ActionResult, and on `invalid_state` (cmux
   refusing to close a workspace's last surface) the response carries
   `escalation: { workspaceId, siblingAgents: {id, name}[] }`. */
const ESCALATION_REPLY = {
  ok: false,
  code: "invalid_state",
  detail: "cannot close the last surface in a workspace",
  escalation: {
    workspaceId: "WORKSPACE-1",
    siblingAgents: [
      { id: "claude:b2", name: "Ridge reviewer" },
      { id: "codex:c3", name: "Ridge backend" },
    ],
  },
};

beforeAll(async () => {
  // @ts-expect-error The dependency-free browser client intentionally has no declaration file.
  await import("../src/web/app.js");
  M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
  source = readFileSync(join(import.meta.dir, "../src/web/app.js"), "utf8");
  styles = readFileSync(join(import.meta.dir, "../src/web/styles.css"), "utf8");
});

/* A dock, painted for real, with the feed fresh so nothing is held. */
function dockFor(target: Record<string, unknown>): Node_ {
  return withDom(() => M.renderCommandDock(target, M.deriveControlState(target), null, []));
}

const closeToolOf = (target: Record<string, unknown>) => byFkey(dockFor(target), "sync-close:" + target.id);

describe("SYNC-CF task 1 — the close affordance is gated on an exact target", () => {
  test("an exactly-resolved live session gets an enabled Close terminal control in the dock cluster", () => {
    const dock = dockFor(agent());
    const tool = byFkey(dock, "sync-close:codex:a1");
    expect(tool).not.toBeNull();
    expect(tool.hasAttribute("disabled")).toBe(false);
    expect(tool.attributes["aria-label"]).toBe("Close terminal");
    // It lives WITH Focus and Interrupt, not in a surface of its own.
    const cluster = byClass(dock, "command-dock-cluster");
    expect(cluster).not.toBeNull();
    expect(buttonsOf(cluster).some((b: Node_) => b.dataset.fkey === "sync-close:codex:a1")).toBe(true);
  });

  test("every resolution short of exact renders the control disabled and says why", () => {
    /* unique-cwd is the one that matters. Focus and Send accept it — the board
       calls such a row `linked` — so a close gated on "linked" would ship a
       destructive button on a folder-strength match. It is listed FIRST here
       for that reason: a gate written as `resolution !== "missing"` passes the
       ambiguous case and fails only this one. */
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ["unique-cwd", { resolution: "unique-cwd", surfaceId: "SURFACE-1", workspaceId: "WORKSPACE-1" }, "folder"],
      ["ambiguous", { resolution: "ambiguous", surfaceId: "SURFACE-1" }, "More than one"],
      ["missing", { resolution: "missing" }, "No cmux terminal"],
      ["exact with no surface id", { resolution: "exact" }, "No cmux terminal"],
    ];
    for (const [name, target, fragment] of cases) {
      const tool = closeToolOf(agent({ target }));
      expect(tool, name).not.toBeNull();
      expect(tool.hasAttribute("disabled"), name).toBe(true);
      // The reason is carried on the control itself, in operator language and
      // with no cmux identifiers in it — the visible-reason pattern the rest of
      // the dock uses for an unavailable tool.
      expect(tool.attributes.title, name).toContain(fragment);
      expect(tool.attributes["aria-label"], name).toContain(fragment);
      expect(tool.attributes["aria-label"], name).toContain("Close terminal");
    }
  });

  test("a disabled close control sends nothing when it is clicked", async () => {
    const target = agent({ target: { resolution: "ambiguous", surfaceId: "SURFACE-1" } });
    await withState({ snap: snapshot([target]), conn: "live", pending: new Set(), feedback: new Map(), syncClose: null }, () =>
      withRequests([{ status: 200, json: { ok: true } }], async (calls) => {
        const tool = byFkey(M.renderCommandDock(target, M.deriveControlState(target), null, []), "sync-close:" + target.id);
        await fire(tool);
        expect(calls).toHaveLength(0);
      }));
  });

  test("a session the board has stopped watching is offered no close at all", () => {
    // Both terminal facts, and they are different facts: finished is a verdict
    // about the session, retained is one about the board's reach. Neither has a
    // live terminal behind it to close.
    for (const ended of [
      agent({ lifecycle: "finished", status: "archived" }),
      agent({ scope: "retained" }),
    ]) {
      expect(closeToolOf(ended)).toBeNull();
      expect(M.syncCloseView(ended)).toBeNull();
    }
  });

  test("a frozen feed holds the close control shut, like every other dock tool", () => {
    const target = agent();
    const dock = withDom(() => M.renderCommandDock(target, M.deriveControlState(target), { kind: "stale", headline: "Feed is stale", detail: "" }, []));
    const tool = byFkey(dock, "sync-close:" + target.id);
    expect(tool).not.toBeNull();
    expect(tool.hasAttribute("disabled")).toBe(true);
    expect(tool.className.split(/\s+/)).toContain("is-held");
  });
});

describe("SYNC-CF task 2 — the surface close flow", () => {
  test("clicking close posts the frozen surface envelope, same-origin, exactly once", async () => {
    const target = agent();
    await withState({ snap: snapshot([target]), conn: "live", pending: new Set(), feedback: new Map(), syncClose: null }, () =>
      withRequests([{ status: 200, json: { ok: true } }], async (calls) => {
        const tool = byFkey(M.renderCommandDock(target, M.deriveControlState(target), null, []), "sync-close:" + target.id);
        await fire(tool);
        expect(calls).toHaveLength(1);
        expect(calls[0]!.method).toBe("POST");
        // Relative path: the board only ever writes to the server that served it.
        expect(calls[0]!.url).toBe("/api/sync/close");
        expect(calls[0]!.headers["content-type"]).toBe("application/json");
        expect(calls[0]!.body).toEqual({ target: "surface", id: "SURFACE-1" });
      }));
  });

  test("ok:true records the house success affordance and opens no dialog", async () => {
    const target = agent();
    await withState({ snap: snapshot([target]), conn: "live", pending: new Set(), feedback: new Map(), syncClose: null }, () =>
      withRequests([{ status: 200, json: { ok: true } }], async () => {
        await M.sendSyncClose(target, { target: "surface", id: "SURFACE-1" });
        const recorded = M.state.feedback.get(target.id);
        expect(recorded.ok).toBe(true);
        expect(recorded.action).toBe("sync-close");
        expect(M.state.syncClose).toBeNull();
        expect(M.state.pending.has(target.id + ":sync-close")).toBe(false);
      }));
  });

  test("invalid_state opens the escalation dialog and sends nothing more", async () => {
    const target = agent();
    await withState({ snap: snapshot([target]), conn: "live", pending: new Set(), feedback: new Map(), syncClose: null }, () =>
      withRequests([{ status: 200, json: ESCALATION_REPLY }], async (calls) => {
        await M.sendSyncClose(target, { target: "surface", id: "SURFACE-1" });
        // The refusal IS the escalation signal — never a request to try again.
        expect(calls).toHaveLength(1);
        expect(M.state.syncClose).toMatchObject({ agentId: target.id, workspaceId: "WORKSPACE-1" });
        // And no error affordance: nothing has failed, a bigger decision is due.
        expect(M.state.feedback.get(target.id)).toBeUndefined();
      }));
  });

  test("a refusal the route does not escalate is reported, not swallowed and not escalated", async () => {
    const target = agent();
    for (const reply of [
      { ok: false, code: "not_found", detail: "no such surface" },
      { ok: false },
      {},
    ]) {
      await withState({ snap: snapshot([target]), conn: "live", pending: new Set(), feedback: new Map(), syncClose: null }, () =>
        withRequests([{ status: 200, json: reply }], async () => {
          await M.sendSyncClose(target, { target: "surface", id: "SURFACE-1" });
          const recorded = M.state.feedback.get(target.id);
          expect(recorded?.ok, JSON.stringify(reply)).toBe(false);
          expect(M.state.syncClose, JSON.stringify(reply)).toBeNull();
        }));
    }
  });

  test("HTTP completion alone is never read as a close", async () => {
    const target = agent();
    for (const reply of [{ status: 500, json: { ok: false } }, { status: 200 }, { status: 404 }]) {
      await withState({ snap: snapshot([target]), conn: "live", pending: new Set(), feedback: new Map(), syncClose: null }, () =>
        withRequests([reply], async () => {
          await M.sendSyncClose(target, { target: "surface", id: "SURFACE-1" });
          expect(M.state.feedback.get(target.id)?.ok, JSON.stringify(reply)).toBe(false);
        }));
    }
  });
});

describe("SYNC-CF task 3 — the escalation dialog", () => {
  function openDialog(target: Record<string, unknown>, escalation: Record<string, unknown>): Node_ {
    return withDom(() => {
      M.state.syncClose = { agentId: target.id, code: "invalid_state", ...escalation };
      return M.renderSyncCloseDialog(target);
    });
  }

  test("it names every sibling agent the close would take with it", () => {
    const target = agent();
    const dialog = openDialog(target, ESCALATION_REPLY.escalation);
    const text = textOf(dialog);
    expect(text).toContain("Ridge reviewer");
    expect(text).toContain("Ridge backend");
    expect(dialog.attributes.role).toBe("dialog");
    expect(dialog.attributes["aria-modal"]).toBe("true");
    M.state.syncClose = null;
  });

  test("an empty sibling list says so rather than leaving the question open", () => {
    const target = agent();
    const text = textOf(openDialog(target, { workspaceId: "WORKSPACE-1", siblingAgents: [] }));
    expect(text).toContain("No other agents share this workspace");
    M.state.syncClose = null;
  });

  test("it states that the close cannot be undone", () => {
    const target = agent();
    expect(textOf(openDialog(target, ESCALATION_REPLY.escalation)).toLowerCase()).toContain("cannot be undone");
    M.state.syncClose = null;
  });

  test("confirm posts the frozen workspace envelope; cancel issues nothing", async () => {
    const target = agent();
    await withState({ snap: snapshot([target]), conn: "live", pending: new Set(), feedback: new Map(), syncClose: null }, async () => {
      await withRequests([{ status: 200, json: ESCALATION_REPLY }, { status: 200, json: { ok: true } }], async (calls) => {
        await M.sendSyncClose(target, { target: "surface", id: "SURFACE-1" });
        const dialog = M.renderSyncCloseDialog(target);
        await fire(byFkey(dialog, "sync-close-confirm:" + target.id));
        expect(calls).toHaveLength(2);
        expect(calls[1]!.url).toBe("/api/sync/close");
        expect(calls[1]!.body).toEqual({ target: "workspace", id: "WORKSPACE-1", confirm: true });
        expect(M.state.syncClose).toBeNull();
        expect(M.state.feedback.get(target.id)?.ok).toBe(true);
      });

      await withRequests([{ status: 200, json: ESCALATION_REPLY }], async (calls) => {
        await M.sendSyncClose(target, { target: "surface", id: "SURFACE-1" });
        const dialog = M.renderSyncCloseDialog(target);
        await fire(byFkey(dialog, "sync-close-cancel:" + target.id));
        expect(calls).toHaveLength(1); // the escalating call and nothing after it
        expect(M.state.syncClose).toBeNull();
      });
    });
  });

  test("confirm_required from a direct workspace close routes into the same dialog", async () => {
    const target = agent();
    await withState({ snap: snapshot([target]), conn: "live", pending: new Set(), feedback: new Map(), syncClose: null }, () =>
      withRequests([{
        status: 200,
        json: { ok: false, code: "confirm_required", escalation: ESCALATION_REPLY.escalation },
      }], async () => {
        await M.sendSyncClose(target, { target: "workspace", id: "WORKSPACE-1" });
        expect(M.state.syncClose).toMatchObject({ agentId: target.id, code: "confirm_required", workspaceId: "WORKSPACE-1" });
        const text = textOf(M.renderSyncCloseDialog(target));
        expect(text).toContain("Ridge reviewer");
        expect(text.toLowerCase()).toContain("cannot be undone");
      }));
  });

  /* [[fixtures-are-not-payloads]]. A reply the client can only half-read must
     not become a dialog: every one of these carries `invalid_state` with an
     escalation object that is NOT the frozen shape, and a dialog built from any
     of them would tell the operator either nothing or something untrue about
     who the confirm button kills. */
  test("an escalation envelope the client cannot fully read renders no dialog", async () => {
    const target = agent();
    const wrong = [
      { ok: false, code: "invalid_state" },                                                     // no escalation at all
      { ok: false, code: "invalid_state", escalation: { siblingAgents: [] } },                   // no workspace named
      { ok: false, code: "invalid_state", escalation: { workspaceId: "W", siblings: [] } },      // renamed list
      { ok: false, code: "invalid_state", escalation: { workspaceId: "W", siblingAgents: {} } }, // not a list
      // The dangerous one: a list the client can see but cannot name. Dropping
      // the unreadable entries would print "No other agents share this
      // workspace" over two agents this click is about to close.
      { ok: false, code: "invalid_state", escalation: { workspaceId: "W", siblingAgents: [{ agentId: "x", label: "Ridge reviewer" }] } },
    ];
    for (const json of wrong) {
      await withState({ snap: snapshot([target]), conn: "live", pending: new Set(), feedback: new Map(), syncClose: null }, () =>
        withRequests([{ status: 200, json }], async () => {
          await M.sendSyncClose(target, { target: "surface", id: "SURFACE-1" });
          expect(M.state.syncClose, JSON.stringify(json)).toBeNull();
          expect(withDom(() => M.renderSyncCloseDialog(target)), JSON.stringify(json)).toBeNull();
          // Fail loud: a refusal it could not read is reported as a failure.
          expect(M.state.feedback.get(target.id)?.ok, JSON.stringify(json)).toBe(false);
        }));
    }
  });

  test("keyboard: Escape cancels, Tab is trapped, and Cancel takes the initial focus", async () => {
    const target = agent();
    await withState({ snap: snapshot([target]), conn: "live", pending: new Set(), feedback: new Map(), syncClose: null }, () =>
      withRequests([{ status: 200, json: ESCALATION_REPLY }], async () => {
        const focused: string[] = [];
        G.document.querySelector = (sel: string) => ({ focus: () => focused.push(sel) });
        await M.sendSyncClose(target, { target: "surface", id: "SURFACE-1" });
        // Destructive default: the dialog opens standing on Cancel.
        expect(focused).toEqual([`[data-fkey="sync-close-cancel:${target.id}"]`]);

        const dialog = M.renderSyncCloseDialog(target);
        const cancel = byFkey(dialog, "sync-close-cancel:" + target.id);
        const confirm = byFkey(dialog, "sync-close-confirm:" + target.id);
        const landed: Node_[] = [];
        for (const stop of [cancel, confirm]) stop.focus = () => landed.push(stop);

        // Tab from Cancel reaches Confirm; Tab from Confirm wraps back rather
        // than escaping into the board behind a modal.
        G.document.activeElement = cancel;
        await fire(dialog, "keydown", { key: "Tab" });
        expect(landed).toEqual([confirm]);
        G.document.activeElement = confirm;
        await fire(dialog, "keydown", { key: "Tab" });
        expect(landed).toEqual([confirm, cancel]);
        // Shift+Tab walks the other way.
        await fire(dialog, "keydown", { key: "Tab", shiftKey: true });
        expect(landed).toEqual([confirm, cancel, cancel]);

        await fire(dialog, "keydown", { key: "Escape" });
        expect(M.state.syncClose).toBeNull();
      }));
  });

  test("Escape inside the dialog stops there, so it cannot also close the drawer", async () => {
    /* The board's own Escape chain ends in closeInspector(). If this dialog let
       the key bubble, one press would cancel the escalation AND close the drawer
       behind it — the operator loses both the question and their place. */
    const target = agent();
    await withState({ snap: snapshot([target]), conn: "live", syncClose: null }, () =>
      withRequests([], async () => {
        M.state.syncClose = { agentId: target.id, code: "invalid_state", ...ESCALATION_REPLY.escalation };
        const dialog = M.renderSyncCloseDialog(target);
        let stopped = false;
        await fire(dialog, "keydown", { key: "Escape", stopPropagation() { stopped = true; } });
        expect(stopped).toBe(true);
        expect(M.state.syncClose).toBeNull();
      }));
  });

  test("the open dialog is part of the drawer's paint signature", () => {
    const target = agent();
    const snap = snapshot([target]);
    const sel = { kind: "agent", id: target.id };
    const view = { kind: "agent", agent: target, program: snap.programs[0] };
    const base = { ...M.state, snap, syncClose: null };
    const closed = M.inspectorPaintSig(sel, view, base);
    const open = M.inspectorPaintSig(sel, view, { ...base, syncClose: { agentId: target.id, code: "invalid_state", workspaceId: "W", siblingAgents: [] } });
    expect(open).not.toBe(closed);
  });

  test("the drawer mounts the dialog for the agent it belongs to, and no other", () => {
    const target = agent();
    const other = agent({ id: "codex:zz" });
    const snap = snapshot([target, other]);
    const paint = (subject: Record<string, unknown>) => withDom(() => {
      const pane = M.el("aside", {});
      M.renderAgentDrawer(pane, { kind: "agent", agent: subject, program: snap.programs[0] });
      return pane;
    });
    return withState({ snap, syncClose: { agentId: target.id, code: "invalid_state", workspaceId: "WORKSPACE-1", siblingAgents: [] } }, () => {
      expect(byClass(paint(target), "sync-close-dialog")).not.toBeNull();
      expect(byClass(paint(other), "sync-close-dialog")).toBeNull();
    });
  });
});

describe("SYNC-CF — house constraints", () => {
  test("the close surfaces carry no inline styles (strict CSP)", () => {
    const dialog = withDom(() => {
      M.state.syncClose = { agentId: "codex:a1", code: "invalid_state", workspaceId: "W", siblingAgents: [{ id: "b", name: "Ridge reviewer" }] };
      const node = M.renderSyncCloseDialog(agent());
      M.state.syncClose = null;
      return node;
    });
    for (const node of findAll(dialog, () => true)) {
      expect(node.attributes?.style).toBeUndefined();
    }
    expect(byFkey(dockFor(agent()), "sync-close:codex:a1").attributes.style).toBeUndefined();
  });

  test("the dialog and the close tool are styled by the stylesheet, not by the client", () => {
    expect(styles).toContain(".sync-close-dialog");
    expect(styles).toContain(".sync-close-tool");
  });

  test("the board never invents a close policy: only the route decides", () => {
    /* The client holds no list of closable workspaces, no retry, and no second
       endpoint. One URL, and the only bodies it can build are the two frozen
       shapes. */
    expect(source.match(/apiFetch\("\/api\/sync\/close"/g)).toHaveLength(1);
    expect(source).not.toContain('target: "window"');
  });
});
