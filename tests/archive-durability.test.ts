import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonArchiveStore } from "../src/server/archive";
import type { CollectedAgent } from "../src/server/types";

/* Entry 9 of docs/UNTESTED-PATHS-MAP.md — the archive's real file operations.

   `tests/archive.test.ts` and `tests/policy-verifiability.test.ts` cover this
   class thoroughly, and between them they call `JsonArchiveStore.open` twenty
   times. Every one of those calls passes an in-memory `ArchiveFileOperations`.
   So the retention logic, the pruning, the archiveKind rules and the atomic
   commit ORDER are all well examined, and `nodeFileOperations` — the four lines
   that actually touch a disk — have never once run.

   That gap is worth closing rather than the logic being re-covered, because of
   what the map ranks it on: persisted history is the one figure on this board
   with no second source. Every other number has a sibling that would contradict
   it — the chart against the headline, the button against the endpoint, the
   board against BurnBar. After a restart the archive either holds what happened
   or it does not, and nothing else on the page disagrees with a wrong answer.
   An operator does not discover this on the day it breaks; they discover it the
   next time they look for something that should be there.

   So these tests use the DEFAULT file operations against a real temp directory,
   and assert on what is actually on disk. */

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "anthill-archive-real-"));
  roots.push(root);
  return root;
}

const UPDATED_AT = "2026-08-02T09:00:00.000Z";
const NOW = () => Date.parse(UPDATED_AT);

function agent(id: string): CollectedAgent {
  return {
    id,
    provider: "codex",
    sourceSessionId: id.split(":")[1]!,
    displayName: `Session ${id}`,
    status: "running",
    statusReason: "Source is active.",
    updatedAt: UPDATED_AT,
    tokens: { provenance: "unknown" },
    artifacts: [],
    gates: [],
  };
}

