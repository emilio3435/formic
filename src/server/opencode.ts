import { createHash } from "node:crypto";
import { existsSync, opendirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { makeAgent } from "./collectors";
import { foreignSqliteFailureMessage } from "./foreign-sqlite";
import {
  readOpenCodeStore,
  type OpenCodeReadOptions,
  type OpenCodeSessionEvidence,
  type OpenCodeTokenCounters,
} from "./opencode-store";
import type { CollectedAgent, CollectionResult } from "./types";

export interface OpenCodeCollectOptions {
  extraDataDirs?: readonly string[];
  configuredDatabasePath?: string;
  directoryEntryTestHook?: (directoryPath: string, entryName: string) => void;
  sqliteReadBudgetMs?: number;
  readOptions?: OpenCodeReadOptions;
}

interface OpenCodeDatabase {
  dataDir: string;
  filename: string;
  path: string;
  resolvedPath: string;
  token: string;
  instanceToken?: string;
  mtimeMs?: number;
  discoveryError?: string;
  extraRoot: boolean;
}

const OPENCODE_DATABASE = /^opencode(?:-[A-Za-z0-9][A-Za-z0-9._-]*)?\.db$/;
const OPENCODE_STORE_LIMIT = 16;

interface OpenCodeDatabaseDiscovery {
  value: OpenCodeDatabase[];
  errors: string[];
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason;
}

function runBoundedSync<T>(signal: AbortSignal | undefined, operation: () => T): T {
  throwIfAborted(signal);
  try {
    const result = operation();
    throwIfAborted(signal);
    return result;
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    throw error;
  }
}

function databaseNameOrder(left: string, right: string): number {
  if (left === "opencode.db") return right === "opencode.db" ? 0 : -1;
  if (right === "opencode.db") return 1;
  return left.localeCompare(right);
}

function directoryLimitError(dataDir: string): string {
  return `OpenCode data directory ${dataDir} scan was truncated: store admission limit ${OPENCODE_STORE_LIMIT} reached after one observed remainder entry; directory remainder was not enumerated.`;
}

function directoryDeadlineError(dataDir: string): string {
  return `OpenCode data directory ${dataDir} deadline expired; directory remainder was not enumerated.`;
}

function directoryDatabaseNames(
  dataDir: string,
  limit: number,
  options: OpenCodeReadOptions,
  directoryEntryTestHook?: (directoryPath: string, entryName: string) => void,
  excludedName?: string,
): { names: string[]; truncated: boolean; deadlineExpired: boolean } {
  const pastDeadline = (): boolean => {
    throwIfAborted(options.signal);
    const expired = options.deadlineAtMs !== undefined
      && (options.nowMs ?? Date.now)() >= options.deadlineAtMs;
    throwIfAborted(options.signal);
    return expired;
  };
  const admitted: string[] = [];
  let inspected = 0;
  let truncated = false;
  let directory: ReturnType<typeof opendirSync> | undefined;
  try {
    directory = runBoundedSync(options.signal, () => opendirSync(dataDir));
    while (true) {
      if (pastDeadline()) return { names: [], truncated: false, deadlineExpired: true };
      const entry = runBoundedSync(options.signal, () => directory!.readSync());
      if (entry === null) break;
      directoryEntryTestHook?.(dataDir, entry.name);
      throwIfAborted(options.signal);
      inspected += 1;
      if (inspected > limit) {
        truncated = true;
        break;
      }
      if (entry.name === excludedName) continue;
      if (!OPENCODE_DATABASE.test(entry.name)) continue;
      admitted.push(entry.name);
    }
  } finally {
    directory?.closeSync();
  }
  admitted.sort(databaseNameOrder);
  return { names: admitted, truncated, deadlineExpired: false };
}

function databaseToken(filename: string): string {
  return filename.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "opencode-db";
}

function rootToken(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 8);
}

