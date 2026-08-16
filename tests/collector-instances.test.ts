import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { classifyDataDir, handleCollectorInstancesRequest, instanceIdFor, JsonCollectorInstanceStore, readTextCappedSync, scanAgentHomes, type ScanFs } from "../src/server/collector-instances";

function underRoot(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function memFs(root: string, extra?: Partial<ScanFs>): ScanFs {
  const { readdirSync, statSync, existsSync } = require("node:fs");
  return {
    home: () => root,
    readdir: (p) => {
      if (!underRoot(root, p)) return [];
      try { return readdirSync(p); } catch { return []; }
    },
    isDirectory: (p) => {
      if (!underRoot(root, p)) return false;
      try { return statSync(p).isDirectory(); } catch { return false; }
    },
    exists: (p) => underRoot(root, p) && existsSync(p),
    readTextCapped: (p, max) => underRoot(root, p) ? readTextCappedSync(p, max) : undefined,
    readAppIdentity: () => undefined,
    processArgv: () => [],
    ...extra,
  };
}

describe("classifyDataDir", () => {
  test("Cursor-2 GUI is cursor-gui, not a new provider", () => {
    const root = mkdtempSync(join(tmpdir(), "ah-scan-"));
    const dataDir = join(root, "Library/Application Support/Cursor-2");
    mkdirSync(join(dataDir, "User/globalStorage"), { recursive: true });
    writeFileSync(join(dataDir, "User/globalStorage/state.vscdb"), "");
    const hit = classifyDataDir(dataDir, memFs(root));
    expect(hit?.kind).toBe("cursor-gui");
    expect(hit?.provider).toBe("cursor");
    expect(hit?.default).toBe(false);
  });

  test("Grok Bot persistence is grok-bot / needs-parser", () => {
    const root = mkdtempSync(join(tmpdir(), "ah-scan-"));
    const dataDir = join(root, "Library/Application Support/Grok Bot 2");
    mkdirSync(join(dataDir, "sand-client-persistence"), { recursive: true });
    writeFileSync(join(dataDir, "sand-client-persistence/x.blob"), "");
    const hit = classifyDataDir(dataDir, memFs(root));
    expect(hit?.kind).toBe("grok-bot");
    expect(hit?.provider).toBeNull();
    expect(hit?.reason).toBe("needs-parser");
  });

  test("extra grok home is grok-cli / needs-home-list", () => {
    const root = mkdtempSync(join(tmpdir(), "ah-scan-"));
    const dataDir = join(root, ".grok-2");
    mkdirSync(join(dataDir, "sessions", "cwd", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"), { recursive: true });
    writeFileSync(join(dataDir, "sessions/cwd/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/summary.json"), "{}");
    const hit = classifyDataDir(dataDir, memFs(root));
    expect(hit?.kind).toBe("grok-cli");
    expect(hit?.provider).toBe("grok");
    expect(hit?.reason).toBe("needs-home-list");
  });

  test("codex-2 sessions classify as codex and are not default", () => {
    const root = mkdtempSync(join(tmpdir(), "ah-scan-"));
    const dataDir = join(root, ".codex-2");
    mkdirSync(join(dataDir, "sessions"), { recursive: true });
    writeFileSync(join(dataDir, "sessions/rollout-1.jsonl"), "{}\n");
    const hit = classifyDataDir(dataDir, memFs(root));
    expect(hit?.kind).toBe("codex");
    expect(hit?.provider).toBe("codex");
    expect(hit?.default).toBe(false);
  });

  test("~/.crush/sessions jsonl is unknown / needs-parser", () => {
    const root = mkdtempSync(join(tmpdir(), "ah-scan-"));
    const dataDir = join(root, ".crush");
    mkdirSync(join(dataDir, "sessions"), { recursive: true });
    writeFileSync(join(dataDir, "sessions/a.jsonl"), "{}\n");
    const hit = classifyDataDir(dataDir, memFs(root));
    expect(hit?.kind).toBe("unknown");
    expect(hit?.provider).toBeNull();
    expect(hit?.reason).toBe("needs-parser");
  });

  test("~/.cursor-2 with only extensions is not cursor-cli", () => {
    const root = mkdtempSync(join(tmpdir(), "ah-scan-"));
    const dataDir = join(root, ".cursor-2");
    mkdirSync(join(dataDir, "extensions"), { recursive: true });
    expect(classifyDataDir(dataDir, memFs(root))).toBeUndefined();
  });

  test("default ~/.grok is default: true", () => {
    const root = mkdtempSync(join(tmpdir(), "ah-scan-"));
    const dataDir = join(root, ".grok");
    mkdirSync(join(dataDir, "sessions"), { recursive: true });
    const hit = classifyDataDir(dataDir, memFs(root));
    expect(hit?.kind).toBe("grok-cli");
    expect(hit?.default).toBe(true);
    expect(hit?.reason).toBeUndefined();
  });
});

describe("scanAgentHomes", () => {
  test("finds a Cursor wrapper via --user-data-dir without a hardcoded path", () => {
    const root = mkdtempSync(join(tmpdir(), "ah-scan-"));
    const app = join(root, "Applications/Cursor Extra.app");
    mkdirSync(join(app, "Contents/MacOS"), { recursive: true });
    const dataDir = join(root, "Library/Application Support/Cursor-2");
    mkdirSync(join(dataDir, "User/globalStorage"), { recursive: true });
    writeFileSync(join(dataDir, "User/globalStorage/state.vscdb"), "");
    writeFileSync(join(app, "Contents/MacOS/launch"),
      `#!/bin/bash\nexec /Applications/Cursor.app/Contents/MacOS/Cursor --user-data-dir="${dataDir}"\n`);
    const hits = scanAgentHomes(memFs(root, {
      readAppIdentity: (p) => p.endsWith(".app") ? { name: "Cursor Extra", identifier: "com.todesktop.230313mzl4w4u92" } : undefined,
    }));
    expect(hits.some((h) => h.dataDir === dataDir && h.kind === "cursor-gui")).toBe(true);
    expect(hits.some((h) => h.dataDir.includes("Grok Bot 2.app"))).toBe(false);
  });

  test("dedups the same dataDir from app + Application Support + ps", () => {
    const root = mkdtempSync(join(tmpdir(), "ah-scan-"));
    const dataDir = join(root, "Library/Application Support/Cursor-2");
    mkdirSync(join(dataDir, "User/globalStorage"), { recursive: true });
    writeFileSync(join(dataDir, "User/globalStorage/state.vscdb"), "");
    const hits = scanAgentHomes(memFs(root, {
      processArgv: () => [`Cursor --user-data-dir=${dataDir}`],
    }));
    expect(hits.filter((h) => h.dataDir === dataDir)).toHaveLength(1);
  });

  test("does not walk Downloads or /etc", () => {
    const root = mkdtempSync(join(tmpdir(), "ah-scan-"));
    mkdirSync(join(root, "Downloads/secret"), { recursive: true });
    writeFileSync(join(root, "Downloads/secret/sessions.jsonl"), "");
    const hits = scanAgentHomes(memFs(root));
    expect(hits.some((h) => h.dataDir.includes("Downloads"))).toBe(false);
  });

  test("extracts --user-data-dir from a /Applications wrapper without reading the live disk", () => {
    const root = mkdtempSync(join(tmpdir(), "ah-scan-"));
    const dataDir = join(root, "Library/Application Support/Cursor-2");
    mkdirSync(join(dataDir, "User/globalStorage"), { recursive: true });
    writeFileSync(join(dataDir, "User/globalStorage/state.vscdb"), "");
    const appPath = "/Applications/Cursor Extra.app";
    const launch = `${appPath}/Contents/MacOS/launch`;
    const reads: string[] = [];
    const base = memFs(root);
    const hits = scanAgentHomes({
      ...base,
      readdir: (p) => {
        if (p === "/Applications") return ["Cursor Extra.app"];
        if (p === appPath) return ["Contents"];
        if (p === `${appPath}/Contents`) return ["MacOS"];
        if (p === `${appPath}/Contents/MacOS`) return ["launch"];
        return base.readdir(p);
      },
      isDirectory: (p) => {
        if (p === appPath || p === `${appPath}/Contents` || p === `${appPath}/Contents/MacOS`) return true;
        if (p === launch) return false;
        return base.isDirectory(p);
      },
      readTextCapped: (p, _max) => {
        reads.push(p);
        if (p === launch) {
          return `#!/bin/bash\nexec /Applications/Cursor.app/Contents/MacOS/Cursor --user-data-dir="${dataDir}"\n`;
        }
        return undefined;
      },
      readAppIdentity: (p) => p === appPath ? { name: "Cursor Extra", identifier: "com.todesktop.230313mzl4w4u92" } : undefined,
    });
    expect(reads.some((p) => p.startsWith("/Applications/") && p.endsWith("/launch"))).toBe(true);
    expect(hits.some((h) => h.dataDir === dataDir && h.kind === "cursor-gui")).toBe(true);
    expect(reads.some((p) => p.startsWith("/Applications/") && !p.startsWith(appPath))).toBe(false);
  });
});

describe("readTextCappedSync", () => {
  test("reads at most maxBytes from the fd", () => {
    const root = mkdtempSync(join(tmpdir(), "ah-scan-"));
    const path = join(root, "payload.bin");
    writeFileSync(path, "x".repeat(20_000));
    const text = readTextCappedSync(path, 8192);
    expect(text).toHaveLength(8192);
  });
});

describe("classify deadline", () => {
  test("expired deadline skips identity and session walks", () => {
    const root = mkdtempSync(join(tmpdir(), "ah-scan-"));
    const dataDir = join(root, ".crush");
    mkdirSync(join(dataDir, "sessions"), { recursive: true });
    writeFileSync(join(dataDir, "sessions/a.jsonl"), "{}\n");
    const listed: string[] = [];
    const base = memFs(root);
    const hit = classifyDataDir(dataDir, {
      ...base,
      readdir: (p) => {
        listed.push(p);
        return base.readdir(p);
      },
    }, Date.now() - 1);
    expect(hit).toBeUndefined();
    expect(listed.some((p) => p === "/Applications" || p.startsWith("/Applications/"))).toBe(false);
    expect(listed.some((p) => p.includes("sessions"))).toBe(false);
  });
});

describe("JsonCollectorInstanceStore", () => {
  test("empty store + scan leaves extras not onboarded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ah-store-"));
    const store = await JsonCollectorInstanceStore.open(join(dir, "collector-instances.json"));
    const merged = store.mergeScan([{
      kind: "cursor-gui", provider: "cursor", dataDir: "/tmp/Cursor-2",
      label: "Cursor-2", default: false,
    }], "2026-08-16T00:00:00.000Z");
    expect(merged[0].onboarded).toBe(false);
    expect(store.onboardedGuiRoots()).toEqual([]);
  });

  test("update onboarded persists across reopen", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ah-store-"));
    const path = join(dir, "collector-instances.json");
    const store = await JsonCollectorInstanceStore.open(path);
    store.mergeScan([{
      kind: "cursor-gui", provider: "cursor", dataDir: "/Users/me/Library/Application Support/Cursor-2",
      label: "Cursor-2", default: false,
    }], "2026-08-16T00:00:00.000Z");
    await store.update({ ids: ["cursor-gui:cursor-2"], onboarded: true });
    const again = await JsonCollectorInstanceStore.open(path);
    expect(again.get().find((i) => i.id === "cursor-gui:cursor-2")?.onboarded).toBe(true);
    expect(again.onboardedGuiRoots()).toEqual(["/Users/me/Library/Application Support/Cursor-2"]);
  });

  test("defaults cannot be turned off", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ah-store-"));
    const store = await JsonCollectorInstanceStore.open(join(dir, "collector-instances.json"));
    store.mergeScan([{
      kind: "cursor-gui", provider: "cursor",
      dataDir: "/Users/me/Library/Application Support/Cursor",
      label: "Cursor", default: true,
    }], "2026-08-16T00:00:00.000Z");
    await expect(store.update({ ids: ["cursor-gui:cursor"], onboarded: false }))
      .rejects.toThrow(/default/i);
  });

  test("corrupt file boots empty and reports loadError", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ah-store-"));
    const path = join(dir, "collector-instances.json");
    writeFileSync(path, "{nope");
    const store = await JsonCollectorInstanceStore.open(path);
    expect(store.get()).toEqual([]);
    expect(store.loadError).toContain("collector-instances.json");
  });

  test("mergeScan during update does not lose scanned ids", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ah-store-"));
    const path = join(dir, "collector-instances.json");
    let enteredWrite!: () => void;
    const writeEntered = new Promise<void>((resolve) => {
      enteredWrite = resolve;
    });
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const store = await JsonCollectorInstanceStore.open(path, {
      readText: async () => {
        const error = new Error("missing") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      },
      makeDirectory: async () => {},
      writeText: async () => {
        enteredWrite();
        await writeGate;
      },
      rename: async () => {},
    });
    store.mergeScan([{
      kind: "cursor-gui", provider: "cursor",
      dataDir: "/Users/me/Library/Application Support/Cursor-2",
      label: "Cursor-2", default: false,
    }], "2026-08-16T00:00:00.000Z");
    const updating = store.update({ ids: ["cursor-gui:cursor-2"], onboarded: true });
    await writeEntered;
    store.mergeScan([{
      kind: "codex", provider: "codex",
      dataDir: "/Users/me/.codex-2",
      label: ".codex-2", default: false,
    }], "2026-08-16T00:00:01.000Z");
    releaseWrite();
    await updating;
    const ids = store.get().map((row) => row.id);
    expect(ids).toContain("cursor-gui:cursor-2");
    expect(ids).toContain("codex:dot-codex-2");
    expect(store.get().find((row) => row.id === "cursor-gui:cursor-2")?.onboarded).toBe(true);
  });
});

