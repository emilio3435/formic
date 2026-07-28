import { describe, expect, test } from "bun:test";
import {
  collectCmux,
  collectCmuxNotifications,
  DEFAULT_CMUX_EXECUTABLE,
  parseCmuxTerminals,
  runtimeCmuxExecutable,
} from "../src/server/cmux";
import type { CommandRunner } from "../src/server/types";

function discovery(terminal: Record<string, unknown>): string {
  return JSON.stringify({ terminals: [{ surface_id: "SURFACE-1", ...terminal }] });
}

describe("parseCmuxTerminals — the surface rename becomes the terminal title", () => {
  test("captures surface_title into title so the operator's /rename enters the model", () => {
    const [surface] = parseCmuxTerminals(discovery({ surface_title: "cmux-session-restore-debug" }));
    expect(surface?.title).toBe("cmux-session-restore-debug");
  });

  test("strips the leading live-status glyph/spinner from an active surface title", () => {
    // cmux prefixes an active surface with a braille spinner frame; the operator's
    // rename is the words after it, never the glyph.
    const [surface] = parseCmuxTerminals(discovery({ surface_title: "⠂ cmux-session-restore-debug" }));
    expect(surface?.title).toBe("cmux-session-restore-debug");
    expect(surface?.title).not.toContain("⠂");
  });

  test("strips ▪/● status markers too and leaves an untitled surface without a title", () => {
    const [marker] = parseCmuxTerminals(discovery({ surface_title: "● Ridge worker" }));
    expect(marker?.title).toBe("Ridge worker");

    const [untitled] = parseCmuxTerminals(discovery({}));
    expect(untitled?.title).toBeUndefined();

    const [glyphOnly] = parseCmuxTerminals(discovery({ surface_title: "⠂ " }));
    expect(glyphOnly?.title).toBeUndefined();
  });
});

describe("runtime cmux executable", () => {
  test("uses a configured executable and otherwise preserves the default", () => {
    expect(runtimeCmuxExecutable("/opt/cmux/bin/cmux")).toBe("/opt/cmux/bin/cmux");
    expect(runtimeCmuxExecutable("  ")).toBe(DEFAULT_CMUX_EXECUTABLE);
  });
});

describe("cmux timeout results", () => {
  test("terminal and notification timeouts are errors rather than successful empty polls", async () => {
    const commands: readonly string[][] = [];
    const runner: CommandRunner = {
      run: async (command) => {
        (commands as string[][]).push([...command]);
        return { exitCode: 0, stdout: "", stderr: "", timedOut: true };
      },
    };

    await expect(collectCmux(runner, "cmux")).resolves.toEqual({
      value: [],
      errors: ["cmux terminal discovery timed out"],
    });
    await expect(collectCmuxNotifications(runner, "cmux")).resolves.toEqual({
      value: [],
      errors: ["cmux notification discovery timed out"],
    });
    expect(commands).toHaveLength(2);
  });
});

describe("cmux terminal discovery outcomes", () => {
  test("reports a non-zero discovery exit with stderr", async () => {
    const runner: CommandRunner = {
      run: async () => ({
        exitCode: 17,
        stdout: "",
        stderr: "socket unavailable",
        timedOut: false,
      }),
    };

    await expect(collectCmux(runner, "cmux")).resolves.toEqual({
      value: [],
      errors: ["cmux terminal discovery exited 17: socket unavailable"],
    });
  });

  test("reports invalid discovery output as an error", async () => {
    const runner: CommandRunner = {
      run: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({ result: {} }),
        stderr: "",
        timedOut: false,
      }),
    };

    const result = await collectCmux(runner, "cmux");
    expect(result.value).toEqual([]);
    expect(result.errors).toEqual([
      "cmux terminal discovery returned invalid JSON: cmux response did not contain a terminals array",
    ]);
  });

  test("returns parsed terminals and uses the bounded discovery command", async () => {
    const calls: { command: readonly string[]; timeoutMs?: number }[] = [];
    const runner: CommandRunner = {
      run: async (command, timeoutMs) => {
        calls.push({ command: [...command], timeoutMs });
        return {
          exitCode: 0,
          stdout: discovery({ surface_title: "Ridge worker" }),
          stderr: "",
          timedOut: false,
        };
      },
    };

    const result = await collectCmux(runner, "cmux");

    expect(result).toMatchObject({
      value: [{ surfaceId: "SURFACE-1", title: "Ridge worker" }],
      errors: [],
    });
    expect(calls).toEqual([{
      command: ["cmux", "rpc", "debug.terminals", "{}"],
      timeoutMs: 10_000,
    }]);
  });
});
