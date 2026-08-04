import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMountainFetch, type MountainAppState } from "../src/server/app";
import { buildSnapshot } from "../src/server/snapshot";
import type { HubSnapshot } from "../src/shared/types";
import type { ArchiveStore, CollectedAgent, CommandRunner } from "../src/server/types";

/* The quiet board, end to end.

   `small-fleet.test.ts` asserts the aggregates directly. This stands the whole
   thing up instead — real snapshot build, real HTTP handler, real JSON over the
   wire, real client render — and reads what an operator would actually see at
   n = 0, 1 and 3.

   The distinction matters because the unit tests check the numbers the server
   computes, and every defect this project has had was a correct number reaching
   a surface that misread it. A median of undefined is fine in a payload and
   reads "NaN" in a cell; a rate of null is honest until something concatenates
   it into a sentence. Only the rendered text shows that.

   Every measurement taken on this project for two days was at 380–441 agents.
   The first person to run it on a fresh machine meets zero, then one, then
   three. */

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
const runner: CommandRunner = { run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }) };
const NOW = new Date("2026-08-02T10:00:00.000Z");

let webRoot = "";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let M: any;

function collected(index: number): CollectedAgent {
  return {
    id: `codex:a${index}`,
    provider: "codex",
    sourceSessionId: `a${index}`,
    displayName: `Worker ${index}`,
    cwd: "/Users/me/project",
    status: "running",
    statusReason: "Source activity within 3 minutes.",
    startedAt: "2026-08-02T09:00:00.000Z",
    updatedAt: "2026-08-02T09:59:00.000Z",
    tokens: { scope: "latest-turn", provenance: "observed", total: 1_000 * index, contextWindow: 1_000_000 },
    artifacts: [],
    gates: [],
  };
}

const fleetOf = (size: number): HubSnapshot =>
  buildSnapshot({
    agents: Array.from({ length: size }, (_, index) => collected(index + 1)),
    surfaces: [],
    archiveStore,
    now: NOW,
  } as never);

/** The real request handler, serving a fleet of the given size. */
function serverFor(size: number) {
  const snapshot = fleetOf(size);
  const state: MountainAppState = {
    get: () => snapshot,
    subscribe: () => () => {},
    refresh: async () => snapshot,
  };
  return createMountainFetch({ state, runner, archiveStore, webRoot });
}

const getJson = async (size: number, path: string) => {
  const response = await serverFor(size)(new Request(`http://127.0.0.1:4701${path}`));
  return { status: response.status, body: await response.json() };
};

