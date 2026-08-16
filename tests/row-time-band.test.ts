import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let M: any;

beforeAll(async () => {
  // @ts-expect-error browser client has no declaration
  await import("../src/web/app.js");
  M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
});

const NOW = "2026-08-16T12:00:00.000Z";
const nowMs = Date.parse(NOW);
const ago = (ms: number) => new Date(nowMs - ms).toISOString();
const styles = readFileSync(resolve(import.meta.dir, "../src/web/styles.css"), "utf8");

function makeNode(tag: string): any {
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
    get nextSibling() {
      if (!node.parent) return null;
      const i = node.parent.children.indexOf(node);
      return (i >= 0 && node.parent.children[i + 1]) || null;
    },
    setAttribute(k: string, v: unknown) { node.attributes[k] = String(v); },
    removeAttribute(k: string) { delete node.attributes[k]; },
    hasAttribute(k: string) { return k in node.attributes; },
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

function fakeDocument() {
  const byId = new Map<string, any>();
  return {
    createElement: (t: string) => makeNode(t),
    createElementNS: (_ns: string, t: string) => makeNode(t),
    createTextNode: (s: string) => ({ nodeType: 3, textContent: String(s) }),
    getElementById: (id: string) => {
      if (!byId.has(id)) byId.set(id, makeNode("div"));
      return byId.get(id);
    },
    querySelectorAll: () => [] as unknown[],
    querySelector: () => null,
    body: makeNode("body"),
  };
}

function withDom<T>(fn: () => T): T {
  (globalThis as any).document = fakeDocument();
  (globalThis as any).CSS = { escape: (s: string) => s };
  try { return fn(); } finally { delete (globalThis as any).document; delete (globalThis as any).CSS; }
}

function textOf(node: any): string {
  if (!node || typeof node !== "object") return "";
  if (node.nodeType === 3) return String(node.textContent || "");
  let s = typeof node.textContent === "string" ? node.textContent : "";
  for (const kid of node.children || []) s += textOf(kid);
  return s;
}

function findAll(node: any, pred: (n: any) => boolean, out: any[] = []): any[] {
  if (!node || typeof node !== "object") return out;
  if (pred(node)) out.push(node);
  for (const kid of node.children || []) findAll(kid, pred, out);
  return out;
}

const byClass = (node: any, token: string) =>
  findAll(node, (n) => typeof n.className === "string" && n.className.split(/\s+/).includes(token))[0] || null;

function agent(overrides: Record<string, unknown> = {}) {
  return {
    id: "codex:row-time",
    provider: "codex",
    sourceSessionId: "row-time",
    displayName: "RRB · b3-spec · sol · 08-16",
    programId: "p1",
    status: "running",
    statusReason: "Streaming output.",
    updatedAt: ago(30_000),
    lifecycle: "working",
    scope: "observed",
    tokens: { provenance: "observed", total: 1200 },
    artifacts: [],
    gates: [],
    target: { resolution: "exact", surfaceId: "s1", workspaceId: "w1" },
    controls: [],
    ...overrides,
  };
}

function listUi(overrides: Record<string, unknown> = {}) {
  return {
    snap: { generatedAt: NOW, schemaVersion: 1, programs: [] },
    labels: new Map(),
    selectedId: null,
    renaming: null,
    renamePending: false,
    renameError: "",
    ...overrides,
  };
}

function withSnap<T>(fn: () => T): T {
  const prev = M.state.snap;
  M.state.snap = { ...(prev || {}), generatedAt: NOW, schemaVersion: 1, programs: [] };
  try { return fn(); } finally { M.state.snap = prev; }
}

function renderRow(rowAgent: Record<string, unknown>) {
  return withSnap(() => withDom(() =>
    M.renderAgentRow(rowAgent, { id: "p1", name: "P", agents: [rowAgent] })));
}

describe("row time formatters", () => {
  test("working duration keeps leftover seconds and never prints 0s", () => {
    expect(M.fmtWorkingDuration(400)).toBe("");
    expect(M.fmtWorkingDuration(47_000)).toBe("47s");
    expect(M.fmtWorkingDuration(72_000)).toBe("1m 12s");
    expect(M.fmtWorkingDuration(4 * 60_000)).toBe("4m");
    expect(M.fmtWorkingDuration(3 * 3600_000 + 12 * 60_000)).toBe("3h 12m");
    expect(M.fmtWorkingDuration(2 * 86400_000)).toBe("2d");
  });

  test("compact age is an integer unit, not a sentence", () => {
    expect(M.fmtCompactAge(400)).toBe("");
    expect(M.fmtCompactAge(2 * 60_000)).toBe("2m");
    expect(M.fmtCompactAge(18 * 60_000)).toBe("18m");
    expect(M.fmtCompactAge(3 * 3600_000)).toBe("3h");
    expect(M.fmtCompactAge(2 * 86400_000)).toBe("2d");
    expect(M.fmtCompactAge(2 * 60_000)).not.toMatch(/ago|since|for /);
  });

  test("the verb set is the five locked infinitives and is stable per id", () => {
    expect(M.ROW_TIME_VERBS).toEqual(["percolating", "foraging", "sifting", "tracing", "stitching"]);
    const first = M.rowTimeVerb("codex:alpha");
    expect(M.ROW_TIME_VERBS).toContain(first);
    expect(M.rowTimeVerb("codex:alpha")).toBe(first);
    const seen = new Set(Array.from({ length: 40 }, (_, i) => M.rowTimeVerb("codex:session-" + i)));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("rowTimeBand model", () => {
  test("working rows are verb + streak duration; quiet rows are compact age; done is empty", () => {
    const working = M.rowTimeBand(agent({
      workingSince: ago(4 * 60_000),
      lastThreadAt: ago(5_000),
    }), nowMs);
    expect(working).toMatchObject({ kind: "doing", tone: "working", duration: "4m" });
    expect(M.ROW_TIME_VERBS).toContain(working.verb);
    expect(working.age).toBeUndefined();

    const waiting = M.rowTimeBand(agent({
      lifecycle: "waiting",
      outcome: "healthy",
      lastThreadAt: ago(2 * 60_000),
      updatedAt: ago(2 * 60_000),
    }), nowMs);
    expect(waiting).toEqual({ kind: "since", age: "2m", tone: "waiting" });

    const needsYou = M.rowTimeBand(agent({
      lifecycle: "waiting",
      outcome: "needs-you",
      lastThreadAt: ago(18 * 60_000),
      updatedAt: ago(18 * 60_000),
    }), nowMs);
    expect(needsYou).toEqual({ kind: "since", age: "18m", tone: "needs-you" });

    const stalled = M.rowTimeBand(agent({
      lifecycle: "waiting",
      outcome: "healthy",
      lastThreadAt: ago(18 * 60_000),
      updatedAt: ago(18 * 60_000),
    }), nowMs);
    expect(stalled).toEqual({ kind: "since", age: "18m", tone: "stalled" });

    expect(M.rowTimeBand(agent({ lifecycle: "finished", lastThreadAt: ago(2 * 60_000) }), nowMs)).toBeNull();
  });

  test("fresh work stays blank rather than printing 0s", () => {
    const band = M.rowTimeBand(agent({ workingSince: ago(400), lastThreadAt: ago(400) }), nowMs);
    expect(band.kind).toBe("doing");
    expect(band.duration).toBe("");
    expect(band.verb).toBeTruthy();
  });

  test("quiet age uses lastThreadAt, not collector updatedAt", () => {
    const band = M.rowTimeBand(agent({
      lifecycle: "waiting",
      outcome: "healthy",
      updatedAt: ago(60 * 60_000),
      lastThreadAt: ago(4 * 60_000),
    }), nowMs);
    expect(band).toMatchObject({ kind: "since", age: "4m" });
  });

  test("working duration uses workingSince, not the last tool", () => {
    const band = M.rowTimeBand(agent({
      workingSince: ago(4 * 60_000),
      lastThreadAt: ago(5_000),
    }), nowMs);
    expect(band.duration).toBe("4m");
    expect(band.duration).not.toBe("5s");
  });
});

describe("board row paint", () => {
  test("working rows show verb + duration under the name; status stays on the right", () => {
    const row = renderRow(agent({
      id: "codex:working-band",
      workingSince: ago(72_000),
      lastThreadAt: ago(5_000),
    }));
    const band = byClass(row, "row-time-band");
    const verb = byClass(row, "row-time-band-verb");
    const clock = byClass(row, "row-time-band-clock");
    const state = byClass(row, "row-state");
    expect(band).not.toBeNull();
    expect(band.classList.contains("is-working")).toBe(true);
    expect(M.ROW_TIME_VERBS).toContain(textOf(verb).trim());
    expect(textOf(clock)).toBe("1m 12s");
    expect(textOf(state)).toMatch(/Working/);
    expect(byClass(row, "row-workspace")).toBeNull();
    expect(byClass(band, "row-time-band-verb")).not.toBeNull();
    expect(textOf(band)).not.toMatch(/\b2m\b|\b18m\b/);
  });

  test("quiet rows show one compact age; needs-you is amber and waiting is graphite", () => {
    const waiting = renderRow(agent({
      id: "codex:waiting-band",
      lifecycle: "waiting",
      outcome: "healthy",
      lastThreadAt: ago(2 * 60_000),
      updatedAt: ago(2 * 60_000),
    }));
    expect(byClass(waiting, "row-time-band-verb")).toBeNull();
    expect(textOf(byClass(waiting, "row-time-band-clock"))).toBe("2m");
    expect(byClass(waiting, "row-time-band").classList.contains("is-waiting")).toBe(true);
    expect(textOf(byClass(waiting, "row-state"))).toMatch(/Waiting/);

    const needs = renderRow(agent({
      id: "codex:needs-band",
      lifecycle: "waiting",
      outcome: "needs-you",
      lastThreadAt: ago(4 * 60_000),
      updatedAt: ago(4 * 60_000),
    }));
    expect(textOf(byClass(needs, "row-time-band-clock"))).toBe("4m");
    expect(byClass(needs, "row-time-band").classList.contains("is-needs-you")).toBe(true);
    expect(textOf(byClass(needs, "row-state"))).toMatch(/Needs you/);

    const stalled = renderRow(agent({
      id: "codex:stalled-band",
      lifecycle: "waiting",
      outcome: "healthy",
      lastThreadAt: ago(3 * 3600_000),
      updatedAt: ago(18 * 60_000),
    }));
    expect(textOf(byClass(stalled, "row-time-band-clock"))).toBe("3h");
    expect(byClass(stalled, "row-time-band").classList.contains("is-stalled")).toBe(true);
    expect(stalled.classList.contains("is-stalled")).toBe(true);
    expect(textOf(byClass(stalled, "row-state"))).toMatch(/Stalled/);
  });

  test("done rows have no band; fresh work never prints 0s", () => {
    const done = renderRow(agent({
      id: "codex:done-band",
      lifecycle: "finished",
      lastThreadAt: ago(2 * 60_000),
    }));
    expect(byClass(done, "row-time-band")).toBeNull();
    expect(textOf(byClass(done, "row-state"))).toMatch(/Done/);

    const fresh = renderRow(agent({
      id: "codex:fresh-band",
      workingSince: ago(400),
      lastThreadAt: ago(400),
    }));
    expect(byClass(fresh, "row-time-band-verb")).not.toBeNull();
    expect(textOf(byClass(fresh, "row-time-band"))).not.toContain("0s");
  });

  test("a later tool does not rebuild a working row; a quiet lastThreadAt does", () => {
    const opts = { depth: 0, childCount: 0, fullById: new Map() };
    const ui = listUi();
    const working = agent({
      workingSince: ago(4 * 60_000),
      lastThreadAt: ago(60_000),
    });
    const afterTool = { ...working, lastThreadAt: ago(5_000) };
    expect(M.agentRowSig(afterTool, ui, opts)).toBe(M.agentRowSig(working, ui, opts));

    const newStreak = { ...working, workingSince: ago(10_000) };
    expect(M.agentRowSig(newStreak, ui, opts)).not.toBe(M.agentRowSig(working, ui, opts));

    const quiet = agent({
      lifecycle: "waiting",
      outcome: "healthy",
      lastThreadAt: ago(4 * 60_000),
      updatedAt: ago(4 * 60_000),
    });
    const quieter = { ...quiet, lastThreadAt: ago(2 * 60_000) };
    expect(M.agentRowSig(quieter, ui, opts)).not.toBe(M.agentRowSig(quiet, ui, opts));
  });

  test("tickClocks fills working and compact clocks from their datasets", () => {
    const working = { textContent: "", dataset: { workingSince: ago(47_000) } };
    const quiet = { textContent: "", dataset: { compactAgo: ago(18 * 60_000) } };
    const doc = {
      querySelectorAll: (sel: string) =>
        sel === "[data-working-since]" ? [working]
          : sel === "[data-compact-ago]" ? [quiet]
            : [],
    };
    (globalThis as any).document = doc;
    try {
      M.tickClocks(false, nowMs);
    } finally {
      delete (globalThis as any).document;
    }
    expect(working.textContent).toBe("47s");
    expect(quiet.textContent).toBe("18m");
  });
});

describe("verb shimmer CSS", () => {
  test("sweeps the five Formic inks left to right and skips danger red", () => {
    expect(styles).toMatch(/\.row-time-band-verb[^{]*\{[\s\S]*?animation:\s*row-time-verb-shimmer\s+7s\s+linear\s+infinite/);
    expect(styles).toMatch(/\.row-time-band-clock[^{]*\{[^}]*color:\s*var\(--color-status-info\)/);
    expect(styles).toMatch(/\.row-time-band\.is-needs-you[^{]*\{[^}]*color:\s*var\(--color-status-warning\)/);
    expect(styles).toMatch(/\.row-time-band\.is-waiting[^{]*[\s\S]*?color:\s*var\(--idle\)/);
    expect(styles).toMatch(/drop-shadow\([^)]*#5b4fd1/);
    expect(styles).toMatch(/\.row-time-band-verb[^{]*\{[\s\S]*?linear-gradient\(\s*90deg/);
    const verb = styles.match(/\.row-time-band-verb\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const hexes = [...verb.matchAll(/#([0-9a-fA-F]{6})/g)].map((match) => match[0].toLowerCase());
    expect(hexes).toEqual(["#3172c4", "#5b4fd1", "#c1632b", "#d9a22e", "#1e9e5c", "#3172c4", "#5b4fd1"]);
    expect(hexes).not.toContain("#d1453d");
    expect(verb).not.toMatch(/hue-rotate/);
    const shimmer = styles.match(/@keyframes row-time-verb-shimmer\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(shimmer).toMatch(/background-position:\s*0%\s+50%/);
    expect(shimmer).toMatch(/background-position:\s*100%\s+50%/);
    expect(shimmer).not.toMatch(/hue-rotate/);
    expect(styles).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*\.row-time-band-verb\s*\{[\s\S]*?animation:\s*none/);
    expect(styles).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*\.row-time-band-verb\s*\{[\s\S]*?filter:\s*none/);
    expect(styles).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*\.row-time-band-verb\s*\{[\s\S]*?color:\s*var\(--color-status-info\)/);
  });
});
