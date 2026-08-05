import { describe, expect, test } from "bun:test";
import { buildSnapshot } from "../src/server/snapshot";
import { PulseTracker } from "../src/server/pulse";
import type { ArchiveStore, CollectedAgent } from "../src/server/types";

/* THE GAP THIS CLOSES.

   Tests that exist because a fix landed are guarded. Nothing asserted that a
   guard STAYS meaningful when the code beneath it changes again.

   Twice today a guard went vacuous in one commit, silently. `completionsLastHour`
   was hardcoded to null and every assertion in its file became unfalsifiable —
   four toBeNull, two not.toBe(1), one (x ?? 0) under toBeLessThan(2) — while
   the suite reported green. B8 went the same way. Both were caught only
   because a person went looking.

   The mechanism here is a REGISTER, not a cleverer assertion.

     Every scalar the board publishes is driven across fourteen fleet states. A
     field that takes the same value in all fourteen must be named in
     DELIBERATELY_CONSTANT, with a reason and a pointer to what still covers it.

   So collapsing a field to a constant turns this test red at the moment of the
   commit. The author has two options and both are loud: revert, or add a
   register entry. The register entry is the point at which somebody has to
   write down what still tests the field — which is the question nobody asked
   when completionsLastHour was pinned to null.

   It converts a silent hollowing into a forced, reviewable decision. That is
   the whole of the idea; there is no assertion here that is cleverer than the
   ones it protects.

   WHAT IT CANNOT DO, stated plainly because the limit is real and load-bearing:

     Its power is exactly the breadth of the fourteen states below. A field that is
     constant across these but varies in production will be registered wrongly,
     and the register entry will look like a considered decision when it is an
     artefact of my fixtures. So a new entry is only as good as the person
     adding it, and the honest use of this file is as a prompt to think, not as
     proof that thinking happened.

     It also says nothing about whether the ASSERTIONS on a varying field are
     any good. A field can vary healthily while every test naming it is
     hollow. That is what scripts/constant-collapse.sh is for, and the two are
     complements: this one fires automatically and cheaply on the day of the
     collapse, that one is exhaustive and manual. */

const DAY = "2026-08-02T12:00:00.000Z";
const T0 = Date.parse(DAY);
const BUCKET_MS = 5 * 60_000;
const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };

/* Fields that legitimately do not vary. Each entry must say WHY it is constant
   and WHAT still tests it. An entry with no pointer is a field nothing covers.

   Adding to this list is the announcement. It is meant to be slightly annoying
   — the friction is the feature. */
const DELIBERATELY_CONSTANT: Record<string, string> = {
  "momentum.completionsLastHour":
    "Withheld by design: completion is undetectable for 96% of agents and success is unverifiable. "
    + "Covered by tests/completions-counter.test.ts, which asserts it stays null in a POPULATED state "
    + "alongside a non-zero working count, so a reinstated counter turns that file red.",
  "momentum.completionsProvenance":
    "Single-member union in shared/types.ts, so tsc proves the value and a runtime assertion is ceremony. "
    + "Deliberately NOT asserted anywhere.",
  "momentum.stallThresholdMs":
    "A published policy constant, not a measurement. Covered by tests/completions-counter.test.ts, which "
    + "asserts the boundary from both sides using the published value rather than a literal.",
  "burn.costProvenance":
    "Constant across these fixtures because none of them supplies a priced burn source. Real variation is "
    + "covered by tests/usage-cost-honesty.test.ts and tests/burn-cost-floor.test.ts against real rows.",
  "burn.costLastHourUsd":
    "Same reason as costProvenance: no priced source in these fixtures. Real cost variation is covered in "
    + "tests/burn-cost-floor.test.ts and tests/cumulative-session-rows.test.ts against real and fixture rows.",
  "momentum.observedWindowMs":
    "Constant here because every state reports at the same instant relative to the tracker's start. Its real "
    + "behaviour is covered by tests/pulse-window-honesty.test.ts, which drives the clock forward and asserts "
    + "the window never exceeds the time actually watched.",
  /* totals.sourceHealth.total and .absent were registered here on the grounds
     that no fixture could move them. The "a collector that cannot read its
     files" state moves both, so the entries were stale and are gone — which is
     what this register is supposed to do to itself. */
};

