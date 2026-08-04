import type {
  CollectionScope,
  EndEvidence,
  LifecycleProvenance,
  LifecycleState,
} from "../shared/types";

/* The one place a session's lifecycle is decided.

   Before this module the same question was answered in four places that did not
   agree: `statusFrom` in collectors.ts minted a parse-time status, `activityFor`
   in snapshot-agent.ts turned that into an activity word, cursor.ts ran its own
   ladder, and the web client's `deriveActivity` guessed a fifth answer whenever
   a field was missing. The divergence was not cosmetic — the server rescued a
   silent session with a live process and the client did not, so the same session
   read as alive on one surface and ended on another.

   The contract this module encodes, in one sentence: absence of evidence is not
   evidence of an ending. A session is only `finished` when something recorded an
   ending — the source wrote a session exit, an operator archived it, or a
   trustworthy probe found its process gone. Silence with nothing to check is
   `unverified`, which says what is actually true: the board does not know. */

export interface LifecycleThresholds {
  /** Activity newer than this reads as Working. */
  freshMs: number;
  /** Silence at or beyond this stops reading as recent. */
  quietMs: number;
}

/* The default bands, named. They were eight inline `3 * 60_000` /
   `45 * 60_000` literals across collectors.ts and cursor.ts, which is how the
   Cursor ladder and the Claude/Codex ladder could have drifted apart without
   anything failing. */
export const DEFAULT_FRESH_MS = 3 * 60_000;
export const DEFAULT_QUIET_MS = 45 * 60_000;

export const DEFAULT_LIFECYCLE_THRESHOLDS: LifecycleThresholds = {
  freshMs: DEFAULT_FRESH_MS,
  quietMs: DEFAULT_QUIET_MS,
};

/* What the process probe found — evidence, never a verdict.

   "unavailable" is the value that matters. It covers three different failures
   that all mean the same thing to a classifier: nothing checked, the check
   failed, or the check ran and matched no process. Every one of them is "we do
   not know", and none of them is "it died". */
export type ProcessEvidence = "alive" | "dead" | "unavailable";

/* Which band the silence falls in. Bands are closed-open: age < fresh is
   "fresh", fresh <= age < quiet is "recent", age >= quiet is "quiet". */
export type ActivityBand = "fresh" | "recent" | "quiet";

export interface LifecycleEvidence {
  /** Milliseconds since the last source activity. Negative ages clamp to 0. */
  ageMs: number;
  /** An operator pressed Archive. Human intent, and it outranks everything. */
  operatorArchived?: boolean;
  /**
   * What the source actually recorded. `session-exit` is a session fact;
   * `turn-complete` is a turn boundary and says nothing about the session.
   */
  endEvidence?: EndEvidence;
  /** Liveness of the retained process ids; undefined when nothing trustworthy checked. */
  processAlive?: boolean;
  /** Process ids retained from a confirmed identity scan. */
  processIds?: readonly number[];
  /** Whether the session is still inside the collector's scan window. */
  scope?: CollectionScope;
  /**
   * The verdict frozen when the archive took custody. Only read when
   * `scope` is "retained": `archiveCopy` strips process evidence, so a record
   * that has left the scan window cannot be re-derived and must carry its own
   * answer instead of being re-guessed from nothing.
   */
  persisted?: {
    lifecycle?: LifecycleState;
    provenance?: LifecycleProvenance;
  };
}

export interface LifecycleVerdict {
  lifecycle: LifecycleState;
  provenance: LifecycleProvenance;
  /** User-facing sentence explaining the verdict; ships as `statusReason`. */
  reason: string;
}

/* `processAlive === false` alone is not death. The identity scan sets it false
   whenever the retained pids are absent from the process table, and pids go
   absent for reasons that are not dying — a renamed binary (codex -> codex-next
   cost this board a wave of false "died" verdicts, identity.ts:355-369) or a
   probe that never ran. Death requires both a negative answer AND the pids the
   answer was about. */
export function processEvidenceOf(evidence: {
  processAlive?: boolean;
  processIds?: readonly number[];
}): ProcessEvidence {
  if (evidence.processAlive === true) return "alive";
  if (evidence.processAlive === false && (evidence.processIds?.length ?? 0) > 0) return "dead";
  return "unavailable";
}

export function activityBandOf(ageMs: number, thresholds: LifecycleThresholds): ActivityBand {
  const age = Math.max(0, ageMs);
  if (age < thresholds.freshMs) return "fresh";
  if (age < thresholds.quietMs) return "recent";
  return "quiet";
}

/* How long the silence has been, in the coarsest unit that still reads as a
   fact. Minutes below an hour, hours below two days, days past that: "quiet
   2880m" is technically true and tells a human nothing. */
