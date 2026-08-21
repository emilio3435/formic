import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { TokenUsage } from "../shared/types";
import type { LifecycleThresholds } from "./lifecycle";
import type { CollectedAgent, CollectionResult } from "./types";

export const PI_SESSION_VERSION = 3;
export const PI_READER_LIMITS = {
  chunkBytes: 64 * 1024,
  recordBytes: 8 * 1024 * 1024,
  entries: 4_096,
  stateBytes: 16 * 1024 * 1024,
  warnings: 128,
  callSizes: 4_096,
} as const;
/** Formic-local published-field policy, separate from Pi record/replay limits. */
export const PI_PUBLISHED_FIELD_CHARS = 6_000;
const PI_SETTINGS_BYTES = 64 * 1024;
const PI_FIELD_CLIPPING_WARNING =
  "Pi published text field exceeded 6000 character Formic-local cap and was clipped";

type JsonRecord = Record<string, any>;
type PiRootOrigin = "cli" | "environment" | "settings" | "imported" | "default";

export interface PiReadTestHooks {
  afterChunk?: (chunkIndex: number) => void;
  now?: () => number;
  rootError?: (root: string, origin: PiRootOrigin) => Error | undefined;
}

export interface PiCollectOptions {
  extraPiRoots?: readonly string[];
  piLaunchObservations?: readonly PiLaunchObservation[];
  piCliSessionDir?: string;
  piLaunchCwd?: string;
  piReadDeadlineMs?: number;
  piReadTestHooks?: PiReadTestHooks;
}

export interface PiTranscriptEvent {
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  timestamp?: string;
  sourceEntryId?: string;
  toolCallId?: string;
  toolName?: string;
  sourceType?: "assistant_tool_call" | "branch_summary" | "custom_message";
  sourceName?: string;
}

export interface PiLaunchObservation {
  launchCwd?: string;
  cliSessionDir?: string;
}

export interface PiSessionEvidence {
  sessionId: string;
  cwd?: string;
  startedAt?: string;
  updatedAt?: string;
  title?: string;
  firstUserText?: string;
  model?: string;
  modelProvider?: string;
  thinkingLevel?: string;
  humanMessages: Array<{
    role: "user" | "assistant";
    content: string;
    timestamp?: string;
  }>;
  events: PiTranscriptEvent[];
  transcriptTail?: string;
  lastThreadAt?: string;
  callSizes?: number[];
  tokens: TokenUsage;
  partial: boolean;
  warnings: string[];
}

export interface PiReadResult {
  evidence?: PiSessionEvidence;
  warnings: string[];
  partial: boolean;
}

interface StoredEntry {
  row: JsonRecord;
  bytes: number;
}

interface PhysicalFacts {
  firstUserText?: string;
  titleSeen: boolean;
  title?: string;
  updatedAt?: string;
  callSizes: number[];
  sessionTotal: number;
  sessionCachedInput: number;
  sessionProcessed: number;
  usageSeen: boolean;
  malformedUsageSeen: boolean;
  usageAggregatesComplete: boolean;
  callSeriesComplete: boolean;
}

interface PiRoot {
  root: string;
  origin: PiRootOrigin;
  direct: boolean;
  instanceId?: string;
  /** Legacy direct-call seam only: an exact caller attestation, never a
      process-table observation projected onto historical sessions. */
  launchCwd?: string;
}

class PiDeadlineError extends Error {}

const SESSION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function canonicalPiLaunchObservations(
  observations: readonly PiLaunchObservation[],
): PiLaunchObservation[] {
  const canonical = observations.flatMap(({ launchCwd, cliSessionDir }) => {
    const cleaned = {
      ...(nonEmpty(launchCwd) ? { launchCwd: nonEmpty(launchCwd) } : {}),
      ...(nonEmpty(cliSessionDir) ? { cliSessionDir: nonEmpty(cliSessionDir) } : {}),
    };
    return cleaned.launchCwd || cleaned.cliSessionDir ? [cleaned] : [];
  }).sort((left, right) =>
    (left.launchCwd ?? "").localeCompare(right.launchCwd ?? "")
    || (left.cliSessionDir ?? "").localeCompare(right.cliSessionDir ?? "")
  );
  return [...new Map(canonical.map((observation) => [
    `${observation.launchCwd ?? ""}\0${observation.cliSessionDir ?? ""}`,
    observation,
  ])).values()];
}

export function piLaunchObservationFromCommand(
  command: string,
): Pick<PiLaunchObservation, "cliSessionDir"> | undefined {
  const launch = command.match(/^\s*(?:\S*\/)?pi(?=\s|$)([^\n]*)/i);
  if (!launch) return undefined;
  const sessionDir = launch[1].match(
    /(?:^|\s)--session-dir\s+(?:"([^"]+)"|'([^']+)'|(\S+))(?=\s|$)/,
  );
  const cliSessionDir = sessionDir?.[1] ?? sessionDir?.[2] ?? sessionDir?.[3];
  return cliSessionDir ? { cliSessionDir } : {};
}

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function timestamp(value: unknown): string | undefined {
  const millis = typeof value === "number"
    ? value * (value < 10_000_000_000 ? 1_000 : 1)
    : typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(millis)) return undefined;
  const date = new Date(millis);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function entryTimestamp(row: JsonRecord): string | undefined {
  return timestamp(row.timestamp ?? row.message?.timestamp);
}

