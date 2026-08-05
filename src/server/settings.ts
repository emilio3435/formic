import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ArchiveLimits } from "./archive";

export const DEFAULT_SCAN_WINDOW_HOURS = 36;
export const MIN_SCAN_WINDOW_HOURS = 1;
export const MAX_SCAN_WINDOW_HOURS = 168;

/* Version 2 of the settings file. v1 held one key — the scan window — and every
   other number the board classifies by was an inline literal in a collector, so
   an operator running a fleet of overnight swarms had no way to say "45 minutes
   of silence is normal here" except to accept being told their sessions ended.

   The line this schema draws: an operator may tune TIME and PRESENTATION. They
   may not tune EVIDENCE SEMANTICS. When silence becomes "quiet" is a
   preference; whether unavailable process evidence means "unknown" is not, and
   there is deliberately no key for it. */
export const SETTINGS_VERSION = 2;

export const SETTINGS_VIEWS = ["needs-you", "now", "waiting", "history", "usage"] as const;
export type SettingsView = (typeof SETTINGS_VIEWS)[number];
export const DEFAULT_VIEW: SettingsView = "needs-you";

/* One row per tunable number, so validation, reset, migration and the API
   whitelist all read the same table instead of four hand-maintained copies —
   which is how `emptySnapshot` came to hardcode 36 twice while the store held
   the operator's real answer. */
export const NUMERIC_SETTINGS = {
  activityFreshMinutes: { default: 3, min: 1, max: 30 },
  activityQuietMinutes: { default: 45, min: 5, max: 480 },
  stalledActiveMinutes: { default: 30, min: 5, max: 480 },
  scanWindowHours: {
    default: DEFAULT_SCAN_WINDOW_HOURS,
    min: MIN_SCAN_WINDOW_HOURS,
    max: MAX_SCAN_WINDOW_HOURS,
  },
  historyRetentionDays: { default: 30, min: 7, max: 365 },
  historyRecordLimit: { default: 5000, min: 100, max: 50_000 },
} as const;

export type NumericSettingKey = keyof typeof NUMERIC_SETTINGS;
export const NUMERIC_SETTING_KEYS = Object.keys(NUMERIC_SETTINGS) as NumericSettingKey[];
export const SETTING_KEYS = [...NUMERIC_SETTING_KEYS, "defaultView"] as const;

export interface HubSettings {
  version: typeof SETTINGS_VERSION;
  /** Activity newer than this reads as Working. */
  activityFreshMinutes: number;
  /** Silence at or beyond this stops reading as recent. Must exceed freshness. */
  activityQuietMinutes: number;
  /** How long an active declaration may carry an idle hook before attention. */
  stalledActiveMinutes: number;
  /** How far back collectors read transcripts. */
  scanWindowHours: number;
  /** How long finished sessions are kept. */
  historyRetentionDays: number;
  /** At most this many History records are kept. */
  historyRecordLimit: number;
  /** The tab the board opens on. */
  defaultView: SettingsView;
}

export interface SettingsThresholds {
  freshMs: number;
  quietMs: number;
}

export function lifecycleThresholds(settings: HubSettings): SettingsThresholds {
  return {
    freshMs: settings.activityFreshMinutes * 60_000,
    quietMs: settings.activityQuietMinutes * 60_000,
  };
}

/* The shape belongs to the archive, which enforces it; this module only decides
   what the numbers are. Importing it rather than redeclaring it is the same
   rule the rest of this program runs on — one definition, or they drift. */
export function archiveLimits(settings: HubSettings): ArchiveLimits {
  return {
    retentionMs: settings.historyRetentionDays * 24 * 60 * 60 * 1_000,
    recordLimit: settings.historyRecordLimit,
  };
}

/* Reject, never clamp — the contract `clampScanWindowHours` has always kept
   despite its name. Silently rewriting 500 to 168 tells an operator their
   setting took effect when a different one did; returning null lets the caller
   say what was wrong and what the range is. */
export function clampSetting(key: NumericSettingKey, value: unknown): number | null {
  const spec = NUMERIC_SETTINGS[key];
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.round(numeric);
  if (rounded < spec.min || rounded > spec.max) return null;
  return rounded;
}

export function settingRangeMessage(key: NumericSettingKey): string {
  const spec = NUMERIC_SETTINGS[key];
  return `${key} must be an integer between ${spec.min} and ${spec.max}`;
}

