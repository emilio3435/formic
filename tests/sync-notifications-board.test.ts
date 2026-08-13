/**
 * SYNC-NF — cmux notification badges, the clear verbs, and the board-local Ack.
 *
 * Three claims, and each one is a claim the product can get WRONG in a way that
 * lies to the operator:
 *
 *   1. A badge is a count of unread TERMINAL notifications. Clearing it must not
 *      move the row out of Needs-you, because the notification and the agent's
 *      own request for a human are two different facts (locked decision 3). The
 *      first test asserts BOTH states off one fixture: a test that only checked
 *      the badge would pass while the row silently vanished.
 *   2. Ack is an OPERATOR judgment, not agent state (ground rule #9). It hides a
 *      row from the alert list; it never says the agent finished, and it never
 *      writes to cmux. The mark on the row therefore has to read as the
 *      operator's word and never as a status color.
 *   3. The client renders SNAPSHOT TRUTH. A server-side self-revoke (a fresh
 *      alert fingerprint) has to bring the row back with no client-side ack
 *      bookkeeping at all — so these tests never let the client remember an ack.
 *
 * The wire is driven for real: every request assertion reads the URL, the method
 * and the parsed body of a fake `fetch`, so a wrong param key (`notification_id`
 * for `id` — the trap that ate a TINT lane with exit code 0) fails here rather
 * than doing nothing in production. Fixtures are the FROZEN envelope shapes from
 * 00-MASTER-PLAN.md §Contract, not a convenient subset.
 *
 * DOM claims go through the shared fake document (tests/helpers/fake-dom.ts):
 * this client has no jsdom by policy. Source-text assertions name the live fact
 * they stand in for.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeDocument, makeNode, textOf, withDom } from "./helpers/fake-dom";
import type { AgentAck, CmuxNotificationSummary } from "../src/shared/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let M: any;
let styles = "";

beforeAll(async () => {
  // @ts-expect-error The dependency-free browser client has no declaration file.
  await import("../src/web/app.js");
  M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
  styles = readFileSync(join(import.meta.dir, "../src/web/styles.css"), "utf8");
});

/* ---------- fixtures ---------- */

const WORKSPACE = "WORKSPACE-NF";
const OTHER_WORKSPACE = "WORKSPACE-OTHER";

function agent(overrides: Record<string, unknown> = {}) {
  return {
    id: "codex:nf-1",
    provider: "codex",
    sourceSessionId: "nf-1",
    displayName: "Ridge lane",
    programId: "p1",
    status: "waiting",
    statusReason: "Waiting on a person.",
    activity: "idle",
    lifecycle: "waiting",
    scope: "observed",
    outcome: "needs-you",
    controlState: "linked",
    attentionSignal: { kind: "input-requested", evidence: "Which branch should I cut from?" },
    updatedAt: "2026-08-13T04:00:00.000Z",
    tokens: { provenance: "observed", total: 40_000, contextWindow: 1_000_000 },
    lastHumanMessage: "Which branch should I cut from?",
    artifacts: [],
    gates: [],
    controls: [],
    target: { resolution: "exact", attestation: "live", workspaceId: WORKSPACE, surfaceId: "SURFACE-NF" },
    ...overrides,
  };
}

/** A calm session: healthy outcome, working — alerting() is false for it. */
const calm = (overrides: Record<string, unknown> = {}) => agent({
  id: "codex:nf-calm",
  sourceSessionId: "nf-calm",
  displayName: "Quiet lane",
  status: "running",
  activity: "working",
  lifecycle: "working",
  outcome: "healthy",
  attentionSignal: undefined,
  ...overrides,
});

/** The frozen CmuxNotificationSummary shape — every key, exactly as NB emits it. */
function notification(overrides: Partial<CmuxNotificationSummary> = {}): CmuxNotificationSummary {
  return {
    id: "notif-1",
    workspaceId: WORKSPACE,
    surfaceId: "SURFACE-NF",
    title: "Codex",
    subtitle: "Permission requested",
    body: "Allow writing to src/web/app.js?",
    isRead: false,
    createdAt: "2026-08-13T03:58:00.000Z",
    ...overrides,
  };
}

