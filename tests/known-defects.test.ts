import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOmpJsonl, type ParseMetadata } from "../src/server/collectors";
import { collectCursorSessions, parseCursorSession } from "../src/server/cursor";
import { MemoryAttentionStore, parseCmuxNotifications } from "../src/server/cmux";
import { enrichCmuxIdentity } from "../src/server/identity";
import type { CmuxSurface, CollectedAgent, CommandResult, CommandRunner } from "../src/server/types";

/* Five defects found by mutation testing, each reproduced here before anyone
   fixes it, so the fix has something to turn green and nobody has to
   rediscover the trigger.

   All five live in src/server, which the backend lane owns. Nothing here edits
   that code. Each is a `test.failing`: it RUNS on every commit, passes while
   the defect is real so the shared suite stays green for the other lanes, and
   becomes a hard failure the moment the behaviour is fixed —

     "this test is marked as failing but it passed. Remove `.failing`"

   — which is the prompt to delete the marker and leave a permanent regression
   guard behind. It is not a skip. If a defect below is fixed and the marker is
   not removed, the build goes red and says so.

   Every `test.failing` is paired with passing controls. A defect test that
   throws for the wrong reason — a broken fixture, a renamed export, a path the
   code never reaches — would look identical to a real reproduction, so each
   control proves the fixture reaches the code and that the neighbouring
   behaviour works.

   ---------------------------------------------------------------------------
   WHY THIS FILE EXISTS IN THIS FORM

   Twice in the session that produced these, a test of mine looked correct and
   discriminated nothing, and both times it was caught only by mutating the
   implementation after writing the test. Once the URL parser normalised the
   traversal away before the handler ever saw it, so a path-containment test
   asserted on a request that could not reach the branch it named. Once three
   credential-parsing assertions held under mutation because a second, redundant
   guard covered the same input.

   A test that passes on both the correct and the broken implementation is worse
   than no test, because it converts an absence of coverage into a false report
   of coverage. Writing the assertion is not the work; proving it can fail is.
   --------------------------------------------------------------------------- */

