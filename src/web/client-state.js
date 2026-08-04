/* Shared client state — the single mutable object every surface reads.

   It lives in its own module because it is genuinely SHARED, not an app.js
   private that other files borrow. The board, the drawer, the summary strip and
   the network layer all read and write this one object; hanging it off app.js
   meant every other module had to import from the entry point, which is a cycle
   waiting to happen the moment one of those modules is extracted.

   Deliberately just the object. The functions that mutate it and then repaint
   (setLookbackHours, selectEntity, closeInspector) stay with the code that owns
   the repaint — this module holds the data, not the policy for changing it.

   Everything here is UI state, never server truth: `snap` is the last snapshot
   adopted, and the rest is what this browser is currently doing with it. */

import { DEFAULT_LOOKBACK_HOURS, DEFAULT_WIDGET_IDS } from "./client-catalogs.js";

export const state = {
  snap: null,
  // Sequence of the whole snapshot in `snap`. A delta is eligible only when
  // its baseSequence matches this exactly; null means only a full snapshot can
  // establish a safe base.
  snapshotSequence: null,
  fetchFailed: false,
  conn: "connecting", // connecting | live | reconnecting | stale | offline
  // The server's own /api/health verdict. null until first polled; stays null
  // in any environment without fetch, so the mark simply never speaks.
  serverHealth: null,
  lastEventAt: 0,
  view: "needs-you", // the board opens on what needs a human, not on all work
  query: "",
  facetProgram: "",
  facetProvider: "",
  lookbackHours: DEFAULT_LOOKBACK_HOURS, // null = all collected
  scanWindowHours: 36,
  /* Was `settingsLoaded`, which nothing ever read — written true and false and
     never consulted, so a dead /api/settings was invisible by construction.
     The error string is read by the scan-window chip, which otherwise prints
     this 36 as though the server had confirmed it. */
  settingsError: "",
  settingsPending: false,
  settingsSavedAt: 0,        // when the last save succeeded; drives the confirmation
  settingsSaveError: "",     // the server's own rejection message, kept on the panel
  /* The whole v2 settings object as the server last served it, so the panel can
     render current values rather than guessing at defaults. */
  settings: null,
  settingsLoaded: false,
  settingsPanelOpen: false,
  usageRangeId: "24h",
  usageCustomHours: 24,
  usageLoading: false,
  usageError: "",
  usageSummary: null,
  usageSeries: null,
  usageWard: null,
  usageInvocations: null,
  usageFetchedAt: 0,
  contextDisplay: "percent", // percent | tokens
  contextSpread: "median",     // median | average — which one the gauge spells out
  labels: new Map(),           // stable presentation target key -> label
  aliases: null,               // compatibility name for the existing program-alias seam
  labelsLoading: false,
  labelsLoaded: false,
  labelLoadError: "",
  renaming: null,              // presentation target key currently being edited
  widgetIds: [...DEFAULT_WIDGET_IDS], // own mutable copy; the catalog is frozen
  widgetCustomizerOpen: false,
  renameDraft: "",
  renamePending: false,
  renameError: "",
  selecting: false,            // selection/broadcast mode
  selection: new Set(),        // selected agent ids
  broadcastDraft: "",
  broadcastConfirming: false,
  broadcastPending: false,
  broadcastError: "",
  broadcastResults: null,      // Map agentId -> { ok, error }
  programOverrides: new Map(), // programId -> "open" | "closed"
  selectedId: null,
  selected: null,           // { kind: "agent"|"intervention"|"advisory"|…, id } — drives the drawer router
  /* data-fkey of whatever the operator was standing on when they opened the
     drawer, so closing it can put them back. closeInspector used to return focus
     via `agent-<selectedId>`, and selectedId is null for every kind that is not
     an agent — so closing a program or finding drawer destroyed the focused
     Close button and dropped a keyboard operator on <body>. */
  selectionOrigin: null,
  evidenceOpen: false,     // Bookshelf drawer: Operate + Chat stay open; Evidence is opt-in (cog).
  // Terminal-level identity evidence for the open drawer. The pids, commands
  // and open-file matches that say "ttys082 has both of these sessions open"
  // live on CmuxSurface, which /api/snapshot does not carry — so they are
  // fetched on demand from the read-only GET /api/debug/identity.
  identity: { agentId: null, loading: false, error: "", data: null },
  // Inline transcript for the open drawer. Scoped to one agent id for the same
  // reason `identity` is: a drawer switched mid-flight must never adopt the
  // previous agent's transcript.
  transcript: { agentId: null, loading: false, error: "", data: null, limit: 200 },
  // Persistent operator journal (GET /api/actions). `available` latches false on
  // a build with no such route so a missing endpoint is asked for once, not
  // every five seconds forever.
  actions: { loading: false, error: "", available: true, items: [], fetchedAt: 0 },
  actionsOpen: false,
  // Operator attention verdicts (POST /api/attention). The snapshot carries the
  // effect, never the record, so the server's own answer is kept here to name
  // what was done. An expired snooze is dropped by attentionRecord(), which is
  // what lets a returning alert read as a return.
  attention: new Map(),        // agentId -> { action, updatedAt, snoozedUntil? }
  attentionPending: new Set(), // agentId
  attentionErrors: new Map(),  // agentId -> operator-facing sentence
  // Out-of-page attention. `seen` is null until the first snapshot is adopted,
  // which is what makes opening the page to a backlog silent.
  notify: { enabled: false, permission: "default", seen: null, baseTitle: "" },
  drafts: new Map(),      // agentId -> instruct draft text
  confirming: null,       // instance fkey: `[head:]act:${agentId}:${action}`
  pending: new Set(),     // `${agentId}:${action}`
  feedback: new Map(),    // agentId -> { ok, action, message }
  triage: new Map(),      // issueId -> recommendation
  triagePending: new Set(),
  triageErrors: new Map(),
  queueItems: [],
  /* An empty triage queue and an unreachable one produce the same zero queue
     findings, and the strip called that calm. This is what tells them apart. */
  queueError: "",
  // Inline pulse expansion. The needs-you verdict button opens a capped
  // findings panel in place; "+N more" reveals the rest. Both are transient —
  // not persisted, so a reload returns to the collapsed strip.
  pulseExpanded: false,
  pulseShowAll: false,
  // Paint signatures — skip wipe-and-rebuild when a surface's meaningful
  // content is unchanged across SSE snapshots (stops the 4s strobe).
  // `alarm` and `actions` start null, not "": their calm signature IS the empty
  // string, so a "" seed would make the very first paint a no-op and leave both
  // surfaces showing whatever markup they were served with.
  paintSig: { programs: "", inspector: "", widgets: "", broadcast: "", alarm: null, actions: null },
};

/* WHICH entity a painted inspector signature describes — the kind and id that
   inspectorPaintSig writes first, with every data field after them dropped.

   render() saves the drawer's scrollTop before painting and puts it back after,
   which is right for a live repaint: an SSE snapshot landing must not yank an
   operator who is reading. It was also being applied across a SELECTION CHANGE,
   where it is wrong for the same reason it is right above — measured on the live
   board, switching from an agent scrolled 291px down left the next agent's panel
   at 291px with its <h2> 246px above the top of the pane, so the operator was
   looking at an unnamed drawer holding a live Send box.

   A reader rather than the decision itself: the module holds the data, and what
   to do about a changed entity stays with the code that owns the repaint. Kept
   here because `paintSig` is here, and reading the first two fields of that
   string is knowledge about this object's shape. */
export function paintedEntityKey(sig) {
  // "closed" and "" are not entities and must never compare equal to one.
  if (typeof sig !== "string" || !sig || sig === "closed") return null;
  const [kind, id] = sig.split("\u001f");
  return kind + "\u001f" + (id || "");
}
