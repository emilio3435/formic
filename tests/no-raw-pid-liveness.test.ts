import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/* The bug this file exists to prevent from coming back.
 *
 * Four separate call sites independently decided that a pid found in the
 * process table meant its session was running — collectors.ts from the hook
 * store, identity.ts for attributed and for stale pids, and the bindings
 * bridge. Each was locally reasonable. Together they put 15 dead sessions on
 * the board as live, two of them riding pids the kernel had handed to
 * `siriknowledged` and `sysextd`.
 *
 * Centralising the rule in process-liveness.ts fixes the four that existed. It
 * does nothing about the fifth, which is why this is a test and not a comment:
 * a raw membership test against a pid collection is now a build failure
 * wherever the answer could become a liveness claim.
 *
 * This is a lint, so it is deliberately literal. If it fires on something
 * legitimate, the fix is to route the decision through process-liveness.ts —
 * or, if the code genuinely is not deciding liveness, to name the collection
 * something that is not about liveness. */

const SERVER_DIR = join(import.meta.dir, "..", "src", "server");

/** The sanctioned home for this judgement, plus the scan that builds its input. */
const EXEMPT = new Set(["process-liveness.ts", "process-lineage.ts", "process-witness.ts"]);

/* Collections of pids whose membership says only "this number is in use". A
   `.has`/`.includes` against one of these is the exact substitution that
   caused the bug: presence standing in for identity. */
const PID_COLLECTIONS = [
  "liveProcessIds",
  "liveAgentProcessIds",
  "recognizedProcessIds",
  "recognizedAgentProcessIds",
  "livePids",
  "agentPids",
  "processStarts",
  "startsByPid",
];

const MEMBERSHIP = PID_COLLECTIONS.map((name) => ({
  name,
  // `x.has(pid)`, `x.includes(pid)`, and `pids.some(p => x.has(p))` alike.
  pattern: new RegExp(`\\b${name}\\??\\.(?:has|includes|get)\\s*\\(`),
}));

function sourceLines(file: string): { line: string; number: number }[] {
  return readFileSync(join(SERVER_DIR, file), "utf8")
    .split("\n")
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => {
      const trimmed = line.trim();
      // Comments describe the rule constantly; they are not call sites.
      return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
    });
}

describe("no call site may re-invent the pid-to-liveness rule", () => {
  const files = readdirSync(SERVER_DIR).filter((name) => name.endsWith(".ts"));

  test("the server modules under guard are actually present", () => {
    // A rename that silently emptied this list would make every case below vacuous.
    expect(files.length).toBeGreaterThan(20);
    for (const exempt of EXEMPT) expect(files).toContain(exempt);
  });

  for (const file of readdirSync(SERVER_DIR).filter((name) => name.endsWith(".ts"))) {
    if (EXEMPT.has(file)) continue;
    test(`${file} asks process-liveness.ts rather than testing pid membership`, () => {
      const offenders = sourceLines(file).flatMap(({ line, number }) =>
        MEMBERSHIP.filter(({ pattern }) => pattern.test(line))
          .map(({ name }) => `${file}:${number} tests membership of \`${name}\`: ${line.trim()}`),
      );
      expect(
        offenders,
        "A pid found in a process table proves a number is in use, not that a session is alive. "
          + "Route this through livenessOf/livenessOfAny in src/server/process-liveness.ts, which "
          + "requires the start time that makes the number checkable.",
      ).toEqual([]);
    });
  }
});
