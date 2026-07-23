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
        stderr: "",
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
    expect(enriched.value[0]?.sourceSessionIds).toEqual([parent.sourceSessionId]);
    expect(enriched.value[0]?.identityConflict).toBeUndefined();
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
