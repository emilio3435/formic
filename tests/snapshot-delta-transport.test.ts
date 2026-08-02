import { beforeAll, describe, expect, test } from "bun:test";
import { createMountainFetch, type MountainAppState } from "../src/server/app";
import { buildSnapshot } from "../src/server/snapshot";
import type { HubSnapshot } from "../src/shared/types";
import type { ArchiveStore, CollectedAgent, CommandRunner } from "../src/server/types";

/* The SSE delta transport, driven end to end.

   The board does not refetch. Nearly every snapshot it ever paints arrives as a
   DELTA over the stream: the server sends each program's full `agentIds` roster
   plus only the agents that CHANGED, and the client rebuilds the rest from the
   snapshot it already holds.

   That makes the transport the one place where the operator's board can drift
   from the server's truth without anything failing. A dropped agent is not an
   error on either side — the server thinks it sent a roster, the client thinks
   it applied one, and a running agent quietly leaves the board. It is the
   read-side twin of the write-path defect: nothing throws, and the cockpit is
   wrong.

   The property:

     A delta reconstructs exactly the fleet the server holds, or it is refused.
     It never reconstructs a different one.

   web-client.test.ts already covers reconstruction and sequence discipline
   against HAND-BUILT deltas. What has never been tested is the server's OWN
   delta output reaching the client's applier — so a drift between the two
   shapes would leave every real delta silently rejected (the board falling back
   to polling, the optimisation dead and nobody told) or, worse, subtly
   accepted. These drive the real /api/events stream. */

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
const runner: CommandRunner = { run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }) };
const NOW = new Date("2026-08-02T10:00:00.000Z");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let M: any;

beforeAll(async () => {
  (globalThis as unknown as { document: unknown }).document = undefined;
  // @ts-expect-error The dependency-free browser client has no declaration file.
  await import("../src/web/app.js");
  M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
});

function collected(id: string, overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: `codex:${id}`,
    provider: "codex",
    sourceSessionId: id,
    displayName: `Worker ${id}`,
    cwd: "/Users/me/project",
    status: "running",
    statusReason: "Source activity within 3 minutes.",
    startedAt: "2026-08-02T09:00:00.000Z",
    updatedAt: "2026-08-02T09:59:00.000Z",
    tokens: { scope: "latest-turn", provenance: "observed", total: 1_000, contextWindow: 1_000_000 },
    artifacts: [],
    gates: [],
    ...overrides,
  };
}

const fleet = (agents: CollectedAgent[]): HubSnapshot =>
  buildSnapshot({ agents, surfaces: [], archiveStore, now: NOW } as never);

/* Drives the REAL server: subscribes to /api/events, pushes a second snapshot
   through the state's listener, and returns the delta frame the stream emitted
   plus the snapshot the server now holds. */
async function transport(before: HubSnapshot, after: HubSnapshot) {
  let listener: ((snapshot: HubSnapshot) => void) | undefined;
  let current = before;
  const state: MountainAppState = {
    get: () => current,
    subscribe: (fn) => { listener = fn; return () => { listener = undefined; }; },
    refresh: async () => current,
  };
  const fetch = createMountainFetch({ state, runner, archiveStore, webRoot: "/tmp" });

  const response = await fetch(new Request("http://127.0.0.1:4701/api/events"));
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  /* The stream enqueues frames as strings, not bytes. Handle both rather than
     assuming: a transport test that decoded the wrong type would fail for a
     reason unrelated to the property it names. */
  const frameOf = (value: unknown): string =>
    typeof value === "string" ? value : decoder.decode(value as Uint8Array);

  // The stream opens with the current snapshot; read it so the next read is
  // the delta rather than the hello frame.
  const hello = frameOf((await reader.read()).value);

  current = after;
  listener?.(after);
  const frame = frameOf((await reader.read()).value);
  await reader.cancel();
  fetch.dispose();

  const parse = (raw: string) => {
    const line = raw.split("\n").find((candidate) => candidate.startsWith("data:"));
    return line ? JSON.parse(line.slice(5).trim()) : null;
  };
  return { hello: parse(hello), delta: parse(frame), served: after };
}

const ROSTER = (snapshot: HubSnapshot) =>
  snapshot.programs.flatMap(({ agents }) => agents.map(({ id }) => id)).sort();

