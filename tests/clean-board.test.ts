import { beforeAll, describe, expect, test } from "bun:test";

/* The healthy path, which until today could not happen.

   Every board this project has ever rendered carried at least one
   controlHealth error — abandoned cmux panes from finished waves, permanent by
   construction. Closing sixteen of them took the count 17 -> 0, and the strip
   collapsed for the first time to a single line: "1 shipping · 52 done this
   hour · 149k tok/min" with an "All clear" chip, and the board opened on Needs
   you at zero.

   That path has therefore never been exercised. These tests pin it, and every
   one of them asserts the clean board AGAINST a broken board in the same test.
   A test that passes on both is worse than nothing here: the whole claim is
   that these two states look different, so an assertion that cannot tell them
   apart is asserting the opposite of what it says. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let M: any;

beforeAll(async () => {
  // @ts-expect-error The dependency-free browser client has no declaration file.
  await import("../src/web/app.js");
  M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
});

const agent = () => ({
  id: "codex:a1",
  provider: "codex",
  sourceSessionId: "a1",
  displayName: "Ridge worker",
  programId: "p1",
  status: "running",
  activity: "working",
  outcome: "healthy",
  controlState: "linked",
  statusReason: "Source activity within 3 minutes.",
  updatedAt: "2026-08-01T09:00:00.000Z",
  tokens: { scope: "latest-turn", provenance: "observed", total: 40_000, contextWindow: 1_000_000 },
  artifacts: [],
  gates: [],
});

/* The board as it actually reads now: one agent shipping, 52 completions in the
   hour, 149k tok/min, no control-plane errors, nothing waiting on a human. */
const cleanBoard = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  generatedAt: "2026-08-01T09:00:00.000Z",
  programs: [{ id: "p1", name: "Ridge", agents: [agent()] }],
  totals: {
    working: 1,
    idle: 0,
    tracked: 1,
    needsYou: 0,
    tokenReporting: 1,
    tokenEligible: 1,
    sourceHealth: { healthy: 4, degraded: 0, absent: 0, total: 4 },
  },
  controlHealth: { cmuxReachable: true, lastCheckedAt: "2026-08-01T09:00:00.000Z", errors: [], staleSources: [] },
  issues: [],
  recentlyResolved: [],
  pulse: {
    /* completionsLastHour is NULL, because that is what the server emits. This
       fixture carried 52 — a figure transcribed from a screenshot before the
       counter was withdrawn — so every assertion built on it described a board
       the product can no longer produce. `windowMs` is present because the
       client reads it to render the burn sublabel and the fixture omitted it. */
    momentum: { working: 1, completionsLastHour: null, completionsProvenance: "not-observable",
      observedWindowMs: 3_600_000, stalled: 0, stalledAgentIds: [], stallThresholdMs: 900_000 },
    burn: { tokensPerMin: 149_000, windowMs: 600_000, costLastHourUsd: 2.4,
      coverage: { reporting: 1, eligible: 1 } },
    activity: { buckets: [{ activeSessions: 1 }, { activeSessions: 2 }] },
  },
  ...overrides,
});

/* The same board with the control plane gone. Identical agents and pulse, so
   any difference below is attributable to health alone. */
const brokenBoard = () => cleanBoard({
  controlHealth: { cmuxReachable: false, lastCheckedAt: "", errors: ["cmux socket refused the connection"], staleSources: [] },
  issues: [{
    id: "system:cmux-control",
    kind: "system",
    severity: "error",
    title: "CMUX control is degraded",
    summary: "Focus and Send cannot route.",
    affectedAgentIds: ["codex:a1"],
  }],
  totals: {
    working: 1, idle: 0, tracked: 1, needsYou: 1, tokenReporting: 1, tokenEligible: 1,
    sourceHealth: { healthy: 3, degraded: 1, absent: 0, total: 4 },
  },
});

