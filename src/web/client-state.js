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
  /* One board, opened attention-first: the Needs-you strip is pinned at the top
     of it, so landing here is not "show me all routine work" — it is "show me
     what needs a human, with the rest of the fleet underneath it". */
  view: "board",
  query: "",
  facetProgram: "",
  /* The lenses, and every one of them is a SET.

     They were scalars — one provider, one lifecycle — which quietly made every
     axis a radio button: choosing "waiting" un-chose "working", so the one
     question an operator actually asks a board ("show me everything that is not
     making progress") could not be asked at all. Within an axis the members are
     a UNION (working OR waiting); across axes they still AND.

     Empty means the lens is OFF and everything passes. That is the same
     statement as "no filter", so there is no separate off-flag to keep in sync —
     and `.length` is the only truthiness test any reader should use, because
     [""] is a real one-member set (the model axis stores "no model reported" as
     the empty string).

     Session-scoped, all of them: they answer "what am I looking at right now",
     not "what should this board default to", so they do not persist and do not
     travel. */
  facetClasses: [],
  facetProviders: [],
  facetStatuses: [],
  facetModels: [],
  facetSpans: [],
  facetContexts: [],
  /* Which filter dropdown is open: "" | time | class | provider | status | model
     | span | context. One at a time, deliberately — two menus hanging off the same bar
     would overlap, and the operator has no way to tell which one a click is
     aimed at. Session-scoped like the lenses it opens: a menu left hanging is
     not a preference. */
  openFilterMenu: "",
  lookbackHours: DEFAULT_LOOKBACK_HOURS, // null = all collected
  // Review workers are still in the snapshot and History. Board hides the
  // repetitive, non-attention rows by default, with an explicit toggle to
  // bring them back into the operator's working view.
  showReviewWorkers: false,
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
  /* Agent homes the Settings → Collectors block lists. Fetched on panel open
     only, so a snapshot tick cannot rebuild the form under a checkbox. */
  collectorInstances: [],
  collectorInstancesPending: false,
  collectorImportNote: "",
  repoColorSettings: null,
  liveRepoKeys: [],
  /* The attention panel's disclosure state. A panel the operator opened stays
     open across the four-second repaint — closing it under them would make the
     board unreadable while anything is actually waiting. */
  notifyPanelOpen: false,
  /* The cleanup sweep's propose run and its result. `view` is the notification
     view documented in docs/CLEANUP-SWEEP.md — removables with rollback SHAs,
     refusals with reasons, and the confirm command the OPERATOR pastes. The
     board never executes it, so nothing here is ever a deletion, only a plan. */
  cleanup: { running: false, error: "", view: null, at: 0 },
  /* The Cleaner lane the chip is following, by session id. Everything the chip
     shows about it is DERIVED from that session in the snapshot — see
     cleaner.js — so nothing here is a state, only the binding and the one
     failure the board learned from the launch route itself. */
  cleaner: { sessionId: "", code: "", error: "", launching: false },
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
  /* Which context reading LEADS the header card — S3 inverted this control, so
     it now chooses the headline rather than which secondary reading got words.
     Average by default: it moves with every session, where a median can sit
     still while half the fleet climbs. Per-browser, like the lookback, because
     it is a display preference rather than a fact about the fleet. */
  contextSpread: "average",    // average | median
  /* Where alerting rows are drawn on the board: "pane" collects them in the
     Needs-you strip, "inline" leaves them in their program groups. Per-browser,
     same reasoning as contextSpread. */
  needsYouDisplay: "pane",     // pane | inline
  labels: new Map(),           // stable presentation target key -> label
  aliases: null,               // compatibility name for the existing program-alias seam
  labelsLoading: false,
  labelsLoaded: false,
  labelLoadError: "",
  renaming: null,              // presentation target key currently being edited
  widgetIds: [...DEFAULT_WIDGET_IDS], // own mutable copy; the catalog is frozen
  widgetCustomizerOpen: false,
  /* The masthead summary disclosure: false = the expanded health rail,
     true = the compact masthead face. Loaded from HEADER_COLLAPSED_STORAGE_KEY
     at boot; only an explicit toggle ever writes it — snapshots and viewport
     changes must never move it. */
  headerCollapsed: false,
  renameDraft: "",
  renamePending: false,
  renameError: "",
  /* SYNC-RF — the cmux workspace-rename editor. Separate from the presentation
     label state above because it writes another process through
     /api/sync/rename and can be refused; `wsRenaming` holds the workspace id
     being edited, never a presentation-label key. */
  wsRenaming: null,
  wsRenameDraft: "",
  wsRenamePending: false,
  wsRenameError: "",
  programOverrides: new Map(), // programId -> "open" | "closed"
  /* Which repositories the operator has folded up. Keyed by repoKey — the FNV
     of the git common dir, which is stable across every worktree of the repo
     and across a cmux restart — so the choice outlives the worktrees it was
     made over. Same shape and same failure handling as programOverrides, its
     own storage key (mtn3-repos). */
  repoOverrides: new Map(),  // repoKey -> "open" | "closed"
  /* Which swarms the operator has opened. Absent means CLOSED — a swarm's
     children are collapsed by default, so a ten-child verifier fan does not
     bury the nine other workstreams under it. Only "open" is ever stored, and
     it is stored per agent id so the choice survives a reload the same way
     programOverrides does (localStorage, mtn3-swarms). */
  swarmOverrides: new Map(), // parent agentId -> "open"
  /* Which worktrees' Finished shelves the operator has opened. Same shape and
     same default as swarmOverrides — collapsed is the default, so only "open"
     is ever stored — keyed by programId, its own key (mtn3-shelves). */
  shelfOverrides: new Map(), // programId -> "open"
  selectedId: null,
  selected: null,           // { kind: "agent"|"intervention"|"advisory"|…, id } — drives the drawer router
  drawerChatExpanded: true, // Chat tab: transcript expandable below Task
  /* data-fkey of whatever the operator was standing on when they opened the
     drawer, so closing it can put them back. closeInspector used to return focus
     via `agent-<selectedId>`, and selectedId is null for every kind that is not
     an agent — so closing a program or finding drawer destroyed the focused
     Close button and dropped a keyboard operator on <body>. */
  selectionOrigin: null,
  evidenceOpen: false,     // Narrow agent drawers show Evidence in place of Chat when selected.
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
  // every five seconds forever. The panel that listed it is gone; what reads it
  // now is the command dock's "last action" fact.
  actions: { loading: false, error: "", available: true, items: [], fetchedAt: 0 },
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
  /* SYNC-CF: the open close-escalation dialog, or null. Set only from a route
     refusal the client could fully read — { agentId, code, workspaceId,
     siblingAgents: [{id, name}] } — so the dialog can never name a workspace or
     a casualty list this board made up. */
  syncClose: null,
  pending: new Set(),     // `${agentId}:${action}`
  feedback: new Map(),    // agentId -> { ok, action, message }
  triage: new Map(),      // issueId -> recommendation
  triagePending: new Set(),
  triageErrors: new Map(),
  queueItems: [],
  /* An empty triage queue and an unreachable one produce the same zero queue
     findings, and the strip called that calm. This is what tells them apart. */
  queueError: "",
  // Paint signatures — skip wipe-and-rebuild when a surface's meaningful
  // content is unchanged across SSE snapshots (stops the 4s strobe).
  // `alarm` starts null, not "": its calm signature IS the empty string, so a ""
  // seed would make the very first paint a no-op and leave the surface showing
  // whatever markup it was served with.
  paintSig: { programs: "", inspector: "", widgets: "", alarm: null },
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
