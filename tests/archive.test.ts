import { describe, expect, spyOn, test } from "bun:test";
import {
  ARCHIVE_RETENTION_MS,
  JsonArchiveStore,
  MAX_ARCHIVE_RECORDS,
  type ArchiveFileOperations,
} from "../src/server/archive";
import { buildSnapshot } from "../src/server/snapshot";
import type { CollectedAgent } from "../src/server/types";

function missingFile(): NodeJS.ErrnoException {
  return Object.assign(new Error("missing"), { code: "ENOENT" });
}

describe("durable archive state", () => {
  test("records observed sessions as retained history without treating them as operator-archived", async () => {
    const contents = new Map<string, string>();
    const files: ArchiveFileOperations = {
      readText: async (path) => {
        const value = contents.get(path);
        if (value === undefined) throw missingFile();
        return value;
      },
      makeDirectory: async () => {},
      writeText: async (path, value) => { contents.set(path, value); },
      rename: async (from, to) => { contents.set(to, contents.get(from) ?? "[]"); },
    };
    const source: CollectedAgent = {
      id: "codex:observed",
      provider: "codex",
      sourceSessionId: "observed",
      displayName: "Observed session",
      status: "running",
      statusReason: "Source is active.",
      updatedAt: "2026-07-23T20:00:00.000Z",
      tokens: { provenance: "unknown" },
      artifacts: [],
      gates: [],
    };
    const path = "/virtual/archive.json";
    const now = () => Date.parse(source.updatedAt);
    const store = await JsonArchiveStore.open(path, files, now);

    await store.record([source]);
    const reopened = await JsonArchiveStore.open(path, files, now);

    expect(reopened.has(source.id)).toBeFalse();
    expect(reopened.archivedAgents()).toEqual([
      expect.objectContaining({
        id: source.id,
        status: "archived",
        statusReason: "Retained session history.",
      }),
    ]);
  });

  /* A record written before the collector refused transcript plumbing keeps
     printing it: an archived session is never re-collected, so its stored task
     is frozen as it was read. Two of them were still putting
     `<command-name>/model</command-name>` under the drawer's heading, where the
     standing objective goes, after the collector had stopped producing it. */
  test("an archived task that is transcript plumbing does not survive the read", async () => {
    const contents = new Map<string, string>();
    const files: ArchiveFileOperations = {
      readText: async (path) => {
        const value = contents.get(path);
        if (value === undefined) throw missingFile();
        return value;
      },
      makeDirectory: async () => {},
      writeText: async (path, value) => { contents.set(path, value); },
      rename: async (from, to) => { contents.set(to, contents.get(from) ?? "[]"); },
    };
    const source: CollectedAgent = {
      id: "claude:plumbing",
      provider: "claude",
      sourceSessionId: "plumbing",
      displayName: "Claude · Home",
      task: "<command-name>/model</command-name>\n<command-args></command-args>",
      status: "running",
      statusReason: "Source is active.",
      updatedAt: "2026-07-23T20:00:00.000Z",
      tokens: { provenance: "unknown" },
      artifacts: [],
      gates: [],
    };
    const store = await JsonArchiveStore.open("/virtual/archive.json", files, () =>
      Date.parse(source.updatedAt));

    await store.record([source]);

    expect(store.archivedAgents()[0]?.task).toBeUndefined();
  });

  /* An archive we could not read is not an empty archive. Booting on empty is
     right — the hub must start — but it silently returns every dismissed
     session to the board as live work, so the count of what is running is
     wrong and the console was the only place that said why. */
  test("a corrupt archive degrades to empty and reports why, not just to the console", async () => {
    const files: ArchiveFileOperations = {
      readText: async () => "{",
      makeDirectory: async () => {},
      writeText: async () => {},
      rename: async () => {},
    };
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      const store = await JsonArchiveStore.open("/virtual/archive.json", files);

      expect(store.archivedAgents()).toEqual([]);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("could not be read"));
      // The part the console cannot deliver: a value the snapshot can carry.
      expect(store.loadError() ?? "").toContain("/virtual/archive.json");
      expect(store.loadError() ?? "").toContain("unarchived");
    } finally {
      logged.mockRestore();
    }
  });

  test("an archive that was never written is not reported as a failure", async () => {
    // ENOENT is the normal state before anything has been archived.
    const files: ArchiveFileOperations = {
      readText: async () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
      makeDirectory: async () => {},
      writeText: async () => {},
      rename: async () => {},
    };
    const store = await JsonArchiveStore.open("/virtual/absent-archive.json", files);

    expect(store.archivedAgents()).toEqual([]);
    expect(store.loadError()).toBeUndefined();
  });

  test("persists enough source truth to render an archive after the live file leaves the scan window", async () => {
    const contents = new Map<string, string>();
    const files: ArchiveFileOperations = {
      readText: async (path) => {
        const value = contents.get(path);
        if (value === undefined) throw missingFile();
        return value;
      },
      makeDirectory: async () => {},
      writeText: async (path, value) => { contents.set(path, value); },
      rename: async (from, to) => {
        const value = contents.get(from);
        if (value === undefined) throw new Error("missing temporary file");
        contents.set(to, value);
      },
    };
    const source: CollectedAgent = {
      id: "cursor:11111111-2222-4333-8444-555555555555",
      provider: "cursor",
      sourceSessionId: "11111111-2222-4333-8444-555555555555",
      displayName: "Archived Cursor review",
      cwd: "/Users/me/project",
      model: "Cursor Grok 4.5",
      task: "Review the final routing diff.",
      status: "waiting",
      statusReason: "Cursor turn ended.",
      startedAt: "2026-07-21T20:00:00.000Z",
      updatedAt: "2026-07-21T20:05:00.000Z",
      tokens: { provenance: "unknown" },
      cost: null,
      subagentCount: 0,
      lastHumanMessage: "Review the final routing diff.",
      lastHumanFacingAt: "2026-07-21T20:04:00.000Z",
      lastUserMessage: "Please review the final routing diff.",
      lastAgentMessage: "PASS with exact identity evidence.",
      lastAgentClosing: "Everything checks out, but publishing is your call.",
      transcriptTail: "PASS with exact identity evidence.",
      artifacts: [{ label: "Cursor transcript", path: "/Users/me/transcript.jsonl" }],
      gates: ["review passed"],
      allowCwdFallback: false,
    };
    const path = "/virtual/archive.json";
    const now = () => Date.parse("2026-07-23T20:00:00.000Z");
    const store = await JsonArchiveStore.open(path, files, now);

    await store.archive(source.id, source);
    const reopened = await JsonArchiveStore.open(path, files, now);
    const snapshot = buildSnapshot({
      agents: [],
      surfaces: [],
      archiveStore: reopened,
      now: new Date("2026-07-23T20:00:00.000Z"),
    });
    const archived = snapshot.programs.flatMap((program) => program.agents)[0];

    expect(archived).toMatchObject({
      id: source.id,
      status: "archived",
      task: source.task,
      transcriptTail: source.transcriptTail,
      tokens: { provenance: "unknown" },
      cost: null,
      artifacts: source.artifacts,
      gates: source.gates,
      lastUserMessage: source.lastUserMessage,
      lastAgentMessage: source.lastAgentMessage,
      lastHumanFacingAt: source.lastHumanFacingAt,
    });
    /* Measured live after the restart: 133 archived agents carried
       lastAgentMessage but no closing line, because this projection dropped it.
       An archived session that ended by handing a decision back is exactly the
       one still worth acting on, so the history was permanently unreadable to
       the attention layer — reported honestly as "could not read", but
       avoidably so. The round trip has to carry it. */
    expect(archived.lastAgentClosing).toBe(source.lastAgentClosing);
    /* The closing line survives as EVIDENCE a human can read in the drawer, not
       as a signal. An archived row carries no attentionSignal at all now: its
       controls are disabled, so any instruction on it would be one nobody could
       carry out. Round-tripping the words is still worth doing; asking the
       operator to answer them is not. */
    expect(archived.attentionSignal).toBeUndefined();
    expect(archived.nextAction).toBeUndefined();
    expect(reopened.archivedAgents()[0]?.allowCwdFallback).toBeFalse();
    /* Every control that would REACH the session is disabled — there is nothing
       there to reach. The one exception is the new undo, which does not touch a
       terminal at all: it reverses this board's own filing decision, and it is
       the thing the drawer has been telling operators to do since the archive
       shipped without anything behind the sentence. */
    const reachable = archived.controls.filter(({ action }) => action !== "unarchive");
    expect(reachable.every((control) => !control.enabled)).toBeTrue();
    expect(archived.controls.find(({ action }) => action === "unarchive")?.enabled).toBeTrue();
  });

  test("agent archive records older than the retention window are pruned on load", async () => {
    const nowMs = Date.parse("2026-07-23T20:00:00.000Z");
    const fresh: CollectedAgent = {
      id: "codex:fresh",
      provider: "codex",
      sourceSessionId: "fresh",
      displayName: "Fresh archive",
      status: "archived",
      statusReason: "Archived by operator.",
      updatedAt: new Date(nowMs - ARCHIVE_RETENTION_MS + 60_000).toISOString(),
      tokens: { provenance: "unknown" },
      artifacts: [],
      gates: [],
    };
    const stale = {
      ...fresh,
      id: "codex:stale",
      sourceSessionId: "stale",
      updatedAt: new Date(nowMs - ARCHIVE_RETENTION_MS - 60_000).toISOString(),
    };
    const files: ArchiveFileOperations = {
      readText: async () => JSON.stringify([stale, fresh]),
      makeDirectory: async () => {},
      writeText: async () => {},
      rename: async () => {},
    };

    const store = await JsonArchiveStore.open("/virtual/archive.json", files, () => nowMs);

    expect(store.has(stale.id)).toBeFalse();
    expect(store.archivedAgents().map(({ id }) => id)).toEqual([fresh.id]);
  });

  test("persisting a new archive prunes records that expired after load", async () => {
    let nowMs = Date.parse("2026-07-23T20:00:00.000Z");
    const expiring: CollectedAgent = {
      id: "codex:expiring",
      provider: "codex",
      sourceSessionId: "expiring",
      displayName: "Expiring archive",
      status: "archived",
      statusReason: "Archived by operator.",
      updatedAt: new Date(nowMs).toISOString(),
      tokens: { provenance: "unknown" },
      artifacts: [],
      gates: [],
    };
    const contents = new Map([["/virtual/archive.json", JSON.stringify([expiring])]]);
    const files: ArchiveFileOperations = {
      readText: async (path) => contents.get(path) ?? "[]",
      makeDirectory: async () => {},
      writeText: async (path, value) => { contents.set(path, value); },
      rename: async (from, to) => { contents.set(to, contents.get(from) ?? "[]"); },
    };
    const store = await JsonArchiveStore.open("/virtual/archive.json", files, () => nowMs);
    nowMs += ARCHIVE_RETENTION_MS + 60_000;
    const fresh = {
      ...expiring,
      id: "codex:fresh",
      sourceSessionId: "fresh",
      updatedAt: new Date(nowMs).toISOString(),
    };

    await store.archive(fresh.id, fresh);

    expect(store.has(expiring.id)).toBeFalse();
    expect(store.archivedAgents().map(({ id }) => id)).toEqual([fresh.id]);
  });

  test("an unchanged observation pass still enforces the time retention boundary", async () => {
    let nowMs = Date.parse("2026-07-23T20:00:00.000Z");
    const expiring: CollectedAgent = {
      id: "codex:expiring-without-new-work",
      provider: "codex",
      sourceSessionId: "expiring-without-new-work",
      displayName: "Expiring history",
      status: "archived",
      statusReason: "Retained session history.",
      updatedAt: new Date(nowMs).toISOString(),
      tokens: { provenance: "unknown" },
      artifacts: [],
      gates: [],
    };
    const path = "/virtual/archive.json";
    const contents = new Map([[path, JSON.stringify([{ ...expiring, archiveKind: "history" }])]]);
    const files: ArchiveFileOperations = {
      readText: async (target) => contents.get(target) ?? "[]",
      makeDirectory: async () => {},
      writeText: async (target, value) => { contents.set(target, value); },
      rename: async (from, to) => { contents.set(to, contents.get(from) ?? "[]"); },
    };
    const store = await JsonArchiveStore.open(path, files, () => nowMs);
    nowMs += ARCHIVE_RETENTION_MS + 1;

    await store.record([]);

    expect(store.archivedAgents()).toEqual([]);
    expect(JSON.parse(contents.get(path) ?? "[]")).toEqual([]);
  });

  test("a rejected rename never makes the agent appear archived in memory", async () => {
    const files: ArchiveFileOperations = {
      readText: async () => { throw missingFile(); },
      makeDirectory: async () => {},
      writeText: async () => {},
      rename: async () => { throw new Error("disk full during rename"); },
    };
    const store = await JsonArchiveStore.open("/virtual/archive.json", files);

    await expect(store.archive("codex:failed")).rejects.toThrow("disk full during rename");
    expect(store.has("codex:failed")).toBeFalse();
  });

  test("concurrent archive calls serialize without losing either committed ID", async () => {
    const contents = new Map<string, string>();
    const committed: string[] = [];
    const files: ArchiveFileOperations = {
      readText: async () => { throw missingFile(); },
      makeDirectory: async () => {},
      writeText: async (path, value) => {
        await Promise.resolve();
        contents.set(path, value);
      },
      rename: async (from, to) => {
        const value = contents.get(from);
        if (value === undefined) throw new Error("missing temporary file");
        contents.set(to, value);
        committed.push(value);
      },
    };
    const store = await JsonArchiveStore.open("/virtual/archive.json", files);

    await Promise.all([store.archive("omp:first"), store.archive("codex:second")]);

    expect(store.has("omp:first")).toBeTrue();
    expect(store.has("codex:second")).toBeTrue();
    expect(committed).toHaveLength(2);
    expect(JSON.parse(committed.at(-1) ?? "[]")).toEqual(["codex:second", "omp:first"]);
  });

  test("a failed queued write does not poison the next durable archive", async () => {
    let renameCount = 0;
    const contents = new Map<string, string>();
    const files: ArchiveFileOperations = {
      readText: async () => { throw missingFile(); },
      makeDirectory: async () => {},
      writeText: async (path, value) => { contents.set(path, value); },
      rename: async (from, to) => {
        renameCount += 1;
        if (renameCount === 1) throw new Error("transient rename failure");
        contents.set(to, contents.get(from) ?? "");
      },
    };
    const store = await JsonArchiveStore.open("/virtual/archive.json", files);

    await expect(store.archive("omp:failed")).rejects.toThrow();
    await store.archive("omp:committed");

    expect(store.has("omp:failed")).toBeFalse();
    expect(store.has("omp:committed")).toBeTrue();
    expect(JSON.parse(contents.get("/virtual/archive.json") ?? "[]")).toEqual(["omp:committed"]);
  });

  test("retained history is capped at the stated maximum", async () => {
    const contents = new Map<string, string>();
    const path = "/virtual/archive.json";
    const nowMs = Date.parse("2026-07-23T20:00:00.000Z");
    const files: ArchiveFileOperations = {
      readText: async () => { throw missingFile(); },
      makeDirectory: async () => {},
      writeText: async (temporary, value) => { contents.set(temporary, value); },
      rename: async (from, to) => { contents.set(to, contents.get(from) ?? "[]"); },
    };
    const store = await JsonArchiveStore.open(path, files, () => nowMs);
    const agents = Array.from({ length: MAX_ARCHIVE_RECORDS + 1 }, (_, index): CollectedAgent => ({
      id: `codex:${index}`,
      provider: "codex",
      sourceSessionId: String(index),
      displayName: `Session ${index}`,
      status: "running",
      statusReason: "Observed.",
      updatedAt: new Date(nowMs - index).toISOString(),
      tokens: { provenance: "unknown" },
      artifacts: [],
      gates: [],
    }));

    await store.record(agents);

    expect(store.archivedAgents()).toHaveLength(MAX_ARCHIVE_RECORDS);
    expect(JSON.parse(contents.get(path) ?? "[]")).toHaveLength(MAX_ARCHIVE_RECORDS);
    expect(store.archivedAgents().some(({ id }) => id === "codex:0")).toBeTrue();
    expect(store.archivedAgents().some(({ id }) => id === `codex:${MAX_ARCHIVE_RECORDS}`)).toBeFalse();
  });
});

