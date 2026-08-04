/* API client — the contract this dashboard has with its server.

   Every request the client makes goes through apiFetch, which is the only place
   a deadline is armed: a hung loopback socket otherwise never reaches the
   caller's recovery path, and a request with no deadline is a spinner that never
   resolves. Also here: how each URL is built, how the limits in those URLs are
   clamped to the routes' documented caps, and the SENTENCES shown when a request
   fails — because "what do we say when this endpoint is down" is part of the
   contract, not an afterthought at the call site.

   Pure except apiFetch itself, which touches only the global fetch. No DOM, no
   module state, no rendering: the callers own what to DO with a failure, this
   owns how to ask and how to describe the asking going wrong. */

/* ACTION_LABELS is the only catalog this module reads; client-catalogs.js has no
   imports of its own, so this stays acyclic. */
import { ACTION_LABELS } from "./client-catalogs.js";

export const API_READ_TIMEOUT_MS = 10_000;

export const API_TRANSCRIPT_TIMEOUT_MS = 30_000;

export const API_WRITE_TIMEOUT_MS = 30_000;

// A hung loopback socket otherwise never reaches the request's recovery path.

export async function apiFetch(url, options = {}, timeoutMs = API_READ_TIMEOUT_MS) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    return await fetch(url, { ...options, signal });
  } catch (error) {
    const endpoint = String(url);
    if (timeout.aborted) throw new Error(endpoint + " timed out after " + (timeoutMs / 1000) + "s");
    throw new Error(endpoint + " request failed: " + (error instanceof Error ? error.message : String(error)));
  }
}

export const TRANSCRIPT_DEFAULT_LIMIT = 200;

export const TRANSCRIPT_MAX_LIMIT = 1000;         // the contract's hard cap

export const TRANSCRIPT_LIMIT_STEPS = [200, 500, 1000];
// Painting a 1000-line transcript as 1000 nodes on every drawer repaint is how
// an inspector becomes unusable. The window is the tail, which is the part the
// operator is asking about; the count it is hiding is stated, never implied.

export function clampTranscriptLimit(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return TRANSCRIPT_DEFAULT_LIMIT;
  return Math.min(TRANSCRIPT_MAX_LIMIT, Math.max(1, v));
}

export function nextTranscriptLimit(current) {
  return TRANSCRIPT_LIMIT_STEPS.find((step) => step > clampTranscriptLimit(current)) || null;
}

export function transcriptUrl(agentId, limit) {
  return "/api/transcript?agent=" + encodeURIComponent(agentId) + "&limit=" + clampTranscriptLimit(limit);
}

/* The wire shape, defended. Everything in it is agent-derived: an unknown role
   collapses to "unknown", a non-string `text` is dropped rather than String()-ed
   into "[object Object]", and a missing `source` stays null instead of becoming
   a plausible-looking path. Never invent content. */

/* Why this refusal gets its own sentence.

   These two GETs used to demand an `Origin` header that a browser never sends
   on a same-origin GET, so both features were dark in the browser and only
   worked from curl. That is FIXED on the server: verified live, both routes
   answer 200 to a request with no `Origin` at all.

   The code still exists, and now means something entirely different — the
   routes are served only over a loopback hostname, so a page that reached the
   server by any other name gets it. So the copy must NOT still tell the
   operator that "the server's read endpoints have to stop requiring one": that
   would send them to route a fix that has already shipped, which is the same
   expensive lie as "not available in this build", pointed at a different team.
   Name the address instead — it is the one thing they can act on. */
export function readEndpointOriginNote(what) {
  return what + " are refused by the server (ORIGIN_REJECTED): these reads are served only over a "
    + "loopback address, and this page reached the server under another hostname. Open the board at "
    + "127.0.0.1 or localhost.";
}

/* Degrade honestly. This client ships ahead of the route, so the common failure
   is a 404 with no JSON envelope — which means "this build cannot show you a
   transcript", NOT "this agent has no transcript". Saying the second would be a
   lie the operator would act on. */

