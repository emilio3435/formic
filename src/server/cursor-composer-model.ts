export interface ComposerModelEvidence {
  model?: string;
  effort?: string;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// modelConfig.selectedModels[0].parameters is an [{id,value}] list carrying the
// effort/fast tier a GUI agent was configured with (e.g. {id:"effort",value:"xhigh"}).
function composerEffort(selectedModels: unknown): string | undefined {
  if (!Array.isArray(selectedModels)) return undefined;
  const parameters = asRecord(selectedModels[0])?.parameters;
  if (!Array.isArray(parameters)) return undefined;
  for (const parameter of parameters) {
    const record = asRecord(parameter);
    if (record?.id === "effort") return nonEmptyString(record.value);
  }
  return undefined;
}

// Shared model source keyed purely by session id: composerData:<sessionId>.modelConfig
// covers every family incl. Composer variants and exists for EVERY Cursor session id
// (roots and subagents alike). "default" means "no explicit model", so it is treated as
// unreported. The state.vscdb is a live WAL database; callers open it read-only and may
// lack the cursorDiskKV table on older installs, so the query is guarded.
/* Returning {} for a failed read made it identical to a session that simply
   has no composerData, and an absent model renders as the model policy
   "unreported" — whose summary tells the operator "Cursor did not expose an
   authoritative model for this session". That is a confident claim about
   Cursor's behaviour made from a local failure to read Cursor's database, and
   the two have opposite remedies. Absence still returns {}; a failure now
   throws, so the caller records it against the cursor source instead. */
export function composerModelForSession(
  value: string | Uint8Array | undefined,
  sessionId: string,
): ComposerModelEvidence {
  // No row is a real answer: this session never wrote composerData.
  if (value === undefined) return {};
  let parsed: unknown;
  try {
    const json = typeof value === "string" ? value : Buffer.from(value).toString("utf8");
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(
      `composerData for ${sessionId} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const modelConfig = asRecord(asRecord(parsed)?.modelConfig);
  const modelName = nonEmptyString(modelConfig?.modelName);
  return {
    model: modelName === "default" ? undefined : modelName,
    effort: composerEffort(modelConfig?.selectedModels),
  };
}
