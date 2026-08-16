import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { AgentStatus, TokenUsage } from "../shared/types";
import type { IncrementalParser, ParseMetadata } from "./collectors";
import {
  extractClosingByRole,
  extractLastHumanMessage,
  extractLastMessageByRole,
  readableHumanMessage,
  type HumanMessageCandidate,
} from "./human-message";
import {
  DEFAULT_LIFECYCLE_THRESHOLDS,
  spokenMinutes,
  type LifecycleThresholds,
} from "./lifecycle";
import { resolveAgentName } from "./naming";
import type { CollectedAgent, CollectionResult, SpendSource } from "./types";

function recencyStatus(
  updatedAt: string,
  nowMs: number,
  thresholds: LifecycleThresholds = DEFAULT_LIFECYCLE_THRESHOLDS,
): { status: AgentStatus; reason: string } {
  const ageMs = Math.max(0, nowMs - Date.parse(updatedAt));
  if (ageMs < thresholds.freshMs) {
    return { status: "running", reason: `Source activity within ${spokenMinutes(thresholds.freshMs)}.` };
  }
  if (ageMs < thresholds.quietMs) {
    return { status: "waiting", reason: `No source activity in the last ${spokenMinutes(thresholds.freshMs)}.` };
  }
  return { status: "stale", reason: `No source activity in the last ${spokenMinutes(thresholds.quietMs)}.` };
}

type JsonRecord = Record<string, unknown>;

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function timestamp(value: unknown): string | undefined {
  const raw = text(value);
  return raw && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : undefined;
}

function contentText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (!Array.isArray(value)) return undefined;
  const joined = value.map((part) => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    const record = part as JsonRecord;
    return text(record.text) ?? text(record.content) ?? "";
  }).join("\n").trim();
  return joined || undefined;
}

function later(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

export function createHermesParser(): IncrementalParser {
  let model: string | undefined;
  let cwd: string | undefined;
  let startedAt: string | undefined;
  let updatedAt: string | undefined;
  let task: string | undefined;
  let tail: string | undefined;
  let lastHumanFacingAt: string | undefined;
  const humanMessages: HumanMessageCandidate[] = [];
  let messages = 0;

  const append = (rows: readonly JsonRecord[]): void => {
    for (const row of rows) {
      model ??= text(row.model);
      cwd ??= text(row.cwd) ?? text(row.working_directory);
      const at = timestamp(row.timestamp);
      if (at) {
        startedAt = startedAt && startedAt < at ? startedAt : at;
        updatedAt = later(updatedAt, at);
      }
      if (row.role !== "user" && row.role !== "assistant") continue;
      messages += 1;
      humanMessages.push({
        role: row.role,
        content: row.content,
        timestamp: at,
      });
      const body = contentText(row.content);
      if (!body) continue;
      if (readableHumanMessage("hermes", row.content) && at) {
        lastHumanFacingAt = later(lastHumanFacingAt, at);
      }
      if (row.role === "user") task ??= body.slice(0, 500);
      if (row.role === "assistant") tail = body.slice(-800);
    }
  };

  const result = (meta: ParseMetadata): CollectedAgent | null => {
    const sourcePath = meta.sourcePath;
    const sourceSessionId = sourcePath
      ? basename(sourcePath).replace(/\.jsonl$/, "")
      : undefined;
    if (!sourceSessionId || !messages) return null;
    const fallback = new Date(meta.mtimeMs ?? meta.nowMs ?? Date.now()).toISOString();
    /* Hermes timestamps the JSONL header, not every message. The transcript's
       mtime is therefore the observed activity clock for subsequent turns. */
    const sourceUpdatedAt = meta.mtimeMs === undefined
      ? updatedAt ?? fallback
      : later(updatedAt, fallback) ?? fallback;
    const recency = recencyStatus(sourceUpdatedAt, meta.nowMs ?? Date.now(), meta.thresholds);
    return {
      id: `hermes:${sourceSessionId}`,
      provider: "hermes",
      sourceSessionId,
      displayName: `Hermes · ${sourceSessionId.slice(0, 8)}`,
      identity: resolveAgentName({
        provider: "hermes",
        sourceSessionId,
        originCwd: cwd,
        taskName: task,
      }),
      cwd,
      originCwd: cwd,
      model,
      task,
      status: recency.status,
      statusReason: recency.reason,
      startedAt,
      updatedAt: sourceUpdatedAt,
      tokens: { provenance: "unknown" },
      lastHumanFacingAt,
      lastHumanMessage: extractLastHumanMessage("hermes", humanMessages, task),
      lastUserMessage: extractLastMessageByRole("hermes", humanMessages, "user"),
      lastAgentMessage: extractLastMessageByRole("hermes", humanMessages, "assistant"),
      lastAgentClosing: extractClosingByRole("hermes", humanMessages, "assistant"),
      transcriptTail: tail,
      artifacts: sourcePath ? [{ label: "Hermes transcript", path: sourcePath }] : [],
      gates: [],
    };
  };

  return { append, result };
}

export function parseHermesJsonl(
  jsonl: string,
  meta: ParseMetadata = {},
): CollectedAgent | null {
  const parser = createHermesParser();
  const rows: JsonRecord[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        rows.push(value as JsonRecord);
      }
    } catch {
      // Hermes appends JSONL while a session is active; a partial tail is normal.
    }
  }
  parser.append(rows);
  return parser.result(meta);
}

interface MutableSpendSource {
  id: string;
  label: string;
  lastRunAt?: string;
  input: number;
  output: number;
  total: number;
  sawInput: boolean;
  sawOutput: boolean;
  sawTotal: boolean;
  costUsd: number;
  sawCost: boolean;
}

