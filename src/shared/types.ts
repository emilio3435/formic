export type Provider = "codex" | "omp" | "claude" | "cursor";
export type AgentStatus = "running" | "waiting" | "attention" | "stale" | "archived";
export type ActivityState = "working" | "idle" | "ended" | "unknown";
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
  outcome?: OutcomeState;
  controlState?: OperatorControlState;
  role?: AgentRole;
  nextAction?: string;
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
  startedAt?: string;
  updatedAt: string;
  elapsedMs?: number;
  tokens: TokenUsage;
  cost?: CostUsage | null;
  subagentCount?: number;
  transcriptTail?: string;
  artifacts: Artifact[];
  git?: { branch?: string; dirty?: boolean; head?: string };
  tests?: { state: "passing" | "failing" | "running" | "unknown"; summary?: string };
  gates: string[];
  target: CmuxTarget;
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

export interface SourceHealthSummary {
  healthy: number;
  degraded: number;
  total: number;
}

export interface ControlHealth {
  cmuxReachable: boolean;
  lastCheckedAt: string;
  errors: string[];
  staleSources: Provider[];
}

export interface HubSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  /** Collector scan window in hours (how far back sources are harvested). */
  scanWindowHours?: number;
  /** Alias of scanWindowHours for provenance labeling. */
  lookbackHours?: number;
  controlHealth: ControlHealth;
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
