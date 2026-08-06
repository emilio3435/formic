import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { enrichCmuxIdentity } from "../src/server/identity";
import {
  BINDING_BRIDGE_REASON,
  bridgeAgentsWithBindings,
  IDENTITY_BINDING_TTL_MS,
  JsonIdentityBindingStore,
  MemoryIdentityBindingStore,
  updateBindingsFromScan,
  type BindingFileOperations,
  type IdentityBinding,
} from "../src/server/identity-bindings";
import { resolveAgentTargetWithTrace } from "../src/server/targets";
import type {
  CmuxSurface,
  CollectedAgent,
  CommandResult,
  CommandRunner,
} from "../src/server/types";

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dir, "fixtures", name), "utf8");

class SequenceRunner implements CommandRunner {
  constructor(private readonly results: CommandResult[]) {}
  async run(): Promise<CommandResult> {
    return this.results.shift() ?? { exitCode: 0, stdout: "", stderr: "", timedOut: false };
  }
}

const SESSION_ID = "019f86c4-1558-7000-aeb8-26e2cfd0e8ec";

const agent: CollectedAgent = {
  id: `omp:${SESSION_ID}`,
  provider: "omp",
  sourceSessionId: SESSION_ID,
  displayName: "Health tester",
  status: "running",
  statusReason: "Fixture activity is recent.",
  updatedAt: "2026-07-23T06:00:00.000Z",
  tokens: { provenance: "unknown" },
  artifacts: [],
  gates: [],
};

function confirmedSurface(surfaceId: string, sessionId = SESSION_ID): CmuxSurface {
  return {
    surfaceId,
    workspaceId: `WORKSPACE-${surfaceId}`,
    paneId: `PANE-${surfaceId}`,
    tty: "ttys033",
    sourceSessionIds: [sessionId],
    identityTrace: {
      surfaceId,
      tty: "ttys033",
      processes: [{ pid: 4242, command: "omp -p", recognizedAgentProcess: true }],
      openFileMatches: [
        { pid: 4242, path: `/Users/me/.omp/agent/sessions/p/run_${sessionId}.jsonl`, provider: "omp", sessionId },
      ],
      commandHints: [],
      outcome: "open-file-match",
      sourceSessionIds: [sessionId],
    },
  };
}

function silentSurface(surfaceId: string): CmuxSurface {
  return {
    surfaceId,
    workspaceId: `WORKSPACE-${surfaceId}`,
    paneId: `PANE-${surfaceId}`,
    tty: "ttys033",
    sourceSessionIds: [],
    identityTrace: {
      surfaceId,
      tty: "ttys033",
      processes: [],
      openFileMatches: [],
      commandHints: [],
      outcome: "no-evidence",
      sourceSessionIds: [],
    },
  };
}

