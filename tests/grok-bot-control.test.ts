import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeControl } from "../src/server/control";
import {
  connectOriginFromGatewayRecord,
  controlSurfaceKind,
  discoverBoxGatewayAttach,
  GROK_BOT_GATEWAY_COPY,
  parseGatewayRecord,
  probeGrokBotGateway,
  readGatewayForRoot,
  recordGrokBotProbeResult,
  resetAcceptedNoncesForTests,
  sendGrokBotPrompt,
  setGrokBotAttachImplForTests,
  setGrokBotProbeImplForTests,
  type BoxGatewayAttach,
} from "../src/server/grok-bot-gateway";
import { collectGrokBotSessions } from "../src/server/grok-bot";
import { buildSnapshot } from "../src/server/snapshot";
import { controlsFor, operatorControlState, processStateFor } from "../src/server/snapshot-agent";
import {
  canWriteToTarget,
  resolveAgentTarget,
  transmitRefusal,
} from "../src/server/targets";
import type { AgentSnapshot, CmuxTarget } from "../src/shared/types";
import type {
  ArchiveStore,
  CollectedAgent,
  CommandResult,
  CommandRunner,
  CmuxSurface,
} from "../src/server/types";

const ROSTER_ID = "11111111-2222-4333-8444-555555555555";
const NOW = 2_000_000_000_000;
const PERSISTENCE = "sand-client-persistence";
const ROSTER_KEY = "sand.client.slice.chat.roster.last-roster";

class RecordingRunner implements CommandRunner {
  readonly commands: string[][] = [];
  async run(command: readonly string[]): Promise<CommandResult> {
    this.commands.push([...command]);
    return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
  }
}

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };

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

function writeRoster(root: string, id = ROSTER_ID): void {
  mkdirSync(join(root, PERSISTENCE), { recursive: true });
  writeFileSync(join(root, PERSISTENCE, encodeBlobKey(ROSTER_KEY)), JSON.stringify({
    schemaVersion: 3,
    value: {
      rows: [{
        id,
        name: "Formic Agent",
        lastActivityAt: NOW - 1_000,
        lastEntry: { kind: "text", text: "Roster close." },
      }],
    },
  }));
}

function writeGateway(root: string, token: string, port = 1340): void {
  mkdirSync(join(root, "box/sand-data"), { recursive: true });
  writeFileSync(join(root, "box/sand-data/gateway.json"), JSON.stringify({ token, port }));
}

function attachFor(
  root: string,
  instanceId: string,
  loopbackOrigin = "http://127.0.0.1:1340",
): BoxGatewayAttach {
  return {
    instanceId,
    loopbackOrigin,
    readBoxGatewayJson: () => {
      const path = join(root, "box/sand-data/gateway.json");
      return existsSync(path) ? readFileSync(path, "utf8") : undefined;
    },
  };
}

function collectedBot(overrides: Partial<CollectedAgent> & {
  instanceId?: string;
  instanceLabel?: string;
} = {}): CollectedAgent {
  return {
    id: `grok:bot:${ROSTER_ID}`,
    provider: "grok",
    sourceSessionId: `bot:${ROSTER_ID}`,
    displayName: "Formic Agent",
    status: "waiting",
    statusReason: "Quiet Bot row.",
    updatedAt: new Date(NOW).toISOString(),
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    cwd: overrides.cwd ?? "/tmp/Grok Bot",
    originCwd: overrides.originCwd ?? "/tmp/Grok Bot",
    instanceId: overrides.instanceId ?? "grok-bot:grok-bot",
    instanceLabel: overrides.instanceLabel ?? "Grok Bot",
    allowCwdFallback: false,
    ...overrides,
  };
}

function botTarget(overrides: Partial<CmuxTarget> = {}): CmuxTarget {
  return {
    kind: "grok-bot",
    agentId: ROSTER_ID,
    instanceId: "grok-bot:grok-bot",
    instanceLabel: "Grok Bot",
    originCwd: "/tmp/Grok Bot",
    gatewayReady: true,
    resolution: "gateway",
    reason: "Grok Bot gateway is linked for Grok Bot",
    ...overrides,
  };
}

