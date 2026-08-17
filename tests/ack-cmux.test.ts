import { describe, expect, test } from "bun:test";
import { MemoryAckStore } from "../src/server/ack";
import {
  ackAgentAndClearCmux,
  attestedSurfaceId,
  clearCmuxAndMaybeAck,
  unreadNotificationsForAgent,
} from "../src/server/ack-cmux";
import type { ActionResult } from "../src/server/cmux-actions";
import { hookInputWantsHuman } from "../src/server/task-state";
import type { AgentSnapshot, CmuxNotificationSummary } from "../src/shared/types";

function agent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: "codex:funnel",
    provider: "codex",
    sourceSessionId: "funnel",
    displayName: "Funnel",
    programId: "fixture",
    status: "waiting",
    statusReason: "Waiting.",
    activity: "idle",
    lifecycle: "waiting",
    scope: "observed",
    processState: "unknown",
    outcome: "healthy",
    attention: true,
    updatedAt: "2026-08-17T12:00:00.000Z",
    lastHumanMessage: null,
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    target: {
      kind: "cmux",
      resolution: "exact",
      surfaceId: "SURFACE-1",
      attestation: "live",
    },
    controls: [],
    ...overrides,
  };
}

const notice = (overrides: Partial<CmuxNotificationSummary> = {}): CmuxNotificationSummary => ({
  id: "NOTICE-1",
  workspaceId: "WS-1",
  surfaceId: "SURFACE-1",
  title: "Completed",
  subtitle: "",
  body: "PR merged.",
  isRead: false,
  createdAt: "2026-08-17T12:00:00.000Z",
  ...overrides,
});

describe("C2 attested surface", () => {
  test("exact live surface is attested; remembered and grok-bot are not", () => {
    expect(attestedSurfaceId(agent())).toBe("SURFACE-1");
    expect(attestedSurfaceId(agent({
      target: { kind: "cmux", resolution: "exact", surfaceId: "SURFACE-1", attestation: "remembered" },
    }))).toBeUndefined();
    expect(attestedSurfaceId(agent({
      target: { kind: "grok-bot", resolution: "exact", agentId: "bot", instanceId: "i", gatewayReady: true },
    }))).toBeUndefined();
  });
});

describe("C3 unreadNotificationsForAgent", () => {
  test("only unread notices on the attested surface", () => {
    const notes = [
      notice(),
      notice({ id: "NOTICE-2", isRead: true }),
      notice({ id: "NOTICE-3", surfaceId: "OTHER" }),
    ];
    expect(unreadNotificationsForAgent(agent(), notes).map((n) => n.id)).toEqual(["NOTICE-1"]);
    expect(unreadNotificationsForAgent(agent({
      target: { kind: "cmux", resolution: "unique-cwd", surfaceId: "SURFACE-1" },
    }), notes)).toEqual([]);
  });
});

describe("C4 ackAgentAndClearCmux", () => {
  test("writes the ack first, then marks each unread notice read", async () => {
    const ackStore = new MemoryAckStore(() => Date.parse("2026-08-17T12:01:00.000Z"));
    const calls: string[] = [];
    const markRead = async (id: string): Promise<ActionResult> => {
      expect(ackStore.list()).toHaveLength(1);
      calls.push(id);
      return { ok: true };
    };
    const result = await ackAgentAndClearCmux({
      agent: agent({
        attentionSignal: { kind: "input-requested", evidence: "PR merged." },
      }),
      ackStore,
      notifications: [notice(), notice({ id: "NOTICE-2" })],
      markRead,
    });
    expect(result.ack.agentId).toBe("codex:funnel");
    expect(result.ack.alertFingerprint).toMatch(/^signal:input-requested:/);
    expect(result.cmuxWarnings).toEqual([]);
    expect(calls).toEqual(["NOTICE-1", "NOTICE-2"]);
  });

  test("a cmux refusal becomes a warning and leaves the ack in place", async () => {
    const ackStore = new MemoryAckStore(() => Date.parse("2026-08-17T12:01:00.000Z"));
    const result = await ackAgentAndClearCmux({
      agent: agent(),
      ackStore,
      notifications: [notice()],
      markRead: async () => ({ ok: false, code: "invalid_state", detail: "already gone" }),
    });
    expect(ackStore.list()).toHaveLength(1);
    expect(result.cmuxWarnings).toEqual([{
      code: "invalid_state",
      detail: "already gone",
      notificationId: "NOTICE-1",
    }]);
  });

  test("no attested surface acks Formic and does not call markRead", async () => {
    const ackStore = new MemoryAckStore(() => Date.parse("2026-08-17T12:01:00.000Z"));
    let called = 0;
    const result = await ackAgentAndClearCmux({
      agent: agent({ target: { resolution: "missing" } }),
      ackStore,
      notifications: [notice()],
      markRead: async () => {
        called += 1;
        return { ok: true };
      },
    });
    expect(ackStore.list()).toHaveLength(1);
    expect(called).toBe(0);
    expect(result.cmuxWarnings).toEqual([]);
  });
});

describe("C5 clearCmuxAndMaybeAck", () => {
  test("toast-only owner is Formic-acked after a successful mark_read", async () => {
    const ackStore = new MemoryAckStore(() => Date.parse("2026-08-17T12:01:00.000Z"));
    const toastOwner = agent({
      attentionSignal: { kind: "input-requested", evidence: "PR merged." },
    });
    const result = await clearCmuxAndMaybeAck({
      notificationId: "NOTICE-1",
      action: "mark_read",
      agents: [toastOwner],
      notifications: [notice()],
      ackStore,
      applyCmux: async () => ({ ok: true }),
    });
    expect(result.ok).toBe(true);
    expect(result.ack?.agentId).toBe("codex:funnel");
    expect(ackStore.list()).toHaveLength(1);
  });

  test("a live hook ask is left unacked", async () => {
    const ackStore = new MemoryAckStore(() => Date.parse("2026-08-17T12:01:00.000Z"));
    const asking = agent({ hookLifecycle: "needsInput", attention: true });
    expect(hookInputWantsHuman(asking)).toBe(true);
    const result = await clearCmuxAndMaybeAck({
      notificationId: "NOTICE-1",
      action: "dismiss",
      agents: [asking],
      notifications: [notice()],
      ackStore,
      applyCmux: async () => ({ ok: true }),
    });
    expect(result.ok).toBe(true);
    expect(result.ack).toBeUndefined();
    expect(ackStore.list()).toEqual([]);
  });

  test("a cmux refusal writes no Formic ack", async () => {
    const ackStore = new MemoryAckStore(() => Date.parse("2026-08-17T12:01:00.000Z"));
    const result = await clearCmuxAndMaybeAck({
      notificationId: "NOTICE-1",
      action: "mark_read",
      agents: [agent()],
      notifications: [notice()],
      ackStore,
      applyCmux: async () => ({ ok: false, code: "timeout", detail: "cmux timed out" }),
    });
    expect(result).toEqual({ ok: false, code: "timeout", detail: "cmux timed out" });
    expect(ackStore.list()).toEqual([]);
  });
});
