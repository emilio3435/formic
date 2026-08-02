import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getUsageSummary, handleUsageRequest } from "../src/server/burnbar";

/* The cost figure is the one an operator actually reads, and it was wrong in
   two independent ways.

   ONE. `estimatedCostUsd` is null whenever ANY invocation in the window is
   unpriced — correct for a field claiming to be a total, but it was the ONLY
   cost on the wire, so one unpriced provider erased every measured dollar
   beside it. Measured on this board: Cursor's 45 unpriced calls out of 2,980
   sent $11,939.94 of measured spend to the card as "not reported". That is the
   inverse of this project's honesty rule — hiding a number we have, rather than
   inventing one we do not. `processedTokens` two fields away already had the
   answer: keep the measured subtotal, state the size of the gap.

   TWO. `parseRange` read only from/to. A `?range=30d` was silently dropped and
   the caller got the 24-hour default with nothing saying so. */

const dylib =
  process.env.BURNBAR_SQLCIPHER_DYLIB?.trim() ||
  join(
    process.env.HOME || "",
    "Library/Application Support/OpenBurnBar/Frameworks/SQLCipher.framework/SQLCipher",
  );
const canSqlcipher = Boolean(dylib && Bun.file(dylib).size > 0);
if (!canSqlcipher) {
  console.warn(`[usage-cost-honesty.test] SKIPPED encrypted fixture: dylib unavailable at ${dylib || "(empty path)"}.`);
}

const KEY = "anthill-test-passphrase-base64like01";

/* A real encrypted database, not a stub. An earlier ward test in this repo
   passed with its fix reverted because it only ever exercised the catch path;
   the cost merge has to genuinely succeed for these assertions to mean
   anything. */
