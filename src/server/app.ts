import { stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import type { HubSnapshot } from "../shared/types";
import { handleBroadcastRequest } from "./broadcast";
import { handleControlRequest } from "./http";
import { handleProgramAliasRequest, type ProgramAliasStore } from "./program-aliases";
import { snapshotFingerprint } from "./snapshot";
import { handleTriageRequest, MemoryTriageQueueStore, type TriageInvestigationRunner, type TriageQueueStore } from "./triage";
import type { ArchiveStore, CommandRunner } from "./types";

export interface MountainAppState {
  get(): HubSnapshot;
  subscribe(listener: (snapshot: HubSnapshot) => void): () => void;
  refresh(options?: { cmux?: boolean }): Promise<HubSnapshot>;
}

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ts": "text/javascript; charset=utf-8",
};

const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

export interface MountainAppDependencies {
  state: MountainAppState;
  runner: CommandRunner;
  archiveStore: ArchiveStore;
  triageStore?: TriageQueueStore;
  triageRunner?: TriageInvestigationRunner;
  programAliasStore?: ProgramAliasStore;
  webRoot: string;
}

export interface MountainFetch {
  (request: Request): Promise<Response>;
  dispose(): void;
}

export function createMountainFetch(dependencies: MountainAppDependencies): MountainFetch {
  const triageStore = dependencies.triageStore ?? new MemoryTriageQueueStore();
  const clients = new Set<ReadableStreamDefaultController<string>>();
  const heartbeatTimers = new Map<ReadableStreamDefaultController<string>, ReturnType<typeof setInterval>>();
  const removeClient = (client: ReadableStreamDefaultController<string>): void => {
    clients.delete(client);
    const timer = heartbeatTimers.get(client);
    if (timer) clearInterval(timer);
    heartbeatTimers.delete(client);
  };
  let fingerprint = snapshotFingerprint(dependencies.state.get());
  let disposed = false;
  const unsubscribe = dependencies.state.subscribe((snapshot) => {
    const nextFingerprint = snapshotFingerprint(snapshot);
    if (nextFingerprint === fingerprint) return;
    fingerprint = nextFingerprint;
    const event = `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`;
    for (const client of clients) {
      try {
        client.enqueue(event);
      } catch {
        removeClient(client);
      }
    }
  });

  const fetch = (async (request: Request): Promise<Response> => {
    if (disposed) return new Response("Server is shutting down", { status: 503, headers: SECURITY_HEADERS });
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/snapshot") {
      return Response.json(dependencies.state.get(), {
        headers: { ...SECURITY_HEADERS, "cache-control": "no-store" },
      });
    }
    if (request.method === "GET" && url.pathname === "/api/events") {
      let client: ReadableStreamDefaultController<string> | undefined;
      const stream = new ReadableStream<string>({
        start(controller) {
          client = controller;
          clients.add(controller);
          controller.enqueue(`event: snapshot\ndata: ${JSON.stringify(dependencies.state.get())}\n\n`);
          heartbeatTimers.set(
            controller,
            setInterval(() => {
              try {
                controller.enqueue(`event: heartbeat\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);
              } catch {
                removeClient(controller);
              }
            }, 25_000),
          );
        },
        cancel() {
          if (client) removeClient(client);
        },
      });
      return new Response(stream, {
        headers: {
          ...SECURITY_HEADERS,
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "content-type": "text/event-stream; charset=utf-8",
        },
      });
    }
    if (url.pathname === "/api/control") {
      return handleControlRequest(request, {
        getSnapshot: () => dependencies.state.get(),
        runner: dependencies.runner,
        archiveStore: dependencies.archiveStore,
        afterControl: async () => {
          await dependencies.state.refresh();
        },
      });
    }
    if (url.pathname === "/api/broadcast") {
      return handleBroadcastRequest(request, {
        getSnapshot: () => dependencies.state.get(),
        runner: dependencies.runner,
        archiveStore: dependencies.archiveStore,
        afterControl: async () => { await dependencies.state.refresh(); },
      });
    }
    if (url.pathname === "/api/program-aliases") {
      if (!dependencies.programAliasStore) return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
      return handleProgramAliasRequest(request, dependencies.state.get(), dependencies.programAliasStore);
    }
    if (["/api/triage/generate", "/api/triage/queue", "/api/triage/run"].includes(url.pathname)) {
      return handleTriageRequest(request, dependencies.state.get(), triageStore, dependencies.triageRunner);
    }
    if (url.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: SECURITY_HEADERS });
    }
    return serveStatic(url.pathname, dependencies.webRoot, request.method === "HEAD");
  }) as MountainFetch;

  fetch.dispose = (): void => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    for (const client of [...clients]) {
      removeClient(client);
      try {
        client.close();
      } catch {
        // A disconnected client may already have closed its stream.
      }
    }
  };
  return fetch;
}

async function serveStatic(pathname: string, webRoot: string, headOnly: boolean): Promise<Response> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  } catch {
    return new Response("Bad path", { status: 400, headers: SECURITY_HEADERS });
  }
  const root = resolve(webRoot);
  const path = resolve(root, `.${decoded}`);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
  }
  try {
    const details = await stat(path);
    if (!details.isFile()) throw new Error("not a file");
  } catch {
    return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
  }
  return new Response(headOnly ? null : Bun.file(path), {
    headers: {
      ...SECURITY_HEADERS,
      "cache-control": extname(path) === ".html" ? "no-cache" : "public, max-age=60",
      "content-type": CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
    },
  });
}

export function emptySnapshot(): HubSnapshot {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    generatedAt: now,
    controlHealth: { cmuxReachable: false, lastCheckedAt: now, errors: [], staleSources: [] },
    totals: {
      live: 0,
      tracked: 0,
      attention: 0,
      working: 0,
      idle: 0,
      ended: 0,
      needsYou: 0,
      history: 0,
      tokenReporting: 0,
      tokenEligible: 0,
      sourceHealth: { healthy: 0, degraded: 4, total: 4 },
    },
    issues: [],
    programs: [],
  };
}
