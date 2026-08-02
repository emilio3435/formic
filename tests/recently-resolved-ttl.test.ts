import { describe, expect, test } from "bun:test";
import { lifecycleIssues } from "../src/server/snapshot-issues";
import type { OperatorIssue } from "../src/shared/types";

/* The "recently resolved" strip, which nothing exercised.

   Found by sweeping the four policies policy-verifiability.test.ts surveyed by
   reading. Three of them turned out to be genuinely guarded elsewhere — the
   action log clock, the identity binding TTL and attention retention all die
   under mutation — so this is the only one that needed writing, and no
   ceremonial tests were added for the other three.

   `lifecycleIssues` is called by no test in the suite. Making resolved issues
   linger forever survives all 132 tests across snapshot, state-health,
   health-card, overhaul-guards, snapshot-edges and triage.

   What it costs if it breaks: the strip exists to tell an operator "this
   cleared while you were away". An entry that never expires turns a fifteen
   minute reassurance into a permanent claim that something was fixed, sitting
   on the board next to things that are actually true. And the entry is removed
   when the issue COMES BACK, so a stuck one would say "resolved" about a fault
   that is live right now.

   RECENTLY_RESOLVED_TTL_MS is module-private, so the window is written here as
   fifteen minutes to match. That means a change to the constant does not fail
   this file — it fails the boundary assertions below only if the change is
   large enough to cross a minute either side, which is the honest limit of
   testing an unexported number. */

const TTL_MS = 15 * 60_000;
const T0 = Date.parse("2026-08-02T12:00:00.000Z");
const at = (ms: number): Date => new Date(ms);

function issue(id: string, overrides: Partial<OperatorIssue> = {}): OperatorIssue {
  return {
    id,
    kind: "system",
    severity: "warning",
    title: `Issue ${id}`,
    summary: "Something needed attention.",
    affectedAgentIds: [],
    ...overrides,
  } as OperatorIssue;
}

/** An issue already carrying a resolution stamp, as it arrives back on the next
    snapshot through `recentlyResolved`. */
function resolvedAt(id: string, ms: number): OperatorIssue {
  return issue(id, {
    lifecycle: {
      state: "resolved",
      openedAt: new Date(T0 - 24 * 60 * 60_000).toISOString(),
      resolvedAt: new Date(ms).toISOString(),
    },
  } as Partial<OperatorIssue>);
}

const ids = (issues: readonly OperatorIssue[]): string[] => issues.map(({ id }) => id);

describe("a resolved issue is announced briefly, then stops being news", () => {
  test("an issue that disappears is announced as resolved, stamped now", () => {
    /* The entry path. An issue present on the previous snapshot and absent from
       this one has been fixed, and the strip says so. */
    const { recentlyResolved } = lifecycleIssues([], { previousIssues: [issue("gone")] }, at(T0));

    expect(ids(recentlyResolved)).toEqual(["gone"]);
    expect(recentlyResolved[0]!.lifecycle?.resolvedAt).toBe(new Date(T0).toISOString());
    expect(recentlyResolved[0]!.lifecycle?.state).toBe("resolved");
  });

  test("it is still announced inside the window", () => {
    const { recentlyResolved } = lifecycleIssues(
      [],
      { recentlyResolved: [resolvedAt("cleared", T0 - 60_000)] },
      at(T0),
    );

    expect(ids(recentlyResolved)).toEqual(["cleared"]);
  });

  test("it stops being announced once the window passes", () => {
    /* THE GAP. Without this, a build where resolved issues never expire passes
       every test in the suite, and the strip accumulates permanent claims that
       things were fixed. */
    const { recentlyResolved } = lifecycleIssues(
      [],
      { recentlyResolved: [resolvedAt("cleared", T0 - TTL_MS - 60_000)] },
      at(T0),
    );

    expect(ids(recentlyResolved)).toEqual([]);
  });

  test("the window is asserted from both sides in one call, so it cannot drift", () => {
    /* Two issues, same call, differing only in when they resolved. A build that
       kept everything fails on the stale one; a build that kept nothing fails on
       the fresh one. Neither can be satisfied by a constant answer. */
    const { recentlyResolved } = lifecycleIssues(
      [],
      {
        recentlyResolved: [
          resolvedAt("fresh", T0 - TTL_MS + 60_000),
          resolvedAt("stale", T0 - TTL_MS - 60_000),
        ],
      },
      at(T0),
    );

    expect(ids(recentlyResolved)).toEqual(["fresh"]);
  });

  test("an issue that comes back stops being announced as resolved immediately", () => {
    /* The property that matters most on a live board, and it is not about time
       at all. A fault that clears and returns within the window is CURRENT, and
       an entry saying it was resolved would be a claim contradicted by the row
       directly above it.

       Well inside the TTL, so this can only pass by checking the current issue
       set rather than the clock. */
    const stillBroken = issue("flapping");
    const { issues, recentlyResolved } = lifecycleIssues(
      [stillBroken],
      { recentlyResolved: [resolvedAt("flapping", T0 - 60_000)] },
      at(T0),
    );

    expect(ids(issues)).toEqual(["flapping"]);
    expect(ids(recentlyResolved)).toEqual([]);
  });

  test("a resolution with no timestamp is dropped rather than kept forever", () => {
    /* Absent evidence is not a fresh resolution. An entry whose resolvedAt is
       missing or unparseable has no clock governing it, so keeping it would be
       an unbounded announcement — the same shape as a snooze with no end. */
    const undated = issue("undated", { lifecycle: { state: "resolved" } } as Partial<OperatorIssue>);
    const unparseable = resolvedAt("garbled", T0);
    (unparseable.lifecycle as { resolvedAt: string }).resolvedAt = "whenever";

    const { recentlyResolved } = lifecycleIssues([], { recentlyResolved: [undated, unparseable] }, at(T0));

    expect(ids(recentlyResolved)).toEqual([]);
  });
});
