import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  AGENT_ROLES,
  TASK_STATES,
  type AgentRole,
  type TaskState,
} from "../shared/types";
import type { CmuxWorkspaceEnvVariables } from "./types";

export interface RunManifestLane {
  laneId: string;
  role: AgentRole;
  provider?: string;
  sessionId?: string;
  worktree?: string;
  branch?: string;
  model?: string;
  brief?: string;
  status?: TaskState;
  statusAt?: string;
}

export interface RunManifest {
  runId: string;
  createdAt: string;
  repoRoot: string;
  orchestrator: { provider: string; sessionId: string };
  lanes: RunManifestLane[];
}

interface RunManifestHistoryEntry {
  at: string;
  op: "boot" | "done" | "backfill";
  laneId: string;
  provider?: string;
  sessionId: string;
  previousProvider?: string;
  previousSessionId?: string;
  succession?: boolean;
}

/* History is loader metadata, not a manifest field. Keeping it out of the
   object makes the unchanged JSON schema true to runtime consumers too. */
const HISTORY_BY_MANIFEST = new WeakMap<RunManifest, readonly RunManifestHistoryEntry[]>();

export interface DeclaredLineage {
  runId: string;
  laneId: string;
  role: AgentRole;
  parentAgentId?: string;
  succeededBy?: string;
  supersedes?: string;
  taskState?: TaskState;
  taskStateAt?: string;
}

const DECLARED_AGENT_ROLES = new Set<AgentRole>(AGENT_ROLES.filter((role) => role !== "service"));
const DECLARED_TASK_STATES = new Set<TaskState>(TASK_STATES);

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return nonEmpty(value) ?? null;
}

