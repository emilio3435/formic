/* One honest clock for a board row. Working rows get an infinitive + streak
   duration. Quiet rows get a compact last-thread age. Done rows get nothing.
   Never both clocks. */

import { operatorState } from "./agent-model.js";
import { fmtCompactAge, fmtWorkingDuration, rowTimeVerb } from "./text-formatters.js";

export { ROW_TIME_VERBS, rowTimeVerb } from "./text-formatters.js";

export function rowTimeBand(agent, nowMs = Date.now(), thresholdMs, alertMuted = false) {
  const op = operatorState(agent, nowMs, thresholdMs, alertMuted);
  if (op === "done") return null;
  if (op === "working") {
    const start = Date.parse(agent && agent.workingSince);
    const duration = Number.isFinite(start) ? fmtWorkingDuration(nowMs - start) : "";
    return {
      kind: "doing",
      verb: rowTimeVerb(agent && agent.id),
      duration,
      tone: "working",
    };
  }
  const at = Date.parse(agent && agent.lastThreadAt);
  if (!Number.isFinite(at)) return null;
  const age = fmtCompactAge(nowMs - at);
  if (!age) return null;
  const tone = op === "needs-you" ? "needs-you" : op === "stalled" ? "stalled" : "waiting";
  return { kind: "since", age, tone };
}