function boundedPublishedText(value: string, onClip: () => void): string {
  if (value.length <= PI_PUBLISHED_FIELD_CHARS) return value;
  onClip();
  const side = Math.floor((PI_PUBLISHED_FIELD_CHARS - 7) / 2);
  return `${value.slice(0, side)}\n[…]\n${value.slice(-side)}`;
}

function textContent(value: unknown, onClip: () => void): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? boundedPublishedText(trimmed, onClip) : undefined;
  }
  if (!Array.isArray(value)) return undefined;
  const text = value
    .flatMap((part) => {
      if (typeof part === "string") return [part];
      const item = record(part);
      return item?.type === "text" && typeof item.text === "string" ? [item.text] : [];
    })
    .join("\n")
    .trim();
  return text ? boundedPublishedText(text, onClip) : undefined;
}

function thinkingContent(value: unknown, onClip: () => void): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((part) => {
    const item = record(part);
    return item?.type === "thinking" && typeof item.thinking === "string" && item.thinking.trim()
      ? [boundedPublishedText(item.thinking.trim(), onClip)]
      : [];
  });
}

function physicalUsageOf(row: JsonRecord): { present: boolean; usage?: JsonRecord } {
  if (row.type === "compaction" || row.type === "branch_summary") {
    return Object.hasOwn(row, "usage")
      ? { present: true, usage: record(row.usage) }
      : { present: false };
  }
  if (row.type !== "message") return { present: false };
  const role = row.message?.role;
  if (role !== "assistant" && role !== "toolResult") return { present: false };
  return Object.hasOwn(row.message, "usage")
    ? { present: true, usage: record(row.message.usage) }
    : { present: false };
}

function usageComponents(usage: JsonRecord | undefined): {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
} | undefined {
  if (!usage) return undefined;
  const fields = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite];
  if (!fields.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)) {
    return undefined;
  }
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
  };
}

function updatePhysicalFacts(facts: PhysicalFacts, row: JsonRecord, onClip: () => void): void {
  const at = entryTimestamp(row);
  if (at && (!facts.updatedAt || at > facts.updatedAt)) facts.updatedAt = at;
  if (!facts.firstUserText && row.type === "message" && row.message?.role === "user") {
    facts.firstUserText = textContent(row.message.content, onClip);
  }
  if (row.type === "session_info") {
    facts.titleSeen = true;
    facts.title = typeof row.name === "string" && row.name.trim()
      ? boundedPublishedText(row.name.trim(), onClip)
      : undefined;
  }
  const physicalUsage = physicalUsageOf(row);
  if (!physicalUsage.present) return;
  facts.usageSeen = true;
  const usage = usageComponents(physicalUsage.usage);
  if (!usage) {
    facts.malformedUsageSeen = true;
    facts.usageAggregatesComplete = false;
    facts.callSeriesComplete = false;
    return;
  }
  if (!facts.usageAggregatesComplete) return;
  const callSize = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  const sessionTotal = usage.input + usage.output + usage.cacheWrite;
  const nextSessionTotal = facts.sessionTotal + sessionTotal;
  const nextSessionCachedInput = facts.sessionCachedInput + usage.cacheRead;
  const nextSessionProcessed = facts.sessionProcessed + callSize;
  if (![callSize, sessionTotal, nextSessionTotal, nextSessionCachedInput, nextSessionProcessed].every(Number.isFinite)) {
    facts.usageAggregatesComplete = false;
    facts.callSeriesComplete = false;
    return;
  }
  if (facts.callSeriesComplete) {
    if (facts.callSizes.length < PI_READER_LIMITS.callSizes) facts.callSizes.push(callSize);
    else facts.callSeriesComplete = false;
  }
  facts.sessionTotal = nextSessionTotal;
  facts.sessionCachedInput = nextSessionCachedInput;
  facts.sessionProcessed = nextSessionProcessed;
}

function migrateEntries(version: 1 | 2 | 3, entries: readonly StoredEntry[]): StoredEntry[] {
  if (version === 3) return [...entries];
  if (version === 2) {
    return entries.map((entry) => {
      if (entry.row.type !== "message" || entry.row.message?.role !== "hookMessage") return entry;
      const { id, parentId, timestamp: at } = entry.row;
      return {
        ...entry,
        row: {
          type: "custom",
          id,
          parentId,
          timestamp: at,
          customType: "legacy_hookMessage",
          data: entry.row.message,
        },
      };
    });
  }
  let parentId: string | null = null;
  const ids = entries.map((_entry, index) => `v1-${index.toString(16).padStart(8, "0")}`);
  return entries.map((entry, index) => {
    const row: JsonRecord = { ...entry.row, id: ids[index], parentId };
    if (row.type === "compaction" && Number.isInteger(row.firstKeptEntryIndex)) {
      const entryIndex = row.firstKeptEntryIndex - 1;
      if (entryIndex >= 0) row.firstKeptEntryId = ids[entryIndex];
      delete row.firstKeptEntryIndex;
    }
    parentId = ids[index]!;
    return { ...entry, row };
  });
}

