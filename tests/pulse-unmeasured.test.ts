import { describe, expect, test } from "bun:test";
import { PulseTracker } from "../src/server/pulse";
import { buildSnapshot } from "../src/server/snapshot";
import type { CollectedAgent } from "../src/server/types";
import type { HubSnapshot, Provider } from "../src/shared/types";
// @ts-expect-error The dependency-free browser client intentionally has no declaration file.
import { sparklineSegments } from "../src/web/dom-primitives.js";

/* The activity trend during a collection outage.

   Found while closing entry 6 and ranked top of the map afterwards, on the rule
   that has now produced four defects: it is a figure nothing else on this board
   cross-checks. Nothing else computes an activity trend, so there is no second
   line to disagree when this one is wrong.

   `PulseTracker.observe` runs on every snapshot, including one published after
   the collector aggregate timed out. It wrote no false zero — the agent loop
   simply had nothing to iterate — but the bucket kept its initial
   `activeSessions: 0` and published it as a measurement. A five-minute stretch
   where the board could not see anything drew a trough identical to a
   five-minute stretch where nothing happened.

   `tokens` had been nullable for exactly this reason since it was written.
   `activeSessions` was not, which is the whole defect: the same bucket carried
   one field that could say "unknown" and one that could only say "zero". */

const PROVIDERS: Provider[] = ["omp", "codex", "claude", "cursor"];
const BUCKET_MS = 5 * 60_000;
const T0 = Date.parse("2026-08-02T12:00:00.000Z");

function agent(id: string, updatedAt: string): CollectedAgent {
  return {
    id, provider: "codex", sourceSessionId: id, displayName: id,
    status: "running", statusReason: "Source is active.",
    updatedAt, tokens: { provenance: "unknown" }, artifacts: [], gates: [],
  };
}

/** A snapshot the tracker will accept, healthy or with every source stale. */
function snapshot(options: { agents?: readonly CollectedAgent[]; stale?: boolean; now: Date }): HubSnapshot {
  return buildSnapshot({
    agents: options.agents ?? [],
    surfaces: [],
    archiveStore: { has: () => false, archive: async () => {} },
    now: options.now,
    ...(options.stale
      ? { sourceErrors: Object.fromEntries(PROVIDERS.map((provider) => [provider, ["collector aggregate exceeded deadline"]])) }
      : {}),
  });
}

/** Runs the tracker across `count` buckets, choosing health per bucket. */
function trend(count: number, stale: (index: number) => boolean) {
  const tracker = new PulseTracker(async () => ({ available: false }) as never);
  for (let index = 0; index < count; index += 1) {
    const at = T0 + index * BUCKET_MS;
    tracker.observe(
      snapshot({
        agents: [agent("codex:a", new Date(at).toISOString())],
        stale: stale(index),
        now: new Date(at),
      }),
      at,
    );
  }
  // Report from the bucket AFTER the last one, so every bucket above is complete.
  return tracker.report(T0 + count * BUCKET_MS).activity.buckets;
}

