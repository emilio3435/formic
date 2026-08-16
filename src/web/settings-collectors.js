/* Settings → Collectors.

   Agent homes the operator can Import or Ignore. Own store, own POST — not
   part of Save. Rows say whether Import put chats on the board. */

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

function collectorGroups(instances) {
  const onBoard = [];
  const importedNoRows = [];
  const found = [];
  const needsParser = [];
  const ignored = [];
  for (const row of instances) {
    if (row.ignored) ignored.push(row);
    else if (row.reason === "needs-parser" && !row.default && !row.onboarded) needsParser.push(row);
    else if ((row.reason === "needs-parser" || row.reason === "needs-home-list") && row.onboarded) importedNoRows.push(row);
    else if (row.default || row.onboarded) onBoard.push(row);
    else found.push(row);
  }
  return { onBoard, importedNoRows, found, needsParser, ignored };
}

function collectorPreviewText(instances) {
  const { onBoard, importedNoRows, found, needsParser } = collectorGroups(instances);
  const on = onBoard.length;
  const imported = importedNoRows.length;
  const waiting = found.length + needsParser.length;
  return `${on} home${on === 1 ? "" : "s"} on the board. ${imported} imported with no rows yet. ${waiting} waiting on you.`;
}

function collectorStatusLine(inst) {
  const shortDir = shortCollectorDir(inst.dataDir);
  const parserish = inst.reason === "needs-parser" || inst.reason === "needs-home-list";
  if (inst.ignored) return "Ignored.";
  if (inst.onboarded && parserish) return "Imported. No board rows — Formic cannot read this yet.";
  if (inst.default || inst.onboarded) return `Collecting from ${shortDir}`;
  if (inst.reason === "needs-parser") return "Found. Import records it; it will not appear on the board.";
  return `Found. Import to collect from ${shortDir}.`;
}

function collectorImportNoteFor(ids) {
  const instances = collectorInstanceList();
  return ids.map((id) => {
    const inst = instances.find((row) => row.id === id);
    const label = (inst && inst.label) || id;
    const reason = inst && inst.reason;
    if (reason === "needs-parser" || reason === "needs-home-list") {
      return `Imported ${label}. No new board rows — this home has no parser yet.`;
    }
    return `Imported ${label}. Its chats should appear on the board after refresh.`;
  }).join(" ");
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

async function postCollectorInstances(body, importNote) {
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
    if (typeof importNote === "string") state.collectorImportNote = importNote;
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
  void postCollectorInstances({ ids, onboarded: true }, collectorImportNoteFor(ids));
}

function syncImportSelectedState() {
  const btn = document.querySelector("[data-fkey='collectors-import']");
  if (!btn) return;
  btn.disabled = selectedCollectorIds().length === 0;
}

function ignoreCollectorInstance(id) {
  if (!id) return;
  void postCollectorInstances({ id, ignored: true });
}

function collectorRow(inst) {
  const extra = !inst.default && !inst.onboarded && !inst.ignored;
  return el("div", {
    class: "settings-collectors-row",
    "data-instance": inst.id,
    dataset: { instance: inst.id },
  },
    extra ? el("input", {
      type: "checkbox",
      dataset: { instance: inst.id },
      onchange: syncImportSelectedState,
    }) : null,
    el("div", { class: "settings-collectors-copy" },
      el("span", { class: "settings-field-label", text: inst.label || inst.id }),
      el("span", { class: "settings-help", text: collectorStatusLine(inst) })),
    extra ? el("button", {
      type: "button",
      class: "settings-collectors-ignore",
      dataset: { fkey: "instance-ignore" },
      onclick: () => ignoreCollectorInstance(inst.id),
    }, "Ignore") : null);
}

function collectorGroup(title, rows, group) {
  if (!rows.length) return null;
  return el("div", {
    class: "settings-collectors-group",
    "data-group": group,
    dataset: { group },
  },
    el("p", { class: "settings-field-label", text: title }),
    ...rows.map(collectorRow));
}

function renderCollectorsBlock() {
  const instances = collectorInstanceList();
  const { onBoard, importedNoRows, found, needsParser, ignored } = collectorGroups(instances);
  const importable = found.length + needsParser.length;
  const importBtn = importable ? el("button", {
    type: "button",
    class: "btn primary",
    disabled: "",
    dataset: { fkey: "collectors-import" },
    onclick: importSelectedCollectors,
  }, "Import selected") : null;
  if (importBtn) importBtn.disabled = true;
  return el("section", { id: "settings-collectors", class: "settings-collectors" },
    el("h3", { text: "Collectors" }),
    el("p", { class: "settings-help", text: collectorPreviewText(instances) }),
    collectorGroup("On the board", onBoard, "on-board"),
    collectorGroup("Imported, no rows yet", importedNoRows, "imported-no-rows"),
    collectorGroup("Found, not imported", found, "found"),
    collectorGroup("Needs a parser", needsParser, "needs-parser"),
    collectorGroup("Ignored", ignored, "ignored"),
    importable ? el("div", { class: "settings-collectors-actions" },
      importBtn,
      el("span", { class: "settings-help", text: "Select a home above." })) : null,
    state.collectorImportNote
      ? el("p", { class: "settings-preview", id: "collectors-import-note", role: "status", text: state.collectorImportNote })
      : null);
}

export {
  collectorInstanceList,
  shortCollectorDir,
  collectorGroups,
  collectorPreviewText,
  collectorStatusLine,
  selectedCollectorIds,
  fetchCollectorInstances,
  postCollectorInstances,
  importSelectedCollectors,
  ignoreCollectorInstance,
  collectorRow,
  collectorGroup,
  renderCollectorsBlock,
};
