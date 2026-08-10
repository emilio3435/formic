import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression: ISSUE-005 — the 860px grid declared five tracks for seven instrument cells.
// Found by /qa on 2026-08-10
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-08-10.md
test("[FORMIC-860-GRID] tablet rows retain one explicit track per visible cell", () => {
  const styles = readFileSync(resolve(import.meta.dir, "../src/web/styles.css"), "utf8");
  const tracks = styles.match(
    /@media \(max-width: 1180px\) \{\s*\.agent-column-header,\s*\.agent-grid \{ grid-template-columns: ([^;}]+);/,
  )?.[1] ?? "";

  expect(tracks).not.toBe("");
  expect(tracks.match(/minmax\(/g)).toHaveLength(7);
});
