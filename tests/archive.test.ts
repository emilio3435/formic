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
    expect(archived.controls.every((control) => !control.enabled)).toBeTrue();
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