function activePath(
  entries: readonly StoredEntry[],
  warn: (message: string, critical?: boolean) => void,
): JsonRecord[] {
  if (entries.length === 0) return [];
  const byId = new Map<string, JsonRecord>();
  for (const { row } of entries) {
    if (typeof row.id !== "string" || !row.id) continue;
    if (byId.has(row.id)) warn(`Pi duplicate entry id ${row.id}; the last physical entry is authoritative`);
    byId.set(row.id, row);
  }
  const leaf = entries.at(-1)?.row;
  if (!leaf || typeof leaf.id !== "string") return [];
  const reverse: JsonRecord[] = [];
  const seen = new Set<string>();
  let current: JsonRecord | undefined = leaf;
  while (current) {
    const id = typeof current.id === "string" ? current.id : undefined;
    if (!id) break;
    if (seen.has(id)) {
      warn(`Pi replay cycle detected at entry ${id}`, true);
      break;
    }
    seen.add(id);
    reverse.push(current);
    const parentId: string | undefined = typeof current.parentId === "string" ? current.parentId : undefined;
    current = parentId ? byId.get(parentId) : undefined;
  }
  return reverse.reverse();
}

function replayPath(
  path: readonly JsonRecord[],
  warn: (message: string, critical?: boolean) => void,
): JsonRecord[] {
  let compactionIndex = -1;
  for (const [index, row] of path.entries()) {
    if (row.type === "compaction") compactionIndex = index;
  }
  if (compactionIndex < 0) return [...path];
  const compaction = path[compactionIndex]!;
  const firstKeptId = typeof compaction.firstKeptEntryId === "string"
    ? compaction.firstKeptEntryId
    : undefined;
  const firstKeptIndex = firstKeptId
    ? path.slice(0, compactionIndex).findIndex((row) => row.id === firstKeptId)
    : -1;
  if (firstKeptId && firstKeptIndex < 0) {
    warn(`Pi compaction firstKeptEntryId ${firstKeptId} is outside retained replay state`, true);
  }
  return [
    compaction,
    ...(firstKeptIndex >= 0 ? path.slice(firstKeptIndex, compactionIndex) : []),
    ...path.slice(compactionIndex + 1),
  ];
}

function activeState(rows: readonly JsonRecord[]): {
  model?: string;
  modelProvider?: string;
  thinkingLevel?: string;
} {
  let model: string | undefined;
  let modelProvider: string | undefined;
  let thinkingLevel: string | undefined;
  for (const row of rows) {
    if (row.type === "model_change") {
      if (typeof row.modelId === "string" && row.modelId.trim()) model = row.modelId.trim();
      if (typeof row.provider === "string" && row.provider.trim()) modelProvider = row.provider.trim();
    } else if (row.type === "thinking_level_change") {
      if (typeof row.thinkingLevel === "string" && row.thinkingLevel.trim()) {
        thinkingLevel = row.thinkingLevel.trim();
      }
    } else if (row.type === "message" && row.message?.role === "assistant") {
      if (typeof row.message.model === "string" && row.message.model.trim()) model = row.message.model.trim();
      if (typeof row.message.provider === "string" && row.message.provider.trim()) {
        modelProvider = row.message.provider.trim();
      }
    }
  }
  return { model, modelProvider, thinkingLevel };
}

function latestOccupancyUsage(rows: readonly JsonRecord[]): ReturnType<typeof usageComponents> {
  let latestCompaction = -1;
  for (const [index, row] of rows.entries()) {
    if (row.type === "compaction") latestCompaction = index;
  }
  for (let index = rows.length - 1; index > latestCompaction; index -= 1) {
    const row = rows[index]!;
    if (row.type !== "message" || row.message?.role !== "assistant") continue;
    if (row.message.stopReason === "aborted" || row.message.stopReason === "error") continue;
    return usageComponents(record(row.message.usage));
  }
  return undefined;
}

