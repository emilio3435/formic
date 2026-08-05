import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { MAX_NAME_LENGTH } from "./naming";
import { stripTimestampMarkup } from "./human-message";
import type { AuthoredNameSource } from "../shared/types";

/* What a session is CALLED, as opposed to what it can be derived to be.

   src/server/naming.ts answers "what is this called?" from evidence the board
   already holds, and its top derived tier is the directory a session began in.
   That made every session unique and none of them legible: 93 lanes under one
   worktree tree are 93 sessions named after the same folder, and a folder does
   not say what an agent is doing. Measured on the live board 2026-08-04, the
   derived names were 100% unique and 0% informative.

   This module supplies the tier above it — a name somebody AUTHORED — for the
   overwhelming majority of sessions where nobody did. It reads the opening
   messages, asks a local model for a short title, and writes the answer down.

   Three properties make it safe to put a model in the naming path:

   FROZEN. A name is written once and never rewritten. The whole point of the
   naming contract is that names do not move; a namer that revised its opinion
   every refresh would reintroduce exactly the drift that contract removed.

   OUT OF BAND. Nothing here is awaited by a refresh. The board publishes
   derived names immediately and picks up authored ones on a later pass, so a
   slow or dead model costs latency nowhere.

   DEGRADING. Model, then heuristic, then the derived name that was already
   there. Every layer can fail and the board still renders. */

export const SESSION_NAMES_PATH = join(homedir(), ".anthill", "session-names.json");

/* Enough to cover the scan window several times over without letting a file the
   board rewrites on every naming pass grow without bound. */
const MAX_REMEMBERED = 5_000;

export interface SessionNameRecord {
  /** The title itself, already capped to the one shared limit. */
  name: string;
  /** Who authored it. `launch-env` is reserved for a harness hook writing here. */
  by: AuthoredNameSource;
  at: string;
}

