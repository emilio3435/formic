import { describe, expect, spyOn, test } from "bun:test";
import { PROVIDERS } from "../src/shared/types";
import { HubState } from "../src/server/state";
import type { HubCollectors, HubStateOptions } from "../src/server/state";
import type { ArchiveStore, CollectedAgent, CommandRunner } from "../src/server/types";
import type { HubSnapshot } from "../src/shared/types";
import type { AckStore } from "../src/server/ack";
import type { IdentityBindingStore } from "../src/server/identity-bindings";
import type { ProcessWitnessStore } from "../src/server/process-witness";
import { normalizeSettings } from "../src/server/settings";

/* Entry 6 of docs/UNTESTED-PATHS-MAP.md — what every collector reports when the
   aggregate deadline fires.

   This path only runs on a machine slow enough to miss the deadline, which is
   never the machine a test suite runs on unless the deadline is made small. So
   it had never executed, and it decides what an operator is told at the exact
   moment the board knows least: zero agents, every provider, and one sentence
   explaining why.

   The presence of the failure was already cross-checked — an empty board also
   carries every source as stale, so nobody sees zero agents and calm. The REASON
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
  grok: { value: [], errors: [] },
  hermes: { value: [], errors: [] },
  muse: { value: [], errors: [] },
  antigravity: { value: [], errors: [] },
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

const source = (id: string, overrides: Partial<CollectedAgent> = {}): CollectedAgent => ({
  id: `codex:${id}`,
  provider: "codex" as const,
  sourceSessionId: id,
  displayName: id,
  status: "waiting" as const,
  statusReason: "Fixture completed collection.",
  updatedAt: "2026-08-13T12:00:00.000Z",
  tokens: { provenance: "unknown" as const },
  artifacts: [],
  gates: [],
  ...overrides,
});

interface TailHubOptions extends HubStateOptions {
  archiveStore?: ArchiveStore;
  transcriptTailReader?: () => Promise<never>;
}

function tailHub(options: TailHubOptions = {}, agents = [source("tail-proof")]): HubState {
  const { archiveStore: selectedArchive = archiveStore, ...stateOptions } = options;
  const collectors: HubCollectors = {
    sessions: async () => ({
      ...empty(),
      codex: { value: agents, errors: [] },
    }),
    cmux: async () => ({ value: [], errors: [] }),
    notifications: async () => ({ value: [], errors: [] }),
    enrichIdentity: async (surfaces) => ({
      value: [...surfaces],
      errors: [],
      rosterComplete: true,
    }),
  };
  return new HubState(runner, selectedArchive, [], {
    collectors,
    refreshAggregateTimeoutMs: 40,
    ...stateOptions,
  });
}

async function expectBoundedTail(
  state: HubState,
  pendingLabel: string,
  expectedAgentId = "codex:tail-proof",
): Promise<HubSnapshot> {
  const logged = spyOn(console, "error").mockImplementation(() => {});
  try {
    const snapshot = await Promise.race([
      refresh(state),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`refresh remained stuck in ${pendingLabel}`)), 250);
      }),
    ]);
    expect(snapshot.programs.flatMap(({ agents }) => agents).map(({ id }) => id)).toContain(expectedAgentId);
    const overrun = logged.mock.calls
      .map((call) => String(call[0]))
      .find((line) => line.includes("publishing tail exceeded"));
    expect(overrun).toContain(`PENDING=[${pendingLabel}]`);
    return snapshot;
  } finally {
    logged.mockRestore();
  }
}

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
       The reason published for every session provider was
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
       fault that stops the aggregate stops every provider, so ONE deadline arrived at
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

  test("a missed deadline names the collector that had not returned", async () => {
    /* The whole point of the instrumentation. Two culprits were named from
       reading the code and both dissolved on measurement, so the board has to
       say which collector it is actually waiting on. A duration cannot answer
       it — the guilty collector has not finished, so it has no duration. The
       PENDING set is the finding. */
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      const state = hub({ notifications: () => never() });
      await refresh(state);

      const timings = logged.mock.calls
        .map((call) => String(call[0]))
        .find((line) => line.includes("pass timings"));
      expect(timings, "no pass timings line was logged on a missed deadline").toBeDefined();
      expect(timings).toContain("PENDING=[cmux notification collection failed]");
      /* A collector that DID return must not be accused. */
      expect(timings).not.toContain("PENDING=[cmux discovery failed");
    } finally {
      logged.mockRestore();
    }
  });

  test("a pass that meets its deadline logs no timings at all", async () => {
    /* The contrast case, and the reason this is safe to ship into a log that is
       already a wall of noise: a healthy board stays silent. */
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      await refresh(hub({}));
      const noisy = logged.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes("pass timings"));
      expect(noisy).toEqual([]);
    } finally {
      logged.mockRestore();
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

describe("the publishing tail shares one bounded deadline", () => {
  test("a stuck identity binding write cannot hold publication", async () => {
    const bindingStore: IdentityBindingStore = {
      get: () => undefined,
      list: () => [],
      put: async () => {},
      putMany: () => never(),
    };

    await expectBoundedTail(tailHub({ bindingStore }), "identity binding persistence");
  });

  test("a stuck process witness write cannot hold publication", async () => {
    const witnessStore: ProcessWitnessStore = {
      get: () => undefined,
      record: () => never(),
    };

    await expectBoundedTail(tailHub({ witnessStore }), "process witness persistence");
  });

  test("a stuck session history write cannot hold publication", async () => {
    const hangingArchive: ArchiveStore = {
      has: () => false,
      archive: async () => {},
      record: () => never(),
    };

    await expectBoundedTail(tailHub({ archiveStore: hangingArchive }), "session history persistence");
  });

  test("a stuck transcript read cannot hold publication or become a sender verdict", async () => {
    const agents = [
      source("sender", {
        artifacts: [{ kind: "transcript", label: "Transcript", path: "/dev/null" }],
      }),
      source("recipient", {
        lastUserMessage: "[from codex:sender run run-1] Hold publication only until the tail budget.",
      }),
    ];
    const options: TailHubOptions = {
      transcriptTailReader: () => never(),
    };

    const snapshot = await expectBoundedTail(
      tailHub(options, agents),
      "sender transcript tails",
      "codex:recipient",
    );
    const recipient = snapshot.programs.flatMap(({ agents }) => agents)
      .find(({ id }) => id === "codex:recipient");
    expect("senderVerified" in (recipient ?? {})).toBeFalse();
  });

  test("a stuck acknowledgement reconciliation cannot hold publication", async () => {
    const ackStore: AckStore = {
      list: () => [],
      get: () => undefined,
      put: () => never(),
      delete: () => never(),
      reconcile: () => never(),
    };

    await expectBoundedTail(tailHub({ ackStore }), "acknowledgement reconciliation");
  });

  test("a healthy publishing tail emits no overrun line", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      await refresh(tailHub());

      expect(logged.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes("publishing tail exceeded"))).toEqual([]);
    } finally {
      logged.mockRestore();
    }
  });
});

