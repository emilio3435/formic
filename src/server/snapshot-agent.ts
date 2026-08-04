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
  AgentStatus,
  CollectionScope,
  ControlCapability,
  IdentityTrace,
  LifecycleProvenance,
  LifecycleState,
  ModelPolicy,
  OperatorControlState,
  OutcomeState,
  ProcessState,
} from "../shared/types";
import {
  classifyLifecycle,
  type LifecycleThresholds,
  type LifecycleVerdict,
} from "./lifecycle";
import { MODEL_CONFIG, cursorNativeFamily } from "./model-config";
import { transmitRefusal } from "./targets";
import type { CollectedAgent } from "./types";

/* Why Send and Interrupt are gated harder than Focus: `unique-cwd` matches a
   pane on its working directory among panes carrying NO identity evidence, so
   the session on it is inferred, not attested. A pane that cds away and another
   that cds in is enough to move the match to the wrong terminal while the row
   still reads healthy. Focus stays available on such a row — it types nothing,
   and looking at the pane is how an operator resolves the ambiguity — but
   anything that puts characters into a tty needs cmux to have named the
   session. The reasons here are what the operator reads, so they say the
   control is deliberately off and what would turn it back on, rather than
   leaving a dead button that looks broken. */
export function controlsFor(
  agent: CollectedAgent,
  target: AgentSnapshot["target"],
  archived: boolean,
  identityTrace?: IdentityTrace,
): ControlCapability[] {
  const routed = Boolean(target.surfaceId) && (target.resolution === "exact" || target.resolution === "unique-cwd");
  const targetReason = target.reason ?? "No safe cmux target is available.";
  /* The SAME predicate executeControl consults, so the button and the endpoint
     cannot disagree. They did: 26a4585 gated the endpoint on liveness and left
     this function offering Send on a row whose process was known dead. Nothing
     unsafe happened, and that is exactly the point — a control the system will
     refuse is a promise the board should never have made. Agreement by
     construction, not by remembering to edit both. */
  const refusal = transmitRefusal({ target, processState: processStateFor(agent), archived, identityTrace });
  const focusEnabled = routed && !archived;
  return [
    { action: "focus", enabled: focusEnabled, reason: focusEnabled ? undefined : refusal?.cause ?? targetReason },
    { action: "instruct", enabled: !refusal, reason: refusal?.cause },
    { action: "interrupt", enabled: !refusal, reason: refusal?.cause },
    { action: "archive", enabled: !archived, reason: archived ? "Agent is already archived." : undefined },
  ];
}

/* The bridge from a collected agent to the lifecycle contract.

   Its whole job is reading evidence off the record and handing it to the one
   classifier — no verdict is reached here. Kept separate from
   `classifyLifecycle` so that module stays a pure statement of the rules,
   testable from a fixture with no CollectedAgent in sight, while the mapping
   from this repo's field names lives where the field names do. */
export function lifecycleFor(
  agent: CollectedAgent,
  input: {
    operatorArchived: boolean;
    scope: CollectionScope;
    nowMs: number;
    thresholds?: LifecycleThresholds;
    persisted?: { lifecycle?: LifecycleState; provenance?: LifecycleProvenance };
  },
): LifecycleVerdict {
  const updatedAtMs = Date.parse(agent.updatedAt);
  return classifyLifecycle(
    {
      ageMs: Number.isFinite(updatedAtMs) ? Math.max(0, input.nowMs - updatedAtMs) : 0,
      operatorArchived: input.operatorArchived,
      endEvidence: agent.endEvidence,
      processAlive: agent.processAlive,
      processIds: agent.processIds,
      scope: input.scope,
      persisted: input.persisted,
    },
    input.thresholds,
  );
}

/* The legacy activity word, now a TRANSLATION of the lifecycle verdict rather
   than a second opinion about it.

   What used to be here decided the question independently, and the answer it
   gave for `stale` with no process evidence was "ended" — absence of evidence
   published as evidence of an ending, for 85 sessions on this machine. The
   comment that stood here argued the case for one rescue (`processAlive === true`
   keeps a quiet session alive) and it was right; the contract simply carries
   that argument to its conclusion and gives the unprovable case its own word.

   The mapping is deliberately lossy in the honest direction. `unverified`
   becomes "unknown", which is the legacy vocabulary's closest true word: it is
   excluded from legacy `live` AND from legacy `ended`, so an old client
   under-counts rather than mis-claims. One classifier, two vocabularies. */
export function activityForLifecycle(lifecycle: LifecycleState, scope: CollectionScope = "observed"): ActivityState {
  if (scope === "retained") return "ended";
  switch (lifecycle) {
    case "working": return "working";
    case "waiting": return "idle";
    case "unverified": return "unknown";
    case "finished": return "ended";
  }
}

/* The legacy status word, same translation, the other vocabulary. Notification
   no longer overwrites it: attention is an overlay and rides its own field. */
export function statusForLifecycle(lifecycle: LifecycleState, scope: CollectionScope = "observed"): AgentStatus {
  if (scope === "retained") return "archived";
  switch (lifecycle) {
    case "working": return "running";
    case "waiting": return "waiting";
    case "unverified": return "stale";
    case "finished": return "archived";
  }
}

/* Kept for callers holding a CollectedAgent and no verdict — the archive's own
   records, and tests that predate the contract. It routes through the same
   classifier, so there is still exactly one place the question is answered. */
export function activityFor(agent: CollectedAgent, archived: boolean, nowMs = Date.now()): ActivityState {
  const verdict = lifecycleFor(agent, { operatorArchived: archived, scope: "observed", nowMs });
  return activityForLifecycle(verdict.lifecycle);
}

export function processStateFor(agent: CollectedAgent): ProcessState {
  if (agent.processAlive === true) return "running";
  /* "Exited cleanly — this one is done" is a claim about the SESSION, so only a
     session exit may make it. It used to fire on `transcriptEndedCleanly`,
     which Claude and Codex mint from a completed turn, so a session waiting on
     its operator advertised its process as cleanly finished — a false statement
     printed beside a Waiting row. A turn ending says nothing about a process. */
  if (agent.endEvidence === "session-exit") return "exited";
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
  const { contextWindow, provenance, scope, total } = agent.tokens;
  /* Occupancy is a size, so the numerator is always `total` — the one field that
     means "how big the prompt was", cache reads included, in BOTH scopes. It used
     to fall back to `sessionTotal` for scope "session"; that read the same number,
     because the only session-scope producer sets total and sessionTotal from the
     same codex `total_token_usage`. Now that sessionTotal means new tokens and
     excludes cache reads, that fallback would have quietly understated a session's
     fill instead of matching it. a371b23 fixed this numerator once by scope; this
     removes the branch so it cannot drift back. */
  const numerator = total;
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
