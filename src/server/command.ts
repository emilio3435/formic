import type { CommandResult, CommandRunner } from "./types";

export class BunCommandRunner implements CommandRunner {
  async run(command: readonly string[], timeoutMs = 8_000): Promise<CommandResult> {
    try {
      const process = Bun.spawn([...command], { stdout: "pipe", stderr: "pipe" });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        process.kill();
      }, timeoutMs);

      const [stdout, stderr, exitCode] = await Promise.all([
        Bun.readableStreamToText(process.stdout as ReadableStream<Uint8Array>),
        Bun.readableStreamToText(process.stderr as ReadableStream<Uint8Array>),
        process.exited,
      ]).finally(() => clearTimeout(timer));

      return { exitCode, stdout, stderr, timedOut };
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
