/* SYNC — contract stub (master). Frozen by
   docs/superpowers/plans/2026-08-13-sync/00-MASTER-PLAN.md §Contract.

   SYNC-E implements the subscription/router internals in THIS file: the
   long-lived `cmux events --after <cursor>` child, seq tracking, gap-safe
   recollect, and dispatch. Every other lane ONLY registers handlers through
   `registerSyncHandler` and consumes the exported types — the seam is the
   TINT-G registration pattern, so phases stay fence-clean.

   NOTE (master, 2026-08-13): `src/server/cmux-events.ts` already supervises a
   `cmux events` child as a poll accelerator with its own cursor file
   (`~/.anthill/events.cursor`). This module is the TYPED dispatch router and
   must coexist with it — own cursor persistence, never that file. SYNC-E
   decides reuse-vs-parallel-child and records the choice in its report. */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isOwnEcho } from "./cmux-actions";
import {
  spawnCmuxEvents,
  type CmuxEventsChild,
  type SpawnCmuxEvents,
} from "./cmux-events";

/** Event names verified live 2026-08-13 (spec Probe Evidence). */
export type CmuxSyncEventName =
  | "workspace.created" | "workspace.renamed" | "workspace.closed"
  | "surface.created" | "surface.closed"
  | "notification.created" | "notification.read" | "notification.removed";

export interface CmuxSyncEvent {
  seq: number;
  name: CmuxSyncEventName | (string & {});
  /** Raw payload; notification bodies are REDACTED in events — fetch via notification.list. */
  payload: Record<string, unknown>;
}

export type SyncHandler = (event: CmuxSyncEvent) => void | Promise<void>;

/* The registry is live from the stub onward so phase lanes can register and
   test against it before SYNC-E's stream lands. Dispatch order inside one
   event name is registration order; SYNC-E's dispatcher must preserve that. */
const handlers = new Map<string, Set<SyncHandler>>();

/** Registration seam (TINT-G pattern): phases register; SYNC-E owns dispatch.
 *  Returns the unregister function. */
export function registerSyncHandler(name: string, handler: SyncHandler): () => void {
  let set = handlers.get(name);
  if (!set) {
    set = new Set();
    handlers.set(name, set);
  }
  set.add(handler);
  return () => {
    set.delete(handler);
    if (set.size === 0) handlers.delete(name);
  };
}

/** Handlers registered for an event name, in registration order. SYNC-E's
 *  dispatcher reads through this; tests may use it to assert registration. */
export function syncHandlersFor(name: string): readonly SyncHandler[] {
  return [...(handlers.get(name) ?? [])];
}

let streamHealthy = false;

/** True while the stream is connected and gap-free; gap/reconnect → SYNC-E
 *  triggers full recollect. */
export function syncStreamHealthy(): boolean {
  return streamHealthy;
}

export const DEFAULT_CMUX_SYNC_CURSOR_FILE = join(
  homedir(),
  ".anthill/cmux-sync.cursor",
);
const CMUX_SYNC_RESTART_DELAY_MS = 1_000;

export type CmuxSyncChild = CmuxEventsChild;
export type SpawnCmuxSync = SpawnCmuxEvents;

export interface CmuxSyncCursorStore {
  load(): Promise<number | undefined>;
  save(cursor: number): Promise<void>;
}

export class FileCmuxSyncCursorStore implements CmuxSyncCursorStore {
  #writeNumber = 0;

  constructor(private readonly path = DEFAULT_CMUX_SYNC_CURSOR_FILE) {}