export interface SessionNameFileOperations {
  readText(path: string): Promise<string>;
  makeDirectory(path: string): Promise<void>;
  writeText(path: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

const nodeFiles: SessionNameFileOperations = {
  readText: (path) => readFile(path, "utf8"),
  makeDirectory: async (path) => { await mkdir(path, { recursive: true }); },
  writeText: async (path, contents) => { await writeFile(path, contents, "utf8"); },
  rename,
};

function capped(name: string): string {
  /* The store boundary: open(), remember() and every namer output pass here,
     so a clock can neither be frozen as a name nor survive a reload. */
  const trimmed = stripTimestampMarkup(name).replace(/\s+/g, " ").trim();
  if (trimmed.length <= MAX_NAME_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_NAME_LENGTH - 1).trimEnd()}…`;
}

/* ------------------------------------------------------------------ the store */

export class JsonSessionNameStore {
  readonly #names = new Map<string, SessionNameRecord>();
  readonly #path: string;
  readonly #files: SessionNameFileOperations;
  #writeQueue: Promise<void> = Promise.resolve();
  #loadError?: string;

  private constructor(path: string, files: SessionNameFileOperations) {
    this.#path = path;
    this.#files = files;
  }

  /* Never rejects. A board that cannot start because a cache file is unreadable
     is worse in every case than a board that starts having forgotten some
     names — the names are an improvement on a fallback that still works. */
  static async open(
    path: string = SESSION_NAMES_PATH,
    files: SessionNameFileOperations = nodeFiles,
  ): Promise<JsonSessionNameStore> {
    const store = new JsonSessionNameStore(path, files);
    try {
      const parsed: unknown = JSON.parse(await files.readText(path));
      const entries = (parsed as { names?: unknown })?.names;
      if (entries && typeof entries === "object") {
        for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
          const record = value as Partial<SessionNameRecord>;
          const loaded = typeof record?.name === "string" ? capped(record.name) : "";
          if (loaded) {
            store.#names.set(key, {
              name: loaded,
              by: (record.by as AuthoredNameSource) ?? "launch-env",
              at: typeof record.at === "string" ? record.at : new Date(0).toISOString(),
            });
          }
        }
      }
    } catch (error) {
      const code = (error as { code?: string })?.code;
      // A file that does not exist yet is the normal first run, not a fault.
      if (code !== "ENOENT") {
        store.#loadError = error instanceof Error ? error.message : String(error);
        console.error(
          `[SessionNames] ${path} could not be read, so sessions keep their derived names: ${store.#loadError}`,
        );
      }
    }
    return store;
  }

  loadError(): string | undefined {
    return this.#loadError;
  }

  get(key: string): SessionNameRecord | undefined {
    return this.#names.get(key);
  }

  has(key: string): boolean {
    return this.#names.has(key);
  }

  size(): number {
    return this.#names.size;
  }

  /* Write-once. A caller that names a session twice is a caller that has changed
     its mind, and a name that changes is the defect this whole contract exists
     to remove — so the second answer is dropped rather than published. */
  async remember(key: string, record: SessionNameRecord): Promise<void> {
    if (this.#names.has(key)) return;
    const name = capped(record.name);
    if (!name) return;
    this.#names.set(key, { ...record, name });
    await this.#flush();
  }

  #flush(): Promise<void> {
    /* Serialized through one queue so two naming passes finishing together
       cannot interleave a read-modify-write and lose one of the two names. */
    this.#writeQueue = this.#writeQueue.then(async () => {
      try {
        if (this.#names.size > MAX_REMEMBERED) {
          const oldestFirst = [...this.#names.entries()].sort((a, b) => a[1].at.localeCompare(b[1].at));
          for (const [key] of oldestFirst.slice(0, this.#names.size - MAX_REMEMBERED)) {
            this.#names.delete(key);
          }
        }
        const body = JSON.stringify({ names: Object.fromEntries(this.#names) }, null, 2);
        await this.#files.makeDirectory(dirname(this.#path));
        /* Temp then rename: a crash mid-write leaves the previous file intact
           rather than a truncated one that the next boot would refuse. */
        const temporary = `${this.#path}.${process.pid}.tmp`;
        await this.#files.writeText(temporary, body);
        await this.#files.rename(temporary, this.#path);
      } catch (error) {
        console.error(`[SessionNames] could not persist names: ${String(error)}`);
      }
    });
    return this.#writeQueue;
  }
}

/* ------------------------------------------------------- reading the operator */

/* Everything a harness injects around what a human typed. Each pattern below was
   measured against live transcripts on this machine, and each was found by
   running the namer and reading what came out — the first message is very often
   not the operator's words at all. */
const INJECTED_BLOCK = new RegExp(
  "^\\s*(?:" +
    "<(?:recommended_plugins|environment_context|system-reminder|user_instructions" +
    "|apps_instructions|plugins_instructions|skills_instructions|collaboration_mode" +
    "|permissions instructions|subagent_notification|turn_aborted|file)\\b" +
    "|#\\s*(?:AGENTS|CLAUDE)\\.md instructions\\b" +
    "|Base directory for this skill\\b" +
    "|Caveat: The messages below were generated\\b" +
    "|>>>\\s*TRANSCRIPT START\\b" +
    "|The following is the (?:Codex|Claude) agent history\\b" +
  ")",
  "i",
);

const ANSI = /\[[0-9;]*[A-Za-z]|\[[0-9]{1,2}m/g;

const ENVELOPE_LINE = new RegExp(
  "^\\s*</?(?:system-reminder|command-name|command-message|command-args|command-contents" +
    "|local-command-stdout|local-command-stderr|local-command-caveat|environment_context" +
    "|recommended_plugins|user_instructions|file)\\b",
  "i",
);

const HEADING_PREFIX = /^(?:goal|mission|task|objective|context|summary|instructions?)\s*:\s*/i;

const CONTINUATION = /^(?:keep going|continue|checking in|go on|resume|thanks|thank you|ok|okay|yes|no|yep|sure)\b[.!\s]*$/i;

/* Survives cleaning but describes nothing: section headers and bare verbs. */
const NOT_A_TASK = /^(?:memory|context|summary|notes?|read|plan|status|update|background|instructions?|reference|appendix|overview|preamble|continue|done)$/i;

/* Reads like a rule the harness imposed rather than a request an operator made. */
const HARNESS_VOICE = /^(?:response|output|you are|the assistant|filesystem|your task is to follow|never |always )/i;

function cleanLine(line: string): string | undefined {
  let text = line.replace(ANSI, "").trim();
  if (!text || ENVELOPE_LINE.test(text)) return undefined;
  text = text
    .replace(/^#{1,6}\s+/, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .trim();
  text = text.replace(HEADING_PREFIX, "").trim();
  if (!text || CONTINUATION.test(text)) return undefined;
  return text;
}

/* The heuristic. Deliberately conservative: it would rather return nothing and
   let the derived name stand than publish a line of harness boilerplate as the
   title of somebody's work. */
export function distillName(messages: readonly string[]): string | undefined {
  for (const rawMessage of messages) {
    const message = rawMessage ? stripTimestampMarkup(rawMessage) : rawMessage;
    if (!message?.trim() || INJECTED_BLOCK.test(message.trimStart())) continue;
    const lines = message.split("\n").map(cleanLine).filter((line): line is string => Boolean(line));
    if (!lines.length) continue;
    // An explicit goal line anywhere near the top beats the opening line.
    const stated = lines.slice(0, 12).find((line) => /^(?:goal|mission|objective)\b/i.test(line));
    let candidate = (stated ?? lines[0]!).replace(HEADING_PREFIX, "").trim();
    candidate = candidate.split(/(?<=[.!?])\s+/)[0]!.trim().replace(/[.\s]+$/, "");
    if (!candidate || NOT_A_TASK.test(candidate) || HARNESS_VOICE.test(candidate)) continue;
    if (candidate.length < 12) continue;
    return capped(candidate);
  }
  return undefined;
}

/* --------------------------------------------------------------- the namer */

export interface NamerModel {
  /** Returns a short title, or undefined for any failure at all. */
  title(prompt: string): Promise<string | undefined>;
}

const OLLAMA_URL = process.env.ANTHILL_NAMER_URL ?? "http://localhost:11434/api/generate";
/* Instruction-tuned, and that is the whole reason for the `-it`. The `gemma4:e2b`
   variants on this machine answer /api/generate with an empty string and
   `done_reason: "length"` — they spend the whole token budget before emitting
   anything, so every session silently fell through to the heuristic. Override
   with ANTHILL_NAMER_MODEL; a model that returns nothing costs names, not
   correctness, because the heuristic is underneath. */
const OLLAMA_MODEL = process.env.ANTHILL_NAMER_MODEL ?? "gemma3n:e2b-it-q4_K_M";
const MODEL_TIMEOUT_MS = 12_000;

/* A local model by default: naming reads the opening of every session on this
   machine, which is the operator's own words about their own work, and that is
   not traffic to send anywhere by default. Free also means a slow month cannot
   turn the board's legibility into a bill. */
export const ollamaNamer: NamerModel = {
  async title(prompt: string): Promise<string | undefined> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), MODEL_TIMEOUT_MS);
    try {
      const response = await fetch(OLLAMA_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt,
          stream: false,
          options: { temperature: 0, num_predict: 60 },
        }),
        signal: abort.signal,
      });
      if (!response.ok) return undefined;
      const body = (await response.json()) as { response?: unknown };
      return typeof body.response === "string" ? body.response : undefined;
    } catch {
      // Down, slow, or absent — all the same answer, and none of them an error.
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  },
};

