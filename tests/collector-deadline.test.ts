import { describe, expect, test } from "bun:test";
import { HubState } from "../src/server/state";
import type { HubCollectors } from "../src/server/state";
import type { ArchiveStore, CommandRunner } from "../src/server/types";
import type { HubSnapshot } from "../src/shared/types";

/* Entry 6 of docs/UNTESTED-PATHS-MAP.md — what every collector reports when the
   aggregate deadline fires.

   This path only runs on a machine slow enough to miss the deadline, which is
   never the machine a test suite runs on unless the deadline is made small. So
   it had never executed, and it decides what an operator is told at the exact
   moment the board knows least: zero agents, four providers, and one sentence
   explaining why.

   The presence of the failure was already cross-checked — an empty board also
   carries four stale sources, so nobody sees zero agents and calm. The REASON
   was not, and that is where both defects below were living. */

const runner: CommandRunner = {
  run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
};
const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
const never = <T>(): Promise<T> => new Promise<T>(() => {});
/* Derived the same way state.ts derives it, rather than exporting a type only a
   test would use. */
type SessionsResult = Awaited<ReturnType<HubCollectors["sessions"]>>;
const empty = (): SessionsResult => ({
  omp: { value: [], errors: [] },
  codex: { value: [], errors: [] },
  claude: { value: [], errors: [] },
  cursor: { value: [], errors: [] },
});

/** A hub whose collectors behave exactly as described, with a 60ms deadline. */
function hub(collectors: Partial<HubCollectors>): HubState {
  const full = {
    sessions: async () => empty(),
    cmux: async () => ({ value: [], errors: [] }),
    notifications: async () => ({ value: [], errors: [] }),
    enrichIdentity: async (surfaces: unknown) => ({ value: [...(surfaces as unknown[])], errors: [] }),
    ...collectors,
  } as unknown as HubCollectors;
  return new HubState(
    runner, archiveStore, [], full,
    undefined, undefined, undefined, undefined, undefined,
    60,
  );
}

const refresh = (state: HubState): Promise<HubSnapshot> => state.refresh({ cmux: true });

describe("when collection runs out of time the board says so", () => {
  test("a hung collector leaves no agents AND four stale sources", async () => {
    /* The property that already held, asserted because everything below
       depends on it: an empty board is never published without the four
       providers also being marked stale. Zero agents and no complaint is the
       failure this whole file exists to keep impossible. */
    const snapshot = await refresh(hub({ sessions: () => never() }));

    expect(snapshot.totals.live).toBe(0);
    expect([...snapshot.controlHealth.staleSources].sort())
      .toEqual(["claude", "codex", "cursor", "omp"]);
    expect(snapshot.controlHealth.errors.length).toBeGreaterThan(0);
  });

  test("the reason given is the deadline, not another collector's failure", async () => {
    /* THE DEFECT. On a machine where cmux is not installed it fails in
       milliseconds, and where transcript reading is slow it never finishes.
       The reason published for all four session providers was
       `collectionErrors[0]` — whichever error landed FIRST — so Claude, Codex,
       OMP and Cursor were each reported unavailable because "cmux discovery
       failed: spawn cmux ENOENT". None of them had failed. They had not
       finished, and the operator was sent to the one subsystem that was not
       the problem.

       Asserted on the FIRST error of each provider, because that is the one a
       reader scans: `technicalDetails` carries the whole list in order. */
    const snapshot = await refresh(hub({
      sessions: () => never(),
      cmux: async () => { throw new Error("spawn cmux ENOENT"); },
    }));

    const degraded = (snapshot.issues ?? []).filter((issue) => issue.id.endsWith("-collector"));
    expect(degraded.length).toBeGreaterThan(0);
    for (const issue of degraded) {
      expect(issue.technicalDetails?.[0], `${issue.id} still leads with another component's fault`)
        .toMatch(/exceeded 60ms deadline/);
      expect(issue.technicalDetails?.[0]).not.toMatch(/spawn cmux ENOENT/);
    }
  });

  test("a collector that DID fail still reports its own error, not the deadline", async () => {
    /* The control, and without it the fix above is satisfied by always blaming
       the clock — which would be the same defect pointed the other way. When
       session collection genuinely throws, that is what the providers must
       say. */
    const snapshot = await refresh(hub({
      sessions: async () => { throw new Error("EMFILE: too many open files"); },
    }));

    const degraded = (snapshot.issues ?? []).filter((issue) => issue.id.endsWith("-collector"));
    expect(degraded.length).toBeGreaterThan(0);
    for (const issue of degraded) {
      expect(issue.technicalDetails?.[0]).toMatch(/EMFILE: too many open files/);
    }
  });

  test("one fault is reported once, however many sources it stopped", async () => {
    /* The second defect. `sourceErrors` is flattened across providers and a
       fault that stops the aggregate stops all four, so ONE deadline arrived at
       the health card as TEN entries. Harmless while the card only counted
       them; it now prints the first and appends "(+N more)", which turned two
       real faults into "(+9 more)" and sent an operator hunting eight problems
       that did not exist.

       Measured: this exact fixture produced 10 before the fix and 2 after. */
    const snapshot = await refresh(hub({
      sessions: () => never(),
      cmux: async () => { throw new Error("spawn cmux ENOENT"); },
    }));

    const errors = snapshot.controlHealth.errors;

    expect(errors.length, `duplicated: ${JSON.stringify(errors)}`).toBe(new Set(errors).size);
    expect(errors.some((error) => /exceeded 60ms deadline/.test(error))).toBe(true);
    expect(errors.some((error) => /spawn cmux ENOENT/.test(error))).toBe(true);
    expect(errors).toHaveLength(2);
  });

  test("a healthy collection reports no errors at all", async () => {
    /* The control for the control. Every assertion above is about a failure
       being described, and all of them would pass on a hub that reported
       problems unconditionally. */
    const snapshot = await refresh(hub({}));

    expect(snapshot.controlHealth.errors).toEqual([]);
    expect(snapshot.controlHealth.staleSources).toEqual([]);
  });

  test("recovering clears the stale marks rather than latching them", async () => {
    /* A deadline is transient by nature — a busy machine, a cold cache. If the
       stale marks survived the recovery the board would report a fault that had
       already passed, and an operator who checked and found nothing wrong would
       learn to ignore the marker. */
    let hang = true;
    const state = hub({ sessions: () => (hang ? never() : Promise.resolve(empty())) });

    const during = await refresh(state);
    hang = false;
    const after = await refresh(state);

    expect(during.controlHealth.staleSources.length).toBe(4);
    expect(after.controlHealth.staleSources).toEqual([]);
    expect(after.controlHealth.errors).toEqual([]);
  });
});
