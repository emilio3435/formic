#!/usr/bin/env bun
import { join } from "node:path";
import { readFormicOrchToken } from "../server/orch";
import { isLoopbackOrigin, isOrchLaunchCommand, type OrchFetch } from "../shared/orch";

export type FormicCliEnv = NodeJS.ProcessEnv;

export interface FormicCliIo {
  fetch: OrchFetch;
  randomUUID: () => string;
}

export interface FormicCliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function defaultRoot(env: FormicCliEnv): string {
  if (env.FORMIC_ROOT?.trim()) return env.FORMIC_ROOT.trim();
  return join(import.meta.dir, "..", "..");
}

function resolveUrl(env: FormicCliEnv): string | Error {
  const url = (env.FORMIC_URL ?? "http://127.0.0.1:4701").replace(/\/+$/, "");
  if (!isLoopbackOrigin(url)) return new Error("FORMIC_URL must be loopback.");
  return url;
}

function resolveToken(env: FormicCliEnv): string | Error {
  if (env.FORMIC_ORCH_TOKEN?.trim()) return env.FORMIC_ORCH_TOKEN.trim();
  try {
    const token = readFormicOrchToken(defaultRoot(env));
    if (token) return token;
  } catch {
    return new Error("Could not read FORMIC_ORCH_TOKEN.");
  }
  return new Error("FORMIC_ORCH_TOKEN is not set.");
}

async function printJson(
  io: FormicCliIo,
  url: string,
  token: string,
  path: string,
  init?: RequestInit,
): Promise<FormicCliResult> {
  const response = await io.fetch(`${url}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let parsed: { ok?: boolean } = {};
  try {
    parsed = JSON.parse(text) as { ok?: boolean };
  } catch {
    return { exitCode: 1, stdout: text, stderr: "Orch response was not JSON.\n" };
  }
  return {
    exitCode: parsed.ok === true ? 0 : 1,
    stdout: `${text.endsWith("\n") ? text : `${text}\n`}`,
    stderr: "",
  };
}

export async function runFormicCli(
  argv: string[],
  env: FormicCliEnv = process.env,
  io: FormicCliIo = { fetch, randomUUID: () => crypto.randomUUID() },
): Promise<FormicCliResult> {
  const args = argv[0] === "formic" ? argv.slice(1) : argv;
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    return {
      exitCode: args.length === 0 ? 2 : 0,
      stdout: "",
      stderr: "formic fleet | formic peek [agentId] | formic send <agentId> <instruction> | formic launch --cwd <dir> --command <codex|claude|grok> [--title <text>]\n",
    };
  }
  const url = resolveUrl(env);
  if (url instanceof Error) return { exitCode: 1, stdout: "", stderr: `${url.message}\n` };
  const token = resolveToken(env);
  if (token instanceof Error) return { exitCode: 1, stdout: "", stderr: `${token.message}\n` };

  if (args[0] === "fleet") {
    return printJson(io, url, token, "/api/orch/fleet");
  }
  if (args[0] === "peek") {
    const agentId = args[1]?.trim() ?? "";
    if (args.length > 2) {
      return { exitCode: 2, stdout: "", stderr: "formic peek [agentId]\n" };
    }
    const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : "";
    return printJson(io, url, token, `/api/orch/peek${query}`);
  }
  if (args[0] === "send") {
    const agentId = args[1]?.trim() ?? "";
    const instruction = args[2] ?? "";
    if (!agentId || !instruction) {
      return { exitCode: 2, stdout: "", stderr: "formic send <agentId> <instruction>\n" };
    }
    if (/[\r\n]/.test(instruction)) {
      return { exitCode: 1, stdout: "", stderr: "instruction must be a single line.\n" };
    }
    return printJson(io, url, token, "/api/orch/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId,
        instruction,
        clientNonce: env.FORMIC_NONCE?.trim() || io.randomUUID(),
      }),
    });
  }
  if (args[0] === "launch") {
    const rest = args.slice(1);
    let cwd = "";
    let command = "";
    let title = "";
    for (let i = 0; i < rest.length; i += 1) {
      const flag = rest[i];
      const value = rest[i + 1] ?? "";
      if (flag === "--cwd") { cwd = value; i += 1; continue; }
      if (flag === "--command") { command = value; i += 1; continue; }
      if (flag === "--title") { title = value; i += 1; continue; }
      return { exitCode: 2, stdout: "", stderr: `Unknown launch flag: ${flag}\n` };
    }
    if (!cwd || !command) {
      return { exitCode: 2, stdout: "", stderr: "formic launch --cwd <dir> --command <codex|claude|grok>\n" };
    }
    if (!isOrchLaunchCommand(command)) {
      return { exitCode: 1, stdout: "", stderr: "command must be codex, claude, or grok.\n" };
    }
    return printJson(io, url, token, "/api/orch/launch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cwd,
        command,
        ...(title ? { title } : {}),
        clientNonce: env.FORMIC_NONCE?.trim() || io.randomUUID(),
      }),
    });
  }
  return {
    exitCode: 2,
    stdout: "",
    stderr: "formic fleet | formic peek [agentId] | formic send <agentId> <instruction> | formic launch --cwd <dir> --command <codex|claude|grok>\n",
  };
}

const invoked = process.argv[1]?.includes("formic.ts") || process.argv[1]?.endsWith("/formic");
if (invoked && import.meta.main) {
  const result = await runFormicCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}