function withFixture<T>(rows: string, run: () => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "anthill-cost-honesty-"));
  const dbPath = join(root, "openburnbar.sqlite");
  const createScript = join(root, "create-fixture.ts");
  writeFileSync(
    createScript,
    `
import { Database } from "bun:sqlite";
Database.setCustomSQLite(${JSON.stringify(dylib)});
const db = new Database(${JSON.stringify(dbPath)}, { create: true });
db.run("PRAGMA key = '${KEY}'");
db.run(\`CREATE TABLE token_usage (
  id TEXT PRIMARY KEY, provider TEXT, sessionId TEXT, projectName TEXT, model TEXT,
  inputTokens INTEGER, outputTokens INTEGER, cacheReadTokens INTEGER, cacheCreationTokens INTEGER,
  totalTokens INTEGER, cost REAL, provenanceConfidence TEXT, startTime TEXT, endTime TEXT)\`);
db.run(\`INSERT INTO token_usage VALUES ${rows}\`);
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
  process.env.BURNBAR_SUPPORT_DIR = root;
  process.env.BURNBAR_DB_PATH = dbPath;
  process.env.BURNBAR_DB_KEY = KEY;
  process.env.BURNBAR_SQLCIPHER_DYLIB = dylib;
  return run().finally(() => {
    for (const [name, value] of Object.entries({
      BURNBAR_SUPPORT_DIR: previous.support,
      BURNBAR_DB_PATH: previous.db,
      BURNBAR_DB_KEY: previous.key,
      BURNBAR_SQLCIPHER_DYLIB: previous.dylib,
    })) {
      if (value == null) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
}

/* Shaped like the live board: three priced providers and one the pricing table
   does not know, all inside one window. `provenanceConfidence != 'exact'` with
   an unknown model is what makes a provider unpriced in the real data. */
const MIXED_ROWS = `
  ('c1','Codex','s','proj','claude-opus-4-8',800,200,0,0,1000,28.00,'exact','2026-07-22 10:00:00.000','2026-07-22 10:01:00.000'),
  ('c2','Claude Code','s','proj','claude-opus-4-8',800,200,0,0,1000,30.00,'exact','2026-07-22 10:05:00.000','2026-07-22 10:06:00.000'),
  ('c3','Hermes','s','proj','claude-opus-4-8',800,200,0,0,1000,25.00,'exact','2026-07-22 10:10:00.000','2026-07-22 10:11:00.000'),
  ('c4','Cursor','s','proj','a-model-with-no-published-price',400,100,0,0,500,NULL,'estimate','2026-07-22 10:15:00.000','2026-07-22 10:16:00.000')`;

const ALL_PRICED_ROWS = `
  ('p1','Codex','s','proj','claude-opus-4-8',800,200,0,0,1000,28.00,'exact','2026-07-22 10:00:00.000','2026-07-22 10:01:00.000'),
  ('p2','Claude Code','s','proj','claude-opus-4-8',800,200,0,0,1000,30.00,'exact','2026-07-22 10:05:00.000','2026-07-22 10:06:00.000')`;

const UNPRICED_ROWS = `
  ('x1','Cursor','s','proj','a-model-with-no-published-price',400,100,0,0,500,NULL,'estimate','2026-07-22 10:00:00.000','2026-07-22 10:01:00.000'),
  ('x2','Cursor','s','proj','another-unpriced-model',400,100,0,0,500,NULL,'estimate','2026-07-22 10:05:00.000','2026-07-22 10:06:00.000')`;

const WINDOW = { from: "2026-07-22T00:00:00.000Z", to: "2026-07-23T00:00:00.000Z" };

describe("a measured cost is never reported as unknown", () => {
  test.skipIf(!canSqlcipher)("one unpriced provider no longer erases the measured spend beside it", async () => {
    await withFixture(MIXED_ROWS, async () => {
      const summary = await getUsageSummary(WINDOW.from, WINDOW.to);

      expect(summary.available).toBe(true);
      expect(summary.invocations).toBe(4);

      /* The defect, stated as an assertion: $83 of measured spend existed and
         the payload said nothing at all. */
      expect(summary.measuredCostUsd).toBeCloseTo(83, 6);
      expect(summary.costMissingInvocations).toBe(1);

      /* estimatedCostUsd now carries the measured figure too, by Emilio's
         ruling: withholding a number he has is worse for him than qualifying
         one he has. What must NOT weaken is the qualifier — costKnown stays
         false and the gap is still counted, so "this is what we measured" and
         "that is not all of it" travel together. */
      expect(summary.estimatedCostUsd).toBeCloseTo(83, 6);
      expect(summary.costKnown).toBe(false);
      /* Provenance describes HOW the reported floor is known, not whether the
         total is complete — costKnown and costMissingInvocations answer that.
         Saying "unknown" over three providers priced exactly was the last gate
         in the cascade, and it contradicted this block's own title. */
      expect(summary.costProvenance).toBe("measured");

      // A card can now say "$83.00 across 3 of 4 calls" instead of going silent.
      expect(summary.measuredCostUsd!).toBeLessThan(
        summary.byProvider.reduce((total, row) => total + (row.costUsd ?? 0), 0) + 0.01,
      );
    });
  });

  test.skipIf(!canSqlcipher)("with every provider priced, the floor and the total agree", async () => {
    /* The control. If measuredCostUsd were computed some other way than the
       total, this is where it would show. */
    await withFixture(ALL_PRICED_ROWS, async () => {
      const summary = await getUsageSummary(WINDOW.from, WINDOW.to);

      expect(summary.costKnown).toBe(true);
      expect(summary.estimatedCostUsd).toBeCloseTo(58, 6);
      expect(summary.measuredCostUsd).toBeCloseTo(58, 6);
      expect(summary.costMissingInvocations).toBe(0);
    });
  });

  test.skipIf(!canSqlcipher)("with nothing priced at all, provenance really is unknown", async () => {
    /* The boundary the change must not cross: "unknown" still has a job. When
       no call in the window carries a price there is no floor to describe, and
       claiming "measured" would be the opposite error. */
    await withFixture(UNPRICED_ROWS, async () => {
      const summary = await getUsageSummary(WINDOW.from, WINDOW.to);

      expect(summary.measuredCostUsd).toBeNull();
      expect(summary.costProvenance).toBe("unknown");
      expect(summary.costMissingInvocations).toBe(2);
    });
  });

  test.skipIf(!canSqlcipher)("an empty window claims no floor either", async () => {
    await withFixture(MIXED_ROWS, async () => {
      const empty = await getUsageSummary("2026-07-25T00:00:00.000Z", "2026-07-26T00:00:00.000Z");

      // Absent-first: no rows read means no claim, not $0.00 of spend.
      expect(empty.invocations).toBe(0);
      expect(empty.measuredCostUsd).toBeNull();
      expect(empty.estimatedCostUsd).toBeNull();
      expect(empty.costMissingInvocations).toBe(0);
    });
  });

  test("a source that cannot be read reports no floor", async () => {
    // Runs without SQLCipher: the unavailable contract must not invent a floor.
    const previous = process.env.BURNBAR_DB_PATH;
    process.env.BURNBAR_DB_PATH = join(tmpdir(), "anthill-cost-honesty-absent.sqlite");
    try {
      const summary = await getUsageSummary(WINDOW.from, WINDOW.to);
      if (!summary.available) {
        expect(summary.measuredCostUsd).toBeNull();
        expect(summary.costMissingInvocations).toBe(0);
        expect(summary.costKnown).toBe(false);
      }
    } finally {
      if (previous == null) delete process.env.BURNBAR_DB_PATH;
      else process.env.BURNBAR_DB_PATH = previous;
    }
  });
});

describe("the range parameter means what it says", () => {
  const get = (query: string): Promise<Response> =>
    handleUsageRequest(new Request(`http://127.0.0.1:4701/api/usage/summary?${query}`));

  test("range=1h and range=30d ask for different windows", async () => {
    /* The defect: parseRange read only from/to, so `range` was silently
       dropped and every value returned the same 24-hour default. A window
       parameter that quietly means something else is the worst kind to put on
       a cost surface. */
    const hour = await (await get("range=1h")).json();
    const month = await (await get("range=30d")).json();

    const hourSpan = Date.parse(hour.to) - Date.parse(hour.from);
    const monthSpan = Date.parse(month.to) - Date.parse(month.from);

    expect(hourSpan).toBe(3_600_000);
    expect(monthSpan).toBe(30 * 86_400_000);
    // The failure this rules out: both collapsing to the 24-hour default.
    expect(hourSpan).not.toBe(monthSpan);
    expect(monthSpan / hourSpan).toBe(720);
  });

  test("no range at all still means the 24-hour default", async () => {
    const bare = await (await get("")).json();

    expect(Date.parse(bare.to) - Date.parse(bare.from)).toBe(24 * 3_600_000);
  });

  test("explicit bounds win over the shorthand, because the caller stated them", async () => {
    const both = await (
      await get("from=2026-07-22T00:00:00.000Z&to=2026-07-23T00:00:00.000Z&range=30d")
    ).json();

    expect(both.from).toBe("2026-07-22T00:00:00.000Z");
    expect(both.to).toBe("2026-07-23T00:00:00.000Z");
  });

  test("an unreadable range is rejected, not quietly ignored", async () => {
    /* The rule that makes the fix stick. Accepting `range=` and dropping
       anything it cannot parse would reintroduce the same silent default under
       a new name. */
    for (const bad of ["7", "week", "1w", "-3d", "0h", "abc"]) {
      const response = await get(`range=${encodeURIComponent(bad)}`);
      expect(response.status).toBe(400);
      expect((await response.json()).error?.code).toBe("INVALID_RANGE");
    }
  });

  test("a window the data supports is answered, not refused", async () => {
    /* 120d used to be a 400 while the source held ~130 days of history, so the
       ceiling was refusing questions the data could answer. */
    expect((await get("range=120d")).status).toBe(200);
  });

  test("the bound still exists, so the shorthand is not a way around it", async () => {
    /* The other half, and why the cap did not simply go away: it is a query
       bound, not a retention policy. Finite so a malformed request cannot scan
       without limit, wide enough that no real history is unreachable. */
    const response = await get("range=500d");

    expect(response.status).toBe(400);
    expect((await response.json()).error?.code).toBe("INVALID_RANGE");
  });
});

