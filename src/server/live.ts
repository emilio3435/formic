/* Stall-aware live and operator-state helpers.

   Client `src/web/agent-model.js` mirrors this predicate. Live is working,
   needs-you, or waiting inside the stall window. Stalled / finished / parked
   are not live even if the process is still running. processAlive is meta. */

import { AGENT_IDLE_GAP_MS } from "./types";
import { hookInputWantsHuman, taskStateWantsHuman } from "./task-state";
import type { AgentSnapshot, LifecycleState } from "../shared/types";

export const DEFAULT_STALL_THRESHOLD_MS = AGENT_IDLE_GAP_MS;

function lifecycleOf(agent: AgentSnapshot): LifecycleState | undefined {
  if (agent.lifecycle) return agent.lifecycle;
  if (agent.activity === "working") return "working";
  if (agent.activity === "idle") return "waiting";
  if (agent.activity === "ended") return "finished";
  return undefined;
}

function isTerminalAgent(agent: AgentSnapshot): boolean {
  return lifecycleOf(agent) === "finished" || agent.scope === "retained";
}

export function isDeclaredDone(agent: AgentSnapshot): boolean {
  return agent.taskState === "done" && !hookInputWantsHuman(agent);
}

export function isAlerting(agent: AgentSnapshot): boolean {
  if (taskStateWantsHuman(agent) && !isTerminalAgent(agent)) return true;
  if ((agent.taskState === "parked" || agent.taskState === "done") && !hookInputWantsHuman(agent)) {
    return false;
  }
  if ((agent.outcome ?? "healthy") === "healthy") return false;
  if (!isTerminalAgent(agent)) return true;
  /* Same rescue arm as the client: a terminal row alerts only on positive
     evidence its process is still there. Retires with schemaVersion 2. */
  return agent.processState === "running";
}

export function isStalled(
  agent: AgentSnapshot,
  nowMs: number,
  thresholdMs = DEFAULT_STALL_THRESHOLD_MS,
): boolean {
  if (agent.scope === "retained") return false;
  if (isDeclaredDone(agent)) return false;
  if (isAlerting(agent)) return false;
  if (lifecycleOf(agent) !== "waiting") return false;
  if (agent.provenance === "turn-complete" || agent.provenance === "turn-complete-aged") return false;
  if (agent.attention === true || agent.attentionSignal) return false;
  if ((agent.outcome ?? "healthy") !== "healthy") return false;
  const updatedAtMs = Date.parse(agent.updatedAt);
  if (!Number.isFinite(updatedAtMs)) return false;
  return nowMs - updatedAtMs >= thresholdMs;
}

/* live is working, needs-you, or waiting inside the stall window.
   stalled intersect live is empty. processAlive is orthogonal to live. */
export function isLive(
  agent: AgentSnapshot,
  nowMs: number,
  thresholdMs = DEFAULT_STALL_THRESHOLD_MS,
): boolean {
  if (agent.scope === "retained") return false;
  if (isDeclaredDone(agent)) return false;
  const state = lifecycleOf(agent);
  if (state === "working") return true;
  if (isAlerting(agent)) return true;
  if (state === "waiting" && !isStalled(agent, nowMs, thresholdMs)) return true;
  return false;
}
