import type { CommandResult, CommandRunner } from "./types";

export class BunCommandRunner implements CommandRunner {
  async run(command: readonly string[], timeoutMs = 8_000, signal?: AbortSignal): Promise<CommandResult> {
    /* Nothing has been spawned yet, so there is nothing to kill — and spawning
       only to immediately signal it is how a pid gets recycled out from under
       the terminate call. */
    if (signal?.aborted) {
      return { exitCode: -1, stdout: "", stderr: "command cancelled before it started", timedOut: false, cancelled: true };
    }
    try {
      const subprocess = Bun.spawn([...command], {
        stdout: "pipe",
        stderr: "pipe",
        detached: true,
      });
      const terminate = (signal: "SIGTERM" | "SIGKILL"): void => {
        try {
          process.kill(-subprocess.pid, signal);
        } catch {
          try {
            subprocess.kill(signal);
          } catch {
            // The process group already exited.
          }
        }
      };
      const work = Promise.all([
        Bun.readableStreamToText(subprocess.stdout as ReadableStream<Uint8Array>),
        Bun.readableStreamToText(subprocess.stderr as ReadableStream<Uint8Array>),
        subprocess.exited,
      ]).then(([stdout, stderr, exitCode]) => ({
        exitCode,
        stdout,
        stderr,
        timedOut: false,
      }));
      let deadlineTimer: ReturnType<typeof setTimeout>;
      const deadline = new Promise<CommandResult>((resolve) => {
        deadlineTimer = setTimeout(() => {
          terminate("SIGTERM");
          setTimeout(() => terminate("SIGKILL"), 250);
          resolve({
            exitCode: -1,
            stdout: "",
            stderr: `command timed out after ${timeoutMs}ms`,
            timedOut: true,
          });
        }, timeoutMs);
      });
      /* The same terminate the deadline uses, on the same process group. The
         point of accepting a signal is that the CHILD stops, not merely that we
         stop waiting for it — a superseded pass whose `lsof` keeps running has
         not been cancelled, it has been ignored, and it still competes with the
         pass that replaced it. */
      let onAbort: (() => void) | undefined;
      const cancellation = signal
        ? new Promise<CommandResult>((resolve) => {
            onAbort = (): void => {
              terminate("SIGTERM");
              setTimeout(() => terminate("SIGKILL"), 250);
              resolve({
                exitCode: -1,
                stdout: "",
                stderr: "command cancelled",
                timedOut: false,
                cancelled: true,
              });
            };
            signal.addEventListener("abort", onAbort, { once: true });
          })
        : undefined;
      let result: CommandResult;
      try {
        result = await Promise.race(cancellation ? [work, deadline, cancellation] : [work, deadline]);
      } finally {
        // A rejected pipe read must not leave the deadline armed: it would hold
        // the event loop open and later signal a process group this call no
        // longer owns, since the pid can be recycled once the child is reaped.
        clearTimeout(deadlineTimer!);
        if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      }
      return result;
    } catch (error) {
      return {
        exitCode: -1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        timedOut: false,
      };
    }
  }
}
