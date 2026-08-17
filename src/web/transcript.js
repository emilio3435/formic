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
  apiFetch,
  API_TRANSCRIPT_TIMEOUT_MS,
  clampTranscriptLimit,
  nextTranscriptLimit,
  transcriptFailureText,
  transcriptUrl,
  TRANSCRIPT_DEFAULT_LIMIT,
  TRANSCRIPT_LIMIT_STEPS,
} from "./api-client.js";
import { agoText } from "./text-formatters.js";

export const TRANSCRIPT_ROLES = new Set(["user", "assistant", "tool", "system", "unknown"]);

export const TRANSCRIPT_ROLE_LABELS = {
  user: "You", assistant: "Agent", tool: "Tool", system: "System", unknown: "Event",
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
      line.at ? el("time", { class: "tr-at", datetime: line.at, title: line.at, text: agoText(line.at) }) : null),
    // UNTRUSTED. textContent via el({ text }) — never innerHTML.
    el("p", { class: "tr-text", text: line.text }));
}

/* Reasoning arrives as a `system` line the server prefixed with `Thought\n` —
   the contract that let Grok Build's thought stream reach the drawer without a
   sixth TranscriptLine role. The prefix is wire chrome: it labels the row here
   and never reaches the operator's eye. A system line that merely opens with
   the WORD (a warning about a thought experiment) is not a thought, so the
   newline is part of the match. */
const THOUGHT_PREFIX_RE = /^Thought\r?\n/;

export function thoughtText(line) {
  if (!line || line.role !== "system" || typeof line.text !== "string") return null;
  return THOUGHT_PREFIX_RE.test(line.text) ? line.text.replace(THOUGHT_PREFIX_RE, "") : null;
}

/* One consecutive run of thoughts, closed. A Grok session carries thousands of
   these against a few hundred turns of speech, so the run collapses to a single
   row: the operator sees that the agent reasoned, reads the first line of it,
   and opens the node only when the reasoning is the thing they came for. */
export function thoughtGroupNode(lines) {
  const bodies = lines.map((line) => thoughtText(line) ?? "");
  const gist = bodies.find((text) => text.trim()) || "";
  const first = gist.split(/\r?\n/).find((part) => part.trim()) || "";
  const at = lines.find((line) => line.at)?.at || null;
  return el("details", { class: "chat-thought", dataset: { count: String(lines.length) } },
    el("summary", { class: "chat-thought-summary" },
      el("span", { class: "chat-thought-disclosure", "aria-hidden": "true" }, icon("chevron")),
      el("span", { class: "chat-thought-copy" },
        el("span", {
          class: "chat-thought-label",
          text: lines.length === 1 ? "Thought" : lines.length + " thoughts",
        }),
        // UNTRUSTED. textContent via el({ text }) — never innerHTML.
        el("span", { class: "chat-thought-gist", text: first.length > 72 ? first.slice(0, 71) + "…" : first })),
      at ? el("time", { class: "chat-thought-at", datetime: at, title: at, text: agoText(at) }) : null),
    el("div", { class: "chat-thought-body" },
      // UNTRUSTED. textContent via el({ text }) — never innerHTML.
      bodies.map((text) => el("p", { class: "chat-thought-text", text }))));
}

const TOOL_STATUS = {
  ok: { label: "Passed", tone: "good" },
  pass: { label: "Passed", tone: "good" },
  passed: { label: "Passed", tone: "good" },
  success: { label: "Succeeded", tone: "good" },
  succeeded: { label: "Succeeded", tone: "good" },
  complete: { label: "Completed", tone: "good" },
  completed: { label: "Completed", tone: "good" },
  failed: { label: "Failed", tone: "bad" },
  failure: { label: "Failed", tone: "bad" },
  error: { label: "Failed", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "quiet" },
  canceled: { label: "Cancelled", tone: "quiet" },
  timeout: { label: "Timed out", tone: "bad" },
  "timed out": { label: "Timed out", tone: "bad" },
  running: { label: "Running", tone: "live" },
};

const TOOL_STATUS_VALUE = "ok|pass|passed|success|succeeded|complete|completed|failed|failure|error|cancelled|canceled|timeout|timed out|running";
const TOOL_STATUS_RE = new RegExp("(?:^|[\\n;,]\\s*)(?:status|result)\\s*[:=]\\s*(" + TOOL_STATUS_VALUE + ")(?=$|[\\s;,])", "i");
const TOOL_EXIT_RE = /(?:^|[\n;,]\s*)exit(?:ed)?(?:\s+with)?(?:\s+code)?\s*[:=]?\s*(-?\d+)(?=$|[\s;,])/i;
const TOOL_DURATION_RE = /(?:^|[\n;,]\s*)(?:duration|elapsed)\s*[:=]\s*(\d+(?:\.\d+)?\s*(?:ms|milliseconds?|s|sec(?:ond)?s?|m|min(?:ute)?s?))(?=$|[\s;,])/i;
const TOOL_TOOK_RE = /(?:^|[\n;,]\s*)took\s+(\d+(?:\.\d+)?\s*(?:ms|milliseconds?|s|sec(?:ond)?s?|m|min(?:ute)?s?))(?=$|[\s;,])/i;
const TOOL_METADATA_LINE_RE = /^(?:(?:status|result|duration|elapsed)\s*[:=]|took\s+|exit(?:ed)?(?:\s+with)?(?:\s+code)?\s*[:=]?)/i;

