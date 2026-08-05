import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ModelConfig {
  claudeContextWindows: Record<string, number>;
  modelFamilyAliases: Record<string, string[]>;
  modelDisplayLabels: Record<string, string>;
}

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  claudeContextWindows: {
    "opus-5": 1_000_000,
    "opus-4-8": 1_000_000,
    "opus-4-7": 1_000_000,
    "sonnet-5": 1_000_000,
    "fable-5": 1_000_000,
  },
  modelFamilyAliases: {
    "grok-4.5": ["grok-4.5", "cursor-grok-4.5"],
    "composer-2": ["composer-2"],
    "composer-2.5": ["composer-2.5"],
    "gpt-5.6-sol": ["gpt-5.6-sol"],
    "claude-fable-5": ["claude-fable-5", "fable-5"],
  },
  modelDisplayLabels: {
    "claude-fable-5": "fable 5",
    "claude-opus-4-8": "opus 4.8",
    "claude-sonnet-5": "sonnet 5",
    "composer-2": "composer 2",
    "composer-2.5": "composer 2.5",
    "gpt-5.6-luna": "luna 5.6",
    "gpt-5.6-sol": "sol 5.6",
    "grok-4.5": "grok 4.5",
  },
};

function isModelConfig(value: unknown): value is ModelConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const config = value as Record<string, unknown>;
  if (!config.claudeContextWindows || typeof config.claudeContextWindows !== "object" ||
    Array.isArray(config.claudeContextWindows)) return false;
  if (!config.modelFamilyAliases || typeof config.modelFamilyAliases !== "object" ||
    Array.isArray(config.modelFamilyAliases)) return false;
  if (!config.modelDisplayLabels || typeof config.modelDisplayLabels !== "object" ||
    Array.isArray(config.modelDisplayLabels)) return false;
  if (!Object.values(config.claudeContextWindows).every(
    (window) => typeof window === "number" && Number.isFinite(window) && window > 0,
  )) return false;
  if (!Object.entries(config.modelDisplayLabels).every(
    ([model, label]) =>
      model.trim() &&
      typeof label === "string" &&
      label.trim(),
  )) return false;
  return Object.entries(config.modelFamilyAliases).every(
    ([family, aliases]) =>
      family.trim() &&
      Array.isArray(aliases) &&
      aliases.length > 0 &&
      aliases.every((alias) => typeof alias === "string" && alias.trim()),
  );
}

/* Why the built-in defaults are standing in, when they are.

   config/models.json ships with the repo, so a missing, unparseable or
   wrong-shaped file is a fault rather than an absence. Every failure returned
   DEFAULT_MODEL_CONFIG and said nothing, which is the quiet kind: the values it
   supplies are claudeContextWindows (which becomes an agent's contextWindow and
   therefore its context percentage), the model display labels, and the
   Cursor-native policy that decides compliance verdicts. Wrong defaults do not
   look wrong — they look like numbers. */
let modelConfigError: string | undefined;

export function modelConfigLoadError(): string | undefined {
  return modelConfigError;
}

export function loadModelConfig(path: string): ModelConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    modelConfigError = `model config at ${path} could not be read, so built-in defaults are in force `
      + `(context windows, display labels and Cursor policy): `
      + (error instanceof Error ? error.message : String(error));
    console.error(`[model-config] ${modelConfigError}`);
    return DEFAULT_MODEL_CONFIG;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    modelConfigError = `model config at ${path} is not valid JSON, so built-in defaults are in force: `
      + (error instanceof Error ? error.message : String(error));
    console.error(`[model-config] ${modelConfigError}`);
    return DEFAULT_MODEL_CONFIG;
  }
  if (!isModelConfig(parsed)) {
    modelConfigError = `model config at ${path} does not match the expected shape, so built-in defaults are in force.`;
    console.error(`[model-config] ${modelConfigError}`);
    return DEFAULT_MODEL_CONFIG;
  }
  modelConfigError = undefined;
  return parsed;
}

function canonicalModel(model: string): string {
  return model
    .split("/")
    .at(-1)!
    .trim()
    .toLowerCase()
    .replace(/[ _]+/g, "-");
}

export function modelFamily(model: string, config: ModelConfig = MODEL_CONFIG): string {
  const canonical = canonicalModel(model);
  for (const [family, aliases] of Object.entries(config.modelFamilyAliases)) {
    if (aliases.some((alias) => canonical === alias || canonical.startsWith(`${alias}-`))) {
      return family;
    }
  }
  return canonical;
}

export const MODEL_CONFIG = loadModelConfig(join(import.meta.dir, "../../config/models.json"));
