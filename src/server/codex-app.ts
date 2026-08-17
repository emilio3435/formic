import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { join } from "node:path";
import type {
  CodexAppMiss,
  CmuxTarget,
  IdentityTrace,
  IdentityTraceStep,
} from "../shared/types";
import type { CollectedAgent } from "./types";

export const CODEX_APP_CLIENT_NAME = "formic";

export const CODEX_APP_COPY: Record<CodexAppMiss, { cause: string; remedy: string }> = {
  "no-thread": {
    cause: "This Codex desktop thread is not in the local Codex store.",
    remedy: "Formic can Send only after that rollout UUID exists on disk.",
  },
  "resume-rejected": {
    cause: "Codex app-server did not accept thread/resume for this rollout.",
    remedy: "Open the thread in ChatGPT.app / Codex desktop and retry. An open app-server FD is not Send.",
  },
  unreachable: {
    cause: "Codex app-server is not reachable for this desktop thread.",
    remedy: "Start ChatGPT.app so Formic can use the official app-server socket.",
  },
};

export const CHATGPT_CONSUMER_COPY = {
  cause: "Consumer ChatGPT chats have no official continue-chat write.",
  remedy: "Formic will not Send into a consumer ChatGPT thread.",
} as const;

export const CODEX_APP_INTERRUPT_REASON = "Codex desktop Interrupt is not this surface.";

export interface CodexAppApprovalRequest {
  method: string;
  id: number;
  params: Record<string, unknown>;
}

export interface CodexAppRpcResult {
  ok: boolean;
  status?: string;
  turnId?: string;
  error?: string;
  approvals?: CodexAppApprovalRequest[];
}

export interface CodexAppOps {
  threadExists?(threadId: string): boolean;
  rpc?(method: string, params: Record<string, unknown>): Promise<CodexAppRpcResult>;
  answerApproval?(request: {
    id: number;
    method: string;
    decision: "decline";
  }): Promise<{ ok: boolean }>;
  probeOk?: boolean;
  close?(): void;
}

const resumeCache = new Map<string, boolean>();

export function resetCodexAppResumeForTests(): void {
  resumeCache.clear();
}

export function recordCodexAppResumeResult(threadId: string, ok: boolean): void {
  if (threadId) resumeCache.set(threadId, ok);
}

export function lastCodexAppResumeOk(threadId: string): boolean | undefined {
  return resumeCache.get(threadId);
}

export function isCodexCliLaunch(launch?: { entrypoint?: string; promptSource?: string }): boolean {
  const entry = launch?.entrypoint ?? "";
  const source = launch?.promptSource ?? "";
  return entry === "codex-tui" || entry === "codex_exec" || source === "cli" || source === "exec";
}

export function isCodexAppLaunch(launch?: { entrypoint?: string; promptSource?: string }): boolean {
  const entry = launch?.entrypoint ?? "";
  return entry === "Codex Desktop" || entry === "codex_work_desktop";
}

export function isConsumerChatGptLaunch(launch?: { entrypoint?: string; promptSource?: string }): boolean {
  if (isCodexAppLaunch(launch) || isCodexCliLaunch(launch)) return false;
  const mark = `${launch?.entrypoint ?? ""} ${launch?.promptSource ?? ""}`.toLowerCase();
  return /\bchatgpt\b/.test(mark) && !/\bcodex\b/.test(mark);
}

export function isCodexAppTarget(target: Pick<CmuxTarget, "kind"> | undefined): boolean {
  return target?.kind === "codex-app";
}

export function isConsumerChatGptTarget(target: Pick<CmuxTarget, "kind"> | undefined): boolean {
  return target?.kind === "chatgpt";
}

export function isCodexAppAgent(agent: {
  launch?: { entrypoint?: string; promptSource?: string };
  target?: Pick<CmuxTarget, "kind">;
}): boolean {
  if (isCodexAppTarget(agent.target)) return true;
  return isCodexAppLaunch(agent.launch);
}

export function isConsumerChatGptAgent(agent: {
  launch?: { entrypoint?: string; promptSource?: string };
  target?: Pick<CmuxTarget, "kind">;
}): boolean {
  if (isConsumerChatGptTarget(agent.target)) return true;
  return isConsumerChatGptLaunch(agent.launch);
}

export function codexAppThreadId(agent: {
  sourceSessionId?: string;
  target?: Pick<CmuxTarget, "threadId">;
}): string {
  return agent.target?.threadId?.trim() || agent.sourceSessionId?.trim() || "";
}

export function initializeParams(): Record<string, unknown> {
  return {
    clientInfo: {
      name: CODEX_APP_CLIENT_NAME,
      title: "Formic",
    },
  };
}

export function threadIsGenerating(result: Pick<CodexAppRpcResult, "status" | "turnId">): boolean {
  const status = (result.status ?? "").toLowerCase().replace(/_/g, "");
  return status === "inprogress" || status === "active" || status === "generating";
}

export function defaultCodexHome(): string {
  return process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
}

