import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SSE_HEARTBEAT_MS } from "../src/server/app";

function numericLiteral(value: string): number {
  return Number(value.replaceAll("_", ""));
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
});
