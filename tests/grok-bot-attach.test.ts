import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverProductionBoxAttach,
  ensureBoxGatewayAttach,
  isAllowedBoxIngress,
  parseLocalExecConnection,
  resetGrokBotAttachForTests,
  resolveSandDataRoot,
} from "../src/server/grok-bot-attach";
import { parseGatewayRecord, probeGrokBotGateway } from "../src/server/grok-bot-gateway";

afterEach(() => {
  resetGrokBotAttachForTests();
});

function listenFixture(
  handler: (reqUrl: string, headers: Record<string, string | string[] | undefined>) => {
    status: number;
    body: string;
  },
): Promise<{ server: Server; origin: string; saw: Array<{ url: string; headers: Record<string, string | string[] | undefined> }> }> {
  const saw: Array<{ url: string; headers: Record<string, string | string[] | undefined> }> = [];
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        saw.push({ url: req.url ?? "", headers: req.headers });
        const result = handler(req.url ?? "", req.headers);
        res.statusCode = result.status;
        res.setHeader("content-type", "application/json");
        res.end(result.body);
      });
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("fixture did not bind"));
        return;
      }
      resolve({ server, origin: `http://127.0.0.1:${address.port}`, saw });
    });
  });
}

describe("parseLocalExecConnection", () => {
  test("accepts a cursorvm :1340 ingress and keeps the token in memory only", () => {
    const parsed = parseLocalExecConnection(JSON.stringify({
      baseUrl: "https://pod-xyfgf22eafe3zpqtgipotqj4ee-1340.us9.cursorvm.com",
      token: "box-token-1",
      headers: { "x-anyrun-network-token": "net-1" },
    }));
    expect(parsed?.baseUrl).toBe("https://pod-xyfgf22eafe3zpqtgipotqj4ee-1340.us9.cursorvm.com");
    expect(parsed?.token).toBe("box-token-1");
    expect(parsed?.headers["x-anyrun-network-token"]).toBe("net-1");
  });

  test("rejects a non-1340 cursorvm host, a LAN url, and encrypted descriptor shape", () => {
    expect(parseLocalExecConnection(JSON.stringify({
      baseUrl: "https://pod-abc-6080.us9.cursorvm.com",
      token: "x",
    }))).toBeUndefined();
    expect(parseLocalExecConnection(JSON.stringify({
      baseUrl: "http://10.0.0.8:1340",
      token: "x",
    }))).toBeUndefined();
    expect(parseLocalExecConnection(JSON.stringify({
      version: 1,
      accountScope: "abc",
      encrypted: "djEw",
    }))).toBeUndefined();
  });

  test("allows loopback fixture origins", () => {
    expect(isAllowedBoxIngress("http://127.0.0.1:19284")).toBe(true);
    expect(isAllowedBoxIngress("http://[::1]:19284")).toBe(true);
    expect(isAllowedBoxIngress("https://example.com")).toBe(false);
  });
});

describe("resolveSandDataRoot", () => {
  test("first Grok Bot home falls back to ~/.grokbot; Grok Bot 2 uses its own sand-data", () => {
    const tmp = mkdtempSync(join(tmpdir(), "anthill-bot-homes-"));
    const bot1 = join(tmp, "Grok Bot");
    const bot2 = join(tmp, "Grok Bot 2");
    const grokbot = join(tmp, ".grokbot");
    mkdirSync(bot1);
    mkdirSync(join(bot2, "sand-data"), { recursive: true });
    mkdirSync(grokbot);
    writeFileSync(join(grokbot, "local-exec-daemon-connection.json"), "{}");
    writeFileSync(join(bot2, "sand-data", "local-exec-daemon-connection.json"), "{}");
    expect(resolveSandDataRoot(bot1, tmp)).toBe(grokbot);
    expect(resolveSandDataRoot(bot2, tmp)).toBe(join(bot2, "sand-data"));
  });

  test("Grok Bot 2 never inherits ~/.grokbot", () => {
    const tmp = mkdtempSync(join(tmpdir(), "anthill-bot-no-share-"));
    const bot2 = join(tmp, "Grok Bot 2");
    mkdirSync(bot2);
    mkdirSync(join(tmp, ".grokbot"));
    writeFileSync(join(tmp, ".grokbot", "local-exec-daemon-connection.json"), "{}");
    expect(resolveSandDataRoot(bot2, tmp)).toBeUndefined();
  });
});

