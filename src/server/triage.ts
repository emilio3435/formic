import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AgentSnapshot,
  HubSnapshot,
  OperatorIssue,
  Provider,
  TriageMode,
  TriageQueueItem,
  TriageRecommendation,
  TriageStep,
} from "../shared/types";

const MAX_BODY_BYTES = 2_048;

export interface TriageQueueStore {
  list(): readonly TriageQueueItem[];
  get(issueId: string): TriageQueueItem | undefined;
  add(recommendation: TriageRecommendation): Promise<TriageQueueItem>;
  start(issueId: string, runner: TriageInvestigationRunner): Promise<TriageQueueItem>;
  subscribe?(listener: (item: TriageQueueItem) => void): () => void;
}

export interface InvestigationResult { ok: boolean; summary: string }
export interface InvestigationLaunch {
  runId: string;
  model: string;
  pid?: number;
  completion: Promise<InvestigationResult>;
}
export interface TriageInvestigationRunner {
  launch(item: TriageQueueItem): Promise<InvestigationLaunch>;
}

function allAgents(snapshot: HubSnapshot): AgentSnapshot[] {
  return snapshot.programs.flatMap((program) => program.agents);
}

function issueAgents(issue: OperatorIssue, snapshot: HubSnapshot): AgentSnapshot[] {
  const affected = new Set(issue.affectedAgentIds);
  return allAgents(snapshot).filter((agent) => affected.has(agent.id));
}

function modeFor(issue: OperatorIssue, agents: readonly AgentSnapshot[], programCount: number): TriageMode {
  if (
    issue.kind === "system" &&
    (agents.length >= 4 || programCount >= 2 || (issue.technicalDetails?.length ?? 0) >= 2)
  ) return "investigation";
  if (agents.length >= 2 || issue.kind === "system") return "coordinated";
  return "direct";
}

function solutionFor(issue: OperatorIssue, mode: TriageMode): { headline: string; steps: TriageStep[] } {
  if (issue.id === "system:cmux-identity-conflicts") {
    return {
      headline: "Re-establish one session identity per cmux surface",
      steps: [
        { title: "Keep controls quarantined", detail: "Preserve the fail-closed state while identity evidence conflicts." },
        { title: "Map the overlap", detail: "Group affected agents by TTY, surface, open session file, cwd, and provider process." },
        { title: "Isolate stale evidence", detail: "Separate active bindings from closed or inherited session handles without interrupting healthy lanes." },
        { title: "Verify one-to-one routing", detail: "Refresh cmux and require exactly one native session identity for every enabled surface." },
      ],
    };
  }
  if (issue.id.includes("cursor-model-policy")) {
    return {
      headline: issue.id.endsWith("active")
        ? "Stop the mismatched Cursor lane and relaunch it on Grok"
        : "Trace the historical launcher and verify the Grok-only rule",
      steps: [
        { title: "Identify the launcher", detail: "Link each violation to its parent session, task, model evidence, and launch path." },
        { title: "Apply the routing rule", detail: "Use Cursor Grok 4.5 Fast for Cursor work and native Claude or Codex for other model families." },
        { title: "Verify the replacement", detail: "Confirm the new session reports Grok before clearing the policy finding." },
      ],
    };
  }
  if (issue.id.includes("collector")) {
    return {
      headline: "Restore trustworthy collection before acting on incomplete data",
      steps: [
        { title: "Capture the failing source", detail: "Retain the exact collector errors and the last healthy timestamp." },
        { title: "Probe one representative session", detail: "Distinguish source absence, schema drift, permissions, and partial writes." },
        { title: "Reconcile the snapshot", detail: "Require a clean refresh and explicit coverage recovery before closing the finding." },
      ],
    };
  }
  if (issue.kind === "agent") {
    return {
      headline: "Review the latest result and send one targeted unblock",
      steps: [
        { title: "Read the latest evidence", detail: "Open the affected agent and inspect its status reason, last result, gates, and test state." },
        { title: "Choose the smallest unblock", detail: "Send one concrete follow-up or create a bounded repair lane when the blocker needs isolation." },
        { title: "Verify the transition", detail: "Confirm the agent returns to healthy work or records a precise external blocker." },
      ],
    };
  }
  return {
    headline: "Isolate the system fault and verify recovery",
    steps: [
      { title: "Bound the impact", detail: "Identify affected agents, programs, providers, and control surfaces." },
      { title: "Test the leading cause", detail: "Run the smallest read-only probe that separates the likely failure modes." },
      { title: "Apply and verify", detail: "Make the narrow repair, refresh the snapshot, and require the issue to clear." },
    ],
  };
}

