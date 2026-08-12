/**
 * The agent RHSP's real browser geometry.
 *
 * LOCAL ONLY. A fake DOM can prove that the controls exist, but it cannot prove
 * that the three-row shell leaves the feed and footer on screen. This gate
 * starts this checkout on an ephemeral port and asks Chromium for the boxes.
 * It deliberately fails when the browser is unavailable; a zero-geometry pass
 * would recreate the blind spot this gate exists to close.
 *
 * Height ownership: when the desktop RHSP is open, its available viewport
 * height establishes the expanded band's baseline. A quiet left workboard must
 * stretch to that baseline with negative space inside its border; a tall left
 * list may grow the document while the sticky RHSP keeps its height.
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

const VIEWPORTS = [
  { width: 1_100, height: 862, kind: "desktop" },
  { width: 1_357, height: 738, kind: "desktop" },
  { width: 1_530, height: 862, kind: "desktop" },
  { width: 1_920, height: 1_080, kind: "desktop" },
  { width: 390, height: 844, kind: "mobile" },
] as const;

const DESKTOP_VIEWPORTS = VIEWPORTS.filter(({ kind }) => kind === "desktop");
const TALL_AGENT_COUNT = 24;

const REQUIRED_SELECTORS = [
  ".drawer-chat",
  ".drawer-chat-scroll",
  ".drawer-controls-strip",
  ".command-composer",
] as const;

interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

interface Geometry {
  width: number;
  height: number;
  scrollY: number;
  scrollHeight: number;
  viewportHeight: number;
  paneDisplay: string;
  panePosition: string;
  paneHeightCss: string;
  paneAlignSelf: string;
  appBodyAlignItems: string;
  opsStageAlignSelf: string;
  appBody: Rect;
  opsStage: Rect;
  paneList: Rect;
  programs: Rect;
  leftContentBottom: number;
  pane: Rect;
  head: Rect;
  grid: Rect;
  doc: Rect;
  desk: Rect;
  firstChatMessage: Rect;
  modeSwitch: Rect;
  evidenceBody: Rect;
  modeSwitchDisplay: string;
  evidenceBodyDisplay: string;
  docDisplay: string;
  chatFeedFootPresent: boolean;
  rects: Record<(typeof REQUIRED_SELECTORS)[number], Rect>;
  overflowY: Record<"pane" | "grid" | "doc" | "chat" | "feed" | "desk" | "paneList" | "opsStage", string>;
  declaredVerticalOwners: string[];
  zIndex: Record<"desk" | "dock", string>;
  bodyOpenOverflowY: string;
  bodyClosedOverflowY: string;
  bodyOpen: boolean;
  disabled: Record<"input" | "send" | "focus" | "interrupt", boolean>;
  docScrollWidth: number;
  docClientWidth: number;
}

interface SiblingGeometry {
  width: number;
  height: number;
  scrollY: number;
  scrollHeight: number;
  viewportHeight: number;
  bodyOpen: boolean;
  appBodyAlignItems: string;
  opsStageAlignSelf: string;
  panePosition: string;
  paneHeightCss: string;
  paneAlignSelf: string;
  appBody: Rect;
  opsStage: Rect;
  paneList: Rect;
  programs: Rect;
  leftContentBottom: number;
  pane: Rect | null;
  composer: Rect | null;
  overflowY: Record<"paneList" | "opsStage", string>;
  docScrollWidth: number;
  docClientWidth: number;
}

let server: ReturnType<typeof Bun.spawn> | null = null;
let base = "";
const measured = new Map<string, Geometry>();
const evidenceOpened = new Map<string, Geometry>();
const quietOpen = new Map<string, SiblingGeometry>();
const quietClosed = new Map<string, SiblingGeometry>();
const tallOpen = new Map<string, SiblingGeometry>();
const tallScrolled = new Map<number, SiblingGeometry>();

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
  if (typeof port !== "number") throw new Error("could not reserve an ephemeral RHSP test port");
  return port;
}

function withinPx(a: number, b: number, tol = 1): void {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
}

const INJECT_POPULATION = `(agentCount, openFirst) => {
  const M = globalThis.TheAntHill;
  if (!M) throw new Error("TheAntHill test seam did not load");
  M.stopBoot();
  const now = new Date().toISOString();
  const makeAgent = (index) => ({
    id: "cursor:rhsp-geometry-" + index,
    provider: "cursor",
    sourceSessionId: "rhsp-geometry-" + index,
    displayName: index === 0
      ? "Quarantined geometry fixture"
      : ("Geometry row " + index),
    programId: "rhsp-geometry",
    cwd: "/Users/example/shared-folder",
    model: "cursor-agent",
    task: "Prove left/right height ownership beside the RHSP.",
    status: "running",
    statusReason: "Streaming output.",
    lifecycle: "working",
    scope: "observed",
    updatedAt: now,
    tokens: { provenance: "observed", total: 1200, sessionTotal: 1800, contextWindow: 128000 },
    artifacts: [],
    gates: [],
    controlState: "quarantined",
    identityTrace: {
      resolution: "ambiguous",
      reason: "4 active sources share this cwd; cwd fallback requires exactly one and controls are disabled.",
      steps: [
        { tier: "recorded", outcome: "skipped", detail: "No recorded target." },
        { tier: "session", outcome: "no-match", detail: "No exact session match." },
        { tier: "cwd", outcome: "ambiguous", detail: "4 active sources share this cwd." },
      ],
    },
    controls: [
      { action: "focus", enabled: false, reason: "Shared cwd is not identity." },
      { action: "instruct", enabled: false, reason: "Shared cwd is not identity." },
      { action: "interrupt", enabled: false, reason: "Shared cwd is not identity." },
    ],
  });
  const agents = Array.from({ length: agentCount }, (_, index) => makeAgent(index));
  const program = { id: "rhsp-geometry", name: "RHSP Geometry", agents };
  const first = agents[0];
  M.state.conn = "live";
  M.state.view = "board";
  M.state.actions = { loading: false, error: "", available: true, items: [] };
  M.state.pending = new Set();
  M.state.drafts = new Map();
  M.state.feedback = new Map();
  M.state.confirming = null;
  M.state.evidenceOpen = false;
  if (openFirst) {
    M.state.selected = { kind: "agent", id: first.id };
    M.state.selectedId = first.id;
    M.state.transcript = {
      agentId: first.id,
      loading: false,
      error: "",
      limit: 200,
      data: {
        source: "/tmp/rhsp-geometry.jsonl",
        truncated: false,
        lines: [
          { at: now, role: "user", text: "Why are the controls unavailable?" },
          { at: now, role: "assistant", text: "This session shares a folder with four active sources, so cwd alone cannot authorize a route." },
          { at: now, role: "user", text: "Keep the explanation and controls visible while preserving the transcript." },
          { at: now, role: "assistant", text: "The pane reserves distinct rows for header, content, and controls footer." },
        ],
      },
    };
  } else {
    M.state.selected = null;
    M.state.selectedId = null;
    M.state.transcript = { agentId: "", loading: false, error: "", limit: 200, data: null };
  }
  M.applySnapshot({
    schemaVersion: 1,
    generatedAt: now,
    controlHealth: { cmuxReachable: true, lastCheckedAt: now, errors: [], staleSources: [] },
    totals: {
      live: agentCount,
      tracked: agentCount,
      attention: 0,
      working: agentCount,
      idle: 0,
      history: 0,
    },
    programs: [program],
  });
  /* Preserve the established compact-height fixture, but measure 1080p-class
     viewports at the actual top of the document. Scrolling every fixture here
     masked the footer-below-fold bug this gate now owns. */
  if (innerHeight < 800) document.querySelector(".app-body")?.scrollIntoView({ block: "start" });
  return true;
}`;

const INJECT_QUIET_OPEN = `(() => {
  const inject = ${INJECT_POPULATION};
  return JSON.stringify(inject(1, true));
})()`;

const INJECT_QUIET_CLOSED = `(() => {
  const inject = ${INJECT_POPULATION};
  return JSON.stringify(inject(1, false));
})()`;

const INJECT_TALL_OPEN = `(() => {
  const inject = ${INJECT_POPULATION};
  return JSON.stringify(inject(${TALL_AGENT_COUNT}, true));
})()`;

const MEASURE = `(() => {
  const required = ${JSON.stringify(REQUIRED_SELECTORS)};
  const pane = document.querySelector(".pane-inspector.dw-agent");
  if (!pane || pane.hidden) throw new Error("agent pane is missing or hidden");
  const pick = (selector) => {
    const node = document.querySelector(selector);
    if (!node) throw new Error("missing selector " + selector);
    const r = node.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
  };
  const rect = (box) => ({ top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height });
  const rects = Object.fromEntries(required.map((selector) => [selector, pick(selector)]));
  const nodes = {
    pane,
    grid: pane.querySelector(":scope > .drawer-grid"),
    doc: pane.querySelector(".drawer-doc"),
    chat: pane.querySelector(".drawer-chat"),
    feed: pane.querySelector(".drawer-chat-scroll"),
    desk: pane.querySelector(".drawer-desk"),
  };
  for (const [name, node] of Object.entries(nodes)) if (!node) throw new Error("missing " + name);
  const modeSwitch = pane.querySelector(".drawer-mode-switch");
  const evidenceBody = pane.querySelector(".drawer-evidence-body");
  const firstChatMessage = pane.querySelector(".chat-msg");
  const dock = pane.querySelector(".drawer-controls-strip");
  if (!modeSwitch || !evidenceBody || !firstChatMessage || !dock) {
    throw new Error("chat or evidence mode is missing");
  }
  const appBody = document.querySelector(".app-body");
  const opsStage = document.querySelector(".ops-stage");
  const paneList = document.querySelector(".pane-list");
  const programs = document.getElementById("programs");
  if (!appBody || !opsStage || !paneList || !programs) throw new Error("left workspace selectors missing");
  /* Natural closing edge = bottom of pane-list's own content children. When the
     stage is content-sized this sits at the stage bottom; when the open grid
     stretches the stage, unused height appears between this edge and the border. */
  const leftContentBottom = Math.max(
    ...[...paneList.children].map((node) => node.getBoundingClientRect().bottom),
    programs.getBoundingClientRect().bottom,
  );
  const overflowY = Object.fromEntries([
    ...Object.entries(nodes).map(([name, node]) => [name, getComputedStyle(node).overflowY]),
    ["paneList", getComputedStyle(paneList).overflowY],
    ["opsStage", getComputedStyle(opsStage).overflowY],
  ]);
  const declaredVerticalOwners = Object.entries(nodes)
    .filter(([, node]) => ["auto", "scroll"].includes(getComputedStyle(node).overflowY))
    .map(([name]) => name);
  const input = pane.querySelector(".command-composer :is(input, textarea)");
  const buttons = {
    send: pane.querySelector('[data-fkey$=":instruct"]'),
    focus: pane.querySelector('[data-fkey$=":focus"]'),
    interrupt: pane.querySelector('[data-fkey$=":interrupt"]'),
  };
  if (!input || Object.values(buttons).some((button) => !button)) throw new Error("unavailable controls are missing");
  const bodyOpenOverflowY = getComputedStyle(document.body).overflowY;
  document.body.classList.remove("inspector-open");
  const bodyClosedOverflowY = getComputedStyle(document.body).overflowY;
  document.body.classList.add("inspector-open");
  const r = pane.getBoundingClientRect();
  const h = pane.querySelector(":scope > .drawer-shell-head").getBoundingClientRect();
  const g = nodes.grid.getBoundingClientRect();
  const paneStyle = getComputedStyle(pane);
  return JSON.stringify({
    width: window.innerWidth,
    height: window.innerHeight,
    scrollY: window.scrollY,
    scrollHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
    paneDisplay: paneStyle.display,
    panePosition: paneStyle.position,
    paneHeightCss: paneStyle.height,
    paneAlignSelf: paneStyle.alignSelf,
    appBodyAlignItems: getComputedStyle(appBody).alignItems,
    opsStageAlignSelf: getComputedStyle(opsStage).alignSelf,
    appBody: rect(appBody.getBoundingClientRect()),
    opsStage: rect(opsStage.getBoundingClientRect()),
    paneList: rect(paneList.getBoundingClientRect()),
    programs: rect(programs.getBoundingClientRect()),
    leftContentBottom,
    pane: rect(r),
    head: rect(h),
    grid: rect(g),
    doc: rect(nodes.doc.getBoundingClientRect()),
    desk: rect(nodes.desk.getBoundingClientRect()),
    firstChatMessage: rect(firstChatMessage.getBoundingClientRect()),
    modeSwitch: rect(modeSwitch.getBoundingClientRect()),
    evidenceBody: rect(evidenceBody.getBoundingClientRect()),
    modeSwitchDisplay: getComputedStyle(modeSwitch).display,
    evidenceBodyDisplay: getComputedStyle(nodes.desk).display,
    docDisplay: getComputedStyle(nodes.doc).display,
    chatFeedFootPresent: Boolean(pane.querySelector(".chat-feed-foot")),
    rects,
    overflowY,
    declaredVerticalOwners,
    zIndex: {
      desk: getComputedStyle(nodes.desk).zIndex,
      dock: getComputedStyle(dock).zIndex,
    },
    bodyOpenOverflowY,
    bodyClosedOverflowY,
    bodyOpen: document.body.classList.contains("inspector-open"),
    disabled: {
      input: input.disabled,
      send: buttons.send.disabled,
      focus: buttons.focus.disabled,
      interrupt: buttons.interrupt.disabled,
    },
    docScrollWidth: document.documentElement.scrollWidth,
    docClientWidth: document.documentElement.clientWidth,
  });
})()`;

const MEASURE_SIBLINGS = `(() => {
  const rect = (box) => ({ top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height });
  const appBody = document.querySelector(".app-body");
  const opsStage = document.querySelector(".ops-stage");
  const paneList = document.querySelector(".pane-list");
  const programs = document.getElementById("programs");
  if (!appBody || !opsStage || !paneList || !programs) throw new Error("left workspace selectors missing");
  const pane = document.querySelector(".pane-inspector.dw-agent");
  const paneOpen = Boolean(pane && !pane.hidden);
  const composer = paneOpen ? pane.querySelector(".command-composer") : null;
  const leftContentBottom = Math.max(
    ...[...paneList.children].map((node) => node.getBoundingClientRect().bottom),
    programs.getBoundingClientRect().bottom,
  );
  const paneStyle = paneOpen ? getComputedStyle(pane) : null;
  return JSON.stringify({
    width: window.innerWidth,
    height: window.innerHeight,
    scrollY: window.scrollY,
    scrollHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
    bodyOpen: document.body.classList.contains("inspector-open"),
    appBodyAlignItems: getComputedStyle(appBody).alignItems,
    opsStageAlignSelf: getComputedStyle(opsStage).alignSelf,
    panePosition: paneStyle ? paneStyle.position : "",
    paneHeightCss: paneStyle ? paneStyle.height : "",
    paneAlignSelf: paneStyle ? paneStyle.alignSelf : "",
    appBody: rect(appBody.getBoundingClientRect()),
    opsStage: rect(opsStage.getBoundingClientRect()),
    paneList: rect(paneList.getBoundingClientRect()),
    programs: rect(programs.getBoundingClientRect()),
    leftContentBottom,
    pane: paneOpen ? rect(pane.getBoundingClientRect()) : null,
    composer: composer ? rect(composer.getBoundingClientRect()) : null,
    overflowY: {
      paneList: getComputedStyle(paneList).overflowY,
      opsStage: getComputedStyle(opsStage).overflowY,
    },
    docScrollWidth: document.documentElement.scrollWidth,
    docClientWidth: document.documentElement.clientWidth,
  });
})()`;

function expectNonZeroAndContained(rect: Rect, pane: Rect, width: number, height: number): void {
  expect(rect.width).toBeGreaterThan(0);
  expect(rect.height).toBeGreaterThan(0);
  expect(rect.top).toBeGreaterThanOrEqual(pane.top - 0.5);
  expect(rect.bottom).toBeLessThanOrEqual(pane.bottom + 0.5);
  expect(rect.left).toBeGreaterThanOrEqual(pane.left - 0.5);
  expect(rect.right).toBeLessThanOrEqual(pane.right + 0.5);
  expect(rect.top).toBeGreaterThanOrEqual(-0.5);
  expect(rect.bottom).toBeLessThanOrEqual(height + 0.5);
  expect(rect.left).toBeGreaterThanOrEqual(-0.5);
  expect(rect.right).toBeLessThanOrEqual(width + 0.5);
}

function toSibling(geometry: Geometry): SiblingGeometry {
  return {
    width: geometry.width,
    height: geometry.height,
    scrollY: geometry.scrollY,
    scrollHeight: geometry.scrollHeight,
    viewportHeight: geometry.viewportHeight,
    bodyOpen: geometry.bodyOpen,
    appBodyAlignItems: geometry.appBodyAlignItems,
    opsStageAlignSelf: geometry.opsStageAlignSelf,
    panePosition: geometry.panePosition,
    paneHeightCss: geometry.paneHeightCss,
    paneAlignSelf: geometry.paneAlignSelf,
    appBody: geometry.appBody,
    opsStage: geometry.opsStage,
    paneList: geometry.paneList,
    programs: geometry.programs,
    leftContentBottom: geometry.leftContentBottom,
    pane: geometry.pane,
    composer: geometry.rects[".command-composer"],
    overflowY: {
      paneList: geometry.overflowY.paneList,
      opsStage: geometry.overflowY.opsStage,
    },
    docScrollWidth: geometry.docScrollWidth,
    docClientWidth: geometry.docClientWidth,
  };
}

async function waitForAppReady(): Promise<void> {
  browse(["wait", "body"]);
  const appDeadline = Date.now() + 60_000;
  while (!browseJson<boolean>(
    "JSON.stringify(Boolean(globalThis.TheAntHill?.renderAgentDrawer && globalThis.TheAntHill?.applySnapshot && globalThis.TheAntHill?.state?.snap))",
  )) {
    if (Date.now() > appDeadline) {
      throw new Error("TheAntHill test seam and initial snapshot did not load in Chromium");
    }
    await Bun.sleep(100);
  }
}

beforeAll(async () => {
  if (!BROWSE) {
    throw new Error(
      "UNAVAILABLE: gstack browse is not built, so Chromium cannot measure RHSP geometry. "
      + "Build the local browser boundary; never replace this gate with fake DOM rectangles.",
    );
  }

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = Bun.spawn(["bun", "src/server/index.ts"], {
    cwd: REPO,
    env: { ...process.env, MOUNTAIN_PORT: String(port), ANT_HILL_TASK_REFINER_DISABLED: "1" },
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
        `the isolated RHSP server never answered on ${base} (exit ${server.exitCode ?? "unknown"})`
        + `\n${stdout.trim()}\n${stderr.trim()}`,
      );
    }
    await Bun.sleep(250);
  }

  for (const viewport of VIEWPORTS) {
    browse(["viewport", `${viewport.width}x${viewport.height}`]);
    browse(["goto", base]);
    /* #inspector starts with [hidden], and browse wait means visible rather
       than merely attached. Let boot's initial snapshot settle too: stopBoot()
       closes timers and the stream, but an already-started fetch could otherwise
       repaint over the fixture after it opens the pane. */
    await waitForAppReady();
    browseJson<boolean>(INJECT_QUIET_OPEN);
    /* Measure the settled sheet, not the translateY(18px) entry frame. The
       longest drawer animation is 260ms at the mobile breakpoint. */
    await Bun.sleep(350);
    const geometry = browseJson<Geometry>(MEASURE);
    if (geometry.width !== viewport.width || geometry.height !== viewport.height) {
      throw new Error(
        `viewport did not take: asked ${viewport.width}x${viewport.height}, `
        + `measured ${geometry.width}x${geometry.height}`,
      );
    }
    for (const selector of REQUIRED_SELECTORS) {
      const rect = geometry.rects[selector];
      if (rect.width <= 0 || rect.height <= 0) {
        throw new Error(`${viewport.width}x${viewport.height} measured ${selector} at ${rect.width}x${rect.height}`);
      }
    }
    measured.set(key(viewport.width, viewport.height), geometry);
    console.log(`[RHSP geometry ${viewport.width}x${viewport.height}] ${JSON.stringify(geometry)}`);
    browse(["screenshot", `/tmp/anthill-rhsp-${viewport.width}x${viewport.height}.png`, "--viewport"]);

    if (viewport.kind === "desktop") {
      quietOpen.set(key(viewport.width, viewport.height), toSibling(geometry));
      browseJson<boolean>(INJECT_QUIET_CLOSED);
      await Bun.sleep(200);
      const closed = browseJson<SiblingGeometry>(MEASURE_SIBLINGS);
      quietClosed.set(key(viewport.width, viewport.height), closed);
      console.log(`[RHSP siblings quiet-closed ${viewport.width}x${viewport.height}] ${JSON.stringify(closed)}`);
    }

    if (viewport.width === 1_357 && viewport.height === 738) {
      browseJson<boolean>(INJECT_TALL_OPEN);
      await Bun.sleep(350);
      const tall = browseJson<SiblingGeometry>(MEASURE_SIBLINGS);
      tallOpen.set(key(viewport.width, viewport.height), tall);
      console.log(`[RHSP siblings tall-open ${viewport.width}x${viewport.height}] ${JSON.stringify(tall)}`);
      /* Restore quiet-open for the evidence-mode measurement path. */
      browseJson<boolean>(INJECT_QUIET_OPEN);
      await Bun.sleep(350);
    }

    if (viewport.width === 1_920 && viewport.height === 1_080) {
      browseJson<boolean>(INJECT_TALL_OPEN);
      await Bun.sleep(350);
      for (const scrollY of [0, 100, 225, 600]) {
        browseJson<number>(`JSON.stringify((window.scrollTo(0, ${scrollY}), window.scrollY))`);
        await Bun.sleep(50);
        const tall = browseJson<SiblingGeometry>(MEASURE_SIBLINGS);
        tallScrolled.set(scrollY, tall);
        console.log(`[RHSP siblings tall-scrolled 1920x1080 @ ${scrollY}] ${JSON.stringify(tall)}`);
      }
    }

    if (viewport.width === 1_100) {
      /* quiet-closed above hid the pane; reopen before switching to Evidence. */
      browseJson<boolean>(INJECT_QUIET_OPEN);
      await Bun.sleep(350);
      browseJson<boolean>(`(() => {
        const toggle = document.querySelector('[data-fkey$=":evidence"]');
        if (!(toggle instanceof HTMLButtonElement)) throw new Error("evidence mode is not a button");
        toggle.click();
        return JSON.stringify(true);
      })()`);
      const openGeometry = browseJson<Geometry>(MEASURE);
      evidenceOpened.set(key(viewport.width, viewport.height), openGeometry);
      browse(["screenshot", "/tmp/anthill-rhsp-1100x862-evidence-open.png", "--viewport"]);
    }
  }
}, 180_000);

afterAll(async () => {
  if (server?.exitCode === null) {
    server.kill();
    await server.exited;
  }
  try { browse(["viewport", "1280x800"]); } catch { /* shared daemon already stopped */ }
});

describe("the desktop RHSP reserves visible space for transcript and controls", () => {
  for (const viewport of DESKTOP_VIEWPORTS) {
    test(`${viewport.width}x${viewport.height}: all required boxes are visible and contained`, () => {
      const geometry = measured.get(key(viewport.width, viewport.height));
      expect(geometry).toBeDefined();
      const g = geometry as Geometry;
      expect(g.paneDisplay).not.toBe("none");
      expectNonZeroAndContained(g.pane, g.pane, viewport.width, viewport.height);
      for (const selector of REQUIRED_SELECTORS) {
        expectNonZeroAndContained(g.rects[selector], g.pane, viewport.width, viewport.height);
      }
      expect(g.docScrollWidth).toBeLessThanOrEqual(g.docClientWidth);
    });

    test(`${viewport.width}x${viewport.height}: vertical regions are ordered and do not overlap`, () => {
      const g = measured.get(key(viewport.width, viewport.height)) as Geometry;
      expect(g.head.bottom).toBeLessThanOrEqual(g.grid.top + 0.5);
      expect(g.rects[".drawer-chat-scroll"].bottom)
        .toBeLessThanOrEqual(g.rects[".drawer-controls-strip"].top + 0.5);
      expect(g.rects[".drawer-controls-strip"].bottom)
        .toBeLessThanOrEqual(g.rects[".drawer-chat"].bottom + 0.5);
      expect(Math.abs(g.rects[".drawer-controls-strip"].left - g.rects[".drawer-chat"].left))
        .toBeLessThanOrEqual(1.5);
      expect(Math.abs(g.rects[".drawer-controls-strip"].right - g.rects[".drawer-chat"].right))
        .toBeLessThanOrEqual(1.5);
    });

    test(`${viewport.width}x${viewport.height}: unavailable controls are natively disabled`, () => {
      const g = measured.get(key(viewport.width, viewport.height)) as Geometry;
      expect(g.disabled).toEqual({ input: true, send: true, focus: true, interrupt: true });
    });

    test(`${viewport.width}x${viewport.height}: only feed and evidence own vertical scrolling`, () => {
      const g = measured.get(key(viewport.width, viewport.height)) as Geometry;
      expect(g.declaredVerticalOwners).toEqual(["feed", "desk"]);
      expect(g.overflowY.feed).toBe("auto");
      expect(g.overflowY.desk).toBe("auto");
    });
  }

  test("1357x738 keeps at least 160px of usable transcript feed", () => {
    const g = measured.get("1357x738") as Geometry;
    expect(g.rects[".drawer-chat-scroll"].height).toBeGreaterThanOrEqual(160);
  });

  test("1920x1080 shows the entire pane and composer before page scroll", () => {
    const g = measured.get("1920x1080") as Geometry;
    expect(g.pane.top).toBeGreaterThan(0);
    expect(g.pane.bottom).toBeLessThanOrEqual(g.viewportHeight + 0.5);
    expect(g.rects[".command-composer"].bottom).toBeLessThanOrEqual(g.viewportHeight + 0.5);
  });

  test("Evidence follows inspector width: switched at 1100 and beside chat at 1357", () => {
    const narrow = measured.get("1100x862") as Geometry;
    expect(narrow.pane.width).toBeLessThan(736);
    expect(narrow.rects[".drawer-chat-scroll"].height).toBeGreaterThanOrEqual(96);
    expect(narrow.modeSwitchDisplay).not.toBe("none");
    expect(narrow.docDisplay).not.toBe("none");
    expect(narrow.evidenceBodyDisplay).toBe("none");
    expect(narrow.modeSwitch.bottom).toBeLessThanOrEqual(narrow.firstChatMessage.top + 0.5);

    const wide = measured.get("1357x738") as Geometry;
    expect(wide.pane.width).toBeGreaterThan(736);
    expect(wide.doc.right).toBeLessThanOrEqual(wide.desk.left + 0.5);
    expect(Math.abs(wide.doc.top - wide.desk.top)).toBeLessThanOrEqual(0.5);
    expect(wide.modeSwitchDisplay).toBe("none");
    expect(wide.evidenceBodyDisplay).not.toBe("none");
    expect(wide.desk.width).toBeGreaterThanOrEqual(280);
    expect(wide.desk.width).toBeLessThanOrEqual(320.5);
    expect(wide.evidenceBody.height).toBeGreaterThan(0);
    expect(Math.abs(wide.desk.bottom - wide.rects[".drawer-chat"].bottom)).toBeLessThanOrEqual(0.5);
  });

  test("the narrow Evidence mode replaces Chat in-flow without leaving the grid", () => {
    const open = evidenceOpened.get("1100x862") as Geometry;
    expect(open.evidenceBodyDisplay).not.toBe("none");
    expect(open.docDisplay).toBe("none");
    expect(open.evidenceBody.height).toBeGreaterThan(0);
    expect(open.desk.left).toBeGreaterThanOrEqual(open.grid.left - 0.5);
    expect(open.desk.right).toBeLessThanOrEqual(open.grid.right + 0.5);
    expect(open.desk.top).toBeGreaterThanOrEqual(open.grid.top - 0.5);
    expect(open.desk.bottom).toBeLessThanOrEqual(open.grid.bottom + 0.5);
    expect(open.modeSwitchDisplay).not.toBe("none");
  });

  test("a loaded chat omits the duplicate count, path, and refresh footer", () => {
    for (const viewport of VIEWPORTS) {
      expect((measured.get(key(viewport.width, viewport.height)) as Geometry).chatFeedFootPresent).toBe(false);
    }
  });
});

describe("desktop open RHSP owns the expanded band height", () => {
  for (const viewport of DESKTOP_VIEWPORTS) {
    test(`${viewport.width}x${viewport.height}: quiet open stretches left board to RHSP bottom`, () => {
      const g = quietOpen.get(key(viewport.width, viewport.height));
      expect(g).toBeDefined();
      const s = g as SiblingGeometry;
      expect(s.bodyOpen).toBe(true);
      expect(s.pane).not.toBeNull();
      const pane = s.pane as Rect;
      const viewportGutter = viewport.height >= 800 ? 20 : 0;
      withinPx(s.appBody.height, pane.height + viewportGutter);
      withinPx(s.opsStage.height, pane.height);
      withinPx(s.opsStage.top, pane.top);
      withinPx(s.opsStage.bottom, pane.bottom);
      /* Baseline content-sized stage only has ~80px of list padding below
         #programs; stretched ownership must leave a clear empty band inside
         the border (acceptance: >=80px; threshold 150 defeats padding-only). */
      expect(s.opsStage.bottom - s.leftContentBottom).toBeGreaterThanOrEqual(150);
      expect(s.scrollHeight).toBeGreaterThanOrEqual(s.appBody.height);
      expect(["clip", "hidden"]).toContain(s.overflowY.opsStage);
      expect(["auto", "scroll"]).not.toContain(s.overflowY.paneList);
      expect(s.docScrollWidth).toBeLessThanOrEqual(s.docClientWidth);
    });

    test(`${viewport.width}x${viewport.height}: quiet closed returns content-sized board`, () => {
      const open = quietOpen.get(key(viewport.width, viewport.height)) as SiblingGeometry;
      const closed = quietClosed.get(key(viewport.width, viewport.height));
      expect(closed).toBeDefined();
      const c = closed as SiblingGeometry;
      expect(c.bodyOpen).toBe(false);
      expect(c.pane).toBeNull();
      expect(c.opsStage.height).toBeLessThan(open.pane!.height - 40);
      /* Closed stage wraps the workboard; borders account for ~2px. */
      withinPx(c.opsStage.height, c.paneList.height, 2);
      expect(c.opsStage.height).toBeLessThanOrEqual(c.leftContentBottom - c.opsStage.top + 100);
      expect(c.appBodyAlignItems).toBe("flex-start");
    });
  }

  test("1357x738 tall open grows the document while RHSP keeps viewport height", () => {
    const g = tallOpen.get("1357x738");
    expect(g).toBeDefined();
    const s = g as SiblingGeometry;
    expect(s.bodyOpen).toBe(true);
    expect(s.pane).not.toBeNull();
    const pane = s.pane as Rect;
    expect(s.opsStage.height).toBeGreaterThan(pane.height);
    withinPx(s.appBody.height, s.opsStage.height);
    withinPx(pane.height, s.viewportHeight - 40);
    expect(s.panePosition).toBe("sticky");
    expect(s.scrollHeight).toBeGreaterThan(s.viewportHeight);
    expect(["auto", "scroll"]).not.toContain(s.overflowY.paneList);
    expect(["auto", "scroll"]).not.toContain(s.overflowY.opsStage);
  });

  test("1920x1080 tall open keeps the RHSP bottom anchored while the LHS scrolls", () => {
    const first = tallScrolled.get(0);
    expect(first).toBeDefined();
    expect(first!.composer).not.toBeNull();
    for (const scrollY of [0, 100, 225, 600]) {
      const s = tallScrolled.get(scrollY);
      expect(s).toBeDefined();
      expect(s!.scrollY).toBe(scrollY);
      expect(s!.pane).not.toBeNull();
      expect(s!.composer).not.toBeNull();
      withinPx(s!.pane!.bottom, s!.viewportHeight - 20);
      withinPx(s!.composer!.bottom, first!.composer!.bottom);
      expect(s!.composer!.bottom).toBeLessThanOrEqual(s!.viewportHeight - 20);
    }
  });
});

describe("the mobile RHSP is a fixed sheet with bounded Chat and Evidence modes", () => {
  test("390x844 keeps the fixed pane, header, composer, and footer on screen", () => {
    const g = measured.get("390x844") as Geometry;
    expect(g.panePosition).toBe("fixed");
    expectNonZeroAndContained(g.pane, g.pane, 390, 844);
    expectNonZeroAndContained(g.head, g.pane, 390, 844);
    expectNonZeroAndContained(g.rects[".drawer-controls-strip"], g.pane, 390, 844);
    expectNonZeroAndContained(g.rects[".command-composer"], g.pane, 390, 844);
    expect(g.disabled).toEqual({ input: true, send: true, focus: true, interrupt: true });
    expect(g.docScrollWidth).toBeLessThanOrEqual(g.docClientWidth);
  });

  test("390x844 keeps scrolling inside the chat feed and in-flow Evidence mode", () => {
    const g = measured.get("390x844") as Geometry;
    expect(g.declaredVerticalOwners).toEqual(["feed", "desk"]);
    expect(g.overflowY.grid).toBe("hidden");
    expect(g.overflowY.feed).toBe("auto");
    expect(g.overflowY.desk).toBe("auto");
    expect(g.rects[".drawer-chat"].top).toBeLessThanOrEqual(g.rects[".drawer-chat-scroll"].top);
    expect(g.rects[".drawer-chat"].bottom).toBeGreaterThanOrEqual(g.rects[".drawer-chat-scroll"].bottom);
    expect(g.modeSwitchDisplay).not.toBe("none");
    expect(g.modeSwitch.bottom).toBeLessThanOrEqual(g.rects[".drawer-chat"].top + 0.5);
    expect(Math.abs(g.rects[".drawer-controls-strip"].bottom - g.rects[".drawer-chat"].bottom))
      .toBeLessThanOrEqual(1.5);
  });

  test("390x844 locks the document only while the full sheet is open", () => {
    const g = measured.get("390x844") as Geometry;
    expect(g.bodyOpen).toBe(true);
    /* overflow-x:hidden makes overflow-y:clip compute to hidden in Chromium;
       either computed value is the same no-scroll document lock. */
    expect(["clip", "hidden"]).toContain(g.bodyOpenOverflowY);
    expect(["clip", "hidden"]).not.toContain(g.bodyClosedOverflowY);
  });
});
