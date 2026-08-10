import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression: ISSUE-001 — legacy clay must remain the ended-state compatibility alias.
// Found by /qa on 2026-08-10
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-08-10.md
test("[FORMIC-CLAY-BRIDGE] legacy clay cannot become a brand alias", () => {
  const styles = readFileSync(resolve(import.meta.dir, "../src/web/styles.css"), "utf8");

  expect(styles).toMatch(/--ended-ink\s*:\s*var\(--gray-500\)/);
  expect(styles).toMatch(/--clay\s*:\s*var\(--ended-ink\)/);
  expect(styles).not.toMatch(/--clay\s*:\s*var\(--color-brand-primary\)/);
});
