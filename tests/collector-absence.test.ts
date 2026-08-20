import { describe, expect, test } from "bun:test";
import { PROVIDERS } from "../src/shared/types";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { BunCommandRunner } from "../src/server/command";
import { collectCmux, executableMissing } from "../src/server/cmux";
import { collectSessionProvider, collectSessions } from "../src/server/collectors";
import { emptySnapshot } from "../src/server/app";
import { buildSnapshot } from "../src/server/snapshot";
import type { ArchiveStore, CommandResult, CommandRunner } from "../src/server/types";

/* ABSENT is not DEGRADED, and the first screen a newcomer sees depended on it.

   The docs lane walked a virgin clone with an empty HOME, no cmux binary and an
   empty burnbar database. Everything passed until the board itself, which read:

     "No sessions found — and not every collector can see."
     "A degraded collector reports no sessions whether or not any are running,
      so this board is incomplete rather than empty."
     "1 of 4 collectors degraded"

   Nothing was wrong. The one was cmux, missing because it had never been
   installed. Degraded means "this is here and I cannot read it" — a fault worth
   alarming about. Absent means "there is nothing here to read, because this
   person does not use Cursor" — not a fault at all. We collapsed them and told
   a first-time user their working install was broken.

   The same honesty rule as the rest of the board, pointed outward instead of at
   ourselves: every other fix today removed a number that overclaimed. This one
   underclaimed, on the only first impression the project gets. */

const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };

const emptyHome = (): string => mkdtempSync(join(tmpdir(), "anthill-virgin-home-"));

const health = (input: Parameters<typeof buildSnapshot>[0]) =>
  buildSnapshot(input).totals.sourceHealth!;