function databases(
  dataDirs: readonly string[],
  configuredDatabasePath?: string,
  options: OpenCodeReadOptions = {},
  directoryEntryTestHook?: (directoryPath: string, entryName: string) => void,
): OpenCodeDatabaseDiscovery {
  const seen = new Set<string>();
  const found: OpenCodeDatabase[] = [];
  const errors: string[] = [];
  const roots: Array<{
    dataDir: string;
    extraRoot: boolean;
    configuredDatabasePath?: string;
  }> = configuredDatabasePath
    ? [{ dataDir: dirname(configuredDatabasePath), extraRoot: false, configuredDatabasePath }]
    : dataDirs.map((dataDir, index) => ({ dataDir, extraRoot: index > 0 }));
  for (const root of roots) {
    const { dataDir, extraRoot } = root;
    if (!existsSync(dataDir)) continue;
    let names: string[];
    let truncated = false;
    let incompleteError: string | undefined;
    try {
      if (!runBoundedSync(options.signal, () => statSync(dataDir)).isDirectory()) continue;
      if (root.configuredDatabasePath) {
        names = existsSync(root.configuredDatabasePath) ? [basename(root.configuredDatabasePath)] : [];
      } else {
        const remainingStoreLimit = Math.max(0, OPENCODE_STORE_LIMIT - found.length);
        const canonicalPresent = remainingStoreLimit > 0
          && runBoundedSync(options.signal, () => existsSync(join(dataDir, "opencode.db")));
        const admission = directoryDatabaseNames(
          dataDir,
          remainingStoreLimit,
          options,
          directoryEntryTestHook,
          canonicalPresent ? "opencode.db" : undefined,
        );
        if (admission.deadlineExpired) {
          incompleteError = directoryDeadlineError(dataDir);
        }
        names = [
          ...(canonicalPresent ? ["opencode.db"] : []),
          ...admission.names.slice(0, Math.max(0, remainingStoreLimit - (canonicalPresent ? 1 : 0))),
        ];
        truncated = admission.truncated;
      }
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      continue;
    }
    for (const filename of names) {
      if (
        options.deadlineAtMs !== undefined
        && (options.nowMs ?? Date.now)() >= options.deadlineAtMs
      ) {
        incompleteError ??= directoryDeadlineError(dataDir);
        break;
      }
      throwIfAborted(options.signal);
      const path = root.configuredDatabasePath ?? join(dataDir, filename);
      let resolvedPath: string;
      let mtimeMs: number | undefined;
      try {
        const details = statSync(path);
        if (!details.isFile()) {
          found.push({
            dataDir,
            filename,
            path,
            resolvedPath: path,
            token: databaseToken(filename),
            discoveryError: `OpenCode ${filename} is not a regular file`,
            extraRoot,
          });
          continue;
        }
        mtimeMs = details.mtimeMs;
        resolvedPath = realpathSync(path);
      } catch (error) {
        found.push({
          dataDir,
          filename,
          path,
          resolvedPath: path,
          token: databaseToken(filename),
          discoveryError: `OpenCode ${filename} could not be inspected: ${error instanceof Error ? error.message : String(error)}`,
          extraRoot,
        });
        continue;
      }
      if (seen.has(resolvedPath)) continue;
      seen.add(resolvedPath);
      found.push({
        dataDir,
        filename,
        path,
        resolvedPath,
        token: databaseToken(filename),
        mtimeMs,
        extraRoot,
      });
    }
    if (incompleteError) {
      errors.push(incompleteError);
      break;
    }
    if (truncated) {
      errors.push(directoryLimitError(dataDir));
      break;
    }
  }

  for (const database of found) {
    database.instanceToken = database.extraRoot
      ? `${database.token}-${rootToken(dirname(database.resolvedPath))}`
      : database.token;
  }
  return { value: found, errors };
}

function tokenUsage(
  session: OpenCodeSessionEvidence,
): CollectedAgent["tokens"] {
  const direct = session.sessionTokens;
  const latest = session.latestCallTokens;
  const callSizes = session.callSizes;
  const completeSeries = callSizes && session.callSizesComplete;
  if (!direct && !latest && !completeSeries) return { provenance: "unknown", scope: "unknown" };
  return {
    ...(direct ? {
      input: direct.nonCachedInput,
      output: direct.output,
      cachedInput: direct.cacheRead,
      sessionTotal: direct.nonCachedInput + direct.output + direct.reasoning + direct.cacheWrite,
      sessionCachedInput: direct.cacheRead,
    } : {}),
    ...(latest?.total !== undefined ? { total: latest.total } : {}),
    ...(completeSeries
      ? { sessionProcessed: callSizes.reduce((sum, size) => sum + size, 0) }
      : {}),
    scope: direct || completeSeries ? "session" : "latest-turn",
    provenance: "observed",
  };
}

