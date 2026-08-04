import { describe, expect, test } from "bun:test";
import { ATTENTION_RETENTION_MS, MemoryAttentionStore, parseCmuxNotifications } from "../src/server/cmux";

/* Snooze, which had one test and four unguarded branches.

   Snooze is the only control that makes an agent's request for a human
   disappear on a timer. Acknowledge clears a notification that has been read;
   snooze hides one that has NOT, and promises to bring it back. So the promise
   is the whole feature: a snooze the server cannot bound is not a snooze, it is
   permanent silence with a friendlier name.

   Mutation testing found the existing coverage tested only that a snooze
   EXPIRES. Removing the validation entirely, accepting a snooze dated in the
   past, accepting an unbounded one, and accepting an unparseable one each
   killed nothing across cmux, notifications and operator-endpoints.

   The unbounded case is the one that costs something. A snooze a century out is
   accepted, stored, and silently suppresses that agent for the life of the
   board — the same family as the epoch-stamped notification that could never
   clear its acknowledgement watermark, arriving through the front door instead
   of through a parse failure.

   THE PROPERTY:

     A snooze has an end the server checked. One it cannot bound is refused,
     not stored as silence. */

const NOW = Date.parse("2026-08-02T10:00:00.000Z");
const SURFACE = "SURF-A";

const wire = (surfaceId: string, id: string) => JSON.stringify([
  { id, surface_id: surfaceId, workspace_id: "W", title: "Agent needs you", created_at: "2026-08-02T09:00:00.000Z" },
]);

const notifications = (surfaceId = SURFACE, id = "n1") => parseCmuxNotifications(wire(surfaceId, id));

/** A store that has observed one unread notification on SURFACE. */
function observing(nowMs = NOW): MemoryAttentionStore {
  const store = new MemoryAttentionStore(() => nowMs);
  store.observe(notifications());
  return store;
}

const iso = (ms: number) => new Date(ms).toISOString();

describe("a snooze has an end the server checked", () => {
  test("a snooze inside the retention window is accepted", () => {
    /* The control for every refusal below. Without it they would all hold on a
       build that refused every snooze, which removes the feature rather than
       bounding it. */
    const store = observing();

    return store.apply(SURFACE, "snooze", iso(NOW + 60 * 60_000)).then((record) => {
      expect(record.action).toBe("snooze");
      expect(record.snoozedUntil).toBe(iso(NOW + 60 * 60_000));
    });
  });

  test("a snooze with no end at all is refused", async () => {
    // No timestamp means no promise to return, which is the one thing snooze
    // exists to make.
    await expect(observing().apply(SURFACE, "snooze")).rejects.toThrow();
  });

  test("a snooze the server cannot read as a time is refused", async () => {
    /* An unparseable value is worse than useless here: it stores a record whose
       snoozedUntil never compares true, so the row is neither snoozed nor
       clean, and the operator sees a snooze that did nothing. */
    await expect(observing().apply(SURFACE, "snooze", "tomorrow")).rejects.toThrow();
    await expect(observing().apply(SURFACE, "snooze", "")).rejects.toThrow();
  });

  test("a snooze that has already ended is refused", async () => {
    // Backdating would write a record that is expired on arrival — an operator
    // clicking snooze and seeing nothing happen.
    await expect(observing().apply(SURFACE, "snooze", iso(NOW - 60 * 60_000))).rejects.toThrow();
  });

  test("a snooze ending exactly now is refused, since it buys nothing", async () => {
    // The boundary from below.
    await expect(observing().apply(SURFACE, "snooze", iso(NOW))).rejects.toThrow();
  });

  test("a snooze beyond the retention window is refused", async () => {
    /* The one that costs something. Records are retained for seven days, so a
       snooze past that outlives the record meant to end it — the row is
       suppressed with nothing left to bring it back. A century out is accepted
       by a build with no upper bound, and the agent is gone for good. */
    await expect(observing().apply(SURFACE, "snooze", iso(NOW + ATTENTION_RETENTION_MS + 60_000))).rejects.toThrow();
    await expect(observing().apply(SURFACE, "snooze", iso(NOW + 100 * 365 * 24 * 60 * 60_000))).rejects.toThrow();
  });

  test("the boundary is asserted at the boundary, so it cannot drift", async () => {
    /* Exactly the retention window is the longest snooze that still has a
       record to end it, and it must be accepted; one millisecond past it must
       not be.

       Asserted at the edge rather than a comfortable minute either side of it,
       because a test that snoozes for six days and twenty-three hours passes
       whichever way the comparison points. Moving `>` to `>=` was the one
       mutation the first draft of this file could not kill. */
    await expect(observing().apply(SURFACE, "snooze", iso(NOW + ATTENTION_RETENTION_MS))).resolves.toBeTruthy();

    await expect(observing().apply(SURFACE, "snooze", iso(NOW + ATTENTION_RETENTION_MS + 1))).rejects.toThrow();
  });

  test("a refused snooze leaves no record behind", async () => {
    /* A refusal that still wrote would be the worst outcome: the operator is
       told it failed while the row goes quiet anyway. */
    const store = observing();

    await store.apply(SURFACE, "snooze", "tomorrow").catch(() => undefined);

    expect(store.get(SURFACE)).toBeUndefined();
    expect(store.list()).toEqual([]);
    expect(store.filter(notifications())).toHaveLength(1);
  });
});

describe("a snooze suppresses only what it promised, and gives it back", () => {
  test("the snoozed surface goes quiet while it lasts", async () => {
    const store = observing();
    await store.apply(SURFACE, "snooze", iso(NOW + 30 * 60_000));

    expect(store.filter(notifications())).toHaveLength(0);
  });

  test("the notification returns once the clock passes the end", () => {
    /* The promise kept, and the half the existing suite already covered.
       Retained here because the refusals above are only meaningful if the
       accepted path genuinely expires — a snooze that never returned would make
       every bound above cosmetic. */
    let now = NOW;
    const store = new MemoryAttentionStore(() => now);
    store.observe(notifications());

    return store.apply(SURFACE, "snooze", iso(NOW + 30 * 60_000)).then(() => {
      expect(store.filter(notifications())).toHaveLength(0);
      now = NOW + 31 * 60_000;
      expect(store.filter(notifications())).toHaveLength(1);
    });
  });

  test("snoozing one surface leaves another still asking", async () => {
    // Snooze is per surface. Silencing a neighbour would hide an agent nobody
    // chose to hide.
    const store = new MemoryAttentionStore(() => NOW);
    const alpha = notifications(SURFACE, "n-alpha");
    const bravo = notifications("SURF-B", "n-bravo");
    store.observe([...alpha, ...bravo]);

    await store.apply(SURFACE, "snooze", iso(NOW + 30 * 60_000));

    expect(store.filter(alpha)).toHaveLength(0);
    expect(store.filter(bravo)).toHaveLength(1);
  });

  test("snoozing a surface the store never observed is refused", async () => {
    /* Fail-closed, same as acknowledge: a record written for a surface with no
       observed notification would silence the first one it ever produces. */
    const store = new MemoryAttentionStore(() => NOW);

    await expect(store.apply("SURF-NEVER-SEEN", "snooze", iso(NOW + 30 * 60_000))).rejects.toThrow();
    expect(store.list()).toEqual([]);
  });
});