  async load(): Promise<number | undefined> {
    try {
      const value = Number((await readFile(this.path, "utf8")).trim());
      return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async save(cursor: number): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    this.#writeNumber += 1;
    const temporary = `${this.path}.${process.pid}.${this.#writeNumber}.tmp`;
    await writeFile(temporary, `${cursor}\n`, "utf8");
    await rename(temporary, this.path);
  }
}

export interface CmuxSyncRestartHandle {
  cancel(): void;
}

export type ScheduleCmuxSyncRestart = (
  restart: () => void,
  delayMs: number,
) => CmuxSyncRestartHandle;

const scheduleCmuxSyncRestart: ScheduleCmuxSyncRestart = (restart, delayMs) => {
  const timer = setTimeout(restart, delayMs);
  return { cancel: () => clearTimeout(timer) };
};

export function cmuxSyncCommand(executable: string, cursor: number): string[] {
  return [executable, "events", "--after", String(cursor)];
}

type CmuxSyncFrame =
  | {
      type: "ack";
      resume: {
        afterSeq: number | null;
        gap: boolean;
        latestSeq: number;
        nextSeq: number;
        oldestSeq: number;
      };
    }
  | { type: "event"; event: CmuxSyncEvent };

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function resumeSequence(
  resume: Record<string, unknown>,
  key: "after_seq" | "latest_seq" | "next_seq" | "oldest_seq",
): number {
  const value = resume[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`invalid cmux sync frame: ack resume missing numeric ${key}`);
  }
  return value as number;
}

export function parseCmuxSyncLine(line: string): CmuxSyncFrame | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error("invalid cmux sync frame: invalid JSON");
  }
  const frame = record(parsed);
  if (!frame) throw new Error("invalid cmux sync frame: expected an object");
  if (frame.type === "error") {
    const error = record(frame.error);
    const detail = typeof frame.error === "string"
      ? frame.error
      : typeof error?.message === "string"
        ? error.message
        : undefined;
    throw new Error(`cmux sync stream error${detail ? `: ${detail}` : ""}`);
  }
  if (frame.type === "ack") {
    const resume = record(frame.resume);
    if (!resume) throw new Error("invalid cmux sync frame: ack missing resume metadata");
    if (resume.gap !== true && resume.gap !== false) {
      throw new Error("invalid cmux sync frame: ack resume missing boolean gap");
    }
    const afterSeq = resume.after_seq === null
      ? null
      : resumeSequence(resume, "after_seq");
    return {
      type: "ack",
      resume: {
        afterSeq,
        gap: resume.gap,
        latestSeq: resumeSequence(resume, "latest_seq"),
        nextSeq: resumeSequence(resume, "next_seq"),
        oldestSeq: resumeSequence(resume, "oldest_seq"),
      },
    };
  }
  if (frame.type !== "event") return undefined;
  if (!Number.isSafeInteger(frame.seq) || (frame.seq as number) < 0) {
    throw new Error("invalid cmux sync frame: event missing numeric seq");
  }
  if (typeof frame.name !== "string" || !frame.name.trim()) {
    throw new Error("invalid cmux sync frame: event missing name");
  }
  return {
    type: "event",
    event: {
      seq: frame.seq as number,
      name: frame.name,
      payload: record(frame.payload) ?? {},
    },
  };
}

function reportHandlerError(
  event: CmuxSyncEvent,
  error: unknown,
  onError: (error: Error) => void,
): void {
  const detail = error instanceof Error ? error.message : String(error);
  onError(new Error(`cmux sync handler for ${event.name} failed: ${detail}`));
}

/** Dispatch is deliberately fire-and-forget: one handler cannot delay the next
 *  seq or terminate the stream. Own write echoes are filtered before mutation
 *  handlers can observe them. A workspace rename is the exception because its
 *  event is also the state payload: the title patch must land for our write as
 *  well as a foreign one, and rename handlers are state-only by contract. */
export function dispatchCmuxSyncEvent(
  event: CmuxSyncEvent,
  onError: (error: Error) => void = (error) => console.error(`[cmux-sync] ${error.message}`),
): void {
  if (isOwnEcho(event) && event.name !== "workspace.renamed") return;
  for (const handler of syncHandlersFor(event.name)) {
    try {
      const result = handler(event);
      if (result && typeof result.then === "function") {
        void result.catch((error) => reportHandlerError(event, error, onError));
      }
    } catch (error) {
      reportHandlerError(event, error, onError);
    }
  }
}

