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
  surfaceId?: string;
  paneId?: string;
  resolution: TargetResolution;
  reason?: string;
}

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

export interface OperatorIssue {
  id: string;
  kind: "system" | "agent";
  severity: "warning" | "error";
  title: string;
  summary: string;
  affectedAgentIds: string[];
  technicalDetails?: string[];
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

export interface TriageQueueItem extends TriageRecommendation {
  id: string;
  state: "queued" | "running" | "completed" | "blocked";
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  runId?: string;
  runModel?: string;
  pid?: number;
  result?: string;
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
