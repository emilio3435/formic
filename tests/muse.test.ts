import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectSessionProvider } from "../src/server/collectors";
import {
  identitiesFromCommand,
  identityFromSessionPath,
  isRecognizedAgentProcess,
} from "../src/server/identity";
import { collectMuseSessions, museTimestamp, parseMuseSession } from "../src/server/muse";

const FIXTURE = join(import.meta.dir, "fixtures/muse");
const PARENT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CHILD = "ffffffff-1111-4222-8333-444444444444";
const BARE = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const NOW_MS = 1_786_872_100_000;
const WINDOW_MS = Number.POSITIVE_INFINITY;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("recorded_at microseconds become ISO times", () => {
  expect(museTimestamp(1_786_872_000_123_456)).toBe("2026-08-16T09:20:00.123Z");
});

test("a fixture Muse session is a muse row with task, closing, and observed tokens", async () => {
  const result = await collectMuseSessions(FIXTURE, WINDOW_MS, undefined, NOW_MS);
  expect(result.errors).toEqual([]);
  const parent = result.value.find((agent) => agent.sourceSessionId === PARENT);
  expect(parent).toMatchObject({
    id: `muse:${PARENT}`,
    provider: "muse",
    task: "Review the Muse collector contract.",
    cwd: "/Users/me/Developer/formic",
    model: "muse-1",
    lastUserMessage: "Review the Muse collector contract.",
    lastAgentClosing: "I can collect the parent and the child separately. Should I keep child tokens out of the parent?",
    tokens: {
      sessionTotal: 200,
      sessionProcessed: 220,
      provenance: "observed",
    },
  });
  expect(parent?.callSizes).toEqual([220]);
});

test("a child subagent is a separate row and does not fold tokens into the parent", async () => {
  const result = await collectMuseSessions(FIXTURE, WINDOW_MS, undefined, NOW_MS);
  const parent = result.value.find((agent) => agent.sourceSessionId === PARENT);
  const child = result.value.find((agent) => agent.sourceSessionId === `${PARENT}/${CHILD}`);
  expect(child).toMatchObject({
    provider: "muse",
    parentSourceSessionId: PARENT,
    tokens: { sessionTotal: 60, sessionProcessed: 60, provenance: "observed" },
  });
  expect(parent?.tokens.sessionTotal).toBe(200);
});

test("a Muse log without usage reports unknown tokens, not zero", async () => {
  const result = await collectMuseSessions(FIXTURE, WINDOW_MS, undefined, NOW_MS);
  const bare = result.value.find((agent) => agent.sourceSessionId === BARE);
  expect(bare?.tokens).toEqual({ scope: "unknown", provenance: "unknown" });
  expect(bare?.callSizes).toBeUndefined();
  expect(bare?.tokens).not.toHaveProperty("contextWindow");
});

test("observed tokens plus a Spark model attach the catalog 1M window", () => {
  const agent = parseMuseSession(PARENT, `${JSON.stringify({
    recorded_at: 1_786_872_000_123_456,
    payload: { event: { kind: "user_prompt_display", text: "Use Spark.", model: "muse-spark-1.2" } },
  })}\n${JSON.stringify({
    recorded_at: 1_786_872_001_123_456,
    payload: { event: { kind: "model_completed", usage: { input_tokens: 10, output_tokens: 5, cached_tokens: 2 } } },
  })}\n`);
  expect(agent?.tokens).toMatchObject({
    sessionTotal: 15,
    sessionProcessed: 17,
    provenance: "observed",
    contextWindow: 1_000_000,
  });
});

test("an unknown Muse model leaves the window unset", () => {
  const agent = parseMuseSession(PARENT, `${JSON.stringify({
    recorded_at: 1_786_872_000_123_456,
    payload: { event: { kind: "user_prompt_display", text: "Unknown model.", model: "muse-1" } },
  })}\n${JSON.stringify({
    recorded_at: 1_786_872_001_123_456,
    payload: { event: { kind: "model_completed", usage: { input_tokens: 10, output_tokens: 5 } } },
  })}\n`);
  expect(agent?.model).toBe("muse-1");
  expect(agent?.tokens.provenance).toBe("observed");
  expect(agent?.tokens).not.toHaveProperty("contextWindow");
});

test("a missing Muse store is absent", async () => {
  const home = await mkdtemp(join(tmpdir(), "mountain-muse-absent-"));
  temporaryDirectories.push(home);
  expect(await collectSessionProvider("muse", home)).toEqual({ value: [], errors: [], absent: true });
});

test("an empty Muse store is present with zero rows", async () => {
  const home = await mkdtemp(join(tmpdir(), "mountain-muse-empty-"));
  temporaryDirectories.push(home);
  await mkdir(join(home, ".local/share/muse"), { recursive: true });
  expect(await collectSessionProvider("muse", home)).toEqual({ value: [], errors: [] });
});

test("muse resume names the session and muse-bin is recognized", () => {
  expect(identitiesFromCommand(`muse resume ${PARENT}`)).toEqual([
    { provider: "muse", value: PARENT, full: true },
  ]);
  expect(isRecognizedAgentProcess("/Users/me/.local/bin/muse-bin-0.1.0-R708.1 resume --last")).toBe(true);
  expect(identityFromSessionPath(
    `/Users/me/.local/share/muse/sessions/2026/08/16/${PARENT}/session.jsonl`,
  )).toEqual({ provider: "muse", value: PARENT, full: true });
  expect(identityFromSessionPath(
    `/Users/me/.local/share/muse/sessions/2026/08/16/${PARENT}/subagent/${CHILD}/session.jsonl`,
  )).toEqual({ provider: "muse", value: `${PARENT}/${CHILD}`, full: true });
});

test("session.end with a crash is an unclean session-exit", async () => {
  const home = await mkdtemp(join(tmpdir(), "mountain-muse-crash-"));
  temporaryDirectories.push(home);
  const root = join(home, ".local/share/muse");
  const session = join(root, "sessions/2026/08/16", PARENT);
  await mkdir(session, { recursive: true });
  await writeFile(join(session, "session.jsonl"), `${JSON.stringify({
    recorded_at: 1_786_872_000_123_456,
    payload: { event: { kind: "user_prompt_display", text: "Stay up." } },
  })}\n${JSON.stringify({
    recorded_at: 1_786_872_001_123_456,
    payload: { kind: "session.end", record: { exit_reason: "crash_inferred" } },
  })}\n`);
  const result = await collectMuseSessions(root, WINDOW_MS, undefined, NOW_MS);
  expect(result.value[0]).toMatchObject({
    endEvidence: "session-exit",
    transcriptEndedCleanly: undefined,
  });
});