describe("a bucket nobody could observe reports unknown, not zero", () => {
  test("an outage bucket publishes null rather than a count of none", async () => {
    /* THE DEFECT. Bucket 1 is observed only through snapshots where all four
       collectors are stale. Its `activeSessions` was 0 — indistinguishable from
       a genuinely quiet five minutes, and drawn as one. */
    const buckets = trend(3, (index) => index === 1);

    expect(buckets[0]!.activeSessions).toBe(1);
    expect(buckets[1]!.activeSessions, "an unobservable bucket still claimed a count").toBeNull();
    expect(buckets[2]!.activeSessions).toBe(1);
  });

  test("a healthy bucket still reports its count", async () => {
    /* The control, and the one that keeps the assertion above honest: a tracker
       that nulled everything would satisfy it and publish no trend at all. */
    const buckets = trend(3, () => false);

    expect(buckets.map((bucket) => bucket.activeSessions)).toEqual([1, 1, 1]);
  });

  test("a partial collector failure is still a measurement", async () => {
    /* Deliberately NOT nulled. One provider failing leaves the other three
       measuring, so the count is a floor rather than a fiction — and marking
       every partial failure unknown would blank the trend on a machine that
       merely does not have Cursor installed. Only a total blackout is unknown. */
    const tracker = new PulseTracker(async () => ({ available: false }) as never);
    for (let index = 0; index < 2; index += 1) {
      const at = T0 + index * BUCKET_MS;
      tracker.observe(buildSnapshot({
        agents: [agent("codex:a", new Date(at).toISOString())],
        surfaces: [],
        archiveStore: { has: () => false, archive: async () => {} },
        now: new Date(at),
        sourceErrors: { cursor: ["cursor store unreadable"] },
      }), at);
    }

    expect(tracker.report(T0 + 2 * BUCKET_MS).activity.buckets[0]!.activeSessions).toBe(1);
  });

  test("one good look in a bucket is enough to make it measured", async () => {
    /* Refreshes land every few seconds, so a bucket holds many observations and
       a single timeout among them says nothing about the other fifty-nine. The
       bucket is unknown only when NOTHING in it succeeded. */
    const tracker = new PulseTracker(async () => ({ available: false }) as never);
    const updatedAt = new Date(T0).toISOString();
    tracker.observe(snapshot({ agents: [agent("codex:a", updatedAt)], stale: true, now: new Date(T0) }), T0);
    tracker.observe(snapshot({ agents: [agent("codex:a", updatedAt)], stale: false, now: new Date(T0 + 1_000) }), T0 + 1_000);
    tracker.observe(snapshot({ agents: [agent("codex:a", updatedAt)], stale: true, now: new Date(T0 + 2_000) }), T0 + 2_000);

    expect(tracker.report(T0 + BUCKET_MS).activity.buckets[0]!.activeSessions).toBe(1);
  });

  test("buckets nothing ever looked at are unknown too", async () => {
    /* Backfill, which was quietly the larger version of the same bug. When the
       process is restarted or the loop stalls past five minutes, `#ensureBucket`
       invents the buckets in between so the axis stays continuous — and every
       one of them published `activeSessions: 0`. A board that was switched off
       for half an hour drew half an hour of measured calm. */
    const tracker = new PulseTracker(async () => ({ available: false }) as never);
    tracker.observe(snapshot({ agents: [agent("codex:a", new Date(T0).toISOString())], now: new Date(T0) }), T0);
    const skipped = T0 + 4 * BUCKET_MS;
    tracker.observe(snapshot({ agents: [agent("codex:a", new Date(skipped).toISOString())], now: new Date(skipped) }), skipped);

    const buckets = tracker.report(skipped + BUCKET_MS).activity.buckets;
    const byStart = new Map(buckets.map((bucket) => [bucket.start, bucket.activeSessions]));

    expect(byStart.get(new Date(T0).toISOString())).toBe(1);
    for (const gap of [1, 2, 3]) {
      expect(
        byStart.get(new Date(T0 + gap * BUCKET_MS).toISOString()),
        `bucket +${gap} was never observed but claimed a count`,
      ).toBeNull();
    }
    expect(byStart.get(new Date(skipped).toISOString())).toBe(1);
  });
});

/* The render half. A marker nothing draws is a marker nobody reads, and the
   sparkline's old behaviour turned a published null into two separate lies.

   Asserted on the GEOMETRY rather than the SVG, which is why it is a separate
   exported function: `svgSparkline` needs a document and this repo carries no
   DOM library, so the existing web suite falls back to checking that the source
   text contains the function name. Where the line breaks and where each point
   sits are the behaviour; the elements are just how it is drawn. */
describe("the sparkline draws a gap as a gap", () => {
  test("an unmeasured bucket breaks the stroke instead of closing over it", () => {
    /* Non-finite values were filtered out before the geometry was computed, so
       the line joined the measured points either side and an outage rendered as
       an unbroken trend. */
    expect(sparklineSegments([4, 5, null, 6, 7])).toHaveLength(2);
  });

  test("a continuous series is still one unbroken line", () => {
    // The control: breaking every series would satisfy the test above.
    expect(sparklineSegments([4, 5, 6, 7])).toHaveLength(1);
  });

  test("a hole keeps its place on the time axis", () => {
    /* The second, quieter half of the same bug. x is the array index, so
       dropping a value restretched every point after it — the chart silently
       rescaled its own time axis, and five buckets of history drew as four. The
       last reading of a five-value series belongs at x=100 whether or not one of
       them is a hole. */
    const x = (segments: string[][], index: number) => segments.flat()[index]!.split(",")[0];
    const dense = sparklineSegments([1, 2, 3, 4, 5]);
    const holed = sparklineSegments([1, 2, null, 4, 5]);

    expect(x(dense, -1 + dense.flat().length)).toBe("100.0");
    expect(x(holed, -1 + holed.flat().length)).toBe("100.0");
    // The point before the hole stays where it was rather than sliding left.
    expect(x(holed, 1)).toBe(x(dense, 1));
  });

  test("a lone measurement between two holes is drawn, not dropped", () => {
    const marooned = sparklineSegments([1, null, 5, null, 9]);

    expect(marooned).toHaveLength(3);
    // Duplicated coordinate under a round cap: a dot, not a vanished reading.
    expect(marooned[1]).toHaveLength(2);
    expect(marooned[1]![0]).toBe(marooned[1]![1]);
  });

  test("fewer than two real readings is still no chart", () => {
    // Unchanged: a single dot is not a trend and would only fake one.
    expect(sparklineSegments([null, 3, null])).toEqual([]);
    expect(sparklineSegments([null, null])).toEqual([]);
  });
});
