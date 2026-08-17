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

/* Swarm B / rows-0816 (#159). Five phase-offset copies of one artwork: same-URL
   <img>s share an animation clock, so a board of working rows would otherwise
   pulse in lockstep. The keyframes stay inside the SVG (D2) — styles.css gains
   none — which is only true if every file actually carries them. */
describe("forager relay assets (RL-5)", () => {
  const PHASES = [0, 1, 2, 3, 4];

  test("all five phase files exist, animate at 2s, and carry the reduced-motion stop", () => {
    for (const phase of PHASES) {
      const svg = read(`src/web/icons/forager-relay-${phase}.svg`);

      expect(svg).toMatch(/@keyframes relay\b/);
      expect(svg).toMatch(/@keyframes receipt\b/);
      expect(svg).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
      expect(svg).toMatch(/role=["']img["']/);
      // D5: both animations run on the shimmer's own 2s beat, not the 1.85s
      // concept period that walked against it.
      expect(svg).toMatch(/animation:\s*relay 2s cubic-bezier\(\.42,0,\.2,1\) infinite/);
      expect(svg).toMatch(/animation:\s*receipt 2s steps\(1,end\) infinite/);
      expect(svg).not.toContain("1.85s");
      // D3 concept colours survive the copy.
      expect(svg).toContain("#5b4fd1");
      expect(svg).toContain("#c1632b");
      expect(svg).toContain("#1f1f1f");
    }
  });

  test("each file offsets both animations by its own fifth of the cycle", () => {
    for (const phase of PHASES) {
      const svg = read(`src/web/icons/forager-relay-${phase}.svg`);
      const delays = [...svg.matchAll(/animation-delay:\s*(-?[\d.]+s)/g)].map((m) => m[1]);
      // Phase 0 ships an explicit `-0s` rather than omitting the declaration, so
      // all five files are structurally identical and the diff is two lines.
      const expected = phase === 0 ? "-0s" : `-${(phase * 0.4).toFixed(1)}s`;
      expect(delays).toEqual([expected, expected]);
    }
  });

  test("the five files are the same artwork — only the delay differs", () => {
    const stripped = PHASES.map((phase) =>
      read(`src/web/icons/forager-relay-${phase}.svg`).replace(/\s*animation-delay:[^;]*;/g, ""));
    for (const svg of stripped) expect(svg).toBe(stripped[0]);
  });
});
