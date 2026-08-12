import { describe, expect, test } from "bun:test";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  statSync,
  truncateSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  claudeContextWindow,
  collectSessions,
  DEFAULT_SESSION_WINDOW_MS,
  parseClaudeJsonl,
  parseCodexJsonl,
  parseOmpJsonl,
} from "../src/server/collectors";

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dir, "fixtures", name), "utf8");

/* These rows are about a session running AT THE HOME DIRECTORY, which is what
   makes "Home" the honest card name. Spelling one developer's home path here
   asserted that only where that developer ran it, so the naming rule went
   unchecked on every other machine — including CI, where it failed. */
const HOME_DIR = homedir();

const nowMs = Date.parse("2026-07-21T23:31:00.000Z");

describe("human-facing recency remains separate from provider activity", () => {
  test("OMP ignores later model and session machinery", () => {
    const agent = parseOmpJsonl([
      JSON.stringify({ type: "session", id: "omp-human-clock", timestamp: "2026-08-11T10:00:00.000Z" }),
      JSON.stringify({ type: "message", timestamp: "2026-08-11T10:00:01.000Z", message: { role: "user", content: "Please inspect the fleet." } }),
      JSON.stringify({ type: "message", timestamp: "2026-08-11T10:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "The fleet is stable." }] } }),
      JSON.stringify({ type: "model_change", timestamp: "2026-08-11T10:00:03.000Z", model: "gpt-5.6" }),
      JSON.stringify({ type: "custom", timestamp: "2026-08-11T10:00:04.000Z", data: { kind: "heartbeat" } }),
      JSON.stringify({ type: "message", message: { role: "assistant", content: "Readable, but without source time." } }),
    ].join("\n"), { nowMs: Date.parse("2026-08-11T10:00:05.000Z") });

    expect(agent?.lastHumanFacingAt).toBe("2026-08-11T10:00:02.000Z");
    expect(agent?.updatedAt).toBe("2026-08-11T10:00:04.000Z");
  });

  test("Codex ignores later reasoning, tool, and token records", () => {
    const agent = parseCodexJsonl([
      JSON.stringify({ type: "session_meta", timestamp: "2026-08-11T10:00:00.000Z", payload: { id: "codex-human-clock", cwd: "/tmp/formic" } }),
      JSON.stringify({ type: "event_msg", timestamp: "2026-08-11T10:00:01.000Z", payload: { type: "user_message", message: "Please inspect the fleet." } }),
      JSON.stringify({ type: "response_item", timestamp: "2026-08-11T10:00:02.000Z", payload: { type: "reasoning", summary: "internal" } }),
      JSON.stringify({ type: "response_item", timestamp: "2026-08-11T10:00:03.000Z", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "The fleet is stable." }] } }),
      JSON.stringify({ type: "response_item", timestamp: "2026-08-11T10:00:04.000Z", payload: { type: "function_call", name: "inspect" } }),
      JSON.stringify({ type: "response_item", timestamp: "2026-08-11T10:00:05.000Z", payload: { type: "function_call_output", output: "ok" } }),
      JSON.stringify({ type: "event_msg", timestamp: "2026-08-11T10:00:06.000Z", payload: { type: "token_count" } }),
      JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Readable, but without source time." }] } }),
    ].join("\n"), { nowMs: Date.parse("2026-08-11T10:00:07.000Z") });

    expect(agent?.lastHumanFacingAt).toBe("2026-08-11T10:00:03.000Z");
    expect(agent?.updatedAt).toBe("2026-08-11T10:00:06.000Z");
  });

  test("Claude ignores later thinking, tools, and injected metadata", () => {
    const agent = parseClaudeJsonl([
      JSON.stringify({ type: "user", sessionId: "claude-human-clock", cwd: "/tmp/formic", timestamp: "2026-08-11T10:00:01.000Z", message: { role: "user", content: "Please inspect the fleet." } }),
      JSON.stringify({ type: "assistant", sessionId: "claude-human-clock", cwd: "/tmp/formic", timestamp: "2026-08-11T10:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "The fleet is stable." }] } }),
      JSON.stringify({ type: "assistant", sessionId: "claude-human-clock", cwd: "/tmp/formic", timestamp: "2026-08-11T10:00:03.000Z", message: { role: "assistant", content: [{ type: "thinking", thinking: "internal" }, { type: "tool_use", name: "inspect" }] } }),
      JSON.stringify({ type: "user", sessionId: "claude-human-clock", cwd: "/tmp/formic", timestamp: "2026-08-11T10:00:04.000Z", isMeta: true, message: { role: "user", content: "Injected metadata." } }),
      JSON.stringify({ type: "assistant", sessionId: "claude-human-clock", cwd: "/tmp/formic", message: { role: "assistant", content: "Readable, but without source time." } }),
    ].join("\n"), { nowMs: Date.parse("2026-08-11T10:00:05.000Z") });

    expect(agent?.lastHumanFacingAt).toBe("2026-08-11T10:00:02.000Z");
    expect(agent?.updatedAt).toBe("2026-08-11T10:00:04.000Z");
  });
});

describe("collector identity and usage truth", () => {
  test("CWD-PROV-1 hook launch cwd is published without launch command material", async () => {
    const home = mkdtempSync(join(tmpdir(), "mountain-cwd-provenance-"));
    const sessions = join(home, ".codex", "sessions");
    const hookRoot = join(home, ".cmuxterm");
    const sessionId = "11111111-2222-4333-8444-555555555555";
    const currentCwd = join(home, "current");
    const launchCwd = join(home, "launch");
    mkdirSync(sessions, { recursive: true });
    mkdirSync(hookRoot, { recursive: true });
    mkdirSync(currentCwd);
    mkdirSync(launchCwd);
    writeFileSync(join(sessions, "session.jsonl"), `${JSON.stringify({
      type: "session_meta",
      timestamp: new Date().toISOString(),
      payload: { id: sessionId, cwd: currentCwd },
    })}\n`);
    writeFileSync(join(hookRoot, "codex-hook-sessions.json"), JSON.stringify({
      version: 1,
      sessions: {
        [sessionId]: {
          sessionId,
          surfaceId: "HOOK-SURFACE",
          workspaceId: "HOOK-WORKSPACE",
          cwd: join(home, "hook-current"),
          pid: 4242,
          agentLifecycle: "running",
          launchCommand: {
            executablePath: "SENTINEL_EXECUTABLE_MUST_NOT_PUBLISH",
            arguments: ["SENTINEL_ARGUMENT_MUST_NOT_PUBLISH"],
            workingDirectory: launchCwd,
          },
          updatedAt: 1_785_933_010.5,
        },
      },
    }));

    const collected = (await collectSessions(home)).codex.value[0];

    expect(collected).toMatchObject({ cwd: currentCwd, launchCwd });
    expect(JSON.stringify(collected)).not.toContain("SENTINEL_");
  });

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
    /* NOT archived. The parser used to close every OMP session it read, on the
       reasoning that OMP is a legacy read-only source — which made "this file
       is old" and "this session ended" the same statement, and put 724 of 815
       sessions into history whether or not any had ended. This fixture records
       no `session_exit`, so nothing here ended; its silence is read by the
       clock like every other provider's. */
    expect(agent?.status).toBe("stale");
    expect(agent?.endEvidence).toBeUndefined();
    expect(agent?.transcriptEndedCleanly).toBeUndefined();
    expect(agent?.statusReason).toContain("Legacy OMP history");
    expect(agent?.tokens).toEqual({
      input: 570,
      output: 385,
      cachedInput: 74_711,
      contextWindow: 1_000_000,
      /* `total` is the call's SIZE and keeps the re-read prefix, because a cached
         token still occupies the window. `sessionTotal` is CONSUMPTION and does
         not: 570 + 385 + 487 of cache writes. The 74,711 it used to swallow is
         the same context re-read, and it now has its own name. */
      total: 76_153,
      sessionTotal: 1_442,
      sessionCachedInput: 74_711,
      sessionProcessed: 76_153,
      scope: "latest-turn",
      provenance: "observed",
    });
    expect(agent?.tokens.contextWindow).toBe(1_000_000);
    expect(agent?.artifacts).toEqual([{
      label: "OMP transcript",
      path: "/Users/emilionunezgarcia/.omp/agent/sessions/-Developer-hd-master-health-tester-v2-20260721/session.jsonl",
      kind: "transcript",
    }]);
  });

  test("an explicit OMP session exit is preserved as clean transcript termination", () => {
    const agent = parseOmpJsonl([
      JSON.stringify({
        type: "session",
        id: "11111111-2222-3333-4444-555555555555",
        timestamp: "2026-07-21T23:00:00.000Z",
        cwd: "/Users/me/project",
      }),
      JSON.stringify({
        type: "custom",
        timestamp: "2026-07-21T23:00:01.000Z",
        data: { kind: "session_exit" },
      }),
    ].join("\n"), { nowMs });

    expect(agent).toMatchObject({
      status: "archived",
      transcriptEndedCleanly: true,
    });
  });

  test("Claude preserves its latest runtime session ID separately from the transcript source ID", () => {
    const sourceSessionId = "11111111-2222-3333-4444-555555555555";
    const runtimeSessionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const agent = parseClaudeJsonl([
      JSON.stringify({
        type: "user",
        timestamp: "2026-07-21T23:00:00.000Z",
        sessionId: sourceSessionId,
        session_id: sourceSessionId,
        cwd: "/Users/me/project",
        message: { role: "user", content: "Start the task." },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-07-21T23:00:01.000Z",
        sessionId: sourceSessionId,
        session_id: runtimeSessionId,
        cwd: "/Users/me/project",
        message: { role: "assistant", content: "Working." },
      }),
    ].join("\n"), { nowMs });

    expect(agent).toMatchObject({
      sourceSessionId,
      runtimeSessionId,
    });
  });

  test("bookkeeping rows appended to a dormant session do not refresh its activity", () => {
    /* Measured 2026-08-06: restarting one Claude session made Claude Code
       append untimestamped metadata (ai-title / last-prompt / mode /
       file-history-snapshot) to OTHER projects' dormant transcripts, and the
       mtime-vs-timestamp max promoted each to "working" for the fresh
       window — ghost sessions loading into the Working queue on every app
       restart, and re-loading on every session-list refresh. updatedAt is
       the last timestamped record; mtime is only the no-timestamps fallback,
       so the ghosts also age out of the lookback window like anything else. */
    const dormantNow = Date.parse("2026-08-06T21:00:00.000Z");
    const sessionId = "99999999-8888-7777-6666-555555555555";
    const agent = parseClaudeJsonl([
      JSON.stringify({
        type: "user",
        timestamp: "2026-08-05T12:20:52.323Z",
        sessionId,
        cwd: "/Users/me/project",
        message: { role: "user", content: "spin up the lanes and orchestrate" },
      }),
      // What the session-list enumeration appends: no timestamps anywhere.
      JSON.stringify({ type: "ai-title", aiTitle: "Inbox UX Overhaul", sessionId }),
      JSON.stringify({ type: "file-history-snapshot", messageId: "m1", snapshot: {}, isSnapshotUpdate: false }),
    ].join("\n"), { nowMs: dormantNow, mtimeMs: dormantNow });
    expect(agent?.updatedAt).toBe("2026-08-05T12:20:52.323Z");
    expect(agent?.status).not.toBe("running");
  });

  test("Codex clean completion applies only to the latest turn", () => {
    const sessionId = "11111111-2222-3333-4444-555555555555";
    const row = (type: string, payload: object) => JSON.stringify({
      type,
      timestamp: "2026-07-21T23:00:00.000Z",
      payload,
    });
    const completed = parseCodexJsonl([
      row("session_meta", { id: sessionId, cwd: "/Users/me/project" }),
      row("event_msg", { type: "user_message", message: "Finish this task." }),
      row("event_msg", { type: "task_complete" }),
    ].join("\n"), { nowMs });
    const continued = parseCodexJsonl([
      row("session_meta", { id: sessionId, cwd: "/Users/me/project" }),
      row("event_msg", { type: "user_message", message: "Finish this task." }),
      row("event_msg", { type: "task_complete" }),
      row("event_msg", { type: "user_message", message: "Start another task." }),
    ].join("\n"), { nowMs });

    expect(completed?.transcriptEndedCleanly).toBeTrue();
    expect(continued?.transcriptEndedCleanly).toBeUndefined();
  });

  test("Claude end_turn completion applies only until the next user turn", () => {
    const sessionId = "11111111-2222-3333-4444-555555555555";
    const row = (type: string, message: object) => JSON.stringify({
      type,
      sessionId,
      session_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      cwd: "/Users/me/project",
      timestamp: "2026-07-21T23:00:00.000Z",
      message,
    });
    const completed = parseClaudeJsonl([
      row("user", { role: "user", content: "Finish this task." }),
      row("assistant", { role: "assistant", content: "Done.", stop_reason: "end_turn" }),
    ].join("\n"), { nowMs });
    const continued = parseClaudeJsonl([
      row("user", { role: "user", content: "Finish this task." }),
      row("assistant", { role: "assistant", content: "Done.", stop_reason: "end_turn" }),
      row("user", { role: "user", content: "Start another task." }),
    ].join("\n"), { nowMs });

    expect(completed?.transcriptEndedCleanly).toBeTrue();
    expect(continued?.transcriptEndedCleanly).toBeUndefined();
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
      contextWindow: 1_000_000,
      total: 13,
      // Two calls of new work; the 74,716 of re-reads is carried separately.
      sessionTotal: 1_450,
      sessionCachedInput: 74_716,
      sessionProcessed: 76_166,
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
    // Historical because it is quiet, not because it is OMP. See above.
    expect(agent?.status).toBe("stale");
    expect(agent?.lastHumanMessage).toBe("Goal: Verify the immutable Lane 0 candidate. Success means: the gate is honest.");
  });

  test("an OMP session that really did exit is still archived, on its own record", () => {
    /* The other side of removing the blanket archive, and the reason removing it
       is safe: OMP does emit a genuine ending, and that ending is still honoured
       — now as the ONLY thing that closes an OMP session. */
    const exited = parseOmpJsonl([
      JSON.stringify({ type: "session", id: "019f86c4-1558-7000-aeb8-26e2cfd0e8ff", timestamp: "2026-07-21T22:00:00.000Z" }),
      JSON.stringify({ type: "custom", timestamp: "2026-07-21T22:20:00.000Z", data: { kind: "session_exit" } }),
    ].join("\n"), { nowMs });

    expect(exited?.status).toBe("archived");
    expect(exited?.endEvidence).toBe("session-exit");
    expect(exited?.transcriptEndedCleanly).toBe(true);
  });

  test("Codex exposes latest-request usage and keeps the cumulative session total separate", () => {
    const agent = parseCodexJsonl(fixture("codex-session.jsonl"), { nowMs });

    expect(agent).not.toBeNull();
    expect(agent?.tokens).toEqual({
      input: 36_887,
      output: 561,
      cachedInput: 24_192,
      total: 37_448,
      /* Codex's own cumulative total_tokens re-charges the re-read prefix every
         turn, because its input_tokens already contains cached_input_tokens.
         Cumulative input minus cached, plus output. */
      sessionTotal: 27_909,
      sessionCachedInput: 33_792,
      sessionProcessed: 61_701,
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

  test("Codex preserves an explicit routed context window", () => {
    const agent = parseCodexJsonl([
      JSON.stringify({
        type: "session_meta",
        timestamp: "2026-08-02T10:00:00.000Z",
        payload: { id: "codex-route-context", cwd: "/tmp/codex" },
      }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-08-02T10:05:00.000Z",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 1_000,
              cached_input_tokens: 100,
              output_tokens: 50,
              total_tokens: 1_050,
            },
            model_context_window: 65_536,
          },
        },
      }),
    ].join("\n"));

    expect(agent?.tokens.contextWindow).toBe(65_536);
  });

  test("codex parser records string launch evidence from session_meta", () => {
    const parse = (payload: Record<string, unknown>) => parseCodexJsonl(JSON.stringify({
      type: "session_meta",
      timestamp: "2026-08-05T12:00:00.000Z",
      payload: {
        id: "019fd501-3322-7180-8990-b6af48404e15",
        cwd: "/tmp/anthill-launch",
        ...payload,
      },
    }), { nowMs });

    expect(parse({ originator: "codex_exec", source: "exec" })?.launch).toEqual({
      entrypoint: "codex_exec",
      promptSource: "exec",
    });
    expect(parse({ originator: "codex-tui", source: "cli" })?.launch).toEqual({
      entrypoint: "codex-tui",
      promptSource: "cli",
    });
    expect(parse({ originator: "codex-tui", source: { subagent: {} } })?.launch).toEqual({
      entrypoint: "codex-tui",
    });
  });

  test("Codex summary chooses the latest readable prose and keeps technical tail evidence separate", () => {
    const agent = parseCodexJsonl(fixture("codex-human-message-session.jsonl"), { nowMs });

    expect(agent?.lastHumanMessage).toBe("The identity route is ready for review.");
    expect(agent?.lastHumanMessage).not.toContain("diff --git");
    expect(agent?.lastHumanMessage).not.toContain("tool_result");
    expect(agent?.lastHumanMessage).not.toContain("identity.ts");
    expect(agent?.transcriptTail).toContain("git diff --check");
  });

  test("empty Codex transcripts report no readable human message", () => {
    const agent = parseCodexJsonl(fixture("empty-transcript-session.jsonl"), { nowMs });

    expect(agent?.task).toBeUndefined();
    expect(agent?.lastHumanMessage).toBeNull();
  });

  test("Codex leaves the model undefined when the transcript never reports one", () => {
    const agent = parseCodexJsonl(fixture("codex-session-without-model.jsonl"), { nowMs });

    expect(agent?.model).toBeUndefined();
  });

  test("Codex derives a cumulative total from source components when total_tokens is absent", () => {
    const session = fixture("codex-session.jsonl").replace('"total_tokens":61701', '"total_tokens":null');
    const agent = parseCodexJsonl(session, { nowMs });

    expect(agent?.tokens.total).toBe(37_448);
    expect(agent?.tokens.sessionTotal).toBe(27_909);
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
          cwd: HOME_DIR,
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
          cwd: HOME_DIR,
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
      identity: {
        name: "Fermat",
        source: "authored",
        authoredBy: "codex-nickname",
      },
    });
  });

  test("Codex preserves a native top-level parent_thread_id for inherited guardian sessions", () => {
    const agent = parseCodexJsonl(JSON.stringify({
      type: "session_meta",
      timestamp: "2026-07-21T23:00:00.000Z",
      payload: {
        id: "019f87f0-6961-78e2-b6ae-0e310751dda2",
        parent_thread_id: "019f8650-960c-7dc0-b75a-68dda4a57a1b",
        cwd: HOME_DIR,
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
        cwd: HOME_DIR,
      },
    }), { nowMs });

    expect(agent?.displayName).toBe("Codex · Home");
    expect(agent?.displayName).not.toContain("019f87f0");
  });

  test("a handoff path is kept in task truth but not used as the primary card name", () => {
    const agent = parseCodexJsonl([
      JSON.stringify({
        type: "session_meta",
        payload: { id: "019f87f0-6961-78e2-b6ae-0e310751dda2", cwd: HOME_DIR },
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
      // No cache reads in this fixture, so consumption and size agree.
      sessionTotal: 50_790,
      sessionCachedInput: 0,
      sessionProcessed: 50_790,
      contextWindow: 1_000_000,
      scope: "latest-turn",
      provenance: "observed",
    });
  });

  test("claude parser records launch evidence from the transcript envelope", () => {
    const row = (extra: Record<string, unknown>) => JSON.stringify({
      sessionId: "sdk-1",
      cwd: "/tmp/anthill-launch",
      timestamp: "2026-07-21T23:30:00.000Z",
      uuid: "u1",
      isSidechain: false,
      userType: "external",
      version: "2.0.0",
      ...extra,
    });
    const sdk = parseClaudeJsonl([
      row({
        type: "user",
        entrypoint: "sdk-py",
        promptSource: "sdk",
        message: {
          role: "user",
          content: "Review this change for security vulnerabilities.\n\nChanged files: x",
        },
      }),
    ].join("\n"), { nowMs });
    expect(sdk?.launch).toEqual({ entrypoint: "sdk-py", promptSource: "sdk" });

    const cli = parseClaudeJsonl([
      row({
        type: "user",
        entrypoint: "cli",
        message: { role: "user", content: "Fix the flaky lifecycle test." },
      }),
    ].join("\n"), { nowMs });
    expect(cli?.launch).toEqual({ entrypoint: "cli" });
  });

  test("Claude derives the 1M context window for supported models, undefined otherwise", () => {
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

    expect(claudeContextWindow("claude-opus-5")).toBe(1_000_000);
    expect(claudeContextWindow("claude-opus-4-7")).toBe(1_000_000);
    expect(parseClaudeJsonl(row("claude-opus-4-8"), { nowMs })?.tokens.contextWindow).toBe(1_000_000);
    expect(parseClaudeJsonl(row("claude-opus-4-8[1m]"), { nowMs })?.tokens.contextWindow).toBe(1_000_000);
    expect(parseClaudeJsonl(row("claude-sonnet-5"), { nowMs })?.tokens.contextWindow).toBe(1_000_000);
    expect(parseClaudeJsonl(row("claude-fable-5"), { nowMs })?.tokens.contextWindow).toBe(1_000_000);
    // An explicit [1m] marker is honored even for a model not in the table (ground truth).
    expect(parseClaudeJsonl(row("claude-haiku-5[1m]"), { nowMs })?.tokens.contextWindow).toBe(1_000_000);
    // Unknown / not-yet-confirmed windows stay undefined so the UI shows an honest token count.
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
      /* Consumption, deduplicated: msg-one 10+40+20 = 70 counted ONCE despite
         two rows, plus msg-two 5+8+6 = 19. Double-counting the repeat would
         read 159, and summing cache reads too would read 126 — the old value. */
      sessionTotal: 89,
      // The re-reads those two calls made, under their own name: 30 + 7.
      sessionCachedInput: 37,
      /* PROCESSED, the unit OpenBurnBar records: the same two calls at full
         size, 100 + 26. Note it is the 126 the comment above calls "the old
         value" — that number was never wrong, it was the wrong ANSWER to
         "what did this consume". It is the right answer to "what did the
         provider process", and it is now published under that name instead of
         being mistaken for the other. */
      sessionProcessed: 126,
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
        cwd: HOME_DIR,
        timestamp: "2026-07-21T23:00:00.000Z",
        message: { role: "user", content: "<recommended_plugins>...</recommended_plugins>" },
      }),
      JSON.stringify({
        type: "user",
        sessionId: "c7754d67-b9cd-4050-9ab4-76e4851e318d",
        cwd: HOME_DIR,
        timestamp: "2026-07-21T23:00:01.000Z",
        message: { role: "user", content: "Mission: Redesign the Platforms operating room." },
      }),
    ].join("\n"), { nowMs });

    expect(agent?.task).toBe("Mission: Redesign the Platforms operating room.");
    expect(agent?.displayName).toBe("Claude · Home");
  });

  /* The drawer prints `task` under the heading as the standing objective, so
     anything that survives collection is read as a sentence a human wrote.
     Three live agents printed `<command-name>/model</command-name>` there, with
     the command's own stdout — ANSI escapes and all — queued right behind it. */
  test("slash-command plumbing is chrome, not the objective, and the next instruction is", () => {
    const claudeUser = (content: string, at: string) => JSON.stringify({
      type: "user",
      sessionId: "c7754d67-b9cd-4050-9ab4-76e4851e318d",
      cwd: HOME_DIR,
      timestamp: at,
      message: { role: "user", content },
    });
    const agent = parseClaudeJsonl([
      claudeUser(
        "<command-name>/model</command-name>\n"
        + "            <command-message>model</command-message>\n"
        + "            <command-args></command-args>",
        "2026-07-21T23:00:00.000Z",
      ),
      claudeUser(
        "<local-command-stdout>Set model to [1mFable 5[22m and saved as your"
        + " default for new sessions</local-command-stdout>",
        "2026-07-21T23:00:01.000Z",
      ),
      claudeUser("Fix the evidence drawer's clipped controls.", "2026-07-21T23:00:02.000Z"),
    ].join("\n"), { nowMs });

    expect(agent?.task).toBe("Fix the evidence drawer's clipped controls.");
    expect(agent?.task).not.toContain("<command-name>");
    expect(agent?.task).not.toContain("<local-command-stdout>");
  });

  test("a slash command's arguments are the objective, as the sentence they were typed as", () => {
    const agent = parseClaudeJsonl(JSON.stringify({
      type: "user",
      sessionId: "c7754d67-b9cd-4050-9ab4-76e4851e318d",
      cwd: HOME_DIR,
      timestamp: "2026-07-21T23:00:00.000Z",
      message: {
        role: "user",
        content: "<command-name>/qa</command-name>\n"
          + "            <command-message>qa</command-message>\n"
          + "            <command-args>fix the login page</command-args>",
      },
    }), { nowMs });

    expect(agent?.task).toBe("/qa fix the login page");
    expect(agent?.task).not.toContain("<command-args>");
  });

  test("partially written trailing records do not erase a valid live session", () => {
    const agent = parseOmpJsonl(`${fixture("omp-session.jsonl")}\n{"type":"message"`, {
      nowMs,
    });

    expect(agent?.sourceSessionId).toBe("019f86c4-1558-7000-aeb8-26e2cfd0e8ec");
    expect(agent?.displayName).toBe("Health tester");
  });

  test("a scan evicts cached files that are no longer present", async () => {
    const home = mkdtempSync(join(tmpdir(), "mountain-collector-cache-"));
    const sessions = join(home, ".codex", "sessions");
    const path = join(sessions, "session.jsonl");
    mkdirSync(sessions, { recursive: true });
    const transcript = (id: string) => JSON.stringify({
      type: "session_meta",
      timestamp: "2026-07-21T23:00:00.000Z",
      payload: { id, cwd: "/tmp/project" },
    });
    const fixedTime = new Date();

    writeFileSync(path, `${transcript("session-a")}\n`);
    utimesSync(path, fixedTime, fixedTime);
    expect((await collectSessions(home)).codex.value[0]?.sourceSessionId).toBe("session-a");

    unlinkSync(path);
    expect((await collectSessions(home)).codex.value).toEqual([]);

    writeFileSync(path, `${transcript("session-b")}\n`);
    utimesSync(path, fixedTime, fixedTime);
    expect((await collectSessions(home)).codex.value[0]?.sourceSessionId).toBe("session-b");
  });

  test("incremental appends retain exact process evidence for the next identity scan", async () => {
    const home = mkdtempSync(join(tmpdir(), "mountain-collector-process-"));
    const sessions = join(home, ".codex", "sessions");
    const path = join(sessions, "session.jsonl");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(path, `${JSON.stringify({
      type: "session_meta",
      timestamp: new Date().toISOString(),
      payload: {
        id: "11111111-2222-3333-4444-555555555555",
        cwd: "/tmp/project",
      },
    })}\n`);
    const first = (await collectSessions(home)).codex.value[0]!;
    first.processIds = [4242];
    first.processAlive = true;

    appendFileSync(path, `${JSON.stringify({
      type: "event_msg",
      timestamp: new Date().toISOString(),
      payload: { type: "task_complete" },
    })}\n`);
    const updated = (await collectSessions(home)).codex.value[0];

    expect(updated).toMatchObject({
      processIds: [4242],
      processAlive: true,
      transcriptEndedCleanly: true,
    });
  });

  test("hook facts recover missing cwd and reject a reused pid by start time", async () => {
    const home = mkdtempSync(join(tmpdir(), "mountain-collector-hook-"));
    const sessions = join(home, ".codex", "sessions");
    const hookRoot = join(home, ".cmuxterm");
    const deletedCwd = join(home, "deleted-worktree");
    const sessionId = "11111111-2222-4333-8444-555555555555";
    mkdirSync(sessions, { recursive: true });
    mkdirSync(hookRoot, { recursive: true });
    writeFileSync(join(sessions, "session.jsonl"), `${JSON.stringify({
      type: "session_meta",
      timestamp: new Date().toISOString(),
      payload: { id: sessionId },
    })}\n`);
    writeFileSync(join(hookRoot, "codex-hook-sessions.json"), JSON.stringify({
      version: 1,
      sessions: {
        [sessionId]: {
          sessionId,
          surfaceId: "HOOK-SURFACE",
          workspaceId: "HOOK-WORKSPACE",
          cwd: deletedCwd,
          pid: 4242,
          pidStartSeconds: 1_785_933_001,
          agentLifecycle: "needsInput",
          updatedAt: 1_785_933_010.5,
        },
      },
    }));

    const matching = await collectSessions(home, DEFAULT_SESSION_WINDOW_MS, undefined, {
      hookProcessStarts: () => new Map([[4242, 1_785_933_001]]),
    });
    expect(matching.codex.value[0]).toMatchObject({
      cwd: deletedCwd,
      hookLifecycle: "needsInput",
      processIds: [4242],
      processAlive: true,
    });
    expect(matching.codex.value[0]?.endEvidence).toBeUndefined();

    const reused = await collectSessions(home, DEFAULT_SESSION_WINDOW_MS, undefined, {
      hookProcessStarts: () => new Map([[4242, 1_785_933_000]]),
    });
    expect(reused.codex.value[0]).toMatchObject({
      processIds: [4242],
      processAlive: false,
      endEvidence: "worktree-deleted",
    });
  });

  /* Measured on this machine 2026-08-05: three hook records sat on live pids
     with no recorded start time, and the board called all three alive. The
     processes actually holding those numbers were `/usr/libexec/siriknowledged`,
     `speechmaintenanced`, and `Siri.app` — one of them "live" for 33 hours. A
     pid is not an identity; without a start time there is nothing to check it
     against, and the honest answer is that we cannot tell. */
  test("a hook pid with no recorded start time is not evidence the session lives", async () => {
    const home = mkdtempSync(join(tmpdir(), "mountain-collector-hook-nostart-"));
    const sessions = join(home, ".codex", "sessions");
    const hookRoot = join(home, ".cmuxterm");
    const sessionId = "11111111-2222-4333-8444-555555555555";
    mkdirSync(sessions, { recursive: true });
    mkdirSync(hookRoot, { recursive: true });
    writeFileSync(join(sessions, "session.jsonl"), `${JSON.stringify({
      type: "session_meta",
      timestamp: new Date().toISOString(),
      payload: { id: sessionId },
    })}\n`);
    writeFileSync(join(hookRoot, "codex-hook-sessions.json"), JSON.stringify({
      version: 1,
      sessions: {
        [sessionId]: {
          sessionId,
          surfaceId: "HOOK-SURFACE",
          workspaceId: "HOOK-WORKSPACE",
          cwd: home,
          pid: 4242,
          // pidStartSeconds deliberately absent — the defect this pins.
          agentLifecycle: "needsInput",
          updatedAt: 1_785_933_010.5,
        },
      },
    }));

    const collected = await collectSessions(home, DEFAULT_SESSION_WINDOW_MS, undefined, {
      hookProcessStarts: () => new Map([[4242, 1_785_933_001]]),
    });

    // Unknown, not alive.
    expect(collected.codex.value[0]?.processAlive).toBeUndefined();
    /* And the number is not claimed as this session's process either: a pid we
       cannot tie to the session must not later be re-read as "its process is
       still running" by a bare presence check. */
    expect(collected.codex.value[0]?.processIds).toBeUndefined();
  });

  test("incremental collection matches a full re-read across append, rotation, truncation, and replacement", async () => {
    const home = mkdtempSync(join(tmpdir(), "mountain-collector-incremental-"));
    const sessions = join(home, ".codex", "sessions");
    const path = join(sessions, "session.jsonl");
    mkdirSync(sessions, { recursive: true });
    const timestamp = new Date().toISOString();
    const session = (id: string) => JSON.stringify({
      type: "session_meta",
      timestamp,
      payload: { id, cwd: "/tmp/project" },
    });
    const user = (message: string) => JSON.stringify({
      type: "event_msg",
      timestamp,
      payload: { type: "user_message", message },
    });
    const assistant = (message: string) => JSON.stringify({
      type: "response_item",
      timestamp,
      payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: message }] },
    });
    const expectMatchesFullRead = async () => {
      const details = statSync(path);
      const full = parseCodexJsonl(readFileSync(path, "utf8"), {
        sourcePath: path,
        mtimeMs: details.mtimeMs,
      });
      if (!full) throw new Error("full fixture parse unexpectedly returned null");
      expect((await collectSessions(home)).codex.value[0]).toEqual(full);
    };

    writeFileSync(path, `${session("append-session")}\n${user("Initial task.")}\n`);
    await expectMatchesFullRead();

    const partial = assistant("Append completed.");
    appendFileSync(path, partial);
    expect((await collectSessions(home)).codex.value[0]?.lastAgentMessage).toBeNull();
    appendFileSync(path, "\n");
    await expectMatchesFullRead();

    renameSync(path, `${path}.rotated`);
    writeFileSync(path, `${session("rotated-session")}\n${user("Rotated task.")}\n`);
    await expectMatchesFullRead();

    truncateSync(path, 0);
    writeFileSync(path, `${session("short")}\n`);
    await expectMatchesFullRead();

    const replacement = `${path}.replacement`;
    writeFileSync(replacement, `${session("replacement-session")}\n${user("Replacement task.")}\n`);
    renameSync(replacement, path);
    await expectMatchesFullRead();
  });

  /* A directory we cannot scan is not a provider with no sessions. The walk
     used to swallow every readdir failure and return [], so a permissions or
     I/O fault reported zero agents AND zero errors — which state.ts reads as a
     healthy source, putting a confident empty fleet on the board. */
  test("an unscannable sessions directory degrades the source instead of reporting zero agents", async () => {
    const home = mkdtempSync(join(tmpdir(), "mountain-collector-unreadable-"));
    // A plain file where the sessions directory belongs: readdir gives ENOTDIR,
    // which is a real fault, unlike the ENOENT of a provider that never ran.
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(join(home, ".codex", "sessions"), "not a directory");

    const codex = (await collectSessions(home)).codex;
    expect(codex.value).toEqual([]);
    expect(codex.errors.length).toBeGreaterThan(0);
    expect(codex.errors.join(" ")).toContain("codex");
  });

  test("a provider that has never run stays silent rather than reporting an error", async () => {
    // ENOENT is the normal state before a provider writes its first session.
    const home = mkdtempSync(join(tmpdir(), "mountain-collector-absent-"));
    const codex = (await collectSessions(home)).codex;
    expect(codex.value).toEqual([]);
    expect(codex.errors).toEqual([]);
  });
});
