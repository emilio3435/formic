/* A cmux "Completed in …" toast plus an idle hook plus a spoken Done. close
   is finished WORK. The process may still be sitting at its prompt. */

export function isCompletedNotification(note: {
  title?: string;
  subtitle?: string;
  body?: string;
}): boolean {
  const text = [note.title, note.subtitle, note.body]
    .filter((part): part is string => typeof part === "string")
    .join("\n");
  return /\bCompleted in\s+\S/.test(text);
}

export function isSpokenDone(closing: string | null | undefined): boolean {
  if (typeof closing !== "string") return false;
  return /^done\.?$/i.test(closing.trim());
}

export interface CompletedCloseEvidence {
  completedCloseAt?: string;
  hookLifecycle?: string;
  lastAgentClosing?: string | null;
  lastUserFacingAt?: string;
}

export function completedCloseStillHolds(agent: CompletedCloseEvidence): boolean {
  if (!agent.completedCloseAt) return false;
  if (agent.hookLifecycle !== "idle") return false;
  if (!isSpokenDone(agent.lastAgentClosing)) return false;
  const closeAt = Date.parse(agent.completedCloseAt);
  const userAt = Date.parse(agent.lastUserFacingAt ?? "");
  return !(Number.isFinite(closeAt) && Number.isFinite(userAt) && userAt > closeAt);
}

export function completedCloseAtFor(
  surfaceId: string | undefined,
  startedAt: string | undefined,
  notes: readonly Array<{
    surfaceId?: string;
    createdAt?: string;
    title?: string;
    subtitle?: string;
    body?: string;
  }>,
): string | undefined {
  if (!surfaceId) return undefined;
  const startedAtMs = startedAt ? Date.parse(startedAt) : Number.NaN;
  const newest = notes
    .filter((note) => {
      if (note.surfaceId !== surfaceId || !isCompletedNotification(note)) return false;
      if (!Number.isFinite(startedAtMs) || !note.createdAt) return true;
      const createdAtMs = Date.parse(note.createdAt);
      return Number.isFinite(createdAtMs) && createdAtMs >= startedAtMs;
    })
    .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""))[0];
  return newest?.createdAt;
}
