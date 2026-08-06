/**
 * "Readings degraded" has to say WHAT is wrong.
 *
 * Measured on the live board 2026-08-06: a degraded Cursor collector produced
 * three layers of category and zero layers of fact.
 *
 *   chip                     "Readings degraded" + "evidence needs tidying"
 *   issue title              "Cursor collection is degraded"
 *   issue summary            "1 collection problem makes Cursor session data
 *                             potentially incomplete."
 *   issue technicalDetails   ["cursor GUI conversations: unable to open
 *                             database file"]        <- the only line with a fact
 *
 * The detail rendered in the drawer only, three clicks from the chip that was
 * complaining. Emilio: it "doesnt actually say whats wrong or fix it. it just
 * says Whoops basically."
 *
 * These tests pin the field, NOT today's wording — the collectors are being
 * taught to phrase these as whole sentences, and that must flow through without
 * touching the client.
 *
 * Hermetic — safe for `bun run test:ci`. Behaviour comes through the client's own
 * harness (the tests/clean-board.test.ts pattern); source-shaped claims read the
 * file.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const appjs = readFileSync(join(import.meta.dir, "../src/web/app.js"), "utf8");

interface Harness {
  notificationFeed: (snap: unknown, queue?: unknown[], now?: number, deps?: unknown) => Array<{
    kind: string; evidence: string; impact: string; route: { kind: string; id: string };
  }>;
  summaryWidgetData: (id: string, snap: unknown, conn?: string) => {
    value: string; sublabel: string; severityDetail: string;
  };
  issueImpactLine: (issue: unknown, snap: unknown) => string;
}
let H: Harness;

beforeAll(async () => {
  // @ts-expect-error The dependency-free browser client has no declaration file.
  await import("../src/web/app.js");
  H = (globalThis as unknown as { TheAntHill: Harness }).TheAntHill;
});

const NOW = Date.parse("2026-08-06T13:00:00.000Z");

/* Emilio's board, reproduced: cursor degraded, its fault on the issue,
   controlHealth.errors empty — the shape that rendered nothing useful. */
const boardWithDegradedCursor = (technicalDetails: string[] | null) => ({
  generatedAt: "2026-08-06T12:59:00.000Z",
  totals: {
    working: 3,
    sourceHealth: {
      healthy: 4, degraded: 1, absent: 0, total: 5,
      byProvider: {
        omp: { healthy: true }, codex: { healthy: true }, claude: { healthy: true },
        cursor: { healthy: false, lastHealthyAt: "2026-08-06T09:14:00.000Z" },
        factory: { healthy: true },
      },
    },
  },
  controlHealth: { cmuxReachable: true, lastCheckedAt: "2026-08-06T12:59:00.000Z", errors: [], staleSources: [] },
  issues: [{
    id: "system:cursor-collector", kind: "system", severity: "warning",
    title: "Cursor collection is degraded",
    summary: "1 collection problem makes Cursor session data potentially incomplete.",
    affectedAgentIds: ["claude:a1"],
    technicalDetails,
    openedAt: "2026-08-06T09:14:00.000Z",
  }],
  programs: [{
    id: "p1", name: "the-ant-hill",
    agents: [{ id: "claude:a1", programId: "p1", displayName: "A", lifecycle: "waiting", provider: "claude" }],
  }],
});

/* The app's OWN resolvers, not the module defaults: issueImpactLine is what
   app.js injects, so the impact sentence asserted here is the one that reaches
   the screen rather than a stand-in the browser never uses. */
const dataflowItem = (snap: unknown) =>
  H.notificationFeed(snap, [], NOW, { impactFor: H.issueImpactLine, programNameFor: () => "" })
    .find((i) => i.kind === "dataflow");

describe("a degraded source ships the fault, not the category", () => {
  test("evidence is the collector's own sentence, never the summary", () => {
    const item = dataflowItem(boardWithDegradedCursor(["cursor GUI conversations: unable to open database file"]));
    expect(item).toBeDefined();
    expect(item?.evidence).toBe("cursor GUI conversations: unable to open database file");
    /* The three categories must NOT be what the operator reads as evidence. */
    expect(item?.evidence).not.toContain("collection is degraded");
    expect(item?.evidence).not.toContain("potentially incomplete");
  });

  test("the fault is paired with what it costs, so the raw string never stands alone", () => {
    /* "unable to open database file" is a sqlite string, not an explanation.
       §4.2 gives the item an impact for exactly this reason. */
    const item = dataflowItem(boardWithDegradedCursor(["cursor GUI conversations: unable to open database file"]));
    expect(item?.impact.length).toBeGreaterThan(10);
    expect(item?.impact).not.toBe(item?.evidence);
  });

  test("several faults all reach the surface — a count already failed to say which", () => {
    const item = dataflowItem(boardWithDegradedCursor([
      "cursor GUI conversations: unable to open database file",
      "cursor CLI sessions: schema 12 is not supported",
    ]));
    expect(item?.evidence).toContain("unable to open database file");
    expect(item?.evidence).toContain("schema 12 is not supported");
  });

  test("a source that ships no detail still says something", () => {
    /* A category is a poor evidence line; an empty one is worse. */
    const item = dataflowItem(boardWithDegradedCursor(null));
    expect(item?.evidence).toBe("1 collection problem makes Cursor session data potentially incomplete.");
  });

  test("the item is pinned to the FIELD, so a reworded collector flows through untouched", () => {
    const reworded = "cursor GUI conversations: database permissions deny read access; "
      + "Cursor GUI sessions could not be enumerated for this scan.";
    const item = dataflowItem(boardWithDegradedCursor([reworded]));
    expect(item?.evidence).toBe(reworded);
  });
});

