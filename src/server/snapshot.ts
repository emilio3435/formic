import type {
  AgentAck,
  AgentIdentity,
  AgentSnapshot,
  CmuxNotificationSummary,
  CollectionScope,
  HubPulse,
  LifecycleState,
  HubSnapshot,
  IdentityTrace,
  IssueLifecycle,
  IssueWorkState,
  LineageAgreement,
  OperatorIssue,
  ProgramSnapshot,
  Provider,
  TriageQueueSummary,
} from "../shared/types";
import { PROVIDERS } from "../shared/types";
import { MODEL_CONFIG } from "./model-config";
import {
  resolveAgentTarget,
  resolveAgentTargetWithTrace,
  transmitRefusal,
  type TransmitRefusal,
} from "./targets";
import { lifecycleIssues, withIssueDecoration } from "./snapshot-issues";
import { emptyAttentionCoverage, recordAttention } from "./attention-signal";
import {
  buildOperatorIssues,
  classifyIdentityConflicts,
  controlDebrisFor,
} from "./snapshot-operator-issues";
import { isLive } from "./live";
import { agentSortRank, programFor, rollupFor, type ProgramHint } from "./snapshot-programs";
/* Re-exported so the program-resolution move stays invisible to callers:
   state.ts imports ProgramHint from "./snapshot". */
export type { ProgramHint } from "./snapshot-programs";
/* Re-exported so the issue-lifecycle move stays invisible to callers:
   state.ts and the snapshot tests import these from "./snapshot". */
export {
  MAX_RECENTLY_RESOLVED,
  impactSummaryFor,
  issueWorkStateFor,
  withIssueDecoration,
} from "./snapshot-issues";
import {
  activityForLifecycle,
  contextPctFor,
  controlsFor,
  effortFor,
  lifecycleFor,
  operatorControlState,
  outcomeFor,
  processStateFor,
  roleFor2,
  sessionKindFor,
  statusForLifecycle,
} from "./snapshot-agent";
import type { LifecycleThresholds } from "./lifecycle";
import { disambiguate, paneRename, resolveAgentName, type NameTagStore } from "./naming";
import { resolveRepoIdentity } from "./repo-identity";
import {
  envFactsFor,
  manifestFactsFor,
  type DeclaredLineage,
  type RunManifest,
} from "./run-manifests";
import type { SessionNameRecord } from "./session-names";
import {
  senderVerificationFor,
  type SenderTranscriptEvidence,
} from "./sender-verification";
import { taskStateWantsHuman } from "./task-state";
import {
  capTranscriptTail,
  type ArchiveStore,
  type CmuxNotification,
  type CmuxSurface,
  type CmuxWorkspaceEnv,
  type CmuxWorkspaceSnapshot,
  type CollectedAgent,
  type FormicHubSnapshot,
  type SpendSource,
} from "./types";

function pathIsWithin(path: string, root: string): boolean {
  const normalizedPath = path.replaceAll("\\", "/").replace(/\/+$/, "");
  const normalizedRoot = root.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

export interface SnapshotInput {
  agents: readonly CollectedAgent[];
  /** Non-interactive billed automation shown on Usage, never on the Board. */
  spendSources?: readonly SpendSource[];
  /** Cached provider rows shown only when that provider misses this refresh's cutoff. */
  lastKnownAgents?: readonly CollectedAgent[];
  lastKnownSourceReasons?: Partial<Record<Provider, string>>;
  /* An authored title for an agent id, when one has been written down.
     Optional: every caller without it — and there are many in tests — keeps the
     derived names, which is also what the board shows before the first naming
     pass completes. */
  sessionNames?: (agentId: string) => SessionNameRecord | undefined;
  /** Write-once disambiguators shared with the durable identity-binding store. */
  nameTagStore?: NameTagStore;
  surfaces: readonly CmuxSurface[];
  workspaceEnvs?: readonly CmuxWorkspaceEnv[];
  sidebarWorkspaces?: readonly CmuxWorkspaceSnapshot[];
  runManifests?: readonly RunManifest[];
  notifications?: readonly CmuxNotification[];
  cmuxNotifications?: readonly CmuxNotificationSummary[];
  acks?: readonly AgentAck[];
  programHints?: readonly ProgramHint[];
  sourceErrors?: Partial<Record<Provider, readonly string[]>>;
  /* Providers with nothing installed to read. Absent is not a fault: it is the
     ordinary state of a machine whose owner does not use that tool. */
  sourceAbsent?: Partial<Record<Provider, boolean>>;
  cmuxAbsent?: boolean;
  cmuxErrors?: readonly string[];
  cmuxReachable?: boolean;
  cmuxLastCheckedAt?: string;
  archiveStore: ArchiveStore;
  issueLifecycle?: ReadonlyMap<string, IssueLifecycle>;
  previousIssues?: readonly OperatorIssue[];
  recentlyResolved?: readonly OperatorIssue[];
  triageSummaries?: readonly TriageQueueSummary[];
  now?: Date;
  scanWindowHours?: number;
  /** Every provider session source completed its scan without an error. */
  sessionCollectionComplete?: boolean;
  /** The operator's freshness and quiet bands; defaults when absent. */
  thresholds?: LifecycleThresholds;
  /** Idle-hook threshold for a manifest-active lane; defaults to 30 minutes. */
  stalledActiveMinutes?: number;
  /** Readable transcript evidence keyed by sender, including whether the read was complete. */
  senderTranscriptTails?: ReadonlyMap<string, SenderTranscriptEvidence>;
  /**
   * The identity scan enumerated every process without error, so a session no
   * process claims has been observed to be gone rather than merely unchecked.
   * Absent on a degraded or skipped scan, which is what keeps those refreshes
   * reporting `unverified` instead of inventing endings.
   */
  processRosterComplete?: boolean;
}

type SnapshotControlRefusal = Omit<TransmitRefusal, "message">;
type AgentSnapshotWithControlRefusal = AgentSnapshot & { controlRefusal?: SnapshotControlRefusal };

export function withPulse(snapshot: HubSnapshot, pulse: HubPulse): HubSnapshot {
  return { ...snapshot, pulse };
}

/* What a row can show of a cmux notification: who it is from and what happened,
   with none of the prose. Kept short enough to sit on one line beside everything
   else a row already carries — an operator who wants the rest opens the drawer,
   where the untruncated body already is. */
const MAX_NOTIFICATION_SUMMARY = 90;

export function summarizeNotification(title?: string, subtitle?: string): string | undefined {
  const parts = [title, subtitle]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    /* A notification title can itself carry markdown and links. Strip them
       rather than print the syntax: "[PR #387](https://…)" reads as the URL it
       hides, and the row has no room to be a hyperlink. */
    .map((part) => part
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\s+/g, " ")
      .trim())
    .filter(Boolean);
  if (!parts.length) return undefined;
  const joined = parts.join(" — ");
  if (joined.length <= MAX_NOTIFICATION_SUMMARY) return joined;
  return `${joined.slice(0, MAX_NOTIFICATION_SUMMARY - 1).trimEnd()}…`;
}