function snapshotBot(overrides: {
  target?: CmuxTarget;
  archived?: boolean;
  processState?: AgentSnapshot["processState"];
  originCwd?: string;
  instanceId?: string;
  instanceLabel?: string;
  id?: string;
} = {}): AgentSnapshot {
  const target = overrides.target ?? botTarget();
  const collected = collectedBot({
    id: overrides.id ?? `grok:bot:${ROSTER_ID}`,
    originCwd: overrides.originCwd ?? target.originCwd,
    instanceId: overrides.instanceId ?? target.instanceId,
    instanceLabel: overrides.instanceLabel ?? target.instanceLabel,
  });
  const archived = overrides.archived ?? false;
  return {
    ...collected,
    programId: "grok-bot",
    lastHumanMessage: null,
    processState: overrides.processState ?? processStateFor(collected),
    controlState: operatorControlState(target, archived),
    target,
    controls: controlsFor(collected, target, archived),
  } as AgentSnapshot;
}

beforeEach(() => {
  resetAcceptedNoncesForTests();
});

describe("Grok Bot is its own surface kind", () => {
  test("canWriteToTarget requires kind grok-bot plus a ready gateway, never a fake cmux exact", () => {
    expect(canWriteToTarget(botTarget())).toBe(true);
    expect(canWriteToTarget(botTarget({ gatewayReady: false, resolution: "missing" }))).toBe(false);
    expect(canWriteToTarget({
      resolution: "gateway",
      surfaceId: "SURFACE-FAKE",
      attestation: "live",
    })).toBe(false);
    expect(canWriteToTarget({
      kind: "grok-bot",
      resolution: "exact",
      surfaceId: "SURFACE-FAKE",
      attestation: "live",
      agentId: ROSTER_ID,
      instanceId: "grok-bot:grok-bot",
      gatewayReady: false,
    })).toBe(false);
    expect(controlSurfaceKind(botTarget())).toBe("grok-bot");
    const cmuxOnly: CmuxTarget = { resolution: "exact", surfaceId: "S" };
    expect(controlSurfaceKind(cmuxOnly)).toBe("cmux");
  });

  test("resolveAgentTarget never mints unique-cwd or exact/live against the Bot folder", () => {
    const root = "/Users/me/Library/Application Support/Grok Bot";
    const agent = collectedBot({ cwd: root, originCwd: root });
    const surface: CmuxSurface = {
      surfaceId: "SURFACE-SHARED",
      paneId: "PANE-1",
      cwd: root,
      sourceSessionIds: [],
    };
    const target = resolveAgentTarget(agent, [surface], [agent]);
    expect(target.kind).toBe("grok-bot");
    expect(target.resolution).not.toBe("exact");
    expect(target.resolution).not.toBe("unique-cwd");
    expect(target.attestation).toBeUndefined();
    expect(target.surfaceId).toBeUndefined();
  });
});

describe("missing-gateway copy names the real miss", () => {
  test("three distinct missing-gateway strings never mention a cmux pane or Application Support", () => {
    const misses = ["no-token", "unreachable-box", "probe-rejected"] as const;
    const causes = misses.map((miss) => GROK_BOT_GATEWAY_COPY[miss].cause);
    const remedies = misses.map((miss) => GROK_BOT_GATEWAY_COPY[miss].remedy);
    expect(new Set(causes).size).toBe(3);
    expect(new Set(remedies).size).toBe(3);
    expect(causes[0]).toMatch(/no gateway token/i);
    expect(causes[1]).toMatch(/unreachable from this Mac/i);
    expect(causes[2]).toMatch(/rejected the probe/i);
    for (const miss of misses) {
      const refusal = transmitRefusal({
        target: botTarget({ gatewayReady: false, resolution: "missing", gatewayMiss: miss }),
        processState: "unknown",
      });
      expect(refusal?.cause).toBe(GROK_BOT_GATEWAY_COPY[miss].cause);
      expect(refusal?.remedy).toBe(GROK_BOT_GATEWAY_COPY[miss].remedy);
      expect(refusal?.message).not.toMatch(/cmux pane/i);
      expect(refusal?.message).not.toMatch(/Application Support/i);
      expect(refusal?.message).not.toMatch(/no safe cmux target/i);
    }
  });

  test("unknown process does not disable Send when the gateway is ready", () => {
    const agent = snapshotBot({ processState: "unknown" });
    expect(agent.processState).toBe("unknown");
    expect(agent.controls.find((control) => control.action === "instruct")?.enabled).toBe(true);
    expect(transmitRefusal({
      target: agent.target,
      processState: "unknown",
    })).toBeNull();
  });
});

