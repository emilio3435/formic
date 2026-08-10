import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..");
const SCRATCH_ROOT = `/private/tmp/claude-501/anthill-deploy-tests-${process.pid}`;

function executable(path: string, contents: string): void {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

afterAll(() => {
  rmSync(SCRATCH_ROOT, { recursive: true, force: true });
});

describe("Ant Hill deploy health check", () => {
  test("a stale health response fails loudly without rewriting the production checkout", () => {
    const home = join(SCRATCH_ROOT, "home");
    const root = join(home, "Developer", "the-mountain-production");
    const scripts = join(root, "scripts");
    const fakeBin = join(root, "fake-bin");
    const curlLog = join(root, "curl.log");
    mkdirSync(scripts, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    copyFileSync(join(PROJECT_ROOT, "scripts/anthill-deploy.sh"), join(scripts, "anthill-deploy.sh"));
    copyFileSync(join(PROJECT_ROOT, "scripts/anthill-deploy-target.sh"), join(scripts, "anthill-deploy-target.sh"));
    executable(join(fakeBin, "bunx"), "#!/bin/bash\nexit 0\n");
    executable(join(fakeBin, "bun"), "#!/bin/bash\nexit 0\n");
    executable(join(fakeBin, "launchctl"), "#!/bin/bash\nexit 0\n");
    executable(join(fakeBin, "sleep"), "#!/bin/bash\nexit 0\n");
    executable(
      join(fakeBin, "curl"),
      "#!/bin/bash\nprintf '%s\\n' \"$*\" >> \"$CURL_LOG\"\nprintf '503'\n",
    );
    expect(Bun.spawnSync(
      ["git", "init", "-q", "-b", "main"],
      { cwd: root, env: { PATH: "/usr/bin:/bin" } },
    ).exitCode).toBe(0);
    writeFileSync(join(root, "fixture"), "fixture\n");
    expect(Bun.spawnSync(
      ["git", "-c", "user.name=Test", "-c", "user.email=test@example.com", "add", "."],
      { cwd: root, env: { PATH: "/usr/bin:/bin" } },
    ).exitCode).toBe(0);
    expect(Bun.spawnSync(
      ["git", "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"],
      { cwd: root, env: { PATH: "/usr/bin:/bin" } },
    ).exitCode).toBe(0);
    const remote = join(SCRATCH_ROOT, "stale-remote.git");
    expect(Bun.spawnSync(
      ["git", "init", "-q", "--bare", remote],
      { cwd: root, env: { PATH: "/usr/bin:/bin" } },
    ).exitCode).toBe(0);
    expect(Bun.spawnSync(
      ["git", "remote", "add", "origin", remote],
      { cwd: root, env: { PATH: "/usr/bin:/bin" } },
    ).exitCode).toBe(0);
    expect(Bun.spawnSync(
      ["git", "push", "-q", "-u", "origin", "main"],
      { cwd: root, env: { PATH: "/usr/bin:/bin" } },
    ).exitCode).toBe(0);
    const plist = join(home, "Library", "LaunchAgents", "ai.imaginethat.anthill.plist");
    mkdirSync(join(home, "Library", "LaunchAgents"), { recursive: true });
    writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>WorkingDirectory</key><string>${root}</string>
<key>ProgramArguments</key><array><string>bun</string><string>${root}/src/server/index.ts</string></array>
</dict></plist>`);

    const result = Bun.spawnSync(["bash", join(scripts, "anthill-deploy.sh")], {
      cwd: root,
      env: {
        CURL_LOG: curlLog,
        HOME: home,
        PATH: `${fakeBin}:/usr/bin:/bin`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = `${result.stdout.toString()}${result.stderr.toString()}`;

    expect(result.exitCode).toBe(1);
    expect(readFileSync(curlLog, "utf8")).toContain("http://127.0.0.1:4701/api/health");
    expect(output).toContain("UNHEALTHY: :4701 did not report a fresh snapshot after restart.");
    expect(output).toContain("Recovery: revert the unhealthy change through GitHub main");
    expect(output).not.toContain("reset --hard");
    expect(output).not.toContain("HEALTHY: :4701 answered");
  });
});
