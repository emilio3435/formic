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
   burnbar `sessionId`. Exact provider-session IDs, including Claude Code's
   `<parent>/agent-*` child identities, must join. Any unmatched child stays
   classified and must resolve to a parent the board models. Legacy `cron_*`
   rows likewise stay explicit because they have no board agent.

   The original cron exclusion was not a rounding gap. Measured over twelve
   two-hour windows: 20 of 222 rows unmatched at 9.0% BY COUNT, but carrying
   7.5M tokens and $23.99 against 182.3M and $93.17 matched — 20.5% OF THE
   MONEY. Provider-native child rows create the same coverage risk under a new
   ID shape. This check is therefore exact-session, not fleet-wide; its green
   result must state and bound what it excludes.

   The exclusion is therefore asserted, not just documented. If an exact uuid
   session stops joining, a child loses its modeled parent, an unknown session
   shape appears, or the excluded share grows, that fails here — because a
   cross-source check that quietly widens what it ignores is the most dangerous
   kind of green in this repository. */

/* Production remains the default. A release candidate can point this live gate
   at an exact-head loopback preview before the old production process is
   restarted; only the port is variable, so the test cannot leave loopback. */
const PRODUCTION_BOARD_ORIGIN = "http://127.0.0.1:4701";
const boardOriginFor = (candidatePort: string | undefined): string => {
  if (!candidatePort) return PRODUCTION_BOARD_ORIGIN;
  if (!/^\d{1,5}$/.test(candidatePort)) {
    throw new Error("ANTHILL_LIVE_TEST_PORT must be a decimal loopback port from 1 to 65535");
  }
  const port = Number(candidatePort);
  if (port < 1 || port > 65_535) {
    throw new Error("ANTHILL_LIVE_TEST_PORT must be a decimal loopback port from 1 to 65535");
  }
  return `http://127.0.0.1:${port}`;
};
const BOARD_ORIGIN = boardOriginFor(process.env.ANTHILL_LIVE_TEST_PORT);
const SNAPSHOT_URL = `${BOARD_ORIGIN}/api/snapshot`;
const MAX_EVIDENCE_WINDOW_HOURS = 48;
const evidenceWindowHoursFor = (scanWindowHours: unknown): number => {
  if (
    typeof scanWindowHours !== "number"
    || !Number.isFinite(scanWindowHours)
    || scanWindowHours <= 0
  ) {
    throw new Error("the board must publish a positive scan window");
  }
  return Math.min(scanWindowHours, MAX_EVIDENCE_WINDOW_HOURS);
};
const evidenceWindowFor = (
  scanWindowHours: unknown,
  snapshotGeneratedAt: unknown,
): { readonly hours: number; readonly fromMs: number; readonly toMs: number } => {
  const hours = evidenceWindowHoursFor(scanWindowHours);
  const toMs = typeof snapshotGeneratedAt === "string"
    ? Date.parse(snapshotGeneratedAt)
    : Number.NaN;
  if (!Number.isFinite(toMs)) throw new Error("the board must publish a valid snapshot timestamp");
  return { hours, fromMs: toMs - hours * 60 * 60 * 1_000, toMs };
};
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
const UUID_SOURCE_SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAILY_PARTITION_SOURCE_SESSION = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})#day-(\d+)$/i;
const SUBAGENT_SOURCE_SESSION = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/agent-[0-9a-z]+$/i;
const CRON_SOURCE_SESSION = /^cron_/;

interface Comparison {
  readonly sessionId: string;
  readonly board: number;
  readonly burnbar: number;
  readonly driftPct: number;
}

interface Joined extends Comparison {
  readonly agentId?: string;
  readonly boardActivity?: ActivityState;
  readonly boardUpdatedAt: string;
  readonly burnbarUpdatedAtMs?: number;
}

/* WHY THIS FILE NO LONGER DEMANDS THE TWO NUMBERS MATCH — Emilio's call,
   2026-08-04, after the fourth time the disagreement resolved the same way.

   Four times now a settled session has disagreed and the adjudication has gone
   against OpenBurnBar, not against this board: its total was EXACTLY one of our
   running totals from earlier in the session, which is what a recorder that
   stops writing looks like. `7a2ae0aa` is the clearest — BurnBar's 12,227,799
   is our prefix sum at call 98 of 146, and the 48 calls it never wrote carry
   8,972,335 tokens.

   Demanding equality against a source that reliably truncates produces a red
   that says nothing, and this repository has spent two days learning what a
   meaningless red costs. But deleting the comparison would throw away the only
   external record we have, and it is wanted for measurement work later.

   So the comparison still runs on every session, every drift is still recorded,
   and what is ASSERTED narrows to the two shapes that would mean something is
   wrong HERE:

     1. This board reading BELOW BurnBar. We would be losing tokens, and no
        BurnBar behaviour explains it.
     2. This board reading ABOVE BurnBar by more than the tolerance WITHOUT
        BurnBar's total being one of our prefixes — a divergence that
        truncation cannot account for, so it is unexplained.

   A board-high disagreement that IS an exact prefix is recorded, not asserted:
   it is evidence about BurnBar. Sessions with no per-call series (Codex exposes
   none) cannot be adjudicated either way and are recorded as such — counted,
   named, never silently dropped. */

