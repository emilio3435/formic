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
import { alerting, deriveActivity, deriveControlState, deriveOutcome, isTerminal, livenessState, provenanceOf } from "./agent-model.js";
import { state } from "./client-state.js";
import { ROLE_ALIASES, ROLE_LABELS } from "./client-catalogs.js";

export { ROLE_ALIASES, ROLE_LABELS };

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

/* Did the FLEET declare this name, or derive it? The run manifest is where an
   orchestrator writes what a lane IS — `fe-states`, `be-live` — and that id is
   what the operator types to address it, what every sibling lane calls it, and
   what the lane signs its own DONE line with.

   The distinction is load-bearing directly below, because cmux titles its own
   panes. `surfaceTitle` is routinely a sentence cmux distilled from the
   session's opening prompt and `workspaceTitle` is the workspace path; neither
   is a human deciding what a session is called. Counting them as renames put
   "Unify lane fe-states and audit tags with TDD" on the Needs-you strip for a
   lane the API named `fe-states`, and a workspace path on a swarm child the API
   named `be-live` — one session reading three ways across three surfaces. */
export function declaredIdentity(agent) {
  return Boolean(agent && agent.identity && agent.identity.source === "manifest");
}

/* The name a HUMAN typed for this row, or "" when nobody did: a label entered
   in Ant Hill, then one typed onto the cmux pane itself. Split out from
   agentName so a caller can tell "the operator named this" from "the fleet
   named this" without comparing strings — the row needs that distinction to
   decide whether the server's disambiguator belongs beside the name. */
export function operatorName(agent) {
  if (!agent) return "";
  const agentLabel = state.aliases.get(presentationLabelKey(agentLabelTarget(agent)));
  if (agentLabel) return agentLabel;
  if (agent.target && agent.target.workspaceId) {
    const workspaceLabel = state.aliases.get(presentationLabelKey(workspaceLabelTarget(agent.target.workspaceId)));
    if (workspaceLabel) return workspaceLabel;
  }
  const terminal = terminalSourceName(agent);
  /* A SURFACE rename is this pane's own name and belongs to the session even
     when the pane's folder differs — an orchestrator parked in the home
     directory while its work lives in a project is the normal shape, not an
     anomaly. A WORKSPACE title is broader context, so it stays suppressed on
     that mismatch: otherwise the same home-cwd orchestrator borrows the name of
     whichever project it happens to sit beside. */
  /* ...and a DECLARED name outranks both, because cmux wrote both of them. The
     title is not lost: quietSourceLine still prints it as "Terminal: …", which
     is how an operator finds the pane, and which went silent here only while
     the name and the title were the same string. */
  const renamed = typeof agent.surfaceTitle === "string" && agent.surfaceTitle.trim() !== "";
  if (terminal && !declaredIdentity(agent) && (renamed || agent.target?.cwdRelation !== "different")) return terminal;
  return "";
}

export function agentName(agent) {
  if (!agent) return "";
  return operatorName(agent) || sourceAgentName(agent);
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
  let text = String(value || "").split("\n")[0].replace(/^(goal:|you are)\s*/i, "").trim();
  /* The snippet is the line the operator reads to decide whether to act, and
     it was spending its budget on transport: `[PR #21](https://github…)`
     burned half the line saying "PR #21", and a cmux workspace UUID carries
     zero decision value. Links keep their words, http URLs shrink to
     host/…/tail, other schemes to their scheme, long hex runs to an
     ellipsis. The full text stays in the drawer. */
  text = text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\bhttps?:\/\/\S+/gi, (url) => {
      const m = /^https?:\/\/([^/\s]+)(?:\/(\S*))?$/.exec(url.replace(/[.,;)\]}'"]+$/, ""));
      if (!m) return url;
      const tail = m[2] ? m[2].split(/[/?#]/).filter(Boolean).pop() : "";
      return tail ? m[1] + "/…/" + tail : m[1];
    })
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, (url) => url.split("://")[0] + "://…")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "…")
    .replace(/\b[0-9a-f]{32,}\b/gi, "…")
    .replace(/\s{2,}/g, " ");
  if (text.length <= limit) return text;
  const clipped = text.slice(0, limit - 1);
  const boundary = clipped.lastIndexOf(" ");
  return clipped.slice(0, boundary > limit * 0.65 ? boundary : clipped.length).trimEnd() + "…";
}

