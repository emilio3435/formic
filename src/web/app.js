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
  ["opus", "opus"], ["sonnet", "sonnet"], ["haiku", "haiku"],
];
function modelShort(m) {
  if (!m) return null;
  const low = m.toLowerCase();
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
   focus). Definitions stay jargon-free — this is the human layer over the raw
   Technical evidence, so a first-time operator can read the drawer unaided. */
const TOKENS_HINT = "Token counts for the most recent model call. “measured” = reported by the provider; “estimated” = inferred.";
const GLOSSARY = {
  // Overview
  "running for": "Wall-clock time since this agent started running.",
  context: "How big the latest model call is against the model's context window.",
  cost: "Estimated spend on this agent so far. “measured” = billed by the provider; “estimated” = inferred.",
  // Technical
  "session id": "The provider's own ID for this session, prefixed by the provider name.",
  "working directory": "The folder on disk this agent is running in.",
  status: "The raw run status reported by the provider, with its reason.",
  model: "The model this agent is currently running on.",
  "reasoning effort": "How hard the model is set to think per step — higher effort means more reasoning.",
  "nesting level": "How deep this agent sits in the orchestrator → subagent tree. 0 is top-level.",
  "orchestrator id": "ID of the agent that spawned this one, if any.",
  subagents: "How many child agents this one has spawned.",
  "session total": "Total tokens used across this whole session so far.",
  "context window": "The model's maximum context size — how much it can hold at once.",
  "model policy": "Whether the running model matches the model this lane is supposed to use.",
  git: "The branch and commit the agent's working copy is on; flags uncommitted changes.",
  tests: "The latest test-run result this agent reported.",
  checks: "Named pre-ship gates this agent must pass — e.g. typecheck or lint.",
  "control link": "Which cmux workspace/pane this session is wired to for Focus and Send, and how confidently it was matched.",
  "available controls": "Which operator actions are turned on for this agent, and why any are off.",
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

/* Plain-language control explanation for the Overview. Never echoes capability
   reasons here — live reasons carry raw cmux/session IDs, which belong only in
   the Technical routing evidence. */
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

const sourceAgentName = (agent) => conciseText(agent.nickname || agent.displayName || agent.task || providerLabel(agent.provider) + " agent");

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
const agentLabelEligible = (agent) => Boolean(agent && agent.parentAgentId && !agent.nickname);

function agentName(agent) {
  const label = agent && state.aliases.get(presentationLabelKey(agentLabelTarget(agent)));
  return label && agentLabelEligible(agent) ? label : sourceAgentName(agent);
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
   such. Cumulative session usage (tokens.sessionTotal) belongs only in
   Technical details. Sources that report nothing stay "not reported". */

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

function contextDisplayValue(tokens, display = state.contextDisplay) {
  const usage = contextUsage(tokens);
  if (!usage) return "not reported";
  return display === "tokens"
    ? fmtTok(tokens.total) + " / " + fmtTok(tokens.contextWindow)
    : usage.pct + "%";
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
    return {
      value: status.label,
      unit: "",
      sublabel: !snap
        ? (conn === "offline" ? "Snapshot connection unavailable." : "Waiting for the first snapshot.")
        : status.key === "operational" ? "Sources and controls healthy."
          : conn !== "live" ? "Live snapshot feed is not healthy."
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

const SIGNAL_PANEL_STORAGE_KEY = "mtn3-signal-panels";
const SIGNAL_PANEL_KEYS = ["interventions", "advisories"];
// Calm control-room defaults: interventions keep their full act-now detail open,
// advisories ride the compact live ticker until an operator expands them.
const SIGNAL_PANEL_DEFAULTS = { interventions: "open", advisories: "compact" };
// Below this item count the ticker stays a still instrument strip; at or above,
// the stepped right→left pull engages so a busy strip reads as motion, not spam.
const TICKER_SCROLL_MIN = 4;

function defaultSignalPanels() {
  return { ...SIGNAL_PANEL_DEFAULTS };
}

function parseSignalPanels(raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object") return defaultSignalPanels();
    const next = defaultSignalPanels();
    for (const key of SIGNAL_PANEL_KEYS) {
      if (parsed[key] === "compact" || parsed[key] === "open") next[key] = parsed[key];
    }
    return next;
  } catch {
    return defaultSignalPanels();
  }
}

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
  ACTIVITY_LABELS, OUTCOME_LABELS, CONTROL_LABELS, VIEWS, OPS_VIEWS,
  withinLookback, parseLookbackHours, lookbackApplies, lookbackLabel,
  DEFAULT_LOOKBACK_HOURS, LOOKBACK_PRESETS,
  broadcastEligible,
  WIDGET_STORAGE_KEY, DEFAULT_WIDGET_IDS, WIDGET_CATALOG,
  normalizeWidgetIds, parseWidgetPreference, reorderWidgetIds,
  SIGNAL_PANEL_STORAGE_KEY, parseSignalPanels,
  systemStatus, attentionSummary, summaryWidgetData, topSourceIssue,
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
  inspectorTab: "overview", // overview | technical
  drafts: new Map(),      // agentId -> instruct draft text
  confirming: null,       // `${agentId}:${action}`
  pending: new Set(),     // `${agentId}:${action}`
  feedback: new Map(),    // agentId -> { ok, action, message }
  triage: new Map(),      // issueId -> recommendation
  triagePending: new Set(),
  triageErrors: new Map(),
  queueItems: [],
  // Each signal section is either "open" (full detail list) or "compact" (the
  // live ticker strip). The caret on the section title flips it; the preference
  // persists. Solved findings leave the active lists via source lifecycle, so a
  // compact ticker never keeps a cleared id.
  signalPanels: defaultSignalPanels(), // open | compact
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

function loadSignalPanels() {
  try {
    state.signalPanels = parseSignalPanels(localStorage.getItem(SIGNAL_PANEL_STORAGE_KEY));
  } catch {
    state.signalPanels = defaultSignalPanels();
  }
}

function saveSignalPanels() {
  try {
    localStorage.setItem(SIGNAL_PANEL_STORAGE_KEY, JSON.stringify(state.signalPanels));
  } catch { /* storage unavailable */ }
}

function setSignalPanel(panel, mode) {
  if (!SIGNAL_PANEL_KEYS.includes(panel)) return;
  if (mode !== "open" && mode !== "compact") return;
  if (state.signalPanels[panel] === mode) return;
  state.signalPanels[panel] = mode;
  saveSignalPanels();
  renderIssues();
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
  renderIssues();
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
    renderIssues();
  } catch (err) {
    console.warn("triage queue fetch failed:", err);
  }
}

async function triageIssue(issueId, action) {
  const key = action + ":" + issueId;
  if (state.triagePending.has(key)) return;
  state.triagePending.add(key);
  state.triageErrors.delete(issueId);
  renderIssues();
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
  } catch (err) {
    state.triageErrors.set(issueId, err && err.message ? err.message : "Triage request failed");
  } finally {
    state.triagePending.delete(key);
    render();
  }
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
    }, generating ? "Analyzing…" : "Generate triage"));
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
            : queueItem.state === "completed" ? "Investigation complete · source confirmation pending"
            : queueItem.state === "blocked" ? "Investigation blocked · review result"
            : "Queued and ready for explicit launch"
          : "Queues a bounded investigation. Launch remains a separate operator action." })));
      if (queueItem && queueItem.result) {
        plan.append(el("details", { class: "triage-result" },
          el("summary", { text: queueItem.state === "completed" ? "Investigation result" : "Blocked investigation result" }),
          el("pre", { text: queueItem.result })));
      }
    }
    wrap.append(plan);
  }
  if (error) wrap.append(el("p", { class: "triage-error", role: "alert", text: error + " — retry the triage action." }));
  return wrap;
}

