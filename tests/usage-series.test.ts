import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getUsageSeries, getUsageSummary } from "../src/server/burnbar";

/* getUsageSeries — entry 3 of docs/UNTESTED-PATHS-MAP.md, 95 lines and the
   largest untouched block inside a covered file.

   It draws the Usage chart, and nothing else on the board reads the series, so
   no other figure contradicts it. That is precisely why it went wrong quietly:
   20cc4e3 taught the SUMMARY that OpenBurnBar re-records a session's running
   total, and this query kept summing the snapshots. Measured on the live
   database before the fix, over thirty days:

     chart     28,819,870,734 tokens   $15,207.46   3,082 rows
     headline  24,167,379,322 tokens   $11,717.89   3,054 rows
     delta      4,652,491,412 tokens    $3,489.57      28 rows

   Twenty-eight rows — exactly the supersededSnapshots the summary already
   reports. Two figures on one page disagreeing by a third is worse than either
   being wrong alone: it makes both unbelievable, and here the chart is the one
   nothing else checks.

   So the headline property is AGREEMENT, asserted against the same fixture
   rather than against remembered numbers. */

const dylib =
  process.env.BURNBAR_SQLCIPHER_DYLIB?.trim() ||
  join(process.env.HOME || "", "Library/Application Support/OpenBurnBar/Frameworks/SQLCipher.framework/SQLCipher");
const canSqlcipher = Boolean(dylib && Bun.file(dylib).size > 0);
const KEY = "anthill-test-passphrase-base64like01";
const FROM = "2026-07-22T00:00:00.000Z";
const TO = "2026-07-25T00:00:00.000Z";

