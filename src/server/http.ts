import type { ControlRequest, HubSnapshot } from "../shared/types";
import { CONTROL_ACTIONS, executeControl, type ControlDependencies } from "./control";

export const MAX_CONTROL_BODY_BYTES = 16_384;
export const MAX_INSTRUCTION_BYTES = 8_192;

export interface ControlHttpDependencies extends ControlDependencies {
  getSnapshot(): HubSnapshot;
  afterControl?(agentIds?: readonly string[]): void | Promise<void>;
}

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

function requestError(status: number, code: string, message: string): Response {
  return json({ ok: false, error: { code, message } }, status);
}

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

function parseControlRequest(value: unknown): ControlRequest | string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Body must be a JSON object.";
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => !["action", "agentId", "instruction"].includes(key))) {
    return "Body contains an unsupported field.";
  }
  if (typeof record.action !== "string" || !CONTROL_ACTIONS.includes(record.action as ControlRequest["action"])) {
    return "action must be focus, instruct, interrupt, or archive.";
  }
  if (typeof record.agentId !== "string" || !record.agentId.trim() || record.agentId.length > 300) {
    return "agentId must be a non-empty string no longer than 300 characters.";
  }
  if (record.action === "instruct") {
    if (typeof record.instruction !== "string" || !record.instruction.trim()) {
      return "instruction is required for instruct.";
    }
    if (new TextEncoder().encode(record.instruction).byteLength > MAX_INSTRUCTION_BYTES) {
      return `instruction exceeds ${MAX_INSTRUCTION_BYTES} bytes.`;
    }
  } else if (record.instruction !== undefined) {
    return "instruction is only valid for instruct.";
  }
  return {
    action: record.action as ControlRequest["action"],
    agentId: record.agentId,
    instruction: record.instruction as string | undefined,
  };
}

export async function handleControlRequest(
  request: Request,
  dependencies: ControlHttpDependencies,
): Promise<Response> {
  if (request.method !== "POST") return requestError(405, "METHOD_NOT_ALLOWED", "Use POST for controls.");
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (!isLoopback(url.hostname) || !origin || origin !== url.origin) {
    return requestError(403, "ORIGIN_REJECTED", "Control requests require an exact same-origin loopback Origin header.");
  }
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    return requestError(415, "CONTENT_TYPE_REJECTED", "Control requests require application/json.");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CONTROL_BODY_BYTES) {
    return requestError(413, "BODY_TOO_LARGE", `Control body exceeds ${MAX_CONTROL_BODY_BYTES} bytes.`);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_CONTROL_BODY_BYTES) {
    return requestError(413, "BODY_TOO_LARGE", `Control body exceeds ${MAX_CONTROL_BODY_BYTES} bytes.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return requestError(400, "INVALID_JSON", "Control body is not valid JSON.");
  }
  const parsed = parseControlRequest(raw);
  if (typeof parsed === "string") return requestError(400, "INVALID_CONTROL_REQUEST", parsed);

  const snapshot = dependencies.getSnapshot();
  const agent = snapshot.programs.flatMap((program) => program.agents).find((candidate) => candidate.id === parsed.agentId);
  if (!agent) return requestError(404, "AGENT_NOT_FOUND", "The agent is not present in the current snapshot.");
  const execution = await executeControl(parsed, agent, dependencies);
  if (execution.response.ok) await dependencies.afterControl?.([agent.id]);
  return json(execution.response, execution.status);
}
