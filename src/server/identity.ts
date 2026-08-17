import type {
  Provider,
  SessionIdentityClaim,
  SurfaceCommandHintEvidence,
  SurfaceIdentityTrace,
  SurfaceOpenFileEvidence,
  SurfaceProcessEvidence,
} from "../shared/types";
import { PROVIDERS } from "../shared/types";
import { cmuxCommand, runtimeCmuxExecutable } from "./cmux";
import type { CmuxSurface, CollectedAgent, CollectionResult, CommandRunner } from "./types";
import { livenessOfAny, processAliveFrom } from "./process-liveness";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/* The process name each provider runs under, spelled out as a total map so the
   build fails when a Provider is added without saying what to look for.

   This list going stale is worse than the collector list that went stale in
   `state.ts`, because it fails in the opposite direction — silently, and toward
   a confident wrong answer. A provider missing here gets NO process evidence,
   and `processEvidenceOf` reads "the roster scan completed and nothing claims
   this session" as `absent`, which the classifier treats as proof the session
   ended. Factory shipped in exactly that state: three live-capable sessions
   classified `finished / process-absent` because nothing here could see droid. */
const PROVIDER_BINARIES: Record<Provider, string> = {
  omp: "omp",
  codex: "codex",
  claude: "claude",
  cursor: "cursor-agent",
  factory: "droid",
  prime: "prime-agent",
  grok: "grok",
  hermes: "hermes",
  muse: "muse",
  antigravity: "agy",
  copilot: "copilot",
};
const AGENT_BINARIES = Object.values(PROVIDER_BINARIES).join("|");
const RESUME_PROVIDERS = PROVIDERS.join("|");
/* Cursor's current launcher runs a generic `agent` executable with the
   versioned Cursor Agent entrypoint as an argument. Recognize only that pair:
   it admits the pid to open-file inspection but does not itself claim a
   session identity. The store/transcript path still has to prove that. */
const CURSOR_VERSIONED_WRAPPER = new RegExp(
  "(?:^|\\s)(?:\\S*\\/)?agent(?:\\s|$)[^\\n]{0,320}?(?:^|\\s)\\S*\\/\\.local\\/share\\/cursor-agent\\/versions\\/[^\\/\\s]+\\/index\\.js(?:\\s|$)",
  "i",
);
/* Two attempts on a short deadline rather than one long one. The probe is
   almost the entire identity system on a fleet whose surfaces report no tty, so
   a single transient failure costs every write control until the next scan. */
const ATTRIBUTION_ATTEMPTS = 2;
const ATTRIBUTION_TIMEOUT_MS = 4_000;
/* Hand probes for all three calls total about 1.4s. A single call at or above
   this threshold has spent at least 20% of the enclosing 10s control deadline
   by itself, while a healthy pass stays below the logging floor. */
const IDENTITY_PROBE_OVERRUN_MS = 2_000;

const CMUX_PROCESS_ATTRIBUTION_PARAMS = JSON.stringify({
  all_windows: true,
  include_processes: true,
});

interface ProcessRow {
  pid: number;
  tty?: string;
  command: string;
  /** When this process started. Absent when the table carried no `lstart`. */
  startSeconds?: number;
}

interface IdentityHint {
  provider: Provider;
  value: string;
  full: boolean;
}

/* `lstart` in the C locale, e.g. "Wed Aug  5 16:36:08 2026". Anchored at the
   start of what follows the tty so a command can never be mistaken for a date
   unless it opens with one verbatim. */
const LSTART_PREFIX = /^([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/;

/* Tolerant of a table with or without `lstart`, on purpose. The scan asks for
   it now — a start time is the only thing that can prove a pid still refers to
   the process we attributed rather than to whatever inherited the number — but
   fixtures written against the older three-column output must keep parsing, and
   a locale that renders dates differently has to degrade to "no start time"
   rather than silently slicing the date onto the front of the command. */
export function parseProcessTable(output: string): ProcessRow[] {
  return output.split("\n").flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\S+)\s+(.+)$/);
    if (!match) return [];
    const tty = match[2] === "??" || match[2] === "?"
      ? undefined
      : match[2].replace(/^\/dev\//, "");
    const pid = Number(match[1]);
    const started = match[3].match(LSTART_PREFIX);
    if (started) {
      const startedAtMs = Date.parse(started[1]);
      if (Number.isFinite(startedAtMs)) {
        return [{
          pid,
          tty,
          command: started[2],
          startSeconds: Math.floor(startedAtMs / 1_000),
        }];
      }
    }
    return [{ pid, tty, command: match[3] }];
  });
}

