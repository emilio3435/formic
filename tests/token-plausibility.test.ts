import { describe, expect, test } from "bun:test";
import { parseClaudeJsonl } from "../src/server/collectors";
import { buildSnapshot } from "../src/server/snapshot";
import type { AgentSnapshot, HubSnapshot } from "../src/shared/types";
import type { ArchiveStore, CollectedAgent } from "../src/server/types";

/* Whether a number is POSSIBLE, which is a different question from whether a
   test can fail.

   The board reported 391.4M tokens for one session and 1.60B for a program.
   Provenance was correct, the suite was green, and mutation testing had found
   nothing wrong with the tests covering those numbers — because none of them
   asserted a magnitude. Roughly 99.1% of that total was cache re-reads counted
   as fresh usage; the honest figure is about 115x smaller.

   Every assertion here is a RELATION between numbers the snapshot already
   carries, never a constant. A 200k-window model and a 1M-window model are each
   judged against their own window, so nothing rots when a model is added, a
   limit is raised, or the fleet gets busier.

   What can be bounded honestly is a short list, and the end of this file says
   plainly what could not be. */

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
const NOW = new Date("2026-08-02T10:00:00.000Z");

function collected(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: "codex:a1",
    provider: "codex",
    sourceSessionId: "a1",
    displayName: "Worker",
    cwd: "/Users/me/project",
    status: "running",
    statusReason: "Source activity within 3 minutes.",
    startedAt: "2026-08-02T09:00:00.000Z",
    updatedAt: "2026-08-02T09:59:00.000Z",
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    ...overrides,
  };
}

const snapshotOf = (agents: CollectedAgent[]) =>
  buildSnapshot({ agents, surfaces: [], archiveStore, now: NOW } as never);

const agentsOf = (snapshot: HubSnapshot): AgentSnapshot[] =>
  snapshot.programs.flatMap(({ agents }) => agents);

/* ---------------------------------------------------------------------------
   The invariants, as functions over a snapshot. Each returns the offenders, so
   a failure names the agent and both sides of the comparison rather than
   reporting a bare false. */

/** `tokens.total` is occupancy — the latest call's prompt+completion, cache
    reads included. A call cannot place more tokens in the context than the
    context holds, so this is physics, not policy. */
function occupancyOverWindow(snapshot: HubSnapshot): string[] {
  return agentsOf(snapshot)
    .filter((agent) => {
      const { total, contextWindow, scope } = agent.tokens;
      if (scope !== "latest-turn") return false;
      if (!Number.isFinite(total) || !Number.isFinite(contextWindow) || !(contextWindow! > 0)) return false;
      return total! > contextWindow!;
    })
    .map((agent) => `${agent.id}: ${agent.tokens.total} in a ${agent.tokens.contextWindow} window`);
}

/** An aggregate must not exceed the sum of the things it aggregates. Less is
    legitimate — members can be filtered — but more is double counting. */
function fleetTotalOverSumOfParts(snapshot: HubSnapshot): string | null {
  const reported = snapshot.totals.tokens;
  if (!Number.isFinite(reported)) return null;
  const parts = agentsOf(snapshot)
    .map((agent) => agent.tokens.total)
    .filter((value): value is number => Number.isFinite(value));
  const sum = parts.reduce((running, value) => running + value, 0);
  return reported! > sum ? `fleet reported ${reported} against ${sum} summed from ${parts.length} agents` : null;
}

/** Every reported magnitude has to be a real, non-negative, finite number.
    NaN serialises to null and reads as "not reported"; a negative token count
    is not a smaller reading, it is a broken one. */
function impossibleMagnitudes(snapshot: HubSnapshot): string[] {
  const offenders: string[] = [];
  for (const agent of agentsOf(snapshot)) {
    for (const field of ["input", "output", "cachedInput", "total", "sessionTotal", "sessionCachedInput", "contextWindow"] as const) {
      const value = agent.tokens[field];
      if (value === undefined) continue;
      if (!Number.isFinite(value) || value < 0) offenders.push(`${agent.id}.${field} = ${value}`);
    }
  }
  return offenders;
}