describe("a provider that was never installed is absent, not degraded", () => {
  test("an empty HOME produces no collector errors at all", async () => {
    /* The premise the rest of this rests on, measured rather than assumed. If a
       missing directory DID raise an error, the fix would have to be in the
       collectors instead, and this test says which. */
    const result = await collectSessions(emptyHome());

    for (const [provider, collection] of Object.entries(result)) {
      expect(collection.errors, `${provider} treats a missing directory as a fault`).toEqual([]);
      expect(collection.value).toEqual([]);
    }
  });

  test("an empty HOME reports every provider absent", async () => {
    const result = await collectSessions(emptyHome());

    for (const [provider, collection] of Object.entries(result)) {
      expect(collection.absent, `${provider} does not report itself absent`).toBe(true);
    }
  });

  test("a provider whose directory EXISTS is present, even with nothing in it", async () => {
    /* The distinction that makes `absent` mean something. A freshly installed
       Claude Code with no sessions yet is present and healthy — it would report
       an empty list either way, so absence cannot be inferred from emptiness. */
    const home = emptyHome();
    mkdirSync(join(home, ".claude/projects"), { recursive: true });

    const result = await collectSessions(home);

    expect(result.claude.absent).toBeUndefined();
    expect(result.claude.errors).toEqual([]);
    expect(result.codex.absent).toBe(true);
  });

  test("grok distinguishes a missing home without claiming sessions", async () => {
    const home = emptyHome();
    expect(await collectSessionProvider("grok", home))
      .toEqual({ value: [], errors: [], absent: true });
    mkdirSync(join(home, ".grok"));
    expect(await collectSessionProvider("grok", home))
      .toEqual({ value: [], errors: [] });
  });

  test("Muse is absent only when its data dir is missing", async () => {
    const home = emptyHome();
    expect(await collectSessionProvider("muse", home))
      .toEqual({ value: [], errors: [], absent: true });
    mkdirSync(join(home, ".local/share/muse"), { recursive: true });
    expect(await collectSessionProvider("muse", home))
      .toEqual({ value: [], errors: [] });
  });

  test("Copilot is absent only when its home is missing", async () => {
    const home = emptyHome();
    expect(await collectSessionProvider("copilot", home))
      .toEqual({ value: [], errors: [], absent: true });
    mkdirSync(join(home, ".copilot"));
    expect(await collectSessionProvider("copilot", home))
      .toEqual({ value: [], errors: [] });
  });

  test("Antigravity is absent only when all three trees are missing", async () => {
    for (const tree of [".gemini/antigravity-cli", ".gemini/antigravity", ".gemini/antigravity-ide"]) {
      const home = emptyHome();
      expect(await collectSessionProvider("antigravity", home))
        .toEqual({ value: [], errors: [], absent: true });
      mkdirSync(join(home, tree), { recursive: true });
      expect(await collectSessionProvider("antigravity", home))
        .toEqual({ value: [], errors: [] });
    }
  });

  test("Hermes is absent only when its home is missing", async () => {
    const home = emptyHome();
    expect(await collectSessionProvider("hermes", home))
      .toEqual({ value: [], errors: [], absent: true });
    /* Cron is a real Hermes source even when the optional interactive store is
       dormant, so a home containing only cron is present rather than absent. */
    mkdirSync(join(home, ".hermes/cron"), { recursive: true });
    expect(await collectSessionProvider("hermes", home))
      .toEqual({ value: [], errors: [] });
  });

  test("GROK_HOME overrides the default Grok home", async () => {
    const root = join(emptyHome(), "custom-grok");
    const previous = process.env.GROK_HOME;
    process.env.GROK_HOME = root;

    try {
      expect(await collectSessionProvider("grok", homedir()))
        .toEqual({ value: [], errors: [], absent: true });
      mkdirSync(root);
      expect(await collectSessionProvider("grok", homedir()))
        .toEqual({ value: [], errors: [] });
    } finally {
      if (previous === undefined) delete process.env.GROK_HOME;
      else process.env.GROK_HOME = previous;
    }
  });

  test("an absent provider leaves the health ratio instead of failing it", () => {
    const absent = health({
      agents: [], surfaces: [], archiveStore,
      /* omp named explicitly. The test always meant "every provider absent";
         it could not say so while the health accounting was blind to omp. */
      sourceAbsent: Object.fromEntries(PROVIDERS.map((name) => [name, true])),
      cmuxAbsent: true,
      cmuxReachable: false,
    });

    // Nothing is wrong, so nothing reads as wrong.
    expect(absent.degraded).toBe(0);
    expect(absent.absent).toBe(PROVIDERS.length);
    /* The known set stays the denominator. Absence is a category on that set,
       not a reason to shrink it — shrinking it made total disagree with
       byProvider.length the moment any collector was missing. */
    expect(absent.total).toBe(PROVIDERS.length);
    expect(absent.healthy).toBe(0);
    expect(absent.healthy + absent.degraded + absent.absent).toBe(absent.total);
  });

  test("the fresh-clone board: two providers installed, the rest absent", () => {
    const summary = health({
      agents: [], surfaces: [], archiveStore,
      /* A virgin HOME has no omp directory either — proved above by "an empty
         HOME reports every provider absent", which iterates the shared union. The old
         fixture left omp unstated and the accounting silently read it as
         installed-and-healthy, which is the bug this file now covers. */
      sourceAbsent: { cursor: true, omp: true, factory: true, prime: true, grok: true, hermes: true, muse: true, antigravity: true, copilot: true, gemini: true, opencode: true },
      cmuxAbsent: true,
      cmuxReachable: false,
    });

    // Two present, the rest named absent. The known set is still the total.
    expect(summary).toMatchObject({
      healthy: 2,
      degraded: 0,
      absent: PROVIDERS.length - 2,
      total: PROVIDERS.length,
    });
    expect(summary.healthy + summary.degraded + summary.absent).toBe(summary.total);
  });
});