describe("sticky identity binding lifecycle", () => {
  test("a real enrichment scan records an lsof-confirmed binding", async () => {
    const runner = new SequenceRunner([
      { exitCode: 0, stdout: fixture("process-table.txt"), stderr: "", timedOut: false },
      { exitCode: 0, stdout: fixture("open-files.txt"), stderr: "", timedOut: false },
    ]);
    const surface: CmuxSurface = {
      surfaceId: "SURFACE-HEALTH",
      workspaceId: "WORKSPACE-HEALTH",
      paneId: "PANE-HEALTH",
      tty: "ttys033",
      sourceSessionIds: [],
    };
    const store = new MemoryIdentityBindingStore();

    const enriched = await enrichCmuxIdentity([surface], [agent], runner);
    const update = await updateBindingsFromScan(store, enriched.value, "2026-07-23T06:00:00.000Z");

    expect(update.errors).toEqual([]);
    expect(store.get(SESSION_ID)).toEqual({
      sessionId: SESSION_ID,
      provider: "omp",
      target: { surfaceId: "SURFACE-HEALTH", workspaceId: "WORKSPACE-HEALTH", paneId: "PANE-HEALTH" },
      firstConfirmedAt: "2026-07-23T06:00:00.000Z",
      confirmedAt: "2026-07-23T06:00:00.000Z",
      processIds: [4242],
    });
  });

  test("re-confirmation refreshes confirmedAt and clears any pending reassignment", async () => {
    const store = new MemoryIdentityBindingStore();
    await updateBindingsFromScan(store, [confirmedSurface("SURFACE-A")], "2026-07-23T06:00:00.000Z");
    await updateBindingsFromScan(store, [confirmedSurface("SURFACE-B")], "2026-07-23T06:01:00.000Z");
    expect(store.get(SESSION_ID)?.pendingReassignment?.scansAgreed).toBe(1);

    await updateBindingsFromScan(store, [confirmedSurface("SURFACE-A")], "2026-07-23T06:02:00.000Z");

    expect(store.get(SESSION_ID)).toMatchObject({
      target: { surfaceId: "SURFACE-A" },
      firstConfirmedAt: "2026-07-23T06:00:00.000Z",
      confirmedAt: "2026-07-23T06:02:00.000Z",
    });
    expect(store.get(SESSION_ID)?.pendingReassignment).toBeUndefined();
  });

  test("a binding bridges a silent scan into an exact recorded-tier target", async () => {
    const store = new MemoryIdentityBindingStore();
    await updateBindingsFromScan(store, [confirmedSurface("SURFACE-A")], "2026-07-23T06:00:00.000Z");

    // Next scan: the lsof race missed the session file entirely.
    const surfaces = [silentSurface("SURFACE-A")];
    const [bridged] = bridgeAgentsWithBindings(store, [agent], surfaces);
    expect(bridged.recordedTarget).toEqual({
      surfaceId: "SURFACE-A",
      workspaceId: "WORKSPACE-SURFACE-A",
      paneId: "PANE-SURFACE-A",
      reason: BINDING_BRIDGE_REASON,
      source: "binding",
      confirmedAt: "2026-07-23T06:00:00.000Z",
    });

    const { target, trace } = resolveAgentTargetWithTrace(bridged, surfaces);
    expect(target).toMatchObject({
      resolution: "exact",
      surfaceId: "SURFACE-A",
      reason: BINDING_BRIDGE_REASON,
    });
    expect(trace.matchedTier).toBe("recorded");
    expect(trace.bindingBridge).toEqual({
      surfaceId: "SURFACE-A",
      workspaceId: "WORKSPACE-SURFACE-A",
      paneId: "PANE-SURFACE-A",
      confirmedAt: "2026-07-23T06:00:00.000Z",
    });
  });

  test("a recorded PID distinguishes a live process from a disappeared process", async () => {
    const store = new MemoryIdentityBindingStore();
    await store.put({
      sessionId: SESSION_ID,
      provider: "omp",
      target: { surfaceId: "SURFACE-A" },
      firstConfirmedAt: "2026-07-23T06:00:00.000Z",
      confirmedAt: "2026-07-23T06:00:00.000Z",
      processIds: [4242],
    });
    const live = {
      ...silentSurface("SURFACE-A"),
      identityTrace: {
        ...silentSurface("SURFACE-A").identityTrace!,
        processes: [{ pid: 4242, command: "omp -p", recognizedAgentProcess: true }],
      },
    };

    expect(bridgeAgentsWithBindings(store, [agent], [live])[0]).toMatchObject({
      processIds: [4242],
      processAlive: true,
    });
    expect(bridgeAgentsWithBindings(store, [agent], [silentSurface("SURFACE-A")])[0]).toMatchObject({
      processIds: [4242],
      processAlive: false,
    });
    expect(bridgeAgentsWithBindings(store, [agent], [], [4242])[0]).toMatchObject({
      processIds: [4242],
      processAlive: true,
    });
    expect(bridgeAgentsWithBindings(store, [agent], [], [9999])[0]).toMatchObject({
      processIds: [4242],
      processAlive: false,
    });
  });

  /* Measured 2026-08-05: two sessions rode a stored pid that the kernel had
     since handed to `/usr/libexec/siriknowledged` and `sysextd`. The bridge saw
     the number in use and called them live — one for 33 hours. */
  test("a stored PID recycled by a non-agent process is unknown, not alive", async () => {
    const store = new MemoryIdentityBindingStore();
    await store.put({
      sessionId: SESSION_ID,
      provider: "omp",
      target: { surfaceId: "SURFACE-A" },
      firstConfirmedAt: "2026-07-23T06:00:00.000Z",
      confirmedAt: "2026-07-23T06:00:00.000Z",
      processIds: [4242],
    });

    /* Its own copy: `enrichCmuxIdentity` mutates the agents it is handed, and
       the shared fixture above picks up a `processAlive: true` from an earlier
       test in this file. This assertion is about what the bridge concludes, not
       about what leaked into it. */
    const unproven = { ...agent, processAlive: undefined, processIds: undefined };

    /* In use, but by something that is not an agent: the number tells us
       nothing about the session, so the board must not claim it is running. */
    expect(bridgeAgentsWithBindings(store, [unproven], [], [4242], [])[0]).toMatchObject({
      processIds: [4242],
    });
    expect(bridgeAgentsWithBindings(store, [unproven], [], [4242], [])[0]?.processAlive).toBeUndefined();

    // Held by a recognised agent, it is still the proof it always was.
    expect(bridgeAgentsWithBindings(store, [unproven], [], [4242], [4242])[0]).toMatchObject({
      processAlive: true,
    });

    /* And a verdict already reached by start-time verification is not
       overturned by the number merely being in use. */
    const known = { ...unproven, processAlive: false };
    expect(bridgeAgentsWithBindings(store, [known], [], [4242], [4242])[0]).toMatchObject({
      processAlive: false,
    });
  });

  test("live evidence outranks a binding: a linked or reclaimed surface never gets bridged", async () => {
    const store = new MemoryIdentityBindingStore();
    await updateBindingsFromScan(store, [confirmedSurface("SURFACE-A")], "2026-07-23T06:00:00.000Z");

    // The session is exactly linked elsewhere this scan — no bridge.
    const linkedElsewhere = [confirmedSurface("SURFACE-B")];
    expect(bridgeAgentsWithBindings(store, [agent], linkedElsewhere)[0].recordedTarget).toBeUndefined();

    // The bound surface now carries exact evidence for a DIFFERENT session — no bridge.
    const reclaimed = [confirmedSurface("SURFACE-A", "11111111-2222-3333-4444-555555555555")];
    expect(bridgeAgentsWithBindings(store, [agent], reclaimed)[0].recordedTarget).toBeUndefined();

    // Ended sources never gain control through a binding.
    const stale: CollectedAgent = { ...agent, status: "stale" };
    expect(bridgeAgentsWithBindings(store, [stale], [silentSurface("SURFACE-A")])[0].recordedTarget).toBeUndefined();
  });

  test("reassignment demotes the old binding only after 2 consecutive scans agree", async () => {
    const store = new MemoryIdentityBindingStore();
    await updateBindingsFromScan(store, [confirmedSurface("SURFACE-A")], "2026-07-23T06:00:00.000Z");

    await updateBindingsFromScan(store, [confirmedSurface("SURFACE-B")], "2026-07-23T06:01:00.000Z");
    expect(store.get(SESSION_ID)).toMatchObject({
      target: { surfaceId: "SURFACE-A" },
      pendingReassignment: { target: { surfaceId: "SURFACE-B" }, scansAgreed: 1, firstSeenAt: "2026-07-23T06:01:00.000Z" },
    });

    await updateBindingsFromScan(store, [confirmedSurface("SURFACE-B")], "2026-07-23T06:02:00.000Z");
    expect(store.get(SESSION_ID)).toEqual({
      sessionId: SESSION_ID,
      provider: "omp",
      target: { surfaceId: "SURFACE-B", workspaceId: "WORKSPACE-SURFACE-B", paneId: "PANE-SURFACE-B" },
      firstConfirmedAt: "2026-07-23T06:02:00.000Z",
      confirmedAt: "2026-07-23T06:02:00.000Z",
      processIds: [4242],
    });
  });

  test("an identity conflict on the bound surface stays quarantined even with a binding", async () => {
    const store = new MemoryIdentityBindingStore();
    await updateBindingsFromScan(store, [confirmedSurface("SURFACE-A")], "2026-07-23T06:00:00.000Z");

    const conflicted: CmuxSurface = {
      ...silentSurface("SURFACE-A"),
      identityConflict: "cmux SURFACE-A has conflicting open agent session files on ttys033",
    };
    const [bridged] = bridgeAgentsWithBindings(store, [agent], [conflicted]);
    expect(bridged.recordedTarget?.source).toBe("binding");

    const { target, trace } = resolveAgentTargetWithTrace(bridged, [conflicted]);
    expect(target.resolution).toBe("ambiguous");
    expect(target.surfaceId).toBeUndefined();
    expect(target.reason).toContain("quarantined");
    expect(trace.matchedTier).toBeUndefined();
    expect(trace.steps.map(({ tier, outcome }) => `${tier}:${outcome}`)).toEqual([
      "hook-store:skipped",
      "recorded:quarantined",
    ]);
  });

  test("conflicted scans never record or refresh bindings", async () => {
    const store = new MemoryIdentityBindingStore();
    const conflicted: CmuxSurface = {
      ...confirmedSurface("SURFACE-A"),
      sourceSessionIds: [],
      identityConflict: "cmux SURFACE-A has conflicting open agent session files on ttys033",
    };

    await updateBindingsFromScan(store, [conflicted], "2026-07-23T06:00:00.000Z");

    expect(store.list()).toEqual([]);
  });
});

