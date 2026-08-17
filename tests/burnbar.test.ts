import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getUsageInvocations,
  getUsageQuotas,
  getUsageSummary,
  getUsageWard,
  handleUsageRequest,
  isEncryptedSqliteFile,
  resolveUsageCost,
  toBurnBarTimestamp,
} from "../src/server/burnbar";

const dylib =
  process.env.BURNBAR_SQLCIPHER_DYLIB?.trim() ||
  join(
    process.env.HOME || "",
    "Library/Application Support/OpenBurnBar/Frameworks/SQLCipher.framework/SQLCipher",
  );

const canSqlcipher = Boolean(dylib && Bun.file(dylib).size > 0);
if (!canSqlcipher) {
  console.warn(
    `[burnbar.test] SKIPPED encrypted SQLCipher fixture: dylib unavailable at ${dylib || "(empty path)"}. `
      + "The dependency-free unavailable contract will still run.",
  );
}

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

  test("normalizes ISO window bounds to OpenBurnBar's UTC SQLite format", () => {
    expect(toBurnBarTimestamp("2026-07-30T15:00:00.123Z")).toBe("2026-07-30 15:00:00.123");
    expect(toBurnBarTimestamp("2026-07-30T17:00:00.123+02:00")).toBe("2026-07-30 15:00:00.123");
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
          providers: ["OpenAI API"],
          input: 2,
          output: 8,
          cacheRead: 0.2,
          cacheCreation: 2.5,
        },
      },
    };
    expect(resolveUsageCost({
      model: "provider/priced-model-fast",
      provider: "OpenAI API",
      pricingMode: "standard-short-context",
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
      provider: "OpenAI API",
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      measuredCostUsd: null,
    }, config)).toEqual({ costUsd: null, costProvenance: "unknown" });
  });

  test("derived prices are billing-provider scoped, while measured cost still wins", () => {
    const config = {
      pricingVersion: "test-v1",
      modelPricingUsdPerMillionTokens: {
        "gpt-5.6-luna": {
          aliases: ["gpt-5.6-luna"],
          providers: ["OpenAI API"],
          input: 0.2,
          output: 1.2,
          cacheRead: 0.02,
          cacheCreation: 0.25,
        },
      },
    };
    const tokens = {
      model: "gpt-5.6-luna",
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };

    expect(resolveUsageCost({ ...tokens, provider: "OpenAI API", pricingMode: "standard-short-context", measuredCostUsd: null }, config))
      .toMatchObject({ costProvenance: "derived_estimate", pricingVersion: "test-v1" });
    expect(resolveUsageCost({ ...tokens, provider: "Cursor", measuredCostUsd: null }, config))
      .toEqual({ costUsd: null, costProvenance: "unknown" });
    expect(resolveUsageCost({ ...tokens, provider: "Cursor", measuredCostUsd: 7.25 }, config))
      .toEqual({ costUsd: 7.25, costProvenance: "measured" });
  });

  test("OpenAI API estimates require explicit context pricing evidence", () => {
    const config = {
      pricingVersion: "test-v1",
      modelPricingUsdPerMillionTokens: {
        "gpt-5.6-luna": {
          aliases: ["gpt-5.6-luna"],
          providers: ["OpenAI API"],
          input: 0.2,
          output: 1.2,
          cacheRead: 0.02,
          cacheCreation: 0.25,
        },
      },
    };
    const tokens = {
      model: "gpt-5.6-luna",
      provider: "OpenAI API",
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      measuredCostUsd: null,
    };

    expect(resolveUsageCost(tokens, config)).toEqual({ costUsd: null, costProvenance: "unknown" });
    expect(resolveUsageCost({ ...tokens, pricingMode: "standard-short-context" }, config))
      .toEqual({ costUsd: 0.32, costProvenance: "derived_estimate", pricingVersion: "test-v1" });
    expect(resolveUsageCost({ ...tokens, pricingMode: "standard-long-context" }, config))
      .toEqual({ costUsd: 0.58, costProvenance: "derived_estimate", pricingVersion: "test-v1" });
  });

  test("Codex remains unknown without measured cost, while measured cost wins", () => {
    const config = {
      pricingVersion: "test-v1",
      modelPricingUsdPerMillionTokens: {
        "gpt-5.6-luna": {
          aliases: ["gpt-5.6-luna"],
          providers: ["OpenAI API"],
          input: 0.2,
          output: 1.2,
          cacheRead: 0.02,
          cacheCreation: 0.25,
        },
      },
    };
    const tokens = {
      model: "gpt-5.6-luna",
      provider: "Codex",
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };

    expect(resolveUsageCost({ ...tokens, measuredCostUsd: null }, config))
      .toEqual({ costUsd: null, costProvenance: "unknown" });
    expect(resolveUsageCost({ ...tokens, measuredCostUsd: 7.25 }, config))
      .toEqual({ costUsd: 7.25, costProvenance: "measured" });
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

  test("missing encrypted storage stays explicitly unavailable without fabricating usage", async () => {
    const previous = {
      support: process.env.BURNBAR_SUPPORT_DIR,
      db: process.env.BURNBAR_DB_PATH,
      key: process.env.BURNBAR_DB_KEY,
      dylib: process.env.BURNBAR_SQLCIPHER_DYLIB,
    };
    process.env.BURNBAR_SUPPORT_DIR = root;
    process.env.BURNBAR_DB_PATH = join(root, "missing.sqlite");
    delete process.env.BURNBAR_DB_KEY;
    process.env.BURNBAR_SQLCIPHER_DYLIB = join(root, "missing-sqlcipher.dylib");
    try {
      const from = "2026-07-22T00:00:00.000Z";
      const to = "2026-07-23T00:00:00.000Z";
      const summary = await getUsageSummary(from, to);
      expect(summary).toMatchObject({
        ok: true,
        available: false,
        provenance: "unavailable",
        source: "burnbar",
        processedTokens: null,
        estimatedCostUsd: null,
        costKnown: false,
        invocations: null,
        byProvider: [],
      });
      expect(summary.error).toContain("BurnBar database not found");

      const invocations = await getUsageInvocations(from, to, 10);
      expect(invocations).toMatchObject({
        ok: true,
        available: false,
        provenance: "unavailable",
        source: "burnbar",
        invocations: [],
      });
      expect(invocations.error).toContain("BurnBar database not found");

      const response = await handleUsageRequest(
        new Request(`http://127.0.0.1:4701/api/usage/summary?from=${from}&to=${to}`),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        available: false,
        processedTokens: null,
        estimatedCostUsd: null,
      });
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

  const sqlcipherTestName =
    `summary/invocations unlock via SQLCipher helper${canSqlcipher ? "" : ` (SKIPPED: missing ${dylib})`}`;
  test.skipIf(!canSqlcipher)(sqlcipherTestName, async () => {
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
  ('1','Claude Code','sess-a','proj','claude-opus-4-8',800,200,0,0,1000,0.05,'exact','2026-07-22 10:00:00.000','2026-07-22 10:01:00.000'),
  ('2','Codex','sess-b','proj','unpriced-model',1500,500,0,0,2000,0,'low_confidence_estimate','2026-07-22 11:00:00.000','2026-07-22 11:01:00.000'),
  ('3','Anthropic API','sess-c','proj','claude-opus-4-8',800,200,0,0,1000,99,'low_confidence_estimate','2026-07-23 10:00:00.000','2026-07-23 10:01:00.000')\`);
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
      // Carries the measured figure; costKnown above is what says it is partial.
      expect(summary.estimatedCostUsd).not.toBeNull();
      /* Provenance describes how the reported floor is known, not whether the
         total is complete — costKnown above already says that. This asserted
         "unknown" while the window held a priced row, which was the conflation
         6418f0a removed. */
      expect(summary.costProvenance).toBe("measured");
      expect(summary.measuredCostUsd).not.toBeNull();
      expect(summary.costMissingInvocations).toBeGreaterThan(0);

      const derived = await getUsageSummary("2026-07-23T00:00:00.000Z", "2026-07-24T00:00:00.000Z");
      expect(derived).toMatchObject({
        estimatedCostUsd: 0.009,
        costKnown: true,
        costProvenance: "derived_estimate",
        pricingVersion: "2026-08-17",
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

  /* The ward answers from two independent sources: spikes from the encrypted
     database and quota pressure from the provider_quotas.json sidecar. The
     sidecar's own reader is careful to report available:false with a reason,
     but the ward used to drop that on the floor — `(quotas.quotas ?? [])` — and
     return available:true with an empty quotaPressure. An unreadable sidecar
     therefore reached the operator as "no quota buckets above 75%": a clean
     bill of health issued by code that never managed to look. */
  const wardTestName =
    `an unreadable quotas sidecar is reported even when the spike query succeeds${canSqlcipher ? "" : ` (SKIPPED: missing ${dylib})`}`;
  test.skipIf(!canSqlcipher)(wardTestName, async () => {
    /* The bug lives on the SUCCESS path, so the spike query has to actually
       work: a ward that fell into its catch would report unavailable for
       unrelated reasons and prove nothing. Build a real encrypted fixture, then
       break only the sidecar. */
    const wardRoot = mkdtempSync(join(tmpdir(), "anthill-ward-quotas-"));
    const wardDb = join(wardRoot, "openburnbar.sqlite");
    const createScript = join(wardRoot, "create-ward-fixture.ts");
    writeFileSync(
      createScript,
      `
import { Database } from "bun:sqlite";
Database.setCustomSQLite(${JSON.stringify(dylib)});
const db = new Database(${JSON.stringify(wardDb)}, { create: true });
db.run("PRAGMA key = '${key}'");
db.run(\`CREATE TABLE token_usage (
  id TEXT PRIMARY KEY, provider TEXT, sessionId TEXT, projectName TEXT, model TEXT,
  inputTokens INTEGER, outputTokens INTEGER, cacheReadTokens INTEGER, cacheCreationTokens INTEGER,
  totalTokens INTEGER, cost REAL, provenanceConfidence TEXT, startTime TEXT, endTime TEXT)\`);
db.run(\`INSERT INTO token_usage VALUES
  ('w1','Claude Code','sess-w','proj','claude-opus-4-8',800,200,0,0,1000,0.05,'exact','2026-07-22 10:00:00.000','2026-07-22 10:01:00.000')\`);
db.close();
`,
    );
    expect(Bun.spawnSync(["bun", createScript], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);

    // Valid JSON, wrong shape: parsed and rejected by the sidecar reader, which
    // is the failure most likely to survive unnoticed.
    writeFileSync(join(wardRoot, "provider_quotas.json"), JSON.stringify({ nope: true }));

    const previous = {
      support: process.env.BURNBAR_SUPPORT_DIR,
      db: process.env.BURNBAR_DB_PATH,
      key: process.env.BURNBAR_DB_KEY,
      dylib: process.env.BURNBAR_SQLCIPHER_DYLIB,
    };
    process.env.BURNBAR_SUPPORT_DIR = wardRoot;
    process.env.BURNBAR_DB_PATH = wardDb;
    process.env.BURNBAR_DB_KEY = key;
    process.env.BURNBAR_SQLCIPHER_DYLIB = dylib;
    try {
      const ward = await getUsageWard("2026-07-22T00:00:00.000Z", "2026-07-23T00:00:00.000Z");
      // The spike half genuinely worked...
      expect(ward.available).toBe(true);
      // ...so an empty quotaPressure here is exactly the sentence the operator
      // must NOT be allowed to read as "nothing above 75%".
      expect(ward.quotaPressure).toEqual([]);
      expect(ward.quotas.available).toBe(false);
      expect(ward.quotas.error ?? "").not.toBe("");
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
      rmSync(wardRoot, { recursive: true, force: true });
    }
  });

  const tieTestName =
    `invocations sharing a timestamp are cut by a defined order${canSqlcipher ? "" : ` (SKIPPED: missing ${dylib})`}`;
  test.skipIf(!canSqlcipher)(tieTestName, async () => {
    /* Three rows share one startTime and the limit keeps two, so the tie alone
       decides who is shown. Ids are inserted deliberately out of order so scan
       order and id order disagree: with no tie-breaker the query returns the
       first two it happens to scan, which is not a promise the endpoint can
       keep across reads. */
    const tieRoot = mkdtempSync(join(tmpdir(), "anthill-tie-"));
    const tieDb = join(tieRoot, "openburnbar.sqlite");
    const createScript = join(tieRoot, "create-tie-fixture.ts");
    writeFileSync(
      createScript,
      `
import { Database } from "bun:sqlite";
Database.setCustomSQLite(${JSON.stringify(dylib)});
const db = new Database(${JSON.stringify(tieDb)}, { create: true });
db.run("PRAGMA key = '${key}'");
db.run(\`CREATE TABLE token_usage (
  id TEXT PRIMARY KEY, provider TEXT, sessionId TEXT, projectName TEXT, model TEXT,
  inputTokens INTEGER, outputTokens INTEGER, cacheReadTokens INTEGER, cacheCreationTokens INTEGER,
  totalTokens INTEGER, cost REAL, provenanceConfidence TEXT, startTime TEXT, endTime TEXT)\`);
db.run(\`INSERT INTO token_usage VALUES
  ('tie-a','Codex','s','proj','m',1,1,0,0,2,0,'exact','2026-07-22 10:00:00.000','2026-07-22 10:00:01.000'),
  ('tie-c','Codex','s','proj','m',1,1,0,0,2,0,'exact','2026-07-22 10:00:00.000','2026-07-22 10:00:01.000'),
  ('tie-b','Codex','s','proj','m',1,1,0,0,2,0,'exact','2026-07-22 10:00:00.000','2026-07-22 10:00:01.000')\`);
db.close();
`,
    );
    expect(Bun.spawnSync(["bun", createScript], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);

    const previous = {
      support: process.env.BURNBAR_SUPPORT_DIR,
      db: process.env.BURNBAR_DB_PATH,
      key: process.env.BURNBAR_DB_KEY,
      dylib: process.env.BURNBAR_SQLCIPHER_DYLIB,
    };
    process.env.BURNBAR_SUPPORT_DIR = tieRoot;
    process.env.BURNBAR_DB_PATH = tieDb;
    process.env.BURNBAR_DB_KEY = key;
    process.env.BURNBAR_SQLCIPHER_DYLIB = dylib;
    try {
      const first = await getUsageInvocations("2026-07-22T00:00:00.000Z", "2026-07-23T00:00:00.000Z", 2);
      expect(first.available).toBe(true);
      expect(first.invocations).toHaveLength(2);
      // The order is defined by the query, not by the scan: highest ids win.
      expect(first.invocations.map((row) => row.id)).toEqual(["tie-c", "tie-b"]);

      // And it is repeatable — the point of having a tie-breaker at all.
      const second = await getUsageInvocations("2026-07-22T00:00:00.000Z", "2026-07-23T00:00:00.000Z", 2);
      expect(second.invocations.map((row) => row.id)).toEqual(first.invocations.map((row) => row.id));
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
      rmSync(tieRoot, { recursive: true, force: true });
    }
  });

  const nullTokensTestName =
    `an unmeasured invocation is counted, not scored zero${canSqlcipher ? "" : ` (SKIPPED: missing ${dylib})`}`;
  test.skipIf(!canSqlcipher)(nullTokensTestName, async () => {
    /* token_usage.totalTokens is nullable. SUM(COALESCE(totalTokens, 0)) folded
       a NULL into the total as if that call had burned nothing, so an
       invocation nobody measured was indistinguishable from one that used no
       tokens — and burnRateTokensPerHour divided the resulting short numerator
       by the full window, producing a confident rate from an incomplete count. */
    const nullRoot = mkdtempSync(join(tmpdir(), "anthill-null-tokens-"));
    const nullDb = join(nullRoot, "openburnbar.sqlite");
    const createScript = join(nullRoot, "create-null-fixture.ts");
    writeFileSync(
      createScript,
      `
import { Database } from "bun:sqlite";
Database.setCustomSQLite(${JSON.stringify(dylib)});
const db = new Database(${JSON.stringify(nullDb)}, { create: true });
db.run("PRAGMA key = '${key}'");
db.run(\`CREATE TABLE token_usage (
  id TEXT PRIMARY KEY, provider TEXT, sessionId TEXT, projectName TEXT, model TEXT,
  inputTokens INTEGER, outputTokens INTEGER, cacheReadTokens INTEGER, cacheCreationTokens INTEGER,
  totalTokens INTEGER, cost REAL, provenanceConfidence TEXT, startTime TEXT, endTime TEXT)\`);
/* One measured call and one the source never counted, in the same window.
   Distinct session ids because these are two separate CALLS, not two snapshots
   of one session — sharing an id would now collapse them, which is correct for
   a running total and wrong here. */
db.run(\`INSERT INTO token_usage VALUES
  ('n1','Codex','sn1','proj','claude-opus-4-8',800,200,0,0,1000,0.05,'exact','2026-07-22 10:00:00.000','2026-07-22 10:01:00.000'),
  ('n2','Codex','sn2','proj','claude-opus-4-8',NULL,NULL,0,0,NULL,0.01,'exact','2026-07-22 10:30:00.000','2026-07-22 10:31:00.000')\`);
// A second, fully measured window as the control.
db.run(\`INSERT INTO token_usage VALUES
  ('n3','Codex','sn3','proj','claude-opus-4-8',800,200,0,0,1000,0.05,'exact','2026-07-24 10:00:00.000','2026-07-24 10:01:00.000')\`);
db.close();
`,
    );
    expect(Bun.spawnSync(["bun", createScript], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);

    const previous = {
      support: process.env.BURNBAR_SUPPORT_DIR,
      db: process.env.BURNBAR_DB_PATH,
      key: process.env.BURNBAR_DB_KEY,
      dylib: process.env.BURNBAR_SQLCIPHER_DYLIB,
    };
    process.env.BURNBAR_SUPPORT_DIR = nullRoot;
    process.env.BURNBAR_DB_PATH = nullDb;
    process.env.BURNBAR_DB_KEY = key;
    process.env.BURNBAR_SQLCIPHER_DYLIB = dylib;
    try {
      const partial = await getUsageSummary("2026-07-22T00:00:00.000Z", "2026-07-23T00:00:00.000Z");
      expect(partial.available).toBe(true);
      expect(partial.invocations).toBe(2);
      // The measured subtotal survives — an understatement is not a fabrication...
      expect(partial.processedTokens).toBe(1000);
      // ...but the gap is stated rather than absorbed.
      expect(partial.tokensMissing).toBe(1);
      expect(partial.tokensKnown).toBe(false);
      // And no rate is invented from a numerator that is missing a term.
      expect(partial.burnRateTokensPerHour).toBeNull();
      expect(partial.byProvider[0]).toMatchObject({ tokens: 1000, tokensMissing: 1 });

      // The control: nothing missing, so the rate is owed and given.
      const complete = await getUsageSummary("2026-07-24T00:00:00.000Z", "2026-07-25T00:00:00.000Z");
      expect(complete.processedTokens).toBe(1000);
      expect(complete.tokensMissing).toBe(0);
      expect(complete.tokensKnown).toBe(true);
      expect(complete.burnRateTokensPerHour).toBeGreaterThan(0);
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
      rmSync(nullRoot, { recursive: true, force: true });
    }
  });

  const wardSpikeTestName =
    `an unmeasured baseline does not manufacture a spike${canSqlcipher ? "" : ` (SKIPPED: missing ${dylib})`}`;
  test.skipIf(!canSqlcipher)(wardSpikeTestName, async () => {
    /* A spike is a ratio of two windows, so scoring NULL rows as zero corrupts
       it in both directions. This fixture puts the gap in the BASELINE, which
       is the dangerous direction: the denominator collapses, the ratio goes
       through the roof, and the ward raises an alarm out of data it never had.
       An invented alarm is worse than a missed one here — it spends the
       operator's attention on nothing and teaches them to stop looking. */
    const wardRoot = mkdtempSync(join(tmpdir(), "anthill-ward-spike-"));
    const wardDb = join(wardRoot, "openburnbar.sqlite");
    const createScript = join(wardRoot, "create-spike-fixture.ts");
    writeFileSync(
      createScript,
      `
import { Database } from "bun:sqlite";
Database.setCustomSQLite(${JSON.stringify(dylib)});
const db = new Database(${JSON.stringify(wardDb)}, { create: true });
db.run("PRAGMA key = '${key}'");
db.run(\`CREATE TABLE token_usage (
  id TEXT PRIMARY KEY, provider TEXT, sessionId TEXT, projectName TEXT, model TEXT,
  inputTokens INTEGER, outputTokens INTEGER, cacheReadTokens INTEGER, cacheCreationTokens INTEGER,
  totalTokens INTEGER, cost REAL, provenanceConfidence TEXT, startTime TEXT, endTime TEXT)\`);
// Baseline window (07-21): heavy usage, but the row was never measured.
db.run(\`INSERT INTO token_usage VALUES
  ('b1','Codex','s','proj','m',NULL,NULL,0,0,NULL,0.01,'exact','2026-07-21 10:00:00.000','2026-07-21 10:01:00.000')\`);
// Current window (07-22): usage that only LOOKS like a surge once the baseline
// has been flattened to zero. Sized to clear the ward's 1,000/h floor
// (100,000 over 24h is ~4,167/h) so the phantom spike genuinely fires without
// the guard — a smaller number would let this test pass for the wrong reason.
db.run(\`INSERT INTO token_usage VALUES
  ('c1','Codex','s','proj','m',80000,20000,0,0,100000,0.05,'exact','2026-07-22 10:00:00.000','2026-07-22 10:01:00.000')\`);
db.close();
`,
    );
    expect(Bun.spawnSync(["bun", createScript], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);

    const previous = {
      support: process.env.BURNBAR_SUPPORT_DIR,
      db: process.env.BURNBAR_DB_PATH,
      key: process.env.BURNBAR_DB_KEY,
      dylib: process.env.BURNBAR_SQLCIPHER_DYLIB,
    };
    process.env.BURNBAR_SUPPORT_DIR = wardRoot;
    process.env.BURNBAR_DB_PATH = wardDb;
    process.env.BURNBAR_DB_KEY = key;
    process.env.BURNBAR_SQLCIPHER_DYLIB = dylib;
    try {
      // 24h current window; its baseline is the preceding 24h, which holds the
      // unmeasured row.
      const ward = await getUsageWard("2026-07-22T00:00:00.000Z", "2026-07-23T00:00:00.000Z");
      expect(ward.available).toBe(true);
      // No alarm is raised off a denominator that was never measured...
      expect(ward.spikes).toEqual([]);
      // ...and the silence is qualified, so it cannot be read as an all-clear.
      expect(ward.spikeCoverage.complete).toBe(false);
      expect(ward.spikeCoverage.skipped).toBe(1);
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
      rmSync(wardRoot, { recursive: true, force: true });
    }
  });

  const wardRealSpikeTestName =
    `a fully measured surge is still reported${canSqlcipher ? "" : ` (SKIPPED: missing ${dylib})`}`;
  test.skipIf(!canSqlcipher)(wardRealSpikeTestName, async () => {
    // The control: suppression must be scoped to unmeasured series only.
    const spikeRoot = mkdtempSync(join(tmpdir(), "anthill-ward-real-"));
    const spikeDb = join(spikeRoot, "openburnbar.sqlite");
    const createScript = join(spikeRoot, "create-real-spike.ts");
    writeFileSync(
      createScript,
      `
import { Database } from "bun:sqlite";
Database.setCustomSQLite(${JSON.stringify(dylib)});
const db = new Database(${JSON.stringify(spikeDb)}, { create: true });
db.run("PRAGMA key = '${key}'");
db.run(\`CREATE TABLE token_usage (
  id TEXT PRIMARY KEY, provider TEXT, sessionId TEXT, projectName TEXT, model TEXT,
  inputTokens INTEGER, outputTokens INTEGER, cacheReadTokens INTEGER, cacheCreationTokens INTEGER,
  totalTokens INTEGER, cost REAL, provenanceConfidence TEXT, startTime TEXT, endTime TEXT)\`);
db.run(\`INSERT INTO token_usage VALUES
  ('rb','Codex','s','proj','m',800,200,0,0,1000,0.01,'exact','2026-07-21 10:00:00.000','2026-07-21 10:01:00.000'),
  ('rc','Codex','s','proj','m',80000,20000,0,0,100000,0.90,'exact','2026-07-22 10:00:00.000','2026-07-22 10:01:00.000')\`);
db.close();
`,
    );
    expect(Bun.spawnSync(["bun", createScript], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);

    const previous = {
      support: process.env.BURNBAR_SUPPORT_DIR,
      db: process.env.BURNBAR_DB_PATH,
      key: process.env.BURNBAR_DB_KEY,
      dylib: process.env.BURNBAR_SQLCIPHER_DYLIB,
    };
    process.env.BURNBAR_SUPPORT_DIR = spikeRoot;
    process.env.BURNBAR_DB_PATH = spikeDb;
    process.env.BURNBAR_DB_KEY = key;
    process.env.BURNBAR_SQLCIPHER_DYLIB = dylib;
    try {
      const ward = await getUsageWard("2026-07-22T00:00:00.000Z", "2026-07-23T00:00:00.000Z");
      expect(ward.spikes.length).toBe(1);
      expect(ward.spikes[0]).toMatchObject({ provider: "Codex", model: "m" });
      expect(ward.spikeCoverage).toEqual({ complete: true, skipped: 0, truncated: 0 });
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
      rmSync(spikeRoot, { recursive: true, force: true });
    }
  });

  test("usage endpoints reject non-loopback hosts", async () => {
    const response = await handleUsageRequest(
      new Request("http://example.com/api/usage/summary?from=2026-07-22T00:00:00.000Z&to=2026-07-23T00:00:00.000Z"),
    );
    expect(response.status).toBe(403);
  });
});