function agent(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: "codex:a1",
    provider: "codex",
    sourceSessionId: "a1",
    displayName: "Ridge worker",
    cwd: "/tmp/project",
    status: "running",
    statusReason: "Fixture activity is recent.",
    startedAt: "2026-08-02T09:00:00.000Z",
    updatedAt: DAY,
    tokens: { sessionTotal: 120_000, total: 400_000, provenance: "observed", contextWindow: 1_000_000 },
    artifacts: [],
    gates: [],
    processAlive: true,
    ...overrides,
  } as CollectedAgent;
}

const many = (count: number, overrides: (index: number) => Partial<CollectedAgent>) =>
  Array.from({ length: count }, (_, index) =>
    agent({ id: `codex:a${index}`, sourceSessionId: `a${index}`, ...overrides(index) }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function published(agents: readonly CollectedAgent[], extra: Record<string, unknown> = {}): any {
  const tracker = new PulseTracker();
  for (const [at, sessionTotal] of [
    [T0 - 2 * BUCKET_MS, 0],
    [T0 - 2 * BUCKET_MS + 4 * 60_000, 30_000],
    [T0 - BUCKET_MS + 4 * 60_000, 120_000],
  ] as const) {
    tracker.observe(
      buildSnapshot({
        agents: agents.map((a) => ({ ...a, tokens: { ...a.tokens, sessionTotal } })),
        surfaces: [],
        archiveStore,
        now: new Date(at),
      }),
      at,
    );
  }
  const snapshot = buildSnapshot({ agents, surfaces: [], archiveStore, now: new Date(T0), ...extra });
  return { ...snapshot, pulse: tracker.report(T0) };
}

/* Fourteen states an operator actually sees. The test is exactly as strong as
   this list, so adding a state is the cheapest way to strengthen it. */
const STATES: readonly { label: string; snapshot: unknown }[] = [
  { label: "empty fleet", snapshot: published([]) },
  { label: "one agent working", snapshot: published([agent()]) },
  { label: "several agents, mixed activity", snapshot: published(many(6, (i) => ({
    status: i % 3 === 0 ? "running" : i % 3 === 1 ? "waiting" : "stale",
  }))) },
  /* Carries attentionSignal, not just status: totals.needsYou counts the
     signal. The first draft set status alone and needsYou stayed 0 in all
     eight states, which this file then reported as a collapsed field. It was
     my fixture. */
  { label: "an agent asking for a human", snapshot: published([agent({
    status: "attention",
    attentionSignal: { kind: "question-pending", detail: "Waiting on a human." },
  } as Partial<CollectedAgent>)]) },
  /* LIVE but silent, which is what `stalled` counts. The first draft made
     these processAlive:false, so they read as ended, left the live population
     entirely and stalled stayed 0 everywhere. */
  { label: "a live fleet gone quiet", snapshot: published(many(4, () => ({
    updatedAt: new Date(T0 - 3 * 60 * 60_000).toISOString(),
    status: "waiting",
    processAlive: true,
  }))) },
  { label: "a Cursor fleet with a model policy", snapshot: published([
    agent({ id: "cursor:parent", provider: "cursor", sourceSessionId: "parent", model: "grok-4.5" }),
    agent({ id: "cursor:child", provider: "cursor", sourceSessionId: "child", model: "gpt-5.6-sol", parentSourceSessionId: "parent" }),
  ]) },
  /* Ended agents, which nothing else here produces: totals.ended and
     totals.history both count them and both sat at 0 in every state until
     this was added. Another fixture gap this file found in itself. */
  { label: "a fleet that has finished", snapshot: published(many(3, () => ({
    status: "stale",
    processAlive: false,
    processIds: [4_242],
    updatedAt: new Date(T0 - 6 * 60 * 60_000).toISOString(),
  }))) },
  /* Quiet with NOTHING to check — the population this board used to file as
     ended and now calls unverified. Nothing else here produces it: every other
     quiet state carries a process answer one way or the other, so
     totals.byLifecycle.unverified sat at 0 in all twelve other states and this file
     reported it collapsed. It was the fixture, again. */
  { label: "a fleet gone quiet with no process to check", snapshot: published(many(3, () => ({
    status: "stale",
    updatedAt: new Date(T0 - 5 * 60 * 60_000).toISOString(),
    // Explicitly cleared: the factory's default is a LIVE process, which would
    // make this state a duplicate of "a live fleet gone quiet".
    processAlive: undefined,
  }))) },
  /* A record that left the scan window: held by the archive, absent from this
     scan. It is the only way totals.retained is anything but 0, and the only
     state that exercises the scope gate keeping history out of the live counts. */
  { label: "a session that left the scan window", snapshot: published([agent()], {
    archiveStore: {
      has: () => false,
      archive: async () => {},
      archivedAgents: () => [agent({
        id: "codex:retained",
        sourceSessionId: "retained",
        updatedAt: new Date(T0 - 48 * 60 * 60_000).toISOString(),
        archivedAt: new Date(T0 - 40 * 60 * 60_000).toISOString(),
        lifecycle: "waiting",
        provenance: "turn-complete",
      } as Partial<CollectedAgent>)],
    } as ArchiveStore,
  }) },
  /* An unread cmux notification, which is the ONLY thing that sets
     totals.attention now. It used to be reachable by writing status:"attention"
     onto a fixture, and this file duly reported the field as varying — off a
     state no real board could produce. The notification has to be real. */
  { label: "an agent with an unread notification", snapshot: published([agent({
    id: "codex:notified", sourceSessionId: "notified", cwd: "/Users/me/notified",
  } as Partial<CollectedAgent>)], {
    surfaces: [{ surfaceId: "SURFACE-NOTIFY", cwd: "/Users/me/notified", sourceSessionIds: ["notified"], runtimeSurfaceReady: true }],
    notifications: [{ surfaceId: "SURFACE-NOTIFY", body: "May I push this branch?" }],
  }) },
  { label: "an agent near its context limit", snapshot: published([agent({
    tokens: { sessionTotal: 120_000, total: 985_000, provenance: "observed", contextWindow: 1_000_000 },
  })]) },
  { label: "control plane unreachable", snapshot: published([agent()], {
    cmuxReachable: false, cmuxErrors: ["cmux socket refused the connection"],
  }) },
  /* A broken COLLECTOR, which is a different fault from a broken control plane
     and now the only thing that moves sourceHealth. Once cmux stopped being
     counted as a collector, the state above no longer varied those four fields
     and the vacuity guard went red — correctly: every assertion about
     sourceHealth had become unfalsifiable across this matrix. The answer is a
     state that exercises them, not a register entry excusing them. */
  { label: "a collector that cannot read its files", snapshot: published([agent()], {
    sourceErrors: { claude: ["EACCES scanning ~/.claude/projects"] },
    sourceAbsent: { cursor: true },
  }) },
  { label: "a large fleet", snapshot: published(many(25, (i) => ({
    status: i % 4 === 0 ? "stale" : "running",
    tokens: { sessionTotal: i * 1_000, total: i * 20_000, provenance: i % 5 === 0 ? "unknown" : "observed", contextWindow: 1_000_000 },
  }))) },
];

/** Flattens the scalar leaves of the published surfaces we care about. */
function scalars(snapshot: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (value: any, path: string): void => {
    if (value === null || typeof value !== "object") {
      out.set(path, JSON.stringify(value ?? null));
      return;
    }
    if (Array.isArray(value)) {
      out.set(path, JSON.stringify(value.length));
      return;
    }
    for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = snapshot as any;
  walk(snap.pulse?.momentum, "momentum");
  walk(snap.pulse?.burn, "burn");
  walk(snap.totals, "totals");
  return out;
}

function observedValues(): Map<string, Set<string>> {
  const seen = new Map<string, Set<string>>();
  for (const { snapshot } of STATES) {
    for (const [path, value] of scalars(snapshot as Record<string, unknown>)) {
      const bucket = seen.get(path) ?? new Set<string>();
      bucket.add(value);
      seen.set(path, bucket);
    }
  }
  return seen;
}

describe("a field that stops varying announces itself", () => {
  test("every published scalar either varies across the fleet states or is registered", () => {
    /* THE GUARD. A fix that collapses a field to a constant turns this red on
       the day it lands, and the only ways out are reverting or writing a
       register entry that says what still covers the field.

       The failure message names the fields so the author does not have to
       reverse-engineer which one moved. */
    const constant = [...observedValues()]
      .filter(([, values]) => values.size === 1)
      .map(([path]) => path)
      .filter((path) => !(path in DELIBERATELY_CONSTANT))
      .sort();

    expect(
      constant,
      "These published fields took the same value in all fourteen fleet states. If that is "
      + "deliberate, add each to DELIBERATELY_CONSTANT with a reason and a pointer to what "
      + "still tests it. If it is not, a fix has just made every assertion about them unfalsifiable.",
    ).toEqual([]);
  });

  test("every register entry names something that still covers the field", () => {
    /* The register is only worth having if its entries carry the pointer. An
       entry saying "constant by design" and nothing else is how a field
       becomes permanently untested with a paper trail that looks like
       diligence. */
    for (const [path, reason] of Object.entries(DELIBERATELY_CONSTANT)) {
      expect(reason.length, `${path}: register entry is too short to say anything`).toBeGreaterThan(80);
      expect(reason, `${path}: register entry names no test, no type and no reason`)
        .toMatch(/tests\/|tsc|shared\/types|NOT asserted/);
    }
  });

  test("the register does not name fields that are in fact varying", () => {
    /* Registers rot in the other direction too. A field listed here that has
       since started varying means the entry is stale, and a stale entry is a
       standing excuse for the next person to skip the question. */
    const varying = [...observedValues()].filter(([, values]) => values.size > 1).map(([path]) => path);
    const staleEntries = Object.keys(DELIBERATELY_CONSTANT).filter((path) => varying.includes(path));

    expect(staleEntries, "these are registered as constant but now vary; remove them").toEqual([]);
  });

  test("the fleet states genuinely differ, or the whole file proves nothing", () => {
    /* The anti-hollow guard for the guard. If every state produced the same
       snapshot — a broken fixture helper, a tracker that ignores its input —
       then EVERY field would look constant, the register would fill up with
       apologies, and the file would have inverted into a machine for
       manufacturing false reassurance. */
    const seen = observedValues();
    const varying = [...seen.values()].filter((values) => values.size > 1).length;

    expect(STATES.length).toBe(14);
    expect(seen.size, "no published scalars were collected at all").toBeGreaterThan(10);
    expect(varying, "not one published field varied across fourteen states").toBeGreaterThan(5);
  });

  test("the states differ from each other, not just from the empty one", () => {
    /* Sharper than the count above. Nine populated states that are identical
       to one another would still show "variation" against the empty fleet
       while testing a single shape seven times. */
    const fingerprints = new Set(
      STATES.map(({ snapshot }) => JSON.stringify([...scalars(snapshot as Record<string, unknown>)])),
    );

    expect(fingerprints.size, "fleet states collapsed to fewer distinct shapes than expected").toBe(STATES.length);
  });
});
