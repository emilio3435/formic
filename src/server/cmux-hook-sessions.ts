import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PROVIDERS, type HookLifecycle, type Provider } from "../shared/types";

// cursor and factory records come from the T8 shims rather than native hooks;
// the reader treats every provider store identically.
const HOOK_PROVIDERS = PROVIDERS;
type HookProvider = Provider;

export interface HookSessionRecord {
  provider: HookProvider;
  sessionId: string;
  surfaceId: string;
  workspaceId: string;
  cwd: string;
  pid: number;
  pidStartSeconds?: number;
  transcriptPath?: string;
  agentLifecycle: HookLifecycle;
  lastPermissionMode?: string;
  launchCommand?: {
    executablePath: string;
    arguments: string[];
    workingDirectory: string;
  };
  updatedAt: number;
}

let recordsBySession = new Map<string, HookSessionRecord>();

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function lifecycle(value: unknown): HookLifecycle | undefined {
  return value === "idle" || value === "running" || value === "needsInput" || value === "ended" || value === "unknown"
    ? value
    : undefined;
}

function launchCommand(value: unknown): HookSessionRecord["launchCommand"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const command = value as Record<string, unknown>;
  if (!nonEmptyString(command.executablePath)
    || !Array.isArray(command.arguments)
    || !command.arguments.every((argument) => typeof argument === "string")
    || !nonEmptyString(command.workingDirectory)) return undefined;
  return {
    executablePath: command.executablePath,
    arguments: [...command.arguments],
    workingDirectory: command.workingDirectory,
  };
}

function parseRecord(provider: HookProvider, value: unknown): HookSessionRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const agentLifecycle = lifecycle(record.agentLifecycle);
  if (!nonEmptyString(record.sessionId)
    || !nonEmptyString(record.surfaceId)
    || !nonEmptyString(record.workspaceId)
    || !nonEmptyString(record.cwd)
    || !Number.isInteger(record.pid)
    || (record.pid as number) <= 0
    || !agentLifecycle
    || !finiteNumber(record.updatedAt)) return undefined;

  const command = launchCommand(record.launchCommand);
  return {
    provider,
    sessionId: record.sessionId,
    surfaceId: record.surfaceId,
    workspaceId: record.workspaceId,
    cwd: record.cwd,
    pid: record.pid as number,
    ...(finiteNumber(record.pidStartSeconds) ? { pidStartSeconds: record.pidStartSeconds } : {}),
    ...(nonEmptyString(record.transcriptPath) ? { transcriptPath: record.transcriptPath } : {}),
    agentLifecycle,
    ...(nonEmptyString(record.lastPermissionMode) ? { lastPermissionMode: record.lastPermissionMode } : {}),
    ...(command ? { launchCommand: command } : {}),
    updatedAt: record.updatedAt,
  };
}

function readStore(root: string, provider: HookProvider): HookSessionRecord[] {
  try {
    const parsed = JSON.parse(readFileSync(join(root, `${provider}-hook-sessions.json`), "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return [];
    const sessions = (parsed as Record<string, unknown>).sessions;
    if (!sessions || typeof sessions !== "object" || Array.isArray(sessions)) return [];
    return Object.values(sessions)
      .map((record) => parseRecord(provider, record))
      .filter((record): record is HookSessionRecord => Boolean(record));
  } catch {
    return [];
  }
}

export function readHookSessionStores(root = join(homedir(), ".cmuxterm")): HookSessionRecord[] {
  const records = HOOK_PROVIDERS.flatMap((provider) => readStore(root, provider));
  recordsBySession = new Map(
    records.map((record) => [`${record.provider}:${record.sessionId.toLowerCase()}`, record]),
  );
  return records;
}

export function hookRecordFor(provider: string, sessionId: string): HookSessionRecord | undefined {
  return recordsBySession.get(`${provider.toLowerCase()}:${sessionId.toLowerCase()}`);
}
