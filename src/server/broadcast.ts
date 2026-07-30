import type { BroadcastRequest, BroadcastResponse, HubSnapshot } from "../shared/types";
import { executeControl, type ControlDependencies } from "./control";
import {
  MAX_CONTROL_BODY_BYTES,
  MAX_CONTROL_SNAPSHOT_AGE_MS,
  MAX_INSTRUCTION_BYTES,
} from "./http";

export interface BroadcastDependencies extends ControlDependencies {
  getSnapshot(): HubSnapshot;
  afterControl?(agentIds?: readonly string[]): void | Promise<void>;
  now?(): number;
}

function response(value: unknown, status: number): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

function error(status: number, code: string, message: string): Response {
  return response({ ok: false, error: { code, message } }, status);
}

interface BroadcastParseError {
  code: "INVALID_BROADCAST_REQUEST" | "INVALID_INSTRUCTION";
  message: string;
}

function invalidRequest(message: string): BroadcastParseError {
  return { code: "INVALID_BROADCAST_REQUEST", message };
}

function parse(value: unknown): BroadcastRequest | BroadcastParseError {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalidRequest("Body must be a JSON object.");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 2 || keys.some((key) => !["agentIds", "instruction"].includes(key))) {
    return invalidRequest("Body must contain exactly agentIds and instruction.");
  }
  if (!Array.isArray(record.agentIds) || record.agentIds.length < 1 || record.agentIds.length > 50) {
    return invalidRequest("agentIds must contain between 1 and 50 unique agent IDs.");
  }
  if (record.agentIds.some((id) => typeof id !== "string" || !id.trim() || id.length > 300)) {
    return invalidRequest("Each agent ID must be a non-empty string no longer than 300 characters.");
  }
  const agentIds = record.agentIds as string[];
  if (new Set(agentIds).size !== agentIds.length) return invalidRequest("agentIds must not contain duplicates.");
  if (typeof record.instruction !== "string" || !record.instruction.trim()) return invalidRequest("instruction is required.");
  if (new TextEncoder().encode(record.instruction).byteLength > MAX_INSTRUCTION_BYTES) {
    return invalidRequest(`instruction exceeds ${MAX_INSTRUCTION_BYTES} bytes.`);
  }
  if (/[\r\n]/.test(record.instruction)) {
    return {
      code: "INVALID_INSTRUCTION",
      message: "instruction must not contain carriage returns or newlines.",
    };
  }
  return { agentIds, instruction: record.instruction };
}

export async function handleBroadcastRequest(request: Request, dependencies: BroadcastDependencies): Promise<Response> {
  if (request.method !== "POST") return error(405, "METHOD_NOT_ALLOWED", "Use POST for broadcasts.");
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !origin || origin !== url.origin) {
    return error(403, "ORIGIN_REJECTED", "Broadcast requests require an exact same-origin loopback Origin header.");
  }
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return error(415, "CONTENT_TYPE_REJECTED", "Broadcast requests require application/json.");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CONTROL_BODY_BYTES) {
    return error(413, "BODY_TOO_LARGE", `Broadcast body exceeds ${MAX_CONTROL_BODY_BYTES} bytes.`);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_CONTROL_BODY_BYTES) {
    return error(413, "BODY_TOO_LARGE", `Broadcast body exceeds ${MAX_CONTROL_BODY_BYTES} bytes.`);
  }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return error(400, "INVALID_JSON", "Broadcast body is not valid JSON."); }
  const parsed = parse(raw);
  if ("code" in parsed) return error(400, parsed.code, parsed.message);

  const snapshot = dependencies.getSnapshot();
  const generatedAt = Date.parse(snapshot.generatedAt);
  const ageMs = (dependencies.now?.() ?? Date.now()) - generatedAt;
  if (!Number.isFinite(generatedAt) || ageMs > MAX_CONTROL_SNAPSHOT_AGE_MS) {
    return response(
      {
        ok: false,
        error: {
          code: "STALE_SNAPSHOT",
          message: Number.isFinite(generatedAt)
            ? `Control routing evidence is ${Math.max(0, ageMs)}ms old; recollect before retrying.`
            : "Control routing evidence has an invalid timestamp; recollect before retrying.",
          ageMs: Number.isFinite(generatedAt) ? Math.max(0, ageMs) : null,
          maxAgeMs: MAX_CONTROL_SNAPSHOT_AGE_MS,
        },
      },
      409,
    );
  }

  const agents = new Map(snapshot.programs.flatMap((program) => program.agents).map((agent) => [agent.id, agent]));
  const results: BroadcastResponse["results"] = [];
  for (const agentId of parsed.agentIds) {
    const agent = agents.get(agentId);
    if (!agent) {
      results.push({ agentId, ok: false, error: { code: "AGENT_NOT_FOUND", message: "The agent is not present in the current snapshot." } });
      continue;
    }
    const execution = await executeControl({ action: "instruct", agentId, instruction: parsed.instruction }, agent, dependencies);
    results.push({ agentId, ok: execution.response.ok, error: execution.response.error });
  }
  const sent = results.filter((result) => result.ok).length;
  const failed = results.length - sent;
  if (sent > 0) await dependencies.afterControl?.(results.filter((result) => result.ok).map((result) => result.agentId));
  const body: BroadcastResponse = { ok: failed === 0, partial: sent > 0 && failed > 0, sent, failed, results };
  return response(body, failed === 0 ? 200 : sent > 0 ? 207 : 409);
}
