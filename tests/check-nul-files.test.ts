import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALLOWED_NUL_FILE,
  checkNulFiles,
} from "../scripts/check-nul-files";

/* `src/server/naming.ts` carries two deliberate NUL bytes in its disambiguator
   composite keys. Those bytes are grep-invisible and tooling can silently
   strip or duplicate them. This ward keeps the allowlist at exactly one
   source file — naming.ts — so a second NUL-carrying .ts/.js never lands, and
   so dropping the deliberate NULs from naming.ts fails CI instead of going
   unnoticed. */

const PROJECT_ROOT = join(import.meta.dir, "..");
const SCRATCH_ROOT = `/private/tmp/claude-501/check-nul-files-${process.pid}`;

function freshFixture(name: string): string {
  const root = join(SCRATCH_ROOT, name);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, "src/server"), { recursive: true });
  return root;
}

function writeSource(root: string, rel: string, contents: string | Uint8Array): void {
  const path = join(root, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents);
}

afterAll(() => {
  rmSync(SCRATCH_ROOT, { recursive: true, force: true });
});

describe("check-nul-files", () => {
  test("the live tree has exactly one allowed NUL-carrying source file", () => {
    const result = checkNulFiles(PROJECT_ROOT);
    expect(result.ok).toBe(true);
    expect(result.found).toEqual([ALLOWED_NUL_FILE]);
  });

  test("CLI exits 0 against the live tree", () => {
    const script = join(PROJECT_ROOT, "scripts/check-nul-files.ts");
    const proc = Bun.spawnSync(["bun", script], {
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode).toBe(0);
  });

  test("a second NUL-carrying source file fails", () => {
    const root = freshFixture("extra-nul");
    writeSource(root, ALLOWED_NUL_FILE, "const a = `x\0y`;\n");
    writeSource(root, "src/server/other.ts", "const b = `p\0q`;\n");

    const result = checkNulFiles(root);
    expect(result.ok).toBe(false);
    expect(result.found).toContain("src/server/other.ts");
    expect(result.message).toContain("src/server/other.ts");
  });

  test("naming.ts without NUL bytes fails — the allowlist is exactly one, not at most one", () => {
    const root = freshFixture("missing-nul");
    writeSource(root, ALLOWED_NUL_FILE, "export const clean = true;\n");
    writeSource(root, "src/server/other.ts", "export const alsoClean = true;\n");

    const result = checkNulFiles(root);
    expect(result.ok).toBe(false);
    expect(result.found).toEqual([]);
    expect(result.message).toContain(ALLOWED_NUL_FILE);
  });

  test("binary assets with NULs are ignored — only source files are scanned", () => {
    const root = freshFixture("binary-ok");
    writeSource(root, ALLOWED_NUL_FILE, "const a = `x\0y`;\n");
    writeSource(root, "src/web/icons/fake.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a]));

    const result = checkNulFiles(root);
    expect(result.ok).toBe(true);
    expect(result.found).toEqual([ALLOWED_NUL_FILE]);
  });
});
