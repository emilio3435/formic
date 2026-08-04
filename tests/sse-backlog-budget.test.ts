import { describe, expect, test } from "bun:test";
import {
  createMountainFetch,
  MAX_SSE_BACKLOG_BYTES,
  MemoryActionLogStore,
  type MountainAppState,
} from "../src/server/app";
import { MemoryAttentionStore } from "../src/server/cmux";
import type { ArchiveStore, CommandResult, CommandRunner } from "../src/server/types";
import type { HubSnapshot } from "../src/shared/types";

/* The SSE backlog budget, measured at its boundary rather than read.

   Every client's FIRST event is a whole snapshot, enqueued directly and
   deliberately unchecked — a delta means nothing without the base it applies
   to. The budget then governs everything after it. So the budget is only a
   budget if it is bigger than that mandatory first payload, and at 2MB it had
   stopped being one: a live snapshot measured 2,334,323 bytes, 11% over the
   whole allowance.

   What that did was not obvious from reading it, which is why it was measured.
   The board does not block and does not error. It CLOSES THE CLIENT'S STREAM —
   the one disconnect the server chooses rather than observes — and the client
   reconnects and is sent another whole snapshot. The symptom an operator gets
   is a board that stopped updating for a moment, with nothing anywhere saying
   why, which is the failure class this project has spent two days removing.

   It was not yet biting: 2.2ms to drain against a delta every ~3.8s is about
   0.06% exposure. But both terms grow with the fleet at once — a bigger board
   takes longer to drain and changes more often — so the margin shrinks
   quadratically while presenting no symptom until it does. */

const ORIGIN = "http://127.0.0.1:4701";
const OK: CommandResult = { exitCode: 0, stdout: "", stderr: "", timedOut: false };
const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
const runner: CommandRunner = { run: async () => OK };

/** A snapshot whose serialised event is about `bytes` long, as the live one is. */
function board(tag: string, bytes: number): HubSnapshot {
  const filler = "x".repeat(2_000);
  const agents = Array.from({ length: Math.max(1, Math.ceil(bytes / 2_100)) }, (_, index) => ({
    id: `codex:a${index}`, provider: "codex", sourceSessionId: `a${index}`,
    displayName: `Agent ${index}`, status: "running", statusReason: tag, activity: "working",
    updatedAt: new Date(0).toISOString(), tokens: { provenance: "unknown" },
    artifacts: [], gates: [], transcriptTail: filler,
  }));
  return {
    schemaVersion: 1,
    generatedAt: new Date(0).toISOString(),
    controlHealth: { cmuxReachable: true, lastCheckedAt: new Date(0).toISOString(), errors: [], staleSources: [] },
    totals: { live: agents.length, tracked: agents.length, attention: 0 },
    programs: [{ id: "p", name: "P", agents }],
  } as unknown as HubSnapshot;
}

/** An app whose snapshot can be replaced, driving a real delta to every client. */
function harness(initialBytes: number) {
  let snapshot = board("first", initialBytes);
  let notify: ((next: HubSnapshot) => void) | undefined;
  const state: MountainAppState = {
    get: () => snapshot,
    subscribe: (listener) => { notify = listener; return () => {}; },
    refresh: async () => snapshot,
  };
  const fetch = createMountainFetch({
    state, runner, archiveStore,
    actionLogStore: new MemoryActionLogStore(),
    attentionStore: new MemoryAttentionStore(),
    webRoot: import.meta.dir,
    heartbeatMs: 1_000_000,
  } as never);
  return {
    fetch,
    /** Publishes a materially different snapshot, so a delta is broadcast. */
    change(bytes: number, tag: string) {
      snapshot = board(tag, bytes);
      notify!(snapshot);
    },
  };
}

const asText = (value: unknown): string =>
  typeof value === "string" ? value : new TextDecoder().decode(value as Uint8Array);

/** Reads whatever is available within `ms`, reporting whether the server closed. */
async function drain(reader: ReadableStreamDefaultReader<unknown>, ms: number) {
  let text = "";
  let closed = false;
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<{ timedOut: true }>((resolve) =>
        setTimeout(() => resolve({ timedOut: true }), Math.max(1, until - Date.now()))),
    ]);
    if ("timedOut" in chunk) break;
    if (chunk.done) { closed = true; break; }
    text += asText(chunk.value);
  }
  return { text, closed };
}

