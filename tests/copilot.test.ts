import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectSessionProvider } from "../src/server/collectors";
import { collectCopilotSessions, parseCopilotSession } from "../src/server/copilot";
import {
  identitiesFromCommand,
  identityFromSessionPath,
  isRecognizedAgentProcess,
} from "../src/server/identity";

const FIXTURE = join(import.meta.dir, "fixtures/copilot");
const CLOSED = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OPEN = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const NOW_MS = Date.parse("2026-08-17T12:20:00.000Z");
const WINDOW_MS = Number.POSITIVE_INFINITY;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("a fixture Copilot CLI session is a copilot row with task, closing, and observed tokens", async () => {
  const result = await collectCopilotSessions(FIXTURE, WINDOW_MS, undefined, [], NOW_MS);
  expect(result.errors).toEqual([]);
  const closed = result.value.find((agent) => agent.sourceSessionId === CLOSED);
  expect(closed).toMatchObject({
    id: `copilot:${CLOSED}`,
    provider: "copilot",
    task: "Review the Copilot CLI collector contract.",
    cwd: "/Users/me/Developer/formic",
    model: "gpt-5.4",
    lastUserMessage: "Review the Copilot CLI collector contract.",
    lastAgentClosing: "I can collect session-state events.jsonl. Should unknown fields stay unknown?",
    endEvidence: "session-exit",
    tokens: {
      sessionTotal: 210,
      sessionProcessed: 230,
      provenance: "observed",
      contextWindow: 131_072,
    },
  });
  expect(closed?.tokens).not.toHaveProperty("contextPct");
});

test("a Copilot log without shutdown modelMetrics reports unknown tokens, not zero", async () => {
  const result = await collectCopilotSessions(FIXTURE, WINDOW_MS, undefined, [], NOW_MS);
  const open = result.value.find((agent) => agent.sourceSessionId === OPEN);
  expect(open?.tokens).toEqual({ scope: "unknown", provenance: "unknown" });
  expect(open?.endEvidence).toBeUndefined();
  expect(open?.lastAgentClosing).toBe("No modelMetrics yet, so tokens stay unknown.");
  expect(open?.tokens).not.toHaveProperty("contextWindow");
});

test("a live Copilot session with a known model keeps tokens unknown and still attaches the window", () => {
  const agent = parseCopilotSession(OPEN, `${JSON.stringify({
    type: "session.start",
    timestamp: "2026-08-17T12:10:00.000Z",
    data: { context: { cwd: "/Users/me/Developer/formic" } },
  })}\n${JSON.stringify({
    type: "session.model_change",
    timestamp: "2026-08-17T12:10:01.000Z",
    data: { newModel: "gpt-5.6-sol" },
  })}\n${JSON.stringify({
    type: "user.message",
    timestamp: "2026-08-17T12:10:02.000Z",
    data: { content: "Still running." },
  })}\n`);
  expect(agent?.tokens).toEqual({
    scope: "unknown",
    provenance: "unknown",
    contextWindow: 258_400,
  });
  expect(agent?.endEvidence).toBeUndefined();
});

test("shutdown with an unknown model observes tokens and leaves the window unset", () => {
  const agent = parseCopilotSession(CLOSED, `${JSON.stringify({
    type: "session.model_change",
    timestamp: "2026-08-17T12:00:00.000Z",
    data: { newModel: "mystery-copilot" },
  })}\n${JSON.stringify({
    type: "session.shutdown",
    timestamp: "2026-08-17T12:00:01.000Z",
    data: {
      shutdownType: "routine",
      currentModel: "mystery-copilot",
      modelMetrics: { "mystery-copilot": { usage: { inputTokens: 8, outputTokens: 2 } } },
    },
  })}\n`);
  expect(agent?.tokens).toEqual({
    sessionTotal: 10,
    sessionProcessed: 10,
    scope: "session",
    provenance: "observed",
  });
  expect(agent?.tokens).not.toHaveProperty("contextWindow");
});

test("Copilot display names match catalog needles without inventing a Terra window", () => {
  const sol = parseCopilotSession(CLOSED, `${JSON.stringify({
    type: "session.model_change",
    timestamp: "2026-08-17T12:00:00.000Z",
    data: { newModel: "GPT-5.6 Sol" },
  })}\n${JSON.stringify({
    type: "session.shutdown",
    timestamp: "2026-08-17T12:00:01.000Z",
    data: {
      currentModel: "GPT-5.6 Sol",
      modelMetrics: { "GPT-5.6 Sol": { usage: { inputTokens: 1, outputTokens: 1 } } },
    },
  })}\n`);
  expect(sol?.tokens.contextWindow).toBe(258_400);
  const terra = parseCopilotSession(CLOSED, `${JSON.stringify({
    type: "session.model_change",
    timestamp: "2026-08-17T12:00:00.000Z",
    data: { newModel: "gpt-5.6-terra" },
  })}\n${JSON.stringify({
    type: "session.shutdown",
    timestamp: "2026-08-17T12:00:01.000Z",
    data: {
      currentModel: "gpt-5.6-terra",
      modelMetrics: { "gpt-5.6-terra": { usage: { inputTokens: 1, outputTokens: 1 } } },
    },
  })}\n`);
  expect(terra?.tokens.provenance).toBe("observed");
  expect(terra?.tokens).not.toHaveProperty("contextWindow");
});

