import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { collectSessionProvider } from "../src/server/collectors";
import { unmodelledProviders } from "../src/server/burnbar";
import { buildSnapshot } from "../src/server/snapshot";
import {
  collectHermesSpendSources,
  parseHermesJsonl,
} from "../src/server/hermes";
import type { ArchiveStore, SpendSource } from "../src/server/types";
import { textOf, withDom } from "./helpers/fake-dom";

let client: any;
const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };

beforeAll(async () => {
  // @ts-expect-error The dependency-free browser client intentionally has no declaration file.
  await import("../src/web/app.js");
  client = (globalThis as { TheAntHill?: unknown }).TheAntHill;
});

const sessionRows = [
  {
    role: "system",
    model: "gpt-5.4",
    platform: "terminal",
    timestamp: "2026-08-15T14:00:00.000Z",
    tools: [],
  },
  {
    role: "user",
    content: "Audit the Hermes scheduler.",
  },
  {
    role: "assistant",
    content: "The scheduler audit is complete.",
  },
];

const sessionJsonl = sessionRows.map((row) => JSON.stringify(row)).join("\n");

describe("Hermes interactive sessions", () => {
  test("the characterized JSONL shape becomes a Hermes agent row", () => {
    const agent = parseHermesJsonl(sessionJsonl, {
      sourcePath: "/Users/ant/.hermes/sessions/20260815_140000_deadbeef.jsonl",
      mtimeMs: Date.parse("2026-08-15T14:01:00.000Z"),
    });

    expect(agent).toMatchObject({
      id: "hermes:20260815_140000_deadbeef",
      provider: "hermes",
      sourceSessionId: "20260815_140000_deadbeef",
      model: "gpt-5.4",
      task: "Audit the Hermes scheduler.",
      startedAt: "2026-08-15T14:00:00.000Z",
      updatedAt: "2026-08-15T14:01:00.000Z",
    });
    expect(agent?.identity?.name).toBeTruthy();
    expect(agent?.tokens.provenance).toBe("unknown");
    expect(agent?.lastUserMessage).toBe("Audit the Hermes scheduler.");
    expect(agent?.lastAgentClosing).toBe("The scheduler audit is complete.");
    expect(agent?.status).not.toBeUndefined();
  });

  test("an assistant question is the closing, not the kickoff", () => {
    const agent = parseHermesJsonl([
      { role: "user", content: "Port the rate limiter.", timestamp: "2026-08-15T14:00:00.000Z" },
      { role: "assistant", content: "Should I land this now?", timestamp: "2026-08-15T14:00:30.000Z" },
    ].map((row) => JSON.stringify(row)).join("\n"), {
      sourcePath: "/Users/ant/.hermes/sessions/ask-session.jsonl",
      nowMs: Date.parse("2026-08-15T14:00:31.000Z"),
    });
    expect(agent?.lastAgentClosing).toBe("Should I land this now?");
    expect(agent?.lastUserMessage).toBe("Port the rate limiter.");
    expect(agent?.status).toBe("running");
  });

  test("the sessions directory is collected while request dumps remain excluded", async () => {
    const home = mkdtempSync(join(tmpdir(), "anthill-hermes-session-"));
    const sessions = join(home, ".hermes/sessions");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(join(sessions, "20260815_140000_deadbeef.jsonl"), sessionJsonl);
    writeFileSync(join(sessions, "request_dump_cron_daily-watcher-001.json"), JSON.stringify({
      session_id: "cron_daily-watcher-001",
      messages: [{ role: "user", content: "not an interactive row" }],
    }));

    const result = await collectSessionProvider("hermes", home, 365 * 24 * 60 * 60 * 1_000);

    expect(result.errors).toEqual([]);
    expect(result.absent).toBeUndefined();
    expect(result.value.map((agent) => agent.id)).toEqual(["hermes:20260815_140000_deadbeef"]);
  });
});

