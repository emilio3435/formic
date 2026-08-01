import { beforeAll, describe, expect, test } from "bun:test";

/* The health card has to answer three questions in one glance: is anything
   wrong, how bad is it, and what do I do about it. It used to answer only the
   first two, and answered the second badly — a permanent tidy-up held the board
   red, which trains an operator to stop reading it.

   These tests pin the answers, not the pixels. Each one should fail if the card
   goes back to naming a symptom, sizing an alarm by dead sessions, or inventing
   a next step the payload cannot support. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let M: any;

beforeAll(async () => {
  // @ts-expect-error The dependency-free browser client has no declaration file.
  await import("../src/web/app.js");
  M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
});

function agent(overrides: Record<string, unknown> = {}) {
  return {
    id: "codex:a1",
    provider: "codex",
    sourceSessionId: "a1",
    displayName: "Ridge worker",
    programId: "p1",
    status: "running",
    activity: "working",
    controlState: "linked",
    updatedAt: "2026-07-22T03:00:00.000Z",
    tokens: { provenance: "observed", total: 10 },
    artifacts: [],
    gates: [],
    ...overrides,
  };
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-07-22T03:00:00.000Z",
    controlHealth: { cmuxReachable: true, lastCheckedAt: "2026-07-22T03:00:00.000Z", errors: [], staleSources: [] },
    totals: { live: 1, tracked: 1, attention: 0, sourceHealth: { healthy: 4, degraded: 0, total: 4 } },
    issues: [],
    programs: [{ id: "p1", name: "p1", agents: [agent()] }],
    ...overrides,
  };
}

const DEBRIS = {
  kind: "abandoned-cmux-panes",
  count: 17,
  surfaceIds: ["s-1", "s-2"],
  remedy: "Close 17 cmux panes left over from finished waves.",
  detail: ["cmux s-1 has conflicting open agent session files"],
};

describe("health card — is anything wrong, how bad, what do I do", () => {
  test("a clear board says so in the operator's words, not the system's", () => {
    const data = M.summaryWidgetData("health", snapshot(), "live", "percent", [], false);
    // "Operational" describes the system to itself and leaves a reader unsure
    // whether the board is fine or merely not talking.
    expect(data.value).toBe("All clear");
    expect(data.tone).toBe("ok");
    expect(data.sublabel).toContain("nothing needs you");
  });

  test("leftover panes stay discoverable on a clear board instead of vanishing with the alarm", () => {
    // The backend moved abandoned panes out of `errors` so they no longer hold
    // the verdict red. The risk that creates is the opposite one: cleanup that
    // is invisible because it stopped being an emergency.
    const tidy = snapshot({ controlHealth: { cmuxReachable: true, lastCheckedAt: "x", errors: [], staleSources: [], debris: DEBRIS } });
    const data = M.summaryWidgetData("health", tidy, "live", "percent", [], false);
    expect(data.value).toBe("All clear");
    expect(data.sublabel).toContain("tidy-up available");
    expect(data.sublabel).not.toContain("nothing needs you");
    expect(data.remedy.tidy).toBe(true);
    expect(data.remedy.instruction).toBe(DEBRIS.remedy);
  });

  test("the remedy is the backend's wording, rendered verbatim", () => {
    // The lane that classified the fault names the fix. Paraphrasing here would
    // let the card and the drawer describe the same problem two different ways.
    const custom = { ...DEBRIS, remedy: "Archive the 2 panes from wave 4." };
    const snap = snapshot({ controlHealth: { cmuxReachable: true, lastCheckedAt: "x", errors: [], staleSources: [], debris: custom } });
    expect(M.healthRemedy(snap).instruction).toBe("Archive the 2 panes from wave 4.");
  });

  test("the alarm is sized by live impact, not by every session the issue touches", () => {
    /* This is the whole complaint. The identity-conflict row implicated 37
       sessions, but 26 had already ended — an operator read "37" as an outage
       when only a handful of live sessions were actually un-drivable. The
       headline number must count sessions that are BOTH live and quarantined. */
    const blocked = agent({ id: "codex:live", activity: "idle", controlState: "quarantined" });
    const dead1 = agent({ id: "codex:d1", activity: "ended", controlState: "observed-only" });
    const dead2 = agent({ id: "codex:d2", activity: "ended", controlState: "observed-only" });
    const snap = snapshot({
      controlHealth: { cmuxReachable: true, lastCheckedAt: "x", errors: ["boom"], staleSources: [] },
      issues: [{
        id: "system:cmux-identity-conflicts", kind: "system", severity: "error",
        title: "CMUX identity conflicts", summary: "3 surfaces have conflicting evidence.",
        affectedAgentIds: ["codex:live", "codex:d1", "codex:d2"],
      }],
      programs: [{ id: "p1", name: "p1", agents: [blocked, dead1, dead2] }],
    });
    const remedy = M.healthRemedy(snap);
    expect(remedy.blockedCount).toBe(1);
    expect(remedy.problem).toContain("1 live session");
    expect(remedy.problem).toContain("can't take commands");
    // The symptom title must not be the operator's first read.
    expect(remedy.problem).not.toContain("identity conflict");
  });

  test("no next step is invented when the payload cannot supply one", () => {
    // A confident instruction the payload does not support is worse than none:
    // it sends an operator somewhere that may not fix anything.
    const snap = snapshot({
      controlHealth: { cmuxReachable: true, lastCheckedAt: "x", errors: ["boom"], staleSources: [] },
      issues: [{
        id: "system:unknown-thing", kind: "system", severity: "error",
        title: "Something else", summary: "A new problem with no known remedy.",
        affectedAgentIds: [],
      }],
    });
    const remedy = M.healthRemedy(snap);
    expect(remedy.instruction).toBe("");
    expect(remedy.problem).toBe("A new problem with no known remedy.");
  });

  test("panes read as titles and collapse to one row each", () => {
    /* An operator closes panes, not sessions, so several ended sessions sharing
       a surface are one thing to act on. Surface UUIDs are not an answer to
       "which panes" — the pane's own title is. */
    const target = { surfaceId: "s-1", workspaceTitle: "wave-4 · authdesign" };
    const snap = snapshot({
      controlHealth: { cmuxReachable: true, lastCheckedAt: "x", errors: [], staleSources: [], debris: DEBRIS },
      programs: [{
        id: "p1", name: "p1", agents: [
          agent({ id: "codex:x1", activity: "ended", target, updatedAt: "2026-07-20T03:00:00.000Z" }),
          agent({ id: "codex:x2", activity: "ended", target, updatedAt: "2026-07-21T03:00:00.000Z" }),
        ],
      }],
    });
    const panes = M.healthRemedy(snap).panes;
    expect(panes).toHaveLength(1);
    expect(panes[0].name).toBe("wave-4 · authdesign");
    // Keeps the most recent evidence for the pane, so "quiet 3d" is not a lie.
    expect(panes[0].updatedAt).toBe("2026-07-21T03:00:00.000Z");
  });

  test("a blocking fault still outranks any tidy-up", () => {
    // Debris must never soften a real outage: cmux unreachable means Focus and
    // Send cannot route, and that headline wins regardless of pending cleanup.
    const down = snapshot({
      controlHealth: { cmuxReachable: false, lastCheckedAt: "x", errors: ["gone"], staleSources: [], debris: DEBRIS },
    });
    const data = M.summaryWidgetData("health", down, "live", "percent", [], false);
    expect(data.value).toBe("Blocked");
    expect(data.severityDetail).toContain("Focus and Send");
  });
});
