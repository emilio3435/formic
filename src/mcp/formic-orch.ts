import { join } from "node:path";
import { readFormicOrchToken } from "../server/orch";
import { isLoopbackOrigin, isOrchLaunchCommand, type OrchFetch } from "../shared/orch";

export type OrchMcpEnv = NodeJS.ProcessEnv;

interface JsonRpc {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

function rpcResult(id: string | number | null | undefined, result: unknown): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result })}\n`;
}

function rpcError(id: string | number | null | undefined, message: string): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code: -32000, message } })}\n`;
}

function toolText(obj: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(obj) }] };
}

function defaultRoot(env: OrchMcpEnv): string {
  if (env.FORMIC_ROOT?.trim()) return env.FORMIC_ROOT.trim();
  return join(import.meta.dir, "..", "..");
}

function resolveUrl(env: OrchMcpEnv): string {
  const url = (env.FORMIC_URL ?? "http://127.0.0.1:4701").replace(/\/+$/, "");
  if (!isLoopbackOrigin(url)) throw new Error("FORMIC_URL must be loopback.");
  return url;
}

function resolveToken(env: OrchMcpEnv): string {
  if (env.FORMIC_ORCH_TOKEN?.trim()) return env.FORMIC_ORCH_TOKEN.trim();
  const token = readFormicOrchToken(defaultRoot(env));
  if (!token) throw new Error("FORMIC_ORCH_TOKEN is not set.");
  return token;
}

async function orchFetch(
  env: OrchMcpEnv,
  fetchImpl: OrchFetch,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const url = resolveUrl(env);
  const token = resolveToken(env);
  const response = await fetchImpl(`${url}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  return response.json();
}

const TOOLS = [
  {
    name: "formic_fleet",
    description: "List Formic agents and cmux workspaces. Attested readiness only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "formic_peek",
    description: "Attested briefing cards: goal, last reply, attention, context %. Snapshot projection, not a transcript.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        agentId: { type: "string" },
      },
    },
  },
  {
    name: "formic_send",
    description: "Instruct one Formic agent id. Same write gate as the board composer.",
    inputSchema: {
      type: "object",
      required: ["agentId", "instruction"],
      additionalProperties: false,
      properties: {
        agentId: { type: "string" },
        instruction: { type: "string" },
        clientNonce: { type: "string" },
      },
    },
  },
  {
    name: "formic_launch",
    description: "Launch an allowlisted cmux workspace (codex, claude, or grok).",
    inputSchema: {
      type: "object",
      required: ["cwd", "command"],
      additionalProperties: false,
      properties: {
        cwd: { type: "string" },
        command: { type: "string", enum: ["codex", "claude", "grok"] },
        title: { type: "string" },
      },
    },
  },
];

export async function handleOrchMcpMessage(
  raw: JsonRpc,
  env: OrchMcpEnv = process.env,
  fetchImpl: OrchFetch = fetch,
): Promise<string> {
  const id = raw.id ?? null;
  const method = raw.method ?? "";
  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "formic-orch", version: "0.1.0" },
    });
  }
  if (method === "notifications/initialized") return "";
  if (method === "tools/list") {
    return rpcResult(id, { tools: TOOLS });
  }
  if (method !== "tools/call") {
    return rpcError(id, `Unknown method: ${method}`);
  }
  const params = raw.params && typeof raw.params === "object" ? raw.params as {
    name?: string;
    arguments?: Record<string, unknown>;
  } : {};
  const name = params.name ?? "";
  const args = params.arguments ?? {};
  try {
    if (name === "formic_fleet") {
      if (Object.keys(args).length > 0) return rpcError(id, "formic_fleet takes no arguments.");
      return rpcResult(id, toolText(await orchFetch(env, fetchImpl, "/api/orch/fleet")));
    }
    if (name === "formic_peek") {
      const extra = Object.keys(args).filter((key) => key !== "agentId");
      if (extra.length > 0) return rpcError(id, "Unsupported formic_peek field.");
      const agentId = typeof args.agentId === "string" ? args.agentId.trim() : "";
      const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : "";
      return rpcResult(id, toolText(await orchFetch(env, fetchImpl, `/api/orch/peek${query}`)));
    }
    if (name === "formic_send") {
      const extra = Object.keys(args).filter((key) => !["agentId", "instruction", "clientNonce"].includes(key));
      if (extra.length > 0) return rpcError(id, "Unsupported formic_send field.");
      const agentId = typeof args.agentId === "string" ? args.agentId : "";
      const instruction = typeof args.instruction === "string" ? args.instruction : "";
      if (!agentId || !instruction.trim()) return rpcError(id, "agentId and instruction are required.");
      if (/[\r\n]/.test(instruction)) return rpcError(id, "instruction must be a single line.");
      return rpcResult(id, toolText(await orchFetch(env, fetchImpl, "/api/orch/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId,
          instruction,
          ...(typeof args.clientNonce === "string" ? { clientNonce: args.clientNonce } : {}),
        }),
      })));
    }
    if (name === "formic_launch") {
      const extra = Object.keys(args).filter((key) => !["cwd", "command", "title"].includes(key));
      if (extra.length > 0) return rpcError(id, "Unsupported formic_launch field.");
      const cwd = typeof args.cwd === "string" ? args.cwd : "";
      const command = typeof args.command === "string" ? args.command : "";
      if (!cwd || !isOrchLaunchCommand(command)) {
        return rpcError(id, "command must be codex, claude, or grok.");
      }
      return rpcResult(id, toolText(await orchFetch(env, fetchImpl, "/api/orch/launch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cwd,
          command,
          ...(typeof args.title === "string" ? { title: args.title } : {}),
        }),
      })));
    }
    return rpcError(id, `Unknown tool: ${name}`);
  } catch (error) {
    return rpcError(id, error instanceof Error ? error.message : String(error));
  }
}

const invoked = process.argv[1]?.includes("formic-orch.ts");
if (invoked && import.meta.main) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk);
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let parsed: JsonRpc;
      try {
        parsed = JSON.parse(line) as JsonRpc;
      } catch {
        process.stdout.write(rpcError(null, "Invalid JSON."));
        continue;
      }
      const out = await handleOrchMcpMessage(parsed);
      if (out) process.stdout.write(out);
    }
  }
}
