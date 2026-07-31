import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const KEYCHAIN_SERVICE = "com.openburnbar.database-encryption";
const KEYCHAIN_ACCOUNT = "database-encryption-key-v1";
const KEYCHAIN_TIMEOUT_MS = 2_500;
const QUERY_TIMEOUT_MS = 15_000;
const SQLITE_MAGIC = "SQLite format 3\0";

export interface BurnBarPaths {
  supportDir: string;
  dbPath: string;
  quotasPath: string;
}

export interface UsageSummary {
  ok: boolean;
  available: boolean;
  provenance: "burnbar" | "unavailable";
  sourceHealth?: UsageSourceHealth;
  source: "burnbar";
  from: string;
  to: string;
  processedTokens: number | null;
  estimatedCostUsd: number | null;
  costProvenance?: CostProvenance;
  pricingVersion?: string;
  costKnown: boolean;
  invocations: number | null;
  burnRateTokensPerHour: number | null;
  byProvider: Array<{
    provider: string;
    tokens: number;
    costUsd: number | null;
    costProvenance?: CostProvenance;
    invocations: number;
  }>;
  error?: string;
}

export interface UsageSeriesPoint {
  bucketStart: string;
  provider: string;
  model: string;
  tokens: number;
  costUsd: number | null;
  costProvenance: CostProvenance;
  pricingVersion?: string;
  invocations: number;
}

export interface UsageSeriesResponse {
  ok: boolean;
  available: boolean;
  provenance: "burnbar" | "unavailable";
  source: "burnbar";
  from: string;
  to: string;
  bucket: string;
  points: UsageSeriesPoint[];
  error?: string;
}

export interface UsageInvocation {
  id: string;
  provider: string;
  model: string;
  sessionId: string;
  projectName?: string;
  tokens: number | null;
  costUsd: number | null;
  costProvenance: CostProvenance;
  pricingVersion?: string;
  startTime: string;
  endTime?: string;
}

export interface UsageInvocationsResponse {
  ok: boolean;
  available: boolean;
  provenance: "burnbar" | "unavailable";
  source: "burnbar";
  from: string;
  to: string;
  limit: number;
  invocations: UsageInvocation[];
  error?: string;
}

export type CostProvenance = "measured" | "derived_estimate" | "unknown";

export interface UsageSourceHealth {
  state: "healthy" | "not_installed" | "misconfigured" | "error";
  message: string;
}

export interface ModelPrice {
  aliases: string[];
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export interface PricingConfig {
  pricingVersion: string;
  modelPricingUsdPerMillionTokens: Record<string, ModelPrice>;
}

export interface CostInputs {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  measuredCostUsd: number | null;
}

export interface CostResult {
  costUsd: number | null;
  costProvenance: CostProvenance;
  pricingVersion?: string;
}

const EMPTY_PRICING_CONFIG: PricingConfig = {
  pricingVersion: "unavailable",
  modelPricingUsdPerMillionTokens: {},
};

function loadPricingConfig(): PricingConfig {
  try {
    const value = JSON.parse(
      readFileSync(join(import.meta.dir, "../../config/models.json"), "utf8"),
    ) as Record<string, unknown>;
    if (typeof value.pricingVersion !== "string" || !value.pricingVersion.trim()) {
      return EMPTY_PRICING_CONFIG;
    }
    if (
      !value.modelPricingUsdPerMillionTokens
      || typeof value.modelPricingUsdPerMillionTokens !== "object"
      || Array.isArray(value.modelPricingUsdPerMillionTokens)
    ) {
      return EMPTY_PRICING_CONFIG;
    }
    const prices: Record<string, ModelPrice> = {};
    for (const [model, raw] of Object.entries(value.modelPricingUsdPerMillionTokens)) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_PRICING_CONFIG;
      const price = raw as Record<string, unknown>;
      const aliases = price.aliases;
      const amounts = [price.input, price.output, price.cacheRead, price.cacheCreation];
      if (
        !Array.isArray(aliases)
        || aliases.length === 0
        || !aliases.every((alias) => typeof alias === "string" && alias.trim())
        || !amounts.every((amount) => typeof amount === "number" && Number.isFinite(amount) && amount >= 0)
      ) {
        return EMPTY_PRICING_CONFIG;
      }
      prices[model] = {
        aliases: aliases as string[],
        input: price.input as number,
        output: price.output as number,
        cacheRead: price.cacheRead as number,
        cacheCreation: price.cacheCreation as number,
      };
    }
    return {
      pricingVersion: value.pricingVersion,
      modelPricingUsdPerMillionTokens: prices,
    };
  } catch {
    return EMPTY_PRICING_CONFIG;
  }
}

