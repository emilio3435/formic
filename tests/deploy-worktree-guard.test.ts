import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

function plist(workingDirectory: string, serverPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>ai.imaginethat.anthill</string>
  <key>WorkingDirectory</key><string>${workingDirectory}</string>
  <key>ProgramArguments</key>
  <array><string>bun</string><string>${serverPath}</string></array>
</dict>
</plist>`;
}

function runGuard(home: string, repo: string) {
  return Bun.spawnSync(["bash", join(ROOT, "scripts/anthill-deploy-target.sh")], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOME: home,
      ANTHILL_REPO: repo,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

test("deploy target guard accepts only the launchd job for this checkout", () => {
  const scratch = mkdtempSync(join(tmpdir(), "formic-deploy-target-"));

  try {
    const home = join(scratch, "home");
    const repo = join(home, "Developer", "the-mountain-production");
    const launchAgents = join(home, "Library", "LaunchAgents");
    const servicePlist = join(launchAgents, "ai.imaginethat.anthill.plist");
    mkdirSync(launchAgents, { recursive: true });
    writeFileSync(servicePlist, plist(repo, join(repo, "src/server/index.ts")));
    const accepted = runGuard(home, repo);
    expect(accepted.exitCode).toBe(0);

    writeFileSync(servicePlist, plist("/tmp/stale-checkout", "/tmp/stale-checkout/src/server/index.ts"));
    const rejected = runGuard(home, repo);
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr.toString()).toContain("Deploy target mismatch");
    expect(rejected.stderr.toString()).toContain(`ANTHILL_REPO="${repo}"`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("deploy checks the launchd target before verification or restart", () => {
  const deploy = readFileSync(join(ROOT, "scripts/anthill-deploy.sh"), "utf8");
  const canonical = deploy.indexOf('CANONICAL_ROOT="${HOME}/Developer/the-mountain-production"');
  const clean = deploy.indexOf("git status --porcelain --untracked-files=all");
  const fetch = deploy.indexOf("git fetch origin main:refs/remotes/origin/main");
  const exactMain = deploy.indexOf("git rev-parse origin/main");
  const guard = deploy.indexOf("anthill-deploy-target.sh");

  expect(canonical).toBeGreaterThan(-1);
  expect(clean).toBeGreaterThan(canonical);
  expect(fetch).toBeGreaterThan(clean);
  expect(exactMain).toBeGreaterThan(fetch);
  expect(deploy.indexOf("git merge --ff-only origin/main")).toBeGreaterThan(fetch);
  expect(guard).toBeGreaterThan(exactMain);
  expect(deploy.indexOf("bun install --frozen-lockfile")).toBeGreaterThan(guard);
  expect(deploy.indexOf("bunx tsc")).toBeGreaterThan(deploy.indexOf("bun install --frozen-lockfile"));
  expect(deploy.indexOf("launchctl kickstart")).toBeGreaterThan(guard);
});

test("the GitHub-visible runbook separates merge, deploy, and visual proof", () => {
  const runbook = readFileSync(join(ROOT, "DEPLOY.md"), "utf8");

  expect(runbook).toContain("Merging a pull request changes");
  expect(runbook).toContain("does not update that local worktree or restart launchd");
  expect(runbook).toContain("~/Developer/the-mountain-production");
  expect(runbook).toContain("merge --ff-only origin/main");
  expect(runbook).toContain("capture screenshot evidence");
});
