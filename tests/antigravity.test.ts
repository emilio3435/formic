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

/* Current Antigravity CLI schema: trajectory_meta lost its model column and the
   selected model now lives inside gen_metadata protobuf blobs — field 19 holds
   the base model id ("gemini-3.7-flash") and field 28 the model+effort variant
   ("gemini-3.7-flash-high"). These fixtures encode that wire format exactly. */
function protoField(field: number, value: string | Uint8Array): Uint8Array {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const head: number[] = [];
  let tag = (field << 3) | 2;
  while (tag > 0x7f) { head.push((tag & 0x7f) | 0x80); tag >>>= 7; }
  head.push(tag);
  let length = bytes.length;
  while (length > 0x7f) { head.push((length & 0x7f) | 0x80); length >>>= 7; }
  head.push(length);
  return Uint8Array.from([...head, ...bytes]);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

function writeCurrentSchemaDb(path: string, blobs: Uint8Array[], cwd = CWD): void {
  const db = new Database(path);
  db.run("create table trajectory_meta (trajectory_id text, cascade_id text, trajectory_type integer, source integer)");
  db.run("create table trajectory_metadata_blob (id text primary key default 'main', data blob)");
  db.run("create table gen_metadata (idx integer primary key, data blob, size integer not null default 0)");
  db.run("insert into trajectory_meta(trajectory_id, cascade_id, trajectory_type, source) values (?, ?, 4, 1)", [
    "208761a1-8733-4596-b6df-3dcba849df62",
    ID,
  ]);
  db.run("insert into trajectory_metadata_blob(id, data) values ('main', ?)", [`noise file://${cwd} more-noise`]);
  blobs.forEach((blob, index) => {
    db.run("insert into gen_metadata(idx, data, size) values (?, ?, ?)", [index, blob, blob.length]);
  });
  db.close();
}

test("current-schema store resolves the model from the latest gen_metadata blob", async () => {
  const home = await fixtureHome();
  const desktop = join(home, ".gemini/antigravity");
  await mkdir(join(desktop, "conversations"), { recursive: true });
  const noise = concatBytes(
    Uint8Array.from([0x08, 0x05]), // field 1 varint — must be skipped
    protoField(20, concatBytes(protoField(1, "used_non_gemini_model"), protoField(2, "false"))), // annotation map entry
  );
  writeCurrentSchemaDb(join(desktop, "conversations", `${ID}.db`), [
    concatBytes(noise, protoField(19, "gemini-3.6-flash")),
    // Live CLI stores wrap the generation message in top-level field 1;
    // the model id is field 19 one level down.
    protoField(1, concatBytes(protoField(19, "gemini-3.7-flash"), noise)),
  ]);
  await writeTranscript(desktop, ID);

  const result = await collectAntigravitySessions([desktop], NOW_MS, WINDOW_MS);
  expect(result.errors).toEqual([]);
  expect(result.value).toHaveLength(1);
  expect(result.value[0]?.model).toBe("gemini-3.7-flash");
  expect(result.value[0]?.tokens).toMatchObject({ scope: "unknown", provenance: "unknown", contextWindow: 1_048_576 });
});

test("the field-28 model+effort variant is used only when the base model field is absent", async () => {
  const home = await fixtureHome();
  const desktop = join(home, ".gemini/antigravity");
  await mkdir(join(desktop, "conversations"), { recursive: true });
  writeCurrentSchemaDb(join(desktop, "conversations", `${ID}.db`), [
    protoField(28, "gemini-3.7-flash-high"),
  ]);
  await writeTranscript(desktop, ID);

  const result = await collectAntigravitySessions([desktop], NOW_MS, WINDOW_MS);
  expect(result.errors).toEqual([]);
  expect(result.value[0]?.model).toBe("gemini-3.7-flash-high");
  expect(result.value[0]?.tokens).toMatchObject({ contextWindow: 1_048_576 });
});

test("the legacy trajectory_meta model column still wins over blob evidence", async () => {
  const home = await fixtureHome();
  const desktop = join(home, ".gemini/antigravity");
  await mkdir(join(desktop, "conversations"), { recursive: true });
  const path = join(desktop, "conversations", `${ID}.db`);
  writeConversationDb(path, CWD, "gemini-3.1-pro");
  const db = new Database(path);
  db.run("create table gen_metadata (idx integer primary key, data blob, size integer not null default 0)");
  db.run("insert into gen_metadata(idx, data, size) values (0, ?, 0)", [protoField(19, "gemini-3.7-flash")]);
  db.close();
  await writeTranscript(desktop, ID);

  const result = await collectAntigravitySessions([desktop], NOW_MS, WINDOW_MS);
  expect(result.errors).toEqual([]);
  expect(result.value[0]?.model).toBe("gemini-3.1-pro");
});

test("malformed, placeholder, or modelless blobs leave the model honestly unknown", async () => {
  const home = await fixtureHome();
  const desktop = join(home, ".gemini/antigravity");
  await mkdir(join(desktop, "conversations"), { recursive: true });
  writeCurrentSchemaDb(join(desktop, "conversations", `${ID}.db`), [
    Uint8Array.from([0x9a, 0x01, 0x50, 0x61]), // field 19 claims 80 bytes, blob truncates — must not crash
    Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), // unterminated varint junk
    protoField(19, "placeholder-model"), // filtered by the existing placeholder rule
    protoField(20, concatBytes(protoField(1, "last_step_index"), protoField(2, "3"))), // no model field at all
  ]);
  await writeTranscript(desktop, ID);

  const result = await collectAntigravitySessions([desktop], NOW_MS, WINDOW_MS);
  expect(result.errors).toEqual([]);
  expect(result.value).toHaveLength(1);
  expect(result.value[0]?.model).toBeUndefined();
  expect(result.value[0]?.tokens).toEqual({ scope: "unknown", provenance: "unknown" });
});
