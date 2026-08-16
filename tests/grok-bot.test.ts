import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectGrokBotSessions,
  decodeBlobKey,
  parseReplica,
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

  test("uses replica messages for the transcript tail and human-message evidence", async () => {
    const replica = parseReplica(JSON.parse(fixture(REPLICA_FILE)).value);
    expect(replica.transcriptTail).toBe("Parsed the Grok Bot transcript.");
    expect(replica.humanMessages).toHaveLength(1);
    expect(replica.humanMessages[0]).toMatchObject({
      role: "user",
      content: "Please parse the persisted conversation.",
    });

    const result = await collectGrokBotSessions([FIXTURE_ROOT], NOW);
    expect(result.value[0]).toMatchObject({
      transcriptTail: "Parsed the Grok Bot transcript.",
      lastUserMessage: "Please parse the persisted conversation.",
    });
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
    const snap = buildSnapshot({
      agents: [bot!],
      surfaces: [],
      archiveStore,
      processRosterComplete: true,
      now: new Date(NOW),
    });
    const published = snap.programs.flatMap((program) => program.agents);
    expect(published).toHaveLength(1);
    expect(published[0]?.id).toBe(bot!.id);
    expect(published[0]?.processRosterComplete).toBeUndefined();
    expect(published[0]?.lifecycle).not.toBe("finished");
    expect(published[0]?.programId).not.toContain("store.db");
    expect(published[0]?.cwd).not.toMatch(/store\.db$/);
  });
});
