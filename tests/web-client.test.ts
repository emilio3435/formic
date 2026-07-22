import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/* app.js guards all DOM wiring behind a `typeof document` check and exposes its
   pure helpers on globalThis.TheAntHill, so importing it under Bun is safe. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let M: any;
let source = "";
let html = "";
let styles = "";

beforeAll(async () => {
  // @ts-expect-error The dependency-free browser client intentionally has no declaration file.
  await import("../src/web/app.js");
  M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
  source = readFileSync(join(import.meta.dir, "../src/web/app.js"), "utf8");
  html = readFileSync(join(import.meta.dir, "../src/web/index.html"), "utf8");
  styles = readFileSync(join(import.meta.dir, "../src/web/styles.css"), "utf8");
});

function agent(overrides: Record<string, unknown> = {}) {
  return {
    id: "codex:a1",
    provider: "codex",
    sourceSessionId: "a1",
    displayName: "Ridge worker",
    programId: "p1",
    status: "running",
    statusReason: "Streaming output.",
    updatedAt: "2026-07-22T03:00:00.000Z",
    tokens: { provenance: "observed", total: 1200 },
    artifacts: [],
    gates: [],
    target: { resolution: "exact", surfaceId: "s1", workspaceId: "w1" },
    controls: [],
    ...overrides,
  };
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-22T03:00:00.000Z",
    controlHealth: { cmuxReachable: true, lastCheckedAt: "", errors: [], staleSources: [] },
    totals: {
      live: 1, tracked: 1, attention: 0, working: 1, idle: 0, history: 0,
      sourceHealth: { healthy: 2, degraded: 0, total: 2 },
    },
    programs: [{ id: "p", name: "P", agents: [agent()] }],
    ...overrides,
  };
}

describe("summary status and widgets", () => {
  test("maps live connection, source, and control evidence to one system verdict", () => {
    const healthy = snapshot();
    expect(M.systemStatus(healthy, "live").label).toBe("Operational");
    expect(M.systemStatus(snapshot({ totals: { ...healthy.totals, sourceHealth: { healthy: 1, degraded: 1, total: 2 } } }), "live").label).toBe("Degraded");
    expect(M.systemStatus(snapshot({ controlHealth: { ...healthy.controlHealth, cmuxReachable: false } }), "live").label).toBe("Degraded");
    expect(M.systemStatus(healthy, "stale").label).toBe("Degraded");
    expect(M.systemStatus(null, "offline").label).toBe("Offline");
  });

  test("keeps the requested defaults, catalog, and persisted order valid", () => {
    expect(M.DEFAULT_WIDGET_IDS).toEqual(["system", "active-work", "attention", "context-peak", "source-health"]);
    expect(M.WIDGET_CATALOG.map((widget: { id: string }) => widget.id)).toEqual([
      "system", "active-work", "attention", "context-peak", "source-health",
      "waiting", "history", "model-policy", "routing-health", "context-reporting",
    ]);
    expect(M.WIDGET_STORAGE_KEY).toBe("mtn3-summary-widgets");
    expect(M.parseWidgetPreference(JSON.stringify(["system", "attention", "waiting"]))).toEqual(["system", "attention", "waiting"]);
    expect(M.parseWidgetPreference("not-json")).toEqual(M.DEFAULT_WIDGET_IDS);
    expect(M.normalizeWidgetIds(["attention", "system"])).toEqual(M.DEFAULT_WIDGET_IDS);
    expect(M.normalizeWidgetIds(["system", "attention", "attention"])).toEqual(M.DEFAULT_WIDGET_IDS);
  });

  test("reorders selectable widgets while keeping the system verdict pinned", () => {
    const defaults = M.DEFAULT_WIDGET_IDS;
    expect(M.reorderWidgetIds(defaults, "attention", -1)).toEqual([
      "system", "attention", "active-work", "context-peak", "source-health",
    ]);
    expect(M.reorderWidgetIds(defaults, "system", 1)).toEqual(defaults);
    expect(M.reorderWidgetIds(["system", "attention", "waiting"], "waiting", -1)).toEqual([
      "system", "waiting", "attention",
    ]);
  });

  test("counts active interventions and advisories once in Attention", () => {
    const snap = snapshot({
      issues: [
        { id: "system:1", kind: "system", severity: "error", title: "Control failure", summary: "s", affectedAgentIds: [] },
        { id: "system:2", kind: "system", severity: "warning", title: "Stale source", summary: "s", affectedAgentIds: [] },
      ],
    });
    expect(M.attentionSummary(snap)).toEqual({ count: 2, interventions: 1, advisories: 1 });
    expect(M.summaryWidgetData("attention", snap)).toMatchObject({ value: "2", unit: "findings" });
  });

  test("uses explicit No data values when optional evidence is absent", () => {
    const absent = snapshot({
      totals: { live: 1, tracked: 1, attention: 0, working: 1, idle: 0, history: 0 },
      controlHealth: undefined,
    });
    for (const id of ["context-peak", "source-health", "model-policy", "routing-health", "context-reporting"]) {
      expect(M.summaryWidgetData(id, absent).value, id).toBe("No data");
      expect(M.summaryWidgetData(id, absent).sublabel, id).toBeTruthy();
    }
    expect(M.summaryWidgetData("active-work", null).value).toBe("No data");
    expect(M.summaryWidgetData("system", null, "offline").value).toBe("Offline");
  });
});

describe("state derivations fall back from provider-native status", () => {
  test("legacy statuses map to the provider-neutral language", () => {
    expect(M.deriveActivity(agent({ status: "running" }))).toBe("working");
    expect(M.deriveActivity(agent({ status: "waiting" }))).toBe("idle");
    expect(M.deriveActivity(agent({ status: "attention" }))).toBe("idle");
    expect(M.deriveActivity(agent({ status: "stale" }))).toBe("ended");
    expect(M.deriveActivity(agent({ status: "archived" }))).toBe("ended");
  });

  test("a completed Cursor turn (waiting) is Idle/Healthy, not a warning", () => {
    const cursorDone = agent({ provider: "cursor", status: "waiting" });
    expect(M.deriveActivity(cursorDone)).toBe("idle");
    expect(M.deriveOutcome(cursorDone)).toBe("healthy");
  });

  test("attention maps to needs-you; ended sessions stop being outcome problems", () => {
    expect(M.deriveOutcome(agent({ status: "attention" }))).toBe("needs-you");
    expect(M.deriveOutcome(agent({ status: "archived" }))).toBe("healthy");
  });

  test("backend-provided fields always win over the fallback", () => {
    const a = agent({ status: "waiting", activity: "working", outcome: "blocked", controlState: "quarantined" });
    expect(M.deriveActivity(a)).toBe("working");
    expect(M.deriveOutcome(a)).toBe("blocked");
    expect(M.deriveControlState(a)).toBe("quarantined");
  });

  test("control state derives from routing evidence when absent", () => {
    expect(M.deriveControlState(agent())).toBe("linked");
    expect(M.deriveControlState(agent({ target: { resolution: "ambiguous" } }))).toBe("quarantined");
    expect(M.deriveControlState(agent({ target: { resolution: "missing" } }))).toBe("observed-only");
    expect(M.deriveControlState(agent({ status: "archived" }))).toBe("observed-only");
  });
});

describe("provider-aware row summaries", () => {
  test("uses the sanitized snapshot field and never falls back to technical transcript text", () => {
    const value = agent({
      lastHumanMessage: "Readable review result.",
      transcriptTail: "diff --git a/src/server/identity.ts b/src/server/identity.ts",
      statusReason: "Tool result: /Users/me/the-mountain/src/server/identity.ts",
    });

    expect(M.rowSummary(value)).toBe("Readable review result.");
    expect(M.rowSummary(value)).not.toContain("diff --git");
    expect(M.rowSummary(value)).not.toContain("identity.ts");
  });

  test("renders explicit absence instead of inventing a message from the transcript", () => {
    expect(M.formatLastHumanMessage(agent({ lastHumanMessage: null, transcriptTail: "tool output" })))
      .toBe("No readable message yet");
    expect(M.formatLastHumanMessage(agent())).toBe("No readable message yet");
  });

  test("keeps the raw transcript tail in Technical inspector markup only", () => {
    const overview = source.match(/function renderOverview\([\s\S]*?\n}\n\nfunction renderSwarmSection/)?.[0] || "";
    const technical = source.match(/function renderTechnical\([\s\S]*?\n}\n\nfunction renderTarget/)?.[0] || "";
    expect(overview).not.toContain("transcriptTail");
    expect(technical).toContain("transcriptTail");
  });
});

describe("views split Now from History", () => {
  test("Now is active work only; Idle and History remain explicit views", () => {
    const live = agent({ status: "running" });
    const idle = agent({ status: "waiting" });
    const done = agent({ status: "archived" });
    expect(M.viewMatches("now", live)).toBe(true);
    expect(M.viewMatches("now", idle)).toBe(false);
    expect(M.viewMatches("now", agent({ status: "waiting", outcome: "needs-you" }))).toBe(true);
    expect(M.viewMatches("now", done)).toBe(false);
    expect(M.viewMatches("history", live)).toBe(false);
    expect(M.viewMatches("history", done)).toBe(true);
  });

  test("Needs you contains only live unhealthy sessions", () => {
    expect(M.viewMatches("needs-you", agent({ status: "attention" }))).toBe(true);
    expect(M.viewMatches("needs-you", agent({ status: "running" }))).toBe(false);
    expect(M.viewMatches("needs-you", agent({ status: "archived", outcome: "failed" }))).toBe(false);
    expect(M.viewMatches("working", agent({ status: "running" }))).toBe(true);
    expect(M.viewMatches("idle", agent({ status: "waiting" }))).toBe(true);
  });
});

describe("program rollups", () => {
  test("server rollup is used verbatim when present", () => {
    const rollup = { total: 9, live: 3, working: 2, idle: 1, ended: 6, needsYou: 1, blocked: 0, failed: 0, linked: 2 };
    expect(M.programRollup({ id: "p", name: "P", agents: [], rollup })).toBe(rollup);
  });

  test("fallback rollup counts derived states", () => {
    const agents = [
      agent({ id: "1", status: "running" }),
      agent({ id: "2", status: "attention", target: { resolution: "missing" } }),
      agent({ id: "3", status: "archived" }),
    ];
    const r = M.deriveRollup(agents);
    expect(r).toMatchObject({ total: 3, live: 2, working: 1, idle: 1, ended: 1, needsYou: 1, linked: 1 });
  });
});

describe("swarm clusters", () => {
  test("children group under their orchestrator; orphans stay at top level", () => {
    const parent = agent({ id: "codex:p" });
    const child = agent({ id: "codex:c", parentAgentId: "codex:p" });
    const orphan = agent({ id: "codex:o", parentAgentId: "codex:gone" });
    const { roots, children } = M.buildClusters([parent, child, orphan]);
    expect(roots.map((a: { id: string }) => a.id)).toEqual(["codex:p", "codex:o"]);
    expect(children.get("codex:p").map((a: { id: string }) => a.id)).toEqual(["codex:c"]);
  });
});

describe("token honesty", () => {
  test("unavailable Cursor usage renders as not reported, never invented", () => {
    const s = M.tokenSummary({ provenance: "unknown" });
    expect(s.known).toBe(false);
    expect(s.text).toBe("not reported");
    expect(s.title).toContain("unknown");
  });

  test("observed and estimated totals are formatted and marked", () => {
    expect(M.tokenSummary({ provenance: "observed", total: 1_500_000 }).text).toBe("1.5M tokens");
    expect(M.tokenSummary({ provenance: "estimated", total: 2000 }).text).toBe("≈2k tokens");
  });

  test("totals expose reporting coverage instead of inventing numbers", () => {
    const t = M.totalsOf({
      programs: [],
      totals: { live: 5, tracked: 10, attention: 0, tokenReporting: 3, tokenEligible: 5 },
    });
    expect(t.tokenReporting).toBe(3);
    expect(t.tokenEligible).toBe(5);
    expect(t.tokens).toBeUndefined();
  });
});

describe("latest-turn token semantics", () => {
  test("latest-turn usage is labeled as the latest call, not session usage", () => {
    const s = M.tokenSummary({ provenance: "observed", scope: "latest-turn", total: 42_000, input: 40_000, output: 2000 });
    expect(s.label).toBe("latest call");
    expect(s.text).toBe("42k tokens");
    expect(s.title).toContain("latest model call");
  });

  test("legacy tokens without a scope keep the neutral label", () => {
    expect(M.tokenSummary({ provenance: "observed", total: 1200 }).label).toBe("tokens");
    expect(M.tokenSummary(undefined).label).toBe("tokens");
  });

  test("context usage reports capacity honestly and only when available", () => {
    const ctx = M.contextUsage({ provenance: "observed", scope: "latest-turn", total: 50_000, contextWindow: 200_000 });
    expect(ctx.pct).toBe(25);
    expect(ctx.text).toBe("50k of 200k (25%)");
    expect(M.contextUsage({ provenance: "observed", total: 50_000 })).toBeNull();
    expect(M.contextUsage({ provenance: "estimated", scope: "latest-turn", total: 50_000, contextWindow: 200_000 })).toBeNull();
    expect(M.contextUsage({ provenance: "observed", scope: "session", total: 50_000, contextWindow: 200_000 })).toBeNull();
    expect(M.contextUsage({ provenance: "observed", scope: "latest-turn", total: 250_000, contextWindow: 200_000 })).toEqual({ pct: 100, text: "250k of 200k (125%)" });
    expect(M.contextUsage({ provenance: "observed", contextWindow: 200_000 })).toBeNull();
    expect(M.contextUsage(undefined)).toBeNull();
  });

  test("context display switches between percentage and readable token capacity", () => {
    const tokens = { provenance: "observed", scope: "latest-turn", total: 50_000, contextWindow: 200_000 };
    expect(M.contextDisplayValue(tokens, "percent")).toBe("25%");
    expect(M.contextDisplayValue(tokens, "tokens")).toBe("50k / 200k");
    expect(M.contextDisplayValue({ provenance: "unknown" }, "percent")).toBe("not reported");
  });

  test("role aliases resolve to stable visual role categories", () => {
    expect(M.roleView("orchestration")).toEqual({ key: "orchestrator", label: "Orchestrator" });
    expect(M.roleView("designer")).toEqual({ key: "frontend", label: "Frontend / designer" });
    expect(M.roleView("implementer")).toEqual({ key: "backend", label: "Backend implementer" });
    expect(M.roleView("qa")).toEqual({ key: "tester", label: "Tester" });
    expect(M.roleView("unknown lane")).toEqual({ key: "agent", label: "Agent" });
  });
});

describe("typical request (header token truth)", () => {
  test("prefers the server-reported totals.tokenMedian", () => {
    const snap = {
      programs: [{ id: "p", name: "P", agents: [agent({ tokens: { provenance: "observed", scope: "latest-turn", total: 9_000_000 } })] }],
      totals: { tokenMedian: 12_000 },
    };
    expect(M.typicalRequestOf(snap)).toEqual({ value: 12_000, source: "reported" });
  });

  test("falls back to the median of live latest-turn totals", () => {
    const snap = {
      programs: [{
        id: "p", name: "P",
        agents: [
          agent({ id: "1", tokens: { provenance: "observed", scope: "latest-turn", total: 10_000 } }),
          agent({ id: "2", tokens: { provenance: "observed", scope: "latest-turn", total: 30_000 } }),
          agent({ id: "3", status: "archived", tokens: { provenance: "observed", scope: "latest-turn", total: 900_000 } }),
          agent({ id: "4", tokens: { provenance: "observed", total: 700_000 } }), // session-scoped: excluded
          agent({ id: "5", tokens: { provenance: "unknown" } }),
        ],
      }],
    };
    expect(M.typicalRequestOf(snap)).toEqual({ value: 20_000, source: "derived" });
  });

  test("reports nothing when no live session reports latest-turn usage", () => {
    const snap = { programs: [{ id: "p", name: "P", agents: [agent({ tokens: { provenance: "unknown" } })] }] };
    expect(M.typicalRequestOf(snap)).toBeNull();
  });
});

describe("Cursor model policy", () => {
  test("current and legacy states map to Compliant / Model mismatch / Model unreported", () => {
    expect(M.modelPolicyView(agent({ modelPolicy: { state: "compliant" } })).label).toBe("Compliant");
    expect(M.modelPolicyView(agent({ modelPolicy: { state: "mismatch", expected: "grok" } })).label).toBe("Model mismatch");
    expect(M.modelPolicyView(agent({ modelPolicy: { state: "violation", expected: "grok" } })).state).toBe("mismatch");
    expect(M.modelPolicyView(agent({ modelPolicy: { state: "unreported" } })).label).toBe("Model unreported");
    expect(M.modelPolicyView(agent({ modelPolicy: { state: "unverified" } })).state).toBe("unreported");
  });

  test("unknown is neither compliant nor a violation", () => {
    expect(M.modelPolicyView(agent())).toBeNull();
    const unreported = M.modelPolicyView(agent({ modelPolicy: { state: "unreported" } }));
    expect(unreported.state).toBe("unreported");
    expect(unreported.summary).toContain("cannot be verified");
    expect(M.modelPolicyView(agent({ modelPolicy: { state: "definitely-fine" } }))).toBeNull();
  });

  test("totals pass through tokenMedian, aggregate tokens, and cursorModelHealth", () => {
    const totals = {
      live: 33, tracked: 427, working: 8, idle: 25, history: 394, attention: 0,
      tokenReporting: 8, tokenEligible: 8, tokenMedian: 170_912, tokens: 1_223_880,
      cursorModelHealth: { compliant: 2, mismatch: 0, unreported: 4, total: 6 },
    };
    const t = M.totalsOf({ programs: [], totals });
    expect(t.tokenMedian).toBe(170_912);
    expect(t.tokens).toBe(1_223_880);
    expect(t.cursorModelHealth).toEqual(totals.cursorModelHealth);
  });

  test("fleet policy glance: zero active mismatches is calm, any mismatch is hot", () => {
    const calm = M.cursorPolicyParts({ compliant: 2, mismatch: 0, unreported: 4, total: 6 });
    expect(calm.map((p: { text: string }) => p.text)).toEqual(["0 mismatches", "2 compliant", "4 unreported"]);
    expect(calm[0].tone).toBe("ok");
    const hot = M.cursorPolicyParts({ compliant: 1, mismatch: 1, unreported: 0, total: 2 });
    expect(hot[0]).toEqual({ text: "1 mismatch", tone: "bad" });
    expect(M.cursorPolicyParts(undefined)).toBeNull();
    expect(M.cursorPolicyParts({ compliant: 0, mismatch: 0, unreported: 0, total: 0 })).toBeNull();
  });

  test("fallback issues surface live violations for Needs you", () => {
    const snap = {
      programs: [{
        id: "p", name: "P",
        agents: [
          agent({ id: "v", provider: "cursor", modelPolicy: { state: "mismatch", expected: "grok", summary: "Reported model is gpt-5." } }),
          agent({ id: "done", status: "archived", modelPolicy: { state: "mismatch" } }),
          agent({ id: "ok", provider: "cursor", modelPolicy: { state: "compliant" } }),
        ],
      }],
      controlHealth: { cmuxReachable: true, lastCheckedAt: "", errors: [], staleSources: [] },
    };
    const issues = M.issuesOf(snap);
    const policy = issues.filter((i: { kind: string }) => i.kind === "policy");
    expect(policy).toHaveLength(1);
    expect(policy[0].severity).toBe("error");
    expect(policy[0].affectedAgentIds).toEqual(["v"]);
    expect(policy[0].summary).toContain("Expected: grok");
  });
});

describe("issues", () => {
  test("normalized server issues pass through untouched", () => {
    const issues = [{ id: "system:x", kind: "system", severity: "error", title: "t", summary: "s", affectedAgentIds: [] }];
    expect(M.issuesOf({ programs: [], issues })).toBe(issues);
  });

  test("fallback surfaces collector errors as a system issue even with zero attention agents", () => {
    const snap = {
      programs: [{ id: "p", name: "P", agents: [agent()] }],
      controlHealth: { cmuxReachable: true, lastCheckedAt: "", errors: ["boom"], staleSources: [] },
    };
    const issues = M.issuesOf(snap);
    expect(issues.some((i: { kind: string }) => i.kind === "system")).toBe(true);
    expect(issues[0].technicalDetails).toEqual(["boom"]);
  });

  test("issue lifecycle labels keep verification and source-confirmed resolution distinct", () => {
    const verifying = {
      id: "system:verification",
      kind: "system",
      severity: "error",
      title: "Identity conflict",
      summary: "Source still reports the conflict.",
      affectedAgentIds: [],
      lifecycle: { state: "verifying", openedAt: "2026-07-22T05:00:00.000Z", verificationStartedAt: "2026-07-22T05:01:00.000Z" },
    };
    const resolved = {
      ...verifying,
      lifecycle: { state: "resolved", openedAt: verifying.lifecycle.openedAt, resolvedAt: "2026-07-22T05:02:00.000Z", result: "Fresh source evidence is clear." },
    };
    expect(M.issueStateLabel(verifying)).toBe("Verifying");
    expect(M.issueStateLabel(resolved)).toBe("Resolved");
    expect(M.issuesOf({ programs: [], issues: [verifying] })[0].lifecycle.state).toBe("verifying");
    expect(M.recentlyResolvedOf({ programs: [], recentlyResolved: [resolved] })).toEqual([resolved]);
  });
});

describe("search", () => {
  test("matches across name, role, provider, model, status, cwd, and transcript", () => {
    const a = agent({
      role: "verifier", model: "gpt-5.6-sol", cwd: "/Users/emilio/Developer/the-mountain",
      transcriptTail: "All checks passed on ridge-7.", nickname: "Scout",
    });
    const program = { id: "p", name: "The Mountain" };
    for (const q of ["scout", "verifier", "codex", "sol", "working", "the-mountain", "ridge-7", "mountain"]) {
      expect(M.matchesQuery(a, program, q)).toBe(true);
    }
    expect(M.matchesQuery(a, program, "zzz-nope")).toBe(false);
  });
});

describe("stable-feed elapsed clocks", () => {
  test("live sessions get a ticking clock; ended sessions freeze", () => {
    const generatedAt = new Date(Date.now() - 5000).toISOString();
    const live = M.elapsedDataset(agent({ elapsedMs: 60_000 }), generatedAt);
    expect(live.elapsedBase).toBe("60000");
    expect(live.elapsedFrom).toBe(generatedAt);
    const done = M.elapsedDataset(agent({ status: "archived", elapsedMs: 60_000 }), generatedAt);
    expect(done).toEqual({});
    expect(M.liveElapsedText(agent({ status: "archived", elapsedMs: 60_000 }), generatedAt)).toBe("60s");
  });
});

describe("unavailable-control explanation stays plain-language", () => {
  test("messages come from control state and never carry raw routing IDs", () => {
    const quarantined = M.controlUnavailableText("quarantined");
    const observed = M.controlUnavailableText("observed-only");
    expect(quarantined).toContain("identity is ambiguous");
    expect(observed).toContain("no safe cmux target is linked");
    for (const msg of [quarantined, observed]) {
      expect(msg).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i); // no UUID fragments
      expect(msg).not.toMatch(/ttys|workspace:|surface/); // no cmux identifiers
    }
  });

  test("renderPrimaryActions never echoes capability reasons in the Overview", () => {
    const fn = source.match(/function renderPrimaryActions\(agent\) \{[\s\S]*?\n\}/)?.[0];
    expect(fn).toBeDefined();
    expect(fn).toContain("controlUnavailableText(deriveControlState(agent))");
    expect(fn).not.toContain(".reason");
  });
});

describe("broadcast recipient eligibility", () => {
  test("only live, instruct-capable sessions are eligible", () => {
    const live = agent({ status: "running", controls: [{ action: "instruct", enabled: true }] });
    expect(M.broadcastEligible(live)).toBe(true);
  });

  test("ended, observed-only, and instruction-less sessions are never eligible", () => {
    expect(M.broadcastEligible(agent({ status: "archived", controls: [{ action: "instruct", enabled: true }] }))).toBe(false);
    expect(M.broadcastEligible(agent({ status: "running", controls: [{ action: "instruct", enabled: false, reason: "Observed only." }] }))).toBe(false);
    expect(M.broadcastEligible(agent({ status: "running", controls: [{ action: "focus", enabled: true }] }))).toBe(false);
    expect(M.broadcastEligible(agent({ status: "running", controls: [] }))).toBe(false);
  });
});

describe("redesigned network contracts (source-level)", () => {
  test("program rename is presentation-only via GET/POST /api/program-aliases", () => {
    expect(source).toContain('fetch("/api/program-aliases"');
    expect(source).toContain("function programName(program)");
    expect(source).toContain("state.aliases");
    // the source program id stays stable — the alias is a display label only
    expect(source).toContain("id stays ");
  });

  test("labels hydrate from the existing loopback path and submit stable target payloads", () => {
    expect(source).toContain("async function fetchLabels()");
    expect(source).toContain("state.labelsLoading");
    expect(source).toContain("state.labelsLoaded");
    expect(source).toContain("body.labels");
    expect(source).toContain("JSON.stringify({ target, label })");
    expect(source).toContain("reset");
    expect(source).toContain('fetchLabels();');
  });

  test("program labels use semantic keyboard controls with a caret that only expands", () => {
    const fn = source.match(/function renderProgram\(program, agents\) \{[\s\S]*?\n\}/)?.[0];
    expect(fn).toBeDefined();
    expect(fn).toContain('el("div", { class: "program-head" }');
    expect(fn).toContain('class: "program-caret"');
    expect(fn).toContain('class: "program-label"');
    expect(fn).toContain('onclick: () => toggleProgram(program)');
    expect(fn).not.toContain('role: "button"');
    expect(source).toContain('onkeydown: (e) => { if (e.key === "Escape")');
    expect(source).toContain('type: "submit"');
  });

  test("unnamed child naming is a text action and source identities remain visible", () => {
    expect(source).toContain('agentLabelEligible = (agent) => Boolean(agent && agent.parentAgentId && !agent.nickname)');
    expect(source).toContain('text: "Source agent: " + sourceAgentName(agent)');
    expect(source).toContain('const actionText = label ? "Edit" : item.kind === "agent" ? "Name agent"');
    const row = source.match(/function renderAgentRow\(agent, program, opts = \{\}\) \{[\s\S]*?\n\}/)?.[0];
    expect(row).toBeDefined();
    expect(row).not.toContain("Name agent");
    expect(row).toContain('return el("button"');
  });

  test("broadcast posts only eligible recipients and never fabricates delivery", () => {
    expect(source).toContain('fetch("/api/broadcast"');
    expect(source).toContain("agentIds: eligible.map");
    expect(source).toContain("broadcastEligible");
    // explicit confirmation gate before sending
    expect(source).toContain("broadcastConfirming");
    // honest per-recipient results, not a blanket success
    expect(source).toContain("state.broadcastResults");
  });
});

describe("calm program and agent list rendering", () => {
  test("the message lane is additive and falls back to the existing summary", () => {
    const message = "Review the responsive control room layout across desktop and mobile widths.";
    expect(M.rowSummary(agent({ lastHumanMessage: message }))).toContain("Review the responsive control room layout");
    expect(M.rowSummary(agent({ lastHumanMessage: "   " }))).toBe("Streaming output.");
  });

  test("program lists share the five primary columns and keep secondary details out of the row grid", () => {
    expect(source).toContain("function renderAgentColumnHeader()");
    expect(source).toContain("return [renderAgentColumnHeader(), ...rows]");
    for (const label of ["Status", "Agent/message", "Model", "Context", "Access"]) {
      expect(source).toContain(`text: "${label}"`);
    }
    expect(source).not.toContain('rowFact("Effort"');
    expect(source).not.toContain("class: \"fact-age\"");
    expect(styles).toContain(".agent-column-header");
    expect(styles).toContain("-webkit-line-clamp: 3");
  });

  test("selected rows retain an accessible full-text inspector path", () => {
    expect(source).toContain("Select to open the full message and session details in the inspector.");
    expect(source).toContain('text: "Last human message"');
    expect(source).toContain('class: "last-human-message"');
    expect(source).toContain('dtdd(grid, "effort", agent.effort)');
    expect(styles).toContain("white-space: pre-wrap");
    expect(styles).toContain("min-height: 44px");
  });
});

describe("source hygiene", () => {
  test("no literal control bytes in the client source", () => {
    // eslint-disable-next-line no-control-regex
    expect(source).not.toMatch(new RegExp("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f]"));
  });

  test("meters use SVG geometry, never inline style, so the CSP holds", () => {
    // style-src 'self' forbids inline style attributes: no `style:` props at all.
    expect(source).not.toMatch(/\bstyle:\s*`/);
    expect(source).not.toContain("width:${");
    expect(source).toContain("function svgMeter(");
    expect(source).toContain("createElementNS");
    expect(source).toContain("function icon(");
  });

  test("the redesigned control surface exposes its structural anchors", () => {
    for (const id of ["health-rail", "filter-bar", "select-toggle", "broadcast-bar",
      "interventions-list", "warnings-list", "nest-beacon", "health-widgets", "customize-summary",
      "widget-customizer", "widget-options", "widget-reset"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain(">Interventions</h2>");
    expect(html).toContain(">Alerts<span");
    expect(source).toContain("function renderWidgetCustomizer()");
    expect(source).toContain("onchange: (event) => setWidgetEnabled");
    expect(source).toContain('aria-label": `Move ${widget.label} up`');
    expect(html).not.toContain('class="colony"');
    expect(html).not.toContain('class="trail"');
    expect(html).not.toMatch(/class="ant /);
    expect(html).toContain('id="filter-bar" aria-label="Filters" hidden');
    expect(styles).not.toContain("@keyframes forage");
    expect(styles).not.toMatch(/\.colony\b/);
    expect(source).not.toContain('text: "Call tokens"');
    expect(source).not.toContain('+ " tok"');
  });

  test("reduced motion still disables the remaining interface transitions", () => {
    const reduced = styles.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(reduced).toContain("animation: none");
    expect(reduced).toContain("transition: none");
  });

  test("base type stays readable and the parchment slop layer is gone", () => {
    expect(styles).toMatch(/body\s*\{[\s\S]*?font-size:\s*16px/);
    expect(styles).not.toContain("background-image: url");
  });

  test("summary customization has a touch-sized mobile layout", () => {
    const mobile = styles.match(/@media \(max-width: 720px\)\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(mobile).toContain(".rail-inner { grid-template-columns: 1fr 1fr");
    expect(mobile).toContain(".widget-options { grid-template-columns: 1fr; }");
    expect(mobile).toContain(".widget-option { min-height: 2.8rem; }");
    expect(mobile).toContain(".widget-move { width: 2.75rem; height: 2.75rem; }");
    expect(styles).toContain(".widget-move");
  });

  test("interventions separate recommendation, queueing, and explicit read-only launch", () => {
    expect(source).toContain('fetch("/api/triage/" + action');
    expect(source).toContain('"Generate triage"');
    expect(source).toContain('"Queue investigation"');
    expect(source).toContain('"Launch read-only Luna"');
    expect(source).toContain("Launch remains a separate operator action.");
    expect(source).not.toMatch(/\/api\/triage\/(spawn|execute)/);
    expect(source).toContain("source confirmation pending");
    expect(source).toContain("waiting for a fresh source snapshot to clear the finding");
    expect(source).toContain("await fetchSnapshot()");
    expect(source).toContain("recentlyResolved");
  });
});

describe("fail-loud control invariants (source-level)", () => {
  test("interrupt and archive require explicit confirmation", () => {
    expect(source).toContain('const NEEDS_CONFIRM = new Set(["interrupt", "archive"])');
  });

  test("HTTP completion alone is never treated as control success", () => {
    expect(source).toContain("HTTP completion alone is never success.");
    expect(source).toContain('typeof body.ok === "boolean"');
  });

  test("no dynamic content flows through innerHTML", () => {
    expect(source).not.toMatch(/\.innerHTML\s*=/);
  });

  test("cost stays honest when unreported", () => {
    expect(source).toContain('absent: "not reported"');
    expect(source).toContain("agent.cost.currency");
    expect(source).toContain("agent.cost.provenance");
  });
});
