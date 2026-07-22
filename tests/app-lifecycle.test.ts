import { describe, expect, test } from "bun:test";
import { createMountainFetch, emptySnapshot, type MountainAppState } from "../src/server/app";
import type { ArchiveStore, CommandRunner } from "../src/server/types";

describe("SSE lifecycle", () => {
  test("disposing the app unsubscribes state, closes active streams, and rejects new clients", async () => {
    const listeners = new Set<(snapshot: ReturnType<typeof emptySnapshot>) => void>();
    const state: MountainAppState = {
      get: emptySnapshot,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      refresh: async () => emptySnapshot(),
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    const fetch = createMountainFetch({ state, runner, archiveStore, webRoot: import.meta.dir });
    const response = await fetch(new Request("http://127.0.0.1:4701/api/events"));
    const reader = response.body!.getReader();

    expect(response.status).toBe(200);
    expect((await reader.read()).done).toBe(false);
    expect(listeners.size).toBe(1);

    fetch.dispose();
    expect((await reader.read()).done).toBe(true);
    expect(listeners.size).toBe(0);
    expect((await fetch(new Request("http://127.0.0.1:4701/api/events"))).status).toBe(503);

    expect(() => fetch.dispose()).not.toThrow();
  });
});