function collectedSession(
  session: OpenCodeSessionEvidence,
  database: OpenCodeDatabase,
): CollectedAgent | undefined {
  const updatedAt = session.updatedAt ?? session.latestTurn?.completedAt ??
    session.latestTurn?.createdAt ?? session.startedAt;
  if (!updatedAt) return undefined;
  const identityCwd = session.earliestAssistantCwd ?? session.sourceDirectory;
  const model = session.rawModel
    ? `${session.rawModel.providerRoute}/${session.rawModel.modelId}`
    : undefined;
  const agent = makeAgent({
    provider: "opencode",
    sourceSessionId: session.sessionId,
    sourceTitle: session.sourceTitle,
    rawModel: session.rawModel,
    cwd: session.sourceDirectory,
    originCwd: session.earliestAssistantCwd,
    identityCwd,
    displayCwd: identityCwd,
    allowOriginCwdFallback: false,
    model,
    task: session.firstTask,
    startedAt: session.startedAt,
    updatedAt,
    tokens: tokenUsage(session),
    callSizes: session.callSizes,
    transcriptTail: session.transcriptTail?.text,
    parentSourceSessionId: session.parentSessionId,
    threadDepth: session.parentSessionId ? 1 : 0,
    humanMessages: session.prose.map((event) => ({
      role: event.role,
      content: event.text,
      timestamp: event.observedAt,
    })),
    exited: session.archivedAt !== undefined,
    endEvidence: session.archivedAt !== undefined ? "session-exit" : undefined,
    meta: { sourcePath: database.path, mtimeMs: database.mtimeMs },
  });
  const instanceToken = database.instanceToken ?? database.token;
  const instanceId = `opencode:${instanceToken}`;
  return {
    ...agent,
    id: `${instanceId}:${session.sessionId}`,
    instanceId,
    instanceLabel: database.filename,
    allowCwdFallback: false,
    artifacts: [{ label: "OpenCode store", path: database.path, kind: "transcript" }],
  };
}

export async function collectOpenCodeSessions(
  dataDir: string,
  options: OpenCodeCollectOptions = {},
  signal?: AbortSignal,
): Promise<CollectionResult<CollectedAgent[]>> {
  const readSignal = signal ?? options.readOptions?.signal;
  if (readSignal?.aborted) throw readSignal.reason;
  const deadlineAtMs = options.sqliteReadBudgetMs === undefined
    ? undefined
    : Date.now() + Math.max(0, Math.floor(options.sqliteReadBudgetMs));
  if (readSignal?.aborted) throw readSignal.reason;
  const readOptions: OpenCodeReadOptions = {
    ...options.readOptions,
    ...(readSignal ? { signal: readSignal } : {}),
    ...(deadlineAtMs === undefined ? {} : { deadlineAtMs }),
  };
  const discovery = databases(
    [dataDir, ...(options.extraDataDirs ?? [])],
    options.configuredDatabasePath,
    readOptions,
    options.directoryEntryTestHook,
  );
  const stores = discovery.value;
  if (stores.length === 0 && discovery.errors.length === 0) {
    return { value: [], errors: [], absent: true };
  }

  const value: CollectedAgent[] = [];
  const errors = [...discovery.errors];
  for (const database of stores) {
    if (readSignal?.aborted) throw readSignal.reason;
    if (database.discoveryError) {
      errors.push(database.discoveryError);
      continue;
    }
    try {
      const evidence = readOpenCodeStore(database.path, readOptions);
      for (const session of evidence.sessions) {
        if (readSignal?.aborted) throw readSignal.reason;
        const agent = collectedSession(session, database);
        if (agent) value.push(agent);
        else {
          errors.push(
            `OpenCode session ${session.sessionId} activity timestamp unavailable; session omitted`,
          );
        }
      }
      errors.push(...evidence.diagnostics.map((diagnostic) =>
        `OpenCode ${database.filename} ${diagnostic.kind}: ${diagnostic.detail}`
      ));
    } catch (error) {
      if (readSignal?.aborted) throw readSignal.reason;
      errors.push(`OpenCode ${basename(database.path)}: ${foreignSqliteFailureMessage(
        error,
        "OpenCode sessions from this store are unavailable for this scan",
      )}`);
    }
  }
  return { value, errors };
}
