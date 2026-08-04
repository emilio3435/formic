import { beforeAll, describe, expect, test } from "bun:test";
import { enrichCmuxIdentity } from "../src/server/identity";
import type { CmuxSurface, CommandResult, CommandRunner } from "../src/server/types";

/* The probe that carries the identity system.

   Measured on this fleet: 18 of 19 cmux surfaces report no tty, and all 10 of
   the surfaces cmux names a session on are attributed through `system.top`
   rather than through a tty. So this one RPC is not one input among several —
   it is very nearly the whole of the evidence.

   A transient failure therefore does not degrade identity gracefully. It
   removes the only thing the write gate can read, and after today's fixes that
   means Send and Interrupt switch OFF fleet-wide rather than misroute. That is
   the safe direction and it stays.

   What it must not be is inexplicable. An operator watching the controls vanish
   needs to know a probe failed rather than that a policy changed, so these pin
   both halves: it retries, and when it still fails it says so in words that
   name the cause and the cost. */

const SURFACES: CmuxSurface[] = [
  {
    workspaceId: "W",
    surfaceId: "SURFACE-NO-TTY",
    paneId: "P1",
    cwd: "/Users/me/project",
    sourceSessionIds: [],
  } as CmuxSurface,
];

const TIMED_OUT: CommandResult = { exitCode: -1, stdout: "", stderr: "", timedOut: true };
const FAILED: CommandResult = { exitCode: 1, stdout: "", stderr: "connection refused", timedOut: false };
const GOOD: CommandResult = {
  exitCode: 0,
  timedOut: false,
  stderr: "",
  stdout: JSON.stringify({ windows: [{ processes: [{ kind: "process", pid: 4242, cmux_surface_id: "SURFACE-NO-TTY" }] }] }),
};

class ScriptedRunner implements CommandRunner {
  readonly calls: Array<{ command: string[]; timeoutMs?: number }> = [];
  constructor(private readonly replies: CommandResult[]) {}
  async run(command: readonly string[], timeoutMs?: number): Promise<CommandResult> {
    this.calls.push({ command: [...command], timeoutMs });
    const isProbe = command.includes("system.top");
    if (!isProbe) return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
    return this.replies[this.probeCalls++ ] ?? this.replies.at(-1) ?? FAILED;
  }
  private probeCalls = 0;
  get probes(): Array<{ command: string[]; timeoutMs?: number }> {
    return this.calls.filter(({ command }) => command.includes("system.top"));
  }
}

const errorsFrom = async (runner: ScriptedRunner): Promise<string[]> =>
  (await enrichCmuxIdentity(SURFACES, [], runner)).errors;

describe("a probe this load-bearing is retried before it is believed", () => {
  test("a timeout is retried rather than accepted first time", async () => {
    /* The whole point. One slow answer used to cost every write control until
       the next scan, with no second attempt. */
    const runner = new ScriptedRunner([TIMED_OUT, GOOD]);

    const errors = await errorsFrom(runner);

    expect(runner.probes).toHaveLength(2);
    // The retry succeeded, so nothing is reported: a recovered blip is not news.
    expect(errors.filter((error) => error.includes("attribution"))).toEqual([]);
  });

  test("a non-zero exit is retried too, not only a timeout", async () => {
    /* Both failure modes get the second chance. Retrying only timeouts would
       leave a cmux that answers "no" instantly costing the same as one that
       hangs, and it is the instant failure that is most likely transient. */
    const runner = new ScriptedRunner([FAILED, GOOD]);

    const errors = await errorsFrom(runner);

    expect(runner.probes).toHaveLength(2);
    expect(errors.filter((error) => error.includes("attribution"))).toEqual([]);
  });

  test("it stops at two attempts rather than retrying forever", async () => {
    /* A bounded retry. The snapshot loop runs on a timer, so an unbounded one
       would hold a scan open across ticks and turn a probe failure into a board
       that stops refreshing at all — a worse outcome than the one being fixed. */
    const runner = new ScriptedRunner([TIMED_OUT, TIMED_OUT, GOOD]);

    await errorsFrom(runner);

    expect(runner.probes).toHaveLength(2);
  });

  test("a success on the first attempt is not retried", async () => {
    // The control: the retry must not double every healthy scan's cost.
    const runner = new ScriptedRunner([GOOD]);

    await errorsFrom(runner);

    expect(runner.probes).toHaveLength(1);
  });

  test("each attempt gets a shorter deadline than the single attempt used to", async () => {
    /* Shorter WITH a retry, not instead of one: two 4s attempts fail faster
       than the one 10s attempt did, so a wedged cmux costs less overall while a
       merely slow one gains a second chance it never had. */
    const runner = new ScriptedRunner([GOOD]);

    await errorsFrom(runner);

    expect(runner.probes[0]!.timeoutMs).toBeLessThan(10_000);
  });
});

