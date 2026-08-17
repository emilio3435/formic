import type {
  AgentSnapshot,
  CmuxTarget,
  IdentityTrace,
  IdentityTraceStep,
  IdentityTraceTier,
  ProcessState,
  SessionIdentityClaim,
} from "../shared/types";
import { SHARED_HOST_REASON } from "../shared/identity-copy";
import { hookRecordFor } from "./cmux-hook-sessions";
import {
  grokBotGatewayCopy,
  isGrokBotAgent,
  isGrokBotTarget,
  resolveGrokBotControlTarget,
} from "./grok-bot-gateway";
import type { CmuxSurface, CollectedAgent } from "./types";

function normalizeCwd(value?: string): string {
  return (value ?? "").replace(/\/+$/, "");
}

function sameCwd(left?: string, right?: string): boolean {
  const a = normalizeCwd(left);
  const b = normalizeCwd(right);
  if (!a || !b) return false;
  return a === b;
}

type SessionIdentitySource = Pick<CollectedAgent, "provider" | "sourceSessionId">;

export type SessionIdentityProviderIndex = ReadonlyMap<
  string,
  ReadonlySet<CollectedAgent["provider"]>
>;

export function indexSessionIdentityProviders(
  sources: readonly SessionIdentitySource[],
): SessionIdentityProviderIndex {
  const providersBySession = new Map<string, Set<CollectedAgent["provider"]>>();
  for (const source of sources) {
    const sessionId = source.sourceSessionId.toLowerCase();
    const providers = providersBySession.get(sessionId) ?? new Set();
    providers.add(source.provider);
    providersBySession.set(sessionId, providers);
  }
  return providersBySession;
}

export function sourceSessionHasProviderCollision(
  sessionId: string,
  providersBySession: SessionIdentityProviderIndex,
): boolean {
  return (providersBySession.get(sessionId.toLowerCase())?.size ?? 0) > 1;
}

function sourceSessionClaims(surface: CmuxSurface): SessionIdentityClaim[] {
  return surface.sourceSessionClaims
    ? [...surface.sourceSessionClaims]
    : surface.sourceSessionIds.map((sessionId) => ({ sessionId }));
}

export function surfaceClaimsSourceSession(
  surface: CmuxSurface,
  agent: SessionIdentitySource,
  providersBySession: SessionIdentityProviderIndex,
): boolean {
  const sessionId = agent.sourceSessionId.toLowerCase();
  const claims = sourceSessionClaims(surface).filter(
    (claim) => claim.sessionId.toLowerCase() === sessionId,
  );
  const qualifiedProviders = new Set(
    claims.flatMap(({ provider }) => provider ? [provider] : []),
  );
  if (qualifiedProviders.size > 0) {
    return qualifiedProviders.size === 1 && qualifiedProviders.has(agent.provider);
  }
  if (!claims.some(({ provider }) => provider === undefined)) return false;
  const providers = providersBySession.get(sessionId);
  return !sourceSessionHasProviderCollision(sessionId, providersBySession)
    && (providers === undefined || providers.size === 0 || providers.has(agent.provider));
}

function target(
  surface: CmuxSurface,
  resolution: CmuxTarget["resolution"],
  reason: string,
  agent?: CollectedAgent,
  attestation?: CmuxTarget["attestation"],
): CmuxTarget {
  const surfaceCwd = surface.cwd ? normalizeCwd(surface.cwd) : undefined;
  const agentCwd = agent?.cwd ? normalizeCwd(agent.cwd) : undefined;
  const cwdRelation = surfaceCwd && agentCwd
    ? surfaceCwd === agentCwd ? "same" as const : "different" as const
    : undefined;
  return {
    ...(attestation ? { attestation } : {}),
    workspaceId: surface.workspaceId,
    workspaceTitle: surface.workspaceTitle,
    surfaceId: surface.surfaceId,
    paneId: surface.paneId,
    surfaceCwd,
    cwdRelation,
    resolution,
    reason,
  };
}