function mutableSource(jobId: string, label?: string): MutableSpendSource {
  return {
    id: jobId,
    label: label ?? `Hermes cron ${jobId}`,
    input: 0,
    output: 0,
    total: 0,
    sawInput: false,
    sawOutput: false,
    sawTotal: false,
    costUsd: 0,
    sawCost: false,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function collectHermesSpendSources(
  home: string = homedir(),
): Promise<CollectionResult<SpendSource[]>> {
  const hermesRoot = join(home, ".hermes");
  if (!existsSync(hermesRoot)) return { value: [], errors: [], absent: true };
  const cronRoot = join(hermesRoot, "cron");
  if (!existsSync(cronRoot)) return { value: [], errors: [] };

  const errors: string[] = [];
  const sources = new Map<string, MutableSpendSource>();
  const jobsPath = join(cronRoot, "jobs.json");
  if (existsSync(jobsPath)) {
    try {
      const parsed = JSON.parse(await readFile(jobsPath, "utf8")) as { jobs?: unknown };
      if (!Array.isArray(parsed.jobs)) throw new Error("jobs is not an array");
      for (const value of parsed.jobs) {
        if (!value || typeof value !== "object") continue;
        const job = value as JsonRecord;
        const jobId = text(job.id);
        if (!jobId) {
          errors.push("hermes cron jobs.json: job is missing id");
          continue;
        }
        const source = sources.get(jobId) ?? mutableSource(jobId, text(job.name));
        source.label = text(job.name) ?? source.label;
        source.lastRunAt = later(source.lastRunAt, timestamp(job.last_run_at));
        sources.set(jobId, source);
      }
    } catch (error) {
      errors.push(`hermes cron jobs.json: ${errorMessage(error)}`);
    }
  }

  const outputRoot = join(cronRoot, "output");
  if (existsSync(outputRoot)) {
    try {
      for (const entry of await readdir(outputRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const source = sources.get(entry.name) ?? mutableSource(entry.name);
        if (!source.lastRunAt) {
          const jobOutputRoot = join(outputRoot, entry.name);
          for (const output of await readdir(jobOutputRoot, { withFileTypes: true })) {
            if (!output.isFile() || !output.name.endsWith(".md")) continue;
            const details = await stat(join(jobOutputRoot, output.name));
            source.lastRunAt = later(source.lastRunAt, details.mtime.toISOString());
          }
        }
        sources.set(entry.name, source);
      }
    } catch (error) {
      errors.push(`hermes cron output: ${errorMessage(error)}`);
    }
  }

  const auditPath = join(cronRoot, "usage_audit.jsonl");
  if (existsSync(auditPath)) {
    try {
      const raw = await readFile(auditPath, "utf8");
      const lines = raw.split("\n");
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]!.trim();
        if (!line) continue;
        let record: JsonRecord;
        try {
          const parsed = JSON.parse(line) as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("row is not an object");
          }
          record = parsed as JsonRecord;
        } catch (error) {
          if (index === lines.length - 1 && !raw.endsWith("\n")) continue;
          errors.push(`hermes cron usage_audit.jsonl line ${index + 1}: ${errorMessage(error)}`);
          continue;
        }
        const jobId = text(record.job_id);
        if (!jobId) {
          errors.push(`hermes cron usage_audit.jsonl line ${index + 1}: missing job_id`);
          continue;
        }
        const source = sources.get(jobId) ?? mutableSource(jobId);
        const input = number(record.prompt_tokens);
        const output = number(record.completion_tokens);
        const total = number(record.total_tokens);
        const costUsd = number(record.cost_usd);
        if (input !== undefined) {
          source.input += input;
          source.sawInput = true;
        }
        if (output !== undefined) {
          source.output += output;
          source.sawOutput = true;
        }
        if (total !== undefined) {
          source.total += total;
          source.sawTotal = true;
        } else if (input !== undefined || output !== undefined) {
          source.total += (input ?? 0) + (output ?? 0);
          source.sawTotal = true;
        }
        if (costUsd !== undefined) {
          source.costUsd += costUsd;
          source.sawCost = true;
        }
        source.lastRunAt = later(source.lastRunAt, timestamp(record.ts));
        sources.set(jobId, source);
      }
    } catch (error) {
      errors.push(`hermes cron usage_audit.jsonl: ${errorMessage(error)}`);
    }
  }

  for (const tickerName of ["ticker_heartbeat", "ticker_last_success"] as const) {
    const tickerPath = join(cronRoot, tickerName);
    if (!existsSync(tickerPath)) continue;
    try {
      const raw = (await readFile(tickerPath, "utf8")).trim();
      const epoch = Number(raw);
      if (!raw || !Number.isFinite(epoch) || epoch < 0) throw new Error("invalid epoch seconds");
    } catch (error) {
      errors.push(`hermes cron ${tickerName}: ${errorMessage(error)}`);
    }
  }

  const value = [...sources.values()].map((source): SpendSource => {
    const tokens: TokenUsage | undefined = source.sawTotal || source.sawInput || source.sawOutput
      ? {
          ...(source.sawInput ? { input: source.input } : {}),
          ...(source.sawOutput ? { output: source.output } : {}),
          ...(source.sawTotal ? { total: source.total } : {}),
          provenance: "observed",
        }
      : undefined;
    return {
      id: `hermes:cron:${source.id}`,
      provider: "hermes",
      kind: "cron",
      label: source.label,
      ...(source.lastRunAt ? { lastRunAt: source.lastRunAt } : {}),
      ...(tokens ? { tokens } : {}),
      ...(source.sawCost ? { costUsd: source.costUsd } : {}),
    };
  });
  return { value, errors };
}
