import { describe, expect, test } from "bun:test";
import { canWriteToTarget } from "../src/server/targets";
import type { CmuxTarget } from "../src/shared/types";

/* The second write path, found after the first was closed.

   547679e made instruct and interrupt require an ATTESTED surface, because
   `unique-cwd` matches a pane on its working directory among panes carrying no
   identity evidence. It changed control.ts and did not change app.ts, whose
   attention handler carried a byte-identical predicate and then wrote with
   `apply(agent.target.surfaceId, …)`. So acknowledging agent A still cleared
   the notification on whatever pane A currently resolved to.

   That failure is quieter than a misrouted instruction and worse in one
   respect: the signal that some other agent needed a human is gone, and nothing
   reports that it was cleared. An operator does not discover it — they simply
   never learn that somebody asked.

   The root cause is not either call site. It is that a safety invariant existed
   in two copies, so fixing one left the other reading correct in isolation.
   canWriteToTarget is now the only copy, and these pin its meaning. */

const attested: CmuxTarget = { resolution: "exact", surfaceId: "SURFACE-ATTESTED" };
const cwdMatched: CmuxTarget = {
  resolution: "unique-cwd",
  surfaceId: "SURFACE-UNCLAIMED",
  reason: "Matched one active source to the only unclaimed cmux surface with this exact cwd.",
};

describe("one gate, so a caller cannot be fixed alone", () => {
  test("only an attested surface may be written to", () => {
    expect(canWriteToTarget(attested)).toBe(true);
    /* The whole defect in one assertion. A directory match is the ABSENCE of
       identity evidence — targets.ts picks it from surfaces whose
       sourceSessionIds are empty — so it can never authorise acting on the pane. */
    expect(canWriteToTarget(cwdMatched)).toBe(false);
  });

  test("every unproven resolution is refused, not just the one we thought of", () => {
    /* `unique-cwd` was the resolution that shipped the bug, and pinning only it
       would leave the gate an allowlist of remembered mistakes. Anything that is
       not `exact` is not proof. */
    for (const resolution of ["unique-cwd", "ambiguous", "missing"] as const) {
      expect(canWriteToTarget({ resolution, surfaceId: "SURFACE-X" }), resolution).toBe(false);
    }
  });

  test("a resolution that says exact but names no surface is still refused", () => {
    // There is nothing to address, so "proven" describes nothing.
    expect(canWriteToTarget({ resolution: "exact" })).toBe(false);
    expect(canWriteToTarget({ resolution: "exact", surfaceId: "" })).toBe(false);
  });

  test("both write paths read this function rather than their own copy", async () => {
    /* The regression that actually happened, pinned structurally: control.ts was
       fixed and app.ts kept an identical inline predicate for hours on main. A
       call site that reconstructs the test locally is how that recurs, so the
       literal is banned from both files rather than merely corrected in them. */
    const read = async (path: string): Promise<string> =>
      Bun.file(new URL(`../${path}`, import.meta.url)).text();

    for (const path of ["src/server/app.ts", "src/server/control.ts"]) {
      const source = await read(path);
      expect(source, `${path} does not use the shared write gate`).toContain("canWriteToTarget");
      expect(source, `${path} still carries its own copy of the both-tiers test`)
        .not.toContain('["exact", "unique-cwd"]');
    }
  });
});

describe("what the operator is told when the write is refused", () => {
  test("the attention refusal names the risk that is specific to it", async () => {
    /* Not the instruct wording. Acknowledging does not type anything; it clears
       a request for a human, and the reason has to say that or an operator
       cannot tell what they are being protected from. */
    const source = await Bun.file(new URL("../src/server/app.ts", import.meta.url)).text();

    expect(source).toContain("clear a different agent's request for a human");
    expect(source).toContain("as soon as cmux attests the session");
  });

  test("a row with no surface at all keeps its own plainer reason", async () => {
    /* Telling someone "matched by working directory" about a pane that does not
       exist would trade one confusion for another. */
    const source = await Bun.file(new URL("../src/server/app.ts", import.meta.url)).text();

    expect(source).toContain("The agent has no safely resolved cmux surface.");
  });
});
