import { describe, expect, test } from "bun:test";
import { executeControl } from "../src/server/control";
import { MAX_INSTRUCTION_BYTES } from "../src/server/http";
import { resolveAgentTarget } from "../src/server/targets";
import type { AgentSnapshot, ControlAction } from "../src/shared/types";
import type { ArchiveStore, CmuxSurface, CollectedAgent, CommandResult, CommandRunner } from "../src/server/types";

/* The two gates that stand between an operator's click and somebody else's
   terminal. Mutation testing found both unenforced by any test:

   - Deleting the `enabled` check in executeControl killed nothing across
     control-http, control-safety, command and operator-endpoints. CONTROL_DISABLED
     appears in the suite only as a hand-written literal inside a broadcast
     fixture, so the real guard had never been driven.
   - Turning the recorded-cmux-IDs multi-surface result from "ambiguous" into
     "exact" killed nothing in targets.test.ts, which covers other ambiguous
     paths but not that one. "exact" is what operatorControlState reads to mark
     an agent linked and turn its controls on.

   Both are refusals, so each test below also drives the allowed case. A gate
   asserted only in the closed position passes just as well when it is welded
   shut, and a cockpit whose controls silently stop working is its own failure. */

class RecordingRunner implements CommandRunner {
  readonly commands: string[][] = [];
  async run(command: readonly string[]): Promise<CommandResult> {
    this.commands.push([...command]);
    return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
  }
}

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
const ACTIONS: readonly ControlAction[] = ["focus", "instruct", "interrupt", "archive"];

function agent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: "codex:gate",
    provider: "codex",
    sourceSessionId: "gate",
    displayName: "Gate fixture",
    programId: "test-program",
    status: "running",
    statusReason: "Fixture activity is recent.",
    lastHumanMessage: null,
    updatedAt: "2026-08-02T10:00:00.000Z",
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    target: { surfaceId: "SURFACE-GATE", resolution: "exact" },
    controls: ACTIONS.map((action) => ({ action, enabled: true })),
    ...overrides,
  } as AgentSnapshot;
}

const withControl = (action: ControlAction, enabled: boolean, reason?: string) =>
  agent({
    controls: ACTIONS.map((candidate) =>
      candidate === action ? { action: candidate, enabled, ...(reason ? { reason } : {}) } : { action: candidate, enabled: true },
    ),
  });

const run = (subject: AgentSnapshot, action: ControlAction = "focus") =>
  executeControl(
    { agentId: subject.id, action },
    subject,
    { runner: new RecordingRunner(), archiveStore, cmuxExecutable: "cmux" },
  );

describe("executeControl refuses what the snapshot marked unavailable", () => {
  test("a disabled control is refused, and an enabled one is not", () => {
    /* The asymmetry is the test. Asserting only the refusal would pass on a
       build that refuses everything, which is the same cockpit failure from the
       other side: an operator who cannot act on the two rows that need them. */
    return Promise.all([
      run(withControl("focus", false)),
      run(withControl("focus", true)),
    ]).then(([refused, allowed]) => {
      expect(refused.response.ok).toBe(false);
      expect(refused.response.error?.code).toBe("CONTROL_DISABLED");
      expect(allowed.response.ok).toBe(true);
    });
  });

  test("the refusal answers 409 rather than pretending to succeed", async () => {
    // A control that silently no-ops is worse than one that errors: the
    // operator believes the instruction landed.
    const refused = await run(withControl("instruct", false), "instruct");

    expect(refused.status).toBe(409);
    expect(refused.response.ok).toBe(false);
  });

  test("the refusal carries the snapshot's own reason when it has one", async () => {
    /* The row already knows why — "Observed only", "quarantined". Repeating the
       generic sentence there would make the operator go looking for a cause the
       server was holding. */
    const refused = await run(withControl("interrupt", false, "Observed only: no cmux target is linked."), "interrupt");

    expect(refused.response.error?.message).toBe("Observed only: no cmux target is linked.");
  });

  test("a control absent from the list entirely is refused, not assumed allowed", async () => {
    // Absence is not permission. A capability the snapshot never mentioned must
    // fail closed.
    const refused = await run(agent({ controls: [{ action: "focus", enabled: true }] }), "interrupt");

    expect(refused.response.ok).toBe(false);
    expect(refused.response.error?.code).toBe("CONTROL_DISABLED");
  });

  test("a disabled control sends no command to cmux at all", async () => {
    /* The consequence that matters. A refusal that still shelled out would have
       routed the action and then reported failure. */
    const runner = new RecordingRunner();
    await executeControl(
      { agentId: "codex:gate", action: "focus" },
      withControl("focus", false),
      { runner, archiveStore, cmuxExecutable: "cmux" },
    );

    expect(runner.commands).toEqual([]);
  });

  test("an agent-id mismatch is refused before the capability is even consulted", async () => {
    // Guards the guard's ordering: a request naming a different agent must not
    // be able to borrow this one's enabled controls.
    const mismatched = await executeControl(
      { agentId: "codex:someone-else", action: "focus" },
      agent(),
      { runner: new RecordingRunner(), archiveStore, cmuxExecutable: "cmux" },
    );

    expect(mismatched.response.ok).toBe(false);
    expect(mismatched.response.error?.code).toBe("AGENT_IDENTITY_MISMATCH");
  });
});

