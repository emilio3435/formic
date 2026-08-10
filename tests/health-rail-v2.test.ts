import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  burnSnapFixture, findChip, findClass, fireClick, mixSnapFixture, readingCell,
  repoSnapFixture, setupRailDom, snapWithHeartbeat, snapWithoutRepo, textOf,
  twoRepoSnapFixture, v4Envelope,
} from "./helpers/fake-dom";

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

  test("fleetFallbackLine composes a deterministic ALL line from snapshot totals", async () => {
    // @ts-expect-error browser client has no declaration
    await import("../src/web/app.js");
    const M = (globalThis as any).TheAntHill;
    // Repos count only when LIVE agents inhabit them (liveRepoNames contract).
    const snap = { totals: { live: 8, attention: 1 }, programs: [
      { name: "the-mountain-main", agents: [{ lifecycle: "working" }] },
      { name: "Home", agents: [{ lifecycle: "waiting" }] },
      { name: "cooper", agents: [{ lifecycle: "working" }] },
    ] };
    const line = M.fleetFallbackLine(snap, [{ repo: "the-mountain-main", signal: "needs-you" }]);
    expect(line).toContain("8 live");
    expect(line).toContain("3 repos");
    expect(line).toContain("the-mountain-main");
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
    expect(findClass(lane, "tldr-chip")).toBeTruthy();
    M.state.snap = snapWithHeartbeat(null);
    M.renderHealthTldrLane();
    expect(doc.byId("health-tldr-lane").attributes.hidden).toBeDefined();
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
