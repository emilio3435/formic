import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { homedir as osHomedir } from "node:os";
import { basename, join } from "node:path";

const CONNECTION_FILE = "local-exec-daemon-connection.json";
const CURSORVM_GATEWAY_HOST = /^.+-1340\.[^.]+\.cursorvm\.com$/i;
const FORWARDED_PATHS = new Set(["/api/listAgents", "/api/sendPrompt"]);

export interface LocalExecConnection {
  baseUrl: string;
  token: string;
  headers: Record<string, string>;
}

export interface BoxLoopbackAttach {
  instanceId: string;
  loopbackOrigin: string;
  readBoxGatewayJson(): string | undefined;
}

interface LiveProxy {
  origin: string;
  port: number;
  token: string;
  connectionKey: string;
  server: Server;
}

const instanceHomes = new Map<string, string>();
const liveProxies = new Map<string, LiveProxy>();
const pendingStarts = new Map<string, Promise<BoxLoopbackAttach | undefined>>();

export function rememberGrokBotInstanceHome(instanceId: string, home: string): void {
  if (instanceId && home) instanceHomes.set(instanceId, home);
}

export function grokBotInstanceHome(instanceId: string): string | undefined {
  return instanceId ? instanceHomes.get(instanceId) : undefined;
}

export function isAllowedBoxIngress(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (host === "127.0.0.1" || host === "::1") return true;
    return parsed.protocol === "https:" && CURSORVM_GATEWAY_HOST.test(host);
  } catch {
    return false;
  }
}

export function parseLocalExecConnection(raw: string): LocalExecConnection | undefined {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const record = data as Record<string, unknown>;
  const baseUrl = typeof record.baseUrl === "string" ? record.baseUrl.trim().replace(/\/+$/, "") : "";
  const token = typeof record.token === "string" ? record.token.trim() : "";
  if (!baseUrl || !token || !isAllowedBoxIngress(baseUrl)) return undefined;
  const headers: Record<string, string> = {};
  if (record.headers && typeof record.headers === "object" && !Array.isArray(record.headers)) {
    for (const [key, value] of Object.entries(record.headers as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) headers[key] = value;
    }
  }
  return { baseUrl, token, headers };
}

export function resolveSandDataRoot(home: string, homedir = osHomedir()): string | undefined {
  if (!home) return undefined;
  const nested = join(home, "sand-data");
  if (existsSync(join(nested, CONNECTION_FILE))) return nested;
  if (existsSync(join(home, CONNECTION_FILE))) return home;
  if (basename(home) === "Grok Bot" && existsSync(join(homedir, ".grokbot", CONNECTION_FILE))) {
    return join(homedir, ".grokbot");
  }
  return undefined;
}

function readConnectionForHome(home: string, homedir?: string): LocalExecConnection | undefined {
  const sand = resolveSandDataRoot(home, homedir);
  if (!sand) return undefined;
  try {
    return parseLocalExecConnection(readFileSync(join(sand, CONNECTION_FILE), "utf8"));
  } catch {
    return undefined;
  }
}

function connectionKey(connection: LocalExecConnection): string {
  return `${connection.baseUrl}\0${connection.token}`;
}

async function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function startProxy(connection: LocalExecConnection): Promise<LiveProxy> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      void forwardToBox(connection, req, res);
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("loopback proxy did not bind a port"));
        return;
      }
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        port: address.port,
        token: connection.token,
        connectionKey: connectionKey(connection),
        server,
      });
    });
  });
}

function requestPath(url: string | undefined): string {
  const raw = url && url.length > 0 ? url : "/";
  try {
    return new URL(raw, "http://127.0.0.1").pathname;
  } catch {
    return raw.split("?")[0] ?? "/";
  }
}

async function forwardToBox(
  connection: LocalExecConnection,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const path = requestPath(req.url);
  if (!FORWARDED_PATHS.has(path)) {
    res.statusCode = 404;
    res.end();
    return;
  }
  if (req.headers.authorization !== `Bearer ${connection.token}`) {
    res.statusCode = 401;
    res.end();
    return;
  }
  try {
    const target = new URL(path, `${connection.baseUrl}/`);
    const headers: Record<string, string> = {
      ...connection.headers,
      authorization: `Bearer ${connection.token}`,
    };
    if (typeof req.headers["content-type"] === "string") {
      headers["content-type"] = req.headers["content-type"];
    }
    const method = req.method ?? "GET";
    const payload = method === "GET" || method === "HEAD" ? undefined : await readRequestBody(req);
    const response = await fetch(target, {
      method,
      headers,
      body: payload ? new Uint8Array(payload) : undefined,
      redirect: "manual",
    });
    res.statusCode = response.status;
    const contentType = response.headers.get("content-type");
    if (contentType) res.setHeader("content-type", contentType);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.statusCode = 502;
    res.end();
  }
}

function attachFromProxy(instanceId: string, proxy: LiveProxy): BoxLoopbackAttach {
  return {
    instanceId,
    loopbackOrigin: proxy.origin,
    readBoxGatewayJson: () => JSON.stringify({
      token: proxy.token,
      host: "127.0.0.1",
      port: proxy.port,
    }),
  };
}

export async function ensureBoxGatewayAttach(
  instanceId: string,
  home: string,
  opts: { homedir?: string } = {},
): Promise<BoxLoopbackAttach | undefined> {
  if (!instanceId || !home) return undefined;
  rememberGrokBotInstanceHome(instanceId, home);
  const connection = readConnectionForHome(home, opts.homedir);
  if (!connection) return undefined;
  const existing = liveProxies.get(instanceId);
  if (existing && existing.connectionKey === connectionKey(connection)) {
    return attachFromProxy(instanceId, existing);
  }
  const inflight = pendingStarts.get(instanceId);
  if (inflight) return inflight;
  const start = (async () => {
    const stale = liveProxies.get(instanceId);
    if (stale) {
      stale.server.close();
      liveProxies.delete(instanceId);
    }
    try {
      const proxy = await startProxy(connection);
      liveProxies.set(instanceId, proxy);
      return attachFromProxy(instanceId, proxy);
    } catch {
      return undefined;
    } finally {
      pendingStarts.delete(instanceId);
    }
  })();
  pendingStarts.set(instanceId, start);
  return start;
}

export function discoverProductionBoxAttach(instanceId: string): BoxLoopbackAttach | undefined {
  if (!instanceId) return undefined;
  const existing = liveProxies.get(instanceId);
  if (existing) return attachFromProxy(instanceId, existing);
  return undefined;
}

export function resetGrokBotAttachForTests(): void {
  instanceHomes.clear();
  pendingStarts.clear();
  for (const proxy of liveProxies.values()) {
    proxy.server.close();
  }
  liveProxies.clear();
}