describe("retention and the record cap are operator settings, not constants", () => {
  /* They were `ARCHIVE_RETENTION_MS` and `MAX_ARCHIVE_RECORDS`, compiled in, so
     an operator who wanted a week of history or a smaller file had no way to say
     so. The store now reads both through an injected reader, which also means a
     change takes effect on the NEXT COMMIT rather than at the next restart —
     these tests move the numbers under a live store to prove that. */
  function virtualFiles() {
    const contents = new Map<string, string>();
    const files: ArchiveFileOperations = {
      readText: async (path) => {
        const value = contents.get(path);
        if (value === undefined) throw missingFile();
        return value;
      },
      makeDirectory: async () => {},
      writeText: async (path, value) => { contents.set(path, value); },
      rename: async (from, to) => { contents.set(to, contents.get(from) ?? "[]"); },
    };
    return { contents, files };
  }

  function session(id: string, updatedAt: string): CollectedAgent {
    return {
      id,
      provider: "codex",
      sourceSessionId: id,
      displayName: id,
      status: "running",
      statusReason: "Observed.",
      updatedAt,
      tokens: { provenance: "unknown" },
      artifacts: [],
      gates: [],
    };
  }

  const DAY_MS = 24 * 60 * 60 * 1_000;

  test("a shortened retention window prunes records the default would have kept", async () => {
    const { contents, files } = virtualFiles();
    let nowMs = Date.parse("2026-08-04T00:00:00.000Z");
    let retentionMs = 30 * DAY_MS;
    const store = await JsonArchiveStore.open(
      "/virtual/limits.json",
      files,
      () => nowMs,
      () => ({ retentionMs, recordLimit: MAX_ARCHIVE_RECORDS }),
    );

    await store.record([session("codex:old", new Date(nowMs).toISOString())]);
    nowMs += 10 * DAY_MS;
    await store.record([session("codex:new", new Date(nowMs).toISOString())]);
    expect(store.archivedAgents()).toHaveLength(2);

    // The operator drops retention to a week. Ten days old is now out of range.
    retentionMs = 7 * DAY_MS;
    await store.record([session("codex:newer", new Date(nowMs).toISOString())]);
    expect(store.archivedAgents().map(({ id }) => id).sort()).toEqual(["codex:new", "codex:newer"]);
    expect(JSON.parse(contents.get("/virtual/limits.json") ?? "[]")).toHaveLength(2);
  });

  test("a lowered record cap is enforced on the next commit, keeping the newest", async () => {
    const { files } = virtualFiles();
    const nowMs = Date.parse("2026-08-04T00:00:00.000Z");
    let recordLimit = 5;
    const store = await JsonArchiveStore.open(
      "/virtual/cap.json",
      files,
      () => nowMs,
      () => ({ retentionMs: 30 * DAY_MS, recordLimit }),
    );

    await store.record(
      Array.from({ length: 5 }, (_, index) =>
        session(`codex:${index}`, new Date(nowMs - index * 1_000).toISOString())),
    );
    expect(store.archivedAgents()).toHaveLength(5);

    recordLimit = 2;
    await store.record([session("codex:fresh", new Date(nowMs + 1_000).toISOString())]);
    expect(store.archivedAgents().map(({ id }) => id)).toEqual(["codex:fresh", "codex:0"]);
  });

  test("a store opened without limits keeps the shipped default window, to the millisecond", async () => {
    /* Asserted from custody time, which is what retention actually measures —
       archiving a session that went quiet a month ago is still an archive made
       today, and measuring from its last activity pruned it on the very next
       commit while reporting success. */
    const { files } = virtualFiles();
    let nowMs = Date.parse("2026-08-04T00:00:00.000Z");
    const store = await JsonArchiveStore.open("/virtual/defaults.json", files, () => nowMs);
    await store.record([session("codex:kept", new Date(nowMs).toISOString())]);

    nowMs += ARCHIVE_RETENTION_MS;
    await store.record([session("codex:companion", new Date(nowMs).toISOString())]);
    expect(store.archivedAgents().map(({ id }) => id)).toContain("codex:kept");

    nowMs += 1;
    await store.record([session("codex:trigger", new Date(nowMs).toISOString())]);
    expect(store.archivedAgents().map(({ id }) => id)).not.toContain("codex:kept");
  });
});

