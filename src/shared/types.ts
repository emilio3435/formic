export type Provider = "codex" | "omp" | "claude" | "cursor";
export type AgentStatus = "running" | "waiting" | "attention" | "stale" | "archived";
export type ActivityState = "working" | "idle" | "ended" | "unknown";
export type ProcessState = "running" | "exited" | "died" | "unknown";
export type OutcomeState = "healthy" | "needs-you" | "blocked" | "failed";
export type OperatorControlState = "linked" | "observed-only" | "quarantined";
export type AgentRole = "orchestrator" | "verifier" | "automation" | "frontend" | "backend" | "tester" | "agent";
export type TargetResolution = "exact" | "unique-cwd" | "ambiguous" | "missing";
export type ControlAction = "focus" | "instruct" | "interrupt" | "archive";

/* Two different measurements live here and the names have to keep them apart.

   `total` is a SIZE: how big the latest call's prompt was, cache reads included,
   because a cached token still occupies the window. It is the contextPct
   numerator and nothing else.

   `sessionTotal` is a FLOW: how many tokens this session has consumed over its
   life. Cache reads are excluded from it by construction. A cached prefix is
   re-sent on every call, so summing per-call totals counts the same token once
   per subsequent call — quadratic in conversation length, not consumption. It
   put 394,199,049 on a single session's drawer against a 1M window, of which
   391,452,609 (99.3%) was one conversation re-read 769 times.

   `sessionCachedInput` carries those re-reads separately, under its own name, so
   the quantity is still available to anyone who wants it and can never again be
   mistaken for consumption by being folded into a total. */
export interface TokenUsage {
  input?: number;
  output?: number;
  cachedInput?: number;
  /** Latest call's prompt+completion size, cache reads INCLUDED. Occupancy. */
  total?: number;
  /** Session-cumulative NEW tokens: uncached input + output + cache writes. */
  sessionTotal?: number;
  /** Session-cumulative cache READS. Re-read context, billed at a fraction. */
  sessionCachedInput?: number;
  contextWindow?: number;
  scope?: "latest-turn" | "session" | "unknown";
  provenance: "observed" | "estimated" | "unknown";
}

export interface ModelPolicy {
  state: "compliant" | "mismatch" | "unreported";
  expected: string;
  observed?: string;
  evidence: "cursor-ai-tracking" | "cursor-local" | "none";
  summary: string;
}

export interface CostUsage {
  amount: number;
  currency: "USD";
  provenance: "observed" | "estimated";
  note?: string;
}

export interface CmuxTarget {
  workspaceId?: string;
  workspaceTitle?: string;
  surfaceId?: string;
  paneId?: string;
  /** Live cmux pane cwd when known — may differ from the provider session cwd. */
  surfaceCwd?: string;
  /**
   * True when an exact session/process link points at a cmux pane whose cwd
   * disagrees with the provider session cwd (common for home-cwd orchestrators
   * sitting inside a project-titled workspace). Controls may still be linked;
   * display must not pretend the agent "lives" in the pane folder.
   */
  cwdMismatch?: boolean;
  resolution: TargetResolution;
  reason?: string;
}

export type IdentityTraceTier = "recorded" | "session" | "cwd";

export interface IdentityTraceStep {
  tier: IdentityTraceTier;
  outcome: "matched" | "quarantined" | "ambiguous" | "no-match" | "skipped" | "rejected";
  detail: string;
}

export interface IdentityBindingBridge {
  surfaceId: string;
  workspaceId?: string;
  paneId?: string;
  /** When the persisted binding was last confirmed by live lsof evidence. */
  confirmedAt?: string;
}

/**
 * Why one agent resolved (or failed to resolve) to a cmux target: which tier
 * fired and the concrete reason each earlier tier passed. Debug data — kept
 * out of the snapshot fingerprint so evidence detail never churns SSE pushes.
 */
export interface IdentityTrace {
  steps: IdentityTraceStep[];
  /** Tier that produced the final target when the resolution routed. */
  matchedTier?: IdentityTraceTier;
  resolution: TargetResolution;
  reason?: string;
  surfaceId?: string;
  /** Present when a persisted binding bridged an lsof evidence gap this scan. */
  bindingBridge?: IdentityBindingBridge;
}

export interface SurfaceProcessEvidence {
  pid: number;
  command: string;
  recognizedAgentProcess: boolean;
}

export interface SurfaceOpenFileEvidence {
  pid: number;
  path: string;
  provider: Provider;
  sessionId: string;
}

