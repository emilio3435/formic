/* Out-of-page alerts — the only part of the console that can interrupt someone
   who is not looking at it.

   That is why it is its own module. Everything else in the client competes for
   attention on a screen the operator chose to open; this competes with whatever
   they are doing instead. The rules that keep that honest are all here and
   nowhere else: permission is requested from a click and never on load, a
   notification fires only for agents that newly need a human (never for the
   standing set, or a reload would re-alert the whole board), and the tab title
   carries the count so a muted browser still tells the truth.

   Reads `state.notify` and `state.snap`; builds DOM only for its own toggle
   button. It calls nothing else in the client, which is what let it come out
   whole. */

import { $, el } from "./dom-primitives.js";
import { state } from "./client-state.js";
import { agentName, agentsById } from "./presentation.js";
import { blockingAgentIds } from "./notification-center.js";

export const NOTIFY_STORAGE_KEY = "mtn3-notify";

export const NOTIFY_TAG = "anthill-needs-you";  // replaces its predecessor; never stacks

/* Who actually needs a human — the same verdict the Alerts view and the beacon
   read, so the notification can never disagree with the board it came from. */

export const NOTIFY_NAME_LIMIT = 3;

export function notificationsSupported() {
  return typeof Notification !== "undefined";
}

export function loadNotifyPreference() {
  try {
    state.notify.enabled = localStorage.getItem(NOTIFY_STORAGE_KEY) === "on";
  } catch { state.notify.enabled = false; }
  if (notificationsSupported()) state.notify.permission = Notification.permission;
  // Permission revoked in browser settings between sessions: the stored
  // preference is stale, so do not carry a promise we cannot keep.
  if (state.notify.enabled && state.notify.permission !== "granted") state.notify.enabled = false;
}

export function saveNotifyPreference() {
  try { localStorage.setItem(NOTIFY_STORAGE_KEY, state.notify.enabled ? "on" : "off"); }
  catch { /* storage unavailable */ }
}

/* The ONLY place permission is requested, and it is reachable only from a click.
   Never on load: an unprompted permission dialog is how a page gets denied
   permanently, which would silently disable the feature forever. */

/* S1-T5. This read `alerting()` — the board's broad "not healthy and not
   finished" verdict — which is a strict superset of "a person is the blocker".
   The consequence was narrow and bad: the OS notification fired for a stalled
   advisory while the button correctly stayed amber, so the one contract this
   surface rests on ("ember only when a person is the blocker") broke at the
   exact moment the operator is not looking at the screen to check it.

   Repointed at the blocking half of the attention partition. This changes WHO
   delivery fires for and nothing else — permission is still requested from a
   click and never on load, NOTIFY_TAG still replaces rather than stacks, the
   title still counts, and notificationPlan still only speaks about agents that
   are NEW to the set. Targeting, not mechanics. */
export function needsHumanIds(snap) {
  return blockingAgentIds(snap);
}

/* Pure. `prev === null` means "we have not looked yet": seed the baseline and
   stay silent, which is what stops a reload from announcing the whole backlog. */

export function notificationPlan(prev, next, nameFor = null) {
  const ids = next.slice().sort();
  if (prev === null || prev === undefined) return { fire: false, ids, reason: "seeded" };
  const before = new Set(prev);
  const fresh = ids.filter((id) => !before.has(id));
  if (!fresh.length) return { fire: false, ids, reason: "no new agent needs you" };
  const names = fresh.slice(0, NOTIFY_NAME_LIMIT).map((id) => (nameFor && nameFor(id)) || id);
  const rest = fresh.length - names.length;
  return {
    fire: true,
    ids,
    reason: "new",
    title: fresh.length === 1 ? "1 agent needs you" : fresh.length + " agents need you",
    body: names.join(", ") + (rest > 0 ? " and " + rest + " more" : ""),
  };
}

/* The zero-permission escalation: a background tab shows its own alert count. */

export function titleWithAlerts(base, count) {
  const clean = String(base).replace(/^\(\d+\)\s*/, "");
  return count > 0 ? "(" + count + ") " + clean : clean;
}

/* "Notifications", never "Alerts". This control governs browser notification
   delivery; the tab now called "Needs you" counts agents waiting on a human.
   They were both labelled "Alerts" on adjacent surfaces with no shared meaning,
   so "Alerts off" sat inches from "Alerts 0" and an operator could reasonably
   read the first as an explanation of the second. */
export function notifyToggleView(notify, supported = notificationsSupported(), count = 0, tone = "clear") {
  const n = Number.isFinite(count) && count > 0 ? count : 0;
  const suffix = n ? ` · ${n} waiting on you` : "";
  /* `tone` is the verdict, not a restatement of the count.
     `blocked` means a PERSON is the blocker; `noticed` means the watcher has
     something and nobody is waiting on you; `clear` means neither. It rides here
     rather than being re-derived at the button because the badge's ink and the
     panel's ember rail have to be the same judgement — a red button over a panel
     with nothing red in it is the exact disagreement this surface replaced. */
  const badgeTone = tone === "blocked" || tone === "noticed" ? tone : "clear";
  const view = !supported
    ? { label: "Notifications unsupported", pressed: false, disabled: true, title: "This browser has no Notification API." }
    : notify.permission === "denied"
      ? { label: "Notifications blocked", pressed: false, disabled: true, title: "Notifications are blocked for this site in your browser settings." }
      : notify.enabled
        ? { label: "Notifications on", pressed: true, disabled: false, title: "Stop notifying me when an agent starts waiting." }
        : { label: "Notifications off", pressed: false, disabled: false, title: "Notify me when an agent starts waiting, even in another window." };
  return {
    ...view,
    count: n,
    tone: badgeTone,
    title: view.title + suffix,
    // The button's accessible name carries the backlog too — a screen reader
    // must not have to infer it from a bare digit beside the label.
    ariaLabel: view.label + (n ? `, ${n} agent${n === 1 ? "" : "s"} waiting on you` : ""),
    /* The DISCLOSURE's name, which is a different control from the delivery
       switch above it.
       The words above govern whether the browser may interrupt you; these
       describe what is waiting inside the panel. They were one control until
       the notification center existed, which is why "Notifications off" once
       sat inches from four stopped agents and read as an explanation of them.
       The badge's digit never stands alone here: "1" beside a red dot is not a
       reading a screen reader can pass on. */
    disclosureLabel: "Notifications, " + (
      badgeTone === "blocked"
        ? `${n} agent${n === 1 ? "" : "s"} waiting on you`
        : badgeTone === "noticed"
          ? `${n} being watched, nobody waiting on you`
          : "nothing waiting"
    ),
  };
}

