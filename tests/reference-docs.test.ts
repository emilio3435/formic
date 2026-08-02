import { beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/* README.md and ARCHITECTURE.md drift faster than anyone re-reads them. A label
   documented one afternoon was already wrong the next morning — "Show panes"
   became "Show N panes" when the count moved into the button — and nothing
   failed. A human noticed, which is the slowest detector available.

   tests/ant-guide.test.ts pins ANT-GUIDE.md the same way; this file is its
   sibling for the two reference docs, kept separate so the two can be edited
   without collision.

   The rule that makes these worth running: derive the expectation from the CODE
   wherever possible, so a new module or a renamed symbol fails here rather than
   quietly outdating a paragraph. A hardcoded list only catches a doc that lies
   today; a code-derived one catches the doc the moment the product moves. */

const ROOT = join(import.meta.dir, "..");
const read = (name: string) => readFileSync(join(ROOT, name), "utf8");

const readme = read("README.md");
const architecture = read("ARCHITECTURE.md");
const quickstart = read("QUICKSTART.md");
const triage = read("TRIAGE-WORKFLOW.md");
const deploy = read("DEPLOY.md");
const security = read("SECURITY.md");
const pkg = read("package.json");

const serverModules = readdirSync(join(ROOT, "src/server")).filter((n) => n.endsWith(".ts"));
const clientModules = readdirSync(join(ROOT, "src/web")).filter((n) => n.endsWith(".js"));
const server = serverModules.map((n) => read(join("src/server", n))).join("\n");
/* Every client source, not app.js alone — the client is an ES-module graph, so a
   string the docs quote can move between files without a reader seeing anything
   change. These assertions are about what the CLIENT produces, not where. */
const client = clientModules.map((n) => read(join("src/web", n))).join("\n");

/* The client's own model layer, driven directly. Grepping a source file proves
   the file contains a string and nothing else — a comment satisfies it, which
   is how "cost unavailable" stayed pinned while living in prose ABOUT the
   feature. These assertions call the functions that PRODUCE the strings, so
   deleting the render fails them. app.js guards its DOM wiring behind a
   `typeof document` check and hangs its pure helpers on globalThis, so it
   imports safely here without a browser. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let M: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let agentModel: any;
beforeAll(async () => {
  // @ts-expect-error the dependency-free browser client has no declaration file
  await import("../src/web/app.js");
  M = (globalThis as unknown as { TheAntHill: unknown }).TheAntHill;
  /* livenessView is not on the global, and adding it there would mean editing
     a file another lane owns. It is a plain ES module, so import it directly. */
  // @ts-expect-error same, no declaration file
  agentModel = await import("../src/web/agent-model.js");
});

const agentFixture = (o: Record<string, unknown> = {}) => ({
  id: "codex:pin", provider: "codex", sourceSessionId: "pin", displayName: "Pin",
  programId: "p1", status: "running", activity: "working", controlState: "linked",
  updatedAt: "2026-08-02T12:00:00.000Z", tokens: { provenance: "observed", total: 10 },
  artifacts: [], gates: [], ...o,
});
const snapFixture = (o: Record<string, unknown> = {}) => ({
  generatedAt: "2026-08-02T12:00:00.000Z",
  controlHealth: { cmuxReachable: true, lastCheckedAt: "x", errors: [], staleSources: [] },
  totals: { live: 1, tracked: 1, attention: 0, working: 1, sourceHealth: { healthy: 4, degraded: 0, total: 4 } },
  issues: [], programs: [{ id: "p1", name: "p1", agents: [agentFixture()] }], ...o,
});

