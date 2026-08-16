/* Thread clocks for the board row time band.

   `updatedAt` is collector activity (heartbeats, token_count, mtime).
   `lastHumanFacingAt` is readable user/assistant prose.
   Neither is the row clock.

   lastThreadAt  — newest user / assistant / tool / system event.
   workingSince  — start of the current open working streak. A later tool
                   does not move it. A user send (or the first thread event
                   after a closed turn) starts a new streak. A turn-end
                   clears it. */

export type ThreadRole = "user" | "assistant" | "tool" | "system";

export function normalizeThreadIso(value: unknown): string | undefined {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

export function contentHasPartType(content: unknown, type: string): boolean {
  if (!Array.isArray(content)) return false;
  return content.some((part) =>
    Boolean(part && typeof part === "object" && (part as { type?: unknown }).type === type),
  );
}

export function contentHasText(content: unknown): boolean {
  if (typeof content === "string") return content.trim().length > 0;
  if (!Array.isArray(content)) return false;
  return content.some((part) => {
    if (typeof part === "string") return part.trim().length > 0;
    if (!part || typeof part !== "object") return false;
    const rec = part as { type?: unknown; text?: unknown };
    if (rec.type === "thinking" || rec.type === "reasoning") return false;
    return typeof rec.text === "string" && rec.text.trim().length > 0;
  });
}

export class ThreadClock {
  lastThreadAt?: string;
  workingSince?: string;
  #open = false;

  observe(iso: unknown, role: ThreadRole, opts: { endsTurn?: boolean } = {}): this {
    const at = normalizeThreadIso(iso);
    if (at) {
      if (!this.lastThreadAt || at > this.lastThreadAt) this.lastThreadAt = at;
      if (role === "user") {
        this.workingSince = at;
        this.#open = true;
      } else if (!this.#open) {
        this.workingSince = at;
        this.#open = true;
      }
    }
    if (opts.endsTurn) {
      this.#open = false;
      this.workingSince = undefined;
    }
    return this;
  }

  snapshot(): { lastThreadAt?: string; workingSince?: string } {
    return { lastThreadAt: this.lastThreadAt, workingSince: this.workingSince };
  }
}

export function observeTranscriptMessage(
  clock: ThreadClock,
  timestamp: unknown,
  role: unknown,
  content?: unknown,
  opts: { endsTurn?: boolean } = {},
): void {
  if (role !== "user" && role !== "assistant" && role !== "tool" && role !== "system") return;
  const hasTool = contentHasPartType(content, "tool_result") || contentHasPartType(content, "tool_use");
  if (role === "assistant" && !hasTool && !contentHasText(content) && !opts.endsTurn) return;
  const threadRole: ThreadRole = hasTool && role !== "user" ? "tool" : role;
  clock.observe(timestamp, threadRole, opts);
}

export function observeClaudeRow(
  clock: ThreadClock,
  row: {
    type?: unknown;
    isMeta?: unknown;
    timestamp?: unknown;
    message?: { role?: unknown; content?: unknown; stop_reason?: unknown };
  },
  timestamp?: unknown,
): void {
  const content = row.message?.content;
  const isMeta = row.isMeta === true;
  const hasToolResult = contentHasPartType(content, "tool_result");
  const hasToolUse = contentHasPartType(content, "tool_use");
  if (isMeta && !hasToolResult) return;

  const at = timestamp ?? row.timestamp;
  const endTurn = row.message?.stop_reason === "end_turn";
  if (row.type === "user" && !isMeta) {
    clock.observe(at, "user");
    return;
  }
  if (hasToolResult || hasToolUse) {
    clock.observe(at, "tool", { endsTurn: endTurn });
    return;
  }
  if (row.type === "assistant") {
    if (!contentHasText(content) && !endTurn) return;
    clock.observe(at, "assistant", { endsTurn: endTurn });
  }
}

export function threadFromMessages(
  messages: readonly { role?: string; timestamp?: unknown; content?: unknown }[] | undefined,
  ended = false,
): { lastThreadAt?: string; workingSince?: string } {
  const clock = new ThreadClock();
  for (const message of messages ?? []) {
    observeTranscriptMessage(clock, message.timestamp, message.role, message.content);
  }
  if (ended) clock.observe(undefined, "system", { endsTurn: true });
  return clock.snapshot();
}
