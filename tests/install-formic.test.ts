import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..");
const SCRIPT = join(PROJECT_ROOT, "scripts/install-formic.sh");
const SCRATCH_ROOT = join(tmpdir(), `formic-install-tests-${process.pid}`);

function freshFixture(name: string): string {
  const root = join(SCRATCH_ROOT, name);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  return root;
}

function writeExecutable(path: string, contents: string): void {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function run(
  command: string[],
  cwd: string,
  env: Record<string, string>,
): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(command, {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function writeCheckoutMarkers(root: string, opts: { cli?: boolean } = {}): void {
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "src/server"), { recursive: true });
  writeFileSync(join(root, "src/server/index.ts"), "export {}\n");
  writeFileSync(join(root, "scripts/anthill-start.sh"), "#!/bin/bash\n");
  writeFileSync(join(root, "package.json"), '{"name":"the-mountain"}\n');
  if (opts.cli) {
    mkdirSync(join(root, "src/cli"), { recursive: true });
    writeFileSync(join(root, "src/cli/formic.ts"), "export {}\n");
  }
}

function installScriptInto(root: string): string {
  mkdirSync(join(root, "scripts"), { recursive: true });
  const dest = join(root, "scripts/install-formic.sh");
  writeFileSync(dest, readFileSync(SCRIPT, "utf8"));
  chmodSync(dest, 0o755);
  return dest;
}

function fakeBin(root: string, opts: { bun?: boolean } = {}): string {
  const bin = join(root, "fake-bin");
  mkdirSync(bin, { recursive: true });
  if (opts.bun !== false) {
    writeExecutable(join(bin, "bun"), "#!/bin/bash\nexit 0\n");
  }
  writeExecutable(
    join(bin, "launchctl"),
    "#!/bin/bash\nprintf '%s\\n' \"$*\" >> \"$LAUNCHCTL_LOG\"\n",
  );
  writeExecutable(join(bin, "curl"), [
    "#!/bin/bash",
    "printf '%s\\n' \"$*\" >> \"$CURL_LOG\"",
    "printf '200'",
    "",
  ].join("\n"));
  writeExecutable(join(bin, "git"), [
    "#!/bin/bash",
    "printf '%s\\n' \"$*\" >> \"$GIT_LOG\"",
    "if [ \"$1\" = \"clone\" ]; then",
    "  dest=\"${!#}\"",
    "  mkdir -p \"$dest/scripts\" \"$dest/src/server\"",
    "  printf 'export {}\\n' > \"$dest/src/server/index.ts\"",
    "  printf '#!/bin/bash\\n' > \"$dest/scripts/anthill-start.sh\"",
    "  printf '{\\\"name\\\":\\\"the-mountain\\\"}\\n' > \"$dest/package.json\"",
    "fi",
    "",
  ].join("\n"));
  return bin;
}

function installEnv(root: string, home: string, bin: string): Record<string, string> {
  return {
    HOME: home,
    PATH: `${bin}:/usr/bin:/bin`,
    LAUNCHCTL_LOG: join(root, "launchctl.log"),
    GIT_LOG: join(root, "git.log"),
    CURL_LOG: join(root, "curl.log"),
  };
}

afterAll(() => {
  rmSync(SCRATCH_ROOT, { recursive: true, force: true });
});

describe("install-formic.sh source", () => {
  test("exists as a stranger-safe Mac installer", () => {
    expect(existsSync(SCRIPT)).toBe(true);
    const src = readFileSync(SCRIPT, "utf8");
    expect(src.startsWith("#!/usr/bin/env bash")).toBe(true);
    expect(src).toContain("ai.imaginethat.anthill");
    expect(src).toContain("https://github.com/emilio3435/formic.git");
    expect(src).toContain("src/server/index.ts");
    expect(src).toContain("src/cli/formic.ts");
    expect(src).toContain("FORMIC_INSTALL_BUN");
  });

  test("does not hardcode an operator checkout", () => {
    const src = readFileSync(SCRIPT, "utf8");
    expect(src).not.toContain("the-mountain-production");
    expect(src).not.toContain("github.com/emilio3435/the-ant-hill");
    expect(src).not.toMatch(/clone[^\n]*the-ant-hill/);
    expect(src).not.toContain("~/anthill");
  });
});

describe("install-formic.sh path substitution", () => {
  test("LaunchAgent points at this checkout, not a decoy operator tree", () => {
    const root = freshFixture("from-checkout");
    const home = join(root, "home");
    const checkout = join(root, "formic-checkout");
    mkdirSync(join(home, "Developer", "the-mountain-production"), { recursive: true });
    mkdirSync(join(home, "anthill"), { recursive: true });
    writeCheckoutMarkers(checkout);
    const script = installScriptInto(checkout);
    const bin = fakeBin(root);
    const env = installEnv(root, home, bin);

    const result = run(["bash", script], checkout, env);
    const combined = `${result.stdout}${result.stderr}`;
    expect(result.exitCode, combined).toBe(0);

    const plist = readFileSync(join(home, "Library/LaunchAgents/ai.imaginethat.anthill.plist"), "utf8");
    expect(plist).toContain(`<string>${checkout}</string>`);
    expect(plist).toContain(`${checkout}/src/server/index.ts`);
    expect(plist).toContain("ai.imaginethat.anthill");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).not.toContain("the-mountain-production");
    expect(plist).not.toContain("the-ant-hill");
    expect(plist).not.toContain("bun start");

    expect(existsSync(join(home, ".local/bin/formic"))).toBe(false);
    expect(combined).toContain("http://127.0.0.1:4701");
    expect(combined).not.toContain("the-mountain-production");
    expect(readFileSync(env.LAUNCHCTL_LOG, "utf8")).toMatch(/bootstrap|kickstart/);
    expect(existsSync(env.GIT_LOG) ? readFileSync(env.GIT_LOG, "utf8") : "").not.toContain("clone");
  });

  test("installs ~/.local/bin/formic only when src/cli/formic.ts exists", () => {
    const root = freshFixture("with-cli");
    const home = join(root, "home");
    const checkout = join(root, "formic-checkout");
    writeCheckoutMarkers(checkout, { cli: true });
    const script = installScriptInto(checkout);
    const bin = fakeBin(root);
    const env = installEnv(root, home, bin);

    const result = run(["bash", script], checkout, env);
    const combined = `${result.stdout}${result.stderr}`;
    expect(result.exitCode, combined).toBe(0);

    const wrapper = readFileSync(join(home, ".local/bin/formic"), "utf8");
    expect(wrapper).toContain(`exec bun "${checkout}/src/cli/formic.ts" "$@"`);
    expect(wrapper).not.toContain("the-mountain-production");
    expect(combined).toContain(`${home}/.local/bin/formic`);
  });

  test("re-running is safe and keeps the same checkout paths", () => {
    const root = freshFixture("idempotent");
    const home = join(root, "home");
    const checkout = join(root, "formic-checkout");
    writeCheckoutMarkers(checkout);
    const script = installScriptInto(checkout);
    const bin = fakeBin(root);
    const env = installEnv(root, home, bin);

    const first = run(["bash", script], checkout, env);
    const second = run(["bash", script], checkout, env);
    expect(first.exitCode, `${first.stdout}${first.stderr}`).toBe(0);
    expect(second.exitCode, `${second.stdout}${second.stderr}`).toBe(0);

    const plist = readFileSync(join(home, "Library/LaunchAgents/ai.imaginethat.anthill.plist"), "utf8");
    expect(plist).toContain(`${checkout}/src/server/index.ts`);
    expect(existsSync(join(home, ".local/bin/formic"))).toBe(false);
  });

  test("outside a checkout, clones the public formic snapshot to ~/formic", () => {
    const root = freshFixture("clone-public");
    const home = join(root, "home");
    const lone = join(root, "lone");
    mkdirSync(join(lone, "scripts"), { recursive: true });
    const script = installScriptInto(lone);
    const bin = fakeBin(root);
    const env = installEnv(root, home, bin);

    const result = run(["bash", script], lone, env);
    const combined = `${result.stdout}${result.stderr}`;
    expect(result.exitCode, combined).toBe(0);

    const gitLog = readFileSync(env.GIT_LOG, "utf8");
    expect(gitLog).toContain("https://github.com/emilio3435/formic.git");
    expect(gitLog).toContain(`${home}/formic`);
    expect(gitLog).not.toContain("the-ant-hill");

    const plist = readFileSync(join(home, "Library/LaunchAgents/ai.imaginethat.anthill.plist"), "utf8");
    expect(plist).toContain(`${home}/formic`);
    expect(plist).not.toContain("the-mountain-production");
    expect(existsSync(join(home, ".local/bin/formic"))).toBe(false);
  });

  test("missing bun prints the install two-liner and does not curl|bash", () => {
    const root = freshFixture("missing-bun");
    const home = join(root, "home");
    const checkout = join(root, "formic-checkout");
    writeCheckoutMarkers(checkout);
    const script = installScriptInto(checkout);
    const bin = fakeBin(root, { bun: false });
    const env = installEnv(root, home, bin);

    const result = run(["bash", script], checkout, env);
    const combined = `${result.stdout}${result.stderr}`;
    expect(result.exitCode).not.toBe(0);
    expect(combined).toContain("curl -fsSL https://bun.sh/install | bash");
    expect(combined).toContain('export PATH="$HOME/.bun/bin:$PATH"');
    expect(combined.toLowerCase()).toMatch(/pipe|curl to bash|review/);
    expect(existsSync(env.CURL_LOG) ? readFileSync(env.CURL_LOG, "utf8") : "").toBe("");
  });
});
