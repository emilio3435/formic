import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, spyOn, test } from "bun:test";
import { emptySnapshot } from "../src/server/app";
import type {
  AgentSnapshot,
  HubSnapshot,
  OperatorIssue,
  TriageQueueItem,
  TriageRecommendation,
} from "../src/shared/types";
import {
  buildTriageRecommendation,
  handleTriageRequest,
  JsonTriageQueueStore,
  MemoryTriageQueueStore,
  NativeLunaInvestigationRunner,
  TRIAGE_RETENTION_MS,
  type InvestigationResult,
  type TriageInvestigationRunner,
} from "../src/server/triage";

const TRIAGE_NOW_MS = Date.parse("2026-07-28T09:12:03.114Z");
const triageNow = () => TRIAGE_NOW_MS;

function agent(id: string, programId: string, provider: AgentSnapshot["provider"] = "codex"): AgentSnapshot {
  return {
    id,
    provider,
    sourceSessionId: id.split(":").at(-1)!,
    displayName: `Agent ${id}`,
    programId,
    status: "running",
    statusReason: "Source activity is recent.",
    lastHumanMessage: null,
    activity: "working",
    outcome: "healthy",
    controlState: "quarantined",
    updatedAt: "2026-07-22T06:00:00.000Z",
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    target: { resolution: "ambiguous", reason: "Conflicting evidence." },
    controls: [],
  };
}

function snapshot(issue: OperatorIssue, agents: AgentSnapshot[]): HubSnapshot {
  const byProgram = new Map<string, AgentSnapshot[]>();
  for (const value of agents) byProgram.set(value.programId, [...(byProgram.get(value.programId) ?? []), value]);
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-22T06:00:00.000Z",
    controlHealth: {
      cmuxReachable: true,
      lastCheckedAt: "2026-07-22T06:00:00.000Z",
      errors: [],
      staleSources: [],
    },
    totals: { live: agents.length, tracked: agents.length, attention: 0 },
    issues: [issue],
    programs: [...byProgram.entries()].map(([id, values]) => ({ id, name: id, agents: values })),
  };
}

function post(path: string, issueId: string, origin = "http://127.0.0.1:4701"): Request {
  return new Request(`http://127.0.0.1:4701${path}`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ issueId }),
  });
}

function remove(issueId: string, origin = "http://127.0.0.1:4701"): Request {
  return new Request(`http://127.0.0.1:4701/api/triage/queue?issueId=${encodeURIComponent(issueId)}`, {
    method: "DELETE",
    headers: { origin },
  });
}

function recommendation(issueId = "system:persisted"): TriageRecommendation {
  return {
    issueId,
    generatedAt: "2026-07-22T06:01:00.000Z",
    mode: "investigation",
    headline: "Investigate persisted evidence",
    rationale: "The evidence needs a bounded investigation.",
    affectedAgents: 1,
    affectedPrograms: 1,
    providers: ["codex"],
    evidence: ["Persisted evidence"],
    steps: [{ title: "Inspect", detail: "Inspect the persisted evidence." }],
    queueRecommended: true,
    investigationPrompt: "Goal: Inspect persisted evidence.\n\nStop when: The evidence is reconciled.",
  };
}

function queueItem(overrides: Partial<TriageQueueItem> = {}): TriageQueueItem {
  const value = recommendation();
  return {
    ...value,
    id: `triage:${value.issueId}`,
    state: "queued",
    createdAt: value.generatedAt,
    ...overrides,
  };
}

// The fixtures above carry fixed 2026-07-22 timestamps while triage retention
// (TRIAGE_RETENTION_MS = 7 days) is measured against the store's clock. Pin the
// clock just past the newest fixture so these assertions exercise retention logic
// instead of silently expiring seven days after the file was written.

