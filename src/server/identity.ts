import type {
  Provider,
  SurfaceCommandHintEvidence,
  SurfaceIdentityTrace,
  SurfaceOpenFileEvidence,
  SurfaceProcessEvidence,
} from "../shared/types";
import type { CmuxSurface, CollectedAgent, CollectionResult, CommandRunner } from "./types";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

interface ProcessRow {
  pid: number;
  tty: string;
  command: string;
}

interface IdentityHint {
  provider: Provider;
  value: string;
  full: boolean;
}

export function parseProcessTable(output: string): ProcessRow[] {
  return output.split("\n").flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\S+)\s+(.+)$/);
    if (!match || match[2] === "??" || match[2] === "?") return [];
    return [{ pid: Number(match[1]), tty: match[2].replace(/^\/dev\//, ""), command: match[3] }];
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
  const patterns: [Provider, RegExp][] = [
    ["omp", new RegExp(`\\/.omp\\/agent\\/sessions\\/.+?(?:_|\\/)(${UUID})\\.jsonl$`, "i")],
    ["codex", new RegExp(`\\/.codex\\/sessions\\/.+?rollout-.+?-(${UUID})\\.jsonl$`, "i")],
    ["claude", new RegExp(`\\/.claude\\/projects\\/.+?\\/(${UUID})\\.jsonl$`, "i")],
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
  ];
  for (const [provider, pattern] of exactPatterns) {
    const match = command.match(pattern);
    if (match) hints.push({ provider, value: match[1].toLowerCase(), full: true });
  }
  const resume = command.match(/\/cmux-agent-resume\/(omp|codex|claude|cursor)-([0-9a-f-]{8,36})(?:\.zsh)?(?:\s|$)/i);
  if (resume) {
    const value = resume[2].toLowerCase();
    hints.push({ provider: resume[1].toLowerCase() as Provider, value, full: new RegExp(`^${UUID}$`, "i").test(value) });
  }
  return hints;
}

export function isRecognizedAgentProcess(command: string): boolean {
  return /(?:^|\s)(?:\S*\/)?(?:omp|codex|claude|cursor-agent)(?:\.(?:js|mjs|cjs))?(?:\s|$)/i.test(command) ||
    /\/cmux-agent-resume\/(omp|codex|claude|cursor)-[0-9a-f-]{8,36}(?:\.zsh)?(?:\s|$)/i.test(command);
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

function uniqueIdentity(hints: readonly IdentityHint[]): string | undefined {
  const identities = [...new Set(hints.map((hint) => `${hint.provider}:${hint.value}`))];
  return identities.length === 1 ? identities[0].split(":", 2)[1] : undefined;
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

function resolveCommandHint(hint: IdentityHint, agents: readonly CollectedAgent[]): IdentityHint | null {
  if (hint.full) return hint;
  const matches = agents.filter(
    (agent) => agent.provider === hint.provider && agent.sourceSessionId.toLowerCase().startsWith(hint.value),
  );
  if (matches.length !== 1) return null;
  return { provider: hint.provider, value: matches[0].sourceSessionId.toLowerCase(), full: true };
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
): Promise<CollectionResult<CmuxSurface[]>> {
  const errors: string[] = [];
  const ttyNames = new Set(
    surfaces
      .filter((surface) => surface.runtimeSurfaceReady !== false)
      .map((surface) => surface.tty)
      .filter((tty): tty is string => Boolean(tty)),
  );
  if (ttyNames.size === 0) {
    // No runtime-ready surfaces to probe — but stale surfaces still need their
    // bindings cleared, not left intact. Skipping the map here left a lone stale
    // surface holding its old sourceSessionIds and reading as a phantom identity.
    return {
      value: surfaces.map((surface) =>
        surface.runtimeSurfaceReady === false
          ? {
              ...surface,
              sourceSessionIds: [],
              identityConflict: undefined,
              identityTrace: { ...baseTrace(surface, "stale-surface"), sourceSessionIds: [], identityConflict: undefined },
            }
          : { ...surface, identityTrace: baseTrace(surface, "no-tty") },
      ),
      errors,
    };
  }

  const processResult = await runner.run(["ps", "-axo", "pid=,tty=,command="], 8_000);
  if (processResult.timedOut || processResult.exitCode !== 0) {
    const error = processResult.timedOut
      ? "process identity lookup timed out"
      : `process identity lookup exited ${processResult.exitCode}: ${processResult.stderr.trim() || "no stderr"}`;
    errors.push(error);
    return {
      value: failedProbeSurfaces(surfaces, error),
      errors,
    };
  }
  const processes = parseProcessTable(processResult.stdout).filter((process) => ttyNames.has(process.tty));
  const processesByTty = new Map<string, ProcessRow[]>();
  for (const process of processes) {
    const ttyProcesses = processesByTty.get(process.tty) ?? [];
    ttyProcesses.push(process);
    processesByTty.set(process.tty, ttyProcesses);
  }
  const agentsByIdentity = new Map(
    agents.map((agent) => [`${agent.provider}:${agent.sourceSessionId.toLowerCase()}`, agent]),
  );
  const resolvedCommandHints = new Map<string, IdentityHint | null>();
  const cachedCommandHint = (hint: IdentityHint): IdentityHint | null => {
    const key = `${identityKey(hint)}:${hint.full}`;
    if (!resolvedCommandHints.has(key)) {
      resolvedCommandHints.set(key, resolveCommandHint(hint, agents));
    }
    return resolvedCommandHints.get(key) ?? null;
  };
  const pids = [
    ...new Set(
      processes
        .filter((process) => isRecognizedAgentProcess(process.command))
        .map((process) => process.pid),
    ),
  ];
  let openFiles = new Map<number, string[]>();
  if (pids.length > 0) {
    // Absolute path: Bun/server PATH can omit /usr/sbin, which made identity
    // enrichment fail-closed and left agents partially/quarantined.
    const openFileResult = await runner.run(["/usr/sbin/lsof", "-a", "-p", pids.join(","), "-Fn"], 10_000);
    openFiles = parseOpenFiles(openFileResult.stdout);
    const hasUsableIdentityOutput = [...openFiles.values()]
      .flat()
      .some((path) => identityFromSessionPath(path) !== null);
    if (openFileResult.timedOut || (openFileResult.exitCode !== 0 && !hasUsableIdentityOutput)) {
      const error = openFileResult.timedOut
        ? "open-session identity lookup timed out"
        : `open-session identity lookup exited ${openFileResult.exitCode}: ${openFileResult.stderr.trim() || "no stderr"}`;
      errors.push(error);
      return { value: failedProbeSurfaces(surfaces, error), errors };
    }
  }

  return {
    value: surfaces.map((surface) => {
      if (surface.runtimeSurfaceReady === false) {
        return {
          ...surface,
          sourceSessionIds: [],
          identityConflict: undefined,
          identityTrace: { ...baseTrace(surface, "stale-surface"), sourceSessionIds: [], identityConflict: undefined },
        };
      }
      if (!surface.tty) return { ...surface, identityTrace: baseTrace(surface, "no-tty") };
      const tty = surface.tty.replace(/^\/dev\//, "");
      const ttyProcesses = processesByTty.get(tty) ?? [];
      const processEvidence: SurfaceProcessEvidence[] = ttyProcesses.map((process) => ({
        pid: process.pid,
        command: process.command,
        recognizedAgentProcess: isRecognizedAgentProcess(process.command),
      }));
      const openFileMatches: SurfaceOpenFileEvidence[] = ttyProcesses.flatMap((process) =>
        (openFiles.get(process.pid) ?? []).flatMap((path) => {
          const hint = identityFromSessionPath(path);
          return hint ? [{ pid: process.pid, path, provider: hint.provider, sessionId: hint.value }] : [];
        }),
      );
      const commandHintEvidence: SurfaceCommandHintEvidence[] = ttyProcesses.flatMap((process) =>
        identitiesFromCommand(process.command).map((hint) => ({
          pid: process.pid,
          provider: hint.provider,
          value: hint.value,
          full: hint.full,
          resolvedSessionId: cachedCommandHint(hint)?.value,
        })),
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
      if (openHints.length > 0 && !openIdentity) {
        const identityConflict = `cmux ${surface.surfaceId} has conflicting open agent session files on ${tty}`;
        errors.push(identityConflict);
        return {
          ...surface,
          sourceSessionIds: [],
          identityConflict,
          identityTrace: trace("open-file-conflict", [], identityConflict),
        };
      }
      if (openIdentity) {
        const distinctIdentities = new Set(openHints.map((hint) => `${hint.provider}:${hint.value}`)).size;
        return {
          ...surface,
          sourceSessionIds: [openIdentity.value],
          identityConflict: undefined,
          identityTrace: trace(
            "open-file-match",
            [openIdentity.value],
            undefined,
            distinctIdentities > 1
              ? [`${distinctIdentities} open session files reduce to root identity ${openIdentity.value} via parent links`]
              : undefined,
          ),
        };
      }

      const commandHints = commandHintEvidence.flatMap((hint): IdentityHint[] =>
        hint.resolvedSessionId ? [{ provider: hint.provider, value: hint.resolvedSessionId, full: true }] : [],
      );
      const commandIdentity = uniqueIdentity(commandHints);
      if (commandHints.length > 0 && !commandIdentity) {
        const identityConflict = `cmux ${surface.surfaceId} has conflicting recognized agent commands on ${tty}`;
        errors.push(identityConflict);
        return {
          ...surface,
          sourceSessionIds: [],
          identityConflict,
          identityTrace: trace("command-hint-conflict", [], identityConflict),
        };
      }
      return commandIdentity
        ? {
            ...surface,
            sourceSessionIds: [commandIdentity],
            identityConflict: undefined,
            identityTrace: trace("command-hint-match", [commandIdentity]),
          }
        : {
            ...surface,
            identityTrace: trace("no-evidence", [...surface.sourceSessionIds], surface.identityConflict),
          };
    }),
    errors,
  };
}
