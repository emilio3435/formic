import { beforeAll, describe, expect, test } from "bun:test";

/* Same TheAntHill + fake-DOM harness as tests/settings-collectors-dom.test.ts.
   This file asserts the desk chrome, dirty close, and the six setting ids. */

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

function walkNodes(node: FakeNode | null, out: FakeNode[] = [], seen = new Set<FakeNode>()): FakeNode[] {
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

function withDom<T>(fn: () => T): T {
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
  try { return fn(); } finally {
    delete (globalThis as unknown as { document?: unknown }).document;
  }
}

describe("Settings desk chrome", () => {
  test("span first, clay Save time, no Done, no This browser, no Advanced", () => {
    withDom(() => {
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
      const panel = document.getElementById("settings-panel") as unknown as FakeNode;
      expect(panel.textContent).toMatch(/operator desk/i);
      expect(panel.textContent).not.toMatch(/This browser/);
      expect(panel.textContent).not.toMatch(/Save applies to Time/);
      expect(document.querySelector("[data-fkey='settings-done']")).toBeNull();
      expect(document.querySelector("details.settings-advanced")).toBeNull();
      const save = document.querySelector("[data-fkey='settings-save']") as { className: string; textContent: string } | null;
      expect(save?.className.split(/\s+/)).toContain("primary");
      expect(save?.textContent).toMatch(/Save time/);
      expect(document.querySelector("[data-fkey='settings-reset']")?.textContent).toMatch(/Reset span/);
      expect(document.getElementById("setting-activityFreshMinutes")).toBeTruthy();
      expect(document.getElementById("setting-activityQuietMinutes")).toBeTruthy();
      expect(document.getElementById("setting-scanWindowHours")).toBeTruthy();
      expect(document.getElementById("setting-historyRecordLimit")).toBeTruthy();
    });
  });

  test("needs-you is two plates, not a This browser radio list", () => {
    withDom(() => {
      web.state.settingsPanelOpen = true;
      web.state.needsYouDisplay = "pane";
      if (web.state.paintSig) web.state.paintSig.settings = "";
      web.renderSettingsPanel();
      expect(document.querySelector("[data-fkey='needs-you-display-pane']")?.className).toMatch(/is-on/);
      expect(document.querySelector("input[name='needs-you-display']")).toBeNull();
      expect(document.getElementById("settings-panel")?.textContent).not.toMatch(/This browser/);
    });
  });

  test("a snapshot tick does not remount plates or the Working/Quiet inputs", () => {
    withDom(() => {
      web.state.settingsPanelOpen = true;
      web.state.needsYouDisplay = "pane";
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
      const fresh = document.getElementById("setting-activityFreshMinutes");
      const quiet = document.getElementById("setting-activityQuietMinutes");
      const pane = document.querySelector("[data-fkey='needs-you-display-pane']");
      web.renderSettingsPanel();
      expect(document.getElementById("setting-activityFreshMinutes")).toBe(fresh);
      expect(document.getElementById("setting-activityQuietMinutes")).toBe(quiet);
      expect(document.querySelector("[data-fkey='needs-you-display-pane']")).toBe(pane);
    });
  });

  test("dirty Quiet refuses close and writes the span verdict", () => {
    withDom(() => {
      web.state.settingsPanelOpen = true;
      web.state.settings = { activityFreshMinutes: 3, activityQuietMinutes: 45, scanWindowHours: 36, providerWaitMs: 7500, historyRetentionDays: 30, historyRecordLimit: 5000 };
      if (web.state.paintSig) web.state.paintSig.settings = "";
      web.renderSettingsPanel();
      const quiet = document.getElementById("setting-activityQuietMinutes") as unknown as { value: string };
      quiet.value = "12";
      web.requestCloseSettingsPanel();
      expect(web.state.settingsPanelOpen).toBe(true);
      expect(document.getElementById("settings-verdict")?.textContent)
        .toBe("Not saved. The span has not been written.");
    });
  });

  test("collector fetch does not wipe a typed Quiet or a checked import box", () => {
    withDom(() => {
      web.state.settingsPanelOpen = true;
      web.state.settings = { activityFreshMinutes: 3, activityQuietMinutes: 45, scanWindowHours: 36, providerWaitMs: 7500, historyRetentionDays: 30, historyRecordLimit: 5000 };
      web.state.collectorInstances = [
        { id: "cursor-gui:cursor", kind: "cursor-gui", label: "Cursor", default: true, onboarded: true, ignored: false, dataDir: "/c" },
        { id: "claude:claude", kind: "claude", label: "Claude", default: false, onboarded: false, ignored: false, reason: "needs-parser", dataDir: "/x" },
      ];
      if (web.state.paintSig) web.state.paintSig.settings = "";
      web.renderSettingsPanel();
      const quiet = document.getElementById("setting-activityQuietMinutes") as unknown as { value: string };
      quiet.value = "12";
      const box = document.querySelector("[data-instance='claude:claude'] input[type='checkbox']") as unknown as { checked: boolean };
      box.checked = true;
      web.state.collectorInstances = [
        ...web.state.collectorInstances,
        { id: "muse:muse", kind: "muse", label: "Muse", default: false, onboarded: false, ignored: false, dataDir: "/m" },
      ];
      web.renderSettingsPanel();
      expect((document.getElementById("setting-activityQuietMinutes") as unknown as { value: string }).value).toBe("12");
      expect((document.querySelector("[data-instance='claude:claude'] input[type='checkbox']") as unknown as { checked: boolean }).checked).toBe(true);
    });
  });
});
