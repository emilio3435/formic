import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureFormicOrchToken,
  handleOrchFleet,
  handleOrchLaunch,
  handleOrchPeek,
  handleOrchSend,
  resetOrchLaunchNoncesForTests,
  type OrchDependencies,
} from "../src/server/orch";
import type { AgentSnapshot, CmuxTarget, HubSnapshot } from "../src/shared/types";
import type { CommandResult, CommandRunner } from "../src/server/types";

const TOKEN = "orch-test-token";
const NOW = "2026-08-16T22:00:00.000Z";

class RecordingRunner implements CommandRunner {
  readonly commands: string[][] = [];
  stdout = "Created workspace:8\n";
  exitCode = 0;
  async run(command: readonly string[]): Promise<CommandResult> {
    this.commands.push([...command]);
    return { exitCode: this.exitCode, stdout: this.stdout, stderr: "", timedOut: false };
  }
}

function target(overrides: Partial<CmuxTarget> = {}): CmuxTarget {
  return {
    kind: "grok-bot",
    agentId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    instanceId: "grok-bot:grok-bot",
    gatewayReady: true,
    resolution: "gateway",
    ...overrides,
  };
}

function agent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: "grok:bot:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    provider: "grok",
    sourceSessionId: "bot:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    displayName: "Formic Agent",
    programId: "grok-bot",
    status: "waiting",
    statusReason: "quiet",
    lastHumanMessage: null,
    processState: "unknown",
    controlState: "linked",
    target: target(),
    controls: [{ action: "instruct", enabled: true }],
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
    ...overrides,
  } as AgentSnapshot;
}

function snapshot(agents: AgentSnapshot[], generatedAt = NOW): HubSnapshot {
  return {
    schemaVersion: 1,
    generatedAt,
    controlHealth: { cmuxReachable: true, lastCheckedAt: NOW, errors: [], staleSources: [] },
    totals: { live: agents.length, tracked: agents.length, attention: 0 },
    programs: [{ id: "grok-bot", name: "Grok Bot", agents }],
  };
}

function deps(overrides: Partial<OrchDependencies> & { runner?: RecordingRunner } = {}): OrchDependencies {
  const root = mkdtempSync(join(tmpdir(), "anthill-orch-"));
  mkdirSync(join(root, "data"));
  writeFileSync(join(root, "data", "formic-orch.env"), `FORMIC_ORCH_TOKEN=${TOKEN}\n`);
  return {
    getSnapshot: () => snapshot([agent()]),
    runner: overrides.runner ?? new RecordingRunner(),
    archiveStore: { has: () => false, archive: async () => {} },
    projectRoot: root,
    token: TOKEN,
    now: () => Date.parse(NOW) + 1_000,
    ...overrides,
  };
}

function req(path: string, init: RequestInit = {}): Request {
  return new Request(`http://127.0.0.1:4701${path}`, init);
}

function auth(init: RequestInit = {}, token = TOKEN): RequestInit {
  return {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  };
}

beforeEach(() => {
  resetOrchLaunchNoncesForTests();
});

afterEach(() => {
  resetOrchLaunchNoncesForTests();
});

describe("orch auth", () => {
  test("missing or wrong Bearer is 401 and fleet has no secrets", async () => {
    const bag = deps();
    const missing = await handleOrchFleet(req("/api/orch/fleet"), bag);
    expect(missing.status).toBe(401);
    const wrong = await handleOrchFleet(req("/api/orch/fleet", auth({}, "nope")), bag);
    expect(wrong.status).toBe(401);
    const ok = await handleOrchFleet(req("/api/orch/fleet", auth()), bag);
    const body = await ok.json() as { agents: unknown[]; ok: boolean };
    expect(ok.status).toBe(200);
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(JSON.stringify(body)).not.toContain("cursorvm");
    expect(JSON.stringify(body)).not.toContain("FORMIC_ORCH_TOKEN");
  });
});

