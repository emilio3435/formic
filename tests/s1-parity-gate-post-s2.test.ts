/**
 * S1 parity gate — re-verified after S2 removed the Findings card and its
 * inspector links, moved the health remedy into the notification center, and
 * changed the health chip vocabulary.
 *
 * Claim (plan migration-safety): every finding the header could once reach
 * via issuesOf(snap) ∪ queueItems resolves to a notificationFeed() item OR a
 * documented demotion under hasCurrentImpact / notificationCandidates. Demotions
 * sent to history stay reachable through recentlyResolvedOf and the resolved
 * drawer — "demoted" must not mean "gone".
 *
 * This is a standing enumeration, not a one-off. It must keep holding as S4,
 * S6-T3/T4 and further a11y work land.
 *
 * Hermetic — safe for `bun run test:ci`.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let M: any;

beforeAll(async () => {
  // @ts-expect-error dependency-free browser module
  await import("../src/web/app.js");
  M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
});

const NOW = Date.parse("2026-08-06T03:00:00.000Z");

function agent(overrides: Record<string, unknown> = {}) {
  return {
    id: "codex:a1",
    provider: "codex",
    sourceSessionId: "a1",
    displayName: "Worker",
    programId: "p1",
    status: "running",
    activity: "working",
    lifecycle: "working",
    outcome: "healthy",
    scope: "observed",
    statusReason: "Streaming.",
    updatedAt: "2026-08-06T02:00:00.000Z",
    tokens: { provenance: "observed", total: 1200 },
    artifacts: [],
    gates: [],
    target: { resolution: "exact", surfaceId: "s1", workspaceId: "w1" },
    controls: [],
    ...overrides,
  };
}

function issue(overrides: Record<string, unknown> = {}) {
  return {
    id: "system:sources",
    kind: "system",
    severity: "warning",
    title: "Two sources disagree",
    summary: "The cmux store and the transcript disagree.",
    affectedAgentIds: [] as string[],
    ...overrides,
  };
}

/** Snapshot rich enough to mint every finding kind the header once reached. */
function richBoard() {
  const asking = agent({
    id: "codex:asking",
    sourceSessionId: "asking",
    displayName: "Asking lane",
    status: "attention",
    activity: "idle",
    lifecycle: "waiting",
    outcome: "needs-you",
    attentionSignal: { kind: "question-pending", evidence: "Land the Findings removal now?" },
  });
  const noticed = agent({
    id: "codex:quiet",
    sourceSessionId: "quiet",
    displayName: "Quiet lane",
    status: "waiting",
    activity: "idle",
    lifecycle: "waiting",
    outcome: "healthy",
    attentionSignal: { kind: "stalled-active", evidence: "No output for 45 minutes." },
  });
  const failed = agent({
    id: "codex:failed",
    sourceSessionId: "failed",
    displayName: "Failed lane",
    status: "failed",
    activity: "idle",
    lifecycle: "waiting",
    outcome: "failed",
    statusReason: "Provider exited 1.",
  });
  const ended = agent({
    id: "codex:gone",
    sourceSessionId: "gone",
    displayName: "Ended lane",
    status: "archived",
    activity: "ended",
    lifecycle: "finished",
    outcome: "healthy",
  });
  const liveAffected = agent({
    id: "codex:live-hit",
    sourceSessionId: "live-hit",
    displayName: "Live hit",
    status: "running",
    activity: "working",
    lifecycle: "working",
    outcome: "healthy",
    controlState: "quarantined",
  });

  return {
    schemaVersion: 1,
    generatedAt: "2026-08-06T03:00:00.000Z",
    controlHealth: {
      cmuxReachable: true,
      lastCheckedAt: "2026-08-06T03:00:00.000Z",
      errors: ["identity conflict on surface s-9"],
      staleSources: ["cursor"],
    },
    totals: {
      live: 4, tracked: 5, attention: 2, working: 2, idle: 2, ended: 1,
      sourceHealth: { healthy: 3, degraded: 1, absent: 0, total: 4 },
    },
    programs: [{
      id: "p1",
      name: "Parity program",
      agents: [asking, noticed, failed, ended, liveAffected],
    }],
    issues: [
      issue({
        id: "system:sources",
        severity: "warning",
        title: "Two sources disagree",
        lifecycle: { state: "open", openedAt: "2026-08-06T01:00:00.000Z" },
      }),
      issue({
        id: "system:cmux-hard",
        severity: "error",
        title: "CMUX identity conflicts",
        summary: "Live sessions cannot take commands.",
        affectedAgentIds: ["codex:live-hit"],
        lifecycle: { state: "open", openedAt: "2026-08-06T01:30:00.000Z" },
      }),
      issue({
        id: "system:verifying-live",
        severity: "warning",
        title: "Source catching up",
        affectedAgentIds: ["codex:live-hit"],
        lifecycle: {
          state: "verifying",
          openedAt: "2026-08-06T01:00:00.000Z",
          verificationStartedAt: "2026-08-06T02:30:00.000Z",
        },
      }),
      issue({
        id: "system:verifying-orphan",
        severity: "warning",
        title: "Stale source verifying",
        affectedAgentIds: ["codex:gone"],
        lifecycle: {
          state: "verifying",
          openedAt: "2026-08-06T00:00:00.000Z",
          verificationStartedAt: "2026-08-06T02:00:00.000Z",
        },
      }),
      issue({
        id: "system:stale-impact",
        severity: "warning",
        title: "Abandoned worktree advisory",
        affectedAgentIds: ["codex:gone"],
        lifecycle: { state: "open", openedAt: "2026-08-05T20:00:00.000Z" },
      }),
      issue({
        id: "system:resolved-1",
        severity: "warning",
        title: "Identity conflict cleared",
        lifecycle: {
          state: "resolved",
          openedAt: "2026-08-05T18:00:00.000Z",
          resolvedAt: "2026-08-05T22:00:00.000Z",
        },
      }),
      /* Server-minted agent findings are dropped by issuesOf in favour of the
         alerting() derivation — keep one to prove the gate still accounts for
         the derived agent:<id> row, not this dead letter. */
      {
        id: "agent:codex:asking",
        kind: "agent",
        severity: "warning",
        title: "server-side agent finding (dropped)",
        affectedAgentIds: ["codex:asking"],
      },
    ],
    recentlyResolved: [
      { id: "system:resolved-1", title: "Identity conflict cleared", lifecycle: { state: "resolved" } },
      { id: "system:verifying-orphan", title: "Stale source verifying", lifecycle: { state: "resolved" } },
      { id: "system:stale-impact", title: "Abandoned worktree advisory", lifecycle: { state: "resolved" } },
    ],
  };
}

