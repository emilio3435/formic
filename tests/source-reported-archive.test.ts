import { describe, expect, test } from "bun:test";
import { buildSnapshot } from "../src/server/snapshot";
import { activityFor } from "../src/server/snapshot-agent";
import type { ArchiveStore, CollectedAgent } from "../src/server/types";

/* An agent the SOURCE reports as finished, which nothing exercised.

   `activityFor` used to open with `if (archived || agent.status === "archived")`.
   Two conditions, one outcome — and every fixture in the suite reached it
   through the FIRST one, the flag the archive store supplies. Dropping the
   second arm entirely passed 121 tests.

   That is the overlapping-mechanism shape: when two conditions produce the same
   answer and every fixture satisfies the one you are not testing, the other is
   dead code as far as the suite is concerned.

   WHAT THE PROPERTY IS, and it has not changed: a session the PROVIDER closed is
   finished even though this board never archived it. Any session a source ended
   that nobody has tidied here yet. Without it, such a session renders as
   unreadable and stays in the live population it should have left.

   WHAT CHANGED IS THE CARRIER. The source's word used to be a status string, and
   that string was minted for two incompatible events: OMP's `session_exit`, a
   real session ending, and a Claude or Codex TURN completing. One word, so the
   board could not tell "the provider closed this" from "the agent finished
   speaking", and it treated both as the end. `endEvidence: "session-exit"` is
   the source's word now, and a completed turn cannot impersonate it. The pair
   below is therefore sharper than it was: source-exit and operator-archive are
   still independently sufficient, and turn-complete is now proven to be neither. */

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
const NOW = new Date("2026-08-02T12:00:00.000Z");

function collected(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: "codex:alpha",
    provider: "codex",
    sourceSessionId: "alpha",
    displayName: "Alpha",
    cwd: "/tmp/project",
    status: "running",
    statusReason: "Fixture activity.",
    updatedAt: NOW.toISOString(),
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    ...overrides,
  } as CollectedAgent;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const board = (agents: readonly CollectedAgent[]): any =>
  buildSnapshot({ agents, surfaces: [], archiveStore, now: NOW });

const only = (snapshot: { programs: { agents: unknown[] }[] }) =>
  snapshot.programs.flatMap(({ agents }) => agents)[0] as { activity: string };

describe("a session the source reports as finished is finished, without this board archiving it", () => {
  test("activityFor ends it on the source's word alone, with the archive flag false", () => {
    /* THE PROPERTY, at the function. `archived` is FALSE here — this board has
       not archived anything — so only the source's own record can end it. */
    expect(activityFor(collected({ endEvidence: "session-exit" }), false, NOW.getTime())).toBe("ended");
  });

  test("the two conditions are independently sufficient, and a finished turn is neither", () => {
    /* Asserted as a set so no arm can be removed silently. A build keeping only
       the operator flag fails the first line; one keeping only the source
       evidence fails the second; and one that lets a completed turn stand in for
       a session exit — which is what the old status word did — fails the third. */
    expect(activityFor(collected({ endEvidence: "session-exit" }), false, NOW.getTime())).toBe("ended");
    expect(activityFor(collected(), true, NOW.getTime())).toBe("ended");
    expect(activityFor(collected({ endEvidence: "turn-complete" }), false, NOW.getTime())).toBe("idle");
    // And nothing on its own ends a plainly running session.
    expect(activityFor(collected(), false, NOW.getTime())).toBe("working");
  });

  test("it leaves the live population and joins the ended count", () => {
    /* The operator-visible half, asserted against a running agent in the same
       board so the counts are attributable to the evidence and not the fleet
       size. */
    const snapshot = board([
      collected({ id: "codex:done", sourceSessionId: "done", endEvidence: "session-exit" }),
      collected({ id: "codex:busy", sourceSessionId: "busy" }),
    ]);

    expect(snapshot.totals.tracked).toBe(2);
    expect(snapshot.totals.ended).toBe(1);
    expect(snapshot.totals.history).toBe(1);
    expect(snapshot.totals.working).toBe(1);
    expect(snapshot.totals.byLifecycle).toEqual({ working: 1, waiting: 0, unverified: 0, finished: 1 });
    // The specific agent, so the counts cannot be satisfied by the wrong one.
    expect(only(board([collected({ endEvidence: "session-exit" })])).activity).toBe("ended");
  });

  test("it is not merely quiet, which used to reach the same verdict by another route", () => {
    /* The route-3 guard on this very test, and it matters more than it did.

       Long silence with no process evidence USED to produce "ended" as well, so
       a fixture that was both source-finished and quiet satisfied every
       assertion above through the wrong branch while the arm under test stayed
       dead. Silence no longer ends anything, which closes that route outright —
       and this fixture keeps the sharper shape anyway: fresh, with a live
       process, the one combination nothing but a recorded exit can end. */
    const liveButSourceFinished = collected({
      endEvidence: "session-exit",
      updatedAt: NOW.toISOString(),
      processAlive: true,
      processIds: [4_242],
    });

    expect(activityFor(liveButSourceFinished, false, NOW.getTime())).toBe("ended");
    expect(activityFor(collected({ ...liveButSourceFinished, endEvidence: undefined }), false, NOW.getTime()))
      .toBe("working");
    // The route that used to overlap, now proven closed.
    const quiet = collected({ updatedAt: "2026-08-02T06:00:00.000Z" });
    expect(activityFor(quiet, false, NOW.getTime())).toBe("unknown");
  });
});
