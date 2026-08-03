import { describe, expect, test } from "bun:test";
import { buildSnapshot } from "../src/server/snapshot";
import type { ArchiveStore, CollectedAgent } from "../src/server/types";

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };

const cursor: CollectedAgent = {
  id: "cursor:bebe2e7c-c783-4449-b75d-d707cba51ac4",
  provider: "cursor",
  sourceSessionId: "bebe2e7c-c783-4449-b75d-d707cba51ac4",
  displayName: "App speed RCA + plan",
  cwd: "/Users/me/project",
  status: "running",
  statusReason: "Cursor session metadata is recent.",
  updatedAt: "2026-08-03T17:09:29.237Z",
  tokens: { provenance: "unknown" },
  artifacts: [],
  gates: [],
  allowCwdFallback: false,
};

const otherSessionId = "11111111-2222-4333-8444-555555555555";
const scannedSurfaces = [
  {
    workspaceId: "WORKSPACE-OTHER",
    surfaceId: "SURFACE-OTHER",
    paneId: "PANE-OTHER",
    tty: "ttys041",
    cwd: cursor.cwd,
    sourceSessionIds: [otherSessionId],
  },
  {
    workspaceId: "WORKSPACE-EMPTY",
    surfaceId: "SURFACE-EMPTY",
    paneId: "PANE-EMPTY",
    tty: "ttys042",
    cwd: "/Users/me/elsewhere",
    sourceSessionIds: [],
  },
];

describe("control refusal wire shape", () => {
  test("an unbound Cursor session carries one cause, one remedy, and the observations", () => {
    /* This is the live production shape that previously forced the client to
       repeat one policy sentence across target, Focus, Send and Interrupt. The
       renderer can now address the explanation, recovery and proof separately. */
    const snapshot = buildSnapshot({
      agents: [cursor],
      surfaces: scannedSurfaces,
      archiveStore,
      now: new Date("2026-08-03T17:09:30.000Z"),
    });
    const wire = JSON.parse(JSON.stringify(snapshot));
    const agent = wire.programs.flatMap((program: any) => program.agents)[0];

    expect(agent.controlRefusal).toEqual({
      code: "UNSAFE_TARGET",
      cause: "No safe cmux target is linked to this session.",
      remedy: "Open it in a cmux pane (or start the agent from one); the next scan binds it.",
      evidence: {
        resolutionSteps: [
          "No recorded cmux target IDs on this source.",
          "Source session ID is not present on any ready cmux surface this scan.",
          "Cursor GUI agents require exact cmux identity; cwd fallback is disabled.",
        ],
        scannedSurfaces: [
          {
            workspaceId: "WORKSPACE-OTHER",
            surfaceId: "SURFACE-OTHER",
            paneId: "PANE-OTHER",
            tty: "ttys041",
            reportedSessionIds: [otherSessionId],
            sessionIdMatched: false,
            cwdMatched: true,
            reason: `Pane PANE-OTHER (surface SURFACE-OTHER, ttys041) reported session ID ${otherSessionId}; none equals source session ${cursor.sourceSessionId}. Its cwd matches the source, but cwd evidence is not exact session identity.`,
          },
          {
            workspaceId: "WORKSPACE-EMPTY",
            surfaceId: "SURFACE-EMPTY",
            paneId: "PANE-EMPTY",
            tty: "ttys042",
            reportedSessionIds: [],
            sessionIdMatched: false,
            cwdMatched: false,
            reason: `Pane PANE-EMPTY (surface SURFACE-EMPTY, ttys042) reported no source session IDs; source session ${cursor.sourceSessionId} could not match.`,
          },
        ],
      },
    });
    expect(agent.controlRefusal.message).toBeUndefined();
    expect(agent.controls.find(({ action }: any) => action === "focus").reason)
      .toBe(agent.controlRefusal.cause);
    expect(agent.controls.find(({ action }: any) => action === "instruct").reason)
      .toBe(agent.controlRefusal.cause);
  });

  test("a linked session carries no refusal object", () => {
    const snapshot = buildSnapshot({
      agents: [cursor],
      surfaces: [{
        surfaceId: "SURFACE-CURSOR",
        sourceSessionIds: [cursor.sourceSessionId],
        cwd: cursor.cwd,
      }],
      archiveStore,
      now: new Date("2026-08-03T17:09:30.000Z"),
    });
    const wire = JSON.parse(JSON.stringify(snapshot));
    const agent = wire.programs.flatMap((program: any) => program.agents)[0];

    expect(agent.controlRefusal).toBeUndefined();
    expect(agent.controls.find(({ action }: any) => action === "instruct").enabled).toBe(true);
  });

  test("ended history rows do not repeat live routing evidence", () => {
    const snapshot = buildSnapshot({
      agents: [{ ...cursor, status: "archived" }],
      surfaces: [],
      archiveStore,
      now: new Date("2026-08-03T17:09:30.000Z"),
    });
    const wire = JSON.parse(JSON.stringify(snapshot));
    const agent = wire.programs.flatMap((program: any) => program.agents)[0];

    expect(agent.activity).toBe("ended");
    expect(agent.controlRefusal).toBeUndefined();
    expect(agent.controls.find(({ action }: any) => action === "instruct").enabled).toBe(false);
  });
});
