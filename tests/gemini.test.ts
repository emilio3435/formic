import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { instanceIdFor } from "../src/server/collector-instances";
import { collectSessionProvider, DEFAULT_SESSION_WINDOW_MS } from "../src/server/collectors";
import { transcriptLines, transcriptResponse } from "../src/server/debug-identity";
import { buildSnapshot } from "../src/server/snapshot";
import { controlsFor } from "../src/server/snapshot-agent";
import { resolveAgentTarget } from "../src/server/targets";
import type { CmuxSurface } from "../src/server/types";
import type { AgentSnapshot } from "../src/shared/types";
import {
  collectGeminiSessions,
  GeminiReplay,
  parseGeminiJsonl,
  parseGeminiLegacyJson,
  replayGeminiText,
} from "../src/server/gemini";

const MAIN_ID = "abcd1234-e5f6-7890-abcd-ef1234567890";
const CHILD_ID = "11111111-2222-4333-8444-555555555555";
const PROJECT_HASH = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const NOW = Date.parse("2026-08-19T12:03:00.000Z");
const FIXTURE_ROOT = join(import.meta.dir, "fixtures/gemini");
const MAIN_FIXTURE = join(
  FIXTURE_ROOT,
  "demo-project/chats/session-2026-08-19T12-00-abcd1234.jsonl",
);
const archiveStore = { has: () => false, archive: async () => {} };