function toolActivityView(line) {
  const raw = String(line.text || "");
  const statusMatch = raw.match(TOOL_STATUS_RE);
  const exitMatch = statusMatch ? null : raw.match(TOOL_EXIT_RE);
  const status = statusMatch
    ? TOOL_STATUS[statusMatch[1].toLowerCase()]
    : exitMatch
      ? Number(exitMatch[1]) === 0
        ? { label: "Passed", tone: "good" }
        : { label: "Failed", tone: "bad" }
      : null;
  const durationMatch = raw.match(TOOL_DURATION_RE) || raw.match(TOOL_TOOK_RE);
  const titleLine = raw.split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part && !TOOL_METADATA_LINE_RE.test(part));
  const title = titleLine || "Tool output";
  return {
    raw,
    title: title.length > 58 ? title.slice(0, 57) + "…" : title,
    status,
    duration: durationMatch ? durationMatch[1].replace(/\s+/g, " ") : null,
  };
}

function toolActivityCard(line) {
  const view = toolActivityView(line);
  return el("details", {
    class: "chat-tool-card",
    dataset: view.status ? { status: view.status.tone } : null,
  },
  el("summary", { class: "chat-tool-summary" },
    el("span", { class: "chat-tool-node", "aria-hidden": "true" }, icon("terminal")),
    el("span", { class: "chat-tool-card-copy" },
      el("span", { class: "chat-tool-title", text: view.title }),
      el("span", { class: "chat-tool-meta" },
        line.at ? el("time", { datetime: line.at, title: line.at, text: agoText(line.at) }) : null,
        view.status ? el("span", {
          class: "chat-tool-status is-" + view.status.tone,
          text: view.status.label,
        }) : null,
        view.duration ? el("span", { class: "chat-tool-duration", text: view.duration }) : null)),
    el("span", { class: "chat-tool-disclosure", "aria-hidden": "true" }, icon("chevron"))),
  el("div", { class: "chat-tool-output" },
    el("span", { class: "chat-tool-output-label", text: "Raw output" }),
    // UNTRUSTED. textContent via el({ text }) — never innerHTML.
    el("pre", { text: view.raw })));
}

export function toolActivityNode(lines) {
  const count = lines.length;
  return el("section", {
    class: "chat-tool-group",
    "aria-label": count + (count === 1 ? " tool activity" : " tool activities"),
  },
  el("div", { class: "chat-tool-group-head" },
    icon("activity"),
    el("span", { text: "Tool activity" }),
    el("span", { class: "chat-tool-count", text: String(count) })),
  el("div", { class: "chat-tool-timeline" }, lines.map((line) => toolActivityCard(line))));
}

/* One visual grammar for exceptional chat states. The copy remains owned by
   the caller because loading, absence, failure, and feed staleness are
   different facts; this helper only gives those facts an intentional icon,
   title, and supporting-detail hierarchy. */
export function chatFeedStateNode(kind, iconName, title, detail, action = null) {
  return el("div", {
    class: "chat-feed-state",
    dataset: { state: kind },
    role: "status",
  },
  el("span", { class: "chat-feed-state-mark", "aria-hidden": "true" }, icon(iconName, { label: "" })),
  el("div", { class: "chat-feed-state-copy" },
    el("strong", { class: "chat-feed-state-title", text: title }),
    el("p", { class: "chat-feed-state-detail", text: detail }),
    action));
}

/* Exceptional transcript states and the one manual history action live at the
   start of the feed. A normally loaded transcript needs no chrome: its turn
   count and raw source path already belong to Evidence, and the live feed
   refreshes on its own. Semantic buttons are styled as text links because they
   perform actions rather than navigation. */
