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
    return {
      repoKey: fnvKey(commonDir),
      repoName: basename(dirname(commonDir)),
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
