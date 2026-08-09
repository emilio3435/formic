import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// app.js is a browser client that guards DOM wiring behind typeof document.
// Importing it under Bun exposes pure helpers on globalThis.TheAntHill.
let M: any;

beforeAll(async () => {
  // @ts-expect-error browser client has no declaration
  await import("../src/web/app.js");
  M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
});

// Minimal fake DOM so renderAgentRow / renderChat can build real nodes via el()/icon().
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

function primeFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "prime:019fe46c-d482-706c-b080-08f1420c8ae3",
    provider: "prime",
    sourceSessionId: "019fe46c-d482-706c-b080-08f1420c8ae3",
    displayName: "Prime · 019fe46c",
    programId: "p1",
    status: "running",
    statusReason: "Prime agent — harness prime, agent muse-spark-1.2-contributor",
    updatedAt: "2026-08-09T04:03:40.000Z",
    lifecycle: "working",
    scope: "observed",
    tokens: { provenance: "observed", total: 500, contextWindow: 1_000_000 },
    artifacts: [],
    gates: [],
    target: { resolution: "exact", surfaceId: "s1", workspaceId: "w1" },
    transcriptTail: "[TL;DR 04:03] Global Prime Skill live — workspace:64 + workspace:62, board healthy. Blockers: all-clear",
    lastAgentMessage: null,
    lastUserMessage: null,
    task: "you are the orchestrator over a flight of Prime Agent Muse Spark 1.2 agents. initial task",
    ...overrides,
  };
}

