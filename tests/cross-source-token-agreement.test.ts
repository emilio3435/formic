import { beforeAll, describe, expect, test } from "bun:test";
import { getAllUsageInvocations, type UsageInvocation } from "../src/server/burnbar";
import type { ActivityState } from "../src/shared/types";

/* THE FIRST ASSERTION IN THIS SUITE THAT CAN FAIL BECAUSE THE WORLD DISAGREES.

   Every other test here compares two of our own numbers. Partition identities
   prove a total was split correctly and never that the thing being split was
   real; if the collector silently dropped a hundred agents, all 1,500-odd of
   them would still pass. This one cannot: it compares `tokens.sessionProcessed`
   — what THIS board counted for a session — against what OpenBurnBar, a
   separate application that has never heard of this repository, independently
   recorded for the same session id.

   Measured when written: 235 of 235 joined sessions agreed to 0.0%.

   WHAT IT COVERS, AND WHAT IT DOES NOT. The join is board `sourceSessionId` to
   burnbar `sessionId`, and it drops an entire provider. BurnBar bills four
   providers; this board models three. Every unmatched row is `cron_*` shaped
   and belongs to one recurring job on Hermes, which has ZERO representation as
   a board agent.

   That is not a rounding gap. Measured over twelve two-hour windows: 20 of 222
   rows unmatched at 9.0% BY COUNT, but carrying 7.5M tokens and $23.99 against
   182.3M and $93.17 matched — 20.5% OF THE MONEY, because cron rows are
   individually large. So this check covers the uuid population and is not
   fleet-wide, and anyone reading a green here as "the board and burnbar agree"
   would be agreeing about four fifths of the spend.

   The exclusion is therefore asserted, not just documented. If a uuid session
   stops joining, or the excluded share grows, that fails here — because a
   cross-source check that quietly widens what it ignores is the most dangerous
   kind of green in this repository. */

const SNAPSHOT_URL = "http://127.0.0.1:4701/api/snapshot";
const DAY_MS = 24 * 60 * 60 * 1_000;
/* The hard gate for sessions whose two records have stopped moving. */
const PER_SESSION_TOLERANCE_PCT = 5;
/* The collectors call a transcript stale after 45 silent minutes. Reusing that
   boundary makes "has not moved" mean the same thing here as on the board,
   rather than adding a second guess about when activity has ended. */
const SETTLED_QUIET_MS = 45 * 60 * 1_000;
/* The board is read before BurnBar, so BurnBar can advance slightly between
   reads. One tenth of the hard-gate tolerance forgives only sub-percent skew;
   it cannot turn a material 5% accounting disagreement into agreement. */
const LIVE_READ_SKEW_EPSILON_PCT = PER_SESSION_TOLERANCE_PCT / 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

interface Comparison {
  readonly sessionId: string;
  readonly board: number;
  readonly burnbar: number;
  readonly driftPct: number;
}

interface Joined extends Comparison {
  readonly boardActivity?: ActivityState;
  readonly boardUpdatedAt: string;
  readonly burnbarUpdatedAtMs?: number;
}

interface BurnBarSession {
  readonly tokens: number;
  readonly updatedAtMs?: number;
}

type BurnBarJoinRow = Pick<UsageInvocation, "sessionId" | "tokens" | "startTime" | "endTime">;

let available = false;
let unavailableReason = "";
let joined: Joined[] = [];
let settled: Joined[] = [];
let live: Joined[] = [];
let burnbarSessions = 0;
let uuidSessions = 0;
let nonUuidSessions = 0;
let unjoinedUuid: string[] = [];

/* GRDB stores these UTC timestamps without a zone marker. Date.parse would
   otherwise read them in the machine's local zone and move the quiet boundary. */
const parseBurnBarTimestamp = (value: string): number =>
  Date.parse(`${value.replace(" ", "T")}Z`);

