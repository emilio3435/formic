import { describe, expect, test } from "bun:test";
import { executeControl } from "../src/server/control";
import type { AgentSnapshot, ControlAction, ProcessState, TargetResolution } from "../src/shared/types";
import type { ArchiveStore, CommandResult, CommandRunner } from "../src/server/types";

/* The residual that survived the unique-cwd fix, and it is worse than the bug
   that fix closed.

   A persisted identity binding mints `resolution: "exact"` — the top tier, the
   one the write gate treats as attested — for a pane that attests nothing. The
   agent can be sitting in a different directory from the pane, and its bound
   process can already be classified DIED, and instruct and interrupt still come
   back enabled.

   The sharp part is not that the system is guessing. It is that the system is
   NOT guessing and throws the answer away. `processState` is computed in the
   same pass, attached to the agent, and rendered to the operator as "died".
   `grep processState src/server/control.ts` returns nothing: the strongest
   available evidence that a binding is stale is produced, displayed, and
   ignored by the one decision it should govern.

   With unique-cwd the system at least had nothing better to go on. Here it has
   better and discards it.

   THE PROPERTY:

     A write to an agent whose process is KNOWN DEAD is refused,
     whatever tier its target resolved at.

   Why this file exists at all: tests/write-path-routing.test.ts passed
   throughout, because every one of its assertions asked about `resolution`.
   That is the hollow-assertion shape — an assertion that constrains the axis
   you happened to think of and says nothing about the one that matters — in the
   place where it costs the most. Resolution answers "which pane did we pick".
   Liveness answers "is the agent still there". A gate that reads only the first
   authorises typing into a terminal whose occupant has already gone.

   The refusals are marked failing: the hole is live on main and the fix is
   being written. They run every commit, and the moment the gate consults
   liveness they report "marked as failing but it passed" — remove the marker
   then and they become the permanent guard against anyone re-permitting it. */

const OK: CommandResult = { exitCode: 0, stdout: "", stderr: "", timedOut: false };
const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };

class RecordingRunner implements CommandRunner {
  readonly commands: string[][] = [];
  async run(command: readonly string[]): Promise<CommandResult> {
    this.commands.push([...command]);
    return OK;
  }
  get argv(): string { return this.commands.flat().join(" "); }
}

/* The exact shape the GPT lane drove through the production functions: a
   binding-minted `exact`, a pane in a different directory, and a process the
   collector has already classified dead. Every field here is one the board
   renders. */
function boundToADeadProcess(overrides: {
  processState?: ProcessState;
  resolution?: TargetResolution;
} = {}): AgentSnapshot {
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
    cwd: "/Users/me/project-A",
    activity: overrides.processState === "running" ? "working" : "ended",
    /* processState is what the WIRE carries — processAlive lives on
       CollectedAgent and never reaches the gate. So `died` is precisely the
       evidence executeControl is handed and does not read. */
    processState: overrides.processState ?? "died",
    target: {
      surfaceId: "PANE-ELSEWHERE",
      resolution: overrides.resolution ?? "exact",
      surfaceCwd: "/Users/me/project-B",
      cwdMismatch: true,
      reason: "Matched recorded cmux target IDs via a persisted identity binding.",
    },
    controls: [
      { action: "instruct", enabled: true },
      { action: "interrupt", enabled: true },
      { action: "focus", enabled: true },
    ],
  } as AgentSnapshot;
}

const send = (subject: AgentSnapshot, action: ControlAction, runner: RecordingRunner) =>
  executeControl(
    { agentId: subject.id, action, ...(action === "instruct" ? { instruction: "deploy to production" } : {}) },
    subject,
    { runner, archiveStore, cmuxExecutable: "cmux" },
  );