describe("ARCHITECTURE.md stays true to the code it maps", () => {
  test("it names every module that exists, and every module it names exists", () => {
    /* The failure this catches is silent and total: ARCHITECTURE once named 17
       of 31 server modules and none of the 13 client ones, so the entire client
       was undocumented and nothing said so. Derived from the filesystem, a new
       module now fails here until the map admits it. */
    for (const name of serverModules) {
      expect(architecture, `ARCHITECTURE.md never mentions src/server/${name}`).toContain(name);
    }
    for (const name of clientModules) {
      expect(architecture, `ARCHITECTURE.md never mentions src/web/${name}`).toContain(name);
    }
    // And the reverse: a module it names must exist, or the map points at a ghost.
    for (const named of [...architecture.matchAll(/`(src\/(?:server|web)\/[\w.-]+\.(?:ts|js))`/g)].map((m) => m[1])) {
      expect(() => read(named), `ARCHITECTURE.md points at missing ${named}`).not.toThrow();
    }
  });

  test("the pipeline symbols it names are the ones the server exports", () => {
    /* Each of these carries a claim about HOW the pipeline works, so a rename
       that leaves the prose standing is a wrong explanation, not a typo. */
    const symbols = [
      "buildSnapshot", "withPulse", "snapshotDelta", "compactSnapshotFingerprint",
      "snapshotFingerprint", "enrichCmuxIdentity", "identityFromSessionPath",
      "identitiesFromCommand", "resolveAgentTargetWithTrace", "resolveAgentTarget",
      "controlsFor", "classifyIdentityConflicts",
    ];
    for (const symbol of symbols) {
      expect(architecture, `ARCHITECTURE.md stopped naming ${symbol}`).toContain(symbol);
      expect(server, `${symbol} is no longer a symbol the server defines`).toContain(symbol);
    }
  });

  test("controlsFor is credited to the file that actually defines it", () => {
    /* It moved from snapshot.ts to snapshot-agent.ts and the doc kept the old
       address for a week. Attribution is the part of a map a reader trusts most
       and can verify least. */
    const owner = serverModules.find((name) => read(join("src/server", name)).includes("function controlsFor"));
    expect(owner, "no server module defines controlsFor any more").toBeDefined();
    expect(architecture).toContain(`src/server/${owner}\` derives per-agent capabilities (\`controlsFor\``);
  });

  test("the endpoints it documents are registered, and the deploy gate is one of them", () => {
    for (const path of ["/api/health", "/api/debug/identity", "/api/control"]) {
      expect(architecture, `ARCHITECTURE.md stopped documenting ${path}`).toContain(path);
      expect(server, `${path} is no longer registered`).toContain(`"${path}"`);
    }
    // The doc claims anthill-deploy.sh gates on /api/health. If that stops being
    // true the sentence is worse than absent — it describes a safety net nobody has.
    expect(read("scripts/anthill-deploy.sh")).toContain("/api/health");
  });

  test("the cadence and windows it quotes are the ones the server runs", () => {
    /* Numbers age worst, because a reader has no way to sense-check them. */
    expect(architecture).toContain("4 s");
    expect(read("src/server/index.ts")).toContain("4_000");
    expect(architecture).toContain("36h");
    expect(read("src/server/settings.ts")).toContain("DEFAULT_SCAN_WINDOW_HOURS = 36");
    expect(architecture).toContain("30-second");
    expect(read("src/server/http.ts")).toContain("MAX_CONTROL_SNAPSHOT_AGE_MS = 30_000");
  });

  test("the fingerprint exclusions it lists are the fields actually dropped", () => {
    /* The doc used to list the wrong set and omit generatedAt — the exact field
       behind a health/snapshot divergence. A wrong list here sends someone
       debugging in the wrong direction. */
    const snapshot = read("src/server/snapshot.ts");
    for (const field of ["generatedAt", "lastCheckedAt", "elapsedMs"]) {
      expect(architecture, `ARCHITECTURE.md omits ${field} from the fingerprint exclusions`).toContain(field);
    }
    expect(snapshot).toContain("generatedAt: _generatedAt");
    expect(snapshot).toContain("lastCheckedAt: _lastCheckedAt");
  });
});

describe("README.md stays true to the product", () => {
  test("the honesty promise it leads with is one the client keeps", () => {
    /* README's differentiator is that it does not invent numbers. That is a
       promise a stranger reads in the first fifteen seconds, so the strings
       behind it have to be strings the client actually renders. */
    expect(readme).toContain("`unavailable`, never `$0`");
    /* Driven, not grepped: a burn payload carrying a null cost must RENDER the
       word, and must never render a zero. */
    const noCost = snapFixture({ pulse: { burn: { tokensPerMin: 10, windowMs: 300000, costLastHourUsd: null, costProvenance: "unavailable", coverage: { reporting: 1, eligible: 1, unknown: 0 } }, momentum: { working: 1, completionsLastHour: 0, observedWindowMs: 0, stalled: 0, stalledAgentIds: [], stallThresholdMs: 900000 }, activity: { bucketMinutes: 5, windowMinutes: 60, observedSince: "x", buckets: [] } } });
    const burn = M.summaryWidgetData("burn", noCost, "live", "percent", [], false);
    expect(burn.sublabel, "a null cost stopped rendering as unavailable").toContain("cost unavailable");
    expect(burn.sublabel, "a null cost is being rendered as a zero").not.toContain("$0");
    expect(readme).toContain("no process evidence");
    /* Driven: an ended agent with no process evidence must PRODUCE that chip.
       This is the case README points a stranger at — a session that stopped
       without proof either way is not reported as dead. */
    const noEvidence = agentModel.livenessView(agentFixture({
      activity: "ended", processState: "unknown", processAlive: undefined, processIds: [],
    }));
    expect(noEvidence?.label, "an ended agent with no evidence stopped reading as 'No process evidence'")
      .toBe("No process evidence");
  });

  test("the ports and failure mode it sends a stranger to are real", () => {
    expect(readme).toContain("4701");
    expect(read("scripts/anthill-start.sh")).toContain('PORT="${MOUNTAIN_PORT:-4701}"');
    expect(readme).toContain("4710");
    expect(read("scripts/anthill-preview.sh")).toContain("PREVIEW_LO=4710");
    /* Verified by running it against the live service: dev and start:server
       exit rather than double-binding. If the server ever learns to retry, the
       README sentence telling a reader they will exit becomes wrong. */
    expect(readme).toContain("EADDRINUSE");
    const indexTs = read("src/server/index.ts");
    expect(indexTs).toContain("port: configuredPort");
    expect(indexTs, "a retry/fallback would make README's 'they exit' wrong").not.toContain("EADDRINUSE");
    expect(readme.toLowerCase()).toContain("no runtime dependencies");
    expect(JSON.parse(pkg).dependencies, "the app grew a runtime dependency").toBeUndefined();
  });
});