/* OpenBurnBar rows are cumulative session snapshots, not additive calls.
   Measured 2026-08-04 across 3,053 rows / 24 multi-row sessions: every total
   was monotonic by endTime and the last was the maximum; seven sessions also
   carried exact token/start/end duplicates under different model labels. This
   mirrors the summary query's established "latest cumulative snapshot wins"
   rule. Exact repeats are removed explicitly, then MAX is safe because the
   measured cumulative series is monotonic. */
const aggregateBurnBarSessions = (rows: readonly BurnBarJoinRow[]): Map<string, BurnBarSession> => {
  const sessions = new Map<string, BurnBarSession>();
  const seen = new Set<string>();
  for (const row of rows) {
    const fingerprint = JSON.stringify([row.sessionId, row.tokens, row.startTime, row.endTime ?? null]);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    const previous = sessions.get(row.sessionId);
    const observedAtMs = row.endTime ? parseBurnBarTimestamp(row.endTime) : undefined;
    const tokens = row.tokens ?? 0;
    sessions.set(row.sessionId, {
      tokens: previous ? Math.max(previous.tokens, tokens) : tokens,
      updatedAtMs: observedAtMs === undefined
        ? previous?.updatedAtMs
        : Math.max(previous?.updatedAtMs ?? -Infinity, observedAtMs),
    });
  }
  return sessions;
};

/* "Settled" rests on three real fields. `activity === ended` is the board's
   lifecycle verdict and settles immediately. Otherwise board `updatedAt` and
   BurnBar's newest row `endTime` must BOTH be quiet for the board's existing
   45-minute stale interval. `endTime` is the useful foreign signal here: it can
   advance while BurnBar rewrites a still-burning cumulative row. A missing or
   invalid timestamp proves nothing, so that session stays live. */
const isSettled = (row: Joined, nowMs: number): boolean => {
  if (row.boardActivity === "ended") return true;
  const boardUpdatedAtMs = Date.parse(row.boardUpdatedAt);
  return Number.isFinite(boardUpdatedAtMs)
    && row.burnbarUpdatedAtMs !== undefined
    && Number.isFinite(row.burnbarUpdatedAtMs)
    && nowMs - boardUpdatedAtMs >= SETTLED_QUIET_MS
    && nowMs - row.burnbarUpdatedAtMs >= SETTLED_QUIET_MS;
};

/* One comparison serves the live assertion and its fixture proof. Board-ahead
   is expected foreign-recorder lag; only board-behind beyond read skew is an
   anomaly. */
const liveAnomalies = (rows: readonly Comparison[]): Comparison[] =>
  rows.filter(({ board, burnbar }) => {
    if (board >= burnbar || burnbar <= 0) return false;
    return (burnbar - board) / burnbar * 100 > LIVE_READ_SKEW_EPSILON_PCT;
  });

