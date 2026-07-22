import { describe, expect, test } from "bun:test";
import { HubState, type HubCollectors } from "../src/server/state";
import type { ArchiveStore, CommandRunner } from "../src/server/types";

const emptySessions = () => ({
  omp: { value: [], errors: [] },
  codex: { value: [], errors: [] },
  claude: { value: [], errors: [] },
  cursor: { value: [], errors: [] },
});

describe("cmux collection time truth", () => {
  test("a cmux request coalesced behind a source refresh still runs once and remains the lastCheckedAt", async () => {
    let releaseFirst!: () => void;
    const firstSessionScan = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let sessionCalls = 0;
    let cmuxCalls = 0;
    const collectors: HubCollectors = {
      sessions: async () => {
        sessionCalls += 1;
        if (sessionCalls === 1) await firstSessionScan;
        return emptySessions();
      },
      cmux: async () => {
        cmuxCalls += 1;
        return { value: [], errors: [] };
      },
      notifications: async () => ({ value: [], errors: [] }),
      enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [] }),
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
    const state = new HubState(runner, archiveStore, [], collectors);

    const sourceOnly = state.refresh();
    const queuedCmux = state.refresh({ cmux: true });
    releaseFirst();
    await Promise.all([sourceOnly, queuedCmux]);

    const checkedAt = state.get().controlHealth.lastCheckedAt;
    expect(cmuxCalls).toBe(1);
    expect(checkedAt).not.toBe(new Date(0).toISOString());
    expect(state.get().controlHealth.cmuxReachable).toBe(true);

    await state.refresh();
    expect(sessionCalls).toBe(3);
    expect(cmuxCalls).toBe(1);
    expect(state.get().controlHealth.lastCheckedAt).toBe(checkedAt);
  });
});
