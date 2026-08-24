import type { Stats } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, join, normalize } from "node:path";
import type { TokenUsage } from "../shared/types";
import { instanceIdFor, isGrokBotProductCache } from "./collector-instances";
import type { LifecycleThresholds } from "./lifecycle";
import { makeAgent, type ParseMetadata } from "./collectors";
import { readableHumanMessage, type HumanMessageCandidate } from "./human-message";
import {
  appendJsonFileRange,
  appendJsonlText,
  sameFileSnapshot,
  type JsonRecord,
} from "./jsonl-reader";
import { ThreadClock } from "./thread-clock";
import type { CollectedAgent, CollectionResult } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GrokSessionInput {
  sourceSessionId: string;
  cwd?: string;
  summaryJson?: string;
  signalsJson?: string;
  updatesJsonl?: string;
}

interface GrokCollectedSession {
  projectName: string;
  sessionName: string;
  sessionRoot: string;
  agent: CollectedAgent;
}

interface GrokMetaParents {
  byProject: Map<string, Map<string, Set<string>>>;
  all: Map<string, Set<string>>;
}

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function parsedRecord(json: string | undefined): JsonRecord | undefined {
  if (json === undefined) return undefined;
  try {
    return record(JSON.parse(json));
  } catch {
    return undefined;
  }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sessionUuid(value: unknown): string | undefined {
  const valueText = text(value);
  return valueText && UUID.test(valueText) ? valueText.toLowerCase() : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function timestamp(value: unknown): string | undefined {
  const millis = typeof value === "number"
    ? value * (value < 10_000_000_000 ? 1_000 : 1)
    : typeof value === "string"
      ? Date.parse(value)
      : Number.NaN;
  return Number.isFinite(millis) ? new Date(millis).toISOString() : undefined;
}

function later(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(right) > Date.parse(left) ? right : left;
}

function updateText(update: JsonRecord): string | undefined {
  const content = record(update.content);
  return text(content?.text) ?? text(update.content);
}

interface IndexedGrokMessage {
  index: number;
  candidate: HumanMessageCandidate;
}

interface GrokUpdateFacts {
  task?: string;
  tail?: string;
  updatedAt?: string;
  startedAt?: string;
  exited: boolean;
  messages: HumanMessageCandidate[];
  lastHumanFacingAt?: string;
  thread: { lastThreadAt?: string; workingSince?: string };
}

interface GrokUpdateParser {
  append(rows: readonly JsonRecord[]): void;
  result(): GrokUpdateFacts;
}

function createGrokUpdateParser(): GrokUpdateParser {
  let task: string | undefined;
  let tail: string | undefined;
  let updatedAt: string | undefined;
  let startedAt: string | undefined;
  let exited = false;
  let lastHumanFacingAt: string | undefined;
  let index = 0;
  const latest: Partial<Record<HumanMessageCandidate["role"], IndexedGrokMessage>> = {};
  const clock = new ThreadClock();

  const rememberMessage = (
    role: HumanMessageCandidate["role"],
    content: string,
    at: string | undefined,
    rowIndex: number,
  ): void => {
    const candidate: HumanMessageCandidate = { role, content, timestamp: at };
    if (!readableHumanMessage("grok", content)) return;
    latest[role] = { index: rowIndex, candidate };
    lastHumanFacingAt = later(lastHumanFacingAt, at);
  };

  return {
    append(rows) {
      for (const row of rows) {
        const rowIndex = index++;
        const params = record(row.params);
        const update = record(params?.update);
        if (!update) continue;
        const at = timestamp(row.timestamp) ?? timestamp(record(params?._meta)?.agentTimestampMs);
        startedAt ??= at;
        updatedAt = later(updatedAt, at);
        const kind = text(update.sessionUpdate);
        if (kind === "user_message_chunk") {
          if (record(update._meta)?.hideFromScrollback === true) continue;
          const content = updateText(update);
          if (content) {
            task ??= content;
            rememberMessage("user", content, at, rowIndex);
            clock.observe(at, "user");
          }
          exited = false;
        } else if (kind === "agent_message_chunk") {
          const content = updateText(update);
          if (content) {
            tail = content;
            rememberMessage("assistant", content, at, rowIndex);
            clock.observe(at, "assistant");
          }
          exited = false;
        } else if (kind === "turn_completed") {
          exited = true;
          // The old parser used `exited` to close the inferred message clock;
          // the completion timestamp was not itself a human-facing thread row.
          clock.observe(undefined, "system", { endsTurn: true });
        }
      }
    },
    result() {
      const messages = [latest.user, latest.assistant]
        .filter((message): message is IndexedGrokMessage => Boolean(message))
        .sort((left, right) => left.index - right.index)
        .map(({ candidate }) => candidate);
      return {
        task,
        tail,
        updatedAt,
        startedAt,
        exited,
        messages,
        lastHumanFacingAt,
        thread: clock.snapshot(),
      };
    },
  };
}

function tokenUsage(signals: JsonRecord | undefined): TokenUsage {
  const total = finite(signals?.contextTokensUsed);
  const contextWindow = finite(signals?.contextWindowTokens);
  if (total === undefined) {
    return {
      scope: "unknown",
      provenance: "unknown",
      ...(contextWindow !== undefined ? { contextWindow } : {}),
    };
  }
  return {
    total,
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    scope: "latest-turn",
    provenance: "observed",
  };
}

function makeGrokSession(
  input: GrokSessionInput,
  updates: GrokUpdateFacts,
  meta: ParseMetadata,
): CollectedAgent {
  const summary = parsedRecord(input.summaryJson);
  const info = record(summary?.info);
  const signals = parsedRecord(input.signalsJson);

  const summaryUpdatedAt = timestamp(summary?.last_active_at ?? summary?.updated_at);
  const fallbackUpdatedAt = new Date(meta.mtimeMs ?? meta.nowMs ?? Date.now()).toISOString();
  const model = text(summary?.current_model_id) ?? text(signals?.primaryModelId);
  const parentSourceSessionId = sessionUuid(summary?.parent_session_id)
    ?? sessionUuid(info?.parent_session_id);

  return makeAgent({
    provider: "grok",
    sourceSessionId: input.sourceSessionId,
    displayName: text(summary?.generated_title)
      ?? text(summary?.session_summary)
      ?? text(summary?.agent_name),
    cwd: text(info?.cwd) ?? input.cwd,
    model,
    task: updates.task,
    startedAt: timestamp(summary?.created_at) ?? updates.startedAt,
    updatedAt: later(summaryUpdatedAt, updates.updatedAt) ?? fallbackUpdatedAt,
    tokens: tokenUsage(signals),
    transcriptTail: updates.tail,
    humanMessages: updates.messages,
    lastHumanFacingAt: updates.lastHumanFacingAt,
    thread: updates.thread,
    parentSourceSessionId,
    exited: updates.exited,
    endEvidence: "turn-complete",
    meta,
  });
}

export function parseGrokSession(
  input: GrokSessionInput,
  meta: ParseMetadata = {},
): CollectedAgent {
  const parser = createGrokUpdateParser();
  if (input.updatesJsonl) {
    appendJsonlText(input.updatesJsonl, (rows) => parser.append(rows));
  }
  return makeGrokSession(input, parser.result(), meta);
}

function missing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function optionalStat(path: string, errors: string[]): Promise<Stats | undefined> {
  try {
    return await stat(path);
  } catch (error) {
    if (!missing(error)) errors.push(`${path}: ${describe(error)}`);
    return undefined;
  }
}

async function optionalFile(
  path: string,
  details: Stats | undefined,
  errors: string[],
): Promise<{ text?: string }> {
  if (!details) return {};
  try {
    return { text: await readFile(path, "utf8") };
  } catch (error) {
    if (!missing(error)) errors.push(`${path}: ${describe(error)}`);
    return {};
  }
}

async function parseStableGrokUpdates(
  path: string,
  initialDetails: Stats,
): Promise<{ details: Stats; updates: GrokUpdateFacts }> {
  let details = initialDetails;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parser = createGrokUpdateParser();
    const remainder = await appendJsonFileRange(
      path,
      0,
      details.size,
      Buffer.alloc(0),
      (rows) => parser.append(rows),
    );
    const after = await stat(path);
    if (sameFileSnapshot(details, after)) {
      if (remainder.length > 0) {
        appendJsonlText(remainder.toString("utf8"), (rows) => parser.append(rows));
      }
      return { details, updates: parser.result() };
    }
    details = after;
  }
  throw new Error("updates changed during collection");
}

function decodedCwd(encoded: string): string | undefined {
  try {
    const value = decodeURIComponent(encoded);
    return value.startsWith("/") ? value : undefined;
  } catch {
    return undefined;
  }
}

async function resolvedPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    const trimmed = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
    return normalize(trimmed);
  }
}

