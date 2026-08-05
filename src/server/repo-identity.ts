import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { RepoIdentity } from "../shared/types";

export type { RepoIdentity } from "../shared/types";

export interface RepoIdentityExecResult {
  exitCode: number;
  stdout: string;
}

export type RepoIdentityExec = (command: readonly string[]) => RepoIdentityExecResult;

export interface RepoIdentityOptions {
  exec?: RepoIdentityExec;
  realpath?: (path: string) => string;
  now?: () => number;
}

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  expiresAt: number;
  value: RepoIdentity | null;
}

const caches = new WeakMap<RepoIdentityExec, Map<string, CacheEntry>>();

const defaultExec: RepoIdentityExec = (command) => {
  const result = Bun.spawnSync([...command], { stdout: "pipe", stderr: "ignore" });
  return { exitCode: result.exitCode, stdout: result.stdout.toString() };
};

export function fnvKey(value: string): string {
  let result = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16_777_619);
  }
  return (result >>> 0).toString(36);
}

function normalizedRemotePath(value: string): string | undefined {
  const path = value
    .replaceAll("\\", "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.git$/i, "");
  return path || undefined;
}

/* One logical repository can have HTTPS and SSH clones in unrelated folders.
   Keep only the stable host/path identity: schemes and credentials describe
   transport, while a final .git is optional spelling. The normalized value is
   hashed immediately and is never published. */
function normalizedOrigin(value: string): string | undefined {
  const remote = value.split(/\r?\n/, 1)[0]?.trim();
  if (!remote) return undefined;
  if (remote.includes("://")) {
    try {
      const url = new URL(remote);
      const path = normalizedRemotePath(url.pathname);
      if (!path) return undefined;
      if (url.protocol === "file:") return `file:/${path}`;
      if (!url.hostname) return undefined;
      const host = url.hostname.toLowerCase();
      return `${host}${url.port ? `:${url.port}` : ""}/${path}`;
    } catch {
      return undefined;
    }
  }
  const scp = /^(?:[^@\s/:]+@)?([^:/\s]+):(.+)$/.exec(remote);
  const path = scp ? normalizedRemotePath(scp[2] ?? "") : undefined;
  return scp && path ? `${scp[1]!.toLowerCase()}/${path}` : undefined;
}

function isWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

export function isEphemeralWorktree(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "");
  const home = homedir().replaceAll("\\", "/").replace(/\/+$/, "");
  return isWithin(normalized, `${home}/.codex/worktrees`)
    || isWithin(normalized, `${home}/.claude/worktrees`)
    || isWithin(normalized, "/tmp")
    || isWithin(normalized, "/private/tmp")
    || /\/\.worktrees(?:\/|$)/.test(normalized);
}

function readIdentity(
  cwd: string,
  exec: RepoIdentityExec,
  canonicalPath: (path: string) => string,
): RepoIdentity | null {
  const result = exec([
    "git",
    "-C",
    cwd,
    "rev-parse",
    "--git-common-dir",
    "--show-toplevel",
    "--abbrev-ref",
    "HEAD",
  ]);
  if (result.exitCode !== 0) return null;
  const [commonDirRaw, worktreeRaw, branchRaw] = result.stdout.split(/\r?\n/);
  if (!commonDirRaw?.trim() || !worktreeRaw?.trim()) return null;
  try {
    const commonDir = canonicalPath(resolve(cwd, commonDirRaw.trim()));
    const worktreePath = canonicalPath(resolve(cwd, worktreeRaw.trim()));
    const branch = branchRaw?.trim();
    const remote = exec(["git", "-C", cwd, "remote", "get-url", "origin"]);
    const origin = remote.exitCode === 0 ? normalizedOrigin(remote.stdout) : undefined;
    return {
      repoKey: fnvKey(origin ?? commonDir),
      repoName: origin ? basename(origin) : basename(dirname(commonDir)),
      worktreePath,
      ...(branch && branch !== "HEAD" ? { branch } : {}),
      ephemeral: isEphemeralWorktree(worktreePath),
    };
  } catch {
    return null;
  }
}

export function resolveRepoIdentity(
  cwd: string,
  options: RepoIdentityOptions = {},
): RepoIdentity | null {
  const exec = options.exec ?? defaultExec;
  const canonicalPath = options.realpath ?? realpathSync;
  const now = options.now ?? Date.now;
  let canonicalCwd: string;
  try {
    canonicalCwd = canonicalPath(cwd);
  } catch {
    return null;
  }
  let cache = caches.get(exec);
  if (!cache) {
    cache = new Map();
    caches.set(exec, cache);
  }
  const cached = cache.get(canonicalCwd);
  const nowMs = now();
  if (cached && cached.expiresAt > nowMs) return cached.value;
  const value = readIdentity(canonicalCwd, exec, canonicalPath);
  cache.set(canonicalCwd, { expiresAt: nowMs + CACHE_TTL_MS, value });
  return value;
}