/** The frozen AgentAck shape. */
function ack(agentId: string, overrides: Partial<AgentAck> = {}): AgentAck {
  return {
    agentId,
    ackedAt: "2026-08-13T04:01:00.000Z",
    alertFingerprint: "waiting|2026-08-13T04:00:00.000Z",
    ...overrides,
  };
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-13T04:02:00.000Z",
    programs: [],
    totals: { live: 1, tracked: 1, attention: 0 },
    controlHealth: { cmuxReachable: true, lastCheckedAt: "2026-08-13T04:02:00.000Z", errors: [], staleSources: [] },
    issues: [],
    ...overrides,
  };
}

const oneProgram = (agents: unknown[], rest: Record<string, unknown> = {}) =>
  snapshot({ programs: [{ id: "p1", name: "Ridge", agents }], ...rest });

/* ---------- harness ---------- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findAll(node: any, pred: (n: any) => boolean, out: any[] = []): any[] {
  if (!node || typeof node !== "object") return out;
  if (pred(node)) out.push(node);
  for (const kid of node.children || []) findAll(kid, pred, out);
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const byClass = (root: any, cls: string) => findAll(root, (n) => n.classList?.contains?.(cls));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const buttons = (root: any) => findAll(root, (n) => n.tagName === "button");

/* WCAG 2.5.3, Label in Name, in its strong form.
 *
 * The weak form — `label.startsWith(visible)` — is worse than nothing here, and
 * measured so: an accessible name of "Acknowledge Ridge lane…" passes a
 * startsWith("Ack") check while failing the word match a speech engine does, so
 * the assertion would have shipped green over the exact defect it names. The
 * visible text has to be a whole leading WORD of the accessible name.
 */
