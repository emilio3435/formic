import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectSessions, parseClaudeJsonl } from "../src/server/collectors";
import { sessionCallsResponse } from "../src/server/session-calls";
import { buildSnapshot } from "../src/server/snapshot";

const PARENT_SESSION_ID = "11111111-1111-4111-8111-111111111111";
const CHILD_AGENT_ID = "a2222222222222222";
const CHILD_SOURCE_SESSION_ID = `${PARENT_SESSION_ID}/agent-${CHILD_AGENT_ID}`;

const childTranscript = (timestamp: string, agentId: string | null = CHILD_AGENT_ID): string => [
  JSON.stringify({
    type: "user",
    sessionId: PARENT_SESSION_ID,
    isSidechain: true,
    agentId: agentId ?? undefined,
    cwd: "/tmp/claude-child",
    timestamp,
    message: { role: "user", content: "Measure this child independently." },
  }),
  JSON.stringify({
    type: "assistant",
    sessionId: PARENT_SESSION_ID,
    isSidechain: true,
    agentId: agentId ?? undefined,
    cwd: "/tmp/claude-child",
    timestamp,
    requestId: "req-child",
    message: {
      id: "msg-child",
      role: "assistant",
      model: "claude-opus-4-8",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Measured." }],
      usage: {
        input_tokens: 2,
        output_tokens: 3,
        cache_read_input_tokens: 5,
        cache_creation_input_tokens: 7,
      },
    },
  }),
].join("\n");

const parentTranscript = (timestamp: string): string => [
  JSON.stringify({
    type: "user",
    sessionId: PARENT_SESSION_ID,
    cwd: "/tmp/claude-parent",
    timestamp,
    message: { role: "user", content: "Measure the parent independently." },
  }),
  JSON.stringify({
    type: "assistant",
    sessionId: PARENT_SESSION_ID,
    cwd: "/tmp/claude-parent",
    timestamp,
    requestId: "req-parent",
    message: {
      id: "msg-parent",
      role: "assistant",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Measured." }],
      usage: { input_tokens: 11, output_tokens: 13 },
    },
  }),
].join("\n");

describe("Claude child usage remains attributable", () => {
  test("a sidechain keeps its provider-native child identity and parent lineage", () => {
    const child = parseClaudeJsonl(childTranscript("2026-08-10T20:00:00.000Z"));

    expect(child?.sourceSessionId).toBe(CHILD_SOURCE_SESSION_ID);
    expect(child?.parentSourceSessionId).toBe(PARENT_SESSION_ID);
    expect(child?.tokens.sessionProcessed).toBe(17);
    expect(child?.tokens.sessionTotal).toBe(12);
    expect(
      (child as typeof child & { processedSnapshots?: unknown })?.processedSnapshots,
      "adjudication needs the cumulative total at the foreign recorder's end time",
    ).toEqual([{ at: "2026-08-10T20:00:00.000Z", total: 17 }]);
  });

  test("child identity fails closed when path and embedded evidence conflict", () => {
    expect(() => parseClaudeJsonl(
      childTranscript("2026-08-10T20:00:00.000Z", "a3333333333333333"),
      { sourcePath: `/tmp/subagents/agent-${CHILD_AGENT_ID}.jsonl` },
    )).toThrow("path and embedded child agent id disagree");

    expect(() => parseClaudeJsonl(
      childTranscript("2026-08-10T20:00:00.000Z", null),
      { sourcePath: "/tmp/subagents/not-a-child.jsonl" },
    )).toThrow("no safe child agent id");
  });

  test("timestamp-bounded evidence is withheld when usage time is incomplete or out of order", () => {
    const untimestamped = childTranscript("2026-08-10T20:00:00.000Z")
      .split("\n")
      .map((line, index) => {
        const row = JSON.parse(line);
        if (index === 1) delete row.timestamp;
        return JSON.stringify(row);
      })
      .join("\n");
    expect(parseClaudeJsonl(untimestamped)?.processedSnapshots).toBeUndefined();

    const rows = childTranscript("2026-08-10T20:00:00.000Z").split("\n").map((line) => JSON.parse(line));
    rows.push({
      ...rows[1],
      timestamp: "2026-08-10T19:59:59.000Z",
      requestId: "req-earlier",
      message: { ...rows[1].message, id: "msg-earlier" },
    });
    expect(parseClaudeJsonl(rows.map((row) => JSON.stringify(row)).join("\n"))?.processedSnapshots)
      .toBeUndefined();
  });

  test("collection reaches nested subagent transcripts instead of dropping their usage", async () => {
    const home = mkdtempSync(join(tmpdir(), "anthill-claude-child-"));
    const childDirectory = join(
      home,
      ".claude",
      "projects",
      "project",
      PARENT_SESSION_ID,
      "subagents",
    );
    try {
      mkdirSync(childDirectory, { recursive: true });
      const timestamp = new Date().toISOString();
      writeFileSync(
        join(home, ".claude", "projects", "project", `${PARENT_SESSION_ID}.jsonl`),
        `${parentTranscript(timestamp)}\n`,
      );
      writeFileSync(
        join(childDirectory, `agent-${CHILD_AGENT_ID}.jsonl`),
        `${childTranscript(timestamp)}\n`,
      );

      const collected = await collectSessions(home);
      expect(collected.claude.errors).toEqual([]);
      const parent = collected.claude.value.find((agent) => agent.sourceSessionId === PARENT_SESSION_ID);
      const child = collected.claude.value.find((agent) => agent.sourceSessionId === CHILD_SOURCE_SESSION_ID);
      expect(child, "a scanner that stops above subagents makes their measured tokens disappear").toBeDefined();
      expect(child?.id).not.toBe(parent?.id);
      expect(child?.tokens.sessionProcessed).toBe(17);
      expect(parent?.tokens.sessionProcessed, "child tokens must not be folded into the parent").toBe(24);

      const snapshot = buildSnapshot({
        agents: collected.claude.value,
        surfaces: [],
        archiveStore: { has: () => false, archive: async () => {} },
        now: new Date(timestamp),
      });
      const publishedChild = snapshot.programs
        .flatMap((program) => program.agents)
        .find((agent) => agent.id === child?.id);
      expect(publishedChild).not.toHaveProperty("processedSnapshots");
      const response = await sessionCallsResponse(snapshot, child!.id, {});
      const body = await response.json() as { processedSnapshots?: unknown };
      expect(body.processedSnapshots).toEqual([{ at: timestamp, total: 17 }]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
