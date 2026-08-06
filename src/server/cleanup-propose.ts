import { join } from "node:path";
import type { CleanupNotificationView } from "../../scripts/anthill-cleanup-sweep";

const DEFAULT_CLEANUP_MAIN = "main";

export type CleanupProposer = () => Promise<CleanupNotificationView>;

export interface CleanupWorkerRequest {
  repoRoot: string;
  outPath: string;
  mainRef: string;
}

export type CleanupWorkerResult =
  | { ok: true; plan: CleanupNotificationView }
  | { ok: false; code: string; message: string };

export class CleanupProposeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CleanupProposeError";
  }
}

export function cleanupPlanPath(repoRoot: string): string {
  return join(repoRoot, ".anthill", "cleanup-plan.json");
}

export function createWorkerCleanupProposer(
  repoRoot: string,
  outPath: string = cleanupPlanPath(repoRoot),
  mainRef: string = DEFAULT_CLEANUP_MAIN,
): CleanupProposer {
  return () => new Promise<CleanupNotificationView>((resolve, reject) => {
    const worker = new Worker(new URL("./cleanup-propose-worker.ts", import.meta.url).href, {
      type: "module",
    });
    const finish = (result: CleanupWorkerResult): void => {
      worker.terminate();
      if (result.ok) resolve(result.plan);
      else reject(new CleanupProposeError(result.code, result.message));
    };
    worker.onmessage = (event: MessageEvent<CleanupWorkerResult>) => finish(event.data);
    worker.onerror = (event: ErrorEvent) => {
      worker.terminate();
      reject(new CleanupProposeError("CLEANUP_PROPOSE_FAILED", event.message || "Cleanup worker failed."));
    };
    worker.postMessage({ repoRoot, outPath, mainRef } satisfies CleanupWorkerRequest);
  });
}