function parseLane(value: unknown): RunManifestLane | undefined {
  const lane = record(value);
  if (!lane) return undefined;
  const laneId = nonEmpty(lane.laneId);
  const role = nonEmpty(lane.role) as AgentRole | undefined;
  const provider = optionalString(lane.provider);
  const sessionId = optionalString(lane.sessionId);
  const worktree = optionalString(lane.worktree);
  const branch = optionalString(lane.branch);
  const model = optionalString(lane.model);
  const brief = optionalString(lane.brief);
  const statusValue = optionalString(lane.status);
  const status = statusValue as TaskState | undefined | null;
  const statusAt = optionalString(lane.statusAt);
  if (
    !laneId
    || !role
    || !DECLARED_AGENT_ROLES.has(role)
    || provider === null
    || sessionId === null
    || worktree === null
    || branch === null
    || model === null
    || brief === null
    || status === null
    || statusAt === null
    || (status !== undefined && !DECLARED_TASK_STATES.has(status))
    || Boolean(status) !== Boolean(statusAt)
    || (statusAt !== undefined && !Number.isFinite(Date.parse(statusAt)))
  ) return undefined;
  return {
    laneId,
    role,
    ...(provider ? { provider } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(worktree ? { worktree } : {}),
    ...(branch ? { branch } : {}),
    ...(model ? { model } : {}),
    ...(brief ? { brief } : {}),
    ...(status && statusAt ? { status, statusAt } : {}),
  };
}

function parseManifest(value: unknown): RunManifest | undefined {
  const manifest = record(value);
  const orchestrator = record(manifest?.orchestrator);
  const runId = nonEmpty(manifest?.runId);
  const createdAt = nonEmpty(manifest?.createdAt);
  const repoRoot = nonEmpty(manifest?.repoRoot);
  const provider = nonEmpty(orchestrator?.provider);
  const sessionId = nonEmpty(orchestrator?.sessionId);
  if (
    !manifest
    || !runId
    || !createdAt
    || !Number.isFinite(Date.parse(createdAt))
    || !repoRoot
    || !provider
    || !sessionId
    || !Array.isArray(manifest.lanes)
  ) return undefined;
  const lanes = manifest.lanes.map(parseLane);
  if (lanes.some((lane) => !lane)) return undefined;
  return {
    runId,
    createdAt,
    repoRoot,
    orchestrator: { provider, sessionId },
    lanes: lanes as RunManifestLane[],
  };
}

function parseHistoryEntry(value: unknown): RunManifestHistoryEntry | undefined {
  const entry = record(value);
  const at = nonEmpty(entry?.at);
  const op = nonEmpty(entry?.op) as RunManifestHistoryEntry["op"] | undefined;
  const laneId = nonEmpty(entry?.laneId);
  const provider = optionalString(entry?.provider);
  const sessionId = nonEmpty(entry?.sessionId);
  const previousSessionId = optionalString(entry?.previousSessionId);
  const previousProvider = entry?.previousProvider === null
    ? undefined
    : optionalString(entry?.previousProvider);
  const succession = entry?.succession;
  if (
    !at
    || !Number.isFinite(Date.parse(at))
    || !op
    || !["boot", "done", "backfill"].includes(op)
    || !laneId
    || provider === null
    || !sessionId
    || previousSessionId === null
    || previousProvider === null
    || (succession !== undefined && typeof succession !== "boolean")
  ) return undefined;
  return {
    at,
    op,
    laneId,
    ...(provider ? { provider } : {}),
    sessionId,
    ...(previousProvider ? { previousProvider } : {}),
    ...(previousSessionId ? { previousSessionId } : {}),
    ...(typeof succession === "boolean" ? { succession } : {}),
  };
}

function historyAt(path: string): RunManifestHistoryEntry[] {
  try {
    /* An append log may end with one torn or malformed line. Keep every entry
       that can defend itself instead of discarding the whole lane history. */
    return readFileSync(path, "utf8").split("\n").flatMap((line) => {
      if (!line.trim()) return [];
      try {
        const entry = parseHistoryEntry(JSON.parse(line));
        return entry ? [entry] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function manifestFiles(root: string): string[] {
  try {
    if (statSync(root).isFile()) return root.endsWith(".json") ? [root] : [];
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
      if (entry.isFile() && entry.name.endsWith(".json")) return [join(root, entry.name)];
      if (!entry.isDirectory()) return [];
      const nested = join(root, entry.name, "manifest.json");
      return existsSync(nested) ? [nested] : [];
    });
  } catch {
    return [];
  }
}

function manifestsAt(roots: readonly string[]): RunManifest[] {
  return roots.flatMap((root) => manifestFiles(root).flatMap((path) => {
    try {
      const manifest = parseManifest(JSON.parse(readFileSync(path, "utf8")));
      if (!manifest) return [];
      const historyRoot = statSync(root).isFile() ? dirname(root) : root;
      const history = manifest.runId === basename(manifest.runId)
        ? historyAt(join(historyRoot, `${manifest.runId}.history.jsonl`))
        : [];
      if (history.length) HISTORY_BY_MANIFEST.set(manifest, history);
      return [manifest];
    } catch {
      return [];
    }
  }));
}

function newestByRunId(manifests: readonly RunManifest[]): RunManifest[] {
  const sorted = [...manifests].sort((left, right) =>
    Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const newest = new Map<string, RunManifest>();
  for (const manifest of sorted) {
    if (!newest.has(manifest.runId)) newest.set(manifest.runId, manifest);
  }
  return [...newest.values()];
}

export function readRunManifests(roots?: string[]): RunManifest[] {
  const primary = manifestsAt(roots ?? [join(homedir(), ".anthill", "runs")]);
  if (roots) return newestByRunId(primary);
  const repoRoots = [...new Set(primary.map((manifest) => manifest.repoRoot))];
  const repositoryManifests = manifestsAt(repoRoots.map((root) => join(root, ".agent", "runs")));
  const selected = newestByRunId([...primary, ...repositoryManifests]);
  const primaryHistory = new Map(
    newestByRunId(primary).flatMap((manifest) => {
      const history = HISTORY_BY_MANIFEST.get(manifest);
      return history ? [[manifest.runId, history] as const] : [];
    }),
  );
  for (const manifest of selected) {
    const history = primaryHistory.get(manifest.runId);
    if (!HISTORY_BY_MANIFEST.has(manifest) && history) {
      HISTORY_BY_MANIFEST.set(manifest, history);
    }
  }
  return selected;
}

function sessionMatches(agentId: string, provider: string | undefined, sessionId: string): boolean {
  if (provider) return agentId === `${provider}:${sessionId}`;
  return agentId.slice(agentId.indexOf(":") + 1) === sessionId;
}

interface SessionBinding {
  provider?: string;
  sessionId: string;
}

function compatibleBinding(left: SessionBinding, right: SessionBinding): boolean {
  return left.sessionId === right.sessionId
    && (!left.provider || !right.provider || left.provider === right.provider);
}

function laneBindings(manifest: RunManifest, lane: RunManifestLane): SessionBinding[] {
  const bindings: SessionBinding[] = [];
  const append = (binding: SessionBinding): void => {
    const previous = bindings.at(-1);
    if (!previous || !compatibleBinding(previous, binding)) {
      bindings.push(binding);
      return;
    }
    if (!previous.provider && binding.provider) bindings[bindings.length - 1] = binding;
  };
  for (const entry of HISTORY_BY_MANIFEST.get(manifest) ?? []) {
    if (entry.laneId !== lane.laneId) continue;
    if (entry.succession && entry.previousSessionId) {
      append({
        ...(entry.previousProvider ? { provider: entry.previousProvider } : {}),
        sessionId: entry.previousSessionId,
      });
    }
    append({ ...(entry.provider ? { provider: entry.provider } : {}), sessionId: entry.sessionId });
  }
  if (lane.sessionId) {
    append({ ...(lane.provider ? { provider: lane.provider } : {}), sessionId: lane.sessionId });
  }
  return bindings;
}

function bindingAgentId(binding: SessionBinding | undefined): string | undefined {
  return binding?.provider ? `${binding.provider}:${binding.sessionId}` : undefined;
}

export function manifestFactsFor(
  agentId: string,
  manifests: readonly RunManifest[] = readRunManifests(),
): DeclaredLineage | undefined {
  const newest = [...manifests].sort((left, right) =>
    Date.parse(right.createdAt) - Date.parse(left.createdAt));
  for (const manifest of newest) {
    if (agentId === `${manifest.orchestrator.provider}:${manifest.orchestrator.sessionId}`) {
      return {
        runId: manifest.runId,
        laneId: manifest.runId,
        role: "orchestrator",
        parentAgentId: undefined,
      };
    }
    for (const lane of manifest.lanes) {
      const bindings = laneBindings(manifest, lane);
      const bindingIndex = bindings.findIndex((binding) =>
        sessionMatches(agentId, binding.provider, binding.sessionId));
      if (bindingIndex < 0) continue;
      const current = Boolean(
        lane.sessionId
        && sessionMatches(agentId, lane.provider, lane.sessionId),
      );
      return {
        runId: manifest.runId,
        laneId: lane.laneId,
        role: lane.role,
        parentAgentId: `${manifest.orchestrator.provider}:${manifest.orchestrator.sessionId}`,
        ...(bindingAgentId(bindings[bindingIndex + 1])
          ? { succeededBy: bindingAgentId(bindings[bindingIndex + 1]) }
          : {}),
        ...(bindingAgentId(bindings[bindingIndex - 1])
          ? { supersedes: bindingAgentId(bindings[bindingIndex - 1]) }
          : {}),
        ...(current && lane.status && lane.statusAt
          ? { taskState: lane.status, taskStateAt: lane.statusAt }
          : {}),
      };
    }
  }
  return undefined;
}

export function envFactsFor(variables: CmuxWorkspaceEnvVariables): DeclaredLineage | undefined {
  const runId = nonEmpty(variables.ANTHILL_RUN);
  const laneId = nonEmpty(variables.ANTHILL_LANE);
  const role = nonEmpty(variables.ANTHILL_ROLE) as AgentRole | undefined;
  const parentAgentId = nonEmpty(variables.ANTHILL_PARENT);
  if (
    !runId
    || !laneId
    || !role
    || !DECLARED_AGENT_ROLES.has(role)
    || !parentAgentId
    || !/^[^:\s]+:.+$/.test(parentAgentId)
  ) return undefined;
  return { runId, laneId, role, parentAgentId };
}
