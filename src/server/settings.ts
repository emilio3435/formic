import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const DEFAULT_SCAN_WINDOW_HOURS = 36;
export const MIN_SCAN_WINDOW_HOURS = 1;
export const MAX_SCAN_WINDOW_HOURS = 168;

export interface HubSettings {
  scanWindowHours: number;
}

export interface SettingsFileOperations {
  readText(path: string): Promise<string>;
  makeDirectory(path: string): Promise<void>;
  writeText(path: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

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

export function clampScanWindowHours(value: unknown): number | null {
  const hours = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(hours)) return null;
  const rounded = Math.round(hours);
  if (rounded < MIN_SCAN_WINDOW_HOURS || rounded > MAX_SCAN_WINDOW_HOURS) return null;
  return rounded;
}

export function normalizeSettings(value: unknown): HubSettings {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  return {
    scanWindowHours: clampScanWindowHours(record.scanWindowHours) ?? DEFAULT_SCAN_WINDOW_HOURS,
  };
}

export function scanWindowMs(settings: HubSettings): number {
  return settings.scanWindowHours * 60 * 60 * 1_000;
}

export class JsonSettingsStore {
  #settings: HubSettings;
  #writeQueue: Promise<void> = Promise.resolve();
  readonly #loadError?: string;

  private constructor(
    private readonly path: string,
    private readonly files: SettingsFileOperations,
    settings: HubSettings,
    loadError?: string,
  ) {
    this.#settings = settings;
    this.#loadError = loadError;
  }

  /* The scan window is operator-authored: it decides how far back the board
     looks. Every failure here still returns defaults — the hub must boot — but
     a corrupt or unreadable file used to be indistinguishable from "no settings
     saved yet", because `settings` already held the defaults before the try and
     the catch reassigned them to the same value. So a typo silently narrowed
     the window from the operator's 168 hours to 36, older sessions dropped off
     the board, and nothing anywhere said why. Absent is normal; unreadable is
     not, and only one of them should pass without comment. */
  static async open(path: string, files: SettingsFileOperations = nodeFiles): Promise<JsonSettingsStore> {
    let settings = normalizeSettings(undefined);
    let loadError: string | undefined;
    try {
      settings = normalizeSettings(JSON.parse(await files.readText(path)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        loadError = `settings at ${path} could not be read, so defaults are in force `
          + `(scanWindowHours ${DEFAULT_SCAN_WINDOW_HOURS}): `
          + (error instanceof Error ? error.message : String(error));
        console.error(`[settings] ${loadError}`);
        settings = normalizeSettings(undefined);
      }
    }
    return new JsonSettingsStore(path, files, settings, loadError);
  }

  /* Undefined when the settings in force are the ones on disk, or the defaults
     because none were ever saved. Set only when defaults are standing in for
     settings we failed to read. */
  get loadError(): string | undefined {
    return this.#loadError;
  }

  get(): HubSettings {
    return { ...this.#settings };
  }

  async update(patch: Partial<HubSettings>): Promise<HubSettings> {
    const write = this.#writeQueue.then(async () => {
      const next = normalizeSettings({ ...this.#settings, ...patch });
      if (patch.scanWindowHours !== undefined) {
        const clamped = clampScanWindowHours(patch.scanWindowHours);
        if (clamped == null) {
          throw new Error(
            `scanWindowHours must be an integer between ${MIN_SCAN_WINDOW_HOURS} and ${MAX_SCAN_WINDOW_HOURS}`,
          );
        }
        next.scanWindowHours = clamped;
      }
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
}

function json(value: unknown, status = 200): Response {
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

export async function handleSettingsRequest(
  request: Request,
  store: JsonSettingsStore,
  options: { afterUpdate?: () => void | Promise<void> } = {},
): Promise<Response> {
  const url = new URL(request.url);
  if (!isLoopback(url.hostname)) {
    return requestError(403, "ORIGIN_REJECTED", "Settings are only available on loopback.");
  }
  if (request.method === "GET") {
    const settings = store.get();
    return json({
      ok: true,
      settings,
      scanWindowHours: settings.scanWindowHours,
      lookbackHours: settings.scanWindowHours,
    });
  }
  if (request.method !== "POST") {
    return requestError(405, "METHOD_NOT_ALLOWED", "Use GET or POST for settings.");
  }
  const origin = request.headers.get("origin");
  if (!origin || origin !== url.origin) {
    return requestError(403, "ORIGIN_REJECTED", "Settings changes require an exact same-origin loopback Origin header.");
  }
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return requestError(415, "CONTENT_TYPE_REJECTED", "Settings changes require application/json.");
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return requestError(400, "INVALID_JSON", "Settings body is not valid JSON.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return requestError(400, "INVALID_SETTINGS", "Body must be a JSON object.");
  }
  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => key !== "scanWindowHours")) {
    return requestError(400, "INVALID_SETTINGS", "Body may only include scanWindowHours.");
  }
  if (!("scanWindowHours" in record)) {
    return requestError(400, "INVALID_SETTINGS", "scanWindowHours is required.");
  }
  const clamped = clampScanWindowHours(record.scanWindowHours);
  if (clamped == null) {
    return requestError(
      400,
      "INVALID_SETTINGS",
      `scanWindowHours must be an integer between ${MIN_SCAN_WINDOW_HOURS} and ${MAX_SCAN_WINDOW_HOURS}.`,
    );
  }
  try {
    const settings = await store.update({ scanWindowHours: clamped });
    await options.afterUpdate?.();
    return json({
      ok: true,
      settings,
      scanWindowHours: settings.scanWindowHours,
      lookbackHours: settings.scanWindowHours,
    });
  } catch (error) {
    return requestError(500, "SETTINGS_WRITE_FAILED", error instanceof Error ? error.message : String(error));
  }
}
