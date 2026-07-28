import { describe, expect, test } from "bun:test";
import {
  ARCHIVE_RETENTION_MS,
  JsonArchiveStore,
  type ArchiveFileOperations,
} from "../src/server/archive";
import { buildSnapshot } from "../src/server/snapshot";
import type { CollectedAgent } from "../src/server/types";

function missingFile(): NodeJS.ErrnoException {
  return Object.assign(new Error("missing"), { code: "ENOENT" });
}

describe("durable archive state", () => {
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
      transcriptTail: "PASS with exact identity evidence.",
      artifacts: [{ label: "Cursor transcript", path: "/Users/me/transcript.jsonl" }],
      gates: ["review passed"],
      allowCwdFallback: false,
    };
    const path = "/virtual/archive.json";
    const store = await JsonArchiveStore.open(path, files);

    await store.archive(source.id, source);
    const reopened = await JsonArchiveStore.open(path, files);
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
});
