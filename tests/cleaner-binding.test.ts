/**
 * S3 — the chip follows a real session, and nothing else.
 *
 * The rule under test is the one the Cleaner plan calls non-negotiable: every
 * state is read from the Cleaner's observable session, never from a timer and
 * never optimistically. These tests are written so that a timer-driven or
 * optimistic implementation FAILS them — a state that advances without evidence
 * is the defect, so each case withholds the evidence and asserts the state does
 * not move.
 *
 * Contract: docs/CLEANER-LAUNCH-CONTRACT.md.
 *
 * Hermetic — safe for `bun run test:ci`. Pure derivation, no DOM, no network.
 */
import { beforeAll, describe, expect, test } from "bun:test";

interface CleanerModule {
  cleanerAgentId: (sessionId: string) => string;
  cleanerFromResponse: (body: unknown, httpOk: boolean) => { sessionId: string; code: string; error: string };
  cleanerView: (snap: unknown, cleaner?: unknown) => { state: string; message?: string; sessionId?: string; agentId?: string; code?: string };
  cleanupCounts: (view: unknown) => { worktrees: number; branches: number; refused: number; proposed: number } | null;
  countsSentence: (counts: unknown) => string;
  CLEANER_FAILURES: Record<string, string>;
  CLEANER_IN_FLIGHT: Set<string>;
  CLEANER_LABELS: Record<string, string>;
  cleanerLands: (previousState: string, nextState: string) => boolean;
}
let C: CleanerModule;

beforeAll(async () => {
  // @ts-expect-error The dependency-free browser client has no declaration file.
  C = await import("../src/web/cleaner.js");
});

const SESSION = "79592379-c8fb-4ea4-800c-57c22d3c435e";

/* A board carrying the Cleaner lane, or not. The agent id is the binding the
   contract specifies: provider "cursor" plus the returned sourceSessionId. */
const boardWith = (agent: Record<string, unknown> | null) => ({
  generatedAt: "2026-08-06T09:00:00.000Z",
  programs: [{ id: "p", name: "the-ant-hill", agents: agent ? [agent] : [] }],
});
const cleanerAgent = (over: Record<string, unknown> = {}) => ({
  id: "cursor:" + SESSION,
  provider: "cursor",
  sourceSessionId: SESSION,
  displayName: "Cleaner",
  lifecycle: "working",
  ...over,
});

describe("binding is by session id, never by name", () => {
  test("the id is built from the returned session", () => {
    expect(C.cleanerAgentId(SESSION)).toBe("cursor:" + SESSION);
  });

  test("a lane named Cleaner that is NOT the launched session is not adopted", () => {
    /* "The authored name is Cleaner, but names are presentation rather than
       identity." A board binding by name would follow a rename, or adopt an
       unrelated lane someone happened to call Cleaner. */
    const impostor = cleanerAgent({ id: "cursor:some-other-session", sourceSessionId: "some-other-session" });
    expect(C.cleanerView(boardWith(impostor), { sessionId: SESSION }).state).toBe("launching");
  });
});

describe("no state advances without its evidence", () => {
  test("idle with nothing bound", () => {
    expect(C.cleanerView(boardWith(null), {}).state).toBe("idle");
  });

  test("launching while the request is in flight", () => {
    expect(C.cleanerView(boardWith(null), { launching: true }).state).toBe("launching");
  });

  test("a bound session the board cannot see does NOT advance past launching", () => {
    /* §6's first test, verbatim. The contract is explicit that absence is not an
       ending: "a session that disappeared from an incomplete snapshot is not
       treated as ended". Advancing here would be the optimistic read. */
    const view = C.cleanerView(boardWith(null), { sessionId: SESSION });
    expect(view.state).toBe("launching");
    expect(C.CLEANER_IN_FLIGHT.has(view.state)).toBe(true);
  });

  test("watching only once the session is actually on the board", () => {
    expect(C.cleanerView(boardWith(cleanerAgent()), { sessionId: SESSION }).state).toBe("watching");
  });

  test("needs-you only when that session carries a blocking attention class", () => {
    /* Reuses attentionClassOf — the same verdict the notification center, the
       badge and the notifier read. A second definition of "is it asking" is how
       two surfaces come to disagree. */
    const asking = cleanerAgent({ attentionSignal: { kind: "input-requested", evidence: "May I remove these?" } });
    const view = C.cleanerView(boardWith(asking), { sessionId: SESSION });
    expect(view.state).toBe("needs-you");
    expect(view.agentId).toBe("cursor:" + SESSION);
  });

  test("a quiet lane is watching, not needs-you", () => {
    const quiet = cleanerAgent({ attentionSignal: { kind: "nothing-wanted" } });
    expect(C.cleanerView(boardWith(quiet), { sessionId: SESSION }).state).toBe("watching");
  });

  test("resolved only when the session is terminal", () => {
    const done = cleanerAgent({ lifecycle: "finished", status: "archived", scope: "retained" });
    expect(C.cleanerView(boardWith(done), { sessionId: SESSION }).state).toBe("resolved");
  });
});

