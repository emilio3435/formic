/* Settings → Collectors.

   Agent homes the operator can Import or Ignore. Own store, own POST — not
   part of Save. Extracted from app.js so the dialog can move without taking
   the rest of the client with it. Paint is unchanged from the inlined block. */

import { state } from "./client-state.js";
import { $, el } from "./dom-primitives.js";
import { apiFetch, API_READ_TIMEOUT_MS, API_WRITE_TIMEOUT_MS } from "./api-client.js";
import { renderSettingsPanel } from "./settings-panel.js";

function collectorInstanceList() {
  return Array.isArray(state.collectorInstances) ? state.collectorInstances : [];
}

function shortCollectorDir(path) {
  const parts = String(path || "").split("/").filter(Boolean);
  return parts.slice(-2).join("/") || path || "";
}

function collectorPreviewText(instances) {
  const on = instances.filter((row) => row.default || row.onboarded).length;
  const waiting = instances.filter((row) => !row.onboarded && !row.ignored && !row.default).length;
  return `${on} home${on === 1 ? "" : "s"} on. ${waiting} found, waiting on you.`;
}

function collectorGroups(instances) {
  const onNow = [];
  const found = [];
  const needsParser = [];
  const ignored = [];
  for (const row of instances) {
    if (row.ignored) ignored.push(row);
    else if (row.reason === "needs-parser" && !row.default && !row.onboarded) needsParser.push(row);
    else if (row.default || row.onboarded) onNow.push(row);
    else found.push(row);
  }
  return { onNow, found, needsParser, ignored };
}

function selectedCollectorIds() {
  const root = $("settings-collectors");
  if (!root) return [];
  const ids = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    const tag = node.tagName;
    const type = node.type || (typeof node.getAttribute === "function" ? node.getAttribute("type") : "");
    if ((tag === "input" || tag === "INPUT") && type === "checkbox" && node.checked) {
      const id = (node.dataset && node.dataset.instance)
        || (typeof node.getAttribute === "function" ? node.getAttribute("data-instance") : "");
      if (id) ids.push(id);
    }
    for (const kid of node.children || node.childNodes || []) visit(kid);
  };
  visit(root);
  return ids;
}

async function fetchCollectorInstances() {
  state.collectorInstancesPending = true;
  if (state.settingsPanelOpen) renderSettingsPanel();
  try {
    const res = await apiFetch("/api/collector-instances", { headers: { accept: "application/json" } }, API_READ_TIMEOUT_MS);
    const body = await res.json();
    if (!res.ok || !body || body.ok !== true || !Array.isArray(body.instances)) {
      throw new Error("bad collector-instances response");
    }
    state.collectorInstances = body.instances;
  } catch (err) {
    console.warn("collector instances fetch failed:", err);
  } finally {
    state.collectorInstancesPending = false;
    if (state.settingsPanelOpen) renderSettingsPanel();
  }
}

async function postCollectorInstances(body) {
  state.collectorInstancesPending = true;
  if (state.settingsPanelOpen) renderSettingsPanel();
  try {
    const res = await apiFetch("/api/collector-instances", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    }, API_WRITE_TIMEOUT_MS);
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload || payload.ok !== true) {
      throw new Error((payload && payload.error && payload.error.message) || ("collector instances " + res.status));
    }
    await fetchCollectorInstances();
  } catch (err) {
    console.warn("collector instances update failed:", err);
    state.collectorInstancesPending = false;
    if (state.settingsPanelOpen) renderSettingsPanel();
  }
}

function importSelectedCollectors() {
  const ids = selectedCollectorIds();
  if (!ids.length) return;
  void postCollectorInstances({ ids, onboarded: true });
}

function ignoreCollectorInstance(id) {
  if (!id) return;
  void postCollectorInstances({ id, ignored: true });
}

function collectorRow(inst) {
  const extra = !inst.default && !inst.onboarded && !inst.ignored;
  const bits = [inst.kind, shortCollectorDir(inst.dataDir)].filter(Boolean);
  if (inst.reason === "needs-parser") bits.push("Needs a parser");
  else if (inst.reason === "needs-home-list") bits.push("Needs a home list");
  if (inst.lastSeenAt) bits.push(inst.lastSeenAt);
  return el("div", {
    class: "settings-field",
    "data-instance": inst.id,
    dataset: { instance: inst.id },
  },
    extra ? el("input", { type: "checkbox", dataset: { instance: inst.id } }) : null,
    el("span", { class: "settings-field-label", text: inst.label || inst.id }),
    el("span", { class: "settings-help", text: bits.join(" · ") }),
    extra ? el("button", {
      type: "button",
      class: "btn",
      dataset: { fkey: "instance-ignore" },
      onclick: () => ignoreCollectorInstance(inst.id),
    }, "Ignore") : null);
}

function collectorGroup(title, rows) {
  if (!rows.length) return null;
  return el("div", { class: "settings-collectors-group" },
    el("p", { class: "settings-field-label", text: title }),
    ...rows.map(collectorRow));
}

function renderCollectorsBlock() {
  const instances = collectorInstanceList();
  const { onNow, found, needsParser, ignored } = collectorGroups(instances);
  const importable = found.length + needsParser.length;
  return el("section", { id: "settings-collectors", class: "settings-collectors" },
    el("h3", { text: "Collectors" }),
    el("p", { class: "settings-help", text: collectorPreviewText(instances) }),
    collectorGroup("On now", onNow),
    collectorGroup("Found, not imported", found),
    collectorGroup("Needs a parser", needsParser),
    collectorGroup("Ignored", ignored),
    importable ? el("button", {
      type: "button", class: "btn",
      dataset: { fkey: "collectors-import" },
      onclick: importSelectedCollectors,
    }, "Import selected") : null);
}

export {
  collectorInstanceList,
  shortCollectorDir,
  collectorPreviewText,
  collectorGroups,
  selectedCollectorIds,
  fetchCollectorInstances,
  postCollectorInstances,
  importSelectedCollectors,
  ignoreCollectorInstance,
  collectorRow,
  collectorGroup,
  renderCollectorsBlock,
};