export interface SurfaceCommandHintEvidence {
  pid: number;
  provider: Provider;
  value: string;
  full: boolean;
  /** Full session ID after prefix resolution; absent when no unique source matched. */
  resolvedSessionId?: string;
  /** Why a provider runtime identity was refused instead of bound. */
  rejectionReason?: string;
}

export type SurfaceIdentityOutcome =
  | "open-file-match"
  | "command-hint-match"
  | "open-file-conflict"
  | "command-hint-conflict"
  | "no-evidence"
  | "stale-surface"
  | "no-tty"
  | "probe-failed";

/** Per-surface record of the ps/lsof evidence one identity scan observed. */
export interface SurfaceIdentityTrace {
  surfaceId: string;
  tty?: string;
  processes: SurfaceProcessEvidence[];
  openFileMatches: SurfaceOpenFileEvidence[];
  commandHints: SurfaceCommandHintEvidence[];
  outcome: SurfaceIdentityOutcome;
  sourceSessionIds: string[];
  identityConflict?: string;
  notes?: string[];
}

export type PresentationLabelTarget =
  | { kind: "program"; programId: string }
  | { kind: "workspace"; workspaceId: string }
  | { kind: "room"; surfaceId: string }
  | { kind: "agent"; agentId: string };

export interface ControlCapability {
  action: ControlAction;
  enabled: boolean;
  reason?: string;
}

export interface Artifact {
  label: string;
  path: string;
  kind?: string;
}

export interface AgentSnapshot {
  id: string;
  provider: Provider;
  sourceSessionId: string;
  displayName: string;
  programId: string;
  cwd?: string;
  model?: string;
  effort?: string;
  task?: string;
  status: AgentStatus;
  statusReason: string;
  activity?: ActivityState;
  /** Process/transcript lifecycle evidence; unknown means the sources cannot distinguish it safely. */
  processState?: ProcessState;
  outcome?: OutcomeState;
  controlState?: OperatorControlState;
  role?: AgentRole;
  /* One thing the operator can do about this agent, derived from what the agent
     wrote. Absent when nothing in the text says why it would want a human —
     which is most agents most of the time, and is the point. */
  nextAction?: string;
  /* The reading behind nextAction, so the board can group rows by why they are
     waiting ("2 blocked on permission", "3 asked a question") and quote the
     agent rather than paraphrase it.

     Only ACTIONABLE readings reach the wire. The two silent outcomes —
     nothing-wanted and not-readable — are deliberately absent here: putting
     either under every row would be the filler this layer exists to remove.
     Their split is reported once, fleet-wide, on HubSnapshot.attentionCoverage. */
  attentionSignal?: {
    kind:
      | "permission-requested"
      | "input-requested"
      | "fork-unresolved"
      | "handoff-stated"
      | "question-pending"
      | "assumption-stated";
    evidence?: string;
  };
  modelPolicy?: ModelPolicy;
  parentAgentId?: string;
  threadDepth?: number;
  nickname?: string;
  /** Sanitized provider-aware prose for dense rows; null means no readable fallback survived. */
  lastHumanMessage: string | null;
  /** Latest sanitized human-legible USER request; null when none survived cleaning. */
  lastUserMessage?: string | null;
  /** Latest sanitized human-legible AGENT reply; null when none survived cleaning. */
  lastAgentMessage?: string | null;
  /* The closing words of the agent's last message, attributed by construction
     rather than inferred from the transcript tail (whose final line may be the
     operator's). This is what the attention detectors read. */
  lastAgentClosing?: string | null;
  startedAt?: string;
  updatedAt: string;
  elapsedMs?: number;
  /* Working time, as distinct from elapsed. `elapsedMs` is updatedAt − startedAt:
     a SPAN, which on a session picked up again after a fortnight counts the
     fortnight. This counts only the gaps between consecutive recorded turns that
     are short enough to be one stretch, so a renderer can say how long an agent
     actually worked instead of how long ago it started. Absent when the session
     recorded too few turns to measure an interval — never 0 as a stand-in. */
  activeMs?: number;
  tokens: TokenUsage;
  /** Observed session token occupancy as a percentage of the reported context window. */
  contextPct?: number;
  cost?: CostUsage | null;
  subagentCount?: number;
  transcriptTail?: string;
  artifacts: Artifact[];
  git?: { branch?: string; dirty?: boolean; head?: string };
  tests?: { state: "passing" | "failing" | "running" | "unknown"; summary?: string };
  gates: string[];
  target: CmuxTarget;
  /** Evidence trail behind `target`; excluded from the snapshot fingerprint. */
  identityTrace?: IdentityTrace;
  controls: ControlCapability[];
}

