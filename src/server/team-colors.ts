import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeHex } from "../shared/repo-color";
import {
  isOperatorTeam,
  type CmuxTeam,
  type TeamTintSettings,
} from "../shared/team-tint";
import type { SettingsFileOperations } from "./settings";

const nodeFiles: SettingsFileOperations = {
  readText: (path) => readFile(path, "utf8"),
  makeDirectory: async (path) => {
    await mkdir(path, { recursive: true });
  },
  writeText: async (path, contents) => {
    await writeFile(path, contents, "utf8");
  },
  rename,
};

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

function requestError(status: number, code: string, message: string): Response {
  return json({ error: message, code }, status);
}

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

export function normalizeTeamTintSettings(value: unknown): TeamTintSettings {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const raw = record.assignments && typeof record.assignments === "object" && !Array.isArray(record.assignments)
    ? record.assignments as Record<string, unknown>
    : {};
  const assignments: TeamTintSettings["assignments"] = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const hex = normalizeHex(row.hex);
    if (!hex) continue;
    const groupId = typeof row.groupId === "string" && row.groupId ? row.groupId : key;
    assignments[key] = {
      groupId,
      hex,
      source: row.source === "user" ? "user" : "cmux",
    };
  }
  return { assignments };
}

export class JsonTeamColorsStore {
  #settings: TeamTintSettings;
  #writeQueue: Promise<void> = Promise.resolve();
  readonly #loadError?: string;

  private constructor(
    private readonly path: string,
    private readonly files: SettingsFileOperations,
    settings: TeamTintSettings,
    loadError?: string,
  ) {
    this.#settings = settings;
    this.#loadError = loadError;
  }

  static async open(path: string, files: SettingsFileOperations = nodeFiles): Promise<JsonTeamColorsStore> {
    let settings = normalizeTeamTintSettings(undefined);
    let loadError: string | undefined;
    try {
      settings = normalizeTeamTintSettings(JSON.parse(await files.readText(path)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        loadError = `team colours at ${path} could not be read, so every team will be re-assigned: `
          + (error instanceof Error ? error.message : String(error));
        console.error(`[team-colors] ${loadError}`);
        settings = normalizeTeamTintSettings(undefined);
      }
    }
    return new JsonTeamColorsStore(path, files, settings, loadError);
  }

  get loadError(): string | undefined {
    return this.#loadError;
  }

  get(): TeamTintSettings {
    return { assignments: { ...this.#settings.assignments } };
  }

  async #write(next: TeamTintSettings): Promise<TeamTintSettings> {
    const write = this.#writeQueue.then(async () => {
      await this.files.makeDirectory(dirname(this.path));
      const temp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
      await this.files.writeText(temp, `${JSON.stringify(next, null, 2)}\n`);
      await this.files.rename(temp, this.path);
      this.#settings = next;
    });
    this.#writeQueue = write.catch(() => {});
    await write;
    return this.get();
  }

  async setUserColor(groupId: string, hex: string): Promise<TeamTintSettings> {
    const normalized = normalizeHex(hex);
    if (!groupId) throw new Error("groupId is required");
    if (!normalized) throw new Error("hex must be #RGB or #RRGGBB");
    const assignments = { ...this.#settings.assignments };
    assignments[groupId] = { groupId, hex: normalized, source: "user" };
    return this.#write({ assignments });
  }
}

export interface TeamColorsRequestOptions {
  teams?: () => readonly CmuxTeam[];
  provenanceIds?: () => ReadonlySet<string>;
  setGroupColor?: (groupId: string, hex: string, reason: string) => Promise<boolean>;
  setWorkspaceColor?: (workspaceId: string, hex: string, reason: string) => Promise<boolean>;
}

function liveOperatorTeam(
  groupId: string,
  options: TeamColorsRequestOptions,
): CmuxTeam | undefined {
  const provenanceIds = options.provenanceIds?.() ?? new Set<string>();
  return (options.teams?.() ?? []).find((team) =>
    team.id === groupId && isOperatorTeam(team.name, team.id, provenanceIds));
}

export async function handleTeamColorsRequest(
  request: Request,
  store: JsonTeamColorsStore,
  options: TeamColorsRequestOptions = {},
): Promise<Response> {
  const url = new URL(request.url);
  if (!isLoopback(url.hostname)) {
    return requestError(403, "ORIGIN_REJECTED", "Team colours are only available on loopback.");
  }
  const tail = url.pathname.slice("/api/team-colors".length).replace(/^\//, "");
  if (request.method === "GET") {
    if (tail) return requestError(404, "NOT_FOUND", "Read every operator team from /api/team-colors.");
    const provenanceIds = options.provenanceIds?.() ?? new Set<string>();
    const teams = (options.teams?.() ?? []).filter((team) =>
      isOperatorTeam(team.name, team.id, provenanceIds));
    return json({ teams, settings: store.get() });
  }
  if (request.method !== "PUT") {
    return requestError(405, "METHOD_NOT_ALLOWED", "Use GET or PUT for team colours.");
  }
  const origin = request.headers.get("origin");
  if (!origin || origin !== url.origin) {
    return requestError(403, "ORIGIN_REJECTED", "Team colour changes require an exact same-origin loopback Origin header.");
  }
  const groupId = decodeURIComponent(tail);
  if (!groupId) {
    return requestError(404, "NOT_FOUND", "Address one operator team as /api/team-colors/<groupId>.");
  }
  const team = liveOperatorTeam(groupId, options);
  if (!team) {
    return requestError(404, "NOT_FOUND", "That group is not a live operator team.");
  }
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return requestError(415, "CONTENT_TYPE_REJECTED", "Team colour changes require application/json.");
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return requestError(400, "INVALID_JSON", "Team colour body is not valid JSON.");
  }
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const hex = normalizeHex(typeof record.hex === "string" ? record.hex : undefined);
  if (!hex) {
    return requestError(400, "INVALID_HEX", "hex must be #RGB or #RRGGBB.");
  }
  const settings = await store.setUserColor(groupId, hex);
  const reason = "board team assignment";
  await options.setGroupColor?.(groupId, hex, reason);
  for (const workspaceId of team.memberWorkspaceIds) {
    await options.setWorkspaceColor?.(workspaceId, hex, reason);
  }
  const provenanceIds = options.provenanceIds?.() ?? new Set<string>();
  const teams = (options.teams?.() ?? []).filter((entry) =>
    isOperatorTeam(entry.name, entry.id, provenanceIds));
  return json({ teams, settings });
}
