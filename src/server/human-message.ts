import type { Provider } from "../shared/types";

export const MAX_HUMAN_MESSAGE_CHARS = 240;

export interface HumanMessageCandidate {
  role: "assistant" | "user";
  content: unknown;
  isMeta?: boolean;
  /** Provider source time directly attached to this message record. */
  timestamp?: unknown;
}

/* Cursor (and any harness that embeds transport metadata in message text)
   wraps a clock in <timestamp>…</timestamp> blocks. The clock is transport,
   never words — strip it at every ingress where transcript text becomes
   something the board publishes: tasks, messages, names, quoted evidence. */
export function stripTimestampMarkup(text: string): string {
  return text.replace(/<timestamp>[\s\S]*?<\/timestamp>/gi, "");
}

const NON_HUMAN_PREFIX = /^(?:#\s*(?:AGENTS|CLAUDE)\.md instructions\b|<(?:(?:environment_context|recommended_plugins|subagent_notification|turn_aborted|permissions instructions|collaboration_mode|apps_instructions|plugins_instructions|skills_instructions|instructions)\b|file\b)|#{1,6}\s+session update\b)/i;
const TOOL_LINE = /^(?:tool[ _-]?(?:call|use|result)|function[ _-]?(?:call|result))\b/i;
const SHELL_LINE = /^(?:[$›]\s*|(?:\.\.?\/|\/Users\/|\/private\/|\/tmp\/|[A-Za-z]:[\\/]))/i;
const PATH_ONLY = /^(?:\.\.?\/|\/Users\/|\/private\/|\/tmp\/|[A-Za-z]:[\\/]|(?:src|tests|scripts|app|lib|packages)\/)[\w./@:-]+$/i;
const DIFF_LINE = /^(?:diff --git\b|index [0-9a-f]+\.\.[0-9a-f]+|@@ .* @@|\+\+\+ |--- )/;
const CITATION_ONLY = /^(?:(?:\[\^?\d+\]|【[^】]+】|\([^)]*\))\s*)+$/;
/* Codex appends a memory-citation / rollout trailer after spoken prose. The
   end-anchored close window lands inside it unless the collector strips first. */
const CODEX_CITATION_BLOCK = /<oai-mem-citation\b[^>]*>[\s\S]*?<\/oai-mem-citation>/gi;
const CODEX_CITATION_LEFTOVER = /<\/?(?:oai-mem-citation|citation_entries|citation_entry|rollout_ids|rollout_id)\b[^>]*>/gi;
const CODEX_MEMORY_ENTRY = /MEMORY\.md:\d+(?:-\d+)?\|note=\[[^\]]*\]/gi;
const CODEX_CLOSE_TRAILER = /MEMORY\.md:\d+|oai-mem-citation|citation_entries|rollout_ids|\|note=\[/i;

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

function stripCodexCitationTrailer(text: string, blockReplacement: string): string {
  return text
    .replace(CODEX_CITATION_BLOCK, blockReplacement)
    .replace(CODEX_CITATION_LEFTOVER, blockReplacement)
    .replace(CODEX_MEMORY_ENTRY, blockReplacement);
}

function closeWindowLandsInCitation(text: string): boolean {
  const tail = text.length <= MAX_HUMAN_MESSAGE_CHARS ? text : text.slice(-MAX_HUMAN_MESSAGE_CHARS);
  return CODEX_CLOSE_TRAILER.test(tail);
}

function stripMessageChrome(text: string, blockReplacement: string): string | undefined {
  let value = text.replace(/\r/g, "").trim();
  if (!value || NON_HUMAN_PREFIX.test(value)) return undefined;

  value = stripTimestampMarkup(value)
    .replace(/<user_query\b[^>]*>|<\/user_query>/gi, "")
    .replace(/<file\b[^>]*>|<\/file>/gi, "")
    // Slash-command + local-command transport envelopes (Claude Code) are
    // machinery, not human words — drop the whole block, content included.
    .replace(/<(command-name|command-message|command-args|command-contents)>[\s\S]*?<\/\1>/gi, blockReplacement)
    .replace(/<(local-command-stdout|local-command-stderr|local-command-caveat)>[\s\S]*?<\/\1>/gi, blockReplacement)
    .trim();
  value = stripCodexCitationTrailer(value, blockReplacement).trim();
  if (!value || NON_HUMAN_PREFIX.test(value)) return undefined;
  return value;
}

function flattenMarkdown(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1");
}

function rejectMachinePayload(value: string): boolean {
  if (/^[{[]/.test(value)) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") return true;
    } catch {
      // A prose message may legitimately begin with a bracket.
    }
  }
  return /^<[A-Za-z][\w:.-]*(?:\s[^>]*)?>[\s\S]*<\/[A-Za-z][\w:.-]*>\s*$/i.test(value);
}

function isDroppedLine(line: string): boolean {
  return TOOL_LINE.test(line)
    || SHELL_LINE.test(line)
    || PATH_ONLY.test(line)
    || /^\s*(?:sources?|references?):/i.test(line)
    || CITATION_ONLY.test(line)
    || DIFF_LINE.test(line);
}

function stripCitationMarks(value: string): string {
  return value.replace(/\[\^?\d+\]|【[^】]+】/g, "");
}

/* Everything readableText does EXCEPT the final truncation, so a caller that
   wants the end of a message can have the same cleaning without the front
   window baked in. The row one-liner JOINS surviving lines. */
function cleanMessage(text: string): string | undefined {
  let value = stripMessageChrome(text, " ");
  if (value === undefined) return undefined;

  // Flatten markdown so the one-line human view reads as prose, not source.
  value = flattenMarkdown(value);
  if (!value || NON_HUMAN_PREFIX.test(value)) return undefined;
  if (rejectMachinePayload(value)) return undefined;

  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isDroppedLine(line));
  if (lines.length === 0) return undefined;

  const cleaned = stripCitationMarks(lines.join(" "))
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || /^(?:diff|index|patch|changes?)\b[\s:.-]*$/i.test(cleaned)) return undefined;
  return cleaned;
}

