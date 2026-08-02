export type Provider = "codex" | "omp" | "claude" | "cursor";
export type AgentStatus = "running" | "waiting" | "attention" | "stale" | "archived";
export type ActivityState = "working" | "idle" | "ended" | "unknown";
export type ProcessState = "running" | "exited" | "died" | "unknown";
export type OutcomeState = "healthy" | "needs-you" | "blocked" | "failed";
export type OperatorControlState = "linked" | "observed-only" | "quarantined";
export type AgentRole = "orchestrator" | "verifier" | "automation" | "frontend" | "backend" | "tester" | "agent";
export type TargetResolution = "exact" | "unique-cwd" | "ambiguous" | "missing";
export type ControlAction = "focus" | "instruct" | "interrupt" | "archive";

export interface TokenUsage {
  input?: number;
  output?: number;
  cachedInput?: number;
  total?: number;
  sessionTotal?: number;
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
  completionsLastHour: number;
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
  costProvenance: "burnbar" | "unavailable";
  costAsOf?: string;
  costNote?: string;
}

export interface PulseActivityBucket {
  start: string;
  activeSessions: number;
  completions: number;
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
    needsYou?: number;
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