/* Which sources may compete for a pane by working directory alone.

   The band is the point, not the word. cwd fallback picks among panes carrying
   NO identity evidence, by elimination on a directory string, so every extra
   candidate makes the elimination weaker — on this machine 26 agents share one
   checkout, and a pool that admits all of them turns `unique-cwd` into
   `ambiguous` for every one. Fresh and mid-band sessions are the ones plausibly
   sitting in a terminal right now; a session quiet long enough to be unverified
   is not, and admitting it would cost the mid-band sessions their controls.

   `status` is still what is read because bridging runs on collected agents,
   before any verdict exists — but "running or waiting" is now exactly the
   fresh-or-mid band, and the lifecycle contract is what defines it. */
function eligibleForCwdFallback(agent: CollectedAgent): boolean {
  return agent.status === "running" || agent.status === "waiting";
}

function quarantined(matches: readonly CmuxSurface[]): CmuxTarget | undefined {
  const conflict = matches.find((surface) => surface.identityConflict);
  if (!conflict) return undefined;
  return {
    resolution: "ambiguous",
    reason: `cmux surface is quarantined because exact identity evidence conflicts: ${conflict.identityConflict}`,
  };
}

function surfaceNamesAgent(surface: CmuxSurface, agent: CollectedAgent): boolean {
  return (surface.identityTrace?.openFileMatches ?? []).some(
    (match) =>
      match.provider === agent.provider
      && match.sessionId.toLowerCase() === agent.sourceSessionId.toLowerCase(),
  );
}

export interface ResolvedAgentTarget {
  target: CmuxTarget;
  trace: IdentityTrace;
}

