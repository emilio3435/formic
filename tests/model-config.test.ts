import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeContextWindow } from "../src/server/collectors";
import {
  DEFAULT_MODEL_CONFIG,
  loadModelConfig,
  modelConfigLoadError,
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
      "spark-1.2": "spark 1.2",
      "muse-spark-1.2": "spark 1.2",
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

  test("a missing or malformed file uses all compiled defaults", () => {
    const directory = mkdtempSync(join(tmpdir(), "mountain-models-"));
    const malformedPath = join(directory, "malformed.json");
    writeFileSync(malformedPath, "{\"claudeContextWindows\":");

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

describe("defaults standing in for a config that failed to load", () => {
  /* config/models.json ships with the repo, so a missing or malformed file is a
     fault, not an absence. Every failure returned the built-in defaults and
     said nothing — and those defaults supply claudeContextWindows (which
     becomes an agent's contextWindow and therefore its context percentage),
     the display labels, and the Cursor-native policy behind compliance
     verdicts. Wrong defaults do not look wrong; they look like numbers. */
  test("a malformed config reports why the defaults are in force", () => {
    const directory = mkdtempSync(join(tmpdir(), "anthill-model-config-"));
    const path = join(directory, "models.json");
    writeFileSync(path, "{ not json");
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(loadModelConfig(path)).toEqual(DEFAULT_MODEL_CONFIG);
      expect(modelConfigLoadError() ?? "").toContain("not valid JSON");
      expect(modelConfigLoadError() ?? "").toContain("defaults are in force");
    } finally {
      logged.mockRestore();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("a config with the wrong shape is distinguished from unreadable", () => {
    const directory = mkdtempSync(join(tmpdir(), "anthill-model-shape-"));
    const path = join(directory, "models.json");
    writeFileSync(path, JSON.stringify({ nope: true }));
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(loadModelConfig(path)).toEqual(DEFAULT_MODEL_CONFIG);
      expect(modelConfigLoadError() ?? "").toContain("expected shape");
    } finally {
      logged.mockRestore();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("a good config clears the error, so a recovered load is not reported forever", () => {
    const directory = mkdtempSync(join(tmpdir(), "anthill-model-good-"));
    const path = join(directory, "models.json");
    writeFileSync(path, JSON.stringify(DEFAULT_MODEL_CONFIG));
    try {
      expect(loadModelConfig(path)).toEqual(DEFAULT_MODEL_CONFIG);
      expect(modelConfigLoadError()).toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
