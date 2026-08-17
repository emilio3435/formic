import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type {
  CmuxTarget,
  ControlSurfaceKind,
  GrokBotGatewayMiss,
  IdentityTrace,
  IdentityTraceStep,
} from "../shared/types";
import {
  discoverProductionBoxAttach,
  ensureBoxGatewayAttach,
  resetGrokBotAttachForTests,
} from "./grok-bot-attach";
import { decodeBlobKey, parseRoster } from "./grok-bot";
import type { CollectedAgent } from "./types";

const GROK_BOT_ID_PREFIX = "grok:bot:";
const DEFAULT_GATEWAY_ORIGIN = "http://127.0.0.1:1340";
const GATEWAY_PROBE_MS = 1_500;
const GATEWAY_SEND_MS = 10_000;
const FORBIDDEN_GATEWAY_NAME = "gateway-descriptor.json";

/* Fixture-only relatives. Production does not treat the Mac replica cache
   as the token home — the plaintext record is on that instance's box. */
const GATEWAY_RELATIVE_PATHS = [
  "box/sand-data/gateway.json",
  "sand-data/gateway.json",
  "gateway.json",
  "sand-client-persistence/gateway.json",
] as const;

const BIND_WILDCARD_HOSTS = new Set(["0.0.0.0", "::", "*"]);

export interface GrokBotGatewayCredentials {
  token: string;
  url: string;
  sourcePath: string;
}

export interface GrokBotSendInput {
  url: string;
  token: string;
  agentId: string;
  prompt: string;
  clientNonce: string;
}

/* Per-instance Mac loopback that forwards to that Bot's box gateway.
   Formic-on-disk has no attested discoverer for this; tests inject one. */
export interface BoxGatewayAttach {
  instanceId: string;
  loopbackOrigin: string;
  readBoxGatewayJson(): string | undefined;
}

export interface GrokBotSendResult {
  ok: boolean;
  accepted?: boolean;
  error?: string;
}

/* Injectable bag for executeControl tests. Not a SurfaceAdapter — just the
   functions the grok-bot branch needs so a test never hits :1340. */
export interface GrokBotGatewayOps {
  attach?(instanceId: string): BoxGatewayAttach | undefined;
  readGateway?(root: string): GrokBotGatewayCredentials | undefined;
  rosterHasAgent?(root: string, rosterId: string): boolean;
  /* Sync advertise/execute gate. Production uses the last snapshot-tick
     listAgents result; tests can pin it so they never open :1340. */
  probeOk?: boolean;
  probe?(creds: GrokBotGatewayCredentials): Promise<boolean>;
  sendPrompt?(input: GrokBotSendInput): Promise<GrokBotSendResult>;
}

const acceptedNonces = new Set<string>();
const nonceGates = new Map<string, Promise<unknown>>();
const probeCache = new Map<string, boolean>();
const tokenMemory = new Map<string, GrokBotGatewayCredentials>();
const missCache = new Map<string, GrokBotGatewayMiss>();
let probeOverride: GrokBotGatewayOps["probe"];
let attachOverride: GrokBotGatewayOps["attach"];

export function controlSurfaceKind(
  target?: { kind?: string } | null,
): ControlSurfaceKind {
  if (target?.kind === "grok-bot") return "grok-bot";
  if (target?.kind === "codex-app") return "codex-app";
  if (target?.kind === "claude-desktop") return "claude-desktop";
  if (target?.kind === "chatgpt") return "chatgpt";
  return "cmux";
}

export function isGrokBotTarget(target: Pick<CmuxTarget, "kind"> | undefined): boolean {
  return target?.kind === "grok-bot";
}

export function isGrokBotAgent(agent: {
  id?: string;
  provider?: string;
  sourceSessionId?: string;
  target?: Pick<CmuxTarget, "kind">;
}): boolean {
  if (agent.target?.kind === "grok-bot") return true;
  if (typeof agent.id === "string" && agent.id.startsWith(GROK_BOT_ID_PREFIX)) return true;
  return agent.provider === "grok"
    && typeof agent.sourceSessionId === "string"
    && agent.sourceSessionId.startsWith("bot:");
}

/* Roster UUID only. Never "strip grok:bot: and hope" — a collision-qualified
   row id is grok:bot:<instanceSlug>:<rosterId>. */
