import { describe, expect, test } from "bun:test";
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
const pkg = read("package.json");

const serverModules = readdirSync(join(ROOT, "src/server")).filter((n) => n.endsWith(".ts"));
const clientModules = readdirSync(join(ROOT, "src/web")).filter((n) => n.endsWith(".js"));
const server = serverModules.map((n) => read(join("src/server", n))).join("\n");
/* Every client source, not app.js alone — the client is an ES-module graph, so a
   string the docs quote can move between files without a reader seeing anything
   change. These assertions are about what the CLIENT produces, not where. */
const client = clientModules.map((n) => read(join("src/web", n))).join("\n");

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
  test("the UI strings it quotes are strings the client produces", () => {
    /* This is the "Show panes" class, and the reason this file exists: a quoted
       label is the one kind of doc claim a reader will act on verbatim. */
    for (const quoted of ["cmux unreachable — Focus and Send cannot route.", "No readable message yet"]) {
      expect(readme, `README.md stopped quoting "${quoted}"`).toContain(quoted);
      expect(client, `"${quoted}" is not a string the client renders any more`).toContain(quoted);
    }
    // The verdict it teaches a reader to expect when cmux is missing.
    expect(readme).toContain("**Blocked**");
    expect(client).toContain('blocking: "Blocked"');
  });

  test("the snapshot fields it promises are fields the snapshot carries", () => {
    for (const field of ["contextPct", "attentionSignal", "lastHumanMessage"]) {
      expect(readme, `README.md stopped documenting ${field}`).toContain(field);
      expect(read("src/shared/types.ts"), `${field} left the snapshot contract`).toContain(field);
    }
    /* errors-vs-debris is the distinction that stops a finished swarm holding
       the board red. If the split disappears, the paragraph explaining it is
       describing a policy the code no longer has. */
    expect(readme).toContain("controlHealth.debris");
    expect(readme).toContain("controlHealth.errors");
    expect(read("src/shared/types.ts")).toContain("debris?: ControlDebris");
  });

  test("the two ends of a message it distinguishes are both real", () => {
    /* A row reads the FIRST 240 characters, attention detection reads the LAST
       240. It looks like a bug until explained, so the explanation has to stay
       tied to the two helpers that make it true. */
    const humanMessage = read("src/server/human-message.ts");
    for (const helper of ["readableHumanMessage", "readableClosing"]) {
      expect(readme, `README.md stopped naming ${helper}`).toContain(helper);
      expect(humanMessage, `${helper} is gone from human-message.ts`).toContain(`export function ${helper}`);
    }
    expect(humanMessage).toContain("MAX_HUMAN_MESSAGE_CHARS = 240");
    expect(readme).toContain("240");
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

  test("the cost source it names is the one that supplies cost", () => {
    // "unavailable, never $0" is a truth rule, not a nicety: an empty window and
    // a broken query must not look alike.
    expect(readme).toContain("/api/usage/*");
    expect(server).toContain('"/api/usage/');
    expect(readme).toContain("`unavailable`");
    expect(client).toContain("cost unavailable");
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
    const noCmux = "cmux not detected — starting in this shell (monitoring only; Focus/Send stay disabled).";
    expect(quickstart, "QUICKSTART.md stopped quoting the no-cmux start message").toContain(noCmux);
    expect(startScript, "anthill-start.sh no longer prints that message").toContain(noCmux);

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
      "The ant hill is still — no tracked agents.",
      "All clear",
    ]) {
      expect(flowed, `QUICKSTART.md stopped quoting "${quoted}"`).toContain(quoted);
      expect(client, `"${quoted}" is not a string the client renders any more`).toContain(quoted);
    }
    // The verdict a monitoring-only install lands on, and the badge that means healthy.
    expect(quickstart).toContain("`Blocked`");
    expect(client).toContain('blocking: "Blocked"');
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
