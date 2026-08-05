#!/usr/bin/env bun
/**
 * Prune dead `activeSessionsBySurface` / `activeSessionsByWorkspace` entries
 * from cmux hook-session stores after N days.
 *
 * An entry is dead when its sessionId is missing from `sessions`, or the
 * session's agentLifecycle is `ended`. Dead entries older than `--days`
 * (default 7) are removed. Session records themselves are left alone.
 *
 * Root: `--root` or `$ANTHILL_CMUXTERM_ROOT` (required in tests — never point
 * fixtures at the real `~/.cmuxterm`).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { atomicWriteJson } from "./lib/atomic-json";

export const DEFAULT_COMPACTION_DAYS = 7;
const KNOWN_PROVIDERS = ["claude", "codex", "omp", "cursor", "factory"] as const;

export interface CompactableStore {
  version?: number;
  sessions?: Record<string, Record<string, unknown>>;
  activeSessionsBySurface?: Record<string, { sessionId?: string; updatedAt?: number }>;
  activeSessionsByWorkspace?: Record<string, { sessionId?: string; updatedAt?: number }>;
  [key: string]: unknown;
}

export interface CompactOptions {
  nowSeconds?: number;
  maxAgeDays?: number;
}

export interface CompactResult {
  prunedSurfaceIds: string[];
  prunedWorkspaceIds: string[];
  store: CompactableStore;
}

function isDeadSession(
  sessions: Record<string, Record<string, unknown>>,
  sessionId: string | undefined,
): boolean {
  if (!sessionId) return true;
  const session = sessions[sessionId];
  if (!session) return true;
  return session.agentLifecycle === "ended";
}

export function compactHookStore(
  input: CompactableStore,
  options: CompactOptions = {},
): CompactResult {
  const nowSeconds = options.nowSeconds ?? Date.now() / 1000;
  const maxAgeDays = options.maxAgeDays ?? DEFAULT_COMPACTION_DAYS;
  const cutoff = nowSeconds - maxAgeDays * 86_400;
  const sessions = input.sessions && typeof input.sessions === "object" && !Array.isArray(input.sessions)
    ? input.sessions
    : {};

  const prunedSurfaceIds: string[] = [];
  const prunedWorkspaceIds: string[] = [];
  const activeSessionsBySurface = {
    ...(input.activeSessionsBySurface && typeof input.activeSessionsBySurface === "object"
      ? input.activeSessionsBySurface
      : {}),
  };
  const activeSessionsByWorkspace = {
    ...(input.activeSessionsByWorkspace && typeof input.activeSessionsByWorkspace === "object"
      ? input.activeSessionsByWorkspace
      : {}),
  };

  for (const [surfaceId, entry] of Object.entries(activeSessionsBySurface)) {
    const updatedAt = typeof entry?.updatedAt === "number" ? entry.updatedAt : undefined;
    if (updatedAt === undefined || updatedAt > cutoff) continue;
    if (!isDeadSession(sessions, entry?.sessionId)) continue;
    delete activeSessionsBySurface[surfaceId];
    prunedSurfaceIds.push(surfaceId);
  }

  for (const [workspaceId, entry] of Object.entries(activeSessionsByWorkspace)) {
    const updatedAt = typeof entry?.updatedAt === "number" ? entry.updatedAt : undefined;
    if (updatedAt === undefined || updatedAt > cutoff) continue;
    if (!isDeadSession(sessions, entry?.sessionId)) continue;
    delete activeSessionsByWorkspace[workspaceId];
    prunedWorkspaceIds.push(workspaceId);
  }

  return {
    prunedSurfaceIds,
    prunedWorkspaceIds,
    store: {
      ...input,
      sessions,
      activeSessionsBySurface,
      activeSessionsByWorkspace,
    },
  };
}

export function defaultHookStoreRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ANTHILL_CMUXTERM_ROOT?.trim();
  if (override) return override;
  return join(homedir(), ".cmuxterm");
}

export function compactHookStoreFile(
  path: string,
  options: CompactOptions & { dryRun?: boolean } = {},
): CompactResult & { path: string; wrote: boolean } {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as CompactableStore;
  const result = compactHookStore(parsed, options);
  const changed = result.prunedSurfaceIds.length > 0 || result.prunedWorkspaceIds.length > 0;
  if (changed && !options.dryRun) {
    atomicWriteJson(path, result.store);
  }
  return { ...result, path, wrote: changed && !options.dryRun };
}

function usage(): never {
  console.error(`Usage:
  bun scripts/cmux-hook-store-compact.ts [--root DIR] [--days N] [--provider NAME|all] [--dry-run]

Env:
  ANTHILL_CMUXTERM_ROOT  Override store root (required in tests)
`);
  process.exit(2);
}

function main(argv: string[]): void {
  let root = defaultHookStoreRoot();
  let days = DEFAULT_COMPACTION_DAYS;
  let provider: string = "all";
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--root") root = argv[++i] ?? usage();
    else if (arg === "--days") {
      days = Number(argv[++i]);
      if (!Number.isFinite(days) || days < 0) usage();
    } else if (arg === "--provider") provider = argv[++i] ?? usage();
    else if (arg === "--dry-run") dryRun = true;
    else usage();
  }

  if (!existsSync(root)) {
    console.error(`error: root does not exist: ${root}`);
    process.exit(1);
  }

  let providers: string[] = provider === "all"
    ? KNOWN_PROVIDERS.filter((name) => existsSync(join(root, `${name}-hook-sessions.json`)))
    : [provider];

  if (provider === "all" && providers.length === 0) {
    providers = readdirSync(root)
      .filter((name) => name.endsWith("-hook-sessions.json"))
      .map((name) => name.replace(/-hook-sessions\.json$/, ""));
  }

  const summary = [];
  for (const name of [...new Set(providers)]) {
    const path = join(root, `${name}-hook-sessions.json`);
    if (!existsSync(path)) continue;
    const result = compactHookStoreFile(path, {
      maxAgeDays: days,
      dryRun,
    });
    summary.push({
      provider: name,
      path: result.path,
      wrote: result.wrote,
      prunedSurfaceIds: result.prunedSurfaceIds,
      prunedWorkspaceIds: result.prunedWorkspaceIds,
    });
  }
  console.log(JSON.stringify({ root, days, dryRun, files: summary }, null, 2));
}

if (import.meta.main) {
  main(process.argv.slice(2));
}
