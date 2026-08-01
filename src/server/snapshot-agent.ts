/* Per-agent field derivation for the snapshot.

   Everything here answers "given one collected agent, what does the operator
   see in that row?" — activity, outcome, control state, role, effort, context
   utilization, and the next action. Pure functions over a CollectedAgent (plus
   the already-resolved cmux target), so they can be read and tested without
   dragging in program assembly or issue lifecycle. buildSnapshot owns the
   ordering; this module owns the verdicts. */

import type {
  ActivityState,
  AgentRole,
  AgentSnapshot,
  ControlCapability,
  ModelPolicy,
  OperatorControlState,
  OutcomeState,
  ProcessState,
} from "../shared/types";
import { MODEL_CONFIG, cursorNativeFamily } from "./model-config";
import type { CollectedAgent } from "./types";

export function controlsFor(agent: CollectedAgent, target: AgentSnapshot["target"], archived: boolean): ControlCapability[] {
  const routed = Boolean(target.surfaceId) && (target.resolution === "exact" || target.resolution === "unique-cwd");
  const targetReason = target.reason ?? "No safe cmux target is available.";
  return [
    { action: "focus", enabled: routed && !archived, reason: routed && !archived ? undefined : archived ? "Agent is archived." : targetReason },
    { action: "instruct", enabled: routed && !archived, reason: routed && !archived ? undefined : archived ? "Agent is archived." : targetReason },
    { action: "interrupt", enabled: routed && !archived, reason: routed && !archived ? undefined : archived ? "Agent is archived." : targetReason },
    { action: "archive", enabled: !archived, reason: archived ? "Agent is already archived." : undefined },
  ];
}

export function activityFor(agent: CollectedAgent, archived: boolean): ActivityState {
  if (archived || agent.status === "archived") return "ended";
  /* `stale` is not an ending. It is `statusFrom()` observing that the transcript
     has not been written for 45 minutes, decided at parse time, before any
     process evidence exists on the record. A session that is waiting at a
     prompt, blocked on a long build, or wedged writes nothing for 45 minutes
     and is alive in all three cases.

     Calling that "ended" is not a cosmetic mislabel — it costs the operator the
     controls. `operatorControlState(target, activity === "ended")` downgrades
     the agent to `observed-only` while its own `controls[]` array still reports
     focus/instruct as ENABLED, and `nextActionFor` sends the operator to
     "Review this session in history." Measured on a live fleet: 6 agents in
     that contradiction, 3 of them holding an unread cmux notification — asking
     for a human from a session the board had filed as finished.

     So silence plus a PROVABLY live process is idle, not ended. Absent-first is
     preserved exactly: `processAlive` undefined still reads "ended", which is
     every agent whose terminal has gone. Only positive evidence moves the
     verdict, and only `archived` — a session exit the source actually recorded
     — can still end a session outright. */
  if (agent.status === "stale") return agent.processAlive === true ? "idle" : "ended";
  if (agent.status === "running") return "working";
  if (agent.status === "waiting" || agent.status === "attention") return "idle";
  return "unknown";
}

export function processStateFor(agent: CollectedAgent): ProcessState {
  if (agent.processAlive === true) return "running";
  if (agent.transcriptEndedCleanly === true) return "exited";
  if (agent.processAlive === false && agent.processIds?.length) return "died";
  return "unknown";
}

export function outcomeFor(agent: CollectedAgent, archived: boolean, hasNotification: boolean): OutcomeState {
  if (archived) return "healthy";
  const gates = agent.gates.join(" ");
  if (/\b(?:fail(?:ed|ing)?|error)\b/i.test(gates)) return "failed";
  if (agent.gates.length > 0) return "blocked";
  if (hasNotification || agent.status === "attention") return "needs-you";
  return "healthy";
}

export function operatorControlState(
  target: AgentSnapshot["target"],
  archived: boolean,
): OperatorControlState {
  if (archived) return "observed-only";
  if (target.surfaceId && (target.resolution === "exact" || target.resolution === "unique-cwd")) {
    return "linked";
  }
  return target.resolution === "ambiguous" ? "quarantined" : "observed-only";
}