interface BurnBarSession {
  readonly tokens: number;
  readonly updatedAtMs?: number;
  readonly accounting: "session-cumulative" | "daily-partitioned";
}

const excludedTokenShare = (
  sessions: ReadonlyMap<string, Pick<BurnBarSession, "tokens">>,
  excluded: ReadonlySet<string>,
): number => {
  let total = 0;
  let outside = 0;
  for (const [sessionId, session] of sessions) {
    if (!Number.isFinite(session.tokens) || session.tokens < 0) {
      throw new Error(`BurnBar returned invalid tokens for ${sessionId}`);
    }
    total += session.tokens;
    if (excluded.has(sessionId)) outside += session.tokens;
  }
  if (total <= 0) throw new Error("BurnBar returned no positive measured token total");
  return outside / total;
};

type BurnBarJoinRow = Pick<UsageInvocation, "sessionId" | "tokens" | "startTime" | "endTime">;
type DailyPartitionCoverage =
  | "lifetime-covered"
  | "session-predates-window"
  | "board-start-unavailable"
  | "query-truncated";

interface WindowIncompleteSession {
  readonly sessionId: string;
  readonly reason: Exclude<DailyPartitionCoverage, "lifetime-covered">;
  readonly boardStartedAt?: string;
  readonly isCodex: boolean;
}

let available = false;
let unavailableReason = "";
let joined: Joined[] = [];
let settled: Joined[] = [];
let live: Joined[] = [];
/* Adjudicated once, read by both the per-session gate and the aggregate, so the
   two cannot disagree about which rows BurnBar truncated. */
const settledVerdicts = new Map<string, Verdict>();
let burnbarSessions = 0;
let uuidSessions = 0;
let cronSessions = 0;
let codexRows = 0;
let codexSessions = 0;
let joinedCodexSessions = 0;
let comparableCodexSessions = 0;
let windowIncompleteSessions: WindowIncompleteSession[] = [];
let unjoinedCodex: string[] = [];
let usageReadTruncated = false;
let unjoinedUuid: string[] = [];
let unjoinedSubagents: string[] = [];
let subagentsWithoutBoardParent: string[] = [];
let unknownSessionIds: string[] = [];
let evidenceWindowHours = MAX_EVIDENCE_WINDOW_HOURS;
let excludedBurnbarTokenShare = 0;

/* GRDB stores these UTC timestamps without a zone marker. Date.parse would
   otherwise read them in the machine's local zone and move the quiet boundary. */
const parseBurnBarTimestamp = (value: string): number =>
  Date.parse(`${value.replace(" ", "T")}Z`);

const burnBarBaseSessionId = (sessionId: string): string =>
  DAILY_PARTITION_SOURCE_SESSION.exec(sessionId)?.[1] ?? sessionId;

/* OpenBurnBar rows are cumulative snapshots inside one accounting identity.
   Ordinary session ids use one lifetime identity. Codex's `<uuid>#day-<epoch>`
   ids use one identity per day: snapshots within that partition remain
   cumulative (MAX), while separate day partitions are additive (SUM) after
   their base session identity has been recovered. Identity normalization and
   accounting therefore remain separate operations. Exact repeats are removed
   explicitly before either aggregation. */
const aggregateBurnBarSessions = (rows: readonly BurnBarJoinRow[]): Map<string, BurnBarSession> => {
  const partitions = new Map<
    string,
    BurnBarSession & { readonly baseSessionId: string }
  >();
  const seen = new Set<string>();
  for (const row of rows) {
    const fingerprint = JSON.stringify([row.sessionId, row.tokens, row.startTime, row.endTime ?? null]);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    const previous = partitions.get(row.sessionId);
    const observedAtMs = row.endTime ? parseBurnBarTimestamp(row.endTime) : undefined;
    const tokens = row.tokens;
    if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens < 0) {
      throw new Error(`BurnBar returned invalid tokens for ${row.sessionId}`);
    }
    partitions.set(row.sessionId, {
      baseSessionId: burnBarBaseSessionId(row.sessionId),
      tokens: previous ? Math.max(previous.tokens, tokens) : tokens,
      updatedAtMs: observedAtMs === undefined
        ? previous?.updatedAtMs
        : Math.max(previous?.updatedAtMs ?? -Infinity, observedAtMs),
      accounting: DAILY_PARTITION_SOURCE_SESSION.test(row.sessionId)
        ? "daily-partitioned"
        : "session-cumulative",
    });
  }

  const sessions = new Map<string, BurnBarSession>();
  for (const partition of partitions.values()) {
    const previous = sessions.get(partition.baseSessionId);
    if (previous && previous.accounting !== partition.accounting) {
      throw new Error(
        `BurnBar mixed lifetime and daily-partition accounting for ${partition.baseSessionId}`,
      );
    }
    sessions.set(partition.baseSessionId, {
      tokens: partition.accounting === "daily-partitioned"
        ? (previous?.tokens ?? 0) + partition.tokens
        : partition.tokens,
      updatedAtMs: partition.updatedAtMs === undefined
        ? previous?.updatedAtMs
        : Math.max(previous?.updatedAtMs ?? -Infinity, partition.updatedAtMs),
      accounting: partition.accounting,
    });
  }
  return sessions;
};

