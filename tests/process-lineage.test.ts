import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectSessions, DEFAULT_SESSION_WINDOW_MS } from "../src/server/collectors";
import {
  readProcessLineage,
  type ProcessLineageExec,
} from "../src/server/process-lineage";
import { buildSnapshot } from "../src/server/snapshot";
import type { RunManifest } from "../src/server/run-manifests";
import type {
  ArchiveStore,
  CollectedAgent,
} from "../src/server/types";
import type { HookSessionRecord } from "../src/server/cmux-hook-sessions";

const PROCESS_TABLE = `  PID  PPID STARTED                      COMMAND
  100    10 Wed Aug  5 10:00:00 2026     codex parent
  200   100 Wed Aug  5 10:01:00 2026     helper
  300   200 Wed Aug  5 10:02:00 2026     codex child
  400   999 Wed Aug  5 10:03:00 2026     codex orphan
`;

const archiveStore: ArchiveStore = {
  has: () => false,
  archive: async () => {},
};

function hook(
  sessionId: string,
  pid: number,
  startedAt: string,
): HookSessionRecord {
  return {
    provider: "codex",
    sessionId,
    surfaceId: "SURFACE-LINEAGE",
    workspaceId: "WORKSPACE-LINEAGE",
    cwd: "/tmp/atlas-lineage",
    pid,
    pidStartSeconds: Math.floor(Date.parse(startedAt) / 1_000),
    agentLifecycle: "running",
    updatedAt: Date.parse(startedAt) / 1_000,
  };
}

function collected(
  sessionId: string,
  overrides: Partial<CollectedAgent> = {},
): CollectedAgent {
  return {
    id: `codex:${sessionId}`,
    provider: "codex",
    sourceSessionId: sessionId,
    displayName: sessionId,
    cwd: "/tmp/atlas-lineage",
    status: "running",
    statusReason: "Fixture activity is recent.",
    startedAt: "2026-08-05T10:00:00.000Z",
    updatedAt: "2026-08-05T10:04:00.000Z",
    tokens: { total: 42, provenance: "observed" },
    artifacts: [],
    gates: [],
    ...overrides,
  };
}

function manifest(): RunManifest {
  return {
    runId: "lineage-run",
    createdAt: "2026-08-05T10:00:00.000Z",
    repoRoot: "/tmp/atlas-lineage",
    orchestrator: { provider: "codex", sessionId: "declared-parent" },
    lanes: [{
      laneId: "child",
      role: "worker",
      provider: "codex",
      sessionId: "child",
    }],
  };
}

