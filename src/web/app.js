/* The Ant Hill v3 — operator console client.
   Consumes GET /api/snapshot + SSE /api/events, sends POST /api/control.
   No frameworks. All dynamic content is built via DOM APIs (no innerHTML with data).
   Pure helpers are exposed on globalThis.TheAntHill so tests can import this
   file directly; DOM wiring only runs when a document exists. */

import { $, el, icon, SVGNS, svgChild, svgMeter, svgRing, svgSegmentMeter, svgSparkline, svgTitle } from "./dom-primitives.js";
import { agoText, fmtElapsed, fmtTok, modelShort, providerLabel, PROVIDER_LABELS } from "./text-formatters.js";
import {
  ACTIVITY_LABELS, CONTROL_LABELS, DEFAULT_LOOKBACK_HOURS, DEFAULT_WIDGET_IDS,
  LOOKBACK_PRESETS, LOOKBACK_STORAGE_KEY, MODEL_POLICY_LABELS, OPS_VIEWS,
  OUTCOME_LABELS, USAGE_RANGE_PRESETS, VIEWS, WIDGET_CATALOG, WIDGET_IDS,
  WIDGET_STORAGE_KEY,
} from "./client-catalogs.js";

"use strict";

/* ---------- watch-only row mark ----------

   The Access column was dropped in 9d79c76 (instrument cluster) and left no
   sighted equivalent: control state survived only in the row aria-label, so an
   operator could not see which rows are watch-only without opening a drawer.
   This restores it as a dot, on the `source-mismatch-dot` precedent — a mark
   plus a title/aria sentence, never a column.

   A dot on EVERY row carries no information, so it is shown only where it
   changes what the operator can do:
     - quarantined       always. Ambiguous identity is a real, fixable problem.
     - observed-only     only when control could otherwise have worked: cmux is
                         reachable and the session has not ended.
   Suppressed when cmux is unreachable (the header already says controls are
   offline fleet-wide — per-row dots would just restate it on every row) and on
   ended sessions (a finished session is uncontrollable by definition, and
   deriveControlState reports every one of them as observed-only). */
function watchOnlyMark(control, activity, snap) {
  if (control === "quarantined") {
    return { key: "quarantined", label: "Controls quarantined", hint: CONTROL_HINTS.quarantined };
  }
  if (control !== "observed-only" || activity === "ended") return null;
  const health = snap && snap.controlHealth;
  if (!health || health.cmuxReachable !== true) return null;
  return { key: "observed", label: "Watch only", hint: CONTROL_HINTS["observed-only"] };
}
const CONTROL_HINTS = {
  linked: "This session is linked to an exact cmux target; controls route safely.",
  "observed-only": "This session is visible but has no safe control route; controls stay disabled.",
  quarantined: "Conflicting identity evidence — controls are quarantined until the target is unambiguous.",
};

/* Plain-language glossary. dtdd() looks up a row's term here and, when found,
   renders it with a dotted underline + explainer tooltip (hover or keyboard
   focus). Learn-style one-liners stay contextual — only fields that render. */
const LATEST_CALL_HINT = "Tokens for the latest model call only — not the cumulative session total.";
const SESSION_TOTAL_HINT = "Cumulative tokens for this whole session. Differs from “latest call,” which is only the most recent invocation.";
const READY_LINKED_HINT = "Ready · linked means Focus and Send have a safe cmux route to this session.";
const CWD_MISMATCH_HINT = "Session cwd ≠ pane folder: the provider session working directory disagrees with the cmux terminal pane folder (common when the process started in ~ and the shell later moved).";
const GLOSSARY = {
  // Operate
  "running for": "Wall-clock time since this agent started running.",
  "last update": "When this session last reported activity.",
  role: "Operator role assigned to this agent in the swarm (orchestrator, verifier, etc.).",
  model: "The model this agent is currently running on.",
  context: "How big the latest model call is against the model's context window.",
  // Evidence
  "session cwd": "The folder on disk the provider session reports as its working directory.",
  "terminal folder": CWD_MISMATCH_HINT,
  "session id": "The provider's own ID for this session, prefixed by the provider name.",
  git: "The branch and commit the agent's working copy is on; flags uncommitted changes.",
  "control link": "Which cmux terminal this session is wired to for Focus and Send, and how confidently it was matched.",
  "latest call": LATEST_CALL_HINT,
  "session total": SESSION_TOTAL_HINT,
  "Ready · linked": READY_LINKED_HINT,
};

/* Plain words for provider-native enums that used to render raw. */
const PROVENANCE_LABELS = { observed: "measured", estimated: "estimated", unknown: "unknown" };
const provenanceLabel = (p) => PROVENANCE_LABELS[p] || p || "unknown";
const RESOLUTION_LABELS = { exact: "exact match", "unique-cwd": "matched by folder", ambiguous: "ambiguous", missing: "no link" };

/* ---------- derivations (narrow fallbacks for the transitional schema) ----------
   The server now emits activity/outcome/controlState directly; when a snapshot
   predates those fields we derive them from the provider-native status only. */

function deriveActivity(agent) {
  if (agent.activity) return agent.activity;
  switch (agent.status) {
    case "running": return "working";
    case "waiting":
    case "attention": return "idle";
    case "stale":
    case "archived": return "ended";
    default: return "unknown";
  }
}

function deriveOutcome(agent) {
  if (agent.outcome) return agent.outcome;
  if (deriveActivity(agent) === "ended") return "healthy";
  return agent.status === "attention" ? "needs-you" : "healthy";
}

function deriveControlState(agent) {
  if (agent.controlState) return agent.controlState;
  if (deriveActivity(agent) === "ended") return "observed-only";
  const t = agent.target || {};
  if (t.surfaceId && (t.resolution === "exact" || t.resolution === "unique-cwd")) return "linked";
  return t.resolution === "ambiguous" ? "quarantined" : "observed-only";
}

/* ---------- process liveness (additive, absent-first) ----------

   A crashed agent and a cleanly finished one both simply stop, so "needs me"
   and "done" look identical. The backend now separates them and the field it
   emits is `processState`, carrying exactly "running" | "exited" | "died" |
   "unknown" (src/shared/types.ts). This client was written before that name was
   settled and read only `processLiveness` / `liveness`, so the whole feature
   rendered nothing against real snapshots; `processState` is read FIRST now and
   is the carrier of record. Verified against a live snapshot: 96 agents, 14
   `running`, 82 `unknown`.

   The absent-first rules are unchanged, because they are what makes this safe
   to ship ahead of, or behind, any emitter:

     - absent  -> null, and NOTHING new is rendered. The board looks exactly as
                  it does before the field exists. Absence is not evidence of
                  death.
     - present but a word we do not recognise -> "unknown". Guessing "died" from
       a vocabulary we do not own is the one mistake that would make this
       feature worse than not shipping it.

   `processLiveness` and `liveness` are kept as tolerated aliases (a bare string
   or an object with `state`/`status`), and the word vocabulary stays wide —
   including the `process-alive` / `process-gone` / `no-evidence` spelling the
   collector lane proposed. Dropping them would buy nothing and would re-open the
   exact failure this comment records. */
const LIVENESS_WORDS = {
  running: "running", alive: "running", live: "running", "process-alive": "running",
  up: "running", active: "running",
  exited: "exited", "exited-clean": "exited", "clean-exit": "exited", clean: "exited",
  finished: "exited", completed: "exited", complete: "exited", done: "exited",
  died: "died", dead: "died", "process-gone": "died", gone: "died", crashed: "died",
  killed: "died", terminated: "died",
  unknown: "unknown", "no-evidence": "unknown", unclear: "unknown", indeterminate: "unknown",
};

const LIVENESS_VIEW = {
  running: { label: "Process live", tone: "ok", detail: "The agent's process is still running." },
  exited: { label: "Exited cleanly", tone: "calm", detail: "The process finished and its transcript ended cleanly — this one is done." },
  died: { label: "Died", tone: "alert", detail: "The process is gone and nothing ended cleanly. This session stopped without finishing." },
  /* "Liveness unknown" named the tool's gap rather than the world's state, and
     read as a defect. For an agent still on the board, unknown means the prober
     has not reported yet — ordinary and temporary, so say that. */
  unknown: { label: "Awaiting first check", tone: "quiet", detail: "No process check has reported for this session yet." },
};

/* The same wire value on an ENDED session is a different fact: nothing is going
   to check it, so "awaiting" would send the operator off to wait for something
   that is never coming. On the live board this is not an edge case — 135 of the
   140 unknowns are ended sessions. */
const LIVENESS_ENDED_UNKNOWN = {
  label: "No process evidence",
  tone: "quiet",
  detail: "This session ended without process evidence, so whether it finished cleanly or crashed cannot be recovered.",
};

function livenessState(agent) {
  // `processState` first: it is the field the server actually emits, so an
  // agent that carries both must be read off the real one.
  const raw = agent && agent.processState != null ? agent.processState
    : agent && agent.processLiveness != null ? agent.processLiveness
      : agent && agent.liveness != null ? agent.liveness
        : null;
  if (raw == null) return null;
  const word = typeof raw === "string"
    ? raw
    : typeof raw === "object" && raw
      ? (typeof raw.state === "string" ? raw.state : typeof raw.status === "string" ? raw.status : null)
      : null;
  if (typeof word !== "string" || !word.trim()) return "unknown";
  return LIVENESS_WORDS[word.trim().toLowerCase()] || "unknown";
}

/* Null when the field is absent — every call site treats null as "render
   nothing", which is what keeps an old snapshot looking exactly like today. */
function livenessView(agent) {
  const key = livenessState(agent);
  if (!key) return null;
  // Same wire value, two different facts — see LIVENESS_ENDED_UNKNOWN. The key
  // is untouched, so the chip's styling and every existing selector still match.
  if (key === "unknown" && deriveActivity(agent) === "ended") {
    return { key, ...LIVENESS_ENDED_UNKNOWN };
  }
  return { key, ...LIVENESS_VIEW[key] };
}

/* Is this agent asking for a human RIGHT NOW — the single verdict the "now" and
   Alerts views, the program expander and the notifier all read, so they can
   never disagree about the same agent.

   `activity: "ended"` means the transcript stopped, NOT that the process is
   gone. A live snapshot carried two sessions reading ended while processState
   was still "running" and status was "attention" — genuinely waiting on a
   person, yet absent from every default view.

   The liveness check is what keeps this honest in the other direction. Letting
   any ended-and-unhealthy agent alert would resurrect stale verdicts from
   archived sessions and flood Now with finished failures. So an ended agent
   alerts only on POSITIVE evidence its process is still there; absent or
   unknown liveness stays in History, which is the absent-first rule the
   liveness block above already commits to. */
function alerting(agent) {
  if (deriveOutcome(agent) === "healthy") return false;
  if (deriveActivity(agent) !== "ended") return true;
  return livenessState(agent) === "running";
}

function deriveRollup(agents) {
  const act = (a) => deriveActivity(a);
  const out = (a) => deriveOutcome(a);
  return {
    total: agents.length,
    live: agents.filter((a) => act(a) === "working" || act(a) === "idle").length,
    working: agents.filter((a) => act(a) === "working").length,
    idle: agents.filter((a) => act(a) === "idle").length,
    ended: agents.filter((a) => act(a) === "ended").length,
    needsYou: agents.filter((a) => out(a) !== "healthy" && act(a) !== "ended").length,
    blocked: agents.filter((a) => out(a) === "blocked").length,
    failed: agents.filter((a) => out(a) === "failed").length,
    linked: agents.filter((a) => deriveControlState(a) === "linked").length,
  };
}

const programRollup = (program) => program.rollup || deriveRollup(program.agents);

/* At-a-glance rollup cells — the ONE aggregation source shared by the program
   drawer head (programRollupLine) and the left-tree program header
   (programHeadRollup). Counts are always client-derivable, so they always
   render; the token aggregate is omitted honestly when no agent reports a
   session total (never faked). Alert cells flag themselves for ink gating. */
function programRollupCells(agents) {
  const r = deriveRollup(agents);
  const cells = [
    { value: String(agents.length), label: agents.length === 1 ? "agent" : "agents" },
    { value: String(r.working), label: "working" },
    { value: String(r.needsYou), label: r.needsYou === 1 ? "alert" : "alerts", alert: r.needsYou > 0 },
  ];
  const withTokens = agents.filter((a) => a.tokens && typeof a.tokens.sessionTotal === "number");
  if (withTokens.length) {
    const total = withTokens.reduce((sum, a) => sum + a.tokens.sessionTotal, 0);
    // key "tokens" lets the header rollup drop this cell first on narrow screens
    // (it is the least critical; the alerts cell is never dropped).
    cells.push({ value: fmtTok(total), label: "tokens", key: "tokens" });
  }
  return cells;
}

/* Plain-language control explanation for the Operate chrome. Never echoes
   capability reasons here — live reasons carry raw cmux/session IDs, which
   belong only in Evidence. */
function controlUnavailableText(controlState) {
  return controlState === "quarantined"
    ? "Controls are unavailable — this session's identity is ambiguous, so control routing is quarantined."
    : "Controls are unavailable — no safe cmux target is linked to this session.";
}

/* ---------- identity resolution: why a session is quarantined ----------
   The server ships `identityTrace` on every agent in the snapshot (it is only
   stripped from the SSE change-fingerprint, never from the payload), plus a
   read-only GET /api/debug/identity?agent=<id> that joins that trace to the
   ps/lsof evidence of every related terminal. Both were being discarded by the
   renderer, so the one failure mode that disables Focus and Send at scale
   surfaced as a fixed sentence with no reason and no way forward. */

const IDENTITY_TIER_LABELS = {
  recorded: "Recorded target",
  session: "Session ID on a terminal",
  cwd: "Working folder",
};
const IDENTITY_OUTCOME_LABELS = {
  matched: "matched",
  quarantined: "quarantined",
  ambiguous: "ambiguous",
  "no-match": "no match",
  skipped: "skipped",
  rejected: "rejected",
};
/* Why routing refused, and what the operator can actually DO about it — one
   entry per shape the resolver produces. Deliberately ID-free: the banner is
   Operate chrome and the established rule (controlUnavailableText, and the test
   that pins it) is that raw cmux/session identifiers belong only in Evidence.
   The specific "ttys082 has both of these open" answer is one click away in the
   routing-evidence block, not in the banner. */
const IDENTITY_CAUSES = {
  "contested-terminal": {
    why: "More than one session claims the same terminal, so there is no unambiguous target to type into.",
    next: "End or close one of the sessions sharing that terminal — controls re-arm on the next scan, no restart needed.",
  },
  "shared-folder": {
    why: "This session is not registered on any terminal, and more than one session shares its working folder — so matching by folder cannot pick one.",
    next: "Give this session its own cmux pane, or end the other session running in that folder; the next scan then binds it.",
  },
  missing: {
    why: "No cmux terminal reports this session, so there is nothing to route Focus or Send to.",
    next: "Open it in a cmux pane (or start the agent from one) and the next scan binds it.",
  },
};

/* Normalized, render-ready view of one agent's identity trace. Pure. */
function identityTraceView(agent) {
  const trace = (agent && agent.identityTrace) || null;
  const target = (agent && agent.target) || {};
  const rawSteps = trace && Array.isArray(trace.steps) ? trace.steps : [];
  return {
    resolution: (trace && trace.resolution) || target.resolution || "missing",
    matchedTier: (trace && trace.matchedTier) || null,
    reason: (trace && trace.reason) || null,
    surfaceId: (trace && trace.surfaceId) || target.surfaceId || null,
    bridge: (trace && trace.bindingBridge) || null,
    steps: rawSteps.map((step) => ({
      tier: step.tier,
      tierLabel: IDENTITY_TIER_LABELS[step.tier] || step.tier,
      outcome: step.outcome,
      outcomeLabel: IDENTITY_OUTCOME_LABELS[step.outcome] || step.outcome,
      detail: step.detail || "",
    })),
  };
}

/* Which of the three real refusal shapes this is. Read off the tier that
   actually refused, not off the resolution alone: every quarantine resolves as
   "ambiguous", but a terminal contested by two sessions and a folder shared by
   two sessions need different instructions. (Measured against the live board:
   9 quarantined sessions, all `ambiguous`, all refused at the cwd tier.) */
function identityCause(view) {
  const refused = (tier) => view.steps.some((step) =>
    step.tier === tier && (step.outcome === "quarantined" || step.outcome === "ambiguous"));
  if (refused("session")) return "contested-terminal";
  if (refused("cwd")) return "shared-folder";
  return "missing";
}

/* The banner's whole story: what happened, why, and what to do about it.
   Returns null when controls route normally. Pure. */
function quarantineBrief(agent, control = deriveControlState(agent)) {
  if (control === "linked") return null;
  const view = identityTraceView(agent);
  const cause = identityCause(view);
  return {
    title: control === "quarantined" ? "Control routing locked." : "Controls unavailable.",
    summary: controlUnavailableText(control),
    why: IDENTITY_CAUSES[cause].why,
    nextStep: IDENTITY_CAUSES[cause].next,
    cause,
    steps: view.steps,
  };
}

/* Short form of a provider session id — long enough to tell two sessions on
   one terminal apart, short enough to read in a sentence. */
function shortSessionId(id) {
  const text = String(id || "");
  return text.length > 10 ? text.slice(0, 8) + "…" : text;
}

/* GET /api/debug/identity?agent=<id> → the sentence the operator needs: which
   terminal, and which sessions are fighting over it. The pids/commands/open
   files live only on CmuxSurface, which the snapshot does not carry, so this is
   the one piece of evidence that has to be fetched on demand. Pure. */
function surfaceCollisions(payload) {
  const surfaces = (payload && Array.isArray(payload.relatedSurfaces)) ? payload.relatedSurfaces : [];
  return surfaces.map((surface) => {
    const trace = surface.identityTrace || {};
    const commandByPid = new Map((trace.processes || []).map((proc) => [proc.pid, proc.command]));
    const claims = [];
    const seen = new Set();
    for (const match of trace.openFileMatches || []) {
      const key = match.provider + ":" + match.sessionId;
      if (seen.has(key)) continue;
      seen.add(key);
      claims.push({
        provider: match.provider,
        sessionId: match.sessionId,
        pid: match.pid,
        command: commandByPid.get(match.pid) || "",
      });
    }
    return {
      surfaceId: surface.surfaceId,
      tty: surface.tty || "",
      conflict: surface.identityConflict || trace.identityConflict || "",
      claims,
    };
  });
}

function collisionClaimText(claim) {
  const who = (PROVIDER_LABELS[claim.provider] || claim.provider) + " " + shortSessionId(claim.sessionId);
  if (!claim.pid) return who;
  return who + " (pid " + claim.pid + (claim.command ? ", " + conciseText(claim.command, 40) : "") + ")";
}

function collisionLine(collision) {
  const where = collision.tty || collision.surfaceId || "this terminal";
  if (!collision.claims.length) return where + " — no open agent session files observed.";
  if (collision.claims.length === 1) return where + " — one session open: " + collisionClaimText(collision.claims[0]);
  return where + " — " + collision.claims.length + " sessions claim it: "
    + collision.claims.map(collisionClaimText).join(" · ");
}

function conciseText(value, limit = 88) {
  const text = String(value || "").split("\n")[0].replace(/^(goal:|you are)\s*/i, "").trim();
  if (text.length <= limit) return text;
  const clipped = text.slice(0, limit - 1);
  const boundary = clipped.lastIndexOf(" ");
  return clipped.slice(0, boundary > limit * 0.65 ? boundary : clipped.length).trimEnd() + "…";
}

const NO_READABLE_MESSAGE = "No readable message yet";

function formatLastHumanMessage(agent, limit = 120) {
  const message = typeof agent?.lastHumanMessage === "string" ? agent.lastHumanMessage.trim() : "";
  return message ? conciseText(message, limit) : NO_READABLE_MESSAGE;
}

/* Short folder/Home identity for when cmux titles are unavailable. */
function cwdIdentityName(agent) {
  if (!agent || typeof agent.cwd !== "string" || !agent.cwd.trim()) return "";
  const normalized = agent.cwd.replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  const provider = providerLabel(agent.provider);
  if (parts.length <= 2 && (parts[0] === "Users" || parts[0] === "home")) {
    return provider + " · Home";
  }
  const base = parts[parts.length - 1];
  return base ? provider + " · " + base : provider + " · Home";
}

function sourceAgentName(agent) {
  if (!agent) return "";
  if (agent.nickname) return conciseText(agent.nickname);
  const identity = cwdIdentityName(agent);
  const display = typeof agent.displayName === "string" ? agent.displayName.trim() : "";
  // Keep short provider·folder identities; replace prompt-as-title blobs.
  const shortIdentity = display.length > 0 && display.length <= 56 && display.includes("·");
  if (shortIdentity) return conciseText(display);
  if (identity) return conciseText(identity);
  return conciseText(display || agent.task || providerLabel(agent.provider) + " agent");
}

function presentationLabelKey(target) {
  if (!target) return "";
  if (target.kind === "program") return "program:" + target.programId;
  if (target.kind === "workspace") return "workspace:" + target.workspaceId;
  if (target.kind === "room") return "room:" + target.surfaceId;
  if (target.kind === "agent") return "agent:" + target.agentId;
  return "";
}

const programLabelTarget = (program) => ({ kind: "program", programId: program.id });
const workspaceLabelTarget = (workspaceId) => ({ kind: "workspace", workspaceId });
const roomLabelTarget = (surfaceId) => ({ kind: "room", surfaceId });
const agentLabelTarget = (agent) => ({ kind: "agent", agentId: agent.id });
/* Every live agent can take a presentation label. Prefer editing the linked
   cmux workspace when present so Ant Hill names stay hunt-able in the wild. */
const agentLabelEligible = (agent) => Boolean(agent && agent.id);

/* Live cmux / terminal title for this session, when routing knows one. */
function terminalSourceName(agent) {
  const title = agent && agent.target && typeof agent.target.workspaceTitle === "string"
    ? agent.target.workspaceTitle.trim()
    : "";
  return title ? conciseText(title) : "";
}

/* Human-readable terminal destination for a LINKED pane, built only from fields
   the client target actually carries: the workspace/terminal title and the live
   pane cwd (surfaceCwd). Only exact / unique-cwd links resolve a safe target, so
   ambiguous / missing / ended-observed rows return null and stay silent. Note:
   the client target exposes no discrete "surface title" — the pane's folder (the
   tail of surfaceCwd) is the closest identity we can honestly show. */
function terminalIdentity(agent) {
  const t = agent && agent.target;
  if (!t || (t.resolution !== "exact" && t.resolution !== "unique-cwd")) return null;
  const title = typeof t.workspaceTitle === "string" ? conciseText(t.workspaceTitle.trim(), 40) : "";
  const paneCwd = typeof t.surfaceCwd === "string" ? t.surfaceCwd.trim() : "";
  const parts = paneCwd.replace(/\/+$/, "").split("/").filter(Boolean);
  const paneFolder = parts.length ? parts[parts.length - 1] : "";
  if (!title && !paneCwd) return null;
  return { title, paneCwd, paneFolder };
}

/* Compact terminal breadcrumb for the row identity tags: workspace title · pane
   folder, with any segment that merely repeats the display name dropped (the
   name often already IS the terminal title). Returns "" when nothing new
   survives, so the tag never echoes the name back at the operator. */
function terminalBreadcrumb(agent, displayName) {
  const id = terminalIdentity(agent);
  if (!id) return "";
  const name = String(displayName || "").trim().toLowerCase();
  const seen = new Set();
  const parts = [];
  for (const seg of [id.title, id.paneFolder]) {
    const key = seg.toLowerCase();
    if (!seg || key === name || seen.has(key)) continue;
    seen.add(key);
    parts.push(seg);
  }
  return parts.join(" · ");
}

/* Focus jumps to the linked pane — preview WHERE it lands (terminal title + pane
   cwd) so the operator sees the destination before clicking. Falls back to the
   generic label when no destination resolves. */
function focusDestinationHint(agent) {
  const id = terminalIdentity(agent);
  if (!id) return "Jump to terminal pane";
  const dest = [id.title, id.paneCwd].filter(Boolean).join(" · ");
  return dest ? "Jump to " + dest : "Jump to terminal pane";
}

/* Rename target: workspace first (shared terminal identity), else the agent. */
function preferredRenameTarget(agent) {
  if (agent && agent.target && agent.target.workspaceId) {
    return workspaceLabelTarget(agent.target.workspaceId);
  }
  return agentLabelTarget(agent);
}

function agentName(agent) {
  if (!agent) return "";
  const agentLabel = state.aliases.get(presentationLabelKey(agentLabelTarget(agent)));
  if (agentLabel) return agentLabel;
  if (agent.target && agent.target.workspaceId) {
    const workspaceLabel = state.aliases.get(presentationLabelKey(workspaceLabelTarget(agent.target.workspaceId)));
    if (workspaceLabel) return workspaceLabel;
  }
  // Prefer the cmux terminal title only when the session cwd agrees with the
  // pane. A home-cwd orch parked in a project-titled workspace must stay
  // "Codex · Home" — not borrow the workspace name.
  const terminal = terminalSourceName(agent);
  if (terminal && !agent.target?.cwdMismatch) return terminal;
  return sourceAgentName(agent);
}

/* Presentation-only labels. Source identities stay stable; the label is a
   display value the operator controls. */
function programName(program) {
  const alias = program && state.aliases.get(presentationLabelKey(programLabelTarget(program)));
  return alias || (program ? program.name : "");
}

function snapshotAgents(snap) {
  if (!snap) return [];
  return snap.programs.flatMap((p) => p.agents.map((agent) => ({ agent, program: p })));
}

function totalsOf(snap) {
  const t = (snap && snap.totals) || {};
  const agents = snapshotAgents(snap).map((x) => x.agent);
  const count = (pred) => agents.filter(pred).length;
  return {
    working: t.working ?? count((a) => deriveActivity(a) === "working"),
    idle: t.idle ?? count((a) => deriveActivity(a) === "idle"),
    history: t.history ?? count((a) => deriveActivity(a) === "ended"),
    live: t.live ?? count((a) => deriveActivity(a) === "working" || deriveActivity(a) === "idle"),
    tracked: t.tracked ?? agents.length,
    needsYouAgents: count((a) => deriveActivity(a) !== "ended" && deriveOutcome(a) !== "healthy"),
    tokens: t.tokens,
    tokenMedian: t.tokenMedian,
    tokenReporting: t.tokenReporting,
    tokenEligible: t.tokenEligible,
    cursorModelHealth: t.cursorModelHealth,
    sourceHealth: t.sourceHealth,
  };
}

function issuesOf(snap) {
  if (!snap) return [];
  if (Array.isArray(snap.issues)) return snap.issues;
  // Narrow fallback for snapshots that predate normalized issues.
  const issues = [];
  const errors = (snap.controlHealth && snap.controlHealth.errors) || [];
  if (errors.length) {
    issues.push({
      id: "system:collector-errors",
      kind: "system",
      severity: "warning",
      title: "Collection problems",
      summary: `${errors.length} collector problem${errors.length === 1 ? "" : "s"} may make session data incomplete.`,
      affectedAgentIds: [],
      technicalDetails: [...errors],
    });
  }
  for (const { agent } of snapshotAgents(snap)) {
    const live = deriveActivity(agent) !== "ended";
    const outcome = deriveOutcome(agent);
    if (live && outcome !== "healthy") {
      issues.push({
        id: "agent:" + agent.id,
        kind: "agent",
        severity: outcome === "failed" ? "error" : "warning",
        title: outcome === "failed" ? `${agentName(agent)} failed` : `${agentName(agent)} needs review`,
        summary: agent.statusReason,
        affectedAgentIds: [agent.id],
      });
    }
    const policy = modelPolicyView(agent);
    if (live && policy && policy.state === "mismatch") {
      issues.push({
        id: "policy:" + agent.id,
        kind: "policy",
        severity: "error",
        title: `${agentName(agent)} is running a non-approved model`,
        summary: policy.summary + (policy.expected ? ` Expected: ${policy.expected}.` : ""),
        affectedAgentIds: [agent.id],
      });
    }
  }
  return issues;
}

/* ---------- views, search, facets ---------- */

function viewMatches(view, agent) {
  const act = deriveActivity(agent);
  const out = deriveOutcome(agent);
  switch (view) {
    // Both read the shared alerting() verdict, so Now and Alerts can never
    // disagree about whether a given agent is waiting on a person.
    case "now": return act === "working" || alerting(agent);
    case "needs-you": return alerting(agent);
    case "working": return act === "working";
    case "idle": return act === "idle";
    case "history": return act === "ended";
    case "usage": return false;
    default: return true;
  }
}

function parseLookbackHours(raw) {
  if (raw == null || raw === "" || raw === "all") return null;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) return DEFAULT_LOOKBACK_HOURS;
  return Math.min(24 * 30, Math.max(1, Math.round(hours)));
}

function withinLookback(agent, lookbackHours, nowMs = Date.now()) {
  if (lookbackHours == null) return true;
  const updated = Date.parse(agent.updatedAt);
  if (!Number.isFinite(updated)) return false;
  return nowMs - updated <= lookbackHours * 3_600_000;
}

function lookbackApplies(view) {
  return view === "idle" || view === "history";
}

const ROW_STALE_AFTER_MS = 10 * 60_000;
/* A running / waiting row whose last update is older than 10 minutes earns a
   dim "updated Nm ago" fact — a quiet nudge that a live-looking session has gone
   quiet. Fresh rows and ended rows return "" and render exactly as before.
   nowMs is injectable so the threshold is testable without wall-clock flake. */
function rowStalenessText(agent, nowMs = Date.now()) {
  const act = deriveActivity(agent);
  if (act !== "working" && act !== "idle") return "";
  const updated = Date.parse(agent && agent.updatedAt);
  if (!Number.isFinite(updated)) return "";
  const ageMs = nowMs - updated;
  if (ageMs < ROW_STALE_AFTER_MS) return "";
  return "updated " + fmtElapsed(ageMs) + " ago";
}

function lookbackLabel(hours) {
  if (hours == null) return "all collected";
  return hours + "h";
}

function matchesQuery(agent, program, query) {
  if (!query) return true;
  const hay = [
    agent.displayName, agent.nickname, agent.task, agent.cwd, agent.model,
    agent.provider, agent.role, agent.sourceSessionId, agent.statusReason,
    agent.transcriptTail, agent.status,
    ACTIVITY_LABELS[deriveActivity(agent)], OUTCOME_LABELS[deriveOutcome(agent)],
    program && program.name, program && programName(program),
  ].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(query);
}

function buildClusters(agents) {
  const ids = new Set(agents.map((a) => a.id));
  const children = new Map();
  const roots = [];
  for (const a of agents) {
    if (a.parentAgentId && ids.has(a.parentAgentId)) {
      const list = children.get(a.parentAgentId) || [];
      list.push(a);
      children.set(a.parentAgentId, list);
    } else {
      roots.push(a);
    }
  }
  return { roots, children };
}

/* ---------- token honesty ----------
   When tokens.scope === "latest-turn", total/input/output/cachedInput describe
   the latest invocation — that is the primary number everywhere, labeled as
   such. Cumulative session usage (tokens.sessionTotal) belongs in Evidence.
   Dense list widgets may still say "not reported"; the agent drawer omits
   empty fields entirely (Take C). */

function tokenSummary(tokens) {
  const label = tokens && tokens.scope === "latest-turn" ? "latest call" : "tokens";
  if (!tokens || (tokens.total == null && tokens.input == null && tokens.output == null && tokens.cachedInput == null)) {
    const provenance = tokens ? tokens.provenance : "unknown";
    return {
      label,
      text: "not reported",
      known: false,
      title: "This source does not report token usage locally (provenance: " + provenance + ")",
    };
  }
  const marks = { observed: "", estimated: "≈", unknown: "" };
  const parts = [];
  if (tokens.input != null) parts.push("in " + fmtTok(tokens.input));
  if (tokens.output != null) parts.push("out " + fmtTok(tokens.output));
  if (tokens.cachedInput != null) parts.push("cache " + fmtTok(tokens.cachedInput));
  const scopeNote = tokens.scope === "latest-turn" ? "latest model call · " : "";
  const title = scopeNote + (parts.length ? parts.join(" · ") + " · " : "") + "provenance: " + tokens.provenance;
  const text = tokens.total != null
    ? marks[tokens.provenance] + fmtTok(tokens.total) + " tokens"
    : marks[tokens.provenance] + parts.join(" · ");
  return { label, text, known: true, title };
}

function contextUsage(tokens) {
  if (!tokens || tokens.scope !== "latest-turn" || tokens.provenance !== "observed" ||
      !Number.isFinite(tokens.total) || !Number.isFinite(tokens.contextWindow) || !(tokens.contextWindow > 0)) return null;
  const rawPct = Math.max(0, Math.round((tokens.total / tokens.contextWindow) * 100));
  return { pct: Math.min(100, rawPct), text: fmtTok(tokens.total) + " of " + fmtTok(tokens.contextWindow) + " (" + rawPct + "%)" };
}

const CONTEXT_DISPLAY_LABELS = { percent: "Context %", tokens: "Context tokens" };

function contextDisplayLabel() {
  return CONTEXT_DISPLAY_LABELS[state.contextDisplay] || CONTEXT_DISPLAY_LABELS.percent;
}

// Claude transcripts carry observed token totals but no context-window size, so
// a truthful "% used" is impossible (a fabricated denominator would misreport
// 1M-context sessions ~5x). When the window is unknown but we have an observed
// total, show the absolute token count instead of "not reported".
function hasObservedTotal(tokens) {
  return Boolean(tokens && Number.isFinite(tokens.total) && tokens.total > 0);
}

function contextDisplayValue(tokens, display = state.contextDisplay) {
  const usage = contextUsage(tokens);
  if (usage) {
    return display === "tokens"
      ? fmtTok(tokens.total) + " / " + fmtTok(tokens.contextWindow)
      : usage.pct + "%";
  }
  if (hasObservedTotal(tokens)) return fmtTok(tokens.total) + " tokens";
  return "not reported";
}

const ROLE_LABELS = {
  orchestrator: "Orchestrator",
  frontend: "Frontend / designer",
  backend: "Backend implementer",
  verifier: "Verifier",
  tester: "Tester",
  automation: "Automation",
  agent: "Agent",
};

const ROLE_ALIASES = {
  orchestrator: "orchestrator",
  orchestration: "orchestrator",
  coordinator: "orchestrator",
  "swarm owner": "orchestrator",
  frontend: "frontend",
  "front end": "frontend",
  designer: "frontend",
  design: "frontend",
  ui: "frontend",
  ux: "frontend",
  "frontend / designer": "frontend",
  backend: "backend",
  "back end": "backend",
  server: "backend",
  engine: "backend",
  implementer: "backend",
  "backend implementer": "backend",
  verifier: "verifier",
  reviewer: "verifier",
  auditor: "verifier",
  gatekeeper: "verifier",
  validator: "verifier",
  tester: "tester",
  testing: "tester",
  test: "tester",
  qa: "tester",
  "test lane": "tester",
  automation: "automation",
  autopilot: "automation",
  automated: "automation",
};

function roleView(role) {
  const normalized = String(role || "agent")
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s+/g, " ");
  const key = ROLE_ALIASES[normalized] || ROLE_LABELS[normalized] ? normalized : "agent";
  const canonical = ROLE_ALIASES[key] || (ROLE_LABELS[key] ? key : "agent");
  return { key: canonical, label: ROLE_LABELS[canonical] };
}

/* Header "Typical request": prefer the server-computed median; otherwise a
   narrow fallback — the median of live latest-invocation totals we can see. */
function typicalRequestOf(snap) {
  if (!snap) return null;
  const t = snap.totals || {};
  if (t.tokenMedian != null) return { value: t.tokenMedian, source: "reported" };
  const totals = snapshotAgents(snap)
    .map(({ agent }) => agent)
    .filter((a) => deriveActivity(a) !== "ended" && a.tokens &&
      a.tokens.scope === "latest-turn" && a.tokens.total != null)
    .map((a) => a.tokens.total)
    .sort((x, y) => x - y);
  if (!totals.length) return null;
  const mid = Math.floor(totals.length / 2);
  const value = totals.length % 2 ? totals[mid] : Math.round((totals[mid - 1] + totals[mid]) / 2);
  return { value, source: "derived" };
}

/* ---------- Cursor model policy ----------
   Missing evidence is neither compliant nor a mismatch — it stays unreported. */

/* Fleet-level Cursor policy glance from totals.cursorModelHealth.
   Only mismatches read as alarms; unreported stays quiet but visible. */
function cursorPolicyParts(health) {
  if (!health || health.total == null || !health.total) return null;
  const n = (v) => v == null ? 0 : v;
  const mismatch = n(health.mismatch ?? health.violation);
  const unreported = n(health.unreported ?? health.unverified);
  return [
    {
      text: mismatch + " mismatch" + (mismatch === 1 ? "" : "es"),
      tone: mismatch > 0 ? "bad" : "ok",
    },
    { text: n(health.compliant) + " compliant", tone: "plain" },
    { text: unreported + " unreported", tone: "muted" },
  ];
}

function modelPolicyView(agent) {
  const p = agent.modelPolicy;
  if (!p || !MODEL_POLICY_LABELS[p.state]) return null;
  // Never name this `state` — the module-level app-state singleton is what the
  // rest of this file means by that identifier, and shadowing it here is a trap
  // for the next edit that reaches for state.contextDisplay or state.aliases.
  const policyState = p.state === "violation" ? "mismatch" : p.state === "unverified" ? "unreported" : p.state;
  return {
    state: policyState,
    label: MODEL_POLICY_LABELS[p.state],
    expected: p.expected || null,
    summary: p.summary || (
      policyState === "mismatch" ? "The reported model is outside the approved model policy."
      : p.state === "compliant" ? "The reported model matches the approved model policy."
      : "The model is unavailable, so policy compliance cannot be verified."),
  };
}

/* ---------- shared elapsed-clock helpers ---------- */

function elapsedDataset(agent, generatedAt) {
  const live = deriveActivity(agent) !== "ended" && agent.elapsedMs != null && generatedAt;
  return live
    ? { elapsedBase: String(agent.elapsedMs), elapsedFrom: generatedAt }
    : {};
}

function liveElapsedText(agent, generatedAt) {
  if (agent.elapsedMs == null) return "—";
  if (deriveActivity(agent) !== "ended" && generatedAt) {
    const drift = Date.now() - Date.parse(generatedAt);
    if (Number.isFinite(drift) && drift > 0) return fmtElapsed(agent.elapsedMs + drift);
  }
  return fmtElapsed(agent.elapsedMs);
}

/* ---------- summary widgets ---------- */

function defaultWidgetIds() {
  return [...DEFAULT_WIDGET_IDS];
}

function normalizeWidgetIds(ids) {
  if (!Array.isArray(ids) || !ids.length) return defaultWidgetIds();
  const unique = new Set(ids);
  if (ids[0] !== "needs-you" || unique.size !== ids.length || ids.some((id) => typeof id !== "string" || !WIDGET_IDS.has(id))) {
    return defaultWidgetIds();
  }
  return [...ids];
}

