import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectAntigravitySessions } from "../src/server/antigravity";
import { collectSessionProvider } from "../src/server/collectors";
import {
  identitiesFromCommand,
  identityFromSessionPath,
  isRecognizedAgentProcess,
} from "../src/server/identity";

const ID = "56add14e-7207-44dd-a6a3-8c2a5b64987e";
const IDE_ID = "3c887402-9549-499c-a608-d4c08bca8b5f";
const NOW_MS = Date.parse("2026-06-03T12:00:00.000Z");
const WINDOW_MS = Number.POSITIVE_INFINITY;
const CWD = "/Users/me/Developer/sem-forecast";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixtureHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "mountain-antigravity-"));
  temporaryDirectories.push(home);
  return home;
}

function writeConversationDb(path: string, cwd = CWD, model?: string): void {
  const db = new Database(path);
  db.run("create table trajectory_meta (trajectory_id text, cascade_id text, trajectory_type integer, source integer, last_selected_agent_model text)");
  db.run("create table trajectory_metadata_blob (data blob)");
  db.run(
    "insert into trajectory_meta(trajectory_id, cascade_id, trajectory_type, source, last_selected_agent_model) values (?, ?, 4, 1, ?)",
    [
      "208761a1-8733-4596-b6df-3dcba849df62",
      ID,
      model ?? null,
    ],
  );
  db.run("insert into trajectory_metadata_blob(data) values (?)", [
    `noise file://${cwd} more-noise`,
  ]);
  db.close();
}

async function writeTranscript(root: string, sessionId: string): Promise<void> {
  const dir = join(root, "brain", sessionId, ".system_generated", "logs");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "transcript.jsonl"), [
    JSON.stringify({
      step_index: 0,
      source: "USER_EXPLICIT",
      type: "USER_INPUT",
      status: "DONE",
      created_at: "2026-06-03T11:57:27Z",
      content: "<USER_REQUEST>\nReview the Antigravity collector.\n</USER_REQUEST>",
    }),
    JSON.stringify({
      step_index: 1,
      source: "SYSTEM",
      type: "EPHEMERAL_MESSAGE",
      status: "DONE",
      created_at: "2026-06-03T11:57:28Z",
      content: "planning reminders",
    }),
    JSON.stringify({
      step_index: 2,
      source: "MODEL",
      type: "VIEW_FILE",
      status: "DONE",
      created_at: "2026-06-03T11:57:29Z",
      content: `File Path: file://${CWD}/README.md`,
    }),
    JSON.stringify({
      step_index: 3,
      source: "MODEL",
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: "2026-06-03T11:57:37Z",
      content: "1. Verdict: GO-WITH-FIXES. Should I apply the listed corrections?",
    }),
  ].join("\n"));
}

test("a fixture .db plus transcript is an antigravity row with speech and unknown tokens", async () => {
  const home = await fixtureHome();
  const desktop = join(home, ".gemini/antigravity");
  await mkdir(join(desktop, "conversations"), { recursive: true });
  writeConversationDb(join(desktop, "conversations", `${ID}.db`));
  await writeTranscript(desktop, ID);

  const result = await collectAntigravitySessions([desktop], NOW_MS, WINDOW_MS);
  expect(result.errors).toEqual([]);
  expect(result.value).toHaveLength(1);
  expect(result.value[0]).toMatchObject({
    id: `antigravity:${ID}`,
    provider: "antigravity",
    instanceLabel: "Desktop",
    cwd: CWD,
    lastUserMessage: "Review the Antigravity collector.",
    lastAgentClosing: "1. Verdict: GO-WITH-FIXES. Should I apply the listed corrections?",
    tokens: { scope: "unknown", provenance: "unknown" },
  });
  expect(result.value[0]?.callSizes).toBeUndefined();
  expect(result.value[0]?.tokens).not.toHaveProperty("contextWindow");
});

test("a last_selected_agent_model that matches the catalog attaches that window and keeps tokens unknown", async () => {
  const home = await fixtureHome();
  const desktop = join(home, ".gemini/antigravity");
  await mkdir(join(desktop, "conversations"), { recursive: true });
  writeConversationDb(join(desktop, "conversations", `${ID}.db`), CWD, "gemini-3.7-flash");
  await writeTranscript(desktop, ID);

  const result = await collectAntigravitySessions([desktop], NOW_MS, WINDOW_MS);
  expect(result.value[0]).toMatchObject({
    model: "gemini-3.7-flash",
    tokens: {
      scope: "unknown",
      provenance: "unknown",
      contextWindow: 1_048_576,
    },
  });
  expect(result.value[0]?.callSizes).toBeUndefined();
});

