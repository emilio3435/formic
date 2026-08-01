import { describe, expect, test } from "bun:test";
import {
  clampScanWindowHours,
  handleSettingsRequest,
  JsonSettingsStore,
  normalizeSettings,
} from "../src/server/settings";

describe("scan window settings", () => {
  test("clamps to 1–168 hours", () => {
    expect(clampScanWindowHours(0)).toBeNull();
    expect(clampScanWindowHours(1)).toBe(1);
    expect(clampScanWindowHours(36.4)).toBe(36);
    expect(clampScanWindowHours(168)).toBe(168);
    expect(clampScanWindowHours(169)).toBeNull();
    expect(clampScanWindowHours("24")).toBe(24);
    expect(clampScanWindowHours("nope")).toBeNull();
  });

  test("normalizeSettings defaults to 36h", () => {
    expect(normalizeSettings(undefined)).toEqual({ scanWindowHours: 36 });
    expect(normalizeSettings({ scanWindowHours: 12 })).toEqual({ scanWindowHours: 12 });
  });

  test("JsonSettingsStore persists updates", async () => {
    const files = new Map<string, string>();
    const store = await JsonSettingsStore.open("/tmp/anthill-settings.json", {
      readText: async (path) => {
        if (!files.has(path)) {
          const error = new Error("missing") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        }
        return files.get(path)!;
      },
      makeDirectory: async () => {},
      writeText: async (path, contents) => {
        files.set(path, contents);
      },
      rename: async (from, to) => {
        files.set(to, files.get(from)!);
        files.delete(from);
      },
    });
    expect(store.get().scanWindowHours).toBe(36);
    await store.update({ scanWindowHours: 6 });
    expect(store.get().scanWindowHours).toBe(6);
    expect(JSON.parse([...files.values()].at(-1)!).scanWindowHours).toBe(6);
  });

  /* Defaults standing in for settings we could not read is a different fact
     from defaults because none were ever saved, and only the first one means
     the operator's configured window has quietly stopped being honoured. Both
     used to produce the identical store with nothing recorded. */
  test("an unreadable settings file is reported while defaults keep the hub booting", async () => {
    const store = await JsonSettingsStore.open("/tmp/anthill-corrupt-settings.json", {
      readText: async () => "{ this is not json",
      makeDirectory: async () => {},
      writeText: async () => {},
      rename: async () => {},
    });

    // The hub still boots on defaults — refusing to start would be worse.
    expect(store.get().scanWindowHours).toBe(36);
    // But the substitution is on the record, naming the file and the fallback.
    expect(store.loadError ?? "").toContain("anthill-corrupt-settings.json");
    expect(store.loadError ?? "").toContain("36");
  });

  test("settings that were never saved are not reported as a failure", async () => {
    const store = await JsonSettingsStore.open("/tmp/anthill-absent-settings.json", {
      readText: async () => {
        const error = new Error("missing") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      },
      makeDirectory: async () => {},
      writeText: async () => {},
      rename: async () => {},
    });

    expect(store.get().scanWindowHours).toBe(36);
    // ENOENT is the normal state before an operator saves anything.
    expect(store.loadError).toBeUndefined();
  });

  test("POST /api/settings rejects cross-origin", async () => {
    const store = await JsonSettingsStore.open("/tmp/unused-settings.json", {
      readText: async () => {
        const error = new Error("missing") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      },
      makeDirectory: async () => {},
      writeText: async () => {},
      rename: async () => {},
    });
    const rejected = await handleSettingsRequest(
      new Request("http://127.0.0.1:4701/api/settings", {
        method: "POST",
        headers: { origin: "http://evil.example", "content-type": "application/json" },
        body: JSON.stringify({ scanWindowHours: 12 }),
      }),
      store,
    );
    expect(rejected.status).toBe(403);

    const accepted = await handleSettingsRequest(
      new Request("http://127.0.0.1:4701/api/settings", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:4701", "content-type": "application/json" },
        body: JSON.stringify({ scanWindowHours: 12 }),
      }),
      store,
    );
    expect(accepted.status).toBe(200);
    const body = await accepted.json() as { scanWindowHours: number };
    expect(body.scanWindowHours).toBe(12);
  });
});
