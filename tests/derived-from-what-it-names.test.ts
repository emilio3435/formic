import { describe, expect, test } from "bun:test";
import { PulseTracker } from "../src/server/pulse";
import { buildSnapshot } from "../src/server/snapshot";
import type { AgentSnapshot, HubPulse, HubSnapshot } from "../src/shared/types";
import type { ArchiveStore, CollectedAgent } from "../src/server/types";

/* ONE property, stated once and applied everywhere it can be:

     A figure that names a window or a population must be derived from that
     window or that population.

   Four of today's defects were this bug wearing different hats. The sparkline
   claimed an hour on 12.7 minutes of buckets. BURN showed a rate over one
   population beside a cost over another. The momentum counter reported a
   five-minute observation as "this hour". Elapsed claimed working time while
   measuring a span with a fortnight of dormancy inside it.

   Written four times it reads as four fixes. Written once it is a check any new
   number can be held to: name the window or population the label implies, name
   the one the code used, and require them to be the same.

   The violation collector below is the property. The tests are the sites it is
   applied to; adding a site means adding a case to it, not writing a fifth
   version of the idea.

   Two related pins live elsewhere and are not duplicated here: the tracker's own
   observed window in pulse-window-honesty.test.ts, and the activity bucket span
   in magnitude-bounds.test.ts. */

const BUCKET_MS = 5 * 60_000;
const HOUR_MS = 60 * 60_000;
const START = Math.floor(Date.parse("2026-08-02T10:00:00.000Z") / BUCKET_MS) * BUCKET_MS;
const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
const iso = (ms: number) => new Date(ms).toISOString();

/* ---------------------------------------------------------------------------
   THE PROPERTY. Each clause names the figure, the thing it claims, and the
   thing it must have been derived from. */

function derivationViolations(pulse: HubPulse, agents: readonly AgentSnapshot[]): string[] {
  const problems: string[] = [];

  /* A rate names a window. `tokensPerMin` is tokens per minute over
     `burn.windowMs`, so the two must appear and disappear together — a rate
     with no window behind it was divided by a span nobody observed. */
  const hasRate = pulse.burn.tokensPerMin != null;
  const hasWindow = pulse.burn.windowMs > 0;
  if (hasRate !== hasWindow) {
    problems.push(`burn: rate ${hasRate ? "present" : "absent"} but window ${hasWindow ? "present" : "absent"}`);
  }
  if (hasRate && !Number.isFinite(pulse.burn.tokensPerMin!)) {
    problems.push(`burn: rate is ${pulse.burn.tokensPerMin}, which is what dividing by an unobserved window produces`);
  }

  /* A coverage suffix names a population: "N/M reporting" claims N of the M
     agents the figure summed. The audit calls this a repeat offender — the
     denominator drawn from a different population than the figure it
     qualifies — so N can never exceed M. */
  const { reporting, eligible } = pulse.burn.coverage;
  if (reporting > eligible) {
    problems.push(`burn coverage: ${reporting} reporting out of ${eligible} eligible`);
  }

  /* A count names a window. The tracker cannot have watched longer than an
     hour of history exists for. */
  if (pulse.momentum.observedWindowMs > HOUR_MS) {
    problems.push(`momentum: claims ${pulse.momentum.observedWindowMs}ms of a ${HOUR_MS}ms window`);
  }

  /* A duration names what it measured. Working time is a subset of the span
     that contains it, so active can never exceed elapsed — the relation that
     was unavailable until activeMs reached the wire, and the reason Elapsed
     could only be described rather than bounded. */
  for (const agent of agents) {
    const { activeMs, elapsedMs } = agent;
    if (activeMs === undefined || elapsedMs === undefined) continue;
    if (activeMs > elapsedMs) {
      problems.push(`${agent.id}: ${activeMs}ms active inside a ${elapsedMs}ms span`);
    }
  }

  return problems;
}

/* ------------------------------------------------------------------ setup -- */

function agent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: "codex:test", provider: "codex", sourceSessionId: "test", displayName: "Test session",
    programId: "project", status: "running", statusReason: "Fixture activity is recent.",
    activity: "working", outcome: "healthy", updatedAt: iso(START),
    tokens: { sessionTotal: 0, provenance: "observed" },
    lastHumanMessage: null, artifacts: [], gates: [], target: { resolution: "missing" },
    ...overrides,
  } as AgentSnapshot;
}

function snapshot(generatedAtMs: number, agents = [agent({ updatedAt: iso(generatedAtMs) })]): HubSnapshot {
  return {
    schemaVersion: 1, generatedAt: iso(generatedAtMs),
    programs: [{ id: "project", name: "Project", agents }],
    totals: { live: agents.length, tracked: agents.length, attention: 0, working: agents.length, idle: 0, ended: 0, needsYou: 0, history: 0 },
    issues: [],
  } as unknown as HubSnapshot;
}

