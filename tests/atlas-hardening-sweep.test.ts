import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  recordMatchesParserContract,
  upsertHookSessionRecord,
} from "../scripts/cmux-hook-store";
import { writeLaneRegistration } from "../scripts/anthill-manifest";
import { buildSnapshot } from "../src/server/snapshot";
import { senderVerificationFor } from "../src/server/sender-verification";
import {
  taskStateWantsHuman,
  type TaskAttentionEvidence,
} from "../src/server/task-state";
import type { RunManifest } from "../src/server/run-manifests";
import type { ArchiveStore, CollectedAgent } from "../src/server/types";
import { resolveRepoIdentity, fnvKey } from "../src/server/repo-identity";
import type { LineageAgreement, RoleSource } from "../src/shared/types";

const FIXTURES = join(import.meta.dir, "fixtures", "atlas-hardening-sweep");
const ATTENTION_TABLE = join(
  import.meta.dir,
  "fixtures",
  "task-state-attention-truth-table.json",
);
const SHIM_FIXTURES = join(import.meta.dir, "fixtures", "cmux-hook-sessions");
const REAL_CMUXTERM = join(process.env.HOME ?? "", ".cmuxterm");
const REAL_RUNS = join(process.env.HOME ?? "", ".anthill", "runs");
const SCRATCH = `/private/tmp/claude-501/anthill-hardening-sweep-${process.pid}`;
const TYPES = readFileSync(join(import.meta.dir, "../src/shared/types.ts"), "utf8");

const archiveStore: ArchiveStore = {
  has: () => false,
  archive: async () => {},
};

const SENDER = "claude:8c052fe9-db5c-47c4-9e21-e9b623dd6c82";
const RUN = "atlas-hardening-2026-08-05";
const BODY = "You are lane harden2. Read the lane brief in full.";
const headed = (body = BODY): string => `[from ${SENDER} run ${RUN}] ${body}`;
const transcriptWith = (body: string): string => JSON.stringify({
  type: "assistant",
  message: {
    content: [{
      type: "tool_use",
      name: "Bash",
      input: { command: `anthill-send workspace:80 "${body}"` },
    }],
  },
});

