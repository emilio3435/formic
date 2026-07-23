import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeContextWindow } from "../src/server/collectors";
import {
  DEFAULT_MODEL_CONFIG,
  loadModelConfig,
  modelFamily,
} from "../src/server/model-config";

const shippedPath = join(import.meta.dir, "../config/models.json");

describe("model knowledge config", () => {
  test("the shipped file preserves the compiled behavior", () => {
    const config = loadModelConfig(shippedPath);

    expect(config).toEqual(DEFAULT_MODEL_CONFIG);
    expect(modelFamily("cursor/grok-4.5-fast", config)).toBe("grok-4.5");
    expect(modelFamily("gpt-5.6-sol-max", config)).toBe("gpt-5.6-sol");
    expect(modelFamily("fable-5-high", config)).toBe("claude-fable-5");
  });

  test("a missing or malformed file uses all compiled defaults", () => {
    const directory = mkdtempSync(join(tmpdir(), "mountain-models-"));
    const malformedPath = join(directory, "malformed.json");
    writeFileSync(malformedPath, "{\"cursorRootModel\":");

    expect(loadModelConfig(join(directory, "missing.json"))).toBe(DEFAULT_MODEL_CONFIG);
    expect(loadModelConfig(malformedPath)).toBe(DEFAULT_MODEL_CONFIG);
  });

  test("an overridden context window flows through collector resolution", () => {
    const directory = mkdtempSync(join(tmpdir(), "mountain-models-"));
    const path = join(directory, "models.json");
    writeFileSync(path, JSON.stringify({
      ...DEFAULT_MODEL_CONFIG,
      claudeContextWindows: {
        ...DEFAULT_MODEL_CONFIG.claudeContextWindows,
        "fable-5": 750_000,
      },
    }));
    const config = loadModelConfig(path);

    expect(claudeContextWindow("claude-fable-5", config)).toBe(750_000);
    expect(claudeContextWindow("claude-haiku-5[1m]", config)).toBe(1_000_000);
  });
});