export function namingPrompt(messages: readonly string[]): string {
  const body = messages
    .map((message) => (message ? stripTimestampMarkup(message) : message))
    .filter((message) => message?.trim() && !INJECTED_BLOCK.test(message.trimStart()))
    .slice(0, 3)
    .join("\n---\n")
    .slice(0, 4_000);
  return [
    "Title this coding session in 3 to 8 words, as a short label a developer",
    "would recognise on a dashboard. Describe the WORK, not the tools.",
    "Reply with the title alone: no quotes, no punctuation at the end, no preamble.",
    "If the text below is only configuration or boilerplate, reply exactly: UNKNOWN",
    "",
    "---",
    body,
  ].join("\n");
}

/* The model is untrusted input. It is a small local model being asked for a
   label, so it will sometimes answer with a sentence, a quote, a refusal, or a
   paragraph explaining itself — every one of which would become somebody's
   session name if it were taken at face value. */
export function cleanModelTitle(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let title = stripTimestampMarkup(raw).trim().split("\n").map((line) => line.trim()).filter(Boolean)[0] ?? "";
  title = title.replace(/^["'`]+|["'`]+$/g, "").replace(/[.\s]+$/, "").trim();
  title = title.replace(/^(?:title|name|label)\s*:\s*/i, "").trim();
  if (!title || /^unknown$/i.test(title)) return undefined;
  if (title.length < 6) return undefined;
  // A sentence is not a label. Anything this long is the model explaining.
  if (title.split(/\s+/).length > 12) return undefined;
  if (/^(?:i |sorry|as an|here is|the text|this (?:is|appears))/i.test(title)) return undefined;
  return capped(title);
}

export interface NameCandidate {
  /** Stable key for the store — the agent id, which already carries the provider. */
  key: string;
  messages: readonly string[];
}

export interface NameSessionsDeps {
  store: JsonSessionNameStore;
  model?: NamerModel;
  /** Bounded so a backlog cannot saturate a local model or the event loop. */
  limit?: number;
}

/* Names what is not yet named. Never throws: it is called fire-and-forget from
   the refresh cycle, and an unhandled rejection there would take down a pass
   that had already succeeded at everything the operator actually asked for. */
export async function nameSessions(
  candidates: readonly NameCandidate[],
  deps: NameSessionsDeps,
): Promise<number> {
  const { store, model = ollamaNamer, limit = 12 } = deps;
  let named = 0;
  try {
    const pending = candidates.filter((candidate) => !store.has(candidate.key)).slice(0, limit);
    for (const candidate of pending) {
      try {
        const heuristic = distillName(candidate.messages);
        const fromModel = cleanModelTitle(await model.title(namingPrompt(candidate.messages)));
        /* Model first because it can tell an instruction from a preamble, which
           no amount of pattern matching reliably can — four rounds of filtering
           against live transcripts each uncovered another boilerplate family.
           The heuristic is the floor, not the goal. */
        const chosen = fromModel ?? heuristic;
        if (!chosen) continue;
        await store.remember(candidate.key, {
          name: chosen,
          by: "launch-env",
          at: new Date().toISOString(),
        });
        named += 1;
      } catch (error) {
        console.error(`[SessionNames] could not name ${candidate.key}: ${String(error)}`);
      }
    }
  } catch (error) {
    console.error(`[SessionNames] naming pass failed: ${String(error)}`);
  }
  return named;
}

/* ------------------------------------------------- reading the opening turns */

/* The namer reads the transcript itself rather than taking the collector's
   one-line `task`, because one line is not enough context to tell an
   instruction from a preamble — measured against live sessions, the opening
   line is boilerplate more often than it is the operator. Cheap despite the
   file read: a session is named once, ever, so this runs once per session and
   never again. */
const MAX_OPENING_MESSAGES = 6;
const MAX_TRANSCRIPT_BYTES = 512 * 1024;

function textOf(content: unknown): string | undefined {
  if (typeof content === "string") return content.trim() || undefined;
  if (!Array.isArray(content)) return undefined;
  const joined = content
    .map((part) =>
      typeof part === "string"
        ? part
        : part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
    )
    .join("\n")
    .trim();
  return joined || undefined;
}

/* Both transcript formats in one reader, because they differ only in where the
   role lives. Codex additionally has `developer` rows carrying its own config
   preamble — "Response MUST end with…", "You are `/root`…" — which are never
   the operator and are dropped by requiring the role to be `user`. */
export function openingMessages(jsonl: string): string[] {
  const out: string[] = [];
  for (const line of jsonl.split("\n")) {
    if (out.length >= MAX_OPENING_MESSAGES) break;
    if (!line.trim()) continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const payload = (row.payload && typeof row.payload === "object" ? row.payload : row) as Record<string, unknown>;
    const claudeRole = row.type === "user" ? "user" : undefined;
    const role = (payload.role as string | undefined) ?? claudeRole;
    if (role !== "user") continue;
    const message = payload.message && typeof payload.message === "object"
      ? (payload.message as Record<string, unknown>).content
      : payload.content;
    const text = textOf(message) ?? textOf((row.message as Record<string, unknown> | undefined)?.content);
    if (text) out.push(text);
  }
  return out;
}

export interface TranscriptReader {
  read(path: string): Promise<string>;
}

export const nodeTranscripts: TranscriptReader = {
  read: async (path) => {
    const handle = await readFile(path, "utf8");
    return handle.length > MAX_TRANSCRIPT_BYTES ? handle.slice(0, MAX_TRANSCRIPT_BYTES) : handle;
  },
};

/* Turns a board agent into something the namer can work with. Returns nothing
   rather than throwing for every failure an unread file can produce — deleted
   between refreshes, unreadable, or simply not a transcript. */
export async function candidateFor(
  agent: { id: string; artifacts?: readonly { path?: string }[] },
  transcripts: TranscriptReader = nodeTranscripts,
): Promise<NameCandidate | undefined> {
  const path = agent.artifacts?.find((artifact) => artifact?.path)?.path;
  if (!path) return undefined;
  try {
    const messages = openingMessages(await transcripts.read(path));
    return messages.length ? { key: agent.id, messages } : undefined;
  } catch {
    return undefined;
  }
}
