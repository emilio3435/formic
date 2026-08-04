import { describe, expect, test } from "bun:test";
import { executeControl } from "../src/server/control";
import { controlsFor } from "../src/server/snapshot-agent";
import type { AgentSnapshot, ProcessState } from "../src/shared/types";
import type { ArchiveStore, CollectedAgent, CommandResult, CommandRunner } from "../src/server/types";

/* The one combination the liveness gate actually exists for: a process that is
   DEAD while its agent is NOT archived.

   Every dead agent on the live board was also archived, which makes the gate
   look verified when it is not. An archived agent never reaches the liveness
   check at all — `controlsFor` sets `instruct.enabled = proven && !archived`,
   so executeControl refuses it at the capability check with CONTROL_DISABLED
   several branches earlier. If every dead agent is archived, the liveness gate
   is doing work only where something else would already have refused, and the
   branch that matters has never run.

   Dead-but-unarchived is not exotic. It is what every agent looks like in the
   window between its process exiting and an operator tidying the row — which on
   a board where rows are archived by hand is most of their life after death.

   The three paths are asserted by ERROR CODE rather than by ok:false, because
   ok:false is exactly what an archived refusal also returns. A test that only
   checked the boolean would pass while the branch it names never executed —
   the same hollow shape as asking about resolution and calling the write path
   covered. */

const OK: CommandResult = { exitCode: 0, stdout: "", stderr: "", timedOut: false };
const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
const EXACT_TARGET = { surfaceId: "PANE-1", resolution: "exact" as const };

class RecordingRunner implements CommandRunner {
  readonly commands: string[][] = [];
  async run(command: readonly string[]): Promise<CommandResult> {
    this.commands.push([...command]);
    return OK;
  }
  get argv(): string { return this.commands.flat().join(" "); }
}

/** A snapshot agent at the top resolution tier. `controlsEnabled` stands in for
    what controlsFor() computes: false is the shape an ARCHIVED agent arrives
    in, true is every unarchived one. */
function agentAt(processState: ProcessState, controlsEnabled: boolean): AgentSnapshot {
  return {
    id: "codex:alpha",
    provider: "codex",
    sourceSessionId: "alpha",
    displayName: "Alpha",
    programId: "p",
    status: "running",
    statusReason: "Fixture activity is recent.",
    lastHumanMessage: null,
    updatedAt: new Date().toISOString(),
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    activity: processState === "running" ? "working" : "ended",
    processState,
    target: EXACT_TARGET,
    controls: [
      { action: "instruct", enabled: controlsEnabled },
      { action: "interrupt", enabled: controlsEnabled },
    ],
  } as AgentSnapshot;
}

const send = (subject: AgentSnapshot, runner: RecordingRunner) =>
  executeControl(
    { agentId: subject.id, action: "instruct", instruction: "deploy to production" },
    subject,
    { runner, archiveStore, cmuxExecutable: "cmux" },
  );

/** The collector-shaped record controlsFor() reads, with no process evidence of
    life — the state a dead agent is in before anyone archives the row. */
const collectedDead: CollectedAgent = {
  id: "codex:alpha",
  provider: "codex",
  sourceSessionId: "alpha",
  displayName: "Alpha",
  status: "running",
  statusReason: "Fixture activity is recent.",
  updatedAt: new Date().toISOString(),
  tokens: { provenance: "unknown" },
  artifacts: [],
  gates: [],
  processAlive: false,
  processIds: [4_242],
};

describe("the liveness gate fires where archiving would not have", () => {
  test("a dead, UNARCHIVED agent is refused by liveness specifically", async () => {
    /* The branch the live board could not exercise. Controls are enabled — the
       agent is not archived — and the target is at the top tier, so nothing
       earlier in executeControl has a reason to refuse. Only liveness does. */
    const runner = new RecordingRunner();
    const result = await send(agentAt("died", true), runner);

    expect(result.response.error?.code).toBe("AGENT_NOT_RUNNING");
    expect(result.status).toBe(409);
    expect(runner.commands).toEqual([]);
    expect(runner.argv).not.toContain("deploy to production");
  });

  test("a dead, ARCHIVED agent is refused by the capability check instead", async () => {
    /* The case that was masking the gap. Archiving disables the control, so
       this never reaches the liveness branch — and returns a different code
       from a different place. */
    const runner = new RecordingRunner();
    const result = await send(agentAt("died", false), runner);

    expect(result.response.error?.code).toBe("CONTROL_DISABLED");
    expect(runner.commands).toEqual([]);
  });

  test("the two refusals are distinguishable, so neither can stand in for the other", async () => {
    /* The assertion that makes this file worth having. Both refuse, both return
       ok:false, both send nothing — so a test checking only the boolean would
       pass with the liveness branch dead code. The codes have to differ. */
    const unarchived = await send(agentAt("died", true), new RecordingRunner());
    const archived = await send(agentAt("died", false), new RecordingRunner());

    expect(unarchived.response.error?.code).not.toBe(archived.response.error?.code);
    expect(unarchived.response.ok).toBe(false);
    expect(archived.response.ok).toBe(false);
  });

  test("a live, unarchived agent at the same tier still takes the write", async () => {
    /* The control. Holds everything constant except liveness, so the refusal
       above is attributable to that and nothing else — and a fix that refused
       every unarchived write would fail here. */
    const runner = new RecordingRunner();
    const result = await send(agentAt("running", true), runner);

    expect(result.response.ok).toBe(true);
    expect(runner.argv).toContain("deploy to production");
  });

  test("the refusal tells the operator how to clear it", async () => {
    // A row that refuses without saying why leaves archiving and restarting as
    // guesses. Both are named.
    const result = await send(agentAt("died", true), new RecordingRunner());
    const message = String(result.response.error?.message ?? "");

    expect(message).toMatch(/gone|no longer/i);
    expect(message).toMatch(/archive/i);
  });
});

describe("the UI still offers the button, so the server gate is the only guard", () => {
  test("controlsFor refuses instruct on a dead, unarchived agent, as the endpoint does", () => {
    /* Was pinned at `true`: controlsFor computed `proven && !archived` and never
       consulted process evidence, so the operator saw a live Send button on a
       row the same snapshot marked died, and the endpoint then answered 409.

       Both now read one predicate (transmitRefusal), so they cannot disagree by
       construction rather than by both being remembered — which is what failed.
       The server gate still cannot be traded for a UI change; it is now simply
       impossible for the UI to advertise what the server will refuse. */
    const capabilities = controlsFor(collectedDead, EXACT_TARGET, false);
    const instruct = capabilities.find(({ action }) => action === "instruct");

    expect(instruct?.enabled).toBe(false);
    expect(instruct?.reason).toMatch(/process was checked and is gone/i);
  });

  test("archiving is what disables it, which is the masking this file undoes", () => {
    // The contrast, at the capability layer rather than the handler.
    const archived = controlsFor(collectedDead, EXACT_TARGET, true);
    const instruct = archived.find(({ action }) => action === "instruct");

    expect(instruct?.enabled).toBe(false);
    expect(instruct?.reason).toMatch(/archived/i);
  });
});
