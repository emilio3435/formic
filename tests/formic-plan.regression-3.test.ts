import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression: ISSUE-004 — opening an inspector emitted inline-style CSP violations.
// Found by /qa on 2026-08-10
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-08-10.md
test("[FORMIC-INSPECTOR-CSP] inspector markup uses stylesheet classes only", () => {
  const app = readFileSync(resolve(import.meta.dir, "../src/web/app.js"), "utf8");
  const styles = readFileSync(resolve(import.meta.dir, "../src/web/styles.css"), "utf8");

  expect(app).not.toMatch(/\bstyle\s*:\s*["'`]/);
  expect(app).toContain('class: "evidence-value"');
  expect(app).toContain('class: "shelf-rail-tail"');
  expect(styles).toMatch(/\.evidence-value\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*gap:\s*6px/s);
  expect(styles).toMatch(/\.shelf-rail-tail\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*gap:\s*8px/s);
});
