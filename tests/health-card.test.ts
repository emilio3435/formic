import { beforeAll, describe, expect, test } from "bun:test";

/* S2-T2 SPLIT THIS CARD IN TWO, and these tests follow the split.

   The card used to answer three questions in one glance: is anything wrong, how
   bad is it, and what do I do about it. The third one is the problem — a
   control living inside a reading is the confidence header doing attention's
   job, the same defect that retired the finding links. So the header keeps a
   QUALIFIER ("Readings healthy" / "Readings degraded"), because a confidence
   header whose instruments are broken must say so or every number beside it is
   unqualified, and the acting moves to the notification center.

   What did NOT move is healthRemedy() itself. It still computes the problem
   sentence, the instruction and the pane list, still sized by live impact, and
   most of these tests drive it directly — they were always about the derivation
   rather than the card. Each one should fail if the remedy goes back to naming a
   symptom, sizing an alarm by dead sessions, or inventing a next step the
   payload cannot support; and the two that read the card now assert that it
   qualifies the instruments rather than issuing orders. */

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
    totals: { live: 1, tracked: 1, attention: 0, sourceHealth: { healthy: 4, degraded: 0, absent: 0, total: 4 } },
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

describe("health chip — can I trust these readings, and healthRemedy behind it", () => {
  test("the chip qualifies the INSTRUMENTS, and cannot be read as a verdict on the fleet", () => {
    const data = M.summaryWidgetData("health", snapshot(), "live", "percent", [], false);
    /* "Operational" described the system to itself. "All clear" fixed that and
       introduced the opposite problem once the Findings card was retired: alone
       in a header of fleet readings, it reads as "the fleet is clear" — a claim
       this card cannot make and never could, since it only ever looked at
       sources and the control plane. "Readings healthy" says exactly what was
       measured. */
    expect(data.value).toBe("Readings healthy");
    expect(data.tone).toBe("ok");
    expect(data.value).not.toBe("Operational");
    // It states no to-do, in either direction: no backlog, no all-clear about one.
    expect(data.sublabel).not.toContain("nothing needs you");
    expect(data.sublabel).toContain("sources healthy");
    // And it carries no remedy — the header does not act.
    expect(data.remedy).toBeNull();
  });

  test("leftover panes stay discoverable on a clear board instead of vanishing with the alarm", () => {
    // The backend moved abandoned panes out of `errors` so they no longer hold
    // the verdict red. The risk that creates is the opposite one: cleanup that
    // is invisible because it stopped being an emergency.
    const tidy = snapshot({ controlHealth: { cmuxReachable: true, lastCheckedAt: "x", errors: [], staleSources: [], debris: DEBRIS } });
    const data = M.summaryWidgetData("health", tidy, "live", "percent", [], false);
    // The chip stays calm: debris is not an instrument fault.
    expect(data.value).toBe("Readings healthy");
    expect(data.remedy).toBeNull();
    /* The discoverability the original claim protects is preserved, and moved.
       healthRemedy still says a tidy-up is available with the backend's own
       wording, and renderInstrumentBlock in the notification center renders it
       on a CLEAR board precisely so cleanup does not become invisible the moment
       it stops being an emergency. */
    const remedy = M.instrumentRemedy(tidy, "live", false);
    expect(remedy.tidy).toBe(true);
    expect(remedy.instruction).toBe(DEBRIS.remedy);
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

  test("a live fault never borrows the tidy-up's remedy", () => {
    /* Caught on the live board, not in a diff: the card read "3 live sessions
       can't take commands." and then offered "Close 17 cmux panes ... this is
       tidying, not a fault." — a fix for a different problem, contradicting the
       line above it. Debris answers debris. A live fault uses its own remedy,
       or the summary the backend wrote for it, which carries the fix in prose.
       The pane list goes with the tidy-up too: offering it here would point the
       operator at panes that would not unblock anything. */
    const blocked = agent({ id: "codex:live", activity: "idle", controlState: "quarantined" });
    const snap = snapshot({
      controlHealth: { cmuxReachable: true, lastCheckedAt: "x", errors: ["conflict"], staleSources: [], debris: DEBRIS },
      issues: [{
        id: "system:cmux-shared-pane", kind: "system", severity: "error",
        title: "Two live sessions share one cmux pane",
        summary: "Focus, Send and Interrupt stay unavailable for 2 sessions until one is closed.",
        affectedAgentIds: ["codex:live"],
      }],
      programs: [{ id: "p1", name: "p1", agents: [blocked] }],
    });
    const remedy = M.healthRemedy(snap);
    expect(remedy.instruction).not.toContain("tidying, not a fault");
    expect(remedy.instruction).toContain("until one is closed");
    expect(remedy.panes).toHaveLength(0);
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

  test("a blocking fault outranks any tidy-up, and does not offer it as the fix", () => {
    /* Debris must never soften a real outage, and must never stand in for its
       remedy: "close 17 panes" while Focus and Send cannot route at all points
       the operator at the wrong problem. The panes stay listed; the instruction
       does not, because restoring the control plane is the only next step that
       matters until it is back. */
    const down = snapshot({
      controlHealth: { cmuxReachable: false, lastCheckedAt: "x", errors: ["gone"], staleSources: [], debris: DEBRIS },
    });
    const data = M.summaryWidgetData("health", down, "live", "percent", [], false);
    // The chip says the instruments are untrustworthy; the severity detail still
    // carries HOW badly, because that qualifies every reading beside it.
    expect(data.value).toBe("Readings degraded");
    expect(data.severityKey).toBe("blocking");
    expect(data.severityDetail).toContain("Focus and Send");
    /* Suppressing the wrong instruction must not leave none. Caught on the live
       board: the blocked card named the fault and stopped, which is the
       symptom-without-a-remedy this whole rewrite exists to remove. Every
       non-clear verdict carries a next step. */
    /* instrumentRemedy, not healthRemedy: the severity correction is the whole
       point. healthRemedy alone cannot know the control plane is down, so it
       still reports the debris — and offering THAT here is the exact
       wrong-fix-for-the-wrong-problem this test was written for. */
    expect(M.healthRemedy(down).instruction).toContain("cmux panes left over");
    const remedy = M.instrumentRemedy(down, "live", false);
    expect(remedy.instruction).not.toContain("cmux panes left over");
    expect(remedy.instruction).toBe("Start cmux, then Refresh — Focus and Send come back on their own.");
    expect(remedy.panes).toHaveLength(0);
    expect(M.healthRefreshAction({ snap: down, conn: "live", fetchFailed: false }))
      .toEqual({ label: "Verify repair", title: "Re-probe cmux after starting it" });
  });

  test("every non-clear verdict carries a next step", () => {
    // The card's contract in one assertion: if it claims something is wrong, it
    // must also say what to do. A clear board is the only one allowed to be silent.
    const stale = M.summaryWidgetData("health", snapshot(), "live", "percent", [], true);
    expect(stale.value).toBe("Readings degraded");
    expect(stale.severityKey).toBe("stale");

    const offline = M.summaryWidgetData("health", null, "offline", "percent", [], false);
    expect(offline.value).toBe("Readings unavailable");

    /* The next step still exists for both — it is rendered by the notification
       center's instrument block, which reaches it through healthRefreshAction. A
       claim that something is wrong with no way to act is the
       symptom-without-a-remedy this rewrite exists to remove; only WHERE the
       action lives changed. */
    expect(M.healthRefreshAction({ snap: snapshot(), conn: "live", fetchFailed: true }))
      .toEqual({ label: "Retry snapshot", title: "Re-pull the latest snapshot evidence" });
    expect(M.healthRefreshAction({ snap: null, conn: "offline", fetchFailed: false }))
      .toEqual({ label: "Retry snapshot", title: "Re-pull the latest snapshot evidence" });
  });

  test("the card never prints a generic blurb that argues with its own problem line", () => {
    /* The card used to headline "Degraded" and contradict itself one line down
       with an ADVISORY badge. The same trap reappears whenever the generic
       severity sentence prints beside a specific one: "The board is usable;
       evidence needs tidying." directly above "3 live sessions can't take
       commands." Only one of those can be true, so the specific one wins. */
    const blocked = agent({ id: "codex:live", activity: "idle", controlState: "quarantined" });
    const snap = snapshot({
      controlHealth: { cmuxReachable: true, lastCheckedAt: "x", errors: ["conflict"], staleSources: [] },
      issues: [{
        id: "system:cmux-identity-conflicts", kind: "system", severity: "error",
        title: "CMUX identity conflicts", summary: "conflicting evidence",
        affectedAgentIds: ["codex:live"],
      }],
      programs: [{ id: "p1", name: "p1", agents: [blocked] }],
    });
    const data = M.summaryWidgetData("health", snap, "live", "percent", [], false);
    // The advisory blurb is still available as the severity's own detail...
    expect(data.severityDetail).toContain("board is usable");
    // ...but the problem sentence is what the operator reads, and it disagrees.
    // It is rendered by the center's instrument block now, off the same remedy.
    expect(M.healthRemedy(snap).problem).toContain("1 live session");
  });
});