function resolveAgentTargetInternal(
  agent: CollectedAgent,
  surfaces: readonly CmuxSurface[],
  sources: readonly CollectedAgent[],
  includeTrace: boolean,
): { target: CmuxTarget; trace?: IdentityTrace } {
  const steps: IdentityTraceStep[] | undefined = includeTrace ? [] : undefined;
  const recorded = agent.recordedTarget;
  const finish = (resolved: CmuxTarget, matchedTier?: IdentityTraceTier): {
    target: CmuxTarget;
    trace?: IdentityTrace;
  } => ({
    target: resolved,
    trace: steps ? {
      steps,
      matchedTier,
      resolution: resolved.resolution,
      reason: resolved.reason,
      surfaceId: resolved.surfaceId,
      bindingBridge: matchedTier === "recorded" && recorded?.source === "binding" && recorded.surfaceId
        ? {
            surfaceId: recorded.surfaceId,
            workspaceId: recorded.workspaceId,
            paneId: recorded.paneId,
            confirmedAt: recorded.confirmedAt,
          }
        : undefined,
    } : undefined,
  });

  if (isGrokBotAgent(agent)) {
    const resolved = resolveGrokBotControlTarget(agent);
    if (steps) steps.push(...resolved.trace.steps);
    return finish(resolved.target, resolved.trace.matchedTier);
  }

  const routableSurfaces = surfaces.filter((surface) => surface.runtimeSurfaceReady !== false);
  const sharedHostSurface = routableSurfaces.find(
    (surface) => surface.identityTrace?.outcome === "shared-host" && surfaceNamesAgent(surface, agent),
  );
  if (sharedHostSurface) {
    steps?.push({
      tier: "session",
      outcome: "ambiguous",
      detail: SHARED_HOST_REASON,
    });
    return finish(target(sharedHostSurface, "shared-host", SHARED_HOST_REASON, agent));
  }
  const hookRecord = hookRecordFor(agent.provider, agent.sourceSessionId);
  if (hookRecord) {
    const matches = routableSurfaces.filter((surface) => surface.surfaceId === hookRecord.surfaceId);
    const quarantine = quarantined(matches);
    if (quarantine) {
      steps?.push({ tier: "hook-store", outcome: "quarantined", detail: quarantine.reason ?? "Hook-store surface has an identity conflict." });
      return finish(quarantine);
    }
    if (matches.length === 1) {
      steps?.push({
        tier: "hook-store",
        outcome: "matched",
        detail: `cmux hook store bound source session ${agent.sourceSessionId} to live surface ${matches[0].surfaceId}.`,
      });
      return finish(
        target(
          matches[0],
          "exact",
          "Matched source session to a live surface via the cmux hook-session store.",
          agent,
          "hook-store",
        ),
        "hook-store",
      );
    }
    if (matches.length > 1) {
      steps?.push({ tier: "hook-store", outcome: "ambiguous", detail: `Hook-store surface ID matched ${matches.length} live surfaces.` });
      return finish({
        resolution: "ambiguous",
        reason: `Hook-store surface ID matched ${matches.length} live surfaces; controls are disabled.`,
      });
    }
    steps?.push({ tier: "hook-store", outcome: "no-match", detail: "Hook-store surface is not present in the live ready-surface scan." });
  } else {
    steps?.push({ tier: "hook-store", outcome: "skipped", detail: "No cmux hook-store record exists for this source session." });
  }
  if (recorded && (recorded.surfaceId || recorded.workspaceId || recorded.paneId)) {
    const matches = routableSurfaces.filter(
      (surface) =>
        (!recorded.surfaceId || recorded.surfaceId === surface.surfaceId) &&
        (!recorded.workspaceId || recorded.workspaceId === surface.workspaceId) &&
        (!recorded.paneId || recorded.paneId === surface.paneId),
    );
    const quarantine = quarantined(matches);
    if (quarantine) {
      steps?.push({ tier: "recorded", outcome: "quarantined", detail: quarantine.reason ?? "Recorded surface has an identity conflict." });
      return finish(quarantine);
    }
    if (matches.length === 1) {
      steps?.push({
        tier: "recorded",
        outcome: "matched",
        detail: `Recorded cmux target IDs matched surface ${matches[0].surfaceId}${recorded.source === "binding" ? " via a persisted identity binding" : ""}.`,
      });
      /* A persisted binding is the one path that mints `exact` without cmux
         saying anything about this session in this scan. It was confirmed by
         live lsof evidence once, which is why the mechanism exists — but "once"
         is not "now", and the write gate had no way to tell the two apart. */
      return finish(
        target(
          matches[0],
          "exact",
          recorded.reason ?? "Matched recorded cmux target IDs.",
          agent,
          recorded.source === "binding" ? "remembered" : "live",
        ),
        "recorded",
      );
    }
    if (matches.length > 1) {
      steps?.push({ tier: "recorded", outcome: "ambiguous", detail: `Recorded cmux IDs matched ${matches.length} surfaces.` });
      return finish({ resolution: "ambiguous", reason: "Recorded cmux IDs matched multiple surfaces; controls are disabled." });
    }
    steps?.push({ tier: "recorded", outcome: "no-match", detail: "Recorded cmux target IDs matched no ready surface; falling through to session evidence." });
  } else {
    steps?.push({ tier: "recorded", outcome: "skipped", detail: "No recorded cmux target IDs on this source." });
  }

  const providersBySession = indexSessionIdentityProviders(sources);
  const sessionMatches = routableSurfaces.filter((surface) =>
    surfaceClaimsSourceSession(surface, agent, providersBySession),
  );
  const sessionQuarantine = quarantined(sessionMatches);
  if (sessionQuarantine) {
    steps?.push({ tier: "session", outcome: "quarantined", detail: sessionQuarantine.reason ?? "Session-matched surface has an identity conflict." });
    return finish(sessionQuarantine);
  }
  if (sessionMatches.length === 1) {
    steps?.push({
      tier: "session",
      outcome: "matched",
      detail: `Source session ID ${agent.sourceSessionId} recorded by cmux on surface ${sessionMatches[0].surfaceId}.`,
    });
    return finish(
      target(
        sessionMatches[0],
        "exact",
        "Matched source session ID recorded by cmux.",
        agent,
        // Provider-qualified claims, or collision-checked legacy claims, are
        // cmux attesting in this scan that this exact session is here.
        "live",
      ),
      "session",
    );
  }
  if (sessionMatches.length > 1) {
    steps?.push({ tier: "session", outcome: "ambiguous", detail: `Source session ID appears on ${sessionMatches.length} cmux surfaces.` });
    return finish({
      resolution: "ambiguous",
      reason: `Source session ID appears on ${sessionMatches.length} cmux surfaces; controls are disabled.`,
    });
  }
  steps?.push({ tier: "session", outcome: "no-match", detail: "Source session ID is not present on any ready cmux surface this scan." });

  if (agent.allowCwdFallback === false) {
    steps?.push({ tier: "cwd", outcome: "rejected", detail: "Cursor GUI agents require exact cmux identity; cwd fallback is disabled." });
    return finish({
      resolution: "missing",
      reason: "Cursor GUI agents require exact cmux identity; cwd fallback is disabled.",
    });
  }

  if (!agent.cwd) {
    steps?.push({ tier: "cwd", outcome: "rejected", detail: "Source did not record a cwd." });
    return finish({ resolution: "missing", reason: "Source did not record a cwd or exact cmux target." });
  }
  if (agent.parentSourceSessionId) {
    steps?.push({
      tier: "cwd",
      outcome: "rejected",
      detail: `Child source ${agent.sourceSessionId} belongs to parent ${agent.parentSourceSessionId} and requires exact session evidence.`,
    });
    return finish({
      resolution: "missing",
      reason: "Child sources require exact session evidence; cwd fallback is disabled.",
    });
  }
  const cwdMatches = routableSurfaces.filter((surface) => sameCwd(surface.cwd, agent.cwd));
  const implicatedCwdMatches = cwdMatches.filter((surface) => {
    if (!surface.identityConflict) return false;
    const namedSessions = [
      ...(surface.identityTrace?.openFileMatches ?? []).map(({ sessionId }) => sessionId),
      ...surface.sourceSessionIds,
      ...(surface.sourceSessionClaims ?? []).map(({ sessionId }) => sessionId),
    ];
    /* A conflict that names nobody (probe timeout, truncated lsof) is
       unexplained evidence. Unique-cwd must not claim that pane. */
    if (namedSessions.length === 0) return true;
    const recordedTargetNamesSurface = Boolean(
      recorded && (recorded.surfaceId || recorded.workspaceId || recorded.paneId),
    )
      && (!recorded?.surfaceId || recorded.surfaceId === surface.surfaceId)
      && (!recorded?.workspaceId || recorded.workspaceId === surface.workspaceId)
      && (!recorded?.paneId || recorded.paneId === surface.paneId);
    return surfaceClaimsSourceSession(surface, agent, providersBySession)
      || surfaceNamesAgent(surface, agent)
      || hookRecord?.surfaceId === surface.surfaceId
      || recordedTargetNamesSurface;
  });
  const cwdQuarantine = quarantined(implicatedCwdMatches);
  if (cwdQuarantine) {
    steps?.push({ tier: "cwd", outcome: "quarantined", detail: cwdQuarantine.reason ?? "A cwd-matched surface has an identity conflict." });
    return finish(cwdQuarantine);
  }
  if (!eligibleForCwdFallback(agent)) {
    steps?.push({ tier: "cwd", outcome: "rejected", detail: `cwd fallback requires a running or waiting source; source is ${agent.status}.` });
    return finish({
      resolution: "missing",
      reason: `cwd fallback requires a running or waiting source; source is ${agent.status}.`,
    });
  }
  const cwdSources = sources.filter(
    (candidate) =>
      !candidate.parentSourceSessionId &&
      eligibleForCwdFallback(candidate) &&
      sameCwd(candidate.cwd, agent.cwd),
  );
  if (cwdSources.length !== 1 || cwdSources[0]?.id !== agent.id) {
    // Shared cwd with no cmux surface is "not linked" (view only), not an
    // identity conflict. Only quarantine when a surface exists and ownership
    // would be a guess among multiple active sources.
    if (cwdMatches.length === 0) {
      steps?.push({ tier: "cwd", outcome: "no-match", detail: "No ready cmux surface shares this cwd." });
      return finish({ resolution: "missing", reason: "No cmux surface matches this source session or cwd." });
    }
    steps?.push({ tier: "cwd", outcome: "ambiguous", detail: `${cwdSources.length} active sources share this cwd; cwd fallback requires exactly one.` });
    return finish({
      resolution: "ambiguous",
      reason: `${cwdSources.length} active sources share this cwd; cwd fallback requires exactly one and controls are disabled.`,
    });
  }
  const eligibleSurfaces = cwdMatches.filter((surface) => surface.sourceSessionIds.length === 0);
  if (eligibleSurfaces.length === 1) {
    steps?.push({
      tier: "cwd",
      outcome: "matched",
      detail: `This source is the only active one with cwd ${normalizeCwd(agent.cwd)}, and surface ${eligibleSurfaces[0].surfaceId} is the only unclaimed surface with that cwd.`,
    });
    return finish(
      target(
        eligibleSurfaces[0],
        "unique-cwd",
        "Matched one active source to the only unclaimed cmux surface with this exact cwd.",
        agent,
      ),
      "cwd",
    );
  }
  if (eligibleSurfaces.length > 1) {
    steps?.push({ tier: "cwd", outcome: "ambiguous", detail: `${eligibleSurfaces.length} unclaimed cmux surfaces share this cwd.` });
    return finish({
      resolution: "ambiguous",
      reason: `${eligibleSurfaces.length} unclaimed cmux surfaces share this cwd; controls are disabled.`,
    });
  }
  if (cwdMatches.length > 0) {
    steps?.push({ tier: "cwd", outcome: "rejected", detail: "All surfaces with this cwd already carry exact identity evidence for other sessions." });
    return finish({
      resolution: "ambiguous",
      reason: "cmux surfaces for this cwd already carry exact identity evidence; cwd fallback is disabled.",
    });
  }
  steps?.push({ tier: "cwd", outcome: "no-match", detail: "No ready cmux surface shares this cwd." });
  return finish({ resolution: "missing", reason: "No cmux surface matches this source session or cwd." });
}

