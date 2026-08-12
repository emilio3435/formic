/**
 * Header collapse — real browser geometry.
 *
 * LOCAL ONLY, on the ../rhsp-geometry-gate/drawer-geometry.test.ts conventions:
 * this file lives in docs/ because it drives the gstack `browse` Chromium,
 * which CI does not have. It starts this checkout on an ephemeral port, drives
 * the REAL disclosure button, and asks the layout engine for the boxes. It
 * deliberately fails when the browser is unavailable; a zero-geometry pass
 * would recreate the blind spot this gate exists to close.
 *
 * Deliberately the smallest deterministic core: collapsed masthead height caps
 * at the locked widths, face exclusivity as computed display, reclaimed
 * top-stack space, horizontal-overflow absence, compact reading visibility,
 * mobile touch targets, RHSP invariance across the toggle, and one reload
 * persistence pass (boot-order is only provable in a browser). The six
 * inspected screenshots, native key presses, scroll sampling, and the
 * exact-baseline comparison belong to the integration owner's full run.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "../..");
const BROWSE = [
  join(REPO, ".agents/skills/gstack/browse/dist/browse"),
  join(REPO, ".claude/skills/gstack/browse/dist/browse"),
  join(homedir(), ".agents/skills/gstack/browse/dist/browse"),
  join(homedir(), ".claude/skills/gstack/browse/dist/browse"),
].find((path) => existsSync(path));

const TOGGLE = '[data-fkey="header-summary-toggle"]';
const STORAGE_KEY = "mtn3-header-collapsed";

/* The locked widths and their collapsed masthead caps (spec §3.4/§3.5). */
const VIEWPORTS = [
  { width: 1_920, height: 1_080, band: "desktop", cap: 64 },
  { width: 1_530, height: 862, band: "desktop", cap: 64 },
  { width: 1_366, height: 768, band: "desktop", cap: 64 },
  { width: 1_025, height: 768, band: "desktop", cap: 64 },
  { width: 1_024, height: 768, band: "intermediate", cap: 104 },
  { width: 721, height: 900, band: "intermediate", cap: 104 },
  { width: 720, height: 900, band: "mobile", cap: 156 },
  { width: 390, height: 844, band: "mobile", cap: 156 },
] as const;

interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

interface HeaderGeometry {
  width: number;
  height: number;
  bodyCollapsed: boolean;
  masthead: Rect;
  rail: { hidden: boolean; display: string; rect: Rect };
  railInner: Rect | null;
  tldrLaneVisible: boolean;
  compact: {
    hidden: boolean;
    display: string;
    rect: Rect;
    readings: Array<{ label: string; value: string; rect: Rect }>;
  };
  toggle: { text: string; expanded: string | null; rect: Rect; focused: boolean };
  controls: Record<"notify" | "settings" | "conn", { rect: Rect; display: string } | null>;
  appBodyTop: number;
  storage: string | null;
  docScrollWidth: number;
  docClientWidth: number;
}

interface PaneGeometry {
  present: boolean;
  rect: Rect | null;
  position: string;
  cssTop: string;
  paneTopInBand: number | null;
  composer: Rect | null;
  controlsStrip: Rect | null;
  declaredVerticalOwners: string[];
  paneListOverflowY: string;
  opsStageOverflowY: string;
  viewportHeight: number;
  docScrollWidth: number;
  docClientWidth: number;
}

let server: ReturnType<typeof Bun.spawn> | null = null;
let base = "";

const expanded = new Map<string, HeaderGeometry>();
const collapsed = new Map<string, HeaderGeometry>();
const reexpanded = new Map<string, HeaderGeometry>();
const paneByPhase = new Map<string, PaneGeometry>();
const persistence: Record<string, HeaderGeometry> = {};
let malformedSeedResolvedExpanded = false;

function key(width: number, height: number): string {
  return `${width}x${height}`;
}

