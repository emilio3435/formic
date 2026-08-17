import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectGrokBotSessions,
  decodeBlobKey,
  isReplicaBlob,
  parseReplica,
  parseReplicaBlob,
  parseRoster,
} from "../src/server/grok-bot";
import { buildSnapshot } from "../src/server/snapshot";
import type { ArchiveStore } from "../src/server/types";

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };

const FIXTURE_ROOT = join(import.meta.dir, "fixtures/grok-bot/Grok Bot 2");
const PERSISTENCE = "sand-client-persistence";
const ROSTER_KEY = "sand.client.slice.chat.roster.last-roster";
const SESSION_ID = "11111111-2222-4333-8444-555555555555";
const REPLICA_KEY = `sand.client.slice.chat.transcript.replicas.${SESSION_ID}`;
const ROSTER_FILE = "ONQW4ZBOMNWGSZLOOQXHG3DJMNSS4Y3IMF2C44TPON2GK4RONRQXG5BNOJXXG5DFOI======.blob";
const REPLICA_FILE = "ONQW4ZBOMNWGSZLOOQXHG3DJMNSS4Y3IMF2C45DSMFXHGY3SNFYHILTSMVYGY2LDMFZS4MJRGEYTCMJRGEWTEMRSGIWTIMZTGMWTQNBUGQWTKNJVGU2TKNJVGU2TKNI=.blob";
const NOW = 2_000_000_000_000;

function encodeBlobKey(key: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let encoded = "";
  for (const byte of new TextEncoder().encode(key)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      encoded += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) encoded += alphabet[(value << (5 - bits)) & 31];
  return `${encoded.padEnd(Math.ceil(encoded.length / 8) * 8, "=")}.blob`;
}

function fixture(name: string): string {
  return readFileSync(join(FIXTURE_ROOT, PERSISTENCE, name), "utf8");
}

function tempRoot(): string {
  const parent = mkdtempSync(join(tmpdir(), "anthill-grok-bot-"));
  const root = join(parent, "Grok Bot Test");
  mkdirSync(join(root, PERSISTENCE), { recursive: true });
  return root;
}

function writeBlob(root: string, key: string, body: unknown): void {
  writeFileSync(join(root, PERSISTENCE, encodeBlobKey(key)), JSON.stringify(body));
}

function copyFixture(root: string, name: string): void {
  writeFileSync(join(root, PERSISTENCE, name), fixture(name));
}