describe("ensureBoxGatewayAttach", () => {
  test("binds loopback and forwards listAgents with injected headers", async () => {
    const fixture = await listenFixture((_url, headers) => {
      if (headers.authorization !== "Bearer box-token-1") {
        return { status: 401, body: "{\"error\":\"no\"}" };
      }
      if (headers["x-anyrun-network-token"] !== "net-1") {
        return { status: 403, body: "{\"error\":\"net\"}" };
      }
      return { status: 200, body: "{\"agents\":[]}" };
    });
    try {
      const bot2 = mkdtempSync(join(tmpdir(), "anthill-bot2-"));
      mkdirSync(join(bot2, "sand-data"), { recursive: true });
      writeFileSync(join(bot2, "sand-data", "local-exec-daemon-connection.json"), JSON.stringify({
        baseUrl: fixture.origin,
        token: "box-token-1",
        headers: { "x-anyrun-network-token": "net-1" },
      }));
      const attach = await ensureBoxGatewayAttach("grok-bot:grok-bot-2", bot2);
      expect(attach).toBeDefined();
      expect(attach!.loopbackOrigin.startsWith("http://127.0.0.1:")).toBe(true);
      expect(attach!.loopbackOrigin).not.toBe(fixture.origin);
      const raw = attach!.readBoxGatewayJson();
      const record = JSON.parse(raw!) as { token: string; host: string };
      expect(record.token).toBe("box-token-1");
      expect(record.host).toBe("127.0.0.1");
      const creds = parseGatewayRecord(raw, attach!.loopbackOrigin);
      expect(creds?.url).toBe(attach!.loopbackOrigin);
      expect(await probeGrokBotGateway(creds!)).toBe(true);
      expect(fixture.saw.some((entry) => entry.url === "/api/listAgents")).toBe(true);
      expect(fixture.saw[0]?.headers["x-anyrun-network-token"]).toBe("net-1");
    } finally {
      fixture.server.close();
    }
  });

  test("a second instance gets its own port and token", async () => {
    const boxA = await listenFixture(() => ({ status: 200, body: "{\"agents\":[]}" }));
    const boxB = await listenFixture(() => ({ status: 200, body: "{\"agents\":[]}" }));
    try {
      const homeA = mkdtempSync(join(tmpdir(), "anthill-bot-a-"));
      const homeB = join(mkdtempSync(join(tmpdir(), "anthill-wrap-")), "Grok Bot 2");
      mkdirSync(join(homeA, "sand-data"), { recursive: true });
      mkdirSync(join(homeB, "sand-data"), { recursive: true });
      writeFileSync(join(homeA, "sand-data", "local-exec-daemon-connection.json"), JSON.stringify({
        baseUrl: boxA.origin,
        token: "token-a",
      }));
      writeFileSync(join(homeB, "sand-data", "local-exec-daemon-connection.json"), JSON.stringify({
        baseUrl: boxB.origin,
        token: "token-b",
      }));
      const attachA = await ensureBoxGatewayAttach("grok-bot:grok-bot", homeA);
      const attachB = await ensureBoxGatewayAttach("grok-bot:grok-bot-2", homeB);
      expect(attachA?.loopbackOrigin).not.toBe(attachB?.loopbackOrigin);
      expect(JSON.parse(attachA!.readBoxGatewayJson()!).token).toBe("token-a");
      expect(JSON.parse(attachB!.readBoxGatewayJson()!).token).toBe("token-b");
    } finally {
      boxA.server.close();
      boxB.server.close();
    }
  });

  test("a request without the instance Bearer never reaches the box", async () => {
    const fixture = await listenFixture(() => ({ status: 200, body: "{\"agents\":[]}" }));
    try {
      const home = mkdtempSync(join(tmpdir(), "anthill-bot-lock-"));
      mkdirSync(join(home, "sand-data"), { recursive: true });
      writeFileSync(join(home, "sand-data", "local-exec-daemon-connection.json"), JSON.stringify({
        baseUrl: fixture.origin,
        token: "box-token-1",
        headers: { "x-anyrun-network-token": "net-1" },
      }));
      const attach = await ensureBoxGatewayAttach("grok-bot:grok-bot", home);
      expect(attach).toBeDefined();
      const denied = await fetch(`${attach!.loopbackOrigin}/api/listAgents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(denied.status).toBe(401);
      const other = await fetch(`${attach!.loopbackOrigin}/api/other`, { method: "POST", body: "{}" });
      expect(other.status).toBe(404);
      expect(fixture.saw).toEqual([]);
    } finally {
      fixture.server.close();
    }
  });

  test("gateway-descriptor.json in the Mac home does not attach", async () => {
    const home = mkdtempSync(join(tmpdir(), "anthill-bot-desc-"));
    writeFileSync(join(home, "gateway-descriptor.json"), JSON.stringify({
      version: 1,
      accountScope: "x",
      encrypted: "djEw",
      savedAtMs: 1,
    }));
    expect(await ensureBoxGatewayAttach("grok-bot:grok-bot", home)).toBeUndefined();
    expect(discoverProductionBoxAttach("grok-bot:grok-bot")).toBeUndefined();
  });
});
