import { beforeAll, describe, expect, test } from "bun:test";
import { parseClaudeJsonl, type ParseMetadata } from "../src/server/collectors";
import { parseCursorSession } from "../src/server/cursor";
import { JsonArchiveStore, type ArchiveFileOperations } from "../src/server/archive";
import { buildSnapshot } from "../src/server/snapshot";
import type { ArchiveStore, CollectedAgent } from "../src/server/types";

/* The wire, not the resolver.

   tests/naming.test.ts proves `resolveAgentName` obeys the contract when it is
   handed evidence. This file proves the evidence it is handed is the RIGHT
   evidence — that the collector reads the first working directory rather than
   the latest, and that uniqueness is settled once against the whole fleet
   instead of per session. Those are the two properties the resolver cannot
   defend on its own, and both were live defects: 805 of 821 sessions shared a
   name on 2026-08-04, and a single session renamed itself four times in four
   minutes because a Claude transcript records cwd per entry. */

const NOW = Date.parse("2026-08-04T12:00:00.000Z");

const meta: ParseMetadata = {
  sourcePath: "/tmp/claude-session.jsonl",
  mtimeMs: NOW,
  nowMs: NOW,
};

/* A session that begins in one lane and wanders. Every row is a real user turn
   with its own cwd, which is exactly how the transcript on disk looks after a
   few `git` and `ls` calls in sibling worktrees. */
const wandering = (cwds: readonly string[]): string =>
  cwds
    .map((cwd, index) =>
      JSON.stringify({
        type: "user",
        sessionId: "wander-1",
        cwd,
        timestamp: new Date(NOW - (cwds.length - index) * 60_000).toISOString(),
        message: { role: "user", content: "go" },
      }),
    )
    .join("\n");

const LANES = [
  "/Users/ant/Developer/the-mountain-main",
  "/Users/ant/Developer/the-mountain-lanes/lifecycle-contract-20260804",
  "/Users/ant/Developer/the-mountain-lanes/naming-contract-20260804",
  "/Users/ant/Developer/the-mountain-main",
];

describe("the collector freezes the name at the session's origin", () => {
  test("a session that wandered through four directories is named for the first", () => {
    const agent = parseClaudeJsonl(wandering(LANES), meta);
    expect(agent?.identity?.name).toBe("Claude · the-mountain-main");
    expect(agent?.identity?.source).toBe("origin-cwd");
  });

  /* The counter-proof. If `originCwd` were ever "simplified" back to `cwd`,
     this session would be named for the lane it happened to be sitting in when
     the parse ran — which is how it came to publish under ANOTHER lane's name.
     Asserting the two fields differ is what makes that regression loud. */
  test("the name ignores the latest directory even though the agent still reports it", () => {
    const agent = parseClaudeJsonl(wandering(LANES.slice(0, 3)), meta);
    expect(agent?.cwd).toBe("/Users/ant/Developer/the-mountain-lanes/naming-contract-20260804");
    expect(agent?.originCwd).toBe("/Users/ant/Developer/the-mountain-main");
    expect(agent?.identity?.name).not.toContain("naming-contract");
  });

  test("re-parsing after the shell moves again returns the same name", () => {
    /* The property that makes this an identity rather than a label: an
       append-only transcript yields the same first row on every parse, so an
       incremental read and a cold read cannot disagree. */
    const early = parseClaudeJsonl(wandering(LANES.slice(0, 2)), meta);
    const later = parseClaudeJsonl(wandering(LANES), meta);
    expect(later?.identity?.name).toBe(early?.identity?.name);
  });

  test("the derived displayName is left exactly as it was", () => {
    /* This slice is additive on purpose. `displayName` is what every surface
       renders today, and it still follows the latest cwd; the client cutover is
       a separate commit with its own rollback boundary. A change here would mean
       the wire moved before the surfaces were ready for it. */
    const agent = parseClaudeJsonl(wandering(LANES.slice(0, 3)), meta);
    expect(agent?.displayName).toBe("Claude · naming-contract-20260804");
    expect(agent?.identity?.name).toBe("Claude · the-mountain-main");
  });
});

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };

function collected(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: "codex:one",
    provider: "codex",
    sourceSessionId: "one",
    displayName: "Codex · lanes",
    cwd: "/Users/ant/Developer/lanes",
    status: "running",
    statusReason: "Fixture activity is recent.",
    startedAt: "2026-08-04T11:00:00.000Z",
    updatedAt: "2026-08-04T11:59:00.000Z",
    tokens: { total: 1, provenance: "observed" },
    artifacts: [],
    gates: [],
    ...overrides,
  };
}

const named = (id: string, sourceSessionId: string, base: string): CollectedAgent =>
  collected({
    id,
    sourceSessionId,
    identity: { name: base, base, source: "origin-cwd" },
  });

