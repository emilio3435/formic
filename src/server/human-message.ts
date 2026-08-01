import type { Provider } from "../shared/types";

export const MAX_HUMAN_MESSAGE_CHARS = 240;

export interface HumanMessageCandidate {
  role: "assistant" | "user";
  content: unknown;
  isMeta?: boolean;
}

const NON_HUMAN_PREFIX = /^(?:#\s*(?:AGENTS|CLAUDE)\.md instructions\b|<(?:(?:environment_context|recommended_plugins|subagent_notification|turn_aborted|permissions instructions|collaboration_mode|apps_instructions|plugins_instructions|skills_instructions|instructions)\b|file\b)|#{1,6}\s+session update\b)/i;
const TOOL_LINE = /^(?:tool[ _-]?(?:call|use|result)|function[ _-]?(?:call|result))\b/i;
const SHELL_LINE = /^(?:[$›]\s*|(?:\.\.?\/|\/Users\/|\/private\/|\/tmp\/|[A-Za-z]:[\\/]))/i;
const PATH_ONLY = /^(?:\.\.?\/|\/Users\/|\/private\/|\/tmp\/|[A-Za-z]:[\\/]|(?:src|tests|scripts|app|lib|packages)\/)[\w./@:-]+$/i;
const DIFF_LINE = /^(?:diff --git\b|index [0-9a-f]+\.\.[0-9a-f]+|@@ .* @@|\+\+\+ |--- )/;
const CITATION_ONLY = /^(?:(?:\[\^?\d+\]|【[^】]+】|\([^)]*\))\s*)+$/;

function textParts(provider: Provider, content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];

  const allowedTypes = provider === "cursor"
    ? new Set(["text"])
    : provider === "claude"
      ? new Set(["text"])
      : new Set(["text", "input_text", "output_text"]);
  return content.flatMap((part) => {
    if (typeof part === "string") return [part];
    if (!part || typeof part !== "object" || typeof part.text !== "string") return [];
    return !part.type || allowedTypes.has(part.type) ? [part.text] : [];
  });
}

function shorten(text: string): string {
  if (text.length <= MAX_HUMAN_MESSAGE_CHARS) return text;
  const clipped = text.slice(0, MAX_HUMAN_MESSAGE_CHARS - 1);
  const boundary = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, boundary > MAX_HUMAN_MESSAGE_CHARS * 0.6 ? boundary : clipped.length).trimEnd()}…`;
}

/* Everything readableText does EXCEPT the final truncation, so a caller that
   wants the end of a message can have the same cleaning without the front
   window baked in. */
function cleanMessage(text: string): string | undefined {
  let value = text.replace(/\r/g, "").trim();
  if (!value || NON_HUMAN_PREFIX.test(value)) return undefined;

  value = value
    .replace(/<timestamp>[\s\S]*?<\/timestamp>/gi, "")
    .replace(/<user_query\b[^>]*>|<\/user_query>/gi, "")
    .replace(/<file\b[^>]*>|<\/file>/gi, "")
    // Slash-command + local-command transport envelopes (Claude Code) are
    // machinery, not human words — drop the whole block, content included.
    .replace(/<(command-name|command-message|command-args|command-contents)>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(local-command-stdout|local-command-stderr|local-command-caveat)>[\s\S]*?<\/\1>/gi, " ")
    // Flatten markdown so the one-line human view reads as prose, not source.
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
  if (!value || NON_HUMAN_PREFIX.test(value)) return undefined;

  if (/^[{[]/.test(value)) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") return undefined;
    } catch {
      // A prose message may legitimately begin with a bracket.
    }
  }
  if (/^<[A-Za-z][\w:.-]*(?:\s[^>]*)?>[\s\S]*<\/[A-Za-z][\w:.-]*>\s*$/i.test(value)) return undefined;

  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !TOOL_LINE.test(line))
    .filter((line) => !SHELL_LINE.test(line))
    .filter((line) => !PATH_ONLY.test(line))
    .filter((line) => !/^\s*(?:sources?|references?):/i.test(line))
    .filter((line) => !CITATION_ONLY.test(line));
  if (lines.length === 0) return undefined;

  const cleaned = lines
    .filter((line) => !DIFF_LINE.test(line))
    .join(" ")
    .replace(/\[\^?\d+\]|【[^】]+】/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || /^(?:diff|index|patch|changes?)\b[\s:.-]*$/i.test(cleaned)) return undefined;
  return cleaned;
}

function readableText(text: string): string | undefined {
  const cleaned = cleanMessage(text);
  return cleaned === undefined ? undefined : shorten(cleaned);
}

/* The END of a message, not its beginning.

   readableText keeps the first 240 characters and drops the rest, which is the
   right shape for a one-line preview and exactly wrong for reading intent: an
   agent that asks "should I roll back or patch forward?" asks it in its last
   sentence, after the explanation. Front-truncation discarded every one of
   those before the snapshot existed, which is why the attention detectors had
   almost nothing to read.

   Returns the final sentence when the message ends on one, so the caller gets a
   complete thought rather than a window that happens to land mid-clause. */
export function readableClosing(provider: Provider, content: unknown): string | undefined {
  const cleaned = cleanMessage(textParts(provider, content).join("\n"));
  if (cleaned === undefined) return undefined;
  if (cleaned.length <= MAX_HUMAN_MESSAGE_CHARS) return cleaned;

  // Prefer a sentence boundary inside the tail window; a question mark or full
  // stop is where a thought actually starts.
  const tail = cleaned.slice(-MAX_HUMAN_MESSAGE_CHARS);
  const boundary = tail.search(/(?<=[.!?])\s+(?=[A-Z(“"'\d])/);
  const candidate = boundary === -1 ? tail : tail.slice(boundary).trim();
  // A sentence-start that leaves almost nothing is worse than a clipped window.
  const closing = candidate.length >= 24 ? candidate : tail.trim();
  return closing === cleaned ? closing : `…${closing}`;
}

export function readableHumanMessage(provider: Provider, content: unknown): string | undefined {
  const text = textParts(provider, content).join("\n");
  return readableText(text);
}

export function extractLastHumanMessage(
  provider: Provider,
  candidates: readonly HumanMessageCandidate[],
  task?: string,
  _statusReason?: string,
): string | null {
  for (const candidate of [...candidates].reverse()) {
    if (candidate.isMeta) continue;
    const message = readableHumanMessage(provider, candidate.content);
    if (message) return message;
  }
  const fallback = typeof task === "string" ? readableText(task) : undefined;
  if (fallback) return fallback;
  return null;
}

export function extractLastMessageByRole(
  provider: Provider,
  candidates: readonly HumanMessageCandidate[],
  role: "assistant" | "user",
): string | null {
  for (const candidate of [...candidates].reverse()) {
    if (candidate.isMeta || candidate.role !== role) continue;
    const message = readableHumanMessage(provider, candidate.content);
    if (message) return message;
  }
  return null;
}

/* The closing words of the last message from `role`, attributed by construction.
   The transcript tail cannot do this: it is a fixed-length slice of the whole
   conversation, so its final line may be the operator's, and mistaking one for
   the other inverts who is waiting for whom. Walking the role-tagged candidates
   removes the guess. */
export function extractClosingByRole(
  provider: Provider,
  candidates: readonly HumanMessageCandidate[],
  role: "assistant" | "user",
): string | null {
  for (const candidate of [...candidates].reverse()) {
    if (candidate.isMeta || candidate.role !== role) continue;
    const closing = readableClosing(provider, candidate.content);
    if (closing) return closing;
  }
  return null;
}
