import { beforeAll, describe, expect, test } from "bun:test";
import type { AgentSnapshot, HubSnapshot } from "../src/shared/types";

/* Nine ledger entries were filed "blocked — frontend lane unavailable" and
   waited on a lane that could not take work.

   The premise was wrong, and that is the useful part. "Render-layer" got read
   as "needs pixels", but most of these fixes are STRING AND STATE DERIVATION
   that merely lives in src/web. presentation.js, agent-model.js and app.js are
   pure functions over the payload and import cleanly under bun, so the claims
   can be driven and asserted with no browser at all. The lane's own
   web-client.test.ts already works this way; the technique was in the repo the
   whole time.

   What genuinely needs pixels is geometry — whether a stage ends where its
   content ends, whether two elements read as repetition in one viewport. Those
   stay blocked, and stay blocked honestly.

   These are assertions rather than smoke tests: each drives the specific
   function the fix changed and pins the property the fix established, against
   payloads built to make the wrong answer possible. */

interface Client {
  usageCostReading: (summary: unknown) => { value: string; sub: string };
  emptyBoardVerdict: (snap: unknown) => { message: string; hint: string; sources: string | null };
  summaryWidgetData: (id: string, snap: unknown, conn?: string) => { value: string; sublabel: string; unit?: string };
}
interface Presentation {
  controlUnavailableText: (controlState: string, agent?: unknown) => string;
  focusDestinationHint: (agent: unknown) => string;
  focusButtonLabel: (agent: unknown, controlState: string) => string;
  stripSpinnerFrame: (title: string) => string;
}
interface Model {
  deriveControlState: (agent: unknown) => string;
}

let client: Client;
let presentation: Presentation;
let model: Model;

beforeAll(async () => {
  // @ts-expect-error the dependency-free browser client has no declaration file
  await import("../src/web/app.js");
  client = (globalThis as unknown as { TheAntHill: Client }).TheAntHill;
  // @ts-expect-error same
  presentation = await import("../src/web/presentation.js");
  // @ts-expect-error same
  model = await import("../src/web/agent-model.js");
});

const agent = (overrides: Partial<AgentSnapshot> = {}): AgentSnapshot => ({
  id: "codex:alpha",
  provider: "codex",
  sourceSessionId: "alpha",
  displayName: "Alpha",
  programId: "p",
  status: "running",
  statusReason: "Fixture activity.",
  activity: "working",
  outcome: "healthy",
  updatedAt: new Date().toISOString(),
  tokens: { provenance: "unknown" },
  lastHumanMessage: null,
  artifacts: [],
  gates: [],
  target: { resolution: "missing" },
  controls: [],
  ...overrides,
} as AgentSnapshot);

const board = (overrides: Partial<HubSnapshot> = {}): HubSnapshot => ({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  controlHealth: { cmuxReachable: true, lastCheckedAt: new Date().toISOString(), errors: [], staleSources: [] },
  totals: { live: 0, tracked: 0, attention: 0, sourceHealth: { healthy: 4, degraded: 0, absent: 0, total: 4 } },
  programs: [],
  ...overrides,
} as unknown as HubSnapshot);

const FOLDER_MATCHED = {
  surfaceId: "SURFACE-UNCLAIMED",
  resolution: "unique-cwd",
  workspaceTitle: "wave6",
  surfaceCwd: "/Users/me/other-project",
  reason: "Matched one active source to the only unclaimed cmux surface with this exact cwd.",
} as AgentSnapshot["target"];

