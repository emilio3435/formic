import { describe, expect, test } from "bun:test";
import { ARCHIVE_RETENTION_MS, JsonArchiveStore, type ArchiveFileOperations } from "../src/server/archive";
import { ATTENTION_RETENTION_MS, MemoryAttentionStore, parseCmuxNotifications } from "../src/server/cmux";
import type { CollectedAgent } from "../src/server/types";

/* A class of defect this suite could not previously catch: a missing INPUT.

   Every test here until now asserted on outputs — the number rendered, the
   refusal returned, the record written. That machinery is blind to a figure
   that is never checkable at all, because there is no wrong output to catch.
   The system publishes a policy, behaves in some way, and nothing anywhere
   records the observation you would need to tell whether the policy was
   honoured. A number nobody can ever check is worse than a wrong one: a wrong
   number can be found.

   THE GENERAL PROPERTY, written once rather than once per policy:

     A figure the product publishes as a policy must be measured from a
     timestamp the system records for the event that policy names.

   Two ways to break it, and archive retention broke both:

     UNRECORDED — the event left no trace, so delivered behaviour could not be
     measured even after the fact. 545 archive records carried no archiving
     timestamp; `archivedAt` was not in the union of keys across any of them.

     WRONG CLOCK — the window was measured from `agent.updatedAt`, the agent's
     last activity, so the 30 days ran from when the agent last spoke rather
     than from when it was archived.

   The second was the consequence of the first — with no archiving timestamp to
   read, the nearest timestamp on the record was used — and the first is what
   made the second invisible. Nobody can audit a window whose starting point was
   never written down.

   The measured cost: an agent last active 29 days ago and archived today was
   gone within one day. Published retention 30 days, delivered retention 1.

   Both are now closed: `archivedAt` is persisted and `isFresh` measures from
   it. These tests were written against the broken behaviour and marked failing;
   the fix landed mid-run and they were flipped. They are the guard now.

   THE RESIDUAL, which no fix can reach: records archived before the fix have no
   archiving moment and never will. `isFresh` falls back to `updatedAt` for
   them, which is the right call and is pinned below, but their delivered
   retention stays unmeasurable permanently. An unrecorded input is unauditable
   forever, not just until someone gets round to it. */

const DAY_MS = 24 * 60 * 60 * 1_000;
const T0 = Date.parse("2026-08-02T12:00:00.000Z");

/** An in-memory archive file, so retention is exercised through the real store
    rather than a stand-in. The store filters on load, so a reopen at a later
    clock is what applies the policy. */
function archiveFile(): ArchiveFileOperations & { contents: () => string } {
  let stored = "[]";
  return {
    readText: async () => stored,
    makeDirectory: async () => {},
    writeText: async (_path: string, contents: string) => { stored = contents; },
    rename: async () => {},
    contents: () => stored,
  };
}

/** An archive file that already holds records, for reading back what a previous
    version of the code wrote. */
function legacyFile(initial: string): ArchiveFileOperations & { contents: () => string } {
  const files = archiveFile();
  let stored = initial;
  return {
    ...files,
    readText: async () => stored,
    writeText: async (_path: string, contents: string) => { stored = contents; },
    contents: () => stored,
  };
}

function agentLastActive(daysAgo: number): CollectedAgent {
  return {
    id: "codex:alpha",
    provider: "codex",
    sourceSessionId: "alpha",
    displayName: "Alpha",
    status: "running",
    statusReason: "Fixture activity.",
    updatedAt: new Date(T0 - daysAgo * DAY_MS).toISOString(),
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
  } as CollectedAgent;
}

/** Archives one agent at T0, then reopens the store `daysLater` on. Returns
    whether the record survived, and the bytes that were persisted. */
async function archiveThenReopen(
  agent: CollectedAgent,
  daysLater: number,
): Promise<{ survived: boolean; persisted: string }> {
  const files = archiveFile();
  const writing = await JsonArchiveStore.open("/archive.json", files, () => T0);
  await writing.archive(agent.id, agent);
  const persisted = files.contents();
  const reopened = await JsonArchiveStore.open("/archive.json", files, () => T0 + daysLater * DAY_MS);
  return { survived: reopened.has(agent.id), persisted };
}