describe("a Cleaner that dies leaves a stated failure, never a spinner", () => {
  /* §6: "A Cleaner that dies mid-run leaves the chip in a stated failure, never
     a permanent spinner." */

  test("every failure code the contract lists has a sentence", () => {
    /* A chip can only STATE a failure whose name it knows. Any code missing here
       degrades to a spinner that never ends, which is the defect. */
    for (const code of [
      "METHOD_NOT_ALLOWED", "ORIGIN_REJECTED", "CLEANER_UNAVAILABLE",
      "CLEANER_SESSION_CREATE_FAILED", "CLEANER_SESSION_ID_INVALID",
      "CLEANER_CMUX_UNREACHABLE", "CLEANER_LAUNCH_FAILED", "CLEANER_SESSION_NOT_OBSERVED",
    ]) {
      expect(C.CLEANER_FAILURES[code], code).toBeTruthy();
      expect(C.CLEANER_FAILURES[code].length, code).toBeGreaterThan(20);
    }
  });

  test("a failed state is not in flight, so nothing keeps spinning", () => {
    const failed = C.cleanerView(boardWith(null), { error: "cmux could not be reached." });
    expect(failed.state).toBe("failed");
    expect(C.CLEANER_IN_FLIGHT.has("failed")).toBe(false);
    expect(C.CLEANER_IN_FLIGHT.has("resolved")).toBe(false);
  });

  test("the server's own sentence is preferred, because it knows which step refused", () => {
    const bound = C.cleanerFromResponse(
      { ok: false, error: { code: "CLEANER_CMUX_UNREACHABLE", message: "cmux socket timed out after 5s." } }, false);
    expect(bound.sessionId).toBe("");
    expect(bound.error).toBe("cmux socket timed out after 5s.");
    expect(bound.code).toBe("CLEANER_CMUX_UNREACHABLE");
  });

  test("a malformed body still produces a stated failure", () => {
    /* The moment a spinner would otherwise hang forever. */
    expect(C.cleanerFromResponse({ ok: false, error: { code: "CLEANER_LAUNCH_FAILED" } }, false).error)
      .toBe(C.CLEANER_FAILURES.CLEANER_LAUNCH_FAILED);
    expect(C.cleanerFromResponse(null, false).error.length).toBeGreaterThan(20);
    expect(C.cleanerFromResponse({ ok: true }, true).error.length).toBeGreaterThan(20);
  });
});

describe("a second launch adopts the running Cleaner rather than starting another", () => {
  test("409 ALREADY_RUNNING binds to the id it carries", () => {
    /* §6: "Double-click launches one Cleaner, not two." It holds because the
       SERVER answers the second request with the first one's id — not because
       the button was debounced, which would be a client-side guess about
       server state. */
    const bound = C.cleanerFromResponse({
      ok: false, sessionId: SESSION,
      error: { code: "CLEANER_ALREADY_RUNNING", message: "Cleaner session … is already running; bind to that session instead." },
    }, false);
    expect(bound.sessionId).toBe(SESSION);
    expect(bound.error).toBe("");
    expect(C.cleanerView(boardWith(cleanerAgent()), bound).state).toBe("watching");
  });

  test("a success binds normally", () => {
    const bound = C.cleanerFromResponse({ ok: true, sessionId: SESSION }, true);
    expect(bound).toEqual({ sessionId: SESSION, code: "", error: "" });
  });
});

describe("S5 — the ring lands on an observed edge, never on a clock", () => {
  /* Measured live at 1280 (docs/a11y-shots/21-S5-*.png):
       launching   animation cleanup-spin
       lands       animation cleanup-land, iterations 1, fill forwards
       then holds  class is-alive, animation none, marker still visible
     and under REAL emulated reduce (matchMedia asserted true first):
       animation none, duration 0s, transform none, marker visible, ring closed,
       label still "Cleaner working". */

  test("it lands exactly on launching -> watching", () => {
    expect(C.cleanerLands("launching", "watching")).toBe(true);
  });

  test("it does not land on any other transition", () => {
    /* Including idle -> watching, which is what an adopted CLEANER_ALREADY_RUNNING
       looks like: nothing arrived, so nothing lands. */
    for (const [from, to] of [
      ["idle", "watching"], ["watching", "watching"], ["launching", "launching"],
      ["launching", "failed"], ["watching", "needs-you"], ["watching", "resolved"],
      ["failed", "watching"], ["idle", "launching"],
    ]) {
      expect(C.cleanerLands(from, to), `${from} -> ${to}`).toBe(false);
    }
  });

  test("it cannot re-fire on a repaint", () => {
    /* The second paint's previous state is already `watching`, so the beat is a
       fact about a transition rather than a thing the chip can replay. */
    expect(C.cleanerLands("watching", "watching")).toBe(false);
  });
});

describe("the verdict is a count, not an adjective", () => {
  const plan = {
    removable: [
      { kind: "worktree", target: "/w/a", rollbackSha: "aaa" },
      { kind: "worktree", target: "/w/b", rollbackSha: "bbb" },
      { kind: "branch", target: "feat/x", rollbackSha: "ccc" },
    ],
    refused: { worktrees: [{ path: "/w/live", reasons: ["live agent inside"] }], branches: [] },
  };

  test("counts are split by kind and include refusals", () => {
    expect(C.cleanupCounts(plan)).toEqual({ worktrees: 2, branches: 1, refused: 1, proposed: 3 });
  });

  test("the sentence is numbers, and says PROPOSED rather than removed", () => {
    /* The board observes that a session ended; it does not observe what was
       removed. Saying "removed" would assert an outcome from evidence of an
       intention. */
    const said = C.countsSentence(C.cleanupCounts(plan));
    expect(said).toBe("2 worktrees, 1 branch proposed, 1 refused");
    expect(said).not.toMatch(/complete|success|done|removed/i);
  });

  test("an empty plan says so without pretending it failed", () => {
    expect(C.countsSentence(C.cleanupCounts({ removable: [], refused: { worktrees: [], branches: [] } })))
      .toBe("nothing proposed");
  });

  test("no label is an adjective about how it went", () => {
    for (const label of Object.values(C.CLEANER_LABELS)) {
      expect(label).not.toMatch(/complete!|success|great|all good/i);
    }
  });
});
