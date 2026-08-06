/**
 * A11y regression lock for the notification center — the invariants the live
 * sweep on 2026-08-06 MEASURED as holding, pinned so they cannot quietly stop
 * holding. Evidence and the failures that are NOT pinned here (because they are
 * open defects, not invariants) live in docs/A11Y-SWEEP-NOTIFICATION-CENTER.md.
 *
 * Every claim below was verified in a real browser against a throwaway server
 * on :4799 before it was written down; the test is the claim's tripwire, not a
 * restatement of the code.
 *
 * Hermetic — safe for `bun run test:ci`. Reads only in-repo source via
 * import.meta.dir. No ~/.cmuxterm, no localhost, no live git state.
 *
 * The DOM halves are asserted against SOURCE TEXT, following the convention
 * tests/inspector-transition.test.ts states outright: this client has no jsdom
 * by policy and the package carries zero runtime dependencies. A source
 * assertion is a weaker instrument than a rendered tree, so each one names the
 * live measurement it stands in for.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dir, "../src/web");
const read = (name: string) => readFileSync(join(WEB, name), "utf8");

const html = read("index.html");
const css = read("styles.css");
const appjs = read("app.js");

interface NotifyModule {
  feedTone: (items: unknown[]) => string;
  blockingCount: (items: unknown[]) => number;
  notificationFeed: (snap: unknown, queue?: unknown[], now?: number) => Array<{ severity: string }>;
  notificationPanelModel: (snap: unknown, queue?: unknown[], now?: number) => {
    tone: string;
    count: number;
    groups: Array<{ items: unknown[] }>;
    watching: unknown[];
    investigations: unknown[];
  };
}
interface ToggleModule {
  notifyToggleView: (
    notify: { enabled: boolean; permission: string },
    supported?: boolean,
    count?: number,
    tone?: string,
  ) => { disclosureLabel: string; ariaLabel: string; count: number; tone: string };
}

/* Behaviour comes through the client's own test harness, not through named
   imports of an untyped .js module — the tests/clean-board.test.ts pattern. One
   bare side-effect import, then read what is needed off globalThis.TheAntHill,
   which app.js already re-exports the notification helpers onto (app.js:1265,
   the `notifyToggleView` / `notificationFeed` / `notificationPanelModel` lines).
   Claims about the SOURCE rather than the behaviour use readFileSync instead. */
let notify: NotifyModule;
let toggle: ToggleModule;

beforeAll(async () => {
  // @ts-expect-error The dependency-free browser client has no declaration file.
  await import("../src/web/app.js");
  const harness = (globalThis as unknown as { TheAntHill: NotifyModule & ToggleModule }).TheAntHill;
  notify = harness;
  toggle = harness;
});

/* One agent, one program, one attention signal. The severity split is the whole
   subject here, so nothing else about the fixture is allowed to matter. */
const boardWith = (kind: string) => ({
  generatedAt: "2026-08-06T03:00:00.000Z",
  totals: { working: 1 },
  programs: [{
    id: "p1",
    name: "Fixture program",
    agents: [{
      id: "a1",
      programId: "p1",
      displayName: "Fixture agent",
      lifecycle: "waiting",
      provider: "claude",
      attentionSignal: { kind, evidence: "fixture evidence sentence" },
    }],
  }],
});
const EMPTY_BOARD = { generatedAt: "2026-08-06T03:00:00.000Z", totals: { working: 0 }, programs: [] };
const NOW = Date.parse("2026-08-06T03:01:00.000Z");

/* ------------------------------------------------------------------ */

