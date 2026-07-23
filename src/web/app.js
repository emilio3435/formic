/* The Ant Hill v3 — operator console client.
   Consumes GET /api/snapshot + SSE /api/events, sends POST /api/control.
   No frameworks. All dynamic content is built via DOM APIs (no innerHTML with data).
   Pure helpers are exposed on globalThis.TheAntHill so tests can import this
   file directly; DOM wiring only runs when a document exists. */

"use strict";

/* ---------- tiny DOM helpers ---------- */

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2), v);
    } else node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

/* ---------- inline SVG icon vocabulary ----------
   One coherent line-art set, built with the SVG DOM (never innerHTML). Every
   icon shares the same 24×24 grid, currentColor stroke, and round joins so the
   console reads as one drawn language. Unfamiliar marks (linked / observed /
   quarantine / broadcast) are always paired with a text label or title. */

const SVGNS = "http://www.w3.org/2000/svg";

function svgChild(spec) {
  const node = document.createElementNS(SVGNS, spec[0]);
  for (const [k, v] of Object.entries(spec[1] || {})) if (v != null) node.setAttribute(k, String(v));
  return node;
}

/* Instrument-panel glyph set — mixing-console / oscilloscope language rather than
   clinical warning-triangle + info slop. Marks are built from straight rails,
   nodes (LEDs), and peaks so severity reads as shape, not flood color. Angular
   shapes use miter joins locally; connectors/waveforms keep the round default. */
const ICON_PATHS = {
  // patch-bay link: two jack nodes joined by a rail
  linked: [["circle", { cx: 6, cy: 12, r: 2.4 }], ["circle", { cx: 18, cy: 12, r: 2.4 }], ["line", { x1: 8.4, y1: 12, x2: 15.6, y2: 12 }]],
  // monitor / observe: aperture lens
  observed: [["path", { d: "M2.5 12s3.6-6 9.5-6 9.5 6 9.5 6-3.6 6-9.5 6-9.5-6-9.5-6z" }], ["circle", { cx: 12, cy: 12, r: 2.4 }]],
  // isolate: angular shield + latch
  quarantine: [["path", { d: "M12 2.8 4.5 5.5v5.3c0 4.4 3.1 7.6 7.5 8.9 4.4-1.3 7.5-4.5 7.5-8.9V5.5z", "stroke-linejoin": "miter" }], ["rect", { x: 9.3, y: 11, width: 5.4, height: 4.4, rx: 0.4 }], ["path", { d: "M10.5 11V9.6a1.5 1.5 0 0 1 3 0V11" }]],
  // intervention: peak bar driven to the rail + LED base
  intervention: [["line", { x1: 12, y1: 4.5, x2: 12, y2: 13.5, "stroke-width": 2.6 }], ["rect", { x: 10.7, y: 16.6, width: 2.6, height: 2.6, fill: "currentColor", stroke: "none" }]],
  // advisory: caution diamond (no clinical triangle) with peak stem + LED
  warning: [["path", { d: "M12 2.8 21.2 12 12 21.2 2.8 12z", "stroke-linejoin": "miter" }], ["line", { x1: 12, y1: 7.6, x2: 12, y2: 12.8, "stroke-width": 2 }], ["rect", { x: 11, y: 15, width: 2, height: 2, fill: "currentColor", stroke: "none" }]],
  // cog for the Evidence disclosure — a settings-flavored "more machinery" mark
  gear: [
    ["circle", { cx: 12, cy: 12, r: 3 }],
    ["path", { d: "M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.1 5.1l1.6 1.6M17.3 17.3l1.6 1.6M5.1 18.9l1.6-1.6M17.3 6.7l1.6-1.6" }],
  ],
  // resolved: crisp confirm tick
  check: [["polyline", { points: "4.5 12.5 9.5 17.5 19.5 6.5", "stroke-linejoin": "miter" }]],
  // rename: nib + trim edge
  rename: [["path", { d: "M4 20.5h4l10.3-10.3-4-4L4 16.5z", "stroke-linejoin": "miter" }], ["line", { x1: 13.5, y1: 7, x2: 17.5, y2: 11 }]],
  // broadcast: transmit node with radiating carrier arcs
  broadcast: [["circle", { cx: 12, cy: 12, r: 2.1, fill: "currentColor", stroke: "none" }], ["path", { d: "M8.2 8.2a5.5 5.5 0 0 0 0 7.6" }], ["path", { d: "M15.8 8.2a5.5 5.5 0 0 1 0 7.6" }], ["path", { d: "M5.4 5.4a9.5 9.5 0 0 0 0 13.2" }], ["path", { d: "M18.6 5.4a9.5 9.5 0 0 1 0 13.2" }]],
  close: [["line", { x1: 6, y1: 6, x2: 18, y2: 18 }], ["line", { x1: 18, y1: 6, x2: 6, y2: 18 }]],
  caret: [["polyline", { points: "9 6 15 12 9 18" }]],
  // offline: dark node, severed rail
  offline: [["circle", { cx: 12, cy: 12, r: 9 }], ["line", { x1: 8, y1: 12, x2: 16, y2: 12 }]],
  // focus: jump-to-pane crosshair
  focus: [["circle", { cx: 12, cy: 12, r: 3 }], ["line", { x1: 12, y1: 3, x2: 12, y2: 7 }], ["line", { x1: 12, y1: 17, x2: 12, y2: 21 }], ["line", { x1: 3, y1: 12, x2: 7, y2: 12 }], ["line", { x1: 17, y1: 12, x2: 21, y2: 12 }]],
  // interrupt: pause bars
  interrupt: [["rect", { x: 7, y: 5.5, width: 3.4, height: 13, rx: 0.6 }], ["rect", { x: 13.6, y: 5.5, width: 3.4, height: 13, rx: 0.6 }]],
  // archive: tray
  archive: [["path", { d: "M4 7h16v11.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z", "stroke-linejoin": "miter" }], ["line", { x1: 2.5, y1: 7, x2: 21.5, y2: 7 }], ["line", { x1: 9, y1: 12, x2: 15, y2: 12 }]],
};

function icon(name, opts = {}) {
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("class", "ico" + (opts.class ? " " + opts.class : ""));
  if (opts.label) { svg.setAttribute("role", "img"); svg.setAttribute("aria-label", opts.label); }
  else svg.setAttribute("aria-hidden", "true");
  for (const spec of ICON_PATHS[name] || ICON_PATHS.warning) svg.append(svgChild(spec));
  return svg;
}

/* SVG bar meter — width via geometry attributes, never inline style, so the
   strict CSP (style-src 'self') permits it. */
function svgMeter(pct, cls, opts = {}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const tone = clamped >= 92 ? " hot" : clamped >= 75 ? " warn" : "";
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 100 8");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", cls);
  svg.setAttribute("role", "progressbar");
  svg.setAttribute("aria-valuemin", "0");
  svg.setAttribute("aria-valuemax", "100");
  svg.setAttribute("aria-valuenow", String(Math.round(clamped)));
  if (opts.label) svg.setAttribute("aria-label", opts.label);
  const track = svgChild(["rect", { x: 0, y: 0, width: 100, height: 8, rx: 4, class: opts.trackClass || "tm-track" }]);
  const fill = svgChild(["rect", { x: 0, y: 0, width: clamped, height: 8, rx: 4, class: (opts.fillClass || "tm-fill") + tone }]);
  svg.append(track, fill);
  return svg;
}

/* Segmented SVG meter — one contiguous bar split into proportional bands, each a
   rect whose width is a geometry attribute (never inline style, so the strict
   CSP holds). segments = [{ cls, value }]; zero-value bands are skipped. */
function svgSegmentMeter(segments, opts = {}) {
  const total = segments.reduce((sum, seg) => sum + Math.max(0, seg.value), 0);
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 100 8");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "dw-meter");
  svg.setAttribute("role", "img");
  if (opts.label) svg.setAttribute("aria-label", opts.label);
  let x = 0;
  if (total > 0) {
    for (const seg of segments) {
      const w = (Math.max(0, seg.value) / total) * 100;
      if (w <= 0) continue;
      svg.append(svgChild(["rect", { x, y: 0, width: w, height: 8, class: seg.cls }]));
      x += w;
    }
  }
  return svg;
}

/* SVG donut ring — filled arc length is a geometry attribute (stroke-dasharray
   on a circle whose circumference is 100), never inline style, so the strict CSP
   (style-src 'self') holds. Center % is an SVG <text>. */
function svgRing(pct, opts = {}) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const tone = clamped >= 92 ? " hot" : clamped >= 75 ? " warn" : "";
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", "0 0 36 36");
  svg.setAttribute("class", "vital-ring");
  svg.setAttribute("role", "progressbar");
  svg.setAttribute("aria-valuemin", "0");
  svg.setAttribute("aria-valuemax", "100");
  svg.setAttribute("aria-valuenow", String(clamped));
  if (opts.label) svg.setAttribute("aria-label", opts.label);
  svg.append(svgChild(["circle", { cx: 18, cy: 18, r: 15.915, class: "ring-track" }]));
  svg.append(svgChild(["circle", {
    cx: 18, cy: 18, r: 15.915, class: "ring-fill" + tone,
    "stroke-dasharray": clamped + " " + (100 - clamped),
  }]));
  const label = document.createElementNS(SVGNS, "text");
  label.setAttribute("x", "18");
  label.setAttribute("y", "18");
  label.setAttribute("class", "ring-pct");
  label.textContent = clamped + "%";
  svg.append(label);
  return svg;
}

/* ---------- formatting ---------- */

const fmtTok = (n) =>
  n >= 1e9 ? (n / 1e9).toFixed(2) + "B"
  : n >= 1e6 ? (n / 1e6).toFixed(1) + "M"
  : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n);

function fmtElapsed(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const s = ms / 1000;
  if (s < 90) return Math.round(s) + "s";
  if (s < 5400) return Math.round(s / 60) + "m";
  if (s < 129600) return (s / 3600).toFixed(1) + "h";
  return Math.round(s / 86400) + "d";
}

function agoText(iso) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return fmtElapsed(Date.now() - t) + " ago";
}