function investigationPrompt(
  issue: OperatorIssue,
  solution: ReturnType<typeof solutionFor>,
  agents: readonly AgentSnapshot[],
): string {
  const evidence = [issue.summary, ...(issue.technicalDetails ?? [])].slice(0, 6);
  return [
    `Goal: Investigate and resolve ${issue.title} without disrupting healthy agent work.`,
    "",
    "Success means:",
    `- Reconcile the ${agents.length} affected agent records with their native provider and cmux evidence.`,
    `- Produce a root cause, the smallest safe repair, and a verification result.`,
    `- Preserve unrelated sessions and keep ambiguous controls quarantined until identity is exact.`,
    "",
    "Evidence:",
    ...evidence.map((item) => `- ${item}`),
    "",
    "Recommended path:",
    ...solution.steps.map((step) => `- ${step.title}: ${step.detail}`),
    "",
    "Stop when: The issue clears in a fresh Ant Hill snapshot or the investigation records one precise external blocker.",
  ].join("\n");
}

export function buildTriageRecommendation(
  issue: OperatorIssue,
  snapshot: HubSnapshot,
  now = new Date(),
): TriageRecommendation {
  const agents = issueAgents(issue, snapshot);
  const programIds = new Set(agents.map((agent) => agent.programId));
  const providers = [...new Set(agents.map((agent) => agent.provider))].sort() as Provider[];
  const mode = modeFor(issue, agents, programIds.size);
  const solution = solutionFor(issue, mode);
  const overlap = [
    `${agents.length} affected ${agents.length === 1 ? "agent" : "agents"}`,
    `${programIds.size} ${programIds.size === 1 ? "program" : "programs"}`,
    providers.length ? `${providers.join(", ")} evidence` : "system-only evidence",
  ].join(" · ");
  const evidence = [issue.summary, ...(issue.technicalDetails ?? [])].slice(0, 6);
  return {
    issueId: issue.id,
    generatedAt: now.toISOString(),
    mode,
    headline: solution.headline,
    rationale: `${overlap}. ${mode === "investigation" ? "The overlap is broad enough to isolate in a bounded investigation." : mode === "coordinated" ? "The repair spans related evidence and should be coordinated as one triage item." : "One focused follow-up should be enough."}`,
    affectedAgents: agents.length,
    affectedPrograms: programIds.size,
    providers,
    evidence,
    steps: solution.steps,
    queueRecommended: mode === "investigation",
    investigationPrompt: mode === "investigation" ? investigationPrompt(issue, solution, agents) : undefined,
  };
}

export class MemoryTriageQueueStore implements TriageQueueStore {
  protected readonly items = new Map<string, TriageQueueItem>();
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(item: TriageQueueItem) => void>();