describe("orch peek", () => {
  test("missing Bearer is 401 and cards never leak secrets or artifact paths", async () => {
    const plantedPath = "/Users/me/.cursor/projects/secret/gateway.json";
    const bag = deps({
      getSnapshot: () => snapshot([agent({
        lastUserMessage: "Ship the orch peek verb.",
        lastAgentClosing: "Writing the card projection.",
        contextPct: 18,
        cwd: "/Users/me/proj",
        originCwd: "/Users/me/.grokbot",
        tokens: { provenance: "observed", input: 99_999 },
        artifacts: [
          { label: "gateway", path: plantedPath, kind: "file" },
          { label: "Cursor transcript", path: "/tmp/transcript.jsonl", kind: "transcript" },
        ],
        repo: {
          repoKey: "the-ant-hill",
          repoName: "the-ant-hill",
          worktreePath: "/Users/me/secret-worktree",
          branch: "feat/peek",
          ephemeral: false,
        },
        git: { branch: "feat/peek", dirty: true, head: "deadbeef" },
        target: target(),
      })]),
    });
    const missing = await handleOrchPeek(req("/api/orch/peek"), bag);
    expect(missing.status).toBe(401);
    const ok = await handleOrchPeek(req("/api/orch/peek", auth()), bag);
    expect(ok.status).toBe(200);
    const body = await ok.json() as { cards: Array<Record<string, unknown>> };
    const dumped = JSON.stringify(body);
    expect(dumped).not.toContain(TOKEN);
    expect(dumped).not.toContain("cursorvm");
    expect(dumped).not.toContain("FORMIC_ORCH_TOKEN");
    expect(dumped).not.toContain(plantedPath);
    expect(dumped).not.toContain("secret-worktree");
    expect(dumped).not.toContain("/Users/me/.grokbot");
    expect(dumped).not.toContain("deadbeef");
    expect(dumped).not.toContain("99999");
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0]?.goal).toBe("Ship the orch peek verb.");
    expect(body.cards[0]?.lastReply).toBe("Writing the card projection.");
    expect(body.cards[0]?.files).toEqual(["gateway.json"]);
    expect(body.cards[0]?.cwd).toBe("/Users/me/proj");
    expect(body.cards[0]?.repo).toBe("the-ant-hill");
    expect(body.cards[0]?.contextPct).toBe(18);
  });

  test("unknown agentId is 404", async () => {
    const bag = deps();
    const response = await handleOrchPeek(req("/api/orch/peek?agentId=missing", auth()), bag);
    expect(response.status).toBe(404);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("AGENT_NOT_FOUND");
  });

  test("a known id returns one card; archived rows are omitted from the full peek", async () => {
    const bag = deps({
      getSnapshot: () => snapshot([
        agent({
          lastHumanMessage: "from lastHumanMessage",
          lastUserMessage: "from lastUser",
          lastAgentMessage: "from lastAgent",
          lastAgentClosing: "from closing",
        }),
        agent({
          id: "claude:archived",
          sourceSessionId: "archived",
          displayName: "Gone",
          status: "archived",
          lastHumanMessage: "should not appear",
        }),
      ]),
    });
    const one = await handleOrchPeek(req("/api/orch/peek?agentId=grok:bot:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", auth()), bag);
    const oneBody = await one.json() as { cards: Array<{ goal: string; lastReply: string; id: string }> };
    expect(one.status).toBe(200);
    expect(oneBody.cards).toHaveLength(1);
    expect(oneBody.cards[0]?.goal).toBe("from lastUser");
    expect(oneBody.cards[0]?.lastReply).toBe("from closing");
    const all = await handleOrchPeek(req("/api/orch/peek", auth()), bag);
    const allBody = await all.json() as { cards: Array<{ id: string }> };
    expect(allBody.cards.map((card) => card.id)).toEqual([
      "grok:bot:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    ]);
  });
});

