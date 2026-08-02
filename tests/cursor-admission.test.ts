import { describe, expect, test } from "bun:test";
import { parseCursorSession } from "../src/server/cursor";

/* What Cursor is allowed to put on the board.

   A cockpit earns its usefulness by what it refuses to show. Cursor's state
   directory holds more than sessions — content-addressed stores that outlived
   their chat, shells with no conversation in them, entries whose metadata
   cannot be read — and every one of those admitted as an agent is a row the
   orchestrator has to read past to reach the two that matter.

   parseCursorSession has four admission guards. Mutation testing found three of
   them unenforced by any test: deleting the UUID check, the
   hasConversation/cwd check, or the malformed-JSON catch each killed nothing in
   tests/cursor.test.ts, which covers only the fourth (a store whose agentId
   disagrees with its directory).

   Every guard is exercised in both directions. A rejection asserted alone
   passes just as well on a parser that admits nothing, which would empty the
   Cursor half of the board without a single test noticing. */

const SESSION_ID = "6514e366-df29-434b-979d-52a26168e188";
const NOW_MS = Date.parse("2026-08-02T10:00:00.000Z");

const metaJson = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    hasConversation: true,
    cwd: "/Users/me/project",
    createdAtMs: NOW_MS - 600_000,
    updatedAtMs: NOW_MS - 30_000,
    ...overrides,
  });

const parse = (sessionId: string, meta: string) =>
  parseCursorSession({ sessionId, metaJson: meta, nowMs: NOW_MS });

describe("only a real Cursor session becomes a row", () => {
  test("a well-formed session is admitted, so the refusals below mean something", () => {
    /* The control for the whole file. Without it every rejection assertion
       would also pass on a parser that returned null unconditionally, and the
       Cursor half of the fleet would silently vanish from the board. */
    const agent = parse(SESSION_ID, metaJson());

    expect(agent).not.toBeNull();
    expect(agent?.sourceSessionId).toBe(SESSION_ID);
    expect(agent?.cwd).toBe("/Users/me/project");
  });

  test("a directory that is not a session id is refused", () => {
    /* Cursor keeps caches and content-addressed stores beside its sessions.
       Admitting one would put a row on the board named after a directory, with
       no agent behind it and nothing an operator could ever do about it. */
    for (const notASession of ["cache", "store.db", "6514e366", "", "not-a-uuid-at-all"]) {
      expect(parse(notASession, metaJson())).toBeNull();
    }
  });

  test("a session id is matched whole, not merely contained", () => {
    // A prefix or suffix match would re-admit exactly the directories the
    // pattern exists to exclude.
    expect(parse(`x${SESSION_ID}`, metaJson())).toBeNull();
    expect(parse(`${SESSION_ID}-old`, metaJson())).toBeNull();
    expect(parse(SESSION_ID.toUpperCase(), metaJson())).not.toBeNull();
  });

  test("a shell with no conversation in it is refused", () => {
    /* hasConversation: false is Cursor stating there is nothing to show. A row
       for it would report an agent that has never said anything, which is the
       purest form of a pixel that neither reports, explains, nor enables. */
    expect(parse(SESSION_ID, metaJson({ hasConversation: false }))).toBeNull();
    // Absent is not the same as false: only an explicit denial excludes it.
    expect(parse(SESSION_ID, metaJson({ hasConversation: undefined }))).not.toBeNull();
  });

  test("a session with no working directory is refused", () => {
    /* cwd is what a session is matched to a cmux surface by. Without it the
       agent can never be routed, so its controls would sit permanently dead on
       a row that still occupies the operator's attention. */
    for (const badCwd of [undefined, null, 42, { path: "/Users/me" }, ["/Users/me"]]) {
      expect(parse(SESSION_ID, metaJson({ cwd: badCwd }))).toBeNull();
    }
  });

  test("metadata that will not parse is refused rather than guessed at", () => {
    // A half-written meta.json during a Cursor write must not produce an agent
    // assembled from whatever survived.
    for (const broken of ["", "{", "{ \"cwd\": ", "not json at all"]) {
      expect(parseCursorSession({ sessionId: SESSION_ID, metaJson: broken, nowMs: NOW_MS })).toBeNull();
    }
  });

  test("a store naming a different agent is refused, and one naming this agent is not", () => {
    /* The one guard tests/cursor.test.ts already covers, paired here with its
       positive case so the pair is complete in one place. A store that agrees
       must not be treated as a conflict. */
    expect(parseCursorSession({
      sessionId: SESSION_ID,
      metaJson: metaJson(),
      store: { agentId: "11111111-2222-4333-8444-555555555555" },
      nowMs: NOW_MS,
    })).toBeNull();

    expect(parseCursorSession({
      sessionId: SESSION_ID,
      metaJson: metaJson(),
      store: { agentId: SESSION_ID },
      nowMs: NOW_MS,
    })).not.toBeNull();
  });
});