describe("a reported magnitude has to be physically possible", () => {
  test("an honest fleet violates none of the invariants", () => {
    /* The control for the whole file. Every rejection below would also hold on
       a checker that rejected everything, which would be useless in the
       opposite direction. */
    const snapshot = snapshotOf([
      collected({ tokens: { scope: "latest-turn", provenance: "observed", total: 120_000, sessionTotal: 480_000, contextWindow: 1_000_000 } }),
      collected({
        id: "claude:b2", provider: "claude", sourceSessionId: "b2", displayName: "Second",
        tokens: { scope: "latest-turn", provenance: "observed", total: 180_000, sessionTotal: 900_000, contextWindow: 200_000 },
      }),
    ]);

    expect(occupancyOverWindow(snapshot)).toEqual([]);
    expect(fleetTotalOverSumOfParts(snapshot)).toBeNull();
    expect(impossibleMagnitudes(snapshot)).toEqual([]);
  });

  test("occupancy larger than the context window is caught", () => {
    /* The number that sat on the board all day. 391.4M of occupancy against a
       1M window is 391x a physical limit, and it reached the operator with
       correct provenance and a green suite because nothing compared the two
       fields to each other. */
    const snapshot = snapshotOf([collected({
      tokens: { scope: "latest-turn", provenance: "observed", total: 391_400_000, sessionTotal: 1_600_000_000, contextWindow: 1_000_000 },
    })]);

    expect(occupancyOverWindow(snapshot)).toHaveLength(1);
    expect(occupancyOverWindow(snapshot)[0]).toContain("391400000");
  });

  test("each agent is judged against its own window, not a shared constant", () => {
    /* Why this is a relation and not a number. 180k is fine in a 1M window and
       impossible in a 128k one; a literal threshold would either miss the
       second or fail the first, and would need editing every time a model
       lands. */
    const roomy = snapshotOf([collected({
      tokens: { scope: "latest-turn", provenance: "observed", total: 180_000, contextWindow: 1_000_000 },
    })]);
    const cramped = snapshotOf([collected({
      tokens: { scope: "latest-turn", provenance: "observed", total: 180_000, contextWindow: 128_000 },
    })]);

    expect(occupancyOverWindow(roomy)).toEqual([]);
    expect(occupancyOverWindow(cramped)).toHaveLength(1);
  });

  test("occupancy exactly at the window is allowed, one token over is not", () => {
    // A full context is a real state and a common one. The boundary is asserted
    // from both sides so the comparison cannot drift into >= or <=.
    const exactly = snapshotOf([collected({
      tokens: { scope: "latest-turn", provenance: "observed", total: 200_000, contextWindow: 200_000 },
    })]);
    const over = snapshotOf([collected({
      tokens: { scope: "latest-turn", provenance: "observed", total: 200_001, contextWindow: 200_000 },
    })]);

    expect(occupancyOverWindow(exactly)).toEqual([]);
    expect(occupancyOverWindow(over)).toHaveLength(1);
  });

  test("a session-scope total is not measured against the window", () => {
    /* Scope discipline. Cumulative session usage legitimately exceeds the
       window — that is what a long session IS — so applying the occupancy bound
       to it would be the mirror of the original bug: a true number called
       impossible. Only latest-turn occupancy is bounded. */
    const cumulative = snapshotOf([collected({
      tokens: { scope: "session", provenance: "observed", total: 50_000_000, contextWindow: 1_000_000 },
    })]);

    expect(occupancyOverWindow(cumulative)).toEqual([]);
  });

  test("the fleet total never exceeds the sum of the agents it adds up", () => {
    /* An aggregate above its own parts is double counting, which is how one
       inflated session becomes an inflated program and then an inflated board.
       Less than the sum is legitimate — agents without a reading are skipped —
       so this is one-sided on purpose. */
    const snapshot = snapshotOf([
      collected({ tokens: { scope: "latest-turn", provenance: "observed", total: 120_000, contextWindow: 1_000_000 } }),
      collected({
        id: "codex:b", sourceSessionId: "b", displayName: "B",
        tokens: { scope: "latest-turn", provenance: "observed", total: 80_000, contextWindow: 1_000_000 },
      }),
    ]);

    expect(fleetTotalOverSumOfParts(snapshot)).toBeNull();
    expect(snapshot.totals.tokens).toBe(200_000);
  });

  test("an agent reporting no tokens does not inflate or deflate the aggregate", () => {
    // The unreported agent is skipped by both the sum and the aggregate, so the
    // relation still holds rather than silently going one-sided.
    const snapshot = snapshotOf([
      collected({ tokens: { scope: "latest-turn", provenance: "observed", total: 120_000, contextWindow: 1_000_000 } }),
      collected({ id: "codex:quiet", sourceSessionId: "quiet", displayName: "Quiet", tokens: { provenance: "unknown" } }),
    ]);

    expect(fleetTotalOverSumOfParts(snapshot)).toBeNull();
    expect(snapshot.totals.tokens).toBe(120_000);
  });

  test("no reported magnitude is negative, infinite, or NaN", () => {
    const snapshot = snapshotOf([collected({
      tokens: { scope: "latest-turn", provenance: "observed", total: 120_000, sessionTotal: 480_000, contextWindow: 1_000_000 },
    })]);

    expect(impossibleMagnitudes(snapshot)).toEqual([]);
  });

  test("a negative magnitude is caught rather than rendered as a small number", () => {
    // The checker has to fire on this, or the assertion above passes for a
    // build that emits nonsense.
    const snapshot = snapshotOf([collected({
      tokens: { scope: "latest-turn", provenance: "observed", total: -5, contextWindow: 1_000_000 },
    })]);

    expect(impossibleMagnitudes(snapshot)).toHaveLength(1);
  });
});

