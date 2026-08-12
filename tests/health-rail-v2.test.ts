import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  burnSnapFixture, fakeStorage, findChip, findClass, fireClick, mixSnapFixture, readingCell,
  readingTuples, repoSnapFixture, setupRailDom, snapWithHeartbeat, snapWithoutRepo, textOf,
  twoRepoSnapFixture, v4Envelope,
} from "./helpers/fake-dom";

/* Calm fleet with sentinel burn numbers, so a constant-copy compact face can
   never pass the parity oracle: 1234 tok/min and $4.12 exist only here. */
function calmSnapFixture(burnOver: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    controlHealth: { cmuxReachable: true, lastCheckedAt: new Date().toISOString(), errors: [], staleSources: [] },
    totals: { live: 3, attention: 0, tracked: 3, working: 3 },
    programs: [{ id: "p1", name: "Home", agents: [] }],
    pulse: {
      activity: { buckets: [{ activeSessions: 2 }, { activeSessions: 3 }] },
      burn: { tokensPerMin: 1234, costLastHourUsd: 4.12, ...burnOver },
      momentum: {},
    },
  };
}

/* One place for the storage swap every disclosure test needs. */
async function withHeaderHarness(
  fn: (ctx: { doc: any; M: any; storage: ReturnType<typeof fakeStorage> }) => void | Promise<void>,
  initial: Record<string, string> = {},
) {
  const G = globalThis as unknown as Record<string, any>;
  const realLS = G.localStorage;
  const storage = fakeStorage(initial);
  G.localStorage = storage;
  try {
    const { doc, M } = await setupRailDom();
    M.state.fetchFailed = false;
    await fn({ doc, M, storage });
    M.state.headerCollapsed = false;
    M.state.widgetCustomizerOpen = false;
    M.state.tldrView = "ALL";
    M.state.facetProgram = "";
    M.state.paintSig.widgets = "";
  } finally {
    if (realLS === undefined) delete G.localStorage; else G.localStorage = realLS;
  }
}

describe("parseHeartbeatStructured v4", () => {
  test("v4 exposes fleet; v3 parses with empty fleet (graceful degrade)", async () => {
    // @ts-expect-error browser client has no declaration
    await import("../src/web/app.js");
    const M = (globalThis as any).TheAntHill;
    const v4 = M.parseHeartbeatStructured('[TL;DR 17:33] {"v":4,"fleet":"Eight agents live. *the-mountain-main* !needs you!.","repos":[{"repo":"the-mountain-main","summary":"s","blocker":"question pending","signal":"needs-you"}]}');
    expect(v4.legacy).toBe(false);
    expect(v4.fleet).toContain("Eight agents live");
    const v3 = M.parseHeartbeatStructured('[TL;DR 12:34] {"v":3,"repos":[{"repo":"Home","summary":"s","blocker":"all-clear","signal":"working"}]}');
    expect(v3.fleet).toBe("");
    expect(v3.repos.length).toBe(1);
  });

  test("fleetFallbackLine is a priority brief (hottest first), not a joined inventory", async () => {
    // @ts-expect-error browser client has no declaration
    await import("../src/web/app.js");
    const M = (globalThis as any).TheAntHill;
    const snap = { totals: { live: 8, attention: 1 }, programs: [
      { name: "the-mountain-main", agents: [{ lifecycle: "working" }] },
      { name: "Home", agents: [{ lifecycle: "waiting" }] },
      { name: "cooper", agents: [{ lifecycle: "working" }] },
    ] };
    const line = M.fleetFallbackLine(snap, [
      { repo: "the-mountain-main", summary: "the-mountain-main: 2 live=1w+1i · fix rail · waiting", signal: "needs-you" },
      { repo: "Home", summary: "Home: 1 live=0w+1i · review PR", signal: "working" },
    ]);
    expect(line).toMatch(/Act on \*the-mountain-main\* first/);
    expect(line).toContain("fix rail");
    expect(line).toContain("Home can wait");
    expect(line).not.toContain(" ·  · ");
  });

  test("fleetFallbackLine falls back to calm counts when no repos", async () => {
    // @ts-expect-error browser client has no declaration
    await import("../src/web/app.js");
    const M = (globalThis as any).TheAntHill;
    const snap = { totals: { live: 8, attention: 1 }, programs: [
      { name: "the-mountain-main", agents: [{ lifecycle: "working" }] },
      { name: "Home", agents: [{ lifecycle: "waiting" }] },
      { name: "cooper", agents: [{ lifecycle: "working" }] },
    ] };
    const line = M.fleetFallbackLine(snap, []);
    expect(line).toContain("8 live");
    expect(line).toContain("3 repos");
    expect(line).toMatch(/All quiet/);
  });
});

