import { describe, expect, test } from "bun:test";
import { enrichCmuxIdentity } from "../src/server/identity";
import { classifyLifecycle } from "../src/server/lifecycle";
import type { CmuxSurface, CollectedAgent, CommandResult, CommandRunner } from "../src/server/types";

/* One process, many sessions — the shape that made most of the board look dead.
 *
 * THE BUG THIS PINS. Liveness attribution ran through `primaryOpenIdentity`,
 * which exists to answer "which session OWNS this terminal pane" and returns
 * nothing when several could. That is right for attributing a surface and wrong
 * for liveness: an open file descriptor is not a claim about ownership, it is
 * proof that this process is serving that session, and it is proof about each
 * one separately.
 *
 * It matters because that is how the desktop apps actually run. A single Codex
 * process holds every open conversation's transcript at once. Measured on this
 * machine: 24 sessions had a transcript held open by a live process, attribution
 * credited 7, and the other 17 published `processAlive: undefined` — which the
 * lifecycle contract then read as "no process evidence".
 *
 * On its own that produced a permanently `unverified` board. Combined with
 * roster-absence evidence it produced something worse: 17 sessions that were
 * running RIGHT NOW, filed as finished. This asserts both halves, because
 * fixing the first without the second is what makes the second dangerous.
 */

class SequenceRunner implements CommandRunner {
  readonly commands: string[][] = [];
  constructor(private readonly results: CommandResult[]) {}
  async run(command: readonly string[]): Promise<CommandResult> {
    this.commands.push([...command]);
    return this.results.shift() ?? { exitCode: 0, stdout: "", stderr: "", timedOut: false };
  }
}

const SESSIONS = [
  "019fcd05-f64d-7942-90aa-4413729425e2",
  "019fcd73-7d8c-75b3-bb04-2def650895d8",
  "019fcd3b-a2f4-70f0-92dd-27ea5c097139",
] as const;

const transcript = (id: string) =>
  `/Users/emilionunezgarcia/.codex/sessions/2026/08/04/rollout-2026-08-04T07-43-34-${id}.jsonl`;

function agentFor(id: string): CollectedAgent {
  return {
    id: `codex:${id}`,
    provider: "codex",
    sourceSessionId: id,
    displayName: "Codex session",
    status: "stale",
    statusReason: "quiet",
    // Quiet well past the default 45m threshold: the band where an ending is
    // reachable at all, and therefore the band where a miss is expensive.
    updatedAt: new Date(Date.now() - 5 * 60 * 60_000).toISOString(),
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
  };
}

const surface: CmuxSurface = {
  workspaceId: "WORKSPACE-A",
  surfaceId: "SURFACE-A",
  paneId: "PANE-A",
  tty: "ttys033",
  sourceSessionIds: [],
};

/** One pid, holding all three transcripts open — the desktop-app shape. */
function scanRunner(): SequenceRunner {
  return new SequenceRunner([
    {
      exitCode: 0,
      stdout: "  1732 ??       /Applications/ChatGPT.app/Contents/Resources/codex\n",
      stderr: "",
      timedOut: false,
    },
    {
      exitCode: 0,
      stdout: ["p1732", ...SESSIONS.map((id) => `n${transcript(id)}`)].join("\n") + "\n",
      stderr: "",
      timedOut: false,
    },
  ]);
}

describe("one process serving many sessions", () => {
  test("every session whose transcript it holds open is credited as alive", async () => {
    const agents = SESSIONS.map(agentFor);

    const enriched = await enrichCmuxIdentity([surface], agents, scanRunner());
    expect(enriched.errors).toEqual([]);

    /* All three, not one. Asserting the count is the whole point: the previous
       implementation passed a "some session got attributed" check. */
    for (const agent of agents) {
      expect({ id: agent.id, alive: agent.processAlive, pids: agent.processIds }).toEqual({
        id: agent.id,
        alive: true,
        pids: [1732],
      });
    }
  });

  /* The consequence, asserted through the classifier rather than argued for.
     These sessions are quiet enough that roster-absence would end them, so
     attribution is the only thing standing between a running session and
     History. */
  test("a running session is never filed as finished, however quiet it is", async () => {
    const agents = SESSIONS.map(agentFor);
    await enrichCmuxIdentity([surface], agents, scanRunner());

    for (const agent of agents) {
      const verdict = classifyLifecycle({
        ageMs: 5 * 60 * 60_000,
        processAlive: agent.processAlive,
        processIds: agent.processIds,
        // The scan completed, so roster absence is on the table for anything
        // it failed to attribute.
        processRosterComplete: true,
      });
      expect(verdict).toMatchObject({ lifecycle: "waiting", provenance: "process-live-quiet" });
      expect(verdict.lifecycle).not.toBe("finished");
    }
  });

  /* And the other direction, so this file cannot pass by calling everything
     alive: a session with no open transcript and no matching process is gone,
     and the completed scan is what makes that sayable. */
  test("a session no live process holds open is still ended by a completed scan", async () => {
    const absent = agentFor("019fcd99-0000-7000-0000-000000000000");
    await enrichCmuxIdentity([surface], [absent, ...SESSIONS.map(agentFor)], scanRunner());

    expect(absent.processAlive).toBeUndefined();
    expect(classifyLifecycle({
      ageMs: 5 * 60 * 60_000,
      processAlive: absent.processAlive,
      processIds: absent.processIds,
      processRosterComplete: true,
    })).toMatchObject({ lifecycle: "finished", provenance: "process-absent" });
  });
});
