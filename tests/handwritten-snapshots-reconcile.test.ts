import { describe, expect, test } from "bun:test";
import { PROVIDERS } from "../src/shared/types";
import { buildSnapshot } from "../src/server/snapshot";
import type { ArchiveStore, CollectedAgent } from "../src/server/types";

/* The fourteen hand-written HubSnapshot fixtures, reconciled against the server
   that actually produces them.

   They are not a tidiness problem. reference-docs.test.ts:845 hand-built
   `healthy 4 / total 4`, asserted only the client's rendering, never drove the
   server, and stayed green through a change that altered the day-one screen.
   Each hand-written fixture is a chance to be green while the product is wrong,
   and there are fourteen of them: thirteen behind one shared helper in
   web-client.test.ts and one in clean-board.test.ts.

   WHY THIS RECONCILES RATHER THAN REPLACES. web-client.test.ts is 8,199 lines
   and its `snapshot()` helper is deliberately minimal — dozens of tests spread
   `...overrides` onto it, and swapping the body for buildSnapshot output would
   change what every one of them renders. That is a real refactor with a real
   chance of quietly changing what those tests assert, which is the exact
   failure being guarded against. So this file pins the DIVERGENCE instead: the
   fixture shape is compared to the server's, the gap is enumerated, and the gap
   is asserted not to grow.

   WHERE A HAND-WRITTEN FIXTURE CANNOT BE REPLACED, AND WHY IT MATTERS. The
   client harness needs a snapshot at a specific rendered state — a particular
   token total, a particular findings list — and buildSnapshot only reaches those
   states through a collector-shaped input the client tests do not have. That is
   a seam: there is no exported way to say "give me the snapshot for THIS board".
   Every hand-written fixture in this repo marks that seam, and the omissions
   below are what the seam costs. */

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
const NOW = new Date("2026-08-02T12:00:00.000Z");

const collected = (overrides: Partial<CollectedAgent> = {}): CollectedAgent => ({
  id: "codex:a1",
  provider: "codex",
  sourceSessionId: "a1",
  displayName: "Ridge worker",
  cwd: "/tmp/project",
  status: "running",
  statusReason: "Fixture activity is recent.",
  updatedAt: NOW.toISOString(),
  tokens: { total: 40_000, provenance: "observed", contextWindow: 1_000_000 },
  artifacts: [],
  gates: [],
  processAlive: true,
  ...overrides,
} as CollectedAgent);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const server = (agents: readonly CollectedAgent[] = [collected()]): any =>
  buildSnapshot({ agents, surfaces: [], archiveStore, now: NOW });

/* The totals key set the web-client helper declares, copied from
   tests/web-client.test.ts:52. Duplicated deliberately: importing it would
   couple two test files, and the point is to notice when they drift apart. */
const WEB_CLIENT_TOTALS_KEYS = [
  "live", "tracked", "attention", "working", "idle", "history", "sourceHealth",
  /* Added rather than excused. The lifecycle census and the retained count are
     what the tabs, the vitals line and the Unverified group read, so a client
     fixture without them would render the very surfaces this contract exists
     for against fields that are not there. */
  "byLifecycle", "retained",
] as const;

/* What that fixture omits today. Enumerated so the omission is a decision on
   the record rather than an accident, and so ADDING a field to the server
   fails here until somebody decides whether the client tests need it. */
const KNOWN_OMISSIONS = [
  "cursorModelHealth", "ended", "needsYou", "systemFindings",
  "tokenEligible", "tokenMedian", "tokenReporting", "tokens",
] as const;

describe("hand-written snapshots describe a fleet the server can actually produce", () => {
  test("the fixture invents no field the server does not emit", () => {
    /* The cheap half, and it holds. A fixture carrying a key the server never
       sends would let a client test render against a field that does not exist
       in production — green forever, and wrong from the first request. */
    const serverKeys = Object.keys(server().totals);

    for (const key of WEB_CLIENT_TOTALS_KEYS) {
      expect(serverKeys, `web-client fixture declares totals.${key}, which the server never emits`)
        .toContain(key);
    }
  });

  test("what the fixture omits is exactly the known list, and no more", () => {
    /* THE GUARD WITH TEETH. Eight of the server's fifteen totals fields are
       absent from the fixture, including `needsYou` — which drives the board's
       primary surface. Every client test built on that helper renders a totals
       object missing more than half of what the server sends.

       Enumerating them makes the gap visible and, more usefully, makes it
       FROZEN: add a sixteenth field to the server and this fails until someone
       decides whether the client tests need it. That decision is the thing that
       did not happen for the eight below. */
    const serverKeys = Object.keys(server().totals);
    const omitted = serverKeys.filter((key) => !WEB_CLIENT_TOTALS_KEYS.includes(key as never)).sort();

    expect(omitted).toEqual([...KNOWN_OMISSIONS]);
  });

  test.failing("the fixture's source count matches the number of collectors the fleet has", () => {
    /* THE LIVE DIVERGENCE, and the same shape as reference-docs.test.ts:845.

       The web-client helper declares `sourceHealth: { healthy: 2, total: 2 }`.
       The server emits `total: PROVIDERS.length` — the fleet has that many collectors and that
       count is structural, not a measurement. So every client test using this
       helper renders "2/2 sources healthy" for a board that reports 4/4, and a
       change to how source health is displayed can pass here while altering
       what an operator sees.

       Marked failing because fixing it means editing web-client.test.ts, which
       another lane owns and which is 8,199 lines. It reports "marked as failing
       but it passed" the moment the fixture is corrected. */
    const fixtureSourceTotal = 2;

    expect(fixtureSourceTotal).toBe(server().totals.sourceHealth.total);
  });

  test("the server's collector count is structural, so the fixture cannot be right by luck", () => {
    /* Pins the number the fixture should carry, across fleet shapes. If this
       ever varies, the failing test above is asking the wrong question and the
       fixture's 2 might be legitimate for some fleet. It does not vary. */
    const counts = [
      server([]).totals.sourceHealth.total,
      server([collected()]).totals.sourceHealth.total,
      server([collected(), collected({ id: "cursor:b", provider: "cursor", sourceSessionId: "b" })]).totals.sourceHealth.total,
    ];

    expect(new Set(counts).size).toBe(1);
    expect(counts[0]).toBe(PROVIDERS.length);
  });

  test("a fixture omitting needsYou cannot exercise the surface the board opens on", () => {
    /* Why the omission list is not cosmetic, stated against the one field that
       costs the most. The board opens on "Needs you"; totals.needsYou is what
       fills it. A fixture without the key renders that surface from undefined,
       so a client test can assert the surface looks right while the number the
       server sends has never reached it. */
    const withAttention = server([collected({
      status: "attention",
      attentionSignal: { kind: "question-pending", detail: "Waiting on a human." },
    } as Partial<CollectedAgent>)]);

    expect(Object.keys(withAttention.totals)).toContain("needsYou");
    expect(withAttention.totals.needsYou).toBe(1);
    expect(server().totals.needsYou).toBe(0);
    // And it is absent from the fixture, which is the whole point.
    expect(WEB_CLIENT_TOTALS_KEYS).not.toContain("needsYou");
  });
});
