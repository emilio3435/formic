import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  defaultHookStoreRoot,
  extractSessionIdFromArgs,
  HOOK_STORE_PROVIDERS,
  hookStorePath,
  recordMatchesParserContract,
  upsertHookSessionRecord,
} from "../scripts/cmux-hook-store";

const PROJECT_ROOT = join(import.meta.dir, "..");
const FIXTURE_ROOT = join(import.meta.dir, "fixtures", "cmux-hook-sessions");
const REAL_CMUXTERM = join(process.env.HOME ?? "", ".cmuxterm");
const SCRATCH_ROOT = `/private/tmp/claude-501/anthill-hook-shim-tests-${process.pid}`;

function freshFixture(name: string): string {
  const root = join(SCRATCH_ROOT, name);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  return root;
}

function writeExecutable(path: string, contents: string): void {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function run(
  command: string[],
  cwd: string,
  env: Record<string, string>,
): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(command, {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function assertNeverTouchesRealCmuxterm(root: string): void {
  expect(root.startsWith(SCRATCH_ROOT)).toBeTrue();
  expect(root).not.toBe(REAL_CMUXTERM);
  expect(root.startsWith(REAL_CMUXTERM + "/")).toBeFalse();
}

afterAll(() => {
  rmSync(SCRATCH_ROOT, { recursive: true, force: true });
});

describe("cmux hook-store writer (T8)", () => {
  test("defaultHookStoreRoot honors ANTHILL_CMUXTERM_ROOT over ~/.cmuxterm", () => {
    const root = "/tmp/anthill-hook-root-override";
    expect(defaultHookStoreRoot({ ANTHILL_CMUXTERM_ROOT: root })).toBe(root);
    expect(defaultHookStoreRoot({ ANTHILL_CMUXTERM_ROOT: "  " })).toBe(REAL_CMUXTERM);
  });

  test("extractSessionIdFromArgs reads cursor, factory, and Grok resume forms", () => {
    const id = "019fcd73-1a2b-7000-9c4d-5e6f70819aab";
    expect(extractSessionIdFromArgs("cursor", ["--resume", id, "hi"])).toBe(id);
    expect(extractSessionIdFromArgs("cursor", [`--resume=${id}`])).toBe(id);
    expect(extractSessionIdFromArgs("cursor", ["--resume"])).toBeUndefined();
    expect(extractSessionIdFromArgs("factory", ["-r", id])).toBe(id);
    expect(extractSessionIdFromArgs("factory", ["--resume", id])).toBe(id);
    expect(extractSessionIdFromArgs("factory", ["--fork", id])).toBe(id);
    expect(extractSessionIdFromArgs("factory", ["--auto", "high"])).toBeUndefined();
    expect(extractSessionIdFromArgs("grok", ["-r", id])).toBe(id);
    expect(extractSessionIdFromArgs("grok", ["--resume", id])).toBe(id);
    expect(extractSessionIdFromArgs("grok", [`--resume=${id}`])).toBe(id);
    expect(extractSessionIdFromArgs("grok", ["-c"])).toBeUndefined();
    expect(HOOK_STORE_PROVIDERS).toContain("grok");
  });

  test("upsert writes parser-contract records under a temp root only", () => {
    const root = freshFixture("upsert-cursor");
    assertNeverTouchesRealCmuxterm(root);

    const path = upsertHookSessionRecord(root, "cursor", {
      sessionId: "c1111111-2222-4333-8444-555555555555",
      surfaceId: "CAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
      workspaceId: "c1111111-AAAA-4BBB-8CCC-222222222222",
      cwd: "/tmp/project",
      pid: 4242,
      agentLifecycle: "unknown",
      updatedAt: 1785933010.5,
      launchCommand: {
        executablePath: "/Users/example/.local/bin/cursor-agent",
        arguments: ["--resume", "c1111111-2222-4333-8444-555555555555"],
        workingDirectory: "/tmp/project",
      },
    });

    expect(path).toBe(hookStorePath(root, "cursor"));
    const store = JSON.parse(readFileSync(path, "utf8")) as {
      sessions: Record<string, Record<string, unknown>>;
      activeSessionsBySurface: Record<string, { sessionId: string }>;
    };
    const record = store.sessions["c1111111-2222-4333-8444-555555555555"]!;
    expect(recordMatchesParserContract(record)).toBeTrue();
    expect(record).toMatchObject({
      sessionId: "c1111111-2222-4333-8444-555555555555",
      surfaceId: "CAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
      workspaceId: "c1111111-AAAA-4BBB-8CCC-222222222222",
      cwd: "/tmp/project",
      pid: 4242,
      agentLifecycle: "unknown",
      updatedAt: 1785933010.5,
    });
    expect(store.activeSessionsBySurface["CAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE"]?.sessionId)
      .toBe("c1111111-2222-4333-8444-555555555555");
  });

  test("golden cursor/factory fixtures satisfy the parser contract", () => {
    for (const provider of ["cursor", "factory"] as const) {
      const store = JSON.parse(
        readFileSync(join(FIXTURE_ROOT, `${provider}-hook-sessions.json`), "utf8"),
      ) as { sessions: Record<string, Record<string, unknown>> };
      const records = Object.values(store.sessions);
      expect(records.length).toBeGreaterThan(0);
      for (const record of records) {
        expect(recordMatchesParserContract(record)).toBeTrue();
      }
    }
  });
});

describe("anthill cursor-agent / droid / grok shims (T8)", () => {
  test("cursor-agent shim binds a resume session into a temp hook store", () => {
    const root = freshFixture("shim-cursor");
    const fakeBin = join(root, "fake-bin");
    const hookRoot = join(root, "cmuxterm");
    const marker = join(root, "ran.txt");
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(hookRoot, { recursive: true });
    assertNeverTouchesRealCmuxterm(hookRoot);

    writeExecutable(
      join(fakeBin, "cursor-agent"),
      "#!/bin/bash\nprintf 'cursor-ran\\n' > \"$MARKER\"\nexit 0\n",
    );

    const sessionId = "c1111111-2222-4333-8444-555555555555";
    const result = run(
      [join(PROJECT_ROOT, "scripts/anthill-cursor-agent"), "--resume", sessionId, "hello"],
      root,
      {
        PATH: `${fakeBin}:/usr/bin:/bin`,
        HOME: join(root, "home"),
        MARKER: marker,
        ANTHILL_CMUXTERM_ROOT: hookRoot,
        ANTHILL_CURSOR_AGENT_BIN: join(fakeBin, "cursor-agent"),
        CMUX_SURFACE_ID: "CAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
        CMUX_WORKSPACE_ID: "c1111111-AAAA-4BBB-8CCC-222222222222",
        BUN_BIN: process.execPath.includes("bun") ? process.execPath : "bun",
      },
    );

    expect(result.exitCode).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("cursor-ran\n");

    const storePath = join(hookRoot, "cursor-hook-sessions.json");
    const store = JSON.parse(readFileSync(storePath, "utf8")) as {
      sessions: Record<string, Record<string, unknown>>;
    };
    const record = store.sessions[sessionId]!;
    expect(recordMatchesParserContract(record)).toBeTrue();
    expect(record.agentLifecycle).toBe("ended");
    expect(record.surfaceId).toBe("CAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE");
    expect(record.workspaceId).toBe("c1111111-AAAA-4BBB-8CCC-222222222222");
    expect(typeof record.pid).toBe("number");
    expect(record.pid as number).toBeGreaterThan(0);
  });

  test("cursor-agent shim keeps an interactive agent in the terminal foreground", () => {
    const root = freshFixture("shim-cursor-interactive");
    const fakeBin = join(root, "fake-bin");
    const hookRoot = join(root, "cmuxterm");
    const marker = join(root, "foreground.txt");
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(hookRoot, { recursive: true });
    assertNeverTouchesRealCmuxterm(hookRoot);

    writeExecutable(
      join(fakeBin, "cursor-agent"),
      [
        "#!/bin/bash",
        "if [[ -t 0 ]]; then",
        "  printf 'foreground\\n' > \"$MARKER\"",
        "  sleep 0.5",
        "  exit 0",
        "fi",
        "printf 'background\\n' > \"$MARKER\"",
        "exit 42",
        "",
      ].join("\n"),
    );

    const sessionId = "c2222222-3333-4444-8555-666666666666";
    const result = run(
      [
        "/usr/bin/script",
        "-q",
        "-e",
        "/dev/null",
        join(PROJECT_ROOT, "scripts/anthill-cursor-agent"),
        "agent",
        "--resume",
        sessionId,
      ],
      root,
      {
        PATH: `${fakeBin}:/usr/bin:/bin`,
        HOME: join(root, "home"),
        MARKER: marker,
        TERM: "xterm-256color",
        ANTHILL_CMUXTERM_ROOT: hookRoot,
        ANTHILL_CURSOR_AGENT_BIN: join(fakeBin, "cursor-agent"),
        CMUX_SURFACE_ID: "CBBBBBBB-CCCC-4DDD-8EEE-FFFFFFFFFFFF",
        CMUX_WORKSPACE_ID: "c2222222-BBBB-4CCC-8DDD-333333333333",
        BUN_BIN: process.execPath.includes("bun") ? process.execPath : "bun",
      },
    );

    expect(result.exitCode).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("foreground\n");
    const store = JSON.parse(
      readFileSync(join(hookRoot, "cursor-hook-sessions.json"), "utf8"),
    ) as { sessions: Record<string, Record<string, unknown>> };
    expect(store.sessions[sessionId]).toMatchObject({ agentLifecycle: "ended" });
  });

  test("droid shim binds -r session into factory-hook-sessions.json under temp root", () => {
    const root = freshFixture("shim-droid");
    const fakeBin = join(root, "fake-bin");
    const hookRoot = join(root, "cmuxterm");
    const marker = join(root, "ran.txt");
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(hookRoot, { recursive: true });
    assertNeverTouchesRealCmuxterm(hookRoot);

    writeExecutable(
      join(fakeBin, "droid"),
      "#!/bin/bash\nprintf 'droid-ran\\n' > \"$MARKER\"\nexit 0\n",
    );

    const sessionId = "f1111111-2222-4333-8444-555555555555";
    const result = run(
      [join(PROJECT_ROOT, "scripts/anthill-droid"), "-r", sessionId],
      root,
      {
        PATH: `${fakeBin}:/usr/bin:/bin`,
        HOME: join(root, "home"),
        MARKER: marker,
        ANTHILL_CMUXTERM_ROOT: hookRoot,
        ANTHILL_DROID_BIN: join(fakeBin, "droid"),
        CMUX_SURFACE_ID: "FAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
        CMUX_WORKSPACE_ID: "f1111111-AAAA-4BBB-8CCC-222222222222",
        BUN_BIN: process.execPath.includes("bun") ? process.execPath : "bun",
      },
    );

    expect(result.exitCode).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("droid-ran\n");

    const store = JSON.parse(
      readFileSync(join(hookRoot, "factory-hook-sessions.json"), "utf8"),
    ) as { sessions: Record<string, Record<string, unknown>> };
    const record = store.sessions[sessionId]!;
    expect(recordMatchesParserContract(record)).toBeTrue();
    expect(record.agentLifecycle).toBe("ended");
    expect(record.cwd).toBe(root);
  });

  test("grok shim keeps an interactive resumed session in the foreground", () => {
    const root = freshFixture("shim-grok-interactive");
    const fakeBin = join(root, "fake-bin");
    const hookRoot = join(root, "cmuxterm");
    const marker = join(root, "foreground.txt");
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(hookRoot, { recursive: true });
    assertNeverTouchesRealCmuxterm(hookRoot);

    writeExecutable(
      join(fakeBin, "grok"),
      [
        "#!/bin/bash",
        "if [[ -t 0 ]]; then",
        "  printf 'foreground\\n' > \"$MARKER\"",
        "  sleep 0.5",
        "  exit 0",
        "fi",
        "printf 'background\\n' > \"$MARKER\"",
        "exit 42",
        "",
      ].join("\n"),
    );

    const sessionId = "a2222222-3333-4444-8555-666666666666";
    const result = run(
      [
        "/usr/bin/script",
        "-q",
        "-e",
        "/dev/null",
        join(PROJECT_ROOT, "scripts/anthill-grok"),
        "-r",
        sessionId,
      ],
      root,
      {
        PATH: `${fakeBin}:/usr/bin:/bin`,
        HOME: join(root, "home"),
        MARKER: marker,
        TERM: "xterm-256color",
        ANTHILL_CMUXTERM_ROOT: hookRoot,
        ANTHILL_GROK_BIN: join(fakeBin, "grok"),
        CMUX_SURFACE_ID: "GAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
        CMUX_WORKSPACE_ID: "a2222222-AAAA-4BBB-8CCC-222222222222",
        BUN_BIN: process.execPath.includes("bun") ? process.execPath : "bun",
      },
    );

    expect(result.exitCode).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("foreground\n");
    const store = JSON.parse(
      readFileSync(join(hookRoot, "grok-hook-sessions.json"), "utf8"),
    ) as { sessions: Record<string, Record<string, unknown>> };
    expect(store.sessions[sessionId]).toMatchObject({ agentLifecycle: "ended" });
  });

  test("shim passes through without writing when CMUX_* identity is absent", () => {
    const root = freshFixture("shim-passthrough");
    const fakeBin = join(root, "fake-bin");
    const hookRoot = join(root, "cmuxterm");
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(hookRoot, { recursive: true });
    assertNeverTouchesRealCmuxterm(hookRoot);

    writeExecutable(
      join(fakeBin, "cursor-agent"),
      "#!/bin/bash\nexit 0\n",
    );

    const result = run(
      [
        join(PROJECT_ROOT, "scripts/anthill-cursor-agent"),
        "--resume",
        "c1111111-2222-4333-8444-555555555555",
      ],
      root,
      {
        PATH: `${fakeBin}:/usr/bin:/bin`,
        HOME: join(root, "home"),
        ANTHILL_CMUXTERM_ROOT: hookRoot,
        ANTHILL_CURSOR_AGENT_BIN: join(fakeBin, "cursor-agent"),
        BUN_BIN: process.execPath.includes("bun") ? process.execPath : "bun",
      },
    );

    expect(result.exitCode).toBe(0);
    expect(Bun.file(join(hookRoot, "cursor-hook-sessions.json")).size).toBe(0);
  });
});
