import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { HubSnapshot } from "../shared/types";

const MAX_ALIAS_BODY_BYTES = 2_048;

export interface ProgramAliasStore {
  all(): Readonly<Record<string, string>>;
  set(programId: string, alias?: string): Promise<void>;
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

export class JsonProgramAliasStore implements ProgramAliasStore {
  readonly #aliases = new Map<string, string>();
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
        throw new Error("program aliases must be an object");
      }
      for (const [programId, alias] of Object.entries(parsed)) {
        if (!programId || typeof alias !== "string" || alias !== alias.trim() || !alias || alias.length > 80) {
          throw new Error("program aliases contain an invalid entry");
        }
        store.#aliases.set(programId, alias);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return store;
  }

  all(): Readonly<Record<string, string>> {
    return Object.fromEntries([...this.#aliases.entries()].sort(([left], [right]) => left.localeCompare(right)));
  }

  set(programId: string, alias?: string): Promise<void> {
    const write = this.#writeQueue.then(() => this.#persist(programId, alias));
    this.#writeQueue = write.catch(() => {});
    return write;
  }

  async #persist(programId: string, alias?: string): Promise<void> {
    const next = new Map(this.#aliases);
    if (alias) next.set(programId, alias);
    else next.delete(programId);
    await this.files.makeDirectory(dirname(this.path));
    this.#writeNumber += 1;
    const temporary = `${this.path}.${process.pid}.${this.#writeNumber}.tmp`;
    const contents = Object.fromEntries([...next.entries()].sort(([left], [right]) => left.localeCompare(right)));
    await this.files.writeText(temporary, `${JSON.stringify(contents, null, 2)}\n`);
    await this.files.rename(temporary, this.path);
    this.#aliases.clear();
    for (const [id, value] of next) this.#aliases.set(id, value);
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

export async function handleProgramAliasRequest(
  request: Request,
  snapshot: HubSnapshot,
  store: ProgramAliasStore,
): Promise<Response> {
  if (!isLoopback(request)) return error(403, "ORIGIN_REJECTED", "Program aliases are only available on loopback.");
  if (request.method === "GET") return response({ ok: true, aliases: store.all() });
  if (request.method !== "POST") return error(405, "METHOD_NOT_ALLOWED", "Use GET or POST for program aliases.");
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin) {
    return error(403, "ORIGIN_REJECTED", "Program alias changes require an exact same-origin loopback Origin header.");
  }
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return error(415, "CONTENT_TYPE_REJECTED", "Program alias changes require application/json.");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ALIAS_BODY_BYTES) {
    return error(413, "BODY_TOO_LARGE", `Program alias body exceeds ${MAX_ALIAS_BODY_BYTES} bytes.`);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_ALIAS_BODY_BYTES) {
    return error(413, "BODY_TOO_LARGE", `Program alias body exceeds ${MAX_ALIAS_BODY_BYTES} bytes.`);
  }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return error(400, "INVALID_JSON", "Program alias body is not valid JSON."); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return error(400, "INVALID_ALIAS_REQUEST", "Body must be a JSON object.");
  }
  const value = raw as Record<string, unknown>;
  const keys = Object.keys(value);
  if (keys.length !== 2 || keys.some((key) => !["programId", "alias"].includes(key))) {
    return error(400, "INVALID_ALIAS_REQUEST", "Body must contain exactly programId and alias.");
  }
  if (typeof value.programId !== "string" || !snapshot.programs.some((program) => program.id === value.programId)) {
    return error(404, "PROGRAM_NOT_FOUND", "The program is not present in the current snapshot.");
  }
  if (typeof value.alias !== "string") return error(400, "INVALID_ALIAS_REQUEST", "alias must be a string.");
  const alias = value.alias.trim();
  if (alias.length > 80) return error(400, "INVALID_ALIAS_REQUEST", "alias must be no longer than 80 characters.");
  try {
    await store.set(value.programId, alias || undefined);
  } catch (cause) {
    return error(500, "ALIAS_WRITE_FAILED", `Could not persist program alias: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  return response({ ok: true, programId: value.programId, alias: alias || null, aliases: store.all() });
}