const MODEL_SHORT = [
  ["fable", "fable 5"], ["sol", "sol 5.6"], ["luna", "luna 5.6"], ["grok", "grok"],
];
// Anthropic families whose transcript id carries a version we want to keep
// (e.g. claude-opus-4-8 → "opus 4.8"), rather than collapsing to a bare label.
const ANTHROPIC_VERSIONED = ["opus", "sonnet", "haiku"];
function modelShort(m) {
  if (!m) return null;
  const low = m.toLowerCase();
  for (const fam of ANTHROPIC_VERSIONED) {
    const at = low.indexOf(fam);
    if (at === -1) continue;
    // Trailing version group right after the family (e.g. "-4-8" → "4.8").
    const ver = low.slice(at + fam.length).match(/^[-_](\d+(?:[-_]\d+)*)/);
    return ver ? fam + " " + ver[1].replace(/[-_]/g, ".") : fam;
  }
  for (const [key, label] of MODEL_SHORT) if (low.includes(key)) return label;
  return m.length > 18 ? m.slice(0, 17) + "…" : m;
}

const PROVIDER_LABELS = { codex: "Codex", claude: "Claude", cursor: "Cursor", omp: "OMP" };
const providerLabel = (p) => PROVIDER_LABELS[p] || p;

/* ---------- provider-neutral state language ---------- */

const ACTIVITY_LABELS = { working: "Working", idle: "Idle", ended: "Ended", unknown: "Unknown" };
const OUTCOME_LABELS = { healthy: "Healthy", "needs-you": "Alert", blocked: "Blocked", failed: "Failed" };
const CONTROL_LABELS = { linked: "Linked", "observed-only": "Observed only", quarantined: "Quarantined" };
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

/* Plain-language control explanation for the Operate chrome. Never echoes
   capability reasons here — live reasons carry raw cmux/session IDs, which
   belong only in Evidence. */