export function grokBotRosterId(agent: {
  id?: string;
  sourceSessionId?: string;
  target?: Pick<CmuxTarget, "agentId">;
}): string {
  const fromTarget = agent.target?.agentId?.trim();
  if (fromTarget) return fromTarget;
  const session = agent.sourceSessionId?.trim() ?? "";
  if (session.startsWith("bot:")) return session.slice("bot:".length);
  const id = agent.id?.trim() ?? "";
  if (!id.startsWith(GROK_BOT_ID_PREFIX)) return "";
  const rest = id.slice(GROK_BOT_ID_PREFIX.length);
  const lastColon = rest.lastIndexOf(":");
  return lastColon === -1 ? rest : rest.slice(lastColon + 1);
}

export function readGatewayForRoot(root: string): GrokBotGatewayCredentials | undefined {
  if (!root) return undefined;
  for (const relative of GATEWAY_RELATIVE_PATHS) {
    const path = join(root, relative);
    if (basename(path) === FORBIDDEN_GATEWAY_NAME) continue;
    const creds = parseGatewayFile(path);
    if (creds) return creds;
  }
  return undefined;
}

function parseGatewayFile(path: string): GrokBotGatewayCredentials | undefined {
  if (basename(path) === FORBIDDEN_GATEWAY_NAME) return undefined;
  if (!existsSync(path)) return undefined;
  try {
    return parseGatewayRecord(readFileSync(path, "utf8"), undefined, path);
  } catch {
    return undefined;
  }
}

export function parseGatewayRecord(
  raw: string | undefined,
  connectOrigin?: string,
  sourcePath = "memory",
): GrokBotGatewayCredentials | undefined {
  if (!raw || basename(sourcePath) === FORBIDDEN_GATEWAY_NAME) return undefined;
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const token = typeof data.token === "string" ? data.token.trim() : "";
    if (!token) return undefined;
    const url = connectOrigin && isLoopbackGatewayOrigin(connectOrigin)
      ? connectOrigin.replace(/\/+$/, "")
      : connectOriginFromGatewayRecord(data);
    if (!url) return undefined;
    return { token, url, sourcePath };
  } catch {
    return undefined;
  }
}

function normalizeGatewayHost(host: string): string {
  return host.trim().replace(/^\[|\]$/g, "").toLowerCase();
}

export function isLoopbackGatewayHost(host: string): boolean {
  const normalized = normalizeGatewayHost(host);
  return normalized === "127.0.0.1" || normalized === "::1";
}

export function isLoopbackGatewayOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && isLoopbackGatewayHost(parsed.hostname);
  } catch {
    return false;
  }
}

function bracketIpv6Host(host: string): string {
  const normalized = normalizeGatewayHost(host);
  return normalized === "::1" ? "[::1]" : normalized;
}

export function isBindOnlyGatewayHost(host: string): boolean {
  const normalized = normalizeGatewayHost(host);
  return BIND_WILDCARD_HOSTS.has(normalized) || !isLoopbackGatewayHost(host);
}

/* Official `host` is the bind. Wildcard / non-loopback bind → connect to the
   attach loopback on `port`. A connect-to `url` that is not loopback is still
   rejected so the Bearer never leaves the box. */
export function connectOriginFromGatewayRecord(
  data: Record<string, unknown>,
  loopbackHost = "127.0.0.1",
): string | undefined {
  if (typeof data.url === "string" && data.url.trim()) {
    const url = data.url.trim().replace(/\/+$/, "");
    return isLoopbackGatewayOrigin(url) ? url : undefined;
  }
  const port = typeof data.port === "number" && Number.isFinite(data.port) ? data.port : 1340;
  if (!isLoopbackGatewayHost(loopbackHost)) return undefined;
  if (typeof data.host === "string" && data.host.trim() && isLoopbackGatewayHost(data.host)) {
    return `http://${bracketIpv6Host(data.host)}:${port}`;
  }
  return `http://${bracketIpv6Host(loopbackHost)}:${port}`;
}

