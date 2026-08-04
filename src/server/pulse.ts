import { getUsageSummary, type UsageSummary } from "./burnbar";
import { AGENT_IDLE_GAP_MS } from "./types";
import type {
  AgentSnapshot,
  HubPulse,
  HubSnapshot,
  PulseActivityBucket,
} from "../shared/types";

const BUCKET_MS = 5 * 60_000;
const HOUR_MS = 60 * 60_000;
// One definition of "quiet long enough to not be working", shared with the
// collectors' active-time accumulator so the two cannot drift apart.
const STALL_THRESHOLD_MS = AGENT_IDLE_GAP_MS;
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
  /* Refreshes that landed in this bucket carrying real collector output. Zero
     means the count beside it describes nothing that was measured. */
  measuredObservations: number;
  tokens: number | null;
  activeAgentIds: Set<string>;
}

/** Every provider stale means session collection produced nothing at all, so an
    agent count taken from that snapshot is not a small number — it is no
    number. A partial failure still measures something and is left alone. */
const PROVIDER_COUNT = 4;

export class PulseTracker {
  #observedSinceMs: number;
  #observedSince: string;
  #burnReader: BurnReader;
  #agents = new Map<string, AgentMemory>();
  #buckets = new Map<number, ActivityBucket>();
  #latestSnapshot?: HubSnapshot;
  #lastBurnRefreshMs?: number;
  #burnRefreshInFlight?: Promise<void>;
  #costInitialized = false;
  #costLastHourUsd: number | null = null;
  #costProvenance: "burnbar" | "unavailable" = "unavailable";
  #costIsFloor = false;
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
    /* A snapshot carrying no health information is not evidence of an outage,
       so it counts as measured. Defaulting the other way would blank the trend
       for any caller that builds a snapshot without controlHealth — turning a
       marker for "we could not look" into one that fires when we did. */
    if ((snapshot.controlHealth?.staleSources?.length ?? 0) < PROVIDER_COUNT) {
      currentBucket.measuredObservations += 1;
    }
    const seen = new Set<string>();

    for (const agent of snapshot.programs.flatMap((program) => program.agents)) {
      seen.add(agent.id);
      const previous = this.#agents.get(agent.id);
      const lastUpdatedAtMs = Date.parse(agent.updatedAt);
      const updatedAtAdvanced = previous === undefined
        || (Number.isFinite(lastUpdatedAtMs)
          && (!Number.isFinite(previous.lastUpdatedAtMs) || lastUpdatedAtMs > previous.lastUpdatedAtMs));
      /* The `working -> idle|ended` edge used to be counted here as a
         completion. It is not one: `activity` comes from `statusFrom()`, which
         reads transcript recency alone, so this fired for an agent that thought
         for three minutes. It also fired again on every subsequent pause, and
         never once looked at whether the work succeeded. Nothing replaces it,
         because nothing in the data supports the claim — see PulseMomentum. */

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
      ...(this.#costIsFloor ? { costIsFloor: true } : {}),
      costProvenance: this.#costProvenance,
      ...(this.#costAsOf ? { costAsOf: this.#costAsOf } : {}),
      ...(this.#costNote ? { costNote: this.#costNote } : {}),
    };

    return {
      momentum: {
        working: this.#latestSnapshot?.totals.working ?? 0,
        completionsLastHour: null,
        completionsProvenance: "not-observable",
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
          activeSessions: bucket.measuredObservations > 0 ? bucket.activeSessions : null,
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
          measuredObservations: 0,
          tokens: null,
          activeAgentIds: new Set(),
        });
      }
    } else {
      this.#buckets.set(currentStartMs, {
        startMs: currentStartMs,
        activeSessions: 0,
        measuredObservations: 0,
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


  #applyBurnSummary(summary: UsageSummary | undefined): void {
    /* The BURN card had the same fleet-level gate the usage card just lost: it
       showed a cost only when EVERY invocation in the window was priced, so one
       unpriced Cursor call turned an hour of measured spend into "cost
       unavailable". The hour is the window an operator watches to decide
       whether to keep a swarm running, so withholding it there is the most
       expensive place to withhold it.

       Fall back to the measured floor and say that is what it is. `costIsFloor`
       exists so the card can mark it; a floor rendered as a total would be the
       opposite error, and on this number it would understate real spend while
       looking authoritative. */
    const round = (value: number): number => Math.round(value * 100) / 100;
    const complete = summary?.available
      && summary.costKnown
      && typeof summary.estimatedCostUsd === "number"
      && Number.isFinite(summary.estimatedCostUsd)
      ? round(summary.estimatedCostUsd)
      : null;
    const floor = summary?.available
      && typeof summary.measuredCostUsd === "number"
      && Number.isFinite(summary.measuredCostUsd)
      ? round(summary.measuredCostUsd)
      : null;
    const roundedCost = complete ?? floor;
    const costIsFloor = complete === null && floor !== null;
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
      : costIsFloor
        ? `measured floor · ${summary?.costMissingInvocations ?? 0} of ${summary?.invocations ?? 0} calls unpriced`
      : cursorUnknownCount > 0
        ? `${cursorUnknownCount} Cursor ${cursorUnknownCount === 1 ? "session reports" : "sessions report"} no billing data`
        : undefined;

    // The figure AND its explanation both count as displayed state: a read that
    // returns the same dollar total for a new reason still changes the card.
    if (this.#costInitialized
      && roundedCost === this.#costLastHourUsd
      && costIsFloor === this.#costIsFloor
      && costNote === this.#costNote) return;

    this.#costLastHourUsd = roundedCost;
    this.#costIsFloor = costIsFloor;
    this.#costProvenance = roundedCost === null ? "unavailable" : "burnbar";
    this.#costAsOf = roundedCost === null ? undefined : summary?.to;
    this.#costNote = costNote;
    this.#costInitialized = true;
  }
}
