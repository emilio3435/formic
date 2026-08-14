import { describe, expect, spyOn, test } from "bun:test";
import { enrichCmuxIdentity } from "../src/server/identity";
import type {
  CmuxSurface,
  CollectedAgent,
  CommandResult,
  CommandRunner,
} from "../src/server/types";

const sessionId = "019f86c4-1558-7000-aeb8-26e2cfd0e8ec";
const agent: CollectedAgent = {
  id: `codex:${sessionId}`,
  provider: "codex",
  sourceSessionId: sessionId,
  displayName: "Timing fixture",
  status: "running",
  statusReason: "Fixture activity is recent.",
  updatedAt: "2026-08-13T20:00:00.000Z",
  tokens: { provenance: "unknown" },
  artifacts: [],
  gates: [],
};
const ttySurface: CmuxSurface = {
  workspaceId: "WORKSPACE-TIMING",
  surfaceId: "SURFACE-TIMING",
  paneId: "PANE-TIMING",
  tty: "ttys033",
  sourceSessionIds: [],
};
const processRow = `202 ttys033 /Users/me/.local/bin/codex resume ${sessionId}`;

interface TimedResult {
  advanceMs: number;
  result: CommandResult;
}

class TimedSequenceRunner implements CommandRunner {
  constructor(
    private readonly results: TimedResult[],
    private readonly advance: (ms: number) => void,
  ) {}

  async run(): Promise<CommandResult> {
    const next = this.results.shift() ?? {
      advanceMs: 0,
      result: { exitCode: 0, stdout: "", stderr: "", timedOut: false },
    };
    this.advance(next.advanceMs);
    return next.result;
  }
}

const ok = (stdout = ""): CommandResult => ({
  exitCode: 0,
  stdout,
  stderr: "",
  timedOut: false,
});

describe("identity subprocess observability", () => {
  test("an overrun reports exact per-site elapsed time and the inputs that drive each subprocess", async () => {
    let nowMs = 0;
    const clock = spyOn(Date, "now").mockImplementation(() => nowMs);
    const logged = spyOn(console, "error").mockImplementation(() => {});
    const runner = new TimedSequenceRunner([
      {
        advanceMs: 160,
        result: ok(JSON.stringify([{ kind: "process", cmux_surface_id: ttySurface.surfaceId, pid: 202 }])),
      },
      { advanceMs: 80, result: ok(processRow) },
      { advanceMs: 3_000, result: ok() },
    ], (ms) => {
      nowMs += ms;
    });

    try {
      await enrichCmuxIdentity([{ ...ttySurface, tty: undefined }], [agent], runner);

      const timing = logged.mock.calls
        .map((call) => String(call[0]))
        .find((line) => line.includes("[identity] probe timings"));
      expect(timing, "the slow identity pass did not report its subprocess breakdown").toBeDefined();
      expect(timing).toContain("total=3240ms");
      expect(timing).toContain("cmux_system_top=160ms(attempts=1,surfaces=1)");
      expect(timing).toContain("process_table=80ms(rows=1)");
      expect(timing).toContain("lsof=3000ms(pids=1)");
    } finally {
      logged.mockRestore();
      clock.mockRestore();
    }
  });

  test("a healthy identity pass stays silent", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});
    const runner = new TimedSequenceRunner([
      { advanceMs: 0, result: ok(processRow) },
      { advanceMs: 0, result: ok() },
    ], () => {});

    try {
      await enrichCmuxIdentity([ttySurface], [agent], runner);
      const identityLogs = logged.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.startsWith("[identity]"));
      expect(identityLogs).toEqual([]);
    } finally {
      logged.mockRestore();
    }
  });

  test("each failed subprocess path writes its named source-health error to stderr", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      await enrichCmuxIdentity(
        [{ ...ttySurface, tty: undefined }],
        [agent],
        new TimedSequenceRunner([
          { advanceMs: 0, result: { exitCode: 1, stdout: "", stderr: "cmux unavailable", timedOut: false } },
          { advanceMs: 0, result: { exitCode: 1, stdout: "", stderr: "cmux unavailable", timedOut: false } },
        ], () => {}),
      );
      await enrichCmuxIdentity(
        [ttySurface],
        [agent],
        new TimedSequenceRunner([
          { advanceMs: 0, result: { exitCode: 0, stdout: "", stderr: "deadline", timedOut: true } },
        ], () => {}),
      );
      await enrichCmuxIdentity(
        [ttySurface],
        [agent],
        new TimedSequenceRunner([
          { advanceMs: 0, result: ok(processRow) },
          { advanceMs: 0, result: { exitCode: 0, stdout: "", stderr: "deadline", timedOut: true } },
        ], () => {}),
      );

      const identityLogs = logged.mock.calls.map((call) => String(call[0]));
      expect(identityLogs.some((line) => line.includes("cmux process attribution probe failed 2 times"))).toBeTrue();
      expect(identityLogs).toContain("[identity] process identity lookup timed out");
      expect(identityLogs).toContain("[identity] open-session identity lookup timed out");
    } finally {
      logged.mockRestore();
    }
  });
});
