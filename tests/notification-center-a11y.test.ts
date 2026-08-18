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
       indistinguishable from a broken one.

       Matched as a prefix, not as a whole call: the claim is that the badge is
       painted from the PANEL's own count and tone, which is what stops the
       button disagreeing with what it opens. The call also carries the spoken
       name's two extra populations now (waiting = stripAlerting fleet-wide,
       watching = the watcher's list length), and pinning the closing paren made
       this an assertion about arity, which it was never trying to be. */
    expect(appjs.includes("renderNotifyToggle(model.count, model.tone, open")).toBe(true);
  });

  test("semantic danger is the fill of exactly one badge tone", () => {
    const badgeRules = [...css.matchAll(/\.notify-badge\.is-(\w+)\s*\{([^}]*)\}/g)]
      .map(([, tone, body]) => ({ tone, fillsDanger: /background:\s*var\(--color-status-danger\)/.test(body) }));
    expect(badgeRules.length).toBeGreaterThanOrEqual(3);
    expect(badgeRules.filter((r) => r.fillsDanger).map((r) => r.tone)).toEqual(["blocked"]);
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

describe("A11Y-3: the panel's container can carry the name it is given", () => {
  /* Measured before: the AX tree reported `role: generic, name: "4 agents
     stopped"`. ARIA prohibits an accessible name on role=generic, so the
     aria-labelledby sitting there named a container no screen reader would
     enter, and the panel was unreachable by rotor. Measured after: `role:
     group, name: "Notifications"`. */

  const panelTag = html.match(/<div id="notifications-panel"[^>]*>/)?.[0] ?? "";

  test("it declares a role that permits naming", () => {
    expect(panelTag).not.toBe("");
    /* generic is the implicit role of a bare div and is name-PROHIBITED. Any of
       these three carries a name legitimately; group is what shipped, and is
       what the panel's own instrument block already uses one level down. */
    expect(panelTag).toMatch(/role="(group|region|dialog)"/);
  });

  test("its name is stable across paints, not the heading that counts agents", () => {
    expect(panelTag).toMatch(/aria-label="[^"]+"/);
    /* The <h2> reads "4 agents stopped" and is rewritten on every paint. Naming
       the container from it means the container is re-announced whenever the
       count moves, which is noise rather than information. */
    expect(panelTag).not.toContain("aria-labelledby");
    /* …and the heading itself stays, because the panel still needs one. */
    expect(appjs).toContain('id: "notify-panel-title"');
  });
});

describe("A11Y-4: no two controls in the panel answer to the same name", () => {
  /* Measured before: four buttons named exactly "Focus" in one open panel —
     indistinguishable in a rotor or under voice control. The dock is a
     one-agent surface where "Focus" is unambiguous; this list is the one place
     several agents' tools coexist. Measured after: "Focus Debug schedule draft
     generation algorithm". */

  test("the panel names its Focus control for the agent it focuses", () => {
    const region = appjs.slice(
      appjs.indexOf("---------- the notification center ----------"),
      appjs.indexOf("function renderSettingsPanel"),
    );
    expect(region).toMatch(/ariaLabel: "Focus " \+ agentName\(found\.agent\)/);
  });

  test("renderDockTool is extended, not forked, and every other call site is unchanged", () => {
    /* The gate matters more than the label: renderDockTool is the one place the
       capability check, confirm strip and busy state live, and a second Focus
       button built beside it would drift from all three. The override is opt-in
       and null when absent, so every dock tool keeps its visible label as its
       name — and `ariaLabel` is the option name this file already uses for the
       same job on the rename forms, rather than a new spelling. */
    expect(appjs).toContain('"aria-label": opts.ariaLabel || (opts.iconOnly ? accessibleName : null),');

    /* Exactly one call site overrides the name: the notification row, which is
       the only place several agents' tools share a list. If a second appears,
       either it has the same ambiguity — and this test should be updated with
       the reason — or a caller is renaming a control that was fine. */
    /* Block comments stripped first: this file explains itself at length, and a
       call site's options can sit a dozen prose lines below its opening paren,
       which no fixed window would reach. */
    const code = appjs.replace(/\/\*[\s\S]*?\*\//g, "");
    const callSites = [...code.matchAll(/renderDockTool\(/g)]
      .map((m) => code.slice(m.index ?? 0, (m.index ?? 0) + 200));
    expect(callSites.length).toBeGreaterThan(1);
    expect(callSites.filter((site) => site.includes("ariaLabel:")).length).toBe(1);
  });

  test("the destination stays a description rather than joining the name", () => {
    /* First draft appended focusDestinationHint and measured as a name that read
       a home path aloud, one segment at a time, on every row. */
    expect(appjs).not.toMatch(/ariaLabel: "Focus " \+ agentName\(found\.agent\) \+ " — "/);
    expect(appjs).toMatch(/action === "focus" \? focusDestinationHint\(agent\)/);
  });
});

describe("A11Y-5: a quiet row's name contains everything the row visibly says", () => {
  /* WCAG 2.5.3. Measured before — visible "the-ant-hill · Execute LANE-FE1 …",
     name "Execute LANE-FE1 …" — the program the operator can read was missing
     from the name that overrides it, so saying what you see matched nothing.
     Measured after: name.includes(visibleProgram) === true. */

  const quietRow = appjs.slice(
    appjs.indexOf("function notifyQuietRow(item)"),
    appjs.indexOf("function renderNotificationCenter"),
  );

  test("the row builds its visible prefix once and names itself with it", () => {
    expect(quietRow.length).toBeGreaterThan(100);
    /* The program and the separator the row RENDERS… */
    expect(quietRow).toMatch(/class: "notify-quiet-prog", text: item\.source\.programName/);
    /* …are the same program and separator it is NAMED by. Two expressions, so
       the test reads both: this is the drift the defect was. */
    expect(quietRow).toMatch(/const visible = \(item\.source\.programName \? item\.source\.programName \+ " · " : ""\) \+ item\.impact;/);
    expect(quietRow).toMatch(/"aria-label": item\.evidence \? visible \+ " " \+ item\.evidence : visible/);
  });

  test("the blocking row still names its program too, by its own route", () => {
    /* The row above this one never had the bug — it says "In <program>." — and
       the fix must not quietly restyle it into agreement. */
    expect(appjs).toMatch(/item\.impact \+ " In " \+ \(item\.source\.programName \|\| "an unnamed program"\)/);
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
     by data-fkey, so a control without one is a control the restore cannot find. */

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

/* render()'s focus restore, isolated — from the focusKey capture to the end of
   the function, so an assertion below cannot accidentally match a lookalike line
   elsewhere in a 9,000-line file. */
const restoreBlock = (() => {
  const from = appjs.indexOf("const focusKey = document.activeElement && document.activeElement.dataset");
  const at = appjs.indexOf("else if (focusWasInDrawer", from);
  return from < 0 || at < 0 ? "" : appjs.slice(from, appjs.indexOf("\n}\n", at));
})();

describe("A11Y-2: a vanished row does not strand the operator on <body>", () => {
  /* Reproduced live on 2026-08-06, twice, before the fix: focus a row's Reply,
     make that agent stop asking exactly as the server does on the next scan,
     call the app's own repaint() —

       { rows: 4 → 3, rowGone: true, activeIsBody: true, panelOpen: true }

     render() restores focus by data-fkey; when the row leaves the feed the fkey
     goes with it, the lookup finds nothing, and focus falls to <body> — the top
     of the document, from inside a panel that is still open. The drawer has
     focusDrawerLead() for exactly this. The panel had no lead.

     Verified fixed on the same board: activeIsBody false, activeInPanel true,
     landing on the panel's first control. Three regressions checked alongside —
     the fkey-survives path still holds focus, a CLOSED panel is not hijacked
     (focus left on #search across a repaint), and Escape still returns to the
     toggle.

     Asserted against SOURCE, following tests/inspector-transition.test.ts: this
     client has no jsdom by policy, so the DOM half of render() is pinned by
     reading it. Each assertion names the behaviour it stands in for. */

  test("the restore block is where it is expected to be", () => {
    expect(restoreBlock.length).toBeGreaterThan(200);
    expect(restoreBlock).toContain("CSS.escape(focusKey)");
  });

  test("render() knows whether focus was standing in the panel", () => {
    /* Not a grep for a name: without this the fallback cannot tell "their
       control went away" from "they were never in here", which is the same
       distinction focusWasInDrawer exists to make one line above. */
    expect(appjs).toMatch(
      /const focusWasInPanel = Boolean\(document\.activeElement\s*\n?\s*&& \$\("notifications-panel"\)\?\.contains\(document\.activeElement\)\);/,
    );
  });

  test("a lost fkey inside an open panel falls back to the panel, not to <body>", () => {
    expect(restoreBlock).toMatch(/else if \(focusWasInPanel && state\.notifyPanelOpen\)/);
    /* Guarded on the panel still being OPEN. Firing into a closed panel would
       pull focus back into a surface the operator just dismissed — the same
       reason the drawer's branch carries `&& !inspector.hidden`. */
    expect(restoreBlock).not.toMatch(/else if \(focusWasInPanel\)\s*\{/);
  });

  test("open-focus and restore-focus choose the same lead, so they cannot drift", () => {
    /* The real invariant, and the one a rename would break silently: the node
       the restore lands on must be the node toggleNotificationsPanel already
       picks when the operator opens the panel. Two different queries would mean
       the panel had two different "first controls" depending on how you arrived
       at it. */
    const leadQuery = 'querySelector("button:not([disabled])")';
    expect(appjs.indexOf('$("notifications-panel")?.' + leadQuery)).toBeGreaterThan(-1);
    expect(restoreBlock).toContain(leadQuery);
    /* …and a panel with no enabled control left still has somewhere to go. */
    expect(restoreBlock).toContain('$("notify-toggle")');
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

  test("A11Y-6: both row actions clear 44px once there is no pointer", () => {
    /* Measured before at 420px and 768px, same row, same line: Reply 115x44,
       Focus 70x32 — and Focus is the one that moves the operator to the agent.
       .notify-act was in the touch sweep; the .dock-tool beside it was missed
       when the panel shipped. Measured after: 44. */
    const sweep = styleRules.find(
      (r) => r.selector.includes(".notify-act") && /min-height:\s*44px/.test(r.body),
    );
    expect(sweep).toBeDefined();
    expect(sweep ? sweep.selector : "").toContain(".notify-row-acts .dock-tool");
    /* …and it is the touch breakpoint that carries it, not the desktop rule. */
    const sweepSelector = sweep ? sweep.selector : "";
    const at = cleanCss.indexOf(sweepSelector);
    expect(at).toBeGreaterThan(-1);
    expect(cleanCss.lastIndexOf("@media (max-width: 1024px)", at)).toBeGreaterThan(-1);
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
  /* Measured live: no horizontal document scroll at 420, 768 or 1280. The 420px
     LEFT overflow was left unpinned here when the sweep found it, because
     pinning a defect green is how it stops being a defect. A11Y-1 fixed it, so
     it is pinned now — measured after the fix at 420px: panel left 32, right
     388, flush with its anchor, nothing clipped on either edge, scrollWidth 420
     against a 420 viewport. */

  test("the panel clamps its own width rather than trusting the viewport", () => {
    const panel = styleRules.find((r) => r.selector === ".notify-panel");
    expect(panel?.body).toMatch(/width:\s*min\(452px,/);
    expect(panel?.body).toMatch(/max-height:\s*min\(/);
    expect(panel?.body).toMatch(/overflow-y:\s*auto/);
  });

  test("A11Y-1: at narrow widths the panel FILLS its anchor instead of overhanging it", () => {
    /* The defect was an origin mismatch, not a width mistake. The clamp measured
       against the viewport (100vw) while the panel is anchored to
       .masthead-signals, which `align-self: center` left 48px inside the
       viewport edge — so 396px of panel hung off a 372px anchor and overhung by
       exactly that gutter. body overflow-x is hidden, so the clipped strip was
       unreachable: "WAITING ON YOU" read "AITING ON YOU" and the ember rails
       that mean a person is the blocker were partly off-screen.

       The gutter is a function of the row's own content width, so no static
       calc() can express it. The anchor has to BE the content edge, and the
       panel has to fill it rather than measure the window. */
    /* ⚠ THIS TEST DOES NOT GUARD THE DEFECT. It documents the intended
       mechanism, which has value, but three mutations measured on the live board
       at 420px show what it actually catches:

         today                                     panel  32 → 388   ok
         A  anchor reverted to align-self:center    panel  48 → 372   ok      ← RED here
         B  centred anchor + viewport-measured w.   panel -24 → 372   CLIPPED ← RED here
         C  anchor stretched, width clamp back      panel  -8 → 388   CLIPPED ← GREEN here

       Wrong in both directions: it fires on A, which is merely a narrower panel
       and harms nobody, and it is blind to C, which is the shipped defect
       arriving by another route. The defect was never "the file lacks a
       declaration" — it was "the panel's box leaves the window", which is a
       number. tests/notification-center-geometry.test.ts measures that number;
       this one only records what the CSS was trying to say. */
    const from = cleanCss.indexOf("@media (max-width: 760px)");
    const nextAt = cleanCss.indexOf("@media", from + 1);
    const block = cleanCss.slice(from, nextAt === -1 ? undefined : nextAt);
    // The anchor stops being a centred island.
    expect(block).toMatch(/\.masthead-signals\s*\{[^}]*align-self:\s*stretch/);
    // …and the panel fills it, rather than sizing itself off the viewport.
    expect(block).toMatch(/\.notify-panel\s*\{[^}]*left:\s*0/);
    expect(block).toMatch(/\.notify-panel\s*\{[^}]*right:\s*0/);
    expect(block).toMatch(/\.notify-panel\s*\{[^}]*width:\s*auto/);
    /* The specific regression: a viewport-measured width here is the bug
       returning, because the origin it measures from is not the viewport edge. */
    const panelNarrow = block.slice(block.indexOf(".notify-panel"));
    expect(panelNarrow).not.toContain("100vw");
  });

  test("the narrow layout stays absolute, so the panel travels with its button", () => {
    /* A fixed dropdown hangs over the board while the control that opened it
       scrolls away; the panel and its toggle have to stay one object. */
    const narrow = cleanCss.slice(cleanCss.indexOf("@media (max-width: 760px)"));
    expect(narrow).toContain(".notify-panel");
    expect(narrow.slice(0, 400)).not.toMatch(/position:\s*fixed/);
  });
});