beforeAll(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let snapshot: any;
  try {
    snapshot = await (await fetch(SNAPSHOT_URL, { signal: AbortSignal.timeout(8_000) })).json();
  } catch (error) {
    unavailableReason = `the board is not serving at ${SNAPSHOT_URL} (${error instanceof Error ? error.message : String(error)})`;
    console.warn(`[cross-source] SKIPPED: ${unavailableReason}`);
    return;
  }

  const now = Date.now();
  /* Paged. At 500 rows this saw only the most recent slice of the last 24
     hours — the fleet now produces more than that in a day — so "every joined
     session agrees" was a claim about whichever sessions happened to land in
     the tail of the page. */
  const usage = await getAllUsageInvocations(new Date(now - DAY_MS).toISOString(), new Date(now).toISOString());
  if (!usage.available || usage.invocations.length === 0) {
    unavailableReason = "BurnBar returned no readable rows for the last 24h";
    console.warn(`[cross-source] SKIPPED: ${unavailableReason}`);
    return;
  }

  const burnbarBySession = aggregateBurnBarSessions(usage.invocations);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boardAgents: any[] = (snapshot.programs ?? []).flatMap((program: any) => program.agents ?? []);
  const boardBySession = new Map<string, { tokens: number; activity?: ActivityState; updatedAt: string }>();
  for (const agent of boardAgents) {
    if (
      typeof agent?.sourceSessionId === "string"
      && typeof agent?.tokens?.sessionProcessed === "number"
      && typeof agent?.updatedAt === "string"
    ) {
      boardBySession.set(agent.sourceSessionId, {
        tokens: agent.tokens.sessionProcessed,
        activity: agent.activity,
        updatedAt: agent.updatedAt,
      });
    }
  }

  burnbarSessions = burnbarBySession.size;
  for (const [sessionId, burnbarSession] of burnbarBySession) {
    const isUuid = UUID.test(sessionId);
    isUuid ? (uuidSessions += 1) : (nonUuidSessions += 1);
    const boardSession = boardBySession.get(sessionId);
    if (boardSession === undefined) {
      if (isUuid) unjoinedUuid.push(sessionId);
      continue;
    }
    const board = boardSession.tokens;
    const burnbar = burnbarSession.tokens;
    const driftPct = burnbar > 0 ? Math.abs(board - burnbar) / burnbar * 100 : 0;
    joined.push({
      sessionId,
      board,
      burnbar,
      driftPct,
      boardActivity: boardSession.activity,
      boardUpdatedAt: boardSession.updatedAt,
      burnbarUpdatedAtMs: burnbarSession.updatedAtMs,
    });
  }
  available = joined.length > 0;
  if (!available) {
    unavailableReason = "BurnBar returned rows, but none joined to a board session with token and update fields";
    console.warn(`[cross-source] SKIPPED: ${unavailableReason}`);
    return;
  }
  settled = joined.filter((row) => isSettled(row, now));
  live = joined.filter((row) => !isSettled(row, now));
  console.info(
    `[cross-source] settled=${settled.length} live=${live.length} excluded=${nonUuidSessions} `
    + `unjoined=${unjoinedUuid.length}`,
  );
});

/* Says what a cross-source disagreement ESTABLISHES, which is less than it is
   tempting to write. This message used to end
   "OUR collector is high, look in src/server/collectors.ts", and the first time
   it ever fired that attribution was wrong: the board's 293,235 was exact —
   recomputed by hand from the raw transcript, without the collector — and
   OpenBurnBar's 112,258 was the sum of that session's first three calls of
   seven, its cumulative row having stopped advancing. See
   docs/CROSS-SOURCE-DRIFT-FINDING.md.

   A check that joins two independent records can establish THAT they differ and
   by how much. It cannot establish which one is right; neither source is
   privileged, and this one has no third record to break the tie. Naming a
   culprit is therefore a claim the test has no evidence for, and a confident
   wrong one costs more than silence — it sends whoever reads it into the wrong
   codebase, which is the exact harm the message was written to prevent.

   So it reports both figures, where each came from, and the direction, and it
   stops there. */
const describeDrift = ({ sessionId, board, burnbar, driftPct }: Comparison): string =>
  `${sessionId.slice(0, 12)}: this board counted ${board.toLocaleString()} `
  + `(per-call sizes summed from the session transcript) and OpenBurnBar recorded `
  + `${burnbar.toLocaleString()} (its cumulative row for the same session id) — `
  + `${driftPct.toFixed(1)}% apart, board ${board > burnbar ? "higher" : "lower"}. `
  + `WHICH IS CORRECT IS NOT ESTABLISHED BY THIS TEST. Both are worth checking: `
  + `GET /api/debug/session-calls?agent=<id> returns this board's per-call series, `
  + `and a burnbar total equal to a PREFIX of it means burnbar stopped recording `
  + `rather than that we overcounted. See docs/CROSS-SOURCE-DRIFT-FINDING.md`;

