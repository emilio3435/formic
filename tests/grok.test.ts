import { beforeAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectSessionProvider,
  finalizeSessionProviders,
  type SessionProviderResults,
} from "../src/server/collectors";
import { parseGrokSession } from "../src/server/grok";
import { loadModelConfig } from "../src/server/model-config";
import { PROVIDERS } from "../src/shared/types";

const FIXTURE = join(import.meta.dir, "fixtures/grok-session");
const ID = "01a0072a-1b2c-7d3e-8f40-123456789abc";
const PARENT_ID = "01a00dd7-337a-7a71-9d46-201d9c3dc4c1";
const OTHER_PARENT_ID = "01a00dd8-337a-7a71-9d46-201d9c3dc4c2";
const SAME_CWD_CHILD_ID = "01a00ddd-08ca-7e30-af54-9206017816a8";
const OTHER_CWD_CHILD_ID = "01a00dde-08ca-7e30-af54-9206017816a9";
const INVALID_PARENT_CHILD_ID = "01a00ddf-08ca-7e30-af54-9206017816aa";
const NOW = Date.parse("2026-08-15T20:02:30.000Z");

const fixture = (name: string): string => readFileSync(join(FIXTURE, name), "utf8");

describe("a Grok Build session becomes an agent", () => {
  test("summary, signals, and updates supply title, model, tokens, and messages", () => {
    const agent = parseGrokSession({
      sourceSessionId: ID,
      summaryJson: fixture("summary.json"),
      signalsJson: fixture("signals.json"),
      updatesJsonl: fixture("updates.jsonl"),
    }, { sourcePath: join(FIXTURE, "updates.jsonl"), nowMs: NOW });

    expect(agent).toMatchObject({
      id: `grok:${ID}`,
      provider: "grok",
      sourceSessionId: ID,
      displayName: "Ship the Grok Build collector",
      cwd: "/Users/ant/Developer/formic",
      model: "grok-4.6",
      task: "Add Grok Build to the board.",
      transcriptTail: "The Grok collector is wired and verified.",
      status: "running",
      tokens: {
        total: 12_345,
        contextWindow: 500_000,
        scope: "latest-turn",
        provenance: "observed",
      },
    });
    expect(agent?.identity?.authoredBy).toBe("grok-title");
    expect(agent?.lastUserMessage).toBe("Add Grok Build to the board.");
    expect(agent?.lastAgentMessage).toBe("The Grok collector is wired and verified.");
  });

  test("turn completion is end evidence until another user message arrives", () => {
    const ended = `${fixture("updates.jsonl")}\n${JSON.stringify({
      timestamp: 1786824150,
      method: "session/update",
      params: { update: { sessionUpdate: "turn_completed", stop_reason: "end_turn" } },
    })}`;
    const reopened = `${ended}\n${JSON.stringify({
      timestamp: 1786824180,
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "One more change." },
        },
      },
    })}`;
    const input = {
      sourceSessionId: ID,
      summaryJson: fixture("summary.json"),
      signalsJson: fixture("signals.json"),
    };

    expect(parseGrokSession({ ...input, updatesJsonl: ended }, { nowMs: NOW }))
      .toMatchObject({ status: "archived", endEvidence: "turn-complete" });
    expect(parseGrokSession({ ...input, updatesJsonl: reopened }, { nowMs: NOW }))
      .toMatchObject({ status: "running", endEvidence: undefined, task: "Add Grok Build to the board." });
  });

  test("each missing sibling withdraws only its own fields", () => {
    const fromSummary = parseGrokSession({
      sourceSessionId: ID,
      summaryJson: fixture("summary.json"),
    }, { nowMs: NOW });
    expect(fromSummary).toMatchObject({
      provider: "grok",
      displayName: "Ship the Grok Build collector",
      model: "grok-4.6",
      tokens: { provenance: "unknown" },
    });
    expect(fromSummary?.task).toBeUndefined();

    const fromUpdates = parseGrokSession({
      sourceSessionId: ID,
      cwd: "/Users/ant/Developer/formic",
      updatesJsonl: fixture("updates.jsonl"),
    }, { mtimeMs: NOW, nowMs: NOW });
    expect(fromUpdates).toMatchObject({
      provider: "grok",
      displayName: "Grok · formic",
      task: "Add Grok Build to the board.",
      tokens: { provenance: "unknown" },
    });
    expect(fromUpdates?.model).toBeUndefined();
  });
});

