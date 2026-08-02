import { beforeAll, describe, expect, test } from "bun:test";
import { buildSnapshot } from "../src/server/snapshot";
import { PulseTracker } from "../src/server/pulse";
import type { ArchiveStore, CollectedAgent } from "../src/server/types";

/* The same shape as tests/control-advertisement-invariant.test.ts, one layer
   out: two sides of a contract asserted separately against fixtures neither
   side produced.

   The server builds a HubSnapshot. The client renders one. Between them,
   web-client.test.ts hand-writes thirteen snapshot literals and clean-board.ts
   writes another — and every one of those is a shape the server may never emit.
   A client test passing against a hand-written snapshot says the client handles
   THAT object. It says nothing about the object the server sends.

   Nothing is currently drifting; I checked before writing this and every widget
   renders correctly from a real snapshot. That is the point of adding it now
   rather than after. The failure mode is silent: rename a field on one side and
   the fixtures keep the tests green while the board renders "No data" over a
   number the server computed correctly.

   THE CONTRACT, asserted in both directions:

     A widget reports a missing reading if and only if the server actually
     omitted the quantity it names.

   One direction alone is worthless. "Never reports missing" fails on an empty
   fleet, where missing is correct. "Reports missing when the field is absent"
   passes on a client that reports missing for everything. Tying the two
   together is what makes a renamed field fail. */

const DAY = "2026-08-02T12:00:00.000Z";
const T0 = Date.parse(DAY);
const BUCKET_MS = 5 * 60_000;

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let M: any;

beforeAll(async () => {
  // @ts-expect-error The dependency-free browser client has no declaration file.
  await import("../src/web/app.js");
  M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
});

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

/* Builds a snapshot the way the server does: buildSnapshot for the board, a
   PulseTracker driven across real bucket boundaries for the pulse. Nothing here
   is a literal — every field the client reads below was computed by production
   code from collector-shaped input. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serverSnapshot(agents: readonly CollectedAgent[], extra: Record<string, unknown> = {}): any {
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

/** The fleet states an operator actually sees, each built by the server. */
const FLEETS = () => [
  { label: "one working agent", snapshot: serverSnapshot([agent()]) },
  { label: "empty fleet", snapshot: serverSnapshot([]) },
  { label: "an agent asking for a human", snapshot: serverSnapshot([agent({ status: "attention" })]) },
  {
    label: "control plane unreachable",
    snapshot: serverSnapshot([agent()], { cmuxReachable: false, cmuxErrors: ["cmux socket refused the connection"] }),
  },
  {
    label: "an agent near its context limit",
    snapshot: serverSnapshot([agent({
      tokens: { sessionTotal: 120_000, total: 960_000, provenance: "observed", contextWindow: 1_000_000 },
    })]),
  },
];

/* What each widget claims to report, and where the server puts it. The pairing
   is the test: it is what turns "the client says No data" into a checkable
   statement about the server's output rather than a fact about a fixture. */
const SOURCES: Record<string, (snapshot: Record<string, unknown>) => boolean> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  "burn": (s: any) => typeof s.pulse?.burn?.tokensPerMin === "number",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  "context-peak": (s: any) => typeof s.contextPeak === "number",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  "momentum": (s: any) => typeof s.pulse?.momentum?.working === "number",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  "needs-you": (s: any) => typeof s.totals?.needsYou === "number",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  "health": (s: any) => typeof s.totals?.sourceHealth?.total === "number",
};

const isMissing = (data: { value?: unknown; tone?: unknown }): boolean =>
  data.tone === "missing" || data.value === "No data";

