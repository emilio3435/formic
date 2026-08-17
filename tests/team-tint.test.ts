import { expect, test } from "bun:test";
import { parseCmuxGroups } from "../src/server/cmux-groups";
import {
  isOperatorTeam,
  assignTeamHex,
  indexTeamsByWorkspace,
} from "../src/shared/team-tint";

test("TINT-G provenance folders are not teams", () => {
  expect(isOperatorTeam("the-ant-hill", "25C63A3D-aaaa", new Set(["25C63A3D-aaaa"]))).toBe(false);
});

test("Group N auto-titles are not teams", () => {
  expect(isOperatorTeam("Group 2", "abc", new Set())).toBe(false);
});

test("ANT · probe is a team", () => {
  expect(isOperatorTeam("ANT · probe", "abc", new Set())).toBe(true);
});

test("cooper-scheduler in provenance is not a team even if the name looks like a repo", () => {
  expect(isOperatorTeam("cooper-scheduler", "prov-1", new Set(["prov-1"]))).toBe(false);
});

test("four teams get four palette hexes, not one repo hex", () => {
  const settings = { assignments: {} };
  const taken = new Set<string>();
  const hexes = ["g1", "g2", "g3", "g4"].map((id) => {
    const hex = assignTeamHex(id, settings, taken);
    taken.add(hex);
    return hex;
  });
  expect(new Set(hexes).size).toBe(4);
});

test("index maps every member workspace to the team", () => {
  const map = indexTeamsByWorkspace([{
    id: "g1", name: "ANT · probe", hex: "#5f7f2a",
    windowId: "w", memberWorkspaceIds: ["ws-a", "ws-b"],
  }]);
  expect(map.get("ws-a")?.name).toBe("ANT · probe");
  expect(map.get("ws-b")?.id).toBe("g1");
});

test("parseCmuxGroups keeps members and custom_color", () => {
  const groups = parseCmuxGroups(JSON.stringify({
    result: {
      groups: [{
        id: "g1",
        name: "ANT · probe",
        custom_color: "#5F7F2A",
        member_workspace_ids: ["ws-a", "ws-b"],
        anchor_workspace_id: "ws-anchor",
      }],
    },
  }));
  expect(groups[0]?.memberWorkspaceIds).toEqual(["ws-a", "ws-b"]);
  expect(groups[0]?.customColor).toBe("#5F7F2A");
});
