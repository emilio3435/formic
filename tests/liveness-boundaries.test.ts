import { describe, expect, test } from "bun:test";
import { parseClaudeJsonl } from "../src/server/collectors";
import type { ParseMetadata } from "../src/server/collectors";

/* The three activity bands every collector shares, driven through a real parser
   rather than asserted against the private helper.

   Mutation testing found this uncovered: widening the running band from 3
   minutes to 30 killed no test in tests/collectors.test.ts, which has no
   assertion on status transitions at all. That band is what the cockpit reads
   as "this agent is working right now" — the whole board's Working/Idle split,
   the momentum count, and whether an operator believes a session is moving.
   Silence for 25 minutes reading as "working" is exactly the plausible-looking
   wrong answer the board must never give.

   Boundaries are asserted from both sides, because a test that only samples the
   middle of a band cannot tell a threshold that moved from one that did not. */

const NOW = Date.parse("2026-07-21T23:00:00.000Z");
const MINUTE = 60_000;

const at = (msAgo: number): ParseMetadata => ({
  sourcePath: "/tmp/claude-session.jsonl",
  mtimeMs: NOW - msAgo,
  nowMs: NOW,
});

/* One user line whose timestamp is the only thing that varies. mtimeMs moves
   with it so the file-mtime fallback cannot mask a wrong transcript timestamp. */
const transcript = (msAgo: number): string =>
  JSON.stringify({
    type: "user",
    sessionId: "c1",
    cwd: "/tmp/proj",
    timestamp: new Date(NOW - msAgo).toISOString(),
    message: { role: "user", content: "go" },
  });

const statusAfter = (msAgo: number) => {
  const agent = parseClaudeJsonl(transcript(msAgo), at(msAgo));
  return { status: agent?.status, reason: agent?.statusReason };
};

describe("collector activity bands", () => {
  test("fresh activity inside three minutes reads as running", () => {
    expect(statusAfter(30_000).status).toBe("running");
    expect(statusAfter(2 * MINUTE).status).toBe("running");
  });

  test("the running band closes at three minutes, not later", () => {
    /* The upper edge. Without this, widening the band to 30 minutes — an agent
       that has said nothing for half an hour still painted as working — passes
       every other test in the suite. */
    expect(statusAfter(2 * MINUTE + 59_000).status).toBe("running");
    expect(statusAfter(3 * MINUTE + 1_000).status).not.toBe("running");
    expect(statusAfter(3 * MINUTE + 1_000).status).toBe("waiting");
  });

  test("silence between three and forty-five minutes is waiting, not stale", () => {
    // Waiting keeps its controls and stays on the live board; stale does not.
    // Collapsing this band either strands a live agent in history or keeps a
    // dead one on the board.
    expect(statusAfter(10 * MINUTE).status).toBe("waiting");
    expect(statusAfter(44 * MINUTE).status).toBe("waiting");
  });

  test("the waiting band closes at forty-five minutes, not later", () => {
    expect(statusAfter(44 * MINUTE + 59_000).status).toBe("waiting");
    expect(statusAfter(45 * MINUTE + 1_000).status).toBe("stale");
  });

  /* Pinned to the millisecond, because a second of slack is enough room for the
     comparison to flip from `<` to `<=` and the suite to stay green. Both edges
     are half-open — the boundary instant belongs to the LATER band — and that is
     the property a refactor is most likely to invert without noticing. */
  test("each band boundary is exact to the millisecond, and belongs to the later band", () => {
    expect(statusAfter(3 * MINUTE - 1).status).toBe("running");
    expect(statusAfter(3 * MINUTE).status).toBe("waiting");
    expect(statusAfter(45 * MINUTE - 1).status).toBe("waiting");
    expect(statusAfter(45 * MINUTE).status).toBe("stale");
  });

  test("long silence reads as stale", () => {
    expect(statusAfter(3 * 60 * MINUTE).status).toBe("stale");
  });

  test("each band explains itself in words the drawer can show", () => {
    /* The reason string is rendered beside the status. A band that changed
       without its sentence changing would tell the operator the wrong thing
       while the status field stayed technically correct. */
    expect(statusAfter(30_000).reason).toMatch(/within 3 minutes/i);
    expect(statusAfter(10 * MINUTE).reason).toMatch(/no source activity/i);
    expect(statusAfter(3 * 60 * MINUTE).reason).toMatch(/45 minutes/i);
  });

  /* A test asserting that a future timestamp is clamped to zero age used to sit
     here. Mutation testing killed it: removing `Math.max(0, …)` changes nothing
     observable, because a negative age is still below the three-minute bound
     and still reads running. The clamp is defensive arithmetic with no reachable
     effect on the bands, so there was no property to pin and the assertion could
     never fail. Deleted rather than dressed up. */

  test("a recorded session exit outranks the clock entirely", () => {
    /* Age decides the band only for sessions the source has not closed. A
       transcript that ended cleanly is archived no matter how recent its last
       line is — otherwise a session that finished ten seconds ago is painted
       "running" and the operator waits on an agent that already left. */
    const endedNow = JSON.stringify({
      type: "assistant",
      sessionId: "c1",
      timestamp: new Date(NOW - 10_000).toISOString(),
      message: { role: "assistant", id: "r1", model: "claude-opus-4-8", content: "done", stop_reason: "end_turn" },
    });
    const opened = JSON.stringify({
      type: "user",
      sessionId: "c1",
      cwd: "/tmp/proj",
      timestamp: new Date(NOW - 20_000).toISOString(),
      message: { role: "user", content: "go" },
    });

    const agent = parseClaudeJsonl([opened, endedNow].join("\n"), at(10_000));

    // Ten seconds old: squarely inside the running band on age alone.
    expect(agent?.status).toBe("archived");
    expect(agent?.statusReason).toMatch(/session exit/i);
  });
});