export function identityFromSessionPath(path: string): IdentityHint | null {
  const cursorChat = path.match(
    new RegExp(`\\/.cursor\\/chats\\/[0-9a-f]{32}\\/(${UUID})\\/store\\.db(?:-wal|-shm)?$`, "i"),
  );
  if (cursorChat) return { provider: "cursor", value: cursorChat[1].toLowerCase(), full: true };
  const cursorTranscript = path.match(
    new RegExp(`\\/.cursor\\/projects\\/.+?\\/agent-transcripts\\/(${UUID})\\/(${UUID})\\.jsonl$`, "i"),
  );
  if (cursorTranscript && cursorTranscript[1].toLowerCase() === cursorTranscript[2].toLowerCase()) {
    return { provider: "cursor", value: cursorTranscript[1].toLowerCase(), full: true };
  }
  const museChild = path.match(
    new RegExp(`\\/muse\\/sessions\\/\\d{4}\\/\\d{2}\\/\\d{2}\\/(${UUID})\\/subagent\\/(${UUID})\\/session\\.jsonl$`, "i"),
  );
  if (museChild) {
    return {
      provider: "muse",
      value: `${museChild[1].toLowerCase()}/${museChild[2].toLowerCase()}`,
      full: true,
    };
  }
  const antigravityTranscript = path.match(
    new RegExp(`\\/antigravity(?:-cli|-ide)?\\/brain\\/(${UUID})\\/`, "i"),
  );
  if (antigravityTranscript) {
    return { provider: "antigravity", value: antigravityTranscript[1].toLowerCase(), full: true };
  }
  const patterns: [Provider, RegExp][] = [
    ["omp", new RegExp(`\\/.omp\\/agent\\/sessions\\/.+?(?:_|\\/)(${UUID})\\.jsonl$`, "i")],
    ["codex", new RegExp(`\\/.codex\\/sessions\\/.+?rollout-.+?-(${UUID})\\.jsonl$`, "i")],
    ["claude", new RegExp(`\\/.claude\\/projects\\/.+?\\/(${UUID})\\.jsonl$`, "i")],
    /* Factory splits a session across <uuid>.jsonl and <uuid>.settings.json;
       only the transcript is held open, and the `$` anchor keeps the settings
       sibling from matching as a second identity for the same session. */
    ["factory", new RegExp(`\\/.factory\\/sessions\\/.+?\\/(${UUID})\\.jsonl$`, "i")],
    ["prime", new RegExp(`\\/.prime\\/agent\\/sessions\\/(${UUID})\\.jsonl$`, "i")],
    ["grok", new RegExp(`\\/.grok\\/sessions\\/.+\\/(${UUID})\\/(?:events\\.jsonl|updates\\.jsonl|summary\\.json)$`, "i")],
    ["hermes", new RegExp(`\\/.hermes\\/sessions\\/([^/]+)\\.jsonl$`, "i")],
    ["muse", new RegExp(`\\/muse\\/sessions\\/\\d{4}\\/\\d{2}\\/\\d{2}\\/(${UUID})\\/session\\.jsonl$`, "i")],
    ["copilot", new RegExp(`\\/session-state\\/(${UUID})\\/events\\.jsonl$`, "i")],
    ["antigravity", new RegExp(`\\/antigravity(?:-cli|-ide)?\\/conversations\\/(${UUID})\\.db(?:-wal|-shm)?$`, "i")],
  ];
  for (const [provider, pattern] of patterns) {
    const match = path.match(pattern);
    if (match) return { provider, value: match[1].toLowerCase(), full: true };
  }
  return null;
}

export function identitiesFromCommand(command: string): IdentityHint[] {
  const hints: IdentityHint[] = [];
  const exactPatterns: [Provider, RegExp][] = [
    ["codex", new RegExp(`(?:^|[\\s/])codex\\s+resume\\s+(${UUID})(?:\\s|$)`, "i")],
    ["omp", new RegExp(`(?:^|[\\s/])omp\\b[^\\n]{0,160}?\\s(?:-r|--resume)\\s+(${UUID})(?:\\s|$)`, "i")],
    ["claude", new RegExp(`(?:^|[\\s/])claude\\b[^\\n]{0,160}?\\s(?:-r|--resume|--session-id)\\s+(${UUID})(?:\\s|$)`, "i")],
    ["cursor", new RegExp(`(?:^|[\\s/])cursor-agent\\b[^\\n]{0,160}?\\s--resume\\s+(${UUID})(?:\\s|$)`, "i")],
    /* `--fork` resumes into a NEW session id, so it is a hint about the id that
       follows it, exactly like the other two. */
    ["factory", new RegExp(`(?:^|[\\s/])droid\\b[^\\n]{0,160}?\\s(?:-r|--resume|--fork)\\s+(${UUID})(?:\\s|$)`, "i")],
    ["prime", new RegExp(`(?:^|[\\s/])prime-agent\\b[^\\n]{0,160}?\\s--resume\\s+(${UUID})(?:\\s|$)`, "i")],
    ["grok", new RegExp(`(?:^|[\\s/])grok\\b[^\\n]{0,160}?\\s(?:-r|--resume)(?:\\s+|=)(${UUID})(?:\\s|$)`, "i")],
    /* Session resume is `--resume` / `-r`, not the `resume` subcommand
       (that lifts `hermes pause`). Ids are filename stems, not always UUIDs. */
    ["hermes", new RegExp(`(?:^|[\\s/])hermes\\b[^\\n]{0,160}?\\s(?:-r|--resume)\\s+(\\S+)(?:\\s|$)`, "i")],
    ["muse", new RegExp(`(?:^|[\\s/])muse(?:-bin-[^\\s/]+)?\\b[^\\n]{0,160}?\\sresume\\s+(${UUID})(?:\\s|$)`, "i")],
    ["copilot", new RegExp(`(?:^|[\\s/])copilot\\b[^\\n]{0,160}?\\s(?:-r|--resume|--session-id)(?:\\s+|=)(${UUID})(?:\\s|$)`, "i")],
    ["antigravity", new RegExp(`(?:^|[\\s/])agy\\b[^\\n]{0,160}?\\s(?:--conversation|-c)(?:\\s+|=)(${UUID})(?:\\s|$)`, "i")],
  ];
  for (const [provider, pattern] of exactPatterns) {
    const match = command.match(pattern);
    if (match) hints.push({ provider, value: match[1].toLowerCase(), full: true });
  }
  const resume = command.match(
    new RegExp(`\\/cmux-agent-resume\\/(${RESUME_PROVIDERS})-([0-9a-f-]{8,36})(?:\\.zsh)?(?:\\s|$)`, "i"),
  );
  if (resume) {
    const value = resume[2].toLowerCase();
    hints.push({ provider: resume[1].toLowerCase() as Provider, value, full: new RegExp(`^${UUID}$`, "i").test(value) });
  }
  return hints;
}

