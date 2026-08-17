import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir as osHomedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { AgentSnapshot, ControlRequest, HubSnapshot } from "../shared/types";
import {
  ORCH_AGENT_CAP,
  ORCH_PEEK_CAP,
  ORCH_TOKEN_FILE,
  clipOrchProse,
  isLoopbackOrigin,
  isOrchLaunchCommand,
  type OrchAgent,
  type OrchFleetResult,
  type OrchLaunchCommand,
  type OrchPeekCard,
  type OrchPeekResult,
  type OrchWorkspace,
} from "../shared/orch";
import { executeControl, type ControlDependencies, type ControlExecution } from "./control";
import { DEFAULT_CMUX_EXECUTABLE } from "./cmux";
import { MAX_CONTROL_BODY_BYTES, MAX_CONTROL_SNAPSHOT_AGE_MS, MAX_INSTRUCTION_BYTES } from "./http";
import { canWriteToTarget } from "./targets";
import type { ArchiveStore, CommandRunner } from "./types";

export interface OrchDependencies {
  getSnapshot(): HubSnapshot;
  runner: CommandRunner;
  archiveStore: ArchiveStore;
  projectRoot: string;
  cmuxExecutable?: string;
  homedir?: string;
  now?: () => number;
  token?: string;
  executeControl?: (
    request: ControlRequest,
    agent: AgentSnapshot,
    dependencies: ControlDependencies,
  ) => Promise<ControlExecution>;
  afterSend?: (agentId: string) => void | Promise<void>;
}

const launchNonces = new Map<string, { workspaceRef: string; title: string; cwd: string }>();

