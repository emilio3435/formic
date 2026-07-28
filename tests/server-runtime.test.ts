import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function numericLiteral(value: string): number {
  return Number(value.replaceAll("_", ""));
}

describe("server runtime configuration", () => {
  test("Bun's idle timeout remains longer than the SSE heartbeat interval", () => {
    const indexSource = readFileSync(join(import.meta.dir, "../src/server/index.ts"), "utf8");
    const appSource = readFileSync(join(import.meta.dir, "../src/server/app.ts"), "utf8");
    const idleTimeout = indexSource.match(/idleTimeout:\s*([\d_]+)/)?.[1];
    const heartbeat = appSource.match(/event: heartbeat[\s\S]{0,500}?\},\s*([\d_]+)\),/)?.[1];

    expect(idleTimeout).toBeDefined();
    expect(heartbeat).toBeDefined();
    expect(numericLiteral(idleTimeout!) * 1_000).toBeGreaterThan(numericLiteral(heartbeat!));
  });
});
