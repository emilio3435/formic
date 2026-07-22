import type { Provider } from "../shared/types";

export const MAX_HUMAN_MESSAGE_CHARS = 240;

export interface HumanMessageCandidate {
  role: "assistant" | "user";
  content: unknown;
  isMeta?: boolean;
}

const NON_HUMAN_PREFIX = /^(?:#\s*(?:AGENTS|CLAUDE)\.md instructions\b|<(?:(?:environment_context|recommended_plugins|subagent_notification|turn_aborted|permissions instructions|collaboration_mode|apps_instructions|plugins_instructions|skills_instructions|instructions)\b|file\b)|#{1,6}\s+session update\b)/i;
const TOOL_LINE = /^(?:tool[ _-]?(?:call|use|result)|function[ _-]?(?:call|result))\b/i;
const SHELL_LINE = /^(?:[$›]\s*|(?:bun|cargo|cat|cd|curl|find|git|grep|ls|make|node|npm|pnpm|pwd|rg|rm|sed|tsc|vitest|yarn)\s+|(?:\.\.?\/|\/Users\/|\/private\/|\/tmp\/|[A-Za-z]:[\\/]))/i;
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

function readableText(text: string): string | undefined {
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
  return shorten(cleaned);
}

export function readableHumanMessage(provider: Provider, content: unknown): string | undefined {
  const text = textParts(provider, content).join("\n");
  return readableText(text);
}

export function extractLastHumanMessage(
  provider: Provider,
  candidates: readonly HumanMessageCandidate[],
  task?: string,
  statusReason?: string,
): string | null {
  for (const candidate of [...candidates].reverse()) {
    if (candidate.isMeta) continue;
    const message = readableHumanMessage(provider, candidate.content);
    if (message) return message;
  }
  for (const fallback of [task, statusReason]) {
    const message = typeof fallback === "string" ? readableText(fallback) : undefined;
    if (message) return message;
  }
  return null;
}
