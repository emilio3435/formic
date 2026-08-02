import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMountainFetch, MemoryActionLogStore, SSE_HEARTBEAT_MS, type MountainAppState } from "../src/server/app";
import { MemoryAttentionStore } from "../src/server/cmux";
import type { ArchiveStore, CommandResult, CommandRunner } from "../src/server/types";
import type { HubSnapshot } from "../src/shared/types";

/* Entry 7 of docs/UNTESTED-PATHS-MAP.md — the SSE heartbeat.

   Four lines, never executed by any test, because at the shipped 25 seconds no
   suite can afford to wait for them. That is the whole reason they went
   uncovered, and it is a bad reason: the heartbeat is the only thing that tells
   a client an idle connection is still alive. If it stops, EventSource sits
   there believing it is connected, the board keeps rendering the last snapshot
   it received, and a stopped board is indistinguishable from a quiet one.

   Nothing on the page cross-checks it. The snapshot age ticks from the client's
   own clock, so a stalled feed still shows time passing. This is the same
   intersection entry 3 sat in: an untested path producing a signal no other
   figure contradicts.

   The interval is now injectable — only for this, defaulting to the shipped
   value, which a test asserts. */

const ORIGIN = "http://127.0.0.1:4701";
const OK: CommandResult = { exitCode: 0, stdout: "", stderr: "", timedOut: false };
const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
const runner: CommandRunner = { run: async () => OK };

function board(): HubSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    controlHealth: { cmuxReachable: true, lastCheckedAt: new Date().toISOString(), errors: [], staleSources: [] },
    totals: { live: 0, tracked: 0, attention: 0 },
    programs: [],
  } as unknown as HubSnapshot;
}

function app(heartbeatMs: number) {
  const state: MountainAppState = {
    get: () => board(),
    subscribe: () => () => {},
    refresh: async () => board(),
  };
  return createMountainFetch({
    state,
    runner,
    archiveStore,
    actionLogStore: new MemoryActionLogStore(),
    attentionStore: new MemoryAttentionStore(),
    webRoot: import.meta.dir,
    heartbeatMs,
  } as never);
}

/** Opens /api/events and reads whatever arrives within `ms`. */
async function listen(fetch: ReturnType<typeof app>, ms: number): Promise<{ text: string; cancel: () => Promise<void> }> {
  const response = await fetch(new Request(`${ORIGIN}/api/events`));
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  /* The stream enqueues STRINGS (ReadableStream<string>), so a reader may hand
     back either those or encoded bytes depending on how Response wraps it.
     Accept both rather than assuming, which is what a decoder alone did. */
  const asText = (value: unknown): string =>
    typeof value === "string" ? value : decoder.decode(value as Uint8Array, { stream: true });
  let text = "";
  const until = Date.now() + ms;
  const pump = (async () => {
    while (Date.now() < until) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), Math.max(1, until - Date.now()))),
      ]);
      if (!chunk || chunk.done) break;
      text += asText(chunk.value);
    }
  })();
  await pump;
  return { text, cancel: () => reader.cancel().catch(() => {}) };
}

describe("an idle stream keeps saying it is alive", () => {
  test("a heartbeat arrives on a stream nobody has sent anything to", async () => {
    /* The property, and the one that had never once run. No snapshot changes
       here — only the timer produces output — so a stream that emitted the
       opening snapshot and then went silent would pass every other test in this
       repo and fail this one. */
    const fetch = app(15);
    const { text, cancel } = await listen(fetch, 200);
    await cancel();
    fetch.dispose();

    expect(text).toContain("event: heartbeat");
  });

  test("it keeps arriving, rather than firing once", async () => {
    /* setTimeout instead of setInterval is the plausible slip, and it leaves a
       connection that looks healthy for exactly one beat. */
    const fetch = app(15);
    const { text, cancel } = await listen(fetch, 250);
    await cancel();
    fetch.dispose();

    const beats = text.split("event: heartbeat").length - 1;
    expect(beats, `only ${beats} heartbeat(s) in 250ms at a 15ms interval`).toBeGreaterThan(1);
  });

  test("the heartbeat carries a timestamp a client can read", async () => {
    // A bare event would keep the socket warm but tell a reader nothing about
    // WHEN the server last spoke, which is the fact it exists to convey.
    const fetch = app(15);
    const { text, cancel } = await listen(fetch, 200);
    await cancel();
    fetch.dispose();

    const line = text.split("\n").find((entry) => entry.startsWith("data:") && entry.includes("ts"));
    expect(line, "no heartbeat payload was sent").toBeDefined();
    const { ts } = JSON.parse(line!.slice("data:".length)) as { ts: string };
    expect(Number.isFinite(Date.parse(ts))).toBe(true);
  });

  test("the opening snapshot still arrives before any heartbeat", async () => {
    /* Ordering matters: a client that received a heartbeat first would render
       an empty board until the next refresh, which on a quiet fleet is a long
       time. */
    const fetch = app(15);
    const { text, cancel } = await listen(fetch, 200);
    await cancel();
    fetch.dispose();

    expect(text.indexOf("event: snapshot")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("event: snapshot")).toBeLessThan(text.indexOf("event: heartbeat"));
  });
});

