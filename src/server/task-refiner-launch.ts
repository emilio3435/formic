import { join } from "node:path";

export function shouldLaunchTaskRefiner(
  port: number,
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return port === 4_701
    && environment.ANT_HILL_TASK_REFINER_ENABLED === "1"
    && environment.ANT_HILL_TASK_REFINER_DISABLED !== "1";
}

export function taskRefinerCommand(repoRoot: string, port: number): string[] {
  return [
    "python3",
    join(repoRoot, "scripts/ant-hill-task-refine.py"),
    "--snapshot-url",
    `http://127.0.0.1:${port}/api/snapshot`,
  ];
}