describe("the instruction budget is a number, not a self-reference", () => {
  test("the cap stays a human-sized instruction rather than an arbitrary ceiling", () => {
    /* Companion to the over-length test in control-safety.test.ts, which builds
       its payload with "x".repeat(MAX_INSTRUCTION_BYTES + 1) and expects a
       message interpolating the same constant. Both sides move together, so it
       cannot see the constant's value directly — but it is NOT hollow, and is
       deliberately left alone: mutation shows it catches a loosened cap, at 200k
       and again at 100MB, where a separate body-size guard answers 413 instead
       of the expected 400.

       The direction it cannot see is tightening. Dropping the cap to 12 bytes
       survives it completely: every real instruction would be refused, the
       instruct control would be dead on every row, and the suite would stay
       green. That is the axis pinned here.

       An instruction is a sentence a human types to an agent, so the budget
       belongs in kilobytes — large enough for a paragraph, too small to be a
       file upload. */
    expect(MAX_INSTRUCTION_BYTES).toBeGreaterThanOrEqual(1_000);
    expect(MAX_INSTRUCTION_BYTES).toBeLessThanOrEqual(64_000);
  });
});

describe("a target that could be two panes stays ambiguous", () => {
  const surface = (surfaceId: string, cwd: string): CmuxSurface => ({
    workspaceId: "W",
    surfaceId,
    paneId: `PANE-${surfaceId}`,
    cwd,
    sourceSessionIds: [],
  });

  const collected = (overrides: Partial<CollectedAgent> = {}): CollectedAgent => ({
    id: "codex:gate",
    provider: "codex",
    sourceSessionId: "gate",
    displayName: "Gate",
    cwd: "/Users/me/proj",
    status: "running",
    statusReason: "fresh",
    updatedAt: "2026-08-02T10:00:00.000Z",
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    ...overrides,
  });

  /* A recorded target naming only a workspace. Both panes in that workspace
     satisfy it, which is the tier-1 multi-match this path exists to refuse. */
  const recordedByWorkspaceOnly = { recordedTarget: { workspaceId: "W" } } as Partial<CollectedAgent>;

  test("recorded cmux ids matching two surfaces resolve ambiguous, not exact", () => {
    /* "exact" is what operatorControlState reads to mark an agent linked and
       turn its controls on. Reporting exact here would arm Focus and Send
       against whichever pane sorted first — the operator's instruction lands in
       somebody else's terminal and nothing in the UI says so. */
    const target = resolveAgentTarget(collected(recordedByWorkspaceOnly), [
      surface("SURFACE-A", "/Users/me/proj"),
      surface("SURFACE-B", "/Users/me/other"),
    ]);

    expect(target.resolution).toBe("ambiguous");
    expect(target.surfaceId).toBeUndefined();
    expect(target.reason).toMatch(/multiple surfaces/i);
  });

  test("the same recorded target resolves exactly when only one pane satisfies it", () => {
    /* The control, and it isolates the variable: identical agent, identical
       recorded target, one surface removed. Without it the assertion above
       would pass on a build that never resolves anything and leaves the whole
       fleet uncontrollable. */
    const target = resolveAgentTarget(collected(recordedByWorkspaceOnly), [
      surface("SURFACE-A", "/Users/me/proj"),
    ]);

    expect(target.resolution).toBe("exact");
    expect(target.surfaceId).toBe("SURFACE-A");
  });
});
