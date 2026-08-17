export const ORCH_LAUNCH_COMMANDS = ["codex", "claude", "grok"] as const;
export type OrchLaunchCommand = (typeof ORCH_LAUNCH_COMMANDS)[number];

export const ORCH_TOKEN_FILE = "data/formic-orch.env";
export const ORCH_AGENT_CAP = 200;
export const ORCH_PEEK_CAP = 50;
export const ORCH_PEEK_PROSE_CHARS = 480;

export interface OrchWorkspace {
  ref: string;
  id?: string;
  title: string;
  selected?: boolean;
}

export interface OrchAgent {
  id: string;
  name: string;
  kind: string;
  program: string;
  ready: boolean;
  miss: string | null;
  workspaceRef: string | null;
}

export interface OrchFleetResult {
  ok: true;
  generatedAt: string;
  workspaces: OrchWorkspace[];
  agents: OrchAgent[];
  truncated?: true;
}

export interface OrchPeekAttention {
  kind: string;
  evidence?: string;
  class?: string;
}

export interface OrchPeekCard {
  id: string;
  name: string;
  kind: string;
  program: string;
  ready: boolean;
  miss: string | null;
  workspaceRef: string | null;
  workspaceTitle?: string;
  status: string;
  statusReason: string;
  lifecycle?: string;
  goal: string | null;
  lastReply: string | null;
  attention: OrchPeekAttention | null;
  nextAction?: string;
  contextPct?: number;
  cwd?: string;
  repo?: string;
  branch?: string;
  dirty?: boolean;
  tests?: { state: string; summary?: string };
  files?: string[];
  workingSince?: string;
  lastThreadAt?: string;
  processState?: string;
  model?: string;
}

export interface OrchPeekResult {
  ok: true;
  generatedAt: string;
  cards: OrchPeekCard[];
  truncated?: true;
}

export interface OrchSendInput {
  agentId: string;
  instruction: string;
  clientNonce?: string;
}

export interface OrchLaunchInput {
  cwd: string;
  command: OrchLaunchCommand;
  title?: string;
  clientNonce?: string;
}

export interface OrchErrorBody {
  ok: false;
  error: { code: string; message: string };
}

export function isOrchLaunchCommand(value: string): value is OrchLaunchCommand {
  return (ORCH_LAUNCH_COMMANDS as readonly string[]).includes(value);
}

export function clipOrchProse(value: string | null | undefined, max = ORCH_PEEK_PROSE_CHARS): string | null {
  if (value == null) return null;
  const text = value.trim();
  if (!text) return null;
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Function-only fetch so CLI/MCP tests can inject mocks without `fetch.preconnect`. */
export type OrchFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function isLoopbackOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && (host === "127.0.0.1" || host === "localhost" || host === "::1");
  } catch {
    return false;
  }
}
