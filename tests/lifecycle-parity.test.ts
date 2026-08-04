import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyLifecycle as classifyOnServer,
  DEFAULT_FRESH_MS,
  DEFAULT_QUIET_MS,
  type LifecycleEvidence,
  type LifecycleThresholds,
} from "../src/server/lifecycle";
import type { LifecycleProvenance, LifecycleState } from "../src/shared/types";

/* The file that makes "one classifier" a checkable claim rather than an
   intention.

   Server and client each need to answer "is this session over?" — the server
   for the wire, the client for the fallback when a snapshot arrives without the
   field. Before this, the two answered differently: the server rescued a quiet
   session whose process was demonstrably alive, `deriveActivity` did not, and
   the same session read alive on one surface and finished on the other.

   So the rules live in a fixture neither implementation owns, and both are
   executed against it here. A rule added to one and forgotten in the other
   fails on this file, naming the case. */

interface TruthTableCase {
  name: string;
  row: number;
  claim: string;
  evidence: LifecycleEvidence;
  expect: { lifecycle: LifecycleState; provenance: LifecycleProvenance; reason: string };
}

const table = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "lifecycle-truth-table.json"), "utf8"),
) as { thresholds: LifecycleThresholds; cases: TruthTableCase[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any;

beforeAll(async () => {
  // @ts-expect-error The dependency-free browser client intentionally has no declaration file.
  client = await import("../src/web/lifecycle.js");
});

describe("the truth table, executed by the client mirror", () => {
  for (const testCase of table.cases) {
    test(testCase.name, () => {
      expect(client.classifyLifecycle(testCase.evidence, table.thresholds)).toEqual(testCase.expect);
    });
  }
});

describe("server and client answer identically, case by case", () => {
  for (const testCase of table.cases) {
    test(`${testCase.name} — same verdict on both sides`, () => {
      expect(client.classifyLifecycle(testCase.evidence, table.thresholds))
        .toEqual(classifyOnServer(testCase.evidence, table.thresholds));
    });
  }
});

describe("the mirror agrees away from the fixture too", () => {
  /* The fixture pins the rules that were written down. This sweeps the space
     between them, because a divergence in an unwritten corner is still a
     divergence — and the corner most likely to hide one is a threshold the
     fixture never runs at. */
  const AGES_MS = [
    0, 1, 60_000, DEFAULT_FRESH_MS - 1, DEFAULT_FRESH_MS, DEFAULT_FRESH_MS + 1,
    10 * 60_000, 44 * 60_000, DEFAULT_QUIET_MS - 1, DEFAULT_QUIET_MS, DEFAULT_QUIET_MS + 1,
    90 * 60_000, 5 * 3_600_000, 47 * 3_600_000, 49 * 3_600_000, 30 * 86_400_000,
  ];
  const END_EVIDENCE = [undefined, "session-exit", "turn-complete"] as const;
  const PROCESS = [
    {},
    { processAlive: true, processIds: [4242] },
    { processAlive: false, processIds: [4242] },
    { processAlive: false },
  ];
  const THRESHOLDS: LifecycleThresholds[] = [
    { freshMs: DEFAULT_FRESH_MS, quietMs: DEFAULT_QUIET_MS },
    { freshMs: 2 * 60_000, quietMs: 15 * 60_000 },
    { freshMs: 10 * 60_000, quietMs: 180 * 60_000 },
  ];

  test("every combination of age, end evidence, process state, archive flag and thresholds agrees", () => {
    let compared = 0;
    for (const thresholds of THRESHOLDS) {
      for (const ageMs of AGES_MS) {
        for (const endEvidence of END_EVIDENCE) {
          for (const process of PROCESS) {
            for (const operatorArchived of [false, true]) {
              const evidence = { ageMs, endEvidence, operatorArchived, ...process } as LifecycleEvidence;
              expect(
                client.classifyLifecycle(evidence, thresholds),
                `client and server disagree on ${JSON.stringify(evidence)}`,
              ).toEqual(classifyOnServer(evidence, thresholds));
              compared += 1;
            }
          }
        }
      }
    }
    // A silent zero here would make the sweep above a decoration.
    expect(compared).toBe(
      THRESHOLDS.length * AGES_MS.length * END_EVIDENCE.length * PROCESS.length * 2,
    );
  });

  test("retained records agree on every persisted verdict, including none", () => {
    const PERSISTED = [
      undefined,
      { lifecycle: "finished", provenance: "provider-exit" },
      { lifecycle: "finished", provenance: "operator-archive" },
      { lifecycle: "finished", provenance: "process-died" },
      { lifecycle: "waiting", provenance: "turn-complete" },
      { lifecycle: "unverified", provenance: "no-evidence" },
      { lifecycle: "working", provenance: "recency" },
    ];
    for (const persisted of PERSISTED) {
      const evidence = { ageMs: 30 * 86_400_000, scope: "retained", persisted } as LifecycleEvidence;
      expect(client.classifyLifecycle(evidence)).toEqual(classifyOnServer(evidence));
    }
  });

  test("both sides carry the same default thresholds", () => {
    expect(client.DEFAULT_FRESH_MS).toBe(DEFAULT_FRESH_MS);
    expect(client.DEFAULT_QUIET_MS).toBe(DEFAULT_QUIET_MS);
  });
});

describe("the fallback reads the server's verdict before guessing at one", () => {
  test("a published lifecycle is used as-is, never recomputed", () => {
    /* The precedence every other derive* helper on this client already follows:
       a backend field wins. Recomputing over a served verdict is how two
       classifiers get back into the same snapshot. */
    const verdict = client.deriveLifecycle({
      lifecycle: "unverified",
      provenance: "no-evidence",
      statusReason: "No activity in 5h and no process evidence — could not verify an ending.",
      status: "running",
      updatedAt: new Date().toISOString(),
    });
    expect(verdict.lifecycle).toBe("unverified");
    expect(verdict.provenance).toBe("no-evidence");
  });

  test("a snapshot with no lifecycle field is classified from the fields that predate it", () => {
    const nowMs = Date.parse("2026-08-04T12:00:00.000Z");
    const quietHoursAgo = {
      status: "stale",
      updatedAt: "2026-08-04T07:00:00.000Z",
    };
    expect(client.deriveLifecycle(quietHoursAgo, undefined, nowMs).lifecycle).toBe("unverified");
  });

  test("the legacy stale-plus-live-process rescue the old fallback was missing now happens", () => {
    /* This is the divergence that motivated the whole file. The server called
       this session idle; `deriveActivity` called it ended. */
    const nowMs = Date.parse("2026-08-04T12:00:00.000Z");
    const staleButAlive = {
      status: "stale",
      updatedAt: "2026-08-04T09:00:00.000Z",
      processAlive: true,
      processIds: [4242],
    };
    expect(client.deriveLifecycle(staleButAlive, undefined, nowMs).lifecycle).toBe("waiting");
  });

  test("a legacy archived status still reads as finished, and names the reason it can defend", () => {
    /* On a snapshot this old, an operator archive and a source exit are
       indistinguishable. Claiming "you archived this" when nobody did is the
       worse of the two errors, so the fallback claims the other one. */
    const nowMs = Date.parse("2026-08-04T12:00:00.000Z");
    const archived = { status: "archived", updatedAt: "2026-08-04T11:59:00.000Z" };
    const verdict = client.deriveLifecycle(archived, undefined, nowMs);
    expect(verdict.lifecycle).toBe("finished");
    expect(verdict.provenance).toBe("provider-exit");
  });

  test("an unparseable updatedAt does not silently age a session into unverified", () => {
    const verdict = client.deriveLifecycle({ status: "running", updatedAt: "not a date" });
    expect(verdict.lifecycle).toBe("working");
  });
});
