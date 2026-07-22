import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectCursorSessions,
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
import { resolveAgentTarget } from "../src/server/targets";
import type { CmuxSurface, CommandResult, CommandRunner } from "../src/server/types";

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
      displayName: "Verify The Mountain routing without changing live state.",
      cwd: "/Users/emilionunezgarcia/Developer/the-mountain",
      model: "Cursor Grok 4.5",
      task: "Verify The Mountain routing without changing live state.",
      status: "waiting",
      statusReason: "Cursor recorded the last turn as successfully ended.",
      subagentCount: 2,
      transcriptTail: "Cursor identity is exact when the live process opens its session store.",
      tokens: { scope: "unknown", provenance: "unknown" },
      cost: null,
    });
    expect(agent?.tokens.total).toBeUndefined();
    expect(agent?.artifacts[0]?.kind).toBe("transcript");
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
      displayName: "Verify the email build.",
      model: "gpt-5.6-sol-xhigh",
      parentSourceSessionId: SESSION_ID,
      threadDepth: 1,
      status: "stale",
      tokens: { scope: "unknown", provenance: "unknown" },
      cost: null,
    });
  });

  test("keeps an aborted Cursor child in history instead of inflating the active attention queue", () => {
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

    expect(child).toMatchObject({
      status: "stale",
      statusReason: "Cursor child recorded the last turn as aborted.",
      gates: ["Cursor child turn: aborted"],
    });
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

  test("reads Cursor's hex metadata and per-session system model from the real SQLite schema", async () => {
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
      model: "Cursor Grok 4.5",
    });
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
    expect(agent?.displayName).toBe("Review safe routing.");
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
});

describe("Cursor Agent live pane identity", () => {
  const duplicateCwd = "/Users/emilionunezgarcia/Developer/the-mountain";
  const surfaces: CmuxSurface[] = [
    { workspaceId: "CURSOR-WORKSPACE", surfaceId: "CURSOR-SURFACE", tty: "ttys008", cwd: duplicateCwd, sourceSessionIds: [] },
    { workspaceId: "OTHER-WORKSPACE", surfaceId: "OTHER-SURFACE", tty: "ttys009", cwd: duplicateCwd, sourceSessionIds: [] },
  ];

  test("recognizes only allowlisted Cursor store/transcript paths and resume argv", () => {
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
  });

  test("an open Cursor store maps the exact surface even when cwd is duplicated", async () => {
    const runner = new SequenceRunner([
      {
        exitCode: 0,
        stdout: [
          "201 ttys008 /Users/me/.local/bin/cursor-agent --resume",
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