const fixture = (path: string): string => readFileSync(join(FIXTURE_ROOT, path), "utf8");
const metadata = (
  sessionId = MAIN_ID,
  patch: Record<string, unknown> = {},
): Record<string, unknown> => ({
  sessionId,
  projectHash: PROJECT_HASH,
  startTime: "2026-08-19T12:00:00.000Z",
  lastUpdated: "2026-08-19T12:01:00.000Z",
  kind: "main",
  ...patch,
});
const user = (id: string, content = "Inspect the Gemini session."): Record<string, unknown> => ({
  id,
  timestamp: "2026-08-19T12:00:05.000Z",
  type: "user",
  content,
});
const assistant = (
  id: string,
  content = "The Gemini session is valid.",
): Record<string, unknown> => ({
  id,
  timestamp: "2026-08-19T12:00:20.000Z",
  type: "gemini",
  model: "gemini-3.7-flash",
  content: [{ text: content }],
  tokens: { input: 100, output: 20, cached: 10, total: 125 },
});
const jsonl = (...rows: Record<string, unknown>[]): string =>
  `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;

const homes: string[] = [];
function tempHome(label: string): string {
  const home = mkdtempSync(join(tmpdir(), `formic-gemini-${label}-`));
  homes.push(home);
  return home;
}

function chatsRoot(home: string, project = "demo-project"): string {
  const root = join(home, ".gemini/tmp", project);
  mkdirSync(join(root, "chats"), { recursive: true });
  writeFileSync(join(root, ".project_root"), "/tmp/formic-gemini-fixture/demo-project\n");
  return join(root, "chats");
}

function writeSession(
  home: string,
  name: string,
  contents: string,
  project = "demo-project",
): string {
  const path = join(chatsRoot(home, project), name);
  writeFileSync(path, contents);
  return path;
}

afterEach(() => {
  delete process.env.GEMINI_CLI_HOME;
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("Gemini CLI pinned-schema replay", () => {
  test("JSONL replays metadata patches and rewinds while preserving source-backed fields", () => {
    const agent = parseGeminiJsonl(fixture("demo-project/chats/session-2026-08-19T12-00-abcd1234.jsonl"), {
      sourcePath: MAIN_FIXTURE,
      nowMs: NOW,
    }, { cwd: "/tmp/formic-gemini-fixture/demo-project" });

    expect(agent).toMatchObject({
      id: `gemini:${MAIN_ID}`,
      provider: "gemini",
      sourceSessionId: MAIN_ID,
      displayName: "Pinned schema fixture",
      identity: {
        name: "Pinned schema fixture",
        source: "authored",
        authoredBy: "gemini-title",
      },
      cwd: "/tmp/formic-gemini-fixture/demo-project",
      originCwd: "/tmp/formic-gemini-fixture/demo-project",
      model: "gemini-3.7-flash",
      task: "Inspect the pinned Gemini fixture.",
      lastUserMessage: "Inspect the pinned Gemini fixture.",
      lastAgentMessage: "The replay preserves the pinned records in source order.",
      lastAgentClosing: "The replay preserves the pinned records in source order.",
      tokens: {
        input: 120,
        output: 30,
        cachedInput: 12,
        total: 150,
        contextWindow: 1_048_576,
        scope: "latest-turn",
        provenance: "observed",
      },
      callSizes: [125, 150],
      allowCwdFallback: false,
    });
    expect(agent?.lastUserMessage).not.toContain("must be rewound");
    expect(agent?.effort).toBeUndefined();
    expect(agent?.launch).toBeUndefined();
    expect(agent?.launchCwd).toBeUndefined();
    expect(agent?.endEvidence).toBeUndefined();
    expect(agent?.transcriptEndedCleanly).toBeUndefined();
    expect(agent?.tokens.sessionTotal).toBeUndefined();
    expect(agent?.tokens.sessionCachedInput).toBeUndefined();
    expect(agent?.tokens.sessionProcessed).toBeUndefined();
    expect(agent?.cost).toBeUndefined();
    expect(agent?.processIds).toBeUndefined();
  });

  test("legacy ConversationRecord JSON remains readable without a schemaVersion", () => {
    const agent = parseGeminiLegacyJson(fixture("legacy-session.json"), { nowMs: NOW });
    expect(agent).toMatchObject({
      provider: "gemini",
      sourceSessionId: "deadbeef-e5f6-7890-abcd-ef1234567890",
      displayName: "Legacy Gemini fixture",
      task: "Read the legacy record.",
      lastAgentMessage: "The legacy record is readable.",
    });
    expect(JSON.stringify(agent)).not.toContain("schemaVersion");
  });

  test("a missing per-message model stays unknown instead of becoming a harness default", () => {
    const reply = assistant("model-unknown");
    delete reply.model;
    delete reply.tokens;
    const agent = parseGeminiJsonl(jsonl(metadata(), user("model-user"), reply), { nowMs: NOW });

    expect(agent?.model).toBeUndefined();
    expect(agent?.tokens.contextWindow).toBeUndefined();
    expect(agent?.tokens.input).toBeUndefined();
    expect(agent?.tokens.output).toBeUndefined();
    expect(agent?.tokens.cachedInput).toBeUndefined();
    expect(agent?.tokens.total).toBeUndefined();
    expect(agent?.tokens.sessionTotal).toBeUndefined();
    expect(agent?.tokens.sessionCachedInput).toBeUndefined();
    expect(agent?.tokens.sessionProcessed).toBeUndefined();
    expect(agent?.effort).toBeUndefined();
    expect(agent?.cost).toBeUndefined();

    const snapshot = buildSnapshot({
      agents: [agent!],
      surfaces: [],
      archiveStore,
      now: new Date(NOW),
    });
    const published = snapshot.programs.flatMap(({ agents }) => agents)[0];
    expect(published?.contextPct).toBeUndefined();
    expect(published?.tokens.sessionTotal).toBeUndefined();
    expect(published?.cost).toBeUndefined();
  });

  test("the short-id display fallback is not misreported as an authored title", () => {
    const toolOnly = assistant("tool-only", "");
    toolOnly.content = [];
    toolOnly.toolCalls = [{
      id: "tool-only-id",
      name: "read_file",
      status: "success",
      timestamp: "2026-08-19T12:00:15.000Z",
    }];
    const agent = parseGeminiJsonl(jsonl(metadata(), toolOnly), { nowMs: NOW });

    expect(agent?.displayName).toBe("Gemini · abcd1234");
    expect(agent?.identity).toMatchObject({
      name: "Gemini · abcd1234",
      base: "Gemini · abcd1234",
      source: "provider-fallback",
    });
    expect(agent?.identity?.authoredBy).toBeUndefined();
    expect(agent?.task).toBeUndefined();
  });

  test("the first resumable task remains the source name when cwd is also observed", () => {
    const agent = parseGeminiJsonl(
      jsonl(metadata(), user("task-user", "Inspect the source-backed task."), assistant("task-assistant")),
      { nowMs: NOW },
      { cwd: "/tmp/formic-gemini-fixture/demo-project" },
    );

    expect(agent?.displayName).toBe("Inspect the source-backed task.");
    expect(agent?.identity).toEqual({
      name: "Inspect the source-backed task.",
      base: "Inspect the source-backed task.",
      source: "task",
    });
    expect(agent?.cwd).toBe("/tmp/formic-gemini-fixture/demo-project");
    expect(agent?.originCwd).toBe("/tmp/formic-gemini-fixture/demo-project");
  });

  test("checkpoint $set.messages and duplicate native message ids replay in source position", () => {
    const replayed = replayGeminiText(jsonl(
      metadata(),
      user("discarded-user"),
      assistant("discarded-assistant"),
      {
        $set: {
          messages: [
            user("checkpoint-user", "Checkpoint user body."),
            assistant("checkpoint-assistant", "Checkpoint assistant body."),
          ],
        },
      },
      assistant("checkpoint-assistant", "Updated assistant body at the same native id."),
    ));

    expect(replayed?.messages.map(({ id }) => id)).toEqual([
      "checkpoint-user",
      "checkpoint-assistant",
    ]);
    expect(replayed?.messages[1]?.content).toEqual([{
      text: "Updated assistant body at the same native id.",
    }]);
  });

  test("source-authoritative $set.messages replaces discarded first-user identity", () => {
    const contents = jsonl(
      metadata(),
      user("discarded-user", "Discarded old task."),
      {
        $set: {
          messages: [
            user("current-user", "Current task."),
            assistant("current-assistant", "Current answer."),
          ],
        },
      },
    );

    const replayed = replayGeminiText(contents);
    const agent = parseGeminiJsonl(contents, { nowMs: NOW });

    expect(replayed?.messages.map(({ id }) => id)).toEqual([
      "current-user",
      "current-assistant",
    ]);
    expect(replayed?.firstUserMessage?.content).toBe("Current task.");
    expect(agent?.task).toBe("Current task.");
    expect(agent?.displayName).toBe("Current task.");

    const emptyCheckpoint = jsonl(
      metadata(),
      user("empty-discarded-user", "Discarded before empty checkpoint."),
      { $set: { messages: [] } },
    );
    expect({
      firstUserMessage: replayGeminiText(emptyCheckpoint)?.firstUserMessage,
      agent: parseGeminiJsonl(emptyCheckpoint, { nowMs: NOW }),
    }).toEqual({ firstUserMessage: undefined, agent: null });
  });

  test("exclusive $rewindTo recomputes retained first-user identity and cannot mint a row from discarded text", () => {
    const retainedContents = jsonl(
      metadata(),
      assistant("retained-assistant", "Retained assistant preface."),
      user("discarded-user", "Discarded rewind task."),
      { $rewindTo: "discarded-user" },
    );
    const replayed = replayGeminiText(retainedContents);
    const agent = parseGeminiJsonl(retainedContents, { nowMs: NOW });

    expect(replayed?.messages.map(({ id }) => id)).toEqual(["retained-assistant"]);
    expect(replayed?.firstUserMessage).toBeUndefined();
    expect(agent?.task).toBeUndefined();
    expect(agent?.displayName).toBe("Gemini · abcd1234");

    const discardedOnly = jsonl(
      metadata(),
      user("only-user", "Discarded only task."),
      { $rewindTo: "only-user" },
    );
    expect(parseGeminiJsonl(discardedOnly, { nowMs: NOW })).toBeNull();
  });

  test("duplicate replacement of retained first-user event updates replay identity", () => {
    const contents = jsonl(
      metadata(),
      user("first-user", "Original first task."),
      assistant("retained-assistant"),
      user("first-user", "Replacement first task."),
    );
    const replayed = replayGeminiText(contents);
    const agent = parseGeminiJsonl(contents, { nowMs: NOW });

    expect(replayed?.messages[0]?.content).toBe("Replacement first task.");
    expect(replayed?.firstUserMessage?.content).toBe("Replacement first task.");
    expect(agent?.task).toBe("Replacement first task.");
    expect(agent?.displayName).toBe("Replacement first task.");
  });

  test("malformed middle and truncated final records are skipped, but invalid identity is not admitted", () => {
    const validPrefix = jsonl(metadata(), user("user-1"), assistant("assistant-1")).trimEnd();
    const recovered = parseGeminiJsonl(`${validPrefix.split("\n")[0]}\nnot-json\n${validPrefix.split("\n").slice(1).join("\n")}\n{\"id\":\"cut`, {
      nowMs: NOW,
    });
    expect(recovered?.sourceSessionId).toBe(MAIN_ID);
    expect(recovered?.lastAgentMessage).toBe("The Gemini session is valid.");

    expect(parseGeminiJsonl(`{\"sessionId\":\"cut\n${JSON.stringify(user("user-1"))}\n`, { nowMs: NOW }))
      .toBeNull();
    expect(parseGeminiJsonl(jsonl(
      { ...metadata(), projectHash: undefined },
      user("user-1"),
      assistant("assistant-1"),
    ), { nowMs: NOW })).toBeNull();
    expect(parseGeminiJsonl(jsonl(
      metadata("not-a-uuid"),
      user("user-1"),
      assistant("assistant-1"),
    ), { nowMs: NOW })).toBeNull();
  });

  test("authored summaries use the shared bounded identity instead of bypassing it", () => {
    const agent = parseGeminiJsonl(jsonl(
      metadata(MAIN_ID, { summary: `Authored ${"x".repeat(2_000)}` }),
      user("summary-user"),
      assistant("summary-assistant"),
    ), { nowMs: NOW });

    expect(agent?.displayName).toBe(agent?.identity?.name);
    expect(agent?.displayName.length).toBeLessThanOrEqual(80);
    expect(agent?.identity?.source).toBe("authored");
  });

  test("replay state fails visibly before an unbounded message history is retained", () => {
    const replay = new GeminiReplay();
    replay.append(metadata());
    for (let index = 0; index < 4_096; index += 1) {
      replay.append(user(`message-${index}`, `message ${index}`));
    }
    replay.append(user("message-overflow", "overflow"));
    const countBounded = replay.conversation();

    expect(countBounded?.partial).toBeTrue();
    expect(countBounded?.warnings).toContain("Gemini replay retained only the newest 4096 messages");
    expect(countBounded?.messages.length).toBeLessThanOrEqual(4_096);
    expect(countBounded?.messages.at(-1)?.id).toBe("message-overflow");
    expect(countBounded?.firstUserMessage?.id).toBe("message-0");

    replay.append({ $rewindTo: "message-overflow" });
    const rewoundAfterTrim = replay.conversation();
    expect(rewoundAfterTrim?.messages.some(({ id }) => id === "message-overflow")).toBeFalse();
    expect(rewoundAfterTrim?.firstUserMessage?.id).toBe("message-0");

    const denseReplay = new GeminiReplay();
    denseReplay.append(metadata());
    const thoughts = Array.from({ length: 400 }, (_, index) => ({
      subject: `thought-${index}`,
      description: "x".repeat(6_000),
    }));
    denseReplay.append(user("dense-first-user", "Preserve this first task."));
    for (let index = 0; index < 12; index += 1) {
      denseReplay.append({ ...assistant(`dense-${index}`), thoughts });
    }
    const byteBounded = denseReplay.conversation();

    expect(byteBounded?.partial).toBeTrue();
    expect(byteBounded?.warnings).toContain(
      "Gemini replay retained only the newest messages within 16777216 byte cap",
    );
    expect(Buffer.byteLength(JSON.stringify(byteBounded?.messages))).toBeLessThanOrEqual(16 * 1024 * 1024);
    expect(byteBounded?.messages.at(-1)?.id).toBe("dense-11");
    expect(byteBounded?.firstUserMessage?.content).toBe("Preserve this first task.");
  });

  test("oversized speech is bounded through collection and oversized tool guts never enter the snapshot", async () => {
    const hugeSpeech = `speech-start ${"x".repeat(2_000_000)} speech-end`;
    const hugeTool = `tool-secret ${"y".repeat(2_000_000)} tool-end`;
    const row = assistant("assistant-large", hugeSpeech);
    row.toolCalls = [{
      id: "tool-large",
      name: "large_tool",
      args: { secret: hugeTool },
      result: [{ text: hugeTool }],
      resultDisplay: hugeTool,
      status: "success",
      timestamp: "2026-08-19T12:00:15.000Z",
    }];
    const contents = jsonl(metadata(), user("user-1"), row);
    const agent = parseGeminiJsonl(contents, { nowMs: NOW });

    expect(agent?.lastAgentMessage).toContain("speech-start");
    expect(agent?.lastAgentClosing).toContain("speech-end");
    expect(agent?.lastAgentMessage?.length).toBeLessThanOrEqual(240);
    expect(agent?.transcriptTail?.length).toBeLessThanOrEqual(800);
    expect(JSON.stringify(agent)).not.toContain("tool-secret");

    const home = tempHome("oversized-collection");
    writeSession(home, "session-2026-08-19T12-00-abcd1234.jsonl", contents);
    const collected = await collectSessionProvider("gemini", home, Number.POSITIVE_INFINITY);
    expect(collected.errors).toEqual([]);
    expect(collected.value).toHaveLength(1);
    expect(collected.value[0]?.lastAgentClosing).toContain("speech-end");
    expect(collected.value[0]?.transcriptTail?.length).toBeLessThanOrEqual(800);
    expect(JSON.stringify(collected.value[0])).not.toContain("tool-secret");
  }, 10_000);

  test("an above-cap JSONL record is isolated while an above-cap legacy document fails visibly", async () => {
    const huge = "x".repeat(8 * 1024 * 1024 + 1);
    const final = assistant("record-cap-final", "The safe final response survives.");
    delete final.model;
    delete final.tokens;

    const jsonlHome = tempHome("record-cap-jsonl");
    writeSession(jsonlHome, "session-2026-08-19T12-00-abcd1234.jsonl", jsonl(
      metadata(),
      user("record-cap-user"),
      assistant("record-cap-assistant", huge),
      final,
    ));
    const jsonlResult = await collectSessionProvider("gemini", jsonlHome, Number.POSITIVE_INFINITY);
    expect(jsonlResult.value).toHaveLength(1);
    expect(jsonlResult.value[0]?.lastAgentClosing).toBe("The safe final response survives.");
    expect(jsonlResult.value[0]?.model).toBeUndefined();
    expect(jsonlResult.value[0]?.tokens.total).toBeUndefined();
    expect(jsonlResult.errors).toHaveLength(1);
    expect(jsonlResult.errors[0]).toContain(
      "Gemini JSONL record exceeds 8388608 byte cap and was skipped",
    );

    const legacyHome = tempHome("record-cap-legacy");
    const legacyPath = join(chatsRoot(legacyHome), "session-2026-08-19T12-00-abcd1234.json");
    writeFileSync(legacyPath, JSON.stringify({
      ...metadata(),
      messages: [user("legacy-cap-user"), assistant("legacy-cap-assistant")],
      ignoredOversizedField: huge,
    }));
    const legacyResult = await collectSessionProvider("gemini", legacyHome, Number.POSITIVE_INFINITY);
    expect(legacyResult.value).toEqual([]);
    expect(legacyResult.errors).toHaveLength(1);
    expect(legacyResult.errors[0]).toContain("Gemini legacy transcript exceeds 8388608 byte cap");
  }, 15_000);

  test("the Inspector keeps safe later lines and marks a skipped oversized record truncated", async () => {
    const home = tempHome("inspector-record-cap");
    const final = assistant("inspector-cap-final", "Safe Inspector close.");
    delete final.model;
    delete final.tokens;
    const source = writeSession(home, "session-2026-08-19T12-00-abcd1234.jsonl", jsonl(
      metadata(),
      user("inspector-cap-user"),
      assistant("inspector-cap-assistant", "x".repeat(8 * 1024 * 1024 + 1)),
      final,
    ));
    const agent = parseGeminiJsonl(jsonl(
      metadata(), user("inspector-row-user"), assistant("inspector-row-assistant"),
    ), { sourcePath: source, nowMs: NOW })!;
    const snapshot = buildSnapshot({ agents: [agent], surfaces: [], archiveStore, now: new Date(NOW) });

    const response = await transcriptResponse(snapshot, agent.id, 200, {});
    const body = await response.json();

    expect(body.truncated).toBeTrue();
    expect(body.lines.at(-1)).toMatchObject({ role: "assistant", text: "Safe Inspector close." });
    expect(body.warning).toContain("Gemini JSONL record exceeds 8388608 byte cap and was skipped");
    expect(JSON.stringify(body)).not.toContain("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
  }, 15_000);

  test("inspector lines keep native thought and tool ids without exposing args or results", () => {
    const agent = parseGeminiJsonl(fixture("demo-project/chats/session-2026-08-19T12-00-abcd1234.jsonl"), {
      sourcePath: MAIN_FIXTURE,
      nowMs: NOW,
    });
    const lines = transcriptLines(
      agent as unknown as AgentSnapshot,
      fixture("demo-project/chats/session-2026-08-19T12-00-abcd1234.jsonl"),
    );
    expect(lines).toContainEqual({
      at: "2026-08-19T12:00:10.000Z",
      role: "system",
      text: "Thought\nInspect\nRead the synthetic fixture.",
    });
    expect(lines).toContainEqual({
      at: "2026-08-19T12:00:15.000Z",
      role: "tool",
      text: "list_directory\nCall: tool-1\nStatus: success",
    });
    expect(JSON.stringify(lines)).not.toContain("fixture-only output");
    expect(JSON.stringify(lines)).not.toContain('"path":"."');
  });
});