function parseWidgetPreference(raw) {
  if (typeof raw !== "string" || !raw) return defaultWidgetIds();
  try { return normalizeWidgetIds(JSON.parse(raw)); } catch { return defaultWidgetIds(); }
}

function reorderWidgetIds(ids, id, direction) {
  const ordered = normalizeWidgetIds(ids);
  const index = ordered.indexOf(id);
  const target = index + direction;
  if (index <= 0 || !Number.isInteger(direction) || target <= 0 || target >= ordered.length) return ordered;
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  return ordered;
}

function systemStatus(snap, conn = "live", fetchFailed = state.fetchFailed) {
  if (!snap || conn === "offline") return { key: "offline", label: "Offline", tone: "offline" };
  const control = snap.controlHealth;
  const source = snap.totals && snap.totals.sourceHealth;
  const sourceDegraded = source && source.total > 0 && (source.degraded > 0 || source.healthy < source.total);
  const controlDegraded = !control || control.cmuxReachable !== true || control.errors?.length > 0 || control.staleSources?.length > 0;
  const feedDegraded = conn !== "live";
  // A snapshot poll that failed while a snapshot is already on screen used to be
  // swallowed into a console.warn and a flag nobody read, leaving stale numbers
  // looking authoritative. Degrade the verdict so the Refresh affordance appears.
  if (sourceDegraded || controlDegraded || feedDegraded || fetchFailed) return { key: "degraded", label: "Degraded", tone: "degraded" };
  return { key: "operational", label: "Operational", tone: "ok" };
}

/* "Degraded" answers WHETHER something is wrong and never the only question an
   operator actually has: am I blocked, or is this cosmetic? Those are wildly
   different — cmux unreachable means Focus and Send are dead and no amount of
   waiting helps, while 15 identity-conflict warnings mean the board is fully
   usable and someone should tidy up later. Both rendered the same word.

   Three classes, most severe first. Returns null when nothing is wrong, so the
   Operational card is untouched. */
const DEGRADED_SEVERITY = {
  blocking: { key: "blocking", label: "Blocking", detail: "Operator actions are unavailable." },
  stale: { key: "stale", label: "Stale", detail: "Numbers on screen may no longer be true." },
  advisory: { key: "advisory", label: "Advisory", detail: "The board is usable; evidence needs tidying." },
};

function degradedSeverity(snap, conn = "live", fetchFailed = state.fetchFailed) {
  if (systemStatus(snap, conn, fetchFailed).key === "operational") return null;
  const control = snap && snap.controlHealth;
  // Blocking: the control plane is gone, so Focus/Send cannot route at all.
  // This is the one state where waiting does not help.
  if (!snap || conn === "offline" || !control || control.cmuxReachable !== true) {
    return { ...DEGRADED_SEVERITY.blocking, detail: !snap || conn === "offline"
      ? "No snapshot connection — the board is not live."
      : "cmux unreachable — Focus and Send cannot route." };
  }
  // Stale: controls work, but the numbers being read may be out of date. Wrong
  // data an operator trusts is worse than data it knows to distrust.
  if (conn !== "live" || fetchFailed) {
    return { ...DEGRADED_SEVERITY.stale, detail: fetchFailed
      ? "Last refresh failed — showing the previous good snapshot."
      : "Live snapshot feed is not healthy." };
  }
  // Advisory: everything an operator does still works.
  return DEGRADED_SEVERITY.advisory;
}

function attentionSummary(snap) {
  if (!snap) return null;
  const findings = issuesOf(snap);
  return {
    count: findings.length,
    interventions: findings.filter((issue) => issue.severity === "error").length,
    advisories: findings.filter((issue) => issue.severity !== "error").length,
  };
}

/* The named reason behind a Degraded verdict: the most severe live finding, so
   the summary can say what is wrong (not just that something is) beside the
   verdict and its refresh action. Null when nothing is reported. */
function topSourceIssue(snap) {
  const findings = issuesOf(snap);
  if (!findings.length) return null;
  return findings.find((issue) => issue.severity === "error") || findings[0];
}

/* "Since when" for a Degraded verdict: the most recent moment a currently-degraded
   source was last healthy, as a relative suffix (" · last healthy 12m ago"). Reuses
   agoText. A source that has never been healthy (lastHealthyAt null) contributes
   nothing — claiming "never seen healthy" would be a lie — so an all-null or
   sourceless snapshot yields no suffix at all. */
function degradedSinceText(snap) {
  const byProvider = snap && snap.totals && snap.totals.sourceHealth && snap.totals.sourceHealth.byProvider;
  if (!byProvider) return "";
  let latest = null;
  for (const health of Object.values(byProvider)) {
    if (!health || health.healthy !== false || !health.lastHealthyAt) continue;
    const t = Date.parse(health.lastHealthyAt);
    if (Number.isNaN(t)) continue;
    if (latest === null || t > latest) latest = t;
  }
  if (latest === null) return "";
  return " · last healthy " + agoText(new Date(latest).toISOString());
}

function noDataWidget(sublabel) {
  return { value: "No data", unit: "", sublabel, tone: "missing" };
}

function summaryWidgetData(id, snap, conn = "live", display = "percent", queueItems = state.queueItems, fetchFailed = state.fetchFailed, queueError = state.queueError) {
  if (id === "health") {
    // Merged system + source-health + routing-health verdict. OK renders as a
    // trailing micro-chip; degraded promotes to a full cell with its reason.
    const status = systemStatus(snap, conn, fetchFailed);
    const control = snap && snap.controlHealth;
    const source = snap && snap.totals && snap.totals.sourceHealth;
    const stale = (control && control.staleSources && control.staleSources.length) || 0;
    const errors = (control && control.errors && control.errors.length) || 0;
    /* The card used to headline the bare word "Degraded" for all three
       severities, then contradict itself one line down with an ADVISORY badge
       and the sentence "the board is usable" — an advisory shouting in the same
       amber as an unreachable control plane. The headline IS the severity now,
       so the two cannot disagree, and `advisory` gets its own tone so the strip
       can render it at the weight it deserves. */
    const severity = status.key === "degraded" ? degradedSeverity(snap, conn, fetchFailed) : null;
    const SEVERITY_HEADLINE = { blocking: "Blocked", stale: "Stale", advisory: "Advisory" };
    return {
      value: (severity && SEVERITY_HEADLINE[severity.key]) || status.label,
      unit: "",
      sublabel: !snap
        ? (conn === "offline" ? "Snapshot connection unavailable." : "Waiting for the first snapshot.")
        : status.key === "operational"
          ? (source && source.total > 0
            ? `${source.healthy}/${source.total} sources healthy · controls reachable.`
            : "Sources and controls healthy.")
          : conn !== "live" ? "Live snapshot feed is not healthy."
            : fetchFailed ? "Last snapshot refresh failed — showing the previous good snapshot."
            : control && control.cmuxReachable !== true
              ? "cmux unreachable — terminal titles and Focus/Send stay offline."
              : source && source.degraded > 0
                ? `${source.degraded} degraded source${source.degraded === 1 ? "" : "s"} · ${stale} stale · ${errors} error${errors === 1 ? "" : "s"}`
                : "Source or control evidence needs review.",
      // An advisory is not an alarm: it takes its own tone so the strip shrinks
      // it to a micro cell instead of sizing it like a blocked control plane.
      tone: severity && severity.key === "advisory" ? "advisory" : status.tone,
      icon: status.key === "operational" ? "check" : status.key === "offline" ? "offline" : "warning",
      severityKey: severity ? severity.key : null,
      severityDetail: severity ? severity.detail : "",
    };
  }
  if (!snap) return noDataWidget("Waiting for the first snapshot.");

  const totals = totalsOf(snap);
  if (id === "needs-you") {
    const attention = attentionSummary(snap);
    const top = pulseFindings(snap, queueItems).slice(0, 2).map((f) => f.title).join(" · ");
    /* This card is the one that means "stop reading and go do something", so a
       missing input has to be admitted HERE rather than only in a console warning.
       Queued triage items are part of its findings list; when the queue did not
       answer, the count below is a floor, not a total. */
    const queueDown = queueError
      ? "Triage queue unavailable (" + queueError + ") — findings may be missing."
      : "";
    return {
      value: String(attention.count),
      unit: attention.count === 1 ? "finding" : "findings",
      sublabel: queueDown || (attention.count && top ? top : "No active findings."),
      tone: attention.count || queueDown ? "hot" : "ok",
    };
  }
  if (id === "momentum") {
    const momentum = snap.pulse && snap.pulse.momentum;
    let sublabel = "No completion data yet.";
    if (momentum) {
      // Window honesty: a freshly restarted tracker says how long it has
      // actually watched, never a fabricated "this hour". Below one full
      // 5-min bucket there is no completion window to report at all; stall
      // detection reads updatedAt directly, so it stays valid immediately.
      const parts = [];
      if (momentum.observedWindowMs > 0) {
        const windowText = momentum.observedWindowMs < 3_600_000
          ? "in " + fmtElapsed(momentum.observedWindowMs) + " observed"
          : "this hour";
        parts.push("↑" + momentum.completionsLastHour + " done " + windowText);
      }
      if (momentum.stalled) parts.push(`${momentum.stalled} quiet 15m+`);
      if (parts.length) sublabel = parts.join(" · ");
    }
    return { value: String(totals.working), unit: "shipping", sublabel, tone: "ok" };
  }
  if (id === "burn") {
    const burn = snap.pulse && snap.pulse.burn;
    if (!burn) return noDataWidget("No burn data yet.");
    // Null cost stays "cost unavailable" — never rendered as $0.
    const cost = burn.costLastHourUsd != null
      ? "$" + burn.costLastHourUsd.toFixed(2) + " last hour"
      : "cost unavailable";
    const coverage = burn.coverage
      ? ` · ${burn.coverage.reporting}/${burn.coverage.eligible} reporting` : "";
    return {
      value: burn.tokensPerMin != null ? fmtTok(burn.tokensPerMin) : "No data",
      unit: burn.tokensPerMin != null ? "/min" : "",
      sublabel: cost + coverage + (burn.costNote ? " · " + burn.costNote : ""),
      tone: burn.tokensPerMin != null ? "ok" : "missing",
    };
  }
  if (id === "context-peak") {
    const peak = peakContext(snap);
    /* The server reports contextPeak/contextMedian at the top level, derived from
       the same per-agent contextPct the CTX column reads. Prefer them: the client
       walk below computes its own percentage from tokens.total, so two
       derivations of one number drift, and the walk also decided whether the card
       EXISTED — a snapshot it found nothing in printed "No data" while the server
       had the answer sitting in the payload.

       The walk is still what the tokens display and the meter's per-agent linkage
       need, so it stays; it just no longer gets a vote on the headline. */
    const reported = Number.isFinite(snap.contextPeak) ? snap.contextPeak : null;
    const median = Number.isFinite(snap.contextMedian) ? snap.contextMedian : null;
    if (!peak && reported == null) return noDataWidget("No live context reports.");
    const pct = reported != null ? reported : peak.pct;
    const coverage = totals.tokenReporting != null && totals.tokenEligible != null
      ? ` · ${totals.tokenReporting}/${totals.tokenEligible} reporting` : "";
    /* Peak alone hides the shape of the fleet: one agent at 90% and every agent
       at 90% are the same headline and very different situations. */
    const spread = median != null ? `Peak ${pct}% · Median ${median}%` : "Highest observed";
    return {
      value: peak && display === "tokens" ? contextDisplayValue(peak.agent.tokens, display) : pct + "%",
      unit: display === "tokens" && peak ? "" : "peak window",
      sublabel: spread + coverage,
      tone: pct >= 85 ? "hot" : "ok",
      meterPct: pct,
    };
  }
  return noDataWidget("Widget evidence is not available.");
}

const AFFECTS_SAMPLE_LIMIT = 6;
// At most five rows in the inline pulse expansion before a "+N more" control
// reveals the rest in place — dense but never an unbounded wall.
const MAX_PULSE_ROWS = 5;

// Server-owned work state → the single row vocabulary (label + visual key +
// tone). issueWorkState prefers live optimistic signals, then this map, then a
// severity default, so the board always names who (if anyone) is on a finding.
const WORK_STATE_VIEW = {
  needs_triage: { key: "needs", label: "Needs triage", tone: "error" },
  watching: { key: "watching", label: "Watching", tone: "warn" },
  triaging: { key: "triaging", label: "Triaging", tone: "warn" },
  planned: { key: "planned", label: "Plan ready", tone: "info" },
  queued: { key: "queued", label: "Queued", tone: "info" },
  investigating: { key: "investigating", label: "Investigating", tone: "info" },
  verifying: { key: "verifying", label: "Verifying", tone: "warn" },
  blocked: { key: "blocked", label: "Blocked", tone: "error" },
  cleared: { key: "cleared", label: "Cleared", tone: "moss" },
};

// Progress 0–100 per work state (normative). blocked keeps a mid value but
// its ember tone (not the %) carries the alarm.
/* One server enum, one operator vocabulary. Every surface that names an
   investigation state reads from here: the plan chip, the queue button and its
   note, the pulse row's work state, the drawer eyebrow and the drawer status
   sentence. Before this table `completed` read "Complete" on the chip,
   "complete · verifying" on the button, "verifying" in the pulse row,
   "Verifying" in the drawer eyebrow and "complete · waiting for fresh data" in
   the drawer status — four different words for one state, on one board.
   `work` maps into WORK_STATE_VIEW, which stays the downstream row vocabulary. */
const INVESTIGATION_STATE_VIEW = {
  queued: {
    work: "queued", label: "Queued", tone: "cool",
    button: "✓ Investigation queued",
    note: "Queued and ready for explicit launch",
    status: "queued and ready for explicit launch",
  },
  running: {
    work: "investigating", label: "Running", tone: "warm",
    button: "● Investigation running",
    note: "Investigation running",
    status: "running",
  },
  completed: {
    work: "verifying", label: "Verifying", tone: "ok",
    button: "✓ Investigation verifying",
    note: "Investigation verifying · waiting for fresh data",
    status: "verifying · waiting for fresh data",
  },
  blocked: {
    work: "blocked", label: "Blocked", tone: "hot",
    button: "! Investigation blocked",
    note: "Investigation blocked · review result",
    status: "blocked · review result",
  },
};

/* A state the server adds later reads as its own word everywhere rather than
   as a confident wrong label on one surface and a raw enum on the next. */
function investigationView(stateKey) {
  if (INVESTIGATION_STATE_VIEW[stateKey]) return INVESTIGATION_STATE_VIEW[stateKey];
  const raw = String(stateKey || "queued");
  return {
    work: "queued", label: raw, tone: "cool",
    button: "Investigation " + raw,
    note: "Investigation " + raw,
    status: raw,
  };
}

const PROGRESS_BY_WORK = {
  needs: 0, watching: 0, triaging: 15, planned: 35, queued: 50,
  investigating: 70, verifying: 85, blocked: 70, cleared: 100,
};

// Four-tick stage rail: Watch → Triage → Verify → Cleared.
const STAGE_BY_WORK = {
  needs: 1, watching: 1,
  triaging: 2, planned: 2, queued: 2, investigating: 2,
  verifying: 3, blocked: 3,
  cleared: 4,
};
const STAGE_LABELS = ["Watch", "Triage", "Verify", "Cleared"];

// Each work key → row glyph shape + state-label tone + progress-rail tone. The
// glyph/rail/st classes are styled in styles.css (.glyph.act/.warn/.run/.ok).
const FINDING_VISUAL = {
  needs: { glyph: "act", st: "hot", rail: "hot" },
  watching: { glyph: "warn", st: "warm", rail: "warm" },
  triaging: { glyph: "run", st: "cool", rail: "" },
  planned: { glyph: "run", st: "cool", rail: "" },
  queued: { glyph: "run", st: "cool", rail: "" },
  investigating: { glyph: "run", st: "cool", rail: "" },
  verifying: { glyph: "run", st: "warm", rail: "warm" },
  blocked: { glyph: "act", st: "hot", rail: "hot" },
  cleared: { glyph: "ok", st: "ok", rail: "ok" },
};

/* ---------- test surface ---------- */

globalThis.TheAntHill = {
  deriveActivity, deriveOutcome, deriveControlState, deriveRollup, programRollup,
  controlUnavailableText,
  totalsOf, issuesOf, alerting, viewMatches, matchesQuery, buildClusters, tokenSummary,
  issueLifecycle, issueStateLabel, recentlyResolvedOf,
  contextUsage, contextDisplayValue, typicalRequestOf, modelPolicyView, cursorPolicyParts, MODEL_POLICY_LABELS,
  roleView, formatLastHumanMessage, rowSummary, NO_READABLE_MESSAGE,
  elapsedDataset, liveElapsedText, fmtTok, fmtElapsed, modelShort, agentName,
  sourceAgentName, presentationLabelKey, agentLabelEligible, programName,
  preferredRenameTarget, terminalSourceName, terminalIdentity, terminalBreadcrumb, focusDestinationHint, taskMeaningfullyDifferent,
  quietSourceLine, fullSourceDetail, verdictGate, headPrimaryAction, renderVitalsBand,
  renderAgentRow, renderAgentColumnHeader, renderSummaryWidget,
  renderProgramDrawer, programRollupLine, programRollupCells, programHeadRollup,
  ACTIVITY_LABELS, OUTCOME_LABELS, CONTROL_LABELS, VIEWS, OPS_VIEWS,
  withinLookback, parseLookbackHours, lookbackApplies, lookbackLabel, rowStalenessText,
  DEFAULT_LOOKBACK_HOURS, LOOKBACK_PRESETS,
  broadcastEligible, broadcastIneligibleReason,
  WIDGET_STORAGE_KEY, DEFAULT_WIDGET_IDS, WIDGET_CATALOG,
  normalizeWidgetIds, parseWidgetPreference, reorderWidgetIds,
  pulseStripModel, issueWorkState, issueStage, affectedImpact, issueProgress, issueImpactLine,
  INVESTIGATION_STATE_VIEW, investigationView,
  systemStatus, degradedSeverity, attentionSummary, summaryWidgetData, topSourceIssue, degradedSinceText,
  parseInvestigationResult, routeFromBullet,
  serverUnreachableHint, usageBarTitle, renderUsageSeriesChart,
  renderAgentDrawer, renderOperate, renderChat, renderEvidence, renderNamesDisclosure,
  identityTraceView, quarantineBrief, surfaceCollisions, collisionLine,
  renderControlBanner, renderIdentityBlock,
  el,
  // CONN_LABELS and the freshness thresholds stay out of this block on purpose:
  // they are declared below it, so listing them here would be a TDZ error.
  snapshotFreshness, connLabelText, connVerdictFor, reconnectPlan, fallbackPollDue, eventSnapshot,
  feedAlarm, clocksFrozen, feedFrozen, elapsedTickText, staleControlNote, feedAlarmNode, tickClocks,
  renderCommandDock, renderDockTool,
  // The TRANSCRIPT_* limits stay out for the same TDZ reason as CONN_LABELS:
  // they are `const`s declared below this block. Assert the behavior instead.
  transcriptUrl, clampTranscriptLimit, nextTranscriptLimit, normalizeTranscript,
  transcriptFailureText, transcriptWindow, renderTranscriptPanel,
  actionsUrl, clampActionsLimit, normalizeActions, actionsFailureText,
  actionOutcomeView, actionRecipients, lastActionFor, renderActionLog,
  needsHumanIds, notificationPlan, titleWithAlerts, notifyToggleView, deliverNotification,
  programOpen, programsPaintSig, inspectorPaintSig, agentRecordSig, broadcastPaintSig, agentsById,
  // ROW_NAV_KEYS is deliberately absent — it is a `const` declared below this
  // block, exactly the TDZ hazard the comment above describes. The behavior it
  // gates is asserted through handleRowNavigation instead.
  nextRowIndex, handleRowNavigation, firstLoadPending, renderSkeleton, renderEmpty,
  reconcileKeyed, agentRowSig, agentRowPlan, programShellSig, syncProgramList,
  filterChip, renderFilterBar, renderLabelForm, renderTriage, renderUsagePanel,
};

/* ---------- state ---------- */

const STALE_AFTER_MS = 60_000;

/* Freshness is a property of the DATA, never of the transport. The server
   heartbeats every 25s from a timer that knows nothing about the collector, so a
   heartbeat proves only that the socket is open — it must never be able to make
   a 91-hour-old snapshot read as "Live". Age is measured against
   snapshot.generatedAt, which the server already sends. The collector refreshes
   every 4s, so anything past SNAPSHOT_FRESH_MS is already behind; past
   SNAPSHOT_STALE_MS the board is not showing "now" in any useful sense. */
const SNAPSHOT_FRESH_MS = 15_000;
const SNAPSHOT_STALE_MS = 60_000;

function snapshotFreshness(generatedAt, now = Date.now()) {
  const at = generatedAt ? Date.parse(generatedAt) : NaN;
  if (!Number.isFinite(at)) return { state: "unknown", ageMs: null };
  const ageMs = Math.max(0, now - at);
  if (ageMs <= SNAPSHOT_FRESH_MS) return { state: "fresh", ageMs };
  return { state: ageMs > SNAPSHOT_STALE_MS ? "stale" : "lagging", ageMs };
}

/* The badge tells the truth once you look at it — the ALARM is what makes you
   look. :4701 served a 91-hour-frozen snapshot behind a green "Live" badge and
   the operator acted on a world that had ended four days earlier. A badge in the
   corner is not a warning; a full-width bar in the reading path is.

   One predicate decides the whole staleness story, so the alarm, the clocks and
   the controls can never disagree with each other. Pure, so the rule is testable
   without a browser. Returns null when the board is trustworthy. */
function feedAlarm(conn, generatedAt, now = Date.now()) {
  if (conn === "offline") {
    return {
      kind: "offline",
      headline: "Server unreachable — this board is not updating",
      detail: "Nothing below is current. Focus, Send, Interrupt, Archive and Broadcast are held until the server answers.",
      ageMs: null,
    };
  }
  const fresh = snapshotFreshness(generatedAt, now);
  if (fresh.state !== "stale") return null;
  const age = fmtElapsed(fresh.ageMs);
  return {
    kind: "frozen",
    headline: "Feed frozen — last snapshot " + age + " ago",
    detail: "Every agent, count and clock below is " + age + " old. Controls are held: routing on stale evidence can type into the wrong terminal.",
    ageMs: fresh.ageMs,
  };
}

/* Stale data has to LOOK stale everywhere it is displayed, not just in the bar.
   Same predicate as the alarm by construction. */
function clocksFrozen(conn, generatedAt, now = Date.now()) {
  return feedAlarm(conn, generatedAt, now) !== null;
}

function feedFrozen(ui = state, now = Date.now()) {
  return clocksFrozen(ui && ui.conn, ui && ui.snap && ui.snap.generatedAt, now);
}

/* tickClocks extrapolated elapsed from data-elapsed-base plus wall-clock drift
   every 5s, so on a frozen board a dead agent's uptime kept climbing — the most
   convincing lie on the page, because it was the one thing visibly moving. When
   the feed is frozen the clock holds at the value the snapshot actually
   reported. Returns null when the dataset cannot be read at all. */
function elapsedTickText(base, fromIso, now, frozen) {
  const b = Number(base);
  if (!Number.isFinite(b)) return null;
  if (frozen) return fmtElapsed(b);
  const drift = now - Date.parse(fromIso);
  if (!Number.isFinite(drift)) return null;
  return fmtElapsed(b + Math.max(0, drift));
}

/* Why a control is held. Kept separate from the capability reasons the dock is
   forbidden to echo — this is about the feed, not about routing. */
function staleControlNote(alarm) {
  if (!alarm) return "";
  return alarm.kind === "offline"
    ? "Held — the server is unreachable, so there is no safe route to this session."
    : "Held — the board is " + fmtElapsed(alarm.ageMs) + " out of date. Refresh before sending.";
}

const state = {
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
  view: "now",
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
  labels: new Map(),           // stable presentation target key -> label
  aliases: null,               // compatibility name for the existing program-alias seam
  labelsLoading: false,
  labelsLoaded: false,
  labelLoadError: "",
  renaming: null,              // presentation target key currently being edited
  widgetIds: defaultWidgetIds(),
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
state.aliases = state.labels;

function loadLookback() {
  try {
    const raw = localStorage.getItem(LOOKBACK_STORAGE_KEY);
    if (raw == null) {
      state.lookbackHours = DEFAULT_LOOKBACK_HOURS;
      return;
    }
    state.lookbackHours = parseLookbackHours(raw);
  } catch {
    state.lookbackHours = DEFAULT_LOOKBACK_HOURS;
  }
}

function saveLookback() {
  try {
    localStorage.setItem(
      LOOKBACK_STORAGE_KEY,
      state.lookbackHours == null ? "all" : String(state.lookbackHours),
    );
  } catch { /* storage unavailable */ }
}

function setLookbackHours(hours) {
  const next = hours == null ? null : parseLookbackHours(hours);
  if (next === state.lookbackHours) return;
  state.lookbackHours = next;
  saveLookback();
  render();
}

const API_READ_TIMEOUT_MS = 10_000;
const API_TRANSCRIPT_TIMEOUT_MS = 30_000;
const API_WRITE_TIMEOUT_MS = 30_000;

// A hung loopback socket otherwise never reaches the request's recovery path.
async function apiFetch(url, options = {}, timeoutMs = API_READ_TIMEOUT_MS) {
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

async function fetchSettings() {
  try {
    const res = await apiFetch("/api/settings", { headers: { accept: "application/json" } }, API_READ_TIMEOUT_MS);
    if (!res.ok) throw new Error("settings " + res.status);
    const body = await res.json();
    const hours = Number(body.scanWindowHours ?? (body.settings && body.settings.scanWindowHours));
    if (Number.isFinite(hours)) state.scanWindowHours = hours;
    state.settingsError = "";
  } catch (err) {
    /* The scan window falls back to a hard-coded 36, and the filter chip printed
       that as fact. A snapshot carries the real value and overrides it, so this
       only bites before the first snapshot or when one omits the field — which
       is exactly when the operator has no other way to notice. */
    state.settingsError = err && err.message ? err.message : "Settings unavailable";
  }
  renderFilterBar();
}

async function postScanWindow(hours) {
  const clamped = Math.max(1, Math.min(168, Math.round(Number(hours))));
  if (!Number.isFinite(clamped)) return;
  state.settingsPending = true;
  renderFilterBar();
  try {
    const res = await apiFetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ scanWindowHours: clamped }),
    }, API_WRITE_TIMEOUT_MS);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error((body.error && body.error.message) || ("settings " + res.status));
    state.scanWindowHours = Number(body.scanWindowHours) || clamped;
    await fetchSnapshot();
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "err");
  } finally {
    state.settingsPending = false;
    render();
  }
}

function loadOverrides() {
  try {
    const raw = localStorage.getItem("mtn3-programs");
    if (raw) state.programOverrides = new Map(Object.entries(JSON.parse(raw)));
  } catch { /* first run or blocked storage */ }
}

function saveOverrides() {
  try {
    localStorage.setItem("mtn3-programs", JSON.stringify(Object.fromEntries(state.programOverrides)));
  } catch { /* storage unavailable */ }
}

function loadWidgetPreferences() {
  try {
    state.widgetIds = parseWidgetPreference(localStorage.getItem(WIDGET_STORAGE_KEY));
  } catch {
    state.widgetIds = defaultWidgetIds();
  }
}

function saveWidgetPreferences() {
  try { localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify(state.widgetIds)); } catch { /* storage unavailable */ }
}

/* ---------- data flow ---------- */

/* The one apply path a validated snapshot takes into the UI: shape-guard, adopt
   it, sync the scan window, clear the failure flag, re-render. The GET poll
   (fetchSnapshot), the POST recollect and the SSE stream — which carries very
   nearly every snapshot the UI ever paints — all feed through here, so a guard
   added below actually applies to real traffic. */
function snapshotSequenceFrom(value) {
  if (value == null || value === "") return null;
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : null;
}

function applySnapshot(snap, sequence = null) {
  if (!snap || snap.schemaVersion !== 1 || !Array.isArray(snap.programs)) {
    throw new Error("unexpected snapshot shape");
  }
  state.snap = snap;
  state.snapshotSequence = snapshotSequenceFrom(sequence);
  if (Number.isFinite(Number(snap.scanWindowHours))) state.scanWindowHours = Number(snap.scanWindowHours);
  state.fetchFailed = false;
  // Escalate before painting: the tab title and any notification are about the
  // snapshot being adopted, and this is the only place a snapshot is adopted.
  applyNotifications(snap);
  render();
}

async function fetchSnapshot() {
  try {
    const res = await apiFetch("/api/snapshot", { headers: { accept: "application/json" } }, API_READ_TIMEOUT_MS);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const sequence = res.headers && res.headers.get
      ? res.headers.get("x-ant-hill-snapshot-sequence")
      : null;
    applySnapshot(await res.json(), sequence);
  } catch (err) {
    state.fetchFailed = true;
    if (!state.snap) {
      setConn("offline");
      render();
    }
    console.warn("snapshot fetch failed:", err);
  }
}

/* The Degraded verdict's Refresh forces a fresh server-side collection rather than
   re-serving cache: POST /api/recollect (no body, same-origin — the browser sends
   the Origin header the server guard requires). Apply the returned snapshot through
   the shared path; any non-OK envelope ({ ok:false, ... }, e.g. 500 RECOLLECT_FAILED)
   or a network error falls back to fetchSnapshot so Refresh is never a dead button. */
async function recollectSnapshot() {
  try {
    const res = await apiFetch("/api/recollect", { method: "POST", headers: { accept: "application/json" } }, API_WRITE_TIMEOUT_MS);
    if (!res.ok) { await fetchSnapshot(); return; }
    const sequence = res.headers && res.headers.get
      ? res.headers.get("x-ant-hill-snapshot-sequence")
      : null;
    applySnapshot(await res.json(), sequence);
  } catch {
    await fetchSnapshot();
  }
}

/* On-demand terminal evidence for a quarantined session. Read-only GET; the
   result is scoped to one agent id so a drawer switched mid-flight can never
   adopt the previous agent's evidence. */
async function loadIdentityEvidence(agentId) {
  state.identity = { agentId, loading: true, error: "", data: null };
  render();
  let next;
  try {
    const res = await apiFetch("/api/debug/identity?agent=" + encodeURIComponent(agentId), {
      headers: { accept: "application/json" },
    }, API_READ_TIMEOUT_MS);
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON body */ }
    if (!res.ok || !body || body.ok !== true) {
      const message = (body && body.error && body.error.message) || "HTTP " + res.status;
      throw new Error(message);
    }
    next = { agentId, loading: false, error: "", data: body };
  } catch (err) {
    next = { agentId, loading: false, error: err instanceof Error ? err.message : String(err), data: null };
  }
  // The operator moved on — do not paint stale evidence into another drawer.
  if (state.identity.agentId !== agentId) return;
  state.identity = next;
  render();
}

let refetchTimer = null;
function scheduleRefetch() {
  if (refetchTimer) return;
  refetchTimer = setTimeout(() => { refetchTimer = null; fetchSnapshot(); }, 400);
}

/* Both full-snapshot envelope shapes: a bare snapshot, or one wrapped in
   { snapshot }. Anything else is an unknown event kind, not a snapshot. */
function eventSnapshot(msg) {
  if (msg && msg.schemaVersion === 1) return msg;
  return msg && msg.snapshot ? msg.snapshot : null;
}

/* Rebuild a complete candidate without mutating the base. Program metadata and
   ordering are authoritative in every delta; agent records may come from the
   validated base only when the delta names their ids. A missing id is a broken
   delta, never permission to paint a partial board. */
function applySnapshotDelta(base, delta, currentSequence) {
  if (!base || base.schemaVersion !== 1 || !Array.isArray(base.programs)) {
    throw new Error("snapshot delta has no complete base");
  }
  if (!delta || delta.schemaVersion !== 1 ||
      !Number.isSafeInteger(delta.baseSequence) ||
      !Number.isSafeInteger(delta.sequence) ||
      delta.baseSequence !== currentSequence ||
      delta.sequence !== delta.baseSequence + 1 ||
      !delta.snapshot || delta.snapshot.schemaVersion !== 1 ||
      Object.prototype.hasOwnProperty.call(delta.snapshot, "programs") ||
      !Array.isArray(delta.programs)) {
    throw new Error("snapshot delta sequence or shape is invalid");
  }

  const basePrograms = new Map(base.programs.map((program) => [program.id, program]));
  const seenPrograms = new Set();
  const programs = delta.programs.map((wireProgram) => {
    if (!wireProgram || typeof wireProgram.id !== "string" ||
        seenPrograms.has(wireProgram.id) ||
        !Array.isArray(wireProgram.agentIds) ||
        !Array.isArray(wireProgram.agents)) {
      throw new Error("snapshot delta program is invalid");
    }
    seenPrograms.add(wireProgram.id);
    const baseAgents = new Map(
      (basePrograms.get(wireProgram.id)?.agents || []).map((item) => [item.id, item]),
    );
    const changedAgents = new Map();
    const allowedIds = new Set(wireProgram.agentIds);
    for (const item of wireProgram.agents) {
      if (!item || typeof item.id !== "string" ||
          changedAgents.has(item.id) || !allowedIds.has(item.id)) {
        throw new Error("snapshot delta agent is invalid");
      }
      changedAgents.set(item.id, item);
    }
    const seenAgents = new Set();
    const agents = wireProgram.agentIds.map((id) => {
      if (typeof id !== "string" || seenAgents.has(id)) {
        throw new Error("snapshot delta agent order is invalid");
      }
      seenAgents.add(id);
      const item = changedAgents.get(id) || baseAgents.get(id);
      if (!item) throw new Error("snapshot delta omitted an agent record");
      return item;
    });
    const { agentIds: _agentIds, agents: _agents, ...program } = wireProgram;
    return { ...program, agents };
  });

  const candidate = { ...delta.snapshot, programs };
  if (candidate.schemaVersion !== 1) throw new Error("snapshot delta produced an invalid snapshot");
  return candidate;
}

function handleEventPayload(raw, eventSequence = null) {
  state.lastEventAt = Date.now();
  let msg;
  try { msg = JSON.parse(raw); } catch { scheduleRefetch(); return; }
  const snap = eventSnapshot(msg);
  try {
    applySnapshot(snap, eventSequence);
  } catch {
    scheduleRefetch(); // unknown event kind or bad shape: refetch the truth
  }
  applyFreshnessVerdict();
}

let snapshotRecoveryInFlight = null;
function recoverFullSnapshot() {
  if (!snapshotRecoveryInFlight) {
    snapshotRecoveryInFlight = fetchSnapshot().finally(() => {
      snapshotRecoveryInFlight = null;
    });
  }
  return snapshotRecoveryInFlight;
}

async function handleDeltaPayload(raw, eventSequence = null) {
  state.lastEventAt = Date.now();
  try {
    const delta = JSON.parse(raw);
    const sequence = snapshotSequenceFrom(eventSequence);
    if (sequence === null || sequence !== delta.sequence) {
      throw new Error("snapshot delta event id does not match its sequence");
    }
    const next = applySnapshotDelta(state.snap, delta, state.snapshotSequence);
    applySnapshot(next, sequence);
  } catch {
    await recoverFullSnapshot();
  }
  applyFreshnessVerdict();
}

let es = null;
function connect() {
  es = new EventSource("/api/events");
  es.onopen = () => { state.lastEventAt = Date.now(); applyFreshnessVerdict(); };
  es.onerror = () => { setConn(state.snap ? "reconnecting" : "offline"); };
  es.onmessage = (e) => handleEventPayload(e.data, e.lastEventId);
  es.addEventListener("snapshot", (e) => handleEventPayload(e.data, e.lastEventId));
  es.addEventListener("snapshot-delta", (e) => void handleDeltaPayload(e.data, e.lastEventId));
  // Heartbeats only prove the pipe is open — no refetch, no snapshot re-render,
  // and crucially no verdict of their own: a 25s heartbeat under a 60s threshold
  // used to make setConn("stale") unreachable while the data sat frozen.
  es.addEventListener("heartbeat", () => {
    state.lastEventAt = Date.now();
    applyFreshnessVerdict();
  });
}

/* The connection verdict, recomputed from evidence rather than from whichever
   event happened to fire last. The socket owns the pessimistic states; once it
   is open the AGE OF THE DATA decides between live and stale. Heartbeats are
   deliberately not an input here — they are why a frozen board read as "Live".
   Pure, and returns null when the socket is not open, so the rule is testable
   without a live EventSource. */
function connVerdictFor({ open, lastEventAt, generatedAt, now = Date.now() }) {
  if (!open) return null; // onerror / the health poll own the pessimistic states
  const silent = lastEventAt > 0 && now - lastEventAt > STALE_AFTER_MS;
  return silent || snapshotFreshness(generatedAt, now).state === "stale" ? "stale" : "live";
}

function applyFreshnessVerdict() {
  const next = connVerdictFor({
    open: !!es && es.readyState === EventSource.OPEN,
    lastEventAt: state.lastEventAt,
    generatedAt: state.snap && state.snap.generatedAt,
  });
  if (next) setConn(next);
}

/* EventSource only auto-retries transport errors; a non-2xx status or a wrong
   content-type parks it in CLOSED for good, and nothing else in the client
   re-arms it (the manual retry button is hidden whenever any agent exists). This
   poll owns recovery — with backoff so a server that is genuinely down is not
   hammered — and falls back to polling /api/snapshot once the feed has been
   unhealthy for longer than STALE_AFTER_MS, so the board can never sit painting
   hours-old agent state under live-looking elapsed clocks. */
let reconnectAttempts = 0;
let nextReconnectAt = 0;
let nextFallbackPollAt = 0;
let connChangedAt = Date.now();

/* readyState as raw numbers so the rule stays testable without an EventSource:
   0 CONNECTING (a retry is already in flight, leave it), 1 OPEN (healthy, reset
   the backoff), 2 CLOSED (dead for good — re-arm once the window has passed). */
function reconnectPlan(readyState, now, attempts, dueAt) {
  if (readyState === 1) return { reconnect: false, attempts: 0, dueAt: 0 };
  if (readyState === 0 || now < dueAt) return { reconnect: false, attempts, dueAt };
  const next = attempts + 1;
  return { reconnect: true, attempts: next, dueAt: now + Math.min(30_000, 1_000 * 2 ** Math.min(next, 5)) };
}

/* Once the feed has been unhealthy for longer than one stale window, stop
   trusting the stream to come back on its own and re-poll the snapshot. */
function fallbackPollDue(conn, now, changedAt, dueAt) {
  return conn !== "live" && now - changedAt > STALE_AFTER_MS && now >= dueAt;
}

function pollConnectionHealth(now = Date.now()) {
  const plan = reconnectPlan(es ? es.readyState : 2, now, reconnectAttempts, nextReconnectAt);
  reconnectAttempts = plan.attempts;
  nextReconnectAt = plan.dueAt;
  if (plan.reconnect) {
    setConn(state.snap ? "reconnecting" : "offline");
    if (es) es.close();
    connect();
  }
  applyFreshnessVerdict();
  if (fallbackPollDue(state.conn, now, connChangedAt, nextFallbackPollAt)) {
    nextFallbackPollAt = now + 10_000;
    void fetchSnapshot();
  }
  renderConn(); // keep the snapshot-age suffix ticking while nothing else paints
}

