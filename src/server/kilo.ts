import { createHash } from "node:crypto";
import { readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { makeAgent } from "./collectors";
import { foreignSqliteFailureMessage } from "./foreign-sqlite";
import {
  readKiloDataDir,
  readKiloStore,
  type KiloReadOptions,
  type KiloSessionEvidence,
  type KiloStoreEvidence,
} from "./kilo-store";
import type { CollectedAgent, CollectionResult } from "./types";

export interface KiloCollectOptions {
  extraDataDirs?: readonly string[];
  readOptions?: KiloReadOptions;
}

const KILO_STORE_NAME = /^(?:kilo(?:-[A-Za-z0-9._-]+)?|opencode-[A-Za-z0-9._-]+)\.db$/;

function filenameToken(path: string): string {
  return basename(path).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function rootIdentity(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

async function instanceId(
  path: string,
  alternate: boolean,
  identityParent = dirname(path),
): Promise<string> {
  const token = filenameToken(path);
  if (!alternate) return `kilo:${token}`;
  const suffix = createHash("sha256").update(identityParent).digest("hex").slice(0, 8);
  return `kilo:${token}-${suffix}`;
}

function collectionError(path: string, error: unknown): string {
  return `${path}: ${foreignSqliteFailureMessage(error, "Kilo population is unavailable")}`;
}

function evidenceErrors(path: string, evidence: KiloStoreEvidence): string[] {
  return evidence.diagnostics
    .filter(({ kind }) => kind === "deadline")
    .map(({ detail }) => `${path}: Kilo ${detail}`);
}

function isQualifiedDataDirError(dataDir: string, error: string): boolean {
  let offset = 0;
  while (true) {
    const separator = error.indexOf(": ", offset);
    if (separator === -1) return false;
    const source = error.slice(0, separator);
    if (dirname(source) === join(dataDir, ".") && KILO_STORE_NAME.test(basename(source))) {
      return true;
    }
    offset = separator + 2;
  }
}

async function agentFrom(
  session: KiloSessionEvidence,
  path: string,
  alternate: boolean,
  identityParent?: string,
): Promise<CollectedAgent | undefined> {
  if (!session.updatedAt) return undefined;
  const storeInstanceId = await instanceId(path, alternate, identityParent);
  const callSizes = session.callSizesComplete ? session.callSizes : undefined;
  const sessionProcessed = callSizes?.reduce((total, size) => total + size, 0);
  const latest = session.latestCallTokens;
  const cumulative = session.sessionTokens;
  const humanMessages = session.prose.map((event) => ({
    role: event.role,
    content: event.text,
    timestamp: event.observedAt,
  }));
  const agent = makeAgent({
    ...(callSizes ? { callSizes } : {}),
    provider: "kilo",
    sourceSessionId: session.sessionId,
    sourceTitle: session.sourceTitle,
    rawModel: session.rawModel,
    cwd: session.sourceDirectory,
    originCwd: session.earliestAssistantCwd,
    allowOriginCwdFallback: false,
    model: session.rawModel
      ? `${session.rawModel.providerRoute}/${session.rawModel.modelId}`
      : undefined,
    task: session.firstTask,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    tokens: cumulative
      ? {
          ...(latest
            ? {
                input: latest.input,
                output: latest.output,
                cachedInput: latest.cacheRead,
                ...(latest.total === undefined ? {} : { total: latest.total }),
              }
            : {}),
          sessionTotal: cumulative.input + cumulative.output
            + cumulative.reasoning + cumulative.cacheWrite,
          sessionCachedInput: cumulative.cacheRead,
          ...(sessionProcessed === undefined ? {} : { sessionProcessed }),
          scope: "session",
          provenance: "observed",
        }
      : { scope: "unknown", provenance: "unknown" },
    transcriptTail: session.transcriptTail?.text,
    parentSourceSessionId: session.parentSessionId,
    threadDepth: session.parentSessionId ? 1 : 0,
    humanMessages,
    exited: session.archivedAt !== undefined,
    endEvidence: "session-exit",
    meta: { sourcePath: path },
  });
  return {
    ...agent,
    id: `${storeInstanceId}:${session.sessionId}`,
    instanceId: storeInstanceId,
    instanceLabel: basename(path),
    artifacts: [{ label: "Kilo store", path, kind: "transcript" }],
    allowCwdFallback: false,
  };
}

async function collectEvidence(
  path: string,
  evidence: KiloStoreEvidence,
  alternate: boolean,
  identityParent?: string,
): Promise<{ agents: CollectedAgent[]; errors: string[] }> {
  const agents = (await Promise.all(
    evidence.sessions.map((session) => agentFrom(session, path, alternate, identityParent)),
  )).filter((agent): agent is CollectedAgent => agent !== undefined);
  return { agents, errors: evidenceErrors(path, evidence) };
}

async function nonRegularStoreErrors(dataDir: string): Promise<string[]> {
  try {
    const entries = await readdir(dataDir, { withFileTypes: true });
    return entries
      .filter((entry) => KILO_STORE_NAME.test(entry.name) && !entry.isFile())
      .map((entry) => `${join(dataDir, entry.name)}: Kilo store is not a regular file.`);
  } catch {
    return [];
  }
}

async function qualifiedDataDirErrors(dataDir: string, errors: readonly string[]): Promise<string[]> {
  if (errors.length === 0) return [];
  let source = dataDir;
  let storePaths: string[] = [];
  try {
    const names = (await readdir(dataDir))
      .filter((name) => KILO_STORE_NAME.test(name))
      .sort((left, right) => left.localeCompare(right));
    storePaths = names.map((name) => join(dataDir, name));
    if (storePaths[0]) source = storePaths[0];
  } catch {
    // The directory path remains the most specific evidence available.
  }
  return errors.map((error) =>
    storePaths.some((path) => error.startsWith(`${path}: `))
      || isQualifiedDataDirError(dataDir, error)
      ? error
      : `${source}: ${error}`
  );
}

export async function collectKiloSessions(
  home: string,
  options: KiloCollectOptions = {},
): Promise<CollectionResult<CollectedAgent[]>> {
  const xdgDataHome = home === homedir() ? process.env.XDG_DATA_HOME?.trim() : undefined;
  const selectedRoot = xdgDataHome
    ? join(xdgDataHome, "kilo")
    : join(home, ".local/share/kilo");
  const configured = process.env.KILO_DB?.trim();
  if (configured === ":memory:") return { value: [], errors: [] };

  if (configured) {
    const absoluteConfigured = isAbsolute(configured);
    const path = absoluteConfigured ? configured : join(selectedRoot, configured);
    try {
      const evidence = readKiloStore(path, options.readOptions);
      if (evidence.absent) {
        if (absoluteConfigured) return { value: [], errors: [], absent: true };
        return { value: [], errors: [`${path}: Kilo configured store is absent.`] };
      }
      const collected = await collectEvidence(path, evidence, false);
      return { value: collected.agents, errors: collected.errors };
    } catch (error) {
      return { value: [], errors: [collectionError(path, error)] };
    }
  }

  const roots: Array<{ path: string; alternate: boolean; identityParent?: string }> = [];
  const rootsByIdentity = new Map<string, (typeof roots)[number]>();
  for (const [path, alternate] of [
    [selectedRoot, false],
    ...(options.extraDataDirs ?? []).map((extra) => [extra, true] as const),
  ] as const) {
    const identity = await rootIdentity(path);
    const existing = rootsByIdentity.get(identity);
    if (existing) {
      existing.identityParent = identity;
      continue;
    }
    const root = { path, alternate };
    rootsByIdentity.set(identity, root);
    roots.push(root);
  }

  const agents: CollectedAgent[] = [];
  const errors: string[] = [];
  let present = false;
  for (const root of roots) {
    const evidence = readKiloDataDir(root.path, options.readOptions);
    if (!evidence.absent) present = true;
    errors.push(
      ...await qualifiedDataDirErrors(root.path, evidence.errors),
      ...await nonRegularStoreErrors(root.path),
    );
    for (const store of evidence.stores) {
      const collected = await collectEvidence(
        store.path,
        store.evidence,
        root.alternate,
        root.identityParent,
      );
      agents.push(...collected.agents);
      errors.push(...collected.errors);
    }
  }
  return {
    value: agents,
    errors,
    ...(!present && errors.length === 0 ? { absent: true } : {}),
  };
}
