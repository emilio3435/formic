import { execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, normalize } from "node:path";
import { PROVIDERS, type Provider } from "../shared/types";
import type { SettingsFileOperations } from "./settings";

export type CollectorKind =
  | "cursor-gui" | "cursor-cli" | "codex" | "claude" | "factory"
  | "prime" | "omp" | "grok-cli" | "hermes" | "grok-bot"
  | "muse" | "antigravity-cli" | "antigravity-desktop" | "antigravity-ide"
  | "copilot" | "burnbar" | "cmux-hooks" | "unknown";

export type CollectorReason = "needs-parser" | "needs-home-list";

export interface CollectorCandidate {
  kind: CollectorKind;
  provider: Provider | null;
  dataDir: string;
  label: string;
  default: boolean;
  reason?: CollectorReason;
}

export interface ScanFs {
  home(): string;
  readdir(path: string): string[];
  isDirectory(path: string): boolean;
  exists(path: string): boolean;
  readTextCapped(path: string, maxBytes: number): string | undefined;
  readAppIdentity(appPath: string): { name?: string; identifier?: string } | undefined;
  processArgv(): string[];
}

const PROVIDER_FOR = {
  "cursor-gui": "cursor",
  "cursor-cli": "cursor",
  "codex": "codex",
  "claude": "claude",
  "factory": "factory",
  "prime": "prime",
  "omp": "omp",
  "grok-cli": "grok",
  "hermes": "hermes",
  "muse": "muse",
  "antigravity-cli": "antigravity",
  "antigravity-desktop": "antigravity",
  "antigravity-ide": "antigravity",
  "copilot": "copilot",
  "grok-bot": null,
  "burnbar": null,
  "cmux-hooks": null,
  "unknown": null,
} as const satisfies Record<CollectorKind, Provider | null>;

const NAME_TOKEN_RE = /^(claude|codex|cursor|grok|hermes|factory|prime|omp|droid|aider|continue|opencode|gemini|muse|antigravity|windsurf|copilot|crush|amp)/i;
const AGENT_MENTION_RE = /(claude|codex|cursor|grok|hermes|factory|prime|omp|droid|aider|continue|opencode|gemini|muse|antigravity|windsurf|copilot|crush|amp)/i;
const SESSION_DIR_NAMES = new Set(["sessions", "projects", "chats", "conversations"]);
const SKIP_WALK_NAMES = new Set(["node_modules", "Caches", "Logs"]);

export function defaultHomes(home: string): ReadonlyArray<{ kind: CollectorKind; dataDir: string }> {
  return [
    { kind: "cursor-gui", dataDir: join(home, "Library/Application Support/Cursor") },
    { kind: "cursor-cli", dataDir: join(home, ".cursor") },
    { kind: "codex", dataDir: join(home, ".codex") },
    { kind: "claude", dataDir: join(home, ".claude") },
    { kind: "factory", dataDir: join(home, ".factory") },
    { kind: "prime", dataDir: join(home, ".prime") },
    { kind: "omp", dataDir: join(home, ".omp") },
    { kind: "grok-cli", dataDir: join(home, ".grok") },
    { kind: "hermes", dataDir: join(home, ".hermes") },
    { kind: "muse", dataDir: join(home, ".local/share/muse") },
    { kind: "copilot", dataDir: join(home, ".copilot") },
    { kind: "antigravity-cli", dataDir: join(home, ".gemini/antigravity-cli") },
    { kind: "antigravity-desktop", dataDir: join(home, ".gemini/antigravity") },
    { kind: "antigravity-ide", dataDir: join(home, ".gemini/antigravity-ide") },
    { kind: "cmux-hooks", dataDir: join(home, ".cmuxterm") },
    { kind: "burnbar", dataDir: join(home, "Library/Application Support/OpenBurnBar") },
  ];
}