function addMetaParent(
  parents: GrokMetaParents,
  projectName: string,
  childSessionId: string,
  parentSessionId: string,
): void {
  const byChild = parents.byProject.get(projectName) ?? new Map<string, Set<string>>();
  const projectCandidates = byChild.get(childSessionId) ?? new Set<string>();
  const allCandidates = parents.all.get(childSessionId) ?? new Set<string>();
  projectCandidates.add(parentSessionId);
  allCandidates.add(parentSessionId);
  byChild.set(childSessionId, projectCandidates);
  parents.byProject.set(projectName, byChild);
  parents.all.set(childSessionId, allCandidates);
}

async function collectMetaParents(
  sessions: readonly GrokCollectedSession[],
  errors: string[],
): Promise<GrokMetaParents> {
  const parents: GrokMetaParents = { byProject: new Map(), all: new Map() };

  for (const { projectName, sessionName, sessionRoot } of sessions) {
    const subagentsRoot = join(sessionRoot, "subagents");
    let children;
    try {
      children = await readdir(subagentsRoot, { withFileTypes: true });
    } catch (error) {
      if (!missing(error)) errors.push(`grok ${subagentsRoot}: ${describe(error)}`);
      continue;
    }
    for (const child of children) {
      if (!child.isDirectory() || !UUID.test(child.name)) continue;
      const childSessionId = child.name.toLowerCase();
      const metaPath = join(subagentsRoot, child.name, "meta.json");
      const details = await optionalStat(metaPath, errors);
      const metadata = parsedRecord((await optionalFile(metaPath, details, errors)).text);
      const recordedChildId = sessionUuid(metadata?.child_session_id);
      const parentSessionId = sessionUuid(metadata?.parent_session_id);
      if (recordedChildId !== childSessionId || parentSessionId !== sessionName) continue;
      addMetaParent(parents, projectName, childSessionId, parentSessionId);
    }
  }

  return parents;
}

