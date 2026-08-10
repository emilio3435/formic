import { describe, expect, test } from "bun:test";
import { join } from "node:path";

describe("Ant Hill task refiner durability", () => {
  test("the Python behavioral suite passes", async () => {
    const process = Bun.spawn(
      ["python3", "-m", "unittest", "tests/test_ant_hill_task_refine.py"],
      {
        cwd: join(import.meta.dir, ".."),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    expect(`${stdout}\n${stderr}`).toContain("Ran 21 tests");
    expect(exitCode).toBe(0);
  });
});
