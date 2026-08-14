import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ArchiveLimits } from "./archive";
import {
  defaultRepoColorsSettings,
  hexForSlot,
  normalizeHex,
  rebaseAssignmentsOntoOriginKeys,
  withAssignments,
  type ColorKeyAlias,
  type RepoColorAssignment,
  type RepoColorsSettings,
} from "../shared/repo-color";

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
export const PROVIDER_WAIT_OPTIONS_MS = [3_000, 5_000, 7_500, 10_000, 15_000] as const;
export type ProviderWaitMs = (typeof PROVIDER_WAIT_OPTIONS_MS)[number];
export const DEFAULT_PROVIDER_WAIT_MS: ProviderWaitMs = 7_500;

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
export const SETTING_KEYS = [
  ...NUMERIC_SETTING_KEYS,
  "providerWaitMs",
  "defaultView",
  "showReviewWorkers",
] as const;

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
  /** How long one refresh waits for provider scans before using last-known data. */
  providerWaitMs: ProviderWaitMs;
  /** The tab the board opens on. */
  defaultView: SettingsView;
  /** Whether routine review sessions are shown on the Board by default. */
  showReviewWorkers: boolean;
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

export function normalizeProviderWaitMs(value: unknown): ProviderWaitMs | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return PROVIDER_WAIT_OPTIONS_MS.includes(numeric as ProviderWaitMs)
    ? numeric as ProviderWaitMs
    : null;
}