/* The single write gate. It exists as one exported function because it did NOT:
   547679e closed the instruct/interrupt path in control.ts and left an
   identical predicate in app.ts's attention handler, so acknowledging agent A
   still cleared the notification on whatever pane A currently resolved to. One
   copy of a safety invariant is a rule; two copies are a rule and a bug waiting
   to be found separately.

   `exact` means cmux attests the session is on that surface. `unique-cwd`
   matches a pane on its working directory among panes carrying NO identity
   evidence, so the session on it is inferred. A directory match may inform
   display; it may not authorise anything that acts on the pane. */
/* May we point the operator at this pane at all? Both tiers qualify: a
   directory match is good enough to show a row and to focus it, because focus
   types nothing and going to look is how an operator resolves the ambiguity.
   Named rather than written inline so the two questions - may we ADDRESS this
   pane, may we ACT on it - stop sharing one unlabelled array literal. */
export function canAddressTarget<T extends Pick<CmuxTarget, "surfaceId" | "resolution" | "kind" | "instanceId">>(
  target: T,
): boolean {
  if (isGrokBotTarget(target)) return Boolean(target.instanceId);
  return Boolean(target.surfaceId)
    && (target.resolution === "exact" || target.resolution === "unique-cwd");
}

export function canWriteToTarget<T extends Pick<
  CmuxTarget,
  "surfaceId" | "resolution" | "attestation" | "kind" | "agentId" | "instanceId" | "gatewayReady" | "gatewayMiss"