describe("ARCHITECTURE.md carries the contract detail README no longer does", () => {
  /* README became a front door, so the claims a stranger does not need moved
     here rather than being deleted. The pins moved with them — a claim with no
     document is a claim nothing protects. */

  test("the snapshot fields it names are fields the snapshot carries", () => {
    for (const field of ["contextPct", "attentionSignal", "lastHumanMessage"]) {
      expect(architecture, `ARCHITECTURE.md stopped documenting ${field}`).toContain(field);
      expect(read("src/shared/types.ts"), `${field} left the snapshot contract`).toContain(field);
    }
    /* errors-vs-debris is the distinction that stops a finished swarm holding
       the board red. If the split disappears, the paragraph explaining it is
       describing a policy the code no longer has. */
    expect(architecture).toContain("controlHealth.debris");
    expect(architecture).toContain("controlHealth.errors");
    expect(read("src/shared/types.ts")).toContain("debris?: ControlDebris");
  });

  test("the two ends of a message it distinguishes are both real", () => {
    /* A row reads the FIRST 240 characters, attention detection reads the LAST
       240. It looks like a bug until explained, so the explanation has to stay
       tied to the two helpers that make it true. */
    const humanMessage = read("src/server/human-message.ts");
    for (const helper of ["readableHumanMessage", "readableClosing"]) {
      expect(architecture, `ARCHITECTURE.md stopped naming ${helper}`).toContain(helper);
      expect(humanMessage, `${helper} is gone from human-message.ts`).toContain(`export function ${helper}`);
    }
    expect(humanMessage).toContain("MAX_HUMAN_MESSAGE_CHARS = 240");
    expect(architecture).toContain("240");
  });

  test("the commands and ports it sends a reader to are real", () => {
    for (const command of [...readme.matchAll(/`bun run ([a-z:]+)`/g)].map((m) => m[1])) {
      expect(pkg, `README.md tells a reader to run missing script "${command}"`).toContain(`"${command}"`);
    }
    for (const script of [...readme.matchAll(/scripts\/([a-z-]+\.sh)/g)].map((m) => m[1])) {
      expect(() => read(join("scripts", script)), `README.md references missing scripts/${script}`).not.toThrow();
    }
    /* 4701 for both bun start and the launchd service. The doc claimed 4702 for
       a week after the script changed, which sent readers at the production
       port believing it was a throwaway. */
    expect(readme).toContain("4701");
    expect(read("scripts/anthill-start.sh")).toContain('PORT="${MOUNTAIN_PORT:-4701}"');
    expect(readme).toContain("4710");
    expect(read("scripts/anthill-preview.sh")).toContain("4710");
  });


  test("every sibling document it links to exists", () => {
    for (const doc of [...readme.matchAll(/\]\(\.\/([A-Za-z0-9./-]+\.md)\)/g)].map((m) => m[1])) {
      expect(() => read(doc), `README.md links to missing ${doc}`).not.toThrow();
    }
  });
});

