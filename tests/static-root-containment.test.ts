import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMountainFetch, emptySnapshot, type MountainAppState } from "../src/server/app";
import type { ArchiveStore, CommandRunner } from "../src/server/types";

/* The separator in the web-root containment check.

   serveStatic resolves a request under the web root and then requires

     path === root || path.startsWith(`${root}${sep}`)

   Mutation testing found the trailing separator unenforced: dropping it, so the
   test reads `path.startsWith(root)`, killed nothing in the suite. The existing
   traversal fixture puts its secret in the PARENT directory, and a parent never
   shares the root's string prefix, so it is caught either way.

   What the separator actually defends against is a sibling whose name begins
   with the root's: /…/web and /…/web-secrets. Without it, "/../web-secrets/x"
   resolves outside the served tree while still passing the prefix test, and the
   server hands the file over. This is the classic prefix-sibling escape, and it
   is the only reason that `${sep}` is in the expression.

   Both directions are asserted: the escape 404s, and ordinary files inside the
   root are still served — a containment check that refused everything would
   satisfy the first half while breaking the board. */

let fixtureRoot = "";
let webRoot = "";

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "anthill-containment-"));
  webRoot = join(fixtureRoot, "web");
  mkdirSync(webRoot, { recursive: true });
  writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>Ant Hill</title>");

  /* The sibling that shares the root's prefix. "web-secrets" starts with "web",
     so a containment check missing its separator accepts everything under it. */
  mkdirSync(join(fixtureRoot, "web-secrets"), { recursive: true });
  writeFileSync(join(fixtureRoot, "web-secrets", "leak.txt"), "must not be served");

  // A plain parent-directory secret, for contrast with the case above.
  writeFileSync(join(fixtureRoot, "secret.txt"), "must not be served either");
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
  const runner: CommandRunner = { run: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false }) };
  const archiveStore: ArchiveStore = { has: () => false, archive: async () => {} };
  return createMountainFetch({ state, runner, archiveStore, webRoot });
}

const get = (path: string) => appFetch()(new Request(`http://127.0.0.1:4701${path}`));

/* The only request forms that reach serveStatic still carrying a traversal.

   `new URL()` normalises "/../x" away, and it also decodes "%2E" to "." first
   and then normalises, so both of the obvious spellings arrive at the handler
   as the harmless "/x". Only an ENCODED SLASH survives: the pathname keeps
   "..%2F" verbatim, and serveStatic's own decodeURIComponent turns it back into
   "/../" at exactly the point where resolution happens.

   A first draft of this file used the two normalised spellings and therefore
   asserted nothing — the mutation it was written for survived it untouched. */
const ESCAPES = ["/..%2Fweb-secrets%2Fleak.txt", "/%2e%2e%2fweb-secrets%2fleak.txt"];

describe("the web root is contained by a path boundary, not a string prefix", () => {
  test("a sibling directory sharing the root's name prefix is not served", async () => {
    /* The case the separator exists for. web-secrets/ sits beside web/, so this
       resolves outside the served tree while still passing a bare
       startsWith(root). */
    for (const escape of ESCAPES) {
      const response = await get(escape);

      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("must not be served");
    }
  });

  test("a plain parent-directory escape is refused", async () => {
    // The case the existing fixture already covers, kept here so this file
    // states the whole boundary rather than only its unusual half.
    const response = await get("/..%2Fsecret.txt");

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("must not be served");
  });

  test("ordinary files inside the root are still served", async () => {
    /* The control. A containment check that refused everything would satisfy
       every assertion above while taking the board offline, which is the same
       failure from the other side. */
    const response = await get("/index.html");

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Ant Hill");
  });

  test("the root itself resolves to its index", async () => {
    // `path === root` is the other branch of the containment expression; "/"
    // maps to index.html before resolution, so this pins that it still lands.
    const response = await get("/");

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Ant Hill");
  });
});