function replayEvidence(rows: readonly JsonRecord[], publishNativeIds: boolean, onClip: () => void): {
  events: PiTranscriptEvent[];
  humanMessages: PiSessionEvidence["humanMessages"];
  lastThreadAt?: string;
} {
  const events: PiTranscriptEvent[] = [];
  const humanMessages: PiSessionEvidence["humanMessages"] = [];
  let lastThreadAt: string | undefined;
  const sourceId = (row: JsonRecord): Pick<PiTranscriptEvent, "sourceEntryId"> =>
    publishNativeIds && typeof row.id === "string" ? { sourceEntryId: row.id } : {};
  for (const row of rows) {
    const at = entryTimestamp(row);
    if (row.type === "model_change" || row.type === "thinking_level_change") continue;
    if (row.type === "compaction") {
      if (typeof row.summary === "string" && row.summary.trim()) {
        events.push({
          role: "system",
          text: boundedPublishedText(row.summary.trim(), onClip),
          timestamp: at,
          ...sourceId(row),
        });
      }
      continue;
    }
    if (row.type === "branch_summary") {
      if (typeof row.summary === "string" && row.summary.trim()) {
        events.push({
          role: "system",
          text: boundedPublishedText(row.summary.trim(), onClip),
          timestamp: at,
          ...sourceId(row),
          sourceType: "branch_summary",
        });
      }
      continue;
    }
    if (row.type === "custom_message") {
      const customText = textContent(row.content, onClip);
      if (customText) {
        events.push({
          role: "system",
          text: customText,
          timestamp: at,
          ...sourceId(row),
          sourceType: "custom_message",
          ...(typeof row.customType === "string" && row.customType.trim()
            ? { sourceName: row.customType.trim() }
            : {}),
        });
      }
      continue;
    }
    if (row.type === "custom" && row.customType === "legacy_hookMessage") {
      const hookText = textContent(row.data?.content, onClip);
      if (hookText) {
        events.push({
          role: "system",
          text: hookText,
          timestamp: at,
          ...sourceId(row),
        });
      }
      continue;
    }
    if (row.type !== "message") continue;
    const role = row.message?.role;
    if (role === "user" || role === "assistant") {
      const text = textContent(row.message.content, onClip);
      if (text) {
        humanMessages.push({ role, content: text, timestamp: at });
        events.push({
          role,
          text,
          timestamp: at,
          ...sourceId(row),
        });
        if (at && (!lastThreadAt || at > lastThreadAt)) lastThreadAt = at;
      }
      if (role === "assistant") {
        for (const thought of thinkingContent(row.message.content, onClip)) {
          events.push({
            role: "system",
            text: boundedPublishedText(`Thought\n${thought}`, onClip),
            timestamp: at,
            ...sourceId(row),
          });
        }
        if (Array.isArray(row.message.content)) {
          for (const part of row.message.content) {
            const toolCall = record(part);
            if (
              toolCall?.type !== "toolCall"
              || typeof toolCall.id !== "string"
              || typeof toolCall.name !== "string"
              || !toolCall.id.trim()
              || !toolCall.name.trim()
            ) continue;
            events.push({
              role: "tool",
              text: boundedPublishedText(
                `${toolCall.name.trim()}\nCall: ${toolCall.id.trim()}`,
                onClip,
              ),
              timestamp: at,
              ...sourceId(row),
              toolCallId: toolCall.id.trim(),
              toolName: toolCall.name.trim(),
              sourceType: "assistant_tool_call",
              sourceName: toolCall.name.trim(),
            });
          }
        }
      }
      continue;
    }
    if (role !== "toolResult") continue;
    const output = textContent(row.message.content, onClip);
    const callId = typeof row.message.toolCallId === "string" ? row.message.toolCallId : undefined;
    const toolName = typeof row.message.toolName === "string" ? row.message.toolName : undefined;
    if (output && callId && toolName) {
      events.push({
        role: "tool",
        text: boundedPublishedText(`${toolName}\nCall: ${callId}\n${output}`, onClip),
        timestamp: at,
        ...sourceId(row),
        toolCallId: callId,
        toolName,
      });
    }
    if (at && (!lastThreadAt || at > lastThreadAt)) lastThreadAt = at;
  }
  return { events, humanMessages, lastThreadAt };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason;
}

