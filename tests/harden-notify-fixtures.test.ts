/**
 * Harden-notify fixture lock for the confidence-header + notification-center
 * program. Goldens run against detectAttentionSignal now. The promotion table
 * executes fe-notify's hasCurrentImpact. attentionClass on the wire is still
 * be-dwell's — the client falls back to attentionSignal.kind until it lands.
 * standbyMs / dead-time hero are never required: S0-T1 found no defensible
 * stable entry clock for blockedSince.
 *
 * Hermetic — safe for `bun run test:ci`. Reads only in-repo fixtures and docs
 * via import.meta.dir. No ~/.cmuxterm, ~/.anthill, localhost, or live git state.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  detectAttentionSignal,
  type AttentionSignalInput,
  type AttentionSignalKind,
} from "../src/server/attention-signal";
import {
  taskStateWantsHuman,
  type TaskAttentionEvidence,
} from "../src/server/task-state";

const FIXTURES = join(import.meta.dir, "fixtures");

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
}

const ALL_KINDS: readonly AttentionSignalKind[] = [
  "permission-requested",
  "input-requested",
  "fork-unresolved",
  "handoff-stated",
  "question-pending",
  "assumption-stated",
  "stalled-active",
  "nothing-wanted",
  "out-of-scope",
  "not-readable",
];

interface GoldenCase {
  name: string;
  claim: string;
  kind: AttentionSignalKind;
  attentionClass: "blocking" | "noticed" | null;
  input: AttentionSignalInput;
  expect: {
    kind: AttentionSignalKind;
    nextAction?: string;
    evidence?: string;
    evidenceContains?: string;
    nextActionAbsent?: boolean;
    evidenceAbsent?: boolean;
  };
}

interface MatrixRow {
  kind: AttentionSignalKind;
  attentionClass: "blocking" | "noticed" | null;
  why: string;
}

interface PromotionCase {
  name: string;
  claim: string;
  item: { id: string; route: { kind: string; id: string }; severity?: string };
  snap: Record<string, unknown>;
  expect: {
    live: boolean;
    surface: string;
    reason?: string;
    drawer?: string;
    blockingFeed?: boolean;
    verdictTone?: string;
  };
}

interface StandbyCase {
  name: string;
  claim: string;
  expect: {
    pulse: { blocked: number };
    standbyMs: { presenceNotRequired: boolean; never: number; allowed?: Array<null | string> };
    hero: { presenceNotRequired: boolean; mustNotInventZero: boolean };
  };
}

const golden = readJson<{ purpose: string; cases: GoldenCase[] }>(
  "attention-signal-kinds-golden.json",
);
const matrix = readJson<{ purpose: string; rows: MatrixRow[]; allowedClasses: string[] }>(
  "attention-class-matrix.json",
);
const promotion = readJson<{ purpose: string; cases: PromotionCase[] }>(
  "notification-promotion-truth-table.json",
);
const standby = readJson<{ purpose: string; s0t1: { finding: string }; cases: StandbyCase[] }>(
  "standby-unmeasurable.json",
);
const heartbeat = readJson<{
  purpose: string;
  claim: string;
  wireExpectation: string;
  passes: Array<{ name: string; at: string; expect: { blockedSince: string; deadTimeMs: number; deadTimeMustNotDrop?: boolean } }>;
  antiCases: Array<{ name: string; forbidden: unknown }>;
}>("heartbeat-churn.json");
const parked = readJson<{
  purpose: string;
  cases: Array<{
    name: string;
    claim: string;
    evidence: TaskAttentionEvidence;
    expect: { wantsHuman: boolean; attentionClass: "blocking" | null; reAlert: boolean };
  }>;
}>("parked-then-asks.json");
const history = readJson<{
  purpose: string;
  drawerRenderersMustInclude: string[];
  cases: Array<{
    name: string;
    claim: string;
    demotion: string;
    item: { id: string; route: { kind: string; id: string } };
    snap: { recentlyResolved: Array<{ id: string }> };
    expect: { inRecentlyResolvedOf: boolean; routeKind: string; drawerRenderer: string };
  }>;
}>("notification-history-routes.json");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let notify: any;

beforeAll(async () => {
  // @ts-expect-error dependency-free browser module
  notify = await import("../src/web/notification-center.js");
});

describe("attention-signal kinds golden", () => {
  test("purpose names why absence is a case", () => {
    expect(golden.purpose).toMatch(/absence/i);
    expect(golden.purpose).toMatch(/AttentionSignalKind/);
  });

  test("every AttentionSignalKind has exactly one golden", () => {
    const kinds = golden.cases.map((c) => c.kind);
    expect(new Set(kinds).size).toBe(ALL_KINDS.length);
    expect(kinds.sort()).toEqual([...ALL_KINDS].sort());
  });

  for (const row of golden.cases) {
    test(`${row.name}`, () => {
      expect(row.claim.length).toBeGreaterThan(40);
      const signal = detectAttentionSignal(row.input);
      expect(signal.kind).toBe(row.expect.kind);
      expect(signal.kind).toBe(row.kind);

      if (row.expect.nextAction !== undefined) {
        expect(signal.nextAction).toBe(row.expect.nextAction);
      }
      if (row.expect.evidence !== undefined) {
        expect(signal.evidence).toBe(row.expect.evidence);
      }
      if (row.expect.evidenceContains !== undefined) {
        expect(signal.evidence).toContain(row.expect.evidenceContains);
      }
      if (row.expect.nextActionAbsent) {
        expect(signal.nextAction).toBeUndefined();
      }
      if (row.expect.evidenceAbsent) {
        expect(signal.evidence).toBeUndefined();
      }
    });
  }
});

describe("attention-class matrix", () => {
  test("partitions every kind and forbids a third class", () => {
    expect(matrix.allowedClasses).toEqual(["blocking", "noticed"]);
    const kinds = matrix.rows.map((r) => r.kind);
    expect(new Set(kinds).size).toBe(ALL_KINDS.length);
    expect(kinds.sort()).toEqual([...ALL_KINDS].sort());
  });

  test("golden attentionClass agrees with the matrix", () => {
    const byKind = new Map(matrix.rows.map((r) => [r.kind, r.attentionClass]));
    for (const row of golden.cases) {
      expect(byKind.get(row.kind)).toBe(row.attentionClass);
    }
  });

  test("blocking / noticed / absent match S0-T2", () => {
    const blocking = matrix.rows.filter((r) => r.attentionClass === "blocking").map((r) => r.kind).sort();
    const noticed = matrix.rows.filter((r) => r.attentionClass === "noticed").map((r) => r.kind).sort();
    const absent = matrix.rows.filter((r) => r.attentionClass === null).map((r) => r.kind).sort();

    expect(blocking).toEqual([
      "assumption-stated",
      "fork-unresolved",
      "handoff-stated",
      "input-requested",
      "permission-requested",
      "question-pending",
    ]);
    expect(noticed).toEqual(["stalled-active"]);
    expect(absent).toEqual(["not-readable", "nothing-wanted", "out-of-scope"]);
  });

  test("client attentionClassOf agrees with the matrix for every golden kind", () => {
    for (const row of matrix.rows) {
      const agent = {
        id: `codex:${row.kind}`,
        lifecycle: "waiting",
        taskState: row.kind === "stalled-active" ? "active" : undefined,
        taskStateSource: row.kind === "stalled-active" ? "manifest" : undefined,
        attentionSignal: { kind: row.kind },
      };
      expect(notify.attentionClassOf(agent)).toBe(row.attentionClass);
    }
  });

  for (const row of matrix.rows) {
    test(`${row.kind} carries a why`, () => {
      expect(row.why.length).toBeGreaterThan(20);
    });
  }
});

describe("§4.3 promotion truth table", () => {
  test("covers every plan row including stale-without-current-impact and declared-done", () => {
    const names = promotion.cases.map((c) => c.name).join("\n");
    expect(names).toMatch(/stale-without-current-impact/);
    expect(names).toMatch(/declared done/i);
    expect(names).toMatch(/nothing-wanted/);
    expect(names).toMatch(/verifying/);
    expect(names).toMatch(/resolved/);
    expect(names).toMatch(/blocking/);
    expect(names).toMatch(/source healthy/i);
  });

  for (const row of promotion.cases) {
    test(`${row.name}`, () => {
      expect(row.claim.length).toBeGreaterThan(30);
      expect(["center", "history", "audit", "never"]).toContain(row.expect.surface);
      expect(notify.hasCurrentImpact(row.item, row.snap)).toBe(row.expect.live);

      if (row.expect.blockingFeed === false) {
        expect(row.item.severity).not.toBe("blocking");
        const agent = (row.snap.programs as Array<{ agents: Array<{ id: string }> }>)[0]
          ?.agents.find((a) => a.id === row.item.route.id);
        expect(notify.attentionClassOf(agent)).toBe("noticed");
      }

      if (row.expect.surface === "history" && row.expect.drawer === "resolved") {
        const pool = row.snap.recentlyResolved as Array<{ id: string }> | undefined;
        expect(pool?.some((issue) => issue.id === row.item.id)).toBe(true);
      }
    });
  }
});

describe("standby unmeasurable fixture", () => {
  test("records the S0-T1 finding: no defensible entry clock", () => {
    expect(standby.s0t1.finding).toMatch(/no defensible/i);
    expect(standby.purpose).toMatch(/may never arrive/i);
    expect(standby.purpose).toMatch(/EXPECTED state/i);
  });

  for (const row of standby.cases) {
    test(`${row.name}`, () => {
      expect(row.claim.length).toBeGreaterThan(40);
      expect(row.expect.pulse.blocked).toBeGreaterThan(0);
      expect(row.expect.standbyMs.presenceNotRequired).toBe(true);
      expect(row.expect.standbyMs.never).toBe(0);
      expect(row.expect.hero.presenceNotRequired).toBe(true);
      expect(row.expect.hero.mustNotInventZero).toBe(true);
      // No row may require a publishable standbyMs or a shown hero.
      expect(JSON.stringify(row.expect)).not.toMatch(/"shown"\s*:\s*true/);
      expect(JSON.stringify(row.expect)).not.toMatch(/"standbyMs"\s*:\s*\d+/);
    });
  }
});

describe("heartbeat-churn fixture", () => {
  test("is a regression guard, not a requirement that blockedSince exists today", () => {
    expect(heartbeat.wireExpectation).toMatch(/may be permanently absent/i);
    expect(heartbeat.purpose).toMatch(/may never ship/i);
    expect(heartbeat.claim).toMatch(/heartbeat cannot reset/i);
  });

  test("dead time only grows while needsInput holds — if the clock ever lands", () => {
    let previousDead = -1;
    const entrySince = heartbeat.passes[0]!.expect.blockedSince;
    for (const pass of heartbeat.passes) {
      expect(pass.expect.blockedSince).toBe(entrySince);
      expect(pass.expect.deadTimeMs).toBeGreaterThanOrEqual(previousDead);
      if (pass.expect.deadTimeMustNotDrop) {
        expect(pass.expect.deadTimeMs).toBeGreaterThan(previousDead);
      }
      previousDead = pass.expect.deadTimeMs;
    }
  });

  test("forbids equating blockedSince with the heartbeat write time after entry", () => {
    expect(heartbeat.antiCases.length).toBeGreaterThan(0);
    expect(JSON.stringify(heartbeat.antiCases)).toMatch(/updatedAt/);
  });
});

describe("parked-then-asks precedence", () => {
  for (const row of parked.cases) {
    test(`${row.name}`, () => {
      expect(row.claim.length).toBeGreaterThan(30);
      expect(taskStateWantsHuman(row.evidence)).toBe(row.expect.wantsHuman);
      /* Live path — fixture.expect.attentionClass alone is hollow (mutation:
         disable declaredQuiet in attentionClassOf stayed GREEN here). */
      const shaped = {
        id: `codex:${row.name}`,
        programId: "project",
        ...row.evidence,
        attentionSignal: (row.evidence as { attentionSignal?: { kind: string } }).attentionSignal
          || { kind: "question-pending" },
      };
      expect(notify.attentionClassOf(shaped)).toBe(row.expect.attentionClass);
    });
  }
});

