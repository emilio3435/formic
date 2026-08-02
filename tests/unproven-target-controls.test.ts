import { describe, expect, test } from "bun:test";
import { controlsFor } from "../src/server/snapshot-agent";
import type { AgentSnapshot } from "../src/shared/types";
import type { CollectedAgent } from "../src/server/types";

/* A cwd string is not an identity.

   `exact` means cmux attests the session is on that surface. `unique-cwd`
   (targets.ts) picks among surfaces whose `sourceSessionIds` is EMPTY — panes
   carrying no identity evidence at all — by process of elimination on a
   directory string. The write gate in control.ts treated the two as one claim.

   The reproduction is the most ordinary thing an operator does: a pane cds
   away, another cds in. Nothing closes, no agent ends, and the row re-resolves
   onto the second pane still advertising Send. An instruction addressed to
   ALPHA then executes on BRAVO's tty and answers ok: true while ALPHA receives
   nothing.

   control.ts is pinned by tests/write-path-routing.test.ts. This file pins the
   half an operator actually sees: whether the button is offered, and whether
   the row explains itself. A server that refuses the write while the board
   still shows Send as available has moved the lie rather than removed it. */

const source = (): CollectedAgent => ({
  id: "codex:alpha",
  provider: "codex",
  sourceSessionId: "alpha",
  displayName: "Alpha",
  cwd: "/Users/me/project",
  status: "running",
  statusReason: "Fixture activity is recent.",
  updatedAt: "2026-08-02T12:00:00.000Z",
  tokens: { provenance: "unknown" },
  artifacts: [],
  gates: [],
});

const EXACT: AgentSnapshot["target"] = {
  surfaceId: "SURFACE-ATTESTED",
  resolution: "exact",
  reason: "cmux reports this session on this surface.",
};

const CWD_MATCHED: AgentSnapshot["target"] = {
  surfaceId: "SURFACE-UNCLAIMED",
  resolution: "unique-cwd",
  reason: "Matched one active source to the only unclaimed cmux surface with this exact cwd.",
};

const by = (target: AgentSnapshot["target"], archived = false) => {
  const controls = controlsFor(source(), target, archived);
  return (action: string) => controls.find((control) => control.action === action)!;
};

describe("the board does not offer a write it will refuse", () => {
  test("a directory-matched row shows Send and Interrupt as unavailable", () => {
    /* The defect this closes is not only the misrouted send — it is that the
       row advertised the control. An enabled button that answers 409 teaches an
       operator that the cockpit is flaky; a disabled one with a reason teaches
       them what is actually true about the pane. */
    const control = by(CWD_MATCHED);

    expect(control("instruct").enabled).toBe(false);
    expect(control("interrupt").enabled).toBe(false);
  });

  test("the reason names the cause, the risk and the way back", () => {
    // "make the refusal SAY why so an operator understands the control is off
    // rather than broken" — the three things that distinguishes.
    const reason = by(CWD_MATCHED)("instruct").reason ?? "";

    expect(reason).toMatch(/working directory/i);            // the cause
    expect(reason).toMatch(/different agent|cannot be proven/i); // the risk
    expect(reason).toMatch(/as soon as cmux attests/i);       // the way back
  });

  test("an attested row keeps every control, so this is a gate and not a wall", () => {
    /* The other side of the property, and the one a panicked fix breaks. A
       cockpit that can never act on any agent has failed in the same way as one
       that acts on the wrong agent — it just fails quietly. */
    const control = by(EXACT);

    expect(control("instruct").enabled).toBe(true);
    expect(control("interrupt").enabled).toBe(true);
    expect(control("focus").enabled).toBe(true);
    expect(control("instruct").reason).toBeUndefined();
  });

  test("focus survives a directory match, because looking is how you resolve it", () => {
    /* Scoped deliberately: focus puts no characters into a tty, and once Send
       is off, going to look at the pane is the operator's only way to settle
       what is on it. The tests lane argues focus should be gated too — that
       disagreement is recorded, still failing, in write-path-routing.test.ts. */
    expect(by(CWD_MATCHED)("focus").enabled).toBe(true);
  });

  test("an unrouted row explains itself with the target's own reason, not the new one", () => {
    /* A row with no surface at all is a different fact from a row matched by
       directory, and telling an operator "matched by working directory" about a
       pane that does not exist would be a new confusion for an old one. */
    const missing = by({ resolution: "missing", reason: "No cmux surface matches this source session or cwd." });

    expect(missing("instruct").enabled).toBe(false);
    expect(missing("instruct").reason).toMatch(/No cmux surface matches/i);
    expect(missing("instruct").reason).not.toMatch(/working directory/i);
  });

  test("archiving still wins over routing, and says so", () => {
    const archived = by(CWD_MATCHED, true);

    expect(archived("instruct").enabled).toBe(false);
    // An archived agent is not a routing problem; the reason must not claim it is.
    expect(archived("instruct").reason).toBe("Agent is archived.");
    expect(archived("focus").enabled).toBe(false);
  });
});