describe("archive retention: a policy published in days, measured from the wrong event", () => {
  test("an agent archived today is kept the published window, whatever its last activity", async () => {
    /* THE DEFECT, as the guarantee it should be.

       Archiving is a deliberate operator action taken at a moment. The window
       the product publishes is a promise about that moment, so an agent
       archived today must still be there tomorrow — its last activity is a
       fact about the agent, not about the archive.

       Measured from `updatedAt`, an agent that went quiet 29 days ago and was
       archived today falls out of the archive one day later. Nothing warns
       anyone, and because no archiving timestamp is stored, nothing could. */
    const { survived } = await archiveThenReopen(agentLastActive(29), 2);

    expect(survived).toBe(true);
  });

  test("the record says when it was archived, so delivered retention can be measured", async () => {
    /* THE MISSING INPUT, stated directly.

       Even a correct implementation is only auditable if the archiving moment
       is written down. Without it there is no way to answer "was this record
       kept the 30 days we promised" for any record, ever — not by reading the
       file, not by replaying the logs.

       This is the assertion that makes the other one durable: a fix that
       measured retention from a value held only in memory would satisfy the
       behaviour above and still leave every historical record unverifiable. */
    const { persisted } = await archiveThenReopen(agentLastActive(1), 0);
    const [record] = JSON.parse(persisted) as Array<Record<string, unknown>>;

    expect(record).toBeDefined();
    expect(Object.keys(record)).toContain("archivedAt");
  });

  test("a recently active agent does survive, so the drop above is the clock and not the reopen", async () => {
    /* The control. Reopening a store is itself capable of losing records — a
       parse failure, a bad write, a filter that drops everything — and every
       one of those would make the failing test above pass for a reason that
       has nothing to do with retention. Holding the reopen constant and moving
       only the agent's last activity is what attributes it. */
    const { survived } = await archiveThenReopen(agentLastActive(0), 2);

    expect(survived).toBe(true);
  });

  test("retention does discard what is genuinely past the window", async () => {
    /* The other control, and the one that stops this file being read as
       "retention is broken, remove it". The mechanism works; it is pointed at
       the wrong event. An agent whose activity is past the published window is
       correctly dropped, and a fix must keep doing that. */
    const survivingJustInside = await archiveThenReopen(agentLastActive(0), 29);
    const droppedJustOutside = await archiveThenReopen(agentLastActive(0), 31);

    expect(survivingJustInside.survived).toBe(true);
    expect(droppedJustOutside.survived).toBe(false);
    expect(ARCHIVE_RETENTION_MS).toBe(30 * DAY_MS);
  });

  test("both failure modes are closed together, which is why both tests exist", async () => {
    /* Was the control pinning today's broken state: no archiving timestamp AND
       a window measured from the agent's activity. It went red when both were
       fixed, which is what it was for.

       They remain independent. Recording the timestamp while still measuring
       from `updatedAt` would leave the window wrong but auditable; measuring
       from a correct in-memory moment while persisting nothing would leave the
       window right but permanently unverifiable. This pins that neither half
       regressed without the other noticing. */
    const { persisted, survived } = await archiveThenReopen(agentLastActive(29), 2);
    const [record] = JSON.parse(persisted) as Array<Record<string, unknown>>;

    expect(Object.keys(record)).toContain("archivedAt");
    expect(survived).toBe(true);
  });

  test("the archiving timestamp is set once, not restamped on a later rewrite", async () => {
    /* The failure a naive fix introduces, and it is silent in both directions:
       re-stamping archivedAt on each pass restarts the clock so nothing ever
       expires, and — because sameAgent compares whole records — rewrites the
       file on every single commit.

       This has to re-archive the SAME store at a LATER clock. An earlier
       version of this test opened two fresh stores at a fixed T0, so both
       stamps matched no matter what the code did; the restamping mutation
       survived it, which is how I found out. */
    const files = archiveFile();
    let nowMs = T0;
    const store = await JsonArchiveStore.open("/archive.json", files, () => nowMs);
    const agent = agentLastActive(1);

    await store.archive(agent.id, agent);
    const [first] = JSON.parse(files.contents()) as Array<Record<string, unknown>>;

    nowMs = T0 + 5 * DAY_MS;
    await store.record([{ ...agent, updatedAt: new Date(nowMs).toISOString() }]);
    const [second] = JSON.parse(files.contents()) as Array<Record<string, unknown>>;

    expect(first!.archivedAt).toBeDefined();
    // Custody began once. Touching the record again does not renew it.
    expect(second!.archivedAt).toBe(first!.archivedAt as string);
  });

  test("records archived before the fix fall back to activity, and stay unmeasurable", async () => {
    /* The residual, pinned so it is a known limit rather than a surprise.

       545 records predate the fix and carry no archiving moment. It cannot be
       reconstructed — nothing ever wrote it down — so isFresh falls back to
       updatedAt for them. That is the right call: treating them as archived at
       load time would make every legacy record immortal for another 30 days on
       every restart, which is the opposite unverifiable claim.

       What it means is that for those records delivered retention still cannot
       be measured, and never can be. This test exists so the limit lives in the
       suite rather than only in a commit message. */
    const legacy = JSON.stringify([{ ...agentLastActive(29), archiveKind: "operator" }]);
    const [legacyRecord] = JSON.parse(legacy) as Array<Record<string, unknown>>;

    const atLoad = await JsonArchiveStore.open("/archive.json", archiveFile(), () => T0);
    const stillThere = await JsonArchiveStore.open("/archive.json", legacyFile(legacy), () => T0);
    const goneTwoDaysOn = await JsonArchiveStore.open("/archive.json", legacyFile(legacy), () => T0 + 2 * DAY_MS);

    expect(legacyRecord!.archivedAt).toBeUndefined();
    expect(atLoad.has("codex:alpha")).toBe(false);
    // The old clock, still running: alive at 29 days of activity, gone at 31.
    expect(stillThere.has("codex:alpha")).toBe(true);
    expect(goneTwoDaysOn.has("codex:alpha")).toBe(false);
  });
});