>>(
  target: T,
): boolean {
  if (isGrokBotTarget(target)) {
    return Boolean(target.agentId)
      && Boolean(target.instanceId)
      && target.gatewayReady === true;
  }
  return Boolean(target.surfaceId)
    && target.resolution === "exact"
    // EVER attested is not CURRENTLY attested. A persisted binding was true when
    // it was written; nothing in this scan says the session is still there.
    && target.attestation !== "remembered";
}

/* Affirmative evidence the agent is gone. Deliberately ONLY "died", which is
   `processAlive === false` with process ids to have checked — the collector
   looked and found the process absent.

   "unknown" must keep writing. It is `processAlive === undefined`: the lsof
   race the binding mechanism exists to survive, and on this fleet it is 24 of
   29 live agents. Blocking it would disable Send on 83% of a working board —
   trading a defect for an outage, which is the failure mode a liveness gate
   invites.

   "exited" is excluded too, for a subtler reason: it comes from
   `transcriptEndedCleanly`, which for Claude sessions is `stop_reason:
   "end_turn"` — the end of a TURN, not of a session. An agent waiting for your
   reply reads "exited". Refusing writes there would switch off Send on exactly
   the agents that are waiting for a human. */
/* ONE predicate for "may we put characters into this pane", read by the button
   and by the endpoint.

   26a4585 closed executeControl and left controlsFor untouched, so the board
   offered Send on a row whose process was known dead and the endpoint then
   answered 409. Nothing unsafe happened - and that is the point: a surface
   claiming something the system will not honour is the class this project has
   spent two days removing, and it recurred here because agreement depended on
   two call sites being edited together. It had already failed that way once
   with unique-cwd, in app.ts.

   So agreement is by construction. Both callers ask this and neither restates
   the rule. Returns the refusal an operator should read, or null to transmit. */