export function providerWaitMessage(): string {
  return `providerWaitMs must be one of ${PROVIDER_WAIT_OPTIONS_MS.join(", ")}`;
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
    providerWaitMs: normalizeProviderWaitMs(record.providerWaitMs) ?? DEFAULT_PROVIDER_WAIT_MS,
    defaultView: normalizeView(record.defaultView) ?? DEFAULT_VIEW,
    showReviewWorkers: typeof record.showReviewWorkers === "boolean" ? record.showReviewWorkers : false,
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
      if (patch.providerWaitMs !== undefined) {
        const providerWaitMs = normalizeProviderWaitMs(patch.providerWaitMs);
        if (providerWaitMs == null) throw new Error(providerWaitMessage());
        next.providerWaitMs = providerWaitMs;
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
  if ("providerWaitMs" in record) {
    const providerWaitMs = normalizeProviderWaitMs(record.providerWaitMs);
    if (providerWaitMs == null) {
      return requestError(400, "INVALID_SETTINGS", `${providerWaitMessage()}.`);
    }
    patch.providerWaitMs = providerWaitMs;
  }
  if ("defaultView" in record) {
    const view = normalizeView(record.defaultView);
    if (view == null) {
      return requestError(400, "INVALID_SETTINGS", `defaultView must be one of ${SETTINGS_VIEWS.join(", ")}.`);
    }
    patch.defaultView = view;
  }
  if ("showReviewWorkers" in record) {
    if (typeof record.showReviewWorkers !== "boolean") {
      return requestError(400, "INVALID_SETTINGS", "showReviewWorkers must be a boolean.");
    }
    patch.showReviewWorkers = record.showReviewWorkers;
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

/* ---------------------------------------------------------------------------
   TINT-F — repo colour persistence.

   A store of its own rather than three more keys on HubSettings. `/api/settings`
   validates against a flat whitelist of scalars (SETTING_KEYS), and
   `assignments` is a nested record an operator never types: folding it in would
   either widen that whitelist to accept arbitrary objects or leave a settings
   key the settings endpoint silently refuses. It keeps this file's patterns —
   normalize-never-throw on read, reject-never-clamp on write, atomic
   temp-then-rename — because those are what the settings layer here IS.
   ------------------------------------------------------------------------ */

export function normalizeRepoColorAssignment(value: unknown, key: string): RepoColorAssignment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const hex = normalizeHex(record.hex);
  if (!hex) return null;
  const slot = typeof record.slot === "number" && Number.isInteger(record.slot) && record.slot >= 0
    ? record.slot
    : null;
  return {
    repoKey: typeof record.repoKey === "string" && record.repoKey ? record.repoKey : key,
    hex,
    slot,
    source: record.source === "user" ? "user" : "auto",
  };
}

export function normalizeRepoColors(value: unknown): RepoColorsSettings {
  const defaults = defaultRepoColorsSettings();
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const rawAssignments = record.assignments && typeof record.assignments === "object" && !Array.isArray(record.assignments)
    ? (record.assignments as Record<string, unknown>)
    : {};
  const assignments: Record<string, RepoColorAssignment> = {};
  for (const [key, entry] of Object.entries(rawAssignments)) {
    /* A single unreadable assignment is dropped, not the file. The repository
       it named simply gets re-assigned on the next discovery pass, which is a
       colour change; losing every OTHER repository's colour to keep it company
       would be a whole board repaint over one bad row. */
    const normalized = normalizeRepoColorAssignment(entry, key);
    if (normalized) assignments[key] = normalized;
  }
  return {
    assignments,
    mirrorGroups: typeof record.mirrorGroups === "boolean" ? record.mirrorGroups : defaults.mirrorGroups,
    syncFromCmux: typeof record.syncFromCmux === "boolean" ? record.syncFromCmux : defaults.syncFromCmux,
  };
}

export class JsonRepoColorsStore {
  #settings: RepoColorsSettings;
  #writeQueue: Promise<void> = Promise.resolve();
  readonly #loadError?: string;

  private constructor(
    private readonly path: string,
    private readonly files: SettingsFileOperations,
    settings: RepoColorsSettings,
    loadError?: string,
  ) {
    this.#settings = settings;
    this.#loadError = loadError;
  }

  static async open(path: string, files: SettingsFileOperations = nodeFiles): Promise<JsonRepoColorsStore> {
    let settings = normalizeRepoColors(undefined);
    let loadError: string | undefined;
    try {
      settings = normalizeRepoColors(JSON.parse(await files.readText(path)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        loadError = `repo colours at ${path} could not be read, so every repository will be re-assigned: `
          + (error instanceof Error ? error.message : String(error));
        console.error(`[repo-colors] ${loadError}`);
        settings = normalizeRepoColors(undefined);
      }
    }
    return new JsonRepoColorsStore(path, files, settings, loadError);
  }

  get loadError(): string | undefined {
    return this.#loadError;
  }

  get(): RepoColorsSettings {
    return { ...this.#settings, assignments: { ...this.#settings.assignments } };
  }

  async #write(next: RepoColorsSettings): Promise<RepoColorsSettings> {
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

  /** Give every discovered repository a colour, keeping the ones already made.
   *  Rebases folder keys onto origin keys first when aliases are present.
   *  Returns the settings in force; writes only when assignment identity
   *  changed — rebase can keep the same count while swapping `the-mountain`
   *  for `the-ant-hill`, and a count-only check would skip that write. */
  async ensure(
    repoKeys: readonly string[],
    aliases: readonly ColorKeyAlias[] = [],
  ): Promise<RepoColorsSettings> {
    const rebased = aliases.length
      ? rebaseAssignmentsOntoOriginKeys(this.#settings, aliases)
      : this.#settings;
    const next = withAssignments(rebased, repoKeys);
    const sameKeys =
      Object.keys(next.assignments).length === Object.keys(this.#settings.assignments).length
      && Object.keys(next.assignments).every((key) => {
        const left = next.assignments[key];
        const right = this.#settings.assignments[key];
        return left && right && left.hex === right.hex && left.source === right.source;
      });
    if (sameKeys) return this.get();
    return this.#write(next);
  }

  /** An operator's own colour for one repository. Throws on a hex this program
     would not be able to compare later — reject, never coerce. */
  async setUserColor(repoKey: string, hex: string): Promise<RepoColorsSettings> {
    const normalized = normalizeHex(hex);
    if (!repoKey) throw new Error("repoKey is required");
    if (!normalized) throw new Error("hex must be #RGB or #RRGGBB");
    const assignments = { ...this.#settings.assignments };
    /* slot goes null: the repository is no longer wearing a palette slot, and
       leaving the old number behind would keep that slot marked taken forever,
       pushing the next repository into overflow clay while a hue sat unused. */
    assignments[repoKey] = { repoKey, hex: normalized, slot: null, source: "user" };
    return this.#write({ ...this.#settings, assignments });
  }

  /** Drop an operator override so the repository returns to its palette slot. */
  async clearUserColor(repoKey: string): Promise<RepoColorsSettings> {
    const current = this.#settings.assignments[repoKey];
    if (!current || current.source !== "user") return this.get();
    const assignments = { ...this.#settings.assignments };
    delete assignments[repoKey];
    return this.#write(withAssignments({ ...this.#settings, assignments }, [repoKey]));
  }

  async setFlags(patch: { mirrorGroups?: boolean; syncFromCmux?: boolean }): Promise<RepoColorsSettings> {
    return this.#write({
      ...this.#settings,
      ...(patch.mirrorGroups === undefined ? {} : { mirrorGroups: patch.mirrorGroups }),
      ...(patch.syncFromCmux === undefined ? {} : { syncFromCmux: patch.syncFromCmux }),
    });
  }
}

/* ---------------------------------------------------------------------------
   Discovery: what the board is currently looking at, in repo-colour terms.
   ------------------------------------------------------------------------ */

export interface RepoColorSubject {
  /** Canonical repo key, from repoKeyForCwd; null when the agent is not in a repo. */
  repoKey: string | null;
  /** Folder key (common-dir parent), when known — used to rebase stored rows. */
  folderKey?: string | null;
  /** The name the BOARD prints for this repository, if any. */
  repoName?: string;
  /** cmux workspace this agent's surface lives in, if resolved. */
  workspaceId?: string;
}

export interface RepoColorDiscovery {
  repoKeys: string[];
  /** Sorted unique origin keys currently discovered — same as `repoKeys`. */
  liveKeys: string[];
  /** Lowercased board repo name → canonical repo key. The client joins on this. */
  names: Record<string, string>;
  /** cmux workspace id → canonical repo key. */
  workspaces: Record<string, string>;
  /** Live folder→origin pairs so persisted folder keys can rebase onto origin. */
  aliases: ColorKeyAlias[];
}

/** Fold the live fleet into the three maps the colour endpoint answers with.
 *
 *  Authority rule 4 lives here: a workspace holding agents from more than one
 *  repository belongs to whichever repository has the most agents in it, ties
 *  broken by the lexicographically first key. Deterministic on purpose — a
 *  shared workspace that changed colour every poll because two repos traded the
 *  lead would be a strobe, and "whichever we saw last" is not an answer anyone
 *  can predict or debug. */
export function repoColorDiscovery(subjects: readonly RepoColorSubject[]): RepoColorDiscovery {
  const repoKeys = new Set<string>();
  /* Every key that has claimed each printed name, not the last one to claim it.
     `names[name] = key` was last-writer-wins, and the writer order is collector
     order — so two repositories whose printed names collide would trade colours
     between polls, and which one got which was unpredictable. */
  const claims = new Map<string, Set<string>>();
  const counts = new Map<string, Map<string, number>>();
  const aliases: ColorKeyAlias[] = [];
  for (const subject of subjects) {
    const key = subject.repoKey;
    if (!key) continue;
    repoKeys.add(key);
    if (subject.folderKey) aliases.push({ folderKey: subject.folderKey, originKey: key });
    const name = subject.repoName?.trim().toLowerCase();
    if (name) {
      let claimants = claims.get(name);
      if (!claimants) {
        claimants = new Set();
        claims.set(name, claimants);
      }
      claimants.add(key);
    }
    if (!subject.workspaceId) continue;
    let tally = counts.get(subject.workspaceId);
    if (!tally) {
      tally = new Map();
      counts.set(subject.workspaceId, tally);
    }
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  const workspaces: Record<string, string> = {};
  for (const [workspaceId, tally] of counts) {
    const winner = [...tally.entries()].sort((left, right) =>
      right[1] - left[1] || left[0].localeCompare(right[0]))[0];
    if (winner) workspaces[workspaceId] = winner[0];
  }
  /* An AMBIGUOUS printed name drops out of the join entirely (ruling, master
     2026-08-13). The board can only ask "what colour is the name I am
     printing", and when two repositories answer to that name there is no right
     answer — so it gets no colour rather than a coin-flip one. Same bias as the
     anchor rules: no tint beats wrong tint, and an operator who sees one band
     uncoloured asks why, where one who sees it wearing its neighbour's hue
     never knows to. */
  const names: Record<string, string> = {};
  for (const [name, claimants] of claims) {
    if (claimants.size === 1) names[name] = [...claimants][0]!;
  }
  const sortedKeys = [...repoKeys].sort();
  return { repoKeys: sortedKeys, liveKeys: [...sortedKeys], names, workspaces, aliases };
}

export interface RepoColorsRequestOptions {
  discover?: () => RepoColorDiscovery | Promise<RepoColorDiscovery>;
  /** Fan out the assignments to cmux. Repo-MAPPED workspaces only — writing to
   *  an unmapped workspace is cmux's own colour being overwritten (rule 2). */
  fanOut?: (writes: readonly { workspaceId: string; hex: string }[]) => void | Promise<void>;
}

function repoColorsPayload(
  settings: RepoColorsSettings,
  discovery: RepoColorDiscovery,
): Record<string, unknown> {
  const workspaces: Record<string, { hex: string; repoKey: string | null }> = {};
  for (const [workspaceId, repoKey] of Object.entries(discovery.workspaces)) {
    const assignment = settings.assignments[repoKey];
    if (!assignment) continue;
    workspaces[workspaceId] = { hex: assignment.hex, repoKey };
  }
  return {
    ok: true,
    settings,
    workspaces,
    /* Additive to the contract's `{ settings, workspaces }`: the BOARD joins on
       the repository name it already prints, because a browser cannot run
       `git rev-parse` to derive the canonical key for itself. Flagged to the
       master in LANE-REPORT-tint-f §5. */
    repoNames: discovery.names,
    liveKeys: discovery.repoKeys,
  };
}

const REPO_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

/** Push one repository's current colour to every workspace mapped to it. One
 *  function for both mutating verbs, so a later verb cannot quietly skip it —
 *  which is exactly how DELETE came to return a restored colour it never
 *  wrote. */
async function fanOutFor(
  repoKey: string,
  settings: RepoColorsSettings,
  discovery: RepoColorDiscovery,
  options: RepoColorsRequestOptions,
): Promise<void> {
  const assignment = settings.assignments[repoKey];
  if (!assignment) return;
  const writes = Object.entries(discovery.workspaces).flatMap(([workspaceId, key]) =>
    key === repoKey ? [{ workspaceId, hex: assignment.hex }] : []);
  if (writes.length) await options.fanOut?.(writes);
}

export async function handleRepoColorsRequest(
  request: Request,
  store: JsonRepoColorsStore,
  options: RepoColorsRequestOptions = {},
): Promise<Response> {
  const url = new URL(request.url);
  if (!isLoopback(url.hostname)) {
    return requestError(403, "ORIGIN_REJECTED", "Repo colours are only available on loopback.");
  }
  const tail = url.pathname.slice("/api/repo-colors".length).replace(/^\//, "");
  if (request.method === "GET") {
    if (tail) return requestError(404, "NOT_FOUND", "Read every repository's colour from /api/repo-colors.");
    const discovery = await (options.discover?.() ?? { repoKeys: [], liveKeys: [], names: {}, workspaces: {}, aliases: [] });
    const settings = await store.ensure(discovery.repoKeys, discovery.aliases ?? []);
    const writes = Object.entries(discovery.workspaces).flatMap(([workspaceId, repoKey]) => {
      const assignment = settings.assignments[repoKey];
      return assignment ? [{ workspaceId, hex: assignment.hex }] : [];
    });
    if (writes.length) await options.fanOut?.(writes);
    return json(repoColorsPayload(settings, discovery));
  }
  if (request.method !== "PUT" && request.method !== "DELETE") {
    return requestError(405, "METHOD_NOT_ALLOWED", "Use GET, PUT or DELETE for repo colours.");
  }
  const origin = request.headers.get("origin");
  if (!origin || origin !== url.origin) {
    return requestError(403, "ORIGIN_REJECTED", "Repo colour changes require an exact same-origin loopback Origin header.");
  }
  const repoKey = decodeURIComponent(tail);
  if (!REPO_KEY_PATTERN.test(repoKey)) {
    return requestError(400, "INVALID_REPO_KEY", "Address one repository as /api/repo-colors/<repoKey>.");
  }
  try {
    if (request.method === "DELETE") {
      const settings = await store.clearUserColor(repoKey);
      const discovery = await (options.discover?.() ?? { repoKeys: [], liveKeys: [], names: {}, workspaces: {}, aliases: [] });
      /* Clearing an override is a colour CHANGE, so it fans out exactly as
         setting one does. Returning the restored palette hex and writing
         nothing left cmux wearing the colour the operator just took back —
         until some later GET happened to notice, or TINT-S papered over it. A
         write path that only pushes half its outcomes is not a write path. */
      await fanOutFor(repoKey, settings, discovery, options);
      return json(repoColorsPayload(settings, discovery));
    }
    if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
      return requestError(415, "CONTENT_TYPE_REJECTED", "Repo colour changes require application/json.");
    }
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return requestError(400, "INVALID_JSON", "Repo colour body is not valid JSON.");
    }
    const record = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    if (!normalizeHex(record.hex)) {
      return requestError(400, "INVALID_HEX", "hex must be #RGB or #RRGGBB.");
    }
    const settings = await store.setUserColor(repoKey, record.hex as string);
    const discovery = await (options.discover?.() ?? { repoKeys: [], liveKeys: [], names: {}, workspaces: {}, aliases: [] });
    await fanOutFor(repoKey, settings, discovery, options);
    return json(repoColorsPayload(settings, discovery));
  } catch (error) {
    return requestError(500, "REPO_COLORS_WRITE_FAILED", error instanceof Error ? error.message : String(error));
  }
}

/* Re-exported so consumers reach one module for the whole repo-colour surface
   rather than importing the palette from shared and the store from here. */
export { hexForSlot };
export type { RepoColorAssignment, RepoColorsSettings };

/** In-memory file operations, for a store that must exist without a disk to
 *  write to (tests, and any web root that is not the shipped one). */
export function memorySettingsFiles(): SettingsFileOperations {
  const files = new Map<string, string>();
  return {
    readText: async (path) => {
      const value = files.get(path);
      if (value === undefined) {
        const error = new Error(`no such file: ${path}`) as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      return value;
    },
    makeDirectory: async () => {},
    writeText: async (path, contents) => { files.set(path, contents); },
    rename: async (from, to) => {
      const value = files.get(from);
      if (value === undefined) throw new Error(`no such file: ${from}`);
      files.set(to, value);
      files.delete(from);
    },
  };
}
