import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMountainFetch, type MountainAppState } from "../src/server/app";
import { buildSnapshot } from "../src/server/snapshot";
import { resolveAgentTarget } from "../src/server/targets";
import type { AgentSnapshot, HubSnapshot } from "../src/shared/types";
import type { ArchiveStore, CmuxSurface, CollectedAgent, CommandRunner } from "../src/server/types";

/* Two sessions in one checkout — the scenario the lifecycle contract was written
   for, asserted end to end: real snapshot build, real HTTP handler, real JSON
   over the wire, real client predicates reading it back.

   THE INCIDENT. An operator knew two agents were running in the same project.
   One had just finished a turn. The board showed them one session and filed the
   other under History, because a completed turn was read as a completed
   SESSION. The session was not gone; it was mislabelled and then hidden behind
   the one tab nobody opens looking for live work.

   Every part of that failure is a different module — the classifier decides,
   the tabs filter, the landing screen summarises, and `targets.ts` decides
   whether either one can still be typed into. Each is unit-tested. None of
   those tests can see the composition, which is where the operator lives.

   THE CONTRACT, in one sentence: no observed session may be unreachable.

   That is the assertion that actually has teeth. "Ridge is in Now" passes on a
   board that lost Vale entirely; "neither is in History" passes on a board that
   renders no tabs at all. Requiring that EVERY observed session answers to at
   least one tab is what fails when a state falls between the filters — which is
   exactly how the original bug shipped, and exactly what adding `unverified`
   could have re-introduced if Waiting had not been widened to hold it.

   The second half is the cwd band. Two live sessions in one checkout cannot both
   own the pane, so both must lose their controls and be TOLD why; when one goes
   quiet enough to be unverified it leaves the competition and the other gets its
   terminal back. That trade is the whole reason `eligibleForCwdFallback` is a
   band rather than "anything not finished" (targets.ts:45-59), and nothing else
   asserts both directions of it. */

const NOW = new Date("2026-08-04T12:00:00.000Z");
const NOW_MS = NOW.getTime();
const CWD = "/Users/emilionunezgarcia/Developer/shared-checkout";
const ago = (ms: number) => new Date(NOW_MS - ms).toISOString();

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
const runner: CommandRunner = { run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }) };

/** One unclaimed cmux pane sitting in the shared checkout, carrying no identity
    evidence — so cwd fallback is the tier that has to decide. */
const PANE: CmuxSurface = {
  workspaceId: "WORKSPACE-SHARED",
  surfaceId: "SURFACE-SHARED",
  paneId: "PANE-SHARED",
  cwd: CWD,
  sourceSessionIds: [],
};

function source(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: "claude:ridge",
    provider: "claude",
    sourceSessionId: "ridge",
    displayName: "Ridge",
    cwd: CWD,
    status: "running",
    statusReason: "Source activity within 3 minutes.",
    startedAt: ago(60 * 60_000),
    updatedAt: ago(30_000),
    tokens: { sessionTotal: 120_000, total: 400_000, provenance: "observed", contextWindow: 1_000_000 },
    artifacts: [],
    gates: [],
    ...overrides,
  };
}

/** Mid-sentence: wrote to its transcript half a minute ago, nothing ended. */
const RIDGE = source();

/* Between turns: said its piece 90 seconds ago and is waiting on a human. Fresh
   by the clock, and carrying the turn-level completion record that the old code
   read as an ending. `status` stays "running" because the collector bands on
   recency alone — which is what keeps it in the cwd competition below. */
const VALE = source({
  id: "claude:vale",
  sourceSessionId: "vale",
  displayName: "Vale",
  updatedAt: ago(90_000),
  transcriptEndedCleanly: true,
  endEvidence: "turn-complete",
});

/* The same session an hour later. Nothing has happened, which is the point:
   nothing is not an ending. `status` is what the collector's own banding gives
   a session past the quiet threshold. */
const VALE_QUIET = source({
  id: "claude:vale",
  sourceSessionId: "vale",
  displayName: "Vale",
  updatedAt: ago(60 * 60_000),
  status: "stale",
  statusReason: "No source activity in the last 45 minutes.",
  transcriptEndedCleanly: true,
  endEvidence: "turn-complete",
});

let webRoot = "";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let M: any;

