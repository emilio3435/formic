import { open, readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { LifecycleThresholds } from "./lifecycle";
import { DEFAULT_SESSION_WINDOW_MS, makeAgent } from "./collectors";
import { instanceIdFor } from "./collector-instances";
import { rememberGrokBotInstanceHome } from "./grok-bot-attach";
import { refreshGrokBotGatewayProbe } from "./grok-bot-gateway";
import type { HumanMessageCandidate } from "./human-message";
import { ThreadClock } from "./thread-clock";
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
  thread: { lastThreadAt?: string; workingSince?: string };
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
  /* 0 is a Grok Bot sentinel for "never", not 1970-01-01. Treating it as a
     real clock drops the row as aged-out of every scan window. */
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Number.isFinite(new Date(value).getTime()) ? value : undefined;
}

function timestamp(value: number | undefined): string | undefined {
  return value === undefined ? undefined : new Date(value).toISOString();
}

function lastEntryText(value: unknown): string | undefined {
  const entry = record(value);
  /* Live roster lastEntry is `{ kind: "text", text }`, the agent close. */
  return text(value) ?? text(entry?.text) ?? text(entry?.content) ?? text(entry?.message);
}

function payloadText(value: unknown): string | undefined {
  const direct = text(value);
  if (direct) return direct;
  const payload = record(value);
  if (!payload) return undefined;
  /* One-line row: text cards only. Skip attachment / widget / cursor-agent. */
  if (text(payload.type) !== "text") return undefined;
  return text(payload.content);
}

function entryText(entry: JsonRecord): string | undefined {
  return payloadText(entry.content) ?? payloadText(entry.message);
}

function filesystemPath(value: string | undefined): string | undefined {
  if (!value?.startsWith("/")) return undefined;
  /* The roster `path` is the Bot sandbox sqlite file
     (`/home/box/sand-data/agents/<id>/store.db`), not a Mac checkout. Using it
     as cwd groups every Bot row under a program named "store.db" and hides
     them from the repos the operator actually scans. */
  if (value.startsWith("/home/box/") || value.endsWith("/store.db")) return undefined;
  return value;
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

export function isReplicaBlob(raw: string): boolean {
  try {
    const envelope = record(JSON.parse(raw));
    const value = record(envelope?.value);
    return Boolean(envelope && typeof envelope.schemaVersion === "number" && value && Array.isArray(value.entries));
  } catch {
    return false;
  }
}

export function parseReplicaBlob(raw: string): ParsedGrokBotReplica {
  return parseReplica(envelopeValue(raw));
}

export function parseReplica(value: unknown): ParsedGrokBotReplica {
  const entries = record(value)?.entries;
  const humanMessages: HumanMessageCandidate[] = [];
  const clock = new ThreadClock();
  let transcriptTail: string | undefined;
  if (!Array.isArray(entries)) return { humanMessages, thread: clock.snapshot() };

  for (const candidate of entries) {
    const entry = record(candidate);
    if (!entry) continue;

    const kind = text(entry.kind);
    const role = text(entry.role);
    /* Live schemaVersion 1: send-message is agent → user. kind:message
       role:assistant is an inter-agent copy (toAgent), not the row close.
       The inverted test fixture treated string send-message as the operator
       — do not implement that. */
    if (kind === "user-attachment") continue;
    if (kind === "message" && role === "assistant") continue;

    const content = entryText(entry);
    if (!content) continue;

    const at = timestamp(millis(entry.timestampMs));
    if (kind === "send-message") {
      clock.observe(at, "assistant", { endsTurn: true });
      transcriptTail = content;
      humanMessages.push({
        role: "assistant",
        content,
        timestamp: at,
      });
      continue;
    }

    if (role === "user") {
      clock.observe(at, "user");
      transcriptTail = content;
      humanMessages.push({
        role: "user",
        content,
        timestamp: at,
      });
    }
  }

  return { transcriptTail, humanMessages, thread: clock.snapshot() };
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
  const pending: Array<{
    root: string;
    row: RosterRow;
    transcriptTail?: string;
    humanMessages: HumanMessageCandidate[];
    thread?: { lastThreadAt?: string; workingSince?: string };
    sourcePath: string;
  }> = [];

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

        let transcriptTail = row.lastEntry;
        let humanMessages: HumanMessageCandidate[] = [];
        let thread: { lastThreadAt?: string; workingSince?: string } | undefined;
        let sourcePath = roster.path;
        const replica = replicas.get(row.id);
        if (!replica) {
          errors.push(`grok-bot replica ${row.id} missing in ${persistenceRoot}`);
        } else {
          try {
            const parsed = parseReplica(await readBlob(replica.path, MAX_REPLICA_BYTES));
            transcriptTail = parsed.transcriptTail ?? transcriptTail;
            humanMessages = parsed.humanMessages;
            thread = parsed.thread;
            sourcePath = replica.path;
          } catch (error) {
            errors.push(`grok-bot replica ${row.id} ${replica.path}: ${describe(error)}`);
          }
        }

        pending.push({ root, row, transcriptTail, humanMessages, thread, sourcePath });
      }
    }
  }

  const rootsByRosterId = new Map<string, Set<string>>();
  const probed = new Set<string>();
  for (const item of pending) {
    const rootsForId = rootsByRosterId.get(item.row.id) ?? new Set<string>();
    rootsForId.add(item.root);
    rootsByRosterId.set(item.row.id, rootsForId);
    const instanceId = instanceIdFor("grok-bot", item.root);
    rememberGrokBotInstanceHome(instanceId, item.root);
    if (probed.has(instanceId)) continue;
    probed.add(instanceId);
    await refreshGrokBotGatewayProbe(instanceId, item.root);
  }

  const seen = new Set<string>();
  for (const item of pending) {
    const colliding = (rootsByRosterId.get(item.row.id)?.size ?? 0) > 1;
    const instanceId = instanceIdFor("grok-bot", item.root);
    const instanceSlug = instanceId.slice("grok-bot:".length);
    const agentId = colliding ? `grok:bot:${instanceSlug}:${item.row.id}` : `grok:bot:${item.row.id}`;
    if (seen.has(agentId)) continue;

    const updatedAt = timestamp(item.row.lastActivityAt ?? item.row.updatedAt ?? item.row.createdAt)
      ?? new Date(nowMs).toISOString();
    const made = makeAgent({
      provider: "grok",
      sourceSessionId: `bot:${item.row.id}`,
      displayName: item.row.name ?? item.row.title ?? item.row.description,
      /* Sandbox store.db is not a project. Fall back to the Mac instance
         home so the board groups "Grok Bot" / "Grok Bot 2", not "store.db". */
      cwd: filesystemPath(item.row.path) ?? item.root,
      originCwd: item.root,
      startedAt: timestamp(item.row.createdAt),
      updatedAt,
      tokens: { scope: "unknown", provenance: "unknown" },
      transcriptTail: item.transcriptTail,
      humanMessages: item.humanMessages,
      thread: item.thread,
      meta: { sourcePath: item.sourcePath, nowMs, thresholds },
    });
    const agent: GrokBotAgent = {
      ...made,
      id: agentId,
      instanceId,
      instanceLabel: basename(item.root),
      /* N Bot rows share one Application Support folder. cwd fallback would
         mint unique-cwd against that folder; the early grok-bot resolve is
         the real fix, this is belt-and-suspenders. */
      allowCwdFallback: false,
    };
    seen.add(agent.id);
    agents.push(agent);
  }

  return { value: agents, errors };
}