/* Snapshot age can cross the stale threshold precisely while no snapshot is
   arriving. Repaint the alarm and any open control surfaces from the 5s clock,
   so silence itself can visibly hold stale routing controls. Their paint
   signatures keep healthy ticks as no-ops. */
function refreshStalenessSurfaces() {
  renderFeedAlarm();
  if (state.selected) renderInspector();
  if (state.selecting) renderBroadcastBar();
}

function tickFreshnessSurfaces() {
  tickClocks();
  refreshStalenessSurfaces();
}

function setConn(next) {
  if (state.conn === next) return;
  state.conn = next;
  connChangedAt = Date.now();
  renderConn();
}

/* ---------- connection + beacon ---------- */

const CONN_LABELS = {
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting…",
  stale: "Stale feed",
  offline: "Server unreachable",
};

/* The badge says how old the data is the moment it stops being fresh — a bare
   green "Live" beside a four-day-old snapshot is the trust failure this replaces. */
function connLabelText(conn, generatedAt, now = Date.now()) {
  const base = CONN_LABELS[conn] || conn;
  if (conn !== "live" && conn !== "stale") return base;
  const fresh = snapshotFreshness(generatedAt, now);
  if (fresh.state === "fresh" || fresh.state === "unknown") return base;
  return base + " · snapshot " + fmtElapsed(fresh.ageMs) + " ago";
}

function renderConn() {
  const badge = $("conn-badge");
  badge.className = "conn conn-" + state.conn;
  $("conn-label").textContent = connLabelText(state.conn, state.snap && state.snap.generatedAt);
  renderBeacon();
}

function renderBeacon() {
  const beacon = $("nest-beacon");
  beacon.classList.remove("calm", "flare");
  if (!state.snap || state.conn === "offline") return;
  beacon.classList.add(issuesOf(state.snap).length > 0 ? "flare" : "calm");
}

/* The alarm body. Split from the mount so the copy and the repair action can be
   asserted without a document. */
function feedAlarmNode(alarm) {
  return el("div", { class: "feed-alarm-inner" + (alarm.kind === "offline" ? " is-offline" : "") },
    icon(alarm.kind === "offline" ? "offline" : "warning", { label: "Alarm" }),
    el("div", { class: "feed-alarm-copy" },
      el("strong", { class: "feed-alarm-head", text: alarm.headline }),
      el("p", { class: "feed-alarm-detail", text: alarm.detail })),
    el("button", {
      type: "button",
      class: "btn feed-alarm-refresh",
      dataset: { fkey: "feed-alarm-refresh" },
      onclick: () => recollectSnapshot(),
    }, "Refresh now"));
}

/* Unmissable by position, not by animation: a full-width bar between the
   masthead and the summary, in the operator's reading path, carrying the age and
   the one action that can fix it. `feed-frozen` on <body> is what lets the rest
   of the board grey itself out in the same beat. */
/* ---------- server health probe (/api/health) ----------

   The connection badge reports what THIS browser sees over SSE; the feed alarm
   reports staleness the client computes from `snapshot.generatedAt`. Both are
   client-side readings. `/api/health` is the server's own verdict on its own
   snapshot, and it is the same signal scripts/anthill-deploy.sh gates a deploy
   on — so an operator watching the dashboard now sees exactly what the deploy
   health check sees.

   Deliberately quiet: while the server agrees it is healthy this renders
   nothing, because the two surfaces above already carry every healthy-state
   fact and a third green light would just be a third thing to read. It speaks
   only when the server disowns its own snapshot (verdict "stale") or stops
   answering at all — the two cases the client-side readings can disagree with
   or miss entirely (a wedged server can keep a socket open). */
const SERVER_HEALTH_POLL_MS = 15_000;

async function pollServerHealth(fetchImpl = typeof fetch === "function" ? apiFetch : null) {
  if (!fetchImpl) return null;
  let next;
  try {
    const res = await fetchImpl("/api/health", { headers: { accept: "application/json" } }, API_READ_TIMEOUT_MS);
    if (!res || res.ok !== true) {
      next = { ok: false, verdict: "unreachable", detail: "Health check returned " + ((res && res.status) || "no response") + "." };
    } else {
      const body = await res.json();
      next = body && body.ok === true
        ? { ok: true, verdict: "healthy", detail: "" }
        : {
          ok: false,
          verdict: (body && body.verdict) || "stale",
          detail: "The server reports its own snapshot as "
            + ((body && body.verdict) || "stale")
            + (body && body.snapshot && Number.isFinite(body.snapshot.ageMs)
              ? " (" + fmtElapsed(body.snapshot.ageMs) + " old)." : "."),
        };
    }
  } catch {
    // A refused/aborted request is itself the finding: the server is not answering.
    next = { ok: false, verdict: "unreachable", detail: "The server did not answer its health check." };
  }
  state.serverHealth = next;
  renderServerHealth();
  return next;
}

function renderServerHealth() {
  const node = $("server-health");
  if (!node) return;
  const health = state.serverHealth;
  // Absent (not yet polled) and healthy both render nothing — see the note above.
  const speak = !!health && health.ok !== true;
  node.hidden = !speak;
  if (!speak) {
    node.className = "server-health";
    node.textContent = "";
    node.removeAttribute?.("title");
    return;
  }
  node.className = "server-health is-" + (health.verdict === "unreachable" ? "unreachable" : "stale");
  node.textContent = "";
  node.setAttribute("role", "img");
  node.setAttribute("title", "Server health: " + health.verdict + " — " + health.detail);
  node.setAttribute("aria-label", "Server health: " + health.verdict + ". " + health.detail);
}

function renderFeedAlarm() {
  const bar = $("feed-alarm");
  if (!bar) return;
  const alarm = feedAlarm(state.conn, state.snap && state.snap.generatedAt);
  if (document.body) document.body.classList.toggle("feed-frozen", !!alarm);
  // Visibility is set on EVERY paint, before the guard: the signature only
  // decides whether the subtree is worth rebuilding, and a guard that can also
  // suppress `hidden` is one seed-value collision away from a silent alarm.
  bar.hidden = !alarm;
  const sig = alarm ? alarm.kind + "\u001f" + alarm.headline : "";
  if (state.paintSig.alarm === sig) return;
  state.paintSig.alarm = sig;
  bar.textContent = "";
  bar.className = "feed-alarm";
  if (alarm) bar.append(feedAlarmNode(alarm));
}

/* ---------- rendering ---------- */

function paintUnchanged(key, signature) {
  if (state.paintSig[key] === signature) return true;
  state.paintSig[key] = signature;
  return false;
}

function findingPaintKey(finding) {
  return [
    finding.kind, finding.id, finding.work.key, finding.progress,
    finding.title, finding.impact, finding.pin ? "1" : "0",
    state.selected && state.selected.kind === finding.kind && state.selected.id === finding.id ? "1" : "0",
  ].join("\u001f");
}

function render() {
  const focusKey = document.activeElement && document.activeElement.dataset
    ? document.activeElement.dataset.fkey
    : null;
  const main = $("main");
  const listScroll = main.scrollTop;
  const inspector = $("inspector");
  const inspectorScroll = inspector.scrollTop;

  renderConn();
  renderFeedAlarm();
  renderHealthRail();
  // The toggle now carries a snapshot-derived count, so it has to repaint with
  // the board. It used to be painted once in boot() and on click, which was
  // fine while the label was pure preference state — but boot() runs before the
  // first snapshot, so the badge would have been stuck at zero forever.
  renderNotifyToggle();
  renderTabs();
  renderFilterBar();
  renderPrograms();
  renderActionsPanel();
  renderInspector();
  renderBroadcastBar();
  renderSkeleton();
  renderEmpty();

  // Rebuilding the list momentarily collapses pane height, which clamps the
  // scroll position — restore it so live updates never yank the operator.
  main.scrollTop = listScroll;
  inspector.scrollTop = inspectorScroll;

  if (focusKey) {
    const node = document.querySelector(`[data-fkey="${CSS.escape(focusKey)}"]`);
    if (node) node.focus({ preventScroll: true });
  }
}

/* Highest live context-window usage across reporting sessions — answers
   "is any agent close to filling its window?" honestly, or null if unknown. */
function peakContext(snap) {
  let peak = null;
  for (const { agent } of snapshotAgents(snap)) {
    if (deriveActivity(agent) === "ended") continue;
    const ctx = contextUsage(agent.tokens);
    if (ctx && (peak == null || ctx.pct > peak.pct)) peak = { pct: ctx.pct, agent };
  }
  return peak;
}

function reading(label, valueNode, subNode, extraClass) {
  const labelNode = label && label.nodeType
    ? label
    : el("span", { class: "reading-label", text: label });
  return el("div", { class: "reading" + (extraClass ? " " + extraClass : "") },
    labelNode,
    valueNode,
    subNode || null);
}

function toggleContextDisplay() {
  state.contextDisplay = state.contextDisplay === "tokens" ? "percent" : "tokens";
  render();
}

function widgetLabelNode(id, label) {
  if (id !== "context-peak") return el("span", { class: "reading-label", text: label });
  return el("button", {
    type: "button",
    class: "reading-label context-toggle",
    "aria-label": state.contextDisplay === "percent" ? "Show Context tokens" : "Show Context %",
    "aria-pressed": String(state.contextDisplay === "tokens"),
    title: "Toggle context display",
    dataset: { fkey: "context-toggle" },
    onclick: toggleContextDisplay,
  }, label);
}

/* Compact verdict chip — the health cell's OK form (trailing micro-chip on
   both the stressed grid and the calm line). */
function healthMicroChip(data) {
  /* An advisory rides at micro too, so this chip is the ONLY place its
     consequence sentence can still be read — carry it, or shrinking the cell
     would silently delete the explanation along with the alarm. */
  const detail = [data.severityDetail, data.sublabel].filter(Boolean).join(" ");
  return el("span", { class: "verdict-chip verdict-" + data.tone, title: detail || data.sublabel },
    icon(data.icon), data.value);
}

function renderSummaryWidget(id, weight = "normal", data = summaryWidgetData(id, state.snap, state.conn, state.contextDisplay)) {
  const meta = WIDGET_CATALOG.find((widget) => widget.id === id);
  const cellClass = "reading-widget widget-" + id
    + (weight === "hot" ? " cell-hot" : weight === "micro" ? " cell-micro" : "");
  // A healthy control plane stays a trailing micro-chip; any degradation
  // promotes the cell back to full width below.
  if (id === "health" && weight === "micro") {
    return el("div", { class: "reading " + cellClass }, healthMicroChip(data));
  }
  const valueClass = ["reading-value", data.tone === "hot" ? "is-hot" : "", data.tone === "ok" ? "is-ok" : "", data.tone === "missing" ? "reading-no-data" : ""]
    .filter(Boolean).join(" ");
  let valueNode;
  if (id === "health") {
    valueNode = el("span", { class: valueClass },
      el("span", { class: "verdict-chip verdict-" + data.tone }, icon(data.icon), data.value));
  } else if (id === "needs-you") {
    // The verdict count is the strip's one expansion control: it toggles the
    // inline findings panel in place (rows open the drawer; no triage here).
    valueNode = el("button", {
      type: "button",
      class: valueClass + " pulse-verdict",
      "aria-expanded": String(state.pulseExpanded),
      "aria-controls": "pulse-findings",
      dataset: { fkey: "pulse-verdict" },
      onclick: togglePulseFindings,
    }, data.value,
      data.unit ? el("span", { class: "unit", text: data.unit }) : null);
  } else {
    valueNode = el("span", { class: valueClass }, data.value,
      data.unit ? el("span", { class: "unit", text: data.unit }) : null);
  }
  const subNode = el("span", { class: "reading-sub" });
  if (data.meterPct != null) {
    subNode.append(svgMeter(data.meterPct, "ctx-meter", {
      fillClass: "ctx-fill", trackClass: "ctx-track", label: `Peak context ${data.meterPct}%`,
    }));
  }
  // A Degraded verdict names its reason (the top live finding) beside the chip
  // and exposes the existing refresh control right there.
  const degraded = id === "health" && (data.tone === "degraded" || data.tone === "advisory");
  const reason = degraded ? topSourceIssue(state.snap) : null;
  const sinceNote = degraded ? degradedSinceText(state.snap) : "";
  const snapNote = id === "health" && state.snap?.generatedAt ? ` · snapshot ${agoText(state.snap.generatedAt)}` : "";
  /* The severity badge used to lead this line because the headline was the bare
     word "Degraded" and could not answer "am I blocked?". The headline is the
     severity itself now, so repeating it here just printed ADVISORY under
     Advisory. The consequence sentence is the part that was carrying the
     information, and it stays. */
  subNode.append(el("span", {
    text: (data.severityDetail ? data.severityDetail + " " : "")
      + (reason ? reason.title : data.sublabel) + sinceNote + snapNote,
  }));
  if (degraded) {
    subNode.append(el("button", {
      type: "button",
      class: "reading-repair",
      title: "Re-pull the latest snapshot evidence",
      "aria-label": reason ? "Refresh snapshot — " + reason.title : "Refresh snapshot",
      dataset: { fkey: "degraded-refresh" },
      onclick: () => recollectSnapshot(),
    }, "Refresh"));
  }
  return reading(widgetLabelNode(id, meta.label), valueNode, subNode, cellClass);
}

function setWidgetEnabled(id, enabled) {
  const meta = WIDGET_CATALOG.find((widget) => widget.id === id);
  if (!meta || meta.required) return;
  const next = state.widgetIds.filter((widgetId) => widgetId !== id);
  if (enabled) next.push(id);
  state.widgetIds = normalizeWidgetIds(next);
  saveWidgetPreferences();
  renderHealthRail();
}

function moveWidget(id, direction) {
  const next = reorderWidgetIds(state.widgetIds, id, direction);
  if (next.join("|") === state.widgetIds.join("|")) return;
  state.widgetIds = next;
  saveWidgetPreferences();
  renderHealthRail();
}

function renderWidgetCustomizer() {
  const panel = $("widget-customizer");
  const toggle = $("customize-summary");
  const options = $("widget-options");
  if (!panel || !toggle || !options) return;
  panel.hidden = !state.widgetCustomizerOpen;
  toggle.setAttribute("aria-expanded", String(state.widgetCustomizerOpen));
  if (!state.widgetCustomizerOpen) return;

  const focusKey = document.activeElement?.dataset?.fkey;
  options.textContent = "";
  const orderedCatalog = [
    ...state.widgetIds.map((id) => WIDGET_CATALOG.find((widget) => widget.id === id)),
    ...WIDGET_CATALOG.filter((widget) => !state.widgetIds.includes(widget.id)),
  ];
  for (const widget of orderedCatalog) {
    const selected = state.widgetIds.includes(widget.id);
    const position = state.widgetIds.indexOf(widget.id);
    const row = el("div", { class: "widget-option" + (selected ? " is-selected" : ""), role: "listitem" });
    const input = el("input", {
      type: "checkbox",
      id: "widget-option-" + widget.id,
      checked: selected ? "" : null,
      disabled: widget.required ? "" : null,
      "aria-label": widget.required ? `${widget.label} is always shown` : `Show ${widget.label}`,
      dataset: { fkey: "widget-toggle:" + widget.id },
      onchange: (event) => setWidgetEnabled(widget.id, event.currentTarget.checked),
    });
    const label = el("label", { class: "widget-option-label", for: "widget-option-" + widget.id },
      input, el("span", { text: widget.label }), widget.required ? el("span", { class: "widget-required", text: "always shown" }) : null);
    const controls = el("span", { class: "widget-reorder", "aria-label": `Reorder ${widget.label}` },
      el("button", {
        type: "button", class: "widget-move", disabled: !selected || widget.required || position <= 1 ? "" : null,
        "aria-label": `Move ${widget.label} up`, title: "Move up", dataset: { fkey: `widget-move:${widget.id}:up` },
        onclick: () => moveWidget(widget.id, -1),
      }, "↑"),
      el("button", {
        type: "button", class: "widget-move", disabled: !selected || widget.required || position < 0 || position >= state.widgetIds.length - 1 ? "" : null,
        "aria-label": `Move ${widget.label} down`, title: "Move down", dataset: { fkey: `widget-move:${widget.id}:down` },
        onclick: () => moveWidget(widget.id, 1),
      }, "↓"));
    row.append(label, controls);
    options.append(row);
  }
  if (focusKey) {
    const node = document.querySelector(`[data-fkey="${CSS.escape(focusKey)}"]`);
    if (node) node.focus({ preventScroll: true });
  }
}

/* Calm collapse — the whole strip is one moss line: verdict, shipping count,
   pulse numbers when the server reports them (graceful without them), a small
   activity sparkline, and the trailing health micro-chip. */
function renderPulseCalm(healthData) {
  const snap = state.snap;
  const totals = totalsOf(snap);
  const pulse = snap && snap.pulse;
  const parts = ["All clear", totals.working + " shipping"];
  if (pulse) {
    parts.push("↑" + pulse.momentum.completionsLastHour + " done this hour");
    if (pulse.burn.tokensPerMin != null) parts.push(fmtTok(pulse.burn.tokensPerMin) + " tok/min");
  }
  const line = el("div", { class: "pulse-calm", role: "status" },
    el("span", { class: "pulse-calm-mark", "aria-hidden": "true", text: "●" }),
    el("span", { class: "pulse-calm-copy", text: parts.join(" · ") }));
  const spark = pulse
    ? svgSparkline(pulse.activity.buckets.map((b) => b.activeSessions), { label: "Active sessions per 5-minute bucket, last hour" })
    : null;
  if (spark) line.append(spark);
  line.append(healthMicroChip(healthData || summaryWidgetData("health", snap, state.conn)));
  return line;
}

// Last painted needs-you count — detects the >0 → 0 clear so the strip can
// fire its one-shot moss transition (CSS transition only, no keyframe loops).
let pulseNeedsYouWas = 0;

/* The Pulse strip — one verdict-first surface. Calm collapses to a single
   line; anything urgent re-weights the fixed-order cells instead of
   reordering them. */
function renderHealthRail() {
  const widgets = $("health-widgets");
  if (!widgets) return;
  const model = pulseStripModel(state.snap, state.conn, state.queueItems, state.contextDisplay, state.queueError);
  // One derivation per widget per paint. The signature, the cell and the calm
  // line all read this map; each used to call summaryWidgetData again, and each
  // of those calls re-derived the whole findings list underneath.
  const dataById = new Map(model.cells.map((cell) => [cell.id, cell.data]));
  const attention = attentionSummary(state.snap);
  const needsYou = attention ? attention.count : 0;
  const buckets = state.snap && state.snap.pulse ? state.snap.pulse.activity.buckets : [];
  const sig = [
    state.conn,
    model.calm ? "calm" : "stressed",
    state.widgetIds.join(","),
    state.widgetCustomizerOpen ? "1" : "0",
    state.pulseExpanded ? "1" : "0",
    state.pulseShowAll ? "1" : "0",
    buckets.map((b) => b.activeSessions).join(","),
    model.findings.map(findingPaintKey).join("|"),
    // The calm line renders momentum/burn/health regardless of which widgets
    // are enabled, so sign its actual inputs — not the customized cell list.
    (model.calm ? ["momentum", "burn", "health"] : state.widgetIds).map((id) => {
      const data = dataById.get(id) || summaryWidgetData(id, state.snap, state.conn, state.contextDisplay);
      return [id, data.value, data.unit, data.sublabel, data.tone].join(":");
    }).join("|"),
  ].join("\u001f");
  if (paintUnchanged("widgets", sig)) return;

  const rail = $("health-rail");
  if (rail) {
    if (needsYou === 0 && pulseNeedsYouWas > 0) {
      rail.classList.add("pulse-cleared");
      setTimeout(() => rail.classList.remove("pulse-cleared"), 1400);
    }
    rail.classList.toggle("is-calm", model.calm);
  }
  pulseNeedsYouWas = needsYou;

  widgets.textContent = "";
  if (model.calm) {
    widgets.append(renderPulseCalm(dataById.get("health")));
  } else {
    for (const id of state.widgetIds) {
      const cell = model.cells.find((c) => c.id === id);
      widgets.append(renderSummaryWidget(id, cell ? cell.weight : "normal", dataById.get(id)));
    }
  }
  renderPulseFindings(model);
  renderWidgetCustomizer();
}

/* ---------- issues ---------- */

const ISSUE_STATE_LABELS = {
  open: "Open",
  verifying: "Verifying",
  resolved: "Resolved",
  blocked: "Blocked",
};

function issueLifecycle(issue) {
  return issue && issue.lifecycle && issue.lifecycle.state
    ? issue.lifecycle
    : { state: "open" };
}

function issueStateLabel(issue) {
  return ISSUE_STATE_LABELS[issueLifecycle(issue).state] || "Open";
}

function issueTimestamp(iso) {
  if (!iso || Number.isNaN(Date.parse(iso))) return "unknown time";
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function recentlyResolvedOf(snap) {
  return snap && Array.isArray(snap.recentlyResolved) ? snap.recentlyResolved : [];
}

function issueLifecycleNote(issue) {
  const lifecycle = issueLifecycle(issue);
  if (lifecycle.state === "verifying") {
    return `Verifying since ${issueTimestamp(lifecycle.verificationStartedAt)} · waiting for a fresh source snapshot to clear the finding.`;
  }
  if (lifecycle.state === "blocked") {
    return `Blocked${lifecycle.result ? ` · ${lifecycle.result}` : " · external action is required."}`;
  }
  return "";
}

async function fetchTriageQueue() {
  try {
    const res = await apiFetch("/api/triage/queue", { headers: { accept: "application/json" } }, API_READ_TIMEOUT_MS);
    const body = await res.json();
    if (!res.ok || !body || body.ok !== true || !Array.isArray(body.items)) throw new Error("queue response was invalid");
    state.queueItems = body.items;
    state.queueError = "";
    renderHealthRail();
  } catch (err) {
    /* This used to be console.warn and nothing else. queueItems then stayed [],
       which yields zero queue findings — the same output a genuinely empty queue
       gives — so the strip collapsed to CALM while triage work sat unseen on the
       server. The last known items are kept rather than cleared (dropping them
       would lose real information); the error is what stops them being read as
       the whole truth. */
    state.queueError = err && err.message ? err.message : "Triage queue unavailable";
    console.warn("triage queue fetch failed:", err);
    renderHealthRail();
  }
}

async function triageIssue(issueId, action) {
  const key = action + ":" + issueId;
  if (state.triagePending.has(key)) return;
  state.triagePending.add(key);
  state.triageErrors.delete(issueId);
  renderHealthRail();
  try {
    const res = await apiFetch("/api/triage/" + action, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ issueId }),
    }, API_WRITE_TIMEOUT_MS);
    const body = await res.json();
    if (!res.ok || !body || body.ok !== true) {
      throw new Error(body && body.error && body.error.message ? body.error.message : "HTTP " + res.status);
    }
    const recommendation = body.recommendation || body.item;
    if (recommendation) state.triage.set(issueId, recommendation);
    if (body.item) {
      const withoutIssue = state.queueItems.filter((item) => item.issueId !== issueId);
      state.queueItems = [body.item, ...withoutIssue];
      toast(action === "run" ? "Investigation launched" : "Investigation queued", "ok");
    }
    if (action === "queue" || action === "run") {
      await fetchSnapshot();
      await fetchTriageQueue();
    }
    // Compress Triage→Queue into one beat when the plan is investigation-shaped:
    // queueing is bounded and persistent, and launch stays a separate explicit
    // operator action, so the extra click was a dead stop, not a safety gate.
    if (action === "generate" && recommendation && recommendation.queueRecommended
      && !state.queueItems.some((item) => item.issueId === issueId)) {
      await triageIssue(issueId, "queue");
    }
  } catch (err) {
    state.triageErrors.set(issueId, err && err.message ? err.message : "Triage request failed");
  } finally {
    state.triagePending.delete(key);
    render();
  }
}

/* Cancel a running investigation, or drop a queued/finished record.

   Both are the same route (DELETE /api/triage/queue?issueId=…) because they are
   the same server operation; `intent` only decides what the operator is told.
   A cancel has to visibly STOP the run, not grey out a button, so success is
   read from the server's own `cancelled` flag and the queue + snapshot are
   re-read before anything is claimed. The server refuses to cancel a run it has
   no safe handle for (409) — that refusal is surfaced, never swallowed, because
   a "cancelled" that left the process running is worse than no button. */
async function removeTriageItem(issueId, intent = "remove") {
  const key = intent + ":" + issueId;
  if (state.triagePending.has(key)) return;
  state.triagePending.add(key);
  state.triageErrors.delete(issueId);
  render();
  try {
    const res = await apiFetch("/api/triage/queue?issueId=" + encodeURIComponent(issueId), { method: "DELETE" }, API_WRITE_TIMEOUT_MS);
    let body = null;
    try { body = await res.json(); } catch { /* a build without the route answers HTML */ }
    if (!res.ok || !body || body.ok !== true) {
      throw new Error(body && body.error && body.error.message ? body.error.message : "HTTP " + res.status);
    }
    // The plan itself is deliberately KEPT: removing a run must not also erase
    // the recommendation the operator is about to re-queue. A TriageQueueItem
    // IS a recommendation, so on a page that never generated one locally (a
    // reload mid-investigation) the removed item is what the plan has to come
    // from — otherwise cancelling drops the operator back to "Triage this
    // finding" and the analysis has to be paid for twice.
    const removed = state.queueItems.find((item) => item.issueId === issueId);
    if (removed && !state.triage.has(issueId)) state.triage.set(issueId, removed);
    state.queueItems = state.queueItems.filter((item) => item.issueId !== issueId);
    toast(body.cancelled ? "Investigation cancelled" : "Investigation record removed", "ok");
    await fetchSnapshot();
    await fetchTriageQueue();
  } catch (err) {
    state.triageErrors.set(issueId, err && err.message ? err.message : "Could not update the investigation queue");
  } finally {
    state.triagePending.delete(key);
    render();
  }
}

/* Parse freeform investigation result text into a brief-friendly shape.
   Luna may emit markdown headings, labeled lines, bullets, or a one-liner.
   Display-only — never mutates triage state. Graceful on unstructured text. */
function parseInvestigationResult(text) {
  const raw = String(text ?? "").trim();
  const empty = { headline: "", summary: "", findings: [], actions: [], blockers: [], structured: false, raw };
  if (!raw) return empty;

  const ACTION_RE = /^(?:next(?:\s+(?:steps?|actions?))?|action(?:s)?|what to do(?: next)?|recommended?(?:\s+path)?|follow[- ]?up|repair|fix)\s*[:—-]\s*(.+)$/i;
  const BLOCKER_RE = /^(?:blocker|blocked(?:\s+by)?|blocking|external blocker)\s*[:—-]\s*(.+)$/i;
  const FINDING_RE = /^(?:finding(?:s)?|root cause|cause|summary|result|outcome|what happened)\s*[:—-]\s*(.+)$/i;
  const HEADING_RE = /^#{1,3}\s+(.+)$/;
  const BULLET_RE = /^(?:[-*•]|\d+[.)])\s+(.+)$/;
  const LABEL_ONLY_RE = /^(?:findings?|root cause|cause|summary|result|outcome|what happened|next(?:\s+(?:steps?|actions?))?|action(?:s)?|what to do(?: next)?|recommended?(?:\s+path)?|follow[- ]?up|repair|fix|blocker|blocked(?:\s+by)?|blocking|verification|evidence)\s*[:—-]?\s*$/i;

  const findings = [];
  const actions = [];
  const blockers = [];
  const paragraphs = [];
  let bucket = "body";
  let headlineSource = "";

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const heading = trimmed.match(HEADING_RE);
    if (heading) {
      const title = heading[1].trim();
      if (/block/i.test(title)) bucket = "blockers";
      else if (/next|action|repair|fix|recommend|follow/i.test(title)) bucket = "actions";
      else if (/find|cause|root|evidence|verif|summary|result|outcome/i.test(title)) bucket = "findings";
      else bucket = "body";
      continue;
    }

    if (LABEL_ONLY_RE.test(trimmed)) {
      if (/block/i.test(trimmed)) bucket = "blockers";
      else if (/next|action|repair|fix|recommend|follow/i.test(trimmed)) bucket = "actions";
      else bucket = "findings";
      continue;
    }

    const actionMatch = trimmed.match(ACTION_RE);
    if (actionMatch) {
      actions.push(actionMatch[1].trim());
      bucket = "actions";
      continue;
    }
    const blockerMatch = trimmed.match(BLOCKER_RE);
    if (blockerMatch) {
      const value = blockerMatch[1].trim();
      if (!/^(none|n\/a|no\b|—|-)\b/i.test(value)) blockers.push(value);
      bucket = "blockers";
      continue;
    }
    const findingMatch = trimmed.match(FINDING_RE);
    if (findingMatch) {
      const value = findingMatch[1].trim();
      findings.push(value);
      if (!headlineSource) headlineSource = value;
      bucket = "findings";
      continue;
    }

    const bulletMatch = trimmed.match(BULLET_RE);
    if (bulletMatch) {
      const item = bulletMatch[1].trim();
      if (bucket === "actions") actions.push(item);
      else if (bucket === "blockers") blockers.push(item);
      else findings.push(item);
      continue;
    }

    if (bucket === "actions") actions.push(trimmed);
    else if (bucket === "blockers") blockers.push(trimmed);
    else if (bucket === "findings") {
      findings.push(trimmed);
      if (!headlineSource) headlineSource = trimmed;
    } else {
      paragraphs.push(trimmed);
      if (!headlineSource) headlineSource = trimmed;
    }
  }

  function firstSentence(value) {
    const source = String(value || "").trim();
    if (!source) return "";
    const match = source.match(/^(.+?[.!?])(?:\s|$)/);
    const sentence = (match ? match[1] : source).trim();
    if (sentence.length <= 160) return sentence;
    return sentence.slice(0, 157).replace(/\s+\S*$/, "") + "…";
  }

  const headline = firstSentence(headlineSource || findings[0] || blockers[0] || actions[0] || raw);
  let summary = "";
  const extraParagraphs = paragraphs.filter((p) => p !== headlineSource);
  if (extraParagraphs.length) summary = extraParagraphs.join(" ");
  else if (paragraphs.length === 1 && paragraphs[0].length > headline.length + 8) {
    summary = paragraphs[0].slice(headline.length).trim().replace(/^[\s.]+/, "");
  }

  const structured = findings.length > 0 || actions.length > 0 || blockers.length > 0 || paragraphs.length > 1;
  return { headline, summary, findings, actions, blockers, structured, raw };
}

function investigationResultNextSteps(parsed, outcome) {
  if (parsed.actions.length) return parsed.actions.slice();

  const lower = parsed.raw.toLowerCase();
  if (outcome === "blocked") {
    if (lower.includes("requeue")) {
      return ["Requeue from the current issue evidence, then launch a fresh read-only investigation."];
    }
    if (lower.includes("10-minute") || lower.includes("runtime limit") || lower.includes("timed out")) {
      return ["Retry with a narrower investigation scope, or act on the evidence already on the finding."];
    }
    if (parsed.blockers.length) {
      return ["Address the blocker above, or requeue once the external condition changes."];
    }
    return ["Review the blocker, then requeue or take one precise follow-up from current evidence."];
  }
  return ["Wait for the next source snapshot — this finding clears when evidence is gone."];
}

/* One primary, wired action for a finished investigation. Blocked results
   regenerate a fresh plan from the current issue evidence (the server queue
   holds one item per finding, so a true requeue is not available); verifying
   results re-pull the source snapshot that clears the finding. */
function investigationResultCta(outcome, issueId) {
  if (!issueId) return null;
  if (outcome === "blocked") {
    const busy = state.triagePending.has("generate:" + issueId);
    return el("button", {
      type: "button",
      class: "btn primary triage-briefing-cta",
      disabled: busy ? "" : null,
      "aria-busy": busy ? "true" : null,
      dataset: { fkey: "briefing-cta:" + issueId },
      onclick: () => triageIssue(issueId, "generate"),
    }, busy ? "Retriaging…" : "Retriage from evidence");
  }
  return el("button", {
    type: "button",
    class: "btn primary triage-briefing-cta",
    dataset: { fkey: "briefing-cta:" + issueId },
    onclick: () => { void fetchSnapshot(); void fetchTriageQueue(); },
  }, "Check source now");
}

// Fix briefing for investigation results — headline, what happened, what to do,
// with raw output collapsed. Used by intervention/advisory triage and the
// investigation drawer. `outcome` is "completed" or "blocked"; `opts.issueId`
// wires the one primary follow-up action; `opts.startedAt`/`opts.completedAt`
// feed the mono timestamps in the action row.
const BRIEFING_MAX_BULLETS = 3;

/* A bullet shaped like "`542577F9…` → `ttys003`" is evidence routing, not
   prose — the result card renders those as a route table (mockup C1). Only a
   clear single arrow with short endpoints qualifies; anything else stays a
   plain bullet. Pure, exported for tests. */
function routeFromBullet(text) {
  const raw = String(text ?? "").trim();
  if (!raw || raw.length > 120) return null;
  // Endpoints are identifiers (session ids, ttys, paths) — never words with
  // spaces, never chained arrows. Prose with an arrow mid-sentence stays prose.
  const match = raw.match(/^`?([^\s`→>]{1,60})`?\s*(?:→|->)\s*`?([^\s`→>]{1,60})`?$/);
  if (!match) return null;
  const from = match[1].trim();
  const to = match[2].trim();
  if (!from || !to) return null;
  return { from, to };
}

function renderInvestigationResult(resultText, outcome, opts = {}) {
  const blocked = outcome === "blocked";
  const parsed = parseInvestigationResult(resultText);
  const headline = parsed.headline || (blocked ? "Investigation blocked" : "Investigation complete");
  const nextSteps = investigationResultNextSteps(parsed, blocked ? "blocked" : "completed");
  const seen = new Set([headline, parsed.headline].filter(Boolean));
  // Body cap: blockers first, then findings, at most three bullets total —
  // everything else stays in the collapsed Raw output. Route-shaped bullets
  // render as an evidence table and do not count against the cap.
  const blockers = parsed.blockers.filter((item) => !seen.has(item)).slice(0, BRIEFING_MAX_BULLETS);
  const routes = parsed.findings.map(routeFromBullet).filter(Boolean);
  const findings = parsed.findings.filter((item) => !seen.has(item) && !routeFromBullet(item))
    .slice(0, Math.max(0, BRIEFING_MAX_BULLETS - blockers.length));
  const summary = parsed.summary && parsed.summary !== headline ? parsed.summary : "";
  let bodyShown = false;

  // Verdict head (mockup C1): outcome glyph ring + plain-language verdict,
  // state chip and note on the right. The glyph is the image; no banner fill.
  const briefing = el("section", {
    class: "triage-result triage-briefing" + (blocked ? " triage-briefing--blocked" : " triage-briefing--ok"),
    "aria-label": blocked ? "Blocked investigation result" : "Investigation result",
  },
    el("div", { class: "brf-head" },
      el("span", { class: "brf-glyph", "aria-hidden": "true" }, icon(blocked ? "warning" : "check")),
      el("div", { class: "brf-lede" },
        el("p", { class: "triage-briefing-headline", text: headline })),
      el("div", { class: "brf-state" },
        el("span", { class: "triage-briefing-status", text: blocked ? "Blocked" : "Complete" }),
        el("span", { class: "triage-briefing-kicker-note", text: blocked
          ? "Operator review needed"
          : "Waiting for fresh data" }))));

  if (summary && !blockers.length && !findings.length) {
    briefing.append(el("p", { class: "triage-briefing-summary", text: summary }));
    bodyShown = true;
  } else if (findings.length === 0 && blockers.length === 0 && !parsed.structured && parsed.raw && parsed.raw !== headline) {
    const rest = parsed.raw.slice(headline.length).trim().replace(/^[\s.]+/, "");
    if (rest) {
      briefing.append(el("p", { class: "triage-briefing-summary", text: rest }));
      bodyShown = true;
    }
  }

  if (routes.length) {
    briefing.append(el("div", { class: "brf-routes", role: "table", "aria-label": "Evidence routes" },
      el("div", { class: "brf-routes-head", text: "Evidence" }),
      routes.map((route) => el("div", { class: "brf-route", role: "row" },
        el("span", { class: "brf-route-from", text: route.from }),
        el("span", { class: "brf-route-arr", "aria-hidden": "true", text: "→" }),
        el("span", { class: "brf-route-to", text: route.to })))));
    bodyShown = true;
  }

  if (blockers.length) {
    briefing.append(el("div", { class: "triage-briefing-section" },
      el("h4", { class: "triage-briefing-label", text: "What's blocking" }),
      el("ul", { class: "triage-briefing-list" }, blockers.map((item) => el("li", { text: item })))));
    bodyShown = true;
  }

  if (findings.length) {
    briefing.append(el("div", { class: "triage-briefing-section" },
      el("h4", { class: "triage-briefing-label", text: "What happened" }),
      el("ul", { class: "triage-briefing-list" }, findings.map((item) => el("li", { text: item })))));
    bodyShown = true;
  }

  if (!bodyShown) {
    briefing.append(el("p", { class: "triage-briefing-summary triage-briefing-summary--quiet", text: blocked
      ? "The investigation could not finish a safe repair path."
      : "The investigation finished and is waiting on fresh source evidence." }));
  }

  // One primary button first; short supporting prose after (never prose-only).
  // Mono timestamps ride the right edge of the action row when the queue item
  // reported them — never synthesized.
  const cta = investigationResultCta(blocked ? "blocked" : "completed", opts.issueId);
  const times = [];
  if (opts.completedAt && Number.isFinite(Date.parse(opts.completedAt))) {
    times.push((blocked ? "blocked " : "completed ") + issueTimestamp(opts.completedAt));
  }
  if (opts.startedAt && Number.isFinite(Date.parse(opts.startedAt))) {
    times.push("started " + issueTimestamp(opts.startedAt));
  }
  briefing.append(el("div", { class: "triage-briefing-section triage-briefing-next" },
    el("h4", { class: "triage-briefing-label", text: "What to do next" }),
    el("div", { class: "brf-actions" },
      cta,
      times.length ? el("span", { class: "brf-times" }, times.map((t) => el("i", { text: t }))) : null),
    el("ul", { class: "triage-briefing-list triage-briefing-list--next" },
      nextSteps.slice(0, 2).map((item) => el("li", { text: item })))));

  briefing.append(el("details", { class: "triage-briefing-raw" },
    el("summary", { text: "Raw output" }),
    el("pre", { text: parsed.raw })));

  return briefing;
}

/* The lifecycle levers beside Queue/Launch. Returns an array so the caller can
   spread it — an empty array when there is no queue record at all, which keeps
   an untriaged finding's row exactly as it was.

     running            -> Cancel investigation (stops the process)
     queued             -> Remove from queue
     completed/blocked  -> Investigate again + Remove record

   "Investigate again" re-POSTs /api/triage/queue: the server replaces any item
   that is not queued or running, so the same call is both the first queue and
   the rerun. No second route, no second vocabulary. */