/* Interventions (act now) and advisories (be aware) are separate information
   classes with distinct visual weight — never one repetitive card stack. */
function renderSignalPanelHead(panel, count, compact) {
  const sectionId = panel === "interventions" ? "interventions" : "warnings";
  const countNode = $(sectionId === "interventions" ? "interventions-count" : "warnings-count");
  const collapse = $(sectionId === "interventions" ? "interventions-collapse" : "warnings-collapse");
  const section = $(sectionId);
  if (!countNode || !collapse || !section) return;

  countNode.textContent = count ? String(count) : "";
  countNode.hidden = !count;

  // The section title doubles as the collapse caret — no "Subdue" chrome. Open
  // shows the full detail list; compact hands the section to the live ticker.
  collapse.hidden = !count;
  collapse.setAttribute("aria-expanded", compact ? "false" : "true");
  collapse.setAttribute(
    "aria-label",
    (compact ? "Expand " : "Collapse ") + (panel === "interventions" ? "interventions to detail" : "advisories to detail"),
  );
  collapse.onclick = () => setSignalPanel(panel, compact ? "open" : "compact");
  section.classList.toggle("is-compact", compact && count > 0);
}

/* The compact state is a clipped instrument strip: mono glyph + short label per
   signal, staggered left→right, that opens the same drawer on click. When the
   strip overflows (many signals) a stepped right→left pull engages via CSS
   keyframes; prefers-reduced-motion holds it still. */
function tickerItem(entry, index) {
  const node = el("button", {
    type: "button",
    class: "signal-tick tone-" + entry.tone,
    dataset: { fkey: "tick:" + entry.kind + ":" + entry.id, tickStep: String(index % 6) },
    "aria-label": entry.aria,
    onclick: () => selectEntity({ kind: entry.kind, id: entry.id }),
  },
    el("span", { class: "signal-tick-glyph" }, icon(entry.glyph, { label: entry.glyphLabel })),
    el("span", { class: "signal-tick-label", text: entry.label }));
  return node;
}

function buildSignalTicker(container, entries) {
  if (!container) return;
  container.textContent = "";
  if (!entries.length) {
    container.hidden = true;
    container.classList.remove("is-scrolling");
    return;
  }
  container.hidden = false;
  const track = el("div", { class: "signal-tick-track" });
  const primary = el("div", { class: "signal-tick-group" });
  entries.forEach((entry, i) => primary.append(tickerItem(entry, i)));
  track.append(primary);

  const scrolling = entries.length >= TICKER_SCROLL_MIN;
  if (scrolling) {
    // A second, aria-hidden copy makes the -50% translate loop seamless without
    // any inline style. The tail copy stays mouse-clickable so a moving signal
    // is never a dead target.
    const tail = el("div", { class: "signal-tick-group", "aria-hidden": "true" });
    entries.forEach((entry, i) => tail.append(tickerItem(entry, i)));
    track.append(tail);
  }
  container.classList.toggle("is-scrolling", scrolling);
  container.append(track);
}

function interventionTickerEntry(issue) {
  const lifecycle = issueLifecycle(issue);
  const tone = lifecycle.state === "blocked" ? "error" : lifecycle.state === "verifying" ? "warn" : "error";
  return {
    kind: "intervention", id: issue.id, glyph: "intervention", glyphLabel: "Intervention",
    tone, label: issue.title, aria: "Open intervention: " + issue.title,
  };
}

function advisoryTickerEntries(advisories, recentlyResolved, queuedOnly) {
  const entries = [];
  for (const issue of advisories) {
    entries.push({
      kind: "advisory", id: issue.id, glyph: "warning", glyphLabel: "Advisory",
      tone: "warn", label: issue.title, aria: "Open advisory: " + issue.title,
    });
  }
  for (const issue of recentlyResolved) {
    entries.push({
      kind: "resolved", id: issue.id, glyph: "check", glyphLabel: "Resolved",
      tone: "moss", label: issue.title, aria: "Open resolved finding: " + issue.title,
    });
  }
  for (const item of queuedOnly) {
    entries.push({
      kind: "investigation", id: item.issueId, glyph: "broadcast", glyphLabel: "Investigation",
      tone: "info", label: item.headline, aria: "Open investigation: " + item.headline,
    });
  }
  return entries;
}