export function grokBotRosterHasAgent(root: string, rosterId: string): boolean {
  if (!root || !rosterId) return false;
  const persistence = join(root, "sand-client-persistence");
  let names: string[];
  try {
    names = readdirSync(persistence);
  } catch {
    return false;
  }
  for (const name of names) {
    if (!name.endsWith(".blob")) continue;
    const key = decodeBlobKey(name);
    if (!key?.endsWith(".roster.last-roster")) continue;
    try {
      const rows = parseRoster(rosterEnvelopeValue(readFileSync(join(persistence, name), "utf8")));
      if (rows.some((row) => row.id === rosterId && !row.isHiddenFromSidebar)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

function rosterEnvelopeValue(raw: string): unknown {
  const parsed = JSON.parse(raw) as { schemaVersion?: unknown; value?: unknown };
  if (parsed && typeof parsed === "object" && "schemaVersion" in parsed) return parsed.value;
  return parsed;
}

export async function probeGrokBotGateway(
  creds: GrokBotGatewayCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!isLoopbackGatewayOrigin(creds.url)) return false;
  try {
    const response = await fetchImpl(`${creds.url}/api/listAgents`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${creds.token}`,
        "content-type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(GATEWAY_PROBE_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function sendGrokBotPrompt(
  input: GrokBotSendInput,
  fetchImpl: typeof fetch = fetch,
): Promise<GrokBotSendResult> {
  if (!isLoopbackGatewayOrigin(input.url)) {
    return { ok: false, error: "Grok Bot gateway URL is not loopback." };
  }
  try {
    const response = await fetchImpl(`${input.url}/api/sendPrompt`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        agentId: input.agentId,
        prompt: input.prompt,
        clientNonce: input.clientNonce,
        directAddressedAcceptance: true,
      }),
      signal: AbortSignal.timeout(GATEWAY_SEND_MS),
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    const accepted = body && typeof body === "object" && "accepted" in body
      ? (body as { accepted?: boolean }).accepted
      : undefined;
    if (!response.ok || accepted === false) {
      const message = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Grok Bot gateway returned HTTP ${response.status}`;
      return { ok: false, accepted, error: message };
    }
    return { ok: true, accepted };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function nonceKey(instanceId: string, agentId: string, nonce: string): string {
  return `${instanceId}\0${agentId}\0${nonce}`;
}

export function wasNonceAccepted(instanceId: string, agentId: string, nonce: string): boolean {
  return acceptedNonces.has(nonceKey(instanceId, agentId, nonce));
}

export function rememberAcceptedNonce(instanceId: string, agentId: string, nonce: string): void {
  acceptedNonces.add(nonceKey(instanceId, agentId, nonce));
}

export async function withGrokBotNonceLock<T>(
  instanceId: string,
  agentId: string,
  nonce: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = nonceKey(instanceId, agentId, nonce);
  const previous = nonceGates.get(key) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = previous.then(() => held);
  nonceGates.set(key, chain);
  try {
    await previous;
    return await fn();
  } finally {
    release();
    if (nonceGates.get(key) === chain) nonceGates.delete(key);
  }
}

export function lastGrokBotProbeOk(instanceId: string): boolean {
  return Boolean(instanceId) && probeCache.get(instanceId) === true;
}

export function recordGrokBotProbeResult(instanceId: string, ok: boolean): void {
  if (instanceId) probeCache.set(instanceId, ok);
}

export function recordGrokBotGatewayMiss(instanceId: string, miss: GrokBotGatewayMiss): void {
  if (instanceId) missCache.set(instanceId, miss);
}

export function lastGrokBotGatewayMiss(instanceId: string): GrokBotGatewayMiss | undefined {
  return instanceId ? missCache.get(instanceId) : undefined;
}

export function rememberGrokBotGatewayCreds(
  instanceId: string,
  creds: GrokBotGatewayCredentials,
): void {
  if (instanceId) tokenMemory.set(instanceId, creds);
}

export function rememberedGrokBotGatewayCreds(
  instanceId: string,
): GrokBotGatewayCredentials | undefined {
  return instanceId ? tokenMemory.get(instanceId) : undefined;
}

export function setGrokBotProbeImplForTests(fn?: GrokBotGatewayOps["probe"]): void {
  probeOverride = fn;
}

export function setGrokBotAttachImplForTests(fn?: GrokBotGatewayOps["attach"]): void {
  attachOverride = fn;
}

/* Production attach is a per-instance loopback reverse-proxy in front of that
   Bot's local-exec connection (cursorvm :1340 or a loopback fixture). Tests
   may still inject attachOverride. The Mac replica cache is not the token home. */
export function discoverBoxGatewayAttach(instanceId: string): BoxGatewayAttach | undefined {
  if (!instanceId) return undefined;
  if (attachOverride) return attachOverride(instanceId);
  return discoverProductionBoxAttach(instanceId);
}

function resolveAttach(
  instanceId: string,
  ops: GrokBotGatewayOps,
): BoxGatewayAttach | undefined {
  const attach = ops.attach?.(instanceId) ?? discoverBoxGatewayAttach(instanceId);
  if (!attach) return undefined;
  return isLoopbackGatewayOrigin(attach.loopbackOrigin) ? attach : undefined;
}

function resolveGatewayCreds(
  instanceId: string,
  root: string,
  ops: GrokBotGatewayOps,
): { attachUp: boolean; creds?: GrokBotGatewayCredentials; miss?: GrokBotGatewayMiss } {
  const injected = ops.readGateway;
  if (injected) {
    const creds = root ? injected(root) : undefined;
    if (creds?.token) rememberGrokBotGatewayCreds(instanceId, creds);
    return { attachUp: true, creds, miss: creds?.token ? undefined : "no-token" };
  }
  const attach = resolveAttach(instanceId, ops);
  if (!attach) return { attachUp: false, miss: "unreachable-box" };
  let raw: string | undefined;
  try {
    raw = attach.readBoxGatewayJson();
  } catch {
    raw = undefined;
  }
  const creds = parseGatewayRecord(raw, attach.loopbackOrigin);
  if (creds?.token) rememberGrokBotGatewayCreds(instanceId, creds);
  else tokenMemory.delete(instanceId);
  return { attachUp: true, creds, miss: creds?.token ? undefined : "no-token" };
}

export async function refreshGrokBotGatewayProbe(
  instanceId: string,
  root: string,
  ops: GrokBotGatewayOps = {},
): Promise<boolean> {
  if (!instanceId) return false;
  if (!ops.attach && !attachOverride && !ops.readGateway && root) {
    await ensureBoxGatewayAttach(instanceId, root);
  }
  const resolved = resolveGatewayCreds(instanceId, root, ops);
  if (!resolved.attachUp) {
    recordGrokBotGatewayMiss(instanceId, "unreachable-box");
    recordGrokBotProbeResult(instanceId, false);
    return false;
  }
  if (!resolved.creds?.token) {
    recordGrokBotGatewayMiss(instanceId, "no-token");
    recordGrokBotProbeResult(instanceId, false);
    return false;
  }
  const probe = ops.probe ?? probeOverride ?? ((candidate: GrokBotGatewayCredentials) => probeGrokBotGateway(candidate));
  const ok = await probe(resolved.creds);
  recordGrokBotProbeResult(instanceId, ok);
  if (!ok) recordGrokBotGatewayMiss(instanceId, "probe-rejected");
  else missCache.delete(instanceId);
  return ok;
}

export function resetAcceptedNoncesForTests(): void {
  acceptedNonces.clear();
  nonceGates.clear();
  probeCache.clear();
  tokenMemory.clear();
  missCache.clear();
  probeOverride = undefined;
  attachOverride = undefined;
  resetGrokBotAttachForTests();
}

export const GROK_BOT_GATEWAY_COPY: Record<GrokBotGatewayMiss, { cause: string; remedy: string }> = {
  "no-token": {
    cause: "No gateway token is on this Grok Bot instance's box.",
    remedy: "The box is reachable, but its gateway record has no token Formic can use.",
  },
  "unreachable-box": {
    cause: "This Grok Bot instance's box is unreachable from this Mac.",
    remedy: "Formic has no attested local forward to that box's gateway.",
  },
  "probe-rejected": {
    cause: "This Grok Bot instance's gateway rejected the probe.",
    remedy: "The attach is up, but listAgents did not succeed. Send stays off until a later probe succeeds.",
  },
};

export function grokBotGatewayCopy(miss: GrokBotGatewayMiss): { cause: string; remedy: string } {
  return GROK_BOT_GATEWAY_COPY[miss];
}

export const MISSING_GATEWAY_CAUSE = GROK_BOT_GATEWAY_COPY["unreachable-box"].cause;
export const MISSING_GATEWAY_REMEDY = GROK_BOT_GATEWAY_COPY["unreachable-box"].remedy;
export const GROK_BOT_INTERRUPT_REASON = "Grok Bot has no stop RPC yet.";

export function assessGrokBotWrite(
  agent: {
    id?: string;
    sourceSessionId?: string;
    instanceId?: string;
    originCwd?: string;
    cwd?: string;
    target?: Pick<CmuxTarget, "agentId" | "instanceId" | "originCwd">;
  },
  ops: GrokBotGatewayOps = {},
): {
  ready: boolean;
  creds?: GrokBotGatewayCredentials;
  rosterId: string;
  reason: string;
  miss?: GrokBotGatewayMiss;
} {
  const rosterId = grokBotRosterId(agent);
  const instanceId = agent.target?.instanceId ?? agent.instanceId ?? "";
  const root = agent.target?.originCwd ?? agent.originCwd ?? agent.cwd ?? "";
  const rosterHasAgent = ops.rosterHasAgent ?? grokBotRosterHasAgent;
  if (!instanceId) {
    return { ready: false, rosterId, miss: "unreachable-box", reason: GROK_BOT_GATEWAY_COPY["unreachable-box"].cause };
  }
  if (!rosterId) {
    return { ready: false, rosterId, reason: "This Grok Bot row has no roster agent id." };
  }
  const resolved = resolveGatewayCreds(instanceId, root, ops);
  if (!resolved.attachUp) {
    return {
      ready: false,
      rosterId,
      miss: "unreachable-box",
      reason: GROK_BOT_GATEWAY_COPY["unreachable-box"].cause,
    };
  }
  if (!resolved.creds?.token) {
    return {
      ready: false,
      rosterId,
      miss: "no-token",
      reason: GROK_BOT_GATEWAY_COPY["no-token"].cause,
    };
  }
  if (!rosterHasAgent(root, rosterId)) {
    return {
      ready: false,
      creds: resolved.creds,
      rosterId,
      reason: "This agent is not in this Grok Bot instance's roster.",
    };
  }
  const probeOk = ops.probeOk ?? lastGrokBotProbeOk(instanceId);
  if (!probeOk) {
    return {
      ready: false,
      creds: resolved.creds,
      rosterId,
      miss: "probe-rejected",
      reason: GROK_BOT_GATEWAY_COPY["probe-rejected"].cause,
    };
  }
  return {
    ready: true,
    creds: resolved.creds,
    rosterId,
    reason: `Grok Bot gateway is linked for ${agent.target?.instanceId ?? instanceId}`,
  };
}

export function resolveGrokBotControlTarget(
  agent: CollectedAgent,
  ops: GrokBotGatewayOps = {},
): { target: CmuxTarget; trace: IdentityTrace } {
  const instanceId = agent.instanceId ?? "";
  const instanceLabel = agent.instanceLabel ?? "Grok Bot";
  const originCwd = agent.originCwd ?? agent.cwd;
  const assessed = assessGrokBotWrite({ ...agent, target: { instanceId, originCwd } }, ops);
  const ready = assessed.ready;
  const target: CmuxTarget = {
    kind: "grok-bot",
    agentId: assessed.rosterId || undefined,
    instanceId: instanceId || undefined,
    instanceLabel,
    originCwd,
    gatewayReady: ready,
    ...(ready || !assessed.miss ? {} : { gatewayMiss: assessed.miss }),
    resolution: ready ? "gateway" : "missing",
    reason: ready
      ? `Grok Bot gateway is linked for ${instanceLabel}`
      : assessed.reason,
  };
  const step: IdentityTraceStep = {
    tier: "gateway",
    outcome: ready ? "matched" : "no-match",
    detail: ready
      ? `Instance ${instanceId || instanceLabel} has a gateway token and roster id ${assessed.rosterId}.`
      : assessed.reason,
  };
  return {
    target,
    trace: {
      steps: [step],
      matchedTier: ready ? "gateway" : undefined,
      resolution: target.resolution,
      reason: target.reason,
    },
  };
}

export function lastKnownGrokBotTarget(agent: CollectedAgent, reason: string): CmuxTarget {
  return {
    kind: "grok-bot",
    agentId: grokBotRosterId(agent) || undefined,
    instanceId: agent.instanceId,
    instanceLabel: agent.instanceLabel,
    originCwd: agent.originCwd,
    gatewayReady: false,
    resolution: "missing",
    reason,
  };
}

export { DEFAULT_GATEWAY_ORIGIN };
