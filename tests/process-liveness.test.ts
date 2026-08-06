import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  livenessOf,
  livenessOfAny,
  processAliveFrom,
  type ProcessLiveness,
  type ProcessRoster,
} from "../src/server/process-liveness";

interface TruthCase {
  name: string;
  claim: string;
  handle: { pid: number; startSeconds?: number };
  roster: {
    complete: boolean;
    starts?: [number, number][];
    livePids?: number[];
    agentPids?: number[];
  };
  expect: ProcessLiveness;
}

const table = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "process-liveness-truth-table.json"), "utf8"),
) as { cases: TruthCase[]; invariants: string[] };

function rosterFrom(spec: TruthCase["roster"]): ProcessRoster {
  return {
    complete: spec.complete,
    ...(spec.starts ? { startsByPid: new Map(spec.starts) } : {}),
    ...(spec.livePids ? { livePids: new Set(spec.livePids) } : {}),
    ...(spec.agentPids ? { agentPids: new Set(spec.agentPids) } : {}),
  };
}

describe("the pid-to-liveness contract", () => {
  for (const testCase of table.cases) {
    test(testCase.name, () => {
      expect(
        livenessOf(testCase.handle, rosterFrom(testCase.roster)),
        testCase.claim,
      ).toBe(testCase.expect);
    });
  }

  test("the table covers every verdict it claims to decide", () => {
    const covered = new Set(table.cases.map((testCase) => testCase.expect));
    expect([...covered].sort()).toEqual(["alive", "gone", "unverifiable"]);
  });
});

/* The table above says what the rules ARE. This says what they may never do,
   across the whole evidence space rather than the rows someone thought to
   write down — which is the failure mode that produced the bug: four sites,
   each correct about the cases its author considered. */
describe("liveness invariants hold across the entire evidence space", () => {
  const PID = 4242;
  const RECORDED_START = 1_785_933_001;

  const rosters: { label: string; roster: ProcessRoster; inUse: boolean; corroborates: boolean }[] = [];
  for (const complete of [true, false]) {
    for (const inUse of [true, false]) {
      for (const agentPid of [true, false]) {
        for (const shape of ["starts", "livePids", "neither"] as const) {
          for (const observedStart of [RECORDED_START, RECORDED_START + 7]) {
            if (shape === "neither" && observedStart !== RECORDED_START) continue;
            const roster: ProcessRoster = {
              complete,
              ...(shape === "starts"
                ? { startsByPid: new Map(inUse ? [[PID, observedStart]] : []) }
                : {}),
              ...(shape === "livePids" ? { livePids: new Set(inUse ? [PID] : []) } : {}),
              ...(agentPid && inUse ? { agentPids: new Set([PID]) } : {}),
            };
            rosters.push({
              label: `complete=${complete} inUse=${inUse} agent=${agentPid} shape=${shape} start=${observedStart}`,
              roster,
              inUse,
              corroborates: shape === "starts" && inUse && observedStart === RECORDED_START,
            });
          }
        }
      }
    }
  }

  const handles = [
    { label: "start recorded", handle: { pid: PID, startSeconds: RECORDED_START } },
    { label: "no start recorded", handle: { pid: PID } },
  ];

  test("an incomplete roster never produces a verdict", () => {
    for (const { label, roster } of rosters.filter((entry) => !entry.roster.complete)) {
      for (const { handle } of handles) {
        expect(livenessOf(handle, roster), label).toBe("unverifiable");
      }
    }
  });

  test("a handle with no recorded start time is never called gone while its number is in use", () => {
    /* The invariant that keeps a rename from becoming a funeral: with no start
       time there is nothing to disprove, so an unfamiliar command must yield
       doubt, never death. */
    for (const { label, roster, inUse } of rosters) {
      if (!inUse) continue;
      expect(livenessOf({ pid: PID }, roster), label).not.toBe("gone");
    }
  });

  test("alive is only ever claimed with a matching start time or an agent holding the pid", () => {
    for (const { label, roster, corroborates } of rosters) {
      for (const { handle } of handles) {
        if (livenessOf(handle, roster) !== "alive") continue;
        const provenByStart = corroborates && handle.startSeconds === RECORDED_START;
        const presumedByName = roster.agentPids?.has(PID) === true;
        expect(provenByStart || presumedByName, `unsupported alive: ${label}`).toBeTrue();
      }
    }
  });

  test("gone is only ever claimed when the number is unused or a start time disagrees", () => {
    for (const { label, roster, inUse } of rosters) {
      for (const { handle } of handles) {
        if (livenessOf(handle, roster) !== "gone") continue;
        const observed = roster.startsByPid?.get(PID);
        const disagrees = handle.startSeconds !== undefined
          && observed !== undefined
          && observed !== handle.startSeconds;
        expect(!inUse || disagrees, `unsupported gone: ${label}`).toBeTrue();
      }
    }
  });
});

describe("combining handles and publishing the answer", () => {
  const roster: ProcessRoster = {
    complete: true,
    startsByPid: new Map([[1, 100], [2, 200]]),
    agentPids: new Set([1]),
  };

  test("no handles at all is unknown, not death", () => {
    expect(livenessOfAny([], roster)).toBe("unverifiable");
  });

  test("one live handle carries the session", () => {
    expect(livenessOfAny([{ pid: 9, startSeconds: 1 }, { pid: 1, startSeconds: 100 }], roster))
      .toBe("alive");
  });

  test("a single doubt outranks a proven ending", () => {
    /* Burying a session on partial evidence costs more than leaving it
       unresolved, so the weaker verdict wins when they disagree. */
    expect(livenessOfAny([{ pid: 9, startSeconds: 1 }, { pid: 2 }], roster)).toBe("unverifiable");
  });

  test("every handle proven gone is gone", () => {
    expect(livenessOfAny([{ pid: 9, startSeconds: 1 }, { pid: 8, startSeconds: 2 }], roster))
      .toBe("gone");
  });

  test("unverifiable publishes as undefined, never false", () => {
    /* `false` carries pids into processEvidenceOf as "dead" and renders as an
       ending the board never witnessed. */
    expect(processAliveFrom("unverifiable")).toBeUndefined();
    expect(processAliveFrom("alive")).toBeTrue();
    expect(processAliveFrom("gone")).toBeFalse();
  });
});
