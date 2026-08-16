import { describe, expect, test } from "bun:test";
import { makeAgent } from "../src/server/collectors";
import {
  ThreadClock,
  observeClaudeRow,
  threadFromMessages,
} from "../src/server/thread-clock";

describe("ThreadClock", () => {
  test("a later tool does not reset the working streak", () => {
    const clock = new ThreadClock();
    clock.observe("2026-08-16T12:00:00.000Z", "user");
    clock.observe("2026-08-16T12:00:05.000Z", "assistant");
    clock.observe("2026-08-16T12:04:00.000Z", "tool");
    expect(clock.workingSince).toBe("2026-08-16T12:00:00.000Z");
    expect(clock.lastThreadAt).toBe("2026-08-16T12:04:00.000Z");
  });

  test("a tool after a closed turn starts a new streak", () => {
    const clock = new ThreadClock();
    clock.observe("2026-08-16T12:00:00.000Z", "user");
    clock.observe("2026-08-16T12:01:00.000Z", "assistant", { endsTurn: true });
    expect(clock.workingSince).toBeUndefined();
    expect(clock.lastThreadAt).toBe("2026-08-16T12:01:00.000Z");
    clock.observe("2026-08-16T12:02:00.000Z", "tool");
    expect(clock.workingSince).toBe("2026-08-16T12:02:00.000Z");
    expect(clock.lastThreadAt).toBe("2026-08-16T12:02:00.000Z");
  });

  test("missing timestamps are ignored and a turn-end still closes the streak", () => {
    const clock = new ThreadClock();
    clock.observe("2026-08-16T12:00:00.000Z", "user");
    clock.observe(undefined, "tool");
    clock.observe("not-a-time", "assistant");
    expect(clock.lastThreadAt).toBe("2026-08-16T12:00:00.000Z");
    clock.observe(undefined, "system", { endsTurn: true });
    expect(clock.workingSince).toBeUndefined();
    expect(clock.lastThreadAt).toBe("2026-08-16T12:00:00.000Z");
  });

  test("Claude injected metadata is skipped unless it is a tool_result", () => {
    const clock = new ThreadClock();
    observeClaudeRow(clock, {
      type: "user",
      timestamp: "2026-08-16T12:00:01.000Z",
      message: { role: "user", content: "Please inspect." },
    });
    observeClaudeRow(clock, {
      type: "assistant",
      timestamp: "2026-08-16T12:00:02.000Z",
      message: { role: "assistant", content: [{ type: "text", text: "Looking." }] },
    });
    observeClaudeRow(clock, {
      type: "assistant",
      timestamp: "2026-08-16T12:00:03.000Z",
      message: { role: "assistant", content: [{ type: "tool_use", name: "inspect" }] },
    });
    observeClaudeRow(clock, {
      type: "user",
      isMeta: true,
      timestamp: "2026-08-16T12:00:04.000Z",
      message: { role: "user", content: "Injected metadata." },
    });
    observeClaudeRow(clock, {
      type: "user",
      isMeta: true,
      timestamp: "2026-08-16T12:00:05.000Z",
      message: { role: "user", content: [{ type: "tool_result", content: "ok" }] },
    });
    expect(clock.lastThreadAt).toBe("2026-08-16T12:00:05.000Z");
    expect(clock.workingSince).toBe("2026-08-16T12:00:01.000Z");
  });

  test("reasoning-only assistant lines are not thread events", () => {
    const clock = new ThreadClock();
    clock.observe("2026-08-16T12:00:01.000Z", "user");
    observeClaudeRow(clock, {
      type: "assistant",
      timestamp: "2026-08-16T12:00:02.000Z",
      message: { role: "assistant", content: [{ type: "thinking", thinking: "internal" }] },
    });
    expect(clock.lastThreadAt).toBe("2026-08-16T12:00:01.000Z");
  });
});

describe("makeAgent thread fallback (Grok path)", () => {
  test("publishes lastThreadAt and workingSince from humanMessages when the parser did not", () => {
    const agent = makeAgent({
      provider: "grok",
      sourceSessionId: "grok-thread-fallback",
      updatedAt: "2026-08-16T12:00:10.000Z",
      tokens: { provenance: "unknown" },
      humanMessages: [
        { role: "user", content: "Inspect the fleet.", timestamp: "2026-08-16T12:00:01.000Z" },
        { role: "assistant", content: "The fleet is stable.", timestamp: "2026-08-16T12:00:02.000Z" },
      ],
      meta: { nowMs: Date.parse("2026-08-16T12:00:10.000Z") },
    });
    expect(agent.lastThreadAt).toBe("2026-08-16T12:00:02.000Z");
    expect(agent.workingSince).toBe("2026-08-16T12:00:01.000Z");
  });

  test("a completed Grok turn clears workingSince and keeps lastThreadAt", () => {
    const agent = makeAgent({
      provider: "grok",
      sourceSessionId: "grok-thread-ended",
      updatedAt: "2026-08-16T12:00:10.000Z",
      tokens: { provenance: "unknown" },
      humanMessages: [
        { role: "user", content: "Inspect the fleet.", timestamp: "2026-08-16T12:00:01.000Z" },
        { role: "assistant", content: "Done.", timestamp: "2026-08-16T12:00:02.000Z" },
      ],
      exited: true,
      meta: { nowMs: Date.parse("2026-08-16T12:00:10.000Z") },
    });
    expect(agent.lastThreadAt).toBe("2026-08-16T12:00:02.000Z");
    expect(agent.workingSince).toBeUndefined();
  });

  test("an explicit thread clock wins over the humanMessage fallback", () => {
    const agent = makeAgent({
      provider: "codex",
      sourceSessionId: "codex-thread-explicit",
      updatedAt: "2026-08-16T12:00:10.000Z",
      tokens: { provenance: "unknown" },
      humanMessages: [
        { role: "user", content: "Inspect.", timestamp: "2026-08-16T12:00:01.000Z" },
      ],
      thread: { lastThreadAt: "2026-08-16T12:00:05.000Z", workingSince: "2026-08-16T12:00:01.000Z" },
      meta: { nowMs: Date.parse("2026-08-16T12:00:10.000Z") },
    });
    expect(agent.lastThreadAt).toBe("2026-08-16T12:00:05.000Z");
    expect(agent.workingSince).toBe("2026-08-16T12:00:01.000Z");
  });

  test("threadFromMessages matches the fallback used when Grok omits a parser clock", () => {
    expect(threadFromMessages([
      { role: "user", content: "hi", timestamp: "2026-08-16T12:00:01.000Z" },
      { role: "assistant", content: "yo", timestamp: "2026-08-16T12:00:02.000Z" },
    ])).toEqual({
      lastThreadAt: "2026-08-16T12:00:02.000Z",
      workingSince: "2026-08-16T12:00:01.000Z",
    });
  });
});
