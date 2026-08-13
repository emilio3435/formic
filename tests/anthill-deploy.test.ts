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
    // The gate reads its local-evidence list from ci-tests.sh (one copy of the list).
    copyFileSync(join(PROJECT_ROOT, "scripts/ci-tests.sh"), join(scripts, "ci-tests.sh"));
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

/* The deploy gate ran the whole suite, which includes four files that assert
   against THIS machine's live evidence and are written to fail — not skip —
   when that evidence is thin (scripts/ci-tests.sh explains why). On a quiet
   fleet the token-agreement canary cannot reach 20 joined sessions, so it fails
   for want of data and production could not be deployed at all. Measured
   2026-08-13: identical failures on the pre-merge commit, so nothing was broken
   except the morning.

   The split below keeps the guarantee that matters — a hermetic failure is
   never deployable — and turns the evidence gates into a decision the operator
   has to make out loud, with a named flag, rather than a wall. */
describe("Ant Hill deploy gate", () => {
  interface Lab { root: string; scripts: string; env: Record<string, string>; launchLog: string }

  function lab(name: string): Lab {
    const home = join(SCRATCH_ROOT, name, "home");
    const root = join(home, "Developer", "the-mountain-production");
    const scripts = join(root, "scripts");
    const fakeBin = join(root, "fake-bin");
    const launchLog = join(root, "launchctl.log");
    mkdirSync(scripts, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    for (const script of ["anthill-deploy.sh", "anthill-deploy-target.sh", "ci-tests.sh"]) {
      copyFileSync(join(PROJECT_ROOT, "scripts", script), join(scripts, script));
    }
    executable(join(fakeBin, "bunx"), "#!/bin/bash\nexit 0\n");
    /* Answers as the real bun would for the two phases the gate now runs, so
       the test can make the hermetic suite and the evidence gates disagree —
       which is the whole point of the split. */
    executable(join(fakeBin, "bun"), `#!/bin/bash
if [ "$1" = "run" ] && [ "$2" = "test:ci" ]; then exit \${CI_EXIT:-0}; fi
if [ "$1" = "test" ]; then exit \${LOCAL_EXIT:-0}; fi
exit 0
`);
    executable(join(fakeBin, "launchctl"), `#!/bin/bash\nprintf '%s\\n' "$*" >> "${launchLog}"\n`);
    executable(join(fakeBin, "sleep"), "#!/bin/bash\nexit 0\n");
    /* A healthy board, so nothing downstream of the gate can be what fails. */
    executable(join(fakeBin, "curl"), "#!/bin/bash\nprintf '200'\n");
    const git = (...args: string[]) => expect(Bun.spawnSync(
      ["git", "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
      { cwd: root, env: { PATH: "/usr/bin:/bin" } },
    ).exitCode).toBe(0);
    git("init", "-q", "-b", "main");
    writeFileSync(join(root, "fixture"), "fixture\n");
    git("add", ".");
    git("commit", "-qm", "fixture");
    const remote = join(SCRATCH_ROOT, name, "remote.git");
    expect(Bun.spawnSync(["git", "init", "-q", "--bare", remote], { env: { PATH: "/usr/bin:/bin" } }).exitCode).toBe(0);
    git("remote", "add", "origin", remote);
    git("push", "-q", "-u", "origin", "main");
    mkdirSync(join(home, "Library", "LaunchAgents"), { recursive: true });
    writeFileSync(join(home, "Library", "LaunchAgents", "ai.imaginethat.anthill.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>WorkingDirectory</key><string>${root}</string>
<key>ProgramArguments</key><array><string>bun</string><string>${root}/src/server/index.ts</string></array>
</dict></plist>`);
    return { root, scripts, launchLog, env: { HOME: home, PATH: `${fakeBin}:/usr/bin:/bin` } };
  }

  function deploy(it: Lab, env: Record<string, string> = {}) {
    const result = Bun.spawnSync(["bash", join(it.scripts, "anthill-deploy.sh")], {
      cwd: it.root,
      env: { ...it.env, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    let restarted = false;
    try { restarted = readFileSync(it.launchLog, "utf8").includes("kickstart"); } catch { restarted = false; }
    return { exitCode: result.exitCode, output: `${result.stdout.toString()}${result.stderr.toString()}`, restarted };
  }

  test("evidence gates red on a quiet fleet: refuses, names the override, restarts nothing", () => {
    const it = lab("quiet-blocks");
    const run = deploy(it, { CI_EXIT: "0", LOCAL_EXIT: "1" });
    expect(run.exitCode).toBe(1);
    expect(run.restarted).toBe(false);
    /* It has to say WHICH gates and HOW to proceed, or the operator's only
       option is to start deleting assertions. */
    expect(run.output).toContain("local-evidence gates FAILED");
    expect(run.output).toContain("ANTHILL_DEPLOY_QUIET_FLEET=1");
    expect(run.output).toContain("cross-source-token-agreement");
  });

  test("the override deploys a quiet fleet, and says out loud what went unverified", () => {
    const it = lab("quiet-override");
    const run = deploy(it, { CI_EXIT: "0", LOCAL_EXIT: "1", ANTHILL_DEPLOY_QUIET_FLEET: "1" });
    expect(run.restarted).toBe(true);
    expect(run.output).toContain("OVERRIDDEN");
    expect(run.output).toContain("cross-source-token-agreement");
  });

  /* The one that keeps this from being a skeleton key. */
  test("the override cannot ship a hermetic failure", () => {
    const it = lab("hermetic-red");
    const run = deploy(it, { CI_EXIT: "1", LOCAL_EXIT: "0", ANTHILL_DEPLOY_QUIET_FLEET: "1" });
    expect(run.exitCode).toBe(1);
    expect(run.restarted).toBe(false);
    expect(run.output).toContain("tests FAILED - not deploying.");
  });

  test("all green still deploys, with no override in sight", () => {
    const it = lab("all-green");
    const run = deploy(it, { CI_EXIT: "0", LOCAL_EXIT: "0" });
    expect(run.restarted).toBe(true);
    expect(run.output).not.toContain("OVERRIDDEN");
  });
});
