import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createMountainFetch, type MountainAppState } from "../src/server/app";
import { collectSessionProvider, type SessionProviderResult } from "../src/server/collectors";
import { transcriptResponse } from "../src/server/debug-identity";
import { readPiSessionFile } from "../src/server/pi";
import { sessionCallsResponse } from "../src/server/session-calls";
import { buildSnapshot } from "../src/server/snapshot";
import type { CollectedAgent, CommandRunner } from "../src/server/types";
import type { Provider } from "../src/shared/types";

const PI = "pi" as Provider;
const FIXTURE_ROOT = join(import.meta.dir, "fixtures/pi");
const V3_FIXTURE = join(FIXTURE_ROOT, "v3-branch-compaction.jsonl");
const SESSION_ID = "pi.native_2026-08-20";
const NOW = Date.parse("2026-08-20T12:01:00.000Z");
const RECORD_CAP = 8 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;
const ENTRY_CAP = 4_096;
const STATE_CAP = 16 * 1024 * 1024;
const SETTINGS_CAP = 64 * 1024;
const PUBLISHED_FIELD_CAP = 6_000;
const FIELD_CLIPPING_WARNING =
  "Pi published text field exceeded 6000 character Formic-local cap and was clipped";
const MALFORMED_USAGE_WARNING =
  "Pi physical usage components were missing, negative, or non-finite; derived session totals and call series were withheld";
const archiveStore = { has: () => false, archive: async () => {} };

type PiOptions = {
  extraPiRoots?: readonly string[];
  piLaunchObservations?: ReadonlyArray<{ launchCwd?: string; cliSessionDir?: string }>;
  piCliSessionDir?: string;
  piLaunchCwd?: string;
  piReadDeadlineMs?: number;
  piReadTestHooks?: {
    afterChunk?: (chunkIndex: number) => void;
    now?: () => number;
    rootError?: (root: string, origin: "cli" | "environment" | "settings" | "imported" | "default") => Error | undefined;
  };
};

const temporaryRoots: string[] = [];
const savedEnvironment = {
  agentDir: process.env.PI_CODING_AGENT_DIR,
  sessionDir: process.env.PI_CODING_AGENT_SESSION_DIR,
};

function tempRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `formic-pi-${label}-`));
  temporaryRoots.push(root);
  return root;
}

function fixture(name: string): string {
  return readFileSync(join(FIXTURE_ROOT, name), "utf8");
}

function jsonl(...rows: Array<Record<string, unknown>>): string {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function header(id = "pi.dynamic", version: unknown = 3, cwd = "/tmp/formic-pi-fixture/dynamic") {
  return { type: "session", version, id, timestamp: "2026-08-20T15:00:00.000Z", cwd };
}

function user(id: string, parentId: string | null, content: string, second = 1) {
  return {
    type: "message",
    id,
    parentId,
    timestamp: `2026-08-20T15:00:${String(second).padStart(2, "0")}.000Z`,
    message: { role: "user", content, timestamp: 1_787_238_000_000 + second * 1_000 },
  };
}

function assistant(
  id: string,
  parentId: string | null,
  content: string,
  second = 2,
  stopReason: "stop" | "error" | "aborted" | "length" | "toolUse" = "stop",
) {
  return {
    type: "message",
    id,
    parentId,
    timestamp: `2026-08-20T15:00:${String(second).padStart(2, "0")}.000Z`,
    message: {
      role: "assistant",
      content: [{ type: "text", text: content }],
      api: "messages",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      usage: {
        input: 2,
        output: 3,
        cacheRead: 5,
        cacheWrite: 1,
        totalTokens: 11,
        cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1, total: 4 },
      },
      stopReason,
      timestamp: 1_787_238_000_000 + second * 1_000,
    },
  };
}

function defaultSessions(home: string): string {
  return join(home, ".pi/agent/sessions");
}

function writeDefaultSession(home: string, name: string, contents: string): string {
  const directory = join(defaultSessions(home), "--tmp-formic-pi-fixture-project--");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  writeFileSync(path, contents);
  return path;
}

function writeDirectSession(root: string, name: string, contents: string): string {
  mkdirSync(root, { recursive: true });
  const path = join(root, name);
  writeFileSync(path, contents);
  return path;
}

function expectedPiInstance(root: string): string {
  const token = basename(root).replace(/^\./, "dot-").toLowerCase().replace(/[^a-z0-9]+/g, "-") || "sessions";
  const digest = createHash("sha256").update(resolve(root)).digest("hex").slice(0, 16);
  return `pi:${token}--${digest}`;
}

async function collectPi(
  home: string,
  options: PiOptions = {},
  signal?: AbortSignal,
): Promise<SessionProviderResult> {
  const collect = collectSessionProvider as unknown as (
    provider: Provider,
    home: string,
    windowMs: number,
    thresholds: undefined,
    options: PiOptions,
    signal?: AbortSignal,
  ) => Promise<SessionProviderResult | undefined>;
  return (await collect(PI, home, Number.POSITIVE_INFINITY, undefined, options, signal)) ?? {
    value: [],
    errors: ["PI_PROVIDER_UNREGISTERED"],
    absent: true,
  };
}

function onlyAgent(result: SessionProviderResult): CollectedAgent | undefined {
  return result.value.length === 1 ? result.value[0] : undefined;
}

function manualSnapshot(agent: CollectedAgent) {
  return buildSnapshot({ agents: [agent], surfaces: [], archiveStore, now: new Date(NOW) });
}

function manualPiAgent(source: string): CollectedAgent {
  return {
    id: `pi:${SESSION_ID}`,
    provider: PI,
    sourceSessionId: SESSION_ID,
    displayName: "Pinned Pi authored title",
    cwd: "/tmp/formic-pi-fixture/project",
    status: "waiting",
    statusReason: "Pi session file is quiet.",
    updatedAt: "2026-08-20T12:00:19.000Z",
    tokens: { provenance: "observed" },
    artifacts: [{ label: "Pi session", path: source, kind: "transcript" }],
    gates: [],
    allowCwdFallback: false,
  };
}

function expectNoEndEvidence(agent: CollectedAgent | undefined, expectedLastAgentMessage: string): void {
  expect({
    lastAgentMessage: agent?.lastAgentMessage,
    transcriptOpen: agent?.transcriptOpen,
    processAlive: agent?.processAlive,
    endEvidence: agent?.endEvidence,
    transcriptEndedCleanly: agent?.transcriptEndedCleanly,
    hookLifecycle: agent?.hookLifecycle,
    hookLifecycleAt: agent?.hookLifecycleAt,
    archivedAt: agent?.archivedAt,
    lifecycle: agent?.lifecycle,
    provenance: agent?.provenance,
    processIds: agent?.processIds,
    processStarts: agent?.processStarts,
  }).toEqual({
    lastAgentMessage: expectedLastAgentMessage,
    transcriptOpen: undefined,
    processAlive: undefined,
    endEvidence: undefined,
    transcriptEndedCleanly: undefined,
    hookLifecycle: undefined,
    hookLifecycleAt: undefined,
    archivedAt: undefined,
    lifecycle: undefined,
    provenance: undefined,
    processIds: undefined,
    processStarts: undefined,
  });

  const published = agent
    ? manualSnapshot(agent).programs.flatMap(({ agents }) => agents).find(({ id }) => id === agent.id)
    : undefined;
  expect(published).toBeDefined();
  expect({
    endEvidence: published?.endEvidence,
    completedCloseAt: published?.completedCloseAt,
    hookLifecycle: published?.hookLifecycle,
    hookLifecycleAt: published?.hookLifecycleAt,
  }).toEqual({
    endEvidence: undefined,
    completedCloseAt: undefined,
    hookLifecycle: undefined,
    hookLifecycleAt: undefined,
  });
  expect(published?.lifecycle).not.toBe("finished");
  expect(published?.status).not.toBe("archived");
  expect(published?.activity).not.toBe("ended");
  expect(published?.processState).not.toBe("died");
}

