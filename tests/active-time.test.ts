import { describe, expect, test } from "bun:test";
import { parseClaudeJsonl, parseCodexJsonl, parseOmpJsonl } from "../src/server/collectors";
import { buildSnapshot } from "../src/server/snapshot";
import { AGENT_IDLE_GAP_MS } from "../src/server/types";
import type { ArchiveStore, CollectedAgent } from "../src/server/types";

/* ELAPSED is a SPAN, not working time.

   The magnitude audit found an agent rendering 87.1 days of "elapsed". The
   arithmetic was right — updatedAt really was 87 days after startedAt — but the
   label claimed working time while the value was a first-touch-to-last-touch
   distance with every dormant hour inside it, about 204x a generous activity
   bound across 19 agents. The fix an operator can trust is not a smaller
   number: clamping would replace a true value with a fabricated one, and
   relabelling it "age" would concede that the board cannot say how long anyone
   worked. It is a SECOND measure that is bounded by construction.

   These tests pin the two properties that make `activeMs` worth shipping: it
   excludes dormancy, and it can never exceed the span it is drawn from. */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const START = Date.parse("2026-06-01T09:00:00.000Z");
const at = (offsetMs: number): string => new Date(START + offsetMs).toISOString();

const claudeSession = (offsets: readonly number[]): string =>
  offsets
    .map((offset, index) =>
      JSON.stringify({
        type: index % 2 === 0 ? "user" : "assistant",
        timestamp: at(offset),
        sessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        session_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        cwd: "/Users/me/project",
        message: {
          role: index % 2 === 0 ? "user" : "assistant",
          content: `turn ${index}`,
        },
      }),
    )
    .join("\n");