describe("the Grok collector follows the real nested layout", () => {
  test("an encoded-cwd/session-id directory is collected", async () => {
    const home = mkdtempSync(join(tmpdir(), "anthill-grok-home-"));
    const session = join(home, ".grok/sessions/%2FUsers%2Fant%2FDeveloper%2Fformic", ID);
    mkdirSync(session, { recursive: true });
    for (const name of ["summary.json", "signals.json", "updates.jsonl"]) {
      writeFileSync(join(session, name), fixture(name));
    }

    const result = await collectSessionProvider("grok", home, Number.POSITIVE_INFINITY);

    expect(result.errors).toEqual([]);
    expect(result.absent).toBeUndefined();
    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toMatchObject({
      provider: "grok",
      sourceSessionId: ID,
      displayName: "Ship the Grok Build collector",
      model: "grok-4.6",
    });
  });

  test("a session directory survives missing summary, signals, and updates", async () => {
    const home = mkdtempSync(join(tmpdir(), "anthill-grok-sparse-"));
    const session = join(home, ".grok/sessions/%2FUsers%2Fant%2FDeveloper%2Fformic", ID);
    mkdirSync(session, { recursive: true });

    const result = await collectSessionProvider("grok", home, Number.POSITIVE_INFINITY);

    expect(result.errors).toEqual([]);
    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toMatchObject({
      provider: "grok",
      sourceSessionId: ID,
      cwd: "/Users/ant/Developer/formic",
      tokens: { provenance: "unknown" },
    });
  });

  test("P-meta-parent: meta.json links same-cwd and cross-cwd children to their parent", async () => {
    const home = mkdtempSync(join(tmpdir(), "anthill-grok-meta-parent-"));
    const parentProject = join(home, ".grok/sessions/%2FUsers%2Fant%2FDeveloper%2Fformic");
    const childProject = join(home, ".grok/sessions/%2FUsers%2Fant%2FDeveloper%2Fchild");
    const parent = join(parentProject, PARENT_ID);
    const otherParent = join(childProject, OTHER_PARENT_ID);
    mkdirSync(join(parent, "subagents", SAME_CWD_CHILD_ID), { recursive: true });
    mkdirSync(join(parent, "subagents", OTHER_CWD_CHILD_ID), { recursive: true });
    mkdirSync(join(parent, "subagents", INVALID_PARENT_CHILD_ID), { recursive: true });
    mkdirSync(join(otherParent, "subagents", SAME_CWD_CHILD_ID), { recursive: true });
    mkdirSync(join(parentProject, SAME_CWD_CHILD_ID), { recursive: true });
    mkdirSync(join(childProject, OTHER_CWD_CHILD_ID), { recursive: true });
    mkdirSync(join(childProject, INVALID_PARENT_CHILD_ID), { recursive: true });
    writeFileSync(join(parent, "subagents", SAME_CWD_CHILD_ID, "meta.json"), JSON.stringify({
      parent_session_id: PARENT_ID,
      child_session_id: SAME_CWD_CHILD_ID,
    }));
    writeFileSync(join(parent, "subagents", OTHER_CWD_CHILD_ID, "meta.json"), JSON.stringify({
      parent_session_id: PARENT_ID,
      child_session_id: OTHER_CWD_CHILD_ID,
    }));
    writeFileSync(join(parent, "subagents", INVALID_PARENT_CHILD_ID, "meta.json"), JSON.stringify({
      parent_session_id: "not-a-session-uuid",
      child_session_id: INVALID_PARENT_CHILD_ID,
    }));
    writeFileSync(join(otherParent, "subagents", SAME_CWD_CHILD_ID, "meta.json"), JSON.stringify({
      parent_session_id: OTHER_PARENT_ID,
      child_session_id: SAME_CWD_CHILD_ID,
    }));

    const result = await collectSessionProvider("grok", home, Number.POSITIVE_INFINITY);
    const bySessionId = new Map(result.value.map((agent) => [agent.sourceSessionId, agent]));

    expect(result.errors).toEqual([]);
    expect(bySessionId.get(SAME_CWD_CHILD_ID)?.parentSourceSessionId).toBe(PARENT_ID);
    expect(bySessionId.get(OTHER_CWD_CHILD_ID)?.parentSourceSessionId).toBe(PARENT_ID);
    expect(bySessionId.get(INVALID_PARENT_CHILD_ID)?.parentSourceSessionId).toBeUndefined();
  });

  test("P-summary-wins: a subagent_resume summary parent wins over disagreeing meta.json", async () => {
    const home = mkdtempSync(join(tmpdir(), "anthill-grok-summary-parent-"));
    const project = join(home, ".grok/sessions/%2FUsers%2Fant%2FDeveloper%2Fformic");
    const child = join(project, SAME_CWD_CHILD_ID);
    const otherParent = join(project, OTHER_PARENT_ID);
    mkdirSync(join(project, PARENT_ID), { recursive: true });
    mkdirSync(join(otherParent, "subagents", SAME_CWD_CHILD_ID), { recursive: true });
    mkdirSync(child, { recursive: true });
    writeFileSync(join(child, "summary.json"), JSON.stringify({
      session_kind: "subagent_resume",
      parent_session_id: PARENT_ID,
    }));
    writeFileSync(join(otherParent, "subagents", SAME_CWD_CHILD_ID, "meta.json"), JSON.stringify({
      parent_session_id: OTHER_PARENT_ID,
      child_session_id: SAME_CWD_CHILD_ID,
    }));

    const result = await collectSessionProvider("grok", home, Number.POSITIVE_INFINITY);
    const childAgent = result.value.find((agent) => agent.sourceSessionId === SAME_CWD_CHILD_ID);

    expect(result.errors).toEqual([]);
    expect(childAgent?.parentSourceSessionId).toBe(PARENT_ID);
  });

  test("P-no-meta: an ordinary main without summary or metadata stays parent-less", async () => {
    const home = mkdtempSync(join(tmpdir(), "anthill-grok-no-parent-"));
    const session = join(home, ".grok/sessions/%2FUsers%2Fant%2FDeveloper%2Fformic", ID);
    mkdirSync(session, { recursive: true });

    const result = await collectSessionProvider("grok", home, Number.POSITIVE_INFINITY);

    expect(result.errors).toEqual([]);
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.parentSourceSessionId).toBeUndefined();
  });
});