describe("Grok Bot sand-client-persistence", () => {
  test("decodes the known ui-layout RFC 4648 filename", () => {
    expect(decodeBlobKey("ONQW4ZBOMNWGSZLOOQXHG3DJMNSS45LJFVWGC6LPOV2A====.blob"))
      .toBe("sand.client.slice.ui-layout");
  });

  test("publishes the visible roster row as a Grok agent for its Bot instance", async () => {
    const result = await collectGrokBotSessions([FIXTURE_ROOT], NOW);

    expect(result.errors).toEqual([]);
    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toMatchObject({
      id: `grok:bot:${SESSION_ID}`,
      provider: "grok",
      sourceSessionId: `bot:${SESSION_ID}`,
      instanceId: "grok-bot:grok-bot-2",
      instanceLabel: "Grok Bot 2",
    });
  });

  test("reads roster lastEntry.text as the agent-close fallback", () => {
    const rows = parseRoster({
      rows: [{
        id: SESSION_ID,
        lastEntry: { kind: "text", text: "Roster agent close from lastEntry.text." },
      }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lastEntry).toBe("Roster agent close from lastEntry.text.");
  });

  test("publishes roster fallback evidence and a named error when the replica is missing", async () => {
    const root = tempRoot();
    copyFixture(root, ROSTER_FILE);

    const result = await collectGrokBotSessions([root], NOW);

    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.transcriptTail).toBe("Roster fallback should not replace the replica tail.");
    expect(result.errors.some((error) => error.includes(`replica ${SESSION_ID}`) && error.includes("missing")))
      .toBe(true);
  });

  test("names an unknown schemaVersion and continues collecting the rest of the root", async () => {
    const root = tempRoot();
    copyFixture(root, ROSTER_FILE);
    copyFixture(root, REPLICA_FILE);
    writeBlob(root, "sand.client.slice.broken.roster.last-roster", {
      schemaVersion: 99,
      value: { rows: [] },
    });

    const result = await collectGrokBotSessions([root], NOW);

    expect(result.value).toHaveLength(1);
    expect(result.errors.some((error) => error.includes("schemaVersion 99"))).toBe(true);
  });

  test("returns an exact empty additive result when no roots are onboarded", async () => {
    expect(await collectGrokBotSessions([], NOW)).toEqual({ value: [], errors: [] });
  });

  test("a shared roster UUID across two apps stays as two instance-qualified rows", async () => {
    const parent = mkdtempSync(join(tmpdir(), "anthill-grok-bot-collision-"));
    const bot1 = join(parent, "Grok Bot");
    const bot2 = join(parent, "Grok Bot 2");
    mkdirSync(join(bot1, PERSISTENCE), { recursive: true });
    mkdirSync(join(bot2, PERSISTENCE), { recursive: true });
    copyFixture(bot1, ROSTER_FILE);
    copyFixture(bot1, REPLICA_FILE);
    copyFixture(bot2, ROSTER_FILE);
    copyFixture(bot2, REPLICA_FILE);

    const result = await collectGrokBotSessions([bot1, bot2], NOW);
    const ids = result.value.map((agent) => agent.id).sort();
    expect(ids).toEqual([
      `grok:bot:grok-bot-2:${SESSION_ID}`,
      `grok:bot:grok-bot:${SESSION_ID}`,
    ]);
    expect(result.value.every((agent) => agent.sourceSessionId === `bot:${SESSION_ID}`)).toBe(true);
    expect(new Set(result.value.map((agent) => agent.instanceId))).toEqual(new Set([
      "grok-bot:grok-bot",
      "grok-bot:grok-bot-2",
    ]));
  });

  test("treats lastActivityAt 0 as missing and keeps the row via updatedAt", async () => {
    const root = tempRoot();
    writeBlob(root, ROSTER_KEY, {
      schemaVersion: 3,
      value: {
        rows: [{
          id: SESSION_ID,
          name: "Winnow Adversary",
          path: `/home/box/sand-data/agents/${SESSION_ID}/store.db`,
          lastActivityAt: 0,
          updatedAt: NOW - 1_000,
        }],
      },
    });

    const result = await collectGrokBotSessions([root], NOW, 120_000);
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.displayName).toBe("Winnow Adversary");
    expect(result.value[0]?.cwd).toBe(root);
    expect(result.value[0]?.cwd).not.toContain("store.db");
  });

  test("does not use the Bot sandbox store.db path as cwd", async () => {
    const result = await collectGrokBotSessions([FIXTURE_ROOT], NOW);
    expect(result.value[0]?.cwd).not.toMatch(/store\.db$/);
    expect(result.value[0]?.cwd).not.toMatch(/^\/home\/box\//);
  });

  test("drops a roster row whose last activity is outside windowMs", async () => {
    const root = tempRoot();
    writeBlob(root, ROSTER_KEY, {
      schemaVersion: 3,
      value: {
        rows: [{
          id: SESSION_ID,
          updatedAt: NOW - 120_001,
          lastActivityAt: NOW - 120_001,
          lastEntry: "This stale row must not publish.",
        }],
      },
    });

    const result = await collectGrokBotSessions([root], NOW, 120_000);

    expect(result).toEqual({ value: [], errors: [] });
    expect(encodeBlobKey(REPLICA_KEY)).toBe(REPLICA_FILE);
  });
});

describe("Grok Bot live schemaVersion 1 replica", () => {
  test("maps send-message text to assistant and keeps role:user as user", () => {
    const replica = parseReplica({
      entries: [
        {
          kind: "message",
          role: "user",
          content: "Please parse the persisted conversation.",
          timestampMs: NOW - 4_000,
        },
        {
          kind: "send-message",
          message: { type: "text", content: "Parsed the Grok Bot transcript." },
          timestampMs: NOW - 3_000,
        },
      ],
    });

    expect(replica.humanMessages).toEqual([
      {
        role: "user",
        content: "Please parse the persisted conversation.",
        timestamp: new Date(NOW - 4_000).toISOString(),
      },
      {
        role: "assistant",
        content: "Parsed the Grok Bot transcript.",
        timestamp: new Date(NOW - 3_000).toISOString(),
      },
    ]);
    expect(replica.transcriptTail).toBe("Parsed the Grok Bot transcript.");
  });

  test("parseReplicaBlob unwraps the schemaVersion envelope before the same entry rules", () => {
    const replica = parseReplicaBlob(JSON.stringify({
      schemaVersion: 1,
      value: {
        entries: [
          {
            kind: "message",
            role: "user",
            content: "Please parse the persisted conversation.",
            timestampMs: NOW - 4_000,
          },
          {
            kind: "send-message",
            message: { type: "text", content: "Parsed the Grok Bot transcript." },
            timestampMs: NOW - 3_000,
          },
        ],
      },
    }));

    expect(isReplicaBlob(JSON.stringify({ schemaVersion: 1, value: { entries: [] } }))).toBe(true);
    expect(isReplicaBlob(JSON.stringify({ type: "event_msg", payload: { type: "user_message" } }))).toBe(false);
    expect(replica.humanMessages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(replica.transcriptTail).toBe("Parsed the Grok Bot transcript.");
  });

  test("does not label unwrapped send-message text as the user turn", () => {
    const replica = parseReplica({
      entries: [
        {
          kind: "send-message",
          message: { type: "text", content: "I finished the close." },
          timestampMs: NOW - 1_000,
        },
      ],
    });

    expect(replica.humanMessages).toEqual([
      {
        role: "assistant",
        content: "I finished the close.",
        timestamp: new Date(NOW - 1_000).toISOString(),
      },
    ]);
    expect(replica.humanMessages.some((message) => message.role === "user")).toBe(false);
  });

  test("skips attachment, widget, cursor-agent, user-attachment, and inter-agent copies", () => {
    const replica = parseReplica({
      entries: [
        {
          kind: "message",
          role: "user",
          content: "Look at this file.",
          timestampMs: NOW - 6_000,
        },
        { kind: "user-attachment", timestampMs: NOW - 5_500 },
        {
          kind: "send-message",
          message: { type: "attachment", name: "notes.md" },
          timestampMs: NOW - 5_000,
        },
        {
          kind: "send-message",
          message: { type: "widget", id: "card-1" },
          timestampMs: NOW - 4_500,
        },
        {
          kind: "send-message",
          message: { type: "cursor-agent", id: "agent-1" },
          timestampMs: NOW - 4_000,
        },
        {
          kind: "send-message",
          message: { type: "text", content: "Here is the close after the cards." },
          timestampMs: NOW - 3_000,
        },
        {
          kind: "message",
          role: "assistant",
          toAgent: "other-bot",
          content: "Inter-agent copy must not become the row close.",
          timestampMs: NOW - 2_000,
        },
      ],
    });

    expect(replica.humanMessages.map((message) => message.content)).toEqual([
      "Look at this file.",
      "Here is the close after the cards.",
    ]);
    expect(replica.humanMessages[1]).toMatchObject({
      role: "assistant",
      content: "Here is the close after the cards.",
    });
    expect(replica.transcriptTail).toBe("Here is the close after the cards.");
  });

  test("a later send-message replaces the row close after a new user turn", async () => {
    const root = tempRoot();
    writeBlob(root, ROSTER_KEY, {
      schemaVersion: 1,
      value: {
        rows: [{
          id: SESSION_ID,
          name: "Formic Agent",
          lastActivityAt: NOW - 1_000,
          lastEntry: { kind: "text", text: "Roster close must lose to the replica." },
        }],
      },
    });
    writeBlob(root, REPLICA_KEY, {
      schemaVersion: 1,
      value: {
        entries: [
          {
            kind: "message",
            role: "user",
            content: "Please parse the persisted conversation.",
            timestampMs: NOW - 5_000,
          },
          {
            kind: "send-message",
            message: { type: "text", content: "Parsed the Grok Bot transcript." },
            timestampMs: NOW - 4_000,
          },
          {
            kind: "message",
            role: "user",
            content: "Ship the closer next.",
            timestampMs: NOW - 3_000,
          },
          {
            kind: "send-message",
            content: { type: "text", content: "Shipped the closer from send-message." },
            timestampMs: NOW - 2_000,
          },
        ],
      },
    });

    const result = await collectGrokBotSessions([root], NOW);
    expect(result.errors).toEqual([]);
    expect(result.value[0]).toMatchObject({
      lastUserMessage: "Ship the closer next.",
      lastAgentMessage: "Shipped the closer from send-message.",
      lastAgentClosing: "Shipped the closer from send-message.",
      lastAgentChatBody: "Shipped the closer from send-message.",
      transcriptTail: "Shipped the closer from send-message.",
    });
  });

  test("user-only replicas stay user-only", async () => {
    const root = tempRoot();
    writeBlob(root, ROSTER_KEY, {
      schemaVersion: 1,
      value: {
        rows: [{
          id: SESSION_ID,
          lastActivityAt: NOW - 1_000,
          lastEntry: { kind: "text", text: "Stale roster close must not invent an agent turn." },
        }],
      },
    });
    writeBlob(root, REPLICA_KEY, {
      schemaVersion: 1,
      value: {
        entries: [
          {
            kind: "message",
            role: "user",
            content: "Just a question while the bot is quiet.",
            timestampMs: NOW - 2_000,
          },
        ],
      },
    });

    const result = await collectGrokBotSessions([root], NOW);
    expect(result.value[0]).toMatchObject({
      lastUserMessage: "Just a question while the bot is quiet.",
      lastAgentMessage: null,
      lastAgentClosing: null,
      lastAgentChatBody: null,
    });
  });

  test("last event send-message publishes no workingSince", async () => {
    const root = tempRoot();
    writeBlob(root, ROSTER_KEY, {
      schemaVersion: 1,
      value: {
        rows: [{
          id: SESSION_ID,
          name: "Mr. Clean",
          lastActivityAt: NOW - 1_000,
        }],
      },
    });
    writeBlob(root, REPLICA_KEY, {
      schemaVersion: 1,
      value: {
        entries: [
          {
            kind: "message",
            role: "user",
            content: "Please finish the turn.",
            timestampMs: NOW - 5_000,
          },
          {
            kind: "send-message",
            message: { type: "text", content: "Finished the turn." },
            timestampMs: NOW - 2_000,
          },
        ],
      },
    });

    const result = await collectGrokBotSessions([root], NOW);
    expect(result.value[0]?.lastThreadAt).toBe(new Date(NOW - 2_000).toISOString());
    expect(result.value[0]?.workingSince).toBeUndefined();
  });

  test("last event user keeps the workingSince streak open", async () => {
    const root = tempRoot();
    writeBlob(root, ROSTER_KEY, {
      schemaVersion: 1,
      value: {
        rows: [{
          id: SESSION_ID,
          name: "Formic Agent",
          lastActivityAt: NOW - 1_000,
        }],
      },
    });
    writeBlob(root, REPLICA_KEY, {
      schemaVersion: 1,
      value: {
        entries: [
          {
            kind: "message",
            role: "user",
            content: "Please finish the turn.",
            timestampMs: NOW - 5_000,
          },
          {
            kind: "send-message",
            message: { type: "text", content: "Finished the turn." },
            timestampMs: NOW - 3_000,
          },
          {
            kind: "message",
            role: "user",
            content: "Start the next turn.",
            timestampMs: NOW - 1_000,
          },
        ],
      },
    });

    const result = await collectGrokBotSessions([root], NOW);
    expect(result.value[0]?.workingSince).toBe(new Date(NOW - 1_000).toISOString());
    expect(result.value[0]?.lastThreadAt).toBe(new Date(NOW - 1_000).toISOString());
  });

  test("missing replica falls back to lastEntry.text as the agent close", async () => {
    const root = tempRoot();
    writeBlob(root, ROSTER_KEY, {
      schemaVersion: 1,
      value: {
        rows: [{
          id: SESSION_ID,
          lastActivityAt: NOW - 1_000,
          lastEntry: { kind: "text", text: "Agent close from roster lastEntry." },
        }],
      },
    });

    const result = await collectGrokBotSessions([root], NOW);
    expect(result.value[0]?.transcriptTail).toBe("Agent close from roster lastEntry.");
    expect(result.errors.some((error) => error.includes(`replica ${SESSION_ID}`) && error.includes("missing")))
      .toBe(true);
  });
});

describe("Grok Bot hub wiring", () => {
  test("empty extra roots leave the grok provider as CLI-only", async () => {
    const { collectSessionProvider } = await import("../src/server/collectors");
    const result = await collectSessionProvider("grok", "/tmp/anthill-no-grok-home", 120_000);
    expect(result.value.every((agent) => !String(agent.id).startsWith("grok:bot:"))).toBe(true);
  });

  test("onboarded Bot roots publish grok:bot rows through collectSessionProvider", async () => {
    const { collectSessionProvider } = await import("../src/server/collectors");
    const result = await collectSessionProvider(
      "grok",
      "/tmp/anthill-no-grok-home",
      36 * 60 * 60 * 1_000,
      undefined,
      { extraGrokBotRoots: [FIXTURE_ROOT] },
    );
    expect(result.value.some((agent) => agent.id === `grok:bot:${SESSION_ID}`)).toBe(true);
    const bot = result.value.find((agent) => agent.id === `grok:bot:${SESSION_ID}`);
    expect(bot).toMatchObject({
      provider: "grok",
      instanceLabel: "Grok Bot 2",
    });
  });
});

describe("Grok Bot board visibility", () => {
  test("a quiet Bot row is not finished by a complete process roster", async () => {
    const collected = await collectGrokBotSessions([FIXTURE_ROOT], NOW);
    const bot = collected.value[0];
    expect(bot).toBeDefined();
    /* Two hours quiet — past the 45-minute band that used to file these
       finished/process-absent because the Mac roster cannot see Grok Bot.app. */
    const quiet = { ...bot!, updatedAt: new Date(NOW - 2 * 60 * 60 * 1000).toISOString() };
    const snap = buildSnapshot({
      agents: [quiet],
      surfaces: [],
      archiveStore,
      processRosterComplete: true,
      now: new Date(NOW),
    });
    const published = snap.programs.flatMap((program) => program.agents);
    expect(published).toHaveLength(1);
    expect(published[0]?.id).toBe(bot!.id);
    expect(published[0]?.processRosterComplete).toBeUndefined();
    expect(published[0]?.lifecycle).toBe("unverified");
    expect(published[0]?.programId).not.toContain("store.db");
    expect(published[0]?.cwd).not.toMatch(/store\.db$/);
  });
});
