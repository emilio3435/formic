import { describe, expect, test } from "bun:test";
import { createMountainFetch, MemoryActionLogStore, type MountainAppState } from "../src/server/app";
import { MemoryAttentionStore } from "../src/server/cmux";
import type { ArchiveStore, CollectedAgent } from "../src/server/types";
import type { HubSnapshot } from "../src/shared/types";

/* The other half of the archive defect: the export published `retentionDays: 30`
   — the CONSTANT — beside records whose actual retention nobody had measured.

   A policy printed alongside data it does not describe is the same shape as a
   figure with no coverage: it reads as a report and is only an intention. And
   the intention was not being met, because retention ran from each agent's last
   activity rather than from when the archive took custody, so a session quiet
   for 31 days was pruned on the very next commit while the operator was told
   ok: true. Nothing could catch that after the fact, because 0 of 546 live
   records carried an archive time at all.

   So the export now carries both: what the policy promises, and what it has
   actually delivered, measured from the records themselves. */

const ORIGIN = "http://127.0.0.1:4701";
const NOW = Date.parse("2026-08-02T12:00:00.000Z");
const daysAgo = (days: number): string => new Date(NOW - days * 24 * 60 * 60 * 1_000).toISOString();

function emptyBoard(): HubSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: new Date(NOW).toISOString(),
    controlHealth: { cmuxReachable: true, lastCheckedAt: new Date(NOW).toISOString(), errors: [], staleSources: [] },
    totals: { live: 0, tracked: 0, attention: 0 },
    programs: [],
  } as unknown as HubSnapshot;
}

async function exportBody(records: Array<Partial<CollectedAgent>>) {
  const state: MountainAppState = {
    get: () => emptyBoard(),
    subscribe: () => () => {},
    refresh: async () => emptyBoard(),
  };
  const archiveStore: ArchiveStore = {
    has: () => false,
    archive: async () => {},
    archivedAgents: () => records as readonly CollectedAgent[],
  };
  const fetch = createMountainFetch({
    state,
    archiveStore,
    actionLogStore: new MemoryActionLogStore(),
    attentionStore: new MemoryAttentionStore(),
    now: () => NOW,
    webRoot: import.meta.dir,
  } as never);
  const response = await fetch(new Request(`${ORIGIN}/api/history/export`));
  const body = await response.json() as {
    retentionDays: number;
    deliveredRetention: { measured: number; unmeasurable: number; oldestDays: number | null };
  };
  fetch.dispose?.();
  return body;
}

describe("the export measures what retention delivered, not only what it intends", () => {
  test("delivered retention comes from the records, not from the constant", async () => {
    const body = await exportBody([
      { id: "a", archivedAt: daysAgo(11) },
      { id: "b", archivedAt: daysAgo(2) },
    ]);

    // The promise is unchanged and still published.
    expect(body.retentionDays).toBe(30);
    /* What it has actually delivered so far is 11 days. A reader can now see
       that 30 is an intention this archive has not yet been old enough to
       test — which is a different statement from "we keep 30 days". */
    expect(body.deliveredRetention.oldestDays).toBe(11);
    expect(body.deliveredRetention.measured).toBe(2);
    expect(body.deliveredRetention.unmeasurable).toBe(0);
  });

  test("records written before archivedAt existed are counted, not guessed at", async () => {
    /* Absent-first, on the very field whose absence is the finding. Assigning
       them an archive time would fabricate the evidence this exists to supply. */
    const body = await exportBody([{ id: "legacy" }, { id: "new", archivedAt: daysAgo(3) }]);

    expect(body.deliveredRetention.measured).toBe(1);
    expect(body.deliveredRetention.unmeasurable).toBe(1);
    expect(body.deliveredRetention.oldestDays).toBe(3);
  });

  test("an archive with nothing measurable claims no delivered retention", async () => {
    const body = await exportBody([{ id: "legacy" }]);

    // Not 0 days, which would assert we kept nothing. We do not know.
    expect(body.deliveredRetention.oldestDays).toBeNull();
    expect(body.deliveredRetention.unmeasurable).toBe(1);
  });

  test("an empty archive is not a retention failure", async () => {
    const body = await exportBody([]);

    expect(body.deliveredRetention).toEqual({ measured: 0, unmeasurable: 0, oldestDays: null });
  });

  test("delivered retention tracks the OLDEST record, not the newest or the mean", async () => {
    /* The number that answers "is the promise being kept" is how far back the
       archive still reaches. A mean would be dragged down by every fresh record
       and would improve as the archive filled up, which is backwards. */
    const body = await exportBody([
      { id: "a", archivedAt: daysAgo(1) },
      { id: "b", archivedAt: daysAgo(1) },
      { id: "c", archivedAt: daysAgo(28) },
    ]);

    expect(body.deliveredRetention.oldestDays).toBe(28);
  });
});
