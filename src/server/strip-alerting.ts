import type { AgentAck, AgentSnapshot } from "../shared/types";
import { alertFingerprintFor } from "./ack";
import { isAlerting } from "./live";

/** The server already executes the client alerting truth table in live.ts.
 * A toast overlay is strip-alerting even on a healthy row: cmux dings on
 * junk, so Formic shows the same pile. Toast still does not mint outcome. */
export function agentIsAlerting(agent: AgentSnapshot): boolean {
  if (agent.attention === true) return true;
  return isAlerting(agent);
}

export function agentIsStripAlerting(
  agent: AgentSnapshot,
  acks: readonly AgentAck[],
): boolean {
  if (!agentIsAlerting(agent)) return false;
  const fingerprint = alertFingerprintFor(agent);
  return !acks.some((ack) =>
    ack.agentId === agent.id && ack.alertFingerprint === fingerprint);
}