describe("the client renders snapshots the server actually produced", () => {
  test("every default widget renders from a server-built snapshot without throwing", () => {
    /* The floor. A client reading a field the server stopped emitting can throw
       on a nested access, and no hand-written fixture would notice because the
       fixture still has the field. */
    for (const { label, snapshot } of FLEETS()) {
      for (const id of M.DEFAULT_WIDGET_IDS) {
        const data = M.summaryWidgetData(id, snapshot, "live");
        expect(data, `${id} on ${label}`).toBeDefined();
        expect(String(data.value ?? "").length, `${id} on ${label} rendered an empty value`).toBeGreaterThan(0);
      }
      expect(M.pulseStripModel(snapshot, "live", [], "percent", ""), label).toBeDefined();
    }
  });

  test("a widget reports missing exactly when the server omitted the quantity", () => {
    /* THE CONTRACT, both directions at once.

       If the server computed a number and the widget says "No data", the client
       is reading a field the server does not emit — a rename, a moved nesting,
       a schema change on one side only. If the server omitted it and the widget
       shows a figure, the client invented one, which is this lane's oldest bug
       class.

       Asserted per widget per fleet, so the empty fleet contributes the missing
       cases and the populated fleets contribute the present ones. */
    for (const { label, snapshot } of FLEETS()) {
      for (const [id, serverHasIt] of Object.entries(SOURCES)) {
        const data = M.summaryWidgetData(id, snapshot, "live");
        expect(isMissing(data), `${id} on ${label}: server provided=${serverHasIt(snapshot)}, widget missing=${isMissing(data)}`)
          .toBe(!serverHasIt(snapshot));
      }
    }
  });

  test("the fleets exercise both sides of that contract, so it is not vacuous", () => {
    /* The anti-hollow guard. An if-and-only-if is satisfied trivially when one
       side never varies: if the server always emitted every quantity, the test
       would only ever check the "present" branch and a client that never
       reported missing would pass.

       The empty fleet is what supplies the other branch, so this asserts both
       branches genuinely occur across the set. */
    const fleets = FLEETS();
    const neverProvided: string[] = [];
    let omitted = 0;

    for (const [id, serverHasIt] of Object.entries(SOURCES)) {
      const providedSomewhere = fleets.some(({ snapshot }) => serverHasIt(snapshot));
      if (!providedSomewhere) neverProvided.push(id);
      omitted += fleets.filter(({ snapshot }) => !serverHasIt(snapshot)).length;
    }

    /* PER WIDGET, not across all of them. A global count passes as long as SOME
       widget is populated, so a reading that silently vanished — contextPeak
       computing undefined on every fleet — would leave the if-and-only-if
       holding (server omits, widget says missing, they agree) while the board
       lost a number permanently. Verified by mutation: pinning contextPeak to
       undefined survives every other assertion in this file.

       Requiring each widget to be genuinely provided somewhere is what turns a
       disappeared reading into a failure. */
    expect(neverProvided).toEqual([]);
    expect(omitted).toBeGreaterThan(0);
  });

  test("the snapshots carry the fields the client reads, not a subset of them", () => {
    /* Why hand-written fixtures drift without anyone noticing.

       The real pulse carries windowMs, completionsProvenance, stalledAgentIds,
       stallThresholdMs, bucketMinutes and observedSince. Fixtures written by
       hand tend to carry the two or three fields their author needed, so a
       client that starts reading a fourth is exercised by nothing.

       This pins the shape the client is entitled to expect, so removing a field
       from the server fails here rather than silently degrading a sublabel. */
    const [{ snapshot }] = FLEETS();

    /* Top-level first, because the if-and-only-if above cannot catch a field
       being DROPPED. Removing contextPeak from the server moves both sides at
       once — the server omits it and the widget correctly reports missing — so
       they still agree and the contract stays satisfied while the board loses a
       reading. Verified by mutation: deleting it survives every other test in
       this file.

       Same limit as the control invariant, where deleting the attestation rule
       changed both sides identically. Tying two sides together buys agreement
       and costs coverage of what they agreed about, so the census has to be
       asserted separately. */
    expect(Object.keys(snapshot)).toEqual(
      expect.arrayContaining([
        "schemaVersion", "generatedAt", "totals", "programs", "pulse",
        "controlHealth", "issues", "contextPeak", "contextMedian",
      ]),
    );

    expect(Object.keys(snapshot.pulse.burn)).toEqual(
      expect.arrayContaining(["tokensPerMin", "windowMs", "coverage", "costLastHourUsd", "costProvenance"]),
    );
    expect(Object.keys(snapshot.pulse.momentum)).toEqual(
      expect.arrayContaining(["working", "completionsLastHour", "completionsProvenance", "observedWindowMs", "stalled"]),
    );
    expect(Object.keys(snapshot.totals)).toEqual(
      expect.arrayContaining(["needsYou", "tracked", "working", "idle", "sourceHealth"]),
    );
  });

  test("the burn sublabel names the window the server measured, not a fixed string", () => {
    /* The concrete drift this would have caught. The client renders "10m
       average" by reading pulse.burn.windowMs — a field clean-board.test.ts's
       fixture does not have at all. That test passes because it only asserts
       the value and the tone.

       So the sublabel is derived from a server field that no hand-written
       fixture exercises, which is precisely the unguarded surface. */
    const [{ snapshot }] = FLEETS();
    const burn = M.summaryWidgetData("burn", snapshot, "live");
    const minutes = snapshot.pulse.burn.windowMs / 60_000;

    expect(snapshot.pulse.burn.windowMs).toBeGreaterThan(0);
    expect(String(burn.sublabel)).toContain(`${minutes}m`);
  });
});