describe("the policies that do record the event they name", () => {
  test("attention retention is measured from the record's own timestamp, not the agent's", () => {
    /* The comparator that proves the property is satisfiable in this codebase
       rather than an unreasonable standard.

       An attention record carries `updatedAt` describing ITSELF — when the
       acknowledgement or snooze was written — so the seven days runs from the
       act the policy names. The notification it refers to can be arbitrarily
       old without shortening the window, which is exactly what the archive
       gets wrong. */
    const oldNotification = parseCmuxNotifications(JSON.stringify([{
      id: "n1",
      surface_id: "SURF-A",
      workspace_id: "W",
      // The event the record is about happened long before the record.
      created_at: new Date(T0 - 300 * DAY_MS).toISOString(),
      title: "Agent needs you",
    }]));

    const other = parseCmuxNotifications(JSON.stringify([{
      id: "n2",
      surface_id: "SURF-B",
      workspace_id: "W",
      created_at: new Date(T0).toISOString(),
      title: "Another agent needs you",
    }]));

    let nowMs = T0;
    const store = new MemoryAttentionStore(() => nowMs);
    store.observe([...oldNotification, ...other]);

    return store.apply("SURF-A", "acknowledge").then(async (record) => {
      // The record dates itself to the act, not to what the act was about.
      expect(Date.parse(record.updatedAt)).toBe(T0);
      expect(store.filter(oldNotification)).toHaveLength(0);

      /* Six days on, still inside its own window. Retention is applied by
         commit(), so a later write is what exercises the pruning — an earlier
         version asserted against a FRESH store that had never acknowledged
         anything, which returns the notification whatever retention does and
         so asserted nothing at all. */
      nowMs = T0 + 6 * DAY_MS;
      await store.apply("SURF-B", "acknowledge");
      expect(store.get("SURF-A")).toBeDefined();
      expect(store.filter(oldNotification)).toHaveLength(0);

      /* Eight days on, past its own window: pruned, and the notification comes
         back. Measured from the acknowledgement at T0 — measured instead from a
         notification created 300 days earlier, the record would have been
         outside its window before it was ever written. */
      nowMs = T0 + 8 * DAY_MS;
      await store.apply("SURF-B", "acknowledge");
      expect(store.get("SURF-A")).toBeUndefined();
      expect(store.filter(oldNotification)).toHaveLength(1);
      expect(ATTENTION_RETENTION_MS).toBe(7 * DAY_MS);
    });
  });
});

/* Surveyed by reading rather than pinned by test, and recorded here so the
   distinction is explicit:

     action log        7d   measured from `action.at`                  (app.ts:212)
     triage            7d   measured from `completedAt ?? createdAt`   (triage.ts:368)
     recently-resolved 15m  measured from `resolvedAt`                 (snapshot-issues.ts:169)
     identity binding  7d   measured from `confirmedAt`                (identity-bindings.ts:94)

   Each reads a timestamp its own record carries about the event the policy
   names, so each satisfies the property above. They are not asserted here
   because reaching their stores costs more setup than the confirmation is
   worth while one policy is outright broken — but they are the reason this is
   filed as a single defect rather than a systemic one. */