describe("executeControl dispatches by kind", () => {
  test("Bot instruct never hits cmuxRpc and uses that instance's token", async () => {
    const runner = new RecordingRunner();
    const sends: Array<{ token: string; agentId: string; clientNonce: string; prompt: string; url?: string }> = [];
    const bot2 = snapshotBot({
      target: botTarget({
        instanceId: "grok-bot:grok-bot-2",
        instanceLabel: "Grok Bot 2",
        originCwd: "/tmp/Grok Bot 2",
      }),
      originCwd: "/tmp/Grok Bot 2",
      instanceId: "grok-bot:grok-bot-2",
      instanceLabel: "Grok Bot 2",
    });
    const execution = await executeControl(
      { action: "instruct", agentId: bot2.id, instruction: "Ship it.", clientNonce: "nonce-1" },
      bot2,
      {
        runner,
        archiveStore,
        grokBot: {
          readGateway: (root) => root.includes("Grok Bot 2")
            ? { token: "token-bot-2", url: "http://127.0.0.1:1340", sourcePath: `${root}/gateway.json` }
            : { token: "token-bot-1", url: "http://127.0.0.1:1340", sourcePath: `${root}/gateway.json` },
          rosterHasAgent: () => true,
          probeOk: true,
          probe: async () => true,
          sendPrompt: async (input) => {
            sends.push(input);
            return { ok: true };
          },
        },
      },
    );
    expect(execution.response.ok).toBe(true);
    expect(runner.commands).toEqual([]);
    expect(sends).toEqual([{
      url: "http://127.0.0.1:1340",
      token: "token-bot-2",
      agentId: ROSTER_ID,
      prompt: "Ship it.",
      clientNonce: "nonce-1",
    }]);
    expect(JSON.stringify(sends)).not.toContain("token-bot-1");
  });

  test("the same clientNonce does not double-post; a new nonce is a second turn", async () => {
    const sends: string[] = [];
    const agent = snapshotBot();
    const grokBot = {
      readGateway: () => ({ token: "token-1", url: "http://127.0.0.1:1340", sourcePath: "x" }),
      rosterHasAgent: () => true,
      probeOk: true,
      probe: async () => true,
      sendPrompt: async (input: { clientNonce: string }) => {
        sends.push(input.clientNonce);
        return { ok: true };
      },
    };
    const first = await executeControl(
      { action: "instruct", agentId: agent.id, instruction: "Once.", clientNonce: "same-nonce" },
      agent,
      { runner: new RecordingRunner(), archiveStore, grokBot },
    );
    const retry = await executeControl(
      { action: "instruct", agentId: agent.id, instruction: "Once.", clientNonce: "same-nonce" },
      agent,
      { runner: new RecordingRunner(), archiveStore, grokBot },
    );
    const secondTurn = await executeControl(
      { action: "instruct", agentId: agent.id, instruction: "Twice.", clientNonce: "new-nonce" },
      agent,
      { runner: new RecordingRunner(), archiveStore, grokBot },
    );
    expect(first.response.ok).toBe(true);
    expect(retry.response.ok).toBe(true);
    expect(secondTurn.response.ok).toBe(true);
    expect(sends).toEqual(["same-nonce", "new-nonce"]);
  });

  test("Focus opens the matching app and is not Send", async () => {
    const runner = new RecordingRunner();
    const sends: unknown[] = [];
    const agent = snapshotBot({
      target: botTarget({ instanceLabel: "Grok Bot 2" }),
      instanceLabel: "Grok Bot 2",
    });
    const execution = await executeControl(
      { action: "focus", agentId: agent.id },
      agent,
      {
        runner,
        archiveStore,
        grokBot: {
          sendPrompt: async (input) => {
            sends.push(input);
            return { ok: true };
          },
        },
      },
    );
    expect(execution.response.ok).toBe(true);
    expect(runner.commands).toEqual([["open", "-a", "Grok Bot 2"]]);
    expect(sends).toEqual([]);
    expect(JSON.stringify(runner.commands)).not.toContain("grokbot://");
  });

  test("Interrupt stays disabled and never cmuxRpcs Escape", async () => {
    const runner = new RecordingRunner();
    const agent = snapshotBot();
    expect(agent.controls.find((control) => control.action === "interrupt")?.enabled).toBe(false);
    const execution = await executeControl(
      { action: "interrupt", agentId: agent.id },
      agent,
      { runner, archiveStore },
    );
    expect(execution.response.ok).toBe(false);
    expect(runner.commands).toEqual([]);
    expect(JSON.stringify(runner.commands)).not.toContain("surface.send_key");
  });

  test("archive still refuses Send", async () => {
    const runner = new RecordingRunner();
    const agent = snapshotBot({ archived: true });
    expect(agent.controls.find((control) => control.action === "instruct")?.enabled).toBe(false);
    const execution = await executeControl(
      { action: "instruct", agentId: agent.id, instruction: "Nope." },
      agent,
      { runner, archiveStore },
    );
    expect(execution.status).toBe(409);
    expect(execution.response.error?.message).toMatch(/archived/i);
    expect(runner.commands).toEqual([]);
  });

  test("Send does not write sand-client-persistence", async () => {
    const root = mkdtempSync(join(tmpdir(), "anthill-grok-bot-nowrite-"));
    writeRoster(root);
    writeGateway(root, "token-live");
    const persistence = join(root, PERSISTENCE);
    const before = readFileSync(join(persistence, encodeBlobKey(ROSTER_KEY)), "utf8");
    const collected = collectedBot({ cwd: root, originCwd: root });
    recordGrokBotProbeResult("grok-bot:grok-bot", true);
    const attach = () => attachFor(root, "grok-bot:grok-bot");
    setGrokBotAttachImplForTests(attach);
    const target = resolveAgentTarget(collected, [], [collected]);
    const agent = snapshotBot({ target, originCwd: root });
    await executeControl(
      { action: "instruct", agentId: agent.id, instruction: "Do not touch blobs.", clientNonce: "n1" },
      agent,
      {
        runner: new RecordingRunner(),
        archiveStore,
        grokBot: {
          attach,
          probeOk: true,
          probe: async () => true,
          sendPrompt: async () => ({ ok: true }),
        },
      },
    );
    expect(readFileSync(join(persistence, encodeBlobKey(ROSTER_KEY)), "utf8")).toBe(before);
  });
});

