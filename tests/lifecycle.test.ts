import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  activityBandOf,
  classifyLifecycle,
  processEvidenceOf,
  DEFAULT_FRESH_MS,
  DEFAULT_QUIET_MS,
  type LifecycleEvidence,
  type LifecycleThresholds,
} from "../src/server/lifecycle";
import type { LifecycleProvenance, LifecycleState } from "../src/shared/types";

/* The contract is a table, so the test is a table.

   Keeping the rows in a fixture rather than in this file is the point:
   tests/lifecycle-parity.test.ts reads the SAME file and runs it through the web
   client's mirror of this classifier. Two implementations that answer one
   question used to disagree — the server rescued a silent session with a live
   process and the client did not — and the only durable fix is a single written
   source of truth that both are made to satisfy. */

interface TruthTableCase {
  name: string;
  row: number;
  claim: string;
  evidence: LifecycleEvidence;
  expect: { lifecycle: LifecycleState; provenance: LifecycleProvenance; reason: string };
}

interface TruthTable {
  thresholds: LifecycleThresholds;
  cases: TruthTableCase[];
}

export const TRUTH_TABLE_PATH = join(import.meta.dir, "fixtures", "lifecycle-truth-table.json");

export function loadTruthTable(): TruthTable {
  return JSON.parse(readFileSync(TRUTH_TABLE_PATH, "utf8")) as TruthTable;
}

const table = loadTruthTable();

describe("the lifecycle truth table, executed by the server classifier", () => {
  for (const testCase of table.cases) {
    test(testCase.name, () => {
      expect(classifyLifecycle(testCase.evidence, table.thresholds)).toEqual(testCase.expect);
    });
  }
});

describe("the truth table covers the contract it claims to", () => {
  /* Rows 13-15 are not classifier rules. Row 13 is the newest-by-id merge in
     buildSnapshot, rows 14-15 are the attention overlay — both are asserted
     where they live, because a classifier that never sees a notification cannot
     demonstrate that a notification leaves it alone. */
  const CLASSIFIER_ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  test("every classifier row in the contract has at least one case", () => {
    const covered = new Set(table.cases.map((entry) => entry.row));
    expect([...covered].sort((a, b) => a - b)).toEqual(CLASSIFIER_ROWS);
  });

  test("no two cases share a name, so a failure names exactly one rule", () => {
    const names = table.cases.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("every case states the claim it is defending, not just the values", () => {
    for (const entry of table.cases) expect(entry.claim.length).toBeGreaterThan(20);
  });

  test("the fixture's thresholds are the shipped defaults", () => {
    expect(table.thresholds).toEqual({ freshMs: DEFAULT_FRESH_MS, quietMs: DEFAULT_QUIET_MS });
  });
});

describe("process evidence separates 'gone' from 'unanswered'", () => {
  test("a positive answer is alive", () => {
    expect(processEvidenceOf({ processAlive: true })).toBe("alive");
  });

  test("a negative answer about known ids is dead", () => {
    expect(processEvidenceOf({ processAlive: false, processIds: [1234] })).toBe("dead");
  });

  test("a negative answer about no ids is unavailable, because it answered nothing", () => {
    expect(processEvidenceOf({ processAlive: false })).toBe("unavailable");
    expect(processEvidenceOf({ processAlive: false, processIds: [] })).toBe("unavailable");
  });

  test("no answer at all is unavailable", () => {
    expect(processEvidenceOf({})).toBe("unavailable");
  });
});

describe("the bands are closed-open on both edges", () => {
  const thresholds = { freshMs: DEFAULT_FRESH_MS, quietMs: DEFAULT_QUIET_MS };

  test("the fresh band closes at the freshness threshold", () => {
    expect(activityBandOf(DEFAULT_FRESH_MS - 1, thresholds)).toBe("fresh");
    expect(activityBandOf(DEFAULT_FRESH_MS, thresholds)).toBe("recent");
  });

  test("the recent band closes at the quiet threshold", () => {
    expect(activityBandOf(DEFAULT_QUIET_MS - 1, thresholds)).toBe("recent");
    expect(activityBandOf(DEFAULT_QUIET_MS, thresholds)).toBe("quiet");
  });
});

describe("the thresholds are read, not baked in", () => {
  /* The settings panel offers Focused (2m / 15m) and Long-running (10m / 180m).
     If the classifier ignored its argument every case above would still pass,
     because they all run at the defaults. These two do not. */
  const focused: LifecycleThresholds = { freshMs: 2 * 60_000, quietMs: 15 * 60_000 };
  const longRunning: LifecycleThresholds = { freshMs: 10 * 60_000, quietMs: 180 * 60_000 };
  const quietFiveMinutes: LifecycleEvidence = { ageMs: 5 * 60_000 };

  test("five minutes of silence is waiting at the defaults", () => {
    expect(classifyLifecycle(quietFiveMinutes).lifecycle).toBe("waiting");
  });

  test("the same silence is still waiting under Focused, which shortens the quiet band to fifteen minutes", () => {
    const verdict = classifyLifecycle(quietFiveMinutes, focused);
    expect(verdict.lifecycle).toBe("waiting");
    expect(verdict.reason).toBe("No source activity in the last 2 minutes.");
  });

  test("Focused turns twenty minutes of unwatched silence into unverified, which the defaults still call waiting", () => {
    const twentyMinutes: LifecycleEvidence = { ageMs: 20 * 60_000 };
    expect(classifyLifecycle(twentyMinutes).lifecycle).toBe("waiting");
    expect(classifyLifecycle(twentyMinutes, focused).lifecycle).toBe("unverified");
  });

  test("Long-running keeps a session working for ten minutes and waiting for three hours", () => {
    expect(classifyLifecycle({ ageMs: 9 * 60_000 }, longRunning).lifecycle).toBe("working");
    expect(classifyLifecycle({ ageMs: 170 * 60_000 }, longRunning).lifecycle).toBe("waiting");
    expect(classifyLifecycle({ ageMs: 181 * 60_000 }, longRunning).lifecycle).toBe("unverified");
  });
});

describe("nothing unavailable is ever published as finished", () => {
  /* The single sentence this whole program exists to make true. Stated as its
     own assertion so that a future change which reintroduces the collapse fails
     with the reason, not just with a mismatched string. */
  test("no amount of silence finishes a session that nothing checked", () => {
    for (const ageMs of [DEFAULT_QUIET_MS, 6 * 3_600_000, 24 * 3_600_000, 30 * 86_400_000]) {
      expect(classifyLifecycle({ ageMs }).lifecycle).toBe("unverified");
      expect(classifyLifecycle({ ageMs, endEvidence: "turn-complete" }).lifecycle).toBe("unverified");
      expect(classifyLifecycle({ ageMs, processAlive: false }).lifecycle).toBe("unverified");
    }
  });

  test("an ending still needs a source, an operator, or a checked process", () => {
    const ageMs = 24 * 3_600_000;
    expect(classifyLifecycle({ ageMs, endEvidence: "session-exit" }).lifecycle).toBe("finished");
    expect(classifyLifecycle({ ageMs, operatorArchived: true }).lifecycle).toBe("finished");
    expect(classifyLifecycle({ ageMs, processAlive: false, processIds: [12] }).lifecycle).toBe("finished");
  });
});