export interface ProgramRollup {
  total: number;
  live: number;
  working: number;
  idle: number;
  ended: number;
  needsYou: number;
  blocked: number;
  failed: number;
  linked: number;
}

export interface ProgramSnapshot {
  id: string;
  name: string;
  purpose?: string;
  path?: string;
  agents: AgentSnapshot[];
  rollup?: ProgramRollup;
}

export type IssueLifecycleState = "open" | "verifying" | "resolved" | "blocked";
export type IssueWorkState =
  | "needs_triage"
  | "watching"
  | "triaging"
  | "planned"
  | "queued"
  | "investigating"
  | "verifying"
  | "blocked"
  | "cleared";

export interface IssueLifecycle {
  state: IssueLifecycleState;
  openedAt: string;
  verificationStartedAt?: string;
  resolvedAt?: string;
  result?: string;
}

export interface OperatorIssue {
  id: string;
  kind: "system" | "agent";
  severity: "warning" | "error";
  title: string;
  summary: string;
  affectedAgentIds: string[];
  technicalDetails?: string[];
  lifecycle?: IssueLifecycle;
  workState?: IssueWorkState;
  progress?: number;
  impactSummary?: string;
}

export type TriageMode = "direct" | "coordinated" | "investigation";

export interface TriageStep {
  title: string;
  detail: string;
}

export interface TriageRecommendation {
  issueId: string;
  generatedAt: string;
  mode: TriageMode;
  headline: string;
  rationale: string;
  affectedAgents: number;
  affectedPrograms: number;
  providers: Provider[];
  evidence: string[];
  steps: TriageStep[];
  queueRecommended: boolean;
  investigationPrompt?: string;
}

export type TriageQueueState = "queued" | "running" | "completed" | "blocked";

export interface TriageQueueItem extends TriageRecommendation {
  id: string;
  state: TriageQueueState;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  runId?: string;
  runModel?: string;
  pid?: number;
  result?: string;
}

export interface TriageQueueSummary {
  issueId: string;
  state: TriageQueueState;
}

export interface PulseMomentum {
  working: number;
  /* Null, always, and deliberately.

     This used to count `working -> idle|ended` edges. `activity` derives from
     `statusFrom()`, which reads transcript recency alone, so the "completion"
     it counted was "stopped writing for three minutes" — thinking, waiting on a
     tool, blocked on a build, rate-limited, crashed or killed all scored the
     same as shipping. It recounted the same agent on every pause, and it never
     looked at success. The magnitude audit ranked it worst on the board because
     its true value could be 0 while it rendered 17.

     A correct counter has to verify terminality, success, idempotence and
     attribution. Measured on this fleet, two of those are not available:

       - SUCCESS is unverifiable. `outcome` is "healthy" for 479 of 479 agents
         and `gates` is empty for all 479, so filtering on them excludes
         nothing. That check would look like verification and do none.
       - COMPLETION is undetectable for 96% of live agents. Only Codex emits a
         real per-task event (`task_complete`; 741 recorded, 11 in the last
         hour) and Codex is 1 of 24 live sessions. Claude's `stop_reason:
         "end_turn"` fires on every assistant reply — a turn, not a task — and
         Cursor has nothing.

     So the acceptance criteria's own escape applies: a number that cannot be
     defined cannot be corrected. "done" is the strongest success word on the
     board and it was the least verified; it is now withheld rather than
     guessed, the same rule cost already follows by reading `unavailable`
     instead of `$0`. `completionsProvenance` says why, so the card can explain
     itself instead of going quietly blank. */
  completionsLastHour: number | null;
  completionsProvenance: "not-observable";
  observedWindowMs: number;
  stalled: number;
  stalledAgentIds: string[];
  stallThresholdMs: number;
}

export interface PulseBurn {
  tokensPerMin: number | null;
  windowMs: number;
  coverage: { reporting: number; eligible: number; unknown: number };
  costLastHourUsd: number | null;
  /* True when costLastHourUsd is a measured FLOOR rather than a complete total,
     because some invocation in the window carried no price. The card must mark
     it — an unmarked floor read as a total is the failure the usage card's "≥"
     exists to prevent, and it would be worse here because this figure is the
     one an operator watches to decide whether to keep a swarm running. */
  costIsFloor?: boolean;
  costProvenance: "burnbar" | "unavailable";
  costAsOf?: string;
  costNote?: string;
}