function renderIssues() {
  const iSection = $("interventions");
  const iList = $("interventions-list");
  const wSection = $("warnings");
  const wList = $("warnings-list");
  const showHere = state.view === "now" || state.view === "needs-you";
  const issues = showHere ? issuesOf(state.snap) : [];
  const interventions = issues.filter((i) => i.severity === "error");
  const advisories = issues.filter((i) => i.severity !== "error");
  // Solved findings leave the active issue set via source lifecycle and only
  // linger briefly in recentlyResolved (server TTL). They never stay as act-now.
  const recentlyResolved = state.view === "now" ? recentlyResolvedOf(state.snap) : [];
  const resolvedIds = new Set(recentlyResolved.map((issue) => issue.id));
  const queuedOnly = showHere
    ? state.queueItems.filter((item) => !issues.some((issue) => issue.id === item.issueId) && !resolvedIds.has(item.issueId))
    : [];
  const byId = new Map(snapshotAgents(state.snap).map(({ agent, program }) => [agent.id, { agent, program }]));
  const interventionsCompact = state.signalPanels.interventions === "compact";
  const advisoriesCompact = state.signalPanels.advisories === "compact";
  const advisoryTotal = advisories.length + recentlyResolved.length + queuedOnly.length;
  const iTicker = $("interventions-ticker");
  const wTicker = $("warnings-ticker");

  // Open renders the full detail list; compact hands the section to the ticker.
  iList.textContent = "";
  if (!interventionsCompact) {
    for (const issue of interventions) iList.append(renderIntervention(issue, byId));
  }
  iList.hidden = interventionsCompact || interventions.length === 0;
  buildSignalTicker(
    iTicker,
    interventionsCompact ? interventions.map(interventionTickerEntry) : [],
  );
  iSection.hidden = interventions.length === 0;
  renderSignalPanelHead("interventions", interventions.length, interventionsCompact);

  wList.textContent = "";
  if (!advisoriesCompact) {
    for (const issue of advisories) wList.append(renderAdvisory(issue, byId));
    for (const issue of recentlyResolved) wList.append(renderRecentlyResolved(issue));
    for (const item of queuedOnly) wList.append(renderInvestigationItem(item));
  }
  wList.hidden = advisoriesCompact || advisoryTotal === 0;
  buildSignalTicker(
    wTicker,
    advisoriesCompact ? advisoryTickerEntries(advisories, recentlyResolved, queuedOnly) : [],
  );
  wSection.hidden = advisoryTotal === 0;
  renderSignalPanelHead("advisories", advisoryTotal, advisoriesCompact);
}

// Thin trigger only — the triage flow, affected chips, and technical detail now
// live in the Intervention drawer. The band says what and how bad, and opens it.
/* Reconciled band + drawer: the open intervention is a full-width act-now band
   whose title/evidence open the per-type intervention drawer for depth, while a
   primary action (Generate triage) stays inline so the operator can act without
   leaving the canvas. Advisories/resolved/investigations remain thin triggers. */
function renderIntervention(issue, byId) {
  const generated = state.triage.has(issue.id);
  const lifecycle = issueLifecycle(issue);
  const affectedCount = (issue.affectedAgentIds || []).length;
  const selected = state.selected && state.selected.kind === "intervention" && state.selected.id === issue.id;
  const open = () => selectEntity({ kind: "intervention", id: issue.id });

  // Row one: mark, one-glance copy (title opens the drawer), and the primary
  // action. The compact Generate triage acts in place; once a plan exists the
  // slot becomes a Review link into the drawer where the full plan lives.
  const primary = el("div", { class: "signal-primary" },
    el("span", { class: "signal-badge" }, icon("intervention", { label: "Intervention" })),
    el("div", { class: "signal-copy" },
      el("span", { class: "signal-kicker", text: lifecycle.state === "open" ? "Open · act now" : issueStateLabel(issue) + " · source confirmation" }),
      el("h3", { class: "signal-title" },
        el("button", {
          type: "button", class: "signal-title-btn",
          dataset: { fkey: "issue:" + issue.id },
          "aria-label": "Open intervention detail: " + issue.title,
          onclick: open,
        }, issue.title)),
      el("p", { class: "signal-consequence", text: issue.summary })),
    el("div", { class: "signal-action" },
      generated
        ? el("button", { type: "button", class: "signal-open-detail", dataset: { fkey: "issue-detail:" + issue.id }, onclick: open }, "Review triage ▸")
        : renderTriage(issue)));

  // Row two: compact source evidence — affected count and Technical open the
  // drawer; the opened timestamp is inline.
  const evidence = el("div", { class: "signal-evidence" });
  if (affectedCount) {
    evidence.append(el("button", {
      type: "button", class: "signal-evi-open",
      dataset: { fkey: "issue-affected:" + issue.id }, onclick: open,
    }, `${affectedCount} affected ▸`));
  }
  if (lifecycle.openedAt) evidence.append(el("span", { class: "signal-evi", text: "Opened " + issueTimestamp(lifecycle.openedAt) }));
  if (issue.technicalDetails && issue.technicalDetails.length) {
    evidence.append(el("button", {
      type: "button", class: "signal-evi-open",
      dataset: { fkey: "issue-tech:" + issue.id }, onclick: open,
    }, "Technical ▸"));
  }

  const item = el("li", { class: "signal-intervention sev-" + issue.severity + " issue-state-" + lifecycle.state + (generated ? " has-triage" : "") + (selected ? " is-selected" : "") }, primary);
  if (evidence.childNodes.length) item.append(evidence);
  return item;
}

