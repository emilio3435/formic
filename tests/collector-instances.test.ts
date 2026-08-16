import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { classifyDataDir, instanceIdFor, scanAgentHomes, type ScanFs } from "../src/server/collector-instances";

function memFs(root: string, extra?: Partial<ScanFs>): ScanFs {
  const { readdirSync, statSync, existsSync, readFileSync } = require("node:fs");
  return {
    home: () => root,
    readdir: (p) => { try { return readdirSync(p); } catch { return []; } },
    isDirectory: (p) => { try { return statSync(p).isDirectory(); } catch { return false; } },
    exists: (p) => existsSync(p),
    readTextCapped: (p, max) => {
      try { return readFileSync(p, "utf8").slice(0, max); } catch { return undefined; }
    },
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
});
