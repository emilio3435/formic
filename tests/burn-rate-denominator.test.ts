import { describe, expect, test } from "bun:test";
import { PulseTracker } from "../src/server/pulse";
import type { AgentSnapshot, HubSnapshot } from "../src/shared/types";

/* The tok/min on the strip, and the two ways it can read half its true value.

   PulseTracker gap-fills. When it goes unobserved across a five-minute
   boundary — the snapshot loop stalled, the process restarted, the fleet had
   nobody reporting tokens — it back-fills those windows with `tokens: null`
   (pulse.ts:222). Null there means NOBODY MEASURED THIS WINDOW. It does not
   mean zero tokens were burned in it.

   The rate is computed over the last two completed buckets, and the production
   code is careful about exactly this: it filters to buckets that were actually
   measured and divides by how many survived. Both halves are load-bearing and
   neither was tested. Removing the filter, or dividing by an assumed two
   buckets instead of the covered count, each survived every test in
   pulse.test.ts, completions-counter.test.ts, burnbar.test.ts,
   partial-measurement.test.ts and the three honesty files I wrote for exactly
   this bug class.

   Either mutation turns one measured bucket into two, and the fleet's burn rate
   is reported at half. This is the founding bug of this whole lane wearing a
   different hat: an absent measurement rendered as a zero, producing a number
   that is plausible, wrong, and wrong in the reassuring direction — the one
   direction nobody investigates. A board reading 74k tok/min while the fleet
   burns 149k does not look broken. It looks like a quiet afternoon.

   THE PROPERTY:

     A window nobody measured does not lengthen the window the rate names,
     and the rate times the window it names returns the tokens measured. */

const BUCKET_MS = 5 * 60_000;
const MINUTE_MS = 60_000;
const base = Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS;
const iso = (ms: number): string => new Date(ms).toISOString();

function agent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: "codex:worker",
    provider: "codex",
    sourceSessionId: "worker",
    displayName: "Worker",
    programId: "project",
    status: "running",
    statusReason: "Fixture activity is recent.",
    activity: "working",
    outcome: "healthy",
    updatedAt: iso(base),
    tokens: { sessionTotal: 0, provenance: "observed" },
    lastHumanMessage: null,
    artifacts: [],
    gates: [],
    target: { resolution: "missing" },
    controls: [],
    ...overrides,
  };
}

function snapshot(agents: readonly AgentSnapshot[]): HubSnapshot {
  const live = agents.filter((a) => a.activity === "working" || a.activity === "idle");
  return {
    schemaVersion: 1,
    generatedAt: iso(base),
    controlHealth: { cmuxReachable: true, lastCheckedAt: iso(base), errors: [], staleSources: [] },
    totals: {
      live: live.length,
      tracked: agents.length,
      attention: agents.filter((a) => a.status === "attention").length,
      working: agents.filter((a) => a.activity === "working").length,
      idle: agents.filter((a) => a.activity === "idle").length,
      ended: agents.filter((a) => a.activity === "ended").length,
    },
    programs: agents.length > 0 ? [{ id: "project", name: "Project", agents: [...agents] }] : [],
  } as HubSnapshot;
}

/** Reports `sessionTotal` tokens at `atMs`, which the tracker banks into
    whichever five-minute bucket contains that moment. */
const report = (tracker: PulseTracker, sessionTotal: number, atMs: number) =>
  tracker.observe(snapshot([agent({ tokens: { sessionTotal, provenance: "observed" }, updatedAt: iso(atMs) })]), atMs);

/* One bucket measured, the next one skipped entirely, then far enough forward
   that both are complete. The tracker never sees bucket 2, so it gap-fills it
   with tokens: null — a window with no measurement sitting directly beside a
   window with 60k of real burn. */
function measuredThenUnobserved(): ReturnType<PulseTracker["report"]> {
  const tracker = new PulseTracker();
  report(tracker, 0, base);
  report(tracker, 60_000, base + 4 * MINUTE_MS);
  // Nothing at all across bucket 2, then an observation in bucket 3 which
  // back-fills the skipped window as unmeasured.
  return tracker.report(base + 2 * BUCKET_MS + MINUTE_MS);
}

