import type { CommandResult, CommandRunner } from "./types";

export class BunCommandRunner implements CommandRunner {
  async run(command: readonly string[], timeoutMs = 8_000): Promise<CommandResult> {
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
      const result = await Promise.race([work, deadline]);
      if (!result.timedOut) clearTimeout(deadlineTimer!);
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
