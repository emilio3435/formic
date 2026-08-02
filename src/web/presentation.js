/* Presentation — how a session is NAMED and DESCRIBED to a person.

   One question, answered once: given an agent, a program or an issue, what do
   we call it and what do we say about it. Display names and the alias overrides
   that beat them, the label targets a rename writes to, terminal identity and
   its breadcrumb, why identity was quarantined and which surfaces collided,
   role and model-policy readings, the issue lifecycle vocabulary, elapsed-clock
   datasets, and the derived issue list.

   Naming is the thing this codebase has re-forked and regretted before — the
   comments below carry those scars — so it lives in exactly one place that both
   the board and the drawer import. That is the seam: nobody re-derives a name.

   Reads `state` for the alias map and the context-display preference, which is
   why client-state.js had to come out first. Builds no DOM and issues no
   requests: it decides WHAT to say, never where it lands on screen.  */

import { fmtElapsed, providerLabel, PROVIDER_LABELS } from "./text-formatters.js";
import { MODEL_POLICY_LABELS } from "./client-catalogs.js";
import { alerting, deriveActivity, deriveControlState, deriveOutcome } from "./agent-model.js";
import { state } from "./client-state.js";

/* Plain words for provider-native enums that used to render raw. */
export const PROVENANCE_LABELS = { observed: "measured", estimated: "estimated", unknown: "unknown" };

export const IDENTITY_TIER_LABELS = {
  recorded: "Recorded target",
  session: "Session ID on a terminal",
  cwd: "Working folder",
};

