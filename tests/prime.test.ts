import { describe, expect, test } from "bun:test";
import { parsePrimeJsonl } from "../src/server/prime";

describe("Prime human-facing recency", () => {
  test("uses readable message timestamps and ignores later machine activity", () => {
    const agent = parsePrimeJsonl([
      JSON.stringify({ type: "session", id: "prime-human-clock", cwd: "/tmp/formic", timestamp: "2026-08-11T10:00:00.000Z" }),
      JSON.stringify({ type: "message", timestamp: "2026-08-11T10:00:01.000Z", message: { role: "user", content: "Please inspect Prime." } }),
      JSON.stringify({ type: "message", timestamp: "2026-08-11T10:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "Prime is ready." }] } }),
      JSON.stringify({ type: "message", timestamp: "2026-08-11T10:00:03.000Z", message: { role: "assistant", content: [{ type: "reasoning", text: "internal" }, { type: "tool_result", text: "ok" }] } }),
      JSON.stringify({ type: "message", message: { role: "assistant", content: "Readable, but without source time." } }),
    ].join("\n"), { nowMs: Date.parse("2026-08-11T10:00:04.000Z") });

    expect(agent?.lastHumanFacingAt).toBe("2026-08-11T10:00:02.000Z");
    expect(agent?.updatedAt).toBe("2026-08-11T10:00:03.000Z");
    expect(agent?.lastThreadAt).toBe("2026-08-11T10:00:03.000Z");
    expect(agent?.workingSince).toBe("2026-08-11T10:00:01.000Z");
    expect(agent?.lastUserMessage).toBe("Please inspect Prime.");
    expect(agent?.lastAgentClosing).toBeTruthy();
    expect(agent?.status).toBe("running");
  });

  test("an assistant question is the closing, not the kickoff", () => {
    const agent = parsePrimeJsonl([
      JSON.stringify({ type: "session", id: "prime-ask", cwd: "/tmp/formic", timestamp: "2026-08-11T10:00:00.000Z" }),
      JSON.stringify({ type: "message", timestamp: "2026-08-11T10:00:01.000Z", message: { role: "user", content: "Port the rate limiter." } }),
      JSON.stringify({ type: "message", timestamp: "2026-08-11T10:00:02.000Z", message: { role: "assistant", content: "Should I land this now?" } }),
    ].join("\n"), { nowMs: Date.parse("2026-08-11T10:00:04.000Z") });

    expect(agent?.lastAgentClosing).toBe("Should I land this now?");
    expect(agent?.lastUserMessage).toBe("Port the rate limiter.");
    expect(agent?.status).toBe("running");
  });

  test("a grok model uses the catalog 500k window instead of an invented 131k fallback", () => {
    const agent = parsePrimeJsonl([
      JSON.stringify({ type: "session", id: "prime-grok-window", cwd: "/tmp/formic", timestamp: "2026-08-11T10:00:00.000Z" }),
      JSON.stringify({ type: "model_change", modelId: "grok-4.6" }),
      JSON.stringify({ type: "message", timestamp: "2026-08-11T10:00:01.000Z", message: { role: "user", content: "Use Grok." } }),
    ].join("\n"), { nowMs: Date.parse("2026-08-11T10:00:04.000Z") });

    expect(agent?.model).toBe("grok-4.6");
    expect(agent?.tokens.contextWindow).toBe(500_000);
  });

  test("an unknown Prime model leaves the window unset instead of inventing 131k", () => {
    const agent = parsePrimeJsonl([
      JSON.stringify({ type: "session", id: "prime-mystery-window", cwd: "/tmp/formic", timestamp: "2026-08-11T10:00:00.000Z" }),
      JSON.stringify({ type: "model_change", modelId: "mystery-lite" }),
      JSON.stringify({ type: "message", timestamp: "2026-08-11T10:00:01.000Z", message: { role: "user", content: "No catalog needle." } }),
    ].join("\n"), { nowMs: Date.parse("2026-08-11T10:00:04.000Z") });

    expect(agent?.model).toBe("mystery-lite");
    expect(agent?.tokens).not.toHaveProperty("contextWindow");
  });

  test("preserves the reserved heartbeat session classification", () => {
    const agent = parsePrimeJsonl([
      JSON.stringify({ type: "session", id: "ant-heartbeat-monitor", timestamp: "2026-08-11T10:00:00.000Z" }),
      JSON.stringify({ type: "message", timestamp: "2026-08-11T10:00:01.000Z", message: { role: "assistant", content: "Heartbeat stable." } }),
    ].join("\n"));

    expect(agent).toMatchObject({ sessionKind: "system", sessionKindSource: "declared" });
  });

  test("normalizes a valid nested message timestamp when the row clock is malformed", () => {
    const agent = parsePrimeJsonl([
      JSON.stringify({ type: "session", id: "prime-nested-human-clock", timestamp: "2026-08-11T10:00:00.000Z" }),
      JSON.stringify({
        type: "message",
        timestamp: "not-a-time",
        message: {
          role: "assistant",
          timestamp: "2026-08-11T10:00:01-05:00",
          content: "Prime nested clock is valid.",
        },
      }),
    ].join("\n"));

    expect(agent?.lastHumanFacingAt).toBe("2026-08-11T15:00:01.000Z");
  });
});
