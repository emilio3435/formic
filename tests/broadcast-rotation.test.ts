import { describe, expect, test } from "bun:test";
import { handleBroadcastRequest } from "../src/server/broadcast";
import { PulseTracker } from "../src/server/pulse";
import type { AgentSnapshot, HubSnapshot, TargetResolution } from "../src/shared/types";
import type { ArchiveStore, CommandResult, CommandRunner } from "../src/server/types";

/* Broadcast after a cmux rotation, and the restart that follows it.

   A rotation is the ordinary thing: a pane cds away, another cds in, nothing
   closes and no agent ends. Every row re-resolves onto a pane matched by
   directory string rather than attested by cmux. The GPT lane proved the
   consequence empirically — a broadcast to three agents produced three
   deliveries to three wrong terminals, each answered ok.

   Broadcast is where that costs the most: it is the one control that multiplies
   a single click by the size of the fleet, so a routing defect is not one
   misdelivery but N of them, and the operator is told all N succeeded.

   The property:

     A rotation that leaves every row unproven produces ZERO deliveries.
     Not three misdeliveries, and not a partial success it calls a success.

   Asserted against the API called DIRECTLY, never through the button. A
   disabled control is a courtesy to the operator, not a safety property: an
   adversary does not trust it, a stale tab does not have it, and a script does
   not see it. The refusal has to live in the handler.

   The last block pins the restart. Dropping every SSE connection resets the
   pulse tracker, and a counter that silently resets is the same family as one
   that claims a window it has not watched — both state a number the observation
   behind it does not support. */

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

const ROTATION_REASON = "Matched one active source to the only unclaimed cmux surface with this exact cwd.";

function agent(id: string, resolution: TargetResolution, surfaceId: string, at: string): AgentSnapshot {
  return {
    id: `codex:${id}`,
    provider: "codex",
    sourceSessionId: id,
    displayName: `Worker ${id}`,
    programId: "p",
    status: "running",
    statusReason: "Source activity within 3 minutes.",
    lastHumanMessage: null,
    updatedAt: at,
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    target: { surfaceId, resolution, reason: ROTATION_REASON },
    controls: [{ action: "instruct", enabled: true }],
  } as AgentSnapshot;
}

/** A three-lane fleet. `at` defaults to now, because a stale board refuses
    outright and would mask whatever else the test meant to measure. */
function fleet(resolutions: readonly TargetResolution[], at = new Date().toISOString()): HubSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: at,
    programs: [{
      id: "p",
      name: "P",
      agents: resolutions.map((resolution, index) => agent(String.fromCharCode(97 + index), resolution, `PANE-${index + 1}`, at)),
    }],
    totals: {},
    issues: [],
  } as unknown as HubSnapshot;
}

const ALL_THREE = ["codex:a", "codex:b", "codex:c"];

/** Posts a broadcast straight at the handler — no button, no client state. */
async function broadcast(snapshot: HubSnapshot, runner: RecordingRunner, options: {
  agentIds?: string[]; instruction?: string; origin?: string | null;
} = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const origin = options.origin === undefined ? "http://127.0.0.1:4701" : options.origin;
  if (origin !== null) headers.origin = origin;

  const response = await handleBroadcastRequest(
    new Request("http://127.0.0.1:4701/api/broadcast", {
      method: "POST",
      headers,
      body: JSON.stringify({
        agentIds: options.agentIds ?? ALL_THREE,
        instruction: options.instruction ?? "stand down",
      }),
    }),
    { runner, archiveStore, cmuxExecutable: "cmux", getSnapshot: () => snapshot } as never,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: response.status, body: (await response.json()) as any };
}