const strip = (snap: unknown) => M.pulseStripModel(snap, "live", [], "percent", "");
const cellIds = (snap: unknown) => strip(snap).cells.map((cell: { id: string }) => cell.id).sort();

describe("a clean board reports clear, not empty", () => {
  test("the strip collapses on a clean board and refuses to on a broken one", () => {
    /* Calm is the collapse. Asserted from both sides in one test so a build
       that hard-codes either answer fails: `calm = true` is caught by the
       broken board, `calm = false` by the clean one. */
    expect(strip(cleanBoard()).calm).toBe(true);
    expect(strip(brokenBoard()).calm).toBe(false);
  });

  test("collapsing drops the cells with nothing to say, and only those", () => {
    /* The failure this replaces: four cells reporting absence around one cell
       reporting a fault. On a clean board the counters that would read "0" and
       "nothing wrong" must not render at all — their silence IS the signal —
       while the instruments that have a real reading stay. */
    const clean = cellIds(cleanBoard());
    const broken = cellIds(brokenBoard());

    expect(clean).not.toContain("health");
    expect(clean).toContain("momentum");
    expect(clean).toContain("burn");

    // The broken board is where health earns its place. ("needs-you" was the
    // other cell here; S2-T1 retired it — the header states no count of
    // problems, and those findings live in the notification center now.)
    expect(broken).toContain("health");
    expect(broken).not.toContain("needs-you");
    expect(broken.length).toBeGreaterThan(clean.length);
  });

  test("the verdict is an affirmative all-clear, never a blank or an absence", () => {
    const clean = M.summaryWidgetData("health", cleanBoard(), "live");
    const broken = M.summaryWidgetData("health", brokenBoard(), "live");

    expect(clean.value).toBe("Readings healthy");
    expect(clean.tone).toBe("ok");
    // "No data" and an empty string are the two ways an unexercised healthy
    // path degrades into looking broken.
    expect(clean.value).not.toBe("No data");
    expect(String(clean.value).trim()).not.toBe("");
    expect(clean.value).not.toBe(broken.value);
  });

  /* S2-T1. This asserted that a zero findings COUNT rendered as an answer
     rather than a blank. The claim was right for a card that counted to-dos in
     the header; that card is retired, because the header is confidence and a
     count of to-dos is attention's. The claim it becomes: the finding is still
     reachable, and the empty case still reads as an answer — in the surface
     that owns it. */
  test("zero findings reads as an answer, in the surface that owns findings", () => {
    const calm = M.notificationPanelModel(cleanBoard(), [], Date.now(), M.NOTIFY_DEPS);
    expect(calm.verdict).toBe("All clear");
    expect(calm.count).toBe(0);
    // Not a blank: an all-clear panel shows what the watcher watched.
    expect(calm.proof).not.toBeNull();

    // And it genuinely counts: the broken board moves it.
    const alarmed = M.notificationPanelModel(brokenBoard(), [], Date.now(), M.NOTIFY_DEPS);
    expect(alarmed.verdict).not.toBe("All clear");
    expect(alarmed.watching.length + alarmed.groups.length).toBeGreaterThan(0);
  });

  test("no cell on a clean board reports a missing reading", () => {
    /* "Collapse rather than render empty cells." Anything still rendering must
       have something to show; a cell surviving the collapse while reading
       "No data" is the empty-cell failure wearing the calm line's clothes. */
    for (const cell of strip(cleanBoard()).cells) {
      expect(cell.data.tone).not.toBe("missing");
      expect(cell.data.value).not.toBe("No data");
      expect(String(cell.data.value).trim().length).toBeGreaterThan(0);
    }
  });

  test("the collapsed line renders the board's own numbers, not transcribed ones", () => {
    /* WAS THE PUREST FORM OF THE VACUITY PROBLEM: an assertion about a clean
       board, written from a screenshot taken while the board was busy. It
       pinned momentum.sublabel containing "52" and burn.value === "149k" —
       constants copied from one afternoon, derived from nothing, depended on by
       nothing. It could only ever have been evaluated against the state it was
       not describing.

       Worse, "52" came from `completionsLastHour: 52`, a field the server has
       since stopped emitting entirely. The assertion was green while requiring
       the client to render a figure the product cannot send.

       Now every expectation is DERIVED from the fixture, so changing the
       fixture changes the expectation and neither can drift from the other. */
    const snap = cleanBoard();
    const momentum = M.summaryWidgetData("momentum", snap, "live");
    const burn = M.summaryWidgetData("burn", snap, "live");

    /* The headline is the ATTENTION count now (operator decision 2026-08-06);
       a clean board is asking for nobody, and the working count moved to the
       sub — still the board's own number, not a transcribed one. */
    expect(momentum.value).toBe("0");
    expect(momentum.unit).toContain("need you");
    expect(momentum.sublabel).toContain(String(snap.totals.working) + " shipping");

    /* The burn value is the rate the board carries, abbreviated. Asserted as
       arithmetic on the fixture so a fixture edit cannot leave a stale
       constant behind. */
    expect(burn.value).toBe(`${Math.round(snap.pulse.burn.tokensPerMin / 1_000)}k`);
    expect(burn.tone).toBe("neutral"); // a spend rate has no healthy band to be green in

    /* The sublabel names the window the rate was measured over, read from
       burn.windowMs — the field this fixture used to omit, which meant the
       sublabel path was exercised by nothing at all. */
    expect(String(burn.sublabel)).toContain(`${snap.pulse.burn.windowMs / 60_000}m`);

    // Completions are not-observable: omit the clause rather than printing a
    // number or a "not measured" filler. Shipping is the board's own count.
    expect(String(momentum.sublabel)).toBe(`${snap.totals.working} shipping`);
  });

  test("a clean board raises no findings, and a broken one raises exactly its own", () => {
    expect(strip(cleanBoard()).findings).toEqual([]);
    expect(strip(brokenBoard()).findings.length).toBe(1);
  });
});