describe("instance isolation and board collision", () => {
  test("a Grok Bot 2 row never uses Grok Bot's attach or token", async () => {
    const parent = mkdtempSync(join(tmpdir(), "anthill-grok-bot-iso-"));
    const bot1 = join(parent, "Grok Bot");
    const bot2 = join(parent, "Grok Bot 2");
    writeRoster(bot1);
    writeRoster(bot2);
    writeGateway(bot1, "token-one");
    writeGateway(bot2, "token-two");
    const collected = collectedBot({
      cwd: bot2,
      originCwd: bot2,
      instanceId: "grok-bot:grok-bot-2",
      instanceLabel: "Grok Bot 2",
    });
    recordGrokBotProbeResult("grok-bot:grok-bot-2", true);
    const attach = (instanceId: string) => instanceId === "grok-bot:grok-bot-2"
      ? attachFor(bot2, instanceId, "http://127.0.0.1:1341")
      : attachFor(bot1, instanceId, "http://127.0.0.1:1340");
    setGrokBotAttachImplForTests(attach);
    const target = resolveAgentTarget(collected, [], [collected]);
    expect(target.kind).toBe("grok-bot");
    expect(target.gatewayReady).toBe(true);
    expect(target.instanceId).toBe("grok-bot:grok-bot-2");
    const sends: Array<{ token: string; url: string }> = [];
    const agent = snapshotBot({
      target,
      originCwd: bot2,
      instanceId: "grok-bot:grok-bot-2",
      instanceLabel: "Grok Bot 2",
    });
    await executeControl(
      { action: "instruct", agentId: agent.id, instruction: "Only two.", clientNonce: "iso" },
      agent,
      {
        runner: new RecordingRunner(),
        archiveStore,
        grokBot: {
          attach,
          probeOk: true,
          probe: async () => true,
          sendPrompt: async (input) => {
            sends.push({ token: input.token, url: input.url });
            return { ok: true };
          },
        },
      },
    );
    expect(sends).toEqual([{ token: "token-two", url: "http://127.0.0.1:1341" }]);
    expect(JSON.stringify(sends)).not.toContain("token-one");
    expect(JSON.stringify(sends)).not.toContain("1340");
  });

  test("Send is not advertised when the listAgents probe fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "anthill-grok-bot-probe-fail-"));
    writeRoster(root);
    writeGateway(root, "token-present");
    setGrokBotAttachImplForTests((instanceId) => attachFor(root, instanceId));
    setGrokBotProbeImplForTests(async () => false);
    const collected = await collectGrokBotSessions([root], NOW);
    expect(collected.value).toHaveLength(1);
    const target = resolveAgentTarget(collected.value[0]!, [], collected.value);
    expect(target.kind).toBe("grok-bot");
    expect(target.gatewayReady).toBe(false);
    expect(target.gatewayMiss).toBe("probe-rejected");
    expect(canWriteToTarget(target)).toBe(false);
    const snap = buildSnapshot({
      agents: collected.value,
      surfaces: [],
      archiveStore,
      now: new Date(NOW),
    });
    const published = snap.programs.flatMap((program) => program.agents)[0];
    expect(published?.controls.find((control) => control.action === "instruct")?.enabled).toBe(false);
    expect(transmitRefusal({ target, processState: "unknown" })?.cause)
      .toBe(GROK_BOT_GATEWAY_COPY["probe-rejected"].cause);
    expect(JSON.stringify(snap)).not.toMatch(/token-present/);
  });

  test("bind-host parse does not discard official gateway.json; connect-to non-loopback is still rejected", async () => {
    expect(connectOriginFromGatewayRecord({
      token: "secret-token",
      host: "0.0.0.0",
      port: 1340,
    })).toBe("http://127.0.0.1:1340");
    expect(connectOriginFromGatewayRecord({
      token: "secret-token",
      host: "8.8.8.8",
      port: 1340,
    })).toBe("http://127.0.0.1:1340");
    expect(connectOriginFromGatewayRecord({
      token: "secret-token",
      host: "::",
      port: 1340,
    })).toBe("http://127.0.0.1:1340");
    expect(connectOriginFromGatewayRecord({
      token: "secret-token",
      url: "http://example.com:1340",
    })).toBeUndefined();
    expect(parseGatewayRecord(JSON.stringify({
      token: "ok-token",
      host: "0.0.0.0",
      port: 1340,
    }))).toMatchObject({
      token: "ok-token",
      url: "http://127.0.0.1:1340",
    });

    const root = mkdtempSync(join(tmpdir(), "anthill-grok-bot-offbox-"));
    writeRoster(root);
    mkdirSync(join(root, "box/sand-data"), { recursive: true });
    writeFileSync(join(root, "box/sand-data/gateway.json"), JSON.stringify({
      token: "secret-token",
      url: "http://example.com:1340",
    }));
    expect(readGatewayForRoot(root)).toBeUndefined();
    const collected = collectedBot({ cwd: root, originCwd: root });
    const target = resolveAgentTarget(collected, [], [collected]);
    expect(target.gatewayReady).toBe(false);
    expect(canWriteToTarget(target)).toBe(false);

    const fetches: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      fetches.push(String(url));
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    expect(await probeGrokBotGateway({
      token: "secret-token",
      url: "http://example.com:1340",
      sourcePath: join(root, "box/sand-data/gateway.json"),
    }, fetchImpl)).toBe(false);
    const sent = await sendGrokBotPrompt({
      url: "http://10.0.0.1:1340",
      token: "secret-token",
      agentId: ROSTER_ID,
      prompt: "leak the prompt",
      clientNonce: "off-box",
    }, fetchImpl);
    expect(sent.ok).toBe(false);
    expect(fetches).toEqual([]);

    writeFileSync(join(root, "box/sand-data/gateway.json"), JSON.stringify({
      token: "ok-token",
      host: "0.0.0.0",
      port: 1340,
    }));
    expect(readGatewayForRoot(root)).toEqual({
      token: "ok-token",
      url: "http://127.0.0.1:1340",
      sourcePath: join(root, "box/sand-data/gateway.json"),
    });
    writeFileSync(join(root, "box/sand-data/gateway.json"), JSON.stringify({
      token: "ok-token",
      url: "http://127.0.0.1:1340",
    }));
    expect(readGatewayForRoot(root)).toEqual({
      token: "ok-token",
      url: "http://127.0.0.1:1340",
      sourcePath: join(root, "box/sand-data/gateway.json"),
    });
    writeFileSync(join(root, "box/sand-data/gateway.json"), JSON.stringify({
      token: "ok-token",
      url: "http://[::1]:1340",
    }));
    expect(readGatewayForRoot(root)?.url).toBe("http://[::1]:1340");
  });

  test("without an attested attach, a Mac-side gateway.json does not make Send ready", async () => {
    const root = mkdtempSync(join(tmpdir(), "anthill-grok-bot-no-attach-"));
    writeRoster(root);
    writeGateway(root, "planted-mac-token");
    expect(discoverBoxGatewayAttach("grok-bot:grok-bot")).toBeUndefined();
    const collected = await collectGrokBotSessions([root], NOW);
    expect(collected.value).toHaveLength(1);
    const target = resolveAgentTarget(collected.value[0]!, [], collected.value);
    expect(target.kind).toBe("grok-bot");
    expect(target.gatewayReady).toBe(false);
    expect(target.gatewayMiss).toBe("unreachable-box");
    expect(canWriteToTarget(target)).toBe(false);
    const snap = buildSnapshot({
      agents: collected.value,
      surfaces: [],
      archiveStore,
      now: new Date(NOW),
    });
    const published = snap.programs.flatMap((program) => program.agents)[0];
    expect(published?.controls.find((control) => control.action === "instruct")?.enabled).toBe(false);
    expect(published?.target.gatewayMiss).toBe("unreachable-box");
    expect(JSON.stringify(snap)).not.toMatch(/planted-mac-token/);
    expect(JSON.stringify(published?.target)).not.toContain("token");
    expect(transmitRefusal({ target, processState: "unknown" })?.cause)
      .toBe(GROK_BOT_GATEWAY_COPY["unreachable-box"].cause);
  });

  test("a live local-exec connection attaches the box and enables Send without a test inject", async () => {
    const fixture = await new Promise<{ close: () => void; origin: string }>((resolve, reject) => {
      const server = createServer((req, res) => {
        if (req.url === "/api/listAgents") {
          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end("{\"agents\":[]}");
          return;
        }
        res.statusCode = 404;
        res.end();
      });
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          server.close();
          reject(new Error("fixture did not bind"));
          return;
        }
        resolve({
          close: () => server.close(),
          origin: `http://127.0.0.1:${address.port}`,
        });
      });
    });
    try {
      const root = mkdtempSync(join(tmpdir(), "anthill-grok-bot-live-attach-"));
      writeRoster(root);
      mkdirSync(join(root, "sand-data"), { recursive: true });
      writeFileSync(join(root, "sand-data", "local-exec-daemon-connection.json"), JSON.stringify({
        baseUrl: fixture.origin,
        token: "live-box-token",
        headers: { "x-anyrun-network-token": "net-live" },
      }));
      expect(discoverBoxGatewayAttach("grok-bot:grok-bot")).toBeUndefined();
      const collected = await collectGrokBotSessions([root], NOW);
      expect(collected.value).toHaveLength(1);
      const target = resolveAgentTarget(collected.value[0]!, [], collected.value);
      expect(target.kind).toBe("grok-bot");
      expect(target.gatewayReady).toBe(true);
      expect(target.gatewayMiss).toBeUndefined();
      expect(canWriteToTarget(target)).toBe(true);
      expect(JSON.stringify(collected)).not.toMatch(/live-box-token/);
      expect(JSON.stringify(target)).not.toContain("token");
      expect(JSON.stringify(target)).not.toContain("net-live");
    } finally {
      fixture.close();
    }
  });

  test("an attach that finds no token on the box names the token miss", async () => {
    const root = mkdtempSync(join(tmpdir(), "anthill-grok-bot-box-empty-"));
    writeRoster(root);
    mkdirSync(join(root, "box/sand-data"), { recursive: true });
    writeFileSync(join(root, "box/sand-data/gateway.json"), JSON.stringify({ host: "0.0.0.0", port: 1340 }));
    setGrokBotAttachImplForTests((instanceId) => attachFor(root, instanceId));
    const collected = await collectGrokBotSessions([root], NOW);
    const target = resolveAgentTarget(collected.value[0]!, [], collected.value);
    expect(target.gatewayReady).toBe(false);
    expect(target.gatewayMiss).toBe("no-token");
    expect(transmitRefusal({ target, processState: "unknown" })?.cause)
      .toBe(GROK_BOT_GATEWAY_COPY["no-token"].cause);
  });

  test("concurrent same-nonce retries do not double-post", async () => {
    let entered = 0;
    let releaseFirst!: () => void;
    let firstEntered!: () => void;
    const holdFirst = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const sawFirstSend = new Promise<void>((resolve) => {
      firstEntered = resolve;
    });
    const agent = snapshotBot();
    const grokBot = {
      readGateway: () => ({ token: "token-1", url: "http://127.0.0.1:1340", sourcePath: "x" }),
      rosterHasAgent: () => true,
      probeOk: true,
      probe: async () => true,
      sendPrompt: async () => {
        entered += 1;
        if (entered === 1) {
          firstEntered();
          await holdFirst;
        }
        return { ok: true };
      },
    };
    const request = {
      action: "instruct" as const,
      agentId: agent.id,
      instruction: "Once.",
      clientNonce: "race-nonce",
    };
    const first = executeControl(request, agent, {
      runner: new RecordingRunner(),
      archiveStore,
      grokBot,
    });
    const second = executeControl(request, agent, {
      runner: new RecordingRunner(),
      archiveStore,
      grokBot,
    });
    await sawFirstSend;
    expect(entered).toBe(1);
    releaseFirst();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.response.ok).toBe(true);
    expect(secondResult.response.ok).toBe(true);
    expect(entered).toBe(1);
  });

  test("buildSnapshot links a working Bot row without cmux attestation copy", async () => {
    const root = mkdtempSync(join(tmpdir(), "anthill-grok-bot-snap-"));
    writeRoster(root);
    writeGateway(root, "token-snap");
    setGrokBotAttachImplForTests((instanceId) => attachFor(root, instanceId));
    setGrokBotProbeImplForTests(async () => true);
    const collected = await collectGrokBotSessions([root], NOW);
    expect(collected.value).toHaveLength(1);
    const snap = buildSnapshot({
      agents: collected.value,
      surfaces: [],
      archiveStore,
      now: new Date(NOW),
    });
    const published = snap.programs.flatMap((program) => program.agents)[0];
    expect(published?.target.kind).toBe("grok-bot");
    expect(published?.target.resolution).toBe("gateway");
    expect(published?.target.attestation).toBeUndefined();
    expect(published?.target.surfaceId).toBeUndefined();
    expect(published?.target.gatewayMiss).toBeUndefined();
    expect(published?.controlState).toBe("linked");
    expect(published?.controls.find((control) => control.action === "instruct")?.enabled).toBe(true);
    expect(published?.processState).toBe("unknown");
    expect(JSON.stringify(snap)).not.toMatch(/token-snap/);
    expect(JSON.stringify(published?.target)).not.toContain("token");
  });
});

