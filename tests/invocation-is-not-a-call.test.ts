import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getUsageSummary } from "../src/server/burnbar";

/* One day held 26% of a 30-day cost headline, and the reason was the unit.

   2026-07-30 reported $3,514.24 across 58 "invocations" — $59.91 each against a
   fleet norm of $0.32–$1.93. Check 5 says each would have had to process 47.6M
   tokens against a 1M context window, which cannot happen. Seven rows carried
   243M–512M tokens apiece, and their session ids are this board's own agents:
   BurnBar records some Claude Code sessions as ONE cumulative row per session,
   alongside per-call rows from Codex and Hermes.

   So `invocations` counts two different units. Cost per invocation is arithmetic
   over a mixed denominator, and a 24h count of 175 is not comparable with a 30d
   count of 3006 — the second contains proportionally more session rows.

   THE COST IS NOT WRONG, and is deliberately not adjusted. All 58 rows are
   provenance "measured" — provider-reported, not derived from the token count —
   and they price at $1.27/M against a normal-row median of $1.63/M. Cache reads
   are billed on every turn, so a long session genuinely accrues that spend. The
   TOKEN counts are cumulative with cache reads re-counted per turn: the same
   shape as the sessionTotal defect fixed in collectors.ts, this time inside a
   database we do not own and cannot correct at source.

   What was missing was any signal that the unit is not uniform. This is that
   signal, and the invariant that would have caught it on day one. */

const dylib =
  process.env.BURNBAR_SQLCIPHER_DYLIB?.trim() ||
  join(process.env.HOME || "", "Library/Application Support/OpenBurnBar/Frameworks/SQLCipher.framework/SQLCipher");
const canSqlcipher = Boolean(dylib && Bun.file(dylib).size > 0);
const KEY = "anthill-test-passphrase-base64like01";
const WINDOW = { from: "2026-07-30T00:00:00.000Z", to: "2026-07-31T00:00:00.000Z" };

/* A real encrypted fixture, because the count is produced by SQL. A stub would
   have exercised none of the query this test exists to constrain — and a bind
   -order slip while writing it returned zero rows for every window, which is
   exactly the failure a stub would have hidden. */
function withRows<T>(rows: string, run: () => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "anthill-invocation-unit-"));
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

const at = (minute: number): string => `2026-07-30 10:${String(minute).padStart(2, "0")}:00.000`;

/* July 30 in miniature: two ordinary per-call rows and one cumulative session
   row of the kind that carried $588 of this board's own spend. */
const MIXED = `
  ('r1','Codex','s1','p','gpt-5.6-terra',600000,50000,0,0,650000,0.42,'exact','${at(1)}','${at(2)}'),
  ('r2','Hermes','s2','p','x-ai/grok-4.5',400000,20000,0,0,420000,0.31,'exact','${at(3)}','${at(4)}'),
  ('r3','Claude Code','s3','p','claude-opus-5',900000,60000,461000000,954085,462914085,588.14,'exact','${at(5)}','${at(6)}')`;

const ALL_CALLS = `
  ('c1','Codex','s1','p','gpt-5.6-terra',600000,50000,0,0,650000,0.42,'exact','${at(1)}','${at(2)}'),
  ('c2','Hermes','s2','p','x-ai/grok-4.5',400000,20000,0,0,420000,0.31,'exact','${at(3)}','${at(4)}')`;

