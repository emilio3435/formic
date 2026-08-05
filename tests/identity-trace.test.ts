import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { enrichCmuxIdentity } from "../src/server/identity";
import { resolveAgentTarget, resolveAgentTargetWithTrace } from "../src/server/targets";
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

describe("surface identity evidence trace", () => {
  test("an lsof-confirmed link records tty, pids, commands, and the matched session path", async () => {
    const runner = new SequenceRunner([
      { exitCode: 0, stdout: fixture("process-table.txt"), stderr: "", timedOut: false },
      { exitCode: 0, stdout: fixture("open-files.txt"), stderr: "", timedOut: false },
    ]);

    const enriched = await enrichCmuxIdentity([surface], [agent], runner);
    const trace = enriched.value[0]?.identityTrace;

    expect(enriched.value[0]?.sourceSessionIds).toEqual([agent.sourceSessionId]);
    expect(trace).toMatchObject({
      surfaceId: "SURFACE-HEALTH",
      tty: "ttys033",
      outcome: "open-file-match",
      sourceSessionIds: [agent.sourceSessionId],
    });
    expect(trace?.processes).toEqual([
      { pid: 4242, command: "omp -p anthropic/claude-fable-5:high", recognizedAgentProcess: true },
    ]);
    // The unrelated /private/tmp UUID file is not a recognized session path.
    expect(trace?.openFileMatches).toEqual([
      {
        pid: 4242,
        path: "/Users/emilionunezgarcia/.omp/agent/sessions/-Developer-hd-master-health-tester-v2-20260721/2026-07-21T22-20-25-304Z_019f86c4-1558-7000-aeb8-26e2cfd0e8ec.jsonl",
        provider: "omp",
        sessionId: agent.sourceSessionId,
      },
    ]);
    expect(trace?.identityConflict).toBeUndefined();
  });

  test("a conflicting scan keeps the contradicting evidence in the trace", async () => {
    const runner = new SequenceRunner([
      { exitCode: 0, stdout: "202 ttys033 /Users/me/.local/bin/omp -p", stderr: "", timedOut: false },
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

    const enriched = await enrichCmuxIdentity([surface], [agent], runner);
    const trace = enriched.value[0]?.identityTrace;

    expect(trace?.outcome).toBe("open-file-conflict");
    expect(trace?.sourceSessionIds).toEqual([]);
    expect(trace?.identityConflict).toContain("conflicting open agent session files");
    expect(trace?.openFileMatches.map(({ sessionId }) => sessionId).sort()).toEqual([
      "019f86c4-1558-7000-aeb8-26e2cfd0e8ec",
      "11111111-2222-3333-4444-555555555555",
    ]);
  });

  test("command-line resume hints are retained with their prefix resolution", async () => {
    const runner = new SequenceRunner([
      {
        exitCode: 0,
        stdout: "301 ttys033 codex resume 019f86c4-1558-7000-aeb8-26e2cfd0e8ec",
        stderr: "",
        timedOut: false,
      },
      { exitCode: 0, stdout: "", stderr: "", timedOut: false },
    ]);
    const codexAgent: CollectedAgent = {
      ...agent,
      id: "codex:019f86c4-1558-7000-aeb8-26e2cfd0e8ec",
      provider: "codex",
    };

    const enriched = await enrichCmuxIdentity([surface], [codexAgent], runner);
    const trace = enriched.value[0]?.identityTrace;

    expect(trace?.outcome).toBe("command-hint-match");
    expect(trace?.commandHints).toEqual([
      {
        pid: 301,
        provider: "codex",
        value: codexAgent.sourceSessionId,
        full: true,
        resolvedSessionId: codexAgent.sourceSessionId,
      },
    ]);
    expect(trace?.sourceSessionIds).toEqual([codexAgent.sourceSessionId]);
  });
});

describe("target resolution trace", () => {
  const exactSurface: CmuxSurface = {
    ...surface,
    cwd: "/Users/emilionunezgarcia/Developer/unique-project",
    sourceSessionIds: [agent.sourceSessionId],
  };

  test("an exact session match records why the hook and recorded tiers passed and which surface matched", () => {
    const { target, trace } = resolveAgentTargetWithTrace(agent, [exactSurface]);

    expect(target.resolution).toBe("exact");
    expect(trace.matchedTier).toBe("session");
    expect(trace.resolution).toBe("exact");
    expect(trace.surfaceId).toBe("SURFACE-HEALTH");
    expect(trace.steps).toEqual([
      { tier: "hook-store", outcome: "skipped", detail: "No cmux hook-store record exists for this source session." },
      { tier: "recorded", outcome: "skipped", detail: "No recorded cmux target IDs on this source." },
      {
        tier: "session",
        outcome: "matched",
        detail: `Source session ID ${agent.sourceSessionId} recorded by cmux on surface SURFACE-HEALTH.`,
      },
    ]);
    // The trace never changes what resolveAgentTarget itself returns.
    expect(resolveAgentTarget(agent, [exactSurface])).toEqual(target);
  });

  test("a cwd fallback records the concrete reason each earlier tier passed", () => {
    const cwdAgent: CollectedAgent = { ...agent, cwd: "/Users/emilionunezgarcia/Developer/unique-project" };
    const unclaimed: CmuxSurface = { ...exactSurface, sourceSessionIds: [] };

    const { target, trace } = resolveAgentTargetWithTrace(cwdAgent, [unclaimed]);

    expect(target.resolution).toBe("unique-cwd");
    expect(trace.matchedTier).toBe("cwd");
    expect(trace.steps.map(({ tier, outcome }) => `${tier}:${outcome}`)).toEqual([
      "hook-store:skipped",
      "recorded:skipped",
      "session:no-match",
      "cwd:matched",
    ]);
    expect(trace.steps[3]?.detail).toContain("only unclaimed surface");
  });

  test("duplicate-cwd sources stay ambiguous and the trace says exactly why", () => {
    const cwdAgent: CollectedAgent = { ...agent, cwd: "/Users/emilionunezgarcia/Developer/unique-project" };
    const sibling: CollectedAgent = {
      ...cwdAgent,
      id: "claude:22222222-2222-4222-8222-222222222222",
      provider: "claude",
      sourceSessionId: "22222222-2222-4222-8222-222222222222",
      status: "waiting",
    };
    const unclaimed: CmuxSurface = { ...exactSurface, sourceSessionIds: [] };

    const { target, trace } = resolveAgentTargetWithTrace(cwdAgent, [unclaimed], [cwdAgent, sibling]);

    expect(target.resolution).toBe("ambiguous");
    expect(trace.matchedTier).toBeUndefined();
    expect(trace.steps.at(-1)).toEqual({
      tier: "cwd",
      outcome: "ambiguous",
      detail: "2 active sources share this cwd; cwd fallback requires exactly one.",
    });
  });

  test("a child source cannot claim its parent's surface through cwd fallback", () => {
    const parent: CollectedAgent = {
      ...agent,
      id: "omp:parent",
      sourceSessionId: "parent",
      cwd: "/Users/emilionunezgarcia/Developer/unique-project",
    };
    const child: CollectedAgent = {
      ...parent,
      id: "omp:child",
      sourceSessionId: "child",
      parentSourceSessionId: parent.sourceSessionId,
    };
    const unclaimed: CmuxSurface = { ...exactSurface, sourceSessionIds: [] };

    const { target, trace } = resolveAgentTargetWithTrace(child, [unclaimed], [parent, child]);

    expect(target.resolution).toBe("missing");
    expect(trace.steps.at(-1)).toEqual({
      tier: "cwd",
      outcome: "rejected",
      detail: "Child source child belongs to parent parent and requires exact session evidence.",
    });
  });

  test("a quarantined surface finishes the trace at the tier that observed the conflict", () => {
    const conflicted: CmuxSurface = {
      ...exactSurface,
      sourceSessionIds: [],
      identityConflict: "cmux SURFACE-HEALTH has conflicting open agent session files on ttys033",
    };
    const cwdAgent: CollectedAgent = { ...agent, cwd: "/Users/emilionunezgarcia/Developer/unique-project" };

    const { target, trace } = resolveAgentTargetWithTrace(cwdAgent, [conflicted]);

    expect(target.resolution).toBe("ambiguous");
    expect(target.reason).toContain("quarantined");
    expect(trace.matchedTier).toBeUndefined();
    expect(trace.steps.at(-1)?.outcome).toBe("quarantined");
    expect(trace.steps.at(-1)?.detail).toContain("identity evidence conflicts");
  });
});