describe("the burn rate is divided by the window it was actually measured over", () => {
  test("an unobserved window does not lengthen the window the rate names", () => {
    /* Kills the filter removal. One bucket was measured, so the declared window
       is one bucket. Counting the gap-filled bucket as a real zero would report
       a ten-minute window and halve the rate, and the arithmetic would still be
       internally consistent — which is why the window has to be asserted
       directly rather than inferred from the rate. */
    const pulse = measuredThenUnobserved();

    expect(pulse.burn.windowMs).toBe(BUCKET_MS);
    expect(pulse.burn.windowMs).not.toBe(2 * BUCKET_MS);
  });

  test("the rate times the window it names returns the tokens measured", () => {
    /* Kills the fixed denominator. The declared window and the divisor are two
       separate expressions in the source, so a rate can name five minutes and
       be computed over ten. Multiplying one by the other is what catches the
       disagreement. */
    const pulse = measuredThenUnobserved();
    const declaredMinutes = (pulse.burn.windowMs ?? 0) / MINUTE_MS;

    expect(declaredMinutes).toBeGreaterThan(0);
    expect((pulse.burn.tokensPerMin ?? 0) * declaredMinutes).toBe(60_000);
  });

  test("the rate reads the true burn, not half of it", () => {
    /* The same claim as a number an operator would recognise. 60k over the one
       five-minute window that was measured is 12k/min. Both mutations report
       6k — a plausible figure, and the fleet looks half as busy as it is. */
    const pulse = measuredThenUnobserved();

    expect(pulse.burn.tokensPerMin).toBe(12_000);
    expect(pulse.burn.tokensPerMin).not.toBe(6_000);
  });

  test("two measured windows are genuinely averaged across both", () => {
    /* The control, and the reason the tests above are about measurement rather
       than about always dividing by one. With both buckets measured the divisor
       IS two, so a fix that hard-coded a single-bucket window would fail here.

       30k in the first window and 90k in the second is 120k over ten minutes,
       12k/min — deliberately the same rate as the single-bucket case above, so
       neither test can pass by pinning a number that happens to be right for
       the wrong window. */
    const tracker = new PulseTracker();
    report(tracker, 0, base);
    report(tracker, 30_000, base + 4 * MINUTE_MS);
    report(tracker, 120_000, base + BUCKET_MS + 4 * MINUTE_MS);
    const pulse = tracker.report(base + 2 * BUCKET_MS + MINUTE_MS);

    expect(pulse.burn.windowMs).toBe(2 * BUCKET_MS);
    expect(pulse.burn.tokensPerMin).toBe(12_000);
    expect((pulse.burn.tokensPerMin ?? 0) * 10).toBe(120_000);
  });

  test("older windows are excluded from the numerator, not just from the divisor", () => {
    /* The mirror of the tests above, and the one they could not catch: every
       fixture so far had exactly two completed buckets, so summing "all
       completed" and summing "the last two measured" gave the same number.

       With a third window in play they diverge, and in the opposite direction —
       an hour of accumulated burn divided by ten minutes reports a fleet
       spending several times what it is. Understating is the failure nobody
       investigates; overstating is the one that sends someone hunting a runaway
       agent that does not exist. The rate has to name the last ten minutes and
       be built from the last ten minutes, in both directions.

       100k in the oldest window, then 30k and 90k in the two most recent: the
       honest rate is 120k over ten minutes. */
    const tracker = new PulseTracker();
    report(tracker, 0, base);
    report(tracker, 100_000, base + 4 * MINUTE_MS);
    report(tracker, 130_000, base + BUCKET_MS + 4 * MINUTE_MS);
    report(tracker, 220_000, base + 2 * BUCKET_MS + 4 * MINUTE_MS);
    const pulse = tracker.report(base + 3 * BUCKET_MS + MINUTE_MS);

    expect(pulse.burn.windowMs).toBe(2 * BUCKET_MS);
    expect(pulse.burn.tokensPerMin).toBe(12_000);
    // The whole 220k spread over the same ten minutes is what the board would
    // read if the numerator outran the window.
    expect(pulse.burn.tokensPerMin).not.toBe(22_000);
  });

  test("with nothing measured at all the rate is withheld, not reported as zero", () => {
    /* The floor of the same property. No covered bucket means no denominator,
       and a fleet whose burn was never measured must not be rendered as a fleet
       that burned nothing — the BurnBar failure this lane started from. */
    const tracker = new PulseTracker();
    tracker.observe(snapshot([agent({ tokens: { provenance: "unknown" } })]), base);
    const pulse = tracker.report(base + 2 * BUCKET_MS);

    expect(pulse.burn.tokensPerMin).toBeNull();
    expect(pulse.burn.tokensPerMin).not.toBe(0);
  });
});

describe("stalled counts agents that look fine but have gone quiet", () => {
  test("an agent already reported as failed is not also counted as stalled", () => {
    /* `stalled` exists to surface the agents nothing else is flagging: healthy
       by every signal the board has, and silent past the threshold. An agent
       whose outcome is already failed is on the board under its own fault, and
       counting it again turns one problem into two — inflating the number that
       is supposed to mean "nobody has noticed these yet".

       Dropping the healthy check survived every existing pulse test. */
    const longAgo = iso(base - 60 * MINUTE_MS);
    const tracker = new PulseTracker();
    const now = base + MINUTE_MS;

    tracker.observe(snapshot([
      agent({
        id: "codex:quiet",
        status: "waiting",
        activity: "idle",
        lifecycle: "waiting",
        outcome: "healthy",
        updatedAt: longAgo,
      }),
      agent({
        id: "codex:broken",
        status: "waiting",
        activity: "idle",
        lifecycle: "waiting",
        outcome: "failed",
        updatedAt: longAgo,
      }),
    ]), now);
    const pulse = tracker.report(now);

    expect(pulse.momentum.stalledAgentIds).toContain("codex:quiet");
    expect(pulse.momentum.stalledAgentIds).not.toContain("codex:broken");
    expect(pulse.momentum.stalled).toBe(1);
  });
});