describe("composer and dock copy", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let presentation: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let agentModel: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let M: any;

  beforeAll(async () => {
    // @ts-expect-error the dependency-free browser client has no declaration file
    presentation = await import("../src/web/presentation.js");
    // @ts-expect-error same, no declaration file
    agentModel = await import("../src/web/agent-model.js");
    // @ts-expect-error same, no declaration file
    await import("../src/web/app.js");
    M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
  });

  test("missing-gateway dock copy names token-miss vs unreachable-box vs probe-fail", () => {
    const base = {
      id: `grok:bot:${ROSTER_ID}`,
      controlState: "observed-only",
    };
    const unreachable = {
      ...base,
      target: botTarget({ gatewayReady: false, resolution: "missing", gatewayMiss: "unreachable-box" }),
    };
    const noToken = {
      ...base,
      target: botTarget({ gatewayReady: false, resolution: "missing", gatewayMiss: "no-token" }),
    };
    const probe = {
      ...base,
      target: botTarget({ gatewayReady: false, resolution: "missing", gatewayMiss: "probe-rejected" }),
    };
    expect(presentation.controlUnavailableText("observed-only", unreachable)).toMatch(/unreachable from this Mac/i);
    expect(presentation.controlUnavailableText("observed-only", noToken)).toMatch(/no gateway token is on this instance's box/i);
    expect(presentation.controlUnavailableText("observed-only", probe)).toMatch(/rejected the probe/i);
    expect(presentation.identityCause({ steps: [{ tier: "gateway" }] }, unreachable)).toBe("unreachable-box");
    expect(presentation.identityCause({ steps: [{ tier: "gateway" }] }, noToken)).toBe("gateway-no-token");
    expect(presentation.identityCause({ steps: [{ tier: "gateway" }] }, probe)).toBe("gateway-probe-rejected");
    expect(presentation.IDENTITY_CAUSES["unreachable-box"].next).toMatch(/no attested local forward/i);
    expect(presentation.IDENTITY_CAUSES["gateway-no-token"].next).toMatch(/no token Formic can use/i);
    expect(presentation.IDENTITY_CAUSES["gateway-probe-rejected"].next).toMatch(/listAgents did not succeed/i);
    for (const key of ["unreachable-box", "gateway-no-token", "gateway-probe-rejected"]) {
      const entry = presentation.IDENTITY_CAUSES[key];
      expect(`${entry.why} ${entry.next}`).not.toMatch(/cmux pane/i);
      expect(`${entry.why} ${entry.next}`).not.toMatch(/Application Support/i);
    }
    expect(presentation.controlUnavailableText("observed-only")).toContain("no safe cmux target");
  });

  test("a ready Bot target is linked; unknown process is not Process live", () => {
    const ready = snapshotBot({ processState: "unknown" });
    expect(agentModel.deriveControlState(ready)).toBe("linked");
    const view = agentModel.livenessView(ready);
    expect(view.label).toBe("Grok Bot has no process identity.");
    expect(view.label).not.toBe("Process live");
    expect(view.label).not.toBe("No matching process");
    expect(agentModel.LIVENESS_VIEW.unknown.label).toBe("No matching process");
  });

  test("the composer wire carries clientNonce and keeps it on the shared state object", () => {
    expect(M.state.instructNonces).toBeInstanceOf(Map);
    const source = [
      ...Object.values(M).filter((value) => typeof value === "function").map((value) => String(value)),
    ].join("\n");
    expect(String(M.sendControl)).toContain("clientNonce");
    expect(String(M.sendControl)).toContain("instructNonces");
    expect(source.length).toBeGreaterThan(0);
  });
});