export interface TransmitRefusal {
  code: "AGENT_ARCHIVED" | "UNSAFE_TARGET" | "AGENT_NOT_RUNNING";
  cause: string;
  remedy: string;
  evidence: {
    resolutionSteps: string[];
    observationsUrl?: string;
  };
  message: string;
}

export interface RoutingSurfaceObservation {
  workspaceId?: string;
  surfaceId: string;
  paneId?: string;
  tty?: string;
  reportedSessionIds: string[];
  reportedSessionClaims: SessionIdentityClaim[];
  sessionIdMatched: boolean;
  cwdMatched: boolean;
  reason: string;
}

export function routingSurfaceObservations(
  agent: Pick<CollectedAgent, "provider" | "sourceSessionId" | "cwd" | "status">,
  surfaces: readonly CmuxSurface[],
  sources: readonly SessionIdentitySource[] = [agent],
): RoutingSurfaceObservation[] {
  const providersBySession = indexSessionIdentityProviders(sources);
  return surfaces
    .filter((surface) => surface.runtimeSurfaceReady !== false)
    .map((surface) => {
      const reportedSessionIds = [...surface.sourceSessionIds];
      const reportedSessionClaims = sourceSessionClaims(surface);
      const sessionIdMatched = surfaceClaimsSourceSession(surface, agent, providersBySession);
      const cwdMatched = sameCwd(surface.cwd, agent.cwd);
      const pane = surface.paneId
        ? `Pane ${surface.paneId} (surface ${surface.surfaceId}${surface.tty ? `, ${surface.tty}` : ""})`
        : `Surface ${surface.surfaceId}${surface.tty ? ` (${surface.tty})` : ""}`;
      let reason: string;
      if (sessionIdMatched) {
        const qualified = reportedSessionClaims.some(
          (claim) => claim.provider === agent.provider
            && claim.sessionId.toLowerCase() === agent.sourceSessionId.toLowerCase(),
        );
        reason = `${pane} reported ${qualified ? `${agent.provider}:` : "source session "}${agent.sourceSessionId}.`;
      } else if (reportedSessionIds.length === 0) {
        reason = `${pane} reported no source session IDs; source session ${agent.sourceSessionId} could not match.`;
      } else {
        const renderedClaims = reportedSessionClaims
          .map(({ provider, sessionId }) => `${provider ? `${provider}:` : "unqualified:"}${sessionId}`)
          .join(", ");
        reason = `${pane} reported ${renderedClaims}; none safely matches ${agent.provider}:${agent.sourceSessionId}.`;
      }
      if (!sessionIdMatched && cwdMatched) {
        reason += " Its cwd matches the source, but cwd evidence is not exact session identity.";
      }
      return {
        ...(surface.workspaceId ? { workspaceId: surface.workspaceId } : {}),
        surfaceId: surface.surfaceId,
        ...(surface.paneId ? { paneId: surface.paneId } : {}),
        ...(surface.tty ? { tty: surface.tty } : {}),
        reportedSessionIds,
        reportedSessionClaims,
        sessionIdMatched,
        cwdMatched,
        reason,
      };
    });
}