describe("QUICKSTART.md stays true to a first run", () => {
  /* QUICKSTART is read once, by someone with no way to tell a stale doc from
     their own mistake. Every string it quotes is something they will compare
     against their terminal character by character, so a drifted one reads as
     "I broke it" rather than "the doc is old". */

  test("the messages it tells a beginner to expect are the ones that get printed", () => {
    const startScript = read("scripts/anthill-start.sh");
    /* All THREE lines a cmux-less first run prints, in order. QUICKSTART used
       to quote only the reassuring one and call it "the expected message" —
       while the line above it, "cmux binary not found.", goes to stderr and
       reads as a failure. A newcomer meeting an undocumented red line on the
       first command they run has no way to know the doc meant to cover it. */
    for (const line of [
      "cmux binary not found.",
      "cmux not detected — starting in this shell (monitoring only; Focus/Send stay disabled).",
      "no cmux auth (titles/controls may stay offline)",
    ]) {
      expect(quickstart, `QUICKSTART.md stopped quoting "${line}"`).toContain(line);
      const printed = startScript.includes(line) || read("src/server/index.ts").includes(line);
      expect(printed, `nothing prints "${line}" any more`).toBe(true);
    }

    /* This one was vague until it was pinned — "a message asking you to open
       cmux first" cannot drift because it never said anything exact. It quotes
       the real line now, which is both more useful and checkable. */
    const setupHint = "Open cmux once so it creates the template, then re-run.";
    expect(quickstart).toContain(setupHint);
    expect(read("scripts/setup-cmux-password.ts")).toContain(setupHint);
  });

  test("the board strings it quotes are strings the client renders", () => {
    /* Prose wraps a long quote across lines, so compare against the doc with
       whitespace flattened — otherwise a markdown reflow reads as drift and the
       real thing hides behind a false alarm. */
    const flowed = quickstart.replace(/\s+/g, " ");
    for (const quoted of [
      "cmux unreachable — terminal titles and Focus/Send stay offline.",
      "Start cmux, then Refresh — Focus and Send come back on their own.",
      // Day one: the empty board now asserts health and proves it. See ant-guide.test.ts.
      "Watching. No sessions running yet.",
      "All clear",
    ]) {
      expect(flowed, `QUICKSTART.md stopped quoting "${quoted}"`).toContain(quoted);
    }
    /* The two cmux sentences and the Blocked verdict are what a monitoring-only
       install actually lands on, so drive that exact payload rather than
       grepping: cmux unreachable, everything else fine. */
    const noCmux = snapFixture({ controlHealth: { cmuxReachable: false, lastCheckedAt: "x", errors: ["gone"], staleSources: [] } });
    const blocked = M.summaryWidgetData("health", noCmux, "live", "percent", [], false);
    expect(quickstart).toContain("`Blocked`");
    expect(blocked.value, "a cmux-less install no longer lands on Blocked").toBe("Blocked");
    expect(blocked.sublabel).toContain("cmux unreachable — terminal titles and Focus/Send stay offline.");
    expect(blocked.remedy.instruction).toBe("Start cmux, then Refresh — Focus and Send come back on their own.");
    // And the clear case QUICKSTART promises once cmux is running.
    expect(M.summaryWidgetData("health", snapFixture(), "live", "percent", [], false).value).toBe("All clear");
    expect(quickstart).toContain("**Live**");
    expect(client).toContain('live: "Live"');
  });

  test("the lookback trap it warns about is the real one", () => {
    /* The board opens on 6 hours while 36 are scanned, so a reader whose last
       session was 8 hours ago sees an empty board and concludes the install
       failed. If either number moves, the warning stops matching the trap. */
    const catalogs = read("src/web/client-catalogs.js");
    expect(quickstart).toContain("**6-hour**");
    expect(catalogs).toContain("DEFAULT_LOOKBACK_HOURS = 6");
    expect(quickstart).toContain("**36 hours**");
    expect(read("src/server/settings.ts")).toContain("DEFAULT_SCAN_WINDOW_HOURS = 36");
    expect(quickstart).toContain("1h / 6h / 24h / 36h");
    expect(catalogs).toContain("LOOKBACK_PRESETS = [1, 6, 24, 36]");
  });

  test("every command and file it tells a reader to run or copy exists", () => {
    for (const command of [...quickstart.matchAll(/`?bun run ([a-z:]+)`?/g)].map((m) => m[1])) {
      expect(pkg, `QUICKSTART.md tells a reader to run missing script "${command}"`).toContain(`"${command}"`);
    }
    expect(() => read("config/programs.example.json"), "the example config it says to copy is gone").not.toThrow();
    // "no runtime dependencies" is a promise about what lands on their machine.
    expect(quickstart).toContain("no runtime dependencies");
    expect(JSON.parse(pkg).dependencies, "the app grew a runtime dependency").toBeUndefined();
    // `bun start` binds the port the doc sends them to.
    expect(quickstart).toContain("127.0.0.1:4701");
    expect(read("scripts/anthill-start.sh")).toContain('PORT="${MOUNTAIN_PORT:-4701}"');
  });
});

