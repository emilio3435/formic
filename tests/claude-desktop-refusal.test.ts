import { beforeAll, describe, expect, test } from "bun:test";
import { executeControl } from "../src/server/control";
import { controlSurfaceKind } from "../src/server/grok-bot-gateway";
import { controlsFor, operatorControlState, processStateFor } from "../src/server/snapshot-agent";
import {
  canWriteToTarget,
  resolveAgentTarget,
  transmitRefusal,
} from "../src/server/targets";
import type { AgentSnapshot, CmuxTarget } from "../src/shared/types";
import type {
  ArchiveStore,
  CollectedAgent,
  CommandResult,
  CommandRunner,
  CmuxSurface,
} from "../src/server/types";

const SESSION_ID = "d987a1e1-6677-4926-91c6-eecef4638e46";
const NOW = "2026-08-17T18:00:00.000Z";

class RecordingRunner implements CommandRunner {
  readonly commands: string[][] = [];
  async run(command: readonly string[]): Promise<CommandResult> {
    this.commands.push([...command]);
    return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
  }
}

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };

function collectedClaude(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: `claude:${SESSION_ID}`,
    provider: "claude",
    sourceSessionId: SESSION_ID,
    displayName: "Claude Desktop chat",
    status: "waiting",
    statusReason: "Quiet Claude row.",
    updatedAt: NOW,
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    cwd: "/Users/emilionunezgarcia",
    launch: { entrypoint: "claude-desktop" },
    ...overrides,
  };
}

function snapshotClaude(overrides: {
  target?: CmuxTarget;
  archived?: boolean;
  collected?: Partial<CollectedAgent>;
} = {}): AgentSnapshot {
  const collected = collectedClaude(overrides.collected);
  const target = overrides.target ?? resolveAgentTarget(collected, [], [collected]);
  const archived = overrides.archived ?? false;
  return {
    ...collected,
    programId: "claude",
    lastHumanMessage: null,
    processState: processStateFor(collected),
    controlState: operatorControlState(target, archived),
    target,
    controls: controlsFor(collected, target, archived),
  } as AgentSnapshot;
}

describe("Claude Desktop is classified as GUI-only, not a write surface", () => {
  test("entrypoint claude-desktop resolves to claude-desktop and never mints cmux exact", () => {
    const agent = collectedClaude();
    const surface: CmuxSurface = {
      surfaceId: "SURFACE-FAKE",
      paneId: "PANE-1",
      cwd: agent.cwd,
      sourceSessionIds: [],
    };
    const target = resolveAgentTarget(agent, [surface], [agent]);
    expect(target.kind).toBe("claude-desktop");
    expect(controlSurfaceKind(target)).toBe("claude-desktop");
    expect(target.surfaceId).toBeUndefined();
    expect(target.resolution).not.toBe("exact");
    expect(canWriteToTarget(target)).toBe(false);
  });

  test("the refusal names the missing attested write and does not mention a cmux pane", () => {
    const target = resolveAgentTarget(collectedClaude(), [], [collectedClaude()]);
    const refusal = transmitRefusal({ target, processState: "unknown" });
    expect(refusal?.code).toBe("UNSAFE_TARGET");
    expect(refusal?.cause).toMatch(/no attested write/i);
    expect(refusal?.remedy).not.toMatch(/cmux pane/i);
    expect(refusal?.message).not.toMatch(/open it in a cmux/i);
    expect(refusal?.message).not.toMatch(/no safe cmux target/i);
    expect(refusal?.message).toMatch(/official write/i);
  });

  test("Claude Code CLI in cmux still Sends through cmux", () => {
    const agent = collectedClaude({
      launch: { entrypoint: "cli" },
    });
    const surface: CmuxSurface = {
      surfaceId: "SURFACE-CLI",
      paneId: "PANE-CLI",
      cwd: agent.cwd,
      sourceSessionIds: [SESSION_ID],
    };
    const target = resolveAgentTarget(agent, [surface], [agent]);
    expect(target.kind ?? "cmux").toBe("cmux");
    expect(target.resolution).toBe("exact");
    expect(canWriteToTarget(target)).toBe(true);
  });
});

describe("Claude Desktop instruct is an honest refusal, never a prefill Send", () => {
  test("instruct is refused and never opens a q= deeplink", async () => {
    const runner = new RecordingRunner();
    const agent = snapshotClaude();
    expect(agent.controls.find((control) => control.action === "instruct")?.enabled).toBe(false);
    const execution = await executeControl(
      { action: "instruct", agentId: agent.id, instruction: "Please send this." },
      agent,
      { runner, archiveStore },
    );
    expect(execution.response.ok).toBe(false);
    expect(execution.status).toBe(409);
    expect(execution.response.error?.message).toMatch(/no attested write/i);
    expect(execution.response.error?.message).not.toMatch(/cmux pane/i);
    expect(runner.commands).toEqual([]);
    expect(JSON.stringify(runner.commands)).not.toContain("claude://");
    expect(JSON.stringify(runner.commands)).not.toContain("q=");
  });

  test("focus may open Claude.app but never a new?q= prefill, and is not recorded as Send", async () => {
    const runner = new RecordingRunner();
    const agent = snapshotClaude();
    const execution = await executeControl(
      { action: "focus", agentId: agent.id },
      agent,
      { runner, archiveStore },
    );
    expect(execution.response.ok).toBe(true);
    expect(execution.response.action).toBe("focus");
    const rendered = JSON.stringify(runner.commands);
    expect(rendered).not.toContain("q=");
    expect(rendered).not.toContain("/new?");
    expect(rendered).not.toMatch(/claude:\/\/.*\?q=/);
    expect(runner.commands.some((command) => command[0] === "open")).toBe(true);
  });
});

describe("Claude Desktop dock copy", () => {
  let presentation: { controlUnavailableText: (state: string, agent?: object) => string };

  beforeAll(async () => {
    presentation = await import("../src/web/presentation.js");
  });

  test("the dock does not tell a Claude.app operator to open a cmux pane", () => {
    const agent = snapshotClaude();
    const text = presentation.controlUnavailableText("observed-only", agent);
    expect(text).toMatch(/no attested write/i);
    expect(text).not.toMatch(/cmux pane/i);
    expect(text).not.toMatch(/no safe cmux target/i);
    expect(text).not.toMatch(/open it in a cmux/i);
  });
});
