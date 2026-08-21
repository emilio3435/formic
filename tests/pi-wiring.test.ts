import { beforeAll, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SUPPORTED_ALTERNATE_HOME_KINDS,
  classifyDataDir,
  prioritizeAgentNamedDirs,
  readTextCappedSync,
  type ScanFs,
} from "../src/server/collector-instances";
import { collectSessionProvider } from "../src/server/collectors";
import { enrichCmuxIdentity, identitiesFromCommand, identityFromSessionPath, isRecognizedAgentProcess } from "../src/server/identity";
import { resolveAgentName } from "../src/server/naming";
import { ProviderSettlementCoordinator } from "../src/server/provider-settlement";
import { controlsFor } from "../src/server/snapshot-agent";
import { HubState, providerCollectionConfigKey, type HubCollectors } from "../src/server/state";
import { canWriteToTarget, resolveAgentTarget } from "../src/server/targets";
import type { ArchiveStore, CmuxSurface, CollectedAgent, CommandResult, CommandRunner } from "../src/server/types";
import { PROVIDERS, type Provider } from "../src/shared/types";

const PI = "pi" as Provider;
const ID = "pi.native_2026-08-20";
const STRICT_PREFIX = ID.slice(0, -3);
const TRANSCRIPT = "/tmp/formic-pi-fixture/project/2026-08-20T12-00-00_pi.native_2026-08-20.jsonl";
const runner: CommandRunner = {
  run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
};
const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };

function piAgent(overrides: Partial<CollectedAgent> = {}): CollectedAgent {
  return {
    id: `pi:${ID}`,
    provider: PI,
    sourceSessionId: ID,
    displayName: "Pinned Pi",
    cwd: "/tmp/formic-pi-fixture/project",
    status: "running",
    statusReason: "Pinned Pi process evidence is current.",
    updatedAt: "2026-08-20T12:00:19.000Z",
    tokens: { provenance: "observed" },
    artifacts: [{ label: "Pi session", path: TRANSCRIPT, kind: "transcript" }],
    gates: [],
    allowCwdFallback: false,
    ...overrides,
  };
}

function surface(overrides: Partial<CmuxSurface> = {}): CmuxSurface {
  return {
    workspaceId: "PI-WORKSPACE",
    surfaceId: "PI-SURFACE",
    cwd: "/tmp/formic-pi-fixture/project",
    runtimeSurfaceReady: true,
    sourceSessionIds: [],
    sourceSessionClaims: [],
    ...overrides,
  };
}

async function enrichPiCommand(command: string, pid: number): Promise<{
  agent: CollectedAgent;
  result: Awaited<ReturnType<typeof enrichCmuxIdentity>>;
}> {
  class CommandIdentityRunner implements CommandRunner {
    async run(argv: readonly string[]): Promise<CommandResult> {
      if (argv.join(" ").includes("system.top")) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ kind: "process", cmux_surface_id: "PI-SURFACE", pid }]),
          stderr: "",
          timedOut: false,
        };
      }
      if (argv[0] === "env" && argv.includes("ps")) {
        return { exitCode: 0, stdout: `${pid} ?? ${command}`, stderr: "", timedOut: false };
      }
      if (argv[0]?.endsWith("lsof")) {
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
      }
      return { exitCode: 1, stdout: "", stderr: `unexpected ${argv.join(" ")}`, timedOut: false };
    }
  }
  const agent = piAgent();
  return { agent, result: await enrichCmuxIdentity([surface()], [agent], new CommandIdentityRunner()) };
}