describe("health rail v2 DOM contract", () => {
  test("index.html rail-inner is a static two-child shell; standalone heartbeat panel is gone", () => {
    const html = readFileSync("src/web/index.html", "utf8");
    expect(html).not.toContain('id="heartbeat-tldr"');
    const rail = html.slice(html.indexOf('id="health-rail"'), html.indexOf('id="widget-customizer"'));
    expect(rail.indexOf('class="health-tldr-lane"')).toBeGreaterThan(-1);
    expect(rail.indexOf('class="health-tldr-lane"')).toBeLessThan(rail.indexOf('class="readings-stack"'));
    expect(rail).toContain('id="cleanup-status"');
    expect(rail).toContain('id="readings-grid"');
  });

  test("renderHealthRail empties only #readings-grid — lane and live region survive the paint", async () => {
    const { doc, M } = await setupRailDom();
    doc.byId("cleanup-status").textContent = "sweep running";
    M.renderHealthRail();
    expect(doc.byId("cleanup-status").textContent).toBe("sweep running");
    expect(doc.byId("health-widgets").children.length).toBe(2);
  });

  test("ALL state renders fleet prose via mini-markup and a chip strip; no-envelope hides the lane", async () => {
    const { doc, M } = await setupRailDom();
    M.state.snap = snapWithHeartbeat('[TL;DR 17:33] {"v":4,"fleet":"*the-mountain-main* !needs you! on `main`.","repos":[{"repo":"the-mountain-main","summary":"s","blocker":"question pending","signal":"needs-you"}]}');
    M.renderHealthTldrLane();
    const lane = doc.byId("health-tldr-lane");
    expect(lane.attributes.hidden).toBeUndefined();
    expect(textOf(lane)).toContain("needs you");
    expect(textOf(lane)).toMatch(/\b1h\b/);
    expect(findClass(lane, "tldr-chip")).toBeTruthy();
    expect(findClass(lane, "tldr-story")).toBeFalsy();
    expect(textOf(lane)).not.toContain("Fleet story");
    M.state.snap = snapWithHeartbeat(null);
    M.renderHealthTldrLane();
    expect(doc.byId("health-tldr-lane").attributes.hidden).toBeDefined();
  });

  test("ALL with fleet renders flat prose + quiet proof status (no story chrome)", async () => {
    const { doc, M } = await setupRailDom();
    M.state.snap = snapWithHeartbeat('[TL;DR 17:33] {"v":4,"fleet":"*Operator input needed* — *cooper-scheduler* !Draft Sheet! and *Home* handoff.","repos":[{"repo":"cooper-scheduler","summary":"cooper-scheduler: cooper-scheduler has Draft Sheet waiting","blocker":"input requested","signal":"needs-you"},{"repo":"Home","summary":"Home: Home has an active handoff","blocker":"question pending","signal":"needs-you"}]}');
    M.renderHealthTldrLane();
    const lane = doc.byId("health-tldr-lane");
    expect(findClass(lane, "tldr-story")).toBeFalsy();
    expect(findClass(lane, "tldr-lane-prose")).toBeTruthy();
    expect(findClass(lane, "tldr-proof")).toBeTruthy();
    expect(textOf(lane)).toContain("cooper-scheduler");
    expect(textOf(lane)).toContain("Home");
    expect(textOf(lane)).not.toContain("Fleet story");
    expect(textOf(lane)).toMatch(/\binput\b/);
    expect(textOf(lane)).not.toMatch(/INPUT REQUESTED/i);
    expect(lane.classList.contains("is-needs-you")).toBe(true);
    // Bullet body strips restated repo subject
    expect(M.stripTldrRepoPrefix("Home: Home has an active handoff", "Home")).toBe("has an active handoff");
    expect(M.stripTldrRepoPrefix("cooper-scheduler: cooper-scheduler has Draft Sheet waiting", "cooper-scheduler")).toBe("has Draft Sheet waiting");
  });

  test("setTldrView syncs facetProgram so chevrons/chips filter the board", async () => {
    const { M } = await setupRailDom();
    M.state.snap = twoRepoSnapFixture();
    M.state.facetProgram = "";
    M.state.uiReady = false;
    M.renderHealthTldrLane();
    M.setTldrView("repoB");
    expect(M.state.tldrView).toBe("repoB");
    expect(M.state.facetProgram).toBe("p-b");
    M.setTldrView("ALL");
    expect(M.state.tldrView).toBe("ALL");
    expect(M.state.facetProgram).toBe("");
  });
});