/* A process that serves many sessions at once and outlives every one of them.
   `app-server` is a subcommand meaning exactly that: I am a shared server, not
   a conversation. Its open transcripts are proof the APP is up, never that a
   particular session is — measured 2026-08-05, one app-server held 11 rollout
   files open whose last writes were 6 to 10 hours old, and all 11 rows read
   "waiting · process live" off it.

   Keyed on the subcommand rather than the binary path on purpose: this board
   has already been burned once by name matching, when `codex` -> `codex-next`
   turned a running fleet into a wave of false "died" verdicts. A miss here is
   safe in a way that one was not — failing to recognise a multiplexer only
   restores the old over-reporting, and the caller downgrades liveness to
   unknown rather than asserting death. */
export function isSharedAgentService(command: string): boolean {
  return /(?:^|\s)app-server(?:\s|$)/i.test(command);
}

const MUSE_VERSIONED_BINARY = /(?:^|\s)(?:\S*\/)?muse-bin-\S+(?:\s|$)/i;

export function isRecognizedAgentProcess(command: string): boolean {
  return new RegExp(
    `(?:^|\\s)(?:\\S*\\/)?(?:${AGENT_BINARIES})(?:\\.(?:js|mjs|cjs))?(?:\\s|$)`,
    "i",
  ).test(command) ||
    CURSOR_VERSIONED_WRAPPER.test(command) ||
    MUSE_VERSIONED_BINARY.test(command) ||
    new RegExp(
      `\\/cmux-agent-resume\\/(?:${RESUME_PROVIDERS})-[0-9a-f-]{8,36}(?:\\.zsh)?(?:\\s|$)`,
      "i",
    ).test(command);
}

function parseOpenFiles(output: string): Map<number, string[]> {
  const files = new Map<number, string[]>();
  let pid: number | undefined;
  for (const line of output.split("\n")) {
    if (line.startsWith("p") && /^p\d+$/.test(line)) {
      pid = Number(line.slice(1));
      files.set(pid, files.get(pid) ?? []);
    } else if (pid !== undefined && line.startsWith("n")) {
      files.get(pid)?.push(line.slice(1));
    }
  }
  return files;
}

function parseCmuxProcessAttribution(output: string): Map<string, Set<number>> {
  const attributed = new Map<string, Set<number>>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const row = value as Record<string, unknown>;
    if (
      row.kind === "process" &&
      typeof row.cmux_surface_id === "string" &&
      Number.isInteger(row.pid)
    ) {
      const pids = attributed.get(row.cmux_surface_id) ?? new Set<number>();
      pids.add(row.pid as number);
      attributed.set(row.cmux_surface_id, pids);
    }
    for (const child of Object.values(row)) visit(child);
  };
  visit(JSON.parse(output));
  return attributed;
}

function uniqueIdentity(hints: readonly IdentityHint[]): IdentityHint | undefined {
  const identities = new Map(hints.map((hint) => [identityKey(hint), hint]));
  return identities.size === 1 ? [...identities.values()][0] : undefined;
}

function sessionClaim(hint: IdentityHint): SessionIdentityClaim {
  return { provider: hint.provider, sessionId: hint.value };
}

function identityKey(hint: IdentityHint): string {
  return `${hint.provider}:${hint.value.toLowerCase()}`;
}

function hasOpenAncestor(
  hint: IdentityHint,
  openKeys: ReadonlySet<string>,
  agentsByIdentity: ReadonlyMap<string, CollectedAgent>,
): boolean {
  let current = agentsByIdentity.get(identityKey(hint));
  const visited = new Set<string>();
  while (current?.parentSourceSessionId) {
    const parentKey = `${current.provider}:${current.parentSourceSessionId.toLowerCase()}`;
    if (openKeys.has(parentKey)) return true;
    if (visited.has(parentKey)) return false;
    visited.add(parentKey);
    current = agentsByIdentity.get(parentKey);
  }
  return false;
}

function primaryOpenIdentity(
  hints: readonly IdentityHint[],
  agentsByIdentity: ReadonlyMap<string, CollectedAgent>,
): IdentityHint | undefined {
  const uniqueHints = [...new Map(hints.map((hint) => [identityKey(hint), hint])).values()];
  const openKeys = new Set(uniqueHints.map(identityKey));
  const roots = uniqueHints.filter(
    (hint) => !hasOpenAncestor(hint, openKeys, agentsByIdentity),
  );
  return roots.length === 1 ? roots[0] : undefined;
}

interface CommandHintResolution {
  hint?: IdentityHint;
  rejectionReason?: string;
}

export interface IdentityCollectionResult extends CollectionResult<CmuxSurface[]> {
  /** Every PID a completed process scan saw in use, agent or not. */
  liveAgentProcessIds?: number[];
  /** The subset of the above running something that looks like an agent. */
  recognizedAgentProcessIds?: number[];
  /**
   * Start time by PID, for the rows the table dated. Partial by nature, and
   * only ever used to CHECK a pid already known to be in use — presence stays
   * `liveAgentProcessIds`'s job.
   */
  processStarts?: Record<number, number>;
  /**
   * Every attribution path this scan uses ran to completion, so "no process
   * claims this session" is an observation rather than a gap.
   *
   * Deliberately stricter than "the process table was readable". Attribution
   * runs off BOTH `ps` and the open-file lookup, and a session whose only
   * evidence is an open transcript fd is invisible when the second one fails.
   * Setting this on a partial scan would turn those sessions into endings, so
   * it is set on the one path where nothing was skipped.
   */
  rosterComplete?: boolean;
}

