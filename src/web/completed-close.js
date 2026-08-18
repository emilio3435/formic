/* Mirror of src/server/completed-close.ts. The snapshot publishes
   completedCloseAt; this only decides whether that close still holds. */

export function isSpokenDone(closing) {
  if (typeof closing !== "string") return false;
  return /^done\.?$/i.test(closing.trim());
}

export function completedCloseStillHolds(agent) {
  if (!agent || !agent.completedCloseAt) return false;
  if (agent.hookLifecycle !== "idle") return false;
  if (!isSpokenDone(agent.lastAgentClosing)) return false;
  const closeAt = Date.parse(agent.completedCloseAt);
  const userAt = Date.parse(agent.lastUserFacingAt || "");
  return !(Number.isFinite(closeAt) && Number.isFinite(userAt) && userAt > closeAt);
}
