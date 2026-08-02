import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getUsageInvocations, getUsageSummary, handleUsageRequest } from "../src/server/burnbar";

/* THE PROPERTY:

     If a query in this path is bounded by a row count, no total derived from it
     may be reported as complete.

   Pinned as a property rather than a value because the cap will move and the
   property will not. Nothing below hardcodes 500 — the cap is read back from
   the response and every assertion is written against whatever it says.

   Two paths, treated differently on purpose:

     getUsageInvocations IS row-bounded. It exists to show recent calls, and a
     LIMIT is correct there. What it must do is make the bound observable, so a
     consumer can tell "these are all the rows" from "these are the first N".

     getUsageSummary IS NOT row-bounded. It aggregates in SQL over the whole
     window, which is what makes its totals trustworthy — and what makes the
     window identities in published-identities.test.ts mean anything. Adding a
     LIMIT to that query would silently turn every published total into a floor,
     and the identities would keep holding because both sides would shrink
     together.

   That last sentence is why this file exists separately from the identities. A
   cross-check between two numbers cannot see a bound that truncates both. This
   is the third time today that a guard needed a companion assertion for exactly
   that reason.

   The fixture deliberately holds more rows than the cap. If the cap ever grows
   past the fixture the bound stops biting and every assertion here would pass
   while testing nothing, so the fixture size is asserted against the observed
   cap rather than assumed to exceed it. */

const dylib =
  process.env.BURNBAR_SQLCIPHER_DYLIB?.trim()
  || join(process.env.HOME || "", "Library/Application Support/OpenBurnBar/Frameworks/SQLCipher.framework/SQLCipher");
const canSqlcipher = Boolean(dylib && Bun.file(dylib).size > 0);
if (!canSqlcipher) {
  console.warn(`[capped-queries] SKIPPED: SQLCipher dylib unavailable at ${dylib || "(empty path)"}.`);
}

const KEY = "test-key";
/** Comfortably past any cap this path has carried. Asserted, not assumed. */
const ROW_COUNT = 600;
const TOKENS_PER_ROW = 1_000;
const COST_PER_ROW = 0.01;
const FROM = "2026-07-22T00:00:00.000Z";
const TO = "2026-07-23T00:00:00.000Z";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** One session per row, so nothing collapses under the snapshot dedup and the
    row count is unambiguous. */
async function withFixture<T>(read: () => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "anthill-capped-"));
  roots.push(root);
  const dbPath = join(root, "openburnbar.sqlite");
  const script = join(root, "create-fixture.ts");
  writeFileSync(
    script,
    `
import { Database } from "bun:sqlite";
Database.setCustomSQLite(${JSON.stringify(dylib)});
const db = new Database(${JSON.stringify(dbPath)}, { create: true });
db.run("PRAGMA key = '${KEY}'");
db.run(\`CREATE TABLE token_usage (
  id TEXT PRIMARY KEY, provider TEXT, sessionId TEXT, projectName TEXT, model TEXT,
  inputTokens INTEGER, outputTokens INTEGER, cacheReadTokens INTEGER, cacheCreationTokens INTEGER,
  totalTokens INTEGER, cost REAL, provenanceConfidence TEXT, startTime TEXT, endTime TEXT)\`);
const insert = db.prepare("INSERT INTO token_usage VALUES (?,?,?,?,?,0,0,0,0,?,?,'exact',?,?)");
for (let i = 0; i < ${ROW_COUNT}; i += 1) {
  const minute = String(i % 60).padStart(2, "0");
  const hour = String(Math.floor(i / 60) % 24).padStart(2, "0");
  insert.run(
    String(i), "Claude Code", "sess-" + i, "p", "claude-opus-4-8",
    ${TOKENS_PER_ROW}, ${COST_PER_ROW},
    "2026-07-22 " + hour + ":" + minute + ":00.000",
    "2026-07-22 " + hour + ":" + minute + ":30.000",
  );
}
db.close();
`,
  );
  const created = Bun.spawnSync(["bun", script], { stdout: "pipe", stderr: "pipe" });
  expect(created.exitCode, new TextDecoder().decode(created.stderr)).toBe(0);

  const previous = {
    BURNBAR_SUPPORT_DIR: process.env.BURNBAR_SUPPORT_DIR,
    BURNBAR_DB_PATH: process.env.BURNBAR_DB_PATH,
    BURNBAR_DB_KEY: process.env.BURNBAR_DB_KEY,
    BURNBAR_SQLCIPHER_DYLIB: process.env.BURNBAR_SQLCIPHER_DYLIB,
  };
  process.env.BURNBAR_SUPPORT_DIR = root;
  process.env.BURNBAR_DB_PATH = dbPath;
  process.env.BURNBAR_DB_KEY = KEY;
  process.env.BURNBAR_SQLCIPHER_DYLIB = dylib;
  try {
    return await read();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value == null) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

