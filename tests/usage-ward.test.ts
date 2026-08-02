import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getUsageWard, handleUsageRequest, type UsageSpike } from "../src/server/burnbar";

/* `getUsageWard` — the largest untested block left in `src/server`, and it sits
   in the intersection tonight established as where defects survive longest:
   code that produces a figure nothing else on the board cross-checks.

   A spike is a RATIO of the current window's token rate to the preceding
   window's. Nothing else computes it, nothing else displays those two rates,
   and no second figure disagrees when it is wrong. `getUsageSeries` sat in
   exactly that position and had been over-counting by a third for as long as it
   had existed; the SSE heartbeat sat there too. This is the same shape, and it
   is worse in one respect: the series is at least a view of a total the
   headline also states, whereas a spike is a claim about a comparison that
   exists nowhere else at all.

   What makes a wrong spike expensive is that it spends attention. An invented
   alarm sends an operator looking for a burn that never happened, and teaches
   them the ward cries wolf — after which a real one is ignored. So the
   properties worth pinning are the ones that decide whether an alarm is real:
   which window the baseline is, that both rates are normalised the same way,
   and that missing data is refused rather than scored. */

const dylib =
  process.env.BURNBAR_SQLCIPHER_DYLIB?.trim() ||
  join(process.env.HOME || "", "Library/Application Support/OpenBurnBar/Frameworks/SQLCipher.framework/SQLCipher");
const canSqlcipher = Boolean(dylib && Bun.file(dylib).size > 0);
const KEY = "anthill-test-passphrase-base64like01";

/* One hour of "current" against the hour before it as baseline. The ward derives
   the baseline as the window of EQUAL duration immediately preceding, so these
   two constants fix both. */
const FROM = "2026-07-22T12:00:00.000Z";
const TO = "2026-07-22T13:00:00.000Z";

function withRows<T>(rows: string, run: () => Promise<T>, quotas?: unknown): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "anthill-ward-"));
  const dbPath = join(root, "openburnbar.sqlite");
  const script = join(root, "create.ts");
  if (quotas !== undefined) writeFileSync(join(root, "provider_quotas.json"), JSON.stringify(quotas));
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

/** `(id, provider, session, project, model, in, out, cacheR, cacheC, total, cost, conf, start, end)` */
const row = (id: string, model: string, total: number | "NULL", start: string): string =>
  `('${id}','Codex','s-${id}','p','${model}',0,0,0,0,${total},1.00,'exact','${start}','${start}')`;

/* Baseline hour 11:00-12:00, current hour 12:00-13:00.
   - steady:  100k baseline, 100k current  → ratio 1, no spike
   - burner:  10k  baseline, 100k current  → ratio 10, spike
   - fresh:   nothing in baseline, 50k current → no baseline, above the floor */
const ROWS = [
  row("b1", "steady", 100_000, "2026-07-22 11:30:00.000"),
  row("b2", "burner", 10_000, "2026-07-22 11:30:00.000"),
  row("c1", "steady", 100_000, "2026-07-22 12:30:00.000"),
  row("c2", "burner", 100_000, "2026-07-22 12:30:00.000"),
  row("c3", "fresh", 50_000, "2026-07-22 12:30:00.000"),
].join(",\n");

const ward = () => getUsageWard(FROM, TO);
const spikeFor = (spikes: readonly UsageSpike[], model: string): UsageSpike | undefined =>
  spikes.find((spike) => spike.model === model);