describe("S5-T1 history routes", () => {
  test("required demotions each resolve into recentlyResolved", () => {
    const demotions = new Set(history.cases.map((c) => c.demotion));
    expect(demotions.has("resolved")).toBe(true);
    expect(demotions.has("verified-without-impact")).toBe(true);
    expect(demotions.has("stale-without-current-impact")).toBe(true);
  });

  test("promotion history demotions share ids with the history-routes fixture", () => {
    const historyIds = new Set(history.cases.map((c) => c.item.id));
    const promotionHistory = promotion.cases.filter(
      (c) => c.expect.surface === "history" && c.expect.drawer === "resolved",
    );
    expect(promotionHistory.length).toBeGreaterThanOrEqual(3);
    for (const row of promotionHistory) {
      expect(historyIds.has(row.item.id), row.name).toBe(true);
    }
  });

  for (const row of history.cases) {
    test(`${row.name}`, async () => {
      expect(row.claim.length).toBeGreaterThan(30);
      // @ts-expect-error dependency-free browser module
      const { recentlyResolvedOf } = await import("../src/web/presentation.js");
      const pool = recentlyResolvedOf(row.snap);
      const found = pool.some((issue: { id: string }) => issue.id === row.item.id);
      expect(found).toBe(row.expect.inRecentlyResolvedOf);
      expect(row.item.route.kind).toBe(row.expect.routeKind);
      expect(row.expect.drawerRenderer).toBe("resolved");
    });
  }

  test("resolved remains a DRAWER_RENDERERS key in app.js", () => {
    const app = readFileSync(join(import.meta.dir, "../src/web/app.js"), "utf8");
    expect(app).toMatch(/const DRAWER_RENDERERS\s*=\s*\{[\s\S]*?\bresolved\s*:/);
    for (const key of history.drawerRenderersMustInclude) {
      expect(app).toMatch(new RegExp(`\\b${key}\\s*:`));
    }
  });
});

describe("docs parity — notification-center vocabulary", () => {
  const guide = () => readFileSync(join(import.meta.dir, "../ANT-GUIDE.md"), "utf8");
  const design = () => readFileSync(join(import.meta.dir, "../DESIGN-LANGUAGE.md"), "utf8");
  const cleanupDoc = () => readFileSync(join(import.meta.dir, "../docs/CLEANUP-SWEEP.md"), "utf8");
  const notifySrc = () => readFileSync(join(import.meta.dir, "../src/web/notification-center.js"), "utf8");

  test("ANT-GUIDE names the three item kinds and the blocking/noticed split", () => {
    const g = guide();
    expect(g).toContain("**handoff**");
    expect(g).toContain("**dataflow**");
    expect(g).toContain("**investigation**");
    expect(g).toMatch(/\*\*blocking\*\*/);
    expect(g).toMatch(/\*\*noticed\*\*/);
    expect(g).toMatch(/Ember means a person/i);
    expect(g).toContain("stalled-active");
    expect(g).toContain("nothing-wanted");
  });

  test("DESIGN-LANGUAGE reserves ember fill for a person-blocker", () => {
    const d = design();
    expect(d).toMatch(/Notification center badge/i);
    expect(d).toMatch(/Ember fill is reserved for severity `blocking`/);
    expect(d).toMatch(/amber outline/i);
    expect(d).toMatch(/never deletes/i);
  });

  test("notification-center.js still encodes the ember-means-a-person rule", () => {
    const src = notifySrc();
    expect(src).toMatch(/severity "blocking" means A PERSON IS THE BLOCKER/);
    expect(src).toContain('kind: "handoff"');
    expect(src).toContain('kind: "dataflow"');
    expect(src).toContain('kind: "investigation"');
  });

  test("CLEANUP-SWEEP.md is the fe-notify propose contract", () => {
    const doc = cleanupDoc().replace(/\s+/g, " ");
    expect(doc).toMatch(/THE BOARD NEVER DELETES/);
    expect(doc).toContain("confirmCommand");
    expect(doc).toContain("removable");
    expect(doc).toContain("refused");
    expect(doc).toContain("--json");
    expect(doc).toMatch(/No destructive server endpoint/i);
  });
});
