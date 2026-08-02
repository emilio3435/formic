import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSnapshot } from "../src/server/snapshot";

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
  totals: { live: 1, tracked: 1, attention: 0, working: 1, sourceHealth: { healthy: 4, degraded: 0, absent: 0, total: 4 } },
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
    /* "cmux unreachable — terminal titles and Focus/Send stay offline." used to
       be quoted here as the detail a monitoring-only install reads. It was a
       hollow pin: summaryWidgetData returns it for a fixture with NO issues,
       but a machine without cmux always raises control-plane issues (terminal
       discovery and notification discovery both ENOENT), and the card then
       shows the top issue summary from snapshot-operator-issues.ts:168 —
       "2 control-plane problems may limit focus, instruction, or interrupt
       actions." Confirmed against a real board on a virgin clone. The fixture
       agreed with the doc while the product disagreed with both, which is the
       failure this file exists to catch, so the doc now quotes only the two
       strings that survive the real path and describes the varying one. */
    for (const quoted of [
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
    expect(blocked.sublabel, "the no-issues detail vanished; QUICKSTART describes a two-branch card")
      .toContain("cmux unreachable — terminal titles and Focus/Send stay offline.");
    /* The branch a real no-cmux machine lands on. QUICKSTART must describe the
       count rather than quote a sentence whose number moves with the errors. */
    expect(read("src/server/snapshot-operator-issues.ts"), "the control-plane issue summary was reworded")
      .toContain("control-plane ${otherCmuxErrors.length === 1 ? \"problem may\" : \"problems may\"} limit focus, instruction, or interrupt actions.");
    expect(quickstart, "QUICKSTART stopped telling the reader the detail line names a count")
      .toMatch(/control-plane problems/i);
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

/* The write gate became fail-closed in 547679e: a pane matched only by its
   working directory can no longer authorise input, because a directory string
   is not an identity. That is a capability REMOVAL for anyone whose rows resolve
   that way — buttons that worked yesterday are off today — so both onboarding
   docs have to say it is deliberate and say what turns it back on.

   The asymmetry is the part that drifts. Focus survives `unique-cwd` on purpose
   (it types nothing, and going to look is the recovery path) while Send and
   Interrupt do not. A doc that flattens that into "the controls need cmux" is
   wrong in the direction that matters: it tells an operator their install is
   broken when it is working exactly as designed. So drive controlsFor() and
   require the docs to describe what it actually returns. */
describe("the fail-closed write gate is documented as a deliberate capability change", () => {
  const target = (resolution: string) => ({
    surfaceId: "surface-1", resolution, reason: undefined, surfaceCwd: "/x", surfaceTitle: undefined,
  }) as never;
  const agent = { status: "running" } as never;
  const capabilities = async (resolution: string) => {
    const { controlsFor } = await import("../src/server/snapshot-agent");
    const controls = controlsFor(agent, target(resolution), false);
    return Object.fromEntries(controls.map((c) => [c.action, c.enabled]));
  };

  test("cmux attesting the session enables every control", async () => {
    const caps = await capabilities("exact");
    expect(caps, "an attested pane stopped permitting writes").toMatchObject({
      focus: true, instruct: true, interrupt: true,
    });
  });

  test("a folder match permits Focus and refuses Send and Interrupt", async () => {
    const caps = await capabilities("unique-cwd");
    expect(caps.instruct, "a cwd-matched pane is authorising Send again").toBe(false);
    expect(caps.interrupt, "a cwd-matched pane is authorising Interrupt again").toBe(false);
    expect(caps.focus, "Focus was disabled too — it is the documented recovery path").toBe(true);
  });

  test("both onboarding docs describe that asymmetry, not a blanket cmux requirement", () => {
    const flatten = (d: string) => d.replace(/\s+/g, " ");
    for (const [name, doc] of [["QUICKSTART.md", flatten(quickstart)], ["ANT-GUIDE.md", flatten(read("ANT-GUIDE.md"))]] as const) {
      expect(doc, `${name} does not say Send/Interrupt are gated harder than Focus`)
        .toMatch(/Send and Interrupt|Send \/ Interrupt/);
      expect(doc, `${name} does not name the cwd-match state an operator will hit`)
        .toMatch(/working directory|matched by (its )?folder/i);
      /* Same requirement the promises block below asserts; keep the accepted
         phrasings identical so a reword fails in one place, not two. */
      expect(doc, `${name} does not say Focus survives it`).toMatch(/Focus (still|stays|is exempt)/i);
      expect(doc, `${name} does not tell the reader how to get the write controls back`)
        .toMatch(/inside (a |)cmux pane/i);
    }
  });

  test("the docs' recovery advice matches the evidence the code actually keys on", () => {
    const identity = read("src/server/identity.ts");
    expect(identity, "open-transcript evidence is gone; the docs promise it").toContain("open-file-match");
    expect(identity, "command-line identity is gone; the docs promise it").toContain("command-hint-match");
    for (const doc of [quickstart, read("ANT-GUIDE.md")]) {
      expect(doc, "a doc describes evidence the code no longer collects").toMatch(/transcript file/i);
    }
  });
});

/* The fresh-clone walk's first blocker, and it is not a doc bug.

   A newcomer with no cmux — the configuration QUICKSTART explicitly blesses
   ("Skip it if you only want to watch") — is promised a calm empty board:
   "Watching. No sessions running yet." with a line counting HEALTHY collectors.
   What the running product shows them instead is

     No sessions found — and not every collector can see.
     A degraded collector reports no sessions whether or not any are running,
     so this board is incomplete rather than empty.
     1 of 4 collectors degraded

   on the first screen they ever see, with no way to tell it from a broken
   install. The doc is right and the product is wrong, so this pins the doc's
   promise rather than rewriting it to match the defect.

   Root cause, snapshot.ts:271-275: `degradedSources` counts codex/claude/cursor
   plus cmux, while the byProvider map beside it reports omp/codex/claude/cursor.
   Two different populations share the word "collectors", so cmux being absent
   spends a quarter of a denominator it is not in — and omp, which IS in the map,
   can never be counted degraded at all. app.ts:751 already knows ("those count a
   different population than their own byProvider map, which is a separate
   unresolved defect this must not inherit") and routes /api/health around the
   scalars; that is why /api/health says healthy while the board says degraded.
   The quarantine covered the monitoring endpoint and left the day-one board,
   which is the one surface where the reader has no prior to correct against.

   Worst of all the sentence is not true here. cmux contributes no sessions —
   it resolves terminals — so its absence cannot hide a single row. The board
   tells a new operator their view may be incomplete when it is complete.

   test.failing: passes while the defect stands, FAILS the day it is fixed, at
   which point delete the .failing and keep the assertion. */
describe("day one on a machine without cmux", () => {
  /* The fresh-clone walk's blocker, and its fix. A newcomer with no cmux — the
     configuration QUICKSTART blesses ("Skip it if you only want to watch") —
     used to be told on the first screen they ever saw:

       No sessions found — and not every collector can see.
       1 of 4 collectors degraded

     with no way to tell it from a broken install. cmux collects no sessions, so
     its absence could not hide a row; the board reported a fault where there was
     none. Fixed in the client (byProvider distinguishes never-healthy from
     newly-broken) and in the server (absent is not degraded). These hold the
     line in both directions: calm when nothing is wrong, and STILL alarming
     when something genuinely is, because a fix that just mutes the warning
     would be the false all-clear again. */
  const ok = { healthy: true, lastHealthyAt: "2026-08-02T12:00:00Z" };
  const broke = { healthy: false, lastHealthyAt: "2026-08-02T11:00:00Z" };
  const verdict = (sourceHealth: unknown) =>
    M.emptyBoardVerdict({ generatedAt: "2026-08-02T12:44:51.004Z", totals: { sourceHealth } });

  /* THE PRODUCER, not a fixture describing it.

     The day-one assertions below used to hand-build `{healthy: 4, total: 4}`
     and check only what the client rendered from it. That measures the renderer
     and says nothing about whether the server produces that payload for the
     machine in question — so when 42d842e changed the fresh-machine numbers
     (absent collectors stopped counting toward the denominator), every one of
     these stayed green while the screen a newcomer meets changed underneath
     them. A check that measures a fixture rather than the producer is the same
     hollow shape found a dozen times today, in the test written to prevent it.

     buildSnapshot is now driven with the machine as its input. */
  const machineVerdict = (input: Partial<Parameters<typeof buildSnapshot>[0]>) => {
    const snapshot = buildSnapshot({
      agents: [],
      surfaces: [],
      archiveStore: { has: () => false, archive: async () => {} },
      now: new Date("2026-08-02T12:44:51.004Z"),
      ...input,
    });
    return { verdict: M.emptyBoardVerdict(snapshot), sourceHealth: snapshot.totals.sourceHealth };
  };

  /* Derive the roster from the Provider union rather than listing four names
     here, so a fifth collector fails this test instead of silently outdating
     the table a newcomer reads to decide whether their board is broken. */
  const providers = (() => {
    const line = read("src/shared/types.ts").match(/export type Provider = ([^;]+);/)?.[1] ?? "";
    return [...line.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  })();

  test("a machine with nothing installed reads calm, and still says something", () => {
    /* Driven through buildSnapshot with the actual day-one machine: no provider
       directories, no cmux binary. The screen must be calm AND must not go
       silent — the count is what QUICKSTART calls "the proof the board is
       working", and returning null there left a newcomer with no signal at the
       one moment they need one. */
    const { verdict: fresh, sourceHealth } = machineVerdict({
      sourceAbsent: { codex: true, claude: true, cursor: true },
      cmuxAbsent: true,
      cmuxReachable: true,
    });

    expect(sourceHealth, "absent collectors are counting as faults again")
      .toMatchObject({ degraded: 0, absent: 4 });
    expect(fresh.degraded, "a fresh machine is being reported as faulty again").toBe(false);
    expect(fresh.message).toBe("Watching. No sessions running yet.");
    expect(fresh.sources, "the day-one screen went silent again")
      .toBe("No collectors installed yet — Claude Code, Codex or Cursor will appear here");
  });

  test("a machine with one tool installed names the one and the absences", () => {
    const { verdict: partial } = machineVerdict({
      sourceAbsent: { codex: true, cursor: true },
      cmuxAbsent: true,
      cmuxReachable: true,
    });

    expect(partial.sources).toBe("1 of 1 collectors healthy · 3 not installed");
  });

  test("a fully-equipped machine keeps the documented count", () => {
    // This box, and the string QUICKSTART quotes.
    const { verdict: full } = machineVerdict({ cmuxReachable: true });

    expect(full.sources).toBe("4 of 4 collectors healthy");
  });

  test("a collector that WAS healthy and now is not still alarms", () => {
    const failed = verdict({
      healthy: 3, degraded: 1, total: 4,
      byProvider: { omp: ok, codex: ok, claude: ok, cursor: broke },
    });
    expect(failed.degraded, "a real degradation was muted along with the false one").toBe(true);
    expect(failed.message).toBe("No sessions found — and not every collector can see.");
    expect(failed.sources).toBe("1 of 4 collectors degraded");
  });

  test("QUICKSTART quotes the empty-board strings the model renders", () => {
    /* Driven from the producer too: QUICKSTART must quote what a machine
       actually renders, not what a fixture can be made to say. */
    const { verdict: full } = machineVerdict({ cmuxReachable: true });
    const { verdict: fresh } = machineVerdict({
      sourceAbsent: { codex: true, claude: true, cursor: true },
      cmuxAbsent: true,
      cmuxReachable: true,
    });
    expect(quickstart, "QUICKSTART no longer quotes the calm empty-board message")
      .toContain(full.message);
    expect(quickstart, "QUICKSTART no longer quotes the healthy count as rendered")
      .toContain(full.sources);
    expect(quickstart, "QUICKSTART does not describe the day-one screen it renders")
      .toContain(fresh.sources);
  });

  test("QUICKSTART names every collector the code has, with the path it reads", () => {
    expect(providers.length, "the Provider union changed shape; re-read the roster").toBe(4);
    const table = quickstart.slice(quickstart.indexOf("| Collector |"));
    for (const provider of providers) {
      expect(table.toLowerCase(), `QUICKSTART's collector table omits "${provider}"`)
        .toContain(provider === "claude" ? "~/.claude/projects" : provider);
    }
    const collectors = read("src/server/collectors.ts");
    for (const root of [".omp/agent/sessions", ".codex/sessions", ".claude/projects"]) {
      expect(collectors, `collectors.ts no longer reads ${root}`).toContain(root);
      expect(quickstart, `QUICKSTART's table has a stale path for ${root}`).toContain(root);
    }
    /* Was "expect all four to still read healthy" — the promise option C
       replaced. Absent collectors no longer pad the denominator; they are named
       separately, because a count that read 4 of 4 on a machine running none of
       them was a number meaning one thing and reading as another. What must
       survive is the REASSURANCE: an absent tool is not a fault. */
    expect(quickstart, "QUICKSTART stopped saying an absent tool is not a fault")
      .toMatch(/expect most of these to be absent, and expect that to be fine/i);
    expect(quickstart, "QUICKSTART no longer names absence separately from health")
      .toMatch(/not installed/i);
    expect(quickstart, "QUICKSTART stopped telling the reader cmux is not a collector")
      .toMatch(/cmux is not one of the four/i);
  });

  /* The last wire, still open. state.ts sets #cmuxAbsent from cmux.absent, which
     cmux.ts sets only when executableMissing() matches — and that requires the
     stderr to read "executable not found". A real first run produces Bun's
     spawn error instead: "ENOENT: no such file or directory, posix_spawn
     '/Applications/cmux.app/Contents/Resources/bin/cmux'". So cmuxAbsent stays
     false on the exact path it was written for, the server scalar still spends
     a healthy slot on cmux, and the board reads "3 of 4 collectors healthy"
     where QUICKSTART documents "4 of 4".

     Not a blocker: the client's byProvider check already keeps the verdict calm,
     so nobody is told their install is broken. It is an off-by-one in the
     reassurance itself, which a newcomer cannot resolve — they will look for the
     fourth collector and there isn't one missing.

     test.failing: flips the day the detector recognises the real stderr. */
  test.failing("a missing cmux binary is detected as absent on the real first-run path", async () => {
    const { executableMissing } = await import("../src/server/cmux");
    expect(executableMissing({
      timedOut: false, exitCode: -1, stdout: "",
      stderr: "ENOENT: no such file or directory, posix_spawn '/Applications/cmux.app/Contents/Resources/bin/cmux'",
    } as never), "cmux absence is still read as a fault on a machine that never had it").toBe(true);
  });
});

/* Three changes to what this product PROMISES landed or are landing today, and
   the operator reads all three the same way: the cockpit will not act on your
   behalf unless it can prove, right now, that the action goes where you think.
   Framed as capabilities-you-lost they read as a broken install; framed as
   guarantees they are the reason to trust it with a terminal at all. Both
   onboarding docs must carry that framing, and it must stay true. */
describe("the safety promises the docs make on the product's behalf", () => {
  /* Markdown wraps these sentences across lines, so a raw .toMatch reads a
     reflow as drift and hides the real thing behind a false alarm. Flatten
     whitespace first, exactly as the QUICKSTART quote pins above do. */
  const flat = (doc: string) => doc.replace(/\s+/g, " ");
  const both = () =>
    [["QUICKSTART.md", flat(quickstart)], ["ANT-GUIDE.md", flat(read("ANT-GUIDE.md"))]] as const;

  test("both docs promise the board refuses an unnameable terminal", () => {
    for (const [name, doc] of both()) {
      expect(doc, `${name} dropped the identity promise`)
        .toMatch(/never type into a terminal it cannot name|refuses to type into a terminal it cannot|not type into a terminal it cannot name/i);
      expect(doc, `${name} no longer lets a reader match the hover text they will see`)
        .toMatch(/working directory/i);
    }
  });

  test("both docs promise the board refuses a session that has exited", () => {
    for (const [name, doc] of both()) {
      expect(doc, `${name} dropped the liveness promise`)
        .toMatch(/already exited|process is gone/i);
      expect(doc, `${name} does not explain WHY a dead agent's pane is dangerous`)
        .toMatch(/pane outlives the agent|belongs to your shell/i);
    }
  });

  test("both docs promise Focus stays available so there is always a way in", () => {
    for (const [name, doc] of both()) {
      expect(doc, `${name} stopped promising Focus survives the write gates`)
        .toMatch(/Focus (still|stays|is exempt)/i);
      expect(doc, `${name} dropped the line that makes the whole framing land`)
        .toMatch(/never the reason you cannot reach an agent/i);
    }
  });

  test("the identity promise is the gate the code actually enforces", async () => {
    const { controlsFor } = await import("../src/server/snapshot-agent");
    const target = (resolution: string) => ({
      surfaceId: "s1", resolution, reason: undefined, surfaceCwd: "/x", surfaceTitle: undefined,
    }) as never;
    const caps = (resolution: string) =>
      Object.fromEntries(
        controlsFor({ status: "running" } as never, target(resolution), false).map((c) => [c.action, c.enabled]),
      );
    expect(caps("unique-cwd").instruct, "a folder match authorises Send again").toBe(false);
    expect(caps("unique-cwd").focus, "Focus was disabled; the docs promise it survives").toBe(true);
    expect(caps("exact").instruct, "an attested pane stopped permitting Send").toBe(true);
  });

  /* The liveness promise, documented ahead of the code by explicit instruction —
     the backend is landing one shared predicate rather than four patches
     (docs/TRIAGE-AND-LIVENESS-SWEEP-GPT.md). Until it lands, this is the doc
     writing a cheque the product does not yet honour, so it is pinned rather
     than left to be noticed: controlsFor grants instruct on an agent the board
     itself renders as dead.

     test.failing: flips the moment any authorisation path reads agent liveness,
     at which point drop .failing and keep the assertion. */
  test("no write is authorised against a process the board knows is dead", async () => {
    const { controlsFor } = await import("../src/server/snapshot-agent");
    const dead = { status: "running", processAlive: false, processIds: [4242] } as never;
    const attested = { surfaceId: "s1", resolution: "exact", reason: undefined, surfaceCwd: "/x", surfaceTitle: undefined } as never;
    const caps = Object.fromEntries(controlsFor(dead, attested, false).map((c) => [c.action, c.enabled]));
    expect(caps.instruct, "Send is still offered on an agent whose process is gone").toBe(false);
    expect(caps.interrupt, "Interrupt is still offered on an agent whose process is gone").toBe(false);
    expect(caps.focus, "Focus must stay on — it is the documented way to go and look").toBe(true);
  });
});

/* PR 3 and PR 4 are both merged, so the pr4:SYMBOL markers and the test that
   enforced them are gone — every claim they guarded is now true of main. This
   one assertion outlived them, because it is not about merge state: the guide
   tells a reader that a dead row shows a LIT Send which refuses on press, and
   that is only worth saying while the button and the gate disagree. */
describe("the guide describes the dead-row controls as they actually behave", () => {
  test("controlsFor greys instruct on a process the gate will refuse", async () => {
    /* It learned. controlsFor and control.ts now read one predicate
       (transmitRefusal), so the capability comes back disabled and the guide's
       "read the chip rather than the button" paragraph went with it, exactly as
       this test said it must. */
    const { controlsFor } = await import("../src/server/snapshot-agent");
    const attested = { surfaceId: "s1", resolution: "exact", attestation: "attested", reason: undefined, surfaceCwd: "/x", surfaceTitle: undefined } as never;
    const dead = { status: "running", processAlive: false, processIds: [4242] } as never;
    const instruct = controlsFor(dead, attested, false).find((c) => c.action === "instruct");
    expect(instruct?.enabled, "a dead row is offering Send again").toBe(false);
    const guide = read("ANT-GUIDE.md").replace(/\s+/g, " ");
    /* The guide must no longer tell a reader to distrust the button, because
       the button is now the truth. A doc that still says "refused when pressed"
       would be describing a behaviour the code no longer has. */
    expect(guide, "the guide still says a dead row's Send looks live")
      .not.toMatch(/refused when pressed|still shows a lit/i);
    expect(guide, "the guide stopped saying a dead row's Send is greyed out")
      .toMatch(/greyed out to match|Send is greyed/i);
  });
});

/* Read as a SET, not three files. Each was edited many times in one day by
   different passes, and the failure mode stopped being staleness and became
   contradiction: the same claim restated in a third vocabulary, or two
   sentences that cannot both be true. These pin the seams between the files. */
describe("README, QUICKSTART and ANT-GUIDE cohere as one set", () => {
  const flat = (d: string) => d.replace(/\s+/g, " ");
  const guide = () => read("ANT-GUIDE.md");

  test("one state, one name: the health verdict a reader is told to look for", () => {
    /* ANT-GUIDE's table said `Blocked` and its troubleshooting said `Blocking`
       for the same cmux-less state. The card headline is "Blocked"
       (SEVERITY_HEADLINE in app.js); "Blocking" is an internal severity label.
       A guide that uses both teaches a word the screen never shows. */
    expect(read("src/web/app.js"), "the card headline stopped being Blocked")
      .toMatch(/SEVERITY_HEADLINE\s*=\s*\{\s*blocking:\s*"Blocked"/);
    for (const [name, doc] of [["ANT-GUIDE.md", guide()], ["QUICKSTART.md", quickstart]] as const) {
      expect(doc, `${name} tells the reader to look for "Blocking", which no card shows`)
        .not.toMatch(/`Blocking`/);
    }
  });

  test("the identity promise is stated once per document, not three times", () => {
    /* It appeared three times in ANT-GUIDE alone, in three vocabularies —
       "cannot name", "cannot positively identify", "cannot prove it has
       identified" — which reads as three different rules. One statement per
       file: README summarises, QUICKSTART and the guide each promise it once. */
    const phrasings = /(refuses|refuse|will not|would not|never) to type into a terminal it cannot|not type into a terminal it cannot|type into a terminal it cannot/gi;
    const count = (d: string) => (flat(d).match(phrasings) ?? []).length;
    expect(count(guide()), "ANT-GUIDE states the identity promise more than once again").toBeLessThanOrEqual(1);
    expect(count(readme), "README states the identity promise more than once").toBeLessThanOrEqual(1);
    expect(count(quickstart), "QUICKSTART states the identity promise more than once").toBeLessThanOrEqual(1);
  });

  test("the cost-honesty rule is not restated inside QUICKSTART", () => {
    /* README owns this rule. QUICKSTART gives the concrete monitoring-only
       case once; it used to also carry a general restatement of both examples. */
    const mentions = (flat(quickstart).match(/reads? `?unavailable`?|never invents a number/gi) ?? []).length;
    expect(mentions, "QUICKSTART states the cost-honesty rule twice again").toBeLessThanOrEqual(1);
    expect(readme, "README stopped owning the honesty rule").toContain("It refuses to invent numbers");
  });

  test("every cross-document link resolves to a file that exists", () => {
    for (const [name, doc] of [["README.md", readme], ["QUICKSTART.md", quickstart], ["ANT-GUIDE.md", guide()]] as const) {
      for (const [, target] of doc.matchAll(/\]\(\.\/([A-Za-z0-9._/-]+)\)/g)) {
        expect(existsSync(join(ROOT, target)), `${name} links to ./${target}, which does not exist`).toBe(true);
      }
    }
  });

  test("the cmux link points at the project this actually integrates with", () => {
    /* mountain-labs/cmux 404s even authenticated — it never existed. The real
       one is manaflow-ai/cmux, the Ghostty-based macOS terminal for AI coding
       agents whose panes and notifications this reads. A stranger's first
       click from the front door must not land on a 404. */
    expect(readme, "README points at a cmux repo that does not exist")
      .not.toContain("mountain-labs/cmux");
    expect(readme, "README stopped linking cmux at all").toContain("manaflow-ai/cmux");
  });
});

/* PR 5's subject is money being HIDDEN rather than overstated, which is the
   harder direction to notice: a window always looks complete. The guide now
   states the limitation, and every number in that paragraph is derived here
   from the code that produces it, because a hardcoded "30d" or "90 days" is
   exactly the kind of figure that outlives its source. */
describe("the cost window's limits are documented as the code enforces them", () => {
  const guide = () => read("ANT-GUIDE.md");

  test("the guide lists the presets the UI actually offers, widest included", () => {
    const catalogs = read("src/web/client-catalogs.js");
    const block = catalogs.slice(catalogs.indexOf("USAGE_RANGE_PRESETS"));
    const labels = [...block.slice(0, block.indexOf("]")).matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(labels.length, "the usage presets changed shape").toBeGreaterThan(0);
    for (const label of labels) {
      expect(guide(), `ANT-GUIDE stopped listing the \`${label}\` usage preset`).toContain(`\`${label}\``);
    }
    const widest = labels[labels.length - 1];
    expect(guide(), `ANT-GUIDE no longer names \`${widest}\` as the widest preset`)
      .toMatch(new RegExp(`\\\`${widest}\\\`[^\\n]*(is not "everything"|not "everything")`));
  });

  test("both ceilings are documented as the code sets them", () => {
    /* Derive, never hardcode. This cap moved twice in one session — a literal
       90, then a named MAX_RANGE_MS of 400, then back — while a neighbouring
       lane reworked the file underneath. Only reading it from source each run
       caught that the guide had gone stale within minutes of being written.
       Matches either form so an in-flight refactor fails loudly, not silently. */
    const app = read("src/web/app.js");
    const burnbar = read("src/server/burnbar.ts");
    const customDays = Number(app.match(/Math\.min\(24 \* (\d+),/)?.[1]);
    expect(customDays, "the Custom clamp could not be read from app.js").toBeGreaterThan(0);

    const guideText = guide();
    expect(guideText, `ANT-GUIDE stopped documenting the ${customDays}-day Custom ceiling in hours`)
      .toContain(`${customDays} days (\`${customDays * 24}\`)`);
    expect(app, "the Custom prompt stopped asking for hours")
      .toContain('window.prompt("Usage range hours"');

    /* The server cap's exact value is NOT pinned. It changed three times during
       one session while a neighbouring lane reworked burnbar.ts, and a doc that
       chases it would be stale between commits. What must hold is the invariant
       the guide actually relies on: a bound exists, and the UI cannot ask for
       more than it allows — so the widest question a reader can pose is the
       Custom clamp, whatever the server's ceiling happens to be. */
    expect(burnbar, "the range bound disappeared; the guide promises one exists")
      .toMatch(/Range cannot exceed/);
    const serverDays = Number(
      burnbar.match(/MAX_RANGE_MS = (\d+) \*/)?.[1]
      ?? burnbar.match(/toMs - fromMs > (\d+) \* 24/)?.[1],
    );
    if (Number.isFinite(serverDays)) {
      expect(serverDays, "the UI can now request a range the server will refuse")
        .toBeGreaterThanOrEqual(customDays);
    }
  });

  test("the guide says the shortfall is silent, which is the whole finding", () => {
    const flat = guide().replace(/\s+/g, " ");
    /* An alternation was too weak here: replacing "Nothing on the card says any
       of this" with the OPPOSITE claim still passed, because the other phrasing
       carried the match on its own. Require the negative claim itself, and
       reject a doc that says the card reports its own coverage — if that ever
       becomes true, this paragraph is what has to change. */
    expect(flat, "ANT-GUIDE stopped warning that nothing on the card says it is truncated")
      .toMatch(/nothing on the card says/i);
    expect(flat, "ANT-GUIDE now claims the card shows coverage; verify that shipped before saying so")
      .not.toMatch(/the card shows its coverage/i);
    /* Both halves, not an alternation. Inverting one while the other stands
       leaves the guide contradicting itself and still passing — the same weak
       shape that let a "coverage is shown" edit through a paragraph that says
       the opposite two lines earlier. */
    expect(flat, "ANT-GUIDE stopped stating the gap grows").toMatch(/gap only widens/i);
    expect(flat, "ANT-GUIDE stopped saying the omission grows silently over time")
      .toMatch(/it has hidden more/i);
    /* The claim this whole section exists for, and it was unpinned until a
       mutation removed it and nothing failed: the store outlasts the widest
       window a reader can ask for. Without this sentence the table reads as a
       complete account of the limits, which is the surprise it exists to
       prevent. */
    expect(flat, "ANT-GUIDE stopped saying the record outlasts the widest window")
      .toMatch(/database keeps going after that|keeps going after/i);
    expect(flat, "ANT-GUIDE stopped distinguishing the widest button from the widest question")
      .toMatch(/widest \*button\*[\s\S]{0,80}widest\s+\*question\*/i);
    /* No percentage is pinned on purpose: the audit measured 32.6% on one
       machine on one day, and that share moves every day by construction. */
    expect(guide(), "a machine-specific coverage percentage was hardcoded into the guide")
      .not.toMatch(/3[0-9]\.\d\s*%/);
  });
});

/* Three claims added when priorSpend landed and the archive audit closed. Each
   one is a promise about incompleteness, which is the hardest kind to keep
   honest: the failure mode is silence, so nothing breaks when it lapses. */
/* A ledger discipline, not a claim about the board: any figure in the guide
   that came from a one-off measurement has to be either re-measured or removed,
   because a measured number ages into a false one silently. The token-ratio
   warning said "roughly five hundred times", measured in an earlier session;
   re-measured live it was 1802x. The fix was not a fresher number — it was to
   state the shape, which does not age, and to say explicitly that any specific
   ratio is stale. This pins that no such figure creeps back. */
describe("no one-off measurement is presented as a standing fact", () => {
  test("any cost total is dated and labelled a reading, not left as a fact", () => {
    /* This guard used to forbid dollar figures outright, while the halves
       disagreed. That is retired: both are de-duplicated and a number is now
       worth stating. But the guard nearly became a false green first — it
       watched one slice of the file, and the figure I added sat just outside
       it, so it reported clean for the wrong reason.

       The rule that survives: a total may appear, and when it does it must
       carry WHEN it was measured and the warning that it moves. A bare number
       in a doc is the thing that ages into a lie. */
    const guide = read("ANT-GUIDE.md").replace(/\s+/g, " ");
    const totals = [...guide.matchAll(/\$3[0-9],[0-9]{3}/g)];
    expect(totals.length, "the whole-record total vanished from the guide").toBeGreaterThan(0);
    for (const m of totals) {
      const around = guide.slice(Math.max(0, m.index - 320), m.index + 320);
      expect(around, `a cost total near "${m[0]}" carries no measurement date`)
        .toMatch(/20[0-9]{2}-[0-9]{2}-[0-9]{2}/);
    }
    expect(guide, "the guide stopped warning that the total is a reading that moves")
      .toMatch(/a reading, not a fact/i);
  });

  test("the token-scale warning describes a shape, not a multiplier", () => {
    const g = read("ANT-GUIDE.md").replace(/\s+/g, " ");
    const warning = g.slice(g.indexOf("They are not the same unit"), g.indexOf("do not add up the column"));
    expect(warning, "the token warning went missing").toContain("not the sum of its rows");
    expect(warning, "a specific multiplier came back into the token warning")
      .not.toMatch(/\b(five hundred|\d{2,4})\s*(times|x)\b/i);
    expect(warning, "the warning stopped telling the reader that quoted ratios are stale")
      .toMatch(/moves daily|out of date/i);
  });
});

describe("what the docs promise about incompleteness", () => {
  const guide = () => read("ANT-GUIDE.md");
  const flat = (d: string) => d.replace(/\s+/g, " ");

  test("the prior-spend guarantee names the field the server actually returns", () => {
    const burnbar = read("src/server/burnbar.ts");
    expect(burnbar, "priorSpend left the payload; the guide promises it").toContain("priorSpend");
    for (const field of ["earliestAt", "invocations", "measuredCostUsd"]) {
      expect(burnbar, `priorSpend.${field} is gone`).toContain(field);
    }
    expect(flat(guide()), "ANT-GUIDE stopped stating the tell-you-what-is-missing guarantee")
      .toMatch(/tell you when a view cannot show you everything/i);
  });

  test("the guide says the card does not print it yet, while that is true", () => {
    /* The whole point of writing this down. The server computes priorSpend and
       the client fetches the payload that carries it, but no cost reader in
       app.js touches the field, so the card still looks complete. If the client
       ever reads it, this test fails and the "not yet" sentence comes out. */
    const app = read("src/web/app.js");
    expect(app, "the client fetches the summary that carries priorSpend").toContain("/api/usage/summary?");
    expect(app, "the client now reads priorSpend — delete the 'not yet' sentence from the guide")
      .not.toContain("priorSpend");
    expect(flat(guide()), "ANT-GUIDE claims the card prints it; verify that shipped first")
      .toMatch(/does not print it yet/i);
  });

  test("the archive warning matches the clock the code actually uses", () => {
    const archive = read("src/server/archive.ts");
    const days = Number(archive.match(/ARCHIVE_RETENTION_MS = (\d+) \* 24/)?.[1]);
    expect(days, "the archive retention constant was reshaped").toBeGreaterThan(0);
    /* Retention is measured from the AGENT's last activity, and nothing stores
       when the operator archived. Both are why delivered < advertised. */
    /* The premise, stated so it survives the fix that is landing. The warning
       is warranted while retention can still be measured from the AGENT's
       timestamp rather than the archive's. Before the fix that was the only
       clock; after it, `archivedAt ?? updatedAt` keeps the old clock for every
       record stored before the fix — which is why the guide distinguishes what
       you archive from here on from what is already in there. This fails only
       when the updatedAt path is gone entirely, at which point the warning has
       genuinely expired. */
    expect(archive, "retention no longer falls back to the agent's own timestamp — the warning can go")
      .toMatch(/archivedAt \?\? agent\.updatedAt|nowMs - updatedAtMs <= ARCHIVE_RETENTION_MS/);
    expect(read("src/server/app.ts"), "retentionDays is no longer a constant — re-check the warning")
      .toContain("retentionDays: ARCHIVE_RETENTION_MS /");
    const g = flat(guide());
    expect(g, `ANT-GUIDE stopped advertising the ${days}-day figure it is warning about`)
      .toContain(`**${days} days**`);
    expect(g, "ANT-GUIDE stopped saying the clock starts at last activity, not at archive time")
      .toMatch(/from the session's last activity/i);
    expect(g, "ANT-GUIDE stopped warning that an old session can be pruned immediately")
      .toMatch(/pruned on the next save/i);
    /* Unpinned until a mutation deleted it and nothing failed. The fix works by
       stamping the archive time, so it cannot reach records stored before it —
       a reader who takes "fixed" to mean "my existing archive is safe" has been
       misled by the good news rather than the bad. */
    /* One canonical phrasing for this claim — "forward-only" — asserted here
       and in the re-measurement suite below. Two spellings of the same
       requirement is how a reword ends up failing in one place and passing in
       the other. */
    expect(g, "ANT-GUIDE stopped saying the repair only helps what you archive afterwards")
      .toMatch(/forward-only/i);
  });

  test("the narrowed caveat no longer calls the whole board rough", () => {
    const g = flat(guide());
    expect(g, "the blanket 'treat the aggregate counters as rough' warning came back")
      .not.toMatch(/treat the aggregate counters as rough/i);
    expect(g, "the caveat stopped naming the gaps that remain")
      .toMatch(/three things that are still open/i);
    /* The July 30 anomaly is ANNOTATED, not fixed: 71d7cb3 added an
       aggregatedRows count and changed no total, and the classification is
       circular — a row counts as aggregated because its tokens exceed the bound
       that made it anomalous. It is still inside every reported cost figure, so
       the guide must not let a reader take a cost total as what was spent. */
    /* The anomaly is now EXPLAINED — OpenBurnBar writes some rows as cumulative
       session snapshots, so a later snapshot contains the earlier one and
       summing double-counts — but not yet FIXED. Two things the guide must keep
       saying until per-session de-duplication lands: that a total is what was
       recorded rather than what was spent, and which DIRECTION the correction
       goes, because a reader told only "the numbers are wrong" will assume the
       bill is higher than shown when it is lower. */
    expect(g, "the guide stopped naming the double-count in cost totals")
      .toMatch(/double-count/i);
    /* Blockquote markers survive whitespace-flattening, so "> " lands mid
       sentence; strip them before matching prose inside a quote block. */
    const prose = g.replace(/>\s*/g, "");
    /* No alternations here. Three mutations slipped past OR-joined patterns
       today: inverting one phrase while its twin carried the match. Each claim
       gets its own assertion so a reworded half cannot be covered by the other. */
    expect(prose, "the guide stopped saying a figure may have gone DOWN")
      .toMatch(/gone \*\*down\*\*/i);
    expect(prose, "the guide stopped ruling out an upward correction")
      .toMatch(/never adds spend/i);
    expect(prose, "the guide stopped describing the de-duplication mechanism")
      .toMatch(/running total \*\*once\*\*/i);
    /* Both halves are de-duplicated now (681411c put window and prior on one
       scan), so the earlier "do not add these" warning is retired and the
       durable claim replaces it: window + prior is the whole record, and the
       same whole whichever window you ask through. Verified live across nine
       windows from 1 day to 399 — cost and invocation counts both constant.
       That property is what the guide promises; the amount is a reading. */
    /* Emphasis markers sit inside this sentence (*same*), so match around them
       rather than through them. */
    expect(prose, "the guide stopped saying a window plus its prior is the whole record")
      .toMatch(/spend before it and you get the whole recorded history/i);
    expect(prose, "the guide stopped labelling the total a reading rather than a fact")
      .toMatch(/a reading, not a fact/i);
    /* The identity now holds on BOTH reported figures — measuredCostUsd and
       estimatedCostUsd agree at every window, verified across seven from 1 day
       to 399 after the range clamp was fixed. The earlier caveat is retired.

       What must NOT come back is the unqualified version. When this claim was
       first made it rested on reading one field; the other was short by
       $6,563.55 and nobody had looked. So the guide has to say the identity
       holds on BOTH figures, not merely that it holds. */
    expect(prose, "the guide stopped promising the whole-record identity")
      .toMatch(/same whole whichever window you ask through/i);
    expect(prose, "the guide asserts the identity without saying it was checked on both figures")
      .toMatch(/both of the figures the payload reports/i);
    expect(prose, "the guide stopped saying how many windows agree")
      .toMatch(/seven different windows/i);
    const burnbar = read("src/server/burnbar.ts");
    expect(burnbar, "aggregatedRows stopped being a bare count — re-check whether the fix landed")
      .toContain("AS aggregatedRows");
  });
});

/* Separating "true of the running product" from "true of a commit that landed".
   The guide's gate table has four rows; two of them describe states a healthy
   board almost never occupies, so they cannot be observed on demand. That is
   not a reason to drop them — they are the safety behaviour — but it IS a
   reason to say which rows have been watched and which were exercised at the
   gate. These pin the honesty of that distinction rather than the states. */
describe("the guide separates what was observed from what was exercised", () => {
  const guide = () => read("ANT-GUIDE.md").replace(/\s+/g, " ");

  test("the gate table admits which rows have not been seen on a live board", () => {
    expect(guide(), "the guide stopped distinguishing seen from reasoned")
      .toMatch(/seen rather than reasoned/i);
    /* Superseded: both rows have since been produced on a probe and watched.
       The requirement is now that the guide keeps the weaker qualifier rather
       than the stronger claim — asserted in the re-measurement suite below, in
       one place rather than two spellings. */
    expect(guide(), "the guide stopped qualifying how the two rare rows were seen")
      .toMatch(/produced on demand rather than met in the wild/i);
  });

  test("the collapsed summary line does not promise All clear unconditionally", () => {
    /* app.js: once anything is being watched the trailing verdict CANNOT read
       "All clear" — it reads the calm verdict instead. Observed live as
       "Watch" beside a quiet count, while the guide claimed "All clear". */
    const app = read("src/web/app.js");
    expect(app, "the watched-verdict branch went away; re-check the guide")
      .toMatch(/cannot read "All clear"/);
    const g = guide();
    expect(g, "the guide promises All clear unconditionally again")
      .toMatch(/`All clear` only when nothing is being watched/i);
    expect(g, "the guide stopped naming the Watch verdict a reader will actually see")
      .toMatch(/reads \*\*`Watch`\*\* instead/);
  });
});

/* A claim is not "verified" because it was true when written — it is verified
   if it has been re-measured since the code beneath it last changed. Two claims
   in this guide sit on code that moved late in the day, and both are pinned to
   the property that would make them false rather than to the reading. */
describe("claims are re-measured after their foundations move", () => {
  const prose = () => read("ANT-GUIDE.md").replace(/\s+/g, " ").replace(/>\s*/g, "");

  test("the archive warning reports both measurable and unmeasurable records", () => {
    /* archive.ts changed at 16:09 (7be12d2) and the guide was re-measured
       against the running server afterwards: 360 of 578 records stamped, 218
       not. The shape that matters is that BOTH are reported — an average would
       hide the unmeasurable ones behind the measured ones. */
    const app = read("src/server/app.ts");
    expect(app, "deliveredRetention stopped separating measurable from unmeasurable")
      .toMatch(/unmeasurable/);
    expect(app, "retention is no longer measured from the records themselves")
      .toContain("deliveredRetention(");
    expect(prose(), "the guide stopped reporting how many records cannot be measured")
      .toMatch(/do not\./i);
    expect(prose(), "the guide stopped saying the repair is forward-only")
      .toMatch(/forward-only/i);
  });

  test("the archive guide does not claim a term it has not yet observed", () => {
    /* The mechanism is verifiable now; the thirty-day outcome is not, and
       cannot be for thirty days. A guide that says "fixed" without that
       distinction invites a reader to trust a term nobody has watched elapse. */
    expect(prose(), "the guide now implies the full retention term has been demonstrated")
      .toMatch(/has not been demonstrated yet/i);
    expect(prose(), "the guide stopped saying the clock starts right rather than the term being proven")
      .toMatch(/clock now starts in the right place/i);
  });

  test("the gate table's unobserved rows are still unobserved", () => {
    /* snapshot-agent.ts changed at 16:20 (858a993). Re-measured live after:
       the observable rows match, and unique-cwd and died remain absent from the
       board, so the "tested, not yet witnessed" note is still the true one. If
       it is ever dropped, it must be because a row was actually seen. */
    /* Both rows have now been produced on a probe agent and watched through a
       running server (unique-cwd via a synthetic transcript resolved onto a
       real unclaimed pane; died via a seeded binding whose PIDs are gone). The
       note changed from "not yet witnessed" to observed — but the guide must
       keep the weaker qualifier, because producing a state on demand is not the
       same as meeting it in the wild. */
    expect(prose(), "the guide overstates the evidence for the two rare rows")
      .toMatch(/produced on demand rather than met in the wild/i);
    expect(prose(), "the guide stopped saying the rare rows were actually observed")
      .toMatch(/observed behaviour rather than inference/i);
  });
});

/* TODAY.md is a dated summary, which is the format most likely to age into a
   lie — it is read by someone catching up, who has no way to tell a claim
   written this morning from one still true. So it is pinned to the same code
   as the guide, and required to keep the two admissions that make it honest
   rather than a victory lap. */
describe("the catch-up summary stays true to the code it summarises", () => {
  const today = () => read("TODAY.md").replace(/\s+/g, " ");

  test("it carries the timestamp with the cost total, not just the total", () => {
    const t = today();
    const totals = [...t.matchAll(/\$3[0-9],[0-9]{3}/g)];
    expect(totals.length, "the cost total vanished from the summary").toBeGreaterThan(0);
    expect(t, "the summary states a total without saying when it was measured")
      .toMatch(/Measured at [0-9]{2}:[0-9]{2}/);
    /* The strongest evidence in the file is that the number MOVED while staying
       consistent. Losing that turns "a reading" back into "a fact". */
    expect(t, "the summary stopped showing that the total moves")
      .toMatch(/Half an hour of work moved it|the same total read/i);
  });

  test("it does not claim the archive term has been observed", () => {
    expect(today(), "the summary now implies thirty days of retention were demonstrated")
      .toMatch(/full term is not proven/i);
    expect(today(), "the summary stopped telling a reader to copy out what matters")
      .toMatch(/copy it out of the drawer/i);
  });

  test("it tells a returning reader what to do first, not only what to believe", () => {
    /* Knowing what is trustworthy does not tell you where to start. The first
       action is the product's own answer to the only question it exists to
       answer, which also makes it a live smoke test: if the board cannot load
       or cannot say, that is the first thing worth knowing. */
    const t = today();
    expect(t, "the summary stopped telling a reader where to start")
      .toMatch(/Start here/i);
    expect(t, "the start-here line no longer points at the running board")
      .toContain("127.0.0.1:4701");
    expect(t, "the start-here line stopped naming the tab that answers the question")
      .toMatch(/`Needs you`/);
    /* And it must stay honest about the empty case, which is the common one. */
    expect(t, "the summary stopped saying an empty Needs you is an answer")
      .toMatch(/nothing needs you then nothing does/i);
  });

  test("it keeps an open section rather than reading as a victory lap", () => {
    const t = today();
    expect(t, "the summary dropped its 'still open' section").toMatch(/Still open/i);
    expect(t, "the summary stopped naming the claims nobody has confirmed")
      .toMatch(/nobody has confirmed/i);
  });

  test("its cost claim rests on the same identity the guide pins", () => {
    /* If the window/prior identity ever breaks again, this summary is wrong in
       the most load-bearing sentence it has, so tie it to the same source. */
    expect(read("src/server/burnbar.ts"), "priorSpend left the payload; TODAY.md's total assumes it")
      .toContain("priorSpend");
    expect(today(), "the summary stopped saying the total is the same from any window")
      .toMatch(/identical from a one-day window and a ninety-day one/i);
  });
});