export function defaultControlSocketPath(home = defaultCodexHome()): string {
  return join(home, "app-server-control", "app-server-control.sock");
}

function rolloutNameFor(threadId: string): RegExp {
  return new RegExp(`^rollout-.*-${threadId}\\.jsonl$`, "i");
}

export function codexThreadExistsOnDisk(threadId: string, home = defaultCodexHome()): boolean {
  if (!threadId) return false;
  const sessions = join(home, "sessions");
  if (!existsSync(sessions)) return false;
  const match = rolloutNameFor(threadId);
  const walk = (dir: string, depth: number): boolean => {
    if (depth > 6) return false;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return false;
    }
    for (const name of entries) {
      if (match.test(name)) return true;
      const path = join(dir, name);
      try {
        if (statSync(path).isDirectory() && walk(path, depth + 1)) return true;
      } catch {
        /* skip unreadable */
      }
    }
    return false;
  };
  return walk(sessions, 0);
}

function threadExistsFromAgent(agent: CollectedAgent, ops: CodexAppOps): boolean {
  const threadId = codexAppThreadId(agent);
  if (ops.threadExists) return ops.threadExists(threadId);
  const transcript = agent.artifacts?.find((artifact) => artifact.kind === "transcript")?.path;
  if (transcript && transcript.includes(threadId) && existsSync(transcript)) return true;
  return codexThreadExistsOnDisk(threadId);
}

export function assessCodexAppWrite(
  agent: CollectedAgent,
  ops: CodexAppOps = {},
): {
  ready: boolean;
  threadId: string;
  reason: string;
  miss?: CodexAppMiss;
} {
  const threadId = codexAppThreadId(agent);
  if (!threadId) {
    return { ready: false, threadId, miss: "no-thread", reason: CODEX_APP_COPY["no-thread"].cause };
  }
  if (!threadExistsFromAgent(agent, ops)) {
    return { ready: false, threadId, miss: "no-thread", reason: CODEX_APP_COPY["no-thread"].cause };
  }
  if (ops.probeOk === false) {
    return { ready: false, threadId, miss: "resume-rejected", reason: CODEX_APP_COPY["resume-rejected"].cause };
  }
  if (ops.probeOk === true || ops.rpc) {
    return { ready: true, threadId, reason: "Codex app-server accepted thread/resume for this rollout." };
  }
  const cached = lastCodexAppResumeOk(threadId);
  if (cached === true) {
    return { ready: true, threadId, reason: "Codex app-server accepted thread/resume for this rollout." };
  }
  if (cached === false) {
    return { ready: false, threadId, miss: "resume-rejected", reason: CODEX_APP_COPY["resume-rejected"].cause };
  }
  if (existsSync(defaultControlSocketPath())) {
    return { ready: true, threadId, reason: "Codex app-server accepted thread/resume for this rollout." };
  }
  return { ready: false, threadId, miss: "unreachable", reason: CODEX_APP_COPY.unreachable.cause };
}

export function resolveCodexAppControlTarget(
  agent: CollectedAgent,
  ops: CodexAppOps = {},
): { target: CmuxTarget; trace: IdentityTrace } {
  const assessed = assessCodexAppWrite(agent, ops);
  const target: CmuxTarget = {
    kind: "codex-app",
    threadId: assessed.threadId || undefined,
    appServerReady: assessed.ready,
    ...(assessed.ready || !assessed.miss ? {} : { appServerMiss: assessed.miss }),
    resolution: assessed.ready ? "app-server" : "missing",
    reason: assessed.reason,
  };
  const step: IdentityTraceStep = {
    tier: "app-server",
    outcome: assessed.ready ? "matched" : "no-match",
    detail: assessed.reason,
  };
  return {
    target,
    trace: {
      steps: [step],
      matchedTier: assessed.ready ? "app-server" : undefined,
      resolution: target.resolution,
      reason: target.reason,
    },
  };
}

export function lastKnownCodexAppTarget(agent: CollectedAgent, reason: string): CmuxTarget {
  return {
    kind: "codex-app",
    threadId: codexAppThreadId(agent) || undefined,
    appServerReady: false,
    resolution: "missing",
    reason,
  };
}

export function resolveChatGptConsumerTarget(): { target: CmuxTarget; trace: IdentityTrace } {
  const target: CmuxTarget = {
    kind: "chatgpt",
    resolution: "missing",
    reason: CHATGPT_CONSUMER_COPY.cause,
  };
  const step: IdentityTraceStep = {
    tier: "session",
    outcome: "rejected",
    detail: `${CHATGPT_CONSUMER_COPY.cause} ${CHATGPT_CONSUMER_COPY.remedy}`,
  };
  return {
    target,
    trace: {
      steps: [step],
      resolution: target.resolution,
      reason: target.reason,
    },
  };
}

export function lastKnownChatGptTarget(reason: string): CmuxTarget {
  return { kind: "chatgpt", resolution: "missing", reason };
}

export function codexAppCopy(miss: CodexAppMiss = "unreachable"): { cause: string; remedy: string } {
  return CODEX_APP_COPY[miss];
}

