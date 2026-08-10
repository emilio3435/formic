import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression: ISSUE-006 — flex display defeated ellipsis and let long instruments overlap.
// Found by /qa on 2026-08-10
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-08-10.md
test("[FORMIC-INSTRUMENT-ELLIPSIS] text-only instrument values stay in their grid track", () => {
  const styles = readFileSync(resolve(import.meta.dir, "../src/web/styles.css"), "utf8");
  const rules = [...styles.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)];
  const ruleFor = (selector: string) => rules
    .filter((match) => match[1].split(",").some((part) => part.trim() === selector))
    .map((match) => match[2])
    .join("\n");
  const cell = ruleFor(".ri-cell");
  const value = ruleFor(".ri-value");

  expect(cell).toMatch(/width:\s*100%/);
  expect(cell).toMatch(/overflow:\s*hidden/);
  expect(value).toMatch(/display:\s*block/);
  expect(value).not.toMatch(/display:\s*flex/);
  expect(value).toMatch(/overflow:\s*hidden/);
  expect(value).toMatch(/text-overflow:\s*ellipsis/);
  expect(value).toMatch(/white-space:\s*nowrap/);
});