describe("Grok hook and presentation contracts", () => {
  test("finalization attaches Grok hook facts instead of skipping them like Cursor", () => {
    const home = mkdtempSync(join(tmpdir(), "anthill-grok-hook-"));
    mkdirSync(join(home, ".cmuxterm"), { recursive: true });
    writeFileSync(join(home, ".cmuxterm/grok-hook-sessions.json"), JSON.stringify({
      sessions: {
        [ID]: {
          sessionId: ID,
          surfaceId: "GROK-SURFACE",
          workspaceId: "GROK-WORKSPACE",
          cwd: "/Users/ant/Developer/formic",
          pid: 4242,
          pidStartSeconds: 1786824000,
          agentLifecycle: "running",
          updatedAt: 1786824150,
        },
      },
    }));
    const agent = parseGrokSession({
      sourceSessionId: ID,
      summaryJson: fixture("summary.json"),
    }, { nowMs: NOW })!;
    const results = Object.fromEntries(PROVIDERS.map((provider) => [
      provider,
      { value: provider === "grok" ? [agent] : [], errors: [] },
    ])) as unknown as SessionProviderResults;

    const finalized = finalizeSessionProviders(results, home, {
      hookProcessStarts: () => new Map([[4242, 1786824000]]),
    });

    expect(finalized.grok.value[0]).toMatchObject({
      hookLifecycle: "running",
      processIds: [4242],
      processAlive: true,
    });
  });

  test("the shipped model config knows Grok 4.6 without pricing it", () => {
    const raw = JSON.parse(readFileSync(join(import.meta.dir, "../config/models.json"), "utf8"));
    const config = loadModelConfig(join(import.meta.dir, "../config/models.json"));

    expect(config.claudeContextWindows["grok-4.6"]).toBe(500_000);
    expect(config.modelFamilyAliases["grok-4.6"])
      .toEqual(["grok-4.6", "cursor-grok-4.6", "grok-build"]);
    expect(config.modelDisplayLabels["grok-4.6"]).toBe("grok 4.6");
    expect(raw.modelPricingUsdPerMillionTokens).not.toHaveProperty("grok-4.6");
  });
});

describe("the Grok harness stays distinct from its model badge", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let web: any;

  beforeAll(async () => {
    // @ts-expect-error the dependency-free browser client has no declaration file
    await import("../src/web/app.js");
    web = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
  });

  test("a Grok 4.6 model does not replace the Grok Build harness", () => {
    const row = { provider: "grok", model: "grok-4.6" };

    expect(web.harnessKeyOf(row)).toBe("grok");
    expect(web.HARNESS_MARK[web.harnessKeyOf(row)].label).toBe("Grok Build");
    expect(web.HARNESS_MARK.grok.src).toBe("/icons/xai.svg");
    expect(web.agentKeyOf(row)).toBe("grok");
    expect(web.AGENT_MARK.grok.src).toBe("/icons/grok.svg");
    expect(web.HARNESS_MARK.grok.src).not.toBe(web.AGENT_MARK.grok.src);
  });

  test("Cursor-hosted Grok remains a Cursor harness", () => {
    const row = { provider: "cursor", model: "cursor-grok-4.6-high" };

    expect(web.harnessKeyOf(row)).toBe("cursor");
    expect(web.agentKeyOf(row)).toBe("grok");
  });
});
