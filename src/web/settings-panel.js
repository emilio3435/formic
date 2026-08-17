/* The Settings desk.

   One modal. Span first, then homes / plates / horizon, then clay Save time.
   Collectors and colours apply immediately; Save posts the six fleet scalars.
   app.js opens, closes, and re-exports the test seam. Functions that still
   live in app.js arrive through bindSettingsPanel so this file does not
   import the entry point. */

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
let fetchTeamColors;
let paintRepoColorSettings;
let paintTeamColorSettings;
let render;

export function bindSettingsPanel(deps) {
  paintUnchanged = deps.paintUnchanged;
  postSettings = deps.postSettings;
  setNeedsYouDisplay = deps.setNeedsYouDisplay;
  fetchRepoColors = deps.fetchRepoColors;
  fetchTeamColors = deps.fetchTeamColors;
  paintRepoColorSettings = deps.paintRepoColorSettings;
  paintTeamColorSettings = deps.paintTeamColorSettings;
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

function meterGlyph(kind) {
  if (kind === "keep") {
    return el("img", { src: "/icons/history.svg", alt: "", width: "16", height: "16" });
  }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  const draw = (tag, attrs) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    svg.append(node);
  };
  if (kind === "scan") {
    draw("circle", { cx: "12", cy: "12", r: "8", stroke: "currentColor", "stroke-width": "1.7" });
    draw("path", { d: "M12 8v4.2l2.6 1.6", stroke: "currentColor", "stroke-width": "1.7", "stroke-linecap": "round" });
  } else if (kind === "wait") {
    draw("path", {
      d: "M4 12h16M16 7l5 5-5 5",
      stroke: "currentColor",
      "stroke-width": "1.7",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    });
  } else {
    draw("path", {
      d: "M5 6h14M7 10v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-8",
      stroke: "currentColor",
      "stroke-width": "1.7",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    });
    draw("path", { d: "M10 14h4", stroke: "currentColor", "stroke-width": "1.7", "stroke-linecap": "round" });
  }
  return svg;
}

function providerWaitSelect(value) {
  const input = el("select", {
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
  return input;
}

function horizonMeter(kind, key, label, control) {
  return el("div", { class: "meter" },
    el("div", { class: "ico" },
      meterGlyph(kind),
      el("label", { for: "setting-" + key, text: label })),
    control);
}

function horizonNumber(key, value, min, max, fkey = null) {
  return el("input", {
    type: "number",
    id: "setting-" + key,
    dataset: fkey ? { setting: key, fkey } : { setting: key },
    value: String(value),
    min: String(min),
    max: String(max),
  });
}

function settingsValue(key, fallback) {
  const node = $("setting-" + key);
  const raw = node ? Number(node.value) : Number.NaN;
  return Number.isFinite(raw) ? raw : fallback;
}

function railStyleAttr(fresh, quiet) {
  const histVisual = 22;
  const total = fresh + quiet + histVisual;
  const w = total > 0 ? (fresh / total) * 100 : 0;
  const q = total > 0 ? (quiet / total) * 100 : 0;
  return `--w:${w}%;--q:${q}%`;
}

function renderSettingsCounts() {
  const working = $("settings-count-work");
  const waiting = $("settings-count-wait");
  const history = $("settings-count-hist");
  if (!working || !waiting || !history) return;
  const fresh = settingsValue("activityFreshMinutes", 3);
  const quiet = settingsValue("activityQuietMinutes", 45);
  const counts = state.snap
    ? settingsPreview(state.snap, fresh, quiet)
    : { working: 0, waiting: 0, finished: 0, retained: 0 };
  working.textContent = String(counts.working);
  waiting.textContent = String(counts.waiting);
  history.textContent = String((counts.finished || 0) + (counts.retained || 0));
}

function syncSpanChrome() {
  const fresh = settingsValue("activityFreshMinutes", 3);
  const quiet = settingsValue("activityQuietMinutes", 45);
  const rail = $("settings-span-rail");
  if (rail) rail.setAttribute("style", railStyleAttr(fresh, quiet));
  const postures = $("settings-postures");
  for (const node of (postures && postures.children) || []) {
    const on = Number(node.dataset && node.dataset.fresh) === fresh
      && Number(node.dataset && node.dataset.quiet) === quiet;
    if (node.classList) node.classList.toggle("is-on", on);
  }
  renderSettingsCounts();
}

function settingsDeskDirty() {
  const saved = state.settings || {};
  for (const key of [
    "activityFreshMinutes",
    "activityQuietMinutes",
    "scanWindowHours",
    "providerWaitMs",
    "historyRetentionDays",
    "historyRecordLimit",
  ]) {
    const node = $("setting-" + key);
    if (!node) continue;
    const raw = Number(node.value);
    const expected = Number(saved[key]);
    if (!Number.isFinite(raw) || !Number.isFinite(expected)) continue;
    if (raw !== expected) return true;
  }
  return false;
}

function requestCloseSettingsPanel() {
  if (!state.settingsPanelOpen) return;
  if (settingsDeskDirty()) {
    state.settingsSaveError = "The span has not been written.";
    renderSettingsVerdict();
    return;
  }
  closeSettingsPanel();
}

function spanWell(key, label, value, min, max) {
  return el("div", { class: "well" },
    el("label", { for: "setting-" + key, text: label }),
    el("input", {
      type: "number",
      class: "settings-input",
      id: "setting-" + key,
      dataset: { setting: key },
      value: String(value),
      min: String(min),
      max: String(max),
      oninput: () => syncSpanChrome(),
    }));
}

function postureButton(preset, fresh, quiet) {
  const total = preset.fresh + preset.quiet;
  const workShare = total > 0 ? (preset.fresh / total) * 100 : 0;
  return el("button", {
    type: "button",
    class: "posture" + (preset.fresh === fresh && preset.quiet === quiet ? " is-on" : ""),
    dataset: {
      fkey: "preset-" + preset.id,
      fresh: String(preset.fresh),
      quiet: String(preset.quiet),
    },
    onclick: () => {
      const freshNode = $("setting-activityFreshMinutes");
      const quietNode = $("setting-activityQuietMinutes");
      if (freshNode) freshNode.value = String(preset.fresh);
      if (quietNode) quietNode.value = String(preset.quiet);
      syncSpanChrome();
    },
  },
    el("span", {
      class: "mini",
      style: "grid-template-columns:" + workShare + "% " + (100 - workShare) + "%",
    }, el("i"), el("i")),
    el("b", { text: preset.label }),
    el("em", { text: `${preset.fresh} / ${preset.quiet}` }));
}

function modeGlyph(value) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  const path = (d, extra) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", "path");
    node.setAttribute("d", d);
    node.setAttribute("stroke", "currentColor");
    node.setAttribute("stroke-width", "1.7");
    for (const [k, v] of Object.entries(extra || {})) node.setAttribute(k, v);
    svg.append(node);
  };
  if (value === "pane") {
    path("M6 4h8v16H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z");
    path("M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4");
    path("M8 8h4M8 12h3", { "stroke-linecap": "round" });
  } else {
    path("M5 7h14M5 12h14M5 17h10", { "stroke-linecap": "round" });
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", "18.5");
    dot.setAttribute("cy", "17");
    dot.setAttribute("r", "2.2");
    dot.setAttribute("fill", "currentColor");
    svg.append(dot);
  }
  return svg;
}