describe("the badge is ember only when a person is the blocker", () => {
  /* Measured live at 1280px on 2026-08-06: with the real board holding blocking
     agents the badge painted background rgb(194,59,46), which IS --ember
     (#c23b2e). Driven through renderNotifyToggle with tone "noticed" it painted
     a transparent background and amber ink, and with tone "clear" a transparent
     background, grey ink and a rendered "0". This pins the derivation that
     chooses between them. */

  test("a noticed-only board yields no blocking severity, so no ember can be earned", () => {
    const feed = notify.notificationFeed(boardWith("stalled-active"), [], NOW);
    expect(feed.length).toBe(1);
    expect(feed.map((i) => i.severity)).toEqual(["warning"]);
    expect(notify.feedTone(feed)).toBe("noticed");
    expect(notify.blockingCount(feed)).toBe(0);
  });

  test("a noticed-only board renders zero ember-railed rows", () => {
    /* The ember rail is .notify-row::before, and notifyRow is only ever called
       for model.groups — so "no ember rail" and "no grouped rows" are the same
       fact, and this is the one the model can be asked about. */
    const model = notify.notificationPanelModel(boardWith("stalled-active"), [], NOW);
    expect(model.tone).toBe("noticed");
    expect(model.count).toBe(0);
    expect(model.groups.reduce((n, g) => n + g.items.length, 0)).toBe(0);
    expect(model.watching.length).toBe(1);
  });

  test("a person-blocked board earns ember, and the count is the people waiting", () => {
    const model = notify.notificationPanelModel(boardWith("input-requested"), [], NOW);
    expect(model.tone).toBe("blocked");
    expect(model.count).toBe(1);
    expect(model.groups.reduce((n, g) => n + g.items.length, 0)).toBe(1);
  });

  test("an empty board is clear, and clear is a rendered zero rather than an absence", () => {
    const model = notify.notificationPanelModel(EMPTY_BOARD, [], NOW);
    expect(model.tone).toBe("clear");
    expect(model.count).toBe(0);
    expect(toggle.notifyToggleView({ enabled: false, permission: "default" }, true, 0, "clear").count).toBe(0);
    /* The digit is painted unconditionally; an absent badge would be
       indistinguishable from a broken one. */
    expect(appjs.includes("renderNotifyToggle(model.count, model.tone, open)")).toBe(true);
  });

  test("--ember is the fill of exactly one badge tone", () => {
    const badgeRules = [...css.matchAll(/\.notify-badge\.is-(\w+)\s*\{([^}]*)\}/g)]
      .map(([, tone, body]) => ({ tone, fillsEmber: /background:\s*var\(--ember\)/.test(body) }));
    expect(badgeRules.length).toBeGreaterThanOrEqual(3);
    expect(badgeRules.filter((r) => r.fillsEmber).map((r) => r.tone)).toEqual(["blocked"]);
  });
});

describe("the disclosure states its backlog in words, never as a bare digit", () => {
  /* Measured live: the toggle's accessible name read "Notifications, 2 agents
     waiting on you" while the visible badge glyph was "2" and carried
     aria-hidden="true". A screen reader that fell through to the glyph would
     announce a naked number with no unit. */

  test("every tone names what the number counts", () => {
    const view = (count: number, tone: string) =>
      toggle.notifyToggleView({ enabled: false, permission: "default" }, true, count, tone).disclosureLabel;
    expect(view(2, "blocked")).toBe("Notifications, 2 agents waiting on you");
    expect(view(1, "blocked")).toBe("Notifications, 1 agent waiting on you");
    expect(view(3, "noticed")).toBe("Notifications, 3 being watched, nobody waiting on you");
    expect(view(0, "clear")).toBe("Notifications, nothing waiting");
    for (const label of [view(2, "blocked"), view(3, "noticed"), view(0, "clear")]) {
      expect(label).not.toMatch(/^\s*\d+\s*$/);
      expect(label.startsWith("Notifications")).toBe(true);
    }
  });

  test("the badge glyph is hidden from the tree that already carries the count", () => {
    const paint = appjs.length > 0 && read("notifications.js");
    expect(paint).toBeTruthy();
    const badgeAppend = /class: "notify-badge " \+ BADGE_TONE_CLASS\[view\.tone\][\s\S]{0,120}?"aria-hidden": "true"/;
    expect(badgeAppend.test(paint as string)).toBe(true);
  });
});