describe("the health count covers every collector that exists", () => {
  /* Two disjoint sets were both being called four.

     The count (healthy/degraded/absent/total) was computed over a hand-written
     list — codex, claude, cursor — plus cmux. The byProvider breakdown that
     ships beside it on the same card is built from the Provider union, which is
     codex, OMP, claude, cursor. So omp was in the breakdown and never in the
     count, cmux was in the count and never in the breakdown, and both sets
     happened to have four members. "4 of 4 collectors healthy" printed above
     four breakdown rows looked self-consistent for as long as nothing broke.

     omp has a collector (collectors.ts) and reports its own absence like every
     other provider (proved above, "an empty HOME reports every provider
     absent"). Only this accounting could not see it. */

  test("a broken omp collector is degraded, not silently healthy", () => {
    const summary = health({
      agents: [], surfaces: [], archiveStore,
      sourceErrors: { omp: ["EACCES reading the omp session directory"] },
    });

    /* Before the fix this read degraded: 0 — the card said every collector was
       healthy while byProvider.omp.healthy was false on the same screen. */
    expect(summary.degraded).toBe(1);
    expect(summary.healthy).toBe(summary.total - 1);
  });

  test("a cold snapshot marks every known provider degraded", () => {
    expect(emptySnapshot().totals.sourceHealth).toMatchObject({
      healthy: 0,
      degraded: PROVIDERS.length,
      absent: 0,
      total: PROVIDERS.length,
    });
  });

  test("an absent omp is absent, and does not inflate the ratio", () => {
    const summary = health({
      agents: [], surfaces: [], archiveStore,
      sourceAbsent: { omp: true },
    });

    expect(summary.absent).toBe(1);
    expect(summary.total).toBe(PROVIDERS.length);
    expect(summary.healthy + summary.degraded + summary.absent).toBe(summary.total);
  });

  test("healthy + degraded + absent accounts for every known collector", () => {
    /* The identity the card's copy already claims: the three categories are
       mutually exclusive and exhaust the known set. Subtracting absent from
       total made that identity fail the moment a stubbed collector had no home. */
    const summary = health({
      agents: [], surfaces: [], archiveStore,
      sourceErrors: { claude: ["unreadable"] },
      sourceAbsent: { cursor: true, factory: true },
    });

    expect(summary.healthy + summary.degraded + summary.absent).toBe(summary.total);
    expect(summary.total).toBe(PROVIDERS.length);
    expect(summary.degraded).toBe(1);
    expect(summary.absent).toBe(2);
    expect(summary.healthy).toBe(PROVIDERS.length - 3);
  });

  test("an unreachable cmux is not a broken collector", () => {
    /* cmux is the control plane, not a collector. It used to be counted as a
       fifth-that-looked-like-a-fourth, so an unreachable control plane printed
       as a degraded COLLECTOR while `controlHealth.cmuxReachable` said the same
       thing in its own words two cards away. */
    const summary = health({
      agents: [], surfaces: [], archiveStore,
      cmuxReachable: false,
    });

    expect(summary.degraded).toBe(0);
    expect(summary.total).toBe(PROVIDERS.length);
  });
});

describe("a provider that IS present and unreadable still says so, loudly", () => {
  test("an unreadable provider is degraded even though it returned no sessions", () => {
    /* The failure mode the fix must not create. An empty list from a blind
       collector is not an empty fleet, and a board that called that healthy
       would be the false all-clear this project keeps removing. */
    const summary = health({
      agents: [], surfaces: [], archiveStore,
      sourceErrors: { claude: ["/Users/me/.claude/projects: EACCES: permission denied"] },
      cmuxReachable: true,
    });

    expect(summary.degraded).toBe(1);
    expect(summary.absent).toBe(0);
  });

  test("a provider that is both absent AND erroring counts as degraded, not absent", () => {
    /* Errors win. If a directory vanished mid-scan while something else about
       it failed, the fault is the fact worth reporting — absence must never be
       a way for a real error to become invisible. */
    const summary = health({
      agents: [], surfaces: [], archiveStore,
      sourceAbsent: { cursor: true },
      sourceErrors: { cursor: ["cursor state db: SQLITE_CORRUPT"] },
      cmuxReachable: true,
    });

    expect(summary.degraded).toBe(1);
    expect(summary.absent).toBe(0);
  });

  test("cmux installed but failing is loud; cmux missing is not", () => {
    /* The same distinction this file is about, asserted where cmux actually
       lives. cmux is the control plane, not a collector, so a broken one is a
       loud `controlHealth` fault rather than a degraded COLLECTOR — reporting it
       in both places is one fault wearing two labels. What must not change is
       that broken stays loud and missing stays calm. */
    const build = (input: Parameters<typeof buildSnapshot>[0]) => buildSnapshot(input);
    const failing = build({
      agents: [], surfaces: [], archiveStore,
      cmuxReachable: false,
      cmuxErrors: ["cmux terminal discovery exited 1: connection refused"],
    });
    const missing = build({ agents: [], surfaces: [], archiveStore, cmuxAbsent: true, cmuxReachable: false });

    // Broken: named, and named once.
    expect(failing.controlHealth.errors).toContain("cmux terminal discovery exited 1: connection refused");
    expect(failing.controlHealth.cmuxReachable).toBe(false);
    // Missing: nothing to report.
    expect(missing.controlHealth.errors).toEqual([]);

    // And neither is a collector fault, because cmux is not a collector.
    expect(failing.totals.sourceHealth!.degraded).toBe(0);
    expect(missing.totals.sourceHealth!.absent).toBe(0);
  });
});

