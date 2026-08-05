import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hookRecordFor,
  readHookSessionStores,
} from "../src/server/cmux-hook-sessions";
import { parseCmuxSidebarSnapshot } from "../src/server/cmux";
import {
  manifestFactsFor,
  readRunManifests,
} from "../src/server/run-manifests";
import {
  stripTimestampMarkup,
  readableHumanMessage,
} from "../src/server/human-message";
import { parseCursorSession } from "../src/server/cursor";
import {
  cleanModelTitle,
  distillName,
  namingPrompt,
} from "../src/server/session-names";
import {
  detectAttentionSignal,
  readableClosingText,
} from "../src/server/attention-signal";
import {
  MAX_NAME_LENGTH,
  resolveAgentName,
} from "../src/server/naming";

/* Golden fixtures for the three Atlas collectors, plus the hostile inputs the
   HARDEN lane owns: `<timestamp>` markup at every board-facing ingress, an
   81-char declared name, and a NUL-free guarantee on published strings.

   `stripTimestampMarkup` is imported as the oracle — these tests assert the
   four ingresses apply it; they do not re-implement the stripper. */

const FIXTURES = join(import.meta.dir, "fixtures");
const HOOK_ROOT = join(FIXTURES, "cmux-hook-sessions");
const RUNS_ROOT = join(FIXTURES, "runs");
const SIDEBAR_ROOT = join(FIXTURES, "cmux-sidebar");

const CLOCK = "<timestamp>Tuesday, Aug 4, 2026, 6:10 PM (UTC-5)</timestamp>";
const WORK = "Fix the login redirect loop on staging";

const temporaryRoots: string[] = [];

function scratch(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `anthill-g2-${name}-`));
  temporaryRoots.push(root);
  return root;
}

beforeEach(() => {
  readHookSessionStores(HOOK_ROOT);
});

