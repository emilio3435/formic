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
export function wantsHuman(agent) {
  return Boolean(agent && agent.attentionSignal) && deriveActivity(agent) !== "ended";
}

export function alerting(agent) {
  if (wantsHuman(agent)) return true;
  if (deriveOutcome(agent) === "healthy") return false;
  if (deriveActivity(agent) !== "ended") return true;
  return livenessState(agent) === "running";
}

export function deriveRollup(agents) {
  const act = (a) => deriveActivity(a);
  const out = (a) => deriveOutcome(a);
  return {
    total: agents.length,
    live: agents.filter((a) => act(a) === "working" || act(a) === "idle").length,
    working: agents.filter((a) => act(a) === "working").length,
    idle: agents.filter((a) => act(a) === "idle").length,
    ended: agents.filter((a) => act(a) === "ended").length,
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

export function viewMatches(view, agent) {
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

export function lookbackApplies(view) {
  return view === "idle" || view === "history";
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
  const scopeNote = tokens.scope === "latest-turn" ? "latest model call · " : "";
  const title = scopeNote + (parts.length ? parts.join(" · ") + " · " : "") + "provenance: " + tokens.provenance;
  /* The scope is part of the number, not a tooltip. A row read "128k tokens"
     beside a program rollup reading "65.7M session tokens" — the row is the
     LATEST model call, the rollup is cumulative sessionTotal across every agent
     including ended ones, roughly 500x apart and not summable. The qualifier
     existed, in a title attribute, and a qualification visible only on hover is
     a qualification that does not exist: nobody hovers a number that looks
     self-explanatory.

     " tokens" was also the weakest possible word here, since the column header
     already says Tokens. Spending it on the scope costs nothing and makes the
     impossible addition visibly impossible. (Render-first audit §2.) */
  const scopeWord = tokens.scope === "latest-turn" ? " latest call" : " tokens";
  const text = tokens.total != null
    ? marks[tokens.provenance] + fmtTok(tokens.total) + scopeWord
    : marks[tokens.provenance] + parts.join(" · ");
  return { label, text, known: true, title };
}

export function contextUsage(tokens) {
  if (!tokens || tokens.scope !== "latest-turn" || tokens.provenance !== "observed" ||
      !Number.isFinite(tokens.total) || !Number.isFinite(tokens.contextWindow) || !(tokens.contextWindow > 0)) return null;
  const rawPct = Math.max(0, Math.round((tokens.total / tokens.contextWindow) * 100));
  return { pct: Math.min(100, rawPct), text: fmtTok(tokens.total) + " of " + fmtTok(tokens.contextWindow) + " (" + rawPct + "%)" };
}

