#!/usr/bin/env bun
/**
 * Atomic upsert helper for cmux hook-session stores.
 *
 * Writes `<root>/<provider>-hook-sessions.json` in the shape
 * `src/server/cmux-hook-sessions.ts` parses. Root defaults to
 * `$ANTHILL_CMUXTERM_ROOT` or `~/.cmuxterm`. Tests MUST set
 * ANTHILL_CMUXTERM_ROOT to a temp directory.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HookLifecycle } from "../src/shared/types";
import { atomicWriteJson } from "./lib/atomic-json";

export const HOOK_STORE_PROVIDERS = ["cursor", "factory"] as const;
export type HookStoreProvider = (typeof HOOK_STORE_PROVIDERS)[number];

export interface HookStoreLaunchCommand {
  executablePath: string;
  arguments: string[];
  workingDirectory: string;
}

export interface HookStoreRecordInput {
  sessionId: string;
  surfaceId: string;
  workspaceId: string;
  cwd: string;
  pid: number;
  agentLifecycle: HookLifecycle;
  updatedAt?: number;
  pidStartSeconds?: number;
  transcriptPath?: string;
  lastPermissionMode?: string;
  launchCommand?: HookStoreLaunchCommand;
}

export interface HookStoreFile {
  version: 1;
  sessions: Record<string, Record<string, unknown>>;
  activeSessionsBySurface: Record<string, { sessionId: string; updatedAt: number }>;
  activeSessionsByWorkspace: Record<string, { sessionId: string; updatedAt: number }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIFECYCLES = new Set<HookLifecycle>(["idle", "running", "needsInput", "ended", "unknown"]);

export function defaultHookStoreRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ANTHILL_CMUXTERM_ROOT?.trim();
  if (override) return override;
  return join(homedir(), ".cmuxterm");
}

export function hookStorePath(root: string, provider: HookStoreProvider): string {
  return join(root, `${provider}-hook-sessions.json`);
}

export function isHookStoreProvider(value: string): value is HookStoreProvider {
  return (HOOK_STORE_PROVIDERS as readonly string[]).includes(value);
}

export function isHookLifecycle(value: string): value is HookLifecycle {
  return LIFECYCLES.has(value as HookLifecycle);
}

/** Extract a session UUID from cursor-agent / droid argv when present. */
export function extractSessionIdFromArgs(
  provider: HookStoreProvider,
  args: readonly string[],
): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (provider === "cursor") {
      if (arg === "--resume") {
        const next = args[i + 1];
        if (next && UUID_RE.test(next)) return next;
      }
      if (arg.startsWith("--resume=") && UUID_RE.test(arg.slice("--resume=".length))) {
        return arg.slice("--resume=".length);
      }
      continue;
    }
    // factory / droid
    if (arg === "-r" || arg === "--resume" || arg === "--fork") {
      const next = args[i + 1];
      if (next && UUID_RE.test(next)) return next;
    }
    for (const prefix of ["--resume=", "--fork="] as const) {
      if (arg.startsWith(prefix) && UUID_RE.test(arg.slice(prefix.length))) {
        return arg.slice(prefix.length);
      }
    }
  }
  return undefined;
}

function emptyStore(): HookStoreFile {
  return {
    version: 1,
    sessions: {},
    activeSessionsBySurface: {},
    activeSessionsByWorkspace: {},
  };
}

function readStore(path: string): HookStoreFile {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<HookStoreFile>;
    if (!parsed || typeof parsed !== "object") return emptyStore();
    return {
      version: 1,
      sessions:
        parsed.sessions && typeof parsed.sessions === "object" && !Array.isArray(parsed.sessions)
          ? { ...parsed.sessions }
          : {},
      activeSessionsBySurface:
        parsed.activeSessionsBySurface
        && typeof parsed.activeSessionsBySurface === "object"
        && !Array.isArray(parsed.activeSessionsBySurface)
          ? { ...parsed.activeSessionsBySurface }
          : {},
      activeSessionsByWorkspace:
        parsed.activeSessionsByWorkspace
        && typeof parsed.activeSessionsByWorkspace === "object"
        && !Array.isArray(parsed.activeSessionsByWorkspace)
          ? { ...parsed.activeSessionsByWorkspace }
          : {},
    };
  } catch {
    return emptyStore();
  }
}

function assertRecordInput(input: HookStoreRecordInput): void {
  if (!input.sessionId.trim()) throw new Error("sessionId required");
  if (!input.surfaceId.trim()) throw new Error("surfaceId required");
  if (!input.workspaceId.trim()) throw new Error("workspaceId required");
  if (!input.cwd.trim()) throw new Error("cwd required");
  if (!Number.isInteger(input.pid) || input.pid <= 0) throw new Error("pid must be a positive integer");
  if (!isHookLifecycle(input.agentLifecycle)) throw new Error(`invalid agentLifecycle: ${input.agentLifecycle}`);
}