afterEach(() => {
  if (savedEnvironment.agentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = savedEnvironment.agentDir;
  if (savedEnvironment.sessionDir === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
  else process.env.PI_CODING_AGENT_SESSION_DIR = savedEnvironment.sessionDir;
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Pi pinned v3 field and replay contract through the public collector seam", () => {
  test("the pinned fixture publishes exact identity, naming, cwd, messages, model, thinking, time, and artifact fields", async () => {
    const home = tempRoot("field-matrix");
    const source = writeDefaultSession(home, "2026-08-20T12-00-00_pi.native_2026-08-20.jsonl", fixture("v3-branch-compaction.jsonl"));
    const agent = onlyAgent(await collectPi(home));

    expect(agent).toMatchObject({
      id: `pi:${SESSION_ID}`,
      provider: "pi",
      sourceSessionId: SESSION_ID,
      runtimeSessionId: SESSION_ID,
      displayName: "Pinned Pi authored title",
      identity: {
        name: "Pinned Pi authored title",
        source: "authored",
        authoredBy: "pi-title",
      },
      cwd: "/tmp/formic-pi-fixture/project",
      originCwd: "/tmp/formic-pi-fixture/project",
      model: "claude-opus-4-1",
      effort: "medium",
      task: "Inspect the pinned Pi branch fixture.",
      lastUserMessage: "Continue from the compacted active branch.",
      lastAgentMessage: "The active branch closes with source-backed evidence.",
      lastAgentClosing: "The active branch closes with source-backed evidence.",
      startedAt: "2026-08-20T12:00:00.000Z",
      updatedAt: "2026-08-20T12:00:19.000Z",
      lastUserFacingAt: "2026-08-20T12:00:13.000Z",
      lastHumanFacingAt: "2026-08-20T12:00:14.000Z",
      lastThreadAt: "2026-08-20T12:00:15.000Z",
      artifacts: [{ label: "Pi session", path: source, kind: "transcript" }],
      allowCwdFallback: false,
    });
    expect(agent?.launchCwd).toBeUndefined();
    expect(agent?.lastUserChatBody).toBe("Continue from the compacted active branch.");
    expect(agent?.lastAgentChatBody).toBe("The active branch closes with source-backed evidence.");
    expect(agent?.transcriptTail?.length).toBeLessThanOrEqual(800);
  });

  test("active replay honors firstKeptEntryId and excludes the abandoned fork instead of flattening physical order", async () => {
    const home = tempRoot("active-replay");
    writeDefaultSession(home, "branch.jsonl", fixture("v3-branch-compaction.jsonl"));
    const agent = onlyAgent(await collectPi(home));
    const chat = [agent?.lastUserChatBody, agent?.lastAgentChatBody, agent?.transcriptTail].join("\n");

    expect(chat).toContain("Pinned compacted summary.");
    expect(chat).toContain("The pre-compaction answer is retained only where Pi says it is.");
    expect(chat).toContain("Continue from the compacted active branch.");
    expect(chat).not.toContain("Inspect the pinned Pi branch fixture.");
    expect(chat).not.toContain("This abandoned branch must not become active chat.");
    expect(chat).not.toContain("Inactive branch tool result must not appear in chat replay.");
    expect(agent?.model).toBe("claude-opus-4-1");
    expect(agent?.effort).toBe("medium");
  });

  test.each([
    ["session_info", { type: "session_info", name: "Terminal title" }],
    ["label", { type: "label", targetId: "good-assistant", label: "terminal" }],
    ["custom", { type: "custom", customType: "fixture", data: { terminal: true } }],
    ["shape-valid unknown", { type: "extension_leaf", data: { terminal: true } }],
  ])("terminal %s selects its parent chain without becoming chat", async (_label, leaf) => {
    const home = tempRoot(`terminal-${String(_label).replace(/\s/g, "-")}`);
    const contents = jsonl(
      header(),
      user("root-user", null, "Root prompt."),
      assistant("good-assistant", "root-user", "Good active answer."),
      assistant("bad-branch", "root-user", "Later flat-order branch must lose.", 3),
      { ...leaf, id: "terminal-leaf", parentId: "good-assistant", timestamp: "2026-08-20T15:00:04.000Z" },
    );
    writeDefaultSession(home, "terminal.jsonl", contents);
    const agent = onlyAgent(await collectPi(home));

    expect(agent?.lastAgentMessage).toBe("Good active answer.");
    expect(agent?.transcriptTail).not.toContain("Later flat-order branch must lose.");
    expect(agent?.transcriptTail).not.toContain("terminal-leaf");
  });

  test("duplicate ids use the last physical entry while repeated text at distinct native ids remains distinct", async () => {
    const home = tempRoot("duplicate-ids");
    const contents = jsonl(
      header("pi.duplicate"),
      user("same-id", null, "Old duplicate body."),
      assistant("middle", "same-id", "Repeated content."),
      user("same-id", null, "Replacement duplicate body.", 3),
      assistant("repeat-one", "same-id", "Repeated content.", 4),
      assistant("repeat-two", "repeat-one", "Repeated content.", 5),
    );
    writeDefaultSession(home, "duplicate.jsonl", contents);
    const result = await collectPi(home);
    const agent = onlyAgent(result);

    expect(agent?.task).toBe("Old duplicate body.");
    expect(agent?.lastUserMessage).toBe("Replacement duplicate body.");
    expect(agent?.transcriptTail?.match(/Repeated content\./g)).toHaveLength(2);
    expect(result.errors.join("\n")).toMatch(/Pi.*duplicate.*same-id/i);
  });

  test("an orphan physical leaf is retained and replay stops at its missing parent", async () => {
    const home = tempRoot("orphan-leaf");
    writeDefaultSession(home, "orphan.jsonl", jsonl(
      header("pi.orphan"),
      user("old-root", null, "Disconnected old root."),
      assistant("old-answer", "old-root", "Disconnected old answer."),
      user("orphan-leaf", "missing-parent", "Orphan leaf survives."),
    ));
    const result = await collectPi(home);
    const agent = onlyAgent(result);

    expect(agent?.lastUserMessage).toBe("Orphan leaf survives.");
    expect(agent?.transcriptTail).not.toContain("Disconnected old answer.");
    expect(result.errors).toEqual([]);
  });

  test("a cycle terminates with bounded corruption health instead of looping or inventing replacement ids", async () => {
    const home = tempRoot("cycle");
    writeDefaultSession(home, "cycle.jsonl", jsonl(
      header("pi.cycle"),
      user("cycle-a", "cycle-b", "Cycle A."),
      assistant("cycle-b", "cycle-a", "Cycle B."),
    ));
    const result = await collectPi(home);

    expect(result.errors.join("\n")).toMatch(/Pi.*cycle.*cycle-(?:a|b)/i);
    expect(JSON.stringify(result.value)).not.toContain("generated-");
    expect(JSON.stringify(result)).not.toContain("RangeError");
  });
});

describe("Pi version, migration, title, and no-end boundaries", () => {
  test("versionless v1 migrates linear topology read-only without publishing generated native event ids", async () => {
    const home = tempRoot("v1");
    writeDefaultSession(home, "v1.jsonl", fixture("v1-linear.jsonl"));
    const agent = onlyAgent(await collectPi(home));

    expect(agent).toMatchObject({
      sourceSessionId: "pi-v1-linear",
      task: "Migrate the linear v1 session.",
      lastAgentMessage: "The v1 order remains readable.",
    });
    expect(JSON.stringify(agent)).not.toMatch(/"(?:eventId|messageId)":"[a-f0-9]{8}"/);
  });

  test("v2 hookMessage migrates to custom while its v2 native ids and parent chain remain authoritative", async () => {
    const home = tempRoot("v2");
    writeDefaultSession(home, "v2.jsonl", fixture("v2-hook-message.jsonl"));
    const agent = onlyAgent(await collectPi(home));

    expect(agent).toMatchObject({
      sourceSessionId: "pi-v2.native",
      task: "Migrate the v2 hook message.",
      lastAgentMessage: "The v2 native ids remain stable.",
    });
    expect(agent?.transcriptTail).toContain("Pinned hook context.");
    expect(agent?.transcriptTail).not.toContain("hookMessage");
  });

  test("v3 and a valid non-UUID header id are accepted as the exact resume identity", async () => {
    const home = tempRoot("v3-id");
    writeDefaultSession(home, "v3.jsonl", fixture("v3-branch-compaction.jsonl"));
    const result = await collectPi(home);

    expect(result.errors).toEqual([]);
    expect(result.value.map(({ sourceSessionId }) => sourceSessionId)).toEqual([SESSION_ID]);
    expect(result.value[0]?.id).toBe(`pi:${SESSION_ID}`);
  });

  test.each([
    ["zero", 0],
    ["non-numeric", "3"],
    ["future", 4],
  ])("invalid %s schema version fails closed with version-qualified health", async (_label, version) => {
    const home = tempRoot(`version-${_label}`);
    writeDefaultSession(home, "valid.jsonl", fixture("v3-branch-compaction.jsonl"));
    writeDefaultSession(home, "invalid.jsonl", jsonl(
      header(`pi.version-${_label}`, version),
      user("version-user", null, "Invalid version must not publish."),
    ));
    const result = await collectPi(home);

    expect(result.value.map(({ sourceSessionId }) => sourceSessionId)).toEqual([SESSION_ID]);
    expect(result.errors.join("\n")).toMatch(new RegExp(`Pi.*version.*${String(version)}`, "i"));
    expect(JSON.stringify(result.value)).not.toContain(`pi.version-${_label}`);
  });

  test.each([
    ["leading punctuation", ".pi-leading"],
    ["trailing punctuation", "pi-trailing-"],
  ])("header id with %s is rejected without falling back to the filename", async (_label, invalidId) => {
    const home = tempRoot(`invalid-id-${_label.replace(/\s/g, "-")}`);
    const source = writeDefaultSession(home, "filename-must-not-be-identity.jsonl", jsonl(
      header(invalidId),
      user("invalid-user", null, "Invalid header identity."),
      assistant("invalid-assistant", "invalid-user", "Must not publish."),
    ));
    const result = await collectPi(home);
    const invalidReason = result.errors.find((reason) => /Pi.*header id.*punctuation|Pi.*invalid.*session id/i.test(reason));

    expect(result.value).toEqual([]);
    expect(invalidReason).toMatch(/Pi.*header id.*punctuation|Pi.*invalid.*session id/i);
    expect(invalidReason).toContain(source);
  });

  test("latest physical session_info wins even off branch, and never changes active chat", async () => {
    const home = tempRoot("title-off-branch");
    writeDefaultSession(home, "title.jsonl", jsonl(
      header("pi.title-off-branch"),
      user("first-user", null, "First physical fallback."),
      { type: "session_info", id: "off-title", parentId: "first-user", timestamp: "2026-08-20T15:00:02.000Z", name: "Off-branch authored title" },
      assistant("off-answer", "off-title", "Off branch answer.", 3),
      user("active-user", "first-user", "Active branch prompt.", 4),
      assistant("active-answer", "active-user", "Active branch answer.", 5),
    ));
    const agent = onlyAgent(await collectPi(home));

    expect(agent?.identity).toMatchObject({
      name: "Off-branch authored title",
      source: "authored",
      authoredBy: "pi-title",
    });
    expect(agent?.lastAgentMessage).toBe("Active branch answer.");
    expect(agent?.transcriptTail).not.toContain("Off branch answer.");
  });

  test("a later empty session_info clears authored naming and first physical human fallback remains separate from replay", async () => {
    const home = tempRoot("title-clear");
    writeDefaultSession(home, "title-clear.jsonl", jsonl(
      header("pi.title-clear"),
      user("inactive-first", null, "First physical fallback wins."),
      { type: "session_info", id: "title-set", parentId: "inactive-first", timestamp: "2026-08-20T15:00:02.000Z", name: "Title to clear" },
      { type: "session_info", id: "title-clear", parentId: "title-set", timestamp: "2026-08-20T15:00:03.000Z", name: "" },
      user("active-user", null, "Active replay prompt.", 4),
      assistant("active-answer", "active-user", "Active replay answer.", 5),
    ));
    const agent = onlyAgent(await collectPi(home));

    expect(agent?.identity).toEqual({
      name: "First physical fallback wins.",
      base: "First physical fallback wins.",
      source: "task",
    });
    expect(agent?.task).toBe("First physical fallback wins.");
    expect(agent?.lastUserMessage).toBe("Active replay prompt.");
    expect(agent?.transcriptTail).not.toContain("First physical fallback wins.");
  });

  test.each(["stop", "error", "aborted"] as const)("assistant stopReason=%s never becomes session-end evidence", async (reason) => {
    const home = tempRoot(`no-end-${reason}`);
    writeDefaultSession(home, `${reason}.jsonl`, jsonl(
      header(`pi.no-end-${reason}`),
      user("end-user", null, "No session end."),
      assistant("end-assistant", "end-user", `Assistant ${reason}.`, 2, reason),
    ));
    const agent = onlyAgent(await collectPi(home));

    expectNoEndEvidence(agent, `Assistant ${reason}.`);
  });

  test("terminal compaction never becomes clean completion or process exit", async () => {
    const home = tempRoot("no-end-compaction");
    writeDefaultSession(home, "compaction.jsonl", jsonl(
      header("pi.no-end-compaction"),
      user("compact-user", null, "Compact but stay open."),
      assistant("compact-assistant", "compact-user", "Answer before compaction."),
      { type: "compaction", id: "compact-leaf", parentId: "compact-assistant", timestamp: "2026-08-20T15:00:03.000Z", summary: "Open compacted context.", firstKeptEntryId: "compact-user", tokensBefore: 11 },
    ));
    const agent = onlyAgent(await collectPi(home));

    expect(agent?.transcriptTail).toContain("Open compacted context.");
    expectNoEndEvidence(agent, "Answer before compaction.");
  });

  test("stale file age never becomes source-authored session end", async () => {
    const home = tempRoot("no-end-stale");
    const source = writeDefaultSession(home, "stale.jsonl", jsonl(
      header("pi.no-end-stale"),
      user("stale-user", null, "Old is not ended."),
      assistant("stale-assistant", "stale-user", "Still no session end."),
    ));
    utimesSync(source, new Date("2020-01-01T00:00:00.000Z"), new Date("2020-01-01T00:00:00.000Z"));
    const agent = onlyAgent(await collectPi(home));

    expectNoEndEvidence(agent, "Still no session end.");
  });
});

describe("Pi observed usage and defensive read bounds", () => {
  test("all physical usage events reconcile components to exact calls and session scopes while every USD value is quarantined", async () => {
    const home = tempRoot("usage");
    writeDefaultSession(home, "usage.jsonl", fixture("v3-branch-compaction.jsonl"));
    const agent = onlyAgent(await collectPi(home));

    expect(agent?.callSizes).toEqual([33, 6, 10, 17]);
    expect(agent?.tokens).toEqual({
      sessionTotal: 31,
      sessionCachedInput: 35,
      sessionProcessed: 66,
      scope: "session",
      provenance: "observed",
    });
    expect(agent?.cost).toBeUndefined();
    expect(JSON.stringify(agent)).not.toMatch(/"(?:cost|amount|currency)"/);
  });

  test("call sizes remain debug-only after snapshot serialization and source USD remains absent from dashboard state", async () => {
    const home = tempRoot("snapshot-usage");
    writeDefaultSession(home, "snapshot.jsonl", fixture("v3-branch-compaction.jsonl"));
    const agent = onlyAgent(await collectPi(home));
    const snapshot = agent ? manualSnapshot(agent) : manualSnapshot(manualPiAgent(V3_FIXTURE));
    const published = snapshot.programs.flatMap(({ agents }) => agents)
      .find(({ sourceSessionId }) => sourceSessionId === SESSION_ID);

    expect(agent?.callSizes).toEqual([33, 6, 10, 17]);
    expect(published?.tokens.sessionProcessed).toBe(66);
    expect(published).not.toHaveProperty("callSizes");
    expect(published?.cost).toBeUndefined();
    expect(JSON.stringify(snapshot)).not.toMatch(/"(?:callSizes|cost)"/);
  });

  test("contextPct is calculated only for matching catalog units and unknown raw models remain unfilled", async () => {
    const home = tempRoot("context-units");
    const known = assistant("known-assistant", "known-user", "Known-window answer.");
    known.message.model = "claude-opus-5";
    const unknown = assistant("unknown-assistant", "unknown-user", "Unknown-window answer.");
    unknown.message.model = "private-model-with-no-window";
    writeDefaultSession(home, "known.jsonl", jsonl(
      header("pi.known-window"),
      user("known-user", null, "Known-window prompt."),
      known,
    ));
    writeDefaultSession(home, "unknown.jsonl", jsonl(
      header("pi.unknown-window"),
      user("unknown-user", null, "Unknown-window prompt."),
      unknown,
    ));
    const result = await collectPi(home);
    const byId = new Map(result.value.map((agent) => [agent.sourceSessionId, agent]));

    expect(byId.get("pi.known-window")).toMatchObject({
      model: "claude-opus-5",
      contextPct: 0.0011,
      tokens: { total: 11, contextWindow: 1_000_000, provenance: "observed" },
    });
    expect(byId.get("pi.unknown-window")?.model).toBe("private-model-with-no-window");
    expect(byId.get("pi.unknown-window")?.tokens.total).toBe(11);
    expect(byId.get("pi.unknown-window")?.tokens.contextWindow).toBeUndefined();
    expect(byId.get("pi.unknown-window")?.contextPct).toBeUndefined();
  });

  test("defensive schema input with absent thinking and usage never invents effort, counters, context, totals, or cost", async () => {
    const home = tempRoot("absent-thinking-usage");
    writeDefaultSession(home, "absent.jsonl", fixture("v3-absent-thinking-usage.jsonl"));
    const agent = onlyAgent(await collectPi(home));

    expect(agent?.tokens).toEqual({ scope: "unknown", provenance: "unknown" });
    expect(agent).toMatchObject({
      sourceSessionId: "pi.absent-evidence",
      runtimeSessionId: "pi.absent-evidence",
      model: "private-model-with-no-window",
      task: "Keep absent Pi evidence unavailable.",
      lastUserMessage: "Keep absent Pi evidence unavailable.",
    });
    expect(agent?.effort).toBeUndefined();
    expect(agent?.contextPct).toBeUndefined();
    expect(agent?.cost).toBeUndefined();
    expect(agent?.callSizes).toBeUndefined();
    for (const field of [
      "input",
      "output",
      "cachedInput",
      "total",
      "sessionTotal",
      "sessionCachedInput",
      "sessionProcessed",
      "contextWindow",
    ] as const) {
      expect(agent?.tokens[field]).toBeUndefined();
    }
  });

  test.each([
    ["missing", { input: 2, output: 3, cacheRead: 5 }],
    ["negative", { input: 2, output: -1, cacheRead: 5, cacheWrite: 1 }],
    ["non-number", { input: 2, output: "three", cacheRead: 5, cacheWrite: 1 }],
    ["non-finite", { input: 2, output: "__PI_NON_FINITE__", cacheRead: 5, cacheWrite: 1 }],
  ] as const)(
    "PI-CACHED-1 malformed %s physical usage is sticky while a later valid latest call remains estimated direct evidence",
    async (malformation, malformedUsage) => {
      const home = tempRoot(`cached-usage-${malformation}`);
      const sourceSessionId = `pi.cached-usage-${malformation}`;
      const malformed = assistant("cached-malformed", "cached-user", "Malformed earlier call remains readable.");
      Object.assign(malformed.message, { usage: malformedUsage });
      const contents = jsonl(
        header(sourceSessionId),
        user("cached-user", null, "Keep the malformed-usage conversation."),
        malformed,
        assistant("cached-valid", "cached-malformed", "Valid latest call remains direct evidence.", 3),
      ).replace('"__PI_NON_FINITE__"', "1e309");
      const source = writeDefaultSession(home, `${malformation}.jsonl`, contents);
      const result = await collectPi(home);
      const agent = onlyAgent(result);
      const qualifiedWarning =
        `Pi default session root ${defaultSessions(home)} file ${source}: ${MALFORMED_USAGE_WARNING}`;
      const endpointAgent = {
        ...manualPiAgent(source),
        id: `pi:${sourceSessionId}`,
        sourceSessionId,
      };
      const callsResponse = await sessionCallsResponse(manualSnapshot(endpointAgent), endpointAgent.id, {});
      const callsBody = await callsResponse.json();

      expect({
        rows: result.value.length,
        task: agent?.task,
        closing: agent?.lastAgentClosing,
        tokens: {
          input: agent?.tokens.input,
          output: agent?.tokens.output,
          cachedInput: agent?.tokens.cachedInput,
          total: agent?.tokens.total,
          sessionTotal: agent?.tokens.sessionTotal,
          sessionCachedInput: agent?.tokens.sessionCachedInput,
          sessionProcessed: agent?.tokens.sessionProcessed,
          scope: agent?.tokens.scope,
          provenance: agent?.tokens.provenance,
        },
        callSizes: agent?.callSizes,
        errors: result.errors,
        serializedNull: JSON.stringify(agent?.tokens).includes("null"),
        endpoint: {
          calls: callsBody.calls,
          sessionProcessed: callsBody.sessionProcessed,
          prefixSums: callsBody.prefixSums,
          processedSnapshots: callsBody.processedSnapshots,
          unavailable: callsBody.unavailable,
        },
      }).toEqual({
        rows: 1,
        task: "Keep the malformed-usage conversation.",
        closing: "Valid latest call remains direct evidence.",
        tokens: {
          input: 2,
          output: 3,
          cachedInput: 5,
          total: 11,
          sessionTotal: undefined,
          sessionCachedInput: undefined,
          sessionProcessed: undefined,
          scope: "latest-turn",
          provenance: "estimated",
        },
        callSizes: undefined,
        errors: [qualifiedWarning],
        serializedNull: false,
        endpoint: {
          calls: null,
          sessionProcessed: null,
          prefixSums: null,
          processedSnapshots: null,
          unavailable:
            "Pi call series is unavailable because the bounded transcript is partial or incomplete: "
            + MALFORMED_USAGE_WARNING,
        },
      });
    },
  );

  test("PI-CACHED-1 a newest malformed eligible assistant blocks older occupancy evidence", async () => {
    const home = tempRoot("cached-latest-malformed");
    const older = assistant("cached-older", "cached-latest-user", "Older valid counters are session history.");
    const newest = assistant("cached-newest", "cached-older", "Newest malformed assistant remains the closing.", 3);
    Object.assign(newest.message, {
      usage: { input: 20, output: 4, cacheRead: 3 },
    });
    const source = writeDefaultSession(home, "latest-malformed.jsonl", jsonl(
      header("pi.cached-latest-malformed"),
      user("cached-latest-user", null, "Do not relabel older usage as latest."),
      older,
      newest,
    ));
    const result = await collectPi(home);
    const agent = onlyAgent(result);
    const expectedWarning =
      `Pi default session root ${defaultSessions(home)} file ${source}: `
      + MALFORMED_USAGE_WARNING;

    expect({
      closing: agent?.lastAgentClosing,
      input: agent?.tokens.input,
      output: agent?.tokens.output,
      cachedInput: agent?.tokens.cachedInput,
      total: agent?.tokens.total,
      sessionTotal: agent?.tokens.sessionTotal,
      sessionCachedInput: agent?.tokens.sessionCachedInput,
      sessionProcessed: agent?.tokens.sessionProcessed,
      contextWindow: agent?.tokens.contextWindow,
      contextPct: agent?.contextPct,
      callSizes: agent?.callSizes,
      scope: agent?.tokens.scope,
      provenance: agent?.tokens.provenance,
      errors: result.errors,
    }).toEqual({
      closing: "Newest malformed assistant remains the closing.",
      input: undefined,
      output: undefined,
      cachedInput: undefined,
      total: undefined,
      sessionTotal: undefined,
      sessionCachedInput: undefined,
      sessionProcessed: undefined,
      contextWindow: undefined,
      contextPct: undefined,
      callSizes: undefined,
      scope: "session",
      provenance: "estimated",
      errors: [expectedWarning],
    });
  });

  test.each(["per-call", "session"] as const)(
    "finite %s usage overflow keeps direct evidence but withholds incomplete derived totals",
    async (overflowAt) => {
      const home = tempRoot(`usage-overflow-${overflowAt}`);
      const sourceSessionId = `pi.usage-overflow-${overflowAt}`;
      const first = assistant("overflow-first", "overflow-user", "First overflow answer.");
      first.message.usage.input = Number.MAX_VALUE;
      first.message.usage.output = overflowAt === "per-call" ? Number.MAX_VALUE : 0;
      first.message.usage.cacheRead = overflowAt === "per-call" ? Number.MAX_VALUE : 0;
      first.message.usage.cacheWrite = overflowAt === "per-call" ? Number.MAX_VALUE : 0;
      const rows = [
        header(sourceSessionId),
        user("overflow-user", null, "Keep the usable overflow conversation."),
        first,
      ];
      if (overflowAt === "session") {
        const second = assistant("overflow-second", "overflow-first", "Second finite call overflows the session.", 3);
        second.message.usage.input = Number.MAX_VALUE;
        second.message.usage.output = 0;
        second.message.usage.cacheRead = 0;
        second.message.usage.cacheWrite = 0;
        rows.push(second, assistant("overflow-safe", "overflow-second", "Safe latest call survives session overflow.", 4));
      }
      const source = writeDefaultSession(home, `${overflowAt}.jsonl`, jsonl(...rows));
      const result = await collectPi(home);
      const agent = onlyAgent(result);
      const overflowReasons = result.errors.filter((reason) => /usage.*overflow/i.test(reason));
      const endpointAgent = {
        ...manualPiAgent(source),
        id: `pi:${sourceSessionId}`,
        sourceSessionId,
      };
      const callsResponse = await sessionCallsResponse(
        manualSnapshot(endpointAgent),
        endpointAgent.id,
        {},
      );
      const callsBody = await callsResponse.json();

      expect({
        task: agent?.task,
        closing: agent?.lastAgentClosing,
        input: agent?.tokens.input,
        output: agent?.tokens.output,
        cachedInput: agent?.tokens.cachedInput,
        total: agent?.tokens.total,
        sessionTotal: agent?.tokens.sessionTotal,
        sessionCachedInput: agent?.tokens.sessionCachedInput,
        sessionProcessed: agent?.tokens.sessionProcessed,
        callSizes: agent?.callSizes,
        scope: agent?.tokens.scope,
        provenance: agent?.tokens.provenance,
        qualifiedHealth: overflowReasons.length === 1
          && overflowReasons[0]!.includes(defaultSessions(home))
          && overflowReasons[0]!.includes(source),
        serializedNull: JSON.stringify(agent?.tokens).includes("null"),
        cost: agent?.cost,
        endpoint: {
          calls: callsBody.calls,
          sessionProcessed: callsBody.sessionProcessed,
          prefixSums: callsBody.prefixSums,
          processedSnapshots: callsBody.processedSnapshots,
          unavailable: callsBody.unavailable,
          serializedNullArray: [
            callsBody.calls,
            callsBody.prefixSums,
            callsBody.processedSnapshots,
          ].some((series) => Array.isArray(series) && series.includes(null)),
        },
      }).toEqual({
        task: "Keep the usable overflow conversation.",
        closing: overflowAt === "per-call"
          ? "First overflow answer."
          : "Safe latest call survives session overflow.",
        input: overflowAt === "per-call" ? Number.MAX_VALUE : 2,
        output: overflowAt === "per-call" ? Number.MAX_VALUE : 3,
        cachedInput: overflowAt === "per-call" ? Number.MAX_VALUE : 5,
        total: overflowAt === "per-call" ? undefined : 11,
        sessionTotal: undefined,
        sessionCachedInput: undefined,
        sessionProcessed: undefined,
        callSizes: undefined,
        scope: "latest-turn",
        provenance: "estimated",
        qualifiedHealth: true,
        serializedNull: false,
        cost: undefined,
        endpoint: {
          calls: null,
          sessionProcessed: null,
          prefixSums: null,
          processedSnapshots: null,
          unavailable: "Pi call series is unavailable because the bounded transcript is partial or incomplete: Pi usage aggregate overflowed finite numeric range; derived session totals and call series were withheld",
          serializedNullArray: false,
        },
      });
    },
  );

  test("finite numeric timestamp outside Date range omits only that event time", async () => {
    const home = tempRoot("timestamp-out-of-range");
    const invalidUser = user("out-of-range-user", null, "Keep the session despite the invalid event time.");
    invalidUser.timestamp = 8_640_000_000_000_001 as never;
    invalidUser.message.timestamp = 8_640_000_000_000_001;
    const source = writeDefaultSession(home, "out-of-range.jsonl", jsonl(
      header("pi.timestamp-out-of-range"),
      invalidUser,
      assistant("out-of-range-assistant", "out-of-range-user", "Later valid timestamp survives."),
    ));

    const read = await readPiSessionFile(source);
    const result = await collectPi(home);
    const agent = onlyAgent(result);
    const invalidEvent = read.evidence?.events.find(({ sourceEntryId }) => sourceEntryId === "out-of-range-user");
    const validEvent = read.evidence?.events.find(({ sourceEntryId }) => sourceEntryId === "out-of-range-assistant");

    expect({
      task: agent?.task,
      closing: agent?.lastAgentClosing,
      updatedAt: agent?.updatedAt,
      invalidEventTimestamp: invalidEvent?.timestamp,
      validEventTimestamp: validEvent?.timestamp,
      errors: result.errors,
      genericReadFailure: result.errors.some((reason) => /could not be read/i.test(reason)),
    }).toEqual({
      task: "Keep the session despite the invalid event time.",
      closing: "Later valid timestamp survives.",
      updatedAt: "2026-08-20T15:00:02.000Z",
      invalidEventTimestamp: undefined,
      validEventTimestamp: "2026-08-20T15:00:02.000Z",
      errors: [],
      genericReadFailure: false,
    });
  });

  test("malformed middle and truncated final records retain safe evidence with partial health and no false clean end", async () => {
    const home = tempRoot("malformed-truncated");
    const contents = [
      JSON.stringify(header("pi.damaged")),
      JSON.stringify(user("damage-user", null, "Recover around damage.")),
      "not-json-in-the-middle",
      JSON.stringify(assistant("damage-answer", "damage-user", "Safe answer after malformed record.")),
      "{\"type\":\"message\",\"id\":\"cut",
      "",
    ].join("\n");
    writeDefaultSession(home, "damaged.jsonl", contents);
    const result = await collectPi(home);
    const agent = onlyAgent(result);

    expect(agent?.lastAgentClosing).toBe("Safe answer after malformed record.");
    expect(result.errors.join("\n")).toMatch(/Pi.*malformed.*line 3/i);
    expect(result.errors.join("\n")).toMatch(/Pi.*truncated.*line 5/i);
    expectNoEndEvidence(agent, "Safe answer after malformed record.");
  });

  test("an oversized physical record is skipped while the bounded back tail preserves the later safe marker", async () => {
    const home = tempRoot("record-bound");
    writeDefaultSession(home, "record-bound.jsonl", jsonl(
      header("pi.record-bound"),
      user("record-user", null, "Record bound prompt."),
      assistant("record-huge", "record-user", `front-only ${"x".repeat(RECORD_CAP + 1)} lost-end`),
      assistant("record-safe", "record-user", "Later safe back marker survives.", 3),
    ));
    const result = await collectPi(home);
    const agent = onlyAgent(result);

    expect(agent?.lastAgentClosing).toBe("Later safe back marker survives.");
    expect(agent?.transcriptTail).toContain("Later safe back marker survives.");
    expect(agent?.transcriptTail).not.toContain("front-only");
    expect(result.errors.join("\n")).toContain("Pi JSONL record exceeds 8388608 byte cap and was skipped");
  }, 20_000);

  test("entry-count retention is bounded at 4096 while preserving first-human identity and the newest physical leaf", async () => {
    const home = tempRoot("entry-bound");
    const rows: Array<Record<string, unknown>> = [header("pi.entry-bound")];
    rows.push(user("entry-0", null, "Pinned first-human identity."));
    for (let index = 1; index <= ENTRY_CAP; index += 1) {
      rows.push(user(`entry-${index}`, `entry-${index - 1}`, `entry body ${index}`, (index % 50) + 1));
    }
    rows.push(assistant("entry-back", `entry-${ENTRY_CAP}`, "Newest leaf after count bound.", 59));
    writeDefaultSession(home, "entry-bound.jsonl", jsonl(...rows));
    const result = await collectPi(home);
    const agent = onlyAgent(result);

    expect(agent?.task).toBe("Pinned first-human identity.");
    expect(agent?.lastAgentClosing).toBe("Newest leaf after count bound.");
    expect(agent?.transcriptTail).toContain("Newest leaf after count bound.");
    expect(result.errors.join("\n")).toContain("Pi replay retained only the newest 4096 entries");
  }, 10_000);

  test("retained replay state is byte-bounded at 16 MiB and keeps the newest back marker instead of a front window", async () => {
    const home = tempRoot("state-bound");
    const rows: Array<Record<string, unknown>> = [header("pi.state-bound")];
    rows.push(user("state-first", null, "First identity survives state trimming."));
    let parent = "state-first";
    for (let index = 0; index < 18; index += 1) {
      const id = `state-${index}`;
      rows.push(user(id, parent, `state ${index} ${"z".repeat(1_000_000)}`, index + 2));
      parent = id;
    }
    rows.push(assistant("state-back", parent, "Newest state back marker survives.", 59));
    writeDefaultSession(home, "state-bound.jsonl", jsonl(...rows));
    const result = await collectPi(home);
    const agent = onlyAgent(result);

    expect(agent?.task).toBe("First identity survives state trimming.");
    expect(agent?.lastAgentClosing).toBe("Newest state back marker survives.");
    expect(agent?.transcriptTail).toContain("Newest state back marker survives.");
    expect(result.errors.join("\n")).toContain(`Pi replay retained only newest entries within ${STATE_CAP} byte cap`);
  }, 30_000);
});

describe("Pi roots, layout, persistence absence, and source health", () => {
  test("observed CLI session-dir outranks environment, merged settings, and default", async () => {
    const home = tempRoot("precedence-cli");
    const cli = tempRoot("precedence-cli-root");
    const env = tempRoot("precedence-env-root");
    const settings = tempRoot("precedence-settings-root");
    writeDirectSession(cli, "cli.jsonl", jsonl(header("pi.cli"), user("u-cli", null, "CLI wins."), assistant("a-cli", "u-cli", "CLI answer.")));
    writeDirectSession(env, "env.jsonl", jsonl(header("pi.env"), user("u-env", null, "Env loses."), assistant("a-env", "u-env", "Env answer.")));
    writeDirectSession(settings, "settings.jsonl", jsonl(header("pi.settings"), user("u-settings", null, "Settings loses."), assistant("a-settings", "u-settings", "Settings answer.")));
    writeDefaultSession(home, "default.jsonl", jsonl(header("pi.default"), user("u-default", null, "Default loses."), assistant("a-default", "u-default", "Default answer.")));
    mkdirSync(join(home, ".pi/agent"), { recursive: true });
    writeFileSync(join(home, ".pi/agent/settings.json"), JSON.stringify({ sessionDir: settings }));
    process.env.PI_CODING_AGENT_SESSION_DIR = env;

    const result = await collectPi(home, { piCliSessionDir: cli, piLaunchCwd: "/tmp/formic-pi-fixture/project" });
    expect(result.value.map(({ sourceSessionId }) => sourceSessionId)).toEqual(["pi.cli"]);
    expect(result.errors).toEqual([]);
  });

  test("PI_CODING_AGENT_SESSION_DIR outranks project/global settings and default", async () => {
    const home = tempRoot("precedence-env");
    const env = tempRoot("precedence-env-direct");
    const settings = tempRoot("precedence-env-settings");
    writeDirectSession(env, "env.jsonl", jsonl(header("pi.env-winner"), user("u-env", null, "Env wins."), assistant("a-env", "u-env", "Env answer.")));
    writeDirectSession(settings, "settings.jsonl", jsonl(header("pi.settings-loser"), user("u-settings", null, "Settings loses."), assistant("a-settings", "u-settings", "Settings answer.")));
    mkdirSync(join(home, ".pi/agent"), { recursive: true });
    writeFileSync(join(home, ".pi/agent/settings.json"), JSON.stringify({ sessionDir: settings }));
    process.env.PI_CODING_AGENT_SESSION_DIR = env;

    const result = await collectPi(home, { piLaunchCwd: "/tmp/formic-pi-fixture/project" });
    expect(result.value.map(({ sourceSessionId }) => sourceSessionId)).toEqual(["pi.env-winner"]);
    expect(result.errors).toEqual([]);
  });

  test("project settings override global settings for an explicitly observed launch cwd", async () => {
    const home = tempRoot("precedence-project");
    const launchCwd = tempRoot("precedence-project-cwd");
    const projectRoot = tempRoot("precedence-project-root");
    const globalRoot = tempRoot("precedence-global-root");
    writeDirectSession(projectRoot, "project.jsonl", jsonl(header("pi.project-winner"), user("u-project", null, "Project wins."), assistant("a-project", "u-project", "Project answer.")));
    writeDirectSession(globalRoot, "global.jsonl", jsonl(header("pi.global-loser"), user("u-global", null, "Global loses."), assistant("a-global", "u-global", "Global answer.")));
    mkdirSync(join(home, ".pi/agent"), { recursive: true });
    mkdirSync(join(launchCwd, ".pi"), { recursive: true });
    writeFileSync(join(home, ".pi/agent/settings.json"), JSON.stringify({ sessionDir: globalRoot }));
    writeFileSync(join(launchCwd, ".pi/settings.json"), JSON.stringify({ sessionDir: projectRoot }));

    const result = await collectPi(home, { piLaunchCwd: launchCwd });
    expect(result.value.map(({ sourceSessionId }) => sourceSessionId)).toEqual(["pi.project-winner"]);
    expect(result.errors).toEqual([]);
  });

  for (const settingsSource of ["global", "project"] as const) {
    test(`${settingsSource} oversized Pi settings stay bounded and source-qualified`, async () => {
      const home = tempRoot(`oversized-settings-${settingsSource}-home`);
      const launchCwd = tempRoot(`oversized-settings-${settingsSource}-cwd`);
      const configuredRoot = tempRoot(`oversized-settings-${settingsSource}-root`);
      writeDirectSession(configuredRoot, "oversized.jsonl", jsonl(
        header(`pi.oversized-settings-${settingsSource}`),
        user("oversized-settings-user", null, "Oversized settings must not select this root."),
        assistant("oversized-settings-assistant", "oversized-settings-user", "This row must stay absent."),
      ));
      const settingsFile = settingsSource === "global"
        ? join(home, ".pi/agent/settings.json")
        : join(launchCwd, ".pi/settings.json");
      mkdirSync(dirname(settingsFile), { recursive: true });
      writeFileSync(settingsFile, JSON.stringify({
        sessionDir: configuredRoot,
        padding: "x".repeat(SETTINGS_CAP),
      }));

      const result = await collectPi(home, settingsSource === "project" ? { piLaunchCwd: launchCwd } : {});
      expect(result.value.map(({ sourceSessionId }) => sourceSessionId)).toEqual([]);
      expect(result.errors).toContain(
        `Pi ${settingsSource} settings file ${settingsFile} exceeds ${SETTINGS_CAP} byte cap`,
      );
    });
  }

  test("PI_CODING_AGENT_DIR relocates both global settings and the implicit default sessions root", async () => {
    const home = tempRoot("agent-dir-home");
    const agentDir = tempRoot("agent-dir-effective");
    const configured = tempRoot("agent-dir-configured");
    mkdirSync(agentDir, { recursive: true });
    writeDirectSession(configured, "configured.jsonl", jsonl(header("pi.agent-dir-settings"), user("u-configured", null, "Relocated settings."), assistant("a-configured", "u-configured", "Relocated answer.")));
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ sessionDir: configured }));
    process.env.PI_CODING_AGENT_DIR = agentDir;

    const configuredResult = await collectPi(home);
    expect(configuredResult.value.map(({ sourceSessionId }) => sourceSessionId)).toEqual(["pi.agent-dir-settings"]);

    rmSync(join(agentDir, "settings.json"));
    const defaultProject = join(agentDir, "sessions", "--tmp-formic-pi-fixture-project--");
    writeDirectSession(defaultProject, "default.jsonl", jsonl(header("pi.agent-dir-default"), user("u-default", null, "Relocated default."), assistant("a-default", "u-default", "Default answer.")));
    const defaultResult = await collectPi(home);
    expect(defaultResult.value.map(({ sourceSessionId }) => sourceSessionId)).toEqual(["pi.agent-dir-default"]);
  });

  test("relative PI_CODING_AGENT_DIR requires exact launch-cwd evidence without falling back to Formic or the default home", async () => {
    const home = tempRoot("relative-agent-dir-home");
    const launchCwd = tempRoot("relative-agent-dir-cwd");
    const relativeAgentDir = "relative-pi-agent";
    const observedAgentDir = join(launchCwd, relativeAgentDir);
    writeDefaultSession(home, "fallback-must-not-publish.jsonl", jsonl(
      header("pi.relative-agent-dir-fallback"),
      user("fallback-user", null, "Default-home fallback must stay absent."),
      assistant("fallback-answer", "fallback-user", "Default-home fallback answer."),
    ));
    writeDirectSession(join(observedAgentDir, "sessions", "--tmp-observed-project--"), "observed.jsonl", jsonl(
      header("pi.relative-agent-dir-observed"),
      user("observed-user", null, "Observed launch cwd resolves the relative agent directory."),
      assistant("observed-answer", "observed-user", "Observed relative agent directory answer."),
    ));
    process.env.PI_CODING_AGENT_DIR = relativeAgentDir;

    const unobserved = await collectPi(home);
    expect(unobserved.value).toEqual([]);
    expect(unobserved.errors.join("\n")).toMatch(/Pi.*environment.*relative.*launch cwd.*unavailable/i);

    const observed = await collectPi(home, { piLaunchCwd: launchCwd });
    expect(observed.value.map(({ sourceSessionId }) => sourceSessionId)).toEqual(["pi.relative-agent-dir-observed"]);
  });

  test.each(["session directory", "agent directory"] as const)(
    "PI-CACHED-2 plural launch observations resolve a relative %s without retaining the no-cwd baseline error",
    async (kind) => {
      const home = tempRoot(`cached-plural-${kind.replace(/\s/g, "-")}-home`);
      const launchCwd = tempRoot(`cached-plural-${kind.replace(/\s/g, "-")}-cwd`);
      const relativeRoot = kind === "session directory" ? "relative-sessions" : "relative-agent";
      const sourceSessionId = kind === "session directory"
        ? "pi.cached-plural-session-dir"
        : "pi.cached-plural-agent-dir";
      if (kind === "session directory") {
        process.env.PI_CODING_AGENT_SESSION_DIR = relativeRoot;
        writeDirectSession(join(launchCwd, relativeRoot), "relative.jsonl", jsonl(
          header(sourceSessionId),
          user("plural-session-user", null, "Resolve the plural relative session root."),
          assistant("plural-session-assistant", "plural-session-user", "Plural session root resolved."),
        ));
      } else {
        process.env.PI_CODING_AGENT_DIR = relativeRoot;
        writeDirectSession(join(launchCwd, relativeRoot, "sessions", "--cached-project--"), "relative.jsonl", jsonl(
          header(sourceSessionId),
          user("plural-agent-user", null, "Resolve the plural relative agent directory."),
          assistant("plural-agent-assistant", "plural-agent-user", "Plural agent directory resolved."),
        ));
      }
      const exactUnavailable = kind === "session directory"
        ? "Pi environment relative session root requires observed launch cwd and is unavailable"
        : "Pi environment relative agent directory requires observed launch cwd and is unavailable";

      const unobserved = await collectPi(home, { piLaunchObservations: [] });
      expect(unobserved).toEqual({ value: [], errors: [exactUnavailable] });

      const observed = await collectPi(home, {
        piLaunchObservations: [{ launchCwd }],
      });
      expect({
        sessions: observed.value.map(({ sourceSessionId }) => sourceSessionId),
        errors: observed.errors,
      }).toEqual({ sessions: [sourceSessionId], errors: [] });
    },
  );

  test("PI-CACHED-2 an empty plural observation baseline retains absolute environment, global, and default discovery", async () => {
    const home = tempRoot("cached-plural-baseline-home");
    const environmentRoot = tempRoot("cached-plural-baseline-environment");
    const globalRoot = tempRoot("cached-plural-baseline-global");
    writeDirectSession(environmentRoot, "environment.jsonl", jsonl(
      header("pi.cached-plural-environment"),
      user("plural-environment-user", null, "Keep absolute environment discovery."),
      assistant("plural-environment-assistant", "plural-environment-user", "Absolute environment discovered."),
    ));
    writeDirectSession(globalRoot, "global.jsonl", jsonl(
      header("pi.cached-plural-global"),
      user("plural-global-user", null, "Keep global settings discovery."),
      assistant("plural-global-assistant", "plural-global-user", "Global settings discovered."),
    ));
    writeDefaultSession(home, "default.jsonl", jsonl(
      header("pi.cached-plural-default"),
      user("plural-default-user", null, "Keep default discovery."),
      assistant("plural-default-assistant", "plural-default-user", "Default discovered."),
    ));
    mkdirSync(join(home, ".pi/agent"), { recursive: true });
    writeFileSync(join(home, ".pi/agent/settings.json"), JSON.stringify({ sessionDir: globalRoot }));

    process.env.PI_CODING_AGENT_SESSION_DIR = environmentRoot;
    const environment = await collectPi(home, { piLaunchObservations: [] });
    delete process.env.PI_CODING_AGENT_SESSION_DIR;
    const global = await collectPi(home, { piLaunchObservations: [] });
    rmSync(join(home, ".pi/agent/settings.json"));
    const fallback = await collectPi(home, { piLaunchObservations: [] });

    expect({
      environment: environment.value.map(({ sourceSessionId }) => sourceSessionId),
      global: global.value.map(({ sourceSessionId }) => sourceSessionId),
      fallback: fallback.value.map(({ sourceSessionId }) => sourceSessionId),
      errors: [...environment.errors, ...global.errors, ...fallback.errors],
    }).toEqual({
      environment: ["pi.cached-plural-environment"],
      global: ["pi.cached-plural-global"],
      fallback: ["pi.cached-plural-default"],
      errors: [],
    });
  });

  test("PI-CACHED-2 resolving distinct project-relative settings retains unresolved global-relative health", async () => {
    const home = tempRoot("cached-distinct-relative-settings-home");
    const launchCwd = tempRoot("cached-distinct-relative-settings-cwd");
    mkdirSync(join(home, ".pi/agent"), { recursive: true });
    mkdirSync(join(launchCwd, ".pi"), { recursive: true });
    writeFileSync(
      join(home, ".pi/agent/settings.json"),
      JSON.stringify({ sessionDir: "global-relative" }),
    );
    writeFileSync(
      join(launchCwd, ".pi/settings.json"),
      JSON.stringify({ sessionDir: "project-relative" }),
    );
    writeDirectSession(join(launchCwd, "project-relative"), "project.jsonl", jsonl(
      header("pi.cached-distinct-project-relative"),
      user("distinct-project-user", null, "Resolve only the observed project-relative root."),
      assistant(
        "distinct-project-assistant",
        "distinct-project-user",
        "Project-relative settings resolved without erasing global health.",
      ),
    ));

    const result = await collectPi(home, {
      piLaunchObservations: [{ launchCwd }],
    });

    expect({
      sessions: result.value.map(({ sourceSessionId }) => sourceSessionId),
      errors: result.errors,
      reportsProjectRelativeUnavailable: result.errors.some((error) => error.includes("project-relative")),
    }).toEqual({
      sessions: ["pi.cached-distinct-project-relative"],
      errors: [
        'Pi settings sessionDir "global-relative": relative session root requires observed launch cwd and is unavailable',
      ],
      reportsProjectRelativeUnavailable: false,
    });
  });

  test("header cwd remains source cwd/originCwd while exact observed launch cwd stays a separate overlay", async () => {
    const home = tempRoot("cwd-meaning");
    const launchCwd = tempRoot("launch-cwd-evidence");
    writeDefaultSession(home, "cwd.jsonl", jsonl(
      header("pi.cwd-meaning", 3, "/tmp/formic-pi-fixture/source-cwd"),
      user("cwd-user", null, "Preserve cwd meanings."),
      assistant("cwd-assistant", "cwd-user", "Cwd evidence preserved."),
    ));
    const agent = onlyAgent(await collectPi(home, { piLaunchCwd: launchCwd }));

    expect(agent?.cwd).toBe("/tmp/formic-pi-fixture/source-cwd");
    expect(agent?.originCwd).toBe("/tmp/formic-pi-fixture/source-cwd");
    expect(agent?.launchCwd).toBe(launchCwd);
  });

  test("tilde expands against collector home, while relative direct roots require launch-cwd evidence", async () => {
    const home = tempRoot("relative-home");
    const launchCwd = tempRoot("relative-cwd");
    const tildeRoot = join(home, "pi-tilde-sessions");
    const relativeRoot = join(launchCwd, "relative-sessions");
    writeDirectSession(tildeRoot, "tilde.jsonl", jsonl(header("pi.tilde"), user("u-tilde", null, "Tilde root."), assistant("a-tilde", "u-tilde", "Tilde answer.")));
    writeDirectSession(relativeRoot, "relative.jsonl", jsonl(header("pi.relative"), user("u-relative", null, "Relative root."), assistant("a-relative", "u-relative", "Relative answer.")));

    process.env.PI_CODING_AGENT_SESSION_DIR = "~/pi-tilde-sessions";
    const tilde = await collectPi(home);
    expect(tilde.value.map(({ sourceSessionId }) => sourceSessionId)).toEqual(["pi.tilde"]);

    process.env.PI_CODING_AGENT_SESSION_DIR = "relative-sessions";
    const observed = await collectPi(home, { piLaunchCwd: launchCwd });
    expect(observed.value.map(({ sourceSessionId }) => sourceSessionId)).toEqual(["pi.relative"]);
    const unobserved = await collectPi(home);
    expect(unobserved.value).toEqual([]);
    expect(unobserved.errors.join("\n")).toMatch(/Pi.*relative.*launch cwd.*unavailable/i);
  });

  test("default layout reads one project-directory level and directory symlinks, but rejects root and deeper lookalikes", async () => {
    const home = tempRoot("default-layout");
    const sessions = defaultSessions(home);
    const project = join(sessions, "--tmp-project--");
    const target = tempRoot("default-symlink-target");
    mkdirSync(project, { recursive: true });
    writeFileSync(join(sessions, "root-lookalike.jsonl"), jsonl(header("pi.root-lookalike"), user("u-root", null, "Root negative."), assistant("a-root", "u-root", "Root answer.")));
    writeDirectSession(join(project, "nested"), "deep.jsonl", jsonl(header("pi.deep-lookalike"), user("u-deep", null, "Deep negative."), assistant("a-deep", "u-deep", "Deep answer.")));
    writeDirectSession(project, "project.jsonl", jsonl(header("pi.default-project"), user("u-project", null, "Default project."), assistant("a-project", "u-project", "Project answer.")));
    writeDirectSession(target, "linked.jsonl", jsonl(header("pi.default-symlink"), user("u-link", null, "Linked project."), assistant("a-link", "u-link", "Linked answer.")));
    symlinkSync(target, join(sessions, "--tmp-linked--"), "dir");
    symlinkSync(join(home, "missing-target"), join(sessions, "--tmp-broken--"));
    writeFileSync(join(home, "plain-file"), "not a directory\n");
    symlinkSync(join(home, "plain-file"), join(sessions, "--tmp-file-link--"));

    const result = await collectPi(home);
    expect(result.value.map(({ sourceSessionId }) => sourceSessionId).sort()).toEqual([
      "pi.default-project",
      "pi.default-symlink",
    ]);
    expect(JSON.stringify(result)).not.toMatch(/root-lookalike|deep-lookalike/);
  });

  test("custom and onboarded roots are direct-session directories, deduplicated, and never reinterpreted as agent directories", async () => {
    const home = tempRoot("direct-roots-home");
    const custom = tempRoot("direct-custom");
    const imported = tempRoot("direct-imported");
    writeDirectSession(custom, "custom.jsonl", jsonl(header("pi.custom-direct"), user("u-custom", null, "Custom direct."), assistant("a-custom", "u-custom", "Custom answer.")));
    writeDirectSession(join(custom, "nested"), "nested.jsonl", jsonl(header("pi.custom-nested"), user("u-nested", null, "Nested negative."), assistant("a-nested", "u-nested", "Nested answer.")));
    writeDirectSession(imported, "imported.jsonl", jsonl(header("pi.imported-direct"), user("u-imported", null, "Imported direct."), assistant("a-imported", "u-imported", "Imported answer.")));
    writeDirectSession(join(imported, "sessions"), "reinterpreted.jsonl", jsonl(header("pi.imported-agent-dir"), user("u-agent-dir", null, "Agent dir negative."), assistant("a-agent-dir", "u-agent-dir", "Agent dir answer.")));
    process.env.PI_CODING_AGENT_SESSION_DIR = custom;

    const result = await collectPi(home, { extraPiRoots: [imported, imported] });
    expect(result.value.map(({ sourceSessionId }) => sourceSessionId).sort()).toEqual([
      "pi.custom-direct",
      "pi.imported-direct",
    ]);
    expect(JSON.stringify(result)).not.toMatch(/custom-nested|imported-agent-dir/);
    expect(result.value.find(({ sourceSessionId }) => sourceSessionId === "pi.imported-direct")?.instanceId)
      .toMatch(/^pi:/);
  });

  test("two direct Pi roots with the same basename retain distinct instance identities", async () => {
    const home = tempRoot("same-basename-home");
    const first = join(tempRoot("same-basename-first"), "sessions");
    const second = join(tempRoot("same-basename-second"), "sessions");
    writeDirectSession(first, "first.jsonl", jsonl(
      header("pi.same-basename-first"),
      user("first-user", null, "First same-basename root."),
      assistant("first-assistant", "first-user", "First root persisted after its assistant."),
    ));
    writeDirectSession(second, "second.jsonl", jsonl(
      header("pi.same-basename-second"),
      user("second-user", null, "Second same-basename root."),
      assistant("second-assistant", "second-user", "Second root persisted after its assistant."),
    ));

    const result = await collectPi(home, { extraPiRoots: [first, second] });
    const firstInstance = result.value.find(({ sourceSessionId }) => sourceSessionId === "pi.same-basename-first")?.instanceId;
    const secondInstance = result.value.find(({ sourceSessionId }) => sourceSessionId === "pi.same-basename-second")?.instanceId;
    expect(firstInstance).toMatch(/^pi:/);
    expect(secondInstance).toMatch(/^pi:/);
    expect(firstInstance).not.toBe(secondInstance);
    expect(new Set(result.value.map(({ instanceId }) => instanceId))).toEqual(new Set([firstInstance, secondInstance]));
  });

  test("missing implicit default is absence, while existing empty and configuration-only roots are healthy zero-row evidence", async () => {
    const missingHome = tempRoot("health-missing-default");
    const missing = await collectPi(missingHome);
    expect(missing).toEqual({ value: [], errors: [], absent: true });

    const emptyHome = tempRoot("health-empty-default");
    mkdirSync(defaultSessions(emptyHome), { recursive: true });
    const empty = await collectPi(emptyHome);
    expect(empty).toEqual({ value: [], errors: [] });

    const configuredHome = tempRoot("health-config-only");
    const configuredRoot = tempRoot("health-config-only-root");
    mkdirSync(join(configuredHome, ".pi/agent"), { recursive: true });
    writeFileSync(join(configuredHome, ".pi/agent/settings.json"), JSON.stringify({ sessionDir: configuredRoot }));
    const configured = await collectPi(configuredHome);
    expect(configured).toEqual({ value: [], errors: [] });

  });

  test.each(["custom", "imported"] as const)(
    "existing empty %s direct root is healthy zero-row evidence",
    async (origin) => {
      const home = tempRoot(`health-empty-${origin}-home`);
      const root = tempRoot(`health-empty-${origin}-root`);
      if (origin === "custom") process.env.PI_CODING_AGENT_SESSION_DIR = root;

      const result = await collectPi(home, origin === "imported" ? { extraPiRoots: [root] } : {});
      expect(result).toEqual({ value: [], errors: [] });
    },
  );

  test.each([
    ["CLI", "cli"],
    ["environment", "environment"],
    ["settings", "settings"],
    ["imported instance", "imported"],
  ])("missing advertised %s root is visible provider-qualified health", async (_label, origin) => {
    const home = tempRoot(`health-${origin}`);
    const missing = join(home, `missing-${origin}`);
    let options: PiOptions = {};
    if (origin === "cli") options = { piCliSessionDir: missing };
    if (origin === "environment") process.env.PI_CODING_AGENT_SESSION_DIR = missing;
    if (origin === "settings") {
      mkdirSync(join(home, ".pi/agent"), { recursive: true });
      writeFileSync(join(home, ".pi/agent/settings.json"), JSON.stringify({ sessionDir: missing }));
    }
    if (origin === "imported") options = { extraPiRoots: [missing] };
    const result = await collectPi(home, options);

    expect(result.value).toEqual([]);
    expect(result.absent).toBeUndefined();
    const reasons = result.errors.filter((reason) =>
      reason.includes(missing) && reason.includes("is missing: advertised root does not exist")
    );
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain(`Pi ${origin} session root ${missing}`);
    expect(reasons[0]).toContain(`instance ${expectedPiInstance(missing)}`);
    expect(reasons[0]).toContain("is missing: advertised root does not exist");
  });

  test.each([
    ["CLI", "cli"],
    ["environment", "environment"],
    ["settings", "settings"],
    ["imported instance", "imported"],
  ])("unreadable advertised %s root uses deterministic EACCES health instead of clean emptiness", async (_label, origin) => {
    const home = tempRoot(`health-unreadable-${origin}`);
    const unreadable = tempRoot(`health-unreadable-root-${origin}`);
    writeDirectSession(unreadable, "blocked.jsonl", jsonl(
      header(`pi.unreadable-${origin}`),
      user("blocked-user", null, "Blocked root must not publish."),
      assistant("blocked-assistant", "blocked-user", "Blocked root answer."),
    ));
    const denial = Object.assign(new Error("synthetic Pi root denial"), { code: "EACCES" });
    let options: PiOptions = {
      piReadTestHooks: {
        rootError: (root, candidateOrigin) =>
          root === unreadable && candidateOrigin === origin ? denial : undefined,
      },
    };
    if (origin === "cli") options = { ...options, piCliSessionDir: unreadable };
    if (origin === "environment") process.env.PI_CODING_AGENT_SESSION_DIR = unreadable;
    if (origin === "settings") {
      mkdirSync(join(home, ".pi/agent"), { recursive: true });
      writeFileSync(join(home, ".pi/agent/settings.json"), JSON.stringify({ sessionDir: unreadable }));
    }
    if (origin === "imported") options = { ...options, extraPiRoots: [unreadable] };

    const result = await collectPi(home, options);
    expect(result.value).toEqual([]);
    expect(result.absent).toBeUndefined();
    const reasons = result.errors.filter((reason) =>
      reason.includes(unreadable) && reason.includes("is unreadable: EACCES synthetic Pi root denial")
    );
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain(`Pi ${origin} session root ${unreadable}`);
    expect(reasons[0]).toContain(`instance ${expectedPiInstance(unreadable)}`);
    expect(reasons[0]).toContain("is unreadable: EACCES synthetic Pi root denial");
  });

  test("manual source deletion removes the row on the next scan and Formic never recreates or retains the file", async () => {
    const home = tempRoot("manual-deletion");
    const source = writeDefaultSession(home, "deleted.jsonl", jsonl(
      header("pi.deleted-source"),
      user("delete-user", null, "Delete source manually."),
      assistant("delete-assistant", "delete-user", "Present before deletion."),
    ));
    const before = await collectPi(home);
    expect(before.value.map(({ sourceSessionId }) => sourceSessionId)).toEqual(["pi.deleted-source"]);

    rmSync(source);
    const after = await collectPi(home);
    expect(after.value).toEqual([]);
    expect(after.errors).toEqual([]);
    expect(existsSync(source)).toBeFalse();
  });
});