describe("a row-bounded query never produces a total", () => {
  test.skipIf(!canSqlcipher)("the cap is observable, so a consumer can tell a page from a total", async () => {
    /* The bound has to be visible in the payload. A list that silently stops at
       N looks exactly like a window that happened to contain N rows, and the
       difference is the difference between a total and a floor.

       Asking for far more than the cap and reading back what the response says
       it applied is how the cap is discovered here — nothing asserts 500. */
    const response = await withFixture(() => getUsageInvocations(FROM, TO, 10_000));

    expect(response.available).toBe(true);
    expect(response.limit).toBeGreaterThan(0);
    expect(response.invocations.length).toBe(response.limit);
    // And the fixture genuinely exceeds it, or nothing below is being tested.
    expect(ROW_COUNT, "fixture no longer exceeds the cap; grow ROW_COUNT").toBeGreaterThan(response.limit);
  });

  test.skipIf(!canSqlcipher)("a total summed from the capped rows is a floor, not the total", async () => {
    /* The consequence, made concrete. Summing the returned rows gives an answer
       that is confidently, silently wrong — and wrong in the reassuring
       direction, which is the direction nobody investigates.

       This is the assertion that says the list may not be used as a total,
       whatever the cap becomes. */
    const { response, summary } = await withFixture(async () => ({
      response: await getUsageInvocations(FROM, TO, 10_000),
      summary: await getUsageSummary(FROM, TO),
    }));

    const fromCappedRows = response.invocations.reduce((total, row) => total + (row.costUsd ?? 0), 0);
    const authoritative = summary.measuredCostUsd ?? 0;

    expect(fromCappedRows).toBeLessThan(authoritative);
    expect(fromCappedRows).toBeCloseTo(response.limit * COST_PER_ROW, 6);
    expect(authoritative).toBeCloseTo(ROW_COUNT * COST_PER_ROW, 6);
  });

  test.skipIf(!canSqlcipher)("the summary is not bounded by any row count", async () => {
    /* THE GUARD. Every published total comes from here, and it must aggregate
       the whole window rather than a page of it.

       If a LIMIT is ever added to the summary query, this is what fails. The
       window identities would not: they compare two numbers that would both
       shrink together, so a cross-check between them cannot see a bound that
       truncates both sides. */
    const summary = await withFixture(() => getUsageSummary(FROM, TO));

    expect(summary.invocations).toBe(ROW_COUNT);
    expect(summary.processedTokens).toBe(ROW_COUNT * TOKENS_PER_ROW);
    expect(summary.measuredCostUsd).toBeCloseTo(ROW_COUNT * COST_PER_ROW, 6);
  });

  test.skipIf(!canSqlcipher)("the summary counts more than the capped path can return", async () => {
    /* States the relationship rather than the two numbers, so it survives the
       cap moving and the fixture growing. The only way this fails is a bound
       reaching the summary. */
    const { response, summary } = await withFixture(async () => ({
      response: await getUsageInvocations(FROM, TO, 10_000),
      summary: await getUsageSummary(FROM, TO),
    }));

    expect(summary.invocations ?? 0).toBeGreaterThan(response.invocations.length);
    expect(summary.invocations ?? 0).toBeGreaterThan(response.limit);
  });

  test.skipIf(!canSqlcipher)("asking for fewer rows changes the page and never the total", async () => {
    /* The property across the parameter, which is the lesson from the window
       identities applied to this one. A single-limit assertion would pass on an
       implementation where the requested limit leaked into the aggregate; two
       different limits returning the same total is what rules that out. */
    const { small, large, summarySmall, summaryLarge } = await withFixture(async () => ({
      small: await getUsageInvocations(FROM, TO, 10),
      summarySmall: await getUsageSummary(FROM, TO),
      large: await getUsageInvocations(FROM, TO, 10_000),
      summaryLarge: await getUsageSummary(FROM, TO),
    }));

    expect(small.invocations.length).toBe(10);
    expect(large.invocations.length).toBeGreaterThan(small.invocations.length);
    // The page moved; the total did not.
    expect(summarySmall.invocations).toBe(summaryLarge.invocations);
    expect(summarySmall.measuredCostUsd).toBe(summaryLarge.measuredCostUsd);
    expect(summarySmall.invocations).toBe(ROW_COUNT);
  });

  test.skipIf(!canSqlcipher)("a range too wide to serve is refused at the boundary, not silently truncated", async () => {
    /* The same property at the other bound, and it belongs to the HTTP layer
       rather than to getUsageSummary — which is worth knowing, because calling
       the function directly with a six-year range returns a served-looking
       answer. Nothing in the product does that, and the request path is where
       the promise is made, so this asserts it there.

       Read as a property: whatever the maximum range is, asking beyond it must
       come back as a refusal and not as a total. A partial answer wearing a
       complete-looking shape is the failure this whole file is about. */
    const refused = await withFixture(() =>
      handleUsageRequest(new Request("http://127.0.0.1:4701/api/usage/summary?from=2020-01-01T00:00:00.000Z&to=2026-07-23T00:00:00.000Z")));
    const served = await withFixture(() =>
      handleUsageRequest(new Request(`http://127.0.0.1:4701/api/usage/summary?from=${FROM}&to=${TO}`)));

    expect(refused.ok).toBe(false);
    // The refusal has to say WHY, or an operator sees a broken endpoint rather
    // than a request they can narrow and retry.
    expect(JSON.stringify(await refused.json())).toMatch(/range/i);
    // The control: an in-range request over the same fixture IS served, so the
    // refusal is the range and not the endpoint being broken.
    expect(served.ok).toBe(true);
    expect((await served.json()).invocations).toBe(ROW_COUNT);
  });
});
