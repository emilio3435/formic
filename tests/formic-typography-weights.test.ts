import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(import.meta.dir, "..", path), "utf8");

describe("Formic typography uses only shipped font weights", () => {
  test("component rules cannot request synthetic font faces", () => {
    const styles = read("src/web/styles.css");
    const rules = [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const violations: string[] = [];

    for (const [, selector, body] of rules) {
      const weights = [
        ...[...body.matchAll(/font-weight\s*:\s*(\d+)/g)].map((match) => Number(match[1])),
        ...[...body.matchAll(/(?:^|;)\s*font\s*:\s*(\d+)\s/g)].map((match) => Number(match[1])),
      ];
      const allowed = body.includes("var(--font-display)")
        ? [700, 800]
        : body.includes("var(--font-mono)")
          ? [400, 500]
          : [400, 500, 600];

      for (const weight of weights) {
        if (!allowed.includes(weight)) violations.push(`${selector.trim()} requests unshipped weight ${weight}`);
      }
    }

    expect(violations).toEqual([]);
    expect(styles).toMatch(/html\s*\{[^}]*font-synthesis\s*:\s*none/s);
    expect(styles).toMatch(/h1, h2, h3, h4, h5, h6, strong, b\s*\{[^}]*font-weight\s*:\s*600/s);
  });

  test("row hierarchy and warnings keep one real face per family", () => {
    const styles = read("src/web/styles.css");
    const rule = (selector: string) => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
    };

    for (const selector of [
      ".ri-model .ri-value",
      ".ri-harness .ri-value",
      ".ri-ctx .ri-value",
      ".ri-tokens .ri-value",
      ".program-rollup-cell.is-alerting .program-rollup-value",
      ".agent-name-wrap .row-session-tag.is-inline",
      "body.inspector-open .agent-grid .ri-value",
      ".ri-elapsed.is-quiet .ri-value",
      ".agent-row.ctx-warn .ri-model .ri-value",
      ".agent-row.ctx-hot .ri-model .ri-value",
    ]) {
      expect(rule(selector), `${selector} must use shipped JetBrains Mono 500`).toMatch(/font-weight\s*:\s*500/);
    }

    expect(rule(".agent-name"), "ordinary row names must use shipped Inter 500").toMatch(
      /font-weight\s*:\s*500/,
    );
    expect(rule(".agent-row.is-parent .agent-name"), "parent row names must use shipped Inter 600").toMatch(
      /font-weight\s*:\s*600/,
    );
  });
});