async function consumeLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  const consumePending = (): void => {
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
      consumePending();
    }
    pending += decoder.decode();
    consumePending();
    const finalLine = pending.trim();
    if (finalLine) onLine(finalLine);
  } finally {
    reader.releaseLock();
  }
}

export interface CmuxSyncSupervisorOptions {
  executable: string;
  recollect(): void | Promise<void>;
  cursorStore?: CmuxSyncCursorStore;
  spawn?: SpawnCmuxSync;
  scheduleRestart?: ScheduleCmuxSyncRestart;
  onError?(error: Error): void;
}

export interface CmuxSyncRuntime {
  recollect?(): void | Promise<void>;
  cursorStore?: CmuxSyncCursorStore;
  spawn?: SpawnCmuxSync;
  scheduleRestart?: ScheduleCmuxSyncRestart;
  onError?(error: Error): void;
}

type RecoveryState = "none" | "reconnect" | "gap";

/** A separate child from `cmux-events.ts`: that existing supervisor remains a
 *  coarse poll accelerator, while this child owns typed patch dispatch and its
 *  own persisted seq cursor. Keeping the jobs separate avoids widening the old
 *  frame contract or coupling patch correctness to its category filters. */
export class CmuxSyncSupervisor {
  readonly #executable: string;
  readonly #recollect: () => void | Promise<void>;
  readonly #cursorStore: CmuxSyncCursorStore;
  readonly #spawn: SpawnCmuxSync;
  readonly #scheduleRestart: ScheduleCmuxSyncRestart;
  readonly #onError: (error: Error) => void;
  #cursor = 0;
  #cursorWrites: Promise<void> = Promise.resolve();
  #child?: CmuxSyncChild;
  #restart?: CmuxSyncRestartHandle;
  #generation = 0;
  #running = false;
  #awaitingAck = true;
  #recovery: RecoveryState = "none";
  #recollecting?: Promise<boolean>;

  constructor(options: CmuxSyncSupervisorOptions) {
    this.#executable = options.executable;
    this.#recollect = options.recollect;
    this.#cursorStore = options.cursorStore ?? new FileCmuxSyncCursorStore();
    this.#spawn = options.spawn ?? spawnCmuxEvents;
    this.#scheduleRestart = options.scheduleRestart ?? scheduleCmuxSyncRestart;
    this.#onError = options.onError ?? ((error) => console.error(`[cmux-sync] ${error.message}`));
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    streamHealthy = false;
    const generation = ++this.#generation;
    void this.#cursorStore.load().then(
      (cursor) => {
        if (!this.#running || generation !== this.#generation) return;
        this.#cursor = cursor ?? 0;
        this.#launch();
      },
      (error) => {
        if (!this.#running || generation !== this.#generation) return;
        this.#report(error);
        this.#launch();
      },
    );
  }

  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    streamHealthy = false;
    this.#generation += 1;
    this.#restart?.cancel();
    this.#restart = undefined;
    this.#recovery = "none";
    this.#recollecting = undefined;
    const child = this.#child;
    this.#child = undefined;
    if (!child) return;
    try {
      child.kill("SIGTERM");
    } catch {
      // The child already exited.
    }
  }

