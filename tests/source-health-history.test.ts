import { describe, expect, test } from "bun:test";
import { PROVIDERS } from "../src/shared/types";
import { HubState } from "../src/server/state";
import type { ArchiveStore, CollectedAgent, CollectionResult, CommandRunner } from "../src/server/types";
import type { Provider } from "../src/shared/types";

/* The one payload shape reference-docs could not produce, produced.

   `sourceHealth.byProvider` carries `lastHealthyAt`, and the day-one screen
   depends on it: a collector that has NEVER been healthy has nothing to read
   yet, while one that WAS healthy and is not now has actually failed. Only the
   second is a fault. Get that backwards and either a fresh machine is told it
   is broken, or a real failure is muted.

   buildSnapshot cannot make that distinction — it has zero references to
   byProvider, because the field is attached afterwards by
   HubState.#withSourceHealth from state the class holds ACROSS refreshes.
   never-healthy versus was-healthy-now-not is a fact about history, and a
   single snapshot structurally cannot carry it.

   So the docs test hand-writes it, honestly, and that fixture keeps passing
   whether or not the server still emits the shape — the exact failure mode that
   hid a changed day-one screen behind four green assertions this afternoon.
   This closes it at the only layer that can: drive HubState through real
   refresh cycles and assert on what it produces. */

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
const runner: CommandRunner = {
  run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
};

const EMPTY: CollectionResult<CollectedAgent[]> = { value: [], errors: [] };
const FAILING: CollectionResult<CollectedAgent[]> = {
  value: [],
  errors: ["claude /Users/me/.claude/projects: EACCES: permission denied"],
};

/** Scripts what each refresh sees, so history is built by refreshing rather
    than by assignment. */
function stateWith(scripts: ReadonlyArray<Partial<Record<Provider, CollectionResult<CollectedAgent[]>>>>) {
  let call = 0;
  const collectors = {
    sessions: async () => {
      const script = scripts[Math.min(call++, scripts.length - 1)] ?? {};
      return {
        omp: script.omp ?? EMPTY,
        codex: script.codex ?? EMPTY,
        claude: script.claude ?? EMPTY,
        cursor: script.cursor ?? EMPTY,
        factory: script.factory ?? EMPTY,
      };
    },
    cmux: async () => ({ value: [], errors: [] }),
    notifications: async () => ({ value: [], errors: [] }),
    enrichIdentity: async (surfaces: unknown) => ({ value: surfaces, errors: [] }),
  } as never;
  return new HubState(runner, archiveStore, [], collectors);
}

const providerHealth = async (state: HubState, provider: Provider) => {
  const byProvider = state.get().totals.sourceHealth?.byProvider;
  return byProvider?.[provider];
};

describe("byProvider carries history, which one snapshot cannot", () => {
  test("a collector that has never been healthy has no lastHealthyAt", async () => {
    /* The fresh-machine case. Before the first successful read there is nothing
       to remember, and `null` is what says so — not a fabricated timestamp, and
       not a claim of failure. */
    const state = stateWith([{ claude: FAILING }]);
    await state.refresh();

    expect(await providerHealth(state, "claude")).toEqual({ healthy: false, lastHealthyAt: null });
  });

  test("a successful read records when it happened", async () => {
    const state = stateWith([{}]);
    await state.refresh();

    const claude = await providerHealth(state, "claude");
    expect(claude?.healthy).toBe(true);
    expect(claude?.lastHealthyAt, "a healthy read left no timestamp to remember it by").toBeTruthy();
    expect(Number.isFinite(Date.parse(claude!.lastHealthyAt!))).toBe(true);
  });

  test("a collector that WAS healthy keeps its timestamp when it fails", async () => {
    /* THE PROPERTY, and the only one that needs two refreshes: healthy, then
       broken. The timestamp survives the failure, which is what lets the client
       tell a real degradation from a tool that was never installed. Assign
       instead of remember and every fresh machine reads as faulty. */
    const state = stateWith([{}, { claude: FAILING }]);
    await state.refresh();
    const healthyAt = (await providerHealth(state, "claude"))!.lastHealthyAt;

    await state.refresh();
    const afterFailure = await providerHealth(state, "claude");

    expect(afterFailure?.healthy).toBe(false);
    expect(afterFailure?.lastHealthyAt, "the failure erased the memory of having worked")
      .toBe(healthyAt);
  });

  test("recovery refreshes the timestamp rather than keeping the stale one", async () => {
    // Otherwise "last healthy" would name a moment two failures ago.
    const state = stateWith([{}, { claude: FAILING }, {}]);
    await state.refresh();
    const first = (await providerHealth(state, "claude"))!.lastHealthyAt;
    await state.refresh();
    await new Promise((resolve) => setTimeout(resolve, 2));
    await state.refresh();

    const recovered = await providerHealth(state, "claude");
    expect(recovered?.healthy).toBe(true);
    expect(recovered?.lastHealthyAt).not.toBe(first);
  });

  test("one collector's failure does not disturb its neighbours' history", async () => {
    /* The shape reference-docs asserts: three fine, one broken. Produced here
       rather than typed, so if HubState stops emitting it this test notices and
       that fixture cannot. */
    const state = stateWith([{}, { claude: FAILING }]);
    await state.refresh();
    await state.refresh();

    const byProvider = state.get().totals.sourceHealth?.byProvider;
    expect(byProvider, "byProvider stopped reaching the wire").toBeDefined();
    expect(byProvider!.claude.healthy).toBe(false);
    for (const provider of ["omp", "codex", "cursor"] as const) {
      expect(byProvider![provider].healthy, `${provider} was dragged down with claude`).toBe(true);
    }
  });

  test("every provider the union declares appears on the wire", async () => {
    /* A fifth collector added to Provider without being wired here would leave
       the client reading `undefined.healthy` on the day-one screen. */
    const state = stateWith([{}]);
    await state.refresh();

    const byProvider = state.get().totals.sourceHealth?.byProvider ?? {};
    /* Derived from the union: the point of this test is that EVERY declared
       provider reaches the wire, so a hardcoded list would stop testing that on
       the very commit that adds one. */
    expect(Object.keys(byProvider).sort()).toEqual([...PROVIDERS].sort());
  });
});
