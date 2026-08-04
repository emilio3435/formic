import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  collectCmuxNotifications,
  parseCmuxNotifications,
} from "../src/server/cmux";
import { buildSnapshot } from "../src/server/snapshot";
import type {
  ArchiveStore,
  CmuxSurface,
  CollectedAgent,
  CommandRunner,
} from "../src/server/types";

const notifications = parseCmuxNotifications(
  readFileSync(join(import.meta.dir, "fixtures", "cmux-notifications.json"), "utf8"),
);

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
const surface: CmuxSurface = {
  workspaceId: "WORKSPACE-EXACT",
  surfaceId: "SURFACE-EXACT",
  paneId: "PANE-EXACT",
  cwd: "/Users/emilionunezgarcia/Developer/the-mountain",
  sourceSessionIds: ["exact-session"],
};
const source: CollectedAgent = {
  id: "codex:exact-session",
  provider: "codex",
  sourceSessionId: "exact-session",
  displayName: "Exact agent",
  status: "running",
  statusReason: "Recent source activity.",
  startedAt: "2026-07-21T22:00:00.000Z",
  updatedAt: "2026-07-21T23:00:00.000Z",
  tokens: { provenance: "unknown" },
  transcriptTail: "Working normally.",
  artifacts: [],
  gates: [],
};

describe("notification-derived attention truth", () => {
  test("only the newest unread notification on the exact surface marks that agent attention", () => {
    const snapshot = buildSnapshot({
      agents: [source],
      surfaces: [surface],
      notifications,
      archiveStore,
      now: new Date("2026-07-21T23:08:00.000Z"),
    });
    const exactAgent = snapshot.programs[0]?.agents[0];

    expect(notifications.map(({ id }) => id)).toEqual([
      "older-exact",
      "newer-exact",
      "other-surface",
    ]);
    /* The overlay, on its own field. It used to be published by overwriting
       `status`, so one field answered "what is this session doing" and "is
       something waiting on you" and lost the first. The lifecycle is untouched
       by the notification, which is the whole point of the separation. */
    expect(exactAgent?.attention).toBe(true);
    expect(exactAgent?.lifecycle).toBe("waiting");
    expect(exactAgent?.statusReason).toContain("Newest exact-surface blocker");
    expect(exactAgent?.statusReason).not.toContain("This read message");
    expect(exactAgent?.statusReason).not.toContain("Must not leak across agents");
    expect(snapshot.totals.attention).toBe(1);
  });

  test("malformed notification discovery is surfaced as a control-health error", async () => {
    const runner: CommandRunner = {
      run: async () => ({
        exitCode: 0,
        stdout: "not json",
        stderr: "",
        timedOut: false,
      }),
    };
    const result = await collectCmuxNotifications(runner, "cmux");

    expect(result.value).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("invalid JSON");
  });

  test("a notification from the prior occupant of a reused surface cannot mark the new session attention", () => {
    const reusedSurfaceSession: CollectedAgent = {
      ...source,
      startedAt: "2026-07-21T23:06:30.000Z",
      updatedAt: "2026-07-21T23:07:30.000Z",
      status: "waiting",
      statusReason: "New session is waiting normally.",
    };
    const snapshot = buildSnapshot({
      agents: [reusedSurfaceSession],
      surfaces: [surface],
      notifications,
      archiveStore,
      now: new Date("2026-07-21T23:08:00.000Z"),
    });
    const agent = snapshot.programs[0]?.agents[0];

    /* No overlay at all: the notification belonged to whoever held this surface
       before, and it must not follow the pane to its next occupant. Asserted on
       the field the overlay actually uses, so its absence is what is checked. */
    expect(agent?.attention).toBeUndefined();
    expect(agent?.statusReason).toBe("New session is waiting normally.");
    expect(agent?.transcriptTail).toBe("Working normally.");
    expect(snapshot.totals.attention).toBe(0);
  });
});
