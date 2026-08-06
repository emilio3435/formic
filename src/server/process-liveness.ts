/* The one place a PID is turned into a claim about a session.

   THE ERROR THIS MODULE EXISTS TO MAKE UNREPRESENTABLE. A pid is a number the
   kernel reuses, not an identity. Four separate places in this server answered
   "does a process with this number exist" and published the answer as "this
   session is running" — collectors.ts from the hook store, identity.ts twice
   (once for attributed pids and once for stale ones), and the bindings bridge.
   Measured 2026-08-05: 25 board rows claimed live, 10 were. Sessions sat live
   on `/usr/libexec/siriknowledged` and `sysextd`, one of them for 33 hours,
   because those daemons had inherited the numbers.

   Each of those four sites was individually reasonable and independently
   wrong. Rather than four patches, the judgement now lives here, takes the
   evidence it needs as a parameter, and cannot be asked the unsafe question:
   `livenessOf` will not accept a bare number, only a `ProcessHandle`, and a
   handle carries the provenance that makes the number checkable.

   tests/process-liveness.test.ts drives every row of
   tests/fixtures/process-liveness-truth-table.json through this, and
   tests/no-raw-pid-liveness.test.ts fails the build if a new call site starts
   hand-rolling the check again. */

/** A pid together with whatever proof exists that it is the process we meant. */
export interface ProcessHandle {
  readonly pid: number;
  /**
   * When the process holding this pid started, in whole seconds. This is the
   * only field that can prove the number still refers to what we attributed;
   * absent means the pid was recorded without provenance and can never be more
   * than presumed.
   */
  readonly startSeconds?: number;
}

/**
 * What the machine can honestly say about one handle.
 *
 * `gone` is reserved for evidence ABOUT THIS PROCESS: the number is unused, or
 * it is in use by something that started at a different time than the process
 * we recorded. Never inferred from a name we failed to recognise — that
 * inference is what turned a `codex` -> `codex-next` rename into a wave of
 * false "died" verdicts, and it is why every uncertain path below lands on
 * `unverifiable` instead.
 */
export type ProcessLiveness = "alive" | "gone" | "unverifiable";

export interface ProcessRoster {
  /** Start seconds by pid. The only source of proof; omit when unknown. */
  readonly startsByPid?: ReadonlyMap<number, number>;
  /** Every pid seen in use, agent or not. Establishes presence. */
  readonly livePids?: ReadonlySet<number>;
  /** The pids running something that looks like an agent. */
  readonly agentPids?: ReadonlySet<number>;
  /**
   * The enumeration ran to completion. A partial or failed scan cannot support
   * "this pid is gone", so an incomplete roster answers `unverifiable` for
   * everything — the honest shape of a probe that did not run.
   */
  readonly complete: boolean;
}

/** Whether the roster can speak to this pid's presence at all. */
function present(roster: ProcessRoster, pid: number): boolean | undefined {
  if (roster.startsByPid) return roster.startsByPid.has(pid);
  if (roster.livePids) return roster.livePids.has(pid);
  return undefined;
}

export function livenessOf(handle: ProcessHandle, roster: ProcessRoster): ProcessLiveness {
  if (!roster.complete) return "unverifiable";

  const inUse = present(roster, handle.pid);
  if (inUse === undefined) return "unverifiable";
  // Nothing holds the number. The strongest ending evidence there is, and the
  // only one that does not depend on recognising anything.
  if (!inUse) return "gone";

  const observedStart = roster.startsByPid?.get(handle.pid);
  if (handle.startSeconds !== undefined && observedStart !== undefined) {
    /* Proof, in both directions. A start time that differs means our process
       exited and the kernel handed the number on; that is a fact about this
       session, so it is allowed to say `gone`. */
    return observedStart === handle.startSeconds ? "alive" : "gone";
  }

  /* No provenance to check. Coverage measured 2026-08-05 in ~/.cmuxterm was 55
     of 86 claude records and 21 of 55 codex ones, so this path is common and
     must not mass-retire the fleet: a pid held by something wearing an agent's
     name is presumed alive. Deliberately a weak positive — it can only ever
     produce `alive`, never `gone`, so a session it misjudges stays on the board
     rather than being buried. */
  if (roster.agentPids?.has(handle.pid)) return "alive";

  /* In use, by something we cannot connect to any agent. This is the recycled
     pid: `siriknowledged` holding a number a claude session recorded hours ago.
     Unknown rather than dead — the session may well have ended, but nothing
     here witnessed that, and `gone` would render as "process checked and gone"
     beside a pid that is demonstrably running. */
  return "unverifiable";
}

/**
 * The verdict for a session that may have several handles. `alive` from any one
 * handle wins; otherwise a single doubt outranks a proven ending, because
 * claiming an ending we cannot fully support is the more expensive mistake.
 */
export function livenessOfAny(
  handles: readonly ProcessHandle[],
  roster: ProcessRoster,
): ProcessLiveness {
  if (handles.length === 0) return "unverifiable";
  const verdicts = handles.map((handle) => livenessOf(handle, roster));
  if (verdicts.includes("alive")) return "alive";
  if (verdicts.includes("unverifiable")) return "unverifiable";
  return "gone";
}

/**
 * The published `processAlive` tri-state, which is this answer minus the
 * distinction between "checked and gone" and "could not check".
 *
 * Kept as one function so no caller re-invents the mapping: `unverifiable` must
 * become `undefined` and never `false`. `false` carries pids into
 * `processEvidenceOf` as "dead" and renders as a death the board did not
 * witness.
 */
export function processAliveFrom(liveness: ProcessLiveness): boolean | undefined {
  switch (liveness) {
    case "alive":
      return true;
    case "gone":
      return false;
    case "unverifiable":
      return undefined;
    default: {
      const exhaustive: never = liveness;
      return exhaustive;
    }
  }
}