describe("a record carries the verdict it was filed with", () => {
  /* archiveCopy is an ALLOW-LIST, and it deliberately drops processAlive and
     processIds — a record out of the scan window has no process to check and
     never will. So a re-entering record cannot be reclassified from what
     survives; without these fields the entire archive would re-derive as "no
     process evidence" and the board would invent an unverified fleet out of its
     own filing cabinet. */
  function virtualFiles() {
    const contents = new Map<string, string>();
    const files: ArchiveFileOperations = {
      readText: async (path) => {
        const value = contents.get(path);
        if (value === undefined) throw missingFile();
        return value;
      },
      makeDirectory: async () => {},
      writeText: async (path, value) => { contents.set(path, value); },
      rename: async (from, to) => { contents.set(to, contents.get(from) ?? "[]"); },
    };
    return { contents, files };
  }

  const source: CollectedAgent = {
    id: "codex:verdict",
    provider: "codex",
    sourceSessionId: "verdict",
    displayName: "Verdict session",
    status: "waiting",
    statusReason: "Turn finished — waiting on you.",
    updatedAt: "2026-08-04T10:00:00.000Z",
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    endEvidence: "turn-complete",
    lifecycle: "waiting",
    provenance: "turn-complete",
    processAlive: true,
    processIds: [4242],
  };

  test("CWD-PROV-1 archive retains launch cwd and strips all launch command material", async () => {
    const { files } = virtualFiles();
    const store = await JsonArchiveStore.open(
      "/virtual/cwd-provenance.json",
      files,
      () => Date.parse("2026-08-04T11:00:00.000Z"),
    );
    const withSentinels = {
      ...source,
      launchCwd: "/repos/launch",
      launchCommand: {
        executablePath: "SENTINEL_EXECUTABLE_MUST_NOT_ARCHIVE",
        arguments: ["SENTINEL_ARGUMENT_MUST_NOT_ARCHIVE"],
        workingDirectory: "/repos/launch",
      },
    } as CollectedAgent;

    await store.record([withSentinels]);
    const stored = store.archivedAgents()[0];

    expect(stored?.launchCwd).toBe("/repos/launch");
    expect(JSON.stringify(stored)).not.toContain("SENTINEL_");
    expect(stored).not.toHaveProperty("launchCommand");
  });

  test("the verdict and the evidence discriminant survive a write and a reload", async () => {
    const { files } = virtualFiles();
    const now = () => Date.parse("2026-08-04T11:00:00.000Z");
    const store = await JsonArchiveStore.open("/virtual/verdict.json", files, now);
    await store.record([source]);

    const reopened = await JsonArchiveStore.open("/virtual/verdict.json", files, now);
    const stored = reopened.archivedAgents()[0]!;
    expect(stored.lifecycle).toBe("waiting");
    expect(stored.provenance).toBe("turn-complete");
    expect(stored.endEvidence).toBe("turn-complete");
  });

  test("the process evidence it was classified from is still stripped, which is why the verdict has to travel", async () => {
    const { files } = virtualFiles();
    const now = () => Date.parse("2026-08-04T11:00:00.000Z");
    const store = await JsonArchiveStore.open("/virtual/stripped.json", files, now);
    await store.record([source]);

    const stored = store.archivedAgents()[0]!;
    expect(stored.processAlive).toBeUndefined();
    expect(stored.processIds).toBeUndefined();
  });

  test("a record written before the contract existed still loads, carrying no verdict", async () => {
    const { contents, files } = virtualFiles();
    const legacy = { ...source };
    delete legacy.lifecycle;
    delete legacy.provenance;
    delete legacy.endEvidence;
    contents.set("/virtual/legacy.json", JSON.stringify([
      { ...legacy, archiveKind: "history", archivedAt: "2026-08-04T10:30:00.000Z" },
    ]));

    const store = await JsonArchiveStore.open(
      "/virtual/legacy.json",
      files,
      () => Date.parse("2026-08-04T11:00:00.000Z"),
    );
    const stored = store.archivedAgents()[0]!;
    expect(stored.id).toBe("codex:verdict");
    expect(stored.lifecycle).toBeUndefined();
    expect(stored.provenance).toBeUndefined();
  });

  test("custody bookkeeping stays off the wire", async () => {
    const { files } = virtualFiles();
    const store = await JsonArchiveStore.open(
      "/virtual/kind.json",
      files,
      () => Date.parse("2026-08-04T11:00:00.000Z"),
    );
    await store.record([source]);
    expect(store.archivedAgents()[0]).not.toHaveProperty("archiveKind");
  });
});