export async function readPiSessionFile(
  source: string,
  options: {
    signal?: AbortSignal;
    deadlineMs?: number;
    /** Absolute deadline shared by a multi-file collection pass. */
    deadlineAtMs?: number;
    hooks?: PiReadTestHooks;
  } = {},
): Promise<PiReadResult> {
  throwIfAborted(options.signal);
  const warnings: string[] = [];
  const entries: StoredEntry[] = [];
  const facts: PhysicalFacts = {
    titleSeen: false,
    callSizes: [],
    sessionTotal: 0,
    sessionCachedInput: 0,
    sessionProcessed: 0,
    usageSeen: false,
    malformedUsageSeen: false,
    usageAggregatesComplete: true,
    callSeriesComplete: true,
  };
  let header: JsonRecord | undefined;
  let firstParsedObjectSeen = false;
  let headerOrderInvalid = false;
  let retainedBytes = 0;
  let countTrimmed = false;
  let stateTrimmed = false;
  let partial = false;
  let pending = "";
  let skippingOversized = false;
  let lineNumber = 0;
  let chunkIndex = 0;
  let lastNonEmptyLine = 0;
  let lastMalformedWarning: { line: number; index?: number } | undefined;
  let warningDetails = 0;
  let warningSuppressed = false;
  let fieldClipped = false;
  const noteFieldClipping = (): void => {
    fieldClipped = true;
    partial = true;
  };
  const addWarning = (message: string, critical = false): number | undefined => {
    if (warningDetails < PI_READER_LIMITS.warnings) {
      warningDetails += 1;
      return warnings.push(message) - 1;
    }
    if (!warningSuppressed) {
      warningSuppressed = true;
      warnings.push(`Pi reader warning details suppressed after ${PI_READER_LIMITS.warnings} warnings`);
    }
    if (critical) return warnings.push(message) - 1;
    return undefined;
  };
  const now = options.hooks?.now ?? Date.now;
  const deadlineMs = options.deadlineMs;
  const deadlineAt = options.deadlineAtMs
    ?? (deadlineMs === undefined ? undefined : now() + deadlineMs);
  const handle = await open(source, "r");

  const acceptLine = (line: string, final: boolean): void => {
    lineNumber += 1;
    if (!line.trim()) return;
    lastNonEmptyLine = lineNumber;
    const bytes = Buffer.byteLength(line);
    if (bytes > PI_READER_LIMITS.recordBytes) {
      addWarning(`Pi JSONL record exceeds ${PI_READER_LIMITS.recordBytes} byte cap and was skipped`);
      partial = true;
      return;
    }
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      const index = addWarning(final
        ? `Pi truncated JSONL record at line ${lineNumber}`
        : `Pi malformed JSONL record at line ${lineNumber}`, final);
      if (!final) lastMalformedWarning = { line: lineNumber, index };
      partial = true;
      return;
    }
    const object = record(row);
    if (!object) return;
    if (!firstParsedObjectSeen) {
      firstParsedObjectSeen = true;
      if (object.type !== "session") {
        headerOrderInvalid = true;
        return;
      }
      header = object;
      facts.updatedAt = entryTimestamp(object);
      return;
    }
    if (!header) return;
    updatePhysicalFacts(facts, object, noteFieldClipping);
    entries.push({ row: object, bytes });
    retainedBytes += bytes;
    while (entries.length > PI_READER_LIMITS.entries) {
      retainedBytes -= entries.shift()!.bytes;
      countTrimmed = true;
      partial = true;
    }
    while (retainedBytes > PI_READER_LIMITS.stateBytes && entries.length > 1) {
      retainedBytes -= entries.shift()!.bytes;
      stateTrimmed = true;
      partial = true;
    }
  };

  try {
    const buffer = Buffer.allocUnsafe(PI_READER_LIMITS.chunkBytes);
    const decoder = new StringDecoder("utf8");
    let position = 0;
    const consumeChunk = (chunk: string): void => {
      let cursor = 0;
      while (cursor < chunk.length) {
        const newline = chunk.indexOf("\n", cursor);
        if (newline < 0) {
          if (!skippingOversized) pending += chunk.slice(cursor);
          break;
        }
        if (skippingOversized) {
          skippingOversized = false;
          lineNumber += 1;
          cursor = newline + 1;
          continue;
        }
        pending += chunk.slice(cursor, newline);
        acceptLine(pending, false);
        pending = "";
        cursor = newline + 1;
      }
      if (!skippingOversized && Buffer.byteLength(pending) > PI_READER_LIMITS.recordBytes) {
        addWarning(`Pi JSONL record exceeds ${PI_READER_LIMITS.recordBytes} byte cap and was skipped`);
        partial = true;
        pending = "";
        skippingOversized = true;
      }
    };
    while (true) {
      throwIfAborted(options.signal);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      chunkIndex += 1;
      options.hooks?.afterChunk?.(chunkIndex);
      throwIfAborted(options.signal);
      if (deadlineAt !== undefined && now() > deadlineAt) {
        throw new PiDeadlineError(`exceeded ${deadlineMs}ms read deadline`);
      }
      consumeChunk(decoder.write(buffer.subarray(0, bytesRead)));
    }
    consumeChunk(decoder.end());
    if (pending) acceptLine(pending, true);
    if (skippingOversized) lineNumber += 1;
  } finally {
    await handle.close();
  }

  if (countTrimmed) addWarning(`Pi replay retained only the newest ${PI_READER_LIMITS.entries} entries`, true);
  if (stateTrimmed) {
    addWarning(`Pi replay retained only newest entries within ${PI_READER_LIMITS.stateBytes} byte cap`, true);
  }
  if (facts.malformedUsageSeen) {
    partial = true;
    addWarning(
      "Pi physical usage components were missing, negative, or non-finite; derived session totals and call series were withheld",
      true,
    );
  } else if (!facts.usageAggregatesComplete) {
    partial = true;
    addWarning("Pi usage aggregate overflowed finite numeric range; derived session totals and call series were withheld", true);
  } else if (!facts.callSeriesComplete) {
    partial = true;
    addWarning(`Pi call series was withheld as incomplete after ${PI_READER_LIMITS.callSizes} retained calls`, true);
  }
  if (lastMalformedWarning?.line === lastNonEmptyLine && lastMalformedWarning.index !== undefined) {
    warnings[lastMalformedWarning.index] = `Pi truncated JSONL record at line ${lastMalformedWarning.line}`;
  } else if (lastMalformedWarning?.line === lastNonEmptyLine) {
    addWarning(`Pi truncated JSONL record at line ${lastMalformedWarning.line}`, true);
  }
  if (headerOrderInvalid) {
    addWarning("Pi first successfully parsed object is not the session header", true);
    return { warnings, partial: true };
  }
  if (!header) {
    addWarning("Pi session header is missing", true);
    return { warnings, partial: true };
  }
  const sessionId = typeof header.id === "string" ? header.id : "";
  if (!SESSION_ID.test(sessionId)) {
    addWarning(`Pi invalid session id ${JSON.stringify(header.id)} in header`, true);
    return { warnings, partial: true };
  }
  const rawVersion = header.version;
  const version = rawVersion === undefined ? 1 : rawVersion;
  if (version !== 1 && version !== 2 && version !== 3) {
    addWarning(`Pi schema version ${String(rawVersion)} is unsupported`, true);
    return { warnings, partial: true };
  }

  const replayWarning = (message: string, critical = false): void => {
    partial = true;
    addWarning(message, critical);
  };
  const migrated = migrateEntries(version, entries);
  const path = activePath(migrated, replayWarning);
  const state = activeState(path);
  const replay = replayEvidence(replayPath(path, replayWarning), version !== 1, noteFieldClipping);
  const latest = latestOccupancyUsage(path);
  const latestTotal = latest
    ? latest.input + latest.output + latest.cacheRead + latest.cacheWrite
    : undefined;
  const contextWindow = latest && state.model
    ? (await import("./collectors")).claudeContextWindow(state.model)
    : undefined;
  const hasPhysicalUsage = facts.usageSeen;
  const tokens: TokenUsage = hasPhysicalUsage
    ? {
        ...(latest ? {
          input: latest.input,
          output: latest.output,
          cachedInput: latest.cacheRead,
          ...(Number.isFinite(latestTotal) ? { total: latestTotal } : {}),
        } : {}),
        ...(facts.usageAggregatesComplete ? {
          sessionTotal: facts.sessionTotal,
          sessionCachedInput: facts.sessionCachedInput,
          sessionProcessed: facts.sessionProcessed,
        } : {}),
        ...(contextWindow !== undefined ? { contextWindow } : {}),
        scope: latest ? "latest-turn" : "session",
        provenance: partial ? "estimated" : "observed",
      }
    : { scope: "unknown", provenance: "unknown" };
  const transcriptTailText = replay.events
    .filter((event) => event.role !== "system" || !event.text.startsWith("Thought\n"))
    .map((event) => event.text)
    .join("\n") || undefined;
  const transcriptTail = transcriptTailText
    ? boundedPublishedText(transcriptTailText, noteFieldClipping)
    : undefined;
  if (fieldClipped) addWarning(PI_FIELD_CLIPPING_WARNING, true);
  return {
    evidence: {
      sessionId,
      cwd: typeof header.cwd === "string" && header.cwd.trim() ? header.cwd : undefined,
      startedAt: timestamp(header.timestamp),
      updatedAt: facts.updatedAt ?? timestamp(header.timestamp),
      title: facts.titleSeen ? facts.title : undefined,
      firstUserText: facts.firstUserText,
      model: state.model,
      modelProvider: state.modelProvider,
      thinkingLevel: state.thinkingLevel,
      humanMessages: replay.humanMessages,
      events: replay.events,
      transcriptTail,
      lastThreadAt: replay.lastThreadAt,
      callSizes: facts.callSeriesComplete && facts.callSizes.length > 0 ? facts.callSizes : undefined,
      tokens,
      partial,
      warnings,
    },
    warnings,
    partial,
  };
}

