import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Ant Hill per-repository header summarizer", () => {
  test("the Python behavioral suite passes", async () => {
    const process = Bun.spawn(
      ["python3", "-m", "unittest", "tests/test_ant_hill_header_per_repo.py"],
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
    expect(`${stdout}\n${stderr}`).toMatch(/Ran [1-9]\d* tests/);
    expect(exitCode).toBe(0);
  });

  test("the retired task sidecar cannot replace provider task data", () => {
    const snapshot = readFileSync(join(import.meta.dir, "../src/server/snapshot.ts"), "utf8");
    const types = readFileSync(join(import.meta.dir, "../src/shared/types.ts"), "utf8");
    const server = readFileSync(join(import.meta.dir, "../src/server/index.ts"), "utf8");
    expect(snapshot).not.toContain("taskSummaryRoot");
    expect(snapshot).not.toContain("data/task-summaries");
    expect(snapshot).not.toContain("refinedTask");
    expect(types).not.toContain("rawTask");
    expect(server).not.toContain("task-refiner");
  });
});