const PRICING_CONFIG = loadPricingConfig();

function canonicalModel(model: string): string {
  return model.split("/").at(-1)!.trim().toLowerCase().replace(/[ _]+/g, "-");
}

function modelPrice(model: string, config: PricingConfig): ModelPrice | undefined {
  const canonical = canonicalModel(model);
  return Object.values(config.modelPricingUsdPerMillionTokens).find((price) =>
    price.aliases.some((alias) => canonical === alias || canonical.startsWith(`${alias}-`))
  );
}

export function resolveUsageCost(
  input: CostInputs,
  config: PricingConfig = PRICING_CONFIG,
): CostResult {
  if (input.measuredCostUsd != null && Number.isFinite(input.measuredCostUsd)) {
    return { costUsd: input.measuredCostUsd, costProvenance: "measured" };
  }
  const price = modelPrice(input.model, config);
  if (!price) return { costUsd: null, costProvenance: "unknown" };
  const costUsd = (
    input.inputTokens * price.input
    + input.outputTokens * price.output
    + input.cacheReadTokens * price.cacheRead
    + input.cacheCreationTokens * price.cacheCreation
  ) / 1_000_000;
  return {
    costUsd,
    costProvenance: "derived_estimate",
    pricingVersion: config.pricingVersion,
  };
}

export interface QuotaBucket {
  key: string;
  label: string;
  usedPercent?: number;
  remainingValue?: number;
  limitValue?: number;
  resetsAt?: string;
  windowKind?: string;
}

export interface ProviderQuota {
  provider: string;
  providerID?: string;
  confidence?: string;
  statusMessage?: string;
  fetchedAt?: string;
  buckets: QuotaBucket[];
}

export interface UsageQuotasResponse {
  ok: boolean;
  available: boolean;
  provenance: "burnbar-quotas" | "unavailable";
  source: "provider_quotas.json";
  quotas: ProviderQuota[];
  error?: string;
}

export interface UsageSpike {
  provider: string;
  model: string;
  currentTokensPerHour: number;
  baselineTokensPerHour: number;
  ratio: number;
}

export interface UsageWardResponse {
  ok: boolean;
  available: boolean;
  provenance: "burnbar" | "unavailable";
  source: "burnbar";
  from: string;
  to: string;
  spikes: UsageSpike[];
  quotaPressure: Array<{ provider: string; label: string; usedPercent: number; resetsAt?: string }>;
  /* The ward answers from two independent sources: spikes from the encrypted
     database, quota pressure from the provider_quotas.json sidecar. Either can
     fail alone, so a single `available` cannot describe both — an unreadable
     sidecar used to be flattened into an empty quotaPressure under
     available:true, which reads as "no quota pressure" rather than "we could
     not look". Spike availability stays on `available`; quotas report here. */
  quotas: { available: boolean; error?: string };
  error?: string;
}

type QueryRow = Record<string, unknown>;

function supportDir(): string {
  return process.env.BURNBAR_SUPPORT_DIR?.trim()
    || join(homedir(), "Library/Application Support/OpenBurnBar");
}

export function resolveBurnBarPaths(): BurnBarPaths {
  const dir = supportDir();
  return {
    supportDir: dir,
    dbPath: process.env.BURNBAR_DB_PATH?.trim() || join(dir, "openburnbar.sqlite"),
    quotasPath: join(dir, "provider_quotas.json"),
  };
}

export function isEncryptedSqliteFile(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const bytes = readFileSync(path).subarray(0, 16);
    return Buffer.from(bytes).toString("utf8") !== SQLITE_MAGIC;
  } catch {
    return true;
  }
}

