import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { executeControl } from "../src/server/control";
import {
  enrichCmuxIdentity,
  identityFromSessionPath,
  parseProcessTable,
  isRecognizedAgentProcess,
} from "../src/server/identity";
import { controlsFor } from "../src/server/snapshot-agent";
import { canWriteToTarget, resolveAgentTarget } from "../src/server/targets";
import type { AgentSnapshot } from "../src/shared/types";
import type {
  CmuxSurface,
  CollectedAgent,
  CommandResult,
  CommandRunner,
} from "../src/server/types";

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dir, "fixtures", name), "utf8");

class SequenceRunner implements CommandRunner {
  readonly commands: string[][] = [];
  constructor(private readonly results: CommandResult[]) {}
  async run(command: readonly string[]): Promise<CommandResult> {
    this.commands.push([...command]);
    return this.results.shift() ?? { exitCode: 0, stdout: "", stderr: "", timedOut: false };
  }
}

const agent: CollectedAgent = {
  id: "omp:019f86c4-1558-7000-aeb8-26e2cfd0e8ec",
  provider: "omp",
  sourceSessionId: "019f86c4-1558-7000-aeb8-26e2cfd0e8ec",
  displayName: "Health tester",
  status: "running",
  statusReason: "Fixture activity is recent.",
  updatedAt: "2026-07-21T23:00:00.000Z",
  tokens: { provenance: "unknown" },
  artifacts: [],
  gates: [],
};

const surface: CmuxSurface = {
  workspaceId: "WORKSPACE-HEALTH",
  surfaceId: "SURFACE-HEALTH",
  paneId: "PANE-HEALTH",
  tty: "ttys033",
  sourceSessionIds: [],
};