/* Sibling of cleanMessage for the inspector chat body. Same envelope and
   citation stripping; keeps newlines, blank lines, list markers, and table
   rows. No join-to-spaces. No squeeze across newlines. */
function layoutMessage(text: string): string | undefined {
  let value = stripMessageChrome(text, "\n");
  if (value === undefined) return undefined;
  value = stripInlineMarkdown(value);
  if (!value || NON_HUMAN_PREFIX.test(value)) return undefined;
  if (rejectMachinePayload(value.trim())) return undefined;

  const kept: string[] = [];
  for (const line of value.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      kept.push("");
      continue;
    }
    if (isDroppedLine(trimmed)) continue;
    kept.push(stripCitationMarks(line).replace(/[ \t]+$/g, ""));
  }
  while (kept.length > 0 && kept[0] === "") kept.shift();
  while (kept.length > 0 && kept[kept.length - 1] === "") kept.pop();
  const cleaned = kept.join("\n");
  if (!cleaned || /^(?:diff|index|patch|changes?)\b[\s:.-]*$/i.test(cleaned.replace(/\s+/g, " ").trim())) {
    return undefined;
  }
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
  const raw = textParts(provider, content).join("\n");
  const cleaned = cleanMessage(raw);
  if (cleaned === undefined) return undefined;
  /* #85: when the end window lands in the citation trailer, the leftover
     spoken fragment before the tags is not the close. Keep this turn's
     spoken front instead of walking back to N-1. */
  if (closeWindowLandsInCitation(raw)) return shorten(cleaned);
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

export function readableChatBody(provider: Provider, content: unknown): string | undefined {
  const text = textParts(provider, content).join("\n");
  return layoutMessage(text);
}

export function extractLastHumanFacingAt(
  provider: Provider,
  candidates: readonly HumanMessageCandidate[],
): string | undefined {
  let latest: string | undefined;
  for (const candidate of candidates) {
    if (candidate.isMeta || !readableHumanMessage(provider, candidate.content)) continue;
    if (typeof candidate.timestamp !== "string" || !Number.isFinite(Date.parse(candidate.timestamp))) continue;
    const timestamp = new Date(candidate.timestamp).toISOString();
    if (!latest || timestamp > latest) latest = timestamp;
  }
  return latest;
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

export function extractChatBodyByRole(
  provider: Provider,
  candidates: readonly HumanMessageCandidate[],
  role: "assistant" | "user",
): string | null {
  for (const candidate of [...candidates].reverse()) {
    if (candidate.isMeta || candidate.role !== role) continue;
    const body = readableChatBody(provider, candidate.content);
    if (body) return body;
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