describe("operator triage recommendations", () => {
  test("broad overlapping identity evidence recommends a bounded investigation", () => {
    const agents = [
      agent("codex:a", "alpha"),
      agent("codex:b", "alpha"),
      agent("claude:c", "alpha", "claude"),
      agent("codex:d", "beta"),
      agent("cursor:e", "beta", "cursor"),
    ];
    const issue: OperatorIssue = {
      id: "system:cmux-identity-conflicts",
      kind: "system",
      severity: "error",
      title: "CMUX identity conflicts",
      summary: "Two surfaces have conflicting identity evidence.",
      affectedAgentIds: agents.map((value) => value.id),
      technicalDetails: ["ttys003 has two sessions", "ttys005 has two sessions"],
    };

    const recommendation = buildTriageRecommendation(
      issue,
      snapshot(issue, agents),
      new Date("2026-07-22T06:01:00.000Z"),
    );

    expect(recommendation).toMatchObject({
      issueId: issue.id,
      mode: "investigation",
      affectedAgents: 5,
      affectedPrograms: 2,
      providers: ["claude", "codex", "cursor"],
      queueRecommended: true,
      headline: "Re-establish one session identity per cmux surface",
    });
    expect(recommendation.steps).toHaveLength(4);
    expect(recommendation.investigationPrompt).toContain("Goal: Investigate and resolve CMUX identity conflicts");
    expect(recommendation.investigationPrompt).toContain("Stop when:");
  });

  test("one agent issue stays a direct targeted unblock", () => {
    const value = agent("codex:solo", "alpha");
    const issue: OperatorIssue = {
      id: `agent:${value.id}`,
      kind: "agent",
      severity: "warning",
      title: "Solo agent needs review",
      summary: "The last turn is waiting for input.",
      affectedAgentIds: [value.id],
    };

    const recommendation = buildTriageRecommendation(issue, snapshot(issue, [value]));

    expect(recommendation.mode).toBe("direct");
    expect(recommendation.queueRecommended).toBeFalse();
    expect(recommendation.investigationPrompt).toBeUndefined();
    expect(recommendation.headline).toContain("one targeted unblock");
  });

  test("generation is same-origin and queueing is persistent and idempotent", async () => {
    const agents = [agent("codex:a", "alpha"), agent("codex:b", "alpha")];
    const issue: OperatorIssue = {
      id: "system:cmux-control",
      kind: "system",
      severity: "error",
      title: "CMUX control is degraded",
      summary: "Two controls are degraded.",
      affectedAgentIds: agents.map((value) => value.id),
    };
    const current = snapshot(issue, agents);
    const store = new MemoryTriageQueueStore();

    const rejected = await handleTriageRequest(
      post("/api/triage/generate", issue.id, "http://localhost:4700"),
      current,
      store,
    );
    expect(rejected.status).toBe(403);

    const generated = await handleTriageRequest(post("/api/triage/generate", issue.id), current, store);
    expect(generated.status).toBe(200);
    expect(await generated.json()).toMatchObject({ ok: true, recommendation: { mode: "coordinated" } });

    const first = await handleTriageRequest(post("/api/triage/queue", issue.id), current, store);
    const second = await handleTriageRequest(post("/api/triage/queue", issue.id), current, store);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(store.list()).toHaveLength(1);

    const listed = await handleTriageRequest(
      new Request("http://127.0.0.1:4701/api/triage/queue"),
      current,
      store,
    );
    expect(await listed.json()).toMatchObject({
      ok: true,
      items: [{ id: `triage:${issue.id}`, state: "queued" }],
    });
  });

  test("serializes simultaneous queue requests without duplicating an issue", async () => {
    const agents = [agent("codex:a", "alpha"), agent("codex:b", "alpha")];
    const issue: OperatorIssue = {
      id: "system:cmux-control",
      kind: "system",
      severity: "error",
      title: "CMUX control is degraded",
      summary: "Two controls are degraded.",
      affectedAgentIds: agents.map((value) => value.id),
    };
    const current = snapshot(issue, agents);
    const store = new MemoryTriageQueueStore();

    const [first, second] = await Promise.all([
      handleTriageRequest(post("/api/triage/queue", issue.id), current, store),
      handleTriageRequest(post("/api/triage/queue", issue.id), current, store),
    ]);
    const [firstBody, secondBody] = await Promise.all([first.json(), second.json()]);

    expect(firstBody.item.id).toBe(secondBody.item.id);
    expect(store.list()).toHaveLength(1);
  });

  test("an explicit run action launches one bounded investigation and persists its outcome", async () => {
    const agents = [
      agent("codex:a", "alpha"), agent("codex:b", "alpha"),
      agent("codex:c", "beta"), agent("cursor:d", "beta", "cursor"),
    ];
    const issue: OperatorIssue = {
      id: "system:cmux-identity-conflicts",
      kind: "system",
      severity: "error",
      title: "CMUX identity conflicts",
      summary: "Multiple surfaces overlap.",
      affectedAgentIds: agents.map((value) => value.id),
      technicalDetails: ["first conflict", "second conflict"],
    };
    const current = snapshot({
      ...issue,
      lifecycle: {
        state: "verifying",
        openedAt: "2026-07-22T06:00:00.000Z",
        verificationStartedAt: "2026-07-22T06:01:00.000Z",
      },
    }, agents);
    const store = new MemoryTriageQueueStore(triageNow);
    const transitions: string[] = [];
    const unsubscribe = store.subscribe?.((item) => transitions.push(item.state));
    await handleTriageRequest(post("/api/triage/queue", issue.id), current, store);

    let finish!: (value: InvestigationResult) => void;
    let launches = 0;
    const runner: TriageInvestigationRunner = {
      async launch() {
        launches += 1;
        return {
          runId: "run-1",
          model: "GPT-5.6 Luna · XHIGH · read-only",
          pid: 42,
          completion: new Promise((resolve) => { finish = resolve; }),
        };
      },
    };

    const started = await handleTriageRequest(post("/api/triage/run", issue.id), current, store, runner);
    expect(await started.json()).toMatchObject({
      ok: true,
      item: {
        state: "running",
        startedAt: new Date(TRIAGE_NOW_MS).toISOString(),
        runId: "run-1",
        pid: 42,
      },
    });
    await handleTriageRequest(post("/api/triage/run", issue.id), current, store, runner);
    expect(launches).toBe(1);

    finish({ ok: true, summary: "Identity overlap traced and bounded." });
    await Bun.sleep(5);
    expect(store.get(issue.id)).toMatchObject({ state: "completed", result: "Identity overlap traced and bounded." });
    expect(transitions).toEqual(["queued", "running", "completed"]);
    expect(current.issues?.[0]?.lifecycle).toMatchObject({ state: "verifying" });
    expect(unsubscribe).toBeFunction();
  });

  test("a completed finding can be requeued from fresh issue evidence", async () => {
    const issueId = "system:recurring";
    const store = new MemoryTriageQueueStore(triageNow);
    await store.add(recommendation(issueId));
    const completed = store.get(issueId)!;
    completed.state = "completed";
    completed.completedAt = "2026-07-22T06:05:00.000Z";
    completed.result = "Old incident evidence.";

    const fresh = {
      ...recommendation(issueId),
      generatedAt: "2026-07-28T09:12:03.114Z",
      evidence: ["Fresh incident evidence."],
    };
    const requeued = await store.add(fresh);

    expect(requeued).toMatchObject({
      issueId,
      state: "queued",
      createdAt: fresh.generatedAt,
      evidence: fresh.evidence,
    });
    expect(requeued.completedAt).toBeUndefined();
    expect(requeued.result).toBeUndefined();
  });

  test("DELETE cancels a running investigation before removing it", async () => {
    const issueId = "system:cancellable";
    const store = new MemoryTriageQueueStore(triageNow);
    await store.add(recommendation(issueId));
    let cancelled = 0;
    const runner: TriageInvestigationRunner = {
      async launch() {
        return {
          runId: "run-cancellable",
          model: "test",
          completion: new Promise(() => {}),
          cancel: async () => { cancelled += 1; },
        };
      },
    };
    await store.start(issueId, runner);

    const response = await handleTriageRequest(remove(issueId), emptySnapshot(), store, runner);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      removed: { issueId, state: "running" },
      cancelled: true,
    });
    expect(cancelled).toBe(1);
    expect(store.get(issueId)).toBeUndefined();
  });

  test("DELETE refuses to hide a running investigation without a safe cancellation handle", async () => {
    const issueId = "system:not-cancellable";
    const store = new MemoryTriageQueueStore(triageNow);
    await store.add(recommendation(issueId));
    const runner: TriageInvestigationRunner = {
      async launch() {
        return {
          runId: "run-not-cancellable",
          model: "test",
          completion: new Promise(() => {}),
        };
      },
    };
    await store.start(issueId, runner);

    const response = await handleTriageRequest(remove(issueId), emptySnapshot(), store, runner);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "INVESTIGATION_CANCEL_UNAVAILABLE" },
    });
    expect(store.get(issueId)?.state).toBe("running");
  });

  test("accepts an exact same-origin IPv6 loopback triage request", async () => {
    const value = agent("codex:ipv6", "alpha");
    const issue: OperatorIssue = {
      id: "agent:codex:ipv6",
      kind: "agent",
      severity: "warning",
      title: "IPv6 triage",
      summary: "The request arrived over IPv6 loopback.",
      affectedAgentIds: [value.id],
    };
    const request = new Request("http://[::1]:4701/api/triage/generate", {
      method: "POST",
      headers: { origin: "http://[::1]:4701", "content-type": "application/json" },
      body: JSON.stringify({ issueId: issue.id }),
    });

    const response = await handleTriageRequest(
      request,
      snapshot(issue, [value]),
      new MemoryTriageQueueStore(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, recommendation: { issueId: issue.id } });
  });
});