/* Plain-language control explanation for the Operate chrome. Never echoes
   capability reasons here — live reasons carry raw cmux/session IDs, which
   belong only in Evidence. */
export function controlUnavailableText(controlState, agent = null) {
  /* Archived and dead both arrive here as "observed-only". They are different
     facts and the summary line must not flatten them into a routing complaint.
     (quarantineBrief owns the long form; this is the short one the dock's
     accessible text uses.) */
  if (agent && isTerminal(agent)) {
    const why = provenanceOf(agent);
    if (why === "operator-archive") return "Controls are off because you archived this session.";
    if (why === "provider-exit") return "Controls are off because the source recorded a session exit.";
    if (why === "aged-out") return "Controls are off because this session left the scan window; only its record is kept.";
    if (why === "process-died" || livenessState(agent) === "died") {
      return "Controls are off because this session's process is gone — there is nothing left to receive them.";
    }
    if (why === "process-absent") {
      return "Controls are off because no running process claims this session — there is nothing left to receive them.";
    }
  }
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

/* The destination as a VISIBLE label, not a tooltip.

   focusDestinationHint below is a `title` attribute — the weakest disclosure
   surface there is. It never appears on keyboard focus or touch, and an
   operator who moves the mouse to the button and clicks reads nothing. The
   strong wording lives in the drawer banner, which requires having already
   stopped to investigate.

   That is backwards for the row it matters on. `unique-cwd` is matched by
   folder among panes carrying no identity evidence, so Focus can walk an
   operator to a stranger's terminal while the row still reads healthy — and
   naming the destination is what this project chose INSTEAD of gating the
   control, because looking is how an operator recovers once the write controls
   are off. A name nobody sees is not an alternative to gating.

   Only on unproven rows: on a `linked` row the destination is proven and a
   suffix on every button would be noise that trains the eye to skip it. */
export function focusButtonLabel(agent, controlState) {
  if (controlState !== "unproven") return "Focus";
  const id = terminalIdentity(agent);
  const name = id ? (id.paneFolder || id.title) : "";
  return name ? "Focus → " + name : "Focus";
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
export function identityTraceView(agent, trace) {
  const resolved = (trace !== undefined ? trace : (agent && agent.identityTrace)) || null;
  const target = (agent && agent.target) || {};
  const rawSteps = resolved && Array.isArray(resolved.steps) ? resolved.steps : [];
  return {
    resolution: (resolved && resolved.resolution) || target.resolution || "missing",
    matchedTier: (resolved && resolved.matchedTier) || null,
    reason: (resolved && resolved.reason) || null,
    surfaceId: (resolved && resolved.surfaceId) || target.surfaceId || null,
    bridge: (resolved && resolved.bindingBridge) || null,
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
    /* A per-session "running a non-approved model" finding was synthesized here,
       one per mismatched Cursor session, on top of the server's single aggregate.

       It was unreachable work twice over. The policy it enforced is gone (see
       snapshot-agent.ts). And the row could never have been actioned even while
       the policy stood: `policy:<agentId>` is an id the CLIENT invents, so it is
       absent from snapshot.issues, and handleTriageRequest resolves triage
       targets out of exactly that array — every Triage click on one of these
       returned 404 ISSUE_NOT_FOUND. Seven such rows were on the live board.

       The rule this leaves behind: this function may SHAPE what the server sent,
       never mint an id the server has not published. Anything the client invents
       has no counterpart to act on. */
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

/* The SPAN reading as a NUMBER — first activity to last, dormancy included, with
   the same live drift correction the cell applies so a running session's span
   does not freeze between snapshots.

   Split out of liveElapsedText because the Span lens buckets sessions by this
   duration, and a lens that computed its own would be a second definition of
   "how long has this been going" sitting one column away from the first. They
   would agree until the day they did not, and the disagreement would show up as
   a row that reads 9h sitting under a filter for "1–8h". One number, two
   renderings. Returns null when the span is unmeasurable, which is a real state
   and not a zero. */
export function liveElapsedMs(agent, generatedAt) {
  if (agent.elapsedMs == null) return null;
  if (deriveActivity(agent) !== "ended" && generatedAt) {
    const drift = Date.now() - Date.parse(generatedAt);
    if (Number.isFinite(drift) && drift > 0) return agent.elapsedMs + drift;
  }
  return agent.elapsedMs;
}

export function liveElapsedText(agent, generatedAt) {
  const ms = liveElapsedMs(agent, generatedAt);
  return ms == null ? "—" : fmtElapsed(ms);
}

/* modelPolicyView() stood here, turning agent.modelPolicy into a compliance
   badge. The field no longer exists — the hub judges no Cursor session on which
   model it runs. The model itself is still collected and still rendered; only
   the verdict about it is gone. */

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
  /* Three refusals now end in the same disabled button, and they are not the
     same message. The pane one is recoverable by looking; the dead one is not
     recoverable at all; the archived one is a choice the operator made. Both
     `archived` and `died` collapse to the control state "observed-only", so
     before this they shared one sentence about cmux routing — which is wrong
     for both of them, and most wrong for archive, where nothing is broken.

     Checked before the routing branches on purpose: an archived session's
     controls are off because it is archived, whatever its pane says, and a dead
     process cannot be typed into however cleanly it resolves. Naming the
     routing problem of a session that has ENDED sends the operator to fix a
     terminal binding that no longer matters. */
  const ended = isTerminal(agent);
  const why = provenanceOf(agent);
  /* Four endings, four explanations. They all read "You archived this session"
     before, including the ones no human had touched — so an operator was told
     they had made a decision they had not made, about a session a provider
     closed or that simply drifted out of the scan window. */
  /* The contradiction, disclosed rather than resolved. An operator archive
     outranks a live process — human intent wins — and a source can record an
     exit while its harness lingers. Silently overturning either would be the
     board deciding it knows better than the evidence in front of it; saying so
     lets the operator decide. */
  if (ended && livenessState(agent) === "running") {
    return {
      title: why === "operator-archive"
        ? "You archived this session, and its process is still running."
        : "This session ended, but its process is still up.",
      summary: why === "operator-archive"
        ? "Your decision stands — the board files it as finished — but something is still running under it."
        : "The source recorded a session exit while a matching process is still alive; the harness may be lingering.",
      why: "These are two different sources of truth and they disagree. The board reports both rather than picking one quietly.",
      nextStep: why === "operator-archive"
        ? "Un-archive it if you filed it early, or leave it filed and let the process finish."
        : "Check the terminal if this is unexpected.",
      cause: "archived",
      steps: [],
    };
  }
  if (ended && why === "provider-exit") {
    return {
      title: "This session ended.",
      summary: "The source recorded a session exit, so there is nothing left to control.",
      why: "A provider writes a session exit when the session itself closes — not when a turn finishes. Its transcript stays readable in History.",
      nextStep: "Read it in History, or start a new session if there is more work.",
      cause: "archived",
      steps: [],
    };
  }
  if (ended && why === "aged-out") {
    return {
      title: "This session left the scan window.",
      summary: "Nothing ended it — the board simply stopped watching, and kept the record.",
      why: "Collectors read transcripts inside the scan window. Past it a session is no longer observed, so no current evidence about it exists to control on.",
      nextStep: "Widen the scan window in Settings if you need sessions this old back on the board.",
      cause: "archived",
      steps: [],
    };
  }
  /* Deliberately NOT branching on process-died here: the block below already
     owns that sentence, and owns it better — it is the one refusal on this
     board that offers no repair, because none exists. */
  /* `process-absent` is excluded alongside `process-died` for the same reason
     and one more: nobody archived these. They are the sessions the roster found
     nothing running for, and telling an operator they filed it themselves is a
     false claim about their own actions. */
  if (ended && why !== "process-died" && why !== "process-absent") {
    return {
      title: "You archived this session.",
      summary: "Controls are off because it is archived, not because anything failed.",
      why: "Archiving files a session as finished and takes it off the working board. It stays readable in History.",
      /* No repair step, because nothing is broken. Offering one would invent a
         problem out of a deliberate choice. */
      /* Finally true. This sentence shipped with the archive and had no store
         method, endpoint or button behind it for its entire life. */
      nextStep: "Nothing to do. Un-archive it if you filed it early.",
      cause: "archived",
      steps: [],
    };
  }
  if (ended && (why === "process-died" || why === "process-absent" || livenessState(agent) === "died")) {
    return {
      title: "This session's process is gone.",
      summary: "Controls are off because there is nothing left running to receive them.",
      /* Two different observations reach this sentence and it says which. The
         board watched one set of pids disappear; for the other it never saw a
         process at all and is arguing from a complete scan of the machine. Both
         mean the same thing for controls; only one is a death it witnessed. */
      why: (why === "process-absent"
        ? "Every running process was listed and none of them is serving this session, so its terminal pane may since have been taken by something else."
        : "The process was checked and is no longer there, so its terminal pane may since have been taken by something else.")
        + " Typing into it would reach whatever is there now.",
      /* Deliberately offers no recovery, because there is none. Every other
         refusal on this board ends with the thing that would fix it, and
         inventing one here would send an operator to retry something that
         cannot work — the exact failure the whole refusal vocabulary exists to
         prevent. */
      nextStep: "Nothing will bring it back. Read the transcript below, then archive it when you are done with it.",
      cause: "died",
      steps: [],
    };
  }
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

/* ---------- message provenance ----------

   The producer helper prefixes every orchestrator→lane message with
   `[from <agent.id> run <runId>]`. That envelope is the answer to a question the
   drawer was getting wrong: `lastUserMessage` is labelled "You", and for every
   lane in every swarm it was sent by another AGENT, not by the operator.

   Anchored at the START, deliberately. An agent quoting an instruction back
   before answering is extremely common — this file already carries a scar from
   a dedup rule that mistook a quote for a repeat — and a header in the middle of
   prose is a session TALKING about a message, not a claim about who sent this
   one. Provenance is only a fact when it is the envelope.

   The absence of a header is itself the signal: a user turn with none really was
   the human, which is what makes an injected instruction distinguishable. */
const SENDER_HEADER = /^\s*\[from\s+([^\s\]]+)\s+run\s+([^\s\]]+)\]\s*/;

export function parseSenderHeader(text) {
  const value = typeof text === "string" ? text : "";
  const match = SENDER_HEADER.exec(value);
  if (!match) return null;
  const [envelope, agentId, runId] = match;
  if (!agentId || !runId) return null;
  return { agentId, runId, body: value.slice(envelope.length).trim() };
}

/* Which fields actually carry it, measured rather than assumed: on the live
   board the envelope sits on `lastUserMessage` and `task`, and on NEITHER of the
   four atlas lanes' `lastHumanMessage` — that field mirrored the agent's own
   reply. It is left out on purpose as well as on evidence: filling an
   attribution from the one field the server documents as "assistant OR user
   prose" is precisely how the "You" mislabel got in. */
/* WHICH field the sender claim is read from — the mirror of `senderClaimFor` in
   src/server/sender-verification.ts, and it has to stay a mirror, because the
   server verifies the claim it reads and the client attributes the claim it
   reads. Two different answers means the board says "confirmed" about a message
   nobody checked.

   A present `lastUserMessage` IS the current request and is authoritative even
   with no header: an unheaded user turn really was the human, and that absence
   is the whole signal that makes an injected instruction visible. `task` is only
   the fallback, because it stays headed forever — the kickoff envelope is still
   sitting on it hours later. Falling through to it attributed a human's own
   follow-up to the orchestrator that opened the lane, on a row whose current
   request had no sender at all. */
export function senderClaimText(agent) {
  if (!agent) return undefined;
  return typeof agent.lastUserMessage === "string" ? agent.lastUserMessage : agent.task;
}

export function senderOf(agent) {
  const parsed = parseSenderHeader(senderClaimText(agent));
  return parsed ? { agentId: parsed.agentId, runId: parsed.runId } : null;
}

/* The prose without its addressing. A row gets ~120 characters and the envelope
   is 74 of them, so this is not tidiness — it is half the line back. */
export function withoutSenderHeader(text) {
  const parsed = parseSenderHeader(text);
  if (parsed) return parsed.body;
  return typeof text === "string" ? text : "";
}

/* How a role was decided, as something an operator can SEE. 1006 sessions on
   the live board carry `inferred` against 4 `declared`, so a role chip that
   renders a guess and a declaration identically is stating false confidence
   about almost the whole fleet. Whole class-name literals: styles.css's orphan
   lint reads the source as text and a name built at runtime is invisible to it
   in both directions. */
export const ROLE_SOURCE_VIEW = {
  declared: {
    className: "role-src-declared",
    title: "Role declared at spawn — from the run manifest or ANTHILL_ROLE",
  },
  observed: {
    className: "role-src-observed",
    title: "Role observed from lineage — this session has children of its own",
  },
  inferred: {
    className: "role-src-inferred",
    title: "Role inferred from the session title — a guess, not a declaration",
  },
};

export function roleSourceView(roleSource) {
  return ROLE_SOURCE_VIEW[roleSource] || null;
}

/* Territory, not authority — which is why B4 took frontend/backend out of the
   role union. It still has to reach the screen: before the demotion those
   sessions read "Frontend / designer", and after it they read "Worker" with the
   fact on the wire and nowhere else. */
export const SPECIALTY_LABELS = { frontend: "Frontend", backend: "Backend" };

export function specialtyLabel(agent) {
  return (agent && SPECIALTY_LABELS[agent.specialty]) || "";
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
  /* The server decided this, across the whole fleet, and it is the only answer
     that can be unique. Everything below is the pre-contract fallback, reachable
     now only for an archived record filed before `identity` was published. */
  if (agent.identity && agent.identity.name) return conciseText(agent.identity.name);
  if (agent.nickname) return conciseText(agent.nickname);
  const identity = cwdIdentityName(agent);
  const display = typeof agent.displayName === "string" ? agent.displayName.trim() : "";
  /* The heuristic this replaces, kept only for those legacy rows: "a name is
     trustworthy if it contains · and is under 56 characters". It was an attempt
     to tell an authored name from a derived one without being told which was
     which, and it got the answer backwards — every DERIVED name matches it
     (they are all "Provider · folder") and an authored one like "Lifecycle
     Mapper" does not, so a name a human chose lost to the folder it ran in. */
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
    ? "Snapshot unavailable · Controls held — the server is unreachable. Waiting for a fresh snapshot before sending."
    : "Snapshot stale · Controls held — the board is " + fmtElapsed(alarm.ageMs) + " out of date. Waiting for a fresh snapshot before sending.";
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

/* A cmux pane title is a live terminal title, so it carries whatever animation
   frame the agent inside it happened to be drawing when the scan ran. Measured
   on the board: agentName() returned "⠐ Swarm audit backend investigation with
   codex" and "⠂ Deploy backend fixes via Codex" — a single frame of Claude
   Code's braille spinner, frozen into the session's NAME and rendered wherever
   that name goes: the roster row, the finding title in the summary band, the
   drawer head, the notification. The displayName underneath was clean the whole
   time.

   Only leading spinner glyphs, and only the two families that are actually
   spinners: the Braille Patterns block and the asterisk dingbats Claude Code
   cycles. Names legitimately contain emoji and punctuation, so this does not
   reach for anything more general than the thing it was built to remove. */
const SPINNER_PREFIX = /^(?:[\u2800-\u28FF\u2722\u2733\u273B\u273D\u2731\u2217*]+\s+)+/;
export function stripSpinnerFrame(title) {
  return typeof title === "string" ? title.replace(SPINNER_PREFIX, "") : title;
}

export function terminalSourceName(agent) {
  /* The pane's own rename first, the workspace's title second. cmux reports
     both and they mean different things — see operatorName, which is the only
     caller that acts on the difference. */
  const surface = agent && typeof agent.surfaceTitle === "string"
    ? stripSpinnerFrame(agent.surfaceTitle.trim()).trim()
    : "";
  const workspace = agent && agent.target && typeof agent.target.workspaceTitle === "string"
    ? stripSpinnerFrame(agent.target.workspaceTitle.trim()).trim()
    : "";
  const title = surface || workspace;
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
