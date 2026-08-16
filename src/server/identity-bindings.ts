import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PROVIDERS, type Provider } from "../shared/types";
import type { CmuxSurface, CollectedAgent } from "./types";
import { livenessOfAny, processAliveFrom, type ProcessRoster } from "./process-liveness";
import {
  indexSessionIdentityProviders,
  sourceSessionHasProviderCollision,
  surfaceClaimsSourceSession,
} from "./targets";

/** Bindings not reconfirmed by live evidence for this long age out. */
export const IDENTITY_BINDING_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
/** Consecutive scans that must agree before a binding moves surfaces. */
export const REASSIGNMENT_CONFIRMATION_SCANS = 2;
export const BINDING_BRIDGE_REASON = "Recorded binding, live evidence absent this scan.";

export interface IdentityBindingTarget {
  surfaceId: string;
  workspaceId?: string;
  paneId?: string;
}

export interface IdentityBinding {
  sessionId: string;
  provider?: Provider;
  target: IdentityBindingTarget;
  firstConfirmedAt: string;
  confirmedAt: string;
  /** Exact recognized agent PIDs observed when this binding was confirmed. */
  processIds?: number[];
  /**
   * When each of those PIDs started, keyed by PID as a string because this
   * record is JSON on disk.
   *
   * Without it a stored pid can only ever be re-checked as "is that number in
   * use", which is how sessions rode `siriknowledged` and `sysextd` on the
   * board for up to 33 hours. Optional, and absent from every binding written
   * before this field existed, so a missing entry must fall back to the weaker
   * check — never to an ending.
   */
  processStarts?: Record<string, number>;
  /** A candidate new surface observed while the current target still stands. */
  pendingReassignment?: {
    target: IdentityBindingTarget;
    scansAgreed: number;
    firstSeenAt: string;
  };
}

export interface IdentityBindingStore {
  get(sessionId: string): IdentityBinding | undefined;
  /** Provider-qualified lookup; optional for legacy/custom stores. */
  getForProvider?(provider: Provider, sessionId: string): IdentityBinding | undefined;
  list(): readonly IdentityBinding[];
  put(binding: IdentityBinding): Promise<void>;
  putMany(bindings: readonly IdentityBinding[]): Promise<void>;
  getNameTag?(agentId: string): string | undefined;
  rememberNameTags?(assignments: readonly IdentityNameTag[]): Promise<void>;
}

export interface IdentityNameTag {
  agentId: string;
  tag: string;
}

