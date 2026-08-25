import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fsPromises from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { instanceIdFor } from "../src/server/collector-instances";
import { transcriptResponse } from "../src/server/debug-identity";
import {
  MAX_HUMAN_MESSAGE_CHARS,
  readableClosing,
  readableHumanMessage,
} from "../src/server/human-message";
import {
  collectKimiSessions,
  KIMI_DEFAULT_DATA_DIR,
  KIMI_SESSION_META_VERSION,
  KIMI_WIRE_PROTOCOL_VERSION,
  readKimiWireFile,
  type KimiCollectOptions,
} from "../src/server/kimi";
import { MAX_NAME_LENGTH } from "../src/server/naming";
import { sessionCallsResponse } from "../src/server/session-calls";
import {
  MAX_TRANSCRIPT_TAIL_CHARS,
  type CollectedAgent,
  type CollectionResult,
} from "../src/server/types";
import type { HubSnapshot, Provider } from "../src/shared/types";

// Pinned fixture: 0999454 / @moonshot-ai/kimi-code 0.38.0 / wire 1.5 / meta v2.
const KIMI = "kimi" as Provider;
const KIMI_KIND = "kimi" as Parameters<typeof instanceIdFor>[0];
const SESSION_ID = "session_01234567-89ab-4cde-8f01-23456789abcd";
const PARENT_ID = "session_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const WORK_DIR_KEY = "wd_tmp-formic-kimi-fixture-project_8936c6cc0b42";
const FIXTURE_HOME = join(import.meta.dir, "fixtures/kimi/home");
const FIXTURE_SESSION = join(FIXTURE_HOME, "sessions", WORK_DIR_KEY, SESSION_ID);
const FIXTURE_STATE = join(FIXTURE_SESSION, "state.json");
const FIXTURE_MAIN_WIRE = join(FIXTURE_SESSION, "agents/main/wire.jsonl");
const FIXTURE_CHILD_WIRE = join(FIXTURE_SESSION, "agents/agent-0/wire.jsonl");
const CREATED_AT = 1_787_324_400_000;
const UPDATED_AT = 1_787_324_408_000;
const temporaryRoots: string[] = [];

type JsonRecord = Record<string, any>;
type FixtureDraft = {
  state?: JsonRecord;
  indexText: string;
  mainText?: string;
  childText?: string;
};

interface MaterializedFixture {
  root: string;
  sessionDir: string;
  state: string;
  mainWire: string;
  childWire: string;
}

function tempRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `formic-kimi-red-${label}-`));
  temporaryRoots.push(root);
  return root;
}

function jsonlRows(text: string): JsonRecord[] {
  return text.trim().split("\n").map((line) => JSON.parse(line));
}

