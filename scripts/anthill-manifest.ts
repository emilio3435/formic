#!/usr/bin/env bun
/**
 * Atomic run-manifest lane writer for T9 self-registration / backfill.
 *
 * Writes the fail-closed `status` + `statusAt` pair (and session binding)
 * that `src/server/run-manifests.ts` parses. Root defaults to
 * `$ANTHILL_RUNS_ROOT` or `~/.anthill/runs`. Tests MUST set ANTHILL_RUNS_ROOT
 * to a temp directory — never point fixtures at the real runs tree.
 *
 * Sibling to `scripts/cmux-hook-store.ts` (T8): same atomic rename + lock style.
 */
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { atomicWriteJson, readJsonObject, withFileLock } from "./lib/atomic-json";

export type ManifestWriteMode = "boot" | "done" | "backfill";

export interface ManifestLaneWriteInput {
  root?: string;
  runId: string;
  laneId: string;
  provider: string;
  sessionId: string;
  mode: ManifestWriteMode;
  statusAt?: string;
}

export type ManifestWriteResult =
  | {
    ok: true;
    wrote: boolean;
    path: string;
    reason: "created-binding" | "updated-status" | "first-write-wins" | "already-done";
  }
  | { ok: false; error: string };

const AGENT_ID_RE = /^([^:\s]+):(.+)$/;

export function defaultRunsRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ANTHILL_RUNS_ROOT?.trim();
  if (override) return override;
  return join(homedir(), ".anthill", "runs");
}

export function manifestPathFor(root: string, runId: string): string {
  return join(root, `${runId}.json`);
}

export function historyPathFor(root: string, runId: string): string {
  return join(root, `${runId}.history.jsonl`);
}

export function parseAgentId(value: string): { provider: string; sessionId: string } | undefined {
  const match = AGENT_ID_RE.exec(value.trim());
  if (!match) return undefined;
  return { provider: match[1]!, sessionId: match[2]! };
}

function nowIso(statusAt?: string): string {
  if (statusAt !== undefined) {
    if (!Number.isFinite(Date.parse(statusAt))) {
      throw new Error(`invalid statusAt: ${statusAt}`);
    }
    return statusAt;
  }
  return new Date().toISOString();
}

function asLaneArray(value: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (!value.every((lane) => lane && typeof lane === "object" && !Array.isArray(lane))) {
    return undefined;
  }
  return value as Record<string, unknown>[];
}

function appendHistory(
  root: string,
  runId: string,
  entry: Record<string, unknown>,
): void {
  mkdirSync(root, { recursive: true });
  appendFileSync(historyPathFor(root, runId), `${JSON.stringify(entry)}\n`, "utf8");
}

/**
 * Atomically bind / update a lane. First-write-wins per session for boot:
 * a different sessionId already on the lane is left alone (use backfill to
 * succeed it). Status+statusAt are always written as a pair.
 */