export function deliverNotification(plan, notify, ctor) {
  if (!plan.fire) return plan.reason;
  if (!notify.enabled) return "muted";
  if (!ctor) return "unsupported";
  if (notify.permission !== "granted") return "not-granted";
  try {
    // eslint-disable-next-line no-new
    new ctor(plan.title, { body: plan.body, tag: NOTIFY_TAG });
    return "sent";
  } catch { return "refused"; }
}

/* Called on every adopted snapshot. The title always updates — it costs no
   permission and cannot annoy anyone. The Notification only fires when the plan
   says a NEW agent needs a human AND the operator opted in; denied, unsupported
   or muted all degrade to the title alone, silently. */

export function applyNotifications(snap = state.snap) {
  const next = needsHumanIds(snap);
  const byId = agentsById(snap);
  const plan = notificationPlan(state.notify.seen, next, (id) => {
    const found = byId.get(id);
    return found ? agentName(found.agent) : null;
  });
  state.notify.seen = plan.ids;
  if (typeof document !== "undefined") {
    document.title = titleWithAlerts(state.notify.baseTitle || document.title, next.length);
  }
  return deliverNotification(plan, state.notify, notificationsSupported() ? Notification : null);
}

export async function toggleNotifications() {
  if (state.notify.enabled) {
    state.notify.enabled = false;
    saveNotifyPreference();
    renderNotifyToggle();
    return;
  }
  if (!notificationsSupported()) { renderNotifyToggle(); return; }
  let permission = Notification.permission;
  if (permission === "default") {
    try { permission = await Notification.requestPermission(); }
    catch { permission = "denied"; }
  }
  state.notify.permission = permission;
  state.notify.enabled = permission === "granted";
  saveNotifyPreference();
  renderNotifyToggle();
}

/* Denied is not an error state to shout about — the operator said no. The
   control just reads "unavailable" and nothing else changes. */
/* `count` is how many agents are waiting on a human right now, and it rides on
   EVERY branch — muted, blocked and unsupported included. "Notifications off" sitting
   silently beside four waiting agents was the whole defect: the button reported
   the delivery channel and never the backlog. Turning notifications off is a
   choice about interruption, not a reason to stop showing the number. */

/* `tone`/`count` are passed in rather than re-derived: the panel computes the
   feed once per paint and the badge is a reading off that same list. Deriving
   them twice is how a button comes to disagree with the panel it opens. The
   defaults keep the zero-argument call in render() honest before the first
   snapshot lands. */
const BADGE_TONE_CLASS = { blocked: "is-blocked", noticed: "is-noticed", clear: "is-clear" };

export function renderNotifyToggle(count = 0, tone = "clear", open = false) {
  const btn = $("notify-toggle");
  if (!btn) return;
  const view = notifyToggleView(state.notify, notificationsSupported(), count, tone);
  /* The label is "Notifications" in every state. It names what the control
     governs, and it is the same word in the panel's footer switch and in
     Settings; the delivery state it used to carry now lives on the switch that
     actually changes it. */
  btn.textContent = "Notifications";
  /* The badge ALWAYS renders, zero included — a zero is a reading, an absent
     badge is an absence, and an operator cannot tell "nothing is waiting" from
     "this stopped working" by looking at a gap. The count is its own node so it
     can take the ember treatment without entering the button's text content. */
  btn.append(el("span", {
    class: "notify-badge " + BADGE_TONE_CLASS[view.tone],
    "aria-hidden": "true",
    text: String(view.count),
  }));
  /* A disclosure, not a switch. It never carries aria-pressed: the thing that
     is on or off is delivery, and delivery's control is inside the panel. */
  btn.removeAttribute("aria-pressed");
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  btn.setAttribute("aria-controls", "notifications-panel");
  btn.setAttribute("title", "What needs a person right now.");
  btn.setAttribute("aria-label", view.disclosureLabel);
  /* Never disabled. Denied or unsupported delivery is a fact about the browser's
     interruption channel; the list of who is waiting has nothing to do with it,
     and locking the operator out of it because they declined a permission would
     be the worst possible reading of "no". */
  btn.removeAttribute("disabled");
  btn.classList.toggle("is-open", open);
  btn.classList.toggle("is-alerting", view.tone === "blocked");
}

/* Delivery, kept separate from the decision so every gate is assertable without
   a browser. Each refusal returns its own reason rather than a shared silence,
   because "we chose not to" and "the browser refused" are different facts. */