function jsonl(rows: readonly JsonRecord[]): string {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function materializeAt(
  root: string,
  mutate?: (draft: FixtureDraft) => void,
): MaterializedFixture {
  const sessionDir = join(root, "sessions", WORK_DIR_KEY, SESSION_ID);
  const statePath = join(sessionDir, "state.json");
  const mainWire = join(sessionDir, "agents/main/wire.jsonl");
  const childWire = join(sessionDir, "agents/agent-0/wire.jsonl");
  const draft: FixtureDraft = {
    state: JSON.parse(readFileSync(FIXTURE_STATE, "utf8")),
    indexText: jsonl([{
      sessionId: SESSION_ID,
      sessionDir,
      workDir: "/tmp/formic-kimi-fixture/project",
    }]),
    mainText: readFileSync(FIXTURE_MAIN_WIRE, "utf8"),
    childText: readFileSync(FIXTURE_CHILD_WIRE, "utf8"),
  };
  mutate?.(draft);
  mkdirSync(join(sessionDir, "agents/main"), { recursive: true });
  mkdirSync(join(sessionDir, "agents/agent-0"), { recursive: true });
  writeFileSync(join(root, "session_index.jsonl"), draft.indexText);
  if (draft.state !== undefined) writeFileSync(statePath, `${JSON.stringify(draft.state, null, 2)}\n`);
  if (draft.mainText !== undefined) writeFileSync(mainWire, draft.mainText);
  if (draft.childText !== undefined) writeFileSync(childWire, draft.childText);
  return { root, sessionDir, state: statePath, mainWire, childWire };
}

function directFixture(label: string, mutate?: (draft: FixtureDraft) => void): MaterializedFixture {
  return materializeAt(join(tempRoot(label), "kimi-home"), mutate);
}

function defaultFixture(label: string, mutate?: (draft: FixtureDraft) => void): {
  operatorHome: string;
  fixture: MaterializedFixture;
} {
  const operatorHome = tempRoot(label);
  return {
    operatorHome,
    fixture: materializeAt(join(operatorHome, KIMI_DEFAULT_DATA_DIR), mutate),
  };
}

function wireMutation(draft: FixtureDraft, change: (rows: JsonRecord[]) => JsonRecord[]): void {
  draft.mainText = jsonl(change(jsonlRows(draft.mainText ?? "")));
}

async function collectKimi(
  home: string,
  options: KimiCollectOptions = {},
  signal?: AbortSignal,
): Promise<CollectionResult<CollectedAgent[]>> {
  return collectKimiSessions(home, Number.POSITIVE_INFINITY, undefined, options, signal);
}

function onlyAgent(result: CollectionResult<CollectedAgent[]>): any {
  return result.value.length === 1 ? result.value[0] : undefined;
}

function manualKimiAgent(source: string): CollectedAgent {
  return {
    id: `kimi:${SESSION_ID}`,
    provider: KIMI,
    sourceSessionId: SESSION_ID,
    runtimeSessionId: SESSION_ID,
    displayName: "Kimi public fixture contract",
    cwd: "/tmp/formic-kimi-fixture/project",
    status: "waiting",
    statusReason: "Kimi Code source is quiet.",
    updatedAt: new Date(UPDATED_AT).toISOString(),
    tokens: { scope: "unknown", provenance: "unknown" },
    artifacts: [{ label: "Kimi Code session", path: source, kind: "transcript" }],
    gates: [],
    allowCwdFallback: false,
  };
}

function endpointSnapshot(agent: CollectedAgent): HubSnapshot {
  return { programs: [{ agents: [agent] }] } as unknown as HubSnapshot;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Kimi Code CLI assertion-only source contract", () => {
  test("KIMI-RED-01 current wire 1.5 metadata v2 fixture publishes exact core source evidence", async () => {
    const { operatorHome, fixture } = defaultFixture("current", (draft) => {
      Object.assign(draft.state ?? {}, {
        lastPrompt: "current-state-last-prompt-poison-must-not-publish",
      });
    });
    const result = await collectKimi(operatorHome);
    const agent = onlyAgent(result);
    const state = JSON.parse(readFileSync(FIXTURE_STATE, "utf8"));
    const wireText = readFileSync(FIXTURE_MAIN_WIRE, "utf8");
    const rows = jsonlRows(wireText);
    const metadata = rows[0];
    const prompt = rows.find((row) => row.type === "turn.prompt");
    const context = rows.find((row) => row.type === "context.append_message");
    const loop = (type: string) => rows.find((row) =>
      row.type === "context.append_loop_event" && row.event?.type === type);
    const text = loop("content.part")?.event;
    const thought = rows.find((row) =>
      row.type === "context.append_loop_event" && row.event?.part?.type === "think");
    const toolCall = loop("tool.call");
    const toolResult = loop("tool.result");
    const llm = rows.find((row) => row.type === "llm.request");
    const usage = rows.find((row) => row.type === "usage.record");
    const ended = rows.find((row) => row.type === "turn.ended");

    expect({
      fixturePin: { meta: state.version, protocol: metadata.protocol_version, id: state.id },
      raw: {
        prompt: prompt && { agentId: prompt.agentId, input: prompt.input, origin: prompt.origin },
        context: context && {
          agentId: context.agentId,
          role: context.message?.role,
          toolCalls: context.message?.toolCalls,
        },
        loop: {
          text: text && {
            type: text.type,
            turnId: text.turnId,
            step: text.step,
            stepUuid: text.stepUuid,
            part: text.part,
          },
          thought: thought && {
            agentId: thought.agentId,
            type: thought.event?.type,
            turnId: thought.event?.turnId,
            stepUuid: thought.event?.stepUuid,
            part: {
              type: thought.event?.part?.type,
              think: thought.event?.part?.think,
              encrypted: typeof thought.event?.part?.encrypted === "string",
            },
          },
          toolCall: toolCall && {
            agentId: toolCall.agentId,
            type: toolCall.event?.type,
            turnId: toolCall.event?.turnId,
            stepUuid: toolCall.event?.stepUuid,
            toolCallId: toolCall.event?.toolCallId,
            name: toolCall.event?.name,
            argsKeys: Object.keys(toolCall.event?.args ?? {}).sort(),
          },
          toolResult: toolResult && {
            agentId: toolResult.agentId,
            type: toolResult.event?.type,
            parentUuid: toolResult.event?.parentUuid,
            toolCallId: toolResult.event?.toolCallId,
            resultKeys: Object.keys(toolResult.event?.result ?? {}).sort(),
          },
        },
        llm: llm && {
          agentId: llm.agentId,
          kind: llm.kind,
          provider: llm.provider,
          model: llm.model,
          modelAlias: llm.modelAlias,
          thinkingEffort: llm.thinkingEffort,
          toolSelect: llm.toolSelect,
          systemPromptHash: llm.systemPromptHash,
          toolsHash: llm.toolsHash,
          messageCount: llm.messageCount,
          turnStep: llm.turnStep,
        },
        usage: usage && {
          agentId: usage.agentId,
          usageScope: usage.usageScope,
          hasTurnIdentity: "turnId" in usage || "turn_id" in usage,
        },
        ended: ended && {
          agentId: ended.agentId,
          turnId: ended.turnId,
          numericTurnId: typeof ended.turnId === "number",
          reason: ended.reason,
        },
        legacyKeys: [...wireText.matchAll(/"(?:turn_id|call_id|model_alias|thinking_effort)"\s*:/g)].length,
      },
      rows: result.value.length,
      absent: result.absent,
      errors: result.errors,
      agent: agent && {
        id: agent.id,
        provider: agent.provider,
        sourceSessionId: agent.sourceSessionId,
        runtimeSessionId: agent.runtimeSessionId,
        displayName: agent.displayName,
        identity: agent.identity,
        cwd: agent.cwd,
        originCwd: agent.originCwd,
        task: agent.task,
        startedAt: agent.startedAt,
        updatedAt: agent.updatedAt,
        artifacts: agent.artifacts,
        allowCwdFallback: agent.allowCwdFallback,
      },
    }).toEqual({
      fixturePin: { meta: KIMI_SESSION_META_VERSION, protocol: KIMI_WIRE_PROTOCOL_VERSION, id: SESSION_ID },
      raw: {
        prompt: {
          agentId: "main",
          input: [{ type: "text", text: "Verify the public Kimi fixture evidence." }],
          origin: { kind: "user" },
        },
        context: { agentId: "main", role: "user", toolCalls: [] },
        loop: {
          text: {
            type: "content.part",
            turnId: "0",
            step: 1,
            stepUuid: "11111111-1111-4111-8111-111111111111",
            part: { type: "text", text: "I will inspect only the public fixture." },
          },
          thought: {
            agentId: "main",
            type: "content.part",
            turnId: "0",
            stepUuid: "11111111-1111-4111-8111-111111111111",
            part: { type: "think", think: "Check the public fixture relationships.", encrypted: true },
          },
          toolCall: {
            agentId: "main",
            type: "tool.call",
            turnId: "0",
            stepUuid: "11111111-1111-4111-8111-111111111111",
            toolCallId: "call_fixture_read",
            name: "read",
            argsKeys: ["fixture"],
          },
          toolResult: {
            agentId: "main",
            type: "tool.result",
            parentUuid: "44444444-4444-4444-8444-444444444444",
            toolCallId: "call_fixture_read",
            resultKeys: ["isError", "output"],
          },
        },
        llm: {
          agentId: "main",
          kind: "loop",
          provider: "anthropic",
          model: "claude-opus-5",
          modelAlias: "claude-opus-5",
          thinkingEffort: "high",
          toolSelect: true,
          systemPromptHash: "d4b59f7ea8b786a80cfe4e4d094350c879e925a8646657c167b29a36c826a866",
          toolsHash: "cf2b5e56692dd4271d48013ed2740a7cea3579a0827e977b24fc0391d5f3ecae",
          messageCount: 1,
          turnStep: "0.1",
        },
        usage: { agentId: "main", usageScope: "turn", hasTurnIdentity: false },
        ended: { agentId: "main", turnId: 0, numericTurnId: true, reason: "completed" },
        legacyKeys: 0,
      },
      rows: 1,
      absent: undefined,
      errors: [],
      agent: {
        id: `kimi:${SESSION_ID}`,
        provider: "kimi",
        sourceSessionId: SESSION_ID,
        runtimeSessionId: SESSION_ID,
        displayName: "Kimi public fixture contract",
        identity: {
          name: "Kimi public fixture contract",
          base: "Kimi public fixture contract",
          source: "authored",
          authoredBy: "kimi-title",
        },
        cwd: "/tmp/formic-kimi-fixture/project",
        originCwd: "/tmp/formic-kimi-fixture/project",
        task: "Verify the public Kimi fixture evidence.",
        startedAt: new Date(CREATED_AT).toISOString(),
        updatedAt: new Date(UPDATED_AT).toISOString(),
        artifacts: [{ label: "Kimi Code session", path: fixture.mainWire, kind: "transcript" }],
        allowCwdFallback: false,
      },
    });
  });

  test("KIMI-RED-02 custom titles are authored while generated titles use task then provider fallback", async () => {
    const custom = defaultFixture("title-custom");
    const generated = defaultFixture("title-generated", (draft) => {
      Object.assign(draft.state ?? {}, {
        title: "Generated title must not be authored",
        titleKind: "generated",
        isCustomTitle: false,
        lastPrompt: "generated-state-last-prompt-poison-must-not-publish",
      });
    });
    const fallback = defaultFixture("title-fallback", (draft) => {
      Object.assign(draft.state ?? {}, {
        title: "Replaceable title must not be authored",
        titleKind: "replaceable",
        isCustomTitle: false,
        lastPrompt: "",
      });
      wireMutation(draft, (rows) => rows.filter((row) =>
        row.type !== "turn.prompt"
        && !(row.type === "context.append_message" && row.message?.role === "user")));
    });
    const [customAgent, generatedAgent, fallbackAgent] = await Promise.all([
      collectKimi(custom.operatorHome),
      collectKimi(generated.operatorHome),
      collectKimi(fallback.operatorHome),
    ]).then((results) => results.map(onlyAgent));

    expect({
      custom: customAgent && { name: customAgent.displayName, identity: customAgent.identity },
      generated: generatedAgent && { name: generatedAgent.displayName, identity: generatedAgent.identity },
      fallback: fallbackAgent && { name: fallbackAgent.displayName, identity: fallbackAgent.identity },
    }).toEqual({
      custom: {
        name: "Kimi public fixture contract",
        identity: { name: "Kimi public fixture contract", base: "Kimi public fixture contract", source: "authored", authoredBy: "kimi-title" },
      },
      generated: {
        name: "Verify the public Kimi fixture evidence.",
        identity: { name: "Verify the public Kimi fixture evidence.", base: "Verify the public Kimi fixture evidence.", source: "task" },
      },
      fallback: {
        name: "Kimi Code · project",
        identity: { name: "Kimi Code · project", base: "Kimi Code · project", source: "origin-cwd" },
      },
    });
  });

  test("KIMI-RED-03 prose thinking and tool identity reach Inspector without arguments or encrypted bodies", async () => {
    const fixture = directFixture("inspector-typed");
    const agent = manualKimiAgent(fixture.mainWire);
    const response = await transcriptResponse(endpointSnapshot(agent), agent.id, 100, {});
    const body = await response.json() as { lines?: Array<{ role?: string; text?: string; at?: string | null }> };
    const lines = body.lines ?? [];
    const serialized = JSON.stringify(body);

    expect({
      user: lines
        .filter((line) => line.role === "user")
        .map(({ text, at }) => ({ text, at })),
      assistant: lines.some((line) => line.role === "assistant" && line.text === "I will inspect only the public fixture."),
      thinking: lines.some((line) => line.role === "system" && line.text === "Thought\nCheck the public fixture relationships."),
      tools: lines
        .filter((line) => line.role === "tool")
        .map(({ text, at }) => ({ text, at })),
      leaksPrivateBodies: /argument-must-stay-hidden|encrypted-body-must-stay-hidden|tool-result-body-must-stay-hidden|failed-argument-must-stay-hidden|failed-tool-result-body-must-stay-hidden/.test(serialized),
    }).toEqual({
      user: [{
        text: "Please inspect the public fixture.",
        at: new Date(CREATED_AT + 6_500).toISOString(),
      }],
      assistant: true,
      thinking: true,
      tools: [
        {
          text: "read\nCall: call_fixture_read\nStatus: completed",
          at: new Date(CREATED_AT + 6_000).toISOString(),
        },
        {
          text: "write\nCall: call_fixture_write_failed\nStatus: failed",
          at: new Date(CREATED_AT + 6_200).toISOString(),
        },
      ],
      leaksPrivateBodies: false,
    });
  });

  test("KIMI-RED-04 latest occupancy and complete session consumption cache and call series use distinct units", async () => {
    const { operatorHome } = defaultFixture("usage-complete");
    const stepOnly = defaultFixture("usage-step-only", (draft) => {
      wireMutation(draft, (rows) => rows.filter((row) => row.type !== "usage.record"));
    });
    const [agent, stepOnlyAgent] = await Promise.all([
      collectKimi(operatorHome),
      collectKimi(stepOnly.operatorHome),
    ]).then((results) => results.map(onlyAgent));

    expect({
      tokens: agent?.tokens,
      callSizes: agent?.callSizes,
      cost: agent?.cost,
      contextPct: agent?.contextPct,
      stepOnly: stepOnlyAgent && {
        tokens: stepOnlyAgent.tokens,
        callSizes: stepOnlyAgent.callSizes,
        cost: stepOnlyAgent.cost,
        contextPct: stepOnlyAgent.contextPct,
      },
    }).toEqual({
      tokens: {
        input: 12,
        output: 5,
        cachedInput: 40,
        total: 60,
        sessionTotal: 20,
        sessionCachedInput: 40,
        sessionProcessed: 60,
        contextWindow: 1_000_000,
        scope: "latest-turn",
        provenance: "observed",
      },
      callSizes: [60],
      cost: undefined,
      contextPct: 0.006,
      stepOnly: {
        tokens: {
          input: 91,
          output: 7,
          cachedInput: 13,
          total: 113,
          sessionTotal: 100,
          sessionCachedInput: 13,
          sessionProcessed: 113,
          contextWindow: 1_000_000,
          scope: "latest-turn",
          provenance: "observed",
        },
        callSizes: [113],
        cost: undefined,
        contextPct: 0.0113,
      },
    });
  });

  test("KIMI-RED-05 one incomplete eligible usage withholds session aggregates and call series but keeps complete latest occupancy", async () => {
    const { operatorHome, fixture } = defaultFixture("usage-incomplete", (draft) => {
      wireMutation(draft, (rows) => {
        for (const row of rows) {
          const usage = row.type === "usage.record"
            ? row.usage
            : row.type === "context.append_loop_event" && row.event?.type === "step.end"
              ? row.event.usage
              : undefined;
          if (usage) delete usage.inputCacheCreation;
        }
        return [...rows,
          { type: "turn.prompt", agentId: "main", input: [{ type: "text", text: "Check the complete latest turn." }], origin: { kind: "user" }, time: UPDATED_AT + 1_000 },
          { type: "context.append_message", agentId: "main", message: { role: "user", content: [{ type: "text", text: "Check the complete latest turn." }], toolCalls: [] }, time: UPDATED_AT + 2_000 },
          { type: "context.append_loop_event", agentId: "main", event: { type: "step.begin", uuid: "77777777-7777-4777-8777-777777777777", turnId: "1", step: 1 }, time: UPDATED_AT + 2_500 },
          { type: "context.append_loop_event", agentId: "main", event: { type: "content.part", uuid: "88888888-8888-4888-8888-888888888888", turnId: "1", step: 1, stepUuid: "77777777-7777-4777-8777-777777777777", part: { type: "text", text: "The latest turn is complete." } }, time: UPDATED_AT + 3_000 },
          { type: "context.append_loop_event", agentId: "main", event: { type: "step.end", uuid: "77777777-7777-4777-8777-777777777777", turnId: "1", step: 1, finishReason: "end_turn", usage: { inputOther: 2, output: 3, inputCacheRead: 5, inputCacheCreation: 1 } }, time: UPDATED_AT + 3_500 },
          { type: "usage.record", agentId: "main", usageScope: "turn", model: "claude-opus-5", usage: { inputOther: 2, output: 3, inputCacheRead: 5, inputCacheCreation: 1 }, time: UPDATED_AT + 3_600 },
          { type: "turn.ended", agentId: "main", turnId: 1, reason: "completed", durationMs: 3_000, time: UPDATED_AT + 4_000 },
        ];
      });
    });
    const result = await collectKimi(operatorHome);
    const agent = onlyAgent(result);
    const incomplete = result.errors.filter((reason) => /usage.*(?:incomplete|missing|withheld)/i.test(reason));

    expect({
      rows: result.value.length,
      latest: agent && {
        input: agent.tokens.input,
        output: agent.tokens.output,
        cachedInput: agent.tokens.cachedInput,
        total: agent.tokens.total,
        scope: agent.tokens.scope,
        provenance: agent.tokens.provenance,
      },
      sessionTotal: agent?.tokens.sessionTotal,
      sessionCachedInput: agent?.tokens.sessionCachedInput,
      sessionProcessed: agent?.tokens.sessionProcessed,
      callSizes: agent?.callSizes,
      oneQualifiedWarning: incomplete.length === 1 && incomplete[0]!.includes(fixture.mainWire),
    }).toEqual({
      rows: 1,
      latest: { input: 2, output: 3, cachedInput: 5, total: 11, scope: "latest-turn", provenance: "observed" },
      sessionTotal: undefined,
      sessionCachedInput: undefined,
      sessionProcessed: undefined,
      callSizes: undefined,
      oneQualifiedWarning: true,
    });
  });

  test.each(["completed", "cancelled", "failed", "blocked"] as const)(
    "KIMI-RED-05B a %s source-backed call without usage withholds stale occupancy and the whole call series",
    async (reason) => {
      const { operatorHome, fixture } = defaultFixture(`call-without-counters-${reason}`, (draft) => {
        Object.assign(draft.state ?? {}, { lastTurnReason: reason });
        wireMutation(draft, (rows) => [...rows,
          { type: "turn.prompt", agentId: "main", input: [{ type: "text", text: `Run one more ${reason} call without usage.` }], origin: { kind: "user" }, time: UPDATED_AT + 1_000 },
          { type: "llm.request", agentId: "main", kind: "loop", provider: "anthropic", model: "claude-opus-5", modelAlias: "claude-opus-5", thinkingEffort: "high", turnStep: "1.1", time: UPDATED_AT + 2_000 },
          { type: "context.append_loop_event", agentId: "main", event: { type: "content.part", uuid: "99999999-9999-4999-8999-999999999999", turnId: "1", step: 1, stepUuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", part: { type: "text", text: `This call ended ${reason} without a usage record.` } }, time: UPDATED_AT + 3_000 },
          { type: "turn.ended", agentId: "main", turnId: 1, reason, durationMs: 3_000, time: UPDATED_AT + 4_000 },
        ]);
      });
      const result = await collectKimi(operatorHome);
      const agent = onlyAgent(result);
      const calls = agent
        ? await sessionCallsResponse(endpointSnapshot(agent), agent.id, {})
        : undefined;
      const callsBody = calls ? await calls.json() as Record<string, unknown> : undefined;
      const incomplete = result.errors.filter((error) =>
        error.includes(fixture.mainWire) && /usage.*(?:incomplete|missing|withheld)/i.test(error));

      expect({
        input: agent?.tokens.input,
        output: agent?.tokens.output,
        cachedInput: agent?.tokens.cachedInput,
        total: agent?.tokens.total,
        contextPct: agent?.contextPct,
        scope: agent?.tokens.scope,
        provenance: agent?.tokens.provenance,
        sessionTotal: agent?.tokens.sessionTotal,
        sessionCachedInput: agent?.tokens.sessionCachedInput,
        sessionProcessed: agent?.tokens.sessionProcessed,
        callSizes: agent?.callSizes,
        warningCount: incomplete.length,
        debug: callsBody && {
          calls: callsBody.calls,
          sessionProcessed: callsBody.sessionProcessed,
          prefixSums: callsBody.prefixSums,
          unavailable: callsBody.unavailable,
        },
      }).toEqual({
        input: undefined,
        output: undefined,
        cachedInput: undefined,
        total: undefined,
        contextPct: undefined,
        scope: "session",
        provenance: "estimated",
        sessionTotal: undefined,
        sessionCachedInput: undefined,
        sessionProcessed: undefined,
        callSizes: undefined,
        warningCount: 1,
        debug: {
          calls: null,
          sessionProcessed: null,
          prefixSums: null,
          unavailable: expect.stringMatching(/Kimi.*(?:partial|incomplete)|(?:partial|incomplete).*Kimi/i),
        },
      });
    },
  );

  test("KIMI-RED-05E a newer open prompt/request withholds older occupancy session totals and calls", async () => {
    const { operatorHome, fixture } = defaultFixture("usage-open-request", (draft) => {
      wireMutation(draft, (rows) => [...rows,
        { type: "turn.prompt", agentId: "main", input: [{ type: "text", text: "Start a newer call without terminal usage." }], origin: { kind: "user" }, time: UPDATED_AT + 1_000 },
        { type: "llm.request", agentId: "main", kind: "loop", provider: "anthropic", model: "claude-opus-5", modelAlias: "claude-opus-5", thinkingEffort: "high", turnStep: "1.1", time: UPDATED_AT + 2_000 },
      ]);
    });
    const evidence = await readKimiWireFile(fixture.mainWire);
    const result = await collectKimi(operatorHome);
    const agent = onlyAgent(result);
    const calls = agent
      ? await sessionCallsResponse(endpointSnapshot(agent), agent.id, {})
      : undefined;
    const callsBody = calls ? await calls.json() as Record<string, unknown> : undefined;
    const incomplete = result.errors.filter((error) =>
      error.includes(fixture.mainWire) && /usage.*(?:incomplete|missing|withheld)/i.test(error));

    expect({
      evidence: {
        usageIncomplete: evidence.usageIncomplete,
        input: evidence.tokens.input,
        output: evidence.tokens.output,
        cachedInput: evidence.tokens.cachedInput,
        total: evidence.tokens.total,
        sessionTotal: evidence.tokens.sessionTotal,
        sessionCachedInput: evidence.tokens.sessionCachedInput,
        sessionProcessed: evidence.tokens.sessionProcessed,
        callSizes: evidence.callSizes,
      },
      published: agent && {
        input: agent.tokens.input,
        output: agent.tokens.output,
        cachedInput: agent.tokens.cachedInput,
        total: agent.tokens.total,
        sessionTotal: agent.tokens.sessionTotal,
        sessionCachedInput: agent.tokens.sessionCachedInput,
        sessionProcessed: agent.tokens.sessionProcessed,
        callSizes: agent.callSizes,
        contextPct: agent.contextPct,
      },
      warningCount: incomplete.length,
      debug: callsBody && {
        calls: callsBody.calls,
        sessionProcessed: callsBody.sessionProcessed,
        prefixSums: callsBody.prefixSums,
        unavailable: callsBody.unavailable,
      },
    }).toEqual({
      evidence: {
        usageIncomplete: true,
        input: undefined,
        output: undefined,
        cachedInput: undefined,
        total: undefined,
        sessionTotal: undefined,
        sessionCachedInput: undefined,
        sessionProcessed: undefined,
        callSizes: undefined,
      },
      published: {
        input: undefined,
        output: undefined,
        cachedInput: undefined,
        total: undefined,
        sessionTotal: undefined,
        sessionCachedInput: undefined,
        sessionProcessed: undefined,
        callSizes: undefined,
        contextPct: undefined,
      },
      warningCount: 1,
      debug: {
        calls: null,
        sessionProcessed: null,
        prefixSums: null,
        unavailable: expect.stringMatching(/Kimi.*(?:partial|incomplete)|(?:partial|incomplete).*Kimi/i),
      },
    });
  });

  test.each(["per-call", "session"] as const)(
    "KIMI-RED-05D finite %s usage overflow keeps direct evidence but withholds incomplete derived totals",
    async (overflowAt) => {
      const { operatorHome, fixture } = defaultFixture(`usage-overflow-${overflowAt}`, (draft) => {
        wireMutation(draft, (rows) => {
          for (const row of rows) {
            const usage = row.type === "usage.record"
              ? row.usage
              : row.type === "context.append_loop_event" && row.event?.type === "step.end"
                ? row.event.usage
                : undefined;
            if (!usage) continue;
            Object.assign(usage, {
              inputOther: Number.MAX_VALUE,
              output: overflowAt === "per-call" ? Number.MAX_VALUE : 0,
              inputCacheRead: overflowAt === "per-call" ? Number.MAX_VALUE : 0,
              inputCacheCreation: overflowAt === "per-call" ? Number.MAX_VALUE : 0,
            });
          }
          if (overflowAt === "per-call") return rows;
          return [...rows,
            { type: "turn.prompt", agentId: "main", input: [{ type: "text", text: "Add a second finite call that overflows the session." }], origin: { kind: "user" }, time: UPDATED_AT + 1_000 },
            { type: "context.append_loop_event", agentId: "main", event: { type: "step.end", uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", turnId: "1", step: 1, finishReason: "end_turn", usage: { inputOther: Number.MAX_VALUE, output: 0, inputCacheRead: 0, inputCacheCreation: 0 } }, time: UPDATED_AT + 2_000 },
            { type: "usage.record", agentId: "main", usageScope: "turn", model: "claude-opus-5", usage: { inputOther: Number.MAX_VALUE, output: 0, inputCacheRead: 0, inputCacheCreation: 0 }, time: UPDATED_AT + 2_100 },
            { type: "turn.ended", agentId: "main", turnId: 1, reason: "completed", durationMs: 1_000, time: UPDATED_AT + 2_200 },
            { type: "turn.prompt", agentId: "main", input: [{ type: "text", text: "Keep a safe latest call after the session overflow." }], origin: { kind: "user" }, time: UPDATED_AT + 3_000 },
            { type: "context.append_loop_event", agentId: "main", event: { type: "step.end", uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", turnId: "2", step: 1, finishReason: "end_turn", usage: { inputOther: 2, output: 3, inputCacheRead: 5, inputCacheCreation: 1 } }, time: UPDATED_AT + 4_000 },
            { type: "usage.record", agentId: "main", usageScope: "turn", model: "claude-opus-5", usage: { inputOther: 2, output: 3, inputCacheRead: 5, inputCacheCreation: 1 }, time: UPDATED_AT + 4_100 },
            { type: "turn.ended", agentId: "main", turnId: 2, reason: "completed", durationMs: 1_000, time: UPDATED_AT + 4_200 },
          ];
        });
      });
      const result = await collectKimi(operatorHome);
      const agent = onlyAgent(result);
      const calls = agent
        ? await sessionCallsResponse(endpointSnapshot(agent), agent.id, {})
        : undefined;
      const callsBody = calls ? await calls.json() as Record<string, unknown> : undefined;
      const overflowWarnings = result.errors.filter((reason) =>
        reason.includes(fixture.mainWire) && /usage.*overflow/i.test(reason));

      expect({
        input: agent?.tokens.input,
        output: agent?.tokens.output,
        cachedInput: agent?.tokens.cachedInput,
        total: agent?.tokens.total,
        sessionTotal: agent?.tokens.sessionTotal,
        sessionCachedInput: agent?.tokens.sessionCachedInput,
        sessionProcessed: agent?.tokens.sessionProcessed,
        callSizes: agent?.callSizes,
        scope: agent?.tokens.scope,
        provenance: agent?.tokens.provenance,
        warningCount: overflowWarnings.length,
        serializedNull: JSON.stringify(agent?.tokens).includes("null"),
        endpoint: callsBody && {
          calls: callsBody.calls,
          sessionProcessed: callsBody.sessionProcessed,
          prefixSums: callsBody.prefixSums,
          unavailable: callsBody.unavailable,
        },
      }).toEqual({
        input: overflowAt === "per-call" ? Number.MAX_VALUE : 2,
        output: overflowAt === "per-call" ? Number.MAX_VALUE : 3,
        cachedInput: overflowAt === "per-call" ? Number.MAX_VALUE : 5,
        total: overflowAt === "per-call" ? undefined : 11,
        sessionTotal: undefined,
        sessionCachedInput: undefined,
        sessionProcessed: undefined,
        callSizes: undefined,
        scope: "latest-turn",
        provenance: "observed",
        warningCount: 1,
        serializedNull: false,
        endpoint: {
          calls: null,
          sessionProcessed: null,
          prefixSums: null,
          unavailable: expect.stringMatching(/Kimi.*(?:partial|incomplete)|(?:partial|incomplete).*Kimi/i),
        },
      });
    },
  );

  test("KIMI-RED-05C accepted state and wire strings use shared public bounds without clipping Inspector evidence", async () => {
    const authoredTitle = `Authored Kimi title ${"t".repeat(MAX_NAME_LENGTH + 40)}`;
    const taskText = `Verify bounded Kimi identity ${"q".repeat(MAX_HUMAN_MESSAGE_CHARS + 80)}`;
    const userText = `Bounded Kimi user message ${"u".repeat(MAX_HUMAN_MESSAGE_CHARS + 80)}`;
    const assistantText = `Bounded Kimi assistant message ${"a".repeat(MAX_HUMAN_MESSAGE_CHARS + 80)}`;
    const authored = defaultFixture("bounds-authored", (draft) => {
      Object.assign(draft.state ?? {}, { title: authoredTitle, titleKind: "custom" });
    });
    const wire = defaultFixture("bounds-wire", (draft) => {
      Object.assign(draft.state ?? {}, { title: "Generated title is not identity", titleKind: "generated" });
      wireMutation(draft, (rows) => rows.map((row) => {
        if (row.type === "turn.prompt") {
          return { ...row, input: [{ type: "text", text: taskText }] };
        }
        if (row.type === "context.append_message" && row.message?.role === "user") {
          return { ...row, message: { ...row.message, content: [{ type: "text", text: userText }] } };
        }
        if (row.type === "context.append_loop_event" && row.event?.type === "content.part" && row.event?.part?.type === "text") {
          return { ...row, event: { ...row.event, part: { ...row.event.part, text: assistantText } } };
        }
        return row;
      }));
    });
    const [authoredAgent, wireAgent] = await Promise.all([
      collectKimi(authored.operatorHome),
      collectKimi(wire.operatorHome),
    ]).then((results) => results.map(onlyAgent));
    const inspector = wireAgent
      ? await transcriptResponse(endpointSnapshot(wireAgent), wireAgent.id, 100, {})
      : undefined;
    const inspectorBody = inspector
      ? await inspector.json() as { lines?: Array<{ role?: string; text?: string }> }
      : undefined;
    const inspectorLines = inspectorBody?.lines ?? [];

    expect({
      authoredIdentity: authoredAgent && {
        displayName: authoredAgent.displayName,
        name: authoredAgent.identity?.name,
        base: authoredAgent.identity?.base,
      },
      wireIdentity: wireAgent && {
        displayName: wireAgent.displayName,
        name: wireAgent.identity?.name,
        base: wireAgent.identity?.base,
        task: wireAgent.task,
      },
      messages: wireAgent && {
        human: wireAgent.lastHumanMessage,
        user: wireAgent.lastUserMessage,
        agent: wireAgent.lastAgentMessage,
        closing: wireAgent.lastAgentClosing,
      },
      inspectorPreservesNative: {
        user: inspectorLines.some((line) => line.role === "user" && line.text === userText),
        assistant: inspectorLines.some((line) => line.role === "assistant" && line.text === assistantText),
      },
    }).toEqual({
      authoredIdentity: {
        displayName: `${authoredTitle.slice(0, MAX_NAME_LENGTH - 1).trimEnd()}…`,
        name: `${authoredTitle.slice(0, MAX_NAME_LENGTH - 1).trimEnd()}…`,
        base: `${authoredTitle.slice(0, MAX_NAME_LENGTH - 1).trimEnd()}…`,
      },
      wireIdentity: {
        displayName: expect.stringMatching(new RegExp(`^.{${MAX_NAME_LENGTH}}$`)),
        name: expect.stringMatching(new RegExp(`^.{${MAX_NAME_LENGTH}}$`)),
        base: expect.stringMatching(new RegExp(`^.{${MAX_NAME_LENGTH}}$`)),
        task: readableHumanMessage(KIMI, taskText),
      },
      messages: {
        human: readableHumanMessage(KIMI, assistantText),
        user: readableHumanMessage(KIMI, userText),
        agent: readableHumanMessage(KIMI, assistantText),
        closing: readableClosing(KIMI, assistantText),
      },
      inspectorPreservesNative: { user: true, assistant: true },
    });
  });

  test("KIMI-RED-06 observed model and effort gain a window only after a real catalog match", async () => {
    const known = defaultFixture("model-known");
    const unknown = defaultFixture("model-unknown", (draft) => {
      wireMutation(draft, (rows) => rows.flatMap((row) => {
        if (row.type === "llm.request") {
          return [row, {
            ...row,
            provider: "fixture-provider",
            model: "fixture-model-with-no-window",
            modelAlias: "fixture-private",
            time: CREATED_AT + 2_650,
          }];
        }
        if (row.type === "usage.record") return [{ ...row, model: "fixture-model-with-no-window" }];
        return [row];
      }));
    });
    const [knownAgent, unknownAgent] = await Promise.all([
      collectKimi(known.operatorHome),
      collectKimi(unknown.operatorHome),
    ]).then((results) => results.map(onlyAgent));

    expect({
      known: knownAgent && { model: knownAgent.model, effort: knownAgent.effort, rawModel: knownAgent.rawModel, window: knownAgent.tokens.contextWindow, pct: knownAgent.contextPct },
      unknown: unknownAgent && { model: unknownAgent.model, effort: unknownAgent.effort, rawModel: unknownAgent.rawModel, window: unknownAgent.tokens.contextWindow, pct: unknownAgent.contextPct },
    }).toEqual({
      known: { model: "claude-opus-5", effort: "high", rawModel: { providerRoute: "anthropic", modelId: "claude-opus-5" }, window: 1_000_000, pct: 0.006 },
      unknown: { model: "fixture-model-with-no-window", effort: "high", rawModel: { providerRoute: "fixture-provider", modelId: "fixture-model-with-no-window" }, window: undefined, pct: undefined },
    });
  });

  test("KIMI-RED-07 newer protocol and missing or foreign metadata fail closed with path-qualified health", async () => {
    const future = directFixture("protocol-future", (draft) => {
      wireMutation(draft, (rows) => rows.map((row, index) => index === 0 ? { ...row, protocol_version: "1.6" } : row));
    });
    const missing = directFixture("protocol-missing", (draft) => {
      wireMutation(draft, (rows) => rows.slice(1));
    });
    const foreign = directFixture("protocol-foreign", (draft) => {
      wireMutation(draft, (rows) => rows.map((row, index) => index === 0 ? { type: "foreign.metadata", protocol_version: "1.5" } : row));
    });
    const result = await collectKimi(tempRoot("protocol-home"), {
      extraKimiRoots: [future.root, missing.root, foreign.root],
    });
    const health = (fixture: MaterializedFixture, pattern: RegExp): boolean =>
      result.errors.some((reason) => reason.includes(fixture.mainWire) && pattern.test(reason));

    expect({
      rows: result.value.length,
      absent: result.absent,
      future: health(future, /protocol.*1\.6|1\.6.*protocol/i),
      missing: health(missing, /metadata.*missing|missing.*metadata/i),
      foreign: health(foreign, /metadata.*foreign|foreign.*metadata/i),
    }).toEqual({ rows: 0, absent: undefined, future: true, missing: true, foreign: true });
  });

  test("KIMI-RED-08 imported kimi-cli rows and tombstones are skipped while existing session directories remain authoritative", async () => {
    const tombstoned = directFixture("index-tombstone", (draft) => {
      if (draft.state) {
        delete draft.state.cwd;
        delete draft.state.workDir;
      }
      draft.indexText = jsonl([
        {
          sessionId: SESSION_ID,
          sessionDir: "/tmp/formic-kimi-fixture/stale-session-dir",
          workDir: "/tmp/formic-kimi-fixture/stale-tombstoned-cwd",
        },
        { sessionId: SESSION_ID, deleted: true },
      ]);
    });
    const imported = directFixture("index-imported", (draft) => {
      Object.assign(draft.state?.custom ?? {}, { imported_from_kimi_cli: true });
    });
    const recreated = directFixture("index-recreated", (draft) => {
      if (draft.state) {
        delete draft.state.cwd;
        delete draft.state.workDir;
      }
      const create = jsonlRows(draft.indexText)[0]!;
      draft.indexText = jsonl([
        { ...create, workDir: "/tmp/formic-kimi-fixture/pre-recreation-cwd" },
        { sessionId: SESSION_ID, deleted: true },
        { ...create, workDir: "/tmp/formic-kimi-fixture/recreated-cwd" },
      ]);
    });
    const ghostRoot = join(tempRoot("index-ghost"), "kimi-home");
    mkdirSync(ghostRoot, { recursive: true });
    writeFileSync(join(ghostRoot, "session_index.jsonl"), jsonl([{
      sessionId: "session_ffffffff-1111-4222-8333-444444444444",
      sessionDir: join(ghostRoot, "sessions", "wd_ghost_000000000000", "session_ffffffff-1111-4222-8333-444444444444"),
      workDir: "/tmp/formic-kimi-fixture/ghost",
    }]));
    const result = await collectKimi(tempRoot("index-home"), {
      extraKimiRoots: [tombstoned.root, recreated.root, imported.root, ghostRoot],
    });
    const fromRoot = (root: string) => result.value.find((agent) =>
      agent.artifacts.some((artifact) => artifact.path.startsWith(root)));
    const tombstonedAgent = fromRoot(tombstoned.root);
    const recreatedAgent = fromRoot(recreated.root);

    expect({
      publishedCount: result.value.length,
      tombstoned: tombstonedAgent && {
        id: tombstonedAgent.sourceSessionId,
        cwd: tombstonedAgent.cwd,
        originCwd: tombstonedAgent.originCwd,
      },
      recreated: recreatedAgent && {
        id: recreatedAgent.sourceSessionId,
        cwd: recreatedAgent.cwd,
        originCwd: recreatedAgent.originCwd,
      },
      errors: result.errors,
      importedPublished: result.value.some((agent) => agent.artifacts.some((artifact) => artifact.path.startsWith(imported.root))),
      ghostPublished: result.value.some((agent) => agent.sourceSessionId.startsWith("session_ffffffff")),
    }).toEqual({
      publishedCount: 2,
      tombstoned: { id: SESSION_ID, cwd: undefined, originCwd: undefined },
      recreated: {
        id: SESSION_ID,
        cwd: "/tmp/formic-kimi-fixture/recreated-cwd",
        originCwd: "/tmp/formic-kimi-fixture/recreated-cwd",
      },
      errors: [],
      importedPublished: false,
      ghostPublished: false,
    });
  });

  test("KIMI-RED-09 default absolute relative and alternate roots obey launch-cwd and foreign-home isolation", async () => {
    const saved = process.env.KIMI_CODE_HOME;
    const defaultCopy = defaultFixture("root-default");
    const absolute = directFixture("root-absolute");
    const launchCwd = tempRoot("root-launch-cwd");
    const relative = materializeAt(join(launchCwd, "relative-kimi"));
    const alternate = directFixture("root-alternate");
    const foreignHome = tempRoot("root-foreign-home");
    let observed: Record<string, unknown>;
    try {
      delete process.env.KIMI_CODE_HOME;
      const defaultResult = await collectKimi(defaultCopy.operatorHome);
      process.env.KIMI_CODE_HOME = absolute.root;
      const absoluteResult = await collectKimi(homedir());
      process.env.KIMI_CODE_HOME = "relative-kimi";
      const relativeResult = await collectKimi(homedir(), { kimiLaunchObservations: [{ launchCwd }] });
      delete process.env.KIMI_CODE_HOME;
      const alternateResult = await collectKimi(tempRoot("root-alternate-home"), { extraKimiRoots: [alternate.root] });
      process.env.KIMI_CODE_HOME = absolute.root;
      const foreignResult = await collectKimi(foreignHome);
      observed = {
        defaultIds: defaultResult.value.map((agent) => agent.sourceSessionId),
        absoluteIds: absoluteResult.value.map((agent) => agent.sourceSessionId),
        relativeIds: relativeResult.value.map((agent) => agent.sourceSessionId),
        alternateIds: alternateResult.value.map((agent) => agent.sourceSessionId),
        foreignIds: foreignResult.value.map((agent) => agent.sourceSessionId),
        foreignAbsent: foreignResult.absent,
        relativeArtifact: relativeResult.value[0]?.artifacts[0]?.path === relative.mainWire,
      };
    } finally {
      if (saved === undefined) delete process.env.KIMI_CODE_HOME;
      else process.env.KIMI_CODE_HOME = saved;
    }

    expect(observed).toEqual({
      defaultIds: [SESSION_ID],
      absoluteIds: [SESSION_ID],
      relativeIds: [SESSION_ID],
      alternateIds: [SESSION_ID],
      foreignIds: [],
      foreignAbsent: true,
      relativeArtifact: true,
    });
  });

  test("KIMI-RED-10 absence inaccessible oversized malformed and caller abort outcomes stay distinguishable", async () => {
    const missing = await collectKimi(tempRoot("health-missing"));
    const inaccessible = directFixture("health-inaccessible");
    const inaccessibleResult = await collectKimi(tempRoot("health-inaccessible-home"), {
      extraKimiRoots: [inaccessible.root],
      kimiReadTestHooks: { rootError: (root) => root === inaccessible.root ? Object.assign(new Error("fixture denied"), { code: "EACCES" }) : undefined },
    });
    const oversized = directFixture("health-oversized", (draft) => {
      draft.mainText = `${draft.mainText}${JSON.stringify({
        type: "context.append_message",
        agentId: "main",
        message: {
          role: "user",
          content: [{ type: "text", text: `Oversized public fixture ${"x".repeat(8 * 1024 * 1024 + 1)}` }],
          toolCalls: [],
        },
        time: UPDATED_AT + 1,
      })}\n`;
    });
    const oversizedResult = await collectKimi(tempRoot("health-oversized-home"), { extraKimiRoots: [oversized.root] });
    const malformed = directFixture("health-malformed", (draft) => {
      draft.mainText = `${draft.mainText}malformed-public-fixture-row\n`;
    });
    const malformedResult = await collectKimi(tempRoot("health-malformed-home"), { extraKimiRoots: [malformed.root] });
    const controller = new AbortController();
    const abortReason = new Error("kimi caller abort sentinel");
    controller.abort(abortReason);
    let abortPreserved = false;
    try {
      await collectKimi(tempRoot("health-abort"), {}, controller.signal);
    } catch (error) {
      abortPreserved = error === abortReason;
    }

    expect({
      missing: { absent: missing.absent, rows: missing.value.length, errors: missing.errors },
      inaccessible: inaccessibleResult.errors.some((reason) => reason.includes(inaccessible.root) && /EACCES|denied/i.test(reason)),
      oversized: oversizedResult.errors.some((reason) => reason.includes(oversized.mainWire) && /oversiz|byte cap|too large/i.test(reason)),
      malformed: malformedResult.errors.some((reason) => reason.includes(malformed.mainWire) && /malformed|JSON/i.test(reason)),
      damagedRows: inaccessibleResult.value.length + oversizedResult.value.length + malformedResult.value.length,
      abortPreserved,
    }).toEqual({
      missing: { absent: true, rows: 0, errors: [] },
      inaccessible: true,
      oversized: true,
      malformed: true,
      damagedRows: 0,
      abortPreserved: true,
    });
  });

  test.each(["missing", "unreadable"] as const)(
    "KIMI-RED-10A a %s declared-child evidence scan keeps the main row but degrades source health",
    async (failure) => {
      const fixture = directFixture(`health-child-${failure}`, (draft) => {
        if (failure === "missing") draft.childText = undefined;
      });
      const agentsDir = join(fixture.sessionDir, "agents");
      const originalOpendir = fsPromises.opendir;
      const opendirSpy = failure === "unreadable"
        ? spyOn(fsPromises as any, "opendir").mockImplementation(async (path: string, ...args: any[]) => {
            if (path === agentsDir) {
              throw Object.assign(new Error("declared child fixture denied"), { code: "EACCES" });
            }
            return (originalOpendir as any)(path, ...args);
          })
        : undefined;
      let result: CollectionResult<CollectedAgent[]>;
      try {
        result = await collectKimi(tempRoot(`health-child-${failure}-home`), {
          extraKimiRoots: [fixture.root],
        });
      } finally {
        opendirSpy?.mockRestore();
      }
      const agent = onlyAgent(result);
      const childDiagnostics = result.errors.filter((reason) =>
        reason.startsWith(`${agentsDir}:`) && /Kimi.*(?:declared child|state declares).*partial/i.test(reason));

      expect({
        rows: result.value.length,
        subagentCount: agent?.subagentCount,
        artifacts: agent?.artifacts,
        sourceQualifiedDegraded: childDiagnostics.length === 1,
        diagnosticCount: result.errors.length,
      }).toEqual({
        rows: 1,
        subagentCount: 1,
        artifacts: [{ label: "Kimi Code session", path: fixture.mainWire, kind: "transcript" }],
        sourceQualifiedDegraded: true,
        diagnosticCount: 1,
      });
    },
  );

  test("KIMI-RED-10I a missing named child cannot be substituted by an unrelated physical child", async () => {
    const fixture = directFixture("health-child-named-substitution", (draft) => {
      draft.childText = undefined;
    });
    const agentsDir = join(fixture.sessionDir, "agents");
    rmSync(join(agentsDir, "agent-0"), { recursive: true, force: true });
    const unrelatedWire = join(agentsDir, "unrelated-child", "wire.jsonl");
    mkdirSync(join(agentsDir, "unrelated-child"), { recursive: true });
    writeFileSync(unrelatedWire, readFileSync(FIXTURE_CHILD_WIRE, "utf8"));

    const result = await collectKimi(tempRoot("health-child-named-substitution-home"), {
      extraKimiRoots: [fixture.root],
    });
    const agent = onlyAgent(result);
    const childDiagnostics = result.errors.filter((reason) =>
      reason.startsWith(`${agentsDir}:`) && /Kimi state declares.*partial/i.test(reason));

    expect({
      rows: result.value.length,
      subagentCount: agent?.subagentCount,
      artifactPaths: agent?.artifacts.map((artifact: { path: string }) => artifact.path),
      unrelatedPublished: agent?.artifacts.some((artifact: { path: string }) => artifact.path === unrelatedWire),
      sourceHealthy: result.errors.length === 0,
      declaredChildDiagnosticCount: childDiagnostics.length,
    }).toEqual({
      rows: 1,
      subagentCount: 1,
      artifactPaths: [fixture.mainWire],
      unrelatedPublished: false,
      sourceHealthy: false,
      declaredChildDiagnosticCount: 1,
    });
  });

  test("KIMI-RED-10B one opened handle prevents pathname replacement from bypassing the wire byte cap", async () => {
    const { operatorHome, fixture } = defaultFixture("health-replace-race");
    const originalText = readFileSync(fixture.mainWire, "utf8");
    const replacementSentinel = "replacement-after-validation-must-not-publish";
    const replacementText = jsonl([...jsonlRows(originalText), {
      type: "context.append_message",
      agentId: "main",
      message: {
        role: "user",
        content: [{ type: "text", text: `${replacementSentinel}${"r".repeat(8 * 1024 * 1024)}` }],
        toolCalls: [],
      },
      time: UPDATED_AT + 1_000,
    }]);
    const originalPath = `${fixture.mainWire}.opened`;
    let replacementAttempted = false;
    const replacePath = (): void => {
      if (replacementAttempted) return;
      replacementAttempted = true;
      renameSync(fixture.mainWire, originalPath);
      writeFileSync(fixture.mainWire, replacementText);
    };
    const originalStat = fsPromises.stat;
    const originalOpen = fsPromises.open;
    const statSpy = spyOn(fsPromises as any, "stat").mockImplementation(async (path: string, ...args: any[]) => {
      const details = await (originalStat as any)(path, ...args);
      if (path === fixture.mainWire) replacePath();
      return details;
    });
    const openSpy = spyOn(fsPromises as any, "open").mockImplementation(async (path: string, ...args: any[]) => {
      const handle = await (originalOpen as any)(path, ...args);
      if (path === fixture.mainWire) replacePath();
      return handle;
    });
    let result: CollectionResult<CollectedAgent[]>;
    try {
      result = await collectKimi(operatorHome);
    } finally {
      statSpy.mockRestore();
      openSpy.mockRestore();
    }
    const agent = onlyAgent(result);

    expect({
      replacementAttempted,
      replacementExceedsCap: statSync(fixture.mainWire).size > 8 * 1024 * 1024,
      rows: result.value.length,
      errors: result.errors,
      lastHumanMessage: agent?.lastHumanMessage,
      replacementPublished: agent?.transcriptTail?.includes(replacementSentinel) ?? false,
    }).toEqual({
      replacementAttempted: true,
      replacementExceedsCap: true,
      rows: 1,
      errors: [],
      lastHumanMessage: "I will inspect only the public fixture.",
      replacementPublished: false,
    });
  });

  test("KIMI-RED-10C high-volume provider directory admission is capped with one truncation diagnostic", async () => {
    const root = join(tempRoot("health-directory-volume"), "kimi-home");
    const sessions = join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    for (let index = 0; index < 65; index += 1) {
      const suffix = String(index).padStart(12, "0");
      mkdirSync(join(
        sessions,
        `wd-volume-${String(index).padStart(3, "0")}`,
        `session_00000000-0000-4000-8000-${suffix}`,
      ), { recursive: true });
    }
    const result = await collectKimi(tempRoot("health-directory-volume-home"), {
      extraKimiRoots: [root],
    });
    const truncationDiagnostics = result.errors.filter((reason) =>
      reason.includes(root) && /directory admission.*truncat/i.test(reason));
    const admittedStateReads = result.errors.filter((reason) =>
      reason.includes(root) && /state\.json: Kimi state could not be read/i.test(reason));

    expect({
      rows: result.value.length,
      absent: result.absent,
      admittedStateReads: admittedStateReads.length,
      truncationDiagnostics,
    }).toEqual({
      rows: 0,
      absent: undefined,
      admittedStateReads: 64,
      truncationDiagnostics: [
        `${root}: Kimi directory admission truncated at 64 workdir entries or 256 session entries; remaining provider entries were not inspected`,
      ],
    });
  });

  test("KIMI-RED-10D child artifact admission counts irrelevant dirents and reads at most one truncation witness", async () => {
    const fixture = directFixture("health-child-volume");
    const agentsDir = join(fixture.sessionDir, "agents");
    const witnessName = "private-witness-must-not-leak";
    const originalOpendir = fsPromises.opendir;
    const originalReaddir = fsPromises.readdir;
    let reads = 0;
    let closes = 0;
    let unboundedReaddirCalls = 0;
    const opendirSpy = spyOn(fsPromises as any, "opendir").mockImplementation(async (path: string, ...args: any[]) => {
      if (path !== agentsDir) return (originalOpendir as any)(path, ...args);
      return {
        read: async () => {
          reads += 1;
          if (reads <= 2) {
            return { name: `irrelevant-${reads}`, isDirectory: () => false };
          }
          if (reads === 3) return { name: witnessName, isDirectory: () => true };
          throw new Error("Kimi child admission read past its single witness");
        },
        close: async () => { closes += 1; },
      };
    });
    const readdirSpy = spyOn(fsPromises as any, "readdir").mockImplementation(async (path: string, ...args: any[]) => {
      if (path === agentsDir) unboundedReaddirCalls += 1;
      return (originalReaddir as any)(path, ...args);
    });
    let result: CollectionResult<CollectedAgent[]>;
    try {
      result = await collectKimi(tempRoot("health-child-volume-home"), { extraKimiRoots: [fixture.root] });
    } finally {
      readdirSpy.mockRestore();
      opendirSpy.mockRestore();
    }
    const agent = onlyAgent(result);
    const childDiagnostics = result.errors.filter((reason) => /child artifact admission.*truncat/i.test(reason));

    expect({
      rows: result.value.length,
      artifacts: agent?.artifacts,
      reads,
      closes,
      unboundedReaddirCalls,
      childDiagnostics,
      witnessLeaked: result.errors.some((reason) => reason.includes(witnessName)),
    }).toEqual({
      rows: 1,
      artifacts: [{ label: "Kimi Code session", path: fixture.mainWire, kind: "transcript" }],
      reads: 3,
      closes: 1,
      unboundedReaddirCalls: 0,
      childDiagnostics: [
        `${agentsDir}: Kimi child artifact admission truncated at 2 total entries; remaining child entries were not inspected`,
      ],
      witnessLeaked: false,
    });
  });

  test("KIMI-RED-10E child artifact admission preserves cancellation raised by directory close", async () => {
    const fixture = directFixture("health-child-close-abort");
    const agentsDir = join(fixture.sessionDir, "agents");
    const controller = new AbortController();
    const reason = new Error("Kimi child close abort sentinel");
    const originalOpendir = fsPromises.opendir;
    let reads = 0;
    let closes = 0;
    const opendirSpy = spyOn(fsPromises as any, "opendir").mockImplementation(async (path: string, ...args: any[]) => {
      if (path !== agentsDir) return (originalOpendir as any)(path, ...args);
      return {
        read: async () => {
          reads += 1;
          return null;
        },
        close: async () => {
          closes += 1;
          controller.abort(reason);
        },
      };
    });
    let caught: unknown;
    try {
      await collectKimi(
        tempRoot("health-child-close-abort-home"),
        { extraKimiRoots: [fixture.root] },
        controller.signal,
      );
    } catch (error) {
      caught = error;
    } finally {
      opendirSpy.mockRestore();
    }

    expect({ caughtIsExactReason: caught === reason, reads, closes }).toEqual({
      caughtIsExactReason: true,
      reads: 1,
      closes: 1,
    });
  });

  test("KIMI-RED-10F child artifact admission reports a deadline raised by directory close", async () => {
    const fixture = directFixture("health-child-close-deadline");
    const agentsDir = join(fixture.sessionDir, "agents");
    const originalOpendir = fsPromises.opendir;
    const clock = UPDATED_AT + 100_000;
    let expired = false;
    let reads = 0;
    let closes = 0;
    const nowSpy = spyOn(Date, "now").mockImplementation(() => expired ? clock + 10 : clock);
    const opendirSpy = spyOn(fsPromises as any, "opendir").mockImplementation(async (path: string, ...args: any[]) => {
      if (path !== agentsDir) return (originalOpendir as any)(path, ...args);
      return {
        read: async () => {
          reads += 1;
          return null;
        },
        close: async () => {
          closes += 1;
          expired = true;
        },
      };
    });
    let result: CollectionResult<CollectedAgent[]>;
    try {
      result = await collectKimi(
        tempRoot("health-child-close-deadline-home"),
        { extraKimiRoots: [fixture.root], kimiReadDeadlineMs: 10 },
      );
    } finally {
      opendirSpy.mockRestore();
      nowSpy.mockRestore();
    }

    expect({ rows: result.value.length, reads, closes, errors: result.errors }).toEqual({
      rows: 1,
      reads: 1,
      closes: 1,
      errors: [
        `${agentsDir}: Kimi child artifact scan exceeded 10ms aggregate read deadline; remaining child entries were not inspected`,
      ],
    });
  });

  test("KIMI-RED-10G capped reads preserve cancellation raised by file-handle close", async () => {
    const { operatorHome, fixture } = defaultFixture("health-wire-close-abort");
    const controller = new AbortController();
    const reason = new Error("Kimi wire close abort sentinel");
    const originalOpen = fsPromises.open;
    let closes = 0;
    const openSpy = spyOn(fsPromises as any, "open").mockImplementation(async (path: string, ...args: any[]) => {
      const handle = await (originalOpen as any)(path, ...args);
      if (path !== fixture.mainWire) return handle;
      return {
        stat: handle.stat.bind(handle),
        read: handle.read.bind(handle),
        close: async () => {
          closes += 1;
          await handle.close();
          controller.abort(reason);
        },
      };
    });
    let caught: unknown;
    try {
      await collectKimi(operatorHome, {}, controller.signal);
    } catch (error) {
      caught = error;
    } finally {
      openSpy.mockRestore();
    }

    expect({ caughtIsExactReason: caught === reason, closes }).toEqual({
      caughtIsExactReason: true,
      closes: 1,
    });
  });

  test("KIMI-RED-10H capped reads report a deadline raised by file-handle close before publishing", async () => {
    const { operatorHome, fixture } = defaultFixture("health-wire-close-deadline");
    const originalOpen = fsPromises.open;
    const clock = UPDATED_AT + 100_000;
    let expired = false;
    let closes = 0;
    const nowSpy = spyOn(Date, "now").mockImplementation(() => expired ? clock + 10 : clock);
    const openSpy = spyOn(fsPromises as any, "open").mockImplementation(async (path: string, ...args: any[]) => {
      const handle = await (originalOpen as any)(path, ...args);
      if (path !== fixture.mainWire) return handle;
      return {
        stat: handle.stat.bind(handle),
        read: handle.read.bind(handle),
        close: async () => {
          closes += 1;
          await handle.close();
          expired = true;
        },
      };
    });
    let result: CollectionResult<CollectedAgent[]>;
    try {
      result = await collectKimi(operatorHome, { kimiReadDeadlineMs: 10 });
    } finally {
      openSpy.mockRestore();
      nowSpy.mockRestore();
    }

    expect({ rows: result.value.length, closes, errors: result.errors }).toEqual({
      rows: 0,
      closes: 1,
      errors: [
        `${fixture.mainWire}: Kimi wire could not be read: exceeded 10ms aggregate read deadline`,
      ],
    });
  });

  test("KIMI-RED-11 main subagent and child-session hierarchy stays source-qualified and collision-safe", async () => {
    const first = directFixture("hierarchy-first");
    const second = directFixture("hierarchy-second");
    const result = await collectKimi(tempRoot("hierarchy-home"), { extraKimiRoots: [first.root, second.root] });
    const agents = result.value as any[];
    const fixtureChildWires = new Set([first.childWire, second.childWire]);
    const childText = readFileSync(FIXTURE_CHILD_WIRE, "utf8");
    const childRows = jsonlRows(childText);
    const childPrompt = childRows.find((row) => row.type === "turn.prompt");
    const childContext = childRows.find((row) => row.type === "context.append_message");
    const childLoops = childRows.filter((row) => row.type === "context.append_loop_event");
    const childEnded = childRows.find((row) => row.type === "turn.ended");

    expect({
      rawChild: {
        prompt: childPrompt && {
          agentId: childPrompt.agentId,
          input: childPrompt.input,
          origin: childPrompt.origin,
        },
        context: childContext && {
          agentId: childContext.agentId,
          role: childContext.message?.role,
          text: childContext.message?.content?.[0]?.text,
          toolCalls: childContext.message?.toolCalls,
        },
        loops: childLoops.map((row) => ({
          agentId: row.agentId,
          type: row.event?.type,
          turnId: row.event?.turnId,
          step: row.event?.step,
          stepUuid: row.event?.stepUuid,
          part: row.event?.part,
        })),
        ended: childEnded && {
          agentId: childEnded.agentId,
          turnId: childEnded.turnId,
          numericTurnId: typeof childEnded.turnId === "number",
          reason: childEnded.reason,
        },
        legacyKeys: [...childText.matchAll(/"(?:turn_id|call_id|model_alias|thinking_effort)"\s*:/g)].length,
      },
      rows: agents.length,
      sourceIds: agents.map((agent) => agent.sourceSessionId),
      uniqueAgentIds: new Set(agents.map((agent) => agent.id)).size,
      uniqueInstances: new Set(agents.map((agent) => agent.instanceId)).size,
      parents: agents.map((agent) => agent.parentSourceSessionId),
      depths: agents.map((agent) => agent.threadDepth),
      subagents: agents.map((agent) => agent.subagentCount),
      associations: agents.map((agent) => ({
        instanceId: agent.instanceId,
        childArtifacts: agent.artifacts
          .filter((artifact: { path: string }) => fixtureChildWires.has(artifact.path))
          .map((artifact: { path: string }) => artifact.path),
      })),
    }).toEqual({
      rawChild: {
        prompt: {
          agentId: "agent-0",
          input: [{ type: "text", text: "Check one public child relation." }],
          origin: { kind: "user" },
        },
        context: {
          agentId: "agent-0",
          role: "user",
          text: "Check one public child relation.",
          toolCalls: [],
        },
        loops: [
          { agentId: "agent-0", type: "step.begin", turnId: "0", step: 1, stepUuid: undefined, part: undefined },
          {
            agentId: "agent-0",
            type: "content.part",
            turnId: "0",
            step: 1,
            stepUuid: "55555555-5555-4555-8555-555555555555",
            part: { type: "text", text: "The public child relation is present." },
          },
          { agentId: "agent-0", type: "step.end", turnId: "0", step: 1, stepUuid: undefined, part: undefined },
        ],
        ended: { agentId: "agent-0", turnId: 0, numericTurnId: true, reason: "completed" },
        legacyKeys: 0,
      },
      rows: 2,
      sourceIds: [SESSION_ID, SESSION_ID],
      uniqueAgentIds: 2,
      uniqueInstances: 2,
      parents: [PARENT_ID, PARENT_ID],
      depths: [1, 1],
      subagents: [1, 1],
      associations: [
        { instanceId: instanceIdFor(KIMI_KIND, first.root), childArtifacts: [first.childWire] },
        { instanceId: instanceIdFor(KIMI_KIND, second.root), childArtifacts: [second.childWire] },
      ],
    });
  });

  test("KIMI-RED-12 latest-turn outcomes preserve turn evidence without fabricating session exit liveness launch pid or USD", async () => {
    const completed = defaultFixture("end-completed", (draft) => {
      if (draft.state) delete draft.state.lastTurnReason;
      wireMutation(draft, (rows) => [...rows,
        { type: "turn.steer", agentId: "main", input: [{ type: "text", text: "Steer the completed public fixture without minting a turn." }], origin: { kind: "user" }, time: UPDATED_AT + 1_000 },
      ]);
    });
    const continued = defaultFixture("end-continued", (draft) => {
      if (draft.state) delete draft.state.lastTurnReason;
      wireMutation(draft, (rows) => [...rows,
        { type: "turn.prompt", agentId: "main", input: [{ type: "text", text: "Continue the public fixture." }], origin: { kind: "user" }, time: UPDATED_AT + 1_000 },
      ]);
    });
    const compactionOnly = defaultFixture("end-compaction-only", (draft) => {
      if (draft.state) delete draft.state.lastTurnReason;
      wireMutation(draft, (rows) => [...rows.filter((row) => row.type !== "turn.ended"),
        { type: "context.apply_compaction", agentId: "main", summary: "Public fixture compaction is not an end.", compactedCount: 2, time: UPDATED_AT + 1_000 },
      ]);
    });
    const archiveOnly = defaultFixture("end-archive-only", (draft) => {
      if (draft.state) {
        delete draft.state.lastTurnReason;
        Object.assign(draft.state, { archived: true, archivedAt: UPDATED_AT + 1_000 });
      }
      wireMutation(draft, (rows) => rows.filter((row) => row.type !== "turn.ended"));
    });
    const outcome = (label: string, reason: "cancelled" | "failed" | "blocked") => defaultFixture(label, (draft) => {
      if (reason === "blocked" && draft.state) delete draft.state.lastTurnReason;
      else Object.assign(draft.state ?? {}, { lastTurnReason: reason });
      wireMutation(draft, (rows) => rows.map((row) =>
        row.type === "turn.ended" ? { ...row, reason } : row));
    });
    const cancelled = outcome("end-cancelled", "cancelled");
    const failed = outcome("end-failed", "failed");
    const blocked = outcome("end-blocked", "blocked");
    const stateOnly = defaultFixture("end-state-only", (draft) => {
      wireMutation(draft, (rows) => rows.filter((row) => row.type !== "turn.ended"));
    });
    const openVeto = defaultFixture("end-open-veto", (draft) => {
      wireMutation(draft, (rows) => [...rows,
        { type: "turn.prompt", agentId: "main", input: [{ type: "text", text: "This newer turn is still open." }], origin: { kind: "user" }, time: UPDATED_AT + 1_000 },
      ]);
    });
    const conflict = defaultFixture("end-conflict", (draft) => {
      Object.assign(draft.state ?? {}, { lastTurnReason: "failed" });
    });
    const fixtures = [completed, continued, compactionOnly, archiveOnly, cancelled, failed, blocked, stateOnly, openVeto, conflict];
    const results = await Promise.all(fixtures.map((fixture) => collectKimi(fixture.operatorHome)));
    const [completedResult, continuedResult, compactionOnlyResult, archiveOnlyResult, cancelledResult, failedResult, blockedResult, stateOnlyResult, openVetoResult, conflictResult] = results;
    const project = (agent: any) => agent && {
      endEvidence: agent.endEvidence,
      transcriptEndedCleanly: agent.transcriptEndedCleanly,
      archivedAt: agent.archivedAt,
      processAlive: agent.processAlive,
      processIds: agent.processIds,
      processStarts: agent.processStarts,
      launch: agent.launch,
      launchCwd: agent.launchCwd,
      cost: agent.cost,
      usdInWireShape: /(?:cost|usd|amount|currency)/i.test(JSON.stringify(agent)),
    };
    const conflictWarnings = conflictResult!.errors.filter((reason) =>
      reason.includes(conflict.fixture.mainWire) && /conflict/i.test(reason));

    expect({
      completed: project(onlyAgent(completedResult!)),
      continued: project(onlyAgent(continuedResult!)),
      compactionOnly: project(onlyAgent(compactionOnlyResult!)),
      archiveOnly: project(onlyAgent(archiveOnlyResult!)),
      cancelled: project(onlyAgent(cancelledResult!)),
      failed: project(onlyAgent(failedResult!)),
      blocked: project(onlyAgent(blockedResult!)),
      stateOnly: project(onlyAgent(stateOnlyResult!)),
      openVeto: project(onlyAgent(openVetoResult!)),
      conflict: project(onlyAgent(conflictResult!)),
      conflictWarning: conflictWarnings.length === 1,
    }).toEqual({
      completed: {
        endEvidence: "turn-complete",
        transcriptEndedCleanly: true,
        archivedAt: undefined,
        processAlive: undefined,
        processIds: undefined,
        processStarts: undefined,
        launch: undefined,
        launchCwd: undefined,
        cost: undefined,
        usdInWireShape: false,
      },
      continued: {
        endEvidence: undefined,
        transcriptEndedCleanly: undefined,
        archivedAt: undefined,
        processAlive: undefined,
        processIds: undefined,
        processStarts: undefined,
        launch: undefined,
        launchCwd: undefined,
        cost: undefined,
        usdInWireShape: false,
      },
      compactionOnly: {
        endEvidence: undefined,
        transcriptEndedCleanly: undefined,
        archivedAt: undefined,
        processAlive: undefined,
        processIds: undefined,
        processStarts: undefined,
        launch: undefined,
        launchCwd: undefined,
        cost: undefined,
        usdInWireShape: false,
      },
      archiveOnly: {
        endEvidence: undefined,
        transcriptEndedCleanly: undefined,
        archivedAt: undefined,
        processAlive: undefined,
        processIds: undefined,
        processStarts: undefined,
        launch: undefined,
        launchCwd: undefined,
        cost: undefined,
        usdInWireShape: false,
      },
      cancelled: {
        endEvidence: "turn-complete",
        transcriptEndedCleanly: undefined,
        archivedAt: undefined,
        processAlive: undefined,
        processIds: undefined,
        processStarts: undefined,
        launch: undefined,
        launchCwd: undefined,
        cost: undefined,
        usdInWireShape: false,
      },
      failed: {
        endEvidence: "turn-complete",
        transcriptEndedCleanly: undefined,
        archivedAt: undefined,
        processAlive: undefined,
        processIds: undefined,
        processStarts: undefined,
        launch: undefined,
        launchCwd: undefined,
        cost: undefined,
        usdInWireShape: false,
      },
      blocked: {
        endEvidence: "turn-complete",
        transcriptEndedCleanly: undefined,
        archivedAt: undefined,
        processAlive: undefined,
        processIds: undefined,
        processStarts: undefined,
        launch: undefined,
        launchCwd: undefined,
        cost: undefined,
        usdInWireShape: false,
      },
      stateOnly: {
        endEvidence: "turn-complete",
        transcriptEndedCleanly: true,
        archivedAt: undefined,
        processAlive: undefined,
        processIds: undefined,
        processStarts: undefined,
        launch: undefined,
        launchCwd: undefined,
        cost: undefined,
        usdInWireShape: false,
      },
      openVeto: {
        endEvidence: undefined,
        transcriptEndedCleanly: undefined,
        archivedAt: undefined,
        processAlive: undefined,
        processIds: undefined,
        processStarts: undefined,
        launch: undefined,
        launchCwd: undefined,
        cost: undefined,
        usdInWireShape: false,
      },
      conflict: {
        endEvidence: "turn-complete",
        transcriptEndedCleanly: undefined,
        archivedAt: undefined,
        processAlive: undefined,
        processIds: undefined,
        processStarts: undefined,
        launch: undefined,
        launchCwd: undefined,
        cost: undefined,
        usdInWireShape: false,
      },
      conflictWarning: true,
    });
  });

  test("KIMI-RED-17 public transcript timestamps survive while Inspector bodies stay hidden and debug calls require completeness", async () => {
    const fixture = directFixture("debug-complete");
    const fixtureRows = jsonlRows(readFileSync(fixture.mainWire, "utf8"));
    const successfulCall = fixtureRows.find((row) =>
      row.type === "context.append_loop_event"
      && row.event?.type === "tool.call"
      && row.event?.toolCallId === "call_fixture_read");
    const successfulResult = fixtureRows.find((row) =>
      row.type === "context.append_loop_event"
      && row.event?.type === "tool.result"
      && row.event?.toolCallId === "call_fixture_read");
    const incompleteFixture = directFixture("debug-incomplete", (draft) => {
      wireMutation(draft, (rows) => {
        for (const row of rows) {
          const usage = row.type === "usage.record"
            ? row.usage
            : row.type === "context.append_loop_event" && row.event?.type === "step.end"
              ? row.event.usage
              : undefined;
          if (usage) delete usage.inputCacheCreation;
        }
        return rows;
      });
    });
    const continuedFixture = directFixture("debug-continued", (draft) => {
      if (draft.state) delete draft.state.lastTurnReason;
      wireMutation(draft, (rows) => [...rows,
        { type: "turn.prompt", agentId: "main", input: [{ type: "text", text: "Continue with the public fixture follow-up." }], origin: { kind: "user" }, time: UPDATED_AT + 1_000 },
        { type: "context.append_message", agentId: "main", message: { role: "user", content: [{ type: "text", text: "Continue with the public fixture follow-up." }], toolCalls: [] }, time: UPDATED_AT + 2_000 },
      ]);
    });
    const agent = manualKimiAgent(fixture.mainWire);
    const incompleteAgent = manualKimiAgent(incompleteFixture.mainWire);
    const snapshot = endpointSnapshot(agent);
    const transcript = await transcriptResponse(snapshot, agent.id, 100, {});
    const transcriptBody = await transcript.json() as { lines?: Array<{ role?: string; text?: string; at?: string | null }> };
    const calls = await sessionCallsResponse(snapshot, agent.id, {});
    const callsBody = await calls.json() as Record<string, unknown>;
    const incompleteCalls = await sessionCallsResponse(endpointSnapshot(incompleteAgent), incompleteAgent.id, {});
    const incompleteCallsBody = await incompleteCalls.json() as Record<string, unknown>;
    const collected = onlyAgent(await collectKimi(tempRoot("debug-collected-home"), {
      extraKimiRoots: [fixture.root],
    }));
    const continued = onlyAgent(await collectKimi(tempRoot("debug-continued-home"), {
      extraKimiRoots: [continuedFixture.root],
    }));
    const lines = transcriptBody.lines ?? [];
    const line = (role: string, text: string) => lines.find((candidate) => candidate.role === role && candidate.text === text);
    const tailOrder = (tail: string, sentinels: readonly string[]) => {
      const indexes = sentinels.map((sentinel) => tail.indexOf(sentinel));
      return {
        bounded: tail.length <= MAX_TRANSCRIPT_TAIL_CHARS,
        allPresent: indexes.every((index) => index >= 0),
        ordered: indexes.every((index, position) => position === 0 || index > indexes[position - 1]!),
      };
    };
    const baseTail = collected?.transcriptTail ?? "";
    const continuedTail = continued?.transcriptTail ?? "";
    const privateBodies = /argument-must-stay-hidden|encrypted-body-must-stay-hidden|tool-result-body-must-stay-hidden|failed-argument-must-stay-hidden|failed-tool-result-body-must-stay-hidden/;
    const successfulToolLine = line("tool", "read\nCall: call_fixture_read\nStatus: completed");

    expect({
      publicLines: lines.map(({ role, text, at }) => ({ role, text, at })),
      lineCounts: {
        user: lines.filter(({ role }) => role === "user").length,
        tool: lines.filter(({ role }) => role === "tool").length,
      },
      userAt: line("user", "Please inspect the public fixture.")?.at,
      assistantAt: line("assistant", "I will inspect only the public fixture.")?.at,
      thoughtAt: line("system", "Thought\nCheck the public fixture relationships.")?.at,
      toolAt: successfulToolLine?.at,
      failedToolAt: line("tool", "write\nCall: call_fixture_write_failed\nStatus: failed")?.at,
      successfulToolTimes: {
        call: successfulCall?.time,
        result: successfulResult?.time,
        published: successfulToolLine?.at,
        resultNotCall: successfulToolLine?.at === (
          typeof successfulResult?.time === "number"
            ? new Date(successfulResult.time).toISOString()
            : undefined
        ) && successfulToolLine?.at !== (
          typeof successfulCall?.time === "number"
            ? new Date(successfulCall.time).toISOString()
            : undefined
        ),
      },
      leaksBodies: privateBodies.test(JSON.stringify(transcriptBody)),
      calls: callsBody.calls,
      sessionProcessed: callsBody.sessionProcessed,
      prefixSums: callsBody.prefixSums,
      unavailable: callsBody.unavailable,
      incomplete: {
        calls: incompleteCallsBody.calls,
        sessionProcessed: incompleteCallsBody.sessionProcessed,
        prefixSums: incompleteCallsBody.prefixSums,
        unavailable: incompleteCallsBody.unavailable,
      },
      collected: {
        lastThreadAt: collected?.lastThreadAt,
        lastHumanMessage: collected?.lastHumanMessage,
        lastUserFacingAt: collected?.lastUserFacingAt,
        lastHumanFacingAt: collected?.lastHumanFacingAt,
        lastAgentClosing: collected?.lastAgentClosing,
        tail: tailOrder(baseTail, [
          "Please inspect the public fixture.",
          "I will inspect only the public fixture.",
          "Thought\nCheck the public fixture relationships.",
          "read\nCall: call_fixture_read\nStatus: completed",
          "write\nCall: call_fixture_write_failed\nStatus: failed",
        ]),
        leaksBodies: privateBodies.test(baseTail),
      },
      continued: {
        lastHumanMessage: continued?.lastHumanMessage,
        lastUserFacingAt: continued?.lastUserFacingAt,
        lastHumanFacingAt: continued?.lastHumanFacingAt,
        lastAgentClosing: continued?.lastAgentClosing,
        lastThreadAt: continued?.lastThreadAt,
        tail: tailOrder(continuedTail, [
          "read\nCall: call_fixture_read\nStatus: completed",
          "write\nCall: call_fixture_write_failed\nStatus: failed",
          "Continue with the public fixture follow-up.",
        ]),
        leaksBodies: privateBodies.test(continuedTail),
      },
    }).toEqual({
      publicLines: [
        { role: "user", text: "Please inspect the public fixture.", at: new Date(CREATED_AT + 6_500).toISOString() },
        { role: "assistant", text: "I will inspect only the public fixture.", at: new Date(CREATED_AT + 3_000).toISOString() },
        { role: "system", text: "Thought\nCheck the public fixture relationships.", at: new Date(CREATED_AT + 4_000).toISOString() },
        { role: "tool", text: "read\nCall: call_fixture_read\nStatus: completed", at: new Date(CREATED_AT + 6_000).toISOString() },
        { role: "tool", text: "write\nCall: call_fixture_write_failed\nStatus: failed", at: new Date(CREATED_AT + 6_200).toISOString() },
      ],
      lineCounts: { user: 1, tool: 2 },
      userAt: new Date(CREATED_AT + 6_500).toISOString(),
      assistantAt: new Date(CREATED_AT + 3_000).toISOString(),
      thoughtAt: new Date(CREATED_AT + 4_000).toISOString(),
      toolAt: new Date(CREATED_AT + 6_000).toISOString(),
      failedToolAt: new Date(CREATED_AT + 6_200).toISOString(),
      successfulToolTimes: {
        call: CREATED_AT + 5_000,
        result: CREATED_AT + 6_000,
        published: new Date(CREATED_AT + 6_000).toISOString(),
        resultNotCall: true,
      },
      leaksBodies: false,
      calls: [60],
      sessionProcessed: 60,
      prefixSums: [60],
      unavailable: undefined,
      incomplete: {
        calls: null,
        sessionProcessed: null,
        prefixSums: null,
        unavailable: expect.stringMatching(/Kimi.*(?:partial|incomplete)|(?:partial|incomplete).*Kimi/i),
      },
      collected: {
        lastThreadAt: new Date(CREATED_AT + 6_500).toISOString(),
        lastHumanMessage: "I will inspect only the public fixture.",
        lastUserFacingAt: new Date(CREATED_AT + 6_500).toISOString(),
        lastHumanFacingAt: new Date(CREATED_AT + 3_000).toISOString(),
        lastAgentClosing: "I will inspect only the public fixture.",
        tail: { bounded: true, allPresent: true, ordered: true },
        leaksBodies: false,
      },
      continued: {
        lastHumanMessage: "Continue with the public fixture follow-up.",
        lastUserFacingAt: new Date(UPDATED_AT + 2_000).toISOString(),
        lastHumanFacingAt: new Date(UPDATED_AT + 2_000).toISOString(),
        lastAgentClosing: "I will inspect only the public fixture.",
        lastThreadAt: new Date(UPDATED_AT + 2_000).toISOString(),
        tail: { bounded: true, allPresent: true, ordered: true },
        leaksBodies: false,
      },
    });
  });
});