/** A tracker watched for `elapsedMs`, then asked to report. */
function pulseAfter(elapsedMs: number): HubPulse {
  const tracker = new PulseTracker(undefined, START);
  for (let at = START; at <= START + elapsedMs; at += BUCKET_MS) tracker.observe(snapshot(at), at);
  return tracker.report(START + elapsedMs);
}

describe("a figure is derived from the window or population it names", () => {
  test("a freshly started tracker violates nothing", () => {
    /* The control for the property itself. Every rejection below would also
       hold on a collector that reported violations unconditionally. */
    expect(derivationViolations(pulseAfter(0), [])).toEqual([]);
  });

  test("a tracker with an hour of history violates nothing", () => {
    expect(derivationViolations(pulseAfter(HOUR_MS), [])).toEqual([]);
  });

  test("a rate and its window appear and disappear together", () => {
    /* The second pulse survivor. Computing tokensPerMin with no covered
       buckets divides by a span nobody observed; the result is a rate per
       minute of nothing, which is either Infinity or a number invented from a
       zero denominator. Neither is a rate. */
    const early = pulseAfter(0);

    expect(early.burn.tokensPerMin).toBeNull();
    expect(early.burn.windowMs).toBe(0);
    expect(derivationViolations(early, [])).toEqual([]);
  });

  test("a rate present without a window is caught", () => {
    // Hand-built because the tracker will not currently produce it — the point
    // is that the property would catch it if anything ever did.
    const broken = pulseAfter(HOUR_MS);
    const violations = derivationViolations(
      { ...broken, burn: { ...broken.burn, tokensPerMin: 5_000, windowMs: 0 } },
      [],
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("window absent");
  });

  test("a window present without a rate is caught too", () => {
    // The mirror. A window with nothing derived over it is a claim with no
    // figure attached, which is how a stale window outlives its data.
    const broken = pulseAfter(HOUR_MS);
    const violations = derivationViolations(
      { ...broken, burn: { ...broken.burn, tokensPerMin: null, windowMs: 600_000 } },
      [],
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("rate absent");
  });

  test("a coverage suffix cannot name more reporters than the population it qualifies", () => {
    /* "N/M reporting" has now been wrong on two widgets for the same reason: a
       completeness denominator drawn from a different population than the
       figure it describes. */
    const base = pulseAfter(HOUR_MS);
    const violations = derivationViolations(
      { ...base, burn: { ...base.burn, coverage: { reporting: 12, eligible: 4, unknown: 0 } } },
      [],
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("12 reporting out of 4");
  });

  test("working time inside its own span violates nothing", () => {
    /* Elapsed, bounded honestly at last. Until activeMs reached the wire in
       6379fec there was no field to compare against, and the only available
       ceiling would have been a guess about human working patterns. */
    const inside = [agent({ activeMs: 45 * 60_000, elapsedMs: 87 * 24 * 60 * 60_000 })];

    expect(derivationViolations(pulseAfter(HOUR_MS), inside)).toEqual([]);
  });

  test("working time exceeding the span that contains it is caught", () => {
    // Working time is a subset of the span, so this is arithmetic rather than
    // a threshold: no session works for longer than it has existed.
    const impossible = [agent({ activeMs: 2 * HOUR_MS, elapsedMs: HOUR_MS })];
    const violations = derivationViolations(pulseAfter(HOUR_MS), impossible);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("active inside");
  });

  test("an agent that could not measure working time is skipped, not defaulted", () => {
    /* activeMs is absent when a session recorded too few turns to measure an
       interval, and absent is not zero. Reading it as zero would report every
       short session as having done no work. */
    const unmeasured = [agent({ elapsedMs: HOUR_MS })];

    expect(derivationViolations(pulseAfter(HOUR_MS), unmeasured)).toEqual([]);
  });

  test("the property holds across a real snapshot build", () => {
    /* End to end rather than on hand-built payloads: agents through
       buildSnapshot, then the tracker over them, then the property. A figure
       that drifts from its population somewhere in that pipeline fails here. */
    const collected = (overrides: Partial<CollectedAgent> = {}): CollectedAgent => ({
      id: `codex:${overrides.sourceSessionId ?? "a"}`, provider: "codex", sourceSessionId: "a",
      displayName: "Worker", cwd: "/Users/me/project", status: "running",
      statusReason: "Source activity within 3 minutes.",
      startedAt: iso(START - HOUR_MS), updatedAt: iso(START),
      tokens: { provenance: "unknown" }, artifacts: [], gates: [], ...overrides,
    });
    const built = buildSnapshot({
      agents: [collected({ sourceSessionId: "a" }), collected({ sourceSessionId: "b", status: "waiting" })],
      surfaces: [], archiveStore, now: new Date(START),
    } as never);

    const tracker = new PulseTracker(undefined, START - HOUR_MS);
    tracker.observe(built, START);

    expect(derivationViolations(tracker.report(START), built.programs.flatMap(({ agents }) => agents))).toEqual([]);
  });
});