export function buildSnapshot(input: SnapshotInput): FormicHubSnapshot {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const programs = new Map<string, ProgramSnapshot>();
  const newestById = new Map<string, CollectedAgent>();
  const archivedAgents = input.archiveStore.archivedAgents?.() ?? [];
  const currentIds = new Set(input.agents.map((agent) => agent.id));
  const lastKnownAgents = (input.lastKnownAgents ?? []).filter(
    (agent) => !currentIds.has(agent.id) && !input.archiveStore.has(agent.id),
  );
  const lastKnownIds = new Set(lastKnownAgents.map((agent) => agent.id));
  for (const agent of [...archivedAgents, ...lastKnownAgents, ...input.agents]) {
    const existing = newestById.get(agent.id);
    if (!existing || agent.updatedAt >= existing.updatedAt) newestById.set(agent.id, agent);
  }

  /* Collection scope, derived at the one place both populations are in hand.

     `input.agents` is what THIS scan actually read; `archivedAgents` is the
     filing cabinet, which re-enters the merge on every refresh for thirty days.
     A record present only in the second has left the scan window: still
     findable, no longer watched, and — critically — never counted live. Without
     this gate a turn-complete record would sit in Waiting and in totals.live
     forever, resurrected by the very store that was meant to remember it. */
  const collectedIds = new Set(input.agents.map((agent) => agent.id));
  const attentionCoverage = emptyAttentionCoverage();
  const sources = [...newestById.values()];
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const authoritativeSources = sources.filter((source) => !lastKnownIds.has(source.id));
  const targetsById = new Map(sources.map((source) => [
    source.id,
    lastKnownIds.has(source.id)
      ? {
          resolution: "missing" as const,
          reason: input.lastKnownSourceReasons?.[source.provider]
            ?? "This provider did not finish the current refresh; terminal controls are unavailable.",
        }
      : resolveAgentTarget(source, input.surfaces, authoritativeSources),
  ]));
  const envByWorkspace = new Map(
    (input.workspaceEnvs ?? []).map((workspace) => [workspace.workspaceId, workspace.variables]),
  );
  const declaredById = new Map<string, DeclaredLineage>();
  for (const source of sources) {
    const manifestFacts = manifestFactsFor(source.id, input.runManifests ?? []);
    const workspaceId = targetsById.get(source.id)?.workspaceId;
    const envFacts = workspaceId ? envFactsFor(envByWorkspace.get(workspaceId) ?? {}) : undefined;
    const declared = manifestFacts ?? envFacts;
    if (declared) declaredById.set(source.id, declared);
  }
  /* Uniqueness is decided ONCE, here, because it is the only place the whole
     fleet is in hand. A collector sees one session at a time and so cannot know
     whether its name is shared; if it guessed, the guess would change every time
     an unrelated session started or ended, and a name that moves is the bug this
     contract exists to remove. Measured on the live board 2026-08-04: 805 of 821
     sessions shared a name with at least one other, so this pass is the
     difference between a board of 51 names and a board of 821. */
  const named = authoritativeSources.filter(
    (source): source is CollectedAgent & { identity: AgentIdentity } => Boolean(source.identity),
  );
  /* An authored title, where one has been written down, outranks everything the
     board could derive — that is the contract's own precedence, applied at the
     one point the whole fleet is in hand. Overlaid HERE rather than in the
     collectors because the title is produced out of band: a collector runs
     synchronously while naming waits on a model, so the board publishes the
     derived name immediately and picks the authored one up on a later pass. */
  const titled = named.map((source) => {
    const remembered = input.sessionNames?.(source.id);
    const declared = declaredById.get(source.id);
    if (source.identity.source === "operator-alias") return source;
    if (declared) {
      const authored = remembered
        ? { name: remembered.name, by: remembered.by }
        : source.identity.source === "authored" && source.identity.authoredBy
          ? { name: source.identity.base, by: source.identity.authoredBy }
          : undefined;
      return {
        ...source,
        identity: resolveAgentName({
          provider: source.provider,
          sourceSessionId: source.sourceSessionId,
          manifest: declared,
          authored,
          originCwd: source.originCwd,
          taskName: source.task,
        }),
      };
    }
    if (!remembered) return source;
    return {
      ...source,
      identity: {
        name: remembered.name,
        base: remembered.name,
        source: "authored" as const,
        authoredBy: remembered.by,
      },
    };
  });
  const identitiesById = new Map(
    disambiguate(
      titled.map((source) => ({
        agentId: source.id,
        sourceSessionId: source.sourceSessionId,
        identity: source.identity,
      })),
      input.nameTagStore,
    ).map((identity, index) => [named[index]!.id, identity] as const),
  );
  const childCounts = new Map<string, number>();
  const parentById = new Map<string, string>();
  const lineageAgreementById = new Map<string, LineageAgreement>();
  for (const source of authoritativeSources) {
    const declared = declaredById.get(source.id);
    const nativeParentId = source.parentSourceSessionId
      ? `${source.provider}:${source.parentSourceSessionId}`
      : undefined;
    const claimedParentId = declared ? declared.parentAgentId : nativeParentId;
    const observedParentId = source.lineage?.observedParentAgentId;
    const claimedChain = declared !== undefined || nativeParentId !== undefined;
    const parentId = claimedChain ? claimedParentId : observedParentId;
    lineageAgreementById.set(
      source.id,
      !observedParentId
        ? "unobserved"
        : claimedChain && claimedParentId !== observedParentId
          ? "contradicted"
          : "corroborated",
    );
    if (!parentId) continue;
    parentById.set(source.id, parentId);
    childCounts.set(parentId, (childCounts.get(parentId) ?? 0) + 1);
  }
  const sidebarByWorkspace = new Map(
    (input.sidebarWorkspaces ?? []).map((workspace) => [workspace.workspaceId, workspace]),
  );
  for (const source of sources) {
    const target = targetsById.get(source.id)!;
    const lastKnown = lastKnownIds.has(source.id);
    const declared = declaredById.get(source.id);
    const senderVerified = input.senderTranscriptTails
      ? senderVerificationFor(source, input.senderTranscriptTails)
      : undefined;
    let identityTrace: IdentityTrace | undefined;
    const readIdentityTrace = (): IdentityTrace => {
      identityTrace ??= lastKnown
        ? {
            steps: [{
              tier: "session",
              outcome: "skipped",
              detail: "Provider evidence is last-known, so current routing was not evaluated.",
            }],
            resolution: "missing",
            reason: target.reason,
          }
        : resolveAgentTargetWithTrace(source, input.surfaces, authoritativeSources).trace;
      return identityTrace;
    };
    const surface = target.surfaceId
      ? input.surfaces.find((candidate) => candidate.surfaceId === target.surfaceId)
      : undefined;
    const sidebar = target.workspaceId
      ? sidebarByWorkspace.get(target.workspaceId)
      : undefined;
    const repoCandidates = [
      declared?.repoRoot,
      sidebar?.projectRootPath,
      source.cwd,
      source.launchCwd,
      !source.cwd || target.cwdRelation !== "different" ? surface?.cwd : undefined,
    ];
    let resolvedRepo: ReturnType<typeof resolveRepoIdentity> = null;
    for (const candidate of repoCandidates) {
      if (!candidate) continue;
      resolvedRepo = resolveRepoIdentity(candidate);
      if (resolvedRepo) break;
    }
    /* Live branch/dirty/PR facts belong to the resolved repository only. A
       manifest may describe a different checkout than the pane running the
       orchestrator, and neither one may overwrite the other's repository facts. */
    const sidebarMatchesRepo = !resolvedRepo || Boolean(
      sidebar?.projectRootPath && pathIsWithin(sidebar.projectRootPath, resolvedRepo.worktreePath),
    );
    const surfaceMatchesRepo = !resolvedRepo || Boolean(
      surface?.cwd && pathIsWithin(surface.cwd, resolvedRepo.worktreePath),
    );
    const repo = resolvedRepo
      ? {
          ...resolvedRepo,
          ...(sidebarMatchesRepo && sidebar?.branch ? { branch: sidebar.branch } : {}),
        }
      : undefined;
    const notification = !lastKnown && target.surfaceId
      ? [...(input.notifications ?? [])]
          .filter((candidate) => {
            if (candidate.surfaceId !== target.surfaceId) return false;
            const startedAtMs = source.startedAt ? Date.parse(source.startedAt) : Number.NaN;
            if (!Number.isFinite(startedAtMs)) return true;
            /* A notification whose time would not parse is kept. It cannot be
               proven older than the session, and dropping it here would restore
               the silence the parser stopped inventing: an agent asking for a
               human, suppressed because its clock was unreadable. */
            if (candidate.createdAt === undefined) return true;
            const notificationAtMs = Date.parse(candidate.createdAt);
            return Number.isFinite(notificationAtMs) && notificationAtMs >= startedAtMs;
          })
          // Newest first; an unknown time sorts last so a dated notification is
          // preferred when both exist, without discarding the undated one.
          .sort((left, right) =>
            (right.createdAt ?? "").localeCompare(left.createdAt ?? ""))[0]
      : undefined;
    // Pane titles and folders are project evidence only when known directories
    // agree. Routing identity remains independent and may still be exact.
    const inferredProgram = programFor(
      source,
      input.programHints ?? [],
      surface,
      target.resolution === "exact" && target.cwdRelation !== "different",
      repo,
    );
    const operatorProgram = (input.programHints ?? []).some((hint) => hint.id === inferredProgram.id);
    const runKey = declared && !operatorProgram
      ? `run:${declared.runId}`
      : undefined;
    const program = runKey && inferredProgram.groupPath
      ? {
          ...inferredProgram,
          id: `repo:${inferredProgram.groupPath[0]}:${runKey}`,
          groupPath: [inferredProgram.groupPath[0], runKey] as [string, string],
        }
      : runKey && declared
        ? { ...inferredProgram, id: runKey, name: declared.runId }
      : inferredProgram;
    /* The status line is a STATE, not a paste.
       This joined title, subtitle and body and cut the result at 500
       characters, which put things like "Codex — Completed in LaHormigaDormida
       — Merged and closed the active Hormiga recovery chain: - [PR #387](https
       ://github.com/…) merged as `6edfb56d7`, fixing Inbox/Watch truth,
       stale-write races, harn…" into the one field a row uses to say what a
       session is doing. Raw markdown, a URL and a commit SHA, truncated
       mid-word.

       The body is not lost and never was: it already rides `transcriptTail`
       below as "[Attention] …" and reaches the attention layer intact. What
       belongs HERE is only what a row can show — who, and what happened. */
    const notificationSummary = notification
      ? summarizeNotification(notification.title, notification.subtitle)
      : undefined;
    const updatedAtMs = Date.parse(source.updatedAt);
    const scope: CollectionScope = collectedIds.has(source.id) || lastKnown ? "observed" : "retained";
    const operatorArchived = input.archiveStore.has(source.id);
    const endEvidence = declared?.succeededBy ? "superseded" as const : source.endEvidence;
    const lifecycleSource = endEvidence === source.endEvidence
      ? source
      : { ...source, endEvidence };
    const verdict = lastKnown
      ? {
          lifecycle: "unverified" as const,
          provenance: "no-evidence" as const,
          reason: input.lastKnownSourceReasons?.[source.provider]
            ?? "This provider did not finish the current refresh; showing last-known data.",
        }
      : lifecycleFor(lifecycleSource, {
          operatorArchived,
          scope,
          nowMs,
          thresholds: input.thresholds,
          /* Only the sessions this scan actually read. A retained record left the
             scan window, so the live process table says nothing about it — offering
             the roster as evidence there would re-end the whole filing cabinet on
             grounds that never applied to it. */
          processRosterComplete: scope === "observed" ? input.processRosterComplete : undefined,
          /* Records written before this contract carry no verdict of their own. The
             one thing still knowable about them is whether a human filed them, so
             that is what a legacy operator archive freezes as; everything else
             reads as aged-out, which is exactly what it is. */
          persisted: source.lifecycle
            ? { lifecycle: source.lifecycle, provenance: source.provenance }
            : operatorArchived
              ? { lifecycle: "finished", provenance: "operator-archive" }
              : undefined,
        });
    /* Every word below is now a reading of ONE verdict. `activity` and `status`
       are translations of it into the two older vocabularies, not second
       opinions about it — which is what they were, and why the board could call
       the same session live in its totals and finished in its rows. */
    const finished = verdict.lifecycle === "finished";
    const retained = scope === "retained";
    const terminal = finished || retained;
    const snapshotStatus = statusForLifecycle(verdict.lifecycle, scope);
    const activity = activityForLifecycle(verdict.lifecycle, scope);
    const processState = lastKnown ? "unknown" as const : retained ? undefined : processStateFor(source);
    const initialRefusal = transmitRefusal({ target, processState, archived: terminal });
    const refusal = initialRefusal?.code === "UNSAFE_TARGET"
      ? transmitRefusal({
          target,
          processState,
          archived: terminal,
          identityTrace: readIdentityTrace(),
          routingObservationsUrl: `/api/debug/identity?agent=${encodeURIComponent(source.id)}`,
        })
      : initialRefusal;
    /* Suppressed for terminal rows, which already explain themselves and have
       no action to recover — and for unverified rows, which are the largest
       population on this board and would otherwise each attach a refusal
       payload AND force an eager identity trace. That is roughly 190 traces and
       100-150 KB per snapshot spent saying "we could not verify this", which
       the row's own word already says. */
    const controlRefusal: SnapshotControlRefusal | undefined =
      !terminal && verdict.lifecycle !== "unverified" && refusal
        ? (({ message: _message, ...published }) => published)(refusal)
        : undefined;
    /* The clock freezes only where something is known to have stopped.

       Unverified deliberately keeps running. Freezing it would be the old ghost
       claim restated in a subtler place: a frozen clock asserts a moment the
       session ended, and the entire point of that state is that no such moment
       was ever observed. A running clock on a silent row reads as "it has been
       this long since we heard anything", which is exactly true. */
    const elapsedEndMs = terminal && Number.isFinite(updatedAtMs)
      ? Math.min(nowMs, updatedAtMs)
      : nowMs;
    const outcome = lastKnown ? "healthy" as const : outcomeFor(source, terminal, Boolean(notification));
    const controlState = lastKnown ? "observed-only" as const : operatorControlState(target, terminal);
    const contextPct = lastKnown ? undefined : contextPctFor(source);
    const role = roleFor2(source, {
      declaredRole: declared?.role,
      observedChildren: childCounts.get(source.id) ?? 0,
    });
    const archivedKind = source as CollectedAgent & Pick<AgentSnapshot, "sessionKind" | "sessionKindSource">;
    const kind = archivedKind.sessionKind && archivedKind.sessionKindSource
      ? { sessionKind: archivedKind.sessionKind, sessionKindSource: archivedKind.sessionKindSource }
      : sessionKindFor({ launch: source.launch, task: source.task });
    const snapshotStatusReason = lastKnown
      ? verdict.reason
      : retained
      ? verdict.reason
      : notificationSummary
        ? `Unread cmux notification: ${notificationSummary}`
        : finished
          ? verdict.reason
          : source.status === "archived" && snapshotStatus !== "archived"
            ? verdict.reason
            : source.statusReason;
    /* `callSizes` is server-side evidence, not board content. Stripped HERE, at
       the one point a CollectedAgent becomes an AgentSnapshot, so there is a
       single boundary to test rather than a rule to remember: the snapshot is
       2.65MB against a 2MB SSE backlog budget (measured 2026-08-03, replacing a
       stale 2.23MB), and the largest session on this machine has 1,575 calls.
       It is served on demand from
       /api/debug/session-calls, where the cost is paid by whoever asks. */
    const displaySource = lastKnown
      ? (({
          processIds: _processIds,
          processStarts: _processStarts,
          processAlive: _processAlive,
          recordedTarget: _recordedTarget,
          lineage: _lineage,
          hookLifecycle: _hookLifecycle,
          hookLifecycleAt: _hookLifecycleAt,
          ...safe
        }) => safe)(source)
      : source;
    const {
      callSizes: _callSizes,
      processedSnapshots: _processedSnapshots,
      launch: _launch,
      ...publishable
    } = displaySource;
    const agent: AgentSnapshotWithControlRefusal = {
      ...publishable,
      ...(source.instanceId !== undefined ? { instanceId: source.instanceId } : {}),
      ...(source.instanceLabel !== undefined ? { instanceLabel: source.instanceLabel } : {}),
      programId: runKey ?? (program.groupPath ? `repo:${program.groupPath[0]}` : program.id),
      /* An unread notification no longer overwrites the status. It used to,
         which is how a working session came to publish `status: "attention"` —
         one field answering two different questions, and losing the first. What
         the notification means rides `attention`, its own field, where it can be
         an overlay instead of a replacement. */
      status: snapshotStatus,
      statusReason: snapshotStatusReason,
      /* Post-uniqueness, so this is the first point `identity.name` is safe to
         render. `displayName` above is deliberately left alone until the client
         cuts over. */
      ...(identitiesById.get(source.id) ? { identity: identitiesById.get(source.id) } : {}),
      activity,
      lifecycle: verdict.lifecycle,
      provenance: verdict.provenance,
      scope,
      ...(lastKnown ? { sourceFreshness: "last-known" as const } : {}),
      endEvidence,
      ...(declared?.taskState && declared.taskStateAt
        ? {
            taskState: declared.taskState,
            taskStateSource: "manifest" as const,
            taskStateAt: declared.taskStateAt,
          }
        : {}),
      /* Published so the client's fallback classifier reaches the same verdict
         from the same evidence. Only where it is true and only on observed
         rows, so it costs nothing on the ~660 retained records it can never
         apply to. */
      /* Grok Bot chats have no process identity (#105). Publishing a complete
         roster here files them finished/process-absent after 45 quiet minutes
         and they vanish from the Board tab into History under "store.db". */
      ...(scope === "observed" && !lastKnown && input.processRosterComplete && !source.id.startsWith("grok:bot:")
        ? { processRosterComplete: true }
        : {}),
      ...(notification ? { attention: true } : {}),
      processState,
      outcome,
      controlState,
      ...role,
      sessionKind: kind.sessionKind,
      sessionKindSource: kind.sessionKindSource,
      effort: effortFor(source),
      ...(contextPct === undefined ? {} : { contextPct }),
      ...(repo ? { repo } : {}),
      ...(sidebarMatchesRepo && sidebar?.pullRequestUrls.length
        ? { pullRequestUrls: sidebar.pullRequestUrls }
        : {}),
      ...(lastKnown ? {} : recordAttention(attentionCoverage, {
        transcriptTail: source.transcriptTail,
        // Straight from cmux, never recovered from the rendered marker: an agent
        // that writes "[Attention] …" into its own transcript must not be able
        // to report itself as blocked on a permission prompt.
        attentionNotification: notification?.body,
        lastAgentMessage: source.lastAgentMessage,
        lastAgentClosing: source.lastAgentClosing,
        activity,
        processState,
        transcriptEndedCleanly: source.transcriptEndedCleanly,
        taskState: declared?.taskState,
        taskStateSource: declared?.taskState && declared.taskStateAt ? "manifest" : undefined,
        hookLifecycle: source.hookLifecycle,
        hookLifecycleAt: source.hookLifecycleAt,
        nowMs,
        stalledActiveMinutes: input.stalledActiveMinutes,
      }, outcome, controlState)),
      parentAgentId: parentById.get(source.id),
      succeededBy: declared?.succeededBy,
      supersedes: declared?.supersedes,
      lineageAgreement: lineageAgreementById.get(source.id),
      threadDepth: source.threadDepth,
      nickname: source.nickname,
      /* Only when a human plausibly typed it — cmux titles every pane, and its
         own defaults must not arrive on the board wearing a rename's authority. */
      surfaceTitle: paneRename(surface?.title, surface?.cwd),
      lastHumanFacingAt: source.lastHumanFacingAt,
      lastUserMessage: source.lastUserMessage,
      ...(senderVerified === undefined ? {} : { senderVerified }),
      lastAgentMessage: source.lastAgentMessage,
      lastAgentClosing: source.lastAgentClosing,
      lastUserChatBody: source.lastUserChatBody,
      lastAgentChatBody: source.lastAgentChatBody,
      lastHumanMessage: source.lastHumanMessage !== undefined
        ? source.lastHumanMessage === source.statusReason
          ? snapshotStatusReason
          : source.lastHumanMessage
        : source.task ?? source.statusReason ?? null,
      transcriptTail: notification?.body
        ? capTranscriptTail(`${source.transcriptTail ? `${source.transcriptTail}\n\n` : ""}[Attention] ${notification.body}`)
        : capTranscriptTail(source.transcriptTail),
      elapsedMs: source.startedAt ? Math.max(0, elapsedEndMs - Date.parse(source.startedAt)) : undefined,
      ...(source.activeMs === undefined ? {} : { activeMs: source.activeMs }),
      git: sidebarMatchesRepo && sidebar
        ? {
            branch: sidebar.branch ?? repo?.branch,
            dirty: sidebar.dirty,
            head: surfaceMatchesRepo ? surface?.head : undefined,
          }
        : surfaceMatchesRepo && surface
          ? {
              branch: surface.branch ?? repo?.branch,
              dirty: surface.dirty,
              head: surface.head,
            }
          : repo?.branch
          ? { branch: repo.branch }
          : undefined,
      target,
      /* Un-archive is offered only where it is HONOURED: the store must be able
         to do it, and the ending must be one a human made. */
      controls: controlsFor(
        source,
        target,
        terminal,
        identityTrace,
        Boolean(input.archiveStore.unarchive) && operatorArchived,
      ),
      ...(controlRefusal ? { controlRefusal } : {}),
    };
    Object.defineProperty(agent, "identityTrace", {
      configurable: false,
      enumerable: false,
      get: readIdentityTrace,
    });
    const group = programs.get(program.id) ?? { ...program, agents: [] };
    group.agents.push(agent);
    programs.set(program.id, group);
  }

  const orderedPrograms = [...programs.values()]
    .map((program) => ({
      ...program,
      agents: program.agents.sort((left, right) => {
        const rank = agentSortRank(left) - agentSortRank(right);
        if (rank) return rank;
        if (left.lastHumanFacingAt && right.lastHumanFacingAt) {
          return right.lastHumanFacingAt.localeCompare(left.lastHumanFacingAt);
        }
        if (left.lastHumanFacingAt) return -1;
        if (right.lastHumanFacingAt) return 1;
        return 0;
      }),
    }))
    .map((program) => ({ ...program, rollup: rollupFor(program.agents, nowMs) }))
    .sort((left, right) =>
      (right.rollup.needsYou - left.rollup.needsYou) ||
      (right.rollup.working - left.rollup.working) ||
      left.name.localeCompare(right.name),
    );
  const allAgents = orderedPrograms.flatMap((program) => program.agents);
  /* The lifecycle census counts only what is still being watched. Every one of
     these gates on scope, because a retained record that reads "waiting" is
     describing what it was doing when the board last saw it, not what it is
     doing now — counting it live is the resurrection hole. */
  const observedAgents = allAgents.filter(
    (agent) => agent.scope !== "retained" && agent.sourceFreshness !== "last-known",
  );
  const scanWindowKnown = typeof input.scanWindowHours === "number"
    && Number.isFinite(input.scanWindowHours)
    && input.scanWindowHours > 0;
  const consumptionValues = observedAgents
    .filter((agent) =>
      agent.tokens.provenance === "observed"
      && typeof agent.tokens.sessionTotal === "number"
      && Number.isFinite(agent.tokens.sessionTotal)
      && agent.tokens.sessionTotal >= 0)
    .map((agent) => agent.tokens.sessionTotal!);
  const consumption = input.sessionCollectionComplete === true
    && scanWindowKnown
    ? consumptionValues.reduce((total, value) => total + value, 0)
    : undefined;
  const countLifecycle = (state: LifecycleState): number =>
    observedAgents.filter((agent) => agent.lifecycle === state).length;
  const byLifecycle = {
    working: countLifecycle("working"),
    waiting: countLifecycle("waiting"),
    unverified: countLifecycle("unverified"),
    finished: countLifecycle("finished"),
  };
  const retained = allAgents.filter((agent) => agent.scope === "retained").length;
  const liveAgents = observedAgents.filter((agent) => isLive(agent, nowMs));
  const workingAgents = observedAgents.filter((agent) => agent.activity === "working");
  const tokenValues = workingAgents
    .map((agent) => agent.tokens.total)
    .filter((value): value is number => typeof value === "number")
    .sort((left, right) => left - right);
  const tokenMedian = tokenValues.length === 0
    ? undefined
    : tokenValues.length % 2 === 1
      ? tokenValues[(tokenValues.length - 1) / 2]
      : Math.round((tokenValues[tokenValues.length / 2 - 1]! + tokenValues[tokenValues.length / 2]!) / 2);
  const contextValues = liveAgents
    .map((agent) => agent.contextPct)
    .filter((value): value is number => typeof value === "number")
    .sort((left, right) => left - right);
  const contextPeak = contextValues.length === 0 ? undefined : contextValues[contextValues.length - 1];
  /* Coverage for contextPeak, from the SAME array it is taken from.

     The card previously borrowed totals.tokenReporting/tokenEligible, which
     counts working agents reporting TOKENS — a different population measuring a
     different thing. Measured by the frontend lane: the suffix read 8/9 while
     32 live agents were reporting contextPct. Deriving it client-side would
     have been a third population, since the headline comes from this filter, so
     the number and its coverage now ship together. */
  const contextReporting = contextValues.length;
  const contextEligible = liveAgents.length;
  const contextMedian = contextValues.length === 0
    ? undefined
    : contextValues.length % 2 === 1
      ? contextValues[(contextValues.length - 1) / 2]
      : Math.round((contextValues[contextValues.length / 2 - 1]! + contextValues[contextValues.length / 2]!) / 2);
  /* Derived from the same array as the peak and the median, for the same reason
     the coverage figure is: three readings of one fleet that came from three
     populations would disagree in public. Mean and median differ on purpose —
     one session at 90% pulls the mean and leaves the median alone, and that gap
     is the shape an operator is looking for. */
  const contextAverage = contextValues.length === 0
    ? undefined
    : Math.round(contextValues.reduce((total, value) => total + value, 0) / contextValues.length);
  const sourceErrors = Object.values(input.sourceErrors ?? {}).flat();
  const cmuxErrors = [...(input.cmuxErrors ?? [])];
  const staleSources = (Object.entries(input.sourceErrors ?? {}) as [Provider, readonly string[]][])
    .filter(([, errors]) => errors.length > 0)
    .map(([provider]) => provider);
  const sourceIssues = buildOperatorIssues(allAgents, input.surfaces, input.sourceErrors, cmuxErrors);
  const { issues, recentlyResolved } = lifecycleIssues(sourceIssues, input, now);
  /* Abandoned panes are separated out before anything downstream counts errors.
     They are permanent by construction — nobody closes a pane from a finished
     wave — so leaving them in `errors` made Operational unreachable on any
     machine that had ever run a swarm, which is every machine this ships to. */
  const identitySplit = classifyIdentityConflicts(allAgents, input.surfaces, cmuxErrors);
  const debris = controlDebrisFor(identitySplit);
  const operationalCmuxErrors = cmuxErrors.filter(
    (error) => !identitySplit.debrisErrors.includes(error),
  );
  /* A cleared archive is a live fault, not debris: every session the operator
     dismissed is back on the board as work in flight, and the count of what is
     running is wrong until it is fixed. */
  const archiveLoadError = input.archiveStore.loadError?.();
  /* DEGRADED means "this is here and I cannot read it" — a fault worth
     alarming about. ABSENT means "there is nothing here to read, because this
     person does not use Cursor" — not a fault at all. Collapsing them told a
     first-time user with a working install that their board was incomplete,
     because a fresh machine has no cmux binary and no ~/.cursor.

     Measured on a virgin clone with an empty HOME: every collector reports
     zero errors, yet the first screen read "No sessions found — and not every
     collector can see · 1 of 4 collectors degraded". The one was cmux, missing
     because it had never been installed. This is the same honesty rule the rest
     of the board follows, pointed at the newcomer instead of at us: we spent
     the day deleting numbers that overclaimed, and this one underclaimed. */
  /* Every provider that has a collector, not a hand-written subset of them.
     This list said codex/claude/cursor and omitted omp, while the byProvider
     breakdown shipped on the same card is built from every provider. Both sets
     once had four members — omp missing here, cmux missing there — so the totals looked
     consistent right up until an omp collector broke, at which point the header
     read "healthy" and the drawer read "broken" off the same snapshot. */
  const collectorProviders: readonly Provider[] = PROVIDERS;
  const absentSources = collectorProviders.filter((provider) =>
    input.sourceAbsent?.[provider] === true
    && (input.sourceErrors?.[provider]?.length ?? 0) === 0,
  ).length;
  const degradedSources = collectorProviders.filter((provider) =>
    (input.sourceErrors?.[provider]?.length ?? 0) > 0,
  ).length;
  /* The ratio counts collectors that EXIST on this machine, and cmux is not one
     of them. `collectSessions` returns one result for every shared provider;
     cmux is the control plane: it has its own
     `controlHealth.cmuxReachable`, its errors become operator issues, and it is
     rendered separately. Counting it here made an unreachable control plane
     print as a broken *collector* — the same fault under two labels, on a board
     whose whole complaint about itself was repeated information.

     The literal 4 that used to sit here was right by arithmetic accident. This
     block dropped omp (-1) and added cmux (+1), and the two cancelled, so the
     published ratio stayed plausible while its membership was wrong. */
  const knownCollectors = collectorProviders.length;
  const sourceTotal = Math.max(0, knownCollectors - absentSources);
  const scanWindowHours = input.scanWindowHours;
  const snapshot: FormicHubSnapshot = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    modelConfig: {
      displayLabels: MODEL_CONFIG.modelDisplayLabels,
    },
    scanWindowHours,
    lookbackHours: scanWindowHours,
    contextPeak,
    contextMedian,
    contextAverage,
    contextReporting,
    contextEligible,
    attentionCoverage,
    controlHealth: {
      cmuxReachable: input.cmuxReachable ?? operationalCmuxErrors.length === 0,
      lastCheckedAt: input.cmuxLastCheckedAt ?? new Date(0).toISOString(),
      /* Deduplicated. `sourceErrors` is flattened across providers, and a fault
         that stops the whole aggregate stops every provider, so one deadline
         arrived here as ten entries. Harmless while this was only counted; the
         card now prints the first and appends "(+N more)", which turned two
         real faults into "(+9 more)" and sent an operator looking for eight
         problems that did not exist. Per-provider errors keep their copies —
         that is what `staleSources` is derived from. */
      errors: [...new Set([
        ...operationalCmuxErrors,
        ...sourceErrors,
        ...(archiveLoadError ? [archiveLoadError] : []),
      ])],
      staleSources,
      ...(debris ? { debris } : {}),
    },
    totals: {
      live: liveAgents.length,
      tracked: allAgents.length,
      attention: observedAgents.filter((agent) => agent.attention === true).length,
      ...(consumption === undefined ? {} : {
        consumption,
        consumptionReporting: consumptionValues.length,
        consumptionEligible: observedAgents.length,
        ...(consumptionValues.length < observedAgents.length ? { consumptionIsFloor: true } : {}),
      }),
      tokens: tokenValues.length ? tokenValues.reduce((total, value) => total + value, 0) : undefined,
      working: observedAgents.filter((agent) => agent.activity === "working").length,
      idle: observedAgents.filter((agent) => agent.activity === "idle").length,
      ended: allAgents.filter((agent) => agent.activity === "ended").length,
      byLifecycle,
      retained,
      /* Agents waiting on a human, counted from the same signal the tab, the
         title badge, the notifier and the program rollup all read. This was
         issues.length — system findings — which meant the rollup cell and the
         totals disagreed about what the word meant while sharing it. */
      needsYou: observedAgents.filter((agent) =>
        agent.lifecycle !== "finished" && taskStateWantsHuman(agent)).length,
      /* System findings keep their own vocabulary. A degraded collector and an
         agent that asked a question are both worth surfacing and neither is the
         other; folding them into one word is what made "needs you" unreadable. */
      systemFindings: issues.length,
      history: allAgents.filter((agent) => agent.activity === "ended").length,
      tokenReporting: workingAgents.filter((agent) => typeof agent.tokens.total === "number").length,
      tokenEligible: workingAgents.length,
      tokenMedian,
      sourceHealth: {
        healthy: Math.max(0, sourceTotal - degradedSources),
        degraded: Math.min(sourceTotal, degradedSources),
        /* Reported so a card can say "Cursor is not installed" rather than
           implying we are watching something that is not there. healthy +
           degraded === total, and total + absent === the four known kinds. */
        absent: Math.min(knownCollectors, absentSources),
        total: sourceTotal,
      },
    },
    issues,
    recentlyResolved,
    cmuxNotifications: [...(input.cmuxNotifications ?? [])],
    acks: [...(input.acks ?? [])],
    programs: orderedPrograms,
    spendSources: [...(input.spendSources ?? [])],
  };
  return withIssueDecoration(snapshot, input.triageSummaries) as FormicHubSnapshot;
}

export function snapshotFingerprint(snapshot: HubSnapshot): string {
  const { generatedAt: _generatedAt, controlHealth, ...stable } = snapshot;
  const { lastCheckedAt: _lastCheckedAt, ...stableHealth } = controlHealth;
  // identityTrace is a non-enumerable lazy getter, so ordinary snapshot/SSE
  // serialization never constructs or ships debug-only evidence.
  const programs = stable.programs.map((program) => ({
    ...program,
    agents: program.agents.map(({ elapsedMs: _elapsedMs, ...agent }) => agent),
  }));
  return JSON.stringify({ ...stable, programs, controlHealth: stableHealth });
}
