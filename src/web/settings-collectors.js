/* Settings → Collectors.

   Agent homes the operator can Import or Ignore. Own store, own POST — not
   part of Save. Rows say whether Import put chats on the board. */

import { state } from "./client-state.js";
import { $, el } from "./dom-primitives.js";
import { apiFetch, API_READ_TIMEOUT_MS, API_WRITE_TIMEOUT_MS } from "./api-client.js";
import { renderSettingsPanel } from "./settings-panel.js";

let collectorImportFailed = false;

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

function collectorCheckboxId(node) {
  return (node.dataset && node.dataset.instance)
    || (typeof node.getAttribute === "function" ? node.getAttribute("data-instance") : "")
    || "";
}

function visitCollectorCheckboxes(root, fn) {
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    const tag = node.tagName;
    const type = node.type || (typeof node.getAttribute === "function" ? node.getAttribute("type") : "");
    if ((tag === "input" || tag === "INPUT") && type === "checkbox") fn(node);
    for (const kid of node.children || node.childNodes || []) visit(kid);
  };
  visit(root);
}

function selectedCollectorIds() {
  const root = $("settings-collectors");
  if (!root) return [];
  const ids = [];
  visitCollectorCheckboxes(root, (node) => {
    if (!node.checked) return;
    const id = collectorCheckboxId(node);
    if (id) ids.push(id);
  });
  return ids;
}

function restoreCollectorChecks(root, ids) {
  if (!root || !ids.length) return;
  const wanted = new Set(ids);
  visitCollectorCheckboxes(root, (node) => {
    if (wanted.has(collectorCheckboxId(node))) node.checked = true;
  });
}

function paintCollectorHomes() {
  if (!state.settingsPanelOpen) return;
  if ($("settings-homes")) {
    renderCollectorsBlock();
    return;
  }
  renderSettingsPanel();
}

async function fetchCollectorInstances() {
  state.collectorInstancesPending = true;
  paintCollectorHomes();
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
    paintCollectorHomes();
  }
}

async function postCollectorInstances(body, importNote) {
  state.collectorInstancesPending = true;
  paintCollectorHomes();
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
    if (typeof importNote === "string") {
      state.collectorImportNote = importNote;
      collectorImportFailed = false;
    }
    await fetchCollectorInstances();
  } catch (err) {
    const message = err && err.message ? err.message : "collector instances update failed";
    state.collectorImportNote = "Not saved. " + message;
    collectorImportFailed = true;
    state.collectorInstancesPending = false;
    paintCollectorHomes();
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

function restoreCollectorInstance(id) {
  if (!id) return;
  void postCollectorInstances({ id, ignored: false });
}

const HOME_MARK = {
  "cursor-gui": "/icons/cursor.svg",
  "cursor-cli": "/icons/cursor.svg",
  "grok-cli": "/icons/xai.svg",
  "grok-bot": "/icons/grok.svg",
  claude: "/icons/claude-code.svg",
  factory: "/icons/factory.svg",
  prime: "/icons/prime-orch.svg",
  omp: "/icons/omp.svg",
  hermes: "/icons/formic-mark.svg",
  muse: "/icons/muse.svg",
  copilot: "/icons/copilot.svg",
  "antigravity-cli": "/icons/antigravity.png",
  "antigravity-desktop": "/icons/antigravity.png",
  "antigravity-ide": "/icons/antigravity.png",
  codex: "/icons/codex.webp",
  burnbar: "/icons/history.svg",
};

function homeMark(inst) {
  const src = HOME_MARK[inst.kind];
  const label = inst.label || inst.id;
  if (!src) {
    return el("span", { class: "home-letter", text: String(label).slice(0, 1), title: label });
  }
  return el("img", { class: "home-mark", src, alt: label });
}

function collectorRow(inst) {
  const ignored = Boolean(inst.ignored);
  const waiting = !ignored && !inst.default && !inst.onboarded;
  const on = !ignored && (inst.default || inst.onboarded);
  const classes = ["home"];
  if (waiting) classes.push("is-wait");
  if (ignored) classes.push("is-off");
  return el("div", {
    class: classes.join(" "),
    "data-instance": inst.id,
    dataset: { instance: inst.id },
    title: collectorStatusLine(inst),
  },
    homeMark(inst),
    el("b", { text: inst.label || inst.id }),
    on ? el("s", { text: "on" }) : null,
    waiting ? el("label", {},
      el("input", {
        type: "checkbox",
        dataset: { instance: inst.id },
        onchange: syncImportSelectedState,
      }),
      "import") : null,
    waiting ? el("button", {
      type: "button",
      class: "settings-collectors-ignore",
      dataset: { fkey: "instance-ignore" },
      onclick: () => ignoreCollectorInstance(inst.id),
    }, "Ignore") : null,
    ignored ? el("button", {
      type: "button",
      class: "settings-collectors-ignore",
      dataset: { fkey: "instance-restore" },
      onclick: () => restoreCollectorInstance(inst.id),
    }, "Restore") : null,
    el("span", { hidden: "", text: collectorStatusLine(inst) }));
}

function collectorGroup(title, rows, group) {
  if (!rows.length) return null;
  return el("div", {
    class: "settings-collectors-group",
    "data-group": group,
    dataset: { group },
  },
    el("div", { class: "home-grid" },
      ...rows.map(collectorRow)));
}

function collectorsImportNoteNode() {
  if (!state.collectorImportNote) return null;
  return el("p", {
    class: collectorImportFailed ? "home-note settings-error" : "home-note settings-saved",
    id: "collectors-import-note",
    role: collectorImportFailed ? "alert" : "status",
    text: state.collectorImportNote,
  });
}

function renderCollectorsBlock() {
  const kept = selectedCollectorIds();
  const instances = collectorInstanceList();
  const { onBoard, importedNoRows, found, needsParser, ignored } = collectorGroups(instances);
  const importable = found.length + needsParser.length;
  const importBtn = importable ? el("button", {
    type: "button",
    class: "btn",
    disabled: "",
    dataset: { fkey: "collectors-import" },
    onclick: importSelectedCollectors,
  }, "Import selected") : null;
  if (importBtn) importBtn.disabled = true;
  const block = el("section", { id: "settings-collectors", class: "settings-collectors" },
    el("h3", { text: "Homes on this machine" }),
    collectorGroup("On the board", onBoard, "on-board"),
    collectorGroup("Imported, no rows yet", importedNoRows, "imported-no-rows"),
    collectorGroup("Found, not imported", found, "found"),
    collectorGroup("Needs a parser", needsParser, "needs-parser"),
    importable ? el("div", { class: "home-acts" }, importBtn) : null,
    collectorsImportNoteNode(),
    collectorGroup("Ignored", ignored, "ignored"));
  restoreCollectorChecks(block, kept);
  const host = $("settings-homes");
  if (host) {
    host.textContent = "";
    host.append(block);
  }
  syncImportSelectedState();
  return block;
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