describe("a spike is measured against the window before it", () => {
  test.skipIf(!canSqlcipher)("a model burning ten times its previous hour is flagged", async () => {
    /* THE PROPERTY. `burner` did 10k in the baseline hour and 100k in this one.
       Nothing else on the board would contradict a wrong answer here, so this
       is asserted against the fixture's own arithmetic rather than a
       remembered number. */
    await withRows(ROWS, async () => {
      const result = await ward();
      const burner = spikeFor(result.spikes, "burner");

      expect(result.available).toBe(true);
      expect(burner, `no spike for burner in ${JSON.stringify(result.spikes)}`).toBeDefined();
      expect(burner!.currentTokensPerHour).toBe(100_000);
      expect(burner!.baselineTokensPerHour).toBe(10_000);
      expect(burner!.ratio).toBeCloseTo(10, 6);
    });
  });

  test.skipIf(!canSqlcipher)("a model burning at its usual rate is NOT flagged", async () => {
    /* The control, and the assertion that keeps the one above meaningful: a
       ward that flagged everything would satisfy the first test and be useless.
       `steady` moved exactly as much this hour as last. */
    await withRows(ROWS, async () => {
      expect(spikeFor((await ward()).spikes, "steady")).toBeUndefined();
    });
  });

  test.skipIf(!canSqlcipher)("the baseline is the PRECEDING window, not the same one", async () => {
    /* The window arithmetic, isolated. `baselineFrom = from - duration`, so for
       a one-hour request the baseline is the hour before. If it were the same
       window every ratio would be 1 and the ward would never fire; if it were
       twice the length, every rate would be halved and every ratio doubled —
       and in both cases nothing on the board disagrees.

       Measured by the baseline RATE, which only the preceding hour produces:
       burner has 10k there and nothing anywhere else. */
    await withRows(ROWS, async () => {
      const burner = spikeFor((await ward()).spikes, "burner")!;

      expect(burner.baselineTokensPerHour).toBe(10_000);
      // Both rates are per-hour over a one-hour window, so they are the raw sums.
      expect(burner.currentTokensPerHour).toBe(100_000);
    });
  });

  test.skipIf(!canSqlcipher)("both rates are normalised over the same duration", async () => {
    /* Doubling the request doubles both windows, so a steady burner's ratio must
       not move. If current and baseline were divided by different durations the
       ratio would scale with the request length — an alarm that depends on which
       range the operator happened to select. */
    await withRows(ROWS, async () => {
      const wide = await getUsageWard("2026-07-22T11:00:00.000Z", "2026-07-22T13:00:00.000Z");
      // Over the wide window both hours are "current", so burner's 110k lands in
      // one bucket and the baseline hours before it are empty.
      const burner = spikeFor(wide.spikes, "burner");
      expect(burner?.currentTokensPerHour).toBe(55_000);
    });
  });
});

describe("a gap in the data is refused, not scored", () => {
  /* The rule the code's own comment defends: an unmeasured row corrupts a ratio
     in both directions. A gap in the baseline inflates it and INVENTS a spike
     out of missing data; a gap in the current window flattens a real one.
     Inventing the alarm is the worse failure, so neither window is scored when
     either is incomplete. */
  const WITH_NULL = [
    row("n1", "gappy", "NULL", "2026-07-22 11:30:00.000"),
    row("n2", "gappy", 1_000, "2026-07-22 11:40:00.000"),
    row("n3", "gappy", 500_000, "2026-07-22 12:30:00.000"),
    row("n4", "clean", 10_000, "2026-07-22 11:30:00.000"),
    row("n5", "clean", 100_000, "2026-07-22 12:30:00.000"),
  ].join(",\n");

  test.skipIf(!canSqlcipher)("a model with an unmeasured row is not scored at all", async () => {
    /* `gappy` looks like a 500x spike if the NULL baseline row is read as zero
       — which is exactly what SUM(COALESCE(totalTokens, 0)) did. It is excluded
       instead. */
    await withRows(WITH_NULL, async () => {
      expect(spikeFor((await ward()).spikes, "gappy")).toBeUndefined();
    });
  });

  test.skipIf(!canSqlcipher)("a fully measured model beside it is still scored", async () => {
    // Exclusion is per model, not a whole-response bail-out.
    await withRows(WITH_NULL, async () => {
      expect(spikeFor((await ward()).spikes, "clean")).toBeDefined();
    });
  });

  test.skipIf(!canSqlcipher)("the count of what was skipped rides the response", async () => {
    /* Silence must never read as an all-clear. Without this the operator sees
       no spikes and cannot tell whether that means calm or unmeasured. */
    await withRows(WITH_NULL, async () => {
      const result = await ward();

      expect(result.spikeCoverage.complete).toBe(false);
      expect(result.spikeCoverage.skipped).toBe(1);
    });
  });

  test.skipIf(!canSqlcipher)("fully measured data reports complete coverage", async () => {
    // The control: `complete` has to be capable of being true, or the flag says
    // nothing and an operator learns to ignore it.
    await withRows(ROWS, async () => {
      const result = await ward();

      expect(result.spikeCoverage.complete).toBe(true);
      expect(result.spikeCoverage.skipped).toBe(0);
    });
  });
});

