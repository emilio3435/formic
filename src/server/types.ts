import type {
  AgentLineage,
  AgentIdentity,
  AgentStatus,
  Artifact,
  CostUsage,
  EndEvidence,
  LifecycleProvenance,
  LifecycleState,
  Provider,
  SessionIdentityClaim,
  SessionKind,
  SessionKindSource,
  SurfaceIdentityTrace,
  TokenUsage,
  HookLifecycle,
} from "../shared/types";

export const MAX_TRANSCRIPT_TAIL_CHARS = 800;
/* Heartbeat TL;DR envelopes ride transcriptTail and die head-first under
   slice(-800): the "[TL;DR …] {"v":4," prefix is the part that gets cut, which
   turns a long envelope into an unparseable stub. Envelope-shaped tails get a
   generous backstop; the writer's guidance governs length, the wire must not. */
export const MAX_HEARTBEAT_TAIL_CHARS = 6000;
export function capTranscriptTail(tail: string | undefined): string | undefined {
  if (tail == null) return tail;
  const cap = /^\[TL;DR\s/.test(tail.trimStart()) ? MAX_HEARTBEAT_TAIL_CHARS : MAX_TRANSCRIPT_TAIL_CHARS;
  return tail.slice(-cap);
}

export interface CollectedAgent {
  /* Per-call PROCESSED sizes, in transcript order, deduplicated per message —
     the series whose sum is `tokens.sessionProcessed`. It is derived once, by
     the parser, and the total is computed FROM it, so the two cannot drift.

     Deliberately NOT published in the snapshot: it is stripped where a
     CollectedAgent becomes an AgentSnapshot, and served on demand from
     /api/debug/session-calls instead. A live snapshot is already 2.23MB against
     a 2MB SSE backlog budget, and the median session has 7 calls while the
     largest on this machine has 1,575 — putting the tail on the wire for every
     agent on every update would spend the board's freshness on a series nothing
     renders.

     Absent, never empty, where a provider does not report per call: Codex
     publishes session-cumulative totals only, so there are no call boundaries
     to report and claiming an empty series would assert there were no calls. */
  callSizes?: readonly number[];
  /* Cumulative processed totals as the transcript was observed over time.
     This is server-side adjudication evidence, stripped from the snapshot with
     callSizes and served only by /api/debug/session-calls. */
  processedSnapshots?: readonly { readonly at: string; readonly total: number }[];
  id: string;
  provider: Provider;
  sourceSessionId: string;
  /** Provider runtime identity when it differs from the transcript's source identity. */
  runtimeSessionId?: string;
  displayName: string;
  /* Resolved by src/server/naming.ts at the one point every provider's session
     becomes this shape. Still pre-uniqueness here: `disambiguate` needs the whole
     fleet and only snapshot.ts has it, so `name` may equal another agent's until
     that pass runs. */
  identity?: AgentIdentity;
  /** Provider-recorded current/tool working directory. */
  cwd?: string;
  /** Working directory recorded by the provider hook at process launch. */
  launchCwd?: string;
  /** The first working directory recorded, never the latest. Only naming reads it. */
  originCwd?: string;
  /** Provider-recorded launch markers, when the transcript carries them.
      Claude: entrypoint ("cli" | "sdk-py" | …) and promptSource ("sdk" | …).
      Absent for providers that record nothing — absence is evidence of nothing. */
  launch?: { entrypoint?: string; promptSource?: string };
  /** Application-owned session classification, when a collector can declare it exactly. */
  sessionKind?: SessionKind;
  sessionKindSource?: SessionKindSource;
  model?: string;
  effort?: string;
  task?: string;
  status: AgentStatus;
  statusReason: string;
  /** Lifecycle reported directly by cmux's provider hook-session store. */
  hookLifecycle?: HookLifecycle;
  /** When the hook store recorded hookLifecycle. */
  hookLifecycleAt?: string;
  startedAt?: string;
  updatedAt: string;
  tokens: TokenUsage;
  /** Observed session token occupancy as a percentage of the reported context window. */
  contextPct?: number;
  cost?: CostUsage | null;
  subagentCount?: number;
  /** Exact kernel ancestry observed from this hook-backed session's process. */
  lineage?: AgentLineage;
  parentSourceSessionId?: string;
  threadDepth?: number;
  nickname?: string;
  /** Latest readable user/assistant prose with a directly associated source timestamp. */
  lastHumanFacingAt?: string;
  lastHumanMessage?: string | null;
  lastUserMessage?: string | null;
  lastAgentMessage?: string | null;
  /* The END of the agent's last message, role-attributed. lastAgentMessage is a
     front window, so a question asked after an explanation never survived it. */
  lastAgentClosing?: string | null;
  transcriptTail?: string;
  /* When the archive took custody of this record — set by the archive store,
     absent on a live agent. Retention runs from here, not from `updatedAt`:
     archiving a session that went quiet a month ago is still an archive made
     today, and measuring from the agent's last activity pruned it on the very
     next commit while reporting success. */
  archivedAt?: string;
  /* Time the agent was actually working: the sum of gaps between consecutive
     recorded turns, counting only gaps short enough to be one stretch. Bounded
     by construction — it can never exceed updatedAt − startedAt, and on a
     session that sat dormant for weeks it is a small fraction of it. */
  activeMs?: number;
  artifacts: Artifact[];
  gates: string[];
  /** True only when the latest provider turn contains an explicit clean-completion record. */
  transcriptEndedCleanly?: boolean;
  /* WHICH clean completion it was, which the boolean above cannot say.
     `transcriptEndedCleanly` is minted from turn-level events for Claude and
     Codex and from a real session fact for OMP, so one flag carried two
     incompatible claims and everything downstream had to guess which it held.
     A session ending and a turn ending are different events and get different
     values here. */
  endEvidence?: EndEvidence;
  /* The lifecycle verdict FROZEN at custody time, present only on archive
     records. `archiveCopy` strips process evidence by allow-list, so a record
     that has left the scan window cannot be reclassified from what survives —
     re-deriving it would turn the whole filing cabinet into "no process
     evidence" and invent an unverified fleet out of history. It carries its
     answer instead. */
  lifecycle?: LifecycleState;
  provenance?: LifecycleProvenance;
  /** Exact process IDs retained from a confirmed identity scan. */
  processIds?: number[];
  /**
   * When each retained PID's process was observed to start, keyed by PID.
   *
   * A pid alone cannot be re-checked: the kernel reuses the number, so a later
   * scan finding it in use proves only that SOMETHING holds it. Carrying the
   * start time alongside is what lets the next scan tell "still running" from
   * "someone else now". Partial by nature — only pids whose start time was
   * observed appear — so its absence is a gap, never an ending.
   */
  processStarts?: Record<number, number>;
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
  /** Provider-preserving identity evidence; absent on legacy in-process fixtures. */
  sourceSessionClaims?: SessionIdentityClaim[];
  sourceSessionIds: string[];
  identityConflict?: string;
  /** Evidence observed by the most recent identity scan for this surface. */
  identityTrace?: SurfaceIdentityTrace;
}

export interface CmuxWorkspaceSnapshot {
  workspaceId: string;
  projectRootPath?: string;
  branch?: string;
  dirty?: boolean;
  pullRequestUrls: string[];
}

export type CmuxWorkspaceEnvVariables = Partial<Record<
  "ANTHILL_RUN" | "ANTHILL_LANE" | "ANTHILL_ROLE" | "ANTHILL_PARENT",
  string
>>;

export interface CmuxWorkspaceEnv {
  workspaceId: string;
  variables: CmuxWorkspaceEnvVariables;
}

export interface CmuxNotification {
  id?: string;
  surfaceId: string;
  workspaceId?: string;
  /* Absent when the source timestamp could not be parsed. Deliberately not
     defaulted: 1970 is the one value guaranteed to lose every "newer than"
     comparison, so inventing it silenced live requests for a human forever. */
  createdAt?: string;
  title?: string;
  subtitle?: string;
  body?: string;
}

/* How long a gap between two recorded turns still counts as one working
   stretch. Not a new number: it is the board's own stall threshold, already
   shipped as pulse.momentum.stallThresholdMs and already the point at which a
   quiet session is called stalled. Reusing it means active time and "stalled"
   cannot drift apart into two different opinions about the same silence. */
export const AGENT_IDLE_GAP_MS = 15 * 60_000;

export interface CollectionResult<T> {
  value: T;
  errors: string[];
  /* The source is not installed on this machine — its directory or binary does
     not exist. Distinct from `errors`, which mean "this IS here and I could not
     read it". Collapsing the two told a first-time user their install was
     broken because they do not happen to use Cursor. Absent is not a fault and
     must not count against collector health; unreadable still is, loudly. */
  absent?: boolean;
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
  /* Optional so a store that cannot undo simply does not advertise the control
     — controlsFor asks before offering it, which is the advertisement invariant
     this repo already enforces both ways. */
  unarchive?(agentId: string): Promise<void>;
  record?(agents: readonly CollectedAgent[]): Promise<void>;
  archivedAgents?(): readonly CollectedAgent[];
  /* Set when an empty archive is standing in for one that could not be read.
     Every dismissed agent is back on the board as live work in that state, so
     it is a fault the operator needs told, not a quiet fallback. */
  loadError?(): string | undefined;
}