describe("the bands are the operator's, not the compiler's", () => {
  /* Until settings v2 these were `3 * 60_000` and `45 * 60_000` written inline
     in two collectors. An operator running overnight swarms had no way to say
     "45 minutes of silence is normal here" — the board simply told them their
     sessions had gone stale. These assert the numbers now travel from the
     settings store all the way to the comparison, through ParseMetadata. */
  const withThresholds = (msAgo: number, freshMs: number, quietMs: number) =>
    parseClaudeJsonl(transcript(msAgo), { ...at(msAgo), thresholds: { freshMs, quietMs } })?.status;

  test("a widened freshness window keeps a session running that the default calls waiting", () => {
    expect(statusAfter(10 * MINUTE).status).toBe("waiting");
    expect(withThresholds(10 * MINUTE, 30 * MINUTE, 180 * MINUTE)).toBe("running");
  });

  test("a widened quiet threshold keeps a session waiting that the default calls stale", () => {
    expect(statusAfter(90 * MINUTE).status).toBe("stale");
    expect(withThresholds(90 * MINUTE, 10 * MINUTE, 180 * MINUTE)).toBe("waiting");
  });

  test("a tightened quiet threshold goes stale sooner, and still at its own boundary", () => {
    expect(withThresholds(15 * MINUTE - 1, 2 * MINUTE, 15 * MINUTE)).toBe("waiting");
    expect(withThresholds(15 * MINUTE, 2 * MINUTE, 15 * MINUTE)).toBe("stale");
  });

  test("omitting thresholds keeps the shipped defaults, so every existing caller is unaffected", () => {
    expect(parseClaudeJsonl(transcript(MINUTE), at(MINUTE))?.status).toBe("running");
    expect(parseClaudeJsonl(transcript(10 * MINUTE), at(10 * MINUTE))?.status).toBe("waiting");
    expect(parseClaudeJsonl(transcript(90 * MINUTE), at(90 * MINUTE))?.status).toBe("stale");
  });

  /* The sentence is what the operator actually reads, and it used to be a
     literal: "within 3 minutes" / "in the last 45 minutes", written when both
     numbers were constants. Settings v2 made them settable and left the prose
     behind, so a board configured for a 90-minute quiet band went on saying 45 —
     and snapshot.ts publishes this string verbatim on ordinary Working and
     Waiting rows, so it was wrong on screen rather than merely wrong in a log.
     The status assertions above cannot catch it: they only read `.status`. */
  const reasonWith = (msAgo: number, freshMs: number, quietMs: number) =>
    parseClaudeJsonl(transcript(msAgo), { ...at(msAgo), thresholds: { freshMs, quietMs } })?.statusReason;

  test("the reason sentence quotes the operator's freshness window, not the shipped one", () => {
    expect(reasonWith(MINUTE, 30 * MINUTE, 180 * MINUTE)).toMatch(/within 30 minutes/i);
    expect(reasonWith(MINUTE, 30 * MINUTE, 180 * MINUTE)).not.toMatch(/3 minutes/i);
  });

  test("the reason sentence quotes the operator's quiet window when the session goes stale", () => {
    expect(reasonWith(200 * MINUTE, 30 * MINUTE, 180 * MINUTE)).toMatch(/last 180 minutes/i);
    expect(reasonWith(200 * MINUTE, 30 * MINUTE, 180 * MINUTE)).not.toMatch(/45 minutes/i);
  });

  test("a waiting session names the window it fell out of, not the one it has not reached", () => {
    /* Waiting begins when freshness lapses, so the number that explains it is
       freshMs. Quoting quietMs here would tell the operator a session had been
       silent for a window it is still inside. */
    expect(reasonWith(60 * MINUTE, 30 * MINUTE, 180 * MINUTE)).toMatch(/last 30 minutes/i);
  });

  test("one minute is spoken in the singular", () => {
    expect(reasonWith(10_000, MINUTE, 180 * MINUTE)).toMatch(/within 1 minute\b/i);
  });
});