const dailyPartitionCoverage = (
  boardStartedAt: string | undefined,
  windowFromMs: number,
  readComplete: boolean,
): DailyPartitionCoverage => {
  if (!readComplete) return "query-truncated";
  const boardStartedAtMs = boardStartedAt === undefined ? Number.NaN : Date.parse(boardStartedAt);
  if (!Number.isFinite(boardStartedAtMs)) return "board-start-unavailable";
  return boardStartedAtMs < windowFromMs ? "session-predates-window" : "lifetime-covered";
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
/* THE ADJUDICATION. `/api/debug/session-calls` returns this board's per-call
   series and its running totals, so "BurnBar stopped recording" is a checkable
   claim rather than a comfortable story: BurnBar's total for the session either
   IS one of our running totals or it is not.

   `prefixSums` is published by the endpoint. A provider that keeps no per-call
   series (Codex) returns none, and that verdict is `unadjudicable` — never
   `explained`, because a check that treats "cannot tell" as "fine" is how the
   next real defect gets waved through. */
type Verdict = "explained-by-truncation" | "unexplained" | "unadjudicable";

const SESSION_CALLS_URL = `${BOARD_ORIGIN}/api/debug/session-calls`;

interface BoardUsageEvidence {
  readonly prefixSums?: readonly number[];
  readonly processedSnapshots?: readonly ProcessedSnapshot[];
}

async function boardUsageEvidence(agentId: string): Promise<BoardUsageEvidence | undefined> {
  try {
    const response = await fetch(
      `${SESSION_CALLS_URL}?agent=${encodeURIComponent(agentId)}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!response.ok) return undefined;
    const body = await response.json() as { prefixSums?: unknown; processedSnapshots?: unknown };
    const prefixSums = Array.isArray(body.prefixSums)
      && body.prefixSums.every((value) => typeof value === "number" && Number.isFinite(value))
      ? body.prefixSums as number[]
      : undefined;
    const processedSnapshots = Array.isArray(body.processedSnapshots)
      && body.processedSnapshots.every((value) => {
        if (!value || typeof value !== "object") return false;
        const snapshot = value as { at?: unknown; total?: unknown };
        return typeof snapshot.at === "string"
          && snapshot.at.length > 0
          && typeof snapshot.total === "number"
          && Number.isFinite(snapshot.total);
      })
      ? body.processedSnapshots as ProcessedSnapshot[]
      : undefined;
    return prefixSums !== undefined || processedSnapshots !== undefined
      ? { prefixSums, processedSnapshots }
      : undefined;
  } catch {
    return undefined;
  }
}

/* The series lookup is a parameter so the verdict that ALLOWS a disagreement to
   pass can be exercised deterministically. Whether that branch is reachable on
   live data depends on which sessions are inside the evidence window tonight,
   and "we could not test the one path that suppresses a failure" is not a
   position this file can hold. */
async function adjudicate(
  row: Joined,
  fetchEvidence: (agentId: string) => Promise<BoardUsageEvidence | undefined> = boardUsageEvidence,
): Promise<Verdict> {
  /* Board-LOWER is never explainable: a recorder that stopped early cannot have
     recorded more than we did, so no series needs fetching to know that. */
  if (row.board < row.burnbar) return "unexplained";
  if (!row.agentId) return "unadjudicable";
  const evidence = await fetchEvidence(row.agentId);
  if (!evidence) return "unadjudicable";
  if (evidence.prefixSums?.includes(row.burnbar)) return "explained-by-truncation";
  const hasEvidence = Boolean(evidence.prefixSums?.length || evidence.processedSnapshots?.length);
  if (!hasEvidence) return "unadjudicable";

  const boardUpdatedAtMs = Date.parse(row.boardUpdatedAt);
  if (
    SUBAGENT_SOURCE_SESSION.test(row.sessionId)
    && row.burnbarUpdatedAtMs !== undefined
    && Number.isFinite(boardUpdatedAtMs)
    && row.burnbarUpdatedAtMs < boardUpdatedAtMs
    && historicallyAgreesAt(row.burnbar, row.burnbarUpdatedAtMs, evidence.processedSnapshots)
  ) {
    return "explained-by-truncation";
  }
  return "unexplained";
}

const liveAnomalies = (rows: readonly Comparison[]): Comparison[] =>
  rows.filter(({ board, burnbar }) => {
    if (board >= burnbar || burnbar <= 0) return false;
    return (burnbar - board) / burnbar * 100 > LIVE_READ_SKEW_EPSILON_PCT;
  });

interface ProcessedSnapshot {
  readonly at: string;
  readonly total: number;
}

const historicallyAgreesAt = (
  burnbar: number,
  burnbarUpdatedAtMs: number | undefined,
  snapshots: readonly ProcessedSnapshot[] | undefined,
): boolean => {
  if (
    !Number.isFinite(burnbar)
    || burnbar <= 0
    || burnbarUpdatedAtMs === undefined
    || !Number.isFinite(burnbarUpdatedAtMs)
    || !snapshots?.length
  ) return false;

  let aligned: ProcessedSnapshot | undefined;
  for (const snapshot of snapshots) {
    const atMs = Date.parse(snapshot.at);
    if (!Number.isFinite(atMs) || !Number.isFinite(snapshot.total)) return false;
    if (atMs <= burnbarUpdatedAtMs) aligned = snapshot;
  }
  if (!aligned) return false;
  const continued = snapshots.some((snapshot) =>
    Date.parse(snapshot.at) > burnbarUpdatedAtMs && snapshot.total > aligned!.total
  );
  const driftPct = Math.abs(aligned.total - burnbar) / burnbar * 100;
  return driftPct <= LIVE_READ_SKEW_EPSILON_PCT && continued;
};

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

  let evidenceWindow: ReturnType<typeof evidenceWindowFor>;
  try {
    evidenceWindow = evidenceWindowFor(snapshot.scanWindowHours, snapshot.generatedAt);
    evidenceWindowHours = evidenceWindow.hours;
  } catch (error) {
    unavailableReason = error instanceof Error ? error.message : String(error);
    console.warn(`[cross-source] SKIPPED: ${unavailableReason}`);
    return;
  }

  const now = evidenceWindow.toMs;
  const windowFromMs = evidenceWindow.fromMs;
  /* Paged. At 500 rows this saw only the most recent slice of the evidence
     window — the fleet now produces more than that in two days — so "every joined
     session agrees" was a claim about whichever sessions happened to land in
     the tail of the page. */
  const usage = await getAllUsageInvocations(
    new Date(windowFromMs).toISOString(),
    new Date(now).toISOString(),
  );
  if (!usage.available || usage.invocations.length === 0) {
    unavailableReason = `BurnBar returned no readable rows for the last ${evidenceWindowHours}h`;
    console.warn(`[cross-source] SKIPPED: ${unavailableReason}`);
    return;
  }

  const codexRowsFromSource = usage.invocations
    .filter((row) => row.provider.trim().toLowerCase() === "codex");
  codexRows = codexRowsFromSource.length;
  const codexSessionIds = new Set(
    codexRowsFromSource.map((row) => burnBarBaseSessionId(row.sessionId)),
  );
  codexSessions = codexSessionIds.size;
  usageReadTruncated = usage.truncated;
  const burnbarBySession = aggregateBurnBarSessions(usage.invocations);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boardAgents: any[] = (snapshot.programs ?? []).flatMap((program: any) => program.agents ?? []);
  const boardBySession = new Map<
    string,
    {
      tokens: number;
      activity?: ActivityState;
      startedAt?: string;
      updatedAt: string;
      agentId?: string;
    }
  >();
  for (const agent of boardAgents) {
    if (
      typeof agent?.sourceSessionId === "string"
      && typeof agent?.tokens?.sessionProcessed === "number"
      && typeof agent?.updatedAt === "string"
    ) {
      boardBySession.set(agent.sourceSessionId, {
        tokens: agent.tokens.sessionProcessed,
        activity: agent.activity,
        startedAt: typeof agent.startedAt === "string" ? agent.startedAt : undefined,
        updatedAt: agent.updatedAt,
        // Carried so a disagreement can be adjudicated against our own per-call
        // series rather than argued about.
        agentId: typeof agent.id === "string" ? agent.id : undefined,
      });
    }
  }

  burnbarSessions = burnbarBySession.size;
  for (const [sessionId, burnbarSession] of burnbarBySession) {
    const isCodex = codexSessionIds.has(sessionId);
    const isUuid = UUID_SOURCE_SESSION.test(sessionId);
    const subagent = SUBAGENT_SOURCE_SESSION.exec(sessionId);
    if (isUuid) uuidSessions += 1;
    else if (CRON_SOURCE_SESSION.test(sessionId)) cronSessions += 1;
    else if (!subagent) unknownSessionIds.push(sessionId);

    const boardSession = boardBySession.get(sessionId);
    if (boardSession === undefined) {
      if (isCodex) unjoinedCodex.push(sessionId);
      if (isUuid) unjoinedUuid.push(sessionId);
      else if (subagent) {
        unjoinedSubagents.push(sessionId);
        if (!boardBySession.has(subagent[1]!)) subagentsWithoutBoardParent.push(sessionId);
      }
      continue;
    }
    if (isCodex) joinedCodexSessions += 1;
    if (burnbarSession.accounting === "daily-partitioned") {
      const coverage = dailyPartitionCoverage(
        boardSession.startedAt,
        windowFromMs,
        !usage.truncated,
      );
      if (coverage !== "lifetime-covered") {
        windowIncompleteSessions.push({
          sessionId,
          reason: coverage,
          boardStartedAt: boardSession.startedAt,
          isCodex,
        });
        continue;
      }
    }
    if (isCodex) comparableCodexSessions += 1;
    const board = boardSession.tokens;
    const burnbar = burnbarSession.tokens;
    const driftPct = burnbar > 0 ? Math.abs(board - burnbar) / burnbar * 100 : 0;
    joined.push({
      sessionId,
      board,
      burnbar,
      driftPct,
      agentId: boardSession.agentId,
      boardActivity: boardSession.activity,
      boardUpdatedAt: boardSession.updatedAt,
      burnbarUpdatedAtMs: burnbarSession.updatedAtMs,
    });
  }
  const excludedSessionIds = new Set(
    [...burnbarBySession.keys()].filter((sessionId) =>
      CRON_SOURCE_SESSION.test(sessionId)
      || (SUBAGENT_SOURCE_SESSION.test(sessionId) && !boardBySession.has(sessionId))
    ),
  );
  excludedBurnbarTokenShare = excludedTokenShare(burnbarBySession, excludedSessionIds);
  available = joined.length > 0;
  if (!available) {
    unavailableReason = "BurnBar returned rows, but none joined to a board session with token and update fields";
    console.warn(`[cross-source] SKIPPED: ${unavailableReason}`);
    return;
  }
  settled = joined.filter((row) => isSettled(row, now));
  live = joined.filter((row) => !isSettled(row, now));
  console.info(
    `[cross-source] window=${evidenceWindowHours}h settled=${settled.length} live=${live.length} `
    + `excludedCron=${cronSessions} excludedSubagents=${unjoinedSubagents.length} `
    + `unjoinedUuid=${unjoinedUuid.length} unknown=${unknownSessionIds.length} `
    + `codexRows=${codexRows} codexIdentityJoined=${joinedCodexSessions}/${codexSessions} `
    + `codexComparable=${comparableCodexSessions} `
    + `codexWindowIncomplete=${windowIncompleteSessions.filter((row) => row.isCodex).length}`,
  );
  for (const row of windowIncompleteSessions) {
    console.info(
      `[cross-source] unadjudicable-window: ${row.sessionId} (${row.reason}; `
      + `board started ${row.boardStartedAt ?? "unavailable"}, query began `
      + `${new Date(windowFromMs).toISOString()})`,
    );
  }

  for (const row of settled) {
    if (row.driftPct <= PER_SESSION_TOLERANCE_PCT) continue;
    settledVerdicts.set(row.sessionId, await adjudicate(row));
  }
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
  test("an exact-head preview port cannot redirect the live gate off loopback", () => {
    expect(boardOriginFor(undefined)).toBe(PRODUCTION_BOARD_ORIGIN);
    expect(boardOriginFor("1")).toBe("http://127.0.0.1:1");
    expect(boardOriginFor("4711")).toBe("http://127.0.0.1:4711");
    expect(boardOriginFor("65535")).toBe("http://127.0.0.1:65535");
    expect(() => boardOriginFor("0")).toThrow("decimal loopback port");
    expect(() => boardOriginFor("65536")).toThrow("decimal loopback port");
    expect(() => boardOriginFor("80@evil.com")).toThrow("decimal loopback port");
  });

  test("the foreign query never reaches past the board evidence window", () => {
    expect(evidenceWindowHoursFor(36)).toBe(36);
    expect(evidenceWindowHoursFor(48)).toBe(48);
    expect(evidenceWindowHoursFor(72)).toBe(MAX_EVIDENCE_WINDOW_HOURS);
    expect(() => evidenceWindowHoursFor(0)).toThrow("positive scan window");
    expect(() => evidenceWindowHoursFor(-1)).toThrow("positive scan window");
    expect(() => evidenceWindowHoursFor(Number.NaN)).toThrow("positive scan window");
    expect(() => evidenceWindowHoursFor("36")).toThrow("positive scan window");
    expect(() => evidenceWindowHoursFor(undefined)).toThrow("positive scan window");
    expect(evidenceWindowFor(36, "2026-08-10T18:00:00.000Z")).toEqual({
      hours: 36,
      fromMs: Date.parse("2026-08-09T06:00:00.000Z"),
      toMs: Date.parse("2026-08-10T18:00:00.000Z"),
    });
    expect(() => evidenceWindowFor(36, undefined)).toThrow("valid snapshot timestamp");
    expect(() => evidenceWindowFor(36, "not-a-time")).toThrow("valid snapshot timestamp");
  });

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
    expect(
      settled.length - settledVerdicts.size,
      "too few settled sessions remain comparable after named disagreements",
    ).toBeGreaterThan(20);
    expect(settled.some(({ burnbar }) => burnbar > 100_000)).toBe(true);
    expect(
      live.length,
      `${live.length} live sessions are excluded from the 5% gate, against ${settled.length} settled`,
    ).toBeLessThan(settled.length);
    expect(
      usageReadTruncated,
      "the cross-source gate cannot claim a complete window from a capped BurnBar read",
    ).toBe(false);
  });

  test("a settled disagreement is either explained by BurnBar, or it fails", async () => {
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
    const disagreeing = settled.filter(({ driftPct }) => driftPct > PER_SESSION_TOLERANCE_PCT);

    const verdicts = disagreeing.map((row) => ({ row, verdict: settledVerdicts.get(row.sessionId) ?? "unexplained" }));
    const unexplained = verdicts.filter(({ verdict }) => verdict === "unexplained");
    const truncated = verdicts.filter(({ verdict }) => verdict === "explained-by-truncation");
    const unadjudicable = verdicts.filter(({ verdict }) => verdict === "unadjudicable");

    /* RECORDED, NOT ASSERTED — the evidence about BurnBar that this file exists
       to collect. Printed every run so the measurement work planned on top of it
       has a series to read, and so a growing hole cannot go unnoticed. */
    console.info(
      `[cross-source] settled disagreements: ${disagreeing.length}`
      + ` (${truncated.length} explained by BurnBar truncation,`
      + ` ${unadjudicable.length} unadjudicable — no per-call series,`
      + ` ${unexplained.length} unexplained)`,
    );
    for (const { row, verdict } of verdicts) console.info(`[cross-source] ${verdict}: ${describeDrift(row)}`);

    expect(unexplained.map(({ row }) => describeDrift(row))).toEqual([]);
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

  /* The adjudicator decides which disagreements are allowed to pass, so it gets
     the same treatment as the checks it feeds: a case that must be explained, a
     case that must NOT be, and the "cannot tell" case that must never be
     mistaken for either. Board-lower can never be explained by truncation — a
     recorder that stopped early cannot record MORE than we did. */
  test("truncation explains a board-high prefix, and nothing else", async () => {
    const base = { sessionId: "adjudicated", boardUpdatedAt: "2026-08-04T00:00:00.000Z" };
    const noSeries = await adjudicate({ ...base, board: 200, burnbar: 100, driftPct: 100 });
    expect(noSeries, "no agent id means no series to adjudicate against").toBe("unadjudicable");

    const boardLower = await adjudicate({
      ...base, agentId: "claude:whatever", board: 100, burnbar: 200, driftPct: 50,
    });
    expect(boardLower, "BurnBar cannot record more than we did by stopping early").toBe("unexplained");

    /* The real 7a2ae0aa shape, kept as a fixture because the live window will
       not always contain one: BurnBar's total IS our running total at call 98
       of 146, so it stopped writing and the board is not over-counting. */
    const series = [12_000_000, 12_227_799, 21_200_134];
    const truncated = await adjudicate(
      { ...base, agentId: "claude:7a2ae0aa", board: 21_200_134, burnbar: 12_227_799, driftPct: 73.4 },
      async () => ({ prefixSums: series }),
    );
    expect(truncated, "a BurnBar total equal to one of our prefixes is truncation").toBe("explained-by-truncation");

    /* One digit off a prefix is NOT truncation. This is the case the whole
       adjudication exists to keep failing: a board-high disagreement that no
       stopping point explains. */
    const notAPrefix = await adjudicate(
      { ...base, agentId: "claude:7a2ae0aa", board: 21_200_134, burnbar: 12_227_800, driftPct: 73.4 },
      async () => ({ prefixSums: series }),
    );
    expect(notAPrefix, "a near-miss is not a prefix, and must not be excused").toBe("unexplained");

    const emptySeries = await adjudicate(
      { ...base, agentId: "codex:no-series", board: 200, burnbar: 100, driftPct: 100 },
      async () => ({ prefixSums: [] }),
    );
    expect(emptySeries, "a provider with no per-call series cannot be adjudicated").toBe("unadjudicable");
  });

  test("a foreign recorder that stopped is proved against our total at its exact end time", () => {
    const foreignEnd = Date.parse("2026-08-10T03:32:59.711Z");
    const snapshots: ProcessedSnapshot[] = [
      { at: "2026-08-10T03:32:59.711Z", total: 12_916_633 },
      { at: "2026-08-10T07:54:01.115Z", total: 76_331_902 },
    ];

    expect(historicallyAgreesAt(12_872_691, foreignEnd, snapshots)).toBe(true);
    expect(historicallyAgreesAt(12_000_000, foreignEnd, snapshots)).toBe(false);
    expect(historicallyAgreesAt(12_872_691, foreignEnd, snapshots.slice(0, 1))).toBe(false);
    expect(historicallyAgreesAt(12_872_691, undefined, snapshots)).toBe(false);
    expect(historicallyAgreesAt(12_872_691, foreignEnd, undefined)).toBe(false);
  });

  test("only a time-anchored child disagreement can use historical read skew", async () => {
    const foreignEnd = Date.parse("2026-08-10T03:32:59.711Z");
    const parent = "578d9487-dceb-4034-b4f1-97a74ae247fd";
    const evidence: BoardUsageEvidence = {
      prefixSums: [76_331_902],
      processedSnapshots: [
        { at: "2026-08-10T03:32:59.711Z", total: 12_916_633 },
        { at: "2026-08-10T07:54:01.115Z", total: 76_331_902 },
      ],
    };
    const child: Joined = {
      sessionId: `${parent}/agent-a57b9d78d3f60c996`,
      agentId: `claude:${parent}/agent-a57b9d78d3f60c996`,
      board: 76_331_902,
      burnbar: 12_872_691,
      driftPct: 493,
      burnbarUpdatedAtMs: foreignEnd,
      boardUpdatedAt: "2026-08-10T07:54:01.115Z",
    };

    expect(await adjudicate(child, async () => evidence)).toBe("explained-by-truncation");
    expect(await adjudicate(
      { ...child, sessionId: parent },
      async () => evidence,
    ), "ordinary UUID sessions still require an exact prefix").toBe("unexplained");
    expect(await adjudicate(
      { ...child, burnbarUpdatedAtMs: undefined },
      async () => evidence,
    ), "a child without a foreign end-time cannot use a fuzzy historical match").toBe("unexplained");
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

  test("Codex daily partitions keep one base identity and sum each day's maximum", () => {
    const baseSessionId = "019fe713-18f5-7f50-8e65-a6e40049e8f0";
    const firstDay = `${baseSessionId}#day-1786233600`;
    const secondDay = `${baseSessionId}#day-1786320000`;
    const rows: BurnBarJoinRow[] = [
      {
        sessionId: firstDay,
        tokens: 190_000_000,
        startTime: "2026-08-09 10:00:00.000",
        endTime: "2026-08-09 10:30:00.000",
      },
      {
        sessionId: firstDay,
        tokens: 199_547_464,
        startTime: "2026-08-09 10:00:00.000",
        endTime: "2026-08-09 11:00:00.000",
      },
      /* An exact duplicate must not make the first partition additive. */
      {
        sessionId: firstDay,
        tokens: 199_547_464,
        startTime: "2026-08-09 10:00:00.000",
        endTime: "2026-08-09 11:00:00.000",
      },
      {
        sessionId: secondDay,
        tokens: 40_964_989,
        startTime: "2026-08-10 09:00:00.000",
        endTime: "2026-08-10 09:30:00.000",
      },
    ];

    const sessions = aggregateBurnBarSessions(rows);

    expect(
      [...sessions].map(([sessionId, session]) => ({ sessionId, tokens: session.tokens })),
    ).toEqual([{ sessionId: baseSessionId, tokens: 240_512_453 }]);
  });

  test("mixed lifetime and daily partition accounting fails closed in either input order", () => {
    const baseSessionId = "019fe713-18f5-7f50-8e65-a6e40049e8f0";
    const lifetime: BurnBarJoinRow = {
      sessionId: baseSessionId,
      tokens: 199_547_464,
      startTime: "2026-08-09 10:00:00.000",
      endTime: "2026-08-09 11:00:00.000",
    };
    const daily: BurnBarJoinRow = {
      sessionId: `${baseSessionId}#day-1786233600`,
      tokens: 40_964_989,
      startTime: "2026-08-10 09:00:00.000",
      endTime: "2026-08-10 09:30:00.000",
    };
    const expectedMessage = `BurnBar mixed lifetime and daily-partition accounting for ${baseSessionId}`;

    for (const rows of [[lifetime, daily], [daily, lifetime]]) {
      let observed: unknown;
      try {
        aggregateBurnBarSessions(rows);
      } catch (error) {
        observed = error;
      }

      expect(observed).toBeInstanceOf(Error);
      expect((observed as Error).message).toBe(expectedMessage);
    }
  });

  test("daily partition sums need a complete read covering the board lifetime", () => {
    const windowFromMs = Date.parse("2026-08-10T00:00:00.000Z");

    expect(dailyPartitionCoverage("2026-08-10T00:00:00.000Z", windowFromMs, true))
      .toBe("lifetime-covered");
    expect(dailyPartitionCoverage("2026-08-09T23:59:59.999Z", windowFromMs, true))
      .toBe("session-predates-window");
    expect(dailyPartitionCoverage(undefined, windowFromMs, true))
      .toBe("board-start-unavailable");
    expect(dailyPartitionCoverage("2026-08-10T01:00:00.000Z", windowFromMs, false))
      .toBe("query-truncated");
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
    const total = (rows: readonly Joined[], pick: (row: Joined) => number) =>
      rows.reduce((sum, row) => sum + pick(row), 0);

    /* The whole-population figure is RECORDED, because sessions BurnBar
       truncated pull it in a known direction and asserting on it would be
       asserting on BurnBar's recording gaps. */
    const allBoard = total(settled, (row) => row.board);
    const allBurnbar = total(settled, (row) => row.burnbar);
    const allDrift = allBurnbar > 0 ? Math.abs(allBoard - allBurnbar) / allBurnbar * 100 : 0;
    console.info(
      `[cross-source] settled aggregate: board ${allBoard.toLocaleString()} vs BurnBar `
      + `${allBurnbar.toLocaleString()} — ${allDrift.toFixed(2)}% ${allBoard > allBurnbar ? "board high" : "board low"}`,
    );

    /* ASSERTED on the sessions that agreed one by one. This is what the check
       was always FOR: per-session tolerance permits a little slack each, and a
       systematic accounting change would spend all of it in the same direction,
       which only the aggregate can see.

       Rows that already disagreed are out, and their verdicts carry that
       argument instead — asserting on them here would re-run the per-session
       gate under a second name, and for the unadjudicable ones it would assert
       on exactly the equality Emilio's decision removed. What is excluded is
       counted and printed, so the hole cannot widen unseen. */
    const comparable = settled.filter((row) => !settledVerdicts.has(row.sessionId));
    console.info(
      `[cross-source] aggregate asserted across ${comparable.length} of ${settled.length} settled sessions;`
      + ` ${settled.length - comparable.length} excluded as already-disagreeing (see verdicts above)`,
    );
    const board = total(comparable, (row) => row.board);
    const burnbar = total(comparable, (row) => row.burnbar);
    const driftPct = burnbar > 0 ? Math.abs(board - burnbar) / burnbar * 100 : 0;

    expect(
      driftPct,
      `across the ${comparable.length} settled sessions that agreed individually, this board counted `
      + `${board.toLocaleString()} and OpenBurnBar recorded ${burnbar.toLocaleString()} — `
      + `${board > burnbar ? "OUR total is high" : "OUR total is low"}`,
    ).toBeLessThan(1);
  });

  test("every excluded row has a named shape and the size of the hole is pinned", () => {
    /* THE EXCLUSIONS, asserted rather than described.

       `cron_*` rows represent work with no board agent. Unmatched
       `<parent>/agent-*` rows represent provider-native child work whose own
       transcript is unavailable; they stay separate because folding their
       tokens into the parent would change what `sessionProcessed` means.
       Neither class may quietly become a claim that the exact-session join is
       fleet-wide.

       Unknown shapes fail immediately. Every excluded child must resolve to a
       parent the board models, and all exclusions together remain below the
       existing one-third coverage ceiling. */
    if (!available) return;

    expect(unknownSessionIds, "BurnBar returned session-id shapes this check has not classified").toEqual([]);
    expect(
      subagentsWithoutBoardParent,
      "provider-native subagent rows must resolve to a parent session modeled by the board",
    ).toEqual([]);
    const excludedSessions = cronSessions + unjoinedSubagents.length;
    expect(
      excludedSessions / burnbarSessions,
      `${excludedSessions} of ${burnbarSessions} burnbar sessions are outside this exact-session check`,
    ).toBeLessThan(0.34);
    expect(
      excludedBurnbarTokenShare,
      `${(excludedBurnbarTokenShare * 100).toFixed(2)}% of measured BurnBar tokens are outside this exact-session check`,
    ).toBeLessThan(0.34);
  });

  test("a small excluded identity count cannot hide most measured tokens", () => {
    const sessions = new Map<string, Pick<BurnBarSession, "tokens">>([
      ["excluded", { tokens: 700 }],
      ["joined-1", { tokens: 100 }],
      ["joined-2", { tokens: 100 }],
      ["joined-3", { tokens: 100 }],
    ]);
    expect(excludedTokenShare(sessions, new Set(["excluded"]))).toBe(0.7);
    expect(() => excludedTokenShare(
      new Map([["unknown", { tokens: null as unknown as number }]]),
      new Set(["unknown"]),
    )).toThrow("invalid tokens");
  });

  test("no uuid session silently falls out of the join", () => {
    /* The uuid side was measured clean: every uuid session id in the board's
       evidence window matched a
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

  test("a current Codex session reaches OpenBurnBar and joins the board", () => {
    if (!available) return;

    const windowIncompleteCodex = windowIncompleteSessions.filter((row) => row.isCodex);
    expect(codexRows, `OpenBurnBar returned no Codex source rows in the current ${evidenceWindowHours}-hour window`)
      .toBeGreaterThan(0);
    expect(
      codexSessions,
      `OpenBurnBar recorded no Codex session in the current ${evidenceWindowHours}-hour window`,
    ).toBeGreaterThan(0);
    expect(
      joinedCodexSessions,
      `${codexSessions} Codex sessions reached OpenBurnBar but none joined an Ant Hill sourceSessionId`,
    ).toBeGreaterThan(0);
    expect(
      joinedCodexSessions + unjoinedCodex.length,
      "every normalized Codex identity must be counted as joined or explicitly unjoined",
    ).toBe(codexSessions);
    expect(
      comparableCodexSessions + windowIncompleteCodex.length,
      "every joined Codex identity must be lifetime-comparable or explicitly window-incomplete",
    ).toBe(joinedCodexSessions);
    if (windowIncompleteCodex.length < joinedCodexSessions) {
      expect(
        comparableCodexSessions,
        "the current window covers at least one joined Codex lifetime, so one must be compared",
      ).toBeGreaterThan(0);
    }
  });

  test("a provider-native child id is not mistaken for its parent uuid", () => {
    const parent = "578d9487-dceb-4034-b4f1-97a74ae247fd";
    const child = `${parent}/agent-a57b9d78d3f60c996`;

    expect(UUID_SOURCE_SESSION.test(parent)).toBe(true);
    expect(UUID_SOURCE_SESSION.test(child)).toBe(false);
    expect(SUBAGENT_SOURCE_SESSION.exec(child)?.[1]).toBe(parent);
  });
});
