import { join } from "node:path";
import { JsonAckStore } from "./ack";
import { JsonArchiveStore } from "./archive";
import { createAgentLinkFetch } from "./agent-links";
import { createMountainFetch } from "./app";
import { createWorkerCleanupProposer } from "./cleanup-propose";
import { createNativeCleanupLauncher } from "./cleanup-launch";
import { BunCommandRunner } from "./command";
import { loadCmuxSocketEnv, runningInsideCmux } from "./cmux-auth";
import { runtimeCmuxExecutable } from "./cmux";
import { JsonIdentityBindingStore } from "./identity-bindings";
import { HubState, loadProgramHints } from "./state";
import { JsonProcessWitnessStore } from "./process-witness";
import { JsonSessionNameStore } from "./session-names";
import { JsonProgramAliasStore } from "./program-aliases";
import { JsonCollectorInstanceStore } from "./collector-instances";
import { archiveLimits, JsonSettingsStore } from "./settings";
import { JsonTriageQueueStore, NativeLunaInvestigationRunner } from "./triage";

const PROJECT_ROOT = join(import.meta.dir, "../..");
loadCmuxSocketEnv(PROJECT_ROOT);
const HOSTNAME = "127.0.0.1";
const PRODUCTION_PORT = 4_701;
const configuredPort = Number(process.env.MOUNTAIN_PORT ?? PRODUCTION_PORT);
if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65_535) {
  throw new Error("MOUNTAIN_PORT must be an integer between 1 and 65535");
}

const runner = new BunCommandRunner();
const cmuxExecutable = runtimeCmuxExecutable();
/* Settings open FIRST: the archive reads its retention window and record cap
   through a reader rather than from constants, so an operator lowering either
   takes effect on the next commit instead of at the next restart. */
const settingsStore = await JsonSettingsStore.open(join(PROJECT_ROOT, "data/settings.json"));
const collectorInstanceStore = await JsonCollectorInstanceStore.open(
  join(PROJECT_ROOT, "data/collector-instances.json"),
);
const archiveStore = await JsonArchiveStore.open(
  join(PROJECT_ROOT, "data/archive.json"),
  undefined,
  undefined,
  () => archiveLimits(settingsStore.get()),
);
const triageStore = await JsonTriageQueueStore.open(join(PROJECT_ROOT, "data/triage-queue.json"));
const programAliasStore = await JsonProgramAliasStore.open(join(PROJECT_ROOT, "data/program-aliases.json"));
const identityBindingStore = await JsonIdentityBindingStore.open(join(PROJECT_ROOT, "data/identity-bindings.json"));
/* Process liveness the board has witnessed, kept across restarts. Without it a
   kickstart erases every observation of a running session, and sessions the
   board watched for hours become permanently unprovable. */
const processWitnessStore = await JsonProcessWitnessStore.open(join(PROJECT_ROOT, "data/process-witness.json"));
const triageRunner = new NativeLunaInvestigationRunner(PROJECT_ROOT, join(PROJECT_ROOT, "data/investigations"));
const programHints = await loadProgramHints(join(PROJECT_ROOT, "config/programs.json"));
/* Opened before the board so the very first snapshot already carries whatever
   titles a previous run wrote down. `open` never rejects — an unreadable cache
   costs the names, not the boot. */
const sessionNameStore = await JsonSessionNameStore.open();
const ackStore = await JsonAckStore.open(join(PROJECT_ROOT, "data/acks.json"));

const state = new HubState(runner, archiveStore, programHints, {
  settingsReader: () => settingsStore.get(),
  guiRootsReader: () => collectorInstanceStore.onboardedGuiRoots(),
  botRootsReader: () => collectorInstanceStore.onboardedRoots("grok-bot"),
  triageReader: () => triageStore.list(),
  cmuxExecutable,
  bindingStore: identityBindingStore,
  sessionNames: sessionNameStore,
  witnessStore: processWitnessStore,
  ackStore,
});

const mountainFetch = createMountainFetch({
  state,
  runner,
  archiveStore,
  ackStore,
  triageStore,
  triageRunner,
  programAliasStore,
  settingsStore,
  collectorInstances: collectorInstanceStore,
  cleanupProposer: createWorkerCleanupProposer(PROJECT_ROOT),
  cleanupLauncher: createNativeCleanupLauncher({
    repoRoot: PROJECT_ROOT,
    cmuxExecutable,
    runner,
    nameSession: (agentId, name) => sessionNameStore.remember(agentId, {
      name,
      by: "launch-env",
      at: new Date().toISOString(),
    }),
  }),
  cmuxExecutable,
  /* The production port is the single-writer role. Previews on 4710-4719 stay
     read-only cmux observers even though their copied settings default the
     mirror feature on. The OS also refuses a second sustained 4701 server. */
  repoGroupMirrorWriter: configuredPort === PRODUCTION_PORT,
  webRoot: join(PROJECT_ROOT, "src/web"),
});
const fetchWithAgentLinks = createAgentLinkFetch(mountainFetch, {
  getSnapshot: () => state.get(),
  surfaces: () => state.surfaces(),
  runner,
  archiveStore,
  cmuxExecutable,
});
const server = Bun.serve({
  hostname: HOSTNAME,
  port: configuredPort,
  idleTimeout: 120,
  fetch: fetchWithAgentLinks,
});
await state.refresh({ cmux: true });
state.startCmuxEvents();

let stopping = false;
let refreshNumber = 0;
const refreshTimer = setInterval(() => {
  refreshNumber += 1;
  void state.refresh({ cmux: refreshNumber % 5 === 0 }).catch((error) => {
    console.error(`[HubState] scheduled refresh failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}, 4_000);

function stop(): void {
  if (stopping) return;
  stopping = true;
  clearInterval(refreshTimer);
  state.stopCmuxEvents();
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
