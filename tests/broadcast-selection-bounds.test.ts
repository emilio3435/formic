import { describe, expect, test } from "bun:test";
import { handleBroadcastRequest } from "../src/server/broadcast";
import type { BroadcastDependencies } from "../src/server/broadcast";

/* The two selection bounds on broadcast that no test exercised.

   Found by sweeping the input-validation disjunctions. Both arms below can be
   deleted and the 90 tests across broadcast, broadcast-rotation, control-http,
   operator-endpoints and app-lifecycle stay green. The guards themselves are
   correct — this is missing coverage, not a defect.

   ONE OF THEM MATTERS MORE THAN THE OTHER, and the difference is the triage
   rule this lane has used all day: prefer the path whose silent failure is
   indistinguishable from correct behaviour.

     EMPTY SELECTION is that path. Without `agentIds.length < 1`, a broadcast to
     nobody passes validation, resolves zero agents, and answers ok. The
     operator is told their instruction was sent when it reached no one — a
     well-formed, plausible, reassuring answer that is wrong. Nothing on the
     board would contradict it.

     AN OVERLONG ID is not. Without the 300-character bound a huge string passes
     validation, fails the lookup, and comes back "agent not found". That is
     visible, and a visible failure needs a test less than an invisible one. It
     is pinned here anyway because it costs two lines while the file is open,
     and because an unbounded string from a request body is worth a ceiling
     regardless.

   NOT PINNED, and named rather than dropped silently: the `keys.length !== 2`
   arm. Removing it is near-equivalent — a body of `{agentIds}` alone still
   fails two checks later on the missing instruction, refused either way with a
   different message. A test for it would pin the wording, not the behaviour. */

const dependencies = {
  runner: { run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }) },
  cmuxExecutable: "cmux",
  archiveStore: { has: () => false, archive: async () => {} },
  getSnapshot: () => ({ schemaVersion: 1, programs: [], totals: {} } as never),
} as unknown as BroadcastDependencies;

const send = (body: unknown) => handleBroadcastRequest(
  new Request("http://127.0.0.1:4701/api/broadcast", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1:4701" },
    body: JSON.stringify(body),
  }),
  dependencies,
);

const codeOf = async (response: Response): Promise<string> =>
  ((await response.json()) as { error?: { code?: string } }).error?.code ?? "";

describe("a broadcast must name at least one agent and at most fifty", () => {
  test("an empty selection is refused rather than answered ok", async () => {
    /* THE ONE THAT MATTERS. A broadcast reaching nobody and reporting success
       is the failure this project keeps producing: correct-looking, calm, and
       contradicted by nothing the operator can see. */
    const response = await send({ agentIds: [], instruction: "stand down" });

    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe("INVALID_BROADCAST_REQUEST");
  });

  test("a single agent is accepted, so the bound is a floor and not a ban", async () => {
    /* The control. Every refusal here would also hold on a build that refused
       all broadcasts, which is the shape a validation test hides behind.
       Asserted as "not the validation error" because this fixture has no such
       agent and the request is entitled to fail later for that. */
    const response = await send({ agentIds: ["codex:alpha"], instruction: "stand down" });

    expect(await codeOf(response)).not.toBe("INVALID_BROADCAST_REQUEST");
  });

  test("the fifty-agent ceiling holds at the boundary, from both sides", async () => {
    /* Asserted AT the edge rather than near it: fifty must pass and fifty-one
       must not. A test using ten and a hundred passes whichever way the
       comparison points. */
    const ids = (count: number) => Array.from({ length: count }, (_, index) => `codex:a${index}`);

    expect(await codeOf(await send({ agentIds: ids(50), instruction: "go" }))).not.toBe("INVALID_BROADCAST_REQUEST");
    expect(await codeOf(await send({ agentIds: ids(51), instruction: "go" }))).toBe("INVALID_BROADCAST_REQUEST");
  });

  test("an agent id longer than the ceiling is refused", async () => {
    /* The cheaper of the two. An unbounded string from a request body deserves
       a ceiling whatever happens downstream, and the bound is asserted from
       both sides so it cannot drift into refusing ordinary ids. */
    const ordinary = "codex:" + "a".repeat(200);
    const overlong = "codex:" + "a".repeat(5_000);

    expect(ordinary.length).toBeLessThan(300);
    expect(await codeOf(await send({ agentIds: [ordinary], instruction: "go" }))).not.toBe("INVALID_BROADCAST_REQUEST");
    expect(await codeOf(await send({ agentIds: [overlong], instruction: "go" }))).toBe("INVALID_BROADCAST_REQUEST");
  });

  test("nothing reaches the runner when the selection is refused", async () => {
    /* The half that matters on any refusal: a rejection issued after the
       instruction had gone would have broadcast and then reported it had not. */
    const commands: string[][] = [];
    const recording = {
      ...dependencies,
      runner: {
        run: async (command: readonly string[]) => {
          commands.push([...command]);
          return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
        },
      },
    } as unknown as BroadcastDependencies;

    await handleBroadcastRequest(
      new Request("http://127.0.0.1:4701/api/broadcast", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://127.0.0.1:4701" },
        body: JSON.stringify({ agentIds: [], instruction: "stand down" }),
      }),
      recording,
    );

    expect(commands).toEqual([]);
  });
});
