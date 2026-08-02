import { describe, expect, test } from "bun:test";
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
