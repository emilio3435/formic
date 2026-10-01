import { composerModelForSession } from "./cursor-composer-model";
import { foreignSqliteFailureMessage, readForeignSqlite } from "./foreign-sqlite";
import {
  cursorComposerDataFailure,
  type CursorComposerDataRead,
  type CursorComposerDataRequest,
} from "./cursor-composer-read";

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<CursorComposerDataRequest>) => void) | null;
  postMessage(message: CursorComposerDataRead): void;
};

const IMPACT = "Cursor session models from composerData could not be enumerated for this scan";

scope.onmessage = (event): void => {
  void readRequested(event.data).then(
    (message) => scope.postMessage(message),
    (error: unknown) => {
      scope.postMessage({
        ok: false,
        message: `cursor composerData: ${foreignSqliteFailureMessage(error, IMPACT)}`,
        entries: [],
        absent: [],
      });
    },
  );
};

async function readRequested(request: CursorComposerDataRequest): Promise<CursorComposerDataRead> {
  if (request.delayMs !== undefined && request.delayMs > 0) await Bun.sleep(request.delayMs);
  const deadline = Date.now() + request.budgetMs;
  const entries: CursorComposerDataRead["entries"] = [];
  const absent: string[] = [];
  const finished = readForeignSqlite(request.path, (database) => {
    try {
      database.exec("PRAGMA busy_timeout = 200");
    } catch {
      // Read-only connections may reject the pragma. The default busy timeout
      // is already zero, so a lock miss still returns instead of waiting.
    }
    for (const sessionId of request.sessionIds) {
      if (Date.now() >= deadline) return false;
      const row = database
        .query("select value from cursorDiskKV where key = ?")
        .get(`composerData:${sessionId}`) as { value?: string | Uint8Array | null } | null;
      const value = row?.value;
      if (value === undefined || value === null) {
        absent.push(sessionId);
        continue;
      }
      try {
        const evidence = composerModelForSession(value, sessionId);
        entries.push({ id: sessionId, model: evidence.model, effort: evidence.effort });
      } catch (error) {
        entries.push({
          id: sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return true;
  });
  if (!finished) {
    return {
      ok: false,
      message: cursorComposerDataFailure(`read exceeded ${request.budgetMs}ms`),
      entries,
      absent,
    };
  }
  return { ok: true, entries, absent };
}