describe("repo-specific view", () => {
  test("repo view renders prose + det pills and NEVER momentum/burn/context values in the lane", async () => {
    const { doc, M } = await setupRailDom();
    M.state.snap = repoSnapFixture();
    M.state.tldrView = "the-mountain-main";
    M.renderHealthTldrLane();
    const lane = doc.byId("health-tldr-lane");
    const text = textOf(lane);
    expect(text).toContain("main");
    expect(text).toContain("1 PR");
    expect(text).not.toMatch(/\/min/);
    expect(text).not.toMatch(/\bavg window\b/);
  });

  test("readings re-scope to the repo and Burn falls back honestly", async () => {
    const { doc, M } = await setupRailDom();
    M.state.snap = repoSnapFixture();
    M.state.tldrView = "the-mountain-main";
    M.renderHealthRail();
    const stack = findClass(doc.byId("health-widgets"), "readings-stack");
    expect(textOf(findClass(stack, "scope-pill"))).toBe("the-mountain-main");
    const burnCell = readingCell(stack, "Burn");
    expect(textOf(burnCell)).toContain("—");
    expect(textOf(burnCell)).toContain("fleet-wide only");
  });

  test("persisted view survives repaint; vanished repo falls back to ALL", async () => {
    const { doc, M } = await setupRailDom();
    M.state.snap = repoSnapFixture();
    M.state.tldrView = "the-mountain-main";
    M.renderHealthRail(); M.renderHealthRail();
    expect(M.state.tldrView).toBe("the-mountain-main");
    M.state.snap = snapWithoutRepo("the-mountain-main");
    M.renderHealthTldrLane();
    expect(M.state.tldrView).toBe("ALL");
  });
});