describe("watchdog cancellation is not collector failure", () => {
  test("the superseded pass observes abort while its healthy replacement publishes cleanly", async () => {
    let nowMs = 1_000;
    const clock = spyOn(Date, "now").mockImplementation(() => nowMs);
    let first = true;
    let cancelled = false;
    let receivedSignal: AbortSignal | undefined;
    const state = tailHub({
      collectors: {
        sessions: async (...args: unknown[]) => {
          if (!first) return empty();
          first = false;
          receivedSignal = args.find((value): value is AbortSignal => value instanceof AbortSignal);
          return new Promise<SessionsResult>((_resolve, reject) => {
            receivedSignal?.addEventListener("abort", () => {
              cancelled = true;
              reject(new Error("superseded collection cancelled"));
            }, { once: true });
          });
        },
        cmux: async () => ({ value: [], errors: [] }),
        notifications: async () => ({ value: [], errors: [] }),
        enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [] }),
      },
      refreshAggregateTimeoutMs: 600_000,
    });
    try {
      const abandoned = state.refresh();
      for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
      nowMs += 13_000;

      const replacement = await state.refresh();
      await abandoned;

      expect(receivedSignal).toBeDefined();
      expect(receivedSignal?.aborted).toBeTrue();
      expect(cancelled).toBeTrue();
      expect(replacement.controlHealth.errors.join(" ")).not.toContain("superseded collection cancelled");
    } finally {
      clock.mockRestore();
    }
  });
});

describe("the derived control deadline is the collector container", () => {
  test("the dead provider allowance cannot inflate a 10 second provider budget past its 10 second container", async () => {
    let sidebarDeadlineMs: number | undefined;
    const state = tailHub({
      collectors: {
        sessions: async () => empty(),
        cmux: async () => ({ value: [], errors: [] }),
        sidebar: async (...args: unknown[]) => {
          const options = args.find((value) => value && typeof value === "object" && "deadlineMs" in value) as
            | { deadlineMs: number }
            | undefined;
          sidebarDeadlineMs = options?.deadlineMs;
          return { value: [], errors: [] };
        },
        notifications: async () => ({ value: [], errors: [] }),
        enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [] }),
      },
      refreshAggregateTimeoutMs: undefined,
      settingsReader: () => ({ ...normalizeSettings(undefined), providerWaitMs: 10_000 }),
    });

    await refresh(state);

    expect(sidebarDeadlineMs).toBe(10_000);
  });
});