describe("un-archive: the undo the board had been promising", () => {
  /* The drawer has told operators "Un-archive it from History if you filed it
     early" since the archive shipped. There was no store method, no endpoint and
     no button behind that sentence — `#agentIds` only ever grew. */
  function virtualFiles() {
    const contents = new Map<string, string>();
    const files: ArchiveFileOperations = {
      readText: async (path) => {
        const value = contents.get(path);
        if (value === undefined) throw missingFile();
        return value;
      },
      makeDirectory: async () => {},
      writeText: async (path, value) => { contents.set(path, value); },
      rename: async (from, to) => { contents.set(to, contents.get(from) ?? "[]"); },
    };
    return { contents, files };
  }

  const source: CollectedAgent = {
    id: "codex:filed-early",
    provider: "codex",
    sourceSessionId: "filed-early",
    displayName: "Filed early",
    status: "running",
    statusReason: "Still going.",
    updatedAt: "2026-08-04T10:00:00.000Z",
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
  };

  const openStore = (path: string, files: ArchiveFileOperations) =>
    JsonArchiveStore.open(path, files, () => Date.parse("2026-08-04T11:00:00.000Z"));

  test("it demotes the record rather than destroying it", () => {
    /* The load-bearing half. An operator undoing a FILING decision is not asking
       to lose what the session did, and a destructive undo is a worse failure
       than the one it repairs. */
    return (async () => {
      const { files } = virtualFiles();
      const store = await openStore("/virtual/unarchive.json", files);
      await store.archive(source.id, source);
      expect(store.has(source.id)).toBeTrue();

      await store.unarchive(source.id);

      expect(store.has(source.id)).toBeFalse();
      expect(store.archivedAgents().map(({ id }) => id)).toContain(source.id);
    })();
  });

  test("it survives a reload, so the undo is not just in memory", async () => {
    const { files } = virtualFiles();
    const store = await openStore("/virtual/unarchive-persist.json", files);
    await store.archive(source.id, source);
    await store.unarchive(source.id);

    const reopened = await openStore("/virtual/unarchive-persist.json", files);
    expect(reopened.has(source.id)).toBeFalse();
    expect(reopened.archivedAgents().map(({ id }) => id)).toContain(source.id);
  });

  test("it is idempotent, and un-archiving something never archived is not an error", async () => {
    const { contents, files } = virtualFiles();
    const store = await openStore("/virtual/unarchive-idem.json", files);
    await store.archive(source.id, source);
    await store.unarchive(source.id);
    const afterFirst = contents.get("/virtual/unarchive-idem.json");

    await store.unarchive(source.id);
    await store.unarchive("codex:never-existed");

    expect(contents.get("/virtual/unarchive-idem.json")).toBe(afterFirst);
    expect(store.has(source.id)).toBeFalse();
  });

  test("a re-archive after an un-archive works, and keeps the original custody time", async () => {
    /* Retention runs from custody, and an operator changing their mind twice
       must not restart the clock — that is how a record would become immortal. */
    const { files } = virtualFiles();
    const store = await openStore("/virtual/unarchive-recycle.json", files);
    await store.archive(source.id, source);
    const firstCustody = store.archivedAgents()[0]?.archivedAt;

    await store.unarchive(source.id);
    await store.archive(source.id, source);

    expect(store.has(source.id)).toBeTrue();
    expect(store.archivedAgents()[0]?.archivedAt).toBe(firstCustody);
  });
});
