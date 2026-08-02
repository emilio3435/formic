import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonTriageQueueStore, TRIAGE_RETENTION_MS } from "../src/server/triage";

/* Triage retention, which measures from the right event and had nothing
   holding it there.

   Found by sweeping: changing `completedAt ?? createdAt` to `createdAt` alone
   survives triage.test.ts, operator-endpoints.test.ts, app-lifecycle.test.ts
   and policy-verifiability.test.ts. Twenty-one tests cover this store and none
   of them notices the retention clock moving.

   It is the archive defect exactly — a seven-day window measured from the wrong
   event — caught before it happened rather than after. An investigation opened
   eight days ago and finished this morning is the case that matters: measured
   from completion it stays a week, measured from creation it is already past
   the window and disappears the moment the store reloads, taking its result
   with it. Long investigations are precisely the ones worth reading afterwards.

   The general property is the one in policy-verifiability.test.ts: a figure the
   product publishes as a policy must be measured from a timestamp the system
   records for the event that policy names. This is that property applied to the
   fifth store, which the survey listed as sound-by-reading and left unpinned. */

const DAY_MS = 24 * 60 * 60 * 1_000;
const T0 = Date.parse("2026-08-02T12:00:00.000Z");

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function item(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "t1",
    issueId: "issue-1",
    state: "completed",
    title: "Investigate the stalled lane",
    summary: "A lane stopped reporting.",
    prompt: "Look into it.",
    agentIds: [],
    steps: [],
    evidence: [],
    createdAt: new Date(T0).toISOString(),
    ...overrides,
  };
}

/** Writes a queue file and opens it at T0, which is where retention is applied. */
async function reload(items: readonly Record<string, unknown>[]): Promise<readonly { issueId: string }[]> {
  const directory = mkdtempSync(join(tmpdir(), "anthill-triage-"));
  directories.push(directory);
  const path = join(directory, "triage-queue.json");
  writeFileSync(path, JSON.stringify(items), "utf8");
  const store = await JsonTriageQueueStore.open(path, () => T0);
  return store.list();
}

const ids = (kept: readonly { issueId: string }[]): string[] => kept.map(({ issueId }) => issueId);

describe("triage retention runs from completion, not from when the work was filed", () => {
  test("an old investigation completed today survives its full window", async () => {
    /* THE PROPERTY. Created eight days ago, finished this morning: past the
       window on the creation clock, comfortably inside it on the completion
       clock. This is the assertion that dies if the clock moves. */
    const kept = await reload([item({
      issueId: "finished-today",
      createdAt: new Date(T0 - 8 * DAY_MS).toISOString(),
      completedAt: new Date(T0).toISOString(),
    })]);

    expect(ids(kept)).toEqual(["finished-today"]);
  });

  test("an old investigation that never completed is dropped", async () => {
    /* The other side, and what stops the test above being satisfied by a store
       that simply keeps everything. With no completion the creation date is the
       only clock there is, and eight days is past the window. */
    const kept = await reload([item({
      issueId: "never-finished",
      state: "queued",
      createdAt: new Date(T0 - 8 * DAY_MS).toISOString(),
    })]);

    expect(ids(kept)).toEqual([]);
  });

  test("the two are decided differently in one reload, so the clock is doing the work", async () => {
    /* Both items are the same age. The only difference is whether they
       completed, and that alone decides which survives — so a build reading
       `createdAt` for both drops them together and fails here, and a build that
       retains everything keeps them both and fails here too. */
    const kept = await reload([
      item({
        issueId: "finished-today",
        createdAt: new Date(T0 - 8 * DAY_MS).toISOString(),
        completedAt: new Date(T0).toISOString(),
      }),
      item({
        issueId: "never-finished",
        state: "queued",
        createdAt: new Date(T0 - 8 * DAY_MS).toISOString(),
      }),
    ]);

    expect(ids(kept)).toEqual(["finished-today"]);
  });

  test("completion older than the window is dropped, so the clock still expires", async () => {
    /* Retention has to end. Measuring from completion must not become a way of
       keeping things forever — an investigation finished eight days ago is past
       the window on the clock that governs it. */
    const kept = await reload([item({
      issueId: "finished-long-ago",
      createdAt: new Date(T0 - 30 * DAY_MS).toISOString(),
      completedAt: new Date(T0 - 8 * DAY_MS).toISOString(),
    })]);

    expect(ids(kept)).toEqual([]);
    expect(TRIAGE_RETENTION_MS).toBe(7 * DAY_MS);
  });

  test("the window boundary is asserted at the boundary", async () => {
    /* Both sides of the edge, so the comparison cannot drift from <= to < , and
       so neither case above is passing on a comfortable margin. */
    const justInside = await reload([item({
      issueId: "inside",
      createdAt: new Date(T0 - 30 * DAY_MS).toISOString(),
      completedAt: new Date(T0 - TRIAGE_RETENTION_MS).toISOString(),
    })]);
    const justOutside = await reload([item({
      issueId: "outside",
      createdAt: new Date(T0 - 30 * DAY_MS).toISOString(),
      completedAt: new Date(T0 - TRIAGE_RETENTION_MS - 1).toISOString(),
    })]);

    expect(ids(justInside)).toEqual(["inside"]);
    expect(ids(justOutside)).toEqual([]);
  });
});