function leadsWithVisibleText(label: string, visible: string): boolean {
  if (!visible || !label.startsWith(visible)) return false;
  const rest = label.slice(visible.length);
  return rest === "" || !/^[\w-]/.test(rest);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function click(node: any) {
  if (!node) throw new Error("click: missing node");
  for (const fn of node.listeners?.click || []) fn({ preventDefault() {}, stopPropagation() {}, target: node, currentTarget: node });
}

interface FakeCall { url: string; method: string; body: unknown }
interface FakeReply { status?: number; json?: unknown }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const G = globalThis as any;

/** Real request path, fake socket: url/method/body are recorded verbatim. */
async function withRequests<T>(replies: FakeReply[], fn: (calls: FakeCall[]) => Promise<T> | T): Promise<T> {
  const calls: FakeCall[] = [];
  const realFetch = G.fetch;
  const realDoc = G.document;
  const realCss = G.CSS;
  const doc = fakeDocument();
  doc.body = makeNode("body");
  G.document = doc;
  G.CSS = realCss ?? { escape: (s: string) => s };
  let index = 0;
  G.fetch = async (url: string, init: Record<string, unknown> = {}) => {
    const reply = replies[Math.min(index, replies.length - 1)] ?? { status: 200, json: { ok: true } };
    index += 1;
    calls.push({
      url: String(url),
      method: String(init.method || "GET").toUpperCase(),
      body: typeof init.body === "string" ? JSON.parse(init.body) : null,
    });
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
  try {
    return await fn(calls);
  } finally {
    G.fetch = realFetch;
    if (realDoc === undefined) delete G.document; else G.document = realDoc;
    if (realCss === undefined) delete G.CSS; else G.CSS = realCss;
  }
}

async function withState<T>(patch: Record<string, unknown>, fn: () => Promise<T> | T): Promise<T> {
  const full = { paintSig: { programs: "", inspector: "", widgets: "", alarm: null, actions: null }, ...patch };
  const keys = Object.keys(full);
  const saved = Object.fromEntries(keys.map((key) => [key, M.state[key]]));
  Object.assign(M.state, full);
  try {
    return await fn();
  } finally {
    Object.assign(M.state, saved);
  }
}

/** A fake document plus a patched `state`, restored on the way out. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withDocState<T>(patch: Record<string, unknown>, fn: (doc: any) => T): T {
  const doc = fakeDocument();
  doc.body = makeNode("body");
  const realDoc = G.document;
  const realCss = G.CSS;
  G.document = doc;
  G.CSS = realCss ?? { escape: (s: string) => s };
  const keys = Object.keys(patch);
  const saved = Object.fromEntries(keys.map((key) => [key, M.state[key]]));
  Object.assign(M.state, patch);
  try {
    return fn(doc);
  } finally {
    Object.assign(M.state, saved);
    if (realDoc === undefined) delete G.document; else G.document = realDoc;
    if (realCss === undefined) delete G.CSS; else G.CSS = realCss;
  }
}

/** Render one row against a snapshot the client has actually adopted. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowFor(a: Record<string, unknown>, snap: Record<string, unknown>, opts: Record<string, unknown> = {}): any {
  const saved = M.state.snap;
  M.state.snap = snap;
  try {
    const program = (snap.programs as Array<{ id: string; name: string; agents: unknown[] }>)[0];
    return withDom(() => M.renderAgentRow(a, program, opts));
  } finally {
    M.state.snap = saved;
  }
}

/* ---------- Task 1: badges + clear verbs ---------- */

describe("SYNC-NF · cmux notification badges", () => {
  test("a row whose workspace has unread notifications carries a quiet count badge", () => {
    const waiting = agent();
    const snap = oneProgram([waiting], {
      cmuxNotifications: [
        notification({ id: "n-1" }),
        notification({ id: "n-2", title: "Codex", subtitle: "Question" }),
        // Read: cleared already, so it is not part of the count.
        notification({ id: "n-3", isRead: true }),
        // Another workspace's notification must never reach this row.
        notification({ id: "n-4", workspaceId: OTHER_WORKSPACE, surfaceId: "SURFACE-OTHER" }),
      ],
    });

    const badge = byClass(rowFor(waiting, snap), "cmux-badge")[0];
    expect(badge).toBeDefined();
    expect(textOf(badge)).toBe("2");
    /* Quiet ink, and the assertion is on the STYLESHEET rather than on a class
       name: "muted, not a status color" is a claim about what the operator sees,
       and a class called `cmux-badge` painted with --needs would satisfy a
       name-only test while shipping the exact defect. Status colors stay
       reserved for status. */
    const rule = styles.match(/\.cmux-badge\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("var(--muted)");
    for (const statusToken of ["--needs", "--ember", "--moss", "--amber", "--blocked", "--failed"]) {
      expect(rule).not.toContain(statusToken);
    }

    // It says what it counts. "2" alone is a number with no noun on it.
    const label = String(badge.attributes["aria-label"] || "");
    expect(label).toContain("2");
    expect(label.toLowerCase()).toContain("unread");
    expect(label.toLowerCase()).toContain("terminal");
  });

  test("a row with no unread notification draws no badge at all", () => {
    const waiting = agent();
    const empty = oneProgram([waiting], { cmuxNotifications: [] });
    expect(byClass(rowFor(waiting, empty), "cmux-badge")).toHaveLength(0);

    // …and a snapshot from a server that does not publish the field yet is the
    // same silence, not a crash and not a zero.
    expect(byClass(rowFor(waiting, oneProgram([waiting])), "cmux-badge")).toHaveLength(0);
  });

  test("mark_read and dismiss reach /api/sync/notifications with the exact frozen params", async () => {
    const waiting = agent();
    const snap = oneProgram([waiting], { cmuxNotifications: [notification({ id: "n-1" })] });

    for (const action of ["mark_read", "dismiss"] as const) {
      await withState({ snap, conn: "live" }, async () => {
        await withRequests([{ status: 200, json: { ok: true } }, { status: 200, json: snap }], async (calls) => {
          await M.clearCmuxNotification("n-1", action);
          expect(calls[0]!.url, action).toBe("/api/sync/notifications");
          expect(calls[0]!.method, action).toBe("POST");
          /* The param vocabulary, PINNED. cmux's key is `id`; `notification_id`
             is accepted by the CLI with exit 0 and does nothing. Object.keys is
             asserted so an extra field — `all`, `all_read`, `tab_id` — cannot
             ride along unnoticed: sync code may never emit those. */
          expect(calls[0]!.body, action).toEqual({ action, id: "n-1" });
          expect(Object.keys(calls[0]!.body as object).sort(), action).toEqual(["action", "id"]);
          // The snapshot is re-read, which is what makes the badge visibly drop.
          expect(calls[1]!.url, action).toBe("/api/snapshot");
        });
      });
    }
  });

  test("a refused clear is reported as a refusal, never as success", async () => {
    const waiting = agent();
    const snap = oneProgram([waiting], { cmuxNotifications: [notification({ id: "n-1" })] });
    await withState({ snap, conn: "live" }, async () => {
      // Ground rules #2: HTTP completion is not evidence. A 200 whose envelope
      // says ok:false is a refusal, and the client must not re-read the snapshot
      // as though something had changed.
      await withRequests([{ status: 200, json: { ok: false, code: "invalid_state", detail: "already dismissed" } }], async (calls) => {
        const result = await M.clearCmuxNotification("n-1", "dismiss");
        expect(result.ok).toBe(false);
        expect(result.code).toBe("invalid_state");
        expect(calls).toHaveLength(1);
      });
      // A 200 carrying nothing readable is also a failure, not an assumed win.
      await withRequests([{ status: 200, json: {} }], async () => {
        expect((await M.clearCmuxNotification("n-1", "mark_read")).ok).toBe(false);
      });
    });
  });

  test("LOCKED DECISION 3 — clearing the badge does not take an alerting row out of Needs you", () => {
    /* One fixture, both states. The failure this pins is not hypothetical: the
       server used to publish an unread notification by overwriting `status`, so
       "clear the notification" and "the agent stopped asking" were one field.
       They are two facts, and the agent below is still asking after the clear. */
    const waiting = agent();
    const withUnread = oneProgram([waiting], { cmuxNotifications: [notification({ id: "n-1" })] });
    const cleared = oneProgram([waiting], { cmuxNotifications: [notification({ id: "n-1", isRead: true })] });

    const visible = [{ program: withUnread.programs[0], agents: [waiting] }];

    // Before: badge on the row, row in the strip.
    expect(byClass(rowFor(waiting, withUnread), "cmux-badge")).toHaveLength(1);
    expect(M.needsYouStrip(visible, { ...M.state, snap: withUnread }).map((r: { agent: { id: string } }) => r.agent.id))
      .toEqual([waiting.id]);

    // After: badge gone, row STILL in the strip. The agent never answered.
    expect(byClass(rowFor(waiting, cleared), "cmux-badge")).toHaveLength(0);
    expect(M.needsYouStrip(visible, { ...M.state, snap: cleared }).map((r: { agent: { id: string } }) => r.agent.id))
      .toEqual([waiting.id]);
  });
});

/* ---------- Task 2: Ack ---------- */

describe("SYNC-NF · Ack", () => {
  test("an alerting row offers Ack, and its label says what Ack does NOT do", () => {
    const waiting = agent();
    const snap = oneProgram([waiting]);
    const button = buttons(rowFor(waiting, snap)).find((b) => String(b.dataset.fkey || "").startsWith("sync-ack:"));
    expect(button).toBeDefined();
    expect(textOf(button)).toBe("Ack");

    const label = String(button.attributes["aria-label"] || "");
    /* The whole point of the wording. An operator (and a screen reader) must not
       be able to read this as "the agent is done" — the agent may still be
       sitting at a prompt. The label states the effect and the non-effect. */
    expect(label).toContain("Acknowledge");
    expect(label).toContain("removes from alerts");
    expect(label).toContain("may still be waiting");
    // Keyboard-reachable by construction: a real button, not a div with a click.
    expect(button.attributes.type).toBe("button");
    // Label in Name, whole-word (see leadsWithVisibleText for why startsWith lies).
    expect(leadsWithVisibleText(label, textOf(button))).toBe(true);
  });

  test("a session nobody is waiting on is offered no Ack", () => {
    const quiet = calm();
    const snap = oneProgram([quiet]);
    expect(buttons(rowFor(quiet, snap)).filter((b) => String(b.dataset.fkey || "").startsWith("sync-ack:")))
      .toHaveLength(0);
  });

  test("Ack PUTs the ack route and the acked agent then leaves the strip while its row stays", async () => {
    const waiting = agent();
    const before = oneProgram([waiting]);
    const after = oneProgram([waiting], { acks: [ack(waiting.id)] });

    await withState({ snap: before, conn: "live" }, async () => {
      await withRequests([{ status: 200, json: { ok: true } }, { status: 200, json: after }], async (calls) => {
        await M.applySyncAck(waiting, true);
        expect(calls[0]!.method).toBe("PUT");
        expect(calls[0]!.url).toBe("/api/sync/ack/" + encodeURIComponent(waiting.id));
        expect(calls[1]!.url).toBe("/api/snapshot");
      });
    });

    const visible = [{ program: after.programs[0], agents: [waiting] }];
    // Out of the alert list…
    expect(M.needsYouStrip(visible, { ...M.state, snap: after })).toEqual([]);
    // …and NOT out of the board: an acked row is drawn in its program group, or
    // acking would delete a live session from the operator's view.
    const plan = M.agentRowPlan(after.programs[0], [waiting], { ...M.state, snap: after, view: "board" });
    expect(plan.map((item: { key: string }) => item.key)).toContain("row:" + waiting.id);
  });

  test("the acked row says the OPERATOR judged it, in muted ink, and offers the undo", () => {
    const waiting = agent();
    const acked = oneProgram([waiting], { acks: [ack(waiting.id)] });
    const row = rowFor(waiting, acked);

    const mark = byClass(row, "acked-mark")[0];
    expect(mark).toBeDefined();
    expect(textOf(mark)).toContain("acked");
    /* Never a claim about the agent. "done", "finished", "resolved", "cleared"
       would each state that the SESSION completed something; what happened is
       that a person decided not to be interrupted by it. */
    const spoken = (textOf(mark) + " " + (mark.attributes["aria-label"] || "") + " " + (mark.attributes.title || "")).toLowerCase();
    expect(spoken).toContain("you acknowledged");
    expect(spoken).toContain("still waiting");
    for (const lie of ["finished", "done", "resolved", "completed"]) expect(spoken).not.toContain(lie);

    // Muted ink, never a status green — the mark is not a verdict on the agent.
    const rule = styles.match(/\.acked-mark\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("var(--muted)");
    for (const statusToken of ["--moss", "--ok", "--working", "--needs", "--ember"]) {
      expect(rule).not.toContain(statusToken);
    }

    // The undo is on the row, or the mark is a one-way door.
    const undo = buttons(row).find((b) => String(b.dataset.fkey || "").startsWith("sync-ack:"));
    expect(textOf(undo)).toBe("Unack");
    expect(String(undo.attributes["aria-label"])).toContain("returns");
    expect(leadsWithVisibleText(String(undo.attributes["aria-label"]), "Unack")).toBe(true);
  });

  test("Unack DELETEs the ack route", async () => {
    const waiting = agent();
    const acked = oneProgram([waiting], { acks: [ack(waiting.id)] });
    await withState({ snap: acked, conn: "live" }, async () => {
      await withRequests([{ status: 200, json: { ok: true } }, { status: 200, json: oneProgram([waiting]) }], async (calls) => {
        await M.applySyncAck(waiting, false);
        expect(calls[0]!.method).toBe("DELETE");
        expect(calls[0]!.url).toBe("/api/sync/ack/" + encodeURIComponent(waiting.id));
      });
    });
  });

  test("a refused ack leaves the board unchanged and says so", async () => {
    const quiet = calm();
    const snap = oneProgram([quiet]);
    await withState({ snap, conn: "live" }, async () => {
      // Acking a non-alerting agent is a 409 from NB. It is a refusal, and the
      // client neither re-reads the snapshot nor pretends the row moved.
      await withRequests([{ status: 409, json: { ok: false, code: "not_alerting" } }], async (calls) => {
        const result = await M.applySyncAck(quiet, true);
        expect(result.ok).toBe(false);
        expect(result.code).toBe("not_alerting");
        expect(calls).toHaveLength(1);
      });
    });
  });

  test("a server-side self-revoke returns the row to the strip with no client bookkeeping", () => {
    /* The client tracks NO acks of its own. The only reason the row was hidden
       was `snapshot.acks`, so when NB drops the ack (a fresh alert fingerprint),
       the very next snapshot puts the row back — no expiry timer here, no
       special case, nothing to get stuck. */
    const waiting = agent();
    const acked = oneProgram([waiting], { acks: [ack(waiting.id)] });
    const revoked = oneProgram([waiting], { acks: [] });
    const visible = (snap: Record<string, unknown>) => [
      { program: (snap.programs as Array<{ agents: unknown[] }>)[0], agents: [waiting] },
    ];

    expect(M.needsYouStrip(visible(acked), { ...M.state, snap: acked })).toEqual([]);
    expect(M.needsYouStrip(visible(revoked), { ...M.state, snap: revoked })
      .map((r: { agent: { id: string } }) => r.agent.id)).toEqual([waiting.id]);

    // And the mark goes with it: the row stops claiming a judgment that expired.
    expect(byClass(rowFor(waiting, revoked), "acked-mark")).toHaveLength(0);
  });

  test("an ack for another agent never hides this one", () => {
    const waiting = agent();
    const second = agent({ id: "codex:nf-2", sourceSessionId: "nf-2", displayName: "Second lane" });
    const snap = oneProgram([waiting, second], { acks: [ack(second.id)] });
    const visible = [{ program: snap.programs[0], agents: [waiting, second] }];
    expect(M.needsYouStrip(visible, { ...M.state, snap }).map((r: { agent: { id: string } }) => r.agent.id))
      .toEqual([waiting.id]);
  });

  test("the row signature carries the badge and the ack, or a changed row keeps its stale node", () => {
    /* The documented failure class in this file: state a row PAINTS that is
       absent from its signature means reconcileKeyed re-adopts the cached node
       and the change never appears. Both of this lane's row facts live on the
       snapshot rather than on the agent record, so neither is in agentRecordSig. */
    const waiting = agent();
    const bare = { ...M.state, snap: oneProgram([waiting]) };
    const badged = { ...M.state, snap: oneProgram([waiting], { cmuxNotifications: [notification({ id: "n-1" })] }) };
    const acked = { ...M.state, snap: oneProgram([waiting], { acks: [ack(waiting.id)] }) };

    expect(M.agentRowSig(waiting, badged)).not.toBe(M.agentRowSig(waiting, bare));
    expect(M.agentRowSig(waiting, acked)).not.toBe(M.agentRowSig(waiting, bare));
    expect(M.agentRowSig(waiting, acked)).not.toBe(M.agentRowSig(waiting, badged));
  });
});

/* ---------- Task 1 (dropdown) + Task 3 (a11y, announcement) ---------- */

describe("SYNC-NF · the notifications dropdown and what it announces", () => {
  test("unread terminal notifications get an entry with both clear verbs", () => {
    const waiting = agent();
    const snap = oneProgram([waiting], {
      cmuxNotifications: [notification({ id: "n-1" }), notification({ id: "n-2", isRead: true })],
    });
    const section = withDom(() => M.renderCmuxNotifySection(snap));
    expect(section).not.toBeNull();

    // Exactly the unread one. A read notification is not an item.
    const entries = byClass(section, "cmux-notify-row");
    expect(entries).toHaveLength(1);
    const text = textOf(entries[0]);
    expect(text).toContain("Codex");
    expect(text).toContain("Permission requested");

    const acts = buttons(entries[0]).map((b) => String(b.dataset.fkey));
    expect(acts).toEqual(["sync-notify:mark_read:n-1", "sync-notify:dismiss:n-1"]);
    for (const button of buttons(entries[0])) {
      expect(button.attributes.type).toBe("button");
      // Each verb names its own notification: several rows coexist here, and
      // "Mark read" alone tells a screen reader nothing about which one.
      const label = String(button.attributes["aria-label"]);
      expect(label).toContain("Codex");
      // Label in Name again — the visible verb leads the accessible name.
      expect(leadsWithVisibleText(label, textOf(button))).toBe(true);
    }
  });

  test("the dropdown section is absent when nothing is unread", () => {
    const waiting = agent();
    expect(withDom(() => M.renderCmuxNotifySection(oneProgram([waiting], { cmuxNotifications: [] })))).toBeNull();
    expect(withDom(() => M.renderCmuxNotifySection(oneProgram([waiting])))).toBeNull();
  });

  test("the panel signature carries the unread set, or a cleared notification stays on screen", () => {
    const waiting = agent();
    const model = M.notificationPanelModel(oneProgram([waiting]), [], Date.parse("2026-08-13T04:02:00.000Z"));
    const saved = M.state.snap;
    try {
      M.state.snap = oneProgram([waiting], { cmuxNotifications: [notification({ id: "n-1" })] });
      const withUnread = M.notifyPanelPaintSig(model, true);
      M.state.snap = oneProgram([waiting], { cmuxNotifications: [notification({ id: "n-1", isRead: true })] });
      expect(M.notifyPanelPaintSig(model, true)).not.toBe(withUnread);
    } finally {
      M.state.snap = saved;
    }
  });

  test("strip filtering is announced through the bar's existing live region", () => {
    /* The region has to SURVIVE the repaint to announce anything — an aria-live
       element that is destroyed and recreated says nothing — so this asserts the
       sentence lands in #bar-scope-note, the persistent region declared in
       index.html, rather than in a node the paint just built. */
    const waiting = agent();
    const acked = oneProgram([waiting], { acks: [ack(waiting.id)] });
    withDocState({ snap: acked, view: "board", fetchFailed: false }, (doc) => {
      M.renderScopeNote(1);
      const note = doc.getElementById("bar-scope-note");
      const said = textOf(note);
      expect(said).toContain("1 acknowledged");
      expect(said.toLowerCase()).toContain("still waiting");
      expect(note.hidden).toBe(false);
    });
    // The live region is declared in the markup, not built by the paint.
    expect(readFileSync(join(import.meta.dir, "../src/web/index.html"), "utf8"))
      .toContain('id="bar-scope-note"');
  });

  test("with nothing acknowledged the sentence is unchanged", () => {
    const waiting = agent();
    withDocState({ snap: oneProgram([waiting]), view: "board", fetchFailed: false }, (doc) => {
      M.renderScopeNote(1);
      // An unfiltered board with no ack says nothing at all: the tabs have
      // already answered, and a sentence that always speaks stops being read.
      const note = doc.getElementById("bar-scope-note");
      expect(note.hidden).toBe(true);
      expect(textOf(note)).toBe("");
    });
  });
});
