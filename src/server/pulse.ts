import { getUsageSummary, type UsageSummary } from "./burnbar";
import type {
  AgentSnapshot,
  HubPulse,
  HubSnapshot,
  PulseActivityBucket,
} from "../shared/types";

const BUCKET_MS = 5 * 60_000;
const HOUR_MS = 60 * 60_000;
const STALL_THRESHOLD_MS = 15 * 60_000;
const BURN_REFRESH_TTL_MS = 60_000;
const BURN_REFRESH_TIMEOUT_MS = 20_000;
const MAX_BUCKETS = 13;
const MAX_PUBLISHED_BUCKETS = 12;

type BurnReader = () => Promise<UsageSummary>;

interface AgentMemory {
  lastActivity: AgentSnapshot["activity"];
  lastUpdatedAtMs: number;
  lastSessionTotal?: number;
}

interface ActivityBucket {
  startMs: number;
  activeSessions: number;
  completions: number;
  tokens: number | null;
  activeAgentIds: Set<string>;
}

export class PulseTracker {
  #observedSinceMs: number;
  #observedSince: string;
  #burnReader: BurnReader;
  #agents = new Map<string, AgentMemory>();
  #buckets = new Map<number, ActivityBucket>();
  #completions: number[] = [];
  #latestSnapshot?: HubSnapshot;
  #lastBurnRefreshMs?: number;
  #burnRefreshInFlight?: Promise<void>;
  #costInitialized = false;
  #costLastHourUsd: number | null = null;
  #costProvenance: "burnbar" | "unavailable" = "unavailable";
  #costAsOf?: string;
  #costNote?: string;
  #latestCursorUnknownCount = 0;

