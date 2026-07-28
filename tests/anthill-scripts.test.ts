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
const SCRATCH_ROOT = `/private/tmp/claude-501/anthill-ops-tests-${process.pid}`;

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

afterAll(() => {
  rmSync(SCRATCH_ROOT, { recursive: true, force: true });
});

describe("production-safe Ant Hill scripts", () => {
  test("hygiene refuses a feature-branch worktree before rewriting its LaunchAgent plist", () => {
    const root = freshFixture("hygiene-feature-branch");
    const scripts = join(root, "scripts");
    const fakeBin = join(root, "fake-bin");
    const fakeHome = join(root, "home");
    const plist = join(fakeHome, "Library/LaunchAgents/ai.imaginethat.anthill.plist");
    const launchctlLog = join(root, "launchctl.log");
    mkdirSync(scripts, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(join(root, "src/server"), { recursive: true });
    mkdirSync(join(root, "config"), { recursive: true });
    mkdirSync(join(fakeHome, "Library/LaunchAgents"), { recursive: true });
    copyFileSync(join(PROJECT_ROOT, "scripts/anthill-hygiene.sh"), join(scripts, "anthill-hygiene.sh"));
    writeFileSync(join(root, "src/server/index.ts"), "");
    writeFileSync(join(root, "config/programs.json"), '{"programs":[]}');
    writeFileSync(plist, "production plist sentinel\n");
    writeExecutable(join(fakeBin, "bun"), "#!/bin/bash\nexit 0\n");
    writeExecutable(
      join(fakeBin, "launchctl"),
      "#!/bin/bash\nprintf '%s\\n' \"$*\" >> \"$LAUNCHCTL_LOG\"\n",
    );
    writeExecutable(join(fakeBin, "curl"), "#!/bin/bash\nprintf '200'\n");
    writeExecutable(join(fakeBin, "lsof"), "#!/bin/bash\nexit 1\n");
    writeExecutable(join(fakeBin, "sleep"), "#!/bin/bash\nexit 0\n");
    expect(run(["git", "init", "-q", "-b", "feature/audit"], root, {
      PATH: "/usr/bin:/bin",
    }).exitCode).toBe(0);

    const result = run(["bash", join(scripts, "anthill-hygiene.sh")], root, {
      ANTHILL_REPO: root,
      BUN_BIN: join(fakeBin, "bun"),
      HOME: fakeHome,
      LAUNCHCTL_LOG: launchctlLog,
      PATH: `${fakeBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
    });

    expect(result.exitCode).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "Hygiene worktree must be on 'main' (currently 'feature/audit'). Aborting.",
    );
    expect(readFileSync(plist, "utf8")).toBe("production plist sentinel\n");
    expect(Bun.file(launchctlLog).size).toBe(0);
  });

  test("preview writes only to its temporary data root and removes it after exit", () => {
    const root = freshFixture("preview-data-isolation");
    const scripts = join(root, "scripts");
    const fakeBin = join(root, "fake-bin");
    const tempParent = join(root, "tmp");
    const productionArchive = join(root, "data/archive.json");
    mkdirSync(scripts, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(join(root, "src/server"), { recursive: true });
    mkdirSync(join(root, "config"), { recursive: true });
    mkdirSync(join(root, "data"), { recursive: true });
    mkdirSync(tempParent, { recursive: true });
    copyFileSync(join(PROJECT_ROOT, "scripts/anthill-preview.sh"), join(scripts, "anthill-preview.sh"));
    writeFileSync(join(root, "src/server/index.ts"), "");
    writeFileSync(join(root, "config/programs.json"), '{"programs":[]}');
    writeFileSync(productionArchive, "production state\n");
    writeExecutable(join(fakeBin, "lsof"), "#!/bin/bash\nexit 1\n");
    writeExecutable(
      join(fakeBin, "bun"),
      [
        "#!/bin/bash",
        "mkdir -p data",
        "printf 'preview state\\n' > data/archive.json",
        "printf 'fake bun cwd=%s data=%s/data\\n' \"$PWD\" \"$PWD\"",
        "",
      ].join("\n"),
    );

    const result = run(["bash", join(scripts, "anthill-preview.sh")], root, {
      HOME: join(root, "home"),
      PATH: `${fakeBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      TMPDIR: tempParent,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`source:   ${root}`);
    expect(result.stdout).toContain(`isolated data: ${tempParent}/anthill-preview.`);
    expect(result.stdout).toContain(`fake bun cwd=${tempParent}/anthill-preview.`);
    expect(readFileSync(productionArchive, "utf8")).toBe("production state\n");
    expect(Array.from(new Bun.Glob("anthill-preview.*").scanSync(tempParent))).toEqual([]);
  });

  test("start propagates a PATH-resolved cmux executable to both server launch paths", () => {
    const root = freshFixture("start-cmux-path");
    const scripts = join(root, "scripts");
    const fakeBin = join(root, "fake bin");
    const cmuxArgs = join(root, "cmux-args.log");
    const bunLog = join(root, "bun.log");
    mkdirSync(scripts, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    copyFileSync(join(PROJECT_ROOT, "scripts/anthill-start.sh"), join(scripts, "anthill-start.sh"));
    writeExecutable(join(fakeBin, "curl"), "#!/bin/bash\nexit 1\n");
    writeExecutable(join(fakeBin, "sleep"), "#!/bin/bash\nexit 0\n");
    writeExecutable(
      join(fakeBin, "cmux"),
      "#!/bin/bash\nprintf '%s\\n' \"$@\" > \"$CMUX_ARGS_LOG\"\n",
    );
    writeExecutable(
      join(fakeBin, "bun"),
      "#!/bin/bash\nprintf 'port=%s cmux=%s args=%s\\n' \"$MOUNTAIN_PORT\" \"${CMUX_EXECUTABLE:-}\" \"$*\" >> \"$BUN_LOG\"\n",
    );
    const env = {
      BUN_LOG: bunLog,
      CMUX_ARGS_LOG: cmuxArgs,
      CMUX_EXECUTABLE: join(root, "missing-cmux"),
      HOME: join(root, "home"),
      PATH: `${fakeBin}:/usr/bin:/bin`,
    };

    const result = run(
      ["bash", join(scripts, "anthill-start.sh"), "--no-open"],
      root,
      env,
    );

    expect(result.exitCode).toBe(0);
    const args = readFileSync(cmuxArgs, "utf8").trim().split("\n");
    const commandIndex = args.indexOf("--command");
    expect(commandIndex).toBeGreaterThanOrEqual(0);
    const serverCommand = args[commandIndex + 1]!;
    expect(serverCommand).toContain("CMUX_EXECUTABLE=");
    expect(run(["bash", "-c", serverCommand], root, env).exitCode).toBe(0);
    expect(readFileSync(bunLog, "utf8").trim().split("\n")).toEqual([
      `port=4701 cmux=${join(fakeBin, "cmux")} args=run start:server`,
      `port=4701 cmux=${join(fakeBin, "cmux")} args=run start:server`,
    ]);
  });

  test("start keeps the existing no-cmux fallback and binds the canonical port", () => {
    const root = freshFixture("start-no-cmux");
    const scripts = join(root, "scripts");
    const fakeBin = join(root, "fake-bin");
    const bunLog = join(root, "bun.log");
    mkdirSync(scripts, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    copyFileSync(join(PROJECT_ROOT, "scripts/anthill-start.sh"), join(scripts, "anthill-start.sh"));
    writeExecutable(join(fakeBin, "curl"), "#!/bin/bash\nexit 1\n");
    writeExecutable(join(fakeBin, "sleep"), "#!/bin/bash\nexit 0\n");
    writeExecutable(
      join(fakeBin, "bun"),
      "#!/bin/bash\nprintf 'port=%s cmux=%s args=%s\\n' \"$MOUNTAIN_PORT\" \"${CMUX_EXECUTABLE:-}\" \"$*\" > \"$BUN_LOG\"\n",
    );

    const result = run(
      ["bash", join(scripts, "anthill-start.sh"), "--no-open"],
      root,
      {
        BUN_LOG: bunLog,
        CMUX_EXECUTABLE: join(root, "missing-cmux"),
        HOME: join(root, "home"),
        PATH: `${fakeBin}:/usr/bin:/bin`,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "cmux not detected — starting in this shell (monitoring only; Focus/Send stay disabled).",
    );
    expect(readFileSync(bunLog, "utf8")).toBe(
      `port=4701 cmux=${join(root, "missing-cmux")} args=run start:server\n`,
    );
  });
});
