function timestamp(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/* Minimal mirror of src/server/task-state.ts. UI integration belongs to T7;
   keeping the decision here lets both sides execute the same truth table. */
export function hookInputWantsHuman(evidence) {
  if (!evidence || evidence.hookLifecycle !== "needsInput") return false;
  if (evidence.taskState === undefined || evidence.taskState === "active") return true;
  const taskStateAt = timestamp(evidence.taskStateAt);
  const hookLifecycleAt = timestamp(evidence.hookLifecycleAt);
  return taskStateAt !== undefined
    && hookLifecycleAt !== undefined
    && hookLifecycleAt > taskStateAt;
}

export function taskStateWantsHuman(evidence) {
  if (!evidence) return false;
  const currentHookInput = hookInputWantsHuman(evidence);
  if (evidence.taskState === "parked" || evidence.taskState === "done") {
    return currentHookInput;
  }
  return Boolean(evidence.attentionSignal) || currentHookInput;
}