describe("active time is working time, not the span it sits in", () => {
  test("a month-long span with two short work sessions reports minutes, not a month", () => {
    /* PIN A. The 87.1-day row, in miniature: two ten-minute sittings a month
       apart. Elapsed is honestly 30 days and stays 30 days — this measure does
       not touch it. What the operator gains is the ability to say the agent
       worked for twenty minutes, which is the question "how long has this been
       going?" was actually asking. */
    const agent = parseClaudeJsonl(
      claudeSession([0, 5 * MINUTE, 10 * MINUTE, 30 * DAY, 30 * DAY + 5 * MINUTE, 30 * DAY + 10 * MINUTE]),
      { nowMs: START + 30 * DAY + 11 * MINUTE },
    );

    expect(agent?.activeMs).toBe(20 * MINUTE);

    // The bound that makes it safe to render: work time cannot exceed the span.
    const spanMs = Date.parse(agent!.updatedAt) - Date.parse(agent!.startedAt!);
    expect(spanMs).toBeGreaterThanOrEqual(30 * DAY);
    expect(agent!.activeMs!).toBeLessThan(spanMs);
    // And it is small enough to read as a sitting rather than a season.
    expect(agent!.activeMs! / spanMs).toBeLessThan(0.001);
  });

  test("a gap at the dormancy threshold is still one stretch; a gap past it is not", () => {
    /* The threshold is not a new number: it is the board's own
       STALL_THRESHOLD_MS, already shipped as pulse.momentum.stallThresholdMs and
       already the point at which a quiet session is called stalled. Pinning both
       sides of the boundary keeps active time and "stalled" from drifting into
       two different opinions about the same silence. */
    const atThreshold = parseClaudeJsonl(claudeSession([0, AGENT_IDLE_GAP_MS]), {
      nowMs: START + AGENT_IDLE_GAP_MS + MINUTE,
    });
    const pastThreshold = parseClaudeJsonl(claudeSession([0, AGENT_IDLE_GAP_MS + 1]), {
      nowMs: START + AGENT_IDLE_GAP_MS + MINUTE,
    });

    expect(atThreshold?.activeMs).toBe(AGENT_IDLE_GAP_MS);
    expect(pastThreshold?.activeMs).toBeUndefined();
  });

  test("a session with one recorded turn reports nothing rather than zero", () => {
    /* Absent-first, as everywhere else on this board. One turn gives no
       interval to measure, and 0 would render as "worked no time at all" —
       a claim the transcript does not support. */
    const agent = parseClaudeJsonl(claudeSession([0]), { nowMs: START + MINUTE });

    expect(agent).not.toBeNull();
    expect(agent?.activeMs).toBeUndefined();
  });

  test("out-of-order rows never subtract from the total", () => {
    // Transcripts are appended concurrently and are not guaranteed sorted.
    const agent = parseClaudeJsonl(claudeSession([0, 10 * MINUTE, 2 * MINUTE, 12 * MINUTE]), {
      nowMs: START + 13 * MINUTE,
    });

    // 0→10 counts; the backwards step counts nothing; 10→12 counts.
    expect(agent?.activeMs).toBe(12 * MINUTE);
    expect(agent!.activeMs!).toBeGreaterThan(0);
  });

  test("every provider measures it, so the field is not silently Claude-only", () => {
    const codex = parseCodexJsonl(
      [
        { type: "session_meta", timestamp: at(0), payload: { id: "11111111-2222-3333-4444-555555555555", cwd: "/Users/me/project" } },
        { type: "event_msg", timestamp: at(4 * MINUTE), payload: { type: "user_message", message: "Do the thing." } },
        { type: "event_msg", timestamp: at(40 * DAY), payload: { type: "user_message", message: "Still here?" } },
        { type: "event_msg", timestamp: at(40 * DAY + 3 * MINUTE), payload: { type: "task_complete" } },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n"),
      { nowMs: START + 40 * DAY + 4 * MINUTE },
    );
    const omp = parseOmpJsonl(
      [
        { type: "session", id: "019f86c4-1558-7000-aeb8-26e2cfd0e8ec", timestamp: at(0) },
        { type: "message", timestamp: at(6 * MINUTE), message: { role: "user", content: "Go." } },
        { type: "message", timestamp: at(20 * DAY), message: { role: "assistant", content: "Back." } },
        { type: "message", timestamp: at(20 * DAY + 2 * MINUTE), message: { role: "assistant", content: "Done." } },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n"),
      { sourcePath: "/Users/me/.omp/agent/sessions/-Users-me-project/session.jsonl", nowMs: START + 20 * DAY + 3 * MINUTE },
    );

    expect(codex?.activeMs).toBe(7 * MINUTE);
    expect(omp?.activeMs).toBe(8 * MINUTE);
  });
});

describe("elapsed itself stays honest", () => {
  const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };

  const source = (overrides: Partial<CollectedAgent>): CollectedAgent => ({
    id: "claude:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    provider: "claude",
    sourceSessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    displayName: "Long runner",
    cwd: "/Users/me/project",
    status: "running",
    statusReason: "Fixture activity.",
    startedAt: at(0),
    updatedAt: at(30 * DAY),
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    ...overrides,
  });

  const rowFor = (agent: CollectedAgent, nowMs: number) =>
    buildSnapshot({ agents: [agent], surfaces: [], archiveStore, now: new Date(nowMs) })
      .programs.flatMap((program) => program.agents)
      .find((row) => row.id === agent.id);

  const elapsedOf = (agent: CollectedAgent, nowMs: number): number | undefined =>
    rowFor(agent, nowMs)?.elapsedMs;

  test("an ended agent's clock is frozen at its last turn, never at now", () => {
    /* PIN B. An agent that stopped writing a month ago must not keep accruing
       elapsed forever — that is how a finished session grows into an 87-day
       number nobody worked. Already true; pinned so it stays true. */
    const ended = source({ status: "archived" });
    const nowMs = START + 90 * DAY;

    expect(elapsedOf(ended, nowMs)).toBe(30 * DAY);
    // The failure this rules out: elapsed drawn from the wall clock.
    expect(elapsedOf(ended, nowMs)).not.toBe(90 * DAY);
    // And it does not drift when the board is read again later.
    expect(elapsedOf(ended, START + 200 * DAY)).toBe(30 * DAY);
  });

  test("a live agent's elapsed still runs, because it is genuinely still going", () => {
    const live = source({ status: "running", processAlive: true });

    expect(elapsedOf(live, START + 30 * DAY + MINUTE)).toBe(30 * DAY + MINUTE);
  });

  test("active time reaches the wire beside elapsed, so a renderer can bound one by the other", () => {
    const agent = source({ activeMs: 20 * MINUTE });
    const row = rowFor(agent, START + 30 * DAY);

    expect(row?.elapsedMs).toBe(30 * DAY);
    expect(row?.activeMs).toBe(20 * MINUTE);
  });
});
