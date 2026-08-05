import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AGENT_ROLES, type AgentRole } from "../shared/types";
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
}

export interface RunManifest {
  runId: string;
  createdAt: string;
  repoRoot: string;
  orchestrator: { provider: string; sessionId: string };
  lanes: RunManifestLane[];
}

export interface DeclaredLineage {
  runId: string;
  laneId: string;
  role: AgentRole;
  parentAgentId?: string;
}

const DECLARED_AGENT_ROLES = new Set<AgentRole>(AGENT_ROLES.filter((role) => role !== "service"));

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
      return manifest ? [manifest] : [];
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
  return newestByRunId([...primary, ...repositoryManifests]);
}

function sessionMatches(agentId: string, provider: string | undefined, sessionId: string): boolean {
  if (provider) return agentId === `${provider}:${sessionId}`;
  return agentId.slice(agentId.indexOf(":") + 1) === sessionId;
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
    const lane = manifest.lanes.find((candidate) =>
      candidate.sessionId
      && sessionMatches(agentId, candidate.provider, candidate.sessionId));
    if (lane) {
      return {
        runId: manifest.runId,
        laneId: lane.laneId,
        role: lane.role,
        parentAgentId: `${manifest.orchestrator.provider}:${manifest.orchestrator.sessionId}`,
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