describe("TTY and open-session identity evidence", () => {
  test("the process table is read with start times, in a locale that renders them predictably", async () => {
    const runner = new SequenceRunner([
      { exitCode: 0, stdout: "", stderr: "", timedOut: false },
    ]);
    await enrichCmuxIdentity([surface], [agent], runner);
    /* A pid is only checkable against a start time, so the scan has to ask for
       one — and `ps` renders `lstart` per locale, so it has to pin the locale
       it is parsed against. Still ONE ps: a second call would shift every
       positional expectation in the runners that drive this function. */
    expect(runner.commands[0]).toEqual([
      "env", "LC_ALL=C", "ps", "-axo", "pid=,tty=,lstart=,command=",
    ]);
  });

  test("the process table parses with or without a start-time column", () => {
    const dated = parseProcessTable(
      " 202 ttys033 Wed Aug  5 16:36:08 2026 /Users/me/.local/bin/claude --resume abc",
    );
    expect(dated[0]).toMatchObject({
      pid: 202,
      tty: "ttys033",
      command: "/Users/me/.local/bin/claude --resume abc",
    });
    expect(dated[0]?.startSeconds).toBe(Math.floor(Date.parse("Wed Aug  5 16:36:08 2026") / 1_000));

    /* Fixtures predate the column, and an unexpected locale must degrade to "no
       start time" rather than slicing a date onto the front of the command —
       a corrupted command breaks every attribution path downstream. */
    const undated = parseProcessTable(" 202 ttys033 /Users/me/.local/bin/claude --resume abc");
    expect(undated[0]).toMatchObject({ command: "/Users/me/.local/bin/claude --resume abc" });
    expect(undated[0]?.startSeconds).toBeUndefined();

    const foreign = parseProcessTable(" 202 ttys033 mie ago  5 16:36:08 2026 /usr/bin/omp");
    expect(foreign[0]?.startSeconds).toBeUndefined();
  });

  test("attributed pids carry the start time that makes them re-checkable", async () => {
    const target: CollectedAgent = {
      ...agent,
      processIds: undefined,
      processAlive: undefined,
      processStarts: undefined,
    };
    const runner = new SequenceRunner([
      {
        exitCode: 0,
        stdout: " 4242 ttys033 Wed Aug  5 16:36:08 2026 /Users/me/.local/bin/omp -p",
        stderr: "",
        timedOut: false,
      },
      {
        exitCode: 0,
        stdout: [
          "p4242",
          "n/Users/me/.omp/agent/sessions/project/run_019f86c4-1558-7000-aeb8-26e2cfd0e8ec.jsonl",
        ].join("\n"),
        stderr: "",
        timedOut: false,
      },
    ]);

    await enrichCmuxIdentity([surface], [target], runner);

    expect(target.processIds).toEqual([4242]);
    expect(target.processStarts?.[4242])
      .toBe(Math.floor(Date.parse("Wed Aug  5 16:36:08 2026") / 1_000));
  });

  test("the open-file probe never asks the resolver to name a socket peer", async () => {
    /* THE DEFECT, 2026-08-13. Identity spent ~9.3s of the board's 10s deadline,
       and 4.7s of that was one lsof call. lsof reverse-DNSes the remote address
       of every socket it reports unless told not to, and an agent process holds
       many sockets to API endpoints whose peers resolve slowly or never.

       Measured on this fleet against one socket-heavy daemon: 20.066s without
       `-n`, 0.055s with it. 365x. At 0% CPU for those 20 seconds — blocked on
       the resolver, not working.

       It buys nothing: this probe reads `-Fn` output for session FILE PATHS, so
       a hostname can never match one. And it costs the operator their controls,
       because identity gates Send and Interrupt fleet-wide — when this probe
       runs long the board withdraws every terminal target.

       Asserted on the flags rather than on a duration, because a timing test
       would pass on any machine whose resolver happens to be fast. */
    const runner = new SequenceRunner([
      { exitCode: 0, stdout: fixture("process-table.txt"), stderr: "", timedOut: false },
      { exitCode: 0, stdout: fixture("open-files.txt"), stderr: "", timedOut: false },
    ]);

    await enrichCmuxIdentity([surface], [agent], runner);

    const lsof = runner.commands.find((command) => command[0]?.endsWith("lsof"));
    expect(lsof, "the open-file probe did not run").toBeDefined();
    expect(lsof, "lsof without -n reverse-DNSes every socket peer it reports").toContain("-n");
    expect(lsof, "lsof without -P looks every port up in /etc/services").toContain("-P");
  });

  test("lsof targets only recognized agent processes while command hints still inspect the whole tty", () => {
    expect(isRecognizedAgentProcess("-zsh")).toBeFalse();
    expect(isRecognizedAgentProcess("/usr/bin/login -pflq user /bin/zsh")).toBeFalse();
    expect(isRecognizedAgentProcess("/Users/me/.local/bin/omp -p --model anthropic/claude-fable-5")).toBeTrue();
    expect(isRecognizedAgentProcess("codex resume 019f86c4-1558-7000-aeb8-26e2cfd0e8ec")).toBeTrue();
    expect(isRecognizedAgentProcess("/tmp/cmux-agent-resume/omp-019f86c4.zsh")).toBeTrue();
  });

  test("only recognized OMP, Codex, and Claude session paths yield exact identities", () => {
    expect(
      identityFromSessionPath(
        "/Users/me/.omp/agent/sessions/project/run_019f86c4-1558-7000-aeb8-26e2cfd0e8ec.jsonl",
      ),
    ).toMatchObject({ provider: "omp", value: "019f86c4-1558-7000-aeb8-26e2cfd0e8ec", full: true });
    expect(
      identityFromSessionPath(
        "/Users/me/.codex/sessions/2026/07/21/rollout-2026-07-21T23-00-00-019f86c4-1558-7000-aeb8-26e2cfd0e8ec.jsonl",
      ),
    ).toMatchObject({ provider: "codex", value: "019f86c4-1558-7000-aeb8-26e2cfd0e8ec", full: true });
    expect(
      identityFromSessionPath(
        "/Users/me/.claude/projects/project/019f86c4-1558-7000-aeb8-26e2cfd0e8ec.jsonl",
      ),
    ).toMatchObject({ provider: "claude", value: "019f86c4-1558-7000-aeb8-26e2cfd0e8ec", full: true });
    expect(
      identityFromSessionPath(
        "/private/tmp/fake_019f86c4-1558-7000-aeb8-26e2cfd0e8ec.jsonl",
      ),
    ).toBeNull();
    expect(identityFromSessionPath("/Users/me/.omp/agent/sessions/project/not-a-uuid.jsonl")).toBeNull();
  });

  test("an open recognized session file attaches its exact ID while unrelated UUID files are ignored", async () => {
    const runner = new SequenceRunner([
      { exitCode: 0, stdout: fixture("process-table.txt"), stderr: "", timedOut: false },
      { exitCode: 0, stdout: fixture("open-files.txt"), stderr: "", timedOut: false },
    ]);

    const enriched = await enrichCmuxIdentity([surface], [agent], runner);

    expect(enriched.errors).toEqual([]);
    expect(runner.commands[1]).toEqual(["/usr/sbin/lsof", "-n", "-P", "-a", "-p", "4242", "-Fn"]);
    expect(enriched.value[0]?.sourceSessionIds).toEqual([
      "019f86c4-1558-7000-aeb8-26e2cfd0e8ec",
    ]);
    expect(enriched.value[0]?.sourceSessionIds).not.toContain(
      "11111111-2222-3333-4444-555555555555",
    );
    expect(agent).toMatchObject({
      processIds: [4242],
      processAlive: true,
      transcriptOpen: true,
    });
  });

  test("Claude evidence cannot authorize an active Codex session with the same UUID", async () => {
    const collisionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const claude: CollectedAgent = {
      ...agent,
      id: `claude:${collisionId}`,
      provider: "claude",
      sourceSessionId: collisionId,
    };
    const codex: CollectedAgent = {
      ...agent,
      id: `codex:${collisionId}`,
      provider: "codex",
      sourceSessionId: collisionId,
    };
    const runner = new SequenceRunner([
      {
        exitCode: 0,
        stdout: "202 ttys033 /Users/me/.local/bin/claude",
        stderr: "",
        timedOut: false,
      },
      {
        exitCode: 0,
        stdout: [
          "p202",
          `n/Users/me/.claude/projects/project/${collisionId}.jsonl`,
        ].join("\n"),
        stderr: "",
        timedOut: false,
      },
    ]);

    const enriched = await enrichCmuxIdentity([surface], [claude, codex], runner);
    const claudeTarget = resolveAgentTarget(claude, enriched.value, [claude, codex]);
    const codexTarget = resolveAgentTarget(codex, enriched.value, [claude, codex]);

    expect(claudeTarget).toMatchObject({ resolution: "exact", attestation: "live" });
    expect(canWriteToTarget(claudeTarget)).toBeTrue();
    expect(codexTarget).toMatchObject({ resolution: "missing" });
    expect(canWriteToTarget(codexTarget)).toBeFalse();
    const controls = controlsFor(codex, codexTarget, false);
    expect(controls).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "instruct", enabled: false }),
      expect.objectContaining({ action: "interrupt", enabled: false }),
    ]));
    const commands: string[][] = [];
    const snapshot: AgentSnapshot = {
      ...codex,
      programId: "fixture",
      lastHumanMessage: null,
      target: codexTarget,
      controls,
    };
    const control = await executeControl(
      { agentId: codex.id, action: "instruct", instruction: "do not send" },
      snapshot,
      {
        runner: {
          run: async (command) => {
            commands.push([...command]);
            return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
          },
        },
        archiveStore: { has: () => false, archive: async () => {} },
      },
    );
    expect(control.status).toBe(409);
    expect(commands).toEqual([]);
  });

  test("partial allowlisted lsof output remains usable when a target PID races away", async () => {
    const runner = new SequenceRunner([
      {
        exitCode: 0,
        stdout: [
          " 101 ttys033 -zsh",
          " 202 ttys033 /Users/me/.local/bin/omp -p --model anthropic/claude-fable-5",
        ].join("\n"),
        stderr: "",
        timedOut: false,
      },
      {
        exitCode: 1,
        stdout: [
          "p202",
          "n/Users/me/.omp/agent/sessions/project/run_019f86c4-1558-7000-aeb8-26e2cfd0e8ec.jsonl",
        ].join("\n"),
        stderr: "lsof: WARNING: can't stat() an unstattable mount",
        timedOut: false,
      },
    ]);

    const enriched = await enrichCmuxIdentity([surface], [agent], runner);

    expect(enriched.errors).toEqual([]);
    expect(runner.commands[1]).toEqual(["/usr/sbin/lsof", "-n", "-P", "-a", "-p", "202", "-Fn"]);
    expect(enriched.value[0]?.sourceSessionIds).toEqual([
      "019f86c4-1558-7000-aeb8-26e2cfd0e8ec",
    ]);
  });

  test("a Claude runtime session argument resolves to its unique active transcript source", async () => {
    const runtimeSessionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const claude: CollectedAgent = {
      ...agent,
      id: "claude:11111111-2222-3333-4444-555555555555",
      provider: "claude",
      sourceSessionId: "11111111-2222-3333-4444-555555555555",
      runtimeSessionId,
    };
    const runner = new SequenceRunner([
      {
        exitCode: 0,
        stdout: `202 ttys033 /Users/me/.local/bin/claude --resume ${runtimeSessionId}`,
        stderr: "",
        timedOut: false,
      },
      { exitCode: 0, stdout: "", stderr: "", timedOut: false },
    ]);

    const enriched = await enrichCmuxIdentity([surface], [claude], runner);

    expect(enriched.errors).toEqual([]);
    expect(enriched.value[0]?.sourceSessionIds).toEqual([claude.sourceSessionId]);
    expect(enriched.value[0]?.identityTrace).toMatchObject({
      outcome: "command-hint-match",
      commandHints: [{
        pid: 202,
        value: runtimeSessionId,
        resolvedSessionId: claude.sourceSessionId,
      }],
    });
    expect(claude).toMatchObject({
      processIds: [202],
      processAlive: true,
    });
  });

  test("a resumed Claude source prefers the exact source session over its runtime alias", async () => {
    const runtimeSessionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const original: CollectedAgent = {
      ...agent,
      id: `claude:${runtimeSessionId}`,
      provider: "claude",
      sourceSessionId: runtimeSessionId,
      runtimeSessionId,
    };
    const resumed: CollectedAgent = {
      ...original,
      id: "claude:bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
      sourceSessionId: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
    };
    const runner = new SequenceRunner([
      {
        exitCode: 0,
        stdout: `202 ttys033 /Users/me/.local/bin/claude --resume ${runtimeSessionId}`,
        stderr: "",
        timedOut: false,
      },
      { exitCode: 0, stdout: "", stderr: "", timedOut: false },
    ]);

    const enriched = await enrichCmuxIdentity([surface], [original, resumed], runner);

    expect(enriched.errors).toEqual([]);
    expect(enriched.value[0]?.sourceSessionIds).toEqual([runtimeSessionId]);
    expect(enriched.value[0]?.identityTrace).toMatchObject({
      outcome: "command-hint-match",
      commandHints: [{ resolvedSessionId: runtimeSessionId }],
    });
  });

  test("a completed process scan marks retained exact PIDs absent without guessing on probe failure", async () => {
    const retained: CollectedAgent = {
      ...agent,
      processIds: [999],
      processAlive: true,
    };
    const runner = new SequenceRunner([
      {
        exitCode: 0,
        stdout: "202 ttys033 /Users/me/.local/bin/omp -p",
        stderr: "",
        timedOut: false,
      },
      { exitCode: 0, stdout: "", stderr: "", timedOut: false },
    ]);

    await enrichCmuxIdentity([surface], [retained], runner);

    expect(retained).toMatchObject({
      processIds: [999],
      processAlive: false,
    });
  });

  test("a Claude runtime session shared by active sources quarantines instead of guessing", async () => {
    const runtimeSessionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const first: CollectedAgent = {
      ...agent,
      id: "claude:11111111-2222-3333-4444-555555555555",
      provider: "claude",
      sourceSessionId: "11111111-2222-3333-4444-555555555555",
      runtimeSessionId,
    };
    const second: CollectedAgent = {
      ...first,
      id: "claude:22222222-3333-4444-5555-666666666666",
      sourceSessionId: "22222222-3333-4444-5555-666666666666",
    };
    const runner = new SequenceRunner([
      {
        exitCode: 0,
        stdout: `202 ttys033 /Users/me/.local/bin/claude --resume ${runtimeSessionId}`,
        stderr: "",
        timedOut: false,
      },
      { exitCode: 0, stdout: "", stderr: "", timedOut: false },
    ]);

    const enriched = await enrichCmuxIdentity([surface], [first, second], runner);

    expect(enriched.value[0]?.sourceSessionIds).toEqual([]);
    expect(enriched.value[0]?.identityConflict).toContain("multiple active Claude sources");
    expect(enriched.value[0]?.identityTrace?.outcome).toBe("command-hint-conflict");
  });

  test("a process lookup timeout is surfaced and fails identity enrichment closed", async () => {
    const retained = { ...agent, processIds: [4242], processAlive: true };
    const runner = new SequenceRunner([
      { exitCode: 0, stdout: "", stderr: "deadline", timedOut: true },
    ]);

    const enriched = await enrichCmuxIdentity([surface], [retained], runner);

    expect(enriched.errors).toEqual(["process identity lookup timed out"]);
    expect(enriched.value[0]?.sourceSessionIds).toEqual([]);
    expect(enriched.value[0]?.identityTrace).toMatchObject({ outcome: "probe-failed" });
    expect(retained.processAlive).toBeTrue();
  });

  test("a timed-out open-session lookup rejects truncated identity evidence and quarantines the surface", async () => {
    const runner = new SequenceRunner([
      {
        exitCode: 0,
        stdout: "202 ttys033 /Users/me/.local/bin/omp -p",
        stderr: "",
        timedOut: false,
      },
      {
        exitCode: 0,
        stdout: [
          "p202",
          "n/Users/me/.omp/agent/sessions/project/run_019f86c4-1558-7000-aeb8-26e2cfd0e8ec.jsonl",
        ].join("\n"),
        stderr: "deadline",
        timedOut: true,
      },
    ]);

    const enriched = await enrichCmuxIdentity(
      [{ ...surface, cwd: "/Users/me/project", sourceSessionIds: [agent.sourceSessionId] }],
      [{ ...agent, cwd: "/Users/me/project" }],
      runner,
    );

    expect(enriched.errors).toEqual(["open-session identity lookup timed out"]);
    expect(enriched.value[0]?.sourceSessionIds).toEqual([]);
    expect(enriched.value[0]?.identityTrace).toMatchObject({
      outcome: "probe-failed",
      openFileMatches: [],
      sourceSessionIds: [],
    });
    expect(resolveAgentTarget({ ...agent, cwd: "/Users/me/project" }, enriched.value).resolution).toBe("ambiguous");
  });

  test("a conflict on a tty-less surface names no location instead of 'undefined'", async () => {
    const runner = new SequenceRunner([
      {
        exitCode: 0,
        stdout: JSON.stringify([{ kind: "process", cmux_surface_id: "SURFACE-NOTTY", pid: 202 }]),
        stderr: "",
        timedOut: false,
      },
      {
        exitCode: 0,
        stdout: "202 ?? /Users/me/.local/bin/omp -p",
        stderr: "",
        timedOut: false,
      },
      {
        exitCode: 0,
        stdout: [
          "p202",
          "n/Users/me/.omp/agent/sessions/project/run_019f86c4-1558-7000-aeb8-26e2cfd0e8ec.jsonl",
          "n/Users/me/.omp/agent/sessions/project/run_11111111-2222-3333-4444-555555555555.jsonl",
        ].join("\n"),
        stderr: "",
        timedOut: false,
      },
    ]);

    const enriched = await enrichCmuxIdentity(
      [{ ...surface, surfaceId: "SURFACE-NOTTY", tty: undefined, sourceSessionIds: [agent.sourceSessionId] }],
      [agent],
      runner,
    );

    const conflict = enriched.value[0]?.identityConflict;
    expect(conflict).toBe("cmux SURFACE-NOTTY has conflicting open agent session files");
    expect(conflict).not.toContain("undefined");
    expect(enriched.errors.some((error) => error.includes("undefined"))).toBeFalse();
  });

  test("conflicting allowlisted open sessions remain fail-closed", async () => {
    const runner = new SequenceRunner([
      {
        exitCode: 0,
        stdout: "202 ttys033 /Users/me/.local/bin/omp -p",
        stderr: "",
        timedOut: false,
      },
      {
        exitCode: 0,
        stdout: [
          "p202",
          "n/Users/me/.omp/agent/sessions/project/run_019f86c4-1558-7000-aeb8-26e2cfd0e8ec.jsonl",
          "n/Users/me/.omp/agent/sessions/project/run_11111111-2222-3333-4444-555555555555.jsonl",
        ].join("\n"),
        stderr: "",
        timedOut: false,
      },
    ]);

    const enriched = await enrichCmuxIdentity(
      [{ ...surface, sourceSessionIds: [agent.sourceSessionId] }],
      [agent],
      runner,
    );

    expect(enriched.value[0]?.sourceSessionIds).toEqual([]);
    expect(enriched.value[0]?.identityConflict).toContain("conflicting open agent session files");
    expect(enriched.errors[0]).toContain("conflicting open agent session files");
    expect(
      resolveAgentTarget(
        { ...agent, cwd: "/Users/emilionunezgarcia/Developer/unique-project" },
        [{ ...enriched.value[0], cwd: "/Users/emilionunezgarcia/Developer/unique-project" }],
      ),
    ).toMatchObject({
      resolution: "ambiguous",
      reason: expect.stringContaining("quarantined"),
    });
  });

  test("a parent rollout and its open guardian child resolve to the root identity", async () => {
    const parent: CollectedAgent = {
      ...agent,
      provider: "codex",
      id: "codex:019f86c4-1558-7000-aeb8-26e2cfd0e8ec",
      sourceSessionId: "019f86c4-1558-7000-aeb8-26e2cfd0e8ec",
      processIds: undefined,
      processAlive: undefined,
      transcriptOpen: undefined,
    };
    const child: CollectedAgent = {
      ...parent,
      id: "codex:11111111-2222-3333-4444-555555555555",
      sourceSessionId: "11111111-2222-3333-4444-555555555555",
      parentSourceSessionId: parent.sourceSessionId,
    };
    const runner = new SequenceRunner([
      {
        exitCode: 0,
        stdout: "202 ttys033 /Users/me/.local/bin/codex",
        stderr: "",
        timedOut: false,
      },
      {
        exitCode: 0,
        stdout: [
          "p202",
          "n/Users/me/.codex/sessions/2026/07/21/rollout-2026-07-21T23-00-00-019f86c4-1558-7000-aeb8-26e2cfd0e8ec.jsonl",
          "n/Users/me/.codex/sessions/2026/07/21/rollout-2026-07-21T23-01-00-11111111-2222-3333-4444-555555555555.jsonl",
        ].join("\n"),
        stderr: "",
        timedOut: false,
      },
    ]);

    const enriched = await enrichCmuxIdentity([surface], [parent, child], runner);

    expect(enriched.errors).toEqual([]);
    /* The SURFACE still resolves to the root alone — that is what this test is
       named for, and it is unchanged. One pane, one owner. */
    expect(enriched.value[0]?.sourceSessionIds).toEqual([parent.sourceSessionId]);
    expect(enriched.value[0]?.identityConflict).toBeUndefined();
    expect(parent).toMatchObject({ processIds: [202], processAlive: true });

    /* LIVENESS, deliberately rewritten: this asserted the child had no process.
       Pid 202 holds the child's transcript open, so the child is being served
       right now, and "no process evidence" was never true of it — the old
       expectation was reading a pane-ownership answer as a liveness one.

       Harmless while nothing could end a session without pids; not harmless
       once a completed scan can. The child was quiet and processless, which is
       precisely the shape that now files as finished. Measured on this machine
       before the fix: 17 sessions running at that moment, called finished. */
    expect(child).toMatchObject({ processIds: [202], processAlive: true });
  });

  /* The shared-app-server population, measured on this machine 2026-08-05: one
     `codex ... app-server` (started 08:58) held 11 rollout transcripts open,
     with mtimes spanning 09:24-13:07, at 19:25. It never closes a transcript
     for the life of the process, so its open descriptors only accumulate — they
     prove the APP is running, never that any one session is. Thirteen board
     rows read "waiting · process live" off that single pid. */
  test("a shared app-server's open transcripts attribute a process without proving the session lives", async () => {
    const desktop = (id: string): CollectedAgent => ({
      ...agent,
      provider: "codex",
      id: `codex:${id}`,
      sourceSessionId: id,
      processIds: undefined,
      processAlive: undefined,
      transcriptOpen: undefined,
    });
    const first = desktop("019f86c4-1558-7000-aeb8-26e2cfd0e8ec");
    const second = desktop("11111111-2222-3333-4444-555555555555");
    const runner = new SequenceRunner([
      {
        exitCode: 0,
        stdout: "9644 ?? /Applications/ChatGPT.app/Contents/Resources/codex app-server --analytics-default-enabled",
        stderr: "",
        timedOut: false,
      },
      {
        exitCode: 0,
        stdout: [
          "p9644",
          "n/Users/me/.codex/sessions/2026/08/05/rollout-2026-08-05T09-24-00-019f86c4-1558-7000-aeb8-26e2cfd0e8ec.jsonl",
          "n/Users/me/.codex/sessions/2026/08/05/rollout-2026-08-05T13-07-00-11111111-2222-3333-4444-555555555555.jsonl",
        ].join("\n"),
        stderr: "",
        timedOut: false,
      },
    ]);

    await enrichCmuxIdentity([surface], [first, second], runner);

    for (const served of [first, second]) {
      /* The descriptor is real and stays on the row as evidence... */
      expect(served.processIds).toEqual([9644]);
      expect(served.transcriptOpen).toBeTrue();
      /* ...but it is not a claim that this session is alive. Unknown, not dead:
         asserting `false` here with a pid attached would read as "process
         checked and gone", which is the opposite lie. */
      expect(served.processAlive).toBeUndefined();
    }
  });

  test("a dedicated agent process still proves life for every session it serves", async () => {
    /* The guard above must key on the multiplexer, not on fan-out: a plain
       codex CLI legitimately holds a parent and its child transcript open, and
       measured here so does a real desktop-independent codex (2 apiece). */
    const dedicated = (id: string): CollectedAgent => ({
      ...agent,
      provider: "codex",
      id: `codex:${id}`,
      sourceSessionId: id,
      processIds: undefined,
      processAlive: undefined,
    });
    const parent = dedicated("019f86c4-1558-7000-aeb8-26e2cfd0e8ec");
    const child = dedicated("11111111-2222-3333-4444-555555555555");
    const runner = new SequenceRunner([
      { exitCode: 0, stdout: "202 ttys033 /Users/me/.local/bin/codex", stderr: "", timedOut: false },
      {
        exitCode: 0,
        stdout: [
          "p202",
          "n/Users/me/.codex/sessions/2026/07/21/rollout-2026-07-21T23-00-00-019f86c4-1558-7000-aeb8-26e2cfd0e8ec.jsonl",
          "n/Users/me/.codex/sessions/2026/07/21/rollout-2026-07-21T23-01-00-11111111-2222-3333-4444-555555555555.jsonl",
        ].join("\n"),
        stderr: "",
        timedOut: false,
      },
    ]);

    await enrichCmuxIdentity([surface], [parent, child], runner);

    expect(parent).toMatchObject({ processIds: [202], processAlive: true });
    expect(child).toMatchObject({ processIds: [202], processAlive: true });
  });

  /* Measured 2026-08-05: a claude session recorded pid 90614, whose start time
     no longer matches — the number now belongs to `sysextd`. The hook layer
     verified that and answered "gone", and this loop overturned it purely
     because some process still holds the number. */
  test("a recycled pid that is merely present does not overturn a start-time verdict of gone", async () => {
    const reused: CollectedAgent = {
      ...agent,
      provider: "claude",
      processIds: [90614],
      processAlive: false,
    };
    const runner = new SequenceRunner([
      {
        exitCode: 0,
        stdout: "90614 ?? /System/Library/Frameworks/SystemExtensions.framework/Versions/A/Helpers/sysextd",
        stderr: "",
        timedOut: false,
      },
    ]);

    await enrichCmuxIdentity([surface], [reused], runner);

    expect(reused.processAlive).toBeFalse();
  });

  test("cmux process attribution recovers exact identity when terminal discovery omits the tty", async () => {
    const parent: CollectedAgent = {
      ...agent,
      provider: "codex",
      id: "codex:019f86c4-1558-7000-aeb8-26e2cfd0e8ec",
      sourceSessionId: "019f86c4-1558-7000-aeb8-26e2cfd0e8ec",
    };
    const child: CollectedAgent = {
      ...parent,
      id: "codex:11111111-2222-3333-4444-555555555555",
      sourceSessionId: "11111111-2222-3333-4444-555555555555",
      parentSourceSessionId: parent.sourceSessionId,
    };
    const runner = new SequenceRunner([
      {
        exitCode: 0,
        stdout: JSON.stringify({
          windows: [{
            workspaces: [{
              surfaces: [{
                processes: [{
                  kind: "process",
                  pid: 202,
                  cmux_surface_id: surface.surfaceId,
                }],
              }],
            }],
          }],
        }),
        stderr: "",
        timedOut: false,
      },
      {
        exitCode: 0,
        stdout: "202 ?? /Users/me/.local/bin/codex",
        stderr: "",
        timedOut: false,
      },
      {
        exitCode: 0,
        stdout: [
          "p202",
          "n/Users/me/.codex/sessions/2026/07/21/rollout-2026-07-21T23-00-00-019f86c4-1558-7000-aeb8-26e2cfd0e8ec.jsonl",
          "n/Users/me/.codex/sessions/2026/07/21/rollout-2026-07-21T23-01-00-11111111-2222-3333-4444-555555555555.jsonl",
        ].join("\n"),
        stderr: "",
        timedOut: false,
      },
    ]);

    const enriched = await enrichCmuxIdentity(
      [{ ...surface, tty: undefined }],
      [parent, child],
      runner,
    );

    expect(enriched.errors).toEqual([]);
    expect(runner.commands[0]).toEqual([
      "/Applications/cmux.app/Contents/Resources/bin/cmux",
      "rpc",
      "system.top",
      JSON.stringify({ all_windows: true, include_processes: true }),
    ]);
    expect(runner.commands[2]).toEqual(["/usr/sbin/lsof", "-n", "-P", "-a", "-p", "202", "-Fn"]);
    expect(enriched.value[0]?.sourceSessionIds).toEqual([parent.sourceSessionId]);
    expect(enriched.value[0]?.identityTrace).toMatchObject({
      outcome: "open-file-match",
      processes: [{ pid: 202, recognizedAgentProcess: true }],
      sourceSessionIds: [parent.sourceSessionId],
    });
    expect(enriched.value[0]?.identityTrace?.notes?.[0]).toContain("exact cmux process attribution");
  });

  test("stale CMUX surfaces are cleared without becoming identity conflicts", async () => {
    const runner = new SequenceRunner([]);
    const enriched = await enrichCmuxIdentity(
      [{ ...surface, runtimeSurfaceReady: false, sourceSessionIds: [agent.sourceSessionId] }],
      [agent],
      runner,
    );

    expect(enriched.errors).toEqual([]);
    expect(enriched.value[0]?.sourceSessionIds).toEqual([]);
    expect(enriched.value[0]?.identityConflict).toBeUndefined();
    expect(runner.commands).toEqual([]);
  });
});