/** Shape gate matching `parseRecord` in cmux-hook-sessions.ts (minus provider). */
export function recordMatchesParserContract(record: Record<string, unknown>): boolean {
  const lifecycle = record.agentLifecycle;
  if (typeof record.sessionId !== "string" || record.sessionId.length === 0) return false;
  if (typeof record.surfaceId !== "string" || record.surfaceId.length === 0) return false;
  if (typeof record.workspaceId !== "string" || record.workspaceId.length === 0) return false;
  if (typeof record.cwd !== "string" || record.cwd.length === 0) return false;
  if (!Number.isInteger(record.pid) || (record.pid as number) <= 0) return false;
  if (lifecycle !== "idle" && lifecycle !== "running" && lifecycle !== "needsInput"
    && lifecycle !== "ended" && lifecycle !== "unknown") return false;
  if (typeof record.updatedAt !== "number" || !Number.isFinite(record.updatedAt)) return false;
  return true;
}

export function upsertHookSessionRecord(
  root: string,
  provider: HookStoreProvider,
  input: HookStoreRecordInput,
): string {
  assertRecordInput(input);
  const updatedAt = input.updatedAt ?? Date.now() / 1000;
  const path = hookStorePath(root, provider);
  const store = readStore(path);

  const record: Record<string, unknown> = {
    sessionId: input.sessionId,
    surfaceId: input.surfaceId,
    workspaceId: input.workspaceId,
    cwd: input.cwd,
    pid: input.pid,
    agentLifecycle: input.agentLifecycle,
    updatedAt,
  };
  if (input.pidStartSeconds !== undefined) record.pidStartSeconds = input.pidStartSeconds;
  if (input.transcriptPath) record.transcriptPath = input.transcriptPath;
  if (input.lastPermissionMode) record.lastPermissionMode = input.lastPermissionMode;
  if (input.launchCommand) {
    record.launchCommand = {
      executablePath: input.launchCommand.executablePath,
      arguments: [...input.launchCommand.arguments],
      workingDirectory: input.launchCommand.workingDirectory,
    };
  }

  if (!recordMatchesParserContract(record)) {
    throw new Error("refusing to write record that fails parser contract");
  }

  store.sessions[input.sessionId] = record;
  store.activeSessionsBySurface[input.surfaceId] = {
    sessionId: input.sessionId,
    updatedAt,
  };
  store.activeSessionsByWorkspace[input.workspaceId] = {
    sessionId: input.sessionId,
    updatedAt,
  };

  atomicWriteJson(path, store);
  return path;
}

function usage(): never {
  console.error(`Usage:
  bun scripts/cmux-hook-store.ts upsert --provider <cursor|factory> --session-id <uuid> \\
    --surface-id <id> --workspace-id <id> --cwd <path> --pid <n> --lifecycle <HookLifecycle> \\
    [--root <dir>] [--executable-path <path>] [--arg <string>]...

Env:
  ANTHILL_CMUXTERM_ROOT  Override store root (required in tests; never point fixtures at ~/.cmuxterm)
`);
  process.exit(2);
}

function readFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx < 0) return undefined;
  return args[idx + 1];
}

function readRepeatFlags(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === name && args[i + 1] !== undefined) {
      out.push(args[i + 1]!);
      i += 1;
    }
  }
  return out;
}

function main(argv: string[]): void {
  const [command, ...rest] = argv;
  if (command !== "upsert") usage();

  const providerRaw = readFlag(rest, "--provider");
  const sessionId = readFlag(rest, "--session-id");
  const surfaceId = readFlag(rest, "--surface-id");
  const workspaceId = readFlag(rest, "--workspace-id");
  const cwd = readFlag(rest, "--cwd");
  const pidRaw = readFlag(rest, "--pid");
  const lifecycle = readFlag(rest, "--lifecycle");
  const root = readFlag(rest, "--root") ?? defaultHookStoreRoot();
  const executablePath = readFlag(rest, "--executable-path");
  const launchArgs = readRepeatFlags(rest, "--arg");

  if (!providerRaw || !isHookStoreProvider(providerRaw)) usage();
  if (!sessionId || !surfaceId || !workspaceId || !cwd || !pidRaw || !lifecycle) usage();
  if (!isHookLifecycle(lifecycle)) usage();
  const pid = Number(pidRaw);
  if (!Number.isInteger(pid) || pid <= 0) usage();

  const path = upsertHookSessionRecord(root, providerRaw, {
    sessionId,
    surfaceId,
    workspaceId,
    cwd,
    pid,
    agentLifecycle: lifecycle,
    ...(executablePath
      ? {
          launchCommand: {
            executablePath,
            arguments: launchArgs,
            workingDirectory: cwd,
          },
        }
      : {}),
  });
  console.log(path);
}

if (import.meta.main) {
  main(process.argv.slice(2));
}
