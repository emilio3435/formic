/* The Cleaner lane, and the chip that follows it.

   S3 of docs/superpowers/plans/2026-08-06-cleaner-agent-flow.md. The board may
   now launch a Cleaner agent (R2′), and the chip tracks it — but only ever by
   watching the lane it launched.

   THE RULE THIS FILE EXISTS TO KEEP: every state is read from the Cleaner's
   observable session. Never a timer, never optimistic. A progress indicator that
   advances on setTimeout is a lie with a spinner on it, and this codebase
   deleted dead time outright rather than fake it (docs/S0-T1-DEAD-TIME-MEASUREMENT.md)
   rather than reintroduce that class of defect here.

   A new file, deliberately, for the reason notification-center.js is one: the
   surface stays out of the contended app.js, and the derivation is testable
   without a DOM. app.js keeps only the wiring — the fetch it already owns and
   the paint.

   Contract: docs/CLEANER-LAUNCH-CONTRACT.md. */

import { isTerminal } from "./agent-model.js";
import { agentsById } from "./presentation.js";
import { attentionClassOf } from "./notification-center.js";

/* BIND BY ID, NEVER BY NAME. The contract is explicit: the authored name is
   "Cleaner", but "names are presentation rather than identity". A board that
   found its Cleaner by display name would bind to whatever a rename made true. */
export const cleanerAgentId = (sessionId) => "cursor:" + sessionId;

/* Every failure the route can return, named — because a chip can only STATE a
   failure whose name it knows, and the alternative to a stated failure is a
   permanent spinner. The server sends a message and it is preferred; these are
   the fallback when a response arrives malformed or a transport dies before one
   exists, which is exactly when a spinner would otherwise hang forever. */
export const CLEANER_FAILURES = {
  METHOD_NOT_ALLOWED: "The board sent the launch request the wrong way. Nothing was started.",
  ORIGIN_REJECTED: "The board refused its own request as cross-origin. Nothing was started.",
  CLEANER_UNAVAILABLE: "This server was started without a Cleaner launcher, so there is nothing to launch.",
  CLEANER_SESSION_CREATE_FAILED: "Cursor could not reserve a session. No lane was launched.",
  CLEANER_SESSION_ID_INVALID: "Cursor did not return a bindable session id. No workspace was requested.",
  CLEANER_CMUX_UNREACHABLE: "cmux could not be reached, so no lane could be started.",
  CLEANER_LAUNCH_FAILED: "The workspace was refused. No Cleaner is running.",
  CLEANER_SESSION_NOT_OBSERVED: "A workspace was requested but its session never appeared on this board. Nothing is running that we can see.",
};

/* The one failure that is not a failure.
   409 carries the id of the Cleaner already working, so a second click ADOPTS
   that lane instead of reporting an error. This is also why "double-click
   launches one Cleaner, not two" holds honestly rather than by debouncing the
   button: the second request is answered by the server with the first one's id. */
export const ALREADY_RUNNING = "CLEANER_ALREADY_RUNNING";

/* What the client should hold after a launch attempt. Pure, so the whole
   response-handling contract is assertable without a fetch. */
export function cleanerFromResponse(body, httpOk) {
  if (body && body.ok === true && typeof body.sessionId === "string" && body.sessionId) {
    return { sessionId: body.sessionId, code: "", error: "" };
  }
  const code = (body && body.error && body.error.code) || "";
  const message = (body && body.error && body.error.message) || "";
  /* Adopted, not failed: bind to the lane that is already running. */
  if (code === ALREADY_RUNNING && body && typeof body.sessionId === "string" && body.sessionId) {
    return { sessionId: body.sessionId, code: "", error: "" };
  }
  return {
    sessionId: "",
    code,
    /* The server's own sentence first — it knows which step refused. The named
       fallback covers a malformed body, and the last resort still says what
       happened rather than leaving the chip mid-spin. */
    error: message
      || CLEANER_FAILURES[code]
      || (httpOk ? "The launch answered in a shape the board could not read. Nothing is confirmed running."
        : "The launch request did not reach the board's server. Nothing was started."),
  };
}

/* THE STATE MACHINE, derived — every branch below names the evidence that makes
   it true, and there is no branch without one.

   `resolving` from the plan's table is DELIBERATELY ABSENT. It was defined as
   "the Cleaner's own reported step", and the launch contract closes that door in
   as many words: "the existing Cursor transcript, hook lifecycle, attention
   detection, and snapshot collector are the sole progress channel. No Cleaner
   telemetry store exists." Once the operator approves, the lane returns to
   working with no attentionClass — observationally identical to `watching`.
   Shipping `resolving` would mean advancing a label by inference, which is the
   setTimeout defect wearing a different hat. Six honest states instead of
   seven, per §2: if a state cannot be observed, it does not exist in the UI. */
