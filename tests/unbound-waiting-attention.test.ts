/**
 * Issue #13 — an unread cmux Waiting notification with no bound session is
 * attention, painted as its own item (workspace title + "no session bound").
 *
 * Locked calls:
 *   1. Unmatched Waiting is attention, not dropped.
 *   2. Own item, not a fake agent row.
 *   3. Do not invent a session id or mint resolution: exact from the surface.
 *
 * Bound Waiting retains its session mapping. Completed / read toasts stay off
 * this list. No liveness, tokens, cost, progress, closing text, or attested
 * write surface is minted from the toast alone.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { buildSnapshot } from "../src/server/snapshot";
import { MemoryArchiveStore } from "../src/server/archive";
import type { CmuxSurface, CollectedAgent } from "../src/server/types";
import type { CmuxNotificationSummary } from "../src/shared/types";
import { fakeDocument, makeNode, textOf } from "./helpers/fake-dom";

const archiveStore = new MemoryArchiveStore();
const NOW = new Date("2026-08-16T16:39:00.000Z");

const UNBOUND_WORKSPACE = "9A1B5A19-3787-441F-8336-9BE4342E9D8E";
const UNBOUND_SURFACE = "58C3EBDE-8FD9-4605-9870-A1B190A45DAA";
const UNBOUND_NOTICE = "00C4FE88-2694-426D-981F-9D51E831B66F";
const BOUND_WORKSPACE = "WORKSPACE-COOPER";
const BOUND_SURFACE = "SURFACE-COOPER";
const BOUND_NOTICE = "1D8D12FC-BOUND-WAITING";

function waitingNotice(overrides: Partial<CmuxNotificationSummary> = {}): CmuxNotificationSummary {
  return {
    id: UNBOUND_NOTICE,
    workspaceId: UNBOUND_WORKSPACE,
    surfaceId: UNBOUND_SURFACE,
    title: "Claude Code",
    subtitle: "Waiting",
    body: "Waiting for your next prompt",
    isRead: false,
    createdAt: "2026-08-16T12:18:35.000Z",
    ...overrides,
  };
}

function collected(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: "claude:cooper",
    provider: "claude",
    sourceSessionId: "cooper",
    displayName: "cooper-scheduler Claude",
    cwd: "/Users/emilionunezgarcia/Developer/cooper-scheduler",
    status: "waiting",
    statusReason: "Waiting for operator input.",
    startedAt: "2026-08-16T11:00:00.000Z",
    updatedAt: "2026-08-16T12:00:00.000Z",
    tokens: { provenance: "unknown" },
    transcriptTail: "Which option should I use?",
    artifacts: [],
    gates: [],
    ...overrides,
  };
}

function surface(overrides: Partial<CmuxSurface> = {}): CmuxSurface {
  return {
    workspaceId: UNBOUND_WORKSPACE,
    surfaceId: UNBOUND_SURFACE,
    paneId: "PANE-UNBOUND",
    cwd: "/Users/emilionunezgarcia/Developer/empty-workspace",
    workspaceTitle: "draft-unbound",
    sourceSessionIds: [],
    ...overrides,
  };
}

function snapshotOf(
  input: Omit<Parameters<typeof buildSnapshot>[0], "archiveStore" | "now">,
) {
  return buildSnapshot({
    archiveStore,
    now: NOW,
    ...input,
  });
}

describe("unread Waiting notification binding", () => {
  test("an unmatched unread Waiting toast becomes unbound attention, not a minted session", () => {
    const snap = snapshotOf({
      agents: [],
      surfaces: [surface()],
      cmuxNotifications: [waitingNotice()],
    });

    expect(snap.unboundWaiting).toEqual([{
      notificationId: UNBOUND_NOTICE,
      workspaceId: UNBOUND_WORKSPACE,
      workspaceTitle: "draft-unbound",
      surfaceId: UNBOUND_SURFACE,
      title: "Claude Code",
      subtitle: "Waiting",
      body: "Waiting for your next prompt",
      createdAt: "2026-08-16T12:18:35.000Z",
    }]);
    expect(snap.programs.flatMap((program) => program.agents)).toEqual([]);
    expect(snap.totals.attention).toBe(1);
    /* Surface presence is not a write attestation and must not mint exact. */
    expect(JSON.stringify(snap)).not.toContain('"resolution":"exact"');
    expect(JSON.stringify(snap.unboundWaiting)).not.toMatch(/claude:|codex:|agent:/);
  });

  test("a bound Waiting toast keeps its session mapping and is not also unbound", () => {
    const boundSurface = surface({
      workspaceId: BOUND_WORKSPACE,
      surfaceId: BOUND_SURFACE,
      workspaceTitle: "cooper-scheduler",
      sourceSessionIds: ["cooper"],
      runtimeSurfaceReady: true,
    });
    const snap = snapshotOf({
      agents: [collected()],
      surfaces: [boundSurface],
      notifications: [{
        id: BOUND_NOTICE,
        workspaceId: BOUND_WORKSPACE,
        surfaceId: BOUND_SURFACE,
        title: "Claude Code",
        subtitle: "Waiting",
        body: "Waiting for your next prompt",
        createdAt: "2026-08-16T12:20:00.000Z",
      }],
      cmuxNotifications: [waitingNotice({
        id: BOUND_NOTICE,
        workspaceId: BOUND_WORKSPACE,
        surfaceId: BOUND_SURFACE,
      })],
    });

    const agent = snap.programs.flatMap((program) => program.agents)[0];
    expect(agent?.id).toBe("claude:cooper");
    expect(agent?.attention).toBe(true);
    expect(agent?.target.surfaceId).toBe(BOUND_SURFACE);
    expect(agent?.target.resolution).toBe("exact");
    expect(snap.unboundWaiting ?? []).toEqual([]);
    expect(snap.totals.attention).toBe(1);
  });

  test("Completed, read, or already-mapped Waiting toasts do not become unbound attention", () => {
    const boundSurface = surface({
      workspaceId: BOUND_WORKSPACE,
      surfaceId: BOUND_SURFACE,
      sourceSessionIds: ["cooper"],
      runtimeSurfaceReady: true,
    });
    const snap = snapshotOf({
      agents: [collected()],
      surfaces: [boundSurface, surface()],
      cmuxNotifications: [
        waitingNotice({ id: "READ-WAIT", isRead: true }),
        waitingNotice({
          id: "DONE",
          subtitle: "Completed",
          body: "Finished the turn.",
        }),
        waitingNotice({
          id: BOUND_NOTICE,
          workspaceId: BOUND_WORKSPACE,
          surfaceId: BOUND_SURFACE,
        }),
      ],
    });

    expect(snap.unboundWaiting ?? []).toEqual([]);
    const ids = snap.programs.flatMap((program) => program.agents).map((agent) => agent.id);
    expect(ids).toEqual(["claude:cooper"]);
    expect(ids).not.toContain(UNBOUND_SURFACE);
    expect(ids).not.toContain(UNBOUND_NOTICE);
  });

  test("a missing workspace title stays absent rather than inventing a name or session", () => {
    const snap = snapshotOf({
      agents: [],
      surfaces: [],
      cmuxNotifications: [waitingNotice()],
    });
    const item = snap.unboundWaiting?.[0];
    expect(item?.notificationId).toBe(UNBOUND_NOTICE);
    expect(item?.workspaceTitle).toBeUndefined();
    expect(item).not.toHaveProperty("agentId");
    expect(item).not.toHaveProperty("resolution");
    expect(item).not.toHaveProperty("tokens");
    expect(item).not.toHaveProperty("cost");
    expect(item).not.toHaveProperty("progress");
    expect(item).not.toHaveProperty("lastAgentClosing");
    expect(item).not.toHaveProperty("lifecycle");
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let M: any;

beforeAll(async () => {
  // @ts-expect-error The dependency-free browser client has no declaration file.
  await import("../src/web/app.js");
  M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
});

const G = globalThis as unknown as { document?: unknown; CSS?: { escape: (s: string) => string } };

function clientSnap(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-16T16:39:00.000Z",
    programs: [],
    totals: { live: 0, tracked: 0, attention: 1 },
    controlHealth: { cmuxReachable: true, lastCheckedAt: "2026-08-16T16:39:00.000Z", errors: [], staleSources: [] },
    issues: [],
    ...overrides,
  };
}

function boundAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: "claude:cooper",
    provider: "claude",
    sourceSessionId: "cooper",
    displayName: "cooper-scheduler Claude",
    programId: "p1",
    status: "waiting",
    statusReason: "Waiting.",
    activity: "idle",
    lifecycle: "waiting",
    scope: "observed",
    outcome: "needs-you",
    attention: true,
    attentionSignal: { kind: "input-requested", evidence: "Waiting for your next prompt" },
    updatedAt: "2026-08-16T12:20:00.000Z",
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    controls: [],
    target: {
      resolution: "exact",
      attestation: "live",
      workspaceId: BOUND_WORKSPACE,
      workspaceTitle: "cooper-scheduler",
      surfaceId: BOUND_SURFACE,
    },
    ...overrides,
  };
}

