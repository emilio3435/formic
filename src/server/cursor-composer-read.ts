import { foreignSqliteFailureMessage } from "./foreign-sqlite";

export const COMPOSER_DATA_READ_BUDGET_MS = 2_000;
const COMPOSER_DATA_READ_GRACE_MS = 250;
const IMPACT = "Cursor session models from composerData could not be enumerated for this scan";

export interface CursorComposerDataEntry {
  id: string;
  model?: string;
  effort?: string;
  error?: string;
}

export interface CursorComposerDataRequest {
  path: string;
  sessionIds: string[];
  budgetMs: number;
  delayMs?: number;
}

export interface CursorComposerDataRead {
  ok: boolean;
  message?: string;
  entries: CursorComposerDataEntry[];
  absent: string[];
}

interface CursorComposerReadOverride {
  budgetMs?: number;
  delayMs?: number;
}

let cursorComposerReadOverride: CursorComposerReadOverride | undefined;

export function setCursorComposerReadTestOverride(
  override: CursorComposerReadOverride | undefined,
): void {
  cursorComposerReadOverride = override;
}

export function cursorComposerDataFailure(detail: string): string {
  return `cursor composerData: ${detail}; ${IMPACT}.`;
}

function emptyFailure(detail: string): CursorComposerDataRead {
  return { ok: false, message: cursorComposerDataFailure(detail), entries: [], absent: [] };
}

/* The value read used to be `select key, value from cursorDiskKV where key like
   'composerData:%'` followed by `.all()` on the Bun thread. That statement has
   no row cap, and a synchronous sqlite step does not return to the event loop,
   so a miss that never comes back freezes every timer on the process —
   including the provider deadline that is supposed to degrade Cursor.
   Point lookups for the sessions in this scan run on a worker. When the worker
   misses the budget, terminate it and report the provider degraded. */
export async function readCursorComposerData(
  path: string,
  sessionIds: readonly string[],
): Promise<CursorComposerDataRead> {
  if (sessionIds.length === 0) return { ok: true, entries: [], absent: [] };
  const budgetMs = cursorComposerReadOverride?.budgetMs ?? COMPOSER_DATA_READ_BUDGET_MS;
  const delayMs = cursorComposerReadOverride?.delayMs;
  let worker: Worker;
  try {
    worker = new Worker(new URL("./cursor-composer-worker.ts", import.meta.url).href, {
      type: "module",
    });
  } catch (error) {
    return emptyFailure(error instanceof Error ? error.message : String(error));
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  try {
    return await new Promise((resolve) => {
      const finish = (result: CursorComposerDataRead): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(result);
      };
      timer = setTimeout(() => {
        finish(emptyFailure(`read exceeded ${budgetMs}ms`));
        worker.terminate();
      }, budgetMs + COMPOSER_DATA_READ_GRACE_MS);
      worker.onmessage = (event: MessageEvent<CursorComposerDataRead>) => {
        const data = event.data;
        if (!data || typeof data.ok !== "boolean" || !Array.isArray(data.entries) || !Array.isArray(data.absent)) {
          finish(emptyFailure("composerData reader returned nothing"));
          return;
        }
        finish(data);
      };
      worker.onerror = (event: ErrorEvent) => {
        finish(emptyFailure(event.message || "composerData reader failed"));
      };
      const request: CursorComposerDataRequest = {
        path,
        sessionIds: [...sessionIds],
        budgetMs,
        ...(delayMs !== undefined && delayMs > 0 ? { delayMs } : {}),
      };
      worker.postMessage(request);
    });
  } catch (error) {
    return {
      ok: false,
      message: `cursor composerData: ${foreignSqliteFailureMessage(error, IMPACT)}`,
      entries: [],
      absent: [],
    };
  } finally {
    worker.terminate();
  }
}