describe("a client that falls behind is dropped, and it is the server's choice", () => {
  test("a snapshot larger than the whole budget costs the client its stream", async () => {
    /* THE BOUNDARY, reproduced. The client never reads, so its backlog is still
       the opening snapshot when a delta arrives. The server closes it and the
       delta is never delivered — no error to the client, no exception here. */
    const { fetch, change } = harness(MAX_SSE_BACKLOG_BYTES + 400_000);
    const response = await fetch(new Request(`${ORIGIN}/api/events`));
    const reader = response.body!.getReader();

    change(MAX_SSE_BACKLOG_BYTES + 400_000, "second");
    const { text, closed } = await drain(reader, 400);
    fetch.dispose();

    expect(closed, "the server kept a client whose backlog exceeded the budget").toBe(true);
    expect(text).toContain("event: snapshot");
    expect(text).not.toContain("event: snapshot-delta");
  });

  test("a snapshot that FITS the budget leaves the client connected", async () => {
    /* THE FIX, and the assertion the budget exists to make true. Same client,
       same reading behaviour, same delta — only the payload now fits with room
       to spare, so falling briefly behind is survivable rather than fatal. This
       is what a backlog budget is supposed to buy, and at 2MB against a 2.33MB
       snapshot it bought nothing. */
    const { fetch, change } = harness(1_000_000);
    const response = await fetch(new Request(`${ORIGIN}/api/events`));
    const reader = response.body!.getReader();

    change(1_000_000, "second");
    const { text, closed } = await drain(reader, 400);
    fetch.dispose();

    expect(closed).toBe(false);
    expect(text).toContain("event: snapshot-delta");
  });

  test("the budget holds more than one whole snapshot", async () => {
    /* The property in one line, and the one that failed silently in production.
       A budget below the size of the mandatory first payload cannot tolerate
       anything: every client is over it from the moment it connects. Measured
       against a real board of 2,334,323 bytes with a healthy multiple of room,
       so this fails while there is still time to act rather than after. */
    expect(MAX_SSE_BACKLOG_BYTES).toBeGreaterThan(3 * 2_334_323);
  });
});

describe("a stream the server closes is counted", () => {
  test("the drop is reported on /api/health rather than only in stderr", async () => {
    /* Legibility, which matters more here than the threshold. This is the one
       disconnect the SERVER chooses — a client that goes away throws on enqueue
       and is simply forgotten — and it presents as a board that stopped
       updating. Uncounted, the only symptom is staleness with nothing to
       explain it; EventSource reconnects, is sent another whole snapshot, and
       can be dropped again. */
    const { fetch, change } = harness(MAX_SSE_BACKLOG_BYTES + 400_000);
    const before = await (await fetch(new Request(`${ORIGIN}/api/health`))).json() as
      { data: { sseBacklogDrops: number } };
    expect(before.data.sseBacklogDrops).toBe(0);

    const response = await fetch(new Request(`${ORIGIN}/api/events`));
    const reader = response.body!.getReader();
    change(MAX_SSE_BACKLOG_BYTES + 400_000, "second");
    await drain(reader, 400);

    const after = await (await fetch(new Request(`${ORIGIN}/api/health`))).json() as
      { data: { sseBacklogDrops: number } };
    fetch.dispose();

    expect(after.data.sseBacklogDrops).toBe(1);
  });

  test("an ordinary disconnect is not counted as a drop", async () => {
    /* The control, and the reason the counter is worth having: if leaving were
       counted the number would climb on every page close and mean nothing, and
       an alarm that fires constantly is one nobody reads.

       WHAT THIS DOES NOT ESTABLISH, stated because a mutation proved it. There
       are two ways a client stops being written to: the backlog branch above,
       and `enqueue` throwing because the socket is gone. Cancelling a reader
       here fires the stream's own `cancel()`, which removes the client from the
       set BEFORE any broadcast reaches it — so this exercises the clean path
       and never the throwing one. Adding a counter bump to that catch does not
       redden this test.

       Reaching it needs an abrupt transport close with no cancel, which is a
       real production case and is not constructible in-process. The distinction
       is enforced by the code reading plainly, not by this assertion. */
    const { fetch, change } = harness(1_000)  ;
    const response = await fetch(new Request(`${ORIGIN}/api/events`));
    const reader = response.body!.getReader();
    await drain(reader, 50);
    await reader.cancel().catch(() => {});
    change(1_000, "second");

    const health = await (await fetch(new Request(`${ORIGIN}/api/health`))).json() as
      { data: { sseBacklogDrops: number } };
    fetch.dispose();

    expect(health.data.sseBacklogDrops).toBe(0);
  });
});