function triageLifecycleControls(issue, queueItem, queueing, ui = state) {
  if (!queueItem) return [];
  const id = issue.id;
  const cancelling = ui.triagePending.has("cancel:" + id);
  const removing = ui.triagePending.has("remove:" + id);
  const lever = (kind, cls, label, busy, onclick) => el("button", {
    type: "button",
    class: "btn sm " + cls,
    disabled: busy ? "" : null,
    "aria-busy": busy ? "true" : null,
    dataset: { fkey: "triage-" + kind + ":" + id },
    onclick,
  }, label);

  if (queueItem.state === "running") {
    return [lever("cancel", "triage-cancel", cancelling ? "Cancelling…" : "Cancel investigation", cancelling,
      () => removeTriageItem(id, "cancel"))];
  }
  if (queueItem.state === "queued") {
    return [lever("remove", "triage-remove", removing ? "Removing…" : "Remove from queue", removing,
      () => removeTriageItem(id, "remove"))];
  }
  return [
    lever("rerun", "triage-rerun", queueing ? "Requeueing…" : "Investigate again", queueing,
      () => triageIssue(id, "queue")),
    lever("remove", "triage-remove", removing ? "Removing…" : "Remove record", removing,
      () => removeTriageItem(id, "remove")),
  ];
}

function renderTriage(issue, ui = state) {
  const queueItem = ui.queueItems.find((item) => item.issueId === issue.id);
  // A queue item IS a recommendation (TriageQueueItem extends it), so a page
  // reload mid-investigation still shows the plan — not a stale Triage button.
  const recommendation = ui.triage.get(issue.id) || queueItem;
  const queued = !!queueItem;
  const generating = ui.triagePending.has("generate:" + issue.id);
  const queueing = ui.triagePending.has("queue:" + issue.id);
  const launching = ui.triagePending.has("run:" + issue.id);
  const error = ui.triageErrors.get(issue.id);
  const wrap = el("div", { class: "triage-actions" });

  if (!recommendation) {
    wrap.append(el("button", {
      type: "button",
      class: "btn triage-generate",
      disabled: generating ? "" : null,
      "aria-busy": generating ? "true" : null,
      dataset: { fkey: "triage:" + issue.id },
      onclick: () => triageIssue(issue.id, "generate"),
    }, generating ? "Triaging…" : "Triage this finding"));
  } else {
    // Instrument brief (mockup B1): verdict head → vitals band → the plan as
    // an always-visible horizontal step spine → rationale foot. The band only
    // shows instruments we actually know (runModel splits into model/effort/
    // access when the launcher reported them; nothing is fabricated).
    const qState = queueItem ? queueItem.state : null;
    const live = qState ? investigationView(qState) : { label: "Plan ready", tone: "cool" };
    const inst = (value, label) => el("span", { class: "tri-inst" },
      el("span", { class: "tri-inst-v", text: value }),
      el("span", { class: "tri-inst-k", text: label }));
    const band = el("div", { class: "tri-band" });
    const modelParts = queueItem && queueItem.runModel
      ? String(queueItem.runModel).split(/\s*·\s*/).filter(Boolean) : [];
    if (modelParts[0]) band.append(inst(modelParts[0], "model"));
    if (modelParts[1]) band.append(inst(modelParts[1], "effort"));
    if (modelParts[2]) band.append(inst(modelParts[2], "access"));
    if (Number.isFinite(recommendation.affectedAgents) && Number.isFinite(recommendation.affectedPrograms)) {
      band.append(inst(recommendation.affectedAgents + " agents · " + recommendation.affectedPrograms + " programs", "scope"));
    }
    if (Array.isArray(recommendation.providers) && recommendation.providers.length) {
      band.append(inst(recommendation.providers.join(" · "), "evidence"));
    }
    const clockFrom = qState === "completed" || qState === "blocked"
      ? queueItem.startedAt : qState === "running" ? queueItem.startedAt : queueItem ? queueItem.createdAt : null;
    const clockTo = (qState === "completed" || qState === "blocked") && queueItem.completedAt
      ? Date.parse(queueItem.completedAt) : Date.now();
    if (clockFrom && Number.isFinite(Date.parse(clockFrom))) {
      band.append(inst(fmtElapsed(Math.max(0, clockTo - Date.parse(clockFrom))),
        qState === "completed" || qState === "blocked" ? "ran for" : qState === "running" ? "elapsed" : "queued"));
    }
    const plan = el("section", { class: "triage-plan tri-card", "aria-label": "Generated triage" },
      el("div", { class: "tri-head" },
        el("span", { class: "tri-kind tri-kind-" + recommendation.mode, text: recommendation.mode }),
        el("strong", { class: "triage-outcome", text: recommendation.headline }),
        el("span", { class: "tri-live tri-live-" + live.tone },
          el("i", { "aria-hidden": "true" }), live.label)),
      band.childElementCount ? band : null,
      el("ol", { class: "tri-spine" + (qState === "completed" ? " is-done" : "") },
        recommendation.steps.map((step, index) => el("li", { class: "tri-step" },
          el("span", { class: "tri-dot", "aria-hidden": "true", text: qState === "completed" ? "✓" : String(index + 1) }),
          el("strong", { text: step.title }),
          el("span", { text: step.detail })))),
      el("p", { class: "triage-rationale", text: recommendation.rationale }));

    if (recommendation.queueRecommended) {
      plan.append(el("div", { class: "triage-queue-row" },
        el("button", {
          type: "button",
          class: "btn triage-queue",
          disabled: queued || queueing ? "" : null,
          "aria-busy": queueing ? "true" : null,
          dataset: { fkey: "triage-queue:" + issue.id },
          onclick: () => triageIssue(issue.id, "queue"),
        }, queued
          ? investigationView(queueItem.state).button
          : queueing ? "Queueing…" : "Queue investigation"),
        queueItem && queueItem.state === "queued" ? el("button", {
          type: "button",
          class: "btn triage-run",
          disabled: launching ? "" : null,
          "aria-busy": launching ? "true" : null,
          dataset: { fkey: "triage-run:" + issue.id },
          onclick: () => triageIssue(issue.id, "run"),
        }, launching ? "Launching…" : "Launch read-only Luna") : null,
        // Lifecycle. A finding used to be investigable exactly once, ever: a run
        // that finished, or one launched by mistake, was a permanent record with
        // no way back. Cancel is offered only while a run is live, and it stops
        // the process rather than hiding the button; rerun re-queues from the
        // same plan; remove clears a finished record.
        ...triageLifecycleControls(issue, queueItem, queueing, ui),
        el("span", { class: "triage-queue-note", text: queueItem
          ? investigationView(queueItem.state).note
            + (queueItem.state === "running" ? " · " + (queueItem.runModel || "native Luna") : "")
          : "Queues a bounded investigation. Launch remains a separate operator action." })));
      if (queueItem && queueItem.result) {
        plan.append(renderInvestigationResult(queueItem.result, queueItem.state === "blocked" ? "blocked" : "completed",
          { issueId: issue.id, startedAt: queueItem.startedAt, completedAt: queueItem.completedAt }));
      }
    }
    wrap.append(plan);
  }
  if (error) wrap.append(el("p", { class: "triage-error", role: "alert", text: error + " — retry the triage action." }));
  return wrap;
}

/* Work-state for a finding — answers "is anyone on this?" so the board does not
   feel like purgatory. Live optimistic signals (in-flight triage, queue, local
   plan, lifecycle) win first so the UI reacts before the next snapshot; when
   none apply we defer to the server-owned issue.workState, then a severity
   default. Source clearance (lifecycle resolved) outranks a stale queue row. */
function issueWorkState(issue, queueItems = state.queueItems) {
  if (!issue) return { key: "watching", label: "Watching", tone: "info" };
  const id = issue.id;
  if (state.triagePending.has("generate:" + id) || state.triagePending.has("queue:" + id) || state.triagePending.has("run:" + id)) {
    return { key: "triaging", label: "Triaging", tone: "warn" };
  }
  const life = issueLifecycle(issue);
  if (life.state === "resolved") return { key: "cleared", label: "Cleared", tone: "moss" };
  const items = Array.isArray(queueItems) ? queueItems : [];
  const queueItem = items.find((item) => item.issueId === id);
  if (queueItem) {
    if (queueItem.state === "running") return { key: "investigating", label: "Investigating", tone: "info" };
    if (queueItem.state === "queued") return { key: "queued", label: "Queued", tone: "info" };
    if (queueItem.state === "completed") return { key: "verifying", label: "Verifying", tone: "warn" };
    if (queueItem.state === "blocked") return { key: "blocked", label: "Blocked", tone: "error" };
  }
  if (state.triage.has(id)) return { key: "planned", label: "Plan ready", tone: "info" };
  if (life.state === "verifying") return { key: "verifying", label: "Verifying", tone: "warn" };
  if (life.state === "blocked") return { key: "blocked", label: "Blocked", tone: "error" };
  if (issue.workState && WORK_STATE_VIEW[issue.workState]) return WORK_STATE_VIEW[issue.workState];
  if (issue.severity === "error") return { key: "needs", label: "Needs triage", tone: "error" };
  return { key: "watching", label: "Watching", tone: "warn" };
}

/* Discrete stage index 1–4 for the finding rail (Watch → Triage → Verify → Cleared). */
function issueStage(workKeyOrIssue) {
  const key = typeof workKeyOrIssue === "string"
    ? workKeyOrIssue
    : issueWorkState(workKeyOrIssue).key;
  return STAGE_BY_WORK[key] ?? 1;
}

/* Progress 0–100 for a finding's rail — server-owned issue.progress wins;
   otherwise derived from the work state. */
function issueProgress(issue) {
  if (issue && typeof issue.progress === "number" && Number.isFinite(issue.progress)) {
    return Math.max(0, Math.min(100, issue.progress));
  }
  return PROGRESS_BY_WORK[issueWorkState(issue).key] ?? 0;
}

/* Plain-language impact line for a row — server-owned issue.impactSummary wins;
   otherwise the local affectedImpact rollup sentence. Never "Affects (N)". */
function issueImpactLine(issue, snap = state.snap) {
  if (issue && typeof issue.impactSummary === "string" && issue.impactSummary.trim()) {
    return issue.impactSummary.trim();
  }
  return affectedImpact(issue, snap).plain;
}

const IN_MOTION_KEYS = new Set(["triaging", "planned", "queued", "investigating", "verifying"]);

/* Ordered, flattened finding list for the pulse strip's inline expansion — the
   same set the old lanes rendered, minus resolved (those live in the drawer
   and History): interventions that still need a human first, then advisories,
   in-motion work, and orphan queue rows whose issue has left the snapshot. */
function pulseFindings(snap, queueItems = state.queueItems) {
  const issues = issuesOf(snap);
  const issueFindings = issues.map((issue) =>
    findingFromIssue(issue, issue.severity === "error" ? "intervention" : "advisory", snap));
  const issueIds = new Set(issues.map((issue) => issue.id));
  const resolvedIds = new Set(recentlyResolvedOf(snap).map((issue) => issue.id));
  const items = Array.isArray(queueItems) ? queueItems : [];
  const orphanQueueFindings = items
    .filter((item) => !issueIds.has(item.issueId) && !resolvedIds.has(item.issueId))
    .map(findingFromQueueItem);
  return [
    ...issueFindings.filter((f) => f.kind === "intervention" && !IN_MOTION_KEYS.has(f.work.key)),
    ...issueFindings.filter((f) => f.kind === "advisory" && !IN_MOTION_KEYS.has(f.work.key)),
    ...issueFindings.filter((f) => IN_MOTION_KEYS.has(f.work.key)),
    ...orphanQueueFindings,
  ];
}

/* Pure strip model — the renderer and tests share one derivation. calm means
   nothing needs the operator: zero live findings, an operational system, and
   no session near its context ceiling. cells carry the fixed-order weighting
   (urgency changes weight via cell-hot/cell-micro, never order); findings is
   the ordered inline-expansion list. */
function pulseStripModel(snap, conn = "live", queueItems = [], display = "percent", queueError = "") {
  const attention = attentionSummary(snap);
  const status = systemStatus(snap, conn);
  const peak = peakContext(snap);
  /* Calm is a claim about the WHOLE board, so it cannot be made while one of the
     board's inputs is missing. An unreachable triage queue contributes zero
     findings exactly like an empty one; without this the strip would fold into
     its calm line and hide the fact that it is reasoning on partial evidence. */
  const calm = !!snap && !!attention && attention.count === 0
    && status.key === "operational" && !(peak && peak.pct >= 85) && !queueError;
  // `display` is threaded so renderHealthRail can compute each widget's data
  // ONCE and reuse it for the paint signature, the cell and the calm line —
  // it used to derive the same three from scratch on every paint.
  const cells = DEFAULT_WIDGET_IDS.map((id) => {
    const data = summaryWidgetData(id, snap, conn, display, queueItems, undefined, queueError);
    // An advisory rides at micro alongside "ok": in both cases there is nothing
    // for the operator to do right now, which is what cell weight communicates.
    const weight = id === "health"
      ? (data.tone === "ok" || data.tone === "advisory" ? "micro" : "normal")
      : data.tone === "hot" ? "hot" : "normal";
    return { id, weight, data };
  });
  return { calm, cells, findings: pulseFindings(snap, queueItems), queueError };
}

function findingFromIssue(issue, kind, snap = state.snap) {
  const work = issueWorkState(issue);
  const rollup = affectedImpact(issue, snap);
  const life = issue.lifecycle;
  return {
    kind,
    id: issue.id,
    title: issue.title,
    work,
    impact: issueImpactLine(issue, snap),
    summary: issue.summary || issueImpactLine(issue, snap),
    evidence: rollup.programs.map((program) => program.name + " · " + program.count),
    since: life && (life.verificationStartedAt || life.openedAt) || null,
    progress: issueProgress(issue),
    pin: kind === "intervention" && work.key === "needs",
  };
}

function findingFromQueueItem(item) {
  const view = investigationView(item.state);
  const work = WORK_STATE_VIEW[view.work] || WORK_STATE_VIEW.queued;
  const scope = Number.isFinite(item.affectedAgents) && Number.isFinite(item.affectedPrograms)
    ? item.affectedAgents + " agents · " + item.affectedPrograms + " programs" : "";
  return {
    kind: "investigation",
    id: item.issueId,
    title: item.headline,
    work,
    impact: "Investigation " + view.label.toLowerCase(),
    summary: "Investigation " + view.label.toLowerCase(),
    evidence: [scope, item.runModel || ""].filter(Boolean),
    since: item.startedAt || item.createdAt || null,
    progress: PROGRESS_BY_WORK[work.key] ?? 50,
    pin: false,
  };
}

/* Two-line ledger row (mockup A2): full title + live summary on the first
   line, a mono evidence line under it, and a right-aligned instrument
   cluster — compact stage rail, state word, age. Every pixel of strip width
   carries information; nothing stretches to fill. */
function renderFindingRow(finding) {
  const visual = FINDING_VISUAL[finding.work.key] || FINDING_VISUAL.watching;
  const selected = state.selected && state.selected.kind === finding.kind && state.selected.id === finding.id;
  const open = () => selectEntity({ kind: finding.kind, id: finding.id });
  const stage = issueStage(finding.work.key);
  const stageName = STAGE_LABELS[stage - 1] || finding.work.label;
  const railClass = "stage-rail" + (visual.rail ? " " + visual.rail : "");
  const evidence = (Array.isArray(finding.evidence) ? finding.evidence : []).filter(Boolean);
  const sinceMs = finding.since ? Date.parse(finding.since) : NaN;
  const age = Number.isFinite(sinceMs) ? fmtElapsed(Math.max(0, Date.now() - sinceMs)) : "";
  return el("button", {
    type: "button",
    class: "finding" + (finding.pin ? " pin" : "") + (selected ? " is-selected" : ""),
    dataset: { fkey: "finding:" + finding.kind + ":" + finding.id },
    "aria-label": "Open " + finding.work.label + ": " + finding.title,
    onclick: open,
  },
    el("span", { class: "glyph " + visual.glyph, "aria-hidden": "true" }),
    el("span", { class: "copy" },
      el("span", { class: "lede" },
        el("span", { class: "title", text: finding.title }),
        el("span", { class: "gist", text: finding.summary || finding.impact })),
      evidence.length ? el("span", { class: "trace" },
        evidence.map((token) => el("i", { text: token }))) : null),
    el("span", { class: "meta" },
      el("span", {
        class: railClass,
        "aria-label": "Stage: " + stageName + " (" + stage + " of 4)",
        "data-stage": String(stage),
      }, el("i"), el("i"), el("i"), el("i")),
      el("span", { class: "state st-" + (visual.st || "cool"), text: finding.work.label }),
      age ? el("span", { class: "age", text: age }) : null));
}

function togglePulseFindings() {
  state.pulseExpanded = !state.pulseExpanded;
  // The findings ledger and the widget customizer are both summary-strip (chrome)
  // expansions; opening both at once could exceed the viewport, so they are
  // mutually exclusive — opening the findings collapses the customizer.
  if (state.pulseExpanded) state.widgetCustomizerOpen = false;
  else state.pulseShowAll = false;
  renderHealthRail();
}

/* Inline expansion under the strip — at most MAX_PULSE_ROWS finding rows plus
   an in-place "+N more"/"Show less" control. Rows open the drawer; triage and
   queue actions stay drawer-only. */
function renderPulseFindings(model) {
  const panel = $("pulse-findings");
  if (!panel) return;
  const open = !model.calm && state.pulseExpanded && model.findings.length > 0;
  panel.hidden = !open;
  panel.textContent = "";
  if (!open) return;
  const visible = state.pulseShowAll ? model.findings : model.findings.slice(0, MAX_PULSE_ROWS);
  for (const finding of visible) panel.append(renderFindingRow(finding));
  const more = model.findings.length - MAX_PULSE_ROWS;
  if (more > 0) {
    panel.append(el("button", {
      type: "button",
      class: "pulse-more",
      dataset: { fkey: "pulse-more" },
      onclick: () => { state.pulseShowAll = !state.pulseShowAll; renderHealthRail(); },
      text: state.pulseShowAll ? "Show less" : ("+" + more + " more"),
    }));
  }
}

/* ---------- toolbar ---------- */

function currentFilter() {
  return (agent, program) =>
    viewMatches(state.view, agent) &&
    (!lookbackApplies(state.view) || withinLookback(agent, state.lookbackHours)) &&
    matchesQuery(agent, program, state.query) &&
    (!state.facetProgram || program.id === state.facetProgram) &&
    (!state.facetProvider || agent.provider === state.facetProvider);
}

function renderTabs() {
  const agents = snapshotAgents(state.snap).map((x) => x.agent);
  for (const view of OPS_VIEWS) {
    const countNode = $("count-" + view);
    if (!countNode) continue;
    const count = state.snap
      ? agents.filter((a) =>
          viewMatches(view, a) && (!lookbackApplies(view) || withinLookback(a, state.lookbackHours)),
        ).length
      : null;
    countNode.textContent = count == null ? "" : String(count);
    // The Alerts (needs-you) tab count takes ember ink when there is anything to
    // act on; a zero count and every other tab stay quiet (C2's is-alerting modifier).
    if (view === "needs-you") countNode.classList.toggle("is-alerting", count > 0);
  }
  for (const btn of document.querySelectorAll("#views .view-tab")) {
    const isCurrent = btn.dataset.view === state.view;
    btn.setAttribute("aria-pressed", String(isCurrent));
    btn.classList.toggle("is-current", isCurrent);
  }
  const toggle = $("select-toggle");
  if (toggle) {
    toggle.hidden = state.view === "usage";
    toggle.setAttribute("aria-pressed", String(state.selecting));
    toggle.textContent = state.selecting ? "Done selecting" : "Select";
  }
  const search = $("search");
  const opsRow = $("ops-toolbar-row");
  if (opsRow) opsRow.hidden = state.view === "usage";
  if (search) search.disabled = state.view === "usage";
}

/* Every chip carries a data-fkey. renderFilterBar tears the whole bar down on
   each paint, so without one a keyboard operator's focus fell to <body> roughly
   fifteen times a minute — render()'s focus-restore contract keys on nothing
   else. The key is stable across paints (it names the control, not the label). */
function filterChip(label, active, onclick, opts = {}) {
  return el("button", {
    type: "button",
    // is-unverified marks a chip whose value the server never confirmed, so a
    // built-in default cannot pass for a reported one.
    class: "filter-chip" + (active ? " is-active" : "") + (opts.alert ? " is-unverified" : ""),
    "aria-pressed": String(Boolean(active)),
    disabled: opts.disabled ? "" : null,
    title: opts.title || null,
    dataset: opts.fkey ? { fkey: opts.fkey } : null,
    onclick,
  }, label);
}

/* Lookback + scan-window controls for Idle/History; Usage range for Usage. */
function renderFilterBar(ui = state) {
  const bar = $("filter-bar");
  if (!bar) return;
  bar.textContent = "";
  if (ui.view === "usage") {
    bar.hidden = false;
    bar.setAttribute("aria-hidden", "false");
    bar.append(el("span", { class: "filter-lead", text: "Range" }));
    for (const preset of USAGE_RANGE_PRESETS) {
      bar.append(filterChip(preset.label, ui.usageRangeId === preset.id, () => {
        state.usageRangeId = preset.id;
        state.usageCustomHours = preset.hours;
        void loadUsageData(true);
        render();
      }, { fkey: "usage-range:" + preset.id }));
    }
    const customActive = ui.usageRangeId === "custom";
    bar.append(filterChip(
      customActive ? ("Custom " + ui.usageCustomHours + "h") : "Custom",
      customActive,
      () => {
        const raw = window.prompt("Usage range hours", String(state.usageCustomHours || 24));
        if (raw == null) return;
        const hours = Math.max(1, Math.min(24 * 90, Math.round(Number(raw))));
        if (!Number.isFinite(hours)) return;
        state.usageRangeId = "custom";
        state.usageCustomHours = hours;
        void loadUsageData(true);
        render();
      },
      { fkey: "usage-range:custom" },
    ));
    return;
  }
  if (!lookbackApplies(ui.view)) {
    bar.hidden = true;
    bar.setAttribute("aria-hidden", "true");
    return;
  }
  bar.hidden = false;
  bar.setAttribute("aria-hidden", "false");
  bar.append(el("span", { class: "filter-lead", text: "Lookback" }));
  for (const hours of LOOKBACK_PRESETS) {
    bar.append(filterChip(hours + "h", ui.lookbackHours === hours, () => setLookbackHours(hours), {
      fkey: "lookback:" + hours,
    }));
  }
  bar.append(filterChip("All", ui.lookbackHours == null, () => setLookbackHours(null), {
    title: "Show every session inside the collector scan window",
    fkey: "lookback:all",
  }));
  const customActive = ui.lookbackHours != null && !LOOKBACK_PRESETS.includes(ui.lookbackHours);
  bar.append(filterChip(
    customActive ? ("Custom " + ui.lookbackHours + "h") : "Custom",
    customActive,
    () => {
      const raw = window.prompt("Lookback hours", String(state.lookbackHours || DEFAULT_LOOKBACK_HOURS));
      if (raw == null) return;
      setLookbackHours(raw);
    },
    { fkey: "lookback:custom" },
  ));
  bar.append(el("span", { class: "filter-lead", text: "Scan" }));
  /* The snapshot is the authoritative carrier; /api/settings is the boot path
     that fills this in before one arrives. When neither answered, the number is
     a hard-coded default, and printing "36h window" claims the server confirmed
     it. Say it is unverified instead — the chip still works, it just stops
     asserting. */
  const confirmed = Number((ui.snap && ui.snap.scanWindowHours) || 0) || 0;
  const scanHours = confirmed || Number(ui.scanWindowHours) || 36;
  const unverified = !confirmed && !!ui.settingsError;
  bar.append(filterChip(
    unverified ? "window unverified" : scanHours + "h window",
    false,
    () => {
      const raw = window.prompt("Collector scan window hours (1–168)", String(scanHours));
      if (raw == null) return;
      void postScanWindow(raw);
    },
    {
      disabled: ui.settingsPending,
      title: unverified
        ? "The server did not report its scan window (" + ui.settingsError + "). Showing the built-in default of " + scanHours + "h."
        : "How far back collectors harvest sessions",
      fkey: "scan-window",
      alert: unverified,
    },
  ));
}

function renderScopeNote(shown) {
  const note = $("scope-note");
  if (!note) return;
  if (state.view === "usage") {
    const range = usageRangeHours();
    note.textContent = state.usageLoading
      ? "Loading BurnBar usage…"
      : `Usage range ${range}h · source BurnBar` + (state.usageSummary && state.usageSummary.available === false
        ? " · unavailable"
        : "");
    return;
  }
  if (!state.snap) { note.textContent = ""; return; }
  const t = totalsOf(state.snap);
  const scan = state.snap.scanWindowHours || state.scanWindowHours;
  let text = `${shown} shown · ${t.live} live · ${t.tracked} tracked`;
  if (lookbackApplies(state.view)) {
    text += ` · lookback ${lookbackLabel(state.lookbackHours)} · scan ${scan}h`;
  }
  if (state.query || state.facetProgram || state.facetProvider) text += " · filters applied";
  if (state.fetchFailed) text += " · last refresh failed";
  note.textContent = text;
}

/* ---------- program list ---------- */

function programOpen(program, ui = state) {
  const override = ui.programOverrides.get(program.id);
  if (override) return override === "open";
  if (ui.view === "history") return false;
  /* The rollup cannot decide this AT ALL, and an earlier fix here only got half
     of it. programRollup prefers the SERVER's rollup, which is a different
     derivation over a different population than the client's own viewMatches():
     its needsYou counts non-ended agents only, and its working can read 0 for an
     agent the client derives as working (a stopped transcript whose process is
     still up). Either disagreement collapsed the program, and the collapsed
     program then dropped rows that had already cleared the filter — so Now paints
     one row on a fleet with ten.

     So ask the filter's own question, not a second opinion about it: a program is
     open when it holds an agent the Now view would admit. The gate is now
     incapable of contradicting the filter, which is the invariant that was
     actually broken. History stays collapsed above; ended-and-healthy programs
     still fail this predicate, so a board of 60 finished programs stays quiet. */
  return program.agents.some((agent) => viewMatches("now", agent));
}

function toggleProgram(program) {
  state.programOverrides.set(program.id, programOpen(program) ? "closed" : "open");
  saveOverrides();
  render();
}

/* ---------- keyed reconciliation ----------
   The list guard used to be all-or-nothing: any visible agent's status, token
   count or summary moving invalidated one signature for the WHOLE list, and the
   next paint ran `root.textContent = ""` and rebuilt every program and every
   row — ~27 elements per row, so ~5,400 destroyed and recreated at 200 visible
   rows, every 4s, taking the operator's text selection and hover with them.

   `plan` is [{ key, sig, build }]. A key whose signature is unchanged keeps its
   existing DOM node, in place; only changed, added, removed and reordered keys
   are touched. `cache` is a Map key -> { sig, node } that OUTLIVES its parent,
   so even a rebuilt program section re-adopts its row nodes rather than
   constructing them again. Returns the set of keys the plan claimed, so the
   caller can prune the cache. */
function reconcileKeyed(parent, plan, cache) {
  const seen = new Set();
  let cursor = parent.firstChild;
  for (const item of plan) {
    let entry = cache.get(item.key);
    if (!entry || entry.sig !== item.sig) {
      entry = { sig: item.sig, node: item.build() };
      cache.set(item.key, entry);
    }
    seen.add(item.key);
    if (cursor === entry.node) cursor = entry.node.nextSibling;
    else parent.insertBefore(entry.node, cursor);
  }
  // Anything the plan did not claim has drifted to the tail by now.
  while (cursor) {
    const next = cursor.nextSibling;
    cursor.remove();
    cursor = next;
  }
  return seen;
}

const programSectionCache = new Map(); // programId -> { sig, node }
const programBodies = new Map();       // programId -> the .program-agents node
const agentRowCache = new Map();       // "<programId>\u001f<rowKey>" -> { sig, node }

/* Everything the program SHELL paints — head label, caret state, rollup cells,
   the selection row and the rename form. Deliberately NOT the rows: a rollup
   that has not moved must leave the section node alone so its rows stay
   attached. renameDraft stays out for the same reason it stays out of every
   other signature (live input); every external reset of it flips renamePending. */
function programShellSig(program, agents, ui) {
  const key = presentationLabelKey(programLabelTarget(program));
  const pool = ui.selecting ? program.agents.filter(broadcastEligible) : [];
  return [
    program.id,
    programName(program),
    ui.labels.has(key) ? "1" : "0",
    programOpen(program, ui) ? "open" : "shut",
    // Header counts the whole program, so the signature must watch the whole
    // program too — otherwise a change outside the active filter never repaints.
    programRollupCells(program.agents).map((c) => c.key + "=" + c.value + (c.alert ? "!" : "")).join(","),
    ui.selecting ? "1" : "0",
    ui.selecting ? pool.length + "/" + pool.filter((a) => ui.selection.has(a.id)).length : "",
    ui.renaming === key ? "1" : "0",
    ui.renamePending ? "1" : "0",
    ui.renameError || "",
  ].join("\u001f");
}

/* Everything ONE row paints. agentRecordSig is the same whole-record projection
   the drawer uses, so a snapshot field added later is covered automatically;
   the rest is the per-row slice of list state (this row's selection, checkbox
   and rename form) plus its position in the swarm tree. The live elapsed clock
   stays out — tickClocks rewrites it in place from data-elapsed-base — but the
   >10min staleness fact does not tick, so it is in. */
function agentRowSig(agent, ui, opts = {}) {
  return [
    agentRecordSig(agent),
    rowStalenessText(agent),
    ui.labels.get(presentationLabelKey(agentLabelTarget(agent))) || "",
    ui.labels.get(presentationLabelKey(preferredRenameTarget(agent))) || "",
    ui.selectedId === agent.id ? "1" : "0",
    ui.selecting ? "1" : "0",
    ui.selection.has(agent.id) ? "1" : "0",
    ui.renaming === presentationLabelKey(preferredRenameTarget(agent)) ? "1" : "0",
    ui.renamePending ? "1" : "0",
    ui.renameError || "",
    ui.contextDisplay || "",
    String(opts.depth || 0),
    String(opts.childCount || 0),
    swarmNote(agent, opts) || "",
  ].join("\u001f");
}

function swarmAnchorSig(agent, depth, activeChildren, ui) {
  return [
    agent.id,
    agentName(agent),
    agent.provider,
    agent.model || "",
    String(depth),
    String(activeChildren),
    ui.labels.get(presentationLabelKey(agentLabelTarget(agent))) || "",
  ].join("\u001f");
}

/* Signature ignores live elapsed clocks — status/message/model/context drive
   paint. It must also carry the state the list CONTROLS write, or every one of
   them reads as dead: toggleProgram only mutates programOverrides, and both
   rename pencils only set renaming, so on a quiet fleet render() early-returned
   and the caret never moved / the rename form never appeared. renameDraft stays
   out on purpose — it is a live input, and every external reset of it flips
   renamePending, which is in here. */
function programsPaintSig(visible, ui) {
  return [
    ui.view,
    ui.query,
    ui.facetProgram,
    ui.facetProvider,
    ui.lookbackHours,
    ui.selecting ? "1" : "0",
    ui.selected ? ui.selected.kind + ":" + ui.selected.id : "",
    [...ui.selection].join(","),
    [...ui.programOverrides].map(([id, mode]) => id + "=" + mode).join(","),
    ui.renaming || "",
    ui.renamePending ? "1" : "0",
    ui.renameError || "",
    visible.map(({ program, agents }) =>
      program.id + "@" + (programOpen(program, ui) ? "open" : "shut")
      + "~" + programName(program)
      + ">" + agents.map((a) => [
        a.id,
        a.status,
        a.statusReason || "",
        a.model || "",
        contextDisplayValue(a.tokens) || "",
        rowSummary(a) || "",
        ui.labels.get(presentationLabelKey(agentLabelTarget(a))) || "",
      ].join(":")).join(","),
    ).join("|"),
  ].join("\u001f");
}

/* Two levels of keyed reconciliation instead of one wholesale rebuild: program
   sections by program id, then rows by agent id inside each section body. Split
   out of renderPrograms so the whole path can be driven directly in a test
   without the module's state plumbing. Returns the visible agent count. */
function syncProgramList(root, visible, ui = state) {
  const keptSections = reconcileKeyed(root, visible.map(({ program, agents }) => ({
    key: program.id,
    sig: programShellSig(program, agents, ui),
    build: () => renderProgram(program, agents),
  })), programSectionCache);
  for (const key of [...programSectionCache.keys()]) {
    if (keptSections.has(key)) continue;
    programSectionCache.delete(key);
    programBodies.delete(key);
  }

  let shown = 0;
  const keptRows = new Set();
  for (const { program, agents } of visible) {
    shown += agents.length;
    const body = programBodies.get(program.id);
    if (!body) continue;
    // A collapsed program keeps its section but drops its rows; the row cache
    // still holds them, so re-expanding costs a move rather than a rebuild.
    const plan = programOpen(program, ui)
      ? agentRowPlan(program, agents, ui).map((item) => ({ ...item, key: program.id + "\u001f" + item.key }))
      : [];
    for (const key of reconcileKeyed(body, plan, agentRowCache)) keptRows.add(key);
  }
  for (const key of [...agentRowCache.keys()]) if (!keptRows.has(key)) agentRowCache.delete(key);
  return shown;
}

function renderPrograms() {
  const root = $("programs");
  const usage = $("usage-panel");
  if (!root) return;
  if (state.view === "usage") {
    state.paintSig.programs = "usage:" + state.usageRangeId + ":" + state.usageFetchedAt;
    root.hidden = true;
    if (usage) usage.hidden = false;
    renderUsagePanel();
    renderScopeNote(0);
    return;
  }
  root.hidden = false;
  if (usage) {
    usage.hidden = true;
    usage.textContent = "";
  }
  if (!state.snap) {
    state.paintSig.programs = "empty";
    root.textContent = "";
    programSectionCache.clear();
    programBodies.clear();
    agentRowCache.clear();
    renderScopeNote(0);
    return;
  }

  const filter = currentFilter();
  const visible = [];
  for (const program of state.snap.programs) {
    const agents = program.agents.filter((a) => filter(a, program));
    if (!agents.length) continue;
    visible.push({ program, agents });
  }
  if (paintUnchanged("programs", programsPaintSig(visible, state))) {
    renderScopeNote(visible.reduce((n, row) => n + row.agents.length, 0));
    return;
  }

  const shown = syncProgramList(root, visible, state);
  renderScopeNote(shown);

  const tracked = totalsOf(state.snap).tracked;
  if (shown || !tracked) return;

  const lookbackHiding = lookbackApplies(state.view) && state.lookbackHours != null;
  if (state.query || state.facetProgram || state.facetProvider || lookbackHiding) {
    const parts = [];
    if (state.query || state.facetProgram || state.facetProvider) parts.push("search and filters");
    if (lookbackHiding) parts.push("lookback (" + lookbackLabel(state.lookbackHours) + ")");
    root.append(el("p", {
      class: "no-match",
      text: "Nothing matches the current " + parts.join(" and ") + " in this view.",
    }));
  } else {
    const emptyByView = {
      "now": `No active work right now — idle sessions remain available in Idle.`,
      "needs-you": "No alerts. System interventions may still require operator action.",
      "working": "No agents are working right now.",
      "idle": "No idle agents.",
      "history": "No ended sessions recorded yet.",
    };
    const wrap = el("div", { class: "no-match" }, el("p", { text: emptyByView[state.view] || "Nothing here." }));
    if (state.view !== "history" && tracked) {
      wrap.append(el("button", {
        type: "button", class: "btn",
        dataset: { fkey: "goto-history" },
        onclick: () => setView("history"),
      }, "Open history"));
    }
    root.append(wrap);
  }
}

/* Left-tree program header rollup — the same at-a-glance data as the drawer head
   (programRollupCells is the single aggregation source), rendered as the mono
   .program-rollup cluster A4 established. The alert count takes ember ink
   (is-alerting → --ember) only when alerts exist; calm earns no color. The
   accessible name carries the data itself, extending the drawer's aria pattern. */
function programHeadRollup(agents) {
  const cells = programRollupCells(agents);
  const label = "Program rollup: " + cells.map((c) => c.value + " " + c.label).join(", ");
  return el("span", { class: "program-rollup", "aria-label": label },
    cells.map((c) => el("span", { class: "program-rollup-cell" + (c.alert ? " is-alerting" : "") + (c.key ? " program-rollup-cell--" + c.key : "") },
      el("span", { class: "program-rollup-value mono", text: c.value }),
      el("span", { class: "program-rollup-label", text: c.label }))));
}

function renderProgram(program, agents) {
  const open = programOpen(program);
  const bodyId = "program-body-" + program.id;
  /* The header describes the PROGRAM; the body lists the agents the active
     filter kept. Rolling up the filtered list made the header disagree with its
     own drawer — "1 agent" above a program holding 32 — because a filter is a
     lens on the board, not a change to what the program contains. */
  const rollup = programHeadRollup(program.agents);

  const label = programName(program);
  const aliased = state.aliases.has(presentationLabelKey(programLabelTarget(program)));
  const head = el("div", { class: "program-head" },
    el("button", {
      type: "button",
      class: "program-caret",
      "aria-expanded": String(open),
      "aria-controls": bodyId,
      "aria-label": (open ? "Collapse " : "Expand ") + label,
      dataset: { fkey: "prog:" + program.id },
      onclick: () => toggleProgram(program),
    }, icon("caret")),
    el("button", {
      type: "button",
      class: "program-label",
      "aria-label": "Edit label for " + label,
      dataset: { fkey: "prog-label:" + program.id },
      onclick: () => startRename(programLabelTarget(program)),
    },
      el("span", { class: "program-name", text: label }),
      aliased ? el("span", { class: "program-alias-tag", title: "Source program: " + program.name, text: "label" }) : null),
    el("button", {
      type: "button",
      class: "program-rename",
      "aria-label": "Edit label for " + label,
      dataset: { fkey: "prog-rename:" + program.id },
      onclick: () => startRename(programLabelTarget(program)),
    }, icon("rename")),
    el("button", {
      type: "button",
      class: "program-details",
      "aria-label": "Open program details for " + label,
      dataset: { fkey: "prog-details:" + program.id },
      onclick: () => selectEntity({ kind: "program", id: program.id }),
    }, "Details"),
    rollup);

  const section = el("section", { class: "program" + (open ? " open" : ""), "aria-label": label },
    el("h2", { class: "visually-hidden", text: label }),
    head);
  if (state.selecting) {
    const pool = program.agents.filter(broadcastEligible);
    const chosen = pool.filter((a) => state.selection.has(a.id)).length;
    section.append(el("div", { class: "program-select-row" },
      el("button", {
        type: "button", class: "btn",
        disabled: pool.length ? null : "",
        dataset: { fkey: "prog-select:" + program.id },
        onclick: () => selectProgramEligible(program),
      }, pool.length ? `Select ${pool.length} eligible` : "No eligible agents"),
      chosen ? el("span", { class: "program-select-note", text: `${chosen} of ${pool.length} selected` }) : null));
  }
  if (state.renaming === presentationLabelKey(programLabelTarget(program))) section.append(renderRenameForm(program));
  // The body is left empty on purpose: renderPrograms reconciles the rows into
  // it by agent id, so a shell rebuild never destroys a row that has not moved.
  const body = el("div", { class: "program-agents", id: bodyId });
  programBodies.set(program.id, body);
  section.append(body);
  return section;
}

