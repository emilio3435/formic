/* Agent model — what the data on the wire MEANS, with nothing about how it looks.

   This layer answers questions about one agent or one program: is it working, is
   it healthy, is its process alive, does it want a human, how full is its context
   window, does it belong in this view. Every function here is pure: no DOM, no
   module state, no network, no rendering. That is the seam — app.js imports
   answers instead of re-deriving them, and all of it can be reasoned about and
   tested without a document or a snapshot fetch.

   Deliberately NOT here: anything that reads `state` (contextDisplayValue's
   display default, agentName's alias lookup, matchesQuery via programName) and
   anything that formats for a surface. Those belong to the client, not the model.
   Keeping the boundary at "does it touch mutable state" is what makes this file
   safe to import from anywhere without an evaluation-order hazard. */

import { fmtTok } from "./text-formatters.js";
import { DEFAULT_LOOKBACK_HOURS } from "./client-catalogs.js";
import { deriveLifecycle } from "./lifecycle.js";

/* ---------- derivations (narrow fallbacks for the transitional schema) ----------
   The server now emits activity/outcome/controlState directly; when a snapshot
   predates those fields we derive them from the provider-native status only. */

export function deriveActivity(agent) {
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

/* The preferred reader. `lifecycle` is what the server publishes and what every
   surface below is keyed to; when a snapshot arrives without it — an older
   server, a cached response — src/web/lifecycle.js classifies from the fields
   that predate the contract, against the same truth table the server runs.

   `deriveActivity` above is deliberately untouched and no longer feeds any of
   this. It maps a quiet session straight to "ended" with none of the server's
   rescue for a live process, which is the divergence the contract exists to
   remove; it survives only as the legacy activity word for callers that still
   want one. */
export function lifecycleOf(agent) {
  return deriveLifecycle(agent || {}).lifecycle;
}

export function provenanceOf(agent) {
  return deriveLifecycle(agent || {}).provenance;
}

/* Whether the board is still watching this session, or only holds a record of
   it. Not part of the lifecycle: leaving the scan window is a fact about the
   board's reach, not about the session's ending. */
export function scopeOf(agent) {
  return agent && agent.scope === "retained" ? "retained" : "observed";
}

/* One predicate for "nothing more will happen here", which is what History
   contains and what strips a row's controls. Finished OR retained — the two are
   different facts and both are terminal. */
export function isTerminal(agent) {
  return lifecycleOf(agent) === "finished" || scopeOf(agent) === "retained";
}

/* And its opposite, which is what "live" means everywhere on this board.
   Unverified is in NEITHER: it is not live, because nothing can vouch for it,
   and it is not terminal, because nothing ended it. */
export function isLive(agent) {
  if (scopeOf(agent) === "retained") return false;
  const state = lifecycleOf(agent);
  return state === "working" || state === "waiting";
}

export function deriveOutcome(agent) {
  if (agent.outcome) return agent.outcome;
  if (deriveActivity(agent) === "ended") return "healthy";
  return agent.status === "attention" ? "needs-you" : "healthy";
}

export function deriveControlState(agent) {
  if (agent.controlState) return agent.controlState;
  if (deriveActivity(agent) === "ended") return "observed-only";
  const t = agent.target || {};
  /* "exact" and "unique-cwd" are not the same claim and must not share a word.

     exact means cmux ATTESTS this session is on that surface. unique-cwd picks
     among panes whose identity evidence is EMPTY, by elimination on a directory
     string — by construction a pane cmux cannot identify. Calling both "Linked"
     is what let a Send addressed to one agent execute on another's terminal and
     return ok: true (proven against probe agents, adc1da0).

     The server now refuses the write. If the chip still read "Linked" beside a
     dead Send button, the operator would read a bug and retry it, which is the
     precise failure this state exists to prevent. */
  if (t.surfaceId && t.resolution === "exact") return "linked";
  if (t.surfaceId && t.resolution === "unique-cwd") return "unproven";
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
export const LIVENESS_WORDS = {
  running: "running", alive: "running", live: "running", "process-alive": "running",
  up: "running", active: "running",
  exited: "exited", "exited-clean": "exited", "clean-exit": "exited", clean: "exited",
  finished: "exited", completed: "exited", complete: "exited", done: "exited",
  died: "died", dead: "died", "process-gone": "died", gone: "died", crashed: "died",
  killed: "died", terminated: "died",
  unknown: "unknown", "no-evidence": "unknown", unclear: "unknown", indeterminate: "unknown",
};

export const LIVENESS_VIEW = {
  running: { label: "Process live", tone: "ok", detail: "The agent's process is still running." },
  exited: { label: "Exited cleanly", tone: "calm", detail: "The process finished and its transcript ended cleanly — this one is done." },
  died: { label: "Died", tone: "alert", detail: "The process is gone and nothing ended cleanly. This session stopped without finishing." },
  /* Two earlier wordings, and the reason each failed, because the next reader
     will otherwise propose one of them again.

     "Liveness unknown" named the tool's gap rather than the world's state and
     read as a defect. "Awaiting first check" replaced it and promised an event
     instead — a promise the board keeps for some sessions and breaks for
     others. Watched live for 16 minutes (2026-08-03 22:12–22:28 UTC): of the 6
     live agents that wore this chip, 2 cleared within ~6 minutes of starting
     because a check DID arrive and bound a process — neither ended — while 4
     aged 7 to 40 minutes never cleared at all. So the honest label cannot speak
     about timing in either direction.

     What is true of all of them is the fact itself. `processStateFor` returns
     "unknown" as its FALLTHROUGH, reached whenever no process was matched to
     the session: `identity-bindings.ts:251` records process ids only for a
     session whose process the scan could actually see. Measured, it tracks
     routing rather than time — across both samples 11 of 11 live unknowns were
     `observed-only` or `quarantined` and 7 of 7 live knowns were `linked`. */
  unknown: { label: "No matching process", tone: "quiet", detail: "Nothing in the process scan matches this session, so the board cannot say whether its process is alive." },
};

/* The same wire value on an ENDED session carries one more fact, and it is the
   one an operator acts on: nothing will ever match it now, so the question of
   how it finished is closed unanswered rather than open. That is why the split
   survives the rewording above — not because a live session is "awaiting" and
   this one is not, but because only this one is unrecoverable. On the live
   board it is the common case, not an edge case: 627 of 631 unknowns are ended
   sessions. */
export const LIVENESS_ENDED_UNKNOWN = {
  label: "No process evidence",
  tone: "quiet",
  detail: "This session ended without process evidence, so whether it finished cleanly or crashed cannot be recovered.",
};

export function livenessState(agent) {
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
export function livenessView(agent) {
  const key = livenessState(agent);
  if (!key) return null;
  // Same wire value, two different facts — see LIVENESS_ENDED_UNKNOWN. The key
  // is untouched, so the chip's styling and every existing selector still match.
  if (key === "unknown" && isTerminal(agent)) {
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
/* The agent's own claim on a human, as computed by the server.

   attentionSignal carries WHY a session wants someone — the kind, the quoted
   evidence, and the next action — and the client read none of it: a grep for the
   field across src/web returned nothing. An agent that merely ASKS a question is
   structurally healthy, so it failed the outcome test below and was excluded from
   every attention surface at once: the tab, the title badge, the notifier and the
   program rollup. The reason was computed correctly, serialised correctly, and
   discarded at the last step.

   Live sessions only, and that is not a detail. Every agent on the board carrying
   a signal today is archived, because a handed-back decision is exactly the note
   a session leaves as it finishes. An archived agent wants nothing from anyone —
   its record is a fact the board already shows in History and nobody acts on one —
   so wiring those in would have swapped a false negative for six false
   positives. */
/* cmux's provider hook store, saying the agent is blocked on a human. This is a
   DECLARED fact — the agent told cmux so — where `attentionSignal` is read off
   prose and inferred. Declared outranks inferred everywhere else in this
   program; it has to here too, and it is the only route that survives a
   hibernated pane, whose transcript says nothing at all. */
export function hookWantsInput(agent) {
  return Boolean(agent) && agent.hookLifecycle === "needsInput";
}

/* The `!isTerminal` gate is load-bearing, not incidental. A hook record freezes
   at whatever it last said, so a session that died mid-question reads
   needsInput forever. Measured on the live board: 46 sessions said needsInput
   and 45 of them were checked by id, against a COMPLETE process roster, and
   found gone — dead between 1.8 and 31.7 hours. Exactly one was live, and it
   was already reaching the operator through its attention signal.

   So this gate is what separates "the agent is asking" from "the agent was
   asking when it died". Removing it puts 45 ghosts in the Needs-you strip,
   which is the same failure alerting()'s rescue arm below has a scar for. */
export function wantsHuman(agent) {
  return Boolean(agent && (agent.attentionSignal || hookWantsInput(agent))) && !isTerminal(agent);
}

export function alerting(agent) {
  if (wantsHuman(agent)) return true;
  if (deriveOutcome(agent) === "healthy") return false;
  if (!isTerminal(agent)) return true;
  /* The rescue arm, kept for legacy snapshots. A terminal row alerts only on
     POSITIVE evidence its process is still there — which under the contract is
     a contradiction the server now discloses on the row itself, but an older
     snapshot has no lifecycle for this client to read and this is what caught
     the ghost then. It retires with schemaVersion 2. */
  return livenessState(agent) === "running";
}

export function deriveRollup(agents) {
  const state = (a) => lifecycleOf(a);
  const out = (a) => deriveOutcome(a);
  const observed = agents.filter((a) => scopeOf(a) === "observed");
  return {
    total: agents.length,
    live: agents.filter(isLive).length,
    working: observed.filter((a) => state(a) === "working").length,
    /* `idle` keeps its wire name and means Waiting. The rollup is read by name
       in several places and by the server's own rollupFor; renaming it is a
       schema-2 job, not a rendering one. */
    idle: observed.filter((a) => state(a) === "waiting").length,
    unverified: observed.filter((a) => state(a) === "unverified").length,
    ended: agents.filter(isTerminal).length,
    /* The one verdict, not a second opinion about it. This re-derived "wants a
       human" from outcome and activity, so the program rollup counted a
       different population than the tab beside it — it missed every attention
       signal, and it missed an ended-but-still-running session that alerting()
       has rescued since. Two populations, one word. */
    needsYou: agents.filter((a) => alerting(a)).length,
    blocked: agents.filter((a) => out(a) === "blocked").length,
    failed: agents.filter((a) => out(a) === "failed").length,
    linked: agents.filter((a) => deriveControlState(a) === "linked").length,
  };
}

export const programRollup = (program) => program.rollup || deriveRollup(program.agents);

/* Does this agent belong in this lens?

   Only `board`, `history` and `usage` are tabs (OPS_VIEWS/VIEWS). The rest are
   named lenses the board still asks for by hand — `needs-you` is the strip's
   population and the notifier's, `working` is the landing roster's — and each
   one is a single expression over the same lifecycle so no two surfaces can
   answer the same question differently. */
export function viewMatches(view, agent) {
  const state = lifecycleOf(agent);
  const observed = scopeOf(agent) === "observed";
  switch (view) {
    /* One scroll over the whole live fleet: working, waiting and unverified,
       plus anything alerting() rescues (an ended transcript whose process is
       still up and still asking for a person). It is the union of the three
       tabs it replaced, so no agent that was reachable before is unreachable
       now — which is the property that makes collapsing the tabs safe. */
    case "board":
      return (observed && (state === "working" || state === "waiting" || state === "unverified"))
        || alerting(agent);
    // Both read the shared alerting() verdict, so Now and Needs you can never
    // disagree about whether a given agent is waiting on a person.
    case "now": return (observed && state === "working") || alerting(agent);
    case "needs-you": return alerting(agent);
    case "working": return observed && state === "working";
    /* Waiting holds the unverified sessions too, grouped and counted apart in
       the render. They have to live somewhere findable: History is where the
       original missing-session incident sent them, and a tab of their own taxes
       every glance for a distinction about evidence quality. */
    case "idle": return observed && (state === "waiting" || state === "unverified");
    case "history": return isTerminal(agent);
    case "usage": return false;
    default: return true;
  }
}

/* Which lifecycle band a row sits in inside its program group, and the order
   the bands are drawn in. Board only: History is one band by definition, and a
   divider that says "Waiting" over a finished session would be a lie.

   Read off the SAME lifecycle the sections claim to be about, rather than a
   second derivation from status — that seam is what let the program rollup
   count a different population than the tab beside it. A row whose state
   matches none of the three (an ancestor pulled in to hold a swarm together)
   returns null and renders above the first divider, unlabelled, because there
   is no honest label for it. */
export const LIFECYCLE_SECTIONS = ["active", "waiting", "unverified"];

export function lifecycleSection(agent) {
  if (scopeOf(agent) !== "observed") return null;
  switch (lifecycleOf(agent)) {
    case "working": return "active";
    case "waiting": return "waiting";
    case "unverified": return "unverified";
    default: return null;
  }
}

/* The Unverified section at the bottom of each program group on the board. */
export function isUnverified(agent) {
  return scopeOf(agent) === "observed" && lifecycleOf(agent) === "unverified";
}

export function parseLookbackHours(raw) {
  if (raw == null || raw === "" || raw === "all") return null;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) return DEFAULT_LOOKBACK_HOURS;
  return Math.min(24 * 30, Math.max(1, Math.round(hours)));
}

export function withinLookback(agent, lookbackHours, nowMs = Date.now()) {
  if (lookbackHours == null) return true;
  const updated = Date.parse(agent.updatedAt);
  if (!Number.isFinite(updated)) return false;
  return nowMs - updated <= lookbackHours * 3_600_000;
}

/* The lookback rides Board because Board now holds what the Waiting tab held —
   the largest population on the machine, most of it hours old. Working rows are
   by definition minutes old and never feel it, and the Unverified group is
   exempt below, so in practice it hides exactly what it hid before. */
export function lookbackApplies(view) {
  return view === "board" || view === "history";
}

/* The Unverified group is EXEMPT from the lookback, and that exemption is what
   makes the state visible at all.

   The lookback is a recency filter, and unverified sessions are by definition
   not recent — on this machine 181 of the 205 in-window ones are more than six
   hours quiet, so at the default lookback of 6h the group would be empty on
   almost every load and the flagship state of this contract would ship
   invisible. It is not a recency list; it is a disclosure of what the board
   cannot account for, and a coverage disclosure that hides most of the gap is
   worse than none. Ordinary Waiting rows keep the lookback. */
export function passesLookback(agent, view, lookbackHours, nowMs = Date.now()) {
  if (!lookbackApplies(view)) return true;
  if (isUnverified(agent)) return true;
  return withinLookback(agent, lookbackHours, nowMs);
}


export function buildClusters(agents) {
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

export function tokenSummary(tokens) {
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
  const latestTurn = tokens.scope === "latest-turn";
  const scopeNote = latestTurn
    ? "Latest model call — NOT the session total, and not addable to the program rollup. "
    : "Cumulative tokens for this session. ";
  const title = scopeNote + (parts.length ? parts.join(" · ") + " · " : "") + "provenance: " + tokens.provenance;
  /* The scope is a MARK, not a sentence.

     It has been both extremes and both were wrong. It began as a bare number
     with the qualifier hidden in a title attribute, and a qualification visible
     only on hover is one that does not exist — a row reading "128k tokens" sat
     beside a program rollup reading "65.7M session tokens", roughly 500x apart
     and not summable, with nothing on screen saying so. The fix was to print
     "latest call" on the row, which made the qualification real but printed two
     words on every one of 250 rows to say something that is true of nearly all
     of them.

     `scopeMarked` keeps what mattered — something VISIBLE that says "this
     number has a condition on it" — and spends one character on it instead of
     eleven. The full sentence is one hover away, and now there is a mark that
     tells you to hover. */
  const text = tokens.total != null
    ? marks[tokens.provenance] + fmtTok(tokens.total)
    : marks[tokens.provenance] + parts.join(" · ");
  return { label, text, known: true, title, scopeMarked: latestTurn };
}

export function contextUsage(tokens) {
  if (!tokens || tokens.scope !== "latest-turn" || tokens.provenance !== "observed" ||
      !Number.isFinite(tokens.total) || !Number.isFinite(tokens.contextWindow) || !(tokens.contextWindow > 0)) return null;
  const rawPct = Math.max(0, Math.round((tokens.total / tokens.contextWindow) * 100));
  return { pct: Math.min(100, rawPct), text: fmtTok(tokens.total) + " of " + fmtTok(tokens.contextWindow) + " (" + rawPct + "%)" };
}