/* ---------------------------------------------------------------------------
   A DOM stand-in, so the client can be rendered against the real payload. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeNode(tag: string): any {
  const classes = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const node: any = {
    nodeType: 1, tagName: tag, textContent: "", dataset: {}, attributes: {} as Record<string, string>,
    children: [] as unknown[], parent: null,
    get className() { return [...classes].join(" "); },
    set className(value: string) { classes.clear(); for (const name of String(value).split(/\s+/)) if (name) classes.add(name); },
    classList: {
      add: (...names: string[]) => { for (const name of names) if (name) classes.add(name); },
      remove: (...names: string[]) => { for (const name of names) classes.delete(name); },
      toggle: (name: string, on?: boolean) => { if (on === undefined ? classes.has(name) : !on) classes.delete(name); else classes.add(name); },
      contains: (name: string) => classes.has(name),
    },
    get childNodes() { return node.children; },
    get childElementCount() { return node.children.length; },
    get firstChild() { return node.children[0] ?? null; },
    get nextSibling() { return null; },
    setAttribute(key: string, value: unknown) { (node.attributes as Record<string, string>)[key] = String(value); },
    getAttribute(key: string) { return (node.attributes as Record<string, string>)[key] ?? null; },
    removeAttribute(key: string) { delete (node.attributes as Record<string, string>)[key]; },
    hasAttribute(key: string) { return key in (node.attributes as Record<string, string>); },
    listeners: {}, addEventListener() {},
    append(...kids: unknown[]) {
      for (const kid of kids) {
        if (kid == null) continue;
        node.children.push(typeof kid === "string" ? { nodeType: 3, textContent: kid } : kid);
      }
    },
    appendChild(kid: unknown) { node.append(kid); return kid; },
    remove() {}, replaceChildren(...kids: unknown[]) { node.children = []; node.append(...kids); },
    closest: () => null, focus() {}, select() {}, scrollIntoView() {},
    querySelectorAll: () => [] as unknown[], querySelector: () => null,
  };
  return node;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const textOf = (node: any): string =>
  node?.nodeType === 3 ? String(node.textContent ?? "") : (node?.children ?? []).map(textOf).join(" ");

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), "anthill-e2e-"));
  webRoot = join(root, "web");
  mkdirSync(webRoot, { recursive: true });
  writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>Ant Hill</title>");

  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => makeNode(tag),
    createElementNS: (_ns: string, tag: string) => makeNode(tag),
    createTextNode: (text: string) => ({ nodeType: 3, textContent: String(text) }),
    getElementById: () => makeNode("div"),
    querySelectorAll: () => [] as unknown[], querySelector: () => null,
  };
  // @ts-expect-error The dependency-free browser client has no declaration file.
  await import("../src/web/app.js");
  M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
});

/* Everything the summary band would paint, as the operator would read it.

   THE `?? ""` USED TO BE HERE, AND IT DISARMED THE WHOLE FILE. Four assertions
   below check this string against BROKEN_NUMBER, which looks for "undefined"
   among other escaped computations — and `String(value ?? "")` turns an
   undefined value into an empty string BEFORE the regex ever sees it. The
   helper defended the product against the exact fault the assertions were
   hunting. Verified by mutation: making a rendered cell value undefined
   survived this file untouched.

   Stringifying without the fallback is the fix. `String(undefined)` is
   "undefined", which is what an operator would actually read on the band. */
function bandText(snapshot: HubSnapshot): string {
  const model = M.pulseStripModel(snapshot, "live", [], "percent", "");
  const parts: string[] = [];
  for (const cell of model.cells) {
    parts.push(String(cell.data.value), String(cell.data.unit ?? ""), String(cell.data.sublabel ?? ""));
  }
  for (const id of ["health", "needs-you", "momentum", "burn", "context-peak"]) {
    const data = M.summaryWidgetData(id, snapshot, "live");
    parts.push(String(data.value), String(data.unit ?? ""), String(data.sublabel ?? ""));
  }
  return parts.join(" ");
}

/* The strings that mean a computation escaped. Deliberately matched as whole
   words so a legitimate "not reported" or a session id containing "nan" does
   not trip them. */
const BROKEN_NUMBER = /\b(NaN|Infinity|-Infinity|undefined|\[object Object\])\b/;