describe("TRIAGE-WORKFLOW.md stays true to the triage subsystem", () => {
  /* This doc describes a path that launches a subprocess against a real repo.
     Its safety claims are the kind a reader trusts without checking, so each
     one is pinned to the constant that makes it true. */
  const triageSrc = read("src/server/triage.ts");

  test("the endpoints it documents are registered", () => {
    for (const path of [...triage.matchAll(/`(?:POST|GET) (\/api\/triage\/[a-z]+)`/g)].map((m) => m[1])) {
      expect(server, `${path} is documented but not registered`).toContain(path);
    }
    // Guard: the regex still finds them, so an empty match set cannot pass silently.
    expect(triage).toContain("/api/triage/generate");
    expect(triage).toContain("/api/triage/run");
  });

  test("the launch it describes is the launch that happens", () => {
    /* Model, sandbox and reported label are the difference between "a read-only
       diagnostic" and "something with write access to your repo". */
    expect(triage).toContain("GPT-5.6 Luna · XHIGH");
    expect(triageSrc).toContain('model: "GPT-5.6 Luna · XHIGH · read-only"');
    expect(triage).toContain("read-only sandbox");
    expect(triageSrc).toContain('"--sandbox", "read-only"');
    expect(triageSrc).toContain('"--model", "gpt-5.6-luna"');
  });

  test("the four states it names are the four the store validates", () => {
    const states = ["queued", "running", "completed", "blocked"];
    for (const state of states) {
      expect(triage, `TRIAGE-WORKFLOW.md stopped naming the ${state} state`).toContain(state);
    }
    expect(triageSrc).toContain('["queued", "running", "completed", "blocked"]');
  });

  test("the server-side limits it promises are fixed in code", () => {
    expect(triage).toContain("ten-minute runtime limit");
    expect(triageSrc).toContain("10 * 60_000");
    /* Idempotent queue, non-idempotent launch. The doc claimed for a week that
       a repeat launch returns the existing run; it is refused with 409, and the
       two halves are easy to conflate again. */
    expect(triage).toContain("409");
    expect(triageSrc).toContain("requeue it before running again");
  });

  test("the prompt contract it publishes is the prompt that gets built", () => {
    for (const label of ["Goal:", "Success means:", "Evidence:", "Recommended path:", "Stop when:"]) {
      expect(triage, `TRIAGE-WORKFLOW.md dropped the ${label} field`).toContain(`\`${label}\``);
      expect(triageSrc, `the built prompt no longer emits ${label}`).toContain(label);
    }
  });
});

