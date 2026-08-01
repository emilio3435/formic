/* Static client catalogs. They intentionally do not depend on application state. */

export const ACTIVITY_LABELS = { working: "Working", idle: "Idle", ended: "Ended", unknown: "Unknown" };
export const OUTCOME_LABELS = { healthy: "Healthy", "needs-you": "Alert", blocked: "Blocked", failed: "Failed" };
export const CONTROL_LABELS = { linked: "Linked", "observed-only": "Observed only", quarantined: "Quarantined" };

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
  { id: "needs-you", label: "Needs you", required: true },
  { id: "momentum", label: "Momentum" },
  { id: "burn", label: "Burn" },
  { id: "context-peak", label: "Context peak" },
  { id: "health", label: "Health" },
]);
export const WIDGET_IDS = new Set(WIDGET_CATALOG.map((widget) => widget.id));