export function normalizeView(value: unknown): SettingsView | null {
  return SETTINGS_VIEWS.includes(value as SettingsView) ? (value as SettingsView) : null;
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
  return clampSetting("scanWindowHours", value);
}

/* Reading a settings file, from any version, without ever failing to boot.

   A v1 file has no `version` key and exactly one setting the operator chose. It
   migrates by keeping that choice and filling the rest with documented defaults
   — the one thing a migration must never do is lose an unambiguous decision
   somebody made on purpose. Anything unreadable in a single field falls back to
   that field's default rather than discarding the whole file. */
export function normalizeSettings(value: unknown): HubSettings {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const settings = {
    version: SETTINGS_VERSION,
    defaultView: normalizeView(record.defaultView) ?? DEFAULT_VIEW,
  } as HubSettings;
  for (const key of NUMERIC_SETTING_KEYS) {
    settings[key] = clampSetting(key, record[key]) ?? NUMERIC_SETTINGS[key].default;
  }
  /* A quiet threshold at or below the freshness threshold erases the Waiting
     band entirely: a session would go from Working to Unverified with nothing
     in between. Both values are individually in range when this happens
     (fresh 20 / quiet 10), so it has to be checked as a pair. Resetting quiet
     always resolves it, because its default exceeds the largest legal
     freshness. */
  if (settings.activityQuietMinutes <= settings.activityFreshMinutes) {
    settings.activityQuietMinutes = NUMERIC_SETTINGS.activityQuietMinutes.default;
  }
  return settings;
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
      /* normalizeSettings falls back silently, which is right for a file on
         disk and wrong for a caller who just asked for something. An explicit
         request for an impossible value throws so the operator hears "no"
         rather than watching their number be replaced by a default. */
      for (const key of NUMERIC_SETTING_KEYS) {
        if (patch[key] === undefined) continue;
        const clamped = clampSetting(key, patch[key]);
        if (clamped == null) throw new Error(settingRangeMessage(key));
        next[key] = clamped;
      }
      if (patch.defaultView !== undefined) {
        const view = normalizeView(patch.defaultView);
        if (view == null) throw new Error(`defaultView must be one of ${SETTINGS_VIEWS.join(", ")}`);
        next.defaultView = view;
      }
      if (next.activityQuietMinutes <= next.activityFreshMinutes) {
        throw new Error("activityQuietMinutes must exceed activityFreshMinutes");
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
  /* `version` is accepted and ignored: a client that round-trips a GET response
     back into a POST would otherwise be rejected by its own payload. */
  const unknown = keys.filter((key) => key !== "version" && !SETTING_KEYS.includes(key as never));
  if (unknown.length) {
    return requestError(400, "INVALID_SETTINGS", `Unknown settings: ${unknown.join(", ")}.`);
  }
  if (!keys.some((key) => SETTING_KEYS.includes(key as never))) {
    return requestError(400, "INVALID_SETTINGS", `Body must include at least one of ${SETTING_KEYS.join(", ")}.`);
  }
  const patch: Partial<HubSettings> = {};
  for (const key of NUMERIC_SETTING_KEYS) {
    if (!(key in record)) continue;
    const clamped = clampSetting(key, record[key]);
    if (clamped == null) return requestError(400, "INVALID_SETTINGS", `${settingRangeMessage(key)}.`);
    patch[key] = clamped;
  }
  if ("defaultView" in record) {
    const view = normalizeView(record.defaultView);
    if (view == null) {
      return requestError(400, "INVALID_SETTINGS", `defaultView must be one of ${SETTINGS_VIEWS.join(", ")}.`);
    }
    patch.defaultView = view;
  }
  /* Checked against the MERGED result, not the patch: raising freshness alone
     can invalidate a quiet threshold the operator set weeks ago, and the pair is
     what has to stay coherent. */
  const merged = { ...store.get(), ...patch };
  if (merged.activityQuietMinutes <= merged.activityFreshMinutes) {
    return requestError(
      400,
      "INVALID_SETTINGS",
      `activityQuietMinutes must exceed activityFreshMinutes (got ${merged.activityQuietMinutes} and ${merged.activityFreshMinutes}).`,
    );
  }
  try {
    const settings = await store.update(patch);
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