describe("9493126 — three disabled buttons give three different answers", () => {
  test("archived, dead and unproven each get their own sentence", () => {
    /* The defect was one refusal for every cause. An operator told "controls
       are unavailable" cannot tell a session that ended from one whose pane
       could not be proven, and the second is recoverable while the first is
       not. */
    const archived = presentation.controlUnavailableText("observed-only",
      agent({ lifecycle: "finished", provenance: "operator-archive" } as Partial<AgentSnapshot>));
    const exited = presentation.controlUnavailableText("observed-only",
      agent({ lifecycle: "finished", provenance: "provider-exit" } as Partial<AgentSnapshot>));
    const agedOut = presentation.controlUnavailableText("observed-only",
      agent({ lifecycle: "waiting", scope: "retained", provenance: "aged-out" } as Partial<AgentSnapshot>));
    const dead = presentation.controlUnavailableText("observed-only",
      agent({ lifecycle: "finished", provenance: "process-died", processState: "died", processIds: [4242] } as Partial<AgentSnapshot>));
    const unproven = presentation.controlUnavailableText("unproven", agent({ target: FOLDER_MATCHED }));

    expect(archived).toMatch(/you archived/i);
    expect(exited).toMatch(/session exit/i);
    expect(agedOut).toMatch(/scan window/i);
    expect(dead).toMatch(/process is gone/i);
    expect(unproven).toMatch(/cannot confirm which session/i);
    /* FIVE causes, five sentences. It was three, and one of them — "archived" —
       was doing the work of four: a provider exit, an operator's decision, a
       record that aged out, all told the operator they had archived something
       they may never have touched. */
    expect(new Set([archived, exited, agedOut, dead, unproven]).size).toBe(5);
  });

  test("the unproven refusal says what is off rather than that something broke", () => {
    // "Send is OFF here, not broken, and saying so is what stops the retry."
    const text = presentation.controlUnavailableText("unproven", agent({ target: FOLDER_MATCHED }));

    expect(text).toMatch(/Send and Interrupt are off/i);
    expect(text).not.toMatch(/unavailable/i);
  });
});

describe("78c0041 — a folder-matched pane is its own state, not 'linked'", () => {
  test("unique-cwd derives unproven while exact derives linked", () => {
    /* The server's operatorControlState still calls both "linked". The client
       draws the distinction, and it is what makes the chip stop reading Linked
       beside a Send the server will refuse. */
    expect(model.deriveControlState(agent({ target: FOLDER_MATCHED }))).toBe("unproven");
    expect(model.deriveControlState(agent({ target: { surfaceId: "S1", resolution: "exact" } }))).toBe("linked");
  });

  test("an ambiguous target is quarantined, so unproven is not a catch-all", () => {
    // Without this, "unproven" would absorb every non-exact resolution and stop
    // meaning "matched by folder" specifically.
    expect(model.deriveControlState(agent({ target: { surfaceId: "S1", resolution: "ambiguous" } })))
      .toBe("quarantined");
  });
});

describe("aaaf323 + d55600d — Focus names the terminal it is about to open", () => {
  test("the hint names the destination, not the row", () => {
    /* The rotation case. A folder-matched row may say ALPHA while the pane is
       BRAVO's, so naming the DESTINATION is what makes the mismatch visible. */
    expect(presentation.focusDestinationHint(agent({ target: FOLDER_MATCHED })))
      .toBe("Jump to wave6 · /Users/me/other-project");
  });

  test("the button label carries it visibly on an unproven row only", () => {
    expect(presentation.focusButtonLabel(agent({ target: FOLDER_MATCHED }), "unproven"))
      .toBe("Focus → other-project");
    expect(presentation.focusButtonLabel(agent({ target: { surfaceId: "S1", resolution: "exact" } }), "linked"))
      .toBe("Focus");
  });
});

describe("5ef8cf4 — a floor and its gap, in one glance", () => {
  const usage = (overrides: Record<string, unknown>) => ({
    available: true, costKnown: false, estimatedCostUsd: 100, measuredCostUsd: 100,
    costMissingInvocations: 3, invocations: 200, byProvider: [], ...overrides,
  });

  test("an incomplete total renders as a floor with its gap beside it", () => {
    const reading = client.usageCostReading(usage({}));

    // The "≥" is the mark that stops a floor being banked as a total.
    expect(reading.value).toMatch(/^≥\$/);
    expect(reading.sub).toContain("3 of 200 calls unpriced");
  });

  test("a complete total carries no floor mark", () => {
    const reading = client.usageCostReading(usage({ costKnown: true, costMissingInvocations: 0 }));

    expect(reading.value).not.toMatch(/≥/);
  });

  test("nothing priced reads as not reported rather than $0.00", () => {
    const reading = client.usageCostReading(usage({ measuredCostUsd: null, estimatedCostUsd: null }));

    expect(reading.value).toBe("not reported");
    expect(reading.value).not.toContain("0.00");
  });
});

