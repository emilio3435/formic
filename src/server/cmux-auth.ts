import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Relative to the Ant Hill project root. Kept under gitignored `data/`. */
export const CMUX_SOCKET_ENV_FILE = "data/cmux-socket.env";

let cachedPassword: string | undefined | null = null;
let envFileLoaded = false;

function parseEnvFile(contents: string): string | undefined {
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?CMUX_SOCKET_PASSWORD\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[1] ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    value = value.trim();
    if (value) return value;
  }
  return undefined;
}

/** Load `data/cmux-socket.env` into process.env once (does not override a set env var). */
export function loadCmuxSocketEnv(projectRoot: string): void {
  if (envFileLoaded) return;
  envFileLoaded = true;
  const path = join(projectRoot, CMUX_SOCKET_ENV_FILE);
  try {
    const fromFile = parseEnvFile(readFileSync(path, "utf8"));
    if (fromFile && !process.env.CMUX_SOCKET_PASSWORD?.trim()) {
      process.env.CMUX_SOCKET_PASSWORD = fromFile;
    }
  } catch {
    // Missing file is normal until setup:cmux has been run.
  }
  cachedPassword = null;
}

/** Socket password for outside-cmux access. Env wins over the local env file. */
export function cmuxSocketPassword(): string | undefined {
  if (cachedPassword !== null) return cachedPassword || undefined;
  const fromEnv = process.env.CMUX_SOCKET_PASSWORD?.trim();
  cachedPassword = fromEnv || "";
  return cachedPassword || undefined;
}

/** True when this process was started inside a cmux terminal. */
export function runningInsideCmux(): boolean {
  return Boolean(process.env.CMUX_SURFACE_ID?.trim() || process.env.CMUX_WORKSPACE_ID?.trim());
}

/** Build cmux argv; the CLI reads CMUX_SOCKET_PASSWORD from the inherited environment. */
export function cmuxCommand(executable: string, args: readonly string[]): string[] {
  return [executable, ...args];
}

/** Test helper — clear memoization between cases. */
export function resetCmuxAuthForTests(): void {
  cachedPassword = null;
  envFileLoaded = false;
}
