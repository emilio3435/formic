import type { AgentAck, AgentSnapshot, CmuxNotificationSummary } from "../shared/types";
import { alertFingerprintFor, type AckStore } from "./ack";
import type { ActionResult } from "./cmux-actions";
import { canWriteToTarget } from "./targets";
import { hookInputWantsHuman } from "./task-state";

export interface CmuxClearWarning {
  code: string;
  detail: string;
  notificationId: string;
}

export function attestedSurfaceId(agent: AgentSnapshot): string | undefined {
  const target = agent.target;
  if (target.kind === "grok-bot") return undefined;
  if (!canWriteToTarget(target) || !target.surfaceId) return undefined;
  return target.surfaceId;
}

export function unreadNotificationsForAgent(
  agent: AgentSnapshot,
  notifications: readonly CmuxNotificationSummary[],
): CmuxNotificationSummary[] {
  const surfaceId = attestedSurfaceId(agent);
  if (!surfaceId) return [];
  return notifications.filter((note) => note.surfaceId === surfaceId && note.isRead !== true);
}

export async function ackAgentAndClearCmux(input: {
  agent: AgentSnapshot;
  ackStore: Pick<AckStore, "put">;
  notifications: readonly CmuxNotificationSummary[];
  markRead: (id: string) => Promise<ActionResult>;
}): Promise<{ ack: AgentAck; cmuxWarnings: CmuxClearWarning[] }> {
  const fingerprint = alertFingerprintFor(input.agent);
  if (!fingerprint) {
    const error = new Error("Only an agent with a current alert can be acknowledged.");
    Object.assign(error, { code: "AGENT_NOT_ALERTING" });
    throw error;
  }
  const ack = await input.ackStore.put(input.agent.id, fingerprint);
  const cmuxWarnings: CmuxClearWarning[] = [];
  for (const note of unreadNotificationsForAgent(input.agent, input.notifications)) {
    const result = await input.markRead(note.id);
    if (result.ok === true) continue;
    cmuxWarnings.push({
      code: result.code ?? "cmux_failed",
      detail: result.detail ?? "cmux mark_read failed",
      notificationId: note.id,
    });
  }
  return { ack, cmuxWarnings };
}

export async function clearCmuxAndMaybeAck(input: {
  notificationId: string;
  action: "mark_read" | "dismiss";
  agents: readonly AgentSnapshot[];
  notifications: readonly CmuxNotificationSummary[];
  ackStore: Pick<AckStore, "put">;
  applyCmux: (action: "mark_read" | "dismiss", id: string) => Promise<ActionResult>;
}): Promise<ActionResult & { ack?: AgentAck }> {
  const cmux = await input.applyCmux(input.action, input.notificationId);
  if (cmux.ok !== true) return cmux;
  const note = input.notifications.find((candidate) => candidate.id === input.notificationId);
  if (!note) return { ok: true };
  const owner = input.agents.find((candidate) => attestedSurfaceId(candidate) === note.surfaceId);
  if (!owner) return { ok: true };
  if (hookInputWantsHuman(owner)) return { ok: true };
  const fingerprint = alertFingerprintFor(owner);
  if (!fingerprint) return { ok: true };
  const ack = await input.ackStore.put(owner.id, fingerprint);
  return { ok: true, ack };
}
