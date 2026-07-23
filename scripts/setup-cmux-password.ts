#!/usr/bin/env bun
/**
 * Enable cmux password-mode socket access for Ant Hill.
 *
 * - Backs up ~/.config/cmux/cmux.json
 * - Sets automation.socketControlMode = "password" + a generated socketPassword
 * - Writes the same password to gitignored data/cmux-socket.env
 * - Tries `cmux reload-config` (may need a click in Settings if still cmuxOnly)
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CMUX_SOCKET_ENV_FILE } from "../src/server/cmux-auth";

const PROJECT_ROOT = join(import.meta.dir, "..");
const CMUX_JSON = join(homedir(), ".config/cmux/cmux.json");
const DEFAULT_CMUX =
  process.env.CMUX_EXECUTABLE?.trim() ||
  "/Applications/cmux.app/Contents/Resources/bin/cmux";

function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Buffer.from(bytes).toString("base64url");
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function upsertAutomation(jsonc: string, password: string): string {
  const automationBlock =
    `  "automation": {\n` +
    `    "socketControlMode": "password",\n` +
    `    "socketPassword": ${JSON.stringify(password)}\n` +
    `  }`;

  // Replace an existing active automation object (not commented-out template lines).
  const activeAutomation =
    /(^|\n)([ \t]*"automation"\s*:\s*\{[\s\S]*?\n[ \t]*\})(?=\s*,?\s*(?:\n|$))/m;
  if (activeAutomation.test(jsonc) && !jsonc.match(/^\s*\/\/\s*"automation"/m)) {
    return jsonc.replace(activeAutomation, `$1${automationBlock}`);
  }

  // Insert after schemaVersion when present.
  if (/"schemaVersion"\s*:\s*\d+\s*,?/.test(jsonc)) {
    return jsonc.replace(
      /("schemaVersion"\s*:\s*\d+\s*,?)/,
      `$1\n\n${automationBlock},`,
    );
  }

  // Last resort: wrap as a minimal file-managed document.
  return `{\n  "$schema": "https://raw.githubusercontent.com/manaflow-ai/cmux/main/web/data/cmux.schema.json",\n  "schemaVersion": 1,\n\n${automationBlock}\n}\n`;
}

async function reloadCmux(password: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const process = Bun.spawn(
      [DEFAULT_CMUX, "--password", password, "reload-config"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      Bun.readableStreamToText(process.stdout as ReadableStream<Uint8Array>),
      Bun.readableStreamToText(process.stderr as ReadableStream<Uint8Array>),
      process.exited,
    ]);
    if (exitCode === 0) return { ok: true, detail: stdout.trim() || "reload-config ok" };
    return { ok: false, detail: stderr.trim() || stdout.trim() || `exit ${exitCode}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  if (!existsSync(CMUX_JSON)) {
    console.error(`Missing ${CMUX_JSON}. Open cmux once so it creates the template, then re-run.`);
    process.exit(1);
  }

  const password = process.env.CMUX_SOCKET_PASSWORD?.trim() || randomPassword();
  const backup = `${CMUX_JSON}.bak-anthill-${stamp()}`;
  copyFileSync(CMUX_JSON, backup);
  console.log(`Backed up cmux.json → ${backup}`);

  const previous = readFileSync(CMUX_JSON, "utf8");
  const next = upsertAutomation(previous, password);
  writeFileSync(CMUX_JSON, next, { mode: 0o600 });
  console.log(`Set automation.socketControlMode = "password" in ${CMUX_JSON}`);

  const envPath = join(PROJECT_ROOT, CMUX_SOCKET_ENV_FILE);
  mkdirSync(join(PROJECT_ROOT, "data"), { recursive: true });
  writeFileSync(envPath, `# Ant Hill ↔ cmux socket password (gitignored via data/)\nCMUX_SOCKET_PASSWORD=${password}\n`, {
    mode: 0o600,
  });
  console.log(`Wrote ${CMUX_SOCKET_ENV_FILE}`);

  const reload = await reloadCmux(password);
  if (reload.ok) {
    console.log(`Reloaded cmux config: ${reload.detail}`);
  } else {
    console.log(`Could not reload from here yet: ${reload.detail}`);
    console.log("Finish once inside cmux: Settings → Automation → confirm Password mode, or run:");
    console.log("  cmux reload-config");
    console.log("  (or: cmux settings open automation)");
  }

  console.log("");
  console.log("Next:");
  console.log("  bun start                  # one room on http://127.0.0.1:4701");
  console.log("  bun run start:ops          # force dedicated cmux workspace");
  console.log("  bun run start:external     # this shell + password mode");
}

await main();
