import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmod, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectCursorSessions,
  parseComposerHeaders,
  parseCursorChildSession,
  parseCursorSession,
  readCursorStoreEvidence,
} from "../src/server/cursor";
import {
  enrichCmuxIdentity,
  identitiesFromCommand,
  identityFromSessionPath,
  isRecognizedAgentProcess,
} from "../src/server/identity";
import { buildSnapshot } from "../src/server/snapshot";
import { PulseTracker } from "../src/server/pulse";
import { resolveAgentTarget } from "../src/server/targets";
import { readForeignSqlite } from "../src/server/foreign-sqlite";
import type { ArchiveStore, CmuxSurface, CollectedAgent, CommandResult, CommandRunner } from "../src/server/types";

const SESSION_ID = "286ab053-e84f-4538-9292-4aa3fae6fe9b";
const GUI_SESSION_ID = "a5336a9a-f434-4e7b-b8f0-a3c8509502cb";
const CHILD_SESSION_ID = "6514e366-df29-434b-979d-52a26168e188";
const fixture = (name: string): Promise<string> =>
  readFile(join(import.meta.dir, "fixtures", name), "utf8");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

class SequenceRunner implements CommandRunner {
  constructor(private readonly results: CommandResult[]) {}
  async run(): Promise<CommandResult> {
    return this.results.shift() ?? { exitCode: 0, stdout: "", stderr: "", timedOut: false };
  }
}

describe("Cursor human-facing recency", () => {
  test("accepts only timestamps directly attached to readable prose", async () => {
    const agent = parseCursorSession({
      sessionId: SESSION_ID,
      metaJson: await fixture("cursor-meta.json"),
      transcriptJsonl: [
        JSON.stringify({ role: "user", timestamp: "2026-08-11T10:00:01.000Z", message: { content: "Please inspect Cursor." } }),
        JSON.stringify({ role: "assistant", timestamp: "2026-08-11T10:00:02.000Z", message: { content: [{ type: "text", text: "Cursor is ready." }] } }),
        JSON.stringify({ role: "assistant", timestamp: "2026-08-11T10:00:03.000Z", message: { content: [{ type: "tool_result", text: "ok" }] } }),
        JSON.stringify({ role: "assistant", message: { content: "Readable, but without source time." } }),
      ].join("\n"),
      transcriptMtimeMs: Date.parse("2026-08-11T10:00:04.000Z"),
      storeDbMtimeMs: Date.parse("2026-08-11T10:00:05.000Z"),
      nowMs: Date.parse("2026-08-11T10:00:06.000Z"),
    });

    expect(agent?.lastHumanFacingAt).toBe("2026-08-11T10:00:02.000Z");
    expect(agent?.updatedAt).toBe("2026-08-11T10:00:05.000Z");
  });

  test("does not infer message time from metadata, mtimes, or a parent clock", async () => {
    const parent = parseCursorSession({
      sessionId: SESSION_ID,
      metaJson: await fixture("cursor-meta.json"),
      transcriptJsonl: [
        JSON.stringify({ role: "user", message: { content: "Readable but untimestamped." } }),
        JSON.stringify({ role: "assistant", timestamp: "not-a-time", message: { content: "Readable with malformed time." } }),
      ].join("\n"),
      transcriptMtimeMs: Date.parse("2026-08-11T10:00:04.000Z"),
      storeDbMtimeMs: Date.parse("2026-08-11T10:00:05.000Z"),
      nowMs: Date.parse("2026-08-11T10:00:06.000Z"),
    });
    const child = parseCursorChildSession({
      sessionId: CHILD_SESSION_ID,
      parentSessionId: SESSION_ID,
      cwd: "/tmp/formic",
      transcriptJsonl: JSON.stringify({ role: "assistant", message: { content: "Child prose without time." } }),
      transcriptPath: "/tmp/child.jsonl",
      updatedAtMs: Date.parse("2026-08-11T10:00:05.000Z"),
      nowMs: Date.parse("2026-08-11T10:00:06.000Z"),
    });

    expect(parent?.lastHumanFacingAt).toBeUndefined();
    expect(child?.lastHumanFacingAt).toBeUndefined();
  });
});

// A CLI assistant message blob: the resolved modelName lives on content PARTS,
// while the message-level providerOptions.cursor carries only routing ids.
function assistantBlob(modelName: string): string {
  return JSON.stringify({
    role: "assistant",
    id: `blob-${modelName}`,
    content: [
      { type: "reasoning", providerOptions: { cursor: { modelName } } },
      { type: "text", text: "ok" },
    ],
    providerOptions: { cursor: { modelProviderMessageId: "msg-1", requestId: "req-1" } },
  });
}

// Builds a Cursor GUI home fixture with the real store layout so the collector can
// resolve one local conversation. composerData (when provided) is written to
// state.vscdb's cursorDiskKV; ai-tracking (when provided) supplies the fallback.
async function setupGuiComposerHome(options: {
  composerData?: { modelName: string; parameters?: { id: string; value: string }[] };
  /** Writes a composerData row whose value is not JSON, to model a damaged store. */
  corruptComposerData?: boolean;
  /** Writes Cursor's own context meter for GUI_SESSION_ID into composer.composerHeaders. */
  contextUsagePercent?: number;
  /** Writes a composerHeaders row whose value is not JSON, to model a damaged meter. */
  corruptComposerHeaders?: boolean;
  trackingModel?: string;
}): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "mountain-cursor-composer-"));
  temporaryDirectories.push(home);
  const globalStorage = join(home, "Library", "Application Support", "Cursor", "User", "globalStorage");
  const projectCwd = "/Users/me/elio-intelligence-suite";
  const projectId = "378abb0f-fefb-4ae9-bdf3-754920b7b4fe";
  const projectDirectory = join(home, ".cursor", "projects", "Users-me-elio-intelligence-suite");
  const transcriptDirectory = join(projectDirectory, "agent-transcripts", GUI_SESSION_ID);
  await mkdir(transcriptDirectory, { recursive: true });
  await mkdir(globalStorage, { recursive: true });
  const transcriptPath = join(transcriptDirectory, `${GUI_SESSION_ID}.jsonl`);
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
    JSON.stringify({ [GUI_SESSION_ID]: projectId }),
  ]);
  state.run("insert into ItemTable(key, value) values (?, ?)", [
    "glass.localAgentProjects.v1",
    JSON.stringify([{ id: projectId, workspace: { id: "workspace-hash", uri: { fsPath: projectCwd } } }]),
  ]);
  if (options.contextUsagePercent !== undefined) {
    state.run("insert into ItemTable(key, value) values (?, ?)", [
      "composer.composerHeaders",
      JSON.stringify({
        allComposers: [
          { composerId: GUI_SESSION_ID, contextUsagePercent: options.contextUsagePercent },
        ],
      }),
    ]);
  }
  if (options.corruptComposerHeaders) {
    state.run("insert into ItemTable(key, value) values (?, ?)", [
      "composer.composerHeaders",
      "{ this is not json",
    ]);
  }
  if (options.composerData) {
    state.run("create table cursorDiskKV (key text primary key, value blob)");
    state.run("insert into cursorDiskKV(key, value) values (?, ?)", [
      `composerData:${GUI_SESSION_ID}`,
      JSON.stringify({
        modelConfig: {
          modelName: options.composerData.modelName,
          selectedModels: [{ parameters: options.composerData.parameters ?? [] }],
        },
        usageData: {},
      }),
    ]);
  }
  if (options.corruptComposerData) {
    state.run("create table cursorDiskKV (key text primary key, value blob)");
    state.run("insert into cursorDiskKV(key, value) values (?, ?)", [
      `composerData:${GUI_SESSION_ID}`,
      "{ this is not json",
    ]);
  }
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
    [GUI_SESSION_ID, "Elio: SEM Night", 1784691238958],
  );
  conversations.close();

  if (options.trackingModel) {
    await mkdir(join(home, ".cursor", "ai-tracking"), { recursive: true });
    const tracking = new Database(join(home, ".cursor", "ai-tracking", "ai-code-tracking.db"));
    tracking.run(`create table ai_code_hashes (
      hash text primary key,
      source text not null,
      conversationId text,
      timestamp integer,
      model text,
      createdAt integer not null
    )`);
    tracking.run(
      "insert into ai_code_hashes(hash, source, conversationId, timestamp, model, createdAt) values ('hash', 'composer', ?, ?, ?, ?)",
      [GUI_SESSION_ID, 1784691434327, options.trackingModel, 1784691434327],
    );
    tracking.close();
  }
  return home;
}

