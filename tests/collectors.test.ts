import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseClaudeJsonl,
  parseCodexJsonl,
  parseOmpJsonl,
} from "../src/server/collectors";

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dir, "fixtures", name), "utf8");

const nowMs = Date.parse("2026-07-21T23:31:00.000Z");

describe("collector identity and usage truth", () => {
  test("OMP exposes its final observed turn separately from the cumulative session total", () => {
    const agent = parseOmpJsonl(fixture("omp-session.jsonl"), {
      sourcePath:
        "/Users/emilionunezgarcia/.omp/agent/sessions/-Developer-hd-master-health-tester-v2-20260721/session.jsonl",
      nowMs,
    });

    expect(agent).not.toBeNull();
    expect(agent?.sourceSessionId).toBe("019f86c4-1558-7000-aeb8-26e2cfd0e8ec");
    expect(agent?.cwd).toBe(
      "/Users/emilionunezgarcia/Developer/hd-master-health-tester-v2-20260721",
    );
    expect(agent?.cwd).not.toBe(
      "/Users/emilionunezgarcia/Developer/hd/master/health/tester/v2/20260721",
    );
    expect(agent?.displayName).toBe("Health tester");
    expect(agent?.status).toBe("archived");
    expect(agent?.statusReason).toContain("Legacy OMP history");
    expect(agent?.tokens).toEqual({
      input: 570,
      output: 385,
      cachedInput: 74_711,
      total: 76_153,
      sessionTotal: 76_153,
      scope: "latest-turn",
      provenance: "observed",
    });
    expect(agent?.tokens.contextWindow).toBeUndefined();
    expect(agent?.artifacts).toEqual([{
      label: "OMP transcript",
      path: "/Users/emilionunezgarcia/.omp/agent/sessions/-Developer-hd-master-health-tester-v2-20260721/session.jsonl",
      kind: "transcript",
    }]);
  });

  test("OMP leaves token usage unknown when no assistant usage record exists", () => {
    const agent = parseOmpJsonl([
      JSON.stringify({
        type: "session",
        id: "019f86c4-1558-7000-aeb8-26e2cfd0e8ec",
        timestamp: "2026-07-21T22:20:25.304Z",
      }),
      JSON.stringify({
        type: "message",
        message: { role: "assistant", content: [{ type: "text", text: "No usage payload." }] },
      }),
    ].join("\n"), { nowMs });

    expect(agent?.tokens).toEqual({ scope: "unknown", provenance: "unknown" });
  });

  test("OMP keeps the cumulative session total separate from the latest assistant turn", () => {
    const agent = parseOmpJsonl([
      fixture("omp-session.jsonl"),
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          usage: { input: 3, output: 4, cacheRead: 5, cacheWrite: 1, totalTokens: 13 },
        },
      }),
    ].join("\n"), { nowMs });

    expect(agent?.tokens).toEqual({
      input: 3,
      output: 4,
      cachedInput: 5,
      total: 13,
      sessionTotal: 76_166,
      scope: "latest-turn",
      provenance: "observed",
    });
  });

  test("legacy OMP records stay historical and unwrap prompt-file names", () => {
    const agent = parseOmpJsonl([
      JSON.stringify({ type: "title", title: "Session update [in progress — more steps follow]" }),
      JSON.stringify({
        type: "session",
        id: "019f86c4-1558-7000-aeb8-26e2cfd0e8ec",
        timestamp: "2026-07-21T22:20:25.304Z",
        cwd: "/Users/emilionunezgarcia/Developer/hd-master-health-20260721",
      }),
      JSON.stringify({
        type: "message",
        timestamp: "2026-07-21T22:20:26.000Z",
        message: {
          role: "user",
          content: [{
            type: "text",
            text: "### Session update [in progress — more steps follow]\n\n**user**:\n<file name=\"/private/tmp/review.md\">\nGoal: Verify the immutable Lane 0 candidate.\n\nSuccess means: the gate is honest.\n</file>",
          }],
        },
      }),
    ].join("\n"), { nowMs });

    expect(agent?.task).toBe(
      "Goal: Verify the immutable Lane 0 candidate.\n\nSuccess means: the gate is honest.",
    );
    expect(agent?.displayName).toBe("OMP · hd-master-health-20260721");
    expect(agent?.status).toBe("archived");
    expect(agent?.lastHumanMessage).toBe("Goal: Verify the immutable Lane 0 candidate. Success means: the gate is honest.");
  });

  test("Codex exposes latest-request usage and keeps the cumulative session total separate", () => {
    const agent = parseCodexJsonl(fixture("codex-session.jsonl"), { nowMs });

    expect(agent).not.toBeNull();
    expect(agent?.tokens).toEqual({
      input: 36_887,
      output: 561,
      cachedInput: 24_192,
      total: 37_448,
      sessionTotal: 61_701,
      contextWindow: 258_400,
      scope: "latest-turn",
      provenance: "observed",
    });
    expect(agent?.tokens.total).not.toBe(
      (agent?.tokens.input ?? 0) +
        (agent?.tokens.cachedInput ?? 0) +
        (agent?.tokens.output ?? 0),
    );
    expect(agent?.task).toBe("Implement safe identity routing.");
    expect(agent?.effort).toBe("xhigh");
  });

  test("Codex summary chooses the latest readable prose and keeps technical tail evidence separate", () => {
    const agent = parseCodexJsonl(fixture("codex-human-message-session.jsonl"), { nowMs });

    expect(agent?.lastHumanMessage).toBe("The identity route is ready for review.");
    expect(agent?.lastHumanMessage).not.toContain("diff --git");
    expect(agent?.lastHumanMessage).not.toContain("tool_result");
    expect(agent?.lastHumanMessage).not.toContain("identity.ts");
    expect(agent?.transcriptTail).toContain("git diff --check");
  });

  test("empty Codex transcripts use the concise status reason as the final fallback", () => {
    const agent = parseCodexJsonl(fixture("empty-transcript-session.jsonl"), { nowMs });

    expect(agent?.task).toBeUndefined();
    expect(agent?.lastHumanMessage).toBe("No source activity in the last 3 minutes.");
  });

  test("Codex leaves the model undefined when the transcript never reports one", () => {
    const agent = parseCodexJsonl(fixture("codex-session-without-model.jsonl"), { nowMs });

    expect(agent?.model).toBeUndefined();
  });

  test("Codex derives a cumulative total from source components when total_tokens is absent", () => {
    const session = fixture("codex-session.jsonl").replace('"total_tokens":61701', '"total_tokens":null');
    const agent = parseCodexJsonl(session, { nowMs });

    expect(agent?.tokens.total).toBe(37_448);
    expect(agent?.tokens.sessionTotal).toBe(61_701);
  });

  test("Codex omits the context window when its observed token event does not report one", () => {
    const session = fixture("codex-session.jsonl").replace(',"model_context_window":258400', "");
    const agent = parseCodexJsonl(session, { nowMs });

    expect(agent?.tokens).toMatchObject({
      total: 37_448,
      scope: "latest-turn",
      provenance: "observed",
    });
    expect(agent?.tokens.contextWindow).toBeUndefined();
  });

  test("Codex skips injected context and names the card from the real assignment", () => {
    const agent = parseCodexJsonl([
      JSON.stringify({
        type: "session_meta",
        timestamp: "2026-07-21T23:00:00.000Z",
        payload: {
          id: "019f87f0-6961-78e2-b6ae-0e310751dda2",
          cwd: "/Users/emilionunezgarcia",
        },
      }),
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "# AGENTS.md instructions for /Users/emilionunezgarcia\n\n<INSTRUCTIONS>...",
        },
      }),
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "<environment_context>...</environment_context>" }],
        },
      }),
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "Goal: This inherited parent assignment must not name the subagent.",
        },
      }),
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "# AGENTS.md instructions\n\n<INSTRUCTIONS>Replacement rules...</INSTRUCTIONS>",
        },
      }),
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "Goal: Restore the Hormiga settings cockpit safely.\n\nSuccess means: all focused tests pass.",
        },
      }),
    ].join("\n"), { nowMs });

    expect(agent?.task).toBe(
      "Goal: Restore the Hormiga settings cockpit safely.\n\nSuccess means: all focused tests pass.",
    );
    expect(agent?.displayName).toBe("Codex · Home");
  });

  test("Codex preserves native parent-thread evidence for swarm hierarchy", () => {
    const agent = parseCodexJsonl([
      JSON.stringify({
        type: "session_meta",
        timestamp: "2026-07-21T23:00:00.000Z",
        payload: {
          id: "019f87f0-6961-78e2-b6ae-0e310751dda2",
          cwd: "/Users/emilionunezgarcia",
          source: {
            subagent: {
              thread_spawn: {
                parent_thread_id: "019f8650-960c-7dc0-b75a-68dda4a57a1b",
                depth: 2,
                agent_nickname: "Fermat",
              },
            },
          },
        },
      }),
      JSON.stringify({
        type: "event_msg",
        payload: { type: "user_message", message: "Goal: Verify the provider registry." },
      }),
    ].join("\n"), { nowMs });

    expect(agent).toMatchObject({
      parentSourceSessionId: "019f8650-960c-7dc0-b75a-68dda4a57a1b",
      threadDepth: 2,
      nickname: "Fermat",
    });
  });

  test("Codex preserves a native top-level parent_thread_id for inherited guardian sessions", () => {
    const agent = parseCodexJsonl(JSON.stringify({
      type: "session_meta",
      timestamp: "2026-07-21T23:00:00.000Z",
      payload: {
        id: "019f87f0-6961-78e2-b6ae-0e310751dda2",
        parent_thread_id: "019f8650-960c-7dc0-b75a-68dda4a57a1b",
        cwd: "/Users/emilionunezgarcia",
        source: { subagent: { other: "guardian" } },
      },
    }), { nowMs });

    expect(agent?.parentSourceSessionId).toBe("019f8650-960c-7dc0-b75a-68dda4a57a1b");
  });

  test("taskless home sessions use a readable provider label instead of a UUID fragment", () => {
    const agent = parseCodexJsonl(JSON.stringify({
      type: "session_meta",
      timestamp: "2026-07-21T23:00:00.000Z",
      payload: {
        id: "019f87f0-6961-78e2-b6ae-0e310751dda2",
        cwd: "/Users/emilionunezgarcia",
      },
    }), { nowMs });

    expect(agent?.displayName).toBe("Codex · Home");
    expect(agent?.displayName).not.toContain("019f87f0");
  });

  test("a handoff path is kept in task truth but not used as the primary card name", () => {
    const agent = parseCodexJsonl([
      JSON.stringify({
        type: "session_meta",
        payload: { id: "019f87f0-6961-78e2-b6ae-0e310751dda2", cwd: "/Users/emilionunezgarcia" },
      }),
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "/Users/me/handoff.md <-- help me revamp The Mountain control hub.",
        },
      }),
    ].join("\n"), { nowMs });

    expect(agent?.task).toStartWith("/Users/me/handoff.md <--");
    expect(agent?.displayName).toBe("Codex · Home");
    expect(agent?.displayName).not.toContain("help me revamp");
  });

  test("Claude preserves the source session, cwd, model, task, and observed token provenance", () => {
    const agent = parseClaudeJsonl(fixture("claude-session.jsonl"), { nowMs });

    expect(agent).not.toBeNull();
    expect(agent).toMatchObject({
      provider: "claude",
      sourceSessionId: "c7754d67-b9cd-4050-9ab4-76e4851e318d",
      cwd: "/Users/emilionunezgarcia/Developer/the-mountain",
      model: "claude-fable-5",
      effort: "high",
      task: "Design the responsive command center.",
      transcriptTail: "The UI now exposes routing health before controls.",
      lastHumanMessage: "The UI now exposes routing health before controls.",
    });
    expect(agent?.tokens.provenance).toBe("observed");
    expect(agent?.tokens).toEqual({
      input: 6,
      output: 1_598,
      cachedInput: 0,
      total: 50_790,
      sessionTotal: 50_790,
      contextWindow: 1_000_000,
      scope: "latest-turn",
      provenance: "observed",
    });
  });

  test("Claude derives the 1M context window for Opus 4.8, Sonnet 5, and Fable 5, undefined otherwise", () => {
    const row = (model: string) => JSON.stringify({
      type: "assistant",
      sessionId: "c7754d67-b9cd-4050-9ab4-76e4851e318d",
      cwd: "/Users/emilionunezgarcia/Developer/the-mountain",
      timestamp: "2026-07-21T23:30:02.000Z",
      message: {
        id: "msg-ctx",
        role: "assistant",
        model,
        content: [{ type: "text", text: "Working." }],
        usage: { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 40 },
      },
    });

    expect(parseClaudeJsonl(row("claude-opus-4-8"), { nowMs })?.tokens.contextWindow).toBe(1_000_000);
    expect(parseClaudeJsonl(row("claude-opus-4-8[1m]"), { nowMs })?.tokens.contextWindow).toBe(1_000_000);
    expect(parseClaudeJsonl(row("claude-sonnet-5"), { nowMs })?.tokens.contextWindow).toBe(1_000_000);
    expect(parseClaudeJsonl(row("claude-fable-5"), { nowMs })?.tokens.contextWindow).toBe(1_000_000);
    // An explicit [1m] marker is honored even for a model not in the table (ground truth).
    expect(parseClaudeJsonl(row("claude-haiku-5[1m]"), { nowMs })?.tokens.contextWindow).toBe(1_000_000);
    // Unknown / not-yet-confirmed windows stay undefined so the UI shows an honest token count.
    expect(parseClaudeJsonl(row("claude-opus-4-7"), { nowMs })?.tokens.contextWindow).toBeUndefined();
    expect(parseClaudeJsonl(row("claude-haiku-5"), { nowMs })?.tokens.contextWindow).toBeUndefined();
  });

  test("Claude counts repeated rows for one message ID once and exposes the latest request", () => {
    const base = {
      type: "assistant",
      sessionId: "c7754d67-b9cd-4050-9ab4-76e4851e318d",
      cwd: "/Users/emilionunezgarcia/Developer/the-mountain",
      timestamp: "2026-07-21T23:30:02.000Z",
      message: {
        id: "msg-one",
        role: "assistant",
        model: "claude-fable-5",
        content: [{ type: "text", text: "Working." }],
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 30,
          output_tokens: 40,
        },
      },
    };
    const agent = parseClaudeJsonl([
      JSON.stringify(base),
      JSON.stringify({ ...base, timestamp: "2026-07-21T23:30:03.000Z" }),
      JSON.stringify({
        ...base,
        timestamp: "2026-07-21T23:30:04.000Z",
        message: {
          ...base.message,
          id: "msg-two",
          usage: {
            input_tokens: 5,
            cache_creation_input_tokens: 6,
            cache_read_input_tokens: 7,
            output_tokens: 8,
          },
        },
      }),
    ].join("\n"), { nowMs });

    expect(agent?.tokens).toEqual({
      input: 5,
      output: 8,
      cachedInput: 7,
      total: 26,
      sessionTotal: 126,
      contextWindow: 1_000_000,
      scope: "latest-turn",
      provenance: "observed",
    });
  });

  test("Claude leaves token usage unknown when the source has no assistant usage", () => {
    const agent = parseClaudeJsonl(JSON.stringify({
      type: "user",
      sessionId: "c7754d67-b9cd-4050-9ab4-76e4851e318d",
      cwd: "/Users/emilionunezgarcia/Developer/the-mountain",
      timestamp: "2026-07-21T23:30:00.000Z",
      message: { role: "user", content: "Inspect without usage." },
    }), { nowMs });

    expect(agent?.tokens).toEqual({ scope: "unknown", provenance: "unknown" });
  });

  test("Claude ignores metadata envelopes before choosing a human card name", () => {
    const agent = parseClaudeJsonl([
      JSON.stringify({
        type: "user",
        sessionId: "c7754d67-b9cd-4050-9ab4-76e4851e318d",
        cwd: "/Users/emilionunezgarcia",
        timestamp: "2026-07-21T23:00:00.000Z",
        message: { role: "user", content: "<recommended_plugins>...</recommended_plugins>" },
      }),
      JSON.stringify({
        type: "user",
        sessionId: "c7754d67-b9cd-4050-9ab4-76e4851e318d",
        cwd: "/Users/emilionunezgarcia",
        timestamp: "2026-07-21T23:00:01.000Z",
        message: { role: "user", content: "Mission: Redesign the Platforms operating room." },
      }),
    ].join("\n"), { nowMs });

    expect(agent?.task).toBe("Mission: Redesign the Platforms operating room.");
    expect(agent?.displayName).toBe("Claude · Home");
  });

  test("partially written trailing records do not erase a valid live session", () => {
    const agent = parseOmpJsonl(`${fixture("omp-session.jsonl")}\n{"type":"message"`, {
      nowMs,
    });

    expect(agent?.sourceSessionId).toBe("019f86c4-1558-7000-aeb8-26e2cfd0e8ec");
    expect(agent?.displayName).toBe("Health tester");
  });
});
