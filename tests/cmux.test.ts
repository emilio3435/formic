import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, spyOn, test } from "bun:test";
import {
  collectCmux,
  collectCmuxNotificationSummaries,
  collectCmuxNotifications,
  collectCmuxSidebar,
  DEFAULT_CMUX_EXECUTABLE,
  JsonAttentionStore,
  MemoryAttentionStore,
  parseCmuxSidebarSnapshot,
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

  test("preserves provider qualification beside legacy session fields", () => {
    const sessionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const [surface] = parseCmuxTerminals(discovery({
      session_id: sessionId,
      claude_session_id: sessionId,
    }));

    expect(surface?.sourceSessionIds).toEqual([sessionId]);
    expect(surface?.sourceSessionClaims).toEqual([
      { sessionId },
      { provider: "claude", sessionId },
    ]);
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

describe("persisted notification attention state", () => {
  const first = {
    id: "notice-1",
    surfaceId: "SURFACE-1",
    createdAt: "2026-07-28T09:00:00.000Z",
    body: "First request",
  };
  const newer = {
    ...first,
    id: "notice-2",
    createdAt: "2026-07-28T09:05:00.000Z",
    body: "New request",
  };

  test("acknowledgement suppresses current notifications but not a newer one", async () => {
    const store = new MemoryAttentionStore(() => Date.parse("2026-07-28T09:01:00.000Z"));
    store.observe([first]);
    await store.apply("SURFACE-1", "acknowledge");

    expect(store.filter([first])).toEqual([]);
    store.observe([first, newer]);
    expect(store.filter([first, newer])).toEqual([newer]);
  });

  test("notification collection applies persisted acknowledgement before snapshot input", async () => {
    const store = new MemoryAttentionStore(() => Date.parse("2026-07-28T09:01:00.000Z"));
    const runner: CommandRunner = {
      run: async () => ({
        exitCode: 0,
        stdout: JSON.stringify([{
          id: first.id,
          surface_id: first.surfaceId,
          created_at: first.createdAt,
          body: first.body,
        }]),
        stderr: "",
        timedOut: false,
      }),
    };
    const initial = await collectCmuxNotifications(runner, "cmux", store);
    expect(initial.value).toHaveLength(1);
    await store.apply(first.surfaceId, "acknowledge");

    const acknowledged = await collectCmuxNotifications(runner, "cmux", store);
    expect(acknowledged).toEqual({ value: [], errors: [] });
  });

  test("snooze expires from the clock without a clearing mutation", async () => {
    let now = Date.parse("2026-07-28T09:01:00.000Z");
    const store = new MemoryAttentionStore(() => now);
    store.observe([first]);
    await store.apply("SURFACE-1", "snooze", "2026-07-28T09:10:00.000Z");

    expect(store.filter([first])).toEqual([]);
    now = Date.parse("2026-07-28T09:10:00.001Z");
    expect(store.filter([first])).toEqual([first]);
  });

  test("bounds persisted dispositions to the 500 newest surfaces", async () => {
    let now = Date.parse("2026-07-28T09:01:00.000Z");
    const store = new MemoryAttentionStore(() => now++);
    for (let index = 0; index < 501; index += 1) {
      const notification = {
        id: `notice-${index}`,
        surfaceId: `SURFACE-${index}`,
        createdAt: new Date(now).toISOString(),
      };
      store.observe([notification]);
      await store.apply(notification.surfaceId, "acknowledge");
    }

    expect(store.list()).toHaveLength(500);
    expect(store.get("SURFACE-0")).toBeUndefined();
    expect(store.get("SURFACE-500")).toBeDefined();
  });

  test("attention records survive reopen and corrupt state degrades loudly to empty", async () => {
    const directory = await mkdtemp(join(tmpdir(), "anthill-attention-"));
    const path = join(directory, "attention.json");
    const now = () => Date.parse("2026-07-28T09:01:00.000Z");
    try {
      const store = await JsonAttentionStore.open(path, now);
      store.observe([first]);
      await store.apply("SURFACE-1", "dismiss");
      const reopened = await JsonAttentionStore.open(path, now);
      expect(reopened.filter([first])).toEqual([]);

      const expired = await JsonAttentionStore.open(
        path,
        () => now() + 8 * 24 * 60 * 60 * 1_000,
      );
      expect(expired.list()).toEqual([]);

      /* Empty attention state is not neutral: everything the operator already
         acknowledged is unread again, so the board asks for attention it was
         previously given. Starting empty is right, but the console must not be
         the only witness — /api/health carries this to the operator. */
      await writeFile(path, "{");
      const logged = spyOn(console, "error").mockImplementation(() => {});
      try {
        const recovered = await JsonAttentionStore.open(path, now);
        expect(recovered.list()).toEqual([]);
        expect(logged).toHaveBeenCalledWith(expect.stringContaining("could not be read"));
        expect(recovered.loadError() ?? "").toContain("unread again");
      } finally {
        logged.mockRestore();
      }

      // And state that was simply never written is not a failure.
      const fresh = await JsonAttentionStore.open(join(directory, "never-written.json"), now);
      expect(fresh.loadError()).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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

describe("cmux sidebar repository facts", () => {
  const sidebarSnapshot = readFileSync(
    join(import.meta.dir, "fixtures/cmux-sidebar/sidebar-snapshot.json"),
    "utf8",
  );

  test("maps the installed sidebar snapshot shape to live repository facts", () => {
    expect(parseCmuxSidebarSnapshot(sidebarSnapshot)).toEqual([{
      workspaceId: "WORKSPACE-1",
      projectRootPath: "/Users/example/Developer/ProjectAtlas",
      branch: "feature/atlas",
      dirty: true,
      pullRequestUrls: ["https://github.com/example/atlas/pull/42"],
    }]);
  });

  test("collects sidebar repository facts through the caller window id", async () => {
    const commands: readonly string[][] = [];
    const runner: CommandRunner = {
      run: async (command) => {
        (commands as string[][]).push([...command]);
        return {
          exitCode: 0,
          stdout: command[2] === "window.list"
            ? JSON.stringify({ windows: [{ id: "WINDOW-1" }] })
            : sidebarSnapshot,
          stderr: "",
          timedOut: false,
        };
      },
    };

    await expect(collectCmuxSidebar(runner, "cmux")).resolves.toEqual({
      value: [{
        workspaceId: "WORKSPACE-1",
        projectRootPath: "/Users/example/Developer/ProjectAtlas",
        branch: "feature/atlas",
        dirty: true,
        pullRequestUrls: ["https://github.com/example/atlas/pull/42"],
      }],
      errors: [],
    });
    expect(commands).toEqual([
      ["cmux", "rpc", "window.list", "{}"],
      ["cmux", "rpc", "workspace.list", '{"window_id":"WINDOW-1"}'],
    ]);
  });

  test("enumerates every cmux window before collecting workspaces", async () => {
    const commands: string[][] = [];
    const runner: CommandRunner = {
      run: async (command) => {
        commands.push([...command]);
        const method = command[2];
        const params = command[3];
        if (method === "window.list") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({ windows: [{ id: "WINDOW-A" }, { id: "WINDOW-B" }] }),
            stderr: "",
            timedOut: false,
          };
        }
        if (method === "workspace.list" && params === '{"window_id":"WINDOW-A"}') {
          return {
            exitCode: 0,
            stdout: JSON.stringify({ workspaces: [{ id: "WORKSPACE-A", project_root_path: "/tmp/a" }] }),
            stderr: "",
            timedOut: false,
          };
        }
        if (method === "workspace.list" && params === '{"window_id":"WINDOW-B"}') {
          return {
            exitCode: 0,
            stdout: JSON.stringify({ workspaces: [{ id: "WORKSPACE-B", project_root_path: "/tmp/b" }] }),
            stderr: "",
            timedOut: false,
          };
        }
        return { exitCode: 1, stdout: "", stderr: `unexpected ${method} ${params}`, timedOut: false };
      },
    };

    const result = await collectCmuxSidebar(runner, "cmux");

    expect(result.value.map(({ workspaceId }) => workspaceId).sort()).toEqual([
      "WORKSPACE-A",
      "WORKSPACE-B",
    ]);
    expect(result.errors).toEqual([]);
    expect(commands).toEqual([
      ["cmux", "rpc", "window.list", "{}"],
      ["cmux", "rpc", "workspace.list", '{"window_id":"WINDOW-A"}'],
      ["cmux", "rpc", "workspace.list", '{"window_id":"WINDOW-B"}'],
    ]);
  });
});

describe("cmux collector budgets fit their parent deadline", () => {
  test("notification summary RPCs divide one parent deadline across three sequential stages", async () => {
    const timeouts: number[] = [];
    const runner: CommandRunner = {
      run: async (command, timeoutMs) => {
        timeouts.push(timeoutMs ?? 0);
        const method = command[2];
        return {
          exitCode: 0,
          stdout: method === "notification.list"
            ? JSON.stringify({ notifications: [] })
            : method === "window.list"
              ? JSON.stringify({ windows: [{ id: "WINDOW-1" }] })
              : JSON.stringify({ groups: [] }),
          stderr: "",
          timedOut: false,
        };
      },
    };
    await collectCmuxNotificationSummaries(runner, "cmux", { deadlineMs: 900 });

    expect(timeouts).toEqual([300, 300, 300]);
  });

  test("sidebar RPCs divide one parent deadline across its two sequential stages", async () => {
    const timeouts: number[] = [];
    const runner: CommandRunner = {
      run: async (command, timeoutMs) => {
        timeouts.push(timeoutMs ?? 0);
        return {
          exitCode: 0,
          stdout: command[2] === "window.list"
            ? JSON.stringify({ windows: [{ id: "WINDOW-1" }] })
            : JSON.stringify({ workspaces: [] }),
          stderr: "",
          timedOut: false,
        };
      },
    };
    await collectCmuxSidebar(runner, "cmux", { deadlineMs: 600 });

    expect(timeouts).toEqual([300, 300]);
  });

  test("aborting notification summaries stops before another sequential RPC starts", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const runner: CommandRunner = {
      run: (command) => {
        calls.push(command[2] ?? "");
        return new Promise(() => {});
      },
    };

    const collecting = collectCmuxNotificationSummaries(runner, "cmux", {
      deadlineMs: 900,
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort(new Error("test cancellation"));

    await expect(collecting).rejects.toThrow("test cancellation");
    expect(calls).toEqual(["notification.list"]);
  });
});