export function cursorModelPolicy(
  agent: CollectedAgent,
  sourcesById: ReadonlyMap<string, CollectedAgent>,
): ModelPolicy | undefined {
  if (agent.provider !== "cursor") return undefined;
  const parent = agent.parentSourceSessionId
    ? sourcesById.get(`cursor:${agent.parentSourceSessionId}`)
    : undefined;
  const expected = parent?.model ?? MODEL_CONFIG.cursorRootModel;
  const evidence = agent.parentSourceSessionId ? "cursor-ai-tracking" : "cursor-local";
  if (!agent.model) {
    return {
      state: "unreported",
      expected,
      evidence: "none",
      summary: "Cursor did not expose an authoritative model for this session.",
    };
  }
  if (agent.parentSourceSessionId && !parent?.model) {
    return {
      state: "unreported",
      expected: "Parent model (unreported)",
      observed: agent.model,
      evidence,
      summary: `${agent.model} was observed, but the parent model was not reported, so inheritance cannot be verified.`,
    };
  }
  // Any Cursor-native family (Grok or Composer) is compliant; a reported
  // non-native model is a routing violation regardless of the parent model.
  const nativeFamily = cursorNativeFamily(agent.model);
  return nativeFamily
    ? { state: "compliant", expected, observed: agent.model, evidence, summary: `${agent.model} runs the Cursor-native ${nativeFamily} family.` }
    : { state: "mismatch", expected, observed: agent.model, evidence, summary: `${agent.model} is not a Cursor-native model family.` };
}

export function roleFor(agent: CollectedAgent, hasChildren: boolean): AgentRole {
  const title = agent.displayName.toLowerCase();
  const taskLead = (agent.task ?? "").split("\n", 1)[0]!.toLowerCase();
  const lead = `${title}\n${taskLead}`;
  if (hasChildren || /(?:^|\n)(?:goal:\s*)?(?:orchestrat\w*|coordinat\w*|deploy (?:an? )?swarm|swarm owner)\b/.test(lead)) {
    return "orchestrator";
  }
  if (
    /\b(?:verifier|reviewer|auditor|gatekeeper)\b/.test(title) ||
    /(?:^|\n)(?:you are\s+)?(?:the\s+)?(?:independent(?:ly)?\s+|final\s+|read-only\s+|adversarial\s+)*(?:verif\w*|reviewer|auditor|gatekeeper)\b/.test(lead)
  ) return "verifier";
  if (/\b(?:automation|autopilot)\b/.test(lead)) return "automation";
  if (/\b(?:frontend|front-end|renderer|\bui\b|\bux\b|design)\b/.test(title)) return "frontend";
  if (/\b(?:backend|back-end|server|\bipc\b|engine)\b/.test(title)) return "backend";
  if (/\b(?:tester|testing|\bqa\b|test lane)\b/.test(title)) return "tester";
  return "agent";
}

export function effortFor(agent: CollectedAgent): string | undefined {
  if (agent.effort) return agent.effort.toUpperCase();
  const model = agent.model?.toLowerCase();
  if (!model) return undefined;
  if (/(?:^|[-_])xhigh(?:$|[-_])/.test(model)) return "XHIGH";
  if (/(?:^|[-_])high(?:$|[-_])/.test(model)) return "HIGH";
  if (/(?:^|[-_])max(?:$|[-_])/.test(model)) return "MAX";
  if (/(?:^|[-_])medium(?:$|[-_])/.test(model)) return "MEDIUM";
  if (/(?:^|[-_])low(?:$|[-_])/.test(model)) return "LOW";
  return undefined;
}

export function contextPctFor(agent: CollectedAgent): number | undefined {
  const { contextWindow, provenance, scope, total, sessionTotal } = agent.tokens;
  const numerator = scope === "latest-turn" ? total : sessionTotal;
  if (
    provenance !== "observed" ||
    scope === "unknown" ||
    !Number.isFinite(contextWindow) ||
    !Number.isFinite(numerator) ||
    !contextWindow ||
    !numerator ||
    contextWindow < 0 ||
    numerator < 0 ||
    numerator > contextWindow
  ) return undefined;
  return Math.round((numerator / contextWindow) * 100);
}

/* nextActionFor(activity, outcome, controlState) lived here. It classified by
   clock and control-plane state alone and never read a word the agent wrote, so
   on a live fleet of 275 it answered "Review this session in history." for 248.
   attention-signal.ts replaces it with detectors over transcriptTail and
   lastAgentMessage, and emits nothing where the text does not say why. */
