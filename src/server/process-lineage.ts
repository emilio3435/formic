import type { HookSessionRecord } from "./cmux-hook-sessions";

export interface ProcessLineageExecResult {
  exitCode: number;
  stdout: string;
}

export type ProcessLineageExec = (
  command: readonly string[],
) => ProcessLineageExecResult;

export interface ProcessLineageSnapshot {
  processStarts: ReadonlyMap<number, number>;
  observedParents: ReadonlyMap<string, string>;
}

interface ProcessRow {
  pid: number;
  ppid: number;
  startedAtSeconds: number;
}

const defaultExec: ProcessLineageExec = (command) => {
  const result = Bun.spawnSync([...command], {
    env: { ...process.env, LC_ALL: "C" },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: result.exitCode, stdout: result.stdout.toString() };
};

function parseProcessTable(stdout: string): Map<number, ProcessRow> {
  const rows = new Map<number, ProcessRow>();
  for (const line of stdout.split("\n")) {
    const match = line.match(
      /^\s*(\d+)\s+(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})(?:\s+.*)?$/,
    );
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const startedAtMs = Date.parse(match[3]!);
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(ppid) || ppid < 0
      || !Number.isFinite(startedAtMs)) continue;
    rows.set(pid, { pid, ppid, startedAtSeconds: Math.floor(startedAtMs / 1_000) });
  }
  return rows;
}

function agentId(record: HookSessionRecord): string {
  return `${record.provider}:${record.sessionId}`;
}

function matchesStart(record: HookSessionRecord, row: ProcessRow | undefined): row is ProcessRow {
  if (!row) return false;
  return (
    record.pidStartSeconds === undefined
    || record.pidStartSeconds === row.startedAtSeconds
  );
}

function observedParents(
  records: readonly HookSessionRecord[],
  rows: ReadonlyMap<number, ProcessRow>,
): Map<string, string> {
  const recordsByPid = new Map<number, HookSessionRecord[]>();
  for (const record of records) {
    const row = rows.get(record.pid);
    if (!matchesStart(record, row)) continue;
    const matches = recordsByPid.get(record.pid) ?? [];
    matches.push(record);
    recordsByPid.set(record.pid, matches);
  }

  const parents = new Map<string, string>();
  for (const record of records) {
    let row = rows.get(record.pid);
    if (!matchesStart(record, row)) continue;
    const visited = new Set([record.pid]);
    while (row.ppid > 0 && !visited.has(row.ppid)) {
      visited.add(row.ppid);
      const candidates = (recordsByPid.get(row.ppid) ?? [])
        .filter((candidate) => agentId(candidate) !== agentId(record));
      if (candidates.length > 1) break;
      if (candidates.length === 1) {
        parents.set(agentId(record), agentId(candidates[0]!));
        break;
      }
      const parentRow = rows.get(row.ppid);
      if (!parentRow) break;
      row = parentRow;
    }
  }
  return parents;
}

export function readProcessLineage(
  records: readonly HookSessionRecord[],
  exec: ProcessLineageExec = defaultExec,
): ProcessLineageSnapshot | undefined {
  try {
    const result = exec(["ps", "-axo", "pid,ppid,lstart,command"]);
    if (result.exitCode !== 0) return undefined;
    const rows = parseProcessTable(result.stdout);
    if (rows.size === 0) return undefined;
    return {
      processStarts: new Map(
        [...rows.values()].map(({ pid, startedAtSeconds }) => [pid, startedAtSeconds]),
      ),
      observedParents: observedParents(records, rows),
    };
  } catch {
    return undefined;
  }
}