describe("a window says what it cannot see", () => {
  test.skipIf(!canSqlcipher)("spend before the window is reported, not silently dropped", async () => {
    /* The retention finding. The UI offered at most 30 days while the source
       held ~130, so a 30-day view showed $13,842 of $47,412 — 29% — and nothing
       said so. Same rule as costKnown: a view that cannot show everything
       states what it cannot see rather than implying completeness. */
    await withFixture(MIXED_ROWS, async () => {
      const later = await getUsageSummary("2026-07-23T00:00:00.000Z", "2026-07-24T00:00:00.000Z");

      expect(later.invocations).toBe(0);
      expect(later.priorSpend.invocations).toBe(4);
      expect(later.priorSpend.measuredCostUsd).toBeCloseTo(83, 6);
      // And how far back the source goes, so a card can offer to widen.
      expect(later.priorSpend.earliestAt).toBe("2026-07-22T10:00:00.000Z");
    });
  });

  test.skipIf(!canSqlcipher)("a window with nothing before it claims nothing before it", async () => {
    /* Absent-first, and the control: no prior rows is "nothing there", never
       $0.00 of prior spend, which would read as a measured claim. */
    await withFixture(MIXED_ROWS, async () => {
      const earliest = await getUsageSummary("2026-07-01T00:00:00.000Z", "2026-07-23T00:00:00.000Z");

      expect(earliest.priorSpend.invocations).toBe(0);
      expect(earliest.priorSpend.measuredCostUsd).toBeNull();
      expect(earliest.priorSpend.earliestAt).toBeNull();
    });
  });
});