describe("70ed00b — an empty cockpit must answer, not just be blank", () => {
  test("a healthy empty board says it is watching", () => {
    const verdict = client.emptyBoardVerdict(board());

    expect(verdict.message).toBe("Watching. No sessions running yet.");
    expect(verdict.sources).toMatch(/4 of 4 collectors healthy/);
  });

  test("a degraded empty board says the board is incomplete instead", () => {
    /* The distinction that matters: an empty board with a blind collector is an
       UNKNOWN fleet, not an empty one, and claiming health there would be the
       false all-clear. */
    const verdict = client.emptyBoardVerdict(board({
      totals: { live: 0, tracked: 0, attention: 0, sourceHealth: { healthy: 3, degraded: 1, absent: 0, total: 4 } },
    } as Partial<HubSnapshot>));

    expect(verdict.message).toMatch(/not every collector can see/i);
    expect(verdict.hint).toMatch(/incomplete rather than empty/i);
  });
});

describe("2c12ef6 — a spinner frame is not a name", () => {
  test("an animation frame is stripped from a terminal title", () => {
    /* Titles arrive mid-animation, so the frame character was being stored and
       rendered as part of the name — a name that changed ten times a second. */
    expect(presentation.stripSpinnerFrame("⠋ deploy worker")).toBe("deploy worker");
    expect(presentation.stripSpinnerFrame("⠙ deploy worker")).toBe("deploy worker");
  });

  test("a title that merely starts with a symbol is left alone", () => {
    // Stripping too eagerly would rename real sessions.
    expect(presentation.stripSpinnerFrame("→ deploy worker")).toBe("→ deploy worker");
  });
});

describe("52df8c9 + f13a730 — the summary cards answer from the payload", () => {
  test("a reachable control plane with no faults reads all clear", () => {
    // S2-T2: the chip qualifies the INSTRUMENTS. "All clear" read as a verdict
    // on the fleet, which this card never measured.
    expect(client.summaryWidgetData("health", board(), "live").value).toBe("Readings healthy");
  });

  test("an unreachable control plane does not read as clear", () => {
    /* f13a730: a board that cannot take commands must not report health. The
       headline IS the severity, so it cannot disagree with the badge below it. */
    const blocked = client.summaryWidgetData("health", board({
      controlHealth: { cmuxReachable: false, lastCheckedAt: new Date().toISOString(), errors: [], staleSources: [] },
    } as Partial<HubSnapshot>), "live");

    expect(blocked.value).not.toBe("Readings healthy");
    expect(blocked.value).toBe("Readings degraded");
    // HOW badly still rides on the card (severityKey), and it qualifies every
    // reading beside it; what left the card is the acting, not the severity.
  });
});

describe("69d5c0d — the header does not restate its own subtitle", () => {
  test("the health headline and its detail line do not repeat each other", () => {
    /* The copy half of the entry, which is assertable. Whether two elements
       READ as repetition in one viewport is geometry and stays blocked. */
    const card = client.summaryWidgetData("health", board(), "live");

    expect(card.value).toBeTruthy();
    expect(card.sublabel).toBeTruthy();
    expect(card.sublabel.toLowerCase()).not.toContain(card.value.toLowerCase());
  });
});

/* Fresh-machine sweep: behaviour that only looks right because THIS box has
   577 agents, a populated burnbar and five running lanes.

   Most of the board came through clean — a virgin HOME produces no NaN, no
   Infinity, no "undefined" in any string, and every card reads absent-first.
   This is the one place the wording assumed a busy board. */