describe("pager + attention + staleness", () => {
  test("attention order puts needs-you first; chevron target from ALL is that repo", async () => {
    // @ts-expect-error browser client has no declaration
    await import("../src/web/app.js");
    const M = (globalThis as any).TheAntHill;
    const order = M.tldrRepoOrder([
      { repo: "quiet", signal: "idle" }, { repo: "busy", signal: "working" },
      { repo: "hot", signal: "needs-you" }]);
    expect(order.map((r: any) => r.repo)).toEqual(["hot", "busy", "quiet"]);
  });

  test("TL;DR attention count follows snapshot and repo state, with an honest clear state", async () => {
    const { doc, M } = await setupRailDom();
    M.state.snap = repoSnapFixture();
    M.state.tldrView = "ALL";
    M.renderHealthTldrLane();
    expect(textOf(findClass(doc.byId("health-tldr-lane"), "tldr-attention-count"))).toBe("1 need you");

    M.state.tldrView = "the-mountain-main";
    M.renderHealthTldrLane();
    expect(textOf(findClass(doc.byId("health-tldr-lane"), "tldr-attention-count"))).toBe("1 need you");

    M.state.snap = twoRepoSnapFixture();
    M.state.tldrView = "ALL";
    M.renderHealthTldrLane();
    expect(textOf(findClass(doc.byId("health-tldr-lane"), "tldr-attention-count"))).toBe("all clear");
  });

  test("clicking a chip jumps to that repo view; incoming data never yanks the view", async () => {
    const { doc, M } = await setupRailDom();
    M.state.snap = twoRepoSnapFixture();
    M.state.tldrView = "ALL";
    M.renderHealthTldrLane();
    fireClick(findChip(doc, "repoB"));
    expect(M.state.tldrView).toBe("repoB");
    M.state.snap = twoRepoSnapFixture({ repoA: "needs-you" });
    M.renderHealthTldrLane();
    expect(M.state.tldrView).toBe("repoB");
  });

  test("a heartbeat older than 7m marks the lane stale but keeps the story", async () => {
    const { doc, M } = await setupRailDom();
    M.state.snap = snapWithHeartbeat(v4Envelope(), { updatedAt: new Date(Date.now() - 8 * 60_000).toISOString() });
    M.renderHealthTldrLane();
    const lane = doc.byId("health-tldr-lane");
    expect(lane.classList.contains("is-stale")).toBe(true);
    expect(textOf(lane)).toContain("needs you");
  });
});

describe("mix and spend widgets", () => {
  test("mix counts sessions per provider and lists top models", async () => {
    // @ts-expect-error browser client has no declaration
    await import("../src/web/app.js");
    const M = (globalThis as any).TheAntHill;
    const data = M.summaryWidgetData("mix", mixSnapFixture(), "live", "percent", [], false, "");
    expect(data.value).toContain("6");
    expect(data.sublabel).toMatch(/×\d/);
  });
  test("spend renders provenance-honest cost and never fabricates $0", async () => {
    // @ts-expect-error browser client has no declaration
    await import("../src/web/app.js");
    const M = (globalThis as any).TheAntHill;
    const known = M.summaryWidgetData("spend", burnSnapFixture({ costLastHourUsd: 18.4, costIsFloor: true }), "live", "percent", [], false, "");
    expect(known.value).toContain("≥$18.40");
    const unknown = M.summaryWidgetData("spend", burnSnapFixture({ costProvenance: "unavailable", costLastHourUsd: null }), "live", "percent", [], false, "");
    expect(unknown.value).not.toContain("$0");
  });
  test("customizer offers mix/spend without changing default layout", async () => {
    // @ts-expect-error browser client has no declaration
    const { WIDGET_CATALOG, DEFAULT_WIDGET_IDS } = await import("../src/web/client-catalogs.js");
    expect(WIDGET_CATALOG.map((w: any) => w.id)).toContain("mix");
    expect(WIDGET_CATALOG.map((w: any) => w.id)).toContain("spend");
    expect(DEFAULT_WIDGET_IDS).not.toContain("mix");
    expect(DEFAULT_WIDGET_IDS).not.toContain("spend");
  });
});

