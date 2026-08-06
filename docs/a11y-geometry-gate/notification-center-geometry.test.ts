/**
 * The notification panel's BOX, measured by a real browser.
 *
 * ─── Why this file exists, and why it is not the a11y suite ──────────────────
 *
 * A11Y-1 shipped to main and reached a user: at 420px the panel hung 24px off
 * the LEFT edge of the viewport, and because `body { overflow: hidden }` the
 * clipped strip was unreachable — "WAITING ON YOU" read "AITING ON YOU" and the
 * ember rails that mean a person is the blocker were partly off-screen.
 *
 * The guard that landed with the fix greps styles.css for `align-self: stretch`.
 * Three mutations were measured on the live board to see what that actually
 * catches (2026-08-06, 420px viewport):
 *
 *   today                                          panel  32 → 388   ok
 *   A  anchor reverted to align-self:center         panel  48 → 372   ok      ← text guard RED
 *   B  centred anchor + viewport-measured width     panel -24 → 372   CLIPPED ← the shipped defect
 *   C  anchor still stretched, width clamp back     panel  -8 → 388   CLIPPED ← text guard GREEN
 *
 * So the text guard is wrong in both directions: it fires on A, which harms
 * nobody, and it is blind to C, which is the defect arriving by another route.
 * The defect was never "the file lacks a declaration" — it was "the panel's box
 * leaves the window". That is a number, so this measures the number.
 *
 * ─── LOCAL-ONLY. This file MUST be listed in scripts/ci-tests.sh LOCAL_ONLY ──
 *
 * It needs a real CSS layout engine, and nothing in this package has one:
 * devDependencies are @types/bun and typescript, and a DOM shim is not a route —
 * jsdom and happy-dom do not implement layout at all, so getBoundingClientRect
 * returns zeros. Only a browser can answer this, so this file drives the gstack
 * `browse` headless Chromium from ~/.claude/skills/.
 *
 * It FAILS rather than skips when that is missing, deliberately and in line with
 * the rest of the local-only set: a geometry check that passes vacuously because
 * no browser answered is worse than no check, and it would have passed vacuously
 * on the night the defect shipped.
 *
 * Run it:  bun test ./tests/notification-center-geometry.test.ts
 *
 * ⚠ `browse` is one shared daemon per machine. This file navigates it and changes
 *   its viewport. Do not run it while another agent is driving the browser.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..");

/* Project-local build first, then the machine-wide one — the same resolution
   order the /browse skill itself uses. */
const BROWSE = [
  join(REPO, ".claude/skills/gstack/browse/dist/browse"),
  join(homedir(), ".claude/skills/gstack/browse/dist/browse"),
].find((path) => existsSync(path));

/* Widths that matter, and why each one is here rather than a round number:
   360 is the narrowest phone the board is expected on, 420 is where the defect
   was measured, 768 is the tablet breakpoint either side of the 760px rule, and
   1280 is the desktop the panel was designed at. The bug lived at exactly one
   of them, which is the argument for measuring all four. */
const WIDTHS = [360, 420, 768, 1280] as const;

interface Box {
  vw: number;
  panelLeft: number;
  panelRight: number;
  panelWidth: number;
  ledeLeft: number;
  firstRowLeft: number | null;
  docScrollWidth: number;
  docClientWidth: number;
}

let server: ReturnType<typeof Bun.spawn> | null = null;
let base = "";
const boxes = new Map<number, Box>();

function browse(args: string[]): string {
  const run = Bun.spawnSync([BROWSE as string, ...args], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  const out = run.stdout.toString().trim();
  if (run.exitCode !== 0) {
    throw new Error(`browse ${args[0]} failed (${run.exitCode}): ${out}\n${run.stderr.toString().trim()}`);
  }
  return out;
}

/* browse wraps page-derived output in UNTRUSTED markers. This file reads only
   numbers it computed itself from getBoundingClientRect, but the envelope still
   has to come off before JSON.parse. */
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
  const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = probe.port;
  probe.stop(true);
  /* Bun types this as number | undefined. Refusing loudly beats defaulting to a
     fixed port: a silent fallback would be a second lane's 4799 collision. */
  if (typeof port !== "number") throw new Error("could not reserve a port for the test board");
  return port;
}