function guiConversationPath(home: string): string {
  return join(
    home,
    "Library",
    "Application Support",
    "Cursor",
    "User",
    "globalStorage",
    "conversation-search.db",
  );
}

describe("Cursor Agent persisted session truth", () => {
  test("parses exact session, cwd, model, task, tail, status, and unknown billing honestly", async () => {
    const agent = parseCursorSession({
      sessionId: SESSION_ID,
      metaJson: await fixture("cursor-meta.json"),
      transcriptJsonl: await fixture("cursor-session.jsonl"),
      transcriptPath: `/Users/me/.cursor/projects/project/agent-transcripts/${SESSION_ID}/${SESSION_ID}.jsonl`,
      subagentCount: 2,
      store: JSON.parse(await fixture("cursor-store-evidence.json")),
      nowMs: 1784689180000,
    });

    expect(agent).toMatchObject({
      id: `cursor:${SESSION_ID}`,
      provider: "cursor",
      sourceSessionId: SESSION_ID,
      displayName: "Cursor · the-mountain",
      cwd: "/Users/emilionunezgarcia/Developer/the-mountain",
      model: "Cursor Grok 4.5",
      task: "Verify The Mountain routing without changing live state.",
      // The fixture session was updated 55s ago: freshness wins over the last
      // turn_ended:"success" record, so it reads as working rather than idle.
      status: "running",
      statusReason: "Cursor session activity is fresh within the last 3 minutes.",
      subagentCount: 2,
      transcriptTail: "Cursor identity is exact when the live process opens its session store.",
      lastHumanMessage: "Cursor identity is exact when the live process opens its session store.",
      tokens: { scope: "unknown", provenance: "unknown" },
      cost: null,
    });
    expect(agent?.tokens.total).toBeUndefined();
    expect(agent?.artifacts[0]?.kind).toBe("transcript");
  });

  test("keeps a fresh Cursor session working despite a stale turn_ended:success record", () => {
    const nowMs = 1784689180000;
    const agent = parseCursorSession({
      sessionId: SESSION_ID,
      metaJson: JSON.stringify({
        createdAtMs: nowMs - 10 * 60_000,
        updatedAtMs: nowMs - 30_000, // a new turn is actively streaming (30s ago)
        cwd: "/Users/me/project",
        hasConversation: true,
      }),
      transcriptJsonl: [
        JSON.stringify({ role: "user", message: { content: "Ship the fix." } }),
        JSON.stringify({ role: "assistant", message: { content: [{ type: "text", text: "On it." }] } }),
        JSON.stringify({ type: "turn_ended", status: "success" }), // last completed turn
      ].join("\n"),
      nowMs,
    });

    expect(agent).toMatchObject({
      status: "running",
      statusReason: "Cursor session activity is fresh within the last 3 minutes.",
    });
  });

  test("a streaming transcript mtime keeps a session working when turn-boundary metadata is stale", () => {
    const nowMs = 1784689180000;
    const agent = parseCursorSession({
      sessionId: SESSION_ID,
      metaJson: JSON.stringify({
        createdAtMs: nowMs - 60 * 60_000,
        updatedAtMs: nowMs - 20 * 60_000, // turn-boundary write is 20 minutes stale
        cwd: "/Users/me/project",
        hasConversation: true,
      }),
      transcriptJsonl: JSON.stringify({ type: "turn_ended", status: "success" }),
      transcriptMtimeMs: nowMs - 30_000, // but the JSONL is still being appended
      nowMs,
    });

    expect(agent?.status).toBe("running");
  });

  test("Cursor ignores tool output and diff text while retaining readable assistant prose", async () => {
    const agent = parseCursorSession({
      sessionId: SESSION_ID,
      metaJson: await fixture("cursor-meta.json"),
      transcriptJsonl: await fixture("cursor-human-message-session.jsonl"),
      nowMs: 1784689180000,
    });

    expect(agent?.lastHumanMessage).toBe("The Cursor route is ready for review.");
    expect(agent?.lastHumanMessage).not.toContain("diff --git");
    expect(agent?.lastHumanMessage).not.toContain("identity.ts");
  });

  test("publishes Cursor's role-attributed closing so a final approval fork remains readable", async () => {
    const explanation = "I verified the cleanup plan and every rollback SHA before asking for a decision. ".repeat(8);
    const approvalFork = "Reply with one of: 1. Approve 2. Decline";
    const agent = parseCursorSession({
      sessionId: SESSION_ID,
      metaJson: await fixture("cursor-meta.json"),
      transcriptJsonl: [
        JSON.stringify({ role: "user", message: { content: "Propose cleanup and wait for approval." } }),
        JSON.stringify({
          role: "assistant",
          message: { content: [{ type: "text", text: `${explanation}${approvalFork}` }] },
        }),
        // A later assistant record is tool machinery, not words authored by the agent.
        JSON.stringify({ role: "assistant", message: { content: [{ type: "tool_result", text: "diff --git a/x b/x" }] } }),
        JSON.stringify({ type: "turn_ended", status: "success" }),
      ].join("\n"),
      nowMs: 1784689180000,
    });

    expect(agent?.lastAgentMessage).not.toContain(approvalFork);
    expect(agent?.lastAgentClosing).toContain(approvalFork);
    expect(agent?.lastAgentClosing).not.toContain("diff --git");
  });

  test("parses a Cursor child as a real parent-linked session with its own model", () => {
    const child = parseCursorChildSession({
      sessionId: "6514e366-df29-434b-979d-52a26168e188",
      parentSessionId: SESSION_ID,
      cwd: "/Users/emilionunezgarcia/elio-intelligence-suite",
      transcriptJsonl: [
        JSON.stringify({ role: "user", message: { content: "<user_query>Goal: Verify the email build.</user_query>" } }),
        JSON.stringify({ role: "assistant", message: { content: [{ type: "text", text: "Build verified." }] } }),
        JSON.stringify({ type: "turn_ended", status: "success" }),
      ].join("\n"),
      transcriptPath: "/tmp/6514e366.jsonl",
      model: "gpt-5.6-sol-xhigh",
      updatedAtMs: 1784689180000,
      nowMs: 1784689180000,
    });

    expect(child).toMatchObject({
      id: "cursor:6514e366-df29-434b-979d-52a26168e188",
      displayName: "Cursor · elio-intelligence-suite",
      model: "gpt-5.6-sol-xhigh",
      parentSourceSessionId: SESSION_ID,
      threadDepth: 1,
      // Transcript mtime equals now: a fresh child stays working despite the
      // last turn_ended:"success" already recorded in the cumulative transcript.
      status: "running",
      lastAgentClosing: "Build verified.",
      tokens: { scope: "unknown", provenance: "unknown" },
      cost: null,
    });
  });

  test("an aborted Cursor child reports the failure without being declared over", () => {
    const child = parseCursorChildSession({
      sessionId: "ad80121f-6444-41e4-8a37-0ce548223649",
      parentSessionId: SESSION_ID,
      cwd: "/Users/emilionunezgarcia/Developer/the-mountain",
      transcriptJsonl: [
        JSON.stringify({ role: "user", message: { content: "Goal: Check the renderer." } }),
        JSON.stringify({ type: "turn_ended", status: "aborted" }),
      ].join("\n"),
      transcriptPath: "/tmp/ad80121f.jsonl",
      model: "claude-fable-5-thinking-high",
      updatedAtMs: 1784689180000,
      nowMs: 1784689180000,
    });

    /* The failure is an OUTCOME, and it travels as one. It used to also decide
       the lifecycle: an aborted turn sent a child straight to the terminal band,
       and so did a SUCCESSFUL turn — two opposite results, one verdict, and the
       verdict was "over". A child that failed a turn one second ago read as
       forty-five minutes silent, and nearly every Cursor child on this board was
       filed as ended within moments of starting work.

       `gates` is what reaches the operator, through outcome and the attention
       overlay. The clock decides whether the session is still going. */
    expect(child).toMatchObject({
      status: "running",
      statusReason: "Cursor child recorded the last turn as aborted.",
      gates: ["Cursor child turn: aborted"],
    });
    // And an aborted turn is not an ending, so it mints no end evidence at all.
    expect(child?.endEvidence).toBeUndefined();
  });

  test("a Cursor child that just finished a turn is waiting, not ended", () => {
    /* The other half of the same bug, and the larger population: SUCCESS also
       sent a child to the terminal band. A completed turn is the child yielding
       to its operator, and it is carried as turn evidence for the classifier to
       weigh against the clock — exactly as Claude and Codex are. */
    const child = parseCursorChildSession({
      sessionId: "ad80121f-6444-41e4-8a37-0ce548223649",
      parentSessionId: SESSION_ID,
      cwd: "/Users/emilionunezgarcia/Developer/the-mountain",
      transcriptJsonl: [
        JSON.stringify({ role: "user", message: { content: "Goal: Check the renderer." } }),
        JSON.stringify({ type: "turn_ended", status: "success" }),
      ].join("\n"),
      transcriptPath: "/tmp/ad80121f.jsonl",
      updatedAtMs: 1784689180000 - 10 * 60_000,
      nowMs: 1784689180000,
    });

    expect(child?.status).toBe("waiting");
    expect(child?.endEvidence).toBe("turn-complete");
    expect(child?.gates).toEqual([]);
  });

  test("marks an old unended Cursor child stale instead of keeping it live for 36 hours", () => {
    const child = parseCursorChildSession({
      sessionId: CHILD_SESSION_ID,
      parentSessionId: SESSION_ID,
      cwd: "/Users/emilionunezgarcia/Developer/the-mountain",
      transcriptJsonl: JSON.stringify({ role: "user", message: { content: "Check the renderer." } }),
      transcriptPath: `/tmp/${CHILD_SESSION_ID}.jsonl`,
      updatedAtMs: 1784689180000 - 46 * 60_000,
      nowMs: 1784689180000,
    });

    expect(child).toMatchObject({
      status: "stale",
      statusReason: "Cursor child transcript has not changed in 45 minutes.",
    });
  });

  test("does not invent a model id from English prose in a system prompt", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mountain-cursor-store-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "store.db");
    const database = new Database(path);
    database.run("create table meta (key text primary key, value text)");
    database.run("create table blobs (id text primary key, data blob)");
    const metadata = Buffer.from(JSON.stringify({
      agentId: SESSION_ID,
      name: "Grok verifier",
      mode: "search",
    })).toString("hex");
    database.run("insert into meta(key, value) values ('0', ?)", [metadata]);
    database.run("insert into blobs(id, data) values ('system', ?)", [
      Buffer.from(JSON.stringify({
        role: "system",
        content: "You are an AI coding assistant, powered by Cursor Grok 4.5. Work carefully.",
      })),
    ]);
    database.close();

    expect(readCursorStoreEvidence(path)).toEqual({
      agentId: SESSION_ID,
      name: "Grok verifier",
      mode: "search",
      model: undefined,
    });
  });

  test("prefers meta lastUsedModel over the newest assistant blob modelName", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mountain-cursor-lastused-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "store.db");
    const database = new Database(path);
    database.run("create table meta (key text primary key, value text)");
    database.run("create table blobs (id text primary key, data blob)");
    database.run("insert into meta(key, value) values ('0', ?)", [
      Buffer.from(JSON.stringify({
        agentId: SESSION_ID,
        name: "New Agent",
        mode: "default",
        lastUsedModel: "grok-4.5",
      })).toString("hex"),
    ]);
    // A conflicting per-turn modelName in the blobs must lose to the authoritative
    // meta lastUsedModel when the latter is present.
    database.run("insert into blobs(id, data) values ('a', ?)", [Buffer.from(assistantBlob("cursor-grok-4.5-high-fast"))]);
    database.close();

    expect(readCursorStoreEvidence(path)).toMatchObject({ agentId: SESSION_ID, model: "grok-4.5" });
  });

  test("falls back to the newest assistant blob modelName, detecting Composer models", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mountain-cursor-blobmodel-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "store.db");
    const database = new Database(path);
    database.run("create table meta (key text primary key, value text)");
    database.run("create table blobs (id text primary key, data blob)");
    // No lastUsedModel: the model must come from the blobs.
    database.run("insert into meta(key, value) values ('0', ?)", [
      Buffer.from(JSON.stringify({ agentId: SESSION_ID, name: "New Agent", mode: "plan" })).toString("hex"),
    ]);
    // The message-level providerOptions.cursor carries no modelName (only routing
    // ids), so extraction must read the content PARTS. The newest turn (highest
    // rowid) switched to Composer and must win over the earlier Grok turn.
    database.run("insert into blobs(id, data) values ('older', ?)", [Buffer.from(assistantBlob("cursor-grok-4.5-high-fast"))]);
    database.run("insert into blobs(id, data) values ('user', ?)", [
      Buffer.from(JSON.stringify({ role: "user", content: [{ type: "text", text: "switch model" }] })),
    ]);
    database.run("insert into blobs(id, data) values ('newer', ?)", [Buffer.from(assistantBlob("composer-2.5-fast"))]);
    database.close();

    expect(readCursorStoreEvidence(path).model).toBe("composer-2.5-fast");
  });

  test("caches unchanged stores and invalidates when their fingerprint changes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mountain-cursor-store-cache-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "store.db");
    const database = new Database(path);
    database.run("create table meta (key text primary key, value text)");
    database.run("create table blobs (id text primary key, data blob)");
    const metadata = (model: string) => Buffer.from(JSON.stringify({
      agentId: SESSION_ID,
      lastUsedModel: model,
    })).toString("hex");
    database.run("insert into meta(key, value) values ('0', ?)", [metadata("model-a")]);
    database.close();

    const fixedTime = new Date(1784690000000);
    await utimes(path, fixedTime, fixedTime);
    expect(readCursorStoreEvidence(path).model).toBe("model-a");
    const changed = new Database(path);
    changed.run("update meta set value = ? where key = '0'", [metadata("model-b")]);
    changed.close();
    await utimes(path, fixedTime, fixedTime);

    expect(readCursorStoreEvidence(path).model).toBe("model-a");
    await utimes(path, new Date(), new Date(fixedTime.getTime() + 1_000));
    expect(readCursorStoreEvidence(path).model).toBe("model-b");
  });

  test("bounds fallback blob inspection to the newest 200 records", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mountain-cursor-blob-bound-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "store.db");
    const database = new Database(path);
    database.run("create table meta (key text primary key, value text)");
    database.run("create table blobs (id text primary key, data blob)");
    database.run("insert into meta(key, value) values ('0', ?)", [
      Buffer.from(JSON.stringify({ agentId: SESSION_ID })).toString("hex"),
    ]);
    database.run("insert into blobs(id, data) values ('old-model', ?)", [
      Buffer.from(assistantBlob("old-model")),
    ]);
    for (let index = 0; index < 200; index += 1) {
      database.run("insert into blobs(id, data) values (?, ?)", [
        `newer-${index}`,
        Buffer.from(JSON.stringify({ role: "system", content: `instruction ${index}` })),
      ]);
    }
    database.close();

    expect(readCursorStoreEvidence(path).model).toBeUndefined();
  });

  test("reads a WAL-mode store immutably when the read-only handle cannot create SQLite sidecars", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mountain-cursor-wal-store-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "store.db");
    const database = new Database(path);
    database.run("create table meta (key text primary key, value text)");
    database.run("create table blobs (id text primary key, data blob)");
    database.query("pragma journal_mode = wal").get();
    database.run("insert into meta(key, value) values ('0', ?)", [
      Buffer.from(JSON.stringify({ agentId: SESSION_ID, name: "WAL verifier" })).toString("hex"),
    ]);
    database.close();

    await chmod(directory, 0o555);
    try {
      expect(readCursorStoreEvidence(path)).toEqual({
        agentId: SESSION_ID,
        name: "WAL verifier",
        mode: undefined,
        model: undefined,
      });
    } finally {
      await chmod(directory, 0o755);
    }
  });

  test("the shared foreign-store reader cannot mutate its source database", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mountain-cursor-readonly-store-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "store.db");
    const database = new Database(path);
    database.exec("create table evidence (value text); insert into evidence values ('kept')");
    database.close();

    expect(() => readForeignSqlite(path, (foreign) => foreign.exec("delete from evidence"))).toThrow();

    const check = new Database(path, { readonly: true });
    try {
      expect(check.query("select value from evidence").get()).toEqual({ value: "kept" });
    } finally {
      check.close();
    }
  });

  test("rejects a store whose authoritative agentId conflicts with its session directory", async () => {
    const agent = parseCursorSession({
      sessionId: SESSION_ID,
      metaJson: await fixture("cursor-meta.json"),
      store: { agentId: "11111111-2222-4333-8444-555555555555" },
    });

    expect(agent).toBeNull();
  });

  test("removes Cursor's transport envelope from the visible task and display name", () => {
    const agent = parseCursorSession({
      sessionId: SESSION_ID,
      metaJson: JSON.stringify({
        createdAtMs: 1784689000000,
        updatedAtMs: 1784689180000,
        cwd: "/Users/me/project",
        hasConversation: true,
      }),
      transcriptJsonl: JSON.stringify({
        role: "user",
        message: {
          content: "<timestamp>Tuesday, Jul 21, 2026</timestamp>\n<user_query>\nGoal: Review safe routing.\n\nReturn evidence.\n</user_query>",
        },
      }),
      nowMs: 1784689180000,
    });

    expect(agent?.task).toBe("Goal: Review safe routing.\n\nReturn evidence.");
    expect(agent?.displayName).toBe("Cursor · project");
  });

  test("uses a readable project fallback when a generic Cursor session has no task", () => {
    const agent = parseCursorSession({
      sessionId: SESSION_ID,
      metaJson: JSON.stringify({
        createdAtMs: 1784689000000,
        updatedAtMs: 1784689180000,
        cwd: "/Users/me/sem-hormiga-demo-night",
        hasConversation: true,
      }),
      store: { name: "New Agent" },
      nowMs: 1784689180000,
    });

    expect(agent?.displayName).toBe("Cursor · sem-hormiga-demo-night");
    expect(agent?.displayName).not.toContain(SESSION_ID.slice(0, 8));
  });

  test("silently skips retained stores whose chat metadata is gone", async () => {
    const home = await mkdtemp(join(tmpdir(), "mountain-cursor-home-"));
    temporaryDirectories.push(home);
    await mkdir(join(home, ".cursor", "chats", "workspace-hash", SESSION_ID), { recursive: true });

    expect(await collectCursorSessions(home)).toEqual({ value: [], errors: [] });
  });

  test("silently skips Cursor metadata that marks a retained directory as non-conversation", async () => {
    const home = await mkdtemp(join(tmpdir(), "mountain-cursor-non-conversation-home-"));
    temporaryDirectories.push(home);
    const sessionDirectory = join(home, ".cursor", "chats", "workspace-hash", SESSION_ID);
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(join(sessionDirectory, "meta.json"), JSON.stringify({
      schemaVersion: 1,
      createdAtMs: 1784689000000,
      updatedAtMs: 1784689180000,
      cwd: "/Users/me/project",
      hasConversation: false,
    }));

    expect(await collectCursorSessions(home, 1784689180000)).toEqual({ value: [], errors: [] });
  });

  test("collects Cursor GUI agents from the live conversation index without CLI chat metadata", async () => {
    const home = await mkdtemp(join(tmpdir(), "mountain-cursor-gui-home-"));
    temporaryDirectories.push(home);
    const globalStorage = join(home, "Library", "Application Support", "Cursor", "User", "globalStorage");
    const projectCwd = "/Users/me/elio-intelligence-suite";
    const projectId = "378abb0f-fefb-4ae9-bdf3-754920b7b4fe";
    const projectDirectory = join(home, ".cursor", "projects", "Users-me-elio-intelligence-suite");
    const transcriptDirectory = join(projectDirectory, "agent-transcripts", GUI_SESSION_ID);
    await mkdir(join(transcriptDirectory, "subagents"), { recursive: true });
    await mkdir(globalStorage, { recursive: true });
    await mkdir(join(home, ".cursor", "ai-tracking"), { recursive: true });
    await writeFile(join(transcriptDirectory, `${GUI_SESSION_ID}.jsonl`), [
      JSON.stringify({ role: "user", message: { content: [{ type: "text", text: "Repair the SEM demo path." }] } }),
      JSON.stringify({ role: "assistant", message: { content: [{ type: "text", text: "The GUI agent is waiting for review." }] } }),
      JSON.stringify({ type: "turn_ended", status: "success" }),
    ].join("\n"));
    // Pin the transcript mtime old (matching the ~13-min-old conversation) so this
    // settled, success-ended session deterministically reads as "waiting" — proving
    // the mtime liveness signal does not falsely promote an idle session to running.
    await utimes(join(transcriptDirectory, `${GUI_SESSION_ID}.jsonl`), new Date(1784691238958), new Date(1784691238958));
    await writeFile(join(transcriptDirectory, "subagents", `${CHILD_SESSION_ID}.jsonl`), [
      JSON.stringify({ role: "user", message: { content: "Goal: Verify the Email Assistant build." } }),
      JSON.stringify({ role: "assistant", message: { content: "The focused build passed." } }),
      JSON.stringify({ type: "turn_ended", status: "success" }),
    ].join("\n"));

    const state = new Database(join(globalStorage, "state.vscdb"));
    state.run("create table ItemTable (key text primary key, value blob)");
    state.run("insert into ItemTable(key, value) values (?, ?)", [
      "glass.localAgentProjectMembership.v1",
      JSON.stringify({ [GUI_SESSION_ID]: projectId }),
    ]);
    state.run("insert into ItemTable(key, value) values (?, ?)", [
      "glass.localAgentProjects.v1",
      JSON.stringify([{ id: projectId, workspace: { id: "workspace-hash", uri: { fsPath: projectCwd } } }]),
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
      [GUI_SESSION_ID, "Elio: SEM Night", 1784691238958],
    );
    conversations.close();

    const tracking = new Database(join(home, ".cursor", "ai-tracking", "ai-code-tracking.db"));
    tracking.run(`create table ai_code_hashes (
      hash text primary key,
      source text not null,
      conversationId text,
      timestamp integer,
      model text,
      createdAt integer not null
    )`);
    tracking.run(
      "insert into ai_code_hashes(hash, source, conversationId, timestamp, model, createdAt) values ('hash', 'composer', ?, ?, 'grok-4.5', ?)",
      [GUI_SESSION_ID, 1784691434327, 1784691434327],
    );
    tracking.run(
      "insert into ai_code_hashes(hash, source, conversationId, timestamp, model, createdAt) values ('child-old', 'composer', ?, ?, 'grok-4.5', ?)",
      [CHILD_SESSION_ID, 1784691434327, 1784691434327],
    );
    tracking.run(
      "insert into ai_code_hashes(hash, source, conversationId, timestamp, model, createdAt) values ('child-latest', 'composer', ?, ?, 'gpt-5.6-sol-xhigh', ?)",
      [CHILD_SESSION_ID, 1784691434327, 1784691434327],
    );
    tracking.close();

    const result = await collectCursorSessions(home, 1784692000000);

    expect(result.errors).toEqual([]);
    expect(result.value).toHaveLength(2);
    expect(result.value.find(({ id }) => id === `cursor:${GUI_SESSION_ID}`)).toMatchObject({
      id: `cursor:${GUI_SESSION_ID}`,
      sourceSessionId: GUI_SESSION_ID,
      displayName: "Elio: SEM Night",
      cwd: projectCwd,
      model: "grok-4.5",
      task: "Repair the SEM demo path.",
      status: "waiting",
      tokens: { provenance: "unknown" },
      cost: null,
      subagentCount: 1,
      allowCwdFallback: false,
    });
    expect(result.value.find(({ id }) => id === `cursor:${GUI_SESSION_ID}`)?.artifacts[0]?.path)
      .toBe(join(transcriptDirectory, `${GUI_SESSION_ID}.jsonl`));
    expect(result.value.find(({ id }) => id === `cursor:${CHILD_SESSION_ID}`)).toMatchObject({
      model: "gpt-5.6-sol-xhigh",
      parentSourceSessionId: GUI_SESSION_ID,
      threadDepth: 1,
      tokens: { scope: "unknown", provenance: "unknown" },
      cost: null,
    });
  });

  test("a missing GUI conversation store is unknown rather than an empty population", async () => {
    const home = await setupGuiComposerHome({});
    await rm(guiConversationPath(home));

    const result = await collectCursorSessions(home, 1784692000000);

    expect(result.value).toEqual([]);
    expect(result.errors).toEqual([
      "cursor GUI conversations: database is missing; Cursor GUI sessions could not be enumerated for this scan.",
    ]);
  });

  test("an unreadable GUI conversation store names permissions and the missing population", async () => {
    const home = await setupGuiComposerHome({});
    const path = guiConversationPath(home);
    await chmod(path, 0);
    try {
      const result = await collectCursorSessions(home, 1784692000000);

      expect(result.value).toEqual([]);
      expect(result.errors).toEqual([
        "cursor GUI conversations: database permissions deny read access; Cursor GUI sessions could not be enumerated for this scan.",
      ]);
    } finally {
      await chmod(path, 0o600);
    }
  });

  test("a corrupt GUI conversation store names corruption and the missing population", async () => {
    const home = await setupGuiComposerHome({});
    await writeFile(guiConversationPath(home), "not a sqlite database");

    const result = await collectCursorSessions(home, 1784692000000);

    expect(result.value).toEqual([]);
    expect(result.errors).toEqual([
      "cursor GUI conversations: database is corrupt or is not SQLite; Cursor GUI sessions could not be enumerated for this scan.",
    ]);
  });

  test("a locked GUI conversation store is unknown for one scan and recovers on the next", async () => {
    const home = await setupGuiComposerHome({});
    const locked = new Database(guiConversationPath(home));
    locked.exec("pragma journal_mode = delete; begin exclusive");
    try {
      const failed = await collectCursorSessions(home, 1784692000000);

      expect(failed.value).toEqual([]);
      expect(failed.errors).toEqual([
        "cursor GUI conversations: database is locked or busy; Cursor GUI sessions could not be enumerated for this scan.",
      ]);
    } finally {
      locked.exec("rollback");
      locked.close();
    }

    const recovered = await collectCursorSessions(home, 1784692000000);
    expect(recovered.errors).toEqual([]);
    expect(recovered.value.map(({ id }) => id)).toContain(`cursor:${GUI_SESSION_ID}`);
  });

  test("an unsupported GUI conversation schema names the incompatible store", async () => {
    const home = await setupGuiComposerHome({});
    const path = guiConversationPath(home);
    await rm(path);
    const database = new Database(path);
    database.exec("create table replacement_conversations (id text)");
    database.close();

    const result = await collectCursorSessions(home, 1784692000000);

    expect(result.errors).toEqual([
      "cursor GUI conversations: database schema is incompatible; Cursor GUI sessions could not be enumerated for this scan.",
    ]);
  });

  test("reads a stable WAL conversation store without requiring writable sidecars", async () => {
    const home = await setupGuiComposerHome({});
    const path = guiConversationPath(home);
    const database = new Database(path);
    database.query("pragma journal_mode = wal").get();
    database.close();
    const globalStorage = join(path, "..");
    await chmod(globalStorage, 0o555);
    try {
      const result = await collectCursorSessions(home, 1784692000000);

      expect(result.errors).toEqual([]);
      expect(result.value.map(({ id }) => id)).toContain(`cursor:${GUI_SESSION_ID}`);
    } finally {
      await chmod(globalStorage, 0o755);
    }
  });

  test("reads the GUI model and effort from composerData, overriding ai-tracking", async () => {
    // composerData names Opus; ai-tracking still lists the older Grok model. The
    // authoritative composerData model and its effort tier must win.
    const home = await setupGuiComposerHome({
      composerData: {
        modelName: "claude-opus-4-8-thinking-high",
        parameters: [
          { id: "thinking", value: "true" },
          { id: "context", value: "300k" },
          { id: "effort", value: "xhigh" },
        ],
      },
      trackingModel: "grok-4.5",
    });

    const result = await collectCursorSessions(home, 1784692000000);

    expect(result.errors).toEqual([]);
    expect(result.value.find(({ id }) => id === `cursor:${GUI_SESSION_ID}`)).toMatchObject({
      model: "claude-opus-4-8-thinking-high",
      effort: "xhigh",
    });
  });

  /* An unreadable composerData record used to return {} — identical to a
     session that never wrote one. An absent model becomes the model policy
     "unreported", whose summary tells the operator "Cursor did not expose an
     authoritative model for this session": a confident claim about Cursor made
     from a local failure to read Cursor's own database. The two have opposite
     remedies, so the collector must not answer for a record it could not read. */
  test("an unreadable composerData record degrades the source instead of reading as no model", async () => {
    const home = await setupGuiComposerHome({ corruptComposerData: true, trackingModel: "grok-4.5" });

    const result = await collectCursorSessions(home, 1784692000000);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join(" ")).toContain("composerData");
    // The session is still collected — a damaged model record must not delete
    // the agent from the board.
    expect(result.value.find(({ id }) => id === `cursor:${GUI_SESSION_ID}`)).toBeDefined();
  });

  test("a session that never wrote composerData stays silent", async () => {
    // Absence is a real answer and must not be reported as a source fault.
    const home = await setupGuiComposerHome({ trackingModel: "grok-4.5" });

    const result = await collectCursorSessions(home, 1784692000000);

    expect(result.errors).toEqual([]);
  });

  test("falls back to ai-tracking when composerData reports the sentinel 'default' model", async () => {
    const home = await setupGuiComposerHome({
      composerData: { modelName: "default" },
      trackingModel: "grok-4.5",
    });

    const result = await collectCursorSessions(home, 1784692000000);

    expect(result.errors).toEqual([]);
    expect(result.value.find(({ id }) => id === `cursor:${GUI_SESSION_ID}`)?.model).toBe("grok-4.5");
  });

  test("fills a subagent's model from composerData by session id when no other source has it", async () => {
    // Reproduces the live gap: 137 model-less Cursor agents were all subagents,
    // enumerated from a parent's subagents/*.jsonl. They are absent from
    // conversation-search and have no ai-tracking row, so their model lived only in
    // cursorDiskKV composerData keyed by the child's own session id.
    const home = await mkdtemp(join(tmpdir(), "mountain-cursor-subagent-composer-"));
    temporaryDirectories.push(home);
    const globalStorage = join(home, "Library", "Application Support", "Cursor", "User", "globalStorage");
    const projectCwd = "/Users/me/elio-intelligence-suite";
    const projectId = "378abb0f-fefb-4ae9-bdf3-754920b7b4fe";
    const projectDirectory = join(home, ".cursor", "projects", "Users-me-elio-intelligence-suite");
    const transcriptDirectory = join(projectDirectory, "agent-transcripts", GUI_SESSION_ID);
    await mkdir(join(transcriptDirectory, "subagents"), { recursive: true });
    await mkdir(globalStorage, { recursive: true });
    const nowMs = 1784692000000;
    await writeFile(join(transcriptDirectory, `${GUI_SESSION_ID}.jsonl`), [
      JSON.stringify({ role: "user", message: { content: [{ type: "text", text: "Coordinate the swarm." }] } }),
      JSON.stringify({ type: "turn_ended", status: "success" }),
    ].join("\n"));
    await utimes(join(transcriptDirectory, `${GUI_SESSION_ID}.jsonl`), new Date(1784691238958), new Date(1784691238958));
    const childPath = join(transcriptDirectory, "subagents", `${CHILD_SESSION_ID}.jsonl`);
    await writeFile(childPath, [
      JSON.stringify({ role: "user", message: { content: "Goal: Verify the build." } }),
      JSON.stringify({ role: "assistant", message: { content: [{ type: "text", text: "Build verified." }] } }),
      JSON.stringify({ type: "turn_ended", status: "success" }),
    ].join("\n"));
    await utimes(childPath, new Date(nowMs - 60_000), new Date(nowMs - 60_000));

    const state = new Database(join(globalStorage, "state.vscdb"));
    state.run("create table ItemTable (key text primary key, value blob)");
    state.run("insert into ItemTable(key, value) values (?, ?)", [
      "glass.localAgentProjectMembership.v1",
      JSON.stringify({ [GUI_SESSION_ID]: projectId, [CHILD_SESSION_ID]: projectId }),
    ]);
    state.run("insert into ItemTable(key, value) values (?, ?)", [
      "glass.localAgentProjects.v1",
      JSON.stringify([{ id: projectId, workspace: { id: "workspace-hash", uri: { fsPath: projectCwd } } }]),
    ]);
    state.run("create table cursorDiskKV (key text primary key, value blob)");
    // Only the child's composerData carries a model; the parent has none, so the
    // parent must not accidentally supply the child's answer.
    state.run("insert into cursorDiskKV(key, value) values (?, ?)", [
      `composerData:${CHILD_SESSION_ID}`,
      JSON.stringify({
        modelConfig: {
          modelName: "cursor-grok-4.5-high-fast",
          selectedModels: [{ parameters: [{ id: "effort", value: "high" }, { id: "fast", value: "true" }] }],
        },
        usageData: {},
      }),
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
    // Only the PARENT conversation exists; the subagent is deliberately absent.
    conversations.run(
      "insert into conversations(source, scope, id, title, updated_at, is_archived, root_fingerprint) values ('local', '', ?, ?, ?, 0, 'fingerprint')",
      [GUI_SESSION_ID, "Swarm parent", 1784691238958],
    );
    conversations.close();
    // No ai-code-tracking.db at all: composerData is the child's only model source.

    const result = await collectCursorSessions(home, nowMs);

    expect(result.errors).toEqual([]);
    const child = result.value.find(({ id }) => id === `cursor:${CHILD_SESSION_ID}`);
    expect(child?.parentSourceSessionId).toBe(GUI_SESSION_ID);
    expect(child?.model).toBe("cursor-grok-4.5-high-fast");
    expect(child?.effort).toBe("high");
  });

  test("keeps Cursor sessions out of the token usage and burn rollups", () => {
    const nowMs = 1784689180000;
    const cursorAgent = parseCursorSession({
      sessionId: SESSION_ID,
      metaJson: JSON.stringify({
        createdAtMs: nowMs - 60_000,
        updatedAtMs: nowMs - 30_000,
        cwd: "/Users/me/project",
        hasConversation: true,
      }),
      store: { agentId: SESSION_ID, model: "grok-4.5" },
      nowMs,
    })!;
    // The invariant that excludes Cursor from every rollup: no numeric totals and
    // unknown provenance. snapshot.ts keys usage off `tokens.total`; pulse.ts keys
    // burn off `tokens.sessionTotal` + `provenance` and drops `provider === "cursor"`.
    expect(cursorAgent.tokens).toEqual({
      scope: "unknown",
      provenance: "unknown",
      contextWindow: 500_000,
    });
    expect(cursorAgent.tokens.total).toBeUndefined();
    expect(cursorAgent.tokens.sessionTotal).toBeUndefined();
    expect(cursorAgent.tokens.contextWindow).toBe(500_000);
    expect(cursorAgent.cost).toBeNull();

    const claudeAgent: CollectedAgent = {
      id: "claude:token-session",
      provider: "claude",
      sourceSessionId: "token-session",
      displayName: "Claude worker",
      cwd: "/Users/me/other-project",
      status: "running",
      statusReason: "Fixture activity is recent.",
      updatedAt: new Date(nowMs).toISOString(),
      tokens: { total: 1000, sessionTotal: 1000, scope: "session", provenance: "observed" },
      artifacts: [],
      gates: [],
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };

    const snapshot = buildSnapshot({
      agents: [cursorAgent, claudeAgent],
      surfaces: [],
      archiveStore,
      now: new Date(nowMs),
    });
    // The Cursor session is a working agent, yet contributes nothing to the token
    // sum, median, or reporting numerator.
    expect(snapshot.totals.working).toBe(2);
    expect(snapshot.totals.tokens).toBe(1000);
    expect(snapshot.totals.tokenReporting).toBe(1);
    expect(snapshot.totals.tokenMedian).toBe(1000);

    const pulse = new PulseTracker(undefined, nowMs);
    pulse.observe(snapshot, nowMs);
    const report = pulse.report(nowMs);
    // Burn coverage counts the Cursor session as "unknown", never "eligible".
    expect(report.burn.coverage.eligible).toBe(1);
    expect(report.burn.coverage.unknown).toBe(1);
  });
});

