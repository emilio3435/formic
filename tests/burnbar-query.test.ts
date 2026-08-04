import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* burnbar-query.ts — entry 1 of docs/UNTESTED-PATHS-MAP.md, and the only file
   in src/server that no test imported at all.

   It runs in its own Bun process because Database.setCustomSQLite would
   otherwise collide with the hub's plaintext Cursor opens, and that isolation
   is exactly why nothing reached it: you cannot import it, so nobody did. It
   carries the only guards between this hub and OpenBurnBar's encrypted
   database — an application we do not own and only ever read.

   DRIVEN AS A SUBPROCESS, not by importing its functions. Testing
   assertSelectOnly() in-process would assert that a function rejects a string
   while proving nothing about what the spawned helper does with stdin, which is
   the thing that actually runs. Every test here writes JSON to a real `bun`
   process and reads its stdout, the same path burnbar.ts uses. */

const HELPER = join(import.meta.dir, "../src/server/burnbar-query.ts");
const KEY = "anthill-test-passphrase-base64like01";

const dylib =
  process.env.BURNBAR_SQLCIPHER_DYLIB?.trim() ||
  join(process.env.HOME || "", "Library/Application Support/OpenBurnBar/Frameworks/SQLCipher.framework/SQLCipher");
const canSqlcipher = Boolean(dylib && Bun.file(dylib).size > 0);

interface HelperResult { ok: boolean; rows?: unknown[]; error?: string }

/** Spawns the helper exactly as burnbar.ts does and returns its parsed reply. */
async function ask(
  body: unknown,
  env: Record<string, string> = {},
): Promise<{ result: HelperResult; exitCode: number; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bun", HELPER],
    env: {
      ...process.env,
      BURNBAR_DB_PATH: env.BURNBAR_DB_PATH ?? "/nonexistent/never.sqlite",
      BURNBAR_DB_KEY: env.BURNBAR_DB_KEY ?? KEY,
      ...(dylib ? { BURNBAR_SQLCIPHER_DYLIB: dylib } : {}),
      ...env,
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(typeof body === "string" ? body : JSON.stringify(body));
  await proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  let result: HelperResult;
  try {
    result = JSON.parse(stdout.trim()) as HelperResult;
  } catch {
    result = { ok: false, error: `unparseable stdout: ${stdout.slice(0, 200)}` };
  }
  return { result, exitCode, stderr };
}

/** A real encrypted database, so a permitted statement genuinely succeeds. */
function encryptedFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "anthill-query-helper-"));
  const dbPath = join(root, "openburnbar.sqlite");
  const script = join(root, "create.ts");
  writeFileSync(script, `
import { Database } from "bun:sqlite";
Database.setCustomSQLite(${JSON.stringify(dylib)});
const db = new Database(${JSON.stringify(dbPath)}, { create: true });
db.run("PRAGMA key = '${KEY}'");
db.run("CREATE TABLE token_usage (id TEXT PRIMARY KEY, provider TEXT, totalTokens INTEGER)");
db.run("INSERT INTO token_usage VALUES ('a','Codex',1000), ('b','Hermes',2000)");
db.close();
`);
  expect(Bun.spawnSync(["bun", script], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
  return dbPath;
}

describe("the hub only ever READS BurnBar, and this is what makes that true", () => {
  const MUTATIONS = [
    ["insert", "INSERT INTO token_usage VALUES ('x','X',1)"],
    ["update", "UPDATE token_usage SET totalTokens = 0"],
    ["delete", "DELETE FROM token_usage"],
    ["drop", "DROP TABLE token_usage"],
    ["alter", "ALTER TABLE token_usage ADD COLUMN x TEXT"],
    ["attach", "ATTACH DATABASE '/tmp/evil.sqlite' AS evil"],
    ["detach", "DETACH DATABASE evil"],
    ["rekey", "PRAGMA rekey = 'newpass'"],
    ["vacuum", "VACUUM"],
  ] as const;

  test.each(MUTATIONS)("a %s statement is refused and never reaches the database", async (_label, sql) => {
    /* OpenBurnBar is another application's data. A regression here would let
       the dashboard corrupt or destroy the database it exists to read. */
    const { result } = await ask({ sql });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Mutating SQL is not allowed|Only SELECT\/PRAGMA/);
  });

  test.each([
    ["a block comment", "/* SELECT */ DELETE FROM token_usage"],
    ["a line comment", "-- SELECT\nDROP TABLE token_usage"],
  ])("a mutation disguised by %s is still refused", async (_label, sql) => {
    /* Comments are stripped BEFORE either rule runs, which is what makes this
       fail. Left in, the statement would read as beginning with "/*" or "--"
       and the leading-keyword test would be inspecting the wrong token.

       The assertion is REFUSED, not which rule refused it: after stripping,
       these begin with DELETE and DROP, so the allowlist rejects them before
       the mutating-verb denylist is consulted. Naming a specific message here
       would pin the order the two guards happen to run in rather than the
       property either of them exists to provide. */
    const { result } = await ask({ sql });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Mutating SQL is not allowed|Only SELECT\/PRAGMA/);
  });

  test("a SELECT whose COMMENT mentions a mutating verb is still allowed", async () => {
    /* What the comment-stripping is actually for, and it is the opposite of
       what it looks like: stripping makes the guard more PERMISSIVE, not
       stricter. A legitimate SELECT carrying the word "drop" in a comment would
       otherwise trip the denylist and vanish.

       This is not hypothetical. burnbar.ts:744 already ships the SQL comment
       "-- session id, this dedup would drop one, and this is the number that",
       inside the live summary query. Remove the strip and the entire cost
       surface goes unavailable.

       Mutation testing is how this test exists: deleting the strip failed
       nothing, because every disguised-mutation case I had written was caught
       by the leading-keyword allowlist anyway. The guard I thought I was
       covering was covered by its neighbour, and the thing stripping genuinely
       protects had no test at all. Reaching the database — here, failing to
       open a nonexistent file — is what proves the statement was permitted. */
    const { result } = await ask({ sql: "SELECT id FROM token_usage -- we never drop these rows" });

    expect(result.ok).toBe(false);
    expect(result.error, "a comment mentioning a verb is being read as the statement")
      .not.toMatch(/Mutating SQL is not allowed|Only SELECT\/PRAGMA/);
    expect(result.error).toMatch(/unable to open database|not found/i);
  });

  test("a statement that is neither SELECT nor PRAGMA is refused on its own", async () => {
    /* Two independent rules: an allowlist on the leading keyword and a denylist
       on mutating verbs. This exercises the first without the second, so
       removing either is visible. */
    const { result } = await ask({ sql: "EXPLAIN QUERY PLAN SELECT 1" });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Only SELECT\/PRAGMA statements are allowed/);
  });

  test.skipIf(!canSqlcipher)("a SELECT is permitted, so the guard is a gate and not a wall", async () => {
    /* The control. Every refusal above would also hold on a helper that refused
       everything, and a cost surface that returns nothing is the failure this
       whole file guards against from the other side. */
    const { result } = await ask(
      { sql: "SELECT provider, totalTokens FROM token_usage ORDER BY id" },
      { BURNBAR_DB_PATH: encryptedFixture() },
    );

    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.rows?.[0]).toMatchObject({ provider: "Codex", totalTokens: 1000 });
  });

  test.skipIf(!canSqlcipher)("a parameterised SELECT binds rather than interpolating", async () => {
    const { result } = await ask(
      { sql: "SELECT provider FROM token_usage WHERE totalTokens > ?", params: [1500] },
      { BURNBAR_DB_PATH: encryptedFixture() },
    );

    expect(result.ok).toBe(true);
    expect(result.rows).toEqual([{ provider: "Hermes" }]);
  });
});