test("parseCopilotSession ignores unknown event types and does not invent last-close text", () => {
  const agent = parseCopilotSession(CLOSED, `${JSON.stringify({
    type: "session.start",
    timestamp: "2026-08-17T12:00:00.000Z",
    data: { context: { cwd: "/Users/me/Developer/formic" } },
  })}\n${JSON.stringify({
    type: "mystery.progress",
    timestamp: "2026-08-17T12:00:01.000Z",
    data: { percent: 47, lastClose: "invented" },
  })}\n${JSON.stringify({
    type: "user.message",
    timestamp: "2026-08-17T12:00:02.000Z",
    data: { content: "Keep unknown fields unknown." },
  })}\n`);
  expect(agent).toMatchObject({
    task: "Keep unknown fields unknown.",
    cwd: "/Users/me/Developer/formic",
    tokens: { scope: "unknown", provenance: "unknown" },
  });
  expect(agent?.lastAgentClosing).toBeFalsy();
  expect(agent?.transcriptTail).toBeUndefined();
});

test("session.shutdown with shutdownType error is an unclean session-exit", () => {
  const agent = parseCopilotSession(CLOSED, `${JSON.stringify({
    type: "user.message",
    timestamp: "2026-08-17T12:00:00.000Z",
    data: { content: "Stay up." },
  })}\n${JSON.stringify({
    type: "session.shutdown",
    timestamp: "2026-08-17T12:00:01.000Z",
    data: { shutdownType: "error", errorReason: "crash" },
  })}\n`);
  expect(agent).toMatchObject({
    endEvidence: "session-exit",
    transcriptEndedCleanly: undefined,
  });
});

test("a missing Copilot home is absent", async () => {
  const home = await mkdtemp(join(tmpdir(), "formic-copilot-absent-"));
  temporaryDirectories.push(home);
  expect(await collectSessionProvider("copilot", home)).toEqual({ value: [], errors: [], absent: true });
});

test("an empty Copilot home is present with zero rows", async () => {
  const home = await mkdtemp(join(tmpdir(), "formic-copilot-empty-"));
  temporaryDirectories.push(home);
  await mkdir(join(home, ".copilot"), { recursive: true });
  expect(await collectSessionProvider("copilot", home)).toEqual({ value: [], errors: [] });
});

test("COPILOT_HOME overrides the default Copilot home", async () => {
  const root = join(await mkdtemp(join(tmpdir(), "formic-copilot-env-")), "custom-copilot");
  temporaryDirectories.push(root);
  const previous = process.env.COPILOT_HOME;
  process.env.COPILOT_HOME = root;
  try {
    const { homedir } = await import("node:os");
    expect(await collectSessionProvider("copilot", homedir()))
      .toEqual({ value: [], errors: [], absent: true });
    await mkdir(root, { recursive: true });
    expect(await collectSessionProvider("copilot", homedir()))
      .toEqual({ value: [], errors: [] });
  } finally {
    if (previous === undefined) delete process.env.COPILOT_HOME;
    else process.env.COPILOT_HOME = previous;
  }
});

test("an onboarded extra Copilot home becomes copilot rows with an instance label", async () => {
  const home = await mkdtemp(join(tmpdir(), "formic-copilot-extra-"));
  temporaryDirectories.push(home);
  const extraId = "cccccccc-dddd-4eee-8fff-000000000000";
  const extra = join(home, ".copilot-2");
  await mkdir(join(home, ".copilot", "session-state", CLOSED), { recursive: true });
  await writeFile(join(home, ".copilot", "session-state", CLOSED, "events.jsonl"), `${JSON.stringify({
    type: "user.message",
    timestamp: "2026-08-17T12:00:00.000Z",
    data: { content: "Default Copilot home." },
  })}\n`);
  await mkdir(join(extra, "session-state", extraId), { recursive: true });
  await writeFile(join(extra, "session-state", extraId, "events.jsonl"), `${JSON.stringify({
    type: "user.message",
    timestamp: "2026-08-17T12:00:00.000Z",
    data: { content: "Second Copilot home." },
  })}\n`);
  const result = await collectSessionProvider("copilot", home, WINDOW_MS, undefined, {
    extraCopilotRoots: [extra],
  });
  expect(result.errors).toEqual([]);
  expect(result.value.some((agent) => agent.id === `copilot:${CLOSED}` && agent.instanceLabel === undefined)).toBe(true);
  expect(result.value.find((agent) => agent.sourceSessionId === extraId)).toMatchObject({
    provider: "copilot",
    instanceLabel: ".copilot-2",
    task: "Second Copilot home.",
  });
});

test("copilot --resume and --session-id name the session; the binary is recognized", () => {
  expect(identitiesFromCommand(`copilot --resume ${CLOSED}`)).toEqual([
    { provider: "copilot", value: CLOSED, full: true },
  ]);
  expect(identitiesFromCommand(`copilot --resume=${CLOSED}`)).toEqual([
    { provider: "copilot", value: CLOSED, full: true },
  ]);
  expect(identitiesFromCommand(`copilot -r ${CLOSED}`)).toEqual([
    { provider: "copilot", value: CLOSED, full: true },
  ]);
  expect(identitiesFromCommand(`copilot --session-id ${CLOSED}`)).toEqual([
    { provider: "copilot", value: CLOSED, full: true },
  ]);
  expect(identitiesFromCommand("copilot --continue")).toEqual([]);
  expect(isRecognizedAgentProcess("copilot --continue")).toBe(true);
  expect(isRecognizedAgentProcess("/opt/homebrew/bin/copilot")).toBe(true);
  expect(identityFromSessionPath(
    `/Users/me/.copilot/session-state/${CLOSED}/events.jsonl`,
  )).toEqual({ provider: "copilot", value: CLOSED, full: true });
  expect(identityFromSessionPath(
    `/tmp/custom-copilot/session-state/${CLOSED}/events.jsonl`,
  )).toEqual({ provider: "copilot", value: CLOSED, full: true });
});
