import type { HookLifecycle, LifecycleState, TaskState } from "../shared/types";

export interface TaskAttentionEvidence {
  taskState?: TaskState;
  taskStateAt?: string;
  hookLifecycle?: HookLifecycle;
  hookLifecycleAt?: string;
  lifecycle?: LifecycleState;
  sourceFreshness?: "last-known";
  attentionSignal?: unknown;
}

function timestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/* A task declaration changes only whether a stale hook still asks for a human.
   Active and undeclared lanes keep today's behavior. Parked/done wins unless a
   needsInput hook carries affirmative evidence that it happened later. */
export function hookInputWantsHuman(evidence: TaskAttentionEvidence): boolean {
  if (evidence.hookLifecycle !== "needsInput") return false;
  if (evidence.taskState === undefined || evidence.taskState === "active") return true;
  const taskStateAt = timestamp(evidence.taskStateAt);
  const hookLifecycleAt = timestamp(evidence.hookLifecycleAt);
  return taskStateAt !== undefined
    && hookLifecycleAt !== undefined
    && hookLifecycleAt > taskStateAt;
}

function attentionKind(signal: unknown): string | undefined {
  if (!signal || typeof signal !== "object") return undefined;
  const kind = (signal as { kind?: unknown }).kind;
  return typeof kind === "string" ? kind : undefined;
}

/* An offer-question mid-turn is not a stopped ask. needsInput and every other
   kind still count. last-known rows keep today's behavior: we cannot see that
   the source is still working. */
export function offerQuestionSuppressed(evidence: TaskAttentionEvidence): boolean {
  if (attentionKind(evidence.attentionSignal) !== "question-pending") return false;
  if (evidence.lifecycle !== "working") return false;
  return evidence.sourceFreshness !== "last-known";
}

/* The complete attention verdict before the separate terminal-session gate.
   Parked/done suppresses every older request, not only the hook field that
   exposed the defect; a strictly newer needsInput is the one re-alert path. */
export function taskStateWantsHuman(evidence: TaskAttentionEvidence): boolean {
  const currentHookInput = hookInputWantsHuman(evidence);
  if (evidence.taskState === "parked" || evidence.taskState === "done") {
    return currentHookInput;
  }
  if (offerQuestionSuppressed(evidence)) return currentHookInput;
  return Boolean(evidence.attentionSignal) || currentHookInput;
}