describe("a rotation delivers to nobody rather than to the wrong three", () => {
  test("every row unproven means zero deliveries and zero commands", async () => {
    /* The measured failure, inverted into a guarantee. Three rows, all
       re-resolved by directory string after a rotation. Before the write gate
       this sent three instructions to three wrong terminals and answered ok
       three times. */
    const runner = new RecordingRunner();
    const { status, body } = await broadcast(fleet(["unique-cwd", "unique-cwd", "unique-cwd"]), runner);

    expect(body.sent).toBe(0);
    expect(body.failed).toBe(3);
    expect(runner.commands).toEqual([]);
    expect(runner.argv).not.toContain("stand down");
    expect(status).toBe(409);
  });

  test("a total failure is not dressed up as a partial success", async () => {
    /* `partial` drives how the result reads back to the operator. A rotation
       that reached nobody must not report as "some got through" — that is the
       reading that stops them re-sending. */
    const { body } = await broadcast(fleet(["unique-cwd", "unique-cwd", "unique-cwd"]), new RecordingRunner());

    expect(body.ok).toBe(false);
    expect(body.partial).toBe(false);
    for (const result of body.results) {
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("UNSAFE_TARGET");
    }
  });

  test("each refusal names the row it refused, so the operator can see which", async () => {
    // A count of three failures without ids leaves them unable to tell which
    // lanes never heard it.
    const { body } = await broadcast(fleet(["unique-cwd", "unique-cwd", "unique-cwd"]), new RecordingRunner());

    expect(body.results.map((result: { agentId: string }) => result.agentId).sort()).toEqual([...ALL_THREE].sort());
  });

  test("a partial rotation delivers only to the rows that stayed proven", async () => {
    /* The mixed case, and the one where a coarse gate would be wrong in either
       direction: refusing the whole broadcast would strand a reachable agent,
       and allowing it wholesale would misdeliver to the other two. */
    const runner = new RecordingRunner();
    const { status, body } = await broadcast(fleet(["exact", "unique-cwd", "unique-cwd"]), runner);

    expect(body.sent).toBe(1);
    expect(body.failed).toBe(2);
    expect(body.partial).toBe(true);
    expect(status).toBe(207);
    // Only the attested pane was addressed.
    expect(runner.argv).toContain("PANE-1");
    expect(runner.argv).not.toContain("PANE-2");
    expect(runner.argv).not.toContain("PANE-3");
  });

  test("a fully attested fleet still receives it, so the gate is not a wall", async () => {
    /* The control. Every assertion above would hold on a broadcast that refused
       everything — which fails the property from the other side: a fleet-wide
       stand-down that reaches nobody is its own incident. */
    const runner = new RecordingRunner();
    const { status, body } = await broadcast(fleet(["exact", "exact", "exact"]), runner);

    expect(body.sent).toBe(3);
    expect(body.failed).toBe(0);
    expect(status).toBe(200);
    expect(runner.argv).toContain("stand down");
  });
});

describe("the handler refuses on its own, not because a button was disabled", () => {
  test("a request with no Origin is refused before any agent is considered", async () => {
    /* A disabled control is a courtesy to the operator. An adversary does not
       trust it, a stale tab does not have it, and a script does not see it. */
    const runner = new RecordingRunner();
    const { status, body } = await broadcast(fleet(["exact", "exact", "exact"]), runner, { origin: null });

    expect(status).toBe(403);
    expect(body.error.code).toBe("ORIGIN_REJECTED");
    expect(runner.commands).toEqual([]);
  });

  test("a request from another origin is refused", async () => {
    const runner = new RecordingRunner();
    const { status } = await broadcast(fleet(["exact", "exact", "exact"]), runner, { origin: "http://evil.example" });

    expect(status).toBe(403);
    expect(runner.commands).toEqual([]);
  });

  test("a stale board refuses the whole broadcast rather than acting on old rows", async () => {
    /* The rows in a stale snapshot may no longer be the agents they name — a
       rotation is exactly what happens in the gap. So this refuses as one
       request rather than per agent, and carries no results at all. */
    const runner = new RecordingRunner();
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    const { status, body } = await broadcast(fleet(["exact", "exact", "exact"], old), runner);

    expect(status).toBe(409);
    expect(body.error.code).toBe("STALE_SNAPSHOT");
    expect(body.results).toBeUndefined();
    expect(runner.commands).toEqual([]);
  });

  test("an agent absent from the snapshot is refused, not guessed at", async () => {
    // Naming an id the board does not hold must not resolve onto whatever is
    // nearby.
    const runner = new RecordingRunner();
    const { body } = await broadcast(fleet(["exact"]), runner, { agentIds: ["codex:a", "codex:ghost"] });

    const ghost = body.results.find((result: { agentId: string }) => result.agentId === "codex:ghost");
    expect(ghost.ok).toBe(false);
    expect(ghost.error.code).toBe("AGENT_NOT_FOUND");
  });

  test("an instruction carrying a newline is refused before any recipient", async () => {
    /* A newline is a submit. Multiplied across a fleet it would run a second
       command on every terminal at once.

       Refused as ONE request rather than per agent — the instruction is
       validated before the fleet is walked, so there is no results array and
       no partial state to reason about. An earlier draft expected sent: 0 and
       found undefined, which is the better shape: nothing is attempted at all. */
    const runner = new RecordingRunner();
    const { status, body } = await broadcast(fleet(["exact", "exact", "exact"]), runner, { instruction: "ls\nrm -rf /" });

    expect(body.ok).toBe(false);
    expect(body.results).toBeUndefined();
    expect(status).toBeGreaterThanOrEqual(400);
    expect(runner.commands).toEqual([]);
  });
});

