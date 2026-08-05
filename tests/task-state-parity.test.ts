import { beforeAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectSessions, DEFAULT_SESSION_WINDOW_MS } from "../src/server/collectors";
import {
  manifestFactsFor,
  readRunManifests,
  type RunManifest,
} from "../src/server/run-manifests";
import { buildSnapshot } from "../src/server/snapshot";
import {
  hookInputWantsHuman as hookInputWantsHumanOnServer,
  taskStateWantsHuman as taskStateWantsHumanOnServer,
  type TaskAttentionEvidence,
} from "../src/server/task-state";
import type { ArchiveStore, CollectedAgent } from "../src/server/types";
import { TASK_STATES } from "../src/shared/types";

interface TruthTableCase {
  name: string;
  evidence: TaskAttentionEvidence;
  expectedHook?: boolean;
  expected: boolean;
}

const table = JSON.parse(readFileSync(
  join(import.meta.dir, "fixtures", "task-state-attention-truth-table.json"),
  "utf8",
)) as { cases: TruthTableCase[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let agentModel: any;

beforeAll(async () => {
  // @ts-expect-error The dependency-free browser client intentionally has no declaration file.
  client = await import("../src/web/task-state.js");
  // @ts-expect-error The dependency-free browser client intentionally has no declaration file.
  agentModel = await import("../src/web/agent-model.js");
});

describe("task-state attention precedence", () => {
  for (const testCase of table.cases) {
    test(`${testCase.name} — server`, () => {
      expect(hookInputWantsHumanOnServer(testCase.evidence))
        .toBe(testCase.expectedHook ?? testCase.expected);
      expect(taskStateWantsHumanOnServer(testCase.evidence)).toBe(testCase.expected);
    });

    test(`${testCase.name} — client mirror`, () => {
      expect(client.hookInputWantsHuman(testCase.evidence))
        .toBe(testCase.expectedHook ?? testCase.expected);
      expect(client.taskStateWantsHuman(testCase.evidence)).toBe(testCase.expected);
    });

    test(`${testCase.name} — same verdict on both sides`, () => {
      expect(client.hookInputWantsHuman(testCase.evidence))
        .toBe(hookInputWantsHumanOnServer(testCase.evidence));
      expect(client.taskStateWantsHuman(testCase.evidence))
        .toBe(taskStateWantsHumanOnServer(testCase.evidence));
    });

    test(`${testCase.name} — live client attention uses the contract`, () => {
      const agent = {
        id: "codex:task-state",
        lifecycle: "waiting",
        scope: "observed",
        status: "waiting",
        activity: "idle",
        ...testCase.evidence,
      };
      expect(agentModel.hookWantsInput(agent)).toBe(testCase.expectedHook ?? testCase.expected);
      expect(agentModel.wantsHuman(agent)).toBe(testCase.expected);
    });
  }
});

const manifestBody = (lane: Record<string, unknown> = {}): Record<string, unknown> => ({
  runId: "task-state-run",
  createdAt: "2026-08-05T11:00:00.000Z",
  repoRoot: process.cwd(),
  orchestrator: { provider: "claude", sessionId: "orchestrator" },
  lanes: [{
    laneId: "be-task-state",
    role: "worker",
    provider: "codex",
    sessionId: "task-state-session",
    ...lane,
  }],
});

describe("manifest task-state contract", () => {
  test("a status and statusAt pair becomes declared task-state evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "anthill-task-state-manifest-"));
    try {
      const path = join(root, "manifest.json");
      writeFileSync(path, JSON.stringify(manifestBody({
        status: "parked",
        statusAt: "2026-08-05T12:00:00.000Z",
      })));

      const manifests = readRunManifests([path]);
      expect(manifests[0]?.lanes[0]).toMatchObject({
        status: "parked",
        statusAt: "2026-08-05T12:00:00.000Z",
      });
      expect(manifestFactsFor("codex:task-state-session", manifests)).toMatchObject({
        taskState: "parked",
        taskStateAt: "2026-08-05T12:00:00.000Z",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("status and statusAt are an atomic pair, while their joint absence stays compatible", () => {
    const root = mkdtempSync(join(tmpdir(), "anthill-task-state-invalid-"));
    try {
      const cases: Array<{ name: string; lane: Record<string, unknown>; valid: boolean }> = [
        { name: "absent", lane: {}, valid: true },
        { name: "missing-time", lane: { status: "parked" }, valid: false },
        { name: "missing-state", lane: { statusAt: "2026-08-05T12:00:00.000Z" }, valid: false },
        { name: "bad-state", lane: { status: "blocked", statusAt: "2026-08-05T12:00:00.000Z" }, valid: false },
        { name: "bad-time", lane: { status: "done", statusAt: "not-a-time" }, valid: false },
      ];

      for (const testCase of cases) {
        const path = join(root, `${testCase.name}.json`);
        writeFileSync(path, JSON.stringify(manifestBody(testCase.lane)));
        expect(readRunManifests([path]).length, testCase.name).toBe(testCase.valid ? 1 : 0);
      }
      const legacy = readRunManifests([join(root, "absent.json")]);
      expect(manifestFactsFor("codex:task-state-session", legacy)?.taskState).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };

function collected(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: "codex:task-state-session",
    provider: "codex",
    sourceSessionId: "task-state-session",
    displayName: "Task-state lane",
    cwd: process.cwd(),
    status: "waiting",
    statusReason: "Fixture is waiting.",
    updatedAt: "2026-08-05T12:00:30.000Z",
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    ...overrides,
  };
}

function declaredManifest(): RunManifest {
  return {
    runId: "task-state-run",
    createdAt: "2026-08-05T11:00:00.000Z",
    repoRoot: process.cwd(),
    orchestrator: { provider: "claude", sessionId: "orchestrator" },
    lanes: [{
      laneId: "be-task-state",
      role: "worker",
      provider: "codex",
      sessionId: "task-state-session",
      status: "done",
      statusAt: "2026-08-05T12:00:00.000Z",
    }],
  };
}

test("the snapshot publishes task-state evidence without changing lifecycle", () => {
  const source = collected({
    hookLifecycle: "needsInput",
    hookLifecycleAt: "2026-08-05T12:00:01.000Z",
  });
  const withoutDeclaration = buildSnapshot({
    agents: [source], surfaces: [], archiveStore,
    now: new Date("2026-08-05T12:01:00.000Z"),
  }).programs[0]!.agents[0]!;
  const declared = buildSnapshot({
    agents: [source], surfaces: [], archiveStore,
    runManifests: [declaredManifest()],
    now: new Date("2026-08-05T12:01:00.000Z"),
  }).programs[0]!.agents[0]!;

  expect(declared).toMatchObject({
    taskState: "done",
    taskStateSource: "manifest",
    taskStateAt: "2026-08-05T12:00:00.000Z",
    hookLifecycle: "needsInput",
    hookLifecycleAt: "2026-08-05T12:00:01.000Z",
  });
  expect({
    lifecycle: declared.lifecycle,
    provenance: declared.provenance,
    activity: declared.activity,
    status: declared.status,
    outcome: declared.outcome,
  }).toEqual({
    lifecycle: withoutDeclaration.lifecycle,
    provenance: withoutDeclaration.provenance,
    activity: withoutDeclaration.activity,
    status: withoutDeclaration.status,
    outcome: withoutDeclaration.outcome,
  });
});

test("server attention totals obey task state and the newer-hook escape hatch", () => {
  const asking = collected({
    hookLifecycle: "needsInput",
    hookLifecycleAt: "2026-08-05T11:59:59.000Z",
    lastAgentClosing: "Should I publish this now?",
  });
  const input = {
    surfaces: [],
    archiveStore,
    runManifests: [{
      ...declaredManifest(),
      lanes: [{
        ...declaredManifest().lanes[0]!,
        status: "parked" as const,
        statusAt: "2026-08-05T12:00:00.000Z",
      }],
    }],
    now: new Date("2026-08-05T12:01:00.000Z"),
  };
  const stale = buildSnapshot({ ...input, agents: [asking] });
  const staleAgent = stale.programs[0]!.agents[0]!;

  expect(staleAgent.attentionSignal?.kind).toBe("question-pending");
  expect(staleAgent.lifecycle).toBe("working");
  expect(stale.totals.needsYou).toBe(0);
  expect(stale.programs[0]?.rollup?.needsYou).toBe(0);

  const newer = buildSnapshot({
    ...input,
    agents: [{ ...asking, hookLifecycleAt: "2026-08-05T12:00:00.001Z" }],
  });
  expect(newer.totals.needsYou).toBe(1);
  expect(newer.programs[0]?.rollup?.needsYou).toBe(1);
});

test("a stalled active lane uses the existing attention door without changing lifecycle", () => {
  const source = collected({
    hookLifecycle: "idle",
    hookLifecycleAt: "2026-08-05T11:30:00.000Z",
    lastAgentClosing: "The implementation is still in progress.",
  });
  const runManifests: RunManifest[] = [{
    ...declaredManifest(),
    lanes: [{
      ...declaredManifest().lanes[0]!,
      status: "active",
      statusAt: "2026-08-05T11:00:00.000Z",
    }],
  }];
  const snapshot = buildSnapshot({
    agents: [source], surfaces: [], archiveStore, runManifests,
    now: new Date("2026-08-05T12:01:00.000Z"),
  });
  const agent = snapshot.programs[0]!.agents[0]!;

  expect(agent).toMatchObject({
    taskState: "active",
    taskStateSource: "manifest",
    hookLifecycle: "idle",
    attentionSignal: {
      kind: "stalled-active",
      evidence: "Hook idle for 31 minutes; manifest declares active.",
    },
    nextAction: "Nudge it or park it.",
  });
  expect(agent.lifecycle).toBe("working");
  expect(snapshot.totals.needsYou).toBe(1);
  expect(snapshot.programs[0]?.rollup?.needsYou).toBe(1);

  const patient = buildSnapshot({
    agents: [source], surfaces: [], archiveStore, runManifests,
    now: new Date("2026-08-05T12:01:00.000Z"),
    stalledActiveMinutes: 60,
  });
  expect(patient.programs[0]!.agents[0]!.attentionSignal).toBeUndefined();
  expect(patient.totals.needsYou).toBe(0);
});

test("collection preserves the hook timestamp used by the precedence rule", async () => {
  const home = mkdtempSync(join(tmpdir(), "anthill-task-state-hook-"));
  try {
    const sessions = join(home, ".codex", "sessions");
    const hookRoot = join(home, ".cmuxterm");
    const sessionId = "11111111-2222-4333-8444-555555555555";
    const hookUpdatedAt = Math.floor(Date.now() / 1_000);
    const timestamp = new Date(hookUpdatedAt * 1_000).toISOString();
    mkdirSync(sessions, { recursive: true });
    mkdirSync(hookRoot, { recursive: true });
    writeFileSync(join(sessions, "session.jsonl"), `${JSON.stringify({
      type: "session_meta",
      timestamp,
      payload: { id: sessionId, cwd: home },
    })}\n`);
    writeFileSync(join(hookRoot, "codex-hook-sessions.json"), JSON.stringify({
      version: 1,
      sessions: {
        [sessionId]: {
          sessionId,
          surfaceId: "HOOK-SURFACE",
          workspaceId: "HOOK-WORKSPACE",
          cwd: home,
          pid: 4242,
          pidStartSeconds: 1_785_933_001,
          agentLifecycle: "needsInput",
          updatedAt: hookUpdatedAt,
        },
      },
    }));

    const result = await collectSessions(home, DEFAULT_SESSION_WINDOW_MS, undefined, {
      hookProcessStarts: () => new Map([[4242, 1_785_933_001]]),
    });
    expect(result.codex.value[0]).toMatchObject({
      hookLifecycle: "needsInput",
      hookLifecycleAt: timestamp,
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

describe("task-state documentation parity", () => {
  const architecture = readFileSync(join(import.meta.dir, "..", "ARCHITECTURE.md"), "utf8");
  const guide = readFileSync(join(import.meta.dir, "..", "ANT-GUIDE.md"), "utf8");

  test("the architecture names the reducer, mirror, and complete wire evidence", () => {
    expect(architecture).toContain("src/server/task-state.ts");
    expect(architecture).toContain("src/web/task-state.js");
    for (const field of ["taskState", "taskStateSource", "taskStateAt", "hookLifecycleAt"]) {
      expect(architecture, field).toContain(field);
    }
  });

  test("the operator guide names every state and the strictly-newer re-alert rule", () => {
    for (const state of TASK_STATES) expect(guide, state).toContain(`\`${state}\``);
    expect(guide).toContain("strictly newer");
    expect(guide).toMatch(/does not change the session\s+lifecycle/);
  });

  test("both docs name the stalled-active threshold and its fail-closed evidence", () => {
    for (const document of [architecture, guide]) {
      expect(document).toContain("stalled-active");
      expect(document).toContain("30 minutes");
      expect(document).toContain("hookLifecycleAt");
    }
  });
});