export function transcriptFailureText(status, body) {
  const code = body && body.error && body.error.code;
  const message = body && body.error && body.error.message;
  if (!status) return "Could not reach the server for this transcript.";
  if (code === "AGENT_NOT_FOUND") return "This session is no longer tracked, so its transcript cannot be resolved.";
  if (code === "ORIGIN_REJECTED") return readEndpointOriginNote("Transcripts");
  if (status === 404 && !code) return "Transcript view is not available in this build.";
  return "Transcript unavailable"
    + (code ? " [" + code + "]" : "")
    + (message ? ": " + message : " (HTTP " + status + ")");
}

export const ACTIONS_DEFAULT_LIMIT = 100;

export const ACTIONS_MAX_LIMIT = 500;             // the contract's hard cap

export function clampActionsLimit(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return ACTIONS_DEFAULT_LIMIT;
  return Math.min(ACTIONS_MAX_LIMIT, Math.max(1, v));
}

export function actionsUrl(limit = ACTIONS_DEFAULT_LIMIT) {
  return "/api/actions?limit=" + clampActionsLimit(limit);
}

export function actionsFailureText(status, body) {
  const code = body && body.error && body.error.code;
  const message = body && body.error && body.error.message;
  if (!status) return "Could not reach the server for the action log.";
  if (code === "ORIGIN_REJECTED") return readEndpointOriginNote("Action-log reads");
  if (status === 404 && !code) return "The action log is not available in this build.";
  return "Action log unavailable"
    + (code ? " [" + code + "]" : "")
    + (message ? ": " + message : " (HTTP " + status + ")");
}

/* Refresh the journal after anything that writes to it, but only once the log
   has proved it exists — a build without the route must not be polled forever. */

/* The one screen a broken instance shows must name the address it was actually
   served from: MOUNTAIN_PORT, anthill-start.sh and anthill-preview.sh all bind
   different ports, and a preview on :4715 telling the operator to go check
   :4701 sends them to a healthy production process. "v3 server" was internal
   versioning that means nothing to the reader. host is a parameter so the rule
   is testable without a browser. */
export function serverUnreachableHint(host) {
  const where = host ? "on " + host : "at this address";
  return "Check that the Ant Hill server is running " + where + ", then retry.";
}

/* Reading a control response is the same shape as transcriptFailureText and
   actionsFailureText above: status + body in, the operator's sentence out. It
   lived inside sendControl, welded to state.pending, render() and toast(), so
   the one invariant that matters here — HTTP completion alone is never success —
   could only be exercised through a DOM and fetch harness.

   `ok` is believed only when the body says so in a boolean. A 200 carrying {},
   a non-JSON body, or a transport error are all failures: the server journals
   the attempt either way, and telling the operator a keystroke landed when it
   may not have is the one lie this control plane cannot afford.

   agentLabel is passed in rather than derived: naming an agent is presentation,
   and this module stays free of the board. */
export function controlOutcome(action, agentLabel, { status, body, error } = {}) {
  const label = ACTION_LABELS[action] || action;
  if (error) {
    return { ok: false, message: label + " failed: " + (error && error.message ? error.message : "network error") };
  }
  if (body && typeof body.ok === "boolean") {
    if (body.ok) return { ok: true, message: label + " succeeded (" + agentLabel + ")" };
    const err = body.error || {};
    let msg = label + " failed";
    if (err.code) msg += " [" + err.code + "]";
    if (err.message) msg += ": " + err.message;
    if (err.exitCode != null) msg += " (exit " + err.exitCode + ")";
    if (err.stderr) msg += "\n" + err.stderr.trim();
    return { ok: false, message: msg };
  }
  return {
    ok: false,
    message: label + " failed: server returned an unexpected response (HTTP " + status + ")",
  };
}

/* The board is blank until the first snapshot resolves: the client is a deferred
   module and boot() paints nothing before fetchSnapshot() returns. index.html
   therefore ships the skeleton VISIBLE, so the shape of the board is on screen
   before app.js has even parsed; this is only what takes it back down.

   fetchFailed is the whole distinction. Without it an unreachable server would
   sit under a shimmering placeholder indefinitely, which reads as "still
   loading" rather than "this is broken" — #empty-state owns that message and
   its retry button. */
