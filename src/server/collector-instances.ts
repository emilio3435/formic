import { closeSync, openSync, readSync } from "node:fs";
import { basename, join, normalize } from "node:path";
import type { Provider } from "../shared/types";

export type CollectorKind =
  | "cursor-gui" | "cursor-cli" | "codex" | "claude" | "factory"
  | "prime" | "omp" | "grok-cli" | "hermes" | "grok-bot"
  | "burnbar" | "cmux-hooks" | "unknown";

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
  "grok-bot": null,
  "burnbar": null,
  "cmux-hooks": null,
  "unknown": null,
} as const satisfies Record<CollectorKind, Provider | null>;

const NAME_TOKEN_RE = /^(claude|codex|cursor|grok|hermes|factory|prime|omp|droid|aider|continue|opencode|gemini|windsurf|copilot|crush|amp)/i;
const AGENT_MENTION_RE = /(claude|codex|cursor|grok|hermes|factory|prime|omp|droid|aider|continue|opencode|gemini|windsurf|copilot|crush|amp)/i;
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

function grokCliReason(dataDir: string, fs: ScanFs): CollectorReason | undefined {
  return isDefaultDataDir(dataDir, fs.home()) ? undefined : "needs-home-list";
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

function argvPointsAt(dataDir: string, fs: ScanFs): boolean {
  return fs.processArgv().some((argv) => {
    const userData = extractedUserDataDir(argv);
    const home = extractedHomeFlag(argv);
    return (userData !== undefined && samePath(userData, dataDir))
      || (home !== undefined && samePath(home, dataDir));
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
    return candidate("grok-cli", dataDir, fs, grokCliReason(dataDir, fs));
  }
  if (isDotFamily(base, "hermes") && (fs.isDirectory(join(dataDir, "sessions")) || fs.isDirectory(join(dataDir, "cron")))) {
    return candidate("hermes", dataDir, fs);
  }
  if (base.startsWith("Grok Bot") && fs.isDirectory(join(dataDir, "sand-client-persistence"))) {
    return candidate("grok-bot", dataDir, fs, "needs-parser");
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
    const dataDir = extractedUserDataDir(text) ?? extractedHomeFlag(text);
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
    const dataDir = normalizePath(raw);
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

  scanApps(join(home, "Applications"));
  scanApps("/Applications");

  for (const name of fs.readdir(join(home, "Library/Application Support"))) {
    if (Date.now() > deadline) break;
    if (SKIP_ROOT_NAMES.has(name) || name === "." || name === "..") continue;
    const dir = join(home, "Library/Application Support", name);
    if (fs.isDirectory(dir)) consider(dir);
  }

  for (const name of fs.readdir(home)) {
    if (Date.now() > deadline) break;
    if (name === "." || name === ".." || !DOTDIR_RE.test(name) || SKIP_ROOT_NAMES.has(name)) continue;
    const dir = join(home, name);
    if (fs.isDirectory(dir)) consider(dir);
  }

  for (const argv of fs.processArgv()) {
    if (Date.now() > deadline) break;
    const extracted = extractedUserDataDir(argv) ?? extractedHomeFlag(argv);
    if (!extracted) continue;
    if (isUnder(extracted, home) || isUnder(extracted, "/Applications")) consider(extracted);
  }

  return hits;
}