  list(): readonly TriageQueueItem[] {
    return [...this.items.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  get(issueId: string): TriageQueueItem | undefined { return this.items.get(issueId); }

  subscribe(listener: (item: TriageQueueItem) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(item: TriageQueueItem): void {
    for (const listener of this.listeners) listener(item);
  }

  async add(recommendation: TriageRecommendation): Promise<TriageQueueItem> {
    const operation = this.mutationQueue.then(async () => {
      const existing = this.items.get(recommendation.issueId);
      if (existing) return existing;
      const item: TriageQueueItem = {
        ...recommendation,
        id: `triage:${recommendation.issueId}`,
        state: "queued",
        createdAt: recommendation.generatedAt,
      };
      await this.persist([...this.items.values(), item]);
      this.items.set(recommendation.issueId, item);
      this.notify(item);
      return item;
    });
    this.mutationQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async start(issueId: string, runner: TriageInvestigationRunner): Promise<TriageQueueItem> {
    return this.mutate(async () => {
      const item = this.items.get(issueId);
      if (!item) throw new Error("Investigation is not queued");
      if (item.state !== "queued") return item;
      const launch = await runner.launch(item);
      const running: TriageQueueItem = {
        ...item,
        state: "running",
        startedAt: new Date().toISOString(),
        runId: launch.runId,
        runModel: launch.model,
        pid: launch.pid,
      };
      await this.persist([...this.items.values()].map((value) => value.issueId === issueId ? running : value));
      this.items.set(issueId, running);
      this.notify(running);
      void launch.completion.then((result) => this.finish(issueId, result));
      return running;
    });
  }

  private async finish(issueId: string, result: InvestigationResult): Promise<void> {
    await this.mutate(async () => {
      const item = this.items.get(issueId);
      if (!item || item.state !== "running") return;
      const finished: TriageQueueItem = {
        ...item,
        state: result.ok ? "completed" : "blocked",
        completedAt: new Date().toISOString(),
        result: result.summary,
      };
      await this.persist([...this.items.values()].map((value) => value.issueId === issueId ? finished : value));
      this.items.set(issueId, finished);
      this.notify(finished);
    });
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  protected async persist(_items: readonly TriageQueueItem[]): Promise<void> {}
}

export class JsonTriageQueueStore extends MemoryTriageQueueStore {
  private constructor(private readonly path: string) {
    super();
  }

  static async open(path: string): Promise<JsonTriageQueueStore> {
    const store = new JsonTriageQueueStore(path);
    let recovered = false;
    try {
      const parsed = JSON.parse(await readFile(path, "utf8"));
      if (!Array.isArray(parsed)) throw new Error("triage queue must be an array");
      for (const item of parsed) {
        if (!isQueueItem(item)) throw new Error("triage queue contains an invalid item");
        if (item.state === "running") {
          store.items.set(item.issueId, {
            ...item,
            state: "blocked",
            completedAt: new Date().toISOString(),
            result: "The Ant Hill restarted before this investigation reported completion. Requeue from the current issue evidence.",
          });
          recovered = true;
        } else store.items.set(item.issueId, item);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (recovered) await store.persist(store.list());
    return store;
  }

  protected override async persist(items: readonly TriageQueueItem[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(items, null, 2)}\n`, "utf8");
    await rename(temporary, this.path);
  }
}

function isQueueItem(value: unknown): value is TriageQueueItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<TriageQueueItem>;
  return typeof item.id === "string" &&
    typeof item.issueId === "string" &&
    ["queued", "running", "completed", "blocked"].includes(String(item.state)) &&
    typeof item.createdAt === "string" &&
    Array.isArray(item.steps) &&
    Array.isArray(item.evidence);
}

export class NativeLunaInvestigationRunner implements TriageInvestigationRunner {
  private active = false;

  constructor(private readonly cwd: string, private readonly outputRoot: string) {}

  async launch(item: TriageQueueItem): Promise<InvestigationLaunch> {
    if (!item.investigationPrompt) throw new Error("Queued item has no investigation prompt");
    if (this.active) throw new Error("One investigation is already running");
    await mkdir(this.outputRoot, { recursive: true });
    this.active = true;
    const runId = `${Date.now()}-${item.issueId.replace(/[^a-z0-9]+/gi, "-").slice(0, 80)}`;
    const outputPath = join(this.outputRoot, `${runId}.md`);
    let process: ReturnType<typeof Bun.spawn>;
    try {
      process = Bun.spawn([
        "codex", "exec", "--model", "gpt-5.6-luna",
        "-c", 'model_reasoning_effort="xhigh"',
        "--sandbox", "read-only", "--skip-git-repo-check", "--ephemeral",
        "--output-last-message", outputPath, "-C", this.cwd,
        item.investigationPrompt,
      ], { cwd: this.cwd, stdout: "ignore", stderr: "pipe" });
    } catch (error) {
      this.active = false;
      throw error;
    }
    const completion = (async (): Promise<InvestigationResult> => {
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; process.kill("SIGTERM"); }, 10 * 60_000);
      try {
        const stderr = typeof process.stderr === "number" ? "" : await new Response(process.stderr).text();
        const exitCode = await process.exited;
        let summary = "";
        try { summary = (await readFile(outputPath, "utf8")).trim(); } catch { /* missing result */ }
        if (!summary) summary = timedOut ? "Investigation exceeded the 10-minute runtime limit." : stderr.trim() || `Investigation exited ${exitCode}`;
        return { ok: !timedOut && exitCode === 0, summary: summary.slice(0, 8_000) };
      } finally {
        clearTimeout(timeout);
        this.active = false;
      }
    })();
    return { runId, model: "GPT-5.6 Luna · XHIGH · read-only", pid: process.pid, completion };
  }
}

function response(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

function error(status: number, code: string, message: string): Response {
  return response({ ok: false, error: { code, message } }, status);
}

function sameOriginLoopback(request: Request): boolean {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  return ["127.0.0.1", "localhost", "::1"].includes(url.hostname) && origin === url.origin;
}

async function issueIdFrom(request: Request): Promise<string | Response> {
  if (!sameOriginLoopback(request)) {
    return error(403, "ORIGIN_REJECTED", "Triage changes require an exact same-origin loopback Origin header.");
  }
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return error(415, "CONTENT_TYPE_REJECTED", "Triage changes require application/json.");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return error(413, "BODY_TOO_LARGE", `Triage body exceeds ${MAX_BODY_BYTES} bytes.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return error(400, "INVALID_JSON", "Triage body is not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return error(400, "INVALID_TRIAGE_REQUEST", "Body must be an object with one issueId field.");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.issueId !== "string" || !record.issueId.trim() || record.issueId.length > 300) {
    return error(400, "INVALID_TRIAGE_REQUEST", "Body must contain one non-empty issueId no longer than 300 characters.");
  }
  return record.issueId;
}

export async function handleTriageRequest(
  request: Request,
  snapshot: HubSnapshot,
  store: TriageQueueStore,
  runner?: TriageInvestigationRunner,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/triage/queue" && request.method === "GET") {
    return response({ ok: true, items: store.list() });
  }
  if (request.method !== "POST") return error(405, "METHOD_NOT_ALLOWED", "Use POST for triage generation or queueing.");
  const issueId = await issueIdFrom(request);
  if (issueId instanceof Response) return issueId;
  if (url.pathname === "/api/triage/run") {
    if (!runner) return error(503, "INVESTIGATION_RUNNER_UNAVAILABLE", "The native investigation runner is unavailable.");
    try {
      return response({ ok: true, item: await store.start(issueId, runner) });
    } catch (cause) {
      const message = (cause as Error).message;
      return error(message === "Investigation is not queued" ? 404 : 500, "INVESTIGATION_LAUNCH_FAILED", message);
    }
  }
  const issue = snapshot.issues?.find((candidate) => candidate.id === issueId);
  if (!issue) return error(404, "ISSUE_NOT_FOUND", "The issue is not present in the current snapshot.");
  const recommendation = buildTriageRecommendation(issue, snapshot);
  if (url.pathname === "/api/triage/generate") {
    return response({ ok: true, recommendation });
  }
  if (url.pathname === "/api/triage/queue") {
    try {
      return response({ ok: true, item: await store.add(recommendation) });
    } catch (cause) {
      return error(500, "TRIAGE_QUEUE_WRITE_FAILED", `Could not persist triage queue: ${(cause as Error).message}`);
    }
  }
  return error(404, "NOT_FOUND", "Triage route not found.");
}
