import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ModelConfig {
  claudeContextWindows: Record<string, number>;
  modelFamilyAliases: Record<string, string[]>;
  cursorRootModel: string;
}

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  claudeContextWindows: {
    "opus-4-8": 1_000_000,
    "sonnet-5": 1_000_000,
    "fable-5": 1_000_000,
  },
  modelFamilyAliases: {
    "grok-4.5": ["grok-4.5", "cursor-grok-4.5"],
    "gpt-5.6-sol": ["gpt-5.6-sol"],
    "claude-fable-5": ["claude-fable-5", "fable-5"],
  },
  cursorRootModel: "Grok 4.5 Fast",
};

function isModelConfig(value: unknown): value is ModelConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const config = value as Record<string, unknown>;
  if (!config.claudeContextWindows || typeof config.claudeContextWindows !== "object" ||
    Array.isArray(config.claudeContextWindows)) return false;
  if (!config.modelFamilyAliases || typeof config.modelFamilyAliases !== "object" ||
    Array.isArray(config.modelFamilyAliases)) return false;
  if (typeof config.cursorRootModel !== "string" || !config.cursorRootModel.trim()) return false;
  if (!Object.values(config.claudeContextWindows).every(
    (window) => typeof window === "number" && Number.isFinite(window) && window > 0,
  )) return false;
  return Object.entries(config.modelFamilyAliases).every(
    ([family, aliases]) =>
      family.trim() &&
      Array.isArray(aliases) &&
      aliases.length > 0 &&
      aliases.every((alias) => typeof alias === "string" && alias.trim()),
  );
}

export function loadModelConfig(path: string): ModelConfig {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isModelConfig(parsed) ? parsed : DEFAULT_MODEL_CONFIG;
  } catch {
    return DEFAULT_MODEL_CONFIG;
  }
}

export function modelFamily(model: string, config: ModelConfig = MODEL_CONFIG): string {
  const canonical = model
    .split("/")
    .at(-1)!
    .trim()
    .toLowerCase()
    .replace(/[ _]+/g, "-");
  for (const [family, aliases] of Object.entries(config.modelFamilyAliases)) {
    if (aliases.some((alias) => canonical === alias || canonical.startsWith(`${alias}-`))) {
      return family;
    }
  }
  return canonical;
}

export const MODEL_CONFIG = loadModelConfig(join(import.meta.dir, "../../config/models.json"));
