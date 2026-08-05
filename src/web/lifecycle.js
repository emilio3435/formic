/* The client's mirror of src/server/lifecycle.ts.

   It exists for one reason: the fallback path. The server puts `lifecycle` on
   every agent, but a snapshot can arrive without it — an older server, a cached
   response, a record written before the field existed — and when that happens
   this client has to answer the same question. It used to answer it differently.
   `deriveActivity` mapped `stale` straight to `ended` with no rescue for a
   session whose process was demonstrably alive, so the exact same session read
   as alive on the server and finished in the browser.

   Two implementations of one rule is the disease. The cure is not to delete one
   of them — the fallback is load-bearing — but to make them provably the same:
   tests/lifecycle-parity.test.ts runs tests/fixtures/lifecycle-truth-table.json
   through BOTH, and a rule that lands in one and not the other fails there.

   Kept dependency-free and DOM-free on purpose, so it imports under Bun as
   cheaply as it loads in a browser. */

export const DEFAULT_FRESH_MS = 3 * 60_000;
export const DEFAULT_QUIET_MS = 45 * 60_000;

export const DEFAULT_LIFECYCLE_THRESHOLDS = {
  freshMs: DEFAULT_FRESH_MS,
  quietMs: DEFAULT_QUIET_MS,
};

/* `processAlive === false` alone is not death. It goes false whenever the
   retained pids are absent from the process table, and pids go absent for
   reasons that are not dying — a renamed binary, a probe that never ran. Death
   needs both the negative answer AND the ids the answer was about. */
export function processEvidenceOf(evidence) {
  if (evidence.processAlive === true) return "alive";
  if (evidence.processAlive === false && (evidence.processIds?.length ?? 0) > 0) return "dead";
  /* A COMPLETE enumeration that matched nothing is an observation, not a gap —
     ranked below `dead` because it argues from a roster rather than from this
     session's own pids, and read only in the quiet band. */
  if (evidence.processRosterComplete === true) return "absent";
  return "unavailable";
}

export function activityBandOf(ageMs, thresholds = DEFAULT_LIFECYCLE_THRESHOLDS) {
  const age = Math.max(0, ageMs);
  if (age < thresholds.freshMs) return "fresh";
  if (age < thresholds.quietMs) return "recent";
  return "quiet";
}

export function retirementEndEvidence(evidence) {
  if (
    evidence.endEvidence === "session-exit"
    || evidence.endEvidence === "worktree-deleted"
    || evidence.endEvidence === "superseded"
  ) {
    return evidence.endEvidence;
  }
  if (evidence.hookLifecycle === "ended") return "session-exit";
  if (evidence.processAlive === false && evidence.cwdExists === false) return "worktree-deleted";
  return evidence.endEvidence;
}