/** The payload as it actually crosses the wire, not the object the server held. */
async function board(agents: readonly CollectedAgent[]): Promise<HubSnapshot> {
  const snapshot = buildSnapshot({ agents, surfaces: [PANE], archiveStore, now: NOW });
  const state: MountainAppState = {
    get: () => snapshot,
    subscribe: () => () => {},
    refresh: async () => snapshot,
  };
  const fetch = createMountainFetch({ state, runner, archiveStore, webRoot });
  const response = await fetch(new Request("http://127.0.0.1:4701/api/snapshot"));
  expect(response.status).toBe(200);
  return (await response.json()) as HubSnapshot;
}

const agentsOf = (snapshot: HubSnapshot): AgentSnapshot[] =>
  (snapshot.programs ?? []).flatMap((program) => program.agents ?? []);

const find = (snapshot: HubSnapshot, id: string): AgentSnapshot => {
  const agent = agentsOf(snapshot).find((candidate) => candidate.id === id);
  if (!agent) throw new Error(`${id} is not on the board at all — the strongest form of the bug under test`);
  return agent;
};

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), "anthill-siblings-"));
  webRoot = join(root, "web");
  mkdirSync(webRoot, { recursive: true });
  writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>Ant Hill</title>");

  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({ dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, append() {}, setAttribute() {}, addEventListener() {} }),
    getElementById: () => null,
    querySelectorAll: () => [] as unknown[],
    querySelector: () => null,
  };
  // @ts-expect-error The dependency-free browser client has no declaration file.
  await import("../src/web/app.js");
  M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
});

describe("two sessions in one checkout, one mid-turn and one between turns", () => {
  test("a finished turn is a wait, and the working session is working", async () => {
    const snapshot = await board([RIDGE, VALE]);
    const ridge = find(snapshot, "claude:ridge");
    const vale = find(snapshot, "claude:vale");

    expect(ridge.lifecycle).toBe("working");
    expect(ridge.scope).toBe("observed");

    // The rewritten rule, stated positively: the turn ended, the session did not.
    expect(vale.lifecycle).toBe("waiting");
    expect(vale.provenance).toBe("turn-complete");
    expect(vale.scope).toBe("observed");

    // Neither may be counted as an ending, and both are live work.
    expect([ridge.lifecycle, vale.lifecycle]).not.toContain("finished");
    expect(snapshot.totals.byLifecycle).toMatchObject({ working: 1, waiting: 1, finished: 0 });
    expect(snapshot.totals.live).toBe(2);
  });

  /* The reachability invariant. This is the assertion the original incident
     would have failed, and the one a future state added to the classifier
     without a home in the tabs would fail again. */
  test("every observed session answers to at least one tab, and neither is in History", async () => {
    const snapshot = await board([RIDGE, VALE]);
    const observed = agentsOf(snapshot).filter((agent) => agent.scope !== "retained");
    expect(observed).toHaveLength(2);

    const TABS = ["now", "needs-you", "working", "idle", "history"] as const;
    for (const agent of observed) {
      const reachable = TABS.filter((tab) => M.viewMatches(tab, agent));
      expect(reachable.length).toBeGreaterThan(0);
      // Findable is not enough — it must not be findable only in the archive.
      expect(reachable).not.toEqual(["history"]);
      expect(M.viewMatches("history", agent)).toBe(false);
    }

    expect(M.viewMatches("now", find(snapshot, "claude:ridge"))).toBe(true);
    expect(M.viewMatches("idle", find(snapshot, "claude:vale"))).toBe(true);
  });

  /* The one-glance rule from the landing screen (app.js:3906). The board opens
     on Needs you; when nothing is alerting, a working session has to be NAMED
     there, because "1 working" is a number you must act on to resolve. */
  test("the landing screen names the working session rather than only counting it", async () => {
    const snapshot = await board([RIDGE, VALE]);
    const observed = agentsOf(snapshot).filter((agent) => agent.scope !== "retained");

    // Nothing is alerting, so this really is the all-clear composition.
    expect(observed.filter((agent) => M.alerting(agent))).toHaveLength(0);
    expect(M.issuesOf(snapshot).filter((finding: { severity: string }) => finding.severity === "critical")).toHaveLength(0);

    const roster = observed.filter((agent) => M.lifecycleOf(agent) === "working" && M.scopeOf(agent) === "observed");
    const named = M.landingRosterNames(roster);
    expect(named).toHaveLength(1);
    // A name, and one that says where the work is — not a blank or an id.
    expect(named[0]).toBeTruthy();
    expect(named[0]).toContain("shared-checkout");

    // And the session that is NOT named is still counted, not disappeared.
    const totals = M.totalsOf(snapshot);
    expect(totals.working).toBe(1);
    expect(totals.idle).toBe(1);
  });

  /* The naming half of the sibling problem. `agentName` falls back to provider
     plus project basename, so two Claude sessions in one checkout produce the
     SAME string — and a roster of three identical names finds nobody. The row
     list already solves this (ambiguousNames + sessionTag, app.js:4095) because
     the collision was observed live on 20 of 27 duplicate-name groups. */
  test("two working sessions in one checkout are not offered under one identical name", async () => {
    const twin = source({ id: "claude:vale", sourceSessionId: "vale", displayName: "Vale", updatedAt: ago(45_000) });
    const snapshot = await board([RIDGE, twin]);
    const roster = agentsOf(snapshot)
      .filter((agent) => M.lifecycleOf(agent) === "working" && M.scopeOf(agent) === "observed");
    expect(roster).toHaveLength(2);

    // The raw name is the same for both — that is the collision, not the bug.
    expect(new Set(roster.map((agent: AgentSnapshot) => M.agentName(agent))).size).toBe(1);

    // What the operator is offered must still separate them.
    const named = M.landingRosterNames(roster);
    expect(named).toHaveLength(2);
    expect(new Set(named).size).toBe(2);
    for (const label of named) expect(label).toContain("shared-checkout");
  });

  test("a session between turns survives the lookback that would hide an ending", async () => {
    const snapshot = await board([RIDGE, VALE]);
    const vale = find(snapshot, "claude:vale");
    // Six hours is the default depth; both sessions are minutes old, so this
    // asserts the ordinary case rather than the exemption.
    expect(M.passesLookback(vale, "idle", 6, NOW_MS)).toBe(true);
  });
});