describe("uniqueness is settled once, against the whole fleet", () => {
  test("two sessions that resolved to the same name are separated on the wire", () => {
    const snapshot = buildSnapshot({
      agents: [
        named("codex:aaaa-1111", "aaaa-1111", "Codex · lanes"),
        named("codex:bbbb-2222", "bbbb-2222", "Codex · lanes"),
      ],
      surfaces: [],
      archiveStore,
      now: new Date(NOW),
    });

    const names = snapshot.programs
      .flatMap((program) => program.agents)
      .map((agent) => agent.identity?.name);
    expect(new Set(names).size).toBe(2);
    for (const name of names) expect(name).toMatch(/^Codex · lanes #/);
  });

  test("a session nobody shares a name with keeps its name unadorned", () => {
    const snapshot = buildSnapshot({
      agents: [
        named("codex:aaaa-1111", "aaaa-1111", "Codex · lanes"),
        named("codex:bbbb-2222", "bbbb-2222", "Codex · elsewhere"),
      ],
      surfaces: [],
      archiveStore,
      now: new Date(NOW),
    });

    const names = snapshot.programs
      .flatMap((program) => program.agents)
      .map((agent) => agent.identity?.name);
    expect(names).toContain("Codex · lanes");
    expect(names).toContain("Codex · elsewhere");
  });

  /* Uniqueness cannot be decided by a collector, and this is why: the collector
     that produced the first agent never saw the second. If each guessed its own
     tag, a session's name would change every time an unrelated session started
     — which is the same instability, relocated. */
  test("the collector publishes no disambiguator of its own", () => {
    const agent = parseClaudeJsonl(wandering(LANES), meta);
    expect(agent?.identity?.disambiguator).toBeUndefined();
    expect(agent?.identity?.name).toBe(agent?.identity?.base);
  });
});

describe("every provider reaches the contract, not just the ones parsed from JSONL", () => {
  /* Cursor builds its CollectedAgent in cursor.ts rather than through
     `makeAgent`, so it is the provider most likely to be left behind by a change
     made in collectors.ts. An agent without `identity` is silently skipped by
     the fleet-wide pass — it would not throw, it would just never be named. */
  const cursorSession = (sessionId: string, composerName: string) =>
    parseCursorSession({
      sessionId,
      metaJson: JSON.stringify({
        cwd: "/Users/ant/Developer/the-mountain-main",
        createdAt: NOW - 60_000,
        lastUpdatedAt: NOW,
      }),
      store: { name: composerName },
      nowMs: NOW,
    });

  test("a Cursor session resolves an identity like any other", () => {
    /* "New Agent" is Cursor's own placeholder for a composer nobody titled, so
       it must NOT be mistaken for a name a human chose. */
    const agent = cursorSession("11111111-2222-4333-8444-555555555555", "New Agent");

    expect(agent?.identity?.name).toBe("Cursor · the-mountain-main");
    expect(agent?.identity?.source).toBe("origin-cwd");
  });

  test("a Cursor composer the operator titled is treated as authored, not derived", () => {
    const agent = cursorSession("22222222-3333-4444-8555-666666666666", "Routing rewrite");

    expect(agent?.identity?.name).toBe("Routing rewrite");
    expect(agent?.identity?.source).toBe("authored");
    expect(agent?.identity?.authoredBy).toBe("cursor-composer");
  });
});

describe("an archived record keeps the name it had", () => {
  /* `archiveCopy` is an ALLOW-LIST: a field not named there is dropped when a
     session leaves the scan window, and once dropped it cannot be recovered —
     the transcript holding the origin directory may be gone. This is also the
     one case the client mirror exists for, so a record that arrives without an
     identity is precisely the row that has to fall back to re-deriving one. */
  test("identity and origin survive the round trip through the store", async () => {
    const contents = new Map<string, string>();
    const files: ArchiveFileOperations = {
      readText: async (path) => {
        const value = contents.get(path);
        if (value === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
        return value;
      },
      makeDirectory: async () => {},
      writeText: async (path, value) => { contents.set(path, value); },
      rename: async (from, to) => { contents.set(to, contents.get(from)!); },
    };
    const source = collected({
      id: "codex:archived-1",
      sourceSessionId: "archived-1",
      identity: { name: "Lifecycle Mapper", base: "Lifecycle Mapper", source: "authored", authoredBy: "codex-nickname" },
      originCwd: "/Users/ant/Developer/the-mountain-main",
    });

    const now = () => NOW;
    const store = await JsonArchiveStore.open("/virtual/archive.json", files, now);
    await store.archive(source.id, source);
    const reopened = await JsonArchiveStore.open("/virtual/archive.json", files, now);
    const snapshot = buildSnapshot({
      agents: [],
      surfaces: [],
      archiveStore: reopened,
      now: new Date(NOW),
    });

    const archived = snapshot.programs.flatMap((program) => program.agents)[0];
    expect(archived?.identity?.name).toBe("Lifecycle Mapper");
    expect(archived?.identity?.source).toBe("authored");
  });
});

describe("the client renders the name it was given", () => {
  /* The cutover. `sourceAgentName` used to re-derive a name on the client behind
     a heuristic — "trustworthy if it contains · and is under 56 characters" —
     which every DERIVED name passes and an authored one fails. The server now
     answers this question for the whole fleet, so the client's job is to read
     the answer, not to have an opinion about it. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let presentation: any;

  beforeAll(async () => {
    // @ts-expect-error the dependency-free browser client has no declaration file
    presentation = await import("../src/web/presentation.js");
  });

  test("an authored name beats the folder it happened to run in", () => {
    /* The exact live regression: a Codex agent nicknamed "Lifecycle Mapper",
       running in the-mountain-main, displayed as "Claude · the-mountain-main"
       alongside 359 others. */
    expect(presentation.sourceAgentName({
      provider: "codex",
      displayName: "Codex · the-mountain-main",
      identity: { name: "Lifecycle Mapper", base: "Lifecycle Mapper", source: "authored" },
    })).toBe("Lifecycle Mapper");
  });

  test("the server's disambiguator reaches the row intact", () => {
    expect(presentation.sourceAgentName({
      provider: "codex",
      displayName: "Codex · lanes",
      identity: { name: "Codex · lanes #0000aaa1", base: "Codex · lanes", source: "origin-cwd", disambiguator: "0000aaa1" },
    })).toBe("Codex · lanes #0000aaa1");
  });

  test("a record filed before identity existed still gets its old name", () => {
    /* The fallback is not dead code: thirty days of archived records were
       written before this field, and History still has to name them. */
    expect(presentation.sourceAgentName({
      provider: "claude",
      displayName: "Claude · the-mountain-main",
    })).toBe("Claude · the-mountain-main");
  });
});
