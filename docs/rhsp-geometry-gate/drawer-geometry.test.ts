/**
 * The agent RHSP's real browser geometry.
 *
 * LOCAL ONLY. A fake DOM can prove that the controls exist, but it cannot prove
 * that the three-row shell leaves the feed and footer on screen. This gate
 * starts this checkout on an ephemeral port and asks Chromium for the boxes.
 * It deliberately fails when the browser is unavailable; a zero-geometry pass
 * would recreate the blind spot this gate exists to close.
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
  { width: 390, height: 844, kind: "mobile" },
] as const;

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
  paneDisplay: string;
  panePosition: string;
  pane: Rect;
  head: Rect;
  grid: Rect;
  doc: Rect;
  desk: Rect;
  evidenceSummary: Rect;
  evidenceBody: Rect;
  evidenceSummaryDisplay: string;
  evidenceBodyDisplay: string;
  chatFeedFootPresent: boolean;
  rects: Record<(typeof REQUIRED_SELECTORS)[number], Rect>;
  overflowY: Record<"pane" | "grid" | "doc" | "chat" | "feed" | "desk", string>;
  declaredVerticalOwners: string[];
  bodyOpenOverflowY: string;
  bodyClosedOverflowY: string;
  bodyOpen: boolean;
  disabled: Record<"input" | "send" | "focus" | "interrupt", boolean>;
  docScrollWidth: number;
  docClientWidth: number;
}

let server: ReturnType<typeof Bun.spawn> | null = null;
let base = "";
const measured = new Map<string, Geometry>();
const evidenceOpened = new Map<string, Geometry>();

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

const INJECT_FIXTURE = `(() => {
  const M = globalThis.TheAntHill;
  if (!M) throw new Error("TheAntHill test seam did not load");
  M.stopBoot();
  const now = new Date().toISOString();
  const agent = {
    id: "cursor:rhsp-geometry-quarantine",
    provider: "cursor",
    sourceSessionId: "rhsp-geometry-quarantine",
    displayName: "Quarantined geometry fixture",
    programId: "rhsp-geometry",
    cwd: "/Users/example/shared-folder",
    model: "cursor-agent",
    task: "Prove that transcript and unavailable controls keep separate vertical space inside the RHSP.",
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
  };
  const program = { id: "rhsp-geometry", name: "RHSP Geometry", agents: [agent] };
  M.state.conn = "live";
  M.state.snap = {
    schemaVersion: 1,
    generatedAt: now,
    controlHealth: { cmuxReachable: true, lastCheckedAt: now, errors: [], staleSources: [] },
    totals: { live: 1, tracked: 1, attention: 0, working: 1, idle: 0, history: 0 },
    programs: [program],
  };
  M.state.actions = { loading: false, error: "", available: true, items: [] };
  M.state.pending = new Set();
  M.state.drafts = new Map();
  M.state.feedback = new Map();
  M.state.confirming = null;
  M.state.transcript = {
    agentId: agent.id,
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
  const pane = document.getElementById("inspector");
  if (!pane) throw new Error("#inspector is missing");
  pane.hidden = false;
  pane.textContent = "";
  pane.className = "pane-inspector";
  document.body.classList.add("inspector-open");
  M.renderAgentDrawer(pane, { kind: "agent", agent, program });
  document.querySelector(".app-body")?.scrollIntoView({ block: "start" });
  return JSON.stringify(true);
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
  const evidenceSummary = pane.querySelector(".drawer-evidence-summary");
  const evidenceBody = pane.querySelector(".drawer-evidence-body");
  if (!evidenceSummary || !evidenceBody) throw new Error("evidence disclosure is missing");
  const overflowY = Object.fromEntries(Object.entries(nodes).map(([name, node]) => [name, getComputedStyle(node).overflowY]));
  const declaredVerticalOwners = Object.entries(nodes)
    .filter(([, node]) => ["auto", "scroll"].includes(getComputedStyle(node).overflowY))
    .map(([name]) => name);
  const input = pane.querySelector(".command-composer input");
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
  const rect = (box) => ({ top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height });
  return JSON.stringify({
    width: window.innerWidth,
    height: window.innerHeight,
    paneDisplay: getComputedStyle(pane).display,
    panePosition: getComputedStyle(pane).position,
    pane: rect(r),
    head: rect(h),
    grid: rect(g),
    doc: rect(nodes.doc.getBoundingClientRect()),
    desk: rect(nodes.desk.getBoundingClientRect()),
    evidenceSummary: rect(evidenceSummary.getBoundingClientRect()),
    evidenceBody: rect(evidenceBody.getBoundingClientRect()),
    evidenceSummaryDisplay: getComputedStyle(evidenceSummary).display,
    evidenceBodyDisplay: getComputedStyle(evidenceBody).display,
    chatFeedFootPresent: Boolean(pane.querySelector(".chat-feed-foot")),
    rects,
    overflowY,
    declaredVerticalOwners,
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
       than merely attached. Wait for the document, then let the fixture open
       the pane before any box is measured. */
    browse(["wait", "body"]);
    const appDeadline = Date.now() + 15_000;
    while (!browseJson<boolean>("JSON.stringify(Boolean(globalThis.TheAntHill?.renderAgentDrawer))")) {
      if (Date.now() > appDeadline) throw new Error("TheAntHill test seam did not load in Chromium");
      await Bun.sleep(100);
    }
    browseJson<boolean>(INJECT_FIXTURE);
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
    if (viewport.width === 1_100) {
      browseJson<boolean>(`(() => {
        const toggle = document.querySelector(".drawer-evidence-summary");
        if (!(toggle instanceof HTMLButtonElement)) throw new Error("evidence toggle is not a button");
        toggle.click();
        return JSON.stringify(true);
      })()`);
      const openGeometry = browseJson<Geometry>(MEASURE);
      evidenceOpened.set(key(viewport.width, viewport.height), openGeometry);
      browse(["screenshot", "/tmp/anthill-rhsp-1100x862-evidence-open.png", "--viewport"]);
    }
  }
}, 120_000);