describe("a source fault is not demoted by the sessions it lost", () => {
  /* Measured on a board with a genuinely broken Cursor collector: the issue named
     91 affected sessions, every one absent from the snapshot BECAUSE the
     collector that would have enumerated them had failed. liveAffected was 0, so
     §4.3's stale-without-current-impact row demoted the one item explaining the
     gap — demoted by the gap. The operator got "Readings degraded" and an empty
     panel. This is the circle, pinned. */

  const boardWhoseSessionsAllVanished = () => {
    const snap = boardWithDegradedCursor(["cursor GUI conversations: unable to open database file"]);
    // The collector failed, so none of the sessions it names are in the snapshot.
    snap.issues[0].affectedAgentIds = ["cursor:gone-1", "cursor:gone-2", "cursor:gone-3"];
    return snap;
  };

  test("it stays on the live surface when every session it names is missing", () => {
    const item = dataflowItem(boardWhoseSessionsAllVanished());
    expect(item).toBeDefined();
    expect(item?.route.id).toBe("system:cursor-collector");
  });

  test("an AGENT finding whose agents are all gone is still demoted", () => {
    /* The rule still does its job — this exemption is scoped to `system`, whose
       subject is the source rather than any session. Widening it would put
       genuinely stale findings back on the surface. */
    const snap = boardWithDegradedCursor(["x"]);
    snap.issues = [{
      id: "agent:claude:gone", kind: "agent", severity: "warning",
      title: "gone needs review", summary: "was reviewing",
      affectedAgentIds: ["claude:not-in-snapshot"], technicalDetails: null,
      openedAt: "2026-08-06T09:14:00.000Z",
    }];
    expect(dataflowItem(snap)).toBeUndefined();
  });

  test("a recovered source drops out on its own, without this exemption holding it open", () => {
    /* The clearance path is the check above it: no issue in issuesOf, no item.
       The exemption only decides that a PRESENT source fault is not stale. */
    const snap = boardWithDegradedCursor(["x"]);
    snap.issues = [];
    expect(dataflowItem(snap)).toBeUndefined();
  });
});

describe("the chip names the source and says where the sentence is", () => {
  test("it names WHICH source, not how many", () => {
    const data = H.summaryWidgetData("health", boardWithDegradedCursor(["x"]), "live");
    expect(data.value).toBe("Readings degraded");
    expect(data.sublabel).toContain("Cursor");
    /* The old line was "1 degraded source · 0 stale · 0 errors" — three counts
       and no cause. A count answers "how many"; the operator asks "which one". */
    expect(data.sublabel).not.toMatch(/^\d+ degraded source/);
  });

  test("it points at the surface that holds the fault, without linking", () => {
    /* THE HEADER NEVER LINKS. It may say where to look; it may not route. */
    const data = H.summaryWidgetData("health", boardWithDegradedCursor(["x"]), "live");
    expect(data.sublabel).toContain("Notifications");
    const rail = appjs.slice(appjs.indexOf("function renderSummaryWidget("));
    expect(rail.slice(0, rail.indexOf("\n}\n"))).not.toContain("selectEntity(");
  });

  test("the generic severity blurb no longer suppresses the specific sentence", () => {
    /* The bug: problemText was blanked whenever ANY severityDetail existed, so
       the specific line lost to the generic one on every degraded board. */
    expect(appjs).not.toContain("(data.severityDetail ? \"\" : data.sublabel)");
    /* …and the fix is scoped rather than a blanket flip. Advisory is the only
       severity whose detail is a constant; blocking and stale derive theirs from
       the fault ("cmux unreachable — Focus and Send cannot route") and still win
       over their sublabel. Flipping all three would have replaced a specific
       sentence with a different specific sentence for no reason. */
    expect(appjs).toContain('const genericSeverity = data.severityKey === "advisory";');
    expect(appjs).toMatch(/genericSeverity\s*\n?\s*\?\s*\(data\.sublabel \|\| data\.severityDetail\)\s*\n?\s*:\s*\(data\.severityDetail \|\| data\.sublabel\)/);
  });
});

describe("the fault reaches the SCREEN, not only the accessible name", () => {
  /* A dataflow item is severity warning, so it lands in Watching and renders as
     a quiet row — and quiet rows put evidence in the aria-label only. Fixing the
     model alone would have left the fault invisible to a sighted operator, which
     is the half Emilio was actually looking at. */

  const quietRow = appjs.slice(
    appjs.indexOf("function notifyQuietRow(item)"),
    appjs.indexOf("function renderNotificationCenter"),
  );

  test("a quiet row renders its evidence when it adds something", () => {
    expect(quietRow).toContain("notify-quiet-fault");
    expect(quietRow).toMatch(/showsFault \? el\("span", \{ class: "notify-quiet-fault" \}/);
  });

  test("and stays silent when evidence merely restates the impact", () => {
    /* Every handoff row derives both from one signal; a second line there would
       be the row repeating itself. Compared on content, not on kind. */
    expect(quietRow).toMatch(/item\.evidence\.trim\(\) !== item\.impact\.trim\(\)/);
  });

  test("the extra line is phrasing content, because it lives inside a <button>", () => {
    /* A <p> inside a button is not valid content, which is why the blocking row's
       .notify-peek could not simply be reused here. */
    expect(quietRow).not.toMatch(/el\("p", \{ class: "notify-quiet-fault"/);
  });
});
