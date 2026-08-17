/* Bind unread cmux Waiting notifications to snapshot sessions.

   A toast is bound only when an already-resolved agent target carries the same
   surface, using the same startedAt window the snapshot overlay uses. Surface
   presence alone is not a session and must not mint an agent id or
   resolution: exact. An unmatched unread Waiting toast is attention, published
   as its own unbound item. */

import type { CmuxNotificationSummary, UnboundWaitingAttention } from "../shared/types";
import type { CmuxSurface } from "./types";

export type { UnboundWaitingAttention };

export interface NotificationBindableAgent {
  startedAt?: string;
  sourceFreshness?: string;
  scope?: string;
  target?: { surfaceId?: string };
}

export function isUnreadWaitingNotification(
  note: Pick<CmuxNotificationSummary, "subtitle" | "isRead">,
): boolean {
  return note.isRead !== true && note.subtitle.trim().toLowerCase() === "waiting";
}

export function notificationBindsToAgent(
  note: { surfaceId: string; createdAt?: string },
  agent: NotificationBindableAgent,
): boolean {
  if (!note.surfaceId || agent.target?.surfaceId !== note.surfaceId) return false;
  const startedAtMs = agent.startedAt ? Date.parse(agent.startedAt) : Number.NaN;
  if (!Number.isFinite(startedAtMs)) return true;
  if (note.createdAt === undefined) return true;
  const notificationAtMs = Date.parse(note.createdAt);
  return Number.isFinite(notificationAtMs) && notificationAtMs >= startedAtMs;
}

export function unboundWaitingNotifications(
  notes: readonly CmuxNotificationSummary[],
  agents: readonly NotificationBindableAgent[],
  surfaces: readonly Pick<CmuxSurface, "workspaceId" | "surfaceId" | "workspaceTitle">[],
): UnboundWaitingAttention[] {
  const observed = agents.filter(
    (agent) => agent.sourceFreshness !== "last-known" && agent.scope !== "retained",
  );
  const titleByWorkspace = new Map<string, string>();
  const titleBySurface = new Map<string, string>();
  for (const surface of surfaces) {
    const title = surface.workspaceTitle?.trim();
    if (!title) continue;
    if (surface.workspaceId) titleByWorkspace.set(surface.workspaceId, title);
    titleBySurface.set(surface.surfaceId, title);
  }
  return notes.flatMap((note) => {
    if (!note.id || !isUnreadWaitingNotification(note)) return [];
    if (observed.some((agent) => notificationBindsToAgent(note, agent))) return [];
    const workspaceTitle = titleByWorkspace.get(note.workspaceId)
      ?? titleBySurface.get(note.surfaceId);
    return [{
      notificationId: note.id,
      workspaceId: note.workspaceId,
      ...(workspaceTitle ? { workspaceTitle } : {}),
      surfaceId: note.surfaceId,
      title: note.title,
      subtitle: note.subtitle,
      body: note.body,
      createdAt: note.createdAt,
    }];
  });
}