export function instanceIdFor(kind: CollectorKind, dataDir: string): string {
  const base = basename(dataDir).replace(/^\./, "dot-").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${kind}:${base || "home"}`;
}

/* Adapters must not slurp binaries. Open, read at most maxBytes, close. */
export function readTextCappedSync(path: string, maxBytes: number): string | undefined {
  try {
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(Math.max(0, maxBytes));
      const n = readSync(fd, buf, 0, buf.length, 0);
      return buf.subarray(0, n).toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

const SCAN_BUDGET_MS = 2_000;
const SCRIPT_CAP_BYTES = 8_192;
const DOTDIR_RE = /^\.[A-Za-z0-9._-]+$/;
const USER_DATA_DIR_RE = /--user-data-dir=(?:"([^"]+)"|(\S+))/;
const HOME_FLAG_RE = /--home=(?:"([^"]+)"|(\S+))/;
const SKIP_ROOT_NAMES = new Set(["node_modules", "Caches", "Logs"]);

function stripTrailingSep(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function normalizePath(path: string): string {
  return stripTrailingSep(normalize(path));
}

/* Only the leading token. Wrapper scripts write --user-data-dir="$HOME/..."
   and --home=~/...; a general expander would treat $HOME in the middle of a
   path as a variable, which we do not want. */
function expandLeadingHome(path: string, home: string): string {
  if (path === "~" || path === "$HOME" || path === "${HOME}") return home;
  if (path.startsWith("~/")) return `${home}${path.slice(1)}`;
  if (path.startsWith("$HOME/")) return `${home}${path.slice("$HOME".length)}`;
  if (path.startsWith("${HOME}/")) return `${home}${path.slice("${HOME}".length)}`;
  return path;
}

function resolveExtractedPath(raw: string | undefined, home: string): string | undefined {
  if (raw === undefined) return undefined;
  return normalizePath(expandLeadingHome(raw, home));
}

function samePath(left: string, right: string): boolean {
  return normalizePath(left) === normalizePath(right);
}

function isUnder(path: string, root: string): boolean {
  const resolved = normalizePath(path);
  const base = normalizePath(root);
  return resolved === base || resolved.startsWith(`${base}/`);
}

function isAllowedAliasTarget(path: string, home: string): boolean {
  return isUnder(path, home) || isUnder(path, "/Applications") || isUnder(path, "/tmp");
}

function isDefaultDataDir(dataDir: string, home: string): boolean {
  return defaultHomes(home).some((row) => samePath(row.dataDir, dataDir));
}

function isDotFamily(base: string, token: string): boolean {
  return base === `.${token}` || base.startsWith(`.${token}`);
}

function candidate(
  kind: CollectorKind,
  dataDir: string,
  fs: ScanFs,
  reason?: CollectorReason,
): CollectorCandidate {
  const hit: CollectorCandidate = {
    kind,
    provider: PROVIDER_FOR[kind],
    dataDir,
    label: basename(dataDir),
    default: isDefaultDataDir(dataDir, fs.home()),
  };
  if (reason) hit.reason = reason;
  return hit;
}

/* `~/.grokbot` is the Bot product cache. classify's `.grok*` prefix match
   would otherwise list it as a CLI extra. */
export function isGrokBotProductCache(dataDir: string): boolean {
  return basename(dataDir).replace(/^\./, "").toLowerCase() === "grokbot";
}

function sessionNames(dataDir: string, fs: ScanFs): string[] {
  return fs.readdir(join(dataDir, "sessions"));
}

function pastDeadline(deadline?: number): boolean {
  return deadline !== undefined && Date.now() > deadline;
}

function hasSessionShapedChildren(dataDir: string, fs: ScanFs, depth = 0, deadline?: number): boolean {
  if (depth > 3 || pastDeadline(deadline)) return false;
  for (const name of fs.readdir(dataDir)) {
    if (pastDeadline(deadline)) return false;
    if (SKIP_WALK_NAMES.has(name)) continue;
    const child = join(dataDir, name);
    if (SESSION_DIR_NAMES.has(name) && fs.isDirectory(child)) return true;
    if (name.endsWith(".jsonl")) return true;
    if (depth < 3 && fs.isDirectory(child) && hasSessionShapedChildren(child, fs, depth + 1, deadline)) {
      return true;
    }
  }
  return false;
}

function firstGroup(match: RegExpMatchArray | null): string | undefined {
  return match?.[1] ?? match?.[2];
}

function extractedUserDataDir(text: string): string | undefined {
  return firstGroup(text.match(USER_DATA_DIR_RE));
}

function extractedHomeFlag(text: string): string | undefined {
  return firstGroup(text.match(HOME_FLAG_RE));
}

export function prioritizeAgentNamedDirs(names: readonly string[]): string[] {
  const known: string[] = [];
  const rest: string[] = [];
  for (const name of names) {
    if (NAME_TOKEN_RE.test(name)) known.push(name);
    else rest.push(name);
  }
  return known.concat(rest);
}

function argvPointsAt(dataDir: string, fs: ScanFs): boolean {
  const home = fs.home();
  return fs.processArgv().some((argv) => {
    const userData = resolveExtractedPath(extractedUserDataDir(argv), home);
    const homeFlag = resolveExtractedPath(extractedHomeFlag(argv), home);
    return (userData !== undefined && samePath(userData, dataDir))
      || (homeFlag !== undefined && samePath(homeFlag, dataDir));
  });
}

function identityMentionsAgent(identity: { name?: string; identifier?: string } | undefined): boolean {
  if (!identity) return false;
  return AGENT_MENTION_RE.test(`${identity.name ?? ""} ${identity.identifier ?? ""}`);
}

function appIdentityPointsAt(dataDir: string, fs: ScanFs, deadline?: number): boolean {
  if (pastDeadline(deadline)) return false;
  if (dataDir.endsWith(".app") && identityMentionsAgent(fs.readAppIdentity(dataDir))) return true;
  const base = basename(dataDir);
  const home = fs.home();
  for (const appsRoot of [join(home, "Applications"), "/Applications"]) {
    if (pastDeadline(deadline)) return false;
    for (const name of fs.readdir(appsRoot)) {
      if (pastDeadline(deadline)) return false;
      if (!name.endsWith(".app")) continue;
      const appPath = join(appsRoot, name);
      if (!identityMentionsAgent(fs.readAppIdentity(appPath))) continue;
      const bundleName = name.replace(/\.app$/i, "");
      if (bundleName === base) return true;
      if (samePath(join(home, "Library/Application Support", bundleName), dataDir)) return true;
    }
  }
  return false;
}

function unknownSignalCount(dataDir: string, fs: ScanFs, deadline?: number): number {
  const token = basename(dataDir).replace(/^\./, "");
  let count = 0;
  if (NAME_TOKEN_RE.test(token)) count += 1;
  if (count < 2 && argvPointsAt(dataDir, fs)) count += 1;
  if (count < 2 && appIdentityPointsAt(dataDir, fs, deadline)) count += 1;
  if (count === 1 && hasSessionShapedChildren(dataDir, fs, 0, deadline)) count += 1;
  return count;
}

/* First match in the spec table wins. Existence only — never open sqlite or blobs. */
export function classifyDataDir(dataDir: string, fs: ScanFs, deadline?: number): CollectorCandidate | undefined {
  const base = basename(dataDir);

  if (base.startsWith("Cursor") && fs.exists(join(dataDir, "User/globalStorage/state.vscdb"))) {
    return candidate("cursor-gui", dataDir, fs);
  }
  if (
    isDotFamily(base, "cursor")
    && (fs.isDirectory(join(dataDir, "chats")) || fs.isDirectory(join(dataDir, "projects")))
  ) {
    return candidate("cursor-cli", dataDir, fs);
  }
  if (isDotFamily(base, "codex") && sessionNames(dataDir, fs).some((name) => name.startsWith("rollout-"))) {
    return candidate("codex", dataDir, fs);
  }
  if (isDotFamily(base, "claude") && fs.isDirectory(join(dataDir, "projects"))) {
    return candidate("claude", dataDir, fs);
  }
  if (isDotFamily(base, "factory")) {
    const names = sessionNames(dataDir, fs);
    if (names.some((name) => name.endsWith(".jsonl")) && names.some((name) => name.endsWith(".settings.json"))) {
      return candidate("factory", dataDir, fs);
    }
  }
  if (isDotFamily(base, "prime") && fs.isDirectory(join(dataDir, "agent/sessions"))) {
    return candidate("prime", dataDir, fs);
  }
  if (isDotFamily(base, "omp") && fs.isDirectory(join(dataDir, "agent/sessions"))) {
    return candidate("omp", dataDir, fs);
  }
  if (isDotFamily(base, "grok") && (fs.isDirectory(join(dataDir, "sessions")) || fs.exists(join(dataDir, "sessions")))) {
    return candidate("grok-cli", dataDir, fs);
  }
  if (isDotFamily(base, "hermes") && (fs.isDirectory(join(dataDir, "sessions")) || fs.isDirectory(join(dataDir, "cron")))) {
    return candidate("hermes", dataDir, fs);
  }
  if (isDotFamily(base, "muse") && (fs.isDirectory(join(dataDir, "sessions")) || base.replace(/^\./, "").toLowerCase() === "muse")) {
    return candidate("muse", dataDir, fs);
  }
  if (
    isDotFamily(base, "copilot")
    && (
      fs.isDirectory(join(dataDir, "session-state"))
      || fs.exists(join(dataDir, "settings.json"))
      || fs.exists(join(dataDir, "mcp-config.json"))
      || base.replace(/^\./, "").toLowerCase() === "copilot"
    )
  ) {
    return candidate("copilot", dataDir, fs);
  }
  if (base === "antigravity-cli" || dataDir.endsWith("/.gemini/antigravity-cli")) {
    return candidate("antigravity-cli", dataDir, fs);
  }
  if (base === "antigravity-ide" || dataDir.endsWith("/.gemini/antigravity-ide")) {
    return candidate("antigravity-ide", dataDir, fs);
  }
  if (base === "antigravity" || dataDir.endsWith("/.gemini/antigravity")) {
    return candidate("antigravity-desktop", dataDir, fs);
  }
  if (base.startsWith("Grok Bot") && fs.isDirectory(join(dataDir, "sand-client-persistence"))) {
    return candidate("grok-bot", dataDir, fs);
  }
  if (base === "OpenBurnBar") {
    return candidate("burnbar", dataDir, fs);
  }
  if (base === ".cmuxterm" || dataDir.endsWith("/.cmuxterm")) {
    return candidate("cmux-hooks", dataDir, fs);
  }
  if (unknownSignalCount(dataDir, fs, deadline) >= 2) {
    return candidate("unknown", dataDir, fs, "needs-parser");
  }
  return undefined;
}

function extractScriptDataDir(appPath: string, fs: ScanFs): string | undefined {
  const macos = join(appPath, "Contents/MacOS");
  for (const name of fs.readdir(macos)) {
    const bin = join(macos, name);
    if (fs.isDirectory(bin)) continue;
    const text = fs.readTextCapped(bin, SCRIPT_CAP_BYTES);
    if (text === undefined || !text.startsWith("#!")) continue;
    const dataDir = resolveExtractedPath(
      extractedUserDataDir(text) ?? extractedHomeFlag(text),
      fs.home(),
    );
    if (dataDir) return dataDir;
  }
  return undefined;
}

function bundleSupportDir(appPath: string, home: string, fs: ScanFs): string {
  const identity = fs.readAppIdentity(appPath);
  const bundleName = identity?.name || basename(appPath).replace(/\.app$/i, "");
  return join(home, "Library/Application Support", bundleName);
}

/* Read-only. Four roots, depth 1, ≤2s. Dedup by resolved dataDir. No wrapper path literals. */
export function scanAgentHomes(fs: ScanFs): CollectorCandidate[] {
  const home = fs.home();
  const deadline = Date.now() + SCAN_BUDGET_MS;
  const seen = new Set<string>();
  const hits: CollectorCandidate[] = [];

  const consider = (raw: string | undefined): void => {
    if (!raw || Date.now() > deadline) return;
    const dataDir = normalizePath(expandLeadingHome(raw, home));
    if (!isAllowedAliasTarget(dataDir, home)) return;
    if (seen.has(dataDir) || !fs.isDirectory(dataDir)) return;
    let hit: CollectorCandidate | undefined;
    try {
      hit = classifyDataDir(dataDir, fs, deadline);
    } catch {
      return;
    }
    if (!hit) return;
    seen.add(dataDir);
    hits.push({ ...hit, dataDir });
  };

  const scanApps = (appsRoot: string): void => {
    for (const name of fs.readdir(appsRoot)) {
      if (Date.now() > deadline) return;
      if (!name.endsWith(".app") || SKIP_ROOT_NAMES.has(name)) continue;
      const appPath = join(appsRoot, name);
      if (!fs.isDirectory(appPath)) continue;
      const extracted = extractScriptDataDir(appPath, fs);
      if (extracted) consider(extracted);
      else consider(bundleSupportDir(appPath, home, fs));
    }
  };

  /* Application Support first. macOS readdir is not alphabetical — this Mac
     lists Cursor-2 at index 99 of 111, after the 2s cut. Known agent tokens
     (Cursor, Grok, Claude, …) go first so extras are classified while budget
     remains. */
  const supportRoot = join(home, "Library/Application Support");
  for (const name of prioritizeAgentNamedDirs(fs.readdir(supportRoot))) {
    if (Date.now() > deadline) break;
    if (SKIP_ROOT_NAMES.has(name) || name === "." || name === "..") continue;
    const dir = join(supportRoot, name);
    if (fs.isDirectory(dir)) consider(dir);
  }

  scanApps(join(home, "Applications"));
  scanApps("/Applications");

  for (const name of fs.readdir(home)) {
    if (Date.now() > deadline) break;
    if (name === "." || name === ".." || !DOTDIR_RE.test(name) || SKIP_ROOT_NAMES.has(name)) continue;
    const dir = join(home, name);
    if (fs.isDirectory(dir)) consider(dir);
  }

  for (const argv of fs.processArgv()) {
    if (Date.now() > deadline) break;
    const extracted = resolveExtractedPath(
      extractedUserDataDir(argv) ?? extractedHomeFlag(argv),
      home,
    );
    if (!extracted) continue;
    if (isUnder(extracted, home) || isUnder(extracted, "/Applications")) consider(extracted);
  }

  return hits;
}

function plistString(text: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.match(new RegExp(`<key>${escaped}</key>\\s*<string>([^<]*)</string>`))?.[1];
}

export function nodeScanFs(): ScanFs {
  return {
    home: () => homedir(),
    readdir: (path) => {
      try {
        return readdirSync(path);
      } catch {
        return [];
      }
    },
    isDirectory: (path) => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    },
    exists: (path) => existsSync(path),
    readTextCapped: (path, maxBytes) => readTextCappedSync(path, maxBytes),
    readAppIdentity: (appPath) => {
      const text = readTextCappedSync(join(appPath, "Contents/Info.plist"), 16_384);
      if (text === undefined) return undefined;
      const name = plistString(text, "CFBundleName");
      const identifier = plistString(text, "CFBundleIdentifier");
      if (name === undefined && identifier === undefined) return undefined;
      return { name, identifier };
    },
    processArgv: () => {
      try {
        return execFileSync("ps", ["-x", "-o", "command="], {
          encoding: "utf8",
          timeout: 500,
        }).split("\n").filter(Boolean);
      } catch {
        return [];
      }
    },
  };
}

export interface CollectorInstance {
  id: string;
  kind: CollectorKind;
  provider: Provider | null;
  label: string;
  dataDir: string;
  onboarded: boolean;
  ignored: boolean;
  default: boolean;
  discoveredAt: string;
  lastSeenAt: string;
  reason?: CollectorReason;
}

const COLLECTOR_INSTANCES_VERSION = 1;

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

function isCollectorKind(value: unknown): value is CollectorKind {
  return typeof value === "string" && value in PROVIDER_FOR;
}

function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);
}

function isCollectorReason(value: unknown): value is CollectorReason {
  return value === "needs-parser" || value === "needs-home-list";
}

function parseInstance(value: unknown): CollectorInstance | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id) return undefined;
  if (!isCollectorKind(record.kind)) return undefined;
  if (record.provider !== null && !isProvider(record.provider)) return undefined;
  if (typeof record.label !== "string") return undefined;
  if (typeof record.dataDir !== "string") return undefined;
  if (typeof record.onboarded !== "boolean") return undefined;
  if (typeof record.ignored !== "boolean") return undefined;
  if (typeof record.default !== "boolean") return undefined;
  if (typeof record.discoveredAt !== "string") return undefined;
  if (typeof record.lastSeenAt !== "string") return undefined;
  const instance: CollectorInstance = {
    id: record.id,
    kind: record.kind,
    provider: record.provider,
    label: record.label,
    dataDir: record.dataDir,
    onboarded: record.onboarded,
    ignored: record.ignored,
    default: record.default,
    discoveredAt: record.discoveredAt,
    lastSeenAt: record.lastSeenAt,
  };
  if (isCollectorReason(record.reason)) instance.reason = record.reason;
  return instance;
}

function parseRecord(value: unknown, path: string): { instances: CollectorInstance[]; loadError?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { instances: [], loadError: `collector instances at ${path} is not an object` };
  }
  const record = value as Record<string, unknown>;
  if (record.version !== COLLECTOR_INSTANCES_VERSION) {
    return { instances: [], loadError: `collector instances at ${path} has unknown version` };
  }
  if (!Array.isArray(record.instances)) {
    return { instances: [], loadError: `collector instances at ${path} is missing instances` };
  }
  return { instances: record.instances.flatMap((row) => {
    const instance = parseInstance(row);
    return instance ? [instance] : [];
  }) };
}

function copyInstance(instance: CollectorInstance): CollectorInstance {
  return { ...instance };
}

function applyInstancePatch(
  instances: CollectorInstance[],
  patch: { ids: string[]; onboarded?: boolean; ignored?: boolean; label?: string },
  rejectDefaultOff: boolean,
): void {
  for (const id of patch.ids) {
    const instance = instances.find((row) => row.id === id);
    if (!instance) continue;
    if (instance.default && patch.onboarded === false) {
      if (rejectDefaultOff) throw new Error("default collector instances cannot be turned off");
      continue;
    }
    if (patch.onboarded !== undefined) instance.onboarded = patch.onboarded;
    if (patch.ignored !== undefined) instance.ignored = patch.ignored;
    if (patch.label !== undefined) instance.label = patch.label;
  }
}

/* Import/ignore is its own file because HubSettings rejects unknown keys.
   Vanished extras stay so Ignore still has a row. Writes are temp-then-rename. */
export class JsonCollectorInstanceStore {
  #instances: CollectorInstance[];
  #writeQueue: Promise<void> = Promise.resolve();
  readonly #loadError?: string;

  private constructor(
    private readonly path: string,
    private readonly files: SettingsFileOperations,
    instances: CollectorInstance[],
    loadError?: string,
  ) {
    this.#instances = instances;
    this.#loadError = loadError;
  }

  static async open(
    path: string,
    files: SettingsFileOperations = nodeFiles,
  ): Promise<JsonCollectorInstanceStore> {
    let instances: CollectorInstance[] = [];
    let loadError: string | undefined;
    try {
      const loaded = parseRecord(JSON.parse(await files.readText(path)), path);
      instances = loaded.instances;
      loadError = loaded.loadError;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        loadError = `collector instances at ${path} could not be read: `
          + (error instanceof Error ? error.message : String(error));
      }
    }
    if (loadError) console.error(`[collector-instances] ${loadError}`);
    return new JsonCollectorInstanceStore(path, files, instances, loadError);
  }

  get loadError(): string | undefined {
    return this.#loadError;
  }

  get(): CollectorInstance[] {
    return this.#instances.map(copyInstance);
  }

  mergeScan(found: CollectorCandidate[], nowIso: string): CollectorInstance[] {
    for (const candidate of found) {
      const id = instanceIdFor(candidate.kind, candidate.dataDir);
      const existing = this.#instances.find((row) => row.id === id);
      if (existing) {
        existing.kind = candidate.kind;
        existing.provider = candidate.provider;
        existing.dataDir = candidate.dataDir;
        existing.default = candidate.default;
        existing.lastSeenAt = nowIso;
        if (candidate.reason) existing.reason = candidate.reason;
        else delete existing.reason;
        continue;
      }
      const instance: CollectorInstance = {
        id,
        kind: candidate.kind,
        provider: candidate.provider,
        label: candidate.label,
        dataDir: candidate.dataDir,
        onboarded: candidate.default,
        ignored: false,
        default: candidate.default,
        discoveredAt: nowIso,
        lastSeenAt: nowIso,
      };
      if (candidate.reason) instance.reason = candidate.reason;
      this.#instances.push(instance);
    }
    return this.get();
  }

  async #atomicWrite(instances: CollectorInstance[]): Promise<void> {
    await this.files.makeDirectory(dirname(this.path));
    const temp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    const record = { version: COLLECTOR_INSTANCES_VERSION, instances };
    await this.files.writeText(temp, `${JSON.stringify(record, null, 2)}\n`);
    await this.files.rename(temp, this.path);
  }

  async persistLastSeen(): Promise<CollectorInstance[]> {
    const write = this.#writeQueue.then(async () => {
      await this.#atomicWrite(this.#instances.map(copyInstance));
    });
    this.#writeQueue = write.catch(() => {});
    await write;
    return this.get();
  }

  async update(patch: {
    ids: string[];
    onboarded?: boolean;
    ignored?: boolean;
    label?: string;
  }): Promise<CollectorInstance[]> {
    const write = this.#writeQueue.then(async () => {
      const snapshot = this.#instances.map(copyInstance);
      applyInstancePatch(snapshot, patch, true);
      await this.#atomicWrite(snapshot);
      applyInstancePatch(this.#instances, patch, false);
    });
    this.#writeQueue = write.catch(() => {});
    await write;
    return this.get();
  }

  onboardedRoots(kind: CollectorKind): string[] {
    return this.#instances
      .filter((row) => row.kind === kind && row.onboarded && !row.default)
      .map((row) => row.dataDir);
  }

  onboardedGuiRoots(): string[] {
    return this.onboardedRoots("cursor-gui");
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

function collectorIdsFrom(record: Record<string, unknown>): string[] | undefined {
  if (Array.isArray(record.ids)) {
    if (record.ids.length === 0) return undefined;
    if (!record.ids.every((id): id is string => typeof id === "string" && id.length > 0)) {
      return undefined;
    }
    return record.ids;
  }
  if (typeof record.id === "string" && record.id.length > 0) return [record.id];
  return undefined;
}

export async function handleCollectorInstancesRequest(
  request: Request,
  store: JsonCollectorInstanceStore,
  options: { scan?: () => CollectorCandidate[]; afterUpdate?: () => void | Promise<void> } = {},
): Promise<Response> {
  const url = new URL(request.url);
  if (!isLoopback(url.hostname)) {
    return requestError(403, "ORIGIN_REJECTED", "Collector instances are only available on loopback.");
  }
  if (request.method === "GET") {
    const scan = options.scan ?? (() => scanAgentHomes(nodeScanFs()));
    const instances = store.mergeScan(scan(), new Date().toISOString());
    try {
      await store.persistLastSeen();
    } catch (error) {
      return requestError(500, "INSTANCE_WRITE_FAILED", error instanceof Error ? error.message : String(error));
    }
    return json({ ok: true, instances });
  }
  if (request.method !== "POST") {
    return requestError(405, "METHOD_NOT_ALLOWED", "Use GET or POST for collector instances.");
  }
  const origin = request.headers.get("origin");
  if (!origin || origin !== url.origin) {
    return requestError(403, "ORIGIN_REJECTED", "Collector instance changes require an exact same-origin loopback Origin header.");
  }
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return requestError(415, "CONTENT_TYPE_REJECTED", "Collector instance changes require application/json.");
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return requestError(400, "INVALID_JSON", "Collector instance body is not valid JSON.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return requestError(400, "INVALID_INSTANCE", "Body must be a JSON object.");
  }
  const record = raw as Record<string, unknown>;
  const ids = collectorIdsFrom(record);
  if (!ids) {
    return requestError(400, "INVALID_INSTANCE", "Body must include ids or id.");
  }
  const known = new Set(store.get().map((row) => row.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) {
    return requestError(400, "UNKNOWN_INSTANCE", `Unknown instance: ${unknown.join(", ")}.`);
  }
  const patch: { ids: string[]; onboarded?: boolean; ignored?: boolean; label?: string } = { ids };
  if ("onboarded" in record) {
    if (typeof record.onboarded !== "boolean") {
      return requestError(400, "INVALID_INSTANCE", "onboarded must be a boolean.");
    }
    patch.onboarded = record.onboarded;
  }
  if ("ignored" in record) {
    if (typeof record.ignored !== "boolean") {
      return requestError(400, "INVALID_INSTANCE", "ignored must be a boolean.");
    }
    patch.ignored = record.ignored;
  }
  if ("label" in record) {
    if (typeof record.label !== "string") {
      return requestError(400, "INVALID_INSTANCE", "label must be a string.");
    }
    patch.label = record.label;
  }
  if (patch.onboarded === false && store.get().some((row) => ids.includes(row.id) && row.default)) {
    return requestError(400, "DEFAULT_LOCKED", "Default collector instances cannot be turned off.");
  }
  try {
    const instances = await store.update(patch);
    await options.afterUpdate?.();
    return json({ ok: true, instances });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/default/i.test(message)) {
      return requestError(400, "DEFAULT_LOCKED", message);
    }
    return requestError(500, "INSTANCE_WRITE_FAILED", message);
  }
}
