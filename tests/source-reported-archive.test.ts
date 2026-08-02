import { describe, expect, test } from "bun:test";
import { buildSnapshot } from "../src/server/snapshot";
import { activityFor } from "../src/server/snapshot-agent";
import type { ArchiveStore, CollectedAgent } from "../src/server/types";

/* An agent the SOURCE reports as archived, which nothing exercised.

   `activityFor` opens with `if (archived || agent.status === "archived")`. Two
   conditions, one outcome — and every fixture in the suite reached it through
   the FIRST one, the flag the archive store supplies. Dropping the second arm
   entirely passes 121 tests across snapshot, snapshot-edges, archive,
   liveness-boundaries and collectors.

   That is the overlapping-mechanism shape: when two conditions produce the same
   answer and every fixture satisfies the one you are not testing, the other is
   dead code as far as the suite is concerned. It is invisible to mutation
   sweeps aimed at either condition individually, because each looks covered.

   WHAT IT COSTS. The two conditions are not redundant. `archived` means THIS
   BOARD archived the row; `status === "archived"` means the SOURCE — the
   provider's own session file — reported the session finished. An agent can be
   the second without being the first: any session a provider closed that
   nobody has tidied here yet. Without the arm it falls past every branch of
   activityFor and lands on `unknown`, so a session the source has explicitly
   declared over renders as unreadable, leaves `ended` and `history`, and stays
   in the live population it should have left. */

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

describe("a session the source reports as archived is ended, without this board archiving it", () => {
  test("activityFor ends it on the source's word alone, with the archive flag false", () => {
    /* THE PROPERTY, at the function. `archived` is FALSE here — this board has
       not archived anything — so only the second arm can produce "ended". Every
       existing fixture passed `archived: true` and never reached it. */
    expect(activityFor(collected({ status: "archived" }), false)).toBe("ended");
  });

  test("the two conditions are independently sufficient, which is why both exist", () => {
    /* Asserted as a pair so neither arm can be removed. A build keeping only
       the flag fails the first line; a build keeping only the status fails the
       second. Nothing in the suite previously distinguished them. */
    expect(activityFor(collected({ status: "archived" }), false)).toBe("ended");
    expect(activityFor(collected({ status: "running" }), true)).toBe("ended");
    // And neither on its own is enough to end a plainly running session.
    expect(activityFor(collected({ status: "running" }), false)).toBe("working");
  });

  test("it leaves the live population and joins the ended count", () => {
    /* The operator-visible half. Without the arm this agent falls past every
       branch of activityFor onto `unknown`: a session the source declared over,
       rendered unreadable, still counted among the living.

       Asserted against a running agent in the same board so the counts are
       attributable to status and not to the fleet size. */
    const snapshot = board([
      collected({ id: "codex:done", sourceSessionId: "done", status: "archived" }),
      collected({ id: "codex:busy", sourceSessionId: "busy", status: "running" }),
    ]);

    expect(snapshot.totals.tracked).toBe(2);
    expect(snapshot.totals.ended).toBe(1);
    expect(snapshot.totals.history).toBe(1);
    expect(snapshot.totals.working).toBe(1);
    // The specific agent, so the counts cannot be satisfied by the wrong one.
    expect(only(board([collected({ status: "archived" })])).activity).toBe("ended");
  });

  test("it is not merely stale, which reaches the same verdict by another route", () => {
    /* The route-3 guard on this very test. `stale` also produces "ended" when
       no process evidence exists, so a fixture that was BOTH archived-by-source
       and stale would satisfy every assertion above through the stale branch
       while the arm under test stayed dead.

       This agent is `archived` with a fresh updatedAt and a LIVE process, which
       is the one combination the stale branch cannot end. */
    const liveButSourceArchived = collected({
      status: "archived",
      updatedAt: NOW.toISOString(),
      processAlive: true,
      processIds: [4_242],
    });

    expect(activityFor(liveButSourceArchived, false)).toBe("ended");
    // Same agent with a status the stale branch would not end either.
    expect(activityFor(collected({ ...liveButSourceArchived, status: "running" }), false)).toBe("working");
  });
});