describe("what this board counted is what a separate application recorded", () => {
  test("the comparison actually ran against both sources", () => {
    /* The canary. Every test below returns quietly when either source is
       unreachable, so without this one an unavailable board would take the file
       green while comparing nothing at all.

       It does not FAIL when the board is down — that would break the shared
       suite for four other lanes whenever the server is stopped — but it does
       assert that if we got this far, the comparison was substantive. */
    if (!available) {
      expect(unavailableReason.length, "unavailable without a reason recorded").toBeGreaterThan(0);
      return;
    }
    expect(joined.length, "too few sessions joined to be worth believing").toBeGreaterThan(20);
    expect(settled.length, "too few settled sessions for the 5% gate to be worth believing").toBeGreaterThan(20);
    expect(settled.some(({ burnbar }) => burnbar > 100_000)).toBe(true);
    expect(
      live.length,
      `${live.length} live sessions are excluded from the 5% gate, against ${settled.length} settled`,
    ).toBeLessThan(settled.length);
  });

  test("every settled session agrees with the independent record", () => {
    /* THE MARKER IS GONE, and what it recorded resolved in our favour. It read:
       session fe1d8020-259, this board 293,235 against OpenBurnBar's 112,258,
       161.2% over. Re-measured 2026-08-03 across the paged window, BurnBar now
       records 293,235 for that session — it caught up to the figure this board
       published, which is the second time its record turned out to be the
       truncated one. The collector was right.

       Checked against the explanation that fooled two bounds checks in this
       repo on the same day: the marker was NOT retired because the evidence
       aged out. The window here is paged rather than capped at 500, and the
       check still passes on everything it can join.

       The later 13,775 reading was not `sessionProcessed`: it is the same
       record's cache-exclusive `sessionTotal`. The persisted board record, the
       raw transcript parse, and BurnBar all carry 293,235 for
       `sessionProcessed`. This split now admits its ended/stale board row to the
       settled set, so confusing those two token fields would make this hard
       gate red instead of silently falling outside the join.

       THE TOLERANCE IS UNCHANGED AND MUST STAY SO. It is the claim. A
       cross-source check loosened until it passes is worse than not having one,
       because it converts the only externally-falsifiable assertion here back
       into an internal one while still reading as corroboration. So the
       threshold stays at 5% and this settled hard gate carries the red until
       the disagreement is resolved.

       The unavailable branch THROWS rather than returning, so a stopped board
       cannot turn an external agreement check green without comparing either
       source. */
    /* THE ASSERTION. It can fail because a program that has never heard of this
       repository counted differently, which is true of nothing else here. */
    if (!available) throw new Error(`cross-source check did not run: ${unavailableReason}`);
    const disagreeing = settled
      .filter(({ driftPct }) => driftPct > PER_SESSION_TOLERANCE_PCT)
      .map(describeDrift);

    expect(disagreeing).toEqual([]);
  });

  test("a live board may lead BurnBar, but it may not fall behind", () => {
    if (!available) return;
    expect(liveAnomalies(live).map(describeDrift)).toEqual([]);
  });

  test("the live direction check reports a board-lower fixture", () => {
    const withinReadSkew: Comparison = {
      sessionId: "11111111-1111-1111-1111-111111111111",
      board: 99_600,
      burnbar: 100_000,
      driftPct: 0.4,
    };
    const droppedByBoard: Comparison = {
      sessionId: "22222222-2222-2222-2222-222222222222",
      board: 90_000,
      burnbar: 100_000,
      driftPct: 10,
    };

    expect(liveAnomalies([withinReadSkew, droppedByBoard]).map(describeDrift))
      .toEqual([describeDrift(droppedByBoard)]);
  });

  test("duplicate and advancing BurnBar snapshots each count once", () => {
    const duplicateTotal = 30_538_511;
    const finalTotal = 293_235;
    const rows: BurnBarJoinRow[] = [
      {
        sessionId: "duplicate",
        tokens: duplicateTotal,
        startTime: "2026-08-03 21:49:12.043",
        endTime: "2026-08-04 02:01:48.721",
      },
      /* Same observation under another model label. Model is deliberately not
         part of the fingerprint because it cannot make the work happen twice. */
      {
        sessionId: "duplicate",
        tokens: duplicateTotal,
        startTime: "2026-08-03 21:49:12.043",
        endTime: "2026-08-04 02:01:48.721",
      },
      {
        sessionId: "advancing",
        tokens: 112_258,
        startTime: "2026-08-02 20:28:49.000",
        endTime: "2026-08-02 20:29:02.414",
      },
      {
        sessionId: "advancing",
        tokens: finalTotal,
        startTime: "2026-08-02 20:28:49.000",
        endTime: "2026-08-02 20:29:37.000",
      },
    ];

    const sessions = aggregateBurnBarSessions(rows);

    expect(sessions.size).toBe(2);
    expect(sessions.get("duplicate")?.tokens).toBe(duplicateTotal);
    expect(sessions.get("advancing")?.tokens).toBe(finalTotal);
    expect(sessions.get("advancing")?.updatedAtMs)
      .toBe(parseBurnBarTimestamp("2026-08-02 20:29:37.000"));
  });

  test("the settled split requires both quiet clocks unless the board says ended", () => {
    const now = Date.parse("2026-08-03T12:00:00.000Z");
    const quiet: Joined = {
      sessionId: "33333333-3333-3333-3333-333333333333",
      board: 100_000,
      burnbar: 100_000,
      driftPct: 0,
      boardActivity: "idle",
      boardUpdatedAt: new Date(now - SETTLED_QUIET_MS).toISOString(),
      burnbarUpdatedAtMs: now - SETTLED_QUIET_MS,
    };

    expect(isSettled(quiet, now)).toBe(true);
    expect(isSettled({ ...quiet, boardUpdatedAt: new Date(now).toISOString() }, now)).toBe(false);
    expect(isSettled({ ...quiet, burnbarUpdatedAtMs: now }, now)).toBe(false);
    expect(isSettled({
      ...quiet,
      boardActivity: "ended",
      boardUpdatedAt: new Date(now).toISOString(),
      burnbarUpdatedAtMs: now,
    }, now)).toBe(true);
  });

  test("the totals agree, so many small drifts in one direction cannot hide", () => {
    /* Per-session tolerance permits a little slack each; a systematic
       accounting change would spend all of it the same way. The aggregate is
       where that shows, and it is asserted tighter. */
    if (!available) return;
    const board = settled.reduce((total, row) => total + row.board, 0);
    const burnbar = settled.reduce((total, row) => total + row.burnbar, 0);
    const driftPct = burnbar > 0 ? Math.abs(board - burnbar) / burnbar * 100 : 0;

    expect(
      driftPct,
      `across ${settled.length} settled sessions this board counted ${board.toLocaleString()} and OpenBurnBar `
      + `recorded ${burnbar.toLocaleString()} — ${board > burnbar ? "OUR total is high" : "OUR total is low"}`,
    ).toBeLessThan(1);
  });

  test("the join drops a whole provider, and the size of that hole is pinned", () => {
    /* THE EXCLUSION, asserted rather than described.

       Non-uuid session ids are `cron_*` rows from a provider this board does
       not model at all. They are a fifth of the money despite being a tenth of
       the rows. This test does not demand they be fixed — that is a product
       decision about whether Hermes should appear as an agent — but it does
       demand the hole stay the size we think it is.

       If non-uuid rows grow past a third of the population, the check above is
       agreeing about a minority of the spend and calling it agreement. */
    if (!available) return;

    expect(nonUuidSessions, "no excluded rows at all — has the join changed?").toBeGreaterThan(0);
    expect(
      nonUuidSessions / burnbarSessions,
      `${nonUuidSessions} of ${burnbarSessions} burnbar sessions are outside this check`,
    ).toBeLessThan(0.34);
  });

  test("no uuid session silently falls out of the join", () => {
    /* The uuid side was measured clean: every uuid session id in 24h matched a
       board sourceSessionId, so there is no format bug and no partial-match
       problem. A uuid session appearing here later means the join broke for a
       population it used to cover, which is exactly the silent narrowing this
       file exists to prevent.

       A small allowance for sessions that ended between the two reads. */
    if (!available) return;

    expect(
      unjoinedUuid.length,
      `uuid sessions burnbar knows and the board did not match: ${unjoinedUuid.slice(0, 5).join(", ")}`,
    ).toBeLessThan(Math.max(5, uuidSessions * 0.1));
  });
});