describe("a restart resets the window and the count together", () => {
  const BUCKET_MS = 5 * 60_000;
  const HOUR_MS = 60 * 60_000;
  const BASE = Math.floor(Date.parse("2026-08-02T10:00:00.000Z") / BUCKET_MS) * BUCKET_MS;

  const snapshotAt = (ms: number): HubSnapshot => ({
    schemaVersion: 1,
    generatedAt: new Date(ms).toISOString(),
    programs: [{ id: "p", name: "P", agents: [agent("a", "exact", "PANE-1", new Date(ms).toISOString())] }],
    totals: { live: 1, tracked: 1, attention: 0, working: 1, idle: 0, ended: 0, needsYou: 0, history: 0 },
    issues: [],
  } as unknown as HubSnapshot);

  test("a tracker that has watched an hour reports an hour", () => {
    // The before state, so the reset below is a measured change.
    const tracker = new PulseTracker(undefined, BASE - HOUR_MS);
    tracker.observe(snapshotAt(BASE), BASE);

    expect(tracker.report(BASE).momentum.observedWindowMs).toBe(HOUR_MS);
  });

  test("a restart drops the window to zero rather than inheriting one", () => {
    /* Restarting the hub drops every SSE connection and builds a new tracker.
       The honest answer to "how long have you watched" is then zero, and this
       pins that it is not silently carried over — an inherited window would let
       a fresh process rate a count over time it never observed. */
    const restarted = new PulseTracker(undefined, BASE);
    restarted.observe(snapshotAt(BASE), BASE);

    expect(restarted.report(BASE).momentum.observedWindowMs).toBe(0);
  });

  test("the count and the window reset together, never one without the other", () => {
    /* The property, and the reason this sits beside the broadcast tests: both
       are a number stated more confidently than the observation behind it.

       A completion count surviving a restart while the window reset would rate
       N completions over zero elapsed time. A window surviving while the count
       reset would claim an hour of watching that produced nothing. Either way
       the pair disagrees, so they are asserted together. */
    const restarted = new PulseTracker(undefined, BASE);
    restarted.observe(snapshotAt(BASE), BASE);
    const momentum = restarted.report(BASE).momentum;

    expect(momentum.observedWindowMs).toBe(0);
    expect(momentum.completionsLastHour ?? 0).toBe(0);
  });

  test("a zero window is reported as unestablished, not as an hour", async () => {
    /* The operator-facing half. With no window, the strip must say the rate is
       not established rather than printing a count under an hour label — the
       same failure as claiming a window it has not watched, arriving by way of
       a restart instead of a short uptime. */
    // @ts-expect-error The dependency-free browser client has no declaration file.
    await import("../src/web/app.js");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const M = (globalThis as unknown as { TheAntHill: any }).TheAntHill;

    const text = String(M.completionWindowText({
      working: 1, completionsLastHour: 0, observedWindowMs: 0,
      stalled: 0, stalledAgentIds: [], stallThresholdMs: 900_000,
    }));

    expect(text).not.toContain("this hour");
  });
});
