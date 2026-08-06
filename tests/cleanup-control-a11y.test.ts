/**
 * A11y regression lock for the Clean up control — the header's S6-T3 sweep
 * action, which shipped after the notification-center sweep and reached main
 * with no a11y pass. Evidence for every claim below is in
 * docs/A11Y-SWEEP-NOTIFICATION-CENTER.md, "Second pass — the Clean up control".
 *
 * Hermetic — safe for `bun run test:ci`. Reads only in-repo source via
 * import.meta.dir. No browser, no localhost, no live git state.
 *
 * The DOM halves are asserted against SOURCE TEXT, the convention
 * tests/inspector-transition.test.ts states outright: this client has no jsdom
 * by policy and the package carries zero runtime dependencies. Each assertion
 * names the live measurement it stands in for.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dir, "../src/web");
const appjs = readFileSync(join(WEB, "app.js"), "utf8");
const html = readFileSync(join(WEB, "index.html"), "utf8");
const css = readFileSync(join(WEB, "styles.css"), "utf8");

/* The control's own factory, isolated, so an assertion cannot match a lookalike
   line elsewhere in a 9,000-line file. */
const cleanupButton = appjs.slice(
  appjs.indexOf("function cleanupAction()"),
  appjs.indexOf("function cleanupOffered()"),
);

describe("CLEAN-1: the header notices its own sweep", () => {
  /* Measured before: with a sweep running and the rail's paint guard left alone,
     the button read "Clean up", stayed enabled, and its indicator stayed at
     opacity 0 — no change at all. Invalidating the guard by hand produced
     "Examining…", disabled, opacity 1, proving the guard was the cause.
     Measured after, guard untouched: "Examining…", aria-busy="true", opacity 1. */

  const railSig = appjs.slice(
    appjs.indexOf("state.widgetCustomizerOpen ?"),
    appjs.indexOf('if (paintUnchanged("widgets"'),
  );

  test("the rail's paint signature signs the sweep, not just widget values", () => {
    expect(railSig.length).toBeGreaterThan(200);
    /* Any one of these moving has to repaint the rail: `running` flips at both
       edges, `at` moves on every transition (so a plan arriving is covered even
       though it changes no widget), and `error` distinguishes a failed
       enumeration from a quiet one. */
    expect(railSig).toContain("state.cleanup.running");
    expect(railSig).toContain("state.cleanup.at");
    expect(railSig).toContain("state.cleanup.error");
  });

  test("the panel that shows the RESULT still signs it too", () => {
    /* The panel had this from the start; the rail is what was missing. If a
       later edit strips either, the surface it belongs to freezes mid-run. */
    const panelSig = appjs.slice(
      appjs.indexOf("function notifyPanelPaintSig"),
      appjs.indexOf("function notifyRowActions"),
    );
    expect(panelSig).toContain("state.cleanup.running");
  });
});

describe("CLEAN-2: activating Clean up does not strand the keyboard operator", () => {
  /* Measured before, under a repainting rail: focus the button, start the
     sweep, and activeElement became BODY — then stayed there through settle and
     through the control vanishing. render() restores by data-fkey; it FOUND the
     rebuilt node (so the drawer/panel fallbacks never ran) and called .focus()
     on something disabled, which does nothing.
     Measured after: activeElement stays .verdict-cleanup through both. */

  test("the control is never natively disabled", () => {
    /* A disabled element leaves the tab order. This one is rebuilt on the very
       paint that would disable it, so the focus restore has nothing to land on. */
    expect(cleanupButton).not.toMatch(/(^|[^-\w])disabled:/);
  });

  test("it says busy the way that keeps it focusable", () => {
    expect(cleanupButton).toMatch(/"aria-disabled": running \? "true" : null/);
    expect(cleanupButton).toMatch(/"aria-busy": running \? "true" : null/);
  });

  test("re-entry is refused in code, so nothing depended on the native attribute", () => {
    /* The only job `disabled` was doing that mattered. Losing this guard would
       make aria-disabled a lie a second click could disprove. */
    expect(appjs).toMatch(/if \(state\.cleanup\.running\) return;/);
  });

  test("the control still carries an fkey for the restore to find", () => {
    expect(cleanupButton).toContain('fkey: "cleanup-propose"');
  });

  test("the disabled styling follows the attribute that is actually set", () => {
    expect(css).toContain('.verdict-cleanup[aria-disabled="true"]');
    expect(css).not.toContain(".verdict-cleanup:disabled");
  });
});

describe("CLEAN-3: the sweep is announced from a region that survives the paint", () => {
  /* Measured before: the button node is replaced on every paint
     (sameNodeAsBefore: false), so aria-live on it could never fire — a live
     region destroyed and recreated announces nothing. A spinner says nothing to
     a screen reader, so a non-sighted operator had no signal at all.
     Measured after, on a real sweep: "Cleanup sweep running…" then "Cleanup
     proposal ready…", with regionNodeStillOriginal true. */

  test("a static live region is declared in the markup, not built by a paint", () => {
    const region = html.match(/<span id="cleanup-status"[^>]*>/)?.[0] ?? "";
    expect(region).not.toBe("");
    expect(region).toMatch(/role="status"/);
    expect(region).toMatch(/aria-live="polite"/);
    expect(region).toMatch(/visually-hidden/);
  });

  test("it lives where the rail's paint cannot destroy it", () => {
    /* renderHealthRail empties #health-widgets only. A region inside that node
       would be recreated every paint, which is the defect being fixed. */
    const header = html.slice(html.indexOf('<div class="rail-header">'), html.indexOf('<div id="health-widgets"'));
    expect(header).toContain('id="cleanup-status"');
    expect(appjs).toContain('widgets.textContent = "";');
  });

  test("the button no longer claims to be its own live region", () => {
    expect(cleanupButton).not.toContain('"aria-live"');
  });

  test("both transitions are announced, and they say different things", () => {
    /* "Incomplete" and "ready" are different facts; the operator must not read
       one as the other, which is the rule the error string itself follows. */
    expect(appjs).toMatch(/function announceCleanup\(text\)/);
    expect(appjs).toMatch(/announceCleanup\("Cleanup sweep running\./);
    expect(appjs).toMatch(/announceCleanup\(state\.cleanup\.error\s*\n?\s*\|\| "Cleanup proposal ready\./);
  });
});

describe("CLEAN-5: the indicator is not a colour-only signal", () => {
  /* Measured: mark aria-hidden="true", 9x9, opacity 0 at rest and 1 while
     running; the label changes Clean up -> Examining…; text contrast 4.68:1. */

  test("the mark is hidden from the tree that already carries the state", () => {
    expect(cleanupButton).toMatch(/class: "verdict-cleanup-mark", "aria-hidden": "true"/);
  });

  test("the state is carried by the label, not only by the indicator", () => {
    /* A screen reader gets nothing from a spinner. The word is the signal. */
    expect(cleanupButton).toMatch(/running \? "Examining…" : "Clean up"/);
  });

  test("reduced motion keeps a visible marker rather than removing it", () => {
    /* NOT verified live — this project's harness cannot emulate the media
       feature (see the sweep doc's check 5). Asserted at rule level only. */
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)", css.indexOf(".verdict-cleanup")));
    expect(reduced.slice(0, 260)).toContain("animation: none");
    expect(reduced.slice(0, 260)).toMatch(/border-top-color: currentColor/);
  });
});
