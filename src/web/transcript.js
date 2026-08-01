/* Inline transcript — the raw turn-by-turn record behind Evidence.

   It owns the whole feature: the request and its deadline, the shape-checking of
   what comes back, the window into a long transcript, the rendering, and the
   controls that load more or retry. Nothing else in the client reads a
   transcript, so nothing else should have to know how one is fetched or capped.

   The one thing it does NOT own is painting. loadTranscript writes its result to
   state and calls repaint(); what a repaint involves is app.js's business. That
   inversion is what let this come out — with a direct render() call it dragged
   in ~3,800 lines of dependency closure instead of 133. */

import { el, icon } from "./dom-primitives.js";
import { state } from "./client-state.js";
import { repaint } from "./repaint.js";
import {
  apiFetch, API_TRANSCRIPT_TIMEOUT_MS, clampTranscriptLimit, nextTranscriptLimit,
  transcriptFailureText, transcriptUrl, TRANSCRIPT_DEFAULT_LIMIT, TRANSCRIPT_LIMIT_STEPS,
} from "./api-client.js";
import { agoText } from "./text-formatters.js";

export const TRANSCRIPT_ROLES = new Set(["user", "assistant", "tool", "system", "unknown"]);

export const TRANSCRIPT_ROLE_LABELS = {
  user: "You", assistant: "Agent", tool: "Tool", system: "System", unknown: "—",
};

export const TRANSCRIPT_RENDER_CAP = 300;

export function transcriptWindow(lines, cap = TRANSCRIPT_RENDER_CAP) {
  const total = lines.length;
  if (total <= cap) return { shown: lines, hidden: 0, total };
  return { shown: lines.slice(total - cap), hidden: total - cap, total };
}

export function normalizeTranscript(body) {
  const rows = Array.isArray(body && body.lines) ? body.lines : [];
  const lines = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || typeof row.text !== "string") continue;
    lines.push({
      at: typeof row.at === "string" && !Number.isNaN(Date.parse(row.at)) ? row.at : null,
      role: TRANSCRIPT_ROLES.has(row.role) ? row.role : "unknown",
      text: row.text,
    });
  }
  return {
    source: typeof body.source === "string" && body.source ? body.source : null,
    truncated: body.truncated === true,
    lines,
  };
}

export function transcriptLineNode(line) {
  return el("div", { class: "tr-line", dataset: { role: line.role } },
    el("div", { class: "tr-meta" },
      el("span", { class: "tr-role", text: TRANSCRIPT_ROLE_LABELS[line.role] || line.role }),
      line.at ? el("span", { class: "tr-at", title: line.at, text: agoText(line.at) }) : null),
    // UNTRUSTED. textContent via el({ text }) — never innerHTML.
    el("p", { class: "tr-text", tabindex: "0", text: line.text }));
}

export function renderTranscriptPanel(agent, ui = state) {
  const view = (ui && ui.transcript) || {};
  const mine = view.agentId === agent.id;
  const section = el("section", { class: "transcript-view" },
    el("h3", { class: "section-title", text: "Transcript" }));

  if (!mine) {
    section.append(el("button", {
      type: "button", class: "btn sm transcript-load",
      dataset: { fkey: "transcript-load:" + agent.id },
      onclick: () => void loadTranscript(agent.id),
    }, "Read the transcript"));
    return section;
  }

  if (view.loading) {
    // Bounded by construction: loadTranscript always resolves into data or an
    // error, so this can never become a spinner that never resolves.
    section.append(el("p", { class: "inspector-note", role: "status", text: "Reading the transcript…" }));
    return section;
  }

  if (view.error) {
    section.append(
      el("p", { class: "inspector-note err", role: "status", text: view.error }),
      el("button", {
        type: "button", class: "btn sm transcript-load",
        dataset: { fkey: "transcript-retry:" + agent.id },
        onclick: () => void loadTranscript(agent.id, view.limit),
      }, "Try again"));
    return section;
  }

  const data = view.data || { lines: [], source: null, truncated: false };
  const head = el("div", { class: "transcript-head" });
  if (!data.lines.length) {
    head.append(el("span", {
      class: "transcript-source",
      text: data.source
        ? "The transcript file is present but has no readable turns."
        : "No transcript file is recorded for this session.",
    }));
  } else {
    const win = transcriptWindow(data.lines);
    head.append(el("span", {
      class: "transcript-source",
      text: win.hidden
        ? "Last " + win.shown.length + " of " + win.total + " loaded turns"
        : win.total + (win.total === 1 ? " turn" : " turns"),
    }));
    if (data.truncated) head.append(el("span", { class: "transcript-more", text: "· older turns exist above this window" }));
  }
  if (data.source) head.append(el("code", { class: "transcript-source-path", text: data.source }));
  head.append(el("button", {
    type: "button", class: "btn sm transcript-load",
    dataset: { fkey: "transcript-refresh:" + agent.id },
    onclick: () => void loadTranscript(agent.id, view.limit),
  }, "Refresh"));
  const more = nextTranscriptLimit(view.limit);
  if (more && data.truncated) {
    head.append(el("button", {
      type: "button", class: "btn sm transcript-load",
      dataset: { fkey: "transcript-more:" + agent.id },
      onclick: () => void loadTranscript(agent.id, more),
    }, "Load " + more));
  }
  section.append(head);

  if (data.lines.length) {
    const log = el("div", { class: "transcript-log", tabindex: "0", "aria-label": "Transcript turns" });
    for (const line of transcriptWindow(data.lines).shown) log.append(transcriptLineNode(line));
    section.append(log);
  }
  return section;
}

export async function loadTranscript(agentId, limit = TRANSCRIPT_DEFAULT_LIMIT) {
  const want = clampTranscriptLimit(limit);
  state.transcript = { agentId, loading: true, error: "", data: null, limit: want };
  repaint();
  let next;
  try {
    const res = await apiFetch(transcriptUrl(agentId, want), { headers: { accept: "application/json" } }, API_TRANSCRIPT_TIMEOUT_MS);
    let body = null;
    try { body = await res.json(); } catch { /* a build without the route answers HTML */ }
    next = !res.ok || !body || body.ok !== true
      ? { agentId, loading: false, error: transcriptFailureText(res.status, body), data: null, limit: want }
      : { agentId, loading: false, error: "", data: normalizeTranscript(body), limit: want };
  } catch {
    next = { agentId, loading: false, error: transcriptFailureText(0, null), data: null, limit: want };
  }
  // The operator moved on — never paint one agent's transcript into another's drawer.
  if (state.transcript.agentId !== agentId) return;
  state.transcript = next;
  repaint();
}