function renderRenameForm(program) {
  const target = programLabelTarget(program);
  return renderLabelForm(target, {
    inputKey: "rename-input:" + program.id,
    placeholder: "Display name for this program",
    ariaLabel: "New display name for " + program.name,
    source: "Source program: " + program.name + " · id stays " + program.id,
  });
}

function renderLabelForm(target, opts) {
  const key = presentationLabelKey(target);
  return el("form", {
    class: "rename-form",
    onsubmit: (e) => { e.preventDefault(); submitRename(target); },
  },
    el("input", {
      type: "text",
      value: state.renameDraft,
      maxlength: "80",
      placeholder: opts.placeholder,
      "aria-label": opts.ariaLabel,
      disabled: state.renamePending ? "" : null,
      dataset: { fkey: opts.inputKey || "label-input:" + key },
      oninput: (e) => { state.renameDraft = e.target.value; },
      onkeydown: (e) => { if (e.key === "Escape") { e.preventDefault(); cancelRename(); } },
    }),
    el("button", { type: "submit", class: "btn primary", disabled: state.renamePending ? "" : null, "aria-busy": state.renamePending ? "true" : null, dataset: { fkey: "label-save:" + key } }, state.renamePending ? "Saving…" : "Save"),
    el("button", { type: "button", class: "btn", disabled: state.renamePending ? "" : null, dataset: { fkey: "label-cancel:" + key }, onclick: () => cancelRename() }, "Cancel"),
    state.aliases.has(key) ? el("button", { type: "button", class: "btn", disabled: state.renamePending ? "" : null, dataset: { fkey: "label-reset:" + key }, onclick: () => { state.renameDraft = ""; submitRename(target); } }, "Reset") : null,
    el("span", { class: "rename-source", text: opts.source }),
    state.renameError ? el("p", { class: "rename-error", role: "alert", text: state.renameError }) : null);
}

/* The ordered row PLAN for one program: the column header, then the swarm tree
   with a descriptor per node. Each descriptor is keyed by agent id and carries
   its own signature, so reconcileKeyed can rebuild exactly the rows that moved.
   `build` is a closure — nothing is constructed for a row that has not changed. */
function agentRowPlan(program, agents, ui = state) {
  const visibleIds = new Set(agents.map((agent) => agent.id));
  const programById = new Map(program.agents.map((agent) => [agent.id, agent]));
  const relevantIds = new Set(visibleIds);
  for (const agent of agents) {
    let parentId = agent.parentAgentId;
    const seen = new Set();
    while (parentId && programById.has(parentId) && !seen.has(parentId)) {
      seen.add(parentId);
      relevantIds.add(parentId);
      parentId = programById.get(parentId).parentAgentId;
    }
  }
  const { roots, children } = buildClusters(program.agents.filter((agent) => relevantIds.has(agent.id)));
  const fullById = new Map(snapshotAgents(ui.snap).map(({ agent }) => [agent.id, agent]));
  const fullChildren = new Map();
  for (const a of fullById.values()) {
    if (a.parentAgentId) fullChildren.set(a.parentAgentId, [...(fullChildren.get(a.parentAgentId) || []), a.id]);
  }
  const descendantCount = (id, seen = new Set()) => {
    if (seen.has(id)) return 0;
    seen.add(id);
    return (fullChildren.get(id) || []).reduce((total, childId) => total + 1 + descendantCount(childId, seen), 0);
  };

  const plan = [{ key: "columns", sig: "columns", build: renderAgentColumnHeader }];
  const appendTree = (agent, depth) => {
    const visibleDescendants = (fullChildren.get(agent.id) || []).filter((id) => relevantIds.has(id)).length;
    if (visibleIds.has(agent.id)) {
      const opts = { depth, childCount: descendantCount(agent.id), fullById };
      plan.push({
        key: "row:" + agent.id,
        sig: agentRowSig(agent, ui, opts),
        build: () => renderAgentRow(agent, program, opts),
      });
    } else {
      plan.push({
        key: "anchor:" + agent.id,
        sig: swarmAnchorSig(agent, depth, visibleDescendants, ui),
        build: () => renderSwarmAnchor(agent, depth, visibleDescendants),
      });
    }
    for (const child of children.get(agent.id) || []) appendTree(child, depth + 1);
  };
  for (const agent of roots) appendTree(agent, 0);
  return plan;
}

function renderAgentColumnHeader() {
  // Identity on the left, the right-aligned instrument cluster on the right:
  // status word, model + ctx%, tokens, elapsed. (Access folds into each row's
  // aria-label; the terminal/source naming tags fold into the tooltip + drawer.)
  return el("div", {
    class: "agent-grid agent-column-header",
    "aria-label": "Agent list columns",
  },
    el("span", { class: "agent-column-label", text: "Agent/message" }),
    el("span", { class: "agent-column-label ri-col-label", text: "Status" }),
    el("span", { class: "agent-column-label ri-col-label", text: "Model · Ctx" }),
    el("span", { class: "agent-column-label ri-col-label", text: "Tokens" }),
    el("span", { class: "agent-column-label ri-col-label", text: "Elapsed" }));
}

function renderSwarmAnchor(agent, depth, activeChildren) {
  return el("button", {
    type: "button",
    class: "swarm-anchor" + (depth > 0 ? " is-child depth-" + Math.min(depth, 4) : ""),
    dataset: { fkey: "agent:" + agent.id, depth: String(depth) },
    onclick: () => selectAgent(agent.id),
    "aria-label": `${agentName(agent)} parent session. ${activeChildren} visible child sessions. Open parent details.`,
  },
    providerMark(agent),
    el("strong", { text: agentName(agent) }),
    el("span", { text: `${activeChildren} active ${activeChildren === 1 ? "branch" : "branches"}` }),
    el("span", { class: "swarm-anchor-arrow", "aria-hidden": "true", text: "⌄" }));
}

function rowSummary(agent) {
  const message = formatLastHumanMessage(agent);
  if (message !== NO_READABLE_MESSAGE) return message;
  if (agent.task) return conciseText(agent.task, 120);
  if (agent.statusReason) return conciseText(agent.statusReason, 120);
  return NO_READABLE_MESSAGE;
}

/* Codex uses the official ChatGPT/Codex app mark (raster, own background);
   the others are single-color SVG marks that ride in the neutral badge. */
const PROVIDER_MARK = {
  openai: { src: "/icons/codex.png", raster: true },
  claude: { src: "/icons/claude.svg" },
  grok: { src: "/icons/grok.svg" },
  cursor: { src: "/icons/cursor.svg" },
};

function providerMark(agent) {
  const grok = /grok/i.test(agent.model || "");
  const key = grok ? "grok" : agent.provider === "codex" ? "openai" : agent.provider;
  const label = grok ? "Grok" : agent.provider === "codex" ? "OpenAI Codex" : agent.provider === "claude" ? "Anthropic Claude" : providerLabel(agent.provider);
  const mark = PROVIDER_MARK[key];
  if (!mark) {
    return el("span", { class: "provider-mark provider-mark-text", title: label, "aria-label": label, text: label.slice(0, 1) });
  }
  return el("img", { class: "provider-mark" + (mark.raster ? " provider-mark-raster" : ""), src: mark.src, alt: label, title: label });
}

// Shared control vocabulary — the icon key + human state word for each access
// state. The agent row folds Access into its aria-label; the drawer status line
// renders it visibly (renderStatusLine), so both constants stay live.
const CONTROL_ICONS = { linked: "linked", quarantined: "quarantine", "observed-only": "observed" };
const CONTROL_STATE_TEXT = { linked: "Ready", quarantined: "Quarantined", "observed-only": "View only" };

function renderAgentRow(agent, program, opts = {}) {
  const activity = deriveActivity(agent);
  const outcome = deriveOutcome(agent);
  const control = deriveControlState(agent);
  const watchOnly = watchOnlyMark(control, activity, state.snap);
  const policy = modelPolicyView(agent);
  const role = roleView(agent.role);
  const selected = state.selectedId === agent.id;
  const clusterNote = swarmNote(agent, opts);
  const summary = rowSummary(agent);
  const description = [clusterNote, summary].filter(Boolean).join(" · ");
  // Status column shows the activity word colored by state (the color already
  // encodes working/idle/ended, so no separate dot), with any alert suffix on
  // its own red span. Full state stays in the tooltip + row aria-label.
  const stateText = ACTIVITY_LABELS[activity] + (outcome !== "healthy" ? " · " + OUTCOME_LABELS[outcome] : "");

  const eligible = broadcastEligible(agent);
  const checked = state.selection.has(agent.id);
  const nameTarget = preferredRenameTarget(agent);
  const nameKey = presentationLabelKey(nameTarget);
  const editing = state.renaming === nameKey;
  const displayName = agentName(agent);
  const terminal = terminalSourceName(agent);
  const terminalCrumb = terminalBreadcrumb(agent, displayName);
  const staleFact = rowStalenessText(agent);
  const sourceName = sourceAgentName(agent);
  const cwdMismatch = Boolean(agent.target && agent.target.cwdMismatch);
  // The terminal / source / cwd-mismatch naming detail leaves the visible row.
  // Reuse the drawer's helper (never re-fork the naming logic) to fold the full
  // sentence into the row tooltip + aria-label; the drawer still carries it too.
  const sourceDetail = fullSourceDetail(agent);
  const liveness = livenessView(agent);
  const elapsed = liveElapsedText(agent, state.snap && state.snap.generatedAt);

  const activate = () => {
    if (state.selecting) {
      if (eligible) toggleSelect(agent.id);
      return;
    }
    selectAgent(agent.id);
  };

  const identity = el("span", { class: "row-identity" },
    providerMark(agent),
    el("span", { class: "agent-name-wrap" },
      el("span", { class: "agent-name", text: displayName }),
      state.selecting ? null : el("button", {
        type: "button",
        class: "agent-rename",
        "aria-label": "Rename " + displayName,
        title: terminal
          ? "Edit display name (defaults from terminal: " + terminal + ")"
          : "Edit display name",
        dataset: { fkey: "agent-rename:" + agent.id },
        onclick: (e) => {
          e.stopPropagation();
          startRename(nameTarget, { draft: displayName });
        },
      }, icon("rename"))),
    el("span", { class: "row-identity-tags" },
      // De-noised: only the cwd-mismatch state keeps a visible mark — a small
      // ember dot with an accessible label. The full sentence rides the row
      // tooltip + aria-label and the drawer; no naming prose on the row.
      cwdMismatch
        ? el("span", {
          class: "source-mismatch-dot",
          role: "img",
          "aria-label": "Working directory differs from the terminal pane. " + (sourceDetail || CWD_MISMATCH_HINT),
          title: sourceDetail || CWD_MISMATCH_HINT,
        })
        : null,
      // Watch-only mark: the Access column's sighted replacement. See
      // watchOnlyMark() for why it stays silent on most rows.
      watchOnly
        ? el("span", {
          class: "control-dot is-" + watchOnly.key,
          role: "img",
          "aria-label": watchOnly.label + ". " + watchOnly.hint,
          title: watchOnly.label + " — " + watchOnly.hint,
        })
        : null,
      role.key !== "agent" ? el("span", { class: "role-chip role-label role-" + role.key, text: role.label }) : null,
      policy && policy.state === "mismatch" ? el("span", { class: "policy-chip", title: policy.summary }, icon("warning"), "Model mismatch") : null,
      // Terminal breadcrumb: which linked pane this row routes to, deduped
      // against the display name. Identity info (distinct from control state) —
      // an operator can read the destination without opening the drawer.
      terminalCrumb ? el("span", { class: "row-terminal", title: focusDestinationHint(agent), text: terminalCrumb }) : null,
      // A live-looking row that has gone quiet for >10min names how long — a dim
      // fact, never an alert (staleness is a nudge, not a status change).
      staleFact ? el("span", { class: "row-stale", title: "Last update " + agoText(agent.updatedAt), text: staleFact }) : null,
      // Process liveness. The ROW only marks the one state that changes what the
      // operator must do — a dead process — because a "Process live" chip on
      // every working row is noise that would bury it. Every other state (and
      // absence) leaves the row byte-identical to today; the drawer carries the
      // full four-state fact, so `unknown` still reads as unknown somewhere.
      liveness && liveness.key === "died"
        ? el("span", { class: "row-died", title: liveness.detail }, icon("warning"), liveness.label)
        : null,
      opts.childCount ? el("span", { class: "swarm-chip", title: opts.childCount + " subagents in this swarm", text: "swarm " + opts.childCount }) : null),
    description ? el("span", { class: "row-identity-tags row-summary row-description", title: "Latest human message or current status summary. Select for full details.", text: description }) : null);

  // Right-side instrument cluster: status word · outcome, model + ctx%, tokens,
  // elapsed. Values ride --font-mono with tabular-nums; each cell is omitted
  // honestly when its number is unknown (never fabricated), matching the
  // vitals-band precedent. Access + the naming detail fold into the aria-label.
  const ctxUsage = contextUsage(agent.tokens);
  const modelText = modelShort(agent.model) || "not reported";
  const modelCtx = ctxUsage ? modelText + " · " + ctxUsage.pct + "%" : modelText;
  const tokens = tokenSummary(agent.tokens);

  const instruments = el("span", { class: "row-instruments" },
    el("span", {
      class: "row-state state-" + activity + (outcome !== "healthy" ? " outcome-" + outcome : ""),
      title: stateText,
      "aria-label": "Status: " + stateText,
    },
      el("span", { class: "act-" + activity, text: ACTIVITY_LABELS[activity] }),
      outcome !== "healthy" ? el("span", { class: "row-state-alert", text: " · " + OUTCOME_LABELS[outcome] }) : null),
    el("span", {
      class: "ri-cell ri-model" + (modelText === "not reported" ? " is-unknown" : ""),
      "aria-label": contextDisplayLabel() + ": " + contextDisplayValue(agent.tokens),
      title: ctxUsage ? ctxUsage.text : modelText,
    },
      el("span", { class: "ri-value mono", text: modelCtx })),
    tokens.known
      ? el("span", {
        class: "ri-cell ri-tokens",
        "aria-label": "Tokens: " + tokens.text,
        title: tokens.title,
      },
        el("span", { class: "ri-value mono", text: tokens.text }))
      : null,
    elapsed && elapsed !== "—"
      ? el("span", {
        class: "ri-cell ri-elapsed",
        "aria-label": "Elapsed: " + elapsed,
      },
        el("span", { class: "ri-value mono", dataset: elapsedDataset(agent, state.snap && state.snap.generatedAt), text: elapsed }))
      : null);

  const line1 = el("span", { class: "agent-grid" }, identity, instruments);

  const rowClass = "agent-row provider-" + agent.provider +
    " role-" + role.key +
    (opts.depth > 0 ? " is-child depth-" + Math.min(opts.depth, 4) : "") +
    (opts.childCount ? " is-parent" : "") +
    (selected ? " is-selected" : "") +
    (outcome !== "healthy" ? " is-" + outcome : "") +
    (liveness && liveness.key === "died" ? " is-died" : "") +
    (activity === "ended" ? " is-ended" : "") +
    (state.selecting ? " is-selecting" : "") +
    (checked ? " is-checked" : "") +
    (editing ? " is-renaming" : "");

  const children = [];
  if (state.selecting) {
    children.push(el("span", {
      class: "row-check",
      "aria-hidden": "true",
    }, checked ? icon("check") : null));
  }
  children.push(line1);

  const row = el("div", {
    class: rowClass,
    id: "agent-" + agent.id,
    role: "button",
    tabindex: state.selecting && !eligible ? "-1" : "0",
    // The de-noised naming detail rides the tooltip for sighted hover; screen
    // readers get it (plus tokens/elapsed/access) in the aria-label below.
    title: sourceDetail || null,
    "aria-current": selected ? "true" : null,
    "aria-pressed": state.selecting ? String(checked) : null,
    "aria-disabled": state.selecting && !eligible ? "true" : null,
    "aria-label": `${displayName}. Status: ${stateText}.${liveness ? ` Process: ${liveness.label}.` : ""} Agent/message: ${summary || "No message reported"}. Model: ${modelText}. Context: ${contextDisplayValue(agent.tokens)}. Tokens: ${tokens.text}. Elapsed: ${elapsed !== "—" ? elapsed : "not reported"}. Access: ${CONTROL_STATE_TEXT[control] || "View only"}. ${sourceDetail ? sourceDetail + ". " : ""}${opts.depth ? `Swarm depth ${opts.depth}. ` : ""}${opts.childCount ? `${opts.childCount} descendants. ` : ""}${state.selecting ? (eligible ? " Selectable for broadcast." : " Not available for broadcast.") : " Select to open the full message and session details in the inspector."}`,
    dataset: { fkey: "agent:" + agent.id, depth: String(opts.depth || 0) },
    onclick: (e) => {
      if (e.target.closest(".agent-rename, .rename-form")) return;
      if (state.selecting && !eligible) return;
      activate();
    },
    onkeydown: (e) => {
      if (e.target.closest(".agent-rename, .rename-form, input, button")) return;
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      if (state.selecting && !eligible) return;
      activate();
    },
  }, children);

  if (!editing) return row;

  const kind = nameTarget.kind;
  return el("div", { class: "agent-row-edit-wrap" },
    row,
    renderLabelForm(nameTarget, {
      inputKey: "label-input:" + nameKey,
      placeholder: kind === "workspace" ? "Name that matches the cmux terminal" : "Display name for this agent",
      ariaLabel: "New display name for " + displayName,
      source: kind === "workspace"
        ? (terminal
          ? "Terminal title: " + terminal + " · workspace id stays " + nameTarget.workspaceId
          : "Workspace id stays " + nameTarget.workspaceId)
        : "Source agent: " + sourceName + " · id stays " + agent.id,
    }));
}

function swarmNote(agent, opts) {
  if ((opts.depth || 0) > 0 || !agent.parentAgentId) return null;
  const parent = opts.fullById && opts.fullById.get(agent.parentAgentId);
  return parent ? "↳ under " + agentName(parent) : "↳ parent session untracked";
}

/* ---------- row keyboard navigation ----------

   Rows are role="button" with tabindex 0, so Tab already reached them — but Tab
   walks EVERY focusable on the board (filter chips, program heads, rename
   pencils, per-row controls), so stepping from one row to the next could take a
   dozen presses on a board with 165 of them. Arrows walk rows and nothing else.

   The index math is kept separate from the DOM so the end-of-list rules are
   testable without a browser. Arrows CLAMP rather than wrap: wrapping from the
   last row to the first silently teleports the operator across a long board with
   no visual event to explain it. Home/End are the deliberate way to make that
   jump. */
const ROW_NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

function nextRowIndex(current, key, count) {
  if (count <= 0) return -1;
  switch (key) {
    // From nowhere, Down enters at the top and Up enters at the bottom.
    case "ArrowDown": return current < 0 ? 0 : Math.min(count - 1, current + 1);
    case "ArrowUp": return current < 0 ? count - 1 : Math.max(0, current - 1);
    case "Home": return 0;
    case "End": return count - 1;
    default: return -1;
  }
}

/* Only rows that are actually reachable: in select mode the broadcast-ineligible
   ones carry tabindex="-1", and arrow nav must skip exactly what Tab skips. */
function navigableRows() {
  const root = $("programs");
  return root ? [...root.querySelectorAll('.agent-row[tabindex="0"]')] : [];
}

/* `rows` is injectable so the whole handler — not just the arithmetic — can be
   driven in a test against plain nodes. */
function handleRowNavigation(e, rows = navigableRows()) {
  if (!ROW_NAV_KEYS.has(e.key)) return false;
  // A modified arrow is a browser/OS gesture (word jump, history, scroll); never
  // take those. Same for a text field inside a row's rename form.
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
  const target = e.target;
  if (!target || !target.closest) return false;
  if (target.closest("input, textarea, select")) return false;
  const row = target.closest(".agent-row");
  if (!row) return false;
  const next = nextRowIndex(rows.indexOf(row), e.key, rows.length);
  if (next < 0) return false;
  // Consume even when already at the end, or the board scrolls out from under a
  // held arrow key while focus visibly stays put.
  e.preventDefault();
  if (rows[next] && rows[next] !== row) rows[next].focus();
  return true;
}

/* ---------- selection + inspector ---------- */

function selectAgent(agentId) {
  selectEntity({ kind: "agent", id: agentId });
}

// Unified entry point for every drawer kind. Agents keep populating the legacy
// state.selectedId so the row is-selected highlight, findSelected, and
// closeInspector focus-return all keep working untouched.
function selectEntity(sel) {
  state.selected = sel;
  state.selectedId = sel && sel.kind === "agent" ? sel.id : null;
  state.confirming = null;
  state.evidenceOpen = false;
  render();
  // On explicit open (not on background SSE re-renders), move focus to the
  // drawer's lead element per kind — the differentiator band, or the title.
  focusDrawerLead();
}

function focusDrawerLead() {
  const pane = $("inspector");
  if (!pane || pane.hidden) return;
  const lead = pane.querySelector(".dw-lead") || pane.querySelector(".inspector-title");
  if (!lead) return;
  if (!lead.hasAttribute("tabindex")) lead.setAttribute("tabindex", "-1");
  lead.focus({ preventScroll: true });
}

function closeInspector() {
  const id = state.selectedId;
  state.selected = null;
  state.selectedId = null;
  state.confirming = null;
  state.evidenceOpen = false;
  render();
  if (id) {
    const row = document.getElementById("agent-" + id);
    if (row) row.focus({ preventScroll: true });
  }
}

function findSelected() {
  if (!state.selectedId || !state.snap) return null;
  for (const program of state.snap.programs) {
    const agent = program.agents.find((a) => a.id === state.selectedId);
    if (agent) return { agent, program };
  }
  return null;
}

/* ---------- inspector paint signature ---------- */

/* Fields the live clocks own: tickClocks rewrites data-elapsed-base / data-ago
   nodes in place every 5s, so letting them into a paint signature would rebuild
   the drawer on every snapshot and defeat the guard. Their PRESENCE still
   matters (a tile appears when elapsedMs stops being null), so the projection
   keeps a presence marker for each.

   `identityTrace` itself is NOT in this set any more: the drawer now renders
   the tier trail and the quarantine reason, so a resolution that changes has to
   repaint. Only its one clock-like field (`confirmedAt`, the moment a persisted
   binding was last re-confirmed) is dropped, because that moves on its own
   without changing anything the operator reads. */
const AGENT_SIG_TICKED = new Set(["elapsedMs", "updatedAt", "lastCheckedAt", "confirmedAt"]);

/* The agent drawer paints very nearly the whole agent record — status, gates,
   model policy, tokens, cwd, git, messages, artifacts, transcript tail, target
   routing and controls[] — so project the record itself rather than hand-listing
   fields that then rot. A field added to the snapshot is covered automatically. */
function agentRecordSig(agent) {
  if (!agent) return "";
  const body = JSON.stringify(agent, (key, value) => (AGENT_SIG_TICKED.has(key) ? undefined : value)) || "";
  return body + "|" + (agent.elapsedMs == null ? "" : "e") + (agent.updatedAt ? "u" : "");
}

/* The lineage spine paints ancestors and direct children, so their identity and
   activity are part of what this drawer shows — a subagent going idle must not
   leave a stale glyph on an open drawer. */
function lineagePaintSig(agent, snap) {
  const byId = new Map(snapshotAgents(snap).map(({ agent: a }) => [a.id, a]));
  const kin = (a) => a.id + ":" + a.status + ":" + (a.activity || "") + ":" + (a.role || "") + ":" + agentName(a);
  const parts = [];
  const seen = new Set([agent.id]);
  let parent = agent.parentAgentId ? byId.get(agent.parentAgentId) : null;
  if (agent.parentAgentId && !parent) parts.push("untracked:" + agent.parentAgentId);
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    parts.push(kin(parent));
    parent = parent.parentAgentId ? byId.get(parent.parentAgentId) : null;
  }
  for (const a of byId.values()) if (a.parentAgentId === agent.id) parts.push(kin(a));
  return parts.join(",");
}

/* Every piece of state a drawer body renders. The agent branch used to carry
   only the entity kind/id and evidenceOpen — queueItem/triage/issue are all
   undefined for an agent — so an open agent drawer never repainted: the
   Interrupt/Archive confirm strips were unreachable, Send never showed its busy
   state, and the body stayed frozen at the moment the drawer opened while the
   row beside it updated every snapshot.

   Live inputs are deliberately excluded (drafts, renameDraft): tearing a text
   box down while it is being typed into is the very bug the broadcast composer
   had. Both are only ever cleared externally alongside a flag that IS in the
   signature (sendControl clears drafts as it clears pending and sets feedback;
   submitRename flips renamePending), so exclusion cannot strand a stale value. */
function inspectorPaintSig(sel, view, ui) {
  const queueItem = ui.queueItems.find((item) => item.issueId === sel.id);
  const triage = ui.triage.get(sel.id);
  const triagePending = [...ui.triagePending].filter((key) => key.endsWith(":" + sel.id)).join(",");
  const issue = view && (view.issue || view.item);
  const agent = view && view.kind === "agent" ? view.agent : null;
  const feedback = agent ? ui.feedback.get(agent.id) : null;
  const identity = ui.identity || {};
  const transcript = ui.transcript || {};
  // The dock prints this agent's last journalled action, so a new entry landing
  // has to repaint the drawer or the fact stays wrong until something else moves.
  const lastAction = agent ? lastActionFor(ui.actions && ui.actions.items, agent.id) : null;
  return [
    sel.kind, sel.id,
    view ? view.kind : "missing",
    issue && issue.lifecycle ? issue.lifecycle.state : "",
    issue && issue.workState || "",
    issue && issue.progress != null ? String(issue.progress) : "",
    queueItem ? queueItem.state + ":" + (queueItem.result || "").slice(0, 80) : "",
    triage ? triage.generatedAt + ":" + triage.headline : "",
    triagePending,
    ui.evidenceOpen ? "1" : "0",
    agent ? agentRecordSig(agent) : "",
    agent ? lineagePaintSig(agent, ui.snap) : "",
    agent && view.program ? programName(view.program) : "",
    // Interaction flags the drawer controls read on every paint.
    agent ? [...ui.pending].filter((key) => key.startsWith(agent.id + ":")).sort().join(",") : "",
    agent && feedback ? (feedback.ok ? "ok" : "err") + ":" + feedback.action + ":" + feedback.message : "",
    ui.confirming || "",
    ui.renaming || "",
    ui.renamePending ? "1" : "0",
    ui.renameError || "",
    ui.labelsLoading ? "1" : "0",
    ui.labelLoadError || "",
    // On-demand terminal evidence: nothing else in the drawer moves when it
    // lands, so without this the fetched surfaces would never reach the screen.
    agent && identity.agentId === agent.id
      ? [
        identity.loading ? "1" : "0",
        identity.error || "",
        identity.data ? JSON.stringify(surfaceCollisions(identity.data)) : "",
      ].join(":")
      : "",
    // Same reason as identity: nothing else in the drawer moves when a fetched
    // transcript lands, so without this it would never reach the screen. The
    // line COUNT and the source stand in for the payload — the text is immutable
    // once fetched, and hashing 1000 turns on every paint is not free.
    agent && transcript.agentId === agent.id
      ? [
        transcript.loading ? "1" : "0",
        transcript.error || "",
        String(transcript.limit || ""),
        transcript.data
          ? transcript.data.lines.length + ":" + (transcript.data.source || "") + ":" + (transcript.data.truncated ? "1" : "0")
          : "",
      ].join(":")
      : "",
    lastAction ? lastAction.id + ":" + lastAction.outcome : "",
    // Attention lives only on the client until the next snapshot lands, so
    // without it the acknowledge/dismiss/snooze block would never repaint —
    // the exact failure `state.identity` and `state.transcript` both had.
    agent
      ? [
        ui.attentionPending && ui.attentionPending.has(agent.id) ? "1" : "0",
        (ui.attentionErrors && ui.attentionErrors.get(agent.id)) || "",
        (() => {
          const record = attentionRecord(agent.id, ui);
          return record ? record.action + ":" + (record.snoozedUntil || record.updatedAt || "") : "";
        })(),
      ].join(":")
      : "",
    // A feed that freezes under an OPEN drawer changes nothing else the drawer
    // signs — generatedAt is not in here and the agent record is byte-identical
    // across a frozen refresh — so without this the dock would keep painting
    // live-looking Focus/Send/Interrupt/Archive over four-day-old routing.
    feedFrozen(ui) ? "held" : "",
  ].join("\u001f");
}

/* Drawer router: one chassis, a distinct body per entity kind. selectEntity
   sets state.selected = {kind,id}; resolveSelection maps it to a live record and
   DRAWER_RENDERERS routes to the per-type body. Keeping this as renderInspector
   preserves every existing render() caller. */
function renderInspector() {
  const pane = $("inspector");
  const sel = state.selected;
  document.body.classList.toggle("inspector-open", !!sel);
  if (!sel) {
    state.paintSig.inspector = "closed";
    pane.hidden = true;
    pane.textContent = "";
    pane.className = "pane-inspector";
    return;
  }

  const view = resolveSelection(sel);
  if (paintUnchanged("inspector", inspectorPaintSig(sel, view, state))) {
    pane.hidden = false;
    return;
  }

  pane.textContent = "";
  pane.className = "pane-inspector";
  pane.hidden = false;
  const renderer = view && DRAWER_RENDERERS[view.kind];
  if (!renderer) { pane.append(...missingDrawer()); return; }
  pane.setAttribute("role", "region");
  pane.setAttribute("aria-label", (DRAWER_ARIA_LABELS[view.kind] || "Detail") + " inspector");
  renderer(pane, view);
}

const DRAWER_ARIA_LABELS = {
  agent: "Agent", intervention: "Intervention", advisory: "Advisory",
  investigation: "Investigation", resolved: "Resolved finding", program: "Program",
};

const DRAWER_RENDERERS = {
  agent: renderAgentDrawer,
  intervention: renderInterventionDrawer,
  advisory: renderAdvisoryDrawer,
  investigation: renderInvestigationDrawer,
  resolved: renderResolvedDrawer,
  program: renderProgramDrawer,
};

function resolveSelection(sel) {
  if (!sel || !state.snap) return null;
  if (sel.kind === "agent") {
    const found = findSelected();
    return found ? { kind: "agent", agent: found.agent, program: found.program } : null;
  }
  if (sel.kind === "intervention" || sel.kind === "advisory") {
    const issue = issuesOf(state.snap).find((i) => i.id === sel.id);
    return issue ? { kind: sel.kind, issue } : null;
  }
  if (sel.kind === "investigation") {
    const item = state.queueItems.find((it) => it.issueId === sel.id || it.id === sel.id);
    return item ? { kind: "investigation", item } : null;
  }
  if (sel.kind === "resolved") {
    const pool = [...issuesOf(state.snap), ...recentlyResolvedOf(state.snap)];
    const issue = pool.find((i) => i.id === sel.id && issueLifecycle(i).state === "resolved");
    return issue ? { kind: "resolved", issue } : null;
  }
  if (sel.kind === "program") {
    const program = state.snap.programs.find((p) => p.id === sel.id);
    return program ? { kind: "program", program } : null;
  }
  return null;
}

function missingDrawer() {
  return [
    el("div", { class: "inspector-head" },
      el("h2", { class: "inspector-title", text: "No longer in the snapshot" }),
      closeButton()),
    el("p", { class: "inspector-note", text: "This entity is no longer reported by any collector. It may reappear on the next snapshot." }),
  ];
}

/* An immutable snapshot yields the same index every time, but affectedImpact
   rebuilt it once PER ISSUE — O(issues × agents) per pass, and renderHealthRail
   drives several passes per paint. Keyed on the snapshot object itself, so
   adopting a new snapshot invalidates it for free and nothing has to be cleared
   by hand. Callers read it; nobody mutates it. */
const agentIndexCache = new WeakMap();
function agentsById(snap = state.snap) {
  if (!snap || typeof snap !== "object") return new Map();
  const cached = agentIndexCache.get(snap);
  if (cached) return cached;
  const index = new Map(snapshotAgents(snap).map(({ agent, program }) => [agent.id, { agent, program }]));
  agentIndexCache.set(snap, index);
  return index;
}

function drawerAccent(pane, kind) {
  pane.append(el("div", { class: "dw-accent dw-accent--" + kind, "aria-hidden": "true" }));
}

function dwEyebrow(kindClass, iconName, text) {
  return el("span", { class: "dw-eyebrow dw-eyebrow--" + kindClass }, iconName ? icon(iconName) : null, text);
}

/* Shared verdict head for the five entity drawers (B4). One totem shape mirrors
   the agent drawer: the status kicker + title (+ an optional sub line) on the
   left, Close and the one promoted action stacked on the right. The agent drawer
   keeps its own richer head (provider rail, status line, gate); the entity
   drawers share this so the five near-identical heads are not hand-rolled. */
function drawerVerdictHead({ eyebrow, title, sub, action }) {
  return el("div", { class: "inspector-head inspector-verdict" },
    el("div", { class: "inspector-id" },
      eyebrow || null,
      el("h2", { class: "inspector-title", text: title }),
      sub || null),
    el("div", { class: "verdict-side" },
      closeButton(),
      action ? el("div", { class: "verdict-action" }, action) : null));
}

/* Compact promoted lever for an issue drawer's head — the single most-relevant
   action, so an operator can act from the top without scrolling to the Fix
   block. Reuses the same triageIssue(...) calls the body controls use; the
   head: fkey prefix (B2 convention) keeps the key distinct from the body twin.
   A queued investigation → Launch; a not-yet-triaged finding → Triage; anything
   in flight → null (the Fix/Triage block owns the plan/queue story). */
function issueHeadAction(issue) {
  const id = issue.id;
  const queueItem = state.queueItems.find((it) => it.issueId === id);
  if (queueItem && queueItem.state === "queued") {
    const launching = state.triagePending.has("run:" + id);
    return el("button", {
      type: "button", class: "btn dw-head-action",
      disabled: launching ? "" : null,
      "aria-busy": launching ? "true" : null,
      dataset: { fkey: "head:run:" + id },
      onclick: () => triageIssue(id, "run"),
    }, launching ? "Launching…" : "Launch");
  }
  if (!state.triage.get(id)) {
    const generating = state.triagePending.has("generate:" + id);
    return el("button", {
      type: "button", class: "btn dw-head-action",
      disabled: generating ? "" : null,
      "aria-busy": generating ? "true" : null,
      dataset: { fkey: "head:triage:" + id },
      onclick: () => triageIssue(id, "generate"),
    }, generating ? "Triaging…" : "Triage");
  }
  return null;
}

/* The investigation head's promoted lever — the queued run's Launch button, the
   drawer's one existing primary control. Head: prefix keeps it distinct from the
   full-width Launch that stays in the body. Null unless the run is queued. */
function investigationHeadAction(item) {
  if (item.state !== "queued") return null;
  const launching = state.triagePending.has("run:" + item.issueId);
  return el("button", {
    type: "button", class: "btn dw-head-action",
    disabled: launching ? "" : null,
    "aria-busy": launching ? "true" : null,
    dataset: { fkey: "head:run:" + item.issueId },
    onclick: () => triageIssue(item.issueId, "run"),
  }, launching ? "Launching…" : "Launch");
}

/* Program head rollup — the swarm at a glance: agent count, working, alerts, and
   aggregate session tokens, aggregated client-side over the program's agents.
   Values ride the mono convention; unit words stay ui/--faint. The token cell is
   omitted when no agent on the client reports session usage — an aggregate we
   cannot derive is never faked to zero. */
function programRollupLine(program) {
  const cells = programRollupCells(program.agents || []);
  return el("div", { class: "dw-rollup", "aria-label": "Program rollup" },
    cells.map((c) => el("span", { class: "dw-rollup-cell" + (c.alert ? " is-alert" : "") },
      el("span", { class: "dw-rollup-value mono", text: c.value }),
      el("span", { class: "dw-rollup-label", text: c.label }))));
}

/* Impact summary — never dump hundreds of anonymous chips as "Affects (160)".
   Plain language first, program rollup second, optional short sample third. */
function affectedImpact(issue, snap = state.snap) {
  const ids = issue.affectedAgentIds || [];
  const byId = agentsById(snap);
  const resolved = ids.map((id) => byId.get(id)).filter(Boolean);
  const byProgram = new Map();
  for (const row of resolved) {
    const key = programName(row.program);
    const bucket = byProgram.get(key) || { name: key, count: 0 };
    bucket.count += 1;
    byProgram.set(key, bucket);
  }
  const programs = [...byProgram.values()].sort((a, b) => b.count - a.count);
  const total = ids.length;
  let plain = "System-wide — not tied to a specific agent.";
  if (total === 1 && resolved[0]) {
    plain = `Touches 1 session: ${agentName(resolved[0].agent)} (${programName(resolved[0].program)}).`;
  } else if (total > 0) {
    const top = programs.slice(0, 2).map((p) => `${p.name} (${p.count})`).join(", ");
    plain = `Touches ${total} tracked session${total === 1 ? "" : "s"}`
      + (programs.length ? ` across ${programs.length} program${programs.length === 1 ? "" : "s"}` : "")
      + (top ? ` — mainly ${top}` : "")
      + ".";
  }
  return { total, resolved, programs, plain };
}

function workStateBanner(issue) {
  const work = issueWorkState(issue);
  return el("div", { class: "dw-work work-" + work.key, role: "status" },
    el("span", { class: "dw-work-mark", "aria-hidden": "true" }),
    el("span", { class: "dw-work-label", text: work.label }),
    el("span", { class: "dw-work-hint", text:
      work.key === "needs" ? "No triage started yet."
      : work.key === "triaging" ? "Triage request in flight…"
      : work.key === "planned" ? "A plan is ready — queue or launch from Fix below."
      : work.key === "queued" ? "Investigation queued — launch is a separate operator action."
      : work.key === "investigating" ? "Read-only investigation is running."
      : work.key === "verifying" ? "Waiting for a fresh source snapshot to clear the finding."
      : work.key === "blocked" ? "Blocked — review the investigation result."
      : work.key === "cleared" ? "Source confirmation cleared this finding."
      : "Advisory is visible; escalate only if it needs action." }));
}