describe("a disconnected client stops being beaten", () => {
  test("cancelling the stream stops the timer rather than leaking it", async () => {
    /* THE LEAK, measured by whether a process can exit.

       An uncleared setInterval holds Bun's event loop open forever, and this
       heartbeat is the ONLY timer in app.ts — so a script that opens a stream,
       cancels it, and then has nothing left to do exits iff `clearInterval`
       ran. Every browser tab a board is ever opened in becomes a timer firing
       against a dead controller for the life of the server otherwise, and a
       laptop that sleeps and wakes opens a lot of them.

       This runs in a SUBPROCESS deliberately. In-process the leak is invisible:
       the next beat calls enqueue on a cancelled controller, that throws, and
       the catch in `enqueueClient` calls `removeClient` — so the damage is
       swallowed and nothing observable changes. An earlier version of this test
       asserted `expect(true).toBe(true)` after a cancel and passed happily with
       the `clearInterval` line deleted. Process exit is the only signal that
       actually discriminates. Note it does NOT call dispose(): dispose clears
       the timers too, which would hide exactly what is under test. */
    const root = mkdtempSync(join(tmpdir(), "anthill-sse-leak-"));
    const script = join(root, "leak.ts");
    const server = join(import.meta.dir, "..", "src", "server");
    writeFileSync(script, `
import { createMountainFetch, MemoryActionLogStore } from ${JSON.stringify(join(server, "app"))};
import { MemoryAttentionStore } from ${JSON.stringify(join(server, "cmux"))};
const board = () => ({
  schemaVersion: 1, generatedAt: new Date().toISOString(), programs: [],
  totals: { live: 0, tracked: 0, attention: 0 },
  controlHealth: { cmuxReachable: true, lastCheckedAt: new Date().toISOString(), errors: [], staleSources: [] },
});
const fetch = createMountainFetch({
  state: { get: board, subscribe: () => () => {}, refresh: async () => board() },
  runner: { run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }) },
  archiveStore: { has: () => false, archive: async () => {} },
  actionLogStore: new MemoryActionLogStore(),
  attentionStore: new MemoryAttentionStore(),
  webRoot: ${JSON.stringify(root)},
  heartbeatMs: 15,
});
const response = await fetch(new Request("http://127.0.0.1:4701/api/events"));
const reader = response.body.getReader();
await reader.read();
await reader.cancel();
console.log("cancelled");
`);

    const child = Bun.spawn(["bun", script], { stdout: "pipe", stderr: "pipe" });
    const exited = await Promise.race([
      child.exited,
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 5_000)),
    ]);
    if (exited === "hung") child.kill();
    rmSync(root, { recursive: true, force: true });

    expect(await new Response(child.stdout).text()).toContain("cancelled");
    expect(
      exited,
      "the process never exited: a heartbeat interval outlived the stream that owned it",
    ).toBe(0);
  }, 15_000);

  test("dispose stops every stream, not only the one that was cancelled", async () => {
    const fetch = app(15);
    const a = await listen(fetch, 80);
    const b = await listen(fetch, 80);

    fetch.dispose();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await Promise.all([a.cancel(), b.cancel()]);

    expect(a.text).toContain("event: heartbeat");
    expect(b.text).toContain("event: heartbeat");
  });
});

describe("the shipped interval is the one that ships", () => {
  test("the default sits under the 30s idle timeout it exists to beat", () => {
    /* The injectable interval is a test seam, not a setting, so the value that
       actually runs needs pinning: above 30 seconds and proxies and browsers
       start declaring the stream dead, which is the exact outcome the heartbeat
       is there to prevent. */
    expect(SSE_HEARTBEAT_MS).toBeLessThan(30_000);
    expect(SSE_HEARTBEAT_MS).toBeGreaterThan(1_000);
  });
});