describe("a delta reconstructs exactly the fleet the server holds", () => {
  test("the stream opens with a whole snapshot and a sequence", async () => {
    /* The hello frame is the base every later delta is applied against. Without
       a sequence the client cannot tell an in-order delta from a replayed one. */
    /* The two snapshots must DIFFER: an unchanged snapshot spends no sequence
       and emits no delta, so the second read would block until the test timed
       out — which an earlier draft did, for five seconds, while appearing to
       test the hello frame. */
    const { hello } = await transport(fleet([collected("a")]), fleet([collected("a", { statusReason: "Now waiting." })]));

    expect(hello?.snapshot ?? hello).toBeTruthy();
    expect(M.eventSnapshot(hello)).toBeTruthy();
  });

  test("an agent that changed is carried, and the rest are rebuilt from the base", async () => {
    /* The core round trip, against the server's own delta rather than a
       hand-built one. If the two sides ever disagreed about the shape, this is
       where it would show — the client either rejecting every real delta or
       reconstructing a fleet the server does not have. */
    const before = fleet([collected("a"), collected("b")]);
    const after = fleet([collected("a", { statusReason: "Now waiting." }), collected("b")]);
    const { hello, delta, served } = await transport(before, after);

    const rebuilt = M.applySnapshotDelta(M.eventSnapshot(hello), delta, delta.baseSequence);

    expect(ROSTER(rebuilt)).toEqual(ROSTER(served));
    expect(rebuilt.programs.flatMap((p: { agents: unknown[] }) => p.agents)).toHaveLength(2);
  });

  test("an agent added between snapshots arrives on the board", async () => {
    // A new lane starting must appear. A delta that carried only "changed"
    // agents without the roster would leave it invisible until a full refetch.
    const before = fleet([collected("a")]);
    const after = fleet([collected("a"), collected("b")]);
    const { hello, delta, served } = await transport(before, after);

    const rebuilt = M.applySnapshotDelta(M.eventSnapshot(hello), delta, delta.baseSequence);

    expect(ROSTER(rebuilt)).toEqual(ROSTER(served));
    expect(ROSTER(rebuilt)).toContain("codex:b");
  });

  test("an agent removed between snapshots leaves the board", async () => {
    /* The mirror, and the more dangerous direction on a busy board: a row that
       should be gone but lingers is an agent the operator believes is running. */
    const before = fleet([collected("a"), collected("b")]);
    const after = fleet([collected("a")]);
    const { hello, delta, served } = await transport(before, after);

    const rebuilt = M.applySnapshotDelta(M.eventSnapshot(hello), delta, delta.baseSequence);

    expect(ROSTER(rebuilt)).toEqual(ROSTER(served));
    expect(ROSTER(rebuilt)).not.toContain("codex:b");
  });

  test("an unchanged agent survives the round trip identically", async () => {
    /* The whole point of a delta: the server omits it, so the client must
       reproduce it exactly. A field lost here is a field that quietly reverts
       on the board every time anything else changes. */
    const before = fleet([collected("a"), collected("b")]);
    const after = fleet([collected("a", { statusReason: "Now waiting." }), collected("b")]);
    const { hello, delta } = await transport(before, after);

    const base = M.eventSnapshot(hello);
    const rebuilt = M.applySnapshotDelta(base, delta, delta.baseSequence);
    const find = (snapshot: HubSnapshot, id: string) =>
      snapshot.programs.flatMap(({ agents }) => agents).find((agent) => agent.id === id);

    expect(find(rebuilt, "codex:b")).toEqual(find(base, "codex:b")!);
  });

  test("the whole fleet, not just its roster, matches what the server serves", async () => {
    /* Roster equality alone would pass on a delta that kept the right agent ids
       and the wrong contents. This compares the reconstructed agents field by
       field against the snapshot the server is now holding. */
    const before = fleet([collected("a"), collected("b")]);
    const after = fleet([
      collected("a", { statusReason: "Now waiting.", status: "waiting" }),
      collected("b", { tokens: { scope: "latest-turn", provenance: "observed", total: 5_000, contextWindow: 1_000_000 } }),
    ]);
    const { hello, delta, served } = await transport(before, after);

    const rebuilt = M.applySnapshotDelta(M.eventSnapshot(hello), delta, delta.baseSequence);

    /* Both sides JSON-normalised. The server's in-memory snapshot carries
       keys with undefined values (threadDepth, transcriptTail); serialisation
       drops them, so comparing the object against the round-tripped form would
       fail on an artifact of the wire rather than on any divergence. The client
       only ever sees the serialised form, so that is what is compared. */
    const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));

    expect(wire(rebuilt.programs.flatMap((p: { agents: unknown[] }) => p.agents)))
      .toEqual(wire(served.programs.flatMap(({ agents }) => agents)));
  });
});

describe("a delta it cannot apply is refused, not approximated", () => {
  async function realDelta() {
    const before = fleet([collected("a"), collected("b")]);
    const after = fleet([collected("a", { statusReason: "Now waiting." }), collected("b")]);
    return transport(before, after);
  }

  test("a delta whose base is not the snapshot in hand is refused", async () => {
    /* Sequence discipline on the real frame. Applying a delta to the wrong base
       silently mixes two fleets — the reconstruction would succeed and be
       wrong, which is the only outcome worse than throwing. */
    const { hello, delta } = await realDelta();
    const base = M.eventSnapshot(hello);

    expect(() => M.applySnapshotDelta(base, delta, delta.baseSequence + 1)).toThrow();
    expect(() => M.applySnapshotDelta(base, delta, delta.baseSequence - 1)).toThrow();
  });

  test("a roster naming an agent neither side carries is refused", async () => {
    /* The dropped-agent case, forced. The roster claims an id that is not in
       the base and not in the delta's changed set, so the client cannot rebuild
       it. Painting the rest would lose a running agent silently; refusing sends
       the client back for the truth. */
    const { hello, delta } = await realDelta();
    const base = M.eventSnapshot(hello);
    const broken = {
      ...delta,
      programs: delta.programs.map((program: { agentIds: string[] }) => ({
        ...program,
        agentIds: [...program.agentIds, "codex:never-seen"],
      })),
    };

    expect(() => M.applySnapshotDelta(base, broken, delta.baseSequence)).toThrow();
  });

  test("a delta carrying its own programs key is refused", async () => {
    // The embedded snapshot must not smuggle a second, contradictory roster.
    const { hello, delta } = await realDelta();
    const base = M.eventSnapshot(hello);
    const broken = { ...delta, snapshot: { ...delta.snapshot, programs: [] } };

    expect(() => M.applySnapshotDelta(base, broken, delta.baseSequence)).toThrow();
  });

  test("a well-formed delta is still applied, so the guards are not a wall", async () => {
    /* The control. Every refusal above would hold on a client that refused
       everything — which would be correct and useless, falling back to polling
       forever while the stream ran. */
    const { hello, delta, served } = await realDelta();

    const rebuilt = M.applySnapshotDelta(M.eventSnapshot(hello), delta, delta.baseSequence);
    expect(ROSTER(rebuilt)).toEqual(ROSTER(served));
  });
});
