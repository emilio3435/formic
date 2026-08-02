import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getUsageSummary } from "../src/server/burnbar";

/* Cumulative session rows, and why a one-row-per-session fixture proves
   nothing.

   OpenBurnBar — a separate application; this repo contains no INSERT against
   token_usage — records a session's RUNNING TOTAL and re-records it as the
   session progresses. So two rows for one session are not two calls. The later
   row CONTAINS the earlier one, and SUM() over both counts the whole session
   twice.

   The signature in real data, which this fixture mirrors exactly: identical
   startTime, advancing endTimes, monotonically growing totals. Measured across
   the most recent 500 rows — 497 sessions, 3 multi-row, carrying 637.1M tokens
   and roughly $1,462 of double-counted spend. One real pair went 512.84M then
   572.39M for the same session; another 476.00M then 483.06M.

   A fixture with one row per session would pass under BOTH the summing and the
   deduplicating implementation and tell us nothing at all — the two agree
   everywhere except on the shape this file exists to encode. Every assertion
   below is chosen so the summing answer and the dedup answer differ:

     processedTokens   1,500,000 deduped   vs 2,500,000 summed
     invocations               3 sessions  vs         5 rows
     measuredCostUsd         $15 deduped   vs       $25 summed

   THE ONE THAT IS EASY TO GET WRONG: `sess-drift` carries the same session
   across two rows whose startTimes differ by 277 milliseconds — .277 and .000.
   That is taken from the live data, where session 85ecd016 recorded
   `21:06:39.277` and `21:06:39.000`. A dedup keyed on startTime keeps both and
   double-counts it; only a key on sessionId collapses it. Since it is also the
   single most expensive session in the history, keying on the wrong column
   would leave the largest error in place while looking fixed. */

const dylib =
  process.env.BURNBAR_SQLCIPHER_DYLIB?.trim()
  || join(process.env.HOME || "", "Library/Application Support/OpenBurnBar/Frameworks/SQLCipher.framework/SQLCipher");
const canSqlcipher = Boolean(dylib && Bun.file(dylib).size > 0);
if (!canSqlcipher) {
  console.warn(`[cumulative-session-rows] SKIPPED: SQLCipher dylib unavailable at ${dylib || "(empty path)"}.`);
}

const KEY = "test-key";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/* Five stored rows, three sessions. Built in a child process so this file never
   calls Database.setCustomSQLite inside the shared bun test worker. */
const ROWS = `
 ('1','Claude Code','sess-cumulative','p','claude-opus-4-8',0,0,0,0,600000,6.00,'exact','2026-07-22 10:00:00.000','2026-07-22 12:00:00.000'),
 ('2','Claude Code','sess-cumulative','p','claude-opus-4-8',0,0,0,0,900000,9.00,'exact','2026-07-22 10:00:00.000','2026-07-22 13:00:00.000'),
 ('3','Claude Code','sess-drift','p','claude-opus-4-8',0,0,0,0,400000,4.00,'exact','2026-07-22 11:00:00.277','2026-07-22 12:30:00.000'),
 ('4','Claude Code','sess-drift','p','claude-opus-4-8',0,0,0,0,500000,5.00,'exact','2026-07-22 11:00:00.000','2026-07-22 13:30:00.000'),
 ('5','Codex','sess-single','p','gpt-5.6-sol',0,0,0,0,100000,1.00,'exact','2026-07-22 14:00:00.000','2026-07-22 14:05:00.000')`;

async function summarise(): Promise<Awaited<ReturnType<typeof getUsageSummary>>> {
  const root = mkdtempSync(join(tmpdir(), "anthill-cumulative-"));
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
db.run(\`INSERT INTO token_usage VALUES${ROWS}\`);
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
    return await getUsageSummary("2026-07-22T00:00:00.000Z", "2026-07-23T00:00:00.000Z");
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value == null) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

describe("a session contributes its latest snapshot once, not the sum of its snapshots", () => {
  test.skipIf(!canSqlcipher)("tokens come from the latest snapshot of each session", async () => {
    /* 900k + 500k + 100k. Summing every stored row gives 2,500,000, which is
       the number this window reported before the collapse — and 40% of it was
       never burned. */
    const summary = await summarise();

    expect(summary.available).toBe(true);
    expect(summary.processedTokens).toBe(1_500_000);
    expect(summary.processedTokens).not.toBe(2_500_000);
  });

  test.skipIf(!canSqlcipher)("cost comes from the latest snapshot of each session", async () => {
    /* Asserted separately from tokens because they are separate SUMs over the
       same subquery. A collapse applied to one and not the other leaves the
       blended rate looking wrong in a way B3 would never catch, since a ratio
       between two numbers validates neither. */
    const summary = await summarise();

    expect(summary.measuredCostUsd).toBe(15);
    expect(summary.measuredCostUsd).not.toBe(25);
  });

  test.skipIf(!canSqlcipher)("invocations counts sessions, not stored rows", async () => {
    /* Five rows, three sessions. This is the figure the per-invocation bounds
       divide by, so counting rows would deflate every per-unit number that
       matters — the physical-bounds work upstream reads this denominator. */
    const summary = await summarise();

    expect(summary.invocations).toBe(3);
    expect(summary.invocations).not.toBe(5);
  });

  test.skipIf(!canSqlcipher)("the collapse is published, not silent", async () => {
    /* Two rows were superseded. If a provider ever records two genuinely
       DISTINCT calls under one session id, this dedup drops one, and this
       number is what would show it happening. A silent collapse would look
       identical to having had no duplicates at all. */
    const summary = await summarise();

    expect(summary.supersededSnapshots).toBe(2);
  });

  test.skipIf(!canSqlcipher)("a session whose snapshots disagree on startTime still collapses", async () => {
    /* THE ONE THAT IS EASY TO GET WRONG, isolated to a single provider so it
       cannot be satisfied by the other sessions.

       Claude Code holds sess-cumulative (600k, 900k) and sess-drift (400k,
       500k). Deduped that is 1,400,000. A dedup keyed on startTime collapses
       sess-cumulative — whose stamps match exactly — and keeps both drift rows,
       giving 1,800,000: fixed-looking, and still wrong on the session that
       costs the most. */
    const summary = await summarise();
    const claude = summary.byProvider.find(({ provider }) => provider === "Claude Code");

    expect(claude?.tokens).toBe(1_400_000);
    expect(claude?.tokens).not.toBe(1_800_000);
    expect(claude?.invocations).toBe(2);
  });

  test.skipIf(!canSqlcipher)("a single-row session is untouched, so the collapse only removes duplicates", async () => {
    /* The control. Every assertion above would also hold on an implementation
       that dropped rows too eagerly — one keeping only the newest row per
       PROVIDER would give plausible-looking smaller numbers throughout. The
       Codex session has exactly one row and must survive intact. */
    const summary = await summarise();
    const codex = summary.byProvider.find(({ provider }) => provider === "Codex");

    expect(codex?.tokens).toBe(100_000);
    expect(codex?.invocations).toBe(1);
    expect(summary.byProvider).toHaveLength(2);
  });
});
