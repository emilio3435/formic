import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hookRecordFor,
  readHookSessionStores,
} from "../src/server/cmux-hook-sessions";

const fixtureRoot = join(import.meta.dir, "fixtures", "cmux-hook-sessions");
const temporaryRoots: string[] = [];

function storeRoot(contents: string): string {
  const root = mkdtempSync(join(tmpdir(), "anthill-hook-sessions-"));
  temporaryRoots.push(root);
  writeFileSync(join(root, "claude-hook-sessions.json"), contents);
  return root;
}

beforeEach(() => {
  readHookSessionStores(fixtureRoot);
});

afterEach(() => {
  readHookSessionStores(join(fixtureRoot, "missing"));
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("cmux hook-session stores", () => {
  test("readHookSessionStores parses claude store and normalizes provider", () => {
    expect(readHookSessionStores(fixtureRoot)).toEqual([
      {
        provider: "claude",
        sessionId: "11111111-2222-4333-8444-555555555555",
        surfaceId: "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
        workspaceId: "11111111-AAAA-4BBB-8CCC-222222222222",
        cwd: "/Users/example/Developer/redacted-project",
        pid: 4242,
        pidStartSeconds: 1785933001,
        transcriptPath: "/Users/example/.claude/projects/redacted/session-running.jsonl",
        agentLifecycle: "running",
        lastPermissionMode: "auto",
        launchCommand: {
          executablePath: "/Users/example/.local/bin/claude",
          arguments: ["--permission-mode", "auto"],
          workingDirectory: "/Users/example/Developer/redacted-project",
        },
        updatedAt: 1785933010.5,
      },
      {
        provider: "claude",
        sessionId: "66666666-7777-4888-8999-AAAAAAAAAAAA",
        surfaceId: "FFFFFFFF-1111-4222-8333-444444444444",
        workspaceId: "33333333-DDDD-4EEE-8FFF-555555555555",
        cwd: "/Users/example/Developer/redacted-project-worktree",
        pid: 4343,
        transcriptPath: "/Users/example/.claude/projects/redacted/session-idle.jsonl",
        agentLifecycle: "idle",
        lastPermissionMode: "default",
        updatedAt: 1785933020.75,
      },
    ]);
  });

  test("hookRecordFor returns undefined for unknown session", () => {
    expect(hookRecordFor("claude", "unknown-session")).toBeUndefined();
  });

  test("malformed store file yields [] and does not throw", () => {
    const root = storeRoot("{not-json");
    expect(() => readHookSessionStores(root)).not.toThrow();
    expect(readHookSessionStores(root)).toEqual([]);
  });

  test("record with missing surfaceId is dropped", () => {
    const root = storeRoot(JSON.stringify({
      version: 1,
      sessions: {
        "missing-surface": {
          sessionId: "missing-surface",
          workspaceId: "workspace-1",
          cwd: "/tmp/project",
          pid: 4242,
          agentLifecycle: "running",
          updatedAt: 1785933010.5,
        },
      },
    }));

    expect(readHookSessionStores(root)).toEqual([]);
  });
});