describe("calm is a claim about the whole board", () => {
  test("an unreachable control plane blocks the collapse even with zero findings", () => {
    /* The subtle regression: attention count is the obvious calm input, so a
       refactor that keys calm on it alone would collapse a board whose control
       plane is gone. Focus and Send are dead in this state; a single quiet line
       saying "1 shipping" would be a lie of omission. */
    const noFindingsButOffline = cleanBoard({
      controlHealth: { cmuxReachable: false, lastCheckedAt: "", errors: [], staleSources: [] },
    });

    expect(M.attentionSummary(noFindingsButOffline).count).toBe(0);
    expect(strip(noFindingsButOffline).calm).toBe(false);
  });

  test("a stale feed blocks the collapse even when the snapshot itself is clean", () => {
    // Numbers an operator cannot trust must not be presented in the calmest
    // form the UI has.
    expect(M.pulseStripModel(cleanBoard(), "reconnecting", [], "percent", "").calm).toBe(false);
    expect(M.pulseStripModel(cleanBoard(), "offline", [], "percent", "").calm).toBe(false);
  });

  test("an unreadable triage queue blocks the collapse", () => {
    /* A queue that failed to load contributes zero findings exactly like an
       empty one. Collapsing on partial evidence is how the strip would hide
       that it is reasoning without one of its inputs. */
    expect(M.pulseStripModel(cleanBoard(), "live", [], "percent", "queue unreachable").calm).toBe(false);
  });

  test("a context-peak emergency blocks the collapse", () => {
    // An agent about to run out of context is not a calm board, however quiet
    // the rest of it is.
    const nearLimit = cleanBoard({
      programs: [{
        id: "p1",
        name: "Ridge",
        agents: [{ ...agent(), tokens: { scope: "latest-turn", provenance: "observed", total: 950_000, contextWindow: 1_000_000 } }],
      }],
    });

    expect(strip(nearLimit).calm).toBe(false);
  });
});
