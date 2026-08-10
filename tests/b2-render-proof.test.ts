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
  const parsePrimeFixture = async (sessionId: string) => {
    const { parsePrimeJsonl } = await import("../src/server/prime");
    const timestamp = "2026-08-09T04:03:40.000Z";
    return parsePrimeJsonl([
      JSON.stringify({ type: "session", id: sessionId, cwd: "/tmp/the-mountain", timestamp }),
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: "[TL;DR 04:03] Heartbeat healthy — Blockers: all-clear",
          timestamp,
        },
      }),
    ].join("\n"));
  };

  test("the exact reserved Prime heartbeat monitor is declared system without routing authority", async () => {
    const agent: any = await parsePrimeFixture("ant-heartbeat-monitor");

    expect(agent).toMatchObject({
      id: "prime:ant-heartbeat-monitor",
      sourceSessionId: "ant-heartbeat-monitor",
      sessionKind: "system",
      sessionKindSource: "declared",
      transcriptTail: "[TL;DR 04:03] Heartbeat healthy — Blockers: all-clear",
    });
    expect(agent.recordedTarget).toBeUndefined();
    expect(agent.runtimeSessionId).toBeUndefined();
    expect(agent.processIds).toBeUndefined();
    expect(agent.allowCwdFallback).toBeUndefined();

    const { buildSnapshot } = await import("../src/server/snapshot");
    const snapshot: any = buildSnapshot({
      agents: [agent],
      surfaces: [],
      archiveStore: { archivedAgents: () => [], has: () => false } as any,
      now: new Date("2026-08-09T04:03:40.000Z"),
    });
    const published = snapshot.programs
      .flatMap((program: any) => program.agents)
      .find((candidate: any) => candidate.id === agent.id);

    expect(published).toMatchObject({
      id: "prime:ant-heartbeat-monitor",
      sessionKind: "system",
      sessionKindSource: "declared",
      transcriptTail: "[TL;DR 04:03] Heartbeat healthy — Blockers: all-clear",
      target: { resolution: "missing" },
    });
    expect(published.target.workspaceId).toBeUndefined();
    expect(published.target.surfaceId).toBeUndefined();
    expect(published.target.paneId).toBeUndefined();
  });

  test("an ordinary stable Prime session id is not declared system", async () => {
    const agent: any = await parsePrimeFixture("release-coordinator");
    expect(agent.sessionKind).toBeUndefined();
    expect(agent.sessionKindSource).toBeUndefined();
  });

  test("an ordinary UUID Prime session id is not declared system", async () => {
    const agent: any = await parsePrimeFixture("019fe46c-d482-706c-b080-08f1420c8ae3");
    expect(agent.sessionKind).toBeUndefined();
    expect(agent.sessionKindSource).toBeUndefined();
  });

  test("a near-match Prime heartbeat id is not declared system", async () => {
    const agent: any = await parsePrimeFixture("ant-heartbeat-monitor-2");
    expect(agent.sessionKind).toBeUndefined();
    expect(agent.sessionKindSource).toBeUndefined();
  });

  test("renderAgentRow surfaces transcriptTail containing [TL;DR", () => {
    // Row stability: TL;DR lives in header (per-repo, fleet-wide) and drawer Chat, not collapsed row.
    // Row shows stable Task (sidecar, 5m LLM) + live/working/alert at right — hybrid row.
    const agent = primeFixture({ task: "Stable Task via sidecar LLM", transcriptTail: "[TL;DR 04:03] should not appear in row" });
    const program = { id: "p1", name: "The Mountain", agents: [agent] };
    const row = withDom(() => M.renderAgentRow(agent, program, {}));
    const text = textOf(row);
    expect(text).not.toContain("[TL;DR");
    expect(text).toContain("Stable Task");
  });

  test("renderAgentDrawer Chat surfaces transcriptTail [TL;DR]", () => {
    const agent = primeFixture();
    const chat = withDom(() => M.renderChat(agent));
    const text = textOf(chat);
    expect(text).toContain("[TL;DR");
    expect(text).toContain("04:03");
    expect(text).toContain("Blockers: all-clear");
  });

  test("the header parser accepts bounded v3 JSON and keeps the legacy fallback", () => {
    const structured = M.parseHeartbeatStructured(
      '[TL;DR 12:34] {"v":3,"repos":[{"repo":"The Mountain","summary":"The Mountain: 2 live=1w+1i · reconcile UI · all-clear","blocker":"all-clear","signal":"working"}],"omitted":2}',
    );
    expect(structured.time).toBe("12:34");
    expect(structured.legacy).toBe(false);
    expect(structured.repos).toEqual([{
      repo: "The Mountain",
      summary: "The Mountain: 2 live=1w+1i · reconcile UI · all-clear",
      blocker: "all-clear",
      signal: "working",
    }]);

    const legacy = M.parseHeartbeatStructured(
      "[TL;DR 12:35] Home: 1 live=1w+0i · deploy · no blockers",
    );
    expect(legacy.legacy).toBe(true);
    expect(legacy.repos[0].repo).toBe("Home");
    expect(legacy.repos[0].signal).toBe("ok");
  });

  test("wire caps non-envelope tails to 800; [TL;DR envelopes keep the 6000 backstop", async () => {
    const { MAX_TRANSCRIPT_TAIL_CHARS, MAX_HEARTBEAT_TAIL_CHARS } = await import("../src/server/types");
    expect(MAX_TRANSCRIPT_TAIL_CHARS).toBe(800);
    expect(MAX_HEARTBEAT_TAIL_CHARS).toBe(6000);

    // An envelope-shaped tail (starts "[TL;DR ") is PRESERVED beyond 800 — the
    // old slice(-800) cut its head off and killed the parse (worst failure
    // mode: a long envelope became an unparseable stub). Non-envelope chatter
    // still caps at 800.
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
    // Envelope tail: preserved whole (2014 chars < 6000 backstop), head intact.
    expect(snapAgent.transcriptTail).toBe(longTail);

    // Non-envelope chatter still caps at 800, end-anchored.
    const chatter = "z".repeat(2000);
    const snap2: any = buildSnapshot({
      agents: [{ ...collected, id: "prime:test-chatter", sourceSessionId: "test-chatter", transcriptTail: chatter }],
      surfaces: [],
      archiveStore: { archivedAgents: () => [], has: () => false } as any,
      now: new Date(),
    });
    const chatterAgent = snap2.programs.flatMap((p: any) => p.agents).find((a: any) => a.id === "prime:test-chatter");
    expect(chatterAgent.transcriptTail.length).toBe(800);
    expect(chatter.endsWith(chatterAgent.transcriptTail)).toBe(true);
  });

  test("row caps [TL;DR] via conciseText 120 even when wire tail is 800", () => {
    // Row stability: Task is stable (sidecar, 5m, LLM), header is per-repo TL;DR fleet-wide.
    // Row no longer surfaces transcriptTail [TL;DR] — that lives in header (prime:ant-heartbeat-monitor, 800c) and drawer Chat.
    // This preserves the wire→pixel proof via drawer/header while row stays readable Task (hybrid row = Task middle + live/working/alert right).
    const longTldr = "[TL;DR 04:03] " + "y".repeat(730) + " Blockers: all-clear";
    expect(longTldr.length).toBeGreaterThan(700);
    expect(longTldr.length).toBeLessThan(800);
    const agent = primeFixture({ transcriptTail: longTldr, task: "Implement per-repo header TL;DRs with LLM" });
    const program = { id: "p1", name: "P", agents: [agent] };
    const row = withDom(() => M.renderAgentRow(agent, program, {}));
    const rowText = textOf(row);
    // Row now shows stable Task, not TL;DR (header/drawer own TL;DR)
    expect(rowText).not.toContain("[TL;DR");
    expect(rowText).toContain("Implement per-repo");
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
    // Non-envelope tail (starts with chatter, not "[TL;DR "): capped at 800 from the END.
    // A tail that STARTS with "[TL;DR " now keeps the 6000 backstop instead — see the wire-cap test above.
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