describe("binding wiring through the refresh engine", () => {
  test("a confirmed scan then a silent scan keeps the agent exact via the recorded binding", async () => {
    const { HubState } = await import("../src/server/state");
    const scans = [confirmedSurface("SURFACE-A"), silentSurface("SURFACE-A")];
    let scanNumber = 0;
    const collectors = {
      sessions: async () => ({
        omp: { value: [agent], errors: [] },
        codex: { value: [], errors: [] },
        claude: { value: [], errors: [] },
        cursor: { value: [], errors: [] },
        factory: { value: [], errors: [] },
      }),
      cmux: async () => ({ value: [scans[Math.min(scanNumber, scans.length - 1)]], errors: [] }),
      notifications: async () => ({ value: [], errors: [] }),
      enrichIdentity: async () => {
        const value = [scans[Math.min(scanNumber, scans.length - 1)]];
        scanNumber += 1;
        return { value, errors: [] };
      },
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const store = new MemoryIdentityBindingStore();
    const state = new HubState(
      runner,
      { has: () => false, archive: async () => {} },
      [],
      { collectors, bindingStore: store },
    );

    const first = await state.refresh({ cmux: true });
    const firstAgent = first.programs.flatMap(({ agents }) => agents)[0];
    expect(firstAgent?.target).toMatchObject({ resolution: "exact", surfaceId: "SURFACE-A" });
    expect(firstAgent?.identityTrace?.matchedTier).toBe("session");
    expect(store.get(SESSION_ID)).toBeDefined();

    const second = await state.refresh({ cmux: true });
    const secondAgent = second.programs.flatMap(({ agents }) => agents)[0];
    expect(secondAgent?.target).toMatchObject({
      resolution: "exact",
      surfaceId: "SURFACE-A",
      reason: BINDING_BRIDGE_REASON,
    });
    expect(secondAgent?.identityTrace?.matchedTier).toBe("recorded");
    expect(secondAgent?.identityTrace?.bindingBridge?.surfaceId).toBe("SURFACE-A");
  });
});

describe("durable binding store", () => {
  function virtualFiles(): { files: BindingFileOperations; contents: Map<string, string> } {
    const contents = new Map<string, string>();
    const files: BindingFileOperations = {
      readText: async (path) => {
        const value = contents.get(path);
        if (value === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
        return value;
      },
      makeDirectory: async () => {},
      writeText: async (path, value) => {
        contents.set(path, value);
      },
      rename: async (from, to) => {
        const value = contents.get(from);
        if (value === undefined) throw new Error("missing temporary file");
        contents.set(to, value);
        contents.delete(from);
      },
    };
    return { files, contents };
  }

  function binding(sessionId: string, confirmedAt: string): IdentityBinding {
    return {
      sessionId,
      provider: "omp",
      target: { surfaceId: "SURFACE-A" },
      firstConfirmedAt: confirmedAt,
      confirmedAt,
    };
  }

  test("bindings survive a reopen through the atomic write path", async () => {
    const { files } = virtualFiles();
    const path = "/virtual/identity-bindings.json";
    const now = () => Date.parse("2026-07-23T06:00:00.000Z");
    const store = await JsonIdentityBindingStore.open(path, files, now);

    await store.put(binding(SESSION_ID, "2026-07-23T06:00:00.000Z"));
    const reopened = await JsonIdentityBindingStore.open(path, files, now);

    expect(reopened.get(SESSION_ID)).toEqual(binding(SESSION_ID, "2026-07-23T06:00:00.000Z"));
  });

  test("a session's first disambiguator survives binding rewrites and reopen", async () => {
    const { files } = virtualFiles();
    const path = "/virtual/identity-bindings.json";
    const now = () => Date.parse("2026-07-23T06:00:00.000Z");
    const agentId = `omp:${SESSION_ID}`;
    const store = await JsonIdentityBindingStore.open(path, files, now);

    await store.put(binding(SESSION_ID, "2026-07-23T06:00:00.000Z"));
    await store.rememberNameTags([{ agentId, tag: "cfd0e8ec" }]);
    await store.rememberNameTags([{ agentId, tag: SESSION_ID }]);

    const reopened = await JsonIdentityBindingStore.open(path, files, now);
    expect(reopened.getNameTag(agentId)).toBe("cfd0e8ec");
    await reopened.put(binding("22222222-2222-4222-8222-222222222222", "2026-07-23T06:00:00.000Z"));

    const afterBindingRewrite = await JsonIdentityBindingStore.open(path, files, now);
    expect(afterBindingRewrite.getNameTag(agentId)).toBe("cfd0e8ec");
    expect(afterBindingRewrite.list()).toHaveLength(2);
  });

  test("one scan persists all confirmed bindings with one atomic file write", async () => {
    const { files, contents } = virtualFiles();
    let writeCount = 0;
    const countingFiles: BindingFileOperations = {
      ...files,
      writeText: async (path, value) => {
        writeCount += 1;
        contents.set(path, value);
      },
    };
    const path = "/virtual/identity-bindings.json";
    const store = await JsonIdentityBindingStore.open(
      path,
      countingFiles,
      () => Date.parse("2026-07-23T06:00:00.000Z"),
    );

    await updateBindingsFromScan(store, [
      confirmedSurface("SURFACE-A"),
      confirmedSurface("SURFACE-B", "22222222-2222-4222-8222-222222222222"),
    ], "2026-07-23T06:00:00.000Z");

    expect(writeCount).toBe(1);
    expect(JSON.parse(contents.get(path) ?? "[]")).toHaveLength(2);
  });

  test("bindings older than the TTL are pruned on load and on save", async () => {
    const { files, contents } = virtualFiles();
    const path = "/virtual/identity-bindings.json";
    const nowMs = Date.parse("2026-07-23T06:00:00.000Z");
    const staleAt = new Date(nowMs - IDENTITY_BINDING_TTL_MS - 60_000).toISOString();
    const freshAt = new Date(nowMs - 60_000).toISOString();
    contents.set(path, `${JSON.stringify([binding("stale-session", staleAt), binding(SESSION_ID, freshAt)])}\n`);

    const store = await JsonIdentityBindingStore.open(path, files, () => nowMs);
    expect(store.get("stale-session")).toBeUndefined();
    expect(store.get(SESSION_ID)).toBeDefined();

    // Saving prunes departed sessions out of the persisted file too.
    contents.set(path, `${JSON.stringify([binding("stale-session", staleAt), binding(SESSION_ID, freshAt)])}\n`);
    const reopened = await JsonIdentityBindingStore.open(path, files, () => nowMs);
    await reopened.put(binding("22222222-2222-4222-8222-222222222222", freshAt));
    const persisted = JSON.parse(contents.get(path)!) as IdentityBinding[];
    expect(persisted.map(({ sessionId }) => sessionId).sort()).toEqual([
      SESSION_ID,
      "22222222-2222-4222-8222-222222222222",
    ]);
  });

  /* Load and save were the only two places freshness was checked, so a binding
     could pass its TTL mid-process and keep answering lookups until something
     happened to write. bridgeAgentsWithBindings trusts store.get() as a
     recorded target, so that stale answer routes controls at a cmux surface
     that may since have been recycled. */
  test("a binding that expires while the process runs stops answering lookups", async () => {
    const { files } = virtualFiles();
    const path = "/virtual/identity-bindings.json";
    const confirmedAtMs = Date.parse("2026-07-23T06:00:00.000Z");
    let nowMs = confirmedAtMs;
    const store = await JsonIdentityBindingStore.open(path, files, () => nowMs);

    await store.put(binding(SESSION_ID, new Date(confirmedAtMs).toISOString()));
    expect(store.get(SESSION_ID)).toBeDefined();
    expect(store.list()).toHaveLength(1);

    // Nothing writes in this window; only the clock crosses the TTL.
    nowMs = confirmedAtMs + IDENTITY_BINDING_TTL_MS + 60_000;
    expect(store.get(SESSION_ID)).toBeUndefined();
    expect(store.list()).toEqual([]);
  });

  test("a corrupt binding record fails open() loudly instead of half-loading", async () => {
    const { files, contents } = virtualFiles();
    const path = "/virtual/identity-bindings.json";
    contents.set(path, `${JSON.stringify([{ sessionId: 42 }])}\n`);

    await expect(JsonIdentityBindingStore.open(path, files)).rejects.toThrow(
      "identity bindings file contains an invalid binding record",
    );
  });
});