/** Queue: overlap with a live finding + orphan investigation. */
function richQueue() {
  return [
    {
      issueId: "system:sources",
      id: "q-overlap",
      state: "running",
      headline: "Isolate the source disagreement",
      createdAt: "2026-08-06T02:00:00.000Z",
    },
    {
      issueId: "inv:orphan",
      id: "q-orphan",
      state: "queued",
      headline: "Orphan investigation still running",
      createdAt: "2026-08-06T02:15:00.000Z",
    },
  ];
}

/** controlHealth.errors synthesis path — issuesOf mints system:collector-errors
    only when the server ships no issues array. */
function collectorErrorsBoard() {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-06T03:00:00.000Z",
    controlHealth: {
      cmuxReachable: true,
      lastCheckedAt: "2026-08-06T03:00:00.000Z",
      errors: ["collector timed out reading cursor"],
      staleSources: ["cursor"],
    },
    totals: { live: 1, tracked: 1, attention: 0, working: 1, idle: 0, ended: 0 },
    programs: [{
      id: "p1",
      name: "Parity program",
      agents: [agent({ id: "codex:ok", sourceSessionId: "ok", displayName: "Healthy" })],
    }],
    // No issues array — forces the synthesis branch inside issuesOf.
  };
}

const HISTORY_REASONS = new Set([
  "resolved",
  "verifying with no live affected agent",
  "stale — no live affected agent",
  "source healthy — finding cleared",
]);

type FeedItem = { id: string; kind: string; route: { kind: string; id: string } };
type Demotion = { id: string; item: FeedItem; reason: string };

function boardIds(snap: unknown, queue: Array<{ issueId: string }>): string[] {
  const fromIssues = M.issuesOf(snap).map((i: { id: string }) => i.id);
  const fromQueue = queue.map((q) => q.issueId);
  return [...new Set([...fromIssues, ...fromQueue])];
}

function account(snap: unknown, queue: unknown[]) {
  const { live, demoted } = M.notificationCandidates(snap, queue, NOW, M.NOTIFY_DEPS) as {
    live: FeedItem[];
    demoted: Demotion[];
  };
  const byId = new Map<string, { surface: "live" | "demoted"; reason?: string; item: FeedItem }>();
  for (const item of live) byId.set(item.id, { surface: "live", item });
  for (const d of demoted) byId.set(d.id, { surface: "demoted", reason: d.reason, item: d.item });
  return { live, demoted, byId };
}

