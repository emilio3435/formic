/* Operator group mutations. The only Formic writer of sidebar folders the
   operator made. TINT-G still must not mint repo groups; this module never
   records provenance. Create has no name field, so rename lands before we
   return — otherwise the next collect is still Group N and the board hides it.
   Delete is ungroup. Never group.delete, never the anchor, never a steal. */

import { normalizeHex } from "../shared/repo-color";
import { isOperatorTeam, type CmuxTeam } from "../shared/team-tint";
import { cmuxCommand, DEFAULT_CMUX_EXECUTABLE, executableMissing } from "./cmux";
import {
  parseCmuxGroups,
  parseCreatedGroup,
  type CmuxGroup,
} from "./cmux-groups";
import type { CommandRunner } from "./types";

const RPC_TIMEOUT_MS = 10_000;

export class TeamGroupError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TeamGroupError";
  }
}

export interface TeamGroupDependencies {
  runner: CommandRunner;
  executable?: string;
  provenanceIds: () => ReadonlySet<string>;
  setGroupColor?: (groupId: string, hex: string, reason: string) => Promise<boolean>;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

function requestError(status: number, code: string, message: string): Response {
  return json({ error: message, code }, status);
}

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringField(record: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function parseIdList(output: string, collection: "windows" | "workspaces"): string[] {
  const root = asRecord(JSON.parse(output));
  const items = (asRecord(root?.result) ?? root)?.[collection];
  if (!Array.isArray(items)) throw new Error(`cmux response did not contain a ${collection} array`);
  return items.flatMap((value) => {
    const id = stringField(asRecord(value), "id");
    return id ? [id] : [];
  });
}

async function rpc(
  deps: TeamGroupDependencies,
  method: string,
  params: Record<string, unknown>,
): Promise<string> {
  const executable = deps.executable ?? DEFAULT_CMUX_EXECUTABLE;
  const result = await deps.runner.run(
    cmuxCommand(executable, ["rpc", method, JSON.stringify(params)]),
    RPC_TIMEOUT_MS,
  );
  if (executableMissing(result)) {
    throw new TeamGroupError(502, "CMUX_FAILED", `cmux ${method} is unavailable: cmux is not installed`);
  }
  if (result.timedOut) {
    throw new TeamGroupError(502, "CMUX_FAILED", `cmux ${method} timed out`);
  }
  if (result.exitCode !== 0) {
    throw new TeamGroupError(
      502,
      "CMUX_FAILED",
      `cmux ${method} exited ${result.exitCode}: ${result.stderr.trim() || "no stderr"}`,
    );
  }
  return result.stdout;
}

function operatorName(name: unknown, groupId: string, provenanceIds: ReadonlySet<string>): string {
  if (typeof name !== "string") {
    throw new TeamGroupError(400, "INVALID_NAME", "name must be a non-empty operator team title, not Group N.");
  }
  const trimmed = name.trim();
  if (!isOperatorTeam(trimmed, groupId, provenanceIds)) {
    throw new TeamGroupError(400, "INVALID_NAME", "name must be a non-empty operator team title, not Group N.");
  }
  return trimmed;
}

function uniqueIds(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
  }
  return ids;
}

function homeGroup(groups: readonly CmuxGroup[], workspaceId: string): CmuxGroup | undefined {
  return groups.find((group) =>
    group.anchorWorkspaceId === workspaceId || group.memberWorkspaceIds.includes(workspaceId));
}

async function listWindows(deps: TeamGroupDependencies): Promise<string[]> {
  try {
    return parseIdList(await rpc(deps, "window.list", {}), "windows");
  } catch (error) {
    if (error instanceof TeamGroupError) throw error;
    throw new TeamGroupError(
      502,
      "CMUX_FAILED",
      `cmux window.list returned an unexpected shape: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function listWindowWorkspaces(deps: TeamGroupDependencies, windowId: string): Promise<Set<string>> {
  try {
    return new Set(parseIdList(await rpc(deps, "workspace.list", { window_id: windowId }), "workspaces"));
  } catch (error) {
    if (error instanceof TeamGroupError) throw error;
    throw new TeamGroupError(
      502,
      "CMUX_FAILED",
      `cmux workspace.list returned an unexpected shape: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function listWindowGroups(deps: TeamGroupDependencies, windowId: string): Promise<CmuxGroup[]> {
  try {
    return parseCmuxGroups(await rpc(deps, "workspace.group.list", { window_id: windowId }));
  } catch (error) {
    if (error instanceof TeamGroupError) throw error;
    throw new TeamGroupError(
      502,
      "CMUX_FAILED",
      `cmux workspace.group.list returned an unexpected shape: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function findLiveGroup(
  deps: TeamGroupDependencies,
  groupId: string,
): Promise<{ windowId: string; group: CmuxGroup }> {
  for (const windowId of await listWindows(deps)) {
    const group = (await listWindowGroups(deps, windowId)).find((entry) => entry.id === groupId);
    if (group) return { windowId, group };
  }
  throw new TeamGroupError(404, "NOT_FOUND", "That group is not a live operator team.");
}

function requireOperatorGroup(
  group: CmuxGroup,
  provenanceIds: ReadonlySet<string>,
): void {
  if (provenanceIds.has(group.id)) {
    throw new TeamGroupError(404, "NOT_FOUND", "That group is not a live operator team.");
  }
}

function requireNotAnchor(group: CmuxGroup, workspaceId: string, groups: readonly CmuxGroup[]): void {
  if (group.anchorWorkspaceId === workspaceId) {
    throw new TeamGroupError(400, "ANCHOR", "The group anchor cannot be removed.");
  }
  if (groups.some((entry) => entry.anchorWorkspaceId === workspaceId)) {
    throw new TeamGroupError(400, "ANCHOR", "A group anchor cannot be moved.");
  }
}

async function resolveWindowForWorkspaces(
  deps: TeamGroupDependencies,
  workspaceIds: readonly string[],
): Promise<string> {
  const matches: string[] = [];
  for (const windowId of await listWindows(deps)) {
    const inWindow = await listWindowWorkspaces(deps, windowId);
    if (workspaceIds.every((id) => inWindow.has(id))) matches.push(windowId);
  }
  if (matches.length !== 1) {
    throw new TeamGroupError(400, "MIXED_WINDOW", "Every workspace must already live in the same window.");
  }
  return matches[0] ?? "";
}

export async function createOperatorTeam(input: {
  windowId?: string;
  workspaceIds: string[];
  name: string;
  hex?: string;
}, deps: TeamGroupDependencies): Promise<{ team: CmuxTeam }> {
  const provenanceIds = deps.provenanceIds();
  const name = operatorName(input.name, "", provenanceIds);
  const requested = typeof input.windowId === "string" ? input.windowId.trim() : "";
  if (!Array.isArray(input.workspaceIds) || input.workspaceIds.some((id) => typeof id !== "string" || !id.trim())) {
    throw new TeamGroupError(400, "INVALID_BODY", "workspaceIds must be a list of workspace ids.");
  }
  const workspaceIds = uniqueIds(input.workspaceIds.map((id) => id.trim()));
  if (workspaceIds.length === 0) {
    throw new TeamGroupError(400, "INVALID_BODY", "workspaceIds must include at least one workspace.");
  }
  const windowId = requested || await resolveWindowForWorkspaces(deps, workspaceIds);
  const hex = input.hex === undefined ? undefined : normalizeHex(input.hex);
  if (input.hex !== undefined && !hex) {
    throw new TeamGroupError(400, "INVALID_HEX", "hex must be #RGB or #RRGGBB.");
  }

  const inWindow = await listWindowWorkspaces(deps, windowId);
  if (workspaceIds.some((id) => !inWindow.has(id))) {
    throw new TeamGroupError(400, "MIXED_WINDOW", "Every workspace must already live in the named window.");
  }
  const groups = await listWindowGroups(deps, windowId);
  const foreign = workspaceIds.find((id) => homeGroup(groups, id));
  if (foreign) {
    throw new TeamGroupError(409, "FOREIGN_GROUP", "A workspace already belongs to another group.");
  }

  const createdOutput = await rpc(deps, "workspace.group.create", {
    window_id: windowId,
    child_workspace_ids: workspaceIds,
  });
  let created: ReturnType<typeof parseCreatedGroup>;
  try {
    created = parseCreatedGroup(createdOutput);
  } catch (error) {
    throw new TeamGroupError(
      502,
      "CMUX_FAILED",
      `cmux workspace.group.create returned an unexpected shape: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!created) {
    throw new TeamGroupError(502, "CMUX_FAILED", "cmux workspace.group.create did not name a group.");
  }

  await rpc(deps, "workspace.group.rename", { group_id: created.id, name });
  if (hex) {
    const written = await deps.setGroupColor?.(created.id, hex, "board team create");
    if (!written) {
      throw new TeamGroupError(502, "CMUX_FAILED", "The group color write did not land.");
    }
  }

  return {
    team: {
      id: created.id,
      name,
      hex: hex ?? normalizeHex(created.customColor) ?? "",
      windowId,
      memberWorkspaceIds: created.memberWorkspaceIds,
    },
  };
}

export async function renameOperatorTeam(
  groupId: string,
  name: string,
  deps: TeamGroupDependencies,
): Promise<void> {
  const provenanceIds = deps.provenanceIds();
  const { group } = await findLiveGroup(deps, groupId);
  requireOperatorGroup(group, provenanceIds);
  const next = operatorName(name, group.id, provenanceIds);
  await rpc(deps, "workspace.group.rename", { group_id: group.id, name: next });
}

export async function addOperatorMember(
  groupId: string,
  workspaceId: string,
  deps: TeamGroupDependencies,
): Promise<void> {
  const id = workspaceId.trim();
  if (!id) throw new TeamGroupError(400, "INVALID_BODY", "workspaceId is required.");
  const provenanceIds = deps.provenanceIds();
  const { windowId, group } = await findLiveGroup(deps, groupId);
  requireOperatorGroup(group, provenanceIds);
  const groups = await listWindowGroups(deps, windowId);
  const live = groups.find((entry) => entry.id === group.id) ?? group;
  requireNotAnchor(live, id, groups);
  if (live.memberWorkspaceIds.includes(id) || live.anchorWorkspaceId === id) return;
  const inWindow = await listWindowWorkspaces(deps, windowId);
  if (!inWindow.has(id)) {
    throw new TeamGroupError(400, "MIXED_WINDOW", "That workspace is not in this group's window.");
  }
  const home = homeGroup(groups, id);
  if (home && home.id !== live.id) {
    throw new TeamGroupError(409, "FOREIGN_GROUP", "A workspace already belongs to another group.");
  }
  await rpc(deps, "workspace.group.add", { group_id: live.id, workspace_id: id });
}

export async function removeOperatorMember(
  groupId: string,
  workspaceId: string,
  deps: TeamGroupDependencies,
): Promise<void> {
  const id = workspaceId.trim();
  if (!id) throw new TeamGroupError(400, "INVALID_BODY", "workspaceId is required.");
  const provenanceIds = deps.provenanceIds();
  const { windowId, group } = await findLiveGroup(deps, groupId);
  requireOperatorGroup(group, provenanceIds);
  const groups = await listWindowGroups(deps, windowId);
  const live = groups.find((entry) => entry.id === group.id) ?? group;
  if (live.anchorWorkspaceId === id) {
    throw new TeamGroupError(400, "ANCHOR", "The group anchor cannot be removed.");
  }
  if (!live.memberWorkspaceIds.includes(id)) {
    throw new TeamGroupError(404, "NOT_FOUND", "That workspace is not a member of this team.");
  }
  await rpc(deps, "workspace.group.remove", { workspace_id: id });
}

export async function ungroupOperatorTeam(
  groupId: string,
  deps: TeamGroupDependencies,
): Promise<void> {
  const provenanceIds = deps.provenanceIds();
  const { group } = await findLiveGroup(deps, groupId);
  requireOperatorGroup(group, provenanceIds);
  await rpc(deps, "workspace.group.ungroup", { group_id: group.id });
}

interface TeamsPath {
  kind: "root" | "group" | "members" | "member";
  groupId?: string;
  workspaceId?: string;
}

function parseTeamsPath(pathname: string): TeamsPath | undefined {
  if (pathname === "/api/teams") return { kind: "root" };
  if (!pathname.startsWith("/api/teams/")) return undefined;
  const parts = pathname.slice("/api/teams/".length).split("/").filter(Boolean);
  if (parts.length === 1) {
    const groupId = decodeURIComponent(parts[0] ?? "");
    return groupId ? { kind: "group", groupId } : undefined;
  }
  if (parts.length === 2 && parts[1] === "members") {
    const groupId = decodeURIComponent(parts[0] ?? "");
    return groupId ? { kind: "members", groupId } : undefined;
  }
  if (parts.length === 3 && parts[1] === "members") {
    const groupId = decodeURIComponent(parts[0] ?? "");
    const workspaceId = decodeURIComponent(parts[2] ?? "");
    return groupId && workspaceId ? { kind: "member", groupId, workspaceId } : undefined;
  }
  return undefined;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new TeamGroupError(415, "CONTENT_TYPE_REJECTED", "Team changes require application/json.");
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new TeamGroupError(400, "INVALID_JSON", "Team body is not valid JSON.");
  }
  const record = asRecord(raw);
  if (!record) throw new TeamGroupError(400, "INVALID_JSON", "Team body must be a JSON object.");
  return record;
}

export async function handleTeamGroupsRequest(
  request: Request,
  deps: TeamGroupDependencies,
): Promise<Response> {
  const url = new URL(request.url);
  if (!isLoopback(url.hostname)) {
    return requestError(403, "ORIGIN_REJECTED", "Team changes are only available on loopback.");
  }
  if (!request.headers.get("origin") || request.headers.get("origin") !== url.origin) {
    return requestError(403, "ORIGIN_REJECTED", "Team changes require an exact same-origin loopback Origin header.");
  }
  const path = parseTeamsPath(url.pathname);
  if (!path) return requestError(404, "NOT_FOUND", "No team route matches that path.");

  try {
    if (path.kind === "root" && request.method === "POST") {
      const body = await readJsonBody(request);
      const workspaceIds = Array.isArray(body.workspaceIds)
        ? body.workspaceIds.filter((id): id is string => typeof id === "string")
        : [];
      if (!Array.isArray(body.workspaceIds)) {
        throw new TeamGroupError(400, "INVALID_BODY", "workspaceIds must be a list of workspace ids.");
      }
      const created = await createOperatorTeam({
        windowId: typeof body.windowId === "string" && body.windowId.trim() ? body.windowId : undefined,
        workspaceIds,
        name: typeof body.name === "string" ? body.name : "",
        hex: typeof body.hex === "string" ? body.hex : undefined,
      }, deps);
      return json(created);
    }
    if (path.kind === "group" && request.method === "PATCH" && path.groupId) {
      const body = await readJsonBody(request);
      await renameOperatorTeam(path.groupId, typeof body.name === "string" ? body.name : "", deps);
      return json({ ok: true });
    }
    if (path.kind === "members" && request.method === "POST" && path.groupId) {
      const body = await readJsonBody(request);
      await addOperatorMember(
        path.groupId,
        typeof body.workspaceId === "string" ? body.workspaceId : "",
        deps,
      );
      return json({ ok: true });
    }
    if (path.kind === "member" && request.method === "DELETE" && path.groupId && path.workspaceId) {
      await removeOperatorMember(path.groupId, path.workspaceId, deps);
      return json({ ok: true });
    }
    if (path.kind === "group" && request.method === "DELETE" && path.groupId) {
      await ungroupOperatorTeam(path.groupId, deps);
      return json({ ok: true });
    }
    return requestError(405, "METHOD_NOT_ALLOWED", "Use POST, PATCH, or DELETE for operator teams.");
  } catch (error) {
    if (error instanceof TeamGroupError) {
      return requestError(error.status, error.code, error.message);
    }
    return requestError(500, "INTERNAL", error instanceof Error ? error.message : String(error));
  }
}
