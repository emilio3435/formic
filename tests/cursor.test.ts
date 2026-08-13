import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmod, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectCursorSessions,
  fillCursorOccupancy,
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
const CLI_OCCUPANCY_SESSION_ID = "0d9f6afe-2e34-4bd0-9d10-53146a02a111";
const DAMAGED_COMPOSER_ID = "bf3a2b10-9c4d-4e5f-8a6b-1c2d3e4f5a6b";
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
  /** Writes Cursor's own context meter into composer.composerHeaders. */
  contextUsagePercent?: number;
  /** Which composer the meter belongs to. Defaults to GUI_SESSION_ID; a foreign uuid
      models a header map that holds no row for the session being collected. */
  contextUsageComposerId?: string;
  /** Writes a composerHeaders row whose value is not JSON, to model a damaged meter. */
  corruptComposerHeaders?: boolean;
  /** Writes Cursor's live source: a row in the composerHeaders TABLE the blob was
      migrated into (ItemTable `composer.composerHeaders.tableGateEnabled` = true). */
  tableUsagePercent?: number;
  /** Which composer the TABLE row belongs to. Defaults to GUI_SESSION_ID. */
  tableUsageComposerId?: string;
  /** Adds a SECOND table row whose value is not JSON, to model one damaged row
      among good ones. */
  corruptTableRow?: boolean;
  /** Creates the composerHeaders TABLE with columns this reader does not know,
      to model Cursor migrating the payload again under the same table name. */
  tableWrongColumns?: boolean;
  /** Creates the live-schema composerHeaders TABLE with no rows at all, to model
      a gated install whose table holds nothing this scan can use. */
  emptyTable?: boolean;
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
          {
            composerId: options.contextUsageComposerId ?? GUI_SESSION_ID,
            contextUsagePercent: options.contextUsagePercent,
          },
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
  if (options.tableWrongColumns) {
    // The table NAME Cursor writes today, carrying its payload under a column
    // this reader does not know — the shape a further migration would take.
    state.run("create table composerHeaders (composerId text primary key, payload text)");
    state.run("insert into composerHeaders(composerId, payload) values (?, ?)", [
      GUI_SESSION_ID,
      JSON.stringify({ contextUsagePercent: 85.837109375 }),
    ]);
  } else if (options.tableUsagePercent !== undefined || options.corruptTableRow || options.emptyTable) {
    /* The live schema on this machine, column names and order transcribed from
       `sqlite_master` (928 rows). SQLite's declared types are case-insensitive
       and `value` is TEXT in production; the readings below are bound as text,
       so the fixture takes the same branch the live data does. */
    state.run(`create table composerHeaders (
      composerId text primary key,
      workspaceId text,
      createdAt integer,
      lastUpdatedAt integer,
      isArchived integer,
      isSubagent integer,
      recency integer,
      checkpointAt integer,
      value text
    )`);
    if (options.tableUsagePercent !== undefined) {
      state.run("insert into composerHeaders(composerId, value) values (?, ?)", [
        options.tableUsageComposerId ?? GUI_SESSION_ID,
        JSON.stringify({ contextUsagePercent: options.tableUsagePercent }),
      ]);
    }
    if (options.corruptTableRow) {
      state.run("insert into composerHeaders(composerId, value) values (?, ?)", [
        DAMAGED_COMPOSER_ID,
        "{ not json",
      ]);
    }
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

// Builds a CLI-side Cursor home (~/.cursor/chats/<workspace>/<uuid>/) alongside the
// GUI globalStorage that holds the meter. The GUI collector and the CLI collector are
// separate entry paths into `collectCursorSessions`; this fixture exercises the CLI one
// while still giving `state.vscdb` a composer.composerHeaders row to join from.
async function setupCliOccupancyHome(
  contextUsagePercent?: number,
  storeUsage?: { totalTokens: number },
): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "mountain-cursor-cli-occupancy-"));
  temporaryDirectories.push(home);
  const sessionDir = join(home, ".cursor", "chats", "workspace-hash", CLI_OCCUPANCY_SESSION_ID);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(join(sessionDir, "meta.json"), JSON.stringify({
    createdAtMs: 1784691200000,
    updatedAtMs: 1784691238958,
    cwd: "/Users/me/project",
    hasConversation: true,
  }));
  // Real CLI sessions always carry a store.db; an absent one is reported as a fault,
  // which would drown the occupancy assertions in an unrelated error. The blobs table
  // mirrors the store fixture used by the newest-assistant-blob model test.
  const store = new Database(join(sessionDir, "store.db"));
  store.run("create table meta (key text primary key, value text)");
  store.run("create table blobs (id text primary key, data blob)");
  store.run("insert into meta(key, value) values ('0', ?)", [
    Buffer.from(JSON.stringify({
      agentId: CLI_OCCUPANCY_SESSION_ID,
      name: "New Agent",
      mode: "default",
      lastUsedModel: "grok-4.5",
    })).toString("hex"),
  ]);
  if (storeUsage) {
    // The blob walk in cursorTokensFromDatabase takes the newest assistant record
    // carrying usage; `usage.totalTokens` is the alias `pickUsage` reads for `total`.
    store.run("insert into blobs(id, data) values ('assistant-usage', ?)", [
      Buffer.from(JSON.stringify({
        role: "assistant",
        id: "blob-usage",
        content: [{ type: "text", text: "ok" }],
        usage: { inputTokens: 90000, outputTokens: 1200, totalTokens: storeUsage.totalTokens },
      })),
    ]);
  }
  store.close();
  const globalStorage = join(home, "Library", "Application Support", "Cursor", "User", "globalStorage");
  await mkdir(globalStorage, { recursive: true });
  const state = new Database(join(globalStorage, "state.vscdb"));
  state.run("create table ItemTable (key text primary key, value blob)");
  if (contextUsagePercent !== undefined) {
    state.run("insert into ItemTable(key, value) values (?, ?)", [
      "composer.composerHeaders",
      JSON.stringify({ allComposers: [{ composerId: CLI_OCCUPANCY_SESSION_ID, contextUsagePercent }] }),
    ]);
  }
  state.close();
  // Empty conversations table so the GUI pass enumerates zero rows instead of
  // reporting a missing store as a fault of this CLI-only fixture.
  const conversations = new Database(join(globalStorage, "conversation-search.db"));
  conversations.run(`create table conversations (
    fts_rowid integer primary key, source text not null, scope text not null,
    id text not null, title text not null, updated_at integer not null,
    is_archived integer not null, root_fingerprint text, cache_fingerprint text
  )`);
  conversations.close();
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

    /* Occupancy changes which ring lights, and nothing else. A percent is a
       fill reading, not a measurement of tokens — so the same session that
       raises context coverage must leave the token sum, the reporting
       numerator, the median and burn coverage exactly where they were. */
    const occupiedCursor: CollectedAgent = {
      ...cursorAgent,
      id: "cursor:occupied",
      sourceSessionId: "occupied",
      tokens: { scope: "latest-turn", provenance: "observed", occupancyPct: 95.47, contextWindow: 500_000 },
    };
    const occupiedSnapshot = buildSnapshot({
      agents: [occupiedCursor, claudeAgent],
      surfaces: [],
      archiveStore,
      now: new Date(nowMs),
    });
    // Occupancy lights the context ring…
    expect(occupiedSnapshot.programs.flatMap((program) => program.agents)
      .find((agent) => agent.id === "cursor:occupied")?.contextPct).toBe(95);
    // `contextReporting` is published on the snapshot root, not under totals
    // (snapshot.ts:826) — the coverage numerator for contextPeak.
    expect(occupiedSnapshot.contextReporting).toBe(1);
    expect(occupiedSnapshot.contextPeak).toBe(95);
    // …and moves nothing in the token economy.
    expect(occupiedSnapshot.totals.tokens).toBe(1000);
    expect(occupiedSnapshot.totals.tokenReporting).toBe(1);
    expect(occupiedSnapshot.totals.tokenMedian).toBe(1000);
    const occupiedPulse = new PulseTracker(undefined, nowMs);
    occupiedPulse.observe(occupiedSnapshot, nowMs);
    const occupiedReport = occupiedPulse.report(nowMs);
    expect(occupiedReport.burn.coverage.eligible).toBe(1);
    expect(occupiedReport.burn.coverage.unknown).toBe(1);
  });

  /* The block above builds its occupancy agent by hand, so it pins the SNAPSHOT
     boundary: a percent reaching buildSnapshot must not become tokens. This one
     drives the real collector, so the same pin also covers the COLLECTOR: if
     fillCursorOccupancy ever multiplied the percent back into the window, the
     invented number would land in the fleet token sum here. Both halves of the
     honesty claim are measured on wire-shaped data, not on a fixture. */
  test("a live-collected occupancy session raises context coverage without entering the token rollups", async () => {
    /* A CLI session mid-turn, so it lands in `working` — the population the
       token sum, the reporting numerator and the median are all computed over.
       A finished GUI turn reads `waiting`, which is live enough for the context
       ring but sits outside every token rollup, so it could not witness an
       invented total arriving. */
    const nowMs = 1784691250000;
    const home = await setupCliOccupancyHome(41.2);
    const collected = await collectCursorSessions(home, nowMs);
    expect(collected.errors).toEqual([]);
    const occupied = collected.value.find(({ id }) => id === `cursor:${CLI_OCCUPANCY_SESSION_ID}`);
    expect(occupied?.tokens.occupancyPct).toBe(41.2);

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
      agents: [occupied!, claudeAgent],
      surfaces: [],
      archiveStore,
      now: new Date(nowMs),
    });

    const published = snapshot.programs.flatMap((program) => program.agents)
      .find((agent) => agent.id === `cursor:${CLI_OCCUPANCY_SESSION_ID}`);
    expect(published?.contextPct).toBe(41);
    // Inside the token rollups' population, so the assertions below can witness
    // an invented total rather than miss it on a technicality.
    expect(published?.activity).toBe("working");
    expect(snapshot.contextReporting).toBe(1);
    expect(snapshot.totals.working).toBe(2);
    // The fleet token sum is the Claude session alone. 41.2% of a 500k window
    // is 206,000 tokens; if that number were ever invented it would land here.
    expect(snapshot.totals.tokens).toBe(1000);
    expect(snapshot.totals.tokenReporting).toBe(1);
    expect(snapshot.totals.tokenMedian).toBe(1000);
    const pulse = new PulseTracker(undefined, nowMs);
    pulse.observe(snapshot, nowMs);
    expect(pulse.report(nowMs).burn.coverage.eligible).toBe(1);
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
    expect(result.errors).toEqual([]);
    const agent = result.value.find(({ id }) => id === `cursor:${GUI_SESSION_ID}`);
    expect(agent?.tokens.occupancyPct).toBeUndefined();
    expect(agent?.tokens.provenance).toBe("unknown");
  });

  /* The join is by each agent's OWN session id, and only a NON-EMPTY header map can
     prove it: the test above short-circuits on the empty-map early return, so an
     "inherit any percent in the map" bug would sail through it. Here the meter holds
     a real percent under a foreign composer id, which is the shape a parent's percent
     leaking onto a child would take. The collected session must stay unknown. */
  test("a percent belonging to another composer is never inherited", async () => {
    const home = await setupGuiComposerHome({
      contextUsagePercent: 88.25,
      contextUsageComposerId: COMPOSER_ID,
      trackingModel: "grok-4.5",
    });
    const result = await collectCursorSessions(home, 1784692000000);
    expect(result.errors).toEqual([]);
    const agent = result.value.find(({ id }) => id === `cursor:${GUI_SESSION_ID}`);
    expect(agent).toBeDefined();
    expect(agent?.tokens.occupancyPct).toBeUndefined();
    expect(agent?.tokens.provenance).toBe("unknown");
    expect(agent?.tokens.scope).toBe("unknown");
  });

  test("a corrupt composerHeaders record degrades the source without deleting occupancy-less sessions", async () => {
    const home = await setupGuiComposerHome({ corruptComposerHeaders: true, trackingModel: "grok-4.5" });
    const result = await collectCursorSessions(home, 1784692000000);
    // Exactly one fault: the damaged meter is named, and nothing ELSE about the scan
    // is reported as broken — that is the "degrades without failing the scan" half.
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("composer headers");
    const agent = result.value.find(({ id }) => id === `cursor:${GUI_SESSION_ID}`);
    expect(agent).toBeDefined();
    expect(agent?.tokens.occupancyPct).toBeUndefined();
  });

  /* The GUI tests above all enter through collectCursorGuiSessions. CLI chat sessions
     are a different entry path — built before the state read, from ~/.cursor/chats —
     so the join has to happen in the shared post-pass rather than inside the GUI
     builder. This pins that the CLI path is covered by the same map. */
  test("CLI chats session joins the same occupancy map as GUI sessions", async () => {
    const home = await setupCliOccupancyHome(41.2);
    const result = await collectCursorSessions(home, 1784691250000);
    expect(result.errors).toEqual([]);
    const agent = result.value.find(({ id }) => id === `cursor:${CLI_OCCUPANCY_SESSION_ID}`);
    expect(agent?.tokens).toMatchObject({ scope: "latest-turn", provenance: "observed", occupancyPct: 41.2 });
    expect(agent?.tokens.total).toBeUndefined();
    expect(agent?.cost).toBeNull();
  });

  test("a CLI session absent from allComposers stays unknown", async () => {
    const home = await setupCliOccupancyHome();
    const result = await collectCursorSessions(home, 1784691250000);
    expect(result.errors).toEqual([]);
    const agent = result.value.find(({ id }) => id === `cursor:${CLI_OCCUPANCY_SESSION_ID}`);
    expect(agent).toBeDefined();
    expect(agent?.tokens.occupancyPct).toBeUndefined();
    expect(agent?.tokens.provenance).toBe("unknown");
  });

  /* Cursor's meter is per-composer, and a subagent is not its parent's composer. The
     parent here carries a real percent while the child carries none, so any lookup
     that walks up the lineage — or takes "the" percent from a one-entry map — would
     paint the child with a number Cursor never measured for it. */
  test("a Cursor subagent never inherits its parent's context percent", async () => {
    const home = await mkdtemp(join(tmpdir(), "mountain-cursor-child-occupancy-"));
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
    // Only the PARENT composer has a meter row; the child deliberately has none.
    state.run("insert into ItemTable(key, value) values (?, ?)", [
      "composer.composerHeaders",
      JSON.stringify({ allComposers: [{ composerId: GUI_SESSION_ID, contextUsagePercent: 88 }] }),
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
      [GUI_SESSION_ID, "Swarm parent", 1784691238958],
    );
    conversations.close();

    const result = await collectCursorSessions(home, nowMs);

    expect(result.errors).toEqual([]);
    const child = result.value.find(({ id }) => id === `cursor:${CHILD_SESSION_ID}`);
    expect(child?.parentSourceSessionId).toBe(GUI_SESSION_ID);
    expect(child?.tokens.occupancyPct).toBeUndefined();
    expect(child?.tokens.provenance).toBe("unknown");
    const parent = result.value.find(({ id }) => id === `cursor:${GUI_SESSION_ID}`);
    expect(parent?.tokens.occupancyPct).toBe(88);
  });

  /* A percent is a ratio with no numerator: it can say how full the window is but
     never how many tokens are in it. Where store.db still reports a real observed
     total, that measurement outranks the meter, and the percent must not overwrite
     it — nor sit beside it, where the ring would be drawn from the ratio while the
     numbers came from the store. */
  test("an observed store.db total outranks the composer meter", async () => {
    const home = await setupCliOccupancyHome(95, { totalTokens: 120000 });
    const result = await collectCursorSessions(home, 1784691250000);
    expect(result.errors).toEqual([]);
    const agent = result.value.find(({ id }) => id === `cursor:${CLI_OCCUPANCY_SESSION_ID}`);
    expect(agent?.tokens.total).toBe(120000);
    expect(agent?.tokens.provenance).toBe("observed");
    expect(agent?.tokens.occupancyPct).toBeUndefined();
  });

  /* Cursor migrated composer headers out of the ItemTable blob into a dedicated
     table on 2026-07-05. Every test above this point feeds the blob, so all of
     them would still pass against a source that stopped being written weeks
     ago. These four read the live one. */
  test("the composerHeaders table lights occupancy with no blob present at all", async () => {
    const home = await setupGuiComposerHome({ tableUsagePercent: 85.837109375, trackingModel: "grok-4.5" });
    const result = await collectCursorSessions(home, 1784692000000);
    expect(result.errors).toEqual([]);
    const agent = result.value.find(({ id }) => id === `cursor:${GUI_SESSION_ID}`);
    expect(agent?.tokens).toMatchObject({
      scope: "latest-turn",
      provenance: "observed",
      occupancyPct: 85.837109375,
    });
    expect(agent?.tokens.total).toBeUndefined();
    expect(agent?.cost).toBeNull();
  });

  /* The whole point of the task. Both sources carry a reading for the SAME
     composer; the blob's is the July-5 freeze and the table's is what Cursor
     wrote last. If a regression ever reinstates blob precedence, this is the
     only test that notices — the ring would keep lighting, just with a number
     39 days old. */
  test("the table's reading beats a stale blob for the same composer", async () => {
    const home = await setupGuiComposerHome({
      tableUsagePercent: 85.837109375,
      contextUsagePercent: 12.5,
      trackingModel: "grok-4.5",
    });
    const result = await collectCursorSessions(home, 1784692000000);
    expect(result.errors).toEqual([]);
    const agent = result.value.find(({ id }) => id === `cursor:${GUI_SESSION_ID}`);
    expect(agent?.tokens.occupancyPct).toBe(85.837109375);
  });

  /* This branch only ever runs on a GATED install — an install without the
     table takes the blob-only path above, never this merge. What it covers is
     a table that answers, but not for this composer: the blob may fill the gap
     it leaves, because filling a gap is not the same as replacing a live
     answer with a frozen one. Without it a non-empty table would suppress the
     blob wholesale and strand the session at unknown. */
  test("the blob still fills composers the table has no row for", async () => {
    const home = await setupGuiComposerHome({
      tableUsagePercent: 77.323828125,
      tableUsageComposerId: COMPOSER_ID,
      contextUsagePercent: 41.2,
      trackingModel: "grok-4.5",
    });
    const result = await collectCursorSessions(home, 1784692000000);
    expect(result.errors).toEqual([]);
    const agent = result.value.find(({ id }) => id === `cursor:${GUI_SESSION_ID}`);
    expect(agent?.tokens.occupancyPct).toBe(41.2);
  });

  /* One damaged row is not a damaged source. The blob is all-or-nothing — a
     single bad parse costs every composer — but the table is 928 independent
     rows, so a skip costs one and a throw costs 927. `errors` staying empty is
     the second half: a bad row is not a scan fault to report. */
  test("a damaged table row is skipped without discarding the good readings", async () => {
    const home = await setupGuiComposerHome({
      tableUsagePercent: 17.5890625,
      corruptTableRow: true,
      trackingModel: "grok-4.5",
    });
    const result = await collectCursorSessions(home, 1784692000000);
    expect(result.errors).toEqual([]);
    const agent = result.value.find(({ id }) => id === `cursor:${GUI_SESSION_ID}`);
    expect(agent?.tokens.occupancyPct).toBe(17.5890625);
  });

  /* The inverse asymmetry to the damaged row: that costs one reading of 928,
     but a renamed column costs EVERY Cursor GUI session. The table read runs
     inside the readForeignSqlite callback, so a `no such column` throw is
     classified as an unreadable state.vscdb and the whole scan reports the
     database as broken. Cursor has moved this payload twice already and
     versions it in flight, so the next migration is a question of when. A
     schema change must cost occupancy and nothing else.

     The blob here is deliberate and is what makes the test able to fail. On a
     gated install the blob froze the day the gate flipped, so falling back to
     it when the TABLE breaks would republish a stale reading as this scan's
     answer — and it would do so silently, because an unreadable table used to
     be indistinguishable from an empty one. The 12.5 below is that frozen
     reading: it must not reach the agent, and the failure must be named. */
  test("a composerHeaders table with unknown columns costs occupancy, never the sessions", async () => {
    const home = await setupGuiComposerHome({
      tableWrongColumns: true,
      contextUsagePercent: 12.5,
      trackingModel: "grok-4.5",
    });
    const result = await collectCursorSessions(home, 1784692000000);
    // The session survives in full — model, cwd and identity all intact.
    const agent = result.value.find(({ id }) => id === `cursor:${GUI_SESSION_ID}`);
    expect(agent).toBeDefined();
    expect(agent?.model).toBe("grok-4.5");
    // Occupancy alone is absent, and absent honestly: unknown, not the frozen 12.5.
    expect(agent?.tokens.occupancyPct).toBeUndefined();
    expect(agent?.tokens.provenance).toBe("unknown");
    /* A read that could not happen is a collection error, per
       docs/FOREIGN-SQLITE-READS.md — it names the fault and what could not be
       enumerated, rather than passing an unreadable source off as an empty one. */
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("the composerHeaders table could not be read");
    expect(result.errors[0]).toContain("context occupancy is missing for this scan");
  });

  /* Same rule from the other side, with nothing broken at all. A gated table
     that legitimately holds no usable row is a complete answer: "Cursor has no
     current meter for this composer". Reaching past it to the blob would turn
     that into "Cursor says 12.5%", dated the day the gate flipped, and no error
     would mark the substitution. An empty table and a blob are not two sources
     to merge — on a gated install the blob is the one that stopped moving. */
  test("a gated but empty composerHeaders table does not fall back to the frozen blob", async () => {
    const home = await setupGuiComposerHome({
      emptyTable: true,
      contextUsagePercent: 12.5,
      trackingModel: "grok-4.5",
    });
    const result = await collectCursorSessions(home, 1784692000000);
    // Nothing failed, so nothing is reported: an empty table is a real answer.
    expect(result.errors).toEqual([]);
    const agent = result.value.find(({ id }) => id === `cursor:${GUI_SESSION_ID}`);
    expect(agent).toBeDefined();
    expect(agent?.model).toBe("grok-4.5");
    expect(agent?.tokens.occupancyPct).toBeUndefined();
    expect(agent?.tokens.provenance).toBe("unknown");
  });

  /* On the live (table-gated) install the blob is only a fallback, so a
     damaged blob costs nothing the table already covers. The error still has
     to be raised — the fallback really is unreadable — but it must not claim
     occupancy is missing while the very same scan publishes a percent. An
     error that misstates its own consequence is the failure this board exists
     to avoid, just aimed at the operator instead of the ring. */
  test("a corrupt blob beside a healthy table reports the fallback, not a missing ring", async () => {
    const home = await setupGuiComposerHome({
      tableUsagePercent: 85.837109375,
      corruptComposerHeaders: true,
      trackingModel: "grok-4.5",
    });
    const result = await collectCursorSessions(home, 1784692000000);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("the legacy header blob is unreadable");
    expect(result.errors[0]).not.toContain("context occupancy will be missing");
    const agent = result.value.find(({ id }) => id === `cursor:${GUI_SESSION_ID}`);
    expect(agent?.tokens.occupancyPct).toBe(85.837109375);
  });

  /* Filling occupancy also stamps provenance "observed", so the row it lands on
     must have no token total left for that stamp to describe. An ESTIMATED
     total that survived the fill would be republished as observed and lose the
     `≈` the token cell prints to say "this is a guess" — laundering an estimate
     into a measurement, which is the one thing this board must never do. The
     collector cannot build that row today (it emits observed-with-a-total or
     unknown-with-none), so the rule is pinned directly on the function. */
  test("any token total blocks the occupancy fill, whatever provenance it claims", () => {
    const cursorRow = (id: string, tokens: CollectedAgent["tokens"]): CollectedAgent => ({
      id: `cursor:${id}`,
      provider: "cursor",
      sourceSessionId: id,
      displayName: "Cursor session",
      cwd: "/Users/me/project",
      status: "running",
      statusReason: "Fixture activity is recent.",
      updatedAt: new Date(1784691250000).toISOString(),
      tokens,
      artifacts: [],
      gates: [],
    });
    const estimated = cursorRow("estimated-total", {
      total: 4321,
      scope: "latest-turn",
      provenance: "estimated",
    });
    const zeroTotal = cursorRow("zero-total", { total: 0, scope: "latest-turn", provenance: "observed" });
    const unreported = cursorRow("unreported", { scope: "unknown", provenance: "unknown" });

    fillCursorOccupancy(
      {
        path: "/fixture/state.vscdb",
        fingerprint: "fixture",
        sessionCwds: new Map(),
        hasComposerData: false,
        composerData: new Map(),
        occupancyPct: new Map([
          ["estimated-total", 61.5],
          ["zero-total", 61.5],
          ["unreported", 61.5],
        ]),
        composers: new Map(),
      },
      [estimated, zeroTotal, unreported],
    );

    // An estimate keeps its total AND its provenance: untouched, not upgraded.
    expect(estimated.tokens.occupancyPct).toBeUndefined();
    expect(estimated.tokens.total).toBe(4321);
    expect(estimated.tokens.provenance).toBe("estimated");
    /* A total of exactly 0 still blocks the fill — `total !== undefined` is the
       predicate, as it was before, so this ruling did not move. */
    expect(zeroTotal.tokens.occupancyPct).toBeUndefined();
    // The shape the feature exists for is still filled.
    expect(unreported.tokens.occupancyPct).toBe(61.5);
    expect(unreported.tokens.provenance).toBe("observed");
    expect(unreported.tokens.total).toBeUndefined();
  });
});
