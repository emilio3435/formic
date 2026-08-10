import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMountainFetch, emptySnapshot, type MountainAppState } from "../src/server/app";
import type { ArchiveStore, CommandRunner } from "../src/server/types";

const CSP = "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'";
let fixtureRoot = "";
let webRoot = "";

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "anthill-static-"));
  webRoot = join(fixtureRoot, "web");
  mkdirSync(join(webRoot, "assets"), { recursive: true });
  writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>Ant Hill</title>");
  writeFileSync(join(webRoot, "app.js"), "export {};");
  writeFileSync(join(webRoot, "app.css"), "body {}");
  writeFileSync(join(webRoot, "formic-mark.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\" />");
  writeFileSync(join(webRoot, "formic.woff2"), "font");
  writeFileSync(join(webRoot, "favicon.ico"), "ico");
  writeFileSync(join(webRoot, "blob.bin"), "binary");
  writeFileSync(join(fixtureRoot, "secret.txt"), "must not escape the web root");
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function appFetch() {
  const snapshot = emptySnapshot();
  const state: MountainAppState = {
    get: () => snapshot,
    subscribe: () => () => {},
    refresh: async () => snapshot,
  };
  const runner: CommandRunner = {
    run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }),
  };
  const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
  return createMountainFetch({ state, runner, archiveStore, webRoot });
}

describe("static HTTP boundary", () => {
  test("serves the index with the pinned browser security policy", async () => {
    const fetch = appFetch();
    const response = await fetch(new Request("http://127.0.0.1:4701/"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBe(CSP);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toContain("<title>Ant Hill</title>");
    fetch.dispose();
  });

  test.each([
    "/%2e%2e%2fsecret.txt",
    "/../../secret.txt",
  ])("does not serve a path outside the web root: %s", async (pathname) => {
    const fetch = appFetch();
    const response = await fetch(new Request(`http://127.0.0.1:4701${pathname}`));

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("must not escape");
    fetch.dispose();
  });

  test("rejects malformed escapes and directories", async () => {
    const fetch = appFetch();
    const malformed = await fetch(new Request("http://127.0.0.1:4701/%zz"));
    const directory = await fetch(new Request("http://127.0.0.1:4701/assets"));

    expect(malformed.status).toBe(400);
    expect(await malformed.text()).toBe("Bad path");
    expect(directory.status).toBe(404);
    fetch.dispose();
  });

  test("HEAD preserves static headers without a response body", async () => {
    const fetch = appFetch();
    const response = await fetch(new Request("http://127.0.0.1:4701/app.js", { method: "HEAD" }));

    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toBe(CSP);
    fetch.dispose();
  });

  test("FORMIC-CSP-1 serves local SVG, WOFF2, and favicon assets under the unchanged self-only CSP", async () => {
    const fetch = appFetch();
    const assets: readonly [string, string][] = [
      ["/formic-mark.svg", "image/svg+xml"],
      ["/formic.woff2", "font/woff2"],
      ["/favicon.ico", "image/x-icon"],
    ];

    for (const [pathname, contentType] of assets) {
      const response = await fetch(new Request(`http://127.0.0.1:4701${pathname}`));

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(contentType);
      expect(response.headers.get("content-security-policy")).toBe(CSP);
    }
    fetch.dispose();
  });

  test.each([
    ["/app.js", "text/javascript; charset=utf-8"],
    ["/app.css", "text/css; charset=utf-8"],
    ["/index.html", "text/html; charset=utf-8"],
    ["/blob.bin", "application/octet-stream"],
  ])("maps %s to %s", async (pathname, contentType) => {
    const fetch = appFetch();
    const response = await fetch(new Request(`http://127.0.0.1:4701${pathname}`));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(contentType);
    fetch.dispose();
  });

  test.each([
    "/",
    "/api/snapshot",
    "/api/events",
    "/api/debug/identity",
  ])("rejects a foreign Host before routing %s", async (pathname) => {
    const fetch = appFetch();
    const response = await fetch(new Request(`http://evil.example:4701${pathname}`));

    expect(response.status).toBe(403);
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    fetch.dispose();
  });
});
