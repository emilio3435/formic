import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const styles = readFileSync(resolve(import.meta.dir, "../src/web/styles.css"), "utf8");

function cssRule(selector: string): string {
  const withoutComments = styles.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...withoutComments.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter((match) => match[1].split(",").some((part) => part.trim() === selector))
    .map((match) => match[2])
    .join("\n");
}

// Regression: ISSUE-002 — masthead geometry and LIVE treatment drifted from the approved plan.
// Found by /qa on 2026-08-10
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-08-10.md
test("[FORMIC-MASTHEAD-PLAN] mark and LIVE match the approved visual contract", () => {
  const mark = cssRule(".formic-mark");
  expect(mark).toMatch(/width\s*:\s*26px/);
  expect(mark).toMatch(/height\s*:\s*26px/);

  const live = cssRule(".conn-live");
  expect(live).toMatch(/background\s*:\s*var\(--color-status-success-tint\)/);

  const liveDot = cssRule(".conn-live .conn-dot");
  expect(liveDot).toMatch(/animation\s*:\s*conn-beat 2s ease-in-out infinite/);
});