function browse(args: string[]): string {
  const run = Bun.spawnSync([BROWSE as string, ...args], {
    cwd: REPO,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = run.stdout.toString().trim();
  if (run.exitCode !== 0) {
    throw new Error(
      `browse ${args[0]} failed (${run.exitCode}): ${stdout}\n${run.stderr.toString().trim()}`,
    );
  }
  return stdout;
}

function browseJson<T>(expression: string): T {
  const raw = browse(["js", expression]);
  const body = raw
    .split("\n")
    .filter((line) => !line.startsWith("--- BEGIN") && !line.startsWith("--- END"))
    .join("\n")
    .trim();
  return JSON.parse(body) as T;
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  if (typeof port !== "number") throw new Error("could not reserve an ephemeral header-collapse test port");
  return port;
}

function withinPx(a: number, b: number, tol = 1): void {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
}

/* Stressed fixture WITH a v4 TL;DR envelope, so the expanded rail carries the
   TL;DR lane (the reclaim criterion is stated for that state) and the compact
   face has stressed cells to mirror. `openFirst` selects the RHSP agent. */
const INJECT = `(openFirst) => {
  const M = globalThis.TheAntHill;
  if (!M) throw new Error("TheAntHill test seam did not load");
  M.stopBoot();
  const now = new Date().toISOString();
  const envelope = '[TL;DR 17:33] {"v":4,"fleet":"*hcollapse-fixture* !needs you!.","repos":[{"repo":"hcollapse-fixture","summary":"Drawer agent blocked - answer the question.","blocker":"question pending","signal":"needs-you"},{"repo":"Home","summary":"Idle after green run.","blocker":"all-clear","signal":"ok"}]}';
  const makeAgent = (index) => ({
    id: "cursor:hcollapse-geometry-" + index,
    provider: "cursor",
    sourceSessionId: "hcollapse-geometry-" + index,
    displayName: index === 0 ? "Header collapse fixture" : ("Fixture row " + index),
    programId: "hcollapse-fixture",
    cwd: "/Users/example/shared-folder",
    model: "cursor-agent",
    task: "Prove header collapse leaves the RHSP untouched.",
    status: "running",
    statusReason: "Streaming output.",
    lifecycle: index === 1 ? "waiting" : "working",
    attentionSignal: index === 1,
    outcome: index === 1 ? "blocked" : undefined,
    scope: "observed",
    updatedAt: now,
    tokens: { provenance: "observed", scope: "latest-turn", total: 41000, contextWindow: 128000 },
    artifacts: [],
    gates: [],
    controlState: "quarantined",
    controls: [
      { action: "focus", enabled: false, reason: "Shared cwd is not identity." },
      { action: "instruct", enabled: false, reason: "Shared cwd is not identity." },
      { action: "interrupt", enabled: false, reason: "Shared cwd is not identity." },
    ],
  });
  const agents = [makeAgent(0), makeAgent(1)];
  agents.unshift({
    id: "prime:ant-heartbeat-monitor",
    lifecycle: "working",
    transcriptTail: envelope,
    updatedAt: now,
  });
  const program = { id: "hcollapse-fixture", name: "hcollapse-fixture", agents };
  const first = agents[1];
  M.state.conn = "live";
  M.state.view = "board";
  M.state.tldrView = "ALL";
  M.state.actions = { loading: false, error: "", available: true, items: [] };
  M.state.pending = new Set();
  M.state.drafts = new Map();
  M.state.feedback = new Map();
  M.state.confirming = null;
  M.state.queueItems = [];
  M.state.queueError = "";
  M.state.fetchFailed = false;
  if (openFirst) {
    M.state.selected = { kind: "agent", id: first.id };
    M.state.selectedId = first.id;
    M.state.transcript = {
      agentId: first.id, loading: false, error: "", limit: 200,
      data: { source: "/tmp/hcollapse-geometry.jsonl", truncated: false, lines: [
        { at: now, role: "user", text: "Does collapsing the header move this pane?" },
        { at: now, role: "assistant", text: "It must not: height, sticky position, owners and composer stay put." },
      ] },
    };
  } else {
    M.state.selected = null;
    M.state.selectedId = null;
    M.state.transcript = { agentId: "", loading: false, error: "", limit: 200, data: null };
  }
  M.applySnapshot({
    schemaVersion: 1,
    generatedAt: now,
    scanWindowHours: 36,
    controlHealth: { cmuxReachable: true, lastCheckedAt: now, errors: [], staleSources: [] },
    totals: { live: agents.length, tracked: agents.length, attention: 1, working: agents.length - 1, idle: 1, history: 0 },
    programs: [program],
  });
  return true;
}`;

const MEASURE_HEADER = `(() => {
  const rect = (node) => {
    const r = node.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
  };
  const masthead = document.querySelector(".masthead");
  const rail = document.getElementById("health-rail");
  const compact = document.getElementById("compact-summary");
  const toggle = document.querySelector('[data-fkey="header-summary-toggle"]');
  const appBody = document.querySelector(".app-body");
  const railInner = document.getElementById("health-widgets");
  const lane = document.getElementById("health-tldr-lane");
  if (!masthead || !rail || !compact || !toggle || !appBody) throw new Error("header selectors missing");
  const readings = [...compact.querySelectorAll(".reading")].map((cell) => ({
    label: (cell.querySelector(".reading-label")?.textContent || "").trim(),
    value: (cell.querySelector(".reading-value")?.textContent || "").trim(),
    rect: rect(cell),
  }));
  const controls = {};
  for (const [name, sel] of Object.entries({ notify: "#notify-toggle", settings: "#settings-toggle", conn: "#conn-badge" })) {
    const node = document.querySelector(sel);
    controls[name] = node ? { rect: rect(node), display: getComputedStyle(node).display } : null;
  }
  let storage = null;
  try { storage = localStorage.getItem("mtn3-header-collapsed"); } catch {}
  return JSON.stringify({
    width: window.innerWidth,
    height: window.innerHeight,
    bodyCollapsed: document.body.classList.contains("header-summary-collapsed"),
    masthead: rect(masthead),
    rail: { hidden: rail.hidden, display: getComputedStyle(rail).display, rect: rect(rail) },
    railInner: railInner ? rect(railInner) : null,
    tldrLaneVisible: Boolean(lane && !lane.hidden && getComputedStyle(lane).display !== "none"),
    compact: {
      hidden: compact.hidden,
      display: getComputedStyle(compact).display,
      rect: rect(compact),
      readings,
    },
    toggle: {
      text: (toggle.textContent || "").trim(),
      expanded: toggle.getAttribute("aria-expanded"),
      rect: rect(toggle),
      focused: document.activeElement === toggle,
    },
    controls,
    appBodyTop: appBody.getBoundingClientRect().top,
    storage,
    docScrollWidth: document.documentElement.scrollWidth,
    docClientWidth: document.documentElement.clientWidth,
  });
})()`;

const MEASURE_PANE = `(() => {
  const rect = (node) => {
    const r = node.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
  };
  const appBody = document.querySelector(".app-body");
  const paneList = document.querySelector(".pane-list");
  const opsStage = document.querySelector(".ops-stage");
  if (!appBody || !paneList || !opsStage) throw new Error("workspace selectors missing");
  const pane = document.querySelector(".pane-inspector.dw-agent");
  const present = Boolean(pane && !pane.hidden);
  const style = present ? getComputedStyle(pane) : null;
  const owners = [];
  if (present) {
    const nodes = {
      grid: pane.querySelector(":scope > .drawer-grid"),
      feed: pane.querySelector(".drawer-chat-scroll"),
      desk: pane.querySelector(".drawer-desk"),
    };
    for (const [name, node] of Object.entries(nodes)) {
      if (node && ["auto", "scroll"].includes(getComputedStyle(node).overflowY)) owners.push(name);
    }
  }
  const composer = present ? pane.querySelector(".command-composer") : null;
  const strip = present ? pane.querySelector(".drawer-controls-strip") : null;
  return JSON.stringify({
    present,
    rect: present ? rect(pane) : null,
    position: style ? style.position : "",
    cssTop: style ? style.top : "",
    paneTopInBand: present ? pane.getBoundingClientRect().top - appBody.getBoundingClientRect().top : null,
    composer: composer ? rect(composer) : null,
    controlsStrip: strip ? rect(strip) : null,
    declaredVerticalOwners: owners,
    paneListOverflowY: getComputedStyle(paneList).overflowY,
    opsStageOverflowY: getComputedStyle(opsStage).overflowY,
    viewportHeight: window.innerHeight,
    docScrollWidth: document.documentElement.scrollWidth,
    docClientWidth: document.documentElement.clientWidth,
  });
})()`;

async function waitForAppReady(): Promise<void> {
  browse(["wait", "body"]);
  const deadline = Date.now() + 60_000;
  while (!browseJson<boolean>(
    "JSON.stringify(Boolean(globalThis.TheAntHill?.renderAgentDrawer && globalThis.TheAntHill?.applySnapshot && globalThis.TheAntHill?.state?.snap))",
  )) {
    if (Date.now() > deadline) {
      throw new Error("TheAntHill test seam and initial snapshot did not load in Chromium");
    }
    await Bun.sleep(100);
  }
}

/* The disclosure is an immediate layout-state switch: wait on the three mode
   surfaces, never on elapsed time. */
async function waitForMode(collapsedWanted: boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const settled = browseJson<boolean>(`JSON.stringify(
      document.body.classList.contains("header-summary-collapsed") === ${collapsedWanted}
      && document.getElementById("health-rail").hidden === ${collapsedWanted}
      && document.getElementById("compact-summary").hidden === ${!collapsedWanted}
    )`);
    if (settled) return;
    if (Date.now() > deadline) throw new Error(`disclosure never settled at collapsed=${collapsedWanted}`);
    await Bun.sleep(50);
  }
}

async function setCollapsed(want: boolean): Promise<void> {
  const current = browseJson<boolean>(
    'JSON.stringify(document.body.classList.contains("header-summary-collapsed"))',
  );
  if (current !== want) browse(["click", TOGGLE]);
  await waitForMode(want);
}

function measureHeader(): HeaderGeometry {
  return browseJson<HeaderGeometry>(MEASURE_HEADER);
}

function measurePane(): PaneGeometry {
  return browseJson<PaneGeometry>(MEASURE_PANE);
}

async function gotoReady(): Promise<void> {
  browse(["goto", base]);
  await waitForAppReady();
}

beforeAll(async () => {
  if (!BROWSE) {
    throw new Error(
      "UNAVAILABLE: gstack browse is not built, so Chromium cannot measure header-collapse geometry. "
      + "Build the local browser boundary; never replace this gate with fake DOM rectangles.",
    );
  }

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = Bun.spawn(["bun", "src/server/index.ts"], {
    cwd: REPO,
    env: { ...process.env, MOUNTAIN_PORT: String(port) },
    stdout: "pipe",
    stderr: "pipe",
  });

  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const response = await fetch(base, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) break;
    } catch { /* boot polling */ }
    if (server.exitCode !== null || Date.now() > deadline) {
      if (server.exitCode === null) {
        server.kill();
        await server.exited;
      }
      const [stdout, stderr] = await Promise.all([
        new Response(server.stdout).text(),
        new Response(server.stderr).text(),
      ]);
      throw new Error(
        `the isolated header-collapse server never answered on ${base} (exit ${server.exitCode ?? "unknown"})`
        + `\n${stdout.trim()}\n${stderr.trim()}`,
      );
    }
    await Bun.sleep(250);
  }

  /* -------- header sweep: expanded → collapsed → re-expanded, every width. */
  for (const viewport of VIEWPORTS) {
    const k = key(viewport.width, viewport.height);
    browse(["viewport", `${viewport.width}x${viewport.height}`]);
    await gotoReady();
    browseJson<boolean>(`(() => { const inject = ${INJECT}; return JSON.stringify(inject(false)); })()`);
    await setCollapsed(false);
    const open = measureHeader();
    if (open.width !== viewport.width || open.height !== viewport.height) {
      throw new Error(`viewport did not take: asked ${k}, measured ${open.width}x${open.height}`);
    }
    expanded.set(k, open);
    await setCollapsed(true);
    collapsed.set(k, measureHeader());
    await setCollapsed(false);
    reexpanded.set(k, measureHeader());
    console.log(`[header-collapse ${k}] collapsed masthead ${JSON.stringify(collapsed.get(k)?.masthead)}`);
  }

  /* -------- RHSP invariance at the two locked desktop viewports. */
  for (const viewport of VIEWPORTS.filter((v) => v.width === 1_920 || v.width === 1_530)) {
    const k = key(viewport.width, viewport.height);
    browse(["viewport", `${viewport.width}x${viewport.height}`]);
    await gotoReady();
    browseJson<boolean>(`(() => { const inject = ${INJECT}; return JSON.stringify(inject(true)); })()`);
    await Bun.sleep(350); // let the drawer's entry animation settle (260ms max)
    await setCollapsed(false);
    paneByPhase.set(`${k}:expanded`, measurePane());
    await setCollapsed(true);
    paneByPhase.set(`${k}:collapsed`, measurePane());
    await setCollapsed(false);
    paneByPhase.set(`${k}:reexpanded`, measurePane());
  }

  /* -------- reload persistence against the real origin (boot-order proof). */
  browse(["viewport", "1920x1080"]);
  await gotoReady();
  browseJson<string>(`JSON.stringify((localStorage.removeItem("${STORAGE_KEY}"), "ok"))`);
  await gotoReady();
  persistence.freshDefault = measureHeader();

  browse(["click", TOGGLE]);
  await waitForMode(true);
  persistence.afterClickCollapse = measureHeader();

  await gotoReady();
  persistence.reloadCollapsed = measureHeader();

  browse(["click", TOGGLE]);
  await waitForMode(false);
  persistence.afterClickExpand = measureHeader();

  browseJson<string>(`JSON.stringify((localStorage.setItem("${STORAGE_KEY}", "TRUE"), "ok"))`);
  await gotoReady();
  malformedSeedResolvedExpanded = !browseJson<boolean>(
    'JSON.stringify(document.body.classList.contains("header-summary-collapsed"))',
  );
  browseJson<string>(`JSON.stringify((localStorage.removeItem("${STORAGE_KEY}"), "ok"))`);
}, 480_000);