describe("orch send", () => {
  test("delegates to executeControl once per nonce", async () => {
    const calls: string[] = [];
    const bag = deps({
      executeControl: async (request) => {
        calls.push(request.clientNonce ?? "");
        return { status: 200, response: { ok: true, action: "instruct", agentId: request.agentId } };
      },
    });
    const payload = {
      agentId: "grok:bot:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      instruction: "List failing tests.",
      clientNonce: "n1",
    };
    const first = await handleOrchSend(req("/api/orch/send", auth({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })), bag);
    expect(first.status).toBe(200);
    expect(calls).toEqual(["n1"]);
  });

  test("a row that cannot write returns 409 and runs no cmux", async () => {
    const runner = new RecordingRunner();
    const bag = deps({
      runner,
      getSnapshot: () => snapshot([agent({
        target: target({ gatewayReady: false }),
        controls: [{ action: "instruct", enabled: false, reason: "down" }],
      })]),
    });
    const response = await handleOrchSend(req("/api/orch/send", auth({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: "grok:bot:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        instruction: "Nope.",
      }),
    })), bag);
    expect(response.status).toBe(409);
    expect(runner.commands).toEqual([]);
  });

  test("newlines in the instruction are refused before executeControl", async () => {
    let called = false;
    const bag = deps({
      executeControl: async () => {
        called = true;
        return { status: 200, response: { ok: true, action: "instruct", agentId: "x" } };
      },
    });
    const response = await handleOrchSend(req("/api/orch/send", auth({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: "grok:bot:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        instruction: "one\ntwo",
      }),
    })), bag);
    expect(response.status).toBe(400);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("INVALID_INSTRUCTION");
    expect(called).toBe(false);
  });
});

describe("orch launch", () => {
  test("rejects bash and a cwd outside home", async () => {
    const home = mkdtempSync(join(tmpdir(), "anthill-home-"));
    const runner = new RecordingRunner();
    const bag = deps({ runner, homedir: home });
    const bash = await handleOrchLaunch(req("/api/orch/launch", auth({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: home, command: "bash" }),
    })), bag);
    expect(bash.status).toBe(400);
    const evil = await handleOrchLaunch(req("/api/orch/launch", auth({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: "/tmp/evil", command: "codex" }),
    })), bag);
    expect(evil.status).toBe(400);
    expect(runner.commands).toEqual([]);
  });

  test("allowlisted codex under home runs new-workspace without a shell", async () => {
    const home = mkdtempSync(join(tmpdir(), "anthill-home-"));
    const cwd = join(home, "proj");
    mkdirSync(cwd);
    const runner = new RecordingRunner();
    const bag = deps({ runner, homedir: home });
    const response = await handleOrchLaunch(req("/api/orch/launch", auth({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd, command: "codex", title: "FORMIC · review" }),
    })), bag);
    expect(response.status).toBe(200);
    const body = await response.json() as { workspaceRef: string };
    expect(body.workspaceRef).toBe("workspace:8");
    expect(runner.commands).toHaveLength(1);
    expect(runner.commands[0]?.includes("new-workspace")).toBe(true);
    expect(runner.commands[0]?.includes("sh")).toBe(false);
    expect(runner.commands[0]?.at(-1)).toBe("--no-focus");
  });
});

describe("orch token helper", () => {
  test("ensure writes a token file once", () => {
    const root = mkdtempSync(join(tmpdir(), "anthill-token-"));
    const first = ensureFormicOrchToken(root);
    const second = ensureFormicOrchToken(root);
    expect(first).toHaveLength(64);
    expect(second).toBe(first);
  });

  test("ensure does not overwrite a present but empty token file", () => {
    const root = mkdtempSync(join(tmpdir(), "anthill-token-empty-"));
    mkdirSync(join(root, "data"));
    writeFileSync(join(root, "data", "formic-orch.env"), "FORMIC_ORCH_TOKEN=\n");
    expect(() => ensureFormicOrchToken(root)).toThrow(/empty or malformed/);
  });
});