describe("a quiet board does not promise a number that is never coming", () => {
  const momentumBoard = (momentum: Record<string, unknown>) => ({
    generatedAt: new Date().toISOString(),
    controlHealth: { cmuxReachable: true, lastCheckedAt: new Date().toISOString(), errors: [], staleSources: [] },
    totals: { live: 0, tracked: 0, attention: 0, working: 0, sourceHealth: { healthy: 4, degraded: 0, absent: 0, total: 4 } },
    programs: [],
    pulse: { momentum, burn: { tokensPerMin: null, windowMs: 0, coverage: { reporting: 0, eligible: 0, unknown: 0 }, costLastHourUsd: null, costProvenance: "unavailable" }, activity: [] },
  });

  const WITHHELD = {
    working: 0, completionsLastHour: null, completionsProvenance: "not-observable",
    observedWindowMs: 0, stalled: 0, stalledAgentIds: [], stallThresholdMs: 900_000,
  };

  test("completions are omitted when provenance is not-observable, never promised as not yet", () => {
    /* Completions are permanently unobservable. A "not measured" filler chip
       and a "not yet" promise are the same overclaim. Omit the reading. */
    const card = client.summaryWidgetData("momentum", momentumBoard(WITHHELD) as never, "live");

    expect(card.sublabel).not.toMatch(/not measured/i);
    expect(card.sublabel).not.toMatch(/yet/i);
    expect(card.sublabel).not.toMatch(/↑\d+ done/);
    expect(card.unit).toMatch(/need you/);
  });

  test("a board that reports stalls still shows them rather than the notice", () => {
    // The control: the notice must not crowd out live information.
    const card = client.summaryWidgetData("momentum", momentumBoard({
      ...WITHHELD, working: 6, stalled: 11, stalledAgentIds: ["a"], observedWindowMs: 3_600_000,
    }) as never, "live");

    expect(card.sublabel).toMatch(/quiet/i);
    expect(card.sublabel).not.toMatch(/not measured/i);
  });
});

/* The two window-naming properties confirmed in a browser on 878dd25, converted
   to standing assertions so they cannot regress silently between rendered reads.
   The geometry of 8edf115 stays browser-only — a stage that ends where its
   content ends is a measurement of boxes, and nothing here can see a box. */
describe("58daea6 / 8b31c96 — a rate names the window it was measured over", () => {
  const burnBoard = (windowMs: number, extra: Record<string, unknown> = {}) => ({
    generatedAt: "2026-08-02T21:40:00.000Z",
    totals: {}, programs: [], issues: [], recentlyResolved: [],
    controlHealth: { cmuxReachable: true, lastCheckedAt: "x", errors: [], staleSources: [] },
    pulse: { burn: { tokensPerMin: 356_258, windowMs, costLastHourUsd: 1.34, ...extra } },
  });

  test("the BURN card names the window it measured, not the hour it did not", () => {
    /* Verified rendered at 21:40: "10m average · $1.34 last hour" against a
       payload carrying windowMs 600000. The rate's window and the cost's window
       are different, and the card must not collapse them into one claim. */
    const card = client.summaryWidgetData("burn", burnBoard(600_000) as never, "live");
    expect(card.sublabel, "the BURN card stopped naming its measured window").toMatch(/10m/);
    expect(card.sublabel, "the BURN card stopped labelling the rate an average").toMatch(/average/i);
  });

  test("the window in the label follows the window in the payload", () => {
    /* The property a fixed string would also satisfy at one value. Browser-
       confirmed on the usage card by switching 24h -> 7d and watching the label
       move; asserted here across two payloads for the same reason. */
    const ten = client.summaryWidgetData("burn", burnBoard(600_000) as never, "live");
    const hour = client.summaryWidgetData("burn", burnBoard(3_600_000) as never, "live");
    expect(ten.sublabel).not.toBe(hour.sublabel);
    expect(hour.sublabel, "an hour-long window is not named as one").toMatch(/1h|60m/);
  });

  test("a complete cost renders bare and an incomplete one renders as a floor", () => {
    /* The branch that did NOT render on the live board, because costIsFloor is
       emitted only when true and the hour's cost was complete. Pinned here so
       the marker cannot be dropped while nobody is watching a floor. */
    const complete = client.summaryWidgetData("burn", burnBoard(600_000) as never, "live");
    const floor = client.summaryWidgetData("burn", burnBoard(600_000, { costIsFloor: true }) as never, "live");
    expect(complete.sublabel, "a complete cost is being marked as a floor").toContain("$1.34");
    expect(complete.sublabel).not.toContain("≥");
    expect(floor.sublabel, "an incomplete cost lost its floor marker").toContain("≥$1.34");
  });
});