describe("a row bigger than any context window is not one call", () => {
  test.skipIf(!canSqlcipher)("the cumulative session row is counted as an aggregate", async () => {
    await withRows(MIXED, async () => {
      const usage = await getUsageSummary(WINDOW.from, WINDOW.to);

      expect(usage.invocations).toBe(3);
      /* Exactly one, not three. Counted per ROW: a model group whose AVERAGE
         exceeds the window proves only that SOME row does, and blaming every
         row in it would overstate the very number that exists to be trusted.
         My first attempt did that and reported 1,943 of 3,005 rather than
         1,107. */
      expect(usage.aggregatedInvocations).toBe(1);
    });
  });

  test.skipIf(!canSqlcipher)("a window of genuine calls flags nothing", async () => {
    /* The control. A detector that fires on ordinary traffic makes the count
       decorative, and 650k and 420k tokens are large but possible in one call. */
    await withRows(ALL_CALLS, async () => {
      const usage = await getUsageSummary(WINDOW.from, WINDOW.to);

      expect(usage.invocations).toBe(2);
      expect(usage.aggregatedInvocations).toBe(0);
    });
  });

  test.skipIf(!canSqlcipher)("the cost is left exactly as the provider reported it", async () => {
    /* The half that must NOT change. The tokens are inflated by cache reads
       re-counted per turn; the money is not, because cache reads are billed on
       every turn. Adjusting the cost to match a "sensible" token count would
       replace a measured figure with a modelled one — the exact move this
       project keeps removing. */
    await withRows(MIXED, async () => {
      const usage = await getUsageSummary(WINDOW.from, WINDOW.to);

      expect(usage.measuredCostUsd).toBeCloseTo(588.87, 2);
      expect(usage.costProvenance).toBe("measured");
      expect(usage.byProvider.find((row) => row.provider === "Claude Code")?.costUsd)
        .toBeCloseTo(588.14, 2);
    });
  });

  test.skipIf(!canSqlcipher)("cost per invocation is not a figure this data supports", async () => {
    /* Stated as a property rather than left as a caveat. With aggregates in the
       window, dividing cost by invocations mixes per-call and per-session rows,
       and the answer ($196 here) describes nothing that happened. A consumer
       can now SEE that before dividing. */
    await withRows(MIXED, async () => {
      const usage = await getUsageSummary(WINDOW.from, WINDOW.to);

      expect(usage.aggregatedInvocations).toBeGreaterThan(0);
      expect(usage.aggregatedInvocations).toBeLessThan(usage.invocations!);
    });
  });

  test.skipIf(!canSqlcipher)("an empty window claims no aggregates", async () => {
    await withRows(MIXED, async () => {
      const usage = await getUsageSummary("2026-08-05T00:00:00.000Z", "2026-08-06T00:00:00.000Z");

      expect(usage.invocations).toBe(0);
      expect(usage.aggregatedInvocations).toBe(0);
    });
  });

  test("an unreadable source reports no aggregates rather than zero-as-fact", async () => {
    const previous = process.env.BURNBAR_DB_PATH;
    process.env.BURNBAR_DB_PATH = join(tmpdir(), "anthill-invocation-absent.sqlite");
    try {
      const usage = await getUsageSummary(WINDOW.from, WINDOW.to);
      if (!usage.available) expect(usage.aggregatedInvocations).toBe(0);
    } finally {
      if (previous == null) delete process.env.BURNBAR_DB_PATH;
      else process.env.BURNBAR_DB_PATH = previous;
    }
  });
});

describe("the burn rate names a window it can be held to", () => {
  test.skipIf(!canSqlcipher)("a cumulative session row does not become this window's rate", async () => {
    /* The same defect one field over. processedTokens was the numerator, so a
       462M-token session row - tokens accrued over that session's whole life -
       was charged to the single window holding its startTime. Measured on
       2026-07-30: 135,041,103 tokens/hour against 730,839 from the calls that
       actually happened there, 185x, and a figure no fleet of this size could
       produce. */
    await withRows(MIXED, async () => {
      const usage = await getUsageSummary(WINDOW.from, WINDOW.to);
      const hours = 24;

      // 650,000 + 420,000 from the two real calls; the session row is excluded.
      expect(usage.burnRateTokensPerHour).toBeCloseTo(1_070_000 / hours, 6);
      // processedTokens still reports everything, so the total is not lost.
      expect(usage.processedTokens).toBe(1_070_000 + 462_914_085);
    });
  });

  test.skipIf(!canSqlcipher)("with no aggregates the rate is unchanged, so this is not a discount", async () => {
    /* The control. If the exclusion fired on ordinary traffic the rate would
       understate, which is the same failure pointed the other way — and the
       reassuring direction is the one nobody investigates. */
    await withRows(ALL_CALLS, async () => {
      const usage = await getUsageSummary(WINDOW.from, WINDOW.to);

      expect(usage.aggregatedInvocations).toBe(0);
      expect(usage.burnRateTokensPerHour).toBeCloseTo(1_070_000 / 24, 6);
      expect(usage.processedTokens).toBe(1_070_000);
    });
  });

  test.skipIf(!canSqlcipher)("an unmeasured row still withholds the rate entirely", async () => {
    /* The pre-existing rule this must not quietly repeal: a numerator missing a
       term produces a made-up rate, not a smaller one. Excluding aggregates is
       about attributing time correctly; it is not licence to publish a rate
       over an incomplete count. */
    await withRows(`${ALL_CALLS},
      ('u9','Codex','s9','p','gpt-5.6-terra',NULL,NULL,0,0,NULL,0.10,'exact','${at(9)}','${at(9)}')`, async () => {
      const usage = await getUsageSummary(WINDOW.from, WINDOW.to);

      expect(usage.tokensMissing).toBe(1);
      expect(usage.burnRateTokensPerHour).toBeNull();
    });
  });
});