function impactBlock(issue) {
  const impact = affectedImpact(issue);
  const wrap = el("div", { class: "dw-affects" },
    el("h3", { class: "section-title", text: "Impact" }),
    el("p", { class: "dw-impact-plain", text: impact.plain }));
  if (impact.programs.length > 1) {
    wrap.append(el("div", { class: "dw-impact-programs" },
      impact.programs.slice(0, 5).map((p) =>
        el("span", { class: "dw-impact-prog", text: `${p.name} · ${p.count}` }))));
  }
  if (impact.resolved.length) {
    const sample = impact.resolved.slice(0, AFFECTS_SAMPLE_LIMIT);
    const extra = impact.resolved.length - sample.length;
    wrap.append(el("details", { class: "dw-impact-sample" },
      el("summary", { text: extra > 0
        ? `Sample sessions (${sample.length} of ${impact.resolved.length})`
        : `Sessions (${impact.resolved.length})` }),
      el("div", { class: "dw-chips" }, sample.map(({ agent, program }) =>
        el("button", {
          type: "button", class: "dw-chip",
          dataset: { fkey: `issue:${issue.id}:${agent.id}` },
          onclick: () => selectEntity({ kind: "agent", id: agent.id }),
        }, agentName(agent), el("span", { class: "dw-chip-prog", text: " · " + programName(program) }))))));
  }
  return wrap;
}

// Intervention drawer — status first, consequence second, then the one Fix path.
function renderInterventionDrawer(pane, view) {
  const issue = view.issue;
  const note = issueLifecycleNote(issue);
  const work = issueWorkState(issue);
  drawerAccent(pane, "ember");
  pane.append(drawerVerdictHead({
    eyebrow: dwEyebrow("ember", "intervention", work.label),
    title: issue.title,
    action: issueHeadAction(issue),
  }));
  pane.append(workStateBanner(issue));
  pane.append(el("p", { class: "dw-lead", text: issue.summary || issue.title }));
  pane.append(impactBlock(issue));
  pane.append(el("div", { class: "dw-block dw-block--fix" },
    el("div", { class: "dw-block-label", text: "Fix" }),
    renderTriage(issue)));
  if (issue.technicalDetails && issue.technicalDetails.length) {
    pane.append(el("details", { class: "signal-tech" },
      el("summary", { text: "Technical" }),
      el("ul", {}, issue.technicalDetails.map((d) => el("li", { class: "mono", text: d })))));
  }
  if (note) pane.append(el("p", { class: "dw-impact", text: note }));
}

// Advisory drawer — quieter than an intervention; escalate only when watching.
function renderAdvisoryDrawer(pane, view) {
  const issue = view.issue;
  const note = issueLifecycleNote(issue);
  const work = issueWorkState(issue);
  drawerAccent(pane, "amber");
  pane.append(drawerVerdictHead({
    eyebrow: dwEyebrow("amber", "warning", "Advisory · " + work.label),
    title: issue.title,
    action: issueHeadAction(issue),
  }));
  pane.append(workStateBanner(issue));
  pane.append(el("p", { class: "dw-lead dw-lead--quiet", text: issue.summary || issue.title }));
  pane.append(impactBlock(issue));
  if (note) pane.append(el("p", { class: "dw-impact", text: note }));
  if (work.key === "watching" || work.key === "needs") {
    pane.append(el("div", { class: "controls-row" },
      el("button", {
        type: "button", class: "btn dw-ghost", dataset: { fkey: "escalate:" + issue.id },
        onclick: () => triageIssue(issue.id, "generate"),
      }, "Triage this advisory")));
  } else if (work.key === "planned" || work.key === "queued" || work.key === "investigating" || work.key === "verifying" || work.key === "blocked" || work.key === "triaging") {
    pane.append(el("div", { class: "dw-block dw-block--fix" },
      el("div", { class: "dw-block-label", text: "Triage" }),
      renderTriage(issue)));
  }
}

// Investigation drawer — the Luna run, live: status line + step timeline + result.
// Never ember (an investigation is not itself an alarm); slate accent + a moss
// pulse while running.
function renderInvestigationDrawer(pane, view) {
  const item = view.item;
  const running = item.state === "running";
  const stateView = investigationView(item.state);
  drawerAccent(pane, "slate");
  pane.append(drawerVerdictHead({
    eyebrow: dwEyebrow("slate", "broadcast", "Investigation · " + stateView.label),
    title: item.headline,
    action: investigationHeadAction(item),
  }));

  const status = el("div", { class: "dw-status" });
  if (running) status.append(el("span", { class: "dw-pulse", "aria-hidden": "true" }));
  status.append(el("span", { text:
    stateView.status + (running ? " · " + (item.runModel || "native Luna") : "") }));
  pane.append(status);

  if (item.steps && item.steps.length) {
    pane.append(el("div", {},
      el("h3", { class: "section-title", text: "Plan (" + item.steps.length + (item.steps.length === 1 ? " step)" : " steps)") }),
      el("ol", { class: "dw-steps", "aria-label": "Investigation plan" }, item.steps.map((step) =>
        el("li", {}, el("b", { text: step.title }), el("span", { text: step.detail }))))));
  }

  if (item.state === "queued") {
    const launching = state.triagePending.has("run:" + item.issueId);
    pane.append(el("div", { class: "controls-row" },
      el("button", {
        type: "button", class: "btn primary dw-full",
        disabled: launching ? "" : null,
        "aria-busy": launching ? "true" : null,
        dataset: { fkey: "run:" + item.issueId },
        onclick: () => triageIssue(item.issueId, "run"),
      }, launching ? "Launching…" : "Launch read-only Luna")));
  }

  if (item.result) {
    pane.append(renderInvestigationResult(item.result, item.state === "blocked" ? "blocked" : "completed",
      { issueId: item.issueId, startedAt: item.startedAt, completedAt: item.completedAt }));
  }

  const issue = issuesOf(state.snap).find((i) => i.id === item.issueId);
  if (issue) {
    const kind = issue.severity === "error" ? "intervention" : "advisory";
    pane.append(el("button", {
      type: "button", class: "dw-backlink",
      dataset: { fkey: "backlink:" + item.issueId },
      onclick: () => selectEntity({ kind, id: item.issueId }),
    }, "↖ From " + kind + ": ", el("b", { text: issue.title })));
  }
}

// Resolved drawer — the only past-tense, no-action state. Moss accent, reduced
// opacity, and a before/after trail of what cleared it.
function renderResolvedDrawer(pane, view) {
  const issue = view.issue;
  const lifecycle = issueLifecycle(issue);
  const result = lifecycle.result || "Source confirmation cleared the finding.";
  pane.classList.add("dw-past");
  drawerAccent(pane, "moss");
  // Resolved is the only past-tense drawer — no reopen/inspect control exists, so
  // the head renders verdict-only; no action is invented.
  pane.append(drawerVerdictHead({
    eyebrow: dwEyebrow("moss", "check", "Resolved"),
    title: issue.title,
  }));
  pane.append(el("p", { class: "dw-lead dw-lead--past", text: "Cleared " + issueTimestamp(lifecycle.resolvedAt) }));

  const grid = el("dl", { class: "detail-grid" });
  dtdd(grid, "was", issue.summary || issue.title);
  dtdd(grid, "now", result);
  pane.append(grid);

  const chips = affectedChips(issue, "Recovered");
  if (chips) pane.append(chips);
}

const ROSTER_ROLE_ORDER = ["orchestrator", "backend", "frontend", "verifier", "tester", "automation", "agent"];
const ROSTER_ROLE_SHORT = {
  orchestrator: "Orchestrator", backend: "Backend", frontend: "Frontend",
  verifier: "Verifier", tester: "Tester", automation: "Automation", agent: "Agent",
};

/* Each agent falls in exactly one meter band so the segments sum to the roster
   count (alerts take priority over their working/idle activity). */
function programMeterSegments(agents) {
  let needs = 0, working = 0, idle = 0, ended = 0;
  for (const a of agents) {
    const act = deriveActivity(a);
    if (act === "ended") { ended++; continue; }
    if (deriveOutcome(a) !== "healthy") { needs++; continue; }
    if (act === "working") working++;
    else idle++;
  }
  return [
    { cls: "dw-seg-work", value: working },
    { cls: "dw-seg-idle", value: idle },
    { cls: "dw-seg-needs", value: needs },
    { cls: "dw-seg-end", value: ended },
  ];
}

function programRosterRow(agent) {
  const rv = roleView(agent.role);
  const act = deriveActivity(agent);
  const outcome = deriveOutcome(agent);
  const needs = outcome !== "healthy" && act !== "ended";
  const dotCls = needs ? "dw-dot--needs" : act === "working" ? "dw-dot--work" : act === "ended" ? "dw-dot--end" : "dw-dot--idle";
  const stateText = needs ? OUTCOME_LABELS[outcome] : ACTIVITY_LABELS[act];
  return el("button", {
    type: "button", class: "dw-roster-row",
    dataset: { fkey: "roster:" + agent.id },
    onclick: () => selectEntity({ kind: "agent", id: agent.id }),
    "aria-label": "Open " + agentName(agent) + " · " + (ROSTER_ROLE_SHORT[rv.key] || rv.label) + " · " + stateText,
  },
    el("span", { class: "role-chip role-" + rv.key, text: ROSTER_ROLE_SHORT[rv.key] || rv.label }),
    el("span", { class: "dw-roster-name", text: agentName(agent) }),
    el("span", { class: "dw-roster-state" }, el("span", { class: "dw-dot " + dotCls, "aria-hidden": "true" }), stateText));
}

// Program drawer — the swarm at a glance. Neutral ink accent (a program isn't an
// alarm); a segmented health meter and a role-grouped roster are unique here.
function renderProgramDrawer(pane, view) {
  const program = view.program;
  const agents = program.agents;
  drawerAccent(pane, "ink");
  // Program head leads with the rollup glance (counts + aggregate tokens); the
  // segmented meter below stays as the visual breakdown, no longer restating the
  // same numbers in a caption.
  pane.append(drawerVerdictHead({
    eyebrow: dwEyebrow("ink", null, "Program"),
    title: programName(program),
    sub: programRollupLine(program),
  }));

  pane.append(el("div", { class: "dw-block" },
    el("div", { class: "dw-block-label", text: agents.length + (agents.length === 1 ? " agent" : " agents") }),
    svgSegmentMeter(programMeterSegments(agents), { label: "Program health rollup" })));

  if (program.purpose || program.path) {
    const grid = el("dl", { class: "detail-grid" });
    if (program.purpose) dtdd(grid, "purpose", program.purpose);
    if (program.path) dtdd(grid, "path", program.path, { code: true });
    pane.append(grid);
  }

  const eligible = agents.filter(broadcastEligible).length;
  pane.append(el("div", { class: "controls-row" },
    el("button", {
      type: "button", class: "btn primary dw-full",
      disabled: eligible ? null : "",
      dataset: { fkey: "prog-broadcast:" + program.id },
      onclick: () => { enterSelectMode(true); selectProgramEligible(program); },
    }, eligible ? "Broadcast to " + eligible + " eligible" : "No eligible recipients")));

  const roster = el("div", { class: "dw-roster" });
  const grouped = new Map();
  for (const a of agents) {
    const key = roleView(a.role).key;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(a);
  }
  for (const key of ROSTER_ROLE_ORDER) {
    for (const a of grouped.get(key) || []) roster.append(programRosterRow(a));
  }
  pane.append(el("div", {},
    el("h3", { class: "section-title", text: "Roster" }),
    roster));
}

/* Head de-noising (B2): the three-way naming ternaries collapse into one quiet
   line. quietSourceLine returns one short line of text — or null when the
   terminal name already matches the display name — and fullSourceDetail returns
   the complete sentence for the title tooltip (mismatch explanation included).
   B4 reuses both for the other drawer types' heads. */
function quietSourceLine(agent) {
  const terminal = terminalSourceName(agent);
  const mismatch = Boolean(agent.target && agent.target.cwdMismatch);
  if (terminal) {
    // A cwd mismatch must keep its mark even when the shown name happens to
    // equal the terminal title — only calm matching identities go quiet.
    if (terminal === agentName(agent) && !mismatch) return null;
    return "Terminal: " + terminal;
  }
  const hasCustomName = state.aliases.has(presentationLabelKey(preferredRenameTarget(agent)))
    || state.aliases.has(presentationLabelKey(agentLabelTarget(agent)));
  return hasCustomName ? "Source agent: " + sourceAgentName(agent) : null;
}

function fullSourceDetail(agent) {
  const quiet = quietSourceLine(agent);
  if (!quiet) return null;
  const mismatch = Boolean(agent.target && agent.target.cwdMismatch);
  return mismatch ? quiet + " · " + CWD_MISMATCH_HINT : quiet;
}

/* Ember-outline gate chip for the verdict head — names the blocker when the
   outcome is blocked. Indicator ink + outline, never a filled banner. */
function verdictGate(agent, outcome) {
  if (outcome !== "blocked") return null;
  const gate = (agent.gates || []).find((g) => typeof g === "string" && g.trim());
  const text = gate ? conciseText(gate, 64)
    : agent.statusReason ? conciseText(agent.statusReason, 64)
      : OUTCOME_LABELS.blocked;
  return el("span", { class: "verdict-gate", title: agent.statusReason || gate || null },
    icon("warning"), text);
}

/* The drawer's process-liveness chip. Unlike the row this renders ALL FOUR
   states, so `unknown` is stated as unknown somewhere instead of silently
   looking like health. Null when the field is absent — the drawer head then
   holds exactly the nodes it holds today. */
function verdictLiveness(agent) {
  const view = livenessView(agent);
  if (!view) return null;
  return el("span", {
    class: "verdict-liveness liveness-" + view.key,
    title: view.detail,
    "aria-label": "Process: " + view.label + ". " + view.detail,
  }, view.key === "died" ? icon("warning") : null, view.label);
}

/* ---------- attention: acknowledge / dismiss / snooze ----------

   The board could show that an agent wanted a human but gave the operator no
   way to answer it, so the same alert nagged forever and the signal stopped
   meaning anything. The server now persists the three verdicts and expires a
   snooze on its own (POST /api/attention {action, agentId[, until]}).

   The snapshot carries the EFFECT, not the record: an acknowledged, dismissed
   or snoozed agent simply stops being `status: "attention"`. So the client
   keeps the server's own returned record to say what it did — and drops a
   snooze the moment it runs out, which is exactly how an expired snooze
   visibly comes back: the record disappears here at the same time the agent
   returns to `attention` on the wire. */

const ATTENTION_SNOOZE_MS = 60 * 60_000;

const ATTENTION_ERRORS = {
  ATTENTION_NOT_FOUND: "The server has no unread notification recorded for this session, so there is nothing to clear.",
  UNSAFE_TARGET: "This session has no safely resolved terminal, so its attention state cannot be changed.",
  AGENT_NOT_FOUND: "This session is no longer in the current snapshot.",
  INVALID_SNOOZE_UNTIL: "The server rejected that snooze window.",
  ORIGIN_REJECTED: "The server refused the change as cross-origin. Reload this page from the address the server serves.",
};

function attentionErrorText(status, body) {
  const code = body && body.error && body.error.code;
  if (!status) return "Could not reach the server to change this attention state.";
  if (code && ATTENTION_ERRORS[code]) return ATTENTION_ERRORS[code];
  const message = body && body.error && body.error.message;
  return "Attention change failed"
    + (code ? " [" + code + "]" : "")
    + (message ? ": " + message : " (HTTP " + status + ")");
}

/* The live record for one agent, or null once a snooze has expired. Expiry is
   evaluated here rather than on a timer so the fact cannot get stuck. */
function attentionRecord(agentId, ui = state, now = Date.now()) {
  const record = ui.attention && ui.attention.get(agentId);
  if (!record) return null;
  if (record.action !== "snooze") return record;
  const until = Date.parse(record.snoozedUntil || "");
  if (!Number.isFinite(until) || until <= now) return null;
  return record;
}

function attentionStateText(record) {
  if (!record) return "";
  if (record.action === "acknowledge") return "Acknowledged — this alert will not ask again until the agent says something new.";
  if (record.action === "dismiss") return "Dismissed — cleared from the needs-a-human set.";
  return "Snoozed until " + issueTimestamp(record.snoozedUntil) + ".";
}

async function applyAttention(agentId, action, until) {
  if (state.attentionPending.has(agentId)) return;
  state.attentionPending.add(agentId);
  state.attentionErrors.delete(agentId);
  render();
  try {
    const res = await apiFetch("/api/attention", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action === "snooze" ? { action, agentId, until } : { action, agentId }),
    }, API_WRITE_TIMEOUT_MS);
    let body = null;
    try { body = await res.json(); } catch { /* a build without the route answers HTML */ }
    if (!res.ok || !body || body.ok !== true || !body.state) {
      state.attentionErrors.set(agentId, attentionErrorText(res.status, body));
    } else {
      state.attention.set(agentId, body.state);
      // The server refreshes the snapshot before answering, so re-reading it is
      // what makes the agent visibly leave the needs-a-human set.
      await fetchSnapshot();
    }
  } catch {
    state.attentionErrors.set(agentId, attentionErrorText(0, null));
  } finally {
    state.attentionPending.delete(agentId);
    render();
  }
}

function attentionButton(agent, action, label, until) {
  return el("button", {
    type: "button",
    class: "btn sm attn-act",
    disabled: state.attentionPending.has(agent.id) ? "" : null,
    dataset: { fkey: "attn:" + agent.id + ":" + action },
    onclick: () => applyAttention(agent.id, action, until),
  }, label);
}

/* Null for an agent nobody is waiting on and with nothing recorded, so the
   drawer is unchanged for the overwhelming majority of sessions. */
function renderAttentionBlock(agent, ui = state, now = Date.now()) {
  const asking = agent.status === "attention";
  const record = attentionRecord(agent.id, ui, now);
  const stale = ui.attention && ui.attention.get(agent.id) && !record;
  const error = ui.attentionErrors && ui.attentionErrors.get(agent.id);
  if (!asking && !record && !error) return null;

  const block = el("section", { class: "attn-block" + (asking ? " is-asking" : ""), "aria-label": "Attention" });
  if (asking) {
    block.append(el("p", { class: "attn-reason", text: conciseText(agent.statusReason, 160) }));
    // A snooze that ran out while the drawer was open: say so, rather than
    // letting the alert quietly reappear as if it had never been answered.
    if (stale) block.append(el("p", { class: "attn-returned", role: "status", text: "The snooze has run out — this session is asking again." }));
    block.append(el("div", { class: "attn-actions" },
      attentionButton(agent, "acknowledge", "Acknowledge"),
      attentionButton(agent, "dismiss", "Dismiss"),
      attentionButton(agent, "snooze", "Snooze 1 hour", new Date(now + ATTENTION_SNOOZE_MS).toISOString())));
  } else if (record) {
    block.append(el("p", { class: "attn-state", role: "status", text: attentionStateText(record) }));
  }
  if (error) block.append(el("p", { class: "attn-error", role: "alert", text: error }));
  return block;
}

/* The single most-relevant action control for the verdict head. Reuses the
   dock's derivation (capability + renderDockTool) so head and dock behave
   identically. Focus (jump to the pane) leads; Interrupt only when it is the
   sole enabled lever. When safe controls are locked the head stays empty —
   the control banner owns that story. */
function headPrimaryAction(agent) {
  const focusCap = capability(agent, "focus");
  const instructCap = capability(agent, "instruct");
  if ([focusCap, instructCap].some((c) => c && !c.enabled)) return null;
  if (focusCap && focusCap.enabled) return renderDockTool(agent, focusCap, "focus", { fkeyPrefix: "head:" });
  const interruptCap = capability(agent, "interrupt");
  if (interruptCap && interruptCap.enabled) return renderDockTool(agent, interruptCap, "interrupt", { fkeyPrefix: "head:" });
  return null;
}

// Agent drawer — status line + scroll body + sticky command dock (Focus/Send/
// Interrupt/Archive). No status pills, no Danger footer.
function renderAgentDrawer(pane, view) {
  const { agent, program } = view;
  const activity = deriveActivity(agent);
  const outcome = deriveOutcome(agent);
  const control = deriveControlState(agent);
  const policy = modelPolicyView(agent);

  // Provider channel: a 1px inset rail + the lineage current-node ring both read
  // from --prov, set CSP-safely by a class (never an inline style).
  pane.classList.add("dw-provider", "dw-provider--" + agent.provider, "dw-agent");

  // Verdict head — name, status words, the gate when blocked, and the one
  // most-relevant action: verdict first, act from the top.
  const sourceLine = quietSourceLine(agent);
  const cwdMismatch = Boolean(agent.target && agent.target.cwdMismatch);
  const headAction = headPrimaryAction(agent);
  pane.append(el("div", { class: "inspector-head inspector-verdict" },
    el("div", { class: "inspector-id" },
      el("h2", { class: "inspector-title", text: agentName(agent) }),
      sourceLine
        ? el("p", {
          class: "inspector-source-name" + (cwdMismatch ? " is-mismatch" : ""),
          title: fullSourceDetail(agent),
          text: sourceLine,
        })
        : null,
      el("p", { class: "inspector-sub" },
        el("span", { text: programName(program) }),
        " · ",
        el("span", { class: "chip provider-" + agent.provider },
          providerLabel(agent.provider) + (modelShort(agent.model) ? " · " + modelShort(agent.model) : ""))),
      renderStatusLine(agent, activity, outcome, control, policy),
      verdictLiveness(agent),
      verdictGate(agent, outcome)),
    el("div", { class: "verdict-side" },
      closeButton(),
      headAction ? el("div", { class: "verdict-action" }, headAction) : null)));

  const attentionBlock = renderAttentionBlock(agent);
  if (attentionBlock) pane.append(attentionBlock);

  const banner = renderControlBanner(agent, control);
  if (banner) pane.append(banner);

  if (agent.nextAction) {
    pane.append(el("p", { class: "next-action" },
      el("span", { class: "next-key", text: "Next" }), " ", agent.nextAction));
  }

  // Vitals promoted to an instrument band directly under the verdict head —
  // the numbers an operator acts on, no longer buried in the Evidence shelf.
  // The mount always holds this DOM position (after next-action, before the
  // shelf); renderVitalsBand omit-empties, and :empty hides the mount when the
  // source reports nothing, so no flex gap is spent on a blank band.
  const vitalsMount = el("div", { class: "inspector-vitals" });
  const vitalsBand = renderVitalsBand(agent);
  if (vitalsBand) vitalsMount.append(vitalsBand);
  pane.append(vitalsMount);

  // Horizontal bookshelf: Operate and Chat stay open side by side (the showcase);
  // Evidence — vitals, paths, routing, transcript — collapses into a caterpillar
  // rail that progressively reveals as a third column.
  pane.append(el("div", {
    class: "drawer-shelf" + (state.evidenceOpen ? " is-evidence-open" : ""),
    "aria-label": "Agent sections",
  },
    renderShelfSection({
      key: "operate",
      title: "Operate",
      open: true,
      body: renderOperate(agent, program),
    }),
    renderShelfSection({
      key: "chat",
      title: "Chat",
      open: true,
      body: renderChat(agent),
    }),
    renderEvidenceShelf(agent)));

  // Lineage spine demoted below the shelf — context, not action.
  pane.append(renderLineageSpine(agent));

  // Control feedback renders inside the dock, above the composer.
  pane.append(renderCommandDock(agent, control));
}

/* Bookshelf section — Operate/Chat stay open; Evidence uses the cog variant. */
function renderShelfSection({ key, title, open, body }) {
  const section = el("section", {
    class: "shelf-section" + (open ? " is-open" : ""),
    dataset: { shelf: key },
  });
  section.append(el("h3", { class: "shelf-title", text: title }));
  const panel = el("div", {
    class: "shelf-body inspector-panel",
    id: "shelf-" + key,
  });
  if (body) {
    if (body.nodeType) panel.append(body);
    else for (const child of body) if (child) panel.append(child);
  }
  section.append(panel);
  return section;
}

function renderEvidenceShelf(agent) {
  if (!state.evidenceOpen) {
    // Whimsical collapsed rail — third column as a caterpillar/cog strip.
    return el("button", {
      type: "button",
      class: "shelf-evidence-rail",
      "aria-expanded": "false",
      "aria-controls": "shelf-evidence",
      title: "Open evidence — vitals, paths, routing, transcript",
      dataset: { fkey: "shelf:evidence:open" },
      onclick: () => { state.evidenceOpen = true; render(); },
    },
      el("span", { class: "shelf-rail-spine", "aria-hidden": "true" },
        el("span", { class: "shelf-rail-bead" }),
        el("span", { class: "shelf-rail-bead" }),
        el("span", { class: "shelf-rail-bead" }),
        el("span", { class: "shelf-rail-bead" })),
      icon("gear", { label: "Open evidence" }),
      el("span", { class: "shelf-rail-label", text: "Evidence" }));
  }

  // Evidence holds paths, routing, and the transcript tail. The vitals
  // instrument band moved out to lead the drawer under the verdict head
  // (renderVitalsBand); Evidence no longer carries the metrics tiles.
  const body = renderEvidence(agent);
  const section = el("section", {
    class: "shelf-section shelf-evidence is-open",
    dataset: { shelf: "evidence" },
  });
  section.append(el("div", { class: "shelf-evidence-head" },
    el("h3", { class: "shelf-title", text: "Evidence" }),
    el("button", {
      type: "button",
      class: "shelf-cog is-active",
      "aria-expanded": "true",
      "aria-controls": "shelf-evidence",
      title: "Tuck evidence away",
      dataset: { fkey: "shelf:evidence:close" },
      onclick: () => { state.evidenceOpen = false; render(); },
    }, icon("gear", { label: "Hide evidence" }))));
  body.id = "shelf-evidence";
  body.classList.add("shelf-body");
  section.append(body);
  return section;
}

/* One calm status sentence under the title — replaces the pill cluster. */
function renderStatusLine(agent, activity, outcome, control, policy) {
  const line = el("div", {
    class: "status-line",
    role: "status",
    "aria-label": "Session status",
  });

  const live = el("span", { class: "status-line-live act-" + activity });
  if (activity === "working") live.append(el("span", { class: "status-pulse", "aria-hidden": "true" }));
  else live.append(el("span", { class: "act-glyph act-" + activity, "aria-hidden": "true" }));
  live.append(ACTIVITY_LABELS[activity] || activity);
  line.append(live);

  line.append(el("span", { class: "status-line-sep", "aria-hidden": "true", text: "·" }));
  line.append(el("span", {
    class: "status-line-item outcome-" + outcome,
    text: OUTCOME_LABELS[outcome] || outcome,
  }));

  line.append(el("span", { class: "status-line-sep", "aria-hidden": "true", text: "·" }));
  const controlNode = el("span", {
    class: "status-line-item control-" + control,
    title: CONTROL_HINTS[control] || null,
  });
  if (control === "quarantined" || control === "linked" || control === "observed-only") {
    controlNode.append(icon(CONTROL_ICONS[control] || "observed"));
  }
  controlNode.append(CONTROL_STATE_TEXT[control] || CONTROL_LABELS[control] || control);
  line.append(controlNode);

  if (policy && policy.state === "mismatch") {
    line.append(el("span", { class: "status-line-sep", "aria-hidden": "true", text: "·" }));
    line.append(el("span", {
      class: "status-line-item policy-mismatch",
      title: policy.summary || null,
    }, icon("warning"), "Model mismatch"));
  }

  return line;
}

/* Quarantine / observed-only: one banner, not a disabled Focus card. It names
   the reason resolution refused, in the resolver's own words, and the one thing
   the operator can do about it — the evidence was always in the payload; the
   banner used to throw it away and print a fixed sentence instead. All of
   `why` is agent-controlled text, so it rides textContent only. */
function renderControlBanner(agent, control) {
  const focusCap = capability(agent, "focus");
  const instructCap = capability(agent, "instruct");
  const locked = [focusCap, instructCap].some((c) => c && !c.enabled);
  if (!locked) return null;
  const brief = quarantineBrief(agent, control);

  const copy = el("div", { class: "control-banner-copy" },
    el("strong", { text: brief.title }),
    " ",
    controlUnavailableText(control));
  if (brief.why) copy.append(el("p", { class: "control-banner-why", text: brief.why }));
  copy.append(el("p", { class: "control-banner-next", text: brief.nextStep }));
  copy.append(el("button", {
    type: "button",
    class: "control-banner-link",
    dataset: { fkey: "control-evidence:" + agent.id },
    onclick: () => {
      state.evidenceOpen = true;
      if (state.identity.agentId !== agent.id) void loadIdentityEvidence(agent.id);
      else render();
    },
  }, "See routing evidence →"));

  return el("div", { class: "control-banner", role: "status" },
    icon(control === "quarantined" ? "quarantine" : "observed"),
    copy);
}

function closeButton() {
  return el("button", {
    type: "button", class: "btn inspector-close",
    "aria-label": "Close inspector",
    dataset: { fkey: "inspector-close" },
    onclick: () => closeInspector(),
  }, icon("close"), "Close");
}

/* ---------- inspector: command dock ---------- */

const ACTION_LABELS = { focus: "Focus", instruct: "Send", interrupt: "Interrupt", archive: "Archive" };
const NEEDS_CONFIRM = new Set(["interrupt", "archive"]);

function capability(agent, action) {
  return (agent.controls || []).find((c) => c.action === action);
}

/* Sticky composer + quiet tools. Replaces the old Focus card and Danger zone.
   `alarm` is the feed-staleness verdict: on a frozen board every control here is
   held and says so, because the snapshot's routing evidence is as old as the
   rest of it. Defaulted (not passed by the caller) so the drawer call site stays
   `renderCommandDock(agent, control)` and the dock is still testable in isolation. */
function renderCommandDock(agent, control = deriveControlState(agent), alarm = feedAlarm(state.conn, state.snap && state.snap.generatedAt), actions = state.actions.items) {
  const focusCap = capability(agent, "focus");
  const instructCap = capability(agent, "instruct");
  const interruptCap = capability(agent, "interrupt");
  const archiveCap = capability(agent, "archive");
  if (!focusCap && !instructCap && !interruptCap && !archiveCap) {
    return el("span", { hidden: "" });
  }

  const safeLocked = [focusCap, instructCap].some((c) => c && !c.enabled);
  const held = Boolean(alarm);
  const linkedReady = !safeLocked && !held && control === "linked";
  const dock = el("div", {
    class: "command-dock" + (linkedReady ? " command-dock--linked" : "") + (held ? " is-held" : ""),
    "aria-label": "Session controls",
  });
  if (held) {
    dock.append(el("p", { class: "command-dock-stale", role: "status", text: staleControlNote(alarm) }));
  }

  // One lock narrative: the control banner owns the reason. The dock meta only
  // speaks when the link is live, and the send hint only when Send can send.
  const showHint = Boolean(instructCap && instructCap.enabled) && !held;
  if (linkedReady || showHint) {
    const meta = el("div", { class: "command-dock-meta" });
    meta.append(linkedReady
      ? el("span", { class: "command-dock-ready", text: "Ready · linked" })
      : el("span", { "aria-hidden": "true" }));
    if (showHint) meta.append(el("span", { class: "command-dock-hint", text: "⌘↵ to send" }));
    dock.append(meta);
  }

  const fb = state.feedback.get(agent.id);
  if (fb) {
    dock.append(el("p", {
      class: "control-feedback " + (fb.ok ? "ok" : "err"),
      role: "status",
      text: fb.message,
    }));
  }

  // "Did I already tell this lane to rebase?" — the journal's answer, next to
  // the button that would send it again. Silent until the log has actually
  // loaded: an unanswered endpoint must not read as "nothing was ever sent".
  const last = lastActionFor(actions, agent.id);
  if (last) {
    const outcome = actionOutcomeView(last.outcome);
    dock.append(el("p", { class: "command-dock-last", dataset: { tone: outcome.tone } },
      (ACTION_KIND_LABELS[last.kind] || last.kind)
      + (last.at ? " " + agoText(last.at) : "")
      + " · " + outcome.label));
  }

  // Composer is the primary interaction — Focus no longer sits above a dead input.
  if (instructCap) {
    const key = agent.id + ":instruct";
    const busy = state.pending.has(key);
    const sendable = instructCap.enabled && !held;
    const input = el("input", {
      type: "text",
      placeholder: held
        ? "Held until the feed catches up…"
        : instructCap.enabled
          ? "Instruct this agent…"
          : (control === "quarantined"
            ? "Resolve identity conflict to instruct…"
            : "Instruction unavailable"),
      disabled: sendable ? null : "",
      value: state.drafts.get(agent.id) || "",
      "aria-label": "Instruction for " + agentName(agent),
      dataset: { fkey: "draft:" + agent.id },
      oninput: (e) => state.drafts.set(agent.id, e.target.value),
      onkeydown: (e) => {
        if (!(e.key === "Enter" && (e.metaKey || e.ctrlKey))) return;
        e.preventDefault();
        const text = (state.drafts.get(agent.id) || "").trim();
        if (!text || busy || !sendable) return;
        sendControl(agent, "instruct", text);
      },
    });
    dock.append(el("form", {
      class: "command-composer",
      onsubmit: (e) => {
        e.preventDefault();
        const text = (state.drafts.get(agent.id) || "").trim();
        if (!text || busy || !sendable) return;
        sendControl(agent, "instruct", text);
      },
    },
      input,
      el("button", {
        type: "submit", class: "btn primary command-send",
        disabled: sendable && !busy ? null : "",
        "aria-busy": busy ? "true" : null,
        dataset: { fkey: "act:" + key },
      }, busy ? "Sending…" : "Send")));
  }

  const tools = el("div", { class: "command-dock-tools" });
  if (focusCap) tools.append(renderDockTool(agent, focusCap, "focus", { held }));
  if (interruptCap) tools.append(renderDockTool(agent, interruptCap, "interrupt", { held }));
  tools.append(el("span", { class: "command-dock-spacer" }));
  // When Send/Focus are locked, Archive is the wrong lever — tuck it away so
  // the dock does not offer a destructive peer next to dead controls.
  if (archiveCap && !safeLocked) tools.append(renderDockTool(agent, archiveCap, "archive", { held }));
  dock.append(tools);
  if (archiveCap && safeLocked) {
    dock.append(el("details", { class: "command-dock-more" },
      el("summary", { text: "More" }),
      renderDockTool(agent, archiveCap, "archive", { held })));
  }

  // Plain-language lock copy also lives in the banner; dock meta stays short.
  // Tests assert controlUnavailableText is used for unavailable safe controls.
  if (safeLocked) {
    dock.append(el("p", { class: "visually-hidden",
      text: controlUnavailableText(deriveControlState(agent)) }));
  }

  return dock;
}

function renderDockTool(agent, cap, action, opts = {}) {
  const key = agent.id + ":" + action;
  const busy = state.pending.has(key);
  const label = ACTION_LABELS[action] || action;
  const isArchive = action === "archive";
  // The head renders a copy of a dock tool without knowing about the feed, so a
  // caller that does not pass `held` still gets the module verdict rather than a
  // silently-live button on a frozen board.
  const held = opts.held === undefined ? feedFrozen() : Boolean(opts.held);
  // Instance-scoped keys: the verdict head renders a copy of a dock tool, so
  // focus restore and the confirm strip must bind to the clicked instance —
  // never both surfaces at once. Busy/sendControl state stays shared via key.
  const fkey = (opts.fkeyPrefix || "") + "act:" + key;
  const confirmKey = (opts.fkeyPrefix || "") + "confirm:" + key;

  if (state.confirming === fkey) {
    return el("span", { class: "confirm-strip command-confirm", role: "group",
      "aria-label": label + " " + agentName(agent) + "?" },
      el("span", { text: label + "?" }),
      el("button", {
        type: "button", class: "btn confirm-yes",
        dataset: { fkey: confirmKey },
        onclick: () => { state.confirming = null; sendControl(agent, action); },
      }, "Confirm"),
      el("button", {
        type: "button", class: "btn sm",
        dataset: { fkey: confirmKey + ":cancel" },
        onclick: () => { state.confirming = null; render(); },
      }, "Cancel"));
  }

  return el("button", {
    type: "button",
    class: "dock-tool" + (isArchive ? " dock-tool-warn" : "") + (held ? " is-held" : ""),
    disabled: cap.enabled && !busy && !held ? null : "",
    "aria-busy": busy ? "true" : null,
    title: held ? "Held — the board is not current" : cap.enabled ? (action === "focus" ? focusDestinationHint(agent) : label) : "Unavailable",
    dataset: { fkey },
    onclick: () => {
      if (held) return;
      if (NEEDS_CONFIRM.has(action)) {
        state.confirming = fkey;
        render();
        const btn = document.querySelector(`[data-fkey="${CSS.escape(confirmKey)}"]`);
        if (btn) btn.focus();
        return;
      }
      sendControl(agent, action);
    },
  },
    icon(action === "focus" ? "focus" : action === "interrupt" ? "interrupt" : "archive"),
    busy ? label + "…" : label);
}

function sourceWorkspaceLabel(target) {
  return target.workspaceTitle ? "terminal: " + target.workspaceTitle : "terminal workspace";
}

function sourceRoomLabel(target) {
  return target.workspaceTitle ? "terminal: " + target.workspaceTitle : "terminal";
}

function presentationLabelTargets(agent) {
  const targets = [];
  if (agent.target && agent.target.workspaceId) {
    const terminal = terminalSourceName(agent) || sourceWorkspaceLabel(agent.target);
    targets.push({
      target: workspaceLabelTarget(agent.target.workspaceId),
      kind: "workspace",
      source: terminal.startsWith("terminal:") ? terminal : "terminal: " + terminal,
      sourceEvidence: "Terminal / workspace: " + terminal + " · id stays " + agent.target.workspaceId,
    });
  }
  if (agent.target && agent.target.surfaceId) {
    targets.push({
      target: roomLabelTarget(agent.target.surfaceId),
      kind: "room",
      source: sourceRoomLabel(agent.target),
      sourceEvidence: "Terminal surface id stays " + agent.target.surfaceId,
    });
  }
  if (agentLabelEligible(agent)) {
    targets.push({
      target: agentLabelTarget(agent),
      kind: "agent",
      source: sourceAgentName(agent),
      sourceEvidence: "Source agent: " + sourceAgentName(agent) + " · id stays " + agent.id,
    });
  }
  return targets;
}

/* Names (presentation labels) stay collapsed — rare rename UI, not chrome. */
function renderNamesDisclosure(agent) {
  const targets = presentationLabelTargets(agent);
  if (!targets.length && !state.labelsLoading && !state.labelLoadError) return null;

  const body = el("div", { class: "presentation-labels" });
  if (state.labelsLoading) body.append(el("p", { class: "label-status", text: "Loading saved labels…" }));
  if (state.labelLoadError) {
    body.append(el("p", {
      class: "label-status err", role: "status",
      text: "Saved labels unavailable: " + state.labelLoadError,
    }));
  }
  for (const item of targets) {
    const key = presentationLabelKey(item.target);
    const label = state.aliases.get(key);
    const editing = state.renaming === key;
    const actionText = label ? "Edit" : item.kind === "agent" ? "Name agent" : "Name " + item.kind;
    const row = el("div", { class: "label-row" },
      el("div", { class: "label-copy" },
        el("span", { class: "label-value", text: label || item.source }),
        el("span", { class: "label-source", text: "Source: " + item.source })),
      editing ? null : el("button", {
        type: "button", class: "btn label-action",
        "aria-label": actionText + " " + item.kind + " label",
        dataset: { fkey: "label-edit:" + key },
        onclick: () => startRename(item.target),
      }, actionText));
    body.append(row);
    if (editing) {
      body.append(renderLabelForm(item.target, {
        inputKey: "label-input:" + key,
        placeholder: "Display label for this " + item.kind,
        ariaLabel: "New display label for " + item.kind,
        source: item.sourceEvidence,
      }));
    }
  }

  const editingHere = targets.some((item) => state.renaming === presentationLabelKey(item.target));
  return el("details", {
    class: "names-disclosure",
    // Stay open while a rename form is live so re-render does not tuck it away.
    open: editingHere || state.labelsLoading || state.labelLoadError ? "" : null,
  },
    el("summary", { text: "Names" }),
    body);
}

