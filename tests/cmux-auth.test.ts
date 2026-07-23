import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cmuxCommand,
  cmuxSocketPassword,
  loadCmuxSocketEnv,
  resetCmuxAuthForTests,
  runningInsideCmux,
} from "../src/server/cmux-auth";

const originalPassword = process.env.CMUX_SOCKET_PASSWORD;
const originalSurface = process.env.CMUX_SURFACE_ID;
const originalWorkspace = process.env.CMUX_WORKSPACE_ID;

afterEach(() => {
  resetCmuxAuthForTests();
  if (originalPassword === undefined) delete process.env.CMUX_SOCKET_PASSWORD;
  else process.env.CMUX_SOCKET_PASSWORD = originalPassword;
  if (originalSurface === undefined) delete process.env.CMUX_SURFACE_ID;
  else process.env.CMUX_SURFACE_ID = originalSurface;
  if (originalWorkspace === undefined) delete process.env.CMUX_WORKSPACE_ID;
  else process.env.CMUX_WORKSPACE_ID = originalWorkspace;
});

describe("cmux socket auth", () => {
  test("cmuxCommand injects --password when configured", () => {
    process.env.CMUX_SOCKET_PASSWORD = "secret-token";
    resetCmuxAuthForTests();
    expect(cmuxCommand("/bin/cmux", ["rpc", "debug.terminals", "{}"])).toEqual([
      "/bin/cmux",
      "--password",
      "secret-token",
      "rpc",
      "debug.terminals",
      "{}",
    ]);
  });

  test("cmuxCommand stays bare when no password is set", () => {
    delete process.env.CMUX_SOCKET_PASSWORD;
    resetCmuxAuthForTests();
    expect(cmuxCommand("/bin/cmux", ["list-notifications", "--json"])).toEqual([
      "/bin/cmux",
      "list-notifications",
      "--json",
    ]);
  });

  test("loadCmuxSocketEnv reads data/cmux-socket.env without overriding env", () => {
    const root = mkdtempSync(join(tmpdir(), "anthill-cmux-auth-"));
    mkdirSync(join(root, "data"), { recursive: true });
    writeFileSync(join(root, "data/cmux-socket.env"), "CMUX_SOCKET_PASSWORD=from-file\n");

    delete process.env.CMUX_SOCKET_PASSWORD;
    resetCmuxAuthForTests();
    loadCmuxSocketEnv(root);
    expect(cmuxSocketPassword()).toBe("from-file");

    process.env.CMUX_SOCKET_PASSWORD = "from-env";
    resetCmuxAuthForTests();
    loadCmuxSocketEnv(root);
    expect(cmuxSocketPassword()).toBe("from-env");
  });

  test("runningInsideCmux follows CMUX_* identity variables", () => {
    delete process.env.CMUX_SURFACE_ID;
    delete process.env.CMUX_WORKSPACE_ID;
    expect(runningInsideCmux()).toBe(false);
    process.env.CMUX_WORKSPACE_ID = "workspace-1";
    expect(runningInsideCmux()).toBe(true);
  });
});