function json(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

function fail(status: number, code: string, message: string): Response {
  return json({ ok: false, error: { code, message } }, status);
}

export function orchTokenPath(projectRoot: string): string {
  return join(projectRoot, ORCH_TOKEN_FILE);
}

export function readFormicOrchToken(projectRoot: string): string | undefined {
  const path = orchTokenPath(projectRoot);
  try {
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = /^(?:export\s+)?FORMIC_ORCH_TOKEN\s*=\s*(.*)$/.exec(line.trim());
      if (!match) continue;
      let value = match[1] ?? "";
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      value = value.trim();
      if (value) return value;
    }
    return undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function ensureFormicOrchToken(projectRoot: string): string {
  const existing = readFormicOrchToken(projectRoot);
  if (existing) return existing;
  const path = orchTokenPath(projectRoot);
  if (existsSync(path)) {
    throw new Error("The orch token file is present but empty or malformed.");
  }
  mkdirSync(dirname(path), { recursive: true });
  const token = randomBytes(32).toString("hex");
  writeFileSync(path, `FORMIC_ORCH_TOKEN=${token}\n`, { encoding: "utf8", mode: 0o600 });
  return token;
}

function requestToken(request: Request): string | undefined {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}

function authorize(request: Request, deps: OrchDependencies): Response | string {
  const url = new URL(request.url);
  if (!isLoopbackOrigin(`${url.protocol}//${url.host}`)) {
    return fail(403, "ORIGIN_REJECTED", "Orch requests must target loopback.");
  }
  let expected: string;
  try {
    expected = deps.token ?? readFormicOrchToken(deps.projectRoot) ?? "";
  } catch {
    return fail(500, "ORCH_TOKEN_UNREADABLE", "The orch token file could not be read.");
  }
  if (!expected) {
    return fail(500, "ORCH_TOKEN_UNREADABLE", "The orch token file is missing or empty.");
  }
  const got = requestToken(request);
  if (!got || got !== expected) {
    return fail(401, "UNAUTHORIZED", "Orch requests require a valid Bearer token.");
  }
  return expected;
}

function isBoardRow(agent: AgentSnapshot): boolean {
  if (agent.scope === "retained") return false;
  if (agent.lifecycle === "finished") return false;
  if (agent.status === "archived") return false;
  return true;
}

function workspaceRefOf(agent: AgentSnapshot): string | null {
  const id = agent.target.workspaceId?.trim();
  if (!id) return null;
  return id.startsWith("workspace:") ? id : id;
}

export function buildOrchFleet(snapshot: HubSnapshot): OrchFleetResult {
  const workspaces = new Map<string, OrchWorkspace>();
  const agents: OrchAgent[] = [];
  let truncated = false;
  for (const program of snapshot.programs) {
    for (const agent of program.agents) {
      if (!isBoardRow(agent)) continue;
      const ref = workspaceRefOf(agent);
      if (ref && !workspaces.has(ref)) {
        workspaces.set(ref, {
          ref,
          ...(agent.target.workspaceId && !agent.target.workspaceId.startsWith("workspace:")
            ? { id: agent.target.workspaceId }
            : {}),
          title: agent.target.workspaceTitle?.trim() || program.name,
        });
      }
      if (agents.length >= ORCH_AGENT_CAP) {
        truncated = true;
        continue;
      }
      agents.push({
        id: agent.id,
        name: agent.displayName,
        kind: agent.target.kind ?? "cmux",
        program: program.name,
        ready: canWriteToTarget(agent.target),
        miss: agent.target.gatewayMiss ?? null,
        workspaceRef: ref,
      });
    }
  }
  return {
    ok: true,
    generatedAt: snapshot.generatedAt,
    workspaces: [...workspaces.values()],
    agents,
    ...(truncated ? { truncated: true } : {}),
  };
}

export async function handleOrchFleet(request: Request, deps: OrchDependencies): Promise<Response> {
  if (request.method !== "GET") return fail(405, "METHOD_NOT_ALLOWED", "Use GET for fleet.");
  const auth = authorize(request, deps);
  if (auth instanceof Response) return auth;
  return json(buildOrchFleet(deps.getSnapshot()), 200);
}

function fileLabel(pathOrLabel: string): string {
  const trimmed = pathOrLabel.trim();
  if (!trimmed) return "";
  const base = basename(trimmed);
  return base || trimmed;
}

export function buildOrchPeekCard(agent: AgentSnapshot, program: string): OrchPeekCard {
  const ref = workspaceRefOf(agent);
  const title = agent.target.workspaceTitle?.trim() || program;
  const files: string[] = [];
  for (const artifact of agent.artifacts) {
    if (artifact.kind === "transcript") continue;
    const label = fileLabel(artifact.path || artifact.label);
    if (!label || files.includes(label)) continue;
    files.push(label);
    if (files.length >= 5) break;
  }
  const attention = agent.attentionSignal
    ? {
      kind: agent.attentionSignal.kind,
      ...(agent.attentionSignal.evidence ? { evidence: clipOrchProse(agent.attentionSignal.evidence) ?? undefined } : {}),
      ...(agent.attentionClass ? { class: agent.attentionClass } : {}),
    }
    : null;
  return {
    id: agent.id,
    name: agent.displayName,
    kind: agent.target.kind ?? "cmux",
    program,
    ready: canWriteToTarget(agent.target),
    miss: agent.target.gatewayMiss ?? null,
    workspaceRef: ref,
    workspaceTitle: title,
    status: agent.status,
    statusReason: agent.statusReason,
    ...(agent.lifecycle ? { lifecycle: agent.lifecycle } : {}),
    goal: clipOrchProse(agent.lastUserMessage ?? agent.lastHumanMessage ?? agent.task),
    lastReply: clipOrchProse(agent.lastAgentClosing ?? agent.lastAgentMessage),
    attention,
    ...(agent.nextAction ? { nextAction: clipOrchProse(agent.nextAction) ?? undefined } : {}),
    ...(typeof agent.contextPct === "number" ? { contextPct: agent.contextPct } : {}),
    ...(agent.cwd?.trim() ? { cwd: agent.cwd.trim() } : {}),
    ...(agent.repo?.repoName ? { repo: agent.repo.repoName } : {}),
    ...((agent.git?.branch ?? agent.repo?.branch) ? { branch: agent.git?.branch ?? agent.repo?.branch } : {}),
    ...(typeof agent.git?.dirty === "boolean" ? { dirty: agent.git.dirty } : {}),
    ...(agent.tests ? { tests: { state: agent.tests.state, ...(agent.tests.summary ? { summary: agent.tests.summary } : {}) } } : {}),
    ...(files.length > 0 ? { files } : {}),
    ...(agent.workingSince ? { workingSince: agent.workingSince } : {}),
    ...(agent.lastThreadAt ? { lastThreadAt: agent.lastThreadAt } : {}),
    ...(agent.processState ? { processState: agent.processState } : {}),
    ...(agent.model ? { model: agent.model } : {}),
  };
}

export function buildOrchPeek(snapshot: HubSnapshot, agentId?: string): OrchPeekResult | { error: { status: number; code: string; message: string } } {
  const rows: Array<{ agent: AgentSnapshot; program: string }> = [];
  for (const program of snapshot.programs) {
    for (const agent of program.agents) {
      if (!isBoardRow(agent)) continue;
      rows.push({ agent, program: program.name });
    }
  }
  if (agentId) {
    const match = rows.find((row) => row.agent.id === agentId);
    if (!match) {
      return { error: { status: 404, code: "AGENT_NOT_FOUND", message: "The agent is not present on the live board." } };
    }
    return { ok: true, generatedAt: snapshot.generatedAt, cards: [buildOrchPeekCard(match.agent, match.program)] };
  }
  const truncated = rows.length > ORCH_PEEK_CAP;
  const cards = rows.slice(0, ORCH_PEEK_CAP).map((row) => buildOrchPeekCard(row.agent, row.program));
  return {
    ok: true,
    generatedAt: snapshot.generatedAt,
    cards,
    ...(truncated ? { truncated: true } : {}),
  };
}

export async function handleOrchPeek(request: Request, deps: OrchDependencies): Promise<Response> {
  if (request.method !== "GET") return fail(405, "METHOD_NOT_ALLOWED", "Use GET for peek.");
  const auth = authorize(request, deps);
  if (auth instanceof Response) return auth;
  const agentId = new URL(request.url).searchParams.get("agentId");
  if (agentId !== null && !agentId.trim()) {
    return fail(400, "INVALID_CONTROL_REQUEST", "agentId must be a non-empty string when provided.");
  }
  const result = buildOrchPeek(deps.getSnapshot(), agentId?.trim());
  if ("error" in result) return fail(result.error.status, result.error.code, result.error.message);
  return json(result, 200);
}

async function readJsonBody(request: Request): Promise<{ value?: unknown; error?: Response }> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    return { error: fail(415, "CONTENT_TYPE_REJECTED", "Orch requests require application/json.") };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_CONTROL_BODY_BYTES) {
    return { error: fail(413, "BODY_TOO_LARGE", `Orch body exceeds ${MAX_CONTROL_BODY_BYTES} bytes.`) };
  }
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: fail(400, "INVALID_JSON", "Orch body is not valid JSON.") };
  }
}

