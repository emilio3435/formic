import { assignSlot, hexForSlot, normalizeHex } from "./repo-color";

const GROUP_N = /^Group \d+$/;

export interface CmuxTeam {
  id: string;
  name: string;
  hex: string;
  windowId: string;
  memberWorkspaceIds: string[];
}

export interface TeamTintSettings {
  assignments: Record<string, { groupId: string; hex: string; source: "cmux" | "user" }>;
}

export function isOperatorTeam(
  name: string,
  groupId: string,
  provenanceIds: ReadonlySet<string>,
): boolean {
  if (provenanceIds.has(groupId)) return false;
  if (GROUP_N.test(name.trim())) return false;
  return name.trim().length > 0;
}

export function assignTeamHex(
  groupId: string,
  settings: TeamTintSettings,
  takenHexes: ReadonlySet<string>,
): string {
  const stored = normalizeHex(settings.assignments[groupId]?.hex);
  if (stored) return stored;
  const takenSlots = new Set<number>();
  for (const hex of takenHexes) {
    // derive occupied slots from already-issued palette hexes
    for (let slot = 0; slot < 6; slot += 1) {
      if (normalizeHex(hexForSlot(slot)) === normalizeHex(hex)) takenSlots.add(slot);
    }
  }
  return hexForSlot(assignSlot(groupId, takenSlots));
}

export function indexTeamsByWorkspace(
  teams: readonly CmuxTeam[],
): Map<string, CmuxTeam> {
  const map = new Map<string, CmuxTeam>();
  for (const team of teams) {
    for (const workspaceId of team.memberWorkspaceIds) {
      if (!map.has(workspaceId)) map.set(workspaceId, team);
    }
  }
  return map;
}

export function attachTeams<T extends { target?: { workspaceId?: string }; team?: { id: string; name: string; hex: string; windowId: string } }>(
  agents: readonly T[],
  teams: readonly CmuxTeam[],
  _provenanceIds: ReadonlySet<string>,
  _settings: TeamTintSettings,
): T[] {
  const index = indexTeamsByWorkspace(teams);
  return agents.map((agent) => {
    const workspaceId = agent.target?.workspaceId;
    const team = workspaceId ? index.get(workspaceId) : undefined;
    if (!team) return agent;
    return { ...agent, team: { id: team.id, name: team.name, hex: team.hex, windowId: team.windowId } };
  });
}

export interface TeamWindowGroup {
  id: string;
  name?: string;
  customColor?: string;
  memberWorkspaceIds: string[];
}

export interface TeamWindowGroups {
  windowId: string;
  groups: readonly TeamWindowGroup[];
}

export interface TeamColorIngest {
  groupId: string;
  hex: string;
}

/** Last-write-wins, except a pending write-echo keeps disk until live matches or the process restarts. */
export function resolveOperatorTeams(
  windows: readonly TeamWindowGroups[],
  provenanceIds: ReadonlySet<string>,
  settings: TeamTintSettings,
  expectEcho: ReadonlyMap<string, string> = new Map(),
): { teams: CmuxTeam[]; ingested: TeamColorIngest[] } {
  const taken = new Set<string>();
  const teams: CmuxTeam[] = [];
  const ingested: TeamColorIngest[] = [];
  for (const window of windows) {
    for (const group of window.groups) {
      const name = group.name ?? "";
      if (!isOperatorTeam(name, group.id, provenanceIds)) continue;
      const liveHex = normalizeHex(group.customColor);
      const diskHex = normalizeHex(settings.assignments[group.id]?.hex);
      const expected = normalizeHex(expectEcho.get(group.id));
      const echoPending = Boolean(expected && liveHex !== expected);
      if (liveHex && liveHex !== diskHex && !echoPending) {
        ingested.push({ groupId: group.id, hex: liveHex });
      }
      const hex = (liveHex && liveHex !== diskHex && !echoPending ? liveHex : null)
        ?? diskHex
        ?? assignTeamHex(group.id, settings, taken);
      taken.add(hex);
      teams.push({
        id: group.id,
        name,
        hex,
        windowId: window.windowId,
        memberWorkspaceIds: group.memberWorkspaceIds,
      });
    }
  }
  return { teams, ingested };
}

export function buildOperatorTeams(
  windows: readonly TeamWindowGroups[],
  provenanceIds: ReadonlySet<string>,
  settings: TeamTintSettings,
  expectEcho?: ReadonlyMap<string, string>,
): CmuxTeam[] {
  return resolveOperatorTeams(windows, provenanceIds, settings, expectEcho).teams;
}