function onlyParent(candidates: ReadonlySet<string> | undefined): string | undefined {
  return candidates?.size === 1 ? candidates.values().next().value : undefined;
}

function metaParentFor(
  parents: GrokMetaParents,
  projectName: string,
  childSessionId: string,
): string | undefined {
  const sameProject = parents.byProject.get(projectName)?.get(childSessionId);
  return sameProject
    ? onlyParent(sameProject)
    : onlyParent(parents.all.get(childSessionId));
}

async function collectGrokRoot(
  root: string,
  windowMs: number,
  thresholds?: LifecycleThresholds,
): Promise<CollectionResult<CollectedAgent[]>> {
  const errors: string[] = [];
  try {
    await readdir(root);
  } catch (error) {
    if (missing(error)) return { value: [], errors: [], absent: true };
    return { value: [], errors: [`grok ${root}: ${describe(error)}`] };
  }

  const sessionsRoot = join(root, "sessions");
  let projects;
  try {
    projects = await readdir(sessionsRoot, { withFileTypes: true });
  } catch (error) {
    if (missing(error)) return { value: [], errors: [] };
    return { value: [], errors: [`grok ${sessionsRoot}: ${describe(error)}`] };
  }

  const collectedSessions: GrokCollectedSession[] = [];
  const nowMs = Date.now();
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const projectRoot = join(sessionsRoot, project.name);
    let sessions;
    try {
      sessions = await readdir(projectRoot, { withFileTypes: true });
    } catch (error) {
      errors.push(`grok ${projectRoot}: ${describe(error)}`);
      continue;
    }
    for (const session of sessions) {
      if (!session.isDirectory() || !UUID.test(session.name)) continue;
      const sessionName = session.name.toLowerCase();
      const sessionRoot = join(projectRoot, session.name);
      try {
        const summaryPath = join(sessionRoot, "summary.json");
        const signalsPath = join(sessionRoot, "signals.json");
        const updatesPath = join(sessionRoot, "updates.jsonl");
        const directory = await stat(sessionRoot);
        const summaryDetails = await optionalStat(summaryPath, errors);
        const signalsDetails = await optionalStat(signalsPath, errors);
        const updatesDetails = await optionalStat(updatesPath, errors);
        let mtimeMs = Math.max(
          directory.mtimeMs,
          summaryDetails?.mtimeMs ?? 0,
          signalsDetails?.mtimeMs ?? 0,
          updatesDetails?.mtimeMs ?? 0,
        );
        if (nowMs - mtimeMs > windowMs) continue;

        const summary = await optionalFile(summaryPath, summaryDetails, errors);
        const signals = await optionalFile(signalsPath, signalsDetails, errors);
        let updates = createGrokUpdateParser().result();
        let updatesRead = false;
        if (updatesDetails) {
          try {
            const parsed = await parseStableGrokUpdates(updatesPath, updatesDetails);
            updates = parsed.updates;
            updatesRead = true;
            mtimeMs = Math.max(mtimeMs, parsed.details.mtimeMs);
          } catch (error) {
            if (!missing(error)) errors.push(`${updatesPath}: ${describe(error)}`);
          }
        }

        const sourcePath = updatesRead
          ? updatesPath
          : summary.text !== undefined
            ? summaryPath
            : undefined;
        const agent = makeGrokSession({
          sourceSessionId: sessionName,
          cwd: decodedCwd(project.name),
          summaryJson: summary.text,
          signalsJson: signals.text,
        }, updates, { sourcePath, mtimeMs, thresholds });
        collectedSessions.push({
          projectName: project.name,
          sessionName,
          sessionRoot,
          agent,
        });
      } catch (error) {
        if (!missing(error)) errors.push(`grok ${sessionRoot}: ${describe(error)}`);
      }
    }
  }

  const metaParents = await collectMetaParents(collectedSessions, errors);
  for (const session of collectedSessions) {
    session.agent.parentSourceSessionId ??= metaParentFor(
      metaParents,
      session.projectName,
      session.sessionName,
    );
  }

  return { value: collectedSessions.map(({ agent }) => agent), errors };
}