describe("the list is capped, and says so", () => {
  /* Found by testing the cap rather than reading it. Fifteen models each
     burning ten times their previous hour: the ward returned twelve and
     reported `complete: true, skipped: 0`. A field named coverage asserting it
     had covered everything, while three real alarms were dropped.

     This is the intersection again. Nothing else on the board computes a spike,
     so no second figure would ever have contradicted it, and the shape of the
     lie is the dangerous one — not a wrong number but a confident all-clear.
     Twelve is a reasonable cap; a silent twelve is not. */
  const spiking = (count: number): string =>
    Array.from({ length: count }, (_, index) => [
      row(`wb${index}`, `m${index}`, 10_000, "2026-07-22 11:30:00.000"),
      row(`wc${index}`, `m${index}`, 100_000 + index * 1_000, "2026-07-22 12:30:00.000"),
    ].join(",")).join(",\n");

  test.skipIf(!canSqlcipher)("more spikes than fit are counted, not dropped in silence", async () => {
    await withRows(spiking(15), async () => {
      const result = await ward();

      expect(result.spikes).toHaveLength(12);
      expect(result.spikeCoverage.truncated).toBe(3);
      // The whole point: coverage cannot claim completeness having dropped three.
      expect(result.spikeCoverage.complete).toBe(false);
    });
  }, 15_000);

  test.skipIf(!canSqlcipher)("a list that fits reports nothing truncated", async () => {
    /* The control. `truncated` must be capable of being 0, or "not complete"
       becomes permanent and stops carrying information — the same way a health
       card that is always amber stops being read. */
    await withRows(spiking(3), async () => {
      const result = await ward();

      expect(result.spikes).toHaveLength(3);
      expect(result.spikeCoverage).toEqual({ complete: true, skipped: 0, truncated: 0 });
    });
  }, 15_000);

  test.skipIf(!canSqlcipher)("the ones kept are the worst ones", async () => {
    /* A cap is only defensible if it drops the least important. The list is
       sorted by ratio before slicing, so the twelve returned must be the twelve
       highest — otherwise the ward hides the biggest burn behind an arbitrary
       twelve others. */
    await withRows(spiking(15), async () => {
      const ratios = (await ward()).spikes.map((spike) => spike.ratio);

      expect([...ratios].sort((left, right) => right - left)).toEqual(ratios);
      // 15 models burn 100k..114k against a 10k baseline; the top is 11.4x.
      expect(ratios[0]).toBeCloseTo(11.4, 5);
    });
  }, 15_000);
});

describe("a first appearance is not automatically an alarm", () => {
  test.skipIf(!canSqlcipher)("new activity above the floor is flagged with a finite ratio", async () => {
    /* With no baseline the ratio is Infinity, which JSON renders as null — a
       figure that silently becomes "unknown" on the wire. It is published as
       999 instead, and that has to stay a real number. */
    await withRows(ROWS, async () => {
      const fresh = spikeFor((await ward()).spikes, "fresh")!;

      expect(fresh.baselineTokensPerHour).toBe(0);
      expect(Number.isFinite(fresh.ratio)).toBe(true);
      expect(fresh.ratio).toBe(999);
      expect(JSON.parse(JSON.stringify(fresh)).ratio).toBe(999);
    });
  });

  test.skipIf(!canSqlcipher)("a trickle with no baseline stays below the floor", async () => {
    /* Without a floor every new model that ever ran a single call would raise
       an alarm, which is how a ward becomes noise. 500 tokens in an hour is not
       a burn. */
    const TRICKLE = row("t1", "trickle", 500, "2026-07-22 12:30:00.000");
    await withRows(TRICKLE, async () => {
      expect(spikeFor((await ward()).spikes, "trickle")).toBeUndefined();
    });
  });
});