describe("S1 parity gate — post-S2 re-verification", () => {
  test("Findings is gone from the header and the gate still has a home", () => {
    expect(M.WIDGET_CATALOG.some((w: { id: string }) => w.id === "needs-you")).toBe(false);
    expect(typeof M.notificationCandidates).toBe("function");
    expect(typeof M.issuesOf).toBe("function");
    expect(typeof M.recentlyResolvedOf).toBe("function");
    expect(M.DRAWER_KINDS).toContain("resolved");
  });

  test("every issuesOf ∪ queueItems id is a live feed item or a documented demotion", () => {
    const snap = richBoard();
    const queue = richQueue();
    const population = boardIds(snap, queue);
    expect(population.length).toBeGreaterThanOrEqual(8);

    const { live, demoted, byId } = account(snap, queue);
    const unreachable: Array<{ id: string; where: string }> = [];

    for (const id of population) {
      const hit = byId.get(id);
      if (!hit) {
        const issue = M.issuesOf(snap).find((i: { id: string }) => i.id === id);
        unreachable.push({
          id,
          where: issue
            ? `issuesOf kind=${issue.kind} severity=${issue.severity}`
            : `queueItems only (investigation)`,
        });
      }
    }

    if (unreachable.length) {
      const detail = unreachable.map((u) => `${u.id} (${u.where})`).join("\n  ");
      throw new Error(
        `S1 parity gate FAILED after S2 — unreachable finding(s); the ledger removal may have taken them:\n  ${detail}`,
      );
    }

    expect(live.length).toBeGreaterThan(0);
    expect(demoted.length).toBeGreaterThan(0);
    for (const d of demoted) {
      expect(d.reason.length, d.id).toBeGreaterThan(0);
    }

    /* Kinds the rich board must actually exercise — a gate that only saw
       handoffs would pass while dataflow demotions rotted. */
    const liveKinds = new Set(live.map((i) => i.kind));
    expect(liveKinds.has("handoff") || live.some((i) => i.id.startsWith("agent:"))).toBe(true);
    expect(live.some((i) => i.id.startsWith("system:") || i.kind === "dataflow")).toBe(true);
    expect(live.some((i) => i.id === "inv:orphan" || i.kind === "investigation")).toBe(true);
    expect(demoted.some((d) => HISTORY_REASONS.has(d.reason))).toBe(true);
  });

  test("every live route resolves to a DRAWER_RENDERERS key", () => {
    const snap = richBoard();
    const { live } = account(snap, richQueue());
    const kinds = M.DRAWER_KINDS as string[];
    for (const item of live) {
      expect(kinds, `${item.id} → ${item.route.kind}`).toContain(item.route.kind);
    }
  });

  test("history demotions stay reachable via recentlyResolvedOf and the resolved drawer", () => {
    const snap = richBoard();
    const { demoted } = account(snap, richQueue());
    const history = demoted.filter((d) => HISTORY_REASONS.has(d.reason));
    expect(history.length).toBeGreaterThanOrEqual(2);

    const resolvedPool = M.recentlyResolvedOf(snap) as Array<{ id: string }>;
    const issuesPool = M.issuesOf(snap) as Array<{ id: string; lifecycle?: { state?: string } }>;
    const app = readFileSync(join(import.meta.dir, "../src/web/app.js"), "utf8");
    expect(app).toMatch(/const DRAWER_RENDERERS\s*=\s*\{[\s\S]*?\bresolved\s*:/);

    const missing: string[] = [];
    for (const d of history) {
      const inResolved = resolvedPool.some((i) => i.id === d.id);
      const stillOnWire = issuesPool.some((i) => i.id === d.id);
      /* History is honest when the id is in the resolved pool, or still on the
         wire under a lifecycle the resolved drawer can open (issuesOf ∪
         recentlyResolvedOf is resolveSelection's pool for kind:"resolved"). */
      if (!inResolved && !stillOnWire) missing.push(`${d.id} (${d.reason})`);
      expect(M.DRAWER_KINDS, d.id).toContain("resolved");
    }
    if (missing.length) {
      throw new Error(
        `History demotion(s) are unreachable — demoted but absent from recentlyResolvedOf and issuesOf:\n  ${missing.join("\n  ")}`,
      );
    }
  });

  test("controlHealth.errors still mint a finding when the server ships no issues array", () => {
    /* S2 moved the health remedy into the center; the synthesis path inside
       issuesOf must still feed the gate, or collector faults become chip-only. */
    const snap = collectorErrorsBoard();
    const population = boardIds(snap, []);
    expect(population).toContain("system:collector-errors");

    const { byId } = account(snap, []);
    const hit = byId.get("system:collector-errors");
    expect(hit, "system:collector-errors unreachable after S2").toBeTruthy();
    expect(hit!.surface).toBe("live");
    expect(hit!.item.kind).toBe("dataflow");
  });

  test("overlap: a queued investigation does not double-count its finding", () => {
    const snap = richBoard();
    const queue = richQueue();
    const { live } = account(snap, queue);
    const sourceRows = live.filter((i) => i.id === "system:sources");
    expect(sourceRows).toHaveLength(1);
    expect(sourceRows[0]!.kind).toBe("dataflow");
    expect(live.some((i) => i.id === "inv:orphan")).toBe(true);
  });
});
