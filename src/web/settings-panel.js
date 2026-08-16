/* The Settings dialog.

   One modal: time thresholds, Collectors, Advanced, this-browser prefs, and
   repository colours. Extracted from app.js with no visual change — later
   tasks restyle and reorder. app.js opens, closes, and re-exports the test
   seam. Functions that still live in app.js arrive through bindSettingsPanel
   so this file does not import the entry point. */

import { state } from "./client-state.js";
import { $, el, icon } from "./dom-primitives.js";
import { snapshotAgents } from "./presentation.js";
import { scopeOf } from "./agent-model.js";
import { classifyLifecycle, evidenceFromAgent } from "./lifecycle.js";
import { fetchCollectorInstances, renderCollectorsBlock } from "./settings-collectors.js";

let paintUnchanged;
let postSettings;
let setNeedsYouDisplay;
let fetchRepoColors;
let paintRepoColorSettings;
let render;

export function bindSettingsPanel(deps) {
  paintUnchanged = deps.paintUnchanged;
  postSettings = deps.postSettings;
  setNeedsYouDisplay = deps.setNeedsYouDisplay;
  fetchRepoColors = deps.fetchRepoColors;
  paintRepoColorSettings = deps.paintRepoColorSettings;
  render = deps.render;
}

/* Three presets that FILL THE FIELDS below them rather than storing a mode.

   A stored mode is a fourth thing to reason about — "am I in Focused, and what
   does that change?" — and it hides the numbers it sets. Filling the inputs
   teaches the thresholds by example and leaves the operator holding two plain
   numbers they can then adjust. Long-running exists because overnight swarms
   are a real shape on this machine and the defaults call them unverified. */
export const SETTINGS_PRESETS = [
  { id: "focused", label: "Focused", fresh: 2, quiet: 15, lookback: 3 },
  { id: "balanced", label: "Balanced", fresh: 3, quiet: 45, lookback: 6 },
  { id: "long-running", label: "Long-running", fresh: 10, quiet: 180, lookback: 24 },
];

/* What the board would say RIGHT NOW at the numbers in the fields — computed
   client-side with the same classifier the server runs, over the snapshot
   already in hand. Without it an operator changes a threshold, waits for a
   refresh, and infers the effect from a board that also moved on its own. */
export function settingsPreview(snap, freshMinutes, quietMinutes, nowMs = Date.now()) {
  const agents = snapshotAgents(snap).map((x) => x.agent);
  const thresholds = { freshMs: freshMinutes * 60_000, quietMs: quietMinutes * 60_000 };
  const counts = { working: 0, waiting: 0, unverified: 0, finished: 0, retained: 0 };
  for (const agent of agents) {
    if (scopeOf(agent) === "retained") { counts.retained += 1; continue; }
    const verdict = classifyLifecycle(evidenceFromAgent(agent, nowMs), thresholds);
    counts[verdict.lifecycle] += 1;
  }
  return counts;
}

export function settingsPreviewText(counts) {
  return `With these numbers right now: ${counts.working} Working · ${counts.waiting} Waiting`
    + ` · ${counts.unverified} Unverified · ${counts.finished + counts.retained} History.`;
}

function settingsField(key, label, help, value, min, max, fkey = null) {
  return el("label", { class: "settings-field" },
    el("span", { class: "settings-field-label", text: label }),
    el("input", {
      type: "number", class: "settings-input", id: "setting-" + key,
      dataset: fkey ? { setting: key, fkey } : { setting: key },
      value: String(value), min: String(min), max: String(max),
      oninput: () => renderSettingsPreview(),
    }),
    el("span", { class: "settings-help", text: help }));
}

