import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BunCommandRunner } from "../src/server/command";

describe("BunCommandRunner", () => {
  test("returns stdout and the zero exit status for a successful command", async () => {
    const result = await new BunCommandRunner().run(["/bin/echo", "hi"]);

    expect(result).toEqual({
      exitCode: 0,
      stdout: "hi\n",
      stderr: "",
      timedOut: false,
    });
  });

  test("preserves a non-zero exit status", async () => {
    const result = await new BunCommandRunner().run(["/bin/sh", "-c", "exit 7"]);

    expect(result).toMatchObject({ exitCode: 7, timedOut: false });
  });

  test("returns spawn failures as a non-timeout result with diagnostic stderr", async () => {
    const result = await new BunCommandRunner().run(["/nonexistent/ant-hill-command"]);

    expect(result.exitCode).toBe(-1);
    expect(result.stderr.length).toBeGreaterThan(0);
    expect(result.timedOut).toBe(false);
  });

  test.each([
    ["a child that ignores SIGTERM", "trap \"\" TERM; sleep 60"],
    ["a grandchild that inherits stdout after its parent exits", "(sleep 60) & exit 0"],
  ])("%s settles at the hard deadline", async (_label, script) => {
    const startedAt = performance.now();
    const result = await new BunCommandRunner().run(["/bin/sh", "-c", script], 50);

    expect(result).toMatchObject({
      exitCode: -1,
      timedOut: true,
    });
    expect(result.stderr).toContain("timed out");
    expect(performance.now() - startedAt).toBeLessThan(500);
  });

  test("an aborted command is KILLED, not merely stopped being awaited", async () => {
    /* THE DEFECT this exists for. The watchdog used to supersede a refresh by
       dropping its promise, which stops the caller waiting and does nothing
       whatsoever to the child. Two passes' worth of `ps`, `lsof` and cmux RPCs
       then shared one machine, and each overrun made the next one worse —
       observed 12.1s -> 13.5s -> 26.6s.

       Asserted on a SIDE EFFECT IN THE FILESYSTEM rather than on the returned
       result, because the return value is exactly what a broken implementation
       still gets right: it can report "cancelled" the instant the signal fires
       while the process it claims to have cancelled runs happily to completion.
       The marker file can only appear if the child survived. */
    const marker = join(tmpdir(), `anthill-abort-${randomUUID()}`);
    const controller = new AbortController();
    const running = new BunCommandRunner().run(
      ["/bin/sh", "-c", `sleep 1; /usr/bin/touch ${marker}`],
      10_000,
      controller.signal,
    );

    await Bun.sleep(150);
    controller.abort();
    const result = await running;

    expect(result).toMatchObject({ cancelled: true, timedOut: false });
    /* Past when the child would have written it had it lived. */
    await Bun.sleep(1_400);
    expect(existsSync(marker), "the child outlived its cancellation").toBeFalse();
  });

  test("cancellation is reported as itself, never as a timeout or a failure", async () => {
    /* A cancelled command is not evidence about the fleet. If it arrives
       wearing `timedOut`, the operator is told a collector is slow; if it
       arrives as a bare non-zero exit, they are told a subsystem is broken.
       Neither happened — a newer pass replaced this one. */
    const controller = new AbortController();
    const running = new BunCommandRunner().run(["/bin/sh", "-c", "sleep 5"], 10_000, controller.signal);

    await Bun.sleep(100);
    controller.abort();

    expect(await running).toMatchObject({ cancelled: true, timedOut: false, exitCode: -1 });
  });

  test("a signal that is already aborted spawns nothing at all", async () => {
    /* Spawning only to immediately signal it is how a pid gets recycled out
       from under the terminate call, and it costs a process for no reason. */
    const marker = join(tmpdir(), `anthill-preabort-${randomUUID()}`);
    const result = await new BunCommandRunner().run(
      ["/usr/bin/touch", marker],
      10_000,
      AbortSignal.abort(),
    );

    expect(result).toMatchObject({ cancelled: true, timedOut: false });
    await Bun.sleep(300);
    expect(existsSync(marker), "a pre-aborted command still ran").toBeFalse();
  });
});