export async function handleOrchSend(request: Request, deps: OrchDependencies): Promise<Response> {
  if (request.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED", "Use POST for send.");
  const auth = authorize(request, deps);
  if (auth instanceof Response) return auth;
  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const record = body.value && typeof body.value === "object" && !Array.isArray(body.value)
    ? body.value as Record<string, unknown>
    : null;
  if (!record) return fail(400, "INVALID_CONTROL_REQUEST", "Body must be a JSON object.");
  const keys = Object.keys(record);
  if (keys.some((key) => !["agentId", "instruction", "clientNonce"].includes(key))) {
    return fail(400, "INVALID_CONTROL_REQUEST", "Body contains an unsupported field.");
  }
  const agentId = typeof record.agentId === "string" ? record.agentId.trim() : "";
  if (!agentId || agentId.length > 300) {
    return fail(400, "INVALID_CONTROL_REQUEST", "agentId must be a non-empty string no longer than 300 characters.");
  }
  const instruction = typeof record.instruction === "string" ? record.instruction : "";
  if (!instruction.trim()) return fail(400, "INSTRUCTION_REQUIRED", "A non-empty instruction is required.");
  if (new TextEncoder().encode(instruction).byteLength > MAX_INSTRUCTION_BYTES) {
    return fail(400, "INVALID_INSTRUCTION", `instruction exceeds ${MAX_INSTRUCTION_BYTES} bytes.`);
  }
  if (/[\r\n]/.test(instruction)) {
    return fail(400, "INVALID_INSTRUCTION", "Instruction must not contain carriage returns or newlines.");
  }
  const clientNonce = typeof record.clientNonce === "string" && record.clientNonce.trim()
    ? record.clientNonce.trim()
    : undefined;
  const snapshot = deps.getSnapshot();
  const generatedAt = Date.parse(snapshot.generatedAt);
  const ageMs = (deps.now?.() ?? Date.now()) - generatedAt;
  if (!Number.isFinite(generatedAt) || ageMs > MAX_CONTROL_SNAPSHOT_AGE_MS) {
    return json({
      ok: false,
      error: {
        code: "STALE_SNAPSHOT",
        message: Number.isFinite(generatedAt)
          ? `Control routing evidence is ${Math.max(0, ageMs)}ms old; recollect before retrying.`
          : "Control routing evidence has an invalid timestamp; recollect before retrying.",
      },
    }, 409);
  }
  const agent = snapshot.programs.flatMap((program) => program.agents).find((row) => row.id === agentId);
  if (!agent) return fail(404, "AGENT_NOT_FOUND", "The agent is not present in the current snapshot.");
  const controlRequest: ControlRequest = {
    action: "instruct",
    agentId,
    instruction,
    ...(clientNonce ? { clientNonce } : {}),
  };
  const run = deps.executeControl ?? executeControl;
  const execution = await run(controlRequest, agent, {
    runner: deps.runner,
    archiveStore: deps.archiveStore,
    cmuxExecutable: deps.cmuxExecutable,
  });
  if (execution.response.ok) await deps.afterSend?.(agent.id);
  return json(execution.response, execution.status);
}

export function isAllowedLaunchCwd(cwd: string, home: string): boolean {
  if (!cwd || !home) return false;
  let resolved: string;
  let homeResolved: string;
  try {
    resolved = resolve(cwd);
    homeResolved = resolve(home);
  } catch {
    return false;
  }
  if (resolved === "/" || resolved === sep) return false;
  const prefix = homeResolved.endsWith(sep) ? homeResolved : `${homeResolved}${sep}`;
  if (resolved !== homeResolved && !resolved.startsWith(prefix)) return false;
  try {
    return statSync(resolved).isDirectory();
  } catch {
    return false;
  }
}

function parseWorkspaceRef(stdout: string): string | undefined {
  const ref = /\bworkspace:\d+\b/.exec(stdout);
  if (ref) return ref[0];
  const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.exec(stdout);
  return uuid?.[0];
}

export async function handleOrchLaunch(request: Request, deps: OrchDependencies): Promise<Response> {
  if (request.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED", "Use POST for launch.");
  const auth = authorize(request, deps);
  if (auth instanceof Response) return auth;
  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const record = body.value && typeof body.value === "object" && !Array.isArray(body.value)
    ? body.value as Record<string, unknown>
    : null;
  if (!record) return fail(400, "INVALID_CONTROL_REQUEST", "Body must be a JSON object.");
  const keys = Object.keys(record);
  if (keys.some((key) => !["cwd", "command", "title", "clientNonce"].includes(key))) {
    return fail(400, "INVALID_CONTROL_REQUEST", "Body contains an unsupported field.");
  }
  const cwd = typeof record.cwd === "string" ? record.cwd.trim() : "";
  const command = typeof record.command === "string" ? record.command.trim() : "";
  const title = typeof record.title === "string" && record.title.trim()
    ? record.title.trim()
    : `FORMIC · ${command || "agent"}`;
  const clientNonce = typeof record.clientNonce === "string" ? record.clientNonce.trim() : "";
  if (!isOrchLaunchCommand(command)) {
    return fail(400, "INVALID_LAUNCH", "command must be codex, claude, or grok.");
  }
  const home = deps.homedir ?? osHomedir();
  if (!isAllowedLaunchCwd(cwd, home)) {
    return fail(400, "INVALID_LAUNCH", "cwd must be an existing directory under the operator home.");
  }
  if (clientNonce && launchNonces.has(clientNonce)) {
    const prior = launchNonces.get(clientNonce)!;
    return json({ ok: true, ...prior }, 200);
  }
  const executable = deps.cmuxExecutable ?? DEFAULT_CMUX_EXECUTABLE;
  const argv = [
    executable,
    "new-workspace",
    "--cwd",
    resolve(cwd),
    "--name",
    title,
    "--command",
    command,
    "--no-focus",
  ];
  const result = await deps.runner.run(argv, 15_000);
  if (result.timedOut) return fail(504, "LAUNCH_TIMEOUT", "cmux new-workspace timed out.");
  if (result.exitCode !== 0) {
    return fail(502, "LAUNCH_FAILED", "cmux new-workspace did not succeed.");
  }
  const workspaceRef = parseWorkspaceRef(`${result.stdout}\n${result.stderr}`);
  if (!workspaceRef) {
    return fail(502, "LAUNCH_UNCONFIRMED", "cmux created a workspace but Formic could not parse its ref.");
  }
  const payload = { workspaceRef, title, cwd: resolve(cwd) };
  if (clientNonce) launchNonces.set(clientNonce, payload);
  return json({ ok: true, ...payload }, 200);
}

export function resetOrchLaunchNoncesForTests(): void {
  launchNonces.clear();
}

export { isOrchLaunchCommand };
export type { OrchLaunchCommand };
