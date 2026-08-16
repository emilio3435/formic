import { open, readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { LifecycleThresholds } from "./lifecycle";
import { DEFAULT_SESSION_WINDOW_MS, makeAgent } from "./collectors";
import { instanceIdFor } from "./collector-instances";
import type { HumanMessageCandidate } from "./human-message";
import type { CollectedAgent, CollectionResult } from "./types";

type JsonRecord = Record<string, unknown>;

interface RosterRow {
  id: string;
  name?: string;
  title?: string;
  description?: string;
  path?: string;
  createdAt?: number;
  updatedAt?: number;
  lastActivityAt?: number;
  isHiddenFromSidebar: boolean;
  lastEntry?: string;
}

export interface ParsedGrokBotReplica {
  transcriptTail?: string;
  humanMessages: HumanMessageCandidate[];
}

export type GrokBotAgent = CollectedAgent & {
  instanceId?: string;
  instanceLabel?: string;
};

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const REPLICA_MARKER = ".transcript.replicas.";
const MAX_REPLICA_BYTES = 1024 * 1024;

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function millis(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Number.isFinite(new Date(value).getTime()) ? value : undefined;
}

function timestamp(value: number | undefined): string | undefined {
  return value === undefined ? undefined : new Date(value).toISOString();
}

function lastEntryText(value: unknown): string | undefined {
  const entry = record(value);
  return text(value) ?? text(entry?.content) ?? text(entry?.message);
}

function filesystemPath(value: string | undefined): string | undefined {
  return value?.startsWith("/") ? value : undefined;
}

function missing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function decodeBlobKey(filename: string): string | undefined {
  const name = basename(filename);
  const encoded = name.endsWith(".blob") ? name.slice(0, -5) : name;
  if (!encoded || !/^[A-Z2-7]+=*$/i.test(encoded)) return undefined;

  const firstPadding = encoded.indexOf("=");
  const unpadded = firstPadding === -1 ? encoded : encoded.slice(0, firstPadding);
  if (firstPadding !== -1 && /[^=]/.test(encoded.slice(firstPadding))) return undefined;
  if (![0, 2, 4, 5, 7].includes(unpadded.length % 8)) return undefined;

  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of unpadded.toUpperCase()) {
    const digit = BASE32_ALPHABET.indexOf(character);
    if (digit < 0) return undefined;
    buffer = (buffer << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  if (buffer !== 0) return undefined;

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return undefined;
  }
}

export function parseRoster(value: unknown): RosterRow[] {
  const rows = record(value)?.rows;
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((candidate) => {
    const row = record(candidate);
    const id = text(row?.id);
    if (!row || !id) return [];
    return [{
      id,
      name: text(row.name),
      title: text(row.title),
      description: text(row.description),
      path: text(row.path),
      createdAt: millis(row.createdAt),
      updatedAt: millis(row.updatedAt),
      lastActivityAt: millis(row.lastActivityAt),
      isHiddenFromSidebar: row.isHiddenFromSidebar === true,
      lastEntry: lastEntryText(row.lastEntry),
    }];
  });
}

export function parseReplica(value: unknown): ParsedGrokBotReplica {
  const entries = record(value)?.entries;
  const humanMessages: HumanMessageCandidate[] = [];
  let transcriptTail: string | undefined;
  if (!Array.isArray(entries)) return { humanMessages };

  for (const candidate of entries) {
    const entry = record(candidate);
    if (!entry) continue;
    const content = text(entry.content) ?? text(entry.message);
    if (content) transcriptTail = content;

    const kind = text(entry.kind);
    const role = text(entry.role);
    if (content && (kind === "send-message" || role === "user")) {
      humanMessages.push({
        role: "user",
        content,
        timestamp: timestamp(millis(entry.timestampMs)),
      });
    }
  }

  return { transcriptTail, humanMessages };
}

async function readCapped(path: string, maxBytes: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const details = await handle.stat();
    if (details.size > maxBytes) throw new Error(`exceeds ${maxBytes} byte read cap`);
    const buffer = Buffer.alloc(Math.min(details.size, maxBytes));
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return buffer.subarray(0, offset).toString("utf8");
  } finally {
    await handle.close();
  }
}

