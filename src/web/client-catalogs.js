/* Static client catalogs. They intentionally do not depend on application state. */

export const ACTIVITY_LABELS = { working: "Working", idle: "Idle", ended: "Ended", unknown: "Unknown" };
export const OUTCOME_LABELS = { healthy: "Healthy", "needs-you": "Alert", blocked: "Blocked", failed: "Failed" };
/* "Unverified pane" sits between Linked and Observed only: cmux can route a
   Focus there, but cannot attest which session is on it, so nothing may be typed
   into it. Its own word, because it is its own state — see deriveControlState. */
export const CONTROL_LABELS = {
  linked: "Linked",
  unproven: "Unverified pane",
  "observed-only": "Observed only",
  quarantined: "Quarantined",
};

/* The operator-facing verb for each control action. It lives here rather than in
   app.js because controlOutcome() turns a control response into the sentence the
   operator reads, and api-client.js must never import from app.js — that would
   be the first import cycle in src/web. */
export const ACTION_LABELS = { focus: "Focus", instruct: "Send", interrupt: "Interrupt", archive: "Archive" };

/* Attention first, deliberately. The board used to open on "now" — every routine
   working agent — with the attention tab reading 0 beside it. A cockpit whose
   landing state is "show me all routine work" cannot also claim to stay silent
   about what does not need a human. */
export const OPS_VIEWS = ["needs-you", "now", "working", "idle", "history"];
export const VIEWS = [...OPS_VIEWS, "usage"];
export const LOOKBACK_STORAGE_KEY = "mtn3-lookbackHours";
export const LOOKBACK_PRESETS = [1, 6, 24, 36];
export const DEFAULT_LOOKBACK_HOURS = 6;
export const USAGE_RANGE_PRESETS = [
  { id: "1h", hours: 1, label: "1h" },
  { id: "24h", hours: 24, label: "24h" },
  { id: "7d", hours: 24 * 7, label: "7d" },
  { id: "30d", hours: 24 * 30, label: "30d" },
];

export const MODEL_POLICY_LABELS = {
  compliant: "Compliant",
  mismatch: "Model mismatch",
  violation: "Model mismatch",
  unreported: "Model unreported",
  unverified: "Model unreported",
};

export const WIDGET_STORAGE_KEY = "mtn3-summary-widgets";
export const DEFAULT_WIDGET_IDS = Object.freeze([
  "needs-you", "momentum", "burn", "context-peak", "health",
]);
export const WIDGET_CATALOG = Object.freeze([
  /* "Findings", not "Needs you". This card counts the whole findings collection
     — collector faults, policy drift, and agents waiting — while the tab counts
     agents waiting alone. Sharing one phrase across two populations is what let
     the rail read "NEEDS YOU 1 finding" beside a tab reading "Needs you 0" and
     a headline reading "Nothing needs you". Two populations, two words; the id
     stays so saved layouts survive. (Render-first audit §1.) */
  { id: "needs-you", label: "Findings", required: true },
  { id: "momentum", label: "Momentum" },
  { id: "burn", label: "Burn" },
  { id: "context-peak", label: "Context peak" },
  { id: "health", label: "Health" },
]);
export const WIDGET_IDS = new Set(WIDGET_CATALOG.map((widget) => widget.id));