const NOW_MS = Date.parse("2026-08-02T10:00:00.000Z");
const CURSOR_SESSION = "6514e366-df29-434b-979d-52a26168e188";
const GUI_SESSION = "a5336a9a-f434-4e7b-b8f0-a3c8509502cb";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    await rm(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ 1 ----- */

describe("DEFECT: cursor.ts dereferences metadata that parses to null", () => {
  const parse = (metaJson: string) =>
    parseCursorSession({ sessionId: CURSOR_SESSION, metaJson, nowMs: NOW_MS });

  test("literal null metadata is refused rather than throwing", () => {
    /* src/server/cursor.ts, parseCursorSession.

       JSON.parse("null") SUCCEEDS, so the try/catch around it never fires, and
       the next line reads meta.hasConversation off null. Every other non-object
       shape is refused cleanly — [] "str" 42 true {} — which is itself evidence
       the guard was meant to cover this one. */
    expect(() => parse("null")).not.toThrow();
    expect(parse("null")).toBeNull();
  });

  test("every other non-object shape is already refused", () => {
    // The control. It localises the defect to `null` specifically rather than
    // to non-object metadata in general.
    for (const shape of ["[]", '"a string"', "42", "true", "{}"]) {
      expect(parse(shape)).toBeNull();
    }
  });

  test("well-formed metadata is still admitted", () => {
    // Without this the assertions above would pass on a parser that refused
    // everything and emptied the Cursor half of the board.
    const agent = parse(JSON.stringify({
      hasConversation: true, cwd: "/Users/me/project",
      createdAtMs: NOW_MS - 600_000, updatedAtMs: NOW_MS - 30_000,
    }));
    expect(agent).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ 2 ----- */

describe("DEFECT: collectors.ts undercounts OMP tokens past a corrupt record", () => {
  const meta: ParseMetadata = { sourcePath: "/tmp/s.jsonl", mtimeMs: NOW_MS };
  const head = JSON.stringify({ type: "session", id: "s1", cwd: "/tmp/proj", timestamp: "2026-07-21T21:00:00.000Z" });
  const msg = (usage: unknown) => JSON.stringify({
    type: "message", timestamp: "2026-07-21T22:00:00.000Z",
    message: { role: "assistant", model: "claude-opus-4-8", content: "hi", usage },
  });
  const good = (n: number) => ({ input: n, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: n });
  // Realistic corruption: a locale-formatted number Number() cannot read.
  const UNREADABLE = { input: 2000, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: "1,234" };

  const clean = () => parseOmpJsonl([head, msg(good(1000)), msg(good(3000))].join("\n"), meta);
  const corrupt = () => parseOmpJsonl([head, msg(good(1000)), msg(UNREADABLE), msg(good(3000))].join("\n"), meta);

  test.failing("a dropped usage record does not pass as a smaller honest total", () => {
    /* src/server/collectors.ts, createOmpParser: the Number.isFinite guard
       `continue`s past an unreadable usage record.

       The corrupt session burned strictly MORE than the clean one — the same
       two good records plus a third the parser could not read — yet both report
       sessionTotal 4000 with provenance "observed". The outputs are identical,
       so a lossy read is indistinguishable from a complete one.

       The guard is what makes it silent: skipping turns corruption into a
       believable smaller number. Claude's parser has no such guard and
       propagates NaN, which serialises to null and renders "not reported" —
       loud, and correct. */
    expect(corrupt()?.tokens).not.toEqual(clean()?.tokens);
  });

  test.failing("a session with unreadable usage does not claim clean observation", () => {
    // Either the total accounts for every record, or provenance stops saying
    // "observed". Doing neither is the defect.
    expect(corrupt()?.tokens.provenance).not.toBe("observed");
  });

  test("the clean transcript itself parses correctly", () => {
    // Control: proves the fixture reaches the accumulator at all.
    expect(clean()?.tokens.sessionTotal).toBe(4_000);
    expect(clean()?.tokens.provenance).toBe("observed");
  });
});

/* ------------------------------------------------------------------ 3 ----- */

describe("DEFECT: cmux.ts backdates an unreadable notification to the epoch", () => {
  const wire = (overrides: Record<string, unknown>) => JSON.stringify([
    { id: "n1", surface_id: "SURF-A", workspace_id: "W", title: "Agent needs you", ...overrides },
  ]);

  test("an unparseable created_at is not backdated to the epoch", () => {
    /* src/server/cmux.ts, parseCmuxNotifications.

       1970 is not a neutral default. Acknowledging a surface records
       `throughAt: notification.createdAt`, and filter() keeps only
       notifications NEWER than it, so the epoch is the one value guaranteed to
       lose that comparison forever. */
    expect(parseCmuxNotifications(wire({ created_at: "yesterday" }))[0]?.createdAt)
      .not.toBe("1970-01-01T00:00:00.000Z");
  });

  test("an unread notification survives an unreadable timestamp", async () => {
    /* The operator-facing harm. The surface was cleared once; a NEW
       notification arrives — the agent is asking for a human right now — but
       its timestamp will not parse, so it is stamped 1970 and silently
       suppressed. The board says nothing.

       For a cockpit whose whole job is surfacing what needs attention, a parse
       failure that renders as "nobody needs you" is the most expensive silence
       available. */
    const store = new MemoryAttentionStore(() => NOW_MS);
    store.observe(parseCmuxNotifications(wire({ created_at: "2026-08-02T09:00:00.000Z" })));
    await store.apply("SURF-A", "acknowledge");

    const arriving = parseCmuxNotifications(wire({ id: "n9", created_at: "yesterday" }));
    store.observe(arriving);
    expect(store.filter(arriving)).toHaveLength(1);
  });

  test("the same notification with a readable timestamp does reach the operator", async () => {
    /* The control, and it isolates the variable: identical flow, parseable
       stamp. It proves the test above measures the timestamp and not the
       acknowledgement. */
    const store = new MemoryAttentionStore(() => NOW_MS);
    store.observe(parseCmuxNotifications(wire({ created_at: "2026-08-02T09:00:00.000Z" })));
    await store.apply("SURF-A", "acknowledge");

    const arriving = parseCmuxNotifications(wire({ id: "n9", created_at: "2026-08-02T09:59:00.000Z" }));
    store.observe(arriving);
    expect(store.filter(arriving)).toHaveLength(1);
  });

  test("a notification with no surface id is not dropped without a trace", () => {
    // A flatMap returns [] for it, so the unread count silently shrinks.
    // Whatever the right handling is — attribute it, or report it — vanishing
    // is not it.
    expect(parseCmuxNotifications(JSON.stringify([
      { id: "n2", title: "Agent needs you", created_at: "2026-08-02T09:59:00.000Z" },
    ]))).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ 4 ----- */

describe("DEFECT: identity.ts reports a running process dead for an unfamiliar name", () => {
  class SequenceRunner implements CommandRunner {
    constructor(private readonly results: CommandResult[]) {}
    async run(): Promise<CommandResult> {
      return this.results.shift() ?? { exitCode: 0, stdout: "", stderr: "", timedOut: false };
    }
  }

  const SURFACE: CmuxSurface = { workspaceId: "W", surfaceId: "S", paneId: "P", tty: "ttys033", sourceSessionIds: [] };
  const withKnownPid = (): CollectedAgent => ({
    id: "codex:s1", provider: "codex", sourceSessionId: "s1", displayName: "Worker",
    status: "running", statusReason: "x", updatedAt: "2026-08-02T10:00:00.000Z",
    tokens: { provenance: "unknown" }, artifacts: [], gates: [], processIds: [4242],
  });

  async function livenessFor(processTable: string): Promise<boolean | undefined> {
    const agent = withKnownPid();
    await enrichCmuxIdentity([SURFACE], [agent], new SequenceRunner([
      { exitCode: 0, stdout: processTable, stderr: "", timedOut: false },
      { exitCode: 0, stdout: "", stderr: "", timedOut: false },
    ]));
    return agent.processAlive;
  }

  test.failing("a running pid with an unrecognized command is not scored as dead", async () => {
    /* src/server/identity.ts: liveness is scored against
       allProcesses.filter(isRecognizedAgentProcess) rather than the process
       table itself, and snapshot-agent turns processAlive===false plus known
       pids into "died".

       pid 4242 is present and RUNNING; only the binary name changed, which a
       CLI rename is enough to do. The operator chases a phantom crash while the
       real agent keeps working unwatched.

       This is a false alarm rather than a false calm, but it shares its root
       with the other four: absent evidence treated as positive evidence. "Not
       alive" is a claim that needs the pid to be missing, not merely
       unfamiliar. */
    expect(await livenessFor("  4242 ttys033  /usr/local/bin/codex-next --model x")).not.toBe(false);
  });

  test("a recognized binary that is running reads as alive", async () => {
    // Control: the fixture wiring detects liveness at all.
    expect(await livenessFor("  4242 ttys033  codex --model x")).toBe(true);
  });

  test("a pid that is genuinely gone reads as not alive", async () => {
    // Control: "died" stays reachable, or the assertion above is vacuous.
    expect(await livenessFor("  9999 ttys033  something-else")).toBe(false);
  });
});

/* ------------------------------------------------------------------ 5 ----- */

describe("DEFECT: cursor.ts swallows an unreadable subagents directory", () => {
  async function cursorHome(subagents: "directory" | "unreadable"): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "anthill-subagents-"));
    temporaryDirectories.push(root);
    const globalStorage = join(root, "Library", "Application Support", "Cursor", "User", "globalStorage");
    const projectId = "378abb0f-fefb-4ae9-bdf3-754920b7b4fe";
    const projectDirectory = join(root, ".cursor", "projects", "Users-me-elio-intelligence-suite");
    const transcriptDirectory = join(projectDirectory, "agent-transcripts", GUI_SESSION);
    await mkdir(transcriptDirectory, { recursive: true });
    await mkdir(globalStorage, { recursive: true });

    await writeFile(join(transcriptDirectory, `${GUI_SESSION}.jsonl`), [
      JSON.stringify({ role: "user", message: { content: [{ type: "text", text: "Coordinate the swarm." }] } }),
      JSON.stringify({ type: "turn_ended", status: "success" }),
    ].join("\n"));
    await utimes(join(transcriptDirectory, `${GUI_SESSION}.jsonl`), new Date(1784691238958), new Date(1784691238958));

    const subagentsPath = join(transcriptDirectory, "subagents");
    if (subagents === "unreadable") {
      // A plain file yields ENOTDIR from readdir on every platform, with no
      // chmod or root dependency. Any non-ENOENT failure behaves the same.
      await writeFile(subagentsPath, "not a directory");
    } else {
      await mkdir(subagentsPath, { recursive: true });
      const childPath = join(subagentsPath, `${CURSOR_SESSION}.jsonl`);
      await writeFile(childPath, [
        JSON.stringify({ role: "user", message: { content: "Goal: Verify the build." } }),
        JSON.stringify({ role: "assistant", message: { content: [{ type: "text", text: "Build verified." }] } }),
        JSON.stringify({ type: "turn_ended", status: "success" }),
      ].join("\n"));
      await utimes(childPath, new Date(1784692000000 - 60_000), new Date(1784692000000 - 60_000));
    }

    const state = new Database(join(globalStorage, "state.vscdb"));
    state.run("create table ItemTable (key text primary key, value blob)");
    state.run("insert into ItemTable(key, value) values (?, ?)", ["glass.localAgentProjectMembership.v1", JSON.stringify({ [GUI_SESSION]: projectId, [CURSOR_SESSION]: projectId })]);
    state.run("insert into ItemTable(key, value) values (?, ?)", ["glass.localAgentProjects.v1", JSON.stringify([{ id: projectId, workspace: { id: "w", uri: { fsPath: "/Users/me/elio-intelligence-suite" } } }])]);
    state.run("create table cursorDiskKV (key text primary key, value blob)");
    state.close();

    const conversations = new Database(join(globalStorage, "conversation-search.db"));
    conversations.run("create table conversations (fts_rowid integer primary key, source text not null, scope text not null, id text not null, title text not null, updated_at integer not null, is_archived integer not null, root_fingerprint text, cache_fingerprint text)");
    conversations.run("insert into conversations(source, scope, id, title, updated_at, is_archived, root_fingerprint) values ('local', '', ?, ?, ?, 0, 'fingerprint')", [GUI_SESSION, "Swarm parent", 1784691238958]);
    conversations.close();
    return root;
  }

  test.failing("an unreadable subagents directory is reported as a collection error", async () => {
    /* src/server/cursor.ts: collectCursorChildSessions bare-catches readdir and
       returns [], and transcriptEvidence does the same and returns
       subagentCount: 0. Neither records anything.

       Measured: with the directory readable the collector returns parent AND
       child with subagentCount 1; with it unreadable the child is GONE,
       subagentCount reads 0, and errors is empty. A live subagent is removed
       from the roster, the parent reports zero descendants, and the board still
       says Operational.

       ENOENT — a parent with genuinely no subagents — is the common case and
       legitimately 0, which is why the bare catch exists. It conflates that
       with EACCES, ENOTDIR and EMFILE. Every sibling failure path in the same
       file pushes to errors. */
    const result = await collectCursorSessions(await cursorHome("unreadable"), 1784692000000);
    expect(result.errors.join(" ")).toContain("subagents");
  });

  test.failing("an unreadable directory does not report zero descendants", async () => {
    // 0 is the right answer for a parent that genuinely has none. A directory
    // that could not be read must not borrow that same confident 0.
    const result = await collectCursorSessions(await cursorHome("unreadable"), 1784692000000);
    const parent = result.value.find(({ id }) => id === `cursor:${GUI_SESSION}`);
    expect(parent?.subagentCount).not.toBe(0);
  });

  test("a readable subagents directory yields the child and one descendant", async () => {
    /* The control, and the measurement the defect is defined against. It also
       proves this elaborate fixture actually reaches tier-one collection —
       an earlier draft collected no agents at all and would have "reproduced"
       the defect by reaching none of the code. */
    const result = await collectCursorSessions(await cursorHome("directory"), 1784692000000);
    const parent = result.value.find(({ id }) => id === `cursor:${GUI_SESSION}`);

    expect(result.value.some(({ id }) => id === `cursor:${CURSOR_SESSION}`)).toBe(true);
    expect(parent?.subagentCount).toBe(1);
    expect(result.errors).toEqual([]);
  });
});
