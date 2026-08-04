import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  collectCmuxNotifications,
  parseCmuxNotifications,
} from "../src/server/cmux";
import { buildSnapshot, summarizeNotification } from "../src/server/snapshot";
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
    /* Still the NEWEST exact-surface notification and no other — identified by
       its title now rather than its body, because the body no longer travels on
       the status line. The read one and the other surface's must not leak. */
    expect(exactAgent?.statusReason).toContain("Blocked");
    expect(exactAgent?.statusReason).not.toContain("Resolved");
    expect(exactAgent?.statusReason).not.toContain("Other agent");
    expect(exactAgent?.statusReason).not.toContain("Must not leak across agents");

    /* The status line is a STATE, not a paste. It used to carry title, subtitle
       AND body cut at 500 characters, which put raw markdown, a URL and a commit
       SHA into the field a row uses to say what a session is doing. The body is
       not lost — it rides transcriptTail, asserted below. */
    expect(exactAgent?.statusReason).not.toContain("Newest exact-surface blocker");
    expect((exactAgent?.statusReason ?? "").length).toBeLessThanOrEqual(120);
    expect(exactAgent?.transcriptTail).toContain("Newest exact-surface blocker");

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

describe("a notification summary is a row, not a paste", () => {
  /* Measured on the live board 2026-08-04, the status line of a real row read:
     "Unread cmux notification: Codex — Completed in LaHormigaDormida — Merged
     and closed the active Hormiga recovery chain: - [PR #387](https://github.com
     /Imagine-That-Ai/LaHormigaDormida/pull/387) merged as `6edfb56d7`, fixing
     Inbox/Watch truth, stale-write races, harn…" — 280 characters of markdown,
     a URL and a SHA, truncated mid-word, in the field that answers "what is
     this session doing". */
  test("markdown links become their text, not their URL", () => {
    expect(summarizeNotification("Merged [PR #387](https://github.com/x/y/pull/387)"))
      .toBe("Merged PR #387");
  });

  test("bare URLs and code ticks are dropped", () => {
    expect(summarizeNotification("Merged as `6edfb56d7` see https://github.com/x/y"))
      .toBe("Merged as 6edfb56d7 see");
  });

  test("a long notification is cut to something a row can hold", () => {
    const summary = summarizeNotification("x".repeat(400))!;
    expect(summary.length).toBeLessThanOrEqual(90);
    expect(summary.endsWith("…")).toBe(true);
  });

  test("title and subtitle are joined; a missing one is not punctuation", () => {
    expect(summarizeNotification("Codex", "Completed")).toBe("Codex — Completed");
    expect(summarizeNotification("Codex")).toBe("Codex");
    expect(summarizeNotification(undefined, "Completed")).toBe("Completed");
  });

  test("nothing to say is undefined rather than an empty label", () => {
    expect(summarizeNotification()).toBeUndefined();
    expect(summarizeNotification("   ", "")).toBeUndefined();
    // A title that was ONLY a URL leaves nothing behind, and must not become " — ".
    expect(summarizeNotification("https://github.com/x/y")).toBeUndefined();
  });
});