describe("the toggle is a disclosure and says so", () => {
  /* Measured live: aria-expanded flipped false→true→false across open, Esc and
     outside-press, and aria-controls resolved to the panel element every time. */

  test("the markup ships expanded/controls rather than waiting for the first paint", () => {
    const btn = html.match(/<button[^>]*id="notify-toggle"[^>]*>/);
    expect(btn).not.toBeNull();
    expect(btn?.[0]).toContain('aria-expanded="false"');
    expect(btn?.[0]).toContain('aria-controls="notifications-panel"');
  });

  test("every paint re-states both, and never claims to be a switch", () => {
    const paint = read("notifications.js");
    expect(paint).toContain('btn.setAttribute("aria-expanded", open ? "true" : "false")');
    expect(paint).toContain('btn.setAttribute("aria-controls", "notifications-panel")');
    /* aria-pressed belongs to delivery, which is a different control in the
       panel's footer. A disclosure that also claimed pressed-ness would be two
       states for one button. */
    expect(paint).toContain('btn.removeAttribute("aria-pressed")');
  });

  test("the panel it names exists and is the thing that hides", () => {
    expect(html).toMatch(/<div id="notifications-panel"[^>]*hidden/);
    expect(appjs).toContain("panel.hidden = !open;");
  });
});

describe("Escape returns the operator to the control that opened the panel", () => {
  /* Measured live: focus was inside the panel, Escape closed it, and
     document.activeElement was #notify-toggle — not <body>. */

  test("closing returns focus by default, and only a click declines it", () => {
    expect(appjs).toMatch(/function closeNotificationsPanel\(returnFocus = true\)/);
    expect(appjs).toMatch(/if \(returnFocus\) \$\("notify-toggle"\)\?\.focus\(\);/);
  });

  test("the Escape handler takes the returning form", () => {
    const branch = appjs.match(/if \(state\.notifyPanelOpen\) \{\s*closeNotificationsPanel\(\);/);
    expect(branch).not.toBeNull();
    /* The outside-press path is the one that deliberately does not steal focus
       back, because the operator's click already chose where to be. */
    expect(appjs).toContain("closeNotificationsPanel(false);");
  });
});

describe("a live repaint puts the operator back on the control they were using", () => {
  /* Measured live: with focus on a row's Reply and the panel's paint signature
     forced to change, render() restored focus to the same button. It does that
     by data-fkey, so a control without one is a control the restore cannot find.
     (The case where the control itself LEAVES the feed is an open defect — see
     the sweep doc; it is not pinned here because it does not hold.) */

  test("every button the panel builds carries an fkey", () => {
    const region = appjs.slice(
      appjs.indexOf("---------- the notification center ----------"),
      appjs.indexOf("function renderSettingsPanel"),
    );
    expect(region.length).toBeGreaterThan(1000);
    const buttons = region.match(/el\("button", \{/g) ?? [];
    const keys = region.match(/dataset: \{ fkey/g) ?? [];
    expect(buttons.length).toBeGreaterThanOrEqual(6);
    expect(keys.length).toBe(buttons.length);
  });

  test("render() restores focus by fkey before anything else can claim it", () => {
    expect(appjs).toMatch(/const focusKey = document\.activeElement && document\.activeElement\.dataset/);
    expect(appjs).toMatch(/const node = document\.querySelector\(`\[data-fkey="\$\{CSS\.escape\(focusKey\)\}"\]`\);/);
  });
});

/* ---------- CSS invariants, read out of the stylesheet itself ---------- */

/* Comments carry braces and prose that would land in a selector capture, and
   this stylesheet is more comment than rule by design. Strip them once, and do
   every index-based check below against the SAME stripped text so offsets and
   selectors describe one document. */
const cleanCss = css.replace(/\/\*[\s\S]*?\*\//g, "");

/* Rules only: the regex cannot cross a brace, so @media wrappers are skipped
   and their contents matched individually. */
const styleRules = [...cleanCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, body]) => ({ selector: selector.trim(), body }));

describe("no control in the panel is revealed by hover", () => {
  /* Measured live at 420px with no pointer over the panel: every Focus and
     Reply button reported opacity 1, visibility visible and a real box. A
     hover-revealed action is one that is hidden at rest, so the rest state IS
     the measurement — and this pins the rules that could take it away. */

  const GEOMETRY = ["opacity", "visibility", "display", "transform", "content", "width", "height", "max-height", "pointer-events"];

  test("every :hover rule touching the panel changes ink, never presence", () => {
    const hoverRules = styleRules.filter((r) => r.selector.includes("notify") && r.selector.includes(":hover"));
    expect(hoverRules.length).toBeGreaterThanOrEqual(4);
    for (const rule of hoverRules) {
      const gating = GEOMETRY.filter((prop) => new RegExp("(^|[;{\\s])" + prop + "\\s*:").test(rule.body));
      expect({ selector: rule.selector, gating }).toEqual({ selector: rule.selector, gating: [] });
    }
  });

  test("the row reserves its action space at rest, so nothing shifts under a pointer", () => {
    const meta = styleRules.find((r) => r.selector === ".notify-row-meta");
    expect(meta?.body).toMatch(/min-height:/);
  });
});

describe("nothing in the panel animates when the operator asks for no motion", () => {
  /* NOT emulated live: gstack browse exposes no Emulation.setEmulatedMedia, so
     the reduce branch could not be observed in a running browser. What follows
     is the rule-level proof that stands in for it, and the sweep doc records the
     check as emulation-not-run rather than as a pass. */

  test("the universal reduce kill is present and unoverridable", () => {
    const kill = cleanCss.match(/@media \(prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{([^}]*)\}/);
    expect(kill).not.toBeNull();
    expect(kill?.[1]).toMatch(/animation:\s*none\s*!important/);
    expect(kill?.[1]).toMatch(/transition:\s*none\s*!important/);
  });

  test("every panel transition is additionally gated behind no-preference", () => {
    const motion = styleRules.filter(
      (r) => r.selector.includes("notify") && /(^|[;{\s])(transition|animation)\s*:/.test(r.body),
    );
    expect(motion.length).toBeGreaterThan(0);
    for (const rule of motion) {
      const at = cleanCss.indexOf(rule.selector);
      const opened = cleanCss.lastIndexOf("@media (prefers-reduced-motion: no-preference) {", at);
      expect(opened).toBeGreaterThan(-1);
      /* …and the rule is still inside that block: no intervening close at the
         media rule's own nesting depth. */
      let depth = 0;
      let closedBefore = false;
      for (let i = cleanCss.indexOf("{", opened); i < at; i += 1) {
        if (cleanCss[i] === "{") depth += 1;
        else if (cleanCss[i] === "}") { depth -= 1; if (depth === 0) { closedBefore = true; break; } }
      }
      expect({ selector: rule.selector, closedBefore }).toEqual({ selector: rule.selector, closedBefore: false });
    }
  });
});

describe("the panel fits the window it opens over", () => {
  /* Measured live: no horizontal document scroll at 420, 768 or 1280. The
     420px LEFT overflow is a separate, open defect — recorded in the sweep doc,
     deliberately not pinned here, because pinning a defect green is how it
     stops being a defect. */

  test("the panel clamps its own width rather than trusting the viewport", () => {
    const panel = styleRules.find((r) => r.selector === ".notify-panel");
    expect(panel?.body).toMatch(/width:\s*min\(452px,/);
    expect(panel?.body).toMatch(/max-height:\s*min\(/);
    expect(panel?.body).toMatch(/overflow-y:\s*auto/);
  });

  test("the narrow layout stays absolute, so the panel travels with its button", () => {
    /* A fixed dropdown hangs over the board while the control that opened it
       scrolls away; the panel and its toggle have to stay one object. */
    const narrow = cleanCss.slice(cleanCss.indexOf("@media (max-width: 760px)"));
    expect(narrow).toContain(".notify-panel");
    expect(narrow.slice(0, 400)).not.toMatch(/position:\s*fixed/);
  });
});
