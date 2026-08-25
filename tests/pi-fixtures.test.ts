import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_ROOT = join(import.meta.dir, "fixtures/pi");

function rows(name: string): Array<Record<string, any>> {
  return readFileSync(join(FIXTURE_ROOT, name), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function componentSize(usage: Record<string, unknown>): number {
  return ["input", "output", "cacheRead", "cacheWrite"]
    .reduce((sum, field) => sum + Number(usage[field] ?? 0), 0);
}

describe("sanitized Pi schema fixtures", () => {
  test("the v3 fixture pins non-UUID identity, tree shape, compaction, and physical leaf order", () => {
    const fixture = rows("v3-branch-compaction.jsonl");
    const header = fixture[0]!;
    const entries = fixture.slice(1);

    expect(header).toEqual({
      type: "session",
      version: 3,
      id: "pi.native_2026-08-20",
      timestamp: "2026-08-20T12:00:00.000Z",
      cwd: "/tmp/formic-pi-fixture/project",
    });
    expect(entries.find(({ id }) => id === "compact-active")).toMatchObject({
      type: "compaction",
      parentId: "assistant-before",
      firstKeptEntryId: "assistant-before",
    });
    expect(entries.find(({ id }) => id === "inactive-tool")).toMatchObject({
      parentId: "inactive-thinking",
      message: { role: "toolResult", toolCallId: "call-inactive" },
    });
    expect(entries.at(-1)).toMatchObject({
      type: "future_extension_shape",
      id: "unknown-active",
      parentId: "custom-active",
    });
    expect(new Set(entries.map(({ id }) => id)).size).toBe(entries.length);
  });

  test("the four physical usage events prove component accounting independently of totalTokens and USD", () => {
    const usageEvents = rows("v3-branch-compaction.jsonl")
      .slice(1)
      .map((entry) => entry.usage ?? entry.message?.usage)
      .filter((usage) => usage && componentSize(usage) > 0);
    const callSizes = usageEvents.map(componentSize);
    const newTokens = usageEvents.map((usage) =>
      Number(usage.input) + Number(usage.output) + Number(usage.cacheWrite));
    const cached = usageEvents.map((usage) => Number(usage.cacheRead));
    const usageRoles = rows("v3-branch-compaction.jsonl")
      .slice(1)
      .filter((entry) => {
        const usage = entry.usage ?? entry.message?.usage;
        return usage && componentSize(usage) > 0;
      })
      .map((entry) => entry.type === "compaction" ? "compaction" : entry.message.role);

    expect(callSizes).toEqual([33, 6, 10, 17]);
    expect(usageRoles).toEqual(["assistant", "compaction", "toolResult", "assistant"]);
    expect(newTokens.reduce((sum, value) => sum + value, 0)).toBe(31);
    expect(cached.reduce((sum, value) => sum + value, 0)).toBe(35);
    expect(callSizes.reduce((sum, value) => sum + value, 0)).toBe(66);
    expect(usageEvents[0]?.totalTokens).toBe(999);
    expect(usageEvents.at(-1)).toMatchObject({
      input: 6,
      output: 2,
      cacheRead: 8,
      cacheWrite: 1,
      totalTokens: 777,
    });
    expect(usageEvents.every((usage) => Number(usage.cost?.total) >= 0)).toBeTrue();
  });

  test("v1/v2 migrations and the defensive v3 absent-field schema fixture remain explicit", () => {
    const v1 = rows("v1-linear.jsonl");
    const v2 = rows("v2-hook-message.jsonl");
    const absent = rows("v3-absent-thinking-usage.jsonl");

    expect(v1[0]?.version).toBeUndefined();
    expect(v1.slice(1).every(({ id, parentId }) => id === undefined && parentId === undefined)).toBeTrue();
    expect(v2[0]?.version).toBe(2);
    expect(v2[2]).toMatchObject({
      id: "v2-hook",
      parentId: "v2-user",
      message: { role: "hookMessage", hookName: "fixture-hook" },
    });
    expect(v2[3]).toMatchObject({ id: "v2-assistant", parentId: "v2-hook" });
    expect(absent[0]).toMatchObject({ type: "session", version: 3, id: "pi.absent-evidence" });
    expect(absent.some(({ type }) => type === "thinking_level_change")).toBeFalse();
    expect(absent.some((entry) => entry.usage !== undefined || entry.message?.usage !== undefined)).toBeFalse();
    expect(absent.at(-1)).toMatchObject({
      type: "message",
      id: "user-only",
      message: { role: "user", content: "Keep absent Pi evidence unavailable." },
    });
    // Read-time defensive input only: this does not claim Pi persists a new user-only session.
    expect(absent.some((entry) => entry.message?.role === "assistant")).toBeFalse();
  });

  test("fixture evidence is synthetic and carries no home path, account, credential, or network endpoint", () => {
    const text = [
      "v1-linear.jsonl",
      "v2-hook-message.jsonl",
      "v3-absent-thinking-usage.jsonl",
      "v3-branch-compaction.jsonl",
    ].map((name) => readFileSync(join(FIXTURE_ROOT, name), "utf8")).join("\n");

    expect(text).toContain("/tmp/formic-pi-fixture/");
    expect(text).not.toMatch(/\/Users\//);
    expect(text).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    expect(text).not.toMatch(/(?:api[_-]?key|authorization|bearer|password|secret)[\s"':=]/i);
    expect(text).not.toMatch(/https?:\/\//);
  });
});