describe("the passphrase is validated before it is interpolated", () => {
  test("a key carrying a quote is refused rather than concatenated", async () => {
    /* The key goes into `PRAGMA key = '${key}'` by string interpolation, so the
       charset test is the injection guard. A quote would close the literal. */
    const { result } = await ask({ sql: "SELECT 1" }, { BURNBAR_DB_KEY: "abc'; DROP TABLE token_usage; --" });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/charset validation/i);
  });

  test.each([
    ["a space", "abc def"],
    ["a backslash", "abc\\def"],
    ["a semicolon", "abc;def"],
  ])("a key containing %s is refused", async (_label, key) => {
    const { result } = await ask({ sql: "SELECT 1" }, { BURNBAR_DB_KEY: key });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/charset validation/i);
  });

  test("the base64-ish alphabet the real key uses is accepted", async () => {
    /* The control: the validation must not reject the keys Keychain actually
       stores, or cost silently becomes unavailable on every machine. Reaching
       "database not found" proves the charset gate was passed. */
    const { result } = await ask({ sql: "SELECT 1" }, { BURNBAR_DB_KEY: "aZ09+/=_-" });

    expect(result.ok).toBe(false);
    expect(result.error).not.toMatch(/charset/i);
  });

  test("a missing key is refused before anything is opened", async () => {
    const { result } = await ask({ sql: "SELECT 1" }, { BURNBAR_DB_KEY: "" });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/BURNBAR_DB_KEY is required/);
  });
});

describe("what the helper says when it fails", () => {
  test("the passphrase never appears in an error payload", async () => {
    /* The file's own comment: "Never include env secrets in the error payload."
       burnbar.ts surfaces these strings to the client, so a key echoed here
       would leave the process. Asserted across several failure paths because
       one of them is where it would leak. */
    const secret = "SUPERSECRETKEY0123456789";
    for (const body of [
      { sql: "DROP TABLE token_usage" },
      { sql: "" },
      "not json at all",
      { sql: "SELECT 1" },
    ]) {
      const { result, stderr } = await ask(body, {
        BURNBAR_DB_KEY: secret,
        BURNBAR_DB_PATH: "/nonexistent/never.sqlite",
      });

      expect(result.ok).toBe(false);
      expect(JSON.stringify(result), `secret leaked for ${JSON.stringify(body)}`).not.toContain(secret);
      expect(stderr, `secret leaked to stderr for ${JSON.stringify(body)}`).not.toContain(secret);
    }
  });

  test("a refusal exits non-zero, so a caller cannot mistake it for a result", async () => {
    const { result, exitCode } = await ask({ sql: "DELETE FROM token_usage" });

    expect(result.ok).toBe(false);
    expect(exitCode).not.toBe(0);
  });

  test("malformed stdin is answered, not crashed on", async () => {
    /* It still has to reply in the protocol burnbar.ts parses: a bare stack
       trace on stdout would surface as "unparseable" rather than as a reason. */
    const { result } = await ask("{ not json");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/stdin must be JSON/);
  });

  test("an absent database says so rather than reporting an empty result", async () => {
    // Absent-first at the process boundary: no rows because we could not look
    // is a different fact from no rows because there are none.
    const { result } = await ask({ sql: "SELECT 1" }, { BURNBAR_DB_PATH: "/nonexistent/never.sqlite" });

    expect(result.ok).toBe(false);
    expect(result.rows).toBeUndefined();
  });
});