/* ---------- inspector: Operate · Chat · Evidence ---------- */

function dtdd(grid, label, value, opts = {}) {
  // Take C hard rule: if a value isn’t there, the field isn’t rendered.
  if (value == null || value === "") return;
  const hint = opts.hint ?? GLOSSARY[label];
  grid.append(hint
    ? el("dt", {}, el("span", {
        class: "term-hint", tabindex: "0",
        title: hint, "aria-label": `${label}: ${hint}`, text: label,
      }))
    : el("dt", { text: label }));
  const dd = el("dd", {});
  if (value.nodeType) dd.append(value);
  else dd.append(opts.code ? el("code", { text: String(value) }) : String(value));
  grid.append(dd);
}

function normalizeCompareText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function taskMeaningfullyDifferent(agent) {
  const task = typeof agent?.task === "string" ? agent.task.trim() : "";
  if (!task) return false;
  const message = typeof agent?.lastHumanMessage === "string" ? agent.lastHumanMessage.trim() : "";
  if (!message) return true;
  const a = normalizeCompareText(task);
  const b = normalizeCompareText(message);
  if (!a || a === b) return false;
  if (a.length >= 12 && b.includes(a)) return false;
  if (b.length >= 12 && a.includes(b)) return false;
  return true;
}

function transcriptArtifact(agent) {
  return (agent.artifacts || []).find((a) => a && (a.kind === "transcript" || /transcript/i.test(a.label || "")));
}

/* One instrument tile: label + figure. Callers only pass real data — the band
   omits absent tiles entirely (no "not reported" face), matching the drawer's
   omit-empty rule. */
function vitalTile(label, figure) {
  return el("div", { class: "vital" },
    el("span", { class: "vital-label", text: label }),
    figure);
}

/* Vitals band — the numbers an operator acts on, rendered as instruments (a
   context ring, session tokens + cache efficiency, uptime) directly under the
   verdict head instead of buried in the Evidence shelf. Every tile self-guards;
   if nothing has data the band renders nothing (omit-empty), so the mount's
   :empty rule collapses it. No per-agent cost tile: AgentSnapshot.cost exists in
   the type but is never populated — real cost is program/pulse-level only, and
   program cost has no place inside a single agent's band. */
function renderVitalsBand(agent) {
  const t = agent.tokens || {};
  const tiles = [];

  // Context pressure — a ring when we have an observed window, else the raw token
  // summary so any source with tokens still gets a tile.
  const ctx = contextUsage(t);
  if (ctx) {
    tiles.push(vitalTile("Context",
      el("div", { class: "vital-ring-wrap" },
        svgRing(ctx.pct, { label: "Context window " + ctx.pct + " percent full" }),
        el("div", { class: "vital-figure" },
          el("div", { class: "vital-big mono" },
            fmtTok(t.total), el("small", { text: " /" + fmtTok(t.contextWindow) }))))));
  } else {
    const tok = tokenSummary(t);
    if (tok.known) {
      tiles.push(vitalTile(tok.label === "latest call" ? "Latest call" : "Tokens",
        el("div", { class: "vital-big mono", title: tok.title, text: tok.text })));
    }
  }

  // Session spend + cache-hit efficiency (computed, not raw).
  const cacheHit = (t.cachedInput != null && t.input) ? Math.min(100, Math.round((t.cachedInput / t.input) * 100)) : null;
  if (t.sessionTotal != null) {
    tiles.push(vitalTile("Session tokens",
      el("div", {},
        el("div", { class: "vital-big mono", text: fmtTok(t.sessionTotal) }),
        cacheHit != null ? el("div", { class: "vital-sub", text: cacheHit + "% cache hit last call" }) : null,
        cacheHit != null ? svgMeter(cacheHit, "vital-bar", { label: cacheHit + "% cached" }) : null)));
  }

  // Uptime.
  const elapsed = liveElapsedText(agent, state.snap && state.snap.generatedAt);
  if (elapsed && elapsed !== "—") {
    tiles.push(vitalTile("Uptime",
      el("div", { class: "vital-big mono", dataset: elapsedDataset(agent, state.snap && state.snap.generatedAt), text: elapsed })));
  } else if (agent.updatedAt) {
    tiles.push(vitalTile("Last update",
      el("div", { class: "vital-big mono", dataset: { ago: agent.updatedAt }, text: agoText(agent.updatedAt) })));
  }

  if (!tiles.length) return null;
  const band = el("div", { class: "vitals" });
  for (const tile of tiles) band.append(tile);
  return band;
}

function renderOperateMeta(agent) {
  const items = [];
  if (agent.role && agent.role !== "agent") {
    items.push({
      label: "role",
      hint: GLOSSARY.role,
      node: el("span", { text: ROLE_LABELS[agent.role] || agent.role }),
    });
  }
  if (agent.model) {
    items.push({
      label: "model",
      hint: GLOSSARY.model,
      node: el("span", { class: "mono", text: modelShort(agent.model) || agent.model }),
    });
  }
  // Uptime, token, and context figures now lead the drawer in the vitals
  // instrument band under the verdict head. This meta row stays identity-only.
  if (!items.length) return null;

  const row = el("div", { class: "operate-meta", "aria-label": "Session meta" });
  for (const item of items) {
    row.append(el("span", { class: "operate-meta-item" },
      el("span", {
        class: "operate-meta-label term-hint",
        tabindex: "0",
        title: item.hint || null,
        "aria-label": item.hint ? `${item.label}: ${item.hint}` : item.label,
        text: item.label,
      }),
      item.node));
  }
  return row;
}

function renderOperate(agent, _program) {
  const panel = el("div", { class: "inspector-panel", role: "tabpanel" });
  const message = typeof agent.lastHumanMessage === "string" ? agent.lastHumanMessage.trim() : "";
  if (message) {
    panel.append(
      el("h3", { class: "section-title", text: "Last human message" }),
      el("p", { class: "last-human-message", tabindex: "0", text: agent.lastHumanMessage }));
  }

  if (taskMeaningfullyDifferent(agent)) {
    panel.append(
      el("h3", { class: "section-title", text: "Task" }),
      el("p", { class: "operate-task", text: agent.task.trim() }));
  }

  const outcome = deriveOutcome(agent);
  if (outcome !== "healthy" && agent.statusReason) {
    panel.append(el("p", {
      class: "operate-outcome-note outcome-" + outcome,
      text: (OUTCOME_LABELS[outcome] || outcome) + " — " + agent.statusReason,
    }));
  }

  // Vitals lead the drawer as an instrument band under the verdict head — Operate
  // stays a calm digest so Chat + Operate can showcase side by side.
  const meta = renderOperateMeta(agent);
  if (meta) panel.append(meta);
  if (!panel.childNodes.length) {
    panel.append(el("p", { class: "inspector-note", text: "No operate digest yet for this session." }));
  }
  return panel;
}

function renderChatTurn(role, text) {
  return el("div", { class: "chat-turn chat-turn--" + role },
    el("div", { class: "chat-turn-role", text: role === "user" ? "User" : "Assistant" }),
    el("p", { class: "chat-turn-body", tabindex: "0", text }));
}

function renderChat(agent) {
  const panel = el("div", { class: "inspector-panel", role: "tabpanel" });
  // Readable You/Agent turns only — the raw transcript tail lives in Evidence.
  const userRaw = agent.lastUserMessage !== undefined ? agent.lastUserMessage : agent.lastHumanMessage;
  const user = typeof userRaw === "string" ? userRaw.trim() : "";
  const assistant = typeof agent.lastAgentMessage === "string" ? agent.lastAgentMessage.trim() : "";
  if (user) panel.append(renderChatTurn("user", userRaw));
  if (assistant) panel.append(renderChatTurn("assistant", agent.lastAgentMessage));

  const artifact = transcriptArtifact(agent);
  if (artifact && artifact.path) {
    panel.append(el("p", { class: "chat-transcript-link" },
      el("span", { text: "Transcript: " }),
      el("code", { text: artifact.path }),
      " ",
      el("button", {
        type: "button", class: "btn sm",
        dataset: { fkey: `copy-transcript:${agent.id}` },
        onclick: () => copyText(artifact.path),
      }, "Copy path")));
  }

  if (!panel.childNodes.length) {
    panel.append(el("p", { class: "inspector-note", text: "No chat turns available yet." }));
  }
  return panel;
}

/* Lineage spine — the signature nesting element. Ancestors climb a single thin
   rail to the current agent (a filled provider-colored ring); direct children
   fan out below. Depth is encoded by color, never by indentation, so it can
   never degrade into a repeated card stack. Deep chains (>4 ancestors) collapse
   the middle into a ⋯ breadcrumb crumb (plan §4). */
function lineageMeta(text) {
  return el("span", { class: "dw-lin-meta", text: " " + text });
}

function lineageNode(a, depthCls) {
  const rv = roleView(a.role);
  return el("div", { class: "dw-node " + depthCls },
    el("span", { class: "dw-rail" }, el("span", { class: "dw-glyph", "aria-hidden": "true" })),
    el("button", {
      type: "button", class: "dw-lin-name",
      dataset: { fkey: "lineage:" + a.id },
      onclick: () => selectEntity({ kind: "agent", id: a.id }),
    }, agentName(a), rv.key !== "agent" ? lineageMeta("· " + rv.label) : null));
}

function lineageCrumb(text) {
  return el("div", { class: "dw-node" },
    el("span", { class: "dw-rail" }, el("span", { class: "dw-glyph", "aria-hidden": "true" })),
    el("span", { class: "dw-lin-crumb", text }));
}

function lineageKid(child) {
  const act = deriveActivity(child);
  const outcome = deriveOutcome(child);
  const needs = outcome !== "healthy" && act !== "ended";
  const dotCls = needs ? "dw-dot--needs" : act === "working" ? "dw-dot--work" : act === "ended" ? "dw-dot--end" : "dw-dot--idle";
  const stateText = needs ? OUTCOME_LABELS[outcome] : ACTIVITY_LABELS[act];
  return el("button", {
    type: "button", class: "dw-kid",
    dataset: { fkey: "lineage-kid:" + child.id },
    onclick: () => selectEntity({ kind: "agent", id: child.id }),
  }, el("span", { class: "dw-dot " + dotCls, "aria-hidden": "true" }), agentName(child) + " — " + stateText);
}

function renderLineageSpine(agent) {
  const fullById = new Map(snapshotAgents(state.snap).map(({ agent: a }) => [a.id, a]));
  const children = [...fullById.values()].filter((a) => a.parentAgentId === agent.id);
  const ancestors = [];
  const seen = new Set([agent.id]);
  let p = agent.parentAgentId ? fullById.get(agent.parentAgentId) : null;
  while (p && !seen.has(p.id)) { seen.add(p.id); ancestors.push(p); p = p.parentAgentId ? fullById.get(p.parentAgentId) : null; }
  ancestors.reverse(); // root → immediate parent
  const untrackedParent = !!agent.parentAgentId && !fullById.get(agent.parentAgentId);

  if (!ancestors.length && !children.length && !untrackedParent) return el("span", { hidden: "" });

  const lin = el("div", { class: "dw-lin" });
  if (untrackedParent) {
    lin.append(lineageCrumb("Orchestrator not tracked"));
  } else if (ancestors.length > 4) {
    // Collapse the middle; keep the nearest ancestor next to the current node.
    lin.append(lineageCrumb("⋯ " + (ancestors.length - 1) + " earlier ancestors"));
    lin.append(lineageNode(ancestors[ancestors.length - 1], "dw-d2"));
  } else {
    ancestors.forEach((a, i) => lin.append(lineageNode(a, "dw-d" + Math.min(i, 2))));
  }
  lin.append(el("div", { class: "dw-node dw-cur" },
    el("span", { class: "dw-rail" }, el("span", { class: "dw-glyph", "aria-hidden": "true" })),
    el("span", { class: "dw-lin-name dw-cur-name" }, agentName(agent), lineageMeta("· this"))));

  const spine = el("div", { class: "dw-spine", "aria-label": "Lineage" },
    el("div", { class: "dw-spine-label", text: "Lineage" }),
    lin);

  if (children.length) {
    const fan = el("div", { class: "dw-child-fan" });
    for (const child of children.slice(0, 5)) fan.append(lineageKid(child));
    if (children.length > 5) fan.append(el("span", { class: "dw-more", text: "+" + (children.length - 5) + " more subagents" }));
    spine.append(fan);
  }
  return spine;
}

/* ---------- inspector: Evidence ---------- */

function copyIdButton(label, value, key) {
  if (!value) return null;
  return el("button", {
    type: "button",
    class: "btn sm evidence-copy-id",
    title: value,
    dataset: { fkey: key },
    onclick: () => copyText(value),
  }, "Copy " + label);
}

function controlLinkSentence(target) {
  if (!target) return null;
  const resolution = RESOLUTION_LABELS[target.resolution] || target.resolution;
  const terminal = target.workspaceTitle ? "terminal: " + target.workspaceTitle : null;
  if (target.resolution === "exact" || target.resolution === "unique-cwd") {
    return (terminal ? "Linked to " + terminal + " for Focus and Send" : "Linked for Focus and Send")
      + " · " + resolution
      + (target.cwdMismatch ? " · session cwd ≠ pane folder" : "")
      + ".";
  }
  if (target.resolution === "ambiguous") {
    return "Control routing is quarantined — identity evidence is ambiguous"
      + (terminal ? " for " + terminal : "")
      + ".";
  }
  return "No safe control link"
    + (terminal ? " for " + terminal : "")
    + (resolution ? " · " + resolution : "")
    + ".";
}

function renderControlLink(target) {
  if (!target) return null;
  const wrap = el("div", { class: "evidence-control-link" });
  const sentence = controlLinkSentence(target);
  wrap.append(el("p", {
    class: "evidence-control-sentence",
    title: target.cwdMismatch ? CWD_MISMATCH_HINT : READY_LINKED_HINT,
    text: sentence,
  }));
  const ids = el("div", { class: "evidence-ids" });
  const buttons = [
    copyIdButton("workspace", target.workspaceId, "copy-ws:" + (target.workspaceId || "")),
    copyIdButton("surface", target.surfaceId, "copy-surface:" + (target.surfaceId || "")),
    copyIdButton("pane", target.paneId, "copy-pane:" + (target.paneId || "")),
  ].filter(Boolean);
  for (const btn of buttons) ids.append(btn);
  if (buttons.length) wrap.append(ids);
  return wrap;
}

/* The routing story in full: which tier bound the session (or refused), the
   ordered evidence trail, and — on demand — the ps/lsof view of the terminals
   involved, which is the only place "ttys082 has both of these open" can come
   from. Nothing here is fabricated: an agent with no trace renders nothing. */
function renderIdentityBlock(agent, ui = state) {
  const view = identityTraceView(agent);
  if (!view.steps.length && !view.reason && !view.bridge) return null;

  const wrap = el("div", { class: "identity-block" },
    el("h3", { class: "section-title", text: "Identity resolution" }));

  const verdict = view.matchedTier
    ? "Bound by " + (IDENTITY_TIER_LABELS[view.matchedTier] || view.matchedTier).toLowerCase()
      + " · " + (RESOLUTION_LABELS[view.resolution] || view.resolution)
    : "Not bound · " + (RESOLUTION_LABELS[view.resolution] || view.resolution);
  wrap.append(el("p", { class: "identity-verdict", text: verdict }));
  if (view.reason) wrap.append(el("p", { class: "identity-reason", text: view.reason }));

  if (view.steps.length) {
    wrap.append(el("ol", { class: "identity-steps", "aria-label": "Identity resolution trail" },
      view.steps.map((step) => el("li", { class: "identity-step identity-step--" + step.outcome },
        el("span", { class: "identity-step-tier", text: step.tierLabel }),
        el("span", { class: "identity-step-outcome", text: step.outcomeLabel }),
        el("span", { class: "identity-step-detail", text: step.detail })))));
  }

  if (view.bridge) {
    wrap.append(el("p", { class: "identity-note", text:
      "A remembered binding to " + (view.bridge.surfaceId || "a terminal")
      + " carried this session through a scan with no live evidence"
      + (view.bridge.confirmedAt ? " (last confirmed " + agoText(view.bridge.confirmedAt) + ")" : "")
      + "." }));
  }

  wrap.append(renderSurfaceEvidence(agent, ui));
  return wrap;
}

/* The on-demand half. Only the debug endpoint knows the pids, commands and
   open session files behind a terminal, so this is a button until asked. */
function renderSurfaceEvidence(agent, ui = state) {
  const identity = ui.identity || { agentId: null, loading: false, error: "", data: null };
  const shown = identity.agentId === agent.id;
  const wrap = el("div", { class: "identity-surfaces" });

  if (!shown || identity.loading) {
    wrap.append(el("button", {
      type: "button",
      class: "btn sm identity-load",
      disabled: shown && identity.loading ? "" : null,
      "aria-busy": shown && identity.loading ? "true" : null,
      dataset: { fkey: "identity-load:" + agent.id },
      onclick: () => void loadIdentityEvidence(agent.id),
    }, shown && identity.loading ? "Reading terminals…" : "Show which terminals claim this session"));
    return wrap;
  }

  if (identity.error) {
    wrap.append(el("p", { class: "identity-error", role: "alert",
      text: "Terminal evidence unavailable: " + identity.error }));
    wrap.append(el("button", {
      type: "button", class: "btn sm identity-load",
      dataset: { fkey: "identity-load:" + agent.id },
      onclick: () => void loadIdentityEvidence(agent.id),
    }, "Retry"));
    return wrap;
  }

  const collisions = surfaceCollisions(identity.data);
  if (!collisions.length) {
    wrap.append(el("p", { class: "identity-note", text: "No cmux terminal reports evidence for this session." }));
    return wrap;
  }
  const list = el("ul", { class: "identity-surface-list", "aria-label": "Terminals claiming this session" });
  for (const collision of collisions) {
    const item = el("li", { class: "identity-surface" + (collision.claims.length > 1 ? " is-contested" : "") },
      el("span", { class: "identity-surface-line mono", text: collisionLine(collision) }));
    if (collision.conflict) {
      item.append(el("span", { class: "identity-surface-conflict", text: collision.conflict }));
    }
    list.append(item);
  }
  wrap.append(list);
  return wrap;
}

/* ---------- inspector: inline transcript ----------

   Verifying "this lane says it is done — is that true?" used to mean copying a
   path out of the drawer, switching to a terminal, jq-ing a JSONL and switching
   back, per agent, across ~200 lanes. The snapshot only carries a fixed 800-char
   tail (MAX_TRANSCRIPT_TAIL_CHARS), which is not enough to answer the question.

   Contract (GET /api/transcript?agent=<id>&limit=<n>, built in a parallel lane):
     { ok, agentId, source, truncated, lines: [{ at, role, text }] }
   `text` is UNTRUSTED agent output. It rides textContent only, with no
   exceptions — the source guard that forbids markup assignment covers this file
   as a whole, and every string below goes through el({ text }). */

const TRANSCRIPT_DEFAULT_LIMIT = 200;
const TRANSCRIPT_MAX_LIMIT = 1000;         // the contract's hard cap
const TRANSCRIPT_LIMIT_STEPS = [200, 500, 1000];
// Painting a 1000-line transcript as 1000 nodes on every drawer repaint is how
// an inspector becomes unusable. The window is the tail, which is the part the
// operator is asking about; the count it is hiding is stated, never implied.
const TRANSCRIPT_RENDER_CAP = 300;
const TRANSCRIPT_ROLES = new Set(["user", "assistant", "tool", "system", "unknown"]);
const TRANSCRIPT_ROLE_LABELS = {
  user: "You", assistant: "Agent", tool: "Tool", system: "System", unknown: "—",
};

function clampTranscriptLimit(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return TRANSCRIPT_DEFAULT_LIMIT;
  return Math.min(TRANSCRIPT_MAX_LIMIT, Math.max(1, v));
}

function nextTranscriptLimit(current) {
  return TRANSCRIPT_LIMIT_STEPS.find((step) => step > clampTranscriptLimit(current)) || null;
}

function transcriptUrl(agentId, limit) {
  return "/api/transcript?agent=" + encodeURIComponent(agentId) + "&limit=" + clampTranscriptLimit(limit);
}

/* The wire shape, defended. Everything in it is agent-derived: an unknown role
   collapses to "unknown", a non-string `text` is dropped rather than String()-ed
   into "[object Object]", and a missing `source` stays null instead of becoming
   a plausible-looking path. Never invent content. */
function normalizeTranscript(body) {
  const rows = Array.isArray(body && body.lines) ? body.lines : [];
  const lines = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || typeof row.text !== "string") continue;
    lines.push({
      at: typeof row.at === "string" && !Number.isNaN(Date.parse(row.at)) ? row.at : null,
      role: TRANSCRIPT_ROLES.has(row.role) ? row.role : "unknown",
      text: row.text,
    });
  }
  return {
    source: typeof body.source === "string" && body.source ? body.source : null,
    truncated: body.truncated === true,
    lines,
  };
}

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
function readEndpointOriginNote(what) {
  return what + " are refused by the server (ORIGIN_REJECTED): these reads are served only over a "
    + "loopback address, and this page reached the server under another hostname. Open the board at "
    + "127.0.0.1 or localhost.";
}

/* Degrade honestly. This client ships ahead of the route, so the common failure
   is a 404 with no JSON envelope — which means "this build cannot show you a
   transcript", NOT "this agent has no transcript". Saying the second would be a
   lie the operator would act on. */
function transcriptFailureText(status, body) {
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

function transcriptWindow(lines, cap = TRANSCRIPT_RENDER_CAP) {
  const total = lines.length;
  if (total <= cap) return { shown: lines, hidden: 0, total };
  return { shown: lines.slice(total - cap), hidden: total - cap, total };
}

async function loadTranscript(agentId, limit = TRANSCRIPT_DEFAULT_LIMIT) {
  const want = clampTranscriptLimit(limit);
  state.transcript = { agentId, loading: true, error: "", data: null, limit: want };
  render();
  let next;
  try {
    const res = await apiFetch(transcriptUrl(agentId, want), { headers: { accept: "application/json" } }, API_TRANSCRIPT_TIMEOUT_MS);
    let body = null;
    try { body = await res.json(); } catch { /* a build without the route answers HTML */ }
    next = !res.ok || !body || body.ok !== true
      ? { agentId, loading: false, error: transcriptFailureText(res.status, body), data: null, limit: want }
      : { agentId, loading: false, error: "", data: normalizeTranscript(body), limit: want };
  } catch {
    next = { agentId, loading: false, error: transcriptFailureText(0, null), data: null, limit: want };
  }
  // The operator moved on — never paint one agent's transcript into another's drawer.
  if (state.transcript.agentId !== agentId) return;
  state.transcript = next;
  render();
}

function transcriptLineNode(line) {
  return el("div", { class: "tr-line", dataset: { role: line.role } },
    el("div", { class: "tr-meta" },
      el("span", { class: "tr-role", text: TRANSCRIPT_ROLE_LABELS[line.role] || line.role }),
      line.at ? el("span", { class: "tr-at", title: line.at, text: agoText(line.at) }) : null),
    // UNTRUSTED. textContent via el({ text }) — never innerHTML.
    el("p", { class: "tr-text", tabindex: "0", text: line.text }));
}

function renderTranscriptPanel(agent, ui = state) {
  const view = (ui && ui.transcript) || {};
  const mine = view.agentId === agent.id;
  const section = el("section", { class: "transcript-view" },
    el("h3", { class: "section-title", text: "Transcript" }));

  if (!mine) {
    section.append(el("button", {
      type: "button", class: "btn sm transcript-load",
      dataset: { fkey: "transcript-load:" + agent.id },
      onclick: () => void loadTranscript(agent.id),
    }, "Read the transcript"));
    return section;
  }

  if (view.loading) {
    // Bounded by construction: loadTranscript always resolves into data or an
    // error, so this can never become a spinner that never resolves.
    section.append(el("p", { class: "inspector-note", role: "status", text: "Reading the transcript…" }));
    return section;
  }

  if (view.error) {
    section.append(
      el("p", { class: "inspector-note err", role: "status", text: view.error }),
      el("button", {
        type: "button", class: "btn sm transcript-load",
        dataset: { fkey: "transcript-retry:" + agent.id },
        onclick: () => void loadTranscript(agent.id, view.limit),
      }, "Try again"));
    return section;
  }

  const data = view.data || { lines: [], source: null, truncated: false };
  const head = el("div", { class: "transcript-head" });
  if (!data.lines.length) {
    head.append(el("span", {
      class: "transcript-source",
      text: data.source
        ? "The transcript file is present but has no readable turns."
        : "No transcript file is recorded for this session.",
    }));
  } else {
    const win = transcriptWindow(data.lines);
    head.append(el("span", {
      class: "transcript-source",
      text: win.hidden
        ? "Last " + win.shown.length + " of " + win.total + " loaded turns"
        : win.total + (win.total === 1 ? " turn" : " turns"),
    }));
    if (data.truncated) head.append(el("span", { class: "transcript-more", text: "· older turns exist above this window" }));
  }
  if (data.source) head.append(el("code", { class: "transcript-source-path", text: data.source }));
  head.append(el("button", {
    type: "button", class: "btn sm transcript-load",
    dataset: { fkey: "transcript-refresh:" + agent.id },
    onclick: () => void loadTranscript(agent.id, view.limit),
  }, "Refresh"));
  const more = nextTranscriptLimit(view.limit);
  if (more && data.truncated) {
    head.append(el("button", {
      type: "button", class: "btn sm transcript-load",
      dataset: { fkey: "transcript-more:" + agent.id },
      onclick: () => void loadTranscript(agent.id, more),
    }, "Load " + more));
  }
  section.append(head);

  if (data.lines.length) {
    const log = el("div", { class: "transcript-log", tabindex: "0", "aria-label": "Transcript turns" });
    for (const line of transcriptWindow(data.lines).shown) log.append(transcriptLineNode(line));
    section.append(log);
  }
  return section;
}

function renderEvidence(agent, ui = state) {
  const panel = el("div", { class: "inspector-panel", role: "tabpanel" });
  const grid = el("dl", { class: "detail-grid" });

  dtdd(grid, "session cwd", agent.cwd, { code: true });
  const sessionCwd = (agent.cwd || "").replace(/\/+$/, "");
  const surfaceCwd = agent.target && agent.target.surfaceCwd
    ? String(agent.target.surfaceCwd).replace(/\/+$/, "")
    : "";
  if (surfaceCwd && surfaceCwd !== sessionCwd) {
    dtdd(grid, "terminal folder", agent.target.surfaceCwd, {
      code: true,
      hint: CWD_MISMATCH_HINT,
    });
  }

  dtdd(grid, "git", agent.git && (agent.git.branch || agent.git.head)
    ? el("span", {},
        el("code", { text: agent.git.branch || "(detached)" }),
        agent.git.dirty ? el("span", { class: "git-dirty", text: " · uncommitted changes" }) : null,
        agent.git.head ? el("code", { text: " @ " + agent.git.head.slice(0, 9) }) : null)
    : null);

  const t = agent.tokens || {};
  if (t.scope === "latest-turn" && (t.total != null || t.input != null || t.output != null)) {
    const parts = [];
    if (t.input != null) parts.push("in " + fmtTok(t.input));
    if (t.output != null) parts.push("out " + fmtTok(t.output));
    if (t.cachedInput != null) parts.push("cached " + fmtTok(t.cachedInput));
    if (t.total != null) parts.push("total " + fmtTok(t.total));
    dtdd(grid, "latest call", el("span", {
      class: "mono",
      text: parts.join(" · ") + (t.provenance ? " · " + provenanceLabel(t.provenance) : ""),
    }), { hint: LATEST_CALL_HINT });
  }
  if (t.sessionTotal != null) {
    dtdd(grid, "session total", el("span", {
      class: "mono",
      text: fmtTok(t.sessionTotal) + " tokens · cumulative this session",
    }), { hint: SESSION_TOTAL_HINT });
  }

  const link = renderControlLink(agent.target);
  if (link) dtdd(grid, "control link", link);

  if (grid.childNodes.length) panel.append(grid);

  const identity = renderIdentityBlock(agent);
  if (identity) panel.append(identity);

  const names = renderNamesDisclosure(agent);
  if (names) panel.append(names);

  if (agent.artifacts && agent.artifacts.length) {
    panel.append(
      el("h3", { class: "section-title", text: "Artifacts" }),
      el("ul", { class: "artifact-list" },
        agent.artifacts.map((a) => el("li", {},
          el("span", { class: "artifact-kind", text: a.kind || "file" }),
          el("span", { text: a.label }),
          el("span", { class: "artifact-path", text: a.path }),
          el("button", {
            type: "button", class: "btn sm",
            dataset: { fkey: `copy:${agent.id}:${a.path}` },
            onclick: () => copyText(a.path),
          }, "Copy path")))));
  }

  if (agent.transcriptTail) {
    panel.append(
      el("h3", { class: "section-title", text: "Transcript tail" }),
      el("pre", { class: "transcript", tabindex: "0", text: agent.transcriptTail }));
  }

  // The 800-char tail above is whatever the snapshot happened to carry; this is
  // the part an operator can actually read a decision out of.
  panel.append(renderTranscriptPanel(agent, ui));

  if (!panel.childNodes.length) {
    panel.append(el("p", { class: "inspector-note", text: "No evidence fields reported for this session." }));
  }
  return panel;
}

/* Danger zone removed — Interrupt/Archive live in the command dock. */

/* ---------- control requests ---------- */

async function sendControl(agent, action, instruction) {
  const key = agent.id + ":" + action;
  if (state.pending.has(key)) return;
  state.pending.add(key);
  state.feedback.delete(agent.id);
  render();

  let result;
  try {
    const res = await apiFetch("/api/control", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, agentId: agent.id, instruction }),
    }, API_WRITE_TIMEOUT_MS);
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON body */ }

    if (body && typeof body.ok === "boolean") {
      if (body.ok) {
        result = { ok: true, message: ACTION_LABELS[action] + " succeeded (" + agentName(agent) + ")" };
        if (action === "instruct") state.drafts.delete(agent.id);
      } else {
        const err = body.error || {};
        let msg = ACTION_LABELS[action] + " failed";
        if (err.code) msg += " [" + err.code + "]";
        if (err.message) msg += ": " + err.message;
        if (err.exitCode != null) msg += " (exit " + err.exitCode + ")";
        if (err.stderr) msg += "\n" + err.stderr.trim();
        result = { ok: false, message: msg };
      }
    } else {
      // HTTP completion alone is never success.
      result = {
        ok: false,
        message: ACTION_LABELS[action] + " failed: server returned an unexpected response (HTTP " + res.status + ")",
      };
    }
  } catch (err) {
    result = { ok: false, message: ACTION_LABELS[action] + " failed: " + (err && err.message ? err.message : "network error") };
  }

  state.pending.delete(key);
  state.feedback.set(agent.id, { ...result, action });
  render();
  toast(result.message.split("\n")[0], result.ok ? "ok" : "err");
  refreshActions(); // the server just journalled this attempt — success or not
}

/* ---------- presentation labels (source identities stay authoritative) ---------- */

async function fetchLabels() {
  state.labelsLoading = true;
  state.labelLoadError = "";
  try {
    const res = await apiFetch("/api/program-aliases", { headers: { accept: "application/json" } }, API_READ_TIMEOUT_MS);
    const body = await res.json();
    if (!res.ok || !body || body.ok !== true || typeof body.labels !== "object") throw new Error("bad label response");
    state.labels = new Map(Object.entries(body.labels));
    state.aliases = state.labels;
    state.labelsLoaded = true;
    render();
  } catch (err) {
    state.labelLoadError = err && err.message ? err.message : "Label loading failed";
    console.warn("label fetch failed:", err);
  } finally {
    state.labelsLoading = false;
  }
}

function startRename(target, opts = {}) {
  const key = presentationLabelKey(target);
  state.renaming = key;
  // Prefer a saved alias; otherwise seed from the live display name (often the
  // cmux terminal title) so edits feel like renaming what you already see.
  state.renameDraft = state.aliases.get(key) || (typeof opts.draft === "string" ? opts.draft : "") || "";
  state.renameError = "";
  render();
  const inputKey = target.kind === "program" ? "rename-input:" + target.programId : "label-input:" + key;
  const input = document.querySelector(`[data-fkey="${CSS.escape(inputKey)}"]`);
  if (input) { input.focus(); input.select(); }
}

function cancelRename() {
  state.renaming = null;
  state.renameError = "";
  render();
}

async function submitRename(target) {
  if (state.renamePending) return;
  const label = state.renameDraft.trim();
  if (label.length > 80) { state.renameError = "Keep the label under 80 characters."; render(); return; }
  state.renamePending = true;
  state.renameError = "";
  render();
  try {
    const res = await apiFetch("/api/program-aliases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, label }),
    }, API_WRITE_TIMEOUT_MS);
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.ok !== true) {
      throw new Error(body && body.error && body.error.message ? body.error.message : "Save failed (HTTP " + res.status + ")");
    }
    if (label) state.aliases.set(presentationLabelKey(target), label); else state.aliases.delete(presentationLabelKey(target));
    state.renaming = null;
    const labelName = target.kind === "program" ? "Program" : target.kind[0].toUpperCase() + target.kind.slice(1);
    toast(label ? labelName + " label saved as " + label : labelName + " label reset", "ok");
  } catch (err) {
    state.renameError = err && err.message ? err.message : "Save failed";
  } finally {
    state.renamePending = false;
    render();
  }
}

/* ---------- selection + broadcast ---------- */

/* Only live, instruct-capable, linked recipients can be sent to; everyone else
   is shown as unavailable and never counted as sent. */
function broadcastEligible(agent) {
  const cap = (agent.controls || []).find((c) => c.action === "instruct");
  return deriveActivity(agent) !== "ended" && !!cap && cap.enabled === true;
}

/* Why an ineligible recipient can't receive a broadcast, in one operator word —
   read from the SAME state broadcastEligible checks so the chip label and the
   eligibility gate never disagree. Ended sessions split archived vs ended;
   live-but-locked sessions read their control state (quarantined vs view only). */
function broadcastIneligibleReason(agent) {
  if (deriveActivity(agent) === "ended") {
    return (agent.status === "archived" || agent.activity === "archived") ? "archived" : "ended";
  }
  return deriveControlState(agent) === "quarantined" ? "quarantined" : "view only";
}

function toggleSelect(agentId) {
  if (state.selection.has(agentId)) state.selection.delete(agentId);
  else state.selection.add(agentId);
  state.broadcastResults = null;
  render();
}

function selectProgramEligible(program) {
  for (const a of program.agents) if (broadcastEligible(a)) state.selection.add(a.id);
  state.broadcastResults = null;
  render();
}

function clearSelection() {
  state.selection.clear();
  state.broadcastResults = null;
  state.broadcastConfirming = false;
  state.broadcastError = "";
  render();
}

function enterSelectMode(on) {
  state.selecting = on;
  if (!on) clearSelection();
  else render();
}

function selectedRecipients() {
  const byId = new Map(snapshotAgents(state.snap).map(({ agent, program }) => [agent.id, { agent, program }]));
  return [...state.selection].map((id) => byId.get(id)).filter(Boolean);
}

async function sendBroadcast() {
  if (state.broadcastPending) return;
  const recipients = selectedRecipients();
  const eligible = recipients.filter(({ agent }) => broadcastEligible(agent));
  const instruction = state.broadcastDraft.trim();
  if (!eligible.length || !instruction) return;
  state.broadcastPending = true;
  state.broadcastError = "";
  render();
  try {
    const res = await apiFetch("/api/broadcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentIds: eligible.map(({ agent }) => agent.id), instruction }),
    }, API_WRITE_TIMEOUT_MS);
    const body = await res.json().catch(() => null);
    if (!body || !Array.isArray(body.results)) {
      throw new Error(body && body.error && body.error.message ? body.error.message : "Broadcast failed (HTTP " + res.status + ")");
    }
    state.broadcastResults = new Map(body.results.map((r) => [r.agentId, r]));
    state.broadcastConfirming = false;
    const sent = body.sent || 0;
    const failed = body.failed || 0;
    toast(
      failed ? `Sent to ${sent}, ${failed} could not receive it` : `Instruction broadcast to ${sent} ${sent === 1 ? "agent" : "agents"}`,
      failed ? "err" : "ok",
    );
    if (sent && !failed) state.broadcastDraft = "";
  } catch (err) {
    state.broadcastError = err && err.message ? err.message : "Broadcast failed";
    state.broadcastConfirming = false;
  } finally {
    state.broadcastPending = false;
    render();
    refreshActions(); // per-recipient outcomes now survive a reload
  }
}

/* ---------- out-of-page notification ----------

   With ~200 sessions the operator is working in other windows. An agent that
   starts waiting produced no signal outside the tab, so "needs you" agents sat
   idle until someone happened to look — the unread-cmux signal the product
   already collects was never escalated past the in-page beacon.

   Two escalations, deliberately asymmetric in cost:
     - the tab title, which needs no permission and cannot annoy anyone;
     - a Notification, opt-in behind an explicit click, silent when denied.

   The firing rule is the whole feature. A notifier that cries wolf gets muted
   and then the feature is worthless, so this fires ONLY for an agent that has
   newly entered the needs-a-human set. Not on count changes, not on an agent
   leaving, not on the first paint (opening the page to six waiting agents is
   not six pieces of news), and never on routine churn. */

const NOTIFY_STORAGE_KEY = "mtn3-notify";
const NOTIFY_NAME_LIMIT = 3;
const NOTIFY_TAG = "anthill-needs-you";  // replaces its predecessor; never stacks

/* Who actually needs a human — the same verdict the Alerts view and the beacon
   read, so the notification can never disagree with the board it came from. */
function needsHumanIds(snap) {
  const ids = [];
  // alerting() is that verdict — sharing it is what stops the notifier from
  // announcing a different set of agents than the Alerts view shows.
  for (const { agent } of snapshotAgents(snap)) if (alerting(agent)) ids.push(agent.id);
  return ids.sort();
}

/* Pure. `prev === null` means "we have not looked yet": seed the baseline and
   stay silent, which is what stops a reload from announcing the whole backlog. */
function notificationPlan(prev, next, nameFor = null) {
  const ids = next.slice().sort();
  if (prev === null || prev === undefined) return { fire: false, ids, reason: "seeded" };
  const before = new Set(prev);
  const fresh = ids.filter((id) => !before.has(id));
  if (!fresh.length) return { fire: false, ids, reason: "no new agent needs you" };
  const names = fresh.slice(0, NOTIFY_NAME_LIMIT).map((id) => (nameFor && nameFor(id)) || id);
  const rest = fresh.length - names.length;
  return {
    fire: true,
    ids,
    reason: "new",
    title: fresh.length === 1 ? "1 agent needs you" : fresh.length + " agents need you",
    body: names.join(", ") + (rest > 0 ? " and " + rest + " more" : ""),
  };
}