export interface BindingFileOperations {
  readText(path: string): Promise<string>;
  makeDirectory(path: string): Promise<void>;
  writeText(path: string, contents: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

const nodeFileOperations: BindingFileOperations = {
  readText: (path) => readFile(path, "utf8"),
  makeDirectory: async (path) => {
    await mkdir(path, { recursive: true });
  },
  writeText: async (path, contents) => {
    await writeFile(path, contents, "utf8");
  },
  rename,
};

function bindingKey(binding: Pick<IdentityBinding, "provider" | "sessionId">): string {
  return binding.provider
    ? `${binding.provider}:${binding.sessionId.toLowerCase()}`
    : `legacy:${binding.sessionId.toLowerCase()}`;
}

function bindingForProvider(
  store: IdentityBindingStore,
  provider: Provider,
  sessionId: string,
): IdentityBinding | undefined {
  const binding = store.getForProvider?.(provider, sessionId) ?? store.get(sessionId);
  return binding && (binding.provider === undefined || binding.provider === provider)
    ? binding
    : undefined;
}

function isBindingTarget(value: unknown): value is IdentityBindingTarget {
  if (!value || typeof value !== "object") return false;
  const target = value as Partial<IdentityBindingTarget>;
  return (
    typeof target.surfaceId === "string" &&
    (target.workspaceId === undefined || typeof target.workspaceId === "string") &&
    (target.paneId === undefined || typeof target.paneId === "string")
  );
}

function isIdentityBinding(value: unknown): value is IdentityBinding {
  if (!value || typeof value !== "object") return false;
  const binding = value as Partial<IdentityBinding>;
  return (
    typeof binding.sessionId === "string" &&
    (binding.provider === undefined || PROVIDERS.includes(binding.provider)) &&
    isBindingTarget(binding.target) &&
    typeof binding.firstConfirmedAt === "string" &&
    typeof binding.confirmedAt === "string" &&
    (binding.processIds === undefined ||
      (Array.isArray(binding.processIds) &&
        binding.processIds.every((pid) => Number.isInteger(pid) && pid > 0))) &&
    (binding.processStarts === undefined ||
      (typeof binding.processStarts === "object" &&
        binding.processStarts !== null &&
        !Array.isArray(binding.processStarts) &&
        Object.entries(binding.processStarts).every(
          ([pid, start]) => /^[1-9]\d*$/.test(pid) && typeof start === "number" && Number.isFinite(start),
        ))) &&
    (binding.pendingReassignment === undefined ||
      (typeof binding.pendingReassignment === "object" &&
        binding.pendingReassignment !== null &&
        isBindingTarget(binding.pendingReassignment.target) &&
        typeof binding.pendingReassignment.scansAgreed === "number" &&
        typeof binding.pendingReassignment.firstSeenAt === "string"))
  );
}

function isFresh(binding: IdentityBinding, nowMs: number): boolean {
  const confirmedAtMs = Date.parse(binding.confirmedAt);
  return Number.isFinite(confirmedAtMs) && nowMs - confirmedAtMs <= IDENTITY_BINDING_TTL_MS;
}

export class JsonIdentityBindingStore implements IdentityBindingStore {
  readonly #bindings = new Map<string, IdentityBinding>();
  readonly #nameTags = new Map<string, string>();
  #writeQueue: Promise<void> = Promise.resolve();
  #writeNumber = 0;

  private constructor(
    private readonly path: string,
    private readonly files: BindingFileOperations,
    private readonly now: () => number,
  ) {}

  static async open(
    path: string,
    files: BindingFileOperations = nodeFileOperations,
    now: () => number = Date.now,
  ): Promise<JsonIdentityBindingStore> {
    const store = new JsonIdentityBindingStore(path, files, now);
    try {
      const parsed: unknown = JSON.parse(await files.readText(path));
      const bindings = Array.isArray(parsed)
        ? parsed
        : (parsed as { bindings?: unknown } | null)?.bindings;
      if (Array.isArray(bindings)) {
        for (const value of bindings) {
          if (!isIdentityBinding(value)) {
            throw new Error("identity bindings file contains an invalid binding record");
          }
          // Prune on load: sessions that left the scan window age out here.
          if (isFresh(value, now())) store.#bindings.set(bindingKey(value), value);
        }
      }
      const nameTags = Array.isArray(parsed)
        ? undefined
        : (parsed as { nameTags?: unknown } | null)?.nameTags;
      if (nameTags !== undefined) {
        if (!nameTags || typeof nameTags !== "object" || Array.isArray(nameTags)) {
          throw new Error("identity bindings file contains invalid name tags");
        }
        for (const [agentId, value] of Object.entries(nameTags as Record<string, unknown>)) {
          if (!agentId.trim() || typeof value !== "string" || !value.trim()) {
            throw new Error("identity bindings file contains an invalid name tag");
          }
          store.#nameTags.set(agentId, value.trim());
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return store;
  }

  /* Freshness was enforced on load and on save but never on read, so a binding
     that passed its TTL while the process stayed up — and no scan happened to
     write — kept answering lookups. bridgeAgentsWithBindings takes that stale
     answer as a recorded target, which is how a live session comes to look
     exactly linked to a recycled cmux surface and controls route to the wrong
     pane. An expired binding is not weaker evidence; it is no evidence. */
  get(sessionId: string): IdentityBinding | undefined {
    const nowMs = this.now();
    const candidates = [
      ...PROVIDERS.map((provider) =>
        this.#freshBinding(bindingKey({ provider, sessionId }), nowMs)),
      this.#freshBinding(bindingKey({ sessionId }), nowMs),
    ].filter((binding): binding is IdentityBinding => binding !== undefined);
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  getForProvider(provider: Provider, sessionId: string): IdentityBinding | undefined {
    const nowMs = this.now();
    return this.#freshBinding(bindingKey({ provider, sessionId }), nowMs)
      ?? this.#freshBinding(bindingKey({ sessionId }), nowMs);
  }

  list(): readonly IdentityBinding[] {
    const nowMs = this.now();
    for (const [key, binding] of [...this.#bindings]) {
      if (!isFresh(binding, nowMs)) this.#bindings.delete(key);
    }
    return [...this.#bindings.values()];
  }

  put(binding: IdentityBinding): Promise<void> {
    return this.putMany([binding]);
  }

  putMany(bindings: readonly IdentityBinding[]): Promise<void> {
    if (bindings.length === 0) return Promise.resolve();
    return this.#enqueuePersist(bindings);
  }

  getNameTag(agentId: string): string | undefined {
    return this.#nameTags.get(agentId);
  }

  rememberNameTags(assignments: readonly IdentityNameTag[]): Promise<void> {
    let changed = false;
    for (const assignment of assignments) {
      const agentId = assignment.agentId.trim();
      const tag = assignment.tag.trim();
      if (!agentId || !tag || this.#nameTags.has(agentId)) continue;
      this.#nameTags.set(agentId, tag);
      changed = true;
    }
    return changed ? this.#enqueuePersist([]) : Promise.resolve();
  }

  #freshBinding(key: string, nowMs: number): IdentityBinding | undefined {
    const binding = this.#bindings.get(key);
    if (!binding) return undefined;
    if (isFresh(binding, nowMs)) return binding;
    this.#bindings.delete(key);
    return undefined;
  }

  #enqueuePersist(bindings: readonly IdentityBinding[]): Promise<void> {
    const write = this.#writeQueue.then(() => this.#persist(bindings));
    // A failed write rejects its caller but does not poison later queued writes.
    this.#writeQueue = write.catch(() => {});
    return write;
  }

  async #persist(bindings: readonly IdentityBinding[]): Promise<void> {
    const nowMs = this.now();
    const next = new Map(this.#bindings);
    for (const binding of bindings) {
      next.set(bindingKey(binding), binding);
    }
    // Prune on save so the file never accumulates departed sessions.
    for (const [key, value] of next) {
      if (!isFresh(value, nowMs)) next.delete(key);
    }
    const persisted = [...next.values()].sort((left, right) => left.sessionId.localeCompare(right.sessionId));
    const nameTags = Object.fromEntries(
      [...this.#nameTags].sort(([left], [right]) => left.localeCompare(right)),
    );
    const body = this.#nameTags.size > 0 ? { bindings: persisted, nameTags } : persisted;
    await this.files.makeDirectory(dirname(this.path));
    this.#writeNumber += 1;
    const temporaryPath = `${this.path}.${process.pid}.${this.#writeNumber}.tmp`;
    await this.files.writeText(temporaryPath, `${JSON.stringify(body, null, 2)}\n`);
    await this.files.rename(temporaryPath, this.path);
    // The in-memory state becomes visible only after the atomic rename commits.
    this.#bindings.clear();
    for (const [key, value] of next) this.#bindings.set(key, value);
  }
}

export class MemoryIdentityBindingStore implements IdentityBindingStore {
  readonly #bindings = new Map<string, IdentityBinding>();
  readonly #nameTags = new Map<string, string>();

  get(sessionId: string): IdentityBinding | undefined {
    const candidates = [
      ...PROVIDERS.map((provider) => this.#bindings.get(bindingKey({ provider, sessionId }))),
      this.#bindings.get(bindingKey({ sessionId })),
    ].filter((binding): binding is IdentityBinding => binding !== undefined);
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  getForProvider(provider: Provider, sessionId: string): IdentityBinding | undefined {
    return this.#bindings.get(bindingKey({ provider, sessionId }))
      ?? this.#bindings.get(bindingKey({ sessionId }));
  }

  list(): readonly IdentityBinding[] {
    return [...this.#bindings.values()];
  }

  async put(binding: IdentityBinding): Promise<void> {
    this.#bindings.set(bindingKey(binding), binding);
  }

  async putMany(bindings: readonly IdentityBinding[]): Promise<void> {
    for (const binding of bindings) {
      this.#bindings.set(bindingKey(binding), binding);
    }
  }

  getNameTag(agentId: string): string | undefined {
    return this.#nameTags.get(agentId);
  }

  async rememberNameTags(assignments: readonly IdentityNameTag[]): Promise<void> {
    for (const assignment of assignments) {
      const agentId = assignment.agentId.trim();
      const tag = assignment.tag.trim();
      if (agentId && tag && !this.#nameTags.has(agentId)) this.#nameTags.set(agentId, tag);
    }
  }
}

/**
 * Record/refresh bindings from one completed identity scan. Only surfaces the
 * scan linked through open session files or a uniquely resolved full command
 * session ID count as confirmation. Carried-over cmux metadata never moves a
 * binding.
 */
export async function updateBindingsFromScan(
  store: IdentityBindingStore,
  surfaces: readonly CmuxSurface[],
  nowIso: string,
): Promise<{ errors: string[] }> {
  const errors: string[] = [];
  const confirmed = new Map<string, {
    sessionId: string;
    surface: CmuxSurface;
    provider: Provider;
    processIds: number[];
    processStarts?: Record<string, number>;
  }>();
  const contested = new Set<string>();
  for (const surface of surfaces) {
    const trace = surface.identityTrace;
    if (!trace || (trace.outcome !== "open-file-match" && trace.outcome !== "command-hint-match")) continue;
    if (surface.identityConflict || surface.sourceSessionIds.length !== 1) continue;
    const sessionId = surface.sourceSessionIds[0].toLowerCase();
    const openMatches = trace.openFileMatches.filter(
      (match) => match.sessionId.toLowerCase() === sessionId,
    );
    const commandMatches = trace.commandHints.filter(
      (hint) => hint.resolvedSessionId?.toLowerCase() === sessionId,
    );
    const provider = openMatches[0]?.provider ?? commandMatches[0]?.provider;
    if (!provider) continue;
    const identity = `${provider}:${sessionId}`;
    const existing = confirmed.get(identity);
    if (existing && existing.surface.surfaceId !== surface.surfaceId) {
      // One session confirmed on two surfaces in one scan is not evidence to
      // bind on — leave whatever binding exists untouched.
      contested.add(identity);
      continue;
    }
    const processIds = [...new Set([
      ...openMatches.map(({ pid }) => pid),
      ...commandMatches.map(({ pid }) => pid),
    ])];
    if (processIds.length === 0) continue;
    /* Store WHEN each pid started, not just the number. A pid alone can only be
       re-checked as "is it in use"; with the start time a later scan can tell
       this process from whatever inherited the number. Only the pids this scan
       managed to date are recorded — a gap here weakens the later check, and
       must never strengthen it into an ending. */
    const datedProcesses = new Map(
      trace.processes.flatMap(({ pid, startSeconds }) =>
        startSeconds === undefined ? [] : [[pid, startSeconds] as const]),
    );
    const processStarts: Record<string, number> = {};
    for (const pid of processIds) {
      const startSeconds = datedProcesses.get(pid);
      if (startSeconds !== undefined) processStarts[String(pid)] = startSeconds;
    }
    confirmed.set(identity, {
      sessionId,
      surface,
      provider,
      processIds,
      ...(Object.keys(processStarts).length > 0 ? { processStarts } : {}),
    });
  }
  const updates: IdentityBinding[] = [];
  for (const [identity, { sessionId, surface, provider, processIds, processStarts }] of confirmed) {
    if (contested.has(identity)) continue;
    const observed: IdentityBindingTarget = {
      surfaceId: surface.surfaceId,
      workspaceId: surface.workspaceId,
      paneId: surface.paneId,
    };
    const existing = bindingForProvider(store, provider, sessionId);
    let next: IdentityBinding;
    if (!existing) {
      next = {
        sessionId,
        provider,
        target: observed,
        firstConfirmedAt: nowIso,
        confirmedAt: nowIso,
        processIds,
        processStarts,
      };
    } else if (existing.target.surfaceId === observed.surfaceId) {
      next = {
        ...existing,
        provider,
        target: observed,
        confirmedAt: nowIso,
        processIds,
        /* Written unconditionally alongside `processIds`. Letting the spread
           carry an older map forward would pair this scan's pids with a
           previous scan's start times — a check that looks like proof and is
           not. */
        processStarts,
        pendingReassignment: undefined,
      };
    } else {
      const pending = existing.pendingReassignment?.target.surfaceId === observed.surfaceId
        ? existing.pendingReassignment
        : undefined;
      const scansAgreed = pending ? pending.scansAgreed + 1 : 1;
      next = scansAgreed >= REASSIGNMENT_CONFIRMATION_SCANS
        ? {
            sessionId,
            provider,
            target: observed,
            firstConfirmedAt: nowIso,
            confirmedAt: nowIso,
            processIds,
            processStarts,
          }
        : {
            ...existing,
            pendingReassignment: {
              target: observed,
              scansAgreed,
              firstSeenAt: pending ? pending.firstSeenAt : nowIso,
            },
          };
    }
    updates.push(next);
  }
  try {
    await store.putMany(updates);
  } catch (error) {
    errors.push(
      `identity binding batch write failed for ${updates.length} sessions: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { errors };
}

/**
 * Bridge lsof race gaps: when a scan produced no live evidence for a known
 * session, its persisted binding becomes the agent's recordedTarget so
 * targets.ts tier 1 keeps resolution exact. Bindings only fill evidence gaps —
 * live evidence (including a conflict, which tier 1 quarantines fail-closed)
 * always outranks them.
 */
export function bridgeAgentsWithBindings(
  store: IdentityBindingStore,
  agents: readonly CollectedAgent[],
  surfaces: readonly CmuxSurface[],
  liveAgentProcessIds?: readonly number[],
  recognizedAgentProcessIds?: readonly number[],
  /** Start time by PID from THIS scan, to check stored ones against. */
  processStartsByPid?: ReadonlyMap<number, number>,
): CollectedAgent[] {
  const surfacesById = new Map(surfaces.map((surface) => [surface.surfaceId, surface]));
  const providersBySession = indexSessionIdentityProviders(agents);
  return agents.map((agent) => {
    const sessionId = agent.sourceSessionId.toLowerCase();
    const binding = bindingForProvider(store, agent.provider, sessionId);
    if (!binding) return agent;
    if (!binding.provider && sourceSessionHasProviderCollision(sessionId, providersBySession)) return agent;
    const bound = surfacesById.get(binding.target.surfaceId);
    const processIds = binding.processIds;
    const trace = bound?.identityTrace;
    const trustworthyProcessScan = Boolean(
      trace && trace.outcome !== "probe-failed" && trace.outcome !== "no-tty" && trace.outcome !== "stale-surface",
    );
    /* A binding's pids were real when the scan confirmed them, and the kernel
       recycles numbers — so "still in use" is not the same question as "still
       ours". Measured 2026-08-05, treating them as the same put two dead
       sessions on the board as live, one for 33 hours, on pids since taken by
       `siriknowledged` and `sysextd`. process-liveness.ts owns the distinction;
       this only assembles the roster it needs.

       Two rosters, because callers reach this with different evidence. A scan
       that published a live pid set answers from that; otherwise the bound
       surface's own process list stands in, where every listed process counts
       as an agent so behaviour for those callers is unchanged, and
       `trustworthyProcessScan` decides whether absence means anything at all. */
    /* The stored start time is the whole point: with it, a pid the scan finds
       at a DIFFERENT start is proven to be someone else's, and the session
       retires on evidence instead of on a command-name guess. Bindings written
       before that field existed carry no start, and fall back to the weaker
       check rather than to an ending. */
    const handles = (processIds ?? []).map((pid) => ({
      pid,
      startSeconds: binding.processStarts?.[String(pid)],
    }));
    const roster: ProcessRoster = liveAgentProcessIds
      ? {
          complete: true,
          livePids: new Set(liveAgentProcessIds),
          ...(processStartsByPid ? { startsByPid: processStartsByPid } : {}),
          agentPids: new Set(recognizedAgentProcessIds ?? liveAgentProcessIds),
        }
      : {
          complete: trustworthyProcessScan,
          livePids: new Set((trace?.processes ?? []).map(({ pid }) => pid)),
          agentPids: new Set((trace?.processes ?? []).map(({ pid }) => pid)),
        };
    const processAlive = handles.length
      ? processAliveFrom(livenessOfAny(handles, roster))
      : undefined;
    const transcriptOpen = processIds?.length && trace
      ? trace.openFileMatches.some(({ pid }) => processIds.includes(pid))
      : undefined;
    /* NO-ERASE. The bridge exists to FILL gaps in process evidence, and it used
       to overwrite unconditionally — so a binding with nothing to say replaced a
       proven `processAlive: true` with `undefined`, erasing the one fact that
       separates a live session from an unverifiable one.

       That was survivable while unavailable evidence and death produced the same
       verdict. It is not now: erasing a positive answer moves a session out of
       Waiting and into Unverified, which is the board forgetting something it
       had already established. A defined answer on the agent wins; the bridge
       only speaks where the agent is silent. */
    const withProcessEvidence: CollectedAgent = {
      ...agent,
      processIds: processIds ?? agent.processIds,
      /* NO-RESURRECT, the mirror of the rule above. The bridge may fill a gap,
         but a stored pid still being in use cannot overturn a `false` that
         start-time verification already reached — that answer was made with
         strictly more evidence than a presence test has. */
      processAlive: agent.processAlive === false ? false : processAlive ?? agent.processAlive,
      transcriptOpen: transcriptOpen ?? agent.transcriptOpen,
    };
    if (agent.recordedTarget) return withProcessEvidence;
    /* Fresh or mid-band only, which is the same pool targets.ts admits to cwd
       fallback and for the same reason: bridging a session quiet enough to be
       unverified would hand a pane to a session nothing can vouch for. This runs
       on collected agents, before any verdict exists, so it reads the parse-time
       status — where "running or waiting" IS the fresh-or-mid band. */
    if (agent.status !== "running" && agent.status !== "waiting") return withProcessEvidence;
    if (surfaces.some((surface) => surfaceClaimsSourceSession(surface, agent, providersBySession))) {
      return withProcessEvidence;
    }
    // The bound surface carrying exact evidence for a DIFFERENT session is a
    // contradiction, not a gap — never bridge over it. A conflicted surface
    // still gets the bridge so tier 1 quarantines it visibly.
    if (bound && !bound.identityConflict && bound.sourceSessionIds.length > 0) return withProcessEvidence;
    return {
      ...withProcessEvidence,
      recordedTarget: {
        ...binding.target,
        reason: BINDING_BRIDGE_REASON,
        source: "binding",
        confirmedAt: binding.confirmedAt,
      },
    };
  });
}