function providerWaitField(value) {
  const input = el("select", {
    class: "settings-input",
    id: "setting-providerWaitMs",
    dataset: { setting: "providerWaitMs", fkey: "provider-wait" },
  }, ...[
    [3000, "3 seconds"],
    [5000, "5 seconds"],
    [7500, "7.5 seconds"],
    [10000, "10 seconds"],
    [15000, "15 seconds"],
  ].map(([waitMs, label]) => el("option", { value: String(waitMs), text: label })));
  input.value = String(value);
  return el("label", { class: "settings-field" },
    el("span", { class: "settings-field-label", text: "Provider wait" }),
    input,
    el("span", { class: "settings-help", text: "How long each refresh waits for provider scans before showing last-known data as degraded." }));
}

function settingsValue(key, fallback) {
  const node = $("setting-" + key);
  const raw = node ? Number(node.value) : Number.NaN;
  return Number.isFinite(raw) ? raw : fallback;
}

function renderSettingsPreview() {
  const node = $("settings-preview");
  if (!node || !state.snap) return;
  const fresh = settingsValue("activityFreshMinutes", 3);
  const quiet = settingsValue("activityQuietMinutes", 45);
  node.textContent = quiet <= fresh
    ? "Quiet must be longer than the working window."
    : settingsPreviewText(settingsPreview(state.snap, fresh, quiet));
}

/* Closing clears both verdicts. Reopening to a stale "Saved" from ten minutes
   ago would confirm a save the operator is no longer thinking about, and a
   stale error would report a failure they already fixed. */
function openSettingsPanel() {
  state.settingsPanelOpen = true;
  renderSettingsPanel();
  void fetchRepoColors();
  void fetchCollectorInstances();
}

function closeSettingsPanel() {
  state.settingsPanelOpen = false;
  state.settingsSavedAt = 0;
  state.settingsSaveError = "";
  state.collectorImportNote = "";
  render();
  $("settings-toggle")?.focus();
}

/* The save verdict, written into a node that already exists.

   Confirmation is time-boxed: leaving "Saved" up while an operator types the
   next value would confirm the wrong thing. A rejection is NOT time-boxed and
   outranks a stale success — the server rejects rather than clamping, so its
   sentence is the answer, and the value that earned it is still in the field
   waiting to be corrected. */
function renderSettingsVerdict() {
  const node = $("settings-verdict");
  if (!node) return;
  const savedRecently = Boolean(state.settingsSavedAt) && Date.now() - state.settingsSavedAt < 20_000;
  if (state.settingsSaveError) {
    node.hidden = false;
    node.className = "settings-error";
    node.setAttribute("role", "alert");
    node.textContent = "Not saved. " + state.settingsSaveError;
    return;
  }
  if (savedRecently) {
    node.hidden = false;
    node.className = "settings-saved";
    node.setAttribute("role", "status");
    node.textContent = "Saved. The board is using these numbers now.";
    return;
  }
  node.hidden = true;
  node.className = "";
  node.textContent = "";
}

function paintSettingsToggle() {
  const toggle = $("settings-toggle");
  if (!toggle) return;
  toggle.textContent = "";
  toggle.classList.add("masthead-icon");
  toggle.append(icon("gear"));
  toggle.setAttribute("aria-label", "Settings");
  toggle.setAttribute("title", "Settings");
  toggle.classList.toggle("is-open", Boolean(state.settingsPanelOpen));
}

