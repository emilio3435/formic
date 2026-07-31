import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProgramHints } from "../src/server/state";

/* Program grouping is operator-authored config read once at boot. Every failure
   mode returns [] so the hub still starts, which is exactly why each one has to
   announce itself: an ungrouped board and a board with no config written yet
   look identical to the operator. These tests pin the announcement, not just
   the empty array. */

const roots: string[] = [];

function configRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "anthill-program-hints-"));
  roots.push(root);
  return root;
}

function writeHints(contents: string): string {
  const path = join(configRoot(), "programs.json");
  writeFileSync(path, contents, "utf8");
  return path;
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("program hint config loading", () => {
  test("loads well-formed hints", async () => {
    const path = writeHints(JSON.stringify({
      programs: [{ id: "ridge", name: "Ridge", match: ["ridge", "summit"] }],
    }));

    expect(await loadProgramHints(path)).toEqual([
      { id: "ridge", name: "Ridge", match: ["ridge", "summit"] },
    ]);
  });

  test("treats an absent file as the un-configured default, without crying wolf", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      // No config is the normal state before an operator writes one, so this is
      // the one failure mode that must stay silent.
      expect(await loadProgramHints(join(configRoot(), "does-not-exist.json"))).toEqual([]);
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  test("announces malformed JSON instead of silently ungrouping the board", async () => {
    const path = writeHints('{ "programs": [ ');
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await loadProgramHints(path)).toEqual([]);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("not valid JSON"));
    } finally {
      logged.mockRestore();
    }
  });

  test("announces a config whose programs key is missing or not an array", async () => {
    const path = writeHints(JSON.stringify({ program: [{ id: "typo" }] }));
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await loadProgramHints(path)).toEqual([]);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('no "programs" array'));
    } finally {
      logged.mockRestore();
    }
  });

  test("keeps valid entries, drops malformed ones, and reports how many it dropped", async () => {
    const path = writeHints(JSON.stringify({
      programs: [
        { id: "ridge", name: "Ridge", match: ["ridge"] },
        { id: "no-name", match: ["x"] },
        { id: "bad-match", name: "Bad", match: [7] },
        null,
      ],
    }));
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      // A partially-bad file must not cost the operator the entries that parsed.
      expect(await loadProgramHints(path)).toEqual([
        { id: "ridge", name: "Ridge", match: ["ridge"] },
      ]);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("3 of 4 program hints"));
    } finally {
      logged.mockRestore();
    }
  });

  test("reports an unreadable path rather than passing a directory off as no config", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      // Reading a directory fails with EISDIR, not ENOENT: a real misconfiguration.
      expect(await loadProgramHints(configRoot())).toEqual([]);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("could not read program hints"));
    } finally {
      logged.mockRestore();
    }
  });
});
