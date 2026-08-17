import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, spyOn, test } from "bun:test";
import { JsonAlertSinceStore, MemoryAlertSinceStore } from "../src/server/alert-since";

describe("A3 MemoryAlertSinceStore", () => {
  test("A3.1 first see stamps now; same fingerprint keeps it", async () => {
    let now = Date.parse("2026-08-16T12:00:00.000Z");
    const store = new MemoryAlertSinceStore(() => now);
    await store.observe(new Map([["a", "hook:needsInput:hook-input"]]));
    expect(store.get("a")).toBe("2026-08-16T12:00:00.000Z");
    now = Date.parse("2026-08-16T12:05:00.000Z");
    await store.observe(new Map([["a", "hook:needsInput:hook-input"]]));
    expect(store.get("a")).toBe("2026-08-16T12:00:00.000Z");
  });

  test("A3.2 fingerprint change advances firstSeenAt", async () => {
    let now = Date.parse("2026-08-16T12:00:00.000Z");
    const store = new MemoryAlertSinceStore(() => now);
    await store.observe(new Map([["a", "hook:needsInput:hook-input"]]));
    now = Date.parse("2026-08-16T12:10:00.000Z");
    await store.observe(new Map([["a", "signal:question-pending:abc"]]));
    expect(store.get("a")).toBe("2026-08-16T12:10:00.000Z");
  });

  test("A3.3 dropped alerts leave the store", async () => {
    const store = new MemoryAlertSinceStore(() => Date.parse("2026-08-16T12:00:00.000Z"));
    await store.observe(new Map([
      ["a", "hook:needsInput:hook-input"],
      ["b", "outcome:failed"],
    ]));
    await store.observe(new Map([["a", "hook:needsInput:hook-input"]]));
    expect(store.get("b")).toBeUndefined();
    expect(store.get("a")).toBe("2026-08-16T12:00:00.000Z");
  });
});

describe("A5 JsonAlertSinceStore", () => {
  test("A5.1 records survive reopening", async () => {
    const directory = await mkdtemp(join(tmpdir(), "formic-alert-since-"));
    const path = join(directory, "alert-since.json");
    try {
      const store = await JsonAlertSinceStore.open(
        path,
        () => Date.parse("2026-08-16T12:00:00.000Z"),
      );
      await store.observe(new Map([["a", "hook:needsInput:hook-input"]]));
      const reopened = await JsonAlertSinceStore.open(path);
      expect(reopened.list()).toEqual([{
        agentId: "a",
        fingerprint: "hook:needsInput:hook-input",
        firstSeenAt: "2026-08-16T12:00:00.000Z",
      }]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("A5.2 corrupt state logs and boots empty", async () => {
    const directory = await mkdtemp(join(tmpdir(), "formic-alert-since-corrupt-"));
    const path = join(directory, "alert-since.json");
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      await writeFile(path, "not-json", "utf8");
      const store = await JsonAlertSinceStore.open(path);
      expect(store.list()).toEqual([]);
      expect(store.loadError()).toContain("alert-since state could not be read");
      expect(error).toHaveBeenCalledTimes(1);
    } finally {
      error.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