describe("handleCollectorInstancesRequest", () => {
  test("GET is loopback-only", async () => {
    const store = await JsonCollectorInstanceStore.open(join(mkdtempSync(join(tmpdir(), "ah-http-")), "c.json"));
    const res = await handleCollectorInstancesRequest(
      new Request("http://example.com/api/collector-instances"),
      store,
      { scan: () => [] },
    );
    expect(res.status).toBe(403);
  });

  test("POST import selected marks extras onboarded", async () => {
    const store = await JsonCollectorInstanceStore.open(join(mkdtempSync(join(tmpdir(), "ah-http-")), "c.json"));
    store.mergeScan([{
      kind: "cursor-gui", provider: "cursor",
      dataDir: "/Users/me/Library/Application Support/Cursor-2",
      label: "Cursor-2", default: false,
    }], new Date().toISOString());
    const res = await handleCollectorInstancesRequest(
      new Request("http://127.0.0.1/api/collector-instances", {
        method: "POST",
        headers: { origin: "http://127.0.0.1", "content-type": "application/json" },
        body: JSON.stringify({ ids: ["cursor-gui:cursor-2"], onboarded: true }),
      }),
      store,
      { scan: () => [] },
    );
    expect(res.status).toBe(200);
    expect(store.onboardedGuiRoots()[0]).toContain("Cursor-2");
  });

  test("POST /etc/passwd as a new dataDir is 400", async () => {
    const store = await JsonCollectorInstanceStore.open(join(mkdtempSync(join(tmpdir(), "ah-http-")), "c.json"));
    const res = await handleCollectorInstancesRequest(
      new Request("http://127.0.0.1/api/collector-instances", {
        method: "POST",
        headers: { origin: "http://127.0.0.1", "content-type": "application/json" },
        body: JSON.stringify({ id: "unknown:passwd", dataDir: "/etc/passwd", onboarded: true }),
      }),
      store,
      { scan: () => [] },
    );
    expect(res.status).toBe(400);
  });

  test("POST missing Origin is 403", async () => {
    const store = await JsonCollectorInstanceStore.open(join(mkdtempSync(join(tmpdir(), "ah-http-")), "c.json"));
    const res = await handleCollectorInstancesRequest(
      new Request("http://127.0.0.1/api/collector-instances", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "cursor-gui:cursor-2", onboarded: true }),
      }),
      store,
      { scan: () => [] },
    );
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("ORIGIN_REJECTED");
  });

  test("POST not JSON is 415", async () => {
    const store = await JsonCollectorInstanceStore.open(join(mkdtempSync(join(tmpdir(), "ah-http-")), "c.json"));
    const res = await handleCollectorInstancesRequest(
      new Request("http://127.0.0.1/api/collector-instances", {
        method: "POST",
        headers: { origin: "http://127.0.0.1", "content-type": "text/plain" },
        body: "ids=cursor-gui:cursor-2",
      }),
      store,
      { scan: () => [] },
    );
    expect(res.status).toBe(415);
  });

  test("POST unknown id is 400 UNKNOWN_INSTANCE", async () => {
    const store = await JsonCollectorInstanceStore.open(join(mkdtempSync(join(tmpdir(), "ah-http-")), "c.json"));
    const res = await handleCollectorInstancesRequest(
      new Request("http://127.0.0.1/api/collector-instances", {
        method: "POST",
        headers: { origin: "http://127.0.0.1", "content-type": "application/json" },
        body: JSON.stringify({ id: "unknown:passwd", onboarded: true }),
      }),
      store,
      { scan: () => [] },
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("UNKNOWN_INSTANCE");
  });

  test("POST cannot turn off a default", async () => {
    const store = await JsonCollectorInstanceStore.open(join(mkdtempSync(join(tmpdir(), "ah-http-")), "c.json"));
    store.mergeScan([{
      kind: "cursor-gui", provider: "cursor",
      dataDir: "/Users/me/Library/Application Support/Cursor",
      label: "Cursor", default: true,
    }], new Date().toISOString());
    const res = await handleCollectorInstancesRequest(
      new Request("http://127.0.0.1/api/collector-instances", {
        method: "POST",
        headers: { origin: "http://127.0.0.1", "content-type": "application/json" },
        body: JSON.stringify({ id: "cursor-gui:cursor", onboarded: false }),
      }),
      store,
      { scan: () => [] },
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("DEFAULT_LOCKED");
  });

  test("GET persists last-seen so POST ids survive reopen", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ah-http-"));
    const path = join(dir, "c.json");
    const store = await JsonCollectorInstanceStore.open(path);
    const res = await handleCollectorInstancesRequest(
      new Request("http://127.0.0.1/api/collector-instances"),
      store,
      {
        scan: () => [{
          kind: "cursor-gui",
          provider: "cursor",
          dataDir: "/Users/me/Library/Application Support/Cursor-2",
          label: "Cursor-2",
          default: false,
        }],
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; instances: { id: string; onboarded: boolean }[] };
    expect(body.ok).toBe(true);
    expect(body.instances[0]?.id).toBe("cursor-gui:cursor-2");
    expect(body.instances[0]?.onboarded).toBe(false);
    const again = await JsonCollectorInstanceStore.open(path);
    expect(again.get().find((row) => row.id === "cursor-gui:cursor-2")).toBeDefined();
    expect(again.get()[0]?.onboarded).toBe(false);
  });
});
