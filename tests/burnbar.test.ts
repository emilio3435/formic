import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getUsageInvocations,
  getUsageQuotas,
  getUsageSummary,
  handleUsageRequest,
  isEncryptedSqliteFile,
  resolveUsageCost,
} from "../src/server/burnbar";

const dylib =
  process.env.BURNBAR_SQLCIPHER_DYLIB?.trim() ||
  join(
    process.env.HOME || "",
    "Library/Application Support/OpenBurnBar/Frameworks/SQLCipher.framework/SQLCipher",
  );

const canSqlcipher = Boolean(dylib && Bun.file(dylib).size > 0);

describe("burnbar usage bridge", () => {
  const root = mkdtempSync(join(tmpdir(), "anthill-burnbar-"));
  const dbPath = join(root, "openburnbar.sqlite");
  const key = "anthill-test-passphrase-base64like01";

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("detects encrypted sqlite headers", () => {
    writeFileSync(join(root, "plain.sqlite"), "SQLite format 3\0rest");
    writeFileSync(join(root, "cipher.sqlite"), "not-a-sqlite-header!!");
    expect(isEncryptedSqliteFile(join(root, "plain.sqlite"))).toBe(false);
    expect(isEncryptedSqliteFile(join(root, "cipher.sqlite"))).toBe(true);
  });

  test("reads quotas sidecar without inventing spend", async () => {
    writeFileSync(
      join(root, "provider_quotas.json"),
      JSON.stringify([
        {
          provider: "Claude Code",
          buckets: [{ key: "a", label: "5h", usedPercent: 80 }],
        },
      ]),
    );
    const previous = process.env.BURNBAR_SUPPORT_DIR;
    process.env.BURNBAR_SUPPORT_DIR = root;
    try {
      const quotas = await getUsageQuotas();
      expect(quotas.available).toBe(true);
      expect(quotas.quotas[0]?.buckets[0]?.usedPercent).toBe(80);
    } finally {
      if (previous == null) delete process.env.BURNBAR_SUPPORT_DIR;
      else process.env.BURNBAR_SUPPORT_DIR = previous;
    }
  });

  test("derives only configured model costs and labels the estimate", () => {
    const config = {
      pricingVersion: "test-v1",
      modelPricingUsdPerMillionTokens: {
        "priced-model": {
          aliases: ["priced-model"],
          input: 2,
          output: 8,
          cacheRead: 0.2,
          cacheCreation: 2.5,
        },
      },
    };
    expect(resolveUsageCost({
      model: "provider/priced-model-fast",
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 500_000,
      cacheCreationTokens: 40_000,
      measuredCostUsd: null,
    }, config)).toEqual({
      costUsd: 3,
      costProvenance: "derived_estimate",
      pricingVersion: "test-v1",
    });
    expect(resolveUsageCost({
      model: "unpriced-model",
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      measuredCostUsd: null,
    }, config)).toEqual({ costUsd: null, costProvenance: "unknown" });
  });

  test("authoritative source cost wins, including measured zero", () => {
    expect(resolveUsageCost({
      model: "unpriced-model",
      inputTokens: 10_000,
      outputTokens: 10_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      measuredCostUsd: 0,
    })).toEqual({ costUsd: 0, costProvenance: "measured" });
  });

  test("missing OpenBurnBar reports an install health state instead of zeros", async () => {
    const previous = {
      support: process.env.BURNBAR_SUPPORT_DIR,
      db: process.env.BURNBAR_DB_PATH,
    };
    process.env.BURNBAR_SUPPORT_DIR = join(root, "not-installed");
    delete process.env.BURNBAR_DB_PATH;
    try {
      const summary = await getUsageSummary("2026-07-22T00:00:00.000Z", "2026-07-23T00:00:00.000Z");
      expect(summary).toMatchObject({
        available: false,
        sourceHealth: {
          state: "not_installed",
          message: "Cost source not installed. Install OpenBurnBar with SQLCipher support.",
        },
        estimatedCostUsd: null,
        costKnown: false,
        costProvenance: "unknown",
      });
    } finally {
      if (previous.support == null) delete process.env.BURNBAR_SUPPORT_DIR;
      else process.env.BURNBAR_SUPPORT_DIR = previous.support;
      if (previous.db == null) delete process.env.BURNBAR_DB_PATH;
      else process.env.BURNBAR_DB_PATH = previous.db;
    }
  });

  test.skipIf(!canSqlcipher)("summary/invocations unlock via SQLCipher helper", async () => {
    // Build the encrypted fixture in a child process so this test file never
    // calls Database.setCustomSQLite in the shared bun test worker.
    const createScript = join(root, "create-fixture.ts");
    writeFileSync(
      createScript,
      `
import { Database } from "bun:sqlite";
Database.setCustomSQLite(${JSON.stringify(dylib)});
const db = new Database(${JSON.stringify(dbPath)}, { create: true });
db.run("PRAGMA key = '${key}'");
db.run(\`CREATE TABLE token_usage (
  id TEXT PRIMARY KEY, provider TEXT, sessionId TEXT, projectName TEXT, model TEXT,
  inputTokens INTEGER, outputTokens INTEGER, cacheReadTokens INTEGER, cacheCreationTokens INTEGER,
  totalTokens INTEGER, cost REAL, provenanceConfidence TEXT, startTime TEXT, endTime TEXT)\`);
db.run(\`INSERT INTO token_usage VALUES
  ('1','Claude Code','sess-a','proj','claude-opus-4-8',800,200,0,0,1000,0.05,'exact','2026-07-22T10:00:00.000Z','2026-07-22T10:01:00.000Z'),
  ('2','Codex','sess-b','proj','unpriced-model',1500,500,0,0,2000,0,'low_confidence_estimate','2026-07-22T11:00:00.000Z','2026-07-22T11:01:00.000Z'),
  ('3','Claude Code','sess-c','proj','claude-opus-4-8',800,200,0,0,1000,99,'low_confidence_estimate','2026-07-23T10:00:00.000Z','2026-07-23T10:01:00.000Z')\`);
db.close();
`,
    );
    const created = Bun.spawnSync(["bun", createScript], { stdout: "pipe", stderr: "pipe" });
    expect(created.exitCode).toBe(0);

    const previous = {
      support: process.env.BURNBAR_SUPPORT_DIR,
      db: process.env.BURNBAR_DB_PATH,
      key: process.env.BURNBAR_DB_KEY,
      dylib: process.env.BURNBAR_SQLCIPHER_DYLIB,
    };
    process.env.BURNBAR_SUPPORT_DIR = root;
    process.env.BURNBAR_DB_PATH = dbPath;
    process.env.BURNBAR_DB_KEY = key;
    process.env.BURNBAR_SQLCIPHER_DYLIB = dylib;
    try {
      const summary = await getUsageSummary("2026-07-22T00:00:00.000Z", "2026-07-23T00:00:00.000Z");
      expect(summary.available).toBe(true);
      expect(summary.processedTokens).toBe(3000);
      expect(summary.invocations).toBe(2);
      // One row lacks cost — never invent a total spend.
      expect(summary.costKnown).toBe(false);
      expect(summary.estimatedCostUsd).toBeNull();
      expect(summary.costProvenance).toBe("unknown");

      const derived = await getUsageSummary("2026-07-23T00:00:00.000Z", "2026-07-24T00:00:00.000Z");
      expect(derived).toMatchObject({
        estimatedCostUsd: 0.009,
        costKnown: true,
        costProvenance: "derived_estimate",
        pricingVersion: "2026-07-28",
      });

      const empty = await getUsageSummary("2026-07-24T00:00:00.000Z", "2026-07-25T00:00:00.000Z");
      expect(empty).toMatchObject({
        available: true,
        processedTokens: 0,
        invocations: 0,
        estimatedCostUsd: null,
        costKnown: false,
        costProvenance: "unknown",
      });

      const invocations = await getUsageInvocations("2026-07-22T00:00:00.000Z", "2026-07-23T00:00:00.000Z", 10);
      expect(invocations.available).toBe(true);
      expect(invocations.invocations).toHaveLength(2);

      const response = await handleUsageRequest(
        new Request("http://127.0.0.1:4701/api/usage/summary?from=2026-07-22T00:00:00.000Z&to=2026-07-23T00:00:00.000Z"),
      );
      expect(response.status).toBe(200);
    } finally {
      for (const [name, value] of Object.entries({
        BURNBAR_SUPPORT_DIR: previous.support,
        BURNBAR_DB_PATH: previous.db,
        BURNBAR_DB_KEY: previous.key,
        BURNBAR_SQLCIPHER_DYLIB: previous.dylib,
      })) {
        if (value == null) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  test("usage endpoints reject non-loopback hosts", async () => {
    const response = await handleUsageRequest(
      new Request("http://example.com/api/usage/summary?from=2026-07-22T00:00:00.000Z&to=2026-07-23T00:00:00.000Z"),
    );
    expect(response.status).toBe(403);
  });
});
