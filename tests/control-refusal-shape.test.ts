import { describe, expect, test } from "bun:test";
import { identityDebugResponse } from "../src/server/debug-identity";
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
  test("an unbound Cursor session carries one cause, one remedy, and a route to its observations", async () => {
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
          "No cmux hook-store record exists for this source session.",
          "No recorded cmux target IDs on this source.",
          "Source session ID is not present on any ready cmux surface this scan.",
          "Cursor GUI agents require exact cmux identity; cwd fallback is disabled.",
        ],
        observationsUrl: "/api/debug/identity?agent=cursor%3Abebe2e7c-c783-4449-b75d-d707cba51ac4",
      },
    });
    expect(agent.controlRefusal.message).toBeUndefined();
    expect(agent.controls.find(({ action }: any) => action === "focus").reason)
      .toBe(agent.controlRefusal.cause);
    expect(agent.controls.find(({ action }: any) => action === "instruct").reason)
      .toBe(agent.controlRefusal.cause);

    const proofResponse = identityDebugResponse(
      new URL(agent.controlRefusal.evidence.observationsUrl, "http://127.0.0.1:4701"),
      snapshot,
      scannedSurfaces,
      {},
    );
    const proof = await proofResponse.json();
    const reasons = proof.relatedSurfaces.map((surface: any) => surface.routeObservation.reason);
    expect(reasons).toHaveLength(2);
    expect(reasons.every((reason: unknown) => typeof reason === "string" && reason.length > 0)).toBe(true);
  });

  test("multiple refusals do not serialize one copy of the surface inventory per agent", () => {
    const agents = [cursor, {
      ...cursor,
      id: "cursor:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      sourceSessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }, {
      ...cursor,
      id: "cursor:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      sourceSessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    }];
    const snapshot = buildSnapshot({
      agents,
      surfaces: scannedSurfaces,
      archiveStore,
      now: new Date("2026-08-03T17:09:30.000Z"),
    });
    const wire = JSON.parse(JSON.stringify(snapshot));
    const refusals = wire.programs
      .flatMap((program: any) => program.agents)
      .map((agent: any) => agent.controlRefusal);
    const serialized = JSON.stringify(wire);

    expect(refusals).toHaveLength(agents.length);
    expect(refusals.map((refusal: any) => refusal.evidence.observationsUrl)).toEqual(
      agents.map(({ id }) => `/api/debug/identity?agent=${encodeURIComponent(id)}`),
    );
    expect(serialized).not.toContain('"scannedSurfaces"');
    expect(serialized).not.toContain("SURFACE-OTHER");
    expect(serialized).not.toContain(otherSessionId);
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
      // The source recorded the ending; a status word is no longer evidence of one.
      agents: [{ ...cursor, endEvidence: "session-exit" as const }],
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