describe("kernel process lineage", () => {
  test("walks one injected ps table from a hook pid to the nearest known agent ancestor", () => {
    const commands: string[][] = [];
    const exec: ProcessLineageExec = (command) => {
      commands.push([...command]);
      return { exitCode: 0, stdout: PROCESS_TABLE };
    };
    const records = [
      hook("parent", 100, "Wed Aug 5 10:00:00 2026"),
      hook("child", 300, "Wed Aug 5 10:02:00 2026"),
      hook("orphan", 400, "Wed Aug 5 10:03:00 2026"),
    ];

    const lineage = readProcessLineage(records, exec);

    expect(commands).toEqual([["ps", "-axo", "pid,ppid,lstart,command"]]);
    expect(lineage?.processStarts.get(300)).toBe(Date.parse("Wed Aug 5 10:02:00 2026") / 1_000);
    expect(lineage?.observedParents.get("codex:child")).toBe("codex:parent");
    expect(lineage?.observedParents.has("codex:orphan")).toBeFalse();
  });

  test("rejects reused or ambiguous ancestor pids instead of inventing a parent", () => {
    const exec: ProcessLineageExec = () => ({ exitCode: 0, stdout: PROCESS_TABLE });
    const child = hook("child", 300, "Wed Aug 5 10:02:00 2026");
    const reusedParent = {
      ...hook("reused-parent", 100, "Wed Aug 5 10:00:00 2026"),
      pidStartSeconds: Date.parse("Wed Aug 5 10:00:01 2026") / 1_000,
    };
    const ambiguousParents = [
      hook("parent-a", 100, "Wed Aug 5 10:00:00 2026"),
      hook("parent-b", 100, "Wed Aug 5 10:00:00 2026"),
    ];

    expect(readProcessLineage([reusedParent, child], exec)?.observedParents.has("codex:child")).toBeFalse();
    expect(readProcessLineage([...ambiguousParents, child], exec)?.observedParents.has("codex:child")).toBeFalse();
  });

  test("treats an unusable ps response as unavailable instead of an empty process roster", () => {
    const records = [hook("child", 300, "Wed Aug 5 10:02:00 2026")];

    expect(readProcessLineage(records, () => ({ exitCode: 0, stdout: "unexpected output" }))).toBeUndefined();
  });

  test("the collector reads the ps table once and attaches exact observed parentage", async () => {
    const home = mkdtempSync(join(tmpdir(), "anthill-process-lineage-"));
    try {
      const sessions = join(home, ".codex", "sessions");
      const hookRoot = join(home, ".cmuxterm");
      mkdirSync(sessions, { recursive: true });
      mkdirSync(hookRoot, { recursive: true });
      const records = [
        hook("parent", 100, "Wed Aug 5 10:00:00 2026"),
        hook("child", 300, "Wed Aug 5 10:02:00 2026"),
      ];
      for (const record of records) {
        writeFileSync(join(sessions, `${record.sessionId}.jsonl`), `${JSON.stringify({
          type: "session_meta",
          timestamp: new Date().toISOString(),
          payload: { id: record.sessionId, cwd: record.cwd },
        })}\n`);
      }
      writeFileSync(join(hookRoot, "codex-hook-sessions.json"), JSON.stringify({
        version: 1,
        sessions: Object.fromEntries(records.map((record) => [record.sessionId, record])),
      }));
      let calls = 0;

      const result = await collectSessions(home, DEFAULT_SESSION_WINDOW_MS, undefined, {
        processLineageExec: () => {
          calls += 1;
          return { exitCode: 0, stdout: PROCESS_TABLE };
        },
      });

      expect(calls).toBe(1);
      expect(result.codex.value.find(({ sourceSessionId }) => sourceSessionId === "child")?.lineage).toEqual({
        observedParentAgentId: "codex:parent",
      });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("snapshot lineage agreement", () => {
  test.each([
    ["corroborated", "codex:declared-parent", "corroborated"],
    ["contradicted", "codex:other-parent", "contradicted"],
    ["unobserved", undefined, "unobserved"],
  ] as const)("keeps a declared parent when kernel lineage is %s", (_label, observedParentAgentId, agreement) => {
    const child = collected("child", {
      ...(observedParentAgentId ? { lineage: { observedParentAgentId } } : {}),
    });
    const snapshot = buildSnapshot({
      agents: [
        collected("declared-parent"),
        collected("other-parent"),
        child,
      ],
      surfaces: [],
      runManifests: [manifest()],
      archiveStore,
      now: new Date("2026-08-05T10:05:00.000Z"),
    });
    const agent = snapshot.programs.flatMap(({ agents }) => agents).find(({ id }) => id === child.id);

    expect(agent?.parentAgentId).toBe("codex:declared-parent");
    expect(agent?.lineageAgreement).toBe(agreement);
    expect(agent?.lineage).toEqual(
      observedParentAgentId ? { observedParentAgentId } : undefined,
    );
  });

  test("adopts kernel parentage only for an undeclared session and marks the parent observed", () => {
    const parent = collected("observed-parent");
    const child = collected("undeclared-child", {
      lineage: { observedParentAgentId: parent.id },
    });
    const snapshot = buildSnapshot({
      agents: [parent, child],
      surfaces: [],
      archiveStore,
      now: new Date("2026-08-05T10:05:00.000Z"),
    });
    const agents = snapshot.programs.flatMap((program) => program.agents);

    expect(agents.find(({ id }) => id === child.id)).toMatchObject({
      parentAgentId: parent.id,
      lineage: { observedParentAgentId: parent.id },
      lineageAgreement: "corroborated",
    });
    expect(agents.find(({ id }) => id === parent.id)).toMatchObject({
      role: "orchestrator",
      roleSource: "observed",
    });
  });
});