export function cleanerView(snap, cleaner = {}) {
  if (cleaner.error) return { state: "failed", message: cleaner.error, code: cleaner.code || "" };
  if (cleaner.launching) return { state: "launching", message: "Starting a Cleaner lane…" };
  if (!cleaner.sessionId) return { state: "idle", message: "" };

  const found = agentsById(snap).get(cleanerAgentId(cleaner.sessionId));
  /* Absent is NOT ended. The contract says so outright — "a session that
     disappeared from an incomplete snapshot is not treated as ended" — so the
     chip holds at launching rather than advancing past a session it cannot see.
     Advancing here would be the optimistic read the rule forbids. */
  if (!found) return { state: "launching", message: "Waiting for the Cleaner lane to appear…", sessionId: cleaner.sessionId };

  const agent = found.agent;
  if (isTerminal(agent)) {
    return { state: "resolved", sessionId: cleaner.sessionId, agentId: agent.id, message: "" };
  }
  if (attentionClassOf(agent) === "blocking") {
    /* The ask is a HANDOFF item like any other — it reaches the operator through
       the notification center's existing handoff feed, the drawer and the reply
       path. The chip only says that it is asking; it does not grow a second
       approval control. */
    return { state: "needs-you", sessionId: cleaner.sessionId, agentId: agent.id, message: "The Cleaner is asking you something." };
  }
  return { state: "watching", sessionId: cleaner.sessionId, agentId: agent.id, message: "The Cleaner is working." };
}

/* The chip's own words. A count where a count is known, and never an adjective:
   "3 worktrees, 2 branches, 1 refused" is a fact and "Cleanup complete!" is a
   mood. §4 of the plan, and this product's voice generally. */
export const CLEANER_LABELS = {
  idle: "Clean up",
  launching: "Starting…",
  watching: "Cleaner working",
  "needs-you": "Cleaner needs you",
  resolved: "Cleaner finished",
  failed: "Cleaner failed",
};

/* Which states are a process in flight, for the indicator. `resolved` and
   `failed` are ENDINGS and must not spin — a Cleaner that died leaving a
   permanent spinner is the exact failure §6 tests for. */
export const CLEANER_IN_FLIGHT = new Set(["launching", "watching"]);

/* S5 — the beat, and WHEN it is allowed to play.

   The ring lands at the moment the lane is confirmed alive: the transition from
   launching (asked for, not yet seen) to watching (its session is on this
   board). That is an observed edge, not an elapsed time — the same rule the rest
   of this file keeps. A landing played on a timer would be a celebration of
   nothing, which is worse than no celebration.

   It plays once per binding. `lands` is a fact about a transition, so the caller
   holds the previous state and asks; it cannot re-fire on a repaint because the
   previous state is then already `watching`. */
export function cleanerLands(previousState, nextState) {
  return previousState === "launching" && nextState === "watching";
}

/* Counts, from the plan the sweep produced.

   Stated as PROPOSED rather than removed. The board observes that a Cleaner
   session ended; it does not observe what the Cleaner removed, because no
   channel reports that. Rendering "3 removed" from a proposal would assert an
   outcome from evidence of an intention — the same defect as every other line
   this program has been pulling out of this surface. */
export function cleanupCounts(view) {
  if (!view) return null;
  const removable = Array.isArray(view.removable) ? view.removable : [];
  const refusedW = (view.refused && view.refused.worktrees) || [];
  const refusedB = (view.refused && view.refused.branches) || [];
  const worktrees = removable.filter((item) => item.kind === "worktree").length;
  const branches = removable.filter((item) => item.kind === "branch").length;
  return {
    worktrees,
    branches,
    refused: refusedW.length + refusedB.length,
    proposed: removable.length,
  };
}

export function countsSentence(counts) {
  if (!counts) return "";
  const parts = [];
  if (counts.worktrees) parts.push(`${counts.worktrees} worktree${counts.worktrees === 1 ? "" : "s"}`);
  if (counts.branches) parts.push(`${counts.branches} branch${counts.branches === 1 ? "" : "es"}`);
  const proposed = parts.length ? parts.join(", ") + " proposed" : "nothing proposed";
  return counts.refused ? `${proposed}, ${counts.refused} refused` : proposed;
}