describe("when it still fails, the operator can tell a probe from a policy", () => {
  test("the message names the probe, the attempts, and what is lost", async () => {
    /* "cmux process attribution timed out" read as a configuration problem and
       said nothing about consequence. Send disappearing with no stated cause is
       indistinguishable from Send being switched off on purpose, and an
       operator cannot wait out something they cannot identify. */
    const runner = new ScriptedRunner([TIMED_OUT, TIMED_OUT]);

    const [message] = (await errorsFrom(runner)).filter((error) => error.includes("attribution"));

    expect(message, "no attribution error was reported at all").toBeDefined();
    expect(message).toMatch(/probe failed/i);          // it is a probe, not a setting
    expect(message).toMatch(/2 times/);                // it was retried, and both failed
    expect(message).toMatch(/timed out/i);             // why
    expect(message).toMatch(/Focus, Send and Interrupt/); // what it costs
  });

  test("both attempts are described, so two different faults are not merged into one", async () => {
    /* A timeout followed by a refusal is a different story from two timeouts,
       and the second attempt's reason is the more recent evidence. */
    const runner = new ScriptedRunner([TIMED_OUT, FAILED]);

    const [message] = (await errorsFrom(runner)).filter((error) => error.includes("attribution"));

    expect(message).toMatch(/timed out/i);
    expect(message).toMatch(/connection refused/);
  });

  test("a recovered probe reports nothing, so the message means something when it appears", async () => {
    /* The other half of legibility. An error logged on every scan that later
       succeeded would train an operator to ignore the one that matters. */
    const runner = new ScriptedRunner([TIMED_OUT, GOOD]);

    const errors = await errorsFrom(runner);

    expect(errors.filter((error) => error.includes("attribution"))).toEqual([]);
  });
});

/* The other half of legibility: the message has to reach the BOARD.

   The server wrote a sentence naming the probe, the attempts and the cost, and
   the health card rendered `${errors} error${...}` — a count. So an operator
   watching Send disappear read "1 degraded source · 0 stale · 1 error" and
   still could not tell a failed probe from a changed policy. A message that
   exists only in the payload is not a message to anyone; counting it is the
   same defect as withholding it. */
describe("the failure is legible on the board, not only in the payload", () => {
  let M: { summaryWidgetData: (id: string, snap: unknown, conn: string) => { sublabel: string } };

  beforeAll(async () => {
    // @ts-expect-error the dependency-free browser client has no declaration file
    await import("../src/web/app.js");
    M = (globalThis as unknown as { TheAntHill: typeof M }).TheAntHill;
  });

  const PROBE_MESSAGE = "cmux process attribution probe failed 2 times (timed out after 4000ms;"
    + " timed out after 4000ms). Session identity for panes without a tty is unavailable this scan,"
    + " so Focus, Send and Interrupt stay off until it answers.";

  const board = (errors: readonly string[]) => ({
    generatedAt: new Date().toISOString(),
    controlHealth: { cmuxReachable: true, lastCheckedAt: new Date().toISOString(), errors: [...errors], staleSources: [] },
    totals: { live: 1, tracked: 1, attention: 0, sourceHealth: { healthy: 3, degraded: 1, absent: 0, total: 4 } },
    programs: [],
  });

  test("the probe's own words are what the card shows", () => {
    const detail = M.summaryWidgetData("health", board([PROBE_MESSAGE]), "live").sublabel;

    expect(detail).toContain("probe failed");
    // The consequence clause is the part an operator acts on.
    expect(detail).toContain("Focus, Send and Interrupt");
    // And it is not the old bare count.
    expect(detail).not.toMatch(/^\d+ degraded source/);
  });

  test("a second error is disclosed rather than hidden behind the first", () => {
    /* Showing one message and silently dropping the rest would trade a count
       for a different kind of undercount. */
    const detail = M.summaryWidgetData("health", board([PROBE_MESSAGE, "cmux notification discovery exited 1"]), "live").sublabel;

    expect(detail).toContain("probe failed");
    expect(detail).toContain("+1 more");
  });

  test("a board with no errors keeps its existing summary", () => {
    // The control: this must not turn every clear board into an empty string.
    const detail = M.summaryWidgetData("health", board([]), "live").sublabel;

    expect(detail).toBeTruthy();
    expect(detail).not.toContain("probe failed");
  });
});

/* Focus was deliberately NOT gated on a folder-matched row: it types nothing,
   and going to look at the pane is how an operator recovers once the write
   controls are off. Naming the destination was chosen instead of closing the
   control — so the name has to be visible, or it is not an alternative to
   gating, it is the absence of one.

   It was a `title` attribute: invisible to keyboard and touch, and unread by
   anyone who moves the mouse to the button and clicks. */
describe("Focus names its destination where the destination is not proven", () => {
  let P: { focusButtonLabel: (agent: unknown, controlState: string) => string };

  beforeAll(async () => {
    // @ts-expect-error the dependency-free browser client has no declaration file
    P = await import("../src/web/presentation.js");
  });

  const row = (resolution: string) => ({
    target: { surfaceId: "S1", resolution, workspaceTitle: "wave6", surfaceCwd: "/Users/me/other-project" },
  });

  test("an unproven row shows where Focus will take it", () => {
    /* The rotation case: this row may read ALPHA while the pane is BRAVO's, so
       the destination beside the button is what makes the mismatch visible
       without opening anything. */
    expect(P.focusButtonLabel(row("unique-cwd"), "unproven")).toBe("Focus → other-project");
  });

  test("a proven row keeps the plain label", () => {
    /* Not on every row. A suffix everywhere is noise, and noise is what trains
       an eye to skip the one row where it mattered. */
    expect(P.focusButtonLabel(row("exact"), "linked")).toBe("Focus");
  });

  test("a row with no nameable pane says Focus rather than an empty arrow", () => {
    expect(P.focusButtonLabel({ target: { resolution: "missing" } }, "unproven")).toBe("Focus");
  });
});
