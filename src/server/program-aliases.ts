import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { HubSnapshot, PresentationLabelTarget } from "../shared/types";

const MAX_LABEL_BODY_BYTES = 2_048;
const MAX_LABEL_LENGTH = 80;
const LABEL_KEY_PATTERN = /^(program|workspace|room|agent):.+$/;

export interface ProgramAliasStore {
  all(): Readonly<Record<string, string>>;
  set(key: string, label?: string): Promise<void>;
}

export interface ProgramAliasFileOperations {
  readText(path: string): Promise<string>;
  makeDirectory(path: string): Promise<void>;
  writeText(path: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

const nodeFiles: ProgramAliasFileOperations = {
  readText: (path) => readFile(path, "utf8"),
  makeDirectory: async (path) => { await mkdir(path, { recursive: true }); },
  writeText: async (path, contents) => { await writeFile(path, contents, "utf8"); },
  rename,
};

export function presentationLabelKey(target: PresentationLabelTarget): string {
  switch (target.kind) {
    case "program": return `program:${target.programId}`;
    case "workspace": return `workspace:${target.workspaceId}`;
    case "room": return `room:${target.surfaceId}`;
    case "agent": return `agent:${target.agentId}`;
  }
}

function storedKey(key: string): string {
  return LABEL_KEY_PATTERN.test(key) ? key : `program:${key}`;
}

export class JsonProgramAliasStore implements ProgramAliasStore {
  readonly #labels = new Map<string, string>();
  #writeQueue: Promise<void> = Promise.resolve();
  #writeNumber = 0;

  private constructor(
    private readonly path: string,
    private readonly files: ProgramAliasFileOperations,
  ) {}

  static async open(path: string, files: ProgramAliasFileOperations = nodeFiles): Promise<JsonProgramAliasStore> {
    const store = new JsonProgramAliasStore(path, files);
    try {
      const parsed: unknown = JSON.parse(await files.readText(path));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("presentation labels must be an object");
      }
      for (const [rawKey, label] of Object.entries(parsed)) {
        const key = storedKey(rawKey);
        if (!LABEL_KEY_PATTERN.test(key) || key !== key.trim() || typeof label !== "string" ||
            label !== label.trim() || !label || label.length > MAX_LABEL_LENGTH) {
          throw new Error("presentation labels contain an invalid entry");
        }
        store.#labels.set(key, label);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return store;
  }

  all(): Readonly<Record<string, string>> {
    return Object.fromEntries([...this.#labels.entries()].sort(([left], [right]) => left.localeCompare(right)));
  }

  set(key: string, label?: string): Promise<void> {
    const normalizedKey = storedKey(key);
    const write = this.#writeQueue.then(() => this.#persist(normalizedKey, label));
    this.#writeQueue = write.catch(() => {});
    return write;
  }

  async #persist(key: string, label?: string): Promise<void> {
    const next = new Map(this.#labels);
    if (label) next.set(key, label);
    else next.delete(key);
    await this.files.makeDirectory(dirname(this.path));
    this.#writeNumber += 1;
    const temporary = `${this.path}.${process.pid}.${this.#writeNumber}.tmp`;
    const contents = Object.fromEntries([...next.entries()].sort(([left], [right]) => left.localeCompare(right)));
    await this.files.writeText(temporary, `${JSON.stringify(contents, null, 2)}\n`);
    await this.files.rename(temporary, this.path);
    this.#labels.clear();
    for (const [id, value] of next) this.#labels.set(id, value);
  }
}

function response(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

function error(status: number, code: string, message: string): Response {
  return response({ ok: false, error: { code, message } }, status);
}

function isLoopback(request: Request): boolean {
  return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(request.url).hostname);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseTarget(raw: unknown): PresentationLabelTarget | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.kind === "program" && exactKeys(value, ["kind", "programId"]) && nonEmptyString(value.programId)) {
    return { kind: "program", programId: value.programId };
  }
  if (value.kind === "workspace" && exactKeys(value, ["kind", "workspaceId"]) && nonEmptyString(value.workspaceId)) {
    return { kind: "workspace", workspaceId: value.workspaceId };
  }
  if (value.kind === "room" && exactKeys(value, ["kind", "surfaceId"]) && nonEmptyString(value.surfaceId)) {
    return { kind: "room", surfaceId: value.surfaceId };
  }
  if (value.kind === "agent" && exactKeys(value, ["kind", "agentId"]) && nonEmptyString(value.agentId)) {
    return { kind: "agent", agentId: value.agentId };
  }
  return null;
}

function allAgents(snapshot: HubSnapshot) {
  return snapshot.programs.flatMap((program) => program.agents);
}

function targetExists(target: PresentationLabelTarget, snapshot: HubSnapshot): boolean {
  const agents = allAgents(snapshot);
  switch (target.kind) {
    case "program":
      return snapshot.programs.some((program) => program.id === target.programId);
    case "workspace":
      return agents.some((agent) => agent.target.workspaceId === target.workspaceId);
    case "room":
      return agents.some((agent) => agent.target.surfaceId === target.surfaceId);
    case "agent": {
      const agent = agents.find((candidate) => candidate.id === target.agentId);
      return Boolean(agent?.parentAgentId && !agent.nickname);
    }
  }
}

function targetNotFound(target: PresentationLabelTarget): [string, string] {
  switch (target.kind) {
    case "program": return ["PROGRAM_NOT_FOUND", "The program is not present in the current snapshot."];
    case "workspace": return ["WORKSPACE_NOT_FOUND", "The workspace is not present in the current snapshot."];
    case "room": return ["ROOM_NOT_FOUND", "The room is not present in the current snapshot."];
    case "agent": return ["AGENT_NOT_ELIGIBLE", "The agent is not an unnamed child in the current snapshot."];
  }
}

export async function handleProgramAliasRequest(
  request: Request,
  snapshot: HubSnapshot,
  store: ProgramAliasStore,
): Promise<Response> {
  if (!isLoopback(request)) return error(403, "ORIGIN_REJECTED", "Presentation labels are only available on loopback.");
  if (request.method === "GET") return response({ ok: true, labels: store.all() });
  if (request.method !== "POST") return error(405, "METHOD_NOT_ALLOWED", "Use GET or POST for presentation labels.");
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin) {
    return error(403, "ORIGIN_REJECTED", "Label changes require an exact same-origin loopback Origin header.");
  }
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return error(415, "CONTENT_TYPE_REJECTED", "Label changes require application/json.");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_LABEL_BODY_BYTES) {
    return error(413, "BODY_TOO_LARGE", `Label body exceeds ${MAX_LABEL_BODY_BYTES} bytes.`);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_LABEL_BODY_BYTES) {
    return error(413, "BODY_TOO_LARGE", `Label body exceeds ${MAX_LABEL_BODY_BYTES} bytes.`);
  }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return error(400, "INVALID_JSON", "Label body is not valid JSON."); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return error(400, "INVALID_LABEL_REQUEST", "Body must be a JSON object.");
  }
  const value = raw as Record<string, unknown>;
  let target: PresentationLabelTarget | null = null;
  let rawLabel: unknown;
  if (exactKeys(value, ["target", "label"])) {
    target = parseTarget(value.target);
    rawLabel = value.label;
  } else if (exactKeys(value, ["programId", "alias"])) {
    target = typeof value.programId === "string" && value.programId.length > 0
      ? { kind: "program", programId: value.programId }
      : null;
    rawLabel = value.alias;
  } else {
    return error(400, "INVALID_LABEL_REQUEST", "Body must contain exactly target and label.");
  }
  if (!target) return error(400, "INVALID_LABEL_TARGET", "target must identify a supported presentation label target.");
  if (!targetExists(target, snapshot)) {
    const [code, message] = targetNotFound(target);
    return error(404, code, message);
  }
  if (typeof rawLabel !== "string") return error(400, "INVALID_LABEL_REQUEST", "label must be a string.");
  const label = rawLabel.trim();
  if (label.length > MAX_LABEL_LENGTH) {
    return error(400, "INVALID_LABEL_REQUEST", `label must be no longer than ${MAX_LABEL_LENGTH} characters.`);
  }
  try {
    await store.set(presentationLabelKey(target), label || undefined);
  } catch (cause) {
    return error(500, "LABEL_WRITE_FAILED", `Could not persist presentation label: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  return response({ ok: true, target, label: label || null, reset: !label, labels: store.all() });
}