function renderSettingsPanel() {
  const panel = $("settings-panel");
  const toggle = $("settings-toggle");
  if (!panel || !toggle) return;
  panel.hidden = !state.settingsPanelOpen;
  toggle.setAttribute("aria-expanded", String(state.settingsPanelOpen));
  paintSettingsToggle();
  // A dialog, so assistive tech treats the board behind it as inert rather than
  // as a region the reader can wander into while a modal is up.
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  /* Clicking the dimmed area closes. Guarded on the target being the backdrop
     itself, or a click that merely started inside the dialog and drifted out
     would dismiss the form mid-edit. */
  panel.onclick = (event) => { if (event.target === panel) closeSettingsPanel(); };

  /* Rebuild only when something about the SETTINGS changed — deliberately not
     on every snapshot.

     This panel is a form. It repaints with the board now (it has to, or a save
     never confirms), and a form rebuilt every four seconds discards whatever
     the operator was halfway through typing. The signature covers the server's
     values and the save verdicts; the live preview below is refreshed on every
     paint regardless, because it is the one part that must follow the board and
     the one part that can be updated without touching an input. */
  const sig = [
    state.settingsPanelOpen ? "1" : "0",
    JSON.stringify(state.settings ?? null),
    state.settingsPending ? "1" : "0",
    /* The local display pref rebuilds the panel too, or the radio the operator
       just clicked would keep the stale checkmark until a server value moved. */
    state.needsYouDisplay || "",
    JSON.stringify(state.collectorInstances),
    state.collectorInstancesPending ? "1" : "0",
    state.collectorImportNote || "",
  ].join("\u001f");
  if (paintUnchanged("settings", sig)) {
    /* The two things that must follow the board without disturbing the form:
       the preview, which predicts what these numbers do, and the save verdict,
       which is time-boxed and would otherwise expire by rebuilding the panel
       out from under whatever is being typed. Colours arrive on their own
       clock and paint into a host, so they refresh here too. */
    renderSettingsPreview();
    renderSettingsVerdict();
    paintRepoColorSettings();
    return;
  }
  // textContent = "" is this client's clear idiom; replaceChildren is not part
  // of the minimal DOM the headless harness implements.
  panel.textContent = "";
  if (!state.settingsPanelOpen) return;
  const s = state.settings || {};
  const fresh = s.activityFreshMinutes ?? 3;
  const quiet = s.activityQuietMinutes ?? 45;
  panel.append(el("div", { class: "settings-inner" },
    el("div", { class: "settings-head" },
      el("h2", { id: "settings-panel-title", text: "Settings" }),
      el("button", {
        type: "button", class: "settings-close", "aria-label": "Close settings",
        dataset: { fkey: "settings-close" },
        onclick: closeSettingsPanel,
      }, "×")),
    el("p", { class: "settings-lede", text: "How long silence has to last before this board changes what it calls a session." }),
    el("div", { class: "settings-presets" },
      el("span", { class: "settings-help", text: "Presets fill the fields below:" }),
      ...SETTINGS_PRESETS.map((preset) => el("button", {
        type: "button", class: "btn", dataset: { fkey: "preset-" + preset.id },
        onclick: () => {
          const freshNode = $("setting-activityFreshMinutes");
          const quietNode = $("setting-activityQuietMinutes");
          if (freshNode) freshNode.value = String(preset.fresh);
          if (quietNode) quietNode.value = String(preset.quiet);
          renderSettingsPreview();
        },
      }, preset.label))),
    settingsField("activityFreshMinutes", "Working means activity in the last…",
      "Sessions with activity newer than this read as Working. Minutes, 1–30.", fresh, 1, 30),
    settingsField("activityQuietMinutes", "Quiet after…",
      "After this much silence a session stops reading as recent: Waiting if its process is live, Unverified if unknown. Minutes, 5–480.",
      quiet, 5, 480),
    el("p", { class: "settings-preview", id: "settings-preview" }),
    renderCollectorsBlock(),
    el("details", { class: "settings-advanced" },
      el("summary", { text: "Advanced" }),
      /* Keeps the `scan-window` focus key the filter bar used to carry: the
         control moved surfaces, and muscle memory should land on the editor
         rather than on nothing. */
      settingsField("scanWindowHours", "Scan window",
        "How far back collectors read transcripts. Sessions older than this move to History as 'no longer watched'. Hours, 1–168.",
        s.scanWindowHours ?? state.scanWindowHours ?? 36, 1, 168, "scan-window"),
      providerWaitField(s.providerWaitMs ?? 7500),
      settingsField("historyRetentionDays", "Keep history for",
        "Finished sessions are kept this long. Lowering it permanently forgets older records. Days, 7–365.",
        s.historyRetentionDays ?? 30, 7, 365),
      settingsField("historyRecordLimit", "History record cap",
        "At most this many History records are kept. 100–50000.",
        s.historyRecordLimit ?? 5000, 100, 50000)),
    /* Per-browser display preference, deliberately OUTSIDE the Save flow: every
       field above is a fleet-shared server setting, this one is where THIS
       browser draws the board's alerting rows. It applies the moment it is
       clicked, writes localStorage rather than POSTing, and Save and Reset
       leave it alone. */
    el("fieldset", { class: "settings-local" },
      el("legend", { text: "Needs-you display" }),
      el("p", { class: "settings-help", text: "Saved in this browser only. Applies immediately — Save below does not affect it." }),
      ...[
        ["pane", "Pinned pane", "Alerting sessions are collected in the strip at the top of the board."],
        ["inline", "Inline", "Alerting sessions stay in their program groups, marked in place."],
      ].map(([value, label, help]) => el("label", { class: "settings-radio" },
        el("input", {
          type: "radio",
          name: "needs-you-display",
          value,
          checked: state.needsYouDisplay === value ? "" : null,
          dataset: { fkey: "needs-you-display-" + value },
          onchange: () => setNeedsYouDisplay(value),
        }),
        el("span", { text: label }),
        el("span", { class: "settings-help", text: help })))),
    /* TINT-F. Fleet-shared like the fields above, but written per repository
       through its own endpoint the moment a swatch changes — so it sits outside
       the Save flow, the way the display preference above does, and for the
       same reason: Save posts a fixed set of scalars and would have nothing to
       say about a colour. */
    el("fieldset", { class: "settings-local" },
      el("legend", { text: "Repository colours" }),
      el("p", { class: "settings-help", text: "A colour you pick here follows the repository name on the board, including every clone of that GitHub repo, and travels to its cmux workspaces." }),
      el("div", { id: "repo-colors-host", class: "repo-colors-host" })),
    /* The two answers a save can give, said where the save happened. A stable
       node rather than a conditional child, so it can appear, change and expire
       without rebuilding the form around it. */
    el("p", { id: "settings-verdict", hidden: "" }),
    el("div", { class: "settings-actions" },
      el("button", {
        type: "button", class: "btn btn-primary", dataset: { fkey: "settings-save" },
        onclick: () => {
          void postSettings({
            activityFreshMinutes: settingsValue("activityFreshMinutes", fresh),
            activityQuietMinutes: settingsValue("activityQuietMinutes", quiet),
            scanWindowHours: settingsValue("scanWindowHours", s.scanWindowHours ?? 36),
            providerWaitMs: settingsValue("providerWaitMs", s.providerWaitMs ?? 7500),
            historyRetentionDays: settingsValue("historyRetentionDays", s.historyRetentionDays ?? 30),
            historyRecordLimit: settingsValue("historyRecordLimit", s.historyRecordLimit ?? 5000),
          });
        },
      }, state.settingsPending ? "Saving…" : "Save"),
      el("button", {
        type: "button", class: "btn", dataset: { fkey: "settings-reset" },
        onclick: () => {
          void postSettings({
            activityFreshMinutes: 3, activityQuietMinutes: 45, scanWindowHours: 36,
            providerWaitMs: 7500, historyRetentionDays: 30, historyRecordLimit: 5000,
          });
        },
      }, "Reset all"),
      el("span", { class: "settings-spacer" }),
      el("button", {
        type: "button", class: "btn", dataset: { fkey: "settings-done" },
        onclick: closeSettingsPanel,
      }, "Done"))));
  renderSettingsPreview();
  renderSettingsVerdict();
  paintRepoColorSettings();
}

export {
  openSettingsPanel,
  closeSettingsPanel,
  renderSettingsVerdict,
  paintSettingsToggle,
  renderSettingsPanel,
};