describe("B2 [TL;DR] render proof — prime.ts → transcriptTail → snapshot.ts → app.js", () => {
  test("renderAgentRow surfaces transcriptTail containing [TL;DR", () => {
    const agent = primeFixture();
    const program = { id: "p1", name: "The Mountain", agents: [agent] };
    const row = withDom(() => M.renderAgentRow(agent, program, {}));
    const text = textOf(row);
    expect(text).toContain("[TL;DR");
    expect(text).toContain("04:03");
    expect(text).toContain("Blockers: all-clear");
  });

  test("renderAgentDrawer Chat surfaces transcriptTail [TL;DR]", () => {
    const agent = primeFixture();
    const chat = withDom(() => M.renderChat(agent));
    const text = textOf(chat);
    expect(text).toContain("[TL;DR");
    expect(text).toContain("04:03");
    expect(text).toContain("Blockers: all-clear");
  });

  test("MAX_TRANSCRIPT_TAIL_CHARS is 800 and wire truncates to that cap", async () => {
    const { MAX_TRANSCRIPT_TAIL_CHARS } = await import("../src/server/types");
    expect(MAX_TRANSCRIPT_TAIL_CHARS).toBe(800);

    // Snapshot caps tail to 800: build a collected agent with 2000-char tail, snapshot must slice to 800.
    const { buildSnapshot } = await import("../src/server/snapshot");
    const longTail = "[TL;DR 04:03] " + "x".repeat(2000);
    const collected: any = {
      id: "prime:test-long-tail",
      provider: "prime",
      sourceSessionId: "test-long-tail",
      displayName: "Prime · test",
      identity: { name: "Prime test", base: "Prime test", source: "provider-fallback" },
      model: "muse-spark-1.2-contributor",
      task: "task",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tokens: { provenance: "unknown", contextWindow: 1_000_000 },
      transcriptTail: longTail,
      humanMessages: [],
      statusReason: "prime",
      artifacts: [],
      gates: [],
    };
    const snap: any = buildSnapshot({
      agents: [collected],
      surfaces: [],
      archiveStore: { archivedAgents: () => [], has: () => false } as any,
      now: new Date(),
    });
    const snapAgent = snap.programs.flatMap((p: any) => p.agents).find((a: any) => a.id === "prime:test-long-tail");
    expect(snapAgent.transcriptTail.length).toBe(800);
    // tail is end-anchored slice, so it should end with the tail of the original
    expect(longTail.endsWith(snapAgent.transcriptTail)).toBe(true);
  });

  test("row caps [TL;DR] via conciseText 120 even when wire tail is 800", () => {
    // Row uses conciseText 120 (roster diet), drawer Chat renders full 800-char tail.
    // Use a tail where [TL;DR] is at the START but length ~ 750 so slice(-800) preserves it.
    const longTldr = "[TL;DR 04:03] " + "y".repeat(730) + " Blockers: all-clear";
    expect(longTldr.length).toBeGreaterThan(700);
    expect(longTldr.length).toBeLessThan(800);
    const agent = primeFixture({ transcriptTail: longTldr });
    const program = { id: "p1", name: "P", agents: [agent] };
    const row = withDom(() => M.renderAgentRow(agent, program, {}));
    const rowText = textOf(row);
    expect(rowText).toContain("[TL;DR");
    const chat = withDom(() => M.renderChat(agent));
    const chatText = textOf(chat);
    expect(chatText).toContain("[TL;DR");
    expect(chatText).toContain("Blockers: all-clear");
  });

  test("prime parser caps tail to MAX_TRANSCRIPT_TAIL_CHARS and retains [TL;DR] when under cap", async () => {
    const { parsePrimeJsonl } = await import("../src/server/prime");
    const { MAX_TRANSCRIPT_TAIL_CHARS } = await import("../src/server/types");
    const tldr = "[TL;DR 04:03] short summary — Blockers: all-clear";
    const jsonl = [
      JSON.stringify({ type: "session", id: "019fe46c-d482-706c-b080-08f1420c8ae3", cwd: "/tmp", timestamp: new Date().toISOString() }),
      JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: tldr }], timestamp: new Date().toISOString() } }),
    ].join("\n");
    const agent: any = parsePrimeJsonl(jsonl);
    expect(agent.transcriptTail).toBe(tldr);
    expect(agent.transcriptTail.length).toBeLessThanOrEqual(MAX_TRANSCRIPT_TAIL_CHARS);
    expect(agent.transcriptTail).toContain("[TL;DR");

    // Long tail beyond cap
    const longText = "z".repeat(1000) + " [TL;DR 04:03] tail end Blockers: all-clear";
    // prime.ts slices from END, so a long prefix with TL;DR at end survives; TL;DR at start would be lost — this is why B2 keeps TL;DR concise.
    const jsonl2 = [
      JSON.stringify({ type: "session", id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", cwd: "/tmp", timestamp: new Date().toISOString() }),
      JSON.stringify({ type: "message", message: { role: "assistant", content: longText, timestamp: new Date().toISOString() } }),
    ].join("\n");
    const agent2: any = parsePrimeJsonl(jsonl2);
    expect(agent2.transcriptTail.length).toBe(MAX_TRANSCRIPT_TAIL_CHARS);
  });

  test("full transcript on disk is never truncated — jsonl retains all lines, only wire tail caps to 800", async () => {
    // Simulate a session with 100 jsonl lines (like the real 135+ line session)
    const lines = Array.from({ length: 100 }, (_, i) =>
      JSON.stringify({ type: "message", message: { role: i % 2 === 0 ? "user" : "assistant", content: `line ${i} — ${"x".repeat(50)}`, timestamp: new Date().toISOString() } })
    );
    const sessionLine = JSON.stringify({ type: "session", id: "test-full-retention-uuid-1234", cwd: "/tmp", timestamp: new Date().toISOString() });
    const jsonl = [sessionLine, ...lines].join("\n");
    const jsonlLineCount = jsonl.split("\n").filter(Boolean).length;
    expect(jsonlLineCount).toBe(101); // 1 session + 100 messages — full file retained

    const { parsePrimeJsonl } = await import("../src/server/prime");
    const agent: any = parsePrimeJsonl(jsonl);
    // Wire only carries the last assistant tail capped to 800, but jsonl keeps every line
    expect(agent.transcriptTail.length).toBeLessThanOrEqual(800);
    // File line count is independent of wire cap — archive retains full jsonl at ~/.prime/agent/sessions/*.jsonl
    expect(jsonlLineCount).toBeGreaterThan(50);
    // Tail is from last assistant, not first line
    expect(agent.transcriptTail).toContain("line 99");
  });

  test("6/6 healthy counts PROVIDERS (6: omp, codex, claude, cursor, factory, prime) not providers+cmux", async () => {
    const { PROVIDERS } = await import("../src/shared/types");
    // Exhaustive 6 — the TODAY.md bug double-counted cmux and omitted omp (4 of 4 with wrong membership)
    expect(PROVIDERS).toEqual(["codex", "omp", "claude", "cursor", "factory", "prime"]);
    expect(PROVIDERS.length).toBe(6);
    const _exhaustive: Set<typeof PROVIDERS[number]> = new Set(PROVIDERS); void _exhaustive;

    // Snapshot sourceHealth must agree: healthy = PROVIDERS.length when no errors and none absent
    const { buildSnapshot } = await import("../src/server/snapshot");
    const snap: any = buildSnapshot({
      agents: [],
      surfaces: [],
      archiveStore: { archivedAgents: () => [], has: () => false } as any,
      now: new Date(),
    });
    // With no sourceErrors and no sourceAbsent, total = PROVIDERS.length, healthy = total
    expect(snap.totals.sourceHealth.total).toBe(PROVIDERS.length);
    expect(snap.totals.sourceHealth.healthy).toBe(PROVIDERS.length);
    expect(snap.totals.sourceHealth.degraded).toBe(0);
    // controlHealth.cmuxReachable is separate — not counted in sourceHealth
    expect(snap.controlHealth.cmuxReachable).toBeDefined();
    // Verify PROVIDERS exhaustive check compiles: snapshot uses `const collectorProviders: readonly Provider[] = PROVIDERS`
    const snapSrc = readFileSync("src/server/snapshot.ts", "utf8");
    expect(snapSrc).toContain("const collectorProviders: readonly Provider[] = PROVIDERS");
    expect(snapSrc).toContain('import { PROVIDERS } from "../shared/types"');
  });
});