export function renderTranscriptFeedLead(agent, ui = state, opts = {}) {
  const view = (ui && ui.transcript) || {};
  if (view.agentId !== agent.id) return null;

  if (view.loading) {
    // Bounded by construction: loadTranscript always resolves into data or an
    // error, so this can never become a spinner that never resolves.
    return chatFeedStateNode(
      "loading", "activity", "Reading the transcript…",
      "Loading the recorded turns for this session.",
    );
  }

  if (view.error) {
    return chatFeedStateNode(
      "unavailable", "offline", "Transcript unavailable", view.error,
      el("button", {
        type: "button", class: "transcript-inline-action",
        dataset: { fkey: "transcript-retry:" + agent.id },
        onclick: () => void loadTranscript(agent.id, view.limit),
      }, "Try again"),
    );
  }

  const data = view.data || { lines: [], source: null, truncated: false };
  if (!data.lines.length) {
    /* Collector speech already on the agent is the preview thread. An empty
       jsonl (common on Grok) must not replace that speech with a lie. */
    if (opts.hasPreviewSpeech) return null;
    return chatFeedStateNode(
      "empty", "scroll-text",
      data.source ? "No readable turns" : "No transcript recorded",
      data.source
        ? "The transcript file is present but has no readable turns."
        : "No transcript file is recorded for this session.",
    );
  }
  const more = nextTranscriptLimit(view.limit);
  if (more && data.truncated) {
    return el("div", { class: "chat-feed-lead" },
      el("button", {
        type: "button", class: "transcript-inline-action",
        dataset: { fkey: "transcript-more:" + agent.id },
        onclick: () => void loadTranscript(agent.id, more),
      }, "Load older turns"));
  }
  return null;
}

function agentFromSnap(agentId) {
  const programs = state.snap && state.snap.programs;
  if (!Array.isArray(programs)) return null;
  for (const program of programs) {
    const agents = program && program.agents;
    if (!Array.isArray(agents)) continue;
    const agent = agents.find((item) => item && item.id === agentId);
    if (agent) return agent;
  }
  return null;
}

export function isGrokBotAgent(agent) {
  return Boolean(agent && typeof agent.id === "string" && agent.id.startsWith("grok:bot:"));
}

/* Grok Bot inspector only. Roster lastActivityAt stays 0 / create-time, so
   lastUserMessage is the field that used to "sync" the drawer — the operator
   had to message the Bot. Replica speech moves lastThreadAt and lastAgent*.
   lastUserMessage is deliberately not in this stamp. */
export function transcriptThreadStamp(agent) {
  if (!isGrokBotAgent(agent)) return "";
  return [
    agent.lastThreadAt || "",
    agent.lastAgentMessage || "",
    agent.lastAgentClosing || "",
    agent.lastAgentChatBody || "",
  ].join("\u001f");
}

/* shouldAutoLoadTranscript only runs when agentId changes, so an open Bot
   inspector keeps the first lines:[] for the whole open. Reload that one
   held /api/transcript when the replica clock moves. Not a second chat store.
   Failed loads still retry only via Try again. */
export function shouldRefreshHeldTranscript(agent, transcript) {
  if (!isGrokBotAgent(agent) || !transcript || transcript.agentId !== agent.id) return false;
  if (transcript.loading || transcript.error) return false;
  const stamp = transcriptThreadStamp(agent);
  if (!stamp) return false;
  if (transcript.threadStamp == null || transcript.threadStamp === "") {
    return Boolean(transcript.data && transcript.data.source && transcript.data.lines.length === 0);
  }
  return transcript.threadStamp !== stamp;
}

export async function loadTranscript(agentId, limit = TRANSCRIPT_DEFAULT_LIMIT, opts = {}) {
  const want = clampTranscriptLimit(limit);
  const held = state.transcript && state.transcript.agentId === agentId ? state.transcript : null;
  const stamp = opts.threadStamp ?? transcriptThreadStamp(agentFromSnap(agentId));
  const quiet = opts.quiet === true && held && held.data;
  state.transcript = {
    agentId,
    loading: !quiet,
    error: quiet ? (held.error || "") : "",
    data: quiet ? held.data : null,
    limit: want,
    threadStamp: stamp,
  };
  if (!quiet) repaint();
  let next;
  try {
    const res = await apiFetch(transcriptUrl(agentId, want), { headers: { accept: "application/json" } }, API_TRANSCRIPT_TIMEOUT_MS);
    let body = null;
    try { body = await res.json(); } catch { /* a build without the route answers HTML */ }
    next = !res.ok || !body || body.ok !== true
      ? (quiet && held
        ? { ...held, loading: false }
        : { agentId, loading: false, error: transcriptFailureText(res.status, body), data: null, limit: want, threadStamp: stamp })
      : { agentId, loading: false, error: "", data: normalizeTranscript(body), limit: want, threadStamp: stamp };
  } catch {
    next = quiet && held
      ? { ...held, loading: false }
      : { agentId, loading: false, error: transcriptFailureText(0, null), data: null, limit: want, threadStamp: stamp };
  }
  // The operator moved on — never paint one agent's transcript into another's drawer.
  if (state.transcript.agentId !== agentId) return;
  /* A newer snapshot already started another refresh. Drop this older reply. */
  if (stamp && state.transcript.threadStamp && state.transcript.threadStamp !== stamp) return;
  state.transcript = next;
  repaint();
}
