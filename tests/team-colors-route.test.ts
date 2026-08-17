import { expect, test } from "bun:test";
import { createMountainFetch, emptySnapshot } from "../src/server/app";
import { memorySettingsFiles } from "../src/server/settings";
import {
  handleTeamColorsRequest,
  JsonTeamColorsStore,
} from "../src/server/team-colors";
import type { CmuxTeam, TeamTintSettings } from "../src/shared/team-tint";

const ORIGIN = "http://127.0.0.1:4701";

const probe: CmuxTeam = {
  id: "g1",
  name: "ANT · probe",
  hex: "#5f7f2a",
  windowId: "w",
  memberWorkspaceIds: ["ws-a", "ws-b"],
};

interface ColorWrites {
  groups: { groupId: string; hex: string; reason: string }[];
  workspaces: { workspaceId: string; hex: string; reason: string }[];
}

function emptyWrites(): ColorWrites {
  return { groups: [], workspaces: [] };
}

async function subject(
  writes: ColorWrites = emptyWrites(),
  extra: {
    teams?: readonly CmuxTeam[];
    provenanceIds?: ReadonlySet<string>;
  } = {},
) {
  const store = await JsonTeamColorsStore.open("team-colors.json", memorySettingsFiles());
  return {
    store,
    handle: (request: Request) => handleTeamColorsRequest(request, store, {
      teams: () => extra.teams ?? [probe],
      provenanceIds: () => extra.provenanceIds ?? new Set(["prov"]),
      setGroupColor: async (groupId, hex, reason) => {
        writes.groups.push({ groupId, hex, reason });
        return true;
      },
      setWorkspaceColor: async (workspaceId, hex, reason) => {
        writes.workspaces.push({ workspaceId, hex, reason });
        return true;
      },
    }),
  };
}

function put(groupId: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/team-colors/${groupId}`, {
    method: "PUT",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("PUT persists a user assignment and writes the group then each live member", async () => {
  const writes = emptyWrites();
  const { handle, store } = await subject(writes);
  const response = await handle(put("g1", { hex: "#2E66A8" }));
  expect(response.status).toBe(200);
  const body = await response.json() as {
    teams: CmuxTeam[];
    settings: TeamTintSettings;
  };
  expect(body.settings.assignments.g1).toEqual({
    groupId: "g1",
    hex: "#2e66a8",
    source: "user",
  });
  expect(store.get().assignments.g1?.source).toBe("user");
  expect(writes.groups).toEqual([{
    groupId: "g1",
    hex: "#2e66a8",
    reason: "board team assignment",
  }]);
  expect(writes.workspaces).toEqual([
    { workspaceId: "ws-a", hex: "#2e66a8", reason: "board team assignment" },
    { workspaceId: "ws-b", hex: "#2e66a8", reason: "board team assignment" },
  ]);
});

test("PUT does not fan a team hex onto ungrouped workspaces of the same repo", async () => {
  const writes = emptyWrites();
  const { handle } = await subject(writes);
  await handle(put("g1", { hex: "#9e3355" }));
  expect(writes.workspaces.map((write) => write.workspaceId).sort()).toEqual(["ws-a", "ws-b"]);
  expect(writes.workspaces.some((write) => write.workspaceId === "ws-ungrouped")).toBe(false);
});

test("PUT refuses a bad hex, a foreign origin, and an unknown group", async () => {
  const { handle } = await subject();
  const badHex = await handle(put("g1", { hex: "cornflower" }));
  expect(badHex.status).toBe(400);
  expect(await badHex.json()).toEqual({
    error: "hex must be #RGB or #RRGGBB.",
    code: "INVALID_HEX",
  });

  const remote = await handle(new Request("http://10.0.0.5:4701/api/team-colors/g1", {
    method: "PUT",
    headers: { origin: "http://10.0.0.5:4701", "content-type": "application/json" },
    body: JSON.stringify({ hex: "#2e66a8" }),
  }));
  expect(remote.status).toBe(403);
  expect(await remote.json()).toMatchObject({ code: "ORIGIN_REJECTED" });

  const cross = await handle(put("g1", { hex: "#2e66a8" }, { origin: "http://evil.example" }));
  expect(cross.status).toBe(403);
  expect(await cross.json()).toMatchObject({ code: "ORIGIN_REJECTED" });

  const missing = await handle(put("no-such-team", { hex: "#2e66a8" }));
  expect(missing.status).toBe(404);
  expect(await missing.json()).toMatchObject({ code: "NOT_FOUND" });
});

test("PUT of a TINT-G provenance folder is NOT_FOUND, not a write", async () => {
  const writes = emptyWrites();
  const { handle } = await subject(writes, {
    teams: [{
      id: "prov",
      name: "the-ant-hill",
      hex: "#d70ae6",
      windowId: "w",
      memberWorkspaceIds: ["ws-repo"],
    }],
    provenanceIds: new Set(["prov"]),
  });
  const response = await handle(put("prov", { hex: "#2e66a8" }));
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
  expect(writes.groups).toEqual([]);
  expect(writes.workspaces).toEqual([]);
});

test("PUT /api/team-colors/:groupId reaches the handler through createMountainFetch", async () => {
  const store = await JsonTeamColorsStore.open("team-colors.json", memorySettingsFiles());
  const writes = emptyWrites();
  const snapshot = emptySnapshot();
  const fetch = createMountainFetch({
    state: {
      get: () => snapshot,
      subscribe: () => () => {},
      refresh: async () => snapshot,
      teams: () => [probe],
    },
    runner: { run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }) },
    archiveStore: { has: () => false, archive: async () => {} },
    teamColorsStore: store,
    teamColorWrites: {
      setGroupColor: async (groupId, hex, reason) => {
        writes.groups.push({ groupId, hex, reason });
        return true;
      },
      setWorkspaceColor: async (workspaceId, hex, reason) => {
        writes.workspaces.push({ workspaceId, hex, reason });
        return true;
      },
    },
    webRoot: import.meta.dir,
  });
  try {
    const response = await fetch(put("g1", { hex: "#9E3355" }));
    expect(response.status).toBe(200);
    const body = await response.json() as { settings: TeamTintSettings };
    expect(body.settings.assignments.g1).toEqual({
      groupId: "g1",
      hex: "#9e3355",
      source: "user",
    });
    expect(writes.groups).toHaveLength(1);
    expect(writes.workspaces.map((write) => write.workspaceId)).toEqual(["ws-a", "ws-b"]);
  } finally {
    fetch.dispose();
  }
});