function resolveCommandHint(
  hint: IdentityHint,
  agents: readonly CollectedAgent[],
): CommandHintResolution {
  const matches = agents.filter((agent) => {
    if (agent.provider !== hint.provider) return false;
    const sourceId = agent.sourceSessionId.toLowerCase();
    const runtimeId = agent.runtimeSessionId?.toLowerCase();
    return hint.full
      ? sourceId === hint.value || runtimeId === hint.value
      : sourceId.startsWith(hint.value) || runtimeId?.startsWith(hint.value);
  });
  /* A resumed Claude transcript keeps the original runtime session ID while
     receiving a new source file ID. When the command names that original ID,
     the exact source match is the canonical identity; treating its resumed
     alias as a second owner creates a permanent false conflict on every scan. */
  const exactSource = matches.find((agent) => agent.sourceSessionId.toLowerCase() === hint.value);
  if (exactSource) {
    return {
      hint: {
        provider: hint.provider,
        value: exactSource.sourceSessionId.toLowerCase(),
        full: true,
      },
    };
  }
  const active = matches.filter((agent) => agent.status === "running" || agent.status === "waiting");
  const candidates = active.length > 0 ? active : matches;
  if (candidates.length === 0) {
    return { hint: hint.full ? hint : undefined };
  }
  if (candidates.length > 1) {
    const label = hint.provider === "claude" ? "Claude" : hint.provider;
    return {
      rejectionReason: `multiple active ${label} sources (${candidates.length}) claim runtime session ${hint.value}`,
    };
  }
  return {
    hint: {
      provider: hint.provider,
      value: candidates[0].sourceSessionId.toLowerCase(),
      full: true,
    },
  };
}

