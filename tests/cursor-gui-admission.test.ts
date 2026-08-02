import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { collectCursorSessions } from "../src/server/cursor";

/* Entry 4 of docs/UNTESTED-PATHS-MAP.md — the Cursor GUI admission path.

   Every branch here decides whether a session APPEARS ON THE BOARD, and all but
   one of them decides it by returning early and silently. That is the shape
   worth testing: a Cursor agent that is running and invisible looks exactly
   like a Cursor agent that is not running, and nothing on the board contradicts
   the absence. Two of the five reproduced defects presented that way.

   The branches, in order: a directory whose name is not a UUID, a missing
   meta.json, an unparseable one, hasConversation false, a stale or unparseable
   updatedAtMs, and a store.db whose agentId names a different session. Six ways
   to disappear, five of them quiet. */

const NOW = 1_784_692_000_000;
const WINDOW = 36 * 60 * 60 * 1_000;
const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/* A fresh session id per fixture. cursor.ts caches resolved transcript paths in
   a module-level map keyed ONLY by sessionId, so reusing one id across fixtures
   made a later test read an earlier test's transcript from a temp directory
   that still existed — and the subagents assertion then looked in the wrong
   tree and found nothing. The tests were independent; the cache was not. */
let sessionCounter = 0;
const nextSession = (): string =>
  `378abb0f-fefb-4ae9-bdf3-${String(++sessionCounter).padStart(12, "0")}`;

interface Options {
  sessionId?: string;
  meta?: Record<string, unknown> | string | null;
  storeAgentId?: string | null;
  withTranscript?: boolean;
}

/** A Cursor GUI home, described by what is wrong with it. */
async function cursorHome(options: Options = {}): Promise<{ home: string; sessionId: string }> {
  const root = await mkdtemp(join(tmpdir(), "anthill-cursor-gui-"));
  roots.push(root);
  const sessionId = options.sessionId ?? nextSession();
  const chats = join(root, ".cursor", "chats", "workspace-a", sessionId);
  await mkdir(chats, { recursive: true });

  if (options.meta !== null) {
    const meta = options.meta ?? { schemaVersion: 1, updatedAtMs: NOW - 60_000, cwd: "/Users/me/project", hasConversation: true };
    await writeFile(join(chats, "meta.json"), typeof meta === "string" ? meta : JSON.stringify(meta));
  }

  if (options.storeAgentId !== null) {
    const store = new Database(join(chats, "store.db"), { create: true });
    store.run("create table meta (key text primary key, value text)");
    // The reader falls back to the content-addressed blobs table; without it the
    // read throws before the agentId check it exists to reach.
    store.run("create table blobs (rowid integer primary key, data blob)");
    if (options.storeAgentId) {
      const payload = Buffer.from(JSON.stringify({ agentId: options.storeAgentId }), "utf8").toString("hex");
      store.run("insert into meta(key, value) values ('0', ?)", [payload]);
    }
    store.close();
  }

  if (options.withTranscript) {
    const projectId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const transcripts = join(root, ".cursor", "projects", "Users-me-project", "agent-transcripts", sessionId);
    await mkdir(transcripts, { recursive: true });
    const file = join(transcripts, `${sessionId}.jsonl`);
    await writeFile(file, [
      JSON.stringify({ role: "user", message: { content: [{ type: "text", text: "Ship the thing." }] } }),
      JSON.stringify({ type: "turn_ended", status: "success" }),
    ].join("\n"));
    await utimes(file, new Date(NOW - 60_000), new Date(NOW - 60_000));
    void projectId;
  }
  return { home: root, sessionId };
}

const collectFrom = async (fixture: { home: string; sessionId: string }) => ({
  ...(await collectCursorSessions(fixture.home, NOW, WINDOW)),
  sessionId: fixture.sessionId,
});
const ids = (agents: readonly { id: string }[]) => agents.map((agent) => agent.id);