describe("Gemini CLI publication and controls", () => {
  test("a model-id word never becomes an unobserved Gemini effort", () => {
    const reply = assistant("effort-assistant");
    reply.model = "gemini-high-preview";
    const agent = parseGeminiJsonl(
      jsonl(metadata(), user("effort-user"), reply),
      { nowMs: NOW },
    )!;

    const snapshot = buildSnapshot({
      agents: [agent],
      surfaces: [],
      archiveStore,
      now: new Date(NOW),
    });
    const published = snapshot.programs.flatMap(({ agents }) => agents)[0];
    expect(published?.model).toBe("gemini-high-preview");
    expect(published?.effort).toBeUndefined();
  });

  test("snapshot exposure keeps evidence fields and exact cmux identity is the only control path", () => {
    const agent = parseGeminiJsonl(fixture("demo-project/chats/session-2026-08-19T12-00-abcd1234.jsonl"), {
      sourcePath: MAIN_FIXTURE,
      nowMs: NOW,
    }, { cwd: "/tmp/formic-gemini-fixture/demo-project" })!;
    const exactSurface: CmuxSurface = {
      workspaceId: "WORKSPACE-GEMINI",
      surfaceId: "SURFACE-GEMINI",
      paneId: "PANE-GEMINI",
      cwd: agent.cwd,
      sourceSessionIds: [MAIN_ID],
      sourceSessionClaims: [{ provider: "gemini", sessionId: MAIN_ID }],
    };
    const exact = resolveAgentTarget(agent, [exactSurface], [agent]);
    expect(exact).toMatchObject({
      surfaceId: "SURFACE-GEMINI",
      resolution: "exact",
      attestation: "live",
    });
    for (const action of ["focus", "instruct", "interrupt"] as const) {
      expect(controlsFor(agent, exact, false).find((control) => control.action === action)?.enabled)
        .toBeTrue();
    }

    const cwdOnly = resolveAgentTarget(agent, [{
      ...exactSurface,
      surfaceId: "SURFACE-CWD-ONLY",
      sourceSessionIds: [],
      sourceSessionClaims: [],
    }], [agent]);
    expect(cwdOnly).toMatchObject({
      resolution: "missing",
      reason: "This harness requires exact cmux identity; cwd fallback is disabled.",
    });
    for (const action of ["focus", "instruct", "interrupt"] as const) {
      expect(controlsFor(agent, cwdOnly, false).find((control) => control.action === action)?.enabled)
        .toBeFalse();
    }

    const snapshot = buildSnapshot({
      agents: [agent],
      surfaces: [exactSurface],
      archiveStore,
      now: new Date(NOW),
    });
    const published = snapshot.programs.flatMap(({ agents }) => agents)[0];
    expect(published).toMatchObject({
      provider: "gemini",
      sourceSessionId: MAIN_ID,
      model: "gemini-3.7-flash",
      originCwd: "/tmp/formic-gemini-fixture/demo-project",
      target: { resolution: "exact", surfaceId: "SURFACE-GEMINI" },
    });
    expect(published).not.toHaveProperty("callSizes");
    expect(published?.tokens.sessionTotal).toBeUndefined();
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let web: any;

  beforeAll(async () => {
    // @ts-expect-error the dependency-free browser client has no declaration file
    await import("../src/web/app.js");
    web = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
  });

  test("the official Gemini CLI harness icon stays distinct from the Gemini model sparkle", () => {
    const row = { provider: "gemini", model: "gemini-3.7-flash" };
    expect(web.HARNESS_MARK[web.harnessKeyOf(row)]).toEqual({
      src: "/icons/gemini-cli.svg",
      label: "Gemini CLI",
    });
    expect(web.AGENT_MARK[web.agentKeyOf(row)]).toEqual({
      src: "/icons/gemini.svg",
      label: "Gemini",
    });
    expect(web.HARNESS_MARK.gemini.src).not.toBe(web.AGENT_MARK.gemini.src);
  });
});

describe("Gemini CLI collection boundaries", () => {
  test("absent home, settings-only I-114, and an empty chats root remain distinct empty states", async () => {
    const absentHome = join(tempHome("absent"), "missing-home");
    expect(await collectSessionProvider("gemini", absentHome)).toEqual({
      value: [], errors: [], absent: true,
    });

    const settingsHome = tempHome("settings-only");
    mkdirSync(join(settingsHome, ".gemini"), { recursive: true });
    writeFileSync(join(settingsHome, ".gemini/settings.json"), JSON.stringify({ security: "do-not-read" }));
    const settingsOnly = await collectSessionProvider("gemini", settingsHome);
    expect(settingsOnly).toEqual({ value: [], errors: [], absent: true });
    expect(JSON.stringify(settingsOnly)).not.toContain("do-not-read");

    const emptyHome = tempHome("empty");
    chatsRoot(emptyHome);
    expect(await collectSessionProvider("gemini", emptyHome)).toEqual({ value: [], errors: [] });
  });

  test("the scan window excludes old files while keeping a fresh sibling", async () => {
    const home = tempHome("window");
    const old = writeSession(home, "session-2026-08-17T00-00-abcd1234.jsonl", jsonl(
      metadata("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"),
      user("old-user"),
      assistant("old-assistant"),
    ));
    const fresh = writeSession(home, "session-2026-08-19T12-00-bbbbbbbb.jsonl", jsonl(
      metadata("bbbbbbbb-cccc-4ddd-8eee-ffffffffffff"),
      user("fresh-user"),
      assistant("fresh-assistant"),
    ));
    utimesSync(old, new Date(NOW - DEFAULT_SESSION_WINDOW_MS - 1_000), new Date(NOW - DEFAULT_SESSION_WINDOW_MS - 1_000));
    utimesSync(fresh, new Date(NOW), new Date(NOW));

    const result = await collectGeminiSessions([join(home, ".gemini")], DEFAULT_SESSION_WINDOW_MS, undefined, NOW);
    expect(result.errors).toEqual([]);
    expect(result.value.map((agent) => agent.sourceSessionId)).toEqual([
      "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
    ]);
  });

  test("an oversized project marker leaves cwd unknown without dropping its session", async () => {
    const home = tempHome("oversized-project-root");
    writeSession(home, "session-2026-08-19T12-00-abcd1234.jsonl", jsonl(
      metadata(),
      user("marker-user"),
      assistant("marker-assistant"),
    ));
    writeFileSync(
      join(home, ".gemini/tmp/demo-project/.project_root"),
      `/${"x".repeat(2_000_000)}\n`,
    );

    const result = await collectSessionProvider("gemini", home, Number.POSITIVE_INFINITY);

    expect(result.errors).toEqual([]);
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.cwd).toBeUndefined();
    expect(result.value[0]?.originCwd).toBeUndefined();
  }, 10_000);

  test("hash and slug layouts deduplicate by full session id, keeping newer metadata", async () => {
    const home = tempHome("migration");
    const hash = "f".repeat(64);
    writeSession(home, "session-2026-08-19T11-00-abcd1234.jsonl", jsonl(
      metadata(MAIN_ID, { summary: "Older hash copy", lastUpdated: "2026-08-19T11:01:00.000Z" }),
      user("hash-user"),
      assistant("hash-assistant"),
    ), hash);
    writeSession(home, "session-2026-08-19T12-00-abcd1234.jsonl", jsonl(
      metadata(MAIN_ID, { summary: "Newer slug copy", lastUpdated: "2026-08-19T12:01:00.000Z" }),
      user("slug-user"),
      assistant("slug-assistant"),
    ));
    const legacyPath = join(chatsRoot(home), "session-2026-08-18T12-00-deadbeef.json");
    writeFileSync(legacyPath, fixture("legacy-session.json"));

    const result = await collectSessionProvider("gemini", home, Number.POSITIVE_INFINITY);
    expect(result.errors).toEqual([]);
    expect(result.value.filter((agent) => agent.sourceSessionId === MAIN_ID)).toHaveLength(1);
    expect(result.value.find((agent) => agent.sourceSessionId === MAIN_ID)?.displayName).toBe("Newer slug copy");
    expect(result.value.some((agent) => agent.sourceSessionId.startsWith("deadbeef-"))).toBe(true);
  });

  test("nested subagents keep their own identity and parent; root subagents are not main rows", async () => {
    const home = tempHome("subagent");
    const chats = chatsRoot(home);
    writeFileSync(join(chats, "session-2026-08-19T12-00-abcd1234.jsonl"), jsonl(
      metadata(MAIN_ID), user("main-user"), assistant("main-assistant"),
    ));
    mkdirSync(join(chats, MAIN_ID), { recursive: true });
    writeFileSync(join(chats, MAIN_ID, `${CHILD_ID}.jsonl`), jsonl(
      metadata(CHILD_ID, { kind: "subagent" }), user("child-user"), assistant("child-assistant"),
    ));
    writeFileSync(join(chats, "session-2026-08-19T12-00-cccccccc.jsonl"), jsonl(
      metadata("cccccccc-dddd-4eee-8fff-000000000000", { kind: "subagent" }),
      user("root-child-user"),
      assistant("root-child-assistant"),
    ));

    const result = await collectSessionProvider("gemini", home, Number.POSITIVE_INFINITY);
    expect(result.errors).toEqual([]);
    expect(result.value.map((agent) => agent.sourceSessionId).sort()).toEqual([CHILD_ID, MAIN_ID].sort());
    expect(result.value.find((agent) => agent.sourceSessionId === CHILD_ID)).toMatchObject({
      id: `gemini:${CHILD_ID}`,
      parentSourceSessionId: MAIN_ID,
      allowCwdFallback: false,
    });
  });

  test("Antigravity trees never become Gemini CLI rows", async () => {
    const home = tempHome("antigravity");
    const root = join(home, ".gemini/antigravity/conversations");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, `${MAIN_ID}.db`), "not-a-session");
    expect(await collectSessionProvider("gemini", home)).toMatchObject({ value: [], errors: [] });
  });

  test("GEMINI_CLI_HOME replaces only the default operator home", async () => {
    const override = tempHome("env-override");
    writeSession(override, "session-2026-08-19T12-00-abcd1234.jsonl", jsonl(
      metadata(), user("env-user"), assistant("env-assistant"),
    ));
    process.env.GEMINI_CLI_HOME = override;

    const fromDefault = await collectSessionProvider("gemini", homedir(), Number.POSITIVE_INFINITY);
    expect(fromDefault.value.map((agent) => agent.sourceSessionId)).toEqual([MAIN_ID]);

    const explicit = tempHome("explicit");
    const fromExplicit = await collectSessionProvider("gemini", explicit, Number.POSITIVE_INFINITY);
    expect(fromExplicit.value).toEqual([]);
  });

  test("an onboarded root collects with instance identity and a vanished root degrades the source", async () => {
    const home = tempHome("alternate-default");
    const alternateContainer = tempHome("alternate-root");
    const alternate = join(alternateContainer, ".gemini-2");
    const projectRoot = join(alternate, "tmp/demo-project");
    mkdirSync(join(projectRoot, "chats"), { recursive: true });
    writeFileSync(join(projectRoot, ".project_root"), "/tmp/formic-gemini-fixture/alternate\n");
    writeFileSync(
      join(projectRoot, "chats/session-2026-08-19T12-00-abcd1234.jsonl"),
      jsonl(metadata(), user("alternate-user"), assistant("alternate-assistant")),
    );

    const collected = await collectSessionProvider(
      "gemini",
      home,
      Number.POSITIVE_INFINITY,
      undefined,
      { extraGeminiCliRoots: [alternate] },
    );
    expect(collected.errors).toEqual([]);
    expect(collected.absent).toBeUndefined();
    expect(collected.value).toHaveLength(1);
    expect(collected.value[0]).toMatchObject({
      provider: "gemini",
      sourceSessionId: MAIN_ID,
      instanceId: instanceIdFor("gemini-cli", alternate),
      instanceLabel: ".gemini-2",
      cwd: "/tmp/formic-gemini-fixture/alternate",
    });

    const missingRoot = join(alternateContainer, ".gemini-gone");
    const missing = await collectSessionProvider(
      "gemini",
      home,
      Number.POSITIVE_INFINITY,
      undefined,
      { extraGeminiCliRoots: [missingRoot] },
    );
    expect(missing).toEqual({
      value: [],
      errors: [`gemini extra CLI root ${missingRoot}: not found`],
    });
  });

  test("same-basename onboarded roots keep distinct stable instance identities", async () => {
    const home = tempHome("same-basename-default");
    const profileA = tempHome("same-basename-a");
    const profileB = tempHome("same-basename-b");
    const rootA = join(profileA, ".gemini");
    const rootB = join(profileB, ".gemini");
    const sessionA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const sessionB = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
    writeSession(profileA, "session-2026-08-19T12-00-aaaaaaaa.jsonl", jsonl(
      metadata(sessionA), user("same-name-a-user"), assistant("same-name-a-assistant"),
    ));
    writeSession(profileB, "session-2026-08-19T12-00-bbbbbbbb.jsonl", jsonl(
      metadata(sessionB), user("same-name-b-user"), assistant("same-name-b-assistant"),
    ));

    const collect = async (extraGeminiCliRoots: string[]) => collectSessionProvider(
      "gemini",
      home,
      Number.POSITIVE_INFINITY,
      undefined,
      { extraGeminiCliRoots },
    );
    const forward = await collect([rootA, rootB]);
    const reverse = await collect([rootB, rootA]);
    const mapping = (rows: typeof forward.value) => Object.fromEntries(
      rows.map((row) => [row.sourceSessionId, row.instanceId]),
    );

    expect(forward.value).toHaveLength(2);
    expect(new Set(forward.value.map((row) => row.instanceId)).size).toBe(2);
    expect(mapping(reverse.value)).toEqual(mapping(forward.value));
  });

  test("a watchdog-aborted Gemini scan stops at the collector boundary", async () => {
    const home = tempHome("aborted");
    writeSession(home, "session-2026-08-19T12-00-abcd1234.jsonl", jsonl(
      metadata(),
      user("abort-user"),
      assistant("abort-assistant"),
    ));
    const abort = new AbortController();
    abort.abort(new Error("superseded Gemini scan"));

    await expect(collectSessionProvider(
      "gemini",
      home,
      Number.POSITIVE_INFINITY,
      undefined,
      {},
      abort.signal,
    )).rejects.toThrow("superseded Gemini scan");
  });
});
