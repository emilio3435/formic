import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectCursorSessions } from "../src/server/cursor";

const NOW_MS = 1_784_692_000_000;
const WINDOW_MS = 36 * 3600_000;
const PROJECT_CWD = "/Users/me/elio-intelligence-suite";
const PROJECT_ID = "378abb0f-fefb-4ae9-bdf3-754920b7b4fe";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/* Same state.vscdb + conversation-search.db layout as setupGuiComposerHome in
   tests/cursor.test.ts. Parameterized so the same composer can land in Cursor
   and Cursor-2. */
async function writeGuiRoot(home: string, supportName: string, sessionId: string): Promise<void> {
  const globalStorage = join(home, "Library", "Application Support", supportName, "User", "globalStorage");
  const projectDirectory = join(home, ".cursor", "projects", "Users-me-elio-intelligence-suite");
  const transcriptDirectory = join(projectDirectory, "agent-transcripts", sessionId);
  await mkdir(transcriptDirectory, { recursive: true });
  await mkdir(globalStorage, { recursive: true });
  const transcriptPath = join(transcriptDirectory, `${sessionId}.jsonl`);
  await writeFile(transcriptPath, [
    JSON.stringify({ role: "user", message: { content: [{ type: "text", text: "Repair the SEM demo path." }] } }),
    JSON.stringify({ role: "assistant", message: { content: [{ type: "text", text: "Waiting for review." }] } }),
    JSON.stringify({ type: "turn_ended", status: "success" }),
  ].join("\n"));
  await utimes(transcriptPath, new Date(1784691238958), new Date(1784691238958));

  const state = new Database(join(globalStorage, "state.vscdb"));
  state.run("create table ItemTable (key text primary key, value blob)");
  state.run("insert into ItemTable(key, value) values (?, ?)", [
    "glass.localAgentProjectMembership.v1",
    JSON.stringify({ [sessionId]: PROJECT_ID }),
  ]);
  state.run("insert into ItemTable(key, value) values (?, ?)", [
    "glass.localAgentProjects.v1",
    JSON.stringify([{ id: PROJECT_ID, workspace: { id: "workspace-hash", uri: { fsPath: PROJECT_CWD } } }]),
  ]);
  state.close();

  const conversations = new Database(join(globalStorage, "conversation-search.db"));
  conversations.run(`create table conversations (
    fts_rowid integer primary key,
    source text not null,
    scope text not null,
    id text not null,
    title text not null,
    updated_at integer not null,
    is_archived integer not null,
    root_fingerprint text,
    cache_fingerprint text
  )`);
  conversations.run(
    "insert into conversations(source, scope, id, title, updated_at, is_archived, root_fingerprint) values ('local', '', ?, ?, ?, 0, 'fingerprint')",
    [sessionId, "Elio: SEM Night", 1784691238958],
  );
  conversations.close();
}

async function fixtureHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "mountain-cursor-extra-root-"));
  temporaryDirectories.push(home);
  return home;
}

test("an onboarded Cursor-2 vscdb becomes cursor rows with an instance label", async () => {
  const home = await fixtureHome();
  await writeGuiRoot(home, "Cursor-2", "a5336a9a-f434-4e7b-b8f0-a3c8509502c1");
  const result = await collectCursorSessions(home, NOW_MS, WINDOW_MS, undefined, [
    join(home, "Library/Application Support/Cursor-2"),
  ]);
  expect(result.errors).toEqual([]);
  expect(result.value.some((a) => a.provider === "cursor" && a.instanceLabel === "Cursor-2")).toBe(true);
  expect(result.value.every((a) => a.provider === "cursor")).toBe(true);
});

test("the same composer id in two DBs is one row", async () => {
  const home = await fixtureHome();
  const sessionId = "a5336a9a-f434-4e7b-b8f0-a3c8509502c2";
  await writeGuiRoot(home, "Cursor", sessionId);
  await writeGuiRoot(home, "Cursor-2", sessionId);
  const result = await collectCursorSessions(home, NOW_MS, WINDOW_MS, undefined, [
    join(home, "Library/Application Support/Cursor-2"),
  ]);
  const ids = result.value.map((a) => a.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toEqual([`cursor:${sessionId}`]);
});

test("a missing extra root is a named error, default Cursor still collects", async () => {
  const home = await fixtureHome();
  await writeGuiRoot(home, "Cursor", "a5336a9a-f434-4e7b-b8f0-a3c8509502c3");
  const result = await collectCursorSessions(home, NOW_MS, WINDOW_MS, undefined, [
    join(home, "Library/Application Support/Does-Not-Exist"),
  ]);
  expect(result.errors.some((e) => e.includes("Does-Not-Exist"))).toBe(true);
  expect(result.value.some((a) => a.provider === "cursor" && a.id === "cursor:a5336a9a-f434-4e7b-b8f0-a3c8509502c3")).toBe(true);
});