describe("the accounting path itself produces possible numbers", () => {
  /* The invariants above run against hand-built fixtures, which proves the
     checker works but not that the parser obeys it. These drive a real
     transcript through parseClaudeJsonl into buildSnapshot, so an accounting
     change that inflates occupancy — counting cache re-reads as fresh usage is
     exactly how 99.1% of the original number arrived — fails here rather than
     on the board. */
  const NOW_MS = Date.parse("2026-08-02T10:00:00.000Z");

  const transcript = (turns: readonly { input: number; cacheRead: number }[]) => [
    JSON.stringify({
      type: "user", sessionId: "c1", cwd: "/Users/me/project",
      timestamp: new Date(NOW_MS - 600_000).toISOString(), message: { role: "user", content: "go" },
    }),
    ...turns.map((turn, index) => JSON.stringify({
      type: "assistant", sessionId: "c1", requestId: `r${index}`,
      timestamp: new Date(NOW_MS - 300_000 + index * 1_000).toISOString(),
      message: {
        role: "assistant", id: `r${index}`, model: "claude-opus-4-8", content: "ok",
        usage: {
          input_tokens: turn.input, output_tokens: 500,
          cache_read_input_tokens: turn.cacheRead, cache_creation_input_tokens: 0,
        },
      },
    })),
  ].join("\n");

  test("a long cache-heavy session stays inside its context window", () => {
    /* The shape that produced the bug: many turns, each re-reading a large
       cached prefix. Cache reads are re-reads of context the model already
       holds, so they belong to occupancy for the CURRENT turn and must never
       accumulate across turns into it. Twenty turns at 800k of cache read is
       16M of re-reading — and occupancy must still be one turn's worth. */
    const parsed = parseClaudeJsonl(
      transcript(Array.from({ length: 20 }, () => ({ input: 5_000, cacheRead: 800_000 }))),
      { sourcePath: "/tmp/c.jsonl", mtimeMs: NOW_MS, nowMs: NOW_MS },
    );
    const snapshot = snapshotOf([parsed!]);

    expect(occupancyOverWindow(snapshot)).toEqual([]);
    expect(impossibleMagnitudes(snapshot)).toEqual([]);
  });

  test("the cache-heavy session is genuinely cache-heavy, so the check is not vacuous", () => {
    /* Without this the test above would pass on a parser that reported no
       tokens at all. The re-reads must be visible somewhere — occupancy for the
       latest turn — while never summing across turns. */
    const parsed = parseClaudeJsonl(
      transcript(Array.from({ length: 20 }, () => ({ input: 5_000, cacheRead: 800_000 }))),
      { sourcePath: "/tmp/c.jsonl", mtimeMs: NOW_MS, nowMs: NOW_MS },
    );

    expect(parsed?.tokens.total).toBeGreaterThan(800_000);
    expect(parsed?.tokens.total).toBeLessThanOrEqual(1_000_000);
  });
});