function withRows<T>(rows: string, run: () => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "anthill-series-"));
  const dbPath = join(root, "openburnbar.sqlite");
  const script = join(root, "create.ts");
  writeFileSync(script, `
import { Database } from "bun:sqlite";
Database.setCustomSQLite(${JSON.stringify(dylib)});
const db = new Database(${JSON.stringify(dbPath)}, { create: true });
db.run("PRAGMA key = '${KEY}'");
db.run(\`CREATE TABLE token_usage (id TEXT PRIMARY KEY, provider TEXT, sessionId TEXT, projectName TEXT, model TEXT,
  inputTokens INTEGER, outputTokens INTEGER, cacheReadTokens INTEGER, cacheCreationTokens INTEGER,
  totalTokens INTEGER, cost REAL, provenanceConfidence TEXT, startTime TEXT, endTime TEXT)\`);
db.run(\`INSERT INTO token_usage VALUES ${rows}\`);
db.close();
`);
  expect(Bun.spawnSync(["bun", script], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
  const previous = { ...process.env };
  process.env.BURNBAR_SUPPORT_DIR = root;
  process.env.BURNBAR_DB_PATH = dbPath;
  process.env.BURNBAR_DB_KEY = KEY;
  process.env.BURNBAR_SQLCIPHER_DYLIB = dylib;
  return run().finally(() => {
    for (const name of ["BURNBAR_SUPPORT_DIR", "BURNBAR_DB_PATH", "BURNBAR_DB_KEY", "BURNBAR_SQLCIPHER_DYLIB"]) {
      if (previous[name] == null) delete process.env[name];
      else process.env[name] = previous[name];
    }
  });
}

/* Two days, two providers, and one session recorded twice — the shape that made
   the chart disagree with the headline. */
const ROWS = `
  ('a1','Codex','sess-A','p','gpt-5.6-terra',600000,50000,0,0,650000,4.00,'exact','2026-07-22 09:00:00.000','2026-07-22 09:01:00.000'),
  ('a2','Hermes','sess-B','p','x-ai/grok-4.5',400000,20000,0,0,420000,3.00,'exact','2026-07-22 15:00:00.000','2026-07-22 15:01:00.000'),
  ('b1','Codex','sess-C','p','gpt-5.6-terra',700000,60000,0,0,760000,5.00,'exact','2026-07-23 09:00:00.000','2026-07-23 09:01:00.000'),
  ('s1','Claude Code','sess-D','p','claude-opus-5',900000,60000,400000000,1000000,401960000,500.00,'exact','2026-07-23 10:00:00.000','2026-07-23 10:05:00.000'),
  ('s2','Claude Code','sess-D','p','claude-opus-5',900000,60000,460000000,1000000,461960000,575.00,'exact','2026-07-23 10:00:00.000','2026-07-23 10:09:00.000')`;

describe("the chart and the headline are the same measurement", () => {
  test.skipIf(!canSqlcipher)("summing the series gives the summary's totals, exactly", async () => {
    /* THE PROPERTY, and the one that actually failed. Asserted against the same
       fixture rather than against remembered numbers, so it holds whatever the
       data is — the invariant is that two views of one window agree. */
    await withRows(ROWS, async () => {
      const [series, summary] = await Promise.all([
        getUsageSeries(FROM, TO, "1d"),
        getUsageSummary(FROM, TO),
      ]);

      const tokens = series.points.reduce((total, point) => total + (point.tokens ?? 0), 0);
      const invocations = series.points.reduce((total, point) => total + point.invocations, 0);
      const cost = series.points.reduce((total, point) => total + (point.costUsd ?? 0), 0);

      expect(tokens).toBe(summary.processedTokens ?? 0);
      expect(invocations).toBe(summary.invocations ?? 0);
      expect(cost).toBeCloseTo(summary.measuredCostUsd!, 6);
    });
  });

  test.skipIf(!canSqlcipher)("a session recorded twice contributes once to the chart", async () => {
    /* The mechanism, isolated. The later snapshot CONTAINS the earlier, so
       summing both counts 401,960,000 tokens of work that never happened. */
    await withRows(ROWS, async () => {
      const series = await getUsageSeries(FROM, TO, "1d");
      const claude = series.points.filter((point) => point.provider === "Claude Code");

      expect(claude).toHaveLength(1);
      expect(claude[0]!.tokens).toBe(461_960_000);
      expect(claude[0]!.invocations).toBe(1);
    });
  });
});

describe("the buckets are the window the caller asked for", () => {
  test.skipIf(!canSqlcipher)("daily buckets separate the days and keep them ordered", async () => {
    await withRows(ROWS, async () => {
      const series = await getUsageSeries(FROM, TO, "1d");
      const starts = [...new Set(series.points.map((point) => point.bucketStart))];

      expect(starts).toEqual(["2026-07-22T00:00:00.000Z", "2026-07-23T00:00:00.000Z"]);
      // Ordering is the chart's x-axis; unsorted points draw time backwards.
      expect([...starts].sort()).toEqual(starts);
    });
  });

  test.skipIf(!canSqlcipher)("hourly buckets split a day the daily bucket merges", async () => {
    /* The control on the bucket parameter: if it were ignored, both bucketings
       would return identical points and the selector would be decorative — the
       exact defect found on the range selector earlier today. */
    await withRows(ROWS, async () => {
      const hourly = await getUsageSeries(FROM, TO, "1h");
      const daily = await getUsageSeries(FROM, TO, "1d");

      expect(new Set(hourly.points.map((point) => point.bucketStart)).size)
        .toBeGreaterThan(new Set(daily.points.map((point) => point.bucketStart)).size);
      expect(hourly.points.some((point) => point.bucketStart.endsWith("T09:00:00.000Z"))).toBe(true);
    });
  });

  test("an unsupported bucket is refused, not silently defaulted", async () => {
    /* Runs without SQLCipher: the guard is above the query. A silent default
       would draw a chart at a resolution nobody asked for and label it with the
       one they did. */
    const series = await getUsageSeries(FROM, TO, "5m");

    expect(series.available).toBe(false);
    expect(series.error).toMatch(/bucket must be 1h or 1d/);
    expect(series.points).toEqual([]);
  });

  test("the bucket the caller asked for is echoed back even when refused", async () => {
    // So a client rendering "5m" beside an empty chart can tell which request
    // this answer belongs to.
    expect((await getUsageSeries(FROM, TO, "5m")).bucket).toBe("5m");
  });
});

describe("a point says what it could not measure", () => {
  const MIXED = `
    ('m1','Codex','sess-M','p','gpt-5.6-terra',600000,50000,0,0,650000,4.00,'exact','2026-07-22 09:00:00.000','2026-07-22 09:01:00.000'),
    ('m2','Codex','sess-N','p','gpt-5.6-terra',NULL,NULL,0,0,NULL,1.00,'exact','2026-07-22 09:30:00.000','2026-07-22 09:31:00.000'),
    ('m3','Cursor','sess-O','p','a-model-with-no-published-price',400,100,0,0,500,NULL,'estimate','2026-07-22 10:00:00.000','2026-07-22 10:01:00.000')`;

  test.skipIf(!canSqlcipher)("an unmeasured row is counted, not scored zero", async () => {
    /* The bar height is the measured sum — an understatement is not a
       fabrication — and tokensMissing says how much of the bucket it does not
       describe. Folding a NULL in as zero would draw a quiet period nobody
       observed. */
    await withRows(MIXED, async () => {
      const series = await getUsageSeries(FROM, TO, "1d");
      const codex = series.points.find((point) => point.provider === "Codex")!;

      expect(codex.tokens).toBe(650_000);
      expect(codex.tokensMissing).toBe(1);
      expect(codex.invocations).toBe(2);
    });
  });

  test.skipIf(!canSqlcipher)("an unpriced point reports unknown rather than a cost of zero", async () => {
    await withRows(MIXED, async () => {
      const series = await getUsageSeries(FROM, TO, "1d");
      const cursor = series.points.find((point) => point.provider === "Cursor")!;

      expect(cursor.costUsd).toBeNull();
      expect(cursor.costProvenance).toBe("unknown");
    });
  });

  test.skipIf(!canSqlcipher)("a fully-priced point says measured, so provenance discriminates", async () => {
    await withRows(MIXED, async () => {
      const series = await getUsageSeries(FROM, TO, "1d");
      const codex = series.points.find((point) => point.provider === "Codex")!;

      expect(codex.costProvenance).toBe("measured");
      expect(codex.costUsd).toBeCloseTo(5, 6);
    });
  });

  test("an unreadable source returns no points and says why", async () => {
    const previous = process.env.BURNBAR_DB_PATH;
    process.env.BURNBAR_DB_PATH = join(tmpdir(), "anthill-series-absent.sqlite");
    try {
      const series = await getUsageSeries(FROM, TO, "1d");
      if (!series.available) {
        expect(series.points).toEqual([]);
        expect(series.error).toBeTruthy();
      }
    } finally {
      if (previous == null) delete process.env.BURNBAR_DB_PATH;
      else process.env.BURNBAR_DB_PATH = previous;
    }
  });
});