describe("fleet fallback denominator", () => {
  test("counts distinct repos with LIVE agents, not program groups", async () => {
    // @ts-expect-error browser client has no declaration
    await import("../src/web/app.js");
    const M = (globalThis as any).TheAntHill;
    const snap = {
      totals: { live: 5, attention: 0 },
      programs: [
        { name: "wt1", agents: [{ lifecycle: "working", repo: { repoName: "alpha" } }] },
        { name: "wt2", agents: [{ lifecycle: "waiting", repo: { repoName: "alpha" } }] },
        { name: "beta", agents: [{ lifecycle: "working" }] },
        { name: "dormant", agents: [{ lifecycle: "finished", repo: { repoName: "gamma" } }] },
      ],
    };
    const line = M.fleetFallbackLine(snap, []);
    // alpha (two worktrees, one repo) + beta = 2 live repos; gamma is dormant,
    // and 4 program groups must never masquerade as 4 repos.
    expect(line).toContain("5 live across 2 repos");
  });
});

describe("header disclosure — collapse/expand state machine", () => {
  test("default paint is expanded: rail shown, compact hidden, toggle announces the open state", async () => {
    await withHeaderHarness(({ doc, M }) => {
      M.state.snap = repoSnapFixture();
      M.renderHealthRail();
      expect(M.state.headerCollapsed).toBe(false);
      expect(doc.byId("health-rail").hidden).toBe(false);
      expect(doc.byId("compact-summary").hidden).toBe(true);
      const toggle = doc.byId("header-summary-toggle");
      expect(toggle.attributes["aria-expanded"]).toBe("true");
      expect(textOf(toggle)).toBe("Collapse header");
      expect(doc.body.classList.contains("header-summary-collapsed")).toBe(false);
    });
  });

  test("collapse swaps faces in the same turn, keeps focus, closes the customizer, preserves repo scope, writes literal 'true'", async () => {
    await withHeaderHarness(({ doc, M, storage }) => {
      M.state.snap = repoSnapFixture();
      M.state.tldrView = "the-mountain-main";
      M.state.facetProgram = "p-mountain";
      M.state.widgetCustomizerOpen = true;
      M.renderHealthRail();
      const toggle = doc.byId("header-summary-toggle");
      toggle.focus();
      /* No new snapshot after this click: the swap below is the proof that the
         disclosure state is part of the widgets paint signature. */
      fireClick(toggle);
      expect(M.state.headerCollapsed).toBe(true);
      expect(doc.byId("health-rail").hidden).toBe(true);
      const compact = doc.byId("compact-summary");
      expect(compact.hidden).toBe(false);
      expect(readingTuples(compact).length).toBeGreaterThan(0);
      expect(doc.body.classList.contains("header-summary-collapsed")).toBe(true);
      expect(textOf(toggle)).toBe("Expand header");
      expect(toggle.attributes["aria-expanded"]).toBe("false");
      expect(storage.store.get("mtn3-header-collapsed")).toBe("true");
      expect(M.state.widgetCustomizerOpen).toBe(false);
      expect(doc.byId("widget-customizer").hidden).toBe(true);
      expect(M.state.tldrView).toBe("the-mountain-main");
      expect(M.state.facetProgram).toBe("p-mountain");
      /* Same static node, still focused — collapse must never rebuild it. */
      expect(doc.byId("header-summary-toggle")).toBe(toggle);
      expect(doc.activeElement).toBe(toggle);
      expect(toggle.parent.children.at(-1)).toBe(toggle);
    });
  });

  test("expand writes literal 'false', keeps the same focused button, and restores the repo view", async () => {
    await withHeaderHarness(({ doc, M, storage }) => {
      M.state.snap = repoSnapFixture();
      M.state.tldrView = "the-mountain-main";
      M.state.facetProgram = "p-mountain";
      M.renderHealthRail();
      const toggle = doc.byId("header-summary-toggle");
      toggle.focus();
      fireClick(toggle);
      expect(M.state.headerCollapsed).toBe(true);
      fireClick(toggle);
      expect(M.state.headerCollapsed).toBe(false);
      expect(storage.store.get("mtn3-header-collapsed")).toBe("false");
      expect(doc.byId("health-rail").hidden).toBe(false);
      expect(doc.byId("compact-summary").hidden).toBe(true);
      expect(doc.body.classList.contains("header-summary-collapsed")).toBe(false);
      expect(textOf(toggle)).toBe("Collapse header");
      expect(toggle.attributes["aria-expanded"]).toBe("true");
      expect(M.state.widgetCustomizerOpen).toBe(false);
      expect(M.state.tldrView).toBe("the-mountain-main");
      expect(M.state.facetProgram).toBe("p-mountain");
      expect(doc.byId("header-summary-toggle")).toBe(toggle);
      expect(doc.activeElement).toBe(toggle);
      expect(toggle.parent.children[0]).toBe(toggle);
    });
  });

  test("an incoming snapshot never resets the operator's collapsed choice", async () => {
    await withHeaderHarness(({ doc, M }) => {
      M.state.snap = repoSnapFixture();
      M.renderHealthRail();
      fireClick(doc.byId("header-summary-toggle"));
      expect(M.state.headerCollapsed).toBe(true);
      M.state.snap = twoRepoSnapFixture({ repoA: "needs-you" });
      M.renderHealthRail();
      expect(M.state.headerCollapsed).toBe(true);
      expect(doc.byId("health-rail").hidden).toBe(true);
      expect(doc.byId("compact-summary").hidden).toBe(false);
      expect(doc.body.classList.contains("header-summary-collapsed")).toBe(true);
    });
  });

  test("#cleanup-status keeps its node identity and text across collapse/expand cycles", async () => {
    await withHeaderHarness(({ doc, M }) => {
      M.state.snap = repoSnapFixture();
      const region = doc.byId("cleanup-status");
      region.textContent = "sweep running";
      M.renderHealthRail();
      const toggle = doc.byId("header-summary-toggle");
      fireClick(toggle);
      fireClick(toggle);
      expect(doc.byId("cleanup-status")).toBe(region);
      expect(region.textContent).toBe("sweep running");
    });
  });
});