describe("attention feed: bound vs unbound Waiting", () => {
  test("an unbound Waiting item is blocking attention labeled no session bound", () => {
    const snap = clientSnap({
      unboundWaiting: [{
        notificationId: UNBOUND_NOTICE,
        workspaceId: UNBOUND_WORKSPACE,
        workspaceTitle: "draft-unbound",
        surfaceId: UNBOUND_SURFACE,
        title: "Claude Code",
        subtitle: "Waiting",
        body: "Waiting for your next prompt",
        createdAt: "2026-08-16T12:18:35.000Z",
      }],
    });
    const items = M.notificationFeed(snap, [], Date.parse(NOW.toISOString()), M.NOTIFY_DEPS);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("handoff");
    expect(items[0].severity).toBe("blocking");
    expect(items[0].id).toBe(`cmux-unbound:${UNBOUND_NOTICE}`);
    expect(items[0].source.agentId).toBeUndefined();
    expect(items[0].impact.toLowerCase()).toContain("no session bound");
    expect(items[0].impact).toContain("draft-unbound");
    expect(items[0].evidence.toLowerCase()).toContain("no session bound");
    expect(items[0].route).toEqual({ kind: "unbound-waiting", id: UNBOUND_NOTICE });
    expect(items[0].since).toBeNull();
    expect(M.DRAWER_KINDS).toContain("unbound-waiting");
    expect(M.hasCurrentImpact(items[0], snap)).toBe(true);
    expect(M.feedTone(items)).toBe("blocked");
    expect(M.blockingCount(items)).toBe(1);
    const model = M.notificationPanelModel(snap, [], Date.parse(NOW.toISOString()), M.NOTIFY_DEPS);
    expect(model.lede.toLowerCase()).not.toContain("agent");
    expect(model.count).toBe(1);
  });

  test("a bound Waiting toast still maps to its session and is not also unbound", () => {
    const snap = clientSnap({
      programs: [{ id: "p1", name: "cooper-scheduler", agents: [boundAgent()] }],
      cmuxNotifications: [waitingNotice({
        id: BOUND_NOTICE,
        workspaceId: BOUND_WORKSPACE,
        surfaceId: BOUND_SURFACE,
      })],
      unboundWaiting: [],
      totals: { live: 1, tracked: 1, attention: 1 },
    });
    const items = M.notificationFeed(snap, [], Date.parse(NOW.toISOString()), M.NOTIFY_DEPS);
    expect(items.map((item: { id: string }) => item.id)).toEqual(["agent:claude:cooper"]);
    expect(items[0].route).toEqual({ kind: "agent", id: "claude:cooper" });
    expect(items[0].source.agentId).toBe("claude:cooper");
    expect(JSON.stringify(items)).not.toContain("no session bound");
  });

  test("clearing or binding the toast removes the unbound attention item", () => {
    const item = {
      id: `cmux-unbound:${UNBOUND_NOTICE}`,
      kind: "handoff",
      severity: "blocking",
      route: { kind: "unbound-waiting", id: UNBOUND_NOTICE },
    };
    expect(M.hasCurrentImpact(item, clientSnap({
      unboundWaiting: [{ notificationId: UNBOUND_NOTICE, isRead: false }],
    }))).toBe(true);
    expect(M.hasCurrentImpact(item, clientSnap({ unboundWaiting: [] }))).toBe(false);
    expect(M.hasCurrentImpact(item, clientSnap({}))).toBe(false);
  });
});