/* Coarsest unit that still reads as a fact: "quiet 2880m" is true and useless. */
function spokenAge(ageMs) {
  const minutes = Math.max(0, Math.floor(ageMs / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function spokenMinutes(ms) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

function finishedReason(provenance) {
  switch (provenance) {
    case "operator-archive": return "Archived by operator.";
    case "provider-exit": return "Source recorded a session exit.";
    case "process-died": return "Process checked and gone; nothing ended cleanly.";
    default: return "Left the scan window without an ending — no longer watched.";
  }
}

/* A record out of the scan window keeps the verdict it was filed with. The
   archive strips process evidence when it takes custody, so re-deriving here
   would turn the whole filing cabinet into "no process evidence" and invent an
   unverified fleet out of history. */
function retainedVerdict(evidence) {
  const lifecycle = evidence.persisted?.lifecycle ?? "finished";
  if (lifecycle === "finished" && evidence.persisted?.provenance === "operator-archive") {
    return {
      lifecycle,
      provenance: "operator-archive",
      reason: finishedReason("operator-archive"),
    };
  }
  if (lifecycle === "finished" && evidence.endEvidence === "superseded") {
    return {
      lifecycle,
      provenance: "provider-exit",
      reason: "Replaced by a newer session for this lane.",
    };
  }
  if (lifecycle === "finished" && evidence.persisted?.provenance) {
    return {
      lifecycle,
      provenance: evidence.persisted.provenance,
      reason: finishedReason(evidence.persisted.provenance),
    };
  }
  return {
    lifecycle,
    provenance: "aged-out",
    reason: "Left the scan window without an ending — no longer watched.",
  };
}

/**
 * Decide one session's lifecycle from its evidence. Row order is precedence
 * order: the first match wins and outranks every rule below it.
 */
export function classifyLifecycle(evidence, thresholds = DEFAULT_LIFECYCLE_THRESHOLDS) {
  // Row 12 — custody freezes the verdict.
  if (evidence.scope === "retained") return retainedVerdict(evidence);

  const proc = processEvidenceOf(evidence);
  const band = activityBandOf(evidence.ageMs, thresholds);
  const endEvidence = retirementEndEvidence(evidence);
  const turnComplete = endEvidence === "turn-complete";

  // Row 1 — human intent outranks every machine fact, including a live process.
  if (evidence.operatorArchived) {
    return { lifecycle: "finished", provenance: "operator-archive", reason: finishedReason("operator-archive") };
  }

  // Row 2 — a newer manifest binding closes the predecessor's lane cycle.
  if (endEvidence === "superseded") {
    return {
      lifecycle: "finished",
      provenance: "provider-exit",
      reason: "Replaced by a newer session for this lane.",
    };
  }

  // Row 2 — the only end-of-session fact a provider emits. A turn is not one.
  if (endEvidence === "session-exit") {
    return { lifecycle: "finished", provenance: "provider-exit", reason: finishedReason("provider-exit") };
  }

  // Row 3 — a negative process check plus a deleted cwd is retirement evidence.
  if (endEvidence === "worktree-deleted") {
    return {
      lifecycle: "finished",
      provenance: "process-died",
      reason: "Process checked and gone after its worktree was deleted.",
    };
  }

  // Row 4 — a dead-process probe loses to writes happening right now.
  if (proc === "dead" && band === "fresh") {
    return {
      lifecycle: "working",
      provenance: "recency",
      reason: "Fresh transcript writes outrank a stale process probe.",
    };
  }

  // Row 3 — checked, by id, and gone.
  if (proc === "dead") {
    return { lifecycle: "finished", provenance: "process-died", reason: finishedReason("process-died") };
  }

  // Row 5 — the agent yielded the floor moments ago; it did not end.
  if (band === "fresh" && turnComplete) {
    return { lifecycle: "waiting", provenance: "turn-complete", reason: "Turn finished — waiting on you." };
  }

  // Row 6 — something wrote inside the freshness window.
  if (band === "fresh") {
    return {
      lifecycle: "working",
      provenance: "recency",
      reason: `Source activity within the last ${spokenMinutes(thresholds.freshMs)}.`,
    };
  }

  // Row 7 — quiet, but not yet quiet enough to doubt.
  if (band === "recent") {
    if (turnComplete) {
      return { lifecycle: "waiting", provenance: "turn-complete", reason: "Turn finished — waiting on you." };
    }
    return {
      lifecycle: "waiting",
      provenance: "recency",
      reason: `No source activity in the last ${spokenMinutes(thresholds.freshMs)}.`,
    };
  }

  // Row 8 — a process that answers is never finished by the clock, and a
  // completed turn does not demote it either.
  if (proc === "alive") {
    return {
      lifecycle: "waiting",
      provenance: "process-live-quiet",
      reason: `Quiet ${spokenAge(evidence.ageMs)} · process live.`,
    };
  }

  /* Row 8b — quiet, and a complete enumeration found nothing claiming it.
     Reached only in the quiet band; rows 5-7 have already answered for anything
     fresh or recent, which is the protection this weaker evidence needs. */
  if (proc === "absent") {
    return {
      lifecycle: "finished",
      provenance: "process-absent",
      reason: `Quiet ${spokenAge(evidence.ageMs)} and no running process claims this session.`,
    };
  }

  // Row 9 — the turn ended long ago and nothing has answered since.
  if (turnComplete) {
    return {
      lifecycle: "unverified",
      provenance: "turn-complete-aged",
      reason: `Turn finished ${spokenAge(evidence.ageMs)} ago; no reply and no process evidence.`,
    };
  }

  // Row 10 — silence with nothing to check is a gap in what the board knows.
  return {
    lifecycle: "unverified",
    provenance: "no-evidence",
    reason: `No activity in ${spokenAge(evidence.ageMs)} and no process evidence — could not verify an ending.`,
  };
}

/**
 * The fallback entry point: read the server's verdict when it is there, and
 * only classify when it is not. Same precedence the other derive* helpers use —
 * a backend field always wins over a client guess.
 */
export function deriveLifecycle(agent, thresholds = DEFAULT_LIFECYCLE_THRESHOLDS, nowMs = Date.now()) {
  if (agent.lifecycle) {
    return {
      lifecycle: agent.lifecycle,
      provenance: agent.provenance ?? "recency",
      reason: agent.statusReason ?? "",
    };
  }
  return classifyLifecycle(evidenceFromAgent(agent, nowMs), thresholds);
}

/* Read the evidence off a wire agent, using only fields that predate this
   contract, so a snapshot from a server that has never heard of `lifecycle`
   still classifies correctly rather than defaulting to the old stale->ended
   collapse.

   `status: "archived"` is the one ambiguous legacy input: it was minted for a
   provider exit, an operator archive, AND a retained history record. It maps to
   provider-exit here because that is the reading that never invents human
   intent — an operator archive on a legacy snapshot is indistinguishable from a
   source exit, and claiming "you archived this" when nobody did is the worse
   error. */
export function evidenceFromAgent(agent, nowMs = Date.now()) {
  const updatedMs = Date.parse(agent.updatedAt ?? "");
  const ageMs = Number.isFinite(updatedMs) ? Math.max(0, nowMs - updatedMs) : 0;
  return {
    ageMs,
    scope: agent.scope,
    endEvidence: agent.endEvidence ?? (agent.status === "archived" ? "session-exit" : undefined),
    hookLifecycle: agent.hookLifecycle,
    cwdExists: agent.cwdExists,
    processAlive: agent.processAlive,
    processIds: agent.processIds,
    processRosterComplete: agent.processRosterComplete,
    persisted: agent.scope === "retained"
      ? { lifecycle: agent.lifecycle, provenance: agent.provenance }
      : undefined,
  };
}