describe("the cwd band: who may still be typed into", () => {
  test("two live sessions in one checkout both lose their controls, and the refusal counts them", async () => {
    const sources = [RIDGE, VALE];
    for (const agent of sources) {
      const target = resolveAgentTarget(agent, [PANE], sources);
      expect(target.resolution).toBe("ambiguous");
      expect(target.surfaceId).toBeUndefined();
      // Named, not merely refused — the operator has to learn there are two.
      expect(target.reason).toContain("2 active sources share this cwd");
    }
  });

  /* Both directions of the band, which is what makes this a contract rather
     than a snapshot of current behaviour. Widening `eligibleForCwdFallback` to
     admit quiet sessions fails the second assertion; narrowing it to exclude
     turn-complete sessions fails the test above. */
  test("a session quiet enough to be unverified leaves the competition, and the working one gets its pane back", async () => {
    const snapshot = await board([RIDGE, VALE_QUIET]);
    const vale = find(snapshot, "claude:vale");

    // Still not an ending — an hour of silence bought no evidence of one.
    expect(vale.lifecycle).toBe("unverified");
    expect(vale.provenance).toBe("turn-complete-aged");
    expect(snapshot.totals.byLifecycle).toMatchObject({ working: 1, waiting: 0, unverified: 1, finished: 0 });

    // Unverified is not live, and is not an ending either.
    expect(snapshot.totals.live).toBe(1);

    const sources = [RIDGE, VALE_QUIET];
    const ridgeTarget = resolveAgentTarget(RIDGE, [PANE], sources);
    expect(ridgeTarget.resolution).toBe("unique-cwd");
    expect(ridgeTarget.surfaceId).toBe("SURFACE-SHARED");

    // The quiet one is refused by name, not silently dropped.
    const valeTarget = resolveAgentTarget(VALE_QUIET, [PANE], sources);
    expect(valeTarget.resolution).toBe("missing");
    expect(valeTarget.reason).toContain("running or waiting");
  });

  test("losing its controls never costs the quiet session its place on the board", async () => {
    const snapshot = await board([RIDGE, VALE_QUIET]);
    const vale = find(snapshot, "claude:vale");

    // Waiting holds the unverified group; History still must not.
    expect(M.viewMatches("idle", vale)).toBe(true);
    expect(M.viewMatches("history", vale)).toBe(false);
    expect(M.isUnverified(vale)).toBe(true);

    /* And the lookback exemption, which is the difference between "grouped in
       Waiting" and "invisible": at the default depth this session is an hour
       past the window that a mere wait would be judged by. */
    expect(M.passesLookback(vale, "idle", 6, NOW_MS + 24 * 60 * 60_000)).toBe(true);
  });
});
