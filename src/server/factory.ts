import { readFileSync } from "node:fs";
import type { CollectedAgent } from "./types";
import type { IncrementalParser, ParseMetadata } from "./collectors";
import type { TokenUsage } from "../shared/types";
import { resolveAgentName } from "./naming";
import { MODEL_CONFIG } from "./model-config";

/* Factory (droid) sessions.

   Factory writes a session as two files side by side:

     ~/.factory/sessions/<cwd-slug>/<uuid>.jsonl          the transcript
     ~/.factory/sessions/<cwd-slug>/<uuid>.settings.json  model and token usage

   The transcript opens with a `session_start` record carrying the id, the cwd
   and — unusually among the providers here — a TITLE, plus
   `isSessionTitleManuallySet` saying whether a human chose it. That flag is the
   difference between an authored name and a generated one, and the naming
   contract has a tier for each, so it is read rather than ignored.

   Token usage lives only in the sibling settings file, which is why this parser
   reaches sideways for it instead of taking the transcript at face value. */

interface FactorySettings {
  model?: unknown;
  tokenUsage?: {
    inputTokens?: unknown;
    outputTokens?: unknown;
    cacheReadTokens?: unknown;
    cacheCreationTokens?: unknown;
    thinkingTokens?: unknown;
  };
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/* Factory records content as either a bare string or the block array every
   provider here uses. Both shapes appear in one transcript. */
function contentText(content: unknown): string | undefined {
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

/* The settings file is optional in every sense that matters: absent, unreadable
   or malformed all mean the same thing — this session reports no model and no
   tokens, which the board already renders honestly as "not reported". A session
   is never dropped for it. */
export function readFactorySettings(
  transcriptPath: string,
  read: (path: string) => string = (path) => readFileSync(path, "utf8"),
): FactorySettings {
  try {
    return JSON.parse(read(transcriptPath.replace(/\.jsonl$/, ".settings.json"))) as FactorySettings;
  } catch {
    return {};
  }
}

/* Incremental, like every other collector here, because `collectProvider` only
   speaks that interface: it tails a growing transcript by feeding new rows to a
   parser it keeps between refreshes. A one-shot parser is not merely slower here
   — `parserFor` throws for a provider it has no incremental parser for, which is
   how this collector silently produced zero agents and fifteen errors on its
   first real run. */
export function createFactoryParser(): IncrementalParser {
  let sessionId: string | undefined;
  let title: string | undefined;
  let titleAuthored = false;
  let cwd: string | undefined;
  let startedAt: string | undefined;
  let updatedAt: string | undefined;
  let firstUserText: string | undefined;
  let lastAssistantText: string | undefined;
  let messages = 0;

  const append = (rows: readonly Record<string, unknown>[]): void => {
    for (const row of rows) {
    if (row.type === "session_start") {
      sessionId ??= text(row.id);
      title ??= text(row.title);
      titleAuthored = row.isSessionTitleManuallySet === true;
      cwd ??= text(row.cwd);
      continue;
    }
    if (row.type !== "message") continue;
    messages += 1;
    const stamp = text(row.timestamp);
    if (stamp && Number.isFinite(Date.parse(stamp))) {
      startedAt ??= new Date(stamp).toISOString();
      updatedAt = new Date(stamp).toISOString();
    }
    const message = (row.message ?? {}) as Record<string, unknown>;
    const body = contentText(message.content);
    if (!body) continue;
    if (message.role === "user") firstUserText ??= body;
    if (message.role === "assistant") lastAssistantText = body;
    }
  };

  const result = (meta: ParseMetadata): CollectedAgent | null => {
  /* No id means this file is not a Factory session, whatever its extension.
     Returning null rather than inventing one keeps a stray file out of the
     board instead of on it under a fabricated identity. */
  if (!sessionId) return null;
  /* A transcript with a header and no turns is a session that was opened and
     abandoned. It has no activity to report and no time to place it at. */
  if (!messages) return null;

  const settings = readFactorySettings(meta.sourcePath ?? "");
  const usage = settings.tokenUsage ?? {};
  const input = num(usage.inputTokens);
  const output = num(usage.outputTokens);
  const cachedInput = num(usage.cacheReadTokens);
  const total = [input, output].some((value) => value !== undefined)
    ? (input ?? 0) + (output ?? 0)
    : undefined;
  const modelStr = text(settings.model);
  const win = (() => {
    if (!modelStr) return undefined;
    const low = modelStr.toLowerCase();
    for (const [needle, w] of Object.entries(MODEL_CONFIG.claudeContextWindows)) {
      if (low.includes(needle.toLowerCase())) return w;
    }
    return undefined;
  })();
  const tokens: TokenUsage = total === undefined
    ? { provenance: "unknown", contextWindow: win }
    : {
      total,
      input,
      output,
      cachedInput,
      contextWindow: win,
      /* Factory's settings file accumulates across the whole session rather
         than reporting the latest call, so this is `session` — the field the
         board uses to decide whether a number may be added to a rollup. */
      scope: "session",
      provenance: "observed",
    };

  const fallbackStamp = new Date(meta.mtimeMs ?? meta.nowMs ?? Date.now()).toISOString();
  return {
    id: `factory:${sessionId}`,
    provider: "factory",
    sourceSessionId: sessionId,
    /* The legacy derived field every surface rendered before the naming
       contract. Kept in the same shape the other collectors produce. */
    displayName: title ?? (cwd ? `Factory · ${cwd.split("/").filter(Boolean).pop()}` : "Factory session"),
    /* Resolved HERE because this parser builds a CollectedAgent directly rather
       than through `makeAgent`, and an agent without `identity` is silently
       skipped by the fleet-wide uniqueness pass — it does not throw, it just
       never gets named. That is exactly how Cursor's child sessions were missed.

       Only a title a human actually set counts as authored; Factory generates
       one from the opening prompt otherwise, which is the same evidence class
       as the task line and is ranked as such by the contract. */
    identity: resolveAgentName({
      provider: "factory",
      sourceSessionId: sessionId,
      authored: titleAuthored && title ? { name: title, by: "factory-title" } : undefined,
      originCwd: cwd,
      taskName: title ?? firstUserText,
    }),
    cwd,
    originCwd: cwd,
    model: text(settings.model),
    task: title ?? firstUserText,
    status: "running",
    statusReason: "Factory session activity.",
    startedAt,
    updatedAt: updatedAt ?? fallbackStamp,
    tokens,
    transcriptTail: lastAssistantText?.slice(-800),
    artifacts: meta.sourcePath ? [{ label: "Factory transcript", path: meta.sourcePath }] : [],
    gates: [],
  };
  };

  return { append, result };
}

/* The one-shot form, for callers holding a whole transcript already. */
export function parseFactoryJsonl(jsonl: string, meta: ParseMetadata = {}): CollectedAgent | null {
  const parser = createFactoryParser();
  const rows: Record<string, unknown>[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as unknown;
      // A half-written final line is expected while a session is live.
      if (value && typeof value === "object") rows.push(value as Record<string, unknown>);
    } catch {
      continue;
    }
  }
  parser.append(rows);
  return parser.result(meta);
}