afterAll(async () => {
  if (server?.exitCode === null) {
    server.kill();
    await server.exited;
  }
  try { browse(["viewport", "1280x800"]); } catch { /* shared daemon already stopped */ }
});

function expectVisible(rect: Rect, width: number, height: number): void {
  expect(rect.width).toBeGreaterThan(0);
  expect(rect.height).toBeGreaterThan(0);
  expect(rect.left).toBeGreaterThanOrEqual(-0.5);
  expect(rect.right).toBeLessThanOrEqual(width + 0.5);
  expect(rect.top).toBeGreaterThanOrEqual(-0.5);
  expect(rect.bottom).toBeLessThanOrEqual(height + 0.5);
}

describe("collapsed mode reclaims the header without breaking either face", () => {
  for (const viewport of VIEWPORTS) {
    const k = key(viewport.width, viewport.height);

    test(`${k}: expanded shows the rail, hides the compact face, and adds no horizontal overflow`, () => {
      const g = expanded.get(k) as HeaderGeometry;
      expect(g).toBeDefined();
      expect(g.rail.hidden).toBe(false);
      expect(g.rail.display).not.toBe("none");
      expect(g.rail.rect.height).toBeGreaterThan(0);
      expect(g.compact.hidden).toBe(true);
      expect(g.compact.display).toBe("none");
      expect(g.bodyCollapsed).toBe(false);
      expect(g.toggle.text).toBe("Collapse header");
      expect(g.toggle.expanded).toBe("true");
      /* Owner decision 2026-08-11: the disclosure must be on-screen and
         operable in BOTH modes at every locked width — a clipped toggle at
         phone widths is a feature the operator cannot reach. */
      expectVisible(g.toggle.rect, viewport.width, viewport.height);
      if (viewport.band === "mobile") {
        expect(g.toggle.rect.height).toBeGreaterThanOrEqual(44);
      }
      expect(g.tldrLaneVisible).toBe(true);
      expect(g.docScrollWidth).toBeLessThanOrEqual(g.docClientWidth);
    });

    test(`${k}: collapsed masthead stays at or below ${viewport.cap}px with everything visible`, () => {
      const g = collapsed.get(k) as HeaderGeometry;
      expect(g).toBeDefined();
      expect(g.bodyCollapsed).toBe(true);
      expect(g.rail.hidden).toBe(true);
      expect(g.rail.display).toBe("none");
      expect(g.compact.hidden).toBe(false);
      expect(g.compact.display).not.toBe("none");
      expect(g.toggle.text).toBe("Expand header");
      expect(g.toggle.expanded).toBe("false");
      /* Height cap only counts once the face is proven populated and on
         screen — an empty or zero-sized header passes any cap. */
      expect(g.compact.readings.length).toBeGreaterThan(0);
      for (const reading of g.compact.readings) {
        expect(reading.value.length).toBeGreaterThan(0);
        expectVisible(reading.rect, viewport.width, g.masthead.bottom + 0.5);
      }
      expect(g.masthead.height).toBeLessThanOrEqual(viewport.cap + 0.5);
      /* The persistent controls stay visible in the collapsed row. */
      for (const name of ["notify", "settings", "conn"] as const) {
        const control = g.controls[name];
        expect(control).not.toBeNull();
        expect(control!.display).not.toBe("none");
        expectVisible(control!.rect, viewport.width, viewport.height);
      }
      expectVisible(g.toggle.rect, viewport.width, viewport.height);
      expect(g.docScrollWidth).toBeLessThanOrEqual(g.docClientWidth);
    });

    test(`${k}: exactly one face is exposed in each mode`, () => {
      for (const g of [expanded.get(k) as HeaderGeometry, collapsed.get(k) as HeaderGeometry]) {
        const exposed = [g.rail.display !== "none", g.compact.display !== "none"];
        expect(exposed.filter(Boolean).length).toBe(1);
      }
    });

    test(`${k}: re-expanding restores the expanded geometry within a pixel`, () => {
      const before = expanded.get(k) as HeaderGeometry;
      const after = reexpanded.get(k) as HeaderGeometry;
      withinPx(after.masthead.height, before.masthead.height);
      withinPx(after.rail.rect.height, before.rail.rect.height);
      withinPx(after.appBodyTop, before.appBodyTop);
    });
  }

  test("1920x1080: collapsing reclaims at least 140px of top stack with the TL;DR lane present", () => {
    const open = expanded.get("1920x1080") as HeaderGeometry;
    const shut = collapsed.get("1920x1080") as HeaderGeometry;
    expect(open.tldrLaneVisible).toBe(true);
    expect(open.appBodyTop - shut.appBodyTop).toBeGreaterThanOrEqual(140);
  });

  test("desktop expanded rail keeps its 156px floor — collapse is a mode, not a retune", () => {
    for (const k of ["1920x1080", "1530x862", "1366x768", "1025x768"]) {
      const g = expanded.get(k) as HeaderGeometry;
      expect(g.railInner).not.toBeNull();
      expect(g.railInner!.height).toBeGreaterThanOrEqual(155.5);
    }
  });

  test("desktop collapsed row keeps the disclosure at the row's right edge", () => {
    for (const k of ["1920x1080", "1530x862", "1366x768", "1025x768"]) {
      const g = collapsed.get(k) as HeaderGeometry;
      for (const name of ["notify", "settings", "conn"] as const) {
        expect(g.toggle.rect.left).toBeGreaterThanOrEqual(g.controls[name]!.rect.left);
      }
    }
  });

  test("mobile collapsed readings form two columns and controls keep 44px targets", () => {
    for (const k of ["720x900", "390x844"]) {
      const g = collapsed.get(k) as HeaderGeometry;
      const lefts = [...new Set(g.compact.readings.map((r) => Math.round(r.rect.left)))];
      expect(lefts.length, k).toBeLessThanOrEqual(2);
      if (g.compact.readings.length > 1) expect(lefts.length, k).toBe(2);
      for (const name of ["notify", "settings"] as const) {
        expect(g.controls[name]!.rect.height, `${k} ${name}`).toBeGreaterThanOrEqual(44);
      }
      expect(g.toggle.rect.height, k).toBeGreaterThanOrEqual(44);
    }
  });
});

