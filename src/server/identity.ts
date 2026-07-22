import type { Provider } from "../shared/types";
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

function resolveCommandHint(hint: IdentityHint, agents: readonly CollectedAgent[]): IdentityHint | null {
  if (hint.full) return hint;
  const matches = agents.filter(
    (agent) => agent.provider === hint.provider && agent.sourceSessionId.toLowerCase().startsWith(hint.value),
  );
  if (matches.length !== 1) return null;
  return { provider: hint.provider, value: matches[0].sourceSessionId.toLowerCase(), full: true };
}

export async function enrichCmuxIdentity(
  surfaces: readonly CmuxSurface[],
  agents: readonly CollectedAgent[],
  runner: CommandRunner,
): Promise<CollectionResult<CmuxSurface[]>> {
  const errors: string[] = [];
  const ttyNames = new Set(surfaces.map((surface) => surface.tty).filter((tty): tty is string => Boolean(tty)));
  if (ttyNames.size === 0) return { value: [...surfaces], errors };

  const processResult = await runner.run(["ps", "-axo", "pid=,tty=,command="], 8_000);
  if (processResult.timedOut || processResult.exitCode !== 0) {
    errors.push(
      processResult.timedOut
        ? "process identity lookup timed out"
        : `process identity lookup exited ${processResult.exitCode}: ${processResult.stderr.trim() || "no stderr"}`,
    );
    return { value: [...surfaces], errors };
  }
  const processes = parseProcessTable(processResult.stdout).filter((process) => ttyNames.has(process.tty));
  const pids = [
    ...new Set(
      processes
        .filter((process) => isRecognizedAgentProcess(process.command))
        .map((process) => process.pid),
    ),
  ];
  let openFiles = new Map<number, string[]>();
  if (pids.length > 0) {
    const openFileResult = await runner.run(["lsof", "-a", "-p", pids.join(","), "-Fn"], 10_000);
    openFiles = parseOpenFiles(openFileResult.stdout);
    const hasUsableIdentityOutput = [...openFiles.values()]
      .flat()
      .some((path) => identityFromSessionPath(path) !== null);
    if (
      openFileResult.timedOut ||
      openFileResult.stderr.trim() ||
      (openFileResult.exitCode !== 0 && !hasUsableIdentityOutput)
    ) {
      errors.push(
        openFileResult.timedOut
          ? "open-session identity lookup timed out"
          : `open-session identity lookup exited ${openFileResult.exitCode}: ${openFileResult.stderr.trim() || "no stderr"}`,
      );
    }
  }

  return {
    value: surfaces.map((surface) => {
      if (!surface.tty) return surface;
      const tty = surface.tty.replace(/^\/dev\//, "");
      const ttyProcesses = processes.filter((process) => process.tty === tty);
      const openHints = ttyProcesses.flatMap((process) =>
        (openFiles.get(process.pid) ?? []).map(identityFromSessionPath).filter((hint): hint is IdentityHint => hint !== null),
      );
      const openIdentity = uniqueIdentity(openHints);
      if (openHints.length > 0 && !openIdentity) {
        const identityConflict = `cmux ${surface.surfaceId} has conflicting open agent session files on ${tty}`;
        errors.push(identityConflict);
        return { ...surface, sourceSessionIds: [], identityConflict };
      }
      if (openIdentity) {
        return { ...surface, sourceSessionIds: [openIdentity], identityConflict: undefined };
      }

      const commandHints = ttyProcesses
        .flatMap((process) => identitiesFromCommand(process.command))
        .map((hint) => resolveCommandHint(hint, agents))
        .filter((hint): hint is IdentityHint => hint !== null);
      const commandIdentity = uniqueIdentity(commandHints);
      if (commandHints.length > 0 && !commandIdentity) {
        const identityConflict = `cmux ${surface.surfaceId} has conflicting recognized agent commands on ${tty}`;
        errors.push(identityConflict);
        return { ...surface, sourceSessionIds: [], identityConflict };
      }
      return commandIdentity
        ? { ...surface, sourceSessionIds: [commandIdentity], identityConflict: undefined }
        : surface;
    }),
    errors,
  };
}
