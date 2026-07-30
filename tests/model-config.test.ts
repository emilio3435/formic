import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeContextWindow } from "../src/server/collectors";
import {
  cursorNativeFamily,
  DEFAULT_MODEL_CONFIG,
  loadModelConfig,
  modelFamily,
} from "../src/server/model-config";

const shippedPath = join(import.meta.dir, "../config/models.json");

describe("model knowledge config", () => {
  test("the shipped file preserves the compiled behavior", () => {
    const config = loadModelConfig(shippedPath);

    expect(config).toMatchObject(DEFAULT_MODEL_CONFIG);
    expect(config.modelDisplayLabels).toEqual({
      "claude-fable-5": "fable 5",
      "claude-opus-4-8": "opus 4.8",
      "claude-sonnet-5": "sonnet 5",
      "composer-2": "composer 2",
      "composer-2.5": "composer 2.5",
      "gpt-5.6-luna": "luna 5.6",
      "gpt-5.6-sol": "sol 5.6",
      "grok-4.5": "grok 4.5",
    });
    expect(modelFamily("cursor/grok-4.5-fast", config)).toBe("grok-4.5");
    expect(modelFamily("gpt-5.6-sol-max", config)).toBe("gpt-5.6-sol");
    expect(modelFamily("fable-5-high", config)).toBe("claude-fable-5");
    // Composer families collapse to their version, not the shorter "composer-2".
    expect(modelFamily("composer-2.5-fast", config)).toBe("composer-2.5");
    expect(modelFamily("composer-2", config)).toBe("composer-2");
  });

  test("the shipped model facts include versioned non-negative pricing", () => {
    const shipped = JSON.parse(readFileSync(shippedPath, "utf8")) as {
      pricingVersion?: unknown;
      modelPricingUsdPerMillionTokens?: Record<string, {
        aliases?: unknown;
        input?: unknown;
        output?: unknown;
        cacheRead?: unknown;
        cacheCreation?: unknown;
      }>;
    };
    expect(shipped.pricingVersion).toBe("2026-07-28");
    const opus = shipped.modelPricingUsdPerMillionTokens?.["claude-opus-4-8"];
    expect(opus?.aliases).toContain("claude-opus-4-8");
    for (const amount of [opus?.input, opus?.output, opus?.cacheRead, opus?.cacheCreation]) {
      expect(typeof amount).toBe("number");
      expect(amount as number).toBeGreaterThanOrEqual(0);
    }
  });

  test("Cursor-native families match Grok and Composer, not foreign models", () => {
    const config = loadModelConfig(shippedPath);

    expect(cursorNativeFamily("grok-4.5", config)).toBe("grok-4.5");
    expect(cursorNativeFamily("grok-4.5-fast-xhigh", config)).toBe("grok-4.5");
    expect(cursorNativeFamily("cursor-grok-4.5-high-fast", config)).toBe("cursor-grok-4.5");
    expect(cursorNativeFamily("composer-2", config)).toBe("composer-2");
    expect(cursorNativeFamily("composer-2.5", config)).toBe("composer-2.5");
    // Hyphen-bounded prefix keeps composer-2.5-fast off the composer-2 family.
    expect(cursorNativeFamily("composer-2.5-fast", config)).toBe("composer-2.5");
    // Foreign models are not Cursor-native.
    expect(cursorNativeFamily("gpt-5.6-sol-xhigh", config)).toBeUndefined();
    expect(cursorNativeFamily("claude-fable-5-thinking-high", config)).toBeUndefined();
    expect(cursorNativeFamily("claude-opus-4-8-thinking-high", config)).toBeUndefined();
  });

  test("cursorNativeFamilies survives a missing file via compiled defaults", () => {
    const directory = mkdtempSync(join(tmpdir(), "mountain-models-"));

    expect(loadModelConfig(join(directory, "missing.json")).cursorNativeFamilies)
      .toEqual(["grok-4.5", "cursor-grok-4.5", "composer-2", "composer-2.5"]);
  });

  test("a missing or malformed file uses all compiled defaults", () => {
    const directory = mkdtempSync(join(tmpdir(), "mountain-models-"));
    const malformedPath = join(directory, "malformed.json");
    writeFileSync(malformedPath, "{\"cursorRootModel\":");

    expect(loadModelConfig(join(directory, "missing.json"))).toBe(DEFAULT_MODEL_CONFIG);
    expect(loadModelConfig(malformedPath)).toBe(DEFAULT_MODEL_CONFIG);
  });

  test("invalid display labels reject the whole config instead of leaking malformed wire data", () => {
    const directory = mkdtempSync(join(tmpdir(), "mountain-models-"));
    const path = join(directory, "models.json");
    writeFileSync(path, JSON.stringify({
      ...DEFAULT_MODEL_CONFIG,
      modelDisplayLabels: { "gpt-5.6-sol": "" },
    }));

    expect(loadModelConfig(path)).toBe(DEFAULT_MODEL_CONFIG);
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