/* The zero-permission escalation: a background tab shows its own alert count. */
function titleWithAlerts(base, count) {
  const clean = String(base).replace(/^\(\d+\)\s*/, "");
  return count > 0 ? "(" + count + ") " + clean : clean;
}

function notificationsSupported() {
  return typeof Notification !== "undefined";
}

function loadNotifyPreference() {
  try {
    state.notify.enabled = localStorage.getItem(NOTIFY_STORAGE_KEY) === "on";
  } catch { state.notify.enabled = false; }
  if (notificationsSupported()) state.notify.permission = Notification.permission;
  // Permission revoked in browser settings between sessions: the stored
  // preference is stale, so do not carry a promise we cannot keep.
  if (state.notify.enabled && state.notify.permission !== "granted") state.notify.enabled = false;
}

function saveNotifyPreference() {
  try { localStorage.setItem(NOTIFY_STORAGE_KEY, state.notify.enabled ? "on" : "off"); }
  catch { /* storage unavailable */ }
}

/* The ONLY place permission is requested, and it is reachable only from a click.
   Never on load: an unprompted permission dialog is how a page gets denied
   permanently, which would silently disable the feature forever. */
async function toggleNotifications() {
  if (state.notify.enabled) {
    state.notify.enabled = false;
    saveNotifyPreference();
    renderNotifyToggle();
    return;
  }
  if (!notificationsSupported()) { renderNotifyToggle(); return; }
  let permission = Notification.permission;
  if (permission === "default") {
    try { permission = await Notification.requestPermission(); }
    catch { permission = "denied"; }
  }
  state.notify.permission = permission;
  state.notify.enabled = permission === "granted";
  saveNotifyPreference();
  renderNotifyToggle();
}

/* Denied is not an error state to shout about — the operator said no. The
   control just reads "unavailable" and nothing else changes. */
/* `count` is how many agents are waiting on a human right now, and it rides on
   EVERY branch — muted, blocked and unsupported included. "Alerts off" sitting
   silently beside four waiting agents was the whole defect: the button reported
   the delivery channel and never the backlog. Turning notifications off is a
   choice about interruption, not a reason to stop showing the number. */
function notifyToggleView(notify, supported = notificationsSupported(), count = 0) {
  const n = Number.isFinite(count) && count > 0 ? count : 0;
  const suffix = n ? ` · ${n} waiting on you` : "";
  const view = !supported
    ? { label: "Alerts unsupported", pressed: false, disabled: true, title: "This browser has no Notification API." }
    : notify.permission === "denied"
      ? { label: "Alerts blocked", pressed: false, disabled: true, title: "Notifications are blocked for this site in your browser settings." }
      : notify.enabled
        ? { label: "Alerts on", pressed: true, disabled: false, title: "Stop notifying me when an agent starts waiting." }
        : { label: "Alerts off", pressed: false, disabled: false, title: "Notify me when an agent starts waiting, even in another window." };
  return {
    ...view,
    count: n,
    title: view.title + suffix,
    // The button's accessible name carries the backlog too — a screen reader
    // must not have to infer it from a bare digit beside the label.
    ariaLabel: view.label + (n ? `, ${n} agent${n === 1 ? "" : "s"} waiting on you` : ""),
  };
}

function renderNotifyToggle() {
  const btn = $("notify-toggle");
  if (!btn) return;
  const view = notifyToggleView(state.notify, notificationsSupported(), needsHumanIds(state.snap).length);
  btn.textContent = view.label;
  // The count is its own node rather than text appended to the label, so it can
  // take the ember treatment the tab counts already use and stays out of the
  // button's text content.
  if (view.count) btn.append(el("span", { class: "notify-badge", "aria-hidden": "true", text: String(view.count) }));
  btn.setAttribute("aria-pressed", view.pressed ? "true" : "false");
  btn.setAttribute("title", view.title);
  btn.setAttribute("aria-label", view.ariaLabel);
  if (view.disabled) btn.setAttribute("disabled", "");
  else btn.removeAttribute("disabled");
  btn.classList.toggle("is-on", view.pressed);
  btn.classList.toggle("is-alerting", view.count > 0);
}

/* Delivery, kept separate from the decision so every gate is assertable without
   a browser. Each refusal returns its own reason rather than a shared silence,
   because "we chose not to" and "the browser refused" are different facts. */
function deliverNotification(plan, notify, ctor) {
  if (!plan.fire) return plan.reason;
  if (!notify.enabled) return "muted";
  if (!ctor) return "unsupported";
  if (notify.permission !== "granted") return "not-granted";
  try {
    // eslint-disable-next-line no-new
    new ctor(plan.title, { body: plan.body, tag: NOTIFY_TAG });
    return "sent";
  } catch { return "refused"; }
}

/* Called on every adopted snapshot. The title always updates — it costs no
   permission and cannot annoy anyone. The Notification only fires when the plan
   says a NEW agent needs a human AND the operator opted in; denied, unsupported
   or muted all degrade to the title alone, silently. */
function applyNotifications(snap = state.snap) {
  const next = needsHumanIds(snap);
  const byId = agentsById(snap);
  const plan = notificationPlan(state.notify.seen, next, (id) => {
    const found = byId.get(id);
    return found ? agentName(found.agent) : null;
  });
  state.notify.seen = plan.ids;
  if (typeof document !== "undefined") {
    document.title = titleWithAlerts(state.notify.baseTitle || document.title, next.length);
  }
  return deliverNotification(plan, state.notify, notificationsSupported() ? Notification : null);
}

/* ---------- action log ----------

   What was broadcast, to whom, and whether it landed lived only in client
   memory (state.broadcastResults) and died on reload. A broadcast reaches up to
   50 agents and instruct is fire-and-forget text typed into a terminal, so after
   a refresh the operator could not tell which lanes received an instruction,
   which came back TEXT_STAGED_NOT_SUBMITTED, or whether they had already sent
   it — and the natural recovery is to send it again, double-instructing lanes
   that already got it.

   Contract (GET /api/actions?limit=<n>, built in a parallel lane):
     { ok, actions: [{ id, at, kind, agentIds, outcome, detail }] }   // newest first
   This is an OPERATOR log, not a transcript: it never carries agent output. */

const ACTIONS_DEFAULT_LIMIT = 100;
const ACTIONS_MAX_LIMIT = 500;             // the contract's hard cap
const ACTIONS_RENDER_CAP = 100;
const ACTION_KINDS = new Set(["focus", "instruct", "interrupt", "broadcast", "archive"]);
const ACTION_KIND_LABELS = {
  focus: "Focus", instruct: "Send", interrupt: "Interrupt",
  broadcast: "Broadcast", archive: "Archive",
};
/* A log that shows only successes is worse than no log: it reads as proof the
   instruction landed. Every outcome the contract can return gets its own word. */
const ACTION_OUTCOME_VIEW = {
  ok: { label: "Delivered", tone: "ok" },
  failed: { label: "Failed", tone: "err" },
  partial: { label: "Partly delivered", tone: "warn" },
  staged: { label: "Staged — not submitted", tone: "warn" },
};

function actionOutcomeView(outcome) {
  // An outcome the server adds later reads as the server's own word rather than
  // as a confident wrong label — the same rule investigationView follows.
  return ACTION_OUTCOME_VIEW[outcome] || { label: String(outcome || "unknown"), tone: "warn" };
}

function clampActionsLimit(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return ACTIONS_DEFAULT_LIMIT;
  return Math.min(ACTIONS_MAX_LIMIT, Math.max(1, v));
}

function actionsUrl(limit = ACTIONS_DEFAULT_LIMIT) {
  return "/api/actions?limit=" + clampActionsLimit(limit);
}

function normalizeActions(body) {
  const rows = Array.isArray(body && body.actions) ? body.actions : [];
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (typeof row.id !== "string" || !row.id) continue;
    if (!ACTION_KINDS.has(row.kind)) continue;
    out.push({
      id: row.id,
      at: typeof row.at === "string" && !Number.isNaN(Date.parse(row.at)) ? row.at : null,
      kind: row.kind,
      agentIds: Array.isArray(row.agentIds) ? row.agentIds.filter((id) => typeof id === "string" && id) : [],
      outcome: typeof row.outcome === "string" && row.outcome ? row.outcome : "unknown",
      detail: typeof row.detail === "string" ? row.detail : "",
    });
  }
  return out;
}

/* "Did I already tell these lanes to rebase?" — answered per agent, in the one
   place where sending again is a click away. Newest-first is the contract, so
   the first match is the most recent; sorting here would fight it. */
function lastActionFor(actions, agentId) {
  return (actions || []).find((a) => a.agentIds.includes(agentId)) || null;
}

/* Who it went to, without a wall of session ids. `nameFor` resolves what the
   snapshot still knows; an agent that has since disappeared keeps its raw id
   rather than being silently dropped from the record. */
function actionRecipients(action, nameFor) {
  const ids = action.agentIds || [];
  if (!ids.length) return "no recipients";
  if (ids.length > 3) return ids.length + " sessions";
  return ids.map((id) => (nameFor && nameFor(id)) || id).join(", ");
}

async function loadActions(limit = ACTIONS_DEFAULT_LIMIT) {
  state.actions = { ...state.actions, loading: true, error: "" };
  render();
  let next;
  try {
    const res = await apiFetch(actionsUrl(limit), { headers: { accept: "application/json" } }, API_READ_TIMEOUT_MS);
    let body = null;
    try { body = await res.json(); } catch { /* a build without the route answers HTML */ }
    next = !res.ok || !body || body.ok !== true
      ? { loading: false, error: actionsFailureText(res.status, body), available: !(res.status === 404 && !(body && body.error)), items: [], fetchedAt: 0 }
      : { loading: false, error: "", available: true, items: normalizeActions(body), fetchedAt: Date.now() };
  } catch {
    next = { loading: false, error: actionsFailureText(0, null), available: true, items: [], fetchedAt: 0 };
  }
  state.actions = next;
  render();
}

function actionsFailureText(status, body) {
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
function refreshActions() {
  if (state.actions.available && state.actions.fetchedAt) void loadActions();
}

function actionRowNode(action, nameFor) {
  const outcome = actionOutcomeView(action.outcome);
  return el("div", { class: "action-row", dataset: { tone: outcome.tone } },
    el("span", { class: "action-when", title: action.at || null, text: action.at ? agoText(action.at) : "time unknown" }),
    el("span", { class: "action-kind", text: ACTION_KIND_LABELS[action.kind] || action.kind }),
    el("span", { class: "action-who", text: actionRecipients(action, nameFor) }),
    el("span", { class: "action-outcome", text: outcome.label }),
    action.detail ? el("span", { class: "action-detail", text: action.detail }) : null);
}

function renderActionLog(ui = state, nameFor = null) {
  const log = ui.actions || {};
  const panel = el("div", { class: "action-log" },
    el("div", { class: "action-log-head" },
      el("h2", { class: "action-log-title", text: "Recent operator actions" }),
      el("button", {
        type: "button", class: "btn sm",
        disabled: log.loading ? "" : null,
        dataset: { fkey: "actions-refresh" },
        onclick: () => void loadActions(),
      }, log.loading ? "Loading…" : "Refresh")));

  if (log.error) {
    panel.append(el("p", { class: "action-log-note err", role: "status", text: log.error }));
    return panel;
  }
  if (log.loading && !log.items.length) {
    panel.append(el("p", { class: "action-log-note", role: "status", text: "Reading the action log…" }));
    return panel;
  }
  if (!log.items.length) {
    panel.append(el("p", {
      class: "action-log-note",
      text: "No operator actions recorded yet. Focus, Send, Interrupt, Archive and Broadcast are journalled here as they happen — including the ones that fail.",
    }));
    return panel;
  }

  const rows = log.items.slice(0, ACTIONS_RENDER_CAP);
  const list = el("div", { class: "action-rows" });
  for (const action of rows) list.append(actionRowNode(action, nameFor));
  panel.append(list);
  if (log.items.length > rows.length) {
    panel.append(el("p", { class: "action-log-note", text: "Showing the most recent " + rows.length + " of " + log.items.length + " recorded actions." }));
  }
  return panel;
}

function renderActionsPanel() {
  const panel = $("actions-panel");
  const toggle = $("actions-toggle");
  if (!panel) return;
  const open = state.actionsOpen && state.view !== "usage";
  if (toggle) {
    toggle.setAttribute("aria-pressed", open ? "true" : "false");
    toggle.classList.toggle("is-open", open);
  }
  const log = state.actions;
  // Same rule as the alarm: visibility every paint, rebuild only on change.
  panel.hidden = !open;
  const sig = [open ? "1" : "0", log.loading ? "1" : "0", log.error, String(log.fetchedAt),
    log.items.map((a) => a.id + ":" + a.outcome).join(",")].join("|");
  if (state.paintSig.actions === sig) return;
  state.paintSig.actions = sig;
  panel.textContent = "";
  if (!open) return;
  const byId = agentsById(state.snap);
  panel.append(renderActionLog(state, (id) => {
    const found = byId.get(id);
    return found ? agentName(found.agent) : null;
  }));
}

/* ---------- misc UI ---------- */

let toastTimer = null;
function toast(message, kind) {
  const node = $("toast");
  node.textContent = message;
  node.className = "toast show" + (kind ? " " + kind : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.className = "toast"; }, 3500);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied: " + text, "ok");
  } catch {
    toast("Copy failed — clipboard unavailable", "err");
  }
}

/* Everything the dock paints, deliberately minus broadcastDraft: the composer is
   a live input and tearing it down mid-sentence is the bug this guard exists to
   stop. The one place that clears the draft externally (sendBroadcast success)
   also writes broadcastResults and flips broadcastPending, so an external reset
   can never be missed by leaving the draft out. */
function broadcastPaintSig(recipients, eligible, ui) {
  return [
    recipients.map(({ agent }) => agent.id + "=" + (broadcastEligible(agent) ? "1" : "0") + ":" + agentName(agent)).join(","),
    String(eligible.length),
    // A board that goes stale mid-compose must repaint the dock so Send stops
    // offering to fan a message out over four-day-old routing.
    feedFrozen(ui) ? "held" : "",
    ui.broadcastResults
      ? [...ui.broadcastResults].map(([id, r]) => id + "=" + (r && r.ok ? "ok" : (r && r.error && r.error.code) || "err")).join(",")
      : "",
    ui.broadcastConfirming ? "1" : "0",
    ui.broadcastPending ? "1" : "0",
    ui.broadcastError || "",
  ].join("\u001f");
}

/* Broadcast dock — appears only in selection mode. Recipients are previewed
   honestly: eligible (live + instruct-capable) vs unavailable, and per-recipient
   results after send are never smoothed over. */
function renderBroadcastBar() {
  const bar = $("broadcast-bar");
  if (!state.selecting) {
    state.paintSig.broadcast = "closed";
    bar.textContent = "";
    bar.hidden = true;
    return;
  }
  bar.hidden = false;

  const recipients = selectedRecipients();
  const eligible = recipients.filter(({ agent }) => broadcastEligible(agent));
  const results = state.broadcastResults;
  const alarm = feedAlarm(state.conn, state.snap && state.snap.generatedAt);
  if (paintUnchanged("broadcast", broadcastPaintSig(recipients, eligible, state))) return;
  bar.textContent = "";
  if (alarm) bar.append(el("p", { class: "broadcast-note is-held", role: "status", text: staleControlNote(alarm) }));

  bar.append(el("div", { class: "broadcast-head" },
    icon("broadcast", { label: "Broadcast" }),
    el("span", { class: "broadcast-title", text: "Broadcast instruction" }),
    el("span", { class: "broadcast-count" },
      el("strong", { text: String(eligible.length) }), ` of ${recipients.length} selected can receive it`),
    recipients.length
      ? el("button", { type: "button", class: "broadcast-clear", dataset: { fkey: "broadcast-clear" }, onclick: clearSelection }, "Clear all")
      : null));

  if (recipients.length) {
    const list = el("div", { class: "broadcast-recipients" });
    for (const { agent, program } of recipients) {
      const ok = broadcastEligible(agent);
      const result = results && results.get(agent.id);
      list.append(el("span", { class: "recipient-chip " + (ok ? "is-eligible" : "is-ineligible"), title: programName(program) },
        el("span", { text: agentName(agent) }),
        result
          ? el("span", { class: "recipient-result " + (result.ok ? "ok" : "err"), text: result.ok ? "sent" : (result.error && result.error.code === "AGENT_NOT_FOUND" ? "gone" : "failed") })
          : el("span", { class: "rc-state", text: ok ? "ready" : broadcastIneligibleReason(agent) })));
    }
    bar.append(list);
  } else {
    bar.append(el("p", { class: "broadcast-note", text: "Pick agents from the list, or use “Select eligible” on a program header. Only live, instruct-capable sessions can receive a broadcast." }));
  }

  const instruction = state.broadcastDraft;
  if (state.broadcastConfirming) {
    bar.append(el("div", { class: "broadcast-confirm", role: "group", "aria-label": "Confirm broadcast" },
      el("span", { text: `Send this instruction to ${eligible.length} ${eligible.length === 1 ? "agent" : "agents"}?` }),
      el("button", { type: "button", class: "btn primary", disabled: state.broadcastPending || alarm ? "" : null, "aria-busy": state.broadcastPending ? "true" : null, dataset: { fkey: "broadcast-confirm" }, onclick: () => { if (!alarm) sendBroadcast(); } }, state.broadcastPending ? "Sending…" : `Confirm broadcast`),
      el("button", { type: "button", class: "btn", disabled: state.broadcastPending ? "" : null, dataset: { fkey: "broadcast-cancel" }, onclick: () => { state.broadcastConfirming = false; render(); } }, "Cancel")));
  } else {
    const canSend = !alarm && eligible.length > 0 && instruction.trim().length > 0;
    bar.append(el("div", { class: "broadcast-compose" },
      el("textarea", {
        placeholder: eligible.length ? "Instruction sent to every eligible recipient…" : "Select at least one eligible agent first",
        "aria-label": "Broadcast instruction",
        value: instruction,
        dataset: { fkey: "broadcast-draft" },
        oninput: (e) => { state.broadcastDraft = e.target.value; const btn = document.querySelector('[data-fkey="broadcast-send"]'); if (btn) btn.disabled = !(eligible.length && e.target.value.trim()); },
      }),
      el("button", {
        type: "button", class: "btn primary broadcast-send",
        disabled: canSend ? null : "",
        dataset: { fkey: "broadcast-send" },
        onclick: () => { if (eligible.length && state.broadcastDraft.trim()) { state.broadcastConfirming = true; render(); } },
      }, "Send to " + eligible.length)));
  }
  if (state.broadcastError) bar.append(el("p", { class: "broadcast-note err", role: "alert", text: state.broadcastError }));
}

/* The one screen a broken instance shows must name the address it was actually
   served from: MOUNTAIN_PORT, anthill-start.sh and anthill-preview.sh all bind
   different ports, and a preview on :4715 telling the operator to go check
   :4701 sends them to a healthy production process. "v3 server" was internal
   versioning that means nothing to the reader. host is a parameter so the rule
   is testable without a browser. */
function serverUnreachableHint(host) {
  const where = host ? "on " + host : "at this address";
  return "Check that the Ant Hill server is running " + where + ", then retry.";
}

/* The board is blank until the first snapshot resolves: the client is a deferred
   module and boot() paints nothing before fetchSnapshot() returns. index.html
   therefore ships the skeleton VISIBLE, so the shape of the board is on screen
   before app.js has even parsed; this is only what takes it back down.

   fetchFailed is the whole distinction. Without it an unreachable server would
   sit under a shimmering placeholder indefinitely, which reads as "still
   loading" rather than "this is broken" — #empty-state owns that message and
   its retry button. */
function firstLoadPending(ui = state) {
  return !ui.snap && !ui.fetchFailed;
}

function renderSkeleton() {
  const skeleton = $("board-skeleton");
  if (!skeleton) return;
  skeleton.hidden = !firstLoadPending();
}

function renderEmpty() {
  const empty = $("empty-state");
  const retry = $("empty-retry");
  /* Nothing has come back yet, so there is no finding to report. Any render()
     triggered before the first response — a view tab, a keystroke in search —
     used to fall through to "Can't reach the Ant Hill server", which is a guess
     dressed as a diagnosis. The skeleton holds the space instead. */
  if (firstLoadPending()) { empty.hidden = true; return; }
  const hasAgents = state.snap && state.snap.programs.some((p) => p.agents.length);
  if (hasAgents) { empty.hidden = true; return; }

  empty.hidden = false;
  if (!state.snap) {
    $("empty-message").textContent = "Can't reach the Ant Hill server.";
    $("empty-hint").textContent = serverUnreachableHint(typeof location === "undefined" ? "" : location.host);
    retry.hidden = false;
  } else {
    $("empty-message").textContent = "The ant hill is still — no tracked agents.";
    $("empty-hint").textContent = "Agents appear here as soon as a collector reports a session.";
    retry.hidden = true;
  }
}

function tickClocks(frozen = feedFrozen(), now = Date.now()) {
  for (const node of document.querySelectorAll("[data-elapsed-base]")) {
    const text = elapsedTickText(node.dataset.elapsedBase, node.dataset.elapsedFrom, now, frozen);
    if (text != null) node.textContent = text;
    node.classList.toggle("is-frozen", frozen);
  }
  // data-ago is NOT frozen: "12m ago" measures the distance from a real past
  // moment to now, and that distance genuinely keeps growing while the feed is
  // stuck. Freezing it would replace one lie with another.
  for (const node of document.querySelectorAll("[data-ago]")) {
    node.textContent = agoText(node.dataset.ago);
  }
}

function setView(view) {
  if (state.view === view || !VIEWS.includes(view)) return;
  state.view = view;
  if (view === "usage") {
    if (state.selecting) enterSelectMode(false);
    void loadUsageData();
  }
  render();
}

function usageRangeHours() {
  if (state.usageRangeId === "custom") return state.usageCustomHours || 24;
  const preset = USAGE_RANGE_PRESETS.find((item) => item.id === state.usageRangeId);
  return preset ? preset.hours : 24;
}

function usageRangeBounds() {
  const to = new Date();
  const from = new Date(to.getTime() - usageRangeHours() * 3_600_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function fmtUsd(value) {
  if (value == null || !Number.isFinite(value)) return "not reported";
  return "$" + value.toFixed(value >= 10 ? 2 : 3);
}

function agentIdForSession(sessionId) {
  if (!sessionId || !state.snap) return null;
  for (const { agent } of snapshotAgents(state.snap)) {
    if (agent.sourceSessionId === sessionId || agent.id.endsWith(":" + sessionId)) return agent.id;
  }
  return null;
}

async function loadUsageData(force = false) {
  if (state.usageLoading) return;
  if (!force && state.usageFetchedAt && Date.now() - state.usageFetchedAt < 15_000 && state.usageSummary) {
    return;
  }
  state.usageLoading = true;
  state.usageError = "";
  renderScopeNote(0);
  const { from, to } = usageRangeBounds();
  const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const bucket = usageRangeHours() > 48 ? "1d" : "1h";
  try {
    const [summaryRes, seriesRes, wardRes, invRes] = await Promise.all([
      apiFetch("/api/usage/summary?" + q, {}, API_READ_TIMEOUT_MS),
      apiFetch("/api/usage/series?" + q + "&bucket=" + bucket, {}, API_READ_TIMEOUT_MS),
      apiFetch("/api/usage/ward?" + q, {}, API_READ_TIMEOUT_MS),
      apiFetch("/api/usage/invocations?" + q + "&limit=40", {}, API_READ_TIMEOUT_MS),
    ]);
    state.usageSummary = await summaryRes.json();
    state.usageSeries = await seriesRes.json();
    state.usageWard = await wardRes.json();
    state.usageInvocations = await invRes.json();
    state.usageFetchedAt = Date.now();
    if (state.usageSummary && state.usageSummary.available === false) {
      state.usageError = state.usageSummary.error || "BurnBar usage unavailable.";
    }
  } catch (error) {
    state.usageError = error instanceof Error ? error.message : String(error);
    state.usageSummary = null;
    state.usageSeries = null;
    state.usageWard = null;
    state.usageInvocations = null;
  } finally {
    state.usageLoading = false;
    if (state.view === "usage") render();
  }
}

/* The one readable fact per bar: which bucket, how many tokens. */
function usageBarTitle(bucket, tokens) {
  return bucket + " · " + fmtTok(tokens) + " tokens";
}

/* Takes the whole series envelope, not just its points, because a failed
   BurnBar query answers with available:false AND points:[]. Drawing that as an
   empty chart tells the operator they spent nothing in this range when the
   truth is the database never answered. Unavailable is not zero. */
function renderUsageSeriesChart(series) {
  const wrap = el("div", { class: "usage-series" });
  if (series && series.available === false) {
    wrap.append(el("p", { class: "usage-empty", text: series.error || "Series data unavailable." }));
    return wrap;
  }
  const points = series && series.points;
  if (!points || !points.length) {
    wrap.append(el("p", { class: "usage-empty", text: "No series points in this range." }));
    return wrap;
  }
  const byBucket = new Map();
  for (const point of points) {
    const key = point.bucketStart;
    byBucket.set(key, (byBucket.get(key) || 0) + (point.tokens || 0));
  }
  const entries = [...byBucket.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-48);
  const max = Math.max(...entries.map((entry) => entry[1]), 1);
  const width = Math.max(entries.length * 10, 120);
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} 64`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "usage-bars-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Tokens over time");
  entries.forEach(([bucket, tokens], index) => {
    const h = Math.max(2, Math.round((tokens / max) * 56));
    const rect = svgChild(["rect", {
      x: index * 10 + 1,
      y: 64 - h,
      width: 8,
      height: h,
      class: "usage-bar-rect",
    }]);
    rect.append(svgTitle(usageBarTitle(bucket, tokens)));
    svg.append(rect);
  });
  wrap.append(svg);
  const providers = [...new Set(points.map((point) => point.provider))].slice(0, 8);
  if (providers.length) {
    wrap.append(el("p", { class: "usage-series-legend", text: "Providers: " + providers.join(" · ") }));
  }
  return wrap;
}

function renderUsagePanel(ui = state) {
  const root = $("usage-panel");
  if (!root) return;
  root.textContent = "";
  if (ui.usageLoading && !ui.usageSummary) {
    root.append(el("p", { class: "usage-empty", text: "Loading BurnBar usage…" }));
    return;
  }
  const summary = ui.usageSummary;
  if (!summary || summary.available === false) {
    root.append(el("div", { class: "usage-unavailable" },
      el("h2", { class: "usage-title", text: "Usage unavailable" }),
      el("p", {
        text: (summary && summary.error) || ui.usageError ||
          "BurnBar database could not be unlocked. Quotas sidecar may still be readable separately.",
      }),
      el("button", {
        type: "button", class: "btn",
        dataset: { fkey: "usage-retry" },
        onclick: () => void loadUsageData(true),
      }, "Retry")));
    // Still show quotas/ward soft data if present without inventing spend zeros.
    if (ui.usageWard && ui.usageWard.quotaPressure && ui.usageWard.quotaPressure.length) {
      root.append(renderUsageWard(ui.usageWard, true));
    }
    return;
  }

  root.append(el("div", { class: "usage-kpis" },
    reading("Processed tokens", el("span", { class: "reading-value", text: fmtTok(summary.processedTokens || 0) }),
      el("span", { class: "reading-sub", text: "BurnBar observed" })),
    reading("Estimated cost", el("span", { class: "reading-value", text: summary.costKnown ? fmtUsd(summary.estimatedCostUsd) : "not reported" }),
      el("span", { class: "reading-sub", text: summary.costKnown ? "from BurnBar cost" : "cost missing on some rows" })),
    reading("Invocations", el("span", { class: "reading-value", text: String(summary.invocations || 0) }),
      el("span", { class: "reading-sub", text: "in selected range" })),
    reading("Burn rate",
      el("span", {
        class: "reading-value",
        text: summary.burnRateTokensPerHour == null ? "—" : fmtTok(Math.round(summary.burnRateTokensPerHour)) + "/h",
      }),
      el("span", { class: "reading-sub", text: "tokens per hour" }))));

  if (summary.byProvider && summary.byProvider.length) {
    const list = el("ul", { class: "usage-providers" });
    for (const row of summary.byProvider.slice(0, 10)) {
      list.append(el("li", {},
        el("strong", { text: row.provider }),
        ` · ${fmtTok(row.tokens)} tokens · ${row.invocations} calls · ${row.costUsd == null ? "cost n/a" : fmtUsd(row.costUsd)}`));
    }
    root.append(el("section", { class: "usage-section" },
      el("h2", { class: "usage-title", text: "By provider" }),
      list));
  }

  root.append(el("section", { class: "usage-section" },
    el("h2", { class: "usage-title", text: "Series" }),
    renderUsageSeriesChart(ui.usageSeries)));

  root.append(renderUsageWard(ui.usageWard, false));

  const table = el("table", { class: "usage-table" });
  table.append(el("thead", {}, el("tr", {},
    el("th", { text: "When" }),
    el("th", { text: "Provider" }),
    el("th", { text: "Model" }),
    el("th", { text: "Tokens" }),
    el("th", { text: "Cost" }),
    el("th", { text: "Session" }))));
  const body = el("tbody");
  const invocations = ui.usageInvocations;
  const rows = (invocations && invocations.invocations) || [];
  // Same rule as the series: a query that failed is not a range that was quiet.
  if (invocations && invocations.available === false) {
    body.append(el("tr", {}, el("td", {
      colspan: "6",
      text: invocations.error || "Invocation data unavailable.",
    })));
  } else if (!rows.length) {
    body.append(el("tr", {}, el("td", { colspan: "6", text: "No invocations in this range." })));
  } else {
    for (const row of rows) {
      const agentId = agentIdForSession(row.sessionId);
      const sessionCell = agentId
        ? el("button", {
          type: "button", class: "linkish",
          dataset: { fkey: "usage-session:" + row.sessionId },
          onclick: () => {
            setView("now");
            selectEntity({ kind: "agent", id: agentId });
          },
        }, row.sessionId.slice(0, 8))
        : el("span", { text: (row.sessionId || "—").slice(0, 8) });
      body.append(el("tr", {},
        el("td", { text: row.startTime ? agoText(row.startTime) : "—" }),
        el("td", { text: row.provider || "—" }),
        el("td", { text: modelShort(row.model) || "—" }),
        el("td", { class: "usage-val", text: row.tokens == null ? "—" : fmtTok(row.tokens) }),
        el("td", { class: "usage-val", text: row.costUsd == null ? "—" : fmtUsd(row.costUsd) }),
        el("td", { class: "usage-val" }, sessionCell)));
    }
  }
  table.append(body);
  root.append(el("section", { class: "usage-section" },
    el("h2", { class: "usage-title", text: "Recent invocations" }),
    table));
}

function renderUsageWard(ward, quotasOnly) {
  const section = el("section", { class: "usage-section" });
  section.append(el("h2", { class: "usage-title", text: quotasOnly ? "Quota pressure" : "Spike / quota ward" }));
  if (!ward || (ward.available === false && !(ward.quotaPressure && ward.quotaPressure.length))) {
    section.append(el("p", { class: "usage-empty", text: (ward && ward.error) || "Ward data unavailable." }));
    return section;
  }
  if (!quotasOnly) {
    const spikes = ward.spikes || [];
    if (!spikes.length) {
      section.append(el("p", { class: "usage-empty", text: "No abrupt rate jumps vs the trailing baseline." }));
    } else {
      const list = el("ul", { class: "usage-ward-list" });
      for (const spike of spikes.slice(0, 8)) {
        list.append(el("li", {},
          el("strong", { text: spike.provider + " / " + spike.model }),
          ` · ${fmtTok(Math.round(spike.currentTokensPerHour))}/h vs baseline ${fmtTok(Math.round(spike.baselineTokensPerHour))}/h (${spike.ratio === 999 ? "new" : spike.ratio.toFixed(1) + "×"})`));
      }
      section.append(list);
    }
  }
  const pressure = ward.quotaPressure || [];
  if (pressure.length) {
    const list = el("ul", { class: "usage-ward-list" });
    for (const item of pressure.slice(0, 8)) {
      list.append(el("li", {},
        el("strong", { text: item.provider }),
        ` · ${item.label} · ${Math.round(item.usedPercent)}% used` + (item.resetsAt ? " · resets " + agoText(item.resetsAt) : "")));
    }
    section.append(el("h3", { class: "usage-subtitle", text: "Quota pressure" }), list);
  } else if (quotasOnly) {
    section.append(el("p", { class: "usage-empty", text: "No quota buckets above 75%." }));
  }
  return section;
}

/* ---------- boot ----------

   boot() is exported and its timers are tracked so a test can drive the real
   startup path instead of asserting against the source text of this file. The
   guarded call at the bottom of the module still runs it exactly once in a
   browser; nothing about page behaviour changes. stopBoot() exists purely so a
   test can leave no interval running behind it. */

const bootIntervals = [];

function stopBoot() {
  while (bootIntervals.length) clearInterval(bootIntervals.pop());
  // The stream is part of boot: leaving it open kept a live EventSource (and a
  // stale readyState read) alive after stopBoot() claimed to have stopped.
  if (es) {
    try { es.close(); } catch { /* already closed */ }
    es = null;
  }
}

function boot() {
  loadOverrides();
  loadWidgetPreferences();
  loadLookback();
  state.notify.baseTitle = document.title;
  loadNotifyPreference();
  renderNotifyToggle();
  void fetchSettings();

  $("notify-toggle").addEventListener("click", () => void toggleNotifications());

  $("search").addEventListener("input", (e) => {
    state.query = e.target.value.trim().toLowerCase();
    render();
  });

  $("views").addEventListener("click", (e) => {
    const btn = e.target.closest(".view-tab");
    if (btn && btn.dataset.view) setView(btn.dataset.view);
  });

  $("select-toggle").addEventListener("click", () => enterSelectMode(!state.selecting));

  $("actions-toggle").addEventListener("click", () => {
    state.actionsOpen = !state.actionsOpen;
    // Re-read on open: another operator (or this one, in another tab) may have
    // acted since the boot fetch.
    if (state.actionsOpen && state.actions.available) void loadActions();
    else render();
  });

  $("customize-summary").addEventListener("click", () => {
    state.widgetCustomizerOpen = !state.widgetCustomizerOpen;
    // Exclusive with the findings ledger (both are chrome expansions) — opening
    // the customizer collapses the findings so the strip never exceeds the viewport.
    if (state.widgetCustomizerOpen) state.pulseExpanded = false;
    renderHealthRail();
  });

  $("widget-reset").addEventListener("click", () => {
    state.widgetIds = defaultWidgetIds();
    saveWidgetPreferences();
    renderHealthRail();
  });

  $("empty-retry").addEventListener("click", () => {
    setConn("connecting");
    fetchSnapshot();
    if (es) es.close();
    connect();
  });

  document.addEventListener("keydown", (e) => { handleRowNavigation(e); });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (state.confirming) {
      // state.confirming holds the full instance fkey ("[head:]act:<id>:<action>"),
      // so Escape restores focus to the exact instance that opened the strip.
      const key = state.confirming;
      state.confirming = null;
      render();
      const origin = document.querySelector(`[data-fkey="${CSS.escape(key)}"]`);
      if (origin) origin.focus();
    } else if (state.renaming) {
      cancelRename();
    } else if (state.broadcastConfirming) {
      state.broadcastConfirming = false;
      render();
    } else if (state.widgetCustomizerOpen) {
      state.widgetCustomizerOpen = false;
      renderHealthRail();
    } else if (state.selecting) {
      enterSelectMode(false);
    } else if (state.selectedId) {
      closeInspector();
    }
  });

  bootIntervals.push(setInterval(() => {
    pollConnectionHealth();
    tickFreshnessSurfaces();
    void fetchTriageQueue();
  }, 5000));

  fetchSnapshot();
  fetchLabels();
  fetchTriageQueue();
  // One attempt at boot. It populates the drawer's "last action" fact, and on a
  // build without the route it latches available=false so nothing retries it.
  void loadActions();
  // The server's own health verdict, on its own slower clock: it is a whole
  // extra request, and a wedged server is not a sub-15s event.
  void pollServerHealth();
  bootIntervals.push(setInterval(() => { void pollServerHealth(); }, SERVER_HEALTH_POLL_MS));
  connect();
}

/* ---------- test seam ----------

   The hoisted block near the top of this file can only export function
   declarations: `state` and the module's `const`s are declared below it, so
   naming them there is a TDZ error. Everything that needed to be reached but
   could not is exported HERE, after the whole module has evaluated.

   Why it exists: twenty-two tests asserted that substrings appear in the raw
   text of this file. Those tests gate the deploy and cannot fail when the
   behaviour breaks — `sendControl` could stop requiring confirmation, or start
   calling HTTP 200 a success, and every one of them would still pass. The
   request/confirmation logic was private, so there was nothing else to assert.

   The surface is deliberately narrow and honest: the request functions, the
   module state they mutate, and the pure helpers behind the new surfaces. It is
   NOT a general escape hatch, and `boot()` / `render()` never read it. Tests
   that write `state` are responsible for restoring what they touched. */
Object.assign(globalThis.TheAntHill, {
  // The module's real state object. Exported because the confirmation strip,
  // the pending set, the feedback map and the attention/triage records are all
  // written by the request functions and read by the render functions — there
  // is no way to assert the behaviour without both ends.
  state,
  // Request/confirmation logic. Each one is driven in tests with a fake fetch.
  apiFetch, sendControl, sendBroadcast, recollectSnapshot, fetchSnapshot,
  applySnapshot, applySnapshotDelta, handleEventPayload, handleDeltaPayload, tickFreshnessSurfaces,
  triageIssue, removeTriageItem, fetchTriageQueue,
  fetchLabels, submitRename, startRename,
  loadTranscript, loadActions, applyAttention,
  toggleSelect, enterSelectMode, selectedRecipients,
  // Surfaces added this wave, plus the const limits FE-C had to leave out.
  // Startup path + the server-health probe, driven for real by tests.
  boot, stopBoot, pollServerHealth, renderServerHealth, SERVER_HEALTH_POLL_MS,
  livenessState, livenessView, verdictLiveness,
  attentionRecord, attentionStateText, attentionErrorText, renderAttentionBlock,
  triageLifecycleControls, readEndpointOriginNote,
  TRANSCRIPT_DEFAULT_LIMIT, TRANSCRIPT_MAX_LIMIT, TRANSCRIPT_RENDER_CAP,
  ACTIONS_DEFAULT_LIMIT, ACTIONS_MAX_LIMIT,
  ATTENTION_SNOOZE_MS, API_READ_TIMEOUT_MS, API_TRANSCRIPT_TIMEOUT_MS, API_WRITE_TIMEOUT_MS,
});

if (typeof document !== "undefined" && typeof window !== "undefined") {
  boot();
}
