/* The repaint seam.

   `render()` is the hub that made this client impossible to split. Measured over
   app.js: every candidate module — transcript, action log, broadcast, triage,
   lineage — collapsed to between 93 and 641 lines once render was cut out of its
   dependency closure, and ballooned to ~3,800 with it. The reason is always the
   same one line: a module fetches something, writes it to state, and then has to
   ask the whole board to paint. That single call drags in the entire render tree,
   and with it every other surface's dependencies.

   So the dependency is inverted rather than duplicated. app.js still owns
   render() and registers it here at boot; extracted modules import repaint() and
   know nothing about what painting involves. No cycle, because this module
   imports nothing.

   Deliberately a no-op before registration. Modules are evaluated before boot
   runs, and a module that repaints at import time is asking to paint a board that
   does not exist yet — silently doing nothing is the correct answer, not a
   thrown error that would only fire in that broken case. */

let painter = null;

/* Called once, by boot. Later calls replace the painter rather than stacking, so
   a re-boot in a test cannot leave two renderers attached to one board. */
export function setRepaint(fn) {
  painter = typeof fn === "function" ? fn : null;
}

export function repaint() {
  if (painter) painter();
}

// Test seam: lets a suite prove the no-op path and restore afterwards.
export function currentRepaint() {
  return painter;
}
