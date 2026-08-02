import { describe, expect, test } from "bun:test";
import { executeControl } from "../src/server/control";
import { controlsFor, processStateFor } from "../src/server/snapshot-agent";
import type { AgentSnapshot, ControlAction, TargetResolution } from "../src/shared/types";
import type { ArchiveStore, CollectedAgent, CommandResult, CommandRunner } from "../src/server/types";

/* THE INVARIANT:

     For any agent, what controlsFor advertises as enabled is exactly what
     executeControl will accept.

   Written as an invariant because two assertions could not catch this, and did
   not. tests/write-gate-dead-unarchived.test.ts asserts that executeControl
   refuses a dead agent, and separately that controlsFor reports instruct
   ENABLED for that same agent. Both assertions are correct. Both still pass.
   The bug is the gap between them, and a gap is not a property of either side —
   which is why I wrote that divergence up as deliberate design rather than
   recognising it as a defect. It reached the field as a live Send button on a
   row the same snapshot renders as died.

   The fix is structural, not a matter of asserting harder. Both sides here are
   derived from ONE CollectedAgent: `controlsFor` is called with it, and the
   snapshot's `processState` comes from `processStateFor` on the same record,
   which is what the production pipeline does. Nothing here hand-writes a
   capability or a process state. A test that builds
   `controls: [{ action: "instruct", enabled: true }]` by hand — as the earlier
   one does — has already thrown away the thing under test, because the two
   sides can then each be individually right about different agents.

   THAT MATTERS MORE THAN IT SOUNDS. The first draft of this file set
   `processState` on the snapshot directly while passing the CollectedAgent to
   controlsFor, and reported four divergences that were purely an artefact of
   the fixture disagreeing with itself. A test for "these two agree" is worth
   nothing if the harness feeds them different agents, and it fails in the
   direction that looks like a finding.

   The gap is closed in production: controlsFor now calls `transmitRefusal`, the
   same predicate executeControl consults, so agreement is by construction
   rather than by remembering to edit both. This file is what keeps it that way
   — including for the mechanism nobody has thought of yet, since it names none
   of them. */

const OK: CommandResult = { exitCode: 0, stdout: "", stderr: "", timedOut: false };

class RecordingRunner implements CommandRunner {
  readonly commands: string[][] = [];
  async run(command: readonly string[]): Promise<CommandResult> {
    this.commands.push([...command]);
    return OK;
  }
}

/** The four process states, expressed as the collector evidence that produces
    them rather than as the verdict — so `processStateFor` derives the verdict
    for both sides of the comparison, exactly as the snapshot pipeline does. */
const LIVENESS = {
  running: { processAlive: true },
  exited: { transcriptEndedCleanly: true },
  died: { processAlive: false, processIds: [4_242] },
  unknown: {},
} as const;

type Liveness = keyof typeof LIVENESS;

const RESOLUTIONS: readonly TargetResolution[] = ["exact", "unique-cwd", "ambiguous", "missing"];
const ATTESTATIONS: readonly (AgentSnapshot["target"]["attestation"])[] = ["live", "remembered", undefined];
const LIVENESSES = Object.keys(LIVENESS) as Liveness[];
const ARCHIVED = [false, true] as const;
const ACTIONS: readonly ControlAction[] = ["focus", "instruct", "interrupt", "archive"];

interface AgentState {
  readonly resolution: TargetResolution;
  readonly attestation: AgentSnapshot["target"]["attestation"];
  readonly liveness: Liveness;
  readonly archived: boolean;
}

const STATES: readonly AgentState[] = RESOLUTIONS.flatMap((resolution) =>
  ATTESTATIONS.flatMap((attestation) =>
    LIVENESSES.flatMap((liveness) =>
      ARCHIVED.map((archived) => ({ resolution, attestation, liveness, archived })))));

const describeState = (state: AgentState): string =>
  `${state.resolution}/${state.attestation ?? "no-attestation"}/${state.liveness}`
  + `/${state.archived ? "archived" : "unarchived"}`;

function collectedFor(liveness: Liveness): CollectedAgent {
  return {
    id: "codex:alpha",
    provider: "codex",
    sourceSessionId: "alpha",
    displayName: "Alpha",
    status: "running",
    statusReason: "Fixture activity.",
    updatedAt: "2026-08-02T12:00:00.000Z",
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    ...LIVENESS[liveness],
  } as CollectedAgent;
}