export async function declineCodexAppApprovals(
  approvals: readonly CodexAppApprovalRequest[] | undefined,
  ops: CodexAppOps,
): Promise<void> {
  if (!approvals?.length) return;
  const answer = ops.answerApproval;
  if (!answer) return;
  for (const approval of approvals) {
    const method = approval.method;
    if (!method.includes("requestApproval")) continue;
    await answer({ id: approval.id, method, decision: "decline" });
  }
}

/* Official app-server JSON-RPC: no jsonrpc header, one object per line.
   https://learn.chatgpt.com/docs/app-server */

export function encodeJsonRpcRequest(
  id: number,
  method: string,
  params: Record<string, unknown> = {},
): string {
  return JSON.stringify({ method, id, params });
}

export function encodeJsonRpcNotification(method: string, params: Record<string, unknown> = {}): string {
  return JSON.stringify({ method, params });
}

export function encodeJsonRpcResult(id: number, result: unknown): string {
  return JSON.stringify({ id, result });
}

export function parseJsonRpcLine(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

export function isApprovalRequest(message: Record<string, unknown>): boolean {
  return typeof message.method === "string"
    && message.method.includes("requestApproval")
    && typeof message.id === "number";
}

export function threadStatusFromResume(result: unknown): { status?: string; turnId?: string } {
  if (!result || typeof result !== "object") return {};
  const row = result as Record<string, unknown>;
  const thread = row.thread && typeof row.thread === "object"
    ? row.thread as Record<string, unknown>
    : row;
  const status = typeof thread.status === "string"
    ? thread.status
    : typeof row.status === "string"
      ? row.status
      : undefined;
  const turn = row.turn && typeof row.turn === "object" ? row.turn as Record<string, unknown> : undefined;
  const turnId = typeof row.turnId === "string"
    ? row.turnId
    : typeof turn?.id === "string"
      ? turn.id
      : undefined;
  return { status, turnId };
}

export function createCodexAppSession(
  transport: {
    write(line: string): void;
    read(): AsyncGenerator<string>;
    close(): void;
  },
): CodexAppOps & { close(): void } {
  let nextId = 1;
  const pending = new Map<number, {
    resolve: (value: CodexAppRpcResult) => void;
    approvals: CodexAppApprovalRequest[];
  }>();
  let reading: Promise<void> | undefined;
  const pump = async (): Promise<void> => {
    for await (const line of transport.read()) {
      const message = parseJsonRpcLine(line);
      if (!message) continue;
      if (isApprovalRequest(message)) {
        const approval = {
          method: String(message.method),
          id: Number(message.id),
          params: (message.params && typeof message.params === "object"
            ? message.params as Record<string, unknown>
            : {}),
        };
        transport.write(encodeJsonRpcResult(approval.id, { decision: "decline" }));
        for (const waiter of pending.values()) waiter.approvals.push(approval);
        continue;
      }
      if (typeof message.id !== "number") continue;
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      if (message.error) {
        const error = message.error && typeof message.error === "object"
          ? (message.error as { message?: string }).message
          : String(message.error);
        waiter.resolve({ ok: false, error: error ?? "Codex app-server returned an error.", approvals: waiter.approvals });
        continue;
      }
      const extra = threadStatusFromResume(message.result);
      waiter.resolve({ ok: true, ...extra, approvals: waiter.approvals });
    }
  };
  reading = pump().catch(() => undefined);
  return {
    rpc: async (method, params) => {
      const id = nextId++;
      return new Promise<CodexAppRpcResult>((resolve) => {
        pending.set(id, { resolve, approvals: [] });
        transport.write(encodeJsonRpcRequest(id, method, params));
        if (method === "initialize") {
          transport.write(encodeJsonRpcNotification("initialized"));
        }
      });
    },
    answerApproval: async (request) => {
      transport.write(encodeJsonRpcResult(request.id, { decision: request.decision }));
      return { ok: true };
    },
    close: () => {
      for (const waiter of pending.values()) {
        waiter.resolve({ ok: false, error: "Codex app-server connection closed." });
      }
      pending.clear();
      transport.close();
      void reading;
    },
  };
}

export function spawnCodexAppServerTransport(
  options: { home?: string; command?: string } = {},
): { write(line: string): void; read(): AsyncGenerator<string>; close(): void } {
  const home = options.home ?? defaultCodexHome();
  const command = options.command ?? "codex";
  const socket = defaultControlSocketPath(home);
  const args = existsSync(socket) ? ["app-server", "proxy"] : ["app-server"];
  const child = spawn(command, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, CODEX_HOME: home },
  });
  const lines = createInterface({ input: child.stdout });
  return {
    write(line: string) {
      child.stdin.write(`${line}\n`);
    },
    async *read() {
      for await (const line of lines) {
        if (line.trim()) yield line;
      }
    },
    close() {
      lines.close();
      child.kill();
    },
  };
}

export function createProductionCodexAppOps(): CodexAppOps & { close(): void } {
  return createCodexAppSession(spawnCodexAppServerTransport());
}