describe("telling a missing binary from a broken one", () => {
  test("the real runner's missing-executable signal is what we match on", async () => {
    /* executableMissing() matches a Bun error string, which is brittle on
       purpose-of-record: this drives the REAL runner against a genuinely
       missing binary, so if Bun ever rewords it this fails loudly rather than
       the board quietly going back to calling every cmux-less machine degraded. */
    const result = await new BunCommandRunner().run(["anthill-definitely-not-installed", "rpc"]);

    expect(executableMissing(result)).toBe(true);
  });

  test("a binary that exists and fails is not absence", async () => {
    // `false` exits 1. It is installed; it just said no.
    const result = await new BunCommandRunner().run(["false"]);

    expect(executableMissing(result)).toBe(false);
  });

  test("a timeout is never absence, because a timeout means something answered slowly", () => {
    const timedOut: CommandResult = { exitCode: -1, stdout: "", stderr: "command timed out after 10ms", timedOut: true };

    expect(executableMissing(timedOut)).toBe(false);
  });

  test("collectCmux reports absent with no errors when the binary is missing", async () => {
    const runner: CommandRunner = {
      run: async () => ({ exitCode: -1, stdout: "", stderr: 'Executable not found in $PATH: "cmux"', timedOut: false }),
    };

    const result = await collectCmux(runner, "cmux");

    expect(result.absent).toBe(true);
    // Absent must not also raise an error, or it would be degraded as well.
    expect(result.errors).toEqual([]);
  });

  test("collectCmux still reports an error when cmux is present and fails", async () => {
    const runner: CommandRunner = {
      run: async () => ({ exitCode: 1, stdout: "", stderr: "connection refused", timedOut: false }),
    };

    const result = await collectCmux(runner, "cmux");

    expect(result.absent).toBeUndefined();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("connection refused");
  });
});

describe("end to end, the way the docs lane walked it", () => {
  test("a virgin clone with an empty HOME reports a calm board, not a broken one", async () => {
    /* The whole defect in one test, from an actually-empty HOME through the
       collectors to the numbers the first screen reads. */
    const home = emptyHome();
    writeFileSync(join(home, "not-a-provider.txt"), "");
    const sessions = await collectSessions(home);

    /* Derived from what the collectors actually returned, rather than a
       hand-written list of them. The hand-written version named codex, claude
       and cursor and quietly dropped omp — the same omission that put the
       health accounting out of step with its own breakdown, reproduced here in
       the one test that was supposed to catch it end to end. */
    const providers = Object.keys(sessions) as (keyof typeof sessions)[];
    const summary = health({
      agents: [], surfaces: [], archiveStore,
      sourceAbsent: Object.fromEntries(
        providers.map((provider) => [provider, sessions[provider].absent === true]),
      ),
      sourceErrors: Object.fromEntries(
        providers.map((provider) => [provider, sessions[provider].errors]),
      ),
      cmuxAbsent: true,
      cmuxReachable: false,
    });

    // Not one degraded collector anywhere, which is what "1 of 4 degraded" claimed.
    expect(summary.degraded).toBe(0);
    expect(summary.absent).toBe(providers.length);
    /* Vacuity guard: an empty provider list would satisfy the line above.
       Checked against the union rather than a literal, so it keeps guarding
       vacuity without failing every time a collector is added. */
    expect(providers.length).toBe(PROVIDERS.length);
    expect(providers.length).toBeGreaterThan(1);
  });
});