function controlUnavailableText(controlState) {
  return controlState === "quarantined"
    ? "Controls are unavailable — this session's identity is ambiguous, so control routing is quarantined."
    : "Controls are unavailable — no safe cmux target is linked to this session.";
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

const OPS_VIEWS = ["now", "needs-you", "working", "idle", "history"];
const VIEWS = [...OPS_VIEWS, "usage"];
const LOOKBACK_STORAGE_KEY = "mtn3-lookbackHours";
const LOOKBACK_PRESETS = [1, 6, 24, 36];
const DEFAULT_LOOKBACK_HOURS = 6;
const USAGE_RANGE_PRESETS = [
  { id: "1h", hours: 1, label: "1h" },
  { id: "24h", hours: 24, label: "24h" },
  { id: "7d", hours: 24 * 7, label: "7d" },
  { id: "30d", hours: 24 * 30, label: "30d" },
];

function viewMatches(view, agent) {
  const act = deriveActivity(agent);
  const out = deriveOutcome(agent);
  switch (view) {
    case "now": return act === "working" || (act !== "ended" && out !== "healthy");
    case "needs-you": return act !== "ended" && out !== "healthy";
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

const MODEL_POLICY_LABELS = {
  compliant: "Compliant",
  mismatch: "Model mismatch",
  violation: "Model mismatch",
  unreported: "Model unreported",
  unverified: "Model unreported",
};

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
  const state = p.state === "violation" ? "mismatch" : p.state === "unverified" ? "unreported" : p.state;
  return {
    state,
    label: MODEL_POLICY_LABELS[p.state],
    expected: p.expected || null,
    summary: p.summary || (
      state === "mismatch" ? "The reported model is outside the approved model policy."
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

const WIDGET_STORAGE_KEY = "mtn3-summary-widgets";
const DEFAULT_WIDGET_IDS = Object.freeze([
  "system", "active-work", "attention", "context-peak", "source-health",
]);
const WIDGET_CATALOG = Object.freeze([
  { id: "system", label: "System", required: true },
  { id: "active-work", label: "Active work" },
  { id: "attention", label: "Attention" },
  { id: "context-peak", label: "Context peak" },
  { id: "source-health", label: "Source health" },
  { id: "waiting", label: "Waiting" },
  { id: "history", label: "History" },
  { id: "model-policy", label: "Model policy" },
  { id: "routing-health", label: "Routing health" },
  { id: "context-reporting", label: "Context reporting" },
]);
const WIDGET_IDS = new Set(WIDGET_CATALOG.map((widget) => widget.id));

function defaultWidgetIds() {
  return [...DEFAULT_WIDGET_IDS];
}

function normalizeWidgetIds(ids) {
  if (!Array.isArray(ids) || !ids.length) return defaultWidgetIds();
  const unique = new Set(ids);
  if (ids[0] !== "system" || unique.size !== ids.length || ids.some((id) => typeof id !== "string" || !WIDGET_IDS.has(id))) {
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

function systemStatus(snap, conn = "live") {
  if (!snap || conn === "offline") return { key: "offline", label: "Offline", tone: "offline" };
  const control = snap.controlHealth;
  const source = snap.totals && snap.totals.sourceHealth;
  const sourceDegraded = source && source.total > 0 && (source.degraded > 0 || source.healthy < source.total);
  const controlDegraded = !control || control.cmuxReachable !== true || control.errors?.length > 0 || control.staleSources?.length > 0;
  const feedDegraded = conn !== "live";
  if (sourceDegraded || controlDegraded || feedDegraded) return { key: "degraded", label: "Degraded", tone: "degraded" };
  return { key: "operational", label: "Operational", tone: "ok" };
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

function noDataWidget(sublabel) {
  return { value: "No data", unit: "", sublabel, tone: "missing" };
}

function summaryWidgetData(id, snap, conn = "live", display = "percent") {
  if (id === "system") {
    const status = systemStatus(snap, conn);
    const control = snap && snap.controlHealth;
    return {
      value: status.label,
      unit: "",
      sublabel: !snap
        ? (conn === "offline" ? "Snapshot connection unavailable." : "Waiting for the first snapshot.")
        : status.key === "operational" ? "Sources and controls healthy."
          : conn !== "live" ? "Live snapshot feed is not healthy."
            : control && control.cmuxReachable !== true
              ? "cmux unreachable — terminal titles and Focus/Send stay offline."
              : "Source or control evidence needs review.",
      tone: status.tone,
      icon: status.key === "operational" ? "check" : status.key === "offline" ? "offline" : "warning",
    };
  }
  if (!snap) return noDataWidget("Waiting for the first snapshot.");

  const totals = totalsOf(snap);
  if (id === "active-work") {
    return { value: String(totals.working), unit: "working", sublabel: `${totals.live} live · ${totals.tracked} tracked`, tone: "ok" };
  }
  if (id === "attention") {
    const attention = attentionSummary(snap);
    return {
      value: String(attention.count),
      unit: attention.count === 1 ? "finding" : "findings",
      sublabel: attention.count
        ? `${attention.interventions} intervention${attention.interventions === 1 ? "" : "s"} · ${attention.advisories} advis${attention.advisories === 1 ? "ory" : "ories"}`
        : "No active findings.",
      tone: attention.count ? "hot" : "ok",
    };
  }
  if (id === "context-peak") {
    const peak = peakContext(snap);
    if (!peak) return noDataWidget("No live context reports.");
    const coverage = totals.tokenReporting != null && totals.tokenEligible != null
      ? ` · ${totals.tokenReporting}/${totals.tokenEligible} reporting` : "";
    return {
      value: contextDisplayValue(peak.agent.tokens, display),
      unit: display === "percent" ? "peak window" : "",
      sublabel: "Highest observed" + coverage,
      tone: peak.pct >= 85 ? "hot" : "ok",
      meterPct: peak.pct,
    };
  }
  if (id === "source-health") {
    const source = totals.sourceHealth;
    if (!source || source.total <= 0) return noDataWidget("Source health is not reported.");
    return {
      value: `${source.healthy}/${source.total}`,
      unit: "healthy",
      sublabel: `${source.degraded} degraded · ${source.total} total`,
      tone: source.degraded ? "warn" : "ok",
    };
  }
  if (id === "waiting") {
    return { value: String(totals.idle), unit: "waiting", sublabel: "Idle sessions awaiting work.", tone: "ok" };
  }
  if (id === "history") {
    return { value: String(totals.history), unit: "done", sublabel: "Completed or archived sessions.", tone: "ok" };
  }
  if (id === "model-policy") {
    const policy = totals.cursorModelHealth;
    if (!policy || policy.total <= 0) return noDataWidget("Model policy is not reported.");
    const mismatch = Number(policy.mismatch) || 0;
    return {
      value: mismatch ? String(mismatch) : "OK",
      unit: mismatch ? (mismatch === 1 ? "mismatch" : "mismatches") : "",
      sublabel: `${policy.compliant} compliant · ${policy.unreported} unreported`,
      tone: mismatch ? "hot" : "ok",
    };
  }
  if (id === "routing-health") {
    const control = snap.controlHealth;
    if (!control) return noDataWidget("Routing health is not reported.");
    const stale = control.staleSources?.length || 0;
    const errors = control.errors?.length || 0;
    const degraded = control.cmuxReachable !== true || stale > 0 || errors > 0;
    return {
      value: degraded ? "Degraded" : "Ready",
      unit: "",
      sublabel: degraded ? `${stale} stale source${stale === 1 ? "" : "s"} · ${errors} error${errors === 1 ? "" : "s"}` : "Controls reachable.",
      tone: degraded ? "warn" : "ok",
    };
  }
  if (id === "context-reporting") {
    if (totals.tokenReporting == null || totals.tokenEligible == null) {
      return noDataWidget("Context reporting is not reported.");
    }
    return {
      value: `${totals.tokenReporting}/${totals.tokenEligible}`,
      unit: "reporting",
      sublabel: totals.tokenEligible ? "Live sessions reporting context." : "No sessions eligible to report context.",
      tone: "ok",
    };
  }
  return noDataWidget("Widget evidence is not available.");
}

const AFFECTS_SAMPLE_LIMIT = 6;
// At most five rows per lane before a "+N more" control expands the lane in
// place — dense but never an unbounded wall.
const MAX_LANE_ROWS = 5;

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
  totalsOf, issuesOf, viewMatches, matchesQuery, buildClusters, tokenSummary,
  issueLifecycle, issueStateLabel, recentlyResolvedOf,
  contextUsage, contextDisplayValue, typicalRequestOf, modelPolicyView, cursorPolicyParts, MODEL_POLICY_LABELS,
  roleView, formatLastHumanMessage, rowSummary, NO_READABLE_MESSAGE,
  elapsedDataset, liveElapsedText, fmtTok, fmtElapsed, modelShort, agentName,
  sourceAgentName, presentationLabelKey, agentLabelEligible, programName,
  preferredRenameTarget, terminalSourceName, taskMeaningfullyDifferent,
  ACTIVITY_LABELS, OUTCOME_LABELS, CONTROL_LABELS, VIEWS, OPS_VIEWS,
  withinLookback, parseLookbackHours, lookbackApplies, lookbackLabel,
  DEFAULT_LOOKBACK_HOURS, LOOKBACK_PRESETS,
  broadcastEligible,
  WIDGET_STORAGE_KEY, DEFAULT_WIDGET_IDS, WIDGET_CATALOG,
  normalizeWidgetIds, parseWidgetPreference, reorderWidgetIds,
  attentionBoardOf, issueWorkState, issueStage, affectedImpact, issueProgress, issueImpactLine,
  systemStatus, attentionSummary, summaryWidgetData, topSourceIssue,
  parseInvestigationResult,
};

/* ---------- state ---------- */

const STALE_AFTER_MS = 60_000;

const state = {
  snap: null,
  fetchFailed: false,
  conn: "connecting", // connecting | live | reconnecting | stale | offline
  lastEventAt: 0,
  view: "now",
  query: "",
  facetProgram: "",
  facetProvider: "",
  lookbackHours: DEFAULT_LOOKBACK_HOURS, // null = all collected
  scanWindowHours: 36,
  settingsLoaded: false,
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
  drafts: new Map(),      // agentId -> instruct draft text
  confirming: null,       // `${agentId}:${action}`
  pending: new Set(),     // `${agentId}:${action}`
  feedback: new Map(),    // agentId -> { ok, action, message }
  triage: new Map(),      // issueId -> recommendation
  triagePending: new Set(),
  triageErrors: new Map(),
  queueItems: [],
  // Per-lane "show all" toggle. Each lane caps at MAX_LANE_ROWS; the "+N more"
  // control expands that lane in place (no route change). Reset is transient —
  // it is not persisted, so a reload returns to the dense five-row view.
  laneExpanded: { act: false, aware: false },
  // Paint signatures — skip wipe-and-rebuild when a surface's meaningful
  // content is unchanged across SSE snapshots (stops the 4s strobe).
  paintSig: { attention: "", programs: "", inspector: "", widgets: "" },
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

async function fetchSettings() {
  try {
    const res = await fetch("/api/settings", { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error("settings " + res.status);
    const body = await res.json();
    const hours = Number(body.scanWindowHours ?? (body.settings && body.settings.scanWindowHours));
    if (Number.isFinite(hours)) state.scanWindowHours = hours;
    state.settingsLoaded = true;
  } catch {
    state.settingsLoaded = false;
  }
}

async function postScanWindow(hours) {
  const clamped = Math.max(1, Math.min(168, Math.round(Number(hours))));
  if (!Number.isFinite(clamped)) return;
  state.settingsPending = true;
  renderFilterBar();
  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ scanWindowHours: clamped }),
    });
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

function toggleLane(lane) {
  state.laneExpanded[lane] = !state.laneExpanded[lane];
  renderAttentionBoard();
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

async function fetchSnapshot() {
  try {
    const res = await fetch("/api/snapshot", { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const snap = await res.json();
    if (!snap || snap.schemaVersion !== 1 || !Array.isArray(snap.programs)) {
      throw new Error("unexpected snapshot shape");
    }
    state.snap = snap;
    if (Number.isFinite(Number(snap.scanWindowHours))) state.scanWindowHours = Number(snap.scanWindowHours);
    state.fetchFailed = false;
    render();
  } catch (err) {
    state.fetchFailed = true;
    if (!state.snap) {
      setConn("offline");
      render();
    }
    console.warn("snapshot fetch failed:", err);
  }
}

let refetchTimer = null;
function scheduleRefetch() {
  if (refetchTimer) return;
  refetchTimer = setTimeout(() => { refetchTimer = null; fetchSnapshot(); }, 400);
}

function handleEventPayload(raw) {
  state.lastEventAt = Date.now();
  if (state.conn !== "live") setConn("live");
  let msg;
  try { msg = JSON.parse(raw); } catch { scheduleRefetch(); return; }
  const snap =
    msg && msg.schemaVersion === 1 && Array.isArray(msg.programs) ? msg
    : msg && msg.snapshot && msg.snapshot.schemaVersion === 1 ? msg.snapshot
    : null;
  if (snap) {
    state.snap = snap;
    if (Number.isFinite(Number(snap.scanWindowHours))) state.scanWindowHours = Number(snap.scanWindowHours);
    state.fetchFailed = false;
    render();
  } else {
    scheduleRefetch(); // unknown event kind: treat as a nudge, refetch the truth
  }
}

let es = null;
function connect() {
  es = new EventSource("/api/events");
  es.onopen = () => { state.lastEventAt = Date.now(); setConn("live"); };
  es.onerror = () => { setConn(state.snap ? "reconnecting" : "offline"); };
  es.onmessage = (e) => handleEventPayload(e.data);
  es.addEventListener("snapshot", (e) => handleEventPayload(e.data));
  // Heartbeats only prove the feed is alive — no refetch, no snapshot re-render.
  es.addEventListener("heartbeat", () => {
    state.lastEventAt = Date.now();
    if (state.conn !== "live") setConn("live");
  });
}

function setConn(next) {
  if (state.conn === next) return;
  state.conn = next;
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

function renderConn() {
  const badge = $("conn-badge");
  badge.className = "conn conn-" + state.conn;
  $("conn-label").textContent = CONN_LABELS[state.conn];
  renderBeacon();
}

function renderBeacon() {
  const beacon = $("nest-beacon");
  beacon.classList.remove("calm", "flare");
  if (!state.snap || state.conn === "offline") return;
  beacon.classList.add(issuesOf(state.snap).length > 0 ? "flare" : "calm");
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
  renderHealthRail();
  renderAttentionBoard();
  renderTabs();
  renderFilterBar();
  renderPrograms();
  renderInspector();
  renderBroadcastBar();
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

function renderSummaryWidget(id) {
  const meta = WIDGET_CATALOG.find((widget) => widget.id === id);
  const data = summaryWidgetData(id, state.snap, state.conn, state.contextDisplay);
  const valueClass = ["reading-value", data.tone === "hot" ? "is-hot" : "", data.tone === "ok" ? "is-ok" : "", data.tone === "missing" ? "reading-no-data" : ""]
    .filter(Boolean).join(" ");
  let valueNode;
  if (id === "system") {
    valueNode = el("span", { class: valueClass },
      el("span", { class: "verdict-chip verdict-" + data.tone }, icon(data.icon), data.value));
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
  const degraded = id === "system" && data.tone === "degraded";
  const reason = degraded ? topSourceIssue(state.snap) : null;
  const snapNote = id === "system" && state.snap?.generatedAt ? ` · snapshot ${agoText(state.snap.generatedAt)}` : "";
  subNode.append(el("span", { text: (reason ? reason.title : data.sublabel) + snapNote }));
  if (degraded) {
    subNode.append(el("button", {
      type: "button",
      class: "reading-repair",
      title: "Re-pull the latest snapshot evidence",
      "aria-label": reason ? "Refresh snapshot — " + reason.title : "Refresh snapshot",
      dataset: { fkey: "degraded-refresh" },
      onclick: () => fetchSnapshot(),
    }, "Refresh"));
  }
  return reading(widgetLabelNode(id, meta.label), valueNode, subNode, "reading-widget widget-" + id);
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

/* One status verdict and one configurable, scan-ordered widget rail. */
function renderHealthRail() {
  const widgets = $("health-widgets");
  if (!widgets) return;
  const verdict = systemStatus(state.snap, state.conn);
  const sig = [
    state.conn,
    verdict.label,
    state.widgetIds.join(","),
    state.widgetCustomizerOpen ? "1" : "0",
    state.widgetIds.map((id) => {
      const data = summaryWidgetData(id, state.snap, state.conn, state.contextDisplay);
      return [id, data.value, data.unit, data.sublabel, data.tone].join(":");
    }).join("|"),
  ].join("\u001f");
  if (paintUnchanged("widgets", sig)) return;
  widgets.textContent = "";
  for (const id of state.widgetIds) widgets.append(renderSummaryWidget(id));
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
    const res = await fetch("/api/triage/queue", { headers: { accept: "application/json" } });
    const body = await res.json();
    if (!res.ok || !body || body.ok !== true || !Array.isArray(body.items)) throw new Error("queue response was invalid");
    state.queueItems = body.items;
    renderHealthRail();
    renderAttentionBoard();
  } catch (err) {
    console.warn("triage queue fetch failed:", err);
  }
}

async function triageIssue(issueId, action) {
  const key = action + ":" + issueId;
  if (state.triagePending.has(key)) return;
  state.triagePending.add(key);
  state.triageErrors.delete(issueId);
  renderAttentionBoard();
  try {
    const res = await fetch("/api/triage/" + action, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ issueId }),
    });
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
// wires the one primary follow-up action.
const BRIEFING_MAX_BULLETS = 3;
function renderInvestigationResult(resultText, outcome, opts = {}) {
  const blocked = outcome === "blocked";
  const parsed = parseInvestigationResult(resultText);
  const headline = parsed.headline || (blocked ? "Investigation blocked" : "Investigation complete");
  const nextSteps = investigationResultNextSteps(parsed, blocked ? "blocked" : "completed");
  const seen = new Set([headline, parsed.headline].filter(Boolean));
  // Body cap: blockers first, then findings, at most three bullets total —
  // everything else stays in the collapsed Raw output.
  const blockers = parsed.blockers.filter((item) => !seen.has(item)).slice(0, BRIEFING_MAX_BULLETS);
  const findings = parsed.findings.filter((item) => !seen.has(item))
    .slice(0, Math.max(0, BRIEFING_MAX_BULLETS - blockers.length));
  const summary = parsed.summary && parsed.summary !== headline ? parsed.summary : "";
  let bodyShown = false;

  const briefing = el("section", {
    class: "triage-result triage-briefing" + (blocked ? " triage-briefing--blocked" : " triage-briefing--ok"),
    "aria-label": blocked ? "Blocked investigation result" : "Investigation result",
  },
    el("div", { class: "triage-briefing-kicker" },
      el("span", { class: "triage-briefing-status", text: blocked ? "Blocked" : "Complete" }),
      el("span", { class: "triage-briefing-kicker-note", text: blocked
        ? "Operator review needed"
        : "Waiting for fresh data" })),
    el("p", { class: "triage-briefing-headline", text: headline }));

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
  const cta = investigationResultCta(blocked ? "blocked" : "completed", opts.issueId);
  briefing.append(el("div", { class: "triage-briefing-section triage-briefing-next" },
    el("h4", { class: "triage-briefing-label", text: "What to do next" }),
    cta,
    el("ul", { class: "triage-briefing-list triage-briefing-list--next" },
      nextSteps.slice(0, 2).map((item) => el("li", { text: item })))));

  briefing.append(el("details", { class: "triage-briefing-raw" },
    el("summary", { text: "Raw output" }),
    el("pre", { text: parsed.raw })));

  return briefing;
}

function renderTriage(issue) {
  const recommendation = state.triage.get(issue.id);
  const queueItem = state.queueItems.find((item) => item.issueId === issue.id);
  const queued = !!queueItem;
  const generating = state.triagePending.has("generate:" + issue.id);
  const queueing = state.triagePending.has("queue:" + issue.id);
  const launching = state.triagePending.has("run:" + issue.id);
  const error = state.triageErrors.get(issue.id);
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
    const plan = el("section", { class: "triage-plan", "aria-label": "Generated triage" },
      el("div", { class: "triage-plan-head" },
        el("span", { class: "triage-mode triage-mode-" + recommendation.mode, text: recommendation.mode }),
        el("strong", { class: "triage-outcome", text: recommendation.headline })),
      el("p", { class: "triage-rationale", text: recommendation.rationale }),
      el("details", { class: "triage-details" },
        el("summary", { text: recommendation.steps.length + "-step plan" }),
        el("ol", { class: "triage-steps" }, recommendation.steps.map((step) =>
          el("li", {}, el("strong", { text: step.title }), el("span", { text: step.detail }))))));

    if (recommendation.queueRecommended) {
      plan.append(el("div", { class: "triage-queue-row" },
        el("button", {
          type: "button",
          class: "btn triage-queue",
          disabled: queued || queueing ? "" : null,
          "aria-busy": queueing ? "true" : null,
          onclick: () => triageIssue(issue.id, "queue"),
        }, queued
          ? queueItem.state === "completed" ? "✓ Investigation complete · verifying"
            : queueItem.state === "running" ? "● Investigation running"
            : queueItem.state === "blocked" ? "! Investigation blocked"
            : "✓ Investigation queued"
          : queueing ? "Queueing…" : "Queue investigation"),
        queueItem && queueItem.state === "queued" ? el("button", {
          type: "button",
          class: "btn triage-run",
          disabled: launching ? "" : null,
          "aria-busy": launching ? "true" : null,
          onclick: () => triageIssue(issue.id, "run"),
        }, launching ? "Launching…" : "Launch read-only Luna") : null,
        el("span", { class: "triage-queue-note", text: queueItem
          ? queueItem.state === "running" ? "Investigation running · " + (queueItem.runModel || "native Luna")
            : queueItem.state === "completed" ? "Investigation complete · waiting for fresh data"
            : queueItem.state === "blocked" ? "Investigation blocked · review result"
            : "Queued and ready for explicit launch"
          : "Queues a bounded investigation. Launch remains a separate operator action." })));
      if (queueItem && queueItem.result) {
        plan.append(renderInvestigationResult(queueItem.result, queueItem.state === "blocked" ? "blocked" : "completed", { issueId: issue.id }));
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
function issueImpactLine(issue) {
  if (issue && typeof issue.impactSummary === "string" && issue.impactSummary.trim()) {
    return issue.impactSummary.trim();
  }
  return affectedImpact(issue).plain;
}

const IN_MOTION_KEYS = new Set(["triaging", "planned", "queued", "investigating", "verifying"]);

/* Snap rollup for the conductor. Prefer server attentionBoard; otherwise derive
   from issues + recentlyResolved + live queue so older servers still paint. */
function attentionBoardOf(snap, queueItems = []) {
  const board = snap && snap.attentionBoard;
  if (board && typeof board.actNow === "number" && typeof board.allClear === "boolean") {
    return {
      actNow: board.actNow | 0,
      watch: board.watch | 0,
      inMotion: board.inMotion | 0,
      cleared: board.cleared | 0,
      allClear: !!board.allClear,
    };
  }
  const issues = issuesOf(snap);
  const resolved = recentlyResolvedOf(snap);
  const liveIssueIds = new Set(issues.map((issue) => issue.id));
  const resolvedIds = new Set(resolved.map((issue) => issue.id));
  const triageByIssue = new Map(
    (snap && Array.isArray(snap.triageSummaries) ? snap.triageSummaries : [])
      .map((row) => [row.issueId, row.state]),
  );
  for (const item of queueItems) triageByIssue.set(item.issueId, item.state);

  // Lanes are mutually exclusive: a finding that is in motion is never also
  // "act now" — Act means a human decision is needed right now.
  const actNowIds = new Set();
  const watchIds = new Set();
  const inMotionIds = new Set();
  for (const issue of issues) {
    const work = issueWorkState(issue, queueItems);
    if (IN_MOTION_KEYS.has(work.key)) inMotionIds.add(issue.id);
    else if (issue.severity === "error") actNowIds.add(issue.id);
    else watchIds.add(issue.id);
  }
  for (const [issueId, qState] of triageByIssue) {
    // In-motion is mutually exclusive with Act now / Watch: an issue being
    // worked never also nags in another lane (merge of the lane's exclusivity
    // with main's orphan-blocked guard).
    if (qState === "queued" || qState === "running" || qState === "completed") {
      inMotionIds.add(issueId);
      actNowIds.delete(issueId);
      watchIds.delete(issueId);
    }
    // Orphan blocked queue rows for cleared/non-live issues must not inflate Watch.
    if (
      qState === "blocked"
      && liveIssueIds.has(issueId)
      && !resolvedIds.has(issueId)
      && !actNowIds.has(issueId)
      && !inMotionIds.has(issueId)
    ) {
      watchIds.add(issueId);
    }
  }
  const actNow = actNowIds.size;
  const watch = watchIds.size;
  const inMotion = inMotionIds.size;
  const cleared = resolved.length;
  return { actNow, watch, inMotion, cleared, allClear: actNow + watch + inMotion === 0 };
}

function growClass(count) {
  return "grow-" + Math.min(12, Math.max(0, count | 0));
}

function findingFromIssue(issue, kind) {
  const work = issueWorkState(issue);
  return {
    kind,
    id: issue.id,
    title: issue.title,
    work,
    impact: issueImpactLine(issue),
    progress: issueProgress(issue),
    pin: kind === "intervention" && work.key === "needs",
  };
}

function findingFromQueueItem(item) {
  const workKey = item.state === "running" ? "investigating"
    : item.state === "completed" ? "verifying"
    : item.state === "blocked" ? "blocked"
    : "queued";
  const work = WORK_STATE_VIEW[workKey === "investigating" ? "investigating"
    : workKey === "verifying" ? "verifying"
    : workKey === "blocked" ? "blocked"
    : "queued"];
  return {
    kind: "investigation",
    id: item.issueId,
    title: item.headline,
    work,
    impact: "Investigation " + (INVESTIGATION_STATE_LABELS[item.state] || item.state).toLowerCase(),
    progress: PROGRESS_BY_WORK[work.key] ?? 50,
    pin: false,
  };
}

function renderFindingRow(finding) {
  const visual = FINDING_VISUAL[finding.work.key] || FINDING_VISUAL.watching;
  const selected = state.selected && state.selected.kind === finding.kind && state.selected.id === finding.id;
  const open = () => selectEntity({ kind: finding.kind, id: finding.id });
  const stage = issueStage(finding.work.key);
  const stageName = STAGE_LABELS[stage - 1] || finding.work.label;
  const railClass = "stage-rail" + (visual.rail ? " " + visual.rail : "");
  return el("button", {
    type: "button",
    class: "finding" + (finding.pin ? " pin" : "") + (selected ? " is-selected" : ""),
    dataset: { fkey: "finding:" + finding.kind + ":" + finding.id },
    "aria-label": "Open " + finding.work.label + ": " + finding.title,
    onclick: open,
  },
    el("span", { class: "glyph " + visual.glyph, "aria-hidden": "true" }),
    el("span", { class: "copy" },
      el("span", { class: "title", text: finding.title }),
      el("span", { class: "impact", text: finding.impact })),
    el("span", {
      class: railClass,
      "aria-label": "Stage: " + stageName + " (" + stage + " of 4)",
      "data-stage": String(stage),
    }, el("i"), el("i"), el("i"), el("i")));
}

function renderLaneBody(body, findings, laneKey, emptyCopy) {
  body.textContent = "";
  if (!findings.length) {
    body.append(el("div", { class: "lane-empty" },
      el("strong", { text: emptyCopy.title }),
      emptyCopy.sub));
    return;
  }
  const expanded = !!state.laneExpanded[laneKey];
  const visible = expanded ? findings : findings.slice(0, MAX_LANE_ROWS);
  for (const finding of visible) body.append(renderFindingRow(finding));
  const more = findings.length - MAX_LANE_ROWS;
  if (more > 0) {
    body.append(el("button", {
      type: "button",
      class: "lane-more",
      dataset: { fkey: "lane-more:" + laneKey },
      onclick: () => toggleLane(laneKey),
      text: expanded ? "Show less" : ("+" + more + " more"),
    }));
  }
}

function renderAttentionBoard() {
  const board = $("attention-board");
  if (!board) return;

  const showHere = state.view === "now" || state.view === "needs-you";
  if (!showHere || !state.snap) {
    board.hidden = true;
    document.body.classList.remove("is-all-clear");
    board.classList.remove("is-all-clear");
    state.paintSig.attention = "hidden:" + state.view;
    return;
  }

  const issues = issuesOf(state.snap);
  // Act now = needs a human decision right now. In-motion findings (triage,
  // queue, investigation, verification underway) move to Be aware so the lane
  // never contradicts its own work-state chip ("Act now" + "Verifying").
  const issueFindings = issues.map((issue) =>
    findingFromIssue(issue, issue.severity === "error" ? "intervention" : "advisory"));
  const actFindings = issueFindings.filter((f) => f.kind === "intervention" && !IN_MOTION_KEYS.has(f.work.key));
  const inFlightFindings = issueFindings.filter((f) => IN_MOTION_KEYS.has(f.work.key));
  const watchFindings = issueFindings.filter((f) => f.kind === "advisory" && !IN_MOTION_KEYS.has(f.work.key));
  const recentlyResolved = recentlyResolvedOf(state.snap);
  const resolvedIds = new Set(recentlyResolved.map((issue) => issue.id));
  const issueIds = new Set(issues.map((issue) => issue.id));
  const orphanQueueFindings = state.queueItems
    .filter((item) => !issueIds.has(item.issueId) && !resolvedIds.has(item.issueId))
    .map(findingFromQueueItem);
  const awareFindings = [
    ...watchFindings,
    ...orphanQueueFindings.filter((f) => !IN_MOTION_KEYS.has(f.work.key)),
    ...inFlightFindings,
    ...orphanQueueFindings.filter((f) => IN_MOTION_KEYS.has(f.work.key)),
    ...recentlyResolved.map((issue) => findingFromIssue(issue, "resolved")),
  ];

  // Segments mirror lane membership exactly — the score is derived from what
  // the lanes actually render, so the conductor can never contradict them.
  let watchCount = 0;
  let inMotionCount = 0;
  for (const f of awareFindings) {
    if (f.kind === "resolved") continue;
    if (IN_MOTION_KEYS.has(f.work.key)) inMotionCount += 1;
    else watchCount += 1;
  }
  const counts = {
    actNow: actFindings.length,
    watch: watchCount,
    inMotion: inMotionCount,
    cleared: recentlyResolved.length,
    allClear: actFindings.length + watchCount + inMotionCount === 0,
  };
  const allClear = counts.allClear;
  const sig = [
    allClear ? "1" : "0",
    counts.actNow, counts.watch, counts.inMotion, counts.cleared,
    state.laneExpanded.act ? "1" : "0",
    state.laneExpanded.aware ? "1" : "0",
    actFindings.map(findingPaintKey).join("|"),
    awareFindings.map(findingPaintKey).join("|"),
  ].join("\u001f");
  if (paintUnchanged("attention", sig)) return;

  board.hidden = false;
  document.body.classList.toggle("is-all-clear", allClear);
  board.classList.toggle("is-all-clear", allClear);

  const score = $("score");
  const setSeg = (id, n) => {
    const seg = $(id);
    const label = $(id + "-n");
    const next = String(n);
    if (label && label.textContent !== next) label.textContent = next;
    if (!seg) return;
    seg.classList.toggle("zero", n === 0);
    const nextGrow = growClass(n === 0 ? 0 : Math.max(1, n));
    if (!seg.classList.contains(nextGrow)) {
      seg.classList.remove("grow-0", "grow-1", "grow-2", "grow-3", "grow-4", "grow-5", "grow-6", "grow-7", "grow-8", "grow-9", "grow-10", "grow-11", "grow-12");
      seg.classList.add(nextGrow);
    }
  };
  setSeg("seg-act", counts.actNow);
  setSeg("seg-watch", counts.watch);
  setSeg("seg-motion", counts.inMotion);
  setSeg("seg-clear", counts.cleared);
  if (score) score.classList.toggle("score-clear", allClear);

  const legend = $("score-legend");
  if (legend) {
    const needYou = counts.actNow === 1 ? "1 need you" : (counts.actNow + " need you");
    const watching = counts.watch === 1 ? "1 watching" : (counts.watch + " watching");
    const motion = counts.inMotion === 1 ? "1 in motion" : (counts.inMotion + " in motion");
    const cleared = counts.cleared === 1 ? "1 cleared" : (counts.cleared + " cleared");
    const nextLegend = needYou + " · " + watching + " · " + motion + " · " + cleared;
    if (legend.textContent !== nextLegend) legend.textContent = nextLegend;
    legend.hidden = allClear;
  }

  const lanes = $("lanes");
  const allclear = $("allclear");
  if (lanes) lanes.hidden = allClear;
  if (allclear) allclear.hidden = !allClear;

  if (!allClear) {
    const actCount = $("act-count");
    const awareCount = $("aware-count");
    if (actCount) actCount.textContent = actFindings.length ? (actFindings.length + " open") : "clear";
    if (awareCount) awareCount.textContent = awareFindings.length
      ? (awareFindings.length + (awareFindings.length === 1 ? " item" : " items"))
      : "clear";
    renderLaneBody($("act-body"), actFindings, "act", {
      title: "Nothing to act on",
      sub: "Errors that need you land here.",
    });
    renderLaneBody($("aware-body"), awareFindings, "aware", {
      title: "Quiet watch",
      sub: "Advisories, in-motion work, and recent clears.",
    });
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
    countNode.textContent = state.snap
      ? String(agents.filter((a) =>
          viewMatches(view, a) && (!lookbackApplies(view) || withinLookback(a, state.lookbackHours)),
        ).length)
      : "";
  }
  for (const btn of document.querySelectorAll("#views .view-tab")) {
    btn.setAttribute("aria-pressed", String(btn.dataset.view === state.view));
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

function filterChip(label, active, onclick, opts = {}) {
  return el("button", {
    type: "button",
    class: "filter-chip" + (active ? " is-active" : ""),
    "aria-pressed": String(Boolean(active)),
    disabled: opts.disabled ? "" : null,
    title: opts.title || null,
    onclick,
  }, label);
}

/* Lookback + scan-window controls for Idle/History; Usage range for Usage. */
function renderFilterBar() {
  const bar = $("filter-bar");
  if (!bar) return;
  bar.textContent = "";
  if (state.view === "usage") {
    bar.hidden = false;
    bar.setAttribute("aria-hidden", "false");
    bar.append(el("span", { class: "filter-lead", text: "Range" }));
    for (const preset of USAGE_RANGE_PRESETS) {
      bar.append(filterChip(preset.label, state.usageRangeId === preset.id, () => {
        state.usageRangeId = preset.id;
        state.usageCustomHours = preset.hours;
        void loadUsageData(true);
        render();
      }));
    }
    const customActive = state.usageRangeId === "custom";
    bar.append(filterChip(
      customActive ? ("Custom " + state.usageCustomHours + "h") : "Custom",
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
    ));
    return;
  }
  if (!lookbackApplies(state.view)) {
    bar.hidden = true;
    bar.setAttribute("aria-hidden", "true");
    return;
  }
  bar.hidden = false;
  bar.setAttribute("aria-hidden", "false");
  bar.append(el("span", { class: "filter-lead", text: "Lookback" }));
  for (const hours of LOOKBACK_PRESETS) {
    bar.append(filterChip(hours + "h", state.lookbackHours === hours, () => setLookbackHours(hours)));
  }
  bar.append(filterChip("All", state.lookbackHours == null, () => setLookbackHours(null), {
    title: "Show every session inside the collector scan window",
  }));
  const customActive = state.lookbackHours != null && !LOOKBACK_PRESETS.includes(state.lookbackHours);
  bar.append(filterChip(
    customActive ? ("Custom " + state.lookbackHours + "h") : "Custom",
    customActive,
    () => {
      const raw = window.prompt("Lookback hours", String(state.lookbackHours || DEFAULT_LOOKBACK_HOURS));
      if (raw == null) return;
      setLookbackHours(raw);
    },
  ));
  bar.append(el("span", { class: "filter-lead", text: "Scan" }));
  const scanHours = Number((state.snap && state.snap.scanWindowHours) || state.scanWindowHours) || 36;
  bar.append(filterChip(
    scanHours + "h window",
    false,
    () => {
      const raw = window.prompt("Collector scan window hours (1–168)", String(scanHours));
      if (raw == null) return;
      void postScanWindow(raw);
    },
    { disabled: state.settingsPending, title: "How far back collectors harvest sessions" },
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
  note.textContent = text;
}

/* ---------- program list ---------- */

function programOpen(program) {
  const override = state.programOverrides.get(program.id);
  if (override) return override === "open";
  if (state.view === "history") return false;
  const r = programRollup(program);
  return r.needsYou > 0 || r.working > 0;
}

function toggleProgram(program) {
  state.programOverrides.set(program.id, programOpen(program) ? "closed" : "open");
  saveOverrides();
  render();
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
  // Signature ignores live elapsed clocks — status/message/model/context drive paint.
  const sig = [
    state.view,
    state.query,
    state.facetProgram,
    state.facetProvider,
    state.lookbackHours,
    state.selecting ? "1" : "0",
    state.selected ? state.selected.kind + ":" + state.selected.id : "",
    [...state.selection].join(","),
    visible.map(({ program, agents }) =>
      program.id + ">" + agents.map((a) => [
        a.id,
        a.status,
        a.statusReason || "",
        a.model || "",
        contextDisplayValue(a.tokens) || "",
        rowSummary(a) || "",
        state.labels.get(presentationLabelKey(agentLabelTarget(a))) || "",
      ].join(":")).join(","),
    ).join("|"),
  ].join("\u001f");
  if (paintUnchanged("programs", sig)) {
    renderScopeNote(visible.reduce((n, row) => n + row.agents.length, 0));
    return;
  }

  root.textContent = "";
  let shown = 0;
  for (const { program, agents } of visible) {
    shown += agents.length;
    root.append(renderProgram(program, agents));
  }
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

function rollupParts(r) {
  const parts = [];
  if (r.needsYou) parts.push({ text: r.needsYou + (r.needsYou === 1 ? " alert" : " alerts"), hot: true });
  if (r.working) parts.push({ text: r.working + " working" });
  if (r.idle) parts.push({ text: r.idle + " idle" });
  if (r.ended) parts.push({ text: r.ended + " done" });
  if (!parts.length) parts.push({ text: r.total + " tracked" });
  return parts;
}

function renderProgram(program, agents) {
  const open = programOpen(program);
  const bodyId = "program-body-" + program.id;
  const r = deriveRollup(agents);

  const rollup = el("span", { class: "program-rollup" });
  rollupParts(r).forEach((part, i) => {
    if (i) rollup.append(" · ");
    rollup.append(part.hot ? el("span", { class: "hot", text: part.text }) : part.text);
  });

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
  section.append(el("div", { class: "program-agents", id: bodyId }, open ? renderAgentRows(program, agents) : null));
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
    el("button", { type: "submit", class: "btn primary", disabled: state.renamePending ? "" : null, "aria-busy": state.renamePending ? "true" : null }, state.renamePending ? "Saving…" : "Save"),
    el("button", { type: "button", class: "btn", disabled: state.renamePending ? "" : null, onclick: () => cancelRename() }, "Cancel"),
    state.aliases.has(key) ? el("button", { type: "button", class: "btn", disabled: state.renamePending ? "" : null, onclick: () => { state.renameDraft = ""; submitRename(target); } }, "Reset") : null,
    el("span", { class: "rename-source", text: opts.source }),
    state.renameError ? el("p", { class: "rename-error", role: "alert", text: state.renameError }) : null);
}

function renderAgentRows(program, agents) {
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
  const fullById = new Map(snapshotAgents(state.snap).map(({ agent }) => [agent.id, agent]));
  const fullChildren = new Map();
  for (const a of fullById.values()) {
    if (a.parentAgentId) fullChildren.set(a.parentAgentId, [...(fullChildren.get(a.parentAgentId) || []), a.id]);
  }
  const descendantCount = (id, seen = new Set()) => {
    if (seen.has(id)) return 0;
    seen.add(id);
    return (fullChildren.get(id) || []).reduce((total, childId) => total + 1 + descendantCount(childId, seen), 0);
  };

  const rows = [];
  const appendTree = (agent, depth) => {
    const visibleDescendants = (fullChildren.get(agent.id) || []).filter((id) => relevantIds.has(id)).length;
    rows.push(visibleIds.has(agent.id)
      ? renderAgentRow(agent, program, { depth, childCount: descendantCount(agent.id), fullById })
      : renderSwarmAnchor(agent, depth, visibleDescendants));
    for (const child of children.get(agent.id) || []) appendTree(child, depth + 1);
  };
  for (const agent of roots) appendTree(agent, 0);
  return [renderAgentColumnHeader(), ...rows];
}

function renderAgentColumnHeader() {
  return el("div", {
    class: "agent-grid agent-column-header",
    "aria-label": "Agent list columns",
  },
    el("span", { class: "agent-column-label", text: "Status" }),
    el("span", { class: "agent-column-label", text: "Agent/message" }),
    el("span", { class: "agent-column-label", text: "Model" }),
    el("span", { class: "agent-column-label", text: "Context" }),
    el("span", { class: "agent-column-label", text: "Access" }));
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

function rowFact(label, value, className = "") {
  return el("span", { class: "row-fact " + className, "aria-label": `${label}: ${value}`, title: String(value) },
    el("span", { class: "row-fact-value", text: value }));
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

function contextFact(agent) {
  const usage = contextUsage(agent.tokens);
  const value = contextDisplayValue(agent.tokens);
  const title = usage
    ? usage.text
    : hasObservedTotal(agent.tokens)
      ? "Context window size not reported by Claude; showing observed tokens."
      : "This source does not report observed context usage.";
  return el("span", {
    class: "row-fact fact-tokens fact-context" + (usage ? "" : " is-unknown"),
    "aria-label": `${contextDisplayLabel()}: ${value}`,
  },
    el("span", {
      class: "row-fact-value context-fact-value",
      title,
      text: value,
    }));
}

const CONTROL_ICONS = { linked: "linked", quarantined: "quarantine", "observed-only": "observed" };
const CONTROL_STATE_TEXT = { linked: "Ready", quarantined: "Quarantined", "observed-only": "View only" };

function controlFact(control) {
  const stateText = CONTROL_STATE_TEXT[control] || "View only";
  return el("span", {
    class: "row-fact fact-control control-" + control,
    "aria-label": "Access: " + stateText + ". " + CONTROL_HINTS[control],
  },
    el("span", { class: "control-access", title: stateText + " — " + CONTROL_HINTS[control] },
      el("span", { class: "control-icon" }, icon(CONTROL_ICONS[control] || "observed")),
      el("span", { class: "control-access-text", text: stateText })));
}

function renderAgentRow(agent, program, opts = {}) {
  const activity = deriveActivity(agent);
  const outcome = deriveOutcome(agent);
  const control = deriveControlState(agent);
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
  const customLabel = state.aliases.has(nameKey)
    || state.aliases.has(presentationLabelKey(agentLabelTarget(agent)));
  const sourceName = sourceAgentName(agent);
  const cwdMismatch = Boolean(agent.target && agent.target.cwdMismatch);

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
      cwdMismatch && terminal
        ? el("span", {
          class: "source-label is-mismatch",
          title: "This agent session cwd differs from the cmux pane folder. Title is the terminal; identity stays the session.",
          text: "terminal: " + terminal + " · cwd differs",
        })
        : customLabel && terminal
          ? el("span", { class: "source-label", title: "Live terminal / workspace title from cmux", text: "terminal: " + terminal })
          : customLabel
            ? el("span", { class: "source-label", title: "Provider source name", text: "source: " + sourceName })
            : terminal && terminal !== displayName
              ? el("span", { class: "source-label", title: "Live terminal / workspace title from cmux", text: "terminal: " + terminal })
              : null,
      role.key !== "agent" ? el("span", { class: "role-chip role-label role-" + role.key, text: role.label }) : null,
      policy && policy.state === "mismatch" ? el("span", { class: "policy-chip", title: policy.summary }, icon("warning"), "Model mismatch") : null,
      opts.childCount ? el("span", { class: "swarm-chip", title: opts.childCount + " subagents in this swarm", text: "swarm " + opts.childCount }) : null),
    description ? el("span", { class: "row-identity-tags row-summary row-description", title: "Latest human message or current status summary. Select for full details.", text: description }) : null);

  const line1 = el("span", { class: "agent-grid" },
    el("span", {
      class: "row-state state-" + activity + (outcome !== "healthy" ? " outcome-" + outcome : ""),
      title: stateText,
      "aria-label": "Status: " + stateText,
    },
      el("span", { class: "act-" + activity, text: ACTIVITY_LABELS[activity] }),
      outcome !== "healthy" ? el("span", { class: "row-state-alert", text: " · " + OUTCOME_LABELS[outcome] }) : null),
    identity,
    rowFact("Model", modelShort(agent.model) || "not reported", "fact-model"),
    contextFact(agent),
    controlFact(control));

  const rowClass = "agent-row provider-" + agent.provider +
    " role-" + role.key +
    (opts.depth > 0 ? " is-child depth-" + Math.min(opts.depth, 4) : "") +
    (opts.childCount ? " is-parent" : "") +
    (selected ? " is-selected" : "") +
    (outcome !== "healthy" ? " is-" + outcome : "") +
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
    "aria-current": selected ? "true" : null,
    "aria-pressed": state.selecting ? String(checked) : null,
    "aria-disabled": state.selecting && !eligible ? "true" : null,
    "aria-label": `${displayName}. Status: ${stateText}. Agent/message: ${summary || "No message reported"}. Model: ${modelShort(agent.model) || "Model not reported"}. Context: ${contextDisplayValue(agent.tokens)}. Access: ${CONTROL_STATE_TEXT[control] || "View only"}. ${opts.depth ? `Swarm depth ${opts.depth}. ` : ""}${opts.childCount ? `${opts.childCount} descendants. ` : ""}${state.selecting ? (eligible ? " Selectable for broadcast." : " Not available for broadcast.") : " Select to open the full message and session details in the inspector."}`,
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
  const queueItem = state.queueItems.find((item) => item.issueId === sel.id);
  const triage = state.triage.get(sel.id);
  const pending = [...state.triagePending].filter((key) => key.endsWith(":" + sel.id)).join(",");
  const issue = view && (view.issue || view.item);
  const sig = [
    sel.kind, sel.id,
    view ? view.kind : "missing",
    issue && issue.lifecycle ? issue.lifecycle.state : "",
    issue && issue.workState || "",
    issue && issue.progress != null ? String(issue.progress) : "",
    queueItem ? queueItem.state + ":" + (queueItem.result || "").slice(0, 80) : "",
    triage ? triage.generatedAt + ":" + triage.headline : "",
    pending,
    state.evidenceOpen ? "1" : "0",
  ].join("\u001f");
  if (paintUnchanged("inspector", sig)) {
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

function agentsById() {
  return new Map(snapshotAgents(state.snap).map(({ agent, program }) => [agent.id, { agent, program }]));
}

function drawerAccent(pane, kind) {
  pane.append(el("div", { class: "dw-accent dw-accent--" + kind, "aria-hidden": "true" }));
}

function dwEyebrow(kindClass, iconName, text) {
  return el("span", { class: "dw-eyebrow dw-eyebrow--" + kindClass }, iconName ? icon(iconName) : null, text);
}

function drawerHead(eyebrowNode, titleText) {
  return el("div", { class: "inspector-head" },
    el("div", { class: "inspector-id" }, eyebrowNode, el("h2", { class: "inspector-title", text: titleText })),
    closeButton());
}

const INVESTIGATION_STATE_LABELS = { running: "Running", completed: "Verifying", blocked: "Blocked", queued: "Queued" };

/* Impact summary — never dump hundreds of anonymous chips as "Affects (160)".
   Plain language first, program rollup second, optional short sample third. */
function affectedImpact(issue) {
  const ids = issue.affectedAgentIds || [];
  const byId = agentsById();
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
  pane.append(drawerHead(
    dwEyebrow("ember", "intervention", work.label),
    issue.title));
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
  pane.append(drawerHead(dwEyebrow("amber", "warning", "Advisory · " + work.label), issue.title));
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
  const stateLabel = INVESTIGATION_STATE_LABELS[item.state] || "Queued";
  drawerAccent(pane, "slate");
  pane.append(drawerHead(
    dwEyebrow("slate", "broadcast", "Investigation · " + stateLabel),
    item.headline));

  const status = el("div", { class: "dw-status" });
  if (running) status.append(el("span", { class: "dw-pulse", "aria-hidden": "true" }));
  status.append(el("span", { text:
    item.state === "running" ? "running · " + (item.runModel || "native Luna")
    : item.state === "completed" ? "complete · waiting for fresh data"
    : item.state === "blocked" ? "blocked · review result"
    : "queued and ready for explicit launch" }));
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
    pane.append(renderInvestigationResult(item.result, item.state === "blocked" ? "blocked" : "completed", { issueId: item.issueId }));
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
  pane.append(drawerHead(dwEyebrow("moss", "check", "Resolved"), issue.title));
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
  const r = deriveRollup(agents);
  drawerAccent(pane, "ink");
  pane.append(drawerHead(dwEyebrow("ink", null, "Program"), programName(program)));

  pane.append(el("div", { class: "dw-block" },
    el("div", { class: "dw-block-label", text: agents.length + (agents.length === 1 ? " agent" : " agents") }),
    svgSegmentMeter(programMeterSegments(agents), { label: "Program health rollup" }),
    el("p", { class: "dw-impact", text: rollupParts(r).map((p) => p.text).join(" · ") })));

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

  const terminal = terminalSourceName(agent);
  const hasCustomName = state.aliases.has(presentationLabelKey(preferredRenameTarget(agent)))
    || state.aliases.has(presentationLabelKey(agentLabelTarget(agent)));
  const cwdMismatch = Boolean(agent.target && agent.target.cwdMismatch);
  pane.append(el("div", { class: "inspector-head" },
    el("div", { class: "inspector-id" },
      el("h2", { class: "inspector-title", text: agentName(agent) }),
      cwdMismatch && terminal
        ? el("p", {
          class: "inspector-source-name is-mismatch",
          title: CWD_MISMATCH_HINT,
          text: "Terminal: " + terminal + " · session cwd ≠ pane folder",
        })
        : hasCustomName && terminal
          ? el("p", { class: "inspector-source-name", text: "Terminal: " + terminal })
          : hasCustomName
            ? el("p", { class: "inspector-source-name", text: "Source agent: " + sourceAgentName(agent) })
            : terminal && terminal !== agentName(agent)
              ? el("p", { class: "inspector-source-name", text: "Terminal: " + terminal })
              : null,
      el("p", { class: "inspector-sub" },
        el("span", { text: programName(program) }),
        " · ",
        el("span", { class: "chip provider-" + agent.provider },
          providerLabel(agent.provider) + (modelShort(agent.model) ? " · " + modelShort(agent.model) : ""))),
      renderStatusLine(agent, activity, outcome, control, policy)),
    closeButton()));

  const banner = renderControlBanner(agent, control);
  if (banner) pane.append(banner);

  pane.append(renderLineageSpine(agent));

  if (agent.nextAction) {
    pane.append(el("p", { class: "next-action" },
      el("span", { class: "next-key", text: "Next" }), " ", agent.nextAction));
  }

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

  const body = renderEvidence(agent);
  // Metrics live behind the disclosure, not in the showcase: the vitals
  // instrument band leads the Evidence column when it opens.
  const vitals = renderVitals(agent);
  if (vitals) body.prepend(vitals);
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

/* Quarantine / observed-only: one banner, not a disabled Focus card. */
function renderControlBanner(agent, control) {
  const focusCap = capability(agent, "focus");
  const instructCap = capability(agent, "instruct");
  const locked = [focusCap, instructCap].some((c) => c && !c.enabled);
  if (!locked) return null;

  return el("div", { class: "control-banner", role: "status" },
    icon(control === "quarantined" ? "quarantine" : "observed"),
    el("div", { class: "control-banner-copy" },
      el("strong", { text: control === "quarantined" ? "Control routing locked." : "Controls unavailable." }),
      " ",
      controlUnavailableText(control),
      " ",
      el("button", {
        type: "button",
        class: "control-banner-link",
        onclick: () => { state.evidenceOpen = true; render(); },
      }, "See routing evidence →")));
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

/* Sticky composer + quiet tools. Replaces the old Focus card and Danger zone. */
function renderCommandDock(agent, control = deriveControlState(agent)) {
  const focusCap = capability(agent, "focus");
  const instructCap = capability(agent, "instruct");
  const interruptCap = capability(agent, "interrupt");
  const archiveCap = capability(agent, "archive");
  if (!focusCap && !instructCap && !interruptCap && !archiveCap) {
    return el("span", { hidden: "" });
  }

  const safeLocked = [focusCap, instructCap].some((c) => c && !c.enabled);
  const linkedReady = !safeLocked && control === "linked";
  const dock = el("div", {
    class: "command-dock" + (linkedReady ? " command-dock--linked" : ""),
    "aria-label": "Session controls",
  });

  // One lock narrative: the control banner owns the reason. The dock meta only
  // speaks when the link is live, and the send hint only when Send can send.
  const showHint = Boolean(instructCap && instructCap.enabled);
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

  // Composer is the primary interaction — Focus no longer sits above a dead input.
  if (instructCap) {
    const key = agent.id + ":instruct";
    const busy = state.pending.has(key);
    const input = el("input", {
      type: "text",
      placeholder: instructCap.enabled
        ? "Instruct this agent…"
        : (control === "quarantined"
          ? "Resolve identity conflict to instruct…"
          : "Instruction unavailable"),
      disabled: instructCap.enabled ? null : "",
      value: state.drafts.get(agent.id) || "",
      "aria-label": "Instruction for " + agentName(agent),
      dataset: { fkey: "draft:" + agent.id },
      oninput: (e) => state.drafts.set(agent.id, e.target.value),
      onkeydown: (e) => {
        if (!(e.key === "Enter" && (e.metaKey || e.ctrlKey))) return;
        e.preventDefault();
        const text = (state.drafts.get(agent.id) || "").trim();
        if (!text || busy || !instructCap.enabled) return;
        sendControl(agent, "instruct", text);
      },
    });
    dock.append(el("form", {
      class: "command-composer",
      onsubmit: (e) => {
        e.preventDefault();
        const text = (state.drafts.get(agent.id) || "").trim();
        if (!text || busy || !instructCap.enabled) return;
        sendControl(agent, "instruct", text);
      },
    },
      input,
      el("button", {
        type: "submit", class: "btn primary command-send",
        disabled: instructCap.enabled && !busy ? null : "",
        "aria-busy": busy ? "true" : null,
        dataset: { fkey: "act:" + key },
      }, busy ? "Sending…" : "Send")));
  }

  const tools = el("div", { class: "command-dock-tools" });
  if (focusCap) tools.append(renderDockTool(agent, focusCap, "focus"));
  if (interruptCap) tools.append(renderDockTool(agent, interruptCap, "interrupt"));
  tools.append(el("span", { class: "command-dock-spacer" }));
  // When Send/Focus are locked, Archive is the wrong lever — tuck it away so
  // the dock does not offer a destructive peer next to dead controls.
  if (archiveCap && !safeLocked) tools.append(renderDockTool(agent, archiveCap, "archive"));
  dock.append(tools);
  if (archiveCap && safeLocked) {
    dock.append(el("details", { class: "command-dock-more" },
      el("summary", { text: "More" }),
      renderDockTool(agent, archiveCap, "archive")));
  }

  // Plain-language lock copy also lives in the banner; dock meta stays short.
  // Tests assert controlUnavailableText is used for unavailable safe controls.
  if (safeLocked) {
    dock.append(el("p", { class: "visually-hidden",
      text: controlUnavailableText(deriveControlState(agent)) }));
  }

  return dock;
}

function renderDockTool(agent, cap, action) {
  const key = agent.id + ":" + action;
  const busy = state.pending.has(key);
  const label = ACTION_LABELS[action] || action;
  const isArchive = action === "archive";

  if (state.confirming === key) {
    return el("span", { class: "confirm-strip command-confirm", role: "group",
      "aria-label": label + " " + agentName(agent) + "?" },
      el("span", { text: label + "?" }),
      el("button", {
        type: "button", class: "btn confirm-yes",
        dataset: { fkey: "confirm:" + key },
        onclick: () => { state.confirming = null; sendControl(agent, action); },
      }, "Confirm"),
      el("button", {
        type: "button", class: "btn sm",
        onclick: () => { state.confirming = null; render(); },
      }, "Cancel"));
  }

  return el("button", {
    type: "button",
    class: "dock-tool" + (isArchive ? " dock-tool-warn" : ""),
    disabled: cap.enabled && !busy ? null : "",
    "aria-busy": busy ? "true" : null,
    title: cap.enabled ? (action === "focus" ? "Jump to terminal pane" : label) : "Unavailable",
    dataset: { fkey: "act:" + key },
    onclick: () => {
      if (NEEDS_CONFIRM.has(action)) {
        state.confirming = key;
        render();
        const btn = document.querySelector(`[data-fkey="${CSS.escape("confirm:" + key)}"]`);
        if (btn) btn.focus();
        return;
      }
      sendControl(agent, action);
    },
  },
    icon(action === "focus" ? "focus" : action === "interrupt" ? "interrupt" : "archive"),
    busy ? label + "…" : label);
}

/* Kept as a thin alias so source-level tests that look for the primary-actions
   contract still find controlUnavailableText wired through the dock path. */
function renderPrimaryActions(agent) {
  return renderCommandDock(agent, deriveControlState(agent));
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

/* Kept as a thin alias so source-level rename contracts still resolve. */
function renderPresentationLabels(agent) {
  return renderNamesDisclosure(agent) || el("span", { hidden: "" });
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
   context ring, session spend + cache efficiency, uptime) instead of a grey meta
   row. Every tile self-guards; if nothing has data the band renders nothing. */
function renderVitals(agent) {
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
  // Uptime, token, and context figures now lead the Operate tab in the vitals
  // instrument band (renderVitals). This meta row stays identity-only.
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

  // Vitals moved behind the Evidence disclosure (renderEvidenceShelf) — Operate
  // stays a calm digest so Chat + Operate can showcase side by side.
  const meta = renderOperateMeta(agent);
  if (meta) panel.append(meta);
  if (!panel.childNodes.length) {
    panel.append(el("p", { class: "inspector-note", text: "No operate digest yet for this session." }));
  }
  return panel;
}

/* renderSwarmSection is superseded by renderLineageSpine in the Agent drawer
   (P4), but it MUST stay defined immediately after renderOperate: a test
   asserts the renderOperate…renderSwarmSection source adjacency. Do not
   reorder or delete it. */
function renderSwarmSection(agent, program) {
  const fullById = new Map(snapshotAgents(state.snap).map(({ agent: a }) => [a.id, a]));
  const children = [...fullById.values()].filter((a) => a.parentAgentId === agent.id);
  const parent = agent.parentAgentId ? fullById.get(agent.parentAgentId) : null;
  if (!parent && !children.length && !agent.parentAgentId) return el("span", { hidden: "" });

  const wrap = el("div", { class: "swarm-section" },
    el("h3", { class: "section-title", text: "Swarm" }));

  if (agent.parentAgentId) {
    wrap.append(parent
      ? el("button", {
          type: "button", class: "swarm-link",
          dataset: { fkey: "swarm:" + parent.id },
          onclick: () => selectAgent(parent.id),
        }, "↖ Orchestrator: " + agentName(parent))
      : el("p", { class: "absent", text: "Orchestrator session is not tracked in this snapshot." }));
  }

  for (const child of children) {
    const act = deriveActivity(child);
    wrap.append(el("button", {
      type: "button", class: "swarm-link",
      dataset: { fkey: "swarm:" + child.id },
      onclick: () => selectAgent(child.id),
    },
      el("span", { class: "act-glyph act-" + act, "aria-hidden": "true" }),
      agentName(child) + " — " + ACTIVITY_LABELS[act]));
  }
  return wrap;
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

function renderEvidence(agent) {
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

  if (!panel.childNodes.length) {
    panel.append(el("p", { class: "inspector-note", text: "No evidence fields reported for this session." }));
  }
  return panel;
}

/* Legacy alias — Evidence replaced Technical; keep the name discoverable in grep. */
function renderTechnical(agent) {
  return renderEvidence(agent);
}

function renderTarget(target) {
  return renderControlLink(target);
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
    const res = await fetch("/api/control", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, agentId: agent.id, instruction }),
    });
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
}

/* ---------- presentation labels (source identities stay authoritative) ---------- */

async function fetchLabels() {
  state.labelsLoading = true;
  state.labelLoadError = "";
  try {
    const res = await fetch("/api/program-aliases", { headers: { accept: "application/json" } });
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
    const res = await fetch("/api/program-aliases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, label }),
    });
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
    const res = await fetch("/api/broadcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentIds: eligible.map(({ agent }) => agent.id), instruction }),
    });
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
  }
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

/* Broadcast dock — appears only in selection mode. Recipients are previewed
   honestly: eligible (live + instruct-capable) vs unavailable, and per-recipient
   results after send are never smoothed over. */
function renderBroadcastBar() {
  const bar = $("broadcast-bar");
  bar.textContent = "";
  if (!state.selecting) { bar.hidden = true; return; }
  bar.hidden = false;

  const recipients = selectedRecipients();
  const eligible = recipients.filter(({ agent }) => broadcastEligible(agent));
  const results = state.broadcastResults;

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
          : el("span", { class: "rc-state", text: ok ? "ready" : "unavailable" })));
    }
    bar.append(list);
  } else {
    bar.append(el("p", { class: "broadcast-note", text: "Pick agents from the list, or use “Select eligible” on a program header. Only live, instruct-capable sessions can receive a broadcast." }));
  }

  const instruction = state.broadcastDraft;
  if (state.broadcastConfirming) {
    bar.append(el("div", { class: "broadcast-confirm", role: "group", "aria-label": "Confirm broadcast" },
      el("span", { text: `Send this instruction to ${eligible.length} ${eligible.length === 1 ? "agent" : "agents"}?` }),
      el("button", { type: "button", class: "btn primary", disabled: state.broadcastPending ? "" : null, "aria-busy": state.broadcastPending ? "true" : null, dataset: { fkey: "broadcast-confirm" }, onclick: () => sendBroadcast() }, state.broadcastPending ? "Sending…" : `Confirm broadcast`),
      el("button", { type: "button", class: "btn", disabled: state.broadcastPending ? "" : null, onclick: () => { state.broadcastConfirming = false; render(); } }, "Cancel")));
  } else {
    const canSend = eligible.length > 0 && instruction.trim().length > 0;
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

function renderEmpty() {
  const empty = $("empty-state");
  const retry = $("empty-retry");
  const hasAgents = state.snap && state.snap.programs.some((p) => p.agents.length);
  if (hasAgents) { empty.hidden = true; return; }

  empty.hidden = false;
  if (!state.snap) {
    $("empty-message").textContent = "Can't reach the Ant Hill server.";
    $("empty-hint").textContent = "Check that the v3 server is running on 127.0.0.1:4701, then retry.";
    retry.hidden = false;
  } else {
    $("empty-message").textContent = "The ant hill is still — no tracked agents.";
    $("empty-hint").textContent = "Agents appear here as soon as a collector reports a session.";
    retry.hidden = true;
  }
}

function tickClocks() {
  for (const node of document.querySelectorAll("[data-elapsed-base]")) {
    const base = Number(node.dataset.elapsedBase);
    const drift = Date.now() - Date.parse(node.dataset.elapsedFrom);
    if (Number.isFinite(base) && Number.isFinite(drift)) {
      node.textContent = fmtElapsed(base + Math.max(0, drift));
    }
  }
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
      fetch("/api/usage/summary?" + q),
      fetch("/api/usage/series?" + q + "&bucket=" + bucket),
      fetch("/api/usage/ward?" + q),
      fetch("/api/usage/invocations?" + q + "&limit=40"),
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

function renderUsageSeriesChart(points) {
  const wrap = el("div", { class: "usage-series" });
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
    rect.setAttribute("title", bucket + " · " + fmtTok(tokens) + " tokens");
    svg.append(rect);
  });
  wrap.append(svg);
  const providers = [...new Set(points.map((point) => point.provider))].slice(0, 8);
  if (providers.length) {
    wrap.append(el("p", { class: "usage-series-legend", text: "Providers: " + providers.join(" · ") }));
  }
  return wrap;
}

function renderUsagePanel() {
  const root = $("usage-panel");
  if (!root) return;
  root.textContent = "";
  if (state.usageLoading && !state.usageSummary) {
    root.append(el("p", { class: "usage-empty", text: "Loading BurnBar usage…" }));
    return;
  }
  const summary = state.usageSummary;
  if (!summary || summary.available === false) {
    root.append(el("div", { class: "usage-unavailable" },
      el("h2", { class: "usage-title", text: "Usage unavailable" }),
      el("p", {
        text: (summary && summary.error) || state.usageError ||
          "BurnBar database could not be unlocked. Quotas sidecar may still be readable separately.",
      }),
      el("button", {
        type: "button", class: "btn",
        onclick: () => void loadUsageData(true),
      }, "Retry")));
    // Still show quotas/ward soft data if present without inventing spend zeros.
    if (state.usageWard && state.usageWard.quotaPressure && state.usageWard.quotaPressure.length) {
      root.append(renderUsageWard(state.usageWard, true));
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
    renderUsageSeriesChart(state.usageSeries && state.usageSeries.points)));

  root.append(renderUsageWard(state.usageWard, false));

  const table = el("table", { class: "usage-table" });
  table.append(el("thead", {}, el("tr", {},
    el("th", { text: "When" }),
    el("th", { text: "Provider" }),
    el("th", { text: "Model" }),
    el("th", { text: "Tokens" }),
    el("th", { text: "Cost" }),
    el("th", { text: "Session" }))));
  const body = el("tbody");
  const rows = (state.usageInvocations && state.usageInvocations.invocations) || [];
  if (!rows.length) {
    body.append(el("tr", {}, el("td", { colspan: "6", text: "No invocations in this range." })));
  } else {
    for (const row of rows) {
      const agentId = agentIdForSession(row.sessionId);
      const sessionCell = agentId
        ? el("button", {
          type: "button", class: "linkish",
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
        el("td", { text: row.tokens == null ? "—" : fmtTok(row.tokens) }),
        el("td", { text: row.costUsd == null ? "—" : fmtUsd(row.costUsd) }),
        el("td", {}, sessionCell)));
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

/* ---------- boot ---------- */

function boot() {
  loadOverrides();
  loadWidgetPreferences();
  loadLookback();
  void fetchSettings();

  $("search").addEventListener("input", (e) => {
    state.query = e.target.value.trim().toLowerCase();
    render();
  });

  $("views").addEventListener("click", (e) => {
    const btn = e.target.closest(".view-tab");
    if (btn && btn.dataset.view) setView(btn.dataset.view);
  });

  $("select-toggle").addEventListener("click", () => enterSelectMode(!state.selecting));

  $("customize-summary").addEventListener("click", () => {
    state.widgetCustomizerOpen = !state.widgetCustomizerOpen;
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

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (state.confirming) {
      const key = state.confirming;
      state.confirming = null;
      render();
      const origin = document.querySelector(`[data-fkey="${CSS.escape("act:" + key)}"]`);
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

  setInterval(() => {
    if (
      es && es.readyState === EventSource.OPEN &&
      state.conn === "live" &&
      state.lastEventAt && Date.now() - state.lastEventAt > STALE_AFTER_MS
    ) {
      setConn("stale");
    }
    tickClocks();
    void fetchTriageQueue();
  }, 5000);

  fetchSnapshot();
  fetchLabels();
  fetchTriageQueue();
  connect();
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  boot();
}