function collected(sessionId: string, overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: `codex:${sessionId}`,
    provider: "codex",
    sourceSessionId: sessionId,
    displayName: sessionId,
    cwd: "/tmp/atlas-sweep",
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

function fresh(name: string): string {
  const root = join(SCRATCH, name);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  return root;
}

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

describe("T10 sweep — lineageAgreement goldens", () => {
  const table = JSON.parse(
    readFileSync(join(FIXTURES, "lineage-agreement-truth-table.json"), "utf8"),
  ) as {
    cases: Array<{
      name: string;
      declaredParentAgentId: string | null;
      observedParentAgentId: string | null;
      expectedAgreement: LineageAgreement;
      expectedPublishedParent: string;
      expectedParentRoleSource?: RoleSource;
    }>;
  };

  test("truth table covers corroborated / contradicted / unobserved / subagent adoption", () => {
    const agreements = new Set(table.cases.map((c) => c.expectedAgreement));
    expect(agreements).toEqual(new Set(["corroborated", "contradicted", "unobserved"]));
    expect(table.cases.some((c) => c.declaredParentAgentId === null)).toBeTrue();
  });

  for (const row of table.cases) {
    test(row.name, () => {
      const childId = "child";
      const agents: CollectedAgent[] = [
        collected("declared-parent"),
        collected("other-parent"),
        collected("observed-parent"),
        collected(childId, {
          ...(row.observedParentAgentId
            ? { lineage: { observedParentAgentId: row.observedParentAgentId } }
            : {}),
        }),
      ];
      const manifests: RunManifest[] = row.declaredParentAgentId
        ? [{
            runId: "lineage-sweep",
            createdAt: "2026-08-05T10:00:00.000Z",
            repoRoot: "/tmp/atlas-sweep",
            orchestrator: {
              provider: "codex",
              sessionId: row.declaredParentAgentId.slice("codex:".length),
            },
            lanes: [{
              laneId: "child",
              role: "worker",
              provider: "codex",
              sessionId: childId,
            }],
          }]
        : [];

      const snapshot = buildSnapshot({
        agents,
        surfaces: [],
        runManifests: manifests,
        archiveStore,
        now: new Date("2026-08-05T10:05:00.000Z"),
      });
      const published = snapshot.programs.flatMap((p) => p.agents);
      const child = published.find((a) => a.id === `codex:${childId}`);
      expect(child?.parentAgentId).toBe(row.expectedPublishedParent);
      expect(child?.lineageAgreement).toBe(row.expectedAgreement);
      if (row.expectedParentRoleSource) {
        const parent = published.find((a) => a.id === row.expectedPublishedParent);
        expect(parent?.roleSource).toBe(row.expectedParentRoleSource);
      }
    });
  }
});

describe("T10 sweep — parked/blocked/done matrix (parked-then-asks)", () => {
  const table = JSON.parse(readFileSync(ATTENTION_TABLE, "utf8")) as {
    cases: Array<{ name: string; evidence: TaskAttentionEvidence; expected: boolean }>;
  };

  test("matrix includes the parked-then-asks re-alert litmus", () => {
    const litmus = table.cases.find((c) => c.name.includes("parked lane that asks later"));
    expect(litmus).toBeDefined();
    expect(litmus!.expected).toBe(true);
    expect(taskStateWantsHuman(litmus!.evidence)).toBe(true);
  });

  for (const row of table.cases) {
    test(row.name, () => {
      expect(taskStateWantsHuman(row.evidence)).toBe(row.expected);
    });
  }
});

describe("T10 sweep — forged-sender fixture (T5.1 rules)", () => {
  const table = JSON.parse(
    readFileSync(join(FIXTURES, "forged-sender-truth-table.json"), "utf8"),
  ) as {
    cases: Array<{
      name: string;
      claim: string;
      senderTail: { containsBody?: boolean; complete?: boolean; empty?: boolean } | null;
      expected: boolean | null;
    }>;
  };

  for (const row of table.cases) {
    test(row.name, () => {
      const longBody = `Goal: ${"verify provenance carefully ".repeat(20)}`.trim();
      const published = `${longBody.slice(0, 145).trimEnd()}…`;

      let lastUserMessage: string;
      let task: string | undefined;
      if (row.claim === "headed") lastUserMessage = headed();
      else if (row.claim === "truncated-headed") lastUserMessage = headed(published);
      else if (row.claim === "unheaded-current") {
        lastUserMessage = "Please re-run the focused test.";
        task = headed("the original kickoff");
      } else throw new Error(`unknown claim ${row.claim}`);

      const tails = new Map<string, { text: string; complete: boolean }>();
      if (row.senderTail) {
        if (row.senderTail.empty) {
          tails.set(SENDER, { text: "", complete: true });
        } else if (row.claim === "truncated-headed") {
          tails.set(SENDER, {
            text: transcriptWith(row.senderTail.containsBody ? longBody : "a different instruction"),
            complete: row.senderTail.complete !== false,
          });
        } else {
          const body = row.claim === "unheaded-current" ? "the original kickoff" : BODY;
          tails.set(SENDER, {
            text: transcriptWith(row.senderTail.containsBody ? body : "a different instruction"),
            complete: row.senderTail.complete !== false,
          });
        }
      }

      const verdict = senderVerificationFor({ lastUserMessage, task }, tails);
      expect(verdict ?? null).toBe(row.expected);
    });
  }
});

describe("T10 sweep — shim goldens", () => {
  for (const provider of ["cursor", "factory"] as const) {
    test(`${provider} fixture is a parser-contract golden`, () => {
      const store = JSON.parse(
        readFileSync(join(SHIM_FIXTURES, `${provider}-hook-sessions.json`), "utf8"),
      ) as {
        sessions: Record<string, Record<string, unknown>>;
        activeSessionsBySurface: Record<string, { sessionId: string; updatedAt: number }>;
      };
      const records = Object.values(store.sessions);
      expect(records.length).toBeGreaterThan(0);
      for (const record of records) {
        expect(recordMatchesParserContract(record)).toBeTrue();
      }
      expect(Object.keys(store.activeSessionsBySurface).length).toBeGreaterThan(0);
    });

    test(`${provider} upsert reproduces the golden binding fields under a temp root`, () => {
      const root = fresh(`shim-${provider}`);
      expect(root.startsWith(SCRATCH)).toBeTrue();
      expect(root.startsWith(REAL_CMUXTERM)).toBeFalse();
      const golden = JSON.parse(
        readFileSync(join(SHIM_FIXTURES, `${provider}-hook-sessions.json`), "utf8"),
      ) as { sessions: Record<string, Record<string, unknown>> };
      const [sessionId, goldenRecord] = Object.entries(golden.sessions)[0]!;

      upsertHookSessionRecord(root, provider, {
        sessionId,
        surfaceId: String(goldenRecord.surfaceId),
        workspaceId: String(goldenRecord.workspaceId),
        cwd: String(goldenRecord.cwd),
        pid: Number(goldenRecord.pid),
        agentLifecycle: goldenRecord.agentLifecycle as "unknown",
        updatedAt: Number(goldenRecord.updatedAt),
        launchCommand: goldenRecord.launchCommand as {
          executablePath: string;
          arguments: string[];
          workingDirectory: string;
        },
      });

      const written = JSON.parse(
        readFileSync(join(root, `${provider}-hook-sessions.json`), "utf8"),
      ) as { sessions: Record<string, Record<string, unknown>> };
      expect(written.sessions[sessionId]).toMatchObject({
        sessionId,
        surfaceId: goldenRecord.surfaceId,
        workspaceId: goldenRecord.workspaceId,
        cwd: goldenRecord.cwd,
        pid: goldenRecord.pid,
        agentLifecycle: goldenRecord.agentLifecycle,
        updatedAt: goldenRecord.updatedAt,
      });
      expect(recordMatchesParserContract(written.sessions[sessionId]!)).toBeTrue();
    });
  }
});

describe("T10 sweep — succession retirement substrate (T2 gated)", () => {
  test("T9 backfill history is the succession input; wire fields still await T2", () => {
    // Product has not landed succeededBy / supersedes / endEvidence:"superseded".
    expect(TYPES.includes("succeededBy")).toBeFalse();
    expect(TYPES.includes("supersedes")).toBeFalse();
    expect(TYPES.includes('"superseded"')).toBeFalse();

    const root = fresh("succession-history");
    expect(root.startsWith(REAL_RUNS)).toBeFalse();
    writeFileSync(join(root, "run-succ.json"), `${JSON.stringify({
      runId: "run-succ",
      createdAt: "2026-08-05T15:34:20.000Z",
      repoRoot: "/tmp/repo",
      orchestrator: { provider: "claude", sessionId: "orch" },
      lanes: [{
        laneId: "be-spine",
        role: "worker",
        provider: "codex",
        sessionId: "session-1",
        status: "active",
        statusAt: "2026-08-05T16:00:00.000Z",
      }],
    }, null, 2)}\n`);

    const result = writeLaneRegistration({
      root,
      runId: "run-succ",
      laneId: "be-spine",
      provider: "codex",
      sessionId: "session-2",
      mode: "backfill",
      statusAt: "2026-08-05T18:00:00.000Z",
    });
    expect(result).toMatchObject({ ok: true, wrote: true });

    const history = readFileSync(join(root, "run-succ.history.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(history).toEqual([expect.objectContaining({
      op: "backfill",
      laneId: "be-spine",
      previousSessionId: "session-1",
      sessionId: "session-2",
      succession: true,
    })]);
  });
});

describe("T10 sweep — origin-vs-path repoKeys (T3 gated)", () => {
  test("current repoKey is still common-dir FNV; origin-based identity awaits T3", () => {
    const commonDir = "/Users/example/Developer/shared.git";
    const pathBased = fnvKey(commonDir);
    // Until T3, two clones sharing an origin but different common-dirs get different keys.
    expect(fnvKey("/Users/example/Developer/clone-a/.git")).not.toBe(
      fnvKey("/Users/example/clones/clone-b/.git"),
    );
    expect(pathBased).toBe(fnvKey(commonDir));

    const identity = resolveRepoIdentity(process.cwd(), {
      exec: () => ({
        exitCode: 0,
        stdout: [
          commonDir,
          "/Users/example/Developer/lane-worktree",
          "ant-hill/hardening-harden2-20260805",
        ].join("\n"),
      }),
      realpath: (path) => path,
    });
    expect(identity?.repoKey).toBe(pathBased);
    // Contract lock for when T3 lands: origin-URL hashing is not yet the key source.
    expect(TYPES).not.toContain("originUrl");
  });
});