describe("Pi shared collector, Inspector, and session-call reader boundaries", () => {
  test("PI-CACHED-3 Pi-local published fields clip safe prefixes and suffixes through reader, collection, snapshot, and Inspector", async () => {
    const home = tempRoot("cached-published-field-cap");
    const filler = "x".repeat(2_000_000);
    const oversized = (name: string): string => `${name}-prefix ${filler} ${name}-suffix`;
    const clippingAssistant = assistant(
      "cached-clip-assistant",
      "cached-clip-user",
      oversized("assistant"),
      3,
    );
    clippingAssistant.message.content.push({
      type: "thinking",
      thinking: oversized("thinking"),
    } as never);
    const contents = jsonl(
      header("pi.cached-published-field-cap"),
      {
        type: "session_info",
        id: "cached-clip-title",
        parentId: null,
        timestamp: "2026-08-20T15:00:01.000Z",
        name: oversized("title"),
      },
      user("cached-clip-user", "cached-clip-title", oversized("user"), 2),
      clippingAssistant,
      {
        type: "message",
        id: "cached-clip-tool-result",
        parentId: "cached-clip-assistant",
        timestamp: "2026-08-20T15:00:04.000Z",
        message: {
          role: "toolResult",
          content: [{ type: "text", text: oversized("tool-result") }],
          toolCallId: "cached-clip-call",
          toolName: "read",
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
          timestamp: 1_787_238_004_000,
        },
      },
    );
    expect(Math.max(...contents.trimEnd().split("\n").map((line) => Buffer.byteLength(line))))
      .toBeLessThan(RECORD_CAP);
    const source = writeDefaultSession(home, "published-field-cap.jsonl", contents);

    const read = await readPiSessionFile(source);
    const collected = await collectPi(home);
    const agent = onlyAgent(collected);
    const snapshot = agent ? manualSnapshot(agent) : manualSnapshot(manualPiAgent(source));
    const inspectorResponse = await transcriptResponse(
      snapshot,
      "pi:pi.cached-published-field-cap",
      100,
      {},
    );
    const inspector = await inspectorResponse.json();
    const readTexts = [
      read.evidence?.title,
      read.evidence?.firstUserText,
      read.evidence?.transcriptTail,
      ...(read.evidence?.humanMessages.map(({ content }) => content) ?? []),
      ...(read.evidence?.events.map(({ text }) => text) ?? []),
    ].filter((value): value is string => typeof value === "string");
    const agentTexts = [
      agent?.displayName,
      agent?.task,
      agent?.lastHumanMessage,
      agent?.lastUserMessage,
      agent?.lastAgentMessage,
      agent?.lastAgentClosing,
      agent?.lastUserChatBody,
      agent?.lastAgentChatBody,
      agent?.transcriptTail,
    ].filter((value): value is string => typeof value === "string");
    const inspectorTexts = (inspector.lines as Array<{ text: string }>).map(({ text }) => text);
    const expectedQualifiedWarning =
      `Pi default session root ${defaultSessions(home)} file ${source}: ${FIELD_CLIPPING_WARNING}`;
    const readSerialized = JSON.stringify(read.evidence);
    const agentSerialized = JSON.stringify(agent);
    const snapshotSerialized = JSON.stringify(snapshot);
    const inspectorSerialized = JSON.stringify(inspector);

    expect({
      readPartial: read.partial,
      readWarnings: read.warnings,
      collectedErrors: collected.errors,
      inspectorTruncated: inspector.truncated,
      inspectorWarning: inspector.warning,
      bounded: {
        read: readTexts.every((text) => text.length <= PUBLISHED_FIELD_CAP),
        agent: agentTexts.every((text) => text.length <= PUBLISHED_FIELD_CAP),
        inspector: inspectorTexts.every((text) => text.length <= PUBLISHED_FIELD_CAP),
      },
      safeEvidence: ["title", "user", "assistant", "thinking", "tool-result"].map((name) => ({
        name,
        readPrefix: readSerialized.includes(`${name}-prefix`),
        readSuffix: readSerialized.includes(`${name}-suffix`),
        serializedPrefix: `${agentSerialized}${snapshotSerialized}${inspectorSerialized}`.includes(`${name}-prefix`),
        serializedSuffix: `${agentSerialized}${snapshotSerialized}${inspectorSerialized}`.includes(`${name}-suffix`),
      })),
      fillerAbsent: [readSerialized, agentSerialized, snapshotSerialized, inspectorSerialized]
        .every((serialized) => !serialized.includes(filler)),
    }).toEqual({
      readPartial: true,
      readWarnings: [FIELD_CLIPPING_WARNING],
      collectedErrors: [expectedQualifiedWarning],
      inspectorTruncated: true,
      inspectorWarning: FIELD_CLIPPING_WARNING,
      bounded: { read: true, agent: true, inspector: true },
      safeEvidence: ["title", "user", "assistant", "thinking", "tool-result"].map((name) => ({
        name,
        readPrefix: true,
        readSuffix: true,
        serializedPrefix: true,
        serializedSuffix: true,
      })),
      fillerAbsent: true,
    });
  }, 30_000);

  test("collection, Inspector, and session-calls share oversized/malformed/back-tail semantics", async () => {
    const home = tempRoot("shared-reader");
    const source = writeDefaultSession(home, "shared.jsonl", [
      JSON.stringify(header(SESSION_ID)),
      JSON.stringify(user("shared-user", null, "Shared reader prompt.")),
      "malformed-shared-record",
      JSON.stringify(assistant("shared-huge", "shared-user", `oversized ${"q".repeat(RECORD_CAP + 1)} front-only`)),
      JSON.stringify(assistant("shared-safe", "shared-user", "Shared safe back marker.", 4)),
      "",
    ].join("\n"));
    const collected = await collectPi(home);
    const collectedAgent = onlyAgent(collected);
    expect(collectedAgent?.lastAgentClosing).toBe("Shared safe back marker.");
    expect(collectedAgent?.callSizes).toEqual([11]);
    expect(collected.errors.join("\n")).toMatch(/malformed.*record|record exceeds 8388608/i);

    const snapshot = manualSnapshot(manualPiAgent(source));
    const inspector = await transcriptResponse(snapshot, `pi:${SESSION_ID}`, 100, {});
    const inspectorBody = await inspector.json();
    expect(inspectorBody.lines.at(-1)).toMatchObject({ role: "assistant", text: "Shared safe back marker." });
    expect(inspectorBody.truncated).toBeTrue();
    expect(inspectorBody.warning).toMatch(/malformed.*record|record exceeds 8388608/i);
    expect(JSON.stringify(inspectorBody)).not.toContain("front-only");

    const calls = await sessionCallsResponse(snapshot, `pi:${SESSION_ID}`, {});
    const callsBody = await calls.json();
    expect(callsBody).toMatchObject({
      calls: null,
      sessionProcessed: null,
      prefixSums: null,
      processedSnapshots: null,
      unavailable: expect.stringMatching(/partial or incomplete.*malformed/i),
    });
  }, 25_000);

  test("Inspector emits bounded typed thought and tool events with native ids/names while excluding arguments and USD", async () => {
    const snapshot = manualSnapshot(manualPiAgent(V3_FIXTURE));
    const response = await transcriptResponse(snapshot, `pi:${SESSION_ID}`, 100, {});
    const body = await response.json();

    expect(body.lines).toContainEqual(expect.objectContaining({
      role: "system",
      sourceEntryId: "assistant-active",
      text: expect.stringContaining("Pinned private reasoning summary."),
    }));
    expect(body.lines).toContainEqual(expect.objectContaining({
      role: "tool",
      sourceEntryId: "tool-active",
      toolCallId: "call-active",
      toolName: "read",
      text: expect.stringMatching(/read.*call-active.*README evidence/s),
    }));
    expect(body.lines).toContainEqual(expect.objectContaining({
      role: "assistant",
      text: "The active branch closes with source-backed evidence.",
    }));
    expect(JSON.stringify(body)).not.toMatch(/arguments|cost|0\.1|README\.md/);
  });

  test("session-calls re-derives exact component sizes and prefix sums without exposing source USD", async () => {
    const snapshot = manualSnapshot(manualPiAgent(V3_FIXTURE));
    const response = await sessionCallsResponse(snapshot, `pi:${SESSION_ID}`, {});
    const body = await response.json();

    expect(body).toMatchObject({
      ok: true,
      provider: "pi",
      calls: [33, 6, 10, 17],
      sessionProcessed: 66,
      prefixSums: [33, 39, 49, 66],
    });
    expect(body.unavailable).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/cost|USD|amount/);
  });

  test("already-aborted caller signal is rethrown by collection with the exact reason and no health envelope", async () => {
    const home = tempRoot("abort-collection");
    writeDefaultSession(home, "abort.jsonl", fixture("v3-branch-compaction.jsonl"));
    const controller = new AbortController();
    const reason = new Error("pi collection caller abort sentinel");
    controller.abort(reason);

    await expect(collectPi(home, {}, controller.signal)).rejects.toBe(reason);
  });

  test("first-chunk injected caller abort is rethrown unchanged instead of becoming partial Pi source health", async () => {
    const home = tempRoot("abort-mid-read");
    writeDefaultSession(home, "abort.jsonl", `${fixture("v3-branch-compaction.jsonl")}${" ".repeat(2_000_000)}\n`);
    const controller = new AbortController();
    const reason = new Error("pi mid-read abort sentinel");
    const chunks: number[] = [];
    let thrown: unknown;
    try {
      await collectPi(home, {
        piReadTestHooks: {
          afterChunk: (chunkIndex) => {
            chunks.push(chunkIndex);
            if (chunkIndex === 1) controller.abort(reason);
          },
        },
      }, controller.signal);
    } catch (error) {
      thrown = error;
    }

    expect({ thrown, chunks, signalReason: controller.signal.reason }).toEqual({
      thrown: reason,
      chunks: [1],
      signalReason: reason,
    });
  });

  test("Inspector caller abort is rethrown with the exact reason through the shared reader", async () => {
    const controller = new AbortController();
    const reason = new Error("pi Inspector abort sentinel");
    controller.abort(reason);
    const call = transcriptResponse as unknown as (
      snapshot: ReturnType<typeof manualSnapshot>, agentId: string, limit: number,
      headers: Record<string, string>, signal: AbortSignal,
    ) => Promise<Response>;

    await expect(call(manualSnapshot(manualPiAgent(V3_FIXTURE)), `pi:${SESSION_ID}`, 100, {}, controller.signal))
      .rejects.toBe(reason);
  });

  test.each([
    ["Inspector", "/api/transcript"],
    ["session-calls", "/api/debug/session-calls"],
  ])("HTTP %s route rethrows the exact caller abort reason through the shared Pi reader", async (_label, pathname) => {
    const snapshot = manualSnapshot(manualPiAgent(V3_FIXTURE));
    const state: MountainAppState = {
      get: () => snapshot,
      subscribe: () => () => {},
      refresh: async () => snapshot,
      surfaces: () => [],
    };
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
    };
    const fetch = createMountainFetch({ state, runner, archiveStore, webRoot: import.meta.dir });
    const controller = new AbortController();
    const reason = new Error(`Pi ${_label} HTTP abort sentinel`);
    controller.abort(reason);

    try {
      await expect(fetch(new Request(
        `http://127.0.0.1:4701${pathname}?agent=${encodeURIComponent(`pi:${SESSION_ID}`)}`,
        { signal: controller.signal },
      ))).rejects.toBe(reason);
    } finally {
      fetch.dispose();
    }
  });

  test("session-calls caller abort is rethrown with the exact reason through the shared reader", async () => {
    const controller = new AbortController();
    const reason = new Error("pi session-calls abort sentinel");
    controller.abort(reason);
    const call = sessionCallsResponse as unknown as (
      snapshot: ReturnType<typeof manualSnapshot>, agentId: string,
      headers: Record<string, string>, signal: AbortSignal,
    ) => Promise<Response>;

    await expect(call(manualSnapshot(manualPiAgent(V3_FIXTURE)), `pi:${SESSION_ID}`, {}, controller.signal))
      .rejects.toBe(reason);
  });

  test("collector-owned deadline returns promptly as Pi root-qualified health without aborting the caller signal", async () => {
    const home = tempRoot("owned-deadline");
    const directRoot = join(home, "deadline-direct");
    const source = writeDirectSession(directRoot, "deadline.jsonl", fixture("v3-branch-compaction.jsonl"));
    const controller = new AbortController();
    let nowMs = 1_000;
    const chunks: number[] = [];
    const started = performance.now();
    const result = await collectPi(home, {
      piCliSessionDir: directRoot,
      piLaunchCwd: "/tmp",
      piReadDeadlineMs: 25,
      piReadTestHooks: {
        now: () => nowMs,
        afterChunk: (chunkIndex) => {
          chunks.push(chunkIndex);
          nowMs += 26;
        },
      },
    }, controller.signal);

    expect(performance.now() - started).toBeLessThan(1_000);
    expect(controller.signal.aborted).toBeFalse();
    expect(result.value).toEqual([]);
    expect(chunks).toEqual([1]);
    const deadlineReasons = result.errors.filter((reason) => /deadline/i.test(reason));
    const deadlineReason = deadlineReasons[0];
    expect({
      count: deadlineReasons.length,
      root: deadlineReason?.includes(directRoot),
      instance: deadlineReason?.includes(`instance ${expectedPiInstance(directRoot)}`),
      file: deadlineReason?.includes(source),
      deadline: /read deadline/i.test(deadlineReason ?? ""),
      detail: deadlineReason?.includes("25ms"),
    }).toEqual({ count: 1, root: true, instance: true, file: true, deadline: true, detail: true });
  });
});