describe("liveness governs the write gate, not just resolution", () => {
  test.failing("an instruction to a dead process is refused, and nothing is sent", async () => {
    /* The hole, stated as the guarantee. Nothing reaching the runner is the
       half that matters: a refusal issued after the text had already gone would
       have typed into the pane and then reported that it had not. */
    const runner = new RecordingRunner();
    const result = await send(boundToADeadProcess(), "instruct", runner);

    expect(result.response.ok).toBe(false);
    expect(runner.commands).toEqual([]);
    expect(runner.argv).not.toContain("deploy to production");
  });

  test.failing("an interrupt to a dead process is refused, and nothing is sent", async () => {
    // Interrupt types Escape. On a pane the dead agent no longer occupies, it
    // reaches whoever took the pane over.
    const runner = new RecordingRunner();
    const result = await send(boundToADeadProcess(), "interrupt", runner);

    expect(result.response.ok).toBe(false);
    expect(runner.commands).toEqual([]);
  });

  test.failing("a dead process is refused even at the top resolution tier", async () => {
    /* The precise claim, isolated. `exact` is the strongest tier the gate
       knows, and a persisted binding can mint it for a pane that attests
       nothing. So the refusal must come from liveness, not from downgrading the
       tier — a fix that only made bindings resolve lower would leave the gate
       still blind to the evidence it already has. */
    const runner = new RecordingRunner();
    const agent = boundToADeadProcess({ resolution: "exact" });

    expect(agent.target.resolution).toBe("exact");
    expect(agent.processState).toBe("died");

    const result = await send(agent, "instruct", runner);
    expect(result.response.ok).toBe(false);
  });

  test("today the write goes through, which is why the three above are marked", async () => {
    /* Pins the live hole so the gap is a measured difference rather than an
       assertion about nothing. EXPECT THIS TO GO RED when the fix lands —
       update it alongside unmarking the three tests above; all four describe
       the same gate.

       Measured on main: two commands issued to PANE-ELSEWHERE, ok true, for an
       agent the same snapshot renders as died. */
    const runner = new RecordingRunner();
    const result = await send(boundToADeadProcess(), "instruct", runner);

    expect(result.response.ok).toBe(true);
    expect(runner.argv).toContain("PANE-ELSEWHERE");
    expect(runner.argv).toContain("deploy to production");
  });

  test("the evidence the gate ignores is present on the very agent it authorises", async () => {
    /* Why this is worse than unique-cwd. The system is not missing the answer.
       It computes processState in the same pass that resolves the target,
       attaches it to the agent object that executeControl receives, and renders
       it to the operator — who is looking at a row marked died while the row's
       Send button stays live. */
    const agent = boundToADeadProcess();

    expect(agent.processState).toBe("died");
    expect(agent.activity).toBe("ended");
    // And the binding it trusted is visibly pointing somewhere else.
    expect(agent.target.cwdMismatch).toBe(true);
    expect(agent.cwd).not.toBe(agent.target.surfaceCwd);
  });

  test("a live process at an attested pane still takes the write", async () => {
    /* The control, and the failure a panicked fix produces. Refusing every
       write would satisfy all three assertions above while making the cockpit
       useless — an action that never reaches the agent it names is as broken as
       one that reaches the wrong agent. */
    const runner = new RecordingRunner();
    const alive = boundToADeadProcess({ processState: "running" });
    const result = await send(alive, "instruct", runner);

    expect(result.response.ok).toBe(true);
    expect(runner.argv).toContain("deploy to production");
  });

  /* Deliberately NOT asserted here: what should happen for processState
     "unknown", and whether focus should follow instruct and interrupt.

     "unknown" is the absent-first case this codebase is explicit about —
     absence of evidence is not evidence of death — and most of a real board
     sits there, so refusing it is a fleet-wide policy call rather than a bug
     fix. Focus types nothing, and the existing gate deliberately keeps it open
     on unproven targets because going to look at the pane is how an operator
     recovers when the write controls are off; the same argument plainly extends
     to a dead process, but it is the backend lane's call.

     Both are left unpinned on purpose. Earlier today I asserted that focus
     must be refused on a cwd-matched pane, which contradicted a reasoned
     decision and would have removed the recovery path had anyone acted on it.
     A test that guesses at a design decision is worse than no test, for the
     same reason as one that cannot fail. */
});