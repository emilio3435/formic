import { describe, expect, spyOn, test } from "bun:test";
import { PROVIDERS } from "../src/shared/types";
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
  factory: { value: [], errors: [] },
      prime: { value: [], errors: [] },
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
  return new HubState(runner, archiveStore, [], {
    collectors: full,
    refreshAggregateTimeoutMs: 60,
  });
}

const refresh = (state: HubState): Promise<HubSnapshot> => state.refresh({ cmux: true });

describe("when collection runs out of time the board says so", () => {
  test("a hung collector leaves no agents AND every source stale", async () => {
    /* The property that already held, asserted because everything below
       depends on it: an empty board is never published without the four
       providers also being marked stale. Zero agents and no complaint is the
       failure this whole file exists to keep impossible. */
    const snapshot = await refresh(hub({ sessions: () => never() }));

    expect(snapshot.totals.live).toBe(0);
    /* EVERY source, from the union — a hung collector must not leave the newest
       provider quietly unmarked. */
    expect([...snapshot.controlHealth.staleSources].sort()).toEqual([...PROVIDERS].sort());
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

    expect(during.controlHealth.staleSources.length).toBe(PROVIDERS.length);
    expect(after.controlHealth.staleSources).toEqual([]);
    expect(after.controlHealth.errors).toEqual([]);
  });
});

/* The other way a refresh runs out of time: not the aggregate deadline, but the
   WATCHDOG. `refresh()` normally collapses concurrent callers onto one in-flight
   pass, so only one is ever writing. The watchdog is the deliberate exception —
   past REFRESH_WATCHDOG_MS it stops waiting on a pass and starts a replacement,
   which is the only way the board recovers from a collector that never returns.

   Nothing stopped the abandoned pass from finishing later and publishing
   anyway. It writes `#snapshot` and every derived record beside it — source
   health, issue lifecycle, and now `processRosterComplete`, which is what makes
   an ending provable. So a pass declared too slow to wait for could still
   overwrite its replacement with older readings, and the board would silently
   go backwards in time. */
describe("a refresh the watchdog abandoned does not publish over its replacement", () => {
  const WATCHDOG_MS = 12_000;

  /** A hub whose deadline is far enough out that only the watchdog is in play. */
  const patientHub = (collectors: Partial<HubCollectors>): HubState => {
    const full = {
      sessions: async () => empty(),
      cmux: async () => ({ value: [], errors: [] }),
      notifications: async () => ({ value: [], errors: [] }),
      enrichIdentity: async (surfaces: unknown) => ({ value: [...(surfaces as unknown[])], errors: [] }),
      ...collectors,
    } as unknown as HubCollectors;
    return new HubState(runner, archiveStore, [], {
      collectors: full,
      refreshAggregateTimeoutMs: 600_000,
    });
  };

  const sessionsWith = (id: string): SessionsResult => ({
    ...empty(),
    codex: {
      value: [{
        id: `codex:${id}`,
        provider: "codex",
        sourceSessionId: id,
        displayName: id,
        status: "running",
        statusReason: "Fixture activity.",
        updatedAt: "2026-08-04T12:00:00.000Z",
        tokens: { provenance: "observed", total: 1 },
        artifacts: [],
        gates: [],
      }],
      errors: [],
    },
  });

  const idsOn = (state: HubState): string[] =>
    state.get().programs.flatMap((program) => program.agents.map((agent) => agent.id));

  test("the stale pass's agents never replace the newer pass's", async () => {
    let nowMs = 1_000;
    const clock = spyOn(Date, "now").mockImplementation(() => nowMs);
    try {
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => { release = resolve; });
      let call = 0;
      const state = patientHub({
        sessions: async () => {
          call += 1;
          if (call === 1) {
            await held;
            return sessionsWith("stale");
          }
          return sessionsWith("fresh");
        },
      });

      const abandoned = state.refresh();
      // Past the watchdog: the next caller stops waiting and starts its own pass.
      nowMs += WATCHDOG_MS + 1_000;
      await state.refresh();
      expect(idsOn(state)).toEqual(["codex:fresh"]);

      // The abandoned pass now finishes. Its readings are older than what the
      // board already published, and it must not be the last writer.
      release();
      await abandoned;
      expect(idsOn(state)).toEqual(["codex:fresh"]);
    } finally {
      clock.mockRestore();
    }
  });

  test("a pass nothing abandoned still publishes normally", async () => {
    /* The contrast case. A guard that simply refused to publish would pass the
       test above and leave the board frozen forever. */
    const state = patientHub({ sessions: async () => sessionsWith("only") });

    await state.refresh();

    expect(idsOn(state)).toEqual(["codex:only"]);
  });
});
