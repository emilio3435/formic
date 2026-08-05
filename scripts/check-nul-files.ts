#!/usr/bin/env bun
/**
 * CI ward: exactly one source file may contain NUL bytes — src/server/naming.ts.
 *
 * naming.ts uses deliberate NULs in disambiguator composite keys. Those bytes
 * are grep-invisible; agents and editors can strip or copy them. This script
 * fails when any other .ts/.js source carries a NUL, and when naming.ts loses
 * its NULs.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

export const ALLOWED_NUL_FILE = "src/server/naming.ts";

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

const SKIP_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".bun",
]);

export interface NulCheckResult {
  readonly ok: boolean;
  readonly found: readonly string[];
  readonly message: string;
}

function shouldSkipDir(name: string): boolean {
  return SKIP_DIR_NAMES.has(name) || name.startsWith(".");
}

/** Walk `root` and return repo-relative paths of source files. */
export function listSourceFiles(root: string): string[] {
  const out: string[] = [];

  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!SOURCE_EXTENSIONS.has(extname(entry.name))) continue;
      out.push(relative(root, full).split("\\").join("/"));
    }
  };

  walk(root);
  out.sort();
  return out;
}

/** Source files under `root` whose contents include at least one 0x00 byte. */
export function filesWithNul(root: string): string[] {
  const found: string[] = [];
  for (const rel of listSourceFiles(root)) {
    const full = join(root, rel);
    let size = 0;
    try {
      size = statSync(full).size;
    } catch {
      continue;
    }
    if (size === 0) continue;
    const bytes = readFileSync(full);
    if (bytes.includes(0)) found.push(rel);
  }
  return found;
}

/** Pass only when the NUL-carrying set is exactly `{src/server/naming.ts}`. */
export function checkNulFiles(root: string): NulCheckResult {
  const found = filesWithNul(root);
  const expected = [ALLOWED_NUL_FILE];
  const same =
    found.length === expected.length &&
    found.every((path, index) => path === expected[index]);

  if (same) {
    return {
      ok: true,
      found,
      message: `ok: exactly one NUL-carrying source file (${ALLOWED_NUL_FILE})`,
    };
  }

  const lines = [
    `expected exactly one NUL-carrying source file: ${ALLOWED_NUL_FILE}`,
    `found ${found.length}: ${found.length === 0 ? "(none)" : found.join(", ")}`,
  ];
  return { ok: false, found, message: lines.join("\n") };
}

if (import.meta.main) {
  const root = join(import.meta.dir, "..");
  const result = checkNulFiles(root);
  if (result.ok) {
    console.log(result.message);
    process.exit(0);
  }
  console.error(result.message);
  process.exit(1);
}
