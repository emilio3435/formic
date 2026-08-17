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
      expect(document.querySelector("[data-group='needs-parser'] [data-instance='grok-bot:grok-bot-2']")?.textContent)
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
      expect(document.querySelector("[data-instance='cursor-gui:cursor']")?.textContent).toMatch(/Collecting/);
      expect(document.querySelector("[data-group='imported-no-rows'] [data-instance='grok-bot:grok-bot-2']")?.textContent)
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
      expect(document.querySelector("[data-instance='copilot:dot-copilot']")?.textContent).toMatch(/Collecting/);
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