  #report(error: unknown): void {
    this.#onError(error instanceof Error ? error : new Error(String(error)));
  }

  #saveCursor(cursor: number): void {
    this.#cursorWrites = this.#cursorWrites
      .then(() => this.#cursorStore.save(cursor))
      .catch((error) => this.#report(new Error(
        `cmux sync cursor persistence failed: ${error instanceof Error ? error.message : String(error)}`,
      )));
  }

  #schedule(): void {
    if (!this.#running || this.#restart) return;
    this.#restart = this.#scheduleRestart(() => {
      this.#restart = undefined;
      if (this.#running) this.#launch();
    }, CMUX_SYNC_RESTART_DELAY_MS);
  }

  #launch(): void {
    if (!this.#running) return;
    let child: CmuxSyncChild;
    try {
      child = this.#spawn(cmuxSyncCommand(this.#executable, this.#cursor));
    } catch (error) {
      this.#report(error);
      streamHealthy = false;
      if (this.#recovery === "none") this.#recovery = "reconnect";
      this.#schedule();
      return;
    }
    this.#child = child;
    this.#awaitingAck = true;
    streamHealthy = false;
    const generation = ++this.#generation;
    void consumeLines(child.stdout, (line) => {
      if (!this.#running || generation !== this.#generation) return;
      try {
        const frame = parseCmuxSyncLine(line);
        if (frame) this.#onFrame(frame, child, generation);
      } catch (error) {
        this.#report(error);
      }
    }).catch((error) => this.#streamFailed(child, generation, error));
    if (child.stderr) {
      void consumeLines(child.stderr, (line) => {
        if (this.#running && generation === this.#generation) {
          this.#report(new Error(`cmux sync stderr: ${line}`));
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

  #onFrame(frame: CmuxSyncFrame, child: CmuxSyncChild, generation: number): void {
    if (frame.type === "ack") {
      this.#onAck(frame, child, generation);
      return;
    }
    if (this.#awaitingAck || this.#recovery !== "none" || !streamHealthy) return;
    const event = frame.event;
    if (event.seq <= this.#cursor) return;
    this.#cursor = event.seq;
    this.#saveCursor(event.seq);
    dispatchCmuxSyncEvent(event, this.#onError);
  }

  #onAck(
    frame: Extract<CmuxSyncFrame, { type: "ack" }>,
    child: CmuxSyncChild,
    generation: number,
  ): void {
    if (frame.resume.gap) {
      streamHealthy = false;
      this.#awaitingAck = true;
      this.#recovery = "gap";
      if (frame.resume.latestSeq > this.#cursor) {
        this.#cursor = frame.resume.latestSeq;
        this.#saveCursor(frame.resume.latestSeq);
      }
      void this.#ensureRecollect().then((recollected) => {
        if (!recollected || !this.#running || generation !== this.#generation) return;
        if (child !== this.#child || this.#recovery !== "gap") return;
        this.#child = undefined;
        this.#generation += 1;
        try {
          child.kill("SIGTERM");
        } catch {
          // The gapped child already exited.
        }
        this.#schedule();
      });
      return;
    }

    if (this.#recovery === "none") {
      this.#awaitingAck = false;
      streamHealthy = true;
      return;
    }
    void this.#ensureRecollect().then((recollected) => {
      if (!recollected || !this.#running || generation !== this.#generation) return;
      if (child !== this.#child) return;
      this.#recovery = "none";
      this.#recollecting = undefined;
      this.#awaitingAck = false;
      streamHealthy = true;
    });
  }

  #ensureRecollect(): Promise<boolean> {
    if (this.#recollecting) return this.#recollecting;
    this.#recollecting = Promise.resolve()
      .then(() => this.#recollect())
      .then(() => true)
      .catch((error) => {
        this.#report(new Error(
          `cmux sync recollect failed: ${error instanceof Error ? error.message : String(error)}`,
        ));
        this.#recollecting = undefined;
        return false;
      });
    return this.#recollecting;
  }

  #streamFailed(child: CmuxSyncChild, generation: number, error: unknown): void {
    if (!this.#running || generation !== this.#generation || child !== this.#child) return;
    this.#report(error);
    this.#child = undefined;
    this.#generation += 1;
    streamHealthy = false;
    if (this.#recovery === "none") this.#recovery = "reconnect";
    else if (this.#recovery === "reconnect") void this.#ensureRecollect();
    try {
      child.kill("SIGTERM");
    } catch {
      // The failed child already exited.
    }
    this.#schedule();
  }

  #exited(child: CmuxSyncChild, generation: number, exitCode: number): void {
    if (!this.#running || generation !== this.#generation || child !== this.#child) return;
    this.#child = undefined;
    this.#generation += 1;
    streamHealthy = false;
    this.#report(new Error(`cmux sync child exited with code ${exitCode}`));
    if (this.#recovery === "none") this.#recovery = "reconnect";
    else if (this.#recovery === "reconnect") void this.#ensureRecollect();
    this.#schedule();
  }
}