function renderAdvisory(issue, byId) {
  const affected = issue.affectedAgentIds.map((id) => byId.get(id)).filter(Boolean);
  const lifecycle = issueLifecycle(issue);
  const lifecycleNote = issueLifecycleNote(issue);
  const titleNode = el("button", {
    type: "button", class: "advisory-title",
    dataset: { fkey: `issue:${issue.id}` },
    onclick: () => selectEntity({ kind: "advisory", id: issue.id }),
    text: issue.title,
  });
  return el("li", { class: "signal-advisory" },
    icon("warning", { class: "warn-tri", label: "Advisory" }),
    el("div", { class: "advisory-body" },
      titleNode,
      issue.summary ? el("div", { class: "advisory-summary", text: issue.summary }) : null,
      lifecycleNote ? el("div", { class: "advisory-lifecycle", text: lifecycleNote }) : null),
    el("span", { class: "advisory-impact", text: `${issueStateLabel(issue)} · ${affected.length ? `${affected.length} affected` : "system"}` }));
}

// Thin trigger — the before/after and recovered agents now live in the Resolved
// drawer. The row shows what cleared and opens it.
function renderRecentlyResolved(issue) {
  const selected = state.selected && state.selected.kind === "resolved" && state.selected.id === issue.id;
  const open = () => selectEntity({ kind: "resolved", id: issue.id });
  return el("li", {
    class: "signal-advisory issue-resolved signal-trigger" + (selected ? " is-selected" : ""),
    role: "button", tabindex: "0",
    "aria-label": "Open resolved finding: " + issue.title,
    dataset: { fkey: "resolved:" + issue.id },
    onclick: open,
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } },
  },
    icon("check", { class: "warn-tri", label: "Resolved" }),
    el("div", { class: "advisory-body" },
      el("span", { class: "advisory-title", text: issue.title })),
    el("span", { class: "advisory-impact", text: "Resolved" }));
}

