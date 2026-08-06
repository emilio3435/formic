import {
  enumerateCleanup,
  notificationViewFromPlan,
  writePlan,
} from "../../scripts/anthill-cleanup-sweep";
import {
  type CleanupWorkerRequest,
  type CleanupWorkerResult,
} from "./cleanup-propose";

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<CleanupWorkerRequest>) => void) | null;
  postMessage(message: CleanupWorkerResult): void;
};

scope.onmessage = (event): void => {
  try {
    const plan = enumerateCleanup(event.data.repoRoot, undefined, event.data.mainRef);
    const written = writePlan(plan, event.data.outPath);
    scope.postMessage({
      ok: true,
      plan: notificationViewFromPlan(written, written.planPath ?? event.data.outPath),
    });
  } catch (error) {
    const candidate = error as { code?: unknown; message?: unknown };
    scope.postMessage({
      ok: false,
      code: typeof candidate.code === "string" ? candidate.code : "CLEANUP_PROPOSE_FAILED",
      message: typeof candidate.message === "string" ? candidate.message : String(error),
    });
  }
};
