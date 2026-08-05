import { describe, expect, test } from "bun:test";
import {
  archiveLimits,
  clampScanWindowHours,
  clampSetting,
  DEFAULT_VIEW,
  handleSettingsRequest,
  JsonSettingsStore,
  lifecycleThresholds,
  NUMERIC_SETTING_KEYS,
  NUMERIC_SETTINGS,
  normalizeSettings,
  SETTINGS_VERSION,
} from "../src/server/settings";

function memoryFiles() {
  const files = new Map<string, string>();
  return {
    files,
    ops: {
      readText: async (path: string) => {
        if (!files.has(path)) {
          const error = new Error("missing") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        }
        return files.get(path)!;
      },
      makeDirectory: async () => {},
      writeText: async (path: string, contents: string) => {
        files.set(path, contents);
      },
      rename: async (from: string, to: string) => {
        files.set(to, files.get(from)!);
        files.delete(from);
      },
    },
  };
}

function post(body: unknown) {
  return new Request("http://127.0.0.1:4701/api/settings", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:4701", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

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
    expect(normalizeSettings(undefined).scanWindowHours).toBe(36);
    expect(normalizeSettings({ scanWindowHours: 12 }).scanWindowHours).toBe(12);
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

describe("settings v2: every tunable number validates at both edges", () => {
  /* Written as a sweep over the spec table rather than as one test per key,
     because the failure this guards against is a key added to the schema and
     forgotten by the validator — which a hand-written list reproduces exactly. */
  test("each key accepts its minimum and maximum and rejects one step outside", () => {
    for (const key of NUMERIC_SETTING_KEYS) {
      const spec = NUMERIC_SETTINGS[key];
      expect(clampSetting(key, spec.min), `${key} rejected its own minimum`).toBe(spec.min);
      expect(clampSetting(key, spec.max), `${key} rejected its own maximum`).toBe(spec.max);
      expect(clampSetting(key, spec.min - 1), `${key} accepted below its minimum`).toBeNull();
      expect(clampSetting(key, spec.max + 1), `${key} accepted above its maximum`).toBeNull();
      expect(clampSetting(key, "not a number"), `${key} accepted a non-number`).toBeNull();
      expect(clampSetting(key, String(spec.default)), `${key} rejected a numeric string`).toBe(spec.default);
    }
  });

  test("the defaults are the numbers the board shipped with", () => {
    const settings = normalizeSettings(undefined);
    expect(settings).toEqual({
      version: SETTINGS_VERSION,
      activityFreshMinutes: 3,
      activityQuietMinutes: 45,
      stalledActiveMinutes: 30,
      scanWindowHours: 36,
      historyRetentionDays: 30,
      historyRecordLimit: 5000,
      defaultView: DEFAULT_VIEW,
    });
  });

  test("the derived units the rest of the server consumes come out of those numbers", () => {
    const settings = normalizeSettings({
      activityFreshMinutes: 2,
      activityQuietMinutes: 15,
      stalledActiveMinutes: 60,
      historyRetentionDays: 7,
      historyRecordLimit: 100,
    });
    expect(lifecycleThresholds(settings)).toEqual({ freshMs: 2 * 60_000, quietMs: 15 * 60_000 });
    expect(archiveLimits(settings)).toEqual({ retentionMs: 7 * 86_400_000, recordLimit: 100 });
    expect(settings.stalledActiveMinutes).toBe(60);
  });

  test("an out-of-range value falls back to that key's default, not to the whole file's", () => {
    const settings = normalizeSettings({ scanWindowHours: 12, historyRetentionDays: 9_000 });
    expect(settings.scanWindowHours).toBe(12);
    expect(settings.historyRetentionDays).toBe(30);
  });

  test("an unknown default view falls back rather than serving a tab that does not exist", () => {
    expect(normalizeSettings({ defaultView: "working" }).defaultView).toBe(DEFAULT_VIEW);
    expect(normalizeSettings({ defaultView: "waiting" }).defaultView).toBe("waiting");
  });

  /* Both values can be individually legal and jointly incoherent: fresh 20 and
     quiet 10 deletes the Waiting band, sending a session from Working straight
     to Unverified. */
  test("a quiet threshold at or below freshness is repaired on load and refused on write", async () => {
    expect(normalizeSettings({ activityFreshMinutes: 20, activityQuietMinutes: 10 }).activityQuietMinutes).toBe(45);
    expect(normalizeSettings({ activityFreshMinutes: 10, activityQuietMinutes: 10 }).activityQuietMinutes).toBe(45);

    const store = await JsonSettingsStore.open("/tmp/anthill-v2-pair.json", memoryFiles().ops);
    const rejected = await handleSettingsRequest(post({ activityFreshMinutes: 20, activityQuietMinutes: 10 }), store);
    expect(rejected.status).toBe(400);
    expect(store.get().activityQuietMinutes).toBe(45);
  });

  test("raising freshness past a previously-saved quiet threshold is refused, not silently applied", async () => {
    const store = await JsonSettingsStore.open("/tmp/anthill-v2-pair2.json", memoryFiles().ops);
    expect((await handleSettingsRequest(post({ activityQuietMinutes: 5 }), store)).status).toBe(200);
    // Freshness alone is in range; the PAIR is what breaks, so the merged result is what is checked.
    const rejected = await handleSettingsRequest(post({ activityFreshMinutes: 10 }), store);
    expect(rejected.status).toBe(400);
    expect(store.get().activityFreshMinutes).toBe(3);
  });
});

describe("settings v2: a v1 file keeps the one decision it recorded", () => {
  test("a version-less file migrates, preserving the operator's scan window", async () => {
    const { files, ops } = memoryFiles();
    files.set("/tmp/anthill-v1.json", JSON.stringify({ scanWindowHours: 72 }));
    const store = await JsonSettingsStore.open("/tmp/anthill-v1.json", ops);

    expect(store.loadError).toBeUndefined();
    expect(store.get().scanWindowHours).toBe(72);
    expect(store.get().version).toBe(SETTINGS_VERSION);
    expect(store.get().activityQuietMinutes).toBe(45);
  });

  test("a v1 file whose one setting was out of range falls back without discarding the rest", async () => {
    const { files, ops } = memoryFiles();
    files.set("/tmp/anthill-v1-bad.json", JSON.stringify({ scanWindowHours: 5_000 }));
    const store = await JsonSettingsStore.open("/tmp/anthill-v1-bad.json", ops);
    expect(store.get().scanWindowHours).toBe(36);
    expect(store.get().activityFreshMinutes).toBe(3);
  });

  test("keys the schema does not know are dropped on load rather than persisted forever", async () => {
    const { files, ops } = memoryFiles();
    files.set("/tmp/anthill-v1-extra.json", JSON.stringify({ scanWindowHours: 24, mysteryKnob: 11 }));
    const store = await JsonSettingsStore.open("/tmp/anthill-v1-extra.json", ops);
    expect(store.get()).not.toHaveProperty("mysteryKnob");
    expect(store.get().scanWindowHours).toBe(24);
  });

  /* The revert story for this slice: a v2 file must still parse if the code is
     rolled back to v1, which reads only scanWindowHours and ignores the rest. */
  test("a written v2 file still yields the right scan window when read as v1", async () => {
    const { files, ops } = memoryFiles();
    const store = await JsonSettingsStore.open("/tmp/anthill-v2-roundtrip.json", ops);
    await store.update({ scanWindowHours: 48, activityQuietMinutes: 90 });
    const written = JSON.parse([...files.values()].at(-1)!) as Record<string, unknown>;
    expect(written.scanWindowHours).toBe(48);
    expect(written.activityQuietMinutes).toBe(90);
    expect(written.version).toBe(SETTINGS_VERSION);
  });
});

describe("settings v2: the API accepts subsets and names what it refused", () => {
  test("a POST may carry any subset of the schema", async () => {
    const store = await JsonSettingsStore.open("/tmp/anthill-v2-subset.json", memoryFiles().ops);
    const response = await handleSettingsRequest(post({ activityFreshMinutes: 5, defaultView: "now" }), store);
    expect(response.status).toBe(200);
    expect(store.get().activityFreshMinutes).toBe(5);
    expect(store.get().defaultView).toBe("now");
    // Untouched keys keep their values rather than resetting to defaults.
    expect(store.get().scanWindowHours).toBe(36);
  });

  test("an unknown key is refused by name instead of being silently ignored", async () => {
    const store = await JsonSettingsStore.open("/tmp/anthill-v2-unknown.json", memoryFiles().ops);
    const response = await handleSettingsRequest(post({ evidenceMeansEnded: true }), store);
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain("evidenceMeansEnded");
  });

  test("an empty body is refused, so a no-op POST cannot read as a saved change", async () => {
    const store = await JsonSettingsStore.open("/tmp/anthill-v2-empty.json", memoryFiles().ops);
    expect((await handleSettingsRequest(post({}), store)).status).toBe(400);
  });

  test("a GET response can be posted straight back", async () => {
    /* The round-trip a settings panel actually performs. `version` rides along
       in the payload and must not be mistaken for an unknown key. */
    const store = await JsonSettingsStore.open("/tmp/anthill-v2-roundtrip2.json", memoryFiles().ops);
    const got = await handleSettingsRequest(
      new Request("http://127.0.0.1:4701/api/settings"),
      store,
    );
    const { settings } = await got.json() as { settings: Record<string, unknown> };
    expect((await handleSettingsRequest(post(settings), store)).status).toBe(200);
  });

  test("the scan window alias the client still reads is unchanged", async () => {
    const store = await JsonSettingsStore.open("/tmp/anthill-v2-alias.json", memoryFiles().ops);
    const response = await handleSettingsRequest(new Request("http://127.0.0.1:4701/api/settings"), store);
    const body = await response.json() as { scanWindowHours: number; lookbackHours: number };
    expect(body.lookbackHours).toBe(body.scanWindowHours);
  });
});