// Thin trigger — the step timeline, result, and launch now live in the
// Investigation drawer. The row shows the headline + live state and opens it.
function renderInvestigationItem(item) {
  const stateLabel = INVESTIGATION_STATE_LABELS[item.state] || "Queued";
  const selected = state.selected && state.selected.kind === "investigation" && state.selected.id === item.issueId;
  const open = () => selectEntity({ kind: "investigation", id: item.issueId });
  return el("li", {
    class: "signal-advisory investigation-item signal-trigger" + (selected ? " is-selected" : ""),
    role: "button", tabindex: "0",
    "aria-label": "Open investigation: " + item.headline,
    dataset: { fkey: "investigation:" + item.issueId },
    onclick: open,
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } },
  },
    icon("broadcast", { class: "warn-tri", label: "Investigation" }),
    el("div", { class: "advisory-body" },
      el("div", { class: "advisory-title", text: item.headline })),
    el("span", { class: "advisory-impact", text: stateLabel }));
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
  root.textContent = "";
  if (state.view === "usage") {
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
  if (!state.snap) { renderScopeNote(0); return; }

  const filter = currentFilter();
  let shown = 0;
  for (const program of state.snap.programs) {
    const agents = program.agents.filter((a) => filter(a, program));
    if (!agents.length) continue;
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
  return el("span", {
    class: "row-fact fact-tokens fact-context" + (usage ? "" : " is-unknown"),
    "aria-label": `${contextDisplayLabel()}: ${value}`,
  },
    el("span", {
      class: "row-fact-value context-fact-value",
      title: usage ? usage.text : "This source does not report observed context usage.",
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
  const stateText = ACTIVITY_LABELS[activity] + (outcome !== "healthy" ? " · " + OUTCOME_LABELS[outcome] : "");

  const eligible = broadcastEligible(agent);
  const checked = state.selection.has(agent.id);
  const hasLabel = agentLabelEligible(agent) && state.aliases.has(presentationLabelKey(agentLabelTarget(agent)));
  const sourceName = sourceAgentName(agent);

  const identity = el("span", { class: "row-identity" },
    providerMark(agent),
    el("span", { class: "agent-name", text: agentName(agent) }),
    el("span", { class: "row-identity-tags" },
      hasLabel ? el("span", { class: "source-label", title: "Source-backed agent label", text: "source: " + sourceName }) : null,
      role.key !== "agent" ? el("span", { class: "role-chip role-label role-" + role.key, text: role.label }) : null,
      policy && policy.state === "mismatch" ? el("span", { class: "policy-chip", title: policy.summary }, icon("warning"), "Model mismatch") : null,
      opts.childCount ? el("span", { class: "swarm-chip", title: opts.childCount + " subagents in this swarm", text: "swarm " + opts.childCount }) : null),
    description ? el("span", { class: "row-identity-tags row-summary row-description", title: "Latest human message or current status summary. Select for full details.", text: description }) : null);

  const line1 = el("span", { class: "agent-grid" },
    el("span", { class: "row-state state-" + activity },
      el("span", { class: "act-glyph act-" + activity, "aria-hidden": "true" }),
      el("span", { text: stateText })),
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
    (checked ? " is-checked" : "");

  const children = [];
  if (state.selecting) {
    children.push(el("span", {
      class: "row-check",
      "aria-hidden": "true",
    }, checked ? icon("check") : null));
  }
  children.push(line1);

  return el("button", {
    type: "button",
    class: rowClass,
    id: "agent-" + agent.id,
    "aria-current": selected ? "true" : null,
    "aria-pressed": state.selecting ? String(checked) : null,
    disabled: state.selecting && !eligible ? "" : null,
    "aria-label": `${agentName(agent)}. Status: ${stateText}. Agent/message: ${summary || "No message reported"}. Model: ${modelShort(agent.model) || "Model not reported"}. Context: ${contextDisplayValue(agent.tokens)}. Access: ${CONTROL_STATE_TEXT[control] || "View only"}. ${opts.depth ? `Swarm depth ${opts.depth}. ` : ""}${opts.childCount ? `${opts.childCount} descendants. ` : ""}${state.selecting ? (eligible ? " Selectable for broadcast." : " Not available for broadcast.") : " Select to open the full message and session details in the inspector."}`,
    dataset: { fkey: "agent:" + agent.id, depth: String(opts.depth || 0) },
    onclick: () => state.selecting ? (eligible && toggleSelect(agent.id)) : selectAgent(agent.id),
  }, children);
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
  pane.textContent = "";
  pane.className = "pane-inspector";
  const sel = state.selected;
  pane.hidden = !sel;
  document.body.classList.toggle("inspector-open", !!sel);
  if (!sel) return;

  const view = resolveSelection(sel);
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

// Affected agents as chips that open the Agent drawer — moved out of the inline
// list bands so the drawer owns the interaction.
function affectedChips(issue, label) {
  const byId = agentsById();
  const affected = (issue.affectedAgentIds || []).map((id) => byId.get(id)).filter(Boolean);
  if (!affected.length) return null;
  return el("div", { class: "dw-affects" },
    el("h3", { class: "section-title", text: `${label} (${affected.length})` }),
    el("div", { class: "dw-chips" }, affected.map(({ agent, program }) =>
      el("button", {
        type: "button", class: "dw-chip",
        dataset: { fkey: `issue:${issue.id}:${agent.id}` },
        onclick: () => selectEntity({ kind: "agent", id: agent.id }),
      }, agentName(agent), el("span", { class: "dw-chip-prog", text: " · " + programName(program) })))));
}

// Intervention drawer — leads with the consequence, then the one thing to do.
function renderInterventionDrawer(pane, view) {
  const issue = view.issue;
  const note = issueLifecycleNote(issue);
  drawerAccent(pane, "ember");
  pane.append(drawerHead(
    dwEyebrow("ember", "intervention", issueLifecycle(issue).state === "open" ? "Open · act now" : issueStateLabel(issue)),
    issue.title));
  pane.append(el("p", { class: "dw-lead", text: issue.summary || issue.title }));
  pane.append(el("div", { class: "dw-block dw-block--fix" },
    el("div", { class: "dw-block-label", text: "Fix" }),
    renderTriage(issue)));
  const chips = affectedChips(issue, "Affected");
  if (chips) pane.append(chips);
  if (issue.technicalDetails && issue.technicalDetails.length) {
    pane.append(el("details", { class: "signal-tech" },
      el("summary", { text: "Technical" }),
      el("ul", {}, issue.technicalDetails.map((d) => el("li", { class: "mono", text: d })))));
  }
  if (note) pane.append(el("p", { class: "dw-impact", text: note }));
}

// Advisory drawer — deliberately quieter than an intervention. No forced action.
function renderAdvisoryDrawer(pane, view) {
  const issue = view.issue;
  const note = issueLifecycleNote(issue);
  const affectedCount = (issue.affectedAgentIds || []).length;
  drawerAccent(pane, "amber");
  pane.append(drawerHead(dwEyebrow("amber", "warning", "Advisory"), issue.title));
  pane.append(el("p", { class: "dw-lead dw-lead--quiet", text: issue.summary || issue.title }));
  const chips = affectedChips(issue, "Affects");
  if (chips) pane.append(chips);
  pane.append(el("p", { class: "dw-impact", text: `${issueStateLabel(issue)}${affectedCount ? " · " + affectedCount + " affected" : " · system"}` }));
  if (note) pane.append(el("p", { class: "dw-impact", text: note }));
  pane.append(el("div", { class: "controls-row" },
    el("button", {
      type: "button", class: "btn dw-ghost", dataset: { fkey: "escalate:" + issue.id },
      onclick: () => triageIssue(issue.id, "generate"),
    }, "Escalate to triage")));
}

const INVESTIGATION_STATE_LABELS = { running: "Running", completed: "Verifying", blocked: "Blocked", queued: "Queued" };

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
    : item.state === "completed" ? "complete · source confirmation pending"
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
    pane.append(el("details", { class: "triage-result" },
      el("summary", { text: item.state === "completed" ? "Investigation result" : "Blocked investigation result" }),
      el("pre", { text: item.result })));
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

// Agent drawer — the workhorse, unchanged in body (reuses renderOverview/
// renderTechnical/renderDangerZone etc.), now routed through the chassis.
function renderAgentDrawer(pane, view) {
  const { agent, program } = view;
  const activity = deriveActivity(agent);
  const outcome = deriveOutcome(agent);
  const control = deriveControlState(agent);
  const policy = modelPolicyView(agent);

  // Provider channel: a 1px inset rail + the lineage current-node ring both read
  // from --prov, set CSP-safely by a class (never an inline style).
  pane.classList.add("dw-provider", "dw-provider--" + agent.provider);

  pane.append(el("div", { class: "inspector-head" },
    el("div", { class: "inspector-id" },
      el("h2", { class: "inspector-title", text: agentName(agent) }),
      agentLabelEligible(agent) && state.aliases.has(presentationLabelKey(agentLabelTarget(agent)))
        ? el("p", { class: "inspector-source-name", text: "Source agent: " + sourceAgentName(agent) })
        : null,
      el("p", { class: "inspector-sub" },
        el("span", { text: programName(program) }),
        " · ",
        el("span", { class: "chip provider-" + agent.provider },
          providerLabel(agent.provider) + (modelShort(agent.model) ? " · " + modelShort(agent.model) : "")))),
    closeButton()));

  pane.append(el("div", { class: "inspector-state" },
    el("span", { class: "state-pill act-" + activity },
      el("span", { class: "act-glyph act-" + activity, "aria-hidden": "true" }), ACTIVITY_LABELS[activity]),
    el("span", { class: "state-pill outcome-" + outcome, text: OUTCOME_LABELS[outcome] }),
    el("span", { class: "state-pill control-" + control, title: CONTROL_HINTS[control] },
      icon(CONTROL_ICONS[control] || "observed"), CONTROL_LABELS[control]),
    policy
      ? el("span", { class: "state-pill policy-" + policy.state, title: policy.summary },
          policy.state === "mismatch" ? icon("warning") : null,
          policy.state === "mismatch" ? "Model mismatch" : policy.label)
      : null));

  pane.append(renderPrimaryActions(agent));
  pane.append(renderPresentationLabels(agent));
  pane.append(renderLineageSpine(agent));

  if (agent.nextAction) {
    pane.append(el("p", { class: "next-action" },
      el("span", { class: "next-key", text: "Next" }), " ", agent.nextAction));
  }

  pane.append(el("div", { class: "inspector-tabs", role: "tablist" },
    inspectorTabButton("overview", "Overview"),
    inspectorTabButton("technical", "Technical")));

  // Both panels always render. In the narrow drawer CSS shows only the active
  // tab; once the drawer is wide enough the tabs hide and both sit side-by-side
  // (Option 2 — use the horizontal room instead of forcing a tab dance).
  const overviewPanel = renderOverview(agent, program);
  overviewPanel.dataset.tab = "overview";
  const technicalPanel = renderTechnical(agent);
  technicalPanel.dataset.tab = "technical";
  pane.append(el("div", { class: "inspector-body", dataset: { activeTab: state.inspectorTab } },
    overviewPanel, technicalPanel));

  pane.append(renderDangerZone(agent));

  const fb = state.feedback.get(agent.id);
  if (fb) {
    pane.append(el("p", {
      class: "control-feedback " + (fb.ok ? "ok" : "err"),
      role: "status",
      text: fb.message,
    }));
  }
}

function closeButton() {
  return el("button", {
    type: "button", class: "btn inspector-close",
    "aria-label": "Close inspector",
    dataset: { fkey: "inspector-close" },
    onclick: () => closeInspector(),
  }, icon("close"), "Close");
}

function inspectorTabButton(tab, label) {
  return el("button", {
    type: "button",
    class: "inspector-tab",
    role: "tab",
    "aria-selected": String(state.inspectorTab === tab),
    dataset: { fkey: "itab:" + tab },
    onclick: () => { state.inspectorTab = tab; render(); },
  }, label);
}

/* ---------- inspector: primary actions ---------- */

const ACTION_LABELS = { focus: "Focus", instruct: "Send", interrupt: "Interrupt", archive: "Archive" };
const NEEDS_CONFIRM = new Set(["interrupt", "archive"]);

function capability(agent, action) {
  return (agent.controls || []).find((c) => c.action === action);
}

function renderPrimaryActions(agent) {
  const wrap = el("div", { class: "primary-actions" });
  const focusCap = capability(agent, "focus");
  const instructCap = capability(agent, "instruct");
  const row = el("div", { class: "controls-row" });

  if (focusCap) {
    const key = agent.id + ":focus";
    const busy = state.pending.has(key);
    row.append(el("button", {
      type: "button", class: "btn primary",
      disabled: focusCap.enabled && !busy ? null : "",
      "aria-busy": busy ? "true" : null,
      dataset: { fkey: "act:" + key },
      onclick: () => sendControl(agent, "focus"),
    }, busy ? "Focusing…" : "Focus"));
  }

  if (instructCap) {
    const key = agent.id + ":instruct";
    const busy = state.pending.has(key);
    const input = el("input", {
      type: "text",
      placeholder: instructCap.enabled ? "Send an instruction…" : "Instruction unavailable",
      disabled: instructCap.enabled ? null : "",
      value: state.drafts.get(agent.id) || "",
      "aria-label": "Instruction for " + agentName(agent),
      dataset: { fkey: "draft:" + agent.id },
      oninput: (e) => state.drafts.set(agent.id, e.target.value),
    });
    row.append(el("form", {
      class: "instruct-form",
      onsubmit: (e) => {
        e.preventDefault();
        const text = (state.drafts.get(agent.id) || "").trim();
        if (!text || busy) return;
        sendControl(agent, "instruct", text);
      },
    },
      input,
      el("button", {
        type: "submit", class: "btn",
        disabled: instructCap.enabled && !busy ? null : "",
        "aria-busy": busy ? "true" : null,
        dataset: { fkey: "act:" + key },
      }, busy ? "Sending…" : "Send")));
  }

  wrap.append(row);

  // One plain-language explanation when safe controls are unavailable;
  // the exact routing evidence lives under Technical.
  const disabled = [focusCap, instructCap].filter((c) => c && !c.enabled);
  if (disabled.length) {
    wrap.append(el("p", { class: "control-reason",
      text: controlUnavailableText(deriveControlState(agent)) + " See Technical for the exact routing evidence." }));
  }
  return wrap;
}

function sourceWorkspaceLabel(target) {
  return target.workspaceTitle || "cmux workspace " + target.workspaceId;
}

function sourceRoomLabel(target) {
  return "cmux room " + target.surfaceId;
}

function renderPresentationLabels(agent) {
  const targets = [];
  if (agent.target && agent.target.workspaceId) {
    targets.push({
      target: workspaceLabelTarget(agent.target.workspaceId),
      kind: "workspace",
      source: sourceWorkspaceLabel(agent.target),
      sourceEvidence: "Source workspace: " + sourceWorkspaceLabel(agent.target) + " · id stays " + agent.target.workspaceId,
    });
  }
  if (agent.target && agent.target.surfaceId) {
    targets.push({
      target: roomLabelTarget(agent.target.surfaceId),
      kind: "room",
      source: sourceRoomLabel(agent.target),
      sourceEvidence: "Source room surface id stays " + agent.target.surfaceId,
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
  if (!targets.length) return el("span", { hidden: "" });

  const wrap = el("div", { class: "presentation-labels" },
    el("h3", { class: "section-title", text: "Presentation labels" }));
  if (state.labelsLoading) wrap.append(el("p", { class: "label-status", text: "Loading saved labels…" }));
  if (state.labelLoadError) wrap.append(el("p", { class: "label-status err", role: "status", text: "Saved labels unavailable: " + state.labelLoadError }));
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
    wrap.append(row);
    if (editing) {
      wrap.append(renderLabelForm(item.target, {
        inputKey: "label-input:" + key,
        placeholder: "Display label for this " + item.kind,
        ariaLabel: "New display label for " + item.kind,
        source: item.sourceEvidence,
      }));
    }
  }
  return wrap;
}

/* ---------- inspector: overview ---------- */

function dtdd(grid, label, value, opts = {}) {
  const hint = opts.hint ?? GLOSSARY[label];
  grid.append(hint
    ? el("dt", {}, el("span", {
        class: "term-hint", tabindex: "0",
        title: hint, "aria-label": `${label}: ${hint}`, text: label,
      }))
    : el("dt", { text: label }));
  const dd = el("dd", {});
  if (value == null || value === "") {
    dd.append(el("span", { class: "absent", text: opts.absent || "not reported" }));
  } else if (value.nodeType) {
    dd.append(value);
  } else {
    dd.append(opts.code ? el("code", { text: String(value) }) : String(value));
  }
  grid.append(dd);
}

function renderOverview(agent, program) {
  const panel = el("div", { class: "inspector-panel", role: "tabpanel" });
  const grid = el("dl", { class: "detail-grid" });
  const outcome = deriveOutcome(agent);

  if (typeof agent.lastHumanMessage === "string" && agent.lastHumanMessage.trim()) {
    panel.append(
      el("h3", { class: "section-title", text: "Last human message" }),
      el("p", { class: "last-human-message", tabindex: "0", text: agent.lastHumanMessage }));
  }

  dtdd(grid, "task", agent.task);
  if (outcome !== "healthy") {
    dtdd(grid, OUTCOME_LABELS[outcome].toLowerCase(), agent.statusReason);
  }
  dtdd(grid, "last update", el("span", { class: "mono", dataset: { ago: agent.updatedAt }, text: agoText(agent.updatedAt) }));
  dtdd(grid, "running for", el("span", {
    class: "mono",
    dataset: elapsedDataset(agent, state.snap && state.snap.generatedAt),
    text: liveElapsedText(agent, state.snap && state.snap.generatedAt),
  }));
  dtdd(grid, "role", agent.role && agent.role !== "agent" ? agent.role : null, { absent: "general agent" });

  const tok = tokenSummary(agent.tokens);
  dtdd(grid, tok.label, el("span", { title: tok.title, class: tok.known ? "mono" : "absent", text: tok.text }), { hint: TOKENS_HINT });
  const ctx = contextUsage(agent.tokens);
  if (ctx) {
    dtdd(grid, "context", el("span", {
      class: "mono",
      title: "Latest call size against the model's context window.",
      text: ctx.text,
    }));
  }
  dtdd(grid, "cost", agent.cost
    ? `${agent.cost.currency} ${Number(agent.cost.amount).toFixed(4)} · ${provenanceLabel(agent.cost.provenance)}${agent.cost.note ? " · " + agent.cost.note : ""}`
    : null, { absent: "not reported" });

  panel.append(grid);
  return panel;
}

/* renderSwarmSection is superseded by renderLineageSpine in the Agent drawer
   (P4), but it MUST stay defined immediately after renderOverview: a test
   asserts the renderOverview…renderSwarmSection source adjacency. Do not
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

/* ---------- inspector: technical ---------- */

function renderTechnical(agent) {
  const panel = el("div", { class: "inspector-panel", role: "tabpanel" });
  panel.append(el("p", { class: "inspector-note tech-caption",
    text: "The raw evidence behind the Overview — hover any underlined term for what it means." }));
  const grid = el("dl", { class: "detail-grid" });

  dtdd(grid, "session id", `${agent.provider}:${agent.sourceSessionId}`, { code: true });
  dtdd(grid, "working directory", agent.cwd, { code: true });
  dtdd(grid, "status", `${agent.status} — ${agent.statusReason}`);
  dtdd(grid, "model", agent.model);
  dtdd(grid, "reasoning effort", agent.effort);
  dtdd(grid, "started", agent.startedAt
    ? el("span", { class: "mono", dataset: { ago: agent.startedAt }, text: agoText(agent.startedAt) })
    : null);
  dtdd(grid, "nesting level", agent.threadDepth != null ? String(agent.threadDepth) : null);
  dtdd(grid, "orchestrator id", agent.parentAgentId, { code: true, absent: "none" });
  dtdd(grid, "subagents", agent.subagentCount != null ? String(agent.subagentCount) : null);

  const t = agent.tokens || { provenance: "unknown" };
  const tokParts = [];
  if (t.input != null) tokParts.push("in " + fmtTok(t.input));
  if (t.output != null) tokParts.push("out " + fmtTok(t.output));
  if (t.cachedInput != null) tokParts.push("cached " + fmtTok(t.cachedInput));
  if (t.total != null) tokParts.push("total " + fmtTok(t.total));
  const tokLabel = t.scope === "latest-turn" ? "latest call" : "tokens";
  dtdd(grid, tokLabel, tokParts.length
    ? el("span", { class: "mono" }, tokParts.join(" · ") + " · ", el("span", { class: "absent", text: provenanceLabel(t.provenance) }))
    : el("span", { class: "absent", text: "none reported (" + provenanceLabel(t.provenance) + ")" }), { hint: TOKENS_HINT });
  dtdd(grid, "session total", t.sessionTotal != null
    ? el("span", { class: "mono", text: fmtTok(t.sessionTotal) + " tokens · cumulative this session" })
    : null);
  dtdd(grid, "context window", t.contextWindow != null
    ? el("span", { class: "mono", text: fmtTok(t.contextWindow) + " tokens" })
    : null);

  const policy = modelPolicyView(agent);
  dtdd(grid, "model policy", policy
    ? el("span", { class: "policy-" + policy.state },
        policy.label + (policy.expected ? " — expected " + policy.expected : ""),
        el("span", { class: "absent", text: " · " + policy.summary }))
    : null, { absent: "not evaluated" });

  dtdd(grid, "git", agent.git && (agent.git.branch || agent.git.head)
    ? el("span", {},
        el("code", { text: agent.git.branch || "(detached)" }),
        agent.git.dirty ? el("span", { class: "git-dirty", text: " · uncommitted changes" }) : null,
        agent.git.head ? el("code", { text: " @ " + agent.git.head.slice(0, 9) }) : null)
    : null);

  dtdd(grid, "tests", agent.tests
    ? el("span", { class: "tests-" + agent.tests.state },
        agent.tests.state + (agent.tests.summary ? " — " + agent.tests.summary : ""))
    : null);

  dtdd(grid, "checks", agent.gates && agent.gates.length
    ? el("span", {}, agent.gates.map((g) => el("span", { class: "gate-chip", text: g })))
    : el("span", { class: "absent", text: "none" }));

  dtdd(grid, "control link", renderTarget(agent.target));

  const routing = el("ul", { class: "routing-list" });
  for (const cap of agent.controls || []) {
    routing.append(el("li", {},
      el("span", { class: "mono", text: cap.action }),
      " — ",
      cap.enabled
        ? el("span", { class: "ok", text: "enabled" })
        : el("span", { class: "absent", text: "disabled: " + (cap.reason || "no reason reported") })));
  }
  dtdd(grid, "available controls", routing);

  panel.append(grid);

  if (agent.artifacts && agent.artifacts.length) {
    panel.append(
      el("h3", { class: "section-title", text: "Artifacts" }),
      el("ul", { class: "artifact-list" },
        agent.artifacts.map((a) => el("li", {},
          el("span", { class: "artifact-kind", text: a.kind || "file" }),
          el("span", { text: a.label }),
          el("span", { class: "artifact-path", text: a.path }),
          el("button", {
            type: "button", class: "btn",
            dataset: { fkey: `copy:${agent.id}:${a.path}` },
            onclick: () => copyText(a.path),
          }, "Copy path")))));
  }

  if (agent.transcriptTail) {
    panel.append(
      el("h3", { class: "section-title", text: "Transcript tail" }),
      el("pre", { class: "transcript", tabindex: "0", text: agent.transcriptTail }));
  }
  return panel;
}

function renderTarget(target) {
  if (!target) return null;
  const wrap = el("span", {},
    el("span", { class: "target-chip target-" + target.resolution, text: RESOLUTION_LABELS[target.resolution] || target.resolution }));
  const ids = [
    target.workspaceId && "ws " + target.workspaceId,
    target.surfaceId && "surface " + target.surfaceId,
    target.paneId && "pane " + target.paneId,
  ].filter(Boolean);
  if (ids.length) wrap.append(" ", el("code", { text: ids.join(" · ") }));
  if (target.workspaceTitle) wrap.append(" ", el("span", { class: "source-label", text: "· source title: " + target.workspaceTitle }));
  if (target.reason) wrap.append(" ", el("span", { class: "absent", text: "— " + target.reason }));
  return wrap;
}

/* ---------- inspector: danger zone ---------- */

function renderDangerZone(agent) {
  const caps = ["interrupt", "archive"].map((a) => capability(agent, a)).filter(Boolean);
  if (!caps.length) return el("span", { hidden: "" });

  const wrap = el("div", { class: "danger-zone" },
    el("h3", { class: "section-title danger-title", text: "Danger" }));
  const row = el("div", { class: "controls-row" });

  for (const cap of caps) {
    const key = agent.id + ":" + cap.action;
    const busy = state.pending.has(key);

    if (state.confirming === key) {
      row.append(el("span", { class: "confirm-strip", role: "group",
        "aria-label": ACTION_LABELS[cap.action] + " " + agentName(agent) + "?" },
        el("span", { text: ACTION_LABELS[cap.action] + " " + agentName(agent) + "?" }),
        el("button", {
          type: "button", class: "btn confirm-yes",
          dataset: { fkey: "confirm:" + key },
          onclick: () => { state.confirming = null; sendControl(agent, cap.action); },
        }, "Confirm " + cap.action),
        el("button", {
          type: "button", class: "btn",
          onclick: () => { state.confirming = null; render(); },
        }, "Cancel")));
      continue;
    }

    row.append(el("button", {
      type: "button",
      class: "btn danger",
      disabled: cap.enabled && !busy ? null : "",
      "aria-busy": busy ? "true" : null,
      title: cap.enabled ? null : cap.reason || "Unavailable",
      dataset: { fkey: "act:" + key },
      onclick: () => {
        state.confirming = key;
        render();
        const btn = document.querySelector(`[data-fkey="${CSS.escape("confirm:" + key)}"]`);
        if (btn) btn.focus();
      },
    }, busy ? ACTION_LABELS[cap.action] + "…" : ACTION_LABELS[cap.action]));
  }

  wrap.append(row);
  return wrap;
}

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

function startRename(target) {
  const key = presentationLabelKey(target);
  state.renaming = key;
  state.renameDraft = state.aliases.get(key) || "";
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
  loadSignalPanels();
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