describe("what was archived is still archived after a restart", () => {
  test("an operator archive survives a real write and a real reopen", async () => {
    /* THE PROPERTY, and the one nothing on the board cross-checks. A store
       opened on a real path, written through real `writeFile` and `rename`, and
       reopened by a second instance that shares nothing with the first except
       the bytes on disk. Every existing test proves this against a Map. */
    const path = join(await tempRoot(), "archive.json");
    const store = await JsonArchiveStore.open(path, undefined, NOW);
    await store.archive("codex:kept", agent("codex:kept"));

    const reopened = await JsonArchiveStore.open(path, undefined, NOW);

    expect(reopened.has("codex:kept")).toBeTrue();
    expect(reopened.archivedAgents().map((entry) => entry.id)).toEqual(["codex:kept"]);
    // Nothing stood in for a failed read: an unreadable archive would boot empty
    // and say so, and that is a different outcome from this one.
    expect(reopened.loadError()).toBeUndefined();
  });

  test("the archive directory is created when it does not exist yet", async () => {
    /* Day one. `makeDirectory(dirname(path))` is a real recursive mkdir, and on
       a fresh machine the parent of the archive path has never existed. If it
       threw, the very first dismissal an operator ever made would be the one
       that did not persist — and the board would look right until the restart. */
    const path = join(await tempRoot(), "nested", "deeper", "archive.json");
    const store = await JsonArchiveStore.open(path, undefined, NOW);

    await store.archive("codex:first", agent("codex:first"));

    expect(JSON.parse(await readFile(path, "utf8"))).toHaveLength(1);
  });

  test("the committed file is the only one left behind", async () => {
    /* The commit writes `${path}.${pid}.${n}.tmp` and renames it. A rename that
       silently degraded to a copy, or a write that never got renamed at all,
       leaves the temp file in place — and then the archive on disk is either
       stale or duplicated, with the extra file growing per write forever. */
    const root = await tempRoot();
    const path = join(root, "archive.json");
    const store = await JsonArchiveStore.open(path, undefined, NOW);

    await store.archive("codex:a", agent("codex:a"));
    await store.archive("codex:b", agent("codex:b"));
    await store.record([agent("codex:c")]);

    const entries = await readdir(root);
    expect(entries.filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
    expect(entries).toEqual(["archive.json"]);
  });

  test("a stale temp file from a crashed write is not mistaken for the archive", async () => {
    /* The crash this design exists to survive. If the process dies between
       writeText and rename, a `.tmp` holding a PARTIAL archive is on disk at
       the next boot. It must be ignored: reading it would restore a truncated
       history as though it were complete, which is the silent version of losing
       records rather than the loud one. */
    const root = await tempRoot();
    const path = join(root, "archive.json");
    const first = await JsonArchiveStore.open(path, undefined, NOW);
    await first.archive("codex:real", agent("codex:real"));
    await writeFile(`${path}.99999.1.tmp`, JSON.stringify([agent("codex:from-crashed-write")]));

    const reopened = await JsonArchiveStore.open(path, undefined, NOW);

    expect(reopened.has("codex:real")).toBeTrue();
    expect(reopened.has("codex:from-crashed-write")).toBeFalse();
  });
});

describe("an archive that cannot be read says so", () => {
  test("a corrupt file on disk boots empty AND reports why", async () => {
    /* The comment in `open` makes the stakes explicit: an archive we could not
       read is not an empty archive, because clearing it silently puts every
       previously dismissed agent back on the board as live work. Covered
       already against a Map — but the branch that distinguishes this from a
       missing file is `error.code !== "ENOENT"`, and only a real filesystem
       produces those codes. An in-memory fake supplies whatever error the test
       author decided to throw. */
    const path = join(await tempRoot(), "archive.json");
    await writeFile(path, "{ not json at all");

    const store = await JsonArchiveStore.open(path, undefined, NOW);

    expect(store.has("codex:anything")).toBeFalse();
    expect(store.archivedAgents()).toEqual([]);
    expect(store.loadError()).toContain(path);
  });

  test("an archive that was never written is silent, not an error", async () => {
    /* The control, and the one that makes the test above mean something: a
       fresh machine has no archive file, and that is not a fault. Real ENOENT
       from a real absent path — the exact discrimination the branch makes. */
    const store = await JsonArchiveStore.open(join(await tempRoot(), "never-written.json"), undefined, NOW);

    expect(store.loadError()).toBeUndefined();
    expect(store.archivedAgents()).toEqual([]);
  });

  test("an unwritable archive directory rejects rather than reporting success", async () => {
    /* A write that cannot happen must not resolve. `archive()` returning
       cleanly on a failed write is how a dismissal appears to take and is gone
       after a restart — the same silence as the corrupt-read case, arriving
       from the write side. A file where the directory should be makes every
       mkdir under it fail with a real ENOTDIR. */
    const root = await tempRoot();
    await writeFile(join(root, "blocked"), "not a directory");
    const store = await JsonArchiveStore.open(join(root, "blocked", "archive.json"), undefined, NOW);

    await expect(store.archive("codex:doomed", agent("codex:doomed"))).rejects.toThrow();
  });

  test("a failed write does not poison the writes queued after it", async () => {
    /* `#enqueue` catches into the queue so one rejection does not stall the
       chain. Exercised here against real errors: a transient disk fault must
       not mean every later dismissal in the process is silently dropped too. */
    const root = await tempRoot();
    const blocked = join(root, "blocked");
    await writeFile(blocked, "not a directory");
    const path = join(blocked, "archive.json");
    const store = await JsonArchiveStore.open(path, undefined, NOW);

    await expect(store.archive("codex:doomed", agent("codex:doomed"))).rejects.toThrow();
    // Clear the obstruction, exactly as a full disk being emptied would.
    await rm(blocked);
    await mkdir(blocked, { recursive: true });
    await store.archive("codex:later", agent("codex:later"));

    expect((await JsonArchiveStore.open(path, undefined, NOW)).has("codex:later")).toBeTrue();
  });
});

describe("the file on disk is the record", () => {
  test("it is JSON an operator can read without this process", async () => {
    /* The archive is the only account of what was dismissed, and the only tool
       guaranteed available when the server will not start is a text editor.
       Pretty-printed, newline-terminated, and an array — asserted because the
       formatting arguments in `#commit` are otherwise invisible. */
    const path = join(await tempRoot(), "archive.json");
    const store = await JsonArchiveStore.open(path, undefined, NOW);
    await store.archive("codex:readable", agent("codex:readable"));

    const contents = await readFile(path, "utf8");

    expect(contents.endsWith("\n")).toBeTrue();
    expect(contents).toContain("\n  ");
    const parsed = JSON.parse(contents) as Array<{ id: string; archiveKind: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.id).toBe("codex:readable");
    expect(parsed[0]!.archiveKind).toBe("operator");
  });
});