function envelopeValue(raw: string): unknown {
  const envelope = record(JSON.parse(raw));
  if (!envelope) throw new Error("schemaVersion missing is unsupported");
  const version = envelope.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > 3) {
    throw new Error(`schemaVersion ${version === undefined ? "missing" : String(version)} is unsupported`);
  }
  return envelope.value;
}

async function readBlob(path: string, maxBytes?: number): Promise<unknown> {
  const raw = maxBytes === undefined
    ? await readFile(path, "utf8")
    : await readCapped(path, maxBytes);
  return envelopeValue(raw);
}

export async function collectGrokBotSessions(
  roots: readonly string[],
  nowMs = Date.now(),
  windowMs = DEFAULT_SESSION_WINDOW_MS,
  thresholds?: LifecycleThresholds,
): Promise<CollectionResult<GrokBotAgent[]>> {
  if (roots.length === 0) return { value: [], errors: [] };

  const agents: GrokBotAgent[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    const persistenceRoot = join(root, "sand-client-persistence");
    let entries;
    try {
      entries = await readdir(persistenceRoot, { withFileTypes: true });
    } catch (error) {
      const detail = missing(error) ? "missing sand-client-persistence directory" : describe(error);
      errors.push(`grok-bot root ${root}: ${detail}`);
      continue;
    }

    const rosters: Array<{ path: string }> = [];
    const replicas = new Map<string, { path: string }>();
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".blob")) continue;
      const key = decodeBlobKey(entry.name);
      if (!key) continue;
      const path = join(persistenceRoot, entry.name);
      if (key.endsWith(".roster.last-roster")) {
        rosters.push({ path });
        continue;
      }
      const markerAt = key.lastIndexOf(REPLICA_MARKER);
      if (markerAt === -1) continue;
      const id = key.slice(markerAt + REPLICA_MARKER.length);
      if (id && !replicas.has(id)) replicas.set(id, { path });
    }

    for (const roster of rosters) {
      let rows: RosterRow[];
      try {
        rows = parseRoster(await readBlob(roster.path));
      } catch (error) {
        errors.push(`grok-bot roster ${roster.path}: ${describe(error)}`);
        continue;
      }

      for (const row of rows) {
        if (row.isHiddenFromSidebar) continue;
        const activityAt = row.lastActivityAt ?? row.updatedAt;
        if (activityAt !== undefined && nowMs - activityAt > windowMs) continue;

        const agentId = `grok:bot:${row.id}`;
        if (seen.has(agentId)) continue;

        let transcriptTail = row.lastEntry;
        let humanMessages: HumanMessageCandidate[] = [];
        let sourcePath = roster.path;
        const replica = replicas.get(row.id);
        if (!replica) {
          errors.push(`grok-bot replica ${row.id} missing in ${persistenceRoot}`);
        } else {
          try {
            const parsed = parseReplica(await readBlob(replica.path, MAX_REPLICA_BYTES));
            transcriptTail = parsed.transcriptTail ?? transcriptTail;
            humanMessages = parsed.humanMessages;
            sourcePath = replica.path;
          } catch (error) {
            errors.push(`grok-bot replica ${row.id} ${replica.path}: ${describe(error)}`);
          }
        }

        const updatedAt = timestamp(row.lastActivityAt ?? row.updatedAt ?? row.createdAt)
          ?? new Date(nowMs).toISOString();
        const made = makeAgent({
          provider: "grok",
          sourceSessionId: `bot:${row.id}`,
          displayName: row.name ?? row.title ?? row.description,
          cwd: filesystemPath(row.path),
          startedAt: timestamp(row.createdAt),
          updatedAt,
          tokens: { scope: "unknown", provenance: "unknown" },
          transcriptTail,
          humanMessages,
          meta: { sourcePath, nowMs, thresholds },
        });
        const agent: GrokBotAgent = {
          ...made,
          instanceId: instanceIdFor("grok-bot", root),
          instanceLabel: basename(root),
        };
        seen.add(agent.id);
        agents.push(agent);
      }
    }
  }

  return { value: agents, errors };
}