describe("DEPLOY.md is a rulebook the scripts actually enforce", () => {
  /* Every line here is an instruction someone follows against production. A
     stale sentence elsewhere wastes a minute; a wrong command here restarts the
     live dashboard from the wrong place, so each claimed guard is pinned to the
     line of shell that implements it. */
  const deployScript = read("scripts/anthill-deploy.sh");
  const previewScript = read("scripts/anthill-preview.sh");

  test("every script it tells an operator to run exists", () => {
    const named = [...deploy.matchAll(/scripts\/([a-z-]+\.sh)/g)].map((m) => m[1]);
    expect(named.length, "the regex stopped finding script references").toBeGreaterThan(0);
    for (const script of new Set(named)) {
      expect(() => read(join("scripts", script)), `DEPLOY.md points at missing scripts/${script}`).not.toThrow();
    }
  });

  test("the guards it promises are the guards the deploy script has", () => {
    expect(deploy).toContain("Deploy worktree must be on `main`");
    expect(deployScript).toContain('if [ "$BRANCH" != "main" ]');
    expect(deploy).toContain("Red `tsc` or `bun test` aborts the deploy");
    expect(deployScript).toContain("bunx tsc --noEmit ||");
    expect(deployScript).toContain("bun test ||");
    expect(deploy).toContain("then health-check");
    expect(deployScript).toContain("/api/health");
    expect(deploy).toContain("prints the exact rollback command");
    expect(deployScript).toContain("reset --hard");
  });

  test("the ports it reserves are the ports the scripts use", () => {
    /* The whole rulebook rests on 4701 being production and 471x being
       disposable. If the preview script ever stopped refusing 4701, the
       sentence telling people previews are safe becomes the dangerous one. */
    expect(deploy).toContain("4710–4719");
    expect(previewScript).toContain("PREVIEW_LO=4710");
    expect(previewScript).toContain("PREVIEW_HI=4719");
    expect(deploy).toContain("refuses 4701");
    expect(previewScript).toContain("PROD_PORT=4701");
    expect(deployScript).toContain("4701");
  });

  test("the launchd label it names is the one both scripts and the restart use", () => {
    const label = "ai.imaginethat.anthill";
    expect(deploy).toContain(label);
    expect(deployScript).toContain(`LABEL="${label}"`);
    expect(deploy).toContain("launchctl kickstart -k gui/$UID/ai.imaginethat.anthill");
    expect(deployScript).toContain("launchctl kickstart -k");
  });

  test("the lane branches it names as sources exist", () => {
    /* Named branches rot silently — `ant-hill/luna-ops-canvas-reconciled` lost
       its date suffix and pointed at nothing for days. A reader cannot tell a
       renamed branch from one they lack. */
    const branches = [...deploy.matchAll(/\(`((?:ant-hill|feat)\/[a-z0-9/-]+)`\)/g)].map((m) => m[1]);
    expect(branches.length, "the regex stopped finding branch references").toBeGreaterThan(0);
    const known = Bun.spawnSync(["git", "branch", "-a", "--format=%(refname:short)"], { cwd: ROOT });
    const refs = new Set(new TextDecoder().decode(known.stdout).split("\n").map((r) => r.replace(/^origin\//, "").trim()));
    for (const branch of branches) {
      expect(refs.has(branch), `DEPLOY.md names branch "${branch}", which no longer exists`).toBe(true);
    }
  });
});

describe("SECURITY.md describes the boundary the code implements", () => {
  /* An overclaim here is the worst failure mode in the repo: it tells an
     operator a defense exists. Each bullet is pinned to the guard behind it, so
     removing a check fails the suite rather than quietly widening the boundary
     while the doc still promises it. */

  test("the control surface is exactly the four actions it lists", () => {
    expect(security).toContain("`focus`, `instruct`, `interrupt`, and local `archive`");
    expect(read("src/server/control.ts"))
      .toContain('export const CONTROL_ACTIONS: readonly ControlAction[] = ["focus", "instruct", "interrupt", "archive"]');
  });

  test("instruct really does reject CR/LF and oversized text", () => {
    expect(security).toContain("`instruct` rejects CR/LF and oversized text");
    // The newline guard lives in control.ts, the size cap in http.ts.
    expect(read("src/server/control.ts")).toContain("/[\\r\\n]/.test(instruction)");
    expect(read("src/server/http.ts")).toContain("MAX_INSTRUCTION_BYTES");
  });

  test("the 30-second freshness gate covers control and broadcast, and exempts archive", () => {
    expect(security).toContain("older than 30 seconds");
    expect(read("src/server/http.ts")).toContain("MAX_CONTROL_SNAPSHOT_AGE_MS = 30_000");
    // Archive is exempt because it changes local data, not cmux.
    expect(security).toContain("`archive` is exempt");
    expect(read("src/server/http.ts")).toContain('parsed.action !== "archive"');
    // Broadcast was documented as UNPROTECTED for a day after it was fixed.
    expect(security).toContain("STALE_SNAPSHOT");
    expect(read("src/server/broadcast.ts")).toContain("STALE_SNAPSHOT");
  });

  test("every route family it claims is origin-checked has its own gate", () => {
    /* The doc names seven. They are enforced in six different files, so a
       reader has no practical way to confirm this by hand — which is exactly
       why the promise needs a test rather than trust. */
    const gates: Record<string, string> = {
      control: "src/server/http.ts",
      broadcast: "src/server/broadcast.ts",
      settings: "src/server/settings.ts",
      attention: "src/server/app.ts",
      triage: "src/server/triage.ts",
      recollect: "src/server/app.ts",
    };
    for (const [route, file] of Object.entries(gates)) {
      expect(security, `SECURITY.md stopped listing ${route}`).toContain(route);
      expect(read(file), `${route} lost its ORIGIN_REJECTED gate in ${file}`).toContain("ORIGIN_REJECTED");
    }
  });

  test("the loopback bind and the redacted diagnostics are real", () => {
    // Flattened: these sentences wrap, and a reflow is not a security change.
    const flowed = security.replace(/\s+/g, " ");
    expect(flowed).toContain("bound to `127.0.0.1`");
    expect(read("src/server/index.ts")).toContain('const HOSTNAME = "127.0.0.1"');
    expect(flowed).toContain("omits raw process command lines");
    expect(read("src/server/debug-identity.ts")).toContain('command: "[redacted]"');
  });

  test("the design record it defers to still exists", () => {
    /* It is a recorded NO. If the link breaks, the reasoning that stops someone
       re-proposing the separate-user broker becomes unreachable. */
    for (const doc of [...security.matchAll(/\]\(([A-Za-z0-9./-]+\.md)\)/g)].map((m) => m[1])) {
      expect(() => read(doc), `SECURITY.md links to missing ${doc}`).not.toThrow();
    }
    expect(security).toContain("AUTH-OS-SEPARATION-DESIGN.md");
  });
});

describe("the publish surface is documented as what it actually is", () => {
  /* A surface that reports unpushed work sits one design decision away from
     being a surface that pushes. The guide says it never does; that promise is
     only worth printing if something checks it. */
  const guide = read("ANT-GUIDE.md");
  const publishSrc = read("src/server/publish-state.ts");

  test("the endpoint the guide tells you to curl is the one that is registered", () => {
    expect(guide, "ANT-GUIDE.md stopped documenting the publish surface").toContain("/api/publish");
    expect(read("src/server/app.ts"), "/api/publish is no longer registered").toContain('"/api/publish"');
  });

  test("the read-only git verbs it promises are the only ones it runs", () => {
    /* The guide prints this list as the reason to trust it. If a write verb
       ever joins it, the sentence becomes a false assurance about something
       that can rewrite the operator's repository. */
    const promised = ["remote", "rev-parse", "rev-list", "for-each-ref", "cherry"];
    const flowed = guide.replace(/\s+/g, " ");
    for (const verb of promised) {
      expect(flowed, `the guide stopped promising the ${verb} verb`).toContain(`\`${verb}\``);
    }
    for (const forbidden of ["push", "commit", "merge", "reset"]) {
      expect(publishSrc, `publish-state.ts gained a write verb: ${forbidden}`).not.toContain(`"${forbidden}"`);
    }
  });

  test("there is no POST, so the guide's no-one-click claim holds", () => {
    const flowed = guide.replace(/\s+/g, " ");
    expect(flowed).toContain("It never pushes.");
    expect(flowed).toContain("no one-click");
    /* The route is read-only at the server too, not just by convention inside
       the module: a POST handler here would make the guide wrong even if every
       git verb stayed read-only. */
    expect(publishSrc).not.toContain('method === "POST"');
  });

  test("the guide describes it as an endpoint while no board UI consumes it", () => {
    /* Written down because it will change: the moment a card appears, this test
       fails and the guide gets rewritten instead of quietly describing a screen
       that does not exist — or, worse, staying silent about one that does. */
    const clientUsesPublish = clientModules.some((name) => read(join("src/web", name)).includes("/api/publish"));
    if (clientUsesPublish) {
      throw new Error("A client module now calls /api/publish — ANT-GUIDE.md still says it is an endpoint, not a card. Update the guide.");
    }
    expect(guide).toContain("It is an endpoint today, not a card on the board.");
  });
});

describe("the executable scripts do what DEPLOY.md says they do", () => {
  /* These are files an operator or an agent runs against production. A comment
     that describes a guard is not the guard; each assertion below reads the
     line that actually enforces it. The guards themselves were verified by
     executing anthill-deploy.sh with its effects stubbed — on a lane branch it
     aborts before reaching bunx/bun/launchctl/curl, on main it proceeds in the
     documented order, and a red typecheck or red test stops it before restart. */
  const shellScripts = readdirSync(join(ROOT, "scripts")).filter((n) => n.endsWith(".sh"));

  test("DEPLOY.md accounts for every shell script that exists", () => {
    /* anthill-hygiene.sh ran `kill -9` and `launchctl bootout` against
       production while appearing in no live document. A destructive script the
       rulebook does not mention is one an operator meets for the first time
       while using it. */
    expect(shellScripts.length, "no shell scripts found — the glob broke").toBeGreaterThan(0);
    for (const script of shellScripts) {
      expect(deploy, `DEPLOY.md never mentions scripts/${script}`).toContain(script);
    }
  });

  test("the on-main guard is a real comparison, not a comment", () => {
    const deployScript = read("scripts/anthill-deploy.sh");
    // It must read the branch of its OWN worktree, not the caller's cwd.
    expect(deployScript).toContain('ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"');
    expect(deployScript).toContain('cd "$ROOT"');
    expect(deployScript).toContain('BRANCH="$(git branch --show-current)"');
    expect(deployScript).toContain('if [ "$BRANCH" != "main" ]; then');
    // And the abort must be an exit, not just a message.
    expect(deployScript).toMatch(/Deploy worktree must be on 'main'[\s\S]{0,120}exit 1/);
  });

  test("a red typecheck or red test aborts before anything restarts", () => {
    const deployScript = read("scripts/anthill-deploy.sh");
    /* The `||` form matters: under `set -e` a bare failure would also stop, but
       the explicit exit is what makes the abort loud instead of silent. */
    expect(deployScript).toMatch(/bunx tsc --noEmit \|\| \{[^}]*exit 1/);
    expect(deployScript).toMatch(/bun test \|\| \{[^}]*exit 1/);
    // Order: both gates precede the restart.
    const tscAt = deployScript.indexOf("bunx tsc --noEmit");
    const testAt = deployScript.indexOf("bun test ||");
    const restartAt = deployScript.indexOf("launchctl kickstart");
    expect(tscAt).toBeGreaterThan(-1);
    expect(testAt).toBeGreaterThan(tscAt);
    expect(restartAt, "the restart no longer comes after both gates").toBeGreaterThan(testAt);
  });

  test("the preview script cannot land on the production port", () => {
    const preview = read("scripts/anthill-preview.sh");
    // Two independent defenses: the search range excludes 4701 ...
    expect(preview).toContain("PREVIEW_LO=4710");
    expect(preview).toContain("PREVIEW_HI=4719");
    // ... and an explicit refusal if it somehow arrives there anyway.
    expect(preview).toMatch(/if \[ "\$PORT" = "\$PROD_PORT" \]; then[\s\S]{0,160}exit 1/);
    /* It SETS MOUNTAIN_PORT from the port it picked rather than reading the
       operator's, so an inherited env var cannot push a preview onto 4701. */
    expect(preview).toContain('MOUNTAIN_PORT="$PORT" bun src/server/index.ts');
  });

  test("the hygiene script's kill is scoped to the port it is freeing", () => {
    const hygiene = read("scripts/anthill-hygiene.sh");
    /* An unscoped kill -9 in a script an operator runs to "fix" things is the
       kind of thing that is only noticed afterwards. */
    expect(hygiene).toMatch(/lsof -nP -iTCP:"\$\{PORT\}" -sTCP:LISTEN -t[\s\S]{0,140}kill -9/);
    // And it repairs the worktree it lives in, not a hardcoded path.
    expect(hygiene).toContain('REPO="${ANTHILL_REPO:-${ROOT}}"');
    expect(deploy, "DEPLOY.md stopped warning that hygiene restarts production").toContain("restarts production and can kill processes");
  });
});

describe("package.json scripts and config/ are documented as they execute", () => {
  /* These are run, not read. A script whose name implies one thing and does
     another is worse than an undocumented one, because the reader does not know
     to look it up. */
  const scripts: Record<string, string> = JSON.parse(pkg).scripts;

  test("every npm script is documented somewhere a reader will look", () => {
    /* `dev`, `start:ops`, `start:external` and `typecheck` were all
       undocumented — and two of them bind the production port. Derived from
       package.json, so a new script fails here until it is written down. */
    const docs = [readme, quickstart, deploy, read("ANT-GUIDE.md")].join("\n");
    for (const name of Object.keys(scripts)) {
      expect(docs, `no live doc mentions the "${name}" script`).toContain(name);
    }
  });

  test("the port-binding scripts are named as port-binding", () => {
    /* Anything routed through src/server/index.ts takes MOUNTAIN_PORT ?? 4701.
       DEPLOY.md forbids launching on 4701 by hand, so a reader needs to know
       which of these do exactly that. */
    for (const [name, body] of Object.entries(scripts)) {
      if (!body.includes("src/server/index.ts") && !body.includes("anthill-start.sh")) continue;
      expect(deploy, `DEPLOY.md's script table omits the port-binding "${name}"`).toContain(name);
    }
    expect(deploy).toContain("4701, **no reuse**");
  });

  test("start:external is documented as NOT binding externally", () => {
    /* The name invites the one assumption this product cannot afford. The
       server hostname is a constant with no env override — if that ever gains
       one, this test should fail and the paragraph be rewritten. */
    expect(scripts["start:external"]).toContain("--external");
    expect(read("scripts/anthill-start.sh")).toContain("--external    Force this shell");
    expect(deploy.replace(/\s+/g, " ")).toContain("`start:external` does not bind externally");
    const indexTs = read("src/server/index.ts");
    expect(indexTs).toContain('const HOSTNAME = "127.0.0.1"');
    expect(indexTs, "HOSTNAME gained an env override — the loopback promise moved").not.toMatch(/HOSTNAME\s*=\s*process\.env/);
  });

  test("the EADDRINUSE behaviour README promises is what the server does", () => {
    // Verified by running it against the live service: it exits, it does not
    // double-bind, and production keeps the port.
    expect(deploy).toContain("EADDRINUSE");
    const indexTs = read("src/server/index.ts");
    expect(indexTs).toContain("port: configuredPort");
    expect(indexTs, "a retry/fallback would make the 'it exits' claim wrong").not.toContain("EADDRINUSE");
  });

  test("every key in config/models.json is read by something", () => {
    /* Dead config is a trap: it reads as a supported knob. */
    const keys = Object.keys(JSON.parse(read("config/models.json")));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(server, `config/models.json key "${key}" is read by nothing`).toContain(key);
    }
  });

  test("the example program config matches what the loader accepts", () => {
    const example = JSON.parse(read("config/programs.example.json"));
    expect(example.programs, "programs.example.json lost its `programs` key").toBeDefined();
    // An absent programs.json is the normal state, and QUICKSTART says so.
    expect(read("src/server/state.ts")).toContain("Absent file is the normal state");
    expect(quickstart).toContain("config/programs.example.json");
  });
});

describe("README's closing gate line stays true", () => {
  test("the gate it describes is the gate that runs", () => {
    /* README dropped its suite inventory when it became a front door — a
       stranger does not need one. The gate is the part that must stay true,
       because it is the sentence that says broken code cannot ship. */
    expect(JSON.parse(pkg).scripts.check).toBe("bun run typecheck && bun test");
    const deployScript = read("scripts/anthill-deploy.sh");
    expect(deployScript).toContain("bunx tsc --noEmit");
    expect(deployScript).toContain("bun test");
    expect(readme).toContain("scripts/anthill-deploy.sh");
    expect(readme).toContain("bun run check");
  });
});
