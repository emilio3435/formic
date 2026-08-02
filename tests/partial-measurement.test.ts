import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getUsageSummary } from "../src/server/burnbar";

/* ONE property, with a right and a wrong implementation ten lines apart:

     A partial measurement reports what it measured beside what it missed.
     It never nulls the whole.

   burnbar.ts aggregates tokens and cost over the same rows, in the same
   functions, and treats an unmeasured source in opposite ways.

   Tokens are done correctly at every level. A row with no token count is
   skipped from the sum, `tokensMissing` counts how many were skipped, and
   `tokensKnown` rides alongside as a QUALIFIER — "3,000 across 2 calls, 1
   unmeasured". The figure survives; the caveat travels with it.

   Cost is gated instead. An unpriced row nulls its model (:556), an unpriced
   model nulls its provider (:588), and an unpriced provider nulled the fleet
   (:600). Measured on the live board, 45 unpriced invocations out of 2,980
   sent $11,939.94 of real measured spend to the card as "not reported".

   The fleet level has since been fixed: `measuredCostUsd` and
   `costMissingInvocations` now sit beside the strict `estimatedCostUsd`, which
   is exactly the property. The provider level has not, and because the levels
   cascade, that one gate still suppresses measured money from the fleet floor
   it feeds.

   The tests are written so the file documents which implementation is right:
   the tokens assertions PASS, and the cost assertions that still gate are
   marked failing and say what they are waiting for. */

const dylib =
  process.env.BURNBAR_SQLCIPHER_DYLIB?.trim() ||
  join(process.env.HOME || "", "Library/Application Support/OpenBurnBar/Frameworks/SQLCipher.framework/SQLCipher");
const canSqlcipher = Boolean(dylib && Bun.file(dylib).size > 0);

const root = mkdtempSync(join(tmpdir(), "anthill-partial-"));
const dbPath = join(root, "openburnbar.sqlite");
const key = "anthill-test-passphrase-base64like01";
const FROM = "2026-08-02T00:00:00.000Z";
const TO = "2026-08-03T00:00:00.000Z";

afterAll(() => rmSync(root, { recursive: true, force: true }));

/* Two providers. Claude is wholly priced. Cursor is PARTIAL — one priced call
   at $3.00 and one on a model with no price. That $3.00 is the measured money
   the gate suppresses, and the reason a partial provider is the fixture rather
   than a wholly unpriced one: a wholly unpriced provider has nothing to lose. */
function buildFixture(): boolean {
  if (!canSqlcipher) return false;
  const script = join(root, "create.ts");
  const stamp = "2026-08-02 09:00:00.000";
  writeFileSync(script, `
import { Database } from "bun:sqlite";
Database.setCustomSQLite(${JSON.stringify(dylib)});
const db = new Database(${JSON.stringify(dbPath)}, { create: true });
db.run("PRAGMA key = '${key}'");
db.run(\`CREATE TABLE token_usage (id TEXT PRIMARY KEY, provider TEXT, sessionId TEXT, projectName TEXT, model TEXT,
  inputTokens INTEGER, outputTokens INTEGER, cacheReadTokens INTEGER, cacheCreationTokens INTEGER,
  totalTokens INTEGER, cost REAL, provenanceConfidence TEXT, startTime TEXT, endTime TEXT)\`);
db.run(\`INSERT INTO token_usage VALUES
 ('c1','Claude Code','s1','p','claude-opus-4-8',800,200,0,0,1000,5.00,'exact','${stamp}','${stamp}'),
 ('c2','Claude Code','s2','p','claude-opus-4-8',800,200,0,0,1000,7.00,'exact','${stamp}','${stamp}'),
 ('u1','Cursor','s3','p','claude-opus-4-8',800,200,0,0,1000,3.00,'exact','${stamp}','${stamp}'),
 ('u2','Cursor','s4','p','totally-unpriced-model',800,200,0,0,1000,0,'low_confidence_estimate','${stamp}','${stamp}')\`);
db.close();
`);
  return Bun.spawnSync(["bun", script], { stdout: "pipe", stderr: "pipe" }).exitCode === 0;
}

const ready = buildFixture();
const gate = !canSqlcipher || !ready;
const suffix = gate ? ` (SKIPPED: missing ${dylib})` : "";