describe("Cursor Agent live pane identity", () => {
  const duplicateCwd = "/Users/emilionunezgarcia/Developer/the-mountain";
  const versionedWrapperCommand = [
    "/Users/me/.local/bin/agent",
    "--use-system-ca",
    "/Users/me/.local/share/cursor-agent/versions/2026.08.04-aaa8809/index.js",
  ].join(" ");
  const surfaces: CmuxSurface[] = [
    { workspaceId: "CURSOR-WORKSPACE", surfaceId: "CURSOR-SURFACE", tty: "ttys008", cwd: duplicateCwd, sourceSessionIds: [] },
    { workspaceId: "OTHER-WORKSPACE", surfaceId: "OTHER-SURFACE", tty: "ttys009", cwd: duplicateCwd, sourceSessionIds: [] },
  ];

  test("recognizes only allowlisted Cursor stores, transcripts, resume argv, and versioned wrapper", () => {
    expect(identityFromSessionPath(
      `/Users/me/.cursor/chats/0c67e7a2f36ffdd93685d6428f4485aa/${SESSION_ID}/store.db-wal`,
    )).toMatchObject({ provider: "cursor", value: SESSION_ID, full: true });
    expect(identityFromSessionPath(
      `/Users/me/.cursor/projects/project/agent-transcripts/${SESSION_ID}/${SESSION_ID}.jsonl`,
    )).toMatchObject({ provider: "cursor", value: SESSION_ID, full: true });
    expect(identityFromSessionPath(`/private/tmp/${SESSION_ID}/store.db`)).toBeNull();
    expect(identitiesFromCommand(`/Users/me/.local/bin/cursor-agent --resume ${SESSION_ID}`))
      .toContainEqual({ provider: "cursor", value: SESSION_ID, full: true });
    expect(isRecognizedAgentProcess("/Users/me/.local/bin/cursor-agent --resume")).toBeTrue();
    expect(isRecognizedAgentProcess(versionedWrapperCommand)).toBeTrue();
    expect(isRecognizedAgentProcess("/Users/me/.local/bin/agent --use-system-ca /tmp/index.js")).toBeFalse();
  });

  test("an open Cursor store maps the exact surface even when cwd is duplicated", async () => {
    const runner = new SequenceRunner([
      {
        exitCode: 0,
        stdout: [
          `201 ttys008 ${versionedWrapperCommand}`,
          "202 ttys009 -zsh",
        ].join("\n"),
        stderr: "",
        timedOut: false,
      },
      {
        exitCode: 0,
        stdout: `p201\nn/Users/me/.cursor/chats/0c67e7a2f36ffdd93685d6428f4485aa/${SESSION_ID}/store.db-wal`,
        stderr: "",
        timedOut: false,
      },
    ]);
    const source = parseCursorSession({
      sessionId: SESSION_ID,
      metaJson: await fixture("cursor-meta.json"),
      store: { agentId: SESSION_ID },
      nowMs: 1784689180000,
    })!;
    const enriched = await enrichCmuxIdentity(surfaces, [source], runner);
    const target = resolveAgentTarget(source, enriched.value);

    expect(enriched.errors).toEqual([]);
    expect(target).toMatchObject({
      resolution: "exact",
      workspaceId: "CURSOR-WORKSPACE",
      surfaceId: "CURSOR-SURFACE",
    });
  });

  test("duplicate cwd without exact Cursor evidence remains ambiguous", async () => {
    const source = parseCursorSession({
      sessionId: SESSION_ID,
      metaJson: await fixture("cursor-meta.json"),
      store: { agentId: SESSION_ID },
      nowMs: 1784689180000,
    })!;

    const target = resolveAgentTarget(source, surfaces);

    expect(target.resolution).toBe("ambiguous");
    expect(target.reason).toContain("2 unclaimed cmux surfaces");
    expect(target.surfaceId).toBeUndefined();

    const missing = resolveAgentTarget(source, []);
    expect(missing.resolution).toBe("missing");
    expect(missing.surfaceId).toBeUndefined();
  });

  test("a GUI-only Cursor agent cannot claim an unrelated cmux pane by cwd", () => {
    const source = parseCursorSession({
      sessionId: SESSION_ID,
      metaJson: JSON.stringify({
        createdAtMs: 1784689000000,
        updatedAtMs: 1784689180000,
        cwd: "/Users/emilionunezgarcia/Developer/the-mountain",
        hasConversation: true,
      }),
      store: { agentId: SESSION_ID },
      allowCwdFallback: false,
      nowMs: 1784689180000,
    })!;
    const target = resolveAgentTarget(source, [{
      workspaceId: "UNRELATED-WORKSPACE",
      surfaceId: "UNRELATED-SURFACE",
      cwd: source.cwd,
      sourceSessionIds: [],
    }]);

    expect(target).toEqual({
      resolution: "missing",
      reason: "Cursor GUI agents require exact cmux identity; cwd fallback is disabled.",
    });
  });
});

