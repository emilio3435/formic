import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { access, chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SSE_HEARTBEAT_MS } from "../src/server/app";

function numericLiteral(value: string): number {
  return Number(value.replaceAll("_", ""));
}

async function isolatedServerFixture(): Promise<{
  directory: string;
  home: string;
  marker: string;
  bindMarker: string;
  cmuxExecutable: string;
  preload: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "mountain-server-boot-"));
  const root = join(import.meta.dir, "..");
  await Promise.all([
    cp(join(root, "src"), join(directory, "src"), { recursive: true }),
    cp(join(root, "config"), join(directory, "config"), { recursive: true }),
    mkdir(join(directory, "data"), { recursive: true }),
  ]);
  const home = join(directory, "home");
  await mkdir(home);
  const marker = join(directory, "cmux-started");
  const bindMarker = join(directory, "server-bound");
  const cmuxExecutable = join(directory, "slow-cmux");
  await writeFile(cmuxExecutable, [
    "#!/bin/sh",
    'if [ -e "${MOUNTAIN_TEST_BIND_MARKER:?}" ]; then',
    '  printf bound > "${MOUNTAIN_TEST_CMUX_MARKER:?}"',
    "else",
    '  printf unbound > "${MOUNTAIN_TEST_CMUX_MARKER:?}"',
    "fi",
    "sleep 5",
    "exit 1",
    "",
  ].join("\n"));
  await chmod(cmuxExecutable, 0o755);
  const preload = join(directory, "fake-serve.ts");
  await writeFile(preload, [
    'import { writeFileSync } from "node:fs";',
    "Bun.serve = ((options: { port: number }) => {",
    '  if (process.env.MOUNTAIN_TEST_BIND_FAIL === "1") {',
    '    throw Object.assign(new Error("Failed to bind test port"), { code: "EADDRINUSE" });',
    "  }",
    '  writeFileSync(process.env.MOUNTAIN_TEST_BIND_MARKER!, "bound");',
    "  return { port: Number(options.port), stop() {} };",
    "}) as typeof Bun.serve;",
    "",
  ].join("\n"));
  return { directory, home, marker, bindMarker, cmuxExecutable, preload };
}

function startFixture(
  fixture: Awaited<ReturnType<typeof isolatedServerFixture>>,
  port: number,
  failBind = false,
): ReturnType<typeof Bun.spawn> {
  return Bun.spawn([process.execPath, "--preload", fixture.preload, "src/server/index.ts"], {
    cwd: fixture.directory,
    env: {
      ...process.env,
      HOME: fixture.home,
      MOUNTAIN_PORT: String(port),
      CMUX_EXECUTABLE: fixture.cmuxExecutable,
      MOUNTAIN_TEST_CMUX_MARKER: fixture.marker,
      MOUNTAIN_TEST_BIND_MARKER: fixture.bindMarker,
      MOUNTAIN_TEST_BIND_FAIL: failBind ? "1" : "0",
      CMUX_SOCKET_PASSWORD: "",
      CMUX_SURFACE_ID: "",
      CMUX_WORKSPACE_ID: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function stopFixture(process: ReturnType<typeof Bun.spawn>): Promise<void> {
  try {
    process.kill("SIGTERM");
  } catch {
    return;
  }
  const exited = await Promise.race([
    process.exited.then(() => true),
    Bun.sleep(1_000).then(() => false),
  ]);
  if (!exited) {
    process.kill("SIGKILL");
    await process.exited;
  }
}

async function waitForFile(path: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return true;
    } catch {
      await Bun.sleep(25);
    }
  }
  return false;
}

describe("server runtime configuration", () => {
  test("Bun's idle timeout remains longer than the SSE heartbeat interval", () => {
    /* The invariant: Bun closes an idle socket after `idleTimeout`, and the
       heartbeat exists to keep the stream from ever looking idle. Beat slower
       than the timeout and every SSE client is dropped and reconnected on a
       loop, which reads on the board as a feed that keeps going briefly blank.

       The heartbeat side is now IMPORTED rather than scraped. It used to be
       matched out of app.ts with a regex ending `\},\s*([\d_]+)\),`, which
       silently stopped matching the moment the literal moved into a named
       constant — a test that reads source text passes or fails on formatting
       rather than on the value, and this one went red for a refactor that did
       not change the interval at all.

       `idleTimeout` still has to be scraped: index.ts calls Bun.serve at module
       scope, so importing it would start a server. That asymmetry is the reason
       index.ts is entry 2 of docs/UNTESTED-PATHS-MAP.md. */
    const indexSource = readFileSync(join(import.meta.dir, "../src/server/index.ts"), "utf8");
    const idleTimeout = indexSource.match(/idleTimeout:\s*([\d_]+)/)?.[1];

    expect(idleTimeout, "idleTimeout is no longer declared where this test looks for it").toBeDefined();
    expect(numericLiteral(idleTimeout!) * 1_000).toBeGreaterThan(SSE_HEARTBEAT_MS);
  });

  test("only the production port is allowed to mutate cmux repo groups", () => {
    const indexSource = readFileSync(join(import.meta.dir, "../src/server/index.ts"), "utf8");
    expect(indexSource).toContain("const PRODUCTION_PORT = 4_701");
    expect(indexSource).toContain("repoGroupMirrorWriter: configuredPort === PRODUCTION_PORT");
  });

  test("binds the HTTP port while the first fleet collection is still pending", async () => {
    const fixture = await isolatedServerFixture();
    const process = startFixture(fixture, 4_717);
    try {
      expect(await waitForFile(fixture.marker, 5_000), "the deliberately slow collection never started").toBeTrue();
      expect(await readFile(fixture.marker, "utf8"), "collection started before Bun.serve bound the configured port").toBe("bound");
      expect(await waitForFile(fixture.bindMarker, 100), "Bun.serve did not bind before collection").toBeTrue();
    } finally {
      await stopFixture(process);
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  test("a failed bind exits before starting the first fleet collection", async () => {
    const fixture = await isolatedServerFixture();
    const process = startFixture(fixture, 4_718, true);
    try {
      const exitCode = await Promise.race([
        process.exited,
        Bun.sleep(1_500).then(() => null),
      ]);
      expect(exitCode, "the second server stayed alive after its port bind failed").not.toBeNull();
      await expect(access(fixture.marker)).rejects.toThrow();
    } finally {
      await stopFixture(process);
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });
});
