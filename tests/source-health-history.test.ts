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
const CURSOR_FAILING: CollectionResult<CollectedAgent[]> = {
  value: [],
  errors: [
    "cursor GUI conversations: database is locked or busy; Cursor GUI sessions could not be enumerated for this scan.",
  ],
};

/** Scripts what each refresh sees, so history is built by refreshing rather
    than by assignment. */
function stateWith(scripts: ReadonlyArray<Partial<Record<Provider, CollectionResult<CollectedAgent[]>>>>) {
  let call = 0;
  const collectors = {
    sessions: async () => {
      const script = scripts[Math.min(call++, scripts.length - 1)] ?? {};
      return Object.fromEntries(PROVIDERS.map((provider) => [
        provider,
        script[provider] ?? EMPTY,
      ]));
    },
    cmux: async () => ({ value: [], errors: [] }),
    notifications: async () => ({ value: [], errors: [] }),
    enrichIdentity: async (surfaces: unknown) => ({ value: surfaces, errors: [] }),
  } as never;
  return new HubState(runner, archiveStore, [], { collectors });
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
    const state = stateWith([{}, { cursor: CURSOR_FAILING }, {}]);
    await state.refresh();
    const first = (await providerHealth(state, "cursor"))!.lastHealthyAt;
    await state.refresh();
    await new Promise((resolve) => setTimeout(resolve, 2));
    await state.refresh();

    const recovered = await providerHealth(state, "cursor");
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
    /* A new collector added to Provider without being wired here would leave
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

describe("every collected provider survives the refresh", () => {
  /* The gap that let Factory ship broken. `collectSessions` returned its
     sessions correctly and `#performRefresh` iterated a SECOND, hardcoded list
     that did not include it — so the rows were read and then dropped, the source
     was marked unhealthy, and the whole suite stayed green because every test
     asserted about providers the literal already contained.

     Driven from the union so it covers the provider added next, not the one
     added last. */
  const agentFor = (provider: Provider): CollectedAgent => ({
    id: `${provider}:s1`,
    provider,
    sourceSessionId: "s1",
    displayName: `${provider} session`,
    identity: { name: `${provider} session`, base: `${provider} session`, source: "origin-cwd" },
    cwd: "/Users/ant/Developer/thing",
    status: "running",
    statusReason: "recent",
    updatedAt: new Date().toISOString(),
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
  });

  test("a session from any provider reaches the board, not just the ones a literal listed", async () => {
    const everyProvider = Object.fromEntries(
      PROVIDERS.map((provider) => [provider, { value: [agentFor(provider)], errors: [] }]),
    ) as Partial<Record<Provider, CollectionResult<CollectedAgent[]>>>;

    const state = stateWith([everyProvider]);
    await state.refresh();

    const seen = new Set(
      state.get().programs.flatMap(({ agents }) => agents).map(({ provider }) => provider),
    );
    for (const provider of PROVIDERS) {
      expect(seen.has(provider), `${provider} was collected but never reached the board`).toBe(true);
    }
  });

  test("a provider that collected cleanly is reported healthy", async () => {
    /* The other half of the same defect: dropped rows also left the source
       reading unhealthy, which is the more alarming symptom of the two. */
    const everyProvider = Object.fromEntries(
      PROVIDERS.map((provider) => [provider, { value: [agentFor(provider)], errors: [] }]),
    ) as Partial<Record<Provider, CollectionResult<CollectedAgent[]>>>;

    const state = stateWith([everyProvider]);
    await state.refresh();

    for (const provider of PROVIDERS) {
      expect(await providerHealth(state, provider), `${provider} collected cleanly and still reads unhealthy`)
        .toMatchObject({ healthy: true });
    }
  });
});
