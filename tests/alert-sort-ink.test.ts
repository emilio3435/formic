import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
// The dependency-free client has no declaration files; agent-model is pure.
// @ts-expect-error intentional untyped import
import { alertFirst, alertRecent } from "../src/web/agent-model.js";

// app.js exposes the pair on TheAntHill; import shape mirrors web-client.test.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let M: any;
let source = "";
let styles = "";

beforeAll(async () => {
  // @ts-expect-error intentional untyped import
  await import("../src/web/app.js");
  M = (globalThis as unknown as { TheAntHill: any }).TheAntHill;
  const webDir = join(import.meta.dir, "../src/web");
  source = readdirSync(webDir)
    .filter((name) => name.endsWith(".js"))
    .sort()
    .map((name) => readFileSync(join(webDir, name), "utf8"))
    .join("\n");
  styles = readFileSync(join(import.meta.dir, "../src/web/styles.css"), "utf8");
});

describe("alertFirst", () => {
  // The ordering contract is this helper's whole job: rows the predicate
  // marks hot sort first, everything else untouched. Membership (what
  // "alerting" means — including the ack veto) is the CALLER's business,
  // injected, so these tests cannot silently start testing the wrong unit.
  const byFlag = (a: { hot: boolean }) => a.hot;

  test("alerting rows sort before calm rows", () => {
    const rows = [{ id: "a", hot: false }, { id: "b", hot: true }, { id: "c", hot: false }, { id: "d", hot: true }];
    expect(alertFirst(rows, byFlag).map((r: { id: string }) => r.id)).toEqual(["b", "d", "a", "c"]);
  });

  test("ties keep input order — the sort is stable in both partitions", () => {
    // The PARTITION is the server's order: alertFirst says nothing about which
    // ask came first, only which rows are hot. Recency is alertRecent's job
    // (below), and it is the only thing licensed to reorder within the bucket.
    const rows = [{ id: "s1", hot: true }, { id: "s2", hot: false }, { id: "s3", hot: true }, { id: "s4", hot: false }];
    expect(alertFirst(rows, byFlag).map((r: { id: string }) => r.id)).toEqual(["s1", "s3", "s2", "s4"]);
  });

  test("sorts in place and returns the same array", () => {
    // The section builder sorts its buckets the way byRole already does —
    // in place. A copy would silently leave the rendered order unchanged.
    const rows = [{ id: "x", hot: false }, { id: "y", hot: true }];
    expect(alertFirst(rows, byFlag)).toBe(rows);
    expect(rows[0].id).toBe("y");
  });
});

/* B1 — recency, and only recency, inside the hot bucket.

   The key is `alertSince`: first-seen of the CURRENT alertFingerprint, which is
   the only clock on the record that means "this ask started". Every other one
   the row carries advances for reasons that are not a new ask —
   `hookLifecycleAt` re-stamps the same needsInput every ~25s, `lastHumanFacingAt`
   advances on ordinary replies, `updatedAt` is heartbeats — so ranking on any of
   them ships a queue that reshuffles while nobody asked anything. The injected
   `sinceOf` is what keeps that decision at the CALL SITE, where app.js can be
   pinned to `agent.alertSince` and nothing else. */