test("an unknown Antigravity model leaves the window unset", async () => {
  const home = await fixtureHome();
  const desktop = join(home, ".gemini/antigravity");
  await mkdir(join(desktop, "conversations"), { recursive: true });
  writeConversationDb(join(desktop, "conversations", `${ID}.db`), CWD, "custom-agent-v1");
  const result = await collectAntigravitySessions([desktop], NOW_MS, WINDOW_MS);
  expect(result.value[0]?.model).toBe("custom-agent-v1");
  expect(result.value[0]?.tokens).toEqual({ scope: "unknown", provenance: "unknown" });
});

test("a .db without a transcript still publishes a row", async () => {
  const home = await fixtureHome();
  const desktop = join(home, ".gemini/antigravity");
  await mkdir(join(desktop, "conversations"), { recursive: true });
  writeConversationDb(join(desktop, "conversations", `${ID}.db`));
  const result = await collectAntigravitySessions([desktop], NOW_MS, WINDOW_MS);
  expect(result.value).toHaveLength(1);
  expect(result.value[0]).toMatchObject({
    id: `antigravity:${ID}`,
    cwd: CWD,
    tokens: { provenance: "unknown" },
  });
  expect(result.value[0]?.lastUserMessage ?? null).toBeNull();
});

test("IDE rows disable cwd fallback and WAL sidecars do not throw", async () => {
  const home = await fixtureHome();
  const ide = join(home, ".gemini/antigravity-ide");
  await mkdir(join(ide, "conversations"), { recursive: true });
  const dbPath = join(ide, "conversations", `${IDE_ID}.db`);
  writeConversationDb(dbPath);
  await writeFile(`${dbPath}-wal`, "");
  await writeFile(`${dbPath}-shm`, "");
  const result = await collectAntigravitySessions([ide], NOW_MS, WINDOW_MS);
  expect(result.errors).toEqual([]);
  expect(result.value).toHaveLength(1);
  expect(result.value[0]).toMatchObject({
    instanceLabel: "IDE",
    allowCwdFallback: false,
  });
});

test("an unreadable conversation is a collector error, not a crash", async () => {
  const home = await fixtureHome();
  const desktop = join(home, ".gemini/antigravity");
  await mkdir(join(desktop, "conversations"), { recursive: true });
  await writeFile(join(desktop, "conversations", `${ID}.db`), "this is not sqlite");
  const result = await collectAntigravitySessions([desktop], NOW_MS, WINDOW_MS);
  expect(result.value).toEqual([]);
  expect(result.errors.some((error) => error.includes(ID))).toBe(true);
});

test("missing all three trees is absent", async () => {
  const home = await fixtureHome();
  expect(await collectSessionProvider("antigravity", home)).toEqual({
    value: [],
    errors: [],
    absent: true,
  });
});

test("leftover Gemini settings produce zero rows", async () => {
  const home = await fixtureHome();
  await mkdir(join(home, ".gemini"), { recursive: true });
  await writeFile(join(home, ".gemini/settings.json"), JSON.stringify({ hooks: {} }));
  expect(await collectSessionProvider("antigravity", home)).toEqual({
    value: [],
    errors: [],
    absent: true,
  });
});

test("I-112 leaves legacy protobuf conversations unparsed", async () => {
  const home = await fixtureHome();
  const desktop = join(home, ".gemini/antigravity");
  await mkdir(join(desktop, "conversations"), { recursive: true });
  await writeFile(join(desktop, "conversations", `${ID}.pb`), "legacy protobuf bytes");

  const result = await collectAntigravitySessions([desktop], NOW_MS, WINDOW_MS);
  expect(result.errors).toEqual([]);
  expect(result.value).toEqual([]);
});

test("agy --conversation names the session", () => {
  expect(identitiesFromCommand(`agy --conversation ${ID}`)).toEqual([
    { provider: "antigravity", value: ID, full: true },
  ]);
  expect(identitiesFromCommand(`agy --conversation=${ID}`)).toEqual([
    { provider: "antigravity", value: ID, full: true },
  ]);
  expect(isRecognizedAgentProcess("agy --continue")).toBe(true);
  expect(identityFromSessionPath(
    `/Users/me/.gemini/antigravity/conversations/${ID}.db`,
  )).toEqual({ provider: "antigravity", value: ID, full: true });
});