describe("a Cursor session appears, or its absence is explained", () => {
  test("a healthy session is admitted", async () => {
    /* The control, and the one that matters most: every assertion below is
       about a session NOT appearing, and they would all pass on a collector
       that admitted nothing at all. */
    const result = await collectFrom(await cursorHome({ withTranscript: true }));

    expect(ids(result.value)).toContain(`cursor:${result.sessionId}`);
  });

  test("a directory whose name is not a session id is skipped without complaint", async () => {
    /* Cursor keeps content-addressed stores beside real sessions. They are not
       damaged sessions, so silence is right here — the only branch on this path
       where quiet is the correct answer. */
    const result = await collectFrom(await cursorHome({ sessionId: "not-a-uuid", withTranscript: true }));

    expect(result.value).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test("a session with no meta.json is skipped without complaint", async () => {
    // Same reason: an older store whose chat metadata is gone.
    const result = await collectFrom(await cursorHome({ meta: null }));

    expect(result.value).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test("an UNPARSEABLE meta.json is reported, not skipped quietly", async () => {
    /* The distinction the whole path turns on. A missing file is a session that
       ended; a corrupt file is a session we could not read, and those must not
       look alike. Without the error, a live Cursor agent vanishes and the board
       says nothing at all. */
    const result = await collectFrom(await cursorHome({ meta: "{ not json" }));

    expect(result.value).toEqual([]);
    expect(result.errors.join(" ")).toContain(result.sessionId);
    expect(result.errors.join(" ")).toMatch(/metadata/i);
  });

  test("a session Cursor marks as having no conversation is skipped", async () => {
    /* Admissible in EVERY other respect — fresh timestamp, real transcript — so
       the flag is the only thing keeping it off the board. An earlier version
       omitted the transcript, and the session was excluded for want of evidence
       instead; the mutation that ignores this flag survived it. */
    const skipped = await collectFrom(await cursorHome({
      meta: { updatedAtMs: NOW - 60_000, cwd: "/Users/me/project", hasConversation: false },
      withTranscript: true,
    }));
    const admitted = await collectFrom(await cursorHome({
      meta: { updatedAtMs: NOW - 60_000, cwd: "/Users/me/project", hasConversation: true },
      withTranscript: true,
    }));

    expect(skipped.value).toEqual([]);
    // The control: identical fixture, flag flipped.
    expect(ids(admitted.value)).toContain(`cursor:${admitted.sessionId}`);
    /* Note for whoever mutation-tests this next: the flag is checked TWICE —
       here in the collector and again in parseCursorSession — so removing
       either alone changes nothing and only removing both fails this. That is
       redundancy rather than a gap: the property holds, and neither line is
       individually load-bearing. */
  });

  test("a session older than the window is skipped, and one inside it is not", async () => {
    /* The window is the difference between "no Cursor sessions" and "no RECENT
       Cursor sessions", and the boundary is the only thing separating them. */
    const stale = await collectFrom(await cursorHome({
      meta: { updatedAtMs: NOW - WINDOW - 60_000, cwd: "/Users/me/project", hasConversation: true },
      withTranscript: true,
    }));
    const fresh = await collectFrom(await cursorHome({
      meta: { updatedAtMs: NOW - WINDOW + 60_000, cwd: "/Users/me/project", hasConversation: true },
      withTranscript: true,
    }));

    expect(stale.value).toEqual([]);
    expect(ids(fresh.value)).toContain(`cursor:${fresh.sessionId}`);
  });

  test("an unparseable updatedAtMs is treated as out of window, not as now", async () => {
    /* Number("banana") is NaN, and the guard is `!Number.isFinite`. Dropping it
       would make NaN comparisons false and admit every stale session ever
       written — the board filling with sessions that ended months ago. */
    const result = await collectFrom(await cursorHome({
      meta: { updatedAtMs: "banana", cwd: "/Users/me/project", hasConversation: true },
      withTranscript: true,
    }));

    expect(result.value).toEqual([]);
  });

  test("a store naming a DIFFERENT session is refused and reported", async () => {
    /* Identity, at the collector rather than the write gate. A store.db whose
       agentId disagrees with its directory means the two disagree about who
       this is, and admitting it would put a row on the board under a name the
       evidence does not support. */
    const result = await collectFrom(await cursorHome({
      storeAgentId: "99999999-9999-9999-9999-999999999999",
      withTranscript: true,
    }));

    expect(result.value).toEqual([]);
    expect(result.errors.join(" ")).toMatch(/agentId mismatch/i);
  });

  test("a store naming its OWN session is admitted", async () => {
    // The control for the check above: matching identity must not be refused.
    const own = nextSession();
    const result = await collectFrom(await cursorHome({
      sessionId: own, storeAgentId: own, withTranscript: true,
    }));

    expect(ids(result.value)).toContain(`cursor:${own}`);
  });
});

describe("one fault is reported once", () => {
  test("an unreadable subagents directory produces a single error per session", async () => {
    /* `errors.push(evidence.subagentsError)` appeared TWICE in this block, so
       one unreadable directory reported two faults. Harmless while the health
       card merely counted errors; fd20ea3 now prints the first and appends
       "(+N more)", which turns a duplicate into a second problem an operator
       goes looking for and cannot find. */
    const fixture = await cursorHome({ withTranscript: true });
    const subagents = join(
      fixture.home, ".cursor", "projects", "Users-me-project",
      "agent-transcripts", fixture.sessionId, "subagents",
    );
    // A plain file yields ENOTDIR from readdir on every platform.
    await writeFile(subagents, "not a directory");

    const result = await collectFrom(fixture);
    const subagentErrors = result.errors.filter((error) => error.includes("subagents"));

    expect(subagentErrors.length, `duplicated: ${JSON.stringify(subagentErrors)}`).toBe(1);
  });
});