describe("B1 alertRecent", () => {
  const byFlag = (a: { hot: boolean }) => a.hot;
  const sinceOf = (a: { alertSince?: string }) => a.alertSince;

  test("orders the hot bucket by alertSince desc and leaves calm order alone", () => {
    const rows = [
      { id: "old-hot", hot: true, alertSince: "2026-08-16T10:00:00.000Z" },
      { id: "calm-a", hot: false },
      { id: "new-hot", hot: true, alertSince: "2026-08-16T12:00:00.000Z" },
      { id: "calm-b", hot: false },
      { id: "mid-hot", hot: true, alertSince: "2026-08-16T11:00:00.000Z" },
    ];
    alertFirst(rows, byFlag);
    alertRecent(rows, byFlag, sinceOf);
    expect(rows.map((r) => r.id)).toEqual(["new-hot", "mid-hot", "old-hot", "calm-a", "calm-b"]);
  });

  test("missing alertSince sorts last among hot and keeps input order", () => {
    // The field is absent whenever the server has not stamped one — an older
    // snapshot, or a row that started alerting between the store's observe and
    // this publish. Undated asks must not jump the queue and must not scramble
    // amongst themselves; they fall in behind every dated one, in server order.
    const rows = [
      { id: "undated", hot: true },
      { id: "dated", hot: true, alertSince: "2026-08-16T12:00:00.000Z" },
      { id: "undated-2", hot: true },
    ];
    alertFirst(rows, byFlag);
    alertRecent(rows, byFlag, sinceOf);
    expect(rows.map((r) => r.id)).toEqual(["dated", "undated", "undated-2"]);
  });

  test("an unparseable alertSince is treated as absent, not as epoch zero", () => {
    // Date.parse of junk is NaN, and NaN arithmetic in a comparator silently
    // reports "equal" — which would leave a corrupt stamp sitting wherever it
    // happened to be instead of behind the rows that have a real one.
    const rows = [
      { id: "junk", hot: true, alertSince: "not-a-date" },
      { id: "dated", hot: true, alertSince: "2026-08-16T09:00:00.000Z" },
    ];
    alertFirst(rows, byFlag);
    alertRecent(rows, byFlag, sinceOf);
    expect(rows.map((r) => r.id)).toEqual(["dated", "junk"]);
  });

  test("equal alertSince keeps input order — ties are still the server's order", () => {
    const rows = [
      { id: "t1", hot: true, alertSince: "2026-08-16T12:00:00.000Z" },
      { id: "t2", hot: true, alertSince: "2026-08-16T12:00:00.000Z" },
      { id: "t3", hot: true, alertSince: "2026-08-16T12:00:00.000Z" },
    ];
    alertFirst(rows, byFlag);
    alertRecent(rows, byFlag, sinceOf);
    expect(rows.map((r) => r.id)).toEqual(["t1", "t2", "t3"]);
  });

  test("calm rows are never reordered, however recent their own ask once was", () => {
    // The hot PREFIX is the whole jurisdiction. A calm row carrying a stale
    // alertSince (acked, or no longer alerting) must not be ranked against the
    // live queue — it is not in the queue.
    const rows = [
      { id: "hot", hot: true, alertSince: "2026-08-16T08:00:00.000Z" },
      { id: "calm-late", hot: false, alertSince: "2026-08-16T23:00:00.000Z" },
      { id: "calm-early", hot: false, alertSince: "2026-08-16T01:00:00.000Z" },
    ];
    alertFirst(rows, byFlag);
    alertRecent(rows, byFlag, sinceOf);
    expect(rows.map((r) => r.id)).toEqual(["hot", "calm-late", "calm-early"]);
  });

  test("sorts in place and returns the same array", () => {
    const rows = [
      { id: "a", hot: true, alertSince: "2026-08-16T10:00:00.000Z" },
      { id: "b", hot: true, alertSince: "2026-08-16T11:00:00.000Z" },
    ];
    expect(alertRecent(rows, byFlag, sinceOf)).toBe(rows);
    expect(rows[0].id).toBe("b");
  });
});

/* B2 — the sort's key is the published field, not a clock this client could
   invent. Source-level because the wrong key is invisible to a unit test that
   injects its own accessor: alertRecent is correct with ANY sinceOf, and the
   defect this pins is app.js handing it the wrong one. */