afterEach(() => {
  readHookSessionStores(join(HOOK_ROOT, "missing"));
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("collector goldens — hook store, manifests, sidebar snapshot", () => {
  test("hook store golden parses to the redacted binding records", () => {
    expect(readHookSessionStores(HOOK_ROOT)).toEqual([
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
    expect(hookRecordFor("claude", "11111111-2222-4333-8444-555555555555")?.surfaceId)
      .toBe("AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE");
  });

  test("a hostile malformed hook store yields [] rather than throwing", () => {
    const root = scratch("hook-hostile");
    writeFileSync(
      join(root, "claude-hook-sessions.json"),
      readFileSync(join(HOOK_ROOT, "hostile-malformed.json")),
    );
    expect(() => readHookSessionStores(root)).not.toThrow();
    expect(readHookSessionStores(root)).toEqual([]);
  });

  test("manifest golden binds the declared lane and orchestrator", () => {
    const manifests = readRunManifests([RUNS_ROOT]).filter((m) =>
      m.runId === "inbox-ux-overhaul-2026-08-05"
    );
    expect(manifests).toHaveLength(1);
    expect(manifestFactsFor("claude:lane-geometry-20260805", manifests)).toEqual({
      runId: "inbox-ux-overhaul-2026-08-05",
      laneId: "fe1-geometry",
      role: "worker",
      parentAgentId: "claude:orch-atlas-20260805",
    });
  });

  test("sidebar snapshot golden maps the installed RPC shape", () => {
    const raw = readFileSync(join(SIDEBAR_ROOT, "sidebar-snapshot.json"), "utf8");
    expect(parseCmuxSidebarSnapshot(raw)).toEqual([{
      workspaceId: "WORKSPACE-1",
      projectRootPath: "/Users/example/Developer/ProjectAtlas",
      branch: "feature/atlas",
      dirty: true,
      pullRequestUrls: ["https://github.com/example/atlas/pull/42"],
    }]);
  });

  test("sidebar windows[] / camelCase golden still yields repository facts", () => {
    const raw = readFileSync(join(SIDEBAR_ROOT, "sidebar-snapshot-windows.json"), "utf8");
    expect(parseCmuxSidebarSnapshot(raw)).toEqual([{
      workspaceId: "WORKSPACE-WIN",
      projectRootPath: "/Users/example/Developer/WindowsShape",
      branch: "main",
      dirty: false,
      pullRequestUrls: ["https://github.com/example/windows-shape/pull/7"],
    }]);
  });
});

describe("stripTimestampMarkup at all four board-facing ingresses", () => {
  test("the oracle itself removes the transport clock and keeps the words", () => {
    expect(stripTimestampMarkup(`${CLOCK}\n${WORK}`).trim()).toBe(WORK);
    expect(stripTimestampMarkup(CLOCK).trim()).toBe("");
  });

  test("1 — cursor task extraction strips the clock from the published task", () => {
    const agent = parseCursorSession({
      sessionId: "11111111-2222-4333-8444-555555555555",
      metaJson: JSON.stringify({
        createdAtMs: 1784689000000,
        updatedAtMs: 1784689180000,
        cwd: "/Users/me/project",
        hasConversation: true,
      }),
      transcriptJsonl: JSON.stringify({
        role: "user",
        message: {
          content: `${CLOCK}\n<user_query>\n${WORK}\n</user_query>`,
        },
      }),
      nowMs: 1784689180000,
    });

    expect(agent?.task).toBe(WORK);
    expect(agent?.task).toBe(stripTimestampMarkup(`${CLOCK}\n${WORK}`).trim());
    expect(agent?.task).not.toMatch(/<\/?timestamp/i);
    expect(agent?.task?.includes("\0")).toBe(false);
  });

  test("2 — human-message cleaning strips the clock from published prose", () => {
    const mixed = readableHumanMessage("cursor", `${CLOCK}\n${WORK}`);
    expect(mixed).toBe(WORK);
    expect(mixed).toBe(stripTimestampMarkup(`${CLOCK}\n${WORK}`).trim());
    expect(readableHumanMessage("cursor", CLOCK)).toBeUndefined();
    expect(mixed?.includes("\0")).toBe(false);
  });

  test("3 — session-namer never turns the clock into identity", () => {
    expect(cleanModelTitle(CLOCK)).toBeUndefined();
    expect(distillName([`${CLOCK}\n${WORK}`])).toBe(WORK);
    expect(namingPrompt([`${CLOCK}\n${WORK}`])).not.toContain("<timestamp");
    expect(distillName([`${CLOCK}\n${WORK}`])?.includes("\0")).toBe(false);
  });

  test("4 — attention evidence quotes the words, never the clock", () => {
    const base = {
      transcriptTail: null as string | null,
      lastAgentMessage: null as string | null,
      activity: "idle" as const,
      processState: "running" as const,
    };

    const signal = detectAttentionSignal({
      ...base,
      lastAgentClosing: `Want the full accounting?\n${CLOCK}`,
    });
    expect(signal.kind).toBe("question-pending");
    expect(signal.evidence).toBe("Want the full accounting?");
    expect(signal.evidence).not.toMatch(/<\/?timestamp/i);

    expect(readableClosingText({ ...base, lastAgentClosing: CLOCK })).toBeUndefined();

    const mixed = readableClosingText({
      ...base,
      lastAgentClosing: `Should I delete the stale fixtures? ${CLOCK}`,
    });
    expect(mixed).toBe("Should I delete the stale fixtures?");
    expect(mixed?.includes("\0")).toBe(false);
  });
});

describe("81-char declared names and NUL-free published strings", () => {
  test("an 81-char manifest lane id is capped to MAX_NAME_LENGTH with an ellipsis", () => {
    const manifests = readRunManifests([join(RUNS_ROOT, "hostile")]);
    expect(manifests).toHaveLength(1);
    expect(manifests[0]?.runId).toBe("hostile-81-char-run");
    const laneId = manifests[0]!.lanes[0]!.laneId;
    expect(laneId.length).toBe(81);

    const identity = resolveAgentName({
      provider: "codex",
      sourceSessionId: "lane-hostile-81",
      manifest: {
        runId: manifests[0]!.runId,
        laneId,
        role: "worker",
      },
    });

    expect(identity.source).toBe("manifest");
    expect(identity.name.length).toBe(MAX_NAME_LENGTH);
    expect(identity.name.endsWith("…")).toBe(true);
    expect(identity.name.includes("\0")).toBe(false);
    expect(identity.base.includes("\0")).toBe(false);
  });

  test("disambiguator tags publish as '#tag', never as an embedded NUL", () => {
    const identity = resolveAgentName({
      provider: "claude",
      sourceSessionId: "dad9736f-1111-2222-3333-444455556666",
      originCwd: "/Users/ant/Developer/the-mountain-main",
    }, "/Users/ant");
    expect(identity.name.includes("\0")).toBe(false);
    expect(identity.base.includes("\0")).toBe(false);
  });
});
