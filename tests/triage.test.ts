import { describe, expect, test } from "bun:test";
import type { AgentSnapshot, HubSnapshot, OperatorIssue } from "../src/shared/types";
import {
  buildTriageRecommendation,
  handleTriageRequest,
  MemoryTriageQueueStore,
  type InvestigationResult,
  type TriageInvestigationRunner,
} from "../src/server/triage";

function agent(id: string, programId: string, provider: AgentSnapshot["provider"] = "codex"): AgentSnapshot {
  return {
    id,
    provider,
    sourceSessionId: id.split(":").at(-1)!,
    displayName: `Agent ${id}`,
    programId,
    status: "running",
    statusReason: "Source activity is recent.",
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
    const current = snapshot(issue, agents);
    const store = new MemoryTriageQueueStore();
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
    expect(await started.json()).toMatchObject({ ok: true, item: { state: "running", runId: "run-1", pid: 42 } });
    await handleTriageRequest(post("/api/triage/run", issue.id), current, store, runner);
    expect(launches).toBe(1);

    finish({ ok: true, summary: "Identity overlap traced and bounded." });
    await Bun.sleep(5);
    expect(store.get(issue.id)).toMatchObject({ state: "completed", result: "Identity overlap traced and bounded." });
  });
});
