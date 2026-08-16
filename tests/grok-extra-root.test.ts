import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectSessionProvider } from "../src/server/collectors";
import { isGrokBotProductCache } from "../src/server/collector-instances";

const ID = "01a0072a-1b2c-7d3e-8f40-123456789abc";
const EXTRA_ID = "11b1183b-2c3d-8e4f-9051-234567890bcd";
const CWD_ENC = "%2FUsers%2Fant%2FDeveloper%2Fformic";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixtureHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "mountain-grok-extra-root-"));
  temporaryDirectories.push(home);
  return home;
}

async function writeCliSession(root: string, sessionId: string, title: string): Promise<void> {
  const session = join(root, "sessions", CWD_ENC, sessionId);
  await mkdir(session, { recursive: true });
  await writeFile(join(session, "summary.json"), JSON.stringify({
    generated_title: title,
    created_at: "2026-08-15T20:00:00.000Z",
    last_active_at: "2026-08-15T20:02:00.000Z",
    info: { cwd: "/Users/ant/Developer/formic" },
  }));
  await writeFile(join(session, "updates.jsonl"), `${JSON.stringify({
    timestamp: 1_786_824_000,
    method: "session/update",
    params: {
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "Ship extra Grok homes." },
      },
    },
  })}\n`);
}

test("an onboarded extra Grok CLI home becomes grok rows with an instance label", async () => {
  const home = await fixtureHome();
  await writeCliSession(join(home, ".grok"), ID, "Default Grok");
  await writeCliSession(join(home, ".grok-2"), EXTRA_ID, "Second Grok");
  const result = await collectSessionProvider("grok", home, Number.POSITIVE_INFINITY, undefined, {
    extraGrokCliRoots: [join(home, ".grok-2")],
  });
  expect(result.errors).toEqual([]);
  expect(result.value.some((agent) => agent.id === `grok:${ID}` && agent.instanceLabel === undefined)).toBe(true);
  const extra = result.value.find((agent) => agent.id === `grok:${EXTRA_ID}`);
  expect(extra).toMatchObject({
    provider: "grok",
    instanceLabel: ".grok-2",
    displayName: "Second Grok",
  });
  expect(extra?.instanceId).toContain("grok-cli");
});

test("the same TUI uuid in default and extra is one row and the default wins", async () => {
  const home = await fixtureHome();
  await writeCliSession(join(home, ".grok"), ID, "Default title");
  await writeCliSession(join(home, ".grok-2"), ID, "Extra title");
  const result = await collectSessionProvider("grok", home, Number.POSITIVE_INFINITY, undefined, {
    extraGrokCliRoots: [join(home, ".grok-2")],
  });
  const matches = result.value.filter((agent) => agent.sourceSessionId === ID);
  expect(matches).toHaveLength(1);
  expect(matches[0]?.displayName).toBe("Default title");
  expect(matches[0]?.instanceLabel).toBeUndefined();
});

test("a missing extra root is a named error and the default still collects", async () => {
  const home = await fixtureHome();
  await writeCliSession(join(home, ".grok"), ID, "Default Grok");
  const missing = join(home, ".grok-missing");
  const result = await collectSessionProvider("grok", home, Number.POSITIVE_INFINITY, undefined, {
    extraGrokCliRoots: [missing],
  });
  expect(result.errors.some((error) => error.includes(".grok-missing") && error.includes("not found"))).toBe(true);
  expect(result.value.some((agent) => agent.id === `grok:${ID}`)).toBe(true);
});

test("~/.grokbot is never collected as a Grok CLI extra", async () => {
  const home = await fixtureHome();
  await writeCliSession(join(home, ".grok"), ID, "Default Grok");
  await writeCliSession(join(home, ".grokbot"), EXTRA_ID, "Bot cache trap");
  expect(isGrokBotProductCache(join(home, ".grokbot"))).toBe(true);
  const result = await collectSessionProvider("grok", home, Number.POSITIVE_INFINITY, undefined, {
    extraGrokCliRoots: [join(home, ".grokbot")],
  });
  expect(result.errors).toEqual([]);
  expect(result.value.map((agent) => agent.id)).toEqual([`grok:${ID}`]);
});
