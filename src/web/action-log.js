/* The operator's own journal — what was sent to this fleet, to whom, and whether
   it landed.

   Distinct from everything else in the client, which reports what the AGENTS are
   doing. This is the only record of what the OPERATOR did, including the
   failures and the staged-but-never-submitted ones. At 200 lanes the question
   "did I already tell this one to rebase?" is not answerable from any other
   surface, which is why the record survives a reload rather than living in
   memory.

   The panel that listed it was removed (operator directive, 2026-08-05). What is
   left is the fetch, its shape-checking and its failure sentence, feeding the ONE
   surviving reader: the agent drawer's command dock, which prints this agent's
   last journalled action beside the button that would send it again. Owns no
   DOM — it lands its result in state and calls repaint(), so it still carries no
   knowledge of the board it sits on. */

import { state } from "./client-state.js";
import { repaint } from "./repaint.js";
import { actionsFailureText, actionsUrl, apiFetch, API_READ_TIMEOUT_MS, ACTIONS_DEFAULT_LIMIT } from "./api-client.js";

export const ACTION_KINDS = new Set(["focus", "instruct", "interrupt", "broadcast", "archive", "unarchive"]);

export const ACTION_KIND_LABELS = {
  focus: "Focus", instruct: "Send", interrupt: "Interrupt",
  broadcast: "Broadcast", archive: "Archive", unarchive: "Un-archive",
};

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