describe("B2 the board ranks on alertSince and on nothing else", () => {
  test("the call sites read agent.alertSince", () => {
    expect(source).toContain("alertRecent");
    expect(source).toMatch(/const sinceOf = \(a\) => a\.alertSince;/);
  });

  test("no ranking comparator reaches for a transcript or heartbeat clock", () => {
    // hookLifecycleAt re-stamps the same needsInput; lastHumanFacingAt advances
    // on ordinary replies; updatedAt is heartbeats. None of the three may appear
    // inside the recency helper or the strip's comparator.
    const helper = source.match(/export function alertRecent\([\s\S]*?\n\}/)?.[0] ?? "";
    expect(helper).not.toBe("");
    for (const clock of ["hookLifecycleAt", "lastHumanFacingAt", "updatedAt"]) {
      expect(helper).not.toContain(clock);
    }
  });
});

describe("row flights degrade to instant, never to broken", () => {
  test("capture stands down on a root that cannot be measured", () => {
    // Fake-DOM nodes have no querySelectorAll/getBoundingClientRect; a null
    // capture is the no-motion path and must be the WHOLE answer — render
    // correctness can never depend on the float running.
    expect(M.captureRowFlights({})).toBe(null);
    expect(M.captureRowFlights(null)).toBe(null);
  });

  test("play with no capture is a no-op, not a throw", () => {
    expect(() => M.playRowFlights({}, null)).not.toThrow();
    expect(() => M.playRowFlights(null, null)).not.toThrow();
  });

  test("the lift classes exist as literals in source and as rules in the sheet", () => {
    // The orphan guard needs the literals; the classes need their paint.
    for (const cls of ["is-floating", "is-landing"]) {
      expect(source).toContain(`"${cls}"`);
      expect(styles).toContain(`.agent-row.${cls}`);
    }
    // Reduced motion must neutralize the lift in CSS as well as in JS — and
    // the match pins the DEDICATED neutralizer block (its body opens with the
    // lift selectors), not merely "a reduce block exists somewhere before some
    // .is-floating rule", which the universal guard would satisfy on its own.
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.agent-row\.is-floating,\s*\.agent-row\.is-landing\s*\{[^}]*transition: none/);
  });

  test("the flight outranks the repo band's ground, and landing never blanks selection or hover", () => {
    // Two cascade facts with one shape: transient flight states must win the
    // background slot against identity paint, and must never win it against
    // the operator's own selection or pointer.
    // (1) The tinted band's row wash — higher specificity than .is-floating —
    // stands down for the flight, in both its resting and hover forms.
    expect(styles).toMatch(/has-repo-tint[^{]*\.agent-row[^{]*:not\(\.is-floating\)\s*\{[^}]*var\(--repo-tint\) 4%/);
    expect(styles).toMatch(/has-repo-tint[^{]*\.agent-row[^{]*:not\(\.is-floating\):hover\s*\{[^}]*var\(--repo-tint\) 7%/);
    // (2) The landing fade clears only the lift's ground: its background
    // reset is scoped away from selected and hovered rows, and the base
    // landing rule carries no background at all — blanking the selection
    // tint for the 540ms fade read as a blink on exactly the row the
    // operator was touching.
    expect(styles).toMatch(/\.agent-row\.is-landing:not\(\.is-selected\):not\(:hover\)\s*\{[^}]*background: transparent/);
    const landingBase = styles.match(/\.agent-row\.is-landing \{[^}]*\}/)?.[0] ?? "";
    expect(landingBase).not.toBe("");
    // Property form only — the rule's transition legitimately names
    // background-color as a transitioned property.
    expect(landingBase).not.toContain("background:");
  });

  test("the flight never suppresses the keyboard focus ring", () => {
    // The ring is a guarded invariant: the lift's box-shadow (flight) and the
    // landing's `box-shadow: none` (fade) are both later in the sheet at the
    // ring's own specificity, so each needs a composite that re-asserts it.
    expect(styles).toMatch(/\.agent-row\.is-floating:focus-visible\s*\{[^}]*var\(--color-focus-ring\)/);
    expect(styles).toMatch(/\.agent-row\.is-landing:focus-visible\s*\{[^}]*var\(--color-focus-ring\)/);
  });
});

/* The latest mover flight owns the row's lift (spec §4: one lift, one settle).
   A re-fly cancels the previous animation synchronously, but the canceled
   flight's rejection handler — and a landed flight's 540ms fade timer — run
   LATER, on a row a newer flight now owns. Stale handlers must stand down, or
   flight 2 plays its whole translation with no lift shadow. Driven through the
   public capture/play pair on fabricated row-likes: classList, dataset (fkey +
   the data-hot membership stamp), getBoundingClientRect, and an animate stub
   whose finished promise the test settles by hand.

   Membership is modeled the way the product stamps it — `dataset.hot`, from
   stripAlerting at build time — NOT via alert classes: the sort and the float
   must read the same predicate, and classes cannot carry it (is-alerting is
   inline-mode only; presentedOutcome mutes only needs-you on ack). The fakes'
   rects also model a live animation's transform: getBoundingClientRect adds
   each live animation's `offset`, which vanishes when it is canceled — the
   physics behind the measure-after-cancel requirement. */
describe("the latest mover flight owns the row's lift", () => {
  interface FakeAnim {
    finished: Promise<void>;
    cancel: () => void;
    resolve: () => void;
    frames: Array<{ transform: string }>;
    offset: number;
    canceled: boolean;
  }

  function fakeRow(fkey: string) {
    const classes = new Set<string>();
    const live: FakeAnim[] = [];
    let top = 0;
    return {
      // hot = alert-list membership; alertRank = position INSIDE that list.
      // Both are stamps renderAgentRow writes, and the float reads both: a
      // recency reorder moves a row without touching its membership.
      dataset: { fkey, hot: "false", alertRank: "" },
      classList: {
        contains: (cls: string) => classes.has(cls),
        add: (cls: string) => { classes.add(cls); },
        remove: (cls: string) => { classes.delete(cls); },
      },
      // The rect includes live transforms, exactly as the real one does.
      getBoundingClientRect: () => ({ top: top + live.reduce((sum, a) => sum + a.offset, 0) }),
      getAnimations: () => [...live],
      animate: (frames: Array<{ transform: string }>): FakeAnim => {
        let res!: () => void;
        let rej!: (err: Error) => void;
        const finished = new Promise<void>((resolve, reject) => { res = resolve; rej = reject; });
        const anim: FakeAnim = {
          finished,
          frames,
          offset: 0,
          canceled: false,
          cancel: () => { anim.canceled = true; rej(new Error("canceled")); live.splice(live.indexOf(anim), 1); },
          resolve: () => { res(); live.splice(live.indexOf(anim), 1); },
        };
        live.push(anim);
        return anim;
      },
      setTop: (next: number) => { top = next; },
      live,
    };
  }

  const rootOf = (rows: unknown[]) => ({ querySelectorAll: () => rows });
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const pastLandingFade = () => new Promise<void>((resolve) => setTimeout(resolve, 620));

  test("a superseded flight's canceled handler stands down — flight 2 keeps the lift", async () => {
    const row = fakeRow("agent:own-1");
    const root = rootOf([row]);
    row.setTop(100);
    const calm = M.captureRowFlights(root);
    // Paint 1: membership flips hot, row re-homes upward → mover flight 1.
    // No alert class rides along — pane mode's hook-shaped strip entries carry
    // only the stamp, and they must fly exactly like everything else.
    row.dataset.hot = "true";
    row.setTop(0);
    M.playRowFlights(root, calm);
    expect(row.classList.contains("is-floating")).toBe(true);
    expect(row.live.length).toBe(1);
    // Paint 2 lands mid-flight: membership flips back, row sinks home. The
    // play cancels flight 1 (rejecting its finished) and starts flight 2.
    const hot = M.captureRowFlights(root);
    row.dataset.hot = "false";
    row.setTop(100);
    M.playRowFlights(root, hot);
    expect(row.classList.contains("is-floating")).toBe(true);
    const flight2 = row.live[0];
    // Flight 1's rejection handler runs now — it no longer owns the row, so
    // the lift MUST survive it for the whole of flight 2.
    await flush();
    expect(row.classList.contains("is-floating")).toBe(true);
    // Flight 2 lands: the normal sequence, owned by flight 2.
    flight2.resolve();
    await flush();
    expect(row.classList.contains("is-floating")).toBe(false);
    expect(row.classList.contains("is-landing")).toBe(true);
    await pastLandingFade();
    expect(row.classList.contains("is-landing")).toBe(false);
  });

  test("a re-lifting row is not landing — the stale fade timer stands down", async () => {
    const row = fakeRow("agent:own-2");
    const root = rootOf([row]);
    row.setTop(100);
    const calm = M.captureRowFlights(root);
    // Flight 1 flies and LANDS: is-landing on, its 540ms fade timer pending.
    row.dataset.hot = "true";
    row.setTop(0);
    M.playRowFlights(root, calm);
    row.live[0].resolve();
    await flush();
    expect(row.classList.contains("is-landing")).toBe(true);
    // Flight 2 starts inside the fade window: the row lifts again, so the
    // landing state must clear NOW, not when a stale timer gets around to it.
    const hot = M.captureRowFlights(root);
    row.dataset.hot = "false";
    row.setTop(100);
    M.playRowFlights(root, hot);
    expect(row.classList.contains("is-floating")).toBe(true);
    expect(row.classList.contains("is-landing")).toBe(false);
    // Past the stale timer's would-be firing, mid-flight 2: still lifted.
    await pastLandingFade();
    expect(row.classList.contains("is-floating")).toBe(true);
    expect(row.classList.contains("is-landing")).toBe(false);
    // And flight 2's own landing still runs its full course.
    row.live[0].resolve();
    await flush();
    expect(row.classList.contains("is-landing")).toBe(true);
    await pastLandingFade();
    expect(row.classList.contains("is-landing")).toBe(false);
  });

  test("a mid-flight re-fly starts where the eye sees the row, not at the old destination", async () => {
    const row = fakeRow("agent:pos-1");
    const root = rootOf([row]);
    row.setTop(100);
    const calm = M.captureRowFlights(root);
    row.dataset.hot = "true";
    row.setTop(0);
    M.playRowFlights(root, calm);
    const flight1 = row.live[0];
    expect(flight1.frames[0].transform).toBe("translateY(100px)");
    // Mid-flight: the superseded transform still offsets the row's rect (+60).
    flight1.offset = 60;
    const hot = M.captureRowFlights(root); // capture sees the VISUAL top: 60
    row.dataset.hot = "false";
    row.setTop(100);
    M.playRowFlights(root, hot);
    // The stale transform must be canceled BEFORE the after-rect is measured:
    // the eye sees the row at 60 and its new home is 100, so flight 2 spans
    // -40. Measured through the stale transform the after-rect reads 160, the
    // delta comes out -100, and the row teleports to flight 1's destination
    // before flying the wrong span.
    const flight2 = row.live[0];
    expect(flight1.canceled).toBe(true);
    expect(flight2.frames[0].transform).toBe("translateY(-40px)");
    flight2.resolve();
    await flush();
  });

  test("a membership flip whose delta is 0 still cancels the stale flight", async () => {
    const row = fakeRow("agent:zero-1");
    const root = rootOf([row]);
    row.setTop(100);
    const calm = M.captureRowFlights(root);
    row.dataset.hot = "true";
    row.setTop(0);
    M.playRowFlights(root, calm);
    const flight1 = row.live[0];
    flight1.offset = 30; // mid-flight, visually at 30
    const hot = M.captureRowFlights(root);
    row.dataset.hot = "false";
    row.setTop(30); // the new home is exactly where the eye already sees it
    M.playRowFlights(root, hot);
    // No new flight is needed (delta 0), but the stale one must not keep
    // playing under a verdict that no longer holds…
    expect(flight1.canceled).toBe(true);
    expect(row.live.length).toBe(0);
    // …and its canceled handler still owns the row, so the lift comes off.
    await flush();
    expect(row.classList.contains("is-floating")).toBe(false);
    expect(row.classList.contains("is-landing")).toBe(false);
  });

  test("B3 a recency reorder of already-hot rows flies — rank change is a mover", async () => {
    /* The teleport this closes: two rows that were ALREADY hot swap places
       because a newer ask arrived. Membership did not flip for either of them,
       so the pre-recency mover test (`prior.alerted !== marked`) reports no
       mover at all, playRowFlights returns at its gate, and the reconcile drops
       both rows into their new homes between frames. The eye is given no thread
       to follow on the one surface whose whole job is "look here". */
    const top = fakeRow("agent:rank-top");
    const below = fakeRow("agent:rank-below");
    const root = rootOf([top, below]);
    top.dataset.hot = "true"; top.dataset.alertRank = "0"; top.setTop(0);
    below.dataset.hot = "true"; below.dataset.alertRank = "1"; below.setTop(40);
    const before = M.captureRowFlights(root);
    // The newer ask lands on the lower row: ranks swap, membership does not.
    top.dataset.alertRank = "1"; top.setTop(40);
    below.dataset.alertRank = "0"; below.setTop(0);
    M.playRowFlights(root, before);
    expect(top.classList.contains("is-floating")).toBe(true);
    expect(below.classList.contains("is-floating")).toBe(true);
    expect(top.live[0].frames[0].transform).toBe("translateY(-40px)");
    expect(below.live[0].frames[0].transform).toBe("translateY(40px)");
    top.live[0].resolve();
    below.live[0].resolve();
    await flush();
  });

  test("B3 a calm row's rank stamp cannot fly it — the gate is still membership or hot-rank", () => {
    /* Rank is meaningless off the list, and the stamp is empty there. A calm
       row that merely re-homed (a hot row above it left the section) must stay
       motionless: making "the row moved" the gate would fly the whole board on
       every paint, which is the noise the mover gate exists to prevent. */
    const calm = fakeRow("agent:calm-rank");
    const root = rootOf([calm]);
    calm.setTop(100);
    const before = M.captureRowFlights(root);
    calm.setTop(0);
    M.playRowFlights(root, before);
    expect(calm.live.length).toBe(0);
    expect(calm.classList.contains("is-floating")).toBe(false);
  });

  test("B3 a hot row whose rank is unchanged does not fly on a routine repaint", () => {
    // Tokens tick and summaries update every few seconds. A hot row holding
    // rank 0 through all of that must not shimmer up and down for it.
    const hot = fakeRow("agent:steady");
    const root = rootOf([hot]);
    hot.dataset.hot = "true"; hot.dataset.alertRank = "0"; hot.setTop(20);
    const before = M.captureRowFlights(root);
    hot.setTop(0); // the band above it grew a row; nothing about the ask moved
    M.playRowFlights(root, before);
    expect(hot.live.length).toBe(0);
    expect(hot.classList.contains("is-floating")).toBe(false);
  });

  test("presented-outcome ink without a membership flip never flies", () => {
    // A declaredQuiet row gaining a failed outcome repaints its ink, but its
    // alert-list membership (the data-hot stamp) is unchanged — the paint must
    // stay motionless even if the row's geometry moved.
    const row = fakeRow("agent:quiet-1");
    const root = rootOf([row]);
    row.setTop(100);
    const calm = M.captureRowFlights(root);
    row.classList.add("is-failed"); // ink only, not membership
    row.setTop(0);
    M.playRowFlights(root, calm);
    expect(row.live.length).toBe(0); // the gate never opened
    expect(row.classList.contains("is-floating")).toBe(false);
  });
});