export async function collectGrokSessions(
  root: string,
  windowMs: number,
  thresholds?: LifecycleThresholds,
  extraRoots: readonly string[] = [],
): Promise<CollectionResult<CollectedAgent[]>> {
  const primary = await collectGrokRoot(root, windowMs, thresholds);
  const agents = [...primary.value];
  const errors = [...primary.errors];
  const seen = new Set(agents.map((agent) => agent.id));
  const defaultPath = await resolvedPath(root);

  for (const extra of extraRoots) {
    if (isGrokBotProductCache(extra)) continue;
    const extraPath = await resolvedPath(extra);
    if (extraPath === defaultPath) continue;
    const collected = await collectGrokRoot(extra, windowMs, thresholds);
    if (collected.absent) {
      errors.push(`grok extra CLI root ${extra}: not found`);
      continue;
    }
    errors.push(...collected.errors);
    for (const agent of collected.value) {
      agent.instanceId = instanceIdFor("grok-cli", extra);
      agent.instanceLabel = basename(extra);
      if (seen.has(agent.id)) {
        console.info(`grok extra CLI root ${basename(extra)}: skip duplicate ${agent.id}`);
        continue;
      }
      seen.add(agent.id);
      agents.push(agent);
    }
  }

  return {
    value: agents,
    errors,
    ...(primary.absent && extraRoots.length === 0 ? { absent: true } : {}),
  };
}
