import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  shouldLaunchTaskRefiner,
  taskRefinerCommand,
} from "../src/server/task-refiner-launch";
import { buildSnapshot } from "../src/server/snapshot";
import type { ArchiveStore, CollectedAgent } from "../src/server/types";

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };

describe("the Ant Hill server owns one task-refiner child", () => {
  test("the child targets this server's exact loopback port", () => {
    expect(taskRefinerCommand("/repo with spaces", 4_719)).toEqual([
      "python3",
      "/repo with spaces/scripts/ant-hill-task-refine.py",
      "--snapshot-url",
      "http://127.0.0.1:4719/api/snapshot",
    ]);
  });

  test("only the canonical service launches, and operators can explicitly disable it", () => {
    expect(shouldLaunchTaskRefiner(4_701, {})).toBe(false);
    expect(shouldLaunchTaskRefiner(4_701, { ANT_HILL_TASK_REFINER_ENABLED: "1" })).toBe(true);
    expect(shouldLaunchTaskRefiner(4_719, {})).toBe(false);
    expect(shouldLaunchTaskRefiner(4_701, {
      ANT_HILL_TASK_REFINER_ENABLED: "1",
      ANT_HILL_TASK_REFINER_DISABLED: "1",
    })).toBe(false);
  });

  test("a durable sidecar replaces the row task without depending on the server cwd", () => {
    const summaryRoot = mkdtempSync(join(tmpdir(), "anthill-task-summary-"));
    const summary = "Reconcile Prime collector truth while preserving the current agent objective and operator context.";
    writeFileSync(join(summaryRoot, "codex_session.txt"), summary);
    const agent: CollectedAgent = {
      id: "codex:session",
      provider: "codex",
      sourceSessionId: "session",
      displayName: "Codex session",
      identity: { name: "Codex session", base: "Codex session", source: "provider-fallback" },
      task: "Original verbose prompt",
      status: "running",
      statusReason: "recent transcript activity",
      updatedAt: new Date().toISOString(),
      tokens: { provenance: "unknown" },
      artifacts: [],
      gates: [],
    };

    const snapshot = buildSnapshot({
      agents: [agent],
      surfaces: [],
      archiveStore,
      taskSummaryRoot: summaryRoot,
    });
    const published = snapshot.programs.flatMap(({ agents }) => agents)[0];

    expect(published?.task).toBe(summary);
    expect(published?.lastHumanMessage).toBe(summary);
  });

  test("rawTask preserves the source task only when a sidecar replaced a real one", () => {
    const summaryRoot = mkdtempSync(join(tmpdir(), "anthill-task-summary-"));
    writeFileSync(join(summaryRoot, "codex_refined.txt"), "Refined objective");
    const base: Omit<CollectedAgent, "id" | "sourceSessionId" | "task"> = {
      provider: "codex",
      displayName: "Codex session",
      identity: { name: "Codex session", base: "Codex session", source: "provider-fallback" },
      status: "running",
      statusReason: "recent transcript activity",
      updatedAt: new Date().toISOString(),
      tokens: { provenance: "unknown" },
      artifacts: [],
      gates: [],
    };
    const snapshot = buildSnapshot({
      agents: [
        { ...base, id: "codex:refined", sourceSessionId: "refined", task: "Original verbose prompt" },
        { ...base, id: "codex:untouched", sourceSessionId: "untouched", task: "Stays as written" },
        { ...base, id: "codex:taskless", sourceSessionId: "taskless", task: undefined },
      ] as CollectedAgent[],
      surfaces: [],
      archiveStore,
      taskSummaryRoot: summaryRoot,
    });
    const byId = new Map(snapshot.programs.flatMap(({ agents }) => agents).map((a) => [a.id, a]));
    // Sidecar replaced a real task → the original survives as rawTask.
    expect(byId.get("codex:refined")?.task).toBe("Refined objective");
    expect(byId.get("codex:refined")?.rawTask).toBe("Original verbose prompt");
    // No sidecar → no rawTask, task untouched.
    expect(byId.get("codex:untouched")?.task).toBe("Stays as written");
    expect(byId.get("codex:untouched")?.rawTask).toBeUndefined();
    // No real source task → nothing to preserve, even if a sidecar existed.
    writeFileSync(join(summaryRoot, "codex_taskless.txt"), "Refined for a taskless agent");
    const again = buildSnapshot({
      agents: [{ ...base, id: "codex:taskless", sourceSessionId: "taskless", task: undefined }] as CollectedAgent[],
      surfaces: [],
      archiveStore,
      taskSummaryRoot: summaryRoot,
    });
    const taskless = again.programs.flatMap(({ agents }) => agents)[0];
    expect(taskless?.rawTask).toBeUndefined();
  });
});