async function readKeychainPassphrase(): Promise<string | null> {
  if (typeof process.env.BURNBAR_DB_KEY === "string" && process.env.BURNBAR_DB_KEY) {
    return process.env.BURNBAR_DB_KEY;
  }
  if (process.platform !== "darwin") return null;
  try {
    const proc = Bun.spawn(
      ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // already exited
      }
    }, KEYCHAIN_TIMEOUT_MS);
    const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    clearTimeout(timer);
    if (code !== 0) return null;
    const key = stdout.trim();
    if (!key || !/^[A-Za-z0-9+/=_-]+$/.test(key)) return null;
    return key;
  } catch {
    return null;
  }
}

async function runEncryptedQuery(sql: string, params: unknown[] = []): Promise<QueryRow[]> {
  const paths = resolveBurnBarPaths();
  if (!existsSync(paths.dbPath)) {
    throw new Error(`BurnBar database not found at ${paths.dbPath}`);
  }
  const key = await readKeychainPassphrase();
  if (!key) {
    throw new Error("BurnBar encryption key unavailable (Keychain timed out or missing).");
  }

  const helper = join(import.meta.dir, "burnbar-query.ts");
  const proc = Bun.spawn({
    cmd: ["bun", helper],
    env: {
      ...process.env,
      BURNBAR_DB_PATH: paths.dbPath,
      BURNBAR_DB_KEY: key,
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(JSON.stringify({ sql, params }));
  proc.stdin.end();
  const timer = setTimeout(() => {
    try {
      proc.kill();
    } catch {
      // already exited
    }
  }, QUERY_TIMEOUT_MS);
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  clearTimeout(timer);
  // Drop key from local scope ASAP (best-effort; GC).
  void key;

  let parsed: { ok?: boolean; rows?: QueryRow[]; error?: string };
  try {
    parsed = JSON.parse(stdout.trim() || "{}") as { ok?: boolean; rows?: QueryRow[]; error?: string };
  } catch {
    throw new Error(stderr.trim() || "BurnBar query helper returned invalid JSON.");
  }
  if (!parsed.ok) {
    throw new Error(parsed.error || (code === 0 ? "BurnBar query failed." : `BurnBar query exited ${code}.`));
  }
  return parsed.rows ?? [];
}

function parseRange(url: URL): { from: string; to: string } | string {
  const now = Date.now();
  const toRaw = url.searchParams.get("to");
  const fromRaw = url.searchParams.get("from");
  const toMs = toRaw ? Date.parse(toRaw) : now;
  const fromMs = fromRaw ? Date.parse(fromRaw) : toMs - 24 * 60 * 60 * 1_000;
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return "from and to must be ISO timestamps.";
  if (fromMs >= toMs) return "from must be earlier than to.";
  if (toMs - fromMs > 90 * 24 * 60 * 60 * 1_000) return "Range cannot exceed 90 days.";
  return { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() };
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

/**
 * OpenBurnBar's GRDB Date values are UTC text in `yyyy-MM-dd HH:mm:ss.SSS`
 * form. Keep query bounds in that form: SQLite compares DATETIME TEXT
 * lexicographically, so ISO `T...Z` bounds exclude those rows.
 */
export function toBurnBarTimestamp(timestamp: string): string {
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) throw new Error("Invalid ISO timestamp.");
  return new Date(milliseconds).toISOString().replace("T", " ").replace("Z", "");
}

const HEALTHY_SOURCE: UsageSourceHealth = {
  state: "healthy",
  message: "OpenBurnBar cost source is available.",
};

function unavailableSource(error: string): UsageSourceHealth {
  if (/database not found|SQLCipher dylib not found/i.test(error)) {
    return {
      state: "not_installed",
      message: "Cost source not installed. Install OpenBurnBar with SQLCipher support.",
    };
  }
  if (/encryption key|keychain|codec not active|wrong key/i.test(error)) {
    return {
      state: "misconfigured",
      message: "OpenBurnBar is installed but its SQLCipher key is unavailable or invalid.",
    };
  }
  return { state: "error", message: error };
}

function unavailableSummary(from: string, to: string, error: string): UsageSummary {
  return {
    ok: true,
    available: false,
    provenance: "unavailable",
    sourceHealth: unavailableSource(error),
    source: "burnbar",
    from,
    to,
    processedTokens: null,
    estimatedCostUsd: null,
    costProvenance: "unknown",
    costKnown: false,
    invocations: null,
    burnRateTokensPerHour: null,
    byProvider: [],
    error,
  };
}

export async function getUsageSummary(from: string, to: string): Promise<UsageSummary> {
  try {
    const [dbFrom, dbTo] = [toBurnBarTimestamp(from), toBurnBarTimestamp(to)];
    const rows = await runEncryptedQuery(
      `SELECT
         provider,
         COALESCE(model, 'unknown') AS model,
         COUNT(*) AS invocations,
         SUM(COALESCE(totalTokens, 0)) AS tokens,
         SUM(CASE WHEN provenanceConfidence = 'exact' THEN 0 ELSE COALESCE(inputTokens, 0) END) AS unpricedInputTokens,
         SUM(CASE WHEN provenanceConfidence = 'exact' THEN 0 ELSE COALESCE(outputTokens, 0) END) AS unpricedOutputTokens,
         SUM(CASE WHEN provenanceConfidence = 'exact' THEN 0 ELSE COALESCE(cacheReadTokens, 0) END) AS unpricedCacheReadTokens,
         SUM(CASE WHEN provenanceConfidence = 'exact' THEN 0 ELSE COALESCE(cacheCreationTokens, 0) END) AS unpricedCacheCreationTokens,
         SUM(CASE WHEN provenanceConfidence = 'exact' THEN cost ELSE 0 END) AS measuredCost,
         SUM(CASE WHEN provenanceConfidence = 'exact' THEN 0 ELSE 1 END) AS costMissing
       FROM token_usage
       WHERE startTime >= ? AND startTime < ?
       GROUP BY provider, model
       ORDER BY tokens DESC`,
      [dbFrom, dbTo],
    );
    const byModel = rows.map((row) => {
      const costMissing = num(row.costMissing) ?? 0;
      const measuredCost = num(row.measuredCost) ?? 0;
      const derived = resolveUsageCost({
        model: str(row.model),
        inputTokens: num(row.unpricedInputTokens) ?? 0,
        outputTokens: num(row.unpricedOutputTokens) ?? 0,
        cacheReadTokens: num(row.unpricedCacheReadTokens) ?? 0,
        cacheCreationTokens: num(row.unpricedCacheCreationTokens) ?? 0,
        measuredCostUsd: null,
      });
      const cost = costMissing === 0
        ? { costUsd: measuredCost, costProvenance: "measured" as const }
        : derived.costUsd == null
          ? derived
          : {
            costUsd: measuredCost + derived.costUsd,
            costProvenance: "derived_estimate" as const,
            pricingVersion: derived.pricingVersion,
          };
      return {
        provider: str(row.provider) || "unknown",
        tokens: num(row.tokens) ?? 0,
        invocations: num(row.invocations) ?? 0,
        ...cost,
      };
    });
    const providers = new Map<string, typeof byModel>();
    for (const row of byModel) {
      const group = providers.get(row.provider) ?? [];
      group.push(row);
      providers.set(row.provider, group);
    }
    const byProvider = [...providers].map(([provider, group]) => {
      const unknown = group.some((row) => row.costUsd == null);
      const derived = group.some((row) => row.costProvenance === "derived_estimate");
      return {
        provider,
        tokens: group.reduce((sum, row) => sum + row.tokens, 0),
        costUsd: unknown ? null : group.reduce((sum, row) => sum + (row.costUsd ?? 0), 0),
        costProvenance: unknown ? "unknown" as const
          : derived ? "derived_estimate" as const
          : "measured" as const,
        invocations: group.reduce((sum, row) => sum + row.invocations, 0),
      };
    });
    const processedTokens = byProvider.reduce((sum, row) => sum + row.tokens, 0);
    const invocations = byProvider.reduce((sum, row) => sum + row.invocations, 0);
    const anyCostMissing = byProvider.some((row) => row.costUsd == null);
    const anyCostDerived = byProvider.some((row) => row.costProvenance === "derived_estimate");
    const estimatedCostUsd = invocations === 0 || anyCostMissing
      ? null
      : byProvider.reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
    const hours = Math.max((Date.parse(to) - Date.parse(from)) / 3_600_000, 1 / 60);
    return {
      ok: true,
      available: true,
      provenance: "burnbar",
      sourceHealth: HEALTHY_SOURCE,
      source: "burnbar",
      from,
      to,
      processedTokens,
      estimatedCostUsd,
      costProvenance: estimatedCostUsd == null ? "unknown"
        : anyCostDerived ? "derived_estimate"
        : "measured",
      ...(estimatedCostUsd != null && anyCostDerived
        ? { pricingVersion: PRICING_CONFIG.pricingVersion }
        : {}),
      costKnown: estimatedCostUsd != null,
      invocations,
      burnRateTokensPerHour: processedTokens / hours,
      byProvider,
    };
  } catch (error) {
    return unavailableSummary(from, to, error instanceof Error ? error.message : String(error));
  }
}

export async function getUsageSeries(
  from: string,
  to: string,
  bucket: string,
): Promise<UsageSeriesResponse> {
  const bucketSql =
    bucket === "1h" ? "strftime('%Y-%m-%dT%H:00:00.000Z', startTime)"
      : bucket === "1d" ? "strftime('%Y-%m-%dT00:00:00.000Z', startTime)"
        : null;
  if (!bucketSql) {
    return {
      ok: true,
      available: false,
      provenance: "unavailable",
      source: "burnbar",
      from,
      to,
      bucket,
      points: [],
      error: "bucket must be 1h or 1d.",
    };
  }
  try {
    const [dbFrom, dbTo] = [toBurnBarTimestamp(from), toBurnBarTimestamp(to)];
    const rows = await runEncryptedQuery(
      `SELECT
         ${bucketSql} AS bucketStart,
         provider,
         COALESCE(model, 'unknown') AS model,
         SUM(COALESCE(totalTokens, 0)) AS tokens,
         SUM(CASE WHEN provenanceConfidence = 'exact' THEN 0 ELSE COALESCE(inputTokens, 0) END) AS unpricedInputTokens,
         SUM(CASE WHEN provenanceConfidence = 'exact' THEN 0 ELSE COALESCE(outputTokens, 0) END) AS unpricedOutputTokens,
         SUM(CASE WHEN provenanceConfidence = 'exact' THEN 0 ELSE COALESCE(cacheReadTokens, 0) END) AS unpricedCacheReadTokens,
         SUM(CASE WHEN provenanceConfidence = 'exact' THEN 0 ELSE COALESCE(cacheCreationTokens, 0) END) AS unpricedCacheCreationTokens,
         SUM(CASE WHEN provenanceConfidence = 'exact' THEN cost ELSE 0 END) AS measuredCost,
         SUM(CASE WHEN provenanceConfidence = 'exact' THEN 0 ELSE 1 END) AS costMissing,
         COUNT(*) AS invocations
       FROM token_usage
       WHERE startTime >= ? AND startTime < ?
       GROUP BY bucketStart, provider, model
       ORDER BY bucketStart ASC, provider ASC, model ASC`,
      [dbFrom, dbTo],
    );
    return {
      ok: true,
      available: true,
      provenance: "burnbar",
      source: "burnbar",
      from,
      to,
      bucket,
      points: rows.map((row) => {
        const costMissing = num(row.costMissing) ?? 0;
        const derived = resolveUsageCost({
          model: str(row.model),
          inputTokens: num(row.unpricedInputTokens) ?? 0,
          outputTokens: num(row.unpricedOutputTokens) ?? 0,
          cacheReadTokens: num(row.unpricedCacheReadTokens) ?? 0,
          cacheCreationTokens: num(row.unpricedCacheCreationTokens) ?? 0,
          measuredCostUsd: null,
        });
        const measuredCost = num(row.measuredCost) ?? 0;
        const cost = costMissing === 0
          ? { costUsd: measuredCost, costProvenance: "measured" as const }
          : derived.costUsd == null
            ? derived
            : {
              costUsd: measuredCost + derived.costUsd,
              costProvenance: "derived_estimate" as const,
              pricingVersion: derived.pricingVersion,
            };
        return {
          bucketStart: str(row.bucketStart),
          provider: str(row.provider) || "unknown",
          model: str(row.model) || "unknown",
          tokens: num(row.tokens) ?? 0,
          ...cost,
          invocations: num(row.invocations) ?? 0,
        };
      }),
    };
  } catch (error) {
    return {
      ok: true,
      available: false,
      provenance: "unavailable",
      source: "burnbar",
      from,
      to,
      bucket,
      points: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getUsageInvocations(
  from: string,
  to: string,
  limit: number,
): Promise<UsageInvocationsResponse> {
  const capped = Math.max(1, Math.min(limit, 500));
  try {
    const [dbFrom, dbTo] = [toBurnBarTimestamp(from), toBurnBarTimestamp(to)];
    const rows = await runEncryptedQuery(
      `SELECT id, provider, model, sessionId, projectName, totalTokens,
              inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens,
              cost, provenanceConfidence, startTime, endTime
       FROM token_usage
       WHERE startTime >= ? AND startTime < ?
       ORDER BY startTime DESC
       LIMIT ?`,
      [dbFrom, dbTo, capped],
    );
    return {
      ok: true,
      available: true,
      provenance: "burnbar",
      source: "burnbar",
      from,
      to,
      limit: capped,
      invocations: rows.map((row) => {
        const model = str(row.model) || "unknown";
        return {
          id: str(row.id),
          provider: str(row.provider) || "unknown",
          model,
          sessionId: str(row.sessionId),
          projectName: str(row.projectName) || undefined,
          tokens: num(row.totalTokens),
          ...resolveUsageCost({
            model,
            inputTokens: num(row.inputTokens) ?? 0,
            outputTokens: num(row.outputTokens) ?? 0,
            cacheReadTokens: num(row.cacheReadTokens) ?? 0,
            cacheCreationTokens: num(row.cacheCreationTokens) ?? 0,
            measuredCostUsd: str(row.provenanceConfidence) === "exact" ? num(row.cost) : null,
          }),
          startTime: str(row.startTime),
          endTime: str(row.endTime) || undefined,
        };
      }),
    };
  } catch (error) {
    return {
      ok: true,
      available: false,
      provenance: "unavailable",
      source: "burnbar",
      from,
      to,
      limit: capped,
      invocations: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getUsageQuotas(): Promise<UsageQuotasResponse> {
  const { quotasPath } = resolveBurnBarPaths();
  try {
    const raw = JSON.parse(await readFile(quotasPath, "utf8")) as unknown;
    if (!Array.isArray(raw)) {
      return {
        ok: true,
        available: false,
        provenance: "unavailable",
        source: "provider_quotas.json",
        quotas: [],
        error: "provider_quotas.json is not an array.",
      };
    }
    const quotas: ProviderQuota[] = raw.map((entry) => {
      const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      const bucketsRaw = Array.isArray(record.buckets) ? record.buckets : [];
      return {
        provider: str(record.provider) || "unknown",
        providerID: str(record.providerID) || undefined,
        confidence: str(record.confidence) || undefined,
        statusMessage: str(record.statusMessage) || undefined,
        fetchedAt: str(record.fetchedAt) || undefined,
        buckets: bucketsRaw.map((bucket) => {
          const b = bucket && typeof bucket === "object" ? (bucket as Record<string, unknown>) : {};
          return {
            key: str(b.key),
            label: str(b.label) || str(b.key) || "bucket",
            usedPercent: num(b.usedPercent) ?? undefined,
            remainingValue: num(b.remainingValue) ?? undefined,
            limitValue: num(b.limitValue) ?? undefined,
            resetsAt: str(b.resetsAt) || undefined,
            windowKind: str(b.windowKind) || undefined,
          };
        }),
      };
    });
    return {
      ok: true,
      available: true,
      provenance: "burnbar-quotas",
      source: "provider_quotas.json",
      quotas,
    };
  } catch (error) {
    return {
      ok: true,
      available: false,
      provenance: "unavailable",
      source: "provider_quotas.json",
      quotas: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getUsageWard(from: string, to: string): Promise<UsageWardResponse> {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  const duration = Math.max(toMs - fromMs, 60_000);
  const baselineFrom = new Date(fromMs - duration).toISOString();
  try {
    const [dbFrom, dbTo, dbBaselineFrom] = [
      toBurnBarTimestamp(from),
      toBurnBarTimestamp(to),
      toBurnBarTimestamp(baselineFrom),
    ];
    const [current, baseline, quotas] = await Promise.all([
      runEncryptedQuery(
        `SELECT provider, COALESCE(model, 'unknown') AS model,
                SUM(COALESCE(totalTokens, 0)) AS tokens
         FROM token_usage
         WHERE startTime >= ? AND startTime < ?
         GROUP BY provider, model`,
        [dbFrom, dbTo],
      ),
      runEncryptedQuery(
        `SELECT provider, COALESCE(model, 'unknown') AS model,
                SUM(COALESCE(totalTokens, 0)) AS tokens
         FROM token_usage
         WHERE startTime >= ? AND startTime < ?
         GROUP BY provider, model`,
        [dbBaselineFrom, dbFrom],
      ),
      getUsageQuotas(),
    ]);
    const hours = duration / 3_600_000;
    const baselineMap = new Map(
      baseline.map((row) => [`${str(row.provider)}\0${str(row.model)}`, (num(row.tokens) ?? 0) / hours]),
    );
    const spikes: UsageSpike[] = [];
    for (const row of current) {
      const key = `${str(row.provider)}\0${str(row.model)}`;
      const currentRate = (num(row.tokens) ?? 0) / hours;
      const baselineRate = baselineMap.get(key) ?? 0;
      const ratio = baselineRate > 0 ? currentRate / baselineRate : currentRate > 0 ? Infinity : 0;
      if (currentRate > 0 && (baselineRate === 0 ? currentRate > 1_000 : ratio >= 3)) {
        spikes.push({
          provider: str(row.provider) || "unknown",
          model: str(row.model) || "unknown",
          currentTokensPerHour: currentRate,
          baselineTokensPerHour: baselineRate,
          ratio: Number.isFinite(ratio) ? ratio : 999,
        });
      }
    }
    spikes.sort((a, b) => b.ratio - a.ratio);
    const quotaPressure = (quotas.quotas ?? [])
      .flatMap((quota) =>
        quota.buckets
          .filter((bucket) => typeof bucket.usedPercent === "number" && bucket.usedPercent >= 75)
          .map((bucket) => ({
            provider: quota.provider,
            label: bucket.label,
            usedPercent: bucket.usedPercent as number,
            resetsAt: bucket.resetsAt,
          })),
      )
      .sort((a, b) => b.usedPercent - a.usedPercent);
    return {
      ok: true,
      available: true,
      provenance: "burnbar",
      source: "burnbar",
      from,
      to,
      spikes: spikes.slice(0, 12),
      quotaPressure: quotaPressure.slice(0, 12),
      quotas: quotas.available
        ? { available: true }
        : { available: false, error: quotas.error },
    };
  } catch (error) {
    return {
      ok: true,
      available: false,
      provenance: "unavailable",
      source: "burnbar",
      from,
      to,
      spikes: [],
      quotaPressure: [],
      // The database failed before the sidecar was ever consulted.
      quotas: { available: false, error: "Quotas were not read." },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

function requestError(status: number, code: string, message: string): Response {
  return json({ ok: false, error: { code, message } }, status);
}

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

export async function handleUsageRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!isLoopback(url.hostname)) {
    return requestError(403, "ORIGIN_REJECTED", "Usage APIs are only available on loopback.");
  }
  if (request.method !== "GET") {
    return requestError(405, "METHOD_NOT_ALLOWED", "Use GET for usage endpoints.");
  }

  if (url.pathname === "/api/usage/quotas") {
    return json(await getUsageQuotas());
  }

  const range = parseRange(url);
  if (typeof range === "string") return requestError(400, "INVALID_RANGE", range);

  if (url.pathname === "/api/usage/summary") {
    return json(await getUsageSummary(range.from, range.to));
  }
  if (url.pathname === "/api/usage/series") {
    const bucket = url.searchParams.get("bucket") || "1h";
    return json(await getUsageSeries(range.from, range.to, bucket));
  }
  if (url.pathname === "/api/usage/invocations") {
    const limit = Number(url.searchParams.get("limit") ?? 50);
    return json(await getUsageInvocations(range.from, range.to, Number.isFinite(limit) ? limit : 50));
  }
  if (url.pathname === "/api/usage/ward") {
    return json(await getUsageWard(range.from, range.to));
  }
  return requestError(404, "NOT_FOUND", "Unknown usage endpoint.");
}