afterAll(async () => {
  if (server?.exitCode === null) {
    server.kill();
    await server.exited;
  }
  try { browse(["viewport", "1280x800"]); } catch { /* shared daemon already stopped */ }
});

describe("the desktop RHSP reserves visible space for transcript and controls", () => {
  for (const viewport of VIEWPORTS.filter(({ kind }) => kind === "desktop")) {
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
        .toBeLessThanOrEqual(g.rects[".drawer-chat"].bottom + 0.5);
      expect(g.grid.bottom).toBeLessThanOrEqual(g.rects[".drawer-controls-strip"].top + 0.5);
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

  test("Evidence follows inspector width: disclosed at 1100 and beside chat at 1357", () => {
    const narrow = measured.get("1100x862") as Geometry;
    expect(narrow.pane.width).toBeLessThan(736);
    expect(Math.abs(narrow.doc.top - narrow.desk.top)).toBeLessThanOrEqual(0.5);
    expect(narrow.desk.width).toBeLessThan(narrow.doc.width);
    expect(narrow.desk.right).toBeLessThanOrEqual(narrow.doc.right + 0.5);
    expect(narrow.rects[".drawer-chat-scroll"].height).toBeGreaterThanOrEqual(96);
    expect(narrow.evidenceSummaryDisplay).not.toBe("none");
    expect(narrow.evidenceBodyDisplay).toBe("none");

    const wide = measured.get("1357x738") as Geometry;
    expect(wide.pane.width).toBeGreaterThan(736);
    expect(wide.doc.right).toBeLessThanOrEqual(wide.desk.left + 0.5);
    expect(Math.abs(wide.doc.top - wide.desk.top)).toBeLessThanOrEqual(0.5);
    expect(wide.evidenceSummaryDisplay).toBe("none");
    expect(wide.evidenceBodyDisplay).not.toBe("none");
    expect(wide.evidenceBody.height).toBeGreaterThan(0);
  });

  test("the narrow Evidence disclosure overlays without reflowing the transcript", () => {
    const closed = measured.get("1100x862") as Geometry;
    const open = evidenceOpened.get("1100x862") as Geometry;
    expect(open.evidenceBodyDisplay).not.toBe("none");
    expect(open.evidenceBody.height).toBeGreaterThan(0);
    expect(open.desk.left).toBeGreaterThanOrEqual(open.doc.left - 0.5);
    expect(open.desk.right).toBeLessThanOrEqual(open.doc.right + 0.5);
    expect(open.desk.top).toBeGreaterThanOrEqual(open.grid.top - 0.5);
    expect(open.desk.bottom).toBeLessThanOrEqual(open.grid.bottom + 0.5);
    expect(Math.abs(open.rects[".drawer-chat-scroll"].height - closed.rects[".drawer-chat-scroll"].height))
      .toBeLessThanOrEqual(0.5);
  });

  test("a loaded chat omits the duplicate count, path, and refresh footer", () => {
    for (const viewport of VIEWPORTS) {
      expect((measured.get(key(viewport.width, viewport.height)) as Geometry).chatFeedFootPresent).toBe(false);
    }
  });
});

describe("the mobile RHSP is a fixed sheet with one drawer-body scroller", () => {
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

  test("390x844 assigns drawer-body scrolling only to .drawer-grid", () => {
    const g = measured.get("390x844") as Geometry;
    expect(g.declaredVerticalOwners).toEqual(["grid"]);
    expect(g.overflowY.grid).toBe("auto");
    expect(g.overflowY.feed).toBe("visible");
    expect(g.overflowY.desk).toBe("visible");
    expect(g.rects[".drawer-chat"].top).toBeLessThanOrEqual(g.rects[".drawer-chat-scroll"].top);
    expect(g.rects[".drawer-chat"].bottom).toBeGreaterThanOrEqual(g.rects[".drawer-chat-scroll"].bottom);
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