describe("Pi source-owner repair regressions", () => {
  test("PI-REPAIR-3A compacted replay emits summary before retained and post-compaction rows", async () => {
    const home = tempRoot("repair-replay-order");
    writeDefaultSession(home, "replay-order.jsonl", jsonl(
      header("pi.repair-replay-order"),
      user("old-user", null, "Old context is summarized."),
      assistant("retained-assistant", "old-user", "Retained pre-compaction row."),
      {
        type: "compaction",
        id: "repair-compaction",
        parentId: "retained-assistant",
        timestamp: "2026-08-20T15:00:03.000Z",
        summary: "Repair compacted summary.",
        firstKeptEntryId: "retained-assistant",
        tokensBefore: 10,
      },
      user("post-user", "repair-compaction", "Post-compaction row.", 4),
      assistant("post-assistant", "post-user", "Post-compaction answer.", 5),
    ));
    const tail = onlyAgent(await collectPi(home))?.transcriptTail ?? "";
    const summary = tail.indexOf("Repair compacted summary.");
    const retained = tail.indexOf("Retained pre-compaction row.");
    const post = tail.indexOf("Post-compaction row.");

    expect({ summaryPresent: summary >= 0, retainedPresent: retained >= 0, postPresent: post >= 0, ordered: summary < retained && retained < post })
      .toEqual({ summaryPresent: true, retainedPresent: true, postPresent: true, ordered: true });
  });

  test("PI-REPAIR-3B model and thinking state derive from the full active parent path", async () => {
    const home = tempRoot("repair-active-state");
    writeDefaultSession(home, "active-state.jsonl", jsonl(
      header("pi.repair-active-state"),
      { type: "model_change", id: "model-before", parentId: null, timestamp: "2026-08-20T15:00:01.000Z", provider: "anthropic", modelId: "claude-opus-5" },
      { type: "thinking_level_change", id: "thinking-before", parentId: "model-before", timestamp: "2026-08-20T15:00:02.000Z", thinkingLevel: "high" },
      user("kept-user", "thinking-before", "Retained prompt.", 3),
      { type: "compaction", id: "state-compaction", parentId: "kept-user", timestamp: "2026-08-20T15:00:04.000Z", summary: "State summary.", firstKeptEntryId: "kept-user", tokensBefore: 5 },
      {
        type: "message",
        id: "state-answer",
        parentId: "state-compaction",
        timestamp: "2026-08-20T15:00:05.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "State survives compaction." }],
          usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5 },
          stopReason: "stop",
          timestamp: 1_787_238_005_000,
        },
      },
    ));
    const agent = onlyAgent(await collectPi(home));

    expect({ model: agent?.model, effort: agent?.effort }).toEqual({ model: "claude-opus-5", effort: "high" });
  });

  test.each([
    ["header-inclusive index one retains the first message", 1, true],
    ["index zero never aliases the first message", 0, false],
  ] as const)("PI-REPAIR-4A v1 %s", async (_label, firstKeptEntryIndex, retainsFirst) => {
    const home = tempRoot(`repair-v1-index-${firstKeptEntryIndex}`);
    writeDefaultSession(home, "v1-compaction.jsonl", jsonl(
      {
        type: "session",
        id: `pi.repair-v1-${firstKeptEntryIndex}`,
        timestamp: "2026-08-20T15:00:00.000Z",
        cwd: "/tmp/formic-pi-fixture/dynamic",
      },
      user("legacy-user", null, "Legacy first message."),
      {
        type: "compaction",
        summary: "Legacy summary.",
        firstKeptEntryIndex,
        tokensBefore: 5,
        timestamp: "2026-08-20T15:00:02.000Z",
      },
      assistant("legacy-answer", null, "Legacy post-compaction answer.", 3),
    ));
    const tail = onlyAgent(await collectPi(home))?.transcriptTail ?? "";

    expect({
      summaryBeforePost: tail.indexOf("Legacy summary.") < tail.indexOf("Legacy post-compaction answer."),
      retainsFirst: tail.includes("Legacy first message."),
    }).toEqual({ summaryBeforePost: true, retainsFirst });
  });

  test("PI-REPAIR-4B Inspector never publishes generated v1 topology ids as sourceEntryId", async () => {
    const home = tempRoot("repair-v1-inspector");
    const source = writeDefaultSession(home, "v1.jsonl", fixture("v1-linear.jsonl"));
    const response = await transcriptResponse(
      manualSnapshot({ ...manualPiAgent(source), id: "pi:pi-v1-linear", sourceSessionId: "pi-v1-linear" }),
      "pi:pi-v1-linear",
      100,
      {},
    );
    const body = await response.json();

    expect(body.lines.length).toBeGreaterThan(0);
    expect(body.lines.every((line: Record<string, unknown>) => line.sourceEntryId === undefined)).toBeTrue();
  });

  test("PI-REPAIR-5A streaming UTF-8 decoder preserves a three-byte code point split at the exact chunk boundary", async () => {
    const home = tempRoot("repair-utf8-boundary");
    const headerLine = `${JSON.stringify(header("pi.repair-utf8"))}\n`;
    const rowPrefix = '{"type":"message","id":"utf-user","parentId":null,"timestamp":"2026-08-20T15:00:01.000Z","message":{"role":"user","content":"';
    const padding = CHUNK_BYTES - 1 - Buffer.byteLength(headerLine + rowPrefix);
    expect(padding).toBeGreaterThan(0);
    const userLine = `${rowPrefix}${"x".repeat(padding)}€ split survives","timestamp":1787238001000}}\n`;
    const assistantLine = `${JSON.stringify(assistant("utf-assistant", "utf-user", "UTF-8 answer.", 2))}\n`;
    writeDefaultSession(home, "utf8.jsonl", `${headerLine}${userLine}${assistantLine}`);
    const agent = onlyAgent(await collectPi(home));

    expect(agent?.task?.endsWith("€ split survives")).toBeTrue();
    expect(agent?.task).not.toContain("�");
  });

  test("PI-REPAIR-5B over-cap usage keeps scalar totals and withholds an incomplete call series", async () => {
    const home = tempRoot("repair-call-bound");
    const rows: Array<Record<string, unknown>> = [header("pi.repair-call-bound"), user("call-user", null, "Bound call bookkeeping.")];
    let parent = "call-user";
    for (let index = 0; index <= ENTRY_CAP; index += 1) {
      const id = `call-${index}`;
      rows.push(assistant(id, parent, `Call ${index}.`, (index % 50) + 2));
      parent = id;
    }
    const source = writeDefaultSession(home, "calls.jsonl", jsonl(...rows));
    const result = await collectPi(home);
    const agent = onlyAgent(result);
    const response = await sessionCallsResponse(
      manualSnapshot({ ...manualPiAgent(source), id: "pi:pi.repair-call-bound", sourceSessionId: "pi.repair-call-bound" }),
      "pi:pi.repair-call-bound",
      {},
    );
    const body = await response.json();

    expect({
      callSizes: agent?.callSizes,
      sessionProcessed: agent?.tokens.sessionProcessed,
      suppressionCount: result.errors.filter((reason) => /call series.*(?:suppressed|incomplete|withheld)/i.test(reason)).length,
      endpointCalls: body.calls,
    }).toEqual({
      callSizes: undefined,
      sessionProcessed: (ENTRY_CAP + 1) * 11,
      suppressionCount: 1,
      endpointCalls: null,
    });
  }, 20_000);

  test("PI-REPAIR-5C malformed warning bookkeeping is bounded and reports suppression once", async () => {
    const home = tempRoot("repair-warning-bound");
    const malformed = Array.from({ length: 300 }, (_, index) => `malformed-${index}`);
    writeDefaultSession(home, "warnings.jsonl", [
      ...malformed,
      JSON.stringify(header("pi.repair-warning-bound")),
      JSON.stringify(user("warning-user", null, "Warnings stay bounded.")),
      JSON.stringify(assistant("warning-answer", "warning-user", "Bound warning answer.")),
      "",
    ].join("\n"));
    const result = await collectPi(home);

    expect({
      bounded: result.errors.length <= 129,
      suppressionCount: result.errors.filter((reason) => /warning.*suppressed/i.test(reason)).length,
      rowPublished: result.value.map(({ sourceSessionId }) => sourceSessionId),
    }).toEqual({ bounded: true, suppressionCount: 1, rowPublished: ["pi.repair-warning-bound"] });
  });

  test("PI-REPAIR-6 first successfully parsed object must be the session header", async () => {
    const home = tempRoot("repair-header-order");
    writeDefaultSession(home, "header-order.jsonl", [
      "",
      "malformed-before-header",
      JSON.stringify(user("early-message", null, "Parsed before header.")),
      JSON.stringify(header("pi.repair-header-order")),
      JSON.stringify(assistant("late-answer", "early-message", "Must not publish.")),
      "",
    ].join("\n"));
    const result = await collectPi(home);

    expect(result.value).toEqual([]);
    expect(result.errors.join("\n")).toMatch(/first successfully parsed object.*session header/i);
  });

  test.each([
    ["terminal compaction", "compaction"],
    ["aborted post-compaction assistant", "aborted"],
    ["error post-compaction assistant", "error"],
  ] as const)("PI-REPAIR-8 %s leaves current occupancy unknown", async (_label, terminal) => {
    const home = tempRoot(`repair-occupancy-${terminal}`);
    const rows: Array<Record<string, unknown>> = [
      header(`pi.repair-occupancy-${terminal}`),
      user("occupancy-user", null, "Occupancy prompt."),
      assistant("occupancy-before", "occupancy-user", "Pre-compaction usage."),
      {
        type: "compaction",
        id: "occupancy-compaction",
        parentId: "occupancy-before",
        timestamp: "2026-08-20T15:00:03.000Z",
        summary: "Occupancy summary.",
        firstKeptEntryId: "occupancy-before",
        tokensBefore: 11,
      },
    ];
    if (terminal !== "compaction") {
      rows.push(assistant("occupancy-after", "occupancy-compaction", `${terminal} answer.`, 4, terminal));
    }
    writeDefaultSession(home, "occupancy.jsonl", jsonl(...rows));
    const agent = onlyAgent(await collectPi(home));

    expect({
      input: agent?.tokens.input,
      output: agent?.tokens.output,
      cachedInput: agent?.tokens.cachedInput,
      total: agent?.tokens.total,
      contextPct: agent?.contextPct,
      physicalTotalPresent: typeof agent?.tokens.sessionProcessed === "number",
    }).toEqual({
      input: undefined,
      output: undefined,
      cachedInput: undefined,
      total: undefined,
      contextPct: undefined,
      physicalTotalPresent: true,
    });
  });

  test("PI-REPAIR-9 usage-shaped fields on unrelated entries do not change physical totals", async () => {
    const home = tempRoot("repair-usage-shape");
    writeDefaultSession(home, "usage-shape.jsonl", jsonl(
      header("pi.repair-usage-shape"),
      user("usage-user", null, "Usage shape prompt."),
      assistant("usage-assistant", "usage-user", "Supported assistant usage."),
      {
        type: "extension_unknown",
        id: "usage-fake",
        parentId: "usage-assistant",
        timestamp: "2026-08-20T15:00:03.000Z",
        usage: { input: 100, output: 100, cacheRead: 100, cacheWrite: 100, totalTokens: 400 },
      },
    ));
    const agent = onlyAgent(await collectPi(home));

    expect({ callSizes: agent?.callSizes, tokens: agent?.tokens }).toMatchObject({
      callSizes: [11],
      tokens: { sessionTotal: 6, sessionCachedInput: 5, sessionProcessed: 11 },
    });
  });

  test("PI-REPAIR-10 Inspector projects active tool-call, branch-summary, and custom-message evidence without private guts", async () => {
    const home = tempRoot("repair-typed-context");
    const typedAssistant = assistant("typed-assistant", "typed-user", "Assistant before typed context.");
    typedAssistant.message.content.push({
      type: "toolCall",
      id: "call-native",
      name: "read",
      arguments: { path: "/private/argument-must-stay-hidden" },
    } as never);
    const source = writeDefaultSession(home, "typed.jsonl", jsonl(
      header("pi.repair-typed-context"),
      user("typed-user", null, "Typed context prompt."),
      typedAssistant,
      {
        type: "branch_summary",
        id: "branch-native",
        parentId: "typed-assistant",
        timestamp: "2026-08-20T15:00:03.000Z",
        fromId: "typed-user",
        summary: "Native branch summary text.",
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 99 } },
      },
      {
        type: "custom_message",
        id: "custom-native",
        parentId: "branch-native",
        timestamp: "2026-08-20T15:00:04.000Z",
        customType: "extension-note",
        content: "Native custom message text.",
        display: true,
        details: { private: "private tool guts" },
      },
    ));
    const snapshot = manualSnapshot({
      ...manualPiAgent(source),
      id: "pi:pi.repair-typed-context",
      sourceSessionId: "pi.repair-typed-context",
    });
    const response = await transcriptResponse(snapshot, "pi:pi.repair-typed-context", 100, {});
    const body = await response.json();
    const projected = body.lines.flatMap((line: Record<string, unknown>) =>
      ["call-native", "branch-native", "custom-native"].includes(String(line.sourceEntryId))
        || line.toolCallId === "call-native"
        ? [{
            role: line.role,
            text: line.text,
            sourceEntryId: line.sourceEntryId,
            toolCallId: line.toolCallId,
            toolName: line.toolName,
            sourceType: line.sourceType,
            sourceName: line.sourceName,
          }]
        : []);

    expect({ projected, leaksPrivateGuts: /argument-must-stay-hidden|private tool guts|"cost"|99/.test(JSON.stringify(body)) })
      .toEqual({
        projected: [
          {
            role: "tool",
            text: "read\nCall: call-native",
            sourceEntryId: "typed-assistant",
            toolCallId: "call-native",
            toolName: "read",
            sourceType: "assistant_tool_call",
            sourceName: "read",
          },
          {
            role: "system",
            text: "Native branch summary text.",
            sourceEntryId: "branch-native",
            toolCallId: undefined,
            toolName: undefined,
            sourceType: "branch_summary",
            sourceName: undefined,
          },
          {
            role: "system",
            text: "Native custom message text.",
            sourceEntryId: "custom-native",
            toolCallId: undefined,
            toolName: undefined,
            sourceType: "custom_message",
            sourceName: "extension-note",
          },
        ],
        leaksPrivateGuts: false,
      });
  });

  test("PI-REPAIR-11 collection health qualifies root, instance, file, and missing-time evidence", async () => {
    const home = tempRoot("repair-health-home");
    const firstRoot = tempRoot("repair-health-first");
    const secondRoot = tempRoot("repair-health-second");
    const defaultFailure = writeDefaultSession(home, "default-future.jsonl", jsonl(
      header("pi.repair-health-default-future", 4),
      user("default-future-user", null, "Default-root future health prompt."),
    ));
    const damaged = writeDirectSession(firstRoot, "damaged.jsonl", [
      JSON.stringify(header("pi.repair-health-damaged")),
      "malformed-health-row",
      JSON.stringify(user("damaged-user", null, "Damaged health prompt.")),
      JSON.stringify(assistant("damaged-answer", "damaged-user", "Damaged health answer.")),
      "",
    ].join("\n"));
    const future = writeDirectSession(firstRoot, "future.jsonl", jsonl(
      header("pi.repair-health-future", 4),
      user("future-user", null, "Future health prompt."),
    ));
    const missingTime = writeDirectSession(secondRoot, "missing-time.jsonl", jsonl(
      { type: "session", version: 3, id: "pi.repair-health-missing-time", timestamp: "not-a-time", cwd: "/tmp/pi-health" },
      { type: "message", id: "time-user", parentId: null, timestamp: "not-a-time", message: { role: "user", content: "Missing time prompt.", timestamp: "not-a-time" } },
      { type: "message", id: "time-answer", parentId: "time-user", timestamp: "not-a-time", message: { role: "assistant", content: [{ type: "text", text: "Missing time answer." }], provider: "anthropic", model: "claude-opus-5", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, stopReason: "stop", timestamp: "not-a-time" } },
    ));
    const result = await collectPi(home, { extraPiRoots: [firstRoot, secondRoot] });
    const malformedReasons = result.errors.filter((reason) => /malformed/i.test(reason) && reason.includes(damaged));
    const futureReasons = result.errors.filter((reason) => /schema version 4/i.test(reason) && reason.includes(future));
    const missingTimeReasons = result.errors.filter((reason) => /no usable source timestamp/i.test(reason) && reason.includes(missingTime));
    const defaultReasons = result.errors.filter((reason) => /schema version 4/i.test(reason) && reason.includes(defaultFailure));
    const sameReasonQualifies = (reasons: string[], root: string, source: string, detail: RegExp): boolean =>
      reasons.length === 1
      && reasons[0]!.includes(root)
      && reasons[0]!.includes(`instance ${expectedPiInstance(root)}`)
      && reasons[0]!.includes(source)
      && detail.test(reasons[0]!);

    expect({
      damagedQualified: sameReasonQualifies(malformedReasons, firstRoot, damaged, /malformed/i),
      futureQualified: sameReasonQualifies(futureReasons, firstRoot, future, /schema version 4/i),
      missingTimeQualified: sameReasonQualifies(missingTimeReasons, secondRoot, missingTime, /no usable source timestamp/i),
      defaultQualified: defaultReasons.length === 1
        && defaultReasons[0]!.includes(defaultSessions(home))
        && defaultReasons[0]!.includes(defaultFailure)
        && /schema version 4/i.test(defaultReasons[0]!)
        && !defaultReasons[0]!.includes("(instance "),
      missingTimePublished: result.value.some(({ sourceSessionId }) => sourceSessionId === "pi.repair-health-missing-time"),
    }).toEqual({
      damagedQualified: true,
      futureQualified: true,
      missingTimeQualified: true,
      defaultQualified: true,
      missingTimePublished: false,
    });
  });
});
