import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonAttentionStore } from "../src/server/cmux";
import { lifecycleIssues } from "../src/server/snapshot-issues";
import type { OperatorIssue } from "../src/shared/types";

/* WHICH records survive a cap, which no fixture in this suite could answer.

   Both stores below sort and then slice. The sort is the whole behaviour — it
   decides what an operator still sees once the cap bites — and reversing it
   passed 108 tests in one case and 110 in the other.

   They were invisible for the same reason `tokens.total` was: every fixture
   feeding them used records that were interchangeable. A cap applied to
   uniform records keeps N of them whatever the policy, so no assertion built on
   such a fixture can tell newest-first from oldest-first. The values here are
   deliberately staggered and individually identifiable, which is the only shape
   that can distinguish an eviction policy from its opposite.

   THE OPERATOR CONSEQUENCE, which is why these two and not the other caps:

     recently-resolved is a strip saying "this cleared while you were away". Held
     oldest-first, it names things that cleared days ago while what just cleared
     is invisible — a plausible, well-formed, reassuring answer that is wrong.

     attention records carry acknowledgements. Evicting the newest first means
     agents an operator just silenced start asking again, while stale records
     from last week hold their place. */

const T0 = Date.parse("2026-08-02T12:00:00.000Z");
const MINUTE = 60_000;
/* Resolutions are staggered by 30 SECONDS, not minutes. The first draft used
   minutes, so twenty items spanned twenty minutes and the fifteen-minute
   retention TTL dropped the oldest before the cap ever bit — two mechanisms
   overlapping, which made the cap untestable and let "the cap stops biting"
   survive. Inside the TTL, the cap is the only thing deciding. */
const RESOLVED_STEP = 30_000;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/* ---------------------------------------------------------------- attention */

/** Writes `count` acknowledgements, each a minute apart and individually
    identifiable, then reloads — which is where retention and the cap apply. */
async function attentionAfterReload(count: number): Promise<readonly { surfaceId: string }[]> {
  const root = mkdtempSync(join(tmpdir(), "anthill-eviction-"));
  roots.push(root);
  const path = join(root, "attention-state.json");
  const records = Array.from({ length: count }, (_, index) => ({
    surfaceId: `SURF-${String(index).padStart(4, "0")}`,
    action: "acknowledge",
    // Staggered: index 0 is the OLDEST, index count-1 the NEWEST.
    updatedAt: new Date(T0 - (count - index) * MINUTE).toISOString(),
    throughAt: new Date(T0 - (count - index) * MINUTE).toISOString(),
    notificationId: `n-${index}`,
  }));
  writeFileSync(path, JSON.stringify(records), "utf8");
  const store = await JsonAttentionStore.open(path, () => T0);
  return store.list();
}

describe("attention records: the cap keeps the most recent acknowledgements", () => {
  test("under the cap every record survives, so the cap is what does the work below", async () => {
    // The control. Without it, "the newest survived" would also hold on a store
    // that dropped everything except the newest regardless of any cap.
    const kept = await attentionAfterReload(10);

    expect(kept).toHaveLength(10);
  });

  test("over the cap the NEWEST are kept and the oldest are dropped", async () => {
    /* THE PROPERTY. Reversing the sort in retainAttentionRecords passed 108
       tests across cmux, notifications, attention-signal, attention-silence,
       snooze-bounds, policy-verifiability and operator-endpoints, because every
       one of their fixtures used records that were interchangeable.

       Identifiable ids are what makes the answer checkable: the highest-numbered
       surfaces are the most recent, so they are the ones that must remain. */
    const overCap = 520;
    const kept = await attentionAfterReload(overCap);
    const surfaces = kept.map(({ surfaceId }) => surfaceId);

    expect(kept.length).toBeLessThan(overCap);
    // The newest record is present and the oldest is gone.
    expect(surfaces).toContain(`SURF-${String(overCap - 1).padStart(4, "0")}`);
    expect(surfaces).not.toContain("SURF-0000");
    /* And it is the newest CONTIGUOUS block, not an arbitrary subset that
       happens to include the last one. */
    const indices = surfaces.map((id) => Number(id.replace("SURF-", "")));
    expect(Math.min(...indices)).toBe(overCap - kept.length);
    expect(Math.max(...indices)).toBe(overCap - 1);
  });
});

/* -------------------------------------------------------- recently resolved */

function issue(id: string, resolvedAtMs: number): OperatorIssue {
  return {
    id,
    kind: "system",
    severity: "warning",
    title: `Issue ${id}`,
    summary: "Something needed attention.",
    affectedAgentIds: [],
    lifecycle: {
      state: "resolved",
      openedAt: new Date(T0 - 24 * 60 * MINUTE).toISOString(),
      resolvedAt: new Date(resolvedAtMs).toISOString(),
    },
  } as OperatorIssue;
}

describe("recently resolved: the strip shows what cleared MOST recently", () => {
  test("under the cap every resolution is announced", () => {
    // The control, for the same reason as above.
    const resolved = Array.from({ length: 5 }, (_, index) => issue(`i${index}`, T0 - (5 - index) * RESOLVED_STEP));
    const { recentlyResolved } = lifecycleIssues([], { recentlyResolved: resolved }, new Date(T0));

    expect(recentlyResolved).toHaveLength(5);
  });

  test("over the cap the newest resolutions are announced, not the oldest", () => {
    /* THE PROPERTY, and the one that costs an operator something. Reversing this
       sort passed 110 tests, because every fixture feeding it carried resolutions
       that were interchangeable.

       Staggered by thirty seconds and individually numbered: `i19` cleared most
       recently, `i0` cleared longest ago. A strip built oldest-first is a strip
       telling a returning operator about last week while hiding this morning. */
    const total = 20;
    const resolved = Array.from({ length: total }, (_, index) => issue(`i${index}`, T0 - (total - index) * RESOLVED_STEP));
    const { recentlyResolved } = lifecycleIssues([], { recentlyResolved: resolved }, new Date(T0));
    const ids = recentlyResolved.map(({ id }) => id);

    expect(ids.length).toBeLessThan(total);
    expect(ids).toContain(`i${total - 1}`);
    expect(ids).not.toContain("i0");
    // The newest contiguous block, in newest-first order.
    const indices = ids.map((id) => Number(id.replace("i", "")));
    expect(Math.max(...indices)).toBe(total - 1);
    expect(Math.min(...indices)).toBe(total - indices.length);
    expect([...indices]).toEqual([...indices].sort((left, right) => right - left));
  });

  test("the order is newest-first, so the strip reads as an operator would expect", () => {
    /* Separate from survival: a build could keep the right twelve and present
       them oldest-first, which reads as "the oldest news is the headline". */
    const resolved = Array.from({ length: 4 }, (_, index) => issue(`i${index}`, T0 - (4 - index) * RESOLVED_STEP));
    const { recentlyResolved } = lifecycleIssues([], { recentlyResolved: resolved }, new Date(T0));

    expect(recentlyResolved.map(({ id }) => id)).toEqual(["i3", "i2", "i1", "i0"]);
  });
});
