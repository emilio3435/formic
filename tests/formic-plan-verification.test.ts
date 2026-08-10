import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(import.meta.dir, "..", path), "utf8");

describe("Formic plan verification contracts", () => {
  test("the animated mark keeps the approved tilt, cadence, and reduced-motion fallback", () => {
    const mark = read("src/web/icons/formic-mark.svg");

    expect(mark).toMatch(/transform=["']rotate\(18 16 16\)["']/);
    expect(mark).toMatch(/\.edge-pulse[^}]*animation:\s*fm-travel 3\.2s linear infinite/s);
    expect(mark).toMatch(/\.node[^}]*animation:\s*fm-node 3\.2s ease-in-out infinite/s);
    expect(mark).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[^{]*\{[\s\S]*?\.edge-pulse\s*\{[^}]*display:\s*none/s);
    expect(mark).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[^{]*\{[\s\S]*?\.node\s*\{[^}]*animation:\s*none/s);
  });

  test("the favicon is a static, thick-stroke rendering", () => {
    const favicon = read("src/web/favicon.svg");

    expect(favicon).toMatch(/stroke-width=["']3["']/);
    expect(favicon.match(/r=["']4\.2["']/g)).toHaveLength(3);
    expect(favicon).not.toMatch(/animation|@keyframes|edge-pulse/);
  });

  test("the exact local font family and weights ship with one cache token", () => {
    const expectedFonts = [
      "Inter-Medium.woff2",
      "Inter-Regular.woff2",
      "Inter-SemiBold.woff2",
      "JetBrainsMono-Medium.woff2",
      "JetBrainsMono-Regular.woff2",
      "Syne-Bold.woff2",
      "Syne-ExtraBold.woff2",
    ];
    expect(readdirSync(resolve(import.meta.dir, "../src/web/fonts")).sort()).toEqual(expectedFonts);

    const tokens = read("src/web/formic-tokens.css");
    for (const font of expectedFonts) expect(tokens).toContain(`/fonts/${font}`);

    const html = read("src/web/index.html");
    const cacheTokens = [...html.matchAll(/(?:formic-tokens\.css|styles\.css|app\.js|favicon\.svg)\?v=([^"']+)/g)]
      .map((match) => match[1]);
    expect(cacheTokens).toHaveLength(4);
    expect(new Set(cacheTokens).size).toBe(1);
  });
});
