/**
 * Isolated SQLCipher query helper.
 *
 * Must run in its own Bun process so Database.setCustomSQLite does not collide
 * with the hub's plaintext Cursor SQLite opens. Invoked by burnbar.ts.
 *
 * Env:
 *   BURNBAR_DB_PATH — sqlite path
 *   BURNBAR_DB_KEY — passphrase (never logged)
 *   BURNBAR_SQLCIPHER_DYLIB — optional dylib override
 *
 * Stdin JSON: { sql: string, params?: unknown[] }
 * Stdout JSON: { ok: true, rows: unknown[] } | { ok: false, error: string }
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function dylibCandidates(): string[] {
  const home = homedir();
  const fromEnv = process.env.BURNBAR_SQLCIPHER_DYLIB?.trim();
  return [
    fromEnv,
    join(home, "Library/Application Support/OpenBurnBar/Frameworks/SQLCipher.framework/SQLCipher"),
    "/Applications/OpenBurnBar.app/Contents/Frameworks/SQLCipher.framework/Versions/Current/SQLCipher",
    "/opt/homebrew/opt/sqlcipher/lib/libsqlcipher.dylib",
    "/usr/local/opt/sqlcipher/lib/libsqlcipher.dylib",
  ].filter((value): value is string => Boolean(value));
}

function resolveDylib(): string {
  for (const candidate of dylibCandidates()) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("SQLCipher dylib not found (OpenBurnBar framework or Homebrew sqlcipher).");
}

function assertSelectOnly(sql: string): void {
  const trimmed = sql.trim().replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "").trim();
  if (!/^(with|select|pragma)\b/i.test(trimmed)) {
    throw new Error("Only SELECT/PRAGMA statements are allowed.");
  }
  if (/\b(insert|update|delete|drop|alter|attach|detach|rekey|vacuum)\b/i.test(trimmed)) {
    throw new Error("Mutating SQL is not allowed.");
  }
}

async function main(): Promise<void> {
  const dbPath = process.env.BURNBAR_DB_PATH?.trim();
  const key = process.env.BURNBAR_DB_KEY;
  if (!dbPath) throw new Error("BURNBAR_DB_PATH is required.");
  if (typeof key !== "string" || !key) throw new Error("BURNBAR_DB_KEY is required.");
  if (!/^[A-Za-z0-9+/=_-]+$/.test(key)) throw new Error("BURNBAR_DB_KEY failed charset validation.");

  const raw = await new Response(Bun.stdin.stream()).text();
  let request: { sql?: unknown; params?: unknown };
  try {
    request = JSON.parse(raw) as { sql?: unknown; params?: unknown };
  } catch {
    throw new Error("stdin must be JSON with sql and optional params.");
  }
  if (typeof request.sql !== "string" || !request.sql.trim()) {
    throw new Error("sql must be a non-empty string.");
  }
  assertSelectOnly(request.sql);
  const params = Array.isArray(request.params) ? request.params : [];

  Database.setCustomSQLite(resolveDylib());
  const db = new Database(dbPath, { readonly: true });
  try {
    db.run(`PRAGMA key = '${key}'`);
    const cipher = db.query("PRAGMA cipher_version").get() as { cipher_version?: string } | null;
    if (!cipher?.cipher_version) {
      throw new Error("SQLCipher codec not active after keying.");
    }
    // Force a page read so a wrong key fails here instead of later.
    db.query("SELECT count(*) AS n FROM sqlite_master").get();
    const rows = db.query(request.sql).all(...params);
    process.stdout.write(`${JSON.stringify({ ok: true, rows })}\n`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  // Never include env secrets in the error payload.
  process.stdout.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
});