function spokenAge(ageMs: number): string {
  const minutes = Math.max(0, Math.floor(ageMs / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function spokenMinutes(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/* A record that has left the scan window keeps the verdict it had when the
   archive took custody. It cannot be reclassified: `archiveCopy` strips
   processAlive/processIds by allow-list, so re-deriving from what survives
   would turn every retained session into "no process evidence" — the board
   would invent an unverified fleet out of its own filing cabinet.

   `aged-out` is the provenance for a record that left the window without ever
   ending. It is the honest fourth reason a row can be in History, and it is
   deliberately never used for an in-scope Finished verdict. */
function retainedVerdict(evidence: LifecycleEvidence): LifecycleVerdict {
  const lifecycle = evidence.persisted?.lifecycle ?? "finished";
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

function finishedReason(provenance: LifecycleProvenance): string {
  switch (provenance) {
    case "operator-archive":
      return "Archived by operator.";
    case "provider-exit":
      return "Source recorded a session exit.";
    case "process-died":
      return "Process checked and gone; nothing ended cleanly.";
    default:
      return "Left the scan window without an ending — no longer watched.";
  }
}

/**
 * Decide one session's lifecycle from its evidence. Row order below is the
 * precedence order in the contract: the first match wins, and every earlier row
 * outranks every later one.
 */
export function classifyLifecycle(
  evidence: LifecycleEvidence,
  thresholds: LifecycleThresholds = DEFAULT_LIFECYCLE_THRESHOLDS,
): LifecycleVerdict {
  // Row 12 — custody freezes the verdict.
  if (evidence.scope === "retained") return retainedVerdict(evidence);

  const proc = processEvidenceOf(evidence);
  const band = activityBandOf(evidence.ageMs, thresholds);
  const turnComplete = evidence.endEvidence === "turn-complete";

  // Row 1 — an operator archived it. Human intent outranks every machine fact,
  // including a process that is demonstrably still running; the contradiction is
  // disclosed on the row rather than silently overturning the decision.
  if (evidence.operatorArchived) {
    return {
      lifecycle: "finished",
      provenance: "operator-archive",
      reason: finishedReason("operator-archive"),
    };
  }

  // Row 2 — the source recorded a session exit. This is the only end-of-session
  // fact a provider emits; a completed turn is not one.
  if (evidence.endEvidence === "session-exit") {
    return {
      lifecycle: "finished",
      provenance: "provider-exit",
      reason: finishedReason("provider-exit"),
    };
  }

  // Row 4 — a dead-process probe loses to fresh transcript writes. Probes lie
  // more often than a file that is being written to right now does.
  if (proc === "dead" && band === "fresh") {
    return {
      lifecycle: "working",
      provenance: "recency",
      reason: "Fresh transcript writes outrank a stale process probe.",
    };
  }

  // Row 3 — the process was checked, by id, and is gone.
  if (proc === "dead") {
    return {
      lifecycle: "finished",
      provenance: "process-died",
      reason: finishedReason("process-died"),
    };
  }

  // Row 5 — a turn finished moments ago. The agent yielded; it did not end.
  if (band === "fresh" && turnComplete) {
    return {
      lifecycle: "waiting",
      provenance: "turn-complete",
      reason: "Turn finished — waiting on you.",
    };
  }

  // Row 6 — something wrote to the transcript inside the freshness window.
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
      return {
        lifecycle: "waiting",
        provenance: "turn-complete",
        reason: "Turn finished — waiting on you.",
      };
    }
    return {
      lifecycle: "waiting",
      provenance: "recency",
      reason: `No source activity in the last ${spokenMinutes(thresholds.freshMs)}.`,
    };
  }

  // Row 8 — long silence with a process that answers. A live process is never
  // finished by the clock, and a completed turn does not demote it either.
  if (proc === "alive") {
    return {
      lifecycle: "waiting",
      provenance: "process-live-quiet",
      reason: `Quiet ${spokenAge(evidence.ageMs)} · process live.`,
    };
  }

  // Row 9 — the turn ended a long time ago and nothing answered since. Filing
  // this as Waiting would inflate every stall alarm and burn denominator on the
  // board with sessions nobody is actually waiting on.
  if (turnComplete) {
    return {
      lifecycle: "unverified",
      provenance: "turn-complete-aged",
      reason: `Turn finished ${spokenAge(evidence.ageMs)} ago; no reply and no process evidence.`,
    };
  }

  // Row 10 — the core of the contract. Silence plus nothing to check is not an
  // ending; it is a gap in what the board knows, and it says so.
  return {
    lifecycle: "unverified",
    provenance: "no-evidence",
    reason: `No activity in ${spokenAge(evidence.ageMs)} and no process evidence — could not verify an ending.`,
  };
}