  constructor(
    burnReader?: BurnReader,
    observedSinceMs = Date.now(),
    private readonly burnRefreshTimeoutMs = BURN_REFRESH_TIMEOUT_MS,
  ) {
    this.#observedSinceMs = observedSinceMs;
    this.#observedSince = new Date(observedSinceMs).toISOString();
    this.#burnReader = burnReader ?? (() => {
      const toMs = Date.now();
      return getUsageSummary(new Date(toMs - HOUR_MS).toISOString(), new Date(toMs).toISOString());
    });
  }

  observe(snapshot: HubSnapshot, nowMs: number): void {
    this.#latestSnapshot = snapshot;
    this.#latestCursorUnknownCount = snapshot.programs
      .flatMap((program) => program.agents)
      .filter((agent) => (agent.activity === "working" || agent.activity === "idle") && agent.provider === "cursor")
      .length;
    const currentStartMs = Math.floor(nowMs / BUCKET_MS) * BUCKET_MS;
    const currentBucket = this.#ensureBucket(currentStartMs);
    const seen = new Set<string>();

    for (const agent of snapshot.programs.flatMap((program) => program.agents)) {
      seen.add(agent.id);
      const previous = this.#agents.get(agent.id);
      const lastUpdatedAtMs = Date.parse(agent.updatedAt);
      const updatedAtAdvanced = previous === undefined
        || (Number.isFinite(lastUpdatedAtMs)
          && (!Number.isFinite(previous.lastUpdatedAtMs) || lastUpdatedAtMs > previous.lastUpdatedAtMs));
      const completed = previous?.lastActivity === "working"
        && (agent.activity === "idle" || agent.activity === "ended");
      if (completed) {
        const completionAtMs = Number.isFinite(lastUpdatedAtMs)
          ? Math.min(lastUpdatedAtMs, nowMs)
          : nowMs;
        if (completionAtMs >= nowMs - HOUR_MS) {
          this.#completions.push(completionAtMs);
          this.#ensureBucket(Math.floor(completionAtMs / BUCKET_MS) * BUCKET_MS).completions += 1;
        }
      }

      if (
        updatedAtAdvanced
        && (agent.activity === "working" || agent.activity === "idle")
        && !currentBucket.activeAgentIds.has(agent.id)
      ) {
        currentBucket.activeAgentIds.add(agent.id);
        currentBucket.activeSessions += 1;
      }

      const sessionTotal = agent.tokens.sessionTotal;
      const reporting = agent.tokens.provenance === "observed"
        && typeof sessionTotal === "number"
        && Number.isFinite(sessionTotal);
      if (reporting) {
        currentBucket.tokens ??= 0;
        if (updatedAtAdvanced && previous?.lastSessionTotal !== undefined) {
          const delta = sessionTotal - previous.lastSessionTotal;
          if (delta >= 0) currentBucket.tokens += delta;
        }
      }

      this.#agents.set(agent.id, {
        lastActivity: agent.activity,
        lastUpdatedAtMs,
        lastSessionTotal: reporting ? sessionTotal : undefined,
      });
    }

    for (const agentId of this.#agents.keys()) {
      if (!seen.has(agentId)) this.#agents.delete(agentId);
    }
    this.#pruneCompletions(nowMs);
  }

  maybeRefreshBurnCost(nowMs = Date.now()): void {
    if (this.#burnRefreshInFlight) return;
    if (this.#lastBurnRefreshMs !== undefined && nowMs - this.#lastBurnRefreshMs < BURN_REFRESH_TTL_MS) return;
    this.#lastBurnRefreshMs = nowMs;
    this.#burnRefreshInFlight = (async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const summary = await Promise.race([
          this.#burnReader(),
          new Promise<undefined>((resolve) => {
            timeout = setTimeout(() => resolve(undefined), this.burnRefreshTimeoutMs);
          }),
        ]);
        this.#applyBurnSummary(summary);
      } catch {
        this.#applyBurnSummary(undefined);
      } finally {
        if (timeout) clearTimeout(timeout);
        this.#burnRefreshInFlight = undefined;
      }
    })();
  }

  report(nowMs: number): HubPulse {
    const currentStartMs = Math.floor(nowMs / BUCKET_MS) * BUCKET_MS;
    this.#ensureBucket(currentStartMs);
    this.#pruneCompletions(nowMs);

    const completedBuckets = [...this.#buckets.values()]
      .filter((bucket) => bucket.startMs < currentStartMs)
      .sort((left, right) => left.startMs - right.startMs)
      .slice(-MAX_PUBLISHED_BUCKETS);
    const coveredBuckets = completedBuckets.filter((bucket) => bucket.tokens !== null).slice(-2);
    const coveredTokens = coveredBuckets.reduce((total, bucket) => total + (bucket.tokens ?? 0), 0);
    const observedWindowMs = Math.floor(
      Math.min(HOUR_MS, Math.max(0, nowMs - this.#observedSinceMs)) / BUCKET_MS,
    ) * BUCKET_MS;
    const agents = this.#latestSnapshot?.programs.flatMap((program) => program.agents) ?? [];
    const liveAgents = agents.filter((agent) => agent.activity === "working" || agent.activity === "idle");
    const eligibleAgents = liveAgents.filter((agent) => agent.provider !== "cursor" && agent.tokens.provenance !== "unknown");
    const reportingAgents = eligibleAgents.filter(
      (agent) => agent.tokens.provenance === "observed"
        && typeof agent.tokens.sessionTotal === "number"
        && Number.isFinite(agent.tokens.sessionTotal),
    );
    const unknownAgents = liveAgents.length - eligibleAgents.length;
    const stalledAgentIds = liveAgents
      .filter((agent) => {
        const updatedAtMs = Date.parse(agent.updatedAt);
        return agent.status !== "attention"
          && agent.outcome === "healthy"
          && Number.isFinite(updatedAtMs)
          && nowMs - updatedAtMs >= STALL_THRESHOLD_MS;
      })
      .map((agent) => agent.id);
    const burn: HubPulse["burn"] = {
      tokensPerMin: coveredBuckets.length === 0
        ? null
        : Math.round(coveredTokens / (coveredBuckets.length * 5)),
      windowMs: coveredBuckets.length * BUCKET_MS,
      coverage: {
        reporting: reportingAgents.length,
        eligible: eligibleAgents.length,
        unknown: unknownAgents,
      },
      costLastHourUsd: this.#costLastHourUsd,
      costProvenance: this.#costProvenance,
      ...(this.#costAsOf ? { costAsOf: this.#costAsOf } : {}),
      ...(this.#costNote ? { costNote: this.#costNote } : {}),
    };

    return {
      momentum: {
        working: this.#latestSnapshot?.totals.working ?? 0,
        completionsLastHour: this.#completions.length,
        observedWindowMs,
        stalled: stalledAgentIds.length,
        stalledAgentIds,
        stallThresholdMs: STALL_THRESHOLD_MS,
      },
      burn,
      activity: {
        bucketMinutes: 5,
        windowMinutes: 60,
        observedSince: this.#observedSince,
        buckets: completedBuckets.map((bucket): PulseActivityBucket => ({
          start: new Date(bucket.startMs).toISOString(),
          activeSessions: bucket.activeSessions,
          completions: bucket.completions,
          tokens: bucket.tokens,
        })),
      },
    };
  }

  #ensureBucket(currentStartMs: number): ActivityBucket {
    const existing = this.#buckets.get(currentStartMs);
    if (existing) return existing;
    const latestStartMs = [...this.#buckets.keys()].sort((left, right) => left - right).at(-1);
    if (latestStartMs !== undefined && currentStartMs > latestStartMs) {
      for (let startMs = latestStartMs + BUCKET_MS; startMs <= currentStartMs; startMs += BUCKET_MS) {
        this.#buckets.set(startMs, {
          startMs,
          activeSessions: 0,
          completions: 0,
          tokens: null,
          activeAgentIds: new Set(),
        });
      }
    } else {
      this.#buckets.set(currentStartMs, {
        startMs: currentStartMs,
        activeSessions: 0,
        completions: 0,
        tokens: null,
        activeAgentIds: new Set(),
      });
    }
    while (this.#buckets.size > MAX_BUCKETS) {
      const oldestStartMs = [...this.#buckets.keys()].sort((left, right) => left - right)[0];
      if (oldestStartMs === undefined) break;
      this.#buckets.delete(oldestStartMs);
    }
    return this.#buckets.get(currentStartMs)!;
  }

  #pruneCompletions(nowMs: number): void {
    const cutoff = nowMs - HOUR_MS;
    this.#completions = this.#completions.filter((completedAtMs) => completedAtMs >= cutoff);
  }

  #applyBurnSummary(summary: UsageSummary | undefined): void {
    const roundedCost = summary?.available
      && summary.costKnown
      && typeof summary.estimatedCostUsd === "number"
      && Number.isFinite(summary.estimatedCostUsd)
      ? Math.round(summary.estimatedCostUsd * 100) / 100
      : null;
    const cursorMissingInvocations = summary?.byProvider
      .filter(({ provider, costUsd, invocations }) => /cursor/i.test(provider) && costUsd === null)
      .reduce((total, row) => total + row.invocations, 0) ?? 0;
    const cursorUnknownCount = Math.max(this.#latestCursorUnknownCount, cursorMissingInvocations);

    /* Why the cost is missing, in words the card can print. burn.coverage counts
       agents reporting token totals — it is the coverage OF tokensPerMin and has
       never described the cost, which comes from a different source entirely
       (the encrypted BurnBar database). With no reason to show beside "cost
       unavailable", the BURN card put the token coverage there instead, so a
       real 37k/min rate, an unavailable cost and "9/9 reporting" appeared in one
       sentence and read as three claims about the same number. Give the cost its
       own reason so nothing has to be borrowed. */
    const costNote = roundedCost === null
      ? summary === undefined
        ? "Cost source has not been read yet."
        : summary.available === false
          ? summary.error ?? "Cost source is unavailable."
          : "No priced invocations in this window."
      : cursorUnknownCount > 0
        ? `${cursorUnknownCount} Cursor ${cursorUnknownCount === 1 ? "session reports" : "sessions report"} no billing data`
        : undefined;

    // The figure AND its explanation both count as displayed state: a read that
    // returns the same dollar total for a new reason still changes the card.
    if (this.#costInitialized
      && roundedCost === this.#costLastHourUsd
      && costNote === this.#costNote) return;

    this.#costLastHourUsd = roundedCost;
    this.#costProvenance = roundedCost === null ? "unavailable" : "burnbar";
    this.#costAsOf = roundedCost === null ? undefined : summary?.to;
    this.#costNote = costNote;
    this.#costInitialized = true;
  }
}