function baseTrace(
  surface: CmuxSurface,
  outcome: SurfaceIdentityTrace["outcome"],
  notes?: string[],
): SurfaceIdentityTrace {
  return {
    surfaceId: surface.surfaceId,
    tty: surface.tty?.replace(/^\/dev\//, ""),
    processes: [],
    openFileMatches: [],
    commandHints: [],
    outcome,
    sourceSessionIds: [...surface.sourceSessionIds],
    identityConflict: surface.identityConflict,
    notes,
  };
}

function failedProbeSurfaces(surfaces: readonly CmuxSurface[], error: string): CmuxSurface[] {
  return surfaces.map((surface) => ({
    ...surface,
    sourceSessionClaims: [],
    sourceSessionIds: [],
    identityConflict: error,
    identityTrace: {
      ...baseTrace(surface, "probe-failed", [error]),
      sourceSessionIds: [],
      identityConflict: error,
    },
  }));
}

export async function enrichCmuxIdentity(
  surfaces: readonly CmuxSurface[],
  agents: readonly CollectedAgent[],
  runner: CommandRunner,
  /* This probe is where a superseded pass costs the most: three sequential
     subprocesses, one of which enumerates open files across every agent
     process. A pass the watchdog gave up on must stop spending them, not just
     stop being waited on. */
  signal?: AbortSignal,
): Promise<IdentityCollectionResult> {
  const probeStartedMs = Date.now();
  const probeTimings: Array<{ label: string; elapsedMs: number; input: string }> = [];
  const reportProbeOverrun = (): void => {
    if (!probeTimings.some(({ elapsedMs }) => elapsedMs >= IDENTITY_PROBE_OVERRUN_MS)) return;
    const breakdown = probeTimings
      .map(({ label, elapsedMs, input }) => `${label}=${elapsedMs}ms(${input})`)
      .join(" ");
    console.error(`[identity] probe timings: total=${Date.now() - probeStartedMs}ms ${breakdown}`);
  };
  const errors: string[] = [];
  const readySurfaces = surfaces.filter((surface) => surface.runtimeSurfaceReady !== false);
  const ttyNames = new Set(
    readySurfaces
      .map((surface) => surface.tty)
      .filter((tty): tty is string => Boolean(tty)),
  );
  if (readySurfaces.length === 0) {
    // No runtime-ready surfaces to probe — but stale surfaces still need their
    // bindings cleared, not left intact. Skipping the map here left a lone stale
    // surface holding its old sourceSessionIds and reading as a phantom identity.
    return {
      value: surfaces.map((surface) =>
        surface.runtimeSurfaceReady === false
          ? {
              ...surface,
              sourceSessionClaims: [],
              sourceSessionIds: [],
              identityConflict: undefined,
              identityTrace: { ...baseTrace(surface, "stale-surface"), sourceSessionIds: [], identityConflict: undefined },
            }
          : { ...surface, identityTrace: baseTrace(surface, "no-tty") },
      ),
      errors,
    };
  }

  let attributedPids = new Map<string, Set<number>>();
  let attributionError: string | undefined;
  if (readySurfaces.some((surface) => !surface.tty)) {
    /* This probe carries almost the whole identity system. Measured on this
       fleet: 18 of 19 surfaces report no tty, and every one of the 10 surfaces
       cmux names a session on is attributed here rather than by tty. So a
       transient failure does not degrade identity gracefully — it removes the
       only evidence the write gate has, and after today's fixes that means Send
       and Interrupt switch OFF fleet-wide rather than misroute.

       That is the safe direction and it stays. What it must not be is
       inexplicable: an operator watching the controls vanish deserves to know a
       probe failed rather than that a policy changed. So the probe retries
       once, on a shorter deadline, and whatever it ends up reporting names
       itself as a probe failure and says what it cost.

       Shorter deadline WITH a retry, not instead of one: two 4s attempts fail
       faster than one 10s attempt, so a wedged cmux costs less than it did
       while a merely slow one now gets a second chance it never had. */
    const attributionStartedMs = Date.now();
    const attempts: string[] = [];
    let attributionAttemptCount = 0;
    for (let attempt = 1; attempt <= ATTRIBUTION_ATTEMPTS; attempt += 1) {
      attributionAttemptCount += 1;
      const attributionResult = await runner.run(
        cmuxCommand(runtimeCmuxExecutable(), ["rpc", "system.top", CMUX_PROCESS_ATTRIBUTION_PARAMS]),
        ATTRIBUTION_TIMEOUT_MS,
        signal,
      );
      /* A cancelled attempt must not burn the retry. The retry exists for a
         transient cmux failure; supersession is not one, and spending it here
         would leave the next real failure with no second chance. */
      if (attributionResult.cancelled) break;
      if (attributionResult.timedOut) {
        attempts.push(`timed out after ${ATTRIBUTION_TIMEOUT_MS}ms`);
      } else if (attributionResult.exitCode !== 0) {
        attempts.push(`exited ${attributionResult.exitCode}: ${attributionResult.stderr.trim() || "no stderr"}`);
      } else {
        try {
          attributedPids = parseCmuxProcessAttribution(attributionResult.stdout);
          attempts.length = 0;
          break;
        } catch (error) {
          attempts.push(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    probeTimings.push({
      label: "cmux_system_top",
      elapsedMs: Date.now() - attributionStartedMs,
      input: `attempts=${attributionAttemptCount},surfaces=${readySurfaces.length}`,
    });
    if (attempts.length > 0) {
      /* Named as what it is. "cmux process attribution" alone read as a
         configuration problem; this says a probe failed, how many times, and
         what the operator loses by it — which is the difference between a
         control that looks broken and one an operator can wait out. */
      attributionError = `cmux process attribution probe failed ${attempts.length}`
        + `${attempts.length === 1 ? " time" : " times"} (${attempts.join("; ")}).`
        + " Session identity for panes without a tty is unavailable this scan,"
        + " so Focus, Send and Interrupt stay off until it answers.";
      errors.push(attributionError);
      console.error(`[identity] ${attributionError}`);
    }
  }

  const readySurfaceIds = new Set(readySurfaces.map(({ surfaceId }) => surfaceId));
  const allAttributedPids = new Set(
    [...attributedPids].flatMap(([surfaceId, pids]) => readySurfaceIds.has(surfaceId) ? [...pids] : []),
  );
  if (ttyNames.size === 0 && allAttributedPids.size === 0) {
    reportProbeOverrun();
    return {
      value: surfaces.map((surface) =>
        surface.runtimeSurfaceReady === false
          ? {
              ...surface,
              sourceSessionClaims: [],
              sourceSessionIds: [],
              identityConflict: undefined,
              identityTrace: { ...baseTrace(surface, "stale-surface"), sourceSessionIds: [], identityConflict: undefined },
            }
          : { ...surface, identityTrace: baseTrace(surface, "no-tty", attributionError ? [attributionError] : undefined) },
      ),
      errors,
    };
  }

  /* `lstart` so pids carry provenance, and `LC_ALL=C` so its rendering is the
     one `parseProcessTable` is written against rather than the operator's
     locale. Still one `ps`, not two: adding a call would shift every positional
     expectation in the test runners that feed this function. */
  const processStartedMs = Date.now();
  const processResult = await runner.run(
    ["env", "LC_ALL=C", "ps", "-axo", "pid=,tty=,lstart=,command="],
    8_000,
    signal,
  );
  const processElapsedMs = Date.now() - processStartedMs;
  /* Cancellation is not a fault and must not be published as one. A superseded
     pass reports nothing: its replacement is already collecting, and telling
     the operator "process identity lookup exited -1" would name a broken
     subsystem when nothing broke. Returned WITHOUT `failedProbeSurfaces`, which
     quarantines every target and switches the write controls off. */
  if (processResult.cancelled) return { value: [...surfaces], errors: [] };
  if (processResult.timedOut || processResult.exitCode !== 0) {
    const error = processResult.timedOut
      ? "process identity lookup timed out"
      : `process identity lookup exited ${processResult.exitCode}: ${processResult.stderr.trim() || "no stderr"}`;
    probeTimings.push({ label: "process_table", elapsedMs: processElapsedMs, input: "rows=unavailable" });
    errors.push(error);
    console.error(`[identity] ${error}`);
    reportProbeOverrun();
    return {
      value: failedProbeSurfaces(surfaces, error),
      errors,
    };
  }
  const allProcesses = parseProcessTable(processResult.stdout);
  probeTimings.push({
    label: "process_table",
    elapsedMs: processElapsedMs,
    input: `rows=${allProcesses.length}`,
  });
  /* Liveness, so every pid in the table counts — recognition is a question
     about ATTRIBUTION and answers a different one.

     This used to keep only isRecognizedAgentProcess commands, so a pid that was
     present and running but wearing an unfamiliar name scored as not alive, and
     snapshot-agent turns processAlive === false plus known pids into "died".
     A CLI rename was enough: `codex` read as running, `codex-next` at the same
     pid read as DIED, and the operator chased a phantom crash while the agent
     kept working unwatched. "Not alive" is a claim that needs the pid to be
     MISSING, not merely unfamiliar.

     Both consumers ask only "is this pid still running" — here, and the binding
     bridge in identity-bindings.ts — so neither loses attribution by this.
     (The name now understates the set; renaming it touches two more files and
     is left as a separate tidy.) */
  const liveAgentProcessIds = allProcesses.map(({ pid }) => pid);
  /* The narrower question the two stale-pid fallbacks actually need answered.
     `liveAgentProcessIds` says a number is in use; this says something wearing
     an agent's name is using it. Neither proves the process is the one we
     attributed — only a start time does that — but a stored pid now held by
     `siriknowledged` or `sysextd` is not evidence of an agent, and both of
     those were on the board as live sessions (one for 33 hours).

     Used ONLY to withhold a liveness upgrade, never to assert death, which is
     what keeps the `codex` -> `codex-next` regression above from recurring: an
     unrecognised name yields unknown, and a renamed binary that is actually
     working is carried by its transcript writes and by the hook store's
     start-time check, neither of which reads a command name. */
  /* Provenance for every row whose start time rendered. Deliberately separate
     from `liveAgentProcessIds`: that set answers presence and must stay
     complete, while this one may be partial and is only ever used to CHECK a
     pid we already know is in use. */
  const processStartsByPid = new Map(
    allProcesses.flatMap(({ pid, startSeconds }) =>
      startSeconds === undefined ? [] : [[pid, startSeconds] as const]),
  );
  const recognizedAgentProcessIds = allProcesses
    .filter((process) => isRecognizedAgentProcess(process.command))
    .map(({ pid }) => pid);
  const processes = allProcesses.filter(
    (process) => (process.tty !== undefined && ttyNames.has(process.tty)) || allAttributedPids.has(process.pid),
  );
  const processesByTty = new Map<string, ProcessRow[]>();
  for (const process of processes) {
    if (!process.tty) continue;
    const ttyProcesses = processesByTty.get(process.tty) ?? [];
    ttyProcesses.push(process);
    processesByTty.set(process.tty, ttyProcesses);
  }
  const agentsByIdentity = new Map(
    agents.map((agent) => [`${agent.provider}:${agent.sourceSessionId.toLowerCase()}`, agent]),
  );
  const resolvedCommandHints = new Map<string, CommandHintResolution>();
  const cachedCommandHint = (hint: IdentityHint): CommandHintResolution => {
    const key = `${identityKey(hint)}:${hint.full}`;
    if (!resolvedCommandHints.has(key)) {
      resolvedCommandHints.set(key, resolveCommandHint(hint, agents));
    }
    return resolvedCommandHints.get(key) ?? {};
  };
  const pids = [...new Set([...recognizedAgentProcessIds, ...processes.map(({ pid }) => pid)])];
  let openFiles = new Map<number, string[]>();
  if (pids.length > 0) {
    // Absolute path: Bun/server PATH can omit /usr/sbin, which made identity
    // enrichment fail-closed and left agents partially/quarantined.

    /* `-n` is why this probe stopped spending the board's whole deadline.
       Without it lsof reverse-DNSes the remote address of every socket it
       reports, and an agent process holds many sockets to API endpoints whose
       peers resolve slowly or not at all. Measured on this fleet 2026-08-13:
       the same call against one socket-heavy daemon took 20.066s without `-n`
       and 0.055s with it — 365x, at 0% CPU for those 20 seconds, because it was
       blocked on the resolver rather than working.

       It is pure waste here in both directions: this probe reads `-Fn` output
       for session FILE PATHS (`identityFromSessionPath`), so a hostname can
       never match, and resolving one costs a network round trip inside a
       10-second budget. `-P` skips the /etc/services port-name lookup for the
       same reason.

       Keep them. Identity gates Send and Interrupt fleet-wide, so when this
       probe runs long the board withdraws every terminal target and the
       operator's controls switch off. */
    const openFileStartedMs = Date.now();
    const openFileResult = await runner.run(["/usr/sbin/lsof", "-n", "-P", "-a", "-p", pids.join(","), "-Fn"], 10_000, signal);
    probeTimings.push({
      label: "lsof",
      elapsedMs: Date.now() - openFileStartedMs,
      input: `pids=${pids.length}`,
    });
    /* Same rule as the process table above: a superseded pass says nothing. */
    if (openFileResult.cancelled) return { value: [...surfaces], errors: [] };
    openFiles = parseOpenFiles(openFileResult.stdout);
    const hasUsableIdentityOutput = [...openFiles.values()]
      .flat()
      .some((path) => identityFromSessionPath(path) !== null);
    if (openFileResult.timedOut || (openFileResult.exitCode !== 0 && !hasUsableIdentityOutput)) {
      const error = openFileResult.timedOut
        ? "open-session identity lookup timed out"
        : `open-session identity lookup exited ${openFileResult.exitCode}: ${openFileResult.stderr.trim() || "no stderr"}`;
      errors.push(error);
      console.error(`[identity] ${error}`);
      reportProbeOverrun();
      return {
        value: failedProbeSurfaces(surfaces, error),
        errors,
        liveAgentProcessIds,
        recognizedAgentProcessIds,
        processStarts: Object.fromEntries(processStartsByPid),
      };
    }
  }

  const processIdsByAgent = new Map<string, Set<number>>();
  /* The subset of the above that actually proves THIS session is running. A
     shared service's descriptors land in `processIdsByAgent` (they are real
     attribution, and the inspector should still show which process serves the
     row) but never here. */
  const owningProcessIdsByAgent = new Map<string, Set<number>>();
  const transcriptOpenAgents = new Set<string>();
  const addProcessEvidence = (
    key: string,
    pid: number,
    { transcriptOpen = false, sessionOwned = true }: { transcriptOpen?: boolean; sessionOwned?: boolean } = {},
  ): void => {
    if (!agentsByIdentity.has(key)) return;
    const processIds = processIdsByAgent.get(key) ?? new Set<number>();
    processIds.add(pid);
    processIdsByAgent.set(key, processIds);
    if (sessionOwned) {
      const owned = owningProcessIdsByAgent.get(key) ?? new Set<number>();
      owned.add(pid);
      owningProcessIdsByAgent.set(key, owned);
    }
    if (transcriptOpen) transcriptOpenAgents.add(key);
  };
  const commandByPid = new Map(allProcesses.map((process) => [process.pid, process.command]));
  for (const [pid, paths] of openFiles) {
    /* EVERY session whose transcript this pid holds open, not the "primary"
       one.

       `primaryOpenIdentity` answers a different question — which session OWNS a
       terminal pane — and returns undefined when several could, which is
       correct for attributing a surface and wrong for liveness. An open file
       descriptor is not a claim about ownership; it is proof that this process
       is serving that session, and it is proof about each of them separately.
       One Codex process holds every conversation in the desktop app open at
       once: measured on this machine, 24 sessions had open transcripts and
       picking a primary credited liveness to 7 of them. The other 17 read as
       having no process at all. */
    /* ...unless the holder is a multiplexer, which never closes what it opens.
       Then the descriptor set only grows, and it says nothing about any one of
       the sessions in it. Still attributed, just not counted as life. */
    const sessionOwned = !isSharedAgentService(commandByPid.get(pid) ?? "");
    for (const path of paths) {
      const hint = identityFromSessionPath(path);
      if (hint) addProcessEvidence(identityKey(hint), pid, { transcriptOpen: true, sessionOwned });
    }
  }
  for (const process of allProcesses) {
    for (const hint of identitiesFromCommand(process.command)) {
      const resolved = cachedCommandHint(hint).hint;
      if (resolved) addProcessEvidence(identityKey(resolved), process.pid);
    }
  }
  const liveProcessIds = new Set(liveAgentProcessIds);
  const recognizedProcessIds = new Set(recognizedAgentProcessIds);
  for (const agent of agents) {
    const key = `${agent.provider}:${agent.sourceSessionId.toLowerCase()}`;
    const observed = processIdsByAgent.get(key);
    if (observed?.size) {
      agent.processIds = [...observed].sort((left, right) => left - right);
      /* Record WHEN each attributed pid started, so the next scan can tell this
         process from whatever inherits the number. Only pids the table dated
         appear; a pid missing here is unprovable, not dead. */
      const starts: Record<number, number> = {};
      for (const pid of agent.processIds) {
        const startSeconds = processStartsByPid.get(pid);
        if (startSeconds !== undefined) starts[pid] = startSeconds;
      }
      if (Object.keys(starts).length > 0) agent.processStarts = starts;
      /* Only a session-owned pid promotes to alive. When every attributed pid
         belongs to a shared service we leave whatever better-verified answer
         collectors already reached — normally undefined, which reads as
         unverified now and, once a complete roster confirms nothing claims the
         session, retires it in the quiet band. Writing `false` here instead
         would render as "process checked and gone" beside a pid that is
         demonstrably still running. */
      if (owningProcessIdsByAgent.get(key)?.size) agent.processAlive = true;
      agent.transcriptOpen = transcriptOpenAgents.has(key);
    } else if (agent.processIds?.length && agent.processAlive !== false) {
      /* Stale pids nothing better spoke for. The scan now carries start times,
         so a pid whose process started at a different moment than the one we
         recorded is PROVEN gone rather than merely unrecognised — but these
         retained pids arrive without the start they were observed at, so the
         proof only bites once a caller supplies one. Unknown must not erase a
         verified answer the collectors already reached, so only a definite
         verdict is written; and it must not overturn a `false`, which the guard
         above enforces. */
      const verdict = processAliveFrom(livenessOfAny(
        agent.processIds.map((pid) => ({ pid, startSeconds: agent.processStarts?.[pid] })),
        {
          complete: true,
          livePids: liveProcessIds,
          startsByPid: processStartsByPid,
          agentPids: recognizedProcessIds,
        },
      ));
      if (verdict !== undefined) agent.processAlive = verdict;
      agent.transcriptOpen = false;
    }
  }

  reportProbeOverrun();
  return {
    value: surfaces.map((surface) => {
      if (surface.runtimeSurfaceReady === false) {
        return {
          ...surface,
          sourceSessionClaims: [],
          sourceSessionIds: [],
          identityConflict: undefined,
          identityTrace: { ...baseTrace(surface, "stale-surface"), sourceSessionIds: [], identityConflict: undefined },
        };
      }
      const tty = surface.tty?.replace(/^\/dev\//, "");
      // Terminal discovery can omit the tty entirely; naming a location we never
      // learned rendered every conflict as "... on undefined" on the health card.
      const conflictLocation = tty ? ` on ${tty}` : "";
      const exactPids = attributedPids.get(surface.surfaceId);
      const surfaceProcesses = tty
        ? processesByTty.get(tty) ?? []
        : exactPids
          ? processes.filter((process) => exactPids.has(process.pid))
          : [];
      const attributionNotes = !tty && exactPids?.size
        ? ["Terminal discovery omitted tty; exact cmux process attribution supplied the surface process IDs."]
        : attributionError
          ? [attributionError]
          : undefined;
      if (!tty && surfaceProcesses.length === 0) {
        return { ...surface, identityTrace: baseTrace(surface, "no-tty", attributionNotes) };
      }
      const processEvidence: SurfaceProcessEvidence[] = surfaceProcesses.map((process) => ({
        pid: process.pid,
        command: process.command,
        recognizedAgentProcess: isRecognizedAgentProcess(process.command),
        // Carried so a binding confirmed from this surface can store the proof.
        ...(process.startSeconds !== undefined ? { startSeconds: process.startSeconds } : {}),
      }));
      const openFileMatches: SurfaceOpenFileEvidence[] = surfaceProcesses.flatMap((process) =>
        (openFiles.get(process.pid) ?? []).flatMap((path) => {
          const hint = identityFromSessionPath(path);
          return hint ? [{ pid: process.pid, path, provider: hint.provider, sessionId: hint.value }] : [];
        }),
      );
      const commandHintEvidence: SurfaceCommandHintEvidence[] = surfaceProcesses.flatMap((process) =>
        identitiesFromCommand(process.command).map((hint) => {
          const resolved = cachedCommandHint(hint);
          return {
            pid: process.pid,
            provider: hint.provider,
            value: hint.value,
            full: hint.full,
            resolvedSessionId: resolved.hint?.value,
            rejectionReason: resolved.rejectionReason,
          };
        }),
      );
      const trace = (
        outcome: SurfaceIdentityTrace["outcome"],
        sourceSessionIds: string[],
        identityConflict?: string,
        notes?: string[],
      ): SurfaceIdentityTrace => ({
        surfaceId: surface.surfaceId,
        tty,
        processes: processEvidence,
        openFileMatches,
        commandHints: commandHintEvidence,
        outcome,
        sourceSessionIds,
        identityConflict,
        notes,
      });
      const openHints: IdentityHint[] = openFileMatches.map((match) => ({
        provider: match.provider,
        value: match.sessionId,
        full: true,
      }));
      const openIdentity = primaryOpenIdentity(openHints, agentsByIdentity);
      const sharedGrokHost = openHints.length > 0
        && !openIdentity
        && openHints.every(({ provider }) => provider === "grok")
        && new Set(openFileMatches.map(({ pid }) => pid)).size === 1;
      if (sharedGrokHost) {
        return {
          ...surface,
          sourceSessionClaims: [],
          sourceSessionIds: [],
          identityConflict: undefined,
          identityTrace: trace("shared-host", [], undefined, attributionNotes),
        };
      }
      if (openHints.length > 0 && !openIdentity) {
        const identityConflict = `cmux ${surface.surfaceId} has conflicting open agent session files${conflictLocation}`;
        errors.push(identityConflict);
        return {
          ...surface,
          sourceSessionClaims: [],
          sourceSessionIds: [],
          identityConflict,
          identityTrace: trace("open-file-conflict", [], identityConflict, attributionNotes),
        };
      }
      if (openIdentity) {
        const distinctIdentities = new Set(openHints.map((hint) => `${hint.provider}:${hint.value}`)).size;
        const notes = [
          ...(attributionNotes ?? []),
          ...(distinctIdentities > 1
            ? [`${distinctIdentities} open session files reduce to root identity ${openIdentity.value} via parent links`]
            : []),
        ];
        return {
          ...surface,
          sourceSessionClaims: [sessionClaim(openIdentity)],
          sourceSessionIds: [openIdentity.value],
          identityConflict: undefined,
          identityTrace: trace(
            "open-file-match",
            [openIdentity.value],
            undefined,
            notes.length > 0 ? notes : undefined,
          ),
        };
      }

      const commandHints = commandHintEvidence.flatMap((hint): IdentityHint[] =>
        hint.resolvedSessionId ? [{ provider: hint.provider, value: hint.resolvedSessionId, full: true }] : [],
      );
      const rejectedCommandHint = commandHintEvidence.find((hint) => hint.rejectionReason);
      if (rejectedCommandHint?.rejectionReason) {
        const identityConflict = `cmux ${surface.surfaceId} refused command identity: ${rejectedCommandHint.rejectionReason}`;
        errors.push(identityConflict);
        return {
          ...surface,
          sourceSessionClaims: [],
          sourceSessionIds: [],
          identityConflict,
          identityTrace: trace("command-hint-conflict", [], identityConflict, attributionNotes),
        };
      }
      const commandIdentity = uniqueIdentity(commandHints);
      if (commandHints.length > 0 && !commandIdentity) {
        const identityConflict = `cmux ${surface.surfaceId} has conflicting recognized agent commands${conflictLocation}`;
        errors.push(identityConflict);
        return {
          ...surface,
          sourceSessionClaims: [],
          sourceSessionIds: [],
          identityConflict,
          identityTrace: trace("command-hint-conflict", [], identityConflict, attributionNotes),
        };
      }
      return commandIdentity
        ? {
            ...surface,
            sourceSessionClaims: [sessionClaim(commandIdentity)],
            sourceSessionIds: [commandIdentity.value],
            identityConflict: undefined,
            identityTrace: trace("command-hint-match", [commandIdentity.value], undefined, attributionNotes),
          }
        : {
            ...surface,
            identityTrace: trace("no-evidence", [...surface.sourceSessionIds], surface.identityConflict, attributionNotes),
          };
    }),
    errors,
    liveAgentProcessIds,
    recognizedAgentProcessIds,
    processStarts: Object.fromEntries(processStartsByPid),
    /* The only return that reaches here has read the process table AND the open
       files without error; every earlier exit is a failure path that leaves
       this undefined. */
    rosterComplete: true,
  };
}