function expandedPath(value: string, home: string, launchCwd?: string): {
  path?: string;
  error?: string;
} {
  const trimmed = value.trim();
  if (!trimmed) return {};
  if (trimmed === "~") return { path: home };
  if (trimmed.startsWith("~/")) return { path: join(home, trimmed.slice(2)) };
  if (isAbsolute(trimmed)) return { path: resolve(trimmed) };
  if (!launchCwd) return { error: "relative session root requires observed launch cwd and is unavailable" };
  return { path: resolve(launchCwd, trimmed) };
}

function settingSessionDir(source: string, scope: "global" | "project"): {
  sessionDir?: string;
  error?: string;
} {
  if (!existsSync(source)) return {};
  let descriptor: number | undefined;
  try {
    descriptor = openSync(source, "r");
    const bytes = Buffer.allocUnsafe(PI_SETTINGS_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = readSync(descriptor, bytes, length, bytes.length - length, length);
      if (read === 0) break;
      length += read;
    }
    if (length > PI_SETTINGS_BYTES) {
      return { error: `Pi ${scope} settings file ${source} exceeds ${PI_SETTINGS_BYTES} byte cap` };
    }
    const parsed = JSON.parse(bytes.toString("utf8", 0, length));
    return typeof parsed?.sessionDir === "string" && parsed.sessionDir.trim()
      ? { sessionDir: parsed.sessionDir }
      : {};
  } catch {
    return {};
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function piInstanceId(root: string): string {
  const token = basename(root).replace(/^\./, "dot-").toLowerCase().replace(/[^a-z0-9]+/g, "-") || "sessions";
  const digest = createHash("sha256").update(resolve(root)).digest("hex").slice(0, 16);
  return `pi:${token}--${digest}`;
}

function rootsFor(home: string, options: PiCollectOptions): { roots: PiRoot[]; errors: string[] } {
  const errors: string[] = [];
  const unresolvedRelativeErrors: Array<{ key: string; message: string }> = [];
  const resolvedRelativeInputs = new Set<string>();
  const relativeInputKey = (origin: string, value: string): string => `${origin}\0${value}`;
  const roots: PiRoot[] = [];
  const pluralObservations = options.piLaunchObservations !== undefined;
  const suppliedObservations = pluralObservations
    ? options.piLaunchObservations ?? []
    : [{ launchCwd: options.piLaunchCwd, cliSessionDir: options.piCliSessionDir }];
  const observations = canonicalPiLaunchObservations(suppliedObservations);
  const resolutionObservations = pluralObservations
    ? [{}, ...observations]
    : observations.length > 0 ? observations : [{}];
  for (const observation of resolutionObservations) {
    const launchCwd = observation.launchCwd;
    const agentDirValue = process.env.PI_CODING_AGENT_DIR?.trim();
    const agentDirResolution = agentDirValue
      ? expandedPath(agentDirValue, home, launchCwd)
      : { path: join(home, ".pi/agent") };
    const agentDir = agentDirResolution.path;
    if (pluralObservations && launchCwd && agentDirValue && agentDir) {
      const unresolved = expandedPath(agentDirValue, home);
      if (unresolved.error) {
        resolvedRelativeInputs.add(relativeInputKey("environment-agent", agentDirValue));
      }
    }
    let selected = ([
      { value: observation.cliSessionDir, origin: "cli" },
      { value: process.env.PI_CODING_AGENT_SESSION_DIR, origin: "environment" },
    ] as Array<{ value?: string; origin: PiRootOrigin }>).find(({ value }) => Boolean(value?.trim()));
    let settingError = false;
    if (!selected) {
      const projectSetting = launchCwd
        ? settingSessionDir(join(launchCwd, ".pi/settings.json"), "project")
        : {};
      const globalSetting = projectSetting.sessionDir || !agentDir
        ? {}
        : settingSessionDir(join(agentDir, "settings.json"), "global");
      for (const error of [projectSetting.error, globalSetting.error]) {
        if (!error) continue;
        errors.push(error);
        settingError = true;
      }
      const value = projectSetting.sessionDir ?? globalSetting.sessionDir;
      if (value) selected = { value, origin: "settings" };
    }
    if (selected?.value) {
      const resolved = expandedPath(selected.value, home, launchCwd);
      if (resolved.path) {
        if (pluralObservations && launchCwd) {
          const unresolved = expandedPath(selected.value, home);
          if (unresolved.error) {
            resolvedRelativeInputs.add(relativeInputKey(selected.origin, selected.value));
          }
        }
        roots.push({
          root: resolved.path,
          origin: selected.origin,
          direct: true,
          ...(!pluralObservations && launchCwd ? { launchCwd } : {}),
        });
      } else {
        const message = selected.origin === "settings"
          ? `Pi settings sessionDir ${JSON.stringify(selected.value)}: ${resolved.error}`
          : `Pi ${selected.origin} ${resolved.error}`;
        if (pluralObservations) {
          unresolvedRelativeErrors.push({
            key: relativeInputKey(selected.origin, selected.value),
            message,
          });
        } else {
          errors.push(message);
        }
      }
    } else if (settingError) {
      continue;
    } else if (agentDirResolution.error) {
      const message = `Pi environment ${agentDirResolution.error.replace("session root", "agent directory")}`;
      if (pluralObservations && agentDirValue) {
        unresolvedRelativeErrors.push({
          key: relativeInputKey("environment-agent", agentDirValue),
          message,
        });
      } else {
        errors.push(message);
      }
    } else if (agentDir) {
      roots.push({
        root: join(agentDir, "sessions"),
        origin: "default",
        direct: false,
        ...(!pluralObservations && launchCwd ? { launchCwd } : {}),
      });
    }
  }
  for (const imported of options.extraPiRoots ?? []) {
    const resolved = expandedPath(imported, home, options.piLaunchCwd);
    if (resolved.path) {
      roots.push({
        root: resolved.path,
        origin: "imported",
        direct: true,
        instanceId: piInstanceId(resolved.path),
        ...(!pluralObservations && options.piLaunchCwd ? { launchCwd: options.piLaunchCwd } : {}),
      });
    } else {
      errors.push(`Pi imported ${resolved.error}`);
    }
  }
  const seen = new Set<string>();
  return {
    roots: roots.filter((candidate) => {
      let identity = resolve(candidate.root);
      try { identity = realpathSync(candidate.root); } catch { /* Missing roots retain their advertised path. */ }
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    }),
    errors: [...new Set([
      ...errors,
      ...unresolvedRelativeErrors
        .filter(({ key }) => !resolvedRelativeInputs.has(key))
        .map(({ message }) => message),
    ])],
  };
}

function filesForRoot(root: PiRoot): string[] {
  const jsonl = (directory: string): string[] => readdirSync(directory)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .map((name) => join(directory, name));
  if (root.direct) return jsonl(root.root);
  const files: string[] = [];
  for (const name of readdirSync(root.root).sort()) {
    const directory = join(root.root, name);
    try {
      if (statSync(directory).isDirectory()) files.push(...jsonl(directory));
    } catch {
      // Broken and non-directory symlinks are outside the default one-level layout.
    }
  }
  return files;
}

function rootError(prefix: string, root: PiRoot, detail: string): string {
  const instanceId = root.instanceId ?? (root.origin === "default" ? undefined : piInstanceId(root.root));
  const instance = instanceId ? ` (instance ${instanceId})` : "";
  return `Pi ${root.origin} session root ${root.root} ${prefix}: ${detail}${instance}`;
}

function fileError(root: PiRoot, source: string, detail: string): string {
  const instanceId = root.instanceId ?? (root.origin === "default" ? undefined : piInstanceId(root.root));
  const instance = instanceId ? ` (instance ${instanceId})` : "";
  return `Pi ${root.origin} session root ${root.root}${instance} file ${source}: ${detail}`;
}

export async function collectPiSessions(
  home: string,
  windowMs: number,
  thresholds: LifecycleThresholds | undefined,
  options: PiCollectOptions = {},
  signal?: AbortSignal,
): Promise<CollectionResult<CollectedAgent[]>> {
  throwIfAborted(signal);
  const readNow = options.piReadTestHooks?.now ?? Date.now;
  const aggregateDeadlineAt = options.piReadDeadlineMs === undefined
    ? undefined
    : readNow() + options.piReadDeadlineMs;
  const resolution = rootsFor(home, options);
  const errors = [...resolution.errors];
  const value: CollectedAgent[] = [];
  let presentRoot = false;
  const { makeAgent } = await import("./collectors");
  let deadlineExhausted = false;
  for (const root of resolution.roots) {
    if (deadlineExhausted) break;
    throwIfAborted(signal);
    if (aggregateDeadlineAt !== undefined && readNow() > aggregateDeadlineAt) {
      errors.push(rootError(
        "scan could not continue",
        root,
        `exceeded ${options.piReadDeadlineMs}ms aggregate read deadline`,
      ));
      deadlineExhausted = true;
      break;
    }
    const injected = options.piReadTestHooks?.rootError?.(root.root, root.origin);
    if (injected) {
      const code = (injected as NodeJS.ErrnoException).code;
      errors.push(rootError("is unreadable", root, `${code ? `${code} ` : ""}${injected.message}`));
      continue;
    }
    if (!existsSync(root.root)) {
      if (root.origin !== "default") errors.push(rootError("is missing", root, "advertised root does not exist"));
      continue;
    }
    let files: string[];
    try {
      if (!statSync(root.root).isDirectory()) {
        errors.push(rootError("is unreadable", root, "path is not a directory"));
        continue;
      }
      files = filesForRoot(root);
      presentRoot = true;
    } catch (error) {
      errors.push(rootError("is unreadable", root, error instanceof Error ? error.message : String(error)));
      continue;
    }
    if (aggregateDeadlineAt !== undefined && readNow() > aggregateDeadlineAt) {
      const detail = `exceeded ${options.piReadDeadlineMs}ms aggregate read deadline`;
      errors.push(files[0]
        ? fileError(root, files[0], detail)
        : rootError("scan could not continue", root, detail));
      deadlineExhausted = true;
      break;
    }
    const instanceId = root.instanceId ?? (root.origin === "default" ? undefined : piInstanceId(root.root));
    for (const source of files) {
      throwIfAborted(signal);
      if (aggregateDeadlineAt !== undefined && readNow() > aggregateDeadlineAt) {
        errors.push(fileError(root, source, `exceeded ${options.piReadDeadlineMs}ms aggregate read deadline`));
        deadlineExhausted = true;
        break;
      }
      let details;
      try {
        details = statSync(source);
      } catch (error) {
        errors.push(fileError(root, source, `could not be inspected: ${error instanceof Error ? error.message : String(error)}`));
        continue;
      }
      if (!details.isFile()) continue;
      if (Number.isFinite(windowMs) && Date.now() - details.mtimeMs > windowMs) continue;
      let read: PiReadResult;
      try {
        read = await readPiSessionFile(source, {
          signal,
          deadlineMs: options.piReadDeadlineMs,
          deadlineAtMs: aggregateDeadlineAt,
          hooks: options.piReadTestHooks,
        });
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        if (error instanceof PiDeadlineError) {
          errors.push(fileError(root, source, error.message));
          deadlineExhausted = true;
          break;
        }
        errors.push(fileError(root, source, `could not be read: ${error instanceof Error ? error.message : String(error)}`));
        continue;
      }
      errors.push(...read.warnings.map((warning) => fileError(root, source, warning)));
      const evidence = read.evidence;
      if (!evidence) continue;
      if (!evidence.updatedAt) {
        errors.push(fileError(root, source, "no usable source timestamp was recorded"));
        continue;
      }
      const agent = makeAgent({
        callSizes: evidence.callSizes,
        provider: "pi",
        sourceSessionId: evidence.sessionId,
        runtimeSessionId: evidence.sessionId,
        displayName: evidence.title,
        cwd: evidence.cwd,
        originCwd: evidence.cwd,
        identityCwd: evidence.cwd,
        allowOriginCwdFallback: false,
        model: evidence.model,
        effort: evidence.thinkingLevel,
        task: evidence.firstUserText,
        taskBeforeOriginCwd: true,
        startedAt: evidence.startedAt,
        updatedAt: evidence.updatedAt,
        tokens: evidence.tokens,
        transcriptTail: evidence.transcriptTail,
        humanMessages: evidence.humanMessages,
        thread: { lastThreadAt: evidence.lastThreadAt },
        meta: { sourcePath: source, mtimeMs: details.mtimeMs, thresholds },
      });
      const contextWindow = evidence.tokens.contextWindow;
      value.push({
        ...agent,
        ...(contextWindow !== undefined && evidence.tokens.total !== undefined
          ? { contextPct: evidence.tokens.total / contextWindow * 100 }
          : {}),
        ...(instanceId ? { instanceId, instanceLabel: basename(root.root) } : {}),
        ...(root.launchCwd ? { launchCwd: root.launchCwd } : {}),
        allowCwdFallback: false,
        artifacts: [{ label: "Pi session", path: source, kind: "transcript" }],
      });
    }
  }
  return {
    value,
    errors,
    ...(!presentRoot && errors.length === 0 ? { absent: true } : {}),
  };
}
