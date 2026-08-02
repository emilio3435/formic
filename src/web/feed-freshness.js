/* Feed freshness — is what the board is showing still true?

   One idea, deliberately alone. Freshness is a property of the DATA, never of
   the transport: the server heartbeats every 25s from a timer that knows nothing
   about the collector, so a live socket proves only that the socket is open. Age
   is measured against snapshot.generatedAt, which is the only clock that can
   contradict a healthy-looking connection.

   Everything downstream of that judgement lives here too — whether the elapsed
   clocks should freeze rather than keep counting against a stale base, and the
   alarm the board shows when the feed has stopped. Those are not separate
   features; they are what "the data is old" MEANS to each surface.

   Not here: toast() and paintUnchanged(). They are also small and also shared,
   which is the whole temptation — but a transient message and a paint memo guard
   have nothing to do with freshness or with each other, and bundling three ideas
   because each is too small to move alone is how a "utils" module is born. */

import { state } from "./client-state.js";
import { fmtElapsed } from "./text-formatters.js";

/* Freshness is a property of the DATA, never of the transport. The server
   heartbeats every 25s from a timer that knows nothing about the collector, so a
   heartbeat proves only that the socket is open — it must never be able to make
   a 91-hour-old snapshot read as "Live". Age is measured against
   snapshot.generatedAt, which the server already sends. The collector refreshes
   every 4s, so anything past SNAPSHOT_FRESH_MS is already behind; past
   SNAPSHOT_STALE_MS the board is not showing "now" in any useful sense. */
export const SNAPSHOT_FRESH_MS = 15_000;

export const SNAPSHOT_STALE_MS = 60_000;

export function snapshotFreshness(generatedAt, now = Date.now()) {
  const at = generatedAt ? Date.parse(generatedAt) : NaN;
  if (!Number.isFinite(at)) return { state: "unknown", ageMs: null };
  const ageMs = Math.max(0, now - at);
  if (ageMs <= SNAPSHOT_FRESH_MS) return { state: "fresh", ageMs };
  return { state: ageMs > SNAPSHOT_STALE_MS ? "stale" : "lagging", ageMs };
}

/* The badge tells the truth once you look at it — the ALARM is what makes you
   look. :4701 served a 91-hour-frozen snapshot behind a green "Live" badge and
   the operator acted on a world that had ended four days earlier. A badge in the
   corner is not a warning; a full-width bar in the reading path is.

   One predicate decides the whole staleness story, so the alarm, the clocks and
   the controls can never disagree with each other. Pure, so the rule is testable
   without a browser. Returns null when the board is trustworthy. */

export function feedFrozen(ui = state, now = Date.now()) {
  return clocksFrozen(ui && ui.conn, ui && ui.snap && ui.snap.generatedAt, now);
}

/* tickClocks extrapolated elapsed from data-elapsed-base plus wall-clock drift
   every 5s, so on a frozen board a dead agent's uptime kept climbing — the most
   convincing lie on the page, because it was the one thing visibly moving. When
   the feed is frozen the clock holds at the value the snapshot actually
   reported. Returns null when the dataset cannot be read at all. */

export function clocksFrozen(conn, generatedAt, now = Date.now()) {
  return feedAlarm(conn, generatedAt, now) !== null;
}

export function feedAlarm(conn, generatedAt, now = Date.now()) {
  if (conn === "offline") {
    return {
      kind: "offline",
      headline: "Server unreachable — this board is not updating",
      detail: "Nothing below is current. Focus, Send, Interrupt, Archive and Broadcast are held until the server answers.",
      ageMs: null,
    };
  }
  const fresh = snapshotFreshness(generatedAt, now);
  if (fresh.state !== "stale") return null;
  const age = fmtElapsed(fresh.ageMs);
  return {
    kind: "frozen",
    headline: "Feed frozen — last snapshot " + age + " ago",
    detail: "Every agent, count and clock below is " + age + " old. Controls are held: routing on stale evidence can type into the wrong terminal.",
    ageMs: fresh.ageMs,
  };
}

/* Stale data has to LOOK stale everywhere it is displayed, not just in the bar.
   Same predicate as the alarm by construction. */