describe("the board a new operator meets, rendered", () => {
  test.each([0, 1, 3])("the snapshot endpoint answers at %i agents", async (size) => {
    const { status, body } = await getJson(size, "/api/snapshot");

    expect(status).toBe(200);
    expect(body.schemaVersion).toBe(1);
    expect(body.totals.tracked).toBe(size);
  });

  test.each([0, 1, 3])("no rendered figure reads as a broken computation at %i agents", (size) => {
    /* The end-to-end form of the small-n check. A median of undefined is
       harmless in a payload and reads "NaN" in a cell; a null rate is honest
       until something concatenates it into a sentence. */
    const rendered = bandText(fleetOf(size));

    expect(rendered).not.toMatch(BROKEN_NUMBER);
  });

  test.each([0, 1, 3])("no percentage is rendered on an empty denominator at %i agents", (size) => {
    /* A percentage needs something to be a percentage OF. "NaN%" and
       "Infinity%" are the two ways that surfaces; "0/0 reporting" is the third,
       and reads as a coverage claim over nobody. */
    const rendered = bandText(fleetOf(size));

    expect(rendered).not.toMatch(/(NaN|Infinity)\s*%/);
    expect(rendered).not.toContain("0/0");
  });

  test.each([0, 1, 3])("no rate claims a window it cannot fill at %i agents", (size) => {
    /* On a fresh board there is no window to divide by, so a rate must be
       absent rather than zero — and must not be described as covering an hour
       it has not watched. */
    const burn = M.summaryWidgetData("burn", fleetOf(size), "live");

    if (burn.value !== "No data") {
      expect(Number.isFinite(Number(String(burn.value).replace(/[^\d.-]/g, "")))).toBe(true);
    }
    expect(String(burn.sublabel)).not.toMatch(BROKEN_NUMBER);
  });

  test("the band renders something, so a blank one cannot pass the broken-number check", () => {
    /* The companion the BROKEN_NUMBER assertions always needed. A negative
       assertion is satisfied by an empty string, so a band that painted nothing
       at all would clear every one of them. Asserting the band has content is
       what makes those four negatives mean something. */
    for (const size of [0, 1, 3]) {
      const text = bandText(fleetOf(size));
      expect(text.trim().length, `the band painted nothing at ${size} agents`).toBeGreaterThan(0);
      expect(text, `the band painted nothing readable at ${size} agents`).toMatch(/[A-Za-z0-9]/);
    }
  });

  test("an empty board says it is empty, in words, and claims nothing else", () => {
    /* n = 0 is first run. The band must read as a board with nothing on it
       rather than a board that failed to load — and must not report a burn, a
       peak or a median it has no basis for. */
    const empty = fleetOf(0);
    const rendered = bandText(empty);

    expect(rendered).not.toMatch(BROKEN_NUMBER);
    expect(empty.totals.tokens).toBeUndefined();
    expect(empty.totals.tokenMedian).toBeUndefined();
    expect(empty.contextPeak).toBeUndefined();
  });

  test("one agent reads as one agent, not as an average of one", () => {
    // n = 1 is the state right after a new operator starts something. Totals
    // and medians collapse onto the single value, which is correct and must not
    // render as a spread.
    const single = fleetOf(1);

    expect(single.totals.tracked).toBe(1);
    expect(single.totals.tokens).toBe(1_000);
    expect(single.totals.tokenMedian).toBe(1_000);
    expect(bandText(single)).not.toMatch(BROKEN_NUMBER);
  });

  test("three agents aggregate without inventing a fourth", () => {
    const trio = fleetOf(3);

    expect(trio.totals.tracked).toBe(3);
    expect(trio.totals.tokens).toBe(6_000);
    expect(trio.programs.flatMap(({ agents }) => agents)).toHaveLength(3);
    expect(bandText(trio)).not.toMatch(BROKEN_NUMBER);
  });

  test("the health endpoint answers healthy on an empty board", async () => {
    /* Liveness monitoring runs before any agent exists, so a probe that divided
       by the fleet size would fail exactly at install time. It does not: an
       empty board is healthy.

       This is the one test in the file that cannot use the frozen NOW the
       aggregates need. /api/health is a STALENESS verdict, so a fixture dated
       in the past is stale by construction — an earlier draft asserted 200
       against the frozen clock, got 503, and would have been reported as an
       n = 0 defect. It was the fixture being 1.9 hours old. */
    const snapshot = buildSnapshot({ agents: [], surfaces: [], archiveStore, now: new Date() } as never);
    const fetch = createMountainFetch({
      state: { get: () => snapshot, subscribe: () => () => {}, refresh: async () => snapshot },
      runner, archiveStore, webRoot,
    });
    const response = await fetch(new Request("http://127.0.0.1:4701/api/health"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.verdict).toBe("healthy");
    expect(JSON.stringify(body)).not.toMatch(BROKEN_NUMBER);
  });

  test("a stale board is reported stale whether or not it has agents", async () => {
    /* The control for the test above, and the reason its clock differs. An
       empty board must not be able to hide staleness behind having nothing to
       show. */
    for (const size of [0, 3]) {
      const response = await serverFor(size)(new Request("http://127.0.0.1:4701/api/health"));

      expect(response.status).toBe(503);
      expect((await response.json()).verdict).toBe("stale");
    }
  });

  test("the detector never gets to fire on a board with nobody on it", () => {
    // Every attention surface must be empty rather than absent-and-erroring.
    const empty = fleetOf(0);

    expect(M.issuesOf(empty)).toEqual([]);
    expect(M.attentionSummary(empty).count).toBe(0);
    expect(M.pulseStripModel(empty, "live", [], "percent", "").findings).toEqual([]);
  });
});