function modePlate(value, label, help) {
  const on = (state.needsYouDisplay || "pane") === value;
  return el("button", {
    type: "button",
    class: "mode" + (on ? " is-on" : ""),
    dataset: { fkey: "needs-you-display-" + value },
    onclick: () => setNeedsYouDisplay(value),
  },
    modeGlyph(value),
    el("b", { text: label }),
    el("span", { text: help }));
}

function paintNeedsYouPlates() {
  const host = $("settings-needs-you");
  if (!host) return;
  const sig = state.needsYouDisplay || "pane";
  /* An empty host after a form rebuild must still fill, even when the pref
     has not moved — otherwise Save-pending would leave the plates blank. */
  if (paintUnchanged("needs-you", sig) && host.childElementCount) return;
  host.textContent = "";
  host.append(
    el("h3", { text: "Needs-you" }),
    el("div", { class: "modes" },
      modePlate("pane", "Pinned", "Strip at the top"),
      modePlate("inline", "Inline", "Marked in place"),
    ),
  );
}

/* Closing clears both verdicts. Reopening to a stale "Saved" from ten minutes
   ago would confirm a save the operator is no longer thinking about, and a
   stale error would report a failure they already fixed. */
function openSettingsPanel() {
  state.settingsPanelOpen = true;
  renderSettingsPanel();
  void fetchRepoColors();
  void fetchTeamColors();
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
  panel.onclick = (event) => { if (event.target === panel) requestCloseSettingsPanel(); };

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
  ].join("\u001f");
  if (paintUnchanged("settings", sig)) {
    /* Counts follow the snapshot; the verdict is time-boxed. Neither should
       remount the rail inputs. Plates and colours paint into their own hosts. */
    renderSettingsCounts();
    renderSettingsVerdict();
    paintNeedsYouPlates();
    paintRepoColorSettings();
    paintTeamColorSettings();
    return;
  }
  // textContent = "" is this client's clear idiom; replaceChildren is not part
  // of the minimal DOM the headless harness implements.
  panel.textContent = "";
  if (!state.settingsPanelOpen) return;
  const s = state.settings || {};
  const fresh = s.activityFreshMinutes ?? 3;
  const quiet = s.activityQuietMinutes ?? 45;
  const counts = state.snap
    ? settingsPreview(state.snap, fresh, quiet)
    : { working: 0, waiting: 0, finished: 0, retained: 0 };
  const historyCount = (counts.finished || 0) + (counts.retained || 0);
  panel.append(el("div", { class: "desk settings-inner" },
    el("div", { class: "desk-head settings-head" },
      el("div", { class: "desk-brand" },
        el("img", { src: "/icons/formic-mark.svg", alt: "", width: "20", height: "20" }),
        el("div", {},
          el("h2", { id: "settings-panel-title", text: "Settings" }),
          el("small", { text: "operator desk" }))),
      el("button", {
        type: "button", class: "settings-close", "aria-label": "Close settings",
        dataset: { fkey: "settings-close" },
        onclick: requestCloseSettingsPanel,
      }, "×")),
    el("div", { class: "desk-body" },
      el("section", { class: "span", "aria-label": "Time" },
        el("div", { class: "span-top" },
          el("p", { class: "kicker", text: "How long a session stays live" }),
          el("div", { class: "counts" },
            el("div", { class: "c-work" },
              el("b", { id: "settings-count-work", text: String(counts.working) }),
              el("span", { text: "Working" })),
            el("div", { class: "c-wait" },
              el("b", { id: "settings-count-wait", text: String(counts.waiting) }),
              el("span", { text: "Waiting" })),
            el("div", { class: "c-hist" },
              el("b", { id: "settings-count-hist", text: String(historyCount) }),
              el("span", { text: "History" })))),
        el("div", {
          class: "rail",
          id: "settings-span-rail",
          style: railStyleAttr(fresh, quiet),
        },
          el("div", { class: "seg work" }, spanWell("activityFreshMinutes", "Working", fresh, 1, 30)),
          el("div", { class: "seg quiet" }, spanWell("activityQuietMinutes", "Quiet", quiet, 5, 480)),
          el("div", { class: "seg hist", title: "Everything older is History" })),
        el("div", { class: "postures", id: "settings-postures" },
          ...SETTINGS_PRESETS.map((preset) => postureButton(preset, fresh, quiet)))),
      el("div", { id: "settings-homes", class: "homes" },
        renderCollectorsBlock()),
      el("div", { class: "split" },
        el("div", { id: "settings-needs-you", class: "plate" }),
        el("section", { class: "plate", "aria-label": "Repository colours" },
          el("h3", { text: "Repo colours" }),
          el("div", { id: "repo-colors-host", class: "repo-colors-host" })),
        el("section", { class: "plate", "aria-label": "Teams" },
          el("h3", { text: "Teams" }),
          el("div", { id: "team-colors-host", class: "team-colors-host" }))),
      el("section", { class: "horizon", "aria-label": "Horizon" },
        el("h3", { text: "Horizon" }),
        el("div", { class: "meters" },
          horizonMeter("scan", "scanWindowHours", "Scan",
            horizonNumber("scanWindowHours", s.scanWindowHours ?? state.scanWindowHours ?? 36, 1, 168, "scan-window")),
          horizonMeter("wait", "providerWaitMs", "Wait",
            providerWaitSelect(s.providerWaitMs ?? 7500)),
          horizonMeter("keep", "historyRetentionDays", "Keep",
            horizonNumber("historyRetentionDays", s.historyRetentionDays ?? 30, 7, 365)),
          horizonMeter("cap", "historyRecordLimit", "Cap",
            horizonNumber("historyRecordLimit", s.historyRecordLimit ?? 5000, 100, 50000))))),
    el("div", { class: "desk-foot" },
      el("p", { id: "settings-verdict", hidden: "" }),
      el("div", { class: "acts" },
        el("button", {
          type: "button", class: "btn primary", dataset: { fkey: "settings-save" },
          onclick: () => {
            const freshNow = settingsValue("activityFreshMinutes", 3);
            const quietNow = settingsValue("activityQuietMinutes", 45);
            if (quietNow <= freshNow) {
              state.settingsSaveError = "Quiet must be longer than Working.";
              renderSettingsVerdict();
              return;
            }
            void postSettings({
              activityFreshMinutes: freshNow,
              activityQuietMinutes: quietNow,
              scanWindowHours: settingsValue("scanWindowHours", 36),
              providerWaitMs: settingsValue("providerWaitMs", 7500),
              historyRetentionDays: settingsValue("historyRetentionDays", 30),
              historyRecordLimit: settingsValue("historyRecordLimit", 5000),
            });
          },
        }, state.settingsPending ? "Saving…" : "Save time"),
        el("button", {
          type: "button", class: "btn", dataset: { fkey: "settings-reset" },
          onclick: () => {
            void postSettings({
              activityFreshMinutes: 3, activityQuietMinutes: 45, scanWindowHours: 36,
              providerWaitMs: 7500, historyRetentionDays: 30, historyRecordLimit: 5000,
            });
          },
        }, "Reset span")))));
  renderSettingsCounts();
  renderSettingsVerdict();
  paintNeedsYouPlates();
  paintRepoColorSettings();
  paintTeamColorSettings();
}

export {
  openSettingsPanel,
  closeSettingsPanel,
  requestCloseSettingsPanel,
  renderSettingsVerdict,
  paintSettingsToggle,
  renderSettingsPanel,
};
