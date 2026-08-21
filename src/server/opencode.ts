import { createHash } from "node:crypto";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
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

function databaseToken(filename: string): string {
  return filename.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "opencode-db";
}

function rootToken(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 8);
}

function databases(
  dataDirs: readonly string[],
  configuredDatabasePath?: string,
): OpenCodeDatabase[] {
  const seen = new Set<string>();
  const found: OpenCodeDatabase[] = [];
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
    try {
      if (!statSync(dataDir).isDirectory()) continue;
      names = root.configuredDatabasePath
        ? (existsSync(root.configuredDatabasePath) ? [basename(root.configuredDatabasePath)] : [])
        : readdirSync(dataDir)
          .filter((name) => OPENCODE_DATABASE.test(name))
          .sort((left, right) => {
            if (left === "opencode.db") return right === "opencode.db" ? 0 : -1;
            if (right === "opencode.db") return 1;
            return left.localeCompare(right);
          });
    } catch {
      continue;
    }
    for (const filename of names) {
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
  }

  for (const database of found) {
    database.instanceToken = database.extraRoot
      ? `${database.token}-${rootToken(dirname(database.resolvedPath))}`
      : database.token;
  }
  return found;
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
): Promise<CollectionResult<CollectedAgent[]>> {
  const stores = databases(
    [dataDir, ...(options.extraDataDirs ?? [])],
    options.configuredDatabasePath,
  );
  if (stores.length === 0) return { value: [], errors: [], absent: true };

  const value: CollectedAgent[] = [];
  const errors: string[] = [];
  for (const database of stores) {
    if (database.discoveryError) {
      errors.push(database.discoveryError);
      continue;
    }
    try {
      const evidence = readOpenCodeStore(database.path, options.readOptions);
      for (const session of evidence.sessions) {
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
      errors.push(`OpenCode ${basename(database.path)}: ${foreignSqliteFailureMessage(
        error,
        "OpenCode sessions from this store are unavailable for this scan",
      )}`);
    }
  }
  return { value, errors };
}
