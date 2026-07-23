import { join } from "node:path";
import { JsonArchiveStore } from "./archive";
import { createMountainFetch } from "./app";
import { BunCommandRunner } from "./command";
import { loadCmuxSocketEnv, runningInsideCmux } from "./cmux-auth";
import { HubState, loadProgramHints } from "./state";
import { JsonProgramAliasStore } from "./program-aliases";
import { JsonSettingsStore } from "./settings";
import { JsonTriageQueueStore, NativeLunaInvestigationRunner } from "./triage";

const PROJECT_ROOT = join(import.meta.dir, "../..");
loadCmuxSocketEnv(PROJECT_ROOT);
const HOSTNAME = "127.0.0.1";
const configuredPort = Number(process.env.MOUNTAIN_PORT ?? 4_701);
if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65_535) {
  throw new Error("MOUNTAIN_PORT must be an integer between 1 and 65535");
}

const runner = new BunCommandRunner();
const archiveStore = await JsonArchiveStore.open(join(PROJECT_ROOT, "data/archive.json"));
const triageStore = await JsonTriageQueueStore.open(join(PROJECT_ROOT, "data/triage-queue.json"));
const programAliasStore = await JsonProgramAliasStore.open(join(PROJECT_ROOT, "data/program-aliases.json"));
const settingsStore = await JsonSettingsStore.open(join(PROJECT_ROOT, "data/settings.json"));
const triageRunner = new NativeLunaInvestigationRunner(PROJECT_ROOT, join(PROJECT_ROOT, "data/investigations"));
const programHints = await loadProgramHints(join(PROJECT_ROOT, "config/programs.json"));
const state = new HubState(
  runner,
  archiveStore,
  programHints,
  undefined,
  () => settingsStore.get(),
  () => triageStore.list(),
);
await state.refresh({ cmux: true });

const mountainFetch = createMountainFetch({
  state,
  runner,
  archiveStore,
  triageStore,
  triageRunner,
  programAliasStore,
  settingsStore,
  webRoot: join(PROJECT_ROOT, "src/web"),
});
const server = Bun.serve({
  hostname: HOSTNAME,
  port: configuredPort,
  fetch: mountainFetch,
});

let refreshNumber = 0;
const refreshTimer = setInterval(() => {
  refreshNumber += 1;
  void state.refresh({ cmux: refreshNumber % 5 === 0 });
}, 4_000);

let stopping = false;
function stop(): void {
  if (stopping) return;
  stopping = true;
  clearInterval(refreshTimer);
  mountainFetch.dispose();
  server.stop();
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

const cmuxLane = runningInsideCmux()
  ? "inside cmux"
  : process.env.CMUX_SOCKET_PASSWORD?.trim()
    ? "password mode"
    : "no cmux auth (titles/controls may stay offline)";
console.log(`The Ant Hill: http://${HOSTNAME}:${server.port} · ${cmuxLane}`);