describe("unbound Waiting UI regressions", () => {
  function renderPanel(snap: Record<string, unknown>) {
    const doc = fakeDocument();
    const panel = makeNode("div");
    panel.id = "notifications-panel";
    const toggle = makeNode("button");
    toggle.id = "notify-toggle";
    doc.register("notifications-panel", panel);
    doc.register("notify-toggle", toggle);
    const realDoc = G.document;
    const realCss = G.CSS;
    G.document = doc;
    G.CSS = realCss ?? { escape: (s: string) => s };
    const saved = {
      snap: M.state.snap,
      notifyPanelOpen: M.state.notifyPanelOpen,
      paintSig: M.state.paintSig,
    };
    M.state.snap = snap;
    M.state.notifyPanelOpen = true;
    M.state.paintSig = {};
    try {
      M.renderNotificationCenter();
      return { doc, panel, text: textOf(panel) };
    } finally {
      Object.assign(M.state, saved);
      if (realDoc === undefined) delete G.document; else G.document = realDoc;
      if (realCss === undefined) delete G.CSS; else G.CSS = realCss;
    }
  }

  test("the panel paints workspace title + no session bound and offers no session write", () => {
    const { panel, text } = renderPanel(clientSnap({
      unboundWaiting: [{
        notificationId: UNBOUND_NOTICE,
        workspaceId: UNBOUND_WORKSPACE,
        workspaceTitle: "draft-unbound",
        surfaceId: UNBOUND_SURFACE,
        title: "Claude Code",
        subtitle: "Waiting",
        body: "Waiting for your next prompt",
        createdAt: "2026-08-16T12:18:35.000Z",
      }],
    }));
    expect(text).toContain("draft-unbound");
    expect(text.toLowerCase()).toContain("no session bound");
    expect(text).not.toMatch(/Focus|Reply in inspector|Send/);
    type DomNode = {
      classList?: { contains?: (c: string) => boolean };
      children?: DomNode[];
      attributes?: Record<string, string>;
    };
    const open = (function walk(node: DomNode): DomNode[] {
      const here = node.classList?.contains?.("notify-row-open") ? [node] : [];
      return here.concat((node.children ?? []).flatMap(walk));
    })(panel as DomNode)[0];
    const label = String(open?.attributes?.["aria-label"] ?? "");
    expect(label.toLowerCase()).toContain("no session bound");
    expect(label.toLowerCase()).not.toContain("opens the session");
  });

  test("a bound Waiting row still opens its session and never reads no session bound", () => {
    const { text } = renderPanel(clientSnap({
      programs: [{ id: "p1", name: "cooper-scheduler", agents: [boundAgent()] }],
      totals: { live: 1, tracked: 1, attention: 1 },
    }));
    expect(text.toLowerCase()).not.toContain("no session bound");
    expect(text).toContain("Reply in inspector");
    expect(text).toContain("cooper-scheduler");
  });
});