describe("Cursor composer headers occupancy", () => {
  const COMPOSER_ID = "7f3a2b10-9c4d-4e5f-8a6b-1c2d3e4f5a6b";

  test("parses a valid header row into a composerId → percent map", () => {
    const map = parseComposerHeaders(JSON.stringify({
      allComposers: [{ composerId: COMPOSER_ID, contextUsagePercent: 95.47466666666666 }],
    }));
    expect(map.get(COMPOSER_ID)).toBe(95.47466666666666);
    expect(map.size).toBe(1);
  });

  test("absent value and missing allComposers are empty, not errors", () => {
    expect(parseComposerHeaders(undefined).size).toBe(0);
    expect(parseComposerHeaders(null).size).toBe(0);
    expect(parseComposerHeaders(JSON.stringify({ somethingElse: [] })).size).toBe(0);
  });

  test("drops non-uuid ids and out-of-range or non-finite percents without clamping", () => {
    const map = parseComposerHeaders(JSON.stringify({
      allComposers: [
        { composerId: "not-a-uuid", contextUsagePercent: 50 },
        { composerId: COMPOSER_ID, contextUsagePercent: 250 },
        { composerId: "8f3a2b10-9c4d-4e5f-8a6b-1c2d3e4f5a6b", contextUsagePercent: Number.NaN },
        { composerId: "9f3a2b10-9c4d-4e5f-8a6b-1c2d3e4f5a6b", contextUsagePercent: -1 },
        { composerId: "af3a2b10-9c4d-4e5f-8a6b-1c2d3e4f5a6b", contextUsagePercent: 100.3 },
      ],
    }));
    // Only the 100.3 row survives: within [0, 100.5], capped later at render.
    expect(map.size).toBe(1);
    expect(map.get("af3a2b10-9c4d-4e5f-8a6b-1c2d3e4f5a6b")).toBe(100.3);
  });

  test("invalid JSON throws so the caller can record a named error", () => {
    expect(() => parseComposerHeaders("{ this is not json")).toThrow();
  });

  test("GUI session with a composer header reports occupancy but never tokens or cost", async () => {
    const home = await setupGuiComposerHome({ contextUsagePercent: 95.47, trackingModel: "grok-4.5" });
    const result = await collectCursorSessions(home, 1784692000000);
    expect(result.errors).toEqual([]);
    const agent = result.value.find(({ id }) => id === `cursor:${GUI_SESSION_ID}`);
    expect(agent?.tokens).toMatchObject({
      scope: "latest-turn",
      provenance: "observed",
      occupancyPct: 95.47,
    });
    expect(agent?.tokens.total).toBeUndefined();
    expect(agent?.tokens.sessionTotal).toBeUndefined();
    expect(agent?.cost).toBeNull();
  });

  test("a session with no header row stays on the unknown billing path", async () => {
    const home = await setupGuiComposerHome({ trackingModel: "grok-4.5" });
    const result = await collectCursorSessions(home, 1784692000000);
    const agent = result.value.find(({ id }) => id === `cursor:${GUI_SESSION_ID}`);
    expect(agent?.tokens.occupancyPct).toBeUndefined();
    expect(agent?.tokens.provenance).toBe("unknown");
  });

  test("a corrupt composerHeaders record degrades the source without deleting occupancy-less sessions", async () => {
    const home = await setupGuiComposerHome({ corruptComposerHeaders: true, trackingModel: "grok-4.5" });
    const result = await collectCursorSessions(home, 1784692000000);
    expect(result.errors.join(" ")).toContain("composer headers");
    const agent = result.value.find(({ id }) => id === `cursor:${GUI_SESSION_ID}`);
    expect(agent).toBeDefined();
    expect(agent?.tokens.occupancyPct).toBeUndefined();
  });
});