export interface PulseActivityBucket {
  start: string;
  activeSessions: number;
  tokens: number | null;
}

export interface HubPulse {
  momentum: PulseMomentum;
  burn: PulseBurn;
  activity: {
    bucketMinutes: 5;
    windowMinutes: 60;
    observedSince: string;
    buckets: PulseActivityBucket[];
  };
}

export interface SourceHealth {
  healthy: boolean;
  lastHealthyAt: string | null;
}

export interface SourceHealthSummary {
  healthy: number;
  degraded: number;
  /* Collectors with nothing installed to read. Not degraded: a machine without
     Cursor is not a broken machine, and counting it as a fault told every
     first-time user their install was incomplete. */
  absent: number;
  total: number;
  byProvider?: Record<Provider, SourceHealth>;
}

/* Workspace leftovers the hub can see but nobody needs to act on now. A cmux
   pane whose sessions have all ended still holds open transcript handles, so
   identity scanning still reports a conflict for it forever — nobody is going
   to close a pane from a wave that finished last week. Carried separately from
   `errors` so a board with nothing but debris can still read Operational, while
   the debris stays discoverable and, above all, names its own remedy. */
export interface ControlDebris {
  kind: "abandoned-cmux-panes";
  count: number;
  surfaceIds: string[];
  /** What the operator would do about it, in words that name an action. */
  remedy: string;
  /** The raw scanner strings, for the drawer. Never the operator's first read. */
  detail: string[];
}

export interface ControlHealth {
  cmuxReachable: boolean;
  lastCheckedAt: string;
  /* Faults that impair operation NOW. Anything the operator cannot act on, or
     that costs nothing until they do, belongs in `debris` instead — this list
     drives the Degraded verdict, so a permanent entry here is a permanently
     red board and an operator trained to ignore it. */
  errors: string[];
  staleSources: Provider[];
  debris?: ControlDebris;
}

/* How much of the fleet the attention layer could actually read, and which
   detectors were even able to fire. Without this a quiet board is ambiguous:
   "nothing wants you" and "we could not read anything" render identically. */
export interface AttentionCoverageSummary {
  agents: number;
  readable: number;
  notReadable: number;
  /** Ended sessions, skipped by design: nothing on them can be acted on. */
  ended: number;
  signals: Record<string, number>;
  preconditions: { withNotification: number; withProvenDeath: number };
}

export interface HubSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  modelConfig?: {
    displayLabels: Record<string, string>;
  };
  /** Collector scan window in hours (how far back sources are harvested). */
  scanWindowHours?: number;
  /** Alias of scanWindowHours for provenance labeling. */
  lookbackHours?: number;
  contextPeak?: number;
  /** Live agents that reported a contextPct — the coverage of contextPeak. */
  contextReporting?: number;
  /** Live agents contextPeak was taken over, reporting or not. */
  contextEligible?: number;
  contextMedian?: number;
  controlHealth: ControlHealth;
  attentionCoverage?: AttentionCoverageSummary;
  totals: {
    live: number;
    tracked: number;
    attention: number;
    tokens?: number;
    working?: number;
    idle?: number;
    ended?: number;
    /** Agents waiting on a human: the to-do list. Counted from attentionSignal. */
    needsYou?: number;
    /** Operator issues — degraded sources, control faults. A different population. */
    systemFindings?: number;
    history?: number;
    tokenReporting?: number;
    tokenEligible?: number;
    tokenMedian?: number;
    cursorModelHealth?: {
      compliant: number;
      mismatch: number;
      unreported: number;
      total: number;
    };
    sourceHealth?: SourceHealthSummary;
  };
  issues?: OperatorIssue[];
  recentlyResolved?: OperatorIssue[];
  triageSummaries?: TriageQueueSummary[];
  pulse?: HubPulse;
  programs: ProgramSnapshot[];
}

export interface ControlRequest {
  action: ControlAction;
  agentId: string;
  instruction?: string;
}

export interface ControlResponse {
  ok: boolean;
  action: ControlAction;
  agentId: string;
  error?: { code: string; message: string; stderr?: string; exitCode?: number };
}

export interface BroadcastRequest {
  agentIds: string[];
  instruction: string;
}

export interface BroadcastRecipientResult {
  agentId: string;
  ok: boolean;
  error?: ControlResponse["error"];
}

export interface BroadcastResponse {
  ok: boolean;
  partial: boolean;
  sent: number;
  failed: number;
  results: BroadcastRecipientResult[];
}
