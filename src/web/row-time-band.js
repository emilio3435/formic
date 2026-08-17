/* One honest clock for a board row. Working rows get an infinitive + streak
   duration. Quiet rows get a compact last-thread age. Done rows get nothing.
   Never both clocks. */

import { operatorState } from "./agent-model.js";
import { fmtCompactAge, fmtWorkingDuration, rowTimeVerb } from "./text-formatters.js";

export { ROW_TIME_VERBS, rowTimeVerb } from "./text-formatters.js";

/* The Forager relay ships as five identical SVGs that differ only in
   animation-delay. Same-URL <img>s share one animation clock in Chromium and
   WebKit alike, so a board of working rows would pulse in lockstep; five files
   give five start beats a fifth of the 2s cycle apart. */
export const RELAY_PHASES = 5;

/* Stable per agent id, and deliberately hashed off a different key than the
   verb: two rows that read "foraging" must still land on different beats. */
export function relayPhase(id) {
  const key = String(id ?? "") + "#relay";
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % RELAY_PHASES;
}

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
      phase: relayPhase(agent && agent.id),
    };
  }
  const at = Date.parse(agent && agent.lastThreadAt);
  if (!Number.isFinite(at)) return null;
  const age = fmtCompactAge(nowMs - at);
  if (!age) return null;
  const tone = op === "needs-you" ? "needs-you" : op === "stalled" ? "stalled" : "waiting";
  return { kind: "since", age, tone };
}