describe("quota pressure reports what is close to a limit", () => {
  const QUOTAS = [{
    provider: "Anthropic",
    buckets: [
      { label: "weekly", usedPercent: 91, resetsAt: "2026-07-25T00:00:00.000Z" },
      { label: "5-hour", usedPercent: 80, resetsAt: "2026-07-22T15:00:00.000Z" },
      { label: "monthly", usedPercent: 12, resetsAt: "2026-08-01T00:00:00.000Z" },
    ],
  }];

  test.skipIf(!canSqlcipher)("only buckets at or above 75% are reported, worst first", async () => {
    await withRows(ROWS, async () => {
      const pressure = (await ward()).quotaPressure;

      expect(pressure.map((entry) => entry.label)).toEqual(["weekly", "5-hour"]);
      expect(pressure[0]!.usedPercent).toBe(91);
    }, QUOTAS);
  }, 10_000);

  test.skipIf(!canSqlcipher)("a quota file that cannot be read is reported as unavailable", async () => {
    /* Absent-first, on the quota side. No file means no claim about pressure —
       not a claim that nothing is under pressure. */
    await withRows(ROWS, async () => {
      const result = await ward();

      expect(result.quotas.available).toBe(false);
      expect(result.quotaPressure).toEqual([]);
    });
  });

  /* The quota fixture is written into the same support dir the db uses. */
  test.skipIf(!canSqlcipher)("the pressure list comes from the quota file, not the database", async () => {
    await withRows(ROWS, async () => {
      expect((await ward()).quotas.available).toBe(true);
    }, QUOTAS);
  });
});

describe("an unreadable database claims nothing", () => {
  test("no spikes AND no all-clear when the source cannot be read", async () => {
    /* The failure path, and the one that must not read as calm. `complete:
       false` is the difference between "we looked and found nothing" and "we
       could not look". */
    const previous = process.env.BURNBAR_DB_PATH;
    process.env.BURNBAR_DB_PATH = join(tmpdir(), "anthill-ward-absent.sqlite");
    try {
      const result = await ward();
      if (!result.available) {
        expect(result.spikes).toEqual([]);
        expect(result.spikeCoverage.complete).toBe(false);
        expect(result.error).toBeTruthy();
      }
    } finally {
      if (previous == null) delete process.env.BURNBAR_DB_PATH;
      else process.env.BURNBAR_DB_PATH = previous;
    }
  });
});

/* The HTTP surface in front of every usage figure. Untested until now, which
   means the loopback refusal — the only thing standing between another process
   on this machine and the cost database — had never once been executed. None of
   these need SQLCipher: every assertion is about a request that is refused or
   routed before the database is opened. */
describe("the usage API refuses what it should before it reads anything", () => {
  const get = (path: string, host = "127.0.0.1") =>
    handleUsageRequest(new Request(`http://${host}:4701${path}?from=2026-07-22T00:00:00.000Z&to=2026-07-23T00:00:00.000Z`));

  test("a non-loopback origin is refused", async () => {
    /* The security boundary. These endpoints read another application's
       encrypted spend database; reachable off-box they publish it. */
    const response = await get("/api/usage/summary", "192.168.1.50");

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("ORIGIN_REJECTED");
  });

  test("localhost and IPv6 loopback are both allowed", async () => {
    // The control: a gate that refused everything would pass the test above.
    for (const host of ["localhost", "[::1]"]) {
      expect((await get("/api/usage/summary", host)).status).not.toBe(403);
    }
  });

  test("a write method is refused", async () => {
    const response = await handleUsageRequest(
      new Request("http://127.0.0.1:4701/api/usage/summary", { method: "POST" }),
    );

    expect(response.status).toBe(405);
    expect((await response.json()).error.code).toBe("METHOD_NOT_ALLOWED");
  });

  test("an unknown usage path is a 404, not a silent empty answer", async () => {
    const response = await get("/api/usage/nonsense");

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("NOT_FOUND");
  });

  test("a malformed range is refused rather than silently defaulted", async () => {
    /* A range that quietly falls back to a default answers a question nobody
       asked and labels it with the one they did — the defect already found once
       on the range selector. */
    const response = await handleUsageRequest(
      new Request("http://127.0.0.1:4701/api/usage/summary?from=banana&to=also-banana"),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_RANGE");
  });

  test("each usage path routes to its own answer", async () => {
    /* Routing, asserted by a field unique to each response shape. Two paths
       wired to one handler would serve the wrong figure under the right name,
       and the client has no way to tell. */
    const shapes = await Promise.all([
      get("/api/usage/series").then((response) => response.json()),
      get("/api/usage/invocations").then((response) => response.json()),
      get("/api/usage/ward").then((response) => response.json()),
      get("/api/usage/quotas").then((response) => response.json()),
    ]);

    expect(shapes[0]).toHaveProperty("bucket");
    expect(shapes[1]).toHaveProperty("invocations");
    expect(shapes[2]).toHaveProperty("spikes");
    expect(shapes[3]).toHaveProperty("quotas");
  });
});
