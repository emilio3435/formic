import { describe, expect, test } from "bun:test";
import { executeControl } from "../src/server/control";
import { controlsFor } from "../src/server/snapshot-agent";
import type { ArchiveStore, CollectedAgent, CommandResult, CommandRunner } from "../src/server/types";
import type { AgentSnapshot, CmuxTarget, ProcessState } from "../src/shared/types";

/* The button and the endpoint must not be able to disagree.

   Twice now they have. 547679e gated control.ts on attestation and left app.ts
   advertising the same write. 26a4585 gated control.ts on liveness and left
   controlsFor returning `instruct: enabled` for a row whose process was known
   dead — the board offering Send, the server answering 409. Nothing unsafe
   happened either time, which is exactly why it is worth fixing: a surface
   claiming something the system will not honour is the defect class this
   project has spent two days removing.

   Both failures had the same cause. Agreement depended on two call sites being
   edited together, and twice they were not. It is now one predicate,
   transmitRefusal, and this file pins the AGREEMENT rather than the two sides
   separately — asserting each independently is what has repeatedly passed while
   the pair was broken.

   Acceptance criterion 5 of the mayTransmit spec, as an invariant. */

const OK: CommandResult = { exitCode: 0, stdout: "", stderr: "", timedOut: false };
const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };

class RecordingRunner implements CommandRunner {
  readonly commands: string[][] = [];
  async run(command: readonly string[]): Promise<CommandResult> {
    this.commands.push([...command]);
    return OK;
  }
}

const TARGETS: Array<[string, CmuxTarget]> = [
  ["attested", { surfaceId: "S1", resolution: "exact" }],
  ["attested but remembered", { surfaceId: "S1", resolution: "exact", attestation: "remembered" }],
  ["matched by folder", { surfaceId: "S1", resolution: "unique-cwd", reason: "Matched by cwd." }],
  ["ambiguous", { surfaceId: "S1", resolution: "ambiguous", reason: "Two surfaces matched." }],
  ["no surface", { resolution: "missing", reason: "No cmux surface matches." }],
  ["exact with no surface id", { resolution: "exact" }],
];

const PROCESS_STATES: ProcessState[] = ["running", "exited", "died", "unknown"];

function collected(processState: ProcessState): CollectedAgent {
  return {
    id: "codex:alpha",
    provider: "codex",
    sourceSessionId: "alpha",
    displayName: "Alpha",
    cwd: "/Users/me/project",
    status: "running",
    statusReason: "Fixture activity.",
    updatedAt: new Date().toISOString(),
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    // processStateFor() derives the wire value from exactly these three.
    ...(processState === "running" ? { processAlive: true } : {}),
    ...(processState === "exited" ? { transcriptEndedCleanly: true } : {}),
    ...(processState === "died" ? { processAlive: false, processIds: [4242] } : {}),
  } as CollectedAgent;
}

describe("what the board offers is what the endpoint accepts", () => {
  for (const [targetLabel, target] of TARGETS) {
    for (const processState of PROCESS_STATES) {
      for (const archived of [false, true]) {
        const label = `${targetLabel} / ${processState}${archived ? " / archived" : ""}`;

        test(`instruct agrees: ${label}`, async () => {
          const source = collected(processState);
          const controls = controlsFor(source, target, archived);
          const offered = controls.find(({ action }) => action === "instruct")!.enabled;

          const runner = new RecordingRunner();
          const agent = {
            ...source,
            target,
            processState,
            status: archived ? "archived" : "running",
            activity: processState === "running" ? "working" : "idle",
            outcome: "healthy",
            controls,
          } as unknown as AgentSnapshot;
          const result = await executeControl(
            { agentId: agent.id, action: "instruct", instruction: "deploy" },
            agent,
            { runner, archiveStore, cmuxExecutable: "cmux" },
          );

          /* THE INVARIANT. Not "the button is right" and "the endpoint is
             right" as two facts — those both passed while the pair was broken.
             This says they are the same fact. */
          expect(result.response.ok, `board offered=${offered}, endpoint ok=${result.response.ok}`)
            .toBe(offered);

          // And a refused write reaches no terminal, whichever side refused it.
          if (!offered) expect(runner.commands).toEqual([]);
        });
      }
    }
  }

  test("the matrix actually exercises both answers, so agreement is not vacuous", () => {
    /* The guard that stops this file passing on a build that refuses
       everything — agreement between two permanently-closed doors is agreement
       about nothing, and is what a panicked fix produces. */
    const outcomes = new Set<boolean>();
    for (const [, target] of TARGETS) {
      for (const processState of PROCESS_STATES) {
        for (const archived of [false, true]) {
          outcomes.add(controlsFor(collected(processState), target, archived)
            .find(({ action }) => action === "instruct")!.enabled);
        }
      }
    }

    expect(outcomes.has(true), "no combination is allowed to write; the gate is a wall").toBe(true);
    expect(outcomes.has(false), "every combination is allowed to write; the gate is absent").toBe(true);
  });

  test("a refused row still explains itself, so agreement is not silent", () => {
    /* Agreeing to refuse is only half of it. The operator has to be able to
       tell a deliberate refusal from a broken button, on the surface itself. */
    for (const [label, target] of TARGETS) {
      for (const processState of PROCESS_STATES) {
        const instruct = controlsFor(collected(processState), target, false)
          .find(({ action }) => action === "instruct")!;
        if (instruct.enabled) continue;
        expect(instruct.reason, `${label} / ${processState} refuses with no reason`)
          .toBeTruthy();
      }
    }
  });
});