export const IDENTITY_OUTCOME_LABELS = {
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

export const IDENTITY_CAUSES = {
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

export const ROLE_LABELS = {
  orchestrator: "Orchestrator",
  frontend: "Frontend / designer",
  backend: "Backend implementer",
  verifier: "Verifier",
  tester: "Tester",
  automation: "Automation",
  agent: "Agent",
};

export const ROLE_ALIASES = {
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
export const INVESTIGATION_STATE_VIEW = {
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

/* A log that shows only successes is worse than no log: it reads as proof the
   instruction landed. Every outcome the contract can return gets its own word. */
export const ACTION_OUTCOME_VIEW = {
  ok: { label: "Delivered", tone: "ok" },
  failed: { label: "Failed", tone: "err" },
  partial: { label: "Partly delivered", tone: "warn" },
  staged: { label: "Staged — not submitted", tone: "warn" },
};

export function actionOutcomeView(outcome) {
  // An outcome the server adds later reads as the server's own word rather than
  // as a confident wrong label — the same rule investigationView follows.
  return ACTION_OUTCOME_VIEW[outcome] || { label: String(outcome || "unknown"), tone: "warn" };
}

export const agentLabelEligible = (agent) => Boolean(agent && agent.id);

/* Live cmux / terminal title for this session, when routing knows one. */

export const agentLabelTarget = (agent) => ({ kind: "agent", agentId: agent.id });
/* Every live agent can take a presentation label. Prefer editing the linked
   cmux workspace when present so Ant Hill names stay hunt-able in the wild. */

export function agentName(agent) {
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

export function collisionClaimText(claim) {
  const who = (PROVIDER_LABELS[claim.provider] || claim.provider) + " " + shortSessionId(claim.sessionId);
  if (!claim.pid) return who;
  return who + " (pid " + claim.pid + (claim.command ? ", " + conciseText(claim.command, 40) : "") + ")";
}

export function collisionLine(collision) {
  const where = collision.tty || collision.surfaceId || "this terminal";
  if (!collision.claims.length) return where + " — no open agent session files observed.";
  if (collision.claims.length === 1) return where + " — one session open: " + collisionClaimText(collision.claims[0]);
  return where + " — " + collision.claims.length + " sessions claim it: "
    + collision.claims.map(collisionClaimText).join(" · ");
}

export function conciseText(value, limit = 88) {
  const text = String(value || "").split("\n")[0].replace(/^(goal:|you are)\s*/i, "").trim();
  if (text.length <= limit) return text;
  const clipped = text.slice(0, limit - 1);
  const boundary = clipped.lastIndexOf(" ");
  return clipped.slice(0, boundary > limit * 0.65 ? boundary : clipped.length).trimEnd() + "…";
}

/* Plain-language control explanation for the Operate chrome. Never echoes
   capability reasons here — live reasons carry raw cmux/session IDs, which
   belong only in Evidence. */
export function controlUnavailableText(controlState) {
  /* Three sentences, because a refusal an operator cannot act on reads as a
     fault: what is off, why, and what turns it back on. Send is OFF here, not
     broken, and saying so is what stops the retry. */
  if (controlState === "unproven") {
    /* One sentence. Rendered at real drawer width it ran three paragraphs that
       each said the same thing — the summary named the cause, the risk and the
       recovery, then `why` restated the cause and the risk, then `nextStep`
       restated the recovery. Repeating information under different labels is
       the noise this board exists to cut, and a long refusal is likelier to be
       skipped than a short one. The summary now states the refusal, `why` owns
       the mechanism, and `nextStep` owns the action. */
    return "Send and Interrupt are off: cmux cannot confirm which session is on this pane.";
  }
  return controlState === "quarantined"
    ? "Controls are unavailable — this session's identity is ambiguous, so control routing is quarantined."
    : "Controls are unavailable — no safe cmux target is linked to this session.";
}

/* Short folder/Home identity for when cmux titles are unavailable. */
export function cwdIdentityName(agent) {
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

export function elapsedDataset(agent, generatedAt) {
  const live = deriveActivity(agent) !== "ended" && agent.elapsedMs != null && generatedAt;
  return live
    ? { elapsedBase: String(agent.elapsedMs), elapsedFrom: generatedAt }
    : {};
}

export function focusDestinationHint(agent) {
  const id = terminalIdentity(agent);
  if (!id) return "Jump to terminal pane";
  const dest = [id.title, id.paneCwd].filter(Boolean).join(" · ");
  return dest ? "Jump to " + dest : "Jump to terminal pane";
}

/* Rename target: workspace first (shared terminal identity), else the agent. */

export function identityCause(view) {
  const refused = (tier) => view.steps.some((step) =>
    step.tier === tier && (step.outcome === "quarantined" || step.outcome === "ambiguous"));
  if (refused("session")) return "contested-terminal";
  if (refused("cwd")) return "shared-folder";
  return "missing";
}

/* The banner's whole story: what happened, why, and what to do about it.
   Returns null when controls route normally. Pure. */

/* Normalized, render-ready view of one agent's identity trace. Pure. */
export function identityTraceView(agent) {
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

/* A state the server adds later reads as its own word everywhere rather than
   as a confident wrong label on one surface and a raw enum on the next. */
export function investigationView(stateKey) {
  if (INVESTIGATION_STATE_VIEW[stateKey]) return INVESTIGATION_STATE_VIEW[stateKey];
  const raw = String(stateKey || "queued");
  return {
    work: "queued", label: raw, tone: "cool",
    button: "Investigation " + raw,
    note: "Investigation " + raw,
    status: raw,
  };
}

export function issueLifecycle(issue) {
  return issue && issue.lifecycle && issue.lifecycle.state
    ? issue.lifecycle
    : { state: "open" };
}

export function issueLifecycleNote(issue) {
  const lifecycle = issueLifecycle(issue);
  if (lifecycle.state === "verifying") {
    return `Verifying since ${issueTimestamp(lifecycle.verificationStartedAt)} · waiting for a fresh source snapshot to clear the finding.`;
  }
  if (lifecycle.state === "blocked") {
    return `Blocked${lifecycle.result ? ` · ${lifecycle.result}` : " · external action is required."}`;
  }
  return "";
}

export function issueTimestamp(iso) {
  if (!iso || Number.isNaN(Date.parse(iso))) return "unknown time";
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function issuesOf(snap) {
  if (!snap) return [];
  const issues = [];
  const server = Array.isArray(snap.issues) ? snap.issues : null;
  if (server) {
    /* The server owns the findings the client cannot see — collector faults,
       source degradation, ended-session policy drift. It ALSO ships kind:"agent"
       findings derived from outcome alone, and those are dropped here.

       Dropping them is the whole fix for the false all-clear. Returning
       snap.issues verbatim short-circuited the derivation below, so the rail
       counted the server's agent rule while the tab counted alerting() — and the
       board rendered "NEEDS YOU 1 finding", "Needs you 0" and "Nothing needs
       you" at the same instant, each correct for its own hidden population.
       Nothing is lost by dropping them: alerting() is a strict superset of the
       server's rule (outcome not healthy AND not ended), and it additionally
       catches the attentionSignal agents the server's rule misses entirely.

       One collection, and its agent half is the tab's population by
       construction rather than by coincidence. */
    for (const issue of server) if (issue.kind !== "agent") issues.push(issue);
  }
  const errors = (!server && snap.controlHealth && snap.controlHealth.errors) || [];
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
    /* Bound to alerting(), the same verdict the tab, the notifier and the rollup
       read, rather than re-deriving "needs a human" from outcome alone. That
       third derivation is why an agent whose only claim was its attentionSignal
       reached no surface at all. */
    if (alerting(agent)) {
      /* When the server said WHY, say that. Its evidence is the agent's own
         words and its nextAction is the decision waiting — strictly better than
         "needs review", which is the finding naming itself. */
      const signal = agent.attentionSignal;
      issues.push({
        id: "agent:" + agent.id,
        kind: "agent",
        severity: outcome === "failed" ? "error" : "warning",
        title: outcome === "failed" ? `${agentName(agent)} failed` : `${agentName(agent)} needs review`,
        summary: (signal && signal.evidence) || agent.statusReason,
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

/* "Did I already tell these lanes to rebase?" — answered per agent, in the one
   place where sending again is a click away. Newest-first is the contract, so
   the first match is the most recent; sorting here would fight it. */
export function lastActionFor(actions, agentId) {
  return (actions || []).find((a) => a.agentIds.includes(agentId)) || null;
}

/* Who it went to, without a wall of session ids. `nameFor` resolves what the
   snapshot still knows; an agent that has since disappeared keeps its raw id
   rather than being silently dropped from the record. */

export function liveElapsedText(agent, generatedAt) {
  if (agent.elapsedMs == null) return "—";
  if (deriveActivity(agent) !== "ended" && generatedAt) {
    const drift = Date.now() - Date.parse(generatedAt);
    if (Number.isFinite(drift) && drift > 0) return fmtElapsed(agent.elapsedMs + drift);
  }
  return fmtElapsed(agent.elapsedMs);
}

export function modelPolicyView(agent) {
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

export function preferredRenameTarget(agent) {
  if (agent && agent.target && agent.target.workspaceId) {
    return workspaceLabelTarget(agent.target.workspaceId);
  }
  return agentLabelTarget(agent);
}

export function presentationLabelKey(target) {
  if (!target) return "";
  if (target.kind === "program") return "program:" + target.programId;
  if (target.kind === "workspace") return "workspace:" + target.workspaceId;
  if (target.kind === "room") return "room:" + target.surfaceId;
  if (target.kind === "agent") return "agent:" + target.agentId;
  return "";
}

export const provenanceLabel = (p) => PROVENANCE_LABELS[p] || p || "unknown";

export function quarantineBrief(agent, control = deriveControlState(agent)) {
  if (control === "linked") return null;
  const view = identityTraceView(agent);
  const cause = identityCause(view);
  /* Without this branch the banner throws. It renders whenever a write control
     is disabled, and the fail-closed gate disables Send on a routable pane —
     a state that previously could not exist, so this returned null and the
     caller read .title off it. */
  if (control === "unproven") {
    const id = terminalIdentity(agent);
    const focusTarget = id ? [id.title, id.paneCwd].filter(Boolean).join(" · ") : "";
    return {
      title: "Send is off for this row.",
      summary: controlUnavailableText(control),
      why: "It was matched by working directory alone, and a pane that changes directory into"
        + " another's folder matches just as well — which is how an instruction reaches the wrong agent.",
      /* Focus NAMES its destination here, because on exactly these rows the
         routing may be wrong. The adversarial verification found that a rotated
         row keeps focus:true while its target has moved, so Focus can walk an
         operator to a stranger's terminal. It stays enabled on purpose — it
         types nothing, and going to look is how you recover when Send is off —
         but "go and look" is only safe advice if the operator can tell, before
         clicking, whether they arrived where they expected. The pane name was
         already computed for a title attribute, which is to say it was visible
         only on hover, which is to say it was not visible. */
      nextStep: focusTarget
        ? `Focus still works and will take you to ${focusTarget} — check that is the session you meant.`
          + " Nothing here needs repairing: Send returns on its own once cmux names the session."
        : "Focus still works, so open the pane and look. Nothing here needs repairing:"
          + " Send returns on its own once cmux names the session.",
      cause,
      steps: view.steps,
    };
  }
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

export function recentlyResolvedOf(snap) {
  return snap && Array.isArray(snap.recentlyResolved) ? snap.recentlyResolved : [];
}

export function roleView(role) {
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

export const roomLabelTarget = (surfaceId) => ({ kind: "room", surfaceId });

export function shortSessionId(id) {
  const text = String(id || "");
  return text.length > 10 ? text.slice(0, 8) + "…" : text;
}

/* GET /api/debug/identity?agent=<id> → the sentence the operator needs: which
   terminal, and which sessions are fighting over it. The pids/commands/open
   files live only on CmuxSurface, which the snapshot does not carry, so this is
   the one piece of evidence that has to be fetched on demand. Pure. */

export function snapshotAgents(snap) {
  if (!snap) return [];
  return snap.programs.flatMap((p) => p.agents.map((agent) => ({ agent, program: p })));
}

export function sourceAgentName(agent) {
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

/* Why a control is held. Kept separate from the capability reasons the dock is
   forbidden to echo — this is about the feed, not about routing. */
export function staleControlNote(alarm) {
  if (!alarm) return "";
  return alarm.kind === "offline"
    ? "Held — the server is unreachable, so there is no safe route to this session."
    : "Held — the board is " + fmtElapsed(alarm.ageMs) + " out of date. Refresh before sending.";
}

state.aliases = state.labels;

export function surfaceCollisions(payload) {
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

export function terminalBreadcrumb(agent, displayName) {
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

export function terminalIdentity(agent) {
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

export function terminalSourceName(agent) {
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

export const workspaceLabelTarget = (workspaceId) => ({ kind: "workspace", workspaceId });


/* Snapshot index, memoised per snapshot object. Lives here beside
   snapshotAgents: it is a view OF the snapshot, and both the board and the
   notifier need it, so neither should own it.

An immutable snapshot yields the same index every time, but affectedImpact
   rebuilt it once PER ISSUE — O(issues × agents) per pass, and renderHealthRail
   drives several passes per paint. Keyed on the snapshot object itself, so
   adopting a new snapshot invalidates it for free and nothing has to be cleared

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
const agentIndexCache = new WeakMap();

export function agentsById(snap = state.snap) {
  if (!snap || typeof snap !== "object") return new Map();
  const cached = agentIndexCache.get(snap);
  if (cached) return cached;
  const index = new Map(snapshotAgents(snap).map(({ agent, program }) => [agent.id, { agent, program }]));
  agentIndexCache.set(snap, index);
  return index;
}