describe("header disclosure — compact face parity with the owner derivations", () => {
  test("calm fleet: both faces render the one calm line, and a fixture mutation moves both", async () => {
    await withHeaderHarness(({ doc, M }) => {
      M.state.snap = calmSnapFixture();
      const model = M.pulseStripModel(M.state.snap, "live", [], "percent", "");
      expect(model.calm).toBe(true);
      expect(model.allCells.find((cell: any) => cell.id === "health").data.value).toBe("Readings healthy");
      M.renderHealthRail();
      const expandedCopy = textOf(findClass(doc.byId("readings-grid"), "pulse-calm-copy"));
      expect(expandedCopy).toContain("3 shipping");
      expect(expandedCopy).toContain(`${M.fmtTok(1234)} tok/min`);
      expect(expandedCopy).toContain("$4.12 last hour");
      const toggle = doc.byId("header-summary-toggle");
      fireClick(toggle);
      const compact = doc.byId("compact-summary");
      const compactCopy = textOf(findClass(compact, "pulse-calm-copy"));
      expect(compactCopy).toBe(expandedCopy);
      /* Mutate the input between paints: both faces must move to the new oracle
         value, or they are copies of a constant rather than of the derivation. */
      M.state.snap = calmSnapFixture({ costLastHourUsd: 9.87 });
      M.renderHealthRail();
      expect(textOf(findClass(compact, "pulse-calm-copy"))).toContain("$9.87 last hour");
      fireClick(toggle);
      expect(textOf(findClass(doc.byId("readings-grid"), "pulse-calm-copy"))).toContain("$9.87 last hour");
    });
  });

  test("stressed fleet: compact cells equal the model's own cells in order, label, and value", async () => {
    await withHeaderHarness(({ doc, M }) => {
      M.state.snap = repoSnapFixture();
      const model = M.pulseStripModel(M.state.snap, "live", [], "percent", "");
      expect(model.calm).toBe(false);
      const expected = M.state.widgetIds
        .map((id: string) => model.cells.find((cell: any) => cell.id === id))
        .filter(Boolean);
      expect(expected.length).toBeGreaterThan(0);
      M.renderHealthRail();
      const expandedTuples = readingTuples(doc.byId("readings-grid"));
      fireClick(doc.byId("header-summary-toggle"));
      const compactTuples = readingTuples(doc.byId("compact-summary"));
      expect(compactTuples).toEqual(expandedTuples);
      expect(compactTuples.length).toBe(expected.length);
      /* Each face independently equals the owner derivation — face-to-face
         equality alone would bless two copies of the same wrong constant. */
      for (const tuples of [expandedTuples, compactTuples]) {
        expected.forEach((cell: any, at: number) => {
          expect(tuples[at].value.startsWith(String(cell.data.value))).toBe(true);
        });
      }
    });
  });

  test("compact health keeps the cleanup action reachable while expanded-only detail stays hidden", async () => {
    await withHeaderHarness(({ doc, M }) => {
      const snap: any = repoSnapFixture();
      snap.controlHealth = {
        cmuxReachable: true,
        lastCheckedAt: new Date().toISOString(),
        errors: ["collector degraded"],
        staleSources: [],
      };
      M.state.snap = snap;
      M.renderHealthRail();
      fireClick(doc.byId("header-summary-toggle"));
      const compact = doc.byId("compact-summary");
      expect(findClass(compact, "verdict-cleanup")).not.toBeNull();
      expect(findClass(compact, "reading-sub-action")).not.toBeNull();
    });
  });

  test("repo-scoped: compact tuples equal repoScopedReadings exactly, Burn stays honest", async () => {
    await withHeaderHarness(({ doc, M }) => {
      M.state.snap = repoSnapFixture();
      M.state.tldrView = "the-mountain-main";
      const scoped = M.repoScopedReadings(M.programForTldrRepo(M.state.snap, "the-mountain-main"));
      expect(scoped).toBeTruthy();
      M.renderHealthRail();
      const expandedTuples = readingTuples(doc.byId("readings-grid"));
      fireClick(doc.byId("header-summary-toggle"));
      const compactTuples = readingTuples(doc.byId("compact-summary"));
      expect(compactTuples).toEqual(expandedTuples);
      const expectedOrder = ["health", "momentum", "burn", "context-peak"].filter((id) => scoped[id]);
      expect(compactTuples.length).toBe(expectedOrder.length);
      for (const tuples of [expandedTuples, compactTuples]) {
        expectedOrder.forEach((id: string, at: number) => {
          expect(tuples[at].value.startsWith(String(scoped[id].value))).toBe(true);
        });
      }
      const burnAt = expectedOrder.indexOf("burn");
      expect(compactTuples[burnAt].value).toContain("—");
      expect(M.state.tldrView).toBe("the-mountain-main");
    });
  });

  test("missing data: readings the model omits stay omitted in both faces — nothing fabricated", async () => {
    await withHeaderHarness(({ doc, M }) => {
      const snap: any = repoSnapFixture();
      snap.pulse = { activity: { buckets: [] }, burn: {}, momentum: {} };
      M.state.snap = snap;
      const model = M.pulseStripModel(snap, "live", [], "percent", "");
      const expected = M.state.widgetIds
        .map((id: string) => model.cells.find((cell: any) => cell.id === id))
        .filter(Boolean);
      M.renderHealthRail();
      const expandedTuples = readingTuples(doc.byId("readings-grid"));
      fireClick(doc.byId("header-summary-toggle"));
      const compact = doc.byId("compact-summary");
      const compactTuples = readingTuples(compact);
      expect(compactTuples).toEqual(expandedTuples);
      expect(compactTuples.length).toBe(expected.length);
      const compactText = textOf(compact);
      expect(compactText).not.toContain("No data");
      expect(compactText).not.toContain("$0.00");
    });
  });
});
