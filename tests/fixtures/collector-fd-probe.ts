import { collectSessionProvider } from "../../src/server/collectors";

const home = process.argv[2];
const expected = Number(process.argv[3]);
const provider = process.argv[4] ?? "codex";
if (
  !home
  || !Number.isSafeInteger(expected)
  || expected < 0
  || (provider !== "codex" && provider !== "grok")
) {
  throw new Error("usage: collector-fd-probe.ts HOME EXPECTED [codex|grok]");
}

const result = await collectSessionProvider(provider, home);
console.log(JSON.stringify({
  agents: result.value.length,
  errors: result.errors.length,
  firstError: result.errors[0],
}));
if (result.value.length !== expected || result.errors.length !== 0) process.exitCode = 1;