describe("Hermes cron spend", () => {
  test("a cron fixture becomes a spend source with observed usage", async () => {
    const home = mkdtempSync(join(tmpdir(), "anthill-hermes-cron-"));
    const cron = join(home, ".hermes/cron");
    mkdirSync(join(cron, "output/cron_daily-watcher-001"), { recursive: true });
    writeFileSync(join(cron, "jobs.json"), JSON.stringify({
      updated_at: "2026-08-15T14:02:00.000Z",
      jobs: [{
        id: "cron_daily-watcher-001",
        name: "Daily watcher",
        last_run_at: "2026-08-15T14:01:00.000Z",
      }],
    }));
    writeFileSync(join(cron, "usage_audit.jsonl"), [
      { ts: "2026-08-15T13:01:00.000Z", job_id: "cron_daily-watcher-001", prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      { ts: "2026-08-15T14:01:00.000Z", job_id: "cron_daily-watcher-001", prompt_tokens: 200, completion_tokens: 50, total_tokens: 250 },
    ].map((row) => JSON.stringify(row)).join("\n"));
    writeFileSync(join(cron, "output/cron_daily-watcher-001/2026-08-15_14-01-00.md"), "# Cron Job: Daily watcher\n");
    writeFileSync(join(cron, "ticker_heartbeat"), "1786802460.0\n");
    writeFileSync(join(cron, "ticker_last_success"), "1786802460.0\n");

    const result = await collectHermesSpendSources(home);

    expect(result.errors).toEqual([]);
    expect(result.value).toEqual([{
      id: "hermes:cron:cron_daily-watcher-001",
      provider: "hermes",
      kind: "cron",
      label: "Daily watcher",
      lastRunAt: "2026-08-15T14:01:00.000Z",
      tokens: {
        input: 300,
        output: 70,
        total: 370,
        provenance: "observed",
      },
    }]);
  });

  test("an output-only job uses file evidence for its last run", async () => {
    const home = mkdtempSync(join(tmpdir(), "anthill-hermes-cron-output-"));
    const output = join(home, ".hermes/cron/output/orphan-job/2026-08-15_14-01-00.md");
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, "# Cron Job: Orphan job\n");
    const ranAt = new Date("2026-08-15T14:01:00.000Z");
    utimesSync(output, ranAt, ranAt);

    const result = await collectHermesSpendSources(home);

    expect(result.errors).toEqual([]);
    expect(result.value).toEqual([{
      id: "hermes:cron:orphan-job",
      provider: "hermes",
      kind: "cron",
      label: "Hermes cron orphan-job",
      lastRunAt: "2026-08-15T14:01:00.000Z",
    }]);
  });

  test("cron remains Usage spend and never becomes an agent row", async () => {
    const source: SpendSource = {
      id: "hermes:cron:cron_daily-watcher-001",
      provider: "hermes",
      kind: "cron",
      label: "Daily watcher",
      lastRunAt: "2026-08-15T14:01:00.000Z",
    };
    const snap = buildSnapshot({
      agents: [],
      spendSources: [source],
      surfaces: [],
      archiveStore,
    });

    expect(snap.spendSources).toEqual([source]);
    expect(snap.programs.flatMap((program) => program.agents)).toEqual([]);

    const panel = withDom(() => {
      client.renderUsagePanel({
        snap,
        usageLoading: false,
        usageError: "",
        usageSummary: {
          available: true,
          processedTokens: 0,
          invocations: 0,
          costKnown: false,
          burnRateTokensPerHour: null,
          byProvider: [],
        },
        usageSeries: { available: true, points: [] },
        usageWard: null,
        usageInvocations: { available: true, invocations: [] },
      });
      return document.getElementById("usage-panel");
    });

    expect(textOf(panel)).toContain("Hermes");
    expect(textOf(panel)).toContain("Daily watcher");
    expect(textOf(panel)).toContain("not reported");
    expect(textOf(panel)).not.toContain("Focus");
    expect(textOf(panel)).not.toContain("Send");
  });
});

describe("billed provider disclosure", () => {
  test("Hermes is modelled while a billed provider without a collector is named", () => {
    expect(unmodelledProviders([
      { provider: "Hermes" },
      { provider: "OpenAI API" },
      { provider: "OpenAI API" },
    ])).toEqual(["OpenAI API"]);
  });

  test("a malformed cron file degrades Hermes without making it unmodelled", async () => {
    const home = mkdtempSync(join(tmpdir(), "anthill-hermes-malformed-cron-"));
    const cron = join(home, ".hermes/cron");
    mkdirSync(cron, { recursive: true });
    writeFileSync(join(cron, "jobs.json"), "{");

    const result = await collectHermesSpendSources(home);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("hermes cron jobs.json");
    expect(unmodelledProviders([{ provider: "Hermes" }])).toEqual([]);
  });
});
