import { describe, expect, test } from "bun:test";
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
});