const MEASURE = `(() => {
  const p = document.getElementById("notifications-panel");
  const d = document.documentElement;
  const r = p.getBoundingClientRect();
  const lede = p.querySelector(".notify-lede, .notify-proof, .notify-eyebrow");
  const row = p.querySelector(".notify-row-open, .notify-quiet");
  const box = (el) => (el ? Math.round(el.getBoundingClientRect().left) : null);
  return JSON.stringify({
    vw: window.innerWidth,
    panelLeft: Math.round(r.left), panelRight: Math.round(r.right), panelWidth: Math.round(r.width),
    ledeLeft: box(lede), firstRowLeft: box(row),
    docScrollWidth: d.scrollWidth, docClientWidth: d.clientWidth,
  });
})()`;

beforeAll(async () => {
  if (!BROWSE) {
    throw new Error(
      "gstack browse is not built, so the panel's geometry cannot be measured. "
      + "This file is a LOCAL gate and fails rather than skipping: a layout check "
      + "that passes because nothing answered is the check that let A11Y-1 ship. "
      + "Build it with: cd ~/.claude/skills/gstack/browse && ./setup",
    );
  }

  /* Its own board on an ephemeral port. Never 4701 (the operator's launchd
     instance) and never a fixed port another lane may have claimed. */
  const port = await freePort();
  base = `http://localhost:${port}`;
  server = Bun.spawn(["bun", "src/server/index.ts"], {
    cwd: REPO,
    env: { ...process.env, MOUNTAIN_PORT: String(port) },
    stdout: "ignore",
    stderr: "ignore",
  });

  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      const res = await fetch(base, { signal: AbortSignal.timeout(1_000) });
      if (res.ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`the test board never answered on ${base}`);
    await Bun.sleep(250);
  }

  /* One navigation and one open per width. The panel is a disclosure, so its box
     does not exist until it is open — measuring the hidden node would measure
     nothing, which is how a geometry check quietly becomes a no-op. */
  for (const width of WIDTHS) {
    browse(["viewport", `${width}x900`]);
    browse(["goto", base]);
    browse(["wait", "#notify-toggle"]);
    browse(["click", "#notify-toggle"]);
    const box = browseJson<Box>(MEASURE);
    if (box.vw !== width) throw new Error(`viewport did not take: asked ${width}, measured ${box.vw}`);
    boxes.set(width, box);
  }
}, 90_000);

afterAll(() => {
  server?.kill();
  /* Leave the shared daemon somewhere harmless rather than parked on a board
     the next agent did not open. */
  try { browse(["viewport", "1280x800"]); } catch { /* daemon already gone */ }
});

describe("the notification panel's box stays inside the window", () => {
  for (const width of WIDTHS) {
    test(`at ${width}px the panel does not hang off either edge`, () => {
      const box = boxes.get(width);
      expect(box).toBeDefined();
      const b = box as Box;

      /* THE assertion. A11Y-1 was panelLeft: -24 at 420px — and unlike an
         overflow to the right, a negative left produces no scrollbar, so the
         clipped strip cannot be reached at all. */
      expect({ width, panelLeft: b.panelLeft }).toEqual({ width, panelLeft: expect.any(Number) });
      expect(b.panelLeft).toBeGreaterThanOrEqual(0);
      expect(b.panelRight).toBeLessThanOrEqual(b.vw);
    });

    test(`at ${width}px no content inside the panel is clipped`, () => {
      const b = boxes.get(width) as Box;
      /* The box can be on-screen while its contents are not — a negative padding
         or a wider inner row would clip the leading character with the panel
         itself measuring clean. Both readings are cheap; take both. */
      expect(b.ledeLeft).toBeGreaterThanOrEqual(0);
      if (b.firstRowLeft !== null) expect(b.firstRowLeft).toBeGreaterThanOrEqual(0);
    });

    test(`at ${width}px the open panel adds no horizontal document scroll`, () => {
      const b = boxes.get(width) as Box;
      expect(b.docScrollWidth).toBeLessThanOrEqual(b.docClientWidth);
    });
  }

  test("the measurement is real — the panel has a box worth asserting about", () => {
    /* The guard on the guard. If the panel were hidden, or the click silently
       failed, every assertion above would pass against a 0×0 rect at the origin
       and this file would be theatre. */
    for (const width of WIDTHS) {
      const b = boxes.get(width) as Box;
      expect({ width, hasWidth: b.panelWidth > 200 }).toEqual({ width, hasWidth: true });
      expect(b.panelRight).toBeGreaterThan(b.panelLeft);
    }
  });
});