/* The single source. One CollectedAgent produces the capability array AND the
   process state on the snapshot, so any divergence found below is a real
   disagreement between the two functions rather than a fixture that handed them
   different agents. */
function agentFor(state: AgentState): AgentSnapshot {
  const collected = collectedFor(state.liveness);
  const target: AgentSnapshot["target"] = {
    ...(state.resolution === "missing" ? {} : { surfaceId: "PANE-1" }),
    resolution: state.resolution,
    ...(state.attestation === undefined ? {} : { attestation: state.attestation }),
    reason: "Fixture target.",
  };
  return {
    ...collected,
    programId: "p",
    lastHumanMessage: null,
    activity: state.liveness === "running" ? "working" : "ended",
    processState: processStateFor(collected),
    target,
    controls: controlsFor(collected, target, state.archived),
  } as AgentSnapshot;
}

const advertised = (agent: AgentSnapshot, action: ControlAction): boolean =>
  agent.controls.find((control) => control.action === action)?.enabled ?? false;

async function accepts(agent: AgentSnapshot, action: ControlAction): Promise<boolean> {
  const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
  const result = await executeControl(
    { agentId: agent.id, action, ...(action === "instruct" ? { instruction: "deploy" } : {}) },
    agent,
    { runner: new RecordingRunner(), archiveStore, cmuxExecutable: "cmux" },
  );
  return result.response.ok;
}

interface Divergence {
  readonly cell: string;
  readonly advertised: boolean;
  readonly accepted: boolean;
}

async function divergences(actions: readonly ControlAction[] = ACTIONS): Promise<Divergence[]> {
  const found: Divergence[] = [];
  for (const state of STATES) {
    const agent = agentFor(state);
    for (const action of actions) {
      const offered = advertised(agent, action);
      const taken = await accepts(agent, action);
      if (offered !== taken) {
        found.push({ cell: `${action} @ ${describeState(state)}`, advertised: offered, accepted: taken });
      }
    }
  }
  return found;
}

describe("what the button advertises is what the endpoint accepts", () => {
  test("across every agent state, enabled and accepted agree exactly", async () => {
    /* THE INVARIANT. 96 states × 4 actions = 384 cells, and every one of them
       must give the same answer twice.

       It names no mechanism. Liveness was the one that reached the field and
       attestation is the one that nearly did; this assertion would have caught
       either on the day it was introduced, and will catch the third without
       being edited. That is the whole reason it is written as an invariant
       rather than as two more assertions about dead processes. */
    expect(await divergences()).toEqual([]);
  });

  test("the endpoint is never more permissive than the button", async () => {
    /* The safety half, stated separately because it is the direction that must
       never regress even briefly.

       A gap where the endpoint refuses what the button offers is a broken
       promise. A gap the other way — the button disabled while the endpoint
       accepts — is a security hole: an adversary does not trust a disabled
       button, and a control withdrawn from the UI while the route stays open
       was never withdrawn at all. If the invariant above ever has to be
       relaxed, this is the half that may not be. */
    const wrongWay = (await divergences()).filter(({ advertised: offered, accepted }) => !offered && accepted);

    expect(wrongWay).toEqual([]);
  });

  test("the state space exercises both answers, so agreement is not vacuous", async () => {
    /* The anti-hollow guard, and the one this file most needs.

       "These two agree" is satisfied trivially if either side is constant: a
       build that disabled every control and refused every request would pass
       every assertion above while testing nothing. So the space has to contain
       enabled controls, disabled controls, accepted requests and refused ones,
       for the write actions specifically, since that is where the divergence
       lived. */
    let offered = 0;
    let withheld = 0;
    let accepted = 0;
    let refused = 0;
    for (const state of STATES) {
      const agent = agentFor(state);
      for (const action of ["instruct", "interrupt"] as const) {
        advertised(agent, action) ? (offered += 1) : (withheld += 1);
        (await accepts(agent, action)) ? (accepted += 1) : (refused += 1);
      }
    }

    expect(offered).toBeGreaterThan(0);
    expect(withheld).toBeGreaterThan(0);
    expect(accepted).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
    expect(STATES.length).toBe(96);
  });

  test("a live, attested, unarchived agent at the top tier is offered writes and takes them", async () => {
    /* The concrete corner the invariant rests on. Without it, "advertised
       equals accepted" could be satisfied by a build that disabled every write
       control — agreement bought by removing the product. Pinning one cell as
       ENABLED AND ACCEPTED means the invariant can only be satisfied by the two
       sides meeting, not by both going dark. */
    const agent = agentFor({
      resolution: "exact",
      attestation: "live",
      liveness: "running",
      archived: false,
    });

    expect(advertised(agent, "instruct")).toBe(true);
    expect(await accepts(agent, "instruct")).toBe(true);
  });

  test("the dead, unarchived agent that reached the field is refused on both sides", async () => {
    /* The specific cell, kept as a named regression test underneath the general
       one. The invariant would catch it, but only as one line in a list of 384;
       this says which cell it was and what it cost, so a future reader hitting
       the invariant has somewhere to start.

       Dead-but-unarchived is what every agent looks like between its process
       exiting and someone tidying the row. */
    const agent = agentFor({
      resolution: "exact",
      attestation: "live",
      liveness: "died",
      archived: false,
    });

    expect(agent.processState).toBe("died");
    expect(advertised(agent, "instruct")).toBe(false);
    expect(await accepts(agent, "instruct")).toBe(false);
    // Focus survives: it types nothing, and going to look at the pane is how an
    // operator recovers when the write controls are off.
    expect(advertised(agent, "focus")).toBe(true);
    expect(await accepts(agent, "focus")).toBe(true);
  });
});