describe("JSON triage queue durability", () => {
  test("a missing queue opens empty and persisted items survive reopen", async () => {
    const directory = await mkdtemp(join(tmpdir(), "anthill-triage-"));
    const path = join(directory, "triage-queue.json");
    try {
      const store = await JsonTriageQueueStore.open(path, triageNow);
      expect(store.list()).toEqual([]);

      const added = await store.add(recommendation());
      const reopened = await JsonTriageQueueStore.open(path, triageNow);
      expect(reopened.list()).toEqual([added]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("a running item recovers as blocked and the recovery is persisted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "anthill-triage-"));
    const path = join(directory, "triage-queue.json");
    await writeFile(path, JSON.stringify([queueItem({
      state: "running",
      startedAt: "2026-07-22T06:02:00.000Z",
      runId: "run-before-restart",
    })]));
    try {
      const store = await JsonTriageQueueStore.open(path, triageNow);
      expect(store.list()).toEqual([
        expect.objectContaining({
          state: "blocked",
          runId: "run-before-restart",
          completedAt: expect.any(String),
          result: expect.stringContaining("restarted before this investigation reported completion"),
        }),
      ]);
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual([
        expect.objectContaining({
          state: "blocked",
          result: expect.stringContaining("restarted before this investigation reported completion"),
        }),
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("a completed JSON queue item is replaced by fresh evidence and survives reopen", async () => {
    const directory = await mkdtemp(join(tmpdir(), "anthill-triage-"));
    const path = join(directory, "triage-queue.json");
    const issueId = "system:recurring-json";
    await writeFile(path, JSON.stringify([
      queueItem({
        issueId,
        id: `triage:${issueId}`,
        state: "completed",
        completedAt: "2026-07-27T09:00:00.000Z",
        result: "Old incident.",
      }),
    ]));
    try {
      const store = await JsonTriageQueueStore.open(
        path,
        () => Date.parse("2026-07-28T09:00:00.000Z"),
      );
      await store.add({
        ...recommendation(issueId),
        generatedAt: "2026-07-28T09:01:00.000Z",
        evidence: ["Fresh incident."],
      });
      const reopened = await JsonTriageQueueStore.open(
        path,
        () => Date.parse("2026-07-28T09:02:00.000Z"),
      );

      expect(reopened.list()).toMatchObject([{
        issueId,
        state: "queued",
        evidence: ["Fresh incident."],
      }]);
      expect(reopened.get(issueId)?.result).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("keeps the exact retention boundary and prunes one millisecond beyond it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "anthill-triage-"));
    const path = join(directory, "triage-queue.json");
    const retainedAt = new Date(TRIAGE_NOW_MS - TRIAGE_RETENTION_MS).toISOString();
    const prunedAt = new Date(TRIAGE_NOW_MS - TRIAGE_RETENTION_MS - 1).toISOString();
    await writeFile(path, JSON.stringify([
      queueItem({
        issueId: "system:retained-at-boundary",
        id: "triage:system:retained-at-boundary",
        state: "completed",
        createdAt: retainedAt,
        completedAt: retainedAt,
      }),
      queueItem({
        issueId: "system:pruned-beyond-boundary",
        id: "triage:system:pruned-beyond-boundary",
        state: "completed",
        createdAt: prunedAt,
        completedAt: prunedAt,
      }),
    ]));
    try {
      const store = await JsonTriageQueueStore.open(path, triageNow);
      expect(store.list().map(({ issueId }) => issueId)).toEqual(["system:retained-at-boundary"]);
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual([
        expect.objectContaining({ issueId: "system:retained-at-boundary" }),
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("bounds the queue to the 500 newest findings", async () => {
    let now = Date.parse("2026-07-28T00:00:00.000Z");
    const store = new MemoryTriageQueueStore(() => now);
    for (let index = 0; index < 501; index += 1) {
      now += 1;
      await store.add({
        ...recommendation(`system:${index}`),
        generatedAt: new Date(now).toISOString(),
      });
    }

    expect(store.list()).toHaveLength(500);
    expect(store.get("system:0")).toBeUndefined();
    expect(store.get("system:500")).toBeDefined();
  });

  test.each([
    ["invalid JSON", "{"],
    ["an invalid item after a valid item", JSON.stringify([queueItem(), { issueId: "broken" }])],
  ])("opens %s as an empty queue and logs the corruption", async (_label, contents) => {
    const directory = await mkdtemp(join(tmpdir(), "anthill-triage-"));
    const path = join(directory, "triage-queue.json");
    await writeFile(path, contents);
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      const store = await JsonTriageQueueStore.open(path);

      expect(store.list()).toEqual([]);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining(`Ignoring unreadable queue at ${path}`));
    } finally {
      logged.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("native triage investigation guards", () => {
  test("rejects an item without an investigation prompt before spawning", async () => {
    const runner = new NativeLunaInvestigationRunner("/tmp", "/tmp/anthill-unused-investigations");
    await expect(runner.launch(queueItem({ investigationPrompt: undefined }))).rejects.toThrow(
      "Queued item has no investigation prompt",
    );
  });

  test("rejects a second launch while the first native investigation is active", async () => {
    const directory = await mkdtemp(join(tmpdir(), "anthill-triage-runner-"));
    let finish!: (exitCode: number) => void;
    const exited = new Promise<number>((resolve) => { finish = resolve; });
    const process = {
      pid: 42,
      stderr: new ReadableStream({ start(controller) { controller.close(); } }),
      exited,
      kill: () => {},
    } as unknown as ReturnType<typeof Bun.spawn>;
    const spawn = (() => process) as typeof Bun.spawn;
    try {
      const runner = new NativeLunaInvestigationRunner(directory, join(directory, "output"), spawn);
      const first = await runner.launch(queueItem());

      await expect(runner.launch(queueItem({ issueId: "system:second" }))).rejects.toThrow(
        "One investigation is already running",
      );
      finish(0);
      await expect(first.completion).resolves.toMatchObject({ ok: true });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("native cancellation terminates the child process and waits for exit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "anthill-triage-cancel-"));
    let finish!: (exitCode: number) => void;
    const exited = new Promise<number>((resolve) => { finish = resolve; });
    const signals: string[] = [];
    const process = {
      pid: 42,
      stderr: new ReadableStream({ start(controller) { controller.close(); } }),
      exited,
      kill: (signal: string) => {
        signals.push(signal);
        finish(143);
      },
    } as unknown as ReturnType<typeof Bun.spawn>;
    try {
      const runner = new NativeLunaInvestigationRunner(
        directory,
        join(directory, "output"),
        (() => process) as typeof Bun.spawn,
      );
      const launch = await runner.launch(queueItem());

      await launch.cancel?.();

      expect(signals).toEqual(["SIGTERM"]);
      await expect(launch.completion).resolves.toMatchObject({ ok: false });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
