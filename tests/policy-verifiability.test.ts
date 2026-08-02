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

   Two ways to break it, and archive retention breaks both:

     UNRECORDED — the event leaves no trace, so delivered behaviour cannot be
     measured even after the fact. 545 archive records carry no archiving
     timestamp; `archivedAt` is not in the union of keys across any of them.

     WRONG CLOCK — the window is measured from a different event, so delivered
     behaviour silently differs from published behaviour. Archive retention is
     measured from `agent.updatedAt`, the agent's last activity, so the 30 days
     runs from when the agent last spoke rather than from when it was archived.

   The second is the consequence of the first: with no archiving timestamp
   available, the nearest timestamp on the record was used. And the first is
   what makes the second invisible — nobody can audit a window whose starting
   point was never written down.

   The measured cost: an agent last active 29 days ago and archived today is
   gone within one day. Published retention 30 days, delivered retention 1.

   The archive tests are marked failing. They run every commit and report
   "marked as failing but it passed" the moment an archiving timestamp is
   recorded and retention measures from it. */

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

    const store = new MemoryAttentionStore(() => T0);
    store.observe(oldNotification);

    return store.apply("SURF-A", "acknowledge").then((record) => {
      // The record dates itself to the act, not to what the act was about.
      expect(Date.parse(record.updatedAt)).toBe(T0);
      expect(Date.parse(record.updatedAt)).toBeGreaterThan(T0 - ATTENTION_RETENTION_MS);
      // And it survives its own retention window because of that.
      expect(new MemoryAttentionStore(() => T0 + 6 * DAY_MS).filter(oldNotification)).toHaveLength(1);
    });
  });

  test("a policy whose clock is the record's own act keeps its published window", () => {
    /* Stated as the general shape rather than as a fact about attention, so
       the next store added to this codebase has something to conform to.

       An acknowledgement written today is honoured for seven days from today.
       The same record measured from the notification's creation date would
       have expired 293 days before it was written — which is the archive's
       arithmetic, transplanted. */
    const writtenAt = T0;
    const eventItRefersTo = T0 - 300 * DAY_MS;

    expect(writtenAt + ATTENTION_RETENTION_MS).toBeGreaterThan(T0);
    expect(eventItRefersTo + ATTENTION_RETENTION_MS).toBeLessThan(T0);
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