export function writeLaneRegistration(input: ManifestLaneWriteInput): ManifestWriteResult {
  const root = input.root ?? defaultRunsRoot();
  const path = manifestPathFor(root, input.runId);
  if (!existsSync(path)) {
    return { ok: false, error: `manifest not found: ${path}` };
  }
  if (!input.runId.trim() || !input.laneId.trim()) {
    return { ok: false, error: "runId and laneId are required" };
  }
  if (!input.provider.trim() || !input.sessionId.trim()) {
    return { ok: false, error: "provider and sessionId are required" };
  }
  if (!["boot", "done", "backfill"].includes(input.mode)) {
    return { ok: false, error: `invalid mode: ${input.mode}` };
  }

  const statusAt = nowIso(input.statusAt);
  const lockPath = `${path}.lock`;

  try {
    return withFileLock(lockPath, () => {
      const manifest = readJsonObject(path);
      const lanes = asLaneArray(manifest.lanes);
      if (!lanes) return { ok: false as const, error: "manifest.lanes is not an object array" };

      const index = lanes.findIndex((lane) => lane.laneId === input.laneId);
      if (index < 0) {
        return { ok: false as const, error: `lane not found: ${input.laneId}` };
      }
      const lane = { ...lanes[index]! };
      const existingSession = typeof lane.sessionId === "string" ? lane.sessionId : undefined;
      const existingProvider = typeof lane.provider === "string" ? lane.provider : undefined;

      if (input.mode === "boot") {
        if (existingSession && existingSession !== input.sessionId) {
          return {
            ok: true as const,
            wrote: false,
            path,
            reason: "first-write-wins" as const,
          };
        }
        const bindingMissing = !existingSession;
        lane.provider = input.provider;
        lane.sessionId = input.sessionId;
        lane.status = "active";
        lane.statusAt = statusAt;
        lanes[index] = lane;
        manifest.lanes = lanes;
        atomicWriteJson(path, manifest);
        if (bindingMissing) {
          appendHistory(root, input.runId, {
            at: statusAt,
            op: "boot",
            laneId: input.laneId,
            provider: input.provider,
            sessionId: input.sessionId,
          });
        }
        return {
          ok: true as const,
          wrote: true,
          path,
          reason: bindingMissing ? "created-binding" as const : "updated-status" as const,
        };
      }

      if (input.mode === "done") {
        if (!existingSession) {
          return { ok: false as const, error: `lane ${input.laneId} has no sessionId to mark done` };
        }
        if (existingSession !== input.sessionId) {
          return {
            ok: true as const,
            wrote: false,
            path,
            reason: "first-write-wins" as const,
          };
        }
        if (lane.status === "done" && lane.statusAt) {
          return {
            ok: true as const,
            wrote: false,
            path,
            reason: "already-done" as const,
          };
        }
        lane.provider = existingProvider ?? input.provider;
        lane.sessionId = input.sessionId;
        lane.status = "done";
        lane.statusAt = statusAt;
        lanes[index] = lane;
        manifest.lanes = lanes;
        atomicWriteJson(path, manifest);
        appendHistory(root, input.runId, {
          at: statusAt,
          op: "done",
          laneId: input.laneId,
          provider: lane.provider,
          sessionId: input.sessionId,
        });
        return {
          ok: true as const,
          wrote: true,
          path,
          reason: "updated-status" as const,
        };
      }

      // backfill — explicit succession / retroactive adoption
      const previousSessionId = existingSession;
      const previousProvider = existingProvider;
      const succession = Boolean(previousSessionId && previousSessionId !== input.sessionId);
      lane.provider = input.provider;
      lane.sessionId = input.sessionId;
      lane.status = "active";
      lane.statusAt = statusAt;
      lanes[index] = lane;
      manifest.lanes = lanes;
      atomicWriteJson(path, manifest);
      appendHistory(root, input.runId, {
        at: statusAt,
        op: "backfill",
        laneId: input.laneId,
        provider: input.provider,
        sessionId: input.sessionId,
        ...(previousSessionId
          ? { previousSessionId, previousProvider: previousProvider ?? null }
          : {}),
        succession,
      });
      return {
        ok: true as const,
        wrote: true,
        path,
        reason: previousSessionId && !succession ? "updated-status" as const : "created-binding" as const,
      };
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function usage(exitCode = 2): never {
  console.error(`Usage:
  bun scripts/anthill-manifest.ts boot  [--run ID] [--lane ID] --provider P --session-id S [--root DIR] [--status-at ISO]
  bun scripts/anthill-manifest.ts done  [--run ID] [--lane ID] --provider P --session-id S [--root DIR] [--status-at ISO]
  bun scripts/anthill-manifest.ts backfill <runId> <laneId> <provider:sessionId> [--root DIR] [--status-at ISO]

Env:
  ANTHILL_RUN / ANTHILL_LANE     Defaults for --run / --lane
  ANTHILL_PROVIDER / ANTHILL_SESSION
  ANTHILL_RUNS_ROOT              Override manifest root (required in tests)
`);
  process.exit(exitCode);
}

function readFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx < 0) return undefined;
  return args[idx + 1];
}

function main(argv: string[]): void {
  const [command, ...rest] = argv;
  if (command !== "boot" && command !== "done" && command !== "backfill") usage();

  if (command === "backfill") {
    const runId = rest[0];
    const laneId = rest[1];
    const agentId = rest[2];
    if (!runId || !laneId || !agentId || runId.startsWith("--")) usage();
    const parsed = parseAgentId(agentId);
    if (!parsed) {
      console.error(`error: agent id must be provider:sessionId, got ${agentId}`);
      process.exit(2);
    }
    const result = writeLaneRegistration({
      root: readFlag(rest, "--root"),
      runId,
      laneId,
      provider: parsed.provider,
      sessionId: parsed.sessionId,
      mode: "backfill",
      statusAt: readFlag(rest, "--status-at"),
    });
    if (!result.ok) {
      console.error(`error: ${result.error}`);
      process.exit(1);
    }
    console.log(JSON.stringify(result));
    return;
  }

  const runId = readFlag(rest, "--run") ?? process.env.ANTHILL_RUN;
  const laneId = readFlag(rest, "--lane") ?? process.env.ANTHILL_LANE;
  const provider = readFlag(rest, "--provider") ?? process.env.ANTHILL_PROVIDER;
  const sessionId = readFlag(rest, "--session-id") ?? process.env.ANTHILL_SESSION;
  if (!runId || !laneId || !provider || !sessionId) usage();

  const result = writeLaneRegistration({
    root: readFlag(rest, "--root"),
    runId,
    laneId,
    provider,
    sessionId,
    mode: command,
    statusAt: readFlag(rest, "--status-at"),
  });
  if (!result.ok) {
    console.error(`error: ${result.error}`);
    process.exit(1);
  }
  console.log(JSON.stringify(result));
}

if (import.meta.main) {
  main(process.argv.slice(2));
}
