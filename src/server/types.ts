import type {
  AgentStatus,
  Artifact,
  CostUsage,
  Provider,
  SurfaceIdentityTrace,
  TokenUsage,
} from "../shared/types";

export const MAX_TRANSCRIPT_TAIL_CHARS = 800;

export interface CollectedAgent {
  id: string;
  provider: Provider;
  sourceSessionId: string;
  /** Provider runtime identity when it differs from the transcript's source identity. */
  runtimeSessionId?: string;
  displayName: string;
  cwd?: string;
  model?: string;
  effort?: string;
  task?: string;
  status: AgentStatus;
  statusReason: string;
  startedAt?: string;
  updatedAt: string;
  tokens: TokenUsage;
  cost?: CostUsage | null;
  subagentCount?: number;
  parentSourceSessionId?: string;
  threadDepth?: number;
  nickname?: string;
  lastHumanMessage?: string | null;
  lastUserMessage?: string | null;
  lastAgentMessage?: string | null;
  transcriptTail?: string;
  artifacts: Artifact[];
  gates: string[];
  /** True only when the provider transcript contains an explicit session-exit record. */
  transcriptEndedCleanly?: boolean;
  /** Exact process IDs retained from a confirmed identity scan. */
  processIds?: number[];
  /** Current liveness of the retained process IDs; absent when no trustworthy scan checked them. */
  processAlive?: boolean;
  transcriptOpen?: boolean;
  allowCwdFallback?: boolean;
  recordedTarget?: {
    workspaceId?: string;
    surfaceId?: string;
    paneId?: string;
    /** Overrides the default tier-1 target reason (e.g. binding bridges). */
    reason?: string;
    /** Set when a persisted identity binding supplied this target. */
    source?: "binding";
    /** Last time live lsof evidence confirmed the binding, when known. */
    confirmedAt?: string;
  };
}

export interface CmuxSurface {
  workspaceId?: string;
  surfaceId: string;
  paneId?: string;
  cwd?: string;
  workspaceTitle?: string;
  title?: string;
  branch?: string;
  dirty?: boolean;
  head?: string;
  tty?: string;
  runtimeSurfaceReady?: boolean;
  sourceSessionIds: string[];
  identityConflict?: string;
  /** Evidence observed by the most recent identity scan for this surface. */
  identityTrace?: SurfaceIdentityTrace;
}

export interface CmuxNotification {
  id?: string;
  surfaceId: string;
  workspaceId?: string;
  createdAt: string;
  title?: string;
  subtitle?: string;
  body?: string;
}

export interface CollectionResult<T> {
  value: T;
  errors: string[];
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface CommandRunner {
  run(command: readonly string[], timeoutMs?: number): Promise<CommandResult>;
}

export interface ArchiveStore {
  has(agentId: string): boolean;
  archive(agentId: string, agent?: CollectedAgent): Promise<void>;
  record?(agents: readonly CollectedAgent[]): Promise<void>;
  archivedAgents?(): readonly CollectedAgent[];
}
