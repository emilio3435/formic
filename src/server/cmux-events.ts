export const DEFAULT_CMUX_EVENTS_CURSOR_FILE = "~/.anthill/events.cursor";
const CMUX_EVENTS_RESTART_DELAY_MS = 1_000;

export type CmuxEventFrame =
  | { type: "ack"; bootId: string; resumeGap: boolean }
  | { type: "event"; bootId: string; sequence: number; category: string }
  | { type: "heartbeat"; bootId: string };

export interface CmuxEventsChild {
  stdout: ReadableStream<Uint8Array>;
  stderr?: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(signal: "SIGTERM"): void;
}

export type SpawnCmuxEvents = (command: readonly string[]) => CmuxEventsChild;

export interface CmuxEventsRestartHandle {
  cancel(): void;
}

export type ScheduleCmuxEventsRestart = (
  restart: () => void,
  delayMs: number,
) => CmuxEventsRestartHandle;

export interface CmuxEventsRuntime {
  cursorFile?: string;
  spawn?: SpawnCmuxEvents;
  scheduleRestart?: ScheduleCmuxEventsRestart;
}

export function cmuxEventsCommand(
  executable: string,
  cursorFile = DEFAULT_CMUX_EVENTS_CURSOR_FILE,
): string[] {
  return [
    executable,
    "events",
    "--cursor-file",
    cursorFile,
    "--reconnect",
    "--category",
    "agent",
    "--category",
    "workspace",
  ];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function bootIdFor(frame: Record<string, unknown>): string {
  const bootId = frame.boot_id;
  if (typeof bootId !== "string" || !bootId.trim()) {
    throw new Error("invalid cmux event frame: missing boot_id");
  }
  return bootId;
}

export function parseCmuxEventLine(line: string): CmuxEventFrame | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error("invalid cmux event frame: invalid JSON");
  }
  const frame = record(parsed);
  if (!frame) throw new Error("invalid cmux event frame: expected an object");
  if (frame.type === "error") {
    const error = record(frame.error);
    const detail = typeof frame.error === "string"
      ? frame.error
      : typeof error?.message === "string"
        ? error.message
        : undefined;
    throw new Error(`cmux event stream error${detail ? `: ${detail}` : ""}`);
  }
  if (frame.type !== "ack" && frame.type !== "event" && frame.type !== "heartbeat") {
    return undefined;
  }
  const bootId = bootIdFor(frame);
  if (frame.type === "ack") {
    return {
      type: "ack",
      bootId,
      resumeGap: record(frame.resume)?.gap === true,
    };
  }
  if (frame.type === "heartbeat") return { type: "heartbeat", bootId };
  if (!Number.isSafeInteger(frame.seq) || (frame.seq as number) < 0) {
    throw new Error("invalid cmux event frame: event missing numeric seq");
  }
  if (typeof frame.category !== "string" || !frame.category.trim()) {
    throw new Error("invalid cmux event frame: event missing category");
  }
  return {
    type: "event",
    bootId,
    sequence: frame.seq as number,
    category: frame.category,
  };
}

export const spawnCmuxEvents: SpawnCmuxEvents = (command) => {
  const child = Bun.spawn([...command], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    stdout: child.stdout as ReadableStream<Uint8Array>,
    stderr: child.stderr as ReadableStream<Uint8Array>,
    exited: child.exited,
    kill: (signal) => child.kill(signal),
  };
};

const scheduleCmuxEventsRestart: ScheduleCmuxEventsRestart = (restart, delayMs) => {
  const timer = setTimeout(restart, delayMs);
  return { cancel: () => clearTimeout(timer) };
};

async function consumeLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  const consumePendingLines = (): void => {
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (line) onLine(line);
      newline = pending.indexOf("\n");
    }
  };
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      consumePendingLines();
    }
    pending += decoder.decode();
    consumePendingLines();
    const finalLine = pending.trim();
    if (finalLine) onLine(finalLine);
  } finally {
    reader.releaseLock();
  }
}

export interface CmuxEventsSupervisorOptions {
  command: readonly string[];
  onFrame(frame: CmuxEventFrame): void;
  onError(error: Error): void;
  spawn?: SpawnCmuxEvents;
  scheduleRestart?: ScheduleCmuxEventsRestart;
}

export class CmuxEventsSupervisor {
  readonly #command: readonly string[];
  readonly #onFrame: (frame: CmuxEventFrame) => void;
  readonly #onError: (error: Error) => void;
  readonly #spawn: SpawnCmuxEvents;
  readonly #scheduleRestart: ScheduleCmuxEventsRestart;
  #child?: CmuxEventsChild;
  #restart?: CmuxEventsRestartHandle;
  #generation = 0;
  #running = false;

  constructor(options: CmuxEventsSupervisorOptions) {
    this.#command = [...options.command];
    this.#onFrame = options.onFrame;
    this.#onError = options.onError;
    this.#spawn = options.spawn ?? spawnCmuxEvents;
    this.#scheduleRestart = options.scheduleRestart ?? scheduleCmuxEventsRestart;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#launch();
  }

  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    this.#generation += 1;
    this.#restart?.cancel();
    this.#restart = undefined;
    const child = this.#child;
    this.#child = undefined;
    if (!child) return;
    try {
      child.kill("SIGTERM");
    } catch {
      // The supervised child already exited.
    }
  }

  #report(error: unknown): void {
    this.#onError(error instanceof Error ? error : new Error(String(error)));
  }

  #schedule(): void {
    if (!this.#running || this.#restart) return;
    this.#restart = this.#scheduleRestart(() => {
      this.#restart = undefined;
      if (this.#running) this.#launch();
    }, CMUX_EVENTS_RESTART_DELAY_MS);
  }

  #launch(): void {
    if (!this.#running) return;
    let child: CmuxEventsChild;
    try {
      child = this.#spawn(this.#command);
    } catch (error) {
      this.#report(error);
      this.#schedule();
      return;
    }
    this.#child = child;
    const generation = ++this.#generation;
    void consumeLines(child.stdout, (line) => {
      if (!this.#running || generation !== this.#generation) return;
      try {
        const frame = parseCmuxEventLine(line);
        if (frame) this.#onFrame(frame);
      } catch (error) {
        this.#report(error);
      }
    }).catch((error) => this.#streamFailed(child, generation, error));
    if (child.stderr) {
      void consumeLines(child.stderr, (line) => {
        if (this.#running && generation === this.#generation) {
          this.#report(new Error(`cmux events stderr: ${line}`));
        }
      }).catch((error) => {
        if (this.#running && generation === this.#generation) this.#report(error);
      });
    }
    void child.exited.then(
      (exitCode) => this.#exited(child, generation, exitCode),
      (error) => this.#streamFailed(child, generation, error),
    );
  }

  #streamFailed(child: CmuxEventsChild, generation: number, error: unknown): void {
    if (!this.#running || generation !== this.#generation || child !== this.#child) return;
    this.#report(error);
    this.#child = undefined;
    this.#generation += 1;
    try {
      child.kill("SIGTERM");
    } catch {
      // The failed child already exited.
    }
    this.#schedule();
  }

  #exited(child: CmuxEventsChild, generation: number, exitCode: number): void {
    if (!this.#running || generation !== this.#generation || child !== this.#child) return;
    this.#child = undefined;
    this.#report(new Error(`cmux events child exited with code ${exitCode}`));
    this.#schedule();
  }
}
