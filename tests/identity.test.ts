import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  enrichCmuxIdentity,
  identityFromSessionPath,
  isRecognizedAgentProcess,
} from "../src/server/identity";
import { resolveAgentTarget } from "../src/server/targets";
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
    expect(runner.commands[1]).toEqual(["/usr/sbin/lsof", "-a", "-p", "4242", "-Fn"]);
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
    expect(runner.commands[1]).toEqual(["/usr/sbin/lsof", "-a", "-p", "202", "-Fn"]);
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
    expect(runner.commands[2]).toEqual(["/usr/sbin/lsof", "-a", "-p", "202", "-Fn"]);
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