async function summary() {
  const previous = {
    support: process.env.BURNBAR_SUPPORT_DIR, db: process.env.BURNBAR_DB_PATH,
    key: process.env.BURNBAR_DB_KEY, dylib: process.env.BURNBAR_SQLCIPHER_DYLIB,
  };
  process.env.BURNBAR_SUPPORT_DIR = root;
  process.env.BURNBAR_DB_PATH = dbPath;
  process.env.BURNBAR_DB_KEY = key;
  process.env.BURNBAR_SQLCIPHER_DYLIB = dylib;
  try {
    return await getUsageSummary(FROM, TO);
  } finally {
    for (const [name, value] of Object.entries({
      BURNBAR_SUPPORT_DIR: previous.support, BURNBAR_DB_PATH: previous.db,
      BURNBAR_DB_KEY: previous.key, BURNBAR_SQLCIPHER_DYLIB: previous.dylib,
    })) {
      if (value == null) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

describe("a partial measurement reports what it measured beside what it missed", () => {
  /* ---- THE RIGHT IMPLEMENTATION: tokens ---------------------------------- */

  test.skipIf(gate)(`tokens survive a partial source, with the gap counted beside them${suffix}`, async () => {
    /* The reference implementation of the property. Every token in the window
       is measured here, so the sum is complete AND the qualifier says so —
       the value and its completeness travel together rather than one gating
       the other. */
    const usage = await summary();

    expect(usage.processedTokens).toBe(4_000);
    expect(usage.tokensMissing).toBe(0);
    expect(usage.tokensKnown).toBe(true);
  });

  test.skipIf(gate)(`every provider reports its tokens and its own gap${suffix}`, async () => {
    // Level 2 for tokens: the partial provider still reports its tokens. This
    // is precisely what its cost does not do, ten lines away in the same object
    // literal.
    const cursor = (await summary()).byProvider.find(({ provider }) => provider === "Cursor");

    expect(cursor?.tokens).toBe(2_000);
    expect(cursor?.tokensMissing).toBe(0);
  });

  /* ---- THE FIXED LEVEL: fleet cost --------------------------------------- */

  test.skipIf(gate)(`the fleet reports its measured cost beside the calls it could not price${suffix}`, async () => {
    /* Level 3, fixed. `estimatedCostUsd` stays null because it claims to be a
       TOTAL and one call is unpriced — that strictness is right. What changed
       is that the measured floor now ships beside it instead of being the only
       cost on the wire and therefore withheld entirely. */
    const usage = await summary();

    expect(usage.estimatedCostUsd).toBeNull();
    expect(usage.measuredCostUsd).not.toBeNull();
    expect(usage.costMissingInvocations).toBeGreaterThan(0);
    expect(usage.costKnown).toBe(false);
  });

  test.skipIf(gate)(`the gap counts the calls that were actually unpriced${suffix}`, async () => {
    /* FIXED. Was the same gate seen from the other side. Exactly
       ONE call in this window has no price: Cursor's unpriced-model call. But
       costMissingInvocations sums the invocations of every provider whose cost
       was nulled, and Cursor was nulled whole — so the gap reports 2.

       So the provider gate corrupts both halves of the fleet's honest report at
       once: it undercuts the floor by the money it suppressed, and it inflates
       the gap by the calls it suppressed alongside. A card rendering "$12.00
       across 2 of 4 calls" is wrong twice about a window where $15.00 was
       measured across 3 of 4. */
    if (gate) throw new Error("SQLCipher unavailable");
    const usage = await summary();

    expect(usage.costMissingInvocations).toBe(1);
  });

  test.skipIf(gate)(`the gap counts the unpriced call, not every call of a nulled provider${suffix}`, async () => {
    /* Control for the test above: pins today's number so the discrepancy is a
       measured difference rather than an assertion about nothing.

       WENT RED WHEN THE GATE WAS FIXED — that was its job. Updated to 1, and
       the trap it warned of is pinned rather than fallen into: simply removing
       the provider gate would recover the money and drop the gap to 0, claiming
       full pricing coverage over a window that has an unpriced call in it. The
       fix carries the per-row missing count up instead, so the gap is 1 — the
       one call that genuinely had no price. */
    expect((await summary()).costMissingInvocations).toBe(1);
  });

  /* ---- THE REMAINING GATE: provider cost --------------------------------- */

  test.failing(`a partial provider reports the cost it did measure${suffix}`, async () => {
    /* FAILS TODAY. Cursor made two calls: one priced at $3.00 and one on an
       unpriced model. The provider row reports costUsd: null, suppressing the
       $3.00 it holds — while the same row reports tokens: 2000 for the very
       same pair of calls.

       The fix is the shape the fleet level already uses: a measured floor and a
       missing count on the provider row, so a consumer can render "$3.00 across
       1 of 2 calls" rather than nothing. */
    if (gate) throw new Error("SQLCipher unavailable");
    const cursor = (await summary()).byProvider.find(({ provider }) => provider === "Cursor");

    expect(cursor?.costUsd).not.toBeNull();
  });

  test.skipIf(gate)(`the fleet floor is not undercut by a provider-level gate${suffix}`, async () => {
    /* FAILS TODAY, and this is why the remaining gate still matters even though
       the fleet level is fixed. The levels cascade: the fleet floor sums
       PROVIDERS whose cost survived, so Cursor being nulled at level 2 removes
       its measured $3.00 from the fleet floor too.

       Measured spend in this window is $5 + $7 + $3 = $15. The floor reports
       $12. A fifth of the money that was actually measured is still suppressed,
       by one gate one level down. */
    if (gate) throw new Error("SQLCipher unavailable");
    const usage = await summary();

    expect(usage.measuredCostUsd).toBe(15);
  });

  test.skipIf(gate)(`the floor reaches all 15 dollars that were measured${suffix}`, async () => {
    /* Was pinned at 12 while the provider gate suppressed Cursor's priced call.
       $5.00 + $7.00 from Claude Code and the $3.00 Cursor did measure. */
    const usage = await summary();

    expect(usage.measuredCostUsd).toBe(15);
  });
});