export function transmitRefusal(agent: {
  target: Pick<
    CmuxTarget,
    "surfaceId" | "resolution" | "attestation" | "reason" | "kind" | "agentId" | "instanceId" | "gatewayReady" | "gatewayMiss"
  >;
  processState?: ProcessState;
  archived?: boolean;
  identityTrace?: IdentityTrace;
  routingObservationsUrl?: string;
}): TransmitRefusal | null {
  const targetAttestation = agent.target.attestation;
  const refuse = (
    code: TransmitRefusal["code"],
    cause: string,
    remedy: string,
    resolutionSteps: string[],
  ): TransmitRefusal => ({
    code,
    cause,
    remedy,
    evidence: {
      resolutionSteps,
      ...(agent.routingObservationsUrl ? { observationsUrl: agent.routingObservationsUrl } : {}),
    },
    message: `${cause} ${remedy}`,
  });
  const routingEvidence = agent.identityTrace?.steps.map(({ detail }) => detail) ?? [
    `Target resolver returned ${agent.target.resolution}${agent.target.surfaceId ? ` for surface ${agent.target.surfaceId}` : " with no surface"}.`,
  ];
  if (agent.archived) {
    return refuse(
      "AGENT_ARCHIVED",
      "This agent is archived.",
      "Read it in History, or start a new session if more work is needed.",
      ["The current snapshot marks this agent as archived."],
    );
  }
  if (isGrokBotTarget(agent.target)) {
    if (!canWriteToTarget(agent.target)) {
      const copy = grokBotGatewayCopy(agent.target.gatewayMiss ?? "unreachable-box");
      return refuse("UNSAFE_TARGET", copy.cause, copy.remedy, routingEvidence);
    }
    /* Grok Bot has no process identity. "unknown" must not disable Send. */
    return null;
  }
  if (!canAddressTarget(agent.target)) {
    const cursorRequiresExact = agent.identityTrace?.steps.some(
      ({ detail }) => detail === "Cursor GUI agents require exact cmux identity; cwd fallback is disabled.",
    ) ?? false;
    return refuse(
      "UNSAFE_TARGET",
      cursorRequiresExact
        ? "No safe cmux target is linked to this session."
        : agent.target.reason ?? "No safe cmux surface target is available.",
      agent.target.resolution === "ambiguous"
        ? "Inspect the routing evidence, then remove the conflicting claim so one exact session identity remains."
        : cursorRequiresExact
          ? "Open it in a cmux pane (or start the agent from one); the next scan binds it."
          : "Open or start the agent in a cmux pane; the next scan links it when cmux reports the session.",
      routingEvidence,
    );
  }
  if (processKnownDead(agent)) {
    return refuse(
      "AGENT_NOT_RUNNING",
      "This agent's process was checked and is gone, so its pane may now belong to someone else. Sending here could reach whoever took it over.",
      "Archive the row, or start the agent again.",
      ["The PID-backed liveness check reported process state died."],
    );
  }
  if (!canWriteToTarget(agent.target)) {
    const remembered = targetAttestation === "remembered";
    return refuse(
      "UNSAFE_TARGET",
      remembered
        ? "This pane is linked only by a remembered binding, so the session on it is not confirmed in this scan. Sending here could reach a different agent."
        : "This pane was matched by its working directory, not attested by cmux, so the session on it cannot be proven. Sending here could reach a different agent.",
      remembered
        ? "Focus still works; Send and Interrupt return when cmux re-attests the session."
        : "Focus still works; Send and Interrupt return as soon as cmux attests the session.",
      routingEvidence,
    );
  }
  return null;
}

export function processKnownDead(agent: Pick<AgentSnapshot, "processState">): boolean {
  return agent.processState === "died";
}

export function resolveAgentTargetWithTrace(
  agent: CollectedAgent,
  surfaces: readonly CmuxSurface[],
  sources: readonly CollectedAgent[] = [agent],
): ResolvedAgentTarget {
  const resolved = resolveAgentTargetInternal(agent, surfaces, sources, true);
  return { target: resolved.target, trace: resolved.trace! };
}

export function resolveAgentTarget(
  agent: CollectedAgent,
  surfaces: readonly CmuxSurface[],
  sources: readonly CollectedAgent[] = [agent],
): CmuxTarget {
  return resolveAgentTargetInternal(agent, surfaces, sources, false).target;
}