describe("what the invariant cannot catch: the content of the shared rule", () => {
  /* The limit of the invariant above, found by mutating it.

     Deleting `attestation !== "remembered"` from canWriteToTarget changes BOTH
     sides identically, because both now read the same predicate. They still
     agree, so the invariant stays green — correctly. Agreement is what it
     asserts, and agreement survives a rule that is wrong in the same way twice.

     Measured: that mutation survives all 98 tests across every write-gate file
     in this suite. The rule was landed with a comment explaining why it matters
     and no test holding it there.

     So deriving both sides from one source buys agreement and costs coverage of
     the source. The two need separate assertions, and this is them. */

  test("a target attested only by memory is refused for writes, on both sides", async () => {
    /* EVER attested is not CURRENTLY attested. A persisted identity binding was
       true when it was written; nothing in the current scan says the session is
       still on that pane. It mints `exact` — the top resolution tier — for a
       pane that attests nothing now, which is the sharper version of the
       unique-cwd hole: there the system had nothing better to go on, here it
       has a stale answer it is treating as fresh. */
    const remembered = agentFor({
      resolution: "exact",
      attestation: "remembered",
      liveness: "running",
      archived: false,
    });

    expect(advertised(remembered, "instruct")).toBe(false);
    expect(await accepts(remembered, "instruct")).toBe(false);
    expect(advertised(remembered, "interrupt")).toBe(false);
    expect(await accepts(remembered, "interrupt")).toBe(false);
  });

  test("live attestation at the same tier is accepted, so the refusal is the attestation", async () => {
    /* The control that attributes it. Everything else held constant — same
       resolution, same liveness, same archive state — so the refusal above
       cannot be blamed on the tier or on the process. */
    const live = agentFor({
      resolution: "exact",
      attestation: "live",
      liveness: "running",
      archived: false,
    });

    expect(advertised(live, "instruct")).toBe(true);
    expect(await accepts(live, "instruct")).toBe(true);
  });

  test("a remembered target still permits focus, so the operator can go and look", async () => {
    /* The recovery path, and the reason this is a write gate rather than a
       blanket refusal. Focus types nothing into the pane; going to look at it is
       exactly how an operator resolves a stale binding. Refusing focus here
       would remove the only move available. */
    const remembered = agentFor({
      resolution: "exact",
      attestation: "remembered",
      liveness: "running",
      archived: false,
    });

    expect(advertised(remembered, "focus")).toBe(true);
    expect(await accepts(remembered, "focus")).toBe(true);
  });
});
