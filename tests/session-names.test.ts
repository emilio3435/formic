import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  JsonSessionNameStore,
  cleanModelTitle,
  distillName,
  nameSessions,
  namingPrompt,
  type NamerModel,
  type SessionNameFileOperations,
} from "../src/server/session-names";
import { buildSnapshot } from "../src/server/snapshot";
import { HubState, type HubCollectors } from "../src/server/state";
import type { ArchiveStore, CollectedAgent, CommandRunner } from "../src/server/types";

/* Naming puts a model in the path of what every row on the board is called, so
   what is worth testing is not that it works — it is what happens when it does
   not. Every layer here is allowed to fail, and the board is required to keep
   rendering when it does. */

function memoryFiles(seed: Record<string, string> = {}) {
  const contents = new Map(Object.entries(seed));
  const files: SessionNameFileOperations = {
    readText: async (path) => {
      const value = contents.get(path);
      if (value === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return value;
    },
    makeDirectory: async () => {},
    writeText: async (path, value) => { contents.set(path, value); },
    rename: async (from, to) => {
      const value = contents.get(from);
      if (value === undefined) throw new Error("missing temporary file");
      contents.set(to, value);
      contents.delete(from);
    },
  };
  return { files, contents };
}

const PATH = "/virtual/session-names.json";

describe("the store survives what it will actually meet", () => {
  test("a first run with no file at all is not an error", () => {
    return JsonSessionNameStore.open(PATH, memoryFiles().files).then((store) => {
      expect(store.size()).toBe(0);
      expect(store.loadError()).toBeUndefined();
    });
  });

  test("a corrupt file loses the names, not the board", async () => {
    /* The failure that must never be fatal: this file is a cache of titles. A
       board that refuses to start because it cannot read one is strictly worse
       than a board that starts having forgotten them. */
    const { files } = memoryFiles({ [PATH]: "{ this is not json" });
    const store = await JsonSessionNameStore.open(PATH, files);
    expect(store.size()).toBe(0);
    expect(store.loadError()).toBeDefined();
  });

  test("a file whose entries are the wrong shape keeps the ones that are not", async () => {
    const { files } = memoryFiles({
      [PATH]: JSON.stringify({
        names: {
          "codex:good": { name: "Fix the routing bug", by: "launch-env", at: "2026-08-04T00:00:00.000Z" },
          "codex:empty": { name: "   " },
          "codex:missing": { by: "launch-env" },
          "codex:wrong": 42,
        },
      }),
    });
    const store = await JsonSessionNameStore.open(PATH, files);
    expect(store.size()).toBe(1);
    expect(store.get("codex:good")?.name).toBe("Fix the routing bug");
  });

  test("a name is written once and never rewritten", async () => {
    /* The property the whole naming contract rests on. A namer that revised its
       opinion each pass would reintroduce precisely the drift the contract was
       built to remove. */
    const { files } = memoryFiles();
    const store = await JsonSessionNameStore.open(PATH, files);
    await store.remember("codex:a", { name: "First answer", by: "launch-env", at: "2026-08-04T00:00:00.000Z" });
    await store.remember("codex:a", { name: "Second thoughts", by: "launch-env", at: "2026-08-04T01:00:00.000Z" });
    expect(store.get("codex:a")?.name).toBe("First answer");
  });

  test("a write that cannot land does not throw into the caller", async () => {
    const { files } = memoryFiles();
    const store = await JsonSessionNameStore.open(PATH, {
      ...files,
      writeText: async () => { throw new Error("disk full"); },
    });
    await store.remember("codex:a", { name: "Still remembered in memory", by: "launch-env", at: "x" });
    // The name is usable this session even though it could not be persisted.
    expect(store.get("codex:a")?.name).toBe("Still remembered in memory");
  });

  test("names persist across a restart", async () => {
    const { files } = memoryFiles();
    const first = await JsonSessionNameStore.open(PATH, files);
    await first.remember("codex:a", { name: "Close the PR 387 races", by: "launch-env", at: "2026-08-04T00:00:00.000Z" });
    const second = await JsonSessionNameStore.open(PATH, files);
    expect(second.get("codex:a")?.name).toBe("Close the PR 387 races");
  });

  test("the temporary file never survives a successful write", async () => {
    /* Temp-then-rename is what keeps a crash mid-write from leaving a truncated
       file the next boot would refuse. */
    const { files, contents } = memoryFiles();
    const store = await JsonSessionNameStore.open(PATH, files);
    await store.remember("codex:a", { name: "Something worth keeping", by: "launch-env", at: "x" });
    expect([...contents.keys()]).toEqual([PATH]);
  });
});

describe("the heuristic refuses to publish boilerplate as somebody's work", () => {
  /* Every string below was measured in a live transcript on this machine while
     building this. Four rounds of filtering each uncovered another family, which
     is the evidence that the heuristic is a floor and the model is the answer. */
  const REJECTED = [
    "<recommended_plugins>\nHere is a list of plugins that are available but not installed",
    "# AGENTS.md instructions for /Users/emilionunezgarcia",
    ">>> TRANSCRIPT START\nsome quoted session",
    "Response MUST end with a remark-directive block",
    "You are `/root`, the primary agent",
    "Filesystem sandboxing defines which files can be read",
    "Memory",
    "Read",
    "continue",
    "<system-reminder>do the thing</system-reminder>",
  ];

  for (const text of REJECTED) {
    test(`rejects ${JSON.stringify(text.slice(0, 42))}`, () => {
      expect(distillName([text])).toBeUndefined();
    });
  }

  test("keeps a real request", () => {
    expect(distillName(["Fix the two independently reproduced P1 races in PR #387"]))
      .toBe("Fix the two independently reproduced P1 races in PR #387");
  });

  test("walks past the scaffolding to the message that states the work", () => {
    /* The shape of a real Codex session: config, then an injected plugin block,
       then finally the operator. */
    expect(distillName([
      "<recommended_plugins>\nHere is a list of plugins",
      "# AGENTS.md instructions for /Users/x",
      "Goal: Close the final same-binding Watch regression",
    ])).toBe("Close the final same-binding Watch regression");
  });

  test("a heading prefix is stripped rather than becoming part of the name", () => {
    expect(distillName(["Task: Rebuild the settings cockpit"])).toBe("Rebuild the settings cockpit");
  });

  test("one sentence is a name; a paragraph is not", () => {
    expect(distillName(["Rewrite the archive store. Then run the full suite and report back."]))
      .toBe("Rewrite the archive store");
  });
});

describe("the model is treated as untrusted input", () => {
  /* It is a small local model being asked for a label. It will sometimes answer
     with a refusal, a quote, or a paragraph explaining itself — and every one of
     those would become the title of somebody's work if taken at face value. */
  test("UNKNOWN means it could not tell, not that the session is called UNKNOWN", () => {
    expect(cleanModelTitle("UNKNOWN")).toBeUndefined();
  });

  test("a model that explains itself is refused", () => {
    expect(cleanModelTitle("Here is a title for the session: Fix the bug")).toBeUndefined();
    expect(cleanModelTitle("I cannot determine a title from this text")).toBeUndefined();
  });

  test("a paragraph is not a label", () => {
    expect(cleanModelTitle("This session appears to be about fixing a rather long list of unrelated problems in the renderer"))
      .toBeUndefined();
  });

  test("quotes and trailing punctuation are stripped", () => {
    expect(cleanModelTitle('"Fix the routing bug."')).toBe("Fix the routing bug");
  });

  test("a label with a prefix the prompt forbade is still salvaged", () => {
    expect(cleanModelTitle("Title: Rebuild the settings cockpit")).toBe("Rebuild the settings cockpit");
  });

  test("an empty or one-word answer is refused", () => {
    expect(cleanModelTitle("")).toBeUndefined();
    expect(cleanModelTitle("Fix")).toBeUndefined();
  });
});

describe("naming degrades instead of failing", () => {
  const dead: NamerModel = { title: async () => undefined };
  const broken: NamerModel = { title: async () => { throw new Error("connection refused"); } };
  const good: NamerModel = { title: async () => "Close the PR 387 renderer races" };

  const candidate = (key: string) => ({
    key,
    messages: ["Fix the two independently reproduced P1 races in PR #387"],
  });

  test("a model that is simply not running falls back to the heuristic", async () => {
    const store = await JsonSessionNameStore.open(PATH, memoryFiles().files);
    await nameSessions([candidate("codex:a")], { store, model: dead });
    expect(store.get("codex:a")?.name).toBe("Fix the two independently reproduced P1 races in PR #387");
  });

  test("a model that throws does not take the naming pass down with it", async () => {
    const store = await JsonSessionNameStore.open(PATH, memoryFiles().files);
    const named = await nameSessions([candidate("codex:a")], { store, model: broken });
    /* The pass survives; this session simply keeps the derived name it already
       had, which is the outcome the board is required to tolerate. */
    expect(named).toBe(0);
    expect(store.has("codex:a")).toBe(false);
  });

  test("one bad session does not stop the ones after it", async () => {
    let call = 0;
    const flaky: NamerModel = {
      title: async () => {
        call += 1;
        if (call === 1) throw new Error("boom");
        return "Rebuild the settings cockpit";
      },
    };
    const store = await JsonSessionNameStore.open(PATH, memoryFiles().files);
    await nameSessions([candidate("codex:a"), candidate("codex:b")], { store, model: flaky });
    expect(store.has("codex:b")).toBe(true);
  });

  test("a session with nothing but boilerplate is left with its derived name", async () => {
    const store = await JsonSessionNameStore.open(PATH, memoryFiles().files);
    await nameSessions(
      [{ key: "codex:a", messages: ["<recommended_plugins>\nHere is a list of plugins"] }],
      { store, model: dead },
    );
    expect(store.has("codex:a")).toBe(false);
  });

  test("the model outranks the heuristic when both answer", async () => {
    /* The model can tell an instruction from a preamble, which pattern matching
       repeatedly could not. */
    const store = await JsonSessionNameStore.open(PATH, memoryFiles().files);
    await nameSessions([candidate("codex:a")], { store, model: good });
    expect(store.get("codex:a")?.name).toBe("Close the PR 387 renderer races");
  });

  test("an already-named session is never asked about again", async () => {
    let calls = 0;
    const counting: NamerModel = { title: async () => { calls += 1; return "A perfectly good name"; } };
    const store = await JsonSessionNameStore.open(PATH, memoryFiles().files);
    await nameSessions([candidate("codex:a")], { store, model: counting });
    await nameSessions([candidate("codex:a")], { store, model: counting });
    expect(calls).toBe(1);
  });

  test("a backlog is bounded so it cannot saturate the model", async () => {
    let calls = 0;
    const counting: NamerModel = { title: async () => { calls += 1; return "A perfectly good name"; } };
    const store = await JsonSessionNameStore.open(PATH, memoryFiles().files);
    const many = Array.from({ length: 50 }, (_, index) => candidate(`codex:${index}`));
    await nameSessions(many, { store, model: counting, limit: 5 });
    expect(calls).toBe(5);
  });

  test("the prompt never carries injected scaffolding to the model", () => {
    const prompt = namingPrompt([
      "<recommended_plugins>\nHere is a list of plugins",
      "Fix the renderer races",
    ]);
    expect(prompt).not.toContain("recommended_plugins");
    expect(prompt).toContain("Fix the renderer races");
  });
});

describe("hub naming candidates", () => {
  test("sdk-launched sessions bypass out-of-band naming while cli work is still named", async () => {
    const directory = mkdtempSync(join(tmpdir(), "anthill-session-kind-naming-"));
    const transcript = join(directory, "session.jsonl");
    writeFileSync(transcript, JSON.stringify({
      type: "user",
      sessionId: "fixture",
      message: { role: "user", content: "Fix the lifecycle settings contract." },
    }));
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      response: "Fix lifecycle settings contract",
    })));

    try {
      const agent = (id: string, launch: CollectedAgent["launch"]): CollectedAgent => ({
        id,
        provider: "claude",
        sourceSessionId: id.split(":")[1]!,
        displayName: "Claude · fixture",
        launch,
        task: "Fix the lifecycle settings contract.",
        status: "running",
        statusReason: "Fixture activity is recent.",
        updatedAt: new Date().toISOString(),
        tokens: { provenance: "unknown" },
        artifacts: [{ label: "CLAUDE transcript", path: transcript, kind: "transcript" }],
        gates: [],
      });
      const sdk = agent("claude:sdk-review", { entrypoint: "sdk-py", promptSource: "sdk" });
      const cli = agent("claude:cli-work", { entrypoint: "cli" });
      const collectors: HubCollectors = {
        sessions: async () => ({
          omp: { value: [], errors: [] },
          codex: { value: [], errors: [] },
          claude: { value: [sdk, cli], errors: [] },
          cursor: { value: [], errors: [] },
          factory: { value: [], errors: [] },
          prime: { value: [], errors: [] },
          grok: { value: [], errors: [] },
          hermes: { value: [], errors: [] },
          muse: { value: [], errors: [] },
          antigravity: { value: [], errors: [] },
          copilot: { value: [], errors: [] },
        }),
        cmux: async () => ({ value: [], errors: [] }),
        notifications: async () => ({ value: [], errors: [] }),
        enrichIdentity: async (surfaces) => ({ value: [...surfaces], errors: [] }),
      };
      const runner: CommandRunner = {
        run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
      };
      const names = await JsonSessionNameStore.open(PATH, memoryFiles().files);
      const archive: ArchiveStore = { has: () => false, archive: async () => {} };
      const state = new HubState(runner, archive, [], { collectors, sessionNames: names });

      await state.refresh();
      for (let attempt = 0; attempt < 50 && !names.has(cli.id); attempt += 1) await Bun.sleep(1);

      expect(names.has(cli.id)).toBe(true);
      expect(names.has(sdk.id)).toBe(false);
    } finally {
      fetchSpy.mockRestore();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("an authored title reaches the board and outranks the folder", () => {
  const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
  const NOW = Date.parse("2026-08-04T12:00:00.000Z");

  const agent = (id: string, base: string): CollectedAgent => ({
    id,
    provider: "codex",
    sourceSessionId: id.split(":")[1]!,
    displayName: base,
    identity: { name: base, base, source: "origin-cwd" },
    cwd: "/Users/ant/Developer/lanes",
    status: "running",
    statusReason: "recent",
    updatedAt: "2026-08-04T11:59:00.000Z",
    tokens: { total: 1, provenance: "observed" },
    artifacts: [],
    gates: [],
  });

  const namesOf = (input: Parameters<typeof buildSnapshot>[0]) =>
    buildSnapshot(input).programs.flatMap((p) => p.agents).map((a) => a.identity?.name);

  test("a remembered title replaces the derived one", () => {
    const names = namesOf({
      agents: [agent("codex:aaaa1111", "Codex · lanes")],
      sessionNames: () => ({ name: "Close the PR 387 races", by: "launch-env", at: "x" }),
      surfaces: [],
      archiveStore,
      now: new Date(NOW),
    });
    expect(names).toEqual(["Close the PR 387 races"]);
  });

  test("a later task outranks a stale launch-env title on a resumed pane", () => {
    /* Live :4701 2026-08-16: claude:09958d2e kept "System Cleanup and
       Initialization" from launch-env while the pane's current task was
       today's work. Write-once naming froze the leftover; the overlay then
       published it as identity.name, so search and the inspector showed the
       weeks-old title beside the current deploy. */
    const resumed = {
      ...agent("claude:09958d2e-5c72-4111-a5c7-95a0fdb767c0", "Claude · cooper-scheduler"),
      provider: "claude" as const,
      originCwd: "/Users/ant/Developer/cooper-scheduler",
      cwd: "/Users/ant/Developer/cooper-scheduler",
      task: "Ship the current cooper-scheduler review",
    };
    const published = buildSnapshot({
      agents: [resumed],
      sessionNames: () => ({
        name: "System Cleanup and Initialization",
        by: "launch-env",
        at: "2026-07-01T00:00:00.000Z",
      }),
      surfaces: [],
      archiveStore,
      now: new Date(NOW),
    }).programs.flatMap((program) => program.agents)[0];

    expect(published?.identity?.name).toBe("Ship the current cooper-scheduler review");
    expect(published?.identity?.source).toBe("task");
    expect(published?.identity?.authoredBy).toBeUndefined();
    expect(published?.identity?.name).not.toContain("System Cleanup");
  });

  test("sessions the namer has not reached yet keep working alongside ones it has", () => {
    /* Naming is out of band, so a board mid-pass has both. Neither may break. */
    const names = namesOf({
      agents: [agent("codex:aaaa1111", "Codex · lanes"), agent("codex:bbbb2222", "Codex · lanes")],
      sessionNames: (id) =>
        id === "codex:aaaa1111" ? { name: "Close the PR 387 races", by: "launch-env", at: "x" } : undefined,
      surfaces: [],
      archiveStore,
      now: new Date(NOW),
    });
    expect(names).toContain("Close the PR 387 races");
    expect(names).toContain("Codex · lanes");
    expect(new Set(names).size).toBe(2);
  });

  test("two sessions given the same title are still told apart", () => {
    /* Real: 43 subagents genuinely all say "Review this change for security
       vulnerabilities". Sharing a title is correct; sharing a NAME is not. */
    const names = namesOf({
      agents: [agent("codex:aaaa1111", "Codex · lanes"), agent("codex:bbbb2222", "Codex · lanes")],
      sessionNames: () => ({ name: "Review this change for security", by: "launch-env", at: "x" }),
      surfaces: [],
      archiveStore,
      now: new Date(NOW),
    });
    expect(new Set(names).size).toBe(2);
    for (const name of names) expect(name).toMatch(/^Review this change for security #/);
  });

  test("no lookup at all leaves every derived name exactly as it was", () => {
    const names = namesOf({
      agents: [agent("codex:aaaa1111", "Codex · lanes")],
      surfaces: [],
      archiveStore,
      now: new Date(NOW),
    });
    expect(names).toEqual(["Codex · lanes"]);
  });
});

/* Cursor transcripts open with <timestamp>…</timestamp> blocks around the real
   words. Measured live 2026-08-05: cursor:98191ac2 sat on the board NAMED
   "<timestamp>Tuesday, Aug 4, 2026, 6:10 PM (UTC-5)</timestamp>" — the namer
   read the clock, the store froze it, and write-once made the pollution
   permanent. The clock is transport, never identity, at every ingress. */
describe("timestamp markup never becomes identity", () => {
  const CLOCK = "<timestamp>Tuesday, Aug 4, 2026, 6:10 PM (UTC-5)</timestamp>";

  test("a model title that is only the clock is no title at all", () => {
    expect(cleanModelTitle(CLOCK)).toBeUndefined();
  });

  test("the heuristic names the work, not the clock above it", () => {
    expect(distillName([`${CLOCK}\nFix the login redirect loop on staging`]))
      .toBe("Fix the login redirect loop on staging");
  });

  test("the model is never shown the clock", () => {
    expect(namingPrompt([`${CLOCK}\nFix the login redirect loop on staging`]))
      .not.toContain("<timestamp");
  });

  test("a stored name that is pure markup is dropped on load, so the session can be renamed", async () => {
    const { files } = memoryFiles({
      [PATH]: JSON.stringify({
        names: { "cursor:polluted": { name: CLOCK, by: "launch-env", at: "2026-08-04T23:10:00.000Z" } },
      }),
    });
    const store = await JsonSessionNameStore.open(PATH, files);
    expect(store.has("cursor:polluted")).toBe(false);
  });

  test("remember() strips an embedded clock and refuses a name that was nothing else", async () => {
    const { files } = memoryFiles();
    const store = await JsonSessionNameStore.open(PATH, files);
    await store.remember("codex:mixed", { name: `Fix login ${CLOCK} bug`, by: "launch-env", at: "x" });
    expect(store.get("codex:mixed")?.name).toBe("Fix login bug");
    await store.remember("codex:pure", { name: CLOCK, by: "launch-env", at: "x" });
    expect(store.has("codex:pure")).toBe(false);
  });
});