function underRoot(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function scanFs(root: string, extra: Partial<ScanFs> = {}): ScanFs {
  return {
    home: () => root,
    readdir: (path) => {
      if (!underRoot(root, path)) return [];
      try { return require("node:fs").readdirSync(path); } catch { return []; }
    },
    isDirectory: (path) => {
      if (!underRoot(root, path)) return false;
      try { return statSync(path).isDirectory(); } catch { return false; }
    },
    exists: (path) => underRoot(root, path) && existsSync(path),
    readTextCapped: (path, maxBytes) => underRoot(root, path) ? readTextCappedSync(path, maxBytes) : undefined,
    readAppIdentity: () => undefined,
    processArgv: () => [],
    ...extra,
  };
}

function resultMap() {
  return Object.fromEntries(PROVIDERS.map((provider) => [provider, { value: [], errors: [] }])) as any;
}

describe("Pi registry, instances, naming, docs, and official mark reds", () => {
  test("runtime provider registry contains Pi exactly once", () => {
    expect(PROVIDERS.filter((provider) => provider === ("pi" as string))).toEqual(["pi"]);
    expect(new Set(PROVIDERS).size).toBe(PROVIDERS.length);
  });

  test("Pi direct-session roots are advertised as supported collector instances", () => {
    expect(SUPPORTED_ALTERNATE_HOME_KINDS).toContain("pi");
    expect(SUPPORTED_ALTERNATE_HOME_KINDS).not.toContain("unknown");
  });

  test("dot-pi agent home is recognized as Pi", () => {
    const root = mkdtempSync(join(tmpdir(), "formic-pi-token-"));
    const pi = join(root, ".pi");
    mkdirSync(join(pi, "agent/sessions/--tmp-project--"), { recursive: true });
    writeFileSync(join(pi, "agent/sessions/--tmp-project--/session.jsonl"), "{}\n");

    expect(classifyDataDir(pi, scanFs(root))).toMatchObject({ kind: "pi", provider: "pi", default: true });
  });

  test("dot-pip is not admitted as dot-pi", () => {
    const root = mkdtempSync(join(tmpdir(), "formic-pip-token-"));
    const pip = join(root, ".pip");
    mkdirSync(join(pip, "agent/sessions/--tmp-project--"), { recursive: true });
    writeFileSync(join(pip, "agent/sessions/--tmp-project--/session.jsonl"), "{}\n");

    expect(classifyDataDir(pip, scanFs(root))).toBeUndefined();
  });

  test("NAME_TOKEN prioritizes exact Pi tokens without treating pilot or pi-prefixed names as Pi", () => {
    expect(prioritizeAgentNamedDirs(["other", "pilot", "pi-helper", "pi", "pi-2"]))
      .toEqual(["pi", "pi-2", "other", "pilot", "pi-helper"]);
  });

  test("AGENT_MENTION does not classify a Pilot app or unrelated pi-prefixed identity as an agent home", () => {
    const root = mkdtempSync(join(tmpdir(), "formic-pi-app-token-"));
    const dataDir = join(root, "Library/Application Support/Pilot");
    const app = join(root, "Applications/Pilot.app");
    mkdirSync(join(dataDir, "sessions"), { recursive: true });
    mkdirSync(app, { recursive: true });
    writeFileSync(join(dataDir, "sessions/session.jsonl"), "{}\n");
    const base = scanFs(root);
    const fs = scanFs(root, {
      readAppIdentity: (path) => path === app
        ? { name: "Pilot Desktop", identifier: "dev.vendor.pioneer" }
        : undefined,
      readdir: (path) => path === join(root, "Applications") ? ["Pilot.app"] : base.readdir(path),
    });

    expect(classifyDataDir(dataDir, fs)).toBeUndefined();
  });

  test("server fallback naming says Pi rather than undefined and authored Pi titles retain provenance", () => {
    expect(resolveAgentName({ provider: PI, sourceSessionId: ID }, "/tmp/home")).toEqual({
      name: "Pi session",
      base: "Pi session",
      source: "provider-fallback",
    });
    expect(resolveAgentName({
      provider: PI,
      sourceSessionId: ID,
      authored: { name: "Pinned title", by: "pi-title" as never },
    }, "/tmp/home")).toMatchObject({
      name: "Pinned title",
      source: "authored",
      authoredBy: "pi-title",
    });
  });

  test("PARITY ledger names the exact executable package, commit, v3 gate, and I-110 USD quarantine", () => {
    const parity = readFileSync(join(import.meta.dir, "../docs/PARITY.md"), "utf8");
    expect(parity).toContain("@earendil-works/pi-coding-agent");
    expect(parity).toContain("0.84.2");
    expect(parity).toContain("b7bb00b936dbe21b8e160b3e89efdec361846699");
    expect(parity).toMatch(/Pi[^\n]*schema[^\n]*v?3/i);
    expect(parity).toMatch(/I-110[^\n]*Pi[^\n]*(?:USD|cost)|Pi[^\n]*(?:USD|cost)[^\n]*I-110/i);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let web: any;
  beforeAll(async () => {
    // @ts-expect-error dependency-free browser client has no declaration file
    await import("../src/web/app.js");
    web = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
  });

  test("official Pi harness SVG exists byte-identical to the cached vendor asset", () => {
    const asset = join(import.meta.dir, "../src/web/icons/pi.svg");
    const digest = existsSync(asset)
      ? createHash("sha256").update(readFileSync(asset)).digest("hex")
      : "missing";
    expect(digest).toBe("03d509c104b9570063fa268fd3235ed7e0e41dafd93124ca94cae3726f58f117");
  });

  test("Pi row selects the official Pi harness mark", () => {
    const row = { provider: "pi", model: "claude-opus-4-1" };
    expect(web.HARNESS_MARK[web.harnessKeyOf(row)]).toEqual({ src: "/icons/pi.svg", label: "Pi" });
  });

  test("Pi harness mark remains distinct from the source-reported model-family mark", () => {
    const row = { provider: "pi", model: "claude-opus-4-1" };
    expect({
      harness: web.HARNESS_MARK.pi?.src,
      agent: web.AGENT_MARK[web.agentKeyOf(row)]?.src,
    }).toEqual({ harness: "/icons/pi.svg", agent: "/icons/claude.svg" });
    expect(web.HARNESS_MARK.pi?.src).not.toBe(web.AGENT_MARK.claude.src);
  });
});

describe("Pi exact process, resume, target, and control boundaries", () => {
  test("official Pi process token is recognized at an exact lexical boundary", () => {
    expect(isRecognizedAgentProcess(`pi --session-id ${ID}`)).toBeTrue();
  });

  test("full Pi --session-id command becomes an exact provider-qualified identity", () => {
    expect(identitiesFromCommand(`pi --session-id ${ID}`)).toEqual([{ provider: "pi", value: ID, full: true }]);
  });

  test.each([
    ["separate argument", `pi --session ${ID}`],
    ["equals argument", `pi --session=${ID}`],
  ])("full Pi --session %s becomes an exact provider-qualified identity", async (_label, command) => {
    expect(identitiesFromCommand(command)).toEqual([{ provider: "pi", value: ID, full: false }]);
    const { agent, result } = await enrichPiCommand(command, _label === "separate argument" ? 4244 : 4245);
    expect(result.errors).toEqual([]);
    expect(result.value[0]?.sourceSessionClaims).toEqual([{ provider: "pi", sessionId: ID }]);
    expect(result.value[0]?.identityTrace?.commandHints).toContainEqual(expect.objectContaining({
      provider: "pi",
      value: ID,
      full: false,
      resolvedSessionId: ID,
    }));
    expect(agent.processIds).toHaveLength(1);
  });

  test("strict Pi --session prefix is parsed as non-exact command identity", () => {
    expect(ID.startsWith(STRICT_PREFIX)).toBeTrue();
    expect(STRICT_PREFIX).not.toBe(ID);
    expect(identitiesFromCommand(`pi --session ${STRICT_PREFIX}`)).toEqual([
      { provider: "pi", value: STRICT_PREFIX, full: false },
    ]);
  });

  test("date-shaped Pi --session prefix remains non-exact until it equals a collected header id", () => {
    const exactId = "pi.native_2026-08-20.release";
    const dateShapedPrefix = "pi.native_2026-08-20";
    expect(exactId.startsWith(dateShapedPrefix)).toBeTrue();
    expect(identitiesFromCommand(`pi --session ${dateShapedPrefix}`)).toEqual([
      { provider: "pi", value: dateShapedPrefix, full: false },
    ]);
  });

  test("Pi transcript filename alone cannot override the authoritative header identity", () => {
    expect(identityFromSessionPath(TRANSCRIPT)).toBeNull();
  });

  test.each([
    ["pilot", `pilot --session-id ${ID}`],
    ["pi-helper", `pi-helper --session-id ${ID}`],
    ["pioneer", `pioneer --session-id ${ID}`],
    ["pi-server", `pi-server --session-id ${ID}`],
  ])("unrelated %s command is neither a Pi process nor a resume claim", (_label, command) => {
    expect(isRecognizedAgentProcess(command)).toBeFalse();
    expect(identitiesFromCommand(command)).toEqual([]);
  });

  test("cmux enrichment attaches the exact non-UUID header identity from Pi process and open-file evidence", async () => {
    class IdentityRunner implements CommandRunner {
      async run(command: readonly string[]): Promise<CommandResult> {
        if (command.join(" ").includes("system.top")) {
          return {
            exitCode: 0,
            stdout: JSON.stringify([{ kind: "process", cmux_surface_id: "PI-SURFACE", pid: 4242 }]),
            stderr: "",
            timedOut: false,
          };
        }
        if (command[0] === "env" && command.includes("ps")) {
          return { exitCode: 0, stdout: `4242 ?? pi --session=${ID}`, stderr: "", timedOut: false };
        }
        if (command[0]?.endsWith("lsof")) {
          return { exitCode: 0, stdout: `p4242\nn${TRANSCRIPT}\n`, stderr: "", timedOut: false };
        }
        return { exitCode: 1, stdout: "", stderr: `unexpected ${command.join(" ")}`, timedOut: false };
      }
    }
    const agent = piAgent();
    const result = await enrichCmuxIdentity([surface()], [agent], new IdentityRunner());

    expect(result.errors).toEqual([]);
    expect(result.value[0]?.sourceSessionClaims).toEqual([{ provider: "pi", sessionId: ID }]);
    expect(result.value[0]?.sourceSessionIds).toEqual([ID]);
    expect(agent.processIds).toEqual([4242]);
    expect(agent.transcriptOpen).toBeTrue();
  });

  test("cmux enrichment records a strict Pi prefix but never promotes it to an exact session claim", async () => {
    class PrefixRunner implements CommandRunner {
      async run(command: readonly string[]): Promise<CommandResult> {
        if (command.join(" ").includes("system.top")) {
          return {
            exitCode: 0,
            stdout: JSON.stringify([{ kind: "process", cmux_surface_id: "PI-SURFACE", pid: 4243 }]),
            stderr: "",
            timedOut: false,
          };
        }
        if (command[0] === "env" && command.includes("ps")) {
          return { exitCode: 0, stdout: `4243 ?? pi --session ${STRICT_PREFIX}`, stderr: "", timedOut: false };
        }
        if (command[0]?.endsWith("lsof")) {
          return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
        }
        return { exitCode: 1, stdout: "", stderr: `unexpected ${command.join(" ")}`, timedOut: false };
      }
    }
    const agent = piAgent();
    const result = await enrichCmuxIdentity([surface()], [agent], new PrefixRunner());

    expect(result.errors).toEqual([]);
    expect(result.value[0]?.sourceSessionClaims).toEqual([]);
    expect(result.value[0]?.sourceSessionIds).toEqual([]);
    expect(result.value[0]?.identityTrace?.commandHints).toContainEqual(expect.objectContaining({
      provider: "pi",
      value: STRICT_PREFIX,
      full: false,
      resolvedSessionId: undefined,
      rejectionReason: expect.stringMatching(/Pi.*prefix.*non-exact.*control/i),
    }));
    expect(agent.processIds).toBeUndefined();
  });

  test("provider-qualified strict Pi prefix still exposes zero enabled controls", () => {
    const agent = piAgent();
    const target = resolveAgentTarget(agent, [surface({
      sourceSessionClaims: [{ provider: PI, sessionId: STRICT_PREFIX }],
      sourceSessionIds: [STRICT_PREFIX],
    })], [agent]);
    const controls = controlsFor(agent, target, false);

    expect(target.resolution).toBe("missing");
    expect(canWriteToTarget(target)).toBeFalse();
    expect(controls.filter(({ action, enabled }) =>
      enabled && ["focus", "instruct", "interrupt"].includes(action))).toEqual([]);
  });

  test("full exact provider-qualified valid header id enables Focus, Send, and Interrupt", () => {
    const agent = piAgent();
    const target = resolveAgentTarget(agent, [surface({
      sourceSessionClaims: [{ provider: PI, sessionId: ID }],
      sourceSessionIds: [ID],
    })], [agent]);
    const controls = controlsFor(agent, target, false);

    expect(target).toMatchObject({ resolution: "exact", attestation: "live", surfaceId: "PI-SURFACE" });
    expect(canWriteToTarget(target)).toBeTrue();
    for (const action of ["focus", "instruct", "interrupt"] as const) {
      expect(controls.find((control) => control.action === action)).toMatchObject({ action, enabled: true });
    }
  });

  test.each([
    ["other-provider same id", ID, "codex" as Provider],
    ["invalid leading punctuation", ".pi-invalid", PI],
    ["invalid trailing punctuation", "pi-invalid-", PI],
  ])("%s identity disables Focus, Send, and Interrupt", (_label, claimId, claimProvider) => {
    const sourceId = _label.startsWith("invalid") ? claimId : ID;
    const agent = piAgent({ id: `pi:${sourceId}`, sourceSessionId: sourceId });
    const target = resolveAgentTarget(agent, [surface({
      sourceSessionClaims: [{ provider: claimProvider, sessionId: claimId }],
      sourceSessionIds: [claimId],
    })], [agent]);
    const controls = controlsFor(agent, target, false);

    expect(target.resolution).toBe("missing");
    expect(canWriteToTarget(target)).toBeFalse();
    for (const action of ["focus", "instruct", "interrupt"] as const) {
      expect(controls.find((control) => control.action === action)).toMatchObject({ action, enabled: false });
    }
  });

  test("unqualified collision and cwd-only coincidence disable all three exact-only controls", () => {
    const pi = piAgent();
    const codex = piAgent({ id: `codex:${ID}`, provider: "codex" });
    const unqualified = surface({ sourceSessionIds: [ID], sourceSessionClaims: [] });
    const cwdOnly = surface({ surfaceId: "PI-CWD-ONLY", sourceSessionIds: [], sourceSessionClaims: [] });
    for (const target of [
      resolveAgentTarget(pi, [unqualified], [pi, codex]),
      resolveAgentTarget(pi, [cwdOnly], [pi]),
    ]) {
      const controls = controlsFor(pi, target, false);
      expect(target.resolution).toBe("missing");
      expect(canWriteToTarget(target)).toBeFalse();
      expect(controls.filter(({ action }) => ["focus", "instruct", "interrupt"].includes(action)).every(({ enabled }) => !enabled))
        .toBeTrue();
    }
  });

  test("PI-REPAIR-7A duplicate exact Pi ids remain ambiguous even for a provider-qualified claim", () => {
    const first = piAgent({
      instanceId: "pi:first",
      recordedTarget: { surfaceId: "PI-SURFACE" },
      artifacts: [{ label: "Pi session", path: "/tmp/pi-first.jsonl", kind: "transcript" }],
    });
    const second = piAgent({
      instanceId: "pi:second",
      recordedTarget: { surfaceId: "PI-SURFACE" },
      artifacts: [{ label: "Pi session", path: "/tmp/pi-second.jsonl", kind: "transcript" }],
    });
    const claimed = surface({
      sourceSessionClaims: [{ provider: PI, sessionId: ID }],
      sourceSessionIds: [ID],
    });
    const results = [first, second].map((agent) => {
      const target = resolveAgentTarget(agent, [claimed], [first, second]);
      const controls = controlsFor(agent, target, false);
      return {
        resolution: target.resolution,
        writable: canWriteToTarget(target),
        enabled: controls.filter(({ action, enabled }) =>
          enabled && ["focus", "instruct", "interrupt"].includes(action)).map(({ action }) => action),
      };
    });

    expect(results).toEqual([
      { resolution: "ambiguous", writable: false, enabled: [] },
      { resolution: "ambiguous", writable: false, enabled: [] },
    ]);
  });

  test("PI-REPAIR-7B command enrichment mints no exact claim for duplicate Pi source ids", async () => {
    class CollisionRunner implements CommandRunner {
      async run(command: readonly string[]): Promise<CommandResult> {
        if (command.join(" ").includes("system.top")) {
          return { exitCode: 0, stdout: JSON.stringify([{ kind: "process", cmux_surface_id: "PI-SURFACE", pid: 4299 }]), stderr: "", timedOut: false };
        }
        if (command[0] === "env" && command.includes("ps")) {
          return { exitCode: 0, stdout: `4299 ?? pi --session-id ${ID}`, stderr: "", timedOut: false };
        }
        if (command[0]?.endsWith("lsof")) {
          return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
        }
        return { exitCode: 1, stdout: "", stderr: `unexpected ${command.join(" ")}`, timedOut: false };
      }
    }
    const first = piAgent({ instanceId: "pi:first" });
    const second = piAgent({ instanceId: "pi:second" });
    const result = await enrichCmuxIdentity([surface()], [first, second], new CollisionRunner());

    expect({
      claims: result.value[0]?.sourceSessionClaims,
      ids: result.value[0]?.sourceSessionIds,
      conflict: result.value[0]?.identityConflict,
    }).toEqual({
      claims: [],
      ids: [],
      conflict: expect.stringMatching(/multiple.*Pi.*source/i),
    });
  });
});

describe("Pi settlement and HubState cancellation reds", () => {
  test("PI-REPAIR-1A first refresh forwards two live Pi observations and its owned deadline in one provider call", async () => {
    const safeHome = mkdtempSync(join(tmpdir(), "formic-pi-state-home-"));
    const firstRoot = mkdtempSync(join(tmpdir(), "formic-pi-state-first-"));
    const secondRoot = mkdtempSync(join(tmpdir(), "formic-pi-state-second-"));
    const session = (id: string, prompt: string) => [
      { type: "session", version: 3, id, timestamp: "2026-08-20T12:00:00.000Z", cwd: `/tmp/${id}` },
      { type: "message", id: `${id}-user`, parentId: null, timestamp: "2026-08-20T12:00:01.000Z", message: { role: "user", content: prompt, timestamp: 1_787_227_201_000 } },
      { type: "message", id: `${id}-answer`, parentId: `${id}-user`, timestamp: "2026-08-20T12:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: `${prompt} answer` }], provider: "anthropic", model: "claude-opus-5", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, stopReason: "stop", timestamp: 1_787_227_202_000 } },
    ];
    writeFileSync(join(firstRoot, "first.jsonl"), `${session("pi.state-first", "First observed root").map((row) => JSON.stringify(row)).join("\n")}\n`);
    writeFileSync(join(secondRoot, "second.jsonl"), `${session("pi.state-second", "Second observed root").map((row) => JSON.stringify(row)).join("\n")}\n`);
    const observations = [
      { launchCwd: "/tmp/launch-second", cliSessionDir: secondRoot },
      { launchCwd: "/tmp/launch-first", cliSessionDir: firstRoot },
    ];
    let piOptions: Record<string, unknown> | undefined;
    const collectors: HubCollectors = {
      sessions: async () => resultMap(),
      sessionProvider: (async (provider: Provider, _home: string, windowMs: number, thresholds: unknown, options: Record<string, unknown>, signal?: AbortSignal) => {
        if (provider !== PI) return { value: [], errors: [] };
        piOptions = options;
        return collectSessionProvider(provider, safeHome, windowMs, thresholds as never, options, signal);
      }) as never,
      finalizeSessions: ((results: unknown) => results) as never,
      cmux: async () => ({ value: [], errors: [] }),
      notifications: async () => ({ value: [], errors: [] }),
      enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [], rosterComplete: true }),
    };
    const state = new HubState(runner, archiveStore, [], {
      collectors,
      refreshAggregateTimeoutMs: 250,
      piLaunchReader: async () => observations,
    } as never);
    try {
      const snapshot = await state.refresh();
      expect({
        ids: snapshot.programs.flatMap(({ agents }) => agents).map(({ sourceSessionId }) => sourceSessionId).sort(),
        observations: piOptions?.piLaunchObservations,
        deadline: piOptions?.piReadDeadlineMs,
      }).toEqual({
        ids: ["pi.state-first", "pi.state-second"],
        observations: [...observations].sort((left, right) => left.launchCwd.localeCompare(right.launchCwd)),
        deadline: 250,
      });
    } finally {
      rmSync(safeHome, { recursive: true, force: true });
      rmSync(firstRoot, { recursive: true, force: true });
      rmSync(secondRoot, { recursive: true, force: true });
    }
  });

  test("PI-REPAIR-1B fallback collection receives per-observation CLI and project-setting precedence in the same refresh", async () => {
    const safeHome = mkdtempSync(join(tmpdir(), "formic-pi-fallback-home-"));
    const firstCwd = mkdtempSync(join(tmpdir(), "formic-pi-first-cwd-"));
    const secondCwd = mkdtempSync(join(tmpdir(), "formic-pi-second-cwd-"));
    const cliRoot = mkdtempSync(join(tmpdir(), "formic-pi-cli-root-"));
    const firstProjectRoot = mkdtempSync(join(tmpdir(), "formic-pi-first-project-"));
    const secondProjectRoot = mkdtempSync(join(tmpdir(), "formic-pi-second-project-"));
    const persist = (root: string, id: string) => writeFileSync(join(root, `${id}.jsonl`), [
      JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-08-20T12:00:00.000Z", cwd: `/tmp/${id}` }),
      JSON.stringify({ type: "message", id: `${id}-user`, parentId: null, timestamp: "2026-08-20T12:00:01.000Z", message: { role: "user", content: id, timestamp: 1_787_227_201_000 } }),
      JSON.stringify({ type: "message", id: `${id}-answer`, parentId: `${id}-user`, timestamp: "2026-08-20T12:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: `${id} answer` }], provider: "anthropic", model: "claude-opus-5", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, stopReason: "stop", timestamp: 1_787_227_202_000 } }),
      "",
    ].join("\n"));
    mkdirSync(join(firstCwd, ".pi"));
    mkdirSync(join(secondCwd, ".pi"));
    writeFileSync(join(firstCwd, ".pi/settings.json"), JSON.stringify({ sessionDir: firstProjectRoot }));
    writeFileSync(join(secondCwd, ".pi/settings.json"), JSON.stringify({ sessionDir: secondProjectRoot }));
    persist(cliRoot, "pi.cli-only-first");
    persist(firstProjectRoot, "pi.project-must-lose");
    persist(secondProjectRoot, "pi.project-second");
    const observations = [
      { launchCwd: firstCwd, cliSessionDir: cliRoot },
      { launchCwd: secondCwd },
    ];
    let fallbackOptions: Record<string, unknown> | undefined;
    const collectors: HubCollectors = {
      sessions: (async (_home: string, windowMs: number, thresholds: unknown, options: Record<string, unknown>, signal?: AbortSignal) => {
        fallbackOptions = options;
        const results = resultMap();
        results[PI] = await collectSessionProvider(PI, safeHome, windowMs, thresholds as never, options, signal);
        return results;
      }) as never,
      cmux: async () => ({ value: [], errors: [] }),
      notifications: async () => ({ value: [], errors: [] }),
      enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [], rosterComplete: true }),
    };
    const state = new HubState(runner, archiveStore, [], {
      collectors,
      refreshAggregateTimeoutMs: 250,
      piLaunchReader: async () => observations,
    } as never);
    try {
      const snapshot = await state.refresh();
      expect({
        ids: snapshot.programs.flatMap(({ agents }) => agents).map(({ sourceSessionId }) => sourceSessionId).sort(),
        observations: fallbackOptions?.piLaunchObservations,
        deadline: fallbackOptions?.piReadDeadlineMs,
      }).toEqual({
        ids: ["pi.cli-only-first", "pi.project-second"],
        observations,
        deadline: 250,
      });
    } finally {
      for (const root of [safeHome, firstCwd, secondCwd, cliRoot, firstProjectRoot, secondProjectRoot]) {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  test("PI-REPAIR-1C canonical launch evidence and deadline participate in the provider settlement key", () => {
    const key = providerCollectionConfigKey as unknown as (...args: unknown[]) => string;
    const prefix = [10_000, undefined, [], [], [], [], [], [], []];
    const first = { launchCwd: "/tmp/a", cliSessionDir: "/tmp/a-sessions" };
    const second = { launchCwd: "/tmp/b" };
    const baseline = key(...prefix, [first, second], 250);
    const reordered = key(...prefix, [second, first], 250);
    const changedLaunch = key(...prefix, [{ ...first, cliSessionDir: "/tmp/changed" }, second], 250);
    const changedDeadline = key(...prefix, [first, second], 251);

    expect({ orderStable: baseline === reordered, launchChangesKey: baseline !== changedLaunch, deadlineChangesKey: baseline !== changedDeadline })
      .toEqual({ orderStable: true, launchChangesKey: true, deadlineChangesKey: true });
  });

  test("PI-REPAIR-1D changed same-refresh launch evidence cannot reuse an older pending Pi settlement", async () => {
    let observations = [{ launchCwd: "/tmp/launch-a", cliSessionDir: "/tmp/root-a" }];
    let piCalls = 0;
    const collectors: HubCollectors = {
      sessions: async () => resultMap(),
      sessionProvider: (async (provider: Provider) => {
        if (provider !== PI) return { value: [], errors: [] };
        piCalls += 1;
        if (piCalls === 1) return new Promise(() => {});
        return { value: [piAgent({ sourceSessionId: "pi.changed-launch", id: "pi:pi.changed-launch" })], errors: [] };
      }) as never,
      finalizeSessions: ((results: unknown) => results) as never,
      cmux: async () => ({ value: [], errors: [] }),
      notifications: async () => ({ value: [], errors: [] }),
      enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [], rosterComplete: true }),
    };
    const state = new HubState(runner, archiveStore, [], {
      collectors,
      refreshAggregateTimeoutMs: 10,
      piLaunchReader: async () => observations,
    } as never);

    await state.refresh();
    observations = [{ launchCwd: "/tmp/launch-b", cliSessionDir: "/tmp/root-b" }];
    const second = await state.refresh();
    expect({
      piCalls,
      ids: second.programs.flatMap(({ agents }) => agents).map(({ sourceSessionId }) => sourceSessionId),
    }).toEqual({ piCalls: 2, ids: ["pi.changed-launch"] });
  }, 2_000);

  test("PI-REPAIR-1E production Pi launch reader accepts only exact binaries and space-form session-dir", async () => {
    const commands: string[][] = [];
    let piOptions: Record<string, unknown> | undefined;
    const processRunner: CommandRunner = {
      run: async (command, _timeoutMs, signal) => {
        if (signal?.aborted) throw signal.reason;
        commands.push([...command]);
        if (command.includes("ps")) {
          return {
            exitCode: 0,
            stdout: [
              "101 ?? pi --session-dir /tmp/pi-one",
              "102 ?? /usr/local/bin/pi --session-dir \"/tmp/pi two\"",
              "103 ?? pilot --session-dir /tmp/pilot",
              "104 ?? pi-helper --session-dir /tmp/helper",
              "105 ?? pi --session-dir=/tmp/equals-refused",
            ].join("\n"),
            stderr: "",
            timedOut: false,
          };
        }
        return {
          exitCode: 0,
          stdout: "p101\nfcwd\nn/tmp/launch-one\np102\nfcwd\nn/tmp/launch-two\np105\nfcwd\nn/tmp/launch-equals\n",
          stderr: "",
          timedOut: false,
        };
      },
    };
    const collectors: HubCollectors = {
      sessions: async () => resultMap(),
      sessionProvider: (async (provider: Provider, _home: string, _windowMs: number, _thresholds: unknown, options: Record<string, unknown>) => {
        if (provider === PI) piOptions = options;
        return { value: [], errors: [] };
      }) as never,
      finalizeSessions: ((results: unknown) => results) as never,
      cmux: async () => ({ value: [], errors: [] }),
      notifications: async () => ({ value: [], errors: [] }),
      enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [], rosterComplete: true }),
    };
    const state = new HubState(processRunner, archiveStore, [], { collectors });
    await state.refresh();

    expect({ observations: piOptions?.piLaunchObservations, commands }).toEqual({
      observations: [
        { launchCwd: "/tmp/launch-equals" },
        { launchCwd: "/tmp/launch-one", cliSessionDir: "/tmp/pi-one" },
        { launchCwd: "/tmp/launch-two", cliSessionDir: "/tmp/pi two" },
      ],
      commands: [
        ["env", "LC_ALL=C", "ps", "-axo", "pid=,tty=,command="],
        ["/usr/sbin/lsof", "-n", "-P", "-a", "-p", "101,102,105", "-d", "cwd", "-Fn"],
      ],
    });
  });

  test("PI-REPAIR-1F production Pi launch reader rethrows the exact caller abort reason", async () => {
    let nowMs = 1_000;
    const originalNow = Date.now;
    Date.now = () => nowMs;
    const logged = spyOn(console, "error").mockImplementation(() => {});
    let psCalls = 0;
    let runnerAbortReason: unknown;
    let abandonedReason: unknown;
    let cancelledResultReturned = false;
    const piProviderSignals: boolean[] = [];
    const processRunner: CommandRunner = {
      run: async (command, _timeoutMs, signal) => {
        if (!command.includes("ps")) {
          return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
        }
        psCalls += 1;
        if (psCalls > 1) return { exitCode: 0, stdout: "", stderr: "", timedOut: false };
        return new Promise((resolve) => {
          signal?.addEventListener("abort", () => {
            runnerAbortReason = signal.reason;
            cancelledResultReturned = true;
            resolve({ exitCode: -1, stdout: "", stderr: "", timedOut: false, cancelled: true });
          }, { once: true });
        });
      },
    };
    const collectors: HubCollectors = {
      sessions: async () => resultMap(),
      sessionProvider: (async (provider: Provider, ...args: unknown[]) => {
        if (provider !== PI) return { value: [], errors: [] };
        const signal = args.at(-1) as AbortSignal;
        piProviderSignals.push(signal.aborted);
        return { value: [piAgent({ displayName: "Replacement Pi" })], errors: [] };
      }) as never,
      finalizeSessions: ((results: unknown) => results) as never,
      cmux: async () => ({ value: [], errors: [] }),
      notifications: async () => ({ value: [], errors: [] }),
      enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [], rosterComplete: true }),
    };
    const state = new HubState(processRunner, archiveStore, [], { collectors });
    try {
      const abandoned = state.refresh().catch((error) => {
        abandonedReason = error;
      });
      for (let turn = 0; turn < 20 && psCalls === 0; turn += 1) await Promise.resolve();
      nowMs = 14_001;
      const replacement = await state.refresh();
      await abandoned;

      expect({
        psCalls,
        cancelledResultReturned,
        piProviderSignals,
        externalReasonIsWatchdog: abandonedReason instanceof Error && abandonedReason === runnerAbortReason,
        externalMessage: abandonedReason instanceof Error ? abandonedReason.message : undefined,
        runnerMessage: runnerAbortReason instanceof Error ? runnerAbortReason.message : undefined,
        ids: replacement.programs.flatMap(({ agents }) => agents).map(({ sourceSessionId }) => sourceSessionId),
      }).toEqual({
        psCalls: 2,
        cancelledResultReturned: true,
        piProviderSignals: [false],
        externalReasonIsWatchdog: true,
        externalMessage: "refresh superseded by watchdog",
        runnerMessage: "refresh superseded by watchdog",
        ids: [ID],
      });
    } finally {
      logged.mockRestore();
      Date.now = originalNow;
    }
  });

  test("discarded Pi provider generation cannot stage its late result for a replacement scan", async () => {
    const coordinator = new ProviderSettlementCoordinator<Provider, string>(() => true);
    let release!: (value: string) => void;
    const pending = new Promise<string>((resolve) => { release = resolve; });
    let cutoff!: () => void;
    const first = coordinator.settle([PI], () => pending, {
      waitMs: 1,
      wait: () => new Promise<void>((resolve) => { cutoff = resolve; }),
    });
    await Promise.resolve();
    cutoff();
    expect((await first).timedOut).toEqual([PI]);
    coordinator.discardInFlight();
    release("discarded-pi-result");
    await Promise.resolve();

    const second = await coordinator.settle([PI], async () => "replacement-pi-result", { waitMs: 10 });
    expect(second.current).toEqual({ pi: "replacement-pi-result" });
    expect(second.lastKnown).toEqual({});
  });

  test("HubState watchdog aborts Pi with its exact reason and publishes only the replacement generation", async () => {
    let nowMs = 1_000;
    const originalNow = Date.now;
    Date.now = () => nowMs;
    const logged = spyOn(console, "error").mockImplementation(() => {});
    const calls = new Map<string, number>();
    let piAbortReason: unknown;
    let markFirstPiStarted!: () => void;
    const firstPiStarted = new Promise<void>((resolve) => { markFirstPiStarted = resolve; });
    const sessionProvider = async (provider: Provider, ...args: any[]) => {
      const signal = args.at(-1) as AbortSignal;
      const count = (calls.get(provider) ?? 0) + 1;
      calls.set(provider, count);
      if (provider === PI && count === 1) markFirstPiStarted();
      if (count === 1 && (provider === PI || provider === "codex")) {
        return new Promise<any>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            if (provider === PI) piAbortReason = signal.reason;
            reject(signal.reason);
          }, { once: true });
        });
      }
      return { value: provider === PI ? [piAgent({ displayName: "Replacement Pi" })] : [], errors: [] };
    };
    const collectors: HubCollectors = {
      sessions: async () => resultMap(),
      sessionProvider: sessionProvider as never,
      finalizeSessions: ((results: unknown) => results) as never,
      cmux: async () => ({ value: [], errors: [] }),
      notifications: async () => ({ value: [], errors: [] }),
      enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [], rosterComplete: true }),
    };
    const state = new HubState(runner, archiveStore, [], {
      collectors,
      piLaunchReader: async () => [],
    });
    try {
      const abandoned = state.refresh();
      await firstPiStarted;
      nowMs = 14_001;
      const replacement = await state.refresh();
      await abandoned;

      expect(calls.get(PI)).toBe(2);
      expect(piAbortReason).toBeInstanceOf(Error);
      expect((piAbortReason as Error).message).toBe("refresh superseded by watchdog");
      expect(replacement.programs.flatMap(({ agents }) => agents).map(({ id }) => id)).toContain(`pi:${ID}`);
      expect(replacement.controlHealth.errors.some((error) => /pi.*supersed|pi.*abort/i.test(error))).toBeFalse();
      expect(replacement.totals.sourceHealth?.byProvider?.[PI]).toMatchObject({ healthy: true });
    } finally {
      logged.mockRestore();
      Date.now = originalNow;
    }
  }, 5_000);
});