describe("collapse and expand leave the open RHSP untouched", () => {
  for (const k of ["1920x1080", "1530x862"]) {
    test(`${k}: pane height, sticky position, owners, and composer are invariant across the toggle`, () => {
      const phases = ["expanded", "collapsed", "reexpanded"].map((phase) => {
        const g = paneByPhase.get(`${k}:${phase}`);
        expect(g, `${k}:${phase}`).toBeDefined();
        return g as PaneGeometry;
      });
      const baseline = phases[0];
      expect(baseline.present).toBe(true);
      for (const g of phases) {
        expect(g.present).toBe(true);
        expect(g.position).toBe("sticky");
        expect(g.cssTop).toBe(baseline.cssTop);
        withinPx(g.rect!.height, baseline.rect!.height);
        /* Compare pane top relative to the band, not the document: moving the
           workboard upward is the point of collapsing. */
        withinPx(g.paneTopInBand as number, baseline.paneTopInBand as number);
        expect(g.declaredVerticalOwners).toEqual(["feed", "desk"]);
        expect(["auto", "scroll"]).not.toContain(g.paneListOverflowY);
        expect(["auto", "scroll"]).not.toContain(g.opsStageOverflowY);
        expect(g.composer).not.toBeNull();
        expect(g.composer!.height).toBeGreaterThan(0);
        expect(g.composer!.bottom).toBeLessThanOrEqual(g.viewportHeight + 0.5);
        expect(g.controlsStrip).not.toBeNull();
        expect(g.controlsStrip!.height).toBeGreaterThan(0);
        expect(g.docScrollWidth).toBeLessThanOrEqual(g.docClientWidth);
      }
    });
  }
});

describe("the preference persists through the real origin", () => {
  test("no stored value: first render is expanded and nothing is written until a click", () => {
    const g = persistence.freshDefault;
    expect(g.bodyCollapsed).toBe(false);
    expect(g.rail.hidden).toBe(false);
    expect(g.toggle.text).toBe("Collapse header");
    expect(g.storage).toBeNull();
  });

  test("clicking Collapse writes the literal 'true', keeps focus, and survives a reload", () => {
    expect(persistence.afterClickCollapse.storage).toBe("true");
    expect(persistence.afterClickCollapse.bodyCollapsed).toBe(true);
    expect(persistence.afterClickCollapse.toggle.focused).toBe(true);
    expect(persistence.reloadCollapsed.bodyCollapsed).toBe(true);
    expect(persistence.reloadCollapsed.rail.hidden).toBe(true);
    expect(persistence.afterClickExpand.storage).toBe("false");
    expect(persistence.afterClickExpand.bodyCollapsed).toBe(false);
  });

  test("a stored value other than the literal 'true' resolves to expanded", () => {
    expect(malformedSeedResolvedExpanded).toBe(true);
  });
});
