/* The operator's own journal — what was sent to this fleet, to whom, and whether
   it landed.

   Distinct from everything else in the client, which reports what the AGENTS are
   doing. This is the only surface that reports what the OPERATOR did, including
   the failures and the staged-but-never-submitted ones. At 200 lanes the question
   "did I already tell this one to rebase?" is not answerable from any other
   panel, which is why the record survives a reload rather than living in memory.

   Owns its fetch, its shape-checking, its failure sentence and its rendering.
   Paints through repaint() rather than render(), so it carries no knowledge of
   the board it sits on. */

import { $, el } from "./dom-primitives.js";
import { state } from "./client-state.js";
import { repaint } from "./repaint.js";
import { actionsFailureText, actionsUrl, apiFetch, API_READ_TIMEOUT_MS, ACTIONS_DEFAULT_LIMIT } from "./api-client.js";
import { agoText } from "./text-formatters.js";
import { agentName, agentsById, actionOutcomeView } from "./presentation.js";

export const ACTION_KINDS = new Set(["focus", "instruct", "interrupt", "broadcast", "archive"]);

export const ACTION_KIND_LABELS = {
  focus: "Focus", instruct: "Send", interrupt: "Interrupt",
  broadcast: "Broadcast", archive: "Archive",
};

export const ACTIONS_RENDER_CAP = 100;

export function actionRecipients(action, nameFor) {
  const ids = action.agentIds || [];
  if (!ids.length) return "no recipients";
  if (ids.length > 3) return ids.length + " sessions";
  return ids.map((id) => (nameFor && nameFor(id)) || id).join(", ");
}

export function normalizeActions(body) {
  const rows = Array.isArray(body && body.actions) ? body.actions : [];
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (typeof row.id !== "string" || !row.id) continue;
    if (!ACTION_KINDS.has(row.kind)) continue;
    out.push({
      id: row.id,
      at: typeof row.at === "string" && !Number.isNaN(Date.parse(row.at)) ? row.at : null,
      kind: row.kind,
      agentIds: Array.isArray(row.agentIds) ? row.agentIds.filter((id) => typeof id === "string" && id) : [],
      outcome: typeof row.outcome === "string" && row.outcome ? row.outcome : "unknown",
      detail: typeof row.detail === "string" ? row.detail : "",
    });
  }
  return out;
}

export async function loadActions(limit = ACTIONS_DEFAULT_LIMIT) {
  state.actions = { ...state.actions, loading: true, error: "" };
  repaint();
  let next;
  try {
    const res = await apiFetch(actionsUrl(limit), { headers: { accept: "application/json" } }, API_READ_TIMEOUT_MS);
    let body = null;
    try { body = await res.json(); } catch { /* a build without the route answers HTML */ }
    next = !res.ok || !body || body.ok !== true
      ? { loading: false, error: actionsFailureText(res.status, body), available: !(res.status === 404 && !(body && body.error)), items: [], fetchedAt: 0 }
      : { loading: false, error: "", available: true, items: normalizeActions(body), fetchedAt: Date.now() };
  } catch {
    next = { loading: false, error: actionsFailureText(0, null), available: true, items: [], fetchedAt: 0 };
  }
  state.actions = next;
  repaint();
}

export function refreshActions() {
  if (state.actions.available && state.actions.fetchedAt) void loadActions();
}

export function actionRowNode(action, nameFor) {
  const outcome = actionOutcomeView(action.outcome);
  return el("div", { class: "action-row", dataset: { tone: outcome.tone } },
    el("span", { class: "action-when", title: action.at || null, text: action.at ? agoText(action.at) : "time unknown" }),
    el("span", { class: "action-kind", text: ACTION_KIND_LABELS[action.kind] || action.kind }),
    el("span", { class: "action-who", text: actionRecipients(action, nameFor) }),
    el("span", { class: "action-outcome", text: outcome.label }),
    action.detail ? el("span", { class: "action-detail", text: action.detail }) : null);
}

export function renderActionLog(ui = state, nameFor = null) {
  const log = ui.actions || {};
  const panel = el("div", { class: "action-log" },
    el("div", { class: "action-log-head" },
      el("h2", { class: "action-log-title", text: "Recent operator actions" }),
      el("button", {
        type: "button", class: "btn sm",
        disabled: log.loading ? "" : null,
        dataset: { fkey: "actions-refresh" },
        onclick: () => void loadActions(),
      }, log.loading ? "Loading…" : "Refresh")));

  if (log.error) {
    panel.append(el("p", { class: "action-log-note err", role: "status", text: log.error }));
    return panel;
  }
  if (log.loading && !log.items.length) {
    panel.append(el("p", { class: "action-log-note", role: "status", text: "Reading the action log…" }));
    return panel;
  }
  if (!log.items.length) {
    panel.append(el("p", {
      class: "action-log-note",
      text: "No operator actions recorded yet. Focus, Send, Interrupt, Archive and Broadcast are journalled here as they happen — including the ones that fail.",
    }));
    return panel;
  }

  const rows = log.items.slice(0, ACTIONS_RENDER_CAP);
  const list = el("div", { class: "action-rows" });
  for (const action of rows) list.append(actionRowNode(action, nameFor));
  panel.append(list);
  if (log.items.length > rows.length) {
    panel.append(el("p", { class: "action-log-note", text: "Showing the most recent " + rows.length + " of " + log.items.length + " recorded actions." }));
  }
  return panel;
}

export function renderActionsPanel() {
  const panel = $("actions-panel");
  const toggle = $("actions-toggle");
  if (!panel) return;
  const open = state.actionsOpen && state.view !== "usage";
  if (toggle) {
    toggle.setAttribute("aria-pressed", open ? "true" : "false");
    toggle.classList.toggle("is-open", open);
  }
  const log = state.actions;
  // Same rule as the alarm: visibility every paint, rebuild only on change.
  panel.hidden = !open;
  const sig = [open ? "1" : "0", log.loading ? "1" : "0", log.error, String(log.fetchedAt),
    log.items.map((a) => a.id + ":" + a.outcome).join(",")].join("|");
  if (state.paintSig.actions === sig) return;
  state.paintSig.actions = sig;
  panel.textContent = "";
  if (!open) return;
  const byId = agentsById(state.snap);
  panel.append(renderActionLog(state, (id) => {
    const found = byId.get(id);
    return found ? agentName(found.agent) : null;
  }));
}
