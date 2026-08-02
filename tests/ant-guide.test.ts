import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/* ANT-GUIDE.md is written for someone who has never seen the dashboard, which
   makes it the document most expensive to get wrong: a beginner cannot tell a
   stale doc from their own mistake, and will hunt for a button that was renamed
   two waves ago.

   So every label, verdict and command the guide quotes is pinned to the code
   that produces it. These are not spell-checks — each one fails when the product
   changes underneath the guide, which is exactly when it needs rewriting. */

const ROOT = join(import.meta.dir, "..");
const read = (name: string) => readFileSync(join(ROOT, name), "utf8");

const guide = read("ANT-GUIDE.md");
const deploy = read("DEPLOY.md");
const html = read("src/web/index.html");
/* Every client source, not app.js alone: the client is being split into ES
   modules, so a label the guide quotes can move between files without changing
   anything a reader sees. These assertions are about what the CLIENT produces. */
const app = readdirSync(join(ROOT, "src/web"))
  .filter((name) => name.endsWith(".js"))
  .sort()
  .map((name) => read(join("src/web", name)))
  .join("\n");
const catalogs = read("src/web/client-catalogs.js");

describe("ANT-GUIDE.md stays true to the product", () => {
  test("every tab it names is a real tab, and it names all of them", () => {
    const tabs = [...html.matchAll(/data-view="([a-z-]+)"/g)].map((m) => m[1]);
    expect(tabs.length).toBeGreaterThan(0);
    // The guide uses the human labels, not the internal ids.
    const labels: Record<string, string> = {
      now: "Now", "needs-you": "Needs you", working: "Working",
      idle: "Idle", history: "History", usage: "Usage",
    };
    for (const tab of tabs) {
      const label = labels[tab];
      expect(label, `no guide label mapped for tab "${tab}"`).toBeDefined();
      expect(guide, `guide never explains the ${label} tab`).toContain(`**${label}**`);
      expect(html).toContain(`>${label}<`);
    }
  });

  test("every summary card it describes is in the widget catalog", () => {
    const cardLabels = [...catalogs.matchAll(/\{ id: "[a-z-]+", label: "([^"]+)"/g)].map((m) => m[1]);
    /* Guard that the regex still matches something, keyed on a label this
       rename does not touch. It used to be "Needs you", which made the canary
       fail for the same reason the real assertion did when that card became
       "Findings" — a canary that dies with the thing it guards tells you
       nothing extra. */
    expect(cardLabels).toContain("Momentum");
    expect(cardLabels.length).toBe(5);
    for (const label of cardLabels) {
      expect(guide, `guide never describes the ${label} card`).toContain(`**${label}**`);
    }
  });

  test("the liveness chips it tabulates are the ones the client renders", () => {
    // Both readings of `unknown` included — the guide explains why they differ.
    for (const label of ["Process live", "Exited cleanly", "Died", "Awaiting first check", "No process evidence"]) {
      expect(app, `${label} is not a label the client produces`).toContain(`label: "${label}"`);
      expect(guide, `guide omits the ${label} chip`).toContain(`**${label}**`);
    }
  });

  test("the Degraded severities it explains are the ones the client shows", () => {
    /* Assert the HEADLINES, not DEGRADED_SEVERITY.label. The severity badge was
       deleted when the health card's headline became the severity itself, so
       those internal labels no longer reach a screen — "Blocking" is the key's
       name, "Blocked" is the word the operator reads, and the guide is right to
       teach the latter. A doc test must pin what is visible. */
    const headlines = [...app.matchAll(/const SEVERITY_HEADLINE = \{([^}]*)\}/g)]
      .flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((h) => h[1]));
    expect(headlines.sort()).toEqual(["Advisory", "Blocked", "Stale"]);
    const severities = headlines;
    for (const label of severities) {
      expect(guide, `guide omits the ${label} severity`).toContain(`**${label}**`);
    }
    /* Only the verdicts a reader looks UP need an entry. "Operational" is the
       healthy state and explains itself; requiring the guide to name it made
       this assert prose style rather than coverage, and it failed the moment the
       guide was tightened. The two that mean something is wrong must stay
       explained, because those are the ones someone arrives here confused by. */
    for (const verdict of ["Degraded", "Offline"]) {
      expect(app).toContain(`label: "${verdict}"`);
      expect(guide, `guide never explains the ${verdict} verdict`).toContain(verdict);
    }
    expect(app).toContain('label: "Operational"'); // still the healthy label
  });

  test("the restart command and port match the deploy rulebook", () => {
    const restart = "launchctl kickstart -k gui/$UID/ai.imaginethat.anthill";
    expect(deploy, "DEPLOY.md no longer documents this restart").toContain(restart);
    expect(guide, "guide's restart command drifted from DEPLOY.md").toContain(restart);
    // 4701 is the production port the guide sends a beginner to; DEPLOY.md owns
    // that fact, including the rule against starting it by hand.
    expect(deploy).toContain("4701");
    expect(guide).toContain("http://127.0.0.1:4701");
    expect(guide).toContain("Do not start anything on port 4701 by hand");
  });

  test("every script and sibling document it points at exists", () => {
    for (const script of [...guide.matchAll(/scripts\/([a-z-]+\.sh)/g)].map((m) => m[1])) {
      expect(() => read(join("scripts", script)), `guide references missing scripts/${script}`).not.toThrow();
    }
    for (const doc of [...guide.matchAll(/\]\(\.\/([A-Z-]+\.md)\)/g)].map((m) => m[1])) {
      expect(() => read(doc), `guide links to missing ${doc}`).not.toThrow();
    }
    // The setup command it tells a reader to run must still be a real script.
    expect(read("package.json")).toContain('"setup:cmux"');
    expect(guide).toContain("bun run setup:cmux");
  });

  test("the empty-board message it quotes is the one the client shows", () => {
    const empty = "The ant hill is still — no tracked agents.";
    expect(app).toContain(empty);
    expect(guide).toContain(empty.replace(/\.$/, ""));
  });

  test("the keyboard map matches the keys the client actually handles", () => {
    // Arrow navigation, its Home/End jumps, and the clamp-not-wrap promise.
    for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
      expect(app).toContain(`"${key}"`);
    }
    expect(guide).toContain("`↑` / `↓`");
    expect(guide).toContain("`Home` / `End`");
    expect(guide).toContain("stop at the top and bottom rather than wrapping");
    // Enter opens the drawer; Escape closes it.
    expect(app).toContain('e.key !== "Enter"');
    expect(app).toContain('e.key !== "Escape"');
  });
});
